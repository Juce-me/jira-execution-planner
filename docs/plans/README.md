# Plan Index And Naming

Use this file to choose the right plan before starting auth, DB, or Home/Townsquare work.

## Prefixes

- `EXEC-*`: implementation-ready execution plans. Run these in numeric order unless a plan says it is gated or explicitly independent of the previous `EXEC-*` plan.
- `DONE-*`: completed and verified execution plans. Keep these for audit/history only; do not execute them as active plans.
- `GATE-*`: blocked external capability gates. Check these at session startup for relevant auth, DB, Home/Townsquare, EPM, or plan work, then update `Checked on` and `Last result`.
- `SUPPORT-*`: review, handoff, or operator support documents. Do not execute them as implementation plans.
- `FUTURE-*`: deferred scope. Do not pull these into the current implementation unless the scope is explicitly reopened.
- Do not create new date-only auth/DB/Home migration docs. Use one of the prefixes above so execution state is visible from the filename.

## Current DB Workflow

1. `SUPPORT-db-migration-claude-review-workflow.md`
   - Use first for external review or handoff.
   - Expected output: findings and a go/no-go recommendation, not code changes.

2. `DONE-01-db-auth-foundation.md`
   - Completed first DB implementation plan. Use for audit and prerequisite evidence; do not execute as active work.
   - Expected output: DB-backed users, workspaces, auth connections, encrypted tokens, service integrations, admin inspection, token-bound CSRF, cache partitioning, and auth recovery surfaces.

3. `DONE-02-db-home-user-api-token-bridge.md`
   - Completed user-owned Atlassian API-token connection bridge. Use for audit and prerequisite evidence; do not execute as active work.
   - Expected output: optional per-user Atlassian API-token connection for future explicit Home/Townsquare writes while Home user 3LO is unsupported.

4. `DONE-03-db-user-configuration.md`
   - Completed DB user-configuration plan. Use for audit and prerequisite evidence; do not execute as active work.
   - Expected output: DB-backed user-owned saved views. EPM configuration is user-owned, including Home goal scope and project label mappings; service integrations remain admin/operator-controlled.

5. `EXEC-04-db-user-home-epm-read-token.md`
   - Execute after `DONE-03` user-owned EPM configuration is stable.
   - Expected output: DB/OAuth EPM is hidden until the current user connects a Home/Townsquare API token in Settings, then EPM Home reads use that user-owned token while Jira REST remains OAuth-backed.

6. `GATE-05-home-write-capability.md`
   - Blocked external capability gate for Jira Home/Townsquare project update writes.
   - Expected output while blocked: checked date and status only. If it passes, create or execute a separate Home write implementation plan.

7. `FUTURE-db-additional-features.md`
   - Execute only after the DB auth and user-configuration phases are complete and explicitly reopened.

## Expectations

- Before executing any `EXEC-*` plan, run the preflight commands named in that plan.
- At session startup for relevant auth, DB, Home/Townsquare, EPM, or plan work, check every `GATE-*` doc and update `Checked on` plus `Last result`.
- Keep Home/Townsquare user 3LO blocked unless `scripts/check_home_graphql_oauth.py` records a real `PASS home_graphql_3lo_supported`.
- Before the `EXEC-04` commits, workspace Home/Townsquare reads were service-integration-backed while the Home 3LO gate failed.
- `EXEC-04` supersedes that earlier service-backed EPM read assumption for DB/OAuth mode: EPM Home reads use the current user's connected `atlassian_user_api_token`, and that token is never a shared service credential.
- Commit each completed task with the commit message specified in the plan.
- Rename an `EXEC-*` plan to `DONE-*` only after implementation is completed, verified, and accepted or merged, then add a top status note with the execution commit or PR.
