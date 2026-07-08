import base64
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


class CsrfTokenBoundTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'csrf.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.client = jira_server.app.test_client()
        self.other_client = jira_server.app.test_client()
        self.workspace_id, self.admin_user_id, self.admin_connection_id = self._seed_user(
            account_id='admin-account',
            account_type='admin',
        )
        _, self.normal_user_id, _ = self._seed_user(
            account_id='normal-account',
            account_type='user',
        )

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
            session.commit()
            return workspace.id, user.id, connection.id

    def _install_session(self, client, *, session_id, account_id, connection_id):
        with client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': connection_id,
                'db_token_version': '1',
            }

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([15]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }, clear=False)

    def _issue_token(self, client=None):
        target = client or self.client
        response = target.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        token = response.get_json()['csrfToken']
        self.assertNotIn('access-123', token)
        self.assertNotIn('refresh-123', token)
        return token

    def _patch_status(self, token=None, client=None):
        headers = {'X-Requested-With': 'jira-execution-planner'}
        if token is not None:
            headers['X-CSRF-Token'] = token
        return (client or self.client).patch(
            f'/api/admin/users/{self.normal_user_id}/status',
            json={'status': 'disabled'},
            headers=headers,
        )

    def test_missing_wrong_reused_and_cross_session_tokens_are_rejected(self):
        self._install_session(
            self.client,
            session_id='session-admin',
            account_id='admin-account',
            connection_id=self.admin_connection_id,
        )
        self._install_session(
            self.other_client,
            session_id='session-admin-other',
            account_id='admin-account',
            connection_id=self.admin_connection_id,
        )

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            self.assertEqual(self._patch_status().status_code, 403)
            wrong = self._patch_status(token='wrong-token')
            self.assertEqual(wrong.status_code, 403)
            token = self._issue_token()
            cross_session = self._patch_status(token=token, client=self.other_client)
            self.assertEqual(cross_session.status_code, 403)

            valid = self._patch_status(token=token)
            self.assertEqual(valid.status_code, 200, valid.get_data(as_text=True))
            reused = self._patch_status(token=token)
            self.assertEqual(reused.status_code, 403)

        with self.factory() as session:
            user = session.get(models.User, self.normal_user_id)
        self.assertEqual(user.status, 'disabled')
        self.assertEqual(wrong.get_json()['error'], 'csrf_required')
        self.assertEqual(cross_session.get_json()['error'], 'csrf_required')
        self.assertEqual(reused.get_json()['error'], 'csrf_required')

    def test_db_oauth_csrf_succeeds_without_local_oauth_session(self):
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = {
                'db_auth_connection_id': self.admin_connection_id,
                'db_token_version': '1',
            }

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/csrf')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIn('csrfToken', response.get_json())


if __name__ == '__main__':
    unittest.main()
