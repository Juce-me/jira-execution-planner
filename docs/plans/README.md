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
   - Output: DB-backed user-owned saved views, including private EPM scope, label prefix, issue types, and project-label mappings. EPM tab and sprint are private UI state; existing private-view values remain preserved. PR #130 temporarily moved normalized EPM settings into workspace configuration; `DONE-user-owned-epm-configuration.md` corrects that ownership regression.

5. `DONE-04-db-user-home-epm-read-token.md`
   - Completed per-user Home token requirement for DB/OAuth EPM reads. Use for audit and prerequisite evidence; do not execute as active work.
   - Output: DB/OAuth EPM is hidden until the current user connects a Home/Townsquare API token in Settings, then EPM Home reads use that user-owned token while Jira REST remains OAuth-backed.

6. `GATE-05-home-write-capability.md`
   - Blocked external capability gate for Jira Home/Townsquare project update writes.
   - Expected output while blocked: checked date and status only. If it passes, create or execute a separate Home write implementation plan.

7. `FUTURE-db-additional-features.md`
   - Execute only after the DB auth and user-configuration phases are complete and explicitly reopened.

8. `DONE-shared-department-groups.md`
   - Completed and merged in [PR #62](https://github.com/Juce-me/jira-execution-planner/pull/62). Moves department/team-group definitions to workspace-shared configuration while keeping per-user visible-group preferences. Use for audit and prerequisite evidence; do not execute as active work.
   - Historical output: any authenticated user can edit the shared group catalog, every user can discover shared groups, each user controls which groups appear in dashboard controls, and shared saves are revision-conflict protected. PR #62 left the existing star wired to shared `defaultGroupId`; `DONE-personal-group-star.md` corrects that product mismatch without rewriting shared catalog history.

9. `DONE-shared-admin-configuration.md`
   - Completed and merged in PR #130 (`7ea40db`). Use for audit context only.
   - Current output: administrator dashboard sections persist once per workspace/Jira site with revisioned, authorized writes; normal-user catalog refreshes use separate storage; no private payload is auto-promoted. Its shared-EPM decision is superseded by `DONE-user-owned-epm-configuration.md`.
   - Execution record: `../agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md`.

10. `DONE-user-owned-epm-configuration.md`
   - Completed, verified, and accepted correction for the ownership regression identified after PR #130. Use for audit context only.
   - Current output: EPM settings use each user's default private saved view and every functional EPM path uses that source; cache keys include a normalized-configuration digest and every effective-default change performs post-commit user-partitioned invalidation; legacy import discards derived `teamCatalog`; misplaced workspace EPM is held in a reversible archive without an inferred owner; and every application API `401` terminally locks the whole app behind one sanitized same-tab sign-in recovery screen. Department groups remain workspace-shared and user-editable, while administrator settings remain workspace-shared and admin-only. Full Python, Node, Playwright, startup, clean-build, and explicit PostgreSQL gates pass.
   - Design record: `../agents/bugfixes/2026-08-27-planned-global-auth-lock.md`.

11. `EXEC-cloud-sql-iam-connectivity.md`
   - Implementation is complete and locally verified, but the plan remains `EXEC-*` pending user acceptance or merge.
   - Output: default local/CI URL behavior stays unchanged; hosted mode obtains lock-protected ADC login tokens immediately before new physical connections; every IAM connection uses the fixed app-owned 10-second timeout; web pooling and Alembic `NullPool` share one engine factory; offline migrations remain ADC-independent while validating the passwordless TLS URL; hosted docs record the complete IAM/database prerequisites; no Cloud SQL Python Connector, alternate PostgreSQL driver, proxy, deployment, UI, or unrelated product change was introduced.
   - Design record: `../agents/features/2026-07-27-executed-cloud-sql-iam-connectivity-design.md`.

12. `EXEC-local-postgresql-runners.md`
   - Implemented on `feature/local-postgresql-runners` with 39 daemon-free focused tests plus live Docker lifecycle, abuse, persistence, production-image, and release-layout isolation passing. The plan remains active: no GitHub PostgreSQL run exists, and the configured-runtime full suite still has nine pre-existing EPM configuration failures.
   - Expected output: isolated `runners/local/` and `runners/github/` workflows that start a digest-pinned loopback PostgreSQL only for local source-checkout runtime, clean up owned containers on exit while retaining data, and prove PostgreSQL locking/concurrency in a least-privilege GitHub-hosted job without changing application or deployment implementation.
   - Design record: `../agents/features/2026-08-27-planned-local-postgresql-runners.md`.

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

0. `EXEC-defer-eng-alert-loading.md`
   - Implemented and verified locally on 2026-08-08; pending acceptance or merge. Separates first-screen Product/Tech data from alert enrichment, then starts missing-info and every other alert source only after visible data and only in Catch Up.

1. `DONE-auth-unfocused-auto-refresh.md`
   - Completed and merged in [PR #111](https://github.com/Juce-me/jira-execution-planner/pull/111). Amended 2026-07-16: the previously planned long-absence full-page reload was rejected and replaced with a refresh-only design. The superseded reload implementation remains unmerged on `feature/auth-unfocused-auto-refresh`. Use for audit context only.
   - Output: `frontend/src/api/authRefreshContract.js` holds the shared throttle/absence constants and event name; `frontend/src/api/authFocusRefresh.js` tracks continuous unfocused/hidden time and, after more than 12 minutes, issues one throttled `POST /api/auth/refresh` deduplicated across tabs via a shared `localStorage` timestamp, dispatching a `jep:auth-long-absence-return` `CustomEvent` on success; `frontend/src/dashboard.jsx` listens for that event and re-runs the same manual-refresh path the refresh button uses, gated by the same disabled condition. No document reload anywhere. `401` recovery (with and without `loginUrl`) is unchanged on both the initial and long-absence paths. `jira_server.py` adds a temporary, anonymized `after_request` diagnostics log (`jep.static_diagnostics`) scoped to `/`, `/jira-dashboard.html`, and `/frontend/dist/*` to identify the real owner of the originally reported repeated document/asset requests; it is explicitly temporary and slated for removal once that owner is identified. Content-hashed/immutable asset serving via a CDN/proxy remains deferred scope, not implemented here. Unit (`tests/test_auth_focus_refresh.js`), source-guard, and Playwright request-count coverage (`tests/ui/auth_focus_refresh_counts.spec.js`) prove: one document load produces one auth-script GET; focus/visibility bursts never add document or asset requests; multi-tab returns produce exactly one auth POST per cooldown window; a long absence refreshes only the active view's data; `401` recovery is intact.

2. `DONE-planning-default-selection-undo.md`
   - Completed and verified locally on 2026-06-09. Use for audit only; do not execute as active work.
   - Output: unseen future sprint/group scopes default to all visible Planning stories selected, Planning/Reporting epic Included/Excluded toggles persist to the selected group's shared `excludedCapacityEpics` config, manual checkbox edits persist until Select All, bulk status/select/clear actions can be undone to the loaded-page baseline, existing analytics events cover undo and shared excluded-capacity toggles, and focused Node/Python plus Playwright coverage verifies the behavior.

3. `DONE-planning-selection-card-grid.md`
   - Completed and merged in [PR #75](https://github.com/Juce-me/jira-execution-planner/pull/75). Aligns Planning story selection controls with story-point metadata while keeping non-Planning and EPM card layouts unchanged. Use for audit context only.
   - Output: ENG Planning cards render story points, the rounded checkbox, and Jira key as the final meta-row cluster; selected Planning stories get a subtle selected tint/ring; Playwright geometry and selected-state assertions guard against layout creep.

4. `DONE-jira-oauth-planning-status-transitions.md`
   - Completed Jira OAuth-backed ENG Catch Up and Planning status changes across Epics, Stories, and Subtasks. Merged in [PR #100](https://github.com/Juce-me/jira-execution-planner/pull/100). Use for audit context only.
   - Output: Catch Up can transition one Epic, Story, or expanded Subtask at a time by clicking the displayed status; Planning can fetch transition options from clicked status pills/text and transition every selected status target through the signed-in user's Jira OAuth context; batch mode never silently truncates selected targets, rejects over-cap selections before mutation, preserves Story selection capacity math, and keeps EPM Jira/Home-backed issue surfaces view-only while `GATE-05` is blocked.

5. `DONE-eng-priority-edit-mode.md`
   - Completed and merged in [PR #103](https://github.com/Juce-me/jira-execution-planner/pull/103) (branch `docs/eng-priority-edit-mode-plan`, commits `04be74a..8e4d764`). OAuth-backed ENG priority edits from the existing `task-priority-icon`, reusing the compact status dropdown UI/API pattern, and caching priority/status catalogs across app usage.
   - Expected output: Story and Epic priority icons open a compact dropdown whose option rows show the app's own priority icons and are filtered per issue to that project/issue-type scheme (via editmeta), fetched once per project/issue-type per app session; the menu dismisses on any outside click; priority writes use signed-in user Jira OAuth only; status transition option caching is widened safely without treating every status as universally transitionable; EPM remains read-only.

6. `DONE-eng-targeted-task-updates.md`
   - Completed and merged in [PR #105](https://github.com/Juce-me/jira-execution-planner/pull/105) (branch `feature/eng-targeted-task-updates`). Use for audit context only.
   - Expected output: ENG Catch Up status and priority writes optimistically patch only the selected Epic, Story, or expanded Subtask, reconcile in the background through a four-request shared queue with same-key serialization, roll back failed writes, ignore stale scope completions, and never refetch the Catch Up task lists; Planning and non-ENG surfaces retain their existing behavior.

7. `DONE-priority-refresh-preserve-team-filter.md`
   - Completed and merged in [PR #107](https://github.com/Juce-me/jira-execution-planner/pull/107) (branch `bugfix/priority-change-drops-single-team-filter`). Corrected during execution: team display names come from the team catalog lookup plus in-session retained task names, never `teamLabels` (Jira epic labels).
   - Expected output: configured group teams remain authoritative across Planning priority refreshes, true config removal still falls back to All Teams, behavioral Node and Playwright coverage passes, and generated dist is rebuilt.

8. `FUTURE-warm-team-catalog-team-names.md`
   - Deferred Minor follow-up to `DONE-priority-refresh-preserve-team-filter.md`: warm the team catalog once per session, only when a configured team option is visibly degraded to its raw id, so cold loads show catalog display names without any unconditional initial-load request.
   - Expected output: degradation-triggered `GET /api/team-catalog` warm effect, Playwright proof of the rename plus a no-request guard when names already resolve, and no changes to selection behavior, `availableTeams`, or analytics events.

9. `DONE-initiative-search.md`
   - Completed and accepted on 2026-07-28 in commits `a7cacf6..5d3b136`. Use for audit context only.
   - Output: Initiative key/summary matches render every loaded descendant Epic and Story, Epic matching retains its descendant behavior, active ENG filters remain authoritative, the Initiative grouping choice survives search transitions, existing bucketed `app_search` analytics remain canonical, and focused unit plus committed-dist Playwright screenshot coverage proves the result.

10. `EXEC-filterable-header-dropdown-inputs.md`
   - Ready for execution on `improvement/filterable-header-dropdowns`.
   - Expected output: the open Sprint, Group, and Teams header dropdown toggles become auto-focused local filter inputs; Sprint loses its duplicate panel input; adding visible groups no longer pushes the settings gear or any desktop control onto another row; the active ENG/EPM settings gear sits immediately after Refresh; and Group by Initiative becomes a fixed 30×30 icon toggle that is neutral gray when off and Initiative yellow with a pale-yellow surface when on.
   - Current dropdown selection, team multi-select, Initiative grouping/persistence, settings permissions/handlers, and compact-header behavior remain unchanged. Playwright covers all three dropdown siblings, main/compact layering, multi-group row geometry, settings placement, Initiative centerlines, `aria-pressed`, hover/focus tooltip, both color states, and settled screenshots.
   - No backend, API, saved-preference, or new analytics-event contract; existing selection/settings events remain authoritative, local Initiative regrouping stays allowlisted, and raw dropdown queries are never collected.

11. `DONE-personal-group-star.md`
   - Completed and verified on 2026-08-26 in commits `50db7ee..083a09c`; this prerequisite is satisfied for the onboarding tour.
   - Expected output: one personal starred Department group per authenticated workspace/user, single-select first-run search UI, personal Settings star controls, and strict separation between the persisted favorite and temporary dashboard Group scope. Shared `defaultGroupId` remains a file/JSON compatibility field and is never shown or mutated as a DB user's favorite.
   - This plan owns star persistence and UI only. It adds no onboarding completion state, guided tour, configure guidance, skip action, or replay action.

12. `EXEC-user-onboarding-tour.md`
    - Implementation and verification are complete on `feature/user-onboarding-tour`; awaiting integration approval. The prerequisite `DONE-personal-group-star.md` remains satisfied.
    - Expected output: configure/duplicate guidance after the mandatory group gate, followed by a guided tour of dashboard scope controls, actions, filters, issue hierarchy, and editable Jira fields. Per-user/workspace `onboarding_done` supports completion, skip, interruption recovery, and an explicit Settings replay action without another startup request.
    - The tour consumes the personal-star contract read-only and must not change star persistence or UI. Existing users are backfilled as complete; JSON/basic mode stays unchanged; privacy-safe `settings_action` events measure only started/completed/skipped outcomes.

13. `EXEC-user-onboarding-tour-improvements.md`
   - Tasks 0–9 are implemented and verified on `feature/user-onboarding-tour`. The dashboard tour is desktop-only; first-run Department selection and configuration still work on mobile, while the mobile dashboard tour is deferred in GitHub issue #151.
   - Implemented output includes direct existing-Department selection or persistent **Add Department**, guided create/duplicate/repair in the real Team Groups editor, automatic pending favorite/visibility with ordered shared/private save recovery, a single left-list name input, Settings-header replay, safe target-driven Priority/Project Track/Status previews, deterministic hierarchy fallbacks, analytics review, source guards, and operational guidance.
   - Task 9 used the authorized fresh Node 20 verification worktree. The clean final ref passed 1,396 Python tests with 7 skips, 1,027 frontend unit tests, and 563 Playwright tests with 2 skips; reproducible generated output and all 15 settled screenshots were verified and inspected. The branch awaits explicit push approval.

14. `EXEC-user-onboarding-contextual-follow-up.md`
   - Tasks 0–8 plus the final whole-branch review fixes are implemented and verified on `feature/user-onboarding-tour` through build commit `02f75e1`. The plan remains `EXEC-*` and remote integration awaits explicit direction.
   - Delivered output: a wider desktop coachmark with blue/red/neutral action hierarchy, explicit Next after safe field previews, contextual Configuration/Planning/Board/Statistics modules launched by native activation of the real controls, persistence-safe terminal retries, focusable destination regions, exact launcher hit-testing through centered placement, desktop-only contextual Settings routing, one canonical left-row Department favorite, and a compact right-pane visibility layout.
   - Final verification under pinned Node 20: 96 focused Node tests; both unchanged named baseline cases; 151 combined onboarding/Settings Playwright tests; 1,396 Python tests run with 1,389 passed and 7 skipped; 1,044 frontend unit tests; and 589 full Playwright tests with 2 skips. Generated output reproduced cleanly from `02f75e1`, and all 11 required screenshots passed original-resolution inspection.
   - Mobile dashboard onboarding remains deferred to issue #151. The final review added no backend, ownership, persistence-schema, Jira-mutation, dependency, or analytics-event change. See the final whole-branch review evidence in `EXEC-user-onboarding-contextual-follow-up.md` for RED/GREEN history and residual risks.

15. `EXEC-hide-single-option-view-mode-control.md`
   - Ready for execution as a small frontend-only task suitable for a 5.3 coding model.
   - Expected output: the ENG/EPM segmented control is absent when EPM navigation is unavailable, remains a two-option control when EPM is available, and updates correctly after Home-token connection, revocation, or backend prerequisite changes. Existing availability, analytics, auth, request, and shared-control contracts remain unchanged.

## Capacity Reporting Workflow

1. `SUPPORT-excluded-capacity-control-row-design.md`
   - Approved design for compacting Excluded Capacity into one desktop control row: Sprint first, Excluded Epics flexible in the middle, and both segmented controls grouped on the right.
   - Presentation-only scope; existing state, analytics, requests, and calculations remain unchanged.

2. `DONE-excluded-capacity-control-row.md`
   - Completed and merged in [PR #110](https://github.com/Juce-me/jira-execution-planner/pull/110).
   - Output: Sprint first, Excluded Epics flexible in the middle, and both segmented controls aligned on the right, with focused source and rendered-geometry verification.

3. `DONE-ad-hoc-capacity-epics.md`
   - Completed and merged in [PR #88](https://github.com/Juce-me/jira-execution-planner/pull/88). Adds department/team-group Ad Hoc capacity epic configuration as included Product capacity, separate from excluded capacity. Use for audit context only.
   - Output: `teamGroups.groups[].adHocCapacityEpics` round-trips through shared group config, Settings exposes a separate epic selector, Ad Hoc stories remain included in Product Planning and reporting, excluded capacity behavior remains driven only by `excludedCapacityEpics`, and affected Planning, Stats, Burndown, Lead Times, Mono vs Cross, and Scenario paths have focused verification.

4. `DONE-statistics-consistency-bugfix.md`
   - Completed and merged in [PR #108](https://github.com/Juce-me/jira-execution-planner/pull/108) (branch `bugfix/statistics-consistency-exec`, integrated via `bugfix/statistics-colors-capacity-lead-time`, commits `a42e7ca..c4fb36c`). Shared Statistics team colors, removal of the redundant Excluded Capacity Range card, and a bounded Lead Times creation cohort with inclusive End Quarter. Decisions recorded in `SUPPORT-statistics-consistency-bugfix-design.md`.
   - Expected output: Priority, Burndown, Excluded Capacity, and Mono vs Cross consume one deterministic active-group color map; Excluded Capacity drops only its Range card; Lead Times adds an inclusive End Quarter with last-control-wins reconciliation, half-open Jira creation-date JQL, matching Jira links, and terminal dates preserved beyond the cohort boundary.

## Project Grade Security Hardening

1. `DONE-project-grade-security-hardening.md`
   - Completed project-grade hardening plan. Use for audit and release evidence; do not execute as active work.
   - Output: central endpoint policy registry, default-deny route guards, local-only dev diagnostics, loopback-safe startup defaults, security headers, project packaging metadata, CI backend/security checks, and a hardened release zip.
   - This plan does not authorize Home/Townsquare writes or Jira write-back. `GATE-05-home-write-capability.md` remains blocked unless its documented probe records `PASS home_project_update_supported`.

## Completed Frontend Structure

1. `DONE-eng-story-subtasks.md`
   - Completed and merged in [PR #59](https://github.com/Juce-me/jira-execution-planner/pull/59). Lightweight ENG story subtask visibility. Use for audit context only.
   - Expected output: existing ENG task fetch includes a cheap embedded subtask summary, exact subtask rows load only after a user expands the story subtask control, no startup subtask fan-out is introduced, and count-based progress uses done/in-progress subtask counts rather than story points.

2. `DONE-eng-compact-filter-epic-layout.md`
   - Completed and merged in [PR #65](https://github.com/Juce-me/jira-execution-planner/pull/65). Desktop-focused compaction of ENG Catch Up filter cards and epic/story blocks with CSS-only scoped overrides. Use for audit context only.
   - Expected output: ENG `Show only` filters render as compact readable desktop controls, ENG epic/story cards use denser spacing, source guards prevent unscoped `.stat-card`/`.task-list` changes, and EPM issue-board rollups remain visually compatible through `.task-list:not(.epm-issue-board)` scoping.

3. `DONE-alerts-panel-summary.md`
   - Completed and merged in [PR #71](https://github.com/Juce-me/jira-execution-planner/pull/71). Persistent ENG alerts toolbar summary next to the toggle. Use for audit context only.
   - Expected output: `EngAlertsPanel` shows total alerts plus every non-zero alert category using existing alert colors/styles, stays visible open and collapsed, preserves existing toggle persistence, and includes source guards plus desktop/mobile Playwright visual proof.

4. `DONE-eng-catch-up-control-stack.md`
   - Completed and merged in [PR #75](https://github.com/Juce-me/jira-execution-planner/pull/75). Unifies the ENG Catch Up alert summary, Show only stat filters, and Display toggles into a coherent, non-redundant control stack. Use for audit context only.
   - Expected output: upper ENG control rows share alignment, sizing, and visual hierarchy; stat filters use a compact content-aware treatment instead of distributed tiles; Killed is removed from Show only and owned only by the Display Killed toggle; focused Playwright/source guards prevent regressions and preserve EPM, Planning, Settings preview, and Scenario layouts.

5. `DONE-statistics-module-extraction.md`
   - Completed Statistics module extraction. Use for audit and prerequisite evidence; do not execute as active work.
   - Supersedes the stale root-level `statistics_module_extraction_plan.md` from `origin/plan/statistics-module-extraction`.
   - Output: remaining legacy Statistics Teams, Priority, and Burndown utilities/components extracted from `frontend/src/dashboard.jsx` into the existing `frontend/src/stats/` package, with source guards, focused Node tests, full unit verification, Playwright smoke coverage, regenerated frontend dist output, and shared bounded hover positioning for stats chart readouts.

6. `DONE-epm-project-reading-experience.md`
   - Completed EPM project reading experience plan in PR #41 (`94b759b`). Use for audit and prerequisite evidence; do not execute as active work.
   - Output: Home update freshness classification, stale/missing/unknown badges, stale date styling, visual fixture coverage, and freshness source guards for the EPM project board.

## Codebase Structure And Operability

1. `DONE-application-hosting-readiness.md`
   - Completed and merged in [PR #64](https://github.com/Juce-me/jira-execution-planner/pull/64). Internal container-app hosting readiness. Use for audit context only.
   - Expected output: DB/OAuth works without local OAuth token files, hosted mode avoids local mutable JSON/cache state, frontend APIs default to same-origin behind ingress, Docker/Gunicorn packaging exists, and docs expose the runtime contract without secrets.
   - Accuracy note: the Task 7 GitLab CI skeleton (`.gitlab-ci.yml`, `tests/test_gitlab_ci_contract.py`) was removed on 2026-07-19 because the repo's CI is GitHub Actions and GitLab hosting is no longer planned; the container packaging and pre-SRE checklist deliverables remain current.

2. `DONE-codebase-operability-verification.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: local frontend unit/UI npm scripts, `make verify` for build/Python/security/Node/dist checks, and refreshed test-command documentation.

3. `DONE-codebase-operability-startup-preflight.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: operator preflight for runtime/auth/DB/encryption/migrations plus unified DB storage aliases.

4. `FUTURE-codebase-operability-improvements.md`
   - Deferred structural review and prioritized backlog for packaging, local verification, startup preflight, backend service extraction, frontend feature ownership, and source guards.
   - Do not execute directly. Convert each chosen slice into a separate `EXEC-*` plan before implementation.

5. `DONE-css-feature-owned-partials.md`
   - Completed and merged in [PR #75](https://github.com/Juce-me/jira-execution-planner/pull/75). Splits the remaining large dashboard CSS source files into feature-owned partials while preserving one bundled shipped stylesheet. Use for audit context only.
   - Output: `dashboard.css` remains the root ordered import entrypoint, large top-level CSS files become thin maps, feature-owned CSS files mirror ENG, Planning, Settings, Stats, Scenario, and EPM ownership, and source guards prevent top-level CSS from growing back.

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
   - Current accuracy: superseded for deeper CSS ownership by `DONE-css-feature-owned-partials.md`.

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

1. `DONE-epm-label-config-bugfixes.md`
   - Bugfix plan for the EPM Settings → Projects label configuration. Completed and
     merged in [PR #90](https://github.com/Juce-me/jira-execution-planner/pull/90) (branch `bugfix/epm-label-config`, commits `2138ab1`, `b24a091`,
     `b39e1f7`/`ac3dcaf`, `78a6b06`/`12af7da`). Use for audit context only.
   - Expected output: the label-prefix mask `*` is stripped before the Jira
     `startswith` filter so prefix autocomplete returns results, the label dropdown
     opens reliably from "Choose label" (no anchor race), every project row has one
     consistent compact delete with session-only removal plus a clear notice that
     Home-discovered projects reappear until closed/paused/archived in Jira Home, and
     the active label prefix is shown as a hint pill with a descriptive placeholder.
   - No new routes, no auth-mode change, no Home/Jira writes; `GATE-05` unaffected.

## ENG Epic Sort And Track

1. `DONE-eng-epic-sort-and-track.md`
   - Completed and merged in [PR #92](https://github.com/Juce-me/jira-execution-planner/pull/92). Read-only epic header enrichment plus epic ordering in the ENG view. Use for audit context only.
   - Expected output: each ENG epic header shows an effective-priority pill (highest-urgency child) and a Product Track emoji (🔒 Committed / 🤷 Flexible) read from the configurable `projectTrackField` Jira custom field (default `customfield_35024`); a single `sprint-dropdown`-styled Sort control orders epics by Priority, Status (built-in workflow-phase fallback), or Track (committed-first / flexible-first), each tie-broken by priority, with the choice persisted in localStorage UI prefs.
   - No new routes, no Jira writes, no auth-mode change; `GATE-05` unaffected. The board-imported per-group workflow source and group-by-kanban-column grouping are deferred to a separate future plan; the sort comparator already accepts an injected phase-rank map.

2. `SUPPORT-eng-project-track-write-switch-design.md`
   - User-approved design reference for the follow-up OAuth-backed ENG Project Track write plan.
   - Expected output: every real ENG Epic header renders 🔒 Committed, 🤷 Flexible, or ⚪ Unidentified; clicking the indicator in Catch Up or Planning opens the existing compact issue-field option-menu behavior and writes only the configured Jira Project Track field through the signed-in user's OAuth context, with the same queue, optimistic update, rollback, stale-scope, auth-recovery, analytics, and surface-isolation contracts as status and priority changes.
   - No Home/Townsquare or EPM mutation; `GATE-05` remains blocked. This support document feeds `DONE-eng-project-track-write-switch.md`, which now exists.

3. `DONE-eng-project-track-write-switch.md`
   - Completed and merged in [PR #112](https://github.com/Juce-me/jira-execution-planner/pull/112) (branch `feature/eng-project-track-write-switch`). Use for audit context only.
   - Expected output: every real ENG Epic header renders an always-visible 🔒/🤷/⚪ Project Track indicator that, on Catch Up/Planning with Settings closed, is a native button opening the shared compact option menu and writing only the configured Jira Project Track field between Flexible and Committed through the signed-in user's OAuth context, with the same queue/optimistic/rollback/stale-scope/auth-recovery/analytics contracts as status and priority changes.
   - No Home/Townsquare or EPM mutation; `GATE-05` unaffected.

4. `EXEC-eng-group-board.md`
   - Design agreed with the requester; implementation not started. **Open the two approved design
     assets in `docs/plans/assets/eng-group-board/` before executing** — self-contained HTML using
     the app's real classes and geometry. They are authoritative for appearance and interaction;
     the plan is authoritative for data, routes and constraints. This is the "separate future plan"
     that `DONE-eng-epic-sort-and-track.md` deferred the board-imported per-group workflow source and
     group-by-kanban-column grouping to. The existing sort comparator's injected phase-rank map is the
     intended seam.
   - Expected output: a new ENG `BOARD` mode showing epics in columns composed per team group,
     configured at Settings → Departments → **Boards** (a dedicated third sub-tab beside Team groups
     and Group labels, reached from a one-line *Configure board* pointer in Team groups); one focused
     column always centred with at most one starred column that never folds; folded columns act as the
     epic-count bar chart; epics sorted by `PRIORITY_AXIS` with assignee and Delivery Owner
     (`customfield_11147`) both shown; an epic detail panel reusing the existing priority/track/status
     controls and `.story-subtask-row` unchanged; and a single sticky filter bar with orthogonal facets
     that cannot reach an empty set. Catch Up keeps its existing status filters.
   - Board config is stored in the shared group payload on `/api/groups-config` (`user_write`), not
     `/api/board-config`. Read §4.3 first: epic `description`, `customfield_11147`, and a board-status
     source do not exist in the current payload and must be added before UI work. Open decisions are
     listed in §11 (ten items, one superseded); whether Group Board editing should be admin-guarded is
     resolved there (O1: no).

5. `DONE-board-epic-description-smart-links.md`
   - Accepted by the requester and executed in `3770d2b`; use for audit context only.
   - Jira ADF `inlineCard` and `blockCard` nodes in Board Epic descriptions render as escaped,
     allowlisted links using the URL as fallback text. Unsafe or missing URLs render nothing; the
     existing lazy description fetch, sanitization boundary, clamp, cache, and analytics privacy
     contract remain unchanged.

6. `EXEC-sticky-board-column-chrome.md`
   - Implementation complete and uncommitted; retain as `EXEC-*` pending acceptance or merge.
     The focused Board regression and analytics allowlist are verified. The matrix retains the
     unrelated drag-gate failure, an alert-toolbar setup failure, and an environment-blocked full
     Python suite.
   - Expected output: the existing semantic column chrome is promoted without duplicate controls
     or column trees, remains horizontally aligned and interactive, preserves layout, and releases
     at the board bottom.

7. `EXEC-board-help-title-adf-tables.md`
   - Implementation complete and uncommitted; retain as `EXEC-*` pending acceptance or merge.
     The executed record is
     `docs/agents/features/2026-08-08-executed-board-help-title-and-adf-tables.md`.
   - Expected output: configured Boards replace the instruction wallpaper with closed-by-default
     filter-bar help, long epic titles remain fixed-height ellipses, and safe semantic Jira ADF
     tables scroll horizontally inside each table only.
   - Verification: feature-specific checks, 55 Node guards, 12 description-route tests, five stale
     contract corrections, the compact sticky check, two deterministic builds, the 903-test
     frontend unit suite, and the final 113-test Board/EPM matrix pass; the full Python suite ran
     1,219 tests with 1,218 passed and 1 skipped. Finalization corrected a stale drag-fixture route
     without changing product drag or transition behavior.

## Stats Project Track By Sprint

1. `DONE-stats-project-track-by-sprint.md`
   - Completed and merged in [PR #95](https://github.com/Juce-me/jira-execution-planner/pull/95) (branch `feature/stats-project-track-quarters`). Use for audit context only.
   - Expected output: a `Project Track` ENG stats sub-tab (after `Mono vs Cross`) with a filter bar (shared Start/End sprint range, Capacity side Product/Tech/Tech+Product, Exclude Ad Hoc, Exclude Excluded Capacity, Mode Epic/Team), a mode title, a range totals bar, a per-sprint chart (hidden for a single-sprint range), a By assignee/By team breakdown, and an Epic-mode-only time-in-phase section built from a new bounded, read-only `POST /api/stats/project-track-phase-durations` endpoint.
   - No Jira/Home writes, no auth-mode change; `GATE-05` unaffected. See the plan's `## Outcome` and `## Current Accuracy` sections for as-built divergences from the original endpoint-contract text (response field names, absence of `cached`/`generatedAt`, client-side signature caching).

## Stats Controls Unification

1. `DONE-stats-controls-unification.md`
   - Initial implementation completed on `improvement/stats-controls-unification` (2026-07-15, execution commits `331f3c9..2d5f0a7`; full JS/Python/Playwright regression green apart from 2 pre-existing `eng_alerts_panel_summary` failures inherited from the ancestor branch). The Lead Times control-row compaction follow-up was implemented in `8b3f32d` (`fix: compact lead times controls`) on 2026-07-16. Final-review fix `16ff875` (`fix: contain stats range panels`) constrains all mobile stats range groups/panels without changing the global Sprint and aligns the six actual Lead Times control surfaces. Fresh verification: source guards 15/15, focused Playwright 4/4 across all four range views and Task 7 exclusions/layout, frontend unit 519/519, structure budget 1/1, and build green. Inspected desktop and three 375px screenshots show aligned Lead Times controls and readable, normally clickable long sprint options contained within each narrow stats panel. The measured 966px stats container uses the approved 8.5rem select flex basis instead of the planned 12rem, which required 1067px and wrapped Exclude. The plan was merged in [PR #108](https://github.com/Juce-me/jira-execution-planner/pull/108). The implementation unifies Statistics Start/End ranges through one stats-owned component extracted from the existing `sprint-dropdown` pattern, reusing `ControlField`, `.controls-label`, `.view-filters`, `.sprint-dropdown*`, `SegmentedControl`, and the corrected Project Track checkbox treatment; per-task divergence notes live in the plan.
   - Expected output: Excluded Capacity, Mono vs Cross, Project Track, and Lead Times share one accessible downward-opening range-control implementation; Lead Times Group By uses the existing segmented control; its capacity filters render as an `Exclude` group with `Ad Hoc` + `Excluded Capacity` checkboxes while retaining explicit accessible names; range/refetch/persistence semantics stay unchanged and receive pointer, keyboard, view-switch, reload, layer, and narrow-viewport verification.
   - No backend route, auth/CSRF, Jira/Home credential, mutation, or new analytics-event contract; the global sticky Sprint control, Project select, and Assignee select remain out of scope.

## Analytics

1. `DONE-ga4-instrumentation.md`
   - Completed and merged in [PR #58](https://github.com/Juce-me/jira-execution-planner/pull/58). GA4/GTM dataLayer instrumentation implemented in app code on 2026-05-30. Use for audit context only.
   - Output: two-trigger GTM dataLayer contract (`pageview`/`userevent`), `GA4_ENABLED` transport gate with no in-app consent UI, and typed event params per `docs/README_ANALYTICS.md`.

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

- `DONE-root-cleanup-docs-postmortems.md`
  - Completed and merged in [PR #99](https://github.com/Juce-me/jira-execution-planner/pull/99). Root-folder cleanup: icons to `assets/`, `install.sh` to `scripts/`, postmortems to `docs/postmortem/`, redundant root docs removed, AGENTS/README aligned. Use for audit context only.
