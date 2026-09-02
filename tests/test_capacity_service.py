import unittest

from backend.auth.jira_auth import AuthError
from backend.services import capacity


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or str(self._payload)

    def json(self):
        return self._payload


class TestCapacityService(unittest.TestCase):
    def test_build_capacity_jql_escapes_sprint_and_team_names(self):
        self.assertEqual(
            capacity.build_capacity_jql('Sprint "42"', ['Alpha "A"', ' ', 'Beta'], capacity_project='CAP'),
            'project = "CAP" AND (summary ~ "\\"Team info Sprint \\"42\\" - Alpha \\"A\\"\\"" OR summary ~ "\\"Team info Sprint \\"42\\" - Beta\\"")',
        )

    def test_fetch_capacity_disabled_when_project_or_field_missing(self):
        self.assertEqual(
            capacity.fetch_capacity_for_sprint(
                '2026Q2',
                None,
                capacity_project='',
                capacity_field_id='customfield_capacity',
                search_request=lambda _payload: self.fail('should not search'),
            ),
            ({'enabled': False, 'capacities': {}, 'entries': [], 'mutationEnabled': False}, None),
        )
        self.assertEqual(
            capacity.fetch_capacity_for_sprint(
                '2026Q2',
                None,
                capacity_project='CAP',
                capacity_field_id='',
                search_request=lambda _payload: self.fail('should not search'),
            ),
            ({
                'enabled': False,
                'capacities': {},
                'entries': [],
                'mutationEnabled': False,
                'message': 'Missing Team capacity field ID',
            }, None),
        )

    def test_fetch_capacity_chunks_teams_and_returns_debug_payload(self):
        calls = []

        def search_request(payload):
            calls.append(payload)
            return FakeResponse(200, {
                'issues': [{
                    'key': 'CAP-1',
                    'fields': {
                        'summary': 'Team info 2026Q2 - R&D Product - Alpha',
                        'customfield_capacity': '5.5',
                    },
                }]
            })

        payload, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            debug=True,
            team_names=[f'Team {idx}' for idx in range(21)],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=search_request,
        )

        self.assertIsNone(error)
        self.assertEqual(len(calls), 2)
        self.assertEqual(payload['capacities'], {'Alpha': 5.5})
        self.assertEqual(payload['entries'], [{'teamName': 'Alpha', 'issueKey': 'CAP-1', 'capacity': 5.5}])
        self.assertFalse(payload['mutationEnabled'])
        self.assertEqual(payload['debug']['issueCount'], 2)
        self.assertEqual(payload['debug']['fieldId'], 'customfield_capacity')
        self.assertIsInstance(payload['debug']['jql'], list)

    def test_fetch_capacity_returns_fixed_error_without_upstream_text(self):
        payload, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=lambda _payload: FakeResponse(500, text='synthetic-secret-like-value'),
        )

        self.assertIsNone(payload)
        self.assertEqual(error, 'jira_capacity_fetch_failed')

    def test_capacity_read_exhausts_token_pages_and_preserves_later_duplicate_target(self):
        calls = []

        def search_request(payload):
            calls.append(payload)
            if len(calls) == 1:
                return FakeResponse(200, {
                    'issues': [{
                        'key': 'CAP-101',
                        'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 5},
                    }],
                    'isLast': False,
                    'nextPageToken': 'synthetic-page-2',
                })
            return FakeResponse(200, {
                'issues': [{
                    'key': 'CAP-102',
                    'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 6},
                }],
                'isLast': True,
            })

        result, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            team_names=['Alpha'],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=search_request,
        )

        self.assertIsNone(error)
        self.assertEqual(result['entries'], [
            {'teamName': 'Alpha', 'issueKey': 'CAP-101', 'capacity': 5.0},
            {'teamName': 'Alpha', 'issueKey': 'CAP-102', 'capacity': 6.0},
        ])
        self.assertEqual(len(calls), 2)
        self.assertNotIn('nextPageToken', calls[0])
        self.assertEqual(calls[1]['nextPageToken'], 'synthetic-page-2')
        for payload in calls:
            self.assertNotIn('startAt', payload)
            self.assertNotIn('total', payload)

    def test_capacity_read_stops_at_per_chunk_page_bound_with_fixed_error(self):
        calls = []

        def search_request(payload):
            calls.append(payload)
            return FakeResponse(200, {
                'issues': [],
                'isLast': False,
                'nextPageToken': f'synthetic-secret-page-{len(calls) + 1}',
            }, text='synthetic-secret-upstream-detail')

        result, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            team_names=['Alpha'],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=search_request,
            max_pages_per_chunk=2,
        )

        self.assertIsNone(result)
        self.assertEqual(error, 'jira_capacity_fetch_failed')
        self.assertNotIn('secret', error)
        self.assertEqual(len(calls), 2)

    def test_capacity_read_sanitizes_search_request_exceptions(self):
        def search_request(_payload):
            raise RuntimeError('synthetic-secret-upstream-detail')

        result, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            team_names=['Alpha'],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=search_request,
        )

        self.assertIsNone(result)
        self.assertEqual(error, 'jira_capacity_fetch_failed')
        self.assertNotIn('secret', error)

    def test_capacity_read_rejects_a_page_above_the_per_chunk_fanout_bound(self):
        oversized_page = {
            'issues': [
                {
                    'key': f'CAP-{index}',
                    'fields': {
                        'summary': f'Team info 2026Q2 - Team {index}',
                        'customfield_capacity': index,
                    },
                }
                for index in range(201)
            ],
            'isLast': True,
        }

        result, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            team_names=['Alpha'],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=lambda _payload: FakeResponse(200, oversized_page),
        )

        self.assertIsNone(result)
        self.assertEqual(error, 'jira_capacity_fetch_failed')

    def test_capacity_read_raises_typed_raw_401_on_first_and_later_pages(self):
        for failing_page in (1, 2):
            calls = []

            def search_request(payload):
                calls.append(payload)
                if len(calls) == failing_page:
                    return FakeResponse(401, text='synthetic-secret-upstream-detail')
                return FakeResponse(200, {
                    'issues': [],
                    'isLast': False,
                    'nextPageToken': 'synthetic-page-2',
                })

            with self.subTest(failing_page=failing_page), self.assertRaises(Exception) as raised:
                capacity.fetch_capacity_for_sprint(
                    '2026Q2',
                    None,
                    team_names=['Alpha'],
                    capacity_project='CAP',
                    capacity_field_id='customfield_capacity',
                    search_request=search_request,
                )

            signal_type = getattr(capacity, 'CapacityUpstreamUnauthorized', None)
            self.assertIsNotNone(signal_type)
            self.assertIs(type(raised.exception), signal_type)
            self.assertNotIn('secret', str(raised.exception))
            self.assertEqual(len(calls), failing_page)
            if failing_page == 2:
                self.assertEqual(calls[1]['nextPageToken'], 'synthetic-page-2')

    def test_capacity_read_keeps_zero_and_blank_issue_targets(self):
        payload = {
            'issues': [
                {'key': 'CAP-101', 'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 0}},
                {'key': 'CAP-102', 'fields': {'summary': 'Team info 2026Q2 - Beta', 'customfield_capacity': None}},
            ]
        }

        result, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            team_names=['Alpha', 'Beta'],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=lambda _payload: FakeResponse(200, payload),
        )

        self.assertIsNone(error)
        self.assertEqual(result['capacities'], {'Alpha': 0.0})
        self.assertEqual(result['entries'], [
            {'teamName': 'Alpha', 'issueKey': 'CAP-101', 'capacity': 0.0},
            {'teamName': 'Beta', 'issueKey': 'CAP-102', 'capacity': None},
        ])

    def test_capacity_read_deduplicates_issue_keys_and_keeps_invalid_targets(self):
        calls = []
        huge_integer = 10 ** 10000

        def search_request(_payload):
            calls.append(_payload)
            if len(calls) == 1:
                return FakeResponse(200, {
                    'issues': [{
                        'key': 'CAP-101',
                        'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 3},
                    }],
                })
            return FakeResponse(200, {
                'issues': [
                    {
                        'key': 'cap-101',
                        'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 99},
                    },
                    {
                        'key': 'CAP-103',
                        'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 4},
                    },
                    {
                        'key': 'CAP-104',
                        'fields': {'summary': 'Team info 2026Q2 - Blank', 'customfield_capacity': ''},
                    },
                    {
                        'key': 'CAP-105',
                        'fields': {'summary': 'Team info 2026Q2 - Negative', 'customfield_capacity': -1},
                    },
                    {
                        'key': 'CAP-106',
                        'fields': {'summary': 'Team info 2026Q2 - Non-finite', 'customfield_capacity': float('nan')},
                    },
                    {
                        'key': 'CAP-107',
                        'fields': {'summary': 'Team info 2026Q2 - Huge', 'customfield_capacity': huge_integer},
                    },
                ],
            }, text='synthetic capacity response')

        result, error = capacity.fetch_capacity_for_sprint(
            '2026Q2',
            None,
            team_names=[f'Team {index}' for index in range(21)],
            capacity_project='CAP',
            capacity_field_id='customfield_capacity',
            search_request=search_request,
        )

        self.assertIsNone(error)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['capacities'], {'Alpha': 4.0})
        self.assertEqual(result['entries'], [
            {'teamName': 'Alpha', 'issueKey': 'CAP-101', 'capacity': 3.0},
            {'teamName': 'Alpha', 'issueKey': 'CAP-103', 'capacity': 4.0},
            {'teamName': 'Blank', 'issueKey': 'CAP-104', 'capacity': None},
            {'teamName': 'Negative', 'issueKey': 'CAP-105', 'capacity': None},
            {'teamName': 'Non-finite', 'issueKey': 'CAP-106', 'capacity': None},
            {'teamName': 'Huge', 'issueKey': 'CAP-107', 'capacity': None},
        ])

    def test_fetch_capacity_team_sizes_uses_watches_and_watcher_fallback(self):
        watcher_calls = []

        def watcher_count(issue_key):
            watcher_calls.append(issue_key)
            return 4

        payload = {
            'issues': [
                {
                    'key': 'CAP-1',
                    'fields': {
                        'summary': 'Team info 2026Q2 - Alpha',
                        'watches': {'watchCount': 3},
                        'reporter': {'displayName': 'Owner A'},
                    },
                },
                {
                    'key': 'CAP-2',
                    'fields': {
                        'summary': 'Team info 2026Q2 - Tech - Beta',
                        'watches': {},
                        'reporter': {'displayName': 'Owner B'},
                    },
                },
            ],
        }

        sizes, details = capacity.fetch_capacity_team_sizes(
            '2026Q2',
            None,
            capacity_project='CAP',
            search_request=lambda _payload: FakeResponse(200, payload),
            fetch_watchers_count=watcher_count,
        )

        self.assertEqual(sizes, {'Alpha': 3, 'Beta': 4})
        self.assertEqual(details['Alpha']['reporter'], 'Owner A')
        self.assertEqual(details['Beta']['issue_key'], 'CAP-2')
        self.assertEqual(watcher_calls, ['CAP-2'])

    def test_capacity_team_size_read_exhausts_next_page_tokens(self):
        calls = []

        def search_request(payload):
            calls.append(payload)
            if len(calls) == 1:
                return FakeResponse(200, {
                    'issues': [{
                        'key': 'CAP-1',
                        'fields': {
                            'summary': 'Team info 2026Q2 - Alpha',
                            'watches': {'watchCount': 3},
                        },
                    }],
                    'isLast': False,
                    'nextPageToken': 'synthetic-size-page-2',
                })
            return FakeResponse(200, {
                'issues': [{
                    'key': 'CAP-2',
                    'fields': {
                        'summary': 'Team info 2026Q2 - Beta',
                        'watches': {'watchCount': 4},
                    },
                }],
                'isLast': True,
            })

        sizes, details = capacity.fetch_capacity_team_sizes(
            '2026Q2',
            None,
            team_names=['Alpha', 'Beta'],
            capacity_project='CAP',
            search_request=search_request,
        )

        self.assertEqual(sizes, {'Alpha': 3, 'Beta': 4})
        self.assertEqual(set(details), {'Alpha', 'Beta'})
        self.assertEqual(calls[1]['nextPageToken'], 'synthetic-size-page-2')

    def test_fetch_watchers_count_handles_counts_lists_and_errors(self):
        self.assertEqual(
            capacity.fetch_watchers_count(
                'CAP-1',
                current_jira_get=lambda _path, timeout=20: FakeResponse(200, {'watchCount': 7}),
            ),
            7,
        )
        self.assertEqual(
            capacity.fetch_watchers_count(
                'CAP-1',
                current_jira_get=lambda _path, timeout=20: FakeResponse(200, {'watchers': [{}, {}]}),
            ),
            2,
        )
        warnings = []
        self.assertIsNone(
            capacity.fetch_watchers_count(
                'CAP-1',
                current_jira_get=lambda _path, timeout=20: FakeResponse(404, {}),
                log_warning_fn=warnings.append,
            )
        )
        self.assertEqual(warnings, ['Watchers fetch failed: status=404'])


