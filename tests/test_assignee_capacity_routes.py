"""Planning assignee capacity HTTP contract: policy, CSRF, isolation, limits and error bodies."""
from dataclasses import replace
import os
import unittest
from unittest.mock import patch

import jira_server
from backend.services import assignee_capacity as capacity
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session
from tests.test_sprint_review import ReviewFixture


class AssigneeCapacityRouteTests(ReviewFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.context = replace(self.context, granted_scopes=tuple(FULL_OAUTH_SCOPE.split()), granted_scopes_verified=True)
        self.url_env = patch.dict(os.environ, {'DATABASE_URL': self.url})
        self.url_env.start()
        self.mode = patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth')
        self.mode.start()
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'synthetic-capacity-session'
        self.client = jira_server.app.test_client()
        self.path = '/api/eng/sprints/17/assignee-capacity'
        self.change = {'assigneeKey': 'acct-1', 'displayName': 'Person One', 'capacity': '8'}

    def tearDown(self):
        self.mode.stop()
        self.url_env.stop()
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        super().tearDown()

    def headers(self):
        token = self.client.get('/api/auth/csrf').get_json()['csrfToken']
        return {'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token}

    def auth(self, context=None):
        install_oauth_session(self.client)
        return patch.object(jira_server, 'current_request_auth_context', return_value=context or self.context)

    def patch_doc(self, changes=None, team='team-a', path=None, **extra):
        return self.client.patch(path or self.path, json={'teamId': team, 'changes': [self.change] if changes is None else changes, **extra},
                                 headers=self.headers())

    def test_anonymous_fails_with_401_before_storage(self):
        with patch.object(capacity.db_engine, 'session_scope', side_effect=AssertionError('forbidden database')):
            for method, path in (('GET', self.path + '?teamId=team-a'), ('PATCH', self.path)):
                response = self.client.open(path, method=method, json={'teamId': 'team-a', 'changes': []})
                self.assertEqual((response.status_code, response.get_json()['error']), (401, 'auth_required'))

    def test_csrf_and_requested_with_are_required_and_403_differs_from_401(self):
        with self.auth():
            body = {'teamId': 'team-a', 'changes': [self.change]}
            for headers in ({}, {'X-Requested-With': 'jira-execution-planner'}, {'X-CSRF-Token': self.headers()['X-CSRF-Token']}):
                response = self.client.patch(self.path, json=body, headers=headers)
                self.assertEqual(response.status_code, 403, headers)
            self.assertEqual(self.client.get(self.path + '?teamId=team-a').status_code, 200)
            self.assertEqual(self.patch_doc().status_code, 200)

    def test_get_contract_headers_and_empty_document(self):
        with self.auth():
            response = self.client.get(self.path + '?teamId=team-a')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertIn('assignee-capacity-read;dur=', response.headers['Server-Timing'])
            self.assertEqual(response.get_json(), {'teamId': 'team-a', 'sprintId': '17', 'revision': 0, 'rows': [], 'planned': None, 'inherited': None,
                                                   'capabilities': {'canRead': True, 'canSave': True, 'reason': None}})

    def test_patch_contract_headers_and_roundtrip(self):
        with self.auth():
            response = self.patch_doc()
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertIn('assignee-capacity-write;dur=', response.headers['Server-Timing'])
            self.assertEqual(response.get_json()['revision'], 1)
            document = self.client.get(self.path + '?teamId=team-a').get_json()
            self.assertEqual([r['assigneeKey'] for r in document['rows']], ['acct-1'])
            later = self.client.get('/api/eng/sprints/18/assignee-capacity?teamId=team-a').get_json()
            self.assertEqual((later['revision'], later['inherited']['fromSprintId']), (0, '17'))
            self.assertEqual(self.client.get(self.path + '?teamId=team-b').get_json()['rows'], [])

    def test_two_users_share_one_workspace_and_workspaces_are_isolated(self):
        second = replace(self.context, user_id='synthetic-user-2', stable_subject='synthetic-user-2', atlassian_account_id='synthetic-account-2')
        foreign = replace(self.context, workspace_id=self.other_workspace)
        with self.auth():
            self.assertEqual(self.patch_doc().status_code, 200)
        with self.auth(second):
            rows = self.client.get(self.path + '?teamId=team-a').get_json()['rows']
            self.assertEqual([r['assigneeKey'] for r in rows], ['acct-1'])
            response = self.patch_doc([{'assigneeKey': 'acct-1', 'capacity': '3'}])
            self.assertEqual(response.get_json()['rows'][0]['capacity'], '3')
        with self.auth(foreign):
            document = self.client.get(self.path + '?teamId=team-a').get_json()
            self.assertEqual((document['rows'], document['revision'], document['inherited']), ([], 0, None))
            self.assertEqual(self.patch_doc([{'assigneeKey': 'acct-1', 'capacity': '1'}]).get_json()['revision'], 1)
        with self.auth():
            self.assertEqual(self.client.get(self.path + '?teamId=team-a').get_json()['rows'][0]['capacity'], '3')

    def test_get_query_contract(self):
        with self.auth():
            for query in ('', '?teamId=', '?teamId=%20a', '?teamId=a%20', '?teamId=a&teamId=a', '?teamId=a&groupId=g',
                          '?groupId=g', '?teamId=' + 'a' * 129, '?teamId=a%00b'):
                with self.subTest(query=query):
                    response = self.client.get(self.path + query)
                    self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'invalid_review_request'}))
            self.assertEqual(self.client.get('/api/eng/sprints/abc/assignee-capacity?teamId=a').status_code, 400)

    def test_patch_body_contract_and_error_bodies(self):
        with self.auth():
            bad = [[], {'teamId': 'team-a'}, {'changes': []}, {'teamId': 'team-a', 'changes': [], 'groupId': 'g'},
                   {'teamId': 'team-a', 'changes': [], 'userId': 'forged'}, {'teamId': 7, 'changes': []},
                   {'teamId': 'team-a', 'changes': [{'assigneeKey': 'a', 'workspaceId': 'x'}]},
                   {'teamId': 'team-a', 'changes': [{'assigneeKey': 'a'}, {'assigneeKey': 'a'}]},
                   {'teamId': 'team-a', 'changes': [{'assigneeKey': 'a%d' % n} for n in range(capacity.MAX_CHANGES + 1)]},
                   {'teamId': 'team-a', 'changes': [{'assigneeKey': 'a', 'capacity': '-1'}]}]
            for payload in bad:
                response = self.client.patch(self.path, json=payload, headers=self.headers())
                self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'invalid_review_request'}), payload)
            response = self.client.patch(self.path, data='not json', content_type='application/json', headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'invalid_review_request'}))
            self.assertEqual(self.client.patch('/api/eng/sprints/abc/assignee-capacity', json={'teamId': 'a', 'changes': []},
                                               headers=self.headers()).status_code, 400)
            self.assertEqual(self.client.patch(self.path + '?teamId=a', json={'teamId': 'a', 'changes': []}, headers=self.headers()).status_code, 400)
            self.assertEqual(self.client.get(self.path + '?teamId=team-a').get_json()['revision'], 0)

    def test_planned_contract_shapes_and_inheritance(self):
        with self.auth():
            response = self.patch_doc([], planned={'value': '20.5', 'source': 'user'})
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            body = response.get_json()
            self.assertEqual((body['revision'], body['planned'], body['inherited']), (1, {'value': '20.5', 'source': 'user'}, None))
            self.assertEqual(body['capabilities'], {'canRead': True, 'canSave': True, 'reason': None})
            self.assertEqual(self.client.get(self.path + '?teamId=team-a').get_json()['planned'], {'value': '20.5', 'source': 'user'})
            later = self.client.get('/api/eng/sprints/18/assignee-capacity?teamId=team-a').get_json()
            self.assertEqual((later['planned'], later['inherited']['planned']), (None, {'value': '20.5', 'source': 'inherited'}))
            mirror = {'value': '19', 'source': 'jira', 'onlyIfSource': [None, 'jira', 'inherited']}
            kept = self.patch_doc([], planned=mirror).get_json()
            self.assertEqual((kept['planned'], kept['revision']), ({'value': '20.5', 'source': 'user'}, 1))
            none_created = self.patch_doc([], planned=mirror, path='/api/eng/sprints/18/assignee-capacity').get_json()
            self.assertEqual(none_created['revision'], 0)
            cleared = self.patch_doc([], planned={'value': None}).get_json()
            self.assertEqual((cleared['planned'], cleared['revision']), (None, 2))

    def test_planned_body_errors_are_codes_without_message(self):
        with self.auth():
            for planned in (None, 'x', {'value': '5', 'source': 'inherited'}, {'value': '5'}, {'value': '1.234', 'source': 'user'},
                            {'value': '5', 'source': 'user', 'extra': True}, {'value': '5', 'source': 'jira', 'onlyIfSource': []}):
                with self.subTest(planned=planned):
                    response = self.patch_doc([], planned=planned)
                    self.assertEqual((response.status_code, response.get_json()), (400, {'error': 'invalid_review_request'}))
            self.assertEqual(self.client.patch(self.path, json={'teamId': 'team-a', 'planned': {'value': '5', 'source': 'user'}},
                                               headers=self.headers()).status_code, 400)
            self.assertEqual(self.client.get(self.path + '?teamId=team-a').get_json()['revision'], 0)

    def test_planned_requires_csrf_and_is_isolated_by_workspace(self):
        foreign = replace(self.context, workspace_id=self.other_workspace)
        with self.auth():
            response = self.client.patch(self.path, json={'teamId': 'team-a', 'changes': [], 'planned': {'value': '5', 'source': 'user'}},
                                         headers={'X-Requested-With': 'jira-execution-planner'})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(self.patch_doc([], planned={'value': '5', 'source': 'user'}).status_code, 200)
        with self.auth(foreign):
            self.assertIsNone(self.client.get(self.path + '?teamId=team-a').get_json()['planned'])
            self.assertIsNone(self.client.get('/api/eng/sprints/18/assignee-capacity?teamId=team-a').get_json()['inherited'])

    def test_request_limit_is_64_kib(self):
        with self.auth():
            response = self.client.patch(self.path, data=' ' * (capacity.MAX_REQUEST_BYTES + 1), content_type='application/json', headers=self.headers())
            self.assertEqual((response.status_code, response.get_json()), (413, {'error': 'review_request_limit'}))
            padded = '{"teamId":"team-a","changes":[]}' + ' ' * 40000
            self.assertEqual(self.client.patch(self.path, data=padded, content_type='application/json', headers=self.headers()).status_code, 200)

    def test_response_limit_is_256_kib_and_does_not_leak_rows(self):
        from backend.routes.sprint_review_routes import _response
        with jira_server.app.test_request_context():
            response = _response({'rows': ['a' * capacity.MAX_RESPONSE_BYTES]}, limit=capacity.MAX_RESPONSE_BYTES)
            self.assertEqual(response.status_code, 413)
            self.assertNotIn('rows', response.get_json())
        with self.auth(), patch.object(capacity, 'get_document', return_value={'rows': ['a' * capacity.MAX_RESPONSE_BYTES]}):
            response = self.client.get(self.path + '?teamId=team-a')
            self.assertEqual((response.status_code, response.get_json()['error']), (413, 'review_response_limit'))

    def test_storage_unavailable_bodies_are_503(self):
        with self.auth():
            with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}):
                response = self.client.patch(self.path, data='not json', content_type='application/json', headers=self.headers())
                self.assertEqual((response.status_code, response.get_json()), (503, {'error': 'review_storage_unavailable'}))
                document = self.client.get(self.path + '?teamId=team-a').get_json()
                self.assertFalse(document['capabilities']['canRead'])
                self.assertEqual((document['rows'], document['planned']), ([], None))
            with patch.object(capacity, 'apply_changes', side_effect=RuntimeError('boom')):
                response = self.patch_doc()
                self.assertEqual((response.status_code, response.get_json()), (503, {'error': 'review_unavailable'}))
            with patch.object(capacity, 'apply_changes', side_effect=capacity.ReviewError('assignee_capacity_busy', 503)):
                self.assertEqual(self.patch_doc().get_json(), {'error': 'assignee_capacity_busy'})
            with patch.object(capacity.db_engine, 'session_scope', side_effect=capacity.DBAPIError('s', {}, Exception('x'))):
                self.assertEqual(self.patch_doc().status_code, 503)

    def test_identity_comes_only_from_the_auth_context(self):
        with self.auth():
            self.patch_doc()
        with capacity.db_engine.session_scope(self.url) as session:
            from backend.db import models
            row = session.query(models.PlanningTeamSprintCapacity).one()
            self.assertEqual(row.workspace_id, self.workspace)
            self.assertFalse({'user_id', 'created_by'} & set(models.PlanningTeamSprintCapacity.__table__.columns.keys()))


if __name__ == '__main__':
    unittest.main()
