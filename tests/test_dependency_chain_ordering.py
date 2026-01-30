"""
Test dependency chain ordering.

Verifies that tasks are scheduled in correct dependency order:
- Prerequisite tasks scheduled before dependent tasks
- "Depends on" link means "is blocked by" (prerequisite must finish first)
- Linear chains flow left-to-right on timeline

Example chain: A → B → C → D
- A (Done): At sprint start (before TODAY)
- B (Accepted): Depends on A, starts after A ends
- C (To Do): Depends on B, starts after B ends
- D (Blocked): Depends on A, B, C - starts after all finish
"""

import datetime as dt
import unittest

from planning.models import Issue, ScenarioConfig
from planning.scheduler import schedule_issues


class TestDependencyChainOrdering(unittest.TestCase):
    """Test that dependency chains schedule in correct linear order."""

    def test_linear_dependency_chain_with_done_prerequisite(self):
        """
        Test linear dependency chain: Done → Accepted → To Do → Blocked

        Chain structure:
        - TASK-A (Done): Completed at sprint start
        - TASK-B (Accepted): Depends on A
        - TASK-C (To Do): Depends on B
        - TASK-D (Blocked): Depends on A, B, C

        Expected timeline order (left to right):
        TASK-A (before TODAY) → TASK-B (at/after TODAY) → TASK-C → TASK-D
        """
        TODAY = dt.date(2026, 1, 30)
        SPRINT_START = dt.date(2026, 1, 1)

        issues = [
            Issue(
                key="TASK-A",
                summary="Foundation task (completed)",
                issue_type="Story",
                team="Team Alpha",
                assignee="alice",
                story_points=0.3,
                priority="Major",
                status="Done"
            ),
            Issue(
                key="TASK-B",
                summary="Second task (accepted)",
                issue_type="Story",
                team="Team Alpha",
                assignee="bob",
                story_points=0.2,
                priority="Major",
                status="Accepted"
            ),
            Issue(
                key="TASK-C",
                summary="Third task (to do)",
                issue_type="Story",
                team="Team Alpha",
                assignee="charlie",
                story_points=0.1,
                priority="Major",
                status="To Do"
            ),
            Issue(
                key="TASK-D",
                summary="Final task (blocked)",
                issue_type="Story",
                team="Team Alpha",  # Same team to enforce sequential scheduling
                assignee="diana",
                story_points=0.5,
                priority="Major",
                status="Blocked"
            ),
        ]

        # Dependency structure: "TASK-X depends on TASK-Y" means Y is prerequisite
        # In Dict format: dependent_key → [prerequisite_keys]
        # This creates a LINEAR chain: A → B → C → D
        dependencies = {
            "TASK-B": ["TASK-A"],  # B depends on A (A must finish first)
            "TASK-C": ["TASK-B"],  # C depends on B (B must finish first)
            "TASK-D": ["TASK-C"],  # D depends on C (C must finish first)
        }

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

        scheduled_list, scheduled_map = schedule_issues(issues, dependencies, config)

        # Verify all tasks scheduled
        for key in ["TASK-A", "TASK-B", "TASK-C", "TASK-D"]:
            self.assertIn(key, scheduled_map)
            self.assertIsNotNone(scheduled_map[key].start_date)
            self.assertIsNotNone(scheduled_map[key].end_date)

        # Verify ordering: A before TODAY, B/C/D at/after TODAY
        task_a = scheduled_map["TASK-A"]
        task_b = scheduled_map["TASK-B"]
        task_c = scheduled_map["TASK-C"]
        task_d = scheduled_map["TASK-D"]

        # A is Done, should be at sprint start (before TODAY)
        self.assertEqual(task_a.start_date, SPRINT_START)
        self.assertLessEqual(task_a.end_date, TODAY)

        # B, C, D are non-done, should be at/after TODAY
        self.assertGreaterEqual(task_b.start_date, TODAY)
        self.assertGreaterEqual(task_c.start_date, TODAY)
        self.assertGreaterEqual(task_d.start_date, TODAY)

        # Verify linear ordering: A → B → C → D
        self.assertGreaterEqual(task_b.start_date, task_a.end_date,
                                "TASK-B must start after TASK-A ends")
        self.assertGreaterEqual(task_c.start_date, task_b.end_date,
                                "TASK-C must start after TASK-B ends")
        self.assertGreaterEqual(task_d.start_date, task_c.end_date,
                                "TASK-D must start after TASK-C ends")

        # Print timeline for visualization
        print("\n✅ Linear dependency chain verified:")
        print(f"  TASK-A (Done):    {task_a.start_date} to {task_a.end_date}")
        print(f"  TASK-B (Accepted): {task_b.start_date} to {task_b.end_date}")
        print(f"  TASK-C (To Do):    {task_c.start_date} to {task_c.end_date}")
        print(f"  TASK-D (Blocked):  {task_d.start_date} to {task_d.end_date}")
        print(f"  TODAY: {TODAY}")

    def test_dependency_direction_semantics(self):
        """
        Verify dependency direction: 'depends on' means 'is blocked by'.

        If TASK-B depends on TASK-A:
        - TASK-A is the prerequisite (blocker)
        - TASK-B is the dependent (blocked)
        - TASK-A must finish BEFORE TASK-B starts
        - Timeline: TASK-A (left) → TASK-B (right)

        In API format: dependencies[dependent] = [prerequisite]
        """
        TODAY = dt.date(2026, 1, 30)

        issues = [
            Issue(key="PREREQ", summary="Prerequisite", issue_type="Story",
                  team="Team", assignee=None, story_points=1.0, priority="High", status="To Do"),
            Issue(key="DEPEND", summary="Dependent", issue_type="Story",
                  team="Team", assignee=None, story_points=1.0, priority="High", status="To Do"),
        ]

        # DEPEND depends on PREREQ (PREREQ must finish first)
        dependencies = {"DEPEND": ["PREREQ"]}

        config = ScenarioConfig(
            start_date=TODAY,
            quarter_end_date=dt.date(2026, 3, 31),
            anchor_date=TODAY,
            sp_to_weeks=1.0,
        )

        _, scheduled_map = schedule_issues(issues, dependencies, config)

        prereq = scheduled_map["PREREQ"]
        depend = scheduled_map["DEPEND"]

        # Verify: prerequisite finishes before dependent starts
        self.assertGreaterEqual(
            depend.start_date, prereq.end_date,
            "Dependent task must start AFTER prerequisite ends"
        )

        print(f"\n✅ Dependency direction verified:")
        print(f"  PREREQ: {prereq.start_date} to {prereq.end_date}")
        print(f"  DEPEND: {depend.start_date} to {depend.end_date}")
        print(f"  Gap: {(depend.start_date - prereq.end_date).days} days")


if __name__ == "__main__":
    unittest.main()
