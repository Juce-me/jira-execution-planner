"""Scenario guards for Ad Hoc capacity.

Ad Hoc capacity is INCLUDED Product capacity. It must be scheduled as normal
work. Only ``excluded_capacity_epics`` (never Ad Hoc) may divert issues into the
fixed-window ``scheduled_reason='excluded_capacity'`` placeholder branch.
"""

import datetime as dt
import re
import unittest
from pathlib import Path

from planning.models import Issue, ScenarioConfig
from planning.scheduler import schedule_issues


REPO_ROOT = Path(__file__).resolve().parents[1]
JIRA_SERVER_SOURCE = (REPO_ROOT / "jira_server.py").read_text(encoding="utf-8")


def _scenario_route_source(source):
    """Return only the Scenario route body so guards do not match unrelated routes.

    Ad Hoc capacity is consumed by other read-only routes (e.g. the Lead Times
    cohort route); these guards are about the Scenario scheduling route alone.
    """
    start = source.index("def scenario_planner():")
    end = source.index("def get_scenario_overrides():", start)
    return source[start:end]


SCENARIO_ROUTE_SOURCE = _scenario_route_source(JIRA_SERVER_SOURCE)


class TestScenarioExcludedCapacitySource(unittest.TestCase):
    def test_excluded_capacity_branch_is_gated_only_on_excluded_epics(self):
        """The placeholder branch keys off excluded_capacity_epics, not Ad Hoc."""
        self.assertIn(
            "excluded_capacity_epics_raw = config_payload.get('excluded_capacity_epics')",
            SCENARIO_ROUTE_SOURCE,
            "Scenario route must read excluded_capacity_epics from the config payload",
        )
        # The placeholder reason must be reachable only when an issue's epic is in
        # the excluded set; no Ad Hoc term may gate that branch.
        scenario_split = SCENARIO_ROUTE_SOURCE[
            SCENARIO_ROUTE_SOURCE.index("excluded_capacity_epics_raw =") :
            SCENARIO_ROUTE_SOURCE.index("scheduled_reason='excluded_capacity'") + 80
        ]
        self.assertIn("epic in excluded_epic_set", scenario_split)
        self.assertNotRegex(
            scenario_split,
            re.compile(r"ad[_ ]?hoc", re.IGNORECASE),
            "Ad Hoc keys must never gate the excluded_capacity placeholder branch",
        )

    def test_scenario_payload_reader_has_no_ad_hoc_field(self):
        """The scenario route must not consume an Ad Hoc field from the payload."""
        self.assertNotIn("ad_hoc_capacity_epics", SCENARIO_ROUTE_SOURCE.lower())


class TestAdHocIssuesScheduledNormally(unittest.TestCase):
    def test_ad_hoc_epic_issue_is_scheduled_as_normal_work(self):
        """An issue under an Ad Hoc epic (not excluded) schedules as normal work."""
        config = ScenarioConfig(
            start_date=dt.date(2026, 1, 1),
            quarter_end_date=dt.date(2026, 3, 31),
            sp_to_weeks=2.0,
            team_sizes={},
            vacation_weeks={},
            sickleave_buffer=0.0,
            wip_limit=1,
            lane_mode="team",
        )
        # This issue lives under an Ad Hoc epic. Because the scenario route never
        # places Ad Hoc epics in excluded_epic_set, it reaches schedule_issues like
        # any other story.
        issues = [
            Issue(
                key="TECH-1",
                summary="Ad Hoc work item",
                issue_type="Story",
                team="Team A",
                assignee="dev-a",
                story_points=3.0,
                priority="Medium",
                status="To Do",
                epic_key="ADHOC-1",
            )
        ]

        scheduled_list, _ = schedule_issues(issues, {}, config)
        by_key = {item.key: item for item in scheduled_list}

        self.assertIn("TECH-1", by_key)
        item = by_key["TECH-1"]
        self.assertNotEqual(
            item.scheduled_reason,
            "excluded_capacity",
            "Ad Hoc issues must not be treated as excluded-capacity placeholders",
        )
        self.assertEqual(item.scheduled_reason, "scheduled")
        self.assertIsNotNone(item.start_date)
        self.assertIsNotNone(item.end_date)


if __name__ == "__main__":
    unittest.main()
