import unittest
from unittest.mock import Mock, patch

import jira_server


def make_issue(key, issue_type='Story', summary=None, parent_key='', labels=None, sprint=None, epic_link=''):
    fields = {
        'summary': summary or key,
        'status': {'name': 'In Progress'},
        'assignee': {'displayName': 'Alex'},
        'issuetype': {'name': issue_type},
        'labels': list(labels or []),
    }
    if parent_key:
        fields['parent'] = {
            'key': parent_key,
            'fields': {
                'summary': f'{parent_key} summary',
                'issuetype': {'name': 'Epic'},
            },
        }
    if sprint != 'absent':
        fields['customfield_sprint'] = sprint
    if epic_link:
        fields['customfield_epiclink'] = epic_link
    return {'key': key, 'fields': fields}


def empty_rollup_flags(payload):
    return {
        'metadataOnly': payload['metadataOnly'],
        'emptyRollup': payload['emptyRollup'],
        'truncated': payload['truncated'],
        'truncatedQueries': payload['truncatedQueries'],
        'initiatives': payload['initiatives'],
        'rootEpics': payload['rootEpics'],
        'orphanStories': payload['orphanStories'],
    }


def collect_hierarchy_issue_keys(payload):
    keys = []
    for initiative in payload['initiatives'].values():
        keys.append(initiative['issue']['key'])
        for epic in initiative['epics'].values():
            keys.append(epic['issue']['key'])
            keys.extend(story['key'] for story in epic['stories'])
        keys.extend(story['key'] for story in initiative['looseStories'])
    for epic in payload['rootEpics'].values():
        keys.append(epic['issue']['key'])
        keys.extend(story['key'] for story in epic['stories'])
    keys.extend(story['key'] for story in payload['orphanStories'])
    return keys


