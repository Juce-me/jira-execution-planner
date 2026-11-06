import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from flask import session as flask_session
from tests.db_oauth_test_helpers import seed_db_actor

import jira_server
from backend.auth.context import RequestAuthContext
from backend.config.repository import ConfigStorageError
from backend.db import engine as db_engine
from backend.db import models
from backend.db.engine import DatabaseConfigurationError
from backend.routes import settings_routes
from tests.oauth_test_helpers import install_oauth_session
from tests.postgres_test_db import fresh_database_url


class SharedCapacityConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()
        self.database_url = fresh_database_url(self.addCleanup)
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        environment = self._db_env()
        environment.start()
        self.addCleanup(environment.stop)
        with self.factory() as session:
            workspace = {'cloud_id': 'cloud-one', 'site_url': 'https://one.example.test'}
            actor = seed_db_actor(session, workspace=workspace, account_identity='admin', roles=('admin',))
            peer = seed_db_actor(session, workspace=workspace, account_identity='peer-admin', roles=('admin',))
            isolated = seed_db_actor(session,
                workspace={'cloud_id': 'cloud-two', 'site_url': 'https://two.example.test'},
                account_identity='other-admin', roles=('admin',))
            session.commit()
            self.connection_id = actor.connection_id
            self.peer_connection_id = peer.connection_id
            self.isolated_connection_id = isolated.connection_id
        cookie = install_oauth_session(self.client, db_auth_connection_id=self.connection_id)
        self.peer_client = jira_server.app.test_client()
        install_oauth_session(self.peer_client, db_auth_connection_id=self.peer_connection_id)
        self.isolated_client = jira_server.app.test_client()
        install_oauth_session(self.isolated_client, db_auth_connection_id=self.isolated_connection_id)
        with jira_server.app.test_request_context('/'):
            flask_session['db_oauth_session'] = cookie
            self.context = jira_server.current_request_auth_context()

    def tearDown(self):
        db_engine.dispose_engines()

    def _headers(self):
        response = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        token = response.get_json()['csrfToken']
        return {'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token}

    def _db_env(self):
        return patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url}, clear=False)

    def _payload(self):
        return {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity', 'baseRevision': 0}

    def test_capacity_adapter_requires_explicit_json_source_without_request_context(self):
        with self.assertRaises(Exception):
            jira_server.load_request_capacity_config()

    def test_capacity_adapter_json_source_uses_shared_json_compatibility_loader(self):
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={'capacity': {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity'}}):
            result = jira_server.load_request_capacity_config(source='jsonfile')
        self.assertEqual(result['project'], 'CAP')
        self.assertEqual(result['source'], 'file')

    def test_retired_basic_and_local_contexts_cannot_read_json_or_operator_aliases(self):
        for mode, connection in (('basic', 'local-basic'), ('atlassian_oauth', 'local-oauth')):
            context = RequestAuthContext(auth_mode=mode, user_id='local', stable_subject='local',
                atlassian_account_id='local', workspace_id='local-workspace',
                auth_connection_id=connection, cloud_id='cloud-one',
                site_url='https://one.example.test', token_version='1',
                account_status='active', is_admin=True)
            with self.subTest(mode=mode), \
                 patch.object(jira_server, '_load_dashboard_config_json', side_effect=AssertionError('retired JSON read')) as loader, \
                 patch.object(jira_server, 'CAPACITY_PROJECT', 'ALIAS'), \
                 patch.object(jira_server, 'CAPACITY_FIELD_ID', 'customfield_20002'):
                with self.assertRaises(ConfigStorageError):
                    jira_server.load_request_capacity_config(context)
                loader.assert_not_called()

    def test_db_capacity_attestation_requires_matching_site_and_complete_mapping(self):
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            row = models.WorkspaceDashboardConfig(workspace_id=connection.workspace_id,
                payload={'version': 1, 'capacity': {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity'}},
                config_revision=3, capacity_jira_site_url=connection.site_url,
                capacity_jira_cloud_id=connection.cloud_id, capacity_field_schema_type='number',
                capacity_field_verified_at=datetime.now(timezone.utc))
            session.add(row)
            session.commit()
        self.assertTrue(self.client.get('/api/capacity/config').get_json()['mutationEnabled'])
        for field, value in (('project', ''), ('fieldId', '')):
            with self.factory() as session:
                row = session.query(models.WorkspaceDashboardConfig).one()
                row.payload = {'version': 1, 'capacity': {'project': 'CAP', 'fieldId': 'customfield_10001', field: value}}
                session.commit()
            self.assertFalse(self.client.get('/api/capacity/config').get_json()['mutationEnabled'])
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            row.payload = {'version': 1, 'capacity': {'project': 'CAP', 'fieldId': 'customfield_10001'}}
            row.capacity_jira_cloud_id = 'other-cloud'
            session.commit()
        unattested = self.client.get('/api/capacity/config').get_json()
        self.assertFalse(unattested['mutationEnabled'])
        self.assertTrue(unattested['requiresResolution'])

    def test_db_route_uses_context_workspace_revision_and_catalog_attestation(self):
        catalog = [{'id': 'customfield_10001', 'name': 'Canonical Capacity', 'schema': {'type': 'number'}}]
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=catalog):
            response = self.client.post('/api/capacity/config', json={
                'project': 'cap', 'fieldId': 'customfield_10001', 'fieldName': 'untrusted', 'baseRevision': 0,
            }, headers=self._headers())
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['fieldName'], 'Canonical Capacity')
            self.assertEqual(response.get_json()['configRevision'], 1)
            stale = self.client.post('/api/capacity/config', json={
                'project': 'OTHER', 'fieldId': 'customfield_10001', 'baseRevision': 0,
            }, headers=self._headers())
        self.assertEqual(stale.status_code, 409, stale.get_data(as_text=True))
        self.assertEqual(stale.get_json()['error'], 'capacity_config_conflict')
        self.assertEqual(stale.get_json()['current']['project'], 'CAP')

    def test_db_route_save_preserves_existing_db_board_without_json_import(self):
        catalog = [{'id': 'customfield_10001', 'name': 'Canonical Capacity', 'schema': {'type': 'number'}}]
        legacy = {'version': 1, 'board': {'boardId': '42', 'boardName': 'Planning'}}
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            session.add(models.WorkspaceDashboardConfig(workspace_id=connection.workspace_id,
                        payload=legacy, config_revision=3))
            session.commit()
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'JIRA_URL', 'https://one.example.test'), \
             patch.object(jira_server, '_load_dashboard_config_json', side_effect=AssertionError('runtime JSON import')), \
             patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=catalog):
            response = self.client.post('/api/capacity/config', json={**self._payload(), 'baseRevision': 3}, headers=self._headers())
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        with self.factory() as session:
            payload = session.query(models.WorkspaceDashboardConfig).one().payload
        self.assertEqual(payload['board'], {'boardId': '42', 'boardName': 'Planning'})
        self.assertEqual(payload['capacity']['project'], 'CAP')

    def test_capacity_post_requires_oauth_xrw_one_time_csrf_and_tool_admin(self):
        catalog = [{'id': 'customfield_10001', 'name': 'Capacity', 'schema': {'type': 'number'}}]
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True), \
             patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=catalog) as catalog_loader:
            unauthenticated = jira_server.app.test_client().post('/api/capacity/config', json=self._payload())
            self.assertEqual(unauthenticated.status_code, 401)
            missing_xrw = self.client.post('/api/capacity/config', json=self._payload())
            self.assertEqual(missing_xrw.status_code, 403)
            self.assertEqual(missing_xrw.get_json()['error'], 'csrf_required')
            missing_csrf = self.client.post('/api/capacity/config', json=self._payload(), headers={'X-Requested-With': 'jira-execution-planner'})
            self.assertEqual(missing_csrf.status_code, 403)
            headers = self._headers()
            with self.factory() as session:
                connection = session.get(models.AuthConnection, self.connection_id)
                session.get(models.User, connection.user_id).account_type = 'user'
                session.commit()
            denied = self.client.post('/api/capacity/config', json=self._payload(), headers=headers)
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.get_json()['error'], 'admin_required')
            with self.factory() as session:
                connection = session.get(models.AuthConnection, self.connection_id)
                session.get(models.User, connection.user_id).account_type = 'admin'
                session.commit()
            headers = self._headers()
            accepted = self.client.post('/api/capacity/config', json=self._payload(), headers=headers)
            self.assertEqual(accepted.status_code, 200, accepted.get_data(as_text=True))
            reused = self.client.post('/api/capacity/config', json={**self._payload(), 'baseRevision': 1}, headers=headers)
            self.assertEqual(reused.status_code, 403)
            self.assertEqual(reused.get_json()['error'], 'csrf_required')
            self.assertEqual(catalog_loader.call_count, 1)

    def test_capacity_get_shares_workspace_but_does_not_cross_site_identity(self):
        catalog = [{'id': 'customfield_10001', 'name': 'Capacity', 'schema': {'type': 'number'}}]
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=catalog):
            saved = self.client.post('/api/capacity/config', json=self._payload(), headers=self._headers())
            self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
            shared = self.client.get('/api/capacity/config')
            self.assertEqual(shared.status_code, 200)
            self.assertEqual(shared.get_json()['project'], 'CAP')
            with self.factory() as session:
                row = session.query(models.WorkspaceDashboardConfig).one()
                row.capacity_jira_cloud_id = 'different-cloud'
                session.commit()
            isolated = self.client.get('/api/capacity/config')
            self.assertEqual(isolated.status_code, 200)
            self.assertEqual(isolated.get_json()['project'], '')
            self.assertTrue(isolated.get_json()['requiresResolution'])

    def test_two_authenticated_users_get_the_identical_workspace_capacity_contract(self):
        catalog = [{'id': 'customfield_10001', 'name': 'Canonical Capacity', 'schema': {'type': 'number'}}]
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=catalog):
            saved = self.client.post('/api/capacity/config', json=self._payload(), headers=self._headers())
            self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
            first = self.client.get('/api/capacity/config')
            peer = self.peer_client.get('/api/capacity/config')
            isolated = self.isolated_client.get('/api/capacity/config')
        expected_keys = {'project', 'fieldId', 'fieldName', 'configRevision', 'source', 'requiresResolution', 'mutationEnabled'}
        self.assertEqual(set(first.get_json()), expected_keys)
        self.assertEqual(peer.get_json(), first.get_json())
        self.assertEqual(isolated.status_code, 200)
        self.assertEqual(isolated.get_json()['project'], '')
        self.assertNotEqual(isolated.get_json()['configRevision'], first.get_json()['configRevision'])

    def test_capacity_get_maps_context_and_load_storage_failures_to_fixed_503(self):
        expected = {
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }
        for error_type in (ConfigStorageError, DatabaseConfigurationError):
            for failing_operation in ('context', 'load'):
                secret = f'synthetic-secret-{error_type.__name__}-{failing_operation}'
                error = error_type(secret)
                context_patch = patch.object(jira_server, 'current_request_auth_context')
                load_patch = patch.object(jira_server, 'load_request_capacity_config')
                with self.subTest(error_type=error_type.__name__, failing_operation=failing_operation), \
                     self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                     context_patch as context_loader, load_patch as capacity_loader:
                    if failing_operation == 'context':
                        context_loader.side_effect = error
                        capacity_loader.side_effect = AssertionError('capacity load must not run')
                    else:
                        context_loader.side_effect = None
                        context_loader.return_value = self.context
                        capacity_loader.side_effect = error
                    response = self.client.get('/api/capacity/config')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json(), expected)
                self.assertNotIn(secret, response.get_data(as_text=True))

    def test_capacity_post_maps_selection_and_save_storage_failures_to_fixed_503(self):
        expected = {
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }
        catalog = [{'id': 'customfield_10001', 'name': 'Capacity', 'schema': {'type': 'number'}}]
        for error_type in (ConfigStorageError, DatabaseConfigurationError):
            for failing_operation in ('selection', 'save'):
                secret = f'synthetic-secret-{error_type.__name__}-{failing_operation}'
                error = error_type(secret)
                with self.subTest(error_type=error_type.__name__, failing_operation=failing_operation), \
                     self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
                    headers = self._headers()
                    if failing_operation == 'selection':
                        patches = (
                            patch.object(settings_routes, '_shared_capacity_db_auth_context', side_effect=error),
                            patch('backend.services.shared_capacity_config.save_shared_capacity_config', side_effect=AssertionError('capacity save must not run')),
                        )
                    else:
                        patches = (
                            patch('backend.routes.settings_routes.load_current_site_field_catalog', return_value=catalog),
                            patch('backend.services.shared_capacity_config.save_shared_capacity_config', side_effect=error),
                        )
                    with patches[0], patches[1]:
                        response = self.client.post(
                            '/api/capacity/config',
                            json=self._payload(),
                            headers=headers,
                        )
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json(), expected)
                self.assertNotIn(secret, response.get_data(as_text=True))

    def test_db_capacity_config_maps_field_catalog_failures_to_fixed_502(self):
        json_failure = Mock(status_code=200)
        json_failure.json.side_effect = ValueError('synthetic-secret-json-detail')
        failures = (
            None,
            Mock(status_code=503),
            json_failure,
            RuntimeError('synthetic-secret-request-detail'),
        )
        for failure in failures:
            jira_patch = (
                patch.object(jira_server, 'current_jira_request', side_effect=failure)
                if isinstance(failure, Exception)
                else patch.object(jira_server, 'current_jira_request', return_value=failure)
            )
            with self.subTest(failure=type(failure).__name__), self._db_env(), \
                 patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), jira_patch, \
                 patch('backend.services.shared_capacity_config.save_shared_capacity_config') as saver:
                response = self.client.post(
                    '/api/capacity/config',
                    json=self._payload(),
                    headers=self._headers(),
                )
            self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {'error': 'jira_field_catalog_failed'})
            self.assertNotIn('secret', response.get_data(as_text=True))
            saver.assert_not_called()

    def test_db_capacity_config_keeps_catalog_storage_failures_on_fixed_503_contract(self):
        expected = {
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }
        for error_type in (ConfigStorageError, DatabaseConfigurationError):
            secret = f'synthetic-secret-{error_type.__name__}'
            with self.subTest(error_type=error_type.__name__), self._db_env(), \
                 patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                 patch.object(jira_server, 'current_jira_request', side_effect=error_type(secret)):
                response = self.client.post(
                    '/api/capacity/config',
                    json=self._payload(),
                    headers=self._headers(),
                )
            self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), expected)
            self.assertNotIn(secret, response.get_data(as_text=True))

    def test_db_capacity_config_preserves_field_catalog_auth_recovery(self):
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_jira_request', side_effect=jira_server.AuthError(
                 'auth_connection_stale', 'Reconnect required.',
             )):
            response = self.client.post(
                '/api/capacity/config',
                json=self._payload(),
                headers=self._headers(),
            )
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'auth_connection_stale',
            'message': 'Reconnect required.',
            'recoveryUrl': '/auth/reconnect',
        })

    def test_db_capacity_config_maps_raw_catalog_401_to_auth_recovery(self):
        upstream = Mock(status_code=401)
        upstream.text = 'synthetic-secret-upstream-detail'
        with self._db_env(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_jira_request', return_value=upstream):
            response = self.client.post(
                '/api/capacity/config',
                json=self._payload(),
                headers=self._headers(),
            )
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        })
        self.assertNotIn('secret', response.get_data(as_text=True))


if __name__ == '__main__':
    unittest.main()
