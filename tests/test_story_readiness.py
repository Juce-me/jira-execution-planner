import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.routes import eng_routes
from backend.services.eng_board_stream import EngBoardRequestBudget, EngBoardRequestTransport
from backend.services.story_readiness import (
    InvalidCompleteReadinessInput,
    project_story_readiness,
)
import jira_server


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _complete_input(**overrides):
    payload = {
        "status": "complete",
        "canonicalSprint": {"id": "42", "name": "Sprint 42", "state": "active"},
        "groupSnapshot": {
            "id": "dept",
            "revision": 7,
            "teams": [
                {"id": "team-a", "name": "Alpha", "label": "team_alpha"},
                {"id": "team-b", "name": "Beta", "label": "team_beta"},
            ],
        },
        "projectAccessSnapshot": {"product": "accessible", "tech": "accessible"},
        "epics": [{
            "key": "PROD-1",
            "summary": "Checkout",
            "status": {"name": "In Progress"},
            "priority": {"name": "High"},
            "assignee": None,
            "labels": ["team_alpha", "team_beta"],
            "projectTrack": "Committed",
            "projectKey": "PROD",
            "projectClass": "product",
            "initiative": {"key": "INIT-1", "summary": "Frictionless checkout"},
        }],
        "children": [],
    }
    payload.update(overrides)
    return payload


class StoryReadinessProjectionTests(unittest.TestCase):
    def test_complete_zero_story_epic_emits_one_slot_per_exact_label_team(self):
        result = project_story_readiness(_complete_input())

        self.assertTrue(result["complete"])
        self.assertEqual(result["scope"], {
            "groupId": "dept",
            "groupRevision": 7,
            "sprintId": "42",
            "sprintName": "Sprint 42",
            "sprintState": "active",
        })
        self.assertEqual(result["epics"][0]["missingTeams"], [
            {"id": "team-a", "name": "Alpha", "reason": "no_stories"},
            {"id": "team-b", "name": "Beta", "reason": "no_stories"},
        ])

    def test_partial_coverage_uses_reason_table_and_rejects_raw_team_only(self):
        children = [
            {"key": "STORY-1", "epicKey": "PROD-1", "statusName": "In Progress",
             "sprintIds": ["42"], "teamIds": ["team-a"]},
        ]
        result = project_story_readiness(_complete_input(children=children))

        self.assertEqual(result["epics"][0]["missingTeams"], [
            {"id": "team-b", "name": "Beta", "reason": "team_uncovered"},
        ])

    def test_non_actionable_and_outside_sprint_reasons_are_deterministic(self):
        children = [
            {"key": "STORY-1", "epicKey": "PROD-1", "statusName": "Blocked",
             "sprintIds": ["42"], "teamIds": ["team-a"]},
            {"key": "STORY-2", "epicKey": "PROD-1", "statusName": "In Progress",
             "sprintIds": ["99"], "teamIds": ["team-b"]},
        ]
        result = project_story_readiness(_complete_input(children=children))

        self.assertEqual(result["epics"][0]["missingTeams"], [
            {"id": "team-a", "name": "Alpha", "reason": "selected_stories_not_actionable"},
            {"id": "team-b", "name": "Beta", "reason": "stories_outside_sprint"},
        ])

    def test_terminal_epics_and_covered_epics_are_suppressed(self):
        terminal = dict(_complete_input()["epics"][0], status={"name": "Done"})
        covered = [{"key": "STORY-1", "epicKey": "PROD-1", "statusName": "To Do",
                    "sprintIds": ["42"], "teamIds": ["team-a", "team-b"]}]

        self.assertEqual(project_story_readiness(_complete_input(epics=[terminal]))["epics"], [])
        self.assertEqual(project_story_readiness(_complete_input(children=covered))["epics"], [])

    def test_duplicate_epics_are_canonicalized_and_output_is_key_sorted(self):
        first = _complete_input()["epics"][0]
        second = dict(first, key="PROD-0", summary="Earlier")
        result = project_story_readiness(_complete_input(epics=[first, second, dict(first)]))
        self.assertEqual([epic["key"] for epic in result["epics"]], ["PROD-0", "PROD-1"])

    def test_missing_or_malformed_initiative_degrades_to_null(self):
        epic = dict(_complete_input()["epics"][0], initiative={"key": "INIT-1"})
        result = project_story_readiness(_complete_input(epics=[epic]))
        self.assertIsNone(result["epics"][0]["initiative"])

    def test_partial_or_malformed_input_never_returns_complete(self):
        for payload in ({}, _complete_input(status="partial"), _complete_input(children=None)):
            with self.subTest(payload=payload):
                with self.assertRaises(InvalidCompleteReadinessInput):
                    project_story_readiness(payload)


class StoryReadinessRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        self.client = jira_server.app.test_client()
        with eng_routes._STORY_READINESS_LOCK:
            eng_routes._STORY_READINESS_CACHE.clear()
            eng_routes._STORY_READINESS_INFLIGHT.clear()

    def test_route_returns_complete_snapshot_and_exact_warm_cache_hit(self):
        context = RequestAuthContext(
            auth_mode="basic", user_id="local", stable_subject="local",
            workspace_id="workspace", auth_connection_id="local-basic-connection",
            atlassian_account_id="", cloud_id="", site_url="https://example.invalid", token_version="1",
            account_status="active", is_admin=True,
        )
        groups = {
            "configRevision": 3,
            "groups": [{"id": "dept", "teamIds": ["team-a"],
                        "teamLabels": {"team-a": "team_alpha"}}],
        }
        config = {"projects": {"selected": [{"key": "PROD", "type": "product"}]}}
        payload = {
            "schemaVersion": 1,
            "scope": {"groupId": "dept", "groupRevision": 3, "sprintId": "42",
                      "sprintName": "Sprint 42", "sprintState": "active"},
            "complete": True,
            "epics": [],
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "load_dashboard_config_snapshot", return_value=SimpleNamespace(
                 payload=config, config_revision=5)), \
             patch.object(eng_routes, "_story_readiness_effective_groups", return_value=groups), \
             patch.object(eng_routes, "_story_readiness_team_catalog", return_value={
                 "team-a": {"id": "team-a", "name": "Alpha"}}), \
             patch.object(jira_server, "get_jira_issue_cache_generation", return_value=9), \
             patch.object(eng_routes, "_story_readiness_compute", return_value=(payload, "total;dur=1.0")) as compute:
            first = self.client.get(
                "/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept"
            )
            second = self.client.get(
                "/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept"
            )

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(first.headers["X-Story-Readiness-Cache"], "miss")
        self.assertEqual(second.headers["X-Story-Readiness-Cache"], "hit")
        self.assertEqual(second.get_json(), payload)
        self.assertEqual(compute.call_count, 1)

    def test_route_rejects_malformed_scope_before_auth_or_jira(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "current_request_auth_context") as auth:
            response = self.client.get(
                "/api/eng/story-readiness?sprint=not-an-id&sprintName=Sprint&sprintState=closed&groupId=dept"
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {
            "error": "invalid_story_readiness_scope",
            "message": "Story readiness scope is invalid.",
        })
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        auth.assert_not_called()

    def test_strict_producer_paginates_candidates_and_batches_children(self):
        eng_routes.bind_server_globals(vars(eng_routes))
        context = SimpleNamespace(auth_mode='basic')
        group = {
            'id': 'dept', 'revision': 1,
            'teams': [
                {'id': 'team-a', 'name': 'Alpha', 'label': 'team_alpha'},
                {'id': 'team-b', 'name': 'Beta', 'label': 'team_beta'},
            ],
        }
        config = {
            'sprintField': {'fieldId': 'customfield_sprint'},
            'teamField': {'fieldId': 'customfield_team'},
            'projectTrackField': {'fieldId': 'customfield_track'},
        }
        search_calls = []

        def jira_get(path, **_kwargs):
            if path.startswith('/rest/agile/1.0/sprint/'):
                return _FakeResponse(200, {'id': 42, 'name': 'Sprint 42', 'state': 'active'})
            if path == '/rest/api/3/field':
                return _FakeResponse(200, [{'id': 'customfield_epic', 'name': 'Epic Link'}])
            raise AssertionError(path)

        def jira_search(payload, **_kwargs):
            search_calls.append(payload)
            jql = payload['jql']
            token = payload.get('nextPageToken')
            if 'issuetype = Epic' in jql:
                if token is None:
                    return _FakeResponse(200, {
                        'issues': [{'key': 'PROD-1', 'fields': {'project': {'key': 'PROD'}}}],
                        'isLast': False, 'nextPageToken': 'next',
                    })
                return _FakeResponse(200, {'issues': [], 'isLast': True})
            if 'issuetype = Story' in jql:
                return _FakeResponse(200, {'issues': [{
                    'key': 'PROD-2',
                    'fields': {
                        'parent': {'key': 'PROD-1'},
                        'status': {'name': 'In Progress'},
                        'customfield_sprint': [{'id': 42}],
                        'customfield_team': {'id': 'team-a'},
                    },
                }], 'isLast': True})
            if jql.startswith('key in'):
                return _FakeResponse(200, {'issues': [{
                    'key': 'PROD-1',
                    'fields': {
                        'summary': 'Checkout', 'status': {'name': 'In Progress'},
                        'priority': {'name': 'High'}, 'assignee': None,
                        'labels': ['team_alpha', 'team_beta'], 'parent': None,
                        'project': {'key': 'PROD'}, 'customfield_track': {'value': 'Committed'},
                    },
                }], 'isLast': True})
            raise AssertionError(jql)

        transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(25))
        with patch.object(eng_routes, 'current_jira_get', side_effect=jira_get), \
             patch.object(eng_routes, 'current_jira_search', side_effect=jira_search):
            result, timing = eng_routes._story_readiness_compute(
                context, ('42', 'Sprint 42', 'active'), group,
                [{'key': 'PROD', 'type': 'product'}], config, transport,
            )

        self.assertEqual(result['epics'][0]['missingTeams'], [
            {'id': 'team-b', 'name': 'Beta', 'reason': 'team_uncovered'},
        ])
        self.assertEqual(result['epics'][0]['projectTrack'], 'Committed')
        self.assertEqual(len(search_calls), 4)
        self.assertIn('discovery;dur=', timing)


if __name__ == "__main__":
    unittest.main()
