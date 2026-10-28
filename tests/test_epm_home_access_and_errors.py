"""Task 3B: config readiness fields, GET /api/epm/access and the OAuth A/H error mapping on the EPM routes.

Real DB OAuth browser sessions on SQLite, synthetic Home replies, no network. Valid-journey tests and
missing-session tests are separate classes.
"""

import io
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from sqlalchemy import update

import jira_server
from backend.auth import db_context
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine
from backend.db import models
from backend.epm import access as epm_access
from backend.epm import home as epm_home
from backend.routes import epm_errors
from backend.security.guards import format_auth_error_response
from tests.auth_mode_test_utils import force_basic_auth_mode
from tests.test_epm_home_oauth_client import FakeHome
from tests.test_epm_home_scope_request import DbJourneyMixin, HOME

EPM_CONFIG = {
    'version': 2, 'labelPrefix': 'portfolio_project_*',
    'scope': {'rootGoalKey': 'ROOT-A', 'subGoalKeys': ['GOAL-B']},
    'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
    'projects': {},
}
NO_ROOT_CONFIG = {**EPM_CONFIG, 'scope': {'rootGoalKey': '', 'subGoalKeys': ['GOAL-B']}}


class AccessCase(DbJourneyMixin, unittest.TestCase):
    def setUp(self):
        self.start()
        from backend.services.user_view_config import save_user_epm_config
        self.save_config = lambda config: save_user_epm_config(self.context, config, database_url=self.database_url)
        self.save_config(EPM_CONFIG)
        epm_access.clear_access_cache()
        epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
        self.addCleanup(epm_access.clear_access_cache)
        self.home = FakeHome()
        for patcher in (patch.object(epm_home, 'urlopen', self.home.urlopen), patch.object(epm_home.time, 'sleep')):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def helper_base_scopes():
        return jira_server.ATLASSIAN_SCOPES.split()

    def grant_all(self):
        self.set_grant(self.helper_base_scopes() + list(HOME))

    def get(self, path, client=None):
        with self.helper._db_route_mode():
            return (client or self.client).get(path)

    def access(self, suffix=''):
        return self.get('/api/epm/access' + suffix)

    def config(self):
        return self.get('/api/config').get_json()

    def operations(self):
        return [operation for operation, _bearer in self.home.calls]


class ConfigReadinessTests(AccessCase):
    def forbid_home(self):
        def forbidden(request, timeout=None):
            raise AssertionError('GET /api/config must not call Home')
        patcher = patch.object(epm_home, 'urlopen', forbidden)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_disabled_user_has_no_readiness_and_no_login_url(self):
        self.forbid_home()
        self.grant_all()
        payload = self.config()
        self.assertIs(payload['epmViewEnabled'], False)
        self.assertIs(payload['epmHomeReadAvailable'], False)
        self.assertNotIn('epmHomeReadLoginUrl', payload)

    def test_enabled_without_scopes_gets_the_same_tab_scope_login_url_only(self):
        self.forbid_home()
        self.enable(True)
        self.set_grant(self.helper_base_scopes())
        payload = self.config()
        self.assertIs(payload['epmHomeReadAvailable'], False)
        self.assertEqual(payload['epmHomeReadLoginUrl'], '/login?reason=missing_scope')
        self.assertEqual(self.home.calls, [])

    def test_enabled_with_a_partial_or_unverified_grant_is_not_available(self):
        self.forbid_home()
        self.enable(True)
        for scopes, provenance in ((self.helper_base_scopes() + list(HOME[:3]), 'provider'),
                                   (self.helper_base_scopes() + list(HOME), 'unknown')):
            self.set_grant(scopes, provenance=provenance)
            with self.subTest(provenance=provenance, scopes=len(scopes)):
                response = self.get('/api/config')
                if response.status_code != 200:
                    # an unverified grant fails the base guard first (existing behavior), never a Home call
                    self.assertEqual(response.status_code, 401)
                    continue
                self.assertIs(response.get_json()['epmHomeReadAvailable'], False)

    def test_enabled_with_every_scope_is_available_without_a_login_url_and_without_home_io(self):
        self.forbid_home()
        self.enable(True)
        self.grant_all()
        payload = self.config()
        self.assertIs(payload['epmHomeReadAvailable'], True)
        self.assertNotIn('epmHomeReadLoginUrl', payload)

    def test_basic_json_config_never_reports_home_read_readiness(self):
        force_basic_auth_mode(self, jira_server)
        client = jira_server.app.test_client()
        payload = client.get('/api/config').get_json()
        self.assertIs(payload['epmViewEnabled'], False)
        self.assertIs(payload['epmHomeReadAvailable'], False)
        self.assertNotIn('epmHomeReadLoginUrl', payload)


