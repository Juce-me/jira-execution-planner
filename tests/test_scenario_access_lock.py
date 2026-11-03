"""Scenario Planner admin lock: admin-only by default, one admin-owned workspace switch unlocks it.

The switch is the `scenarioPlanner` section of the workspace administrator configuration, written only
through `POST /api/scenario-access/config` (`shared_admin_write`); `/api/config` exposes it and every
Scenario route enforces it with 403 `scenario_locked` before any Jira work.
"""
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.routes import work_structure_routes as work_routes
from tests.test_work_structure_routes import WorkStructureRouteBase

LOCKED = (403, 'scenario_locked')


def error_of(response):
    body = response.get_json() or {}
    return response.status_code, body.get('error')


class ScenarioAccessLockTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source',
            return_value=(Mock(configuration_id='legacy'), {'id': 11, 'name': '2026Q4'})))
        self.queries = []
        self.stack.enter_context(patch.object(
            jira_server, 'fetch_issues_by_jql', side_effect=lambda jql, *a, **k: self.queries.append(jql) or []))
        self.stack.enter_context(patch.object(jira_server, 'collect_dependencies', return_value={}))

    def run_scenario(self, client):
        return client.post('/api/scenario', json={'filters': {'sprint': '11'}}, headers=self.headers(client))

    def set_switch(self, client, enabled, base=None):
        revision = self.row()[1] if base is None else base
        return client.post('/api/scenario-access/config', json={'enabledForEveryone': enabled, 'baseRevision': revision},
                           headers=self.headers(client))

    def test_bootstrap_reports_the_lock_per_user(self):
        admin = self.client.get('/api/config').get_json()
        member = self.member.get('/api/config').get_json()
        self.assertIs(admin['scenarioPlannerForEveryone'], False)
        self.assertIs(admin['userCanEditSettings'], True)
        self.assertIs(member['scenarioPlannerForEveryone'], False)
        self.assertIs(member['userCanEditSettings'], False)

    def test_locked_member_is_refused_on_every_scenario_route_before_any_jira_work(self):
        member = self.member
        responses = [
            member.post('/api/scenario', json={'filters': {'sprint': '11'}}, headers=self.headers(member)),
            member.get('/api/scenario'),
            member.get('/api/scenario/overrides?scope_key=k1'),
            member.get('/api/scenario/drafts?scope_key=k1'),
            member.post('/api/scenario/drafts', json={'scope_key': 'k1', 'overrides': {}}, headers=self.headers(member)),
            member.get('/api/scenario/drafts/any/versions/1'),
            member.post('/api/scenario/drafts/any/reload-from-jira', json={'baseDraftRevision': 1},
                        headers=self.headers(member)),
        ]
        for response in responses:
            self.assertEqual(error_of(response), LOCKED, response.request.path)
        self.assertEqual(self.queries, [])

    def test_admins_are_never_locked(self):
        self.assertEqual(self.run_scenario(self.client).status_code, 200)
        self.assertEqual(self.client.get('/api/scenario/drafts?scope_key=k1').status_code, 200)

    def test_unlocking_opens_scenario_for_members_and_relocking_closes_it(self):
        response = self.set_switch(self.client, True)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['enabledForEveryone'], True)
        self.assertIs(self.member.get('/api/config').get_json()['scenarioPlannerForEveryone'], True)
        self.assertEqual(self.run_scenario(self.member).status_code, 200)
        self.assertEqual(self.set_switch(self.client, False).status_code, 200)
        self.assertEqual(error_of(self.run_scenario(self.member)), LOCKED)

    def test_switch_is_its_own_admin_owned_workspace_section(self):
        before, revision = self.row()
        response = self.set_switch(self.client, True)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        after, next_revision = self.row()
        self.assertEqual(next_revision, revision + 1)
        self.assertEqual(response.get_json()['configRevision'], next_revision)
        self.assertEqual(after['scenarioPlanner'], {'enabledForEveryone': True})
        self.assertEqual({key: value for key, value in after.items() if key != 'scenarioPlanner'}, before)
        self.assertEqual(self.client.get('/api/scenario-access/config').get_json()['enabledForEveryone'], True)

    def test_members_cannot_write_the_switch(self):
        response = self.set_switch(self.member, True)
        self.assertEqual(error_of(response), (403, 'admin_required'))
        self.assertNotIn('scenarioPlanner', self.row()[0])

    def test_stale_and_malformed_writes_are_refused(self):
        _payload, revision = self.row()
        self.assertEqual(error_of(self.set_switch(self.client, True, base=revision - 1)), (409, 'workspace_config_conflict'))
        self.assertEqual(self.set_switch(self.client, 'yes').status_code, 400)
        extra = self.client.post('/api/scenario-access/config',
                                 json={'enabledForEveryone': True, 'baseRevision': revision, 'teams': []},
                                 headers=self.headers())
        self.assertEqual(extra.status_code, 400)
        self.assertNotIn('scenarioPlanner', self.row()[0])

    def test_open_settings_workspace_treats_everyone_as_admin(self):
        with patch.object(jira_server, 'SETTINGS_ADMIN_ONLY', False):
            self.assertEqual(self.run_scenario(self.member).status_code, 200)
            self.assertIs(self.member.get('/api/config').get_json()['userCanEditSettings'], True)

    def test_unauthenticated_requests_still_answer_401(self):
        anonymous = jira_server.app.test_client()
        for path in ('/api/scenario', '/api/scenario/drafts?scope_key=k1', '/api/scenario-access/config'):
            self.assertEqual(anonymous.get(path).status_code, 401, path)

    def test_private_views_cannot_carry_the_switch(self):
        from backend.config.shared_config import PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS
        self.assertIn('scenarioPlanner', PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS)


if __name__ == '__main__':
    unittest.main()
