import unittest
from unittest.mock import patch
from datetime import date

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


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortFetch(unittest.TestCase):
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
        first_payload = mock_search.call_args_list[0].args[1]
        second_payload = mock_search.call_args_list[1].args[1]
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


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortEndpoint(unittest.TestCase):
    def setUp(self):
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


if __name__ == '__main__':
    unittest.main()
