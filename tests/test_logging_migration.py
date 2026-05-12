import logging
import os
import re
import unittest
from unittest.mock import Mock, patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover - depends on local test env deps
    jira_server = None
    _IMPORT_ERROR = exc


class TestLoggingMigration(unittest.TestCase):
    def test_jira_server_has_no_raw_print_calls(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'jira_server.py')
        with open(path, 'r', encoding='utf-8') as handle:
            source = handle.read()
        self.assertIsNone(
            re.search(r'\bprint\(', source),
            'jira_server.py should use logging helpers instead of raw print()'
        )

    @unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
    def test_fetch_teams_logs_warning_on_non_200(self):
        response = Mock()
        response.status_code = 503

        with patch.object(jira_server, 'current_jira_get', return_value=response):
            with self.assertLogs(jira_server.logger.name, level='WARNING') as captured:
                teams = jira_server.fetch_teams_from_jira_api()

        self.assertEqual(teams, {})
        output = '\n'.join(captured.output)
        self.assertIn('Teams API returned 503', output)

    @unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
    def test_fetch_teams_logs_info_on_success(self):
        response = Mock()
        response.status_code = 200
        response.json.return_value = [
            {'id': 'team-1', 'title': 'Example Team'}
        ]

        with patch.object(jira_server, 'current_jira_get', return_value=response):
            with self.assertLogs(jira_server.logger.name, level='INFO') as captured:
                teams = jira_server.fetch_teams_from_jira_api()

        self.assertEqual(
            teams,
            {'team-1': {'id': 'team-1', 'name': 'Example Team'}}
        )
        output = '\n'.join(captured.output)
        self.assertIn('Fetched 1 teams from Jira Teams API', output)

    @unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
    def test_werkzeug_logs_redact_oauth_callback_query(self):
        werkzeug_logger = logging.getLogger('werkzeug')

        with self.assertLogs('werkzeug', level='INFO') as captured:
            werkzeug_logger.info(
                '127.0.0.1 - - [06/May/2026 14:17:47] "%s" 302 -',
                'GET /api/auth/atlassian/callback?state=state-secret&code=code-secret HTTP/1.1',
            )

        output = '\n'.join(captured.output)
        self.assertIn('/api/auth/atlassian/callback?[redacted]', output)
        self.assertNotIn('state-secret', output)
        self.assertNotIn('code-secret', output)


if __name__ == '__main__':
    unittest.main()
