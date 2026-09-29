"""PostgreSQL-only concurrency evidence for workspace catalog publication fences."""

import os
import base64
import unittest
import uuid
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event, Lock
from unittest.mock import patch

from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import make_url

import jira_server
from backend.auth.context import RequestAuthContext
from backend.auth.db_browser_sessions import delete_browser_session
from backend.auth.jira_auth import AuthError
from backend.auth import db_tokens as db_tokens_module
from backend.auth.key_provider import key_provider_from_env
from backend.config.db_repository import DbConfigRepository
from backend.config.shared_config import normalize_workspace_admin_payload
from backend.db import engine as db_engine
from backend.db import models
from backend.routes import settings_routes
from backend.services import workspace_catalog_cache
from backend.services.shared_capacity_config import save_shared_capacity_config
from backend.services.workspace_catalog_cache import (
    claim_catalog_refresh,
    finish_catalog_failure,
    load_sprint_catalog,
    load_sprint_team_catalog,
    publish_catalog,
    release_catalog_refresh,
)
from backend.services.workspace_catalog_config import resolve_effective_catalog_config
from backend.services.catalog_refresh_runtime import CatalogRefreshBudget, CatalogRefreshRuntime
from backend.services.sprint_teams import fetch_sprint_teams
from backend.services.workspace_dashboard_config import (
    load_workspace_team_catalog,
    save_workspace_team_catalog,
    update_workspace_config_section,
    workspace_config_fence_key,
)


class _Budget:
    def remaining(self, _phase):
        return 5

    def check(self, _phase):
        return None


