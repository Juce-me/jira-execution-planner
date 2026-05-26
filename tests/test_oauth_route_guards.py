import unittest
from unittest.mock import patch

import jira_server


class TestOauthRouteGuards(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()

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
