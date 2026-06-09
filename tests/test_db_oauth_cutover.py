import base64
import os
import tempfile
import time
import unittest
from types import SimpleNamespace
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

    def _store_callback_through_route(self):
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
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', False), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token_data), \
             patch.object(jira_server, 'fetch_current_user', return_value=user_profile), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]):
            response = self.client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
        with self.factory() as session:
            connection = session.query(models.AuthConnection).one()
            return SimpleNamespace(
                connection_id=connection.id,
                token_version=str(connection.token_version),
            )

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

    def test_callback_persists_requested_scopes_when_provider_omits_scope(self):
        with self.factory() as session:
            result = store_oauth_callback_tokens(
                session,
                token_data={
                    'access_token': 'access-123',
                    'refresh_token': 'refresh-123',
                    'expires_in': 3600,
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
                requested_scopes=jira_server.ATLASSIAN_SCOPES,
            )
            session.commit()

        with self.factory() as session:
            connection = session.get(models.AuthConnection, result.connection_id)

        self.assertEqual(connection.scopes, jira_server.ATLASSIAN_SCOPES.split())

    def test_current_request_context_prefers_db_connection_metadata(self):
        result = self._store_callback()
        with jira_server.app.test_request_context('/'):
            jira_server.session['db_oauth_session'] = {
                'db_auth_connection_id': result.connection_id,
                'db_token_version': result.session_metadata['db_token_version'],
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

    def test_oauth_callback_writes_db_rows_while_storing_db_browser_session(self):
        result = self._store_callback_through_route()
        with self.client.session_transaction() as session:
            self.assertEqual(session['db_oauth_session']['db_auth_connection_id'], result.connection_id)
            self.assertEqual(session['db_oauth_session']['db_token_version'], result.token_version)
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})

        with self.factory() as session:
            user_count = session.query(models.User).count()
            token_count = session.query(models.AuthToken).count()
        self.assertEqual(user_count, 1)
        self.assertEqual(token_count, 2)

    def test_db_oauth_callback_stores_db_session_without_local_token_store(self):
        result = self._store_callback_through_route()

        with self.client.session_transaction() as session:
            self.assertIn('db_oauth_session', session)
            self.assertEqual(session['db_oauth_session']['db_auth_connection_id'], result.connection_id)
            self.assertIn('db_token_version', session['db_oauth_session'])
            self.assertNotIn('atlassian_oauth_session_id', session)

        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})

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

    def test_auth_status_uses_signed_db_session_without_local_token_store(self):
        result = self._store_callback()
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = {
                'db_auth_connection_id': result.connection_id,
                'db_token_version': result.session_metadata['db_token_version'],
            }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'ATLASSIAN_SCOPES', jira_server.ATLASSIAN_SCOPES):
            response = self.client.get('/api/auth/status')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['authenticated'])
        self.assertFalse(payload['loginRequired'])
        self.assertEqual(payload['siteUrl'], 'https://example.atlassian.net')
        self.assertNotIn('access-123', str(payload))
        self.assertNotIn('refresh-123', str(payload))

    def test_auth_status_uses_stale_db_token_version_recovery_path(self):
        result = self._store_callback()
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = {
                'db_auth_connection_id': result.connection_id,
                'db_token_version': '0',
            }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'ATLASSIAN_SCOPES', jira_server.ATLASSIAN_SCOPES):
            response = self.client.get('/api/auth/status')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['authenticated'])
        self.assertTrue(payload['loginRequired'])
        self.assertEqual(payload['recoveryUrl'], '/auth/reconnect')

    def test_dashboard_entry_allows_signed_db_session_without_local_token_store(self):
        result = self._store_callback()
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = {
                'db_auth_connection_id': result.connection_id,
                'db_token_version': result.session_metadata['db_token_version'],
            }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'ATLASSIAN_SCOPES', jira_server.ATLASSIAN_SCOPES):
            response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertIn('Jira Execution Planner', response.get_data(as_text=True))
        self.assertNotIn('/login', response.headers.get('Location', ''))

    def test_auth_refresh_uses_database_token_without_local_token_store(self):
        result = self._store_callback()
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = {
                'db_auth_connection_id': result.connection_id,
                'db_token_version': result.session_metadata['db_token_version'],
            }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([7]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('fresh DB token should not refresh')):
            response = self.client.post(
                '/api/auth/refresh',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['authenticated'])
        self.assertFalse(payload['loginRequired'])
        self.assertEqual(payload['siteUrl'], 'https://example.atlassian.net')
        self.assertNotIn('access-123', str(payload))
        self.assertNotIn('refresh-123', str(payload))

    def test_dev_home_graphql_probe_uses_db_session_without_local_token_store(self):
        result = self._store_callback()
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = {
                'db_auth_connection_id': result.connection_id,
                'db_token_version': result.session_metadata['db_token_version'],
            }

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([7]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
            'ALLOW_DEV_DIAGNOSTIC_ENDPOINTS': 'true',
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'get_epm_config', return_value={
                 'scope': {
                     'rootGoalKey': 'ROOT-1',
                     'subGoalKey': 'SUB-1',
                 },
             }), patch('backend.routes.auth_routes.epm_home.run_home_graphql_oauth_probe', return_value={
                 'ok': True,
             }) as run_probe:
            response = self.client.get('/api/auth/dev/home-graphql-oauth-probe')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        run_probe.assert_called_once()
        self.assertEqual(run_probe.call_args.args[0], 'access-123')
        self.assertEqual(run_probe.call_args.args[1], 'cloud-123')
        with self.client.session_transaction() as session:
            self.assertIn('db_oauth_session', session)
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})


if __name__ == '__main__':
    unittest.main()
