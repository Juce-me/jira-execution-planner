"""Task 3B item 6: the EPM-only strict Jira page adapter, worker cancellation and cache admission.

Synthetic data, no network. The shared iterator's partial-result behavior is pinned as unchanged.
"""

import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import update

import jira_server
from backend import jira_client
from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.db import models
from backend.epm import aggregate as epm_aggregate
from backend.epm import jira_strict
from backend.epm import rollup as epm_rollup
from backend.epm.jira_strict import (
    EpmRequestCancelled, JiraReadError, RequestCancellation, clamp_retry_after, raise_for_jira_status,
    strict_search_request,
)
from tests.auth_mode_test_utils import force_basic_auth_mode
from tests.test_epm_home_access_and_errors import AccessCase, EPM_CONFIG


class FakeJiraResponse:
    def __init__(self, status_code=200, payload=None, headers=None, bad_json=False):
        self.status_code, self._payload, self.headers, self._bad_json = status_code, payload, headers or {}, bad_json

    def json(self):
        if self._bad_json:
            raise ValueError('not json')
        return self._payload


def issue(key, issue_type='Story', parent=None):
    fields = {'summary': key, 'status': {'name': 'To Do'}, 'issuetype': {'name': issue_type}, 'labels': ['custom_label']}
    if parent:
        fields['parent'] = {'key': parent, 'fields': {'summary': parent, 'issuetype': {'name': 'Epic'}}}
    return {'id': key, 'key': key, 'fields': fields}


class AdapterUnitTests(unittest.TestCase):
    def adapter(self, *responses, cancellation=None):
        queue = list(responses)
        calls = []

        def search(payload, *, context=None, **kwargs):
            calls.append(payload)
            item = queue.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        return strict_search_request(search, cancellation), calls

    def test_status_mapping_is_exact(self):
        cases = {
            403: ('jira_access_denied', None), 404: ('jira_read_failed', None), 500: ('jira_read_failed', None),
            502: ('jira_read_failed', None), 400: ('jira_read_failed', None),
        }
        for status, (category, _x) in cases.items():
            with self.subTest(status=status), self.assertRaises(JiraReadError) as raised:
                raise_for_jira_status(FakeJiraResponse(status))
            self.assertEqual(raised.exception.category, category)
        with self.assertRaises(AuthError) as auth:
            raise_for_jira_status(FakeJiraResponse(401))
        self.assertEqual(auth.exception.code, 'auth_required')  # a Jira 401 is base auth loss
        with self.assertRaises(JiraReadError) as limited:
            raise_for_jira_status(FakeJiraResponse(429, headers={'Retry-After': '999'}))
        self.assertEqual((limited.exception.category, limited.exception.retry_after), ('jira_rate_limited', 30))
        for raw, wanted in ((None, 30), ('0', 1), ('-3', 1), ('4', 4), ('junk', 30), ('1e9', 30)):
            self.assertEqual(clamp_retry_after(raw), wanted, raw)

    def test_every_page_is_checked_and_a_later_page_failure_discards_the_partial_list(self):
        page_one = FakeJiraResponse(200, {'issues': [issue('A-1')], 'nextPageToken': 'p2', 'isLast': False})
        for failing in (FakeJiraResponse(500), FakeJiraResponse(403), FakeJiraResponse(429), FakeJiraResponse(401),
                        FakeJiraResponse(200, bad_json=True), OSError('reset')):
            with self.subTest(failing=getattr(failing, 'status_code', 'oserror')):
                request, calls = self.adapter(page_one, failing)
                with self.assertRaises((JiraReadError, AuthError)):
                    jira_client.fetch_issues_by_jql('project = X', ['summary'], search_request=request, max_results=500)
                self.assertEqual(len(calls), 2)

    def test_complete_pagination_is_unchanged_and_uses_next_page_token(self):
        request, calls = self.adapter(
            FakeJiraResponse(200, {'issues': [issue('A-1')], 'nextPageToken': 'p2', 'isLast': False}),
            FakeJiraResponse(200, {'issues': [issue('A-2')], 'isLast': True}),
        )
        issues = jira_client.fetch_issues_by_jql('project = X', ['summary'], search_request=request)
        self.assertEqual([i['key'] for i in issues], ['A-1', 'A-2'])
        self.assertEqual(calls[1]['nextPageToken'], 'p2')

    def test_the_shared_iterator_still_returns_partial_results_for_every_other_caller(self):
        responses = [FakeJiraResponse(200, {'issues': [issue('A-1')], 'nextPageToken': 'p2', 'isLast': False}),
                     FakeJiraResponse(500)]
        issues = jira_client.fetch_issues_by_jql(
            'project = X', ['summary'], search_request=lambda payload, context=None: responses.pop(0))
        self.assertEqual([i['key'] for i in issues], ['A-1'])  # Scenario behavior: pinned, not changed

    def test_cancellation_is_checked_before_each_page(self):
        cancellation = RequestCancellation()
        request, calls = self.adapter(
            FakeJiraResponse(200, {'issues': [issue('A-1')], 'nextPageToken': 'p2', 'isLast': False}),
            FakeJiraResponse(200, {'issues': [], 'isLast': True}), cancellation=cancellation)
        original = request

        def cancel_after_first(payload, *, context=None, **kw):
            response = original(payload, context=context)
            cancellation.cancel()
            return response

        with self.assertRaises(EpmRequestCancelled):
            jira_client.fetch_issues_by_jql('project = X', ['summary'], search_request=cancel_after_first)
        self.assertEqual(len(calls), 1)


