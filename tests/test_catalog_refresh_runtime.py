import os
import base64
import json
import inspect
import re
import tempfile
import time
import unittest
import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from threading import Event
from unittest.mock import Mock, patch

import requests
from sqlalchemy.exc import OperationalError

import jira_server
from backend.auth.context import RequestAuthContext
from backend.auth import db_tokens as db_tokens_module
from backend.auth import home_credentials as home_credentials_module
from backend.auth.db_tokens import store_oauth_callback_tokens
from backend.auth.key_provider import key_provider_from_env
from backend.db import engine as db_engine
from backend.db import models
from backend.services.workspace_catalog_cache import claim_catalog_refresh
from backend.services.workspace_catalog_cache import load_sprint_catalog, publish_catalog
from backend.services.workspace_catalog_cache import finish_catalog_failure
from backend.services.workspace_catalog_config import resolve_effective_catalog_config


class CatalogRefreshRuntimeTests(unittest.TestCase):
    def setUp(self):
        forbidden = (
            'current_jira_request', 'jira_search_request',
            'oauth_session_data', 'save_oauth_session', 'oauth_refresh_lock',
            'oauth_session_data_for_auth_context',
            'save_oauth_session_for_auth_context',
            'oauth_refresh_lock_for_auth_context', 'fetch_teams_from_jira_api',
        )
        self._forbidden_patches = [
            patch.object(
                jira_server, name,
                side_effect=AssertionError(f'forbidden catalog path reached: {name}'),
            ) for name in forbidden
        ]
        local_store_methods = (
            'persistence_enabled', 'read_persistent_token_store',
            'write_persistent_token_store', '_drop_persistent_session',
            '_save_persistent_session', '_load_persistent_session',
            'existing_refresh_lock', 'drop_session',
            'cleanup_expired_sessions', 'save_session', 'save_session_for_id',
            'refresh_lock', 'refresh_lock_for_id', 'session_data',
            'session_data_for_id', '_session_data_for_id',
        )
        self._forbidden_patches.extend(
            patch.object(
                jira_server._LOCAL_OAUTH_STORE, name,
                side_effect=AssertionError(f'forbidden local OAuth store reached: {name}'),
            ) for name in local_store_methods
        )
        self._forbidden_patches.extend((
            patch.object(
                home_credentials_module, 'resolve_home_credential',
                side_effect=AssertionError('forbidden Home credential resolver reached'),
            ),
            patch.object(
                home_credentials_module, '_resolve_service_credential',
                side_effect=AssertionError('forbidden service credential resolver reached'),
            ),
        ))
        for forbidden_patch in self._forbidden_patches:
            forbidden_patch.start()
            self.addCleanup(forbidden_patch.stop)
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'runtime.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(environment_key='runtime', name='Runtime')
            user = models.User(id='runtime-user', external_provider='test', external_subject='runtime-user')
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                id='runtime-connection', user_id=user.id, workspace_id=workspace.id,
                provider='atlassian_oauth', cloud_id='runtime-cloud',
                site_url='https://runtime.example.test', scopes=['read:jira-work'],
                scope_provenance='provider',
            )
            session.add(connection)
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=workspace.id,
                payload={'board': {'boardId': '17'}, 'projects': [{'key': 'DEMO'}]},
                config_revision=1,
            ))
            session.commit()
            self.workspace_id = workspace.id
        self.context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='runtime-user', stable_subject='runtime-user',
            atlassian_account_id='runtime-user', workspace_id=self.workspace_id,
            auth_connection_id='runtime-connection', cloud_id='runtime-cloud',
            site_url='https://runtime.example.test', token_version='1',
            account_status='active', is_admin=True, granted_scopes=('read:jira-work',),
            granted_scopes_verified=True,
        )
        self.runtime_inputs = {
            'jql_query': '', 'jira_board_id': '',
            'team_field_default': 'customfield_10001',
            'sprint_field_default': 'customfield_10002',
        }

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def resolve(self, session, context):
        return resolve_effective_catalog_config(
            session, context, runtime_inputs=self.runtime_inputs,
            fallback_loader=None, legacy_site_url='',
        )

    def config(self):
        with self.factory() as session:
            return self.resolve(session, self.context)

    def _install_real_wrapper_auth(self, *, expired=False):
        key_env = {
            'APP_ENVIRONMENT_KEY': 'runtime-wrapper',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([19]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'runtime-key',
            'TOKEN_ENCRYPTION_KEY_SOURCE': 'env',
        }
        with self.factory() as session:
            for model in (
                models.WorkspaceSprintCatalog, models.WorkspaceDashboardConfig,
                models.AuthToken, models.AuthConnection, models.User, models.Workspace,
            ):
                session.query(model).delete()
            session.commit()
            stored = store_oauth_callback_tokens(
                session,
                token_data={
                    'access_token': 'seed-access', 'refresh_token': 'seed-refresh',
                    'expires_in': 3600, 'scope': jira_server.ATLASSIAN_SCOPES,
                },
                resource={'id': 'wrapper-cloud', 'url': 'https://wrapper.example.test', 'name': 'Wrapper'},
                user_profile={'account_id': 'wrapper-account', 'account_status': 'active'},
                environment_key='runtime-wrapper',
                configured_jira_url='https://wrapper.example.test',
                key_provider=key_provider_from_env(key_env),
                requested_scopes=jira_server.ATLASSIAN_SCOPES,
            )
            if expired:
                session.get(models.AuthConnection, stored.connection_id).expires_at = (
                    datetime.now(timezone.utc) - timedelta(seconds=1)
                )
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=stored.workspace_id,
                payload={'board': {'boardId': '17'}}, config_revision=1,
            ))
            session.commit()
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id=stored.user_id,
            stable_subject='wrapper-account', atlassian_account_id='wrapper-account',
            workspace_id=stored.workspace_id, auth_connection_id=stored.connection_id,
            cloud_id='wrapper-cloud', site_url='https://wrapper.example.test',
            token_version='1', account_status='active', is_admin=True,
            granted_scopes=tuple(jira_server.ATLASSIAN_SCOPES.split()),
            granted_scopes_verified=True,
        )
        return context, key_env, stored

    @staticmethod
    def _http_response(status, payload):
        result = requests.Response()
        result.status_code = status
        result._content = json.dumps(payload).encode('utf-8')
        result._content_consumed = True
        result.headers['Content-Type'] = 'application/json'
        return result

    def test_two_admitted_jobs_have_no_waiting_queue(self):
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        release = Event()
        started = Event()
        count = 0

        def fetch(**_kwargs):
            nonlocal count
            count += 1
            if count == 2:
                started.set()
            release.wait(2)
            return []

        runtime = CatalogRefreshRuntime(
            fetch_sprints=fetch, fetch_teams=fetch,
            database_url=self.database_url,
        )
        config = self.config()
        first = runtime.refresh(self.context, kind='sprints', config=config, background=True, resolve_config=self.resolve)
        second = runtime.refresh(
            self.context, kind='teams', sprint_id='5', config=config,
            background=True, resolve_config=self.resolve,
        )
        self.assertTrue(started.wait(1))
        third = runtime.refresh(
            self.context, kind='teams', sprint_id='6', config=config,
            background=True, resolve_config=self.resolve,
        )
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertIsNone(third)
        self.assertFalse(runtime.has_waiting_queue)
        release.set()
        runtime._executor.shutdown(wait=True)
        runtime.shutdown()

    def test_workspace_fence_timeout_maps_to_catalog_lock_timeout(self):
        from backend.services import catalog_refresh_runtime as runtime_module
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshDeadline,
            CatalogRefreshLockTimeout,
            CatalogRefreshRuntime,
        )
        from backend.services.workspace_dashboard_config import WorkspaceConfigFenceUnavailable

        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [], database_url=self.database_url,
        )
        self.assertEqual(
            runtime._failure_code(WorkspaceConfigFenceUnavailable('sanitized')),
            'catalog_refresh_lock_timeout',
        )
        self.assertEqual(
            runtime._failure_code(CatalogRefreshDeadline('workspace_config_fence')),
            'refresh_budget_exhausted',
        )
        with patch.object(
            runtime_module, 'claim_catalog_refresh',
            side_effect=WorkspaceConfigFenceUnavailable('sanitized'),
        ), self.assertRaises(CatalogRefreshLockTimeout) as raised:
            runtime.refresh(
                self.context, kind='sprints', config=self.config(),
                background=False, resolve_config=self.resolve,
            )
        self.assertEqual(raised.exception.code, 'catalog_refresh_lock_timeout')
        self.assertIsInstance(raised.exception.__cause__, WorkspaceConfigFenceUnavailable)
        self.assertTrue(runtime._admission.acquire(blocking=False))
        runtime._admission.release()
        runtime.shutdown()

    def test_elapsed_attempt_budget_wins_over_workspace_fence_timeout(self):
        from backend.services import catalog_refresh_runtime as runtime_module
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshBudget,
            CatalogRefreshDeadline,
            CatalogRefreshRuntime,
        )
        from backend.services.workspace_dashboard_config import WorkspaceConfigFenceUnavailable

        class AdmissionThenExpired:
            def __init__(self):
                self.phases = []

            def check(self, phase='catalog_refresh'):
                self.phases.append(phase)
                if phase == 'fence_failure_classification':
                    raise CatalogRefreshDeadline(phase)

        boundary = AdmissionThenExpired()
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [], database_url=self.database_url,
            budget_factory=lambda: boundary,
        )
        self.assertEqual(
            runtime._failure_code(
                WorkspaceConfigFenceUnavailable('sanitized'), budget=boundary,
            ),
            'refresh_budget_exhausted',
        )
        with patch.object(
            runtime_module, 'claim_catalog_refresh',
            side_effect=WorkspaceConfigFenceUnavailable('sanitized'),
        ), self.assertRaises(CatalogRefreshDeadline):
            runtime.refresh(
                self.context, kind='sprints', config=self.config(),
                background=False, resolve_config=self.resolve,
            )
        self.assertIn('fence_failure_classification', boundary.phases)
        runtime.shutdown()

        config = self.config()
        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=config,
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        publish_catalog(
            self.context, claim=seed_claim, payload=[{'id': 1, 'name': 'old'}],
            budget=seed_budget, resolve_config=self.resolve,
            database_url=self.database_url,
        )
        old = load_sprint_catalog(
            self.context, config=config, database_url=self.database_url,
        )
        worker_budget = CatalogRefreshBudget.start()
        observed_codes = []
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [{'id': 2, 'name': 'new'}],
            database_url=self.database_url, budget_factory=lambda: worker_budget,
        )
        original_failure_code = runtime._failure_code

        def record_failure_code(error, *, budget=None):
            code = original_failure_code(error, budget=budget)
            observed_codes.append(code)
            return code

        def expire_at_publication(*_args, **_kwargs):
            worker_budget.cancel()
            raise WorkspaceConfigFenceUnavailable('sanitized')

        with patch.object(runtime, '_failure_code', side_effect=record_failure_code), \
                patch.object(runtime_module, 'publish_catalog', side_effect=expire_at_publication):
            runtime.refresh(
                self.context, kind='sprints', config=config, background=False,
                resolve_config=self.resolve,
            )
        self.assertEqual(observed_codes, ['refresh_budget_exhausted'])
        current = load_sprint_catalog(
            self.context, config=config, database_url=self.database_url,
        )
        self.assertEqual(current.payload, old.payload)
        self.assertEqual(current.catalog_version, old.catalog_version)
        runtime.shutdown()

    def test_direct_operational_fence_timeout_uses_same_worker_budget(self):
        from backend.services import catalog_refresh_runtime as runtime_module
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshDeadline,
            CatalogRefreshRuntime,
        )

        class FenceOrig(RuntimeError):
            def __init__(self, sqlstate):
                super().__init__('sensitive database detail')
                self.sqlstate = sqlstate

        class BoundaryBudget:
            def __init__(self, *, expired):
                self.expired = expired
                self.phases = []

            def check(self, phase='catalog_refresh'):
                self.phases.append(phase)
                if self.expired and phase in {
                    'fence_failure_classification', 'failure_cleanup',
                }:
                    raise CatalogRefreshDeadline(phase)

        for sqlstate in ('55P03', '57014'):
            error = OperationalError('SELECT fenced', {}, FenceOrig(sqlstate))
            for expired in (False, True):
                with self.subTest(sqlstate=sqlstate, expired=expired):
                    budget = BoundaryBudget(expired=expired)
                    runtime = CatalogRefreshRuntime(
                        fetch_sprints=Mock(side_effect=error),
                        database_url=self.database_url,
                    )
                    original_failure_code = runtime._failure_code
                    observed_codes = []

                    def record_failure_code(failure, *, budget=None):
                        code = original_failure_code(failure, budget=budget)
                        observed_codes.append(code)
                        return code

                    self.assertTrue(runtime._admission.acquire(blocking=False))
                    with patch.object(
                        runtime, '_failure_code', side_effect=record_failure_code,
                    ), patch.object(
                        runtime_module, 'finish_catalog_failure',
                    ) as finish_failure:
                        runtime._execute(
                            self.context,
                            Mock(kind='sprints', config=self.config()),
                            budget,
                            self.resolve,
                            propagate_auth=False,
                        )
                    expected_code = (
                        'refresh_budget_exhausted' if expired
                        else 'catalog_refresh_lock_timeout'
                    )
                    self.assertEqual(observed_codes, [expected_code])
                    if expired:
                        finish_failure.assert_not_called()
                    else:
                        self.assertEqual(
                            finish_failure.call_args.kwargs['failure_code'],
                            expected_code,
                        )
                    self.assertEqual(
                        budget.phases,
                        [
                            'worker_start', 'fence_failure_classification',
                            'failure_cleanup',
                        ],
                    )
                    runtime.shutdown()

    def test_direct_operational_fence_timeout_preclaim_budget_boundaries(self):
        from backend.services import catalog_refresh_runtime as runtime_module
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshDeadline,
            CatalogRefreshLockTimeout,
            CatalogRefreshRuntime,
        )

        class FenceOrig(RuntimeError):
            def __init__(self, sqlstate):
                super().__init__('sensitive database detail')
                self.sqlstate = sqlstate

        class BoundaryBudget:
            def __init__(self, *, expired):
                self.expired = expired
                self.phases = []

            def check(self, phase='catalog_refresh'):
                self.phases.append(phase)
                if self.expired and phase == 'fence_failure_classification':
                    raise CatalogRefreshDeadline(phase)

        for sqlstate in ('55P03', '57014'):
            error = OperationalError('SELECT fenced', {}, FenceOrig(sqlstate))
            for expired in (False, True):
                with self.subTest(sqlstate=sqlstate, expired=expired):
                    budget = BoundaryBudget(expired=expired)
                    runtime = CatalogRefreshRuntime(
                        fetch_sprints=lambda **_kwargs: [],
                        database_url=self.database_url,
                        budget_factory=lambda: budget,
                    )
                    expected = (
                        CatalogRefreshDeadline if expired
                        else CatalogRefreshLockTimeout
                    )
                    with patch.object(
                        runtime_module, 'claim_catalog_refresh',
                        side_effect=error,
                    ), self.assertRaises(expected):
                        runtime.refresh(
                            self.context, kind='sprints', config=self.config(),
                            background=False, resolve_config=self.resolve,
                        )
                    self.assertEqual(
                        budget.phases,
                        ['admission', 'fence_failure_classification'],
                    )
                    self.assertTrue(runtime._admission.acquire(blocking=False))
                    runtime._admission.release()
                    runtime.shutdown()

        unrelated = OperationalError(
            'SELECT unrelated', {}, FenceOrig('08006'),
        )
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [], database_url=self.database_url,
        )
        with patch.object(
            runtime_module, 'claim_catalog_refresh', side_effect=unrelated,
        ), self.assertRaises(OperationalError) as raised:
            runtime.refresh(
                self.context, kind='sprints', config=self.config(),
                background=False, resolve_config=self.resolve,
            )
        self.assertIs(raised.exception, unrelated)
        self.assertTrue(runtime._admission.acquire(blocking=False))
        runtime._admission.release()
        runtime.shutdown()

    def test_catalog_service_sources_reject_legacy_and_generic_auth_paths(self):
        from backend.services import catalog_refresh_runtime
        from backend.services import sprint_teams
        from backend.services import sprints
        from backend.services import workspace_catalog_cache
        from backend.services import workspace_catalog_config

        forbidden = (
            'OAUTH_TOKEN_STORE', 'OAUTH_REFRESH_LOCKS', 'HEADERS',
            'home_townsquare', 'service_integration', 'current_jira_request',
            'jira_search_request', 'oauth_session_data', 'save_oauth_session',
            'oauth_refresh_lock', 'fetch_teams_from_jira_api',
            '_LOCAL_OAUTH_STORE',
        )
        forbidden_callables = (
            'persistence_enabled', 'read_persistent_token_store',
            'write_persistent_token_store', '_drop_persistent_session',
            '_save_persistent_session', '_load_persistent_session',
            'existing_refresh_lock', 'drop_session',
            'cleanup_expired_sessions', 'save_session', 'save_session_for_id',
            'refresh_lock', 'refresh_lock_for_id', 'session_data',
            'session_data_for_id', '_session_data_for_id',
            'resolve_home_credential', '_resolve_service_credential',
        )
        for target in (
            catalog_refresh_runtime, workspace_catalog_cache,
            workspace_catalog_config, sprints.fetch_board_sprints,
            sprint_teams,
        ):
            source = inspect.getsource(target)
            for symbol in forbidden:
                with self.subTest(target=getattr(target, '__name__', ''), symbol=symbol):
                    self.assertNotIn(symbol, source)
            for name in forbidden_callables:
                with self.subTest(target=getattr(target, '__name__', ''), callable=name):
                    self.assertNotRegex(source, rf'\b{re.escape(name)}\s*\(')

    def test_submit_failure_releases_only_its_owner(self):
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        executor = Mock()
        executor.submit.side_effect = RuntimeError('executor closed')
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [], database_url=self.database_url,
            executor_factory=lambda **_kwargs: executor,
        )
        config = self.config()
        claim = runtime.refresh(
            self.context, kind='sprints', config=config, background=True,
            resolve_config=self.resolve,
        )
        self.assertIsNone(claim)
        submitted_claim = executor.submit.call_args.args[2]
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=self.workspace_id, board_id='17',
            ).one()
            self.assertEqual(row.refresh_attempt_id, submitted_claim.attempt_id)
            self.assertEqual(row.refresh_status, 'failed')
            self.assertIsNone(row.refresh_lease_owner)
        runtime.shutdown()

    def test_runtime_is_created_after_fork(self):
        from backend.services import catalog_refresh_runtime as module

        module.reset_catalog_refresh_runtime_for_tests()
        with patch.object(module.os, 'getpid', side_effect=[100, 100, 200]):
            first = module.get_catalog_refresh_runtime(fetch_sprints=lambda **_kwargs: [])
            self.assertIs(first, module.get_catalog_refresh_runtime(fetch_sprints=lambda **_kwargs: []))
            second = module.get_catalog_refresh_runtime(fetch_sprints=lambda **_kwargs: [])
        self.assertIsNot(first, second)
        module.reset_catalog_refresh_runtime_for_tests()

    def test_expired_attempt_read_is_failed_without_worker_cleanup(self):
        from backend.services.catalog_refresh_runtime import read_catalog_completion

        config = self.config()
        budget = Mock()
        budget.remaining.return_value = 30
        owner = str(uuid.uuid4())
        claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=config, owner=owner,
            budget=budget, resolve_config=self.resolve, database_url=self.database_url,
        )
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=self.workspace_id, board_id='17',
            ).one()
            row.attempt_deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            original_owner = row.refresh_lease_owner
            session.commit()

        snapshot = read_catalog_completion(
            self.context, kind='sprints', attempt_id=claim.attempt_id,
            expected_identity=claim.identity, resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertEqual(snapshot.refresh_status, 'failed')
        self.assertEqual(snapshot.failure_code, 'refresh_budget_exhausted')
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=self.workspace_id, board_id='17',
            ).one()
            self.assertEqual(row.refresh_status, 'pending')
            self.assertEqual(row.refresh_lease_owner, original_owner)

    def test_real_wrapper_refreshes_expired_db_token_then_publishes_with_one_budget(self):
        from backend.auth import jira_auth as jira_auth_module
        from backend.services import catalog_refresh_runtime as runtime_module
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshBudget,
            CatalogRefreshRuntime,
        )

        token_key = base64.b64encode(bytes([17]) * 32).decode('ascii')
        key_env = {
            'APP_ENVIRONMENT_KEY': 'runtime-wrapper',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': token_key,
            'TOKEN_ENCRYPTION_KEY_ID': 'runtime-key',
            'TOKEN_ENCRYPTION_KEY_SOURCE': 'env',
        }
        key_provider = key_provider_from_env(key_env)
        with self.factory() as session:
            session.query(models.WorkspaceDashboardConfig).delete()
            session.query(models.AuthConnection).delete()
            session.query(models.User).delete()
            session.query(models.Workspace).delete()
            session.commit()
            stored = store_oauth_callback_tokens(
                session,
                token_data={
                    'access_token': 'expired-access', 'refresh_token': 'refresh-token',
                    'expires_in': 1, 'scope': jira_server.ATLASSIAN_SCOPES,
                },
                resource={
                    'id': 'wrapper-cloud', 'url': 'https://wrapper.example.test',
                    'name': 'Wrapper',
                },
                user_profile={'account_id': 'wrapper-account', 'account_status': 'active'},
                environment_key='runtime-wrapper',
                configured_jira_url='https://wrapper.example.test',
                key_provider=key_provider,
                requested_scopes=jira_server.ATLASSIAN_SCOPES,
            )
            connection = session.get(models.AuthConnection, stored.connection_id)
            connection.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=stored.workspace_id,
                payload={'board': {'boardId': '17'}}, config_revision=1,
            ))
            session.commit()
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id=stored.user_id,
            stable_subject='wrapper-account', atlassian_account_id='wrapper-account',
            workspace_id=stored.workspace_id, auth_connection_id=stored.connection_id,
            cloud_id='wrapper-cloud', site_url='https://wrapper.example.test',
            token_version='1', account_status='active', is_admin=True,
            granted_scopes=tuple(jira_server.ATLASSIAN_SCOPES.split()),
            granted_scopes_verified=True,
        )

        def response(status, payload):
            result = requests.Response()
            result.status_code = status
            result._content = json.dumps(payload).encode('utf-8')
            result._content_consumed = True
            result.headers['Content-Type'] = 'application/json'
            return result

        budgets = []
        phases = []

        class RecordingBudget(CatalogRefreshBudget):
            def remaining(self, phase='catalog_refresh'):
                phases.append((phase, self))
                return super().remaining(phase)

            def check(self, phase='catalog_refresh'):
                phases.append((phase, self))
                return super().check(phase)

        def budget_factory():
            budget = RecordingBudget.start()
            budgets.append(budget)
            return budget

        def fetch_with_budget(**kwargs):
            phases.append(('fetch_entry', kwargs['budget']))
            return jira_server.fetch_board_sprints(**kwargs)

        runtime = CatalogRefreshRuntime(
            fetch_sprints=fetch_with_budget,
            database_url=self.database_url, budget_factory=budget_factory,
        )
        get_calls = []

        def http_get(url, **kwargs):
            get_calls.append((url, kwargs))
            return response(200, {
                'values': [{
                    'id': 101, 'name': '2026Q3', 'state': 'active',
                    'originBoardId': 17,
                }],
                'startAt': 0, 'maxResults': 100, 'isLast': True,
            })

        with patch.dict(os.environ, {
            **key_env, 'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False), \
                patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(jira_server, 'JIRA_URL', 'https://wrapper.example.test'), \
                patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-id'), \
                patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'client-secret'), \
                patch.object(jira_server.HTTP_SESSION, 'post', return_value=response(200, {
                    'access_token': 'fresh-access', 'refresh_token': 'fresh-refresh',
                    'expires_in': 3600, 'scope': jira_server.ATLASSIAN_SCOPES,
                })) as oauth_post, \
                patch.object(jira_server.HTTP_SESSION, 'get', side_effect=http_get), \
                patch.object(runtime_module, 'claim_catalog_refresh', wraps=runtime_module.claim_catalog_refresh) as claim_call, \
                patch.object(runtime_module, 'publish_catalog', wraps=runtime_module.publish_catalog) as publish_call, \
                patch.object(db_tokens_module, '_connection_for_update', wraps=db_tokens_module._connection_for_update) as auth_lock, \
                patch.object(jira_server._jira_client, 'resilient_jira_get', wraps=jira_server._jira_client.resilient_jira_get) as retry_call, \
                patch.object(jira_auth_module, 'build_jira_headers', wraps=jira_auth_module.build_jira_headers) as header_call:
            with self.factory() as session:
                config = self.resolve(session, context)
            claim = runtime.refresh(
                context, kind='sprints', config=config, background=False,
                resolve_config=self.resolve,
            )

        self.assertIsNotNone(claim)
        self.assertEqual(len(budgets), 1)
        budget = budgets[0]
        self.assertIs(claim_call.call_args.kwargs['budget'], budget)
        self.assertIs(publish_call.call_args.kwargs['budget'], budget)
        self.assertTrue(any(call.kwargs.get('cooperative_budget') is budget for call in auth_lock.call_args_list))
        self.assertTrue(all(call.kwargs['diagnostic_budget'] is budget for call in retry_call.call_args_list))
        self.assertTrue(phases)
        self.assertTrue(all(observed is budget for _phase, observed in phases))
        self.assertIn('sprint_page', {phase for phase, _budget in phases})
        self.assertIn('publication', {phase for phase, _budget in phases})
        oauth_post.assert_called_once()
        self.assertEqual(len(get_calls), 1)
        self.assertEqual(get_calls[0][1]['headers']['Authorization'], 'Bearer fresh-access')
        self.assertTrue(header_call.called)
        for call in header_call.call_args_list:
            config_arg, session_arg = call.args
            self.assertEqual(config_arg.auth_mode, 'atlassian_oauth')
            self.assertIn('access_token', session_arg)
        with self.factory() as session:
            connection = session.get(models.AuthConnection, stored.connection_id)
            row = session.query(models.WorkspaceSprintCatalog).filter_by(
                workspace_id=stored.workspace_id, board_id='17',
            ).one()
            self.assertEqual(connection.token_version, 2)
            self.assertEqual(row.sprints[0]['name'], '2026Q3')
            self.assertEqual(row.refresh_status, 'completed')
        runtime.shutdown()

    def test_expired_budget_before_auth_lock_performs_no_oauth_or_jira_io(self):
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshDeadline,
            CatalogRefreshRuntime,
            read_catalog_completion,
        )

        class AuthExpiredBudget:
            def __init__(self):
                self.cancelled = Event()

            def remaining(self, phase='catalog_refresh'):
                if phase in {'auth', 'failure_cleanup'}:
                    raise CatalogRefreshDeadline(phase)
                return 0.001

            def check(self, phase='catalog_refresh'):
                self.remaining(phase)

        config = self.config()
        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            database_url=self.database_url,
            budget_factory=AuthExpiredBudget,
        )
        with patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('OAuth I/O')), \
                patch.object(jira_server.HTTP_SESSION, 'get', side_effect=AssertionError('Jira I/O')):
            claim = runtime.refresh(
                self.context, kind='sprints', config=config, background=False,
                resolve_config=self.resolve,
            )
        self.assertIsNotNone(claim)
        time.sleep(0.01)
        snapshot = read_catalog_completion(
            self.context, kind='sprints', attempt_id=claim.attempt_id,
            expected_identity=claim.identity, resolve_config=self.resolve,
            database_url=self.database_url,
        )
        self.assertEqual(snapshot.refresh_status, 'failed')
        self.assertEqual(snapshot.failure_code, 'refresh_budget_exhausted')
        runtime.shutdown()

    def test_real_wrapper_jira_401_on_first_or_later_page_preserves_auth_contract(self):
        from backend.auth.jira_auth import AuthError
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        context, key_env, _stored = self._install_real_wrapper_auth()
        for later_page in (False, True):
            with self.subTest(later_page=later_page):
                with self.factory() as session:
                    session.query(models.WorkspaceSprintCatalog).delete()
                    session.commit()
                    config = self.resolve(session, context)
                responses = []
                if later_page:
                    responses.append(self._http_response(200, {
                        'values': [{'id': 101, 'name': '2026Q3', 'state': 'active'}],
                        'startAt': 0, 'maxResults': 100, 'isLast': False,
                    }))
                responses.append(self._http_response(401, {'detail': 'sensitive'}))
                runtime = CatalogRefreshRuntime(
                    fetch_sprints=jira_server.fetch_board_sprints,
                    database_url=self.database_url,
                )
                with patch.dict(os.environ, {
                    **key_env, 'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
                }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                        patch.object(jira_server, 'JIRA_URL', context.site_url), \
                        patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('unexpected refresh')), \
                        patch.object(jira_server.HTTP_SESSION, 'get', side_effect=responses) as jira_get:
                    with self.assertRaises(AuthError):
                        runtime.refresh(
                            context, kind='sprints', config=config, background=False,
                            resolve_config=self.resolve,
                        )
                self.assertEqual(jira_get.call_count, 2 if later_page else 1)
                with self.factory() as session:
                    row = session.query(models.WorkspaceSprintCatalog).one()
                    self.assertIsNone(row.validated_at)
                    self.assertEqual(row.refresh_status, 'failed')
                    self.assertEqual(row.failure_code, 'auth_required')
                runtime.shutdown()

        for later_page in (False, True):
            with self.subTest(kind='teams', later_page=later_page):
                with self.factory() as session:
                    session.query(models.WorkspaceSprintTeamCatalog).delete()
                    session.commit()
                    config = self.resolve(session, context)
                responses = []
                if later_page:
                    responses.append(self._http_response(200, {
                        'issues': [], 'isLast': False, 'nextPageToken': 'next-token',
                    }))
                responses.append(self._http_response(401, {'detail': 'sensitive'}))

                def fetch_teams(*, context, diagnostic_transport, budget, **_kwargs):
                    token = None
                    while True:
                        budget.check('team_page')
                        payload = {'jql': 'project = DEMO', 'maxResults': 100, 'fields': ['customfield_1']}
                        if token:
                            payload['nextPageToken'] = token
                        response = jira_server.current_jira_search(
                            payload, context=context, timeout=min(15, budget.remaining('team_page')),
                            diagnostic_transport=diagnostic_transport,
                        )
                        if response.status_code == 401:
                            raise AuthError('auth_required', 'Atlassian authentication is required.')
                        data = response.json()
                        if data.get('isLast'):
                            return []
                        token = data.get('nextPageToken')

                runtime = CatalogRefreshRuntime(
                    fetch_sprints=jira_server.fetch_board_sprints,
                    fetch_teams=fetch_teams, database_url=self.database_url,
                )
                with patch.dict(os.environ, {
                    **key_env, 'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
                }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                        patch.object(jira_server, 'JIRA_URL', context.site_url), \
                        patch.object(jira_server.HTTP_SESSION, 'get', side_effect=responses) as jira_get:
                    with self.assertRaises(AuthError):
                        runtime.refresh(
                            context, kind='teams', sprint_id='5', config=config,
                            background=False, resolve_config=self.resolve,
                        )
                self.assertEqual(jira_get.call_count, 2 if later_page else 1)
                with self.factory() as session:
                    row = session.query(models.WorkspaceSprintTeamCatalog).one()
                    self.assertIsNone(row.validated_at)
                    self.assertEqual(row.failure_code, 'auth_required')
                runtime.shutdown()

    def test_real_wrapper_oauth_timeout_retains_matching_catalog(self):
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshBudget,
            CatalogRefreshRuntime,
        )

        context, key_env, _stored = self._install_real_wrapper_auth(expired=True)
        config = None
        with self.factory() as session:
            config = self.resolve(session, context)
        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            context, kind='sprints', expected_config=config,
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            context, claim=seed_claim, payload=[{'id': 1, 'name': 'old'}],
            budget=seed_budget, resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        old_version = load_sprint_catalog(
            context, config=config, database_url=self.database_url,
        ).catalog_version
        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            database_url=self.database_url,
        )
        with patch.dict(os.environ, {
            **key_env, 'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
        }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(jira_server, 'JIRA_URL', context.site_url), \
                patch.object(jira_server.HTTP_SESSION, 'post', side_effect=requests.Timeout('secret timeout')) as oauth_post, \
                patch.object(jira_server.HTTP_SESSION, 'get', side_effect=AssertionError('Jira must not run')):
            claim = runtime.refresh(
                context, kind='sprints', config=config, background=False,
                resolve_config=self.resolve,
            )
        self.assertIsNotNone(claim)
        oauth_post.assert_called_once()
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).one()
            connection = session.get(models.AuthConnection, context.auth_connection_id)
            self.assertEqual(row.failure_code, 'oauth_refresh_timeout')
            self.assertEqual(row.sprints, [{'id': 1, 'name': 'old'}])
            self.assertEqual(row.catalog_version, old_version)
            self.assertEqual(connection.status, 'active')
        runtime.shutdown()

    def test_budget_exhausted_before_publication_keeps_old_payload(self):
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshBudget,
            CatalogRefreshRuntime,
        )

        config = self.config()
        seed_budget = CatalogRefreshBudget.start()
        seed_claim = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=config,
            owner=str(uuid.uuid4()), budget=seed_budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertTrue(publish_catalog(
            self.context, claim=seed_claim, payload=[{'id': 1, 'name': 'old'}],
            budget=seed_budget, resolve_config=self.resolve,
            database_url=self.database_url,
        ))
        old = load_sprint_catalog(
            self.context, config=config, database_url=self.database_url,
        )

        def expire_before_publish(**kwargs):
            kwargs['budget'].cancel()
            return [{'id': 2, 'name': 'new'}]

        runtime = CatalogRefreshRuntime(
            fetch_sprints=expire_before_publish, database_url=self.database_url,
        )
        claim = runtime.refresh(
            self.context, kind='sprints', config=config, background=False,
            resolve_config=self.resolve,
        )
        self.assertIsNotNone(claim)
        current = load_sprint_catalog(
            self.context, config=config, database_url=self.database_url,
        )
        self.assertEqual(current.payload, [{'id': 1, 'name': 'old'}])
        self.assertEqual(current.catalog_version, old.catalog_version)
        runtime.shutdown()

    def test_actor_disable_or_revocation_during_fetch_prevents_publication(self):
        from backend.auth.jira_auth import AuthError
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        mutations = (
            'disable', 'revoke', 'account', 'provider', 'scopes',
            'scope_provenance', 'connection_cloud', 'connection_site',
            'workspace_cloud', 'workspace_site',
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with self.factory() as session:
                    session.query(models.WorkspaceSprintCatalog).delete()
                    user = session.get(models.User, self.context.user_id)
                    user.status = 'active'
                    user.external_subject = self.context.atlassian_account_id
                    connection = session.get(models.AuthConnection, self.context.auth_connection_id)
                    connection.status = 'active'
                    connection.provider = 'atlassian_oauth'
                    connection.scope_provenance = 'provider'
                    connection.scopes = list(self.context.granted_scopes)
                    connection.cloud_id = self.context.cloud_id
                    connection.site_url = self.context.site_url
                    workspace = session.get(models.Workspace, self.context.workspace_id)
                    workspace.jira_cloud_id = self.context.cloud_id
                    workspace.jira_site_url = self.context.site_url
                    session.commit()

                def mutate_actor(**_kwargs):
                    with self.factory() as session:
                        if mutation == 'disable':
                            session.get(models.User, self.context.user_id).status = 'disabled'
                        elif mutation == 'revoke':
                            session.get(models.AuthConnection, self.context.auth_connection_id).status = 'revoked'
                        elif mutation == 'account':
                            session.get(models.User, self.context.user_id).external_subject = 'changed-account'
                        elif mutation == 'provider':
                            session.get(models.AuthConnection, self.context.auth_connection_id).provider = 'atlassian_user_api_token'
                        elif mutation == 'scopes':
                            session.get(models.AuthConnection, self.context.auth_connection_id).scopes = []
                        elif mutation == 'scope_provenance':
                            session.get(models.AuthConnection, self.context.auth_connection_id).scope_provenance = 'unknown'
                        elif mutation == 'connection_cloud':
                            session.get(models.AuthConnection, self.context.auth_connection_id).cloud_id = 'changed-cloud'
                        elif mutation == 'connection_site':
                            session.get(models.AuthConnection, self.context.auth_connection_id).site_url = 'https://changed.example.test'
                        elif mutation == 'workspace_cloud':
                            session.get(models.Workspace, self.context.workspace_id).jira_cloud_id = 'changed-cloud'
                        elif mutation == 'workspace_site':
                            session.get(models.Workspace, self.context.workspace_id).jira_site_url = 'https://changed.example.test'
                        session.commit()
                    return []

                runtime = CatalogRefreshRuntime(
                    fetch_sprints=mutate_actor, database_url=self.database_url,
                )
                with self.assertRaises(AuthError):
                    runtime.refresh(
                        self.context, kind='sprints', config=self.config(),
                        background=False, resolve_config=self.resolve,
                    )
                with self.factory() as session:
                    row = session.query(models.WorkspaceSprintCatalog).one()
                    self.assertIsNone(row.validated_at)
                    self.assertEqual(row.failure_code, 'auth_required')
                runtime.shutdown()

        with self.factory() as session:
            session.query(models.WorkspaceSprintCatalog).delete()
            session.get(models.User, self.context.user_id).status = 'active'
            connection = session.get(models.AuthConnection, self.context.auth_connection_id)
            connection.status = 'active'
            connection.provider = 'atlassian_oauth'
            connection.scope_provenance = 'provider'
            connection.scopes = list(self.context.granted_scopes)
            connection.cloud_id = self.context.cloud_id
            connection.site_url = self.context.site_url
            user = session.get(models.User, self.context.user_id)
            user.external_subject = self.context.atlassian_account_id
            workspace = session.get(models.Workspace, self.context.workspace_id)
            workspace.jira_cloud_id = self.context.cloud_id
            workspace.jira_site_url = self.context.site_url
            session.commit()

        def rotate_token(**_kwargs):
            with self.factory() as session:
                connection = session.get(models.AuthConnection, self.context.auth_connection_id)
                connection.token_version += 1
                session.commit()
            return []

        runtime = CatalogRefreshRuntime(
            fetch_sprints=rotate_token, database_url=self.database_url,
        )
        runtime.refresh(
            self.context, kind='sprints', config=self.config(),
            background=False, resolve_config=self.resolve,
        )
        self.assertEqual(load_sprint_catalog(
            self.context, config=self.config(), database_url=self.database_url,
        ).payload, [])
        runtime.shutdown()

    def test_cached_and_completion_reads_reject_freshly_revoked_actor(self):
        from backend.auth.jira_auth import AuthError
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshBudget,
            read_catalog_completion,
        )

        for mutation in ('revoke', 'disable'):
            with self.subTest(mutation=mutation):
                with self.factory() as session:
                    session.query(models.WorkspaceSprintCatalog).delete()
                    session.get(models.User, self.context.user_id).status = 'active'
                    session.get(models.AuthConnection, self.context.auth_connection_id).status = 'active'
                    session.commit()
                config = self.config()
                budget = CatalogRefreshBudget.start()
                claim = claim_catalog_refresh(
                    self.context, kind='sprints', expected_config=config,
                    owner=str(uuid.uuid4()), budget=budget,
                    resolve_config=self.resolve, database_url=self.database_url,
                )
                publish_catalog(
                    self.context, claim=claim, payload=[], budget=budget,
                    resolve_config=self.resolve, database_url=self.database_url,
                )
                with self.factory() as session:
                    if mutation == 'revoke':
                        session.get(models.AuthConnection, self.context.auth_connection_id).status = 'revoked'
                    else:
                        session.get(models.User, self.context.user_id).status = 'disabled'
                    session.commit()
                with self.assertRaises(AuthError):
                    load_sprint_catalog(
                        self.context, config=config, database_url=self.database_url,
                    )
                with self.assertRaises(AuthError):
                    read_catalog_completion(
                        self.context, kind='sprints', attempt_id=claim.attempt_id,
                        expected_identity=claim.identity, resolve_config=self.resolve,
                        database_url=self.database_url,
                    )

    def test_browser_session_and_verified_scope_mutations_reject_publication(self):
        from backend.auth.jira_auth import AuthError
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        unverified = replace(self.context, granted_scopes_verified=False)
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [], database_url=self.database_url,
        )
        with self.assertRaises(AuthError):
            runtime.refresh(
                unverified, kind='sprints', config=self.config(), background=False,
                resolve_config=self.resolve,
            )
        runtime.shutdown()

        for mutation in ('delete', 'change'):
            with self.subTest(mutation=mutation):
                browser_id = str(uuid.uuid4())
                with self.factory() as session:
                    session.query(models.WorkspaceSprintCatalog).delete()
                    session.query(models.BrowserSession).delete()
                    session.add(models.BrowserSession(
                        id=browser_id, user_id=self.context.user_id,
                        workspace_id=self.context.workspace_id,
                        auth_connection_id=self.context.auth_connection_id,
                    ))
                    if mutation == 'change':
                        session.add(models.User(
                            id=f'other-{mutation}', external_provider='test',
                            external_subject=f'other-{mutation}',
                        ))
                    session.commit()
                browser_context = replace(self.context, browser_session_id=browser_id)

                def mutate_browser(**_kwargs):
                    with self.factory() as session:
                        browser = session.get(models.BrowserSession, browser_id)
                        if mutation == 'delete':
                            session.delete(browser)
                        else:
                            browser.user_id = f'other-{mutation}'
                        session.commit()
                    return []

                runtime = CatalogRefreshRuntime(
                    fetch_sprints=mutate_browser, database_url=self.database_url,
                )
                with self.assertRaises(AuthError):
                    runtime.refresh(
                        browser_context, kind='sprints', config=self.config(),
                        background=False, resolve_config=self.resolve,
                    )
                with self.factory() as session:
                    row = session.query(models.WorkspaceSprintCatalog).one()
                    self.assertIsNone(row.validated_at)
                    self.assertEqual(row.failure_code, 'auth_required')
                runtime.shutdown()

    def test_real_wrapper_retry_exhaustion_never_publishes_partial_catalog(self):
        from backend.services.catalog_refresh_runtime import (
            CatalogRefreshBudget,
            CatalogRefreshRuntime,
        )

        class FastEvent:
            def __init__(self):
                self._set = False

            def is_set(self):
                return self._set

            def set(self):
                self._set = True

            def wait(self, _seconds):
                return self._set

        context, key_env, _stored = self._install_real_wrapper_auth()
        with self.factory() as session:
            config = self.resolve(session, context)

        def budget_factory():
            budget = CatalogRefreshBudget.start()
            budget.cancelled = FastEvent()
            return budget

        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            database_url=self.database_url, budget_factory=budget_factory,
        )
        with patch.dict(os.environ, {
            **key_env, 'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
        }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(jira_server, 'JIRA_URL', context.site_url), \
                patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('unexpected refresh')), \
                patch.object(jira_server.HTTP_SESSION, 'get', return_value=self._http_response(503, {
                    'detail': 'sensitive partial failure',
                })) as jira_get:
            claim = runtime.refresh(
                context, kind='sprints', config=config, background=False,
                resolve_config=self.resolve,
            )
        self.assertIsNotNone(claim)
        self.assertEqual(jira_get.call_count, 4)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).one()
            self.assertIsNone(row.validated_at)
            self.assertEqual(row.failure_code, 'jira_unavailable')
        runtime.shutdown()

        class Clock:
            value = 100.0

            def __call__(self):
                return self.value

        clock = Clock()
        physical_timeouts = []
        original_resilient = jira_server._jira_client.resilient_jira_get

        def threshold_resilient(*args, **kwargs):
            kwargs['now_fn'] = clock
            return original_resilient(*args, **kwargs)

        def threshold_get(_url, **kwargs):
            physical_timeouts.append(kwargs['timeout'])
            clock.value += 3.5
            return self._http_response(503, {'detail': 'sanitized'})

        def threshold_budget():
            budget = CatalogRefreshBudget.start(12, now_fn=clock)
            budget.cancelled = FastEvent()
            return budget

        with self.factory() as session:
            session.query(models.WorkspaceSprintCatalog).delete()
            session.commit()
        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            database_url=self.database_url, budget_factory=threshold_budget,
        )
        with patch.dict(os.environ, {
            **key_env, 'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
        }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(jira_server, 'JIRA_URL', context.site_url), \
                patch.object(jira_server.HTTP_SESSION, 'post', side_effect=AssertionError('unexpected refresh')), \
                patch.object(jira_server.HTTP_SESSION, 'get', side_effect=threshold_get), \
                patch.object(jira_server._jira_client, 'resilient_jira_get', side_effect=threshold_resilient):
            threshold_claim = runtime.refresh(
                context, kind='sprints', config=config, background=False,
                resolve_config=self.resolve,
            )
        self.assertIsNotNone(threshold_claim)
        self.assertEqual(len(physical_timeouts), 3)
        self.assertGreaterEqual(clock.value - 100.0, 10.0)
        self.assertTrue(all(
            later[1] < earlier[1]
            for earlier, later in zip(physical_timeouts, physical_timeouts[1:])
        ))
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).one()
            self.assertIsNone(row.validated_at)
            self.assertEqual(row.failure_code, 'jira_unavailable')
        runtime.shutdown()

    def test_failed_cleanup_cannot_clear_new_lease_owner(self):
        from backend.services.catalog_refresh_runtime import CatalogRefreshBudget

        config = self.config()
        budget = CatalogRefreshBudget.start()
        first = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=config,
            owner=str(uuid.uuid4()), budget=budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).one()
            row.refresh_lease_until = datetime.now(timezone.utc) - timedelta(seconds=1)
            row.attempt_deadline_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            session.commit()
        second = claim_catalog_refresh(
            self.context, kind='sprints', expected_config=config,
            owner=str(uuid.uuid4()), budget=budget,
            resolve_config=self.resolve, database_url=self.database_url,
        )
        self.assertIsNotNone(second)
        self.assertFalse(finish_catalog_failure(
            self.context, claim=first, failure_code='jira_unavailable',
            budget=budget, database_url=self.database_url,
        ))
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintCatalog).one()
            self.assertEqual(row.refresh_lease_owner, second.owner)
            self.assertEqual(row.refresh_attempt_id, second.attempt_id)
            self.assertEqual(row.refresh_status, 'pending')
            self.assertIsNone(row.failure_code)

    def test_real_wrapper_budget_exhausted_between_team_pages(self):
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        context, key_env, _stored = self._install_real_wrapper_auth()
        with self.factory() as session:
            config = self.resolve(session, context)

        def fetch_teams(*, context, diagnostic_transport, budget, **_kwargs):
            response = jira_server.current_jira_search(
                {'jql': 'project = DEMO', 'maxResults': 100, 'fields': ['customfield_1']},
                context=context, timeout=min(15, budget.remaining('team_page')),
                diagnostic_transport=diagnostic_transport,
            )
            self.assertFalse(response.json()['isLast'])
            budget.cancel()
            budget.check('team_page')
            raise AssertionError('unreachable')

        runtime = CatalogRefreshRuntime(
            fetch_sprints=jira_server.fetch_board_sprints,
            fetch_teams=fetch_teams, database_url=self.database_url,
        )
        with patch.dict(os.environ, {
            **key_env, 'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
        }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(jira_server, 'JIRA_URL', context.site_url), \
                patch.object(jira_server.HTTP_SESSION, 'get', return_value=self._http_response(200, {
                    'issues': [], 'isLast': False, 'nextPageToken': 'next-token',
                })) as jira_get:
            claim = runtime.refresh(
                context, kind='teams', sprint_id='5', config=config,
                background=False, resolve_config=self.resolve,
            )
        self.assertIsNotNone(claim)
        self.assertEqual(jira_get.call_count, 1)
        with self.factory() as session:
            row = session.query(models.WorkspaceSprintTeamCatalog).one()
            self.assertIsNone(row.validated_at)
            self.assertEqual(row.refresh_status, 'pending')
        runtime.shutdown()


if __name__ == '__main__':
    unittest.main()
