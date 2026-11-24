# Perimeter Session Expiry Recovery Implementation Plan

> **Status:** Implemented locally, revision R3; operator added D-5 on 2026-11-24. Focused checks passed and the whole-branch review approved. Combined verification was incomplete because the backend stage hit its deadline. Branch `bugfix/perimeter-session-expiry-recovery` from `origin/main` `19b05ee9`. The operator accepted D-1 through D-4 and authorized execution from the local R2 commit `4dee2624` without publishing the branch. Retain `EXEC-` until the operator authorizes publication.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the hosted ingress sign-in session (OAuth2 Proxy) expires, the dashboard recovers by itself with one page reload that keeps unsaved Planning/Scenario changes, instead of showing "Server is not responding" with a Retry button that can never succeed.

**Architecture:**
- **Detection.** The fetch layer stops following redirects on API calls (`redirect: 'manual'`). No route that the frontend fetches ever redirects, so an `opaqueredirect` response means the perimeter asked the browser to sign in again. `http.js` throws a typed `PerimeterSessionExpiredError` and dispatches one window event, so detection does not depend on each caller reporting the error.
- **Recovery.** The existing connection-recovery owner (`useConnectionRecovery`) subscribes to the event. It keeps its config probe, treats a perimeter rejection of that probe as "server reachable", and reloads through the existing capsule and one-attempt-per-outage guard.
- **Result.** The top-level reload follows the proxy and IdP redirects. A live IdP session bounces straight back; an expired one shows the IdP sign-in once.

**Tech Stack:** React 19 + esbuild frontend, `node --test` unit tests, Playwright desktop Chromium, `unittest` backend guards through the isolated runner.

**Spec:** This plan carries its own diagnosis (below); no separate spec document.

## Diagnosis (production, 2026-11-23)

A dashboard tab left open for about a week showed the "Server is not responding" banner, then "The server is still unreachable" after every Retry. A hard refresh restored it immediately.

- **How the failure starts.** The hosted ingress is NGINX + OAuth2 Proxy with daily perimeter reauth (`DONE-application-hosting-readiness.md`). After expiry, `GET /api/config?includeViewConfig=true` receives a 302 to the external IdP authorize URL. `fetch` follows it cross-origin, CORS blocks it, and `fetch` rejects with a `TypeError` (Firefox: `NS_ERROR…`; the network panel shows "html (redirect)").
- **How it is misclassified.** `performApiFetch` in `frontend/src/api/http.js` handles only `401`/`auth_required` responses, so the `TypeError` reaches `isBackendConnectionFailure` in `frontend/src/dashboardRuntime.js` and raises the connection banner.
- **Why Retry never succeeds.** `recover()` in `frontend/src/api/useConnectionRecovery.js` reloads only after `fetchAppConfig` succeeds. The probe hits the same redirect, so manual and automatic recovery always end in `probe_failed`.
- **Why nothing else recovers.** `refreshAuthOnFocus` in `frontend/src/api/authFocusRefresh.js` swallows non-auth errors and returns early while `CONNECTION_UNAVAILABLE_EVENT` is active. Automatic reads such as the sprint catalog `read` in `dashboard.jsx` report only non-automatic failures, so the first redirected request after idle can go unreported.
- **Why a hard refresh works.** It is a top-level navigation, and only that can follow the proxy → IdP → proxy redirect chain.
- **Redirect inventory (verified).** Flask redirects:
  - the dashboard entry paths (`redirect_unauthenticated_oauth_dashboard_entry` in `jira_server.py`, `OAUTH_DASHBOARD_ENTRY_PATHS = {'/', '/jira-dashboard.html'}`);
  - the `/login` routes;
  - two navigation-only API routes, `/api/auth/atlassian/login` and `/api/auth/atlassian/callback` (`backend/routes/auth_routes.py`). `frontend/src` never fetches them (rg: no reference).

  Every other `/api/*` route answers without redirecting. Task 1 pins this with guards.
- **Verified by review probe (Chromium).** A `redirect: 'manual'` fetch to a same-origin URL answered with a cross-origin 302 resolves to `type: 'opaqueredirect', status: 0`, both from a real local server and from Playwright `route.fulfill({ status: 302, headers: { Location } })`, and no request reaches the redirect target. With the default `follow`, the same setup reproduces `TypeError: Failed to fetch`. Firefox was not executed (the repo forbids it); the Fetch spec defines the same behaviour.
- **Not confirmed.** Whether the 302 comes from OAuth2 Proxy itself or from NGINX `auth_request` + `auth-signin`. The client fix does not depend on it. A perimeter that answers API calls with a bare `401` would instead hit the existing terminal sign-in lock (`http.js`), which is acceptable but not this plan's path.

