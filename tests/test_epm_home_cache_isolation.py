import threading
import unittest

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.epm import home as epm_home
from backend.epm.projects import EpmProjectsDependencies, build_epm_home_projects_state


def oauth_context(user_id='user-1', connection_id='connection-1', token_version='1'):
    return RequestAuthContext(
        auth_mode='atlassian_oauth',
        user_id=user_id,
        stable_subject=f'subject-{user_id}',
        atlassian_account_id=f'account-{user_id}',
        workspace_id='workspace-1',
        auth_connection_id=connection_id,
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version=token_version,
        account_status='active',
        is_admin=False,
    )


def project_deps(context, cache, fetcher):
    return EpmProjectsDependencies(
        fetch_epm_home_projects=fetcher,
        merge_epm_linkage=lambda home_project, row: ({}, 'metadata-only'),
        normalize_epm_config=lambda payload: payload,
        utc_now_iso=lambda timespec=None: 'fresh',
        cache=cache,
        cache_lock=threading.Lock(),
        cache_ttl_seconds=300,
        home_project_limit=500,
        now=lambda: 1001,
        context=context,
    )


class FakeGoalClient:
    def __init__(self, goal):
        self.goal = goal
        self.execute_calls = 0

    def execute(self, _query, _variables):
        self.execute_calls += 1
        return {'data': {'goals_byKey': self.goal}}


class EpmHomeCacheIsolationTests(unittest.TestCase):
    def setUp(self):
        epm_home._GOAL_BY_KEY_CACHE.clear()

    def tearDown(self):
        epm_home._GOAL_BY_KEY_CACHE.clear()

    def test_user_home_project_visibility_does_not_share_cached_projects(self):
        cache = {}
        scope = {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}
        user_a_calls = []
        user_b_calls = []

        state_a = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(user_id='user-a', connection_id='connection-a'),
                cache,
                lambda _scope: user_a_calls.append('fetch') or [{'homeProjectId': 'project-a'}],
            ),
        )
        state_b = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(user_id='user-b', connection_id='connection-b'),
                cache,
                lambda _scope: user_b_calls.append('fetch') or [{'homeProjectId': 'project-b'}],
            ),
        )

        self.assertFalse(state_a['cacheHit'])
        self.assertFalse(state_b['cacheHit'])
        self.assertEqual(state_a['homeProjects'], [{'homeProjectId': 'project-a'}])
        self.assertEqual(state_b['homeProjects'], [{'homeProjectId': 'project-b'}])
        self.assertEqual(user_a_calls, ['fetch'])
        self.assertEqual(user_b_calls, ['fetch'])
        self.assertEqual(cache, {})

    def test_token_update_refetches_home_project_metadata(self):
        cache = {}
        scope = {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}
        calls = []

        first_state = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(token_version='1'),
                cache,
                lambda _scope: calls.append('v1') or [{'homeProjectId': 'before-update'}],
            ),
        )
        second_state = build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(token_version='2'),
                cache,
                lambda _scope: calls.append('v2') or [{'homeProjectId': 'after-update'}],
            ),
        )

        self.assertEqual(first_state['homeProjects'], [{'homeProjectId': 'before-update'}])
        self.assertEqual(second_state['homeProjects'], [{'homeProjectId': 'after-update'}])
        self.assertEqual(calls, ['v1', 'v2'])
        self.assertEqual(cache, {})

    def test_revoked_token_does_not_return_stale_home_projects(self):
        cache = {}
        scope = {'rootGoalKey': 'ROOT', 'subGoalKeys': ['GOAL']}

        build_epm_home_projects_state(
            scope,
            project_deps(
                oauth_context(token_version='1'),
                cache,
                lambda _scope: [{'homeProjectId': 'still-visible-before-revoke'}],
            ),
        )

        with self.assertRaises(AuthError) as raised:
            build_epm_home_projects_state(
                scope,
                project_deps(
                    oauth_context(token_version='2'),
                    cache,
                    lambda _scope: (_ for _ in ()).throw(
                        AuthError('home_user_token_required', 'Connect your Atlassian API token to load EPM Home projects.')
                    ),
                ),
            )

        self.assertEqual(raised.exception.code, 'home_user_token_required')
        self.assertEqual(cache, {})

    def test_goal_lookup_bypasses_process_cache_for_oauth_context(self):
        container_id = 'ari:cloud:townsquare::site/cloud-1'
        cache_key = epm_home._goal_cache_key(container_id, 'ROOT-100')
        epm_home._GOAL_BY_KEY_CACHE[cache_key] = {
            'id': 'cached-goal',
            'key': 'ROOT-100',
            'name': 'Cached for another user',
        }
        client = FakeGoalClient({
            'id': 'fresh-goal',
            'key': 'ROOT-100',
            'name': 'Fresh for current user',
        })

        goal = epm_home.resolve_goal_by_key(
            client,
            'ROOT-100',
            container_id,
            context=oauth_context(),
        )

        self.assertEqual(goal['id'], 'fresh-goal')
        self.assertEqual(client.execute_calls, 1)
        self.assertEqual(epm_home._GOAL_BY_KEY_CACHE[cache_key]['id'], 'cached-goal')


if __name__ == '__main__':
    unittest.main()
