# Auth Unfocused Auto-Refresh Implementation Plan

> **Status:** Amended 2026-07-16 and re-approved for execution. The previously planned full-page `location.reload()` after a long absence is **rejected**: repeated document loads were the observed problem, and a reload path multiplies them (each reload re-downloads the ~818 KB dashboard bundle and restarts API initialization). The prior unmerged implementation of the reload approach lives on branch `feature/auth-unfocused-auto-refresh` and is superseded by this amendment; do not merge it. This amendment replaces the reload with a single throttled `POST /api/auth/refresh` plus an in-page stale-data refresh of the active view, adds cross-tab deduplication, request-count regression coverage, and temporary server-side diagnostics to identify the real navigation owner.

**Goal:** When the user returns to Jira Delivery Planner after the dashboard has been continuously unfocused or hidden for more than 12 minutes, issue exactly one throttled `POST /api/auth/refresh` (deduplicated across tabs) and, on success, refresh only the active view's stale data in place. Never reload the document. Preserve the existing throttled event-driven auth refresh and the existing `401` login recovery, and prove with request-count regression tests that focus events cannot create document or static-asset request bursts.

**Architecture:** Keep the absence state machine in `frontend/src/api/authFocusRefresh.js` (the separate auth-shell IIFE bundle). Record the earliest of `window.blur` / document-hidden in memory; when a visible return happens, compute the continuous unfocused time and pass a long-absence flag into the existing refresh function. Cross-tab deduplication uses one short-lived shared timestamp in `localStorage` (no `BroadcastChannel`, no timers, no polling, no backend session state). Timing/name constants shared with the dashboard live in a new side-effect-free module `frontend/src/api/authRefreshContract.js`; `frontend/src/dashboard.jsx` imports only the event name from it and re-runs its existing manual-refresh path when the event arrives. `jira_server.py` gains one temporary after-request diagnostics log line for document and `frontend/dist` requests.

**Tech Stack:** esbuild IIFE auth-shell bundle, Flask-served dashboard, Python `unittest`, Node `node:test`, Playwright, and the existing GA4/GTM analytics contract.

---

## Execution Prerequisites

- Branch `improvement/auth-unfocused-refresh`, created from current `origin/main`; verify `git merge-base --is-ancestor origin/main HEAD` passes.
- Shell Node resolves v26; the repo pins Node 20.x. Run every node/npm/npx/playwright command through `fnm exec --using 20 <cmd>`. Python commands use `.venv/bin/python`.
- The user's own server occupies port 5050 (`http://127.0.0.1:5050`); never kill or restart it. Playwright specs use it only as the request origin — all document/asset/API responses in specs are `page.route`-fulfilled.
- The superseded branch `feature/auth-unfocused-auto-refresh` may be consulted read-only (via `git show`) for reviewed harness patterns (esbuild+vm unit harness, Playwright clock shim, request counting). Do not cherry-pick its reload behavior, its reload tests, or its analytics row.

## Amendment Rationale (2026-07-16)

- The reported burst lines were `GET /frontend/dist/auth-focus-refresh.js`, i.e. repeated document/script loads — not auth-refresh POSTs. The current shell cannot produce that burst: one HTML include, throttled POST, no `location.reload()`, ETag-validated asset (a normal conditional request returns `304`).
- A full-page auto-reload would convert every long absence into a document navigation: at the observed scale (~40 users) that risks repeated ~818 KB bundle downloads and full API re-initialization. The steady-state auth-check rate of the refresh-only design is ~0.056 req/s before cross-tab dedup.
- Therefore: no reload path anywhere; refresh auth once, then refresh stale data in place.
- Temporary server diagnostics (Referer, `Sec-Fetch-Dest`, validator presence, anonymized client correlation, request id) are added to identify the actual owner of repeated document navigations.

## Scope And Decisions

