import base64
import os
import tempfile
import time
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy.exc import OperationalError

from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import decrypt_token
from backend.auth.db_browser_sessions import create_browser_session, resolve_browser_session
from backend.auth.db_tokens import store_oauth_callback_tokens
from backend.db import engine as db_engine
from backend.db import models
import jira_server


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


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

    @contextmanager
    def _db_route_mode(self):
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
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'):
            yield

    def _store_callback_through_route(
        self,
        *,
        client=None,
        access_token='access-123',
        refresh_token='refresh-123',
    ):
        client = client or self.client
        with client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'
        token_data = {
            'access_token': access_token,
            'refresh_token': refresh_token,
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

        with self._db_route_mode(), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token_data), \
             patch.object(jira_server, 'fetch_current_user', return_value=user_profile), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]):
            response = client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
        with client.session_transaction() as session:
            session_payload = dict(session['db_oauth_session'])
        with self.factory() as session:
            connection = session.query(models.AuthConnection).one()
            return SimpleNamespace(
                connection_id=connection.id,
                token_version=str(connection.token_version),
                browser_session_id=session_payload.get('db_browser_session_id'),
                session_payload=session_payload,
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

    def test_valid_legacy_cookie_is_replaced_with_opaque_browser_session(self):
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

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        with self.client.session_transaction() as session:
            payload = session['db_oauth_session']
        self.assertEqual(set(payload), {'db_browser_session_id'})
        browser_session_id = payload['db_browser_session_id']
        with self.factory() as session:
            handle = resolve_browser_session(session, browser_session_id)
        self.assertIsNotNone(handle)
        self.assertEqual(handle.auth_connection_id, result.connection_id)

    def test_legacy_cookie_upgrade_database_failure_keeps_valid_legacy_context(self):
        result = self._store_callback()
        legacy_payload = {
            'db_auth_connection_id': result.connection_id,
            'db_token_version': result.session_metadata['db_token_version'],
        }
        failure = OperationalError('insert browser session', {}, RuntimeError('disk I/O error'))

        with jira_server.app.test_request_context('/'):
            jira_server.session['db_oauth_session'] = legacy_payload
            with patch.dict(os.environ, {
                'CONFIG_STORAGE_BACKEND': 'db',
                'DATABASE_URL': self.database_url,
            }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                 patch.object(jira_server, 'session_scope', side_effect=failure):
                context = jira_server.current_request_auth_context()
                stored_payload = dict(jira_server.session['db_oauth_session'])

        self.assertEqual(context.auth_connection_id, result.connection_id)
        self.assertEqual(context.browser_session_id, '')
        self.assertEqual(stored_payload, legacy_payload)

    def test_stale_legacy_cookie_is_not_upgraded(self):
        result = self._store_callback()
        legacy_payload = {
            'db_auth_connection_id': result.connection_id,
            'db_token_version': '0',
        }
        with self.client.session_transaction() as session:
            session['db_oauth_session'] = legacy_payload

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'ATLASSIAN_SCOPES', jira_server.ATLASSIAN_SCOPES), \
             patch.object(
                 jira_server,
                 'create_browser_session',
                 side_effect=AssertionError('stale legacy cookies must not create browser sessions'),
             ) as create_session:
            response = self.client.get('/api/auth/status')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()['loginRequired'])
        with self.client.session_transaction() as session:
            self.assertEqual(session['db_oauth_session'], legacy_payload)
        create_session.assert_not_called()

    def test_opaque_cookie_resolution_does_not_rewrite_the_flask_session(self):
        result = self._store_callback()
        with self.factory() as session:
            handle = create_browser_session(
                session,
                user_id=result.user_id,
                workspace_id=result.workspace_id,
                auth_connection_id=result.connection_id,
            )
            session.commit()

        with jira_server.app.test_request_context('/'):
            jira_server.session['db_oauth_session'] = {'db_browser_session_id': handle.id}
            jira_server.session.modified = False
            with patch.dict(os.environ, {
                'CONFIG_STORAGE_BACKEND': 'db',
                'DATABASE_URL': self.database_url,
            }), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                 patch.object(jira_server, 'ATLASSIAN_SCOPES', jira_server.ATLASSIAN_SCOPES), \
                 patch.object(
                     jira_server,
                     'create_browser_session',
                     side_effect=AssertionError('opaque cookies must not create browser sessions'),
                 ) as create_session:
                context = jira_server.current_request_auth_context()
                session_was_modified = jira_server.session.modified

        self.assertEqual(context.browser_session_id, handle.id)
        self.assertFalse(session_was_modified)
        create_session.assert_not_called()

    def test_oauth_callback_writes_db_rows_while_storing_db_browser_session(self):
        result = self._store_callback_through_route()
        with self.client.session_transaction() as session:
            self.assertEqual(session['db_oauth_session'], {
                'db_browser_session_id': result.browser_session_id,
            })
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})

        with self.factory() as session:
            user_count = session.query(models.User).count()
            token_count = session.query(models.AuthToken).count()
            browser_session = session.get(models.BrowserSession, result.browser_session_id)
        self.assertEqual(user_count, 1)
        self.assertEqual(token_count, 2)
        self.assertEqual(browser_session.auth_connection_id, result.connection_id)

    def test_db_oauth_callback_stores_db_session_without_local_token_store(self):
        result = self._store_callback_through_route()

        with self.client.session_transaction() as session:
            self.assertIn('db_oauth_session', session)
            self.assertEqual(session['db_oauth_session'], {
                'db_browser_session_id': result.browser_session_id,
            })
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
        self.assertIn('Jira Delivery Planner', response.get_data(as_text=True))
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
             patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('fresh DB token should not refresh')), \
             patch.object(
                 jira_server,
                 'remember_db_oauth_browser_session',
                 side_effect=AssertionError('DB refresh must preserve the existing browser id'),
             ):
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

    def test_two_browser_profiles_share_connection_but_refresh_and_logout_independently(self):
        client_a = self.client
        client_b = jira_server.app.test_client()
        callback_a = self._store_callback_through_route(
            client=client_a,
            access_token='access-a',
            refresh_token='refresh-a',
        )
        callback_b = self._store_callback_through_route(
            client=client_b,
            access_token='access-b',
            refresh_token='refresh-b',
        )

        browser_a_id = callback_a.browser_session_id
        browser_b_id = callback_b.browser_session_id
        connection_a_id = callback_a.connection_id
        connection_b_id = callback_b.connection_id
        self.assertNotEqual(browser_a_id, browser_b_id)
        self.assertEqual(connection_a_id, connection_b_id)

        replacement_a = self._store_callback_through_route(
            client=client_a,
            access_token='access-a-reconnected',
            refresh_token='refresh-a-reconnected',
        )
        self.assertEqual(replacement_a.connection_id, connection_a_id)
        self.assertNotEqual(replacement_a.browser_session_id, browser_a_id)
        with self.factory() as session:
            self.assertIsNone(session.get(models.BrowserSession, browser_a_id))
            self.assertIsNotNone(session.get(models.BrowserSession, browser_b_id))
            self.assertEqual(session.query(models.BrowserSession).filter_by(
                auth_connection_id=connection_a_id,
            ).count(), 2)
        browser_a_id = replacement_a.browser_session_id

        with self._db_route_mode():
            self.assertTrue(client_a.get('/api/auth/status').get_json()['authenticated'])
            self.assertTrue(client_b.get('/api/auth/status').get_json()['authenticated'])

        with self.factory() as session:
            connection = session.get(models.AuthConnection, connection_a_id)
            connection.expires_at = datetime.now(timezone.utc) - timedelta(seconds=60)
            session.commit()

        with self._db_route_mode(), patch.object(
            jira_server.HTTP_SESSION,
            'post',
            return_value=FakeResponse(200, {
                'access_token': 'refreshed-access',
                'refresh_token': 'refreshed-refresh',
                'expires_in': 3600,
                'scope': jira_server.ATLASSIAN_SCOPES,
            }),
        ), patch.object(
            jira_server,
            'remember_db_oauth_browser_session',
            side_effect=AssertionError('DB refresh must preserve the existing browser id'),
        ):
            refresh_response = client_a.post(
                '/api/auth/refresh',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )
            status_b_after_refresh = client_b.get('/api/auth/status')

        self.assertEqual(refresh_response.status_code, 200, refresh_response.get_data(as_text=True))
        self.assertTrue(status_b_after_refresh.get_json()['authenticated'])
        with client_a.session_transaction() as session:
            self.assertEqual(session['db_oauth_session'], {'db_browser_session_id': browser_a_id})
        with client_b.session_transaction() as session:
            self.assertEqual(session['db_oauth_session'], {'db_browser_session_id': browser_b_id})

        with self._db_route_mode():
            missing_header = client_b.post('/api/auth/logout')
        self.assertEqual(missing_header.status_code, 403)
        self.assertEqual(missing_header.get_json()['error'], 'csrf_required')
        with self.factory() as session:
            self.assertIsNotNone(session.get(models.BrowserSession, browser_b_id))

        with self._db_route_mode():
            logout_response = client_b.post(
                '/api/auth/logout',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )
            status_a_after_logout = client_a.get('/api/auth/status')
            status_b_after_logout = client_b.get('/api/auth/status')

        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(logout_response.get_json(), {'ok': True})
        self.assertTrue(status_a_after_logout.get_json()['authenticated'])
        self.assertFalse(status_b_after_logout.get_json()['authenticated'])
        with self.factory() as session:
            self.assertIsNotNone(session.get(models.BrowserSession, browser_a_id))
            self.assertIsNone(session.get(models.BrowserSession, browser_b_id))
            connection = session.get(models.AuthConnection, connection_a_id)
        self.assertEqual(connection.status, 'active')

    def test_callback_validation_failures_preserve_current_and_other_browser_rows(self):
        client_a = self.client
        client_b = jira_server.app.test_client()
        callback_a = self._store_callback_through_route(client=client_a, access_token='access-a')
        callback_b = self._store_callback_through_route(client=client_b, access_token='access-b')
        browser_a_id = callback_a.browser_session_id
        browser_b_id = callback_b.browser_session_id

        cases = (
            ('invalid_state', 'state-1', 'verifier-1', '/api/auth/atlassian/callback?state=wrong&code=abc', 'invalid_oauth_state'),
            ('authorization_denial', 'state-2', 'verifier-2', '/api/auth/atlassian/callback?state=state-2&error=access_denied', 'oauth_authorization_failed'),
            ('missing_code', 'state-3', 'verifier-3', '/api/auth/atlassian/callback?state=state-3', 'missing_oauth_code'),
            ('missing_pkce', 'state-4', None, '/api/auth/atlassian/callback?state=state-4&code=abc', 'missing_pkce_verifier'),
        )
        for name, state_value, verifier, path, expected_error in cases:
            with self.subTest(name=name):
                with client_a.session_transaction() as session:
                    session['oauth_state'] = state_value
                    if verifier is None:
                        session.pop('oauth_pkce_verifier', None)
                    else:
                        session['oauth_pkce_verifier'] = verifier
                with self._db_route_mode():
                    response = client_a.get(path)
                    status_a = client_a.get('/api/auth/status')
                    status_b = client_b.get('/api/auth/status')

                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()['error'], expected_error)
                self.assertTrue(status_a.get_json()['authenticated'])
                self.assertTrue(status_b.get_json()['authenticated'])
                with client_a.session_transaction() as session:
                    self.assertEqual(session['db_oauth_session'], {'db_browser_session_id': browser_a_id})
                with self.factory() as session:
                    self.assertIsNotNone(session.get(models.BrowserSession, browser_a_id))
                    self.assertIsNotNone(session.get(models.BrowserSession, browser_b_id))

    def test_post_exchange_callback_failure_deletes_only_current_browser_row(self):
        client_a = self.client
        client_b = jira_server.app.test_client()
        callback_a = self._store_callback_through_route(client=client_a, access_token='access-a')
        callback_b = self._store_callback_through_route(client=client_b, access_token='access-b')
        with client_a.session_transaction() as session:
            session['oauth_state'] = 'state-failure'
            session['oauth_pkce_verifier'] = 'verifier-failure'

        with self._db_route_mode(), patch.object(
            jira_server,
            'exchange_authorization_code',
            side_effect=jira_server.AuthError('auth_required', 'Authentication failed.'),
        ):
            response = client_a.get('/api/auth/atlassian/callback?state=state-failure&code=abc')
            status_b = client_b.get('/api/auth/status')

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertTrue(status_b.get_json()['authenticated'])
        with client_a.session_transaction() as session:
            self.assertNotIn('db_oauth_session', session)
        with client_b.session_transaction() as session:
            self.assertEqual(session['db_oauth_session'], {
                'db_browser_session_id': callback_b.browser_session_id,
            })
        with self.factory() as session:
            self.assertIsNone(session.get(models.BrowserSession, callback_a.browser_session_id))
            self.assertIsNotNone(session.get(models.BrowserSession, callback_b.browser_session_id))

    def test_non_active_connection_callback_deletes_all_old_rows_before_new_browser_row(self):
        client_a = self.client
        client_b = jira_server.app.test_client()
        callback_a = self._store_callback_through_route(client=client_a, access_token='access-a')
        callback_b = self._store_callback_through_route(client=client_b, access_token='access-b')
        for index, connection_status in enumerate(('revoked', 'expired', 'error')):
            with self.subTest(connection_status=connection_status):
                with self.factory() as session:
                    connection = session.get(models.AuthConnection, callback_a.connection_id)
                    connection.status = connection_status
                    session.commit()

                reconnect = self._store_callback_through_route(
                    client=client_a,
                    access_token=f'reconnected-access-{connection_status}',
                    refresh_token=f'reconnected-refresh-{connection_status}',
                )

                self.assertEqual(reconnect.connection_id, callback_a.connection_id)
                self.assertNotIn(reconnect.browser_session_id, {
                    callback_a.browser_session_id,
                    callback_b.browser_session_id,
                })
                with self.factory() as session:
                    rows = session.query(models.BrowserSession).filter_by(
                        auth_connection_id=reconnect.connection_id,
                    ).all()
                self.assertEqual([row.id for row in rows], [reconnect.browser_session_id])
                with self._db_route_mode():
                    self.assertTrue(client_a.get('/api/auth/status').get_json()['authenticated'])
                    self.assertFalse(client_b.get('/api/auth/status').get_json()['authenticated'])

                callback_a = reconnect
                if index < 2:
                    callback_b = self._store_callback_through_route(
                        client=client_b,
                        access_token=f'access-b-{connection_status}',
                    )

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
             }) as get_config, patch('backend.routes.auth_routes.epm_home.run_home_graphql_oauth_probe', return_value={
                 'ok': True,
             }) as run_probe:
            response = self.client.get('/api/auth/dev/home-graphql-oauth-probe')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        run_probe.assert_called_once()
        self.assertEqual(run_probe.call_args.args[0], 'access-123')
        self.assertEqual(run_probe.call_args.args[1], 'cloud-123')
        self.assertEqual(get_config.call_count, 1)
        self.assertEqual(get_config.call_args.kwargs['context'].user_id, result.user_id)
        with self.client.session_transaction() as session:
            self.assertIn('db_oauth_session', session)
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})

    def test_dev_home_graphql_probe_fails_closed_when_private_epm_storage_is_unavailable(self):
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
             patch.object(jira_server, 'get_epm_config', side_effect=jira_server.ConfigStorageError('sensitive detail')), \
             patch('backend.routes.auth_routes.epm_home.run_home_graphql_oauth_probe') as run_probe:
            response = self.client.get('/api/auth/dev/home-graphql-oauth-probe')

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'config_storage_unavailable',
            'message': 'EPM configuration storage is unavailable.',
        })
        run_probe.assert_not_called()


if __name__ == '__main__':
    unittest.main()
