"""
Test case for PRODUCT-33712: Active Sprint anchor + dependency visualization.

This test verifies that the scheduler correctly handles Active Sprint scenarios:
- Non-done tasks (Accepted, To Do, Blocked) must anchor to TODAY or later
- Done/Killed tasks can remain at sprint start (before TODAY)
- Dependencies are respected (dependents start after prerequisites end)
- All scheduled issues have valid start/end dates (no None values)

IMPORTANT: This test uses real Jira data from scenario-example.json.
Keep this file LOCAL ONLY - never commit to public repo.
"""

import json
import datetime as dt
import unittest
from pathlib import Path

from planning.models import Issue, ScenarioConfig
from planning.scheduler import schedule_issues


# Test constants
TODAY = dt.date(2026, 1, 29)
SPRINT_START = dt.date(2026, 1, 1)
EPIC_KEYS = {"TEST-101", "TEST-102", "TEST-103", "TEST-104"}

# Expected statuses for each issue (from fixture):
# TEST-101: Accepted
# TEST-102: Done
# TEST-103: To Do
# TEST-104: Blocked (or similar non-done status)


def _load_fixture():
    """Load scenario-example.json fixture and extract PRODUCT-33712 epic issues."""
    # Try real fixture first, fall back to sanitized version
    fixture_paths = [
        Path(__file__).parent / "fixtures" / "scenario-example.json",
        Path(__file__).parent / "fixtures" / "scenario-example-sanitized.json",
    ]

    fixture_path = None
    for path in fixture_paths:
        if path.exists():
            fixture_path = path
            break

    if not fixture_path:
        raise FileNotFoundError(
            f"Fixture not found. Tried:\n"
            f"  - {fixture_paths[0]} (real data)\n"
            f"  - {fixture_paths[1]} (sanitized)\n"
            "Using sanitized fixture for testing."
        )

    with open(fixture_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    # Extract issues and dependencies for the epic
    raw_issues = payload.get("data", {}).get("issues", [])
    raw_deps = payload.get("data", {}).get("dependencies", [])

    # Filter to only PRODUCT-33712 epic issues
    issues = [i for i in raw_issues if i["key"] in EPIC_KEYS]

    # Filter dependencies where both from/to are in our epic
    dependencies_list = [
        d for d in raw_deps
        if d.get("from") in EPIC_KEYS or d.get("to") in EPIC_KEYS
    ]

    return issues, dependencies_list


def _convert_to_issue_objects(raw_issues):
    """Convert fixture JSON issues to Issue model objects."""
    result = []
    for raw in raw_issues:
        issue = Issue(
            key=raw["key"],
            summary=raw.get("summary", ""),
            issue_type=raw.get("type", "Story"),
            team=raw.get("team"),
            assignee=raw.get("assignee"),
            story_points=raw.get("sp"),
            priority=raw.get("priority", "Medium"),
            status=raw.get("status", "To Do"),
            epic_key=raw.get("epicKey"),
        )
        result.append(issue)
    return result


def _convert_to_dependency_dict(dependencies_list):
    """Convert fixture dependency list to Dict[str, List[str]] format."""
    dep_dict = {}
    for d in dependencies_list:
        from_key = d.get("from")
        to_key = d.get("to")
        if to_key:
            if to_key not in dep_dict:
                dep_dict[to_key] = []
            dep_dict[to_key].append(from_key)
    return dep_dict


class TestProduct33712ActiveSprintAnchor(unittest.TestCase):
    """
    Test PRODUCT-33712 epic scheduling in Active Sprint mode.

    Verifies that:
    1. All 4 issues get valid start/end dates (not None)
    2. Non-done issues (Accepted, To Do, Blocked) are anchored to TODAY or later
    3. Done issues can remain at sprint start (before TODAY)
    4. Dependencies are respected (dependent starts after prerequisite ends)
    """

    def test_product_33712_active_sprint_anchor_and_dates_not_null(self):
        """
        Main test: Verify Active Sprint scheduling for PRODUCT-33712.

        Expected behavior:
        - TEST-101 (Accepted): start >= TODAY
        - TEST-102 (Done): start <= TODAY (anchored at sprint start)
        - TEST-103 (To Do): start >= TODAY
        - TEST-104 (Blocked): start >= TODAY
        - All issues: start and end are not None
        - Dependencies: dependent.start >= prerequisite.end
        """
        raw_issues, raw_deps = _load_fixture()

        # Convert to model objects
        issues = _convert_to_issue_objects(raw_issues)
        dependencies = _convert_to_dependency_dict(raw_deps)

        # Create scenario config with Active Sprint anchor
        config = ScenarioConfig(
            start_date=SPRINT_START,
            quarter_end_date=dt.date(2026, 3, 31),
            anchor_date=TODAY,  # Active Sprint: anchor non-done tasks to TODAY
            sp_to_weeks=2.0,
            team_sizes={},
            vacation_weeks={},
            sickleave_buffer=0.0,
            wip_limit=1,
            lane_mode="team",
        )

        # Schedule the issues
        scheduled_list, scheduled_map = schedule_issues(issues, dependencies, config)

        # Build lookup by key
        by_key = {item.key: item for item in scheduled_list}

        # Verify all 4 issues are present
        for key in EPIC_KEYS:
            self.assertIn(key, by_key, f"Issue {key} not in scheduled results")

        # 1) All issues must have non-null start/end dates
        for key in EPIC_KEYS:
            issue = by_key[key]
            self.assertIsNotNone(
                issue.start_date,
                f"{key} has null start_date (this causes bars to 'teleport' in UI)"
            )
            self.assertIsNotNone(
                issue.end_date,
                f"{key} has null end_date (this causes edges to land in wrong positions)"
            )

        # 2) Non-done issues (Accepted, To Do, Blocked) must anchor to TODAY or later
        # Active Sprint: anchor_date clamps TODO-like statuses (Accepted included) to TODAY
        non_done_keys = ["TEST-101", "TEST-103", "TEST-104"]
        for key in non_done_keys:
            issue = by_key[key]
            self.assertGreaterEqual(
                issue.start_date, TODAY,
                f"{key} ({issue.scheduled_reason}) starts before TODAY: {issue.start_date} < {TODAY}"
            )
            self.assertGreaterEqual(
                issue.end_date, issue.start_date,
                f"{key} ends before start: {issue.start_date} -> {issue.end_date}"
            )

        # 3) Done issue (TEST-102) can be anchored at sprint start (before TODAY)
        done_issue = by_key["TEST-102"]
        self.assertLessEqual(
            done_issue.start_date, TODAY,
            f"Done issue {done_issue.key} should be anchored at sprint start, not after TODAY"
        )

        # 4) Dependency order: dependent must start after prerequisite ends
        # Edges must never render when endpoints are missing
        for to_key, from_keys in dependencies.items():
            if to_key not in by_key:
                continue
            dependent = by_key[to_key]
            for from_key in from_keys:
                if from_key not in by_key:
                    continue
                prerequisite = by_key[from_key]

                # Skip if either has no dates (unschedulable)
                if not prerequisite.end_date or not dependent.start_date:
                    continue

                self.assertGreaterEqual(
                    dependent.start_date, prerequisite.end_date,
                    f"Dependency violated: {from_key} -> {to_key}: "
                    f"prerequisite ends {prerequisite.end_date} but dependent starts {dependent.start_date}"
                )

    def test_accepted_status_treated_as_todo(self):
        """
        Verify that 'Accepted' status is treated as TODO (not done, not in-progress).

        This ensures Accepted tasks get anchored to TODAY in Active Sprint mode.
        """
        raw_issues, raw_deps = _load_fixture()
        issues = _convert_to_issue_objects(raw_issues)
        dependencies = _convert_to_dependency_dict(raw_deps)

        config = ScenarioConfig(
            start_date=SPRINT_START,
            quarter_end_date=dt.date(2026, 3, 31),
            anchor_date=TODAY,
            sp_to_weeks=2.0,
            team_sizes={},
            vacation_weeks={},
            sickleave_buffer=0.0,
            wip_limit=1,
            lane_mode="team",
        )

        scheduled_list, _ = schedule_issues(issues, dependencies, config)
        by_key = {item.key: item for item in scheduled_list}

        # TEST-101 is the Accepted issue
        accepted_issue = by_key.get("TEST-101")
        if accepted_issue:
            # Must not be treated as done
            self.assertNotEqual(
                accepted_issue.scheduled_reason, "already_done",
                "Accepted status should not be treated as done"
            )
            # Must not be treated as in-progress
            self.assertNotEqual(
                accepted_issue.scheduled_reason, "in_progress",
                "Accepted status should not be treated as in-progress"
            )
            # Must be anchored to TODAY
            self.assertGreaterEqual(
                accepted_issue.start_date, TODAY,
                f"Accepted issue must start on/after TODAY, got {accepted_issue.start_date}"
            )


if __name__ == "__main__":
    unittest.main()
