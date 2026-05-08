# Plan Index And Naming

Use this file to choose the right plan before starting auth, DB, or Home/Townsquare work.

## Prefixes

- `EXEC-*`: implementation-ready execution plans. Run these in numeric order unless a plan says it is gated.
- `SUPPORT-*`: review, handoff, or operator support documents. Do not execute them as implementation plans.
- `FUTURE-*`: deferred scope. Do not pull these into the current implementation unless the scope is explicitly reopened.
- Date-only files: historical, feature-specific, or gate-specific plans. Read them when an `EXEC-*` or `SUPPORT-*` file points to them.

## Current DB Workflow

1. `SUPPORT-db-migration-claude-review-workflow.md`
   - Use first for external review or handoff.
   - Expected output: findings and a go/no-go recommendation, not code changes.

2. `EXEC-01-db-auth-foundation.md`
   - First implementation plan.
   - Expected output: DB-backed users, workspaces, auth connections, encrypted tokens, service integrations, admin inspection, token-bound CSRF, cache partitioning, and auth recovery surfaces.

3. `EXEC-02-db-home-user-api-token-bridge.md`
   - Execute only after `EXEC-01` has encrypted token storage, active user/connection checks, service integrations, and token-bound CSRF.
   - Expected output: optional per-user Atlassian API-token connection for explicit Home/Townsquare writes while Home user 3LO is unsupported.

4. `EXEC-03-db-user-configuration.md`
   - Execute only after `EXEC-01` is stable.
   - Expected output: DB-backed workspace defaults and user-owned saved views, with shared mappings still admin-controlled.

5. `FUTURE-db-additional-features.md`
   - Execute only after the DB auth and user-configuration phases are complete and explicitly reopened.

## Expectations

- Before executing any `EXEC-*` plan, run the preflight commands named in that plan.
- Keep Home/Townsquare user 3LO blocked unless `scripts/check_home_graphql_oauth.py` records a real `PASS home_graphql_3lo_supported`.
- Keep workspace Home/Townsquare reads service-integration-backed while the Home 3LO gate fails.
- Treat user-owned Atlassian API tokens as Home/Townsquare write credentials only; never as shared service credentials.
- Commit each completed task with the commit message specified in the plan.
