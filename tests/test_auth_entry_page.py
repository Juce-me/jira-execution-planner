import unittest
from pathlib import Path
from unittest.mock import patch

import jira_server


class TestAuthEntryPage(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        if hasattr(jira_server, 'OAUTH_TOKEN_STORE'):
            jira_server.OAUTH_TOKEN_STORE.clear()
        self.client = jira_server.app.test_client()

    def test_oauth_login_page_shows_atlassian_sign_in_action(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login')
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response.headers['Content-Type'])
        body = response.get_data(as_text=True)
        self.assertIn('Sign in with Atlassian', body)
        self.assertIn('/api/auth/atlassian/login', body)
        self.assertNotIn('access_token', body)
        self.assertNotIn('refresh_token', body)

    def test_oauth_dashboard_entry_redirects_unauthenticated_user_to_login_page(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/login')

    def test_basic_mode_does_not_show_oauth_login_page(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = self.client.get('/login')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/')

    def test_login_page_shows_expired_session_message(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login?reason=session_expired')
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('Your Jira sign-in expired', body)
        self.assertIn('Sign in with Atlassian', body)
        self.assertNotIn('prompt=consent', body)

    def test_terminal_recovery_reason_bypasses_valid_local_session_redirect(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False), \
             patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}):
            response = self.client.get('/login?reason=session_expired')
        self.assertEqual(response.status_code, 200)
        self.assertIn('/api/auth/atlassian/login', response.get_data(as_text=True))

    def test_terminal_recovery_reason_bypasses_valid_database_session_redirect(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=True), \
             patch.object(jira_server, 'db_oauth_browser_session_data', return_value={'connectionId': 'connection'}), \
             patch.object(jira_server, 'current_request_auth_context', return_value=object()), \
             patch.object(jira_server, 'oauth_session_data', return_value={}):
            response = self.client.get('/login?reason=missing_scope')
        self.assertEqual(response.status_code, 200)
        self.assertIn('/api/auth/atlassian/login?prompt=consent', response.get_data(as_text=True))

    def test_unsupported_recovery_reason_keeps_valid_local_session_redirect(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False), \
             patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}):
            response = self.client.get('/login?reason=unsupported')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/')

    def test_login_page_uses_readable_auth_entry_styles(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login?reason=session_expired')
        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('<style>', body)
        self.assertIn('color-scheme: light', body)
        self.assertIn('class="auth-entry"', body)
        self.assertIn('class="auth-card"', body)
        self.assertIn('class="auth-action"', body)

    def test_dashboard_auth_shell_refreshes_on_initial_load(self):
        source = Path('jira-dashboard.html').read_text()
        refresh_source = Path('frontend/src/api/authFocusRefresh.js').read_text()
        self.assertNotIn("<script>\n    (() => {", source)
        self.assertEqual(source.count('auth-focus-refresh.js'), 1)
        self.assertIn("apiFetch('/api/auth/refresh'", refresh_source)
        self.assertIn("'X-Requested-With': 'jira-execution-planner'", refresh_source)
        self.assertIn('installAuthFocusRefresh();', refresh_source)
        self.assertNotIn('location.reload', refresh_source)
