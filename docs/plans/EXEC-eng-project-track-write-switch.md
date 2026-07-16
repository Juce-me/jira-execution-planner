# ENG Project Track Write Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Goal:** Let a signed-in ENG user change a real Epic's configured Jira `Project Track[Dropdown]` field between `Flexible` and `Committed` from the existing Epic-header indicator, with `⚪` rendered for unidentified tracks, mirroring the shipped ENG status/priority update contracts exactly.

**Architecture:** Add a dependency-injected `backend/services/jira_issue_project_track.py` service (mirror of `jira_issue_priorities.py`, single-issue), two OAuth-gated routes in `backend/routes/eng_routes.py` (`GET /api/issues/project-track/options`, `POST /api/issues/project-track`), and a frontend stack (`jiraIssueApi.js` wrappers → `useEngProjectTrackTransitions` hook → `ProjectTrackTransitionMenu` composing `IssueFieldOptionMenu`) wired into `renderEpicBlock`. The server owns the configured field id and resolves option ids from each issue's `editmeta` at submission time; the browser submits only an Epic key and a canonical target.

**Tech Stack:** Python 3.10+ Flask blueprints, Jira Cloud REST v3 (`editmeta`, issue edit PUT), Atlassian OAuth 3LO with token-bound CSRF, React 19, existing `trackedFetch` wrappers, `enqueueEngIssueMutation` queue, Node `--test`, Python `unittest`, Playwright, esbuild.

**Design contract:** `docs/plans/SUPPORT-eng-project-track-write-switch-design.md` (user-approved 2026-07-16). Its "Similarity to Status and Priority Updates" table is an acceptance contract.

## Status

In progress on branch `feature/eng-project-track-write-switch`. Rename to `DONE-*` only after implementation is completed, verified, and merged per `docs/plans/AGENTS.md`. Track per-task completion in the checkboxes below.

## Global Constraints

- Service module must never import Flask, `requests`, `build_jira_headers`, `backend.epm`, Home/Townsquare helpers, service integrations, or local OAuth token-store helpers.
- Only the signed-in user's Jira OAuth context (`current_jira_request` + `RequestAuthContext`) performs Jira calls. Negative tests patch `jira_server.build_jira_headers` to fail on any Basic fallback.
- The browser never supplies a Jira field id, option id, field name, or update document.
- Canonical targets are exactly `Flexible` and `Committed` (case-insensitive at HTTP boundary, canonical in results). No clearing to null.
- EPM, Statistics, Scenario, Settings, and the synthetic `NO_EPIC` group stay inert — no Project Track write props, API imports, or API calls.
- Analytics: one new event `issue_project_track_action` (`feature_name=eng_project_track_changes`) and one new API surface `jira_issue_project_track`; reuse existing param keys only; never emit issue keys, raw values, field ids, option ids, or raw errors.
- No startup fetch, polling, or catalog warming; options load only on menu open.
- Frontend source changes require `npm run build` and committing `frontend/dist` (CI clean-diff gate).
- Structure budgets: `frontend/src/dashboard.jsx` budget (currently 15965 in `tests/test_codebase_structure_budgets.py`) must be ratcheted with a comment if the file grows; `jira_server.py` must not grow (no changes planned there).
- Commit messages: descriptive, no agent branding, no Co-Authored-By.

## Endpoint Contracts

| Contract | Options | Write |
| --- | --- | --- |
| Route | `GET /api/issues/project-track/options?issueKey=<key>` | `POST /api/issues/project-track` |
| Policy | `authenticated_read` + explicit `JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH → 403 jira_oauth_required` | `user_write` + same explicit OAuth-mode gate |
| Headers | `X-Requested-With: jira-execution-planner` | `X-Requested-With` + token-bound `X-CSRF-Token` (central guard) |
| OAuth scope | Existing read scope | `_missing_write_jira_work_scope` check before any Jira call → `401 missing_oauth_scope` |
| Request | One validated `issueKey` query value | `{"issueKey":"PRODUCT-1","targetTrack":"Committed"}` |
| Success | `200 {"options":[{"value":"Flexible"},{"value":"Committed"}],"source":"jira"}` (option ids server-owned) | `200 {"issueKey":"PRODUCT-1","result":"success","fromTrack":"Flexible","toTrack":"Committed"}` or `"result":"already_in_track"` (with `fromTrack` only) |
| Input errors | `400 invalid_issue_key` | `400 invalid_json` / `invalid_issue_key` / `invalid_project_track` |
| Jira state errors | `404 issue_not_found`; `409 project_track_not_editable` (field absent or both expected options unavailable) | `404 issue_not_found`; `409 issue_not_epic` / `project_track_not_editable` / `project_track_option_unavailable` |
| Auth errors | 401 auth recovery; `403 jira_oauth_required` | same + `401 missing_oauth_scope`; guard `403 csrf_required` |
| Upstream failure | `502 jira_project_track_options_failed` | `502 jira_project_track_update_failed` |

Cache invalidation: `clear_jira_issue_status_caches(reason='issue_project_track_update')` only when the write result is `success` — never for validation failures, `already_in_track`, or failed writes.

## File Map

- Create: `backend/services/jira_issue_project_track.py`
- Create: `tests/test_jira_issue_project_track.py`
- Modify: `backend/routes/eng_routes.py` (new routes after `post_issue_priorities`)
- Modify: `backend/security/policy.py` (two `EndpointPolicy` rows)
- Modify: `tests/endpoint_security_samples.py`, `tests/test_endpoint_security_matrix.py` (SECURITY_SAMPLES), `tests/test_endpoint_policy_inventory.py`
- Modify: `tests/test_oauth_eng_routes.py` (new `IssueProjectTrackRouteTests` class)
- Modify: `frontend/src/eng/engTaskUtils.js` (`getProjectTrackEmoji` ⚪ fallback + label helper)
- Create: `frontend/src/eng/engProjectTrackTransitionUtils.js`
- Create: `frontend/src/eng/useEngProjectTrackTransitions.js`
- Create: `frontend/src/issues/ProjectTrackTransitionMenu.jsx`
- Modify: `frontend/src/api/jiraIssueApi.js` (two wrappers)
- Modify: `frontend/src/analytics/events.js`, `frontend/src/analytics/analytics.js`, `frontend/src/analytics/dashboardAnalytics.js`
- Modify: `frontend/src/dashboard.jsx` (hook wiring ~11037-11089 area; `renderEpicBlock` indicator ~12683-12691)
- Modify: `frontend/src/styles/eng/status-transitions.css`, `frontend/src/styles/eng/epics.css`
- Create: `tests/test_eng_project_track_transition_utils.js`
- Modify: `tests/test_eng_epic_sort.js` (⚪ assertions), `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`
- Create: `tests/ui/eng_project_track_transitions.spec.js`
- Modify: `tests/test_codebase_structure_budgets.py` (ratchet `frontend/src/dashboard.jsx` if needed)
- Modify: `docs/README_ANALYTICS.md`, `docs/plans/README.md`, `docs/plans/GATE-05-home-write-capability.md` (sweep note), this plan (status)
- Generated: `frontend/dist/*` via `npm run build`

