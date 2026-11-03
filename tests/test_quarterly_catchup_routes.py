"""Catch Up warnings for a quarterly (DELIVERY) configuration at the request seam: dependencies and Story readiness.

Synthetic workspace, Department and Jira rows only; every Jira call is patched, so nothing here reads `.env` values.
"""
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.db import models
from backend.routes import eng_routes, work_structure_routes as work_routes
from tests.test_story_readiness import _FakeResponse
from tests.test_work_structure_routes import WorkStructureRouteBase

DELIVERY = {'quarter': '2027Q1', 'configurationId': 'delivery', 'configurationRevision': '1'}
LEGACY = {'quarter': '2026Q4', 'configurationId': 'legacy', 'configurationRevision': '1'}


def _admit_sprint(_auth, _sources, sprint_id, *, configuration_id=None, quarter=None):
    return Mock(), {'id': int(sprint_id), 'name': quarter or '2027Q1'}


class QuarterlyCatchUpBase(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(work_routes, 'admit_sprint_source', side_effect=_admit_sprint))


class DependenciesRequestTests(QuarterlyCatchUpBase):
    def setUp(self):
        super().setUp()
        self.collect = self.stack.enter_context(patch.object(
            jira_server, 'collect_dependencies',
            return_value={'PLAN-1': [{'key': 'PLAN-9', 'category': 'block', 'direction': 'inward'}]}))

    def post(self, query, body=None):
        return self.client.post('/api/dependencies', query_string=query,
                                json=body or {'keys': ['PLAN-1'], 'refresh': True}, headers=self.headers())

    def test_promoted_delivery_request_reads_dependencies_through_the_delivery_roles(self):
        self.promoted_seed()
        response = self.post(DELIVERY)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['dependencies']['PLAN-1'][0]['key'], 'PLAN-9')
        roles = self.collect.call_args.kwargs['roles']
        self.assertEqual((roles.configuration_id, roles.is_legacy), ('delivery', False))

    def test_stale_and_mismatched_selectors_keep_their_codes_before_jira(self):
        self.promoted_seed()
        for query, code in (
                ({**DELIVERY, 'configurationRevision': '9'}, 'configuration_scope_changed'),
                ({**DELIVERY, 'configurationId': 'legacy'}, 'configuration_scope_changed'),
                ({'configurationId': 'delivery', 'configurationRevision': '1'}, 'configuration_required'),
        ):
            response = self.post(query)
            self.assertEqual((response.status_code, response.get_json()['error']), (409, code), query)
        self.collect.assert_not_called()

    def test_body_accepts_only_keys_and_refresh(self):
        self.promoted_seed()
        response = self.post({}, body={'keys': ['PLAN-1'], **DELIVERY})  # the old body-stamped request shape
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_dependencies_request'))
        self.collect.assert_not_called()

    def test_csrf_and_requested_with_still_guard_the_post(self):
        self.promoted_seed()
        response = self.client.post('/api/dependencies', query_string=DELIVERY, json={'keys': ['PLAN-1']})
        self.assertIn(response.status_code, (400, 403))
        self.collect.assert_not_called()

    def test_legacy_quarter_and_unpromoted_workspace_are_unchanged(self):
        self.promoted_seed()
        response = self.post(LEGACY)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(self.collect.call_args.kwargs['roles'].is_legacy)

    def test_unpromoted_workspace_keeps_the_flat_path(self):
        self.seed(promoted=False)
        response = self.post({})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertNotIn('roles', self.collect.call_args.kwargs)


