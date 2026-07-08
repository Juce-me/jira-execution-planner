import base64
import os
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.auth.cache_policy import build_jira_home_process_cache_key
from backend.routes import eng_routes
from backend.services.jira_issue_transitions import IssueTransitionServiceError
import jira_server
from tests.oauth_test_helpers import install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


def _synthetic_issue():
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
            "customfield_sprint": [{"id": 42, "name": "2026Q2"}],
            "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
            "parent": {},
            "project": {"key": "PROD", "name": "Product"},
        },
    }


def _synthetic_epic():
    return {
        "id": "20001",
        "key": "PROD-EPIC",
        "fields": {
            "summary": "Synthetic epic",
            "status": {"name": "To Do"},
            "assignee": {"displayName": "Synthetic Owner"},
            "labels": [],
            "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
            "customfield_sprint": [{"id": 42, "name": "2026Q2"}],
        },
    }


def _local_oauth_context(session_id="session-1", stored_at=0):
    site_url = "https://example.atlassian.net"
    cloud_id = "cloud-123"
    return jira_server.RequestAuthContext(
        auth_mode="atlassian_oauth",
        user_id="local-oauth-user:account-123",
        stable_subject="account-123",
        atlassian_account_id="account-123",
        workspace_id=jira_server.stable_local_workspace_id(jira_server.APP_ENVIRONMENT_KEY, site_url, cloud_id),
        auth_connection_id=f"local-oauth-connection:{session_id}",
        cloud_id=cloud_id,
        site_url=site_url,
        token_version=str(stored_at),
        account_status="active",
        is_admin=False,
    )


