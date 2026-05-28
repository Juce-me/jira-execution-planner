# Plan Index And Naming

Use this file to choose the right plan before starting auth, DB, or Home/Townsquare work.

`docs/plans/` uses the prefix taxonomy below. The date/status naming rules in `docs/agents.md` apply to the separate `docs/agents/` artifact namespace, not to this directory. `docs/agents/` may be absent until the first real artifact is created.

## Prefixes

- `EXEC-*`: implementation-ready execution plans. Run these in numeric order unless a plan says it is gated or explicitly independent of the previous `EXEC-*` plan.
- `DONE-*`: completed and verified execution plans. Keep these for audit/history only; do not execute them as active plans.
- `GATE-*`: blocked external capability gates. Check these at session startup for relevant auth, DB, Home/Townsquare, EPM, or plan work, then update `Checked on` and `Last result`.
- `SUPPORT-*`: review, handoff, or operator support documents. Do not execute them as implementation plans.
- `FUTURE-*`: deferred scope. Do not pull these into the current implementation unless the scope is explicitly reopened.
- Do not create new date-only docs in `docs/plans/`. Use one of the prefixes above so execution state is visible from the filename.

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

5. `DONE-04-db-user-home-epm-read-token.md`
   - Completed per-user Home token requirement for DB/OAuth EPM reads. Use for audit and prerequisite evidence; do not execute as active work.
   - Output: DB/OAuth EPM is hidden until the current user connects a Home/Townsquare API token in Settings, then EPM Home reads use that user-owned token while Jira REST remains OAuth-backed.

6. `GATE-05-home-write-capability.md`
   - Blocked external capability gate for Jira Home/Townsquare project update writes.
   - Expected output while blocked: checked date and status only. If it passes, create or execute a separate Home write implementation plan.

7. `FUTURE-db-additional-features.md`
   - Execute only after the DB auth and user-configuration phases are complete and explicitly reopened.

## Completed Scenario Planner Workflow

1. `DONE-scenario-planner-quarter-drafts-00-overview.md`
   - Completed DB-backed Scenario draft-history split and canonical `/api/scenario/drafts` contract. Use for audit context only.

2. `DONE-scenario-planner-quarter-drafts-01-persistence-api.md`
   - Output: one shared active Scenario draft per workspace plus sprint/team/group scope, append-only version history, rollback, and legacy `/api/scenario/overrides` compatibility.

3. `DONE-scenario-planner-quarter-drafts-02-frontend-history.md`
   - Output: Scenario UI loads active drafts, saves new versions, reloads snapshots, rolls back before write-back, and handles stale saves without losing local edits.

4. `DONE-scenario-planner-quarter-drafts-03-collaboration-writeback-gate.md`
   - Output: real-time awareness through SSE/polling, advisory presence/locks, multi-user conflict recovery, and a Jira write-back route that remains blocked. Real Jira mutation still requires a separate future `EXEC-*` plan.
   - Future Jira publish/write-back must use only the signed-in user's OAuth Jira REST context; do not use Jira/Home API tokens, Basic credentials, service integrations, Home/Townsquare APIs, or local token-store helpers.
   - Scenario group scope is a shared environment-scoped PM/EPM-managed configuration reference; drafts may reference groups but must not create private group definitions or own group membership.

## Project Grade Security Hardening

1. `DONE-project-grade-security-hardening.md`
   - Completed project-grade hardening plan. Use for audit and release evidence; do not execute as active work.
   - Output: central endpoint policy registry, default-deny route guards, local-only dev diagnostics, loopback-safe startup defaults, security headers, project packaging metadata, CI backend/security checks, and a hardened release zip.
   - This plan does not authorize Home/Townsquare writes or Jira write-back. `GATE-05-home-write-capability.md` remains blocked unless its documented probe records `PASS home_project_update_supported`.

## Completed Frontend Structure

1. `DONE-statistics-module-extraction.md`
   - Completed Statistics module extraction. Use for audit and prerequisite evidence; do not execute as active work.
   - Supersedes the stale root-level `statistics_module_extraction_plan.md` from `origin/plan/statistics-module-extraction`.
   - Output: remaining legacy Statistics Teams, Priority, and Burndown utilities/components extracted from `frontend/src/dashboard.jsx` into the existing `frontend/src/stats/` package, with source guards, focused Node tests, full unit verification, Playwright smoke coverage, regenerated frontend dist output, and shared bounded hover positioning for stats chart readouts.

## Future Codebase Structure And Operability

