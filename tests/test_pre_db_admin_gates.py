import unittest
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import install_oauth_session


class PreDbToolAdminGateTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_shared_config_writes_require_tool_admin_oauth_account(self):
        install_oauth_session(self.client, account_id="regular-user-account")
        routes = [
            ("/api/groups-config", {"groups": []}),
            ("/api/team-catalog", {"catalog": {}, "meta": {}}),
            ("/api/projects/selected", {"selected": []}),
            ("/api/board-config", {"boardId": "7", "boardName": "Product"}),
            ("/api/capacity/config", {"project": "CAP", "fieldId": "customfield_1"}),
            ("/api/sprint-field/config", {"fieldId": "customfield_2", "fieldName": "Sprint"}),
            ("/api/story-points-field/config", {"fieldId": "customfield_3", "fieldName": "Story Points"}),
            ("/api/parent-name-field/config", {"fieldId": "customfield_4", "fieldName": "Parent"}),
            ("/api/team-field/config", {"fieldId": "customfield_5", "fieldName": "Team"}),
            ("/api/stats/priority-weights-config", {"weights": []}),
            ("/api/issue-types/config", {"issueTypes": ["Story"]}),
            ("/api/epm/config", {"version": 2, "projects": {}}),
        ]

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"TOOL_ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False):
            for route, payload in routes:
                with self.subTest(route=route):
                    response = self.client.post(
                        route,
                        json=payload,
                        headers={"X-Requested-With": "jira-execution-planner"},
                    )

                    self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
                    self.assertEqual(response.get_json()["error"], "admin_required")

    def test_shared_config_write_without_oauth_session_returns_login_url(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"TOOL_ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False):
            response = self.client.post(
                "/api/board-config",
                json={"boardId": "7", "boardName": "Product"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_required")
        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_tool_admin_oauth_account_can_save_shared_config(self):
        install_oauth_session(self.client, account_id="tool-admin-account")
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"TOOL_ADMIN_BOOTSTRAP_ATLASSIAN_ACCOUNT_IDS": "tool-admin-account"}, clear=False), \
             patch.object(jira_server, "load_dashboard_config", return_value={}), \
             patch.object(jira_server, "save_dashboard_config") as mock_save:
            response = self.client.post(
                "/api/board-config",
                json={"boardId": "7", "boardName": "Product"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["boardId"], "7")
        mock_save.assert_called_once()

    def test_basic_mode_preserves_single_user_config_writes(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(jira_server, "load_dashboard_config", return_value={}), \
             patch.object(jira_server, "save_dashboard_config") as mock_save:
            response = self.client.post("/api/board-config", json={"boardId": "7", "boardName": "Product"})

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["boardId"], "7")
        mock_save.assert_called_once()
