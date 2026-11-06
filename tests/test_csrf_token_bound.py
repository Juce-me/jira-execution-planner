import base64
import os
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from backend.auth import csrf_store
from backend.db import engine as db_engine
from backend.db import models
import jira_server
from tests.db_oauth_test_helpers import seed_db_actor
from tests.oauth_test_helpers import install_oauth_session
from tests.postgres_test_db import fresh_database_url


class CsrfTokenBoundTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.database_url = fresh_database_url(self.addCleanup)
        environment = self._env_patch()
        environment.start()
        self.addCleanup(environment.stop)
        auth_mode = patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth')
        auth_mode.start()
        self.addCleanup(auth_mode.stop)
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.client = jira_server.app.test_client()
        self.other_client = jira_server.app.test_client()
        self.workspace_id, self.admin_user_id, self.admin_connection_id = self._seed_user(
            account_id='admin-account',
            account_type='admin',
        )
        _, self.normal_user_id, _ = self._seed_user(
            account_id='normal-account',
            account_type='user',
        )

    def tearDown(self):
        db_engine.dispose_engines()

    def _seed_user(self, *, account_id, account_type):
        with self.factory() as session:
            actor = seed_db_actor(session,
                workspace={'cloud_id': 'cloud-123', 'site_url': 'https://example.atlassian.net'},
                account_identity=account_id,
                roles=('admin',) if account_type == 'admin' else ())
            session.commit()
            return actor.workspace_id, actor.user_id, actor.connection_id

    def _install_session(self, client, *, session_id, account_id, connection_id):
        install_oauth_session(client, db_auth_connection_id=connection_id)

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([15]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }, clear=False)

    def _issue_token(self, client=None):
        target = client or self.client
        response = target.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        token = response.get_json()['csrfToken']
        self.assertNotIn('access-123', token)
        self.assertNotIn('refresh-123', token)
        return token

    def _patch_status(self, token=None, client=None):
        headers = {'X-Requested-With': 'jira-execution-planner'}
        if token is not None:
            headers['X-CSRF-Token'] = token
        return (client or self.client).patch(
            f'/api/admin/users/{self.normal_user_id}/status',
            json={'status': 'disabled'},
            headers=headers,
        )

    def test_missing_wrong_reused_and_cross_session_tokens_are_rejected(self):
        self._install_session(
            self.client,
            session_id='session-admin',
            account_id='admin-account',
            connection_id=self.admin_connection_id,
        )
        self._install_session(
            self.other_client,
            session_id='session-admin-other',
            account_id='admin-account',
            connection_id=self.admin_connection_id,
        )

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            self.assertEqual(self._patch_status().status_code, 403)
            wrong = self._patch_status(token='wrong-token')
            self.assertEqual(wrong.status_code, 403)
            token = self._issue_token()
            cross_session = self._patch_status(token=token, client=self.other_client)
            self.assertEqual(cross_session.status_code, 403)

            valid = self._patch_status(token=token)
            self.assertEqual(valid.status_code, 200, valid.get_data(as_text=True))
            reused = self._patch_status(token=token)
            self.assertEqual(reused.status_code, 403)

        with self.factory() as session:
            user = session.get(models.User, self.normal_user_id)
        self.assertEqual(user.status, 'disabled')
        self.assertEqual(wrong.get_json()['error'], 'csrf_required')
        self.assertEqual(cross_session.get_json()['error'], 'csrf_required')
        self.assertEqual(reused.get_json()['error'], 'csrf_required')

    def test_token_rotation_preserves_csrf_but_browser_replacement_invalidates_it(self):
        self._install_session(self.client, session_id='rotating-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.admin_connection_id)
            connection.token_version += 1
            session.commit()
        accepted = self._patch_status(token=token)
        self.assertEqual(accepted.status_code, 200, accepted.get_data(as_text=True))
        browser_bound_token = self._issue_token()
        self._install_session(self.client, session_id='replacement-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        rejected = self._patch_status(token=browser_bound_token)
        self.assertEqual(rejected.status_code, 403, rejected.get_data(as_text=True))
        self.assertEqual(rejected.get_json()['error'], 'csrf_required')
        fresh = self._patch_status(token=self._issue_token())
        self.assertEqual(fresh.status_code, 200, fresh.get_data(as_text=True))

    def test_db_oauth_csrf_succeeds_without_local_oauth_session(self):
        self._install_session(self.client, session_id='opaque-only',
                              account_id='admin-account', connection_id=self.admin_connection_id)

        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            response = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIn('csrfToken', response.get_json())

    def test_concurrent_issuance_preserves_both_single_use_browser_tokens(self):
        self._install_session(self.client, session_id='concurrent-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        original = self.client.get_cookie('session')
        first = jira_server.app.test_client()
        second = jira_server.app.test_client()
        # Both requests start with the same opaque browser cookie, before either
        # response arrives. All cookie/token values remain synthetic and in memory.
        for client in (first, second):
            client.set_cookie('session', original.value)
        first_token = self._issue_token(first)
        second_token = self._issue_token(second)
        # The later Set-Cookie is the browser's final state. The earlier issued
        # token must still authorize its own pending request, just like the later one.
        latest = second.get_cookie('session')
        self.client.set_cookie('session', latest.value)
        earlier_write = self._patch_status(token=first_token)
        self.assertEqual(earlier_write.status_code, 200,
                         'A concurrent CSRF issuance discarded another valid browser token.')
        later_write = self._patch_status(token=second_token)
        self.assertEqual(later_write.status_code, 200)
        self.assertEqual(self._patch_status(token=first_token).status_code, 403)
        self.assertEqual(self._patch_status(token=second_token).status_code, 403)


    # Server-side token state (Task 0.1B): the cookie carries no CSRF hashes.

    def _user_status(self):
        with self.factory() as session:
            return session.get(models.User, self.normal_user_id).status

    def _token_count(self):
        with self.factory() as session:
            return session.scalar(select(func.count()).select_from(models.BrowserCsrfToken))

    def test_issuance_requires_requested_with_and_keeps_hashes_out_of_the_cookie(self):
        self._install_session(self.client, session_id='header-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        bare = self.client.get('/api/auth/csrf')
        self.assertEqual(bare.status_code, 403, bare.get_data(as_text=True))
        self.assertEqual(bare.get_json()['error'], 'csrf_required')
        self.assertEqual(self._token_count(), 0)
        token = self._issue_token()
        with self.client.session_transaction() as flask_session:
            self.assertNotIn('csrf_token_hashes', flask_session)
        with self.factory() as session:
            row = session.execute(select(models.BrowserCsrfToken)).scalar_one()
        self.assertNotIn(token, row.token_hash)
        self.assertEqual(len(row.token_hash), 64)

    def test_consumed_token_cannot_be_replayed_with_an_older_cookie(self):
        self._install_session(self.client, session_id='replay-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()
        before_consumption = self.client.get_cookie('session').value
        self.assertEqual(self._patch_status(token=token).status_code, 200)
        self.client.set_cookie('session', before_consumption)
        replay = self._patch_status(token=token)
        self.assertEqual(replay.status_code, 403, replay.get_data(as_text=True))
        self.assertEqual(replay.get_json()['error'], 'csrf_required')

    def test_concurrent_issuance_cookie_cannot_resurrect_a_consumed_token(self):
        self._install_session(self.client, session_id='resurrect-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        consumed = self._issue_token()
        shared = self.client.get_cookie('session').value
        issuer = jira_server.app.test_client()
        issuer.set_cookie('session', shared)
        self.assertEqual(self._patch_status(token=consumed).status_code, 200)
        self._issue_token(issuer)  # started from the pre-consumption cookie
        self.client.set_cookie('session', issuer.get_cookie('session').value)
        replay = self._patch_status(token=consumed)
        self.assertEqual(replay.status_code, 403, replay.get_data(as_text=True))

    def test_only_the_newest_eight_tokens_stay_valid(self):
        self._install_session(self.client, session_id='prune-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        tokens = [self._issue_token() for _ in range(9)]
        self.assertEqual(self._token_count(), 8)
        evicted = self._patch_status(token=tokens[0])
        self.assertEqual(evicted.status_code, 403, evicted.get_data(as_text=True))
        self.assertEqual(self._patch_status(token=tokens[1]).status_code, 200)

    def test_logout_before_use_requires_sign_in_instead_of_csrf_retry(self):
        self._install_session(self.client, session_id='logout-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()
        with self.factory() as session:
            session.query(models.BrowserSession).delete()
            session.commit()
        self.assertEqual(self._token_count(), 0)  # tokens die with their browser session
        response = self._patch_status(token=token)
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertEqual(self._user_status(), 'active')

    def test_storage_failure_fails_closed_without_dispatching_the_route(self):
        self._install_session(self.client, session_id='storage-browser',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()

        def unavailable(*_args, **_kwargs):
            raise OperationalError('SELECT 1', {}, Exception('synthetic outage'))

        with patch.object(csrf_store, 'session_scope', side_effect=unavailable):
            write = self._patch_status(token=token)
            issued = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
        for response in (write, issued):
            self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['error'], 'config_storage_unavailable')
            self.assertNotIn('synthetic outage', response.get_data(as_text=True))
        self.assertEqual(self._user_status(), 'active')
        self.assertEqual(self._patch_status(token=token).status_code, 200)

    def _locking_engine(self):
        engine = create_engine(self.database_url, poolclass=NullPool)
        self.addCleanup(engine.dispose)
        return engine

    def _wait_until_blocked(self, engine):
        deadline = time.monotonic() + 10
        with engine.connect() as probe:
            while time.monotonic() < deadline:
                waiting = probe.execute(text(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                    "AND wait_event_type = 'Lock'")).scalar()
                if waiting:
                    return
                probe.rollback()
                time.sleep(0.02)
        self.fail('The CSRF request never waited on the held lock.')

    def _in_thread(self, call):
        result = {}
        worker = threading.Thread(target=lambda: result.setdefault('value', call()))
        worker.start()
        self.addCleanup(worker.join, 10)
        return worker, result

    def test_a_token_consumed_concurrently_authorizes_exactly_one_request(self):
        self._install_session(self.client, session_id='race-consume',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()
        engine = self._locking_engine()
        with engine.connect() as holder:
            holder.execute(text('DELETE FROM browser_csrf_tokens'))  # a concurrent consumer, not yet committed
            worker, result = self._in_thread(lambda: self._patch_status(token=token).status_code)
            self._wait_until_blocked(engine)
            holder.commit()
        worker.join(10)
        self.assertEqual(result.get('value'), 403)
        self.assertEqual(self._user_status(), 'active')

    def test_a_concurrent_consumer_that_rolls_back_leaves_the_token_valid(self):
        self._install_session(self.client, session_id='race-rollback',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()
        engine = self._locking_engine()
        with engine.connect() as holder:
            holder.execute(text('DELETE FROM browser_csrf_tokens'))
            worker, result = self._in_thread(lambda: self._patch_status(token=token).status_code)
            self._wait_until_blocked(engine)
            holder.rollback()
        worker.join(10)
        self.assertEqual(result.get('value'), 200)
        self.assertEqual(self._user_status(), 'disabled')

    def test_issuance_waits_for_a_concurrent_issuer_and_both_tokens_survive(self):
        self._install_session(self.client, session_id='race-issue',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        with self.client.session_transaction() as flask_session:
            browser_session_id = flask_session['db_oauth_session']['db_browser_session_id']
        engine = self._locking_engine()
        with engine.connect() as holder:
            holder.execute(text('SELECT pg_advisory_xact_lock(:key)'),
                           {'key': csrf_store.csrf_lock_key(browser_session_id)})
            worker, result = self._in_thread(lambda: self._issue_token())
            self._wait_until_blocked(engine)
            holder.execute(text(
                'INSERT INTO browser_csrf_tokens (token_hash, browser_session_id, created_at) '
                'VALUES (:hash, :sid, clock_timestamp())'), {'hash': 'f' * 64, 'sid': browser_session_id})
            holder.commit()
        worker.join(10)
        self.assertEqual(self._token_count(), 2)
        self.assertEqual(self._patch_status(token=result['value']).status_code, 200)

    def test_lock_timeout_fails_closed_without_dispatch(self):
        self._install_session(self.client, session_id='race-timeout',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()
        engine = self._locking_engine()
        with patch.object(csrf_store, 'CSRF_LOCK_TIMEOUT_MS', 200), engine.connect() as holder:
            holder.execute(text('DELETE FROM browser_csrf_tokens'))
            response = self._patch_status(token=token)
            holder.rollback()
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'config_storage_unavailable')
        self.assertEqual(self._user_status(), 'active')


    def _cached_context(self, client):
        with client.session_transaction() as flask_session:
            payload = dict(flask_session['db_oauth_session'])
        from backend.auth.db_context import resolve_db_request_auth_context
        return resolve_db_request_auth_context(payload)

    def test_consumption_rechecks_actor_and_connection_status_despite_a_warm_status_cache(self):
        for label, column, model_id_attr, code in (
                ('disabled user', 'status', 'admin_user_id', 'account_disabled'),
                ('revoked connection', 'status', 'admin_connection_id', 'auth_connection_revoked')):
            with self.subTest(label=label):
                self._install_session(self.client, session_id=f'status-{code}',
                                      account_id='admin-account', connection_id=self.admin_connection_id)
                token = self._issue_token()
                context = self._cached_context(self.client)  # resolved while still active
                model = models.User if model_id_attr == 'admin_user_id' else models.AuthConnection
                with self.factory() as session:
                    row = session.get(model, getattr(self, model_id_attr))
                    setattr(row, column, 'disabled' if model is models.User else 'revoked')
                    session.commit()
                with self.assertRaises(jira_server.AuthError) as caught:
                    csrf_store.consume_csrf_token(context, token)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(self._token_count(), 1, 'a refused token is not consumed')
                with self.factory() as session:
                    row = session.get(model, getattr(self, model_id_attr))
                    row.status = 'active'
                    session.query(models.BrowserCsrfToken).delete()
                    session.commit()

    def test_pruning_and_consuming_the_same_token_concurrently_have_one_winner(self):
        self._install_session(self.client, session_id='race-prune',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        oldest = self._issue_token()
        tokens = [self._issue_token() for _ in range(7)]
        engine = self._locking_engine()
        with self.factory() as session:
            oldest_hash = session.execute(select(models.BrowserCsrfToken.token_hash)
                                          .order_by(models.BrowserCsrfToken.created_at)).scalars().first()
        with engine.connect() as holder:
            # A consumer of the oldest token, not yet committed; the ninth issuance prunes that same row.
            holder.execute(text('DELETE FROM browser_csrf_tokens WHERE token_hash = :hash'), {'hash': oldest_hash})
            worker, result = self._in_thread(lambda: self._issue_token())
            self._wait_until_blocked(engine)
            holder.commit()
        worker.join(10)
        self.assertEqual(self._token_count(), 8)
        self.assertEqual(self._patch_status(token=oldest).status_code, 403)
        self.assertEqual(self._patch_status(token=result['value']).status_code, 200)
        self.assertEqual(self._token_count(), 7)
        self.assertTrue(all(len(token) > 20 for token in tokens))

    def test_two_tabs_sharing_one_session_can_both_write_concurrently(self):
        self._install_session(self.client, session_id='two-tabs',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        cookie = self.client.get_cookie('session').value
        tabs = [jira_server.app.test_client() for _ in range(2)]
        for tab in tabs:
            tab.set_cookie('session', cookie)
        tokens = [self._issue_token(tab) for tab in tabs]
        start = threading.Barrier(2)
        statuses = []

        def write(tab, token):
            start.wait(5)
            statuses.append(tab.get('/api/auth/status').status_code)
            statuses.append(self._patch_status(token=token, client=tab).status_code)

        workers = [threading.Thread(target=write, args=pair) for pair in zip(tabs, tokens)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(15)
        self.assertEqual(sorted(statuses), [200, 200, 200, 200])
        self.assertEqual(self._token_count(), 0)

    def test_planning_storage_failure_reports_no_commit(self):
        self._install_session(self.client, session_id='planning-storage',
                              account_id='admin-account', connection_id=self.admin_connection_id)
        token = self._issue_token()

        def unavailable(*_args, **_kwargs):
            raise OperationalError('SELECT 1', {}, Exception('synthetic outage'))

        with patch.object(csrf_store, 'session_scope', side_effect=unavailable):
            response = self.client.patch('/api/eng/sprints/101/review', json={}, headers={
                'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertTrue(response.get_json()['noCommit'])
        self.assertNotIn('synthetic outage', response.get_data(as_text=True))


class CsrfSourceGuardTests(unittest.TestCase):
    ROOT = Path(__file__).resolve().parents[1]

    def _python_sources(self):
        for base in ('backend', 'scripts'):
            yield from sorted((self.ROOT / base).rglob('*.py'))
        yield self.ROOT / 'jira_server.py'

    def test_one_policy_issues_and_consumes_tokens(self):
        users = {'consume_csrf_token(': set(), 'issue_csrf_token(': set()}
        for path in self._python_sources():
            source = path.read_text(encoding='utf-8')
            relative = path.relative_to(self.ROOT).as_posix()
            for call in users:
                if call in source:
                    users[call].add(relative)
            self.assertNotRegex(source, r'validate_csrf_token|bind_csrf_token|\[CSRF_SESSION_KEY\]\s*=', relative)
        self.assertEqual(users['consume_csrf_token('], {'backend/auth/csrf_store.py', 'backend/security/guards.py'})
        self.assertEqual(users['issue_csrf_token('], {'backend/auth/csrf_store.py', 'backend/routes/auth_routes.py'})

    def test_consumption_runs_before_dispatch_in_its_own_transaction(self):
        guards = (self.ROOT / 'backend/security/guards.py').read_text(encoding='utf-8')
        body = guards.split('def _require_token_bound_csrf(server):', 1)[1].split('\ndef ', 1)[0]
        self.assertNotIn('session_scope', body)
        self.assertIn('g.security_csrf_validated = True', body)
        store = (self.ROOT / 'backend/auth/csrf_store.py').read_text(encoding='utf-8')
        consume = store.split('def consume_csrf_token(', 1)[1]
        self.assertEqual(consume.count('with session_scope() as db:'), 1)
        for fallback in ('backend/routes/views_routes.py', 'backend/routes/scenario_draft_routes.py', 'jira_server.py'):
            self.assertIn('require_token_bound_csrf_once', (self.ROOT / fallback).read_text(encoding='utf-8'), fallback)


if __name__ == '__main__':
    unittest.main()
