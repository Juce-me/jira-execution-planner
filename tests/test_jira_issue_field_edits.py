import ast
import hashlib
import json
from pathlib import Path
import unittest

from backend.auth.context import RequestAuthContext
from backend.auth.jira_auth import AuthError
from backend.services.jira_issue_field_edits import (
    FieldEditInputError,
    FieldEditServiceError,
    load_editable_field,
    search_field_users,
    update_issue_field,
    validate_story_points,
)


FIELD_IDS = {
    "assignee": "assignee",
    "deliveryOwner": "customfield_24001",
    "storyPoints": "customfield_35024",
}


class FakeResponse:
    def __init__(self, status_code=200, payload=None, *, headers=None, json_error=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}
        self._json_error = json_error

    def json(self):
        if self._json_error is not None:
            raise self._json_error
        return self._payload


class ScriptedJira:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, path, *, params=None, json_body=None, timeout=None, context=None):
        self.calls.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
            "timeout": timeout,
            "context": context,
        })
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


def auth_context(*, workspace_id="workspace-1", cloud_id="cloud-1", account_id="me-1"):
    return RequestAuthContext(
        auth_mode="atlassian_oauth",
        user_id=f"user:{account_id}",
        stable_subject=account_id,
        atlassian_account_id=account_id,
        workspace_id=workspace_id,
        auth_connection_id=f"connection:{account_id}",
        cloud_id=cloud_id,
        site_url=f"https://{cloud_id}.example.test",
        token_version="1",
        account_status="active",
        is_admin=False,
        granted_scopes=("read:jira-work", "read:jira-user", "write:jira-work"),
        granted_scopes_verified=True,
    )


def person(account_id, name, *, active=True, email=None):
    payload = {"accountId": account_id, "displayName": name, "active": active}
    if email is not None:
        payload["emailAddress"] = email
    return payload


def issue_payload(field_id, value, *, issue_type="Story", subtask=False,
                  updated="2026-09-08T10:00:00.000+0000", include_field=True):
    fields = {
        "issuetype": {"name": issue_type, "subtask": subtask},
        "updated": updated,
    }
    if include_field:
        fields[field_id] = value
    return {"key": "DEMO-1", "fields": fields}


def editmeta_payload(field_id, logical_field, *, operations=("set",), allowed_values=None,
                     include_field=True):
    if not include_field:
        return {"fields": {}}
    schemas = {
        "assignee": {"type": "user", "system": "assignee"},
        "deliveryOwner": {
            "type": "user",
            "custom": "com.atlassian.jira.plugin.system.customfieldtypes:userpicker",
        },
        "storyPoints": {"type": "number"},
    }
    metadata = {"operations": list(operations), "schema": schemas[logical_field]}
    if allowed_values is not None:
        metadata["allowedValues"] = allowed_values
    return {"fields": {field_id: metadata}}


