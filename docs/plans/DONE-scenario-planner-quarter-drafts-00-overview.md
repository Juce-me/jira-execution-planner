# Scenario Planner Quarter Drafts Overview

> **Status:** Done. Executed in `993e885` (`Add scenario draft history persistence`, 2026-05-20). Kept for audit context only; do not execute as an active plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DB-backed, versioned Scenario Planner drafts for a quarter scope, with one shared active draft per sprint plus team/group scope, reload/rollback history, and guarded multi-user editing before any Jira write-back.

**Architecture:** Replace the JSON-file override store as the frontend source of truth with a DB-backed `ScenarioDraft` aggregate. New app code must use `/api/scenario/drafts`; `/api/scenario/overrides` remains only as a legacy read alias and JSON-file fallback, and DB-mode writes through that alias must not bypass optimistic concurrency. The first slice ships persistence and history; the second wires the frontend and removes all frontend override-route calls; the third adds polling-first collaboration awareness and keeps Jira write-back blocked.

**Tech Stack:** Flask, SQLAlchemy/Alembic, existing OAuth request context and token-bound CSRF, React 19, esbuild, Python `unittest`, Node tests, Playwright visual checks.

---

## Scope Decision

I am assuming the active scenario draft is shared per workspace and scope, not private per user. That matches the requirement for simultaneous cross-user editing and the phrase "one active draft per sprint + team/group scope."

Scope means:
- selected sprint id/name, which maps to the quarter bounds already used by `/api/scenario`;
- active team selection or group id;
- workspace/site from the request auth context.

The DB row records `created_by` and `updated_by`, but `owner_user_id` is not part of the uniqueness rule.

Groups are shared environment-scoped configuration, created and maintained by project managers/EPMs outside the Scenario draft. A Scenario draft may reference a group id/name from that shared config, but it must not create private per-user group definitions or copy group membership as draft-owned source of truth.

## Terminology

- `draftRevision`: the active draft concurrency integer. It starts at `1` when a draft is created and increments on save, rollback, and reload-from-Jira.
- `baseDraftRevision`: the client request value proving which `draftRevision` the user edited from. Mutating DB-mode draft routes reject missing or stale values except when creating the first draft.
- `versionNumber`: an append-only history snapshot number for a draft. Rollback and reload create new versions; they never mutate existing history rows.
- `eventNumber`: an append-only collaboration-event cursor. Events include the resulting `draftRevision`, but the cursor itself is not a draft revision.

Do not add generic response fields named `revision` or route semantics named `versionRevision`; use the names above consistently.

## Cross-Slice Glossary

| Term | Meaning | Allowed values / shape | Where it appears |
|---|---|---|---|
| `revision` | Forbidden generic name for draft concurrency. | Do not emit, accept, or store as an API field. | Source guards and route tests must fail if new draft code uses it. |
| `draftRevision` | Active draft optimistic-concurrency integer. | Positive integer, increments on save, rollback, and reload-from-Jira. | Active draft responses, conflict bodies, event payloads. |
| `baseDraftRevision` | Client's last-seen `draftRevision` for a mutating request. | Required for updating existing drafts, rollback, reload-from-Jira; optional/null only when creating the first draft. | Save, rollback, reload-from-Jira request bodies. |
| `versionNumber` | Append-only history snapshot number for one draft. | Positive integer, monotonic per draft; rollback/reload create a new `versionNumber`. | Version list rows, version snapshot route, conflict bodies. |
| `eventNumber` | Collaboration event tail cursor. | Positive integer, monotonic per draft; not a draft revision. | `/events` and optional SSE payloads. |
| `source` | Version snapshot provenance. | `user`, `legacy_json`, `rollback`, `reload_from_jira`. | Version rows and `ScenarioDraftVersion.source`. |
| `storage` | Persistence backend used by a route response. | `db` for DB-mode draft routes; legacy JSON/basic alias may omit it to preserve old shape. | `/api/scenario/drafts` responses and DB-mode legacy alias responses. |

## Credential Guardrails

