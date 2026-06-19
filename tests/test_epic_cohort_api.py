import unittest
from unittest.mock import patch
from datetime import date

from tests.auth_mode_test_utils import force_basic_auth_mode

try:
    import jira_server
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
        base = jira_server._build_epic_cohort_cache_key('2025Q1', ['T1'], ['PRODUCT'])
        with_ad_hoc = jira_server._build_epic_cohort_cache_key(
            '2025Q1', ['T1'], ['PRODUCT'], ad_hoc_epics=['tech-9', 'TECH-9']
        )
        self.assertNotEqual(base, with_ad_hoc)
        # Normalization is order- and case-insensitive after dedupe.
        reordered = jira_server._build_epic_cohort_cache_key(
            '2025Q1', ['T1'], ['PRODUCT'], ad_hoc_epics=['TECH-9', 'tech-9']
        )
        self.assertEqual(with_ad_hoc, reordered)


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
            start_quarter='2025Q1',
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
            start_quarter='2025Q1',
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
            start_quarter='2025Q1',
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
            start_quarter='2025Q1',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            ad_hoc_capacity_epics=[]
        )

        jql = mock_search.call_args_list[0].args[0]['jql']
        self.assertEqual(
            jql,
            'issuetype = Epic AND project in ("PRODUCT") AND created >= "2025-01-01"'
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
            start_quarter='2025Q1',
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
            start_quarter='2025Q1',
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
            start_quarter='2025Q1',
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
            start_quarter='2025Q1',
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


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortEndpoint(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        app = jira_server.app
        app.testing = True
        self.client = app.test_client()

    def test_missing_start_quarter_returns_400(self):
        response = self.client.post('/api/stats/epic-cohort', json={})
        self.assertEqual(response.status_code, 400)

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'fetch_epic_cohort_data')
    def test_post_returns_data(self, mock_fetch, _mock_team):
        mock_fetch.return_value = ({
            'range': {'startDate': '2025-01-01', 'endDate': '2025-03-31'},
            'issues': [],
            'meta': {'warnings': [], 'truncated': False, 'paginationMode': 'nextPageToken/isLast'}
        }, None)

        response = self.client.post('/api/stats/epic-cohort', json={'startQuarter': '2025Q1'})
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
            'adHocCapacityEpics': ['tech-9', 'TECH-9', '', 'tech-10']
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        forwarded = mock_fetch.call_args.kwargs.get('ad_hoc_capacity_epics')
        self.assertEqual(forwarded, ['TECH-9', 'TECH-10'])


if __name__ == '__main__':
    unittest.main()
