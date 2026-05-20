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
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()["data"]
        self.assertEqual(payload["meta"]["paginationMode"], "nextPageToken/isLast")
        self.assertEqual(payload["issues"][0]["key"], "SYN-1")
        self.assertEqual(payload["issues"][0]["fields"]["epicKey"], "BAU-1")
        self.assertEqual(payload["issues"][0]["fields"]["epicSummary"], "BAU Workstream")
        self.assertEqual(payload["issues"][0]["fields"]["teamId"], "team-alpha")
        self.assertEqual(payload["issues"][0]["fields"]["projectKey"], "SYN")
        self.assertNotIn("dependencies", payload)
        self.assertEqual(mock_search.call_count, 2)

        first_search_payload = mock_search.call_args_list[0].args[0]
        self.assertIn("Sprint in (101, 102)", first_search_payload["jql"])
        self.assertIn('"Team[Team]" = "team-alpha"', first_search_payload["jql"])
        self.assertNotIn("issuelinks", first_search_payload["fields"])
        self.assertNotIn("startAt", first_search_payload)

    def test_excluded_capacity_source_caches_uncapped_epic_summaries(self):
        sprint_field = "customfield_sprint"
        team_field = "customfield_team"
        epic_field = "customfield_epic"
        story_points_field = "customfield_sp"

        issues = []
        epics = []
        for index in range(1, 4):
            epic_key = f"BAU-{index}"
            issues.append({
                "id": f"1000{index}",
                "key": f"SYN-{index}",
                "fields": {
                    "summary": f"Synthetic task {index}",
                    "issuetype": {"name": "Story"},
                    story_points_field: index,
                    sprint_field: [{"id": 101, "name": "2025Q4 Sprint 1"}],
                    epic_field: epic_key,
                    team_field: {"id": "team-alpha", "name": "Alpha"},
                    "parent": {},
                    "project": {"key": "SYN", "name": "Synthetic Project"},
                },
            })
            epics.append({
                "id": f"2000{index}",
                "key": epic_key,
                "fields": {"summary": f"BAU Workstream {index}"},
            })

        responses = [
            FakeJiraResponse({"issues": issues, "isLast": True}),
            FakeJiraResponse({"issues": epics, "isLast": True}),
            FakeJiraResponse({"issues": issues, "isLast": True}),
        ]

        with jira_server.app.test_client() as client, \
             patch.object(jira_server, "EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE", {}, create=True), \
             patch.object(jira_server, "EXCLUDED_CAPACITY_STATS_MAX_EPICS", 2), \
             patch.object(jira_server, "JQL_QUERY_TEMPLATE", ""), \
             patch.object(jira_server, "build_base_jql", return_value='project = "SYN"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=["Story"]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=team_field), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=epic_field), \
             patch.object(jira_server, "get_sprint_field_id", return_value=sprint_field), \
             patch.object(jira_server, "get_story_points_field_id", return_value=story_points_field), \
             patch.object(jira_server, "jira_search_request", side_effect=responses) as mock_search:
            first = client.post(
                "/api/stats/excluded-capacity-source",
                json={"sprintIds": ["101"], "teamIds": ["team-alpha"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )
            second = client.post(
                "/api/stats/excluded-capacity-source",
                json={"sprintIds": ["101"], "teamIds": ["team-alpha"], "refresh": True},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        first_payload = first.get_json()["data"]
        first_summaries = {
            issue["fields"]["epicKey"]: issue["fields"]["epicSummary"]
            for issue in first_payload["issues"]
        }
        self.assertEqual(first_summaries["BAU-1"], "BAU Workstream 1")
        self.assertEqual(first_summaries["BAU-2"], "BAU Workstream 2")
        self.assertEqual(first_summaries["BAU-3"], "BAU Workstream 3")
        self.assertFalse(any("epic summary enrichment capped" in warning for warning in first_payload["meta"]["warnings"]))
        epic_summary_jql = mock_search.call_args_list[1].args[0]["jql"]
        self.assertIn('"BAU-1"', epic_summary_jql)
        self.assertIn('"BAU-2"', epic_summary_jql)
        self.assertIn('"BAU-3"', epic_summary_jql)
        self.assertEqual(mock_search.call_count, 3)

    def test_excluded_capacity_source_caches_source_payload_for_same_scope(self):
        sprint_field = "customfield_sprint"
        team_field = "customfield_team"
        epic_field = "customfield_epic"
        story_points_field = "customfield_sp"
        issue = {
            "id": "10001",
            "key": "SYN-1",
            "fields": {
                "summary": "Synthetic ad hoc task",
                "issuetype": {"name": "Story"},
                story_points_field: 3,
                sprint_field: [{"id": 101, "name": "2025Q4 Sprint 1"}],
                epic_field: "BAU-1",
                team_field: {"id": "team-alpha", "name": "Alpha"},
                "parent": {},
                "project": {"key": "SYN", "name": "Synthetic Project"},
            },
        }
        epic = {
            "id": "20001",
            "key": "BAU-1",
            "fields": {"summary": "BAU Workstream"},
        }
        responses = [
            FakeJiraResponse({"issues": [issue], "isLast": True}),
            FakeJiraResponse({"issues": [epic], "isLast": True}),
        ]

        with jira_server.app.test_client() as client, \
             patch.object(jira_server, "EXCLUDED_CAPACITY_STATS_SOURCE_CACHE", {}, create=True), \
             patch.object(jira_server, "EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE", {}, create=True), \
             patch.object(jira_server, "JQL_QUERY_TEMPLATE", ""), \
             patch.object(jira_server, "build_base_jql", return_value='project = "SYN"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=["Story"]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=team_field), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=epic_field), \
             patch.object(jira_server, "get_sprint_field_id", return_value=sprint_field), \
             patch.object(jira_server, "get_story_points_field_id", return_value=story_points_field), \
             patch.object(jira_server, "jira_search_request", side_effect=responses) as mock_search:
            first = client.post(
                "/api/stats/excluded-capacity-source",
                json={"sprintIds": ["101"], "teamIds": ["team-alpha"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )
            second = client.post(
                "/api/stats/excluded-capacity-source",
                json={"sprintIds": ["101"], "teamIds": ["team-alpha"]},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(first.status_code, 200, first.get_data(as_text=True))
        self.assertEqual(second.status_code, 200, second.get_data(as_text=True))
        self.assertFalse(first.get_json()["cached"])
        self.assertTrue(second.get_json()["cached"])
        self.assertEqual(second.get_json()["data"]["issues"][0]["fields"]["epicSummary"], "BAU Workstream")
        self.assertIn("Server-Timing", first.headers)
        self.assertEqual(second.headers.get("Server-Timing"), "cache;dur=1")
        self.assertEqual(mock_search.call_count, 2)

    def test_excluded_capacity_source_requests_only_stats_fields(self):
        sprint_field = "customfield_sprint"
        team_field = "customfield_team"
        epic_field = "customfield_epic"
        story_points_field = "customfield_sp"

        with patch.object(jira_server, "JQL_QUERY_TEMPLATE", ""), \
             patch.object(jira_server, "build_base_jql", return_value='project = "SYN"'), \
             patch.object(jira_server, "get_configured_issue_types", return_value=["Story"]), \
             patch.object(jira_server, "resolve_team_field_id", return_value=team_field), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value=epic_field), \
             patch.object(jira_server, "get_sprint_field_id", return_value=sprint_field), \
             patch.object(jira_server, "get_story_points_field_id", return_value=story_points_field), \
             patch.object(jira_server, "jira_search_request", return_value=FakeJiraResponse({"issues": [], "isLast": True})) as mock_search:
            payload, error = jira_server.fetch_excluded_capacity_stats_source(
                ["101"],
                team_ids=["team-alpha"],
            )

        self.assertIsNone(error)
        self.assertEqual(payload["issues"], [])
        fields = mock_search.call_args.args[0]["fields"]
        self.assertEqual(fields, [
            story_points_field,
            "parent",
            "project",
            sprint_field,
            epic_field,
            team_field,
        ])

    def test_excluded_capacity_source_requires_sprint_ids(self):
        with jira_server.app.test_client() as client:
            response = client.post(
                "/api/stats/excluded-capacity-source",
                json={"sprintIds": []},
                headers={"X-Requested-With": "jira-execution-planner"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("sprintIds", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
