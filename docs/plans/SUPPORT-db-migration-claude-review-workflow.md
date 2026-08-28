# SUPPORT: Claude DB Migration Plan Review Prompt

> **Review-only packet:** Do not execute implementation tasks from this file. Use it as the clean prompt for an external Claude review of the auth/DB/Home migration plans on `cdx/auth-db-context-plan`.

## Prompt

Copy this into Claude from the repository root:

```text
You are reviewing the Jira Delivery Planner auth/DB/Home migration plan set on branch cdx/auth-db-context-plan.

This is a plan review, not an implementation. Do not edit files. Do not implement tasks. Produce findings and a go/no-go recommendation for execution readiness.

Repository context:
- Backend: Python + Flask.
- Frontend: React + esbuild.
- Current branch: cdx/auth-db-context-plan.
- Active DB plans use these prefixes:
  - EXEC-* = implementation-ready or gated execution plans.
  - SUPPORT-* = review, handoff, or operator-support docs.
  - FUTURE-* = deferred scope.
  - DONE-* = completed, verified, accepted/merged execution plans kept for audit.

Plan packet to review:
- docs/plans/README.md
- docs/plans/AGENTS.md
- docs/SUPPORT-atlassian-oauth-setup.md
- docs/plans/SUPPORT-atlassian-oauth-auth.md
- docs/plans/SUPPORT-oauth-jira-client-route-migration.md
- docs/plans/SUPPORT-epm-home-oauth-migration.md
- docs/plans/DONE-01-db-auth-foundation.md
- docs/plans/DONE-02-db-home-user-api-token-bridge.md
- docs/plans/DONE-03-db-user-configuration.md
- docs/plans/FUTURE-db-additional-features.md

Read order:
1. AGENTS.md
2. docs/plans/README.md
3. docs/plans/AGENTS.md
4. docs/SUPPORT-atlassian-oauth-setup.md
5. docs/plans/SUPPORT-atlassian-oauth-auth.md
6. docs/plans/SUPPORT-oauth-jira-client-route-migration.md
7. docs/plans/SUPPORT-epm-home-oauth-migration.md
8. docs/plans/DONE-01-db-auth-foundation.md
9. docs/plans/DONE-02-db-home-user-api-token-bridge.md
10. docs/plans/DONE-03-db-user-configuration.md
11. docs/plans/FUTURE-db-additional-features.md

Current implementation assumptions to preserve:
- Tool admin is a tool-local role, not an Atlassian admin role.
- Legacy pre-DB OAuth treated every signed-in Atlassian user as a local tool admin only as a temporary local policy. DB auth restored explicit tool-admin assignment.
- Team Groups, Group Labels, and EPM-side user settings are user-owned/non-admin workflows where applicable.
- Scope projects, Jira source, field mapping, capacity, priority weights, and dashboard issue types are shared environment/workspace configuration controlled by tool admins. EPM scope, label prefix, issue types, and project-label mappings are stored in the owning user's default private saved view. EPM tab and sprint are private UI state; existing private-view values are preserved but never promoted to shared configuration.
- Existing JSON configuration must not be silently overwritten with empty selected projects, empty groups, or missing EPM mappings.
- Home/Townsquare user 3LO is currently unsupported unless the plans document a fresh real `PASS home_graphql_3lo_supported` probe.
- Jira REST can use user Atlassian OAuth.
- DB/OAuth Home/Townsquare metadata reads use the current user's verified `atlassian_user_api_token` while the Home 3LO gate fails. The connection is represented in `auth_connections`, its API token is encrypted in `auth_tokens`, and neither may become shared service configuration.
- Home/Townsquare writes remain separately gated and are not authorized by the EPM read-token path.
- A user API token must be verified by calling Jira `/rest/api/3/myself` and matching returned `accountId` to the signed-in OAuth `account_id`; email is not identity proof.

Expected execution order to validate:
1. Re-run the OAuth/Jira/Home preflight named in DONE-01 when auditing the completed foundation.
2. Treat DONE-01 as completed audit context, not active execution work.
   - Task 0 is already completed pre-DB.
   - Tasks 1-8 are the active DB auth path.
3. Keep Home/Townsquare EPM reads user-scoped during DB auth:
   - user OAuth for Jira REST;
   - current-user `atlassian_user_api_token` for Home metadata;
   - DB `auth_connections` plus encrypted `auth_tokens`, with no local token-store or service-integration fallback;
   - cache partitioning by workspace, user, token version, and normalized EPM configuration digest.
4. Treat DONE-02 as completed user-token bridge context after DONE-01 has encrypted token storage, active user/connection checks, token-bound CSRF, and service integrations.
   - The bridge supplies the current user's Home/Townsquare EPM metadata reads while user 3LO is unsupported.
   - It is not required for login or ENG dashboard load, but EPM remains hidden until the connection exists.
   - If no concrete Home/Townsquare write action exists, flag any generic mutation task as not execution-ready.
5. Treat DONE-03 as completed user-configuration context after DONE-01 is stable and JSON fallback behavior is verified.
6. Treat FUTURE-db-additional-features.md as deferred scope unless explicitly reopened.

Review questions:
1. Is the plan order coherent, or are tasks listed before prerequisites exist?
2. Does DONE-01 still contain blockers or preconditions that are unresolved by the current branch?
3. Does any active plan imply Home/Townsquare user 3LO is supported despite the current failing probe?
4. Does any active plan store personal user API tokens as shared service credentials?
5. Does DONE-02 verify `accountId`, not email, before storing a user API token?
6. Do DB/OAuth Home/Townsquare reads use only the current user's `atlassian_user_api_token` from DB connection/token tables, and are writes still separately gated?
7. Are normal users blocked from shared workspace configuration writes after DB roles land while still allowed to manage user-owned settings?
8. Are token-bound CSRF and visible auth recovery screens prerequisites before browser-callable DB mutations?
9. Are EPM cache keys explicitly partitioned by workspace, user, token version, and the digest of the
   canonical normalized EPM configuration?
10. Are local OAuth token-store helpers clearly forbidden after DB auth lands?
11. Are stale tasks in the older OAuth/EPM plans marked historical or cross-linked to the active
    per-user DB connection/token path?
12. Is every EXEC plan implementable task-by-task by a coding agent without guessing missing file names, route names, credentials, or expected tests?

Output format:
- Findings first, ordered by severity: Critical, Important, Minor.
- Each finding must cite file and line references.
- Focus on contradictions, missing prerequisites, security gaps, bad task order, stale tasks, and test gaps.
- For each finding, state the exact plan edit needed before execution.
- Add an execution-readiness rating for each plan:
  - Ready
  - Gated
  - Not ready
- End with one DB implementation go/no-go recommendation and the first executable next step.

Do not propose broad refactors unless they remove a concrete execution or security risk in the plans.
Do not ask implementers to re-solve already-fixed pre-DB behavior unless you can cite a regression.
Do not include secrets, tokens, OAuth callback query strings, local absolute paths, or real Jira fixture data in the review output.
```

## Local Checks Before Review

Run these before sending the prompt to Claude:

```bash
git status --short
git log --oneline -15
rg -n "T[B]D|TO[D]O|im[p]lement later|fill in detail[s]|Similar to Tas[k]" docs/plans/DONE-01-db-auth-foundation.md docs/plans/DONE-02-db-home-user-api-token-bridge.md docs/plans/DONE-03-db-user-configuration.md docs/plans/SUPPORT-db-migration-claude-review-workflow.md
git diff --check
```

If Claude will review current code as well as plans, also run:

```bash
env JIRA_AUTH_MODE=basic JIRA_EMAIL=test@example.com JIRA_TOKEN=test-token JIRA_URL=https://jira.example .venv/bin/python -m unittest discover -s tests
node tests/test_frontend_api_source_guards.js
node tests/test_auth_isolation_source_guard.js
```

Do not paste secrets, token values, OAuth callback URLs, probe payloads with token material, or real Jira fixture data into Claude.
