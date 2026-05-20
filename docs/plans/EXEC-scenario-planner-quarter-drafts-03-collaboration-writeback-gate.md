# Scenario Planner Quarter Drafts 03 Collaboration/Write-Back Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pragmatic real-time support for simultaneous users editing the same Scenario draft, while keeping Jira write-back blocked and requiring a separate future plan for any real Jira mutation.

**Architecture:** Keep optimistic concurrency as the correctness mechanism and add lightweight real-time awareness with polling by default. Server-Sent Events are opt-in behind an explicit runtime flag until the Flask worker behavior is proven safe. Presence and locks are advisory only; every mutating save, rollback, and reload-from-Jira still requires the current `baseDraftRevision`.

**Tech Stack:** Flask, SQLAlchemy/Alembic, polling event tail cursor, optional SSE via `text/event-stream`, React 19, Playwright multi-page tests, Python `unittest`.

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
| Modify | `backend/routes/scenario_draft_routes.py` | Add event polling, optional SSE stream, presence, lock, reload-from-Jira, write-back preview, and blocked write-back routes. |
| Modify | `frontend/src/dashboard.jsx` | Subscribe to events, show presence/lock indicators, recover from concurrent edits. |
| Modify | `jira-dashboard.html` | Add compact presence, lock, stale draft, and gate-state styles. |
| Create | `tests/test_scenario_draft_collaboration.py` | Backend tests for event ordering, SSE/polling payloads, presence expiry, lock conflicts, blocked write-back. |
| Create | `tests/ui/scenario_draft_collaboration.spec.js` | Two-page UI tests for conflict, reload, rollback, presence, lock, and write-back gate. |
| Modify | `tests/test_scenario_draft_security_source_guards.py` | Extend forbidden credential/token-store source guards for collaboration/write-back modules. |

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

Rollback and reload-from-Jira invalidate advisory locks for the draft by expiring all current locks. That prevents a user from holding a lock against an issue position that no longer matches the active draft.

## Route Ownership And Auth Guard

Every route under `/api/scenario/drafts/<draft_id>` must:

1. Resolve `current_request_auth_context()` and require an active authenticated user.
2. Load the draft by `draft_id`.
3. Return `404 scenario_draft_not_found` when the draft does not exist or `draft.workspace_id != context.workspace_id`.
4. Use `context.user_id` and `context.stable_subject` for actor, presence, and lock ownership; do not trust user ids from the request body.
5. Require both `X-Requested-With: jira-execution-planner` and token-bound `X-CSRF-Token` for unsafe OAuth requests.

