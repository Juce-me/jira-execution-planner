import os
import tempfile
import unittest
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import jira_server
from backend.auth.jira_auth import AuthError
from backend.config.json_repository import JsonConfigRepository
from backend.db import engine as db_engine
from backend.db import models
from backend.services import work_structure as ws

XRW = 'jira-execution-planner'
SITE = 'https://one.example.test'


def jira_response(status=200, body=None, text=''):
    response = Mock()
    response.status_code = status
    response.json.return_value = body
    response.text = text
    return response


ISSUE_TYPES = [
    {'id': '10000', 'name': 'Epic', 'hierarchyLevel': 1, 'subtask': False,
     'iconUrl': f'{SITE}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10307'},
    {'id': '10001', 'name': 'Initiative', 'hierarchyLevel': 2, 'subtask': False,
     'iconUrl': 'http://one.example.test/insecure.png'},
    {'id': '10002', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False,
     'iconUrl': 'https://evil.example.test/steal.png'},
    {'id': '10003', 'name': 'Sub-task', 'hierarchyLevel': -1, 'subtask': True,
     'iconUrl': 'javascript:alert(1)'},
    {'id': '10004', 'name': 'Bug', 'hierarchyLevel': 0, 'subtask': False,
     'iconUrl': 'data:image/png;base64,AAAA'},
]


