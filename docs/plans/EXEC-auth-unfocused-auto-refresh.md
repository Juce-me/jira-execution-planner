# Auth Unfocused Auto-Refresh Implementation Plan

> **Status:** Revalidated 2026-07-10 against `origin/main` at `d37f911`. The auth shell and its route/test contracts are unchanged upstream. Implementation-ready after the execution branch contains the fetched `origin/main` and the baseline request-count check in Task 1 passes.

**Goal:** Reload Jira Delivery Planner exactly once when the user returns after the dashboard has been continuously unfocused or hidden for more than 12 minutes, while preserving the existing event-driven auth refresh and proving that focus events do not create unexplained static-asset request bursts.

**Architecture:** Keep the behavior in `frontend/src/api/authFocusRefresh.js`, outside `frontend/src/dashboard.jsx`. Record the first `blur` or hidden timestamp in memory, evaluate elapsed time when a focus event occurs while visible or when a hidden document becomes visible, and reload once when the elapsed time is strictly greater than 12 minutes. Do not add timers, polling, storage, backend routes, or cache-policy changes. Use an in-memory reload-started guard for duplicate focus/visibility events; a newly loaded document starts with no unfocused timestamp and therefore cannot reload recursively.

**Tech Stack:** esbuild IIFE auth-shell bundle, Flask-served dashboard, Python `unittest`, Node `node:test`, Playwright, and the existing GA4/GTM analytics contract.

---

## Execution Prerequisites

The plan branch is based on `1a633b4`, while the fetched `origin/main` is `d37f911`. Upstream added ENG priority editing and changed shared dashboard source/dist, analytics taxonomy, source guards, plan index, and gate notes. Before implementation, update the branch and verify it contains the freshly fetched mainline:

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
```

If the ancestry check exits nonzero, merge or rebase according to the repository's branch workflow before changing source or running `npm run build`. Preserve the upstream ENG priority source, generated assets, analytics rows, source-guard tests, plan-index entry, and gate note while resolving overlaps.

The revalidation checkout also did not have `.venv` or `node_modules`, and its shell resolved Node 26 rather than the repository's required Node 20.x. Before executing Task 1:

```bash
./scripts/install.sh
npm ci
node --version
.venv/bin/python -c "import ssl; print(ssl.OPENSSL_VERSION)"
```

Use the repository's Node 20.x runtime or configured runtime manager for all npm, Node, and Playwright commands. The Python command must report an OpenSSL-backed runtime supported by the root `AGENTS.md`. Dependency bootstrap is an environment step, not part of the feature diff.

## Revalidation Findings Incorporated

- `origin/main` at `d37f911` does not change `frontend/src/api/authFocusRefresh.js`, `jira-dashboard.html`, `tests/test_auth_entry_page.py`, `tests/ui/epm_home_token_fixture.js`, `package.json`, `/api/auth/refresh`, or the auth-flow request guard. The endpoint and state-machine assumptions below remain current.
- Upstream does change `tests/test_frontend_api_source_guards.js`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, dashboard source, and generated dashboard assets. Implementation must begin from updated mainline and add to those files without removing the ENG priority-edit coverage or analytics contract.
- The reported lines are `GET /frontend/dist/auth-focus-refresh.js`, not calls to `POST /api/auth/refresh`.
- The current HTML contains one auth script include, and the current frontend has no `location.reload()` call. Four script GETs therefore imply four document/script loads, such as repeated navigation or several tabs; they do not prove an auth listener loop.
- Changing the script URL from relative to absolute does not alter its resolved URL from `/` or `/jira-dashboard.html`.
- A short asset cache header would not identify or prevent repeated document reloads and would introduce unrelated unversioned-asset staleness. This plan does not change `jira-dashboard.html` paths or `jira_server.py` cache behavior.
- The previous `sessionStorage` reload guard was unnecessary. `reloadStarted` handles same-document event bursts, and a fresh document has no elapsed unfocused state.
- Verification must cover hidden-tab behavior, the exact 12-minute boundary, duplicate listener installation, and existing `401` recovery, not only `blur/focus` happy paths.

## Scope And Decisions

- "Unfocused" starts at the earliest of `window.blur` or `document.visibilityState !== 'visible'`.
- A focus event while the document is still hidden does not clear the timestamp or reload. The decision waits for a visible return.
- Returning before or exactly at 12 minutes clears the unfocused timestamp and runs the existing throttled auth refresh.
- Returning after more than 12 minutes reloads the document and skips the pre-reload auth refresh. The new document performs the normal initial auth refresh.
- Repeated `focus` and `visibilitychange` events after the reload decision may call `window.location.reload()` only once.
- No OAuth entry UI, dashboard auth UI, backend auth contract, Home/Townsquare route, Jira write path, or service credential changes are in scope.
- No separate analytics event is added. The automatic reliability behavior is added to the No-Event Allowlist; the reloaded dashboard retains its existing pageview.

## Endpoint Contract

No endpoint changes are planned. The existing browser call remains:

| Path | Method | Auth/policy | Required headers | Body | Success | Auth-expired | Other failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/refresh` | `POST` | Existing `auth_flow`; Basic or current OAuth browser session | `X-Requested-With: jira-execution-planner`; the existing auth-flow policy does not require token-bound CSRF for this refresh endpoint | None | `200` JSON in Basic/OAuth mode; no token material | `401` JSON with `loginUrl`, followed by browser redirect | Network/other response leaves recovery to the next eligible focus or API request |

