# Scenario Planner Quarter Drafts 03 Collaboration/Write-Back Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pragmatic real-time support for simultaneous users editing the same Scenario draft, while keeping Jira write-back blocked and requiring a separate future plan for any real Jira mutation.

**Architecture:** Keep optimistic concurrency as the correctness mechanism and add lightweight real-time awareness with Server-Sent Events plus polling fallback. Presence and locks are advisory only; every mutating save still requires the current `baseRevision`.

**Tech Stack:** Flask, SQLAlchemy/Alembic, SSE via `text/event-stream`, React 19, Playwright multi-page tests, Python `unittest`.

---

## Prerequisites

Run these first:

1. `EXEC-scenario-planner-quarter-drafts-01-persistence-api.md`
2. `EXEC-scenario-planner-quarter-drafts-02-frontend-history.md`

Do not start this slice until basic DB history, reload, rollback, and stale-save `409` handling already pass.

## Non-Goals

- No CRDT editor.
- No websocket dependency unless an existing real-time stack is discovered and documented.
- No Home/Townsquare write route.
- No Jira mutation route that writes dates.
- No Jira publish path that uses API tokens, Jira Basic credentials, service integrations, Home/Townsquare credentials, or local token-store helpers.
- No Scenario UI or API that creates private group definitions or changes shared group membership.

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `backend/db/models.py` | Add draft event, presence, and advisory lock models. |
| Create | `backend/db/migrations/versions/20260514_0005_scenario_draft_collaboration.py` | Create collaboration tables. |
| Modify | `backend/scenario_drafts.py` | Append events on version changes; manage presence and locks. |
| Modify | `backend/routes/scenario_draft_routes.py` | Add event polling, SSE stream, presence, lock, reload-from-Jira preview, and blocked write-back routes. |
| Modify | `frontend/src/dashboard.jsx` | Subscribe to events, show presence/lock indicators, recover from concurrent edits. |
| Modify | `jira-dashboard.html` | Add compact presence, lock, stale draft, and gate-state styles. |
| Create | `tests/test_scenario_draft_collaboration.py` | Backend tests for event ordering, SSE/polling payloads, presence expiry, lock conflicts, blocked write-back. |
| Create | `tests/ui/scenario_draft_collaboration.spec.js` | Two-page UI tests for conflict, reload, rollback, presence, lock, and write-back gate. |

## Data Model Additions

`ScenarioDraftEvent`:
- `id`, `scenario_draft_id`, `event_number`, `event_type`, `draft_revision`, `payload`, `created_by`, `created_at`.
- Unique `(scenario_draft_id, event_number)`.

`ScenarioDraftPresence`:
- `id`, `scenario_draft_id`, `user_id`, `display_name`, `cursor_payload`, `mode`, `last_seen_at`.
- Unique `(scenario_draft_id, user_id)`.

`ScenarioDraftLock`:
- `id`, `scenario_draft_id`, `resource_type`, `resource_id`, `holder_user_id`, `holder_display_name`, `expires_at`, `updated_at`.
- Unique active lock lookup by `(scenario_draft_id, resource_type, resource_id)`.

Presence expires after 30 seconds. Issue locks expire after 30 seconds and are refreshed while dragging.

## Event Contract

Allowed event types:
- `draft.created`
- `draft.updated`
- `draft.rolled_back`
- `draft.reloaded_from_jira`
- `presence.updated`
- `lock.updated`
- `writeback.blocked`

Event payload:

```json
{
  "eventNumber": 12,
  "draftId": "uuid",
  "type": "draft.updated",
  "revision": 7,
  "actor": {"userId": "user-1", "displayName": "Ada"},
  "operationSummary": "Moved PROD-1",
  "createdAt": "2026-05-14T10:20:30Z"
}
```

## Routes

### `GET /api/scenario/drafts/<draft_id>/events?since=<event_number>`

Polling fallback. Returns ordered events after `since`.

### `GET /api/scenario/drafts/<draft_id>/events/stream?since=<event_number>`

SSE stream. Emits the same event payloads as polling. If the connection drops, the client reconnects with the last seen `eventNumber`.

### `POST /api/scenario/drafts/<draft_id>/presence`

Requires CSRF. Updates current user's presence and emits `presence.updated`. Does not change draft revision.

### `POST /api/scenario/drafts/<draft_id>/locks`

Requires CSRF. Acquires, refreshes, or releases an advisory lock for an issue key. Lock conflicts return `409 scenario_draft_lock_held`.

### `POST /api/scenario/drafts/<draft_id>/reload-from-jira`

Requires auth, token-bound CSRF, and `baseRevision`. Re-runs the scenario fetch for the saved scope, records the previous active state in history, updates `scenario_source_hash`, increments revision, and emits `draft.reloaded_from_jira`.

### `POST /api/scenario/drafts/<draft_id>/writeback/preview`

