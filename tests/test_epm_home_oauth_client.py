"""Task 2 of docs/plans/EXEC-home-oauth-public-reads.md: one snapshot, bounded revalidation, warmed metadata.

Synthetic data only (example.invalid, fake ids and tokens). DB mode uses the SQLite setup from
tests/test_db_oauth_cutover.py; Home I/O is a fake `urlopen`. No live network.
"""

import io
import json
import os
import threading
import time
import unittest
from contextlib import ExitStack, contextmanager
from unittest.mock import patch
from urllib.error import HTTPError

from sqlalchemy import event, select, update
from sqlalchemy.exc import OperationalError

import jira_server
from backend.auth import db_context
from backend.auth.db_context import (
    invalidate_auth_status_cache,
    resolve_db_request_auth_context,
    revalidate_db_request_auth_context,
)
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine
from backend.db import models
from backend.epm import aggregate as epm_aggregate
from backend.epm import home as epm_home
from backend.epm import projects as epm_projects
from backend.epm.home import HomeReadAuth, HomeReadError

HOME_SCOPES = list(epm_home.EPM_HOME_READ_SCOPES)


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return json.dumps(self._payload).encode()


class FakeHome:
    """Raw Home replies by operation name; GoalProjects pages one project per page to make page counts large."""

    def __init__(self, project_pages=1):
        self.project_pages = project_pages
        self.calls = []        # (operationName, bearer)
        self.hooks = []        # callables(operation, count) run before each reply
        self.fail_with = None  # HTTP status for every call
        self.fail_ops = {}     # operationName -> HTTP status or 'denied' (200 with a FORBIDDEN GraphQL error)
        self.unknown_goal = False

    def urlopen(self, request, timeout=None):
        headers = {str(k).lower(): v for k, v in request.header_items()}
        assert request.full_url == epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT, request.full_url
        bearer = headers['authorization']
        assert bearer.startswith('Bearer '), 'only a Bearer credential may reach Home'
        payload = json.loads(request.data)
        operation = payload['operationName']
        self.calls.append((operation, bearer))
        for hook in list(self.hooks):
            hook(operation, len(self.calls))
        if self.fail_with:
            raise HTTPError(request.full_url, self.fail_with, 'fixture', {}, io.BytesIO(b''))
        failure = self.fail_ops.get(operation)
        if failure == 'denied':
            return FakeResponse({'data': None, 'errors': [{'message': 'denied', 'extensions': {'classification': 'FORBIDDEN'}}]})
        if failure:
            raise HTTPError(request.full_url, failure, 'fixture', {}, io.BytesIO(b''))
        variables = payload.get('variables') or {}
        return FakeResponse(getattr(self, f'_op_{operation}')(variables))

    def operations(self):
        return sorted(operation for operation, _ in self.calls)

    def _op_ProjectUpdates(self, variables):
        return {'data': {'projects_byId': {'updates': {'edges': []}}}}

    def _op_ProjectTags(self, variables):
        return {'data': {'projects_byId': {'tags': {'edges': []}}}}

    def _op_GoalByKey(self, variables):
        key = variables['goalKey']
        if self.unknown_goal:
            return {'data': {'goals_byKey': None}}
        return {'data': {'goals_byKey': {'id': f'goal-{key.lower()}', 'key': key, 'name': key, 'url': 'https://example.invalid/g'}}}

    def _op_GoalsSearch(self, variables):
        goals = [{'id': 'goal-sub-1', 'key': 'SUB-1', 'name': 'Sub One', 'url': 'https://example.invalid/g'}]
        return {'data': {'goals_search': {'pageInfo': {'hasNextPage': False, 'endCursor': None},
                                          'edges': [{'node': node} for node in goals]}}}

    def _op_SubGoals(self, variables):
        return {'data': {'goals_byId': {'subGoals': {'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'edges': []}}}}

    def _op_GoalProjects(self, variables):
        after = variables.get('after')
        index = int(after.split('-')[1]) if after else 0
        node = {
            'id': f'project-{index}', 'key': f'P-{index}', 'name': f'Project {index}', 'url': 'https://example.invalid/p',
            'state': {'label': 'On track', 'value': 'ON_TRACK'}, 'tags': {'edges': []}, 'updates': {'edges': []},
        }
        more = index + 1 < self.project_pages
        return {'data': {'goals_byId': {'projects': {
            'pageInfo': {'hasNextPage': more, 'endCursor': f'cursor-{index + 1}' if more else None},
            'edges': [{'node': node}]}}}}


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class SqlCounter:
    def __init__(self, database_url):
        self.engine = db_engine.get_engine(database_url)
        self.statements = []

    def _listener(self, _conn, _cursor, statement, *_args):
        self.statements.append(' '.join(statement.split()))

    def __enter__(self):
        event.listen(self.engine, 'before_cursor_execute', self._listener)
        return self

    def __exit__(self, *_exc):
        event.remove(self.engine, 'before_cursor_execute', self._listener)

    @property
    def selects(self):
        return [s for s in self.statements if s.upper().startswith('SELECT')]


class DbStrictCase(unittest.TestCase):
    """A SQLite DB-OAuth actor whose provider grant has every Home read scope, with a real browser session."""

    def setUp(self):
        from tests import test_db_oauth_cutover as cutover
        invalidate_auth_status_cache()
        epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
        epm_home._CLOUD_ID_CACHE.clear()
        for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ROLLUP_CACHE, jira_server.EPM_ISSUES_CACHE):
            cache.clear()
        self.helper = cutover.DbOauthCutoverTests('test_callback_writes_encrypted_db_tokens_and_returns_session_metadata')
        self.helper.setUp()
        self.addCleanup(self.helper.tearDown)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        callback = self.helper._store_callback_through_route(client=self.helper.client)
        self.stack.enter_context(self.helper._db_route_mode())
        self.database_url = self.helper.database_url
        self.connection_id = callback.connection_id
        with self.helper.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            connection.scopes = sorted(set(connection.scopes or []) | set(HOME_SCOPES))
            connection.scope_provenance = 'provider'
            browser = session.execute(
                select(models.BrowserSession).where(models.BrowserSession.auth_connection_id == self.connection_id)
            ).scalars().first()
            if browser is None:
                browser = models.BrowserSession(
                    user_id=connection.user_id, workspace_id=connection.workspace_id, auth_connection_id=connection.id)
                session.add(browser)
            session.commit()
            self.browser_session_id = browser.id
            self.user_id = connection.user_id
        self.context = resolve_db_request_auth_context(
            {'db_browser_session_id': self.browser_session_id}, required_scopes=jira_server.ATLASSIAN_SCOPES)
        self.home = FakeHome()
        self.stack.enter_context(patch.object(epm_home, 'urlopen', self.home.urlopen))

    def mutate(self, fn):
        with self.helper.factory() as session:
            fn(session)
            session.commit()

    def rotate_token_version(self):
        self.mutate(lambda s: s.execute(update(models.AuthConnection).where(
            models.AuthConnection.id == self.connection_id).values(token_version=models.AuthConnection.token_version + 1)))

    def snapshot(self, **kwargs):
        return HomeReadAuth(
            epm_home.HOME_READ_PROFILE_PUBLIC_READ_V1,
            self.context,
            revalidate=lambda captured: revalidate_db_request_auth_context(
                captured, required_scopes=jira_server.ATLASSIAN_SCOPES),
            load_session=jira_server.db_oauth_session_data_for_auth_context,
            **kwargs,
        )

    def counter(self):
        return SqlCounter(self.database_url)

    SCOPE = {'rootGoalKey': '', 'subGoalKeys': ['SUB-1']}


class RevalidateDbContextTests(DbStrictCase):
    def test_returns_the_current_context_with_one_direct_select(self):
        with self.counter() as sql:
            current = revalidate_db_request_auth_context(self.context, required_scopes=jira_server.ATLASSIAN_SCOPES)
        self.assertEqual(len(sql.selects), 1, sql.statements)
        self.assertEqual(current.token_version, self.context.token_version)
        self.assertEqual(current.browser_session_id, self.browser_session_id)

    def test_token_rotation_with_valid_authority_returns_the_new_version(self):
        self.rotate_token_version()
        current = revalidate_db_request_auth_context(self.context)
        self.assertNotEqual(current.token_version, self.context.token_version)

    def test_a_warm_status_cache_cannot_authorize_a_user_disabled_by_another_process(self):
        resolve_db_request_auth_context({'db_browser_session_id': self.browser_session_id})  # warms _STATUS_CACHE
        self.mutate(lambda s: s.execute(update(models.User).where(models.User.id == self.user_id).values(status='disabled')))
        # The guard-style resolver still trusts its 30 s cache; the direct check must not.
        resolve_db_request_auth_context({'db_browser_session_id': self.browser_session_id})
        with self.assertRaises(AuthError) as raised:
            revalidate_db_request_auth_context(self.context)
        self.assertEqual(raised.exception.code, 'account_disabled')

    def test_a_revoked_connection_fails_closed(self):
        resolve_db_request_auth_context({'db_browser_session_id': self.browser_session_id})
        self.mutate(lambda s: s.execute(update(models.AuthConnection).where(
            models.AuthConnection.id == self.connection_id).values(status='revoked')))
        with self.assertRaises(AuthError) as raised:
            revalidate_db_request_auth_context(self.context)
        self.assertEqual(raised.exception.code, 'auth_connection_revoked')

    def test_an_empty_or_deleted_browser_session_is_never_authorized(self):
        import dataclasses
        with self.assertRaises(AuthError) as raised:
            revalidate_db_request_auth_context(dataclasses.replace(self.context, browser_session_id=''))
        self.assertEqual(raised.exception.code, 'auth_required')
        self.mutate(lambda s: s.execute(models.BrowserSession.__table__.delete()))
        with self.assertRaises(AuthError) as raised:
            revalidate_db_request_auth_context(self.context)
        self.assertEqual(raised.exception.code, 'auth_required')

    def test_missing_or_narrowed_scopes_fail_closed(self):
        with self.assertRaises(AuthError) as raised:
            revalidate_db_request_auth_context(self.context, required_scopes='read:nothing:granted')
        self.assertEqual(raised.exception.code, 'missing_oauth_scope')
        self.mutate(lambda s: s.execute(update(models.AuthConnection).where(
            models.AuthConnection.id == self.connection_id).values(scopes=['read:jira-work'])))
        with self.assertRaises(AuthError) as raised:
            revalidate_db_request_auth_context(self.context)
        self.assertEqual(raised.exception.code, 'missing_oauth_scope')

    def test_unverified_scope_provenance_fails_closed(self):
        self.mutate(lambda s: s.execute(update(models.AuthConnection).where(
            models.AuthConnection.id == self.connection_id).values(scope_provenance='unknown')))
        with self.assertRaises(AuthError):
            revalidate_db_request_auth_context(self.context)

    def test_a_context_for_another_cloud_or_actor_does_not_match(self):
        import dataclasses
        for field, value in (('cloud_id', 'other-cloud'), ('user_id', 'other-user'), ('workspace_id', 'other-ws'),
                             ('auth_connection_id', 'other-connection'), ('site_url', 'https://other.invalid')):
            with self.subTest(field=field), self.assertRaises(AuthError):
                revalidate_db_request_auth_context(dataclasses.replace(self.context, **{field: value}))

    def test_a_database_failure_is_not_swallowed_into_a_legacy_context(self):
        with patch.object(db_engine, 'session_factory', side_effect=OperationalError('x', {}, Exception('down'))):
            with self.assertRaises(OperationalError):
                revalidate_db_request_auth_context(self.context)

    def test_the_status_cache_is_not_consulted(self):
        with patch.object(db_context, '_status_for', side_effect=AssertionError('status cache used')):
            revalidate_db_request_auth_context(self.context)


class LeaseTests(DbStrictCase):
    """Home reads cost lease windows, not pages, and not workers."""

    def fetch(self, snapshot):
        return epm_home.fetch_epm_home_projects(self.SCOPE, home_auth=snapshot)

    def test_sql_does_not_grow_with_the_number_of_home_pages_inside_a_lease(self):
        measured = {}
        for pages in (1, 12):
            self.home.project_pages, self.home.calls = pages, []
            epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
            snapshot = self.snapshot(monotonic=FakeClock())
            with self.counter() as sql:
                projects = self.fetch(snapshot)
            self.assertEqual(len(projects), pages)
            measured[pages] = (len(sql.statements), len(sql.selects), snapshot.revalidation_count, snapshot.token_load_count)
            self.assertGreaterEqual(len([c for c in self.home.calls if c[0] == 'GoalProjects']), pages)
        self.assertEqual(measured[1], measured[12], measured)
        self.assertEqual(measured[12][2:], (1, 1))  # one direct validation and one token load for the whole read
        print(f'\nlease SQL (1 page vs 12 pages): {measured}')

    def test_validations_grow_with_lease_windows_not_pages(self):
        clock = FakeClock()
        snapshot = self.snapshot(monotonic=clock)
        self.home.project_pages = 40
        self.home.hooks.append(lambda operation, count: clock.advance(1.0) if operation == 'GoalProjects' else None)
        with self.counter() as sql:
            self.assertEqual(len(self.fetch(snapshot)), 40)
        windows = 40 // epm_home.HOME_AUTH_LEASE_SECONDS  # ~1 s per page, 40 s of reading
        self.assertEqual(snapshot.revalidation_count, windows, snapshot.revalidation_count)  # one per lapsed window
        print(f'\nlease windows over 40 pages / 40 s: {snapshot.revalidation_count} validations, {len(sql.selects)} SELECTs')

    def test_workers_sharing_the_snapshot_do_not_multiply_validation(self):
        snapshot = self.snapshot(monotonic=FakeClock())
        snapshot.revalidate()
        with self.counter() as sql:
            threads = [threading.Thread(target=lambda: [snapshot.lease() for _ in range(25)]) for _ in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        self.assertEqual(sql.statements, [])
        self.assertEqual(snapshot.revalidation_count, 1)

    def test_a_lapsed_lease_revalidates_once_for_all_workers(self):
        clock = FakeClock()
        snapshot = self.snapshot(monotonic=clock)
        snapshot.revalidate()
        clock.advance(epm_home.HOME_AUTH_LEASE_SECONDS)
        threads = [threading.Thread(target=snapshot.lease) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(snapshot.revalidation_count, 2)

    def test_a_user_disabled_mid_read_stops_the_read_at_the_next_lease_window(self):
        clock = FakeClock()
        snapshot = self.snapshot(monotonic=clock)
        self.home.project_pages = 6

        def disable_then_lapse(operation, count):
            if operation == 'GoalProjects' and count > 4:
                self.mutate(lambda s: s.execute(update(models.User).where(models.User.id == self.user_id).values(status='disabled')))
                clock.advance(epm_home.HOME_AUTH_LEASE_SECONDS)

        self.home.hooks.append(disable_then_lapse)
        with self.assertRaises(AuthError) as raised:
            self.fetch(snapshot)
        self.assertEqual(raised.exception.code, 'account_disabled')


class TokenHandlingTests(DbStrictCase):
    def test_a_rotated_token_version_is_reloaded_without_a_401_and_the_new_token_is_used(self):
        versions = iter(range(1, 50))
        loaded = []

        def load_session(context):
            version = str(context.token_version)
            loaded.append(version)
            return {'access_token': f'tok-v{version}', 'expires_at': int(time.time()) + 3600, 'scope': ' '.join(HOME_SCOPES),
                    'scope_provenance': 'provider', 'db_token_version': version}

        clock = FakeClock()
        snapshot = HomeReadAuth(
            epm_home.HOME_READ_PROFILE_PUBLIC_READ_V1, self.context,
            revalidate=lambda c: revalidate_db_request_auth_context(c), load_session=load_session, monotonic=clock)
        self.home.project_pages = 4

        def rotate(operation, count):
            if operation == 'GoalProjects' and count == 3:
                self.rotate_token_version()
                clock.advance(epm_home.HOME_AUTH_LEASE_SECONDS)

        self.home.hooks.append(rotate)
        projects = epm_home.fetch_epm_home_projects(self.SCOPE, home_auth=snapshot)
        self.assertEqual(len(projects), 4)
        bearers = [bearer for operation, bearer in self.home.calls if operation == 'GoalProjects']
        self.assertEqual(bearers[0], f'Bearer tok-v{self.context.token_version}')
        self.assertEqual(bearers[-1], f'Bearer tok-v{int(self.context.token_version) + 1}')
        self.assertEqual(len(loaded), 2)

    def test_a_token_inside_the_sixty_second_buffer_is_reloaded_through_the_loader(self):
        calls = []

        def load_session(context):
            calls.append(1)
            return {'access_token': 'tok', 'expires_at': int(time.time()) + 30, 'scope': ' '.join(HOME_SCOPES),
                    'scope_provenance': 'provider', 'db_token_version': str(context.token_version)}

        snapshot = HomeReadAuth(epm_home.HOME_READ_PROFILE_PUBLIC_READ_V1, self.context,
                                revalidate=lambda c: revalidate_db_request_auth_context(c), load_session=load_session)
        snapshot.access_token()
        snapshot.access_token()
        self.assertEqual(len(calls), 2)

    def test_scopes_are_verified_after_the_loader_refreshed(self):
        def load_session(context):
            return {'access_token': 'tok', 'expires_at': int(time.time()) + 3600, 'scope': 'read:jira-work',
                    'scope_provenance': 'provider', 'db_token_version': str(context.token_version)}

        snapshot = HomeReadAuth(epm_home.HOME_READ_PROFILE_PUBLIC_READ_V1, self.context,
                                revalidate=lambda c: revalidate_db_request_auth_context(c), load_session=load_session)
        with self.assertRaises(AuthError) as raised:
            snapshot.access_token()
        self.assertEqual(raised.exception.code, 'epm_scope_required')

    def test_the_real_encrypted_token_loader_supplies_the_bearer_and_no_db_session_is_held_during_home_io(self):
        snapshot = self.snapshot()
        seen = []
        factory_calls = []
        original = db_engine.session_factory

        class Tracking:
            open = 0

        def check_no_open_session(operation, count):
            seen.append(Tracking.open)

        self.home.hooks.append(check_no_open_session)
        real_factory = jira_server.session_scope

        @contextmanager
        def tracked_scope(*args, **kwargs):
            Tracking.open += 1
            try:
                with real_factory(*args, **kwargs) as session:
                    yield session
            finally:
                Tracking.open -= 1

        with patch.object(jira_server, 'session_scope', tracked_scope):
            epm_home.fetch_epm_home_projects(self.SCOPE, home_auth=snapshot)
        self.assertTrue(seen)
        self.assertEqual(set(seen), {0})
        self.assertTrue(all(bearer.startswith('Bearer ') and len(bearer) > 10 for _, bearer in self.home.calls))


class CloudIdTests(DbStrictCase):
    def test_the_context_cloud_id_is_used_with_no_tenant_info_and_no_cache_entry(self):
        snapshot = self.snapshot()
        with patch.object(epm_home, 'Request', side_effect=AssertionError('no tenant_info HTTP')):
            self.assertEqual(epm_home.fetch_home_site_cloud_id(home_auth=snapshot), self.context.cloud_id)
        self.assertEqual(epm_home._CLOUD_ID_CACHE, {})

    def test_an_empty_cloud_id_is_rejected(self):
        import dataclasses
        empty = dataclasses.replace(self.context, cloud_id='')
        snapshot = HomeReadAuth(epm_home.HOME_READ_PROFILE_PUBLIC_READ_V1, empty, revalidate=lambda c: c)
        with self.assertRaises(HomeReadError) as raised:
            snapshot.cloud_id()
        self.assertEqual(raised.exception.category, 'invalid_target')
        self.assertEqual(epm_home._CLOUD_ID_CACHE, {})

    def test_the_server_wrapper_never_calls_tenant_info_for_the_strict_profile(self):
        snapshot = self.snapshot()
        with patch.object(epm_home, 'Request', side_effect=AssertionError('no tenant_info HTTP')):
            self.assertEqual(jira_server.fetch_home_site_cloud_id(self.context, home_auth=snapshot), self.context.cloud_id)

    def test_goal_catalog_and_sub_goal_readers_use_the_snapshot_client(self):
        snapshot = self.snapshot()
        goals = jira_server.fetch_epm_goal_catalog(self.context, home_auth=snapshot)
        self.assertEqual([goal['key'] for goal in goals], ['SUB-1'])
        self.assertEqual(jira_server.fetch_epm_sub_goals('ROOT-1', self.context, home_auth=snapshot), [])
        self.assertEqual(epm_home._CLOUD_ID_CACHE, {})
        self.assertTrue(all(bearer.startswith('Bearer ') for _, bearer in self.home.calls))


class StrictGoalLookupCacheTests(unittest.TestCase):
    def setUp(self):
        epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
        self.addCleanup(epm_home._STRICT_GOAL_LOOKUP_CACHE.clear)

    @staticmethod
    def key(partition, name):
        return (partition, 'conn', 'cloud', '1', '', name)

    def test_bounds_are_512_entries_and_300_seconds(self):
        self.assertEqual(epm_home.GOAL_LOOKUP_CACHE_MAX_ENTRIES, 512)
        self.assertEqual(epm_home.GOAL_LOOKUP_CACHE_TTL_SECONDS, 300)
        for index in range(700):
            epm_home._strict_goal_lookup_put(self.key('ws', f'g{index}'), {'key': f'G{index}'})
        self.assertEqual(len(epm_home._STRICT_GOAL_LOOKUP_CACHE), 512)
        self.assertIsNone(epm_home._strict_goal_lookup_get(self.key('ws', 'g0')))
        self.assertEqual(epm_home._strict_goal_lookup_get(self.key('ws', 'g699'))['key'], 'G699')

    def test_entries_expire_after_the_ttl(self):
        key = self.key('ws', 'g')
        with patch.object(epm_home.time, 'time', return_value=1000.0):
            epm_home._strict_goal_lookup_put(key, {'key': 'G'})
        with patch.object(epm_home.time, 'time', return_value=1299.0):
            self.assertIsNotNone(epm_home._strict_goal_lookup_get(key))
        with patch.object(epm_home.time, 'time', return_value=1301.0):
            self.assertIsNone(epm_home._strict_goal_lookup_get(key))
        self.assertEqual(epm_home._STRICT_GOAL_LOOKUP_CACHE, {})

    def test_eviction_takes_the_inserting_partition_first_and_keeps_other_partitions(self):
        for index in range(100):
            epm_home._strict_goal_lookup_put(self.key('other', f'o{index}'), {'key': 'O'})
        for index in range(600):
            epm_home._strict_goal_lookup_put(self.key('mine', f'm{index}'), {'key': 'M'})
        partitions = {}
        for key in epm_home._STRICT_GOAL_LOOKUP_CACHE:
            partitions[key[0]] = partitions.get(key[0], 0) + 1
        self.assertEqual(partitions['other'], 100)
        self.assertEqual(partitions['mine'], 412)

    def test_keys_stay_partitioned_by_identity_and_token_version(self):
        a, b = self.key('ws', 'same'), ('ws', 'conn', 'cloud', '2', '', 'same')
        epm_home._strict_goal_lookup_put(a, {'key': 'A'})
        self.assertIsNone(epm_home._strict_goal_lookup_get(b))

    def test_resolve_goal_by_key_uses_only_the_bounded_cache_for_strict_clients(self):
        home = FakeHome()
        client = epm_home.build_home_oauth_graphql_client('fixture-token')
        context = jira_server.RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s', workspace_id='w',
            auth_connection_id='c', cloud_id='cloud', site_url='https://example.invalid', token_version='1',
            account_status='active', is_admin=False)
        epm_home._GOAL_BY_KEY_CACHE.clear()
        with patch.object(epm_home, 'urlopen', home.urlopen):
            first = epm_home.resolve_goal_by_key(client, 'sub-1', 'ari:cloud:townsquare::site/cloud', context=context)
            second = epm_home.resolve_goal_by_key(client, 'SUB-1', 'ari:cloud:townsquare::site/cloud', context=context)
        self.assertEqual(first, second)
        self.assertEqual([op for op, _ in home.calls], ['GoalByKey'])
        self.assertEqual(len(epm_home._STRICT_GOAL_LOOKUP_CACHE), 1)
        self.assertEqual(epm_home._GOAL_BY_KEY_CACHE, {})


class ProfileSelectionTests(unittest.TestCase):
    def ctx(self, **overrides):
        values = dict(auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s',
                      workspace_id='w', auth_connection_id='conn-1', cloud_id='c', site_url='https://example.invalid',
                      token_version='1', account_status='active', is_admin=False, granted_scopes=tuple(HOME_SCOPES),
                      granted_scopes_verified=True)
        values.update(overrides)
        return jira_server.RequestAuthContext(**values)

    def test_public_read_requires_db_oauth_and_every_verified_home_scope(self):
        select = epm_home.select_epm_home_read_profile
        self.assertEqual(select(self.ctx()), 'public-read-v1')
        self.assertEqual(select(self.ctx(granted_scopes=tuple(HOME_SCOPES[:3]))), 'legacy')
        self.assertEqual(select(self.ctx(granted_scopes_verified=False)), 'legacy')
        self.assertEqual(select(self.ctx(auth_connection_id='local-oauth-connection:x')), 'legacy')
        self.assertEqual(select(self.ctx(auth_mode='basic')), 'legacy')
        self.assertEqual(select(None), 'legacy')

    def test_a_legacy_snapshot_does_no_io(self):
        snapshot = HomeReadAuth('legacy', self.ctx())
        self.assertIs(snapshot.lease(), snapshot.context)
        self.assertIs(snapshot.revalidate(), snapshot.context)
        self.assertEqual(snapshot.revalidation_count, 0)


class CacheAdmissionTests(unittest.TestCase):
    """build_epm_home_projects_state against a controllable snapshot: force-validate before use and admission."""

    def setUp(self):
        self.versions = ['1']
        self.fail_on = None
        self.calls = 0
        base = jira_server.RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s', workspace_id='w',
            auth_connection_id='conn-1', cloud_id='c', site_url='https://example.invalid', token_version='1',
            account_status='active', is_admin=False, granted_scopes=tuple(HOME_SCOPES), granted_scopes_verified=True,
            browser_session_id='b')

        def revalidate(context):
            self.calls += 1
            if self.fail_on is not None and self.calls >= self.fail_on:
                raise AuthError('account_disabled', 'disabled')
            import dataclasses
            return dataclasses.replace(context, token_version=self.versions[-1])

        self.snapshot = HomeReadAuth('public-read-v1', base, revalidate=revalidate)
        self.cache = {}
        self.fetches = 0

    def deps(self):
        def fetch(_scope):
            self.fetches += 1
            if self.on_fetch:
                self.on_fetch()
            return [{'homeProjectId': 'p1'}]
        return epm_projects.EpmProjectsDependencies(
            fetch_epm_home_projects=fetch, merge_epm_linkage=None, normalize_epm_config=None,
            utc_now_iso=lambda timespec=None: '2026-01-01T00:00:00+00:00', cache=self.cache,
            cache_lock=threading.Lock(), cache_ttl_seconds=300, home_project_limit=500,
            context=self.snapshot.context, config_generation='gen', home_auth=self.snapshot)

    on_fetch = None
    SCOPE = {'rootGoalKey': '', 'subGoalKeys': ['SUB-1']}

    def test_initial_cache_use_forces_a_direct_validation_even_on_a_hit(self):
        epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())
        before = self.calls
        state = epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())
        self.assertTrue(state['cacheHit'])
        self.assertEqual(self.calls, before + 1)

    def test_a_disabled_actor_cannot_read_a_warm_cache(self):
        epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())
        self.fail_on = self.calls + 1
        with self.assertRaises(AuthError):
            epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())

    def test_admission_is_rejected_when_authority_fails_during_the_fetch(self):
        self.fail_on = 2  # lookup passes, the admission check fails
        with self.assertRaises(AuthError):
            epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())
        self.assertEqual(self.cache, {})

    def test_rotation_during_the_fetch_admits_under_the_last_revalidated_version(self):
        self.on_fetch = lambda: self.versions.append('2')
        epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())
        (key,) = self.cache
        self.assertIn('2', key)
        self.assertNotIn('1', key[3])
        self.assertIn('public-read-v1', key)  # the profile is one key part

    def test_the_profile_part_is_absent_for_legacy_snapshots(self):
        legacy = HomeReadAuth('legacy', self.snapshot.context)
        deps = self.deps()
        deps.home_auth = legacy
        epm_projects.build_epm_home_projects_state(self.SCOPE, deps)
        (key,) = self.cache
        self.assertNotIn('public-read-v1', key)
        self.assertNotIn('legacy', key)

    def test_the_warmed_index_is_immutable_and_serves_workers_without_validation_or_home_io(self):
        self.snapshot.begin_index()
        epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps())
        self.snapshot.freeze_index()
        calls, fetches = self.calls, self.fetches
        self.versions.append('9')
        results = []
        threads = [threading.Thread(target=lambda: results.append(
            epm_projects.build_epm_home_projects_state(self.SCOPE, self.deps()))) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual((self.calls, self.fetches), (calls, fetches))
        self.assertEqual(len(results), 8)
        self.assertTrue(all(r['homeProjects'] == [{'homeProjectId': 'p1'}] for r in results))
        with self.assertRaises(TypeError):
            self.snapshot._index['x'] = {}
        # the index never answers an unrecorded scope
        self.assertIsNone(self.snapshot.indexed_home_state('other-scope'))


class AggregateIndexTests(unittest.TestCase):
    def test_the_aggregate_freezes_the_index_before_any_worker_starts(self):
        events = []

        class Snapshot:
            strict = True

            def begin_index(self):
                events.append('begin')

            def freeze_index(self):
                events.append('freeze')

        def build_payload(config, tab=None, sub_goal_keys=None):
            events.append('warm')
            return {'projects': [{'id': 'a', 'label': 'l'}]}

        def per_project(project_id, tab, sprint, deps):
            events.append('worker')
            return {'project': {'id': project_id}}, 200, {}

        import logging
        deps = epm_aggregate.EpmAggregateDependencies(
            normalize_epm_text=lambda v: str(v or '').strip(), validate_epm_tab_sprint=lambda t, s: None,
            get_epm_config=lambda: {}, build_epm_projects_payload=build_payload,
            filter_epm_projects_for_tab=lambda projects, tab: projects,
            build_epm_rollup_dependencies=lambda **kw: object(), get_epm_project_payload_identity=lambda p: p['id'],
            build_empty_epm_rollup_payload=lambda p, **kw: {}, build_per_project_rollup=per_project,
            logger=logging.getLogger('x'), home_auth=Snapshot())
        epm_aggregate.build_all_epm_projects_rollup('active', '1', deps)
        self.assertEqual(events, ['begin', 'warm', 'freeze', 'worker'])


class StrictPropagationInventoryTests(unittest.TestCase):
    """Every reachable strict site re-raises typed failures (no empty result, no fallback); Basic keeps its fallback."""

    KINDS = {401: 'auth_rejected', 403: 'access_denied', 'denied': 'access_denied', 429: 'rate_limited'}
    CONTAINER = 'ari:cloud:townsquare::site/cloud-1'

    def setUp(self):
        epm_home._STRICT_GOAL_LOOKUP_CACHE.clear()
        epm_home._GOAL_BY_KEY_CACHE.clear()
        for patcher in (patch.object(epm_home.time, 'sleep'), patch.dict(os.environ, {'ATLASSIAN_EMAIL': '', 'ATLASSIAN_API_TOKEN': ''})):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = epm_home.build_home_oauth_graphql_client('fixture-token')
        self.row = {'id': 'project-1', 'key': 'P-1', 'name': 'P'}

    def sites(self):
        resolve = lambda c: epm_home.resolve_goal_by_key(c, 'SUB-1', self.CONTAINER)
        return {
            'resolve_goal_by_key direct lookup': ('GoalByKey', False, resolve),
            'resolve_goal_by_key search fallback': ('GoalsSearch', True, resolve),
            'fetch_sub_goals': ('SubGoals', False, lambda c: epm_home.fetch_sub_goals(c, 'goal-1')),
            'fetch_projects_for_goal': ('GoalProjects', False, lambda c: epm_home.fetch_projects_for_goal(c, 'goal-1')),
            'fetch_latest_project_update': ('ProjectUpdates', False, lambda c: epm_home.fetch_latest_project_update(c, 'project-1')),
            'fetch_project_tags': ('ProjectTags', False, lambda c: epm_home.fetch_project_tags(c, {'id': 'project-1'})),
        }

    def test_strict_clients_re_raise_each_failure_kind_at_every_site(self):
        for site, (operation, unknown_goal, call) in self.sites().items():
            for failure, category in self.KINDS.items():
                with self.subTest(site=site, failure=failure):
                    home = FakeHome()
                    home.unknown_goal = unknown_goal
                    home.fail_ops = {operation: failure}
                    with patch.object(epm_home, 'urlopen', home.urlopen), self.assertRaises(HomeReadError) as raised:
                        call(self.client)
                    self.assertEqual(raised.exception.category, category)

    def test_a_strict_auth_or_denial_failure_never_triggers_the_search_fallback(self):
        for failure in (401, 403, 429, 'denied'):
            with self.subTest(failure=failure):
                home = FakeHome()
                home.fail_ops = {'GoalByKey': failure}
                with patch.object(epm_home, 'urlopen', home.urlopen), self.assertRaises(HomeReadError):
                    epm_home.resolve_goal_by_key(self.client, 'SUB-1', self.CONTAINER)
                self.assertEqual([op for op, _ in home.calls if op == 'GoalsSearch'], [])

    def test_a_non_enriched_project_row_is_a_typed_failure_in_the_strict_profile(self):
        with self.assertRaises(HomeReadError) as raised:
            epm_home._fetch_or_build_home_project_record(self.client, self.row)
        self.assertEqual(raised.exception.category, 'invalid_response')
        with self.assertRaises(HomeReadError):
            epm_home._fetch_home_project_record(self.client, self.row)

    def test_the_startup_path_propagates_strict_failures_instead_of_returning_an_empty_catalog(self):
        context = jira_server.RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s', workspace_id='w',
            auth_connection_id='conn-1', cloud_id='cloud-1', site_url='https://example.invalid', token_version='1',
            account_status='active', is_admin=False, granted_scopes=tuple(HOME_SCOPES), granted_scopes_verified=True,
            browser_session_id='b')
        load = lambda ctx: {'access_token': 'tok', 'expires_at': int(time.time()) + 3600, 'scope': ' '.join(HOME_SCOPES),
                            'scope_provenance': 'provider', 'db_token_version': '1'}
        for failure in (401, 403, 429, 'denied'):
            with self.subTest(failure=failure):
                home = FakeHome()
                home.fail_with = failure if isinstance(failure, int) else None
                home.fail_ops = {} if isinstance(failure, int) else {'GoalByKey': failure}
                snapshot = HomeReadAuth('public-read-v1', context, revalidate=lambda c: c, load_session=load)
                with patch.object(epm_home, 'urlopen', home.urlopen), self.assertRaises(HomeReadError):
                    epm_home.fetch_epm_home_projects({'rootGoalKey': '', 'subGoalKeys': ['SUB-1']}, home_auth=snapshot)
        # a missing cloud id is a typed failure too, never a logged empty list
        import dataclasses
        snapshot = HomeReadAuth('public-read-v1', dataclasses.replace(context, cloud_id=''), revalidate=lambda c: c, load_session=load)
        with self.assertRaises(HomeReadError):
            epm_home.fetch_epm_home_projects({'rootGoalKey': '', 'subGoalKeys': ['SUB-1']}, home_auth=snapshot)

    def test_a_strict_failure_admits_nothing_to_the_projects_cache(self):
        cache = {}
        calls = {'n': 0}

        def fetch(_scope):
            calls['n'] += 1
            raise HomeReadError('auth_rejected', status=401)

        deps = epm_projects.EpmProjectsDependencies(
            fetch_epm_home_projects=fetch, merge_epm_linkage=None, normalize_epm_config=None,
            utc_now_iso=lambda timespec=None: 'now', cache=cache, cache_lock=threading.Lock(), cache_ttl_seconds=300,
            home_project_limit=500, context=None, home_auth=HomeReadAuth('public-read-v1', jira_server.RequestAuthContext(
                auth_mode='atlassian_oauth', user_id='u', stable_subject='s', atlassian_account_id='s', workspace_id='w',
                auth_connection_id='c', cloud_id='c', site_url='x', token_version='1', account_status='active',
                is_admin=False, granted_scopes=tuple(HOME_SCOPES), granted_scopes_verified=True), revalidate=lambda c: c))
        with self.assertRaises(HomeReadError):
            epm_projects.build_epm_home_projects_state({'subGoalKeys': ['A']}, deps)
        self.assertEqual(cache, {})

    def test_typed_failures_are_not_swallowable_by_the_legacy_catches(self):
        self.assertFalse(issubclass(HomeReadError, (epm_home.HomeGraphQLError, epm_home.HomeRateLimitError,
                                                    epm_home.HomeAuthenticationError, KeyError, RuntimeError)))
        self.assertFalse(issubclass(AuthError, RuntimeError))

    def test_basic_keeps_todays_fallback_at_each_site(self):
        legacy = epm_home.HomeGraphQLClient('basic@example.invalid', 'basic-token')
        expected = {
            'resolve_goal_by_key direct lookup': None, 'resolve_goal_by_key search fallback': None,
            'fetch_sub_goals': [], 'fetch_projects_for_goal': [], 'fetch_latest_project_update': [],
            'fetch_project_tags': None,
        }
        for site, (_operation, _unknown, call) in self.sites().items():
            for code in (401, 403, 429):
                with self.subTest(site=site, status=code):
                    def urlopen(request, timeout=None, code=code):
                        raise HTTPError(request.full_url, code, 'fixture', {}, io.BytesIO(b''))
                    with patch.object(epm_home, 'urlopen', urlopen):
                        result = call(legacy)
                    self.assertEqual(result, expected[site])


