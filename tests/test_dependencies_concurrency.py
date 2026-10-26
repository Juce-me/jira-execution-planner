"""Complete-or-incomplete dependencies with bounded concurrent Jira batches (synthetic data only)."""

import copy
import json
import random
import re
import threading
import time
import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, Mock, patch

from flask import has_request_context, session

import jira_server
from backend import jira_client
from backend.auth.cache_policy import build_jira_home_process_cache_key
from backend.auth.context import RequestAuthContext
from backend.routes import eng_routes
from backend.services import jira_batches
from backend.services.jira_batches import JIRA_BATCH_CONCURRENCY, JiraBatchIncomplete
from tests.oauth_test_helpers import oauth_session_payload

KEY_IN_JQL = re.compile(r'"([A-Z][A-Z0-9_]*-\d+)"')
BLOCKS = {'name': 'Blocks', 'inward': 'is blocked by', 'outward': 'blocks'}
DEPENDS = {'name': 'Dependency', 'inward': 'is depended on by', 'outward': 'depends on'}
RELATES = {'name': 'Relates', 'inward': 'relates to', 'outward': 'relates to'}


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _issue(key, number):
    return {'key': key, 'fields': {
        'summary': f'Issue {key}', 'status': {'name': 'In Progress'}, 'issuetype': {'name': 'Story'},
        'priority': {'name': 'Medium'}, 'customfield_sp': number % 5,
        'customfield_team': {'id': f'team-{number % 7}', 'name': f'Team {number % 7}'},
        'parent': None, 'issuelinks': [],
    }}


def _add_link(issue, link_type, side, other_key):
    # The embedded copy is deliberately stale so a snapshot fetched in round two is distinguishable.
    issue['fields']['issuelinks'].append({'type': dict(link_type), side: {'key': other_key, 'fields': {
        'summary': 'Embedded copy', 'status': {'name': 'Stale'}, 'issuetype': {'name': 'Story'}}}})


def build_dataset(keys, seed=20261026, max_links=2):
    """Issues with Jira-shaped links, plus the semantic edges the links were rendered from."""
    rng = random.Random(seed)
    issues = {key: _issue(key, number) for number, key in enumerate(keys)}
    semantic = []
    pairs = set()
    for key in keys:
        for _ in range(rng.randint(0, max_links)):
            other = keys[rng.randrange(len(keys))]
            if other == key or frozenset((key, other)) in pairs:
                continue
            pairs.add(frozenset((key, other)))
            kind = rng.choice(('block', 'dependency', 'relates'))
            prereq, dependent = (key, other) if rng.random() < 0.5 else (other, key)
            if kind == 'block':        # prereq blocks dependent
                _add_link(issues[prereq], BLOCKS, 'outwardIssue', dependent)
                _add_link(issues[dependent], BLOCKS, 'inwardIssue', prereq)
                semantic.append((prereq, dependent, 'block'))
            elif kind == 'dependency':  # dependent depends on prereq
                _add_link(issues[dependent], DEPENDS, 'outwardIssue', prereq)
                _add_link(issues[prereq], DEPENDS, 'inwardIssue', dependent)
                semantic.append((prereq, dependent, 'dependency'))
            else:
                _add_link(issues[key], RELATES, 'outwardIssue', other)
                _add_link(issues[other], RELATES, 'inwardIssue', key)
    return issues, semantic


def expected_edges(semantic, requested):
    requested = set(requested)
    edges = set()
    for prereq, dependent, category in semantic:
        if prereq in requested:
            edges.add((prereq, dependent, category, prereq, dependent))
        if dependent in requested:
            edges.add((dependent, prereq, category, prereq, dependent))
    return edges


def actual_edges(dependencies):
    edges = [(base, entry['key'], entry['category'], entry['prereqKey'], entry['dependentKey'])
             for base, entries in dependencies.items() for entry in entries]
    assert len(edges) == len(set(edges)), 'duplicate dependency entries'
    return set(edges)


def serial_link_dataset(count=500):
    """deps_serial_baseline.py shape: half of SRC-n block EXT-n."""
    issues = {}
    for n in range(count):
        key = f'SRC-{n}'
        issues[key] = _issue(key, n)
        if n % 2 == 0:
            _add_link(issues[key], BLOCKS, 'outwardIssue', f'EXT-{n}')
            issues[f'EXT-{n}'] = _issue(f'EXT-{n}', n)
    return issues


