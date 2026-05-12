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
    'read:me read:jira-work read:jira-user '
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
            flask_session['atlassian_oauth_session_id'] = session_id
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

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/users')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'admin_required')

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


if __name__ == '__main__':
    unittest.main()