class StrictScopeTests(AccessCase):
    def test_strictness_is_db_oauth_only_and_basic_and_local_store_keep_the_shared_helper(self):
        self.assertTrue(jira_server.epm_jira_reads_strict(self.context))
        local = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s', workspace_id='w',
            auth_connection_id='local-1', cloud_id='c', site_url='x', token_version='1', account_status='active',
            is_admin=False)
        basic = RequestAuthContext(
            auth_mode='basic', user_id='u', stable_subject='s', atlassian_account_id='s', workspace_id='w',
            auth_connection_id='', cloud_id='c', site_url='x', token_version='1', account_status='active', is_admin=False)
        for context in (None, local, basic):
            self.assertFalse(jira_server.epm_jira_reads_strict(context))
        captured = {}
        with patch.object(jira_server, 'fetch_issues_by_jql', lambda *a, **kw: captured.setdefault('kw', kw) or []):
            for context in (basic, self.context):
                captured.clear()
                jira_server.fetch_epm_issues_by_jql('project = X', ['summary'], context=context)
                self.assertEqual('search_request' in captured['kw'], context is self.context)

    def test_strict_epic_link_resolution_raises_typed_failures_and_the_default_stays_swallowing(self):
        response = FakeJiraResponse(403)
        with patch.object(jira_server, 'current_jira_get', return_value=response):
            with self.assertRaises(JiraReadError):
                jira_server.resolve_epic_link_field_id({}, context=self.context, strict=True)
            self.assertIsNone(jira_server.resolve_epic_link_field_id({}, context=self.context))
        with patch.object(jira_server, 'current_jira_get', return_value=FakeJiraResponse(401)):
            with self.assertRaises(AuthError):
                jira_server.resolve_epic_link_field_id({}, context=self.context, strict=True)