The implementation must not change the request method, headers, response handling, endpoint policy, or backend route.

## State-Machine Checklist

| Start/event sequence | Expected result |
| --- | --- |
| Initial visible load | One auth refresh; no reload |
| Initial hidden load | Record hidden start; no auth refresh until visible |
| Blur, return before 12 minutes | No reload; one eligible auth refresh |
| Blur, return at exactly 12 minutes | No reload; one eligible auth refresh |
| Blur, return after 12 minutes | One reload; no pre-reload auth refresh |
| Hidden, visible after 12 minutes | One reload on the visible event; no pre-reload auth refresh |
| Focus fires while still hidden | Preserve unfocused start; wait for visible return |
| Focus and visible events burst after threshold | One reload total |
| Installer called twice | One listener registration per event; one initial refresh |
| Refresh returns `401` | Redirect to response `loginUrl` or existing expired-session fallback |
| Reloaded document initializes | Normal initial auth refresh; no recursive reload |

There is no dirty state, save, conflict, rollback, workspace switch, or remote-edit behavior in this auth-shell feature.

## File Map

- Modify: `frontend/src/api/authFocusRefresh.js`
- Modify: `tests/test_auth_entry_page.py`
- Modify: `tests/test_frontend_api_source_guards.js`
- Create: `tests/test_auth_focus_refresh.js`
- Create: `tests/ui/auth_focus_auto_reload.spec.js`
- Modify: `docs/README_ANALYTICS.md`
- Generated by build: `frontend/dist/auth-focus-refresh.js`
- Generated by build: `frontend/dist/auth-focus-refresh.js.map`

Explicitly unchanged: `jira-dashboard.html`, `jira_server.py`, `frontend/src/dashboard.jsx`, endpoint security policy, and backend auth routes.

## Task 1: Establish The Static-Request Baseline

**Files:**
- Modify: `tests/test_auth_entry_page.py`
- Create: `tests/ui/auth_focus_auto_reload.spec.js`

