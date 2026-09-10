import os
import unittest
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.routes import eng_routes
from backend.services.jira_issue_field_edits import (
    FieldEditInputError,
    FieldEditServiceError,
    load_editable_field,
)
import jira_server
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


def verified_context(*, account_id="account-1", workspace_id="workspace-1",
                     cloud_id="cloud-1", scopes=FULL_OAUTH_SCOPE,
                     verified=True, connection_id=None, display_name=""):
    return RequestAuthContext(
        auth_mode="atlassian_oauth",
        user_id=f"user:{account_id}",
        stable_subject=account_id,
        atlassian_account_id=account_id,
        workspace_id=workspace_id,
        auth_connection_id=connection_id or f"local-oauth-connection:{account_id}",
        cloud_id=cloud_id,
        site_url=f"https://{cloud_id}.example.test",
        token_version="1",
        account_status="active",
        is_admin=False,
        display_name=display_name,
        granted_scopes=tuple(scopes.split()),
        granted_scopes_verified=verified,
    )


class JiraIssueFieldRouteTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        jira_server.app.secret_key = "test-secret"
        self.env = patch.dict(os.environ, {
            "CONFIG_STORAGE_BACKEND": "jsonfile",
            "DATABASE_URL": "",
            "TEST_DATABASE_URL": "",
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

    def csrf_token(self):
        with self.oauth_mode():
            response = self.client.get("/api/auth/csrf")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["csrfToken"]

    def write_headers(self):
        return {
            "X-Requested-With": "jira-execution-planner",
            "X-CSRF-Token": self.csrf_token(),
        }

    def mutation_payload(self):
        return {
            "field": "storyPoints", "value": 1.5, "baseValue": 1,
            "baseUpdated": "2026-09-08T10:00:00.000+0000",
            "mappingRevision": "revision-1",
        }

    def test_metadata_requires_requested_with_before_service(self):
        with self.oauth_mode(), patch.object(
            eng_routes, "load_editable_field", side_effect=AssertionError("service reached"),
        ):
            response = self.client.get("/api/issues/DEMO-1/editable-fields?field=assignee")
        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "csrf_required")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_metadata_regular_non_admin_uses_context_and_server_field_ids(self):
        context = verified_context()
        captured = {}

        def fake_load(issue_key, field, *, jira_request, context, field_ids):
            captured.update(issue_key=issue_key, field=field, jira_request=jira_request,
                            context=context, field_ids=field_ids)
            return {
                "issueKey": issue_key, "field": field, "editable": True, "reason": None,
                "currentValue": 3, "baseUpdated": "updated", "mappingRevision": "revision",
                "me": None,
            }

        with self.oauth_mode(), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_98765"), \
             patch.object(jira_server, "get_delivery_owner_field_id", return_value="customfield_24680"), \
             patch.object(eng_routes, "load_editable_field", side_effect=fake_load):
            response = self.client.get(
                "/api/issues/DEMO-1/editable-fields?field=storyPoints",
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], context)
        self.assertIs(captured["jira_request"], jira_server.current_jira_request)
        self.assertEqual(captured["field_ids"], {
            "assignee": "assignee", "deliveryOwner": "customfield_24680",
            "storyPoints": "customfield_98765",
        })
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_search_and_update_require_csrf_and_requested_with(self):
        calls = [
            ("/api/issues/DEMO-1/user-options", {"field": "assignee", "query": "alpha"}),
            ("/api/issues/DEMO-1/field", self.mutation_payload()),
        ]
        for path, payload in calls:
            with self.subTest(path=path, case="missing_requested_with"), self.oauth_mode():
                response = self.client.post(path, json=payload)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "csrf_required")
            with self.subTest(path=path, case="missing_csrf"), self.oauth_mode():
                response = self.client.post(
                    path, json=payload,
                    headers={"X-Requested-With": "jira-execution-planner"},
                )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "csrf_required")
            with self.subTest(path=path, case="invalid_csrf"), self.oauth_mode():
                response = self.client.post(path, json=payload, headers={
                    "X-Requested-With": "jira-execution-planner", "X-CSRF-Token": "bad",
                })
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "csrf_required")

    def test_all_routes_reject_basic_before_service_or_body_parsing(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.object(eng_routes, "load_editable_field", side_effect=AssertionError("service reached")), \
             patch.object(eng_routes, "search_field_users", side_effect=AssertionError("service reached")), \
             patch.object(eng_routes, "update_issue_field", side_effect=AssertionError("service reached")):
            responses = [
                self.client.get("/api/issues/DEMO-1/editable-fields?field=assignee"),
                self.client.post("/api/issues/DEMO-1/user-options", data="{", content_type="application/json"),
                self.client.post("/api/issues/DEMO-1/field", data="{", content_type="application/json"),
            ]
        for response in responses:
            self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {"error": "jira_oauth_required"})
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_search_regular_user_passes_exact_context_and_field_ids(self):
        context = verified_context(account_id="user-a", workspace_id="workspace-a", cloud_id="cloud-a")
        captured = {}

        def fake_search(issue_key, payload, *, jira_request, context, field_ids):
            captured.update(issue_key=issue_key, payload=payload, context=context, field_ids=field_ids)
            return {"issueKey": issue_key, "field": payload["field"], "options": [], "limited": True}

        with self.oauth_mode(), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "get_delivery_owner_field_id", return_value="customfield_owner"), \
             patch.object(eng_routes, "search_field_users", side_effect=fake_search):
            response = self.client.post(
                "/api/issues/DEMO-1/user-options",
                json={"field": "assignee", "query": "alpha"},
                headers=self.write_headers(),
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(captured["context"], context)
        self.assertEqual(captured["field_ids"]["deliveryOwner"], "customfield_owner")

    def test_update_reloads_field_ids_at_request_entry_and_injects_invalidation(self):
        context = verified_context()
        captured = {}

        def fake_update(issue_key, payload, *, jira_request, context, field_ids, invalidate):
            captured.update(issue_key=issue_key, payload=payload, context=context,
                            field_ids=field_ids, invalidate=invalidate)
            return {
                "issueKey": issue_key, "field": payload["field"], "result": "success",
                "value": payload["value"], "updated": "new-updated",
            }

        with self.oauth_mode(), \
             patch.object(jira_server, "current_request_auth_context", return_value=context), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_changed"), \
             patch.object(jira_server, "get_delivery_owner_field_id", return_value="customfield_owner"), \
             patch.object(eng_routes, "update_issue_field", side_effect=fake_update):
            response = self.client.post(
                "/api/issues/DEMO-1/field", json=self.mutation_payload(),
                headers=self.write_headers(),
            )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(captured["field_ids"]["storyPoints"], "customfield_changed")
        self.assertIs(captured["context"], context)
        self.assertIs(captured["invalidate"], eng_routes.clear_jira_issue_status_caches)

    def test_people_and_story_point_routes_enforce_context_scope_provenance(self):
        read_only = "read:jira-work"
        cases = [
            ("GET", "/api/issues/DEMO-1/editable-fields?field=assignee", None,
             verified_context(scopes=read_only), "read:jira-user", "missing_oauth_scope"),
            ("GET", "/api/issues/DEMO-1/editable-fields?field=storyPoints", None,
             verified_context(scopes=read_only, verified=False), "provenance", "auth_required"),
            ("POST", "/api/issues/DEMO-1/field", self.mutation_payload(),
             verified_context(scopes="read:jira-work"), "write:jira-work", "missing_oauth_scope"),
        ]
        for method, path, payload, context, label, expected_error in cases:
            with self.subTest(label=label), self.oauth_mode(), \
                 patch.object(jira_server, "ATLASSIAN_SCOPES", read_only), \
                 patch.object(jira_server, "current_request_auth_context", return_value=context), \
                 patch.object(eng_routes, "load_editable_field", side_effect=AssertionError("service reached")), \
                 patch.object(eng_routes, "update_issue_field", side_effect=AssertionError("service reached")):
                headers = {"X-Requested-With": "jira-execution-planner"}
                if method == "POST":
                    headers["X-CSRF-Token"] = self.csrf_token()
                response = self.client.open(path, method=method, json=payload, headers=headers)
            self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
            self.assertEqual(response.get_json()["error"], expected_error)

    def test_revoked_auth_remains_terminal_401(self):
        revoked = AuthError("auth_connection_revoked", "raw provider detail")
        with self.oauth_mode(), patch.object(
            jira_server, "current_request_auth_context", side_effect=revoked,
        ):
            response = self.client.get(
                "/api/issues/DEMO-1/editable-fields?field=assignee",
                headers={"X-Requested-With": "jira-execution-planner"},
            )
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["error"], "auth_connection_revoked")
        self.assertEqual(response.get_json()["recoveryUrl"], "/auth/reconnect")

    def test_service_auth_failure_uses_global_recovery_contract(self):
        with self.oauth_mode(), patch.object(
            eng_routes,
            "update_issue_field",
            side_effect=AuthError("auth_required", "raw upstream response"),
        ):
            response = self.client.post(
                "/api/issues/DEMO-1/field", json=self.mutation_payload(),
                headers=self.write_headers(),
            )
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            "error": "auth_required",
            "message": "Your Jira sign-in expired. Sign in again to continue.",
            "loginUrl": "/login?reason=session_expired",
        })

    def test_invalid_json_and_service_errors_are_sanitized(self):
        with self.oauth_mode():
            invalid = self.client.post(
                "/api/issues/DEMO-1/user-options", data="[1]", content_type="application/json",
                headers=self.write_headers(),
            )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.get_json(), {"error": "invalid_json"})

        error = FieldEditServiceError(
            "stale_issue", 409,
            details={
                "issueKey": "DEMO-1", "field": "storyPoints", "currentValue": 3,
                "baseUpdated": "updated", "mappingRevision": "revision",
                "raw": "must not leak",
            },
        )
        with self.oauth_mode(), patch.object(eng_routes, "update_issue_field", side_effect=error):
            response = self.client.post(
                "/api/issues/DEMO-1/field", json=self.mutation_payload(),
                headers=self.write_headers(),
            )
        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            "error": "stale_issue", "issueKey": "DEMO-1", "field": "storyPoints",
            "currentValue": 3, "baseUpdated": "updated", "mappingRevision": "revision",
        })

    def test_input_errors_map_to_400_and_all_responses_are_no_store(self):
        with self.oauth_mode(), patch.object(
            eng_routes, "search_field_users", side_effect=FieldEditInputError("invalid_query"),
        ):
            response = self.client.post(
                "/api/issues/DEMO-1/user-options",
                json={"field": "assignee", "query": "bad"},
                headers=self.write_headers(),
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "invalid_query"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_two_users_and_sites_are_not_replaced_by_payload_identity(self):
        observed = []

        def fake_load(issue_key, field, *, jira_request, context, field_ids):
            observed.append((context.user_id, context.workspace_id, context.cloud_id))
            return {
                "issueKey": issue_key, "field": field, "editable": True, "reason": None,
                "currentValue": None, "baseUpdated": "updated", "mappingRevision": "revision",
                "me": None,
            }

        contexts = [
            verified_context(account_id="a", workspace_id="workspace-a", cloud_id="cloud-a"),
            verified_context(account_id="b", workspace_id="workspace-b", cloud_id="cloud-b"),
        ]
        for context in contexts:
            with self.oauth_mode(), \
                 patch.object(jira_server, "current_request_auth_context", return_value=context), \
                 patch.object(eng_routes, "load_editable_field", side_effect=fake_load):
                response = self.client.get(
                    "/api/issues/DEMO-1/editable-fields?field=storyPoints",
                    headers={"X-Requested-With": "jira-execution-planner"},
                )
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(observed, [
            ("user:a", "workspace-a", "cloud-a"),
            ("user:b", "workspace-b", "cloud-b"),
        ])


class CurrentJiraRequestCapturedContextTests(unittest.TestCase):
    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def test_db_oauth_context_works_without_flask_request_or_forbidden_fallbacks(self):
        context = verified_context(
            account_id="db-user", workspace_id="workspace-db", cloud_id="cloud-db",
            connection_id="db-connection-1",
        )
        outbound = []

        def fake_request(method, url, **kwargs):
            outbound.append((method, url, kwargs))
            return FakeResponse(200, {"fields": {}})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "db_oauth_session_data_for_auth_context", return_value={
                 "access_token": "synthetic-db-bearer", "refresh_token": "synthetic-refresh",
                 "expires_at": 9999999999,
             }), \
             patch.object(jira_server.HTTP_SESSION, "request", side_effect=fake_request), \
             patch.object(jira_server, "oauth_session_data", side_effect=AssertionError("local OAuth fallback reached")), \
             patch("backend.auth.home_credentials.resolve_home_credential", side_effect=AssertionError("Home fallback reached")):
            response = jira_server.current_jira_request(
                "GET", "/rest/api/3/issue/DEMO-1", context=context, timeout=10,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(outbound), 1)
        method, url, kwargs = outbound[0]
        self.assertEqual(method, "GET")
        self.assertEqual(url, "https://api.atlassian.com/ex/jira/cloud-db/rest/api/3/issue/DEMO-1")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer synthetic-db-bearer")
        self.assertNotIn("Basic", kwargs["headers"]["Authorization"])

    def test_parallel_metadata_reads_reach_real_db_oauth_wrapper_without_request_context(self):
        context = verified_context(
            account_id="db-user", workspace_id="workspace-db", cloud_id="cloud-db",
            connection_id="db-connection-1", display_name="DB User",
        )
        outbound = []

        def fake_request(method, url, **kwargs):
            outbound.append((method, url, kwargs))
            if url.endswith("/editmeta"):
                return FakeResponse(200, {"fields": {"assignee": {
                    "operations": ["set"],
                    "schema": {"type": "user", "system": "assignee"},
                }}})
            if url.endswith("/user/assignable/search"):
                return FakeResponse(200, [{
                    "accountId": "db-user", "displayName": "DB User", "active": True,
                }])
            return FakeResponse(200, {"fields": {
                "issuetype": {"name": "Story", "subtask": False},
                "updated": "2026-09-08T10:00:00.000+0000",
                "assignee": None,
            }})

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "db_oauth_session_data_for_auth_context", return_value={
                 "access_token": "synthetic-db-bearer", "refresh_token": "synthetic-refresh",
                 "expires_at": 9999999999,
             }), \
             patch.object(jira_server.HTTP_SESSION, "request", side_effect=fake_request), \
             patch.object(jira_server, "oauth_session_data", side_effect=AssertionError("local OAuth fallback reached")):
            result = load_editable_field(
                "DEMO-1", "assignee", jira_request=jira_server.current_jira_request,
                context=context, field_ids={"assignee": "assignee"},
            )

        self.assertTrue(result["editable"])
        self.assertEqual(result["me"], {
            "accountId": "db-user", "displayName": "DB User", "eligibility": "eligible",
        })
        self.assertEqual(len(outbound), 3)
        self.assertTrue(all(
            call[2]["headers"]["Authorization"] == "Bearer synthetic-db-bearer"
            for call in outbound
        ))

    def test_local_context_still_uses_actual_local_oauth_store(self):
        jira_server.OAUTH_TOKEN_STORE["session-local"] = {
            "access_token": "synthetic-local-bearer", "refresh_token": "synthetic-refresh",
            "expires_at": 9999999999, "cloudid": "cloud-local", "stored_at": 9999999999,
        }
        context = verified_context(
            account_id="local-user", cloud_id="cloud-local",
            connection_id="local-oauth-connection:session-local",
        )
        outbound = []

        def fake_request(method, url, **kwargs):
            outbound.append((method, url, kwargs))
            return FakeResponse(200)

        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server.HTTP_SESSION, "request", side_effect=fake_request):
            jira_server.current_jira_request(
                "GET", "/rest/api/3/issue/DEMO-1", context=context, timeout=10,
            )
        self.assertEqual(outbound[0][2]["headers"]["Authorization"], "Bearer synthetic-local-bearer")


if __name__ == "__main__":
    unittest.main()
