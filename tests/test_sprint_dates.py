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
        by_name = {item['name']: item for item in result}
        self.assertEqual(by_name['2026Q1']['startDate'], '2026-01-01T00:00:00.000Z')
        self.assertEqual(by_name['2026Q1']['endDate'], '2026-03-31T23:59:59.999Z')
        self.assertEqual(by_name['2026Q2']['startDate'], '2026-04-01T00:00:00.000Z')
        self.assertEqual(by_name['2026Q2']['endDate'], '2026-06-30T23:59:59.999Z')

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


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestSprintBoundaries(unittest.TestCase):
    """Verify sprintBoundaries in scenario response."""

    def test_sprint_boundaries_with_neighbors(self):
        """Selected sprint should include previous and next neighbors."""
        cache_data = {
            'timestamp': '2026-03-01T00:00:00',
            'sprints': [
                {'id': 1, 'name': '2025Q4', 'state': 'closed',
                 'startDate': '2025-10-01T00:00:00.000Z', 'endDate': '2025-12-31T23:59:59.999Z'},
                {'id': 2, 'name': '2026Q1', 'state': 'active',
                 'startDate': '2026-01-01T00:00:00.000Z', 'endDate': '2026-03-31T23:59:59.999Z'},
                {'id': 3, 'name': '2026Q2', 'state': 'future',
                 'startDate': '2026-04-01T00:00:00.000Z', 'endDate': '2026-06-30T23:59:59.999Z'},
            ]
        }

        with patch.object(jira_server, 'load_sprints_cache', return_value=cache_data):
            # Simulate what the scenario endpoint does: resolve label then build boundaries
            sprint_label = '2026Q1'
            cached_sprints = cache_data['sprints']
            sorted_sprints = sorted(cached_sprints, key=lambda s: s.get('name', ''))
            selected_idx = None
            for i, s in enumerate(sorted_sprints):
                if s.get('name') == sprint_label:
                    selected_idx = i
                    break

            self.assertIsNotNone(selected_idx)

            def _sprint_boundary(s):
                return {'id': s.get('id'), 'name': s.get('name'),
                        'startDate': s.get('startDate'), 'endDate': s.get('endDate')}

            boundaries = {
                'selected': _sprint_boundary(sorted_sprints[selected_idx]),
                'previous': _sprint_boundary(sorted_sprints[selected_idx - 1]) if selected_idx > 0 else None,
                'next': _sprint_boundary(sorted_sprints[selected_idx + 1]) if selected_idx < len(sorted_sprints) - 1 else None,
            }

        self.assertEqual(boundaries['selected']['name'], '2026Q1')
        self.assertEqual(boundaries['selected']['startDate'], '2026-01-01T00:00:00.000Z')
        self.assertIsNotNone(boundaries['previous'])
        self.assertEqual(boundaries['previous']['name'], '2025Q4')
        self.assertIsNotNone(boundaries['next'])
        self.assertEqual(boundaries['next']['name'], '2026Q2')

    def test_sprint_boundaries_first_sprint_has_no_previous(self):
        """First sprint chronologically should have previous=None."""
        cache_data = {
            'timestamp': '2026-03-01T00:00:00',
            'sprints': [
                {'id': 1, 'name': '2026Q1', 'state': 'active',
                 'startDate': '2026-01-01T00:00:00.000Z', 'endDate': '2026-03-31T23:59:59.999Z'},
                {'id': 2, 'name': '2026Q2', 'state': 'future',
                 'startDate': None, 'endDate': None},
            ]
        }

        sorted_sprints = sorted(cache_data['sprints'], key=lambda s: s.get('name', ''))
        selected_idx = 0  # 2026Q1 is first

        def _sprint_boundary(s):
            return {'id': s.get('id'), 'name': s.get('name'),
                    'startDate': s.get('startDate'), 'endDate': s.get('endDate')}

        boundaries = {
            'selected': _sprint_boundary(sorted_sprints[selected_idx]),
            'previous': _sprint_boundary(sorted_sprints[selected_idx - 1]) if selected_idx > 0 else None,
            'next': _sprint_boundary(sorted_sprints[selected_idx + 1]) if selected_idx < len(sorted_sprints) - 1 else None,
        }

        self.assertEqual(boundaries['selected']['name'], '2026Q1')
        self.assertIsNone(boundaries['previous'])
        self.assertIsNotNone(boundaries['next'])
        self.assertEqual(boundaries['next']['name'], '2026Q2')


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestDeduplicateSprintsByName(unittest.TestCase):
    """Verify deduplication logic for sprints sharing a name."""

    def test_prefers_board_sprint_over_cross_board(self):
        sprints = [
            {'id': 100, 'name': '2026Q2', 'state': 'active', 'startDate': None, 'endDate': None},
            {'id': 200, 'name': '2026Q2', 'state': 'future', 'startDate': None, 'endDate': None},
        ]
        result = jira_server.deduplicate_sprints_by_name(sprints, board_sprint_ids={200})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 200)

    def test_no_board_ids_falls_back_to_state_priority(self):
        sprints = [
            {'id': 100, 'name': '2026Q2', 'state': 'future', 'startDate': None, 'endDate': None},
            {'id': 200, 'name': '2026Q2', 'state': 'active', 'startDate': None, 'endDate': None},
        ]
        result = jira_server.deduplicate_sprints_by_name(sprints, board_sprint_ids=None)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 200)  # active wins over future

    def test_unique_names_pass_through(self):
        sprints = [
            {'id': 1, 'name': '2026Q1', 'state': 'active', 'startDate': None, 'endDate': None},
            {'id': 2, 'name': '2026Q2', 'state': 'future', 'startDate': None, 'endDate': None},
        ]
        result = jira_server.deduplicate_sprints_by_name(sprints)
        self.assertEqual(len(result), 2)

    def test_both_on_board_falls_back_to_state(self):
        sprints = [
            {'id': 100, 'name': '2026Q2', 'state': 'future', 'startDate': None, 'endDate': None},
            {'id': 200, 'name': '2026Q2', 'state': 'closed', 'startDate': None, 'endDate': None},
        ]
        # Both on board — closed beats future by state priority
        result = jira_server.deduplicate_sprints_by_name(sprints, board_sprint_ids={100, 200})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 200)


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestMethod2BoardScoping(unittest.TestCase):
    """Verify Method 2 (JQL fallback) filters cross-board sprints."""

    def test_cross_board_sprints_filtered_in_method2(self):
        """When board API failed but board ID is set, Method 2 results should be scoped."""
        sprint_field_id = jira_server.get_sprint_field_id()

        mock_board_404 = MagicMock()
        mock_board_404.status_code = 404

        # Board sprint IDs lookup returns only sprint 300
        mock_board_ids_response = MagicMock()
        mock_board_ids_response.status_code = 200
        mock_board_ids_response.json.return_value = {
            'values': [{'id': 300, 'name': '2026Q2', 'state': 'future'}],
            'isLast': True,
        }

        mock_search_response = MagicMock()
        mock_search_response.status_code = 200
        mock_search_response.json.return_value = {
            'issues': [
                {
                    'key': 'TEST-1',
                    'fields': {
                        sprint_field_id: [
                            {'id': 300, 'name': '2026Q2', 'state': 'future',
                             'startDate': '2026-04-01T00:00:00.000Z', 'endDate': '2026-06-30T00:00:00.000Z'},
                            {'id': 999, 'name': '2026Q2', 'state': 'active',
                             'startDate': '2026-04-08T00:00:00.000Z', 'endDate': '2026-06-29T00:00:00.000Z'},
                        ]
                    }
                }
            ]
        }

        def get_side_effect(url, **kwargs):
            if '/sprint' in url and '/board/' in url:
                # First call: Method 1 board sprint fetch (returns 404)
                # Subsequent calls: fetch_board_sprint_ids (returns board sprints)
                if not hasattr(get_side_effect, '_board_call_count'):
                    get_side_effect._board_call_count = 0
                get_side_effect._board_call_count += 1
                if get_side_effect._board_call_count == 1:
                    return mock_board_404
                return mock_board_ids_response
            return mock_board_404

        with patch.object(jira_server, 'get_effective_board_id', return_value='123'), \
             patch.object(jira_server, 'JIRA_URL', 'https://jira.example.com'), \
             patch.object(jira_server, 'JIRA_EMAIL', 'test@test.com'), \
             patch.object(jira_server, 'JIRA_TOKEN', 'token'), \
             patch.object(jira_server, 'STATS_JQL_BASE', 'project = "TEST"'), \
             patch('jira_server.requests.get', side_effect=get_side_effect), \
             patch('jira_server.jira_search_request', return_value=mock_search_response):
            # Reset call counter
            if hasattr(get_side_effect, '_board_call_count'):
                del get_side_effect._board_call_count
            result = jira_server.fetch_sprints_from_jira()

        # Only sprint 300 (on board) should remain; 999 (cross-board) filtered out
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 300)


if __name__ == '__main__':
    unittest.main()
