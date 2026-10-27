import json
import re
import threading
import time
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.routes import eng_routes
from backend.services import eng_board, jira_batches
from backend.services.eng_board_stream import (
    EngBoardRequestBudget,
    EngBoardRequestDeadline,
    EngBoardRequestTransport,
)
from backend.services.jira_batches import JIRA_BATCH_CONCURRENCY, JIRA_BATCH_GLOBAL_SLOTS
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
                {"id": "team-a", "name": "Alpha", "labels": ["team_alpha"]},
                {"id": "team-b", "name": "Beta", "labels": ["team_beta"]},
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


class _ReadinessJira:
    """Synthetic Jira for `_story_readiness_compute` that records call times and the peak in flight.

    One board sprint page, discovery in pages of at most 100 Epics, the field list, then child
    and enrichment batches (two Stories per Epic). `respond(kind, payload)` may raise, block or
    return a response to replace the synthetic one; it runs while the call counts as in flight.
    """

    SPRINT = ('42', 'Sprint 42', 'active')

    def __init__(self, epics=160, latency=0.0, respond=None):
        self.epic_keys = sorted(f'PROD-{n}' for n in range(1, epics + 1))
        self.latency = latency
        self.respond = respond
        self.lock = threading.Lock()
        self.calls = []
        self.in_flight = 0
        self.peak = 0
        self.group = {'id': 'dept', 'revision': 1, 'teams': [
            {'id': 'team-a', 'name': 'Alpha', 'labels': ['team_alpha']},
            {'id': 'team-b', 'name': 'Beta', 'labels': ['team_beta']},
        ]}
        self.projects = [{'key': 'PROD', 'type': 'product'}]
        self.config = {'board': {'boardId': '7'}, 'sprintField': {'fieldId': 'customfield_sprint'},
                       'teamField': {'fieldId': 'customfield_team'},
                       'projectTrackField': {'fieldId': 'customfield_track'}}

    def _call(self, kind, payload, build):
        started = time.perf_counter()
        with self.lock:
            self.in_flight += 1
            self.peak = max(self.peak, self.in_flight)
        try:
            if self.latency:
                time.sleep(self.latency)
            response = self.respond(kind, payload) if self.respond else None
            return response if response is not None else build()
        finally:
            with self.lock:
                self.in_flight -= 1
                self.calls.append({'kind': kind, 'payload': payload, 'start': started,
                                   'end': time.perf_counter(), 'thread': threading.current_thread()})

    def calls_of(self, *kinds):
        with self.lock:
            return [call for call in self.calls if call['kind'] in kinds]

    def get(self, path, **_kwargs):
        if path == '/rest/agile/1.0/board/7/sprint':
            return self._call('sprint', {'path': path}, lambda: _FakeResponse(200, {
                'values': [{'id': 42, 'name': 'Sprint 42', 'state': 'active'}], 'isLast': True}))
        if path == '/rest/api/3/field':
            return self._call('field', {'path': path}, lambda: _FakeResponse(
                200, [{'id': 'customfield_epic', 'name': 'Epic Link'}]))
        raise AssertionError(path)

    def search(self, payload, **_kwargs):
        jql = payload['jql']
        batch = list(dict.fromkeys(re.findall(r'"(PROD-\d+)"', jql)))
        if 'issuetype = Epic' in jql:
            token = payload.get('nextPageToken')
            page = self.epic_keys[100:] if token else self.epic_keys[:100]
            body = {'issues': [{'key': key, 'fields': {'project': {'key': 'PROD'}}} for key in page],
                    'isLast': bool(token) or len(self.epic_keys) <= 100}
            if not body['isLast']:
                body['nextPageToken'] = 'page-2'
            return self._call('discovery', payload, lambda: _FakeResponse(200, body))
        if jql.startswith('issuetype = Story'):
            rows = [{'key': f'PROD-{int(epic.split("-")[1]) * 10 + j + 10000}', 'fields': {
                'parent': {'key': epic}, 'status': {'name': 'In Progress'},
                'customfield_sprint': [{'id': 42}], 'customfield_team': {'id': 'team-a'}}}
                for epic in batch for j in range(2)]
            return self._call('child', payload, lambda: _FakeResponse(200, {'issues': rows, 'isLast': True}))
        if jql.startswith('key in'):
            rows = [{'id': epic.split('-')[1], 'key': epic, 'fields': {
                'summary': f'Synthetic {epic}', 'status': {'name': 'In Progress'}, 'priority': {'name': 'High'},
                'assignee': None, 'labels': ['team_alpha', 'team_beta'], 'components': [{'name': 'Synthetic'}],
                'parent': None, 'project': {'key': 'PROD'}, 'customfield_track': {'value': 'Committed'},
                'customfield_team': {'id': 'team-a'}}} for epic in batch]
            return self._call('enrichment', payload, lambda: _FakeResponse(200, {'issues': rows, 'isLast': True}))
        raise AssertionError(jql)


