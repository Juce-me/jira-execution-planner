import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import jira_server
from backend.auth.context import RequestAuthContext
from backend.config.repository import ConfigStorageError
from backend.db import engine as db_engine
from backend.db import models
from backend.db.engine import DatabaseConfigurationError
from backend.routes import settings_routes


class SharedCapacityConfigRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'routes.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(environment_key='test', name='Test', jira_site_url='https://one.example.test', jira_cloud_id='cloud-one')
            user = models.User(external_provider='test', external_subject='admin', account_type='admin')
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id, workspace_id=workspace.id, provider='atlassian_oauth',
                site_url=workspace.jira_site_url, cloud_id=workspace.jira_cloud_id,
                scopes=jira_server.ATLASSIAN_SCOPES.split(), scope_provenance='provider',
                status='active', expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            self.connection_id = connection.id
            peer = models.User(external_provider='test', external_subject='peer-admin', account_type='admin')
            session.add(peer)
            session.flush()
            peer_connection = models.AuthConnection(
                user_id=peer.id, workspace_id=workspace.id, provider='atlassian_oauth',
                site_url=workspace.jira_site_url, cloud_id=workspace.jira_cloud_id,
                scopes=jira_server.ATLASSIAN_SCOPES.split(), scope_provenance='provider',
                status='active', expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(peer_connection)
            isolated_workspace = models.Workspace(environment_key='test', name='Other', jira_site_url='https://two.example.test', jira_cloud_id='cloud-two')
            session.add(isolated_workspace)
            session.flush()
            isolated_user = models.User(external_provider='test', external_subject='other-admin', account_type='admin')
            session.add(isolated_user)
            session.flush()
            isolated_connection = models.AuthConnection(
                user_id=isolated_user.id, workspace_id=isolated_workspace.id, provider='atlassian_oauth',
                site_url=isolated_workspace.jira_site_url, cloud_id=isolated_workspace.jira_cloud_id,
                scopes=jira_server.ATLASSIAN_SCOPES.split(), scope_provenance='provider',
                status='active', expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(isolated_connection)
            session.commit()
            self.peer_connection_id = peer_connection.id
            self.isolated_connection_id = isolated_connection.id
        with self.client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {'db_auth_connection_id': self.connection_id, 'db_token_version': '1'}
        self.peer_client = jira_server.app.test_client()
        with self.peer_client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {'db_auth_connection_id': self.peer_connection_id, 'db_token_version': '1'}
        self.isolated_client = jira_server.app.test_client()
        with self.isolated_client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {'db_auth_connection_id': self.isolated_connection_id, 'db_token_version': '1'}

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def _headers(self):
        response = self.client.get('/api/auth/csrf')
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

    def test_compatibility_adapter_basic_canonical_and_operator_alias_do_not_require_db_revision(self):
        basic = RequestAuthContext(auth_mode='basic', user_id='local', stable_subject='local', atlassian_account_id='', workspace_id='local-workspace', auth_connection_id='local-basic', cloud_id='cloud-one', site_url='https://one.example.test', token_version='', account_status='active', is_admin=True)
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={'capacity': {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity'}}):
            canonical = jira_server.load_request_capacity_config(basic)
        self.assertEqual(canonical['project'], 'CAP')
        self.assertEqual(canonical['configRevision'], None)
        self.assertFalse(canonical['mutationEnabled'])
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={}), \
             patch.object(jira_server, 'CAPACITY_PROJECT', 'ALIAS'), \
             patch.object(jira_server, 'CAPACITY_FIELD_ID', 'customfield_20002'), \
             patch.object(jira_server, 'CAPACITY_FIELD_NAME', 'Operator Capacity'):
            alias = jira_server.load_request_capacity_config(basic)
        self.assertEqual((alias['project'], alias['fieldId'], alias['fieldName'], alias['source']), ('ALIAS', 'customfield_20002', 'Operator Capacity', 'env'))
        self.assertIsNone(alias['configRevision'])
        self.assertFalse(alias['mutationEnabled'])

    def test_local_oauth_compatibility_mapping_requires_matching_server_attestation(self):
        local = RequestAuthContext(auth_mode='atlassian_oauth', user_id='local', stable_subject='local', atlassian_account_id='local', workspace_id='local-workspace', auth_connection_id='local-oauth', cloud_id='cloud-one', site_url='https://one.example.test', token_version='1', account_status='active', is_admin=True)
        attested_capacity = {'project': 'CAP', 'fieldId': 'customfield_10001', 'fieldName': 'Capacity', 'fieldSchemaType': 'number', 'fieldVerifiedAt': '2026-01-01T00:00:00Z', 'verifiedSiteUrl': 'https://one.example.test/', 'verifiedCloudId': 'cloud-one'}
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={'capacity': attested_capacity}):
            attested = jira_server.load_request_capacity_config(local)
        self.assertTrue(attested['mutationEnabled'])
        self.assertIsNone(attested['configRevision'])
        for missing_mapping in (
            {**attested_capacity, 'project': ''},
            {**attested_capacity, 'fieldId': ''},
        ):
            with self.subTest(missing_mapping=missing_mapping), \
                 patch.object(jira_server, '_load_dashboard_config_json', return_value={'capacity': missing_mapping}):
                incomplete = jira_server.load_request_capacity_config(local)
            self.assertFalse(incomplete['mutationEnabled'])
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={'capacity': {**attested_capacity, 'verifiedCloudId': 'other-cloud'}}):
            unattested = jira_server.load_request_capacity_config(local)
        self.assertEqual(unattested['project'], 'CAP')
        self.assertFalse(unattested['mutationEnabled'])

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
                        context_loader.return_value = RequestAuthContext(
                            auth_mode='atlassian_oauth', user_id='synthetic-user', stable_subject='synthetic-user',
                            atlassian_account_id='synthetic-user', workspace_id='synthetic-workspace',
                            auth_connection_id='synthetic-connection', cloud_id='synthetic-cloud',
                            site_url='https://example.test', token_version='1', account_status='active',
                            is_admin=True, granted_scopes=tuple(jira_server.ATLASSIAN_SCOPES.split()),
                            granted_scopes_verified=True,
                        )
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
