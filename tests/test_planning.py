import unittest
from datetime import date

from planning.models import Issue, ScenarioConfig
from planning.scheduler import schedule_issues


class PlanningSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.config = ScenarioConfig(
            start_date=date(2026, 1, 1),
            quarter_end_date=date(2026, 3, 31),
            sp_to_weeks=1.0,
            team_sizes={"Alpha": 1},
            vacation_weeks={},
            sickleave_buffer=0.0,
            wip_limit=1,
            lane_mode="team",
        )

    def test_dependency_ordering(self):
        issues = [
            Issue(key="A", summary="A", issue_type="Story", team="Alpha", assignee=None, story_points=1, priority="High", status="To Do"),
            Issue(key="B", summary="B", issue_type="Story", team="Alpha", assignee=None, story_points=1, priority="High", status="To Do"),
        ]
        dependencies = {"B": ["A"]}
        scheduled, scheduled_map = schedule_issues(issues, dependencies, self.config)
        a = scheduled_map["A"]
        b = scheduled_map["B"]
        self.assertLessEqual(a.end_date, b.start_date)

    def test_capacity_leveling_wip(self):
        issues = [
            Issue(key="A", summary="A", issue_type="Story", team="Alpha", assignee=None, story_points=2, priority="High", status="To Do"),
            Issue(key="B", summary="B", issue_type="Story", team="Alpha", assignee=None, story_points=2, priority="High", status="To Do"),
        ]
        dependencies = {}
        scheduled, scheduled_map = schedule_issues(issues, dependencies, self.config)
        a = scheduled_map["A"]
        b = scheduled_map["B"]
        self.assertLessEqual(a.end_date, b.start_date)

        config_parallel = ScenarioConfig(
            start_date=self.config.start_date,
            quarter_end_date=self.config.quarter_end_date,
            sp_to_weeks=1.0,
            team_sizes={"Alpha": 1},
            vacation_weeks={},
            sickleave_buffer=0.0,
            wip_limit=2,
            lane_mode="team",
        )
        scheduled_parallel, scheduled_map_parallel = schedule_issues(issues, dependencies, config_parallel)
        a_parallel = scheduled_map_parallel["A"]
        b_parallel = scheduled_map_parallel["B"]
        self.assertEqual(a_parallel.start_date, b_parallel.start_date)

    def test_priority_ordering(self):
        issues = [
            Issue(key="A", summary="A", issue_type="Story", team="Alpha", assignee=None, story_points=1, priority="Critical", status="To Do"),
            Issue(key="B", summary="B", issue_type="Story", team="Alpha", assignee=None, story_points=1, priority="Low", status="To Do"),
        ]
        dependencies = {}
        scheduled, scheduled_map = schedule_issues(issues, dependencies, self.config)
        a = scheduled_map["A"]
        b = scheduled_map["B"]
        self.assertLessEqual(a.start_date, b.start_date)

    def test_missing_story_points(self):
        issues = [
            Issue(key="A", summary="A", issue_type="Story", team="Alpha", assignee=None, story_points=None, priority="High", status="To Do"),
        ]
        dependencies = {}
        scheduled, _ = schedule_issues(issues, dependencies, self.config)
        unscheduled = next(item for item in scheduled if item.key == "A")
        self.assertEqual(unscheduled.scheduled_reason, "missing_story_points")

    def test_missing_dependency(self):
        issues = [
            Issue(key="A", summary="A", issue_type="Story", team="Alpha", assignee=None, story_points=1, priority="High", status="To Do"),
        ]
        dependencies = {"A": ["Z"]}
        scheduled, _ = schedule_issues(issues, dependencies, self.config)
        unscheduled = next(item for item in scheduled if item.key == "A")
        self.assertEqual(unscheduled.scheduled_reason, "missing_dependency")


if __name__ == "__main__":
    unittest.main()
