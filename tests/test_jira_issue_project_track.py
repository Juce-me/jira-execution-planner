import unittest

from backend.services.jira_issue_project_track import (
    ProjectTrackInputError,
    ProjectTrackServiceError,
    load_project_track_options_for_issue,
    normalize_project_track_target,
    update_issue_project_track,
)


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def field_id():
    return "customfield_35024"


def issue_payload(issue_type="Epic", track="Flexible"):
    fields = {"issuetype": {"name": issue_type}}
    fields["customfield_35024"] = {"value": track} if track is not None else None
    return {"fields": fields}


def editmeta_payload(values=("Flexible", "Committed"), include_field=True):
    if not include_field:
        return {"fields": {}}
    allowed = [
        {"id": str(100 + index), "value": value}
        for index, value in enumerate(values)
    ]
    return {"fields": {"customfield_35024": {"allowedValues": allowed}}}


class ScriptedJira:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, path, *, params=None, json_body=None, context=None):
        self.calls.append({
            "method": method,
            "path": path,
            "params": params,
            "json_body": json_body,
            "context": context,
        })
        return self.responses.pop(0)


class NormalizeTargetTests(unittest.TestCase):
    def test_accepts_canonical_targets_case_insensitively(self):
        self.assertEqual(normalize_project_track_target(" committed "), "Committed")
        self.assertEqual(normalize_project_track_target("FLEXIBLE"), "Flexible")

    def test_rejects_unknown_targets(self):
        for bad in ("", None, "Blocked", "flexible;drop", 5):
            with self.assertRaises(ProjectTrackInputError) as ctx:
                normalize_project_track_target(bad)
            self.assertEqual(ctx.exception.code, "invalid_project_track")


