# Multi-Device Browser Sessions And Per-Tab Reauthentication Design

**Status:** Ready for execution. Run `EXEC-multi-device-browser-sessions-01-server.md`, then `EXEC-multi-device-browser-sessions-02-tab-resume.md`.

## Goal

Allow one Jira Delivery Planner user to remain signed in from multiple browsers or devices without shared OAuth token rotation invalidating another browser. When a real application `401` requires reauthentication, preserve the affected tab's safe UI state through the same-tab OAuth round trip so its current view, Planning mode, scope, teams, and selected story checkboxes are restored after login. Multiple open tabs must keep independent recovery snapshots.

## Source Baseline And Issue #143

The branch merged `origin/main` at `3530f60` on 2026-08-30. It contains `b38e8f7` (`Lock the app on authentication expiry`) and reviewed migration head `20260827_0008`. Each execution slice must still run Task 0 and stop if `origin/main`, the prerequisite ancestry, or the migration head has changed.

Commit `b38e8f7` already implements the first half of [issue #143](https://github.com/Juce-me/jira-execution-planner/issues/143): every app-owned API `401` terminally locks the mounted document behind one sanitized, accessible same-tab sign-in screen; failed writes are not replayed; and feature catches do not replace valid state with raw `401` errors or empty fallbacks.

The remaining issue gap is across navigation. The current document is intentionally destroyed when the user starts OAuth, so in-memory Planning selections and the active view are not restored in the new authenticated document. The current global lock also has no same-profile coordination for several locked browser tabs. This design closes those gaps without weakening the terminal lock.

## Current Failures

### Shared token version is treated as browser validity

DB-backed OAuth stores one `auth_connections` row and one rotating Atlassian token pair per user, workspace, provider, and Jira site. The signed Flask cookie stores that connection's `token_version`. A second OAuth callback or token refresh increments the shared connection version, so every other browser retains an older version and is rejected as `auth_connection_stale`.

The token version is correctly used to invalidate Jira/Home-derived caches when credentials rotate. It is the wrong browser-session validity boundary because credential rotation is shared account state, not proof that another browser session is invalid.

### Terminal recovery loses tab-local state

The global authentication lock correctly keeps the old application mounted and inert until the user chooses **Sign in again**. Same-tab navigation then unloads that document. Shared `localStorage` preferences can recover a general default, but they cannot recover the exact state of each tab and can be overwritten by another tab. Issue #143 specifically requires an open Planning process and its checkbox selection to survive reauthentication independently in each tab.

## Considered Approaches

### 1. Persistent browser sessions plus a tab-local recovery capsule — selected

Create one server-side browser-session row for every successful DB-backed OAuth login. The Flask cookie contains only its opaque id. Keep shared Atlassian tokens on the connection. Separately, capture a small, schema-validated UI recovery capsule in `sessionStorage` when the global auth lock latches. `sessionStorage` survives same-tab OAuth navigation and is isolated per top-level browser tab.

Use one short-lived, nonsecret `localStorage` lease to retain the active recovery attempt across navigation. Acquire or adopt that lease inside one origin-scoped exclusive Web Lock so simultaneous clicks in two tabs cannot both start OAuth. The recovering tab announces success immediately after authenticated bootstrap proves the private-view principal; another locked tab already shares the new Flask cookie and navigates to a new `/` document only when that success occurred after its failing request began, then restores its own `sessionStorage` capsule. Different browser profiles and devices have independent cookies/storage and authenticate independently.

### 2. Connection-wide session epoch

Store a second version on `auth_connections` that changes only on revocation or reconnect. This is smaller but all browsers still share one validity value, so the application cannot revoke one browser session without revoking every device.

### 3. Accept newer token versions and rely on shared preferences

Ignoring stale cookie token versions fixes the visible cross-device symptom but lets an old copied cookie become valid again after reconnect. Shared `localStorage` also cannot preserve two tabs with different Planning selections. This is not an acceptable security or state boundary.

### 4. Serialize the whole React tree

Persisting arbitrary component state would capture server data, stale revisions, transient errors, and potentially credential-form values. Recovery uses an explicit allowlist instead. No token, email field, API response body, loaded Jira payload, or failed request body enters browser storage.

## Architecture

### Server data model

Add `browser_sessions` in a new Alembic migration after the current migration head:

| Column | Contract |
| --- | --- |
| `id` | Random opaque UUID stored in the signed Flask session cookie. |
| `user_id` | Required owner; foreign key to `users` with cascade delete. |
| `workspace_id` | Required workspace boundary; foreign key to `workspaces` with cascade delete. |
| `auth_connection_id` | Required shared Atlassian OAuth connection; foreign key to `auth_connections` with cascade delete. |
| `created_at` | Creation timestamp. |

Index `auth_connection_id` and `(user_id, workspace_id)`. Do not store access tokens, refresh tokens, account emails, user-agent strings, IP addresses, OAuth callback data, or UI recovery state in this table.

Create `backend/auth/db_browser_sessions.py` as the sole lifecycle boundary. It creates, resolves, deletes one browser session, and deletes every session for a revoked connection. Callers receive sanitized handles or `AuthError`; callers do not query session rows directly.

### Cookie contract and legacy upgrade

DB-backed cookies use:

```python
session['db_oauth_session'] = {
    'db_browser_session_id': '<opaque id>',
}
```

The row resolves the user, workspace, and OAuth connection from the database. Cookie-supplied connection ids and token versions are not authoritative once the new id exists.

Legacy signed DB cookies containing `db_auth_connection_id` and `db_token_version` remain accepted only when their token version still exactly matches the database. The first successful DB request creates a browser-session record and replaces the legacy payload. A stale legacy cookie keeps the existing `auth_connection_stale` recovery. Concurrent lazy upgrades may create more than one valid row for one legacy cookie; only the row returned in the last signed cookie is reachable, and connection-wide revocation deletes every row. No legacy token-version mismatch is silently accepted.

### Login and reconnect flow

1. The callback exchanges the authorization code and upserts the existing shared OAuth connection/token pair.
2. If the connection was already active, existing browser-session rows remain active.
3. If the connection was revoked, expired, or errored before this callback, delete every old browser session in the same transaction before reactivating the connection. Old cookies cannot revive after reconnect.
4. Delete the current browser's previous session id, if present, and create a fresh browser-session row.
5. Save only the new opaque id in the Flask cookie and redirect to the dashboard.

Atlassian token replacement and browser-session creation occur in the same database transaction. Before select-then-insert upserts, PostgreSQL callbacks acquire sorted transaction-scoped advisory locks derived from the stable Atlassian external identity and Jira workspace natural identity. This serializes first-ever callbacks even when no row yet exists; the second transaction then observes the committed user/workspace/connection instead of failing a unique index. Callback upserts additionally lock an existing shared `auth_connections` row with `SELECT FOR UPDATE`, matching refresh serialization so concurrent reconnects cannot delete the browser row created by the callback that committed first. Preserve the existing callback failure split: validation failures before token exchange (`invalid_oauth_state`, authorization denial, missing code, or missing PKCE verifier) do not mutate an existing browser session; failures after token exchange begins may clear and delete only the current browser session. No callback failure may affect another browser's row.

### Request and refresh flow

`resolve_db_request_auth_context` resolves `db_browser_session_id`, verifies the row's user, workspace, and connection boundaries, then verifies that the referenced user and OAuth connection are active and have the required scopes. It returns the current connection `token_version` for cache partitioning plus the stable `browser_session_id` for CSRF and internal request propagation.

Token refresh stays serialized on the shared `auth_connection_id`. Rotating the access/refresh pair increments `auth_connections.token_version` but does not revoke browser sessions. A second browser resolves the new token version on its next request without reauthentication.

Successful `/api/auth/status`, `/api/auth/refresh`, and ordinary data requests resolve an upgraded browser session without writing it. The one-time legacy-cookie upgrade is the only session-table write allowed on a normal request path.

### Logout and revocation

- `POST /api/auth/logout` deletes only the caller's browser-session row and clears only its cookie.
- A missing browser-session row returns the existing `auth_required` recovery contract.
- Refresh-token reuse or another connection-level revocation deletes all linked browser sessions in the same committed transaction.
- A later successful reconnect creates a new row; deleted session ids cannot revive.
- A dedicated device list or "sign out all devices" endpoint remains out of scope.

The feature does not introduce a server-side inactivity timeout. DB-backed session lifetime continues to follow the signed Flask-cookie lifecycle. Retention and inactive-session expiry are separate future scope.

### CSRF

DB-backed CSRF tokens bind to the stable browser-session id, connection id, and Atlassian account id. They do not bind to mutable OAuth `token_version`; otherwise refresh in browser profile A would invalidate a CSRF token already issued to browser profile B.

CSRF hashes remain stored only in each signed Flask cookie and retain the existing consume-on-validation behavior and maximum-token bound. A token issued in browser profile A must fail in browser profile B even when both sessions reference the same user and connection. Tabs inside one browser profile intentionally share one cookie and browser-session binding. Concurrent requests that start from the same client-side Flask cookie are not an atomic one-use boundary; fixing that pre-existing limitation requires server-side CSRF/session state and is out of scope. Legacy cookies retain the old binding until their one-time upgrade.

### Internal request contexts

Scenario Planner's in-process reload request propagates `browser_session_id` from `RequestAuthContext`; it must not synthesize a connection-only browser cookie. Worker-thread Jira calls continue to carry captured request auth context and do not create browser-session rows.

### Global auth-lock integration

The shared HTTP boundary and `AuthRequiredGate` from `b38e8f7` remain authoritative:

- any app API `401` locks only that document's window-backed latch;
- the HTTP boundary records only the failing request's start timestamp plus the latch timestamp, allowing a delayed `401` to distinguish a recovery that happened while it was in flight from an older stale success marker;
- the application remains mounted and inert until navigation;
- no `401` response clears feature state, advances a revision, or replaces a dirty baseline;
- no successful response unlocks the old document;
- no failed request or mutation is replayed after login.

One tab's latch must never be written to `localStorage` or broadcast as a command to lock other tabs. Other tabs lock only when their own request discovers an invalid session.

### Per-tab recovery capsule

Create `frontend/src/api/authResumeState.js` with one `sessionStorage` key and this versioned allowlist:

```json
{
  "version": 1,
  "capturedAt": 0,
  "principal": {
    "workspaceId": "opaque-workspace-id",
    "viewConfigId": "opaque-private-view-id"
  },
  "view": {
    "selectedView": "eng",
    "activeGroupId": "group-id",
    "selectedSprint": "sprint-id",
    "engMode": "planning",
    "settingsOpen": false,
    "settingsTab": "teams"
  },
  "planning": {
    "scopeKey": "planning::sprint-id::group-id",
    "selectedTaskKeys": ["PLAN-1"],
    "selectedTeams": ["team-id"],
    "selectionMode": "manual"
  }
}
```

The implementation uses existing scope-key builders and normalizers rather than accepting arbitrary strings. The capsule expires after 30 minutes. It is rejected and cleared when malformed, oversized, expired, from an unsupported schema, or when `workspaceId` or the authenticated user's private `viewConfigId` does not match the new bootstrap response.

The capsule stores only navigation identifiers and selected Jira issue keys. It excludes loaded issues, summaries, user names, response bodies, server revisions, Scenario payloads, configuration drafts, analytics context, email fields, API-token inputs, OAuth state, PKCE data, and request bodies. Settings can reopen on the same tab, but unsaved Settings form values are not serialized. Credential inputs always return blank.

### Capture and restore order

1. The App keeps a ref containing the latest normalized recovery snapshot.
2. On `AUTH_REQUIRED_EVENT`, write the snapshot once to this tab's `sessionStorage`. A bootstrap `401` before principal/view state exists writes no capsule.
3. The old document stays mounted and inert. Later failures cannot overwrite the first snapshot.
4. After OAuth returns, run the ordinary authenticated bootstrap first.
5. Validate the capsule against `viewConfig.workspaceId` and `viewConfig.viewConfigId` before applying any value.
6. Restore the available primary view, Settings shell/tab, active group, sprint, and ENG mode. Invalid or no-longer-visible values fall back to the normal bootstrap selection.
7. For Planning, hold the capsule in a pending ref until the exact group/sprint task set is loaded. Reconcile task keys and teams through the existing Planning selection helpers, prune values no longer in scope, then apply and persist the reconciled selection.
8. Clear the capsule after successful application, a terminal validation rejection, or a non-auth/permission/scope failure of the first post-auth Planning hydration. That hydration failure settles to the ordinary error/default state and later manual reloads must not resurrect stale pre-auth selections. A failed/cancelled OAuth attempt or a new typed auth-required interruption leaves the capsule available until the next recovery outcome or expiry.

The Planning undo baseline is rebuilt from the post-login loaded selection. The old document's undo stack and in-flight requests are never restored.

### Same-profile multi-tab recovery coordination

Create `frontend/src/api/authRecoveryCoordinator.js` with:

- a five-minute `localStorage` lease containing only a random attempt id and start time;
- an origin-scoped exclusive Web Lock held only while committing claim or completion records;
- a five-minute `localStorage` success marker containing only the attempt id and completion time;
- tab-local attempt and consumed-success records in `sessionStorage`.

The first locked tab whose user chooses **Sign in again** acquires the Web Lock, samples time only after the lock is granted, claims the absent/expired lease, records its attempt in `sessionStorage`, releases the lock, and navigates to its sanitized login URL. Locked mutations use strict storage reads so an access failure cannot be mistaken for an absent lease. A simultaneous claimant waits for the same Web Lock, then observes the committed lease and remains a follower. A short lock is sufficient because the lease preserves ownership across `/login`, Atlassian, callback, and `/` navigation. If Web Locks or shared storage are unavailable, the clicked tab retains the existing uncoordinated same-tab navigation as a `solo` recovery; the gate does not deadlock, but simultaneous solo flows can still compete in the shared cookie and no cross-tab single-flight/resume guarantee applies.

After the recovering tab's new document completes authenticated config bootstrap and validates the private-view principal, it reacquires the same Web Lock, samples time inside the granted callback, verifies that its tab-local attempt still owns the live lease, removes that lease, and then writes the matching success marker immediately. A solo fallback, expired attempt, superseded leader, strict-read failure, or partial completion failure cannot publish success while leaving a live ghost lease. Completion does not wait for group, sprint, Planning task, or Settings hydration. Other locked tabs already share the new authenticated Flask cookie. Their locked effect installs its `storage` listener first, then synchronously reconciles the persisted lease and success marker. It consumes only a success whose completion time is on or after the failing request's recorded start time; therefore a delayed pre-recovery `401` can use the recovery that happened while it was in flight, while a genuinely newer `401` ignores an older marker. The tab records the attempt as consumed before `window.location.assign('/')` so bootstrap failure cannot create a reload loop. Each new document independently validates and applies its own isolated `sessionStorage` capsule.

Within a tab, the gate serializes click and storage-event paths with `claimPendingRef` and `navigationStartedRef`. A storage handler never consumes while a click is waiting for the lock. When the claim settles, the tab clears the pending flag, reconciles persisted success once, and only then handles the claim result. This prevents one document from scheduling both `/` and `/login`.

If OAuth fails or is cancelled, the lease expires after five minutes and any locked tab may atomically claim a new attempt. A success from an expired or superseded attempt cannot clear a newer lease. No identity, login URL, OAuth state, PKCE verifier, issue key, or configuration value enters the shared lease/success records.

## Endpoint Contract Matrix

| Endpoint | Method | Mode and workspace/site boundary | Auth/session boundary | Request contract | Success | Failure/recovery contract | Required tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/atlassian/login` | GET | Atlassian OAuth only; same-origin recovery entry, with the configured Jira site chosen only after callback resource validation. | Stores one OAuth state and PKCE verifier in the shared Flask cookie for the browser profile; frontend single-flight prevents competing same-profile starts when Web Locks/shared storage are available. | Optional existing `prompt=consent`; no body, CSRF token, or `X-Requested-With`. | Existing redirect to Atlassian authorization. | Sanitized `400` for invalid OAuth configuration; no token material in the response. Capability failure retains existing uncoordinated same-tab recovery. | Two simultaneous gate actions with working coordination produce exactly one `/login` navigation and exactly one later OAuth initiation; the follower starts no second flow. |
| `/api/auth/atlassian/callback` | GET | Atlassian OAuth only; accessible resource must match the configured Jira site, and the connection remains keyed by resolved user + workspace + cloud/site. | OAuth state + PKCE; PostgreSQL natural-key locks serialize absent-row creation, then the DB callback creates the current browser row and preserves other active devices unless reconnecting a revoked connection. | Existing `state` and `code`; no body, CSRF token, or `X-Requested-With`. | `302 /`; cookie contains only `db_browser_session_id`. | Sanitized `400/401/403`; pre-exchange validation failure leaves the current row intact, while a post-exchange failure may delete only the current row/cookie. | Two first-ever concurrent callbacks create one identity/workspace/connection and two browser rows; active-connection callback preserves other rows; revoked reconnect deletes old rows; invalid state leaves the current row intact; no failure deletes another browser's row. |
| `/api/auth/status` | GET | DB OAuth branch resolves workspace/site only from the browser row and connection; Basic/local branches remain unchanged. | Resolve current browser row without mutation after legacy upgrade. | No body, CSRF, or `X-Requested-With`. | Existing `200 authenticated=true`. | Existing `200 authenticated=false`, `loginRequired=true`, and sanitized login/recovery target. | Two clients remain authenticated after either token rotation; cross-workspace row mismatch fails closed; missing row reports login required. |
| `/api/auth/csrf` | GET | DB OAuth branch resolves current user/workspace/site from the browser row; non-DB modes remain unchanged. | Bind consume-on-validation token to browser-session id + connection + account; no new claim of atomic same-cookie concurrency. | No body, CSRF, or `X-Requested-With`. | Existing `200 {"csrfToken":"..."}`. | Existing structured `401`; global lock captures safe tab state. | Token survives another browser profile's refresh, fails in the other profile, and cannot cross workspace/account boundaries. |
| `/api/auth/refresh` | POST | DB OAuth branch refreshes only the connection referenced by the current browser row; other auth modes remain unchanged. | Resolve browser row, serialize shared connection refresh, never replace the browser id. | Empty body; require `X-Requested-With: jira-execution-planner`; auth-flow policy does not require token-bound CSRF. | Existing `200 authenticated=true`; no token material. | Structured `401` locks this tab. Connection-level revocation deletes all rows. | Refresh A increments token version while B stays authenticated; wrong-workspace/session rows fail closed; revocation fails both closed. |
| `/api/auth/logout` | POST | DB OAuth branch may delete only the row identified by the caller's signed cookie; other auth modes retain their existing clear behavior. | Delete only current browser row. | Empty body; retain `X-Requested-With: jira-execution-planner`; auth-flow policy does not require token-bound CSRF. | `200 {"ok":true}`. | Existing `403 csrf_required` when the required header is absent. | Logout B leaves A active; cookie/session row are removed only for B. |
| `/login?reason=session_expired|missing_scope` | GET | OAuth recovery page on the same origin; no workspace id or external return target is accepted. | Existing sanitized terminal entry contract. | Same-origin navigation only; no body, CSRF, or `X-Requested-With`. | Existing sign-in page and OAuth action. | Unsupported reasons keep existing behavior. | Recovery cannot bounce to the locked document or navigate cross-origin. |

No new public API endpoint, Home/Townsquare mutation, Jira mutation, service credential, or request body is introduced.

## State Machines

### Browser session

```text
missing/legacy cookie
  + valid exact legacy token version
  -> active browser-session row + opaque cookie

active browser session
  + shared OAuth token refresh
  -> active browser session (current token_version only affects cache keys)

active browser session
  + per-browser-profile logout
  -> current row deleted

active browser session(s)
  + connection revocation/reuse detection
  -> every linked row deleted
```

### Tab reauthentication

```text
ready
  + app API 401
  -> locked + tab-local capsule captured

locked
  + leader Sign in again
  -> atomically claim lease -> OAuth navigation -> new authenticated document
  -> validate principal -> announce success immediately -> restore capsule independently

locked follower tab
  + live lease observed + unconsumed success completed after its failing request began
  -> new / document -> restore its own capsule

locked tab with delayed pre-recovery request
  + delayed 401 arrives after causally matching success
  -> consume success once -> new / document -> restore its own capsule

locked tab with genuinely newer request
  + stale success completed before that request began
  -> remain locked; require a new recovery attempt

locked
  + failed/cancelled OAuth or expired lease
  -> locked; capsule retained until 30-minute expiry; a tab may retry
```

## Compatibility And Migration

- Alembic upgrade creates the table without rewriting existing auth/token rows.
- Downgrade drops only `browser_sessions` and returns DB cookies to the legacy connection/token-version contract on the next login.
- Existing local/dev OAuth token-store behavior remains unchanged.
- Existing DB cookies are lazily upgraded when still current; deployment does not intentionally sign out every user.
- `auth_connection_stale` remains only for legacy cookies and explicit compatibility callers.
- Cache keys continue to include current `token_version`.
- Existing global auth-lock behavior from `b38e8f7` remains terminal per document.
- Existing shared UI/Planning `localStorage` remains the ordinary preference mechanism; the one-shot `sessionStorage` capsule has precedence only for the recovering tab and exact recovered scope.

## Verification

Automated coverage must prove:

1. Migration upgrade/downgrade, foreign keys, indexes, and absence of token/UI-state columns.
2. Two Flask clients sign in as the same account, receive distinct browser-session ids, share one OAuth connection, and both remain authenticated.
3. First-ever OAuth callbacks serialize on stable PostgreSQL advisory locks and commit one user/workspace/connection plus two distinct browser rows; existing-connection callbacks and refreshes serialize on the shared connection row, and concurrent reconnect callbacks leave both newly created browser rows active.
4. A token refresh from browser profile A increments the shared token version while browser profile B remains authenticated.
5. A CSRF token issued in browser profile B before browser profile A refreshes remains valid in B and fails in A; tests do not claim atomic consumption across concurrent requests sharing one Flask cookie.
6. Logout B deletes only B; connection revocation deletes A and B; reconnect cannot revive deleted ids.
7. A current legacy cookie upgrades once; a stale legacy cookie retains `auth_connection_stale` recovery.
8. Scenario Planner reload propagates the real browser-session id.
9. A Planning tab captures its mode, exact scope, selected teams, and selected story keys, then restores valid keys after the mocked same-tab OAuth round trip.
10. Two Playwright pages in one browser context hold different Planning selections, lock independently, click recovery concurrently, produce exactly one `/login` navigation/OAuth initiation, share the resulting authenticated cookie, reload into new documents, and each restore its own selection.
11. Success is published immediately after authenticated principal bootstrap even when Planning hydration is delayed or fails; the follower reloads without waiting for the leader's task payload, while a non-auth failure abandons and clears only the failed tab's one-shot capsule so a later reload cannot resurrect stale selections.
12. A follower that mounts after success, a success written during listener setup, and a delayed pre-recovery `401` each consume the causally matching marker and reload exactly once without starting OAuth or looping; a newer request rejects the stale marker.
13. Identity mismatch, expiry, malformed/oversized capsules, missing groups/sprints/tasks, and revoked permissions fail closed to normal bootstrap with the capsule cleared.
14. Settings reopens on its prior safe tab, but connection email/token inputs and all unsaved form values are absent from storage and blank after recovery.
15. No request is replayed, no old document unlocks, no raw `401` renders, and an older concurrent `200` cannot commit state after lock.
16. Focused Node/Python/Playwright tests, startup preflight, structure budgets, frontend build, the explicit PostgreSQL no-skip race gate, and the full Python suite pass.
17. In the DB-backed Atlassian OAuth runner environment, Flask starts without dependency/runtime warnings before the banner; cookie-free `GET /health` returns HTTP `200` with exactly `{"message":"Jira proxy server is running","status":"OK"}`; and cookie-free `GET /api/test` returns HTTP `401` with exactly `{"error":"auth_required","loginUrl":"/login?reason=session_expired","message":"Your Jira sign-in expired. Sign in again to continue."}`. This anonymous OAuth boundary proof must not authenticate curl, forge or reuse a cookie, seed an OAuth token, or depend on live Jira. Basic-auth loopback behavior is outside these execution slices.

## Analytics Impact

No new event is needed. Continue using the existing one-time `app_error_shown` event from the global auth lock. Browser-session ids, recovery attempt ids, capsule contents, issue keys, connection ids, token versions, device/tab counts, and restore outcomes must never be sent to GA4. Recovery capture and restore must not initialize analytics when analytics was unavailable at lock time.

## Out Of Scope

- Skipping the first Atlassian sign-in on a new browser or device.
- Listing or naming devices/sessions, storing user agents/IPs, or sending device notifications.
- A "sign out all devices" UI or endpoint.
- Restoring arbitrary React state, loaded Jira/API payloads, Scenario undo stacks, or unsaved Settings form values.
- Persisting credential inputs or replaying failed reads/writes.
- Changes to local Basic auth, local OAuth token files, Home/Townsquare credentials, Jira permissions, or configuration ownership.

## Acceptance Criteria

- Browsers A and B remain authenticated when either browser rotates the shared OAuth token.
- Logging out B does not affect A; real connection revocation fails every linked browser closed.
- Every application API `401` shows the existing sanitized, terminal sign-in recovery screen instead of raw config/feature errors.
- After same-tab reauthentication, an ENG Planning tab returns to the same available group, sprint, Planning mode, selected teams, and valid selected story checkboxes.
- Two open tabs with different Planning selections recover their own state rather than whichever tab last wrote shared `localStorage`.
- In browsers with Web Locks/shared storage, only one same-profile OAuth flow starts at a time; successful recovery immediately navigates other locked tabs to new documents without unlocking them in place. Capability/storage failure retains existing uncoordinated same-tab recovery without claiming cross-tab coordination or conflict-free simultaneous OAuth.
- No failed request is replayed, no credential field is persisted, and no browser receives OAuth token material.
- In the DB-backed Atlassian OAuth runner, cookie-free `/health` returns only the existing safe HTTP `200` health shape and cookie-free `/api/test` returns the existing sanitized HTTP `401 auth_required` recovery shape without invoking Jira; authenticated curl, forged or reused cookies, seeded tokens, and Basic-auth loopback behavior are outside this acceptance gate.
