"""Tests for sprint date fields (startDate/endDate) in fetch and scenario response."""

import json
import os
import tempfile
import unittest
from datetime import date
from unittest.mock import patch, MagicMock

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestSprintDatesInFetch(unittest.TestCase):
    """Verify that startDate/endDate from the Board API appear in formatted sprints."""

    def test_board_api_includes_start_and_end_dates(self):
        """Mock Board API response with dates and assert they appear in output."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'values': [
                {
                    'id': 101,
                    'name': '2026Q1',
                    'state': 'active',
                    'startDate': '2026-01-01T00:00:00.000Z',
                    'endDate': '2026-03-31T23:59:59.999Z',
                },
                {
                    'id': 102,
                    'name': '2026Q2',
                    'state': 'future',
                    'startDate': '2026-04-01T00:00:00.000Z',
                    'endDate': '2026-06-30T23:59:59.999Z',
                },
            ],
            'isLast': True,
        }

        with patch.object(jira_server, 'get_effective_board_id', return_value='123'), \
             patch.object(jira_server, 'JIRA_URL', 'https://jira.example.com'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'test@test.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token'), \
             patch('jira_server.requests.get', return_value=mock_response):
            result = jira_server.fetch_sprints_from_jira()

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['startDate'], '2026-01-01T00:00:00.000Z')
        self.assertEqual(result[0]['endDate'], '2026-03-31T23:59:59.999Z')
        self.assertEqual(result[1]['startDate'], '2026-04-01T00:00:00.000Z')
        self.assertEqual(result[1]['endDate'], '2026-06-30T23:59:59.999Z')

    def test_board_api_handles_missing_dates(self):
        """Sprints without startDate/endDate should have None values."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'values': [
                {
                    'id': 201,
                    'name': '2026Q3',
                    'state': 'future',
                    # No startDate/endDate
                },
            ],
            'isLast': True,
        }

        with patch.object(jira_server, 'get_effective_board_id', return_value='123'), \
             patch.object(jira_server, 'JIRA_URL', 'https://jira.example.com'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'test@test.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token'), \
             patch('jira_server.requests.get', return_value=mock_response):
            result = jira_server.fetch_sprints_from_jira()

        self.assertEqual(len(result), 1)
        self.assertIsNone(result[0]['startDate'])
        self.assertIsNone(result[0]['endDate'])

    def test_issue_method_includes_start_and_end_dates(self):
        """Sprints extracted from issues should also include startDate/endDate."""
        sprint_field_id = jira_server.get_sprint_field_id()

        mock_board_response = MagicMock()
        mock_board_response.status_code = 404

        mock_search_response = MagicMock()
        mock_search_response.status_code = 200
        mock_search_response.json.return_value = {
            'issues': [
                {
                    'key': 'TEST-1',
                    'fields': {
                        sprint_field_id: [
                            {
                                'id': 301,
                                'name': '2026Q1',
                                'state': 'active',
                                'startDate': '2026-01-01T00:00:00.000Z',
                                'endDate': '2026-03-31T23:59:59.999Z',
                            }
                        ]
                    }
                }
            ]
        }

        with patch.object(jira_server, 'get_effective_board_id', return_value='123'), \
             patch.object(jira_server, 'JIRA_URL', 'https://jira.example.com'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'test@test.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token'), \
             patch.object(jira_server, 'STATS_JQL_BASE', 'project = "TEST"'), \
             patch('jira_server.requests.get', return_value=mock_board_response), \
             patch('jira_server.jira_search_request', return_value=mock_search_response):
            result = jira_server.fetch_sprints_from_jira()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 301)
        self.assertEqual(result[0]['startDate'], '2026-01-01T00:00:00.000Z')
        self.assertEqual(result[0]['endDate'], '2026-03-31T23:59:59.999Z')


if __name__ == '__main__':
    unittest.main()
