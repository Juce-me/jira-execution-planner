import os
import base64
import json
import tempfile
import unittest
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
import requests
from sqlalchemy.exc import OperationalError

import jira_server
from backend.auth.context import RequestAuthContext
from backend.auth import db_tokens as db_tokens_module
from backend.auth import home_credentials as home_credentials_module
from backend.auth.key_provider import key_provider_from_env
from backend.db import engine as db_engine
from backend.db import models
from backend.routes import settings_routes
from backend.services.workspace_dashboard_config import acquire_workspace_config_fence
from backend.services.workspace_catalog_config import build_sprint_catalog_identity
from backend.services.catalog_refresh_runtime import reset_catalog_refresh_runtime_for_tests
from backend.services.catalog_refresh_runtime import CatalogCompletionError


class _FenceOrig(Exception):
    def __init__(self, sqlstate):
        super().__init__(f'sensitive SQL {sqlstate}')
        self.sqlstate = sqlstate


def _raise_real_fence_error(sqlstate):
    session = Mock()
    session.bind.dialect.name = 'postgresql'
    session.execute.side_effect = OperationalError(
        'SELECT set_config(...)', {}, _FenceOrig(sqlstate),
    )
    acquire_workspace_config_fence(session, 'workspace-1')


class PersistentCatalogRouteTests(unittest.TestCase):
    CACHE_KEYS = {
        'backend', 'identity', 'browserContextId', 'boardId', 'scopeDigest',
        'catalogVersion', 'validatedAt', 'state',
        'refreshStarted', 'refreshFailed', 'refreshAttemptId', 'refreshStatus',
        'refreshDeadlineAt', 'failureCode', 'retryAt',
    }

    def _assert_catalog_headers(self, response):
        self.assertEqual(response.headers.get('Cache-Control'), 'no-store')
        self.assertRegex(response.headers.get('Server-Timing', ''), r'^catalog_db;dur=\d+(?:\.\d+)?$')

    def _assert_cache_schema(self, response, state):
        self._assert_catalog_headers(response)
        cache = response.get_json()['cache']
        self.assertEqual(set(cache), self.CACHE_KEYS)
        self.assertEqual(cache['backend'], 'postgresql')
        self.assertEqual(cache['state'], state)

    @contextmanager
    def _db_catalog(self, *, board_id='17', payload=None, stale=False,
                    status='idle', failure_code=None):
        reset_catalog_refresh_runtime_for_tests()
        tmpdir = tempfile.TemporaryDirectory()
        database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir.name, 'route.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(database_url))
        factory = db_engine.session_factory(database_url)
        scopes = tuple(jira_server.ATLASSIAN_SCOPES.split())
        key_env = {
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([29]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'route-key',
        }
        with factory() as session:
            workspace = models.Workspace(
                environment_key='route', name='Route', jira_site_url='https://route.example.test',
                jira_cloud_id='route-cloud',
            )
            user = models.User(
                id='route-user', external_provider='atlassian', external_subject='route-user',
            )
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                id='route-connection', user_id=user.id, workspace_id=workspace.id,
                provider='atlassian_oauth', cloud_id='route-cloud',
                site_url='https://route.example.test', scopes=list(scopes),
                scope_provenance='provider',
            )
            session.add(connection)
            session.flush()
            db_tokens_module._replace_token(
                session, connection=connection, workspace=workspace,
                token_kind='access_token', plaintext='route-access',
                key_provider=key_provider_from_env(key_env),
            )
            connection.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=workspace.id,
                payload={'board': {'boardId': board_id}} if board_id else {'board': {}},
                config_revision=1,
            ))
            if payload is not None:
                now = datetime.now(timezone.utc)
                attempt_id = str(uuid.uuid4()) if status != 'idle' else None
                identity = build_sprint_catalog_identity(workspace.id, '17')
                session.add(models.WorkspaceSprintCatalog(
                    workspace_id=workspace.id, board_id='17', sprints=payload,
                    validated_at=now, catalog_version=str(uuid.uuid4()),
                    next_refresh_at=now - timedelta(seconds=1) if stale else now + timedelta(hours=1),
                    refresh_status=status, refresh_attempt_id=attempt_id,
                    attempt_identity=identity if attempt_id else None,
                    attempt_config_digest='d' * 64 if attempt_id else None,
                    attempt_deadline_at=now + timedelta(minutes=1) if attempt_id else None,
                    refresh_lease_owner=attempt_id if status == 'pending' else None,
                    refresh_lease_until=now + timedelta(minutes=2) if status == 'pending' else None,
                    failure_code=failure_code,
                    last_failure_at=now if failure_code else None,
                    retry_at=now + timedelta(minutes=5) if failure_code else None,
                    updated_by=user.id,
                ))
            session.commit()
            workspace_id = workspace.id
        context = RequestAuthContext(
            auth_mode='atlassian_oauth', user_id='route-user', stable_subject='route-user',
            atlassian_account_id='route-user', workspace_id=workspace_id,
            auth_connection_id='route-connection', cloud_id='route-cloud',
            site_url='https://route.example.test', token_version='1', account_status='active',
            is_admin=True, granted_scopes=scopes, granted_scopes_verified=True,
        )
        client = jira_server.app.test_client()
        with client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {
                'db_auth_connection_id': 'route-connection', 'db_token_version': '1',
            }
        try:
            forbidden = (
                'current_jira_request', 'jira_search_request',
                'oauth_session_data', 'save_oauth_session', 'oauth_refresh_lock',
                'oauth_session_data_for_auth_context',
                'save_oauth_session_for_auth_context',
                'oauth_refresh_lock_for_auth_context', 'fetch_teams_from_jira_api',
            )
            forbidden_patches = [
                patch.object(
                    jira_server, name,
                    side_effect=AssertionError(f'forbidden DB catalog path reached: {name}'),
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
            forbidden_patches.extend(
                patch.object(
                    jira_server._LOCAL_OAUTH_STORE, name,
                    side_effect=AssertionError(f'forbidden local OAuth store reached: {name}'),
                ) for name in local_store_methods
            )
            forbidden_patches.extend((
                patch.object(
                    home_credentials_module, 'resolve_home_credential',
                    side_effect=AssertionError('forbidden Home credential resolver reached'),
                ),
                patch.object(
                    home_credentials_module, '_resolve_service_credential',
                    side_effect=AssertionError('forbidden service credential resolver reached'),
                ),
            ))
            for forbidden_patch in forbidden_patches:
                forbidden_patch.start()
            with patch.dict(os.environ, {
                'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': database_url,
                'TEST_DATABASE_URL': '', **key_env,
            }, clear=False), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                    patch.object(jira_server, 'JIRA_URL', 'https://route.example.test'):
                try:
                    yield client, factory, context
                finally:
                    for forbidden_patch in reversed(forbidden_patches):
                        forbidden_patch.stop()
        finally:
            reset_catalog_refresh_runtime_for_tests()
            db_engine.dispose_engines()
            tmpdir.cleanup()

    @staticmethod
    def _response(status, payload):
        response = requests.Response()
        response.status_code = status
        response._content = json.dumps(payload).encode('utf-8')
        response._content_consumed = True
        response.headers['Content-Type'] = 'application/json'
        return response

    def _assert_response(self, response):
        if isinstance(response, tuple):
            body, status = response
        else:
            body, status = response, response.status_code
        self.assertEqual(status, 503)
        payload = body.get_json()
        self.assertEqual(payload['error'], 'config_storage_unavailable')
        self.assertNotIn('55P03', body.get_data(as_text=True))
        self.assertNotIn('57014', body.get_data(as_text=True))

    def test_config_fence_timeout_is_sanitized_across_section_routes(self):
        settings_routes._sync_server_globals()
        cases = (
            (settings_routes.save_board_config_endpoint, '/api/board-config', {'boardId': '7', 'boardName': '', 'baseRevision': 0}, {}),
            (settings_routes.save_selected_projects, '/api/projects/selected', {'selected': [{'key': 'DEMO'}], 'baseRevision': 0}, {'load_dashboard_config': Mock(return_value={})}),
            (settings_routes.save_stats_priority_weights_config_endpoint, '/api/stats/priority-weights-config', {'weights': [], 'baseRevision': 0}, {}),
            (settings_routes.save_issue_types_config_endpoint, '/api/issue-types/config', {'issueTypes': [], 'baseRevision': 0}, {}),
        )
        for sqlstate in ('55P03', '57014'):
          for handler, path, payload, extras in cases:
            with self.subTest(sqlstate=sqlstate, path=path), jira_server.app.test_request_context(path, method='POST', json=payload), \
                    patch.object(settings_routes, 'config_storage_db_enabled', return_value=True), \
                    patch.object(settings_routes, '_persist_shared_section', side_effect=lambda *_args, **_kwargs: _raise_real_fence_error(sqlstate)):
                patches = [patch.object(settings_routes, name, value) for name, value in extras.items()]
                for item in patches:
                    item.start()
                try:
                    self._assert_response(handler())
                finally:
                    for item in reversed(patches):
                        item.stop()

          with jira_server.app.test_request_context('/api/capacity/config', method='POST', json={
            'project': 'CAP', 'fieldId': 'customfield_1', 'baseRevision': 0,
        }), patch.object(settings_routes, 'current_request_auth_context', return_value=Mock(auth_mode='atlassian_oauth')), \
                patch.object(settings_routes, '_shared_capacity_db_auth_context', return_value=Mock()), \
                patch.object(settings_routes, 'load_current_site_field_catalog', return_value=[]), \
                patch.object(settings_routes.shared_capacity_config, 'save_shared_capacity_config', side_effect=lambda *_args, **_kwargs: _raise_real_fence_error(sqlstate)):
            self._assert_response(settings_routes.save_capacity_config_endpoint())

          repository = Mock()
          repository.save_team_catalog.side_effect = lambda *_args, **_kwargs: _raise_real_fence_error(sqlstate)
          with jira_server.app.test_request_context('/api/team-catalog', method='POST', json={
            'catalog': {'a': {'id': 'a', 'name': 'Alpha'}}, 'merge': True,
        }), patch.object(settings_routes, 'config_storage_db_enabled', return_value=True), \
                patch.object(settings_routes, 'db_repository', return_value=repository), \
                patch.object(settings_routes, 'current_request_auth_context', return_value=Mock()):
            self._assert_response(settings_routes.post_team_catalog())

          with jira_server.app.test_request_context('/api/team-field/config', method='POST', json={
            'fieldId': 'customfield_1', 'fieldName': 'Team', 'baseRevision': 0,
        }), patch.object(jira_server, 'config_storage_db_enabled', return_value=True), \
                patch.object(jira_server, 'save_dashboard_config_section', side_effect=lambda *_args, **_kwargs: _raise_real_fence_error(sqlstate)):
            self._assert_response(jira_server._save_field_config('teamField'))

    def test_cache_hit_auth_and_field_resolution_do_not_call_jira(self):
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, _factory, _context), \
                patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('cache hit called Jira')), \
                patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('cache hit searched Jira')):
            response = client.get('/api/sprints')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['sprints'], [{'id': 101, 'name': '2026Q3'}])
        self.assertEqual(body['cache']['backend'], 'postgresql')
        self.assertEqual(body['cache']['state'], 'fresh')
        self.assertIn('catalog_db;dur=', response.headers['Server-Timing'])

    def test_removed_board_409_never_returns_old_list(self):
        with self._db_catalog(board_id='', payload=[{'id': 101, 'name': 'old'}]) as (client, _factory, _context), \
                patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('removed Board called Jira')):
            response = client.get('/api/sprints')
        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'error': 'sprint_board_required'})

    def test_completion_rejects_wrong_identity_new_attempt_and_mixed_force(self):
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, _factory, _context):
            mixed = client.get(
                '/api/sprints?refresh=true&completionAttemptId='
                f'{uuid.uuid4()}&catalogIdentity=sc1:wrong'
            )
            wrong = client.get(
                '/api/sprints?completionAttemptId='
                f'{uuid.uuid4()}&catalogIdentity=sc1:wrong'
            )
        self.assertEqual(mixed.status_code, 400)
        self.assertEqual(mixed.get_json(), {'error': 'invalid_catalog_completion'})
        self.assertEqual(wrong.status_code, 409)
        self.assertEqual(wrong.get_json()['error'], 'catalog_identity_changed')

    def test_sprints_rejects_unsupported_parameters_and_nonliteral_refresh(self):
        unsupported = (
            'workspaceId=w', 'userId=u', 'boardId=17', 'projects=DEMO',
            'field=customfield_1', 'jql=project%20%3D%20DEMO', 'source=db',
            'unknown=value', 't=1790149010531',
        )
        invalid_refresh = ('refresh=', 'refresh=false', 'refresh=TRUE', 'refresh=1')
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, _factory, _context):
            for query in unsupported:
                with self.subTest(query=query):
                    response = client.get(f'/api/sprints?{query}')
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.get_json(), {'error': 'unsupported_catalog_parameter'})
                    self._assert_catalog_headers(response)
            for query in invalid_refresh:
                with self.subTest(query=query):
                    response = client.get(f'/api/sprints?{query}')
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.get_json(), {'error': 'invalid_catalog_completion'})
                    self._assert_catalog_headers(response)

    def test_teams_rejects_legacy_cache_busting_parameter(self):
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, _factory, _context):
            response = client.get('/api/teams?sprint=101&all=true&_t=1790149010531')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'unsupported_catalog_parameter'})
        self._assert_catalog_headers(response)

    def test_outer_db_auth_failure_uses_global_recovery_without_catalog_work(self):
        failure = jira_server.AuthError('auth_required', 'raw upstream detail')
        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}],
        ):
            settings_routes._sync_server_globals()
            with jira_server.app.test_request_context('/api/sprints'), \
                    patch.object(settings_routes, 'current_request_auth_context', side_effect=failure), \
                    patch.object(settings_routes, 'current_jira_get', side_effect=AssertionError('Jira reached')), \
                    patch.object(settings_routes, 'catalog_refresh_runtime', side_effect=AssertionError('runtime reached')), \
                    patch.object(settings_routes, 'load_sprint_catalog', side_effect=AssertionError('cache reached')):
                response = settings_routes.get_sprints()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        })
        self.assertNotIn('raw upstream detail', response.get_data(as_text=True))
        self._assert_catalog_headers(response)

    def test_exact_catalog_envelopes_and_headers_for_all_states(self):
        runtime = Mock()
        runtime.refresh.return_value = None
        cases = (
            ('fresh', {'payload': [{'id': 1, 'name': '2026Q3'}]}, 200, 'sprints'),
            ('stale', {'payload': [{'id': 1, 'name': '2026Q3'}], 'stale': True}, 200, 'sprints'),
            ('refreshing', {'payload': [{'id': 1, 'name': '2026Q3'}], 'status': 'pending'}, 200, 'sprints'),
            ('missing', {'payload': None}, 503, 'error'),
            ('failed', {
                'payload': [{'id': 1, 'name': '2026Q3'}],
                'status': 'failed', 'failure_code': 'jira_unavailable',
            }, 200, 'sprints'),
        )
        for state, fixture, status, result_key in cases:
            with self.subTest(state=state), self._db_catalog(**fixture) as (client, _factory, _context), \
                    patch.object(jira_server, 'catalog_refresh_runtime', return_value=runtime):
                response = client.get('/api/sprints')
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertEqual(set(response.get_json()), {result_key, 'cache'})
                self._assert_cache_schema(response, state)
                if state == 'missing':
                    self.assertNotIn('Retry-After', response.headers)

    def test_submit_failure_reports_refresh_started_false(self):
        from backend.services.catalog_refresh_runtime import CatalogRefreshRuntime

        executor = Mock()
        executor.submit.side_effect = RuntimeError('executor closed')
        runtime = CatalogRefreshRuntime(
            fetch_sprints=lambda **_kwargs: [],
            executor_factory=lambda **_kwargs: executor,
        )
        with self._db_catalog(
            payload=[{'id': 101, 'name': 'old'}], stale=True,
        ) as (client, _factory, _context), patch.object(
            jira_server, 'catalog_refresh_runtime', return_value=runtime,
        ):
            response = client.get('/api/sprints')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertFalse(response.get_json()['cache']['refreshStarted'])
        self.assertEqual(response.get_json()['cache']['refreshStatus'], 'failed')

    def test_cold_runtime_saturation_returns_immediately_without_pollable_attempt(self):
        runtime = Mock()
        runtime.refresh.return_value = None
        with self._db_catalog(payload=None) as (client, _factory, _context), \
                patch.object(jira_server, 'catalog_refresh_runtime', return_value=runtime), \
                patch.object(jira_server.time, 'sleep', side_effect=AssertionError('cold saturation polled')), \
                patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('cold saturation called Jira')):
            # Time only the request; DB fixture setup is not part of the route's latency contract.
            before = __import__('time').monotonic()
            response = client.get('/api/sprints')
            elapsed = __import__('time').monotonic() - before
        self.assertLess(elapsed, 0.5)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(set(response.get_json()), {'error', 'cache'})
        self.assertEqual(response.get_json()['error'], 'catalog_refresh_pending')
        cache = response.get_json()['cache']
        self.assertEqual(cache['state'], 'missing')
        self.assertEqual(cache['refreshStatus'], 'idle')
        self.assertIsNone(cache['refreshAttemptId'])
        self.assertFalse(cache['refreshStarted'])
        self.assertNotIn('Retry-After', response.headers)
        self._assert_catalog_headers(response)
        runtime.refresh.assert_called_once()

    def test_unexpected_db_sprint_failure_logs_traceback_and_sanitizes_response(self):
        raw = RuntimeError('synthetic-secret-payload')
        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}],
        ) as (client, _factory, _context), \
                patch.object(settings_routes, 'load_sprint_catalog', side_effect=raw), \
                patch.object(jira_server.logger, 'exception') as logged:
            response = client.get('/api/sprints')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {'error': 'catalog_storage_unavailable'})
        self.assertNotIn('synthetic-secret-payload', response.get_data(as_text=True))
        self._assert_catalog_headers(response)
        logged.assert_called_once_with('Sprint catalog request failed')

    def test_completion_pending_completed_and_failed_keep_same_attempt(self):
        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}], status='pending',
        ) as (client, factory, context):
            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                attempt_id = row.refresh_attempt_id
                identity = row.attempt_identity
            url = (
                f'/api/sprints?completionAttemptId={attempt_id}'
                f'&catalogIdentity={identity}'
            )
            pending = client.get(url)
            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                row.refresh_status = 'completed'
                row.refresh_lease_owner = row.refresh_lease_until = None
                session.commit()
            completed = client.get(url)
            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                now = datetime.now(timezone.utc)
                row.refresh_status = 'failed'
                row.failure_code = 'jira_unavailable'
                row.last_failure_at = now
                row.retry_at = now + timedelta(minutes=5)
                session.commit()
            failed = client.get(url)

        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.get_json()['cache']['refreshStatus'], 'pending')
        self.assertEqual(completed.get_json()['cache']['refreshStatus'], 'completed')
        self.assertEqual(failed.get_json()['cache']['refreshStatus'], 'failed')
        self.assertTrue(failed.get_json()['cache']['refreshFailed'])
        self.assertEqual({
            pending.get_json()['cache']['refreshAttemptId'],
            completed.get_json()['cache']['refreshAttemptId'],
            failed.get_json()['cache']['refreshAttemptId'],
        }, {attempt_id})

    def test_completion_reads_never_admit_jira(self):
        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}], status='pending',
        ) as (client, factory, _context), \
                patch.object(jira_server, 'catalog_refresh_runtime', side_effect=AssertionError('completion admitted runtime')), \
                patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('completion called Jira')):
            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                url = (
                    f'/api/sprints?completionAttemptId={row.refresh_attempt_id}'
                    f'&catalogIdentity={row.attempt_identity}'
                )
            response = client.get(url)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_cached_user_b_reuses_user_a_snapshot(self):
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, context):
            first = client.get('/api/sprints')
            with factory() as session:
                user = models.User(
                    id='route-user-b', external_provider='atlassian',
                    external_subject='route-user-b',
                )
                session.add(user)
                session.flush()
                session.add(models.AuthConnection(
                    id='route-connection-b', user_id=user.id,
                    workspace_id=context.workspace_id, provider='atlassian_oauth',
                    cloud_id='route-cloud', site_url='https://route.example.test',
                    scopes=list(jira_server.ATLASSIAN_SCOPES.split()),
                    scope_provenance='provider',
                ))
                session.commit()
            client_b = jira_server.app.test_client()
            with client_b.session_transaction() as flask_session:
                flask_session['db_oauth_session'] = {
                    'db_auth_connection_id': 'route-connection-b',
                    'db_token_version': '1',
                }
            with patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('shared hit called Jira')):
                second = client_b.get('/api/sprints')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        self.assertEqual(second.get_json()['sprints'], first.get_json()['sprints'])
        self.assertEqual(second.get_json()['cache']['catalogVersion'], first.get_json()['cache']['catalogVersion'])
        self.assertNotEqual(second.get_json()['cache']['browserContextId'], first.get_json()['cache']['browserContextId'])

    def test_revoked_reader_cannot_read_shared_hit(self):
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, context):
            warm = client.get('/api/sprints')
            self.assertEqual(warm.status_code, 200)
            with factory() as session:
                session.get(models.AuthConnection, context.auth_connection_id).status = 'revoked'
                session.commit()
            with patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('revoked read called Jira')):
                denied = client.get('/api/sprints')
            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                stored_payload = row.sprints
        self.assertEqual(denied.status_code, 401, denied.get_data(as_text=True))
        self.assertEqual(denied.get_json(), {
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        })
        self._assert_catalog_headers(denied)
        self.assertEqual(stored_payload, [{'id': 101, 'name': '2026Q3'}])

    def test_cached_completion_and_refresh_auth_failures_use_global_recovery_envelope(self):
        expected = {
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        }
        failure = jira_server.AuthError('auth_required', 'raw upstream detail')
        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}],
        ) as (client, _factory, _context), patch.object(
            settings_routes, 'load_sprint_catalog', side_effect=failure,
        ):
            cached = client.get('/api/sprints')
        self.assertEqual(cached.status_code, 401)
        self.assertEqual(cached.get_json(), expected)
        self.assertNotIn('raw upstream detail', cached.get_data(as_text=True))
        self._assert_catalog_headers(cached)

        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}], status='pending',
        ) as (client, factory, _context), patch.object(
            jira_server, 'read_catalog_completion', side_effect=failure,
        ):
            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                completion_url = (
                    f'/api/sprints?completionAttemptId={row.refresh_attempt_id}'
                    f'&catalogIdentity={row.attempt_identity}'
                )
            completion = client.get(completion_url)
        self.assertEqual(completion.status_code, 401)
        self.assertEqual(completion.get_json(), expected)
        self.assertNotIn('raw upstream detail', completion.get_data(as_text=True))
        self._assert_catalog_headers(completion)

        with self._db_catalog(
            payload=[{'id': 101, 'name': '2026Q3'}], stale=True,
        ) as (client, _factory, _context), patch.object(
            jira_server.catalog_refresh_runtime(), 'refresh',
            side_effect=failure,
        ):
            refresh = client.get('/api/sprints')
        self.assertEqual(refresh.status_code, 401)
        self.assertEqual(refresh.get_json(), expected)
        self.assertNotIn('raw upstream detail', refresh.get_data(as_text=True))
        self._assert_catalog_headers(refresh)

    def test_cold_fill_empty_and_failed_backoff(self):
        with self._db_catalog(payload=None) as (client, factory, _context), \
                patch.object(jira_server.HTTP_SESSION, 'get', return_value=self._response(200, {
                    'values': [], 'startAt': 0, 'maxResults': 100, 'isLast': True,
                })) as jira_get:
            empty = client.get('/api/sprints')
            self.assertEqual(empty.status_code, 200, empty.get_data(as_text=True))
            self.assertEqual(empty.get_json()['sprints'], [])
            self.assertEqual(empty.get_json()['cache']['state'], 'fresh')
            self.assertEqual(jira_get.call_count, 1)

            with factory() as session:
                row = session.query(models.WorkspaceSprintCatalog).one()
                now = datetime.now(timezone.utc)
                row.validated_at = row.catalog_version = row.next_refresh_at = None
                row.refresh_status = 'failed'
                row.failure_code = 'jira_unavailable'
                row.last_failure_at = now
                row.retry_at = now + timedelta(minutes=5)
                session.commit()
            jira_get.reset_mock()
            failed = client.get('/api/sprints')
        self.assertEqual(failed.status_code, 502, failed.get_data(as_text=True))
        self.assertEqual(failed.get_json()['error'], 'sprint_catalog_unavailable')
        self.assertEqual(failed.get_json()['cache']['state'], 'failed')
        jira_get.assert_not_called()

    def test_capped_board_page_cold_fills_and_caches_sprints(self):
        page = {
            'values': [{
                'id': 101, 'name': '2026Q3', 'state': 'active', 'originBoardId': 17,
            }],
            'startAt': 0, 'maxResults': 50, 'isLast': True,
        }
        with self._db_catalog(payload=None) as (client, _factory, _context), \
                patch.object(jira_server.HTTP_SESSION, 'get',
                             return_value=self._response(200, page)) as jira_get:
            cold = client.get('/api/sprints')
            cached = client.get('/api/sprints')

        self.assertEqual(cold.status_code, 200, cold.get_data(as_text=True))
        self.assertEqual(cold.get_json()['sprints'], [{
            'id': 101, 'name': '2026Q3', 'state': 'active',
            'startDate': None, 'endDate': None,
        }])
        self.assertEqual(cold.get_json()['cache']['state'], 'fresh')
        self.assertEqual(cached.status_code, 200, cached.get_data(as_text=True))
        self.assertEqual(cached.get_json()['cache']['catalogVersion'],
                         cold.get_json()['cache']['catalogVersion'])
        self.assertEqual(jira_get.call_count, 1)

    def test_force_retry_bypasses_failed_backoff_but_never_active_lease(self):
        release = __import__('threading').Event()
        started = __import__('threading').Event()

        def held_get(_url, **_kwargs):
            started.set()
            release.wait(2)
            return self._response(200, {
                'values': [], 'startAt': 0, 'maxResults': 100, 'isLast': True,
            })

        try:
            with self._db_catalog(
                payload=[{'id': 101, 'name': 'old'}],
                status='failed', failure_code='jira_unavailable',
            ) as (client, factory, _context), \
                    patch.object(jira_server.HTTP_SESSION, 'get', side_effect=held_get) as jira_get:
                forced = client.get('/api/sprints?refresh=true')
                self.assertTrue(started.wait(1))
                coalesced = client.get('/api/sprints?refresh=true')
                self.assertEqual(forced.status_code, 200, forced.get_data(as_text=True))
                self.assertTrue(forced.get_json()['cache']['refreshStarted'])
                self.assertEqual(forced.get_json()['cache']['refreshStatus'], 'pending')
                self.assertEqual(coalesced.status_code, 200)
                self.assertFalse(coalesced.get_json()['cache']['refreshStarted'])
                self.assertEqual(
                    coalesced.get_json()['cache']['refreshAttemptId'],
                    forced.get_json()['cache']['refreshAttemptId'],
                )
                self.assertEqual(jira_get.call_count, 1)
                release.set()
                deadline = __import__('time').monotonic() + 2
                while __import__('time').monotonic() < deadline:
                    with factory() as session:
                        if session.query(models.WorkspaceSprintCatalog).one().refresh_status != 'pending':
                            break
                    __import__('time').sleep(0.01)
        finally:
            release.set()

    def test_stale_hit_returns_before_held_worker(self):
        release = __import__('threading').Event()
        started = __import__('threading').Event()

        def held_get(_url, **_kwargs):
            started.set()
            release.wait(2)
            return self._response(200, {
                'values': [], 'startAt': 0, 'maxResults': 100, 'isLast': True,
            })

        try:
            with self._db_catalog(
                payload=[{'id': 101, 'name': 'old'}], stale=True,
            ) as (client, factory, _context), \
                    patch.object(jira_server.HTTP_SESSION, 'get', side_effect=held_get) as jira_get:
                before = __import__('time').monotonic()
                stale = client.get('/api/sprints')
                elapsed = __import__('time').monotonic() - before
                self.assertEqual(stale.status_code, 200, stale.get_data(as_text=True))
                self.assertLess(elapsed, 1)
                self.assertEqual(stale.get_json()['sprints'], [{'id': 101, 'name': 'old'}])
                self.assertTrue(stale.get_json()['cache']['refreshStarted'])
                self.assertTrue(started.wait(1))
                cache = stale.get_json()['cache']
                completion = client.get(
                    '/api/sprints?completionAttemptId='
                    f"{cache['refreshAttemptId']}&catalogIdentity={cache['identity']}"
                )
                self.assertEqual(completion.status_code, 200)
                self.assertEqual(completion.get_json()['cache']['refreshStatus'], 'pending')
                self.assertEqual(jira_get.call_count, 1)
                release.set()
                deadline = __import__('time').monotonic() + 2
                while __import__('time').monotonic() < deadline:
                    with factory() as session:
                        if session.query(models.WorkspaceSprintCatalog).one().refresh_status != 'pending':
                            break
                    __import__('time').sleep(0.01)
        finally:
            release.set()

    def _configure_team_scope(self, factory):
        with factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            row.payload = {
                'board': {'boardId': '17'},
                'projects': [{'key': 'DEMO'}],
                'teamField': {'fieldId': 'customfield_10001'},
            }
            row.config_revision += 1
            session.commit()

    def test_team_miss_fills_once_and_validated_empty_reuses(self):
        calls = []

        def search(payload, **_kwargs):
            calls.append(payload)
            return self._response(200, {'issues': [], 'isLast': True})

        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', side_effect=search):
                first = client.get('/api/teams?sprint=101&all=true')
                second = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(first.get_json()['teams'], [])
        self.assertEqual(first.get_json()['sprintId'], '101')
        self.assertTrue(first.get_json()['cache']['refreshStarted'])
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.get_json()['cache']['refreshStarted'])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], {
            'jql': '((project in ("DEMO"))) AND Sprint = 101',
            'fields': ['customfield_10001'], 'maxResults': 100,
        })

    def test_team_ids_intersect_after_canonical_persistence(self):
        payload = {'issues': [{
            'fields': {'customfield_10001': [
                {'id': 'team-a', 'name': 'Alpha'},
                {'id': 'team-b', 'name': 'Beta'},
            ]},
        }], 'isLast': True}
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', return_value=self._response(200, payload)):
                filled = client.get('/api/teams?sprint=101&teamIds=team-a')
                canonical = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(filled.get_json()['teams'], [{'id': 'team-a', 'name': 'Alpha'}])
        self.assertEqual(
            canonical.get_json()['teams'],
            [{'id': 'team-a', 'name': 'Alpha'}, {'id': 'team-b', 'name': 'Beta'}],
        )

    def test_template_does_not_change_db_membership(self):
        calls = []

        def search(payload, **_kwargs):
            calls.append(payload)
            return self._response(200, {'issues': [], 'isLast': True})

        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'JQL_QUERY_TEMPLATE', 'project = WRONG AND Team = {team_ids}'), \
                    patch.object(jira_server, 'current_jira_search', side_effect=search):
                response = client.get('/api/teams?sprint=101&teamIds=team-a')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(calls[0]['jql'], '((project in ("DEMO"))) AND Sprint = 101')

    def test_unknown_sprint_requires_validated_board_catalog(self):
        with self._db_catalog(payload=None) as (client, factory, _context):
            self._configure_team_scope(factory)
            pending = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(pending.status_code, 503)
        self.assertEqual(pending.get_json(), {'error': 'sprint_catalog_pending'})
        with self._db_catalog(payload=[]) as (client, factory, _context):
            self._configure_team_scope(factory)
            unknown = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.get_json(), {'error': 'sprint_not_in_catalog'})

    def test_team_cold_failure_body_and_headers_are_exact(self):
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(
                jira_server, 'current_jira_search',
                return_value=self._response(503, {'detail': 'sensitive'}),
            ):
                response = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(response.status_code, 502)
        self._assert_catalog_headers(response)
        self.assertEqual(set(response.get_json()), {'error', 'cache'})
        self.assertEqual(response.get_json()['error'], 'team_catalog_unavailable')
        self.assertNotIn('sensitive', response.get_data(as_text=True))

    def test_team_completion_conflicts_are_read_only_and_use_current_source(self):
        attempt_id = str(uuid.uuid4())
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, context):
            self._configure_team_scope(factory)
            for code in ('catalog_identity_changed', 'catalog_refresh_superseded'):
                with self.subTest(code=code), \
                        patch.object(
                            jira_server, 'read_catalog_completion',
                            side_effect=CatalogCompletionError(code),
                        ), patch.object(
                            jira_server, 'catalog_refresh_runtime',
                            side_effect=AssertionError('completion admitted refresh work'),
                        ):
                    response = client.get(
                        '/api/teams?sprint=101&all=true&completionAttemptId='
                        f'{attempt_id}&catalogIdentity=tc1:wrong'
                    )
                self.assertEqual(response.status_code, 409)
                self._assert_catalog_headers(response)
                self.assertEqual(
                    set(response.get_json()),
                    {'error', 'teamCatalogSource', 'scopeDigest'},
                )
                self.assertEqual(response.get_json()['error'], code)
                source = response.get_json()['teamCatalogSource']
                self.assertEqual(set(source), {
                    'backend', 'identity', 'boardId', 'browserContextId',
                })
                self.assertEqual(source['backend'], 'postgresql')
                self.assertEqual(source['boardId'], '17')
                self.assertNotEqual(source['identity'], 'tc1:wrong')
                self.assertTrue(source['identity'].startswith('tc1:'))
                self.assertRegex(response.get_json()['scopeDigest'], r'^[0-9a-f]{64}$')
                self.assertNotIn(context.user_id, response.get_data(as_text=True))

    def test_failed_team_refresh_retains_membership_and_names(self):
        initial = {'issues': [{
            'fields': {'customfield_10001': {'id': 'team-a', 'name': 'Alpha'}},
        }], 'isLast': True}
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', return_value=self._response(200, initial)):
                first = client.get('/api/teams?sprint=101&all=true')
            with patch.object(
                jira_server, 'current_jira_search',
                return_value=self._response(503, {'detail': 'sensitive'}),
            ):
                failed = client.get('/api/teams?sprint=101&all=true&refresh=true')
            directory = client.get('/api/team-catalog')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.get_json()['teams'], [{'id': 'team-a', 'name': 'Alpha'}])
        self.assertEqual(failed.get_json()['cache']['state'], 'failed')
        self.assertEqual(directory.get_json()['catalog']['team-a']['name'], 'Alpha')

    def test_force_retry_bypasses_failed_backoff_but_never_active_lease(self):
        calls = []

        def unavailable(payload, **_kwargs):
            calls.append(payload)
            return self._response(503, {})

        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', side_effect=unavailable):
                failed = client.get('/api/teams?sprint=101&all=true')
                backed_off = client.get('/api/teams?sprint=101&all=true')
            with patch.object(
                jira_server, 'current_jira_search',
                return_value=self._response(200, {'issues': [], 'isLast': True}),
            ) as search:
                forced = client.get('/api/teams?sprint=101&all=true&refresh=true')
            self.assertEqual(len(calls), 1)
            self.assertEqual(failed.status_code, 502)
            self.assertEqual(backed_off.status_code, 502)
            self.assertEqual(search.call_count, 1)
            self.assertEqual(forced.status_code, 200)
            with factory() as session:
                row = session.query(models.WorkspaceSprintTeamCatalog).one()
                row.refresh_status = 'pending'
                row.refresh_attempt_id = str(uuid.uuid4())
                row.attempt_identity = row.scope_digest and forced.get_json()['cache']['identity']
                row.attempt_config_digest = 'd' * 64
                row.attempt_scope_digest = row.scope_digest
                row.attempt_deadline_at = datetime.now(timezone.utc) + timedelta(minutes=1)
                row.refresh_lease_owner = row.refresh_attempt_id
                row.refresh_lease_until = datetime.now(timezone.utc) + timedelta(minutes=2)
                session.commit()
            with patch.object(
                jira_server, 'current_jira_search',
                side_effect=AssertionError('active lease performed Jira I/O'),
            ):
                leased = client.get('/api/teams?sprint=101&all=true&refresh=true')
        self.assertEqual(leased.status_code, 200)
        self.assertFalse(leased.get_json()['cache']['refreshStarted'])
        self.assertEqual(leased.get_json()['cache']['state'], 'refreshing')

    def test_team_scope_change_hides_old_snapshot(self):
        initial = {'issues': [{
            'fields': {'customfield_10001': {'id': 'team-a', 'name': 'Alpha'}},
        }], 'isLast': True}
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', return_value=self._response(200, initial)):
                self.assertEqual(client.get('/api/teams?sprint=101&all=true').status_code, 200)
            with factory() as session:
                row = session.query(models.WorkspaceDashboardConfig).one()
                row.payload = {
                    'board': {'boardId': '17'}, 'projects': [{'key': 'OTHER'}],
                    'teamField': {'fieldId': 'customfield_10001'},
                }
                row.config_revision += 1
                session.commit()
            with patch.object(
                jira_server, 'current_jira_search', return_value=self._response(503, {}),
            ):
                changed = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(changed.status_code, 502)
        self.assertEqual(set(changed.get_json()), {'error', 'cache'})
        self.assertNotIn('teams', changed.get_json())

    def test_global_only_team_never_becomes_member(self):
        issue_members = {'issues': [{
            'fields': {'customfield_10001': {'id': 'member', 'name': 'Member'}},
        }], 'isLast': True}
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', return_value=self._response(200, issue_members)), \
                    patch.object(
                        jira_server, 'fetch_teams_from_jira_api',
                        side_effect=AssertionError('global Teams registry reached'),
                    ):
                response = client.get('/api/teams?sprint=101&all=true')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['teams'], [{'id': 'member', 'name': 'Member'}])

    def test_team_completion_is_read_only(self):
        initial = {'issues': [{
            'fields': {'customfield_10001': {'id': 'member', 'name': 'Member'}},
        }], 'isLast': True}
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, _context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', return_value=self._response(200, initial)):
                filled = client.get('/api/teams?sprint=101&all=true')
            cache = filled.get_json()['cache']
            completed_url = (
                '/api/teams?sprint=101&all=true&completionAttemptId='
                f"{cache['refreshAttemptId']}&catalogIdentity={cache['identity']}"
            )
            with patch.object(
                jira_server, 'catalog_refresh_runtime',
                side_effect=AssertionError('completion admitted refresh work'),
            ), patch.object(
                jira_server, 'current_jira_search',
                side_effect=AssertionError('completion contacted Jira'),
            ):
                completed = client.get(completed_url)
            self.assertEqual(completed.status_code, 200)
            self.assertEqual(completed.get_json()['cache']['refreshStatus'], 'completed')

            pending_attempt = str(uuid.uuid4())
            with factory() as session:
                row = session.query(models.WorkspaceSprintTeamCatalog).one()
                row.refresh_status = 'pending'
                row.refresh_attempt_id = pending_attempt
                row.attempt_identity = cache['identity']
                row.attempt_config_digest = 'd' * 64
                row.attempt_scope_digest = cache['scopeDigest']
                row.attempt_deadline_at = datetime.now(timezone.utc) + timedelta(minutes=1)
                row.refresh_lease_owner = pending_attempt
                row.refresh_lease_until = datetime.now(timezone.utc) + timedelta(minutes=2)
                session.commit()
            pending_url = (
                '/api/teams?sprint=101&all=true&completionAttemptId='
                f'{pending_attempt}&catalogIdentity={cache["identity"]}'
            )
            with patch.object(
                jira_server, 'catalog_refresh_runtime',
                side_effect=AssertionError('pending completion admitted refresh work'),
            ):
                pending = client.get(pending_url)
                wrong_attempt = client.get(
                    '/api/teams?sprint=101&all=true&completionAttemptId='
                    f'{uuid.uuid4()}&catalogIdentity={cache["identity"]}'
                )
            self.assertEqual(pending.status_code, 200)
            self.assertEqual(pending.get_json()['cache']['state'], 'refreshing')
            self.assertEqual(wrong_attempt.status_code, 409)
            self.assertEqual(
                set(wrong_attempt.get_json()),
                {'error', 'teamCatalogSource', 'scopeDigest'},
            )
            self.assertEqual(wrong_attempt.get_json()['error'], 'catalog_refresh_superseded')

            with factory() as session:
                row = session.query(models.WorkspaceSprintTeamCatalog).one()
                row.refresh_status = 'failed'
                row.failure_code = 'jira_unavailable'
                row.last_failure_at = datetime.now(timezone.utc)
                row.retry_at = datetime.now(timezone.utc) + timedelta(minutes=5)
                row.refresh_lease_owner = row.refresh_lease_until = None
                session.commit()
            failed = client.get(pending_url)
            self.assertEqual(failed.status_code, 200)
            self.assertEqual(failed.get_json()['cache']['state'], 'failed')
            self.assertEqual(failed.get_json()['teams'], [{'id': 'member', 'name': 'Member'}])

            with factory() as session:
                row = session.query(models.WorkspaceSprintTeamCatalog).one()
                row.validated_at = None
                row.catalog_version = None
                row.refresh_status = 'pending'
                row.failure_code = row.last_failure_at = row.retry_at = None
                row.refresh_lease_owner = pending_attempt
                row.refresh_lease_until = datetime.now(timezone.utc) + timedelta(minutes=2)
                session.commit()
            cold_pending = client.get(pending_url)
        self.assertEqual(cold_pending.status_code, 503)
        self.assertEqual(set(cold_pending.get_json()), {'error', 'cache'})
        self.assertEqual(cold_pending.get_json()['error'], 'catalog_refresh_pending')
        self.assertEqual(cold_pending.headers.get('Retry-After'), '1')

    def test_team_refresh_is_visible_to_other_workspace_users(self):
        initial = {'issues': [{
            'fields': {'customfield_10001': {'id': 'shared', 'name': 'Shared'}},
        }], 'isLast': True}
        key_env = {
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([29]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'route-key',
        }
        with self._db_catalog(payload=[{'id': 101, 'name': '2026Q3'}]) as (client, factory, context):
            self._configure_team_scope(factory)
            with patch.object(jira_server, 'current_jira_search', return_value=self._response(200, initial)):
                owner = client.get('/api/teams?sprint=101&all=true')
            with factory() as session:
                second_user = models.User(
                    id='route-user-b', external_provider='atlassian',
                    external_subject='route-user-b',
                )
                session.add(second_user)
                session.flush()
                second_connection = models.AuthConnection(
                    id='route-connection-b', user_id=second_user.id,
                    workspace_id=context.workspace_id, provider='atlassian_oauth',
                    cloud_id='route-cloud', site_url='https://route.example.test',
                    scopes=list(jira_server.ATLASSIAN_SCOPES.split()),
                    scope_provenance='provider',
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                )
                session.add(second_connection)
                session.flush()
                db_tokens_module._replace_token(
                    session, connection=second_connection,
                    workspace=session.get(models.Workspace, context.workspace_id),
                    token_kind='access_token', plaintext='route-access-b',
                    key_provider=key_provider_from_env(key_env),
                )
                isolated_workspace = models.Workspace(
                    environment_key='route-isolated', name='Route isolated',
                    jira_site_url='https://isolated.example.test',
                    jira_cloud_id='isolated-cloud',
                )
                isolated_user = models.User(
                    id='route-user-c', external_provider='atlassian',
                    external_subject='route-user-c',
                )
                session.add_all([isolated_workspace, isolated_user])
                session.flush()
                isolated_connection = models.AuthConnection(
                    id='route-connection-c', user_id=isolated_user.id,
                    workspace_id=isolated_workspace.id, provider='atlassian_oauth',
                    cloud_id='isolated-cloud', site_url='https://isolated.example.test',
                    scopes=list(jira_server.ATLASSIAN_SCOPES.split()),
                    scope_provenance='provider',
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                )
                session.add_all([
                    isolated_connection,
                    models.WorkspaceDashboardConfig(
                        workspace_id=isolated_workspace.id,
                        payload={
                            'board': {'boardId': '17'},
                            'projects': [{'key': 'DEMO'}],
                            'teamField': {'fieldId': 'customfield_10001'},
                        }, config_revision=1,
                    ),
                    models.WorkspaceSprintCatalog(
                        workspace_id=isolated_workspace.id, board_id='17',
                        sprints=[{'id': 101, 'name': '2026Q3'}],
                        validated_at=datetime.now(timezone.utc),
                        catalog_version=str(uuid.uuid4()),
                        next_refresh_at=datetime.now(timezone.utc) + timedelta(hours=1),
                        refresh_status='idle', updated_by=isolated_user.id,
                    ),
                ])
                session.flush()
                db_tokens_module._replace_token(
                    session, connection=isolated_connection,
                    workspace=isolated_workspace, token_kind='access_token',
                    plaintext='route-access-c',
                    key_provider=key_provider_from_env(key_env),
                )
                session.commit()
            client_b = jira_server.app.test_client()
            with client_b.session_transaction() as flask_session:
                flask_session['db_oauth_session'] = {
                    'db_auth_connection_id': 'route-connection-b', 'db_token_version': '1',
                }
            with patch.object(
                jira_server, 'current_jira_search',
                side_effect=AssertionError('shared workspace cache hit searched Jira'),
            ):
                shared = client_b.get('/api/teams?sprint=101&all=true')
            client_c = jira_server.app.test_client()
            with client_c.session_transaction() as flask_session:
                flask_session['db_oauth_session'] = {
                    'db_auth_connection_id': 'route-connection-c', 'db_token_version': '1',
                }
            isolated_payload = {'issues': [{
                'fields': {'customfield_10001': {'id': 'isolated', 'name': 'Isolated'}},
            }], 'isLast': True}
            with patch.object(
                jira_server, 'current_jira_search',
                return_value=self._response(200, isolated_payload),
            ):
                isolated = client_c.get('/api/teams?sprint=101&all=true')
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(shared.status_code, 200, shared.get_data(as_text=True))
        self.assertEqual(shared.get_json()['teams'], [{'id': 'shared', 'name': 'Shared'}])
        self.assertEqual(shared.get_json()['cache']['catalogVersion'], owner.get_json()['cache']['catalogVersion'])
        self.assertNotEqual(
            shared.get_json()['cache']['browserContextId'],
            owner.get_json()['cache']['browserContextId'],
        )
        self.assertEqual(isolated.status_code, 200, isolated.get_data(as_text=True))
        self.assertEqual(isolated.get_json()['teams'], [{'id': 'isolated', 'name': 'Isolated'}])
        self.assertNotEqual(
            isolated.get_json()['cache']['catalogVersion'],
            owner.get_json()['cache']['catalogVersion'],
        )


if __name__ == '__main__':
    unittest.main()
