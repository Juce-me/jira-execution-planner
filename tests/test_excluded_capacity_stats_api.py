import unittest
from unittest.mock import patch

import jira_server


class FakeJiraResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


class ExcludedCapacityStatsApiTests(unittest.TestCase):
    def test_excluded_capacity_source_fetches_range_with_next_page_token_contract(self):
        sprint_field = "customfield_sprint"
        team_field = "customfield_team"
        epic_field = "customfield_epic"
        story_points_field = "customfield_sp"
        base_issue = {
            "id": "10001",
            "key": "SYN-1",
            "fields": {
                "summary": "Synthetic ad hoc task",
                "status": {"name": "Done"},
                "priority": {"name": "Major"},
                "issuetype": {"name": "Story"},
                "assignee": {"displayName": "Synthetic Owner"},
                "updated": "2026-01-10T00:00:00.000+0000",
                story_points_field: 3,
                sprint_field: [{"id": 101, "name": "2025Q4 Sprint 1"}],
                epic_field: "BAU-1",
                team_field: {"id": "team-alpha", "name": "Alpha"},
                "parent": {},
                "project": {"key": "SYN", "name": "Synthetic Project"},
                "issuelinks": [
                    {
                        "type": {"name": "Dependency", "outward": "depends on", "inward": "is depended on by"},
                        "outwardIssue": {"key": "SYN-9", "fields": {"summary": "Synthetic linked task"}}
                    }
                ],
            },
        }
        linked_issue = {
            "id": "10009",
            "key": "SYN-9",
            "fields": {
                "summary": "Synthetic linked task",
                "status": {"name": "To Do"},
                "priority": {"name": "Major"},
                "issuetype": {"name": "Story"},
                story_points_field: 2,
                sprint_field: [{"id": 101, "name": "2025Q4 Sprint 1"}],
                epic_field: "PLAN-1",
                team_field: {"id": "team-beta", "name": "Beta"},
                "parent": {},
                "project": {"key": "SYN", "name": "Synthetic Project"},
                "issuelinks": [],
            },
        }

        bau_epic = {
            "id": "20001",
            "key": "BAU-1",
            "fields": {"summary": "BAU Workstream"},
        }

        responses = [
            FakeJiraResponse({
                "issues": [base_issue],
                "names": {
                    team_field: "Team[Team]",
                    epic_field: "Epic Link",
                    sprint_field: "Sprint",
                    story_points_field: "Story Points",
                },
                "isLast": True,
            }),
            FakeJiraResponse({
                "issues": [linked_issue],
                "names": {
                    team_field: "Team[Team]",
                    epic_field: "Epic Link",
                    sprint_field: "Sprint",
                    story_points_field: "Story Points",
                },
                "isLast": True,
            }),
            FakeJiraResponse({
                "issues": [bau_epic],
                "isLast": True,
            }),
        ]

        with jira_server.app.test_client() as client, \
             patch.object(jira_server, "TASKS_CACHE", {}), \
             patch.object(jira_server, "JQL_QUERY_TEMPLATE", ""), \
             patch.object(jira_server, "build_base_jql", return_value='project = "SYN"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=["Story"]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=team_field), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=epic_field), \
             patch.object(jira_server, "get_sprint_field_id", return_value=sprint_field), \
             patch.object(jira_server, "get_story_points_field_id", return_value=story_points_field), \
             patch.object(jira_server, "jira_search_request", side_effect=responses) as mock_search:
            response = client.post(
                "/api/stats/excluded-capacity-source",
                json={"sprintIds": ["101", "102"], "teamIds": ["team-alpha"]},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()["data"]
        self.assertEqual(payload["meta"]["paginationMode"], "nextPageToken/isLast")
        self.assertEqual(payload["issues"][0]["key"], "SYN-1")
        self.assertEqual(payload["issues"][0]["fields"]["epicKey"], "BAU-1")
        self.assertEqual(payload["issues"][0]["fields"]["epicSummary"], "BAU Workstream")
        self.assertEqual(payload["issues"][0]["fields"]["teamId"], "team-alpha")
        self.assertEqual(payload["dependencies"]["SYN-1"][0]["teamId"], "team-beta")

        first_search_payload = mock_search.call_args_list[0].args[1]
        self.assertIn("Sprint in (101, 102)", first_search_payload["jql"])
        self.assertIn('"Team[Team]" = "team-alpha"', first_search_payload["jql"])
        self.assertNotIn("startAt", first_search_payload)

    def test_excluded_capacity_source_requires_sprint_ids(self):
        with jira_server.app.test_client() as client:
            response = client.post("/api/stats/excluded-capacity-source", json={"sprintIds": []})

        self.assertEqual(response.status_code, 400)
        self.assertIn("sprintIds", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
