from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DOC_PATHS = [
    REPO_ROOT / ".env.example",
    REPO_ROOT / "README.md",
    REPO_ROOT / "INSTALL.md",
    REPO_ROOT / "docs" / "SUPPORT-atlassian-oauth-setup.md",
    REPO_ROOT / "docs" / "plans" / "README.md",
    REPO_ROOT / "AGENTS.md",
]

FORBIDDEN_DB_OAUTH_EPM_ENV_NAMES = (
    "JIRA_" + "EMAIL",
    "JIRA_" + "TOKEN",
    "ATLASSIAN_" + "EMAIL",
    "ATLASSIAN_" + "API_" + "TOKEN",
)


class EnvConfigDocsTests(unittest.TestCase):
    def test_security_fixed_http_stack_requires_python_310_or_newer(self):
        pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf8")
        workflow = (REPO_ROOT / ".github" / "workflows" / "verify-frontend-build.yml").read_text(encoding="utf8")

        self.assertIn('requires-python = ">=3.10"', pyproject)
        self.assertIn('"3.10"', workflow)
        self.assertNotIn('"3.9"', workflow)

    def test_requirements_pin_security_fixed_urllib3_and_document_openssl_runtime(self):
        requirements = (REPO_ROOT / "requirements.txt").read_text(encoding="utf8").splitlines()
        urllib3_pins = [
            line.strip()
            for line in requirements
            if line.strip().lower().startswith("urllib3==")
        ]

        self.assertEqual(urllib3_pins, ["urllib3==2.7.0"])
        for doc_path in (REPO_ROOT / "README.md", REPO_ROOT / "INSTALL.md", REPO_ROOT / "AGENTS.md"):
            with self.subTest(path=doc_path.name):
                text = doc_path.read_text(encoding="utf8")
                self.assertIn("OpenSSL 1.1.1+", text)
                self.assertIn("LibreSSL", text)

    def test_db_oauth_epm_docs_do_not_reference_basic_credential_env_names(self):
        offenders = []
        for path in DOC_PATHS:
            text = path.read_text(encoding="utf8")
            for env_name in FORBIDDEN_DB_OAUTH_EPM_ENV_NAMES:
                if env_name in text:
                    offenders.append(f"{path.relative_to(REPO_ROOT)} contains {env_name}")

        self.assertEqual(offenders, [])

    def test_install_doc_names_user_home_token_storage_boundaries(self):
        install_doc = (REPO_ROOT / "INSTALL.md").read_text(encoding="utf8")

        self.assertIn("Settings -> Connections", install_doc)
        self.assertIn("atlassian_user_api_token", install_doc)
        self.assertIn("auth_tokens", install_doc)
        self.assertIn("service_integration_tokens", install_doc)
        self.assertIn("user view config", install_doc)


if __name__ == "__main__":
    unittest.main()
