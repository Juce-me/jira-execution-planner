import json
import math
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import sprints
from backend.auth.jira_auth import AuthError
from backend.services.eng_board_measurement_runtime import MeasurementDeadlineExceeded
from backend.services.workspace_catalog_cache import _normalized_sprint_id


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(self._payload)

    def json(self):
        return self._payload


class RecordingBudget:
    def __init__(self, fail_after=None):
        self.checks = []
        self.fail_after = fail_after

    def check(self, phase):
        self.checks.append(phase)
        if self.fail_after is not None and len(self.checks) > self.fail_after:
            raise RuntimeError('budget exhausted')

    def remaining(self, phase):
        self.check(phase)
        return 30


class TestSprintService(unittest.TestCase):
    def test_db_board_empty_is_complete_without_issue_fallback(self):
        import jira_server

        budget = RecordingBudget()
        transport = SimpleNamespace(budget=budget)
        context = object()
        calls = []

        def current_get(path, **kwargs):
            calls.append((path, kwargs))
            return FakeResponse(200, {
                'values': [], 'startAt': 0, 'maxResults': 100, 'isLast': True,
            })

        with patch('jira_server.current_jira_get', side_effect=current_get), \
             patch('jira_server.jira_search_request', side_effect=AssertionError('issue fallback')), \
             patch('jira_server.fetch_teams_from_jira_api', side_effect=AssertionError('team fallback')), \
             patch('jira_server._build_epm_home_graphql_client', side_effect=AssertionError('home fallback')):
            result = jira_server.fetch_board_sprints(
                board_id='42', context=context, diagnostic_transport=transport, budget=budget,
            )

        self.assertEqual(result, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], '/rest/agile/1.0/board/42/sprint')
        self.assertEqual(calls[0][1]['params'], {
            'maxResults': 100, 'startAt': 0, 'state': 'active,future,closed',
        })
        self.assertIs(calls[0][1]['context'], context)
        self.assertIs(calls[0][1]['diagnostic_transport'], transport)

        with self.assertRaisesRegex(ValueError, 'refresh budget'):
            jira_server.fetch_board_sprints(
                board_id='42', context=context,
                diagnostic_transport=SimpleNamespace(budget=RecordingBudget()),
                budget=budget,
            )

    def test_db_board_pagination_requires_verified_last_page(self):
        calls = []
        responses = iter([
            FakeResponse(200, {
                'values': [{'id': 101, 'name': '2026Q1', 'state': 'closed'}],
                'startAt': 0, 'maxResults': 100, 'isLast': False,
            }),
            FakeResponse(200, {
                'values': [{'id': 102, 'name': '2026Q2', 'state': 'active'}],
                'startAt': 1, 'maxResults': 100, 'isLast': True,
            }),
        ])

        def jira_get(path, **kwargs):
            calls.append((path, kwargs))
            return next(responses)

        result = sprints.fetch_board_sprints(
            board_id='42', jira_get=jira_get, auth_error_class=AuthError,
            budget=RecordingBudget(),
        )

        self.assertEqual([item['id'] for item in result], [102, 101])
        self.assertEqual([call[1]['params']['startAt'] for call in calls], [0, 1])
        self.assertTrue(all(call[1]['params']['maxResults'] == 100 for call in calls))

        incomplete = iter([
            FakeResponse(200, {
                'values': [{'id': 101, 'name': '2026Q1', 'state': 'active'}],
                'startAt': 0, 'maxResults': 100, 'isLast': False,
            }),
            FakeResponse(503, {}),
        ])
        with self.assertRaises(sprints.SprintCatalogFetchError) as raised:
            sprints.fetch_board_sprints(
                board_id='42', jira_get=lambda *_args, **_kwargs: next(incomplete),
                auth_error_class=AuthError, budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'jira_unavailable')

        with self.assertRaises(AuthError) as raised:
            sprints.fetch_board_sprints(
                board_id='42', jira_get=lambda *_args, **_kwargs: FakeResponse(401, {}),
                auth_error_class=AuthError, budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'auth_required')

    def test_db_board_accepts_jira_capped_page_size(self):
        calls = []
        responses = iter([
            FakeResponse(200, {
                'values': [{'id': 101, 'name': '2026Q1', 'state': 'closed'}],
                'startAt': 0, 'maxResults': 50, 'isLast': False,
            }),
            FakeResponse(200, {
                'values': [{'id': 102, 'name': '2026Q2', 'state': 'active'}],
                'startAt': 1, 'maxResults': 50, 'isLast': True,
            }),
        ])

        def jira_get(_path, **kwargs):
            calls.append(kwargs['params'])
            return next(responses)

        result = sprints.fetch_board_sprints(
            board_id='42', jira_get=jira_get, auth_error_class=AuthError,
            budget=RecordingBudget(),
        )

        self.assertEqual([item['id'] for item in result], [102, 101])
        self.assertEqual([call['startAt'] for call in calls], [0, 1])
        self.assertTrue(all(call['maxResults'] == 100 for call in calls))

    def test_db_board_rejects_nonfinal_empty_and_malformed_values(self):
        invalid_pages = [
            {'values': [], 'startAt': 0, 'maxResults': 100, 'isLast': False},
            {'values': [], 'startAt': 0, 'maxResults': 0, 'isLast': True},
            {'values': [], 'startAt': 0, 'maxResults': -1, 'isLast': True},
            {'values': [], 'startAt': 0, 'maxResults': True, 'isLast': True},
            {'values': {}, 'startAt': 0, 'maxResults': 100, 'isLast': True},
            {'values': [], 'startAt': 0, 'maxResults': 100, 'isLast': 'true'},
            {'values': [None], 'startAt': 0, 'maxResults': 100, 'isLast': True},
            {'values': [{'id': 1}], 'startAt': 1, 'maxResults': 100, 'isLast': True},
            {
                'values': [{'id': math.nan, 'name': '2026Q1', 'state': 'active'}],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            },
            {
                'values': [{'id': 1, 'name': ['2026Q1'], 'state': 'active'}],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            },
            {
                'values': [{'id': 1, 'name': '2026Q1', 'state': {'name': 'active'}}],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            },
            {
                'values': [{'id': 1, 'name': '2026Q1', 'state': 'active', 'startDate': {}}],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            },
            {
                'values': [{'id': 1, 'name': '2026Q1', 'state': None}],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            },
            {
                'values': [{'id': 1, 'name': '2026Q1', 'state': 'active', 'originBoardId': '42'}],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            },
        ]
        for payload in invalid_pages:
            with self.subTest(payload=payload):
                with self.assertRaises(sprints.SprintCatalogFetchError) as raised:
                    sprints.fetch_board_sprints(
                        board_id='42', jira_get=lambda *_args, **_kwargs: FakeResponse(200, payload),
                        auth_error_class=AuthError, budget=RecordingBudget(),
                    )
                self.assertEqual(raised.exception.code, 'catalog_incomplete')

        with self.assertRaises(sprints.SprintCatalogFetchError) as raised:
            sprints.fetch_board_sprints(
                board_id='42', jira_get=lambda *_args, **_kwargs: object(),
                auth_error_class=AuthError, budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'catalog_incomplete')

        with self.assertRaises(ValueError):
            sprints.SprintCatalogFetchError('unexpected')

    def test_db_board_duplicate_name_winner_is_deterministic(self):
        payload = {
            'values': [
                {'id': 9, 'name': '2026Q2', 'state': 'future', 'originBoardId': 42},
                {'id': 8, 'name': '2026Q2', 'state': 'closed', 'originBoardId': 42},
                {'id': 7, 'name': '2026Q2', 'state': 'active', 'originBoardId': 42},
                {
                    'id': 6, 'name': '2026Q2', 'state': 'active',
                    'startDate': '2026-04-01T00:00:00.000Z',
                    'endDate': '2026-06-30T23:59:59.999Z',
                },
                {'id': 4, 'name': '2026Q3', 'state': 'closed', 'originBoardId': 42.0},
                {'id': 3, 'name': '2026Q3', 'state': 'future', 'originBoardId': 99},
                {'id': 2, 'name': '2026Q1', 'state': 'closed'},
                {'id': 0, 'name': '2026Q4', 'state': 'active'},
                {'id': True, 'name': '2025Q4', 'state': 'active'},
                {'id': 10, 'name': 'not-a-quarter', 'state': 'active'},
            ],
            'startAt': 0, 'maxResults': 100, 'isLast': True,
        }

        result = sprints.fetch_board_sprints(
            board_id='42', jira_get=lambda *_args, **_kwargs: FakeResponse(200, payload),
            auth_error_class=AuthError, budget=RecordingBudget(),
        )

        self.assertEqual([item['name'] for item in result], ['2026Q3', '2026Q2', '2026Q1'])
        self.assertEqual([item['id'] for item in result], [4, 6, 2])
        self.assertEqual(
            {_normalized_sprint_id(item['id']) for item in result},
            {'4', '6', '2'},
        )
        q2 = next(item for item in result if item['name'] == '2026Q2')
        self.assertEqual(q2['startDate'], '2026-04-01T00:00:00.000Z')
        self.assertEqual(q2['endDate'], '2026-06-30T23:59:59.999Z')

    def test_db_board_caps_do_not_publish_partial(self):
        page_calls = []

        def endless_pages(_path, **kwargs):
            start_at = kwargs['params']['startAt']
            page_calls.append(start_at)
            return FakeResponse(200, {
                'values': [{'id': start_at + 1, 'name': '2026Q1', 'state': 'active'}],
                'startAt': start_at, 'maxResults': 100, 'isLast': False,
            })

        with self.assertRaises(sprints.SprintCatalogFetchError) as raised:
            sprints.fetch_board_sprints(
                board_id='42', jira_get=endless_pages, auth_error_class=AuthError,
                budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'catalog_incomplete')
        self.assertEqual(len(page_calls), 100)

        row_cap_calls = []

        def over_row_cap(_path, **kwargs):
            start_at = kwargs['params']['startAt']
            row_cap_calls.append(start_at)
            size = 1 if start_at == 10000 else 100
            return FakeResponse(200, {
                'values': [
                    {'id': start_at + index + 1, 'name': '2026Q1', 'state': 'active'}
                    for index in range(size)
                ],
                'startAt': start_at,
                'maxResults': 100,
                'isLast': start_at == 10000,
            })

        with patch.object(sprints, 'BOARD_SPRINT_MAX_PAGES', 101), \
             self.assertRaises(sprints.SprintCatalogFetchError) as raised:
            sprints.fetch_board_sprints(
                board_id='42', jira_get=over_row_cap,
                auth_error_class=AuthError, budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'catalog_incomplete')
        self.assertEqual(len(row_cap_calls), 101)
        self.assertEqual(row_cap_calls[-1], 10000)

        overfull_page = {
            'values': [
                {'id': index + 1, 'name': '2026Q1', 'state': 'active'}
                for index in range(101)
            ],
            'startAt': 0, 'maxResults': 100, 'isLast': True,
        }
        with self.assertRaises(sprints.SprintCatalogFetchError) as raised:
            sprints.fetch_board_sprints(
                board_id='42', jira_get=lambda *_args, **_kwargs: FakeResponse(200, overfull_page),
                auth_error_class=AuthError, budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'catalog_incomplete')

    def test_db_board_budget_stops_next_page(self):
        calls = []

        class TwoCheckpointBudget:
            def __init__(self):
                self.checks = 0

            def check(self, _phase):
                self.checks += 1
                if self.checks >= 3:
                    raise RuntimeError('budget exhausted')

            def remaining(self, _phase):
                return 30

        def jira_get(_path, **_kwargs):
            calls.append(True)
            return FakeResponse(200, {
                'values': [{'id': 101, 'name': '2026Q1', 'state': 'active'}],
                'startAt': 0, 'maxResults': 100, 'isLast': False,
            })

        with self.assertRaisesRegex(RuntimeError, 'budget exhausted'):
            sprints.fetch_board_sprints(
                board_id='42', jira_get=jira_get, auth_error_class=AuthError,
                budget=TwoCheckpointBudget(),
            )
        self.assertEqual(len(calls), 1)

        deadline = MeasurementDeadlineExceeded('catalog')
        with self.assertRaises(MeasurementDeadlineExceeded) as raised:
            sprints.fetch_board_sprints(
                board_id='42',
                jira_get=lambda *_args, **_kwargs: (_ for _ in ()).throw(deadline),
                auth_error_class=AuthError,
                budget=RecordingBudget(),
            )
        self.assertIs(raised.exception, deadline)

        transport_error = OSError('connection failed')
        with self.assertRaises(sprints.SprintCatalogFetchError) as raised:
            sprints.fetch_board_sprints(
                board_id='42',
                jira_get=lambda *_args, **_kwargs: (_ for _ in ()).throw(transport_error),
                auth_error_class=AuthError,
                budget=RecordingBudget(),
            )
        self.assertEqual(raised.exception.code, 'jira_unavailable')
        self.assertIs(raised.exception.__cause__, transport_error)

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
        self.assertEqual(search_payloads[0]['jql'], 'project = "TEST" AND Sprint is not EMPTY')
        self.assertEqual(search_payloads[1]['nextPageToken'], 'page-2')
        self.assertEqual(len(search_payloads), 2)
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