1. `EXEC-codebase-operability-verification.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: local frontend unit/UI npm scripts, `make verify` for build/Python/security/Node/dist checks, and refreshed test-command documentation.

2. `EXEC-codebase-operability-startup-preflight.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: operator preflight for runtime/auth/DB/encryption/migrations plus unified DB storage aliases.

3. `FUTURE-codebase-operability-improvements.md`
   - Deferred structural review and prioritized backlog for packaging, local verification, startup preflight, backend service extraction, frontend feature ownership, and source guards.
   - Do not execute directly. Convert each chosen slice into a separate `EXEC-*` plan before implementation.

4. `2026-05-01-codebase-structure-optimization.md`
   - Support/history context for earlier structure extraction work. Do not execute directly.

5. `EXEC-codebase-operability-doc-cleanup.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: refreshed quickstart/setup docs, May 1 plan support/history status, and current README structure snapshot.

6. `EXEC-codebase-operability-packaging-contract.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: explicit release-zip runnable-package contract and tests guarding the release zip shape.

7. `EXEC-codebase-operability-import-safe-startup.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: import-safe `jira_server`, explicit Flask app creation, and launch-path startup validation.

8. `EXEC-codebase-operability-request-context-guardrails.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: tests guarding explicit request auth context propagation through worker fan-out.

9. `EXEC-codebase-operability-epm-aggregate-extraction.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: all-project EPM rollup orchestration moved to `backend/epm/aggregate.py` with `jira_server.py` shims preserved.

10. `EXEC-codebase-operability-frontend-api-boundary.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: remaining Scenario, stats, issue lookup, and EPM config endpoint construction moved out of `frontend/src/dashboard.jsx` into `frontend/src/api/*` modules.

11. `EXEC-codebase-operability-config-repository-selection.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: dashboard config load/save wrappers require explicit JSON selection when DB mode is active without request context.

12. `EXEC-codebase-operability-epm-config-extraction.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: EPM config defaults and normalization helpers move into `backend/epm/config.py` with `jira_server.py` compatibility aliases preserved.

13. `EXEC-codebase-operability-structural-budgets.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: source guard budgets prevent `jira_server.py` and `frontend/src/dashboard.jsx` from growing while extraction work continues.

14. `EXEC-codebase-operability-epm-issues-extraction.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: EPM project issues endpoint orchestration moved to `backend/epm/issues.py` with the Flask route reduced to request parsing, dependency wiring, and JSON response handling.

15. `EXEC-codebase-operability-local-oauth-store-extraction.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: local OAuth token-store persistence, TTL cleanup, and refresh-lock mechanics moved to `backend/auth/local_oauth_store.py` with `jira_server.py` compatibility wrappers preserved.

16. `EXEC-codebase-operability-css-split.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: `frontend/src/styles/dashboard.css` becomes an ordered import entrypoint over feature-owned partials while esbuild still produces one bundled `frontend/dist/dashboard.css`.

17. `EXEC-codebase-operability-epm-payload-helpers.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: pure EPM issue payload helpers moved to `backend/epm/payload.py` with `jira_server.py` compatibility aliases preserved.

18. `EXEC-codebase-operability-eng-planning-capacity-utils.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: pure ENG Planning capacity status, team metadata, total capacity, and project-capacity split helpers moved to `frontend/src/eng/planningCapacityUtils.js` while Planning state and rendering remain in `frontend/src/dashboard.jsx`.

19. `EXEC-codebase-operability-jira-issue-fetch-helpers.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: Jira issue key-batch and JQL pagination helpers moved to `backend/jira_client.py` with `jira_server.py` patchable wrappers preserved.

20. `EXEC-codebase-operability-eng-planning-selection-stats.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: pure selected Planning task filtering and selected story-point/team/project aggregation helpers moved to `frontend/src/eng/planningSelectionStats.js` while Planning state and rendering remain in `frontend/src/dashboard.jsx`.

21. `EXEC-codebase-operability-eng-planning-capacity-aggregates.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: pure Planning capacity table aggregation and entry-shaping helpers moved to `frontend/src/eng/planningCapacityUtils.js` while capacity fetching, Planning state, and rendering remain in `frontend/src/dashboard.jsx`.

22. `EXEC-codebase-operability-capacity-service-extraction.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: Jira capacity JQL construction, capacity issue parsing, watcher fallback, and capacity route response handling moved out of `jira_server.py` into a backend service and route adapter while compatibility wrappers remain patchable.

