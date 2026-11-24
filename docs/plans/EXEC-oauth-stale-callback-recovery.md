# OAuth stale callback recovery Implementation Plan

> **Status:** Planned 2026-11-24, revised 2026-11-24 after a second three-reviewer round; base `origin/main` `30d0923b`; not executed. Implements D4 option 1 (single pending login) and D7 option 1 (accept follower release without a new sign-in), both accepted 2026-11-24, and D8 (keep forced consent after an incomplete grant), approved 2026-11-24.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a healthy DB/OAuth runtime, a stale, replayed, superseded, denied or truncated Atlassian OAuth callback ends on the dashboard (when the browser is already signed in) or on the sign-in page with a notice, never on a raw JSON page, and never exchanges a code whose state did not match.

**Architecture:** `api_atlassian_callback` keeps its validation order and its pop of `oauth_state` / `oauth_pkce_verifier`, but each of its four pre-exchange failures returns one constant `302` to `/login?reason=sign_in_incomplete`. `auth_entry_page` learns that non-terminal reason: it already forwards a valid DB browser session to `pop_share_view_target(session)`; otherwise it renders the existing card with a new `.auth-notice` copy, and with the existing `?prompt=consent` link when validation raised `missing_oauth_scope` (D8). Post-exchange failures are unchanged.

**Tech Stack:** Python 3.10+, Flask, `unittest` through `tests/run_isolated_runtime_tests.py` on the runner's owned PostgreSQL cluster; Playwright Chromium against the owned synthetic DB/OAuth server (`tests/ui/db_oauth_fixture.js`).

**Spec:** [SUPPORT-oauth-stale-callback-recovery-design.md](SUPPORT-oauth-stale-callback-recovery-design.md)

## Global Constraints

- Redirect target, verbatim: `/login?reason=sign_in_incomplete`. It is a constant; nothing from the callback query is copied into it.
- Notice copy, verbatim: `Your sign-in did not finish, for example because the page was reloaded or sign-in was started again in another tab. Sign in again to continue.`
- The notice uses the existing `<p class="auth-notice" role="status">` element. The link is `/api/auth/atlassian/login`, except when the reason is `sign_in_incomplete` **and** session validation raised `AuthError` with code `missing_oauth_scope`: then it is the existing `/api/auth/atlassian/login?prompt=consent`. No other reason or error code changes the link.
- `sign_in_incomplete` is non-terminal: it is not added to the `{'session_expired', 'missing_scope'}` set in `auth_entry_page`.
- The callback response for the four pre-exchange failures (state missing on either side or different, provider `error`, missing `code`, missing verifier) never calls `validate_auth_config`, `validate_local_token_store_allowed`, `exchange_authorization_code`, `fetch_current_user`, `fetch_accessible_resources` or `store_db_oauth_callback_session_metadata`, never deletes a browser session, and never touches the share-view stash. The next `/login` request may consume the stash when it forwards, as today.
- Post-exchange failures and configuration errors keep their current status codes and JSON bodies.
- No change to `api_atlassian_login`, cookie attributes, the dashboard entry guard, `frontend/src/api/authRequired.js` (`VALID_REASONS`), `AuthRequiredGate.jsx` or `authRecoveryCoordinator.js`.
- No new log line. `state`, `code`, `error` and `error_description` values never appear in application-generated responses, pages, URLs or database rows, or in app-controlled logs (Werkzeug/application loggers; the container access log records no query string per `docs/PRIVACY.md`).
- Only `/api/auth/atlassian/login` and `/api/auth/atlassian/callback` may redirect under `/api/`; `tests/test_endpoint_policy_inventory.py` is not edited.
- No analytics event; one no-event row in `docs/README_ANALYTICS.md`.
- Do not edit `docs/ontology.md` line 3; date only the touched section's `Verified on`.
- Commits use the repository's noreply identity and carry no agent attribution. No committed file contains a local absolute path.
- D7 behavior is documented, not tested: this plan claims no test coverage for follower release.