class TestEpmRollupApi(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        jira_server.EPM_ISSUES_CACHE.clear()
        jira_server.EPM_ROLLUP_CACHE.clear()

    def patch_common(self, project, fetch_side_effect, base_jql='project = SYN ORDER BY created DESC', issue_types=None):
        return (
            patch.object(jira_server, 'find_epm_project_or_404', return_value=project),
            patch.object(jira_server, 'build_base_jql', return_value=base_jql),
            patch.object(jira_server, 'build_jira_headers', return_value={'Authorization': 'Basic synthetic'}),
            patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epiclink'),
            patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'),
            patch.object(jira_server, 'get_epm_config', return_value={
                'version': 2,
                'labelPrefix': 'synthetic_',
                'scope': {},
                'issueTypes': issue_types or jira_server.DEFAULT_EPM_ISSUE_TYPES,
                'projects': {},
            }),
            patch.object(jira_server, 'fetch_issues_by_jql', side_effect=fetch_side_effect),
        )

    def test_metadata_only_project_skips_all_rollup_queries(self):
        project = {'id': 'project-1', 'label': '', 'resolvedLinkage': {'labels': [], 'epicKeys': []}}
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project), \
             patch.object(jira_server, 'fetch_issues_by_jql') as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(empty_rollup_flags(response.get_json()), {
            'metadataOnly': True,
            'emptyRollup': False,
            'truncated': False,
            'truncatedQueries': [],
            'initiatives': {},
            'rootEpics': {},
            'orphanStories': [],
        })
        mock_fetch.assert_not_called()

    def test_empty_rollup_skips_q2_and_q3(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        patches = self.patch_common(project, [[]])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(empty_rollup_flags(response.get_json()), {
            'metadataOnly': False,
            'emptyRollup': True,
            'truncated': False,
            'truncatedQueries': [],
            'initiatives': {},
            'rootEpics': {},
            'orphanStories': [],
        })
        self.assertEqual(mock_fetch.call_count, 1)

    def test_rollup_executes_q1_q2_q3_dedupes_and_builds_three_buckets(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        q1 = [
            make_issue('SYN-I1', 'Initiative', labels=['synthetic_label_alpha']),
            make_issue('SYN-ER', 'Epic', labels=['synthetic_label_alpha']),
            make_issue('SYN-SO', 'Story', labels=['synthetic_label_alpha']),
            make_issue('SYN-SD', 'Story', parent_key='SYN-ER', labels=['synthetic_label_alpha']),
        ]
        q2 = [
            make_issue('SYN-EC', 'Epic', parent_key='SYN-I1'),
            make_issue('SYN-SL', 'Story', parent_key='SYN-I1'),
            make_issue('SYN-SR', 'Story', parent_key='SYN-ER'),
            make_issue('SYN-SLEG', 'Story', epic_link='SYN-ER'),
            make_issue('SYN-SD', 'Story', parent_key='SYN-ER'),
        ]
        q3 = [make_issue('SYN-SC', 'Story', parent_key='SYN-EC')]
        patches = self.patch_common(project, [q1, q2, q3])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload['metadataOnly'])
        self.assertFalse(payload['emptyRollup'])
        self.assertFalse(payload['truncated'])
        self.assertEqual(payload['truncatedQueries'], [])
        self.assertEqual(mock_fetch.call_count, 3)
        q1_jql, q2_jql, q3_jql = [call.args[0] for call in mock_fetch.call_args_list]
        self.assertIn('labels = "synthetic_label_alpha"', q1_jql)
        self.assertIn('"Epic Link" in ("SYN-ER", "SYN-I1") OR parent in ("SYN-ER", "SYN-I1")', q2_jql)
        self.assertIn('"Epic Link" in ("SYN-EC") OR parent in ("SYN-EC")', q3_jql)
        self.assertEqual(payload['initiatives']['SYN-I1']['epics']['SYN-EC']['stories'][0]['key'], 'SYN-SC')
        self.assertEqual(payload['initiatives']['SYN-I1']['looseStories'][0]['key'], 'SYN-SL')
        root_story_keys = [story['key'] for story in payload['rootEpics']['SYN-ER']['stories']]
        self.assertEqual(root_story_keys, ['SYN-SD', 'SYN-SR', 'SYN-SLEG'])
        self.assertEqual(payload['rootEpics']['SYN-ER']['stories'][2]['parentKey'], 'SYN-ER')
        self.assertEqual([story['key'] for story in payload['orphanStories']], ['SYN-SO'])
        all_keys = collect_hierarchy_issue_keys(payload)
        self.assertEqual(len(all_keys), len(set(all_keys)))
        self.assertEqual(set(all_keys), {'SYN-I1', 'SYN-ER', 'SYN-SO', 'SYN-SD', 'SYN-EC', 'SYN-SL', 'SYN-SR', 'SYN-SLEG', 'SYN-SC'})

    def test_rollup_uses_configurable_issue_type_buckets_case_insensitively(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        issue_types = {
            'initiative': ['Theme'],
            'epic': ['Feature'],
            'leaf': ['Work'],
        }
        q1 = [make_issue('SYN-T1', 'theme', labels=['synthetic_label_alpha'])]
        q2 = [make_issue('SYN-W1', 'Work', parent_key='SYN-T1')]
        patches = self.patch_common(project, [q1, q2], issue_types=issue_types)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_fetch.call_count, 2)
        self.assertIn('"SYN-T1"', mock_fetch.call_args_list[1].args[0])
        payload = response.get_json()
        self.assertIn('SYN-T1', payload['initiatives'])
        self.assertEqual(payload['initiatives']['SYN-T1']['looseStories'][0]['key'], 'SYN-W1')

    def test_rollup_preserves_tab_sprint_validation(self):
        with patch.object(jira_server, 'find_epm_project_or_404') as mock_find:
            missing = self.client.get('/api/epm/projects/project-1/rollup?tab=active')
            non_numeric = self.client.get('/api/epm/projects/project-1/rollup?tab=active&sprint=abc')

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.get_json(), {'error': 'sprint_required'})
        self.assertEqual(non_numeric.status_code, 400)
        self.assertEqual(non_numeric.get_json(), {'error': 'sprint_not_numeric'})
        mock_find.assert_not_called()

        project = {'id': 'project-1', 'label': '', 'resolvedLinkage': {'labels': [], 'epicKeys': []}}
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project):
            self.assertEqual(self.client.get('/api/epm/projects/project-1/rollup?tab=backlog').status_code, 200)
            self.assertEqual(self.client.get('/api/epm/projects/project-1/rollup?tab=archived').status_code, 200)

    def test_all_projects_rollup_preserves_active_sprint_validation(self):
        with patch.object(jira_server, 'build_epm_projects_payload') as mock_projects:
            missing = self.client.get('/api/epm/projects/rollup/all?tab=active')
            non_numeric = self.client.get('/api/epm/projects/rollup/all?tab=active&sprint=abc')

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.get_json(), {'error': 'sprint_required'})
        self.assertEqual(non_numeric.status_code, 400)
        self.assertEqual(non_numeric.get_json(), {'error': 'sprint_not_numeric'})
        mock_projects.assert_not_called()

    def test_all_projects_rollup_filters_visible_projects_and_reports_duplicates(self):
        projects = [
            {
                'id': 'active-one',
                'displayName': 'Active One',
                'label': 'synthetic_one',
                'resolvedLinkage': {'labels': ['synthetic_one'], 'epicKeys': []},
                'matchState': 'home-linked',
                'tabBucket': 'active',
            },
            {
                'id': 'backlog-one',
                'displayName': 'Backlog One',
                'label': 'synthetic_backlog',
                'resolvedLinkage': {'labels': ['synthetic_backlog'], 'epicKeys': []},
                'matchState': 'home-linked',
                'tabBucket': 'backlog',
            },
            {
                'id': 'metadata-one',
                'displayName': 'Metadata One',
                'label': '',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
                'tabBucket': 'active',
            },
            {
                'id': 'custom-all',
                'displayName': 'Custom All',
                'label': 'synthetic_custom',
                'resolvedLinkage': {'labels': ['synthetic_custom'], 'epicKeys': []},
                'matchState': 'jep-fallback',
                'tabBucket': 'all',
            },
        ]

        def rollup_side_effect(project_id, tab, sprint, _deps):
            self.assertEqual(tab, 'active')
            self.assertEqual(sprint, '42')
            if project_id == 'active-one':
                return {
                    'project': projects[0],
                    'metadataOnly': False,
                    'emptyRollup': False,
                    'truncated': False,
                    'truncatedQueries': [],
                    'initiatives': {},
                    'rootEpics': {},
                    'orphanStories': [make_issue('SYN-DUP')['fields'] | {'key': 'SYN-DUP'}],
                }, 200, {}
            if project_id == 'custom-all':
                return {
                    'project': projects[3],
                    'metadataOnly': False,
                    'emptyRollup': False,
                    'truncated': True,
                    'truncatedQueries': ['q1'],
                    'initiatives': {},
                    'rootEpics': {},
                    'orphanStories': [make_issue('SYN-DUP')['fields'] | {'key': 'SYN-DUP'}],
                }, 200, {}
            raise AssertionError(f'unexpected rollup project {project_id}')

        with patch.object(jira_server, 'get_epm_config', return_value={'version': 2}), \
             patch.object(jira_server, 'build_epm_projects_payload', return_value={'projects': projects}), \
             patch.object(jira_server, 'build_per_project_rollup', side_effect=rollup_side_effect) as mock_rollup:
            response = self.client.get('/api/epm/projects/rollup/all?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual([entry['project']['id'] for entry in payload['projects']], ['active-one', 'metadata-one', 'custom-all'])
        self.assertEqual(mock_rollup.call_count, 2)
        self.assertEqual([call.args[0] for call in mock_rollup.call_args_list], ['active-one', 'custom-all'])
        self.assertTrue(payload['truncated'])
        self.assertEqual(payload['duplicates'], {'SYN-DUP': ['active-one', 'custom-all']})
        metadata_rollup = payload['projects'][1]['rollup']
        self.assertTrue(metadata_rollup['metadataOnly'])
        self.assertFalse(metadata_rollup['emptyRollup'])

    def test_all_projects_rollup_reports_server_timing_breakdown(self):
        projects = [
            {
                'id': 'active-one',
                'displayName': 'Active One',
                'label': 'synthetic_one',
                'resolvedLinkage': {'labels': ['synthetic_one'], 'epicKeys': []},
                'matchState': 'home-linked',
                'tabBucket': 'active',
            },
        ]

        with patch.object(jira_server, 'get_epm_config', return_value={'version': 2}), \
             patch.object(jira_server, 'build_epm_projects_payload', return_value={'projects': projects}), \
             patch.object(jira_server, 'build_per_project_rollup', return_value=(
                 {
                     'project': projects[0],
                     'metadataOnly': False,
                     'emptyRollup': True,
                     'truncated': False,
                     'truncatedQueries': [],
                     'initiatives': {},
                     'rootEpics': {},
                     'orphanStories': [],
                 },
                 200,
                 {},
             )):
            response = self.client.get('/api/epm/projects/rollup/all?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        server_timing = response.headers.get('Server-Timing', '')
        self.assertIn('home-projects;dur=', server_timing)
        self.assertIn('epm-rollups;dur=', server_timing)
        self.assertIn('total;dur=', server_timing)

    def test_active_labeled_epic_fetches_all_selected_sprint_stories_under_epic(self):
        project = {
            'id': 'project-1',
            'label': 'synthetic_label_alpha',
            'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []},
        }
        q1 = [
            make_issue(
                'PRODUCT-29920',
                'Epic',
                summary='AI for RFP creation',
                labels=['synthetic_label_alpha'],
                sprint=[{'id': 42, 'name': '2026Q2', 'state': 'active'}],
            )
        ]
        q2 = [
            make_issue(
                'PRODUCT-30001',
                'Story',
                summary='Generate RFP outline',
                parent_key='PRODUCT-29920',
                labels=[],
                sprint=[{'id': 42, 'name': '2026Q2', 'state': 'active'}],
            ),
            make_issue(
                'PRODUCT-30002',
                'Story',
                summary='Validate extracted requirements',
                epic_link='PRODUCT-29920',
                labels=[],
                sprint=[{'id': 42, 'name': '2026Q2', 'state': 'active'}],
            ),
        ]
        patches = self.patch_common(project, [q1, q2])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(mock_fetch.call_count, 2)
        q1_jql, q2_jql = [call.args[0] for call in mock_fetch.call_args_list]
        self.assertIn('labels = "synthetic_label_alpha"', q1_jql)
        self.assertNotIn('Sprint = 42', q1_jql)
        self.assertIn('"Epic Link" in ("PRODUCT-29920") OR parent in ("PRODUCT-29920")', q2_jql)
        self.assertIn('Sprint = 42', q2_jql)
        payload = response.get_json()
        story_keys = [story['key'] for story in payload['rootEpics']['PRODUCT-29920']['stories']]
        self.assertEqual(story_keys, ['PRODUCT-30001', 'PRODUCT-30002'])

    def test_active_label_root_finds_unsprinted_initiative_then_selected_sprint_stories(self):
        project = {
            'id': 'CRITE-723',
            'label': 'rnd_project_bsw_enriched_deals_redesign',
            'resolvedLinkage': {'labels': ['rnd_project_bsw_enriched_deals_redesign'], 'epicKeys': []},
        }
        q1 = [
            make_issue(
                'PRODUCT-34928',
                'Initiative',
                summary='Enriched Deals Redesign',
                labels=['rnd_project_bsw_enriched_deals_redesign'],
                sprint=[],
            )
        ]
        q2 = [
            make_issue('PRODUCT-35001', 'Epic', summary='Redesign serving path', parent_key='PRODUCT-34928', sprint=[]),
            make_issue('PRODUCT-35099', 'Story', summary='Wrong sprint direct child', parent_key='PRODUCT-34928', sprint=[{'id': 7, 'name': '2026Q1'}]),
        ]
        q3 = [
            make_issue('PRODUCT-35111', 'Story', summary='Selected sprint story', parent_key='PRODUCT-35001', sprint=[{'id': 42, 'name': '2026Q2'}]),
        ]
        patches = self.patch_common(project, [q1, q2, q3])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/CRITE-723/rollup?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(mock_fetch.call_count, 3)
        q1_jql, q2_jql, q3_jql = [call.args[0] for call in mock_fetch.call_args_list]
        self.assertIn('labels = "rnd_project_bsw_enriched_deals_redesign"', q1_jql)
        self.assertNotIn('Sprint = 42', q1_jql)
        self.assertIn('parent in ("PRODUCT-34928")', q2_jql)
        self.assertNotIn('Sprint = 42', q2_jql)
        self.assertIn('parent in ("PRODUCT-35001")', q3_jql)
        self.assertIn('Sprint = 42', q3_jql)
        payload = response.get_json()
        self.assertIn('PRODUCT-34928', payload['initiatives'])
        self.assertIn('PRODUCT-35001', payload['initiatives']['PRODUCT-34928']['epics'])
        story_keys = [story['key'] for story in payload['initiatives']['PRODUCT-34928']['epics']['PRODUCT-35001']['stories']]
        self.assertEqual(story_keys, ['PRODUCT-35111'])
        self.assertEqual(payload['initiatives']['PRODUCT-34928']['looseStories'], [])

    def test_rollup_story_payload_contains_eng_card_fields(self):
        project = {
            'id': 'project-1',
            'label': 'synthetic_label_alpha',
            'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []},
        }
        story = make_issue(
            'PRODUCT-30001',
            'Story',
            summary='Generate RFP outline',
            parent_key='PRODUCT-29920',
            labels=[],
            sprint=[{'id': 42, 'name': '2026Q2', 'state': 'active'}],
        )
        story['id'] = '30001'
        story['fields']['priority'] = {'name': 'High'}
        story['fields']['updated'] = '2026-04-28T12:00:00.000+0000'
        story['fields']['customfield_10004'] = 3
        story['fields']['customfield_team'] = {'id': 'team-a', 'name': 'Team A'}
        q1 = [make_issue('PRODUCT-29920', 'Epic', labels=['synthetic_label_alpha'])]
        q2 = [story]
        patches = self.patch_common(project, [q1, q2])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], \
             patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_10004'), \
             patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'):
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload_story = response.get_json()['rootEpics']['PRODUCT-29920']['stories'][0]
        self.assertEqual(payload_story['id'], '30001')
        self.assertEqual(payload_story['priority'], 'High')
        self.assertEqual(payload_story['storyPoints'], 3)
        self.assertEqual(payload_story['updated'], '2026-04-28T12:00:00.000+0000')
        self.assertEqual(payload_story['teamName'], 'Team A')
        self.assertEqual(payload_story['teamId'], 'team-a')

    def test_active_sprint_filter_starts_at_story_query_and_sprint_reaches_response(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        q1 = [make_issue('SYN-I1', 'Initiative', labels=['synthetic_label_alpha'], sprint=[{'id': '42', 'name': 'Sprint 42', 'state': 'ACTIVE'}])]
        q2 = [make_issue('SYN-E2', 'Epic', parent_key='SYN-I1', sprint=['com.atlassian.greenhopper.service.sprint.Sprint@abc[id=42,state=ACTIVE,name=Sprint 42]'])]
        q3 = [make_issue('SYN-S1', 'Story', parent_key='SYN-E2', sprint=[{'id': 42, 'name': 'Sprint 42', 'state': 'ACTIVE'}])]
        patches = self.patch_common(project, [q1, q2, q3])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200)
        jql_queries = [call.args[0] for call in mock_fetch.call_args_list]
        self.assertIn('labels = "synthetic_label_alpha"', jql_queries[0])
        self.assertNotIn('Sprint = 42', jql_queries[0])
        self.assertNotIn('Sprint = 42', jql_queries[1])
        self.assertIn('Sprint = 42', jql_queries[2])
        for jql in jql_queries:
            self.assertNotIn('Team[Team]', jql)
            self.assertNotIn('"Team"', jql)
        payload = response.get_json()
        self.assertEqual(payload['initiatives']['SYN-I1']['issue']['sprint'], [{'id': 42, 'name': 'Sprint 42', 'state': 'ACTIVE'}])
        self.assertEqual(payload['initiatives']['SYN-I1']['epics']['SYN-E2']['issue']['sprint'], [{'id': 42, 'name': 'Sprint 42', 'state': 'ACTIVE'}])
        self.assertEqual(payload['initiatives']['SYN-I1']['epics']['SYN-E2']['stories'][0]['sprint'], [{'id': 42, 'name': 'Sprint 42', 'state': 'ACTIVE'}])

    def test_backlog_rollup_does_not_append_sprint_filter(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        patches = self.patch_common(project, [[make_issue('SYN-S1', 'Story', labels=['synthetic_label_alpha'])]])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        for call in mock_fetch.call_args_list:
            self.assertNotIn('Sprint =', call.args[0])

    def test_active_empty_q1_does_not_fetch_descendants(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        patches = self.patch_common(project, [[]])
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['emptyRollup'])
        self.assertEqual(mock_fetch.call_count, 1)

    def test_rollup_cache_key_and_config_save_invalidation(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        patches = self.patch_common(
            project,
            [
                [make_issue('SYN-S1', 'Story', labels=['synthetic_label_alpha'])],
                [make_issue('SYN-S2', 'Story', labels=['synthetic_label_alpha'])],
            ],
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch, \
             patch.object(jira_server, 'load_dashboard_config', return_value={'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}), \
             patch.object(jira_server, 'save_dashboard_config'):
            first = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')
            second = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')
            save = self.client.post('/api/epm/config', json={'version': 2, 'projects': {}})
            third = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(save.status_code, 200)
        self.assertEqual(third.status_code, 200)
        self.assertEqual(mock_fetch.call_count, 2)
        self.assertEqual(second.headers.get('Server-Timing'), 'cache;dur=1')
        self.assertEqual(first.get_json()['orphanStories'][0]['key'], 'SYN-S1')
        self.assertEqual(third.get_json()['orphanStories'][0]['key'], 'SYN-S2')

    def test_rollup_resolves_custom_uuid_without_home_fetch(self):
        project_id = '1234567890abcdef1234567890abcdef'
        config = {
            'version': 2,
            'labelPrefix': 'synthetic_',
            'scope': {},
            'issueTypes': jira_server.DEFAULT_EPM_ISSUE_TYPES,
            'projects': {
                project_id: {'id': project_id, 'homeProjectId': None, 'name': 'Custom', 'label': 'synthetic_label_alpha'}
            },
        }
        with patch.object(jira_server, 'get_epm_config', return_value=config), \
             patch.object(jira_server, 'fetch_epm_home_projects') as mock_home, \
             patch.object(jira_server, 'build_base_jql', return_value='project = SYN ORDER BY created DESC'), \
             patch.object(jira_server, 'build_jira_headers', return_value={'Authorization': 'Basic synthetic'}), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epiclink'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'fetch_issues_by_jql', return_value=[make_issue('SYN-S1', 'Story', labels=['synthetic_label_alpha'])]) as mock_fetch:
            response = self.client.get(f'/api/epm/projects/{project_id}/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        mock_home.assert_not_called()
        self.assertEqual(mock_fetch.call_count, 1)
        self.assertEqual(response.get_json()['project']['id'], project_id)

    def test_rollup_sprint_normalization_does_not_change_legacy_issues_response_shape(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        issues = [
            make_issue('SYN-S1', 'Story', labels=['synthetic_label_alpha'], sprint=[{'id': '42', 'name': 'Sprint 42', 'state': 'ACTIVE'}]),
            make_issue('SYN-S2', 'Story', labels=['synthetic_label_alpha'], sprint=['com.atlassian.greenhopper.service.sprint.Sprint@abc[id=7,state=CLOSED,name=Old]']),
            make_issue('SYN-S3', 'Story', labels=['synthetic_label_alpha'], sprint='absent'),
        ]
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project), \
             patch.object(jira_server, 'build_base_jql', return_value='project = SYN ORDER BY created DESC'), \
             patch.object(jira_server, 'build_jira_headers', return_value={'Authorization': 'Basic synthetic'}), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epiclink'), \
             patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'), \
             patch.object(jira_server, 'get_epm_config', return_value={'version': 2, 'issueTypes': jira_server.DEFAULT_EPM_ISSUE_TYPES, 'projects': {}, 'scope': {}}), \
             patch.object(jira_server, 'fetch_issues_by_jql', return_value=issues):
            rollup_response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(rollup_response.status_code, 200)
        rollup_issues = rollup_response.get_json()['orphanStories']
        self.assertEqual(rollup_issues[0]['sprint'], [{'id': 42, 'name': 'Sprint 42', 'state': 'ACTIVE'}])
        self.assertEqual(rollup_issues[1]['sprint'], [{'id': 7, 'name': 'Old', 'state': 'CLOSED'}])
        self.assertEqual(rollup_issues[2]['sprint'], [])

        jira_server.EPM_ISSUES_CACHE.clear()
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project), \
             patch.object(jira_server, 'build_base_jql', return_value='project = SYN ORDER BY created DESC'), \
             patch.object(jira_server, 'build_jira_headers', return_value={'Authorization': 'Basic synthetic'}), \
             patch.object(jira_server, 'fetch_issues_by_jql', return_value=issues):
            issues_response = self.client.get('/api/epm/projects/project-1/issues?tab=backlog')

        self.assertEqual(issues_response.status_code, 200)
        legacy_issue = issues_response.get_json()['issues'][0]
        self.assertEqual(sorted(legacy_issue.keys()), ['assignee', 'issueType', 'key', 'labels', 'parentKey', 'status', 'summary'])

    def test_rollup_truncates_q1_and_passes_explicit_max_results(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        over_cap_q1 = [
            make_issue('SYN-S1', 'Story', labels=['synthetic_label_alpha']),
            make_issue('SYN-S2', 'Story', labels=['synthetic_label_alpha']),
            make_issue('SYN-S3', 'Story', labels=['synthetic_label_alpha']),
        ]
        patches = self.patch_common(project, [over_cap_q1])
        with patch.object(jira_server, 'EPM_ROLLUP_QUERY_MAX_RESULTS', 2), \
             patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6] as mock_fetch:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['truncated'])
        self.assertEqual(payload['truncatedQueries'], ['q1'])
        self.assertEqual([story['key'] for story in payload['orphanStories']], ['SYN-S1', 'SYN-S2'])
        self.assertEqual(mock_fetch.call_args.kwargs['max_results'], 3)

    def test_rollup_truncates_q2_without_silent_completion(self):
        project = {'id': 'project-1', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        q1 = [make_issue('SYN-E1', 'Epic', labels=['synthetic_label_alpha'])]
        q2 = [
            make_issue('SYN-S1', 'Story', parent_key='SYN-E1'),
            make_issue('SYN-S2', 'Story', parent_key='SYN-E1'),
            make_issue('SYN-S3', 'Story', parent_key='SYN-E1'),
        ]
        patches = self.patch_common(project, [q1, q2])
        with patch.object(jira_server, 'EPM_ROLLUP_QUERY_MAX_RESULTS', 2), \
             patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            response = self.client.get('/api/epm/projects/project-1/rollup?tab=backlog')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['truncated'])
        self.assertEqual(payload['truncatedQueries'], ['q2'])
        self.assertEqual([story['key'] for story in payload['rootEpics']['SYN-E1']['stories']], ['SYN-S1', 'SYN-S2'])

    def test_epic_link_resolver_uses_dedicated_cache_not_parent_name_config(self):
        jira_server.EPIC_LINK_FIELD_CACHE = None
        jira_server.PARENT_NAME_FIELD_CACHE = 'customfield_parentname'
        response = Mock(status_code=200)
        response.json.return_value = [
            {'id': 'customfield_parentname', 'name': 'Parent Name'},
            {'id': 'customfield_epiclink', 'name': 'Epic Link'},
        ]

        try:
            with patch.object(jira_server, 'requests') as mock_requests:
                mock_requests.get.return_value = response

                field_id = jira_server.resolve_epic_link_field_id({'Authorization': 'Basic synthetic'})

            self.assertEqual(field_id, 'customfield_epiclink')
            self.assertEqual(jira_server.EPIC_LINK_FIELD_CACHE, 'customfield_epiclink')
            self.assertEqual(jira_server.PARENT_NAME_FIELD_CACHE, 'customfield_parentname')
        finally:
            jira_server.EPIC_LINK_FIELD_CACHE = None
            jira_server.PARENT_NAME_FIELD_CACHE = None

    def test_epm_rollup_builder_does_not_reference_team_group_scope(self):
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[1]
        source = (repo_root / 'epm_rollup.py').read_text(encoding='utf-8')

        for forbidden in (
            'teamGroups',
            'team_groups',
            'TEAM_FIELD',
            'Team[Team]',
            '"Team"',
        ):
            self.assertNotIn(forbidden, source)

    def test_epic_link_resolver_uses_names_map_before_rest_lookup(self):
        jira_server.EPIC_LINK_FIELD_CACHE = None

        try:
            with patch.object(jira_server, 'requests') as mock_requests:
                field_id = jira_server.resolve_epic_link_field_id(
                    {'Authorization': 'Basic synthetic'},
                    names_map={'customfield_epiclink': 'Epic Link'},
                )

            self.assertEqual(field_id, 'customfield_epiclink')
            mock_requests.get.assert_not_called()
        finally:
            jira_server.EPIC_LINK_FIELD_CACHE = None


if __name__ == '__main__':
    unittest.main()
