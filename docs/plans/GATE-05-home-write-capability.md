# GATE-05: Home Project Write Capability

> **Gate status:** Blocked. Checked on 2026-06-18. Waiting for Jira Home/Townsquare API support or confirmed local capability for the project-update mutation.

## Purpose

This gate owns the blocked Home/Townsquare write capability that was previously embedded in `DONE-02-db-home-user-api-token-bridge.md`.

`DONE-02` delivered the user-owned Atlassian API-token connection plumbing. This gate decides whether the app may add a Home project update route that posts a text update to an existing Jira Home/Townsquare project as the signed-in user.

Do not implement Home write routes, write buttons, retry UI, or write-route OAuth-ready behavior until this gate records a real `PASS home_project_update_supported`.

## Current Status

| Field | Value |
| --- | --- |
| Status | Blocked |
| Checked on | 2026-06-18 |
| Last result | FAIL insufficient_home_write_probe_input |
| Blocker | Jira Home/Townsquare project update API capability is not confirmed locally |
| Dependent work | Home project update route and UI from the deferred DONE-02 write scope |

## Startup Check

At the start of any session touching auth, DB, Home/Townsquare, EPM, or plan execution:

1. Open every `docs/plans/GATE-*.md` file.
2. Check whether the external blocker might have changed.
3. If the gate can be re-tested safely, run the gate command exactly as documented.
4. Update `Checked on` and `Last result` in the status table.
5. Do not mark the gate as passed without command output showing the required `PASS` result.
6. Do not paste personal emails, API tokens, Authorization headers, raw GraphQL responses, OAuth callback URLs, bearer tokens, or refresh tokens into the gate document.

If the required credentials or approved disposable Home project are unavailable, update `Checked on` and keep `Status` as `Blocked`.

## Gate Command

The real probe must run only against a disposable or explicitly approved Home project. Save detailed JSON outside the repo, for example under `/tmp/home-write-probe.json`.

Required operator inputs:

- `HOME_WRITE_PROBE_EMAIL`
- `HOME_WRITE_PROBE_API_TOKEN`
- `HOME_WRITE_PROBE_PROJECT_ID`
- `HOME_WRITE_PROBE_TEXT`

Run:

```bash
.venv/bin/python scripts/check_home_write_capability.py --execute --confirm-project-id "$HOME_WRITE_PROBE_PROJECT_ID"
```

Required pass output:

```text
PASS home_project_update_supported
```

Known non-pass outputs:

```text
FAIL home_project_update_unsupported
FAIL insufficient_home_write_probe_input
```

## If The Gate Passes

When the command records `PASS home_project_update_supported`:

1. Update this file:
   - `Gate status: Passed`
   - `Checked on: <current date>`
   - `Last result: PASS home_project_update_supported`
2. Update `docs/plans/README.md` to mark `GATE-05` passable and point to the follow-up implementation plan.
3. Create or execute an implementation plan for the deferred route work below.
4. Keep `DONE-02-db-home-user-api-token-bridge.md` audit-only; do not reopen it.

## Deferred Implementation Scope

The first allowed write route is exactly one Home/Townsquare mutation route:

```text
POST /api/epm/projects/<project_id>/home-update
```

Accepted request body:

```json
{
  "updateText": "Shipping the private beta this week.",
  "clientMutationId": "optional-idempotency-key"
}
```

Required behavior after the gate passes:

- Use the route only to post one text Home/Townsquare project update on behalf of the signed-in user.
- Do not change Home project lifecycle or status.
- Reject blank text with `400 update_text_required`.
- Reject text longer than 4000 characters with `400 update_text_too_long`.
- Reject invalid JSON with `400 invalid_json`.
- Reject any key other than `updateText` or `clientMutationId` with `400 unsupported_home_update_field`.
- Rejected keys must include `query`, `operationName`, `variables`, `email`, `apiToken`, `authorization`, `status`, `lifecycle`, `author`, and unknown future fields.
- Add `post_home_project_update(credential, project_id, update_text, client_mutation_id=None)` in `backend/epm/home.py`.
- Use the server-owned `HOME_PROJECT_UPDATE_MUTATION`; never accept GraphQL operation text from the HTTP request.
- Require active OAuth user, active DB user, active OAuth `auth_connection`, token-bound CSRF, and active `atlassian_user_api_token`.
- Resolve credentials through `resolve_home_credential(context, "write_as_user")`.
- Never fall back to the workspace `home_townsquare_basic` service integration.
- Return `409 home_user_token_required` when the user API-token connection is missing.
- Return `401 auth_connection_revoked` when either the OAuth connection or the user API-token connection is revoked.
- Return `403 home_write_not_authorized` when Home rejects the verified user credential for the target project.
- On success, return only sanitized update metadata.
- After a successful write, clear EPM caches so later project, issue, and rollup reads cannot serve stale Home update text.
- Do not add a generic Home GraphQL proxy.

