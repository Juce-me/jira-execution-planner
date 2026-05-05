import unittest
from unittest.mock import patch

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
        self.client = jira_server.app.test_client()

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

    def test_oauth_login_redirects_to_atlassian(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 302)
        self.assertIn('https://auth.atlassian.com/authorize?', response.headers['Location'])
        self.assertIn('code_challenge=', response.headers['Location'])
        self.assertIn('code_challenge_method=S256', response.headers['Location'])

    def test_oauth_login_rejects_non_local_token_store_environment(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'production'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True):
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
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', False):
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
        jira_server.OAUTH_REFRESH_LOCKS['session-123'] = object()
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
            jira_server.OAUTH_REFRESH_LOCKS['session-123'] = object()
            jira_server.save_oauth_session({})
            self.assertNotIn('atlassian_oauth_session_id', jira_server.session)
            self.assertNotIn('session-123', jira_server.OAUTH_TOKEN_STORE)
            self.assertNotIn('session-123', jira_server.OAUTH_REFRESH_LOCKS)

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

    def test_startup_auth_validation_rejects_disallowed_local_token_store(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'production'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_startup_auth_config()

        self.assertEqual(raised.exception.code, 'local_token_store_not_allowed')

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
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]):
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
             patch.object(jira_server, 'fetch_accessible_resources', return_value=[resource]):
            response = self.client.get('/api/auth/atlassian/callback?state=state-123&code=abc')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'local_token_store_not_allowed')
        self.assertEqual(jira_server.OAUTH_TOKEN_STORE, {})