## Review Focus

- **Re-consent cancelled with an incomplete grant:** the retry must keep forced consent, or the user can cycle through plain sign-ins. Pinned in Task 1 (`test_sign_in_incomplete_with_an_incomplete_grant_keeps_forced_consent`).
- **Cookie naming a deleted or a revoked DB browser session:** `/login?reason=sign_in_incomplete` renders the card, not a loop. Pinned in Task 1 (`test_sign_in_incomplete_with_a_deleted_browser_row_renders_the_card`, `..._with_a_revoked_connection_renders_the_card`).
- **Hostile callback query:** the `Location` is exactly the constant and neither the redirect nor the page echoes any query value. Pinned in Task 2 (`test_rejected_callback_location_is_constant_and_echoes_nothing`).
- **Signed-in browser fixture masking a rejection:** a browser with a valid earlier session follows a rejected callback through `/login` to `/`, so fixtures must assert the callback response itself. Pinned in Task 2 (fixture asserts `302` to exactly `/`) and the two lifecycle cases.
- **A rejected callback while another browser is signed in:** both browsers' rows survive. Pinned by the updated `DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows`.

---

### Task 0: Runtime setup (no commit)

The worktree has no `.venv`, the default `node` may not be 20.x, and the isolated runner refuses a stale `frontend/dist` before collecting tests. Every later command assumes this shell.

