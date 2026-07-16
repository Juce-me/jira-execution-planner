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

8. `EXEC-shared-department-groups.md`
   - Active implementation plan for moving department/team-group definitions to workspace-shared configuration while keeping per-user visible-group preferences.
   - Expected output: any authenticated user can edit the shared group catalog, every user can discover shared groups, each user controls which groups appear in dashboard controls, shared saves are revision-conflict protected, and the existing default-group star remains shared.
   - Status note: the plan file currently says it was implemented on 2026-06-04. Treat it as prerequisite evidence for capacity-reporting plans and reconcile the filename/status before editing the shared group contract.

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

## Frontend Planning Workflow

1. `EXEC-auth-unfocused-auto-refresh.md`
   - Implemented pending merge. Amended 2026-07-16: the previously planned long-absence full-page reload was rejected and replaced with a refresh-only design. The superseded reload implementation remains unmerged on `feature/auth-unfocused-auto-refresh`.
   - Output: `frontend/src/api/authRefreshContract.js` holds the shared throttle/absence constants and event name; `frontend/src/api/authFocusRefresh.js` tracks continuous unfocused/hidden time and, after more than 12 minutes, issues one throttled `POST /api/auth/refresh` deduplicated across tabs via a shared `localStorage` timestamp, dispatching a `jep:auth-long-absence-return` `CustomEvent` on success; `frontend/src/dashboard.jsx` listens for that event and re-runs the same manual-refresh path the refresh button uses, gated by the same disabled condition. No document reload anywhere. `401` recovery (with and without `loginUrl`) is unchanged on both the initial and long-absence paths. `jira_server.py` adds a temporary, anonymized `after_request` diagnostics log (`jep.static_diagnostics`) scoped to `/`, `/jira-dashboard.html`, and `/frontend/dist/*` to identify the real owner of the originally reported repeated document/asset requests; it is explicitly temporary and slated for removal once that owner is identified. Content-hashed/immutable asset serving via a CDN/proxy remains deferred scope, not implemented here. Unit (`tests/test_auth_focus_refresh.js`), source-guard, and Playwright request-count coverage (`tests/ui/auth_focus_refresh_counts.spec.js`) prove: one document load produces one auth-script GET; focus/visibility bursts never add document or asset requests; multi-tab returns produce exactly one auth POST per cooldown window; a long absence refreshes only the active view's data; `401` recovery is intact.

2. `DONE-planning-default-selection-undo.md`
   - Completed and verified locally on 2026-06-09. Use for audit only; do not execute as active work.
   - Output: unseen future sprint/group scopes default to all visible Planning stories selected, Planning/Reporting epic Included/Excluded toggles persist to the selected group's shared `excludedCapacityEpics` config, manual checkbox edits persist until Select All, bulk status/select/clear actions can be undone to the loaded-page baseline, existing analytics events cover undo and shared excluded-capacity toggles, and focused Node/Python plus Playwright coverage verifies the behavior.

3. `EXEC-planning-selection-card-grid.md`
   - Active implementation plan for aligning Planning story selection controls with story-point metadata while keeping non-Planning and EPM card layouts unchanged.
   - Expected output: ENG Planning cards render story points, the rounded checkbox, and Jira key as the final meta-row cluster; selected Planning stories get a subtle selected tint/ring; Playwright geometry and selected-state assertions guard against layout creep.
   - Sequencing: when paired with `EXEC-css-feature-owned-partials.md`, execute this plan first, then move the resulting CSS into feature-owned partials.

