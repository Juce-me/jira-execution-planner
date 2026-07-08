from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
HOSTED_ENV_TERMS = (
    "PORT=5050",
    "TOKEN_ENCRYPTION_KEY_SOURCE=env",
    "LOCAL_FILE_STATE_ENABLED=false",
    "SESSION_COOKIE_SECURE=true",
    "APP_ALLOWED_ORIGINS",
    "ATLASSIAN_REDIRECT_URI",
    "RUN_DB_MIGRATIONS",
    "JIRA_URL",
)

FORBIDDEN_DB_OAUTH_EPM_ENV_NAMES = (
    "JIRA_" + "EMAIL",
    "JIRA_" + "TOKEN",
    "ATLASSIAN_" + "EMAIL",
    "ATLASSIAN_" + "API_" + "TOKEN",
)


def _section(text, heading):
    start = text.index(heading)
    next_heading = text.find("\n## ", start + len(heading))
    if next_heading == -1:
        return text[start:]
    return text[start:next_heading]


def _strip_code_blocks(text):
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


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

    def test_hosted_container_env_contract_is_documented(self):
        docs = (
            REPO_ROOT / ".env.example",
            REPO_ROOT / "README.md",
            REPO_ROOT / "INSTALL.md",
        )

        for path in docs:
            text = path.read_text(encoding="utf8")
            for env_term in HOSTED_ENV_TERMS:
                with self.subTest(path=path.relative_to(REPO_ROOT), env_term=env_term):
                    self.assertIn(env_term, text)

    def test_hosted_db_oauth_sections_do_not_tell_users_to_set_basic_credentials(self):
        section_by_path = {
            REPO_ROOT / "README.md": "## Internal Hosting",
            REPO_ROOT / "INSTALL.md": "## 8. Internal Hosting",
            REPO_ROOT / ".env.example": "# Container/internal hosting profile",
        }

        offenders = []
        for path, heading in section_by_path.items():
            hosted_section = _section(path.read_text(encoding="utf8"), heading)
            for env_name in FORBIDDEN_DB_OAUTH_EPM_ENV_NAMES:
                if env_name in hosted_section:
                    offenders.append(f"{path.relative_to(REPO_ROOT)} hosted section contains {env_name}")

        self.assertEqual(offenders, [])

    def test_oauth_setup_doc_documents_write_scope_and_global_reauth_impact(self):
        doc_path = REPO_ROOT / "docs" / "SUPPORT-atlassian-oauth-setup.md"
        text = doc_path.read_text(encoding="utf8")
        lower = text.lower()
        prose = _strip_code_blocks(text).lower()

        # The scope must be documented in the Developer Console permissions
        # table/prose, not only inside the ATLASSIAN_SCOPES env code block.
        self.assertIn("write:jira-work", prose)
        self.assertGreaterEqual(lower.count("write:jira-work"), 2)

        # Must explicitly state the scope forces re-auth for every signed-in
        # user (including read-only users), not only users attempting a write.
        # The doc mentions "signed-in" more than once (existing OAuth-session
        # prose plus the new re-auth-impact note), so check every occurrence
        # for a nearby "re-authenticate" instead of assuming the first match.
        signed_in_positions = [match.start() for match in re.finditer("signed-in", prose)]
        self.assertTrue(signed_in_positions)
        self.assertTrue(any(
            "re-authenticate" in prose[max(0, position - 200):position + 200]
            for position in signed_in_positions
        ))

    def test_install_doc_names_user_home_token_storage_boundaries(self):
        install_doc = (REPO_ROOT / "INSTALL.md").read_text(encoding="utf8")

        self.assertIn("Settings -> Connections", install_doc)
        self.assertIn("atlassian_user_api_token", install_doc)
        self.assertIn("auth_tokens", install_doc)
        self.assertIn("service_integration_tokens", install_doc)
        self.assertIn("user view config", install_doc)


if __name__ == "__main__":
    unittest.main()