## Decisions

- **D-1 (recovery surface): A, accepted 2026-11-23.** A perimeter expiry triggers the existing capsule + automatic reload with no extra click, bounded by the one-attempt-per-outage guard and limited by D-5. `manual_required` falls back to the explicit button. A perimeter redirect is not an application `401`, so the terminal-lock rule does not apply.
- **D-2 (button after a failed probe): A, accepted 2026-11-23.** After a manual probe fails with a connection failure while `globalThis.navigator?.onLine !== false`, the same banner button becomes "Reload page" (the MRT032 label). Its next click preserves drafts and reloads without probing. This replaces the current contract of the spec "a Retry probe that still cannot connect says so instead of silently repeating the banner" (Task 3 updates it).
- **D-3 (copy, mechanical).**
  - **Local backend:** "Start the Python server, then retry." is shown only when the backend hostname is `localhost`, `127.0.0.1` or `[::1]`, or when `backendUrl` cannot be parsed.
  - **Hosted:** "The server at {backendUrl} is not reachable. Retry when it is available."
  - **Perimeter title:** "Sign-in session expired" in every perimeter state.
  - **Perimeter message while recovery runs:** "Your sign-in session expired. Reloading to sign in again; unsaved changes are kept."
  - **Perimeter message in `manual_required`:** "Your sign-in session expired. Reload the page to sign in again; unsaved changes are kept." This replaces the generic "Automatic recovery already ran…" line, and the button label is "Reload page".
- **D-4 (detection transport, mechanical).** `http.js` dispatches `PERIMETER_SESSION_EXPIRED_EVENT` and `useConnectionRecovery` subscribes. This covers focus refresh, automatic reads and the ENG Board stream without editing each caller, and it removes the sprint-read edit from `dashboard.jsx`.

- **D-5 (automatic reload only on auth failure), accepted 2026-11-24.** Only an outage that started from a detected perimeter redirect may reload automatically: from the perimeter event, from queued recovery after restoration, or on focus or visibility return. Ordinary connection outages never reload automatically. On return they keep the banner, and only a Retry connection or Reload page click reloads. A tab that stays mounted does not reload for a non-auth reason.

## Global Constraints

- The global authentication lock (`readPendingAuthenticationRequired`) keeps precedence: no reload while it is set.
- Pending writes are never replayed. The reload still waits for `waitForPendingMutations(CONNECTION_PROBE_TIMEOUT_MS)`.
- At most one automatic reload per outage id (`canAutomaticallyRecoverConnection` / `markConnectionRecoveryAttempt`). No new storage keys.
- The capsule principal is still validated after reload: `readConnectionRecoveryState` checks `workspaceId` + `viewConfigId`. Skipping the pre-reload identity comparison for perimeter probes relies on that check.
- `frontend/src/dashboard.jsx` changes only by destructuring `perimeterExpired` from `useConnectionRecovery` and passing it to `ServerUnavailableBanner`. No auth UI (root AGENTS.md learning). The file is at 7502 lines against `lineCeiling` 7508 in `scripts/extraction_lint/owner_budgets.json`. Stay within it, and never golf unrelated lines.
- Keep the probe call text `fetchAppConfig(backendUrl, { cache: 'no-cache', signal: probe.signal })` verbatim: it is pinned by `tests/test_frontend_api_source_guards.js` "connection Retry uses an exact config probe and hard reload".
- No new class hook. `ServerUnavailableBanner` keeps `.server-unavailable-banner` and its native button.
- Analytics: no new event. Extend the existing no-event allowlist row "Connection recovery hard reload and Scenario restoration" in `docs/README_ANALYTICS.md`. Never collect the redirect target, outage ids or capsule contents.
- Desktop Chromium only. During development run focused tests; the full gate runs only before push/PR.

## Review Focus

