import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class AppStartupTests(unittest.TestCase):
    def test_backend_app_import_does_not_create_global_app(self):
        import backend.app as app_module

        self.assertTrue(callable(app_module.create_app))
        self.assertFalse(hasattr(app_module, "app"))

    def test_jira_server_import_does_not_validate_database_url(self):
        env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"DATABASE_URL", "TEST_DATABASE_URL"}
        }
        env.update({
            "PYTHONPATH": str(REPO_ROOT),
            "CONFIG_STORAGE_BACKEND": "db",
            "JIRA_AUTH_MODE": "basic",
        })
        with tempfile.TemporaryDirectory() as tmpdir:
            result = subprocess.run(
                [sys.executable, "-c", "import jira_server; print('import ok')"],
                cwd=tmpdir,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("import ok", result.stdout)

    def test_startup_validation_still_rejects_db_without_database_url(self):
        import jira_server

        with mock.patch.dict(os.environ, {
            "CONFIG_STORAGE_BACKEND": "db",
        }, clear=True), \
             mock.patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             mock.patch.object(jira_server, "JIRA_URL", "https://example.atlassian.net"), \
             mock.patch.object(jira_server, "JIRA_EMAIL", "user@example.com"), \
             mock.patch.object(jira_server, "JIRA_TOKEN", "token"):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_startup_auth_config()

        self.assertEqual(raised.exception.code, "config_storage_invalid")


if __name__ == "__main__":
    unittest.main()