class LoadOptionsTests(unittest.TestCase):
    def test_returns_canonical_options_from_editmeta_without_ids(self):
        jira = ScriptedJira([FakeResponse(200, editmeta_payload())])
        result = load_project_track_options_for_issue(
            "product-1", jira_request=jira.request,
            get_project_track_field_id=field_id, context="ctx",
        )
        self.assertEqual(result, {
            "options": [{"value": "Flexible"}, {"value": "Committed"}],
            "source": "jira",
        })
        self.assertEqual(jira.calls[0]["path"], "/rest/api/3/issue/PRODUCT-1/editmeta")
        self.assertEqual(jira.calls[0]["context"], "ctx")

    def test_missing_field_raises_not_editable(self):
        jira = ScriptedJira([FakeResponse(200, editmeta_payload(include_field=False))])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            load_project_track_options_for_issue(
                "PRODUCT-1", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "project_track_not_editable")

    def test_no_expected_options_raises_not_editable(self):
        jira = ScriptedJira([FakeResponse(200, editmeta_payload(values=("Other",)))])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            load_project_track_options_for_issue(
                "PRODUCT-1", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "project_track_not_editable")

    def test_editmeta_404_raises_issue_not_found(self):
        jira = ScriptedJira([FakeResponse(404)])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            load_project_track_options_for_issue(
                "PRODUCT-1", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "issue_not_found")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_invalid_issue_key_raises_before_any_jira_call(self):
        jira = ScriptedJira([])
        with self.assertRaises(ProjectTrackInputError):
            load_project_track_options_for_issue(
                "bad key;", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(jira.calls, [])


class UpdateProjectTrackTests(unittest.TestCase):
    def test_success_puts_exact_server_owned_body(self):
        jira = ScriptedJira([
            FakeResponse(200, issue_payload(track="Flexible")),
            FakeResponse(200, editmeta_payload()),
            FakeResponse(204),
        ])
        result = update_issue_project_track(
            "product-1", "committed", jira_request=jira.request,
            get_project_track_field_id=field_id, context="ctx",
        )
        self.assertEqual(result, {
            "issueKey": "PRODUCT-1",
            "result": "success",
            "fromTrack": "Flexible",
            "toTrack": "Committed",
        })
        put_call = jira.calls[2]
        self.assertEqual(put_call["method"], "PUT")
        self.assertEqual(put_call["path"], "/rest/api/3/issue/PRODUCT-1")
        self.assertEqual(put_call["json_body"], {
            "fields": {"customfield_35024": {"id": "101"}},
        })
        self.assertEqual(set(put_call["json_body"]), {"fields"})
        self.assertEqual(set(put_call["json_body"]["fields"]), {"customfield_35024"})
        snapshot_call = jira.calls[0]
        self.assertEqual(snapshot_call["params"], {"fields": "issuetype,customfield_35024"})

    def test_already_in_track_is_noop_without_editmeta_or_put(self):
        jira = ScriptedJira([FakeResponse(200, issue_payload(track="Committed"))])
        result = update_issue_project_track(
            "PRODUCT-1", "Committed", jira_request=jira.request,
            get_project_track_field_id=field_id,
        )
        self.assertEqual(result, {
            "issueKey": "PRODUCT-1",
            "result": "already_in_track",
            "fromTrack": "Committed",
        })
        self.assertEqual(len(jira.calls), 1)

    def test_non_epic_rejected_without_write(self):
        jira = ScriptedJira([FakeResponse(200, issue_payload(issue_type="Story"))])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            update_issue_project_track(
                "PRODUCT-1", "Committed", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "issue_not_epic")
        self.assertEqual(len(jira.calls), 1)

    def test_unidentified_track_can_be_assigned(self):
        jira = ScriptedJira([
            FakeResponse(200, issue_payload(track=None)),
            FakeResponse(200, editmeta_payload()),
            FakeResponse(204),
        ])
        result = update_issue_project_track(
            "PRODUCT-1", "Flexible", jira_request=jira.request,
            get_project_track_field_id=field_id,
        )
        self.assertEqual(result["result"], "success")
        self.assertEqual(result["fromTrack"], "")
        self.assertEqual(result["toTrack"], "Flexible")

    def test_option_unavailable_raises_before_put(self):
        jira = ScriptedJira([
            FakeResponse(200, issue_payload(track="Flexible")),
            FakeResponse(200, editmeta_payload(values=("Flexible",))),
        ])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            update_issue_project_track(
                "PRODUCT-1", "Committed", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "project_track_option_unavailable")
        self.assertEqual(len(jira.calls), 2)

    def test_missing_editmeta_field_raises_not_editable(self):
        jira = ScriptedJira([
            FakeResponse(200, issue_payload(track="Flexible")),
            FakeResponse(200, editmeta_payload(include_field=False)),
        ])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            update_issue_project_track(
                "PRODUCT-1", "Committed", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "project_track_not_editable")

    def test_snapshot_404_raises_issue_not_found(self):
        jira = ScriptedJira([FakeResponse(404)])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            update_issue_project_track(
                "PRODUCT-1", "Committed", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "issue_not_found")

    def test_put_failure_sanitized_without_raw_body(self):
        jira = ScriptedJira([
            FakeResponse(200, issue_payload(track="Flexible")),
            FakeResponse(200, editmeta_payload()),
            FakeResponse(403, {"errorMessages": ["secret detail"]}),
        ])
        with self.assertRaises(ProjectTrackServiceError) as ctx:
            update_issue_project_track(
                "PRODUCT-1", "Committed", jira_request=jira.request,
                get_project_track_field_id=field_id,
            )
        self.assertEqual(ctx.exception.code, "project_track_update_failed")
        self.assertNotIn("secret detail", repr(ctx.exception))

    def test_module_has_no_forbidden_imports(self):
        import backend.services.jira_issue_project_track as module
        source = open(module.__file__, encoding="utf-8").read()
        for forbidden in ("flask", "requests", "build_jira_headers",
                          "backend.epm", "townsquare", "service_integration",
                          "oauth_session_data", "OAUTH_TOKEN_STORE"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
