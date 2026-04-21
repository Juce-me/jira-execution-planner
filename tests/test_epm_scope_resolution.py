import unittest
from unittest.mock import patch

import jira_server
from epm_scope import build_epm_scope_clause, should_apply_epm_sprint


class TestEpmScopeResolution(unittest.TestCase):
    def test_build_scope_clause_uses_label_and_epic_or_union(self):
        clause = build_epm_scope_clause({
            'labels': ['synthetic_label_alpha'],
            'epicKeys': ['SYN-123'],
        })

        self.assertIn('labels in ("synthetic_label_alpha")', clause)
        self.assertIn('"Epic Link" in ("SYN-123")', clause)
        self.assertIn('parent in ("SYN-123")', clause)
        self.assertIn('key in ("SYN-123")', clause)
        self.assertIn(' OR ', clause)

    def test_build_scope_clause_escapes_quoted_values(self):
        clause = build_epm_scope_clause({
            'labels': ['alpha"beta\\gamma'],
            'epicKeys': ['SYN"42\\X'],
        })

        self.assertIn('labels in ("alpha\\"beta\\\\gamma")', clause)
        self.assertIn('"Epic Link" in ("SYN\\"42\\\\X")', clause)

    def test_backlog_tab_does_not_apply_sprint(self):
        self.assertFalse(should_apply_epm_sprint('backlog'))

    def test_active_tab_applies_sprint(self):
        self.assertTrue(should_apply_epm_sprint('active'))


class TestEpmScopeResolutionEndpoint(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        jira_server.EPM_ISSUES_CACHE.clear()

    def test_active_missing_sprint_returns_400_before_project_lookup(self):
        with patch.object(jira_server, 'find_epm_project_or_404') as mock_find:
            response = self.client.get('/api/epm/projects/hp-1/issues?tab=active')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'sprint_required'})
        mock_find.assert_not_called()

    def test_active_non_numeric_sprint_returns_400_before_project_lookup(self):
        with patch.object(jira_server, 'find_epm_project_or_404') as mock_find:
            response = self.client.get('/api/epm/projects/hp-1/issues?tab=active&sprint=abc')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'sprint_not_numeric'})
        mock_find.assert_not_called()

    def test_backlog_metadata_only_project_skips_jira_fetch(self):
        project = {'homeProjectId': 'hp-1', 'resolvedLinkage': {}}
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project), \
             patch.object(jira_server, 'fetch_issues_by_jql') as mock_fetch:
            response = self.client.get('/api/epm/projects/hp-1/issues?tab=backlog')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'project': project,
            'issues': [],
            'epics': {},
            'metadataOnly': True,
        })
        mock_fetch.assert_not_called()

    def test_live_request_uses_inherited_base_jql_and_dedupes_payload(self):
        project = {'homeProjectId': 'hp-1', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': ['SYN-123']}}
        issues = [
            {
                'key': 'SYN-1',
                'fields': {
                    'summary': 'Story 1',
                    'status': {'name': 'In Progress'},
                    'assignee': {'displayName': 'Alex'},
                    'issuetype': {'name': 'Story'},
                    'parent': {'key': 'SYN-123', 'fields': {'summary': 'Epic 123', 'issuetype': {'name': 'Epic'}}},
                    'labels': ['synthetic_label_alpha'],
                },
            },
            {
                'key': 'SYN-1',
                'fields': {
                    'summary': 'Story 1 dup',
                    'status': {'name': 'Done'},
                    'assignee': {'displayName': 'Alex'},
                    'issuetype': {'name': 'Story'},
                    'parent': {'key': 'SYN-123', 'fields': {'summary': 'Epic 123', 'issuetype': {'name': 'Epic'}}},
                    'labels': ['synthetic_label_alpha'],
                },
            },
        ]
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project), \
             patch.object(jira_server, 'build_base_jql', return_value='project = BASE ORDER BY created DESC'), \
             patch.object(jira_server, 'fetch_issues_by_jql', return_value=issues) as mock_fetch:
            response = self.client.get('/api/epm/projects/hp-1/issues?tab=active&sprint=42')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers.get('Server-Timing', '').startswith('jira-search;dur='))
        payload = response.get_json()
        self.assertEqual(len(payload['issues']), 1)
        self.assertEqual(payload['issues'][0]['key'], 'SYN-1')
        self.assertEqual(payload['epics']['SYN-123']['summary'], 'Epic 123')
        self.assertEqual(payload['epics']['SYN-123']['issueType'], 'Epic')
        jql = mock_fetch.call_args[0][0]
        self.assertIn('project = BASE', jql)
        self.assertIn('labels in ("synthetic_label_alpha")', jql)
        self.assertIn('"Epic Link" in ("SYN-123")', jql)
        self.assertIn('parent in ("SYN-123")', jql)
        self.assertIn('Sprint = 42', jql)

    def test_issues_cache_varies_with_base_jql(self):
        project = {'homeProjectId': 'hp-1', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        first_issues = [
            {'key': 'SYN-1', 'fields': {'summary': 'First', 'status': {'name': 'In Progress'}, 'issuetype': {'name': 'Story'}, 'labels': ['synthetic_label_alpha']}},
        ]
        second_issues = [
            {'key': 'SYN-2', 'fields': {'summary': 'Second', 'status': {'name': 'In Progress'}, 'issuetype': {'name': 'Story'}, 'labels': ['synthetic_label_alpha']}},
        ]
        with patch.object(jira_server, 'find_epm_project_or_404', return_value=project), \
             patch.object(jira_server, 'build_base_jql', side_effect=[
                 'project = BASE ORDER BY created DESC',
                 'project = BASE ORDER BY created DESC',
                 'project = CHANGED ORDER BY created DESC',
             ]), \
             patch.object(jira_server, 'fetch_issues_by_jql', side_effect=[first_issues, second_issues]) as mock_fetch:
            first_response = self.client.get('/api/epm/projects/hp-1/issues?tab=backlog')
            second_response = self.client.get('/api/epm/projects/hp-1/issues?tab=backlog')
            third_response = self.client.get('/api/epm/projects/hp-1/issues?tab=backlog')

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(third_response.status_code, 200)
        self.assertEqual(mock_fetch.call_count, 2)
        self.assertEqual(second_response.headers.get('Server-Timing'), 'cache;dur=1')
        self.assertTrue(third_response.headers.get('Server-Timing', '').startswith('jira-search;dur='))
        self.assertEqual(first_response.get_json()['issues'][0]['key'], 'SYN-1')
        self.assertEqual(third_response.get_json()['issues'][0]['key'], 'SYN-2')


if __name__ == '__main__':
    unittest.main()
