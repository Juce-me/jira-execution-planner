"""Scenario Planner under the quarterly work configuration (plan Task 6B): denial table and Legacy seam.

Every route of the plan's Scenario table is exercised with direct requests (no UI): the stored Legacy
history/presence/locks/preview keep their rights, new-model/unknown/unresolved source work answers
409 ``scenario_not_supported`` before the planner, and actual writeback stays blocked.
"""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from flask import g, jsonify

import jira_server
from backend.auth.context import RequestAuthContext
from backend.db import models
from backend.routes import scenario_draft_routes
from backend.routes import work_structure_routes as work_routes
from backend.scenario_drafts import ScenarioDraftReloadUnavailable
from tests.test_work_structure_routes import WorkStructureRouteBase

DENIED = (409, 'scenario_not_supported')
LEGACY_SCOPE = {'filters': {'sprint': '11'}}
NEW_SCOPE = {'filters': {'sprint': '22'}}


def error_of(response):
    body = response.get_json() or {}
    return response.status_code, body.get('error')


class ScenarioBase(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        rows = {'11': ('legacy', '2026Q4'), '22': ('delivery', '2027Q1')}

        def admit(auth_context, sources, sprint_id, configuration_id=None, quarter=None):
            if sprint_id not in rows:
                raise work_routes.WorkConfigError('sprint_catalog_mismatch')
            return Mock(configuration_id=rows[sprint_id][0]), {'id': int(sprint_id), 'name': rows[sprint_id][1]}

        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(work_routes, 'admit_sprint_source', side_effect=admit))
        self.queries = []
        self.stack.enter_context(patch.object(
            jira_server, 'fetch_issues_by_jql', side_effect=lambda jql, *a, **k: self.queries.append(jql) or []))
        self.stack.enter_context(patch.object(jira_server, 'collect_dependencies', return_value={}))

    def post(self, path, body=None, query=None):
        return self.client.post(path, json=body or {}, query_string=query or {}, headers=self.headers())

    def create_legacy_draft(self, scope=None):
        response = self.post('/api/scenario/drafts', {
            'scope_key': 'k1', 'name': 'Legacy', 'overrides': {}, 'baseDraftRevision': None,
            'scope': scope or LEGACY_SCOPE})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()['activeDraft']['draftId']


class PlannerEntryTests(ScenarioBase):
    def test_legacy_source_runs_through_its_captured_context(self):
        response = self.post('/api/scenario', {'filters': {'sprint': '11', 'teams': ['t1']}})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        jql = self.queries[0]
        self.assertIn('project in ("OLD", "OLDB")', jql)
        self.assertIn('Sprint = 11', jql)
        self.assertIn('"Team[Team]" = "t1"', jql)
        self.assertNotIn('PLAN', jql)

    def test_quarter_name_source_is_resolved_directly(self):
        self.assertEqual(self.post('/api/scenario', {'filters': {'sprint': '2026Q4'}}).status_code, 200)
        self.assertEqual(error_of(self.post('/api/scenario', {'filters': {'sprint': '2027Q1'}})), DENIED)

    def test_new_model_unknown_and_unresolved_sources_are_denied_before_any_query(self):
        for filters in ({'sprint': '22'}, {'sprint': '99'}, {'sprint': 'Sprint 12'}, {}):
            before = len(self.queries)
            response = self.post('/api/scenario', {'filters': filters})
            self.assertEqual(error_of(response), DENIED, filters)
            self.assertEqual(len(self.queries), before)

    def test_incomplete_legacy_source_is_its_own_409(self):
        import json
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = json.loads(json.dumps(row.payload))
            payload['workConfigurations']['configurations'][0]['fields']['team'] = {'fieldId': '', 'fieldName': ''}
            row.payload = payload
            session.commit()
        response = self.post('/api/scenario', {'filters': {'sprint': '11'}})
        self.assertEqual(error_of(response), (409, 'configuration_incomplete'))
        self.assertEqual(self.queries, [])

    def test_get_without_a_cached_scenario_is_unchanged(self):
        self.assertEqual(self.client.get('/api/scenario').status_code, 404)

    def test_json_loaders_are_never_consulted(self):
        self.post('/api/scenario', {'filters': {'sprint': '11'}})
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()