class FakeJira:
    """One Jira search endpoint over a dataset; pages hold at most page_size rows and carry nextPageToken."""

    def __init__(self, issues, *, page_size=100, latency=0.0, respond=None):
        self.issues = issues
        self.page_size = page_size
        self.latency = latency
        self.respond = respond
        self.lock = threading.Lock()
        self.calls = []
        self.in_flight = 0
        self.peak = 0

    def search(self, payload, **kwargs):
        record = {'payload': copy.deepcopy(payload), 'kwargs': dict(kwargs), 'thread': threading.current_thread(),
                  'request_context': has_request_context(), 'started': time.monotonic(), 'last': None}
        with self.lock:
            self.calls.append(record)
            self.in_flight += 1
            self.peak = max(self.peak, self.in_flight)
        try:
            override = self.respond(payload) if self.respond else None
            if override is not None:
                return override
            if self.latency:
                time.sleep(self.latency)
            rows = [self.issues[key] for key in KEY_IN_JQL.findall(payload['jql']) if key in self.issues]
            offset = int(payload['nextPageToken'][1:]) if payload.get('nextPageToken') else 0
            page = rows[offset:offset + self.page_size]
            body = {'issues': copy.deepcopy(page), 'isLast': offset + self.page_size >= len(rows)}
            if not body['isLast']:
                body['nextPageToken'] = f'p{offset + self.page_size}'
            record['last'] = body['isLast']
            return FakeResponse(200, body)
        finally:
            with self.lock:
                self.in_flight -= 1

    def payloads(self):
        return sorted(json.dumps(call['payload'], sort_keys=True) for call in self.calls)

    def queried_keys(self):
        return {key for call in self.calls for key in KEY_IN_JQL.findall(call['payload']['jql'])}


def auth_context(connection_id='connection-1'):
    return RequestAuthContext(
        auth_mode='atlassian_oauth', user_id='user-1', stable_subject='subject-1',
        atlassian_account_id='account-1', workspace_id='workspace-1',
        auth_connection_id=connection_id, cloud_id='cloud-1',
        site_url='https://example.atlassian.net', token_version='1',
        account_status='active', is_admin=False,
    )