---

## Task 1: Backend Project Track service

**Files:**
- Create: `backend/services/jira_issue_project_track.py`
- Test: `tests/test_jira_issue_project_track.py`

**Interfaces:**
- Consumes: `normalize_issue_keys`, `IssueTransitionInputError` from `backend.services.jira_issue_transitions`; injected `jira_request(method, path, *, params=None, json_body=None, context=None)` returning an object with `.status_code` and `.json()`; injected `get_project_track_field_id()` returning the configured field id string.
- Produces: `ProjectTrackInputError(code)`, `ProjectTrackServiceError(code, status_code=None)`, `CANONICAL_TRACKS = ("Flexible", "Committed")`, `normalize_project_track_target(value) -> str`, `load_project_track_options_for_issue(issue_key, *, jira_request, get_project_track_field_id, context=None) -> {"options": [{"value": str}], "source": "jira"}`, `update_issue_project_track(issue_key, target_track, *, jira_request, get_project_track_field_id, context=None) -> {"issueKey", "result", "fromTrack"[, "toTrack"]}`.

- [x] **Step 1.1: Write the failing tests.** Create `tests/test_jira_issue_project_track.py` mirroring `tests/test_jira_issue_priorities.py` fakes (`FakeResponse` with `status_code`/`json()`, a `RecordingJira` capturing `{method, path, params, json_body, context}`):

```python
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
```

- [x] **Step 1.2: Run to confirm failure.** `.venv/bin/python -m unittest tests.test_jira_issue_project_track -v` → FAIL (`ModuleNotFoundError: backend.services.jira_issue_project_track`).

- [x] **Step 1.3: Implement the service.** Create `backend/services/jira_issue_project_track.py`:

```python
"""Pure, dependency-injected Jira Epic Project Track helpers.

Mirrors ``backend.services.jira_issue_priorities``: this module resolves and
performs the single-issue Project Track dropdown change using only injected
Jira request callables plus a request auth context. It never imports Flask,
``requests``, ``build_jira_headers``, ``backend.epm``, Home/Townsquare
helpers, or service integrations; the route layer injects the OAuth-bound
wrapper and the configured field-id getter and threads ``context`` through.
The browser may submit only one issue key and one canonical target; field
ids and option ids stay server-owned, resolved from that exact issue's edit
metadata at submission time.
"""

from backend.services.jira_issue_transitions import (
    IssueTransitionInputError,
    normalize_issue_keys,
)

CANONICAL_TRACKS = ("Flexible", "Committed")


class ProjectTrackInputError(ValueError):
    def __init__(self, code, message=None):
        self.code = code
        super().__init__(message or code)


class ProjectTrackServiceError(Exception):
    def __init__(self, code, status_code=None, message=None):
        self.code = code
        self.status_code = status_code
        super().__init__(message or code)


def _normalize_single_issue_key(value):
    try:
        return normalize_issue_keys([value])[0]
    except IssueTransitionInputError as error:
        raise ProjectTrackInputError("invalid_issue_key") from error


def normalize_project_track_target(value):
    if not isinstance(value, str):
        raise ProjectTrackInputError("invalid_project_track")
    lowered = value.strip().lower()
    for canonical in CANONICAL_TRACKS:
        if lowered == canonical.lower():
            return canonical
    raise ProjectTrackInputError("invalid_project_track")


def _resolve_field_id(get_project_track_field_id):
    field_id = (get_project_track_field_id() or "").strip()
    if not field_id:
        raise ProjectTrackServiceError("project_track_not_editable", 409)
    return field_id


def _load_editmeta_allowed_values(key, field_id, *, jira_request, context):
    response = jira_request("GET", f"/rest/api/3/issue/{key}/editmeta", context=context)
    if response.status_code == 404:
        raise ProjectTrackServiceError("issue_not_found", 404)
    if response.status_code != 200:
        raise ProjectTrackServiceError("project_track_options_fetch_failed", response.status_code)
    field_meta = ((response.json() or {}).get("fields") or {}).get(field_id)
    if not isinstance(field_meta, dict):
        raise ProjectTrackServiceError("project_track_not_editable", 409)
    allowed = field_meta.get("allowedValues") or []
    values = {}
    for option in allowed:
        if isinstance(option, dict):
            value = str(option.get("value") or "").strip()
            option_id = str(option.get("id") or "").strip()
            if value and option_id:
                values[value.lower()] = {"value": value, "id": option_id}
    return values


def load_project_track_options_for_issue(issue_key, *, jira_request,
                                         get_project_track_field_id, context=None):
    key = _normalize_single_issue_key(issue_key)
    field_id = _resolve_field_id(get_project_track_field_id)
    allowed = _load_editmeta_allowed_values(
        key, field_id, jira_request=jira_request, context=context)
    options = [
        {"value": canonical}
        for canonical in CANONICAL_TRACKS
        if canonical.lower() in allowed
    ]
    if not options:
        raise ProjectTrackServiceError("project_track_not_editable", 409)
    return {"options": options, "source": "jira"}


def _load_issue_snapshot(key, field_id, *, jira_request, context):
    response = jira_request(
        "GET", f"/rest/api/3/issue/{key}",
        params={"fields": f"issuetype,{field_id}"}, context=context)
    if response.status_code == 404:
        raise ProjectTrackServiceError("issue_not_found", 404)
    if response.status_code != 200:
        raise ProjectTrackServiceError("project_track_update_failed", response.status_code)
    fields = (response.json() or {}).get("fields") or {}
    issue_type = str(((fields.get("issuetype") or {}).get("name")) or "").strip()
    track_field = fields.get(field_id)
    current = ""
    if isinstance(track_field, dict):
        current = str(track_field.get("value") or "").strip()
    return issue_type, current


def update_issue_project_track(issue_key, target_track, *, jira_request,
                               get_project_track_field_id, context=None):
    key = _normalize_single_issue_key(issue_key)
    target = normalize_project_track_target(target_track)
    field_id = _resolve_field_id(get_project_track_field_id)
    issue_type, current = _load_issue_snapshot(
        key, field_id, jira_request=jira_request, context=context)
    if issue_type.lower() != "epic":
        raise ProjectTrackServiceError("issue_not_epic", 409)
    if current.lower() == target.lower():
        return {"issueKey": key, "result": "already_in_track", "fromTrack": target}
    allowed = _load_editmeta_allowed_values(
        key, field_id, jira_request=jira_request, context=context)
    option = allowed.get(target.lower())
    if option is None:
        raise ProjectTrackServiceError("project_track_option_unavailable", 409)
    response = jira_request(
        "PUT", f"/rest/api/3/issue/{key}",
        json_body={"fields": {field_id: {"id": option["id"]}}}, context=context)
    if response.status_code == 404:
        raise ProjectTrackServiceError("issue_not_found", 404)
    if response.status_code not in (200, 204):
        raise ProjectTrackServiceError("project_track_update_failed", response.status_code)
    return {"issueKey": key, "result": "success", "fromTrack": current, "toTrack": target}
```

