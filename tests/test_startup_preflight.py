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


if __name__ == "__main__":
    unittest.main()
