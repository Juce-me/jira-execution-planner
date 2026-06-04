import base64
import io
import unittest
from contextlib import redirect_stdout

from scripts.check_startup_preflight import run_preflight


class StartupPreflightTests(unittest.TestCase):
    def _run(self, env):
        output = io.StringIO()
        with redirect_stdout(output):
            code = run_preflight(env)
        return code, output.getvalue()

    def test_jsonfile_basic_preflight_passes_without_db_checks(self):
        code, output = self._run({
            "JIRA_URL": "https://example.atlassian.net",
            "JIRA_AUTH_MODE": "basic",
            "JIRA_EMAIL": "user@example.com",
            "JIRA_TOKEN": "secret-token",
            "CONFIG_STORAGE_BACKEND": "jsonfile",
            "APP_BIND_HOST": "127.0.0.1",
        })

        self.assertEqual(code, 0, output)
        self.assertIn("PASS auth_config: basic", output)
        self.assertIn("PASS database_url: not required for jsonfile config storage", output)
        self.assertIn("PASS migrations: not required for jsonfile config storage", output)

    def test_db_alias_requires_database_url(self):
        code, output = self._run({
            "JIRA_URL": "https://example.atlassian.net",
            "JIRA_AUTH_MODE": "basic",
            "JIRA_EMAIL": "user@example.com",
            "JIRA_TOKEN": "secret-token",
            "CONFIG_STORAGE_BACKEND": "postgresql",
            "APP_BIND_HOST": "127.0.0.1",
        })

        self.assertEqual(code, 1)
        self.assertIn("PASS config_storage: db", output)
        self.assertIn("FAIL database_url", output)

    def test_preflight_output_does_not_print_basic_token(self):
        code, output = self._run({
            "JIRA_AUTH_MODE": "basic",
            "JIRA_EMAIL": "user@example.com",
            "JIRA_TOKEN": "secret-token",
            "CONFIG_STORAGE_BACKEND": "jsonfile",
        })

        self.assertEqual(code, 1)
        self.assertNotIn("secret-token", output)

    def test_db_oauth_hosted_preflight_accepts_explicit_env_key_source(self):
        code, output = self._run({
            "APP_ENVIRONMENT_KEY": "production",
            "JIRA_URL": "https://example.atlassian.net",
            "JIRA_AUTH_MODE": "atlassian_oauth",
            "ATLASSIAN_CLIENT_ID": "client",
            "ATLASSIAN_CLIENT_SECRET": "secret",
            "ATLASSIAN_REDIRECT_URI": "https://planner.example.test/api/auth/atlassian/callback",
            "FLASK_SECRET_KEY": "flask-secret",
            "CONFIG_STORAGE_BACKEND": "db",
            "DATABASE_URL": "postgresql+psycopg://jep_user@db:5432/jep",
            "TOKEN_ENCRYPTION_KEY_SOURCE": "env",
            "TOKEN_ENCRYPTION_MASTER_KEY_B64": base64.b64encode(bytes([8]) * 32).decode("ascii"),
            "TOKEN_ENCRYPTION_KEY_ID": "container-key",
            "APP_BIND_HOST": "0.0.0.0",
            "ALLOW_NETWORK_BIND": "true",
            "SESSION_COOKIE_SECURE": "true",
            "APP_ALLOWED_ORIGINS": "https://planner.example.test",
            "OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "false",
        })

        self.assertIn("PASS token_encryption: key id container-key", output)
        self.assertIn("PASS oauth_local_token_store: not required for db oauth", output)


if __name__ == "__main__":
    unittest.main()
