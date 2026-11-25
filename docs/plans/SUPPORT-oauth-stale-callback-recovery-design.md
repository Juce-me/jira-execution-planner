# OAuth stale callback recovery (design)

> **Status:** Design draft 2026-11-24, not implemented. Execution contract: [EXEC-oauth-stale-callback-recovery.md](EXEC-oauth-stale-callback-recovery.md). Operator decisions D4 and D7 resolved 2026-11-24 (option 1 for both); D8 (consent link after an incomplete grant) approved 2026-11-24. Revised after a second and a third three-reviewer round on 2026-11-24.

## Problem

A signed-in user finished an Atlassian sign-in on localhost and was shown a raw JSON page, `{"error": "invalid_oauth_state"}`, at `/api/auth/atlassian/callback`. Loading `/` right afterwards showed them signed in.

`api_atlassian_callback` (`backend/routes/auth_routes.py`) pops `oauth_state` and `oauth_pkce_verifier` from the Flask session, then returns `400` JSON when the saved state is missing or differs from the callback's `state`. The same route returns `400` JSON for a provider `error` parameter (`oauth_authorization_failed`), a missing `code` (`missing_oauth_code`) and a missing verifier (`missing_pkce_verifier`). The callback is a top-level browser navigation, so each of these is a dead end that shows a developer-facing body to a user.

