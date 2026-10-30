"""Add assignee search route (#323 Task 9): POST /api/eng/assignee-capacity/user-options."""
import os
import unittest
from unittest.mock import patch

from backend.auth.jira_auth import AuthError
from backend.routes import eng_routes
from backend.services.jira_issue_field_edits import search_assignable_project_users
import jira_server
from tests.oauth_test_helpers import install_oauth_session
from tests.test_jira_issue_field_routes import FakeResponse, verified_context

PATH = "/api/eng/assignee-capacity/user-options"
PROJECTS = [{"key": "PRODA", "type": "product"}, {"key": "TECHA", "type": "tech"}]


def person(account_id, name, *, active=True, email=None):
    record = {"accountId": account_id, "displayName": name, "active": active}
    if email:
        record["emailAddress"] = email
    return record


class FakeJira:
    def __init__(self, by_project=None, status=None):
        self.by_project = by_project or {}
        self.status = status or {}
        self.calls = []

    def __call__(self, method, path, *, params=None, timeout=None, context=None):
        self.calls.append((method, path, dict(params or {}), context))
        project = (params or {}).get("project")
        status = self.status.get(project, 200)
        return FakeResponse(status, self.by_project.get(project, []))


class AssigneeCapacityUserOptionsRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.env = patch.dict(os.environ, {
            "CONFIG_STORAGE_BACKEND": "jsonfile", "DATABASE_URL": "", "TEST_DATABASE_URL": "",
            "APP_ENVIRONMENT_KEY": "local",
        }, clear=False)
        self.env.start()
        self.client = jira_server.app.test_client()
        install_oauth_session(self.client)

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()
        self.env.stop()

    def oauth_mode(self):
        return patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth")

    def headers(self):
        with self.oauth_mode():
            token = self.client.get("/api/auth/csrf").get_json()["csrfToken"]
        return {"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": token}

    def post(self, body, *, jira=None, context=None, projects=PROJECTS, jql_query="", headers=None):
        jira = jira or FakeJira()
        context = context or verified_context(account_id="me-1")
        request_headers = self.headers() if headers is None else headers
        with self.oauth_mode(), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "current_jira_request", side_effect=jira), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=projects), \
             patch.object(jira_server, "JQL_QUERY", jql_query):
            return self.client.post(PATH, json=body, headers=request_headers), jira

    def test_oauth_user_gets_active_assignable_users_of_selected_projects(self):
        jira = FakeJira({
            "PRODA": [person("me-1", "Me Myself", email="me@example.test"), person("u-2", "Ann", email="ann@example.test"),
                      person("u-3", "Gone", active=False)],
            "TECHA": [person("u-2", "Ann"), person("u-4", "Bob")],
        })
        response, jira = self.post({"query": "ann"}, jira=jira)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body, {"users": [
            {"accountId": "me-1", "displayName": "Me Myself"},
            {"accountId": "u-2", "displayName": "Ann"},
            {"accountId": "u-4", "displayName": "Bob"},
        ], "reason": None})
        self.assertNotIn("email", response.get_data(as_text=True).lower())
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual([call[1] for call in jira.calls], ["/rest/api/3/user/assignable/search"] * 2)
        self.assertEqual([call[2]["project"] for call in jira.calls], ["PRODA", "TECHA"])
        self.assertTrue(all(call[2]["query"] == "ann" and call[2]["maxResults"] == 10 for call in jira.calls))

    def test_dedupes_and_returns_at_most_ten_and_caps_project_keys(self):
        many = [{"key": f"P{index}", "type": "product"} for index in range(15)]
        jira = FakeJira({f"P{index}": [person("dup", "Dup")] for index in range(15)})
        response, jira = self.post({"query": "dup"}, jira=jira, projects=many)
        self.assertEqual(response.get_json()["users"], [{"accountId": "dup", "displayName": "Dup"}])
        self.assertEqual(len(jira.calls), 10)

        crowd = FakeJira({"PRODA": [person(f"a{index}", f"A{index}") for index in range(8)],
                          "TECHA": [person(f"b{index}", f"B{index}") for index in range(8)]})
        response, crowd = self.post({"query": "abc"}, jira=crowd)
        self.assertEqual(len(response.get_json()["users"]), 10)

    def test_empty_project_set_and_jql_query_workspace_return_message_code_without_jira(self):
        for label, kwargs in (("empty", {"projects": []}), ("jql", {"jql_query": "project = X"})):
            with self.subTest(label):
                jira = FakeJira()
                response, jira = self.post({"query": "ann"}, jira=jira, **kwargs)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), {"users": [], "reason": "no_selected_projects"})
                self.assertEqual(jira.calls, [])

    def test_unbrowsable_project_is_skipped(self):
        jira = FakeJira({"TECHA": [person("u-4", "Bob")]}, status={"PRODA": 404})
        response, _ = self.post({"query": "bob"}, jira=jira)
        self.assertEqual(response.get_json()["users"], [{"accountId": "u-4", "displayName": "Bob"}])

    def test_jira_errors_are_mapped(self):
        response, _ = self.post({"query": "bob"}, jira=FakeJira(status={"PRODA": 429}))
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.get_json(), {"error": "jira_rate_limited", "retryAfterSeconds": 1})
        response, _ = self.post({"query": "bob"}, jira=FakeJira(status={"PRODA": 500}))
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json(), {"error": "jira_read_failed"})

        def boom(*args, **kwargs):
            raise RuntimeError("network detail")
        response, _ = self.post({"query": "bob"}, jira=boom)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json(), {"error": "jira_read_failed"})

    def test_jira_401_is_terminal_auth(self):
        response, _ = self.post({"query": "bob"}, jira=FakeJira(status={"PRODA": 401}))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "auth_required")

    def test_input_validation(self):
        cases = [{"query": "ab"}, {"query": "x" * 201}, {"query": 5}, {"query": "abc", "maxResults": 10}, {}]
        for body in cases:
            with self.subTest(body=body):
                jira = FakeJira()
                response, jira = self.post(body, jira=jira)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"error": "invalid_query"})
                self.assertEqual(jira.calls, [])
        with self.oauth_mode():
            response = self.client.post(PATH, data="[1]", content_type="application/json", headers=self.headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "invalid_json"})

    def test_requires_csrf_and_requested_with(self):
        for label, headers in (
            ("missing_requested_with", {}),
            ("missing_csrf", {"X-Requested-With": "jira-execution-planner"}),
            ("invalid_csrf", {"X-Requested-With": "jira-execution-planner", "X-CSRF-Token": "bad"}),
        ):
            with self.subTest(label):
                jira = FakeJira()
                response, jira = self.post({"query": "ann"}, jira=jira, headers=headers)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "csrf_required")
                self.assertEqual(jira.calls, [])

    def test_basic_mode_is_denied_before_body_parsing(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "search_assignable_project_users", side_effect=AssertionError("service reached")):
            response = self.client.post(PATH, data="{", content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json(), {"error": "jira_oauth_required"})

    def test_missing_read_jira_user_scope_is_rejected(self):
        context = verified_context(scopes="read:jira-work")
        with patch.object(jira_server, "ATLASSIAN_SCOPES", "read:jira-work"):
            response, jira = self.post({"query": "ann"}, context=context)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "missing_oauth_scope")
        self.assertEqual(jira.calls, [])

    def test_revoked_context_is_terminal(self):
        headers = self.headers()
        with self.oauth_mode(), patch.object(
            jira_server, "current_request_auth_context", side_effect=AuthError("auth_connection_revoked", "detail"),
        ):
            response = self.client.post(PATH, json={"query": "ann"}, headers=headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "auth_connection_revoked")

    def test_signed_in_context_is_passed_to_jira(self):
        context = verified_context(account_id="user-a", workspace_id="workspace-a", cloud_id="cloud-a")
        jira = FakeJira({"PRODA": [person("u-2", "Ann")]})
        response, jira = self.post({"query": "ann"}, jira=jira, context=context)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all(call[3] is context for call in jira.calls))


class SearchAssignableProjectUsersServiceTests(unittest.TestCase):
    def test_skips_invalid_and_duplicate_project_keys(self):
        jira = FakeJira({"PRODA": [person("u-1", "Ann")]})
        result = search_assignable_project_users(
            {"query": "ann"}, project_keys=["PRODA", "proda", "bad key", ""], jira_request=jira, context=None,
        )
        self.assertEqual(result, {"users": [{"accountId": "u-1", "displayName": "Ann"}], "reason": None})
        self.assertEqual([call[2]["project"] for call in jira.calls], ["PRODA"])

    def test_drops_inactive_and_malformed_records(self):
        jira = FakeJira({"PRODA": [person("u-1", "Ann", active=False), {"accountId": "", "displayName": "X", "active": True},
                                   {"displayName": "No id", "active": True}, "junk", person("u-2", "Bob")]})
        result = search_assignable_project_users({"query": "abc"}, project_keys=["PRODA"], jira_request=jira, context=None)
        self.assertEqual(result["users"], [{"accountId": "u-2", "displayName": "Bob"}])


if __name__ == "__main__":
    unittest.main()
