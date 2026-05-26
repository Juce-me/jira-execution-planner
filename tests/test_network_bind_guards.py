import unittest
from types import SimpleNamespace
from unittest.mock import patch

import jira_server


class NetworkBindGuardTests(unittest.TestCase):
    def test_default_bind_host_is_loopback(self):
        self.assertEqual(jira_server.default_bind_host(), "127.0.0.1")

    def test_basic_mode_rejects_network_bind_without_explicit_allow(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.dict("os.environ", {"ALLOW_NETWORK_BIND": ""}, clear=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_network_bind("0.0.0.0")
        self.assertEqual(raised.exception.code, "network_bind_not_allowed")

    def test_oauth_mode_requires_secure_profile_for_network_bind(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"ALLOW_NETWORK_BIND": "true", "SESSION_COOKIE_SECURE": ""}, clear=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_network_bind("0.0.0.0")
        self.assertEqual(raised.exception.code, "secure_cookie_required")

    def test_oauth_local_token_store_cannot_bind_to_network(self):
        env = {
            "ALLOW_NETWORK_BIND": "true",
            "APP_ENVIRONMENT_KEY": "local",
            "APP_ALLOWED_ORIGINS": "https://planner.example.test",
            "FLASK_SECRET_KEY": "secret",
            "OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "true",
            "SESSION_COOKIE_SECURE": "true",
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", env, clear=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_network_bind("0.0.0.0")
        self.assertEqual(raised.exception.code, "local_token_store_network_bind_not_allowed")

    def test_main_validates_bind_host_before_app_run(self):
        args = SimpleNamespace(
            jira_url=None,
            jira_email=None,
            jira_token=None,
            jira_query=None,
            server_port=None,
        )
        with patch.object(jira_server, "parse_args", return_value=args), \
             patch.object(jira_server, "validate_startup_auth_config"), \
             patch.object(jira_server, "default_bind_host", return_value="127.0.0.1"), \
             patch.object(jira_server, "validate_network_bind", return_value="127.0.0.1") as validate_bind, \
             patch.object(jira_server.app, "run") as run:
            jira_server.main()

        validate_bind.assert_called_once_with("127.0.0.1")
        run.assert_called_once()
        self.assertEqual(run.call_args.kwargs.get("host"), "127.0.0.1")