1. **Expired IdP session as well as proxy session.** The reload lands on the IdP sign-in page. Drafts are restored if the user returns within the capsule's 30-minute TTL and are dropped after it by the existing TTL. This is accepted behaviour, recorded in the ontology entry (Task 4); no automated test.
2. **Proxy misconfigured, so API calls keep redirecting after the reload.** The new mount reads the stored attempt and must land in `manual_required`, not loop. Tested in Task 2 by remounting with shared storage.
3. **Background traffic during a blocked recovery.** Repeated perimeter events while recovery is waiting for a save or blocked on preservation must not start repeated probes. Tested in Task 2.
4. **ENG Board stream (`apiFetchHeaders`, the only caller is `engBoardApi.js`).** It must get the typed error. Scenario realtime uses `EventSource`, which follows the redirect, errors and falls back to polling; polling then gets the typed error through `apiFetch`. Tested in Task 1 for `apiFetchHeaders`.
5. **Lazy view chunks after expiry.** `lazyViewLoaders.js` fetches a manifest and imports chunks that the proxy also redirects. Out of scope: the existing MRT032 Retry/Reload page recovery handles it with its own copy. Recorded in `docs/TODO.md` (Task 4); no test.

6. **Planning saved or discarded after restore** must not be resurrected by a reused capsule.

## Execution Record

- **Task 1 complete, `cea36090`.** Independent review approved. The first test run produced 10 expected JS failures; the navigation guards and all 24 Python inventory tests passed. The build and all 144 focused JS, 24 Python, and 17 auth/config checks passed after implementation. Two additional existing fetch-init assertions in the mapped source-guard test needed the enforced redirect option. Review added exact redirect-path coverage and a concurrent authentication-lock test; the 8 HTTP and 24 Python checks passed again.
- **Task 2 complete, `2ebe4595`.** Independent review approved. The first test run reproduced seven hook and two Chromium failures; the auth-lock guard already passed. Chromium's focus harness needed a 60,001 ms clock advance in place of importing an ES module. Focused verification passed: 26 hook and owner, 93 source and design, nine isolated structure, and 36 Chromium checks. Review added an in-memory preservation guard, retention of the prior capsule when a new document still lacks a mounted principal, and mutual exclusion with Scenario restoration. One source pin in the Task 1 file map was updated in Task 2 to protect the previous-restore versus newer-outage ownership boundary. The dashboard grew by the two planned lines to 7,504 of 7,508.
- **Task 3 complete, `83d179e0`.** Independent review approved. The first test run reproduced three hook, one hosted-copy, and one Chromium failure. Offline, timeout and local copy guards already passed. Focused verification passed: 35 hook and owner, 46 runtime, and 21 Chromium checks. Review covered focus and visibility while the offer is active, retention of a prior capsule, explicit discard without reprobing, and manual perimeter copy while awaiting a click. One extra frontend source-guard run outside Task 3's named verification passed all 79 checks. Desktop Chromium screenshots of the real banner and built styles confirmed the copy and button changes.
- **Task 4 complete, `f9b0e39d`.** Independent review approved. All 12 isolated documentation checks and 63 analytics checks passed after the final wording update. The ontology Coverage line is unchanged. The plan rename and index change remain deferred to publication.
- **Whole-branch review fix, `b44518f2`.** Re-review approved. An incomplete staged Scenario draft keeps the original capsule and expiry until the owner completes or the user explicitly discards it. Failed Settings preservation retains the discard choice and stops automatic probes. Test-first runs reproduced the missing, conflicting, and identical Scenario capture cases and the Settings retry loop. The final fix passed 132 focused Node and 12 Chromium checks. The broader first fix run passed 177 Node, 37 Chromium and nine isolated structure checks before the exact-match case was tightened.
- **Combined verification, `b44518f2`.** Ran `make verify` with Node 20 on the clean reviewed commit. Exact summary: `build: passed (1.340s)`, `backend: deadline-exceeded (517.853s)`, `Complete verification: failed; 519.309s/600s`. The backend did not finish before the runner's deadline, which reserves 90 seconds for cleanup. The full frontend unit and desktop Chromium stages did not start. The run finished within 600 seconds and no substitute run was used.

- **Follow-up review, 2026-11-24.** The nonbusy sign-in banner gives reload guidance without promising draft retention. This supersedes the D-3 manual message for nonbusy states. Eligible perimeter recovery resumes when Scenario restoration yields, without another focus event. The operator kept the original 30-minute expiry for uninstalled Scenario drafts. A second perimeter reload reuses the validated capsule byte for byte when no newer work would be lost. Conflicting drafts or newer work keep recovery blocked and the staged draft in the tab. The existing connection-recovery analytics allowlist covers these paths. The build, 134 Node checks, 21 isolated structure and documentation checks, and 37 desktop Chromium tests passed. The full gate was not rerun.

