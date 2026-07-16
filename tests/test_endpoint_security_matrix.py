import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import install_oauth_session


SECURITY_SAMPLES = {
    "public_page": [("GET", "/health"), ("GET", "/jira-dashboard.html")],
    "public_context": [("GET", "/api/analytics/context")],
    "authenticated_read": [
        ("GET", "/api/config"),
        ("GET", "/api/projects/selected"),
        ("GET", "/api/tasks"),
        ("GET", "/api/issues/subtasks?parentKey=PROD-1&sprint=42"),
        ("GET", "/api/epm/projects"),
        ("GET", "/api/epm/projects/home-project-1/issues"),
        ("GET", "/api/stats"),
        ("GET", "/api/scenario/drafts"),
        ("GET", "/api/issues/priorities/options"),
        ("GET", "/api/issues/statuses/catalog"),
        ("GET", "/api/issues/project-track/options"),
    ],
    "user_write": [
        ("POST", "/api/me/views"),
        ("POST", "/api/groups-preferences"),
        ("POST", "/api/export-excel"),
        ("POST", "/api/issues/priorities"),
        ("POST", "/api/issues/project-track"),
    ],
    "workspace_write": [
        ("POST", "/api/scenario/drafts"),
        ("POST", "/api/scenario/drafts/draft-1/rollback"),
        ("POST", "/api/scenario/drafts/draft-1/writeback"),
    ],
    "shared_admin_write": [("POST", "/api/board-config"), ("POST", "/api/epm/config")],
    "tool_admin": [("GET", "/api/admin/users"), ("PATCH", "/api/admin/users/user-1/status")],
    "dev_local": [("GET", "/api/debug-fields"), ("GET", "/api/tasks-fields")],
}


class EndpointSecurityMatrixTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def _request(self, method, path, **kwargs):
        return self.client.open(path, method=method, **kwargs)

    def _oauth_mode(self):
        return patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth")

    def _csrf_token(self):
        response = self.client.get("/api/auth/csrf")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["csrfToken"]

    def test_public_pages_stay_readable_in_oauth_mode(self):
        with self._oauth_mode():
            for method, path in SECURITY_SAMPLES["public_page"]:
                with self.subTest(path=path):
                    response = self._request(method, path)
                    self.assertLess(response.status_code, 400, response.get_data(as_text=True))

    def test_analytics_context_is_readable_in_basic_and_oauth_modes(self):
        with patch.dict("os.environ", {"GA4_ENABLED": "false"}, clear=False):
            for method, path in SECURITY_SAMPLES["public_context"]:
                with self.subTest(mode="basic", path=path):
                    response = self._request(method, path)
                    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

                with self._oauth_mode():
                    with self.subTest(mode="oauth_unauthenticated", path=path):
                        response = self._request(method, path)
                        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

                    install_oauth_session(self.client, account_id="account-123")
                    with self.subTest(mode="oauth_authenticated", path=path):
                        response = self._request(method, path)
                        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_anonymous_oauth_requests_cannot_read_or_write_app_data(self):
        protected_classes = [
            "authenticated_read",
            "user_write",
            "workspace_write",
            "shared_admin_write",
            "tool_admin",
        ]
        with self._oauth_mode():
            for policy_class in protected_classes:
                for method, path in SECURITY_SAMPLES[policy_class]:
                    with self.subTest(policy_class=policy_class, path=path):
                        response = self._request(
                            method,
                            path,
                            json={},
                            headers={"X-Requested-With": "jira-execution-planner"},
                        )
                        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
                        self.assertEqual(response.get_json()["error"], "auth_required")
                        self.assertEqual(response.get_json()["loginUrl"], "/login?reason=session_expired")

    def test_dynamic_concrete_paths_are_classified_by_policy(self):
        from backend.security.policy import matching_path_policies

        samples = [
            ("GET", "/api/epm/projects/home-project-1/issues", "authenticated_read"),
            ("POST", "/api/scenario/drafts/draft-1/rollback", "workspace_write"),
        ]

        for method, path, expected_policy_class in samples:
            with self.subTest(path=path):
                matches = matching_path_policies(path, method)
                self.assertEqual([policy.policy_class for policy in matches], [expected_policy_class])

    def test_issue_transition_policy_classes_have_expected_csrf_requirements(self):
        from backend.security.guards import CSRF_POLICY_CLASSES, PROTECTED_POLICY_CLASSES
        from backend.security.policy import classify_rule

        options_policy = classify_rule("/api/issues/transitions/options", ["POST"])
        write_policy = classify_rule("/api/issues/transitions", ["POST"])

        self.assertIsNotNone(options_policy)
        self.assertIsNotNone(write_policy)
        self.assertEqual(options_policy.policy_class, "authenticated_read")
        self.assertEqual(write_policy.policy_class, "user_write")
        self.assertIn(options_policy.policy_class, PROTECTED_POLICY_CLASSES)
        self.assertNotIn(options_policy.policy_class, CSRF_POLICY_CLASSES)
        self.assertIn(write_policy.policy_class, CSRF_POLICY_CLASSES)

    def test_unsafe_oauth_requests_require_x_requested_with_before_route_code(self):
        install_oauth_session(self.client, account_id="tool-admin-account")
        with self._oauth_mode():
            response = self.client.post("/api/board-config", json={"boardId": "7"})

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("X-Requested-With", response.get_json()["message"])

    def test_unsafe_write_requests_require_token_bound_csrf_before_route_code(self):
        install_oauth_session(self.client, account_id="tool-admin-account")
        with self._oauth_mode(), \
             patch.object(jira_server, "load_dashboard_config", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/board-config",
                json={"boardId": "7"},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertIn("CSRF", response.get_json()["message"])

    def test_shared_admin_write_requires_admin_after_csrf(self):
        install_oauth_session(self.client, account_id="regular-user-account")
        with self._oauth_mode():
            csrf_token = self._csrf_token()

        non_admin_context = SimpleNamespace(is_admin=False)
        with self._oauth_mode(), \
             patch.object(jira_server, "current_request_auth_context", return_value=non_admin_context), \
             patch.object(jira_server, "load_dashboard_config", side_effect=AssertionError("route code reached")):
            response = self.client.post(
                "/api/board-config",
                json={"boardId": "7"},
                headers={
                    "X-Requested-With": "jira-execution-planner",
                    "X-CSRF-Token": csrf_token,
                },
            )

        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "admin_required")
        self.assertEqual(response.get_json()["recoveryUrl"], "/auth/admin-required")

    def test_unclassified_oauth_api_returns_route_not_oauth_ready(self):
        with self._oauth_mode():
            response = self.client.get("/api/not-registered-hardening-route")

        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.get_json()["error"], "route_not_oauth_ready")

    def test_dev_local_routes_are_hidden_without_explicit_allow_flag(self):
        with self._oauth_mode(), \
             patch.dict("os.environ", {"ALLOW_DEV_DIAGNOSTIC_ENDPOINTS": ""}, clear=False):
            for method, path in SECURITY_SAMPLES["dev_local"]:
                with self.subTest(path=path):
                    response = self._request(method, path)
                    self.assertEqual(response.status_code, 404, response.get_data(as_text=True))
                    self.assertEqual(response.get_json()["error"], "not_found")
