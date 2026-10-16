import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

import jira_server
from tests.oauth_test_helpers import forbid_jira_http, install_oauth_session


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

    PENDING_VIEW_KEY = 'pending_share_view'
    SHARE_LINK = 'v=1&mode=board&group=default&sprint=4182&find=50%25%20off'

    def _stash(self):
        with self.client.session_transaction() as flask_session:
            return flask_session.get(self.PENDING_VIEW_KEY)

    def _set_stash(self, query, age_seconds=5):
        with self.client.session_transaction() as flask_session:
            flask_session[self.PENDING_VIEW_KEY] = {'q': query, 't': int(time.time()) - age_seconds}

    def _database_profile_patches(self):
        return (
            patch.object(jira_server, 'database_storage_enabled', return_value=True),
            patch.object(jira_server, 'db_oauth_browser_session_data', return_value={'connectionId': 'connection'}),
            patch.object(jira_server, 'current_request_auth_context', return_value=object()),
            patch.object(jira_server, 'oauth_session_data', return_value={}),
        )

    def test_unauthenticated_link_entry_stashes_the_query_and_redirects_to_login(self):
        forbid_jira_http(self)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/?' + self.SHARE_LINK)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/login')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        stash = self._stash()
        self.assertEqual(stash['q'], self.SHARE_LINK)
        self.assertLessEqual(abs(stash['t'] - int(time.time())), 5)

    def test_expired_session_link_entry_keeps_its_reason_and_stashes_the_query(self):
        with self.client.session_transaction() as flask_session:
            flask_session['atlassian_oauth_session_id'] = 'expired-session'
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/jira-dashboard.html?' + self.SHARE_LINK)
        self.assertEqual(response.headers['Location'], '/login?reason=session_expired')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self._stash()['q'], self.SHARE_LINK)

    def test_only_get_stashes_the_link(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            responses = [
                self.client.head('/?' + self.SHARE_LINK),
                self.client.options('/?' + self.SHARE_LINK),
            ]
        for response in responses:
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers['Location'], '/login')
            self.assertEqual(response.headers.getlist('Set-Cookie'), [])
        self.assertIsNone(self._stash())

    def test_plain_or_invalid_entry_does_not_touch_an_existing_stash(self):
        self._set_stash(self.SHARE_LINK)
        before = self._stash()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for query in ('', '?other=1', '?mode=board&v=1', '?v=1&find=a+b', '?v=1&find=a%0Ab'):
                with self.subTest(query=query):
                    response = self.client.get('/' + query)
                    self.assertEqual(response.headers['Location'], '/login')
                    self.assertEqual(response.headers.getlist('Set-Cookie'), [])
                    self.assertNotIn('Cache-Control', response.headers)
                    self.assertEqual(self._stash(), before)

    def test_newer_link_replaces_the_older_stash(self):
        newer = 'v=1&mode=planning&group=other&sprint=4183'
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            self.client.get('/?' + self.SHARE_LINK)
            self.client.get('/?' + newer)
        self.assertEqual(self._stash()['q'], newer)

    def test_authenticated_entry_clears_a_stale_stash(self):
        install_oauth_session(self.client)
        self._set_stash(self.SHARE_LINK, age_seconds=3600)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/?' + self.SHARE_LINK)
        response.close()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self._stash())

    def test_authenticated_database_entry_clears_a_stale_stash(self):
        self._set_stash(self.SHARE_LINK, age_seconds=3600)
        patches = self._database_profile_patches()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patches[0], patches[1], patches[2], patches[3]:
            response = self.client.get('/jira-dashboard.html?' + self.SHARE_LINK)
        response.close()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self._stash())

    def test_authenticated_entry_without_a_stash_sets_no_cookie(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/?' + self.SHARE_LINK)
        response.close()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.getlist('Set-Cookie'), [])

    def test_authenticated_login_visit_redirects_to_the_stashed_link_and_pops_it(self):
        profiles = {
            'local': (
                patch.object(jira_server, 'database_storage_enabled', return_value=False),
                patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}),
            ),
            'database': self._database_profile_patches(),
        }
        for name, patches in profiles.items():
            with self.subTest(profile=name):
                self._set_stash(self.SHARE_LINK)
                with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
                    for active in patches:
                        active.start()
                    try:
                        response = self.client.get('/login')
                    finally:
                        for active in patches:
                            active.stop()
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response.headers['Location'], '/?' + self.SHARE_LINK)
                self.assertIsNone(self._stash())

    def test_authenticated_login_visit_without_a_usable_stash_redirects_to_root(self):
        hostile = [
            ('//evil.example/?v=1', 5),
            ('v=1\r\nSet-Cookie: pwn=1', 5),
            (self.SHARE_LINK, 3600),
        ]
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False), \
             patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}):
            for query, age in hostile:
                with self.subTest(query=query, age=age):
                    self._set_stash(query, age_seconds=age)
                    response = self.client.get('/login')
                    parts = urlsplit(response.headers['Location'])
                    self.assertEqual(response.headers['Location'], '/')
                    self.assertEqual((parts.scheme, parts.netloc, parts.fragment), ('', '', ''))
                    self.assertIsNone(self._stash())
            response = self.client.get('/login')
            self.assertEqual(response.headers['Location'], '/')

    def test_login_pages_that_show_the_sign_in_action_keep_the_stash(self):
        self._set_stash(self.SHARE_LINK)
        before = self._stash()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            for path in ('/login', '/login?reason=session_expired', '/login?reason=missing_scope'):
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(self._stash(), before)

    def test_terminal_recovery_login_visit_keeps_the_stash_for_an_authenticated_session(self):
        self._set_stash(self.SHARE_LINK)
        before = self._stash()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False), \
             patch.object(jira_server, 'oauth_session_data', return_value={'access_token': 'present', 'cloudid': 'cloud'}):
            response = self.client.get('/login?reason=session_expired')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._stash(), before)