class AccessStateTests(AccessCase):
    def test_disabled_user_gets_disabled_and_no_home_traffic(self):
        self.grant_all()
        response = self.access()
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual((body['state'], body['epmHomeReadAvailable']), ('disabled', False))
        self.assertNotIn('loginUrl', body)
        self.assertEqual(self.home.calls, [])

    def test_enabled_without_scopes_is_scope_missing_with_the_login_hint_and_no_home_traffic(self):
        self.enable(True)
        self.set_grant(self.helper_base_scopes())
        body = self.access().get_json()
        self.assertEqual(body['state'], 'scope_missing')
        self.assertEqual(body['loginUrl'], '/login?reason=missing_scope')
        self.assertIs(body['epmHomeReadAvailable'], False)
        self.assertEqual(self.home.calls, [])

    def test_available_with_a_root_goal_is_one_goal_by_key_read_and_the_goal_is_reused_by_the_warm_step(self):
        self.enable(True)
        self.grant_all()
        body = self.access().get_json()
        self.assertEqual((body['state'], body['epmHomeReadAvailable']), ('available', True))
        self.assertNotIn('loginUrl', body)
        self.assertEqual(self.operations(), ['GoalByKey'])
        # the metadata warm resolves the same root goal without a second goal read
        response = self.get('/api/epm/goals?rootGoalKey=ROOT-A')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.operations(), ['GoalByKey', 'SubGoals'])

    def test_without_a_root_goal_the_check_is_one_search_page_of_one(self):
        self.enable(True)
        self.grant_all()
        self.save_config(NO_ROOT_CONFIG)
        seen = []
        original = self.home._op_GoalsSearch
        self.home._op_GoalsSearch = lambda variables: (seen.append(variables), original(variables))[1]
        body = self.access().get_json()
        self.assertEqual(body['state'], 'available')
        self.assertEqual(self.operations(), ['GoalsSearch'])
        self.assertEqual(seen[0]['first'], 1)
        self.assertEqual(seen[0]['containerId'], 'ari:cloud:townsquare::site/' + self.context.cloud_id)

    def test_site_comes_from_the_context_and_never_from_tenant_info(self):
        self.enable(True)
        self.grant_all()
        self.access()
        self.assertEqual(self.operations(), ['GoalByKey'])
        with patch.object(epm_home, '_CLOUD_ID_CACHE', {}) as cloud_cache:
            self.access('?refresh=1')
            self.assertEqual(cloud_cache, {})

    def test_empty_configured_target_is_empty_and_search_without_goals_is_empty(self):
        self.enable(True)
        self.grant_all()
        self.home.unknown_goal = True
        self.assertEqual(self.access().get_json()['state'], 'empty')
        self.save_config(NO_ROOT_CONFIG)
        self.home._op_GoalsSearch = lambda variables: {
            'data': {'goals_search': {'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'edges': []}}}
        body = self.access().get_json()
        self.assertEqual((body['state'], body['epmHomeReadAvailable']), ('empty', True))
        self.assertIn('message', body)

    def test_denied_is_a_200_state_never_a_401_and_is_cached_briefly(self):
        self.enable(True)
        self.grant_all()
        self.home.fail_ops = {'GoalByKey': 'denied'}
        first = self.access()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json()['state'], 'denied')
        self.assertEqual(self.access().get_json()['state'], 'denied')
        self.assertEqual(self.operations(), ['GoalByKey'])  # second answer came from the 30 s decision cache

    def test_transient_failures_are_unavailable_not_denied_and_never_cached(self):
        self.enable(True)
        self.grant_all()
        for failure in (429, 500, 401):
            with self.subTest(failure=failure):
                epm_access.clear_access_cache()
                self.home.fail_ops = {'GoalByKey': failure}
                body = self.access().get_json()
                self.assertEqual((body['state'], body['epmHomeReadAvailable']), ('unavailable', True))
                before = len(self.home.calls)
                self.home.fail_ops = {}
                self.assertEqual(self.access().get_json()['state'], 'available')
                self.assertGreater(len(self.home.calls), before)  # the failure was not cached

    def test_a_raw_home_401_for_a_revoked_connection_is_the_base_401_not_a_state(self):
        self.enable(True)
        self.grant_all()
        self.home.hooks.append(lambda operation, count: self.disable_user())
        self.home.fail_ops = {'GoalByKey': 401}
        response = self.access()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'account_disabled')
        self.assertEqual(response.get_json()['recoveryUrl'], '/auth/account-disabled')

    def test_decision_cache_is_keyed_by_partition_scope_and_config_and_expires_in_thirty_seconds(self):
        self.enable(True)
        self.grant_all()
        self.access()
        self.access()
        self.assertEqual(self.operations(), ['GoalByKey'])
        self.access('?refresh=1')  # explicit refresh rechecks
        self.assertEqual(self.operations(), ['GoalByKey', 'GoalByKey'])
        self.save_config({**EPM_CONFIG, 'scope': {'rootGoalKey': 'ROOT-Z', 'subGoalKeys': ['GOAL-B']}})
        self.access()  # scope change rechecks
        self.assertEqual(self.operations(), ['GoalByKey'] * 3)
        self.save_config(EPM_CONFIG)
        self.access()  # the earlier entry for ROOT-A is still inside its window
        self.assertEqual(len(self.operations()), 3)
        later = SimpleNamespace(time=lambda: time.time() + 31)
        with patch.object(epm_access, 'time', later):
            self.access()
            self.access()
        self.assertEqual(len(self.operations()), 4)
        self.assertEqual(epm_access.ACCESS_DECISION_TTL_SECONDS, 30)
        # another user partition never reads this entry
        self.assertTrue(all(isinstance(key, tuple) and len(key) > 4 for key in epm_access._ACCESS_CACHE))

    def test_status_changes_are_observed_with_the_status_cache_populated_and_a_warm_decision_cache(self):
        self.enable(True)
        self.grant_all()
        self.assertEqual(self.access().get_json()['state'], 'available')  # populates both caches
        self.assertTrue(db_context._STATUS_CACHE)  # the 30 s status cache holds this user as active
        self.disable_user()  # DB row changed without any invalidation call
        response = self.access()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'account_disabled')
        self.assertEqual(self.operations(), ['GoalByKey'])  # the cached decision was never served to a disabled user

    def test_losing_the_home_scopes_with_a_warm_cache_reports_scope_missing_not_a_cached_available(self):
        self.enable(True)
        self.grant_all()
        self.access()
        self.set_grant(self.helper_base_scopes())
        body = self.access().get_json()
        self.assertEqual(body['state'], 'scope_missing')
        self.assertEqual(self.operations(), ['GoalByKey'])

    def disable_user(self):
        with self.helper.factory() as session:
            session.execute(update(models.User).values(status='disabled'))
            session.commit()


