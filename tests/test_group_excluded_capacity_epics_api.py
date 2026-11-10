from copy import deepcopy
import unittest
from unittest.mock import patch

from backend.db import engine as db_engine, models
from tests.auth_mode_test_utils import force_db_oauth_mode

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

    def db_client_with_groups(self, *, version=2, **group_fields):
        force_db_oauth_mode(self, jira_server)
        group = {'id': 'default', 'name': 'Default', 'teamIds': ['team-1'], **group_fields}
        with db_engine.session_scope() as db:
            db.add(models.WorkspaceGroupConfig(workspace_id=self.db_actor.workspace_id,
                payload={'version': version, 'groups': [group], 'defaultGroupId': 'default'},
                payload_version=version, config_revision=1))
        return jira_server.app.test_client()

    def assert_invalid_group_unchanged(self, fields, expected_error, *, redact=()):
        client = self.db_client_with_groups(excludedCapacityEpics=['EX-1'])
        before = client.get('/api/groups-config').get_json()
        response = client.post('/api/groups-config', json={
            'version': 2, 'baseRevision': before['configRevision'],
            'groups': [{'id': 'default', 'name': 'Default', 'teamIds': ['team-1'], **fields}],
            'defaultGroupId': 'default',
        })
        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['error'], 'invalid_groups_config')
        self.assertTrue(any(expected_error in error for error in body['errors']), body)
        for secret_label in redact:
            self.assertNotIn(secret_label, str(body['errors']))
        self.assertEqual(client.get('/api/groups-config').get_json(), before)
        with db_engine.session_scope() as db:
            row = db.query(models.WorkspaceGroupConfig).one()
            self.assertEqual(row.config_revision, before['configRevision'])
            self.assertEqual(row.payload['groups'][0]['excludedCapacityEpics'], ['EX-1'])

    def test_db_groups_config_rejects_excluded_and_ad_hoc_overlap_without_persisting(self):
        self.assert_invalid_group_unchanged(
            {'excludedCapacityEpics': ['EX-1'], 'adHocCapacityEpics': ['ex-1']},
            'both excludedCapacityEpics and adHocCapacityEpics')

    def test_db_groups_config_rejects_more_than_three_team_labels_without_persisting(self):
        self.assert_invalid_group_unchanged(
            {'teamLabels': {'team-1': ['label-a', 'label-b', 'label-c', 'label-d']}},
            'has more than 3 Jira labels', redact=('label-a',))

    def test_db_groups_config_rejects_comma_scalar_team_label_without_persisting(self):
        self.assert_invalid_group_unchanged(
            {'teamLabels': {'team-1': 'label_team_a,label_team_a_old'}},
            'has a Jira label containing a comma', redact=('label_team_a',))

    def test_db_groups_config_reads_version_1_scalar_labels_as_version_2_arrays_without_rewrite(self):
        client = self.db_client_with_groups(version=1, teamLabels={'team-1': 'label_team_1'})
        with db_engine.session_scope() as db:
            before = deepcopy(db.query(models.WorkspaceGroupConfig).one().payload)
        response = client.get('/api/groups-config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['version'], 2)
        self.assertEqual(body['groups'][0]['teamLabels'], {'team-1': ['label_team_1']})
        with db_engine.session_scope() as db:
            row = db.query(models.WorkspaceGroupConfig).one()
            self.assertEqual(row.payload, before)
            self.assertEqual(row.config_revision, 1)


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicSearchEndpoint(unittest.TestCase):
    def setUp(self):
        force_db_oauth_mode(self, jira_server)
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
