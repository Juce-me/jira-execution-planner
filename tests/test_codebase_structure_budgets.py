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
    # feature/stats-project-track-quarters adds the bounded epic Project Track phase-duration
    # endpoint: parse_track_transitions + compute_track_phase_durations pure helpers, the
    # ThreadPoolExecutor worker fetch with /changelog pagination, and the
    # get_project_track_phase_durations handler.
    # fix/stats-changelog-dedup adds id-based dedup in _fetch_full_issue_changelog to guard
    # against boundary-record re-inclusion from the paged /changelog endpoint (+10 lines).
    # feat/stats-expose-created-transitions adds created + transitions to _fetch_epic_track_phase
    # return dict so the frontend can compute avg days-to-Committed (+2 lines).
    "jira_server.py": 6188,
    # feature/eng-epic-sort-and-track adds the epic Sort dropdown wiring (engEpicSort state,
    # analytics handler, sorted epicGroups, EngView props) and the title-row priority chevron
    # plus Product Track indicator in renderEpicBlock.
    # feat/stats-project-track-tab adds the Project Track stats sub-tab: filter bar (shared
    # sprint range, capacity-side/mode SegmentedControls, exclusion toggles), mode title, and
    # thin wiring for the totals/per-sprint/breakdown charts memoized off excludedCapacityIssues.
    # feat/stats-project-track-phase adds the Epic-mode-only time-in-phase section:
    # imports ProjectTrackPhaseChart + projectTrackPhaseStats helpers, adds fetch state +
    # cache ref, useEffect with abort/cache, memoized epic key set + summary, and
    # renders the section with loading/error/truncated states (Epic mode only).
    # feat/stats-project-track-analytics wires stats_action/chart_action/filter_changed
    # calls into the Capacity side, Mode, and exclusion-toggle handlers (+27 lines).
    "frontend/src/dashboard.jsx": 15729,
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