class OAuthEngRouteTests(unittest.TestCase):
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
        install_oauth_session(self.client)

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        jira_server.TASKS_CACHE.clear()
        if hasattr(jira_server, "MISSING_INFO_CACHE"):
            jira_server.MISSING_INFO_CACHE.clear()
        if hasattr(jira_server, "DEPENDENCIES_CACHE"):
            jira_server.DEPENDENCIES_CACHE.clear()
        self._env_patcher.stop()

    def test_tasks_route_is_oauth_ready(self):
        issue = _synthetic_issue()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [issue],
                 "names": {"customfield_team": "Team[Team]"},
                 "isLast": True,
             })) as mock_search, \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = self.client.get("/api/tasks?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_tasks_with_team_name_is_oauth_ready(self):
        issue = _synthetic_issue()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [issue],
                 "names": {"customfield_team": "Team[Team]"},
                 "isLast": True,
             })) as mock_search, \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_tasks_with_team_name_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "current_jira_search", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_tasks_with_team_name_stale_oauth_returns_reconnect_payload(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=jira_server.AuthError("auth_connection_stale", "Your Jira connection changed. Reconnect to continue.")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_connection_stale")
        self.assertEqual(body["message"], "Your Jira connection changed. Reconnect to continue.")
        self.assertEqual(body["recoveryUrl"], "/auth/reconnect")

    def test_tasks_with_team_name_uses_oauth_partitioned_cache(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = _local_oauth_context(stored_at=stored_at)
        raw_key = jira_server.build_tasks_cache_key(
            "2026Q2",
            "default",
            "all",
            [],
            [],
            True,
            False,
            "dashboard",
            [],
        )
        partitioned_key = build_jira_home_process_cache_key(auth_context, raw_key)
        jira_server.TASKS_CACHE[raw_key] = {
            "timestamp": time.time(),
            "data": {"issues": [{"key": "OTHER-1"}]},
        }
        jira_server.TASKS_CACHE[partitioned_key] = {
            "timestamp": time.time(),
            "data": {"issues": [{"key": "PROD-1"}]},
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "database_storage_enabled", return_value=False), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=AssertionError("cache hit should not resolve Jira fields")):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"issues": [{"key": "PROD-1"}]})
        self.assertEqual(response.headers.get("Server-Timing"), "cache;dur=1")

    def test_tasks_with_team_name_keeps_oauth_context_for_epic_enrichment(self):
        main_thread_id = threading.get_ident()
        calls = []
        story = _synthetic_issue()
        story["fields"]["customfield_epic"] = "PROD-EPIC"
        epic = _synthetic_epic()

        def fake_search(payload, *args, **kwargs):
            if threading.get_ident() != main_thread_id:
                raise jira_server.AuthError("auth_required", "Atlassian authentication is required.")
            calls.append(payload.get("jql", ""))
            jql = payload.get("jql", "")
            if "Sprint = 2026Q2" in jql and "type" not in jql.lower() and "issuetype" not in jql.lower():
                return FakeResponse(200, {
                    "issues": [story],
                    "names": {
                        "customfield_team": "Team[Team]",
                        "customfield_epic": "Epic Link",
                    },
                    "isLast": True,
                })
            if "issueKey in" in jql:
                return FakeResponse(200, {"issues": [epic], "isLast": True})
            if "type = Epic" in jql or "issuetype = Epic" in jql:
                return FakeResponse(200, {"issues": [epic], "isLast": True})
            return FakeResponse(200, {"issues": [], "isLast": True})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value="customfield_epic"), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["fields"]["epicKey"], "PROD-EPIC")
        self.assertTrue(any("issueKey in" in jql for jql in calls))
        self.assertTrue(any("type = Epic" in jql for jql in calls))

    def test_missing_info_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [], "isLast": True})) as mock_search:
            response = self.client.get("/api/missing-info?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"], [])
        mock_search.assert_called()

    def test_missing_info_stale_oauth_returns_reconnect_payload(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=jira_server.AuthError("auth_connection_stale", "Your Jira connection changed. Reconnect to continue.")):
            response = self.client.get("/api/missing-info?sprint=2026Q2")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "auth_connection_stale")
        self.assertEqual(body["message"], "Your Jira connection changed. Reconnect to continue.")
        self.assertEqual(body["recoveryUrl"], "/auth/reconnect")

    def test_missing_info_uses_oauth_partitioned_cache_and_timing(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = _local_oauth_context(stored_at=stored_at)
        if not hasattr(jira_server, "MISSING_INFO_CACHE"):
            jira_server.MISSING_INFO_CACHE = {}
        cache_key = build_jira_home_process_cache_key(
            auth_context,
            "missing-info",
            "2026Q2",
            "team-alpha",
            "Comp A",
        )
        jira_server.MISSING_INFO_CACHE[cache_key] = {
            "timestamp": time.time(),
            "data": {"issues": [{"key": "PROD-1"}], "epics": [], "count": 1},
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "database_storage_enabled", return_value=False), \
             patch.object(jira_server, "resolve_team_field_id", side_effect=AssertionError("cache hit should not resolve Jira fields")):
            response = self.client.get("/api/missing-info?sprint=2026Q2&teamIds=team-alpha&components=Comp%20A")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"issues": [{"key": "PROD-1"}], "epics": [], "count": 1})
        self.assertEqual(response.headers.get("Server-Timing"), "cache;dur=1")

    def test_dependencies_requires_oauth_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/dependencies", json={"keys": ["PROD-1"]})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_dependencies_is_oauth_ready_with_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", return_value={"PROD-1": []}):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"dependencies": {"PROD-1": []}})

    def test_dependencies_uses_oauth_partitioned_cache_and_timing(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = _local_oauth_context(stored_at=stored_at)
        if not hasattr(jira_server, "DEPENDENCIES_CACHE"):
            jira_server.DEPENDENCIES_CACHE = {}
        cache_key = build_jira_home_process_cache_key(
            auth_context,
            "dependencies",
            "PROD-1,TECH-2",
        )
        jira_server.DEPENDENCIES_CACHE[cache_key] = {
            "timestamp": time.time(),
            "data": {"PROD-1": [{"key": "TECH-2"}]},
        }

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "database_storage_enabled", return_value=False), \
             patch.object(jira_server, "collect_dependencies", side_effect=AssertionError("cache hit should not query Jira")):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["TECH-2", "PROD-1", "PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"dependencies": {"PROD-1": [{"key": "TECH-2"}]}})
        self.assertEqual(response.headers.get("Server-Timing"), "cache;dur=1")

    def test_dependencies_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "collect_dependencies", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.post(
                "/api/dependencies",
                json={"keys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_issue_lookup_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/issues/lookup?ids=10001")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issues"][0]["key"], "PROD-1")
        mock_search.assert_called()

    def test_teams_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/teams?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["teams"][0]["id"], "team-alpha")
        mock_search.assert_called()

    def test_teams_resolve_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/teams/resolve?teamIds=team-alpha")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["teams"][0]["id"], "team-alpha")
        mock_search.assert_called()

    def test_teams_all_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {"issues": [_synthetic_issue()], "isLast": True})) as mock_search:
            response = self.client.get("/api/teams/all?sprint=2026Q2")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["teams"][0]["id"], "team-alpha")
        mock_search.assert_called()

    def test_teams_all_falls_back_to_project_scan_when_sprint_has_no_teams(self):
        calls = []

        def fake_search(payload):
            calls.append(payload["jql"])
            if "Sprint = 2026Q2" in payload["jql"]:
                return FakeResponse(200, {
                    "issues": [],
                    "names": {"customfield_team": "Team[Team]"},
                    "isLast": True,
                })
            return FakeResponse(200, {
                "issues": [_synthetic_issue()],
                "names": {"customfield_team": "Team[Team]"},
                "isLast": True,
            })

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "jira_search_request", side_effect=fake_search), \
             patch.object(jira_server, "fetch_teams_from_jira_api", return_value={}):
            response = self.client.get("/api/teams?sprint=2026Q2&all=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["teams"][0]["id"], "team-alpha")
        self.assertEqual(len(calls), 2)
        self.assertIn("Sprint = 2026Q2", calls[0])
        self.assertNotIn("Sprint = 2026Q2", calls[1])

    def test_backlog_epics_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "fetch_backlog_epics_for_alert", return_value=[{"key": "PROD-1"}]) as mock_fetch:
            response = self.client.get("/api/backlog-epics")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["epics"], [{"key": "PROD-1"}])
        mock_fetch.assert_called()


