# OAuth stale callback recovery Implementation Plan

> **Status:** Planned 2026-11-24 against `origin/main` `3c2d3186`; not executed. Implements decision D4 option 1 (keep a single pending login) and D7 option 1 (accept follower release without a new sign-in) unless the operator chooses otherwise before execution.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stale, replayed, superseded, denied or truncated Atlassian OAuth callback ends on the dashboard (when the browser is already signed in) or on the sign-in page with a notice, never on a raw JSON page, and never exchanges a code whose state did not match.

**Architecture:** `api_atlassian_callback` keeps its validation order and its pop of `oauth_state` / `oauth_pkce_verifier`, but each of its four pre-exchange failures returns one constant `302` to `/login?reason=sign_in_incomplete`. `auth_entry_page` learns that non-terminal reason: it already forwards a valid DB browser session to `pop_share_view_target(session)`, and otherwise it renders the existing card with a new `.auth-notice` copy. Post-exchange failures are unchanged.

**Tech Stack:** Python 3.10+, Flask, `unittest` through `tests/run_isolated_runtime_tests.py` on the runner's owned PostgreSQL cluster.

**Spec:** [SUPPORT-oauth-stale-callback-recovery-design.md](SUPPORT-oauth-stale-callback-recovery-design.md)

## Global Constraints

- Redirect target, verbatim: `/login?reason=sign_in_incomplete`. It is a constant; nothing from the callback query is copied into it.
- Notice copy, verbatim: `Your sign-in did not finish, for example because the page was reloaded or sign-in was started again in another tab. Sign in again to continue.`
- The notice uses the existing `<p class="auth-notice" role="status">` element; the sign-in link stays `/api/auth/atlassian/login` (no `prompt=consent`).
- `sign_in_incomplete` is non-terminal: it is not added to the `{'session_expired', 'missing_scope'}` set in `auth_entry_page`.
- The four pre-exchange failures (state missing or different, provider `error`, missing `code`, missing verifier) never call `validate_auth_config`, `exchange_authorization_code`, `fetch_current_user`, `fetch_accessible_resources` or `store_db_oauth_callback_session_metadata`, never delete a browser session, and never touch the share-view stash.
- Post-exchange failures and configuration errors keep their current status codes and JSON bodies.
- No change to `api_atlassian_login`, cookie attributes, `frontend/src/api/authRequired.js` (`VALID_REASONS`), `AuthRequiredGate.jsx` or `authRecoveryCoordinator.js`.
- No new log line; `state`, `code`, `error` and `error_description` values never appear in a response, page, log, database row or URL.
- Only `/api/auth/atlassian/login` and `/api/auth/atlassian/callback` may redirect under `/api/`; `tests/test_endpoint_policy_inventory.py` is not edited.
- No analytics event; one no-event row in `docs/README_ANALYTICS.md`.
- Do not edit `docs/ontology.md` line 3; date only the touched section's `Verified on`.
- Commits use the repository's noreply identity and carry no agent attribution.

## Review Focus

- **Replay after success with a stashed share view already consumed:** the second callback must land on `/` (stash gone), not on a sign-in page. Pinned in Task 2 (`test_replayed_callback_after_sign_in_returns_to_the_dashboard`).
- **Browser cookie carrying an expired or revoked DB browser session:** `/login?reason=sign_in_incomplete` must render the card, not loop back to the callback or to `/`. Pinned in Task 1 (`test_sign_in_incomplete_with_an_invalid_session_renders_the_card`).
- **Hostile callback query (`state=wrong&code=x&error=<script>&error_description=...&next=//evil.example`):** the `Location` is exactly the constant and the rendered page contains none of the query values. Pinned in Task 2 (`test_rejected_callback_location_is_constant_and_echoes_nothing`).
- **A mismatched callback while another browser is signed in:** the other browser's row and the current one survive. Pinned in Task 2 by the updated `DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows`.
- **Request log of a rejected callback:** the Werkzeug line stays redacted. Pinned by the retained `test_werkzeug_logs_redact_oauth_callback_query`, run in Task 2; it is a filter pin (it logs a hand-written callback line), and the route adds no log line of its own.

---

### Task 1: `/login` renders the `sign_in_incomplete` reason

**Files:**
- Modify: `backend/routes/auth_routes.py` (`auth_entry_page`, the `message` branch only)
- Test: `tests/test_auth_routes.py` (`TestAuthRoutes`)