_READINESS_CONTEXT = RequestAuthContext(
    auth_mode='basic', user_id='local', stable_subject='local',
    workspace_id='workspace', auth_connection_id='local-basic-connection',
    atlassian_account_id='', cloud_id='', site_url='https://example.invalid', token_version='1',
    account_status='active', is_admin=True,
)


def run_readiness_compute(jira, *, cap=None, transport=None):
    """Call `_story_readiness_compute` against `jira`; `cap` patches the batch concurrency.

    Returns `(result, timing, wall_ms)`. Also the G2b measurement harness (Task 2 step 1).
    """
    eng_routes.bind_server_globals(vars(eng_routes))
    transport = transport or EngBoardRequestTransport(budget=EngBoardRequestBudget.start(25))
    with ExitStack() as stack:
        stack.enter_context(patch.object(eng_routes, 'current_jira_get', jira.get))
        stack.enter_context(patch.object(eng_routes, 'current_jira_search', jira.search))
        if cap is not None:
            stack.enter_context(patch.object(eng_routes, '_STORY_READINESS_BATCH_CONCURRENCY', cap))
        started = time.perf_counter()
        result, timing = eng_routes._story_readiness_compute(
            _READINESS_CONTEXT, jira.SPRINT, jira.group, jira.projects, jira.config, transport,
        )
        return result, timing, (time.perf_counter() - started) * 1000


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


class StoryReadinessAliasProjectionTests(unittest.TestCase):
    def _alias_input(self, epic_labels, team_a_labels=("label_team_a", "label_team_a_old")):
        base = _complete_input()
        group = dict(base["groupSnapshot"], teams=[
            {"id": "team-a", "name": "Alpha", "labels": list(team_a_labels)},
            {"id": "team-b", "name": "Beta", "labels": ["label_team_b"]},
        ])
        epic = dict(base["epics"][0], labels=list(epic_labels))
        return _complete_input(groupSnapshot=group, epics=[epic])

    def test_either_alias_matches_the_team(self):
        for epic_labels in (["label_team_a"], ["label_team_a_old"]):
            with self.subTest(epic_labels=epic_labels):
                result = project_story_readiness(self._alias_input(epic_labels))
                self.assertEqual(result["epics"][0]["missingTeams"], [
                    {"id": "team-a", "name": "Alpha", "reason": "no_stories"},
                ])

    def test_both_aliases_of_one_team_yield_one_team_result(self):
        result = project_story_readiness(self._alias_input(["label_team_a", "label_team_a_old", "label_team_b"]))
        self.assertEqual([team["id"] for team in result["epics"][0]["missingTeams"]], ["team-a", "team-b"])
        self.assertNotIn("labels", result["epics"][0])

    def test_neither_alias_matches_exactly_and_yields_no_result(self):
        result = project_story_readiness(self._alias_input(["LABEL_TEAM_A", "label_team_c"]))
        self.assertEqual(result["epics"], [])

    def test_alias_shared_by_two_teams_fails_closed(self):
        with self.assertRaises(InvalidCompleteReadinessInput):
            project_story_readiness(self._alias_input(["label_team_a"], ("label_team_a", "label_team_b")))

    def test_team_without_label_array_is_rejected(self):
        base = _complete_input()
        for team in ({"id": "team-a", "name": "Alpha", "label": "label_team_a"},
                     {"id": "team-a", "name": "Alpha", "labels": []},
                     {"id": "team-a", "name": "Alpha", "labels": "label_team_a"},
                     {"id": "team-a", "name": "Alpha", "labels": ["label_team_a", " "]}):
            with self.subTest(team=team):
                group = dict(base["groupSnapshot"], teams=[team])
                with self.assertRaises(InvalidCompleteReadinessInput):
                    project_story_readiness(_complete_input(groupSnapshot=group))


