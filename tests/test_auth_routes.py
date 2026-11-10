import os
import secrets
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from backend import app as app_module
from backend.db import engine as db_engine, models
from backend.auth.db_context import invalidate_auth_status_cache
from dataclasses import replace
from backend.auth.db_context import resolve_db_request_auth_context
from backend.auth.csrf import csrf_token_hash
from backend.auth.csrf_store import CsrfStorageUnavailable, issue_csrf_token
from backend.routes import auth_routes
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, forbid_jira_http, install_oauth_session
from tests.postgres_test_db import fresh_database_url


REPO_ROOT = Path(__file__).resolve().parents[1]


class TestAuthRoutes(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.database_url = fresh_database_url(self.addCleanup)
        for patcher in (
            patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url}),
            patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'),
            patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.addCleanup(db_engine.dispose_engines)
        self.addCleanup(invalidate_auth_status_cache)
        self.client = jira_server.app.test_client()


    def test_basic_headers_and_legacy_cookie_grant_no_authentication(self):
        with self.client.session_transaction() as cookie:
            cookie['atlassian_oauth_session_id'] = 'retired-session'
        with patch('builtins.open', side_effect=AssertionError('No legacy file I/O')):
            response = self.client.get('/api/auth/status', headers={'Authorization': 'Basic synthetic'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['authMode'], 'atlassian_oauth')
        self.assertFalse(response.get_json()['authenticated'])

    def test_fixture_session_label_is_not_identity_or_browser_authority(self):
        other = jira_server.app.test_client()
        first = install_oauth_session(self.client, session_id='same-label', account_id='synthetic-one')
        second = install_oauth_session(other, session_id='same-label', account_id='synthetic-two')
        self.assertNotEqual(first, second)
        context_one = resolve_db_request_auth_context(first)
        context_two = resolve_db_request_auth_context(second)
        self.assertNotEqual(context_one.user_id, context_two.user_id)
        self.assertEqual(context_one.workspace_id, context_two.workspace_id)
        self.assertEqual(context_one.atlassian_account_id, 'synthetic-one')
        self.assertEqual(context_two.atlassian_account_id, 'synthetic-two')
        for client in (self.client, other):
            self.assertTrue(client.get('/api/auth/status').get_json()['authenticated'])
            with client.session_transaction() as cookie:
                self.assertNotIn('atlassian_oauth_session_id', cookie)
                self.assertEqual(set(cookie['db_oauth_session']), {'db_browser_session_id'})

    def test_fixture_rejects_missing_explicit_db_connection(self):
        with self.assertRaisesRegex(ValueError, 'does not exist'):
            install_oauth_session(self.client, db_auth_connection_id='missing-connection')
        with self.client.session_transaction() as cookie:
            self.assertNotIn('db_oauth_session', cookie)

    def test_oauth_status_requires_login_without_session(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()['authenticated'])
        self.assertTrue(response.get_json()['loginRequired'])

    def test_default_atlassian_scopes_include_write_jira_work(self):
        self.assertIn("write:jira-work", jira_server.ATLASSIAN_SCOPES.split())

    def test_full_oauth_scope_fixture_includes_write_jira_work(self):
        self.assertIn("write:jira-work", FULL_OAUTH_SCOPE.split())

    def test_env_and_oauth_setup_docs_document_write_jira_work_scope(self):
        old_scope = (
            "ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user "
            "read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access"
        )
        new_scope = (
            "ATLASSIAN_SCOPES=read:me read:jira-work write:jira-work read:jira-user "
            "read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access"
        )
        for relative_path in (".env.example", "docs/SUPPORT-atlassian-oauth-setup.md", "INSTALL.md"):
            with self.subTest(path=relative_path):
                text = (REPO_ROOT / relative_path).read_text(encoding="utf8")
                self.assertIn(new_scope, text)
                self.assertNotIn(old_scope, text)

    def test_status_requires_reconsent_when_db_connection_has_old_scopes(self):
        install_oauth_session(self.client, scope='read:me read:jira-work read:jira-user offline_access')
        response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['authenticated'])
        self.assertTrue(payload['loginRequired'])
        self.assertEqual(payload['loginUrl'], '/login?reason=missing_scope')
        self.assertNotIn('access_token', str(payload))
        self.assertNotIn('refresh_token', str(payload))

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
        install_oauth_session(self.client)
        csrf = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'}).get_json()['csrfToken']
        response = self.client.post('/api/auth/refresh', headers={
            'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': csrf})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['authenticated'])
        self.assertNotIn('access_token', response.get_json())
        self.assertNotIn('refresh_token', response.get_json())

    def test_db_csrf_token_survives_connection_rotation_only_in_issuing_browser(self):
        profile_a = jira_server.app.test_client()
        profile_b = jira_server.app.test_client()
        payload_a = install_oauth_session(profile_a)
        payload_b = install_oauth_session(profile_b)
        context_a = resolve_db_request_auth_context(payload_a)
        context_b = resolve_db_request_auth_context(payload_b)
        self.assertEqual(context_a.auth_connection_id, context_b.auth_connection_id)
        response = profile_b.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 200)
        token = response.get_json()['csrfToken']
        with db_engine.session_scope() as db:
            db.get(models.AuthConnection, context_b.auth_connection_id).token_version += 1
        after_rotation_b = resolve_db_request_auth_context(payload_b)
        self.assertNotEqual(context_b.token_version, after_rotation_b.token_version)
        from backend.auth.csrf import csrf_session_data_for_auth_context
        # The token version is not part of the binding: the stored hash still matches after rotation,
        # while another connection, account or browser session derives a different hash.
        bound = csrf_token_hash(token, csrf_session_data_for_auth_context(after_rotation_b))
        with db_engine.session_scope() as db:
            self.assertEqual(db.get(models.BrowserCsrfToken, bound).browser_session_id,
                             after_rotation_b.browser_session_id)
        for changed in (replace(after_rotation_b, auth_connection_id='different-connection'),
                        replace(after_rotation_b, atlassian_account_id='different-account'), context_a):
            self.assertNotEqual(csrf_token_hash(token, csrf_session_data_for_auth_context(changed)), bound)
        # Exercise actual token-bound private writes after rotation: only the issuing browser may use it.
        response = profile_a.post('/api/epm/preferences', json={'viewEnabled': True}, headers={
            'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 403)
        response = profile_b.post('/api/epm/preferences', json={'viewEnabled': True}, headers={
            'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 200)

    def test_csrf_context_mapping_preserves_precedence_and_is_shared_by_consumers(self):
        from backend.auth.csrf import csrf_session_data_for_auth_context
        payload = install_oauth_session(self.client)
        context = resolve_db_request_auth_context(payload)
        opaque_data = {'db_browser_session_id': context.browser_session_id,
                       'db_auth_connection_id': context.auth_connection_id,
                       'account_id': context.atlassian_account_id}
        self.assertEqual(csrf_session_data_for_auth_context(context), opaque_data)
        legacy = replace(context, browser_session_id='')
        self.assertEqual(csrf_session_data_for_auth_context(legacy), {
            'db_browser_session_id': '', 'db_auth_connection_id': context.auth_connection_id,
            'account_id': context.atlassian_account_id})
        with self.assertRaises(CsrfStorageUnavailable):  # no browser session row: no cookie fallback
            issue_csrf_token(legacy)
        with jira_server.app.test_request_context('/'):
            jira_server.session['db_oauth_session'] = payload
            self.assertEqual(csrf_session_data_for_auth_context(jira_server.csrf_request_auth_context()), opaque_data)
        with patch.object(auth_routes, 'issue_csrf_token', wraps=issue_csrf_token) as issued:
            response = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['csrfToken'])
        self.assertEqual(csrf_session_data_for_auth_context(issued.call_args.args[0]), opaque_data)

    def test_oauth_login_redirects_to_atlassian(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'database_storage_enabled', return_value=True):
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

    def test_missing_scope_entry_page_forces_consent(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/login?reason=missing_scope')

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('/api/auth/atlassian/login', body)
        self.assertIn('prompt=consent', body)


    def test_oauth_logout_requires_unsafe_method_header(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/auth/logout')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()['error'], 'csrf_required')

    def test_oauth_login_rejects_basic_mode(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch('builtins.open', side_effect=AssertionError('No legacy file I/O')):
            response = self.client.get('/api/auth/atlassian/login')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error'], 'runtime_auth_unsupported')

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

    def test_logout_clears_auth_session_and_deletes_opaque_handle(self):
        payload = install_oauth_session(self.client)
        csrf = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'}).get_json()['csrfToken']
        response = self.client.post('/api/auth/logout', headers={
            'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': csrf})
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as cookie:
            self.assertNotIn('db_oauth_session', cookie)
        with db_engine.session_scope() as db:
            self.assertIsNone(db.get(models.BrowserSession, payload['db_browser_session_id']))


    def test_retired_profiles_reject_before_file_or_provider_io(self):
        for auth_mode, storage in (('basic', 'db'), ('atlassian_oauth', 'jsonfile')):
            with self.subTest(auth_mode=auth_mode, storage=storage), \
                 patch.object(jira_server, 'JIRA_AUTH_MODE', auth_mode), \
                 patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': storage}), \
                 patch('builtins.open', side_effect=AssertionError('No legacy file I/O')), \
                 patch.object(jira_server, 'exchange_authorization_code', side_effect=AssertionError('No provider I/O')):
                with self.assertRaises(jira_server.AuthError) as raised:
                    jira_server.validate_startup_auth_config()
                self.assertEqual(raised.exception.code, 'runtime_auth_unsupported' if auth_mode == 'basic' else 'runtime_storage_unsupported')

    def test_db_oauth_startup_does_not_require_local_token_store(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'validate_config_storage_startup', return_value=None):
            jira_server.validate_startup_auth_config()


    def test_credentialed_cors_rejects_wildcard_origins(self):
        with patch.dict('os.environ', {'APP_ALLOWED_ORIGINS': '*'}):
            with self.assertRaises(ValueError):
                app_module._allowed_cors_origins()

    def test_callback_stores_encrypted_tokens_and_only_opaque_cookie(self):
        self._prime_callback()
        with self._oauth_flow():
            response = self.client.get(self.CALLBACK_URL)
        self.assertEqual(response.status_code, 302)
        with self.client.session_transaction() as cookie:
            payload = dict(cookie)
            self.assertEqual(set(cookie['db_oauth_session']), {'db_browser_session_id'})
            browser_id = cookie['db_oauth_session']['db_browser_session_id']
            self.assertNotIn('atlassian_oauth_session_id', cookie)
            self.assertNotIn('oauth_state', cookie)
            self.assertNotIn('oauth_pkce_verifier', cookie)
        self.assertNotIn('access-123', str(payload))
        self.assertNotIn('refresh-123', str(payload))
        with db_engine.session_scope() as db:
            browser = db.get(models.BrowserSession, browser_id)
            connection = db.get(models.AuthConnection, browser.auth_connection_id)
            self.assertEqual(db.get(models.User, connection.user_id).external_subject, 'account-123')
            tokens = db.query(models.AuthToken).filter_by(connection_id=connection.id).all()
            self.assertEqual({token.token_kind for token in tokens}, {'access_token', 'refresh_token'})
            for token in tokens:
                self.assertNotIn('access-123', token.ciphertext)
                self.assertNotIn('refresh-123', token.ciphertext)

    def test_callback_rejects_retired_file_profile_before_exchange(self):
        self._prime_callback()
        with self._oauth_flow(), patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch('builtins.open', side_effect=AssertionError('No legacy file I/O')), \
             patch.object(jira_server, 'exchange_authorization_code', side_effect=AssertionError('No provider I/O')):
            response = self.client.get(self.CALLBACK_URL)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error'], 'runtime_storage_unsupported')

    PENDING_VIEW_KEY = 'pending_share_view'
    SHARE_LINK = 'v=1&mode=board&group=default&sprint=4182&find=50%25%20off'
    CALLBACK_URL = '/api/auth/atlassian/callback?state=state-123&code=abc'

    def _oauth_flow(self, **overrides):
        """Patch the OAuth configuration and the Atlassian exchange so the real routes run offline."""
        values = dict(
            JIRA_AUTH_MODE='atlassian_oauth',
            APP_ENVIRONMENT_KEY='local',
            ATLASSIAN_CLIENT_ID='client-123',
            ATLASSIAN_CLIENT_SECRET='secret-123',
            ATLASSIAN_REDIRECT_URI='http://localhost:5050/api/auth/atlassian/callback',
            FLASK_SECRET_KEY='test-secret',
            JIRA_URL='https://example.atlassian.net',
            exchange_authorization_code=lambda config, code, verifier: {
                'access_token': 'access-123',
                'refresh_token': 'refresh-123',
                'expires_in': 3600,
                'scope': FULL_OAUTH_SCOPE,
            },
            fetch_current_user=lambda token: {'account_id': 'account-123', 'account_status': 'active'},
            fetch_accessible_resources=lambda token: [{
                'id': 'cloud-123',
                'url': 'https://example.atlassian.net/',
                'name': 'Example Jira',
            }],
        )
        values.update(overrides)
        return patch.multiple(jira_server, **values)

    def _prime_callback(self, stash=None):
        with self.client.session_transaction() as flask_session:
            flask_session['oauth_state'] = 'state-123'
            flask_session['oauth_pkce_verifier'] = 'verifier-123'
            if stash is not None:
                flask_session[self.PENDING_VIEW_KEY] = stash

    def _fresh_stash(self, query, age_seconds=5):
        return {'q': query, 't': int(time.time()) - age_seconds}

    def _stash(self):
        with self.client.session_transaction() as flask_session:
            return flask_session.get(self.PENDING_VIEW_KEY)

    def test_callback_redirects_to_the_stashed_share_view_and_pops_it(self):
        forbid_jira_http(self)
        self._prime_callback(self._fresh_stash(self.SHARE_LINK))
        with self._oauth_flow():
            response = self.client.get(self.CALLBACK_URL)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/?' + self.SHARE_LINK)
        parts = urlparse(response.headers['Location'])
        self.assertEqual((parts.scheme, parts.netloc, parts.path, parts.fragment), ('', '', '/', ''))
        with self.client.session_transaction() as flask_session:
            self.assertNotIn(self.PENDING_VIEW_KEY, flask_session)
            self.assertTrue(flask_session.get('db_oauth_session', {}).get('db_browser_session_id'))
            self.assertNotIn('oauth_state', flask_session)

    def test_callback_without_a_stash_redirects_to_root(self):
        self._prime_callback()
        with self._oauth_flow():
            response = self.client.get(self.CALLBACK_URL)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['Location'], '/')

    def test_callback_target_ignores_request_parameters(self):
        hostile_url = self.CALLBACK_URL + '&next=//evil.example&redirect=https://evil.example&v=1&find=x'
        self._prime_callback(self._fresh_stash(self.SHARE_LINK))
        with self._oauth_flow():
            with_stash = self.client.get(hostile_url)
        self._prime_callback()
        with self._oauth_flow():
            without_stash = self.client.get(hostile_url)
        self.assertEqual(with_stash.headers['Location'], '/?' + self.SHARE_LINK)
        self.assertEqual(without_stash.headers['Location'], '/')

    def test_failed_callback_keeps_the_stash_and_a_retry_applies_it(self):
        def reject_exchange(config, code, verifier):
            raise jira_server.AuthError('auth_required', 'Authentication failed.')

        stash = self._fresh_stash(self.SHARE_LINK)
        failures = (
            ('invalid_state', self.CALLBACK_URL.replace('state-123', 'wrong'), {}, 400, 'invalid_oauth_state'),
            ('authorization_denied', '/api/auth/atlassian/callback?state=state-123&error=access_denied', {}, 400, 'oauth_authorization_failed'),
            ('missing_code', '/api/auth/atlassian/callback?state=state-123', {}, 400, 'missing_oauth_code'),
            ('failed_exchange', self.CALLBACK_URL, {'exchange_authorization_code': reject_exchange}, 401, 'auth_required'),
        )
        for name, url, overrides, status, error in failures:
            with self.subTest(failure=name):
                self._prime_callback(stash)
                with self._oauth_flow(**overrides):
                    response = self.client.get(url)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.get_json()['error'], error)
                self.assertEqual(self._stash(), stash)
        with self.subTest(failure='missing_verifier'):
            self._prime_callback(stash)
            with self.client.session_transaction() as flask_session:
                flask_session.pop('oauth_pkce_verifier')
            with self._oauth_flow():
                response = self.client.get(self.CALLBACK_URL)
            self.assertEqual(response.get_json()['error'], 'missing_pkce_verifier')
            self.assertEqual(self._stash(), stash)

        self._prime_callback()
        with self._oauth_flow():
            retry = self.client.get(self.CALLBACK_URL)
        self.assertEqual(retry.status_code, 302)
        self.assertEqual(retry.headers['Location'], '/?' + self.SHARE_LINK)
        self.assertIsNone(self._stash())

    def test_hostile_stale_or_corrupt_stash_values_always_redirect_to_root(self):
        fresh = int(time.time())
        hostile = [
            {'q': '//evil.example/?v=1', 't': fresh},
            {'q': 'https://evil.example/', 't': fresh},
            {'q': '/\\x', 't': fresh},
            {'q': 'v=1\r\nSet-Cookie: pwn=1', 't': fresh},
            {'q': 'v=1&find=Terminé', 't': fresh},
            {'q': 'v=1&find=a%0Ab', 't': fresh},
            {'q': 'v=1&mode=board' + 'a' * 1600, 't': fresh},
            {'q': self.SHARE_LINK, 't': fresh - 3600},
            {'q': self.SHARE_LINK},
            {'q': self.SHARE_LINK, 't': 'soon'},
            {'q': 7, 't': fresh},
            'v=1&mode=board',
            ['v=1&mode=board'],
            7,
        ]
        real_redirect = jira_server.redirect
        for stored in hostile:
            with self.subTest(stored=stored):
                self._prime_callback(stored)
                with patch.object(jira_server, 'redirect', wraps=real_redirect) as redirect_spy, \
                     self._oauth_flow():
                    response = self.client.get(self.CALLBACK_URL)
                parts = urlparse(response.headers['Location'])
                self.assertEqual(response.headers['Location'], '/')
                self.assertEqual((parts.scheme, parts.netloc, parts.fragment), ('', '', ''))
                redirect_spy.assert_called_once_with('/')
                self.assertIsNone(self._stash())

    def test_logout_clears_the_pending_share_view(self):
        self._prime_callback(self._fresh_stash(self.SHARE_LINK))
        response = self.client.post(
            '/api/auth/logout',
            headers={'X-Requested-With': 'jira-execution-planner'},
        )
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as flask_session:
            self.assertNotIn(self.PENDING_VIEW_KEY, flask_session)
            self.assertNotIn('oauth_state', flask_session)


    def test_full_login_return_chain_applies_the_link_once(self):
        forbid_jira_http(self)
        with self._oauth_flow():
            entry = self.client.get('/?' + self.SHARE_LINK)
            login_page = self.client.get(entry.headers['Location'])
            authorize = self.client.get('/api/auth/atlassian/login')
            state = parse_qs(urlparse(authorize.headers['Location']).query)['state'][0]
            callback = self.client.get('/api/auth/atlassian/callback?state=%s&code=abc' % state)
            repeated = self.client.get('/api/auth/atlassian/callback?state=%s&code=abc' % state)
            dashboard = self.client.get(callback.headers['Location'])
            dashboard.close()
        self.assertEqual((entry.status_code, entry.headers['Location']), (302, '/login'))
        self.assertEqual(login_page.status_code, 200)
        self.assertEqual(authorize.status_code, 302)
        self.assertEqual((callback.status_code, callback.headers['Location']), (302, '/?' + self.SHARE_LINK))
        self.assertEqual((repeated.status_code, repeated.get_json()['error']), (400, 'invalid_oauth_state'))
        self.assertEqual(dashboard.status_code, 200)
        self.assertIsNone(self._stash())

    def test_pending_share_view_cookie_stays_under_the_browser_limit_through_the_login_hop(self):
        """V8: a maximum stash on top of every session key still fits one cookie (limit 4093 bytes)."""
        browser_session_id = '8b1c2d3e-4f50-4a6b-9c7d-0e1f2a3b4c5d'
        https = {'base_url': 'https://localhost'}
        with self.client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {'db_browser_session_id': browser_session_id}
            flask_session['atlassian_oauth_session_id'] = browser_session_id
        longest = 'v=1&find=' + secrets.token_urlsafe(1200)[:1527]
        too_long = longest + 'a'
        self.assertEqual((len(longest), len(too_long)), (1536, 1537))

        with patch.dict(jira_server.app.config, {'SESSION_COOKIE_SECURE': True}), self._oauth_flow():
            entry = self.client.get('/?' + longest, **https)
            login = self.client.get('/api/auth/atlassian/login', **https)

        for response in (entry, login):
            headers = response.headers.getlist('Set-Cookie')
            self.assertEqual(len(headers), 1)
            self.assertIn('; Secure', headers[0])
            self.assertLessEqual(len(headers[0]), 4093)
        with self.client.session_transaction() as flask_session:
            self.assertEqual(flask_session[self.PENDING_VIEW_KEY]['q'], longest)
            self.assertNotIn('csrf_token_hashes', flask_session)  # CSRF state lives in the database
            self.assertTrue(flask_session['oauth_state'])
            self.assertTrue(flask_session['oauth_pkce_verifier'])
        self.assertIn('state=' + flask_session['oauth_state'], login.headers['Location'])

        refused = jira_server.app.test_client()
        with self._oauth_flow():
            response = refused.get('/?' + too_long)
        self.assertEqual(response.headers.getlist('Set-Cookie'), [])
        with refused.session_transaction() as flask_session:
            self.assertNotIn(self.PENDING_VIEW_KEY, flask_session)
