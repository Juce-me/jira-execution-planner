import re
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SEARCH_FILES = [
    REPO_ROOT / "jira_server.py",
    REPO_ROOT / "backend" / "routes" / "eng_routes.py",
    REPO_ROOT / "backend" / "routes" / "settings_routes.py",
]


class JiraSearchPaginationSourceGuardTests(unittest.TestCase):
    def test_issue_search_payloads_do_not_use_start_at(self):
        offenders = []
        for path in SEARCH_FILES:
            lines = path.read_text(encoding="utf8").splitlines()
            for index, line in enumerate(lines):
                if "jira_search_request(" not in line and "current_jira_search(" not in line:
                    continue
                window = "\n".join(lines[max(0, index - 20):index + 1])
                if re.search(r"['\"]startAt['\"]", window):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{index + 1}")

        self.assertEqual(offenders, [])