Required tests after the gate passes:

- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_requires_user_api_token`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_missing_token_response_includes_connect_url`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_returns_auth_connection_revoked_when_oauth_revoked`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_uses_user_credential_not_service_integration`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_requires_token_bound_csrf`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_rejects_graphql_proxy_fields`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_rejects_unknown_fields`
- `tests/test_home_mutation_auth_guards.py::TestHomeProjectUpdateRoute.test_post_home_update_clears_epm_caches_after_success`
- Playwright coverage proving failed-write recovery opens Settings -> Connections, connects the token, retries the original update once, and clears the token input after the connect request completes.

## Last Check Notes

- 2026-06-18: Startup sweep reviewed the gate while executing the Ad Hoc capacity epic configuration plan. Required `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` inputs are not available in this session, and this plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-06-12: Startup sweep reviewed the gate while executing Planning card-grid and CSS feature-owned partial plans. Required `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` inputs are not present in the local environment, and these plans add no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-06-04: Startup sweep reviewed the gate while executing the shared department/team-group configuration plan. Required `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` inputs are not present in the local environment, and this implementation adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-06-04: Startup sweep reviewed the gate while creating the application hosting readiness execution plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this hosting plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-06-04: Startup sweep reviewed the gate while creating the shared department/team-group configuration plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-06-03: Startup sweep reviewed the gate while reviewing the ENG story subtasks implementation plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-30: Startup sweep reviewed the gate while executing the GA4 instrumentation plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this analytics implementation adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-29: Startup sweep reviewed the gate while refreshing recently implemented plan statuses. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this docs-only status cleanup adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-28: Startup sweep ran the documented write probe without execute credentials while executing the codebase operability verification slice; result was `FAIL insufficient_home_write_probe_input`. This slice adds no Home write route, mutation UI, auth behavior, DB behavior, Home metadata behavior, or EPM route behavior. No real Home write probe pass is recorded in the repo. Keep blocked.
- 2026-05-28: Startup sweep reviewed the gate while implementing a read-only EPM project progress bar. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this UI change adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-27: Startup sweep reviewed the gate while updating the GA4/EPM analytics plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and this plan update adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-20: Startup sweep reviewed the gate while executing the project-grade security hardening plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and the plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-20: Startup sweep reviewed the gate while executing the Effort Split statistics plan. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and the plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-19: Startup sweep ran the documented write probe without the required disposable-project inputs; result was `FAIL insufficient_home_write_probe_input`. No real Home write probe pass is recorded in the repo. Keep blocked.
- 2026-05-19: Startup sweep reviewed the gate while planning project-grade endpoint hardening. `HOME_WRITE_PROBE_EMAIL`, `HOME_WRITE_PROBE_API_TOKEN`, `HOME_WRITE_PROBE_PROJECT_ID`, and `HOME_WRITE_PROBE_TEXT` are not present in the local environment, and the plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-18: Startup sweep reviewed the gate while improving the DB-backed Scenario draft-history plans. Required `HOME_WRITE_PROBE_*` disposable-project inputs are not present in the local environment, and the plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked with `FAIL insufficient_home_write_probe_input`.
- 2026-05-14: Startup sweep reviewed the gate while planning DB-backed Scenario draft history. Required disposable-project write-probe inputs are not available, and the plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked.
- 2026-05-13: Startup sweep reviewed the gate while updating the read-only EPM project reading-experience plan. Required disposable-project write-probe inputs are not available, and the plan adds no Home write route or mutation UI. No real Home write probe pass is recorded in the repo. Keep blocked.
- 2026-05-12: Startup sweep ran the documented write probe without the required disposable-project inputs; result was `FAIL insufficient_home_write_probe_input`. No real Home write probe pass is recorded in the repo. Keep blocked.
- 2026-05-12: Split from `DONE-02-db-home-user-api-token-bridge.md`. No real Home write probe pass is recorded in the repo. Keep blocked.