def mapping_revision(context, field, field_id):
    canonical = json.dumps(
        [context.workspace_id, context.cloud_id, field, field_id],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class StoryPointValidationTests(unittest.TestCase):
    def test_accepts_finite_non_negative_tenths(self):
        for value in (0, 1.5, 2, 3, 2.0):
            with self.subTest(value=value):
                self.assertEqual(validate_story_points(value), value)

    def test_rejects_invalid_targets_before_jira(self):
        for bad in (True, -1, 1.25, None, "1.5", float("inf"), float("nan"), 10 ** 1000):
            with self.subTest(value=bad), self.assertRaises(FieldEditInputError):
                validate_story_points(bad)


class EditableFieldMetadataTests(unittest.TestCase):
    def test_assignee_metadata_uses_exact_requests_and_reports_me_eligibility(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("assignee", person("old-1", "Old Owner"), issue_type="Epic")),
            FakeResponse(200, editmeta_payload("assignee", "assignee")),
            FakeResponse(200, person("me-1", "Current Person", email="me@example.test")),
            FakeResponse(200, [person("me-1", "Current Person")]),
        ])

        result = load_editable_field(
            "demo-1", "assignee", jira_request=jira.request,
            context=context, field_ids=FIELD_IDS,
        )

        self.assertEqual(result["issueKey"], "DEMO-1")
        self.assertTrue(result["editable"])
        self.assertIsNone(result["reason"])
        self.assertEqual(result["currentValue"], {"accountId": "old-1", "displayName": "Old Owner"})
        self.assertEqual(result["baseUpdated"], "2026-09-08T10:00:00.000+0000")
        self.assertEqual(result["mappingRevision"], mapping_revision(context, "assignee", "assignee"))
        self.assertEqual(result["me"], {
            "accountId": "me-1", "displayName": "Current Person",
            "eligibility": "eligible",
        })
        self.assertEqual([call["path"] for call in jira.calls], [
            "/rest/api/3/issue/DEMO-1",
            "/rest/api/3/issue/DEMO-1/editmeta",
            "/rest/api/3/myself",
            "/rest/api/3/user/assignable/search",
        ])
        self.assertEqual(jira.calls[0]["params"], {"fields": "issuetype,updated,assignee"})
        self.assertEqual(jira.calls[3]["params"], {
            "issueKey": "DEMO-1", "accountId": "me-1", "maxResults": 1,
        })
        self.assertTrue(all(call["timeout"] == 10 for call in jira.calls))
        self.assertTrue(all(call["context"] is context for call in jira.calls))

    def test_delivery_owner_without_allowed_values_marks_active_me_unverified(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_24001", None, issue_type="Epic")),
            FakeResponse(200, editmeta_payload("customfield_24001", "deliveryOwner")),
            FakeResponse(200, person("me-1", "Current Person")),
            FakeResponse(200, [person("me-1", "Current Person")]),
        ])
        result = load_editable_field(
            "DEMO-1", "deliveryOwner", jira_request=jira.request,
            context=context, field_ids=FIELD_IDS,
        )
        self.assertEqual(result["me"]["eligibility"], "unverified")
        self.assertIsNone(result["currentValue"])
        self.assertEqual(jira.calls[-1]["path"], "/rest/api/3/user/search")

    def test_people_metadata_marks_unassignable_and_restricted_me_ineligible(self):
        cases = [
            (
                "assignee", "assignee",
                editmeta_payload("assignee", "assignee"), [],
            ),
            (
                "deliveryOwner", "customfield_24001",
                editmeta_payload(
                    "customfield_24001", "deliveryOwner",
                    allowed_values=[person("allowed-1", "Allowed Person")],
                ),
                [person("me-1", "Current Person")],
            ),
        ]
        for field, field_id, editmeta, exact_result in cases:
            with self.subTest(field=field):
                jira = ScriptedJira([
                    FakeResponse(200, issue_payload(
                        field_id, None, issue_type="Epic",
                    )),
                    FakeResponse(200, editmeta),
                    FakeResponse(200, person("me-1", "Current Person")),
                    FakeResponse(200, exact_result),
                ])
                result = load_editable_field(
                    "DEMO-1", field, jira_request=jira.request,
                    context=auth_context(), field_ids=FIELD_IDS,
                )
                self.assertTrue(result["editable"])
                self.assertEqual(result["me"]["eligibility"], "ineligible")

    def test_missing_mapping_returns_disabled_metadata_without_jira(self):
        jira = ScriptedJira([])
        result = load_editable_field(
            "DEMO-1", "deliveryOwner", jira_request=jira.request,
            context=auth_context(), field_ids={**FIELD_IDS, "deliveryOwner": ""},
        )
        self.assertEqual(result, {
            "issueKey": "DEMO-1", "field": "deliveryOwner", "editable": False,
            "reason": "field_mapping_missing", "currentValue": None,
            "baseUpdated": None, "mappingRevision": None, "me": None,
        })
        self.assertEqual(jira.calls, [])

    def test_metadata_fails_closed_for_type_subtask_schema_and_operations(self):
        cases = [
            (issue_payload("customfield_35024", 3, issue_type="Task"),
             editmeta_payload("customfield_35024", "storyPoints"), "issue_type_not_supported"),
            (issue_payload("customfield_35024", 3, issue_type="Story", subtask=True),
             editmeta_payload("customfield_35024", "storyPoints"), "issue_type_not_supported"),
            (issue_payload("customfield_35024", 3),
             editmeta_payload("customfield_35024", "storyPoints", operations=("add",)), "field_not_editable"),
            (issue_payload("customfield_35024", 3),
             {"fields": {"customfield_35024": {"operations": ["set"], "schema": {"type": "string"}}}},
             "field_not_editable"),
            (issue_payload("customfield_35024", 3),
             editmeta_payload("customfield_35024", "storyPoints", include_field=False), "field_not_editable"),
        ]
        for snapshot, editmeta, reason in cases:
            with self.subTest(reason=reason, snapshot=snapshot, editmeta=editmeta):
                jira = ScriptedJira([FakeResponse(200, snapshot), FakeResponse(200, editmeta)])
                result = load_editable_field(
                    "DEMO-1", "storyPoints", jira_request=jira.request,
                    context=auth_context(), field_ids=FIELD_IDS,
                )
                self.assertFalse(result["editable"])
                self.assertEqual(result["reason"], reason)
                if reason == "issue_type_not_supported":
                    self.assertEqual(len(jira.calls), 1)

    def test_missing_requested_field_is_a_read_failure_not_null(self):
        jira = ScriptedJira([FakeResponse(200, issue_payload(
            "customfield_35024", None, include_field=False,
        ))])
        with self.assertRaises(FieldEditServiceError) as caught:
            load_editable_field(
                "DEMO-1", "storyPoints", jira_request=jira.request,
                context=auth_context(), field_ids=FIELD_IDS,
            )
        self.assertEqual(caught.exception.code, "jira_read_failed")
        self.assertEqual(len(jira.calls), 1)
        self.assertEqual(caught.exception.status, 502)

    def test_malformed_subtask_flag_fails_closed(self):
        snapshot = issue_payload("customfield_35024", 3)
        snapshot["fields"]["issuetype"]["subtask"] = "false"
        jira = ScriptedJira([FakeResponse(200, snapshot)])
        with self.assertRaises(FieldEditServiceError) as caught:
            load_editable_field(
                "DEMO-1", "storyPoints", jira_request=jira.request,
                context=auth_context(), field_ids=FIELD_IDS,
            )
        self.assertEqual(caught.exception.code, "jira_read_failed")
        self.assertEqual(len(jira.calls), 1)


