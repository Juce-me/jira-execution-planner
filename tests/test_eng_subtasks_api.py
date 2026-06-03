import os
import time
import unittest
from unittest.mock import patch

from backend.services.eng_subtasks import (
    SUBTASK_FIELDS,
    SubtasksFetchError,
    build_subtask_summary,
    build_subtasks_jql,
    fetch_subtask_issues_by_jql,
)
import jira_server
from tests.oauth_test_helpers import install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


def _subtask_issue(key="PROD-2", status_name="In Progress"):
    return {
        "id": key.replace("-", ""),
        "key": key,
        "fields": {
            "summary": "Synthetic subtask",
            "status": {"name": status_name},
            "assignee": {"displayName": "Synthetic Owner"},
            "updated": "2026-05-01T00:00:00.000+0000",
        },
    }


def _story_issue_with_embedded_subtasks():
    return {
        "id": "10001",
        "key": "PROD-1",
        "fields": {
            "summary": "Synthetic task",
            "status": {"name": "To Do"},
            "priority": {"name": "Major"},
            "issuetype": {"name": "Story"},
            "assignee": {"displayName": "Synthetic Owner"},
            "updated": "2026-05-01T00:00:00.000+0000",
            "customfield_sp": 3,
            "customfield_sprint": [{"id": 42, "name": "Sprint 42"}],
            "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
            "parent": {},
            "project": {"key": "PROD", "name": "Product"},
            "subtasks": [
                {"fields": {"status": {"name": "Done"}}},
                {"fields": {"status": {"name": "Analysis"}}},
                {"fields": {"status": {"name": "Release"}}},
            ],
        },
    }


class EngSubtasksHelperTests(unittest.TestCase):
    def test_build_subtasks_jql_filters_parent_and_selected_sprint(self):
        self.assertEqual(
            build_subtasks_jql("PROD-123", "42"),
            'parent = "PROD-123" AND Sprint = 42 ORDER BY updated DESC',
        )

    def test_build_subtasks_jql_rejects_non_numeric_sprint(self):
        with self.assertRaisesRegex(ValueError, "invalid_sprint"):
            build_subtasks_jql("PROD-123", "2026Q2")

    def test_build_subtask_summary_counts_done_in_progress_and_waiting(self):
        summary = build_subtask_summary([
            {"status": {"name": "Done"}},
            {"status": {"name": "In Progress"}},
            {"status": {"name": "Analysis"}},
            {"status": {"name": "Release"}},
            {"status": {"name": "Waiting for Release"}},
            {"status": {"name": "To Do"}},
            {"status": {"name": "Killed"}},
        ])

        self.assertEqual(summary["total"], 6)
        self.assertEqual(summary["done"], 1)
        self.assertEqual(summary["inProgress"], 4)
        self.assertEqual(summary["waiting"], 1)
        self.assertEqual(summary["percentComplete"], 16.7)

    def test_fetch_subtask_issues_by_jql_raises_on_jira_failure(self):
        def fake_search(_payload, context=None):
            return FakeResponse(500, {"errorMessages": ["Synthetic Jira failure"]})

        with self.assertRaises(SubtasksFetchError) as raised:
            fetch_subtask_issues_by_jql(
                'parent = "PROD-123" AND Sprint = 42 ORDER BY updated DESC',
                SUBTASK_FIELDS,
                search_request=fake_search,
            )

        self.assertEqual(raised.exception.status_code, 500)


class EngSubtasksRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._env_patcher = patch.dict(os.environ, {
            "CONFIG_STORAGE_BACKEND": "jsonfile",
            "DATABASE_URL": "",
            "TEST_DATABASE_URL": "",
        }, clear=False)
        self._env_patcher.start()
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        try:
            from backend.routes import eng_routes
            if hasattr(eng_routes, "SUBTASKS_CACHE"):
                eng_routes.SUBTASKS_CACHE.clear()
        except Exception:
            pass
        self._env_patcher.stop()

    def _install_oauth_session(self):
        install_oauth_session(self.client, stored_at=time.time())

    def test_story_subtasks_route_rejects_missing_parent_key(self):
        self._install_oauth_session()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/issues/subtasks?sprint=42")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "missing_parent_key")

    def test_story_subtasks_route_rejects_missing_sprint(self):
        self._install_oauth_session()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/issues/subtasks?parentKey=PROD-1")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "missing_sprint")

    def test_story_subtasks_route_rejects_non_numeric_sprint(self):
        self._install_oauth_session()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=2026Q2")

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_sprint")

    def test_story_subtasks_route_fetches_selected_sprint_subtasks(self):
        self._install_oauth_session()
        calls = []

        def fake_search(payload, context=None):
            calls.append(payload)
            return FakeResponse(200, {
                "issues": [_subtask_issue()],
                "isLast": True,
            })

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search):
            response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(calls[0]["jql"], 'parent = "PROD-1" AND Sprint = 42 ORDER BY updated DESC')
        self.assertEqual(calls[0]["fields"], SUBTASK_FIELDS)
        self.assertNotIn("startAt", calls[0])
        self.assertEqual(body["parentKey"], "PROD-1")
        self.assertEqual(body["sprint"], "42")
        self.assertFalse(body["cached"])
        self.assertEqual(body["summary"]["inProgress"], 1)
        self.assertEqual(body["subtasks"][0]["assignee"]["displayName"], "Synthetic Owner")
        self.assertEqual(response.headers.get("X-Cache"), "MISS")
        self.assertIn("jira-search;dur=", response.headers.get("Server-Timing", ""))
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(response.headers.get("Pragma"), "no-cache")
        self.assertEqual(response.headers.get("Expires"), "0")

    def test_story_subtasks_route_follows_next_page_token_pagination(self):
        self._install_oauth_session()
        calls = []

        def fake_search(payload, context=None):
            calls.append(payload)
            if len(calls) == 1:
                return FakeResponse(200, {
                    "issues": [_subtask_issue("PROD-2", "Done")],
                    "nextPageToken": "next-page",
                    "isLast": False,
                })
            return FakeResponse(200, {
                "issues": [_subtask_issue("PROD-3", "To Do")],
                "isLast": True,
            })

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search):
            response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(len(calls), 2)
        self.assertNotIn("startAt", calls[0])
        self.assertEqual(calls[1]["nextPageToken"], "next-page")
        self.assertEqual(response.get_json()["summary"]["total"], 2)

    def test_story_subtasks_route_uses_auth_partitioned_cache(self):
        self._install_oauth_session()
        calls = []

        def fake_search(payload, context=None):
            calls.append(payload)
            return FakeResponse(200, {
                "issues": [_subtask_issue()],
                "isLast": True,
            })

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search):
            first = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")
            second = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        self.assertEqual(len(calls), 1)
        self.assertEqual(first.headers.get("X-Cache"), "MISS")
        self.assertEqual(second.headers.get("X-Cache"), "HIT")
        self.assertFalse(first.get_json()["cached"])
        self.assertTrue(second.get_json()["cached"])

    def test_story_subtasks_route_refresh_bypasses_cache(self):
        self._install_oauth_session()
        calls = []

        def fake_search(payload, context=None):
            calls.append(payload)
            return FakeResponse(200, {
                "issues": [_subtask_issue()],
                "isLast": True,
            })

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search):
            first = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")
            second = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42&refresh=true")

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        self.assertEqual(len(calls), 2)
        self.assertEqual(second.headers.get("X-Cache"), "MISS")
        self.assertFalse(second.get_json()["cached"])

    def test_story_subtasks_route_returns_sanitized_502_for_jira_failure(self):
        self._install_oauth_session()

        def fake_search(payload, context=None):
            return FakeResponse(500, {"errorMessages": ["Synthetic Jira failure with raw details"]})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search):
            response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "subtasks_fetch_failed")
        self.assertEqual(body["message"], "Failed to fetch subtasks from Jira.")
        self.assertNotIn("Synthetic Jira failure", response.get_data(as_text=True))

    def test_story_subtasks_route_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/issues/subtasks?parentKey=PROD-1&sprint=42")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")


class EngSubtasksTaskPayloadTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self._env_patcher = patch.dict(os.environ, {
            "CONFIG_STORAGE_BACKEND": "jsonfile",
            "DATABASE_URL": "",
            "TEST_DATABASE_URL": "",
        }, clear=False)
        self._env_patcher.start()
        self.client = jira_server.app.test_client()
        install_oauth_session(self.client, stored_at=time.time())

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        jira_server.TASKS_CACHE.clear()
        self._env_patcher.stop()

    def test_tasks_with_team_name_includes_embedded_subtask_summary_without_extra_fetch(self):
        issue = _story_issue_with_embedded_subtasks()
        calls = []

        def fake_search(payload, *args, **kwargs):
            calls.append(payload)
            return FakeResponse(200, {
                "issues": [issue],
                "names": {"customfield_team": "Team[Team]"},
                "isLast": True,
            })

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search), \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = self.client.get("/api/tasks-with-team-name?sprint=42&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(len(calls), 1)
        self.assertIn("subtasks", calls[0]["fields"])
        self.assertEqual(response.get_json()["issues"][0]["fields"]["subtaskSummary"], {
            "total": 3,
            "done": 1,
            "inProgress": 2,
            "waiting": 0,
            "percentComplete": 33.3,
            "statusCounts": {"Done": 1, "Analysis": 1, "Release": 1},
        })


if __name__ == "__main__":
    unittest.main()
