# EXEC-04: Use Per-User Home Token for DB-Backed EPM Reads

## Status

- [x] Task 1: Verify current auth/storage baseline
- [x] Task 2: Make the EPM Home credential resolver user-scoped in DB mode
- [ ] Task 3: Propagate missing-token states through EPM APIs
- [ ] Task 4: Gate EPM navigation on the user Home token
- [ ] Task 5: Partition or disable Home/EPM metadata caches by user token
- [ ] Task 6: Clean up DB/OAuth env and setup docs
- [ ] Task 7: Run end-to-end verification

## Product Decision

When the app runs with DB-backed auth/config, EPM Home/Townsquare metadata reads are user-owned access, not shared workspace defaults.

Normal authenticated users must be able to connect their own Atlassian API token in `Settings -> Connections` and use that credential to fetch Home/Townsquare goals, child goals, projects, lifecycle labels, and Home project metadata required by EPM mode.

In DB/OAuth mode, do not render the EPM tab or EPM content until the current user has an active Home/Townsquare token connection. Before that token exists, the user can reach only the normal settings/configuration entry point and the Connections panel needed to connect the token. After the token exists and the EPM tab is visible, the EPM tab must include an accessible configuration gear that opens EPM settings.

There must be no Jira or Home Basic credentials in `.env` for the DB/OAuth EPM path:

- Do not require `JIRA_EMAIL`.
- Do not require `JIRA_TOKEN`.
- Do not require `ATLASSIAN_EMAIL`.
- Do not require `ATLASSIAN_API_TOKEN`.

The user API token is not part of EPM saved view configuration. It is a user credential connection stored encrypted in DB token storage. EPM saved view state remains limited to non-secret UI/config values such as root goal scope, selected sub-goals, `labelPrefix`, issue-type grouping, project label mappings, selected EPM tab, and selected sprint.

Jira REST access remains OAuth-based in DB/OAuth mode. The user API token is used only for Home/Townsquare GraphQL where OAuth cannot yet satisfy the Home project metadata reads.

## Current Context

This plan supersedes the earlier hybrid assumption that DB/OAuth EPM reads use user OAuth for Jira REST and service-account Basic credentials for Home/Townsquare metadata.

`DONE-02` introduced the user-owned Atlassian API-token connection shape:

- provider: `atlassian_user_api_token`
- capability: `home_townsquare_graphql`
- validation: Jira `/rest/api/3/myself` account id must match the signed-in OAuth user
- Home validation: a real Home GraphQL read probe with the submitted email/token
- storage: encrypted `auth_tokens`, not `service_integration_tokens`

`EXEC-04` uses that connection for EPM Home reads. It does not add Home write routes, does not add raw Home GraphQL proxy routes, and does not put token material in user view payloads.

The Home GraphQL OAuth probe gate remains a blocker for Home 3LO. Until that gate passes with a real local user session, this plan must not mark Home/Townsquare-backed EPM routes as OAuth-only.

## Target Flow

1. User signs in with Atlassian OAuth.
2. The app uses OAuth identity and Jira REST tokens for Jira requests.
3. Dashboard bootstrap checks the current user's Home token connection status before rendering the ENG/EPM mode switch.
4. If no active `atlassian_user_api_token` connection exists, the EPM tab is not rendered and no EPM Home metadata request is started.
5. User opens Settings through the normal configuration entry point, then opens Connections.
6. User enters Atlassian email plus API token and saves.
7. Backend validates the submitted API token against the same Atlassian account id as the OAuth session, probes Home GraphQL read access, then stores the token encrypted.
8. Dashboard refreshes token status, renders the EPM tab, and allows EPM Home metadata fetches using the current user's connected token.
9. EPM renders only the Home goals/projects visible to that user's token.
10. The visible EPM tab includes a configuration gear that opens `Settings -> EPM`.

## Non-Goals

- No Jira Basic auth fallback in DB/OAuth EPM mode.
- No Home/Townsquare service-account fallback for DB/OAuth EPM reads.
- No shared workspace EPM defaults.
- No storage of token material in dashboard config, EPM config, saved views, JSON cache files, or browser local storage.
- No new Home write routes.
- No generic raw Home GraphQL operations exposed to normal users.
- No conversion of `team-groups.json` or `team-catalog.json` away from JSON-backed storage in this phase.

## Upstream Deviations To Reconcile Before Execution

These are the known differences between the active branch state and the DONE-01 through DONE-03 plan text after the 2026-05-12 checklist reconciliation.