- "Unfocused" starts at the earliest of `window.blur` or `document.visibilityState !== 'visible'`; the timestamp is kept until a visible return.
- A focus event while the document is still hidden preserves the timestamp and does not refresh; the decision waits for a visible return.
- Returning before or exactly at 12 minutes: existing behavior — throttled auth refresh, no long-absence event.
- Returning after strictly more than 12 minutes: one `POST /api/auth/refresh` (subject to the shared throttle), and on confirmation of fresh auth dispatch one `CustomEvent` on `window` so the dashboard refreshes the active view's data. Never `location.reload()`.
- Cross-tab deduplication: the refresh timestamp is shared via one `localStorage` key. A tab that returns from long absence while the shared timestamp is fresh (another tab refreshed within the throttle window) skips its POST but still dispatches its own long-absence event, because its own view data is stale. `localStorage` failures degrade gracefully to per-tab in-memory throttling.
- A new tab load within the throttle window of another tab's refresh also skips the initial POST (auth session is cookie-shared). This is the "one auth POST per cooldown window" behavior.
- On `401`: unchanged visible recovery — `location.assign(loginUrl || '/login?reason=session_expired')`. On `401` the shared timestamp is cleared first so other tabs are not suppressed from discovering the expiry.
- Staleness definition for the dashboard: the event fires only after >12 continuous unfocused minutes and the dashboard never auto-refreshes in the background, so event receipt means the active view's data is stale by construction. The dashboard handler re-runs exactly the same scoped fetches as the existing manual refresh control and must be a no-op whenever that control would be unavailable or disabled (e.g. groups still loading, onboarding).
- `frontend/src/dashboard.jsx` must not import `authFocusRefresh.js` (it self-installs); it imports only the event name from the side-effect-free contract module.
- Temporary diagnostics: one INFO log line per document/`frontend/dist` request on logger `jep.static_diagnostics`. Remove after the navigation owner is identified (removal criterion recorded here).
- No OAuth entry UI, backend auth contract change, Home/Townsquare route, Jira write path, or service credential changes. `GATE-05` stays blocked.
- No separate analytics event; the behavior is added to the No-Event Allowlist.

## Deferred Scope (recorded, intentionally not executed here)

Content-hashed production assets with `Cache-Control: public, max-age=31536000, immutable` served via a hosting proxy/CDN remain defense-in-depth for reload cost, not a fix for the unidentified navigation owner. Serving through a proxy/CDN is deployment infrastructure outside this repo, and content-hashing is a build-pipeline change touching HTML, build scripts, and Flask routes. Do not present any cache/path change as the fix; revisit after the diagnostics from this plan identify the reload owner.

## Endpoint Contract

No backend auth route changes. The existing browser call remains:

| Path | Method | Auth/policy | Required headers | Body | Success | Auth-expired | Other failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/refresh` | `POST` | Existing `auth_flow`; Basic or current OAuth browser session | `X-Requested-With: jira-execution-planner` | None | `200` JSON; no token material | `401` JSON with `loginUrl`, then `location.assign` | Network/other response leaves recovery to the next eligible attempt |

The implementation must not change the request method, headers, response handling, endpoint policy, or backend route.

## Frontend Contract Constants (`frontend/src/api/authRefreshContract.js`)

```javascript
export const AUTH_REFRESH_THROTTLE_MS = 60 * 1000;
export const LONG_ABSENCE_MS = 12 * 60 * 1000;
export const AUTH_REFRESH_SHARED_STORAGE_KEY = 'jep.auth.lastRefreshAt';
export const AUTH_LONG_ABSENCE_EVENT = 'jep:auth-long-absence-return';
```

The module must stay side-effect-free: constants only — no listeners, no fetch, no storage access.

## Auth Shell Behavior (`frontend/src/api/authFocusRefresh.js`)

Module state: `lastAuthRefreshAt = 0`, `unfocusedSince = null`, `refreshInFlight = false`, `listenersInstalled = false`. Storage helpers `readSharedRefreshAt()` / `writeSharedRefreshAt(ts)` / `clearSharedRefreshAt()` wrap `localStorage` in try/catch and degrade to `0` / no-op.

```text
refreshAuthOnFocus({ longAbsence = false, unfocusedMs = 0 } = {}):
  exit if document is non-visible
  exit if refreshInFlight
  last = max(lastAuthRefreshAt, readSharedRefreshAt())
  if last != 0 and now - last < AUTH_REFRESH_THROTTLE_MS:
      if longAbsence: dispatch long-absence event   # auth already fresh (this tab or another)
      return
  lastAuthRefreshAt = now; writeSharedRefreshAt(now); refreshInFlight = true
  try:
      POST /api/auth/refresh (same-origin, X-Requested-With)
      on 401: clearSharedRefreshAt(); location.assign(loginUrl or fallback)
      on ok and longAbsence: dispatch long-absence event
  catch: leave network failures to the next eligible attempt
  finally: refreshInFlight = false

