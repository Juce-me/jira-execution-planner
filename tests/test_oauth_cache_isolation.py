import threading
import unittest
from pathlib import Path

from backend.auth.cache_policy import jira_home_process_cache_enabled
from backend.auth.context import RequestAuthContext
from backend.epm.projects import EpmProjectsDependencies, build_epm_home_projects_state


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
    def test_basic_mode_allows_process_caches(self):
        self.assertTrue(jira_home_process_cache_enabled(context('basic')))

    def test_oauth_mode_disables_process_caches(self):
        self.assertFalse(jira_home_process_cache_enabled(context('atlassian_oauth')))

    def test_oauth_home_projects_bypass_cache_reads_and_writes(self):
        cache = {
            '{"rootGoalKey": "ROOT", "subGoalKeys": ["GOAL"]}': {
                'timestamp': 1000,
                'fetchedAt': 'cached',
                'homeProjects': [{'id': 'cached'}],
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
            context=context('atlassian_oauth'),
        )

        state = build_epm_home_projects_state(
            {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']},
            deps,
        )

        self.assertFalse(state['cacheHit'])
        self.assertEqual(state['homeProjects'], [{'id': 'fresh'}])
        self.assertEqual(cache['{"rootGoalKey": "ROOT", "subGoalKeys": ["GOAL"]}']['homeProjects'], [{'id': 'cached'}])

    def test_known_jira_home_cache_modules_use_cache_policy(self):
        cache_sources = {
            'jira_server.py': [
                'SCENARIO_CACHE',
                'TASKS_CACHE',
                'EPIC_COHORT_CACHE',
                'EPM_PROJECTS_CACHE',
                'EPM_ISSUES_CACHE',
                'EPM_ROLLUP_CACHE',
                'TEAM_FIELD_CACHE',
                'PARENT_NAME_FIELD_CACHE',
                'EPIC_LINK_FIELD_CACHE',
                'CAPACITY_FIELD_CACHE',
            ],
            'backend/routes/epm_routes.py': ['EPM_ISSUES_CACHE'],
            'backend/epm/home.py': ['_CLOUD_ID_CACHE', '_GOAL_BY_KEY_CACHE'],
            'backend/epm/projects.py': ['build_epm_home_projects_cache_key'],
            'backend/epm/rollup.py': ['cache_key'],
        }
        for path, cache_symbols in cache_sources.items():
            source = Path(path).read_text()
            self.assertIn('jira_home_process_cache_enabled', source, path)
            for symbol in cache_symbols:
                self.assertIn(symbol, source, path)