- `DONE-01`, `DONE-02`, and `DONE-03` were executed on `cdx/auth-db-context-plan`, not after landing on `main`. The user explicitly allowed continuing on the current branch, but this still differs from old plan wording that said later plans start only after the earlier plan lands in `main`.
- `DONE-01-db-auth-foundation.md` checkboxes were reconciled from branch commits on 2026-05-12, but those edits record commit history rather than a fresh rerun of every verification command.
- `DONE-02` Tasks 1-4 checkboxes were reconciled from branch commits on 2026-05-12. Confirm current files/tests before depending on them because the worktree still contains later dirty edits.
- `GATE-05-home-write-capability.md` owns the blocked Home write probe. The real Home write probe has not passed, so Home write routes and write UI remain blocked.
- `DONE-02` still describes Home/Townsquare metadata reads as workspace service-integration-backed and user API tokens as write-only. `docs/plans/README.md` now records that `EXEC-04` intentionally supersedes that model for DB/OAuth EPM reads only.
- `DONE-03` originally moved through a shared-workspace-default design, then was corrected to user-owned EPM saved view state. Current `DONE-03` reflects the corrected product decision, but older `DONE-01` acceptance text still says normal users cannot mutate EPM/APM configuration. For DB/OAuth saved views, use the later `DONE-03` decision: normal users can save their own EPM view/config.
- `DONE-03` Home reference validation currently assumes a workspace service-backed Home catalog while the Home 3LO gate fails. `EXEC-04` must move DB/OAuth EPM Home validation and reads to the current user's connected Home token.
- Current dirty files include docs/env/user-token handling changes. Do not assume those are landed until they are either committed in their scoped task or explicitly reverted by the user.

## Task 1: Verify Current Auth/Storage Baseline

Files to read before editing:

- `AGENTS.md`
- `docs/plans/AGENTS.md`
- `docs/plans/README.md`
- `docs/plans/DONE-02-db-home-user-api-token-bridge.md`
- `docs/plans/GATE-05-home-write-capability.md`
- `docs/plans/DONE-03-db-user-configuration.md`
- `backend/auth/home_credentials.py`
- `backend/auth/user_api_tokens.py`
- `backend/routes/user_connection_routes.py`
- `.env.example`
- `README.md`
- `docs/SUPPORT-atlassian-oauth-setup.md`

Checks:

- Verify current branch is not `main`.
- Verify DB migrations are at head before route/runtime testing.
- Verify `DONE-01` landed or is present on the current checkout and `DONE-03` user-owned view config behavior remains intact.
- Verify whether the user API-token connection routes from `DONE-02` are already present on the current branch.
- Run or document the Home GraphQL OAuth probe gate. If it fails, record that this plan intentionally uses per-user API token Basic auth for Home reads, not Home OAuth.
- Confirm no plan step depends on `JIRA_EMAIL`, `JIRA_TOKEN`, `ATLASSIAN_EMAIL`, or `ATLASSIAN_API_TOKEN` for DB/OAuth EPM.

Verification:

```bash
git branch --show-current
git status --short
.venv/bin/python -m alembic current
.venv/bin/python -m alembic heads
.venv/bin/python -m unittest tests.test_user_view_config_storage tests.test_user_view_config_routes
```

Commit message:

```text
Verify DB EPM user-token baseline
```

## Task 2: Make the EPM Home Credential Resolver User-Scoped in DB Mode

Files to read before editing:

- `backend/auth/home_credentials.py`
- `backend/auth/user_api_tokens.py`
- `backend/auth/context.py`
- `backend/auth/session.py`
- `backend/epm/home.py`
- `jira_server.py`
- tests covering Home credential resolution and EPM Home routes

Implementation:

- Add an explicit EPM metadata credential purpose, for example `READ_EPM_METADATA`, or update the existing EPM-only resolver call path so DB/OAuth EPM reads resolve through the current user's active `atlassian_user_api_token`.
- In DB/OAuth mode, fail closed when the current user has no active Home user-token connection.
- Do not look up `home_townsquare_basic` service integrations for DB/OAuth EPM metadata reads.
- Keep legacy Basic/env behavior only for non-DB or explicitly legacy local modes that still use JSON config and Basic auth.
- Ensure the resolved credential object includes a stable user/token identity for cache partitioning without exposing token values.

Tests first:

- Current DB/OAuth user with active `atlassian_user_api_token` resolves a Home GraphQL credential.
- Current DB/OAuth user without the connection receives a structured missing-token error.
- A configured `home_townsquare_basic` service integration is ignored for DB/OAuth EPM reads.
- A revoked or disabled user token fails closed.
- Legacy non-DB mode remains compatible if existing tests cover that path.

