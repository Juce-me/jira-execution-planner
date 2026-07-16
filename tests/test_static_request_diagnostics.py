import hashlib
import unittest
from unittest.mock import patch

import jira_server


class TestStaticRequestDiagnostics(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()

    def test_fires_for_frontend_dist_asset(self):
        with self.assertLogs('jep.static_diagnostics', level='INFO') as captured:
            self.client.get('/frontend/dist/auth-focus-refresh.js')
        self.assertEqual(len(captured.output), 1)
        message = captured.output[0]
        self.assertIn('method=GET', message)
        self.assertIn('path=/frontend/dist/auth-focus-refresh.js', message)
        self.assertIn('status=', message)

    def test_fires_for_root_redirect(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            with self.assertLogs('jep.static_diagnostics', level='INFO') as captured:
                response = self.client.get('/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(captured.output), 1)
        message = captured.output[0]
        self.assertIn('path=/', message)
        self.assertIn('status=302', message)

    def test_does_not_fire_for_api_route(self):
        with self.assertRaises(AssertionError):
            with self.assertLogs('jep.static_diagnostics', level='INFO'):
                self.client.get('/api/test')

    def test_validator_reflects_if_none_match(self):
        with self.assertLogs('jep.static_diagnostics', level='INFO') as captured:
            self.client.get(
                '/frontend/dist/auth-focus-refresh.js',
                headers={'If-None-Match': '"abc123"'},
            )
        self.assertIn('validator=etag', captured.output[0])

    def test_cookie_is_hashed_not_logged_raw(self):
        raw_cookie = 'session=super-secret-cookie-value'
        expected_hash = hashlib.sha256(raw_cookie.encode('utf-8')).hexdigest()[:12]
        self.client.set_cookie(key='session', value='super-secret-cookie-value')
        with self.assertLogs('jep.static_diagnostics', level='INFO') as captured:
            self.client.get('/frontend/dist/auth-focus-refresh.js')
        message = captured.output[0]
        self.assertIn(f'client={expected_hash}', message)
        self.assertNotIn('super-secret-cookie-value', message)
        self.assertNotIn(raw_cookie, message)

    def test_referer_query_string_is_stripped(self):
        with self.assertLogs('jep.static_diagnostics', level='INFO') as captured:
            self.client.get(
                '/frontend/dist/auth-focus-refresh.js',
                headers={'Referer': 'http://example.com/page?foo=bar&secret=xyz'},
            )
        message = captured.output[0]
        self.assertIn('referer=http://example.com/page', message)
        self.assertNotIn('?', message.split('referer=')[1].split(' ')[0])
        self.assertNotIn('foo', message)
        self.assertNotIn('bar', message)
        self.assertNotIn('secret', message)
        self.assertNotIn('xyz', message)


if __name__ == '__main__':
    unittest.main()
