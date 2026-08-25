# Multi-Device Browser Sessions Design

**Status:** Approved for implementation.

## Goal

Allow one Jira Delivery Planner user to stay signed in from multiple browsers or devices at the same time. Each browser must complete its own initial Atlassian sign-in, but signing in or refreshing credentials from one browser must not force another active browser through Atlassian OAuth again.

## Current Failure

DB-backed OAuth stores one `auth_connections` row and one rotating Atlassian token pair per user, workspace, provider, and Jira site. The signed Flask cookie stores that connection's `token_version`. A second OAuth callback or a token refresh increments the shared connection version, so every other browser retains an older version and is rejected as `auth_connection_stale`.

The token version is correctly used to invalidate Jira/Home-derived caches when credentials rotate. It is the wrong browser-session validity boundary because credential rotation is shared account state, not proof that another browser session is invalid.

## Considered Approaches

### 1. Persistent opaque browser-session records — selected

Create one server-side browser-session record for every successful DB-backed OAuth login. The Flask cookie contains only the opaque browser-session id. The record references the shared OAuth connection, while Jira access and refresh tokens remain stored once under that connection.

This keeps Atlassian's single rotating refresh-token chain serialized, supports per-browser logout, and permits all browser sessions to be invalidated after a real connection revocation or reconnect.

### 2. Connection-wide session epoch

Store a second version on `auth_connections` that changes only on revocation/reconnect. This is smaller but all browsers still share one validity value, so JDP cannot revoke one server-side browser session without revoking every device.

### 3. Automatically accept newer token versions

Ignore the cookie's stale token version and resolve the latest active connection. This fixes the visible symptom but allows an old copied cookie to become valid again after the user reconnects a revoked credential. It is not an acceptable security boundary.

## Architecture

### Data model

Add `browser_sessions` in a new Alembic migration:

| Column | Contract |
| --- | --- |
| `id` | Random opaque UUID stored in the signed Flask session cookie. |
| `user_id` | Required owner; foreign key to `users` with cascade delete. |
| `workspace_id` | Required workspace boundary; foreign key to `workspaces` with cascade delete. |
| `auth_connection_id` | Required shared Atlassian OAuth connection; foreign key to `auth_connections` with cascade delete. |
| `created_at` | Creation timestamp. |

Index `auth_connection_id` and `user_id/workspace_id`. Do not store access tokens, refresh tokens, account emails, user-agent strings, IP addresses, or OAuth callback data in this table.

Create `backend/auth/db_browser_sessions.py` as the sole lifecycle boundary. It creates, resolves, deletes one browser session, and deletes every session for a revoked connection. Callers receive sanitized handles or `AuthError`; callers do not query session rows directly.

### Cookie contract

DB-backed cookies use:

```python
session['db_oauth_session'] = {
    'db_browser_session_id': '<opaque id>',
}
```

The browser-session id resolves the user, workspace, and OAuth connection from the database. Cookie-supplied connection ids and token versions are not authoritative once the new id exists.

Legacy signed DB cookies containing `db_auth_connection_id` and `db_token_version` remain accepted only when their token version still exactly matches the database. On their first successful request, JDP creates a browser-session record and replaces the legacy payload. A legacy stale cookie keeps the existing reconnect behavior.

### Login and reconnect flow

1. The callback exchanges the authorization code and upserts the existing shared OAuth connection/token pair.
2. If the connection was already active, existing browser-session records remain active.
3. If the connection was revoked, expired, or errored before this callback, revoke every old browser session before reactivating the connection. This prevents old cookies from reviving after reconnect.
4. Revoke the current browser's previous session id, if present, and create a fresh browser-session row.
5. Save only the new opaque id in the Flask cookie and redirect to the dashboard.

Atlassian token replacement and browser-session creation occur in the same database transaction. A failed callback clears only the current cookie and does not affect sessions on other devices.

### Request and refresh flow

`resolve_db_request_auth_context` resolves `db_browser_session_id`, rejects missing/revoked/expired rows with `auth_required`, then verifies that the referenced user and OAuth connection are active and have the required scopes. It returns the current connection `token_version` for cache partitioning plus the stable browser-session id for CSRF binding.

Token refresh stays serialized on the shared `auth_connection_id`. Rotating the access/refresh pair increments `auth_connections.token_version` but does not revoke browser sessions. A second browser therefore resolves the new token version on its next request without re-authentication.

Successful `/api/auth/status`, `/api/auth/refresh`, and normal data requests resolve the browser session without writing it. Token refresh remains the only write in the refresh path, so the performance-critical initial request fan-out does not add session-table writes.

### Logout and revocation

