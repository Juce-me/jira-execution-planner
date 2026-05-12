import json
import unittest

from backend.epm import home as epm_home


class HomeGraphQLOAuthFeasibilityTests(unittest.TestCase):
    def test_probe_uses_exact_home_query_constants(self):
        queries = epm_home.home_graphql_feasibility_queries()

        self.assertIs(queries["goals_search"], epm_home.QUERY_GOALS_SEARCH)
        self.assertIs(queries["goal_by_key"], epm_home.QUERY_GOAL_BY_KEY)
        self.assertIs(queries["sub_goals"], epm_home.QUERY_SUB_GOALS)
        self.assertIs(queries["goal_projects"], epm_home.QUERY_GOAL_PROJECTS)
        self.assertIs(queries["project_details"], epm_home.QUERY_PROJECT_DETAILS)
        self.assertIs(queries["project_updates"], epm_home.QUERY_PROJECT_UPDATES)
        self.assertIs(queries["project_tags"], epm_home.QUERY_PROJECT_TAGS)
        self.assertIs(queries["teamwork_graph_project_tags"], epm_home.QUERY_TEAMWORK_GRAPH_PROJECT_TAGS)

    def test_probe_output_redacts_token_material(self):
        payload = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "authorization": "Bearer access-123",
            "results": [{"operation": "goals_search", "ok": True}],
        }

        redacted = epm_home.redact_home_oauth_probe_payload(payload)
        rendered = json.dumps(redacted)

        self.assertNotIn("access-123", rendered)
        self.assertNotIn("refresh-123", rendered)
        self.assertNotIn("Bearer", rendered)
        self.assertEqual(redacted["results"][0]["operation"], "goals_search")

    def test_probe_result_classifies_auth_failures_as_unsupported(self):
        result = epm_home.classify_home_graphql_probe_results([
            {"operation": "goals_search", "status": 401, "ok": False},
            {"operation": "teamwork_graph_project_tags", "status": 403, "ok": False},
        ])

        self.assertEqual(result["decision"], "fail")
        self.assertEqual(result["reason"], "home_graphql_3lo_unsupported")

    def test_probe_result_classifies_scope_error_messages_as_unsupported(self):
        result = epm_home.classify_home_graphql_probe_results([
            {
                "operation": "goals_search",
                "status": 200,
                "ok": False,
                "errors": ["This request does not contain the right authorisation scopes to access this field"],
            },
        ])

        self.assertEqual(result["decision"], "fail")
        self.assertEqual(result["reason"], "home_graphql_3lo_unsupported")

    def test_probe_result_passes_only_when_home_and_twg_operations_succeed(self):
        operations = [
            "goals_search",
            "goal_by_key",
            "sub_goals",
            "goal_projects",
            "project_details",
            "project_updates",
            "project_tags",
            "teamwork_graph_project_tags",
        ]
        result = epm_home.classify_home_graphql_probe_results([
            {"operation": operation, "status": 200, "ok": True} for operation in operations
        ])

        self.assertEqual(result["decision"], "pass")