class RouteRotationAndAuthorityTests(unittest.TestCase):
    """Real routes through the parity oracle's OAuth candidate: rotation mid-warm / mid-worker, authority loss."""

    SCENARIO = 'rollup_all_active_s101'

    @classmethod
    def setUpClass(cls):
        from tests import test_epm_home_oauth_parity as parity
        cls.parity = parity
        cls.fixture = parity.load_fixture()
        cls.baseline = cls.execute(cls)

    def execute(self, home_hook=None, jira_hook=None, scenario=None):
        parity = self.parity
        state = {'home': 0, 'jira': 0, 'rollup_cache_sizes': [], 'home_operations': []}
        original_handle, original_search = parity.RawHomeServer.handle, parity.RawJiraServer.search

        def handle(server, method, url, headers, body):
            state['home'] += 1
            state['home_operations'].append(json.loads(body).get('operationName'))
            if home_hook:
                home_hook(state['home'])
            return original_handle(server, method, url, headers, body)

        def search(server, payload, **kwargs):
            state['jira'] += 1
            if jira_hook:
                jira_hook(state['jira'])
            state['rollup_cache_sizes'].append(len(jira_server.EPM_ROLLUP_CACHE))
            return original_search(server, payload, **kwargs)

        with patch.object(parity.RawHomeServer, 'handle', handle), patch.object(parity.RawJiraServer, 'search', search):
            run = parity.run_mode('db_oauth_public_read', self.fixture, [scenario or self.SCENARIO])
        return run, state

    @staticmethod
    def bump_version():
        factory = db_engine.session_factory()
        with factory() as session:
            session.execute(update(models.AuthConnection).values(token_version=models.AuthConnection.token_version + 1))
            session.commit()

    @staticmethod
    def disable_user():
        factory = db_engine.session_factory()
        with factory() as session:
            session.execute(update(models.User).values(status='disabled'))
            session.commit()

    def assert_matches_baseline(self, rotated):
        (baseline_run, baseline_state), (run, state) = self.baseline, rotated
        step = run.results[self.SCENARIO]['steps'][0]
        self.assertEqual(step['status'], 200, step['body'])
        outcome = self.parity.compare_run(
            self.parity.assemble_expected(self.fixture, 'db_user_token'), run,
            self.fixture['comparison'], self.parity.compare_candidate)
        self.assertEqual(outcome[self.SCENARIO][:6], [])
        # one Home discovery multiset: rotation never produced another crawl
        self.assertEqual(sorted(state['home_operations']), sorted(baseline_state['home_operations']))
        self.assertEqual(state['jira'], baseline_state['jira'])

    def test_unrotated_baseline_is_a_non_empty_single_crawl(self):
        _run, state = self.baseline
        self.assertTrue(state['home_operations'])
        self.assertEqual(state['home_operations'].count('GoalByKey'), 1)  # the root lookup, once
        self.assertGreater(state['jira'], 3)

    def test_rotation_in_the_middle_of_the_home_warm_is_not_a_401_or_a_second_crawl(self):
        rotated = self.execute(home_hook=lambda n: self.bump_version() if n == 3 else None)
        self.assert_matches_baseline(rotated)

    def test_rotation_in_the_middle_of_the_eight_workers_does_not_recrawl_home(self):
        rotated = self.execute(jira_hook=lambda n: self.bump_version() if n == 2 else None)
        self.assert_matches_baseline(rotated)
        self.assertEqual(rotated[1]['home'], self.baseline[1]['home'])

    def test_rotation_before_every_jira_call_still_one_crawl(self):
        rotated = self.execute(jira_hook=lambda n: self.bump_version())
        self.assert_matches_baseline(rotated)

    def test_loss_of_authority_in_the_workers_returns_no_data_and_admits_no_rollup(self):
        run, state = self.execute(jira_hook=lambda n: self.disable_user() if n == 1 else None)
        step = run.results[self.SCENARIO]['steps'][0]
        self.assertNotEqual(step['status'], 200)
        self.assertNotIn('projects', step['body'] or {})
        self.assertTrue(state['rollup_cache_sizes'])
        self.assertEqual(set(state['rollup_cache_sizes']), {0})
        self.assertEqual(state['home'], self.baseline[1]['home'])  # no replay, no extra Home crawl

    def test_home_failures_never_become_an_empty_success_for_any_read_route(self):
        failures = {401: 'auth_rejected', 403: 'access_denied', 429: 'rate_limited'}
        for scenario in ('scope', 'goals_catalog', 'goals_root_subgoals', 'projects_active', 'rollup_all_active_s101',
                         'rollup_alpha_s101', 'issues_alpha_s101'):
            for code in failures:
                if scenario == 'scope':
                    continue  # the scope route needs no Home I/O for the strict profile (cloud id comes from the context)
                with self.subTest(scenario=scenario, code=code):
                    def fail(n, code=code):
                        raise HTTPError(epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT, code, 'fixture', {}, io.BytesIO(b''))
                    with patch.object(epm_home.time, 'sleep'):
                        run, _state = self.execute(home_hook=fail, scenario=scenario)
                    step = run.results[scenario]['steps'][0]
                    self.assertNotEqual(step['status'], 200, step['body'])
                    body = step['body'] if isinstance(step['body'], dict) else {}
                    self.assertNotIn('goals', body)
                    self.assertNotIn('projects', body)


if __name__ == '__main__':
    unittest.main()