class AccessForbiddenPathTests(AccessCase):
    """After a valid browser guard, no API-token, service, TWG or local-token path may be touched."""

    def armed(self):
        from contextlib import ExitStack

        def boom(name):
            def raiser(*_a, **_k):
                raise AssertionError(f'forbidden credential path used: {name}')
            return raiser

        stack = ExitStack()
        for target, name in (
                (epm_home, '_home_basic_credentials'), (epm_home, 'build_teamwork_graph_client'),
                (epm_home, 'build_home_graphql_client'), (epm_home, '_read_metadata_credential'),
                (jira_server, 'oauth_session_data'), (jira_server, 'save_oauth_session'),
                (jira_server, 'oauth_refresh_lock')):
            stack.enter_context(patch.object(target, name, boom(name)))
        self.addCleanup(stack.close)

    def test_access_states_never_touch_a_forbidden_credential_path(self):
        self.enable(True)
        self.grant_all()
        self.armed()
        states = []
        for setup in (lambda: None, lambda: setattr(self.home, 'fail_ops', {'GoalByKey': 'denied'}),
                      lambda: setattr(self.home, 'fail_ops', {'GoalByKey': 500})):
            epm_access.clear_access_cache()
            setup()
            states.append(self.access().get_json()['state'])
        self.set_grant(self.helper_base_scopes())
        states.append(self.access().get_json()['state'])
        self.enable(False)
        states.append(self.access().get_json()['state'])
        self.assertEqual(states, ['available', 'denied', 'unavailable', 'scope_missing', 'disabled'])
        self.assertEqual(self.get('/api/config').status_code, 200)


