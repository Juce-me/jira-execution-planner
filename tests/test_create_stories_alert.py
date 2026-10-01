import contextlib
import unittest
from unittest.mock import Mock, patch

from backend.services import alert_epics

from tests.auth_mode_test_utils import force_basic_auth_mode

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
                    'team-a': 'team_alpha_label',
                    'team-c': 'ignored-label'
                }
            }],
            'defaultGroupId': 'group-1'
        })

        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertEqual(
            normalized['groups'][0].get('teamLabels'),
            {'team-a': ['team_alpha_label']}
        )


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestCreateStoriesAlertPayloads(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)

    def test_task_alert_enrichment_requires_alerts_purpose(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'issues': [],
            'names': {
                'customfield_team': 'Team[Team]',
                'customfield_epic_link': 'Epic Link',
                'customfield_sprint': 'Sprint',
            },
            'total': 0,
            'isLast': True,
        }
        epics_in_scope = [{
            'key': 'EPIC-1',
            'summary': 'Epic one',
            'status': {'name': 'To Do'},
            'labels': ['2026Q3', 'team_alpha_label'],
            'teamId': 'team-a',
            'teamName': 'Team Alpha',
        }]
        story_counts_mock = Mock(return_value={'EPIC-1': 3})
        story_distribution_mock = Mock(return_value={
            'EPIC-1': {
                'selectedStories': 2,
                'selectedActionableStories': 1,
                'futureOpenStories': 1,
                'openStoriesOutsideSelected': 1,
                'selectedActionableByTeam': {'team-a': 1},
            }
        })

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_story_points'), \
             patch.object(jira_server, 'fetch_epic_details_bulk', return_value={}), \
             patch.object(jira_server, 'fetch_epics_for_empty_alert', return_value=epics_in_scope), \
             patch.object(jira_server, 'fetch_story_counts_for_epics', story_counts_mock), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', story_distribution_mock), \
             patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            dashboard_response = client.get('/api/tasks-with-team-name?sprint=123&sprintName=2026Q3&team=all&refresh=true')

            self.assertEqual(dashboard_response.status_code, 200, dashboard_response.get_data(as_text=True))
            self.assertNotIn('totalStories', (dashboard_response.get_json() or {}).get('epicsInScope', [{}])[0])
            story_counts_mock.assert_not_called()
            story_distribution_mock.assert_not_called()

            alerts_response = client.get('/api/tasks-with-team-name?sprint=123&sprintName=2026Q3&team=all&purpose=alerts&refresh=true')

        self.assertEqual(alerts_response.status_code, 200, alerts_response.get_data(as_text=True))
        alert_epic = (alerts_response.get_json() or {}).get('epicsInScope', [{}])[0]
        self.assertEqual(alert_epic.get('totalStories'), 3)
        self.assertEqual(alert_epic.get('selectedActionableByTeam'), {'team-a': 1})
        story_counts_mock.assert_called_once()
        story_distribution_mock.assert_called_once()

    def test_fetch_tasks_preserves_sprint_fields_for_story_matching(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'issues': [{
                'id': '10001',
                'key': 'STORY-1',
                'fields': {
                    'summary': 'Story one',
                    'status': {'name': 'To Do'},
                    'priority': {'name': 'Critical'},
                    'issuetype': {'name': 'Story'},
                    'assignee': {'displayName': 'Alice'},
                    'updated': '2026-03-24T12:00:00.000+0000',
                    'project': {'key': 'PRODUCT', 'name': 'Product'},
                    'customfield_story_points': 1,
                    'customfield_team': {'id': 'team-a', 'name': 'Example Team Alpha'},
                    'customfield_epic_link': 'EPIC-1',
                    'customfield_sprint': [
                        'com.atlassian.greenhopper.service.sprint.Sprint@123[id=456,rapidViewId=12,state=FUTURE,name=2026Q2]'
                    ]
                }
            }],
            'names': {
                'customfield_team': 'Team[Team]',
                'customfield_epic_link': 'Epic Link'
            },
            'total': 1
        }

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_story_points'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'fetch_epic_details_bulk', return_value={'EPIC-1': {'key': 'EPIC-1', 'summary': 'Epic one'}}), \
             patch.object(jira_server, 'fetch_epics_for_empty_alert', return_value=[]), \
             patch.object(jira_server, 'fetch_story_counts_for_epics', return_value={}), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value={}), \
             patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            response = client.get('/api/tasks-with-team-name?sprint=456&team=all')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        issues = payload.get('issues') or []
        self.assertEqual(len(issues), 1)
        fields = issues[0].get('fields', {})
        self.assertEqual(fields.get('epicKey'), 'EPIC-1')
        self.assertEqual(fields.get('customfield_10101'), jira_payload['issues'][0]['fields']['customfield_sprint'])

    def test_fetch_tasks_preserves_open_stories_outside_selected_distribution(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'issues': [],
            'names': {
                'customfield_team': 'Team[Team]',
                'customfield_epic_link': 'Epic Link',
                'customfield_sprint': 'Sprint',
            },
            'total': 0,
            'isLast': True,
        }
        epics_in_scope = [{
            'key': 'EPIC-1',
            'summary': 'Epic one',
            'status': {'name': 'To Do'},
            'labels': ['2026Q3', 'team_alpha_label'],
            'teamId': 'team-a',
            'teamName': 'Team Alpha',
            'fields': {'customfield_10101': [{'id': 123, 'name': '2026Q3'}]},
        }]

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_story_points'), \
             patch.object(jira_server, 'fetch_epic_details_bulk', return_value={}), \
             patch.object(jira_server, 'fetch_epics_for_empty_alert', return_value=epics_in_scope) as epics_fetch, \
             patch.object(jira_server, 'fetch_story_counts_for_epics', return_value={'EPIC-1': 2}), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value={
                 'EPIC-1': {
                     'selectedStories': 0,
                     'selectedActionableStories': 0,
                     'futureOpenStories': 0,
                     'openStoriesOutsideSelected': 2,
                 }
             }), \
             patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            response = client.get('/api/tasks-with-team-name?sprint=123&sprintName=2026Q3&team=all&purpose=alerts')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        epics = payload.get('epicsInScope') or []
        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('openStoriesOutsideSelected'), 2)
        self.assertEqual(epics_fetch.call_args.args[-2], '2026Q3')
        self.assertTrue(epics_fetch.call_args.args[-1])

    def test_story_distribution_breaks_selected_actionable_down_by_team(self):
        jira_payload = {
            'issues': [
                {'key': 'S1', 'fields': {'customfield_epic_link': 'EPIC-1', 'status': {'name': 'To Do'}, 'customfield_team': {'id': 'team-a'}}},
                {'key': 'S2', 'fields': {'customfield_epic_link': 'EPIC-1', 'status': {'name': 'Done'}, 'customfield_team': {'id': 'team-a'}}},
                {'key': 'S3', 'fields': {'customfield_epic_link': 'EPIC-1', 'status': {'name': 'In Progress'}, 'customfield_team': {'id': 'team-b'}}},
            ],
            'isLast': True,
        }

        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            distribution = jira_server.fetch_story_distribution_for_epics(
                ['EPIC-1'], {}, 'customfield_epic_link', '42', team_field_id='customfield_team'
            )

        self.assertEqual(distribution['EPIC-1']['selectedActionableStories'], 2)
        self.assertEqual(
            distribution['EPIC-1']['selectedActionableByTeam'],
            {'team-a': 1, 'team-b': 1}
        )

    def test_story_distribution_without_selected_sprint_has_empty_team_breakdown(self):
        jira_payload = {
            'issues': [
                {'key': 'S1', 'fields': {'customfield_epic_link': 'EPIC-1', 'status': {'name': 'To Do'}, 'customfield_team': {'id': 'team-a'}}},
            ],
            'isLast': True,
        }

        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            distribution = jira_server.fetch_story_distribution_for_epics(
                ['EPIC-1'], {}, 'customfield_epic_link', '', team_field_id='customfield_team'
            )

        self.assertEqual(distribution['EPIC-1']['selectedActionableByTeam'], {})

    def test_fetch_tasks_attaches_selected_actionable_by_team_and_threads_team_field(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'issues': [],
            'names': {
                'customfield_team': 'Team[Team]',
                'customfield_epic_link': 'Epic Link',
                'customfield_sprint': 'Sprint',
            },
            'isLast': True,
        }
        epics_in_scope = [{
            'key': 'EPIC-1',
            'summary': 'Epic one',
            'status': {'name': 'To Do'},
            'labels': ['2026Q3', 'team_alpha_label'],
            'teamId': 'team-a',
            'teamName': 'Team Alpha',
            'fields': {'customfield_10101': [{'id': 123, 'name': '2026Q3'}]},
        }]
        distribution_mock = Mock(return_value={
            'EPIC-1': {
                'selectedStories': 1,
                'selectedActionableStories': 1,
                'futureOpenStories': 0,
                'openStoriesOutsideSelected': 0,
                'selectedActionableByTeam': {'team-a': 1},
            }
        })

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_story_points'), \
             patch.object(jira_server, 'fetch_epic_details_bulk', return_value={}), \
             patch.object(jira_server, 'fetch_epics_for_empty_alert', return_value=epics_in_scope), \
             patch.object(jira_server, 'fetch_story_counts_for_epics', return_value={'EPIC-1': 2}), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', distribution_mock), \
             patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            response = client.get('/api/tasks-with-team-name?sprint=789&sprintName=2026Q4&team=all&purpose=alerts')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        epics = (response.get_json() or {}).get('epicsInScope') or []
        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('selectedActionableByTeam'), {'team-a': 1})
        self.assertEqual(distribution_mock.call_args.kwargs.get('team_field_id'), 'customfield_team')

    def test_fetch_tasks_passes_request_team_labels_to_epic_scope(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'issues': [],
            'names': {
                'customfield_team': 'Team[Team]',
                'customfield_epic_link': 'Epic Link',
                'customfield_sprint': 'Sprint',
            },
            'total': 0,
            'isLast': True,
        }

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'fetch_epic_details_bulk', return_value={}), \
             patch.object(jira_server, 'fetch_epics_for_empty_alert', return_value=[]) as epics_fetch, \
             patch.object(jira_server, 'fetch_story_counts_for_epics', return_value={}), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value={}), \
             patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, jira_payload)):
            response = client.get('/api/tasks-with-team-name?sprint=123&team=all&teamIds=team-a,team-b&teamLabels=team_alpha_label,team_beta_label')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(epics_fetch.call_args.args[-3], ['team_alpha_label', 'team_beta_label'])

    def test_ready_to_close_fetch_scans_non_epic_child_work_and_explicit_epic_keys(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        search_mock = Mock(side_effect=[
            _mock_response(200, {
                'issues': [{
                    'key': 'CHILD-1',
                    'fields': {
                        'status': {'name': 'Done'},
                        'issuetype': {'name': 'Development'},
                        'parent': {
                            'key': 'EPIC-1',
                            'fields': {'issuetype': {'name': 'Epic'}}
                        },
                        'customfield_team': {'id': 'team-a', 'name': 'Team Alpha'},
                        'customfield_sprint': [{'id': 123, 'name': '2026Q2'}],
                    }
                }],
                'names': {
                    'customfield_team': 'Team[Team]',
                    'customfield_epic_link': 'Epic Link',
                    'customfield_sprint': 'Sprint',
                },
                'total': 1,
                'isLast': True,
            }),
            _mock_response(200, {
                'issues': [{
                    'key': 'EPIC-1',
                    'fields': {
                        'summary': 'Epic one',
                        'status': {'name': 'In Progress'},
                        'labels': ['team_alpha_label'],
                        'customfield_team': {'id': 'team-a', 'name': 'Team Alpha'},
                        'customfield_sprint': [{'id': 123, 'name': '2026Q2'}],
                    }
                }],
                'names': {
                    'customfield_team': 'Team[Team]',
                    'customfield_sprint': 'Sprint',
                },
                'total': 1,
                'isLast': True,
            }),
        ])

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'get_configured_issue_types', return_value=['Story', 'Task']), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'EPIC_EMPTY_TEAM_IDS', ['other-team']), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value={
                 'EPIC-1': {'openStoriesOutsideSelected': 0}
             }), \
             patch.object(jira_server, 'jira_search_request', search_mock):
            response = client.get('/api/tasks-with-team-name?project=product&purpose=ready-to-close&epicKeys=EPIC-1&refresh=true')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        task_jql = search_mock.call_args_list[0].args[0].get('jql', '')
        epic_jql = search_mock.call_args_list[1].args[0].get('jql', '')
        self.assertIn('issuetype != Epic', task_jql)
        self.assertNotIn('type = "Story"', task_jql)
        self.assertNotIn('project =', task_jql.lower())
        self.assertNotIn('"team[team]"', task_jql.lower())
        self.assertIn('issueKey in ("EPIC-1")', epic_jql)
        self.assertNotIn('"Team[Team]" = "other-team"', epic_jql)
        payload = response.get_json() or {}
        self.assertEqual(len(payload.get('issues') or []), 1)
        epics = payload.get('epicsInScope') or []
        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('key'), 'EPIC-1')
        # No open children -> safe to surface as ready to close.
        self.assertEqual(epics[0].get('openChildCount'), 0)

    def test_ready_to_close_without_explicit_epic_keys_uses_empty_alert_scope(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        search_mock = Mock(return_value=_mock_response(200, {
            'issues': [],
            'names': {
                'customfield_team': 'Team[Team]',
                'customfield_epic_link': 'Epic Link',
                'customfield_sprint': 'Sprint',
            },
            'total': 0,
            'isLast': True,
        }))

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'get_configured_issue_types', return_value=['Story', 'Task']), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'fetch_epics_for_empty_alert', return_value=[]), \
             patch.object(jira_server, 'jira_search_request', search_mock):
            response = client.get('/api/tasks-with-team-name?project=product&purpose=ready-to-close&refresh=true')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        task_jql = search_mock.call_args_list[0].args[0].get('jql', '')
        self.assertIn('issuetype != Epic', task_jql)

    def test_ready_to_close_batches_epic_key_jql_at_40(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        epic_keys = [f'EPIC-{index:03d}' for index in range(1, 42)]
        task_jqls = []

        def search_tasks(payload):
            task_jqls.append(payload.get('jql', ''))
            child_index = len(task_jqls)
            return _mock_response(200, {
                'issues': [{
                    'key': f'CHILD-{child_index}',
                    'fields': {
                        'status': {'name': 'Done'},
                        'parent': {
                            'key': 'EPIC-001' if child_index == 1 else 'EPIC-041',
                            'fields': {'issuetype': {'name': 'Epic'}},
                        },
                    },
                }],
                'names': {
                    'customfield_team': 'Team[Team]',
                    'customfield_epic_link': 'Epic Link',
                    'customfield_sprint': 'Sprint',
                },
                'total': 1,
                'isLast': True,
            })

        epics_in_scope = [{'key': key} for key in epic_keys]
        open_child_distribution = {
            key: {'openStoriesOutsideSelected': 0} for key in epic_keys
        }

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'fetch_epics_by_keys_for_alert_service', return_value=epics_in_scope), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value=open_child_distribution), \
             patch.object(jira_server, 'jira_search_request', side_effect=search_tasks):
            response = client.get(
                '/api/tasks-with-team-name?project=product&purpose=ready-to-close'
                f'&epicKeys={",".join(epic_keys)}&refresh=true'
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        response_payload = response.get_json() or {}
        self.assertEqual(len(response_payload.get('issues') or []), 2)
        self.assertEqual(len(response_payload.get('epicsInScope') or []), 41)
        self.assertEqual(len(task_jqls), 2)
        self.assertEqual(task_jqls[0].count('"EPIC-'), 80)
        self.assertEqual(task_jqls[1].count('"EPIC-'), 2)
        self.assertIn('"EPIC-040"', task_jqls[0])
        self.assertNotIn('"EPIC-041"', task_jqls[0])
        self.assertIn('"EPIC-041"', task_jqls[1])
        for task_jql in task_jqls:
            self.assertIn('issuetype != Epic', task_jql)
            self.assertIn('"Epic Link" in (', task_jql)
            self.assertIn('OR parent in (', task_jql)
            self.assertNotIn('Sprint =', task_jql)

    def test_ready_to_close_attaches_open_child_count_from_distribution(self):
        """Ready-to-close epics carry an authoritative open-child count so the
        client never flags an epic that still has open work in a future sprint,
        regardless of how the truncatable child task list was paginated."""
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        search_mock = Mock(side_effect=[
            _mock_response(200, {
                'issues': [{
                    'key': 'CHILD-DONE',
                    'fields': {
                        'status': {'name': 'Done'},
                        'parent': {'key': 'EPIC-1', 'fields': {'issuetype': {'name': 'Epic'}}},
                    }
                }],
                'names': {'customfield_epic_link': 'Epic Link'},
                'total': 1,
                'isLast': True,
            }),
            _mock_response(200, {
                'issues': [{
                    'key': 'EPIC-1',
                    'fields': {'summary': 'Epic one', 'status': {'name': 'In Progress'}}
                }],
                'names': {},
                'total': 1,
                'isLast': True,
            }),
        ])

        with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
             patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
             patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value={
                 'EPIC-1': {
                     'selectedStories': 0,
                     'selectedActionableStories': 0,
                     'futureOpenStories': 1,
                     'openStoriesOutsideSelected': 1,
                 }
             }) as distribution_mock, \
             patch.object(jira_server, 'jira_search_request', search_mock):
            response = client.get('/api/tasks-with-team-name?project=product&purpose=ready-to-close&epicKeys=EPIC-1&refresh=true')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        epics = (response.get_json() or {}).get('epicsInScope') or []
        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('key'), 'EPIC-1')
        # Authoritative open-child count surfaces the open future-sprint child,
        # so the client keeps the epic out of "Ready to Close".
        self.assertEqual(epics[0].get('openChildCount'), 1)
        # Counted against all sprints (selected_sprint passed as empty string).
        self.assertEqual(distribution_mock.call_args.args[0], ['EPIC-1'])
        self.assertEqual(distribution_mock.call_args.args[-1], '')

    def test_fetch_epics_for_empty_alert_returns_labels(self):
        payload = {
            'issues': [{
                'key': 'EPIC-1',
                'fields': {
                    'summary': 'Epic one',
                    'status': {'name': 'To Do'},
                    'assignee': {'displayName': 'Alice'},
                    'labels': ['2026Q2', 'team_alpha_label'],
                    'customfield_team': {'id': 'team-a', 'name': 'Example Team Alpha'}
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
        self.assertEqual(epics[0].get('labels'), ['2026Q2', 'team_alpha_label'])

    def test_fetch_epics_for_empty_alert_preserves_sprint_field_for_future_planning_match(self):
        sprint_value = [{'id': 123, 'name': '2026Q2'}]
        payload = {
            'issues': [{
                'key': 'EPIC-2',
                'fields': {
                    'summary': 'Epic two',
                    'status': {'name': 'To Do'},
                    'assignee': {'displayName': 'Alice'},
                    'labels': ['2026Q2', 'team_beta_label'],
                    'customfield_team': {'id': 'team-a', 'name': 'Example Team Beta'},
                    'customfield_sprint': sprint_value
                }
            }]
        }

        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, payload)):
            epics = jira_server.fetch_epics_for_empty_alert(
                'project = TEST',
                headers={'Authorization': 'Bearer test'},
                team_field_id='customfield_team',
                epic_name_field='customfield_epic_name',
                sprint_field_id='customfield_sprint'
            )

        self.assertEqual(len(epics), 1)
        self.assertEqual(epics[0].get('fields', {}).get('customfield_10101'), sprint_value)

    def test_fetch_epics_for_empty_alert_strips_task_team_filter_for_label_scoped_epics(self):
        payload = {'issues': []}

        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, payload)) as search_mock:
            jira_server.fetch_epics_for_empty_alert(
                'project = TEST AND "Team[Team]" in ("team-a", "team-b") AND Sprint = 123 AND type = "Story"',
                headers={'Authorization': 'Bearer test'},
                team_field_id='customfield_team',
                epic_name_field='customfield_epic_name',
                sprint_field_id='customfield_sprint',
                scope_team_ids=['team-a', 'team-b'],
                scope_team_labels=['team_alpha_label', 'team_beta_label']
            )

        epic_jql = search_mock.call_args.args[0].get('jql', '')
        self.assertNotIn('AND "Team[Team]" in ("team-a", "team-b") AND', epic_jql)
        self.assertIn('("Team[Team]" in ("team-a", "team-b") OR labels in ("team_alpha_label", "team_beta_label"))', epic_jql)
        self.assertIn('type = "Epic"', epic_jql)
        self.assertIn('Sprint = 123', epic_jql)

    def test_fetch_epics_for_empty_alert_includes_selected_sprint_label_scope(self):
        payload = {'issues': []}

        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, payload)) as search_mock:
            jira_server.fetch_epics_for_empty_alert(
                'project = TEST AND Sprint = 123 AND type = "Story"',
                headers={'Authorization': 'Bearer test'},
                team_field_id='customfield_team',
                epic_name_field='customfield_epic_name',
                sprint_field_id='customfield_sprint',
                scope_sprint_label='2026Q3'
            )

        epic_jql = search_mock.call_args.args[0].get('jql', '')
        self.assertIn('(Sprint = 123 OR labels in ("2026Q3", "2026Q3_candidate"))', epic_jql)
        self.assertIn('type = "Epic"', epic_jql)

    def test_alert_epic_scope_follows_pages_and_deduplicates_candidate(self):
        first = {'issues': [{'key': 'EPIC-1', 'fields': {'labels': ['2026Q3']}}],
                 'isLast': False, 'nextPageToken': 'page-2'}
        second = {'issues': [
            {'key': 'EPIC-1', 'fields': {'labels': ['2026Q3']}},
            {'key': 'EPIC-2', 'fields': {'labels': ['2026Q3_Candidate', 'team_alpha_label'],
                                         'customfield_sprint': None}},
        ], 'isLast': True}
        with patch.object(jira_server, 'jira_search_request', side_effect=[
            _mock_response(200, first), _mock_response(200, second)
        ]) as search_mock:
            epics = jira_server.fetch_epics_for_empty_alert(
                'project = TEST AND Sprint = 123 AND type = "Story"', {},
                'customfield_team', 'customfield_epic_name', 'customfield_sprint',
                ['team-a'], ['team_alpha_label'], '2026Q3', complete_alert_scope=True
            )
        self.assertEqual([epic['key'] for epic in epics], ['EPIC-1', 'EPIC-2'])
        self.assertEqual(epics[1]['labels'], ['2026Q3_Candidate', 'team_alpha_label'])
        self.assertIsNone(epics[1]['fields']['customfield_10101'])
        self.assertEqual(search_mock.call_args_list[0].args[0]['maxResults'], 100)
        self.assertEqual(search_mock.call_args_list[1].args[0]['nextPageToken'], 'page-2')
        self.assertIn('(Sprint = 123 OR labels in ("2026Q3", "2026Q3_candidate"))',
                      search_mock.call_args_list[0].args[0]['jql'])
        self.assertIn('("Team[Team]" = "team-a" OR labels = "team_alpha_label")',
                      search_mock.call_args_list[0].args[0]['jql'])

    def test_alert_epic_scope_rejects_failed_or_incomplete_pages(self):
        malformed_pages = [
            _mock_response(503),
            _mock_response(200, {'issues': None, 'isLast': True}),
            _mock_response(200, {'issues': [], 'isLast': False}),
            _mock_response(200, {'issues': [], 'isLast': False, 'nextPageToken': 'again'}),
        ]
        for first_response in malformed_pages:
            with self.subTest(first_response=first_response.json()), \
                 patch.object(jira_server, 'jira_search_request', return_value=first_response):
                with self.assertRaises(RuntimeError):
                    jira_server.fetch_epics_for_empty_alert(
                        'project = TEST', {}, None, None, complete_alert_scope=True
                    )
        repeated = {'issues': [], 'isLast': False, 'nextPageToken': 'again'}
        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, repeated)) as search_mock:
            with self.assertRaises(RuntimeError):
                jira_server.fetch_epics_for_empty_alert('project = TEST', {}, None, None, complete_alert_scope=True)
        self.assertEqual(search_mock.call_count, 2)

    def test_alert_epic_scope_enforces_unique_epic_and_page_limits(self):
        def over_epics(payload):
            page = int(str(payload.get('nextPageToken') or '0'))
            return _mock_response(200, {
                'issues': [{'key': f'EPIC-{page * 100 + index}', 'fields': {}}
                           for index in range(100 if page < 20 else 1)],
                'isLast': page == 20,
                'nextPageToken': str(page + 1) if page < 20 else None,
            })
        with patch.object(jira_server, 'jira_search_request', side_effect=over_epics):
            with self.assertRaisesRegex(RuntimeError, 'Epic limit'):
                jira_server.fetch_epics_for_empty_alert('project = TEST', {}, None, None, complete_alert_scope=True)
        page = {'issues': [], 'isLast': False}
        tokens = iter(f'page-{index}' for index in range(102))
        def search(_payload):
            return _mock_response(200, {**page, 'nextPageToken': next(tokens)})
        with patch.object(jira_server, 'jira_search_request', side_effect=search) as search_mock:
            with self.assertRaisesRegex(RuntimeError, 'page limit'):
                jira_server.fetch_epics_for_empty_alert('project = TEST', {}, None, None, complete_alert_scope=True)
        self.assertEqual(search_mock.call_count, 101)

    def test_ordinary_epic_scope_keeps_single_page(self):
        page = {'issues': [], 'isLast': False, 'nextPageToken': 'another-page'}
        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, page)) as search_mock:
            self.assertEqual(jira_server.fetch_epics_for_empty_alert('project = TEST', {}, None, None), [])
        self.assertEqual(search_mock.call_count, 1)
        self.assertEqual(search_mock.call_args.args[0]['maxResults'], 250)

    def test_failed_alert_epic_scan_does_not_publish_or_cache_empty_scope(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        task_page = {'issues': [], 'names': {'customfield_team': 'Team[Team]'},
                     'total': 0, 'isLast': True}
        responses = [_mock_response(200, task_page), _mock_response(503)]
        before_cache = dict(jira_server.TASKS_CACHE)
        try:
            jira_server.TASKS_CACHE.clear()
            with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
                 patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
                 patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']), \
                 patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
                 patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
                 patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
                 patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_story_points'), \
                 patch.object(jira_server, 'fetch_epic_details_bulk', return_value={}), \
                 patch.object(jira_server, 'jira_home_partitioned_process_cache_enabled', return_value=True), \
                 patch.object(jira_server, 'build_jira_home_process_cache_key', side_effect=lambda _context, key: key), \
                 patch.object(jira_server, 'build_tasks_cache_key', wraps=jira_server.build_tasks_cache_key) as cache_key_mock, \
                 patch.object(jira_server, 'jira_search_request', side_effect=responses):
                response = client.get('/api/tasks-with-team-name?sprint=123&sprintName=2026Q3&purpose=alerts&refresh=true')
            self.assertEqual(response.status_code, 500)
            self.assertNotIn('epicsInScope', response.get_json() or {})
            self.assertEqual(cache_key_mock.call_count, 1)
            # The route-generated key must have no successful cached response.
            alert_key = jira_server.build_tasks_cache_key(*cache_key_mock.call_args.args, **cache_key_mock.call_args.kwargs)
            self.assertNotIn(alert_key, jira_server.TASKS_CACHE)
        finally:
            jira_server.TASKS_CACHE.clear()
            jira_server.TASKS_CACHE.update(before_cache)

    def test_task_route_cache_separates_sprint_name_for_same_sprint_id(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        task_page = {'issues': [], 'names': {'customfield_team': 'Team[Team]'},
                     'total': 0, 'isLast': True}
        before_cache = dict(jira_server.TASKS_CACHE)
        try:
            jira_server.TASKS_CACHE.clear()
            with patch.object(jira_server, 'build_base_jql', return_value='project = TEST'), \
                 patch.object(jira_server, 'get_selected_projects_typed', return_value=[]), \
                 patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']), \
                 patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
                 patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
                 patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
                 patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_story_points'), \
                 patch.object(jira_server, 'fetch_epic_details_bulk', return_value={}), \
                 patch.object(jira_server, 'fetch_story_counts_for_epics', return_value={}), \
                 patch.object(jira_server, 'fetch_story_distribution_for_epics', return_value={}), \
                 patch.object(jira_server, 'jira_home_partitioned_process_cache_enabled', return_value=True), \
                 patch.object(jira_server, 'build_jira_home_process_cache_key', side_effect=lambda _context, key: key), \
                 patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, task_page)), \
                 patch.object(jira_server, 'fetch_epics_for_empty_alert', side_effect=lambda *args: [{'key': args[-2]}]) as epic_fetch:
                first = client.get('/api/tasks-with-team-name?sprint=123&sprintName=2026Q3&purpose=alerts')
                second = client.get('/api/tasks-with-team-name?sprint=123&sprintName=2026Q4&purpose=alerts')
            self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
            self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
            self.assertEqual(first.get_json()['epicsInScope'][0]['key'], '2026Q3')
            self.assertEqual(second.get_json()['epicsInScope'][0]['key'], '2026Q4')
            self.assertEqual(epic_fetch.call_count, 2)
        finally:
            jira_server.TASKS_CACHE.clear()
            jira_server.TASKS_CACHE.update(before_cache)

    def test_task_cache_key_distinguishes_normalized_sprint_names(self):
        args = ('123', 'default', 'all', [], [], True, False)
        first = jira_server.build_tasks_cache_key(*args, sprint_name=' 2026Q3 ')
        self.assertEqual(first, jira_server.build_tasks_cache_key(*args, sprint_name='2026q3'))
        self.assertNotEqual(first, jira_server.build_tasks_cache_key(*args, sprint_name='2026Q4'))

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
                    'customfield_team': {'id': 'team-a', 'name': 'Example Team Alpha'},
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
        self.assertEqual(epics[0].get('labels'), [])
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
                    'customfield_team': {'id': 'team-a', 'name': 'Example Team Alpha'},
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

    def test_backlog_epic_response_preserves_both_sprint_label_forms(self):
        issues = [
            {'key': 'EPIC-1', 'fields': {'labels': ['2026Q3']}},
            {'key': 'EPIC-2', 'fields': {'labels': ['2026Q3_Candidate']}},
            {'key': 'EPIC-3', 'fields': {}},
        ]
        with patch.object(jira_server, 'jira_search_request', return_value=_mock_response(200, {'issues': issues})) as search_mock:
            epics = jira_server.fetch_backlog_epics_for_alert('project = TEST', {}, None, None, None)
        self.assertEqual([epic['labels'] for epic in epics], [['2026Q3'], ['2026Q3_Candidate'], []])
        self.assertIn('labels', search_mock.call_args.args[0]['fields'])


class TestAlertEpicScopeTooLarge(unittest.TestCase):
    def test_both_ceilings_raise_the_dedicated_runtime_error(self):
        self.assertTrue(issubclass(alert_epics.AlertEpicScopeTooLarge, RuntimeError))

        def over_epics(payload):
            page = int(str(payload.get('nextPageToken') or '0'))
            return _mock_response(200, {
                'issues': [{'key': f'PROJ-{page * 100 + index}', 'fields': {}} for index in range(100)],
                'isLast': False, 'nextPageToken': str(page + 1),
            })
        with self.assertRaises(alert_epics.AlertEpicScopeTooLarge):
            alert_epics.fetch_complete_alert_epic_issues({'jql': 'x'}, over_epics)

        tokens = iter(f'page-{index}' for index in range(102))
        with self.assertRaises(alert_epics.AlertEpicScopeTooLarge):
            alert_epics.fetch_complete_alert_epic_issues(
                {'jql': 'x'}, lambda _payload: _mock_response(200, {
                    'issues': [], 'isLast': False, 'nextPageToken': next(tokens)}))

    def test_other_failures_keep_the_plain_runtime_error(self):
        for response in (_mock_response(503), _mock_response(200, {'issues': None, 'isLast': True}),
                         _mock_response(200, {'issues': [], 'isLast': False})):
            with self.subTest(status=response.status_code):
                with self.assertRaises(RuntimeError) as raised:
                    alert_epics.fetch_complete_alert_epic_issues({'jql': 'x'}, lambda _payload: response)
                self.assertNotIsInstance(raised.exception, alert_epics.AlertEpicScopeTooLarge)


class _AnyToken(dict):
    """Epic page table that answers every continuation token with one page builder."""

    def __init__(self, page):
        super().__init__()
        self._page = page

    def __getitem__(self, _token):
        return self._page


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestTaskRouteTeamLabelAliases(unittest.TestCase):
    """Basic-mode task route: saved aliases come from the dashboard JSON teamGroups."""

    QUERY = ('/api/tasks-with-team-name?sprint=123&sprintName=2026Q3&team=all'
             '&groupId=department-a&teamIds=team-a&teamLabels=label_team_a')

    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True
        self.client = jira_server.app.test_client()
        before_cache = dict(jira_server.TASKS_CACHE)
        jira_server.TASKS_CACHE.clear()

        def restore_cache():
            jira_server.TASKS_CACHE.clear()
            jira_server.TASKS_CACHE.update(before_cache)
        self.addCleanup(restore_cache)
        self.saved_aliases = ['label_team_a']
        self.epic_pages = {None: {'issues': [], 'isLast': True}}
        self.search_payloads = []

    def _dashboard(self, *_args, **_kwargs):
        return {'teamGroups': {'version': 2, 'defaultGroupId': 'department-a', 'groups': [{
            'id': 'department-a', 'name': 'Department A', 'teamIds': ['team-a'],
            'teamLabels': {'team-a': list(self.saved_aliases)},
        }]}}

    def _search(self, payload):
        self.search_payloads.append(dict(payload))
        if 'type = "Epic"' in payload['jql']:
            page = self.epic_pages[payload.get('nextPageToken')]
            return _mock_response(200, page(payload) if callable(page) else page)
        return _mock_response(200, {'issues': [], 'names': {'customfield_team': 'Team[Team]'},
                                    'total': 0, 'isLast': True})

    def _epic_jqls(self):
        return [payload['jql'] for payload in self.search_payloads if 'type = "Epic"' in payload['jql']]

    @contextlib.contextmanager
    def _route(self, **extra):
        patches = {
            'load_dashboard_config': Mock(side_effect=self._dashboard),
            'build_base_jql': Mock(return_value='project = PROJ'),
            'get_selected_projects_typed': Mock(return_value=[]),
            'get_configured_issue_types': Mock(return_value=['Story']),
            'resolve_team_field_id': Mock(return_value='customfield_team'),
            'resolve_epic_link_field_id': Mock(return_value='customfield_epic_link'),
            'get_sprint_field_id': Mock(return_value='customfield_sprint'),
            'get_story_points_field_id': Mock(return_value='customfield_story_points'),
            'fetch_epic_details_bulk': Mock(return_value={}),
            'fetch_story_counts_for_epics': Mock(return_value={}),
            'fetch_story_distribution_for_epics': Mock(return_value={}),
            'jira_home_partitioned_process_cache_enabled': Mock(return_value=True),
            'build_jira_home_process_cache_key': Mock(side_effect=lambda _context, key: key),
            'jira_search_request': Mock(side_effect=self._search),
        }
        patches.update(extra)
        with contextlib.ExitStack() as stack:
            for name, value in patches.items():
                stack.enter_context(patch.object(jira_server, name, value))
            yield patches

    def test_alias_only_epic_on_alert_page_two_reaches_epics_in_scope(self):
        self.saved_aliases = ['label_team_a', 'label_team_b']
        self.epic_pages = {
            None: {'issues': [{'key': 'PROJ-1', 'fields': {'labels': ['label_team_a']}}],
                   'isLast': False, 'nextPageToken': 'page-2'},
            'page-2': {'issues': [{'key': 'PROJ-2', 'fields': {'labels': ['label_team_b']}}], 'isLast': True},
        }
        with self._route():
            response = self.client.get(self.QUERY + '&purpose=alerts')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([epic['key'] for epic in response.get_json()['epicsInScope']], ['PROJ-1', 'PROJ-2'])
        epic_jqls = self._epic_jqls()
        self.assertEqual(len(epic_jqls), 2)
        self.assertIn('(Sprint = 123 OR labels in ("2026Q3", "2026Q3_candidate"))', epic_jqls[0])
        self.assertIn('("Team[Team]" = "team-a" OR labels in ("label_team_a", "label_team_b"))', epic_jqls[0])
        self.assertEqual(epic_jqls[0].count('label_team_b'), 1)

    def test_alert_and_dashboard_discovery_keep_terminal_status_exclusion(self):
        for purpose in ('alerts', 'dashboard'):
            with self.subTest(purpose=purpose), self._route():
                self.search_payloads.clear()
                response = self.client.get(self.QUERY + f'&purpose={purpose}&refresh=true')
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                epic_jql = self._epic_jqls()[0]
                excluded = ', '.join(f'"{status}"' for status in jira_server.EPIC_EMPTY_EXCLUDED_STATUSES)
                self.assertIn(f'status not in ({excluded})', epic_jql)
                for status in ('Done', 'Killed', 'Incomplete'):
                    self.assertIn(status, jira_server.EPIC_EMPTY_EXCLUDED_STATUSES)

    def test_dashboard_purpose_issues_exactly_one_discovery_search(self):
        self.saved_aliases = ['label_team_a', 'label_team_b']
        self.epic_pages = {None: {'issues': [{'key': 'PROJ-1', 'fields': {'labels': ['label_team_a']}}],
                                  'isLast': False, 'nextPageToken': 'page-2'}}
        with self._route():
            response = self.client.get(self.QUERY)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(len(self._epic_jqls()), 1)
        self.assertEqual(self.search_payloads[-1]['maxResults'], 250)

    def test_saved_alias_change_with_identical_query_misses_cache_and_reaches_jql(self):
        with self._route():
            first = self.client.get(self.QUERY + '&purpose=alerts')
            self.saved_aliases = ['label_team_a', 'label_team_b']
            second = self.client.get(self.QUERY + '&purpose=alerts')
            third = self.client.get(self.QUERY + '&purpose=alerts')

        for response in (first, second, third):
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        epic_jqls = self._epic_jqls()
        self.assertEqual(len(epic_jqls), 2, 'identical saved aliases must hit the cache')
        self.assertNotIn('label_team_b', epic_jqls[0])
        self.assertIn('labels in ("label_team_a", "label_team_b")', epic_jqls[1])
        self.assertIn('cache;dur=1', third.headers['Server-Timing'])

    def test_groups_server_timing_phase_on_miss_and_hit(self):
        with self._route():
            miss = self.client.get(self.QUERY)
            hit = self.client.get(self.QUERY)
        self.assertRegex(miss.headers['Server-Timing'], r'(^|, )groups;dur=[0-9.]+')
        self.assertNotIn('cache;dur', miss.headers['Server-Timing'])
        self.assertRegex(hit.headers['Server-Timing'], r'^cache;dur=1, groups;dur=[0-9.]+$')

    def _over_epic_limit(self, payload):
        page = int(str(payload.get('nextPageToken') or '0'))
        return {'issues': [{'key': f'PROJ-{page * 100 + index}', 'fields': {}} for index in range(100)],
                'isLast': False, 'nextPageToken': str(page + 1)}

    def test_both_alert_ceilings_return_uncached_scope_too_large(self):
        tokens = iter(f'page-{index}' for index in range(102))
        page_ceiling = lambda _payload: {'issues': [], 'isLast': False, 'nextPageToken': next(tokens)}
        for name, page in (('epic_limit', self._over_epic_limit), ('page_limit', page_ceiling)):
            with self.subTest(ceiling=name):
                self.epic_pages = _AnyToken(page)
                jira_server.TASKS_CACHE.clear()
                with self._route():
                    response = self.client.get(self.QUERY + '&purpose=alerts')
                self.assertEqual(response.status_code, 422, response.get_data(as_text=True))
                self.assertEqual(response.get_json(), {
                    'error': 'alert_scope_too_large',
                    'message': 'This Department is too large for Epic alerts.',
                })
                # The route sets 'no-cache, no-store, must-revalidate'; the global /api
                # security-header hook then normalizes every API response to 'no-store'.
                self.assertIn('no-store', response.headers['Cache-Control'])
                self.assertEqual(jira_server.TASKS_CACHE, {})
                self.assertNotIn('label_team', response.get_data(as_text=True))

    def test_non_200_and_malformed_alert_pages_still_return_500(self):
        for page in ({'issues': None, 'isLast': True}, {'issues': [], 'isLast': False}):
            with self.subTest(page=page):
                self.epic_pages = {None: page}
                jira_server.TASKS_CACHE.clear()
                with self._route():
                    response = self.client.get(self.QUERY + '&purpose=alerts')
                self.assertEqual(response.status_code, 500)
                self.assertEqual(jira_server.TASKS_CACHE, {})

        first_page = {'issues': [{'key': 'PROJ-1', 'fields': {'labels': ['label_team_a']}}],
                      'isLast': False, 'nextPageToken': 'page-2'}

        def search(payload):
            if payload.get('nextPageToken') == 'page-2':
                self.search_payloads.append(dict(payload))
                return _mock_response(503)
            return self._search(payload)
        self.epic_pages = {None: first_page}
        self.search_payloads.clear()
        jira_server.TASKS_CACHE.clear()
        with self._route(jira_search_request=Mock(side_effect=search)):
            response = self.client.get(self.QUERY + '&purpose=alerts')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('epicsInScope', response.get_json() or {})
        self.assertEqual(len(self._epic_jqls()), 2)
        self.assertEqual(jira_server.TASKS_CACHE, {})

    def test_denied_project_request_skips_the_saved_groups_read(self):
        denied = Mock(side_effect=lambda *_args: (jira_server.jsonify({'error': 'project_access_denied'}), 403))
        with self._route(project_access_denied_response=denied,
                         load_request_effective_groups=Mock(side_effect=AssertionError('groups read'))) as patches:
            response = self.client.get(self.QUERY + '&project=product')
        self.assertEqual(response.status_code, 403)
        patches['load_request_effective_groups'].assert_not_called()
        patches['jira_search_request'].assert_not_called()

    def test_no_label_value_in_server_logs_or_error_bodies(self):
        self.saved_aliases = ['label_team_a', 'label_team_b']
        log_mocks = {name: Mock() for name in ('log_info', 'log_warning', 'log_error', 'log_debug')}
        logger = Mock()
        bodies = []
        with self._route(logger=logger, **log_mocks):
            bodies.append(self.client.get(self.QUERY + '&purpose=alerts').get_data(as_text=True))
            self.epic_pages = _AnyToken(self._over_epic_limit)
            bodies.append(self.client.get(self.QUERY + '&purpose=alerts&refresh=true').get_data(as_text=True))
            self.epic_pages = {None: {'issues': None, 'isLast': True}}
            bodies.append(self.client.get(self.QUERY + '&purpose=alerts&refresh=true').get_data(as_text=True))
        logged = ' '.join(str(call) for mock in [logger, *log_mocks.values()] for call in mock.mock_calls)
        self.assertTrue(logged)
        self.assertNotIn('label_team', logged)
        for body in bodies[1:]:
            self.assertNotIn('label_team', body)


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestCreateStoriesAlertApi(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        jira_server.LABELS_CACHE['data'] = None
        jira_server.LABELS_CACHE['timestamp'] = 0

    def test_jira_labels_endpoint_returns_label_results(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()

        jira_payload = {
            'results': [
                {'value': 'team_alpha_label', 'displayName': '<b>team_</b>alpha_label'},
                {'value': 'team_beta_label', 'displayName': '<b>team_</b>beta_label'},
            ]
        }

        with patch.object(jira_server, 'current_jira_get', return_value=_mock_response(200, jira_payload)):
            response = client.get('/api/jira/labels?query=team_')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertEqual(payload.get('labels'), ['team_alpha_label', 'team_beta_label'])

    def test_jira_labels_endpoint_fetches_all_pages_before_prefix_filtering(self):
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
            'values': ['team_beta_label'],
            'isLast': True,
            'startAt': 1,
            'maxResults': 1
        }

        with patch(
            'jira_server.current_jira_get',
            side_effect=[_mock_response(200, first_page), _mock_response(200, second_page)]
        ) as mock_get:
            response = client.get('/api/jira/labels?prefix=team_&refresh=1')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json() or {}
        self.assertEqual(payload.get('labels'), ['team_beta_label'])
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

    def test_backlog_epics_epic_keys_scope_both_searches(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        epic_payload = {
            'issues': [{
                'key': 'EPIC-42',
                'fields': {
                    'summary': 'Backlog epic',
                    'status': {'name': 'To Do'},
                    'assignee': {'displayName': 'Alice'},
                    'components': [{'name': 'BidSwitch'}],
                    'customfield_team': {'id': 'team-a', 'name': 'Example Team Alpha'},
                    'customfield_sprint': None
                }
            }]
        }
        child_payload = {'issues': []}

        with patch.object(
            jira_server,
            'jira_search_request',
            side_effect=[_mock_response(200, epic_payload), _mock_response(200, child_payload)]
        ) as mock_search, \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'):
            response = client.get('/api/backlog-epics?project=product&epicKeys=EPIC-42')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([epic['key'] for epic in response.get_json()['epics']], ['EPIC-42'])
        epic_jql = mock_search.call_args_list[0].args[0]['jql']
        children_jql = mock_search.call_args_list[1].args[0]['jql']
        self.assertIn('issueKey in ("EPIC-42")', epic_jql)
        self.assertIn('EPIC-42', children_jql)
        self.assertNotIn('EPIC-43', children_jql)

    def test_backlog_epics_without_epic_keys_adds_no_issue_key_clause(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        with patch.object(jira_server, 'fetch_backlog_epics_for_alert', return_value=[]) as mock_fetch, \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'):
            response = client.get('/api/backlog-epics?project=product')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertNotIn('issueKey', mock_fetch.call_args.args[0])

    def test_backlog_epics_rejects_bad_or_multiple_epic_keys(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        for value in ('not-a-key', 'EPIC-1,EPIC-2', 'EPIC-1)%20OR%20(a=b'):
            with patch.object(jira_server, 'fetch_backlog_epics_for_alert') as mock_fetch:
                response = client.get(f'/api/backlog-epics?project=product&epicKeys={value}')
            self.assertEqual(response.status_code, 400, value)
            self.assertEqual(response.get_json()['error'], 'invalid_epic_keys')
            mock_fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
