import unittest
from unittest.mock import patch

from backend.config.repository import ConfigStorageError
from backend.db.engine import DatabaseConfigurationError
import jira_server
from tests.oauth_test_helpers import install_oauth_session, set_up_db_oauth



class TestOauthRouteGuards(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        set_up_db_oauth(self)
        self.client = jira_server.app.test_client()

    def _fixed_storage_body(self):
        return {
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }

    def _csrf(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
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

    def test_retired_basic_profile_is_rejected_before_application_config_read(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'), \
             patch.object(jira_server, 'load_dashboard_config', side_effect=AssertionError('route reached')):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'runtime_auth_unsupported')
        self.assertNotIn('basic', response.get_data(as_text=True).lower())

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
            ('regular', 'db_oauth_browser_session_data', DatabaseConfigurationError('secret browser DB')),
            ('csrf', 'csrf_request_auth_context', ConfigStorageError('secret CSRF DB')),
        )
        for name, symbol, failure in cases:
            with self.subTest(name=name), patch.object(jira_server, symbol, side_effect=failure):
                response = self.client.patch('/api/capacity/CAP-101', json={},
                    headers={'X-Requested-With': 'jira-execution-planner'})
                self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
                self.assertEqual(response.get_json(), self._fixed_storage_body())
                self.assertNotIn('secret', response.get_data(as_text=True))

    def test_shared_admin_guard_sanitizes_storage_failure_after_csrf(self):
        install_oauth_session(self.client, roles=('admin',))
        csrf = self._csrf()
        resolve_context = jira_server.current_request_auth_context
        calls = 0

        def fail_admin_context_after_real_auth():
            nonlocal calls
            calls += 1
            if calls == 1:
                return resolve_context()
            raise DatabaseConfigurationError('secret admin DB')
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True), \
             patch.object(
                 jira_server,
                 'current_request_auth_context',
                 side_effect=fail_admin_context_after_real_auth,
             ):
            response = self.client.post(
                '/api/capacity/config',
                json={},
                headers={'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': csrf},
            )
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), self._fixed_storage_body())
        self.assertNotIn('secret', response.get_data(as_text=True))