class AccessBasicAndSessionTests(unittest.TestCase):
    def test_basic_mode_returns_the_compatible_available_state_without_home_io(self):
        force_basic_auth_mode(self, jira_server)
        client = jira_server.app.test_client()

        def forbidden(request, timeout=None):
            raise AssertionError('Basic access check must not do Home I/O')

        with patch.object(epm_home, 'urlopen', forbidden):
            response = client.get('/api/epm/access')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'state': 'available', 'epmHomeReadAvailable': False})


class AccessMissingSessionTests(DbJourneyMixin, unittest.TestCase):
    def test_no_browser_session_gets_the_existing_guard_401_with_a_login_url(self):
        self.start(signed_in=False)
        with self.helper._db_route_mode():
            response = self.client.get('/api/epm/access')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertIn('loginUrl', response.get_json())


class ErrorMappingUnitTests(unittest.TestCase):
    def setUp(self):
        self.ctx = jira_server.app.test_request_context('/api/epm/goals')
        self.ctx.push()
        self.addCleanup(self.ctx.pop)

    def body(self, result):
        response, status = result
        return status, response.get_json(), response.headers

    def test_home_categories_map_to_the_exact_codes_and_statuses(self):
        server = jira_server
        expected = {
            'access_denied': (403, 'home_access_denied'),
            'graphql_error': (502, 'home_read_failed'),
            'invalid_response': (502, 'home_read_failed'),
            'http_error': (502, 'home_read_failed'),
            'network': (502, 'home_read_failed'),
            'invalid_target': (502, 'home_read_failed'),
            'invalid_credential': (502, 'home_read_failed'),
            'unregistered_operation': (502, 'home_read_failed'),
            'rate_limited': (503, 'home_rate_limited'),
        }
        for category, (status, code) in expected.items():
            with self.subTest(category=category):
                got_status, payload, _headers = self.body(
                    epm_errors.home_read_error_to_response(server, epm_home.HomeReadError(category, retry_after=5)))
                self.assertEqual((got_status, payload['error']), (status, code))
                self.assertNotIn('loginUrl', payload)
                self.assertNotIn('recoveryUrl', payload)

    def test_retry_after_is_clamped_to_one_through_thirty_seconds(self):
        for raw, wanted in ((None, 1), (0, 1), (-5, 1), (7, 7), (30, 30), (999, 30), ('x', 1)):
            with self.subTest(raw=raw):
                status, payload, headers = self.body(epm_errors.home_read_error_to_response(
                    jira_server, epm_home.HomeReadError('rate_limited', retry_after=raw)))
                self.assertEqual(status, 503)
                self.assertEqual(headers['Retry-After'], str(wanted))
                self.assertEqual(payload['retryAfterSeconds'], wanted)

    def test_raw_provider_401_without_proven_loss_is_a_502_and_with_proven_loss_the_base_401(self):
        class Snapshot:
            def __init__(self, error=None):
                self.error, self.calls = error, 0

            def recheck_after_rejection(self):
                self.calls += 1
                if self.error:
                    raise self.error

        snapshot = Snapshot()
        status, payload, _ = self.body(epm_errors.home_read_error_to_response(
            jira_server, epm_home.HomeReadError('auth_rejected', status=401), snapshot))
        self.assertEqual((status, payload['error'], snapshot.calls), (502, 'home_read_failed', 1))
        for code, expected_status, expected_error in (
                ('account_disabled', 401, 'account_disabled'), ('auth_connection_revoked', 401, 'auth_connection_revoked'),
                ('auth_required', 401, 'auth_required'), ('epm_scope_required', 409, 'epm_scope_required')):
            with self.subTest(code=code):
                status, payload, _ = self.body(epm_errors.home_read_error_to_response(
                    jira_server, epm_home.HomeReadError('auth_rejected', status=401), Snapshot(AuthError(code, 'x'))))
                self.assertEqual((status, payload['error']), (expected_status, expected_error))

    def test_scope_absence_is_a_feature_409_and_everything_else_keeps_the_guard_variants(self):
        status, payload, _ = self.body(epm_errors.auth_error_to_response(jira_server, AuthError('epm_scope_required', 'x')))
        self.assertEqual((status, payload['error'], payload['loginUrl']), (409, 'epm_scope_required', '/login?reason=missing_scope'))
        for code in ('auth_required', 'account_disabled', 'auth_connection_revoked', 'auth_connection_stale',
                     'missing_project_access', 'missing_oauth_scope'):
            with self.subTest(code=code):
                mapped = self.body(epm_errors.auth_error_to_response(jira_server, AuthError(code, 'm')))
                guard = format_auth_error_response(jira_server, AuthError(code, 'm'))
                self.assertEqual(mapped[0], guard[1])
                self.assertEqual(mapped[1], guard[0].get_json())

    def test_no_provider_text_or_secret_reaches_any_body(self):
        error = epm_home.HomeReadError('graphql_error', status=200, provider_classification='SECRET-CLASS')
        payload = self.body(epm_errors.home_read_error_to_response(jira_server, error))[1]
        self.assertNotIn('SECRET-CLASS', json.dumps(payload))