class IssueTransitionRouteTests(unittest.TestCase):
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
        install_oauth_session(self.client)

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self._env_patcher.stop()

    def _csrf_token(self):
        # The write route's token-bound CSRF is bound to the OAuth session, so the
        # token must be minted under atlassian_oauth mode to validate on the POST.
        # Patch here so callers work regardless of the process JIRA_AUTH_MODE (CI
        # runs with JIRA_AUTH_MODE=basic), not only when a local .env sets oauth mode.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.get("/api/auth/csrf")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["csrfToken"]

    def test_transition_options_returns_statuses_in_oauth_mode(self):
        def fake_search(payload, *, context=None, timeout=30):
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"summary": "S", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]})

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            self.assertEqual(method, "GET")
            return FakeResponse(200, {"transitions": [{"id": "11", "name": "Start Progress", "to": {"name": "In Progress"}}]})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request):
            response = self.client.post(
                "/api/issues/transitions/options",
                json={"issueKeys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["issues"], [{
            "key": "PROD-1",
            "issueType": "Story",
            "currentStatus": "To Do",
            "transitions": [{"name": "Start Progress", "toStatus": "In Progress"}],
        }])
        self.assertEqual(body["targetStatuses"], [{"name": "In Progress", "availableCount": 1, "blockedCount": 0}])

    def test_transition_options_requires_x_requested_with_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_transition_options", side_effect=AssertionError("route code reached")):
            response = self.client.post("/api/issues/transitions/options", json={"issueKeys": ["PROD-1"]})

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_transition_options_service_error_returns_sanitized_502(self):
        def fake_load_options(issue_keys, *, jira_request, search_request, context=None):
            raise IssueTransitionServiceError("issue_snapshot_fetch_failed", 503)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "load_transition_options", side_effect=fake_load_options):
            response = self.client.post(
                "/api/issues/transitions/options",
                json={"issueKeys": ["PROD-1"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_transition_options_failed")

    def test_transitions_write_rejects_missing_x_requested_with_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("X-Requested-With", response.get_json()["message"])

    def test_transitions_write_rejects_missing_csrf_token_before_route_code(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("CSRF", response.get_json()["message"])

    def test_transitions_write_returns_missing_scope_before_jira_call_when_write_scope_absent(self):
        # Simulate a session/server pair that predates the write:jira-work scope
        # rollout: the middleware's blanket ATLASSIAN_SCOPES check does not catch
        # this (server config agrees with the session), so only the route's own
        # explicit write:jira-work check can catch it.
        old_scope = (
            "read:me read:jira-work read:jira-user read:board-scope:jira-software "
            "read:sprint:jira-software read:project:jira offline_access"
        )
        install_oauth_session(self.client, scope=old_scope)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "ATLASSIAN_SCOPES", old_scope):
            csrf_token = self._csrf_token()
            with patch.object(eng_routes, "transition_issues", side_effect=AssertionError("must not resolve/post transitions")), \
                 patch.object(jira_server, "current_jira_request", side_effect=AssertionError("must not call Jira")), \
                 patch.object(jira_server, "current_jira_search", side_effect=AssertionError("must not call Jira")):
                response = self.client.post(
                    "/api/issues/transitions",
                    json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                    headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
                )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "missing_oauth_scope")
        self.assertEqual(body["recoveryUrl"], "/login?reason=missing_scope")

    def test_transitions_write_uses_auth_context_and_forwards_to_service(self):
        sentinel_context = object()
        captured = {}

        def fake_transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
            captured["context"] = context
            return {
                "requested": 1,
                "succeeded": 1,
                "failed": 0,
                "targetStatus": target_status,
                "results": [{"key": "PROD-1", "result": "success", "fromStatus": "To Do", "toStatus": target_status}],
            }

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_request_auth_context", return_value=sentinel_context), \
             patch.object(eng_routes, "transition_issues", side_effect=fake_transition_issues), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], sentinel_context)
        mock_clear.assert_called_once()

    def test_transitions_write_does_not_call_build_jira_headers(self):
        def fake_search(payload, *, context=None, timeout=30):
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"summary": "S", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]})

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            if method == "GET":
                return FakeResponse(200, {"transitions": [{"id": "11", "name": "Start Progress", "to": {"name": "Accepted"}}]})
            return FakeResponse(204, {})

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_search", side_effect=fake_search), \
             patch.object(jira_server, "current_jira_request", side_effect=fake_request), \
             patch.object(jira_server, "build_jira_headers", side_effect=AssertionError("build_jira_headers must not be called")), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["succeeded"], 1)
        mock_clear.assert_called_once()

    def test_transitions_write_does_not_clear_caches_when_nothing_succeeded(self):
        def fake_transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
            return {
                "requested": 1,
                "succeeded": 0,
                "failed": 1,
                "targetStatus": target_status,
                "results": [{"key": "PROD-1", "result": "failure", "error": "transition_not_available"}],
            }

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=fake_transition_issues), \
             patch.object(eng_routes, "clear_jira_issue_status_caches") as mock_clear:
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_clear.assert_not_called()

    def test_transitions_write_maps_input_error_to_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": [], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "issue_keys_required")

    def test_transitions_write_invalid_json_body_returns_400(self):
        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post(
                "/api/issues/transitions",
                data="not-json",
                content_type="application/json",
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "invalid_json")

    def test_transitions_write_service_error_returns_sanitized_502(self):
        def fake_transition_issues(issue_keys, target_status, *, jira_request, search_request, context=None):
            raise IssueTransitionServiceError("issue_snapshot_fetch_failed", 503)

        csrf_token = self._csrf_token()
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(eng_routes, "transition_issues", side_effect=fake_transition_issues):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
                headers={"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": csrf_token},
            )

        self.assertEqual(response.status_code, 502, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_transition_failed")


class MissingWriteJiraWorkScopeHelperTests(unittest.TestCase):
    """Direct coverage of the route-level defense-in-depth scope check.

    DB-backed auth contexts already had write:jira-work verified inside
    current_request_auth_context() (resolve_db_request_auth_context checks the
    full ATLASSIAN_SCOPES set), so the helper must skip the local session
    re-check for them without touching oauth_session_data() at all.
    """

    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"

    def test_skips_recheck_for_db_backed_context(self):
        db_context = SimpleNamespace(auth_connection_id="db-connection-42")
        with patch.object(jira_server, "oauth_session_data", side_effect=AssertionError("must not check local session for a DB-backed context")):
            eng_routes.bind_server_globals(eng_routes.__dict__)
            self.assertFalse(eng_routes._missing_write_jira_work_scope(db_context))

    def test_flags_local_context_missing_write_scope(self):
        local_context = SimpleNamespace(auth_connection_id="local-oauth-connection:session-1")
        with patch.object(jira_server, "oauth_session_data", return_value={"scope": "read:me read:jira-work"}):
            eng_routes.bind_server_globals(eng_routes.__dict__)
            self.assertTrue(eng_routes._missing_write_jira_work_scope(local_context))

    def test_local_context_with_write_scope_is_not_missing(self):
        local_context = SimpleNamespace(auth_connection_id="local-oauth-connection:session-1")
        with patch.object(jira_server, "oauth_session_data", return_value={"scope": "read:me write:jira-work"}):
            eng_routes.bind_server_globals(eng_routes.__dict__)
            self.assertFalse(eng_routes._missing_write_jira_work_scope(local_context))


class BasicEngRouteTests(unittest.TestCase):
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
        self._env_patcher.stop()

    def test_transition_options_rejects_basic_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "load_transition_options", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.post(
                "/api/issues/transitions/options",
                json={"issueKeys": ["PROD-1"]},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_oauth_required")

    def test_transitions_write_rejects_basic_mode_after_csrf_satisfied(self):
        # Basic mode does not enforce X-Requested-With/CSRF at the middleware
        # layer, so the request reaches route code without those headers; the
        # route's own OAuth-mode guard must still refuse it.
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "transition_issues", side_effect=AssertionError("must not reach Jira in basic mode")):
            response = self.client.post(
                "/api/issues/transitions",
                json={"issueKeys": ["PROD-1"], "targetStatus": "Accepted"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "jira_oauth_required")

    def test_tasks_with_team_name_basic_uses_jira_url_basic_auth_without_csrf_header(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"issues": [], "isLast": True})

        expected_token = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=None), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=None), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = self.client.get("/api/tasks-with-team-name?sprint=2026Q2&project=all&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(calls[0][0], "https://basic.atlassian.net/rest/api/3/search/jql")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], f"Basic {expected_token}")

    def test_dependencies_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "collect_dependencies", return_value={"PROD-1": []}):
            response = self.client.post("/api/dependencies", json={"keys": ["PROD-1"]})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {"dependencies": {"PROD-1": []}})