4. `DONE-jira-oauth-planning-status-transitions.md`
   - Completed Jira OAuth-backed ENG Catch Up and Planning status changes across Epics, Stories, and Subtasks. Merged in [PR #100](https://github.com/Juce-me/jira-execution-planner/pull/100). Use for audit context only.
   - Output: Catch Up can transition one Epic, Story, or expanded Subtask at a time by clicking the displayed status; Planning can fetch transition options from clicked status pills/text and transition every selected status target through the signed-in user's Jira OAuth context; batch mode never silently truncates selected targets, rejects over-cap selections before mutation, preserves Story selection capacity math, and keeps EPM Jira/Home-backed issue surfaces view-only while `GATE-05` is blocked.

5. `EXEC-eng-priority-edit-mode.md`
   - Implemented and verified on branch `docs/eng-priority-edit-mode-plan` (commits `04be74a..8e4d764`), awaiting final review acceptance and user-confirmed merge; kept as `EXEC-` until merged. OAuth-backed ENG priority edits from the existing `task-priority-icon`, reusing the compact status dropdown UI/API pattern, and caching priority/status catalogs across app usage.
   - Expected output: Story and Epic priority icons open a compact dropdown whose option rows show the app's own priority icons and are filtered per issue to that project/issue-type scheme (via editmeta), fetched once per project/issue-type per app session; the menu dismisses on any outside click; priority writes use signed-in user Jira OAuth only; status transition option caching is widened safely without treating every status as universally transitionable; EPM remains read-only.

6. `EXEC-eng-targeted-task-updates.md`
   - Implemented and verified locally on `feature/eng-targeted-task-updates` across the execution commits listed in the plan; kept as `EXEC-` pending user review/merge.
   - Expected output: ENG Catch Up status and priority writes optimistically patch only the selected Epic, Story, or expanded Subtask, reconcile in the background through a four-request shared queue with same-key serialization, roll back failed writes, ignore stale scope completions, and never refetch the Catch Up task lists; Planning and non-ENG surfaces retain their existing behavior.

7. `EXEC-priority-refresh-preserve-team-filter.md`
   - Implemented and verified locally on `bugfix/priority-change-drops-single-team-filter` across the execution commits listed in the plan; kept as `EXEC-` pending user review/merge. Corrected during execution: team display names come from the team catalog lookup plus in-session retained task names, never `teamLabels` (Jira epic labels).
   - Expected output: configured group teams remain authoritative across Planning priority refreshes, true config removal still falls back to All Teams, behavioral Node and Playwright coverage passes, and generated dist is rebuilt.

8. `FUTURE-warm-team-catalog-team-names.md`
   - Deferred Minor follow-up to `EXEC-priority-refresh-preserve-team-filter.md`: warm the team catalog once per session, only when a configured team option is visibly degraded to its raw id, so cold loads show catalog display names without any unconditional initial-load request.
   - Expected output: degradation-triggered `GET /api/team-catalog` warm effect, Playwright proof of the rename plus a no-request guard when names already resolve, and no changes to selection behavior, `availableTeams`, or analytics events.

## Capacity Reporting Workflow

1. `SUPPORT-excluded-capacity-control-row-design.md`
   - Approved design for compacting Excluded Capacity into one desktop control row: Sprint first, Excluded Epics flexible in the middle, and both segmented controls grouped on the right.
   - Presentation-only scope; existing state, analytics, requests, and calculations remain unchanged.

2. `EXEC-excluded-capacity-control-row.md`
   - Implemented and verified locally on 2026-07-16; pending PR review/merge.
   - Output: Sprint first, Excluded Epics flexible in the middle, and both segmented controls aligned on the right, with focused source and rendered-geometry verification.

3. `EXEC-ad-hoc-capacity-epics.md`
   - Active implementation plan for adding department/team-group Ad Hoc capacity epic configuration as included Product capacity, separate from excluded capacity.
   - Expected output: `teamGroups.groups[].adHocCapacityEpics` round-trips through shared group config, Settings exposes a separate epic selector, Ad Hoc stories remain included in Product Planning and reporting, excluded capacity behavior remains driven only by `excludedCapacityEpics`, and affected Planning, Stats, Burndown, Lead Times, Mono vs Cross, and Scenario paths have focused verification.

4. `EXEC-statistics-consistency-bugfix.md`
   - Implemented and verified on branch `bugfix/statistics-consistency-exec`, integrated into `bugfix/statistics-colors-capacity-lead-time` (commits `a42e7ca..c4fb36c`); kept as `EXEC-` pending user review/merge to `main`. Shared Statistics team colors, removal of the redundant Excluded Capacity Range card, and a bounded Lead Times creation cohort with inclusive End Quarter. Decisions recorded in `SUPPORT-statistics-consistency-bugfix-design.md`.
   - Expected output: Priority, Burndown, Excluded Capacity, and Mono vs Cross consume one deterministic active-group color map; Excluded Capacity drops only its Range card; Lead Times adds an inclusive End Quarter with last-control-wins reconciliation, half-open Jira creation-date JQL, matching Jira links, and terminal dates preserved beyond the cohort boundary.

## Project Grade Security Hardening

1. `DONE-project-grade-security-hardening.md`
   - Completed project-grade hardening plan. Use for audit and release evidence; do not execute as active work.
   - Output: central endpoint policy registry, default-deny route guards, local-only dev diagnostics, loopback-safe startup defaults, security headers, project packaging metadata, CI backend/security checks, and a hardened release zip.
   - This plan does not authorize Home/Townsquare writes or Jira write-back. `GATE-05-home-write-capability.md` remains blocked unless its documented probe records `PASS home_project_update_supported`.

## Completed Frontend Structure

1. `EXEC-eng-story-subtasks.md`
   - Active implementation plan for lightweight ENG story subtask visibility.
   - Expected output: existing ENG task fetch includes a cheap embedded subtask summary, exact subtask rows load only after a user expands the story subtask control, no startup subtask fan-out is introduced, and count-based progress uses done/in-progress subtask counts rather than story points.

2. `EXEC-eng-compact-filter-epic-layout.md`
   - Active desktop-focused implementation plan for compacting ENG Catch Up filter cards and epic/story blocks with CSS-only scoped overrides.
   - Expected output: ENG `Show only` filters render as compact readable desktop controls, ENG epic/story cards use denser spacing, source guards prevent unscoped `.stat-card`/`.task-list` changes, and EPM issue-board rollups remain visually compatible through `.task-list:not(.epm-issue-board)` scoping.

3. `EXEC-alerts-panel-summary.md`
   - Active implementation plan for adding a persistent ENG alerts toolbar summary next to the toggle.
   - Expected output: `EngAlertsPanel` shows total alerts plus every non-zero alert category using existing alert colors/styles, stays visible open and collapsed, preserves existing toggle persistence, and includes source guards plus desktop/mobile Playwright visual proof.

4. `EXEC-eng-catch-up-control-stack.md`
   - Active implementation plan for unifying the ENG Catch Up alert summary, Show only stat filters, and Display toggles into a coherent, non-redundant control stack.
   - Expected output: upper ENG control rows share alignment, sizing, and visual hierarchy; stat filters use a compact content-aware treatment instead of distributed tiles; Killed is removed from Show only and owned only by the Display Killed toggle; focused Playwright/source guards prevent regressions and preserve EPM, Planning, Settings preview, and Scenario layouts.

5. `DONE-statistics-module-extraction.md`
   - Completed Statistics module extraction. Use for audit and prerequisite evidence; do not execute as active work.
   - Supersedes the stale root-level `statistics_module_extraction_plan.md` from `origin/plan/statistics-module-extraction`.
   - Output: remaining legacy Statistics Teams, Priority, and Burndown utilities/components extracted from `frontend/src/dashboard.jsx` into the existing `frontend/src/stats/` package, with source guards, focused Node tests, full unit verification, Playwright smoke coverage, regenerated frontend dist output, and shared bounded hover positioning for stats chart readouts.

6. `DONE-epm-project-reading-experience.md`
   - Completed EPM project reading experience plan in PR #41 (`94b759b`). Use for audit and prerequisite evidence; do not execute as active work.
   - Output: Home update freshness classification, stale/missing/unknown badges, stale date styling, visual fixture coverage, and freshness source guards for the EPM project board.

## Codebase Structure And Operability

1. `EXEC-application-hosting-readiness.md`
   - Active implementation plan for internal container-app hosting readiness.
   - Expected output: DB/OAuth works without local OAuth token files, hosted mode avoids local mutable JSON/cache state, frontend APIs default to same-origin behind ingress, Docker/Gunicorn packaging exists, and docs expose the runtime contract without secrets.

2. `DONE-codebase-operability-verification.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: local frontend unit/UI npm scripts, `make verify` for build/Python/security/Node/dist checks, and refreshed test-command documentation.

3. `DONE-codebase-operability-startup-preflight.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: operator preflight for runtime/auth/DB/encryption/migrations plus unified DB storage aliases.

4. `FUTURE-codebase-operability-improvements.md`
   - Deferred structural review and prioritized backlog for packaging, local verification, startup preflight, backend service extraction, frontend feature ownership, and source guards.
   - Do not execute directly. Convert each chosen slice into a separate `EXEC-*` plan before implementation.

5. `EXEC-css-feature-owned-partials.md`
   - Active implementation plan for splitting the remaining large dashboard CSS source files into feature-owned partials while preserving one bundled shipped stylesheet.
   - Expected output: `dashboard.css` remains the root ordered import entrypoint, large top-level CSS files become thin maps, feature-owned CSS files mirror ENG, Planning, Settings, Stats, Scenario, and EPM ownership, and source guards prevent top-level CSS from growing back.
   - Sequencing: when paired with `EXEC-planning-selection-card-grid.md`, execute the Planning card-grid plan first so this split can move the new Planning selectors after they exist.

6. `2026-05-01-codebase-structure-optimization.md`
   - Support/history context for earlier structure extraction work. Do not execute directly.

7. `DONE-codebase-operability-doc-cleanup.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: refreshed quickstart/setup docs, May 1 plan support/history status, and current README structure snapshot.

8. `DONE-codebase-operability-packaging-contract.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: explicit release-zip runnable-package contract and tests guarding the release zip shape.

9. `DONE-codebase-operability-import-safe-startup.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: import-safe `jira_server`, explicit Flask app creation, and launch-path startup validation.

10. `DONE-codebase-operability-request-context-guardrails.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: tests guarding explicit request auth context propagation through worker fan-out.

11. `DONE-codebase-operability-epm-aggregate-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: all-project EPM rollup orchestration moved to `backend/epm/aggregate.py` with `jira_server.py` shims preserved.

12. `DONE-codebase-operability-frontend-api-boundary.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: remaining Scenario, stats, issue lookup, and EPM config endpoint construction moved out of `frontend/src/dashboard.jsx` into `frontend/src/api/*` modules.

13. `DONE-codebase-operability-config-repository-selection.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: dashboard config load/save wrappers require explicit JSON selection when DB mode is active without request context.

14. `DONE-codebase-operability-epm-config-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: EPM config defaults and normalization helpers move into `backend/epm/config.py` with `jira_server.py` compatibility aliases preserved.

15. `DONE-codebase-operability-structural-budgets.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: source guard budgets prevent `jira_server.py` and `frontend/src/dashboard.jsx` from growing while extraction work continues, with ceilings ratcheted after follow-up extraction slices.

16. `DONE-codebase-operability-epm-issues-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: EPM project issues endpoint orchestration moved to `backend/epm/issues.py` with the Flask route reduced to request parsing, dependency wiring, and JSON response handling.

17. `DONE-codebase-operability-local-oauth-store-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: local OAuth token-store persistence, TTL cleanup, and refresh-lock mechanics moved to `backend/auth/local_oauth_store.py` with `jira_server.py` compatibility wrappers preserved.

18. `DONE-codebase-operability-css-split.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: `frontend/src/styles/dashboard.css` becomes an ordered import entrypoint over top-level CSS partials while esbuild still produces one bundled `frontend/dist/dashboard.css`.
   - Current accuracy: superseded for deeper CSS ownership by `EXEC-css-feature-owned-partials.md`.

19. `DONE-codebase-operability-epm-payload-helpers.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure EPM issue payload helpers moved to `backend/epm/payload.py` with `jira_server.py` compatibility aliases preserved.

20. `DONE-codebase-operability-eng-planning-capacity-utils.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure ENG Planning capacity status, team metadata, total capacity, and project-capacity split helpers moved to `frontend/src/eng/planningCapacityUtils.js` while Planning state and rendering remain in `frontend/src/dashboard.jsx`.

21. `DONE-codebase-operability-jira-issue-fetch-helpers.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: Jira issue key-batch and JQL pagination helpers moved to `backend/jira_client.py` with `jira_server.py` patchable wrappers preserved.

22. `DONE-codebase-operability-eng-planning-selection-stats.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure selected Planning task filtering and selected story-point/team/project aggregation helpers moved to `frontend/src/eng/planningSelectionStats.js` while Planning state and rendering remain in `frontend/src/dashboard.jsx`.

23. `DONE-codebase-operability-eng-planning-capacity-aggregates.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure Planning capacity table aggregation and entry-shaping helpers moved to `frontend/src/eng/planningCapacityUtils.js` while capacity fetching, Planning state, and rendering remain in `frontend/src/dashboard.jsx`.

24. `DONE-codebase-operability-capacity-service-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: Jira capacity JQL construction, capacity issue parsing, watcher fallback, and capacity route response handling moved out of `jira_server.py` into a backend service and route adapter while compatibility wrappers remain patchable.

25. `DONE-codebase-operability-dependency-focus-utils.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure dependency focus/key helpers shared by `dashboard.jsx` and issue dependency rendering move into `frontend/src/issues/dependencyFocusUtils.js` while dependency chip UI and lookup fetching remain unchanged.

26. `DONE-codebase-operability-sprint-service-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: sprint cache, board sprint loading, JQL fallback sprint discovery, and sprint de-duplication logic moved to `backend/services/sprints.py` while `jira_server.py` compatibility wrappers remain patchable.

27. `DONE-codebase-operability-planning-action-bar.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: the ENG Planning action button row moved to `frontend/src/eng/PlanningActionBar.jsx` while Planning state, handlers, capacity math, and persistence stay in `dashboard.jsx`.

28. `DONE-codebase-operability-stats-cache-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: completed-sprint stats file-cache load/save/invalidation and cache-key construction moved to `backend/services/stats_cache.py` while `jira_server.py` compatibility wrappers remain patchable.

29. `DONE-codebase-operability-planning-capacity-bar.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: the ENG Planning capacity bar and selected-summary fallback moved to `frontend/src/eng/PlanningCapacityBar.jsx` while Planning state, capacity math inputs, team microbars, and project split bars stay in `dashboard.jsx`.

30. `DONE-codebase-operability-update-check-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: `/api/version` git command, release-info fallback, and update payload construction moved to `backend/services/update_check.py` while `jira_server.py` compatibility wrappers remain patchable.

30. `DONE-codebase-operability-planning-project-split-bar.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: the ENG Planning selected-SP-by-project bar moved to `frontend/src/eng/PlanningProjectSplitBar.jsx` while selected project stat derivation, excluded capacity math, and Planning state stay in `dashboard.jsx`.

31. `DONE-codebase-operability-priority-weights-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: stats priority weight normalization, env parsing, and effective config selection moved to `backend/services/priority_weights.py` while `jira_server.py` compatibility wrappers remain patchable.

32. `DONE-codebase-operability-team-catalog-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: team catalog, catalog metadata, and group team-label normalization moved to `backend/services/team_catalog.py` while `jira_server.py` compatibility wrappers remain patchable.

33. `DONE-codebase-operability-group-config-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: team-group env parsing, validation, and default construction moved to `backend/services/group_config.py` while `jira_server.py` compatibility wrappers remain patchable.

## EPM Settings Bugfixes

1. `EXEC-epm-label-config-bugfixes.md`
   - Bugfix plan for the EPM Settings → Projects label configuration. Implemented and
     verified on branch `bugfix/epm-label-config` (commits `2138ab1`, `b24a091`,
     `b39e1f7`/`ac3dcaf`, `78a6b06`/`12af7da`); pending merge. Rename to `DONE-*` after merge.
   - Expected output: the label-prefix mask `*` is stripped before the Jira
     `startswith` filter so prefix autocomplete returns results, the label dropdown
     opens reliably from "Choose label" (no anchor race), every project row has one
     consistent compact delete with session-only removal plus a clear notice that
     Home-discovered projects reappear until closed/paused/archived in Jira Home, and
     the active label prefix is shown as a hint pill with a descriptive placeholder.
   - No new routes, no auth-mode change, no Home/Jira writes; `GATE-05` unaffected.

## ENG Epic Sort And Track

1. `EXEC-eng-epic-sort-and-track.md`
   - Active implementation plan for read-only epic header enrichment plus epic ordering in the ENG view.
   - Expected output: each ENG epic header shows an effective-priority pill (highest-urgency child) and a Product Track emoji (🔒 Committed / 🤷 Flexible) read from the configurable `projectTrackField` Jira custom field (default `customfield_35024`); a single `sprint-dropdown`-styled Sort control orders epics by Priority, Status (built-in workflow-phase fallback), or Track (committed-first / flexible-first), each tie-broken by priority, with the choice persisted in localStorage UI prefs.
   - No new routes, no Jira writes, no auth-mode change; `GATE-05` unaffected. The board-imported per-group workflow source and group-by-kanban-column grouping are deferred to a separate future plan; the sort comparator already accepts an injected phase-rank map.

## Stats Project Track By Sprint

1. `EXEC-stats-project-track-by-sprint.md`
   - Implemented on branch `feature/stats-project-track-quarters`; pending merge. Rename to `DONE-*` after merge.
   - Expected output: a `Project Track` ENG stats sub-tab (after `Mono vs Cross`) with a filter bar (shared Start/End sprint range, Capacity side Product/Tech/Tech+Product, Exclude Ad Hoc, Exclude Excluded Capacity, Mode Epic/Team), a mode title, a range totals bar, a per-sprint chart (hidden for a single-sprint range), a By assignee/By team breakdown, and an Epic-mode-only time-in-phase section built from a new bounded, read-only `POST /api/stats/project-track-phase-durations` endpoint.
   - No Jira/Home writes, no auth-mode change; `GATE-05` unaffected. See the plan's `## Outcome` and `## Current Accuracy` sections for as-built divergences from the original endpoint-contract text (response field names, absence of `cached`/`generatedAt`, client-side signature caching).

## Stats Controls Unification

1. `EXEC-stats-controls-unification.md`
   - Initial implementation completed on `improvement/stats-controls-unification` (2026-07-15, execution commits `331f3c9..2d5f0a7`; full JS/Python/Playwright regression green apart from 2 pre-existing `eng_alerts_panel_summary` failures inherited from the ancestor branch). The Lead Times control-row compaction follow-up was implemented in `8b3f32d` (`fix: compact lead times controls`) on 2026-07-16. Final-review fix `16ff875` (`fix: contain stats range panels`) constrains all mobile stats range groups/panels without changing the global Sprint and aligns the six actual Lead Times control surfaces. Fresh verification: source guards 15/15, focused Playwright 4/4 across all four range views and Task 7 exclusions/layout, frontend unit 519/519, structure budget 1/1, and build green. Inspected desktop and three 375px screenshots show aligned Lead Times controls and readable, normally clickable long sprint options contained within each narrow stats panel. The measured 966px stats container uses the approved 8.5rem select flex basis instead of the planned 12rem, which required 1067px and wrapped Exclude. The plan remains `EXEC-` pending acceptance/merge; not pushed. The implementation unifies Statistics Start/End ranges through one stats-owned component extracted from the existing `sprint-dropdown` pattern, reusing `ControlField`, `.controls-label`, `.view-filters`, `.sprint-dropdown*`, `SegmentedControl`, and the corrected Project Track checkbox treatment; per-task divergence notes live in the plan.
   - Expected output: Excluded Capacity, Mono vs Cross, Project Track, and Lead Times share one accessible downward-opening range-control implementation; Lead Times Group By uses the existing segmented control; its capacity filters render as an `Exclude` group with `Ad Hoc` + `Excluded Capacity` checkboxes while retaining explicit accessible names; range/refetch/persistence semantics stay unchanged and receive pointer, keyboard, view-switch, reload, layer, and narrow-viewport verification.
   - No backend route, auth/CSRF, Jira/Home credential, mutation, or new analytics-event contract; the global sticky Sprint control, Project select, and Assignee select remain out of scope.

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

## Repo Hygiene

- `EXEC-root-cleanup-docs-postmortems.md`
  - Root-folder cleanup: icons to `assets/`, `install.sh` to `scripts/`, postmortems to `docs/postmortem/`, redundant root docs removed, AGENTS/README aligned.