- **R3 preflight, `4e5e7cd4`.** Committed the seven reviewed follow-up files only. The Node 20 build, 188 Node tests and 12 desktop Chromium recovery cases passed with zero failures.

- **R3 D-5, `35cd994b`.** The new Node case failed before the fix (one unwanted probe; 35 cases outside the filter skipped). Both changed Chromium cases failed on an unwanted document reload. After the visible-return guard, the build and 189 Node tests passed. Chromium ran the recovery (12 passed), auth-focus (33 passed), Planning (66 passed), and Scenario (23 passed, one opt-in runtime baseline skipped) specs, with zero failures. The former automatic-reload case and the post-bootstrap second-outage case now expect focus or visibility to leave the ordinary outage mounted and Retry to reload once. Perimeter focus and hidden-return coverage stayed intact. The R3 plan update passed 12 isolated documentation checks.

- **R3 Planning capsule protection, `20e86f23`.** The saved-Planning regression failed before the fix (one unexpected reload; 36 cases outside the filter skipped). Once Planning declares its capsule work restored, the current capture must match the stored Planning draft, including an explicit absence. If the user saved or discarded that draft and Scenario is still staged, the hook blocks the reload with the staged-Scenario preservation notice, keeps the original capsule and expiry, and does not reinstall the old Planning draft. Explicit Reload and discard writes no old Planning draft. The build, 190 Node tests and 12 Chromium recovery cases passed with zero failures.

The live hosting redirect chain and a real IdP sign-in across the capsule TTL remain unverified. Tests use synthetic redirects and desktop Chromium. Lazy view chunks keep their existing MRT032 recovery (Review Focus 5).

---

### Task 1: Detect perimeter redirects in the fetch layer

**Files:**
- Modify: `frontend/src/api/authRefreshContract.js` (new constant)
- Modify: `frontend/src/api/http.js` (`performApiFetch`, `apiFetchHeaders`; new exports)
- Modify: `frontend/src/api/earlyBootstrap.js` (`startEarlyRequest` fetch init)
- Modify: `frontend/src/dashboardRuntime.js` (`isBackendConnectionFailure`)
- Test (new cases): `tests/test_http_pending_mutations.js`, `tests/test_early_bootstrap.js`, `tests/test_dashboard_runtime.js`, `tests/test_endpoint_policy_inventory.py`, `tests/test_frontend_api_source_guards.js`
- Test (planned updates to existing assertions):
  - `tests/test_frontend_api_source_guards.js`: the `earlyBootstrapFetch` constant (≈line 253) and its exact-count assertion (≈line 292). The `performApiFetch` assertion that pins `response = (early ? await early.promise : null) || await fetch(url, options);` (≈line 273). `loadHttpHelpers` (≈lines 38-45), which must also strip `export class ` so the helper source still evaluates.
  - `tests/test_early_bootstrap.js`: the loader-init `deepEqual` (≈line 162) and the early-init `deepEqual` (≈line 182) both gain `redirect: 'manual'`.

**Interfaces:**
- Produces, in `authRefreshContract.js`: `export const PERIMETER_SESSION_EXPIRED_EVENT = 'jep:perimeter-session-expired';`.
- Produces, in `http.js`:
  - `export class PerimeterSessionExpiredError extends Error` with `name = 'PerimeterSessionExpiredError'`, `code = 'perimeter_session_expired'`, message `'The sign-in session expired.'`;
  - `export function isPerimeterSessionExpiredError(error): boolean` (a name check, like `isAuthenticationRequiredError`).
- Produces, in `dashboardRuntime.js`: `isBackendConnectionFailure(error)` returns `true` when `error?.name === 'PerimeterSessionExpiredError'`. It uses a name check, not an import, so no import cycle is created.