- [ ] Add a source assertion that `jira-dashboard.html` contains exactly one `auth-focus-refresh.js` script include. Do not require an absolute URL; the current relative URL resolves correctly from both dashboard routes.
- [ ] Add an initial Playwright baseline using `installDashboardShell(page)` and the existing API route-stub pattern. Count document requests and requests whose pathname is `/frontend/dist/auth-focus-refresh.js`.
- [ ] On one `page.goto()`, assert one document load and one auth-script request. Dispatch under-threshold focus/visibility event bursts and assert both counts remain unchanged.
- [ ] Run the baseline against the current build before adding reload behavior:

```bash
.venv/bin/python jira_server.py
npx playwright test tests/ui/auth_focus_auto_reload.spec.js
```

Expected current result: one script GET per document load and no extra script GET from focus/visibility events.

If one document load produces multiple auth-script GETs, or focus events produce new document/script requests before this feature exists, stop execution and identify the navigation or request owner. Do not mask that separate defect with cache headers. If the baseline passes, record in the PR notes that the original four-line log burst was not reproducible from a single loaded page and remains consistent with multiple document loads or tabs.

## Task 2: Add Focus State Unit Tests

**Files:**
- Create: `tests/test_auth_focus_refresh.js`
- Modify: `tests/test_frontend_api_source_guards.js`

- [ ] Bundle `frontend/src/api/authFocusRefresh.js` to CommonJS in memory with esbuild and evaluate it in a fake browser environment with controllable `Date.now`, visibility state, listeners, `fetch`, and `window.location`.
- [ ] Return the module exports and listener registration counts from the harness so behavior, not source text alone, proves idempotent installation.
- [ ] Add tests for every row in the state-machine checklist, including:
  - initial visible and initial hidden load;
  - 11 minutes, exactly 12 minutes, and 12 minutes plus 1 ms;
  - blur/focus and hidden/visible paths;
  - focus while still hidden;
  - focus/visibility event bursts after the reload decision;
  - calling `installAuthFocusRefresh()` twice;
  - `401` with supplied `loginUrl` and fallback login URL.
- [ ] Assert the long-absence path has one pre-reload auth call total, then rely on Playwright to prove the new document performs its normal second initial call.
- [ ] Add focused source guards for the 12-minute constant, `POST`, `X-Requested-With`, one reload call site, and absence of `setInterval`/`setTimeout`. Place them near the auth API guards and preserve the upstream ENG priority/status-catalog tests added after `d37f911`.

Run before implementation:

```bash
node --test tests/test_auth_focus_refresh.js tests/test_frontend_api_source_guards.js
```

Expected: the new behavior tests fail for missing blur tracking and reload behavior.

## Task 3: Implement The Event-Driven Reload

**Files:**
- Modify: `frontend/src/api/authFocusRefresh.js`

- [ ] Introduce named constants:

```javascript
export const AUTH_REFRESH_THROTTLE_MS = 60 * 1000;
export const AUTO_RELOAD_AFTER_UNFOCUSED_MS = 12 * 60 * 1000;
```

- [ ] Keep minimal module state: `lastAuthRefreshAt`, `unfocusedSince` using `null` for "not unfocused", `reloadStarted`, and `listenersInstalled`.
- [ ] Preserve the current `refreshAuthOnFocus` request and `401` redirect behavior. Accept an optional timestamp argument for deterministic tests, and ensure initial visible load is never suppressed by a zero/sentinel collision.
- [ ] Add `noteDashboardUnfocused(now)` that preserves the earliest continuous blur/hidden timestamp.
- [ ] Add a focus-return handler that:
  1. records unfocused state and exits if the document is still hidden;
  2. reloads once when elapsed time is strictly greater than `AUTO_RELOAD_AFTER_UNFOCUSED_MS`;
  3. otherwise clears the timestamp and invokes the throttled auth refresh.
- [ ] Register `blur`, `focus`, and `visibilitychange` once. Hidden transitions record state; visible/focus returns evaluate it. Invoke the return handler once at module installation for the existing initial refresh behavior.
- [ ] Do not add `sessionStorage`, `localStorage`, timers, polling, backend state, or production test hooks.

Run:

