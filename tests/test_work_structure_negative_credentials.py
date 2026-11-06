"""Negative credential/mutation gates for the quarterly work configuration (plan Task 6C).

In DB/OAuth mode the feature paths (config, Test, catalogs, stats, Last N, Scenario seam) read Jira only
through the signed-in user's captured DB context.  Every local/service/Basic/Home fallback symbol is a
trap that records and raises, any non-read Jira method fails, and the legitimate OAuth read stays real
(it is wrapped to prove it carries a DB context, never replaced by a fake that hides a fallback).
"""
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.auth import project_access
from backend.auth import service_integrations
from backend.auth.db_context import is_db_auth_context
from backend.auth.jira_auth import AuthError
from backend.epm import home as epm_home
from tests.test_work_reader_routes import FakeSearch
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response
from tests.test_work_structure_stats import DELIVERY_SELECTORS, LEGACY_SELECTORS, closed_row, leaf_row

READ_METHODS = {'GET', 'HEAD'}


class NegativeCredentialBase(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        self.trapped = []
        self.authorized_reads = []
        self.non_read = []

        def trap(name):
            def tripped(*args, **kwargs):
                self.trapped.append(name)
                raise AssertionError(f'fallback used: {name}')
            return tripped

        for target in ('save_oauth_session', 'oauth_session_data', 'build_jira_headers'):
            self.stack.enter_context(patch.object(jira_server, target, side_effect=trap(target)))
        self.assertFalse(hasattr(epm_home, 'HomeGraphQLClient'))
        self.assertFalse(hasattr(jira_server, 'oauth_refresh_lock'))
        # Service-provider symbols (service-account credentials and their project-access scoping).
        for target in ('seed_service_integration', 'get_service_integration_summary',
                       'list_service_integration_summaries'):
            self.stack.enter_context(patch.object(service_integrations, target, side_effect=trap(target)))

        real_get = jira_server.current_jira_get

        def authorized_get(path, *, params=None, timeout=30, context=None, diagnostic_transport=None):
            # The legitimate read: it must resolve to the signed-in user's DB context, never a fallback.
            auth = jira_server.current_jira_auth_context(context)
            if not is_db_auth_context(auth):
                self.trapped.append('non-db read context')
                raise AssertionError('Jira read without a DB auth context')
            self.authorized_reads.append(path)
            return self.read_response(path)

        def guarded_request(method, path, **kwargs):
            if str(method).upper() not in READ_METHODS:
                self.non_read.append((method, path))
                raise AssertionError(f'non-read Jira method {method} {path}')
            return authorized_get(path, params=kwargs.get('params'), context=kwargs.get('context'))

        self.real_get = real_get
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', side_effect=authorized_get))
        self.stack.enter_context(patch.object(jira_server, 'current_jira_request', side_effect=guarded_request))
        self.search = FakeSearch(
            (r'issuetype = 10002 AND parent is not EMPTY', [leaf_row('PLAN-11', 'PLAN-1')]),
            (r'resolutiondate is not EMPTY', [closed_row('PLAN-1', '2027-02-01'), closed_row('OLD-1', '2026-03-01')]))
        self.stack.enter_context(patch.object(jira_server, 'jira_search_request', side_effect=self.search))
        self.stack.enter_context(patch.object(jira_server, 'jira_home_process_cache_enabled', return_value=False))

    def read_response(self, path):
        if path.endswith('/myself'):
            return jira_response(200, {'displayName': 'Tester'})
        if '/issuetype' in path:
            return jira_response(200, [])
        return jira_response(200, {})

    def get(self, path):
        return self.client.get(path)

    def post(self, path, body):
        return self.client.post(path, json=body, headers=self.headers())

    def assert_clean(self):
        self.assertEqual(self.trapped, [])
        self.assertEqual(self.non_read, [])
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()


class FeatureRoutesNeverFallBackTests(NegativeCredentialBase):
    def test_config_test_and_work_reads_use_only_the_captured_db_context(self):
        self.get('/api/work-structure/config')
        test = self.get('/api/test?configurationId=delivery&configurationRevision=1')
        self.assertEqual(test.status_code, 200, test.get_data(as_text=True))
        self.get('/api/test')
        self.assertIn('/rest/api/3/myself', self.authorized_reads)  # the legitimate OAuth read is retained
        for path in ('/api/tasks?quarter=2027Q1', '/api/tasks?quarter=2026Q4', '/api/stats?sprint=2027Q1',
                     '/api/stats?sprint=2026Q4', '/api/stats/burnout?sprint=2027Q1'):
            self.get(path)
        self.assert_clean()

    def test_last_n_and_cohort_ranges_never_fall_back_and_never_mutate(self):
        for selectors in (LEGACY_SELECTORS, DELIVERY_SELECTORS):
            response = self.post('/api/stats/epic-cohort', {'mode': 'last_n', 'components': ['A'], **selectors})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(self.search.calls)
        self.assert_clean()

    def test_rejected_selectors_never_reach_a_credential_path(self):
        for path in ('/api/stats?sprint=Sprint%2012', '/api/tasks', '/api/tasks?quarter=2027q1'):
            self.assertIn(self.get(path).status_code, (400, 409))
        for body in ({'mode': 'last_n', 'components': ['A']},):
            self.assertEqual(self.post('/api/stats/epic-cohort', body).status_code, 409)
        self.assertEqual(self.search.calls, [])
        self.assert_clean()

    def test_track_phase_and_excluded_source_keep_reads_on_the_captured_context(self):
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        response = self.post('/api/stats/project-track-phase-durations',
                             {'epicKeys': ['OLD-1'], **LEGACY_SELECTORS})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(any('/rest/api/3/issue/OLD-1' in path for path in self.authorized_reads))
        self.assert_clean()

    def test_expired_sign_in_on_test_does_not_touch_the_local_session_store(self):
        def expired(*args, **kwargs):
            raise AuthError('auth_required', 'Atlassian authentication is required.')
        with patch.object(jira_server, 'current_jira_get', side_effect=expired):
            response = self.get('/api/test?configurationId=delivery&configurationRevision=1')
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(self.trapped, [], 'Test cleared the local OAuth session store in DB/OAuth mode')


class NonReadJiraMethodsAreRejectedTests(NegativeCredentialBase):
    def test_instrumented_request_fails_every_non_read_method(self):
        for method in ('POST', 'PUT', 'DELETE', 'PATCH'):
            with self.assertRaises(AssertionError):
                jira_server.current_jira_request(method, '/rest/api/3/issue/PLAN-1', json_body={})
        self.assertEqual(len(self.non_read), 4)
        self.non_read.clear()


class FallbackSymbolsAreRealTests(unittest.TestCase):
    """Guard the guard: every trapped symbol still exists, so a rename cannot silently disarm the gate."""

    def test_trapped_symbols_exist(self):
        for name in ('save_oauth_session', 'oauth_session_data', 'build_jira_headers',
                     'current_jira_request', 'current_jira_get', 'current_jira_search'):
            self.assertTrue(callable(getattr(jira_server, name)), name)
        self.assertFalse(hasattr(epm_home, 'HomeGraphQLClient'))
        self.assertFalse(hasattr(jira_server, 'oauth_refresh_lock'))
        for name in ('seed_service_integration', 'get_service_integration_summary',
                     'list_service_integration_summaries'):
            self.assertTrue(callable(getattr(service_integrations, name)), name)
        self.assertTrue(callable(project_access.project_access_denied_response))


if __name__ == '__main__':
    unittest.main()