class RouteJiraFailureTests(AccessCase):
    """Per-project rollup and issues for an owner-private custom row: Jira page failures through the real guard."""

    def setUp(self):
        super().setUp()
        self.save_config({**EPM_CONFIG, 'projects': {
            'custom-1': {'id': 'custom-1', 'name': 'Custom', 'label': 'custom_label'}}})
        for cache in (jira_server.EPM_ROLLUP_CACHE, jira_server.EPM_ISSUES_CACHE):
            cache.clear()
            self.addCleanup(cache.clear)
        self.pages = []
        self.jqls = []
        for patcher in (patch.object(jira_server, 'jira_search_request', self.search),
                        patch.object(jira_server, 'resolve_epic_link_field_id', lambda *a, **k: None)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def search(self, payload, *, context=None, timeout=None):
        self.jqls.append((payload['jql'], payload.get('nextPageToken')))
        item = self.pages.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def ok(self, issues, token=None):
        return FakeJiraResponse(200, {'issues': issues, 'nextPageToken': token, 'isLast': token is None})

    def rollup(self):
        with self.helper._db_route_mode():
            return self.client.get('/api/epm/projects/custom-1/rollup?tab=archived')

    def issues(self):
        with self.helper._db_route_mode():
            return self.client.get('/api/epm/projects/custom-1/issues?tab=archived')

    EXPECT = (
        (lambda: FakeJiraResponse(403), 403, 'jira_access_denied'),
        (lambda: FakeJiraResponse(429, headers={'Retry-After': '9'}), 503, 'jira_rate_limited'),
        (lambda: FakeJiraResponse(500), 502, 'jira_read_failed'),
        (lambda: FakeJiraResponse(200, bad_json=True), 502, 'jira_read_failed'),
        (lambda: FakeJiraResponse(401), 401, 'auth_required'),
        (lambda: OSError('reset'), 502, 'jira_read_failed'),
    )

    def test_a_failure_on_a_later_q1_page_is_typed_and_nothing_is_cached(self):
        for make, status, code in self.EXPECT:
            for route in (self.rollup, self.issues):
                with self.subTest(code=code, route=route.__name__):
                    self.pages = [self.ok([issue('E-1', 'Epic')], token='next'), make()]
                    jira_server.EPM_ROLLUP_CACHE.clear()
                    jira_server.EPM_ISSUES_CACHE.clear()
                    response = route()
                    body = response.get_json()
                    self.assertEqual((response.status_code, body['error']), (status, code), body)
                    for field in ('initiatives', 'rootEpics', 'issues', 'emptyRollup', 'metadataOnly'):
                        self.assertNotIn(field, body)
                    self.assertEqual((len(jira_server.EPM_ROLLUP_CACHE), len(jira_server.EPM_ISSUES_CACHE)), (0, 0))
                    if status == 503:
                        self.assertEqual(response.headers['Retry-After'], '9')

    def test_a_q2_failure_after_a_good_q1_caches_nothing_and_is_not_an_empty_rollup(self):
        for make, status, code in self.EXPECT:
            with self.subTest(code=code):
                self.pages = [self.ok([issue('E-1', 'Epic')]), make()]
                jira_server.EPM_ROLLUP_CACHE.clear()
                response = self.rollup()
                self.assertEqual((response.status_code, response.get_json()['error']), (status, code))
                self.assertEqual(len(jira_server.EPM_ROLLUP_CACHE), 0)

    def test_a_q1_failure_is_not_the_old_empty_rollup_success(self):
        self.pages = [FakeJiraResponse(500)]
        response = self.rollup()
        self.assertEqual(response.status_code, 502)
        self.assertNotEqual(response.get_json().get('emptyRollup'), True)

    def test_success_still_admits_and_a_second_request_is_a_cache_hit(self):
        self.pages = [self.ok([issue('E-1', 'Epic')]), self.ok([issue('S-1', 'Story', parent='E-1')]), self.ok([])]
        first = self.rollup()
        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(len(jira_server.EPM_ROLLUP_CACHE), 1)
        calls = len(self.jqls)
        self.assertEqual(self.rollup().status_code, 200)
        self.assertEqual(len(self.jqls), calls)

    def test_a_jira_401_is_global_base_auth_loss_with_the_guard_shape_and_a_403_is_not(self):
        self.pages = [FakeJiraResponse(401)]
        unauthorized = self.rollup()
        self.assertEqual(unauthorized.status_code, 401)
        self.assertEqual(unauthorized.get_json()['loginUrl'], '/login?reason=session_expired')
        self.pages = [FakeJiraResponse(403)]
        self.assertEqual(self.rollup().status_code, 403)

    def test_no_home_call_for_a_direct_custom_row_even_when_jira_fails(self):
        self.pages = [FakeJiraResponse(500)]
        self.rollup()
        self.assertEqual(self.home.calls, [])


class BasicKeepsSharedBehaviorTests(unittest.TestCase):
    def test_basic_rollup_query_still_goes_through_the_shared_iterator_and_returns_partial_pages(self):
        force_basic_auth_mode(self, jira_server)
        responses = [FakeJiraResponse(200, {'issues': [issue('A-1')], 'nextPageToken': 'p2', 'isLast': False}),
                     FakeJiraResponse(500)]
        with patch.object(jira_server, 'jira_search_request', lambda payload, **kw: responses.pop(0)):
            issues = jira_server.fetch_epm_rollup_query('project = X', 'q1', {}, ['summary'], [], context=None)
        self.assertEqual([i['key'] for i in issues], ['A-1'])


def _rollup_deps(cache, *, fetch, is_cancelled=None):
    context = SimpleNamespace(auth_mode='atlassian_oauth', workspace_id='w', auth_connection_id='c', user_id='u',
                              cloud_id='x', token_version='1', project_access=())
    return epm_rollup.EpmRollupDependencies(
        find_epm_project_or_404=lambda project_id: {'id': project_id, 'label': 'lbl'},
        normalize_epm_text=lambda value: str(value or '').strip(),
        validate_epm_tab_sprint=lambda tab, sprint: None,
        build_empty_epm_rollup_payload=lambda project, **kw: {'project': project, **kw},
        build_base_jql=lambda: 'project = X',
        add_clause_to_jql=lambda jql, clause: f'{jql} AND {clause}',
        build_jira_headers=lambda: {},
        resolve_epic_link_field_id=lambda headers: None,
        resolve_team_field_id=lambda headers: None,
        build_epm_rollup_fields_list=lambda *a, **k: [],
        get_epm_config=lambda: {'issueTypes': {}},
        normalize_epm_issue_type_sets=lambda _types: {'initiative': {'initiative'}, 'epic': {'epic'}, 'leaf': {'story'}},
        fetch_epm_rollup_query=fetch,
        shape_epm_rollup_issue_payload=lambda issues, **kw: (issues, {}),
        dedupe_issues_by_key=lambda issues: issues,
        build_epm_rollup_hierarchy=lambda issues, types: {},
        cache=cache, cache_lock=threading.Lock(), cache_ttl_seconds=300, context=context,
        is_cancelled=is_cancelled,
    )


class CacheAdmissionCancellationTests(unittest.TestCase):
    def run_rollup(self, cache, **kwargs):
        deps = _rollup_deps(cache, fetch=lambda *a, **k: [], **kwargs)
        return epm_rollup.build_per_project_rollup('p1', 'archived', '', deps)

    def test_a_cancelled_request_admits_nothing_and_a_live_one_does(self):
        cache = {}
        self.run_rollup(cache, is_cancelled=lambda: True)
        self.assertEqual(cache, {})
        self.run_rollup(cache, is_cancelled=lambda: False)
        self.assertEqual(len(cache), 1)

    def test_a_fetch_failure_admits_nothing(self):
        cache = {}
        deps = _rollup_deps(cache, fetch=lambda *a, **k: (_ for _ in ()).throw(JiraReadError('jira_read_failed')))
        with self.assertRaises(JiraReadError):
            epm_rollup.build_per_project_rollup('p1', 'archived', '', deps)
        self.assertEqual(cache, {})


def _aggregate_deps(builder, projects, *, cancellations):
    def build_dependencies(sub_goal_keys=None, cancellation=None):
        cancellations.append(cancellation)
        return object()

    return epm_aggregate.EpmAggregateDependencies(
        normalize_epm_text=lambda value: str(value or '').strip(),
        validate_epm_tab_sprint=lambda tab, sprint: None,
        get_epm_config=lambda: {},
        build_epm_projects_payload=lambda config, **kw: {'projects': projects},
        filter_epm_projects_for_tab=lambda items, tab: items,
        build_epm_rollup_dependencies=build_dependencies,
        get_epm_project_payload_identity=lambda project: project['id'],
        build_empty_epm_rollup_payload=lambda project, **kw: {'project': project, **kw},
        build_per_project_rollup=builder,
        logger=SimpleNamespace(info=lambda *a, **k: None),
    )


class WorkerFailureTests(unittest.TestCase):
    def projects(self, count):
        return [{'id': f'p{index}', 'label': 'lbl'} for index in range(count)]

    def test_first_worker_failure_cancels_queued_work_and_escapes_without_a_cached_empty_result(self):
        started, release, cancellations = [], threading.Event(), []
        lock = threading.Lock()

        def builder(project_id, tab, sprint, deps):
            with lock:
                started.append(project_id)
            if project_id == 'p1':
                time.sleep(0.05)  # let the other workers start and block
                raise AuthError('account_disabled', 'disabled')
            release.wait(5)
            return {'project': {'id': project_id}}, 200, {}

        deps = _aggregate_deps(builder, self.projects(24), cancellations=cancellations)
        begun = time.monotonic()
        with self.assertRaises(AuthError) as raised:
            epm_aggregate.build_all_epm_projects_rollup('active', '', deps)
        self.assertEqual(raised.exception.code, 'account_disabled')
        self.assertLess(time.monotonic() - begun, 3)  # did not wait for the queued (or blocked) work
        self.assertTrue(cancellations[-1].is_set())
        release.set()
        time.sleep(0.3)
        with lock:
            # eight running plus at most the one slot the failing worker freed before the main thread cancelled
            self.assertLessEqual(len(started), 9)
            self.assertNotIn('p23', started)

    def test_typed_jira_and_strict_errors_escape_instead_of_becoming_metadata_only(self):
        for error in (JiraReadError('jira_access_denied', status=403), JiraReadError('jira_rate_limited', status=429),
                      AuthError('auth_required', 'x')):
            with self.subTest(error=type(error).__name__):
                def builder(project_id, tab, sprint, deps, error=error):
                    raise error

                deps = _aggregate_deps(builder, self.projects(3), cancellations=[])
                with self.assertRaises(type(error)):
                    epm_aggregate.build_all_epm_projects_rollup('active', '', deps)

    def test_success_waits_for_all_workers_and_the_signal_stays_clear(self):
        cancellations = []

        def builder(project_id, tab, sprint, deps):
            return {'project': {'id': project_id}, 'initiatives': {}}, 200, {}

        deps = _aggregate_deps(builder, self.projects(10), cancellations=cancellations)
        payload, status, _headers = epm_aggregate.build_all_epm_projects_rollup('active', '', deps)
        self.assertEqual((status, len(payload['projects'])), (200, 10))
        self.assertFalse(cancellations[-1].is_set())


if __name__ == '__main__':
    unittest.main()
