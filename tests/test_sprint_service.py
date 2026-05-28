import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta

from backend.services import sprints
from backend.auth.jira_auth import AuthError


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(self._payload)

    def json(self):
        return self._payload


class TestSprintService(unittest.TestCase):
    def test_cache_load_save_validate_and_invalidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_file = os.path.join(tmp, 'sprints_cache.json')
            now = datetime(2026, 5, 28, 12, 0, 0)

            self.assertIsNone(sprints.load_sprints_cache(cache_file))
            self.assertTrue(sprints.save_sprints_cache(
                [{'id': 1, 'name': '2026Q2'}],
                cache_file=cache_file,
                board_id='42',
                now_fn=lambda: now,
            ))
            cache_data = sprints.load_sprints_cache(cache_file)
            self.assertEqual(cache_data['boardId'], '42')
            self.assertEqual(cache_data['sprints'][0]['name'], '2026Q2')
            self.assertTrue(sprints.is_sprints_cache_valid(
                cache_data,
                current_board_id='42',
                cache_expiry_hours=24,
                now_fn=lambda: now + timedelta(hours=1),
            ))
            self.assertFalse(sprints.is_sprints_cache_valid(
                cache_data,
                current_board_id='43',
                cache_expiry_hours=24,
                now_fn=lambda: now + timedelta(hours=1),
            ))
            self.assertFalse(sprints.is_sprints_cache_valid(
                cache_data,
                current_board_id='42',
                cache_expiry_hours=24,
                now_fn=lambda: now + timedelta(hours=25),
            ))
            sprints.invalidate_sprints_cache(cache_file)
            self.assertFalse(os.path.exists(cache_file))

    def test_cache_load_handles_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_file = os.path.join(tmp, 'sprints_cache.json')
            with open(cache_file, 'w', encoding='utf-8') as handle:
                handle.write('{not-json')
            warnings = []

            self.assertIsNone(sprints.load_sprints_cache(cache_file, log_warning_fn=warnings.append))
            self.assertEqual(len(warnings), 1)

    def test_fetch_board_sprint_ids_filters_origin_board_and_propagates_auth_error(self):
        calls = []

        def jira_get(path, **kwargs):
            calls.append((path, kwargs))
            return FakeResponse(200, {
                'values': [
                    {'id': 1, 'originBoardId': 42},
                    {'id': 2, 'originBoardId': 99},
                    {'id': 3},
                ],
                'isLast': True,
            })

        self.assertEqual(
            sprints.fetch_board_sprint_ids('42', jira_get=jira_get, auth_error_class=AuthError),
            {1, 3},
        )
        self.assertEqual(calls[0][1]['params']['startAt'], 0)

        def auth_jira_get(_path, **_kwargs):
            raise AuthError('auth_required', 'Atlassian authentication is required.')

        with self.assertRaises(AuthError):
            sprints.fetch_board_sprint_ids('42', jira_get=auth_jira_get, auth_error_class=AuthError)

    def test_deduplicate_sprints_prefers_board_membership_then_state(self):
        duplicate_sprints = [
            {'id': 1, 'name': '2026Q2', 'state': 'future'},
            {'id': 2, 'name': '2026Q2', 'state': 'closed'},
            {'id': 3, 'name': '2026Q3', 'state': 'future'},
        ]

        self.assertEqual(
            sprints.deduplicate_sprints_by_name(duplicate_sprints, board_sprint_ids={1})[0]['id'],
            1,
        )
        self.assertEqual(
            sprints.deduplicate_sprints_by_name(duplicate_sprints, board_sprint_ids=None)[0]['id'],
            2,
        )

    def test_fetch_sprints_from_board_preserves_dates_and_filters_cross_board(self):
        def jira_get(path, **kwargs):
            return FakeResponse(200, {
                'values': [
                    {
                        'id': 101,
                        'name': '2026Q1',
                        'state': 'active',
                        'originBoardId': 42,
                        'startDate': '2026-01-01T00:00:00.000Z',
                        'endDate': '2026-03-31T23:59:59.999Z',
                    },
                    {
                        'id': 102,
                        'name': '2026Q2',
                        'state': 'future',
                        'originBoardId': 99,
                    },
                    {
                        'id': 103,
                        'name': 'not-quarter',
                        'state': 'future',
                    },
                ],
                'isLast': True,
            })

        result = sprints.fetch_sprints_from_jira(
            board_id='42',
            stats_jql_base='project = "TEST"',
            product_project='PRODUCT',
            tech_project='TECH',
            jira_get=jira_get,
            jira_search_request=lambda _payload: self.fail('should not search'),
            get_sprint_field_id=lambda: 'customfield_sprint',
            strip_sprint_clause=lambda jql: jql,
            add_clause_to_jql=lambda jql, clause: f'{jql} AND {clause}',
            auth_error_class=AuthError,
        )

        self.assertEqual(result, [{
            'id': 101,
            'name': '2026Q1',
            'state': 'active',
            'startDate': '2026-01-01T00:00:00.000Z',
            'endDate': '2026-03-31T23:59:59.999Z',
        }])

    def test_fetch_sprints_from_jql_uses_next_page_token_and_board_scope(self):
        search_payloads = []
        sprint_field = 'customfield_sprint'

        board_calls = []

        def jira_get(path, **kwargs):
            board_calls.append((path, kwargs))
            if len(board_calls) == 1:
                return FakeResponse(404, {})
            return FakeResponse(200, {
                'values': [{'id': 301, 'originBoardId': 42}],
                'isLast': True,
            })

        responses = iter([
            FakeResponse(200, {
                'issues': [{
                    'fields': {
                        sprint_field: [
                            {
                                'id': 301,
                                'name': '2026Q3',
                                'state': 'future',
                                'startDate': '2026-07-01T00:00:00.000Z',
                                'endDate': '2026-09-30T23:59:59.999Z',
                            },
                            {'id': 999, 'name': '2026Q3', 'state': 'active'},
                        ]
                    }
                }],
                'nextPageToken': 'page-2',
                'isLast': False,
            }),
            FakeResponse(200, {'issues': [], 'isLast': True}),
            FakeResponse(200, {'issues': [], 'isLast': True}),
            FakeResponse(200, {'issues': [], 'isLast': True}),
            FakeResponse(200, {'issues': [], 'isLast': True}),
        ])

        def search_request(payload):
            self.assertNotIn('startAt', payload)
            search_payloads.append(dict(payload))
            return next(responses)

        result = sprints.fetch_sprints_from_jira(
            board_id='42',
            stats_jql_base='project = "TEST" AND Sprint in openSprints()',
            product_project='PRODUCT',
            tech_project='TECH',
            jira_get=jira_get,
            jira_search_request=search_request,
            get_sprint_field_id=lambda: sprint_field,
            strip_sprint_clause=lambda jql: jql.replace(' AND Sprint in openSprints()', ''),
            add_clause_to_jql=lambda jql, clause: f'{jql} AND {clause}',
            auth_error_class=AuthError,
        )

        self.assertEqual([item['id'] for item in result], [301])
        self.assertEqual(search_payloads[0]['jql'], 'project = "TEST"')
        self.assertEqual(search_payloads[1]['nextPageToken'], 'page-2')
        self.assertEqual(board_calls[0][1]['params']['startAt'], 0)
        self.assertEqual(result[0]['startDate'], '2026-07-01T00:00:00.000Z')
        self.assertEqual(result[0]['endDate'], '2026-09-30T23:59:59.999Z')

    def test_save_cache_returns_false_on_write_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            warnings = []
            self.assertFalse(sprints.save_sprints_cache(
                [],
                cache_file=tmp,
                board_id='42',
                now_fn=lambda: datetime(2026, 5, 28, 12, 0, 0),
                log_warning_fn=warnings.append,
            ))
            self.assertEqual(len(warnings), 1)


if __name__ == '__main__':
    unittest.main()