Verification:

```bash
.venv/bin/python -m unittest tests.test_home_credentials tests.test_user_api_token_connections
```

Commit message:

```text
Resolve EPM Home reads through user token
```

## Task 3: Propagate Missing-Token States Through EPM APIs

Files to read before editing:

- `backend/epm/home.py`
- `backend/routes/epm_routes.py` if present
- `jira_server.py`
- frontend API clients that call `/api/epm/*`
- tests covering `/api/epm/goals`, `/api/epm/projects`, and rollup endpoints

Implementation:

- Stop silently converting Home credential failures into empty EPM project lists.
- Return a structured missing-token response when Home metadata is required:

```json
{
  "error": "home_user_token_required",
  "message": "Connect your Atlassian API token to load EPM Home projects.",
  "connectUrl": "/settings/connections/home-token"
}
```

- Preserve existing response compatibility where routes currently return safe picker payloads. For example, `/api/epm/goals` may keep `200` with `goals: []` if required by existing UI tests, but it must include `errorCode: "home_user_token_required"` and `connectUrl`.
- Board and rollup routes that cannot produce correct data without Home metadata should return a non-success prerequisite status, preferably `409`.
- Ensure API responses never include email/token values.

Tests first:

- Missing user token on `/api/epm/projects` returns `home_user_token_required`, not `projects: []` with a generic warning.
- Missing user token on all-project rollup does not render a misleading empty active board.
- Existing GET `/api/config`, GET `/api/epm/config`, and GET `/api/groups-config` compatibility remains intact.
- User-owned EPM config saves still do not require tool-admin rights.

Verification:

```bash
.venv/bin/python -m unittest tests.test_epm_goals_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_user_view_config_routes
```

Commit message:

```text
Expose EPM Home token prerequisite
```

## Task 4: Gate EPM Navigation On The User Home Token

Files to read before editing:

- `frontend/src/dashboard.jsx`
- `frontend/src/components/settings/*` if present
- `frontend/src/components/epm/*` if present
- `frontend/src/api/*` if present
- relevant UI tests under `tests/ui/`

Implementation:

- Add or reuse a compact bootstrap call that returns the current user's Home token connection status before rendering the ENG/EPM mode switch.
- When the current user has no active Home token connection, do not render the EPM tab, do not render EPM content, and do not call EPM Home metadata endpoints.
- Keep the normal settings/configuration entry point visible without requiring the EPM tab, so the user can open Settings -> Connections and connect the Home/Townsquare token.
- After a successful token connection, refresh token status and render the EPM tab without requiring a full server restart.
- When the EPM tab is visible, keep an accessible configuration gear inside the EPM tab that opens `Settings -> EPM`.
- If a direct EPM API request still returns `home_user_token_required`, treat that as a defensive backend prerequisite state and refresh token status rather than showing stale or empty EPM content.
- Do not ask the user to edit `.env`.
- Do not show or persist token values after save.
- Keep EPM saved view fields separate from the user credential connection.
- Keep existing selected-chip/remove/search behavior in EPM settings.

Tests first where practical:

- Dashboard without a Home token does not render the EPM tab.
- Dashboard without a Home token does not start `/api/epm/goals`, `/api/epm/projects`, or EPM rollup requests.
- The settings/configuration entry point remains visible without the EPM tab and opens Settings -> Connections.
- Settings Connections allows a normal authenticated user to add/update/revoke the Home token without tool-admin rights.
- After connecting the token, the EPM tab appears and renders projects from the mocked Home response.
- When the EPM tab is visible, the EPM configuration gear opens Settings -> EPM.
- Revoking the token hides the EPM tab and prevents stale EPM content from remaining visible.
- Opening Settings does not clear saved root goal/sub-goal/project label mappings.

Verification:

```bash
npm run build
npx playwright test tests/ui/epm-home-token-gating.spec.js tests/ui/settings-home-token-connection.spec.js tests/ui/epm-settings-gear.spec.js
```

Commit message:

```text
Gate EPM tab on Home token
```

## Task 5: Partition or Disable Home/EPM Metadata Caches by User Token

Files to read before editing:

- `backend/epm/home.py`
- `backend/jira_client.py`
- Home/EPM cache helpers
- tests covering OAuth cache isolation

Implementation:

- Ensure cached Home goals/projects/project metadata are scoped by at least:
  - workspace id
  - user id
  - auth connection id
  - token version or updated timestamp
  - cloud id/site id
  - root goal/sub-goal/lifecycle scope
