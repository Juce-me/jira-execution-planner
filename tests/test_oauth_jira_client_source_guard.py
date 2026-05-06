import re
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
JIRA_SERVER_PATH = REPO_ROOT / "jira_server.py"

MIGRATED_FILES = [
    REPO_ROOT / "backend" / "routes" / "eng_routes.py",
    REPO_ROOT / "backend" / "routes" / "settings_routes.py",
]

ALLOWED_JIRA_SERVER_SECTIONS = [
    ("def build_jira_headers():", "\ndef build_epm_fields_list"),
    ("@app.route('/api/debug-fields'", "\n\n@app.route('/api/tasks-fields'"),
    ("@app.route('/api/tasks-fields'", "\n\n@app.route('/api/export-excel'"),
]

FORBIDDEN_PATTERNS = [
    re.compile(r'f[\"\']\{JIRA_EMAIL\}:\{JIRA_TOKEN\}[\"\']'),
    re.compile(r'base64\.b64encode\([^\n]+JIRA_(?:EMAIL|TOKEN)', re.MULTILINE),
    re.compile(r'(?:requests|HTTP_SESSION)\.get\(\s*f[\"\']\{JIRA_URL\}/rest/'),
    re.compile(r'(?:requests|HTTP_SESSION)\.post\(\s*f[\"\']\{JIRA_URL\}/rest/'),
    re.compile(r'resilient_jira_get\(\s*f[\"\']\{JIRA_URL\}/rest/'),
]


def source_without_allowed_jira_server_sections():
    source = JIRA_SERVER_PATH.read_text(encoding="utf8")
    for start_marker, end_marker in ALLOWED_JIRA_SERVER_SECTIONS:
        start = source.find(start_marker)
        if start == -1:
            continue
        end = source.find(end_marker, start)
        if end == -1:
            end = len(source)
        source = source[:start] + source[end:]
    return source


class OAuthJiraClientSourceGuardTests(unittest.TestCase):
    def test_migrated_files_do_not_construct_basic_jira_requests(self):
        failures = []
        for path in MIGRATED_FILES:
            source = path.read_text(encoding="utf8")
            for pattern in FORBIDDEN_PATTERNS:
                if pattern.search(source):
                    failures.append(f"{path.relative_to(REPO_ROOT)} matches {pattern.pattern}")

        jira_server_source = source_without_allowed_jira_server_sections()
        for pattern in FORBIDDEN_PATTERNS:
            if pattern.search(jira_server_source):
                failures.append(f"jira_server.py migrated surface matches {pattern.pattern}")

        self.assertEqual(failures, [])

    def test_legacy_build_jira_headers_remains_basic_only_guard(self):
        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        self.assertIn("def build_jira_headers():", source)
        self.assertIn("'route_not_oauth_ready'", source)
