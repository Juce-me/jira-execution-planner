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
            for method, path in [('GET', self.path), ('PATCH', self.path), ('POST', self.path + '/values/read')]:
                response = self.client.open(path, method=method, json={})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.get_json()['error'], 'auth_required')

    def test_non_admin_read_save_and_csrf_preserved(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            headers = self.headers()
            for path, method in [(self.path, 'PATCH'), (self.path + '/values/read', 'POST')]:
                self.assertEqual(self.client.open(path, method=method, json={}).status_code, 403)
                self.assertEqual(self.client.open(path, method=method, json={}, headers={'X-Requested-With': 'jira-execution-planner'}).status_code, 403)
            initial = self.client.get(self.path)
            self.assertEqual(initial.status_code, 200)
            self.assertNotIn('cells', initial.get_json())
            response = self.client.patch(self.path, json={'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'add', 'column': self.column}], 'cellChanges': []}, headers=self.headers())
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.get_json()['schemaRevision'], 1)
            with patch.object(jira_server, 'current_jira_search', self.search):
                response = self.client.post(self.path + '/values/read', json={'issueIds': ['101'], 'rowKind': 'story'}, headers=self.headers())
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json()['cells'], [])

    def test_contract_malformed_authority_request_limits_and_conflict(self):
        install_oauth_session(self.client)
        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context):
            headers = self.headers()
            for payload in [[], {'baseSchemaRevision': 0, 'userId': 'forged'}, {'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'reorder', 'rowKind': 'story', 'columnIds': [{}]}]}]:
                response = self.client.patch(self.path, json=payload, headers=self.headers())
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
            response = self.client.patch(self.path, data=' ' * (review.MAX_REQUEST_BYTES + 1), content_type='application/json', headers=self.headers())
            self.assertEqual(response.status_code, 413)
            self.assertEqual(self.client.get(self.path + '?workspaceId=forged').status_code, 400)
            self.add()
            self.save(schemas=[{'action': 'rename', 'columnId': self.column['id'], 'label': 'Current'}])
            response = self.client.patch(self.path, json={'baseSchemaRevision': 1, 'schemaChanges': [{'action': 'rename', 'columnId': self.column['id'], 'label': 'Stale'}]}, headers=self.headers())
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.get_json()['code'], 'review_conflict')
            self.assertTrue(response.get_json()['schemaConflict'])

    def test_response_size_does_not_leak_partial_saved_values(self):
        from backend.routes.sprint_review_routes import _response
        with jira_server.app.test_request_context():
            response = _response({'cells': ['a' * review.MAX_RESPONSE_BYTES]})
            self.assertEqual(response.status_code, 413)
            self.assertNotIn('cells', response.get_json())
