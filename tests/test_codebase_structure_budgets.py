import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

LEGACY_ENTRYPOINT_LINE_BUDGETS = {
    # bugfix/needs-stories-per-team breaks the selected-sprint actionable count down by
    # team (selectedActionableByTeam) in fetch_story_distribution_for_epics, threading the
    # team field through and attaching the breakdown to each scoped epic.
    "jira_server.py": 5948,
    # bugfix/needs-stories-per-team fans Needs Stories entries out per matched team via
    # buildNeedsStoriesTeamEntries, dedupes the epic chip count, and links each team header
    # to a semantic JQL filter (buildNeedsStoriesTeamLink) instead of a frozen key list.
    "frontend/src/dashboard.jsx": 15395,
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
