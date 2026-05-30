import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jira_server
from tests.oauth_test_helpers import install_oauth_session


ENABLED_ENV = {
    "GA4_ENABLED": "true",
    "GTM_CONTAINER_ID": "GTM-NZJW2CFN",
    "GA4_MEASUREMENT_ID": "G-6QERX19WB0",
    "GA4_USER_ID_PEPPER": "pepper-1",
}


class AnalyticsRoutesTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.client = jira_server.app.test_client()

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_disabled_context_is_compact_no_store_and_public(self):
        with patch.dict("os.environ", {"GA4_ENABLED": "false"}, clear=False):
            response = self.client.get("/api/analytics/context")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(response.get_json(), {
            "enabled": False,
            "gtmContainerId": None,
            "measurementId": None,
            "debugMode": False,
            "ga4UserId": None,
        })

    def test_enabled_context_for_basic_local_never_includes_user_id(self):
        with patch.dict("os.environ", ENABLED_ENV, clear=False), \
             patch.object(jira_server, "JIRA_AUTH_MODE", jira_server.AUTH_MODE_BASIC):
            response = self.client.get("/api/analytics/context")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(response.get_json(), {
            "enabled": True,
            "gtmContainerId": "GTM-NZJW2CFN",
            "measurementId": "G-6QERX19WB0",
            "debugMode": False,
            "ga4UserId": None,
        })

    def test_enabled_context_for_oauth_without_session_does_not_hash_identity(self):
        with patch.dict("os.environ", ENABLED_ENV, clear=False), \
             patch.object(jira_server, "JIRA_AUTH_MODE", jira_server.AUTH_MODE_ATLASSIAN_OAUTH), \
             patch("backend.analytics.identity.pseudonymous_ga4_user_id", side_effect=AssertionError("hash called")):
            response = self.client.get("/api/analytics/context")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIsNone(response.get_json()["ga4UserId"])

    def test_enabled_context_for_authenticated_oauth_returns_only_pseudonymous_user_id(self):
        install_oauth_session(self.client, account_id="account-123")
        with patch.dict("os.environ", {**ENABLED_ENV, "GA4_DEBUG_MODE": "true"}, clear=False), \
             patch.object(jira_server, "JIRA_AUTH_MODE", jira_server.AUTH_MODE_ATLASSIAN_OAUTH):
            first = self.client.get("/api/analytics/context")
            second = self.client.get("/api/analytics/context")

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        body = first.get_json()
        self.assertEqual(set(body), {"enabled", "gtmContainerId", "measurementId", "debugMode", "ga4UserId"})
        self.assertTrue(body["enabled"])
        self.assertTrue(body["debugMode"])
        self.assertIsInstance(body["ga4UserId"], str)
        self.assertEqual(second.get_json()["ga4UserId"], body["ga4UserId"])

        raw_forbidden_values = [
            "account-123",
            "cloud-123",
            "https://example.atlassian.net",
            "access-123",
            "refresh-123",
            "session-1",
        ]
        response_text = first.get_data(as_text=True)
        for value in raw_forbidden_values:
            with self.subTest(value=value):
                self.assertNotIn(value, response_text)

    def test_startup_validation_fails_closed_when_enabled_config_is_invalid(self):
        from backend.analytics.config import AnalyticsConfigError, validate_analytics_startup_config

        with patch.dict("os.environ", {"GA4_ENABLED": "true"}, clear=True):
            with self.assertRaises(AnalyticsConfigError):
                validate_analytics_startup_config()

    def test_jira_server_startup_validation_fails_closed_for_invalid_enabled_analytics(self):
        with patch.dict("os.environ", {"GA4_ENABLED": "true", "CONFIG_STORAGE_BACKEND": "jsonfile"}, clear=True), \
             patch.object(jira_server, "JIRA_AUTH_MODE", jira_server.AUTH_MODE_BASIC), \
             patch.object(jira_server, "JIRA_URL", "https://example.atlassian.net"), \
             patch.object(jira_server, "JIRA_EMAIL", "user@example.com"), \
             patch.object(jira_server, "JIRA_TOKEN", "token"):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_startup_auth_config()

        self.assertEqual(raised.exception.code, "analytics_config_invalid")

    def test_route_returns_500_for_enabled_invalid_runtime_config(self):
        with patch.dict("os.environ", {"GA4_ENABLED": "true"}, clear=True):
            response = self.client.get("/api/analytics/context")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["error"], "analytics_config_invalid")

    def test_real_oauth_context_with_empty_subject_returns_null_user_id(self):
        empty_subject_context = SimpleNamespace(
            auth_mode=jira_server.AUTH_MODE_ATLASSIAN_OAUTH,
            stable_subject="",
        )
        with patch.dict("os.environ", ENABLED_ENV, clear=False), \
             patch.object(jira_server, "JIRA_AUTH_MODE", jira_server.AUTH_MODE_ATLASSIAN_OAUTH), \
             patch.object(jira_server, "current_request_auth_context", return_value=empty_subject_context), \
             patch("backend.analytics.identity.pseudonymous_ga4_user_id", side_effect=AssertionError("hash called")):
            response = self.client.get("/api/analytics/context")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIsNone(response.get_json()["ga4UserId"])


if __name__ == "__main__":
    unittest.main()
