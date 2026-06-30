import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

LEGACY_ENTRYPOINT_LINE_BUDGETS = {
    # feature/eng-epic-sort-and-track adds the read-only Project Track custom-field getters
    # (get_project_track_field_config/get_project_track_field_id) and threads the field id
    # into fetch_epic_details_bulk's fields list + parse.
    # bugfix/jira-connect-timeout-retry-budget adds JIRA_HTTP_CONNECT_TIMEOUT_SECONDS and
    # threads a bounded connect_timeout through the resilient_jira_get wrapper.
    # feat/stats-epic-project-track-assignee enriches fetch_cached_excluded_capacity_epic_summaries
    # and build_excluded_capacity_issue_payload with epicProjectTrack and epicAssignee.
    "jira_server.py": 5984,
    # feature/eng-epic-sort-and-track adds the epic Sort dropdown wiring (engEpicSort state,
    # analytics handler, sorted epicGroups, EngView props) and the title-row priority chevron
    # plus Product Track indicator in renderEpicBlock.
    "frontend/src/dashboard.jsx": 15419,
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
