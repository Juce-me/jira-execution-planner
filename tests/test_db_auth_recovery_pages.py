import os
import tempfile
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


class DbAuthRecoveryPagesTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.client = jira_server.app.test_client()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'recovery.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.workspace_id, self.admin_user_id, self.admin_connection_id = self._seed_user(
            account_id='admin-account',
            account_type='admin',
        )
        _, self.normal_user_id, self.normal_connection_id = self._seed_user(
            account_id='normal-account',
            account_type='user',
        )

    def tearDown(self):
        db_engine.dispose_engines()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir.cleanup()

    def _seed_user(self, *, account_id, account_type, user_status='active', connection_status='active'):
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
                status=user_status,
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
                status=connection_status,
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, *, account_id, connection_id):
        with self.client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': connection_id,
                'db_token_version': '1',
            }

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False)

    def test_recovery_pages_are_visible_html_without_token_material(self):
        pages = {
            '/auth/account-disabled': 'Account disabled',
            '/auth/reconnect': 'Reconnect Jira',
            '/auth/missing-project-access': 'Project access required',
            '/auth/admin-required': 'Tool admin access required',
            '/auth/service-credentials': 'Service credentials',
        }

        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for path, expected in pages.items():
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('text/html', response.headers['Content-Type'])
                    body = response.get_data(as_text=True)
                    self.assertIn(expected, body)
                    self.assertNotIn('access-123', body)
                    self.assertNotIn('refresh-123', body)

    def test_disabled_user_api_response_links_visible_recovery_page(self):
        with self.factory() as session:
            admin = session.get(models.User, self.admin_user_id)
            admin.status = 'disabled'
            session.commit()
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/users')

        self.assertEqual(response.status_code, 401)
        body = response.get_json()
        self.assertEqual(body['error'], 'account_disabled')
        self.assertEqual(body['recoveryUrl'], '/auth/account-disabled')

    def test_revoked_connection_api_response_links_reconnect_page(self):
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.admin_connection_id)
            connection.status = 'revoked'
            session.commit()
        self._install_session(account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/users')

        self.assertEqual(response.status_code, 401)
        body = response.get_json()
        self.assertEqual(body['error'], 'auth_connection_revoked')
        self.assertEqual(body['recoveryUrl'], '/auth/reconnect')

    def test_reconnect_page_does_not_force_consent(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/auth/reconnect')

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('/api/auth/atlassian/login', body)
        self.assertNotIn('prompt=consent', body)

    def test_non_admin_api_response_links_admin_denial_page(self):
        self._install_session(account_id='normal-account', connection_id=self.normal_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/admin/users')

        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body['error'], 'admin_required')
        self.assertEqual(body['recoveryUrl'], '/auth/admin-required')


if __name__ == '__main__':
    unittest.main()