class RouteMappingTests(AccessCase):
    """The enumerated Home failure kinds on every OAuth Home route, through the real guard and DB session."""

    def setUp(self):
        super().setUp()
        self.enable(True)
        self.grant_all()
        epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
        for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
            cache.clear()
        self.addCleanup(lambda: [c.clear() for c in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE,
                                                     jira_server.EPM_ROLLUP_CACHE)])
        self.save_config({**EPM_CONFIG, 'projects': {
            'custom-1': {'id': 'custom-1', 'name': 'Custom', 'label': 'custom_label'}}})

    ROUTES = (
        '/api/epm/goals',
        '/api/epm/goals?rootGoalKey=ROOT-A',
        '/api/epm/projects?tab=active',
        '/api/epm/projects/rollup/all?tab=active&sprint=42',
    )

    def test_each_failure_kind_has_the_exact_status_and_code_on_every_home_route(self):
        kinds = (
            (403, 403, 'home_access_denied'), ('denied', 403, 'home_access_denied'),
            (401, 502, 'home_read_failed'), (500, 502, 'home_read_failed'),
            (429, 503, 'home_rate_limited'),
        )
        for path in self.ROUTES:
            for failure, status, code in kinds:
                with self.subTest(path=path, failure=failure):
                    self.home.fail_ops = {}
                    self.home.fail_with = failure if isinstance(failure, int) else None
                    self.home.fail_ops = {} if isinstance(failure, int) else {'GoalByKey': failure, 'GoalsSearch': failure}
                    epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
                    response = self.get(path)
                    body = response.get_json()
                    self.assertEqual((response.status_code, body['error']), (status, code), body)
                    self.assertNotEqual(response.status_code, 401)  # never a terminal lock for a resource failure
                    self.assertNotIn('goals', body)
                    self.assertNotIn('projects', body)
                    self.assertNotIn('loginUrl', body)
                    if status == 503:
                        self.assertTrue(1 <= int(response.headers['Retry-After']) <= 30)
                    self.assertEqual(sum(len(c) for c in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ROLLUP_CACHE)), 0)

    def test_a_provider_401_after_the_connection_was_revoked_is_the_base_401(self):
        self.home.fail_with = 401
        self.home.hooks.append(lambda operation, count: self.disable_user())
        response = self.get('/api/epm/goals')
        self.assertEqual((response.status_code, response.get_json()['error']), (401, 'account_disabled'))

    def test_a_malformed_reply_or_network_error_is_a_502_not_an_empty_200(self):
        original = self.home.urlopen

        def broken(request, timeout=None):
            raise OSError('boom')

        with patch.object(epm_home, 'urlopen', broken):
            for path in self.ROUTES:
                with self.subTest(path=path):
                    response = self.get(path)
                    self.assertEqual((response.status_code, response.get_json()['error']), (502, 'home_read_failed'))
        self.assertTrue(callable(original))

    def test_scope_route_empty_cloud_id_is_a_502_and_the_goals_route_keeps_the_success_envelope(self):
        self.assertEqual(self.get('/api/epm/goals').get_json(), {'goals': [{'id': 'goal-sub-1', 'key': 'SUB-1', 'name': 'Sub One',
                                                                          'url': 'https://example.invalid/g'}], 'error': ''})
        with self.helper.factory() as session:
            session.execute(update(models.AuthConnection).values(cloud_id=''))
            session.commit()
        # a context with no cloud id fails the existing base checks; the scope route never invents a site
        response = self.get('/api/epm/scope')
        self.assertIn(response.status_code, (401, 502))
        self.assertNotEqual(response.status_code, 200)

    def test_enabled_without_scopes_is_409_on_home_routes_and_never_reaches_home(self):
        self.set_grant(self.helper_base_scopes())
        for path in self.ROUTES:
            with self.subTest(path=path):
                response = self.get(path)
                self.assertEqual((response.status_code, response.get_json()['error']), (409, 'epm_scope_required'))
                self.assertEqual(response.get_json()['loginUrl'], '/login?reason=missing_scope')
        self.assertEqual(self.home.calls, [])

    def test_direct_custom_row_is_o_only_for_disabled_and_scope_missing_users(self):
        jira_calls = []

        def search(payload, **kwargs):
            jira_calls.append(payload['jql'])

            class Response:
                status_code = 200
                headers = {}
                def json(self):
                    return {'issues': [], 'isLast': True}
            return Response()

        for state in ('disabled', 'scope_missing'):
            with self.subTest(state=state):
                self.enable(state == 'scope_missing')
                self.set_grant(self.helper_base_scopes())
                with patch.object(jira_server, 'jira_search_request', search), \
                        patch.object(jira_server, 'resolve_epic_link_field_id', lambda *a, **k: None):
                    response = self.get('/api/epm/projects/custom-1/rollup?tab=archived')
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                self.assertEqual(self.home.calls, [])
        self.assertTrue(jira_calls)

    def disable_user(self):
        with self.helper.factory() as session:
            session.execute(update(models.User).values(status='disabled'))
            session.commit()