class UserSearchTests(unittest.TestCase):
    def test_assignee_search_is_issue_scoped_deduped_and_capped(self):
        context = auth_context()
        results = [
            person("me-1", "Current Person"),
            person("user-1", "One", email="one@example.test"),
            person("user-1", "Duplicate"),
            person("user-2", "Inactive", active=False),
            person("user-null", "Malformed Null", active=None),
            person("user-string", "Malformed String", active="false"),
            {"accountId": "missing-active", "displayName": "Missing Active"},
            {"accountId": "missing-name", "active": True},
            person("user-3", "Three"), person("user-4", "Four"), person("user-5", "Five"),
        ]
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("assignee", None)),
            FakeResponse(200, editmeta_payload("assignee", "assignee")),
            FakeResponse(200, results),
        ])
        result = search_field_users(
            "DEMO-1", {"field": "assignee", "query": "  alpha  "},
            jira_request=jira.request, context=context, field_ids=FIELD_IDS,
        )
        self.assertEqual(result, {
            "issueKey": "DEMO-1", "field": "assignee",
            "options": [
                {"accountId": "user-1", "displayName": "One", "emailAddress": "one@example.test"},
                {"accountId": "user-3", "displayName": "Three"},
                {"accountId": "user-4", "displayName": "Four"},
                {"accountId": "user-5", "displayName": "Five"},
            ],
            "limited": True,
        })
        self.assertEqual(jira.calls[-1]["params"], {
            "issueKey": "DEMO-1", "query": "alpha", "maxResults": 5,
        })

    def test_delivery_owner_search_applies_explicit_allowed_values(self):
        allowed = [person("allowed-1", "Allowed")]
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_24001", None, issue_type="Epic")),
            FakeResponse(200, editmeta_payload(
                "customfield_24001", "deliveryOwner", allowed_values=allowed,
            )),
            FakeResponse(200, [person("allowed-1", "Allowed"), person("other-1", "Other")]),
        ])
        result = search_field_users(
            "DEMO-1", {"field": "deliveryOwner", "query": "allow"},
            jira_request=jira.request, context=auth_context(), field_ids=FIELD_IDS,
        )
        self.assertEqual(result["options"], [{"accountId": "allowed-1", "displayName": "Allowed"}])
        self.assertEqual(jira.calls[-1]["path"], "/rest/api/3/user/search")
        self.assertEqual(jira.calls[-1]["params"], {"query": "allow", "maxResults": 5})

    def test_search_rejects_invalid_contract_before_jira(self):
        bad_payloads = [
            None,
            {"field": "storyPoints", "query": "alpha"},
            {"field": "assignee", "query": "ab"},
            {"field": "assignee", "query": "x" * 201},
            {"field": "assignee", "query": "alpha", "fieldId": "customfield_1"},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                jira = ScriptedJira([])
                with self.assertRaises(FieldEditInputError):
                    search_field_users(
                        "DEMO-1", payload, jira_request=jira.request,
                        context=auth_context(), field_ids=FIELD_IDS,
                    )
                self.assertEqual(jira.calls, [])

    def test_search_requires_array_response(self):
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("assignee", None)),
            FakeResponse(200, editmeta_payload("assignee", "assignee")),
            FakeResponse(200, {"values": []}),
        ])
        with self.assertRaises(FieldEditServiceError) as caught:
            search_field_users(
                "DEMO-1", {"field": "assignee", "query": "alpha"},
                jira_request=jira.request, context=auth_context(), field_ids=FIELD_IDS,
            )
        self.assertEqual(caught.exception.code, "jira_read_failed")


