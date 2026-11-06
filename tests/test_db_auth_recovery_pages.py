import os
import unittest

from unittest.mock import patch

from backend.db import engine as db_engine
from backend.db import models
import jira_server
from tests.db_oauth_test_helpers import seed_db_actor
from tests.oauth_test_helpers import install_oauth_session
from tests.postgres_test_db import fresh_database_url


class DbAuthRecoveryPagesTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()
        self.database_url = fresh_database_url(self.addCleanup)
        environment = self._env_patch()
        environment.start()
        self.addCleanup(environment.stop)
        auth_mode = patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth')
        auth_mode.start()
        self.addCleanup(auth_mode.stop)
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

    def _seed_user(self, *, account_id, account_type, user_status='active', connection_status='active'):
        with self.factory() as session:
            actor = seed_db_actor(session,
                workspace={'cloud_id': 'cloud-123', 'site_url': 'https://example.atlassian.net'},
                account_identity=account_id,
                roles=('admin',) if account_type == 'admin' else ())
            session.get(models.User, actor.user_id).status = user_status
            session.get(models.AuthConnection, actor.connection_id).status = connection_status
            session.commit()
            return actor.workspace_id, actor.user_id, actor.connection_id

    def _install_session(self, *, account_id, connection_id):
        install_oauth_session(self.client, db_auth_connection_id=connection_id)

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