- [ ] **Step 1: Select Python.** Set `PY` to a verified Python 3.10+ interpreter with `requirements.txt` and `pip install -e .` applied (the main checkout's `.venv/bin/python` qualifies; never system Python), and `export JEP_TEST_PYTHON="$PY"` for the browser fixtures. Check: `"$PY" -c 'import flask, sqlalchemy; print("ok")'` prints `ok`.
- [ ] **Step 2: Select Node 20.** `export PATH="$(brew --prefix node@20)/bin:$PATH"` (or the repo's pinned manager). Check: `node --version` prints `v20.`.
- [ ] **Step 3: PostgreSQL tools.** Check: `command -v initdb pg_ctl createdb` prints three paths (or set `JEP_TEST_PG_BIN`).
- [ ] **Step 4: Build.** `npm ci && npm run build`. Check: `npm run build` exits 0. Rebuild after any pull that touches `frontend/src` or `package-lock.json`.

Backend commands below use `RUN="$PY tests/run_isolated_runtime_tests.py --node $(command -v node)"`, written as `$RUN <ids>`.

### Task 1: `/login` renders the `sign_in_incomplete` reason

**Files:**
- Modify: `backend/routes/auth_routes.py` (`auth_entry_page`: the `except AuthError` capture and the `message` / `login_url` branch)
- Test: `tests/test_auth_routes.py` (`TestAuthRoutes`)

**Interfaces:**
- Consumes: existing `auth_entry_page` forwarding (`db_oauth_browser_session_data`, `current_request_auth_context`, `pop_share_view_target`); test helpers `_oauth_flow`, `_prime_callback`, `_fresh_stash`, `_stash`, `SHARE_LINK`, `PENDING_VIEW_KEY`, `install_oauth_session(client, scope=...)`, `forbid_jira_http`, `models`, `db_engine`, `invalidate_auth_status_cache`.
- Produces: `GET /login?reason=sign_in_incomplete` → `302` to `pop_share_view_target(session)` with a valid session; else `200` card with the notice and the plain link, or the consent link for `missing_oauth_scope`. Module-level test constant `NOTICE`. Task 2 redirects here.

- [ ] **Step 1: Write the failing tests** (module-level `NOTICE`):

```python
NOTICE = ('Your sign-in did not finish, for example because the page was reloaded '
          'or sign-in was started again in another tab. Sign in again to continue.')
PLAIN = 'href="/api/auth/atlassian/login"'
CONSENT = 'href="/api/auth/atlassian/login?prompt=consent"'

def test_sign_in_incomplete_entry_page_shows_the_notice(self):
    # no session: 200, '<p class="auth-notice" role="status">' + NOTICE + '</p>' in body, PLAIN in body, 'prompt=consent' not in body

def test_sign_in_incomplete_forwards_a_signed_in_browser_to_its_share_view(self):
    # forbid_jira_http; sign in through the real callback (pattern of
    # test_callback_redirects_to_the_stashed_share_view_and_pops_it); put _fresh_stash(SHARE_LINK) back.
    # GET /login?reason=sign_in_incomplete -> (302, '/?' + SHARE_LINK); _stash() is None;
    # a second GET of the same URL -> (302, '/') (consumed exactly once)

def test_sign_in_incomplete_with_an_incomplete_grant_keeps_forced_consent(self):
    payload = install_oauth_session(self.client, scope='read:me read:jira-work read:jira-user offline_access')
    # put a fresh stash; GET /login?reason=sign_in_incomplete under _oauth_flow()
    # -> 200, NOTICE in body, CONSENT in body, PLAIN not in body, _stash() unchanged

def test_plain_entry_page_with_an_incomplete_grant_keeps_the_plain_link(self):
    # same grant; GET /login (no reason) -> 200, PLAIN in body, 'prompt=consent' not in body (D8 scope pin)

def test_sign_in_incomplete_with_a_deleted_browser_row_renders_the_card(self):
    payload = install_oauth_session(self.client)
    # with db_engine.session_scope() as s: s.delete(s.get(models.BrowserSession, payload['db_browser_session_id']))
    # invalidate_auth_status_cache(); put a fresh stash
    # GET /login?reason=sign_in_incomplete -> 200, NOTICE, PLAIN, stash unchanged

def test_sign_in_incomplete_with_a_revoked_connection_renders_the_card(self):
    payload = install_oauth_session(self.client)
    # set the AuthConnection behind that BrowserSession to status='revoked' (pattern: test_db_oauth_cutover.py
    # connection.status loop); invalidate_auth_status_cache(); put a fresh stash
    # GET /login?reason=sign_in_incomplete -> 200, NOTICE, PLAIN, stash unchanged
```

Write each body in full with the named helpers; comments state the exact assertions.

- [ ] **Step 2: Run to verify they fail**

Run: `$RUN tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_entry_page_shows_the_notice tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_forwards_a_signed_in_browser_to_its_share_view tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_with_an_incomplete_grant_keeps_forced_consent tests.test_auth_routes.TestAuthRoutes.test_plain_entry_page_with_an_incomplete_grant_keeps_the_plain_link tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_with_a_deleted_browser_row_renders_the_card tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_with_a_revoked_connection_renders_the_card`
Expected: the four notice/consent tests FAIL (`NOTICE` or `CONSENT` absent). The forwarding test and the plain-link pin already pass; keep them as contract pins.

- [ ] **Step 3: Implement** in `auth_entry_page`: bind the caught error (`except AuthError as error:`) to a local `validation_error_code` (initially `None`); add `elif recovery_reason == 'sign_in_incomplete':` setting `message` to the `.auth-notice` paragraph with the Global Constraints copy, and `login_url = '/api/auth/atlassian/login?prompt=consent'` only when `validation_error_code == 'missing_oauth_scope'`. The terminal set and the other branches are unchanged.

- [ ] **Step 4: Run to verify they pass**, plus the neighbours that pin `/login`

Run: the Step 2 command, then `$RUN tests.test_auth_routes.TestAuthRoutes.test_missing_scope_entry_page_forces_consent tests.test_auth_routes.TestAuthRoutes.test_status_requires_reconsent_when_db_connection_has_old_scopes`
Expected: all PASS.

- [ ] **Step 5: Commit** `backend/routes/auth_routes.py` and `tests/test_auth_routes.py`: "Show a notice when an Atlassian sign-in did not finish".

### Task 2: Pre-exchange callback failures redirect to the sign-in page

**Files:**
- Modify: `backend/routes/auth_routes.py` (`api_atlassian_callback`, the four early `return jsonify(...)` lines; module constant `SIGN_IN_INCOMPLETE_URL`)
- Modify tests: `tests/test_auth_routes.py` (`test_callback_rejects_invalid_state`, `test_failed_callback_keeps_the_stash_and_a_retry_applies_it`, `test_full_login_return_chain_applies_the_link_once`, plus the new tests below), `tests/test_db_oauth_cutover.py` (`DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows`, `DbOauthCutoverTests.test_callback_failures_retain_the_pending_share_view_for_a_retry`, helper `_store_callback_through_route`), `tests/test_epm_home_scope_request.py` (the `status_code == 302` assertions after `callback_with`)
- Modify fixture: `tests/ui/db_oauth_fixture.js` (`login(page, actor)` and `createContext(browser, actor)`)
- Modify spec: `tests/ui/db_oauth_lifecycle.spec.js` (two new cases)
- Retained unchanged: `tests/test_endpoint_policy_inventory.py`, `tests/test_logging_migration.py`

**Interfaces:**
- Consumes: Task 1's `/login?reason=sign_in_incomplete` behavior and `NOTICE`.
- Produces: `GET /api/auth/atlassian/callback` with any pre-exchange failure → `302 Location: /login?reason=sign_in_incomplete`; the pending pair is popped; DB rows and stash untouched by that response. Module-level test constants `REJECTED`, `PRE_EXCHANGE_FAILURES`.

- [ ] **Step 1: Update the existing assertions** from `400` + JSON `error` to `302` + `Location == REJECTED`. In table-driven tests, give each case tuple an explicit expected-`Location` column (`None` for rows that keep a JSON body) and branch on it; never call `response.get_json()['error']` on a `302` (it returns `None`).
  - `test_callback_rejects_invalid_state`: keep the two `assertNotIn` lines.
  - `test_failed_callback_keeps_the_stash_and_a_retry_applies_it`: `invalid_state`, `authorization_denied`, `missing_code` rows and the `missing_verifier` subtest; `failed_exchange` stays `401 auth_required`; stash assertions and the final retry unchanged.
  - `test_full_login_return_chain_applies_the_link_once`: `repeated` becomes `(302, REJECTED)`.
  - Both `DbOauthCutoverTests` methods: `302` and `REJECTED`; every row/`authenticated`/stash assertion unchanged.
  - `_store_callback_through_route` and the `tests/test_epm_home_scope_request.py` callers: beside each `status_code == 302` assertion add `self.assertEqual(response.headers['Location'], '/')` (these flows carry no stash).

- [ ] **Step 2: Harden the browser fixture** in `tests/ui/db_oauth_fixture.js`:
  - `createContext`: throw `Synthetic OAuth callback failed.` unless `response.status() === 302 && response.headers().location === '/'` (a fresh context has no stash, so the target is exactly `/`).
  - `login(page, actor)`: capture the navigation response of `page.goto(syntheticProvider.href)`, walk `response.request().redirectedFrom()` to the request whose URL path is `/api/auth/atlassian/callback`, and throw the same error unless its `response()` has status `302` and `location` header exactly `/`. A final-path check alone is not sufficient: a browser with a valid earlier session reaches `/` through a rejection.

- [ ] **Step 3: Write the new failing tests** in `TestAuthRoutes`:

```python
REJECTED = '/login?reason=sign_in_incomplete'
PRE_EXCHANGE_FAILURES = (  # (name, url, prime_pending_pair, pop_verifier)
    ('state_mismatch',           '/api/auth/atlassian/callback?state=wrong&code=abc',                  True,  False),
    ('state_missing_in_session', '/api/auth/atlassian/callback?state=state-123&code=abc',              False, False),
    ('state_missing_in_query',   '/api/auth/atlassian/callback?code=abc',                              True,  False),
    ('provider_error',           '/api/auth/atlassian/callback?state=state-123&code=abc&error=access_denied', True, False),
    ('missing_code',             '/api/auth/atlassian/callback?state=state-123',                       True,  False),
    ('missing_verifier',         '/api/auth/atlassian/callback?state=state-123&code=abc',              True,  True),
)

def test_pre_exchange_callback_failures_never_reach_the_exchange(self):
    # per row, in a subTest: prime the pair (or clear it) and pop the verifier as the row says; put a fresh stash.
    # Patch through _oauth_flow(...) each of exchange_authorization_code, fetch_current_user,
    # fetch_accessible_resources, validate_auth_config, validate_local_token_store_allowed,
    # store_db_oauth_callback_session_metadata with Mock(side_effect=AssertionError(...)).
    # Assert (302, REJECTED); every mock assert_not_called(); 'oauth_state' and 'oauth_pkce_verifier'
    # absent; stash unchanged; 'db_oauth_session' absent (never created).
    # provider_error carries a nominal code, proving denial wins over the exchange.

def test_mismatched_callback_with_a_valid_session_returns_to_the_dashboard(self):
    # forbid_jira_http; sign in through the real callback; prime state-456/verifier-456 and a fresh stash.
    # GET callback?state=wrong&code=abc with exchange patched to fail -> (302, REJECTED);
    # stash still equal right after the callback; GET REJECTED -> (302, '/?' + SHARE_LINK);
    # stash None; GET REJECTED again -> (302, '/') (consumed once)

def test_mismatched_callback_without_a_session_lands_on_the_sign_in_page(self):
    # _prime_callback(fresh stash); exchange patched to fail; callback?state=wrong&code=abc -> (302, REJECTED);
    # GET REJECTED -> 200, NOTICE in body; stash unchanged

def test_replayed_callback_after_sign_in_returns_to_the_dashboard(self):
    # real chain: entry '/?' + SHARE_LINK -> /login -> login -> callback (302 '/?' + SHARE_LINK);
    # replay the same callback URL -> (302, REJECTED); GET REJECTED -> (302, '/')

def test_rejected_callback_location_is_constant_and_echoes_nothing(self):
    # _prime_callback(); GET '/api/auth/atlassian/callback?state=wrong-7f3a&code=code-9c1e'
    #   '&error=%3Cscript%3E&error_description=leak-5b2d&next=//evil.example'
    # Location == REJECTED; for each of 'wrong-7f3a', 'code-9c1e', '<script>', 'leak-5b2d', 'evil.example':
    # not in the callback body and not in the GET REJECTED page body
```

Import `Mock` from `unittest.mock`. Write every body in full.

- [ ] **Step 4: Write the two lifecycle cases** in `tests/ui/db_oauth_lifecycle.spec.js` (Chromium, owned synthetic server):
  - `rejected callback returns a signed-in browser to the dashboard`: `server.createContext(browser, 'actor-a')`; `context.request.get(baseUrl + '/api/auth/atlassian/callback?state=stale&code=synthetic', { maxRedirects: 0 })` → status `302`, `location` `/login?reason=sign_in_incomplete`; then a page `goto` of the same URL → final pathname `/` and `/api/auth/status` reports `authenticated: true`.
  - `rejected callback shows the sign-in notice to a signed-out browser`: a fresh `browser.newContext()`; the same request → `302` to the same `location`; a page `goto` → final URL `/login?reason=sign_in_incomplete`, the notice text visible, the sign-in link `href` `/api/auth/atlassian/login`. Capture this card and a plain `/login` card as synthetic screenshots for the PR notes (`page.screenshot` after `document.fonts.ready`; the page has no animation); do not commit them unless the operator asks.

- [ ] **Step 5: Run to verify they fail**

Run: `$RUN tests.test_auth_routes tests.test_db_oauth_cutover.DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows tests.test_db_oauth_cutover.DbOauthCutoverTests.test_callback_failures_retain_the_pending_share_view_for_a_retry`, then `npm run test:frontend:ui -- db_oauth_lifecycle.spec.js --grep 'rejected callback'`
Expected: the updated and new rejection tests FAIL (`400 != 302`, or `KeyError: 'Location'`); both lifecycle cases FAIL on the `302`; everything else passes.

- [ ] **Step 6: Replace the four early returns** in `api_atlassian_callback` with `return redirect(SIGN_IN_INCOMPLETE_URL)`, `SIGN_IN_INCOMPLETE_URL = '/login?reason=sign_in_incomplete'` a module constant. Keep the two `session.pop` lines first and the check order (state, `error`, `code`, verifier) unchanged.

- [ ] **Step 7: Run to verify they pass**, plus the retained guards and the fixture consumers

Run: the Step 5 backend command; `$RUN tests.test_endpoint_policy_inventory tests.test_logging_migration tests.test_db_oauth_cutover tests.test_epm_home_scope_request`; `npm run test:frontend:ui -- db_oauth_lifecycle.spec.js planning_shared_plan.spec.js planning_shared_plan_http.spec.js` (consumers of `createContext` and `login`).
Expected: all PASS, including the unchanged `test_callback_redirects_to_the_stashed_share_view_and_pops_it`, `test_callback_without_a_stash_redirects_to_root`, `test_callback_stores_encrypted_tokens_and_only_opaque_cookie`, `test_post_exchange_callback_failure_deletes_only_current_browser_row`, `test_only_navigation_auth_api_routes_redirect` and the filter pin `test_werkzeug_logs_redact_oauth_callback_query`.

- [ ] **Step 8: Commit** the route, the three Python test files, the fixture and the lifecycle spec: "Redirect rejected OAuth callbacks to the sign-in page". Record Task 1's commit and its Step 4 result in the Execution Status table in this commit.

### Task 3: Documentation

**Files:**
- Modify: `docs/SUPPORT-atlassian-oauth-setup.md` ("Common Errors", the `invalid_oauth_state` entry)
- Modify: `docs/ontology.md` ("Connection Recovery": the **Authentication recovery** bullet and that section's `Verified on`)
- Modify: `docs/README_ANALYTICS.md` (the "Feature action | Primary anchors | Reason | Reviewed on" no-event table)
- Modify: `docs/plans/SUPPORT-multi-device-browser-sessions-design.md` (the `/api/auth/atlassian/callback` endpoint-matrix row and the "callback failure split" sentence)
- Modify: this plan (Execution Status)

- [ ] **Step 1: Setup guide.** Replace the `invalid_oauth_state` entry with the new behavior: in a healthy DB/OAuth runtime a rejected callback shows the sign-in notice ("Your sign-in did not finish...") or returns a signed-in browser to the dashboard; after a cancelled re-consent the card asks for consent again. Keep the four causes. Advise restarting in one tab: a second sign-in tab can leave both attempts needing a restart; two sequential starts in one tab are fine. Back navigation into the Atlassian page after a successful sign-in returns to the dashboard.

- [ ] **Step 2: Ontology.** Append to the **Authentication recovery** bullet: "A pre-exchange OAuth callback failure (`api_atlassian_callback` in `backend/routes/auth_routes.py`) redirects to the constant `/login?reason=sign_in_incomplete`; `auth_entry_page` forwards a valid DB browser session to `pop_share_view_target`, otherwise shows the notice with the plain link, or the consent link when validation raised `missing_oauth_scope`, keeping the share-view stash. Contracts: the callback cases in `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py` and `tests/ui/db_oauth_lifecycle.spec.js`." Set the section's `Verified on` to the execution date. Leave line 3 untouched.

- [ ] **Step 3: Analytics row** in the "Feature action" no-event table (no-event decisions for user-visible feature changes; the "Allowlist" table is for state-changing routes, and this change adds none): `| Rejected OAuth callback recovery | `backend/routes/auth_routes.py` (`api_atlassian_callback`, `auth_entry_page`) | Server navigation only: trigger none; `event_type=none`; canonical `event_name=none`; `feature_name=auth`; typed params none. The callback and `/login` render without GTM; a forwarded browser's existing `login` event stays once per tab session. No state, code, provider error or URL may be sent. No GA4 runbook change. | <execution date> |`

- [ ] **Step 4: Multi-device contract.** In the matrix row for `/api/auth/atlassian/callback`, add `302 /login?reason=sign_in_incomplete` for pre-exchange validation failures to the failure/recovery column; in the "callback failure split" paragraph, say those failures redirect instead of returning sanitized `400`s and their callback response still leaves every browser row intact. Historical `DONE-*` and legacy spec files stay as audit context.

- [ ] **Step 5: Learnings guard.** Run: `$RUN tests.test_agents_md_learnings`. Expected: PASS.

- [ ] **Step 6: Commit** the four docs and this plan: "Document OAuth callback recovery". Record Task 2's commit and its Step 7 result in the Execution Status table in this commit.

### Task 4: Finalization and publication gate (only when the operator asks to publish)

- [ ] **Step 1: Base check.** `git fetch origin main`; if `origin/main` is no longer `30d0923b`, stop and ask the operator whether to rebase; record the base actually used.
- [ ] **Step 2: Verify.** `npm run build`, then `make verify ARGS=--no-deadline`, the full delivery check documented in `README.md` ("Verification") and requested by the operator for this work on 2026-11-24. Read the result ledger under `tmp/verification/`. Expected: every stage passes; report any overrun of the 600-second target as measured.
- [ ] **Step 3: Finalization commit** ("Mark OAuth stale callback recovery plan done"), one commit containing: `git mv` of this plan to `DONE-oauth-stale-callback-recovery.md`; its `> **Status:**` set to done naming the branch and head commit before this one; an `## Outcome` and a `## Current Accuracy` section; Task 3's commit and the Step 2 result in Execution Status; the design's `> **Status:**` changed from draft to implemented with the new plan link; and every link to the old name updated (`rg -l 'EXEC-oauth-stale-callback-recovery' .` must print nothing afterwards, `docs/plans/README.md` included). Check `git show --stat HEAD` shows the rename with content changes.
- [ ] **Step 4: Scope check** against the recorded base, per root `AGENTS.md` section 10. Expected history, 7 commits: the two planning commits, the plan-revision commit, Task 1, Task 2, Task 3 and the finalization commit. Expected paths, exactly: `backend/routes/auth_routes.py`, `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py`, `tests/test_epm_home_scope_request.py`, `tests/ui/db_oauth_fixture.js`, `tests/ui/db_oauth_lifecycle.spec.js`, `docs/SUPPORT-atlassian-oauth-setup.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, `docs/plans/SUPPORT-multi-device-browser-sessions-design.md`, `docs/plans/SUPPORT-oauth-stale-callback-recovery-design.md`, `docs/plans/DONE-oauth-stale-callback-recovery.md`. Any difference: stop and ask. Execution Status updates ride in the next task's commit; there are no status-only commits.
- [ ] **Step 5: Publish** only after explicit operator confirmation, following the rest of the section 10 transaction (stdin PR body, remote head and rendered-body checks, CI state), with the synthetic screenshots from Task 2 Step 4 in the PR notes.

## Execution Status

| Task | State | Commit | Verification |
| --- | --- | --- | --- |
| 0 | not started | none (setup) | |
| 1 | not started | | |
| 2 | not started | | |
| 3 | not started | | |
| 4 | not started | | |