- [ ] **Step 1: Write the failing tests and update the pinned assertions listed above**
  - `test_http_pending_mutations.js`, using the existing `loadHttp(fetchImpl)` harness. Add `PERIMETER_SESSION_EXPIRED_EVENT` handling to its `window.dispatchEvent` stub by recording `event.type`. The fake response is `{ type: 'opaqueredirect', status: 0, ok: false, clone: () => ({ arrayBuffer: async () => new ArrayBuffer(0), json: async () => { throw new Error('opaque'); } }) }`. Cases:
    - `apiFetch sends redirect manual`: the captured init has `redirect === 'manual'`, even when the caller passed `redirect: 'follow'`.
    - `an opaque redirect rejects with PerimeterSessionExpiredError and dispatches the event once`: the rejection has `name === 'PerimeterSessionExpiredError'`, and the recorded events equal `['jep:perimeter-session-expired']`.
    - `a redirected write still settles its pending-mutation count`: after a rejected POST, `hasPendingMutations() === false`.
    - `apiFetchHeaders rejects with the typed error`: the same fake gives the same assertions.
  - `test_early_bootstrap.js`: `an adopted early opaque redirect rejects apiFetch with the typed error and starts no second fetch`. The early responder returns the fake above; assert the typed rejection and `fetchCalls.length === 2` (only the two early requests).
  - `test_dashboard_runtime.js`: `isBackendConnectionFailure({ name: 'PerimeterSessionExpiredError' }) === true`.
  - `test_endpoint_policy_inventory.py`, `test_only_navigation_auth_api_routes_redirect`. For every `jira_server.app.url_map` rule starting with `/api/`, read `inspect.getsource(jira_server.app.view_functions[rule.endpoint])`. The endpoints whose source contains `redirect(` must be exactly the endpoints of `/api/auth/atlassian/login` and `/api/auth/atlassian/callback`. Then `test_no_api_rule_ends_with_slash`: no `/api/` rule ends with `/`, because strict slashes would answer with a 308.
  - `test_frontend_api_source_guards.js`, `navigation-only auth API routes are never fetched`: no file under `frontend/src` contains `/api/auth/atlassian/`.
- [ ] **Step 2: Run the tests and confirm the expected results**
  Run: `npm run build && node --test tests/test_http_pending_mutations.js tests/test_early_bootstrap.js tests/test_dashboard_runtime.js tests/test_frontend_api_source_guards.js`
  Run: `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_endpoint_policy_inventory`
  Expected: the new JS cases and the updated pinned assertions FAIL. Both Python guards and the frontend navigation-route guard PASS, because they pin the current invariant.
- [ ] **Step 3: Implement**
  - Both `http.js` fetch call sites pass `{ ...options, redirect: 'manual' }`. Write the `performApiFetch` call so it still contains one native `fetch(`, which the `countNativeFetches` assertion requires.
  - The early script passes `redirect: 'manual'` in its init.
  - Immediately after a response is obtained (adopted early or fresh), and before the `!response.ok` auth branch, `response.type === 'opaqueredirect'` dispatches `new Event(PERIMETER_SESSION_EXPIRED_EVENT)` on `window` and throws `new PerimeterSessionExpiredError()`.
  - Add the name check at the top of `isBackendConnectionFailure`.
- [ ] **Step 4: Run the Step 2 commands plus `node --test tests/test_auth_required.js tests/test_config_api.js`.** Expected: PASS.
- [ ] **Step 5: Commit** `Treat API redirects as an expired perimeter session`

### Task 2: Recover from a perimeter expiry by reloading

**Files:**
- Modify: `frontend/src/api/useConnectionRecovery.js`
- Modify: `frontend/src/components/ServerUnavailableBanner.jsx`
- Modify: `frontend/src/dashboard.jsx` (destructure `perimeterExpired`, pass it to the banner; nothing else)
- Test: `tests/test_planning_connection_recovery.js`, `tests/ui/server_unavailable_ui.spec.js`

**Interfaces:**
- Consumes: `PERIMETER_SESSION_EXPIRED_EVENT`, `isPerimeterSessionExpiredError` (Task 1).
- Produces: the hook returns `perimeterExpired: boolean`. `ServerUnavailableBanner` takes a `perimeterExpired` prop (default `false`).
- Internal: a `statusRef` that mirrors `status`, written by a `setStatusTracked(next)` helper that every `setStatus` call in the hook uses. Task 3 relies on it.