Any future "publish to Jira" or write-back implementation must use only the signed-in user's Atlassian OAuth Jira REST context. Do not use Jira Basic credentials, Jira service integrations, Home/Townsquare APIs, `home_townsquare_basic`, `jira_basic`, `atlassian_user_api_token`, or local token-store helpers for Jira publishing.

The plans in this split do not implement Jira publishing. Slice 03 may add blocked/preview-only routes, but real Jira mutation requires a separate future `EXEC-*` plan that repeats this OAuth-only guardrail in its route contract and tests.

## Split Plans

Run these in order:

1. `DONE-scenario-planner-quarter-drafts-01-persistence-api.md`
   - Adds DB models, migration, service/repository code, new draft routes, legacy `/api/scenario/overrides` read/fallback behavior, and backend tests.
2. `DONE-scenario-planner-quarter-drafts-02-frontend-history.md`
   - Wires the existing Scenario Planner edit buffer to active draft metadata, history, reload, rollback, conflict handling, and visual verification.
3. `DONE-scenario-planner-quarter-drafts-03-collaboration-writeback-gate.md`
   - Adds polling-first events, optional-gated SSE, advisory presence/locks, multi-user conflict recovery, and an explicit Jira write-back gate.

Do not implement Jira write-back in any of these three plans. Slice 03 keeps any write-back route blocked with `403 jira_writeback_gate_blocked`; passing slice 03 tests only permits writing a separate future `EXEC-*` plan for real Jira mutation. Do not add Home/Townsquare writes; `GATE-05-home-write-capability.md` remains blocked.

## Canonical Draft API

New frontend work must use `/api/scenario/drafts`. Slice 02 must replace both existing `frontend/src/dashboard.jsx` callers:

- `runScenario()` currently calls `GET /api/scenario/overrides?scope_key=...` after `/api/scenario`.
- `saveScenarioDraft()` currently posts to `/api/scenario/overrides`.

After slice 02 there must be zero frontend source calls to `/api/scenario/overrides`; add a source guard that fails if `frontend/src/` contains that route.

## Source-Of-Truth Migration Trace

Before and after each slice, run:

```bash
rg -n "/api/scenario/overrides|scenario-overrides|load_scenario_overrides|save_scenario_overrides" frontend/src tests jira_server.py backend docs/features -g '!frontend/dist/**'
```

| Current caller/source | Current role | Required disposition | Verification |
|---|---|---|---|
| `frontend/src/dashboard.jsx` `runScenario()` `GET /api/scenario/overrides?scope_key=...` | Loads saved Scenario overrides into the edit buffer after `/api/scenario`. | Removed in slice 02 and replaced with `GET /api/scenario/drafts?scope_key=<scenarioScopeKey>`. | `tests/test_scenario_draft_history_source_guards.js` fails on any `/api/scenario/overrides` string in `frontend/src/`. |
| `frontend/src/dashboard.jsx` `saveScenarioDraft()` `POST /api/scenario/overrides` | Saves Scenario overrides through the JSON/no-revision route. | Removed in slice 02 and replaced with `POST /api/scenario/drafts` plus `baseDraftRevision` and token-bound CSRF. | Playwright save-conflict test proves stale DB save preserves local edits. |
| `tests/ui/codebase_structure_smoke.spec.js` mock for `/api/scenario/overrides` | Keeps current Scenario smoke test running. | Removed/replaced in slice 02 with `/api/scenario/drafts` mock payloads. | Scenario smoke test passes and source guard sees no frontend override route string. |
| `tests/test_oauth_stats_routes.py` legacy override tests | Proves old route is OAuth-ready/basic-compatible today. | Intentionally preserved but updated in slice 01: DB-mode `GET` delegates, DB-mode `POST` rejects, basic/json-file `POST` still writes JSON. | Route tests cover DB and basic modes separately. |
| `jira_server.py` `load_scenario_overrides()` / `save_scenario_overrides()` | JSON file persistence helpers for `scenario-overrides.json`. | Intentionally preserved for JSON-file/basic fallback and single-workspace lazy import only. | Backend tests prove DB mode does not write through the helpers except permitted import/fallback paths. |
| `jira_server.py` `/api/scenario/overrides` route handlers | Current source of truth for saved overrides. | Delegated in DB mode for `GET`; rejected in DB mode for `POST`; preserved in basic/json-file mode. | Alias contract tests assert `scenario_draft_revision_required` and `scenario_draft_api_required`. |
| `jira_server.py` `OAUTH_READY_API_PATHS` `/api/scenario/overrides` | Marks legacy route as supported under OAuth. | Intentionally preserved for alias compatibility; add dynamic readiness for `/api/scenario/drafts` descendants. | OAuth-ready path tests prove new draft paths are recognized before unsafe-header guard. |
| `docs/features/scenario-planner.md` Overrides section | Documents JSON-file persistence as the user-facing model. | Updated in slice 01/02 to explain DB-backed draft history and legacy alias behavior. | Docs diff no longer says Scenario drafts are only persisted in `scenario-overrides.json`. |