@unittest.skipUnless(
    os.environ.get('REQUIRE_POSTGRES_CATALOG_CONCURRENCY') == '1',
    'PostgreSQL catalog concurrency gate not required',
)
class WorkspaceCatalogPostgresqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database_url = os.environ.get('TEST_DATABASE_URL', '').strip()
        try:
            parsed = make_url(database_url)
        except Exception as error:
            raise AssertionError('TEST_DATABASE_URL must be an explicit PostgreSQL URL') from error
        if parsed.get_backend_name() != 'postgresql':
            raise AssertionError('TEST_DATABASE_URL must be an explicit PostgreSQL URL')
        cls.schema = f'catalog_race_{uuid.uuid4().hex}'
        cls.admin_engine = create_engine(database_url, future=True)
        with cls.admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{cls.schema}"'))
        scoped = parsed.update_query_dict({
            'options': f'-csearch_path={cls.schema} -cstatement_timeout=5000 -clock_timeout=1500',
        })
        cls.database_url = scoped.render_as_string(hide_password=False)
        models.Base.metadata.create_all(db_engine.get_engine(cls.database_url))

    @classmethod
    def tearDownClass(cls):
        db_engine.dispose_engines()
        try:
            with cls.admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{cls.schema}" CASCADE'))
        finally:
            cls.admin_engine.dispose()

    def setUp(self):
        marker = uuid.uuid4().hex
        factory = db_engine.session_factory(self.database_url)
        with factory() as session:
            workspace = models.Workspace(environment_key=f'env-{marker}', name='Synthetic')
            user = models.User(
                id=str(uuid.uuid4()), external_provider='test', external_subject=f'user-{marker}',
            )
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                id=str(uuid.uuid4()), user_id=user.id, workspace_id=workspace.id,
                provider='atlassian_oauth', cloud_id=f'cloud-{marker}',
                site_url='https://synthetic.example.test',
                scopes=['read:jira-work'], scope_provenance='provider',
            )
            session.add(connection)
            session.flush()
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=workspace.id,
                payload={'board': {'boardId': '17'}, 'projects': [{'key': 'DEMO'}]},
                config_revision=1,
            ))
            session.commit()
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id=user.id, stable_subject=user.id,
            atlassian_account_id=user.external_subject, workspace_id=workspace.id,
            auth_connection_id=connection.id, cloud_id=connection.cloud_id,
            site_url='https://synthetic.example.test', token_version='1',
            account_status='active', is_admin=True,
            granted_scopes=('read:jira-work',), granted_scopes_verified=True,
        )
        self.factory = factory
        self.budget = _Budget()
        self.runtime = {
            'jql_query': '', 'jira_board_id': '',
            'team_field_default': 'customfield_10001',
            'sprint_field_default': 'customfield_10002',
        }

    def resolve(self, session, context):
        return resolve_effective_catalog_config(
            session, context, runtime_inputs=self.runtime,
            fallback_loader=None, legacy_site_url='',
        )

    def config(self):
        with self.factory() as session:
            return self.resolve(session, self.context)

    def _hold_workspace_fence(self):
        connection = create_engine(self.database_url, future=True).connect()
        transaction = connection.begin()
        pid = connection.execute(text('SELECT pg_backend_pid()')).scalar_one()
        connection.execute(
            text('SELECT pg_advisory_xact_lock(:key)'),
            {'key': workspace_config_fence_key(self.context.workspace_id)},
        )
        return connection, transaction, pid

    def _wait_for_lock_waiter(self, worker_pid):
        deadline = time.monotonic() + 5
        with self.admin_engine.connect() as observer:
            while time.monotonic() < deadline:
                row = observer.execute(text("""
                    SELECT a.wait_event_type, l.granted
                    FROM pg_stat_activity a
                    JOIN pg_locks l ON l.pid = a.pid AND l.locktype = 'advisory'
                    WHERE a.pid = :pid AND l.granted = false
                """), {'pid': worker_pid}).first()
                if row is not None and row[0] == 'Lock' and row[1] is False:
                    return
                observer.rollback()
                time.sleep(0.01)
        self.fail(f'backend {worker_pid} was not observed waiting on advisory lock')

    def _wait_for_blocked_backend(self, worker_pid, blocker_pid):
        deadline = time.monotonic() + 5
        with self.admin_engine.connect() as observer:
            while time.monotonic() < deadline:
                row = observer.execute(text("""
                    SELECT wait_event_type, pg_blocking_pids(pid)
                    FROM pg_stat_activity
                    WHERE pid = :pid
                """), {'pid': worker_pid}).first()
                if row is not None and row[0] == 'Lock' and blocker_pid in row[1]:
                    return
                observer.rollback()
                time.sleep(0.01)
        self.fail(f'backend {worker_pid} was not observed waiting for backend {blocker_pid}')

    def _fallback_resolve(self, session, context):
        return resolve_effective_catalog_config(
            session,
            context,
            runtime_inputs=self.runtime,
            fallback_loader=lambda: {
                'board': {'boardId': '17'},
                'projects': {'selected': [{'key': 'DEMO'}]},
            },
            legacy_site_url=context.site_url,
        )

    def _reset_first_save_fixture(self):
        with self.factory() as session:
            view_ids = select(models.ViewConfig.id).where(
                models.ViewConfig.workspace_id == self.context.workspace_id,
            )
            session.query(models.ViewConfigVersion).filter(
                models.ViewConfigVersion.view_config_id.in_(view_ids),
            ).delete(synchronize_session=False)
            for model in (
                models.WorkspaceSprintTeamCatalog,
                models.WorkspaceSprintCatalog,
                models.WorkspaceTeamCatalog,
                models.WorkspaceDashboardConfig,
                models.AuditEvent,
                models.ViewConfig,
            ):
                session.query(model).filter_by(
                    workspace_id=self.context.workspace_id,
                ).delete()
            session.add(models.WorkspaceTeamCatalog(
                workspace_id=self.context.workspace_id,
                payload={'catalog': {'kept': {'id': 'kept', 'name': 'Kept'}}, 'meta': {}},
                config_revision=1,
                updated_by=self.context.user_id,
            ))
            session.commit()

    def test_real_wrapper_token_lock_contention_uses_remaining_budget(self):
        key_env = {
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([23]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'catalog-test-key',
        }
        key_provider = key_provider_from_env(key_env)
        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=self.config(),
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.context, claim=seed_claim,
            payload=[{'id': 7, 'name': '2026Q3'}], budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        seeded = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.context.auth_connection_id)
            workspace = session.get(models.Workspace, self.context.workspace_id)
            connection.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db_tokens_module._replace_token(
                session, connection=connection, workspace=workspace,
                token_kind='access_token', plaintext='expired-access',
                key_provider=key_provider,
            )
            db_tokens_module._replace_token(
                session, connection=connection, workspace=workspace,
                token_kind='refresh_token', plaintext='refresh-token',
                key_provider=key_provider,
            )
            session.commit()

        class DeferredExecutor:
            def submit(self, function, *args, **kwargs):
                self.job = lambda: function(*args, **kwargs)
                return object()

            def shutdown(self, **_kwargs):
                return None

        executor = DeferredExecutor()
        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            database_url=self.database_url,
            budget_factory=lambda: CatalogRefreshBudget.start(6),
            executor_factory=lambda **_kwargs: executor,
        )
        blocker_engine = create_engine(self.database_url, future=True)
        blocker = blocker_engine.connect()
        transaction = blocker.begin()
        blocker_pid = blocker.execute(text('SELECT pg_backend_pid()')).scalar_one()
        worker_pid = {}
        worker_lock_started = Event()
        runtime_engine = db_engine.get_engine(self.database_url)

        def capture_worker_pid(connection, _cursor, statement, _params, _context, _many):
            if 'FROM auth_connections' in statement and 'FOR UPDATE' in statement:
                worker_pid['value'] = connection.connection.driver_connection.info.backend_pid
                worker_lock_started.set()

        event.listen(runtime_engine, 'before_cursor_execute', capture_worker_pid)
        try:
            with patch.dict(os.environ, {
                **key_env, 'CONFIG_STORAGE_BACKEND': 'db',
                'DATABASE_URL': self.database_url,
            }, clear=False), \
                    patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                    patch.object(jira_server, 'JIRA_URL', self.context.site_url), \
                    patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('OAuth HTTP must not run')), \
                    patch.object(jira_server.HTTP_SESSION, 'get', side_effect=AssertionError('Jira HTTP must not run')):
                claim = runtime.refresh(
                    self.context, kind='sprints', config=self.config(),
                    background=True, resolve_config=self.resolve,
                )
                blocker.execute(text(
                    'SELECT id FROM auth_connections WHERE id = :id FOR UPDATE'
                ), {'id': self.context.auth_connection_id}).one()
                started_at = time.monotonic()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(executor.job)
                    self.assertTrue(worker_lock_started.wait(2))
                    self._wait_for_blocked_backend(worker_pid['value'], blocker_pid)
                    future.result(timeout=7)
                elapsed = time.monotonic() - started_at
        finally:
            event.remove(runtime_engine, 'before_cursor_execute', capture_worker_pid)
            transaction.rollback()
            blocker.close()
            blocker_engine.dispose()
            runtime.shutdown()

        self.assertIsNotNone(claim)
        snapshot = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )
        self.assertEqual(snapshot.refresh_status, 'failed')
        self.assertEqual(snapshot.failure_code, 'catalog_refresh_lock_timeout')
        self.assertEqual(snapshot.payload, seeded.payload)
        self.assertEqual(snapshot.catalog_version, seeded.catalog_version)
        self.assertGreater(elapsed, 1.0)
        self.assertLess(elapsed, 6.5)

    def test_expired_budget_wins_over_auth_row_lock_timeout(self):
        from backend.services.catalog_refresh_runtime import read_catalog_completion

        key_env = {
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([29]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'catalog-expired-lock-key',
        }
        key_provider = key_provider_from_env(key_env)
        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=self.config(),
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.context, claim=seed_claim,
            payload=[{'id': 7, 'name': '2026Q3'}], budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        seeded = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )
        with self.factory() as session:
            connection = session.get(
                models.AuthConnection, self.context.auth_connection_id,
            )
            workspace = session.get(models.Workspace, self.context.workspace_id)
            connection.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db_tokens_module._replace_token(
                session, connection=connection, workspace=workspace,
                token_kind='access_token', plaintext='expired-access',
                key_provider=key_provider,
            )
            db_tokens_module._replace_token(
                session, connection=connection, workspace=workspace,
                token_kind='refresh_token', plaintext='refresh-token',
                key_provider=key_provider,
            )
            session.commit()

        class DeferredExecutor:
            def submit(self, function, *args, **kwargs):
                self.job = lambda: function(*args, **kwargs)
                return object()

            def shutdown(self, **_kwargs):
                return None

        executor = DeferredExecutor()
        budget_clock = {'now': 0.0}
        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            database_url=self.database_url,
            budget_factory=lambda: CatalogRefreshBudget.start(
                1, now_fn=lambda: budget_clock['now'],
            ),
            executor_factory=lambda **_kwargs: executor,
        )
        blocker_engine = create_engine(self.database_url, future=True)
        blocker = blocker_engine.connect()
        transaction = blocker.begin()
        blocker_pid = blocker.execute(text('SELECT pg_backend_pid()')).scalar_one()
        worker_pid = {}
        worker_lock_started = Event()
        runtime_engine = db_engine.get_engine(self.database_url)

        def capture_worker_pid(connection, _cursor, statement, _params, _context, _many):
            if 'FROM auth_connections' in statement and 'FOR UPDATE' in statement:
                worker_pid['value'] = connection.connection.driver_connection.info.backend_pid
                worker_lock_started.set()

        event.listen(runtime_engine, 'before_cursor_execute', capture_worker_pid)
        try:
            with patch.dict(os.environ, {
                **key_env, 'CONFIG_STORAGE_BACKEND': 'db',
                'DATABASE_URL': self.database_url,
            }, clear=False), \
                    patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                    patch.object(jira_server, 'JIRA_URL', self.context.site_url), \
                    patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('OAuth HTTP must not run')), \
                    patch.object(jira_server.HTTP_SESSION, 'get', side_effect=AssertionError('Jira HTTP must not run')):
                claim = runtime.refresh(
                    self.context, kind='sprints', config=self.config(),
                    background=True, resolve_config=self.resolve,
                )
                blocker.execute(text(
                    'SELECT id FROM auth_connections WHERE id = :id FOR UPDATE'
                ), {'id': self.context.auth_connection_id}).one()
                started_at = time.monotonic()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(executor.job)
                    self.assertTrue(worker_lock_started.wait(2))
                    self._wait_for_blocked_backend(worker_pid['value'], blocker_pid)
                    budget_clock['now'] = 1.1
                    future.result(timeout=3)
                elapsed = time.monotonic() - started_at
        finally:
            event.remove(runtime_engine, 'before_cursor_execute', capture_worker_pid)
            transaction.rollback()
            blocker.close()
            blocker_engine.dispose()
            runtime.shutdown()

        raw = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )
        self.assertEqual(raw.refresh_status, 'pending')
        self.assertEqual(raw.payload, seeded.payload)
        self.assertEqual(raw.catalog_version, seeded.catalog_version)
        completion = read_catalog_completion(
            self.context, kind='sprints', attempt_id=claim.attempt_id,
            expected_identity=claim.identity, resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertEqual(completion.refresh_status, 'failed')
        self.assertEqual(completion.failure_code, 'refresh_budget_exhausted')
        self.assertEqual(completion.payload, seeded.payload)
        self.assertEqual(completion.catalog_version, seeded.catalog_version)
        self.assertGreater(elapsed, 0.5)
        self.assertLess(elapsed, 2.0)

    def test_publication_advisory_fence_timeout_records_catalog_lock_failure(self):
        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=self.config(),
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.context, claim=seed_claim,
            payload=[{'id': 7, 'name': '2026Q3'}], budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        seeded = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )

        class DeferredExecutor:
            def submit(self, function, *args, **kwargs):
                self.job = lambda: function(*args, **kwargs)
                return object()

            def shutdown(self, **_kwargs):
                return None

        executor = DeferredExecutor()
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [{'id': 8, 'name': '2026Q4'}],
            database_url=self.database_url,
            budget_factory=lambda: CatalogRefreshBudget.start(10),
            executor_factory=lambda **_kwargs: executor,
        )
        claim = runtime.refresh(
            self.context, kind='sprints', config=self.config(), background=True,
            resolve_config=self.resolve,
        )
        self.assertIsNotNone(claim)

        blocker_engine = create_engine(self.database_url, future=True)
        blocker = blocker_engine.connect()
        transaction = blocker.begin()
        blocker_pid = blocker.execute(text('SELECT pg_backend_pid()')).scalar_one()
        blocker.execute(
            text('SELECT pg_advisory_xact_lock(:key)'),
            {'key': workspace_config_fence_key(self.context.workspace_id)},
        )
        runtime_engine = db_engine.get_engine(self.database_url)
        worker_pid = {}
        first_wait = Event()
        cleanup_wait = Event()
        observed = {'count': 0}

        def capture_advisory_wait(connection, _cursor, statement, _params, _context, _many):
            if 'pg_advisory_xact_lock' not in statement:
                return
            observed['count'] += 1
            worker_pid['value'] = connection.connection.driver_connection.info.backend_pid
            (first_wait if observed['count'] == 1 else cleanup_wait).set()

        event.listen(runtime_engine, 'before_cursor_execute', capture_advisory_wait)
        started_at = time.monotonic()
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(executor.job)
                self.assertTrue(first_wait.wait(2))
                self._wait_for_blocked_backend(worker_pid['value'], blocker_pid)
                self.assertTrue(cleanup_wait.wait(7))
                transaction.rollback()
                future.result(timeout=3)
            elapsed = time.monotonic() - started_at
        finally:
            event.remove(runtime_engine, 'before_cursor_execute', capture_advisory_wait)
            if transaction.is_active:
                transaction.rollback()
            blocker.close()
            blocker_engine.dispose()
            runtime.shutdown()

        snapshot = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )
        self.assertEqual(snapshot.refresh_status, 'failed')
        self.assertEqual(snapshot.failure_code, 'catalog_refresh_lock_timeout')
        self.assertEqual(snapshot.payload, seeded.payload)
        self.assertEqual(snapshot.catalog_version, seeded.catalog_version)
        self.assertGreater(elapsed, 4.5)
        self.assertLess(elapsed, 10.5)

    def test_elapsed_budget_wins_over_publication_advisory_fence_timeout(self):
        from backend.services.catalog_refresh_runtime import read_catalog_completion

        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=self.config(),
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.context, claim=seed_claim,
            payload=[{'id': 7, 'name': '2026Q3'}], budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        seeded = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )

        class DeferredExecutor:
            def submit(self, function, *args, **kwargs):
                self.job = lambda: function(*args, **kwargs)
                return object()

            def shutdown(self, **_kwargs):
                return None

        executor = DeferredExecutor()
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [{'id': 8, 'name': '2026Q4'}],
            database_url=self.database_url,
            budget_factory=lambda: CatalogRefreshBudget.start(2),
            executor_factory=lambda **_kwargs: executor,
        )
        claim = runtime.refresh(
            self.context, kind='sprints', config=self.config(), background=True,
            resolve_config=self.resolve,
        )
        self.assertIsNotNone(claim)

        blocker_engine = create_engine(self.database_url, future=True)
        blocker = blocker_engine.connect()
        transaction = blocker.begin()
        blocker_pid = blocker.execute(text('SELECT pg_backend_pid()')).scalar_one()
        blocker.execute(
            text('SELECT pg_advisory_xact_lock(:key)'),
            {'key': workspace_config_fence_key(self.context.workspace_id)},
        )
        runtime_engine = db_engine.get_engine(self.database_url)
        worker_pid = {}
        first_wait = Event()
        advisory_attempts = {'count': 0}

        def capture_advisory_wait(connection, _cursor, statement, _params, _context, _many):
            if 'pg_advisory_xact_lock' in statement:
                advisory_attempts['count'] += 1
                worker_pid['value'] = connection.connection.driver_connection.info.backend_pid
                first_wait.set()

        event.listen(runtime_engine, 'before_cursor_execute', capture_advisory_wait)
        started_at = time.monotonic()
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(executor.job)
                self.assertTrue(first_wait.wait(1))
                self._wait_for_blocked_backend(worker_pid['value'], blocker_pid)
                future.result(timeout=4)
            elapsed = time.monotonic() - started_at
        finally:
            event.remove(runtime_engine, 'before_cursor_execute', capture_advisory_wait)
            transaction.rollback()
            blocker.close()
            blocker_engine.dispose()
            runtime.shutdown()

        raw = load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        )
        self.assertEqual(raw.payload, seeded.payload)
        self.assertEqual(raw.catalog_version, seeded.catalog_version)
        self.assertEqual(raw.refresh_status, 'pending')
        completion = read_catalog_completion(
            self.context, kind='sprints', attempt_id=claim.attempt_id,
            expected_identity=claim.identity, resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertEqual(completion.refresh_status, 'failed')
        self.assertEqual(completion.failure_code, 'refresh_budget_exhausted')
        self.assertEqual(completion.payload, seeded.payload)
        self.assertEqual(completion.catalog_version, seeded.catalog_version)
        self.assertEqual(advisory_attempts['count'], 1)
        self.assertGreater(elapsed, 1.0)
        self.assertLess(elapsed, 3.0)

    def _first_save_writer(self, writer_name):
        if writer_name == 'administrator_board':
            return lambda: update_workspace_config_section(
                self.context,
                'board',
                {'boardId': '18'},
                0,
                fallback_loader=lambda: {
                    'board': {'boardId': '17'},
                    'projects': {'selected': [{'key': 'DEMO'}]},
                },
                legacy_site_url=self.context.site_url,
                database_url=self.database_url,
            )
        if writer_name == 'capacity_only':
            return lambda: save_shared_capacity_config(
                self.context,
                {'project': '', 'fieldId': '', 'fieldName': ''},
                0,
                [],
                database_url=self.database_url,
            )
        if writer_name != 'fingerprint_promotion':
            raise AssertionError(f'unknown writer {writer_name}')
        from scripts.promote_legacy_shared_admin_config import _fingerprint, main
        payload = {
            'board': {'boardId': '18'},
            'projects': {'selected': [{'key': 'OTHER'}]},
        }
        payload = normalize_workspace_admin_payload(payload)
        with self.factory() as session:
            user = session.get(models.User, self.context.user_id)
            user.account_type = 'admin'
            view = models.ViewConfig(
                workspace_id=self.context.workspace_id,
                owner_user_id=user.id,
                name='Promotion',
                view_type='mixed',
                payload={},
                is_default=True,
            )
            session.add(view)
            session.flush()
            session.add(models.ViewConfigVersion(
                view_config_id=view.id,
                version_number=1,
                payload=payload,
                created_by=user.id,
                change_note='compatibility save',
            ))
            session.commit()
            view_id = view.id
        args = [
            '--workspace-id', self.context.workspace_id,
            '--view-config-id', view_id,
            '--version-number', '1',
            '--apply',
            '--expected-sha256', _fingerprint(payload),
        ]
        def promote():
            with patch.dict(os.environ, {'DATABASE_URL': self.database_url}, clear=False):
                return main(args)
        return promote

    def claim(self, kind='sprints', sprint_id=None, config=None, owner=None):
        return claim_catalog_refresh(
            self.context, kind=kind, sprint_id=sprint_id,
            expected_config=config or self.config(), owner=owner or str(uuid.uuid4()),
            budget=self.budget, resolve_config=self.resolve, database_url=self.database_url,
        )

    def publish_sprints(self, payload):
        config = self.config()
        claim = self.claim(config=config)
        self.assertTrue(publish_catalog(
            self.context, claim=claim, payload=payload, budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        return config

    def test_fallback_fill_first_save_commits_before_publication_discards(self):
        for writer_name in ('administrator_board', 'capacity_only', 'fingerprint_promotion'):
            with self.subTest(writer=writer_name):
                self._reset_first_save_fixture()
                writer = self._first_save_writer(writer_name)
                with self.factory() as session:
                    config = self._fallback_resolve(session, self.context)
                claim = claim_catalog_refresh(
                    self.context,
                    kind='sprints',
                    expected_config=config,
                    owner=str(uuid.uuid4()),
                    budget=self.budget,
                    resolve_config=self._fallback_resolve,
                    database_url=self.database_url,
                )
                self.assertIsNotNone(claim)
                fetch_held = Event()
                release_fetch = Event()
                state = {}
                def publication_a():
                    fetch_held.set()
                    if not release_fetch.wait(5):
                        raise AssertionError('publication fetch barrier timed out')
                    state['published'] = publish_catalog(
                        self.context,
                        claim=claim,
                        payload=[{'id': '5', 'name': 'Sprint A'}],
                        budget=self.budget,
                        resolve_config=self._fallback_resolve,
                        database_url=self.database_url,
                    )
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(publication_a)
                    try:
                        self.assertTrue(fetch_held.wait(5))
                        writer()
                    finally:
                        release_fetch.set()
                    future.result(timeout=5)
                self.assertFalse(state['published'])
                with self.factory() as session:
                    attempted = session.query(models.WorkspaceSprintCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                        board_id='17',
                    ).one()
                    directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                    ).one()
                    current = self.resolve(session, self.context)
                    self.assertIsNone(attempted.validated_at)
                    self.assertEqual(directory.payload['catalog'], {
                        'kept': {'id': 'kept', 'name': 'Kept'},
                    })
                self.assertNotEqual(current.sprint_identity, claim.identity)
                self.assertIsNone(load_sprint_catalog(
                    self.context,
                    config=current,
                    database_url=self.database_url,
                ).payload)

    def test_first_save_cannot_enter_between_validation_and_publication(self):
        for writer_name in ('administrator_board', 'capacity_only', 'fingerprint_promotion'):
            with self.subTest(writer=writer_name):
                self._reset_first_save_fixture()
                writer = self._first_save_writer(writer_name)
                with self.factory() as session:
                    config = self._fallback_resolve(session, self.context)
                claim = claim_catalog_refresh(
                    self.context,
                    kind='sprints',
                    expected_config=config,
                    owner=str(uuid.uuid4()),
                    budget=self.budget,
                    resolve_config=self._fallback_resolve,
                    database_url=self.database_url,
                )
                publication_validated = Event()
                release_publication = Event()
                writer_entered = Event()
                writer_finished = Event()
                state = {}
                service_engine = db_engine.get_engine(self.database_url)
                def held_resolver(session, context):
                    current = self._fallback_resolve(session, context)
                    state['publication_pid'] = session.execute(
                        text('SELECT pg_backend_pid()')
                    ).scalar_one()
                    publication_validated.set()
                    if not release_publication.wait(5):
                        raise AssertionError('publication validation barrier timed out')
                    return current
                def observe_writer(conn, _cursor, statement, _parameters, _context, _executemany):
                    if 'pg_advisory_xact_lock' in statement:
                        state['writer_pid'] = conn.connection.driver_connection.info.backend_pid
                        writer_entered.set()
                def run_writer():
                    try:
                        state['writer_result'] = writer()
                    finally:
                        writer_finished.set()
                with ThreadPoolExecutor(max_workers=2) as pool:
                    publication_future = pool.submit(
                        publish_catalog,
                        self.context,
                        claim=claim,
                        payload=[{'id': '5', 'name': 'Sprint A'}],
                        budget=self.budget,
                        resolve_config=held_resolver,
                        database_url=self.database_url,
                    )
                    self.assertTrue(publication_validated.wait(5))
                    event.listen(service_engine, 'before_cursor_execute', observe_writer)
                    try:
                        writer_future = pool.submit(run_writer)
                        self.assertTrue(writer_entered.wait(5))
                        self.assertNotEqual(state['publication_pid'], state['writer_pid'])
                        self._wait_for_lock_waiter(state['writer_pid'])
                        self.assertFalse(writer_finished.is_set())
                        with self.factory() as session:
                            self.assertIsNone(session.query(
                                models.WorkspaceDashboardConfig,
                            ).filter_by(workspace_id=self.context.workspace_id).first())
                        release_publication.set()
                        self.assertTrue(publication_future.result(timeout=5))
                        writer_future.result(timeout=5)
                    finally:
                        release_publication.set()
                        event.remove(service_engine, 'before_cursor_execute', observe_writer)
                with self.factory() as session:
                    current = self.resolve(session, self.context)
                    row = session.query(models.WorkspaceSprintCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                        board_id='17',
                    ).one()
                    self.assertEqual(row.sprints, [{'id': '5', 'name': 'Sprint A'}])
                    self.assertIsNotNone(row.validated_at)
                self.assertNotEqual(current.sprint_identity, claim.identity)
                self.assertIsNone(load_sprint_catalog(
                    self.context,
                    config=current,
                    database_url=self.database_url,
                ).payload)

    def test_relevant_config_change_while_fetch_held_discards(self):
        changes = (
            ('board', lambda config: update_workspace_config_section(
                self.context, 'board', {'boardId': '18'}, config.config_revision,
                database_url=self.database_url,
            )),
            ('projects', lambda config: update_workspace_config_section(
                self.context, 'projects', {'selected': [{'key': 'OTHER'}]},
                config.config_revision, database_url=self.database_url,
            )),
            ('team_field', lambda config: update_workspace_config_section(
                self.context, 'teamField',
                {'fieldId': 'customfield_20001', 'fieldName': 'Team'},
                config.config_revision, database_url=self.database_url,
            )),
            ('base_jql', lambda _config: self.runtime.update({
                'jql_query': 'project = "RUNTIME" ORDER BY created DESC',
            })),
        )
        for index, (change_name, apply_change) in enumerate(changes):
            with self.subTest(change=change_name):
                unrelated_version = str(uuid.uuid5(
                    uuid.NAMESPACE_URL, f'unrelated-{index}',
                ))
                config = self.config()
                claim = self.claim(config=config)
                self.assertIsNotNone(claim)
                with self.factory() as session:
                    directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                    ).one_or_none()
                    if directory is None:
                        directory = models.WorkspaceTeamCatalog(
                            workspace_id=self.context.workspace_id,
                            payload={'catalog': {}, 'meta': {}},
                            config_revision=1,
                            updated_by=self.context.user_id,
                        )
                        session.add(directory)
                    directory.payload = {
                        'catalog': {'kept': {'id': 'kept', 'name': 'Kept'}},
                        'meta': {'case': change_name},
                    }
                    unrelated = session.query(models.WorkspaceSprintCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                        board_id=f'900{index}',
                    ).one_or_none()
                    if unrelated is None:
                        session.add(models.WorkspaceSprintCatalog(
                            workspace_id=self.context.workspace_id,
                            board_id=f'900{index}',
                            sprints=[{'id': 'unchanged'}],
                            validated_at=datetime.now(timezone.utc),
                            catalog_version=unrelated_version,
                            updated_by=self.context.user_id,
                        ))
                    session.commit()
                fetch_held = Event()
                release_fetch = Event()
                def publish_after_fetch():
                    fetch_held.set()
                    if not release_fetch.wait(5):
                        raise AssertionError('relevant-change fetch barrier timed out')
                    return publish_catalog(
                        self.context,
                        claim=claim,
                        payload=[{'id': '5'}],
                        budget=self.budget,
                        resolve_config=self.resolve,
                        database_url=self.database_url,
                    )
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(publish_after_fetch)
                    self.assertTrue(fetch_held.wait(5))
                    apply_change(config)
                    release_fetch.set()
                    self.assertFalse(future.result(timeout=5))
                self.assertTrue(release_catalog_refresh(
                    self.context,
                    claim=claim,
                    budget=self.budget,
                    database_url=self.database_url,
                ))
                with self.factory() as session:
                    attempted = session.query(models.WorkspaceSprintCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                        board_id=config.board_id,
                    ).one()
                    directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                    ).one()
                    unrelated = session.query(models.WorkspaceSprintCatalog).filter_by(
                        workspace_id=self.context.workspace_id,
                        board_id=f'900{index}',
                    ).one()
                    self.assertIsNone(attempted.validated_at)
                    self.assertEqual(directory.payload, {
                        'catalog': {'kept': {'id': 'kept', 'name': 'Kept'}},
                        'meta': {'case': change_name},
                    })
                    self.assertEqual(unrelated.sprints, [{'id': 'unchanged'}])
                    self.assertEqual(unrelated.catalog_version, unrelated_version)

    def test_sprint_catalog_removal_prevents_held_team_publication(self):
        config = self.publish_sprints([{'id': '5', 'name': 'Sprint Five'}])
        team_claim = self.claim('teams', '5', config=config)
        fetch_held = Event()
        release_fetch = Event()
        def held_team_publication():
            fetch_held.set()
            if not release_fetch.wait(5):
                raise AssertionError('Team fetch barrier timed out')
            return publish_catalog(
                self.context,
                claim=team_claim,
                payload=[{'id': 'a', 'name': 'Alpha'}],
                budget=self.budget,
                resolve_config=self.resolve,
                database_url=self.database_url,
            )
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(held_team_publication)
            self.assertTrue(fetch_held.wait(5))
            sprint_claim = self.claim(config=config)
            self.assertTrue(publish_catalog(
                self.context, claim=sprint_claim, payload=[], budget=self.budget,
                resolve_config=self.resolve, database_url=self.database_url,
            ))
            release_fetch.set()
            self.assertFalse(future.result(timeout=5))
        snapshot = load_sprint_team_catalog(
            self.context,
            sprint_id='5',
            config=config,
            database_url=self.database_url,
        )
        self.assertIsNone(snapshot.payload)
        self.assertEqual(snapshot.refresh_status, 'failed')
        self.assertEqual(snapshot.failure_code, 'catalog_identity_changed')
        sprint_snapshot = load_sprint_catalog(
            self.context,
            config=config,
            database_url=self.database_url,
        )
        self.assertEqual(sprint_snapshot.payload, [])

    def test_unrelated_config_revision_change_allows_publication(self):
        changes = (
            ('priority', lambda config: update_workspace_config_section(
                self.context,
                'statsPriorityWeights',
                [{'priority': 'P1', 'weight': 3}],
                config.config_revision,
                database_url=self.database_url,
            )),
            ('capacity', lambda config: save_shared_capacity_config(
                self.context,
                {
                    'project': 'CAP',
                    'fieldId': 'customfield_20001',
                    'fieldName': 'Capacity',
                },
                config.config_revision,
                [{
                    'id': 'customfield_20001',
                    'name': 'Capacity',
                    'schema': {'type': 'number'},
                }],
                database_url=self.database_url,
            )),
        )
        for index, (change_name, apply_change) in enumerate(changes):
            with self.subTest(change=change_name):
                config = self.config()
                claim = self.claim(config=config)
                self.assertIsNotNone(claim)
                apply_change(config)
                current = self.config()
                self.assertEqual(current.config_digest, config.config_digest)
                self.assertEqual(current.sprint_identity, config.sprint_identity)
                payload = [{'id': f'allowed-{index}'}]
                self.assertTrue(publish_catalog(
                    self.context,
                    claim=claim,
                    payload=payload,
                    budget=self.budget,
                    resolve_config=self.resolve,
                    database_url=self.database_url,
                ))
                self.assertEqual(load_sprint_catalog(
                    self.context,
                    config=current,
                    database_url=self.database_url,
                ).payload, payload)

    def test_expired_worker_cannot_publish_or_release_new_owner(self):
        config = self.publish_sprints([{'id': 'seed'}])
        first = self.claim()
        self.assertIsNotNone(first)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=self.context.workspace_id, board_id='17',
            ).one()
            row.refresh_lease_until = session.execute(
                text("SELECT clock_timestamp() - interval '1 minute'"),
            ).scalar_one()
            session.commit()
        second = self.claim()
        self.assertIsNotNone(second)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=self.context.workspace_id, board_id='17',
            ).one()
            second_state = (
                row.refresh_lease_owner,
                row.refresh_lease_until,
                row.refresh_attempt_id,
                row.attempt_deadline_at,
                row.catalog_version,
                row.sprints,
                row.refresh_status,
            )
        def assert_second_state_unchanged():
            with self.factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).filter_by(
                    workspace_id=self.context.workspace_id, board_id='17',
                ).one()
                self.assertEqual((
                    row.refresh_lease_owner,
                    row.refresh_lease_until,
                    row.refresh_attempt_id,
                    row.attempt_deadline_at,
                    row.catalog_version,
                    row.sprints,
                    row.refresh_status,
                ), second_state)
        self.assertFalse(publish_catalog(
            self.context, claim=first, payload=[], budget=self.budget,
            resolve_config=self.resolve, database_url=self.database_url,
        ))
        assert_second_state_unchanged()
        self.assertFalse(finish_catalog_failure(
            self.context,
            claim=first,
            failure_code='jira_unavailable',
            budget=self.budget,
            database_url=self.database_url,
        ))
        assert_second_state_unchanged()
        self.assertFalse(release_catalog_refresh(
            self.context, claim=first, budget=self.budget, database_url=self.database_url,
        ))
        assert_second_state_unchanged()
        self.assertTrue(publish_catalog(
            self.context,
            claim=second,
            payload=[{'id': 'winner'}],
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        completed = load_sprint_catalog(
            self.context,
            config=config,
            database_url=self.database_url,
        )
        self.assertEqual(completed.payload, [{'id': 'winner'}])
        self.assertEqual(completed.refresh_status, 'completed')
        self.assertNotEqual(completed.catalog_version, second_state[4])

    def test_first_catalog_claim_has_one_workspace_winner(self):
        with self.factory() as session:
            same_user = models.User(
                id=str(uuid.uuid4()),
                external_provider='test',
                external_subject=f'same-{uuid.uuid4().hex}',
            )
            other_user = models.User(
                id=str(uuid.uuid4()),
                external_provider='test',
                external_subject=f'other-{uuid.uuid4().hex}',
            )
            other_workspace = models.Workspace(
                environment_key=f'other-{uuid.uuid4().hex}',
                name='Other Synthetic',
            )
            session.add_all([same_user, other_user, other_workspace])
            session.flush()
            same_connection = models.AuthConnection(
                id=str(uuid.uuid4()),
                user_id=same_user.id,
                workspace_id=self.context.workspace_id,
                provider='atlassian_oauth',
                cloud_id=self.context.cloud_id,
                site_url=self.context.site_url,
                scopes=['read:jira-work'],
                scope_provenance='provider',
            )
            other_connection = models.AuthConnection(
                id=str(uuid.uuid4()),
                user_id=other_user.id,
                workspace_id=other_workspace.id,
                provider='atlassian_oauth',
                cloud_id=f'cloud-{uuid.uuid4().hex}',
                site_url='https://other.synthetic.example.test',
                scopes=['read:jira-work'],
                scope_provenance='provider',
            )
            session.add_all([
                same_connection,
                other_connection,
                models.WorkspaceDashboardConfig(
                    workspace_id=other_workspace.id,
                    payload={'board': {'boardId': '17'}, 'projects': [{'key': 'DEMO'}]},
                    config_revision=1,
                ),
            ])
            session.commit()
        same_context = RequestAuthContext(
            **{
                **self.context.__dict__,
                'user_id': same_user.id,
                'stable_subject': same_user.id,
                'atlassian_account_id': same_user.external_subject,
                'auth_connection_id': same_connection.id,
            },
        )
        other_context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id=other_user.id,
            stable_subject=other_user.id,
            atlassian_account_id=other_user.external_subject,
            workspace_id=other_workspace.id,
            auth_connection_id=other_connection.id,
            cloud_id=other_connection.cloud_id,
            site_url=other_connection.site_url,
            token_version='1',
            account_status='active',
            is_admin=True,
            granted_scopes=('read:jira-work',),
            granted_scopes_verified=True,
        )
        with self.factory() as session:
            same_config = self.resolve(session, self.context)
            other_config = self.resolve(session, other_context)
        holder, transaction, holder_pid = self._hold_workspace_fence()
        service_engine = db_engine.get_engine(self.database_url)
        current_key = workspace_config_fence_key(self.context.workspace_id)
        other_key = workspace_config_fence_key(other_context.workspace_id)
        lock_pids = {current_key: set(), other_key: set()}
        lock_guard = Lock()
        same_waiters_entered = Event()
        other_claim_entered = Event()
        start = Barrier(3)
        def observe_claims(conn, _cursor, statement, parameters, _context, _executemany):
            if 'pg_advisory_xact_lock' not in statement:
                return
            lock_key = parameters.get('lock_key') if isinstance(parameters, dict) else None
            if lock_key not in lock_pids:
                return
            pid = conn.connection.driver_connection.info.backend_pid
            with lock_guard:
                lock_pids[lock_key].add(pid)
                if len(lock_pids[current_key]) == 2:
                    same_waiters_entered.set()
                if lock_pids[other_key]:
                    other_claim_entered.set()
        def attempt(context, config, owner):
            start.wait(timeout=5)
            return claim_catalog_refresh(
                context,
                kind='sprints',
                expected_config=config,
                owner=owner,
                budget=self.budget,
                resolve_config=self.resolve,
                database_url=self.database_url,
            )
        event.listen(service_engine, 'before_cursor_execute', observe_claims)
        try:
            with ThreadPoolExecutor(max_workers=3) as pool:
                first = pool.submit(attempt, self.context, same_config, str(uuid.uuid4()))
                second = pool.submit(attempt, same_context, same_config, str(uuid.uuid4()))
                independent = pool.submit(
                    attempt, other_context, other_config, str(uuid.uuid4()),
                )
                self.assertTrue(same_waiters_entered.wait(5))
                self.assertTrue(other_claim_entered.wait(5))
                self.assertEqual(len(lock_pids[current_key]), 2)
                self.assertEqual(len(lock_pids[other_key]), 1)
                all_pids = lock_pids[current_key] | lock_pids[other_key]
                self.assertEqual(len(all_pids), 3)
                self.assertNotIn(holder_pid, all_pids)
                for pid in lock_pids[current_key]:
                    self._wait_for_lock_waiter(pid)
                other_claim = independent.result(timeout=5)
                self.assertIsNotNone(other_claim)
                transaction.commit()
                holder.close()
                holder.engine.dispose()
                same_claims = (first.result(timeout=5), second.result(timeout=5))
                self.assertEqual(sum(claim is not None for claim in same_claims), 1)
        finally:
            event.remove(service_engine, 'before_cursor_execute', observe_claims)
            if transaction.is_active:
                transaction.rollback()
            if not holder.closed:
                holder.close()
                holder.engine.dispose()

    def test_two_sprint_publications_and_directory_post_keep_all_names(self):
        config = self.publish_sprints([
            {'id': '5', 'name': 'Sprint Five'},
            {'id': '6', 'name': 'Sprint Six'},
        ])
        settings_routes._sync_server_globals()
        claims = {
            sprint_id: self.claim('teams', sprint_id, config=config)
            for sprint_id in ('5', '6')
        }
        holder, transaction, holder_pid = self._hold_workspace_fence()
        service_engine = db_engine.get_engine(self.database_url)
        waiter_pids = set()
        waiter_lock = Lock()
        all_entered = Event()
        def observe_waiters(conn, _cursor, statement, _parameters, _context, _executemany):
            if 'pg_advisory_xact_lock' not in statement:
                return
            pid = conn.connection.driver_connection.info.backend_pid
            with waiter_lock:
                waiter_pids.add(pid)
                if len(waiter_pids) == 3:
                    all_entered.set()
        def publish_team(sprint_id, team):
            return publish_catalog(
                self.context,
                claim=claims[sprint_id],
                payload=[team],
                budget=self.budget,
                resolve_config=self.resolve,
                database_url=self.database_url,
            )
        def directory_post():
            with jira_server.app.test_request_context('/api/team-catalog', method='POST', json={
                'catalog': {'c': {'id': 'c', 'name': 'Gamma'}},
                'meta': {'source': 'manual'},
                'merge': True,
            }), patch.object(settings_routes, 'config_storage_db_enabled', return_value=True), \
                    patch.object(
                        settings_routes,
                        'db_repository',
                        return_value=DbConfigRepository(database_url=self.database_url),
                    ), patch.object(
                        settings_routes,
                        'current_request_auth_context',
                        return_value=self.context,
                    ):
                response = settings_routes.post_team_catalog()
                return response.status_code, response.get_json()
        event.listen(service_engine, 'before_cursor_execute', observe_waiters)
        try:
            with ThreadPoolExecutor(max_workers=3) as pool:
                futures = (
                    pool.submit(publish_team, '5', {'id': 'a', 'name': 'Alpha'}),
                    pool.submit(publish_team, '6', {'id': 'b', 'name': 'Beta'}),
                    pool.submit(directory_post),
                )
                if not all_entered.wait(5):
                    outcomes = []
                    for future in futures:
                        outcomes.append(
                            repr(future.exception()) if future.done() else 'still running'
                        )
                    self.fail(
                        f'only advisory waiters {sorted(waiter_pids)} entered; '
                        f'worker outcomes: {outcomes}'
                    )
                self.assertEqual(len(waiter_pids), 3)
                self.assertNotIn(holder_pid, waiter_pids)
                for pid in waiter_pids:
                    self._wait_for_lock_waiter(pid)
                transaction.commit()
                holder.close()
                holder.engine.dispose()
                self.assertTrue(futures[0].result(timeout=5))
                self.assertTrue(futures[1].result(timeout=5))
                status, response_payload = futures[2].result(timeout=5)
                self.assertEqual(status, 200)
                self.assertEqual(set(response_payload['catalog']), {'a', 'b', 'c'})
        finally:
            event.remove(service_engine, 'before_cursor_execute', observe_waiters)
            if transaction.is_active:
                transaction.rollback()
            if not holder.closed:
                holder.close()
                holder.engine.dispose()
        with self.factory() as session:
            membership_rows = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
            ).order_by(models.WorkspaceSprintTeamCatalog.sprint_id).all()
            self.assertEqual(
                [(row.sprint_id, row.teams) for row in membership_rows],
                [('5', [{'id': 'a', 'name': 'Alpha'}]), ('6', [{'id': 'b', 'name': 'Beta'}])],
            )
            self.assertTrue(all(row.catalog_version for row in membership_rows))
            self.assertEqual(len({row.catalog_version for row in membership_rows}), 2)
            directory_row = session.query(models.WorkspaceTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
            ).one()
            self.assertEqual(set(directory_row.payload['catalog']), {'a', 'b', 'c'})
            self.assertEqual(directory_row.payload['meta'], {'source': 'manual'})

        failed_claim = self.claim('teams', '5', config=config)
        with self.factory() as session:
            before_membership = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
                sprint_id='5',
            ).one()
            before_payload = before_membership.teams
            before_version = before_membership.catalog_version
            before_directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
            ).one().payload
        real_merge = workspace_catalog_cache.merge_workspace_team_catalog_in_session
        def merge_then_fail(session, context, payload, *, merge):
            real_merge(session, context, payload, merge=merge)
            raise RuntimeError('forced directory merge failure')
        with patch.object(
            workspace_catalog_cache,
            'merge_workspace_team_catalog_in_session',
            side_effect=merge_then_fail,
        ):
            with self.assertRaisesRegex(RuntimeError, 'forced directory merge failure'):
                publish_catalog(
                    self.context,
                    claim=failed_claim,
                    payload=[{'id': 'd', 'name': 'Delta'}],
                    budget=self.budget,
                    resolve_config=self.resolve,
                    database_url=self.database_url,
                )
        with self.factory() as session:
            after_membership = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
                sprint_id='5',
            ).one()
            after_directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
            ).one()
            self.assertEqual(after_membership.teams, before_payload)
            self.assertEqual(after_membership.catalog_version, before_version)
            self.assertEqual(after_directory.payload, before_directory)

    def test_held_team_fetch_reloads_latest_directory_before_atomic_publication(self):
        config = self.publish_sprints([{'id': '5', 'name': 'Sprint Five'}])
        save_workspace_team_catalog(
            self.context,
            {'catalog': {
                'directory': {'id': 'directory', 'name': 'Old directory'},
                'bare': {'id': 'bare', 'name': 'Old bare'},
                'issue': {'id': 'issue', 'name': 'Old issue'},
            }, 'meta': {}},
            database_url=self.database_url,
        )
        claim = self.claim('teams', '5', config=config)
        fetch_started = Event()
        release_fetch = Event()

        def held_search(_payload):
            fetch_started.set()
            if not release_fetch.wait(5):
                raise AssertionError('Team Jira fetch barrier timed out')
            class Response:
                status_code = 200

                @staticmethod
                def json():
                    return {'issues': [{'fields': {'customfield_10001': [
                        'directory', 'bare', {'id': 'issue', 'name': 'Jira issue'},
                    ]}}], 'isLast': True}
            return Response()

        def fetch_then_publish():
            directory = load_workspace_team_catalog(
                self.context, database_url=self.database_url,
            ).get('catalog') or {}
            payload = fetch_sprint_teams(
                sprint_id='5', base_jql=config.base_jql,
                team_field_id=config.team_field_id, jira_search=held_search,
                directory=directory, budget=self.budget,
            )
            return publish_catalog(
                self.context, claim=claim, payload=payload, budget=self.budget,
                resolve_config=self.resolve, database_url=self.database_url,
            )

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(fetch_then_publish)
            self.assertTrue(fetch_started.wait(5))
            save_workspace_team_catalog(
                self.context,
                {'catalog': {
                    'directory': {'id': 'directory', 'name': 'Newest directory'},
                    'bare': {'id': 'bare', 'name': 'Newest bare'},
                    'issue': {'id': 'issue', 'name': 'Manual issue'},
                }, 'meta': {}},
                merge=True, database_url=self.database_url,
            )
            release_fetch.set()
            self.assertTrue(future.result(timeout=5))
        snapshot = load_sprint_team_catalog(
            self.context, sprint_id='5', config=config,
            database_url=self.database_url,
        )
        self.assertEqual(snapshot.payload, [
            {'id': 'issue', 'name': 'Jira issue'},
            {'id': 'bare', 'name': 'Newest bare'},
            {'id': 'directory', 'name': 'Newest directory'},
        ])
        directory = load_workspace_team_catalog(
            self.context, database_url=self.database_url,
        )['catalog']
        self.assertEqual(directory['directory']['name'], 'Newest directory')
        self.assertEqual(directory['bare']['name'], 'Newest bare')
        self.assertEqual(directory['issue']['name'], 'Jira issue')

    def test_promotion_fence_timeout_exits_nonzero_without_insert(self):
        from scripts.promote_legacy_shared_admin_config import _fingerprint, main
        with self.factory() as session:
            session.query(models.WorkspaceDashboardConfig).filter_by(
                workspace_id=self.context.workspace_id,
            ).delete()
            user = session.get(models.User, self.context.user_id)
            user.account_type = 'admin'
            view = models.ViewConfig(
                workspace_id=self.context.workspace_id, owner_user_id=user.id,
                name='Promotion', view_type='mixed', payload={}, is_default=True,
            )
            session.add(view)
            session.flush()
            payload = {'board': {'boardId': '19'}}
            session.add(models.ViewConfigVersion(
                view_config_id=view.id, version_number=1, payload=payload,
                created_by=user.id, change_note='compatibility save',
            ))
            session.commit()
            view_id = view.id
        holder, transaction, holder_pid = self._hold_workspace_fence()
        entered = Event()
        state = {}
        engine = db_engine.get_engine(self.database_url)
        def observe(conn, _cursor, statement, _parameters, _context, _executemany):
            if 'pg_advisory_xact_lock' in statement:
                state['pid'] = conn.connection.driver_connection.info.backend_pid
                entered.set()
        event.listen(engine, 'before_cursor_execute', observe)
        args = [
            '--workspace-id', self.context.workspace_id, '--view-config-id', view_id,
            '--version-number', '1', '--apply', '--expected-sha256', _fingerprint(payload),
        ]
        try:
            with patch.dict(os.environ, {'DATABASE_URL': self.database_url}, clear=False), ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(main, args)
                self.assertTrue(entered.wait(5))
                self.assertNotEqual(holder_pid, state['pid'])
                self._wait_for_lock_waiter(state['pid'])
                self.assertEqual(future.result(timeout=7), 2)
        finally:
            event.remove(engine, 'before_cursor_execute', observe)
            transaction.rollback()
            holder.close()
            holder.engine.dispose()
        with self.factory() as session:
            self.assertEqual(session.query(models.WorkspaceDashboardConfig).filter_by(
                workspace_id=self.context.workspace_id,
            ).count(), 0)
            self.assertEqual(session.query(models.AuditEvent).filter_by(
                workspace_id=self.context.workspace_id,
            ).count(), 0)

    def test_browser_logout_serializes_with_catalog_publication(self):
        config = self.publish_sprints([{'id': '5', 'name': 'Sprint Five'}])
        browser_id = str(uuid.uuid4())
        with self.factory() as session:
            session.add(models.BrowserSession(
                id=browser_id, user_id=self.context.user_id,
                workspace_id=self.context.workspace_id,
                auth_connection_id=self.context.auth_connection_id,
            ))
            session.commit()
        browser_context = RequestAuthContext(**{
            **self.context.__dict__, 'browser_session_id': browser_id,
        })
        claim = claim_catalog_refresh(
            browser_context,
            kind='teams',
            sprint_id='5',
            expected_config=config,
            owner=str(uuid.uuid4()),
            budget=self.budget, resolve_config=self.resolve, database_url=self.database_url,
        )
        publication_holds_browser = Event()
        release_publication = Event()
        logout_started = Event()
        state = {}
        def held_resolver(session, context):
            current = self.resolve(session, context)
            state['publication_pid'] = session.execute(
                text('SELECT pg_backend_pid()')
            ).scalar_one()
            publication_holds_browser.set()
            if not release_publication.wait(5):
                raise AssertionError('publication browser lock barrier timed out')
            return current
        def logout():
            with self.factory() as session:
                state['logout_pid'] = session.execute(text('SELECT pg_backend_pid()')).scalar_one()
                logout_started.set()
                count = delete_browser_session(session, browser_id)
                session.commit()
                return count
        with ThreadPoolExecutor(max_workers=2) as pool:
            publication_future = pool.submit(
                publish_catalog,
                browser_context,
                claim=claim,
                payload=[{'id': 'a', 'name': 'Alpha'}],
                budget=self.budget,
                resolve_config=held_resolver,
                database_url=self.database_url,
            )
            self.assertTrue(publication_holds_browser.wait(5))
            logout_future = pool.submit(logout)
            try:
                self.assertTrue(logout_started.wait(5))
                self.assertNotEqual(state['publication_pid'], state['logout_pid'])
                self._wait_for_blocked_backend(
                    state['logout_pid'],
                    state['publication_pid'],
                )
                release_publication.set()
                self.assertTrue(publication_future.result(timeout=5))
                self.assertEqual(logout_future.result(timeout=5), 1)
            finally:
                release_publication.set()
        with self.factory() as session:
            first_membership = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
                sprint_id='5',
            ).one()
            self.assertEqual(first_membership.teams, [{'id': 'a', 'name': 'Alpha'}])
            self.assertIsNone(session.get(models.BrowserSession, browser_id))
            self.assertEqual(
                set(session.query(models.WorkspaceTeamCatalog).filter_by(
                    workspace_id=self.context.workspace_id,
                ).one().payload['catalog']),
                {'a'},
            )

        second_browser_id = str(uuid.uuid4())
        with self.factory() as session:
            session.add(models.BrowserSession(
                id=second_browser_id,
                user_id=self.context.user_id,
                workspace_id=self.context.workspace_id,
                auth_connection_id=self.context.auth_connection_id,
            ))
            session.commit()
        second_context = RequestAuthContext(**{
            **self.context.__dict__, 'browser_session_id': second_browser_id,
        })
        second_claim = claim_catalog_refresh(
            second_context,
            kind='teams',
            sprint_id='5',
            expected_config=config,
            owner=str(uuid.uuid4()),
            budget=self.budget,
            resolve_config=self.resolve,
            database_url=self.database_url,
        )
        with self.factory() as session:
            before_membership = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
                sprint_id='5',
            ).one()
            before_payload = before_membership.teams
            before_version = before_membership.catalog_version
            before_directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
            ).one().payload
        logout_committed = Event()
        close_logout_connection = Event()
        second_publication_entered = Event()
        second_state = {}
        service_engine = db_engine.get_engine(self.database_url)
        def logout_first():
            with self.factory() as session:
                second_state['logout_pid'] = session.execute(
                    text('SELECT pg_backend_pid()')
                ).scalar_one()
                self.assertEqual(delete_browser_session(session, second_browser_id), 1)
                session.commit()
                logout_committed.set()
                if not close_logout_connection.wait(5):
                    raise AssertionError('logout connection release barrier timed out')
        def observe_second_publication(conn, _cursor, statement, _parameters, _context, _executemany):
            if 'pg_advisory_xact_lock' in statement:
                second_state['publication_pid'] = conn.connection.driver_connection.info.backend_pid
                second_publication_entered.set()
        event.listen(service_engine, 'before_cursor_execute', observe_second_publication)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                logout_future = pool.submit(logout_first)
                self.assertTrue(logout_committed.wait(5))
                publication_future = pool.submit(
                    publish_catalog,
                    second_context,
                    claim=second_claim,
                    payload=[{'id': 'b', 'name': 'Beta'}],
                    budget=self.budget,
                    resolve_config=self.resolve,
                    database_url=self.database_url,
                )
                self.assertTrue(second_publication_entered.wait(5))
                with self.assertRaises(AuthError):
                    publication_future.result(timeout=5)
                self.assertNotEqual(
                    second_state['logout_pid'],
                    second_state['publication_pid'],
                )
                close_logout_connection.set()
                logout_future.result(timeout=5)
        finally:
            close_logout_connection.set()
            event.remove(service_engine, 'before_cursor_execute', observe_second_publication)
        with self.factory() as session:
            after_membership = session.query(models.WorkspaceSprintTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
                sprint_id='5',
            ).one()
            after_directory = session.query(models.WorkspaceTeamCatalog).filter_by(
                workspace_id=self.context.workspace_id,
            ).one()
            self.assertEqual(after_membership.teams, before_payload)
            self.assertEqual(after_membership.catalog_version, before_version)
            self.assertEqual(after_directory.payload, before_directory)


if __name__ == '__main__':
    unittest.main()