class UpdateIssueFieldTests(unittest.TestCase):
    def payload(self, context, *, field="storyPoints", value=1.5, base_value=1):
        return {
            "field": field,
            "value": value,
            "baseValue": base_value,
            "baseUpdated": "2026-09-08T10:00:00.000+0000",
            "mappingRevision": mapping_revision(context, field, FIELD_IDS[field]),
        }

    def test_story_points_success_puts_one_server_owned_field_and_reads_back(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
            FakeResponse(204),
            FakeResponse(200, issue_payload(
                "customfield_35024", 1.5, updated="2026-09-08T10:01:00.000+0000",
            )),
        ])
        invalidations = []
        result = update_issue_field(
            "DEMO-1", self.payload(context), jira_request=jira.request,
            context=context, field_ids=FIELD_IDS, invalidate=invalidations.append,
        )

        put_call = next(call for call in jira.calls if call["method"] == "PUT")
        self.assertEqual(put_call["json_body"], {"fields": {"customfield_35024": 1.5}})
        self.assertEqual(sum(call["method"] == "PUT" for call in jira.calls), 1)
        self.assertIs(put_call["context"], context)
        self.assertEqual(result["value"], 1.5)
        self.assertEqual(result, {
            "issueKey": "DEMO-1", "field": "storyPoints", "result": "success",
            "value": 1.5, "updated": "2026-09-08T10:01:00.000+0000",
        })
        self.assertEqual(invalidations, ["issue_field_edit"])

    def test_person_update_uses_account_id_only_and_returns_canonical_identity(self):
        context = auth_context()
        payload = self.payload(
            context, field="assignee", value={"accountId": "new-1"},
            base_value={"accountId": "old-1"},
        )
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("assignee", person("old-1", "Old"), issue_type="Epic")),
            FakeResponse(200, editmeta_payload("assignee", "assignee")),
            FakeResponse(200, [person("new-1", "New Owner")]),
            FakeResponse(204),
            FakeResponse(200, issue_payload(
                "assignee", person("new-1", "Canonical Owner"), issue_type="Epic",
            )),
        ])
        result = update_issue_field(
            "DEMO-1", payload, jira_request=jira.request, context=context,
            field_ids=FIELD_IDS, invalidate=lambda _reason: None,
        )
        put_call = next(call for call in jira.calls if call["method"] == "PUT")
        self.assertEqual(put_call["json_body"], {"fields": {"assignee": {"accountId": "new-1"}}})
        self.assertEqual(result["value"], {"accountId": "new-1", "displayName": "Canonical Owner"})

    def test_noop_returns_confirmed_value_without_put_or_invalidation(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1.5)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
        ])
        invalidations = []
        result = update_issue_field(
            "DEMO-1", self.payload(context, value=1.5, base_value=1.5),
            jira_request=jira.request, context=context, field_ids=FIELD_IDS,
            invalidate=invalidations.append,
        )
        self.assertEqual(result["result"], "unchanged")
        self.assertEqual([call for call in jira.calls if call["method"] == "PUT"], [])
        self.assertEqual(invalidations, [])

    def test_changed_baseline_returns_sanitized_conflict_snapshot(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 3)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
        ])
        with self.assertRaises(FieldEditServiceError) as caught:
            update_issue_field(
                "DEMO-1", self.payload(context, value=2, base_value=1),
                jira_request=jira.request, context=context, field_ids=FIELD_IDS,
                invalidate=lambda _reason: None,
            )
        self.assertEqual(caught.exception.code, "stale_issue")
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.details, {
            "issueKey": "DEMO-1", "field": "storyPoints", "currentValue": 3,
            "baseUpdated": "2026-09-08T10:00:00.000+0000",
            "mappingRevision": mapping_revision(context, "storyPoints", "customfield_35024"),
        })

    def test_changed_mapping_is_rejected_before_jira(self):
        context = auth_context()
        payload = self.payload(context)
        jira = ScriptedJira([])
        with self.assertRaises(FieldEditServiceError) as caught:
            update_issue_field(
                "DEMO-1", payload, jira_request=jira.request, context=context,
                field_ids={**FIELD_IDS, "storyPoints": "customfield_99999"},
                invalidate=lambda _reason: None,
            )
        self.assertEqual(caught.exception.code, "field_mapping_changed")
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(jira.calls, [])

    def test_timeout_and_unreadable_success_are_unknown_and_invalidate_once(self):
        context = auth_context()
        cases = [
            [
                FakeResponse(200, issue_payload("customfield_35024", 1)),
                FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
                TimeoutError("dispatch outcome hidden"),
            ],
            [
                FakeResponse(200, issue_payload("customfield_35024", 1)),
                FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
                FakeResponse(204),
                FakeResponse(200, json_error=ValueError("not json")),
            ],
            [
                FakeResponse(200, issue_payload("customfield_35024", 1)),
                FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
                FakeResponse(204),
                FakeResponse(200, issue_payload("customfield_35024", None, include_field=False)),
            ],
        ]
        for responses in cases:
            with self.subTest(responses=len(responses)):
                jira = ScriptedJira(responses)
                invalidations = []
                with self.assertRaises(FieldEditServiceError) as caught:
                    update_issue_field(
                        "DEMO-1", self.payload(context), jira_request=jira.request,
                        context=context, field_ids=FIELD_IDS, invalidate=invalidations.append,
                    )
                self.assertEqual(caught.exception.code, "write_outcome_unknown")
                self.assertEqual(caught.exception.status, 503)
                self.assertEqual(caught.exception.details, {"issueKey": "DEMO-1", "field": "storyPoints"})
                self.assertEqual(invalidations, ["issue_field_edit"])
                self.assertEqual(sum(call["method"] == "PUT" for call in jira.calls), 1)

    def test_accepted_put_then_readback_401_preserves_auth_recovery(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
            FakeResponse(204),
            FakeResponse(401),
        ])
        invalidations = []
        with self.assertRaises(AuthError) as caught:
            update_issue_field(
                "DEMO-1", self.payload(context), jira_request=jira.request,
                context=context, field_ids=FIELD_IDS, invalidate=invalidations.append,
            )
        self.assertEqual(caught.exception.code, "auth_required")
        self.assertEqual(invalidations, ["issue_field_edit"])

    def test_known_put_statuses_are_sanitized_and_do_not_invalidate(self):
        context = auth_context()
        cases = [
            (400, {}, "jira_field_rejected", 409),
            (403, {}, "jira_edit_forbidden", 403),
            (404, {}, "issue_not_found", 404),
            (409, {}, "stale_issue", 409),
            (422, {}, "jira_configuration_invalid", 409),
            (429, {"Retry-After": "120"}, "jira_rate_limited", 429),
        ]
        for status, headers, code, app_status in cases:
            with self.subTest(status=status):
                jira = ScriptedJira([
                    FakeResponse(200, issue_payload("customfield_35024", 1)),
                    FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
                    FakeResponse(status, headers=headers),
                ])
                invalidations = []
                with self.assertRaises(FieldEditServiceError) as caught:
                    update_issue_field(
                        "DEMO-1", self.payload(context), jira_request=jira.request,
                        context=context, field_ids=FIELD_IDS, invalidate=invalidations.append,
                    )
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(caught.exception.status, app_status)
                if status == 429:
                    self.assertEqual(caught.exception.details["retryAfterSeconds"], 60)
                self.assertEqual(invalidations, [])

    def test_ambiguous_upstream_5xx_is_unknown_and_invalidates(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
            FakeResponse(503),
        ])
        invalidations = []
        with self.assertRaises(FieldEditServiceError) as caught:
            update_issue_field(
                "DEMO-1", self.payload(context), jira_request=jira.request,
                context=context, field_ids=FIELD_IDS, invalidate=invalidations.append,
            )
        self.assertEqual(caught.exception.code, "write_outcome_unknown")
        self.assertEqual(invalidations, ["issue_field_edit"])

    def test_put_conflict_reads_fresh_baseline_when_available(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
            FakeResponse(409),
            FakeResponse(200, issue_payload(
                "customfield_35024", 3,
                updated="2026-09-08T10:02:00.000+0000",
            )),
        ])
        with self.assertRaises(FieldEditServiceError) as caught:
            update_issue_field(
                "DEMO-1", self.payload(context), jira_request=jira.request,
                context=context, field_ids=FIELD_IDS, invalidate=lambda _reason: None,
            )
        self.assertEqual(caught.exception.code, "stale_issue")
        self.assertEqual(caught.exception.details["currentValue"], 3)
        self.assertEqual(caught.exception.details["baseUpdated"], "2026-09-08T10:02:00.000+0000")
        self.assertEqual(len(jira.calls), 4)

    def test_unclassified_post_dispatch_status_is_unknown_and_invalidates(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
            FakeResponse(418),
        ])
        invalidations = []
        with self.assertRaises(FieldEditServiceError) as caught:
            update_issue_field(
                "DEMO-1", self.payload(context), jira_request=jira.request,
                context=context, field_ids=FIELD_IDS, invalidate=invalidations.append,
            )
        self.assertEqual(caught.exception.code, "write_outcome_unknown")
        self.assertEqual(invalidations, ["issue_field_edit"])

    def test_invalid_payloads_make_zero_jira_calls(self):
        context = auth_context()
        bad_payloads = [
            None,
            {"field": "storyPoints"},
            {**self.payload(context), "fieldId": "customfield_1"},
            {**self.payload(context), "baseValue": True},
            {**self.payload(context), "baseValue": 10 ** 1000},
            {**self.payload(context), "mappingRevision": None},
            self.payload(context, field="assignee", value={"accountId": "bad\nvalue"}, base_value=None),
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                jira = ScriptedJira([])
                with self.assertRaises(FieldEditInputError):
                    update_issue_field(
                        "DEMO-1", payload, jira_request=jira.request,
                        context=context, field_ids=FIELD_IDS, invalidate=lambda _reason: None,
                    )
                self.assertEqual(jira.calls, [])

    def test_existing_higher_precision_story_point_baseline_is_allowed(self):
        context = auth_context()
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_35024", 1.25)),
            FakeResponse(200, editmeta_payload("customfield_35024", "storyPoints")),
            FakeResponse(204),
            FakeResponse(200, issue_payload("customfield_35024", 2)),
        ])
        result = update_issue_field(
            "DEMO-1", self.payload(context, value=2, base_value=1.25),
            jira_request=jira.request, context=context, field_ids=FIELD_IDS,
            invalidate=lambda _reason: None,
        )
        self.assertEqual(result["value"], 2)

    def test_denied_exact_person_lookup_is_target_unavailable(self):
        context = auth_context()
        payload = self.payload(
            context, field="deliveryOwner", value={"accountId": "new-1"},
            base_value=None,
        )
        jira = ScriptedJira([
            FakeResponse(200, issue_payload("customfield_24001", None, issue_type="Epic")),
            FakeResponse(200, editmeta_payload("customfield_24001", "deliveryOwner")),
            FakeResponse(403),
        ])
        with self.assertRaises(FieldEditServiceError) as caught:
            update_issue_field(
                "DEMO-1", payload, jira_request=jira.request, context=context,
                field_ids=FIELD_IDS, invalidate=lambda _reason: None,
            )
        self.assertEqual(caught.exception.code, "target_unavailable")
        self.assertEqual(caught.exception.status, 409)


class SourceGuardTests(unittest.TestCase):
    def test_service_has_no_forbidden_transport_or_credential_imports(self):
        path = Path(__file__).resolve().parents[1] / "backend/services/jira_issue_field_edits.py"
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.append(node.module)
        forbidden = [
            name for name in imported
            if name == "requests"
            or name.startswith("backend.epm")
            or name.startswith("backend.auth.home_credentials")
            or name.startswith("backend.auth.local_oauth_store")
            or "service_integration" in name
        ]
        self.assertEqual(forbidden, [])
        for forbidden_symbol in (
            "oauth_session_data", "resolve_home_credential", "build_jira_headers",
            "JIRA_EMAIL", "JIRA_TOKEN", "autoCompleteUrl",
        ):
            self.assertNotIn(forbidden_symbol, source)


if __name__ == "__main__":
    unittest.main()