- `POST /api/auth/logout` deletes only the current browser-session row and clears only that browser's Flask cookie.
- A missing browser-session row returns the existing `auth_required` recovery contract.
- Refresh-token reuse or another connection-level revocation deletes all browser sessions for that connection in the same transaction.
- A later successful reconnect creates a new browser session; deleted sessions cannot revive.
- A dedicated "sign out all devices" endpoint or session-management UI is out of scope.

The feature intentionally does not introduce a new server-side inactivity timeout. DB-backed session lifetime continues to follow the existing signed Flask-cookie lifecycle. Retention and inactive-session expiry are separate future scope rather than an unrequested sign-out policy change.

### CSRF

DB-backed CSRF tokens bind to the stable browser-session id, connection id, and Atlassian account id. They do not bind to the mutable OAuth `token_version`; otherwise a credential refresh in one browser would break an already-issued CSRF token in another browser.

CSRF hashes remain stored only in each signed Flask cookie, remain one-use, and retain the existing maximum-token bound. A token issued in browser A must fail in browser B even when both sessions reference the same user and OAuth connection.

### Internal request contexts

Scenario Planner's in-process reload request must propagate the existing `browser_session_id` from `RequestAuthContext`; it must not synthesize a connection-only browser cookie. Worker-thread Jira calls continue to carry request auth context and do not create browser-session records.

## Endpoint Contract Matrix

| Endpoint | Method | Browser-session behavior | Success | Existing recovery preserved |
| --- | --- | --- | --- | --- |
| `/api/auth/atlassian/callback` | GET | Create a new browser-session row; preserve other active devices. | `302 /` | OAuth callback errors remain sanitized. |
| `/api/auth/status` | GET | Resolve the current session without mutating it. | `200 authenticated=true` | Missing session returns `200 authenticated=false`, `loginRequired=true`, and the existing login target. |
| `/api/auth/csrf` | GET | Issue a token bound to the current browser-session id. | `200 csrfToken` | Invalid session returns existing `401` auth recovery. |
| `/api/auth/refresh` | POST | Refresh shared OAuth tokens if needed; do not alter other browser sessions. | `200 authenticated=true`; no token material | Existing `X-Requested-With` and `401` recovery remain. |
| `/api/auth/logout` | POST | Delete only the caller's browser session, then clear its cookie. | `200 {"ok": true}` | Existing unsafe-method header requirement remains. |

No new public endpoint, request body, frontend control, Home/Townsquare mutation, Jira mutation, or service credential is introduced.

## Compatibility and Migration

- Alembic upgrade creates the new table without rewriting existing auth/token rows.
- Alembic downgrade drops only `browser_sessions`.
- Existing local/dev OAuth token-store behavior remains unchanged.
- Existing DB cookies are lazily upgraded when still current; the deployment does not intentionally sign out every user.
- Existing `auth_connection_stale` handling remains for legacy cookies and non-browser compatibility callers that explicitly submit a stale token version.
- Cache keys continue to include current `token_version`.

## Verification

Automated coverage must prove:

1. Migration upgrade/downgrade, foreign keys, indexes, and absence of token columns.
2. Two Flask clients sign in as the same account, receive distinct browser-session ids, share one OAuth connection, and both remain authenticated.
3. A token refresh from browser A increments the shared token version while browser B remains authenticated.
4. A CSRF token issued in browser B before browser A refreshes remains valid in browser B but fails in browser A.
5. Logout from browser B deletes only B; browser A remains active.
6. Refresh-token reuse or connection revocation rejects every linked browser session; reconnect does not revive the deleted rows.
7. A current legacy cookie upgrades once; a stale legacy cookie retains `auth_connection_stale` recovery.
8. The Scenario Planner reload path propagates the real browser-session id.
9. Focused auth/migration tests, startup preflight, structure budgets, and the full Python suite pass.
10. Launching the Flask server produces no dependency/runtime warnings before the startup banner, and `/api/test` succeeds.

## Analytics Impact

No new analytics event is needed. The feature adds no new user action or surface: existing `login` and `logout` events remain canonical, and background session resolution must not emit product events. Browser-session ids, connection ids, token versions, and device counts must never be sent to GA4.

## Out of Scope

- Skipping the first Atlassian sign-in on a new browser or device.
- Listing devices or sessions in Settings.
- Naming devices, storing user agents/IP addresses, or sending device notifications.
- A "sign out all devices" UI or endpoint.
- Changes to local Basic auth, local OAuth token files, Home/Townsquare credentials, Jira permissions, or dashboard UI.

## Acceptance Criteria

- After signing in once in browsers A and B, both remain authenticated when either browser loads or refreshes tokens.
- Logging out browser B does not affect browser A.
- Credential revocation still fails closed for every device and requires a fresh Atlassian sign-in.
- No browser receives OAuth token material, and no new sensitive values enter logs, analytics, audit metadata, or committed fixtures.