noteDashboardUnfocused(): unfocusedSince = now, only if currently null (earliest wins)

handleVisibleReturn():
  if document non-visible: noteDashboardUnfocused(); return   # focus while hidden
  unfocusedMs = unfocusedSince == null ? 0 : now - unfocusedSince; unfocusedSince = null
  refreshAuthOnFocus({ longAbsence: unfocusedMs > LONG_ABSENCE_MS, unfocusedMs })

handleVisibilityChange(): hidden -> noteDashboardUnfocused(); visible -> handleVisibleReturn()

installAuthFocusRefresh():
  exit if listenersInstalled; set listenersInstalled
  window blur -> noteDashboardUnfocused; window focus -> handleVisibleReturn
  document visibilitychange -> handleVisibilityChange
  handleVisibleReturn()   # initial load: visible -> initial refresh; hidden -> record start
```

The long-absence event is `new CustomEvent(AUTH_LONG_ABSENCE_EVENT, { detail: { unfocusedMs } })` dispatched on `window`. `Date.now()` is the only time source. No `setInterval`/`setTimeout`, no `location.reload`, no `sessionStorage`, no `BroadcastChannel`, no backend state, no production test hooks.

## State-Machine Checklist

| Start/event sequence | Expected result |
| --- | --- |
| Initial visible load | One auth POST; no long-absence event |
| Initial visible load, shared timestamp fresh (another tab) | No POST; no event |
| Initial hidden load | Record hidden start; no POST until visible |
| Blur, return before 12 minutes | One eligible throttled POST; no event |
| Blur, return at exactly 12 minutes | Same as before-threshold; no event |
| Blur, return after 12 minutes + 1 ms | One POST; on 200 exactly one long-absence event with `unfocusedMs` |
| Hidden, visible after >12 minutes | Same as blur path |
| Focus fires while still hidden | Preserve earliest unfocused start; wait for visible return |
| Focus and visibilitychange burst after a long-absence return | One POST, one event total |
| Long absence, shared timestamp fresh (another tab refreshed) | No POST; one long-absence event |
| Long absence, POST returns 401 | No event; clear shared timestamp; `location.assign(loginUrl)` |
| 401 without `loginUrl` | Fallback `/login?reason=session_expired` |
| Long absence, network error | No event, no crash; next eligible attempt recovers |
| `localStorage` throws | Behavior identical minus cross-tab dedup; no crash |
| Installer called twice | One listener registration per event; one initial POST |
| Dashboard receives long-absence event | Active view re-runs the manual-refresh fetch path; no document request |

There is no reload state anywhere: over-threshold return produces zero additional document or auth-script requests.

## File Map

- Create: `frontend/src/api/authRefreshContract.js`
- Modify: `frontend/src/api/authFocusRefresh.js`
- Modify: `frontend/src/dashboard.jsx` (long-absence listener + manual-refresh handler extraction only)
- Modify: `jira_server.py` (temporary static/document diagnostics log hook only)
- Modify: `tests/test_auth_entry_page.py`
- Modify: `tests/test_frontend_api_source_guards.js`
- Create: `tests/test_auth_focus_refresh.js`
- Create: `tests/ui/auth_focus_refresh_counts.spec.js`
- Create: `tests/test_static_request_diagnostics.py`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/README.md` (index entry for this plan)
- Generated by build: `frontend/dist/auth-focus-refresh.js(.map)`, `frontend/dist/dashboard.js(.map)`

Explicitly unchanged: `jira-dashboard.html`, backend auth routes, endpoint security policy, `frontend/dist/dashboard.css` (no CSS changes expected).