Note: in `update_issue_project_track` the `already_in_track` result returns `fromTrack: target` in canonical casing (the current value matched case-insensitively).

- [x] **Step 1.4: Run focused tests → PASS.** `.venv/bin/python -m unittest tests.test_jira_issue_project_track -v`

- [x] **Step 1.5: Run related suites → PASS.** `.venv/bin/python -m unittest tests.test_jira_issue_priorities tests.test_backend_service_extraction -v` (service-layer import rules still hold).

- [x] **Step 1.6: Commit.** `git add backend/services/jira_issue_project_track.py tests/test_jira_issue_project_track.py && git commit -m "feat(eng): add dependency-injected Jira Project Track service"`

---

## Task 2: Routes, policy rows, and route tests

**Files:**
- Modify: `backend/routes/eng_routes.py` (import block lines 16-22; add routes after `post_issue_priorities` ~line 397)
- Modify: `backend/security/policy.py` (add two rows next to the priority rows at lines 86-87)
- Modify: `tests/endpoint_security_samples.py` and/or `tests/test_endpoint_security_matrix.py` `SECURITY_SAMPLES` (`authenticated_read` and `user_write` lists), `tests/test_endpoint_policy_inventory.py`
- Test: `tests/test_oauth_eng_routes.py` (new class `IssueProjectTrackRouteTests` mirroring `IssuePriorityRouteTests` at line 707)

**Interfaces:**
- Consumes: Task 1 service functions/exceptions; `get_project_track_field_id` (bound from `jira_server` via `bind_server_globals`); `current_jira_request`, `current_request_auth_context`, `_missing_write_jira_work_scope`, `_eng_auth_error_response`, `clear_jira_issue_status_caches`.
- Produces: `GET /api/issues/project-track/options` and `POST /api/issues/project-track` per the Endpoint Contracts table; policy names `jira-project-track-options` (`authenticated_read`) and `jira-project-track-write` (`user_write`).

