import base64
import os
import threading
import time
import unittest
from unittest.mock import patch

from backend.auth.cache_policy import build_jira_home_process_cache_key
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

    def test_tasks_with_team_name_uses_oauth_partitioned_cache(self):
        stored_at = time.time()
        install_oauth_session(self.client, stored_at=stored_at)
        auth_context = _local_oauth_context(stored_at=stored_at)
        raw_key = jira_server.build_tasks_cache_key(
            "2026Q2",
            "default",
            "all",
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
