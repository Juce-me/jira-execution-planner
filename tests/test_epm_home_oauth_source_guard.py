"""Task 2 source and behavior guards for the public-read-v1 Home path.

Strict reads must never reach a Basic/API-token/service credential, the Teamwork Graph, a local OAuth token
store, a Home mutation, a tenant-discovery request, or a Flask proxy inside a worker. The behavior test runs the
oracle's OAuth candidate through every EPM read route with the forbidden symbols patched to raise.
"""

import ast
import inspect
import re
import unittest
from pathlib import Path
from unittest.mock import patch

import jira_server
from backend.auth import db_context
from backend.epm import aggregate, home, issues, projects, rollup

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_IN_STRICT = (
    '_home_basic_credentials', 'build_teamwork_graph_client', 'build_home_graphql_client', '_read_metadata_credential',
    'atlassian_user_api_token', 'oauth_session_data', 'save_oauth_session',
    'oauth_refresh_lock', 'OAUTH_TOKEN_STORE', '_LOCAL_OAUTH_STORE', 'HOME_PROJECT_UPDATE_MUTATION',
    'WRITE_AS_USER', 'tenant_info', '_CLOUD_ID_CACHE', 'current_app', 'flask',
)


def names_in(obj):
    """Identifier and attribute names plus string constants used by a function or class, excluding docstrings."""
    tree = ast.parse(inspect.getsource(obj).strip() if not inspect.isclass(obj) else inspect.getsource(obj))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) < 80:
            names.add(node.value)
    return names


class StrictSourceGuardTests(unittest.TestCase):
    STRICT_UNITS = (
        home.HomeReadAuth, home.LeasedHomeOAuthClient, home.HomeOAuthGraphQLClient, home._fetch_goal_project_links_strict,
        home._fetch_project_tags_strict, home._strict_goal_lookup_get, home._strict_goal_lookup_put,
        home.select_epm_home_read_profile, jira_server.resolve_epm_home_read_auth, jira_server.memoize_epm_guard_context,
        db_context.revalidate_db_request_auth_context,
    )

    def test_strict_units_never_name_a_forbidden_credential_store_write_or_proxy(self):
        for unit in self.STRICT_UNITS:
            names = names_in(unit)
            for forbidden in FORBIDDEN_IN_STRICT:
                with self.subTest(unit=getattr(unit, '__qualname__', unit), forbidden=forbidden):
                    self.assertNotIn(forbidden, names)

    def test_direct_revalidation_bypasses_the_status_cache_and_does_not_catch_database_errors(self):
        names = names_in(db_context.revalidate_db_request_auth_context)
        for forbidden in ('_STATUS_CACHE', '_status_for', 'OperationalError', 'resolve_db_request_auth_context'):
            self.assertNotIn(forbidden, names)
        tree = ast.parse(inspect.getsource(db_context.revalidate_db_request_auth_context))
        self.assertEqual([n for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler)], [])

    def test_the_lease_is_five_seconds_and_the_goal_cache_is_bounded(self):
        self.assertEqual(home.HOME_AUTH_LEASE_SECONDS, 5)
        self.assertEqual((home.GOAL_LOOKUP_CACHE_MAX_ENTRIES, home.GOAL_LOOKUP_CACHE_TTL_SECONDS), (512, 300))

    def test_the_epm_orchestration_modules_never_touch_flask_state(self):
        # Workers receive captured objects; none of these modules may read request-bound proxies.
        for module in (aggregate, projects, rollup, issues):
            source = inspect.getsource(module)
            with self.subTest(module=module.__name__):
                self.assertIsNone(re.search(r'\bfrom flask\b|\bimport flask\b|\bg\.|has_request_context|current_app', source))

    def test_the_new_home_code_has_no_write_scope_or_mutation_selection(self):
        for name in ('HomeReadAuth', 'LeasedHomeOAuthClient'):
            source = inspect.getsource(getattr(home, name))
            self.assertNotIn('mutation', source.lower())
            self.assertIsNone(re.search(r'write:|manage:|delete:', source))
        self.assertTrue(all(scope.startswith('read:') for scope in home.EPM_HOME_READ_SCOPES))

    def test_the_epm_blueprint_memoizes_the_guard_context_after_binding_globals(self):
        source = (ROOT / 'backend' / 'routes' / 'epm_routes.py').read_text()
        self.assertLess(source.index('def _sync_server_globals'), source.index('def _memoize_epm_guard_context'))
        self.assertIn('memoize_epm_guard_context()', source)

    def test_epm_routes_never_call_the_uncached_context_resolver_directly(self):
        source = (ROOT / 'backend' / 'routes' / 'epm_routes.py').read_text()
        self.assertNotIn('current_request_auth_context()', source)

    def test_no_epm_module_writes_to_home(self):
        for module in (home, projects, rollup, issues, aggregate):
            for name, obj in vars(module).items():
                if inspect.isfunction(obj) and obj.__module__ == module.__name__ and name.startswith('build_epm_'):
                    self.assertNotIn('HOME_PROJECT_UPDATE_MUTATION', inspect.getsource(obj), name)


