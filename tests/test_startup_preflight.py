import base64
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from backend.db import engine as db_engine
from scripts.check_startup_preflight import run_preflight


class StartupPreflightTests(unittest.TestCase):
    def tearDown(self):
        db_engine.dispose_engines()

    def _run(self, env):
        output = io.StringIO()
        with patch(
            "scripts.check_startup_preflight.validate_config_storage_startup",
            return_value=None,
        ), redirect_stdout(output):
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

    def _cloud_sql_env(self, database_url):
        return self._hosted_oauth_env({
            "DATABASE_CONNECTION_MODE": "cloud_sql_iam",
            "DATABASE_URL": database_url,
        })

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

        self.assertEqual(code, 0, output)
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

    def test_cloud_sql_database_check_accepts_safe_passwordless_psycopg_url(self):
        code, output = self._run(self._cloud_sql_env(
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=verify-full&sslrootcert=%2Fmounted-secrets%2Fserver-ca.pem"
        ))

        self.assertEqual(code, 0, output)
        self.assertIn(
            "PASS database_url: configured for cloud_sql_iam with TLS",
            output,
        )
        self.assertNotIn("iam-user", output)
        self.assertNotIn("private-db.internal.example", output)
        self.assertNotIn("planner", output)

    def test_cloud_sql_preflight_rejects_missing_url_fields(self):
        invalid_urls = (
            "postgresql+psycopg://private-db.internal.example:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@private-db.internal.example/planner?sslmode=require",
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/?sslmode=require",
        )
        for database_url in invalid_urls:
            with self.subTest(database_url=database_url):
                code, output = self._run(self._cloud_sql_env(database_url))
                self.assertEqual(code, 1)
                self.assertIn("FAIL database_url:", output)

    def test_cloud_sql_preflight_rejects_password_and_wrong_driver(self):
        invalid_urls = (
            "postgresql+psycopg://iam-user:secret@db:5432/planner?sslmode=require",
            "postgresql+pg8000://iam-user@db:5432/planner?sslmode=require",
            "postgresql+asyncpg://iam-user@db:5432/planner?sslmode=require",
        )
        for database_url in invalid_urls:
            with self.subTest(database_url=database_url):
                code, output = self._run(self._cloud_sql_env(database_url))
                self.assertEqual(code, 1)
                self.assertIn("FAIL database_url:", output)
                self.assertNotIn("secret", output)

    def test_cloud_sql_preflight_rejects_missing_or_unsafe_tls(self):
        for suffix in ("", "?sslmode=disable", "?sslmode=allow", "?sslmode=prefer"):
            with self.subTest(suffix=suffix):
                code, output = self._run(self._cloud_sql_env(
                    "postgresql+psycopg://iam-user@db:5432/planner" + suffix
                ))
                self.assertEqual(code, 1)
                self.assertIn("FAIL database_url:", output)
                self.assertIn("TLS", output)

    def test_unknown_database_connection_mode_fails_preflight(self):
        code, output = self._run(self._hosted_oauth_env({
            "DATABASE_CONNECTION_MODE": "automatic",
        }))

        self.assertEqual(code, 1)
        self.assertIn(
            "FAIL database_url: DATABASE_CONNECTION_MODE must be url or cloud_sql_iam.",
            output,
        )

    def test_preflight_never_prints_rejected_database_password(self):
        password = "database-password-secret"
        env = self._cloud_sql_env(
            f"postgresql+psycopg://iam-user:{password}@db:5432/planner?sslmode=require"
        )

        code, output = self._run(env)

        self.assertEqual(code, 1)
        self.assertNotIn(password, output)


if __name__ == "__main__":
    unittest.main()
