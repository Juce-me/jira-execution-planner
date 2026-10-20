"""Exercise the registered APIs through real endpoint policy and CSRF guards."""
from dataclasses import replace
import os
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.services import sprint_review as review
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session
from tests.test_sprint_review import ReviewFixture


class SprintReviewRouteTests(ReviewFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.context = replace(self.context, granted_scopes=tuple(FULL_OAUTH_SCOPE.split()), granted_scopes_verified=True)
        self.url_env = patch.dict(os.environ, {'DATABASE_URL': self.url})
        self.url_env.start()
        self.mode = patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth')
        self.mode.start()
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'synthetic-review-session'
        self.client = jira_server.app.test_client()
        self.path = '/api/eng/sprints/17/review'

    def tearDown(self):
        self.mode.stop()
        self.url_env.stop()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        super().tearDown()

    def headers(self):
        token = self.client.get('/api/auth/csrf').get_json()['csrfToken']
        return {'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token}

    def test_new_jira_edit_http_paths_never_resolve_local_credentials(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch.object(jira_server, 'oauth_session_data', side_effect=AssertionError('forbidden local auth')), \
             patch.object(jira_server._LOCAL_OAUTH_STORE, 'session_data', side_effect=AssertionError('forbidden local store')), \
             patch.object(jira_server._LOCAL_OAUTH_STORE, 'session_data_for_id', side_effect=AssertionError('forbidden local token')), \
             patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('forbidden Jira transport')):
            for field in ('summary', 'team'):
                response = self.client.get('/api/issues/DEMO-1/editable-fields', query_string={'field': field})
                self.assertEqual(response.status_code, 403)
                response = self.client.post('/api/issues/DEMO-1/field', json={'field': field, 'value': 'synthetic'})
                self.assertEqual(response.status_code, 403)

    def test_anonymous_all_three_routes_fail_without_jira_or_storage(self):
        with patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('forbidden search')), \
             patch.object(review.db_engine, 'session_scope', side_effect=AssertionError('forbidden database')):
            for method, path in [('GET', self.path + '?groupId=group-x'), ('PATCH', self.path), ('POST', self.path + '/values/read')]:
                response = self.client.open(path, method=method, json={'groupId': 'group-x'})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.get_json()['error'], 'auth_required')

    def test_non_admin_read_save_and_csrf_preserved(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            headers = self.headers()
            for path, method in [(self.path, 'PATCH'), (self.path + '/values/read', 'POST')]:
                self.assertEqual(self.client.open(path, method=method, json={}).status_code, 403)
                self.assertEqual(self.client.open(path, method=method, json={}, headers={'X-Requested-With': 'jira-execution-planner'}).status_code, 403)
            initial = self.client.get(self.path, query_string={'groupId': 'group-x'})
            self.assertEqual(initial.status_code, 200)
            self.assertNotIn('cells', initial.get_json())
            self.assertEqual((initial.get_json()['groupId'], initial.get_json()['viewRevision'], initial.get_json()['inheritedFrom']), ('group-x', 0, None))
            response = self.client.patch(self.path, json={'groupId': 'group-x', 'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'add', 'column': self.column}], 'cellChanges': []}, headers=self.headers())
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['schemaRevision'], 1)
            with patch.object(jira_server, 'current_jira_search', self.search):
                response = self.client.post(self.path + '/values/read', json={'groupId': 'group-x', 'issueIds': ['101'], 'rowKind': 'story'}, headers=self.headers())
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json()['cells'], [])

    def test_contract_malformed_authority_request_limits_and_conflict(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            headers = self.headers()
            for payload in [[], {'groupId': 'group-x', 'baseSchemaRevision': 0, 'userId': 'forged'}, {'groupId': 'group-x', 'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'reorder', 'rowKind': 'story', 'columnIds': [{}]}]}]:
                response = self.client.patch(self.path, json=payload, headers=self.headers())
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
            response = self.client.patch(self.path, data=' ' * (review.MAX_REQUEST_BYTES + 1), content_type='application/json', headers=self.headers())
            self.assertEqual(response.status_code, 413)
            self.assertEqual(self.client.get(self.path + '?groupId=group-x&workspaceId=forged').status_code, 400)
            self.add()
            self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Current'}])
            response = self.client.patch(self.path, json={'groupId': 'group-x', 'baseSchemaRevision': 1, 'schemaChanges': [{'action': 'rename', 'columnId': self.column['id'], 'label': 'Stale'}]}, headers=self.headers())
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.get_json()['code'], 'review_conflict')
            self.assertTrue(response.get_json()['schemaConflict'])
            self.assertFalse(response.get_json()['viewConflict'])
            self.assertTrue({'schemaConflict', 'viewConflict', 'cellConflicts', 'columns', 'schemaRevision'} <= set(response.get_json()))

    def test_response_size_does_not_leak_partial_saved_values(self):
        from backend.routes.sprint_review_routes import _response
        with jira_server.app.test_request_context():
            response = _response({'cells': ['a' * review.MAX_RESPONSE_BYTES]})
            self.assertEqual(response.status_code, 413)
            self.assertNotIn('cells', response.get_json())

    def test_group_id_query_and_body_contract(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            for query in ('', '?groupId=', '?groupId=%20group-x', '?groupId=group-x%20', '?groupId=group-x&groupId=group-x',
                          '?groupId=group-x&other=1', '?groupId=' + 'a' * 129, '?groupId=a%00b'):
                with self.subTest(query=query):
                    response = self.client.get(self.path + query)
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.get_json(), {'error': 'invalid_review_request'})
            self.assertEqual(self.client.get(self.path + '?groupId=Group-X').status_code, 200)
            for method, path, body in (('PATCH', self.path, {'groupId': 'group-x', 'baseSchemaRevision': 0}),
                                       ('POST', self.path + '/values/read', {'groupId': 'group-x', 'issueIds': [], 'rowKind': 'story'})):
                with self.subTest(method=method):
                    self.assertEqual(self.client.open(path + '?groupId=group-x', method=method, json=body, headers=self.headers()).status_code, 400)
                    missing = {k: v for k, v in body.items() if k != 'groupId'}
                    response = self.client.open(path, method=method, json=missing, headers=self.headers())
                    self.assertEqual(response.get_json(), {'error': 'invalid_review_request'})
                    self.assertEqual(self.client.open(path, method=method, json=body, headers=self.headers()).status_code, 200)

    def test_capability_precedes_body_parsing_and_structure_precedes_membership(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}):
                for method, path in (('PATCH', self.path), ('POST', self.path + '/values/read')):
                    with self.subTest(method=method):
                        response = self.client.open(path, method=method, data='not json', content_type='application/json', headers=self.headers())
                        self.assertEqual((response.status_code, response.get_json()), (503, {'error': 'review_storage_unavailable'}))
                response = self.client.get(self.path + '?groupId=%20bad')
                self.assertEqual(response.status_code, 400)
                response = self.client.get(self.path + '?groupId=group-x')
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.get_json()['capabilities']['canSave'])
            response = self.client.patch(self.path, json={'groupId': 'unlisted', 'baseSchemaRevision': 'x'}, headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'invalid_review_request'}))
            with patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('authorization before membership')):
                response = self.client.patch(self.path, json={'groupId': 'unlisted', 'baseSchemaRevision': 0, 'cellChanges': [self.cell()]}, headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'review_group_unknown'}))

    def test_view_limit_and_malformed_group_payload_bodies(self):
        install_oauth_session(self.client)
        from backend.db import engine as db_engine, models
        with db_engine.session_scope(self.url) as session:
            session.add_all([models.GroupSprintReviewView(workspace_id=self.workspace, group_id='group-x', sprint_id=str(i),
                                                          sprint_order=review.sprint_order(str(i)), layouts={}, view_revision=1)
                             for i in range(1, review.MAX_GROUP_VIEWS + 1)])
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            body = {'groupId': 'group-x', 'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'layout', 'rowKind': 'story', 'order': [], 'hidden': []}]}
            response = self.client.patch(self.path.replace('17', '9999'), json=body, headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'review_view_limit'}))
            self.set_groups({'groups': {'id': 'group-x'}})
            response = self.client.patch(self.path, json=body, headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()), (503, {'error': 'review_unavailable'}))

    def test_jira_search_only_inside_authorization_and_no_credential_helpers(self):
        from backend.auth import home_credentials, token_crypto
        install_oauth_session(self.client)
        inside = []
        real_authorize = review.authorize_issues

        def tracked(*args, **kwargs):
            inside.append(True)
            try:
                return real_authorize(*args, **kwargs)
            finally:
                inside.pop()

        def search(payload, **kwargs):
            self.assertTrue(inside, 'Jira search outside authorize_issues')
            return self._search(payload, **kwargs)

        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            with patch.object(review, 'authorize_issues', side_effect=tracked), \
                 patch.object(jira_server, 'current_jira_search', side_effect=search) as jira_search, \
                 patch.object(jira_server, 'jira_session_data', side_effect=AssertionError('Basic credentials forbidden')), \
                 patch.object(jira_server, 'oauth_session_data_for_auth_context', side_effect=AssertionError('local token store forbidden')), \
                 patch.object(home_credentials, 'resolve_home_credential', side_effect=AssertionError('Home/service credential forbidden')), \
                 patch.object(token_crypto, 'decrypt_token', side_effect=AssertionError('token decryption forbidden')):
                self.assertEqual(self.client.get(self.path, query_string={'groupId': 'group-x'}).status_code, 200)
                self.assertEqual(jira_search.call_count, 0)
                response = self.client.patch(self.path, json={'groupId': 'group-x', 'baseSchemaRevision': 0, 'baseViewRevision': 0,
                    'schemaChanges': [{'action': 'add', 'column': self.column}, {'action': 'layout', 'rowKind': 'story', 'order': [self.column['id']], 'hidden': []}],
                    'cellChanges': [self.cell()]}, headers=self.headers())
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['viewRevision'], 1)
                response = self.client.post(self.path + '/values/read', json={'groupId': 'group-x', 'issueIds': ['101'], 'rowKind': 'story'}, headers=self.headers())
                self.assertEqual(response.get_json()['cells'][0]['value'], '1.100')
                self.assertEqual(jira_search.call_count, 2)
