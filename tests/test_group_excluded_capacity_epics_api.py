import json
import os
import tempfile
import unittest
from unittest.mock import patch

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
class TestGroupExcludedCapacityEpics(unittest.TestCase):
    def test_validate_groups_config_normalizes_excluded_capacity_epics(self):
        payload = {
            'version': 1,
            'groups': [{
                'id': 'default',
                'name': 'Default',
                'teamIds': ['team-1'],
                'missingInfoComponents': ['A'],
                'excludedCapacityEpics': ['tech-1', ' TECH-1 ', 'product-5', '', None],
                'adHocCapacityEpics': ' product-adhoc ',
            }],
            'defaultGroupId': 'default'
        }

        normalized, errors, _warnings = jira_server.validate_groups_config(payload, allow_empty=False)
        self.assertEqual(errors, [])
        self.assertEqual(
            normalized['groups'][0].get('excludedCapacityEpics'),
            ['TECH-1', 'PRODUCT-5']
        )
        self.assertEqual(
            normalized['groups'][0].get('adHocCapacityEpics'),
            ['PRODUCT-ADHOC']
        )

    def test_validate_groups_config_rejects_excluded_and_ad_hoc_overlap(self):
        payload = {
            'version': 1,
            'groups': [{
                'id': 'default',
                'name': 'Default',
                'teamIds': ['team-1'],
                'excludedCapacityEpics': ['tech-1'],
                'adHocCapacityEpics': [' TECH-1 '],
            }],
            'defaultGroupId': 'default'
        }

        _normalized, errors, _warnings = jira_server.validate_groups_config(payload, allow_empty=False)

        self.assertTrue(any('both excludedCapacityEpics and adHocCapacityEpics' in error for error in errors))

    def test_json_groups_config_rejects_excluded_and_ad_hoc_overlap_without_persisting(self):
        force_basic_auth_mode(self, jira_server)
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        with tempfile.TemporaryDirectory() as tmpdir:
            dashboard_path = os.path.join(tmpdir, 'dashboard-config.json')
            with open(dashboard_path, 'w', encoding='utf-8') as handle:
                json.dump({
                    'version': 1,
                    'teamGroups': {
                        'version': 1,
                        'groups': [{
                            'id': 'default',
                            'name': 'Default',
                            'teamIds': ['team-1'],
                            'excludedCapacityEpics': ['EX-1'],
                        }],
                        'defaultGroupId': 'default',
                    },
                }, handle)
            with patch.object(jira_server, 'resolve_dashboard_config_path', return_value=dashboard_path):
                before = client.get('/api/groups-config').get_json()
                response = client.post('/api/groups-config', json={
                    'version': 1,
                    'groups': [{
                        'id': 'default',
                        'name': 'Default',
                        'teamIds': ['team-1'],
                        'excludedCapacityEpics': ['EX-1'],
                        'adHocCapacityEpics': ['ex-1'],
                    }],
                    'defaultGroupId': 'default',
                })
                after = client.get('/api/groups-config').get_json()

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertTrue(any('both excludedCapacityEpics and adHocCapacityEpics' in error for error in response.get_json().get('errors', [])))
        self.assertEqual(after['groups'], before['groups'])


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicSearchEndpoint(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        app = jira_server.app
        app.testing = True
        self.client = app.test_client()

    @patch.object(jira_server, 'get_selected_projects', return_value=['PRODUCT', 'TECH'])
    @patch.object(jira_server, 'jira_search_request')
    def test_epics_search_returns_key_and_summary(self, mock_search, _mock_projects):
        mock_search.return_value = DummyResponse({
            'issues': [
                {
                    'key': 'PRODUCT-21202',
                    'fields': {
                        'summary': 'Build s2 bid2imp model',
                        'status': {'name': 'Accepted'},
                        'project': {'key': 'PRODUCT'},
                        'issuetype': {'name': 'Epic', 'hierarchyLevel': 1}
                    }
                }
            ]
        })

        response = self.client.get('/api/epics/search?query=bid2imp&limit=10')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertIn('epics', payload)
        self.assertEqual(len(payload['epics']), 1)
        self.assertEqual(payload['epics'][0]['key'], 'PRODUCT-21202')
        self.assertEqual(payload['epics'][0]['summary'], 'Build s2 bid2imp model')

        self.assertTrue(mock_search.called)
        called_payload = mock_search.call_args[0][0]
        self.assertIn('issuetype = Epic', called_payload.get('jql', ''))
        self.assertIn('project in ("PRODUCT", "TECH")', called_payload.get('jql', ''))

    @patch.object(jira_server, 'get_selected_projects', return_value=['PRODUCT', 'TECH'])
    @patch.object(jira_server, 'jira_search_request')
    def test_epics_search_filters_out_non_epics_and_out_of_scope_projects(self, mock_search, _mock_projects):
        mock_search.return_value = DummyResponse({
            'issues': [
                {
                    'key': 'PRODUCT-1',
                    'fields': {
                        'summary': 'Valid epic in scope',
                        'status': {'name': 'In Progress'},
                        'project': {'key': 'PRODUCT'},
                        'issuetype': {'name': 'Epic', 'hierarchyLevel': 1}
                    }
                },
                {
                    'key': 'PRODUCT-2',
                    'fields': {
                        'summary': 'Story should be removed',
                        'status': {'name': 'In Progress'},
                        'project': {'key': 'PRODUCT'},
                        'issuetype': {'name': 'Story', 'hierarchyLevel': 0}
                    }
                },
                {
                    'key': 'OTHER-3',
                    'fields': {
                        'summary': 'Epic but outside selected projects',
                        'status': {'name': 'To Do'},
                        'project': {'key': 'OTHER'},
                        'issuetype': {'name': 'Epic', 'hierarchyLevel': 1}
                    }
                }
            ]
        })

        response = self.client.get('/api/epics/search?query=devlead&limit=15')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        epics = payload.get('epics') or []
        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0]['key'], 'PRODUCT-1')

    @patch.object(jira_server, 'get_selected_projects', return_value=[])
    def test_epics_search_returns_empty_without_selected_projects(self, _mock_projects):
        response = self.client.get('/api/epics/search?query=abc')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertEqual(payload.get('epics'), [])


if __name__ == '__main__':
    unittest.main()
