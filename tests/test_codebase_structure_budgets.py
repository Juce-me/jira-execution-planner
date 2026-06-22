import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

LEGACY_ENTRYPOINT_LINE_BUDGETS = {
    # bugfix/ready-to-close-future-sprint-children attaches the authoritative
    # openChildCount to ready-to-close epics (reusing fetch_story_distribution_for_epics)
    # so silent 250-cap truncation can no longer fire the alert on epics with open
    # future-sprint work; counting logic stays in the existing helper.
    "jira_server.py": 5933,
    # EXEC-ad-hoc-capacity-epics adds the Ad Hoc settings selector, classification
    # wiring, and the Lead Times capacity-mix selector; pure logic stays in focused helpers.
    "frontend/src/dashboard.jsx": 15335,
}


def _line_count(path):
    with path.open(encoding="utf-8") as handle:
        return sum(1 for _ in handle)


class CodebaseStructureBudgetTests(unittest.TestCase):
    def test_legacy_entrypoints_do_not_grow(self):
        failures = []
        for relative_path, budget in LEGACY_ENTRYPOINT_LINE_BUDGETS.items():
            path = REPO_ROOT / relative_path
            actual = _line_count(path)
            if actual > budget:
                failures.append(f"{relative_path}: {actual} lines exceeds budget {budget}")

        self.assertEqual(failures, [])


if __name__ == "__main__":
    unittest.main()