class TestCapacityIssueUpdates(unittest.TestCase):
    def _payload(self, **overrides):
        payload = {
            'sprintName': '2026Q2',
            'teamName': 'R&D Alpha',
            'expectedCapacity': 5.5,
            'capacity': 6,
        }
        payload.update(overrides)
        return payload

    def _issue(self, *, project='CAP', summary='Team info 2026Q2 - Tech - Alpha', current=5.5):
        return {
            'key': 'CAP-101',
            'fields': {
                'project': {'key': project},
                'summary': summary,
                'customfield_capacity': current,
            },
        }

    def _assert_service_error(self, code, status_code, call, *, current_capacity=None):
        with self.assertRaises(capacity.CapacityServiceError) as raised:
            call()
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(raised.exception.status_code, status_code)
        self.assertEqual(raised.exception.current_capacity, current_capacity)

    def test_update_rejects_invalid_issue_key_before_jira_call(self):
        for issue_key in ('', 'cap 101', 'C-1', 'CAP-', 'CAP-1-extra'):
            with self.subTest(issue_key=issue_key):
                calls = []
                with self.assertRaises(capacity.CapacityInputError) as raised:
                    capacity.update_capacity_issue(
                        issue_key,
                        self._payload(),
                        capacity_project='CAP',
                        capacity_field_id='customfield_capacity',
                        jira_request=lambda *args, **kwargs: calls.append((args, kwargs)),
                    )
                self.assertEqual(raised.exception.code, 'invalid_issue_key')
                self.assertEqual(calls, [])

    def test_update_requires_nonblank_sprint_and_team_before_jira_call(self):
        for field_name, value in (
            ('sprintName', None),
            ('sprintName', ''),
            ('sprintName', '   '),
            ('teamName', None),
            ('teamName', ''),
            ('teamName', '   '),
        ):
            with self.subTest(field_name=field_name, value=value):
                calls = []
                with self.assertRaises(capacity.CapacityInputError) as raised:
                    capacity.update_capacity_issue(
                        'CAP-101',
                        self._payload(**{field_name: value}),
                        capacity_project='CAP',
                        capacity_field_id='customfield_capacity',
                        jira_request=lambda *args, **kwargs: calls.append((args, kwargs)),
                    )
                self.assertEqual(raised.exception.code, 'capacity_identity_required')
                self.assertEqual(calls, [])

    def test_update_rejects_missing_or_invalid_client_capacities_before_jira_call(self):
        huge_integer = 10 ** 10000
        cases = [
            ('missing expected', {}, 'invalid_capacity'),
            ('capacity true', {'capacity': True}, 'invalid_capacity'),
            ('capacity string', {'capacity': '5'}, 'invalid_capacity'),
            ('capacity none', {'capacity': None}, 'invalid_capacity'),
            ('capacity negative', {'capacity': -1}, 'invalid_capacity'),
            ('capacity nan', {'capacity': float('nan')}, 'invalid_capacity'),
            ('capacity infinity', {'capacity': float('inf')}, 'invalid_capacity'),
            ('capacity overflow', {'capacity': huge_integer}, 'invalid_capacity'),
            ('expected true', {'expectedCapacity': True}, 'invalid_capacity'),
            ('expected string', {'expectedCapacity': '5'}, 'invalid_capacity'),
            ('expected negative', {'expectedCapacity': -1}, 'invalid_capacity'),
            ('expected nan', {'expectedCapacity': float('nan')}, 'invalid_capacity'),
            ('expected infinity', {'expectedCapacity': float('inf')}, 'invalid_capacity'),
            ('expected overflow', {'expectedCapacity': huge_integer}, 'invalid_capacity'),
        ]
        for label, overrides, expected_code in cases:
            with self.subTest(label=label):
                calls = []
                payload = self._payload(**overrides)
                if label == 'missing expected':
                    del payload['expectedCapacity']
                with self.assertRaises(capacity.CapacityInputError) as raised:
                    capacity.update_capacity_issue(
                        'CAP-101',
                        payload,
                        capacity_project='CAP',
                        capacity_field_id='customfield_capacity',
                        jira_request=lambda *args, **kwargs: calls.append((args, kwargs)),
                    )
                self.assertEqual(raised.exception.code, expected_code)
                self.assertEqual(calls, [])

    def test_update_rejects_missing_config_before_jira_call(self):
        for project, field_id in (('', 'customfield_capacity'), ('CAP', ''), ('  ', 'field')):
            with self.subTest(project=project, field_id=field_id):
                calls = []
                self._assert_service_error(
                    'capacity_config_missing',
                    409,
                    lambda: capacity.update_capacity_issue(
                        'CAP-101',
                        self._payload(),
                        capacity_project=project,
                        capacity_field_id=field_id,
                        jira_request=lambda *args, **kwargs: calls.append((args, kwargs)),
                    ),
                )
                self.assertEqual(calls, [])

    def test_update_maps_validation_get_statuses_without_a_put(self):
        cases = ((403, 'capacity_forbidden', 403), (404, 'capacity_issue_not_found', 404), (503, 'jira_capacity_update_failed', 502))
        for status_code, expected_code, expected_status in cases:
            with self.subTest(status_code=status_code):
                calls = []

                def jira_request(method, path, **kwargs):
                    calls.append((method, path, kwargs))
                    return FakeResponse(status_code, text='synthetic upstream detail')

                self._assert_service_error(
                    expected_code,
                    expected_status,
                    lambda: capacity.update_capacity_issue(
                        'CAP-101', self._payload(), capacity_project='CAP',
                        capacity_field_id='customfield_capacity', jira_request=jira_request,
                    ),
                )
                self.assertEqual([call[0] for call in calls], ['GET'])

    def test_update_propagates_auth_errors_from_validation_get_and_put(self):
        for failing_method in ('GET', 'PUT'):
            with self.subTest(failing_method=failing_method):
                auth_error = AuthError('auth_connection_stale', 'Synthetic fixed recovery message')

                def jira_request(method, _path, **_kwargs):
                    if method == failing_method:
                        raise auth_error
                    return FakeResponse(200, self._issue())

                with self.assertRaises(AuthError) as raised:
                    capacity.update_capacity_issue(
                        'CAP-101', self._payload(), capacity_project='CAP',
                        capacity_field_id='customfield_capacity', jira_request=jira_request,
                    )
                self.assertIs(raised.exception, auth_error)

    def test_update_maps_upstream_401_get_and_put_to_fixed_auth_required(self):
        for failing_method in ('GET', 'PUT'):
            with self.subTest(failing_method=failing_method):
                def jira_request(method, _path, **_kwargs):
                    if method == failing_method:
                        return FakeResponse(401, text='synthetic-secret-upstream-detail')
                    return FakeResponse(200, self._issue())

                with self.assertRaises(AuthError) as raised:
                    capacity.update_capacity_issue(
                        'CAP-101', self._payload(), capacity_project='CAP',
                        capacity_field_id='customfield_capacity', jira_request=jira_request,
                    )
                self.assertEqual(raised.exception.code, 'auth_required')
                self.assertNotIn('secret', str(raised.exception))

    def test_update_rejects_project_sprint_and_normalized_team_mismatches(self):
        cases = (
            ('project', self._issue(project='OTHER')),
            ('sprint', self._issue(summary='Team info 2026Q3 - Tech - Alpha')),
            ('team', self._issue(summary='Team info 2026Q2 - Tech - Beta')),
            ('summary format', self._issue(summary='Capacity 2026Q2 Alpha')),
        )
        for label, issue in cases:
            with self.subTest(label=label):
                calls = []

                def jira_request(method, path, **kwargs):
                    calls.append((method, path, kwargs))
                    return FakeResponse(200, issue)

                self._assert_service_error(
                    'capacity_issue_mismatch',
                    409,
                    lambda: capacity.update_capacity_issue(
                        'CAP-101', self._payload(), capacity_project=' cap ',
                        capacity_field_id='customfield_capacity', jira_request=jira_request,
                    ),
                )
                self.assertEqual([call[0] for call in calls], ['GET'])

    def test_update_repairs_invalid_jira_values_against_a_null_baseline(self):
        for raw_value in (-1, float('nan'), float('inf'), 'not a number'):
            with self.subTest(raw_value=raw_value):
                calls = []

                def jira_request(method, path, **kwargs):
                    calls.append((method, path, kwargs))
                    if method == 'GET':
                        return FakeResponse(200, self._issue(current=raw_value))
                    return FakeResponse(204, {})

                result = capacity.update_capacity_issue(
                    'CAP-101', self._payload(expectedCapacity=None), capacity_project='CAP',
                    capacity_field_id='customfield_capacity', jira_request=jira_request,
                )
                self.assertEqual(result['previousCapacity'], None)
                self.assertEqual(result['result'], 'success')
                self.assertEqual([call[0] for call in calls], ['GET', 'PUT'])

    def test_update_rejects_stale_baseline_with_current_capacity_only(self):
        calls = []

        def jira_request(method, path, **kwargs):
            calls.append((method, path, kwargs))
            return FakeResponse(200, self._issue(current=6))

        self._assert_service_error(
            'capacity_conflict',
            409,
            lambda: capacity.update_capacity_issue(
                'CAP-101', self._payload(capacity=7), capacity_project='CAP',
                capacity_field_id='customfield_capacity', jira_request=jira_request,
            ),
            current_capacity=6.0,
        )
        self.assertEqual([call[0] for call in calls], ['GET'])

    def test_update_returns_already_current_before_stale_baseline_check(self):
        calls = []

        def jira_request(method, path, **kwargs):
            calls.append((method, path, kwargs))
            return FakeResponse(200, self._issue(current=6))

        result = capacity.update_capacity_issue(
            'cap-101', self._payload(expectedCapacity=5.5), capacity_project='CAP',
            capacity_field_id='customfield_capacity', jira_request=jira_request,
        )
        self.assertEqual(result, {
            'issueKey': 'CAP-101',
            'teamName': 'Alpha',
            'previousCapacity': 6.0,
            'capacity': 6.0,
            'result': 'already_current',
        })
        self.assertEqual([call[0] for call in calls], ['GET'])

    def test_update_puts_only_configured_field_after_validated_snapshot(self):
        calls = []
        context = object()

        def jira_request(method, path, **kwargs):
            calls.append((method, path, kwargs))
            if len(calls) == 1:
                return FakeResponse(200, self._issue())
            return FakeResponse(204, {})

        result = capacity.update_capacity_issue(
            'cap-101', self._payload(), capacity_project='CAP',
            capacity_field_id='customfield_capacity', jira_request=jira_request, context=context,
        )
        self.assertEqual(result, {
            'issueKey': 'CAP-101',
            'teamName': 'Alpha',
            'previousCapacity': 5.5,
            'capacity': 6.0,
            'result': 'success',
        })
        self.assertEqual(calls[0], (
            'GET',
            '/rest/api/3/issue/CAP-101',
            {'params': {'fields': 'project,summary,customfield_capacity'}, 'context': context},
        ))
        self.assertEqual(calls[1][2], {
            'json_body': {'fields': {'customfield_capacity': 6.0}},
            'context': context,
        })

    def test_update_maps_put_statuses(self):
        cases = ((400, 'capacity_field_not_editable', 409), (403, 'capacity_forbidden', 403), (404, 'capacity_issue_not_found', 404), (503, 'jira_capacity_update_failed', 502))
        for status_code, expected_code, expected_status in cases:
            with self.subTest(status_code=status_code):
                calls = []

                def jira_request(method, path, **kwargs):
                    calls.append((method, path, kwargs))
                    return FakeResponse(200, self._issue()) if method == 'GET' else FakeResponse(status_code)

                self._assert_service_error(
                    expected_code,
                    expected_status,
                    lambda: capacity.update_capacity_issue(
                        'CAP-101', self._payload(), capacity_project='CAP',
                        capacity_field_id='customfield_capacity', jira_request=jira_request,
                    ),
                )
                self.assertEqual([call[0] for call in calls], ['GET', 'PUT'])

    def test_update_reconciles_put_conflicts_with_one_scoped_get(self):
        cases = (
            ('target already applied', 6, None),
            ('remote value changed', 7, ('capacity_conflict', 409, 7.0)),
            ('baseline unchanged', 5.5, ('jira_capacity_update_conflict', 502, None)),
        )
        for label, latest_value, expected_error in cases:
            with self.subTest(label=label):
                calls = []

                def jira_request(method, path, **kwargs):
                    calls.append((method, path, kwargs))
                    if method == 'PUT':
                        return FakeResponse(409)
                    return FakeResponse(200, self._issue(current=5.5 if len(calls) == 1 else latest_value))

                if expected_error is None:
                    result = capacity.update_capacity_issue(
                        'CAP-101', self._payload(), capacity_project='CAP',
                        capacity_field_id='customfield_capacity', jira_request=jira_request,
                    )
                    self.assertEqual(result['result'], 'already_current')
                    self.assertEqual(result['previousCapacity'], 6.0)
                else:
                    code, status_code, current_capacity = expected_error
                    self._assert_service_error(
                        code,
                        status_code,
                        lambda: capacity.update_capacity_issue(
                            'CAP-101', self._payload(), capacity_project='CAP',
                            capacity_field_id='customfield_capacity', jira_request=jira_request,
                        ),
                        current_capacity=current_capacity,
                    )
                self.assertEqual([call[0] for call in calls], ['GET', 'PUT', 'GET'])
                self.assertEqual(calls[2][2]['params'], {'fields': 'project,summary,customfield_capacity'})

    def test_update_documents_best_effort_lost_update_window(self):
        calls = []
        remote_capacity = {'value': 5.5}

        def jira_request(method, path, **kwargs):
            calls.append((method, path, kwargs))
            if method == 'GET':
                return FakeResponse(200, self._issue(current=remote_capacity['value']))
            remote_capacity['value'] = 9.0  # Remote edit after validation GET, before unconditional PUT.
            remote_capacity['value'] = kwargs['json_body']['fields']['customfield_capacity']
            return FakeResponse(204, {})

        result = capacity.update_capacity_issue(
            'CAP-101', self._payload(), capacity_project='CAP',
            capacity_field_id='customfield_capacity', jira_request=jira_request,
        )
        self.assertEqual(result['result'], 'success')
        self.assertEqual(remote_capacity['value'], 6.0)
        self.assertEqual([call[0] for call in calls], ['GET', 'PUT'])


if __name__ == '__main__':
    unittest.main()
