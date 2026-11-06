"""Regression coverage for completed work satisfying a Team's quarter requirement."""

import unittest

from backend.services.story_readiness import project_story_readiness


def readiness(status="Done", sprint_ids=None, team_ids=None, sprint_state="active"):
    return project_story_readiness({
        "status": "complete",
        "canonicalSprint": {"id": "42", "name": "2026Q4", "state": sprint_state},
        "groupSnapshot": {"id": "department", "revision": 1, "teams": [
            {"id": "team-a", "name": "Alpha", "labels": ["team_alpha"]},
            {"id": "team-b", "name": "Beta", "labels": ["team_beta"]},
        ]},
        "projectAccessSnapshot": {"product": "accessible", "tech": "accessible"},
        "epics": [{
            "key": "TEST-1", "summary": "Synthetic delivery", "status": {"name": "In Progress"},
            "labels": ["team_alpha", "team_beta"], "projectKey": "TEST", "projectClass": "product",
        }],
        "children": [{
            "key": "TEST-2", "epicKey": "TEST-1", "statusName": status,
            "sprintIds": ["42"] if sprint_ids is None else sprint_ids,
            "teamIds": ["team-a"] if team_ids is None else team_ids,
        }],
    })


class CompletedStoryReadinessTests(unittest.TestCase):
    def test_done_story_covers_its_team_in_selected_quarter(self):
        for state in ("active", "future"):
            for status in ("Done", " DONE "):
                with self.subTest(state=state, status=status):
                    self.assertEqual(readiness(status=status, sprint_state=state)["epics"][0]["missingTeams"], [
                        {"id": "team-b", "name": "Beta", "reason": "team_uncovered"},
                    ])

    def test_done_story_covering_all_expected_teams_removes_epic_alert(self):
        self.assertEqual(readiness(team_ids=["team-a", "team-b"])["epics"], [])

    def test_done_story_in_another_quarter_does_not_cover_selected_quarter(self):
        self.assertEqual(readiness(sprint_ids=["99"])["epics"][0]["missingTeams"][0], {
            "id": "team-a", "name": "Alpha", "reason": "stories_outside_sprint",
        })

    def test_blocked_killed_and_incomplete_stories_still_need_action(self):
        for status in ("Blocked", "Killed", "Incomplete"):
            with self.subTest(status=status):
                self.assertEqual(readiness(status=status)["epics"][0]["missingTeams"][0], {
                    "id": "team-a", "name": "Alpha", "reason": "selected_stories_not_actionable",
                })
