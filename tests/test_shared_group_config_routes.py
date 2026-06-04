import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session


class SharedGroupConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'shared-groups-routes.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.connection_id = self._seed_user('account-1')
        _, self.other_user_id, self.other_connection_id = self._seed_user('account-2')
        self._install_session('session-1', 'account-1', self.connection_id)

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_user(self, account_id, *, site_url='https://example.atlassian.net', cloud_id='cloud-1'):
        with self.factory() as session:
            workspace = session.query(models.Workspace).filter_by(jira_cloud_id=cloud_id).first()
            if workspace is None:
                workspace = models.Workspace(
                    environment_key='local',
                    name=f'Workspace {cloud_id}',
                    jira_site_url=site_url,
                    jira_cloud_id=cloud_id,
                    created_by='test',
                )
                session.add(workspace)
                session.flush()
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add(user)
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                scopes=FULL_OAUTH_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, session_id, account_id, connection_id, *, site_url='https://example.atlassian.net', cloud_id='cloud-1'):
        install_oauth_session(
            self.client,
            session_id=session_id,
            account_id=account_id,
            site_url=site_url,
            cloudid=cloud_id,
            db_auth_connection_id=connection_id,
            db_token_version='1',
            expires_at=time.time() + 3600,
        )

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False)

    def _csrf_headers(self):
        response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return {
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': response.get_json()['csrfToken'],
        }

    def _legacy_config(self):
        return {
            'version': 1,
            'teamGroups': {
                'version': 1,
                'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
                'defaultGroupId': 'platform',
            },
        }

    def _get_groups_config(self, *, fallback=None):
        fallback = self._legacy_config() if fallback is None else fallback
        with self._env_patch(), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'load_dashboard_config', return_value=fallback):
            return self.client.get('/api/groups-config')

    def test_get_groups_config_imports_shared_catalog_and_requires_first_run(self):
        first = self._get_groups_config()
        self._install_session('session-2', 'account-2', self.other_connection_id)
        second = self._get_groups_config(fallback={'version': 1})

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        first_json = first.get_json()
        second_json = second.get_json()
        self.assertEqual(first_json['source'], 'workspace_db')
        self.assertEqual(second_json['groups'], first_json['groups'])
        self.assertTrue(first_json['preferences']['onboardingRequired'])
        self.assertEqual(first_json['preferences']['effectiveVisibleGroupIds'], [])

    def test_post_groups_config_allows_user_write_and_rejects_stale_revision(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a', 'team-b']}],
            'defaultGroupId': 'platform',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            saved = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())
            stale = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json()['configRevision'], loaded['configRevision'] + 1)
        self.assertEqual(stale.status_code, 409, stale.get_data(as_text=True))
        self.assertEqual(stale.get_json()['error'], 'group_config_conflict')
        self.assertIn('current', stale.get_json())

    def test_post_groups_config_rejects_identity_spoofing_fields(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{'id': 'platform', 'name': 'Platform', 'teamIds': ['team-a']}],
            'defaultGroupId': 'platform',
            'workspaceId': 'other-workspace',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'unsupported_group_config_field')

    def test_post_groups_config_requires_explicit_clear_groups_for_final_delete(self):
        loaded = self._get_groups_config().get_json()
        payload = {'version': 1, 'baseRevision': loaded['configRevision'], 'groups': [], 'defaultGroupId': ''}
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            implicit = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())
            explicit = self.client.post(
                '/api/groups-config',
                json={**payload, 'clearGroups': True},
                headers=self._csrf_headers(),
            )

        self.assertEqual(implicit.status_code, 400, implicit.get_data(as_text=True))
        self.assertEqual(implicit.get_json()['error'], 'team_groups_cannot_be_cleared_implicitly')
        self.assertEqual(explicit.status_code, 200, explicit.get_data(as_text=True))

    def test_post_group_preferences_saves_user_visibility_without_catalog_change(self):
        before = self._get_groups_config().get_json()
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        after = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['preferences']['visibleGroupIds'], ['platform'])
        self.assertEqual(after['groups'], before['groups'])
        self.assertFalse(after['preferences']['onboardingRequired'])

    def test_post_group_preferences_rejects_json_mode_and_identity_spoofing_fields(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}, clear=False):
            json_mode = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            spoofed = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'workspaceId': 'other-workspace'},
                headers=self._csrf_headers(),
            )

        self.assertEqual(json_mode.status_code, 409, json_mode.get_data(as_text=True))
        self.assertEqual(json_mode.get_json()['error'], 'group_preferences_db_required')
        self.assertEqual(spoofed.status_code, 400, spoofed.get_data(as_text=True))
        self.assertEqual(spoofed.get_json()['error'], 'unsupported_group_preference_field')


if __name__ == '__main__':
    unittest.main()