- [ ] **Step 1: Extend the harness, then write the failing tests**
  - Harness changes to `mountRecovery` in `test_planning_connection_recovery.js`:
    - Add `isPerimeterSessionExpiredError: error => error?.name === 'PerimeterSessionExpiredError'` to the `./http.js` stub. The four existing cases must keep passing.
    - New options:
      - `probeError` (the `fetchAppConfig` stub rejects with it);
      - `authLocked` (`readPendingAuthenticationRequired` returns `{ locked: true }`);
      - `values` (an injected shared `Map` for `sessionStorage`, so a second mount sees the first mount's attempt marker);
      - `visibility` (`document.visibilityState`);
      - `pendingWrite` (`hasPendingMutations` returns `true` once and records the wait call);
      - `outageError` (the error passed to the initial `reportServerConnectionError`; default stays `new Error('synthetic outage')`).
    - It exposes `messages`, the calls to `setServerConnectionError`.
  - Unit cases. "Perimeter" below means `{ name: 'PerimeterSessionExpiredError' }`.
    - `perimeter expiry reloads although the probe is redirected and keeps the Planning capsule`: `outageError` and `probeError` are perimeter, and `recover({ manual: false })` is called. Expect `reloads === 1`, the stored capsule `planning.draft.inclusionChanges[0].issueId === '8101'`, and the last message equal to the D-3 recovering message.
    - `a perimeter event on a visible page starts recovery without any call`: dispatch `PERIMETER_SESSION_EXPIRED_EVENT` on `window`, with `probeError` perimeter. Expect `reloads === 1` after a microtask flush.
    - `a perimeter event on a hidden page waits for the visible return`: with `visibility: 'hidden'`, dispatching the event gives `reloads === 0`. Then set it to visible and dispatch `visibilitychange`: `reloads === 1`.
    - `a reloaded page that meets the perimeter again requires manual recovery`: the first mount reloads. A second mount with the same `values` dispatches the event: `status === 'manual_required'`, the second mount's `reloads === 0`, and `perimeterExpired === true`.
    - `a pending authentication lock wins over perimeter reload`: with `authLocked`, dispatching the event gives `reloads === 0`.
    - `a perimeter expiry waits for a pending write before reloading`: with `pendingWrite`, the status passes through `waiting_for_save`, the wait was called with `10_000`, and then `reloads === 1`.
    - `a perimeter expiry that cannot store dirty Planning keeps the page`: with `storageWorks: false`, the notice kind is `preservation_failed` and `reloads === 0`. Dispatch the event three more times: the probe stub was called exactly once.
    - `perimeterExpired resets on a later ordinary outage and when the outage ends`: a perimeter report gives `true`. Then `markBootstrapHealthy('config'|'groups'|'sprints')` gives `false`. A perimeter report followed by a report of `new Error('Failed to fetch')` gives `false`.
  - UI cases in `server_unavailable_ui.spec.js`. Add a new helper `openWithPerimeterExpiry(page)`: it installs the fixture, routes `**/api/**` to `route.fulfill({ status: 302, headers: { Location: 'https://idp.example.test/auth' } })` while `state.redirect` is true (otherwise `route.fallback()`), and clears `state.redirect` from a `page.on('request')` handler when the request is a `document`. The existing `openWithSprintOutage` stays as it is.
    - `an expired perimeter session reloads once and restores the dashboard`: after the bootstrap, set `state.redirect = true` and click Refresh. Expect the document count +1 with no button click, then `Refresh tasks and sprints from Jira` enabled and `.server-unavailable-banner` count 0. Also expect no request whose URL starts with `https://idp.example.test`.
    - `a focus auth refresh that meets the perimeter redirect recovers`: after the bootstrap, advance `page.clock` past `AUTH_REFRESH_THROTTLE_MS` (60 s), set `state.redirect = true`, and dispatch `focus` on `window`. Expect the document count +1.
- [ ] **Step 2: Run the tests and confirm the failures**
  Run: `npm run build && node --test tests/test_planning_connection_recovery.js tests/test_connection_recovery_owners.js`
  Run: `npm run test:frontend:ui -- server_unavailable_ui.spec.js`
  Expected: the new cases FAIL and the existing cases PASS.
- [ ] **Step 3: Implement in `useConnectionRecovery.js`**
  - Add `perimeterExpired` state and `statusRef`. Route every status write through `setStatusTracked`.
  - `reportServerConnectionError`:
    - A perimeter error sets `perimeterExpired = true` and passes the D-3 recovering message to `setServerConnectionError`. Any other connection failure sets `perimeterExpired = false` and keeps the existing message.
    - Its status updater preserves `checking`, `manual_required` and `reload_offered`; today it preserves only `checking`.
    - It never calls `recover`.
  - A `window` listener for `PERIMETER_SESSION_EXPIRED_EVENT`, registered in the existing listener effect:
    1. Call `reportServerConnectionError(new PerimeterSessionExpiredError())`.
    2. If `document.visibilityState === 'visible'`, and `statusRef.current` is `idle` or `unavailable`, and no recovery is in flight, call `recoverRef.current({ manual: false })` in a microtask.
    3. Otherwise do nothing; the existing focus/visibility listener recovers later.

    Only this listener and the existing focus/visibility listener start automatic recovery. Nothing inside `recover` does.
  - `recover`: wrap the existing probe call. If it rejects with `isPerimeterSessionExpiredError`, set a local `perimeterReachable = true` and `config = null`, and continue. Compute `identityChanged = !perimeterReachable && Boolean(mountedPrincipal) && !sameConnectionRecoveryPrincipal(...)`. The rest is unchanged.
  - `markBootstrapHealthy` and `releaseOwnership` set `perimeterExpired = false`.
- [ ] **Step 4: Implement the banner and dashboard wiring**
  - `ServerUnavailableBanner`: when `perimeterExpired`, the title is "Sign-in session expired". In `manual_required` the D-3 manual line replaces the generic line and the button label is `Reload page`. Busy labels are unchanged.
  - `dashboard.jsx`: add `perimeterExpired: connectionPerimeterExpired,` to the `useConnectionRecovery` destructuring and `perimeterExpired={connectionPerimeterExpired}` to the banner.
- [ ] **Step 5: Run the Step 2 commands plus the following, and expect PASS**
  - `node --test tests/test_frontend_api_source_guards.js tests/test_design_system_write_contract.js`
  - `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_codebase_structure_budgets`
  - `npm run test:frontend:ui -- early_bootstrap.spec.js global_auth_lock.spec.js`
- [ ] **Step 6: Commit** `Reload through the perimeter sign-in when its session expires`

### Task 3: Offer a page reload after a failed probe (D-2) and fix hosted copy (D-3)

**Files:**
- Modify: `frontend/src/api/useConnectionRecovery.js` (`recover` catch branch, `REFRESH_BLOCKING_STATUSES`)
- Modify: `frontend/src/components/ServerUnavailableBanner.jsx` (label)
- Modify: `frontend/src/dashboardRuntime.js` (`getServerConnectionErrorMessage`)
- Test: `tests/test_planning_connection_recovery.js`, `tests/test_dashboard_runtime.js`, `tests/ui/server_unavailable_ui.spec.js` (update the case `a Retry probe that still cannot connect says so instead of silently repeating the banner`)

**Interfaces:**
- Consumes: `statusRef` and `setStatusTracked` (Task 2).
- Produces: hook status `'reload_offered'`, which is added to `REFRESH_BLOCKING_STATUSES`. `recover({ manual: true })` while `statusRef.current === 'reload_offered'` skips the probe and runs the existing pending-write wait, capsule, attempt mark, auth-lock check and `window.location.reload()` path, with `identityChanged = false`.

- [ ] **Step 1: Write the failing tests**
  - Unit cases. Set `globalThis.navigator` with `Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true })` and restore the original descriptor in `finally`; Node 20 has no global `navigator`, so also cover its absence.
    - `a manual probe that cannot connect offers a reload`: `probeError` is `new TypeError('NetworkError when attempting to fetch resource.')`. `recover({ manual: true })` gives `status === 'reload_offered'`, `reloads === 0`, and the notice text "The server is still unreachable. Retry when it is available." A second `recover({ manual: true })` gives `reloads === 1` with the capsule written.
    - `reload_offered survives a later connection report`: after the offer, `reportServerConnectionError(new Error('Failed to fetch'))` leaves `status === 'reload_offered'`.
    - `an offline browser is not offered a reload`: with `onLine: false`, the status is `unavailable`.
    - `no navigator means online`: with no `navigator` defined, the offer is made.
    - `a probe timeout keeps its notice and offers no reload`: with the probe aborted, the notice is "The server did not answer within 10 seconds. Retry when it is available." and `status === 'unavailable'`.
  - `test_dashboard_runtime.js`:
    - `getServerConnectionErrorMessage('http://localhost:5050')` and `getServerConnectionErrorMessage('')` keep the "Start the Python server, then retry." text.
    - `getServerConnectionErrorMessage('https://app.example.test')` returns "The server at https://app.example.test is not reachable. Retry when it is available."
  - UI: the updated case expects the notice "The server is still unreachable. Retry when it is available." and an enabled button named `Reload page`, with the document count unchanged. One click gives the document count +1.
- [ ] **Step 2: Run the tests and confirm the failures.** Run the Task 2 Step 2 commands plus `node --test tests/test_dashboard_runtime.js`. Expected: the new and updated cases FAIL.
- [ ] **Step 3: Implement**
  - In the `recover` catch, after the existing `reportServerConnectionError(err)` branch sets the notice: if `manual` is true, the probe was not aborted and `globalThis.navigator?.onLine !== false`, call `setStatusTracked('reload_offered')`.
  - The banner maps `reload_offered` to `Reload page`.
  - The message function parses the host in `try { new URL(backendUrl).hostname } catch {}`. A parse failure or a loopback host gives the local copy; anything else gives the hosted copy.
- [ ] **Step 4: Run the Step 2 commands plus the full `npm run test:frontend:ui -- server_unavailable_ui.spec.js early_bootstrap.spec.js`.** Expected: PASS. `early_bootstrap.spec.js` clicks `Retry connection` after a stalled body; that probe succeeds, so its label is unchanged.
- [ ] **Step 5: Commit** `Offer a page reload when the connection probe cannot reach the server`

### Task 4: Documentation and finish

**Files:**
- Modify `docs/ontology.md`. Edit only these entries and date only each touched section's `Verified on`; never edit line 3.
  - "Connection recovery": perimeter detection event, reload path, the `reload_offered` state, and the 30-minute capsule TTL across an IdP sign-in.
  - "Startup config timeout": `isBackendConnectionFailure` now also covers `PerimeterSessionExpiredError`.
  - "Authentication recovery": the precedence of the lock over perimeter recovery, and that a bare perimeter `401` takes the lock path.
- Modify `docs/README_ANALYTICS.md`. Extend the row "Connection recovery hard reload and Scenario restoration":
  - add `frontend/src/api/http.js` and `frontend/src/api/useConnectionRecovery.js` to its files;
  - perimeter detection, automatic perimeter reload and the Reload page offer emit no event;
  - redirected reads keep their existing `api_result` with status bucket 0 and no new parameter;
  - never collect the redirect target.
- Modify `INSTALL.md` (OAuth2 Proxy hosting section, ≈line 335): the app expects `/api/*` requests to be redirected when the perimeter session expires and recovers by reloading. A perimeter that answers with a bare `401` instead triggers the app's sign-in lock screen.
- Modify `README.md` (OAuth2 Proxy hosting section, ≈lines 397-401): the same one-sentence note.
- Modify `docs/SUPPORT-atlassian-oauth-setup.md` (≈line 27, where the perimeter is described): the same one-sentence note.
- Modify `docs/TODO.md`: Review Focus 5, the lazy chunks shown with MRT032 copy after a perimeter expiry.
- At publication, rename this plan to `DONE-perimeter-session-expiry-recovery.md` and update its `docs/plans/README.md` link.

- [ ] **Step 1:** Make the doc edits.
- [ ] **Step 2:** Run `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_agents_md_learnings` and `node --test tests/test_analytics_events.js`. Expected: PASS.
- [ ] **Step 3: Commit** `Document perimeter session recovery`
- [ ] **Step 4:** Before push and PR, run `make verify` and follow the publication transaction in root `AGENTS.md` section 10. Rename the plan to `DONE-` in that publication, with Outcome and Current Accuracy sections.

## Acceptance Criteria

- An ordinary outage causes zero reloads on focus or visibility return; one Retry click reloads once.

- A redirected API response never shows the "Start the Python server" text and needs no click. The page reloads once and drafts are restored; this is triggered by any request, including focus refresh and automatic reads (Tasks 1-2).
- A second perimeter detection after the reload shows `manual_required` with the "Reload page" button, and never loops (Task 2).
- The authentication lock and pending writes keep their precedence, and blocked recovery does not re-probe on every event (Task 2).
- After a failed manual probe while online, the same button reloads the page (Task 3).
- Only the two navigation-only Atlassian auth API routes redirect, no `/api/` rule ends with `/`, and the frontend never fetches those two routes (Task 1 guards).
- The ontology, analytics allowlist, INSTALL, README, the OAuth setup support doc and the TODO are updated (Task 4).
