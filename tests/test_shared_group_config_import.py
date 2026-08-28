import json
import os
import tempfile
import threading
import unittest
from dataclasses import replace
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.config.db_repository import DbConfigRepository
from backend.config.import_config import export_view_config_json, import_dashboard_config
from backend.db import engine as db_engine
from backend.db import models
from backend.services import shared_group_config
from backend.services.user_view_config import save_imported_user_view
import jira_server


def validate_groups_config(payload, allow_empty=False):
    return jira_server.validate_groups_config(payload, allow_empty=allow_empty)


class SharedGroupConfigImportTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.dashboard_path = os.path.join(self._tmpdir.name, 'dashboard-config.json')
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'shared-group-import.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id = self._seed_subjects()
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=self.user_id,
            stable_subject='account-1',
            atlassian_account_id='account-1',
            workspace_id=self.workspace_id,
            auth_connection_id='connection-1',
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )
        with open(self.dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'version': 1,
                'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
                'teamGroups': {
                    'version': 1,
                    'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
                    'defaultGroupId': 'platform',
                },
            }, handle)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_subjects(self):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user])
            session.commit()
            return workspace.id, user.id

    def test_import_splits_team_groups_into_workspace_catalog_and_strips_private_view(self):
        imported = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=self.dashboard_path,
            actor_user_id=self.user_id,
        )

        self.assertTrue(imported.imported)
        resolved = DbConfigRepository(database_url=self.database_url).resolve_effective_view_config(self.context)
        shared = shared_group_config.load_shared_groups(
            self.context,
            fallback_loader=lambda: {},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        self.assertNotIn('teamGroups', resolved['view'])
        self.assertEqual(shared['groups'][0]['id'], 'platform')
        self.assertEqual(shared['groups'][0]['adHocCapacityEpics'], [])

    def test_import_preserves_normalized_ad_hoc_capacity_epics(self):
        with open(self.dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'version': 1,
                'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
                'teamGroups': {
                    'version': 1,
                    'groups': [{
                        'id': 'platform',
                        'name': 'Platform',
                        'teamIds': ['team-a'],
                        'adHocCapacityEpics': [' product-adhoc ', 'PRODUCT-ADHOC', 'PRODUCT-OTHER'],
                    }],
                    'defaultGroupId': 'platform',
                },
            }, handle)

        imported = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=self.dashboard_path,
            actor_user_id=self.user_id,
        )
        shared = shared_group_config.load_shared_groups(
            self.context,
            fallback_loader=lambda: {},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )
        export_path = os.path.join(self._tmpdir.name, 'ad-hoc-rollback-export.json')
        export_view_config_json(
            database_url=self.database_url,
            context=self.context,
            view_config_id=imported.view_config_id,
            output_path=export_path,
        )

        with open(export_path, encoding='utf-8') as handle:
            exported = json.load(handle)
        self.assertEqual(shared['groups'][0]['adHocCapacityEpics'], ['PRODUCT-ADHOC', 'PRODUCT-OTHER'])
        self.assertEqual(exported['teamGroups']['groups'][0]['adHocCapacityEpics'], ['PRODUCT-ADHOC', 'PRODUCT-OTHER'])

    def test_import_rejects_excluded_and_ad_hoc_capacity_overlap(self):
        with open(self.dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'version': 1,
                'projects': {'selected': [{'key': 'PROD', 'type': 'product'}]},
                'teamGroups': {
                    'version': 1,
                    'groups': [{
                        'id': 'platform',
                        'name': 'Platform',
                        'teamIds': ['team-a'],
                        'excludedCapacityEpics': ['PRODUCT-ADHOC'],
                        'adHocCapacityEpics': [' product-adhoc '],
                    }],
                    'defaultGroupId': 'platform',
                },
            }, handle)

        with self.assertRaises(shared_group_config.InvalidSharedGroupConfig):
            import_dashboard_config(
                database_url=self.database_url,
                context=self.context,
                source_path=self.dashboard_path,
                actor_user_id=self.user_id,
            )

    def test_export_merges_current_shared_groups_into_rollback_json(self):
        imported = import_dashboard_config(
            database_url=self.database_url,
            context=self.context,
            source_path=self.dashboard_path,
            actor_user_id=self.user_id,
        )
        shared_group_config.save_shared_groups(
            self.context,
            {
                'version': 1,
                'groups': [{'id': 'updated', 'name': 'Updated', 'teamIds': ['team-b']}],
                'defaultGroupId': 'updated',
            },
            base_revision=1,
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        export_path = os.path.join(self._tmpdir.name, 'rollback-export.json')
        export_view_config_json(
            database_url=self.database_url,
            context=self.context,
            view_config_id=imported.view_config_id,
            output_path=export_path,
        )

        with open(export_path, encoding='utf-8') as handle:
            exported = json.load(handle)
        self.assertEqual(exported['teamGroups']['groups'][0]['id'], 'updated')
        self.assertEqual(exported['teamGroups']['groups'][0]['adHocCapacityEpics'], [])
        self.assertNotIn('projects', exported)

    def test_import_discards_team_catalog_and_preserves_other_owners_and_private_domains(self):
        epm = {
            'version': 2, 'labelPrefix': 'project_*',
            'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-1']},
            'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
            'projects': {},
        }
        with open(self.dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump({
                'version': 1,
                'teamGroups': {'version': 1, 'groups': [], 'defaultGroupId': ''},
                'teamCatalog': {'catalog': {'legacy': {'name': 'Discard'}}},
                'epm': epm,
            }, handle)
        with self.factory() as session:
            other = models.User(
                external_provider='atlassian', external_subject='account-2', account_type='user',
                status='active', created_by='test',
            )
            session.add(other)
            session.flush()
            other_view = models.ViewConfig(
                workspace_id=self.workspace_id, owner_user_id=other.id, name='Other', view_type='epm',
                payload={'epm': {**epm, 'scope': {'rootGoalKey': 'OTHER', 'subGoalKeys': []}}},
                visibility='private', is_default=True,
            )
            catalog = models.WorkspaceTeamCatalog(
                workspace_id=self.workspace_id, payload={'catalog': {'existing': {'name': 'Keep'}}},
                config_revision=3,
            )
            preference = models.UserGroupPreference(
                workspace_id=self.workspace_id, user_id=self.user_id,
                visible_group_ids=['existing'], active_group_id='existing', customized=True,
            )
            existing_groups = models.WorkspaceGroupConfig(
                workspace_id=self.workspace_id,
                payload={
                    'version': 1,
                    'groups': [{'id': 'existing', 'name': 'Existing', 'teamIds': ['team-existing']}],
                    'defaultGroupId': 'existing',
                },
                config_revision=7,
                created_by=self.user_id,
                updated_by=self.user_id,
            )
            connection = models.AuthConnection(
                id='connection-import', user_id=self.user_id, workspace_id=self.workspace_id,
                provider='atlassian_oauth', status='active', token_version=1, capabilities=[],
            )
            token = models.AuthToken(
                id='token-import', connection_id=connection.id, token_kind='access_token',
                algorithm='test', ciphertext='cipher', nonce='nonce', wrapped_dek='dek',
                key_id='key', aad_hash='hash',
            )
            session.add_all([other_view, catalog, preference, existing_groups, connection, token])
            session.commit()
            other_id = other.id

        with patch(
            'backend.config.import_config.user_view_config.save_imported_user_view',
            wraps=save_imported_user_view,
        ) as serialized:
            imported = import_dashboard_config(
                database_url=self.database_url, context=self.context,
                source_path=self.dashboard_path, actor_user_id=self.user_id,
            )
        self.assertTrue(imported.imported)
        serialized.assert_called_once()

        with self.factory() as session:
            mine = session.query(models.ViewConfig).filter_by(
                workspace_id=self.workspace_id, owner_user_id=self.user_id, is_default=True,
            ).one()
            other = session.query(models.ViewConfig).filter_by(owner_user_id=other_id).one()
            catalog = session.query(models.WorkspaceTeamCatalog).one()
            preference = session.query(models.UserGroupPreference).one()
            groups = session.query(models.WorkspaceGroupConfig).one()
            connection = session.query(models.AuthConnection).filter_by(id='connection-import').one()
            token = session.query(models.AuthToken).filter_by(id='token-import').one()
            version = session.query(models.ViewConfigVersion).filter_by(view_config_id=mine.id).one()
            self.assertEqual(mine.payload['epm'], epm)
            self.assertNotIn('teamCatalog', mine.payload)
            self.assertNotIn('teamCatalog', version.payload)
            self.assertEqual(other.payload['epm']['scope']['rootGoalKey'], 'OTHER')
            self.assertEqual(catalog.payload, {'catalog': {'existing': {'name': 'Keep'}}})
            self.assertEqual(catalog.config_revision, 3)
            self.assertEqual(preference.visible_group_ids, ['existing'])
            self.assertEqual(preference.active_group_id, 'existing')
            self.assertEqual(groups.payload, {
                'version': 1,
                'groups': [{'id': 'existing', 'name': 'Existing', 'teamIds': ['team-existing']}],
                'defaultGroupId': 'existing',
            })
            self.assertEqual(groups.config_revision, 7)
            self.assertEqual(connection.token_version, 1)
            self.assertEqual(token.ciphertext, 'cipher')

    def test_private_import_rollback_also_rolls_back_new_shared_groups(self):
        with self.assertRaises(RuntimeError):
            import_dashboard_config(
                database_url=self.database_url, context=self.context,
                source_path=self.dashboard_path, actor_user_id='other-user',
                _before_commit=lambda: (_ for _ in ()).throw(RuntimeError('rollback')),
            )

        with self.factory() as session:
            self.assertEqual(session.query(models.ViewConfig).count(), 0)
            self.assertEqual(session.query(models.ViewConfigVersion).count(), 0)
            self.assertEqual(session.query(models.WorkspaceGroupConfig).count(), 0)

    def test_two_users_concurrently_import_one_shared_group_row_and_private_views(self):
        with self.factory() as session:
            other = models.User(
                external_provider='atlassian', external_subject='account-concurrent',
                account_type='user', status='active', created_by='test',
            )
            session.add(other)
            session.commit()
            other_user_id = other.id
        other_context = replace(
            self.context, user_id=other_user_id, stable_subject='account-concurrent',
            atlassian_account_id='account-concurrent',
        )
        barrier = threading.Barrier(2)
        results = []
        failures = []

        def run(context):
            try:
                barrier.wait(timeout=5)
                results.append(import_dashboard_config(
                    database_url=self.database_url, context=context, source_path=self.dashboard_path,
                ))
            except Exception as error:
                failures.append(error)

        threads = [threading.Thread(target=run, args=(context,)) for context in (self.context, other_context)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(failures, [])
        self.assertEqual([result.imported for result in results], [True, True])
        with self.factory() as session:
            self.assertEqual(session.query(models.WorkspaceGroupConfig).count(), 1)
            self.assertEqual(session.query(models.ViewConfig).count(), 2)
            self.assertEqual(session.query(models.ViewConfigVersion).count(), 2)


if __name__ == '__main__':
    unittest.main()