## Task 1: Establish The Static-Request Baseline

**Files:**
- Modify: `tests/test_auth_entry_page.py`
- Create: `tests/ui/auth_focus_refresh_counts.spec.js`

- [x] In `test_dashboard_auth_shell_refreshes_on_initial_load`, add an assertion that `jira-dashboard.html` contains exactly one `auth-focus-refresh.js` script include; replace the `refreshAuthOnFocus();` literal assertion with `installAuthFocusRefresh();` (which survives the rewrite); add `assertNotIn('location.reload', refresh_source)`.
- [x] Create the Playwright spec with a self-contained shell: fulfill the document from on-disk `jira-dashboard.html`, fulfill `**/frontend/dist/auth-focus-refresh.js` from an in-memory esbuild IIFE build of `frontend/src/api/authFocusRefresh.js` (build:auth flags, no minify/sourcemap) done once in `beforeAll`, stub `dashboard.js`/`dashboard.css` as empty, stub `POST **/api/auth/refresh` → 200 `{}`, count document requests, auth-script requests, and auth POSTs. Origin stays `http://127.0.0.1:5050` (route-fulfilled; the live server is never load-bearing for specs).
- [x] Baseline test: one `page.goto()` → exactly one document request, one auth-script request, one auth POST. Then dispatch a visible-state focus/visibilitychange burst → zero additional document/script requests and zero additional POSTs (60s throttle).
- [x] Run against the current unmodified module and record the result:

```bash
fnm exec --using 20 npx playwright test tests/ui/auth_focus_refresh_counts.spec.js
.venv/bin/python -m unittest tests.test_auth_entry_page
```

Expected: pass against current behavior. If one document load produces multiple auth-script GETs before any behavior change, stop and identify the request owner. If the baseline passes, record in the PR notes that the original log burst is not reproducible from a single loaded page and remains consistent with repeated navigations/tabs.

## Task 2: Add Focus State Unit Tests (Expected Red)

**Files:**
- Create: `tests/test_auth_focus_refresh.js`
- Modify: `tests/test_frontend_api_source_guards.js`

