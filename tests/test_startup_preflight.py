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

    def _hosted_oauth_env(self, overrides=None):
        env = {
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
        }
        if overrides:
            env.update(overrides)
        return env

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
        code, output = self._run(self._hosted_oauth_env())

        self.assertIn("PASS token_encryption: key id container-key", output)
        self.assertIn("PASS oauth_local_token_store: not required for db oauth", output)

    def test_db_oauth_local_loopback_preflight_allows_local_token_store(self):
        code, output = self._run({
            "APP_ENVIRONMENT_KEY": "local",
            "JIRA_URL": "https://example.atlassian.net",
            "JIRA_AUTH_MODE": "atlassian_oauth",
            "ATLASSIAN_CLIENT_ID": "client",
            "ATLASSIAN_CLIENT_SECRET": "secret",
            "ATLASSIAN_REDIRECT_URI": "http://127.0.0.1:5050/api/auth/atlassian/callback",
            "FLASK_SECRET_KEY": "flask-secret",
            "CONFIG_STORAGE_BACKEND": "db",
            "DATABASE_URL": "postgresql+psycopg://jep_user@127.0.0.1:5432/jep",
            "TOKEN_ENCRYPTION_KEY_SOURCE": "env",
            "TOKEN_ENCRYPTION_MASTER_KEY_B64": base64.b64encode(bytes([8]) * 32).decode("ascii"),
            "TOKEN_ENCRYPTION_KEY_ID": "local-key",
            "APP_BIND_HOST": "127.0.0.1",
            "OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "true",
        })

        self.assertEqual(code, 1)
        self.assertNotIn("FAIL oauth_local_token_store", output)
        self.assertIn("PASS oauth_local_token_store: not required for db oauth", output)

    def test_oauth_network_bind_preflight_requires_allowed_origins(self):
        code, output = self._run(self._hosted_oauth_env({"APP_ALLOWED_ORIGINS": ""}))

        self.assertEqual(code, 1)
        self.assertIn("FAIL network_bind: OAuth network bind requires explicit APP_ALLOWED_ORIGINS without *.", output)

    def test_oauth_network_bind_preflight_rejects_wildcard_allowed_origins(self):
        code, output = self._run(self._hosted_oauth_env({"APP_ALLOWED_ORIGINS": "*"}))

        self.assertEqual(code, 1)
        self.assertIn("FAIL network_bind: OAuth network bind requires explicit APP_ALLOWED_ORIGINS without *.", output)

    def test_oauth_network_bind_preflight_requires_flask_secret_key(self):
        code, output = self._run(self._hosted_oauth_env({"FLASK_SECRET_KEY": ""}))

        self.assertEqual(code, 1)
        self.assertIn("FAIL network_bind: OAuth network bind requires FLASK_SECRET_KEY.", output)

    def test_oauth_network_bind_preflight_rejects_local_token_store(self):
        code, output = self._run(self._hosted_oauth_env({"OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "true"}))

        self.assertEqual(code, 1)
        self.assertIn("FAIL oauth_local_token_store: DB/OAuth hosted mode must not enable OAUTH_LOCAL_TOKEN_STORE_ALLOWED.", output)
        self.assertIn("FAIL network_bind: Local OAuth token storage cannot be used with network bind.", output)


if __name__ == "__main__":
    unittest.main()
