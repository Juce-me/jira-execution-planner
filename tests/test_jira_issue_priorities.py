import unittest

from backend.services.jira_issue_priorities import (
    IssuePriorityInputError,
    IssuePriorityServiceError,
    MAX_PRIORITY_UPDATE_ISSUES,
    load_priority_options,
    update_issue_priorities,
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
    """Fake ``jira_request`` recording priority catalog GETs and issue PUTs."""

    def __init__(self):
        self.calls = []
        self.get_response = FakeResponse(200, [])
        self.put_responses = {}
        self.default_put = FakeResponse(204, {})

    def request(self, method, path, *, json_body=None, params=None, timeout=30, context=None):
        self.calls.append({"method": method, "path": path, "json_body": json_body, "context": context})
        if method == "GET":
            return self.get_response
        key = path.rsplit("/", 1)[1]
        return self.put_responses.get(key, self.default_put)


def _snapshot(key, priority_id, priority_name):
    return {"key": key, "fields": {"priority": {"id": priority_id, "name": priority_name}}}


class LoadPriorityOptionsTests(unittest.TestCase):
    def test_load_priority_options_shapes_catalog_without_raw_jira_body(self):
        jira = RecordingJira()
        jira.get_response = FakeResponse(200, [
            {"id": "1", "name": "Highest", "statusColor": "#ff5630", "iconUrl": "https://x/1.svg", "self": "https://jira/priority/1"},
            {"id": "2", "name": "High", "statusColor": "#ff7452", "iconUrl": "https://x/2.svg", "self": "https://jira/priority/2"},
            {"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": "https://x/3.svg", "self": "https://jira/priority/3"},
        ])

        result = load_priority_options(jira_request=jira.request, context="ctx")

        self.assertEqual(result["source"], "jira")
        # Jira returns priorities in urgency order; shaping must preserve that
        # order rather than re-sorting, and rank must derive from position.
        self.assertEqual([p["id"] for p in result["priorities"]], ["1", "2", "3"])
        self.assertEqual([p["rank"] for p in result["priorities"]], [10, 20, 30])
        self.assertEqual(result["priorities"][0], {
            "id": "1",
            "name": "Highest",
            "statusColor": "#ff5630",
            "iconUrl": "https://x/1.svg",
            "rank": 10,
        })
        for option in result["priorities"]:
            self.assertNotIn("self", option)
        self.assertEqual(jira.calls[0]["path"], "/rest/api/3/priority")
        self.assertEqual(jira.calls[0]["context"], "ctx")

    def test_raises_service_error_on_non_200(self):
        jira = RecordingJira()
        jira.get_response = FakeResponse(503, [])
        with self.assertRaises(IssuePriorityServiceError) as ctx:
            load_priority_options(jira_request=jira.request)
        self.assertEqual(ctx.exception.code, "priority_options_fetch_failed")


class UpdateIssuePrioritiesTests(unittest.TestCase):
    def test_update_issue_priorities_posts_priority_id_only(self):
        search = make_search([_snapshot("PROD-1", "2", "High")])
        jira = RecordingJira()
        jira.get_response = FakeResponse(200, [
            {"id": "1", "name": "Highest", "statusColor": "#ff5630", "iconUrl": "https://x/1.svg"},
            {"id": "2", "name": "High", "statusColor": "#ff7452", "iconUrl": "https://x/2.svg"},
            {"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": "https://x/3.svg"},
        ])
        jira.put_responses["PROD-1"] = FakeResponse(204, {})

        result = update_issue_priorities(
            ["PROD-1"], "3", jira_request=jira.request, search_request=search, context="ctx"
        )

        puts = [c for c in jira.calls if c["method"] == "PUT"]
        self.assertEqual(len(puts), 1)
        self.assertEqual(puts[0]["path"], "/rest/api/3/issue/PROD-1")
        self.assertEqual(puts[0]["json_body"], {"fields": {"priority": {"id": "3"}}})
        self.assertEqual(set(puts[0]["json_body"].keys()), {"fields"})
        self.assertEqual(set(puts[0]["json_body"]["fields"].keys()), {"priority"})
        self.assertEqual(puts[0]["context"], "ctx")

        self.assertEqual(result["requested"], 1)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["targetPriority"], {"id": "3", "name": "Major"})
        self.assertEqual(
            result["results"][0],
            {"key": "PROD-1", "result": "success", "fromPriority": "High", "toPriority": "Major"},
        )

    def test_update_issue_priorities_treats_same_priority_as_success_without_put(self):
        search = make_search([_snapshot("PROD-1", "3", "Major")])
        jira = RecordingJira()

        result = update_issue_priorities(["PROD-1"], "3", jira_request=jira.request, search_request=search)

        self.assertEqual(result["results"][0]["result"], "already_in_priority")
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 0)
        # No PUT, and no catalog fetch either: the snapshot already answers
        # the target priority's name, so no Jira call at all is needed.
        self.assertEqual(jira.calls, [])

    def test_update_issue_priorities_caps_and_validates_inputs(self):
        recorder = []
        search = make_search([], recorder=recorder)
        jira = RecordingJira()

        with self.assertRaises(IssuePriorityInputError) as ctx:
            update_issue_priorities(["PROD"], "3", jira_request=jira.request, search_request=search)
        self.assertEqual(ctx.exception.code, "invalid_issue_key")

        with self.assertRaises(IssuePriorityInputError) as ctx:
            update_issue_priorities(["PROD-1"], "", jira_request=jira.request, search_request=search)
        self.assertEqual(ctx.exception.code, "target_priority_required")

        with self.assertRaises(IssuePriorityInputError) as ctx:
            update_issue_priorities(["PROD-1"], "abc", jira_request=jira.request, search_request=search)
        self.assertEqual(ctx.exception.code, "invalid_priority_id")

        keys = [f"PROD-{i}" for i in range(1, MAX_PRIORITY_UPDATE_ISSUES + 2)]
        with self.assertRaises(IssuePriorityInputError) as ctx:
            update_issue_priorities(keys, "3", jira_request=jira.request, search_request=search)
        self.assertEqual(ctx.exception.code, "too_many_issues")

        self.assertEqual(recorder, [])
        self.assertEqual(jira.calls, [])

    def test_sanitizes_put_errors_without_raw_body(self):
        search = make_search([_snapshot("PROD-1", "2", "High")])
        jira = RecordingJira()
        jira.get_response = FakeResponse(200, [{"id": "3", "name": "Major", "statusColor": "#ffab00", "iconUrl": "https://x/3.svg"}])
        jira.put_responses["PROD-1"] = FakeResponse(403, {"errorMessages": ["forbidden detail"]})

        result = update_issue_priorities(["PROD-1"], "3", jira_request=jira.request, search_request=search)

        failure = result["results"][0]
        self.assertEqual(failure, {"key": "PROD-1", "result": "failure", "error": "priority_forbidden"})
        self.assertNotIn("forbidden detail", repr(result))

    def test_snapshot_failure_raises_service_error_before_any_put(self):
        search = make_search([], status_code=502)
        jira = RecordingJira()

        with self.assertRaises(IssuePriorityServiceError) as ctx:
            update_issue_priorities(["PROD-1"], "3", jira_request=jira.request, search_request=search)

        self.assertEqual(ctx.exception.code, "issue_priority_snapshot_fetch_failed")
        self.assertEqual(jira.calls, [])


if __name__ == "__main__":
    unittest.main()