class StoryReadinessRequestTests(QuarterlyCatchUpBase):
    LABELS = {'t1': ['alias_a'], 't2': ['alias_b']}

    def setUp(self):
        super().setUp()
        with eng_routes._STORY_READINESS_LOCK:
            eng_routes._STORY_READINESS_CACHE.clear()
            eng_routes._STORY_READINESS_INFLIGHT.clear()
        self.searches = []
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', side_effect=self.jira_get))
        self.stack.enter_context(patch.object(jira_server, 'current_jira_search', side_effect=self.jira_search))

    def seed_department(self, labels=None):
        with self.factory() as session:
            session.add(models.WorkspaceGroupConfig(workspace_id=self.workspace_id, config_revision=1, payload={
                'version': 1, 'defaultGroupId': 'g',
                'groups': [{'id': 'g', 'name': 'Dept', 'teamIds': ['t1', 't2'],
                            'teamLabels': self.LABELS if labels is None else labels}]}))
            session.add(models.WorkspaceTeamCatalog(workspace_id=self.workspace_id, config_revision=1, payload={
                'catalog': {'t1': {'id': 't1', 'name': 'Alpha'}, 't2': {'id': 't2', 'name': 'Beta'}}, 'meta': {}}))
            session.commit()

    def jira_get(self, path, **_kwargs):
        sprint = {'id': 5, 'name': self.sprint_name, 'state': 'active'}
        if path.endswith('/sprint'):
            return _FakeResponse(200, {'values': [sprint], 'isLast': True})
        if path.startswith('/rest/agile/1.0/sprint/'):
            return _FakeResponse(200, sprint)
        return _FakeResponse(200, [])

    def jira_search(self, payload, **_kwargs):
        self.searches.append(payload['jql'])
        return _FakeResponse(200, {'issues': [], 'isLast': True})

    def get(self, selectors, sprint_name='2027Q1'):
        self.sprint_name = sprint_name
        return self.client.get('/api/eng/story-readiness', query_string={
            'sprint': '5', 'sprintName': sprint_name, 'sprintState': 'active', 'groupId': 'g', **selectors})

    def test_complete_delivery_configuration_loads_readiness_from_initiatives(self):
        self.promoted_seed()
        self.seed_department()
        response = self.get(DELIVERY)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['complete'], True)
        discovery = self.searches[0]
        self.assertIn('project in ("PLAN")', discovery)
        self.assertIn('issuetype = 10001', discovery)
        self.assertNotIn('OLD', discovery)

    def test_stale_and_mismatched_selectors_are_configuration_conflicts_not_readiness_errors(self):
        self.promoted_seed()
        self.seed_department()
        for query, code in (
                ({**DELIVERY, 'configurationRevision': '9'}, 'configuration_scope_changed'),
                ({**DELIVERY, 'configurationId': 'legacy'}, 'configuration_scope_changed'),
        ):
            response = self.get(query)
            self.assertEqual((response.status_code, response.get_json()['error']), (409, code), query)
        self.assertEqual(self.searches, [])

    def test_unlabeled_team_names_the_team_without_leaking_labels(self):
        self.promoted_seed()
        self.seed_department({'t1': ['alias_a'], 't2': []})
        response = self.get(DELIVERY)
        body = response.get_json()
        self.assertEqual((response.status_code, body['error'], body['reason'], body['teams']),
                         (409, 'story_readiness_configuration_invalid', 'team_labels_missing', ['Beta']))
        self.assertNotIn('alias_a', response.get_data(as_text=True))
        self.assertEqual(self.searches, [])

    def test_shared_label_is_its_own_reason(self):
        self.promoted_seed()
        self.seed_department({'t1': ['alias_shared'], 't2': ['alias_shared']})
        body = self.get(DELIVERY).get_json()
        self.assertEqual((body['error'], body['reason']), ('story_readiness_configuration_invalid', 'team_labels_shared'))
        self.assertNotIn('teams', body)

    def test_department_loader_failure_is_unavailable_not_incomplete(self):
        self.promoted_seed()
        self.seed_department()
        with patch.object(eng_routes, '_story_readiness_effective_groups', side_effect=RuntimeError('storage down')):
            response = self.get(DELIVERY)
        self.assertEqual((response.status_code, response.get_json()['error']), (502, 'story_readiness_unavailable'))

    def test_legacy_quarter_keeps_story_epic_readiness(self):
        self.promoted_seed()
        self.seed_department()
        response = self.get(LEGACY, sprint_name='2026Q4')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIn('issuetype = Epic', self.searches[0])
        self.assertIn('"OLD"', self.searches[0])


if __name__ == '__main__':
    unittest.main()