- [x] Build `frontend/src/api/authFocusRefresh.js` to CJS in memory with esbuild and evaluate it per test in a fresh `vm` context (pattern: superseded branch's `tests/test_auth_focus_refresh.js`) with controllable `Date.now`, mutable `document.visibilityState`, recorded `window`/`document` listener registrations, recorded `window.dispatchEvent` calls, a scriptable `fetch` mock, a fake `localStorage` (plus a throwing variant), and a recorded `location.assign`.
- [x] Drive behavior only through recorded listeners and the module's public install/refresh exports — no production test hooks.
- [x] Cover every row of the State-Machine Checklist above, pinning the boundary at exactly 12:00.000 (no event) vs 12:00.000 + 1 ms (event), the `refreshInFlight` burst guard, cross-tab skip via a pre-seeded fresh shared timestamp, 401-with/without-`loginUrl`, shared-timestamp clear on 401, network error, throwing `localStorage`, double install, and the event `detail.unfocusedMs` value.
- [x] Add source guards in `tests/test_frontend_api_source_guards.js`: the contract module contains the four exact constants and no `fetch`/`addEventListener`/`localStorage` tokens; `authFocusRefresh.js` imports from `./authRefreshContract`, contains `'X-Requested-With': 'jira-execution-planner'` and `method: 'POST'`, and contains no `location.reload`, `setInterval`, `setTimeout`, `sessionStorage`, or `BroadcastChannel` tokens; `dashboard.jsx` imports `AUTH_LONG_ABSENCE_EVENT` from the contract module and does not import `authFocusRefresh`.

Run before implementation:

```bash
fnm exec --using 20 node --test tests/test_auth_focus_refresh.js tests/test_frontend_api_source_guards.js
```

Expected: new behavior tests and new guards fail (missing contract module, absence tracking, event dispatch, storage dedup); all pre-existing guards stay green.

## Task 3: Implement The Refresh-Only Long-Absence Behavior

**Files:**
- Create: `frontend/src/api/authRefreshContract.js`
- Modify: `frontend/src/api/authFocusRefresh.js`

- [x] Implement exactly the contract module and the auth-shell behavior specified above. Preserve the existing fetch call shape, throttle semantics, and 401 recovery. Keep the module self-installing (`installAuthFocusRefresh();` at the bottom) and idempotent.

Run:

```bash
fnm exec --using 20 node --test tests/test_auth_focus_refresh.js tests/test_frontend_api_source_guards.js
.venv/bin/python -m unittest tests.test_auth_entry_page
```

Expected: pass (dashboard.jsx guard from Task 2 remains red until Task 4).

## Task 4: Dashboard Stale-View Refresh On Long-Absence Return

**Files:**
- Modify: `frontend/src/dashboard.jsx`

- [x] Extract the existing refresh control's `onClick` body (`IconButton` `refresh-icon`, near `dashboard.jsx:12910`) into one named function in the same scope, used by both the button and the new listener; byte-identical logic, no behavior change to the manual path.
- [x] Add a mount-once `useEffect` that subscribes to `AUTH_LONG_ABSENCE_EVENT` (imported from `./api/authRefreshContract`) via a latest-callback ref, calls the extracted function, and unsubscribes on unmount. The listener must be a no-op whenever the manual control would be unavailable or disabled (reuse the same conditions the control uses; verify what gates it before wiring).
- [x] Do not import `authFocusRefresh.js` into the dashboard bundle. No other dashboard changes.

Run:

```bash
fnm exec --using 20 node --test tests/test_frontend_api_source_guards.js
```

Expected: the dashboard wiring guard from Task 2 turns green; runtime proof lands in Task 5.

## Task 5: Prove Request Counts And Wiring In A Browser

**Files:**
- Modify: `tests/ui/auth_focus_refresh_counts.spec.js`

- [x] Keep the Task 1 baseline test unchanged.
- [x] Clock control: `addInitScript` offset shim over `Date.now` with an in-page `__advanceClock(ms)`; visibility control: `addInitScript` override of `document.visibilityState` with an in-page setter that also dispatches `visibilitychange`. Track long-absence events per page via an init-script `window` listener counter.
- [x] Under threshold: blur → advance 11 min → focus: zero additional document/script requests, exactly one additional POST (throttle window passed), zero long-absence events.
- [x] Exactly 12 minutes: same expectations as under threshold.
- [x] Over threshold (both blur→focus and hidden→visible variants): exactly one additional POST, exactly one long-absence event, zero additional document/script requests; then a focus/visibilitychange burst plus a short stability wait keeps all counts unchanged.
- [x] Multi-tab: two pages in one context (shared origin storage, same clock offsets). Page B loaded inside page A's throttle window skips its initial POST. Both go hidden, both clocks advance >12 min; page A returns → one POST + one event; page B returns within the throttle window → zero POSTs + one event. Total POSTs across the context: exactly 2.
- [x] 401 recovery: (a) initial POST → 401 with `loginUrl` navigates to the stubbed login page; (b) long-absence POST → 401 navigates to login, dispatches no long-absence event, and never re-requests the dashboard document.
- [x] Dashboard wiring: esbuild-bundle `frontend/src/dashboard.jsx` in `beforeAll` (existing `eng_priority_transitions.spec.js` self-host pattern) with `installDashboardFixture`; after initial data loads, record the API `calls` length, dispatch the long-absence `CustomEvent` on `window`, and assert the active view re-runs its scoped data fetches (new entries in `calls`) with zero document requests.
- [x] Assert no uncaught page errors in every test.

Run:

```bash
fnm exec --using 20 npx playwright test tests/ui/auth_focus_refresh_counts.spec.js
```

Expected: pass; the only intentional extra requests anywhere are auth POSTs, never documents or assets.

## Task 6: Temporary Static/Document Request Diagnostics

**Files:**
- Modify: `jira_server.py`
- Create: `tests/test_static_request_diagnostics.py`

- [x] Add an `after_request` hook that, only for paths `/`, `/jira-dashboard.html`, and `/frontend/dist/<...>`, emits one INFO line on logger `jep.static_diagnostics` with fields: short per-request id (uuid4 hex, 12 chars), method, path, response status, `Referer` with any query string stripped (`-` when absent), `Sec-Fetch-Dest` (`-` when absent), validator presence (`etag`, `modified-since`, or `none` from `If-None-Match`/`If-Modified-Since`), and anonymized client correlation: `sha256(Cookie header)[:12]` or `-` when no cookie. Never log raw cookie, token, or query-string values. Mark the hook with a one-line comment naming this plan and the removal criterion (navigation owner identified).
- [x] Tests: hook fires for `/frontend/dist/auth-focus-refresh.js` and `/` (including redirect statuses) and not for `/api/*`; validator field reflects `If-None-Match`; a request with a cookie logs the 12-hex hash and never the raw value; a `Referer` with a query string is logged without it.

Run:

```bash
.venv/bin/python -m unittest tests.test_static_request_diagnostics
```

Expected: pass; no other route behavior changes.

## Task 7: Analytics Record, Docs, Build, And Full Verification

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/README.md`
- Generated: `frontend/dist/*`

- [x] Add under `### No-Event Allowlist` (preserving all existing rows):

```md
| Auth long-absence refresh (no reload) | `frontend/src/api/authFocusRefresh.js`, `frontend/src/dashboard.jsx` | No separate `userevent`; automatic reliability recovery after >12 continuously unfocused/hidden minutes issues one throttled cross-tab-deduplicated `POST /api/auth/refresh` and re-runs the active view's existing scoped fetches, which are already covered by `api_result`. No document reload and no new client identifiers. | 2026-07-16 |
```

- [x] Update the `EXEC-auth-unfocused-auto-refresh.md` entry in `docs/plans/README.md` to describe the refresh-only behavior, cross-tab dedup, diagnostics, and the deferred cache-hardening scope.
- [ ] Rebuild generated output (`fnm exec --using 20 npm run build`); commit dist changes; never hand-edit `frontend/dist`.
- [ ] Full verification matrix:

```bash
fnm exec --using 20 npm run build
.venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python -m unittest discover -s tests
fnm exec --using 20 npm run test:frontend:unit
fnm exec --using 20 npx playwright test tests/ui/auth_focus_refresh_counts.spec.js
```

- [ ] Live-server verification against the user's running `http://127.0.0.1:5050` (read-only; do not restart it): the served `/frontend/dist/auth-focus-refresh.js` contains the long-absence event name and no `location.reload`; a conditional GET with the returned ETag yields `304`. Verify the diagnostics hook by launching a second server instance on an unused port (or, if binding is impossible, via the unittest coverage) — never by restarting the user's server.
- [ ] Review `git diff --check`, confirm build idempotence (second build → no diff), review `git log --oneline`, and wait for explicit user confirmation before any push.

## Completion Criteria

- [ ] No `location.reload` call site exists anywhere in `frontend/src`; no timer, no polling, no `BroadcastChannel`, no backend session state.
- [ ] `POST /api/auth/refresh` remains event-driven and throttled with the backend boundary unchanged.
- [ ] Before or exactly at 12 minutes: no long-absence event; existing throttled refresh only.
- [ ] More than 12 minutes: exactly one auth POST per cooldown window across all tabs, exactly one long-absence event per returning tab, zero document/asset reloads.
- [ ] Dashboard refreshes only the active view's data via its existing manual-refresh path, gated by the same availability conditions.
- [ ] 401 recovery (with and without `loginUrl`) is intact on both the initial and long-absence paths.
- [ ] Request-count regression suite covers: one navigation → one auth-script GET; focus bursts → zero document/asset requests; multi-tab → one POST per cooldown window; long absence → in-place data refresh only; 401 recovery.
- [ ] Temporary diagnostics log line ships with tests proving anonymization (no raw cookies, no query strings) and scoping (document/dist paths only).
- [ ] Content-hashed/immutable asset serving is recorded as deferred scope, not implemented, and no cache/path change is presented as the fix.
- [ ] Analytics no-event rationale is documented; `GATE-05` remains blocked; no Home/Townsquare mutation behavior is introduced.
