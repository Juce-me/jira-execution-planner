import unittest
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.config.repository import ConfigStorageError
from backend.db.engine import DatabaseConfigurationError
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session


def _verified_context(*, is_admin=True):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-subject',
        atlassian_account_id='synthetic-account', workspace_id='synthetic-workspace',
        auth_connection_id='local-oauth-connection:session-1', cloud_id='cloud-123',
        site_url='https://example.atlassian.net', token_version='1', account_status='active',
        is_admin=is_admin, granted_scopes=tuple(FULL_OAUTH_SCOPE.split()), granted_scopes_verified=True,
    )


class TestOauthRouteGuards(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def _fixed_storage_body(self):
        return {
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }

    def _csrf(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()['csrfToken']

    def test_oauth_mode_hides_disabled_dev_local_api_route(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/debug-fields')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['error'], 'not_found')

    def test_oauth_mode_blocks_unmigrated_unsafe_api_route_before_csrf(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.post('/api/debug-fields')
        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.get_json()['error'], 'route_not_oauth_ready')

    def test_oauth_mode_allows_auth_status(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/status')
        self.assertEqual(response.status_code, 200)

    def test_basic_mode_does_not_apply_oauth_route_guard(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'load_dashboard_config', return_value={}):
            response = self.client.get('/api/config')
        self.assertNotEqual(response.status_code, 501)

    def test_legacy_basic_header_builder_refuses_oauth_mode(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.build_jira_headers()
        self.assertEqual(raised.exception.code, 'route_not_oauth_ready')

    def test_authenticated_read_guard_sanitizes_context_and_strict_browser_storage_failures(self):
        install_oauth_session(self.client)
        failures = (
            (patch.object(jira_server, 'current_request_auth_context', side_effect=ConfigStorageError('secret config')), None),
            (
                patch.object(jira_server, 'strict_db_oauth_browser_session_data', side_effect=DatabaseConfigurationError('secret DSN')),
                patch('backend.security.guards.database_storage_enabled', return_value=True),
            ),
        )
        for primary, secondary in failures:
            with self.subTest(error=primary), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), primary:
                if secondary is None:
                    response = self.client.get('/api/capacity?sprint=2026Q2')
                else:
                    with secondary:
                        response = self.client.get('/api/capacity?sprint=2026Q2')
            self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), self._fixed_storage_body())
            self.assertNotIn('secret', response.get_data(as_text=True))

    def test_capacity_patch_csrf_guard_sanitizes_regular_browser_and_csrf_session_failures(self):
        install_oauth_session(self.client)
        cases = (
            ('regular', {'db': DatabaseConfigurationError('secret browser DB')}),
            ('csrf', {'csrf': ConfigStorageError('secret CSRF DB')}),
        )
        for name, failure in cases:
            patches = [
                patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'),
                patch('backend.security.guards.database_storage_enabled', return_value=True),
                patch.object(jira_server, 'strict_db_oauth_browser_session_data', return_value={}),
                patch.object(jira_server, 'current_request_auth_context', return_value=_verified_context()),
                patch.object(
                    jira_server,
                    'db_oauth_browser_session_data',
                    side_effect=failure.get('db'),
                    return_value={'db_auth_connection_id': 'connection-1'} if 'db' not in failure else None,
                ),
            ]
            if 'csrf' in failure:
                patches.append(patch.object(jira_server, 'csrf_session_data_for_request', side_effect=failure['csrf']))
            for active in patches:
                active.start()
            try:
                response = self.client.patch(
                    '/api/capacity/CAP-101',
                    json={},
                    headers={'X-Requested-With': 'jira-execution-planner'},
                )
            finally:
                for active in reversed(patches):
                    active.stop()
            with self.subTest(name=name):
                self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
                self.assertEqual(response.get_json(), self._fixed_storage_body())
                self.assertNotIn('secret', response.get_data(as_text=True))

    def test_shared_admin_guard_sanitizes_storage_failure_after_csrf(self):
        install_oauth_session(self.client)
        csrf = self._csrf()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True), \
             patch.object(
                 jira_server,
                 'current_request_auth_context',
                 side_effect=[_verified_context(is_admin=True), DatabaseConfigurationError('secret admin DB')],
             ):
            response = self.client.post(
                '/api/capacity/config',
                json={},
                headers={'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': csrf},
            )
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), self._fixed_storage_body())
        self.assertNotIn('secret', response.get_data(as_text=True))
