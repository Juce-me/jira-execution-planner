import threading
import unittest

import jira_server
from epm_rollup import EpmRollupDependencies, build_per_project_rollup


class BuildPerProjectRollupTests(unittest.TestCase):
    def make_deps(self, project, fetch_results):
        cache = {}
        fetch_calls = []

        def fetch_epm_rollup_query(jql, query_name, headers, fields_list, truncated_queries):
            fetch_calls.append((query_name, jql))
            return list(fetch_results.pop(0)) if fetch_results else []

        deps = EpmRollupDependencies(
            find_epm_project_or_404=lambda project_id: project,
            normalize_epm_text=jira_server.normalize_epm_text,
            validate_epm_tab_sprint=jira_server.validate_epm_tab_sprint,
            build_empty_epm_rollup_payload=jira_server.build_empty_epm_rollup_payload,
            build_base_jql=lambda: 'project = SYN ORDER BY created DESC',
            add_clause_to_jql=jira_server.add_clause_to_jql,
            build_jira_headers=lambda: {'Authorization': 'Basic synthetic'},
            resolve_epic_link_field_id=lambda headers: 'customfield_epiclink',
            resolve_team_field_id=lambda headers: 'customfield_team',
            build_epm_rollup_fields_list=jira_server.build_epm_rollup_fields_list,
            get_epm_config=lambda: {
                'version': 2,
                'labelPrefix': 'synthetic_',
                'scope': {},
                'issueTypes': jira_server.DEFAULT_EPM_ISSUE_TYPES,
                'projects': {},
            },
            normalize_epm_issue_type_sets=jira_server.normalize_epm_issue_type_sets,
            fetch_epm_rollup_query=fetch_epm_rollup_query,
            shape_epm_rollup_issue_payload=jira_server.shape_epm_rollup_issue_payload,
            dedupe_issues_by_key=jira_server.dedupe_issues_by_key,
            build_epm_rollup_hierarchy=jira_server.build_epm_rollup_hierarchy,
            cache=cache,
            cache_lock=threading.Lock(),
            cache_ttl_seconds=300,
        )
        return deps, cache, fetch_calls

    def make_issue(self, key, issue_type='Story', parent_key='', labels=None):
        fields = {
            'summary': key,
            'status': {'name': 'In Progress'},
            'assignee': {'displayName': 'Alex'},
            'issuetype': {'name': issue_type},
            'labels': list(labels or []),
            'customfield_sprint': [],
        }
        if parent_key:
            fields['parent'] = {
                'key': parent_key,
                'fields': {
                    'summary': f'{parent_key} summary',
                    'issuetype': {'name': 'Epic'},
                },
            }
        return {'key': key, 'fields': fields}

    def test_metadata_only_short_circuit(self):
        project = {'id': 'proj-a', 'label': '', 'resolvedLinkage': {'labels': [], 'epicKeys': []}}
        deps, _, fetch_calls = self.make_deps(project, [])

        payload, status, headers = build_per_project_rollup('proj-a', 'backlog', '', deps)

        self.assertEqual(status, 200)
        self.assertEqual(headers, {})
        self.assertTrue(payload['metadataOnly'])
        self.assertFalse(payload['emptyRollup'])
        self.assertEqual(fetch_calls, [])

    def test_empty_rollup_when_no_q1_hits(self):
        project = {'id': 'proj-b', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        deps, cache, fetch_calls = self.make_deps(project, [[]])

        payload, status, headers = build_per_project_rollup('proj-b', 'backlog', '', deps)

        self.assertEqual(status, 200)
        self.assertFalse(payload['metadataOnly'])
        self.assertTrue(payload['emptyRollup'])
        self.assertEqual([name for name, _ in fetch_calls], ['q1'])
        self.assertIn('Server-Timing', headers)
        self.assertEqual(len(cache), 1)

    def test_active_requires_numeric_sprint(self):
        project = {'id': 'proj-c', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        deps, _, fetch_calls = self.make_deps(project, [])

        payload, status, headers = build_per_project_rollup('proj-c', 'active', '', deps)

        self.assertEqual(status, 400)
        self.assertEqual(payload, {'error': 'sprint_required'})
        self.assertEqual(headers, {})
        self.assertEqual(fetch_calls, [])

    def test_builds_initiative_epic_story_hierarchy_and_caches(self):
        project = {'id': 'proj-d', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        q1 = [self.make_issue('INIT-1', 'Initiative', labels=['synthetic_label_alpha'])]
        q2 = [self.make_issue('EPIC-1', 'Epic', parent_key='INIT-1')]
        q3 = [self.make_issue('STORY-1', 'Story', parent_key='EPIC-1')]
        deps, cache, fetch_calls = self.make_deps(project, [q1, q2, q3])

        first_payload, first_status, first_headers = build_per_project_rollup('proj-d', 'backlog', '', deps)
        second_payload, second_status, second_headers = build_per_project_rollup('proj-d', 'backlog', '', deps)

        self.assertEqual(first_status, 200)
        self.assertEqual(second_status, 200)
        self.assertIn('Server-Timing', first_headers)
        self.assertEqual(second_headers, {'Server-Timing': 'cache;dur=1'})
        self.assertEqual(first_payload, second_payload)
        self.assertEqual([name for name, _ in fetch_calls], ['q1', 'q2', 'q3'])
        self.assertEqual(len(cache), 1)
        self.assertIn('INIT-1', first_payload['initiatives'])
        self.assertIn('EPIC-1', first_payload['initiatives']['INIT-1']['epics'])
        self.assertEqual(
            first_payload['initiatives']['INIT-1']['epics']['EPIC-1']['stories'][0]['key'],
            'STORY-1',
        )


if __name__ == '__main__':
    unittest.main()