def _field_patches(stack):
    stack.enter_context(patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'))
    stack.enter_context(patch.object(jira_server, 'resolve_epic_link_field_id', return_value=None))
    stack.enter_context(patch.object(jira_server, 'get_story_points_field_id', return_value='customfield_sp'))


class DependenciesConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(jira_batches, '_ADMISSION', jira_batches._ProcessAdmission()))
        _field_patches(self.stack)
        self.dataset_keys = [f'DS-{n}' for n in range(1000)]
        self.issues, self.semantic = build_dataset(self.dataset_keys)
        self.requested = self.dataset_keys[:300]

    def collect(self, fake, keys, **kwargs):
        with patch.object(jira_server, 'current_jira_search', side_effect=fake.search):
            return jira_server.collect_dependencies(keys, **kwargs)

    def strict(self, cap=JIRA_BATCH_CONCURRENCY, context=None):
        return {'context': context or auth_context(), 'max_concurrency': cap, 'strict': True,
                'deadline': time.monotonic() + 25}

    def test_default_collect_dependencies_stays_serial_and_non_strict(self):
        issues = serial_link_dataset()
        keys = [f'SRC-{n}' for n in range(500)]
        fake = FakeJira(issues, latency=0.005)

        result = self.collect(fake, keys)

        self.assertEqual(len(fake.calls), 8)
        self.assertEqual(fake.peak, 1)
        self.assertTrue(all(call['thread'] is threading.current_thread() for call in fake.calls))
        self.assertTrue(all(call['kwargs'] == {} for call in fake.calls))
        self.assertEqual(sum(len(entries) for entries in result.values()), 250)

        first_batch = sorted(keys)[:100]
        failing = FakeJira(issues, respond=lambda payload: (
            FakeResponse(500, {'error': 'upstream'}) if f'"{first_batch[0]}"' in payload['jql'] else None))
        partial = self.collect(failing, keys)
        self.assertEqual(sum(len(entries) for entries in partial.values()),
                         sum(1 for key in keys if key not in first_batch and int(key.split('-')[1]) % 2 == 0))

    def test_strict_concurrent_result_has_every_independently_expected_edge(self):
        fake = FakeJira(self.issues, page_size=50, latency=0.005)

        result = self.collect(fake, self.requested, **self.strict())

        expected = expected_edges(self.semantic, self.requested)
        self.assertGreater(len(expected), 100)
        self.assertEqual(actual_edges(result), expected)
        outside = [entry for entries in result.values() for entry in entries if entry['key'] not in set(self.requested)]
        self.assertGreater(len(outside), 20)
        for entry in outside:
            number = int(entry['key'].split('-')[1])
            self.assertEqual(entry['status'], 'In Progress')
            self.assertEqual(entry['teamName'], f'Team {number % 7}')
        self.assertTrue(any('nextPageToken' in call['payload'] for call in fake.calls))
        self.assertTrue(fake.queried_keys() - set(self.requested))
        self.assertLessEqual(fake.peak, JIRA_BATCH_CONCURRENCY)
        self.assertGreater(fake.peak, 1)

    def test_strict_cap_four_and_cap_one_issue_the_same_payloads(self):
        serial = FakeJira(self.issues, page_size=50)
        concurrent = FakeJira(self.issues, page_size=50, latency=0.003)

        serial_result = self.collect(serial, self.requested, **self.strict(cap=1))
        concurrent_result = self.collect(concurrent, self.requested, **self.strict(cap=4))

        self.assertEqual(serial.payloads(), concurrent.payloads())
        self.assertTrue(any('nextPageToken' in call['payload'] for call in serial.calls))
        self.assertEqual(serial_result, concurrent_result)
        self.assertEqual(serial.peak, 1)

    def test_failure_in_round_one_gives_incomplete_with_partial_and_skips_round_two(self):
        failing_key = sorted(self.requested)[150]

        def respond(payload):
            if f'"{failing_key}"' in payload['jql']:
                time.sleep(0.005)
                return FakeResponse(500, {'error': 'upstream'})
            return None

        fake = FakeJira(self.issues, page_size=50, latency=0.005, respond=respond)
        with self.assertRaises(JiraBatchIncomplete) as raised:
            self.collect(fake, self.requested, **self.strict())

        error = raised.exception
        self.assertEqual(error.reason, 'http_status')
        self.assertFalse(error.rate_limited)
        self.assertLessEqual(fake.queried_keys(), set(self.requested))
        failed_batch = {key for call in fake.calls if f'"{failing_key}"' in call['payload']['jql']
                        for key in KEY_IN_JQL.findall(call['payload']['jql'])}
        served = {key for call in fake.calls if call['last'] for key in KEY_IN_JQL.findall(call['payload']['jql'])}
        expected = expected_edges(self.semantic, self.requested)
        partial = actual_edges(error.partial)
        self.assertTrue(partial)
        self.assertLessEqual(partial, expected)
        self.assertEqual(partial, {edge for edge in expected if edge[0] in served})
        self.assertFalse(any(edge[0] in failed_batch for edge in partial))

    def test_failure_in_round_two_gives_incomplete_with_round_one_data(self):
        requested = set(self.requested)

        def respond(payload):
            if any(key not in requested for key in KEY_IN_JQL.findall(payload['jql'])):
                return FakeResponse(503, {'error': 'Jira temporarily unavailable', 'upstreamStatus': 503})
            return None

        fake = FakeJira(self.issues, page_size=50, respond=respond)
        with self.assertRaises(JiraBatchIncomplete) as raised:
            self.collect(fake, self.requested, **self.strict())

        self.assertEqual(raised.exception.reason, 'http_status')
        self.assertEqual(actual_edges(raised.exception.partial), expected_edges(self.semantic, self.requested))

    def test_429_marks_the_run_rate_limited_and_stops_admission(self):
        keys = self.dataset_keys
        first_batch_key = sorted(keys)[0]

        def respond(payload):
            if f'"{first_batch_key}"' in payload['jql']:
                return jira_client._build_jira_unavailable_response(
                    'Jira rate limited the request', attempts=4, elapsed_seconds=1, upstream_status=429)
            return None

        fake = FakeJira(self.issues, latency=0.05, respond=respond)
        with self.assertRaises(JiraBatchIncomplete) as raised:
            self.collect(fake, keys, **self.strict())

        self.assertEqual(raised.exception.reason, 'rate_limited')
        self.assertTrue(raised.exception.rate_limited)
        self.assertLessEqual(len(fake.calls), JIRA_BATCH_CONCURRENCY)
        self.assertLessEqual(fake.queried_keys(), set(keys))

        after = FakeJira(self.issues, page_size=50, latency=0.005)
        result = self.collect(after, self.requested, **self.strict())
        self.assertEqual(actual_edges(result), expected_edges(self.semantic, self.requested))
        self.assertEqual(after.peak, 1)

    def test_worker_calls_carry_the_explicit_auth_context_without_request_context(self):
        ctx = auth_context()
        fake = FakeJira(self.issues, page_size=50, latency=0.002)
        outcome = {}

        def run():
            outcome['request_context'] = has_request_context()
            outcome['result'] = jira_server.collect_dependencies(self.requested, **self.strict(context=ctx))

        with patch.object(jira_server, 'current_request_auth_context', side_effect=AssertionError('no implicit context')), \
                patch.object(jira_server, 'current_jira_search', side_effect=fake.search):
            worker = threading.Thread(target=run)
            worker.start()
            worker.join(10)

        self.assertFalse(worker.is_alive())
        self.assertFalse(outcome['request_context'])
        self.assertEqual(actual_edges(outcome['result']), expected_edges(self.semantic, self.requested))
        self.assertTrue(fake.calls)
        for call in fake.calls:
            self.assertIs(call['kwargs']['context'], ctx)
            self.assertFalse(call['request_context'])
            self.assertGreaterEqual(call['kwargs']['timeout'], 1.0)
            self.assertLessEqual(call['kwargs']['timeout'], 30.0)
            self.assertIsNot(call['thread'], worker)

    def test_cap_four_and_cap_one_resolve_the_same_auth_context(self):
        keys = self.requested[:150]

        def jira_get_recorder(seen):
            def fake_jira_get(_config, context, session_data, path, **kwargs):
                self.assertEqual(path, '/rest/api/3/search/jql')
                seen.append((context, session_data.get('access_token')))
                rows = [self.issues[key] for key in KEY_IN_JQL.findall(kwargs['params']['jql'])]
                return FakeResponse(200, {'issues': copy.deepcopy(rows), 'isLast': True})
            return fake_jira_get

        def run_both(stack):
            seen = {1: [], 4: []}
            for cap in (1, 4):
                with patch.object(jira_server, 'jira_get', side_effect=jira_get_recorder(seen[cap])):
                    if cap == 1:
                        jira_server.collect_dependencies(keys)
                    else:
                        jira_server.collect_dependencies(
                            keys, max_concurrency=4, strict=True, deadline=time.monotonic() + 25)
            return seen

        with self.subTest('local OAuth session'), ExitStack() as stack:
            stack.enter_context(patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'))
            stack.enter_context(patch.object(jira_server, 'database_storage_enabled', return_value=False))
            stack.enter_context(patch.dict(jira_server.app.config, {'SECRET_KEY': 'test-secret'}))
            stack.enter_context(patch.dict(jira_server.OAUTH_TOKEN_STORE, {
                'session-1': oauth_session_payload(access_token='local-token')}, clear=True))
            stack.enter_context(patch.dict(jira_server.OAUTH_REFRESH_LOCKS, {'session-1': threading.Lock()}, clear=True))
            stack.enter_context(jira_server.app.test_request_context('/api/dependencies', method='POST'))
            session['atlassian_oauth_session_id'] = 'session-1'
            seen = run_both(stack)
            self.assertGreaterEqual(len(seen[1]), 2)
            self.assertEqual(len(seen[4]), len(seen[1]))
            local_context = seen[1][0][0]
            self.assertTrue(local_context.auth_connection_id.startswith('local-oauth-connection:'))
            self.assertTrue(all(entry == (local_context, 'local-token') for entry in seen[1] + seen[4]))

        with self.subTest('DB OAuth connection'), ExitStack() as stack:
            db_context = auth_context('connection-db-1')
            stack.enter_context(patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'))
            stack.enter_context(patch.object(jira_server, 'current_request_auth_context', return_value=db_context))
            stack.enter_context(patch.object(
                jira_server, 'db_oauth_session_data_for_auth_context',
                side_effect=lambda context, **_kw: {'access_token': f'db-token:{context.auth_connection_id}',
                                                    'expires_at': time.time() + 3600}))
            stack.enter_context(patch.object(
                jira_server, 'oauth_session_data_for_auth_context', side_effect=AssertionError('local store forbidden')))
            stack.enter_context(jira_server.app.test_request_context('/api/dependencies', method='POST'))
            seen = run_both(stack)
            self.assertGreaterEqual(len(seen[1]), 2)
            self.assertEqual(len(seen[4]), len(seen[1]))
            self.assertTrue(all(entry == (db_context, 'db-token:connection-db-1') for entry in seen[1] + seen[4]))
            self.assertTrue(all(entry[0] is db_context for entry in seen[4]))

    def test_batches_complete_when_the_db_session_pool_is_smaller_than_the_cap(self):
        pool = threading.BoundedSemaphore(2)
        lock = threading.Lock()
        state = {'holding': 0, 'peak': 0}
        fake = FakeJira(self.issues, page_size=50)

        def boundary(payload, **kwargs):
            self.assertTrue(pool.acquire(timeout=5), 'a Jira call waited for a session that never came back')
            with lock:
                state['holding'] += 1
                state['peak'] = max(state['peak'], state['holding'])
            try:
                time.sleep(0.01)
                return fake.search(payload, **kwargs)
            finally:
                with lock:
                    state['holding'] -= 1
                pool.release()

        result = {}
        with patch.object(jira_server, 'current_jira_search', side_effect=boundary):
            worker = threading.Thread(target=lambda: result.update(
                deps=jira_server.collect_dependencies(self.requested, **self.strict())))
            worker.start()
            worker.join(20)

        self.assertFalse(worker.is_alive())
        self.assertEqual(actual_edges(result['deps']), expected_edges(self.semantic, self.requested))
        self.assertLessEqual(state['peak'], 2)


class DependenciesRouteTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(jira_batches, '_ADMISSION', jira_batches._ProcessAdmission()))
        _field_patches(self.stack)
        self.stack.enter_context(patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'))
        self.ctx = auth_context()
        self.stack.enter_context(patch.object(jira_server, 'current_request_auth_context', return_value=self.ctx))
        self.stack.enter_context(patch.object(jira_server, 'jira_home_partitioned_process_cache_enabled', return_value=True))
        self.stack.enter_context(patch.dict(jira_server.DEPENDENCIES_CACHE, {}, clear=True))
        jira_server.app.testing = True
        self.dataset_keys = [f'DS-{n}' for n in range(1000)]
        self.issues, self.semantic = build_dataset(self.dataset_keys)

    def post(self, keys):
        return jira_server.app.test_client().post('/api/dependencies', json={'keys': keys})

    def cache_key(self, keys):
        return build_jira_home_process_cache_key(self.ctx, 'dependencies', ','.join(sorted(keys)))

    def test_route_returns_200_incomplete_and_never_caches_it_and_a_later_request_retries(self):
        keys = self.dataset_keys[:300]
        failing_key = sorted(keys)[150]
        failing = FakeJira(self.issues, page_size=50, respond=lambda payload: (
            FakeResponse(500, {'error': 'upstream'}) if f'"{failing_key}"' in payload['jql'] else None))

        with patch.object(jira_server, 'current_jira_search', side_effect=failing.search):
            first = self.post(keys)
        body = first.get_json()
        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertIs(body['incomplete'], True)
        self.assertEqual(body['reason'], 'http_status')
        self.assertTrue(body['dependencies'])
        self.assertLess(actual_edges(body['dependencies']), expected_edges(self.semantic, keys))
        self.assertIn('collect;dur=', first.headers['Server-Timing'])
        self.assertEqual(jira_server.DEPENDENCIES_CACHE, {})

        healthy = FakeJira(self.issues, page_size=50)
        with patch.object(jira_server, 'current_jira_search', side_effect=healthy.search):
            second = self.post(keys)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(set(second.get_json()), {'dependencies'})
        self.assertEqual(actual_edges(second.get_json()['dependencies']), expected_edges(self.semantic, keys))
        self.assertEqual(jira_server.DEPENDENCIES_CACHE[self.cache_key(keys)]['data'], second.get_json()['dependencies'])

        with patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('served from cache')):
            third = self.post(keys)
        self.assertEqual(third.get_json(), second.get_json())
        self.assertEqual(third.headers['Server-Timing'], 'cache;dur=1')

    def test_route_auth_error_in_a_worker_stays_a_401_and_is_never_flagged_or_cached(self):
        keys = self.dataset_keys[:300]
        failing_key = sorted(keys)[150]

        def respond(payload):
            if f'"{failing_key}"' in payload['jql']:
                raise jira_server.AuthError('auth_required', 'Atlassian authentication is required.')
            return None

        fake = FakeJira(self.issues, page_size=50, respond=respond)
        with patch.object(jira_server, 'current_jira_search', side_effect=fake.search):
            response = self.post(keys)

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertNotIn('incomplete', response.get_json())
        self.assertTrue(any(call['thread'] is not threading.current_thread() for call in fake.calls))
        self.assertEqual(jira_server.DEPENDENCIES_CACHE, {})

    def test_route_deadline_returns_partial_incomplete_and_a_scope_switch_proceeds(self):
        stall_keys = [f'STALL-{n}' for n in range(150)]
        other_keys = [f'OK-{n}' for n in range(20)]
        issues, semantic = build_dataset(stall_keys + other_keys, seed=7)
        stalled_key = sorted(stall_keys)[0]
        stalled, release = threading.Event(), threading.Event()
        stalled_threads = []

        def respond(payload):
            if f'"{stalled_key}"' in payload['jql']:
                stalled_threads.append(threading.current_thread())
                stalled.set()
                release.wait(5)
            return None

        fake = FakeJira(issues, respond=respond)
        responses = {}

        def slow_request():
            started = time.monotonic()
            responses['stalled'] = self.post(stall_keys)
            responses['stalled_elapsed'] = time.monotonic() - started

        self.stack.enter_context(patch.object(eng_routes, '_DEPENDENCIES_DEADLINE_SECONDS', 0.3))
        with patch.object(jira_server, 'current_jira_search', side_effect=fake.search):
            first = threading.Thread(target=slow_request)
            first.start()
            self.assertTrue(stalled.wait(5))
            switched = self.post(other_keys)
            first.join(5)
            self.assertFalse(first.is_alive())
            self.assertTrue(stalled_threads[0].is_alive())
            release.set()
            stalled_threads[0].join(5)

        self.assertFalse(stalled_threads[0].is_alive())
        self.assertEqual(switched.status_code, 200)
        self.assertEqual(set(switched.get_json()), {'dependencies'})
        self.assertEqual(actual_edges(switched.get_json()['dependencies']), expected_edges(semantic, other_keys))
        body = responses['stalled'].get_json()
        self.assertLess(responses['stalled_elapsed'], 1.0)
        self.assertEqual(responses['stalled'].status_code, 200)
        self.assertIs(body['incomplete'], True)
        self.assertEqual(body['reason'], 'deadline')
        unstalled = {key for key in sorted(stall_keys)[100:]}
        self.assertEqual(actual_edges(body['dependencies']),
                         {edge for edge in expected_edges(semantic, stall_keys) if edge[0] in unstalled})
        stalled_call = next(call for call in fake.calls if f'"{stalled_key}"' in call['payload']['jql'])
        self.assertEqual(stalled_call['kwargs']['timeout'], 1.0)
        self.assertNotIn(self.cache_key(stall_keys), jira_server.DEPENDENCIES_CACHE)
        self.assertIn(self.cache_key(other_keys), jira_server.DEPENDENCIES_CACHE)

    def test_other_callers_stay_serial_and_non_strict(self):
        keys = self.dataset_keys[:150]
        first_batch = sorted(keys)[:100]
        fake = FakeJira(self.issues, page_size=20, respond=lambda payload: (
            FakeResponse(500, {'error': 'upstream'}) if f'"{first_batch[0]}"' in payload['jql'] else None))
        with patch.object(jira_server, 'current_jira_search', side_effect=fake.search):
            lookup = jira_server.app.test_client().get('/api/issues/lookup?keys=' + ','.join(keys))
        self.assertEqual(lookup.status_code, 200, lookup.get_data(as_text=True))
        # Today's non-strict contract, pinned: a failed batch is skipped and a continuation token is not followed.
        self.assertEqual(len(fake.calls), 2)
        self.assertTrue(all(call['kwargs'] == {} for call in fake.calls))
        self.assertTrue(all(call['thread'] is threading.current_thread() for call in fake.calls))
        returned = [issue['key'] for issue in lookup.get_json()['issues']]
        self.assertEqual(returned, sorted(keys)[100:120])

        collect = MagicMock(return_value={})
        rows = [{'key': key, 'fields': copy.deepcopy(self.issues[key]['fields'])} for key in keys[:3]]
        with patch.object(jira_server, 'collect_dependencies', collect), \
                patch.object(jira_server, 'fetch_issues_by_jql', return_value=rows), \
                patch.object(jira_server, 'fetch_capacity_team_sizes', return_value=({}, {})):
            scenario = jira_server.app.test_client().post(
                '/api/scenario', json={'filters': {'sprint': '2026Q2'}, 'config': {}})
        self.assertEqual(scenario.status_code, 200, scenario.get_data(as_text=True))
        collect.assert_called_once()
        self.assertEqual(collect.call_args.kwargs, {})
        self.assertEqual(sorted(collect.call_args.args[0]), sorted(keys[:3]))

    def test_scope_above_250_issues_per_lane_is_untouched(self):
        lane_keys = [f'PROD-{n}' for n in range(250)] + [f'TECH-{n}' for n in range(250)]
        issues, semantic = build_dataset(lane_keys + [f'EXT-{n}' for n in range(200)], seed=11)
        fake = FakeJira(issues, page_size=50)
        fetch_calls = []
        real_fetch = jira_client.fetch_issues_by_keys

        def spy(*args, **kwargs):
            fetch_calls.append(kwargs)
            return real_fetch(*args, **kwargs)

        with patch.object(jira_server, 'current_jira_search', side_effect=fake.search), \
                patch.object(jira_client, 'fetch_issues_by_keys', side_effect=spy):
            response = self.post(lane_keys)
        body = response.get_json()
        self.assertEqual(set(body), {'dependencies'})
        self.assertEqual(actual_edges(body['dependencies']), expected_edges(semantic, lane_keys))
        self.assertTrue(fetch_calls)
        self.assertTrue(all(call['strict'] and call['max_concurrency'] == JIRA_BATCH_CONCURRENCY for call in fetch_calls))

        def lane_issue(n):
            return {'id': str(n), 'key': f'PROD-{n}', 'fields': {
                'summary': f'Story {n}', 'status': {'name': 'To Do'}, 'priority': {'name': 'Medium'},
                'issuetype': {'name': 'Story'}, 'updated': '2026-09-30T10:00:00.000+0000',
                'customfield_10004': 3, 'customfield_epic_link': 'EPIC-1',
                'customfield_sprint': [{'id': 123, 'name': '2026Q3'}]}}

        def lane_page(start, count, token):
            body = {'issues': [lane_issue(n) for n in range(start, start + count)], 'isLast': False,
                    'names': {'customfield_epic_link': 'Epic Link', 'customfield_sprint': 'Sprint'}, 'total': 300,
                    'nextPageToken': token}
            response = Mock(status_code=200)
            response.json.return_value = body
            return response

        jira_server.TASKS_CACHE.clear()
        with ExitStack() as stack:
            for target, value in (
                ('build_base_jql', 'project = TEST'), ('get_selected_projects_typed', []),
                ('get_configured_issue_types', ['Story']), ('resolve_epic_link_field_id', 'customfield_epic_link'),
                ('get_sprint_field_id', 'customfield_sprint'), ('get_project_track_field_id', 'customfield_track'),
                ('get_delivery_owner_field_id', ''),
            ):
                stack.enter_context(patch.object(jira_server, target, return_value=value))
            search = stack.enter_context(patch.object(jira_server, 'jira_search_request', side_effect=[
                lane_page(0, 100, 't1'), lane_page(100, 100, 't2'), lane_page(200, 50, 't3')]))
            stack.enter_context(patch.object(jira_server, 'fetch_epic_details_bulk', Mock(return_value={})))
            stack.enter_context(patch.object(jira_server, 'fetch_epics_for_empty_alert', Mock(return_value=[])))
            stack.enter_context(patch.object(jira_client, 'fetch_issues_by_keys', side_effect=spy))
            fetch_calls.clear()
            lane = jira_server.app.test_client().get('/api/tasks-with-team-name?project=product&sprint=123&refresh=true')
        jira_server.TASKS_CACHE.clear()
        self.assertEqual(lane.status_code, 200, lane.get_data(as_text=True))
        self.assertEqual(len(lane.get_json()['issues']), 250)
        self.assertEqual([call.args[0]['maxResults'] for call in search.call_args_list], [100, 100, 50])
        self.assertTrue(all(not call.get('strict') and call.get('max_concurrency', 1) == 1 for call in fetch_calls))


if __name__ == '__main__':
    unittest.main()