```bash
node --test tests/test_auth_focus_refresh.js tests/test_frontend_api_source_guards.js
```

Expected: pass.

## Task 4: Prove Navigation And Request Counts In A Browser

**Files:**
- Modify: `tests/ui/auth_focus_auto_reload.spec.js`

- [ ] Keep the Task 1 baseline assertion.
- [ ] Under threshold, assert exactly one document request, one auth-script GET, two auth-refresh POSTs (initial plus focus return), and zero reloads.
- [ ] At exactly 12 minutes, assert the same no-reload behavior.
- [ ] Over threshold, assert exactly two document requests, two auth-script GETs, and two auth-refresh POSTs: one from the original load and one from the reloaded document, with no extra pre-reload POST.
- [ ] After the over-threshold counts reach two, wait through a short stability window and assert they remain two so an event burst or reload loop cannot pass transiently.
- [ ] Assert no uncaught page errors. The test should use the real built `auth-focus-refresh.js`; do not stub that asset with alternate logic.
- [ ] Override `Date.now` only inside the loaded page to trigger elapsed-time transitions. If browser behavior makes that unreliable, use `page.addInitScript` before script execution; do not add production hooks.

Run with the local server:

```bash
npx playwright test tests/ui/auth_focus_auto_reload.spec.js
```

Expected: pass with one intentional extra document/script load only on the over-12-minute path.

## Task 5: Record Analytics Impact

**Files:**
- Modify: `docs/README_ANALYTICS.md`

- [ ] Add a row under `### No-Event Allowlist`:

```md
| Auth focus auto-reload after long absence | `frontend/src/api/authFocusRefresh.js` | No separate `userevent`; this is automatic reliability recovery after the page was continuously unfocused or hidden for more than 12 minutes. The reloaded dashboard retains the existing pageview, while browser tests guard against duplicate reloads and request bursts. | 2026-07-10 |
```

- [ ] Do not add a new event name, parameter, GTM trigger, or GA4 runbook step.
- [ ] Preserve the upstream `issue_priority_action` taxonomy and `jira_issue_priorities` addition to the `api_result` contract; this task only appends the auth no-event row.

## Task 6: Build And Verify

- [ ] Rebuild generated frontend output; never hand-edit `frontend/dist`:

```bash
npm run build
```

- [ ] Run focused verification:

```bash
.venv/bin/python -m unittest tests.test_auth_entry_page
node --test tests/test_auth_focus_refresh.js tests/test_frontend_api_source_guards.js
npx playwright test tests/ui/auth_focus_auto_reload.spec.js
```

- [ ] Run the required pre-push verification:

```bash
npm run build
.venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
```

- [ ] Review `git diff --check`, confirm the build leaves no unexplained generated diff, review `git log --oneline -5`, and wait for explicit user confirmation before push.
- [ ] Confirm the final diff retains the upstream ENG priority source/tests and does not regenerate `dashboard.js`, `dashboard.js.map`, or `dashboard.css` back to the pre-`d37f911` state.

## Completion Criteria

- [ ] No timer or two-minute heartbeat exists.
- [ ] `POST /api/auth/refresh` remains event-driven, throttled, and unchanged at the backend boundary.
- [ ] Before or exactly at 12 minutes: no reload.
- [ ] More than 12 minutes: exactly one reload on a visible focus return or hidden-to-visible return.
- [ ] Hidden-tab, focus-while-hidden, duplicate-install, event-burst, and `401` recovery paths pass.
- [ ] One document load produces one auth-script GET; under-threshold focus events produce none.
- [ ] The intentional long-absence reload produces one additional document load and one additional auth-script GET, with stable counts afterward.
- [ ] No static cache/path change is presented as a fix for an unproven navigation burst.
- [ ] Analytics no-event rationale is documented.
- [ ] `GATE-05` remains blocked; no Home/Townsquare mutation behavior is introduced.