This ownership check applies to events, SSE, presence, locks, rollback, reload-from-Jira, writeback preview, and blocked writeback.

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
  "draftRevision": 7,
  "actor": {"userId": "user-1", "displayName": "Ada"},
  "operationSummary": "Moved PROD-1",
  "createdAt": "2026-05-14T10:20:30Z"
}
```

`since` is a tail cursor, not Jira-style pagination. `GET /events?since=12` returns events with `eventNumber > 12`, ordered ascending:

```json
{
  "events": [
    {
      "eventNumber": 13,
      "draftId": "uuid",
      "type": "draft.updated",
      "draftRevision": 8,
      "actor": {"userId": "user-2", "displayName": "Grace"},
      "operationSummary": "Moved PROD-2",
      "createdAt": "2026-05-14T10:21:30Z"
    }
  ],
  "nextSince": 13,
  "isLast": true
}
```

Return at most 100 events per request. If more events remain after that cap, return `isLast: false` and `nextSince` equal to the last returned `eventNumber`; the client immediately requests the next page until `isLast: true`. When there are no new events, return `events: []`, `nextSince` equal to the received `since`, and `isLast: true`.

## Routes

### `GET /api/scenario/drafts/<draft_id>/events?since=<event_number>`

Default collaboration transport. Returns the cursor object above. The frontend polls every 5 seconds while a draft is visible and stops when Scenario unmounts or the draft scope changes.

### `GET /api/scenario/drafts/<draft_id>/events/stream?since=<event_number>`

Optional SSE stream. Only register or use this route when `SCENARIO_DRAFT_SSE_ENABLED=true` and a local runtime test proves long-lived streams do not tie up all available Flask workers. Emits the same event payloads as polling. If the connection drops, the client reconnects with the last seen `eventNumber`; tests must prove reconnect does not lose events already visible through polling.

### `POST /api/scenario/drafts/<draft_id>/presence`

Requires CSRF. Updates current user's presence and emits `presence.updated`. Does not change `draftRevision`.

Request:

```json
{
  "mode": "editing",
  "cursor": {"issueKey": "PROD-1", "field": "start"}
}
```

Response:

```json
{
  "presence": [
    {
      "userId": "user-1",
      "displayName": "Ada",
      "mode": "editing",
      "cursor": {"issueKey": "PROD-1", "field": "start"},
      "lastSeenAt": "2026-05-14T10:20:30Z",
      "expiresAt": "2026-05-14T10:21:00Z"
    }
  ],
  "event": {
    "eventNumber": 14,
    "draftId": "uuid",
    "type": "presence.updated",
    "draftRevision": 8,
    "actor": {"userId": "user-1", "displayName": "Ada"},
    "operationSummary": "Editing",
    "createdAt": "2026-05-14T10:20:30Z"
  }
}
```

### `POST /api/scenario/drafts/<draft_id>/locks`

Requires CSRF. Acquires, refreshes, or releases an advisory lock for an issue key. Lock conflicts return `409 scenario_draft_lock_held`.

Acquire request:

```json
{
  "action": "acquire",
  "resourceType": "issue",
  "resourceId": "PROD-1",
  "ttlSeconds": 30
}
```

Refresh and release use the same `resourceType` and `resourceId` with `action: "refresh"` or `action: "release"`. `ttlSeconds` is optional and capped at 30.

Success response:

```json
{
  "lock": {
    "resourceType": "issue",
    "resourceId": "PROD-1",
    "holderUserId": "user-1",
    "holderDisplayName": "Ada",
    "expiresAt": "2026-05-14T10:21:00Z"
  },
  "locks": []
}
```

Conflict response:

```json
{
  "error": "scenario_draft_lock_held",
  "message": "Another user is editing this issue.",
  "lock": {
    "resourceType": "issue",
    "resourceId": "PROD-1",
    "holderUserId": "user-2",
    "holderDisplayName": "Grace",
    "expiresAt": "2026-05-14T10:21:00Z"
  }
}
```

The same user can refresh or release their own lock. Expired locks are ignored and may be replaced.

### `POST /api/scenario/drafts/<draft_id>/reload-from-jira`

Requires auth, token-bound CSRF, and `baseDraftRevision`. Re-runs the scenario fetch for the saved scope, records the previous active state in history, updates `scenario_source_hash`, increments `draftRevision`, appends a version with `source: "reload_from_jira"`, expires current locks, and emits `draft.reloaded_from_jira`.

Request:

```json
{
  "baseDraftRevision": 8
}
```

Stale `baseDraftRevision` returns the canonical `409 scenario_draft_conflict` body from the overview.

Reload is synchronous in this slice with an explicit SLA: reuse the existing scenario planner fetch path once, do not add per-issue fan-out beyond the existing route, and return `503 scenario_reload_timeout` if it cannot complete within 20 seconds. Do not add background jobs unless a later plan introduces a job runner.

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

## Runtime Feasibility And Fallbacks

| Behavior | Expected load | Server limit/fallback | Client fallback |
|---|---:|---|---|
| Event polling | Up to 20 visible draft sessions per local deployment; 5-second interval means up to 240 `GET /events` requests/minute. | Cap responses at 100 events; return `isLast: false` for catch-up pages; no per-issue Jira fan-out. | Stop polling when Scenario unmounts or scope changes; if a poll fails, keep local edits and retry on the next interval with a reconnecting indicator. |
| Presence heartbeat | Up to 20 users per draft; heartbeat every 15 seconds means up to 80 `POST /presence` requests/minute. | Expire presence after 30 seconds; reject oversized cursor payloads with `400 scenario_presence_payload_too_large`; do not write presence if CSRF/auth fails. | Refresh CSRF once on `403 csrf_required`; otherwise pause heartbeats and keep editing local-only. |
| Advisory locks | Worst case 10 simultaneous drags; acquire once, refresh every 10 seconds, release on mouseup/cancel. | TTL capped at 30 seconds; expired locks are ignored; rollback/reload expires all active locks for the draft. | If lock acquire fails, show warning but allow local editing because locks are advisory. |
| Optional SSE | Disabled by default. If enabled, at most one stream per visible draft tab. | Register/use only with `SCENARIO_DRAFT_SSE_ENABLED=true` and a local worker test proving long-lived streams do not consume all Flask workers; polling remains available. | Fall back to polling on open failure, disconnect, timeout, or missing backend transport advertisement. |
| Reload-from-Jira | User-triggered, expected rare; one reload per active draft at a time. | Synchronous only; reuse the existing `/api/scenario` fetch path once, no additional per-issue fan-out, 20-second timeout with `503 scenario_reload_timeout`; concurrent stale reload returns canonical `409`. | Keep local edits on timeout/conflict and offer retry or history review. |
| Queues/background work | None in this slice. | Do not add background jobs, queues, or worker processes unless a later plan introduces a job runner and retry contract. | Show immediate route result only; no hidden pending state after request failure. |

## Frontend Behavior

- Poll events every 5 seconds when a draft is loaded. Open SSE only when the backend advertises `realtimeTransport: "sse"` or a static config flag enables it after the runtime proof.
- Show a compact "Editing now" presence strip in the Scenario controls.
- Show same-issue advisory lock warnings during drag.
- On event `draftRevision` greater than local `baseDraftRevision`, show `Newer draft available` with actions:
  - `Review history`;
  - `Reload active draft`;
  - `Keep editing locally`.
- Never auto-apply remote overrides over dirty local edits.
- If a local save receives `409`, keep local edits, show conflict details, and route the user to history/reload/rollback.
- Cache one CSRF token for presence/lock heartbeats. If a heartbeat returns `403 csrf_required`, fetch a fresh token once and retry the heartbeat once; if that retry fails, pause heartbeats, keep editing local-only, and show a recoverable auth state instead of dropping local edits.

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
- [ ] Add event pagination tests proving more than 100 queued events returns exactly 100 events, advances `nextSince`, and sets `isLast: false` until the final catch-up page.
- [ ] Add SSE stream route only behind `SCENARIO_DRAFT_SSE_ENABLED=true`; default runtime behavior remains polling.
- [ ] Add presence and lock routes with `X-Requested-With` plus token-bound CSRF.
- [ ] Add reload-from-Jira route with `baseDraftRevision`, `source: "reload_from_jira"`, deterministic `scenario_source_hash`, stale conflict handling, lock invalidation, and the 20-second synchronous SLA.
- [ ] Add blocked write-back route and preview-only route.
- [ ] Add route tests proving every `/api/scenario/drafts/<draft_id>` descendant returns `404 scenario_draft_not_found` for another workspace's draft id.
- [ ] Add OAuth-ready path tests for `/events`, `/presence`, `/locks`, `/reload-from-jira`, `/writeback/preview`, and `/writeback` before the unsafe-header guard.
- [ ] Add credential guard tests that patch Jira Basic, service integration, Home/Townsquare, and Jira mutation paths to raise for blocked write-back and preview: `jira_server.jira_get`, `jira_server.jira_post`, `jira_server.jira_request`, `jira_server.current_jira_request`, `jira_server.current_jira_get`, `jira_server.current_jira_search`, `jira_server.jira_search_request`, `backend.auth.home_credentials.resolve_home_credential`, `backend.auth.service_integrations.get_service_integration_summary`, and `backend.auth.service_integrations.list_service_integration_summaries`.
- [ ] Add service-level collaboration/write-back guard tests with explicit `RequestAuthContext` that patch `jira_server.oauth_session_data` and `jira_server.save_oauth_session` to raise, proving these paths do not depend on local token-store helpers outside the shared CSRF/auth entrypoint.
- [ ] Extend `tests/test_scenario_draft_security_source_guards.py` so draft collaboration/write-back code does not import or reference `OAUTH_TOKEN_STORE`, `oauth_session_data`, `save_oauth_session`, `resolve_home_credential`, `home_townsquare_basic`, `jira_basic`, `atlassian_user_api_token`, `jira_get`, `jira_post`, `jira_request`, `current_jira_request`, `current_jira_get`, `current_jira_search`, or `jira_search_request` except in the preview implementation section where `current_jira_get/current_jira_search` read calls are explicitly allowed and mocked. The blocked `POST /writeback` route has no such exception and must not call any Jira client.

Verification:

```bash
.venv/bin/python -m unittest tests.test_scenario_draft_routes tests.test_scenario_draft_collaboration tests.test_scenario_draft_security_source_guards
```

Expected: route contracts, ownership checks, auth, CSRF, event ordering, reload-from-Jira, and blocked write-back pass.

## Task 3: Frontend Real-Time Awareness

- [ ] Track `scenarioDraftEvents`, `scenarioDraftPresence`, `scenarioDraftLocks`, `scenarioDraftRealtimeStatus`, and last seen event number.
- [ ] Start 5-second polling after an active draft loads.
- [ ] Stop polling immediately when Scenario unmounts, the drawer scope changes, or the active `draftId` changes; add a Playwright assertion that old-scope polling stops after scope switch.
- [ ] Subscribe to SSE only when explicitly enabled, and keep polling fallback for reconnect/no-event-loss coverage.
- [ ] Send presence heartbeat while Scenario is open and draft metadata exists.
- [ ] Acquire an issue advisory lock on drag start, refresh while dragging, release on mouseup/cancel, and follow the CSRF refresh-on-403 strategy above.
- [ ] Show remote `draftRevision`/stale state without overwriting dirty local edits.

Verification:

```bash
npm run build
npx playwright test tests/ui/scenario_draft_collaboration.spec.js --grep "presence|lock|stale"
```

Expected: UI shows another user, same-issue lock warning, newer-draft state in a two-page test, and keeps local edits through CSRF heartbeat refresh failures.

## Task 4: Reload, Rollback, And Write-Back Gate UX

- [ ] Add `Reload active draft` action for newer remote versions.
- [ ] Keep rollback visible in History before any write-back controls.
- [ ] If any Jira write-back button is introduced later, it must be disabled or preview-only in this slice.
- [ ] Show the blocked write-back response if a user reaches the route.
- [ ] Add a note in the final implementation summary that real Jira mutation still requires a new future `EXEC-*` plan after this slice is accepted.
- [ ] Add tests proving preview/blocked write-back paths do not call Jira Basic, service integration, Home/Townsquare, or `atlassian_user_api_token` credential resolvers.
- [ ] Add Playwright coverage for dirty rollback confirmation, dirty remote event handling, and reload-from-Jira stale `baseDraftRevision` recovery.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_collaboration.spec.js --grep "write-back|rollback|reload"
```