class OverrideRouteTests(ScenarioBase):
    def test_plain_stored_scope_read_is_unchanged(self):
        response = self.client.get('/api/scenario/overrides?scope_key=k1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['storage'], 'db')

    def test_selected_new_model_quarter_is_denied_and_legacy_or_malformed_follow_the_matrix(self):
        self.assertEqual(error_of(self.client.get('/api/scenario/overrides?scope_key=k1&quarter=2027Q1')), DENIED)
        self.assertEqual(self.client.get('/api/scenario/overrides?scope_key=k1&quarter=2026Q4').status_code, 200)
        self.assertEqual(error_of(self.client.get('/api/scenario/overrides?scope_key=k1&quarter=2027q1')),
                         (400, 'invalid_quarter'))
        self.assertEqual(error_of(self.client.get(
            '/api/scenario/overrides?scope_key=k1&quarter=2026Q4&configurationId=delivery')),
            (409, 'configuration_scope_changed'))

    def test_legacy_override_post_stays_unreachable_in_db_oauth(self):
        for scope_key in ('k1', ''):
            response = self.post('/api/scenario/overrides', {'scope_key': scope_key, 'overrides': {}})
            self.assertEqual(error_of(response), (501, 'route_not_oauth_ready'))
        self.assertEqual(error_of(self.post('/api/scenario/overrides', {'quarter': '2027Q1'})),
                         (501, 'route_not_oauth_ready'))


class DraftRouteTests(ScenarioBase):
    def test_new_draft_names_its_source(self):
        self.create_legacy_draft()
        self.assertEqual(error_of(self.post('/api/scenario/drafts', {
            'scope_key': 'k2', 'overrides': {}, 'baseDraftRevision': None, 'scope': NEW_SCOPE})), DENIED)
        self.assertEqual(error_of(self.post('/api/scenario/drafts', {
            'scope_key': 'k2', 'overrides': {}, 'baseDraftRevision': None, 'scope': {'filters': {'sprint': '99'}}})),
            DENIED)
        # No source named: no stamp is required and the stored-draft rights are unchanged.
        self.assertEqual(self.post('/api/scenario/drafts', {
            'scope_key': 'k3', 'overrides': {}, 'baseDraftRevision': None}).status_code, 200)

    def test_selected_new_model_context_is_denied_on_every_draft_route(self):
        draft_id = self.create_legacy_draft()
        paths = (
            ('get', '/api/scenario/drafts?scope_key=k1'),
            ('get', f'/api/scenario/drafts/{draft_id}/versions/1'),
            ('get', f'/api/scenario/drafts/{draft_id}/events'),
            ('get', f'/api/scenario/drafts/{draft_id}/events/stream'),
            ('get', f'/api/scenario/drafts/{draft_id}/presence'),
            ('post', f'/api/scenario/drafts/{draft_id}/presence'),
            ('post', f'/api/scenario/drafts/{draft_id}/locks'),
            ('post', f'/api/scenario/drafts/{draft_id}/rollback'),
            ('post', f'/api/scenario/drafts/{draft_id}/reload-from-jira'),
            ('post', f'/api/scenario/drafts/{draft_id}/writeback/preview'),
            ('post', f'/api/scenario/drafts/{draft_id}/writeback'),
        )
        for method, path in paths:
            if method == 'get':
                response = self.client.get(path, query_string={'quarter': '2027Q1'} if '?' not in path else None)
                if '?' in path:
                    response = self.client.get(path + '&quarter=2027Q1')
            else:
                response = self.post(path, {'quarter': '2027Q1', 'baseDraftRevision': 1, 'targetVersionNumber': 1})
            self.assertEqual(error_of(response), DENIED, path)

    def test_stored_legacy_history_keeps_its_current_rights(self):
        draft_id = self.create_legacy_draft()
        self.assertEqual(self.client.get('/api/scenario/drafts?scope_key=k1').status_code, 200)
        self.assertEqual(self.client.get(f'/api/scenario/drafts/{draft_id}/versions/1').status_code, 200)
        self.assertEqual(self.client.get(f'/api/scenario/drafts/{draft_id}/events').status_code, 200)
        self.assertEqual(self.client.get(f'/api/scenario/drafts/{draft_id}/presence').status_code, 200)
        self.assertEqual(self.post(f'/api/scenario/drafts/{draft_id}/presence', {'mode': 'viewing'}).status_code, 200)
        lock = self.post(f'/api/scenario/drafts/{draft_id}/locks',
                         {'action': 'acquire', 'resourceType': 'issue', 'resourceId': 'OLD-1'})
        self.assertEqual(lock.status_code, 200, lock.get_data(as_text=True))
        self.assertEqual(self.post(f'/api/scenario/drafts/{draft_id}/writeback/preview').status_code, 200)
        rollback = self.post(f'/api/scenario/drafts/{draft_id}/rollback',
                             {'targetVersionNumber': 1, 'baseDraftRevision': 1})
        self.assertNotEqual(error_of(rollback)[1], 'scenario_not_supported')

    def test_actual_writeback_stays_blocked(self):
        draft_id = self.create_legacy_draft()
        response = self.post(f'/api/scenario/drafts/{draft_id}/writeback')
        self.assertEqual(error_of(response), (403, 'jira_writeback_gate_blocked'))

    def test_other_users_draft_is_still_not_found(self):
        draft_id = self.create_legacy_draft()
        other = self._client(self._other_connection())
        response = other.get(f'/api/scenario/drafts/{draft_id}/versions/1')
        self.assertEqual(response.status_code, 404)

    def _other_connection(self):
        with self.factory() as session:
            other_workspace = models.Workspace(
                environment_key='other', name='Other', jira_site_url='https://two.example.test',
                jira_cloud_id='cloud-two')
            session.add(other_workspace)
            session.flush()
            connection_id = self._connection(session, other_workspace, 'outsider', 'user')
            session.commit()
            return connection_id

    def test_non_editor_member_keeps_the_same_denial_and_stored_rights(self):
        draft_id = self.create_legacy_draft()
        member = self.member
        self.assertEqual(error_of(member.get('/api/scenario/drafts?scope_key=k1&quarter=2027Q1')), DENIED)
        self.assertEqual(member.get('/api/scenario/drafts?scope_key=k1').status_code, 200)
        denied = member.post('/api/scenario', json={'filters': {'sprint': '22'}}, headers=self.headers(member))
        self.assertEqual(error_of(denied), DENIED)
        self.assertEqual(member.get(f'/api/scenario/drafts/{draft_id}/versions/1').status_code, 200)

    def test_unauthenticated_requests_still_answer_401(self):
        anonymous = jira_server.app.test_client()
        for method, path in (('get', '/api/scenario/drafts?scope_key=k1&quarter=2027Q1'),
                             ('get', '/api/scenario/overrides?scope_key=k1&quarter=2027Q1'),
                             ('post', '/api/scenario')):
            response = getattr(anonymous, method)(path)
            self.assertEqual(response.status_code, 401, path)


class ReloadSeamTests(ScenarioBase):
    """The reload loader resolves the Legacy context first and hands it to the planner."""

    def auth_context(self):
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.admin_connection)
            user = session.get(models.User, connection.user_id)
            scopes = tuple(jira_server.ATLASSIAN_SCOPES.split())
            return RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=user.id, stable_subject=user.external_subject,
                atlassian_account_id=user.external_subject, workspace_id=self.workspace_id,
                auth_connection_id=connection.id, cloud_id='cloud-one', site_url='https://one.example.test',
                token_version='1', account_status='active', is_admin=True, granted_scopes=scopes,
                granted_scopes_verified=True)

    def run_loader(self, scope):
        seen = {}

        def planner():
            seen['done'] = g.get('scenario_work_gate_done')
            seen['request'] = g.get('scenario_work_request')
            return jsonify({'issues': []})

        auth = self.auth_context()
        self.stack.enter_context(patch.object(jira_server, 'current_request_auth_context', return_value=auth))
        self.stack.enter_context(patch.object(jira_server, 'scenario_planner', side_effect=planner))
        context = SimpleNamespace(browser_session_id='browser-1')
        data = scenario_draft_routes.scenario_draft_reload_source_loader(context, {'scopePayload': scope}, 20)
        return data, seen

    def test_legacy_reload_after_promotion_passes_the_captured_context(self):
        data, seen = self.run_loader(LEGACY_SCOPE)
        self.assertEqual(data, {'issues': []})
        self.assertTrue(seen['done'])
        self.assertEqual(seen['request'].roles.configuration_id, 'legacy')

    def test_new_model_unknown_and_unresolved_reload_never_reaches_the_planner(self):
        for scope in (NEW_SCOPE, {'filters': {'sprint': '99'}}, {}):
            with self.assertRaises(ScenarioDraftReloadUnavailable) as raised:
                self.run_loader(scope)
            self.assertEqual(str(raised.exception), 'scenario_not_supported')

    def test_reload_route_maps_the_denial_to_409(self):
        # The route turns the loader's denial code into the scenario_not_supported envelope.
        def denied(context, draft_id, **kwargs):
            raise ScenarioDraftReloadUnavailable('scenario_not_supported')
        with patch.object(scenario_draft_routes, 'reload_from_jira', side_effect=denied):
            response = self.post('/api/scenario/drafts/any/reload-from-jira', {'baseDraftRevision': 1})
        self.assertEqual(error_of(response), DENIED)


if __name__ == '__main__':
    unittest.main()
