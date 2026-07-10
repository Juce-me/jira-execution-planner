import threading
import unittest
from unittest.mock import patch

from flask import has_request_context

import jira_server
from backend.auth.context import RequestAuthContext
from backend.services.jira_issue_transitions import (
    IssueTransitionInputError,
    IssueTransitionServiceError,
    MAX_STATUS_TRANSITION_ISSUES,
    build_issue_snapshot_search_payload,
    load_issue_snapshots,
    load_status_catalog,
    load_transition_options,
    normalize_issue_keys,
    normalize_status_name,
    resolve_issue_transition,
    select_transition_for_target,
    shape_status_catalog,
    shape_transition_failure,
    shape_transition_success,
    summarize_transition_options,
    transition_issues,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


def make_search(issues, *, status_code=200, recorder=None):
    def search_request(payload, *, context=None, timeout=30):
        if recorder is not None:
            recorder.append((payload, context))
        return FakeResponse(status_code, {"issues": issues})

    return search_request


class RecordingJira:
    """Fake ``current_jira_request`` recording per-issue GET/POST calls."""

    def __init__(self):
        self.calls = []
        self.get_responses = {}
        self.post_responses = {}
        self.default_get = FakeResponse(200, {"transitions": []})
        self.default_post = FakeResponse(204, {})

    def _key_from_path(self, path):
        return path.rsplit("/", 2)[1]

    def request(self, method, path, *, json_body=None, params=None, timeout=30, context=None):
        self.calls.append({"method": method, "path": path, "json_body": json_body, "context": context})
        key = self._key_from_path(path)
        if method == "GET":
            return self.get_responses.get(key, self.default_get)
        return self.post_responses.get(key, self.default_post)


class NormalizeIssueKeysTests(unittest.TestCase):
    def test_trims_uppercases_dedups_and_preserves_order(self):
        keys = normalize_issue_keys([" prod-1 ", "PROD-1", "tech-22", "OPS2-3", "TECH-22"])
        self.assertEqual(keys, ["PROD-1", "TECH-22", "OPS2-3"])

    def test_rejects_blank_key(self):
        with self.assertRaises(IssueTransitionInputError) as ctx:
            normalize_issue_keys(["PROD-1", "   "])
        self.assertEqual(ctx.exception.code, "invalid_issue_key")

    def test_rejects_malformed_keys(self):
        for bad in ["PROD", "PROD-", "123-4", "PROD 1", "PROD--1", "-1"]:
            with self.assertRaises(IssueTransitionInputError) as ctx:
                normalize_issue_keys([bad])
            self.assertEqual(ctx.exception.code, "invalid_issue_key", bad)

    def test_rejects_non_string_key(self):
        with self.assertRaises(IssueTransitionInputError) as ctx:
            normalize_issue_keys([123])
        self.assertEqual(ctx.exception.code, "invalid_issue_key")

    def test_empty_or_non_list_signals_issue_keys_required(self):
        for empty in [[], None, "PROD-1"]:
            with self.assertRaises(IssueTransitionInputError) as ctx:
                normalize_issue_keys(empty)
            self.assertEqual(ctx.exception.code, "issue_keys_required")

    def test_rejects_more_than_cap(self):
        keys = [f"PROD-{i}" for i in range(1, MAX_STATUS_TRANSITION_ISSUES + 2)]
        with self.assertRaises(IssueTransitionInputError) as ctx:
            normalize_issue_keys(keys)
        self.assertEqual(ctx.exception.code, "too_many_issues")

    def test_accepts_exactly_cap(self):
        keys = [f"PROD-{i}" for i in range(1, MAX_STATUS_TRANSITION_ISSUES + 1)]
        self.assertEqual(len(normalize_issue_keys(keys)), MAX_STATUS_TRANSITION_ISSUES)


class NormalizeStatusNameTests(unittest.TestCase):
    def test_lowercases_trims_and_collapses_whitespace(self):
        self.assertEqual(normalize_status_name("  In   Progress "), "in progress")

    def test_none_becomes_empty(self):
        self.assertEqual(normalize_status_name(None), "")


class SelectTransitionForTargetTests(unittest.TestCase):
    def setUp(self):
        self.transitions = [
            {"id": "11", "name": "Start Progress", "to": {"name": "In Progress"}},
            {"id": "21", "name": "Resolve", "to": {"name": "Done"}},
        ]

    def test_matches_target_by_to_name_case_insensitive(self):
        transition = select_transition_for_target(self.transitions, "in progress")
        self.assertEqual(transition["id"], "11")

    def test_does_not_match_transition_display_name(self):
        self.assertIsNone(select_transition_for_target(self.transitions, "Start Progress"))

    def test_returns_none_when_no_target(self):
        self.assertIsNone(select_transition_for_target(self.transitions, "Blocked"))
        self.assertIsNone(select_transition_for_target([], "Done"))


class ResolveIssueTransitionTests(unittest.TestCase):
    def setUp(self):
        self.transitions = [
            {"id": "11", "name": "Start Progress", "to": {"name": "In Progress"}},
        ]

    def test_already_in_status(self):
        outcome = resolve_issue_transition("In Progress", self.transitions, "in progress")
        self.assertEqual(outcome["outcome"], "already_in_status")

    def test_transition_not_available(self):
        outcome = resolve_issue_transition("To Do", self.transitions, "Done")
        self.assertEqual(outcome["outcome"], "transition_not_available")

    def test_selects_transition(self):
        outcome = resolve_issue_transition("To Do", self.transitions, "In Progress")
        self.assertEqual(outcome["outcome"], "transition")
        self.assertEqual(outcome["transition"]["id"], "11")


class SummarizeTransitionOptionsTests(unittest.TestCase):
    def test_counts_available_and_blocked_per_target(self):
        entries = [
            {
                "key": "PROD-1",
                "currentStatus": "To Do",
                "transitions": [
                    {"name": "Start Progress", "toStatus": "In Progress"},
                    {"name": "Resolve", "toStatus": "Done"},
                ],
            },
            {
                "key": "PROD-2",
                "currentStatus": "To Do",
                "transitions": [
                    {"name": "Start Progress", "toStatus": "In Progress"},
                ],
            },
        ]
        summary = summarize_transition_options(entries)
        self.assertEqual([s["name"] for s in summary], ["In Progress", "Done"])
        self.assertEqual(summary[0], {"name": "In Progress", "availableCount": 2, "blockedCount": 0})
        self.assertEqual(summary[1], {"name": "Done", "availableCount": 1, "blockedCount": 1})

    def test_ignores_errored_issues(self):
        entries = [
            {"key": "PROD-1", "currentStatus": "To Do", "error": "transitions_unavailable"},
            {
                "key": "PROD-2",
                "currentStatus": "To Do",
                "transitions": [{"name": "Start", "toStatus": "In Progress"}],
            },
        ]
        summary = summarize_transition_options(entries)
        self.assertEqual(summary, [{"name": "In Progress", "availableCount": 1, "blockedCount": 0}])

    def test_already_in_status_is_neither_available_nor_blocked(self):
        entries = [
            {"key": "PROD-1", "currentStatus": "Done", "transitions": []},
            {
                "key": "PROD-2",
                "currentStatus": "To Do",
                "transitions": [{"name": "Resolve", "toStatus": "Done"}],
            },
        ]
        summary = summarize_transition_options(entries)
        self.assertEqual(summary, [{"name": "Done", "availableCount": 1, "blockedCount": 0}])


class ShapeResultTests(unittest.TestCase):
    def test_success_shape(self):
        self.assertEqual(
            shape_transition_success("PROD-1", "To Do", "Accepted"),
            {"key": "PROD-1", "result": "success", "fromStatus": "To Do", "toStatus": "Accepted"},
        )

    def test_failure_shape_has_no_raw_body(self):
        failure = shape_transition_failure("PROD-2", "transition_not_available", current_status="Done")
        self.assertEqual(
            failure,
            {"key": "PROD-2", "result": "failure", "error": "transition_not_available", "currentStatus": "Done"},
        )
        self.assertNotIn("body", failure)
        self.assertNotIn("response", failure)

    def test_failure_shape_optional_fields_omitted(self):
        failure = shape_transition_failure("PROD-3", "transition_failed")
        self.assertEqual(failure, {"key": "PROD-3", "result": "failure", "error": "transition_failed"})


class SnapshotPayloadTests(unittest.TestCase):
    def test_build_issue_snapshot_search_payload(self):
        payload = build_issue_snapshot_search_payload(["PROD-1", "TECH-22"])
        self.assertEqual(payload["fields"], ["summary", "status", "issuetype"])
        self.assertGreaterEqual(payload["maxResults"], MAX_STATUS_TRANSITION_ISSUES)
        self.assertEqual(payload["jql"], 'key in ("PROD-1","TECH-22")')
        self.assertNotIn("startAt", payload)

    def test_load_issue_snapshots_reads_summary_status_issuetype(self):
        recorder = []
        search = make_search(
            [{"key": "PROD-1", "fields": {"summary": "S", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}}],
            recorder=recorder,
        )
        snapshots = load_issue_snapshots(["PROD-1"], search_request=search, context="ctx")
        self.assertEqual(snapshots["PROD-1"], {
            "key": "PROD-1",
            "summary": "S",
            "currentStatus": "To Do",
            "issueType": "Story",
        })
        self.assertEqual(len(recorder), 1)
        self.assertEqual(recorder[0][1], "ctx")

    def test_load_issue_snapshots_raises_service_error_on_non_200(self):
        search = make_search([], status_code=503)
        with self.assertRaises(IssueTransitionServiceError) as ctx:
            load_issue_snapshots(["PROD-1"], search_request=search)
        self.assertEqual(ctx.exception.code, "issue_snapshot_fetch_failed")


class LoadTransitionOptionsTests(unittest.TestCase):
    def test_one_batch_search_then_per_issue_transitions(self):
        recorder = []
        search = make_search(
            [
                {"key": "PROD-1", "fields": {"summary": "A", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
                {"key": "PROD-2", "fields": {"summary": "B", "status": {"name": "In Progress"}, "issuetype": {"name": "Epic"}}},
            ],
            recorder=recorder,
        )
        jira = RecordingJira()
        jira.get_responses["PROD-1"] = FakeResponse(200, {"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}]})
        jira.get_responses["PROD-2"] = FakeResponse(200, {"transitions": [{"id": "21", "name": "Finish", "to": {"name": "Done"}}]})

        result = load_transition_options(["prod-1", "PROD-2"], jira_request=jira.request, search_request=search, context="ctx")

        self.assertEqual(len(recorder), 1)
        payload, ctx = recorder[0]
        self.assertEqual(payload["fields"], ["summary", "status", "issuetype"])
        self.assertGreaterEqual(payload["maxResults"], MAX_STATUS_TRANSITION_ISSUES)
        self.assertEqual(ctx, "ctx")

        gets = [c for c in jira.calls if c["method"] == "GET"]
        self.assertEqual(
            {c["path"] for c in gets},
            {"/rest/api/3/issue/PROD-1/transitions", "/rest/api/3/issue/PROD-2/transitions"},
        )
        self.assertTrue(all(c["context"] == "ctx" for c in gets))

        issues = {i["key"]: i for i in result["issues"]}
        self.assertEqual(issues["PROD-1"]["issueType"], "Story")
        self.assertEqual(issues["PROD-1"]["currentStatus"], "To Do")
        self.assertEqual(issues["PROD-1"]["transitions"], [{"name": "Start", "toStatus": "In Progress"}])
        self.assertEqual(issues["PROD-2"]["transitions"], [{"name": "Finish", "toStatus": "Done"}])
        self.assertIn("targetStatuses", result)

    def test_per_issue_error_marks_transitions_unavailable(self):
        search = make_search(
            [
                {"key": "PROD-1", "fields": {"status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
                {"key": "PROD-2", "fields": {"status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]
        )
        jira = RecordingJira()
        jira.get_responses["PROD-1"] = FakeResponse(200, {"transitions": [{"id": "11", "name": "Go", "to": {"name": "In Progress"}}]})
        jira.get_responses["PROD-2"] = FakeResponse(403, {"errorMessages": ["forbidden detail"]})

        result = load_transition_options(["PROD-1", "PROD-2"], jira_request=jira.request, search_request=search)
        issues = {i["key"]: i for i in result["issues"]}
        self.assertEqual(issues["PROD-2"]["error"], "transitions_unavailable")
        self.assertNotIn("transitions", issues["PROD-2"])
        self.assertNotIn("forbidden detail", repr(result))

    def test_snapshot_failure_raises_before_per_issue_calls(self):
        search = make_search([], status_code=502)
        jira = RecordingJira()
        with self.assertRaises(IssueTransitionServiceError):
            load_transition_options(["PROD-1"], jira_request=jira.request, search_request=search)
        self.assertEqual(jira.calls, [])


class TransitionIssuesTests(unittest.TestCase):
    def _snapshot(self, key, status, issue_type="Story"):
        return {"key": key, "fields": {"status": {"name": status}, "issuetype": {"name": issue_type}}}

    def test_posts_only_transition_id_body(self):
        search = make_search([self._snapshot("PROD-1", "To Do")])
        jira = RecordingJira()
        jira.get_responses["PROD-1"] = FakeResponse(200, {"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}]})
        jira.post_responses["PROD-1"] = FakeResponse(204, {})

        result = transition_issues(["PROD-1"], "In Progress", jira_request=jira.request, search_request=search, context="ctx")

        posts = [c for c in jira.calls if c["method"] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["path"], "/rest/api/3/issue/PROD-1/transitions")
        self.assertEqual(posts[0]["json_body"], {"transition": {"id": "11"}})
        self.assertEqual(set(posts[0]["json_body"].keys()), {"transition"})
        self.assertEqual(set(posts[0]["json_body"]["transition"].keys()), {"id"})
        self.assertEqual(posts[0]["context"], "ctx")

        self.assertEqual(result["requested"], 1)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["targetStatus"], "In Progress")
        self.assertEqual(
            result["results"][0],
            {"key": "PROD-1", "result": "success", "fromStatus": "To Do", "toStatus": "In Progress"},
        )

    def test_partial_success_continues_after_failure(self):
        search = make_search([self._snapshot("PROD-1", "To Do"), self._snapshot("PROD-2", "To Do")])
        jira = RecordingJira()
        jira.get_responses["PROD-1"] = FakeResponse(200, {"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}]})
        jira.get_responses["PROD-2"] = FakeResponse(200, {"transitions": [{"id": "31", "name": "Resolve", "to": {"name": "Done"}}]})
        jira.post_responses["PROD-1"] = FakeResponse(204, {})

        result = transition_issues(["PROD-1", "PROD-2"], "In Progress", jira_request=jira.request, search_request=search)

        self.assertEqual(result["requested"], 2)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 1)
        results = {r["key"]: r for r in result["results"]}
        self.assertEqual(results["PROD-1"]["result"], "success")
        self.assertEqual(results["PROD-2"]["result"], "failure")
        self.assertEqual(results["PROD-2"]["error"], "transition_not_available")
        posts = [c for c in jira.calls if c["method"] == "POST"]
        self.assertEqual([c["path"] for c in posts], ["/rest/api/3/issue/PROD-1/transitions"])

    def test_rejects_over_cap_before_any_jira_call(self):
        recorder = []
        search = make_search([], recorder=recorder)
        jira = RecordingJira()
        keys = [f"PROD-{i}" for i in range(1, MAX_STATUS_TRANSITION_ISSUES + 2)]
        with self.assertRaises(IssueTransitionInputError) as ctx:
            transition_issues(keys, "Done", jira_request=jira.request, search_request=search)
        self.assertEqual(ctx.exception.code, "too_many_issues")
        self.assertEqual(recorder, [])
        self.assertEqual(jira.calls, [])

    def test_requires_target_status_before_any_jira_call(self):
        recorder = []
        search = make_search([], recorder=recorder)
        jira = RecordingJira()
        with self.assertRaises(IssueTransitionInputError) as ctx:
            transition_issues(["PROD-1"], "   ", jira_request=jira.request, search_request=search)
        self.assertEqual(ctx.exception.code, "target_status_required")
        self.assertEqual(recorder, [])
        self.assertEqual(jira.calls, [])

    def test_already_in_status_is_success_without_post(self):
        search = make_search([self._snapshot("PROD-1", "Done")])
        jira = RecordingJira()

        result = transition_issues(["PROD-1"], "done", jira_request=jira.request, search_request=search)

        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["results"][0]["result"], "already_in_status")
        self.assertEqual(jira.calls, [])

    def test_sanitizes_post_error_without_raw_body(self):
        search = make_search([self._snapshot("PROD-1", "To Do")])
        jira = RecordingJira()
        jira.get_responses["PROD-1"] = FakeResponse(200, {"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}]})
        jira.post_responses["PROD-1"] = FakeResponse(409, {"errorMessages": ["conflict detail"]})

        result = transition_issues(["PROD-1"], "In Progress", jira_request=jira.request, search_request=search)

        failure = result["results"][0]
        self.assertEqual(failure["result"], "failure")
        self.assertEqual(failure["error"], "transition_conflict")
        self.assertEqual(failure["currentStatus"], "To Do")
        self.assertNotIn("conflict detail", repr(result))


class NoRequestContextRealAuthWrapperTests(unittest.TestCase):
    """Options and write flows run outside any Flask request context with the
    REAL current_jira_request/current_jira_search injected, patched only at the
    lowest HTTP transport layer. They must send the OAuth bearer token derived
    from the passed context and never fall back to Basic/service credentials.
    """

    def setUp(self):
        self.session_id = "session-transitions"
        jira_server.OAUTH_TOKEN_STORE[self.session_id] = {
            "access_token": "access-123",
            "refresh_token": "refresh-123",
            "expires_at": 9999999999,
            "cloudid": "cloud-123",
            "site_url": "https://example.atlassian.net",
            "account_id": "account-123",
            "stored_at": 9999999999,
        }
        jira_server.OAUTH_REFRESH_LOCKS.setdefault(self.session_id, threading.Lock())

    def tearDown(self):
        jira_server.OAUTH_TOKEN_STORE.clear()
        jira_server.OAUTH_REFRESH_LOCKS.clear()

    def _context(self):
        return RequestAuthContext(
            auth_mode="atlassian_oauth",
            user_id="local-oauth-user:account-123",
            stable_subject="account-123",
            atlassian_account_id="account-123",
            workspace_id="workspace-1",
            auth_connection_id=f"local-oauth-connection:{self.session_id}",
            cloud_id="cloud-123",
            site_url="https://example.atlassian.net",
            token_version="1",
            account_status="active",
            is_admin=True,
        )

    def test_options_flow_uses_oauth_bearer_from_context(self):
        search_headers = []
        request_headers = []

        def fake_resilient_get(url, **kwargs):
            search_headers.append(kwargs.get("headers", {}))
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"summary": "A", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]})

        def fake_http_request(method, url, **kwargs):
            request_headers.append((method, kwargs.get("headers", {})))
            return FakeResponse(200, {"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}]})

        self.assertFalse(has_request_context())
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_resilient_get), \
             patch.object(jira_server.HTTP_SESSION, "request", side_effect=fake_http_request):
            result = load_transition_options(
                ["PROD-1"],
                jira_request=jira_server.current_jira_request,
                search_request=jira_server.current_jira_search,
                context=self._context(),
            )

        self.assertEqual(result["issues"][0]["currentStatus"], "To Do")
        self.assertTrue(search_headers)
        self.assertTrue(request_headers)
        for headers in search_headers:
            self.assertEqual(headers.get("Authorization"), "Bearer access-123")
        for _method, headers in request_headers:
            self.assertEqual(headers.get("Authorization"), "Bearer access-123")
            self.assertFalse(str(headers.get("Authorization", "")).startswith("Basic "))

    def test_write_flow_uses_oauth_bearer_from_context(self):
        search_headers = []
        request_headers = []

        def fake_resilient_get(url, **kwargs):
            search_headers.append(kwargs.get("headers", {}))
            return FakeResponse(200, {"issues": [
                {"key": "PROD-1", "fields": {"summary": "A", "status": {"name": "To Do"}, "issuetype": {"name": "Story"}}},
            ]})

        def fake_http_request(method, url, **kwargs):
            request_headers.append((method, kwargs.get("headers", {})))
            if method == "GET":
                return FakeResponse(200, {"transitions": [{"id": "11", "name": "Start", "to": {"name": "In Progress"}}]})
            return FakeResponse(204, {})

        self.assertFalse(has_request_context())
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.object(jira_server, "resilient_jira_get", side_effect=fake_resilient_get), \
             patch.object(jira_server.HTTP_SESSION, "request", side_effect=fake_http_request):
            result = transition_issues(
                ["PROD-1"],
                "In Progress",
                jira_request=jira_server.current_jira_request,
                search_request=jira_server.current_jira_search,
                context=self._context(),
            )

        self.assertEqual(result["succeeded"], 1)
        methods = [method for method, _ in request_headers]
        self.assertIn("GET", methods)
        self.assertIn("POST", methods)
        for headers in search_headers:
            self.assertEqual(headers.get("Authorization"), "Bearer access-123")
        for _method, headers in request_headers:
            self.assertEqual(headers.get("Authorization"), "Bearer access-123")
            self.assertFalse(str(headers.get("Authorization", "")).startswith("Basic "))


class ShapeStatusCatalogTests(unittest.TestCase):
    def test_shapes_catalog_without_raw_jira_fields(self):
        raw = [
            {
                "id": "10000",
                "name": "To Do",
                "description": "internal description",
                "iconUrl": "https://jira.example/icons/generic.png",
                "self": "https://jira.example/rest/api/3/status/10000",
                "statusCategory": {
                    "id": 2,
                    "key": "new",
                    "colorName": "blue-gray",
                    "name": "To Do",
                    "self": "https://jira.example/rest/api/3/statuscategory/2",
                },
            },
        ]
        statuses = shape_status_catalog(raw)
        self.assertEqual(statuses, [{
            "id": "10000",
            "name": "To Do",
            "statusCategoryKey": "new",
            "statusCategoryColor": "blue-gray",
        }])
        for status in statuses:
            self.assertNotIn("self", status)
            self.assertNotIn("description", status)
            self.assertNotIn("iconUrl", status)

    def test_skips_entries_without_id(self):
        self.assertEqual(shape_status_catalog([{"name": "No id"}, None]), [])

    def test_missing_status_category_yields_empty_hints(self):
        self.assertEqual(
            shape_status_catalog([{"id": "1", "name": "Odd"}]),
            [{"id": "1", "name": "Odd", "statusCategoryKey": "", "statusCategoryColor": ""}],
        )


class LoadStatusCatalogTests(unittest.TestCase):
    def test_load_status_catalog_shapes_response(self):
        calls = []

        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            calls.append((method, path, context))
            return FakeResponse(200, [
                {"id": "10000", "name": "To Do", "statusCategory": {"key": "new", "colorName": "blue-gray"}},
            ])

        result = load_status_catalog(jira_request=fake_request, context="ctx")

        self.assertEqual(result, {
            "statuses": [{"id": "10000", "name": "To Do", "statusCategoryKey": "new", "statusCategoryColor": "blue-gray"}],
            "source": "jira",
        })
        self.assertEqual(calls, [("GET", "/rest/api/3/status", "ctx")])

    def test_raises_service_error_on_non_200(self):
        def fake_request(method, path, *, json_body=None, params=None, timeout=30, context=None):
            return FakeResponse(503, [])

        with self.assertRaises(IssueTransitionServiceError) as ctx:
            load_status_catalog(jira_request=fake_request)
        self.assertEqual(ctx.exception.code, "status_catalog_fetch_failed")


if __name__ == "__main__":
    unittest.main()
