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

Use one short-lived, nonsecret `localStorage` lease to serialize OAuth initiation inside a browser profile. The recovering leader tab announces successful authenticated bootstrap; other locked tabs then navigate to a new `/` document and restore their own `sessionStorage` capsules. Different devices have independent storage and authenticate independently.

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

Atlassian token replacement and browser-session creation occur in the same database transaction. Callback upserts lock an existing shared `auth_connections` row with `SELECT FOR UPDATE`, matching refresh serialization so concurrent reconnects cannot delete the browser row created by the callback that committed first. Preserve the existing callback failure split: validation failures before token exchange (`invalid_oauth_state`, authorization denial, missing code, or missing PKCE verifier) do not mutate an existing browser session; failures after token exchange begins may clear and delete only the current browser session. No callback failure may affect another browser's row.

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

DB-backed CSRF tokens bind to the stable browser-session id, connection id, and Atlassian account id. They do not bind to mutable OAuth `token_version`; otherwise refresh in browser A would invalidate a CSRF token already issued to browser B.

CSRF hashes remain stored only in each signed Flask cookie, remain one-use, and retain the existing maximum-token bound. A token issued in browser A must fail in browser B even when both sessions reference the same user and connection. Legacy cookies retain the old binding until their one-time upgrade.

### Internal request contexts

Scenario Planner's in-process reload request propagates `browser_session_id` from `RequestAuthContext`; it must not synthesize a connection-only browser cookie. Worker-thread Jira calls continue to carry captured request auth context and do not create browser-session rows.

### Global auth-lock integration

The shared HTTP boundary and `AuthRequiredGate` from `b38e8f7` remain authoritative:

- any app API `401` locks only that document's window-backed latch;
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
8. Clear the capsule only after successful application or a terminal validation rejection. A failed/cancelled OAuth attempt leaves it available until expiry.

The Planning undo baseline is rebuilt from the post-login loaded selection. The old document's undo stack and in-flight requests are never restored.

### Same-profile multi-tab recovery coordination

Create `frontend/src/api/authRecoveryCoordinator.js` with a five-minute `localStorage` lease containing only a random attempt id and timestamps. The first locked tab whose user chooses **Sign in again** becomes the leader and navigates to its sanitized login URL. Every other locked tab adopts that live attempt from the lease storage event (or from an initial lease read when its gate mounts) without requiring another click. If a user does click while the lease is live, that tab remains a follower instead of starting a competing OAuth state/PKCE flow in the shared cookie.

When the leader's new document completes authenticated bootstrap, it writes a matching success marker and clears the lease. Other locked tabs receive the storage event and perform `window.location.assign('/')`; this creates a new document without unlocking or replaying work in place. Each tab then consumes its own isolated `sessionStorage` capsule. If the lease expires without success, any locked tab may claim a new attempt. Different browser profiles and devices do not share the lease.

No identity, login URL, OAuth state, PKCE verifier, issue key, or configuration value enters the shared lease/success records.

## Endpoint Contract Matrix

| Endpoint | Method | Mode and workspace/site boundary | Auth/session boundary | Request contract | Success | Failure/recovery contract | Required tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/atlassian/callback` | GET | Atlassian OAuth only; accessible resource must match the configured Jira site, and the connection remains keyed by resolved user + workspace + cloud/site. | OAuth state + PKCE; DB callback creates the current browser row and preserves other active devices unless reconnecting a revoked connection. | Existing `state` and `code`; no body, CSRF token, or `X-Requested-With`. | `302 /`; cookie contains only `db_browser_session_id`. | Sanitized `400/401/403`; pre-exchange validation failure leaves the current row intact, while a post-exchange failure may delete only the current row/cookie. | Active-connection callback preserves other rows; revoked reconnect deletes them; invalid state leaves the current row intact; no failure deletes another browser's row. |
| `/api/auth/status` | GET | DB OAuth branch resolves workspace/site only from the browser row and connection; Basic/local branches remain unchanged. | Resolve current browser row without mutation after legacy upgrade. | No body, CSRF, or `X-Requested-With`. | Existing `200 authenticated=true`. | Existing `200 authenticated=false`, `loginRequired=true`, and sanitized login/recovery target. | Two clients remain authenticated after either token rotation; cross-workspace row mismatch fails closed; missing row reports login required. |
| `/api/auth/csrf` | GET | DB OAuth branch resolves current user/workspace/site from the browser row; non-DB modes remain unchanged. | Bind one-use token to browser-session id + connection + account. | No body, CSRF, or `X-Requested-With`. | Existing `200 {"csrfToken":"..."}`. | Existing structured `401`; global lock captures safe tab state. | Token survives another browser's refresh, fails in the other browser, and cannot cross workspace/account boundaries. |
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
  + per-browser logout
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
  -> OAuth navigation -> new authenticated document -> restore capsule -> announce success

locked follower tab
  + live lease observed + matching leader success
  -> new / document -> restore its own capsule

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
3. Existing-connection OAuth callbacks and refreshes serialize on the shared PostgreSQL connection row; concurrent reconnect callbacks leave both newly created browser rows active.
4. A token refresh from browser A increments the shared token version while browser B remains authenticated.
5. A CSRF token issued in browser B before browser A refreshes remains valid in B and fails in A.
6. Logout B deletes only B; connection revocation deletes A and B; reconnect cannot revive deleted ids.
7. A current legacy cookie upgrades once; a stale legacy cookie retains `auth_connection_stale` recovery.
8. Scenario Planner reload propagates the real browser-session id.
9. A Planning tab captures its mode, exact scope, selected teams, and selected story keys, then restores valid keys after the mocked same-tab OAuth round trip.
10. Two Playwright pages in one browser context hold different Planning selections, lock independently, use one OAuth leader, reload into new documents, and each restore its own selection.
11. Identity mismatch, expiry, malformed/oversized capsules, missing groups/sprints/tasks, and revoked permissions fail closed to normal bootstrap with the capsule cleared.
12. Settings reopens on its prior safe tab, but connection email/token inputs and all unsaved form values are absent from storage and blank after recovery.
13. No request is replayed, no old document unlocks, no raw `401` renders, and an older concurrent `200` cannot commit state after lock.
14. Focused Node/Python/Playwright tests, startup preflight, structure budgets, frontend build, and the full Python suite pass.
15. Flask starts without dependency/runtime warnings before the banner and `/api/test` succeeds.

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
- Only one same-profile OAuth flow starts at a time; successful recovery navigates other locked tabs to new documents without unlocking them in place.
- No failed request is replayed, no credential field is persisted, and no browser receives OAuth token material.
