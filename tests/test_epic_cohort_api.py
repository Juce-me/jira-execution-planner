import unittest
from unittest.mock import patch
from datetime import date

from tests.auth_mode_test_utils import force_basic_auth_mode

try:
    import jira_server
    from backend.services import eng_board, epic_cohort_closed
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


class DummyResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortHelpers(unittest.TestCase):
    def test_month_dates_from_iso(self):
        start, end = jira_server.month_dates_from_iso('2025-03')
        self.assertEqual(start, date(2025, 3, 1))
        self.assertEqual(end, date(2025, 3, 31))

    def test_month_dates_leap_year(self):
        start, end = jira_server.month_dates_from_iso('2024-02')
        self.assertEqual(start, date(2024, 2, 1))
        self.assertEqual(end, date(2024, 2, 29))

    def test_generate_period_labels_quarter(self):
        labels = jira_server.generate_period_labels('2025Q1', '2026Q1', 'quarter')
        self.assertEqual(labels, ['2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1'])

    def test_generate_period_labels_month(self):
        labels = jira_server.generate_period_labels('2025Q1', '2025Q2', 'month')
        self.assertEqual(labels[:3], ['2025-01', '2025-02', '2025-03'])
        self.assertEqual(labels[-1], '2025-06')

    def test_assign_to_period(self):
        sample = date(2025, 8, 14)
        self.assertEqual(jira_server.assign_to_period(sample, 'quarter'), '2025Q3')
        self.assertEqual(jira_server.assign_to_period(sample, 'month'), '2025-08')

    def test_elapsed_period_index(self):
        created = date(2025, 1, 1)
        resolved = date(2025, 8, 20)
        self.assertEqual(jira_server.compute_elapsed_period_index(created, resolved, 'quarter'), 2)
        self.assertEqual(jira_server.compute_elapsed_period_index(created, resolved, 'month'), 7)

    def test_postponed_is_terminal(self):
        self.assertEqual(jira_server.normalize_epic_status('Postponed'), 'Postponed')
        self.assertTrue(jira_server.is_terminal_epic_status('Postponed'))

    def test_cache_key_includes_normalized_ad_hoc_signature(self):
        base = jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q2', ['T1'], ['PRODUCT'])
        with_ad_hoc = jira_server._build_epic_cohort_cache_key(
            '2025Q1', '2025Q2', ['T1'], ['PRODUCT'], ad_hoc_epics=['tech-9', 'TECH-9']
        )
        self.assertNotEqual(base, with_ad_hoc)
        # Normalization is order- and case-insensitive after dedupe.
        reordered = jira_server._build_epic_cohort_cache_key(
            '2025Q1', '2025Q2', ['T1'], ['PRODUCT'], ad_hoc_epics=['TECH-9', 'tech-9']
        )
        self.assertEqual(with_ad_hoc, reordered)

    def test_cache_key_distinguishes_end_quarter(self):
        q1 = jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q1', ['T1'], ['PRODUCT'])
        q2 = jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q2', ['T1'], ['PRODUCT'])
        self.assertNotEqual(q1, q2)

    def test_cache_key_created_mode_is_unchanged(self):
        self.assertEqual(
            jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q2', ['T1'], ['PRODUCT']),
            '2025Q1::2025Q2::T1::PRODUCT::no-components::no-adhoc',
        )

    def test_cache_key_differs_per_mode(self):
        created = jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q2', ['T1'], ['PRODUCT'], ['Alpha'])
        closed_key = jira_server._build_epic_cohort_cache_key(
            '2025Q1', '2025Q2', ['T1'], ['PRODUCT'], ['Alpha'], mode='closed')
        last_n = jira_server._build_epic_cohort_cache_key('', '', ['T1'], ['PRODUCT'], ['Alpha'], mode='last_n')
        self.assertEqual(len({created, closed_key, last_n}), 3)
        self.assertTrue(closed_key.startswith('closed::'))
        self.assertTrue(last_n.startswith('last_n::'))

    def test_parse_request_defaults_to_created_and_keeps_the_capped_range(self):
        parsed = jira_server.parse_epic_cohort_request(
            {'startQuarter': '2026Q1', 'endQuarter': '2026Q2'}, reference_date=date(2026, 5, 14))
        self.assertEqual(parsed['mode'], 'created')
        self.assertEqual((parsed['startDate'], parsed['endDate']), (date(2026, 1, 1), date(2026, 5, 14)))

    def test_parse_request_closed_end_is_not_capped_at_today(self):
        parsed = jira_server.parse_epic_cohort_request(
            {'mode': 'closed', 'startQuarter': '2026Q1', 'endQuarter': '2026Q2'}, reference_date=date(2026, 5, 14))
        self.assertEqual(parsed['mode'], 'closed')
        self.assertEqual((parsed['startDate'], parsed['endDate']), (date(2026, 1, 1), date(2026, 6, 30)))

    def test_parse_request_last_n_has_no_quarters(self):
        parsed = jira_server.parse_epic_cohort_request({'mode': 'last_n'})
        self.assertEqual(parsed, {
            'mode': 'last_n', 'startQuarter': '', 'endQuarter': '', 'startDate': None, 'endDate': None})

    def test_resolve_epic_cohort_range_includes_historical_end_quarter(self):
        start, end = jira_server.resolve_epic_cohort_range(
            '2025Q1', '2025Q2', reference_date=date(2026, 7, 13)
        )
        self.assertEqual(start, date(2025, 1, 1))
        self.assertEqual(end, date(2025, 6, 30))

    def test_resolve_epic_cohort_range_caps_current_quarter_at_today(self):
        start, end = jira_server.resolve_epic_cohort_range(
            '2026Q1', '2026Q2', reference_date=date(2026, 5, 14)
        )
        self.assertEqual(start, date(2026, 1, 1))
        self.assertEqual(end, date(2026, 5, 14))


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortFetch(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)

    def _epic(self, key, created='2025-01-10', status='Done', resolution='2025-02-15'):
        return {
            'key': key,
            'fields': {
                'summary': f'Epic {key}',
                'created': f'{created}T10:00:00.000+0000',
                'status': {'name': status},
                'resolutiondate': f'{resolution}T10:00:00.000+0000' if resolution else None,
                'assignee': {'accountId': 'u1', 'displayName': 'Alice'},
                'project': {'key': 'PRODUCT'},
                'customfield_30101': {'id': 'T1', 'name': 'Team A'}
            }
        }

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_fetch_uses_next_page_token_pagination(self, mock_search, _mock_scope):
        first_page = DummyResponse({
            'issues': [self._epic('PRODUCT-1')],
            'isLast': False,
            'nextPageToken': 'token-1'
        })
        second_page = DummyResponse({
            'issues': [self._epic('PRODUCT-2', created='2025-03-01', resolution='2025-04-01')],
            'isLast': True
        })
        mock_search.side_effect = [first_page, second_page]

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=['T1']
        )

        self.assertIsNone(error)
        self.assertEqual(len(payload.get('issues') or []), 2)
        self.assertEqual(payload.get('meta', {}).get('paginationMode'), 'nextPageToken/isLast')
        self.assertEqual(mock_search.call_count, 2)
        first_payload = mock_search.call_args_list[0].args[0]
        second_payload = mock_search.call_args_list[1].args[0]
        self.assertNotIn('nextPageToken', first_payload)
        self.assertEqual(second_payload.get('nextPageToken'), 'token-1')

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'resilient_jira_get')
    @patch.object(jira_server, 'jira_search_request')
    def test_fetch_enriches_terminal_date_from_changelog(self, mock_search, mock_get, _mock_scope):
        mock_search.return_value = DummyResponse({
            'issues': [self._epic('PRODUCT-3', status='Done', resolution=None)],
            'isLast': True
        })
        mock_get.return_value = DummyResponse({
            'changelog': {
                'histories': [
                    {
                        'created': '2025-03-01T12:00:00.000+0000',
                        'items': [{'field': 'status', 'toString': 'Done'}]
                    }
                ]
            }
        })

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=['T1']
        )

        self.assertIsNone(error)
        issues = payload.get('issues') or []
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].get('terminalDate'), '2025-03-01')
        self.assertEqual(issues[0].get('terminalDateSource'), 'changelog')

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_postponed_status_is_terminal_not_open(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({
            'issues': [self._epic('PRODUCT-4', status='Postponed', resolution='2025-04-10')],
            'isLast': True
        })

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[]
        )

        self.assertIsNone(error)
        issue = (payload.get('issues') or [])[0]
        self.assertEqual(issue.get('status'), 'Postponed')
        self.assertIsNotNone(issue.get('terminalDate'))

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_empty_ad_hoc_list_keeps_jql_identical(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({
            'issues': [self._epic('PRODUCT-1')],
            'isLast': True
        })

        jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            ad_hoc_capacity_epics=[]
        )

        jql = mock_search.call_args_list[0].args[0]['jql']
        self.assertEqual(
            jql,
            'issuetype = Epic AND project in ("PRODUCT") AND created >= "2025-01-01" AND created < "2025-07-01"'
        )
        self.assertNotIn('OR key in', jql)

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_ad_hoc_keys_add_key_clause_and_share_scope(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({
            'issues': [self._epic('PRODUCT-1')],
            'isLast': True
        })

        jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=['T1'],
            ad_hoc_capacity_epics=['tech-9', 'TECH-9', 'tech-10']
        )

        jql = mock_search.call_args_list[0].args[0]['jql']
        # Project and Ad Hoc key matches are grouped so the team scope clause
        # (added afterward) applies to both branches.
        self.assertIn('(project in ("PRODUCT") OR key in ("TECH-9", "TECH-10"))', jql)
        self.assertIn('"Team[Team]" = "T1"', jql)
        self.assertTrue(jql.startswith('issuetype = Epic AND'))
        self.assertIn('created >= "2025-01-01"', jql)
        self.assertIn('created < "2025-07-01"', jql)

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_ad_hoc_epic_outside_project_scope_is_tagged_ad_hoc(self, mock_search, _mock_scope):
        tech_epic = self._epic('TECH-9', resolution='2025-03-01')
        tech_epic['fields']['project'] = {'key': 'TECH'}
        mock_search.return_value = DummyResponse({
            'issues': [self._epic('PRODUCT-1'), tech_epic],
            'isLast': True
        })

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            ad_hoc_capacity_epics=['TECH-9']
        )

        self.assertIsNone(error)
        issues = {issue.get('key'): issue for issue in (payload.get('issues') or [])}
        # The Tech-project Ad Hoc Epic returned by key remains in the dataset
        # and carries the ad_hoc capacity tag while its raw project stays TECH.
        self.assertIn('TECH-9', issues)
        self.assertEqual(issues['TECH-9'].get('projectKey'), 'TECH')
        self.assertEqual(issues['TECH-9'].get('capacityType'), 'ad_hoc')
        # Project-scope epics are not tagged.
        self.assertNotIn('capacityType', issues['PRODUCT-1'])

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_ad_hoc_keys_capped(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': True})
        overflow = [f'TECH-{index}' for index in range(jira_server.EPIC_COHORT_ADHOC_MAX_EPICS + 25)]

        jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            ad_hoc_capacity_epics=overflow
        )

        jql = mock_search.call_args_list[0].args[0]['jql']
        key_clause = jql.split('OR key in (', 1)[1].split(')', 1)[0]
        emitted_keys = [token.strip().strip('"') for token in key_clause.split(',')]
        self.assertEqual(len(emitted_keys), jira_server.EPIC_COHORT_ADHOC_MAX_EPICS)

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_open_epics_keep_actual_jira_status(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({
            'issues': [
                self._epic('PRODUCT-5', status='In Progress', resolution=None),
                self._epic('PRODUCT-6', status='Awaiting Validation', resolution=None),
                self._epic('PRODUCT-7', status='Done', resolution='2025-04-10'),
            ],
            'isLast': True
        })

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[]
        )

        self.assertIsNone(error)
        issues = {issue.get('key'): issue for issue in (payload.get('issues') or [])}
        self.assertEqual(issues['PRODUCT-5'].get('status'), 'open')
        self.assertEqual(issues['PRODUCT-5'].get('jiraStatus'), 'In Progress')
        self.assertEqual(issues['PRODUCT-6'].get('status'), 'open')
        self.assertEqual(issues['PRODUCT-6'].get('jiraStatus'), 'Awaiting Validation')

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_terminal_date_after_end_quarter_is_not_truncated(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({
            'issues': [self._epic('PRODUCT-8', created='2025-01-10', status='Done', resolution='2025-08-15')],
            'isLast': True
        })

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[]
        )

        self.assertIsNone(error)
        issue = (payload.get('issues') or [])[0]
        self.assertEqual(issue.get('terminalDate'), '2025-08-15')
        self.assertEqual(payload.get('range'), {
            'startDate': '2025-01-01',
            'endDate': '2025-06-30',
        })

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT', 'TECH'])
    @patch.object(jira_server, 'resilient_jira_get')
    @patch.object(jira_server, 'jira_search_request')
    def test_created_mode_output_is_unchanged_golden(self, mock_search, mock_get, _mock_scope):
        tech_epic = self._epic('TECH-9', created='2025-05-05', status='Done', resolution='2025-06-01')
        tech_epic['fields']['project'] = {'key': 'TECH'}
        mock_search.return_value = DummyResponse({
            'issues': [
                self._epic('PRODUCT-1', created='2025-01-10', status='Done', resolution='2025-02-15'),
                self._epic('PRODUCT-2', created='2025-01-20', status='Done', resolution=None),
                self._epic('PRODUCT-3', created='2025-02-03', status='Killed', resolution='2025-05-01'),
                self._epic('PRODUCT-4', created='2025-03-20', status='Postponed', resolution='2025-04-10'),
                self._epic('PRODUCT-5', created='2025-04-02', status='In Progress', resolution=None),
                tech_epic,
            ],
            'isLast': True
        })
        mock_get.return_value = DummyResponse({
            'changelog': {'histories': [{
                'created': '2025-03-01T12:00:00.000+0000',
                'items': [{'field': 'status', 'toString': 'Done'}]
            }]}
        })

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=['T1'],
            ad_hoc_capacity_epics=['TECH-9'],
        )

        def expected(key, created, status, jira_status, terminal, source, lead_days, project='PRODUCT', **extra):
            created_date = date.fromisoformat(created)
            quarter = f'{created_date.year}Q{(created_date.month - 1) // 3 + 1}'
            return {
                'key': key, 'summary': f'Epic {key}', 'projectKey': project,
                'team': {'id': 'T1', 'name': 'Team A'}, 'assignee': {'id': 'u1', 'name': 'Alice'},
                'createdDate': created, 'terminalDate': terminal, 'status': status, 'jiraStatus': jira_status,
                'leadTimeDays': lead_days, 'createdQuarter': quarter, 'createdMonth': created[:7],
                'terminalDateSource': source, **extra,
            }

        open_lead_days = (date.today() - date(2025, 4, 2)).days
        self.assertIsNone(error)
        self.assertEqual(payload['issues'], [
            expected('PRODUCT-1', '2025-01-10', 'Done', 'Done', '2025-02-15', 'resolutiondate', 36),
            expected('PRODUCT-2', '2025-01-20', 'Done', 'Done', '2025-03-01', 'changelog', 40),
            expected('PRODUCT-3', '2025-02-03', 'Killed', 'Killed', '2025-05-01', 'resolutiondate', 87),
            expected('PRODUCT-4', '2025-03-20', 'Postponed', 'Postponed', '2025-04-10', 'resolutiondate', 21),
            expected('PRODUCT-5', '2025-04-02', 'open', 'In Progress', None, None, open_lead_days),
            expected('TECH-9', '2025-05-05', 'Done', 'Done', '2025-06-01', 'resolutiondate', 27,
                     project='TECH', capacityType='ad_hoc'),
        ])
        self.assertEqual(payload['meta'], {
            'warnings': [], 'truncated': False, 'paginationMode': 'nextPageToken/isLast',
        })
        self.assertEqual(payload['range'], {'startDate': '2025-01-01', 'endDate': '2025-06-30'})

    @patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
    @patch.object(jira_server, 'jira_search_request')
    def test_created_page_cap_sets_truncated(self, mock_search, _mock_scope):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': False, 'nextPageToken': 'token'})

        payload, error = jira_server.fetch_epic_cohort_data(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
        )

        self.assertIsNone(error)
        self.assertEqual(mock_search.call_count, 80)
        self.assertTrue(payload['meta']['truncated'])
        self.assertIn('result truncated at 80 pages', payload['meta']['warnings'])


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortClosedFetch(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        jira_server.EPIC_COHORT_CACHE.clear()
        self.addCleanup(jira_server.EPIC_COHORT_CACHE.clear)
        scope_patch = patch.object(jira_server, '_cohort_project_scope', return_value=['PRODUCT'])
        self.mock_scope = scope_patch.start()
        self.addCleanup(scope_patch.stop)

    def _epic(self, key, created='2025-06-10', status='Done', resolution='2026-02-15', project='PRODUCT'):
        return {
            'key': key,
            'fields': {
                'summary': f'Epic {key}',
                'created': f'{created}T10:00:00.000+0000',
                'status': {'name': status},
                'resolutiondate': f'{resolution}T10:00:00.000+0000' if resolution else None,
                'assignee': {'accountId': 'u1', 'displayName': 'Alice'},
                'project': {'key': project},
                'customfield_30101': {'id': 'T1', 'name': 'Team A'},
            },
        }

    def _call(self, mode='closed', **kwargs):
        arguments = {
            'mode': mode,
            'start_date': date(2026, 1, 1) if mode == 'closed' else None,
            'end_date': date(2026, 3, 31) if mode == 'closed' else None,
            'headers': None,
            'team_field_id': 'customfield_30101',
        }
        arguments.update(kwargs)
        return jira_server.fetch_closed_epic_cohort_data(**arguments)

    def _router(self, routes):
        """Answer a search by the first route whose needle is in the JQL."""
        def search(payload, context=None):
            for needle, issues in routes:
                if needle in payload['jql']:
                    return DummyResponse({'issues': issues, 'isLast': True})
            raise AssertionError(f"unrouted jql: {payload['jql']}")
        return search

    def _changelog_get(self, histories_by_key, calls=None, partial=None):
        """Stand-in for current_jira_get: refuses to run without a request context (OAuth worker threads)."""
        def fake_get(path, *, params=None, timeout=30, context=None, diagnostic_transport=None):
            if context is None:
                raise RuntimeError('no request context')
            if calls is not None:
                calls.append((path, context))
            key = path.split('/issue/')[1].split('/')[0]
            if path.endswith('/changelog'):
                return DummyResponse({'values': histories_by_key[key], 'isLast': True})
            histories = histories_by_key[key]
            if partial:
                return DummyResponse({'changelog': {'histories': histories[:partial[0]], 'total': len(histories)}})
            return DummyResponse({'changelog': {'histories': histories, 'total': len(histories)}})
        return fake_get

    @staticmethod
    def _done_history(day):
        return {'created': f'{day}T12:00:00.000+0000', 'items': [{'field': 'status', 'toString': 'Done'}]}

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_with_components_uses_component_clause_only(self, mock_search):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': True})

        payload, error = self._call(team_ids=['T1'], component_names=['Alpha', 'Beta'], context=object())
        self.assertIsNone(error)
        jqls = [call.args[0]['jql'] for call in mock_search.call_args_list]
        self.assertEqual(len(jqls), 2)
        for jql in jqls:
            self.assertIn('component in ("Alpha", "Beta")', jql)
            self.assertNotIn('Team[Team]', jql)
        self.assertEqual(payload['meta']['scope'], 'components')
        self.assertEqual(payload['meta']['mode'], 'closed')

        mock_search.reset_mock()
        self._call(component_names=['Alpha'], context=object())
        for call in mock_search.call_args_list:
            self.assertIn('component = "Alpha"', call.args[0]['jql'])

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_without_components_falls_back_to_team_clause(self, mock_search):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': True})

        payload, _ = self._call(team_ids=['T1', 'T2'], component_names=[], context=object())

        for call in mock_search.call_args_list:
            jql = call.args[0]['jql']
            self.assertIn('"Team[Team]" in ("T1", "T2")', jql)
            self.assertNotIn('created >=', jql)
        self.assertEqual(payload['meta']['scope'], 'teams')

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_with_no_scope_makes_no_search_request(self, mock_search):
        payload, error = self._call(team_ids=[], component_names=[], context=object())
        self.assertIsNone(error)
        mock_search.assert_not_called()
        self.assertEqual(payload['issues'], [])
        self.assertEqual(payload['meta']['scope'], 'none')
        self.assertEqual(payload['range'], {'startDate': '2026-01-01', 'endDate': '2026-03-31'})

        last_n_payload, _ = self._call('last_n', team_ids=[], component_names=[], context=object())
        self.assertIsNone(last_n_payload['range'])
        mock_search.assert_not_called()

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_with_no_projects_returns_the_created_warning_payload(self, mock_search):
        self.mock_scope.return_value = []
        payload, error = self._call(component_names=['Alpha'], context=object())
        self.assertIsNone(error)
        mock_search.assert_not_called()
        self.assertEqual(payload['issues'], [])
        self.assertIn('no projects configured for cohort query', payload['meta']['warnings'])

    @patch.object(jira_server, 'current_jira_get')
    @patch.object(jira_server, 'jira_search_request')
    def test_closed_merges_resolved_and_unresolved_and_dedupes(self, mock_search, mock_get):
        mock_search.side_effect = self._router([
            ('resolutiondate >=', [self._epic('R-1')]),
            ('resolutiondate is EMPTY', [self._epic('U-1', resolution=None), self._epic('R-1')]),
        ])
        mock_get.side_effect = self._changelog_get({'U-1': [self._done_history('2026-03-01')]})

        payload, error = self._call(component_names=['Alpha'], context=object())

        self.assertIsNone(error)
        by_key = {issue['key']: issue for issue in payload['issues']}
        self.assertEqual(sorted(by_key), ['R-1', 'U-1'])
        self.assertEqual(by_key['R-1']['terminalDateSource'], 'resolutiondate')
        self.assertEqual(by_key['U-1']['terminalDate'], '2026-03-01')
        self.assertEqual(by_key['U-1']['terminalDateSource'], 'changelog')

    @patch.object(jira_server, 'current_jira_get')
    @patch.object(jira_server, 'jira_search_request')
    def test_closed_enrichment_cap_marks_truncated_and_excludes_from_ranking(self, mock_search, mock_get):
        mock_search.side_effect = self._router([
            ('resolutiondate >=', []),
            ('resolutiondate is EMPTY', [self._epic('U-1', resolution=None), self._epic('U-2', resolution=None)]),
        ])
        mock_get.side_effect = self._changelog_get({
            'U-1': [self._done_history('2026-02-02')], 'U-2': [self._done_history('2026-02-03')]})

        with patch.object(jira_server, 'EPIC_COHORT_ENRICH_MAX_ISSUES', 1):
            payload, _ = self._call(component_names=['Alpha'], context=object())

        self.assertEqual([issue['key'] for issue in payload['issues']], ['U-1'])
        self.assertTrue(payload['meta']['truncated'])
        self.assertIn('changelog enrichment capped at 1 issues', payload['meta']['warnings'])

    @patch.object(jira_server, 'current_jira_get')
    @patch.object(jira_server, 'jira_search_request')
    def test_closed_uses_full_changelog_when_total_exceeds_embedded(self, mock_search, mock_get):
        mock_search.side_effect = self._router([
            ('resolutiondate >=', []),
            ('resolutiondate is EMPTY', [self._epic('U-1', resolution=None)]),
        ])
        calls = []
        mock_get.side_effect = self._changelog_get(
            {'U-1': [{'created': '2025-07-01T12:00:00.000+0000', 'items': [{'field': 'labels'}]},
                     self._done_history('2026-02-02')]},
            calls=calls, partial=(1,))

        payload, _ = self._call(component_names=['Alpha'], context=object())

        self.assertEqual([issue['terminalDate'] for issue in payload['issues']], ['2026-02-02'])
        self.assertTrue(any(path.endswith('/changelog') for path, _ in calls))

    @patch.object(jira_server, 'current_jira_get')
    @patch.object(jira_server, 'jira_search_request')
    def test_closed_full_changelog_workers_receive_context_and_work_without_request_context(self, mock_search, mock_get):
        mock_search.side_effect = self._router([
            ('resolutiondate >=', []),
            ('resolutiondate is EMPTY', [self._epic('U-1', resolution=None)]),
        ])
        calls = []
        mock_get.side_effect = self._changelog_get(
            {'U-1': [{'created': '2025-07-01T12:00:00.000+0000', 'items': [{'field': 'labels'}]},
                     self._done_history('2026-02-02')]},
            calls=calls, partial=(1,))
        context = object()

        payload, error = self._call(component_names=['Alpha'], context=context)

        self.assertIsNone(error)
        self.assertEqual([issue['key'] for issue in payload['issues']], ['U-1'])
        self.assertGreaterEqual(len(calls), 2)
        self.assertTrue(all(call_context is context for _, call_context in calls))
        self.assertNotIn('changelog fetch failed', ' '.join(payload['meta']['warnings']))

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_non_200_returns_error_response_and_no_payload(self, mock_search):
        def search(payload, context=None):
            if 'resolutiondate is EMPTY' in payload['jql']:
                return DummyResponse({'errorMessages': ['bad']}, 500)
            return DummyResponse({'issues': [self._epic('R-1')], 'isLast': True})
        mock_search.side_effect = search

        payload, error = self._call(component_names=['Alpha'], context=object())

        self.assertIsNone(payload)
        self.assertEqual(error.status_code, 500)

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_does_not_widen_with_ad_hoc_keys_but_tags_them(self, mock_search):
        mock_search.side_effect = self._router([
            ('resolutiondate >=', [self._epic('TECH-9', project='TECH'), self._epic('R-1')]),
            ('resolutiondate is EMPTY', []),
        ])

        payload, _ = self._call(component_names=['Alpha'], ad_hoc_capacity_epics=['TECH-9'], context=object())

        for call in mock_search.call_args_list:
            self.assertNotIn('key in (', call.args[0]['jql'])
        by_key = {issue['key']: issue for issue in payload['issues']}
        self.assertEqual(by_key['TECH-9'].get('capacityType'), 'ad_hoc')
        self.assertNotIn('capacityType', by_key['R-1'])

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_component_with_quote_is_escaped(self, mock_search):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': True})

        self._call(component_names=['Al"pha'], context=object())

        for call in mock_search.call_args_list:
            self.assertIn('component = "Al\\"pha"', call.args[0]['jql'])

    @patch.object(jira_server, 'jira_search_request')
    def test_paged_requests_stay_under_the_encoded_byte_budget(self, mock_search):
        names = [f'C{index:02d}-' + 'x' * 56 for index in range(40)]
        fields = ['summary', 'created', 'status', 'resolutiondate', 'assignee', 'project', 'customfield_30101']
        scope = f'component in ({", ".join(chr(34) + name + chr(34) for name in names)})'
        unbatched = max(epic_cohort_closed.build_closed_epic_jqls(
            '"PRODUCT"', scope, mode='closed', start_date=date(2026, 1, 1), end_date=date(2026, 3, 31),
            unresolved_since=epic_cohort_closed.SIZING_SINCE).values(), key=len)
        # Precondition: the first request fits, the continuation does not, so only paged sizing splits it.
        self.assertLessEqual(eng_board.encoded_search_bytes(unbatched, fields), eng_board.MAX_ENCODED_REQUEST_BYTES)
        self.assertGreater(eng_board.paged_search_bytes(unbatched, fields), eng_board.MAX_ENCODED_REQUEST_BYTES)

        issued = []

        def search(payload, context=None):
            token = payload.get('nextPageToken')
            issued.append((payload['jql'], eng_board.encoded_search_bytes(payload['jql'], payload['fields'], token)))
            if token:
                return DummyResponse({'issues': [], 'isLast': True})
            size = int(len(payload['jql']) * eng_board.PAGE_TOKEN_BYTES_PER_JQL_CHAR) + 1
            return DummyResponse({'issues': [], 'isLast': False, 'nextPageToken': 'x' * size})
        mock_search.side_effect = search

        payload, error = self._call(component_names=names, context=object())

        self.assertIsNone(error)
        self.assertGreaterEqual(len({jql for jql, _ in issued}), 4)  # at least two batches, two passes each
        self.assertLessEqual(max(size for _, size in issued), eng_board.MAX_ENCODED_REQUEST_BYTES)

    @patch.object(jira_server, 'jira_search_request')
    def test_search_receives_the_request_context(self, mock_search):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': True})
        context = object()

        self._call(component_names=['Alpha'], context=context)

        self.assertTrue(mock_search.call_args_list)
        for call in mock_search.call_args_list:
            self.assertIs(call.kwargs.get('context'), context)

    @patch.object(jira_server, 'jira_search_request')
    def test_closed_page_cap_is_shared_across_passes_and_sets_truncated(self, mock_search):
        mock_search.return_value = DummyResponse({'issues': [], 'isLast': False, 'nextPageToken': 'token'})

        payload, error = self._call(component_names=['Alpha'], context=object())

        self.assertIsNone(error)
        self.assertEqual(mock_search.call_count, epic_cohort_closed.MAX_TOTAL_PAGES)
        self.assertTrue(payload['meta']['truncated'])
        self.assertIn(f'result truncated at {epic_cohort_closed.MAX_TOTAL_PAGES} pages', payload['meta']['warnings'])

    @patch.object(jira_server, 'jira_search_request')
    def test_last_n_payload_reports_the_window(self, mock_search):
        mock_search.side_effect = self._router([
            ('resolutiondate is not EMPTY', [self._epic('R-1')]),
            ('resolutiondate is EMPTY', []),
        ])

        with patch.object(epic_cohort_closed, 'LAST_N_WINDOW', 120):
            payload, _ = self._call('last_n', component_names=['Alpha'], context=object())

        self.assertIsNone(payload['range'])
        self.assertEqual(payload['meta']['mode'], 'last_n')
        self.assertEqual(payload['meta']['windowCeiling'], 120)
        self.assertIs(payload['meta']['windowFull'], False)
        self.assertEqual([issue['key'] for issue in payload['issues']], ['R-1'])


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortEndpoint(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        jira_server.EPIC_COHORT_CACHE.clear()
        self.addCleanup(jira_server.EPIC_COHORT_CACHE.clear)
        app = jira_server.app
        app.testing = True
        self.client = app.test_client()

    def test_missing_start_quarter_returns_400(self):
        response = self.client.post('/api/stats/epic-cohort', json={})
        self.assertEqual(response.status_code, 400)

    @patch.object(jira_server, 'resolve_team_field_id')
    def test_invalid_quarter_ranges_fail_before_jira_access(self, mock_team_field):
        cases = [
            ({}, 'startQuarter and endQuarter are required'),
            ({'startQuarter': '2025Q1'}, 'startQuarter and endQuarter are required'),
            ({'startQuarter': 'bad', 'endQuarter': '2025Q2'}, 'startQuarter and endQuarter must use YYYYQ[1-4]'),
            ({'startQuarter': '0000Q1', 'endQuarter': '2025Q2'}, 'startQuarter and endQuarter must use YYYYQ[1-4]'),
            ({'startQuarter': '2025Q3', 'endQuarter': '2025Q2'}, 'startQuarter cannot be after endQuarter'),
            ({'startQuarter': '2025Q1', 'endQuarter': '2999Q1'}, 'endQuarter cannot be after the current quarter'),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                response = self.client.post('/api/stats/epic-cohort', json=body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual((response.get_json() or {}).get('error'), expected)
        mock_team_field.assert_not_called()

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_epic_cohort_data')
    def test_post_returns_data(self, mock_fetch, _mock_team):
        mock_fetch.return_value = ({
            'range': {'startDate': '2025-01-01', 'endDate': '2025-03-31'},
            'issues': [],
            'meta': {'warnings': [], 'truncated': False, 'paginationMode': 'nextPageToken/isLast'}
        }, None)

        response = self.client.post('/api/stats/epic-cohort', json={'startQuarter': '2025Q1', 'endQuarter': '2025Q2'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertIn('data', payload)
        self.assertIn('issues', payload.get('data') or {})

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_epic_cohort_data')
    def test_post_forwards_normalized_ad_hoc_epics(self, mock_fetch, _mock_team):
        mock_fetch.return_value = ({
            'range': {'startDate': '2025-01-01', 'endDate': '2025-03-31'},
            'issues': [],
            'meta': {'warnings': [], 'truncated': False, 'paginationMode': 'nextPageToken/isLast'}
        }, None)

        response = self.client.post('/api/stats/epic-cohort', json={
            'startQuarter': '2025Q1',
            'endQuarter': '2025Q2',
            'adHocCapacityEpics': ['tech-9', 'TECH-9', '', 'tech-10']
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        forwarded = mock_fetch.call_args.kwargs.get('ad_hoc_capacity_epics')
        self.assertEqual(forwarded, ['TECH-9', 'TECH-10'])

    @staticmethod
    def _closed_payload(mode='closed', scope='components'):
        return ({
            'range': None, 'issues': [],
            'meta': {'warnings': [], 'truncated': False, 'paginationMode': 'nextPageToken/isLast',
                     'mode': mode, 'scope': scope, 'windowCeiling': None, 'windowFull': None},
        }, None)

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    @patch.object(jira_server, 'fetch_epic_cohort_data')
    def test_absent_mode_calls_created_fetch(self, mock_created, mock_closed, _team):
        mock_created.return_value = ({'range': {}, 'issues': [], 'meta': {}}, None)

        response = self.client.post('/api/stats/epic-cohort', json={'startQuarter': '2025Q1', 'endQuarter': '2025Q2'})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_created.assert_called_once()
        mock_closed.assert_not_called()

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    @patch.object(jira_server, 'fetch_epic_cohort_data')
    def test_closed_mode_calls_closed_fetch_with_the_quarter_window(self, mock_created, mock_closed, _team):
        mock_closed.return_value = self._closed_payload()

        response = self.client.post('/api/stats/epic-cohort', json={
            'mode': 'closed', 'startQuarter': '2025Q1', 'endQuarter': '2025Q2',
            'teamIds': ['T1'], 'components': ['Alpha'], 'adHocCapacityEpics': ['tech-9']})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_created.assert_not_called()
        self.assertEqual(mock_closed.call_args.args[:3], ('closed', date(2025, 1, 1), date(2025, 6, 30)))
        self.assertEqual(mock_closed.call_args.kwargs['component_names'], ['Alpha'])
        self.assertEqual(mock_closed.call_args.kwargs['ad_hoc_capacity_epics'], ['TECH-9'])
        self.assertEqual(response.get_json()['data']['meta']['mode'], 'closed')

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    def test_last_n_calls_closed_fetch_without_quarters(self, mock_closed, _team):
        mock_closed.return_value = self._closed_payload('last_n')

        response = self.client.post('/api/stats/epic-cohort', json={'mode': 'last_n', 'components': ['Alpha']})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(mock_closed.call_args.args[:3], ('last_n', None, None))

    @patch.object(jira_server, 'resolve_team_field_id')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    @patch.object(jira_server, 'fetch_epic_cohort_data')
    def test_invalid_mode_requests_return_400_before_jira_access(self, mock_created, mock_closed, mock_team_field):
        cases = [
            ({'mode': 'bogus', 'startQuarter': '2025Q1', 'endQuarter': '2025Q2'},
             'mode must be created, closed or last_n'),
            ({'mode': None, 'startQuarter': '2025Q1', 'endQuarter': '2025Q2'}, 'mode must be created, closed or last_n'),
            ({'mode': '', 'startQuarter': '2025Q1', 'endQuarter': '2025Q2'}, 'mode must be created, closed or last_n'),
            ({'mode': 'last_n', 'startQuarter': '2025Q1'}, 'last_n does not take startQuarter or endQuarter'),
            ({'mode': 'last_n', 'startQuarter': ''}, 'last_n does not take startQuarter or endQuarter'),
            ({'mode': 'closed'}, 'startQuarter and endQuarter are required'),
            ({'mode': 'closed', 'startQuarter': '2025Q1', 'endQuarter': '2999Q1'},
             'endQuarter cannot be after the current quarter'),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                response = self.client.post('/api/stats/epic-cohort', json=body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual((response.get_json() or {}).get('error'), expected)
        mock_team_field.assert_not_called()
        mock_created.assert_not_called()
        mock_closed.assert_not_called()

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    def test_scope_too_large_returns_400(self, mock_closed, _team):
        mock_closed.side_effect = epic_cohort_closed.EpicCohortScopeError('too large')

        response = self.client.post('/api/stats/epic-cohort', json={'mode': 'last_n', 'components': ['Alpha']})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'Component scope too large for Lead Times')

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    def test_closed_response_is_cached_per_mode(self, mock_closed, _team):
        mock_closed.return_value = self._closed_payload()
        closed_body = {'mode': 'closed', 'startQuarter': '2025Q1', 'endQuarter': '2025Q2', 'components': ['Alpha']}

        first = self.client.post('/api/stats/epic-cohort', json=closed_body)
        second = self.client.post('/api/stats/epic-cohort', json=closed_body)
        self.assertEqual(mock_closed.call_count, 1)
        self.assertFalse(first.get_json()['cached'])
        self.assertTrue(second.get_json()['cached'])

        self.client.post('/api/stats/epic-cohort', json={'mode': 'last_n', 'components': ['Alpha']})
        self.assertEqual(mock_closed.call_count, 2)

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    def test_team_ids_do_not_split_component_scoped_cache_entries(self, mock_closed, _team):
        mock_closed.return_value = self._closed_payload()
        scoped = {'mode': 'last_n', 'components': ['Alpha']}

        self.client.post('/api/stats/epic-cohort', json={**scoped, 'teamIds': ['T1']})
        self.client.post('/api/stats/epic-cohort', json={**scoped, 'teamIds': ['T2']})
        self.assertEqual(mock_closed.call_count, 1)

        teams_only = {'mode': 'last_n', 'components': []}
        self.client.post('/api/stats/epic-cohort', json={**teams_only, 'teamIds': ['T1']})
        self.client.post('/api/stats/epic-cohort', json={**teams_only, 'teamIds': ['T2']})
        self.assertEqual(mock_closed.call_count, 3)

    @patch.object(jira_server, 'resolve_team_field_id')
    @patch.object(jira_server, 'fetch_closed_epic_cohort_data')
    def test_closed_mode_without_scope_skips_the_team_field_lookup(self, mock_closed, mock_team_field):
        mock_closed.return_value = self._closed_payload(scope='none')

        response = self.client.post('/api/stats/epic-cohort', json={'mode': 'last_n'})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_team_field.assert_not_called()


if __name__ == '__main__':
    unittest.main()
