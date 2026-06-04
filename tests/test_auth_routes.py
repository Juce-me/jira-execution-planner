import os
import time
import unittest
from unittest.mock import patch
import threading
import tempfile
from urllib.parse import parse_qs, urlparse

from backend import app as app_module
import jira_server


class TestAuthRoutes(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        if hasattr(jira_server, 'OAUTH_TOKEN_STORE'):
            jira_server.OAUTH_TOKEN_STORE.clear()
        if hasattr(jira_server, 'OAUTH_REFRESH_LOCKS'):
            jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._old_oauth_token_store_path = getattr(jira_server, 'OAUTH_TOKEN_STORE_PATH', '')
        jira_server.OAUTH_TOKEN_STORE_PATH = ''
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE_PATH = self._old_oauth_token_store_path

    def test_basic_auth_status_reports_configured(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'user@example.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token-123'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['authMode'], 'basic')
        self.assertTrue(response.get_json()['authenticated'])

    def test_oauth_status_requires_login_without_session(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()['authenticated'])
        self.assertTrue(response.get_json()['loginRequired'])

    def test_status_requires_reconsent_when_oauth_session_has_old_scopes(self):
        with self.client.session_transaction() as flask_session:
            flask_session["atlassian_oauth_session_id"] = "session-1"
        jira_server.OAUTH_TOKEN_STORE["session-1"] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "site_name": "Example",
            "account_id": "account-123",
            "account_status": "active",
            "stored_at": time.time(),
            "scope": "read:me read:jira-work read:jira-user offline_access",
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "ATLASSIAN_SCOPES", "read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access"):
            response = self.client.get("/api/auth/status")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["authenticated"], False)
        self.assertEqual(payload["loginRequired"], True)
        self.assertEqual(payload["loginUrl"], "/login?reason=missing_scope")
        self.assertNotIn("access_token", str(payload))
        self.assertNotIn("refresh_token", str(payload))

    def test_oauth_refresh_requires_session(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/auth/refresh',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertEqual(response.get_json()['loginUrl'], '/login?reason=session_expired')

    def test_oauth_refresh_returns_authenticated_without_tokens(self):
        with self.client.session_transaction() as session:
            session['atlassian_oauth_session_id'] = 'session-123'
        jira_server.OAUTH_TOKEN_STORE['session-123'] = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_at': time.time() + 600,
            'cloudid': 'cloud-123',
            'site_url': 'https://example.atlassian.net',
            'stored_at': time.time(),
        }
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post(
                '/api/auth/refresh',
                headers={'X-Requested-With': 'jira-execution-planner'},
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body['authenticated'])
        self.assertNotIn('access_token', body)
        self.assertNotIn('refresh_token', body)

    def test_oauth_login_redirects_to_atlassian(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 302)
        self.assertIn('https://auth.atlassian.com/authorize?', response.headers['Location'])
        self.assertIn('code_challenge=', response.headers['Location'])
        self.assertIn('code_challenge_method=S256', response.headers['Location'])
        self.assertNotIn('prompt=consent', response.headers['Location'])

    def test_oauth_login_can_force_reconsent_for_scope_changes(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True):
            response = self.client.get('/api/auth/atlassian/login?prompt=consent')

        self.assertEqual(response.status_code, 302)
        query = parse_qs(urlparse(response.headers['Location']).query)
        self.assertEqual(query['prompt'], ['consent'])

    def test_missing_scope_entry_page_does_not_force_consent(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login?reason=missing_scope')

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('/api/auth/atlassian/login', body)
        self.assertNotIn('prompt=consent', body)

    def test_oauth_login_rejects_non_local_token_store_environment(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'production'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')

    def test_oauth_login_rejects_disabled_local_token_store(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', False), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')

    def test_oauth_logout_requires_unsafe_method_header(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/auth/logout')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_oauth_login_rejects_basic_mode(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'user@example.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token-123'):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'oauth_not_enabled')

    def test_callback_rejects_invalid_state(self):
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/atlassian/callback?state=bad&code=abc')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'invalid_oauth_state')
        with self.client.session_transaction() as session:
            self.assertNotIn('oauth_state', session)
            self.assertNotIn('oauth_pkce_verifier', session)

    def test_logout_clears_auth_session(self):
        with self.client.session_transaction() as session:
            session['atlassian_oauth_session_id'] = 'session-123'
        jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
        jira_server.OAUTH_REFRESH_LOCKS['session-123'] = threading.RLock()
        response = self.client.post(
            '/api/auth/logout',
            headers={'X-Requested-With': 'jira-execution-planner'},
        )
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            self.assertNotIn('atlassian_oauth_session_id', session)
        self.assertNotIn('session-123', jira_server.OAUTH_TOKEN_STORE)
        self.assertNotIn('session-123', jira_server.OAUTH_REFRESH_LOCKS)

    def test_save_oauth_session_clears_falsy_payload(self):
        with jira_server.app.test_request_context('/'):
            jira_server.session['atlassian_oauth_session_id'] = 'session-123'
            jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
            jira_server.OAUTH_REFRESH_LOCKS['session-123'] = threading.RLock()
            jira_server.save_oauth_session({})
            self.assertNotIn('atlassian_oauth_session_id', jira_server.session)
            self.assertNotIn('session-123', jira_server.OAUTH_TOKEN_STORE)
            self.assertNotIn('session-123', jira_server.OAUTH_REFRESH_LOCKS)

    def test_save_oauth_session_clear_waits_for_in_flight_refresh(self):
        class RecordingLock:
            def __init__(self):
                self.acquired = False

            def __enter__(self):
                self.acquired = True
                return self

            def __exit__(self, exc_type, exc, tb):
                self.acquired = False

        lock = RecordingLock()
        with jira_server.app.test_request_context('/'):
            jira_server.session['atlassian_oauth_session_id'] = 'session-123'
            jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
            jira_server.OAUTH_REFRESH_LOCKS['session-123'] = lock

            def drop_session(session_id):
                self.assertTrue(lock.acquired)

            with patch.object(jira_server, '_drop_oauth_session', side_effect=drop_session) as mocked_drop:
                jira_server.save_oauth_session({})

            mocked_drop.assert_called_once_with('session-123')

    def test_save_oauth_session_db_payload_waits_for_in_flight_refresh(self):
        class RecordingLock:
            def __init__(self):
                self.acquired = False

            def __enter__(self):
                self.acquired = True
                return self

            def __exit__(self, exc_type, exc, tb):
                self.acquired = False

        lock = RecordingLock()
        with jira_server.app.test_request_context('/'):
            jira_server.session['atlassian_oauth_session_id'] = 'session-123'
            jira_server.OAUTH_TOKEN_STORE['session-123'] = {'access_token': 'access-123'}
            jira_server.OAUTH_REFRESH_LOCKS['session-123'] = lock

            def drop_session(session_id):
                self.assertTrue(lock.acquired)

            with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                 patch.object(jira_server, 'database_storage_enabled', return_value=True), \
                 patch.object(jira_server, '_drop_oauth_session', side_effect=drop_session) as mocked_drop:
                jira_server.save_oauth_session({
                    'db_auth_connection_id': 'connection-1',
                    'db_token_version': '2',
                })

            mocked_drop.assert_called_once_with('session-123')
            self.assertNotIn('atlassian_oauth_session_id', jira_server.session)
            self.assertEqual(jira_server.session['db_oauth_session'], {
                'db_auth_connection_id': 'connection-1',
                'db_token_version': '2',
            })

    def test_oauth_session_data_sweeps_expired_store_entries(self):
        now = 1000
        with jira_server.app.test_request_context('/'):
            jira_server.session['atlassian_oauth_session_id'] = 'current-session'
            jira_server.OAUTH_TOKEN_STORE['expired-session'] = {
                'access_token': 'expired-access',
                'stored_at': now - jira_server.OAUTH_TOKEN_STORE_TTL_SECONDS - 1,
            }
            jira_server.OAUTH_REFRESH_LOCKS['expired-session'] = object()
            jira_server.OAUTH_TOKEN_STORE['current-session'] = {
                'access_token': 'current-access',
                'stored_at': now,
            }

            with patch.object(jira_server.time, 'time', return_value=now):
                data = jira_server.oauth_session_data()

            self.assertEqual(data['access_token'], 'current-access')
            self.assertNotIn('expired-session', jira_server.OAUTH_TOKEN_STORE)
            self.assertNotIn('expired-session', jira_server.OAUTH_REFRESH_LOCKS)

    def test_oauth_session_data_restores_local_token_store_after_restart(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store_path = f'{tmpdir}/oauth-token-store.json'
            with jira_server.app.test_request_context('/'):
                jira_server.session['atlassian_oauth_session_id'] = 'session-123'
                with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                     patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
                     patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
                     patch.object(jira_server, 'OAUTH_TOKEN_STORE_PATH', store_path):
                    jira_server.save_oauth_session({
                        'access_token': 'access-123',
                        'refresh_token': 'refresh-123',
                        'expires_at': time.time() + 600,
                        'cloudid': 'cloud-123',
                        'site_url': 'https://example.atlassian.net',
                    })
                    jira_server.OAUTH_TOKEN_STORE.clear()
                    jira_server.OAUTH_REFRESH_LOCKS.clear()

                    restored = jira_server.oauth_session_data()

                self.assertEqual(restored['access_token'], 'access-123')
                self.assertEqual(restored['refresh_token'], 'refresh-123')
                self.assertIn('session-123', jira_server.OAUTH_REFRESH_LOCKS)

    def test_oauth_session_clear_removes_local_token_store_entry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store_path = f'{tmpdir}/oauth-token-store.json'
            with jira_server.app.test_request_context('/'):
                jira_server.session['atlassian_oauth_session_id'] = 'session-123'
                with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                     patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
                     patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
                     patch.object(jira_server, 'OAUTH_TOKEN_STORE_PATH', store_path):
                    jira_server.save_oauth_session({
                        'access_token': 'access-123',
                        'refresh_token': 'refresh-123',
                        'expires_at': time.time() + 600,
                    })
                    jira_server.save_oauth_session({})
                    jira_server.session['atlassian_oauth_session_id'] = 'session-123'

                    restored = jira_server.oauth_session_data()

                self.assertEqual(restored, {})

    def test_startup_auth_validation_rejects_disallowed_local_token_store(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'production'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_startup_auth_config()

        self.assertEqual(raised.exception.code, 'local_token_store_not_allowed')

    def test_db_oauth_startup_does_not_require_local_token_store(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', False), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'validate_config_storage_startup', return_value=None):
            jira_server.validate_startup_auth_config()

    def test_startup_auth_validation_rejects_too_short_local_token_store_ttl(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'OAUTH_TOKEN_STORE_TTL_SECONDS', 30), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_startup_auth_config()

        self.assertEqual(raised.exception.code, 'oauth_token_store_ttl_too_low')

    def test_default_oauth_token_store_ttl_supports_persistent_local_sessions(self):
        self.assertGreaterEqual(jira_server.OAUTH_TOKEN_STORE_TTL_SECONDS, 60 * 60 * 24 * 30)

    def test_credentialed_cors_rejects_wildcard_origins(self):
        with patch.dict('os.environ', {'APP_ALLOWED_ORIGINS': '*'}):
            with self.assertRaises(ValueError):
                app_module._allowed_cors_origins()

    def test_callback_stores_oauth_tokens_server_side_with_identity(self):
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'

        token_data = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_in': 3600,
        }
        user_profile = {
            'account_id': 'account-123',
            'account_status': 'active',
            'email': 'new@example.com',
            'name': 'New Name',
        }
        resource = {
            'id': 'cloud-123',
            'url': 'https://example.atlassian.net/',
            'name': 'Example Jira',
        }
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token_data) as exchange_code, \
             patch.object(jira_server, 'fetch_current_user', return_value=user_profile), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            response = self.client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 302)
        exchange_code.assert_called_once()
        self.assertEqual(exchange_code.call_args.args[2], 'verifier-123')
        with self.client.session_transaction() as session:
            session_payload = dict(session)
            session_id = session.get('atlassian_oauth_session_id')
            self.assertIsNotNone(session_id)
            self.assertNotIn('oauth_state', session)
            self.assertNotIn('oauth_pkce_verifier', session)
            self.assertNotIn('atlassian_oauth', session)
            self.assertNotIn('access-123', str(session_payload))
            self.assertNotIn('refresh-123', str(session_payload))

        stored = jira_server.OAUTH_TOKEN_STORE[session_id]
        self.assertEqual(stored['access_token'], 'access-123')
        self.assertEqual(stored['account_id'], 'account-123')
        self.assertEqual(stored['account_status'], 'active')

    def test_callback_rejects_disallowed_local_token_store_before_saving_tokens(self):
        with self.client.session_transaction() as session:
            session['oauth_state'] = 'state-123'
            session['oauth_pkce_verifier'] = 'verifier-123'

        token_data = {
            'access_token': 'access-123',
            'refresh_token': 'refresh-123',
            'expires_in': 3600,
        }
        user_profile = {
            'account_id': 'account-123',
            'account_status': 'active',
        }
        resource = {
            'id': 'cloud-123',
            'url': 'https://example.atlassian.net/',
            'name': 'Example Jira',
        }
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'production'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'exchange_authorization_code', return_value=token_data), \
             patch.object(jira_server, 'fetch_current_user', return_value=user_profile), \
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            response = self.client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})