## Fixed Review Checklist By Phase

| Review phase | Where it is specified | Must be true before saying "no blockers" |
|---|---|---|
| Contract matrix | Slice 01 `Route Contract Matrix`; slice 03 route ownership and runtime sections. | Every new/changed endpoint has method, auth, CSRF, workspace check, request body, success body, error bodies, and named tests. |
| Source-of-truth migration trace | This overview's trace table. | Every old `/api/scenario/overrides` or `scenario-overrides.json` caller is marked removed, delegated, or intentionally preserved. |
| State machine review | Slice 02 `Dirty Edit State Machine` and conflict recovery rules; slice 03 reconnect/runtime rules. | Dirty, saving, conflict, rollback, reload, scope switch, remote event, reconnect, and failed save all preserve local edits unless an explicit user action replaces them. |
| Security negative tests | Slice 01 route/auth task and slice 03 collaboration/write-back task. | Tests patch credential resolvers, local token-store helpers, raw Jira clients, current-user Jira clients, and Jira mutation clients to raise on forbidden paths. |
| Cross-slice glossary | This overview's glossary. | API fields use `draftRevision`, `baseDraftRevision`, `versionNumber`, `eventNumber`, `source`, and `storage`; no new generic `revision` field appears. |
| Runtime feasibility | Slice 03 runtime feasibility table. | SSE, polling, heartbeats, locks, reload, queue, and fan-out behavior name load, caps, timeout, and fallback. |
| Plan-process compliance | `docs/plans/AGENTS.md`, `docs/plans/GATE-*.md`, `docs/plans/README.md`, and project learnings in `AGENTS.md`. | Gate checks are current, OAuth-ready paths are tested before unsafe-header guard, project learnings are reviewed for Scenario/Jira/Home constraints, and no Home/Townsquare or real Jira write is enabled. |

### Active Draft

`GET /api/scenario/drafts?scope_key=<scope>` returns:

```json
{
  "activeDraft": {
    "draftId": "uuid",
    "scopeKey": "2026Q2:sprint-34625:group-grp-default",
    "name": "Draft 2026-05-14",
    "overrides": {},
    "draftRevision": 3,
    "versionNumber": 3,
    "updatedAt": "2026-05-14T10:00:00Z",
    "updatedBy": {"userId": "user-1", "displayName": "Ada"}
  },
  "versions": [
    {
      "versionNumber": 3,
      "draftRevision": 3,
      "overrideCount": 4,
      "createdAt": "2026-05-14T10:00:00Z",
      "createdBy": {"userId": "user-1", "displayName": "Ada"},
      "changeNote": "user save",
      "source": "user"
    }
  ],
  "storage": "db"
}
```

No draft returns `activeDraft: null`, `versions: []`, and `storage: "db"`.

### Save Draft

`POST /api/scenario/drafts` accepts:

```json
{
  "scope_key": "2026Q2:sprint-34625:group-grp-default",
  "name": "Draft 2026-05-14",
  "baseDraftRevision": 3,
  "scope": {"sprintId": "34625", "sprintName": "2026Q2 Sprint 42", "groupId": "grp-default"},
  "overrides": {}
}
```

Every successful save increments `draftRevision` and creates a version snapshot. Stale `baseDraftRevision` returns the canonical conflict body below.