Expected: rollback/reload recover from stale draft state and write-back remains blocked.

## Task 5: Completion Gate

Run:

```bash
.venv/bin/python -m unittest tests.test_scenario_drafts_db tests.test_scenario_draft_routes tests.test_scenario_draft_collaboration tests.test_scenario_draft_security_source_guards
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
- stale reload-from-Jira returns the canonical conflict body;
- rollback creates a new version from history;
- polling uses the `{events, nextSince, isLast}` cursor contract;
- event polling caps each response at 100 events and catch-up uses `isLast: false`;
- SSE remains disabled unless explicitly enabled and covered by reconnect/no-event-loss tests;
- write-back route returns `403 jira_writeback_gate_blocked`;
- source guards prove forbidden credential imports/calls are absent from draft modules;
- startup verification checked `docs/plans/GATE-*.md` and kept blocked gates blocked unless a documented `PASS` was recorded;
- Scenario history/collaboration screenshots cover sticky layout in closed, expanded, dirty confirmation, conflict, and stale-remote states;
- passing these tests does not authorize enabling real Jira write-back;
- any future real Jira write-back must use only the signed-in user's OAuth Jira REST context;
- no Home/Townsquare write behavior exists.

## Commit Messages

- Task 1: `git commit -m "feat: add scenario draft collaboration schema"`
- Task 2: `git commit -m "feat: add scenario draft collaboration routes"`
- Task 3: `git commit -m "feat: show scenario draft collaboration state"`
- Task 4: `git commit -m "feat: gate scenario draft Jira writeback"`
- Task 5: `git commit -m "test: verify scenario draft collaboration"`