class ViewReferenceValidationTests(AccessCase):
    """Private-view Home-reference validation: enabled/scoped users use the explicit snapshot, disabled users keep today's path."""

    VIEW = {
        'name': 'Home reference', 'viewType': 'epm',
        'view': {'epm': {
            'version': 2, 'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': '', 'subGoalKeys': ['SUB-1']},
            'issueTypes': {'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': ['Story']},
            'projects': {'project-0': {'id': 'project-0', 'homeProjectId': 'project-0', 'name': 'P0', 'label': 'rnd_project_p0'}},
        }},
    }

    def post_view(self):
        with self.helper._db_route_mode():
            csrf = self.client.get('/api/auth/csrf').get_json()['csrfToken']
            return self.client.post('/api/me/views', json=self.VIEW,
                                    headers={'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': csrf})

    def test_enabled_scoped_user_validates_through_the_oauth_snapshot(self):
        self.enable(True)
        self.grant_all()
        response = self.post_view()
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertTrue(self.home.calls)
        self.assertTrue(all(bearer.startswith('Bearer ') for _op, bearer in self.home.calls))

    def test_enabled_user_without_scopes_gets_the_409_feature_error_and_no_home_call(self):
        self.enable(True)
        self.set_grant(self.helper_base_scopes())
        response = self.post_view()
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'epm_scope_required'))
        self.assertEqual(self.home.calls, [])

    def test_home_failures_while_validating_are_typed_not_a_reference_error(self):
        self.enable(True)
        self.grant_all()
        for failure, status, code in ((403, 403, 'home_access_denied'), (500, 502, 'home_read_failed'),
                                      (429, 503, 'home_rate_limited')):
            with self.subTest(failure=failure):
                self.home.fail_with = failure
                response = self.post_view()
                self.assertEqual((response.status_code, response.get_json()['error']), (status, code))

    def test_a_disabled_user_keeps_todays_validation_path(self):
        self.grant_all()
        seen = {}

        def legacy(scope, context=None, home_auth=None):
            seen.update(context=context, home_auth=home_auth)
            return [{'homeProjectId': 'project-0', 'id': 'project-0', 'name': 'P0'}]

        with patch.object(jira_server, 'fetch_epm_home_projects', legacy):
            response = self.post_view()
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertIsNotNone(seen['context'])
        self.assertIsNone(seen['home_auth'])
        self.assertEqual(self.home.calls, [])


if __name__ == '__main__':
    unittest.main()