**Interfaces:**
- Consumes: existing `auth_entry_page` forwarding (`db_oauth_browser_session_data`, `current_request_auth_context`, `pop_share_view_target`).
- Produces: `GET /login?reason=sign_in_incomplete` → `302` to `pop_share_view_target(session)` with a valid session, else `200` sign-in card containing the notice copy. Task 2 redirects here.

- [ ] **Step 1: Write the failing tests** in `TestAuthRoutes` (module-level `NOTICE` constant), reusing `_oauth_flow`, `_prime_callback`, `_fresh_stash`, `_stash`, `SHARE_LINK` and `install_oauth_session`:

```python
NOTICE = ('Your sign-in did not finish, for example because the page was reloaded '
          'or sign-in was started again in another tab. Sign in again to continue.')

def test_sign_in_incomplete_entry_page_shows_the_notice(self):
    with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
        response = self.client.get('/login?reason=sign_in_incomplete')
    body = response.get_data(as_text=True)
    self.assertEqual(response.status_code, 200)
    self.assertIn('<p class="auth-notice" role="status">' + NOTICE + '</p>', body)
    self.assertIn('href="/api/auth/atlassian/login"', body)
    self.assertNotIn('prompt=consent', body)

def test_sign_in_incomplete_forwards_a_signed_in_browser_to_its_share_view(self):
    # Sign in through the real callback, then put a fresh stash back and visit the reason page.
    ...  # _prime_callback(); with _oauth_flow(): callback -> 302
    ...  # session_transaction: flask_session[PENDING_VIEW_KEY] = _fresh_stash(SHARE_LINK)
    with self._oauth_flow():
        response = self.client.get('/login?reason=sign_in_incomplete')
    self.assertEqual((response.status_code, response.headers['Location']), (302, '/?' + self.SHARE_LINK))
    self.assertIsNone(self._stash())

def test_sign_in_incomplete_with_an_invalid_session_renders_the_card(self):
    # A cookie that names a browser session the database does not hold.
    with self.client.session_transaction() as flask_session:
        flask_session['db_oauth_session'] = {'db_browser_session_id': '00000000-0000-4000-8000-000000000000'}
        flask_session[self.PENDING_VIEW_KEY] = stash = self._fresh_stash(self.SHARE_LINK)
    with self._oauth_flow():
        response = self.client.get('/login?reason=sign_in_incomplete')
    self.assertEqual(response.status_code, 200)
    self.assertIn(NOTICE, response.get_data(as_text=True))
    self.assertEqual(self._stash(), stash)
```