Requires auth and token-bound CSRF. Allowed as dry-run only. It returns the Jira field changes that would be attempted by a separate future Jira write-back plan and never calls Jira mutation APIs. The preview must use only the current user's OAuth Jira REST context for any read needed to prepare the preview; it must not use Jira/Home API tokens, Basic credentials, service integrations, or Home/Townsquare APIs.

### `POST /api/scenario/drafts/<draft_id>/writeback`

Requires auth and token-bound CSRF. Must return:

```json
{
  "error": "jira_writeback_gate_blocked",
  "message": "Jira write-back is blocked for this feature. Create a separate future execution plan before enabling Jira mutation."
}
```

Status: `403`.

The blocked write-back route must not resolve or inspect Jira Basic credentials, Home/Townsquare credentials, `atlassian_user_api_token`, service integrations, or local token-store helper data. Tests should fail if those credential paths are called.

## Frontend Behavior

- Open SSE when a draft is loaded; fall back to 5-second polling if SSE fails.
- Show a compact "Editing now" presence strip in the Scenario controls.
- Show same-issue advisory lock warnings during drag.
- On event revision greater than local `baseRevision`, show `Newer draft available` with actions:
  - `Review history`;
  - `Reload active draft`;
  - `Keep editing locally`.
- Never auto-apply remote overrides over dirty local edits.
- If a local save receives `409`, keep local edits, show conflict details, and route the user to history/reload/rollback.

## Task 1: Backend Collaboration Tables

- [ ] Add models for events, presence, and locks.
- [ ] Add migration `20260514_0005_scenario_draft_collaboration.py`.
- [ ] Test migration, event sequence uniqueness, presence upsert/expiry, and lock conflict/expiry.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_draft_collaboration
```

Expected: table and service tests pass.

## Task 2: Event Append And Routes

- [ ] Append events inside existing save and rollback service paths from slice 01.
- [ ] Add polling events route.
- [ ] Add SSE stream route.
- [ ] Add presence and lock routes with CSRF.
- [ ] Add blocked write-back route and preview-only route.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_draft_routes tests.test_scenario_draft_collaboration
```

Expected: route contracts, auth, CSRF, event ordering, and blocked write-back pass.

## Task 3: Frontend Real-Time Awareness

- [ ] Track `scenarioDraftEvents`, `scenarioDraftPresence`, `scenarioDraftLocks`, `scenarioDraftRealtimeStatus`, and last seen event number.
- [ ] Subscribe to SSE after an active draft loads.
- [ ] Fall back to polling if SSE errors or times out.
- [ ] Send presence heartbeat while Scenario is open and draft metadata exists.
- [ ] Acquire an issue advisory lock on drag start, refresh while dragging, release on mouseup/cancel.
- [ ] Show remote revision/stale state without overwriting dirty local edits.

Verification:

```bash
npm run build
npx playwright test tests/ui/scenario_draft_collaboration.spec.js --grep "presence|lock|stale"
```

Expected: UI shows another user, same-issue lock warning, and newer-draft state in a two-page test.

## Task 4: Reload, Rollback, And Write-Back Gate UX

- [ ] Add `Reload active draft` action for newer remote versions.
- [ ] Keep rollback visible in History before any write-back controls.
- [ ] If any Jira write-back button is introduced later, it must be disabled or preview-only in this slice.
- [ ] Show the blocked write-back response if a user reaches the route.
- [ ] Add a note in the final implementation summary that real Jira mutation still requires a new future `EXEC-*` plan after this slice is accepted.
- [ ] Add tests proving preview/blocked write-back paths do not call Jira Basic, service integration, Home/Townsquare, or `atlassian_user_api_token` credential resolvers.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_collaboration.spec.js --grep "write-back|rollback|reload"
```

Expected: rollback/reload recover from stale draft state and write-back remains blocked.

## Task 5: Completion Gate

Run:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db tests.test_scenario_draft_routes tests.test_scenario_draft_collaboration
.venv/bin/python -m unittest tests.test_oauth_stats_routes tests.test_config_jsonfile_fallback
node --test tests/test_scenario_draft_history_source_guards.js
npm run build
npx playwright test tests/ui/scenario_draft_history.spec.js
npx playwright test tests/ui/scenario_draft_collaboration.spec.js
```

Expected:
- concurrent edits cannot silently overwrite;
- stale saves return `409`;
- presence and locks are visible but advisory;
- reload from Jira records history;
- rollback creates a new version from history;
- write-back route returns `403 jira_writeback_gate_blocked`;
- passing these tests does not authorize enabling real Jira write-back;
- any future real Jira write-back must use only the signed-in user's OAuth Jira REST context;
- no Home/Townsquare write behavior exists.

## Commit Messages

- Task 1: `git commit -m "feat: add scenario draft collaboration schema"`
- Task 2: `git commit -m "feat: add scenario draft collaboration routes"`
- Task 3: `git commit -m "feat: show scenario draft collaboration state"`
- Task 4: `git commit -m "feat: gate scenario draft Jira writeback"`
- Task 5: `git commit -m "test: verify scenario draft collaboration"`
