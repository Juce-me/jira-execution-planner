import os
import tempfile
import unittest
from types import SimpleNamespace

from backend.db import engine as db_engine
from backend.db import models
from backend.services import shared_group_config as service
import jira_server


def validate_groups_config(payload, allow_empty=False):
    return jira_server.validate_groups_config(payload, allow_empty=allow_empty)


class SharedGroupConfigServiceTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'shared-groups.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.other_user_id = self._seed_subjects()
        self.context = self._context(self.user_id)
        self.other_context = self._context(self.other_user_id)

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
            other_user = models.User(
                external_provider='atlassian',
                external_subject='account-2',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user, other_user])
            session.commit()
            return workspace.id, user.id, other_user.id

    def _context(self, user_id):
        return SimpleNamespace(
            workspace_id=self.workspace_id,
            user_id=user_id,
            auth_connection_id=f'connection-{user_id}',
        )

    def _groups(self):
        return {
            'version': 1,
            'groups': [
                {'id': 'default', 'name': 'Default', 'teamIds': ['team-default']},
                {'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']},
            ],
            'defaultGroupId': 'default',
        }

    def test_load_imports_legacy_json_once_for_workspace(self):
        legacy = {
            'version': 1,
            'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
            'defaultGroupId': 'platform',
        }

        result = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: {'teamGroups': legacy},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )
        second = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: {'teamGroups': {'version': 1, 'groups': [], 'defaultGroupId': ''}},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        self.assertEqual(result['groups'][0]['id'], 'platform')
        self.assertEqual(result['configRevision'], 1)
        self.assertEqual(result['source'], 'workspace_db')
        self.assertEqual(second['groups'][0]['id'], 'platform')

    def test_existing_legacy_row_without_ad_hoc_field_normalizes_to_empty(self):
        with self.factory() as session:
            session.add(models.WorkspaceGroupConfig(
                workspace_id=self.workspace_id,
                payload_version=1,
                payload={
                    'version': 1,
                    'groups': [{
                        'id': 'platform',
                        'name': 'Platform',
                        'teamIds': ['team-a'],
                        'excludedCapacityEpics': ['ENG-1'],
                    }],
                    'defaultGroupId': 'platform',
                    'configRevision': 1,
                },
                config_revision=1,
                created_by=self.user_id,
                updated_by=self.user_id,
            ))
            session.commit()

        loaded = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: None,
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        self.assertEqual(loaded['groups'][0]['id'], 'platform')
        self.assertEqual(loaded['groups'][0]['adHocCapacityEpics'], [])
        self.assertEqual(loaded['groups'][0]['excludedCapacityEpics'], ['ENG-1'])

    def test_save_rejects_stale_base_revision(self):
        loaded = service.load_shared_groups(
            self.context,
            fallback_loader=lambda: {'teamGroups': self._groups()},
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )
        first = service.save_shared_groups(
            self.context,
            self._groups(),
            base_revision=loaded['configRevision'],
            validate_groups_config_fn=validate_groups_config,
            database_url=self.database_url,
        )

        with self.assertRaises(service.GroupConfigConflict) as raised:
            service.save_shared_groups(
                self.other_context,
                {
                    'version': 1,
                    'groups': [{'id': 'mobile', 'name': 'Mobile', 'teamIds': ['team-m']}],
                    'defaultGroupId': 'mobile',
                },
                base_revision=loaded['configRevision'],
                validate_groups_config_fn=validate_groups_config,
                database_url=self.database_url,
            )

        self.assertEqual(raised.exception.current['configRevision'], first['configRevision'])

    def test_preferences_filter_unknown_groups_and_keep_default_visible(self):
        preferences = service.normalize_group_preferences(
            {'visibleGroupIds': ['platform', 'missing'], 'activeGroupId': 'missing', 'customized': True},
            self._groups(),
        )

        self.assertEqual(preferences['visibleGroupIds'], ['platform'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], ['default', 'platform'])
        self.assertEqual(preferences['activeGroupId'], 'default')

    def test_missing_db_preferences_require_first_run_selection(self):
        preferences = service.normalize_group_preferences(
            {},
            self._groups(),
            preference_exists=False,
            require_first_run=True,
        )

        self.assertFalse(preferences['customized'])
        self.assertFalse(preferences['preferenceExists'])
        self.assertTrue(preferences['onboardingRequired'])
        self.assertEqual(preferences['visibleGroupIds'], [])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], [])

    def test_missing_db_preferences_require_first_run_even_before_groups_exist(self):
        preferences = service.normalize_group_preferences(
            {},
            {'version': 1, 'groups': [], 'defaultGroupId': ''},
            preference_exists=False,
            require_first_run=True,
        )

        self.assertTrue(preferences['onboardingRequired'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], [])

    def test_existing_preferences_reopen_onboarding_when_visible_groups_are_deleted(self):
        preferences = service.normalize_group_preferences(
            {'visibleGroupIds': ['deleted'], 'activeGroupId': 'deleted', 'customized': True},
            self._groups(),
            preference_exists=True,
            require_first_run=False,
        )

        self.assertTrue(preferences['onboardingRequired'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], [])
        self.assertIsNone(preferences['activeGroupId'])

    def test_missing_json_preferences_keep_browser_local_all_visible(self):
        preferences = service.normalize_group_preferences(
            {},
            self._groups(),
            preference_exists=False,
            require_first_run=False,
        )

        self.assertFalse(preferences['customized'])
        self.assertFalse(preferences['onboardingRequired'])
        self.assertEqual(preferences['effectiveVisibleGroupIds'], ['default', 'platform'])


if __name__ == '__main__':
    unittest.main()