The `...` lines in the second test are the existing sign-in pattern from `test_callback_redirects_to_the_stashed_share_view_and_pops_it`; call `forbid_jira_http(self)` first, as that test does.

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_entry_page_shows_the_notice tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_forwards_a_signed_in_browser_to_its_share_view tests.test_auth_routes.TestAuthRoutes.test_sign_in_incomplete_with_an_invalid_session_renders_the_card`
Expected: the notice tests FAIL (copy absent); the forwarding test already passes, because `/login` forwards any non-terminal reason. Keep it as the contract pin.

- [ ] **Step 3: Add the `sign_in_incomplete` branch** in `auth_entry_page`: `elif recovery_reason == 'sign_in_incomplete':` sets `message` to the `.auth-notice` paragraph with the Global Constraints copy; `login_url` stays `/api/auth/atlassian/login`; the terminal set is unchanged.

- [ ] **Step 4: Run to verify they pass**, plus the neighbours that pin `/login`

Run: the Step 2 command, then `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_auth_routes.TestAuthRoutes.test_missing_scope_entry_page_forces_consent`
Expected: all PASS.

- [ ] **Step 4b: Visual proof.** With a local server on a worktree port (never 5050) and no session, capture `/login` and `/login?reason=sign_in_incomplete` in Chromium after animations settle; the second differs only by the notice paragraph, same card width and link. Keep the two synthetic screenshots for the PR notes (no live data).

- [ ] **Step 5: Commit** `backend/routes/auth_routes.py` and `tests/test_auth_routes.py`: "Show a notice when an Atlassian sign-in did not finish". Record the commit and the Step 4 result in the Execution Status table.

### Task 2: Pre-exchange callback failures redirect to the sign-in page

**Files:**
- Modify: `backend/routes/auth_routes.py` (`api_atlassian_callback`, the four early `return jsonify(...)` lines)
- Modify tests: `tests/test_auth_routes.py` (`test_callback_rejects_invalid_state`, `test_failed_callback_keeps_the_stash_and_a_retry_applies_it`, `test_full_login_return_chain_applies_the_link_once`), `tests/test_db_oauth_cutover.py` (`DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows`, `DbOauthCutoverTests.test_callback_failures_retain_the_pending_share_view_for_a_retry`)
- Modify helpers: `tests/test_db_oauth_cutover.py` (`_store_callback_through_route`), `tests/test_epm_home_scope_request.py` (the callers of `callback_with`)
- Modify fixture: `tests/ui/db_oauth_fixture.js` (`createContext`: the `if (response.status() !== 302)` callback check)
- Retained unchanged: `tests/test_endpoint_policy_inventory.py`, `tests/test_logging_migration.py`

**Interfaces:**
- Consumes: Task 1's `/login?reason=sign_in_incomplete` behavior.
- Produces: `GET /api/auth/atlassian/callback` with any pre-exchange failure → `302 Location: /login?reason=sign_in_incomplete`; the pending pair is popped; DB rows and stash untouched.

- [ ] **Step 1: Update the existing assertions** from `400` + JSON `error` to `302` + `Location == '/login?reason=sign_in_incomplete'`. In the table-driven tests, give each case tuple an explicit expected-`Location` column (`None` for rows that keep a JSON body) and branch the assertion on it; never call `response.get_json()['error']` on a `302`, which returns `None`:
  - `test_callback_rejects_invalid_state`: keep the two `assertNotIn` lines (pending pair popped).
  - `test_failed_callback_keeps_the_stash_and_a_retry_applies_it`: the `invalid_state`, `authorization_denied`, `missing_code` rows and the `missing_verifier` subtest; the `failed_exchange` row stays `401 auth_required`; stash assertions and the final retry unchanged.
  - `test_full_login_return_chain_applies_the_link_once`: `repeated` becomes `(302, '/login?reason=sign_in_incomplete')`.
  - Both `DbOauthCutoverTests` methods: `302` and that `Location`; every row/`authenticated`/stash assertion unchanged.
  - `_store_callback_through_route` and the `callback_with` callers in `tests/test_epm_home_scope_request.py` assert only `status_code == 302`, which a rejected callback now also returns. Add `self.assertNotEqual(response.headers['Location'], '/login?reason=sign_in_incomplete')` beside each such status assertion.
  - `tests/ui/db_oauth_fixture.js`: a rejected callback is now also a `302`, so the synthetic sign-in must fail loudly on it. Change the check to throw `Synthetic OAuth callback failed.` when the status is not `302` **or** `response.headers().location` is not `/` and does not start with `/?`. In `login(page)`, after the routed navigation settles, throw the same error when `new URL(page.url()).pathname === '/login'`.

- [ ] **Step 2: Write the new failing tests** in `TestAuthRoutes`:

```python
# module-level, beside NOTICE from Task 1
REJECTED = '/login?reason=sign_in_incomplete'
PRE_EXCHANGE_FAILURES = (
    ('state_mismatch', '/api/auth/atlassian/callback?state=wrong&code=abc', True),
    ('state_missing_in_session', '/api/auth/atlassian/callback?state=state-123&code=abc', False),
    ('provider_error', '/api/auth/atlassian/callback?state=state-123&error=access_denied', True),
    ('missing_code', '/api/auth/atlassian/callback?state=state-123', True),
)  # third field: prime the pending pair; missing verifier is a separate subtest that pops it

def test_pre_exchange_callback_failures_never_reach_the_exchange(self):
    forbidden = AssertionError('pre-exchange failure reached the provider')
    for name, url, primed in PRE_EXCHANGE_FAILURES (+ missing_verifier):
        with self.subTest(failure=name):
            # prime or clear the pending pair as the row says
            # prime a fresh stash and record the db_oauth_session value (absent here) before the request
            with self._oauth_flow(exchange_authorization_code=Mock(side_effect=forbidden),
                                  fetch_current_user=Mock(side_effect=forbidden),
                                  fetch_accessible_resources=Mock(side_effect=forbidden),
                                  validate_auth_config=Mock(side_effect=forbidden),
                                  validate_local_token_store_allowed=Mock(side_effect=forbidden),
                                  store_db_oauth_callback_session_metadata=Mock(side_effect=forbidden)):
                response = self.client.get(url)
            self.assertEqual((response.status_code, response.headers['Location']), (302, REJECTED))
            # each Mock: assert_not_called(); stash and db_oauth_session equal their recorded values
            with self.client.session_transaction() as flask_session:
                self.assertNotIn('oauth_state', flask_session)
                self.assertNotIn('oauth_pkce_verifier', flask_session)