class ForbiddenPathBehaviorTests(unittest.TestCase):
    """Strict reads, after a valid browser guard, never reach a forbidden credential or token-store function."""

    @classmethod
    def setUpClass(cls):
        from tests import test_epm_home_oauth_parity as parity
        cls.parity = parity
        cls.fixture = parity.load_fixture()

    def boom(self, name):
        def raiser(*_args, **_kwargs):
            raise AssertionError(f'forbidden call in a strict public-read path: {name}')
        return raiser

    def armed_runner_class(self, patches):
        """The OAuth candidate whose forbidden patches are armed only AFTER its sign-in setup (setup is not an EPM read)."""
        parity = self.parity

        class Armed(parity.DbOAuthPublicReadRunner):
            def enter(runner, stack, fixture, transports):
                super().enter(stack, fixture, transports)
                for target, name in patches:
                    stack.enter_context(patch.object(target, name, self.boom(f'{target.__name__}.{name}')))
                for method in ('session_data', 'session_data_for_id', 'save_session', 'save_session_for_id',
                               'refresh_lock', 'refresh_lock_for_id', 'existing_refresh_lock'):
                    if hasattr(jira_server._LOCAL_OAUTH_STORE, method):
                        stack.enter_context(patch.object(
                            jira_server._LOCAL_OAUTH_STORE, method, self.boom(f'_LOCAL_OAUTH_STORE.{method}')))

        return Armed

    def test_every_epm_read_route_runs_with_all_forbidden_paths_patched_to_raise(self):
        patches = (
            (home, '_home_basic_credentials'), (home, 'build_teamwork_graph_client'),
            (home, 'build_home_graphql_client'), (home, '_read_metadata_credential'),
            (jira_server, 'oauth_session_data'), (jira_server, 'save_oauth_session'),
            (jira_server, 'oauth_refresh_lock'), (jira_server, 'save_oauth_session_for_auth_context'),
            (jira_server, 'oauth_refresh_lock_for_auth_context'),
        )
        with patch.dict(self.parity.MODE_FACTORIES, {'armed': self.armed_runner_class(patches)}):
            run = self.parity.run_mode('armed', self.fixture)
        outcome = self.parity.compare_run(
            self.parity.assemble_expected(self.fixture, 'db_user_token'), run,
            self.fixture['comparison'], self.parity.compare_candidate)
        self.assertEqual(set(outcome), {s['name'] for s in self.fixture['scenarios']})
        for name, mismatches in outcome.items():
            with self.subTest(scenario=name):
                self.assertEqual(mismatches[:6], [])
                self.assertEqual(run.results[name]['unexpected'], [])
        self.assertEqual(run.home_emails, set())
        for name, result in run.results.items():
            for step in result['steps']:
                for operation, _key in step['home']['calls']:
                    self.assertNotEqual(operation, 'tenant_info', name)


if __name__ == '__main__':
    unittest.main()
