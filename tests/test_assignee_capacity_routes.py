"""Planning assignee capacity HTTP contract: policy, CSRF, isolation, limits and error bodies."""
from dataclasses import replace
from contextlib import nullcontext
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
        self.url_env = patch.dict(os.environ, {'DATABASE_URL': self.url, 'TEST_DATABASE_URL': self.url})
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
        super().tearDown()

    def headers(self):
        token = self.client.get('/api/auth/csrf', headers={'X-Requested-With': 'jira-execution-planner'}).get_json()['csrfToken']
        return {'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': token}

    def auth(self, context=None):
        from backend.db import engine as db_engine, models
        from tests.db_oauth_test_helpers import seed_db_actor
        target = context or self.context
        with db_engine.session_scope(self.url) as db:
            workspace = db.get(models.Workspace, target.workspace_id)
            workspace.jira_cloud_id = workspace.jira_cloud_id or ('synthetic-' + workspace.id)
            workspace.jira_site_url = workspace.jira_site_url or 'https://example.atlassian.net'
            actor = seed_db_actor(db, workspace=workspace,
                                  account_identity=target.atlassian_account_id)
        with self.client.session_transaction() as cookie:
            cookie['db_oauth_session'] = actor.session_payload
        return nullcontext()

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

    def test_stored_team_capacity_paths_never_write_jira(self):
        """#323 DoD 19: typing, Use ticket value and the mirror write only the store, never the Jira capacity write."""
        from backend.routes import capacity_routes
        from backend.services import capacity as capacity_service
        forbidden = AssertionError('Jira capacity write reached from a stored-number path')

        def jira_put(method, *args, **kwargs):
            if str(method).upper() != 'GET':
                raise forbidden

        with self.auth(), patch.object(capacity_service, 'update_capacity_issue', side_effect=forbidden), \
                patch.object(capacity_routes, 'update_capacity_issue', side_effect=forbidden), \
                patch.object(jira_server, 'current_jira_request', side_effect=jira_put):
            typed = self.patch_doc([], planned={'value': '14', 'source': 'user'})
            used = self.patch_doc([], planned={'value': '20', 'source': 'jira'})
            mirror = self.patch_doc([], planned={'value': '21', 'source': 'jira', 'onlyIfSource': [None, 'jira', 'inherited']})
            self.assertEqual([r.status_code for r in (typed, used, mirror)], [200, 200, 200])
            self.assertEqual(mirror.get_json()['planned'], {'value': '21', 'source': 'jira'})

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
            headers = self.headers()
            with patch.dict(os.environ, {'CONFIG_STORAGE_BACKEND': 'jsonfile'}):
                response = self.client.patch(self.path, data='not json', content_type='application/json', headers=headers)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json()['error'], 'runtime_storage_unsupported')
                document = self.client.get(self.path + '?teamId=team-a')
                self.assertEqual(document.status_code, 503)
                self.assertEqual(document.get_json()['error'], 'runtime_storage_unsupported')
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


    def read_planned(self, team_ids, sprint='17', headers=None, **kwargs):
        path = f'/api/eng/sprints/{sprint}/assignee-capacity/planned/read'
        return self.client.post(path, json={'teamIds': team_ids}, headers=self.headers() if headers is None else headers, **kwargs)

    def test_batch_read_contract_and_errors(self):
        with self.auth():
            self.patch_doc([], planned={'value': '5', 'source': 'user'})
            response = self.read_planned(['team-a', 'team-b'], '18')
            self.assertEqual(response.status_code, 200)
            body = response.get_json()
            self.assertEqual(set(body), {'sprintId', 'teams', 'capabilities'})
            self.assertEqual(body['teams'], [
                {'teamId': 'team-a', 'revision': 0, 'planned': None,
                 'inherited': {'fromSprintId': '17', 'planned': {'value': '5', 'source': 'inherited'}}},
                {'teamId': 'team-b', 'revision': 0, 'planned': None, 'inherited': None}])
            self.assertIn('reason', body['capabilities'])
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            for payload in ({'teamIds': ['a'], 'extra': 1}, {}, {'teamIds': []}, {'teamIds': ['a', 'a']},
                            {'teamIds': [' a']}, {'teamIds': [1]}, {'teamIds': 'a'},
                            {'teamIds': [f't{i}' for i in range(501)]}):
                response = self.client.post(self.path + '/planned/read', json=payload, headers=self.headers())
                self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_review_request'), payload)
            for sprint in ('abc', '0'):
                self.assertEqual(self.read_planned(['a'], sprint).status_code, 400)
            self.assertEqual(self.client.post(self.path + '/planned/read', json=[], headers=self.headers()).status_code, 400)
            oversized = self.client.post(self.path + '/planned/read', data=' ' * (capacity.MAX_BATCH_REQUEST_BYTES + 1),
                                         content_type='application/json', headers=self.headers())
            self.assertEqual((oversized.status_code, oversized.get_json()), (413, {'error': 'review_request_limit'}))
            padded = '{"teamIds":["a"]}' + ' ' * 100000
            self.assertEqual(self.client.post(self.path + '/planned/read', data=padded, content_type='application/json',
                                              headers=self.headers()).status_code, 200)
            with patch.object(capacity, 'read_planned_numbers', return_value={'teams': ['a' * capacity.MAX_RESPONSE_BYTES]}):
                response = self.read_planned(['a'])
                self.assertEqual((response.status_code, response.get_json()['error']), (413, 'review_response_limit'))
            with patch.object(capacity.db_engine, 'session_scope', side_effect=capacity.DBAPIError('s', {}, Exception('x'))):
                response = self.read_planned(['a'])
                self.assertEqual((response.status_code, response.get_json()), (503, {'error': 'review_storage_unavailable'}))
            self.assertEqual(self.read_planned(['a'], headers={}).status_code, 403)
            self.assertEqual(self.read_planned(['a'], headers={'X-Requested-With': 'jira-execution-planner'}).status_code, 403)
            missing = self.read_planned(['a'], headers={'X-Requested-With': 'jira-execution-planner'})
            self.assertEqual(missing.get_json()['error'], 'csrf_required')
            headers = self.headers()
            self.assertEqual(self.read_planned(['a'], headers=headers).status_code, 200)
            consumed = self.read_planned(['a'], headers=headers)
            self.assertEqual((consumed.status_code, consumed.get_json()['error']), (403, 'csrf_required'))

    def test_batch_read_anonymous_fails_with_401_before_storage(self):
        with patch.object(capacity.db_engine, 'session_scope', side_effect=AssertionError('forbidden database')):
            response = self.client.post(self.path + '/planned/read', json={'teamIds': ['a']},
                                        headers={'X-Requested-With': 'jira-execution-planner'})
            self.assertEqual((response.status_code, response.get_json()['error']), (401, 'auth_required'))

    def test_batch_read_is_workspace_isolated_and_non_admin_readable(self):
        foreign = replace(self.context, workspace_id=self.other_workspace)
        self.assertFalse(self.context.is_admin)
        with self.auth():
            self.patch_doc([], planned={'value': '5', 'source': 'user'})
            self.assertEqual(self.read_planned(['team-a']).get_json()['teams'][0]['planned'], {'value': '5', 'source': 'user'})
        with self.auth(foreign):
            self.assertEqual(self.read_planned(['team-a']).get_json()['teams'][0],
                             {'teamId': 'team-a', 'revision': 0, 'planned': None, 'inherited': None})

    def test_batch_read_without_read_capability_returns_no_teams_and_no_query(self):
        denied = {'canRead': False, 'canSave': False, 'reason': 'Shared review saving requires database-backed OAuth.'}
        with self.auth(), patch('backend.routes.sprint_review_routes.sprint_review.capabilities', return_value=denied), \
                patch.object(capacity, 'read_planned_numbers', side_effect=AssertionError('query')):
            response = self.read_planned(['team-a'])
            self.assertEqual((response.status_code, response.get_json()), (
                200, {'sprintId': '17', 'teams': [], 'capabilities': denied}))
            self.assertTrue(response.headers['Server-Timing'].startswith('assignee-capacity-planned-read;dur='))
        with self.auth():
            self.assertTrue(self.read_planned(['team-a']).headers['Server-Timing'].startswith('assignee-capacity-planned-read;dur='))


if __name__ == '__main__':
    unittest.main()
