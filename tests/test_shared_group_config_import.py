import json
import os
import tempfile
import unittest

from backend.auth.context import RequestAuthContext
from backend.config.db_repository import DbConfigRepository
from backend.config.import_config import export_view_config_json, import_dashboard_config
from backend.db import engine as db_engine
from backend.db import models
from backend.services import shared_group_config
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
        self.assertEqual(exported['projects']['selected'][0]['key'], 'PROD')


if __name__ == '__main__':
    unittest.main()