- [x] **Step 2.1: Write failing route tests.** Add `IssueProjectTrackRouteTests` to `tests/test_oauth_eng_routes.py`, cloning the `IssuePriorityRouteTests` setUp/csrf helpers. Required tests (each mirrors its priority sibling's mocking style — patch `jira_server.JIRA_AUTH_MODE`, `jira_server.current_request_auth_context`, `jira_server.current_jira_request`, `eng_routes.load_project_track_options_for_issue`, `eng_routes.update_issue_project_track`, `eng_routes.clear_jira_issue_status_caches` as appropriate):

```python
class IssueProjectTrackRouteTests(unittest.TestCase):
    # setUp/_csrf_token copied from IssuePriorityRouteTests

    def test_options_route_requires_oauth_mode(self):
        # JIRA_AUTH_MODE=basic -> GET returns 403 {'error': 'jira_oauth_required'}

    def test_options_route_requires_issue_key(self):
        # blank issueKey -> 400 {'error': 'invalid_issue_key'} without service call

    def test_options_route_uses_current_auth_context(self):
        # patched service asserts context sentinel + get_project_track_field_id injected

    def test_options_route_maps_issue_not_found_to_404(self):
    def test_options_route_maps_not_editable_to_409(self):
    def test_options_route_service_error_returns_sanitized_502(self):
        # -> {'error': 'jira_project_track_options_failed'}

    def test_options_route_does_not_call_build_jira_headers(self):
        # patch jira_server.build_jira_headers side_effect=AssertionError

    def test_write_rejects_missing_x_requested_with_before_route_code(self):
    def test_write_rejects_missing_csrf_token_before_route_code(self):
    def test_write_invalid_json_body_returns_400(self):
    def test_write_requires_oauth_mode(self):
    def test_write_returns_missing_scope_before_jira_call_when_write_scope_absent(self):
        # patch current_jira_request side_effect=AssertionError('must not call Jira')

    def test_write_maps_input_errors_to_400(self):
        # invalid_issue_key and invalid_project_track

    def test_write_maps_issue_not_epic_to_409(self):
    def test_write_maps_option_unavailable_to_409(self):
    def test_write_maps_not_editable_to_409(self):
    def test_write_maps_issue_not_found_to_404(self):
    def test_write_service_error_returns_sanitized_502(self):
        # -> {'error': 'jira_project_track_update_failed'}

    def test_write_uses_oauth_context_and_clears_caches_on_success(self):
        # result 'success' -> mock_clear.assert_called_once_with(reason='issue_project_track_update')

    def test_write_does_not_clear_caches_for_already_in_track(self):
    def test_write_does_not_call_build_jira_headers(self):
```

Write each body fully in the test file (copy the corresponding priority test body and adapt names/payloads: request body `{"issueKey": "PRODUCT-1", "targetTrack": "Committed"}`, success payload `{"issueKey": "PRODUCT-1", "result": "success", "fromTrack": "Flexible", "toTrack": "Committed"}`).

Also add the two policy-inventory tests in `tests/test_endpoint_policy_inventory.py`, mirroring lines 102-115:

```python
def test_project_track_options_route_has_authenticated_read_policy(self):
    # asserts single policy 'jira-project-track-options' for eng_routes.get_issue_project_track_options

def test_project_track_write_route_has_user_write_policy(self):
    # asserts ['jira-project-track-write'] for eng_routes.post_issue_project_track
```

And add `("GET", "/api/issues/project-track/options")` to the `authenticated_read` sample list and `("POST", "/api/issues/project-track")` to the `user_write` sample list in the `SECURITY_SAMPLES` registry (`tests/test_endpoint_security_matrix.py` lines 9-38, plus `tests/endpoint_security_samples.py` if it lists these routes separately).

- [x] **Step 2.2: Run to confirm failures.** `.venv/bin/python -m unittest tests.test_oauth_eng_routes.IssueProjectTrackRouteTests tests.test_endpoint_policy_inventory -v` → FAIL (routes missing).

- [x] **Step 2.3: Implement routes and policy.** In `backend/routes/eng_routes.py` extend the service import block and add after `post_issue_priorities`:

```python
from backend.services.jira_issue_project_track import (
    ProjectTrackInputError,
    ProjectTrackServiceError,
    load_project_track_options_for_issue,
    update_issue_project_track,
)

_PROJECT_TRACK_CONFLICT_CODES = {
    'issue_not_epic', 'project_track_not_editable', 'project_track_option_unavailable',
}


def _project_track_service_error_response(error, failure_code):
    if error.code == 'issue_not_found':
        return jsonify({'error': 'issue_not_found'}), 404
    if error.code in _PROJECT_TRACK_CONFLICT_CODES:
        return jsonify({'error': error.code}), 409
    logger.exception('Issue project track Jira call failed')
    return jsonify({'error': failure_code}), 502


@bp.route('/api/issues/project-track/options', methods=['GET'])
def get_issue_project_track_options():
    """Canonical Project Track options from this issue's Jira editmeta."""
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    issue_key = (request.args.get('issueKey') or '').strip()
    if not issue_key:
        return jsonify({'error': 'invalid_issue_key'}), 400
    try:
        auth_context = current_request_auth_context()
        result = load_project_track_options_for_issue(
            issue_key,
            jira_request=current_jira_request,
            get_project_track_field_id=get_project_track_field_id,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except ProjectTrackInputError as error:
        return jsonify({'error': error.code}), 400
    except ProjectTrackServiceError as error:
        return _project_track_service_error_response(error, 'jira_project_track_options_failed')
    except Exception:
        logger.exception('Issue project track options endpoint error')
        return jsonify({'error': 'jira_project_track_options_failed'}), 502
    return jsonify(result)


@bp.route('/api/issues/project-track', methods=['POST'])
def post_issue_project_track():
    """Set one real Epic's Project Track to Flexible or Committed."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    try:
        auth_context = current_request_auth_context()
        if _missing_write_jira_work_scope(auth_context):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')
        result = update_issue_project_track(
            payload.get('issueKey'),
            payload.get('targetTrack'),
            jira_request=current_jira_request,
            get_project_track_field_id=get_project_track_field_id,
            context=auth_context,
        )
    except AuthError as error:
        return _eng_auth_error_response(error)
    except ProjectTrackInputError as error:
        return jsonify({'error': error.code}), 400
    except ProjectTrackServiceError as error:
        return _project_track_service_error_response(error, 'jira_project_track_update_failed')
    except Exception:
        logger.exception('Issue project track write endpoint error')
        return jsonify({'error': 'jira_project_track_update_failed'}), 502
    if result.get('result') == 'success':
        clear_jira_issue_status_caches(reason='issue_project_track_update')
    return jsonify(result)
```

In `backend/security/policy.py`, next to the priority rows:

```python
EndpointPolicy("jira-project-track-options", "/api/issues/project-track/options", PUBLIC_METHODS, "authenticated_read"),
EndpointPolicy("jira-project-track-write", "/api/issues/project-track", frozenset({"POST"}), "user_write"),
```

- [x] **Step 2.4: Run focused tests → PASS.** `.venv/bin/python -m unittest tests.test_oauth_eng_routes tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix -v`

- [x] **Step 2.5: Run full Python suite → PASS.** `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests` (matches CI env; includes `test_initiative_extraction`, `test_codebase_structure_budgets`, security matrix, source guards).

- [x] **Step 2.6: Commit.** `git add backend/routes/eng_routes.py backend/security/policy.py tests/ && git commit -m "feat(eng): add OAuth Project Track options and write routes"`

---

## Task 3: Frontend utils, API wrappers, analytics vocabulary

**Files:**
- Modify: `frontend/src/eng/engTaskUtils.js` (lines 146-149, 209-212)
- Create: `frontend/src/eng/engProjectTrackTransitionUtils.js`
- Modify: `frontend/src/api/jiraIssueApi.js`
- Modify: `frontend/src/analytics/events.js` (EVENT_NAMES), `frontend/src/analytics/analytics.js` (API_SURFACES), `frontend/src/analytics/dashboardAnalytics.js`
- Test: create `tests/test_eng_project_track_transition_utils.js`; modify `tests/test_eng_epic_sort.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`

**Interfaces:**
- Produces:
  - `engTaskUtils.js`: `PROJECT_TRACK_UNIDENTIFIED_EMOJI = '⚪'`; `getProjectTrackEmoji(track)` returns `⚪` for blank/unrecognized; new `getProjectTrackLabel(track) -> 'Committed'|'Flexible'|'Unidentified'`.
  - `engProjectTrackTransitionUtils.js`: `CANONICAL_PROJECT_TRACKS = ['Flexible', 'Committed']`; `normalizeProjectTrackValue(value) -> 'Committed'|'Flexible'|''`; `filterProjectTrackOptions(options, currentTrack) -> [{value}]` (omits current recognized value, both when unidentified); `buildProjectTrackActionAnalyticsParams({ sourceSurface, targetTrack, result }) -> { source_surface, issue_type_mix: 'epics', selected_count_bucket: '1_5', [value_state], [result] }` with `value_state` lowercase and present only when `targetTrack` given.
  - `jiraIssueApi.js`: `fetchIssueProjectTrackOptions(backendUrl, { issueKey, signal })` (GET, surface `jira_issue_project_track`, `featureName: 'eng_project_track_changes'`); `updateIssueProjectTrack(backendUrl, payload, { signal })` (CSRF via `fetchMutationCsrfToken`, POST body `{issueKey, targetTrack}`).
  - `dashboardAnalytics.js`: `trackIssueProjectTrackAction(workflowAction, params)` emitting `issue_project_track_action` with `feature_name: 'eng_project_track_changes'`.

- [x] **Step 3.1: Write failing unit tests.** `tests/test_eng_project_track_transition_utils.js` (Node `--test`, mirror `tests/test_eng_priority_transition_utils.js` style):

```js
const test = require('node:test');
const assert = require('node:assert');

// import via the same esbuild-require pattern used by sibling tests
```

Cover: `normalizeProjectTrackValue` ('committed '→'Committed', 'FLEXIBLE'→'Flexible', ''/null/'Other'→''); `filterProjectTrackOptions([{value:'Flexible'},{value:'Committed'}], 'Committed')` → only Flexible; unidentified current ('' or 'Other') → both options; missing/malformed options → []; `buildProjectTrackActionAnalyticsParams` with and without `targetTrack`/`result` — asserts exact keys, `issue_type_mix: 'epics'`, `selected_count_bucket: '1_5'`, `value_state: 'committed'`, and that no issue key or raw value can appear. In `tests/test_eng_epic_sort.js` update the emoji assertions: `getProjectTrackEmoji('')` → `'⚪'`, `getProjectTrackEmoji('Other')` → `'⚪'`, existing 🔒/🤷 unchanged. In `tests/test_analytics_events.js` add the `issue_project_track_action` trio mirroring the `issue_priority_action` tests (canonical userevent requiring feature_name; accepts enum params `project_track_options_open|project_track_change_submit|project_track_change_result`, `value_state` flexible|committed, rejects unsafe values; pushes contract through dataLayer) and `api_result accepts the jira_issue_project_track surface`. In `tests/test_analytics_source_guards.js` add: `'Jira issue project track API module sends the jira_issue_project_track surface for both endpoints'` and `'trackIssueProjectTrackAction emits only the eng project track contract, never issue-level PII or raw track ids'` (mirror the priority siblings).

- [x] **Step 3.2: Run to confirm failure.** `npm run test:frontend:unit` → new tests FAIL.

- [x] **Step 3.3: Implement.** `engTaskUtils.js`:

```js
export const PROJECT_TRACK_UNIDENTIFIED_EMOJI = '⚪';

export function getProjectTrackEmoji(track) {
    const t = String(track || '').trim().toLowerCase();
    return PROJECT_TRACK_EMOJI[t] || PROJECT_TRACK_UNIDENTIFIED_EMOJI;
}

export function getProjectTrackLabel(track) {
    const t = String(track || '').trim().toLowerCase();
    if (t === 'committed') return 'Committed';
    if (t === 'flexible') return 'Flexible';
    return 'Unidentified';
}
```

`engProjectTrackTransitionUtils.js`:

```js
export const CANONICAL_PROJECT_TRACKS = ['Flexible', 'Committed'];

export function normalizeProjectTrackValue(value) {
    const lowered = String(value || '').trim().toLowerCase();
    const match = CANONICAL_PROJECT_TRACKS.find(track => track.toLowerCase() === lowered);
    return match || '';
}

export function filterProjectTrackOptions(options, currentTrack) {
    const current = normalizeProjectTrackValue(currentTrack);
    const list = Array.isArray(options) ? options : [];
    return list
        .map(option => ({ value: normalizeProjectTrackValue(option && option.value) }))
        .filter(option => option.value && option.value !== current);
}

export function buildProjectTrackActionAnalyticsParams({ sourceSurface, targetTrack, result } = {}) {
    const params = {
        source_surface: sourceSurface === 'planning' ? 'planning' : 'catch_up',
        issue_type_mix: 'epics',
        selected_count_bucket: '1_5',
    };
    const valueState = normalizeProjectTrackValue(targetTrack).toLowerCase();
    if (valueState) params.value_state = valueState;
    if (result !== undefined) params.result = result;
    return params;
}
```

`jiraIssueApi.js` (below the priority wrappers, reusing `headers` + `fetchMutationCsrfToken` + `jsonOrStructuredError` + `trackedFetch` exactly as lines 44-66 do):

```js
export function fetchIssueProjectTrackOptions(backendUrl, { issueKey, signal } = {}) {
    const query = `?issueKey=${encodeURIComponent(issueKey || '')}`;
    return trackedFetch(`${backendUrl}/api/issues/project-track/options${query}`, {
        cache: 'no-cache',
        headers: headers(),
        signal,
    }, {
        apiSurface: 'jira_issue_project_track',
        featureName: 'eng_project_track_changes',
    }).then(response => jsonOrStructuredError(response, 'project track options'));
}

export async function updateIssueProjectTrack(backendUrl, payload, { signal } = {}) {
    const { csrfToken } = await fetchMutationCsrfToken(backendUrl);
    return trackedFetch(`${backendUrl}/api/issues/project-track`, {
        method: 'POST',
        cache: 'no-cache',
        headers: headers(csrfToken),
        body: JSON.stringify(payload),
        signal,
    }, {
        apiSurface: 'jira_issue_project_track',
        featureName: 'eng_project_track_changes',
    }).then(response => jsonOrStructuredError(response, 'project track update'));
}
```

(Match the actual local helper names in the file — if the priority wrappers call `trackedFetch` differently, copy their exact call shape.)

`events.js`: add `'issue_project_track_action'` to `EVENT_NAMES`. `analytics.js`: add `'jira_issue_project_track'` to `API_SURFACES`. `dashboardAnalytics.js` (next to `trackIssuePriorityAction`, lines 188-194):

```js
export function trackIssueProjectTrackAction(workflowAction, params = {}) {
    trackUserEvent('issue_project_track_action', {
        feature_name: 'eng_project_track_changes',
        workflow_action: workflowAction,
        ...params,
    });
}
```

(Copy the exact emit-helper call used by `trackIssuePriorityAction`.)

- [x] **Step 3.4: Run unit tests → PASS.** `npm run test:frontend:unit`

- [x] **Step 3.5: Commit.** `git add frontend/src tests/ && git commit -m "feat(eng): add Project Track normalization, API wrappers, and analytics vocabulary"`

---

## Task 4: Hook, menu component, CSS

**Files:**
- Create: `frontend/src/eng/useEngProjectTrackTransitions.js`
- Create: `frontend/src/issues/ProjectTrackTransitionMenu.jsx`
- Modify: `frontend/src/styles/eng/status-transitions.css`, `frontend/src/styles/eng/epics.css`

**Interfaces:**
- Consumes: Task 3 wrappers/utils; `enqueueEngIssueMutation` from `frontend/src/eng/engIssueMutationQueue.js`; `authRecoveryLoginUrl`, `redirectToAuthRecovery` from `frontend/src/eng/useEngSprintData.js`; `IssueFieldOptionMenu`.
- Produces: `useEngProjectTrackTransitions({ backendUrl, selectedSprint, sourceSurface, mutationScopeKey, trackIssueProjectTrackAction, onAuthRecoveryRequired, onApplyLocalProjectTrack })` returning `{ activeProjectTrackTarget, openProjectTrackControl, closeProjectTrackControl, projectTrackOptions, projectTrackOptionsLoading, projectTrackSubmitting, projectTrackError, projectTrackResult, pendingProjectTrackIssueKeys, submitProjectTrackChange }`; `ProjectTrackTransitionMenu` props `{ epicKey, currentTrack, isOpen, options, optionsLoading, submitting, error, result, onOpen, onClose, onSubmit }`.

- [x] **Step 4.1: Implement the hook** (mirror `useEngPriorityTransitions.js` structure; no module-level options cache — options come from per-issue editmeta and are fetched on every open; the write re-resolves server-side so staleness is safe):

Key behaviors to implement, copying the priority hook's exact mechanics:
- State: `activeProjectTrackTarget` (`{ key, currentTrack }`), `projectTrackOptions`, `projectTrackOptionsLoading`, `projectTrackSubmitting`, `projectTrackError`/`projectTrackErrorCode`, `projectTrackResult`, `pendingIssueKeys` Set. Refs: `requestTokenRef`, `mutationScopeRef`, `pendingMutationKeysRef`.
- Reset effect on `[selectedSprint, sourceSurface, mutationScopeKey]`.
- `openProjectTrackControl(epicKey, currentTrack)`: toggles (close if already open for that key); sets target; fires `trackIssueProjectTrackAction('project_track_options_open', buildProjectTrackActionAnalyticsParams({ sourceSurface }))`; fetches `fetchIssueProjectTrackOptions`; staleness-guards via `requestTokenRef`; on error sets retryable `projectTrackError`; auth recovery via `authRecoveryLoginUrl(err)` → `onAuthRecoveryRequired?.()` + `redirectToAuthRecovery(err)` and clears active state.
- `submitProjectTrackChange(targetTrack, epicKey)`: guards `pendingMutationKeysRef.current.has(key)`; captures `priorTrack = activeProjectTrackTarget.currentTrack`; captures `mutationScope = mutationScopeKey`; fires `project_track_change_submit` with `value_state`; optimistically calls `onApplyLocalProjectTrack?.(key, targetTrack)`; runs the write through `enqueueEngIssueMutation(key, () => updateIssueProjectTrack(backendUrl, { issueKey: key, targetTrack }))` on Catch Up, or directly with `setProjectTrackSubmitting(true)` on Planning (mirror the priority split); on success (scope current) reconciles with `response.toTrack ?? response.fromTrack` (server canonical; `already_in_track` responses carry only `fromTrack`) and fires `project_track_change_result` with `result: 'success'`; on failure (scope current) rolls back `onApplyLocalProjectTrack?.(key, priorTrack)`, keeps a visible retryable error in the open menu, fires `result: 'failure'`; auth recovery identical to open; stale scope (`mutationScopeRef.current !== mutationScope`) drops all patches.

- [x] **Step 4.2: Implement the menu component.** `ProjectTrackTransitionMenu.jsx` composes `IssueFieldOptionMenu`:

```jsx
import React, { useRef } from 'react';
import IssueFieldOptionMenu from './IssueFieldOptionMenu.jsx';
import { getProjectTrackEmoji, getProjectTrackLabel } from '../eng/engTaskUtils.js';
import { filterProjectTrackOptions } from '../eng/engProjectTrackTransitionUtils.js';

export default function ProjectTrackTransitionMenu({
    epicKey, currentTrack = '', isOpen = false, options = null,
    optionsLoading = false, submitting = false, error = '', result = null,
    onOpen, onClose, onSubmit,
}) {
    const fieldRef = useRef(null);
    const stateLabel = getProjectTrackLabel(currentTrack);
    const visibleOptions = filterProjectTrackOptions(options && options.options, currentTrack);
    return (
        <span className="project-track-transition" ref={fieldRef}>
            <button
                type="button"
                className="epic-track-indicator"
                data-project-track-transition-trigger="true"
                data-issue-key={epicKey}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={`Project Track: ${stateLabel}. Change Project Track`}
                title={`Project Track: ${stateLabel}. Change Project Track`}
                disabled={submitting && !isOpen}
                onClick={() => (isOpen ? onClose?.() : onOpen?.(epicKey, currentTrack))}
            >
                {getProjectTrackEmoji(currentTrack)}
            </button>
            {isOpen && (
                <IssueFieldOptionMenu
                    blockClass="project-track-transition"
                    issueKey={epicKey}
                    menuLabel="Change Project Track"
                    loading={optionsLoading}
                    loadingLabel="Loading Project Track options..."
                    error={error}
                    showEmpty={!optionsLoading && !error}
                    emptyLabel="No other Project Track available."
                    options={visibleOptions}
                    optionKey={option => option.value}
                    optionLabel={option => option.value}
                    renderMarker={option => (
                        <span className="project-track-option-marker" aria-hidden="true">
                            {getProjectTrackEmoji(option.value)}
                        </span>
                    )}
                    onSelect={option => onSubmit?.(option.value, epicKey)}
                    disabled={submitting}
                    result={result === 'success' ? 'Updated Project Track.' : ''}
                    onEscape={() => onClose?.()}
                    dismissRef={fieldRef}
                />
            )}
        </span>
    );
}
```

(Match `IssueFieldOptionMenu`'s actual prop names from the file — verify `showEmpty`/`optionKey`/`optionLabel` signatures before wiring.)

- [x] **Step 4.3: CSS.** In `status-transitions.css` extend every aliased selector group (`.status-transition, .priority-transition { ... }` → add `.project-track-transition`; same for `-menu`, `-menu-options`, `-option`, `-option-label`, `-menu-note`, `-menu-loading`, `-menu-error`, `-menu-result`) and the z-index lift: add `.task-item:has(.project-track-transition-menu), .epic-header:has(.project-track-transition-menu)` to the `z-index: 121` rule. In `epics.css` extend the indicator for the interactive case:

```css
button.epic-track-indicator {
    appearance: none;
    padding: 0 2px;
    margin: 0;
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
}

button.epic-track-indicator:hover,
button.epic-track-indicator:focus-visible {
    outline: 2px solid var(--focus-ring, #4c9aff);
    outline-offset: 1px;
}
```

(Reuse the exact affordance pattern from `button.task-priority-icon` in `issues.css` lines 370-393 — copy its hover/focus rules rather than inventing new ones.)

- [x] **Step 4.4: Build check.** `npm run build` → succeeds (wiring lands in Task 5; this catches syntax errors early). Do not commit dist yet.

- [x] **Step 4.5: Commit.** `git add frontend/src && git commit -m "feat(eng): add Project Track transition hook, menu component, and styles"`

---

## Task 5: dashboard.jsx wiring + dist build

**Files:**
- Modify: `frontend/src/dashboard.jsx` (imports; hook instantiation near `useEngPriorityTransitions` at ~11037-11065; group-change cleanup effect ~11085-11089; `renderEpicBlock` indicator at ~12683-12691)
- Modify: `tests/test_codebase_structure_budgets.py` (ratchet `frontend/src/dashboard.jsx` budget with a comment)
- Generated: `frontend/dist/*`

**Interfaces:**
- Consumes: Task 4 hook + menu; `applyLocalEngIssueField` (dashboard.jsx ~10968); `priorityTransitionEnabled` gate (~11036); `trackIssueProjectTrackAction`.
- Produces: interactive ⚪/🔒/🤷 Epic-header control on ENG Catch Up/Planning; passive span elsewhere; `projectTrack` patched as a plain string through `applyLocalEngIssueField(epicKey, 'projectTrack', value)` so `epicDetails` (render + sort) and epicsInScope arrays react immediately.

- [x] **Step 5.1: Instantiate the hook** next to the priority hook, with the identical scope token:

```js
const {
    activeProjectTrackTarget,
    openProjectTrackControl,
    closeProjectTrackControl,
    projectTrackOptions,
    projectTrackOptionsLoading,
    projectTrackSubmitting,
    projectTrackError,
    projectTrackResult,
    pendingIssueKeys: pendingProjectTrackIssueKeys,
    submitProjectTrackChange,
} = useEngProjectTrackTransitions({
    backendUrl: BACKEND_URL,
    selectedSprint,
    sourceSurface: statusTransitionSourceSurface,
    mutationScopeKey: `${selectedSprint || ''}|${activeGroupId || ''}|${statusTransitionSourceSurface}`,
    trackIssueProjectTrackAction,
    onAuthRecoveryRequired: () => trackAppError('auth', 'session_recovery', 'reauth'),
    onApplyLocalProjectTrack: (issueKey, value) => applyLocalEngIssueField(issueKey, 'projectTrack', value),
});
const projectTrackTransitionActiveKey = activeProjectTrackTarget?.key || null;
const projectTrackTransitionEnabled = priorityTransitionEnabled;
```

Add `closeProjectTrackControl()` to the existing `activeGroupId` cleanup effect. No success refresh callback — a single-Epic track change must not force a task-list refetch (design lines 167-170).

- [x] **Step 5.2: Replace the indicator in `renderEpicBlock`.** Replace the `{projectTrackEmoji && (<span ...>...)}` block (12683-12691) with an always-rendered indicator for real Epics:

```jsx
{epicGroup.key !== 'NO_EPIC' && (
    projectTrackTransitionEnabled ? (
        <ProjectTrackTransitionMenu
            epicKey={epicGroup.key}
            currentTrack={projectTrackValue}
            isOpen={projectTrackTransitionActiveKey === epicGroup.key}
            options={projectTrackOptions}
            optionsLoading={projectTrackOptionsLoading}
            submitting={projectTrackSubmitting || pendingProjectTrackIssueKeys.has(epicGroup.key)}
            error={projectTrackError}
            result={projectTrackResult}
            onOpen={openProjectTrackControl}
            onClose={closeProjectTrackControl}
            onSubmit={submitProjectTrackChange}
        />
    ) : (
        <span
            className="epic-track-indicator"
            title={`Project Track: ${getProjectTrackLabel(projectTrackValue)}`}
            aria-label={`Project Track: ${getProjectTrackLabel(projectTrackValue)}`}
        >
            {projectTrackEmoji}
        </span>
    )
)}
```

`projectTrackEmoji` is now always truthy (⚪ fallback), so both branches always render for real Epics; `NO_EPIC` renders nothing. The passive branch fixes the `Product Track` → `Project Track` tooltip. EPM/Statistics/Scenario render through their own components and receive no new props — verify with `rg -n 'ProjectTrackTransitionMenu|fetchIssueProjectTrackOptions' frontend/src/epm frontend/src/stats` returning nothing.

- [x] **Step 5.3: Unit + build + budget.** `npm run test:frontend:unit` → PASS. `npm run build` → PASS. `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` — if dashboard.jsx exceeds 15965 lines, ratchet the budget to the new line count with a comment line documenting this feature's delta.

- [x] **Step 5.4: Commit (including dist).** `git add frontend/src frontend/dist tests/test_codebase_structure_budgets.py && git commit -m "feat(eng): wire Project Track write control into ENG Epic headers"`

---

## Task 6: Playwright coverage + visual verification

**Files:**
- Create: `tests/ui/eng_project_track_transitions.spec.js` (clone the harness from `tests/ui/eng_priority_transitions.spec.js`: in-memory esbuild bundle, CSS injection incl. `status-transitions.css` + `epics.css`, `page.route('**/api/**')` fixture, localStorage prefs, locator helpers)

**Interfaces:**
- Consumes: shipped Tasks 1-5 behavior; fixture helpers from `tests/ui/epm_home_token_fixture.js`.

- [x] **Step 6.1: Write the spec.** Required tests (normal `click()`, never `click({ force: true })`):

1. `epic headers render 🔒 for Committed, 🤷 for Flexible, and ⚪ for unidentified tracks` — includes an Epic with null track; asserts the ⚪ button has `aria-label` `Project Track: Unidentified. Change Project Track`.
2. `track indicator is a native button with menu semantics on Catch Up and options load only on open` — asserts zero `/api/issues/project-track/options` calls before click, one after; `aria-haspopup="menu"`, `aria-expanded` toggles; first option focused after load.
3. `selecting the alternative track updates the header emoji and resorts track-sorted epics immediately` — seed sort mode `track-committed`; flip a Flexible epic to Committed; assert emoji change + epic group order change without any task-list refetch (record `/api/eng/...` task calls).
4. `current recognized track is omitted from the menu; unidentified shows both options`.
5. `failed write rolls back the emoji and keeps a retryable error in the open menu` — write endpoint returns 502; assert emoji restored and `.project-track-transition-menu-error` visible.
6. `Escape and outside pointer press dismiss the menu`.
7. `NO_EPIC group renders no track indicator and no write control`.
8. `menu options are clickable above sibling cards` — open a menu on a non-last epic header and click an option with a normal click (proves the `:has()` z-index lift; a force-click would mask layering bugs).
9. `EPM, Statistics, Scenario, and Settings-open surfaces never call Project Track APIs and render no interactive track trigger` — navigate each surface, assert zero `/api/issues/project-track` requests and no `[data-project-track-transition-trigger]`; with Settings modal open on ENG, the indicator is passive.

- [x] **Step 6.2: Run → PASS.** `npx playwright test tests/ui/eng_project_track_transitions.spec.js` and re-run the sibling suites: `npx playwright test tests/ui/eng_priority_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_epic_sort_and_track.spec.js`.

- [x] **Step 6.3: Visual verification.** Element-level screenshots (settle animations first, per repo rule): Committed, Flexible, and Unidentified indicators; open menu at desktop width and a narrow (~760px) viewport. Save under `test-results/` (gitignored) and reference in the PR notes later.

- [x] **Step 6.4: Commit.** `git add tests/ui/eng_project_track_transitions.spec.js && git commit -m "test(eng): add Playwright coverage for Project Track write control"`

---

## Task 7: Docs, analytics contract, plan close-out, final verification

**Files:**
- Modify: `docs/README_ANALYTICS.md` (Event Taxonomy table + `api_result` row)
- Modify: `docs/plans/README.md` (ENG Epic Sort And Track section)
- Modify: `docs/plans/GATE-05-home-write-capability.md` (sweep note)
- Modify: this plan (Status → executed summary)

- [ ] **Step 7.1: Analytics contract.** Add the taxonomy row after `issue_priority_action` (line 99):

```
| `issue_project_track_action` | `workflow_action` (`project_track_options_open`\|`project_track_change_submit`\|`project_track_change_result`), `source_surface` (`catch_up`\|`planning`), `selected_count_bucket`, `issue_type_mix` (`epics`), `value_state` (`flexible`\|`committed`, only after a target is selected), `result` (`success`\|`failure`, result event only) | ENG Catch Up/Planning Epic header Project Track change | `frontend/src/eng/useEngProjectTrackTransitions.js`, `frontend/src/analytics/dashboardAnalytics.js` | browser | ENG Project Track change adoption and reliability |
```

Extend the `api_result` row (line 100) with `api_surface=jira_issue_project_track` → `feature_name=eng_project_track_changes`, mirroring the priority clause. No GA4/GTM runbook change, no new custom dimension, no new param key.

- [ ] **Step 7.2: Plan index + gate sweep.** In `docs/plans/README.md` under `## ENG Epic Sort And Track`, add the `EXEC-eng-project-track-write-switch.md` entry (implemented on branch `feature/eng-project-track-write-switch`; expected output = interactive 🔒/🤷/⚪ Epic-header control writing only the configured Jira Project Track field via the signed-in user's OAuth context with status/priority-parity behavior; `GATE-05` unaffected) and update the SUPPORT design entry to note the EXEC plan now exists. Append a 2026-07-16 execution sweep note to `GATE-05-home-write-capability.md` Last Check Notes (plan adds Jira OAuth issue-edit only; no Home/Townsquare or EPM mutation; probe inputs still unavailable; keep Blocked).

- [ ] **Step 7.3: Final verification gates.** Run and read each:

```bash
JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui
npm run build && git diff --exit-code frontend/dist
.venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python jira_server.py   # background; no dependency warnings before banner
curl http://localhost:5050/api/test
```

All must pass (Playwright pre-existing failures unrelated to this feature must be triaged and reported, not ignored silently).

- [ ] **Step 7.4: Commit docs.** `git add docs/ && git commit -m "docs: record Project Track write switch analytics contract and plan status"`

---
