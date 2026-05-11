import base64
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import decrypt_token
from backend.auth.db_tokens import store_oauth_callback_tokens
from backend.db import engine as db_engine
from backend.db import models
import jira_server


class DbOauthCutoverTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'oauth-cutover.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.client = jira_server.app.test_client()
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([7]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _store_callback(self):
        with self.factory() as session:
            result = store_oauth_callback_tokens(
                session,
                token_data={
                    'access_token': 'access-123',
                    'refresh_token': 'refresh-123',
                    'expires_in': 3600,
                    'scope': jira_server.ATLASSIAN_SCOPES,
                },
                resource={
                    'id': 'cloud-123',
                    'url': 'https://example.atlassian.net/',
                    'name': 'Example Jira',
                },
                user_profile={
                    'account_id': 'account-123',
                    'account_status': 'active',
                    'email': 'user@example.com',
                    'display_name': 'User Example',
                },
                environment_key='local',
                configured_jira_url='https://example.atlassian.net',
                key_provider=self.key_provider,
            )
            session.commit()
            return result

    def test_callback_writes_encrypted_db_tokens_and_returns_session_metadata(self):
        result = self._store_callback()

        self.assertIn('db_user_id', result.session_metadata)
        self.assertIn('db_workspace_id', result.session_metadata)
        self.assertIn('db_auth_connection_id', result.session_metadata)
        self.assertEqual(result.session_metadata['db_token_version'], '1')

        with self.factory() as session:
            connection = session.get(models.AuthConnection, result.connection_id)
            tokens = session.query(models.AuthToken).filter_by(connection_id=result.connection_id).all()

        self.assertEqual(connection.user_id, result.user_id)
        self.assertEqual({token.token_kind for token in tokens}, {'access_token', 'refresh_token'})
        for token in tokens:
            self.assertNotIn('access-123', token.ciphertext)
            self.assertNotIn('refresh-123', token.ciphertext)
            decrypted = decrypt_token(
                {
                    'algorithm': token.algorithm,
                    'ciphertext': token.ciphertext,
                    'nonce': token.nonce,
                    'wrapped_dek': token.wrapped_dek,
                    'key_id': token.key_id,
                    'aad_hash': token.aad_hash,
                },
                workspace_id=result.workspace_id,
                auth_connection_id=result.connection_id,
                token_kind=token.token_kind,
                key_provider=self.key_provider,
            )
            self.assertIn(decrypted, {'access-123', 'refresh-123'})

    def test_current_request_context_prefers_db_connection_metadata(self):
        result = self._store_callback()
        with jira_server.app.test_request_context('/'):
            jira_server.session['atlassian_oauth_session_id'] = 'session-1'
            jira_server.OAUTH_TOKEN_STORE['session-1'] = {
                'access_token': 'access-123',
                'refresh_token': 'refresh-123',
                'expires_at': time.time() + 600,
                'cloudid': 'cloud-123',
                'site_url': 'https://example.atlassian.net',
                'account_id': 'account-123',
                'account_status': 'active',
                'stored_at': time.time(),
                **result.session_metadata,
            }
            with patch.dict(os.environ, {
                'CONFIG_STORAGE_BACKEND': 'db',
                'DATABASE_URL': self.database_url,
            }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                 patch.object(jira_server, 'ATLASSIAN_SCOPES', jira_server.ATLASSIAN_SCOPES):
                context = jira_server.current_request_auth_context()

        self.assertEqual(context.user_id, result.user_id)
        self.assertEqual(context.auth_connection_id, result.connection_id)
        self.assertEqual(context.workspace_id, result.workspace_id)

    def test_oauth_callback_writes_db_rows_while_updating_local_store(self):
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'
        token_data = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_in': 3600,
            'scope': jira_server.ATLASSIAN_SCOPES,
        }
        user_profile = {
            'account_id': 'account-123',
            'account_status': 'active',
            'email': 'user@example.com',
            'display_name': 'User Example',
        }
        resource = {
            'id': 'cloud-123',
            'url': 'https://example.atlassian.net/',
            'name': 'Example Jira',
        }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([7]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token_data), \
             patch.object(jira_server, 'fetch_current_user', return_value=user_profile), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]):
            response = self.client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 302)
        with self.client.session_transaction() as session:
            session_id = session.get('atlassian_oauth_session_id')
        stored = jira_server.OAUTH_TOKEN_STORE[session_id]
        self.assertEqual(stored['access_token'], 'access-123')
        self.assertIn('db_auth_connection_id', stored)
        self.assertIn('db_token_version', stored)

        with self.factory() as session:
            user_count = session.query(models.User).count()
            token_count = session.query(models.AuthToken).count()
        self.assertEqual(user_count, 1)
        self.assertEqual(token_count, 2)

    def test_db_mode_session_data_reads_database_tokens_not_local_store(self):
        result = self._store_callback()
        context = jira_server.RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=result.user_id,
            stable_subject='account-123',
            atlassian_account_id='account-123',
            workspace_id=result.workspace_id,
            auth_connection_id=result.connection_id,
            cloud_id='cloud-123',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )
        with jira_server.app.test_request_context('/'):
            jira_server.OAUTH_TOKEN_STORE['session-1'] = {
                'access_token': 'expired-access',
                'refresh_token': 'refresh-123',
                'expires_at': time.time() - 60,
                'cloudid': 'cloud-123',
                'site_url': 'https://example.atlassian.net',
                'stored_at': time.time(),
                **result.session_metadata,
            }
            with patch.dict(os.environ, {
                'DATABASE_URL': self.database_url,
                'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([7]) * 32).decode('ascii'),
                'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
            }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
                data = jira_server.current_jira_session_data(context)

        self.assertEqual(data['access_token'], 'access-123')
        self.assertNotEqual(data['access_token'], 'expired-access')


if __name__ == '__main__':
    unittest.main()
