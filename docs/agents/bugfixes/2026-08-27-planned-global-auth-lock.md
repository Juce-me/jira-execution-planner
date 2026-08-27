# Global Authentication Lock Design

Status: planned
Type: bugfix

## Problem

Authenticated API failures are handled by unrelated frontend paths. Some redirect immediately, some
show a local **Sign in again** link, and some discard the structured response and render text such as
`Groups config error 401`. A lost or invalid application session is document-wide state. A feature
panel must not keep running as if only one request failed.

## Decision

Any HTTP `401` returned by an app-owned `/api/` request locks the current dashboard document. An exact
structured `auth_required` error on another non-success response also locks defensively. The mounted app
becomes inert behind one accessible recovery screen. Feature and Settings surfaces never render raw
status numbers or backend authentication text.

The recovery screen navigates the current tab to the sanitized, same-origin login page. The original app
remains mounted, inert, and unchanged until the user starts that navigation, so a failed request cannot
silently clear or overwrite a draft. The lock is terminal for the current document: successful login
creates a new document that bootstraps identity, workspace, permissions, configuration, and caches again.
No failed write is replayed.

This is preferred over immediate navigation, which destroys in-memory drafts, and per-feature banners,
which leave the rest of an invalid application session interactive.

## Status Semantics

The global lock applies to:

- every app API HTTP `401`, including revoked, stale, disabled-account, missing-scope, and auth-refresh
  responses already classified as `401` by the backend;
- an exact non-success `{ "error": "auth_required" }` response, even if a backend regression assigns
  the wrong status.

It does not apply to:

- `403 admin_required`, `403 csrf_required`, missing Jira write permission, or an explicit
  `403 project_access_denied`; the backend's existing `401 missing_project_access` still locks because
  every `401` is authoritative;
- `409 home_user_token_required` or other connection/setup prerequisites;
- validation errors, revision conflicts, rate limits, server failures, or network failures;
- non-API assets, dashboard-entry redirects before React starts, or EventSource errors without a known
  HTTP status.

Those states retain targeted recovery. A backend route must never return `401` to mean “not an admin.”

## Shared Auth-Required Contract

Create `frontend/src/api/authRequired.js` as the sole owner of:

- `AuthenticationRequiredError` and `isAuthenticationRequiredError(error)`;
- `AUTH_REQUIRED_EVENT` and a latched auth-required state shared through one nonsecret `window` slot;
- `publishAuthenticationRequired(payload)` and `readPendingAuthenticationRequired()`;
- `sanitizeLoginUrl(value)`.

The sanitizer parses against `window.location.origin`, requires the same origin, rejects credentials and
protocol-relative or malformed values, requires the exact pathname `/login`, and accepts only no query
or `reason=session_expired|missing_scope`. It normalizes a same-origin absolute URL to a relative path.
Every invalid or missing value becomes `/login?reason=session_expired`. `recoveryUrl` is not a login URL.

The shared window slot is required because `auth-focus-refresh.js` and `dashboard.js` are separate
esbuild bundles. A refresh `401` may happen before React mounts; the later gate must read the same pending
latch. The slot contains only `locked`, sanitized `loginUrl`, and normalized `reason`, never identity,
tokens, response bodies, or configuration.

Publishing is idempotent. Parallel failures produce one locked-state transition and keep the first safe
recovery target. No response clears the latch in the current document.

## HTTP Boundary

Add `apiFetch()` to `frontend/src/api/http.js` and route every native application API request through
`apiFetch()` or `trackedFetch()`:

1. Before sending, a locked document rejects every request with a typed
   `AuthenticationRequiredError`. This suspends polling, mutations, refreshes, and new reads while locked.
2. For a non-success response, the wrapper reads a cloned body when possible. Any `401` or exact
   `auth_required` response publishes the latch and throws a typed error with a fixed, user-safe message.
3. After every response, the wrapper rechecks the shared latch. If another concurrent request locked the
   document, the older response is rejected with the typed error even when it returned `200`, so stale
   consumers cannot commit state behind the gate. Otherwise the original response remains readable for
   non-auth feature handling. Tracked calls still record the real status and duration.
4. `json`, `jsonOrStructuredError`, `getJson`, and `postJson` use the same contract and never construct
   messages such as `Config error 401`.
