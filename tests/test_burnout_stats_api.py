import unittest
from unittest.mock import patch

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
class TestBurnoutStatsApi(unittest.TestCase):
    def setUp(self):
        app = jira_server.app
        app.testing = True
        self.client = app.test_client()

    def test_burnout_uses_changelog_and_event_date_state(self):
        calls = []

        issue = {
            'key': 'TECH-25283',
            'fields': {
                'assignee': {
                    'accountId': 'bob-id',
                    'displayName': 'Bob'
                },
                'customfield_30101': {
                    'id': 'T2',
                    'name': 'Team B'
                }
            },
            'changelog': {
                'histories': [
                    {
                        'created': '2026-03-05T23:30:00.000+0000',
                        'items': [
                            {'field': 'status', 'fromString': 'In Progress', 'toString': 'Done'},
                            {'field': 'assignee', 'from': 'alice-id', 'fromString': 'Alice', 'to': 'bob-id', 'toString': 'Bob'},
                            {'field': 'Team[Team]', 'fieldId': 'customfield_30101', 'from': 'T1', 'fromString': 'Team A', 'to': 'T2', 'toString': 'Team B'}
                        ]
                    },
                    {
                        'created': '2026-03-01T10:00:00.000+0000',
                        'items': [
                            {'field': 'status', 'fromString': 'To Do', 'toString': 'In Progress'}
                        ]
                    }
                ]
            }
        }

        def fake_search(_headers, payload):
            calls.append(payload)
            return DummyResponse({'issues': [issue], 'total': 1})

        with patch.object(jira_server, 'jira_search_request', side_effect=fake_search), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101'):
            response = self.client.get('/api/stats/burnout?sprint=2026Q1')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        data = payload.get('data') or {}
        events = data.get('events') or []
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.get('bucket'), 'done')
        self.assertEqual(event.get('date'), '2026-03-06')  # UTC to Europe/Berlin crosses midnight
        self.assertEqual(event.get('assigneeName'), 'Bob')
        self.assertEqual(event.get('teamId'), 'T2')

        self.assertEqual(len(calls), 1)
        request_payload = calls[0]
        self.assertIn('changelog', request_payload.get('expand', []))
        self.assertIn('status CHANGED TO ("Done","Killed","Incomplete")', request_payload.get('jql', ''))
        self.assertIn('Sprint in ("2026Q1")', request_payload.get('jql', ''))

    def test_burnout_team_filter_applies_to_events(self):
        issue = {
            'key': 'TECH-25314',
            'fields': {
                'assignee': None,
                'customfield_30101': {'id': 'T2', 'name': 'Team B'}
            },
            'changelog': {
                'histories': [
                    {
                        'created': '2026-02-14T10:00:00.000+0000',
                        'items': [
                            {'field': 'status', 'fromString': 'In Progress', 'toString': 'Done'}
                        ]
                    }
                ]
            }
        }

        def fake_search(_headers, _payload):
            return DummyResponse({'issues': [issue], 'total': 1})

        with patch.object(jira_server, 'jira_search_request', side_effect=fake_search), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101'):
            response = self.client.get('/api/stats/burnout?sprint=2026Q1&teamIds=T1')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        data = payload.get('data') or {}
        self.assertEqual(data.get('events'), [])
        self.assertEqual((data.get('range') or {}).get('startDate'), '2026-01-01')
        self.assertEqual((data.get('range') or {}).get('endDate'), '2026-03-31')

    def test_burnout_post_issue_keys_uses_scoped_query(self):
        calls = []

        def fake_search(_headers, payload):
            calls.append(payload)
            return DummyResponse({'issues': [], 'total': 0})

        with patch.object(jira_server, 'jira_search_request', side_effect=fake_search), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101'):
            response = self.client.post('/api/stats/burnout', json={
                'sprint': '2026Q1',
                'teamIds': ['T1', 'T2'],
                'issueKeys': ['TECH-1', 'TECH-2']
            })

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertGreaterEqual(len(calls), 2)
        joined_jql = '\n'.join(call.get('jql', '') for call in calls)
        self.assertIn('issueKey in (TECH-1,TECH-2)', joined_jql)
        self.assertIn('status CHANGED TO ("Done","Killed","Incomplete")', joined_jql)

    def test_burnout_completed_sprint_can_include_post_sprint_closures(self):
        calls = []
        issue = {
            'key': 'TECH-100',
            'fields': {
                'assignee': {'accountId': 'a1', 'displayName': 'Alice'},
                'customfield_30101': {'id': 'T1', 'name': 'Team A'}
            },
            'changelog': {
                'histories': [
                    {
                        'created': '2026-04-05T10:00:00.000+0000',
                        'items': [
                            {'field': 'status', 'fromString': 'In Progress', 'toString': 'Incomplete'}
                        ]
                    }
                ]
            }
        }

        def fake_search(_headers, payload):
            calls.append(payload)
            return DummyResponse({'issues': [issue], 'total': 1})

        with patch.object(jira_server, 'jira_search_request', side_effect=fake_search), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101'):
            response = self.client.post('/api/stats/burnout', json={
                'sprint': '2026Q1',
                'teamIds': ['T1'],
                'issueKeys': ['TECH-100'],
                'includePostSprintClosures': True
            })

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        data = payload.get('data') or {}
        events = data.get('events') or []
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].get('bucket'), 'incomplete')
        self.assertEqual(events[0].get('date'), '2026-04-05')

        changelog_queries = [
            call.get('jql', '')
            for call in calls
            if 'status CHANGED TO ("Done","Killed","Incomplete")' in (call.get('jql', ''))
        ]
        self.assertTrue(changelog_queries, 'Expected changelog query call')
        self.assertTrue(all(' BEFORE "' not in query for query in changelog_queries))


if __name__ == '__main__':
    unittest.main()