def test_mismatched_callback_with_a_valid_session_returns_to_the_dashboard(self):
    forbid_jira_http(self)
    # sign in through the real callback (Task 1 pattern), then prime a new pending pair
    with self.client.session_transaction() as flask_session:
        flask_session['oauth_state'] = 'state-456'
        flask_session['oauth_pkce_verifier'] = 'verifier-456'
    with self._oauth_flow(exchange_authorization_code=Mock(side_effect=AssertionError('no exchange'))):
        rejected = self.client.get('/api/auth/atlassian/callback?state=wrong&code=abc')
        landing = self.client.get(rejected.headers['Location'])
    self.assertEqual(rejected.headers['Location'], REJECTED)
    self.assertEqual((landing.status_code, landing.headers['Location']), (302, '/'))

def test_mismatched_callback_without_a_session_lands_on_the_sign_in_page(self):
    self._prime_callback(stash := self._fresh_stash(self.SHARE_LINK))
    with self._oauth_flow(exchange_authorization_code=Mock(side_effect=AssertionError('no exchange'))):
        rejected = self.client.get('/api/auth/atlassian/callback?state=wrong&code=abc')
        landing = self.client.get(rejected.headers['Location'])
    self.assertEqual(rejected.headers['Location'], REJECTED)
    self.assertEqual(landing.status_code, 200)
    self.assertIn(NOTICE, landing.get_data(as_text=True))
    self.assertEqual(self._stash(), stash)

def test_replayed_callback_after_sign_in_returns_to_the_dashboard(self):
    # Real chain: entry with SHARE_LINK -> /login -> login -> callback (302 to /?SHARE_LINK),
    # then replay the same callback URL.
    self.assertEqual(replay.headers['Location'], REJECTED)
    self.assertEqual(self.client.get(REJECTED).headers['Location'], '/')  # stash already consumed

def test_rejected_callback_location_is_constant_and_echoes_nothing(self):
    self._prime_callback()
    hostile = ('/api/auth/atlassian/callback?state=wrong-7f3a&code=code-9c1e'
               '&error=%3Cscript%3E&error_description=leak-5b2d&next=//evil.example')
    with self._oauth_flow():
        rejected = self.client.get(hostile)
        page = self.client.get(rejected.headers['Location']).get_data(as_text=True)
    self.assertEqual(rejected.headers['Location'], REJECTED)
    for value in ('wrong-7f3a', 'code-9c1e', '<script>', 'leak-5b2d', 'evil.example'):
        self.assertNotIn(value, rejected.get_data(as_text=True))
        self.assertNotIn(value, page)