class WorkStructureRouteBase(unittest.TestCase):
    flag = 'true'

    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self.tmpdir.name, 'routes.db')}"
        models.Base.metadata.create_all(db_engine.get_engine(self.database_url))
        self.factory = db_engine.session_factory(self.database_url)
        with self.factory() as session:
            workspace = models.Workspace(environment_key='test', name='Test', jira_site_url=SITE, jira_cloud_id='cloud-one')
            session.add(workspace)
            session.flush()
            self.workspace_id = workspace.id
            self.admin_connection = self._connection(session, workspace, 'admin', 'admin')
            self.member_connection = self._connection(session, workspace, 'member', 'user')
            session.commit()
        self.client = self._client(self.admin_connection)
        self.member = self._client(self.member_connection)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': self.database_url,
            'WORK_CONFIGURATIONS_ENABLED': self.flag,
        }, clear=False))
        self.stack.enter_context(patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'))
        self.stack.enter_context(patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', True))
        # Feature paths must never fall back to a JSON config.
        self.json_loader = self.stack.enter_context(patch.object(
            JsonConfigRepository, 'load_dashboard_config', side_effect=AssertionError('JSON repository read')))
        self.server_json_loader = self.stack.enter_context(patch.object(
            jira_server, '_load_dashboard_config_json', side_effect=AssertionError('JSON loader read')))

    def tearDown(self):
        db_engine.dispose_engines()
        self.tmpdir.cleanup()

    def _connection(self, session, workspace, subject, account_type):
        user = models.User(external_provider='test', external_subject=subject, account_type=account_type)
        session.add(user)
        session.flush()
        connection = models.AuthConnection(
            user_id=user.id, workspace_id=workspace.id, provider='atlassian_oauth',
            site_url=workspace.jira_site_url, cloud_id=workspace.jira_cloud_id,
            scopes=jira_server.ATLASSIAN_SCOPES.split(), scope_provenance='provider',
            status='active', expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        session.add(connection)
        session.flush()
        return connection.id

    def _client(self, connection_id):
        client = jira_server.app.test_client()
        with client.session_transaction() as flask_session:
            flask_session['db_oauth_session'] = {'db_auth_connection_id': connection_id, 'db_token_version': '1'}
        return client

    def headers(self, client=None):
        response = (client or self.client).get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return {'X-Requested-With': XRW, 'X-CSRF-Token': response.get_json()['csrfToken']}

    def row(self):
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one_or_none()
            return None if row is None else (deepcopy(row.payload), row.config_revision)

    def seed(self, payload=None, *, promoted=True, revision=3, mutate=None):
        bundle = ws.capture_virtual_bundle({})
        if promoted:
            for entry in bundle['configurations']:
                entry['revision'] = 1
            bundle['promotionRevision'] = revision
        if mutate:
            mutate(bundle)
        body = dict(payload or {})
        body['version'] = 1
        body['workConfigurations'] = bundle
        with self.factory() as session:
            session.add(models.WorkspaceDashboardConfig(
                workspace_id=self.workspace_id, payload_version=1, payload=body, config_revision=revision,
            ))
            session.commit()
        return bundle

    def promoted_seed(self, **kwargs):
        def mutate(bundle):
            legacy, delivery = bundle['configurations']
            legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}, {'key': 'OLDB', 'type': 'tech'}]
            legacy['scope']['boardId'] = '7001'
            delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
            delivery['hierarchy'].update(planningIssueTypeId='10002', parentIssueTypeId='10001')
            for name in ('sprint', 'storyPoints', 'team'):
                delivery['fields'][name] = {'fieldId': f'customfield_2{len(name)}', 'fieldName': name}
        return self.seed(mutate=mutate, **kwargs)


class EditorRouteTests(WorkStructureRouteBase):
    def test_virtual_get_has_exact_envelope_no_write_no_jira_no_json(self):
        with patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('Jira I/O on GET')):
            response = self.client.get('/api/work-structure/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(set(body), {'workConfigurations', 'configRevision', 'promoted', 'userCanEditSettings', 'featureEnabled'})
        self.assertFalse(body['promoted'])
        self.assertTrue(body['featureEnabled'])
        self.assertTrue(body['userCanEditSettings'])
        self.assertEqual(body['configRevision'], 0)
        self.assertIsNone(body['workConfigurations']['promotionRevision'])
        self.assertEqual([e['revision'] for e in body['workConfigurations']['configurations']], [0, 0])
        self.assertIsNone(self.row())

    def test_member_reads_but_cannot_edit_and_flag_is_mirrored(self):
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            body = self.member.get('/api/work-structure/config').get_json()
        self.assertFalse(body['userCanEditSettings'])
        self.assertFalse(body['featureEnabled'])

    def test_non_db_oauth_request_requires_setup(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = jira_server.app.test_client().get('/api/work-structure/config')
        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'work_configuration_setup_required')

    def test_unauthenticated_get_is_terminal_401(self):
        response = jira_server.app.test_client().get('/api/work-structure/config')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')

    def first_save_body(self, base_revision=0, **extra):
        bundle = self.client.get('/api/work-structure/config').get_json()['workConfigurations']
        return {'baseRevision': base_revision, 'workConfigurations': bundle, 'legacyEdits': [], **extra}

    def test_first_save_promotes_prefetches_outside_fence_and_captures_display_types(self):
        seen_rows = []

        def fake_get(path, **kwargs):
            seen_rows.append((path, self.row()))
            return jira_response(200, ISSUE_TYPES)

        body = self.first_save_body()
        body['workConfigurations']['configurations'][1]['name'] = 'DELIVERY'
        with patch.object(jira_server, 'current_jira_get', side_effect=fake_get):
            response = self.client.post('/api/work-structure/config', json=body, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()
        self.assertTrue(result['promoted'])
        self.assertEqual(result['configRevision'], 1)
        self.assertEqual(result['changedConfigurationIds'], ['legacy', 'delivery'])
        self.assertEqual(seen_rows, [('/rest/api/3/issuetype', None)], 'metadata is fetched before any DB write')
        legacy = result['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['legacyDisplayTypes'], {
            'parent': {'id': '10000', 'name': 'Epic'}, 'ancestor': {'id': '10001', 'name': 'Initiative'}})
        payload, revision = self.row()
        self.assertEqual(revision, 1)
        self.assertEqual(payload['workConfigurations']['promotionRevision'], 1)
        for moved in ws.MOVED_STRUCTURAL_KEYS:
            self.assertNotIn(moved, payload)

    def test_ambiguous_or_unavailable_display_metadata_is_null_not_an_error(self):
        duplicated = ISSUE_TYPES + [{'id': '10099', 'name': 'Epic', 'hierarchyLevel': 1, 'subtask': False}]
        with patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, duplicated)):
            response = self.client.post('/api/work-structure/config', json=self.first_save_body(), headers=self.headers())
        legacy = response.get_json()['workConfigurations']['configurations'][0]
        self.assertIsNone(legacy['legacyDisplayTypes']['parent'])
        self.assertEqual(legacy['legacyDisplayTypes']['ancestor'], {'id': '10001', 'name': 'Initiative'})

    def test_prefetch_failure_does_not_block_first_save(self):
        with patch.object(jira_server, 'current_jira_get', return_value=jira_response(500, None, 'SECRET upstream')):
            response = self.client.post('/api/work-structure/config', json=self.first_save_body(), headers=self.headers())
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        legacy = response.get_json()['workConfigurations']['configurations'][0]
        self.assertEqual(legacy['legacyDisplayTypes'], {'parent': None, 'ancestor': None})

    def test_expired_sign_in_during_prefetch_is_terminal_401_with_no_write(self):
        with patch.object(jira_server, 'current_jira_get', side_effect=AuthError('auth_required', 'x')):
            response = self.client.post('/api/work-structure/config', json=self.first_save_body(), headers=self.headers())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()['error'], 'auth_required')
        self.assertIsNone(self.row())

    def test_stale_revision_conflict_carries_the_full_current_bundle(self):
        self.promoted_seed(revision=5)
        stale = self.first_save_body(base_revision=2)
        response = self.client.post('/api/work-structure/config', json=stale, headers=self.headers())
        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['error'], 'workspace_config_conflict')
        self.assertEqual(body['configRevision'], 5)
        self.assertEqual(len(body['workConfigurations']['configurations']), 2)
        self.assertEqual(body['workConfigurations']['promotionRevision'], 5)
        self.assertEqual(self.row()[1], 5)

    def test_forged_authority_is_rejected_before_any_mutation(self):
        for forged in ({'workspaceId': 'other'}, {'siteUrl': 'https://evil.example.test'}, {'cloudId': 'x'}, {'userId': 'y'}):
            with self.subTest(forged=forged):
                response = self.client.post('/api/work-structure/config', json={**self.first_save_body(), **forged}, headers=self.headers())
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()['error'], 'invalid_work_configurations')
        nested = self.first_save_body()
        nested['workConfigurations']['workspaceId'] = 'other'
        nested['workConfigurations']['configurations'][0]['siteUrl'] = 'https://evil.example.test'
        response = self.client.post('/api/work-structure/config', json=nested, headers=self.headers())
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.row())

    def test_malformed_bodies_are_400(self):
        good = self.first_save_body()
        for body in ([], {}, {**good, 'baseRevision': '0'}, {**good, 'baseRevision': -1}, {**good, 'baseRevision': True},
                     {**good, 'workConfigurations': []}, {**good, 'clearProjectsForConfigurationIds': 'legacy'}):
            with self.subTest(body=str(body)[:60]):
                response = self.client.post('/api/work-structure/config', json=body, headers=self.headers())
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'invalid_work_configurations')

    def test_security_policy_unauthenticated_xrw_csrf_and_admin(self):
        body = self.first_save_body()
        self.assertEqual(jira_server.app.test_client().post('/api/work-structure/config', json=body).status_code, 401)
        missing_xrw = self.client.post('/api/work-structure/config', json=body)
        self.assertEqual((missing_xrw.status_code, missing_xrw.get_json()['error']), (403, 'csrf_required'))
        missing_csrf = self.client.post('/api/work-structure/config', json=body, headers={'X-Requested-With': XRW})
        self.assertEqual((missing_csrf.status_code, missing_csrf.get_json()['error']), (403, 'csrf_required'))
        denied = self.member.post('/api/work-structure/config', json=body, headers=self.headers(self.member))
        self.assertEqual((denied.status_code, denied.get_json()['error']), (403, 'admin_required'))
        self.assertIsNone(self.row())

    def test_non_db_oauth_post_requires_setup(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = jira_server.app.test_client().post('/api/work-structure/config', json={})
        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'work_configuration_setup_required')

    def test_later_save_increments_changed_entries_and_requires_explicit_project_clear(self):
        self.promoted_seed(revision=3)
        current = self.client.get('/api/work-structure/config').get_json()
        bundle = deepcopy(current['workConfigurations'])
        bundle['configurations'][1]['name'] = 'DELIVERY 2'
        saved = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': current['configRevision'], 'workConfigurations': bundle})
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json()['changedConfigurationIds'], ['delivery'])
        self.assertEqual(saved.get_json()['configRevision'], 4)
        cleared = deepcopy(saved.get_json()['workConfigurations'])
        cleared['configurations'][1]['scope']['projects'] = []
        implicit = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': 4, 'workConfigurations': cleared})
        self.assertEqual(implicit.status_code, 400)
        self.assertEqual(implicit.get_json()['error'], 'invalid_work_configurations')
        explicit = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': 4, 'workConfigurations': cleared, 'clearProjectsForConfigurationIds': ['delivery']})
        self.assertEqual(explicit.status_code, 200, explicit.get_data(as_text=True))
        # legacyEdits and promotionRevision overrides are rejected once promoted.
        with_edits = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': 5, 'workConfigurations': cleared, 'legacyEdits': []})
        self.assertEqual(with_edits.status_code, 400)
        forged = deepcopy(cleared)
        forged['promotionRevision'] = 99
        response = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': 5, 'workConfigurations': forged})
        self.assertEqual(response.status_code, 400)

    def test_four_flag_state_matrix(self):
        # unpromoted + off: editor read works, bundle write is denied, no row.
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            body = self.first_save_body()
            response = self.client.post('/api/work-structure/config', json=body, headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_feature_disabled'))
        self.assertIsNone(self.row())
        # unpromoted + on: first save promotes.
        with patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, ISSUE_TYPES)):
            self.assertEqual(self.client.post('/api/work-structure/config', json=body, headers=self.headers()).status_code, 200)
        # promoted + on: editor reads the saved bundle.
        read = self.client.get('/api/work-structure/config').get_json()
        self.assertTrue(read['promoted'])
        self.assertEqual([e['revision'] for e in read['workConfigurations']['configurations']], [1, 1])
        # promoted + off: writes denied; structural metadata reads denied; never flat fallback.
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            later = {'baseRevision': read['configRevision'], 'workConfigurations': read['workConfigurations']}
            response = self.client.post('/api/work-structure/config', json=later, headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_feature_disabled'))
            unavailable = self.client.get('/api/components?query=a')
            self.assertEqual((unavailable.status_code, unavailable.get_json()['error']), (409, 'configuration_feature_disabled'))
            self.assertTrue(self.client.get('/api/work-structure/config').get_json()['promoted'])

    def test_save_error_bodies_are_allowlisted(self):
        self.promoted_seed()
        bundle = self.client.get('/api/work-structure/config').get_json()['workConfigurations']
        bundle['configurations'][1]['fields']['sprint']['fieldId'] = 'bad id!'
        response = self.client.post('/api/work-structure/config', headers=self.headers(), json={
            'baseRevision': 3, 'workConfigurations': bundle})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.get_json()), {'error', 'status', 'message', 'paths'})

    def test_storage_failure_is_503_without_exception_text(self):
        with patch('backend.services.work_structure.load_editor_envelope',
                   side_effect=__import__('backend.config.repository', fromlist=['ConfigStorageError']).ConfigStorageError('SECRET dsn')):
            response = self.client.get('/api/work-structure/config')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error'], 'config_storage_unavailable')
        self.assertNotIn('SECRET', response.get_data(as_text=True))


class SelectorRouteTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()

    def components_get(self, params, fetch=None):
        fetch = fetch or (lambda path, **kw: jira_response(200, [
            {'id': '1', 'name': f'Comp {path.split("/")[-2]}'}, {'id': '2', 'name': 'Shared'}]))
        with patch.object(jira_server, 'current_jira_get', side_effect=fetch) as getter:
            response = self.client.get('/api/components', query_string=params)
        return response, getter

    def test_components_normal_selector_uses_stored_projects_only(self):
        response, getter = self.components_get({'configurationId': 'legacy', 'configurationRevision': '1', 'limit': '50'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual([c['name'] for c in body['components']], ['Comp OLD', 'Comp OLDB', 'Shared'])
        self.assertEqual((body['configurationId'], body['configurationRevision']), ('legacy', 1))
        self.assertEqual([c.args[0] for c in getter.call_args_list],
                         ['/rest/api/3/project/OLD/components', '/rest/api/3/project/OLDB/components'])
        delivery, _ = self.components_get({'configurationId': 'delivery', 'configurationRevision': '1'})
        self.assertEqual([c['projectKey'] for c in delivery.get_json()['components']], ['PLAN', 'PLAN'])

    def test_components_selector_errors(self):
        cases = [
            ({}, 409, 'configuration_required'),
            ({'configurationId': 'legacy'}, 409, 'configuration_required'),
            ({'configurationRevision': '1'}, 409, 'configuration_required'),
            ({'configurationId': 'nope', 'configurationRevision': '1'}, 400, 'invalid_configuration_id'),
            ({'configurationId': 'Bad Id!', 'configurationRevision': '1'}, 400, 'invalid_configuration_id'),
            ({'configurationId': 'legacy', 'configurationRevision': 'x'}, 400, 'invalid_configuration_id'),
            ({'configurationId': 'legacy', 'configurationRevision': '9'}, 409, 'configuration_scope_changed'),
            ({'configurationId': 'legacy', 'configurationRevision': '1', 'quarter': '2027Q1'}, 409, 'configuration_scope_changed'),
            ({'configurationId': 'delivery', 'configurationRevision': '1', 'quarter': '2026Q4'}, 409, 'configuration_scope_changed'),
            ({'configurationId': 'legacy', 'configurationRevision': '1', 'quarter': '2026q4'}, 400, 'invalid_quarter'),
        ]
        for params, status, code in cases:
            with self.subTest(params=params):
                response, getter = self.components_get(params)
                self.assertEqual((response.status_code, response.get_json()['error']), (status, code), response.get_data(as_text=True))
                getter.assert_not_called()
        agreeing, _ = self.components_get({'configurationId': 'delivery', 'configurationRevision': '1', 'quarter': '2027Q2'})
        self.assertEqual(agreeing.status_code, 200)

    def test_components_incomplete_configuration_and_forged_authority_ignored(self):
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            payload['workConfigurations']['configurations'][1]['scope']['projects'] = []
            row.payload = payload
            session.commit()
        response, getter = self.components_get({'configurationId': 'delivery', 'configurationRevision': '1',
                                                'workspaceId': 'other', 'siteUrl': 'https://evil.example.test'})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertEqual(response.get_json()['missingFields'], ['scope.projects'])
        getter.assert_not_called()

    def test_components_partial_upstream_is_an_error_and_never_a_cached_empty_catalog(self):
        def flaky(path, **kwargs):
            if path.endswith('/OLDB/components'):
                return jira_response(500, None, 'SECRET upstream trace')
            return jira_response(200, [{'id': '1', 'name': 'Only'}])
        jira_server.COMPONENTS_CACHE['data'] = None
        response, _ = self.components_get({'configurationId': 'legacy', 'configurationRevision': '1'}, flaky)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()['error'], 'jira_unavailable')
        self.assertNotIn('SECRET', response.get_data(as_text=True))
        self.assertIsNone(jira_server.COMPONENTS_CACHE['data'])
        raising = Mock(side_effect=RuntimeError('SECRET boom'))
        with patch.object(jira_server, 'current_jira_get', raising):
            response = self.client.get('/api/components', query_string={'configurationId': 'legacy', 'configurationRevision': '1'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('SECRET', response.get_data(as_text=True))
        self.assertIsNone(jira_server.COMPONENTS_CACHE['data'])

    def test_components_terminal_401_passthrough(self):
        with patch.object(jira_server, 'current_jira_get', side_effect=AuthError('auth_required', 'x')):
            response = self.client.get('/api/components', query_string={'configurationId': 'legacy', 'configurationRevision': '1'})
        self.assertEqual((response.status_code, response.get_json()['error']), (401, 'auth_required'))

    def statuses(self, params, projects_payload=None, status=200):
        def fetch(path, **kwargs):
            return jira_response(status, projects_payload if projects_payload is not None else [
                {'id': '10001', 'name': 'Initiative', 'statuses': [{'id': '1', 'name': 'Discovery'}, {'id': '2', 'name': 'Delivery'}]},
                {'id': '10000', 'name': 'Epic', 'statuses': [{'id': '3', 'name': 'To Do'}]},
                {'id': '10002', 'name': 'Story', 'statuses': [{'id': '4', 'name': 'Open'}]},
            ])
        with patch.object(jira_server, 'current_jira_get', side_effect=fetch) as getter:
            response = self.client.get('/api/board-config/statuses', query_string=params)
        return response, getter

    def test_statuses_delivery_uses_mapped_parent_id_without_a_board(self):
        response, getter = self.statuses({'configurationId': 'delivery', 'configurationRevision': '1'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['statuses'], [{'id': '1', 'name': 'Discovery'}, {'id': '2', 'name': 'Delivery'}])
        self.assertIsNone(body['boardId'])
        self.assertEqual((body['projectKeys'], body['projectKey']), (['PLAN'], 'PLAN'))
        self.assertEqual((body['configurationId'], body['configurationRevision']), ('delivery', 1))
        self.assertEqual(len(body['configurationDigest']), 32)
        self.assertEqual([c.args[0] for c in getter.call_args_list], ['/rest/api/3/project/PLAN/statuses'])

    def test_statuses_legacy_compatibility_keeps_epic_name_and_board(self):
        response, _ = self.statuses({'configurationId': 'legacy', 'configurationRevision': '1'})
        body = response.get_json()
        self.assertEqual(body['statuses'], [{'id': '3', 'name': 'To Do'}])
        self.assertEqual(body['boardId'], '7001')
        self.assertEqual(body['projectKeys'], ['OLD', 'OLDB'])
        self.assertNotIn('projectKey', body)

    def test_same_board_and_projects_with_different_parent_mapping_change_identity(self):
        first, _ = self.statuses({'configurationId': 'delivery', 'configurationRevision': '1'})
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            entry = payload['workConfigurations']['configurations'][1]
            entry['hierarchy']['parentIssueTypeId'] = '10000'
            entry['revision'] = 2
            row.payload = payload
            session.commit()
        second, _ = self.statuses({'configurationId': 'delivery', 'configurationRevision': '2'})
        self.assertEqual(second.get_json()['statuses'], [{'id': '3', 'name': 'To Do'}])
        self.assertNotEqual(first.get_json()['configurationDigest'], second.get_json()['configurationDigest'])
        self.assertEqual(first.get_json()['projectKeys'], second.get_json()['projectKeys'])

    def test_statuses_cleared_parent_and_selector_errors(self):
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            payload['workConfigurations']['configurations'][1]['hierarchy']['parentIssueTypeId'] = None
            row.payload = payload
            session.commit()
        response, getter = self.statuses({'configurationId': 'delivery', 'configurationRevision': '1'})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertIn('hierarchy.parentIssueTypeId', response.get_json()['missingFields'])
        getter.assert_not_called()
        response, _ = self.statuses({})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_required'))

    def test_statuses_upstream_failures_are_sanitized_and_never_empty_success(self):
        for upstream, expected in ((403, 'board_statuses_forbidden'), (500, 'board_statuses_fetch_failed')):
            with self.subTest(upstream=upstream):
                response, _ = self.statuses({'configurationId': 'delivery', 'configurationRevision': '1'}, projects_payload=None, status=upstream)
                self.assertEqual((response.status_code, response.get_json()['error']), (502, expected))
        empty, _ = self.statuses({'configurationId': 'delivery', 'configurationRevision': '1'}, projects_payload=[])
        self.assertEqual((empty.status_code, empty.get_json()['error']), (502, 'board_statuses_unavailable'))

    def epics(self, params, items=None):
        issues = items if items is not None else [
            {'key': 'plan-1', 'fields': {'summary': 'One', 'status': {'name': 'Open'}, 'project': {'key': 'PLAN'},
                                         'issuetype': {'id': '10001', 'name': 'Initiative'}}},
            {'key': 'PLAN-2', 'fields': {'summary': 'Wrong type', 'status': {'name': 'Open'}, 'project': {'key': 'PLAN'},
                                         'issuetype': {'id': '10002', 'name': 'Story'}}},
        ]
        with patch.object(jira_server, 'jira_search_request', return_value=jira_response(200, {'issues': issues})) as search:
            response = self.client.get('/api/epics/search', query_string={'query': 'one', **params})
        return response, search

    def test_epic_search_delivery_searches_mapped_parent_type_id(self):
        response, search = self.epics({'configurationId': 'delivery', 'configurationRevision': '1'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([e['key'] for e in response.get_json()['epics']], ['PLAN-1'])
        jql = search.call_args.args[0]['jql']
        self.assertTrue(jql.startswith('issuetype = "10001" AND project in ("PLAN")'), jql)

    def test_epic_search_legacy_compat_keeps_literal_epic_and_quarter_resolves(self):
        epics = [{'key': 'OLD-1', 'fields': {'summary': 'x', 'status': {'name': 'Open'}, 'project': {'key': 'OLD'},
                                              'issuetype': {'id': '10000', 'name': 'Epic', 'hierarchyLevel': 1}}}]
        response, search = self.epics({'quarter': '2026Q4'}, epics)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['configurationId'], 'legacy')
        self.assertTrue(search.call_args.args[0]['jql'].startswith('issuetype = Epic AND project in ("OLD", "OLDB")'))
        missing, _ = self.epics({})
        self.assertEqual((missing.status_code, missing.get_json()['error']), (409, 'configuration_required'))
        mismatch, _ = self.epics({'configurationId': 'legacy', 'configurationRevision': '1', 'quarter': '2027Q1'})
        self.assertEqual((mismatch.status_code, mismatch.get_json()['error']), (409, 'configuration_scope_changed'))

    def test_epic_search_upstream_error_is_sanitized(self):
        with patch.object(jira_server, 'jira_search_request', return_value=jira_response(400, None, 'JQL error: project in ("PLAN") SECRET')):
            response = self.client.get('/api/epics/search', query_string={
                'query': 'x', 'configurationId': 'delivery', 'configurationRevision': '1'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('SECRET', response.get_data(as_text=True))
        self.assertNotIn('JQL', response.get_data(as_text=True))


class SanitizedMetadataTests(WorkStructureRouteBase):
    def test_issue_types_without_selector_use_sanitized_feature_shape(self):
        with patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, ISSUE_TYPES)):
            response = self.client.get('/api/issue-types')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(set(body), {'issueTypes', 'configurationId', 'configurationRevision'})
        self.assertIsNone(body['configurationId'])
        by_name = {item['name']: item for item in body['issueTypes']}
        for item in body['issueTypes']:
            self.assertEqual(set(item), {'id', 'name', 'hierarchyLevel', 'subtask', 'iconUrl', 'projectIds'})
        self.assertTrue(by_name['Epic']['iconUrl'].startswith(SITE + '/'))
        for name in ('Initiative', 'Story', 'Sub-task', 'Bug'):
            self.assertEqual(by_name[name]['iconUrl'], '', name)
        self.assertEqual(by_name['Sub-task']['subtask'], True)

    def test_issue_types_selector_adds_project_applicability(self):
        self.promoted_seed()

        def fetch(path, **kwargs):
            if path == '/rest/api/3/issuetype':
                return jira_response(200, ISSUE_TYPES)
            self.assertEqual(path, '/rest/api/3/project/search')
            self.assertEqual(kwargs['params']['keys'], ['PLAN'])
            return jira_response(200, {'isLast': True, 'values': [
                {'id': '501', 'key': 'PLAN', 'issueTypes': [{'id': '10001'}, {'id': '10002'}]}]})
        with patch.object(jira_server, 'current_jira_get', side_effect=fetch):
            response = self.client.get('/api/issue-types', query_string={'configurationId': 'delivery', 'configurationRevision': '1'})
        body = response.get_json()
        self.assertEqual((body['configurationId'], body['configurationRevision']), ('delivery', 1))
        by_name = {item['name']: item['projectIds'] for item in body['issueTypes']}
        self.assertEqual((by_name['Initiative'], by_name['Story'], by_name['Epic']), (['501'], ['501'], []))
        bad = self.client.get('/api/issue-types', query_string={'configurationId': 'zzz', 'configurationRevision': '1'})
        self.assertEqual((bad.status_code, bad.get_json()['error']), (400, 'invalid_configuration_id'))
        stale = self.client.get('/api/issue-types', query_string={'configurationId': 'delivery', 'configurationRevision': '7'})
        self.assertEqual((stale.status_code, stale.get_json()['error']), (409, 'configuration_scope_changed'))

    def test_issue_types_upstream_failure_has_no_raw_text(self):
        with patch.object(jira_server, 'current_jira_get', return_value=jira_response(500, None, 'SECRET stack')):
            response = self.client.get('/api/issue-types')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(set(response.get_json()), {'error', 'status', 'message'})
        self.assertNotIn('SECRET', response.get_data(as_text=True))
        with patch.object(jira_server, 'current_jira_get', side_effect=RuntimeError('SECRET boom')):
            response = self.client.get('/api/issue-types')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('SECRET', response.get_data(as_text=True))

    def test_flag_off_unpromoted_issue_types_keep_the_legacy_shape(self):
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}), \
             patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, ISSUE_TYPES)):
            jira_server.ISSUE_TYPES_CACHE['data'] = None
            body = self.client.get('/api/issue-types').get_json()
        self.assertEqual(set(body), {'issueTypes'})
        self.assertEqual(set(body['issueTypes'][0]), {'name', 'subtask', 'iconUrl'})

    def myself(self, status=200):
        return jira_response(status, {'displayName': 'Real Person', 'emailAddress': 'real@example.test',
                                      'accountId': 'acct-secret'}, 'RAW {"jql":"project = SECRET"} real@example.test')

    def test_connection_test_no_selector_is_allowlisted(self):
        with patch.object(jira_server, 'current_jira_get', return_value=self.myself()):
            response = self.client.get('/api/test')
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(set(body), {'ok', 'status', 'code', 'configurationId', 'configurationRevision', 'missingFields', 'checks'})
        self.assertEqual((body['ok'], body['status'], body['missingFields']), (True, 'success', []))
        self.assertEqual(body['checks'], [{'kind': 'connection', 'status': 'ok', 'code': 'connection_ok'}])
        text = response.get_data(as_text=True)
        for leaked in ('Real Person', 'real@example.test', 'acct-secret', 'SECRET', 'jql', 'sample_issue'):
            self.assertNotIn(leaked, text)

    def test_connection_test_selector_reports_missing_fields_and_errors_safely(self):
        self.seed()
        with patch.object(jira_server, 'current_jira_get', return_value=self.myself()):
            blank = self.client.get('/api/test', query_string={'configurationId': 'delivery', 'configurationRevision': '1'})
            self.assertEqual(blank.get_json()['ok'], False)
            self.assertEqual(blank.get_json()['missingFields'], [
                'scope.projects', 'scope.boardId', 'fields.sprint.fieldId', 'fields.storyPoints.fieldId',
                'fields.team.fieldId', 'hierarchy.planningIssueTypeId', 'hierarchy.parentIssueTypeId'])
            self.assertEqual(blank.get_json()['checks'][1],
                             {'kind': 'configuration', 'status': 'incomplete', 'code': 'configuration_incomplete'})
            complete = self.client.get('/api/test', query_string={'configurationId': 'legacy', 'configurationRevision': '1'})
            self.assertEqual(complete.get_json()['missingFields'], ['scope.projects', 'scope.boardId'])
            stale = self.client.get('/api/test', query_string={'configurationId': 'legacy', 'configurationRevision': '4'})
            self.assertEqual((stale.status_code, stale.get_json()['error']), (409, 'configuration_scope_changed'))
            bad = self.client.get('/api/test', query_string={'configurationId': '??', 'configurationRevision': '1'})
            self.assertEqual((bad.status_code, bad.get_json()['error']), (400, 'invalid_configuration_id'))
        for upstream in (401, 403, 500):
            with self.subTest(upstream=upstream), \
                 patch.object(jira_server, 'current_jira_get', return_value=self.myself(upstream)):
                response = self.client.get('/api/test')
                self.assertEqual(set(response.get_json()), {'error', 'status', 'message'})
                self.assertIn(response.status_code, (429, 502))
                self.assertNotIn('SECRET', response.get_data(as_text=True))
        with patch.object(jira_server, 'current_jira_get', side_effect=RuntimeError('SECRET boom real@example.test')):
            response = self.client.get('/api/test')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('SECRET', response.get_data(as_text=True))
        with patch.object(jira_server, 'current_jira_get', side_effect=AuthError('auth_required', 'x')):
            response = self.client.get('/api/test')
        self.assertEqual((response.status_code, response.get_json()['error']), (401, 'auth_required'))
        with patch.object(jira_server, 'current_jira_get', side_effect=AuthError('other', 'SECRET detail')):
            response = self.client.get('/api/test')
        self.assertNotIn('SECRET', response.get_data(as_text=True))

    def test_flag_off_unpromoted_connection_test_keeps_legacy_body(self):
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}), \
             patch.object(jira_server, 'current_jira_get', return_value=self.myself()):
            body = self.client.get('/api/test').get_json()
        self.assertEqual(body['status'], 'success')
        self.assertIn('Connection OK', body['message'])