class StoryReadinessAliasSnapshotTests(unittest.TestCase):
    def _groups(self, team_labels):
        return {"configRevision": 4, "groups": [{
            "id": "dept", "teamIds": ["team-a", "team-b"], "teamLabels": team_labels,
        }]}

    def test_group_snapshot_carries_alias_arrays_and_accepts_legacy_scalars(self):
        catalog = {"team-a": {"name": "Alpha"}, "team-b": {"name": "Beta"}}
        snapshot = eng_routes._story_readiness_group_snapshot(self._groups({
            "team-a": ["label_team_a", "label_team_a_old"], "team-b": "label_team_b",
        }), "dept", catalog)
        self.assertEqual(snapshot["teams"], [
            {"id": "team-a", "name": "Alpha", "labels": ["label_team_a", "label_team_a_old"]},
            {"id": "team-b", "name": "Beta", "labels": ["label_team_b"]},
        ])
        self.assertNotEqual(
            eng_routes._story_readiness_digest(snapshot),
            eng_routes._story_readiness_digest(eng_routes._story_readiness_group_snapshot(
                self._groups({"team-a": ["label_team_a"], "team-b": ["label_team_b"]}), "dept", catalog)),
        )

    def test_group_snapshot_requires_a_label_for_every_team(self):
        with self.assertRaises(eng_routes._StoryReadinessConfigurationError):
            eng_routes._story_readiness_group_snapshot(
                self._groups({"team-a": ["label_team_a"], "team-b": []}), "dept", {})


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

    def test_route_rejects_alias_shared_by_two_teams(self):
        context = RequestAuthContext(
            auth_mode="basic", user_id="local", stable_subject="local",
            workspace_id="workspace", auth_connection_id="local-basic-connection",
            atlassian_account_id="", cloud_id="", site_url="https://example.invalid", token_version="1",
            account_status="active", is_admin=True,
        )
        groups = {"configRevision": 3, "groups": [{
            "id": "dept", "teamIds": ["team-a", "team-b"],
            "teamLabels": {"team-a": ["label_team_a", "label_shared"], "team-b": ["label_shared"]},
        }]}
        config = {"projects": {"selected": [{"key": "PROJ", "type": "product"}]}}
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "load_dashboard_config_snapshot", return_value=SimpleNamespace(
                 payload=config, config_revision=5)), \
             patch.object(eng_routes, "_story_readiness_effective_groups", return_value=groups), \
             patch.object(eng_routes, "_story_readiness_team_catalog", return_value={}), \
             patch.object(eng_routes, "_story_readiness_compute") as compute:
            response = self.client.get(
                "/api/eng/story-readiness?sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept"
            )
        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "story_readiness_configuration_invalid")
        self.assertNotIn("label_shared", response.get_data(as_text=True))
        compute.assert_not_called()

    def test_discovery_jql_contains_every_alias_escaped_and_terminal_exclusions(self):
        eng_routes.bind_server_globals(vars(eng_routes))
        group = {'id': 'dept', 'revision': 1, 'teams': [
            {'id': 'team-a', 'name': 'Alpha', 'labels': ['label_team_a', 'label "team" a']},
            {'id': 'team-b', 'name': 'Beta', 'labels': ['label_team_b']},
        ]}
        config = {'sprintField': {'fieldId': 'customfield_sprint'},
                  'teamField': {'fieldId': 'customfield_team'}}
        search_calls = []

        def jira_get(path, **_kwargs):
            if path.startswith('/rest/agile/1.0/sprint/'):
                return _FakeResponse(200, {'id': 42, 'name': 'Sprint 42', 'state': 'active'})
            raise AssertionError(path)

        def jira_search(payload, **_kwargs):
            search_calls.append(payload)
            return _FakeResponse(200, {'issues': [], 'isLast': True})

        transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(25))
        with patch.object(eng_routes, 'current_jira_get', side_effect=jira_get), \
             patch.object(eng_routes, 'current_jira_search', side_effect=jira_search):
            result, _timing = eng_routes._story_readiness_compute(
                SimpleNamespace(auth_mode='basic'), ('42', 'Sprint 42', 'active'), group,
                [{'key': 'PROJ', 'type': 'product'}], config, transport,
            )

        self.assertEqual(result['epics'], [])
        self.assertEqual(len(search_calls), 1)
        discovery_jql = search_calls[0]['jql']
        self.assertIn('status not in (Done, Killed, Incomplete, Postponed)', discovery_jql)
        self.assertIn(
            'AND labels in ("label_team_a", "label \\"team\\" a", "label_team_b") ORDER BY key ASC',
            discovery_jql,
        )

    _SCOPE = "sprint=42&sprintName=Sprint%2042&sprintState=active&groupId=dept"

    def _route_stack(self, compute):
        context = RequestAuthContext(
            auth_mode="basic", user_id="local", stable_subject="local",
            workspace_id="workspace", auth_connection_id="local-basic-connection",
            atlassian_account_id="", cloud_id="", site_url="https://example.invalid", token_version="1",
            account_status="active", is_admin=True,
        )
        groups = {"configRevision": 3, "groups": [{
            "id": "dept", "teamIds": ["team-a"], "teamLabels": {"team-a": "team_alpha"}}]}
        config = {"projects": {"selected": [{"key": "PROD", "type": "product"}]}}
        stack = ExitStack()
        stack.enter_context(patch.object(jira_server, "JIRA_AUTH_MODE", "basic"))
        stack.enter_context(patch.object(jira_server, "current_request_auth_context", return_value=context))
        stack.enter_context(patch.object(jira_server, "load_dashboard_config_snapshot", return_value=SimpleNamespace(
            payload=config, config_revision=5)))
        stack.enter_context(patch.object(eng_routes, "_story_readiness_effective_groups", return_value=groups))
        stack.enter_context(patch.object(eng_routes, "_story_readiness_team_catalog", return_value={
            "team-a": {"id": "team-a", "name": "Alpha"}}))
        stack.enter_context(patch.object(jira_server, "get_jira_issue_cache_generation", return_value=9))
        stack.enter_context(patch.object(eng_routes, "_story_readiness_compute", side_effect=compute))
        return stack

    @staticmethod
    def _payload(epics):
        return {
            "schemaVersion": 1,
            "scope": {"groupId": "dept", "groupRevision": 3, "sprintId": "42",
                      "sprintName": "Sprint 42", "sprintState": "active"},
            "complete": True,
            "epics": epics,
        }

    def test_epic_keys_route_is_served_skips_the_snapshot_cache_and_keeps_its_own_inflight_key(self):
        seen = []

        def compute(_context, requested, _group, _projects, _config, _transport, *extra):
            with eng_routes._STORY_READINESS_LOCK:
                inflight = set(eng_routes._STORY_READINESS_INFLIGHT)
            seen.append({"requested": requested, "extra": extra, "inflight": inflight})
            keys = extra[0] if extra else ()
            return self._payload([{"key": key} for key in keys] or [{"key": "PROD-1"}, {"key": "PROD-2"}]), "total;dur=1.0"

        with self._route_stack(compute):
            first = self.client.get(f"/api/eng/story-readiness?{self._SCOPE}&epicKeys=PROD-5")
            with eng_routes._STORY_READINESS_LOCK:
                cached_after_epic = len(eng_routes._STORY_READINESS_CACHE)
            second = self.client.get(f"/api/eng/story-readiness?{self._SCOPE}&epicKeys=PROD-5")
            department = self.client.get(f"/api/eng/story-readiness?{self._SCOPE}")
            with eng_routes._STORY_READINESS_LOCK:
                cached_after_department = len(eng_routes._STORY_READINESS_CACHE)

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(first.get_json()["epics"], [{"key": "PROD-5"}])
        self.assertEqual(cached_after_epic, 0, "a per-epic result must never enter the snapshot LRU")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.headers["X-Story-Readiness-Cache"], "miss")
        self.assertEqual(len(seen), 3, "the per-epic call neither reads nor writes the cache")
        self.assertEqual(department.get_json()["epics"], [{"key": "PROD-1"}, {"key": "PROD-2"}])
        self.assertEqual(cached_after_department, 1)
        self.assertEqual(seen[0]["requested"], ("42", "Sprint 42", "active"))
        self.assertEqual(seen[0]["extra"], (("PROD-5",),))
        self.assertEqual(seen[2]["extra"], ((),))
        self.assertEqual(len(seen[0]["inflight"]), 1)
        self.assertEqual(len(seen[2]["inflight"]), 1)
        self.assertNotEqual(seen[0]["inflight"], seen[2]["inflight"])

    def test_department_call_after_an_epic_call_is_not_served_the_epic_payload(self):
        def compute(_context, _requested, _group, _projects, _config, _transport, *extra):
            keys = extra[0] if extra else ()
            return self._payload([{"key": key} for key in keys] or [{"key": "PROD-1"}]), "total;dur=1.0"

        with self._route_stack(compute):
            self.client.get(f"/api/eng/story-readiness?{self._SCOPE}&epicKeys=PROD-5")
            department = self.client.get(f"/api/eng/story-readiness?{self._SCOPE}")

        self.assertEqual(department.headers["X-Story-Readiness-Cache"], "miss")
        self.assertEqual(department.get_json()["epics"], [{"key": "PROD-1"}])

    def test_epic_keys_bad_or_multiple_value_is_rejected_before_auth_or_jira(self):
        for value in ("not-a-key", "PROD-1,PROD-2", "PROD-1)%20OR%20(x"):
            with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
                 patch.object(jira_server, "current_request_auth_context") as auth, \
                 patch.object(eng_routes, "_story_readiness_compute") as compute:
                response = self.client.get(f"/api/eng/story-readiness?{self._SCOPE}&epicKeys={value}")
            self.assertEqual(response.status_code, 400, value)
            self.assertEqual(response.get_json()["error"], "invalid_story_readiness_scope")
            auth.assert_not_called()
            compute.assert_not_called()

    def test_cache_key_gains_epic_keys_only_when_present(self):
        context = SimpleNamespace(auth_mode="basic")
        args = (context, ("42", "Sprint 42", "active"), {"id": "dept"}, [{"key": "PROD", "type": "product"}],
                SimpleNamespace(config_revision=1), {}, {}, 1)
        with patch.object(eng_routes, "project_access_status", return_value="accessible"), \
             patch.object(eng_routes, "build_jira_home_process_cache_key", return_value="auth"):
            plain = eng_routes._story_readiness_cache_key(*args)
            empty = eng_routes._story_readiness_cache_key(*args, ())
            scoped = eng_routes._story_readiness_cache_key(*args, ("PROD-5",))
            other = eng_routes._story_readiness_cache_key(*args, ("PROD-6",))
        self.assertEqual(plain, empty)
        self.assertEqual(len({plain, scoped, other}), 3)

    def test_discovery_jql_splices_key_clause_before_order_by_only_when_keys_present(self):
        eng_routes.bind_server_globals(vars(eng_routes))
        group = {'id': 'dept', 'revision': 1, 'teams': [{'id': 'team-a', 'name': 'Alpha', 'labels': ['label_a']}]}
        config = {'sprintField': {'fieldId': 'customfield_sprint'},
                  'teamField': {'fieldId': 'customfield_team'}}
        search_calls = []

        def jira_get(path, **_kwargs):
            if path.startswith('/rest/agile/1.0/sprint/'):
                return _FakeResponse(200, {'id': 42, 'name': 'Sprint 42', 'state': 'active'})
            raise AssertionError(path)

        def jira_search(payload, **_kwargs):
            search_calls.append(payload['jql'])
            return _FakeResponse(200, {'issues': [], 'isLast': True})

        for extra in ((), (('PROD-5',),)):
            transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(25))
            with patch.object(eng_routes, 'current_jira_get', side_effect=jira_get), \
                 patch.object(eng_routes, 'current_jira_search', side_effect=jira_search):
                eng_routes._story_readiness_compute(
                    SimpleNamespace(auth_mode='basic'), ('42', 'Sprint 42', 'active'), group,
                    [{'key': 'PROD', 'type': 'product'}], config, transport, *extra,
                )

        self.assertTrue(search_calls[0].endswith('AND labels in ("label_a") ORDER BY key ASC'))
        self.assertNotIn('key in', search_calls[0])
        self.assertTrue(
            search_calls[1].endswith('AND labels in ("label_a") AND key in ("PROD-5") ORDER BY key ASC'),
            search_calls[1],
        )

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

    def test_strict_producer_paginates_candidate_epics_for_active_and_future_sprints(self):
        eng_routes.bind_server_globals(vars(eng_routes))
        context = SimpleNamespace(auth_mode='basic')
        group = {
            'id': 'dept', 'revision': 1,
            'teams': [
                {'id': 'team-a', 'name': 'Alpha', 'labels': ['team_alpha']},
                {'id': 'team-b', 'name': 'Beta', 'labels': ['team_beta']},
            ],
        }
        config = {
            'sprintField': {'fieldId': 'customfield_sprint'},
            'teamField': {'fieldId': 'customfield_team'},
            'projectTrackField': {'fieldId': 'customfield_track'},
        }
        search_calls = []
        sprint_state = 'active'

        def jira_get(path, **_kwargs):
            if path.startswith('/rest/agile/1.0/sprint/'):
                return _FakeResponse(200, {'id': 42, 'name': 'Sprint 42', 'state': sprint_state})
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
                        'components': [{'name': 'Synthetic Component'}],
                        'labels': ['team_alpha', 'team_beta', 'Sprint 42_Candidate'], 'parent': None,
                        'project': {'key': 'PROD'}, 'customfield_track': {'value': 'Committed'},
                    },
                }], 'isLast': True})
            raise AssertionError(jql)

        for sprint_state in ('active', 'future'):
            with self.subTest(sprint_state=sprint_state):
                search_calls.clear()
                transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(25))
                with patch.object(eng_routes, 'current_jira_get', side_effect=jira_get), \
                     patch.object(eng_routes, 'current_jira_search', side_effect=jira_search):
                    result, timing = eng_routes._story_readiness_compute(
                        context, ('42', 'Sprint 42', sprint_state), group,
                        [{'key': 'PROD', 'type': 'product'}], config, transport,
                    )

                discovery_jql = search_calls[0]['jql']
                self.assertIn('project in ("PROD") AND issuetype = Epic', discovery_jql)
                self.assertIn(
                    'AND (customfield_sprint = 42 OR labels in '
                    '("Sprint 42", "Sprint 42_candidate")) '
                    'AND labels in ("team_alpha", "team_beta")', discovery_jql,
                )
                self.assertEqual(result['scope']['sprintState'], sprint_state)
                self.assertEqual(result['epics'][0]['missingTeams'], [
                    {'id': 'team-b', 'name': 'Beta', 'reason': 'team_uncovered'},
                ])
                self.assertEqual(result['epics'][0]['projectTrack'], 'Committed')
                self.assertEqual(result['epics'][0]['components'], ['Synthetic Component'])
                # Child and enrichment batches run concurrently, so their order is not fixed:
                # exactly one search (the enrichment one) asks for components, four in total.
                enrichment_calls = [call for call in search_calls if call['jql'].startswith('key in')]
                self.assertEqual(len(enrichment_calls), 1)
                self.assertEqual([call for call in search_calls if 'components' in call['fields']],
                                 enrichment_calls)
                self.assertEqual(len(search_calls), 4)
                self.assertIn('discovery;dur=', timing)