5. Empty, malformed, and non-JSON `401` bodies still lock with the fallback login target.

Migrate native API fetches in `analyticsApi.js`, `authApi.js`, `authFocusRefresh.js`, `configApi.js`,
`engApi.js`, `epmApi.js`, `issuesApi.js`, `jiraCatalogApi.js`, and `scenarioApi.js`. A source guard permits
native `fetch(` only in the shared HTTP implementation and test harnesses.

`authFocusRefresh` no longer redirects. It clears the shared throttle timestamp on `401` and publishes the
same window-backed latch through `apiFetch`. A refresh `401` before dashboard mount must still appear in
the gate once React loads.

## Recovery Entry Contract

The sanitized `/login?reason=...` target must start a real authentication recovery path even when the
browser still has a locally valid cookie or cached OAuth session. Update `auth_entry_page()` so the
recognized terminal reasons bypass its normal "already authenticated" redirect to `/`:

- `reason=session_expired` renders the recovery entry and its action starts the standard Atlassian OAuth
  flow;
- `reason=missing_scope` renders the recovery entry and its action starts Atlassian OAuth with
  `prompt=consent` so the user can grant the required scopes;
- an absent or unsupported reason keeps the existing authenticated-user redirect behavior.

This prevents **Sign in again** from bouncing directly back to the still-locked dashboard. The login
page remains the only backend route entered by the frontend gate; it owns the choice of OAuth parameters.

## Root Gate And Recovery

Create `frontend/src/components/AuthRequiredGate.jsx` and wrap the mounted `App` at the React root. The
gate listens for the auth-required event and stores only:

```text
locked: true
loginUrl: sanitized relative /login target
reason: session_expired | missing_scope
```

While locked:

- the existing application tree stays mounted inside an `inert` and `aria-hidden` wrapper;
- a top-level `role="alertdialog"` with `aria-modal="true"` owns focus;
- the only primary action is **Sign in again**, using a same-tab link to the sanitized target;
- the gate cannot be dismissed;
- global keyboard shortcuts are disabled and the Scenario EventSource is closed;
- the companion Scenario poll may detect a stream-side session loss before the lock, but is suppressed
  with every other request after the lock;
- repeated failures do not stack dialogs or change the selected recovery target.

Starting sign-in unloads this document. The next authenticated document performs the normal full
bootstrap. The old document never tries to reconcile a possibly different principal, workspace, or
permission set, and no failed mutation is replayed automatically.

## Feature Failure Handling

Every feature catch that currently redirects, clears state, or renders an error must first recognize
`AuthenticationRequiredError` and return without applying fallback state. This includes:

- dashboard config and EPM Settings loads and saves;
- Home-token connection status;
- EPM projects, issues, and rollups;
- ENG tasks, transitions, and story subtasks;
- group preferences and first-run selection;
- Scenario polls and analytics transport.

A `401` must not replace valid groups, EPM settings, projects, rollups, or connection status with an empty
baseline. A failed save remains dirty behind the lock.

## State Machine

```text
ready
  + app API 401 or exact auth_required
  -> locked (app mounted and inert; one analytics event only when analytics was already enabled)

locked
  + additional API completion/error or user interaction
  -> locked

locked
  + Sign in again
  -> same-origin login navigation
  -> new authenticated document and full bootstrap
```

## Configuration Ownership Interaction

The gate changes presentation, not authorization or storage ownership:

- administrator settings remain workspace-shared and `shared_admin_write`;
- department groups remain workspace-shared and `user_write`;
- group stars, visibility, and active group remain private preferences;
- EPM settings remain private to the owning user's default saved view and `user_write`;
- `403 admin_required` remains distinct from authentication loss.

No failed request may update a baseline, advance a revision, clear a draft, or write a different ownership
scope.

## Analytics

When analytics is already initialized and enabled before the failure, reuse `app_error_shown` once per
`ready -> locked` transition with fixed values:

```text
error_area=auth
error_code=auth_required
recoverable_state=reauth
source_surface=app
```