class BootstrapAndLegacySetterTests(WorkStructureRouteBase):
    def test_promoted_bootstrap_omits_unscoped_projections_without_getters(self):
        self.promoted_seed(payload={'capacity': {'project': 'CAP'}})
        forbidden = AssertionError('moved-key getter on promoted bootstrap')
        with patch.object(jira_server, 'get_selected_projects', side_effect=forbidden), \
             patch.object(jira_server, 'get_board_config', side_effect=forbidden), \
             patch.object(jira_server, 'current_jira_get', side_effect=AssertionError('Jira on bootstrap')):
            response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertTrue(body['workConfigurationsEnabled'])
        self.assertTrue(body['workConfigurationsPromoted'])
        for key in ('boardId', 'boardName', 'boardConfigSource', 'projectsConfigured', 'sprintCatalogSource', 'adminSettingsMissing'):
            self.assertNotIn(key, body)
        for key in (*ws.MOVED_STRUCTURAL_KEYS, 'workConfigurations'):
            self.assertNotIn(key, body['sharedConfig'])
        self.assertEqual([s['id'] for s in body['workConfigurationSummaries']], ['legacy', 'delivery'])
        self.assertEqual(set(body['workConfigurationSummaries'][0]), {'id', 'name', 'revision', 'model', 'fromQuarter', 'throughQuarter', 'digest'})
        self.assertEqual(body['adminSettingsMissingByConfiguration']['delivery'], [])
        self.assertEqual(body['adminSettingsMissingByConfiguration']['legacy'], [])
        self.assertTrue(body['userCanEditSettings'])

    def test_blank_delivery_does_not_mark_legacy_missing(self):
        def mutate(bundle):
            legacy = bundle['configurations'][0]
            legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}]
            legacy['scope']['boardId'] = '7001'
            for name in ('sprint', 'storyPoints', 'team'):
                legacy['fields'][name] = {'fieldId': f'customfield_1{len(name)}', 'fieldName': name}
        self.seed(mutate=mutate)
        body = self.client.get('/api/config').get_json()
        self.assertEqual(body['adminSettingsMissingByConfiguration']['legacy'], [])
        self.assertIn('scope.projects', body['adminSettingsMissingByConfiguration']['delivery'])

    def test_member_bootstrap_receives_admin_contacts_when_setup_is_missing(self):
        self.seed()
        body = self.member.get('/api/config').get_json()
        self.assertFalse(body['userCanEditSettings'])
        self.assertIn('adminContacts', body)

    def test_unpromoted_bootstrap_keeps_flat_projections(self):
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={}):
            body = self.client.get('/api/config').get_json()
        self.assertFalse(body['workConfigurationsPromoted'])
        self.assertEqual(body['workConfigurationSummaries'], [])
        self.assertEqual(body['adminSettingsMissingByConfiguration'], {})
        for key in ('boardId', 'boardName', 'boardConfigSource', 'projectsConfigured', 'sprintCatalogSource', 'adminSettingsMissing'):
            self.assertIn(key, body)

    def test_old_structural_setters_return_bundle_required_after_promotion(self):
        self.promoted_seed()
        _, revision = self.row()
        writes = [
            ('/api/projects/selected', {'selected': [{'key': 'ZZZ', 'type': 'product'}]}),
            ('/api/board-config', {'boardId': '5', 'boardName': 'B'}),
            ('/api/issue-types/config', {'issueTypes': ['Story']}),
            ('/api/sprint-field/config', {'fieldId': 'customfield_1', 'fieldName': 'S'}),
            ('/api/story-points-field/config', {'fieldId': 'customfield_2', 'fieldName': 'P'}),
            ('/api/parent-name-field/config', {'fieldId': 'customfield_3', 'fieldName': 'N'}),
            ('/api/team-field/config', {'fieldId': 'customfield_4', 'fieldName': 'T'}),
            ('/api/delivery-owner-field/config', {'fieldId': 'customfield_5', 'fieldName': 'D'}),
        ]
        for path, body in writes:
            with self.subTest(path=path):
                response = self.client.post(path, json={**body, 'baseRevision': revision}, headers=self.headers())
                self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'configuration_bundle_required')
        self.assertEqual(self.row()[1], revision)

    def test_unpromoted_setter_still_writes_flat_sections(self):
        with patch.object(jira_server, '_load_dashboard_config_json', return_value={}):
            response = self.client.post('/api/issue-types/config', json={'issueTypes': ['Story'], 'baseRevision': 0}, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.row()[0]['issueTypes'], ['Story'])


class UnpromotedSelectorTests(WorkStructureRouteBase):
    def test_unpromoted_without_selector_keeps_legacy_unscoped_path(self):
        with patch.object(jira_server, 'get_selected_projects', return_value=[]) as selected:
            response = self.client.get('/api/components')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'components': []})
        selected.assert_called_once()

    def test_unpromoted_flag_on_selector_reads_the_virtual_entry(self):
        response = self.client.get('/api/components', query_string={'configurationId': 'legacy', 'configurationRevision': '0'})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))

    def test_unpromoted_flag_off_selector_is_denied(self):
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            response = self.client.get('/api/components', query_string={'configurationId': 'legacy', 'configurationRevision': '0'})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_feature_disabled'))

    def test_selector_outside_db_oauth_requires_setup(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch.object(jira_server, 'JIRA_AUTH_MODE', 'basic'):
            response = jira_server.app.test_client().get(
                '/api/components', query_string={'configurationId': 'legacy', 'configurationRevision': '0'})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'work_configuration_setup_required'))


if __name__ == '__main__':
    unittest.main()