### Conflict Body

All stale save, stale rollback, and stale reload-from-Jira responses use status `409` and this shape:

```json
{
  "error": "scenario_draft_conflict",
  "message": "Scenario draft changed. Review the current draft before saving.",
  "conflict": {
    "reason": "stale_base_draft_revision",
    "receivedBaseDraftRevision": 3,
    "currentDraftRevision": 5,
    "currentVersionNumber": 5
  },
  "activeDraft": {
    "draftId": "uuid",
    "scopeKey": "2026Q2:sprint-34625:group-grp-default",
    "name": "Draft 2026-05-14",
    "overrides": {},
    "draftRevision": 5,
    "versionNumber": 5,
    "updatedAt": "2026-05-14T10:08:00Z",
    "updatedBy": {"userId": "user-2", "displayName": "Grace"}
  },
  "versions": [
    {
      "versionNumber": 5,
      "draftRevision": 5,
      "overrideCount": 7,
      "createdAt": "2026-05-14T10:08:00Z",
      "createdBy": {"userId": "user-2", "displayName": "Grace"},
      "changeNote": "user save",
      "source": "user"
    }
  ],
  "storage": "db"
}
```

### Version Snapshot

`GET /api/scenario/drafts/<draft_id>/versions/<version_number>` returns the saved snapshot with `overrides`.

### Rollback

`POST /api/scenario/drafts/<draft_id>/rollback` accepts `targetVersionNumber` and `baseDraftRevision`. Rollback creates a new version from the target snapshot; it never mutates old version rows.

Every `/api/scenario/drafts/<draft_id>` route must first resolve the current auth context and prove `draft.workspace_id == context.workspace_id`. This applies to versions, rollback, events, SSE, presence, locks, reload-from-Jira, preview, and blocked write-back. Drafts are workspace-shared, so the check is workspace ownership plus active authenticated user context, not draft creator ownership.

## Compatibility Alias

Keep:
- `GET /api/scenario/overrides?scope_key=<scope>` returning at least `{ "overrides": {} }`;
- `POST /api/scenario/overrides` only for JSON-file/basic fallback.

In DB mode:

- `GET /api/scenario/overrides` delegates to the active draft and may include additive metadata, but it must preserve `overrides`.
- `POST /api/scenario/overrides` rejects the old no-revision write contract with `409 scenario_draft_revision_required` and the current `activeDraft`/`versions` payload. If the body includes `baseDraftRevision`, return `409 scenario_draft_api_required` with a message instructing callers to use `POST /api/scenario/drafts`; do not perform DB writes through the alias.
- Source guards must prove the app frontend no longer calls this alias, so this compatibility rule cannot reintroduce last-write-wins from dashboard code.

In JSON-file/basic mode, the alias preserves the current response shape and writes `scenario-overrides.json`.

Legacy JSON import is single-workspace only. In DB mode, import `scenario-overrides.json` only when the current environment has exactly one workspace or when a future explicit `SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID` matches `context.workspace_id`. Do not replicate global JSON data into every workspace.

## Verification Gate

Preflight before executing any slice:

```bash
git status --short
rg --files docs/plans | rg '/GATE-'
```

Before this feature can be considered complete:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db tests.test_scenario_draft_routes tests.test_scenario_draft_security_source_guards tests.test_oauth_stats_routes tests.test_config_jsonfile_fallback
node --test tests/test_scenario_draft_history_source_guards.js
npm run build
npx playwright test tests/ui/scenario_draft_history.spec.js
npx playwright test tests/ui/scenario_draft_collaboration.spec.js
```

Run the full suite before push:

```bash
.venv/bin/python -m unittest discover -s tests
```

Acceptance requires no `frontend/dist` edits, no frontend calls to `/api/scenario/overrides`, no Home/Townsquare write route, no Jira write-back route that mutates Jira, source guards for forbidden credential/import paths, multi-workspace same-scope tests, OAuth-ready unsafe-route tests, gate-doc startup checks, and screenshots proving Scenario sticky layout still works with history/collaboration UI.
