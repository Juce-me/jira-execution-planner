# SUPPORT: DB Migration Claude Review Workflow

> **Review-only packet:** Do not execute implementation tasks from this file. Use it to review the current auth/DB/Home migration plan set after the OAuth and EPM fixes on `cdx/auth-db-context-plan`.

## Goal

Give Claude one compact workflow for a thorough plan review: what to read, what is already fixed, what remains active, and where contradictions or missing gates are most likely.

## Current Branch State

Branch: `cdx/auth-db-context-plan`

Recent stabilizing commits:

```text
3487175 Fix OAuth EPM rollup worker auth context
7bf6fe2 Enable hybrid EPM routes in OAuth mode
d1ec1a0 Require explicit Home credentials in OAuth mode
992de93 Guard dashboard config against empty overwrites
40ba3c4 Fix team group saves without discovered teams
04c7317 Treat OAuth users as pre-DB admins
0cd91bf Fail closed on settings edit permission
f52f598 Hide admin-only settings from normal users
c3cd937 Fix normal user group settings save
25af0b0 Fix tool admin settings access
9c59249 Clarify tool admin bootstrap semantics
89f6f4a Gate OAuth shared config writes before DB auth
```

Known verification after the latest EPM OAuth worker fix:

```bash
env JIRA_AUTH_MODE=basic JIRA_EMAIL=test@example.com JIRA_TOKEN=test-token JIRA_URL=https://jira.example .venv/bin/python -m unittest discover -s tests
node tests/test_frontend_api_source_guards.js
git diff --check
```

Expected current evidence:

```text
420 Python tests OK
12 frontend source-guard tests OK
git diff --check clean
```

Current DB plan packet:

```text
docs/plans/EXEC-01-db-auth-foundation.md
docs/plans/EXEC-02-db-home-user-api-token-bridge.md
docs/plans/EXEC-03-db-user-configuration.md
docs/plans/FUTURE-db-additional-features.md
docs/plans/SUPPORT-db-migration-claude-review-workflow.md
docs/plans/README.md
```

Review those as part of the plan set.

## Home/Townsquare Gate

Current documented Home GraphQL OAuth gate:

```text
FAIL home_graphql_3lo_unsupported
```

Review consequence:

- User Atlassian 3LO is valid for Jira REST.
- Do not use user Jira 3LO bearer tokens for Home/Townsquare GraphQL.
- Home/Townsquare metadata reads are workspace service-integration-backed.
- User-owned API-token bridge is allowed only for explicit Home/Townsquare writes as that user.
- If a future real probe returns `PASS home_graphql_3lo_supported`, the user API-token bridge should become optional or dormant in favor of DB-stored OAuth tokens for Home.

## Read Order

Read these files in order. Do not start with the older EPM feature plans unless a specific inconsistency points there.

1. `AGENTS.md`
   - Project constraints, recent learnings, auth/Home rules.

2. `docs/plans/AGENTS.md`
   - Home GraphQL gate, service-credential policy, no personal token as shared app auth.

3. `docs/atlassian-oauth-setup.md`
   - Current runtime OAuth behavior, Home/Townsquare gate, hybrid EPM model.

4. `docs/plans/2026-04-27-atlassian-oauth-auth.md`
   - Historical OAuth foundation and DB auth preconditions. Treat old unchecked implementation tasks as historical unless reconciled in the status table.

5. `docs/plans/2026-05-05-oauth-jira-client-route-migration.md`
   - Jira REST route migration and OAuth boundary.

6. `docs/plans/2026-05-06-epm-home-oauth-migration.md`
   - Home/Townsquare 3LO gate and dormant PASS-gated user-3LO tasks.

7. `docs/plans/EXEC-01-db-auth-foundation.md`
   - Primary active DB auth foundation plan.

8. `docs/plans/EXEC-02-db-home-user-api-token-bridge.md`
   - New supplement for user-owned Atlassian API tokens for Home/Townsquare writes.

9. `docs/plans/EXEC-03-db-user-configuration.md`
   - Later DB-backed workspace defaults and user saved views.

10. `docs/plans/FUTURE-db-additional-features.md`
   - Future scope only.

## Active Workflow

The intended implementation order is:

1. Finish review and commit the plan-doc updates.
2. Re-run preflight before DB implementation:

```bash
.venv/bin/python -m unittest tests.test_auth_context tests.test_jira_auth tests.test_oauth_jira_client tests.test_auth_routes tests.test_auth_entry_page tests.test_oauth_route_guards tests.test_oauth_cache_isolation
node tests/test_auth_isolation_source_guard.js
.venv/bin/python scripts/check_home_graphql_oauth.py
```

