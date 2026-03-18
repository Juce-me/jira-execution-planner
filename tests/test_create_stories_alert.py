import unittest
from unittest.mock import Mock, patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


def _mock_response(status_code, payload=None):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload if payload is not None else {}
    return response


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestCreateStoriesAlertConfig(unittest.TestCase):
    def test_validate_groups_config_preserves_team_labels_for_known_teams(self):
        normalized, errors, warnings = jira_server.validate_groups_config({
            'version': 1,
            'groups': [{
                'id': 'group-1',
                'name': 'Group 1',
                'teamIds': ['team-a', 'team-b'],
                'teamLabels': {
                    'team-a': 'rnd_bsw_bswui',
                    'team-c': 'ignored-label'
                }
            }],
            'defaultGroupId': 'group-1'
        })

        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertEqual(
            normalized['groups'][0].get('teamLabels'),
            {'team-a': 'rnd_bsw_bswui'}
        )


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestCreateStoriesAlertPayloads(unittest.TestCase):
    def test_fetch_epics_for_empty_alert_returns_labels(self):
        payload = {
            'issues': [{
                'key': 'EPIC-1',
                'fields': {
                    'summary': 'Epic one',
                    'status': {'name': 'To Do'},
                    'assignee': {'displayName': 'Alice'},
                    'labels': ['2026Q2', 'rnd_bsw_bswui'],
                    'customfield_team': {'id': 'team-a', 'name': 'BSW UI'}
                }
            }]
        }

        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, payload)):
            epics = jira_server.fetch_epics_for_empty_alert(
                'project = TEST',
                headers={'Authorization': 'Bearer test'},
                team_field_id='customfield_team',
                epic_name_field='customfield_epic_name'
            )

        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('labels'), ['2026Q2', 'rnd_bsw_bswui'])

    def test_fetch_backlog_epics_for_alert_returns_cleanup_story_count(self):
        fetcher = getattr(jira_server, 'fetch_backlog_epics_for_alert', None)
        self.assertTrue(callable(fetcher), 'fetch_backlog_epics_for_alert should exist')

        epic_payload = {
            'issues': [{
                'key': 'EPIC-42',
                'fields': {
                    'summary': 'Backlog epic',
                    'status': {'name': 'To Do'},
                    'assignee': {'displayName': 'Alice'},
                    'components': [{'name': 'BidSwitch'}],
                    'customfield_team': {'id': 'team-a', 'name': 'BSW UI'},
                    'customfield_sprint': None
                }
            }]
        }
        child_payload = {
            'issues': [
                {
                    'key': 'STORY-1',
                    'fields': {
                        'status': {'name': 'In Progress'},
                        'customfield_epic_link': 'EPIC-42',
                        'customfield_sprint': [{'id': 123, 'name': '2026Q2'}]
                    }
                },
                {
                    'key': 'STORY-2',
                    'fields': {
                        'status': {'name': 'Done'},
                        'customfield_epic_link': 'EPIC-42',
                        'customfield_sprint': [{'id': 123, 'name': '2026Q2'}]
                    }
                }
            ]
        }

        with patch.object(
            jira_server,
            'jira_search_request',
            side_effect=[_mock_response(200, epic_payload), _mock_response(200, child_payload)]
        ):
            epics = fetcher(
                'project = TEST',
                headers={'Authorization': 'Bearer test'},
                team_field_id='customfield_team',
                sprint_field_id='customfield_sprint',
                epic_link_field='customfield_epic_link'
            )

        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('components'), ['BidSwitch'])
        self.assertEqual(epics[0].get('assignee', {}).get('displayName'), 'Alice')
        self.assertEqual(epics[0].get('teamId'), 'team-a')
        self.assertEqual(epics[0].get('cleanupStoryCount'), 1)

    def test_fetch_backlog_epics_for_alert_preserves_explicit_sprint_field_for_client_recheck(self):
        fetcher = getattr(jira_server, 'fetch_backlog_epics_for_alert', None)
        self.assertTrue(callable(fetcher), 'fetch_backlog_epics_for_alert should exist')

        sprint_value = [{'id': 456, 'name': 'Sprint 46'}]
        epic_payload = {
            'issues': [{
                'key': 'EPIC-99',
                'fields': {
                    'summary': 'Should not survive client backlog filter',
                    'status': {'name': 'To Do'},
                    'assignee': {'displayName': 'Alice'},
                    'components': [{'name': 'BidSwitch'}],
                    'customfield_team': {'id': 'team-a', 'name': 'BSW UI'},
                    'customfield_sprint': sprint_value
                }
            }]
        }
        child_payload = {'issues': []}

        with patch.object(
            jira_server,
            'jira_search_request',
            side_effect=[_mock_response(200, epic_payload), _mock_response(200, child_payload)]
        ):
            epics = fetcher(
                'project = TEST',
                headers={'Authorization': 'Bearer test'},
                team_field_id='customfield_team',
                sprint_field_id='customfield_sprint',
                epic_link_field='customfield_epic_link'
            )

        self.assertEqual(epics[0].get('fields', {}).get('customfield_10101'), sprint_value)


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestCreateStoriesAlertApi(unittest.TestCase):
    def setUp(self):
        jira_server.LABELS_CACHE['data'] = None
        jira_server.LABELS_CACHE['timestamp'] = 0

    def test_jira_labels_endpoint_returns_label_results(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'values': ['rnd_bsw_bswui', 'rnd_bsw_perimeter'],
            'isLast': True
        }

        with patch('jira_server.requests.get', return_value=_mock_response(200, jira_payload)):
            response = client.get('/api/jira/labels?query=bsw')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertEqual(payload.get('labels'), ['rnd_bsw_bswui', 'rnd_bsw_perimeter'])

    def test_jira_labels_endpoint_fetches_all_pages_before_filtering(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        first_page = {
            'values': ['alpha_label'],
            'isLast': False,
            'startAt': 0,
            'maxResults': 1
        }
        second_page = {
            'values': ['rnd_bsw_perimeter'],
            'isLast': True,
            'startAt': 1,
            'maxResults': 1
        }

        with patch(
            'jira_server.requests.get',
            side_effect=[_mock_response(200, first_page), _mock_response(200, second_page)]
        ) as mock_get:
            response = client.get('/api/jira/labels?query=bsw')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertEqual(payload.get('labels'), ['rnd_bsw_perimeter'])
        self.assertEqual(mock_get.call_count, 2)

    def test_backlog_epics_endpoint_returns_epics(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        backlog_epics = [{'key': 'EPIC-42', 'cleanupStoryCount': 1}]

        with patch.object(jira_server, 'fetch_backlog_epics_for_alert', return_value=backlog_epics), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'):
            response = client.get('/api/backlog-epics?project=product&teamIds=team-a')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertEqual(payload.get('epics'), backlog_epics)


if __name__ == '__main__':
    unittest.main()
