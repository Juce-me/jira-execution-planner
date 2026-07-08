import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
import jira_server


FULL_SCOPE = (
    'read:me read:jira-work write:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


class UserViewConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'user-views.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.user_id, self.connection_id = self._seed_user('normal-account', 'user')
        _, self.other_user_id, self.other_connection_id = self._seed_user('other-account', 'user')
        self._install_session(self.client, 'session-normal', 'normal-account', self.connection_id)

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_user(self, account_id, account_type):
        with self.factory() as session:
            workspace = session.query(models.Workspace).first()
            if workspace is None:
                workspace = models.Workspace(
                    environment_key='local',
                    name='Local',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                )
                session.add(workspace)
                session.flush()
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                account_type=account_type,
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
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.flush()
            session.add(models.JiraProjectAccess(
                connection_id=connection.id,
                workspace_id=workspace.id,
                project_key='PROD',
                project_type='product',
                status='accessible',
                checked_at=datetime.now(timezone.utc),
            ))
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, client, session_id, account_id, connection_id):
        with client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': connection_id,
                'db_token_version': '1',
            }
        jira_server.OAUTH_TOKEN_STORE[session_id] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 3600,
            'scope': FULL_SCOPE,
            'cloudid': 'cloud-1',
            'site_url': 'https://example.atlassian.net',
            'account_id': account_id,
            'account_status': 'active',
            'db_auth_connection_id': connection_id,
            'db_token_version': '1',
            'stored_at': time.time(),
        }

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

    def _post_view(self, payload, *, headers=None):
        with self._env_patch(), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'fetch_epm_home_projects', return_value=[
                 {'homeProjectId': 'home-1', 'id': 'home-1', 'name': 'Synthetic Project'},
             ]):
            return self.client.post('/api/me/views', json=payload, headers=headers or self._csrf_headers())

    def test_normal_user_can_save_private_eng_epm_and_mixed_views(self):
        view_payloads = [
            {
                'name': 'ENG view',
                'viewType': 'eng',
                'view': {'filters': {'projectKeys': ['PROD']}, 'eng': {'mode': 'planning'}},
                'isDefault': True,
            },
            {
                'name': 'EPM view',
                'viewType': 'epm',
                'view': {
                    'filters': {'projectKeys': ['PROD']},
                    'epm': {
                        'tab': 'active',
                        'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-2']},
                        'labelPrefix': 'rnd_project_*',
                        'selectedSprint': 'Active',
                        'projects': {
                            'home-1': {
                                'homeProjectId': 'home-1',
                                'name': 'Synthetic Project',
                                'label': 'rnd_project_synthetic',
                            },
                        },
                        'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
                    },
                },
            },
            {
                'name': 'Mixed view',
                'viewType': 'mixed',
                'view': {'filters': {'projectKeys': ['PROD']}, 'eng': {}, 'epm': {'tab': 'active'}},
            },
        ]

        created = [self._post_view(payload) for payload in view_payloads]

        self.assertEqual([response.status_code for response in created], [201, 201, 201])
        self.assertEqual(created[1].get_json()['view']['view']['epm']['projects']['home-1']['label'], 'rnd_project_synthetic')
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            list_response = self.client.get('/api/me/views')
        self.assertEqual(list_response.status_code, 200, list_response.get_data(as_text=True))
        self.assertEqual(len(list_response.get_json()['views']), 3)

    def test_unsafe_saved_view_write_requires_token_bound_csrf(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/me/views',
                json={'name': 'Missing CSRF', 'viewType': 'eng', 'view': {'eng': {}}},
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_user_cannot_patch_another_users_view(self):
        with self.factory() as session:
            view = models.ViewConfig(
                workspace_id=self.workspace_id,
                owner_user_id=self.other_user_id,
                name='Other view',
                view_type='eng',
                payload={'eng': {}},
                is_default=True,
            )
            session.add(view)
            session.commit()
            view_id = view.id

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.patch(
                f'/api/me/views/{view_id}',
                json={'name': 'Nope'},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error'], 'view_not_found')

    def test_rejects_inaccessible_jira_project_reference(self):
        response = self._post_view({
            'name': 'Bad project',
            'viewType': 'eng',
            'view': {'filters': {'projectKeys': ['SECRET']}, 'eng': {}},
        })

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'project_access_denied')

    def test_rejects_unknown_home_project_reference(self):
        response = self._post_view({
            'name': 'Bad Home project',
            'viewType': 'epm',
            'view': {
                'filters': {'projectKeys': ['PROD']},
                'epm': {
                    'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['GOAL-2']},
                    'projects': {
                        'missing-home': {
                            'homeProjectId': 'missing-home',
                            'name': 'Missing Home Project',
                            'label': 'rnd_project_missing',
                        },
                    },
                },
            },
        })

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'home_project_not_found')

    def test_allows_custom_epm_project_row_without_home_reference(self):
        response = self._post_view({
            'name': 'Custom EPM project',
            'viewType': 'epm',
            'view': {
                'filters': {'projectKeys': ['PROD']},
                'epm': {
                    'projects': {
                        'draft-1': {
                            'homeProjectId': '',
                            'name': 'Manual project',
                            'label': 'rnd_project_manual',
                        },
                    },
                },
            },
        })

        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))

    def test_normal_user_cannot_save_shared_epm_config_without_admin_role(self):
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/epm/config',
                json={'version': 2, 'tab': 'active', 'projects': {}},
                headers=self._csrf_headers(),
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'admin_required')

    def test_normal_user_config_reports_epm_edit_permission_without_admin_role(self):
        with self._env_patch(), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'get_board_config', return_value={}), \
             patch.object(jira_server, 'get_effective_capacity_project', return_value=''), \
             patch.object(jira_server, 'resolve_groups_config_path', return_value='team-groups.json'), \
             patch.object(jira_server, 'get_selected_projects', return_value=[]):
            response = self.client.get('/api/config')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertFalse(body['userCanEditSettings'])
        self.assertFalse(body['userCanEditEpmConfig'])

    def test_default_route_returns_resolved_default_view(self):
        create_response = self._post_view({
            'name': 'Default EPM',
            'viewType': 'epm',
            'view': {'filters': {'projectKeys': ['PROD']}, 'epm': {'tab': 'active'}},
            'isDefault': True,
        })
        self.assertEqual(create_response.status_code, 201, create_response.get_data(as_text=True))

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/me/views/default')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['source'], 'user_saved_view')
        self.assertEqual(body['viewType'], 'epm')
        self.assertEqual(body['workspaceId'], self.workspace_id)


if __name__ == '__main__':
    unittest.main()
