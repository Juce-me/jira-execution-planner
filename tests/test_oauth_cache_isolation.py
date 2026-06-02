import os
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import jira_server
from backend.auth.cache_policy import (
    build_jira_home_process_cache_key,
    jira_home_partitioned_process_cache_enabled,
    jira_home_process_cache_enabled,
)
from backend.auth.context import RequestAuthContext
from backend.epm.projects import EpmProjectsDependencies, build_epm_home_projects_state
from backend.epm.issues import EpmIssuesDependencies, build_epm_project_issues_payload
from backend.epm.rollup import EpmRollupDependencies, build_per_project_rollup


REPO_ROOT = Path(__file__).resolve().parents[1]


def context(auth_mode):
    return RequestAuthContext(
        auth_mode=auth_mode,
        user_id='user-1',
        stable_subject='subject-1',
        atlassian_account_id='account-1',
        workspace_id='workspace-1',
        auth_connection_id='connection-1',
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version='1',
        account_status='active',
        is_admin=False,
    )


class TestOauthCacheIsolation(unittest.TestCase):
    def setUp(self):
        self._env_patcher = patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'jsonfile',
            'DATABASE_URL': '',
            'TEST_DATABASE_URL': '',
        }, clear=False)
        self._env_patcher.start()

    def tearDown(self):
        self._env_patcher.stop()

    def test_basic_mode_allows_process_caches(self):
        self.assertTrue(jira_home_process_cache_enabled(context('basic')))

    def test_oauth_mode_disables_process_caches(self):
        self.assertFalse(jira_home_process_cache_enabled(context('atlassian_oauth')))

    def test_oauth_home_projects_use_user_token_partitioned_cache(self):
        auth_context = context('atlassian_oauth')
        scope_key = '{"rootGoalKey": "ROOT", "subGoalKeys": ["GOAL"]}'
        partitioned_key = build_jira_home_process_cache_key(auth_context, scope_key)
        cache = {
            scope_key: {
                'timestamp': 1000,
                'fetchedAt': 'cached',
                'homeProjects': [{'id': 'cached-other-context'}],
            },
            partitioned_key: {
                'timestamp': 1000,
                'fetchedAt': 'cached',
                'homeProjects': [{'id': 'cached-current-user'}],
                'homeProjectLimit': 500,
                'possiblyTruncated': False,
            },
        }
        deps = EpmProjectsDependencies(
            fetch_epm_home_projects=lambda _scope: [{'id': 'fresh'}],
            merge_epm_linkage=lambda home_project, row: ({}, 'metadata-only'),
            normalize_epm_config=lambda payload: payload,
            utc_now_iso=lambda timespec=None: 'fresh',
            cache=cache,
            cache_lock=threading.Lock(),
            cache_ttl_seconds=300,
            home_project_limit=500,
            now=lambda: 1001,
            context=auth_context,
        )

        state = build_epm_home_projects_state(
            {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']},
            deps,
        )

        self.assertTrue(jira_home_partitioned_process_cache_enabled(auth_context))
        self.assertTrue(state['cacheHit'])
        self.assertEqual(state['homeProjects'], [{'id': 'cached-current-user'}])
        self.assertEqual(cache[scope_key]['homeProjects'], [{'id': 'cached-other-context'}])

    def test_oauth_epm_rollup_uses_user_token_partitioned_cache(self):
        auth_context = context('atlassian_oauth')
        project = {'id': 'project-1', 'label': 'synthetic_label'}
        base_jql = 'project = SYN'
        raw_key = f"project-1::active::42::synthetic_label::{base_jql}"
        partitioned_key = build_jira_home_process_cache_key(auth_context, raw_key)
        cached_payload = {
            'project': project,
            'metadataOnly': False,
            'emptyRollup': True,
            'truncated': False,
            'truncatedQueries': [],
            'initiatives': {},
            'rootEpics': {},
            'orphanStories': [],
        }
        cache = {
            raw_key: {'timestamp': 1000, 'data': {'project': {'id': 'other-context'}}},
            partitioned_key: {'timestamp': 1000, 'data': cached_payload},
        }

        def unexpected_call(*_args, **_kwargs):
            raise AssertionError('cache hit should not query Jira')

        deps = EpmRollupDependencies(
            find_epm_project_or_404=lambda _project_id: project,
            normalize_epm_text=lambda value: str(value or '').strip(),
            validate_epm_tab_sprint=lambda _tab, _sprint: None,
            build_empty_epm_rollup_payload=unexpected_call,
            build_base_jql=lambda: base_jql,
            add_clause_to_jql=unexpected_call,
            build_jira_headers=unexpected_call,
            resolve_epic_link_field_id=unexpected_call,
            resolve_team_field_id=unexpected_call,
            build_epm_rollup_fields_list=unexpected_call,
            get_epm_config=unexpected_call,
            normalize_epm_issue_type_sets=unexpected_call,
            fetch_epm_rollup_query=unexpected_call,
            shape_epm_rollup_issue_payload=unexpected_call,
            dedupe_issues_by_key=unexpected_call,
            build_epm_rollup_hierarchy=unexpected_call,
            cache=cache,
            cache_lock=threading.Lock(),
            cache_ttl_seconds=300,
            context=auth_context,
            now=lambda: 1001,
        )

        payload, status, headers = build_per_project_rollup('project-1', 'active', '42', deps)

        self.assertEqual(status, 200)
        self.assertEqual(payload, cached_payload)
        self.assertEqual(headers, {'Server-Timing': 'cache;dur=1'})
        self.assertEqual(cache[raw_key]['data'], {'project': {'id': 'other-context'}})

    def test_oauth_epm_project_issues_uses_user_token_partitioned_cache(self):
        auth_context = context('atlassian_oauth')
        project = {'id': 'project-1', 'resolvedLinkage': {'labels': ['synthetic_label'], 'epicKeys': []}}
        base_jql = 'project = SYN'
        linkage_key = '{"epicKeys": [], "labels": ["synthetic_label"]}'
        raw_key = f"project-1::active::42::{base_jql}::{linkage_key}"
        partitioned_key = build_jira_home_process_cache_key(auth_context, raw_key)
        cached_payload = {
            'project': project,
            'issues': [{'key': 'SYN-CACHED'}],
            'epics': {},
            'metadataOnly': False,
        }
        cache = {
            raw_key: {'timestamp': 1000, 'data': {'project': {'id': 'other-context'}}},
            partitioned_key: {'timestamp': 1000, 'data': cached_payload},
        }

        def unexpected_call(*_args, **_kwargs):
            raise AssertionError('cache hit should not query Jira')

        deps = EpmIssuesDependencies(
            find_epm_project_or_404=lambda _project_id: project,
            validate_epm_tab_sprint=lambda _tab, _sprint: None,
            build_epm_scope_clause=lambda _linkage: '(labels in ("synthetic_label"))',
            build_base_jql=lambda: base_jql,
            add_clause_to_jql=unexpected_call,
            fetch_issues_by_jql=unexpected_call,
            build_epm_fields_list=unexpected_call,
            shape_epm_issue_payload=unexpected_call,
            dedupe_issues_by_key=unexpected_call,
            cache=cache,
            cache_lock=threading.Lock(),
            cache_ttl_seconds=300,
            context=auth_context,
            now=lambda: 1001,
        )

        payload, status, headers = build_epm_project_issues_payload('project-1', 'active', '42', deps)

        self.assertEqual(status, 200)
        self.assertEqual(payload, cached_payload)
        self.assertEqual(headers, {'Server-Timing': 'cache;dur=1'})
        self.assertEqual(cache[raw_key]['data'], {'project': {'id': 'other-context'}})

    def test_rollup_project_lookup_keeps_oauth_context_outside_request_thread(self):
        epm_config = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']},
            'projects': {},
        }
        cache_key = jira_server.build_epm_home_projects_cache_key(epm_config['scope'])
        cached_project = {
            'homeProjectId': 'cached',
            'name': 'Cached project',
            'homeTags': ['rnd_project_cached'],
            'resolvedLinkage': {'labels': [], 'epicKeys': []},
        }
        fresh_project = {
            'homeProjectId': 'fresh',
            'name': 'Fresh project',
            'homeUrl': '',
            'stateValue': 'ON_TRACK',
            'stateLabel': 'On track',
            'tabBucket': 'active',
            'latestUpdateDate': '',
            'latestUpdateSnippet': '',
            'latestUpdateHtml': '',
            'latestUpdateAuthor': '',
            'homeTags': ['rnd_project_fresh'],
            'resolvedLinkage': {'labels': [], 'epicKeys': []},
            'matchState': 'metadata-only',
        }
        fetched_scopes = []

        def fetch_home_projects(scope, context=None):
            fetched_scopes.append(scope)
            return [fresh_project]

        jira_server.EPM_PROJECTS_CACHE.clear()
        jira_server.EPM_PROJECTS_CACHE[cache_key] = {
            'timestamp': 10**12,
            'fetchedAt': 'cached',
            'homeProjects': [cached_project],
            'homeProjectLimit': 500,
            'possiblyTruncated': False,
        }
        try:
            with jira_server.app.test_request_context('/api/epm/projects/rollup/all?tab=active&sprint=42'):
                with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                     patch.object(jira_server, 'current_request_auth_context', return_value=context('atlassian_oauth')):
                    deps = jira_server.build_epm_rollup_dependencies(sub_goal_keys=['GOAL'])
            with patch.object(jira_server, 'get_epm_config', return_value=epm_config), \
                 patch.object(jira_server, 'fetch_epm_home_projects', side_effect=fetch_home_projects):
                project = deps.find_epm_project_or_404('fresh')
        finally:
            jira_server.EPM_PROJECTS_CACHE.clear()

        self.assertEqual(project['homeProjectId'], 'fresh')
        self.assertEqual(len(fetched_scopes), 1)

    def test_known_jira_home_cache_modules_use_cache_policy(self):
        cache_sources = {
            'jira_server.py': [
                'SCENARIO_CACHE',
                'TASKS_CACHE',
                'MISSING_INFO_CACHE',
                'DEPENDENCIES_CACHE',
                'EPIC_COHORT_CACHE',
                'EPM_PROJECTS_CACHE',
                'EPM_ISSUES_CACHE',
                'EPM_ROLLUP_CACHE',
                'TEAM_FIELD_CACHE',
                'PARENT_NAME_FIELD_CACHE',
                'EPIC_LINK_FIELD_CACHE',
                'CAPACITY_FIELD_CACHE',
            ],
            'backend/epm/issues.py': ['cache_key'],
            'backend/epm/home.py': ['_CLOUD_ID_CACHE', '_GOAL_BY_KEY_CACHE'],
            'backend/epm/projects.py': ['build_epm_home_projects_cache_key'],
            'backend/epm/rollup.py': ['cache_key'],
        }
        for path, cache_symbols in cache_sources.items():
            source = (REPO_ROOT / path).read_text()
            self.assertTrue(
                'jira_home_process_cache_enabled' in source
                or 'jira_home_partitioned_process_cache_enabled' in source,
                path,
            )
            for symbol in cache_symbols:
                self.assertIn(symbol, source, path)

    def test_epm_cache_modules_partition_oauth_cache_keys(self):
        for path in (
            'backend/epm/projects.py',
            'backend/epm/issues.py',
            'backend/epm/rollup.py',
            'backend/epm/home.py',
        ):
            source = (REPO_ROOT / path).read_text()
            self.assertIn('build_jira_home_process_cache_key', source, path)
            self.assertIn('jira_home_partitioned_process_cache_enabled', source, path)