- If a cache cannot be safely partitioned, disable it in DB/OAuth user-token mode.
- Do not reuse service-account or anonymous process cache entries for user-token EPM reads.
- On token update/revoke, invalidate or bypass stale EPM Home metadata cache entries.

Tests first:

- User A and User B with different Home token visibility do not share cached projects.
- Updating a Home token causes EPM metadata to be re-fetched.
- Revoking a token removes access on the next EPM request.

Verification:

```bash
.venv/bin/python -m unittest tests.test_oauth_cache_isolation tests.test_epm_home_cache_isolation
```

Commit message:

```text
Isolate EPM Home caches by user token
```

## Task 6: Clean Up DB/OAuth Env and Setup Docs

Files to read before editing:

- `.env.example`
- `README.md`
- `INSTALL.md` if present
- `docs/SUPPORT-atlassian-oauth-setup.md`
- `docs/plans/README.md`
- `AGENTS.md`

Implementation:

- Document that DB/OAuth EPM requires:
  - DB storage configuration
  - OAuth client configuration
  - token encryption configuration
  - user-provided Home token connection through Settings when EPM Home metadata is needed
- Remove DB/OAuth EPM setup instructions that require `JIRA_EMAIL`, `JIRA_TOKEN`, `ATLASSIAN_EMAIL`, or `ATLASSIAN_API_TOKEN`.
- Keep clear separation between:
  - user Home token connection in `auth_tokens`
  - operator/service integrations in `service_integration_tokens`
  - non-secret EPM saved view state in user view config
- Update `docs/plans/README.md` so `EXEC-04` supersedes the earlier service-backed EPM read assumption.
- Tighten `AGENTS.md` project learning so future work does not reintroduce DB/OAuth EPM env Basic credentials.

Verification:

```bash
rg "JIRA_EMAIL|JIRA_TOKEN|ATLASSIAN_EMAIL|ATLASSIAN_API_TOKEN" .env.example README.md INSTALL.md docs/SUPPORT-atlassian-oauth-setup.md docs/plans/README.md AGENTS.md
.venv/bin/python -m unittest tests.test_env_config_docs
```

Commit message:

```text
Document user-token EPM setup
```

## Task 7: Run End-to-End Verification

Files to read before editing:

- all files changed in Tasks 1-6
- failing test output, if any

Verification:

```bash
.venv/bin/python -m unittest discover -s tests
npm run build
npx playwright test
```

Manual local checks:

1. Start the server with DB/OAuth env and no Jira/Home Basic credentials in `.env`.
2. Sign in with Atlassian OAuth.
3. Confirm the EPM tab is not visible without a Home user token.
4. Confirm the settings/configuration entry point is still visible and opens `Settings -> Connections`.
5. Add the user Home token in `Settings -> Connections`.
6. Confirm the EPM tab appears.
7. Open EPM and confirm the EPM configuration gear is accessible and opens `Settings -> EPM`.
8. Confirm root goal, sub-goals, Home projects, lifecycle filtering, selected tab, selected sprint, and project label mappings load from user-owned access and saved view state.
9. Revoke the token.
10. Confirm the EPM tab disappears and stale cached Home projects are not visible.

Source guards:

```bash
rg "home_townsquare_basic|ATLASSIAN_EMAIL|ATLASSIAN_API_TOKEN|JIRA_EMAIL|JIRA_TOKEN" backend frontend docs tests
rg "home_user_token_required|atlassian_user_api_token|home_townsquare_graphql" backend frontend tests docs
```

Commit message:

```text
Verify DB EPM user-token flow
```

## Acceptance Criteria

- DB/OAuth EPM can run with no Jira/Home Basic credentials in `.env`.
- Normal authenticated users can create, update, and revoke their own Home token connection without tool-admin rights.
- The EPM tab and EPM content are not visible until the current user has an active Home/Townsquare token connection.
- The settings/configuration entry point remains reachable before the EPM tab is visible so users can connect the Home token.
- Once the EPM tab is visible, its configuration gear is accessible and opens EPM settings.
- EPM Home metadata reads use the current user's connected token in DB/OAuth mode.
- Direct missing-token EPM API access produces a defensive prerequisite response, not silent empty EPM content.
- Jira REST remains OAuth-based.
- User token material is stored only in encrypted DB token storage.
- User token material never appears in EPM saved view payloads, JSON-backed config files, logs, API responses, browser local storage, docs examples, or committed tests.
- Home/EPM metadata caches cannot leak projects across users or token versions.
- Existing GET `/api/config`, GET `/api/epm/config`, and GET `/api/groups-config` remain backward-compatible during migration.
- `team-groups.json` and `team-catalog.json` remain JSON-backed in this phase.