class StoryReadinessConcurrentBatchTests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        # No database: the compute takes explicit config, and a stray lookup fails loudly.
        stack.enter_context(patch.dict('os.environ', {
            'CONFIG_STORAGE_BACKEND': 'jsonfile', 'DATABASE_URL': '', 'TEST_DATABASE_URL': ''}, clear=False))
        self.admission = jira_batches._ProcessAdmission()
        stack.enter_context(patch.object(jira_batches, '_ADMISSION', self.admission))

    @staticmethod
    def _payloads(jira):
        return sorted(json.dumps(call['payload'], sort_keys=True) for call in jira.calls)

    @staticmethod
    def _batch_index(jira, payload):
        """Index of a child or enrichment batch: batches hold 40 consecutive sorted Epic keys."""
        first = re.search(r'"(PROD-\d+)"', payload['jql']).group(1)
        return jira.epic_keys.index(first) // 40

    def _slots_all_free(self):
        acquired = [self.admission.slots.acquire(blocking=False) for _ in range(JIRA_BATCH_GLOBAL_SLOTS)]
        for ok in acquired:
            if ok:
                self.admission.slots.release()
        return all(acquired)

    def test_compute_runs_child_and_enrichment_batches_with_a_cap_of_four(self):
        # The four child batches must be in flight together (a serial run breaks the barrier).
        first_wave = threading.Barrier(JIRA_BATCH_CONCURRENCY, timeout=5)

        def respond(kind, _payload):
            if kind == 'child':
                first_wave.wait()
            return None

        jira = _ReadinessJira(latency=0.03, respond=respond)
        result, timing, _wall = run_readiness_compute(jira)
        self.assertEqual(jira.peak, 4)

        serial_jira = _ReadinessJira(latency=0.03)
        serial, _serial_timing, _wall = run_readiness_compute(serial_jira, cap=1)

        self.assertEqual(eng_routes._STORY_READINESS_BATCH_CONCURRENCY, JIRA_BATCH_CONCURRENCY)
        self.assertEqual(result, serial)
        self.assertEqual(len(result['epics']), 160)
        self.assertEqual(self._payloads(jira), self._payloads(serial_jira))
        self.assertEqual({call['payload'].get('jql') for call in jira.calls},
                         {call['payload'].get('jql') for call in serial_jira.calls})
        self.assertEqual(len(jira.calls_of('child')), 4)
        self.assertEqual(len(jira.calls_of('enrichment')), 4)
        # Sprint validation, discovery and the field list stay serial and first, on the compute thread.
        ordered = sorted(jira.calls, key=lambda call: call['start'])
        self.assertEqual([call['kind'] for call in ordered[:4]], ['sprint', 'discovery', 'discovery', 'field'])
        self.assertTrue(all(call['thread'] is threading.current_thread() for call in ordered[:4]))
        self.assertTrue(all(call['thread'] is not threading.current_thread() for call in ordered[4:]))
        # Cap 1 is today's order, inline: every child batch, then every enrichment batch.
        self.assertEqual(serial_jira.peak, 1)
        self.assertEqual([call['kind'] for call in serial_jira.calls],
                         ['sprint', 'discovery', 'discovery', 'field'] + ['child'] * 4 + ['enrichment'] * 4)
        self.assertTrue(all(call['thread'] is threading.current_thread() for call in serial_jira.calls))
        # Server-Timing keeps its four segment names; the batch spans may overlap but fit in the total.
        segments = dict(part.split(';dur=') for part in timing.split(', '))
        self.assertEqual(list(segments), ['discovery', 'child-distribution', 'enrichment', 'total'])
        durations = {name: float(value) for name, value in segments.items()}
        self.assertGreater(durations['child-distribution'], 0)
        self.assertGreater(durations['enrichment'], 0)
        self.assertLessEqual(durations['child-distribution'], durations['total'])
        self.assertLessEqual(durations['enrichment'], durations['total'])
        self.assertTrue(self._slots_all_free())

    def test_compute_raises_the_same_classification_when_any_batch_fails(self):
        def fail_at(kind, index, error, delay=0.0):
            return {(kind, index): (error, delay)}

        missing_key = lambda: _FakeResponse(200, {'issues': [], 'isLast': True})  # noqa: E731
        cases = {
            'child batch 503': (fail_at('child', 1, lambda: _FakeResponse(503, {})), RuntimeError),
            'child batch malformed page': (fail_at('child', 0, lambda: _FakeResponse(200, {'issues': 'x'})),
                                           eng_board.EngBoardError),
            'enrichment batch missing a key': (fail_at('enrichment', 2, missing_key), RuntimeError),
            'enrichment batch auth error': (fail_at('enrichment', 3, AuthError('auth_required')), AuthError),
            # The lower batch fails later than a higher one: the lowest index wins, as in serial order.
            'lower child fails after a higher child': ({
                **fail_at('child', 0, lambda: _FakeResponse(200, {'issues': 'x'}), delay=0.15),
                **fail_at('child', 2, lambda: _FakeResponse(503, {})),
            }, eng_board.EngBoardError),
            # A higher-index auth error does not outrank a lower-index ordinary failure (serial: the child fails first).
            'child 503 after an enrichment auth error': ({
                **fail_at('child', 3, lambda: _FakeResponse(503, {}), delay=0.1),
                **fail_at('enrichment', 0, AuthError('auth_required')),
            }, RuntimeError),
        }
        for name, (failures, expected_type) in cases.items():
            with self.subTest(case=name):
                raised = {}
                for cap in (1, None):
                    jira = _ReadinessJira(latency=0.02)

                    def respond(kind, payload, jira=jira, failures=failures):
                        if kind not in ('child', 'enrichment'):
                            return None
                        error, delay = failures.get((kind, self._batch_index(jira, payload)), (None, 0))
                        if error is None:
                            return None
                        time.sleep(delay)
                        if isinstance(error, Exception):
                            raise error
                        return error()

                    jira.respond = respond
                    with self.assertRaises(Exception) as caught:
                        run_readiness_compute(jira, cap=cap)
                    raised[cap] = caught.exception
                serial, concurrent = raised[1], raised[None]
                self.assertIsInstance(serial, expected_type)
                self.assertIs(type(concurrent), type(serial))
                self.assertEqual(str(concurrent), str(serial))
                self.assertEqual(getattr(concurrent, 'code', None), getattr(serial, 'code', None))
                self.assertTrue(self._slots_all_free())

    def test_compute_deadline_cancel_stops_queued_batches_and_leaves_no_worker(self):
        for stop in ('cancel', 'expiry'):
            for cap in (1, None):
                with self.subTest(stop=stop, cap=cap):
                    release = threading.Event()
                    started = threading.Semaphore(0)

                    def respond(kind, _payload, release=release, started=started):
                        if kind in ('child', 'enrichment'):
                            started.release()
                            release.wait(30)  # longer than the start waits below; set in `finally`
                        return None

                    jira = _ReadinessJira(respond=respond)
                    clock = [0.0]
                    budget = EngBoardRequestBudget.start(25, now_fn=lambda clock=clock: clock[0])
                    transport = EngBoardRequestTransport(budget=budget)
                    before = set(threading.enumerate())
                    outcome = {}

                    def compute(jira=jira, cap=cap, transport=transport, outcome=outcome):
                        try:
                            run_readiness_compute(jira, cap=cap, transport=transport)
                        except Exception as exc:
                            outcome['error'] = exc

                    runner = threading.Thread(target=compute)
                    runner.start()
                    in_flight = cap or JIRA_BATCH_CONCURRENCY
                    try:
                        for _ in range(in_flight):
                            self.assertTrue(started.acquire(timeout=5))
                        self.assertFalse(started.acquire(timeout=0.1), 'no batch beyond the cap starts')
                        if stop == 'cancel':
                            budget.cancel()  # what the route does when its 25 s wait times out
                        else:
                            clock[0] = 26.0
                    finally:
                        release.set()  # never leave a blocked compute (and its patches) behind
                        runner.join(5)
                    self.assertFalse(runner.is_alive())

                    self.assertIsInstance(outcome.get('error'), EngBoardRequestDeadline)
                    self.assertEqual(len(jira.calls_of('child', 'enrichment')), in_flight,
                                     'queued batches never start after the cancel')
                    self.assertEqual(jira.calls_of('enrichment'), [])
                    workers = [thread for thread in threading.enumerate()
                               if thread not in before and thread.name.startswith('jira-batch')]
                    for worker in workers:
                        worker.join(2)
                    self.assertEqual([worker for worker in workers if worker.is_alive()], [])
                    self.assertTrue(self._slots_all_free())


if __name__ == "__main__":
    unittest.main()
