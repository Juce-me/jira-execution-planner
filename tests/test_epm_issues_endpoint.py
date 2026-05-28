import unittest
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.epm.issues import EpmIssuesDependencies, build_epm_project_issues_payload
import jira_server
from tests.auth_mode_test_utils import force_basic_auth_mode


def make_auth_context():
    return RequestAuthContext(
        auth_mode='atlassian_oauth',
        user_id='user-1',
        stable_subject='account-1',
        atlassian_account_id='account-1',
        workspace_id='workspace-1',
        auth_connection_id='connection-1',
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version='7',
        account_status='active',
        is_admin=False,
    )


def make_issue(key, parent_key='', labels=None):
    fields = {
        'summary': f'{key} summary',
        'status': {'name': 'To Do'},
        'assignee': {'displayName': 'Alex'},
        'issuetype': {'name': 'Story'},
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
    return {'key': key, 'fields': fields}


class BuildEpmProjectIssuesPayloadTests(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True

    def make_deps(self, project, fetch_results=None, context=None, now_values=None):
        cache = {}
        fetch_calls = []
        now_values = list(now_values or [1000, 1001, 1002])

        def fetch_issues(jql, fields_list, context=None):
            fetch_calls.append((jql, fields_list, context))
            return list(fetch_results or [])

        deps = EpmIssuesDependencies(
            find_epm_project_or_404=lambda project_id: project,
            validate_epm_tab_sprint=jira_server.validate_epm_tab_sprint,
            build_epm_scope_clause=jira_server.build_epm_scope_clause,
            build_base_jql=lambda: 'project = SYN ORDER BY created DESC',
            add_clause_to_jql=jira_server.add_clause_to_jql,
            fetch_issues_by_jql=fetch_issues,
            build_epm_fields_list=lambda: ['summary', 'status'],
            shape_epm_issue_payload=jira_server.shape_epm_issue_payload,
            dedupe_issues_by_key=jira_server.dedupe_issues_by_key,
            cache=cache,
            cache_lock=jira_server._epm_cache_lock,
            cache_ttl_seconds=300,
            context=context,
            now=lambda: now_values.pop(0) if now_values else 1002,
            timer=lambda: 50.0,
        )
        return deps, cache, fetch_calls

    def test_active_missing_sprint_returns_400_without_project_lookup(self):
        def unexpected_lookup(_project_id):
            raise AssertionError('validation should run before project lookup')

        deps, _, _ = self.make_deps({'resolvedLinkage': {'labels': ['rnd_project_alpha']}})
        deps.find_epm_project_or_404 = unexpected_lookup

        payload, status, headers = build_epm_project_issues_payload('hp-1', 'active', '', deps)

        self.assertEqual(status, 400)
        self.assertEqual(payload, {'error': 'sprint_required'})
        self.assertEqual(headers, {})

    def test_metadata_only_project_skips_jira_fetch(self):
        project = {'id': 'hp-1', 'resolvedLinkage': {'labels': [], 'epicKeys': []}}
        deps, _, fetch_calls = self.make_deps(project)

        payload, status, headers = build_epm_project_issues_payload('hp-1', 'backlog', '', deps)

        self.assertEqual(status, 200)
        self.assertEqual(payload, {'project': project, 'issues': [], 'epics': {}, 'metadataOnly': True})
        self.assertEqual(headers, {})
        self.assertEqual(fetch_calls, [])

    def test_active_project_adds_scope_and_sprint_to_jql(self):
        project = {'id': 'hp-1', 'resolvedLinkage': {'labels': ['rnd_project_alpha'], 'epicKeys': []}}
        deps, _, fetch_calls = self.make_deps(project, [
            make_issue('SYN-1', parent_key='SYN-EPIC', labels=['rnd_project_alpha']),
            make_issue('SYN-1', parent_key='SYN-EPIC', labels=['rnd_project_alpha']),
        ])

        payload, status, headers = build_epm_project_issues_payload('hp-1', 'active', '42', deps)

        self.assertEqual(status, 200)
        self.assertFalse(payload['metadataOnly'])
        self.assertEqual([issue['key'] for issue in payload['issues']], ['SYN-1'])
        self.assertEqual(payload['epics']['SYN-EPIC']['summary'], 'SYN-EPIC summary')
        self.assertIn('jira-search;dur=0.0', headers['Server-Timing'])
        self.assertEqual(len(fetch_calls), 1)
        jql, fields_list, context = fetch_calls[0]
        self.assertIn('labels in ("rnd_project_alpha")', jql)
        self.assertIn('Sprint = 42', jql)
        self.assertEqual(fields_list, ['summary', 'status'])
        self.assertIsNone(context)

    def test_oauth_context_uses_partitioned_cache_hit(self):
        auth_context = make_auth_context()
        project = {'id': 'hp-1', 'resolvedLinkage': {'labels': ['rnd_project_alpha'], 'epicKeys': []}}
        cached_payload = {'project': project, 'issues': [{'key': 'SYN-CACHED'}], 'epics': {}, 'metadataOnly': False}
        deps, cache, fetch_calls = self.make_deps(project, context=auth_context, now_values=[1001])
        raw_key = 'hp-1::active::42::project = SYN ORDER BY created DESC::{"epicKeys": [], "labels": ["rnd_project_alpha"]}'
        cache[jira_server.build_jira_home_process_cache_key(auth_context, raw_key)] = {
            'timestamp': 1000,
            'data': cached_payload,
        }
        cache[raw_key] = {'timestamp': 1000, 'data': {'project': {'id': 'other-context'}}}

        payload, status, headers = build_epm_project_issues_payload('hp-1', 'active', '42', deps)

        self.assertEqual(status, 200)
        self.assertEqual(payload, cached_payload)
        self.assertEqual(headers, {'Server-Timing': 'cache;dur=1'})
        self.assertEqual(fetch_calls, [])
        self.assertEqual(cache[raw_key]['data'], {'project': {'id': 'other-context'}})

    def test_home_user_token_required_propagates_to_route_handler(self):
        with patch.object(
            jira_server,
            'find_epm_project_or_404',
            side_effect=AuthError(
                'home_user_token_required',
                'Connect your Atlassian API token to load EPM Home projects.',
            ),
        ):
            response = jira_server.app.test_client().get('/api/epm/projects/hp-1/issues?tab=backlog')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.get_json(),
            {
                'error': 'home_user_token_required',
                'message': 'Connect your Atlassian API token to load EPM Home projects.',
                'connectUrl': '/settings/connections/home-token',
            },
        )


class TestEpmIssuesEndpoint(unittest.TestCase):
    def setUp(self):
        force_basic_auth_mode(self, jira_server)
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        jira_server.EPM_ISSUES_CACHE.clear()

    def test_active_missing_sprint_returns_400_without_project_lookup(self):
        with patch.object(jira_server, 'find_epm_project_or_404') as mock_find:
            response = self.client.get('/api/epm/projects/hp-1/issues?tab=active')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'sprint_required'})
        mock_find.assert_not_called()


if __name__ == '__main__':
    unittest.main()