3. Implement `docs/plans/EXEC-01-db-auth-foundation.md`.
   - Task 0 is already effectively implemented pre-DB: signed-in OAuth users are local tool admins until DB roles land.
   - Tasks 1 through 8 remain the DB implementation path.

4. Keep Home/Townsquare EPM reads hybrid during DB auth:
   - user OAuth for Jira REST;
   - workspace `home_townsquare_basic` service integration for Home metadata;
   - explicit workspace/service cache partitioning.

5. Implement `docs/plans/EXEC-02-db-home-user-api-token-bridge.md` only after DB encrypted token storage, token-bound CSRF, active user/connection checks, and service integrations exist.
   - This bridge is for user-initiated Home writes.
   - It is not required to open the EPM tab.

6. Implement `docs/plans/EXEC-03-db-user-configuration.md` after DB auth is stable.
   - Workspace defaults remain admin-controlled.
   - User saved views remain user-owned and cannot mutate shared Home/Jira mappings.

7. Treat `docs/plans/FUTURE-db-additional-features.md` as future scope.

## What Was Fixed Already

Do not ask implementers to re-solve these unless the review finds a regression:

- Tool admin is a tool-local role, not Atlassian admin.
- Pre-DB OAuth treats signed-in Atlassian users as local tool admins.
- Settings edit permission fails closed until `/api/config` says `userCanEditSettings: true`.
- Normal users can edit user-specific Team Groups / Group Labels / EPM-side settings where applicable.
- Admin-only shared config tabs are hidden from normal users.
- Team Groups saves allow empty `teamIds` and do not require discovered Jira teams.
- Shared config save endpoints reject implicit empty overwrites of existing selected projects or groups.
- OAuth mode requires explicit `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` for Home/Townsquare service credentials.
- Hybrid EPM routes are OAuth-ready with user OAuth for Jira REST and service Basic for Home metadata.
- EPM all-project rollup worker threads carry captured OAuth auth context and no longer touch Flask request-local session.

## Main Review Questions

Ask Claude to answer these directly, with file and line references:

1. Is the plan order coherent, or are any tasks listed before their prerequisites exist?
2. Does any active plan still imply Home/Townsquare user 3LO is supported despite the current failing probe?
3. Does any active plan still store personal user API tokens as shared service credentials?
4. Does the new user API-token bridge correctly verify `accountId`, not email, before storing a token?
5. Are Home/Townsquare reads and writes separated cleanly enough?
6. Are normal users blocked from shared workspace configuration writes after DB roles land, while still allowed to manage user-owned settings?
7. Are token-bound CSRF and visible auth recovery screens prerequisites before browser-callable DB mutations?
8. Are cache keys explicitly partitioned by workspace plus user auth context or service-integration context?
9. Are local OAuth token-store helpers clearly forbidden after DB auth lands?
10. Are there stale tasks in the older OAuth/EPM plans that should be marked historical, removed, or cross-linked to the active DB service-integration path?

## Expected Claude Output

Use this prompt:

```text
Review the auth/DB/Home migration plan set on branch cdx/auth-db-context-plan.

Read docs/plans/SUPPORT-db-migration-claude-review-workflow.md first, then follow its read order.

Please produce a code-review-style plan review, not an implementation:
- Findings first, ordered Critical, Important, Minor.
- Each finding must cite file and line references.
- Focus on contradictions, missing prerequisites, security gaps, bad task order, stale tasks, and test gaps.
- Treat Home/Townsquare user 3LO as unsupported unless the plan documents a fresh PASS probe.
- Treat personal Atlassian API tokens as allowed only for verified per-user Home/Townsquare write credentials, never as shared service credentials.
- Do not propose broad refactors unless they remove a concrete risk in the plan.
- End with a short go/no-go recommendation for DB implementation readiness.
```

## Local Review Commands

Run these before sending the plan set to Claude:

```bash
rg -n "T[B]D|TO[D]O|im[p]lement later|fill in detail[s]|Similar to Tas[k]" docs/plans/EXEC-01-db-auth-foundation.md docs/plans/EXEC-02-db-home-user-api-token-bridge.md docs/plans/SUPPORT-db-migration-claude-review-workflow.md
git diff --check
git status --short
```

Optional, if Claude will review current code as well as plans:

```bash
env JIRA_AUTH_MODE=basic JIRA_EMAIL=test@example.com JIRA_TOKEN=test-token JIRA_URL=https://jira.example .venv/bin/python -m unittest discover -s tests
node tests/test_frontend_api_source_guards.js
node tests/test_auth_isolation_source_guard.js
```