23. `EXEC-codebase-operability-dependency-focus-utils.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: pure dependency focus/key helpers shared by `dashboard.jsx` and issue dependency rendering move into `frontend/src/issues/dependencyFocusUtils.js` while dependency chip UI and lookup fetching remain unchanged.

24. `EXEC-codebase-operability-sprint-service-extraction.md`
   - Implemented locally and verified on 2026-05-28; keep as `EXEC-*` until acceptance or merge.
   - Expected output: sprint cache, board sprint loading, JQL fallback sprint discovery, and sprint de-duplication logic moved to `backend/services/sprints.py` while `jira_server.py` compatibility wrappers remain patchable.

## Legacy Unclassified Date-Only Plans

These files predate the `EXEC`/`DONE`/`GATE`/`SUPPORT`/`FUTURE` taxonomy. Treat them as unclassified historical context, not executable current plans, until a reviewer classifies and renames them or moves them to `docs/agents/`:

- `2026-03-03-epic-lead-time-cohort-design.md`
- `2026-03-03-epic-lead-time-cohort.md`
- `2026-03-04-create-stories-alert.md`
- `2026-03-06-create-stories-alert-design.md`
- `2026-03-06-split-team-catalog-design.md`
- `2026-03-06-split-team-catalog-plan.md`
- `2026-03-13-compact-sticky-header-design.md`
- `2026-03-13-compact-sticky-header.md`
- `2026-03-18-config-save-refresh-design.md`
- `2026-03-18-config-save-refresh.md`
- `2026-03-24-epic-icon-swap-design.md`
- `2026-03-24-epic-icon-swap.md`
- `2026-03-24-needs-stories-alert.md`
- `2026-03-30-planning-module-improvements-design.md`
- `2026-03-30-planning-module-improvements.md`
- `2026-03-31-scenario-planner-improvements.md`
- `2026-03-31-team-selection-persistence-and-compact-team-cards-design.md`
- `2026-03-31-team-selection-persistence-and-compact-team-cards.md`
- `2026-04-09-incomplete-stories-visual.md`
- `2026-04-10-initiative-level-grouping.md`
- `2026-04-20-epm-project-view.md`
- `2026-04-21-epm-project-rollup.md`
- `2026-04-27-epm-active-sprint-visibility.md`
- `2026-04-27-epm-project-config-tab-cache.md`
- `2026-04-27-epm-view-extraction.md`
- `2026-04-28-epm-goals-2-3-portfolio-active-sprint.md`
- `2026-04-28-epm-zero-manual-portfolio-default.md`
- `2026-04-29-epm-portfolio-ui-cleanup.md`
- `2026-05-04-epm-multi-subgoal-scope.md`

## Known Artifact Drift

Use this section to avoid treating missing historical artifacts as current work:

- Legacy EPM plans that reference `frontend/src/epm/epmFetch.js` predate the frontend API consolidation. Current EPM API wrappers live in `frontend/src/api/epmApi.js`; `2026-05-01-codebase-structure-optimization.md` records that history.
- `docs/features/epm-rollup.md` was optional in `2026-04-21-epm-project-rollup.md` and is not present in this checkout. Current operator-facing EPM rollup guidance lives in `docs/features/epm-view.md`.
- `2026-04-21-epm-settings-scope-and-linkage.md` and `2026-04-21-epm-goal-picker.md` were branch-only predecessor plans referenced by `2026-04-21-epm-project-rollup.md`; they are not present in this checkout.
- Missing files named under `Create:` or unchecked task lists inside legacy, `DONE-*`, or `SUPPORT-*` plans are not automatically current missing artifacts. Create them only when a reviewed `EXEC-*` plan or explicit reopened scope requires them.
- Generated local cache files such as `team-groups.json`, `team-catalog.json`, and `sprints_cache.json` may be absent in a checkout and should not be recreated for documentation cleanup.

## Expectations

- Before executing any `EXEC-*` plan, run the preflight commands named in that plan.
- At session startup for relevant auth, DB, Home/Townsquare, EPM, or plan work, check every `GATE-*` doc and update `Checked on` plus `Last result`.
- Keep Home/Townsquare user 3LO blocked unless `scripts/check_home_graphql_oauth.py` records a real `PASS home_graphql_3lo_supported`.
- Before the `DONE-04` commits, workspace Home/Townsquare reads were service-integration-backed while the Home 3LO gate failed.
- `DONE-04` supersedes that earlier service-backed EPM read assumption for DB/OAuth mode: EPM Home reads use the current user's connected `atlassian_user_api_token`, and that token is never a shared service credential.
- Commit each completed task with the commit message specified in the plan.
- Rename an `EXEC-*` plan to `DONE-*` only after implementation is completed, verified, and accepted or merged, then add a top status note with the execution commit or PR.
