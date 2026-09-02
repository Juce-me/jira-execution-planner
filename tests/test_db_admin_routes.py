import base64
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.auth.key_provider import key_provider_from_env
from backend.auth.service_integrations import seed_service_integration
from backend.db import engine as db_engine
from backend.db import models
import jira_server


FULL_SCOPE = (
    'read:me read:jira-work write:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


class DbAdminRoutesTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'admin-routes.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([14]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })
        self.workspace_id, self.admin_user_id, self.admin_connection_id = self._seed_user(
            account_id='admin-account',
            account_type='admin',
        )
        _, self.normal_user_id, self.normal_connection_id = self._seed_user(
            account_id='normal-account',
            account_type='user',
        )
        with self.factory() as session:
            seed_service_integration(
                session,
                workspace_id=self.workspace_id,
                provider='home_townsquare_basic',
                credential_subject='svc-home@example.com',
                api_token='service-token-123',
                actor_user_id=self.admin_user_id,
                key_provider=self.key_provider,
            )
            session.add(models.audit_event(
                workspace_id=self.workspace_id,
                actor_user_id=self.admin_user_id,
                target_user_id=self.normal_user_id,
                event_type='user_status_checked',
                metadata={
                    'api_token': 'service-token-123',
                    'callbackUrl': 'http://localhost:5050/api/auth/atlassian/callback?state=abc&code=secret',
                },
            ))
            session.commit()

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_user(self, *, account_id, account_type):
        with self.factory() as session:
            workspace = session.query(models.Workspace).first()
            if workspace is None:
                workspace = models.Workspace(
                    environment_key='local',
                    name='Example',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-123',
                    created_by='test',
                )
                session.add(workspace)
                session.flush()
            user = models.User(
                external_provider='atlassian',
                external_subject=account_id,
                email=f'{account_id}@example.com',
                display_name=f'{account_id} User',
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
                site_url='https://example.atlassian.net',
                cloud_id='cloud-123',
                scopes=FULL_SCOPE.split(),
                scope_provenance='provider',
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.flush()
            session.add(models.JiraProjectAccess(
                connection_id=connection.id,
                workspace_id=workspace.id,
                project_key='ABC',
                project_type='product',
                status='accessible',
                checked_at=datetime.now(timezone.utc),
            ))
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, *, account_id, connection_id):
        session_id = f'session-{account_id}'
        with self.client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': connection_id,
                'db_token_version': '1',
            }
        jira_server.OAUTH_TOKEN_STORE[session_id] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 3600,
            'scope': FULL_SCOPE,
            'cloudid': 'cloud-123',
            'site_url': 'https://example.atlassian.net',
            'site_name': 'Example',
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
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([14]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }, clear=False)

    def _csrf_headers(self):
        response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return {
            'X-Requested-With': 'jira-execution-planner',
            'X-CSRF-Token': response.get_json()['csrfToken'],
        }

    def test_admin_can_list_users_without_token_material(self):
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/users')

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(len(body['users']), 2)
        self.assertIn('authConnections', body['users'][0])
        self.assertNotIn('apiToken', str(body))
        self.assertNotIn('service-token-123', str(body))
        self.assertNotIn('refresh-123', str(body))

    def test_non_admin_cannot_read_admin_users(self):
        self._install_session(account_id='normal-account', connection_id=self.normal_connection_id)

        with self._env_patch(), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True):
            response = self.client.get('/api/admin/users')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'admin_required')

    def test_non_admin_can_list_and_grant_admin_when_admin_only_disabled(self):
        self._install_session(account_id='normal-account', connection_id=self.normal_connection_id)

        with self._env_patch(), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', False):
            list_response = self.client.get('/api/admin/users')
            grant_response = self.client.post(
                f'/api/admin/users/{self.normal_user_id}/admin-grant',
                headers=self._csrf_headers(),
            )

        self.assertEqual(list_response.status_code, 200, list_response.get_data(as_text=True))
        self.assertEqual(grant_response.status_code, 200, grant_response.get_data(as_text=True))
        granted_user = grant_response.get_json()['user']
        self.assertEqual(granted_user['externalSubject'], 'normal-account')
        self.assertEqual(granted_user['accountType'], 'admin')

    def test_admin_audit_events_are_redacted(self):
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/audit-events')

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body['events'][0]['metadata']['api_token'], '[redacted]')
        self.assertEqual(
            body['events'][0]['metadata']['callbackUrl'],
            'http://localhost:5050/api/auth/atlassian/callback',
        )

    def test_admin_can_read_service_integrations_without_token_material(self):
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/service-integrations')

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body['serviceIntegrations'][0]['credentialSubject'], 'svc-home@example.com')
        self.assertNotIn('apiToken', str(body))
        self.assertNotIn('ciphertext', str(body))
        self.assertNotIn('service-token-123', str(body))

    def test_admin_mutation_requires_csrf_token(self):
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.patch(
                f'/api/admin/users/{self.normal_user_id}/status',
                json={'status': 'disabled'},
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_shared_admin_routes_thread_revision_and_return_exact_conflict(self):
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)
        routes = [
            ('/api/projects/selected', {'selected': [{'key': 'ABC', 'type': 'product'}]}),
            ('/api/board-config', {'boardId': '7', 'boardName': 'Planning'}),
            ('/api/capacity/config', {'project': 'ABC', 'fieldId': 'customfield_1', 'fieldName': 'Capacity'}),
            ('/api/sprint-field/config', {'fieldId': 'customfield_2', 'fieldName': 'Sprint'}),
            ('/api/story-points-field/config', {'fieldId': 'customfield_3', 'fieldName': 'Points'}),
            ('/api/parent-name-field/config', {'fieldId': 'customfield_4', 'fieldName': 'Parent'}),
            ('/api/team-field/config', {'fieldId': 'customfield_5', 'fieldName': 'Team'}),
            ('/api/delivery-owner-field/config', {'fieldId': 'customfield_6', 'fieldName': 'Owner'}),
            ('/api/stats/priority-weights-config', {'weights': []}),
            ('/api/issue-types/config', {'issueTypes': ['Story']}),
        ]
        revision = 0
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=[{
                 'id': 'customfield_1', 'name': 'Capacity', 'schema': {'type': 'number'},
             }]):
            for route, body in routes:
                headers = self._csrf_headers()
                response = self.client.post(route, json={**body, 'baseRevision': revision}, headers=headers)
                self.assertEqual(response.status_code, 200, f'{route}: {response.get_data(as_text=True)}')
                revision += 1
                self.assertEqual(response.get_json()['configRevision'], revision)

            conflict = self.client.post(
                '/api/board-config',
                json={'boardId': '8', 'boardName': 'Stale', 'baseRevision': revision - 1},
                headers=self._csrf_headers(),
            )
            bootstrap = self.client.get('/api/config?includeViewConfig=true')

        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.get_json(), {
            'error': 'workspace_config_conflict',
            'message': 'Shared settings changed while you were editing. Your changes are still unsaved.',
            'currentRevision': revision,
            'current': {
                'section': 'board',
                'value': {'boardId': '7', 'boardName': 'Planning'},
                'configRevision': revision,
            },
        })
        self.assertEqual(bootstrap.status_code, 200)
        self.assertEqual(bootstrap.get_json()['sharedConfigRevision'], revision)
        self.assertEqual(bootstrap.get_json()['sharedConfig']['board']['boardId'], '7')

    def test_db_shared_admin_routes_reject_raw_values_before_revision_write(self):
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)
        cases = (
            ('/api/projects/selected', {
                'selected': [{'key': 'ABC', 'type': 'product', 'workspaceId': 'claimed'}],
            }),
            ('/api/sprint-field/config', {
                'fieldId': {'value': 'customfield_2'}, 'fieldName': 'Sprint',
            }),
            ('/api/issue-types/config', {'issueTypes': ['Story', {'name': 'Bug'}]}),
            ('/api/stats/priority-weights-config', {
                'weights': [{'priority': 'High', 'weight': 1, 'unexpected': 'value'}],
            }),
        )

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for route, body in cases:
                with self.subTest(route=route):
                    response = self.client.post(
                        route,
                        json={**body, 'baseRevision': 0},
                        headers=self._csrf_headers(),
                    )
                    self.assertEqual(response.status_code, 400, response.get_data(as_text=True))

            snapshot = self.client.get('/api/config?includeViewConfig=true')

        self.assertEqual(snapshot.status_code, 200, snapshot.get_data(as_text=True))
        self.assertEqual(snapshot.get_json()['sharedConfigRevision'], 0)


if __name__ == '__main__':
    unittest.main()
