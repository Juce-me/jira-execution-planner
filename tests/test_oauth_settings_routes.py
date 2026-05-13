import base64
import unittest
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class OAuthSettingsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()
        install_oauth_session(self.client, site_url="https://oauth-site.atlassian.net")

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        jira_server.PROJECTS_CACHE.update({"data": None, "timestamp": 0})
        jira_server.COMPONENTS_CACHE.update({"data": None, "timestamp": 0})
        jira_server.EPICS_SEARCH_CACHE.clear()
        jira_server.LABELS_CACHE.update({"data": None, "timestamp": 0})
        jira_server.ISSUE_TYPES_CACHE.update({"data": None, "timestamp": 0})

    def test_config_is_oauth_ready_and_uses_session_site_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "JIRA_URL", "https://basic-site.atlassian.net"), \
             patch.object(jira_server, "get_board_config", return_value={}), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_groups_config_path", return_value="team-groups.json"), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2}), \
             patch.object(jira_server, "load_dashboard_config", return_value={}):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["jiraUrl"], "https://oauth-site.atlassian.net")
        self.assertEqual(response.get_json()["authMode"], "atlassian_oauth")

    def test_config_reports_basic_auth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic-site.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server, "get_board_config", return_value={}), \
             patch.object(jira_server, "get_effective_capacity_project", return_value=""), \
             patch.object(jira_server, "resolve_groups_config_path", return_value="team-groups.json"), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2}), \
             patch.object(jira_server, "load_dashboard_config", return_value={}):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["authMode"], "basic")

    def test_config_reports_authenticated_oauth_settings_access_before_db_roles(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "SETTINGS_ADMIN_ONLY", True), \
             patch.dict("os.environ", {"TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False), \
             patch.object(jira_server, "get_board_config", return_value={}), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_groups_config_path", return_value="team-groups.json"), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2}), \
             patch.object(jira_server, "load_dashboard_config", return_value={}):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()["userCanEditSettings"])

    def test_config_reports_environment_config_exists_from_dashboard_json(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={"boardId": "7", "boardName": "Product", "source": "config"}), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_groups_config_path", return_value="team-groups.json"), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROD"]), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2}), \
             patch.object(jira_server, "load_dashboard_config", return_value={"projects": {"selected": [{"key": "PROD", "type": "product"}]}}):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()["environmentConfigExists"])

    def test_config_reports_environment_config_missing_for_user_only_json(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_board_config", return_value={}), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_groups_config_path", return_value="team-groups.json"), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2}), \
             patch.object(jira_server, "load_dashboard_config", return_value={"teamGroups": {"groups": [{"id": "g1", "name": "Group 1"}]}}):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertFalse(response.get_json()["environmentConfigExists"])

    def test_config_reports_tool_admin_settings_access(self):
        install_oauth_session(self.client, account_id="tool-admin-account", site_url="https://oauth-site.atlassian.net")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "SETTINGS_ADMIN_ONLY", True), \
             patch.dict("os.environ", {"TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False), \
             patch.object(jira_server, "get_board_config", return_value={}), \
             patch.object(jira_server, "get_effective_capacity_project", return_value="CAP"), \
             patch.object(jira_server, "resolve_groups_config_path", return_value="team-groups.json"), \
             patch.object(jira_server, "get_selected_projects", return_value=[]), \
             patch.object(jira_server, "get_epm_config", return_value={"version": 2}), \
             patch.object(jira_server, "load_dashboard_config", return_value={}):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertTrue(response.get_json()["userCanEditSettings"])

    def test_local_config_get_routes_are_oauth_ready(self):
        routes = [
            "/api/version",
            "/api/groups-config",
            "/api/team-catalog",
            "/api/projects/selected",
            "/api/capacity/config",
            "/api/board-config",
            "/api/sprint-field/config",
            "/api/story-points-field/config",
            "/api/parent-name-field/config",
            "/api/team-field/config",
            "/api/stats/priority-weights-config",
            "/api/issue-types/config",
            "/api/epm/config",
        ]
        patches = [
            patch.object(jira_server, "UPDATE_CHECK_ENABLED", False),
            patch.object(jira_server, "load_dashboard_config", return_value={}),
            patch.object(jira_server, "load_team_catalog", return_value={"catalog": {}, "meta": {}}),
            patch.object(jira_server, "migrate_team_catalog_from_config"),
        ]
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            for active_patch in patches:
                active_patch.start()
                self.addCleanup(active_patch.stop)
            for route in routes:
                with self.subTest(route=route):
                    response = self.client.get(route)
                    self.assertNotEqual(response.status_code, 501, response.get_data(as_text=True))

    def test_projects_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": [{"key": "PROD", "name": "Product", "id": "100"}],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["projects"][0]["key"], "PROD")
        mock_get.assert_called_once_with(
            "/rest/api/3/project/search",
            params={"startAt": 0, "maxResults": 200, "orderBy": "key"},
            timeout=15,
        )

    def test_projects_expired_oauth_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", side_effect=jira_server.AuthError("auth_required", "Atlassian authentication is required.")):
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_boards_route_is_oauth_ready(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": [{"id": 7, "name": "Product board", "type": "scrum"}],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/boards?limit=1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["boards"][0]["id"], 7)
        mock_get.assert_called_once_with(
            "/rest/agile/1.0/board",
            params={"maxResults": 100, "startAt": 0},
            timeout=30,
        )

    def test_components_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROD"]), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"id": "11", "name": "API"}
             ])) as mock_get:
            response = self.client.get("/api/components?query=api")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["components"][0]["name"], "API")
        mock_get.assert_called_once_with("/rest/api/3/project/PROD/components", timeout=10)

    def test_epics_search_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "get_selected_projects", return_value=["PROD"]), \
             patch.object(jira_server, "current_jira_search", return_value=FakeResponse(200, {
                 "issues": [{
                     "key": "PROD-1",
                     "fields": {
                         "summary": "Synthetic epic",
                         "status": {"name": "To Do"},
                         "project": {"key": "PROD"},
                         "issuetype": {"name": "Epic"},
                     },
                 }]
             })) as mock_search:
            response = self.client.get("/api/epics/search?query=PROD-1")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["epics"][0]["key"], "PROD-1")
        mock_search.assert_called_once()

    def test_labels_route_bypasses_process_cache_for_oauth(self):
        jira_server.LABELS_CACHE.update({"data": ["cached"], "timestamp": 9999999999})
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
                 "values": ["fresh"],
                 "isLast": True,
             })) as mock_get:
            response = self.client.get("/api/jira/labels")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["labels"], ["fresh"])
        mock_get.assert_called_once()

    def test_issue_types_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"name": "Story", "subtask": False, "iconUrl": "https://example/icon.svg"}
             ])) as mock_get:
            response = self.client.get("/api/issue-types")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["issueTypes"][0]["name"], "Story")
        mock_get.assert_called_once_with("/rest/api/3/issuetype", timeout=15)

    def test_fields_route_uses_oauth_client(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, [
                 {"id": "customfield_10004", "name": "Story Points", "custom": True}
             ])) as mock_get:
            response = self.client.get("/api/fields")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["fields"][0]["id"], "customfield_10004")
        mock_get.assert_called_once_with("/rest/api/3/field", timeout=15)

    def test_local_config_post_requires_csrf_header_in_oauth_mode(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"):
            response = self.client.post("/api/board-config", json={"boardId": "7"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "csrf_required")


class BasicSettingsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.PROJECTS_CACHE.update({"data": None, "timestamp": 0})

    def test_projects_basic_uses_jira_url_basic_auth_without_csrf_header(self):
        calls = []

        def fake_get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(200, {"values": [], "isLast": True})

        expected_token = base64.b64encode(b"basic@example.com:api-token").decode("ascii")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "JIRA_URL", "https://basic.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "basic@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "api-token"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_get):
            response = self.client.get("/api/projects?refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(calls[0][0], "https://basic.atlassian.net/rest/api/3/project/search")
        self.assertEqual(calls[0][1]["headers"]["Authorization"], f"Basic {expected_token}")
        self.assertNotIn("X-Requested-With", calls[0][1]["headers"])

    def test_local_config_post_basic_mode_does_not_require_csrf_header(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "load_dashboard_config", return_value={}), \
             patch.object(jira_server, "save_dashboard_config"):
            response = self.client.post("/api/board-config", json={"boardId": "7", "boardName": "Product"})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["boardId"], "7")