The perimeter recovery work (`bugfix/perimeter-session-expiry-recovery`, PR #348) changed no backend code and is not involved.

## How the journey works today

Verified against `origin/main` `3c2d3186` on 2026-11-24 and re-checked at `30d0923b` (docs-only drift) and `1e16e8f0` on 2026-11-25 (upstream changed only capacity tests and three docs, none in the OAuth journey).

1. A browser without a valid DB browser session asks for `/` or `/jira-dashboard.html`. `redirect_unauthenticated_oauth_dashboard_entry` (`jira_server.py`, `OAUTH_DASHBOARD_ENTRY_PATHS`) stashes a valid share-view query with `stash_share_view_query` and redirects to `/login`, or to `/login?reason=session_expired` when an old `db_oauth_session` cookie entry is present. Any `AuthError`, including `missing_oauth_scope` for a stored grant that lacks base scopes, takes that `session_expired` path, whose card offers the plain link.
2. `/login` (`auth_entry_page`) forwards a browser with a valid session to `pop_share_view_target(session)` unless the reason is terminal (`session_expired`, `missing_scope`). Otherwise it renders the sign-in card with an optional `.auth-notice` paragraph and a "Sign in with Atlassian" link to `/api/auth/atlassian/login` (with `?prompt=consent` for `missing_scope`).
3. `api_atlassian_login` writes a fresh `oauth_state` (`secrets.token_urlsafe(32)`) and PKCE verifier into the session on every call, overwriting any earlier pending pair, and redirects to Atlassian.
4. `api_atlassian_callback` pops both values, validates state, provider error, code and verifier in that order, exchanges the code, stores encrypted tokens and a new DB browser session (`store_db_oauth_callback_session_metadata`), and redirects to `pop_share_view_target(session)`.
5. The Flask session is the default signed client-side cookie (`backend/app.py`: `HttpOnly`, `SameSite=Lax`, `Secure` when configured). It carries only `db_oauth_session` (an opaque browser-session id), the pending OAuth pair, the CSRF key and the share-view stash.
6. In the dashboard, a terminal `401` locks the app behind `AuthRequiredGate.jsx`. "Sign in again" claims the multi-tab recovery lease (`authRecoveryCoordinator.js`, 5-minute lease in `localStorage`, tab attempt in `sessionStorage`) and navigates to the sanitized `loginUrl` (`sanitizeLoginUrl`, `VALID_REASONS = {session_expired, missing_scope}` in `frontend/src/api/authRequired.js`). Follower tabs show "Sign-in is continuing in another tab". When the leader tab boots the dashboard again, `completeAuthRecovery` (`dashboard.jsx`) writes the success record and followers resume.

## Likely triggers

The server-side symptom is reproduced by an existing test: `TestAuthRoutes.test_full_login_return_chain_applies_the_link_once` (`tests/test_auth_routes.py`) signs in, replays the same callback URL and asserts `400 invalid_oauth_state` while the session stays valid. Which browser action produced the user's second hit is **not verified**; the candidates, all consistent with "signed in afterwards", are:

- **Back navigation after success.** Back from the dashboard returns to the Atlassian authorize page in history; for an already-consented user Atlassian redirects straight to the callback again with the old, already-consumed `state` and a new `code`. The saved state is gone, so the check fails.
- **Reload, session restore or a duplicate request** of the callback URL after the first request completed.
- **Superseded login.** Two login starts (a second tab, or a double click on the sign-in link) leave only the newer state in the cookie. The older callback mismatches and also pops the newer pending pair, so the newer tab fails too unless its callback already completed or was in flight with the earlier cookie.
- **Host mix.** Starting on `127.0.0.1` while `ATLASSIAN_REDIRECT_URI` names `localhost` sends the callback without the cookie that holds the state; an earlier valid `localhost` session then makes `/` look signed in. (Already listed in `docs/SUPPORT-atlassian-oauth-setup.md` "Common Errors".)

None of these is an attack, but an attacker-forged callback looks exactly like them to the server, so the outcome must be safe for both.

## Goals, non-goals, anti-goals

Goals: in a healthy DB/OAuth runtime, every pre-exchange callback failure ends on a page a user can act on; a browser that is already signed in goes back to the dashboard (or its stashed share view) without another Atlassian round trip; the state check stays exactly as strict.

Non-goals: post-exchange failures (`user_inactive`, `jira_site_not_accessible`, token-exchange `AuthError`s, configuration errors) keep their current responses; a follow-up may map them to the existing `/auth/*` recovery pages. No change to `api_atlassian_login`, cookie attributes, the DB browser-session model or the frontend recovery lease.

Anti-goals: exchanging any `code` whose `state` did not match the saved one; putting `state`, `code` or any provider error text into an application-generated URL, page or database row or an app-controlled log line (proxies, browsers and Atlassian are outside this guarantee; see `docs/PRIVACY.md`); a redirect target built from request parameters; a sign-in loop that never renders a page.

## Decisions

### D1. Outcome per pre-exchange failure (redirect targets)

All four pre-exchange failures (state missing or different, provider `error`, missing `code`, missing verifier) stop before `validate_auth_config` and `exchange_authorization_code`, keep popping the pending pair exactly as today, and leave the DB browser session and share-view stash untouched. This no-mutation guarantee covers the callback response itself; the following `/login` request may consume the stash (forwarding) or upgrade a legacy connection-only cookie into a browser row, as it does today. Instead of `400` JSON they return one fixed redirect:

```text
302 Location: /login?reason=sign_in_incomplete
```

`/login` already owns "already signed in" forwarding, so it decides the rest:

| Browser state on arrival at `/login?reason=sign_in_incomplete` | Result |
| --- | --- |
| Valid DB browser session (`current_request_auth_context` succeeds) | `302` to `pop_share_view_target(session)`: `/` or `/?<stashed share view>`; the stash is consumed |
| Session whose validation raises `missing_oauth_scope` (stored grant lacks base scopes) | Sign-in card with the new notice and the existing consent link `/api/auth/atlassian/login?prompt=consent` (D8); the stash is kept |
| No session, expired, deleted or revoked session, or any other `AuthError` from validation | Sign-in card with the new notice and the plain link; the stash is kept for the next successful callback |

`sign_in_incomplete` is a **non-terminal** reason (it is not added to the `{session_expired, missing_scope}` set), which is what lets `/login` forward a valid session.

Evidence: `auth_entry_page` already performs this exact check and forwarding; reusing it keeps one owner for "signed in, go to the dashboard" and needs no second validation path in the callback. The relative `Location` also heals the host mix: the user lands on the redirect URI's host, where the next sign-in keeps its cookie.

Approaches considered:

- **A. Callback decides directly** (validate the session in the callback and redirect to `/` or the share target, else to `/login?reason=...`). One hop fewer for signed-in browsers, but duplicates `/login`'s validation and its terminal-reason subtleties in a second route.
- **B. Callback always redirects to `/login?reason=sign_in_incomplete`** (recommended, my call). One fixed target, no new session logic in the callback, the end destinations are identical to A. The extra same-origin `302` is not visible.
- **C. Render an HTML error page from the callback.** Rejected: it would be a fourth copy of the auth card HTML and still need a "go to dashboard" path for signed-in users.

Provider `error` is folded into the same reason on purpose: it is usually a cancelled consent, the user's next step is the same, and echoing Atlassian's `error`/`error_description` values would put provider text into the page. A browser whose grant is complete and which cancels a voluntary sign-in is forwarded to the dashboard by `/login`. A browser that cancels a re-consent while its stored grant lacks base scopes makes `current_request_auth_context` raise `missing_oauth_scope` (`backend/auth/db_context.py`) and gets the consent link (D8); one that cancels the optional EPM Home consent still has valid base scopes and is forwarded (D8 explains both).

### D8. Keep forced consent after an incomplete grant (**Operator**: approved 2026-11-24)

Without it, a re-consent that the user cancels ends on the plain link. A plain sign-in can return the same incomplete grant; the callback then succeeds, the dashboard entry guard catches `missing_oauth_scope` and redirects to the terminal `/login?reason=session_expired`, which again offers the plain link, so the user can repeat the cycle without ever being asked for the missing scopes. Decision: when `auth_entry_page` handles `reason=sign_in_incomplete` and session validation raises `AuthError` with code `missing_oauth_scope`, the card shows the `sign_in_incomplete` notice with the existing `/api/auth/atlassian/login?prompt=consent` link. The share-view stash is kept. No other reason or error code changes. The consent promise is limited to cancellations where the stored grant lacks base scopes: the optional EPM Home permission prompt (`epm_scope_required`, `backend/routes/epm_errors.py`) also forces consent, and cancelling it leaves a browser with valid base scopes that `/login` forwards to the dashboard, where EPM asks again. The pre-existing entry-guard path (`session_expired` with the plain link for a base-scope gap that reaches `/` directly) is not changed by this design and is recorded as a residual risk.

### D2. Copy and UI

The new notice reuses the existing `.auth-notice` paragraph on the `/login` card (`role="status"`), the same element and tone as the two existing reasons; the link is the plain `/api/auth/atlassian/login`, or the existing `?prompt=consent` link under D8. The server-rendered sign-in page is not in `docs/design-system.md`; no new element kind, class, font size or radius is introduced, so no design-system entry is required.

Proposed copy (my call, matching the existing "...Sign in again to continue." pattern):

> Your sign-in did not finish, for example because the page was reloaded or sign-in was started again in another tab. Sign in again to continue.

What the user sees:

| Case | Today | After |
| --- | --- | --- |
| Replayed or back-navigated callback, still signed in | Raw JSON `invalid_oauth_state` | Dashboard (or stashed share view), no visible stop |
| Superseded login in another tab, other tab not yet signed in | Raw JSON in the stale tab; the newer tab's pending pair is consumed, so it also fails | Sign-in card with the notice in both tabs |
| Superseded login, other tab already signed in | Raw JSON | Dashboard |
| Cancelled or denied consent, not signed in | Raw JSON `oauth_authorization_failed` | Sign-in card with the notice |
| Cancelled re-consent, stored grant lacks base scopes | Raw JSON `oauth_authorization_failed` | Sign-in card with the notice and the consent link (D8) |
| Missing `code` or verifier (tampered or truncated URL) | Raw JSON | Sign-in card with the notice, or the dashboard if signed in |
| In-app recovery leader whose terminal `401` does not reproduce on base-session validation cancels or replays the callback | Raw JSON; leader stuck, followers wait | Conditional (D7): leader forwarded to `/`; if bootstrap establishes a principal and the leader still owns the live lease, `completeAuthRecovery` releases followers, and every tab that repeats the failing call locks again |
| Post-exchange failure | Unchanged JSON | Unchanged (non-goal) |

### D3. Multi-tab recovery lease (no change)

A tab that holds the recovery lease keeps its `sessionStorage` attempt across these navigations. With D1 it either reaches `/` (and `completeAuthRecovery` in `dashboard.jsx` releases followers; today a leader stuck on a JSON page leaves followers in the follower state until a `storage` event or a click, they do not resume on lease expiry; see D7 for a release without a new sign-in) or reaches the sign-in card and completes on its next sign-in. Follower tabs never start a login, so the lease already prevents the in-app path from superseding itself. Nothing beyond the redirect is needed.

### D7. Release of follower tabs without a new sign-in (**Operator**: option 1 accepted 2026-11-24)

`completeAuthRecovery` (`frontend/src/dashboard.jsx`) runs after a successful `/api/config` that yields a workspace/view principal in a tab holding the lease, not only after a real sign-in. The release happens only when all three hold: a rejected callback forwards the leader because its base session still validates; dashboard bootstrap establishes a principal; and the leader still owns the live lease. Then followers navigate to `/` and lock again on the same failing call. Base-scope gaps do not qualify, because `/login` validates the same base scopes and renders the card; missing optional Home scopes surface as a feature-level `409 epm_scope_required` (`backend/routes/epm_errors.py`), not a terminal lock. A qualifying case is any terminal `401` from a route whose failure base validation does not reproduce. No loop results (each new lock needs a click), and today the same release happens when the user types `/` after the JSON page, as the reporting user did. Options:

1. **Accept** (recommended): document it; behavior equals today's manual recovery, minus the JSON page.
2. **Make `sign_in_incomplete` terminal**: no forwarding, so a replayed callback with a valid session shows the card instead of the dashboard, which loses the main benefit for the reported case.
3. **Tighten lease completion** in the frontend (for example complete only when the tab's last navigation came from a successful callback): a frontend auth-recovery change outside this design's scope; a separate plan.

### D4. Concurrent pending logins (**Operator**: option 1 accepted 2026-11-24)

Login start overwrites any earlier pending state, and any callback, matching or not, pops the pair. Options:

1. **Keep as is** (recommended). A superseded tab gets the notice; an older return (another tab, Back, a second click) clears the newer pending pair in the same browser, so the guidance is to restart in one tab and complete the newest attempt, starting once more after the notice if needed. No change to CSRF or fixation properties.
2. **Do not consume on mismatch.** A mismatching callback leaves the pending pair for the tab whose callback is still coming. A mismatch still never exchanges a code, and the 256-bit state is not guessable, so login CSRF is not weakened; the cost is that a pending pair can survive a forged or stale callback until the next login start or successful callback, and the "a callback always clears pending state" invariant (asserted by `test_callback_rejects_invalid_state`) goes away.
3. **Keep several pending pairs** (a bounded map of state to verifier with a TTL). Lets both tabs finish, but grows the cookie that the share-view stash budget (3,300 bytes) already constrains, and adds expiry logic to the most security-sensitive route.

Risk weighed: login CSRF (an attacker making the victim's browser complete the attacker's authorization) needs a callback whose state matches the victim's cookie; no option above lets a mismatched state reach the exchange. Login fixation is not affected by any option, because every successful callback already replaces the DB browser session (`store_db_oauth_callback_session_metadata` deletes the previous one and creates a new opaque id). Options 2 and 3 change auth behavior beyond redirect targets, so they require an explicit operator decision; the plan implements option 1.

### D5. Logging and secrecy

- The redirect target is a constant; it never contains `state`, `code`, `error` or `error_description` values, and nothing from the callback query is rendered, logged, stored or audited by the application. App-controlled logs are the Werkzeug and application loggers plus the container's Gunicorn access log, which records the path without the query string (`docs/PRIVACY.md`).
- The Werkzeug request line for the callback stays redacted by `SENSITIVE_CALLBACK_QUERY_RE` / `SensitiveLogRedactionFilter` (`jira_server.py`), covered by `test_werkzeug_logs_redact_oauth_callback_query` (`tests/test_logging_migration.py`). `/login?reason=sign_in_incomplete` contains no secret and needs no redaction.
- `Referrer-Policy: same-origin` (`backend/security/headers.py`) is unchanged. After a `302` the referrer of `/login` is the document that started the navigation (the Atlassian page), not the callback URL, so the callback query never travels as a referrer.
- No new log line is added. If diagnostics are wanted later, log only the fixed failure kind (for example `oauth_callback_rejected kind=state_mismatch`), never values.

### D6. Analytics impact review

Trigger none; `event_type=none`; canonical `event_name=none`; `feature_name=auth`; typed params none. `/login` and the callback are server-rendered without GTM, so no pageview or event can fire there. A forwarded browser reaches the dashboard, whose existing `login` event is once per tab session (`jep.analytics.login.<mode>` in `sessionStorage`, `dashboardAnalytics.js`) and is not duplicated. No GA4 runbook change. One no-event row is added to the "Feature action" table in `docs/README_ANALYTICS.md`.

## Constraints

- OAuth is the only auth mode; no Basic or local-token fallback (root `AGENTS.md` section 11).
- Only `/api/auth/atlassian/login` and `/api/auth/atlassian/callback` may redirect under `/api/` (`EndpointPolicyInventoryTests.test_only_navigation_auth_api_routes_redirect`); the change stays inside that guard.
- The callback response for a pre-exchange failure must not mutate the current or any other DB browser session (`SUPPORT-multi-device-browser-sessions-design.md`; `DbOauthCutoverTests.test_callback_validation_failures_preserve_current_and_other_browser_rows`).
- Every failed callback keeps the share-view stash for a retry (`test_failed_callback_keeps_the_stash_and_a_retry_applies_it`, `test_callback_failures_retain_the_pending_share_view_for_a_retry`).
- The frontend 401 lock path and `VALID_REASONS` are unchanged: the new reason is produced only by a server redirect, never by an API `loginUrl` payload.

## Left to the builder

- Exact constant name for the redirect target and whether the copy string lives beside the two existing ones in `auth_entry_page`.
- Wording of the updated "Common Errors" entry in `docs/SUPPORT-atlassian-oauth-setup.md`.

## Residual risks

- Two truly concurrent requests carrying the same matching state can both reach the exchange; the second fails on the one-time `code` and, as a post-exchange failure, deletes the browser session referenced by its own (older) cookie and may overwrite the cookie written by the first. This is pre-existing, outside this change, and rare in browsers because a navigation is not duplicated concurrently.
- The dashboard entry guard still sends a base-scope gap that reaches `/` directly to `/login?reason=session_expired` with the plain link (pre-existing; D8 covers only the `sign_in_incomplete` path).
- `/login` catches only `AuthError` from `current_request_auth_context`. With a cookie session present and the database unavailable, a redirected callback now ends on `/login`'s raw `500` instead of the callback's `400` JSON. This is `/login`'s pre-existing behavior for any visitor during an outage and is not changed here.
- Any page can force a top-level navigation to the callback (`SameSite=Lax`) and so consume a pending login; pre-existing, now silent instead of JSON. The state comparison is not constant-time; the state is a 256-bit one-time value.
- The trigger the user hit is inferred, not observed. The redacted Werkzeug log of that server, if retained, would show whether two callback request lines arrived.
