# Scenario Planner Quarter Drafts Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement these plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DB-backed, versioned Scenario Planner drafts for a quarter scope, with one shared active draft per sprint plus team/group scope, reload/rollback history, and guarded multi-user editing before any Jira write-back.

**Architecture:** Replace the JSON-file override store with a DB-backed `ScenarioDraft` aggregate, keep `/api/scenario/overrides` as a compatibility alias, and expose new `/api/scenario/drafts` routes for active drafts, version history, rollback, and later collaboration events. The first slice ships persistence and history; the second wires the frontend; the third adds real-time presence/conflict support and keeps Jira write-back blocked.

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

## Credential Guardrails

Any future "publish to Jira" or write-back implementation must use only the signed-in user's Atlassian OAuth Jira REST context. Do not use Jira Basic credentials, Jira service integrations, Home/Townsquare APIs, `home_townsquare_basic`, `jira_basic`, `atlassian_user_api_token`, or local token-store helpers for Jira publishing.

The plans in this split do not implement Jira publishing. Slice 03 may add blocked/preview-only routes, but real Jira mutation requires a separate future `EXEC-*` plan that repeats this OAuth-only guardrail in its route contract and tests.

## Split Plans

Run these in order:

1. `EXEC-scenario-planner-quarter-drafts-01-persistence-api.md`
   - Adds DB models, migration, service/repository code, new draft routes, legacy `/api/scenario/overrides` compatibility, and backend tests.
2. `EXEC-scenario-planner-quarter-drafts-02-frontend-history.md`
   - Wires the existing Scenario Planner edit buffer to active draft metadata, history, reload, rollback, conflict handling, and visual verification.
3. `EXEC-scenario-planner-quarter-drafts-03-collaboration-writeback-gate.md`
   - Adds SSE/polling events, advisory presence/locks, multi-user conflict recovery, and an explicit Jira write-back gate.

Do not implement Jira write-back in any of these three plans. Slice 03 keeps any write-back route blocked with `403 jira_writeback_gate_blocked`; passing slice 03 tests only permits writing a separate future `EXEC-*` plan for real Jira mutation. Do not add Home/Townsquare writes; `GATE-05-home-write-capability.md` remains blocked.

## Canonical Draft API

New frontend work should use `/api/scenario/drafts`. Existing callers of `/api/scenario/overrides` must continue to work.

### Active Draft

`GET /api/scenario/drafts?scope_key=<scope>` returns:

```json
{
  "activeDraft": {
    "draftId": "uuid",
    "scopeKey": "2026Q2:sprint-34625:group-grp-default",
    "name": "Draft 2026-05-14",
    "overrides": {},
    "revision": 3,
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
  "baseRevision": 3,
  "scope": {"sprintId": "34625", "sprintName": "2026Q2 Sprint 42", "groupId": "grp-default"},
  "overrides": {}
}
```

Every successful save increments `revision` and creates a version snapshot. Stale `baseRevision` returns `409 scenario_draft_conflict` with the current active draft.

### Version Snapshot

`GET /api/scenario/drafts/<draft_id>/versions/<version_number>` returns the saved snapshot with `overrides`.

### Rollback

`POST /api/scenario/drafts/<draft_id>/rollback` accepts `targetVersionNumber` and `baseRevision`. Rollback creates a new version from the target snapshot; it never mutates old version rows.

## Compatibility Alias

Keep:
- `GET /api/scenario/overrides?scope_key=<scope>` returning at least `{ "overrides": {} }`;
- `POST /api/scenario/overrides` accepting current callers' `{scope_key, name, overrides}`.

In DB mode, these routes delegate to the same draft service and include additive metadata where useful. In JSON-file mode, they preserve the current response shape.

## Verification Gate

Preflight before executing any slice:

```bash
git status --short
rg --files docs/plans | rg '/GATE-'
```

Before this feature can be considered complete:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db tests.test_scenario_draft_routes tests.test_oauth_stats_routes tests.test_config_jsonfile_fallback
node --test tests/test_scenario_draft_history_source_guards.js
npm run build
npx playwright test tests/ui/scenario_draft_history.spec.js
npx playwright test tests/ui/scenario_draft_collaboration.spec.js
```

Run the full suite before push:

```bash
.venv/bin/python -m unittest discover -s tests
```

Acceptance requires no `frontend/dist` edits, no Home/Townsquare write route, no Jira write-back route that mutates Jira, and screenshots proving Scenario sticky layout still works with history/collaboration UI.