Do not send endpoint URLs, login URLs, response bodies, user/workspace identifiers, configuration values,
or draft contents. The event uses the existing browser analytics path and must not recursively call the
API request that caused the lock. A bootstrap `401` may occur before analytics context is available; in
that case the lock must not initialize analytics, fetch context, queue the event, or claim delivery. Tests
expect zero events when analytics is disabled or uninitialized and exactly one when it was already
enabled.

## Verification

Unit and source tests must prove:

- valid same-origin login URLs normalize correctly and unsafe/unsupported URLs fall back;
- empty, malformed, and structured `401` responses publish one latch;
- exact non-success `auth_required` publishes, while `403 admin_required`, `403 csrf_required`,
  `409 home_user_token_required`, validation, network, and server errors do not;
- every new request is suppressed after lock, including auth refresh;
- separate bundles read the same pending latch, including a refresh `401` before dashboard mount;
- no successful response unlocks the current document;
- an older concurrent `200` is rejected after another request locks;
- focus refresh publishes instead of redirecting;
- feature catches preserve existing state for the typed auth error;
- an enabled, initialized analytics session emits one fixed auth event, while disabled or uninitialized
  analytics emits none and starts no context request;
- native app API fetches cannot bypass the shared boundary.

Playwright must prove:

- a bootstrap, ENG, group-load, or EPM request `401` locks the whole app without rendering raw `401`;
- a `401` during a dirty group/EPM save keeps the draft mounted, sends the write only once, and never
  advances a baseline or revision;
- dashboard/Settings controls, keyboard shortcuts, polling, and Scenario SSE are inactive while locked;
- the recovery screen owns focus and exposes only a sanitized **Sign in again** action;
- **Sign in again** navigates the current tab to the sanitized login target and the old document never
  replays the failed write;
- a recognized terminal login reason bypasses an otherwise valid local session, while missing-scope
  recovery starts OAuth with `prompt=consent`;
- `403 admin_required` and `409 home_user_token_required` retain targeted UI without locking;
- exactly one privacy-safe `app_error_shown` event is emitted when analytics was already enabled, and no
  event or late analytics initialization occurs otherwise.

## Files In Scope

- Create: `frontend/src/api/authRequired.js`
- Create: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `backend/routes/auth_routes.py`
- Modify: `frontend/src/api/http.js` and all application API modules containing native fetches
- Modify: `frontend/src/api/authFocusRefresh.js`
- Modify: feature hooks and Settings utilities that own redirects, local sign-in links, or destructive
  auth-error fallbacks
- Modify: `frontend/src/settings/UserConnectionsSettings.jsx`
- Modify: `frontend/src/eng/EngBoardView.jsx`
- Modify: `frontend/src/eng/EngBoardEpicPanel.jsx`
- Modify: `frontend/src/settings/AdminAccessSettings.jsx`
- Modify: `frontend/src/settings/GroupBoardSettings.jsx`
- Modify: `frontend/src/settings/sharedExcludedCapacityToggle.js`
- Modify: `frontend/src/dashboard.jsx` and `frontend/src/styles/shared/shell.css`
- Modify: `tests/test_auth_entry_page.py` and `tests/test_auth_routes.py`
- Modify focused Node and Playwright auth/settings/ENG/Scenario tests
- Rebuild all generated frontend assets from source
- Update `docs/README_ANALYTICS.md` for the reused fixed-value auth event

No backend schema, authorization policy, credential storage, or normal API response shape changes are
part of the global lock slice. The only backend behavior change is that recognized terminal reasons on
the login entry bypass the authenticated-session redirect and select the correct OAuth flow. Backend
tests continue proving stable `401 auth_required`, `403 admin_required`, `403 csrf_required`, and
`409 home_user_token_required` meanings.

## Acceptance Criteria

- No application feature or Settings panel displays raw `401` text.
- Every app API `401` produces one blocking, accessible authentication recovery screen.
- The app cannot be used, polled, or dismissed while the current session is invalid.
- Only a sanitized same-origin login target is actionable.
- The recovery target cannot bounce an authenticated-but-invalid session back to the locked dashboard.
- Existing drafts remain mounted until same-tab sign-in navigation; failed writes are never replayed.
- Reauthentication creates a new fully bootstrapped document; the locked document never unlocks in place.
- Authorization, connection setup, validation, conflict handling, and configuration ownership keep their
  distinct status semantics.
