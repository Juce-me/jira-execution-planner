"""Exercise the registered APIs through real endpoint policy and CSRF guards."""
import os
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.services import sprint_review as review
from tests.db_oauth_test_helpers import seed_db_actor
from backend.auth.db_context import resolve_db_request_auth_context
from backend.db import engine as db_engine, models
from tests.test_sprint_review import ReviewFixture


class SprintReviewRouteTests(ReviewFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.url_env = patch.dict(os.environ, {'DATABASE_URL': self.url, 'TEST_DATABASE_URL': self.url})
        self.url_env.start()
        self.mode = patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth')
        self.mode.start()
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'synthetic-review-session'
        self.client = jira_server.app.test_client()
        with db_engine.session_scope(self.url) as db:
            workspace = db.get(models.Workspace, self.workspace)
            workspace.environment_key = 'local'
            workspace.jira_site_url = 'https://example.atlassian.net'
            workspace.jira_cloud_id = 'synthetic-review-cloud'
            actor = seed_db_actor(db, workspace=workspace, account_identity='synthetic-review-user')
        self.session_payload = actor.session_payload
        self.context = resolve_db_request_auth_context(self.session_payload)
        self.path = '/api/eng/sprints/17/review'

    def tearDown(self):
        self.mode.stop()
        self.url_env.stop()
        super().tearDown()

    def _install_actor(self):
        with self.client.session_transaction() as cookie:
            cookie['db_oauth_session'] = self.session_payload

    def headers(self):
        token = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'}).get_json()['csrfToken']
        return {'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token}

    def test_new_jira_edit_http_paths_reject_file_profile_without_io(self):
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}), \
             patch('builtins.open', side_effect=AssertionError('forbidden legacy file I/O')), \
             patch.object(jira_server, 'current_jira_request', side_effect=AssertionError('forbidden Jira transport')):
            for field in ('summary', 'team'):
                for method, path, body in (
                    ('GET', '/api/issues/DEMO-1/editable-fields?field=' + field, None),
                    ('POST', '/api/issues/DEMO-1/field', {'field': field, 'value': 'synthetic'})):
                    response = self.client.open(path, method=method, json=body)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.get_json()['error'], 'runtime_storage_unsupported')

    def test_anonymous_all_three_routes_fail_without_jira_or_storage(self):
        with patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('forbidden search')), \
             patch.object(review.db_engine, 'session_scope', side_effect=AssertionError('forbidden database')):
            for method, path in [('GET', self.path + '?groupId=group-x'), ('PATCH', self.path), ('POST', self.path + '/values/read')]:
                response = self.client.open(path, method=method, json={'groupId': 'group-x'})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.get_json()['error'], 'auth_required')

    def test_non_admin_read_save_and_csrf_preserved(self):
        self._install_actor()
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
        self._install_actor()
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
        self._install_actor()
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
        self._install_actor()
        headers = self.headers()
        with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}):
            for method, path in (('PATCH', self.path), ('POST', self.path + '/values/read'),
                                 ('GET', self.path + '?groupId=%20bad'), ('GET', self.path + '?groupId=group-x')):
                with self.subTest(method=method, path=path):
                    response = self.client.open(path, method=method, data='not json',
                                                content_type='application/json', headers=headers)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.get_json()['error'], 'runtime_storage_unsupported')
        response = self.client.patch(self.path, json={'groupId': 'unlisted', 'baseSchemaRevision': 'x'}, headers=self.headers())
        self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'invalid_review_request'}))
        with patch.object(jira_server, 'current_jira_search', side_effect=AssertionError('authorization before membership')):
            response = self.client.patch(self.path, json={'groupId': 'unlisted', 'baseSchemaRevision': 0, 'cellChanges': [self.cell()]}, headers=self.headers())
        self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'review_group_unknown'}))

    def test_view_limit_and_malformed_group_payload_bodies(self):
        self._install_actor()
        from backend.db import engine as db_engine, models
        with db_engine.session_scope(self.url) as session:
            session.add_all([models.GroupSprintReviewView(workspace_id=self.workspace, group_id='group-x', sprint_id=str(i),
                                                          sprint_order=review.sprint_order(str(i)), layouts={}, view_revision=1)
                             for i in range(1, review.MAX_GROUP_VIEWS + 1)])
        body = {'groupId': 'group-x', 'baseSchemaRevision': 0, 'schemaChanges': [{'action': 'layout', 'rowKind': 'story', 'order': [], 'hidden': []}]}
        response = self.client.patch(self.path.replace('17', '9999'), json=body, headers=self.headers())
        self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'review_view_limit'}))
        self.set_groups({'groups': {'id': 'group-x'}})
        response = self.client.patch(self.path, json=body, headers=self.headers())
        self.assertEqual((response.status_code, response.get_json()), (503, {'error': 'review_unavailable'}))

    def test_jira_search_only_inside_authorization_and_no_credential_helpers(self):
        from backend.auth import token_crypto
        self._install_actor()
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

        with patch.object(review, 'authorize_issues', side_effect=tracked), \
             patch.object(jira_server, 'current_jira_search', side_effect=search) as jira_search, \
             patch.object(jira_server, 'jira_session_data', side_effect=AssertionError('Basic credentials forbidden')), \
             patch.object(jira_server, 'oauth_session_data_for_auth_context', side_effect=AssertionError('local token store forbidden')), \
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