```

Import `Mock` from `unittest.mock`. Write the elided sign-in lines in full with the existing helpers; the pseudo-loop in the first test becomes a real loop with a `missing_verifier` subtest that primes the state and pops the verifier, as the existing `missing_verifier` subtest does.

- [ ] **Step 3: Run to verify they fail**

Run: `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_auth_routes tests.test_db_oauth_cutover.DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows tests.test_db_oauth_cutover.DbOauthCutoverTests.test_callback_failures_retain_the_pending_share_view_for_a_retry`
Expected: the updated and new rejection tests FAIL (status `400 != 302`, or `KeyError: 'Location'` where a test reads the header first); everything else passes.

- [ ] **Step 4: Replace the four early returns** in `api_atlassian_callback` with `return redirect(SIGN_IN_INCOMPLETE_URL)`, where `SIGN_IN_INCOMPLETE_URL = '/login?reason=sign_in_incomplete'` is a module constant in `backend/routes/auth_routes.py`. Keep the two `session.pop` lines first and the check order (state, `error`, `code`, verifier) unchanged.

- [ ] **Step 5: Run to verify they pass**, plus the retained guards and the happy path

Run: the Step 3 command, then `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_endpoint_policy_inventory tests.test_logging_migration tests.test_db_oauth_cutover tests.test_epm_home_scope_request`
and `npm run build && npm run test:frontend:ui -- db_oauth_lifecycle.spec.js planning_shared_plan_http.spec.js eng_board_stream.spec.js` (fixture consumers of `createContext` and `login`; needs the PostgreSQL binaries as for the backend suite).
Expected: all PASS, including the unchanged `test_callback_redirects_to_the_stashed_share_view_and_pops_it`, `test_callback_without_a_stash_redirects_to_root`, `test_callback_stores_encrypted_tokens_and_only_opaque_cookie`, `test_post_exchange_callback_failure_deletes_only_current_browser_row`, `test_only_navigation_auth_api_routes_redirect` and `test_werkzeug_logs_redact_oauth_callback_query`.

- [ ] **Step 6: Commit** the route, the three test files and the UI fixture: "Redirect rejected OAuth callbacks to the sign-in page". Record the commit and the Step 5 result in the Execution Status table.

### Task 3: Documentation and publication gate

**Files:**
- Modify: `docs/SUPPORT-atlassian-oauth-setup.md` ("Common Errors", the `invalid_oauth_state` entry)
- Modify: `docs/ontology.md` ("Connection Recovery": the **Authentication recovery** bullet and that section's `Verified on`)
- Modify: `docs/README_ANALYTICS.md` (the "Feature action | Primary anchors | Reason | Reviewed on" no-event table)
- Modify: `docs/plans/SUPPORT-multi-device-browser-sessions-design.md` (the `/api/auth/atlassian/callback` endpoint-matrix row and the pre-exchange "callback failure split" sentence)
- Modify: `docs/plans/README.md`, this plan (rename to `DONE-*` at publication)

- [ ] **Step 1: Setup guide.** Replace the `invalid_oauth_state` heading and copy with the new behavior: a rejected callback now shows the sign-in page notice ("Your sign-in did not finish...") or returns a signed-in browser to the dashboard; keep the four causes and "Start again from `/login` in the same browser tab"; add that Back navigation into the Atlassian consent page and a second sign-in tab are harmless.

- [ ] **Step 2: Ontology.** Append to the **Authentication recovery** bullet: "A pre-exchange OAuth callback failure (`api_atlassian_callback` in `backend/routes/auth_routes.py`) redirects to the constant `/login?reason=sign_in_incomplete`; `auth_entry_page` forwards a valid DB browser session to `pop_share_view_target` and otherwise shows the notice, keeping the share-view stash. Contracts: the callback cases in `tests/test_auth_routes.py` and `tests/test_db_oauth_cutover.py`." Set the section's `Verified on` to the execution date. Leave line 3 untouched.

- [ ] **Step 3: Analytics row.** Add to the "Feature action" no-event table (it records no-event decisions for user-visible feature changes; the separate "Allowlist" table is for state-changing routes, and this change adds no state change): `| Rejected OAuth callback recovery | `backend/routes/auth_routes.py` (`api_atlassian_callback`, `auth_entry_page`) | Server navigation only: trigger none; `event_type=none`; canonical `event_name=none`; `feature_name=auth`; typed params none. The callback and `/login` render without GTM; a forwarded browser's existing `login` event stays once per tab session. No state, code, provider error or URL may be sent. No GA4 runbook change. | <execution date> |`

- [ ] **Step 3b: Multi-device contract.** In the endpoint matrix row for `/api/auth/atlassian/callback`, add `302 /login?reason=sign_in_incomplete` for pre-exchange validation failures to the failure/recovery column; in the "callback failure split" paragraph, say those failures redirect instead of returning sanitized `400`s and still leave every browser row intact. Historical `DONE-*`/legacy spec files are left as audit context.

- [ ] **Step 4: Learnings guard.** Run: `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_agents_md_learnings` — Expected: PASS.

- [ ] **Step 5: Commit** the four docs: "Document OAuth callback recovery". Record the commit in the Execution Status table.

- [ ] **Step 6: Publication gate** (only when the operator asks to publish). Rename this plan to `DONE-oauth-stale-callback-recovery.md`, set its `> **Status:**` to done with the branch and head commit, update its `docs/plans/README.md` link and the design's link in the same commit. Then run `npm ci` if the worktree lacks `node_modules`, `npm run build`, and `make verify ARGS=--no-deadline` (the no-deadline full diagnostic was explicitly requested by the operator for this work, per root `AGENTS.md` section 11; otherwise use plain `make verify`); read the result ledger under `tmp/verification/`. Expected: every stage passes. Expected publication scope against `origin/main`: this branch's docs commit, the three task commits and the DONE rename commit, touching exactly `backend/routes/auth_routes.py`, `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py`, `tests/test_epm_home_scope_request.py`, `tests/ui/db_oauth_fixture.js`, `docs/SUPPORT-atlassian-oauth-setup.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, `docs/plans/SUPPORT-multi-device-browser-sessions-design.md`, the design and this plan. Follow root `AGENTS.md` section 10 publication steps; no push or PR without explicit operator confirmation.

## Execution Status

| Task | State | Commit | Verification |
| --- | --- | --- | --- |
| 1 | not started | | |
| 2 | not started | | |
| 3 | not started | | |
