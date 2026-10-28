# Planning review group columns and Sprint views (#267) Implementation Plan

> **Note (2026-10-27):** Superseded by the conflict-resistant architecture plan Task A1: `frontend/dist` is no longer committed, so its `make verify-dist-clean` and "commit `frontend/dist`" steps no longer apply.

> **Status:** Done. Executed and merged in [PR #290](https://github.com/Juce-me/jira-execution-planner/pull/290) (2026-10-20). The gates this plan's record lists as open at that point (the Gate 7 cutover rehearsal, headed Firefox and WebKit marker geometry, a CI PostgreSQL run) were not formally closed here; the follow-up plan [DONE-planning-review-adoption-merge-mode.md](DONE-planning-review-adoption-merge-mode.md) (#299) records a rehearsal of the adoption restore and a run of the repository's CI PostgreSQL runner script. Kept for audit context only.

> **Current accuracy (2026-10-23):** the adoption this plan describes as a manual, quiesced script is now also run automatically on upgrade by revision `20261023_0020` (see [EXEC-planning-review-automatic-adoption-on-release.md](EXEC-planning-review-automatic-adoption-on-release.md)); the cutover steps describe the manual path.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Done (merged in PR #290). Reviewed once (2026-10-20); operator approved on 2026-10-20 with every recommendation below accepted.
Type: feature (backend, migration, script, UI)
Branch: `feature/267-group-review-columns` (the design branch renamed on 2026-10-20; no rebase or merge of `origin/main` yet, which must happen before publication and rebuilds `frontend/dist`)
Written: 2026-10-20 from the design, three read-only symbol re-verifications, one independent plan review (findings applied below) and the governing docs.

**Goal:** Department-group-wide review columns and values, per-Sprint shared views with nearest-earlier inheritance, read-only derived Epic/Story columns, a one-time adoption of legacy per-Sprint tables, and the client plumbing for all of it.

**Architecture:** Three new tables (group schema, group cells, Sprint view) behind the existing three review routes with a `groupId` selector; view resolution is one `<=` lookup on a zero-padded Sprint order; derived columns are pure client computation over loaded cells; legacy tables stay in the database, unread, and an offline script copies them into every configured group in a quiesced cutover.

**Tech Stack:** Flask, SQLAlchemy, Alembic, PostgreSQL/SQLite; React 19, esbuild, node:test, Playwright (Chromium; headed Firefox/WebKit for geometry).

**Spec (source of truth):** [SUPPORT-planning-review-sprint-inheritance-design-267.md](SUPPORT-planning-review-sprint-inheritance-design-267.md): Direction, Design, Plan Requirements, acceptance criteria 1-33 (cited as AC n) and Definition of Done. Where this plan and the design disagree, the design wins unless a divergence is recorded below and the operator approves it.

## Global Constraints

- Review code is OAuth-only: `capabilities()` gating unchanged; PATCH and values-read stay `user_write` (token-bound CSRF plus `X-Requested-With`), GET stays `authenticated_read` with no CSRF (`backend/security/policy.py:174-176`).
- No Jira write path; no change to `authorize_issues`; no change to column ids, cell identity `(issue_id, row_kind, column_id)` or per-cell `baseRevision` semantics.
- No write on read; no catalog or Jira read from review code; review code never writes group-configuration or preference rows.
- The application never modifies or deletes the legacy rows (`workspace_sprint_reviews`, `sprint_review_cells`).
- Limits: 30 active columns per row kind, 240 columns per group, 120 schema actions, 100 changed cells, 500 read issues; view cap `MAX_GROUP_VIEWS = 500` (new constant); `groupId` 1-128 chars, equal to its stripped form, no control characters; Sprint ids `[1-9][0-9]*` up to 128 digits; `sprint_order` = id left-padded with zeros to 128 chars.
- New errors: `400 review_group_unknown` and `400 review_view_limit`, body `{error: <code>}` only; both 409 sites carry `schemaConflict`, `viewConflict`, `cellConflicts`, `columns`, `schemaRevision`.
- Derived cells are never editable, never stored, never sent in a write.
- UI: reuse existing components, classes and tokens; a new class kind needs a `docs/design-system.md` registry entry first and ratchet handling; no `transition: all`, no transform in `:hover`/`:active`; no native `title`; touch works by tap, nothing drag-only; keyboard-only accessibility findings go to `docs/TODO.md` (Deferred).
- Environment: `.venv/bin/python` (3.14.7 locally; CI matrix is 3.10 and 3.11, so no syntax newer than 3.10), Node 20.x (`engines.node`, `.nvmrc`). CI parity: Python suite as `make test` runs it (`JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile`), then `make test-security`, then `make verify-dist-clean`.
- Synthetic fixtures only; no live-app screenshots; no secrets, local paths, real emails or agent/tool branding in committed files.
- Commits: one atomic commit per task, subject under 72 chars, configured noreply identity via one-shot `-c user.name` and `-c user.email` flags, no attribution trailer. After each commit read `git show --stat HEAD` and `git status` (Gate A) before the next step.
- Never push, open a PR, or publish a handoff; publication follows `AGENTS.md` section 10 only when the operator asks.
- Postmortem checklist (reviewed before touching related code): MRT009 sticky offsets re-verified with the hint row present and dismissed; MRT016 plan file-map and task-boundary drift (one owner per file, every named file verified); MRT020/MRT021 reuse shared controls and never override their layout, audit every sibling control, geometry assertions on text-bearing elements plus screenshots actually looked at; MRT024 head-stamped drift (A1 parity and offline render); MRT025 publication transaction; MRT028 painted-bounds verification and shared-reviewer framing.
- Gate sweep (`docs/plans/AGENTS.md`): `rg --files docs/plans | rg '/GATE-'` lists only `GATE-05`, an auth/Home gate not touched by this work; no gate command run, none cleared.

## Decisions (operator, 2026-10-20)

All nine were resolved on 2026-10-20 as: "rename the branch, ceiling raised, allow files to be edited, proceed with recommended findings". D-A is resolved as renaming the existing branch (not cutting a fresh one); D-B, D-C and D-E to D-I as recommended; D-D and the other recommendations stand as written below.

- **D-A Branch.** `origin/main` (`2f070bbd`) is four commits ahead of the design baseline `cb1b3c4d`; the current branch is `docs/…` (AGENTS section 11 wants `feature/<issue>-<summary>`). Recommend a fresh `feature/267-group-review-columns` cut from `origin/main`, with the eight design commits and this plan cherry-picked, so no history is rewritten and no unrelated commits are inherited. Alternative: merge `origin/main` into the design branch.
- **D-B Extraction ceilings.** The design says net-zero lines for five registered files. The work adds a hook call, a dismissal map, group props and activation logic with no deletions identified, and golfing unrelated lines to hit zero violates "touch only what you must". Recommend raising the ceilings, aggregates and `unresolved` inventories deliberately in the task that grows each file (C2, D3), the precedent the design cites (design:213), with `test_codebase_structure_budgets` green at each commit. Alternative: name lines to move out first.
- **D-C New file `frontend/src/eng/usePlanningGroupScope.js`.** Not on the design's allowed list; it holds the group guard to limit growth of `dashboard.jsx`. `PlanningReviewDerivedCell.jsx` is allowed by the design only conditionally. Recommend both.
- **D-D Settings Save guard point.** `useGroupVisibilityPreferences.js:206,277` calls `setActiveGroupId` only after the preference PUT succeeds, so a guarded setter cannot give "Stay" a rollback. Recommend: when the saved active group differs from the current one, run `guardScopeChange` before the persist call; Stay aborts the save and keeps Settings open with its draft. Functional-updater call sites (`useTeamGroupSettings.js:185,565`, `useGroupVisibilityPreferences.js:244`) are automatic and bypass the guard.
- **D-E Adoption trio location.** AC20 puts the three adoption race tests in `tests/test_sprint_review_postgresql.py`. Recommend keeping them there (B1 owns that file after A2; the CI runner entry for the module is added in A2/A3 so B1 does not touch the runner).
- **D-F Silent hide after migration.** `RUN_DB_MIGRATIONS=true` environments migrate to the new head and hide existing review columns until the script is run by hand (design:227 accepts this for local runners only). Options: accept with the runbook only (recommended, matches the design), or add a startup log warning when legacy rows exist and no group rows exist (needs a new code path in the preflight; not in the design).
- **D-G Adoption bounds.** Rows times groups in one EXCLUSIVE-locked transaction. Recommend a `statement_timeout` of 60s alongside the 5s `lock_timeout` and a dry-run report of row counts per table and group so the operator sees the size before `--apply`.
- **D-H Automatic group changes** (hide-the-active-group effect, share-link apply, first-run, favorite re-resolution) discard a dirty draft without a notice, as the design states (design:152). Recommend accept; alternative adds a notice line (new UI copy).
- **D-I Parallel B and C.** Their file sets are disjoint; recommend parallel after A.

Divergences I will record in the design if approved: `nativeAnchorFor(order, afterId, derivedIds)` (no `kind` parameter, the order list is already per kind), service payload keys listed below, and the items under "Preconditions and divergences".

## Review Focus

1. Group id with whitespace, case difference, 129 chars, or duplicate/extra query arg: precise 400, never a lookup. (A2)
2. A save where `viewConflict` and the view cap both apply: `viewConflict` wins, whole request rolled back, no row left. (A2)
3. Cell-only draft open while another user changes a revision: draft survives; a layout draft is interrupted only by a view change of its own Sprint. (C1)
4. A manual refresh failing on a later batch: pre-refresh cells are restored and no derived cell shows a mixed sum as complete. (C1, D1)
5. Group switch while dirty from every `setActiveGroupId` writer: no draft is ever saved under another group. (C2)

## Preconditions and divergences (recorded 2026-10-20)

Precondition results: current branch is the design branch; `git log origin/main..HEAD` shows eight design commits (`f74c4e6b` to `d1522158`); no remote branch contains HEAD. `origin/main` is `2f070bbd`, merge-base `cb1b3c4d`. Alembic head is `20261001_0018`; no remote branch carries a 0019.

`origin/main` changed these allowed-list files: `docs/README_ANALYTICS.md` (new top No-Event row dated 2026-10-16; new rows go beside it), `docs/ontology.md` (Team-name paragraph), `frontend/src/settings/useTeamGroupSettings.js` (one `teamNameLookup` line; stays 1480 lines), `tests/ui/shareable_view_links.spec.js` (+42; re-read before editing). `frontend/dist` conflicts on any merge and is rebuilt, never hand-merged. None touch the review backend, hook, API or table.

| # | Design claim | Current code | Effect |
| --- | --- | --- | --- |
| V1 | `movableIds()` is a model concern | Closure at `PlanningReviewTable.jsx:223` over `layoutColumns` (`:133`, admission counts 2, no hidden filter) | `nativeAnchorFor` receives the full order as a parameter |
| V2 | Archive text in the table | `PlanningReviewColumnMenu.jsx:62` plain `<span>`; no test asserts the sentence | Group name prop reaches the menu |
| V3 | `activeGroup` from loaded groups | `dashboard.jsx:2405` derives from `visibleControlGroups`, no loading check | Activation combines `activeGroup?.id` with the existing groups-loading state |
| V4 | Group info reaches the table | No group, group name, Sprint list or `sprintId` read in `PlanningReviewTable` | D3 adds `groupName`, `resolveSprintName` props |
| V5 | "unavailable" gated on `schemaLoaded` | `PlanningReviewTable.jsx:323` shows when `!canSave && !loading` | Gate added in D3 |
| V6 | Second `dashboard.jsx` ceiling is 7554 | `tests/test_codebase_structure_budgets.py:71` holds 7573; manifest 7554 equals actual; other four files are manifest-only | Re-synced with D-B |
| V7 | Menu item "Hide" | "Hide column" (`PlanningReviewColumnMenu.jsx:59`) | Reuse existing label |
| V8 | Offline tests for review migrations | None for 0017/0018, no `as_sql` guards | A1 adds one for the new revision |
| V9 | Review fixtures can create groups | `ReviewFixture` has no `WorkspaceGroupConfig` row | A2 extends it |
| V10 | CI runs review PostgreSQL tests | `tests.test_sprint_review_postgresql` skipped in CI (env var never exported) | A2 wiring |
| V11 | Playwright config | No `playwright.config.*`; flags on the CLI; review-table spec is an esbuild harness without route stubs | Commands below use CLI flags |
| V12 | `save()` has an `error.code` path | None (`usePlanningSprintReview.js:176`) | C1 |
| V13 | Scope dialog copy | `PlanningReviewScopeDialog` in `PlanningReviewTable.jsx:89-96` | Copy change is D3's |
| V14 | Route wrapper order | `_run` rejects `request.args` before auth (400 beats 401, existing behavior kept) and parses the body before the capability check inside the service | Wrapper changed in A2 |

Any other drift found during a task is added here before the task is accepted.

## Contracts

**Endpoint matrix**

| Route | Policy | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/eng/sprints/<id>/review?groupId=` | `authenticated_read`; no CSRF | exactly one `groupId` (duplicate, padded, extra arg = 400); never reads the group catalog | `{schemaVersion, sprintId, groupId, schemaRevision, viewRevision, columns, layouts, inheritedFrom, capabilities}`; on a non-OAuth deployment the capabilities answer is unchanged but a malformed `groupId` still returns 400 first | 400 `invalid_review_request`, 401, 503 |
| `POST …/review/values/read` | `user_write`, CSRF + `X-Requested-With` | body `{groupId, issueIds, rowKind}`, no query; never reads the group catalog | `{cells, unavailableIssueIds}` (active columns only; 413 `review_response_limit` over 1 MiB) | 400, 401, 413, 503; policy-layer bodies for CSRF/header failures |
| `PATCH …/review` | `user_write`, CSRF + `X-Requested-With` | body `{groupId, baseSchemaRevision, baseViewRevision?, schemaChanges, cellChanges}`, no query | base keys `{schemaVersion, sprintId, groupId, columns, schemaRevision, cells}` plus `layouts`, `viewRevision`, `inheritedFrom` only with a layout action | 400 (`invalid_review_request`, `review_group_unknown`, `review_view_limit`, existing limit codes), 403 `review_issues_unavailable`, 409 `review_conflict`, 413, 503 |

PATCH precedence (design:138): 401 and `503 review_storage_unavailable` (capability) before body parsing; then stateless structure via `validate_schema_changes` plus cell shape; then group membership; then Jira authorization; then the transaction. Membership runs only on PATCH, inside `save_review`, after structure and before `authorize_issues`.

**Service signatures (A2 produces).** `group_identity(value) -> str`; `sprint_order(sprint_id) -> str`; `validate_schema_changes(changes) -> None`; `apply_schema(columns, changes)` and `apply_layouts(layouts, columns, changes)` keep their signatures with shape checks removed to `validate_schema_changes`; `ensure_group_configured(context, group_id) -> None`; `resolve_view(session, workspace_id, group_id, sprint_id) -> (layouts, view_revision, inherited_from)`; `load_review(context, sprint_id, group_id, database_url=None)`; `read_values(context, sprint_id, payload, database_url=None, search=None)` and `save_review(context, sprint_id, payload, database_url=None, search=None)` take `groupId` as a key of `payload` (added to their strict key lists, `baseViewRevision` added to PATCH's). The route does not strip it.

## File map (verified to exist unless `Create`)

**Backend:** `backend/db/models.py`; `backend/db/migrations/versions/20261020_0019_group_review_columns.py` (Create; revision `20261020_0019`, down_revision `20261001_0018`); `backend/services/sprint_review.py`; `backend/routes/sprint_review_routes.py`; `scripts/adopt_legacy_sprint_reviews.py` (Create); `Dockerfile` (one `COPY`, line 38); `runners/github/run-postgresql-tests.sh`.

**Frontend:** `frontend/src/api/sprintReviewApi.js`; `eng/usePlanningSprintReview.js`; `eng/planningReviewTableModel.js`; `eng/PlanningReviewTable.jsx`; `eng/PlanningReviewColumnMenu.jsx`; `eng/PlanningReviewStateCluster.jsx`; `eng/EpicHeaderValueReadout.jsx`; `eng/EngControls.jsx`; `dashboard.jsx`; `dashboardRuntime.js` (only if the prefs shape needs it; `saveUiPrefs` at `:562`); `settings/useGroupVisibilityPreferences.js`; `settings/useTeamGroupSettings.js`; `settings/useFirstRunConfiguration.js`; `shareView/applyController.js`; `styles/eng/planning-review-table.css`; `eng/usePlanningGroupScope.js` (Create, D-C); `eng/PlanningReviewDerivedCell.jsx` (Create, D-C); `analytics/dashboardAnalytics.js` only if an event changes (expected: none); `frontend/dist/*` via `npm run build` only.

**Tests:** `tests/test_sprint_review.py`, `test_sprint_review_routes.py`, `test_sprint_review_postgresql.py`, `test_db_migrations.py`, `test_postgresql_runner_contract.py`, `test_container_packaging.py`, `tests/test_adopt_legacy_sprint_reviews.py` (Create), `test_planning_sprint_review.js`, `test_sprint_review_api.js`, `test_planning_review_table_model.js`, `test_share_view_source_guards.js` (pins the `active:` literal at `:128`), `test_share_view_planning_rows_seed.js`, `test_analytics_source_guards.js`, `test_codebase_structure_budgets.py`, `test_design_system_ratchets.js`, `design_system_baseline.json`, `tests/ui/eng_epic_refresh_fixture.js`, `planning_review_integration.spec.js`, `planning_capacity_editing.spec.js`, `planning_review_table.spec.js`, `shareable_view_links.spec.js`.

**Docs/records:** `docs/features/planning-sprint-review.md`, `docs/plans/README.md` (index entry added when this plan is committed, replacing "no EXEC plan yet" at line 30), `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/design-system.md`, `docs/TODO.md` (deferred keyboard findings), `backend/security/CONFIGURATION_OWNERSHIP.md`, `README.md`, `INSTALL.md`, `AGENTS.md` section 11, `scripts/extraction_lint/owner_budgets.json`, this plan, the design.

One owner per file at a time; the status table in this plan is edited by the orchestrator only.

## Forbidden regressions

Everything under Global Constraints, plus: existing Sprint SP, Story Points and Accepted behavior; Planning Table chrome, sticky stack and column menus apart from the hint row, marker, Archive copy, Add note, derived menu and group guard; existing `EpicHeaderValueReadout` users (pinned by `planning_review_table.spec.js`, `planning_capacity_editing.spec.js`, `eng_group_board_card.spec.js`); header height 32px; `bodyDelta`/`totalDelta` under 1px; every commit leaves the suites green for the files it owns (no knowingly red intermediate state).

## Execution status

Updated 2026-10-20. Tasks A1 to D3b are implemented and committed locally on `feature/267-group-review-columns` (unpushed); E1 (records) and the final-review fixes are committed; E2 (full verification) ran at `72a650c5` and `5ba43fc4`; the Definition of Done table below records the evidence and the gates that stay open.

| Task | State | Commit | Evidence |
| --- | --- | --- | --- |
| A1 migration and models | done | `c612501d` | 43 migration and model tests OK; offline render, parity and legacy-row survival across downgrade |
| A2 services, routes, groupId contract, CI wiring | done | `d69db071` | 93 targeted tests OK; `make test-security` 82 OK; full Python suite OK at the time |
| A3 statement counts and PostgreSQL race tests | done | `b65b9ea7` | statement counts equal the design table; 9 PostgreSQL tests OK on a throwaway server (skipped without the opt-in) |
| B1 adoption script and race trio | done | `11c1a523` | 23 script tests OK; PostgreSQL module 12 OK on a throwaway server |
| B2 Dockerfile, README, INSTALL | done | `8189c9a5` | 13 packaging tests OK; Gate 7 rehearsal still open |
| C1 API and controller | done | `d96d0072` (with C2) | node unit suite green; committed with C2 so no commit leaves the review specs red |
| C2 group guard, activation, dismissal state | done | `d96d0072` (with C1) | node unit 2914 OK; budgets OK; two review specs 87 passed |
| D1 model: derived, placement, totals | done | `fec8207f` | model tests 28 OK; unit 2923 OK |
| D2 Playwright fixtures and harness (no behavior change) | done | `1a45744f` | four specs 229 passed |
| D3a derived columns, marker, readout | done | `028e1584` | unit 2923 OK; four specs 224 passed, 1 headed-only skip |
| D3b hint, group copy, anchor wiring, blocked state | done | `b77055e4` | unit 2925 OK; budgets OK; six specs 361 passed, 3 skipped |
| E1 records | complete | `36ed2690` | docs, ownership contract, ontology, learnings, analytics rows and guard test |
| E2 full verification and DoD | complete with open gates | `72a650c5`, `5ba43fc4` | Gate 7 rehearsal, headed Firefox/WebKit marker geometry, CI PostgreSQL run and delivery stay open |

Also on the branch: `27eb2974` merges `origin/main` (needed by the rewritten share-link interruption spec); `frontend/dist` was rebuilt in `72a650c5` and `5ba43fc4` (reproducible build, `make verify-dist-clean` clean).

## Divergences found during execution

Each is accepted by the operator or controller; the task reports under `.superpowers/sdd/` are authoritative.

- A2: `ensure_group_configured` takes an optional `database_url`; the capability helper is public as `require_review_context`; `apply_schema` and `apply_layouts` no longer shape-check, so callers (including the adoption script) call `validate_schema_changes` first.
- A2: every new column stores `after` (null when absent), a 1-64 character string; `rename`, `archive` and `aggregation` column ids need UUID shape in the stateless pass; a whitespace-padded `groupId` is `400 invalid_review_request`, never `review_group_unknown`; the values read skips the cell query when a group has no active column of that kind.
- A2: existing tests were rewritten (not re-signatured) where the design changes semantics: another Sprint now sees values and inherits the view, and archived columns' cells are no longer read back.
- B1: `--workspace-id` is required except with `--list`; the digest covers content rows only (empty legacy rows are skipped); catalog group ids must already pass `group_identity`; every group gets a schema row even when nothing is adopted; unknown ids in legacy layouts and orphan cells are dropped and counted; the report prints group ids; the dry run sets the same session timeouts but takes no locks.
- C1: the post-PATCH forced refresh runs only when the response `schemaRevision` differs from the held one (silent, not manual); a 200 without `layouts` sets saved values from the latest known server view; `groupBlocked` also clears on a successful automatic load; the controller treats an empty `groupId` as an ordinary scope value.
- C1 and C2 were committed together because C1 alone left 20 Playwright failures until the dashboard passed `groupId`.
- C2: the group guard reaches the Settings hooks through `groupChangeGuardRef` (so `tests/test_use_team_group_settings.js`, outside the brief, pins 17 inputs); Stay on a Settings Save throws "Settings were not saved: the Planning review has unsaved changes." and the shared-groups part of the same Save is already committed; the first-run preference save is guarded and first-run cancel stays automatic; `reviewGroupReady` joins the hook's return value; the guard prompts only when the target group differs.
- D1: `derivedValue` returns `{ scaled, value, complete }`; `ctx.isLoaded(id, rowKind)` and the derived context are optional last arguments; a blank derived total is `null`; an Epic with no in-scope Stories or no stored value is blank but complete; a custom column already in a saved order keeps its position and ignores `after`; `nativeAnchorFor` returns `null` for a corner over an empty order and `'summary'` when no native id precedes.
- D2: the second Department group in the fixtures is opt-in (`groups: 2`); a pre-existing 390px compact-header overlap (search field over the Catch Up radio with two or more visible groups) is recorded in `docs/TODO.md`, not fixed.
- D3a: the marker is registered through its design-system Element-map row only (a name without a hook suffix keeps the class-hook ratchet exact); the marker and heading button share the "<label>, Story property" accessible name; the letter sits in a `<span>` above a square `::before` hit area (a rounded one missed corner hit tests); marker type is the heading's family and weight at `0.62rem`; a pen hover does not open the readout (a tap pins it).
- D3b: limit codes map in the controller (two lines changed in C1's file) with one shared `REVIEW_LIMIT_MESSAGES`; the hint dismiss reuses `IconButton` and `planning-review-column-action`, with only the `planning-review-hint` wrapper new; a layout effect compensates the reading position when the hint appears or disappears (WebKit has no scroll anchoring); table-local sort, open menu and add anchor reset on a group change; AC 14's UI half is a stubbed-catalog Playwright test plus a node `buildGroupId` test, not a full Settings flow.
- Design text: `nativeAnchorFor(order, afterId, derivedIds)` has no `kind` parameter; the movable-id closure lives in the table; the second `dashboard.jsx` ceiling is 7573; review PostgreSQL tests are skipped in CI unless the runner opts in (the runner now does).

## Order

A (A1, A2, A3 sequential) then B and C in parallel (D-I: B = `scripts/`, `Dockerfile`, `README.md`, `INSTALL.md`, `tests/test_adopt_*`, `tests/test_container_packaging.py`, `tests/test_sprint_review_postgresql.py`; C = frontend API/controller/hooks/settings/shareView/`dashboard.jsx`/`EngControls.jsx` and JS tests, no table file) then D (D1, D2, D3 sequential; D3 owns `PlanningReviewTable.jsx` and the table props in `dashboard.jsx`) then E.

---

## Slice A: backend foundation

### Task A1: Migration and models

**Files:** Modify `backend/db/models.py`, `backend/services/sprint_review.py` (`sprint_order` only); Create the migration; Test `tests/test_db_migrations.py`, `tests/test_sprint_review.py`.

**Interfaces. Produces:** models `WorkspaceGroupReviewSchema` (`workspace_group_review_schemas`), `GroupReviewCell` (`group_review_cells`), `GroupSprintReviewView` (`group_sprint_review_views`) with exactly the design's Storage columns, checks, unique constraints and index; `sprint_order(sprint_id: str) -> str`.

- [ ] **Step 1: failing tests:** (a) model/database parity for the three tables including FK `ON DELETE CASCADE`, check names, nullability, unique constraints, and the `(workspace_id, group_id, sprint_order)` index (AC 21); (b) `test_group_review_migration_postgresql_offline_sql` modeled on `test_catalog_migration_postgresql_offline_sql` asserting `CREATE TABLE`, `ON DELETE CASCADE`, `length(sprint_order) = 128`, `view_revision >= 1`, the index; (c) legacy rows inserted at `20261001_0018` are unchanged after upgrade, and after downgrade to `20261001_0018` (only the three tables dropped), then upgrade again; (d) an unpadded `sprint_order` insert raises `IntegrityError` on SQLite.
- [ ] **Step 2:** `.venv/bin/python -m unittest tests.test_db_migrations tests.test_sprint_review -v`. Expected: new tests FAIL (tables missing).
- [ ] **Step 3:** implement models, a create-table-only revision (docstring states why no `inspect`/`as_sql` guard is needed), and `sprint_order`.
- [ ] **Step 4:** same command PASS; read the summary line.
- [ ] **Step 5:** commit "Add group review tables and migration (#267)".

### Task A2: Services, routes and the groupId contract

**Files:** Modify `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `runners/github/run-postgresql-tests.sh`, `tests/test_postgresql_runner_contract.py`; Test `tests/test_sprint_review.py` (extend `ReviewFixture` with a `WorkspaceGroupConfig` row and a `group_id`), `tests/test_sprint_review_routes.py`. (Services and routes are one task so no commit leaves route tests red.)

**Interfaces.** Consumes A1. Produces the service signatures and the endpoint matrix above; constant `MAX_GROUP_VIEWS = 500`.

- [ ] **Step 1: failing tests, one per behavior:**
  - Isolation and values: group X vs Y with identical column ids (archive, rename, value, revision in X leave Y unchanged) (AC 1); one value per issue read from another Sprint, same-cell conflict by revision (AC 2); cross-workspace isolation with identical group, Sprint, column and issue ids (AC 15); an issue the user cannot see is absent and listed, no cell query when none allowed (AC 16); values read returns only active columns with 30 active and 100 archived (AC 18); archiving a column in Sprint A removes it for Sprint B while a saved view keeps its id (AC 9 server half).
  - Views: own/nearest-earlier/none with ids 9, 10 and a 128-digit id; later Sprint never affects an earlier one; single-kind row does not inherit the other kind; at most one view row ORM-loaded with 500 seeded (load listener); a save at the cap returns `review_view_limit`, `viewConflict` decided first, whole request rolled back, no row left; an unpadded writer rejected (AC 3). Absent row requires base 0 and inserts at revision 1, a second first-save returns `viewConflict`, a present row requires equality; a first layout save stores exactly the request's layouts, returns `inheritedFrom: null`, leaves the source unchanged, an absent kind stays absent, `order`/`hidden` required (AC 4); cell-only, column-only, rename, archive and total saves create no view row (AC 5).
  - Revisions and validation: layout-only neither checks nor bumps `schema_revision`, column action does; stale `baseSchemaRevision` is `schemaConflict`, stale `baseViewRevision` is `viewConflict`; both 409 sites carry the five fields; cell-only 200 omits `layouts`, `viewRevision`, `inheritedFrom` (AC 6); add plus layout referencing the new column succeeds; a request with a cell change and a malformed layout never calls the patched `search`; layout-id membership still checked in the transaction; layouts accept custom ids of both kinds, `after` accepts same-kind built-in or group column ids including one added in the same request (AC 7, 30 part).
  - `groupId` contract (AC 12): required on all three routes; shape rules; GET exactly one arg, POST/PATCH reject any query; precedence including malformed body under a 503 capability returns 503; **malformed body plus unknown group returns 400 `invalid_review_request`, not `review_group_unknown`**; membership exact and case-sensitive on stripped ids; missing group config row, group present only in another workspace, unlisted group each return `review_group_unknown` on PATCH; **GET and values-read with an unlisted group succeed and never read group config** (reattach, AC 14 service half); malformed group payload returns 503; CSRF and `X-Requested-With` on POST and PATCH, authenticated non-admin success on all three (GET without CSRF).
  - Forbidden paths (AC 17), by named symbol patched to raise: the group-config writers (`save_shared_groups`/`ensure_workspace_group_config` as found by `rg` in `backend/services/shared_group_config.py`), the `user_group_preferences` writers, the Sprint catalog reader and writers, Basic/service-integration/Home credential helpers (reuse the existing `test_new_jira_edit_http_paths_never_resolve_local_credentials` and keep it passing through the signature rewrite), and `get_jira_server().current_jira_search` reachable only through `authorize_issues`; an empty PATCH creates no row and a spy on `with_for_update` shows no lock.
  - CI wiring: `run-postgresql-tests.sh` module list gains `tests.test_sprint_review_postgresql` and the script exports `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1`; `test_postgresql_runner_contract.py` pins both.
- [ ] **Step 2:** `.venv/bin/python -m unittest tests.test_sprint_review tests.test_sprint_review_routes tests.test_postgresql_runner_contract -v`. Expected: new tests FAIL.
- [ ] **Step 3: implement.** Split shape checks into stateless `validate_schema_changes` (keys, types, id shapes, `after` shape, required layout `order`/`hidden`); add `after` to `add`'s strict keys; in-transaction order exactly as design:142 (schema lock, view select, one `schemaConflict or viewConflict or cellConflicts` predicate, apply columns and cells, cap on the insert path, write); `_run` takes each route's allowed query names, checks capability before `_payload()` for PATCH and values read through a public service helper (not a private one).
- [ ] **Step 4:** same command PASS; also run `.venv/bin/python -m unittest tests.test_db_migrations` and `make test-security`; read the summary lines.
- [ ] **Step 5:** commit "Scope review services and routes to a Department group (#267)".

### Task A3: Statement counts and PostgreSQL race tests

**Files:** Test `tests/test_sprint_review.py` (counts), `tests/test_sprint_review_postgresql.py`; design Performance table (pin measured numbers).

- [ ] **Step 1: failing tests:** SQLAlchemy `before_cursor_execute` counts on the design's fixture: GET 2, values read 2, empty PATCH 2, cell-only 4 plus upserts (one new cell on an existing group schema: 5 new vs 4 today), column-only 4, layout-only existing view 5, first view save 6, add plus layout 6 or 7 (AC 19); opt-in PostgreSQL (`REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1`, `TEST_DATABASE_URL`): two first creations of the group schema row, two first view saves for one Sprint, column add vs layout save in both orders (both succeed), empty PATCH takes no `FOR UPDATE`, model/database parity including `ON DELETE` (AC 17, 20, 21).
- [ ] **Step 2:** run the count tests (`tests.test_sprint_review`) FAIL; PostgreSQL tests need a local PostgreSQL (`EXEC-local-postgresql-runners.md`). If none exists, state "not run", leave Gate 6 open, and do not claim green.
- [ ] **Step 3:** adjust only if a count differs from measurement, then record measured numbers in the design.
- [ ] **Step 4:** PASS. Also launch `.venv/bin/python jira_server.py` from this checkout (verify the listening process belongs to it; port 5050 is the main checkout's, so use another port if implementing in a worktree) on a database at the new head and `curl http://localhost:<port>/api/test` with no Python warning before the Flask banner (Gate 6).
- [ ] **Step 5:** commit "Pin review statement counts and PostgreSQL races (#267)".

## Slice B: adoption and cutover (after A)

### Task B1: Adoption script and race trio

**Files:** Create `scripts/adopt_legacy_sprint_reviews.py`, `tests/test_adopt_legacy_sprint_reviews.py`; Modify `tests/test_sprint_review_postgresql.py` (trio, D-E).

**Interfaces.** Consumes A1 models, `sprint_order`, `apply_schema`/`apply_layouts`/`MAX_ACTIVE_COLUMNS`, `current_shared_groups_config` with a `workspace_id`-only context. Produces `main(argv=None) -> int`: `--workspace-id` (required), `--list`, `--apply`, `--expected-sha256` (the full `sha256:` string); dry run by default; refusals raise `ValueError` (exit 1), 2 only on lock timeout; 5s `lock_timeout` plus a 60s `statement_timeout` (D-G); dry run reports row counts per table and group; digest per the design.

- [ ] **Step 1: failing tests**, the full AC 22 list: dry run writes nothing; `--apply` refuses without a matching digest; lock-timeout exit 2 (PostgreSQL case or a SQLite simulation hook); SQLite racing check-then-insert aborts on the unique key as a sanitized `ValueError`; duplicate legacy column id across Sprints aborts with a count; a second apply after rename, archive, aggregation edit and view save refuses with zero writes; digest changes with the group set and is stable under row reordering; zero groups with legacy rows refuses, no legacy rows exits 0; malformed catalog or group id aborts; merge order, id and label of the earliest non-archived member, latest aggregation, kind purity, archive intent by the latest member, archived members' cells discarded and counted, cell precedence, cap ranking by the latest member; the 60-add bound; views only for layouts with content, single-kind rows left single-kind, first-occurrence de-dup, view cap keeping the highest `sprint_order`; chunked inserts; output has counts and ids only; `'jira_server' not in sys.modules` in a fresh `-I` subprocess that imports the script by file path with the repo root on `sys.path`; legacy rows never modified (legacy fixtures built through the retained legacy models). PostgreSQL trio in `tests/test_sprint_review_postgresql.py`: a writer holding an open transaction makes the script refuse with zero writes; the script holding its locks makes a writer block then see the adopted rows; a writer holding past `lock_timeout` makes the script exit 2.
- [ ] **Step 2:** `.venv/bin/python -m unittest tests.test_adopt_legacy_sprint_reviews -v` FAIL.
- [ ] **Step 3:** implement following `scripts/promote_legacy_shared_admin_config.py` (dialect-guarded `LOCK TABLE`, `_fingerprint` serialization style, uncaught `ValueError` = exit 1).
- [ ] **Step 4:** PASS (trio per the same local-PostgreSQL caveat).
- [ ] **Step 5:** commit "Add legacy sprint review adoption script (#267)".

### Task B2: Dockerfile and runbook

**Files:** Modify `Dockerfile`, `tests/test_container_packaging.py`, `README.md`, `INSTALL.md`.

- [ ] **Step 1:** failing packaging test: the script is copied into the image. **Step 2:** `.venv/bin/python -m unittest tests.test_container_packaging -v` FAIL. **Step 3:** extend line 38's `COPY`; write the cutover runbook and rollback table into the README and INSTALL deploy paragraphs (literal commands from the design, entrypoint override, every workspace with legacy rows has a configured group first, end-of-cutover `--list` check, fix the "workspace/Sprint" line, operator purge runbook for junk views, D-F decision applied). **Step 4:** PASS. **Step 5:** commit "Document the review adoption cutover (#267)". Rehearsal on a database copy is Gate 7 evidence in E2; without a copy the gate stays open.

## Slice C: client plumbing (after A)

### Task C1: API and controller

**Files:** Modify `frontend/src/api/sprintReviewApi.js`, `eng/usePlanningSprintReview.js`, the two review route globs in `tests/ui/planning_review_integration.spec.js` and `planning_capacity_editing.spec.js` (anchored to tolerate a query string; moved here so no commit breaks them); Test `tests/test_sprint_review_api.js`, `tests/test_planning_sprint_review.js`.

**Interfaces. Produces:** `fetchSprintReview(backendUrl, sprintId, { groupId, ...options })` (GET, `encodeURIComponent(groupId)`); `readSprintReviewValues`/`saveSprintReview` payloads carry `groupId`; PATCH carries `baseViewRevision`; a 409 error keeps `viewConflict`; hook parameter `groupId` and controller `setScope({sprintId, groupId, contextKey, active, rows, deferRead})`; state `groupId`, `viewRevision`, `currentViewRevision`, `savedViewRevision`, `inheritedFrom`, `currentInheritedFrom`, `savedInheritedFrom`, `groupBlocked`, `forceLoading`; `save()` sends the captured group and injects first-save layouts per the design; `error.code` branch placed after the `AuthenticationRequiredError` filter.

- [ ] **Step 1: failing tests** (AC 5 controller part, 11, 13, 26, 28 part): scope identity includes the group; `setScope` resets drafts, `loadedIds` and review state on a group change and `deferredRead` gains `!groupChanged`; `load` refuses an empty group; save sends the captured group; `viewRevision`/`inheritedFrom` through load, clean and dirty refresh, save, `discard`, `reapply`, `loadCurrent` and reset with direct assignment (no `||`/`??`, no stale hint after Load current); cell-only drafts survive a revision change, layout drafts conflict only on `viewRevision`, column drafts only on `schemaRevision`; first-save injection only with a pending layout action while `viewRevision` is 0 and `inheritedFrom` is non-null, never stored in `schemaChanges`, none from cell edit, rename, archive or total (each asserted), `reapply` after `viewConflict` leaves another user's other-kind layout alone; response keys applied only when present; a 200 without a column action records `columns`/`schemaRevision` as `current*` and forces a refresh; `groupBlocked` set by `review_group_unknown` and `review_view_limit` and not by an auth failure, cleared by Discard, group change, successful reload; `forceLoading` set only for non-automatic `force` loads and a refresh failing on a later batch restores the pre-refresh cells (decided: restore, not blank); either conflict flag shows the "shared table changed, draft preserved" state; injected layouts are intentionally not confirmed by `layoutConfirmed`; API tests assert URL encoding, `viewConflict` forwarding and that positional stubs still work.
- [ ] **Step 2:** `node --test tests/test_sprint_review_api.js tests/test_planning_sprint_review.js` FAIL.
- [ ] **Step 3:** implement; group travels in options so existing positional stubs keep working.
- [ ] **Step 4:** PASS, then `npm run test:frontend:unit` summary line and the two specs with `npx playwright test tests/ui/planning_review_integration.spec.js tests/ui/planning_capacity_editing.spec.js --browser=chromium`.
- [ ] **Step 5:** commit "Add group and view revisions to the review controller (#267)".

### Task C2: Group guard, activation, dismissal state

**Files:** Create `frontend/src/eng/usePlanningGroupScope.js`; Modify `dashboard.jsx`, `eng/EngControls.jsx`, `settings/useGroupVisibilityPreferences.js`, `settings/useTeamGroupSettings.js`, `settings/useFirstRunConfiguration.js`, `shareView/applyController.js`, `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`; Test `tests/test_share_view_source_guards.js`, `tests/test_planning_sprint_review.js`, `tests/test_share_view_planning_rows_seed.js`.

**Interfaces. Consumes:** C1. **Produces:** `usePlanningGroupScope({ planningReviewGuardRef, activeGroup, groupsLoading, ... })` returning `{ reviewGroupId, guardedSetActiveGroupId }`; the group hooks run before `usePlanningSprintReview`, so the guard reaches `planningReviewGuardRef.current` (already owned at `dashboard.jsx:380`, assigned `:4393`) by indirection; the guarded setter accepts values and functional updaters; activation requires `activeGroup?.id` and groups not loading, a transiently null `activeGroup` keeps the previous scope; dismissal map (newest 50, key group+Sprint, value source Sprint id and `viewRevision`) inside the existing preferences object and dependency list (`dashboard.jsx:3191-3253`, precedent `teamsEffortExpanded`).

- [ ] **Step 1: failing tests:** source guard pins the writer identities (not line numbers): `EngControls.jsx` dropdown, `applyController.js`, `useGroupVisibilityPreferences.js` (hide-active effect, apply-preferences, the two Settings Save paths), `useTeamGroupSettings.js` (two updaters), `useFirstRunConfiguration.js`, `dashboard.jsx` (`:2576`, `:3560`), each classified user-initiated (header dropdown; Settings Save, guarded before the persist call per D-D) or automatic (discard like a context change); `trackFilterChanged` fires inside the guarded callback so Stay reports nothing; the `active:` literal at `test_share_view_source_guards.js:128` updated with the group condition; controller test switches group while dirty; a transiently null `activeGroup` keeps the previous scope (AC 13); dismissal map bounded to 50, an overwritten entry newest, survives `saveUiPrefs` writes; a Settings Save changing the active group while dirty prompts and Stay aborts the save.
- [ ] **Step 2:** `node --test tests/test_share_view_source_guards.js tests/test_planning_sprint_review.js` FAIL.
- [ ] **Step 3:** implement. Re-sync the ceilings, aggregates and `unresolved` inventories for every registered file this task grows (D-B), with `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` green; the scope dialog copy is not touched here (D3).
- [ ] **Step 4:** PASS, `npm run build`, `npm run test:frontend:unit`, budgets test.
- [ ] **Step 5:** commit "Guard Department group changes in Planning review (#267)".

## Slice D: table UI (after C)

### Task D1: Model functions

**Files:** Modify `frontend/src/eng/planningReviewTableModel.js`; Test `tests/test_planning_review_table_model.js`. Derived columns are produced only when the caller passes `derived: true`, so the table is unchanged until D3.

**Interfaces. Produces:** `derivedValue(row, column, ctx) -> { scaled: bigint | null, complete: boolean }` (`ctx.isLoaded(id)`, `ctx.cells`, `ctx.forceLoading`); `nativeAnchorFor(order, afterId, derivedIds) -> string | null` (`afterId === null` is the corner: last native column of the full order passed in; a boundary after a derived id maps to the nearest preceding native id else `'summary'`); `buildPlanningReviewRows` adds `epicIssueId` from `group.epic.id`; `buildPlanningReviewColumns` accepts both kinds' definitions, folds missing custom columns through `insertColumnId` on the unfiltered list, appends derived columns (flag `derived: true`, never `custom: true`); `reviewValue`, `planningReviewTotals`, `sortPlanningReviewRows` branch on the derived flag and read `.scaled` (derived sums never go through `parseReviewNumber`); Epic-derived columns carry no aggregation.

- [ ] **Step 1: failing tests** (AC 8, 27, 28, 30, 31 model parts): the fold with `'summary'`, `null`, chained and sibling anchors, archived and hidden anchors, an empty order, admission-gated built-in anchors, derived after the fold; `nativeAnchorFor` boundary and corner cases; Story sum up to Epic only for number+sum, text and non-sum absent, "Show total" off removes the rollup, every Epic column down to Stories via `epicIssueId`, nothing reversed; sums of 1e9 and above sort ahead of 5 and total correctly; blank until every in-scope Story is loaded and available, blank during a forced load, blank with no stored value else a blank Story value is 0; "No Epic" row shows its own sum and counts once in rolled-up totals; Epic-derived has no total; `BigInt` sort, empties and incomplete last; edges: Story without Epic, awaiting-creation placeholder, Epic without in-scope Stories, Epic without issue id all blank; carried-over Story counts in each Sprint; unsaved source edit shows in both.
- [ ] **Step 2:** `node --test tests/test_planning_review_table_model.js` FAIL. **Step 3:** implement. **Step 4:** PASS and `npm run test:frontend:unit`. **Step 5:** commit "Add derived review columns and anchor placement to the model (#267)".

### Task D2: Playwright fixtures and harness (no behavior change)

**Files:** Modify `tests/ui/eng_epic_refresh_fixture.js` (conditional `addInitScript` so dismissal persistence is provable), `planning_review_integration.spec.js`, `planning_capacity_editing.spec.js` (two-group fixtures; a switch keeping derived columns out of existing Epic-mode tests), `planning_review_table.spec.js` (harness gains group, `inheritedFrom`/`viewRevision`, `groupName`, `resolveSprintName` and a derived switch; the eight `cost0..cost7` Story sum columns otherwise add eight rollups), `shareable_view_links.spec.js` (re-read the +42 on `origin/main` first; assert the link's `groupId` on the review GET).

- [ ] **Step 1:** no new behavior, so no red step; run the four specs before and after: `npx playwright test tests/ui/planning_review_table.spec.js tests/ui/planning_review_integration.spec.js tests/ui/planning_capacity_editing.spec.js tests/ui/shareable_view_links.spec.js --browser=chromium --workers=4`. Expected: identical pass counts before and after except the one new `groupId` assertion, which is red until D3 only if it depends on D3; it does not (C1 already sends `groupId`). Record counts.
- [ ] **Step 2:** commit "Prepare Playwright fixtures for group review columns (#267)".

### Task D3: Table UI and specs

**Files:** Create `frontend/src/eng/PlanningReviewDerivedCell.jsx`; Modify `eng/PlanningReviewTable.jsx`, `PlanningReviewColumnMenu.jsx`, `PlanningReviewStateCluster.jsx`, `EpicHeaderValueReadout.jsx`, `dashboard.jsx` (table props only, with ceiling re-sync under D-B), `styles/eng/planning-review-table.css`, `docs/design-system.md` (register the marker, the hint wrapper and the dismiss control before the CSS), `tests/design_system_baseline.json` and `tests/test_design_system_ratchets.js` only if the analyzer demands, the four Playwright specs from D2, `tests/test_planning_sprint_review.js`.

**Interfaces. Consumes:** D1 and C1/C2 state. **Produces:** props `groupName` and `resolveSprintName(sprintId) -> string | undefined`; Archive copy `Archive “<label>”? It leaves this table in every Sprint for <group name> and cannot be restored here.` (fallback "this group"); Add note "Shared with everyone in this Department group."; scope dialog copy "Sprint or group" (title "Save this Sprint review?" unchanged); `addColumn` sends the anchor computed by `nativeAnchorFor` and the creating Sprint's layout uses it; marker `<button type="button">` named "<label>, Story property" or "<label>, Epic property" with `aria-describedby`, built as a zero-height inline-block plus absolute 24x24 `::before`; readout always-on mode (default off) with tap-pin, second-tap close, outside close and the `suppressed` close across the dock flip; derived menu offers the existing "Move left", "Move right", "Hide column" only; hint "Layout inherited from <Sprint name>." with a dismiss `IconButton` (fallback "an earlier Sprint"), shown only when `inheritedFrom` is non-null and no layout action is pending, after the capability, error, form-error and recovery lines; `groupBlocked` rendered by `PlanningReviewStateCluster` with Save disabled; "unavailable in this deployment" gated on `schemaLoaded`; limit messages say "per group" and map `review_column_limit`/`review_schema_limit`; derived cell through the new component (not `CustomCell`), class `planning-review-custom` via the derived flag, text truncating at `max-width: 100%`.

- [ ] **Step 1: failing specs (harness from D2 exists, so the failure is the missing behavior):**
  - AC 9: Archive confirmation text with curly quotes and group name plus fallback; geometry for the longest label with a long group name. AC 10: hint shown only for inherited views with no pending layout action, ordering after error lines, geometry at 375px and desktop, settled hover, dock and reading position when it appears or disappears on load, save and refresh; dismissal persists across Sprint and group switches and reload, returns when the source `viewRevision` changes (also a unit test), works by tap.
  - AC 13 UI half: `groupBlocked` disables Save until Discard, group change or reload; the "unavailable" message is gated on `schemaLoaded`; the cap case (Add column at the cap in an inheriting Sprint leaves Discard as the exit).
  - AC 24, 30: Stories-mode "corner still appends" kept, an Epics-mode corner test added for the derived block, `harness.state().schemaChanges` shows the sent anchor, Hide separate per view, derived menu items, copy assertions updated for the Add note and the scope dialog.
  - AC 29: S/E before the name on right-aligned and after on left-aligned columns; `th` height 32 at 1280 and 390; hit area via `elementFromPoint`; `bodyDelta`/`totalDelta` under 1px and asserted non-null once a value shows; one focusable marker and one readout instance across the real and docked headers; accessible name at every place the column name appears; visible marker in the Show hidden rows; `hasTouch` test with `tap()` (one tap opens, second closes, outside closes); existing readout specs unchanged; no `title`; no edit affordance on derived cells; built-in Story-view parent columns unmarked.
  - AC 14 UI half, the real flow: add a group, rename it, delete it, add another from the default flow, and the review data reattaches; a visibility preference hiding a group does not stop reads or writes.
  - AC 32: zero extra schema or values requests on an Epics-to-Stories switch; equal values-read counts with and without Story sum columns.
- [ ] **Step 2:** run the specs (`--browser=chromium`) FAIL for the stated reasons.
- [ ] **Step 3: implement.** Reuse `.planning-review-guidance` text styling, `IconButton` and the existing column menu; no override of a shared component's layout (MRT021); screenshots at 1280 and 390 (light only, the app has no dark mode); look at them. Never `click({ force: true })`.
- [ ] **Step 4:** specs PASS with counts; headed Firefox and WebKit at 2x for the marker and dismiss glyph with painted-ink measurement (AGENTS section 11), or state that a browser was unavailable and keep Gate 5 open; `npm run test:frontend:unit`; `node --test tests/test_design_system_ratchets.js`; budgets test.
- [ ] **Step 5:** commit "Render derived columns, hint and group copy in the review table (#267)".

## Slice E: records and verification

### Task E1: Records

**Files:** `docs/features/planning-sprint-review.md`; `docs/plans/README.md`; `docs/ontology.md` (verify entries against code, record the date); `docs/README_ANALYTICS.md` (No-Event rows beside the 2026-10-16 row: hint dismissal, derived columns, marker and readout, group-switch dialog copy; hiding a derived column reuses `column_visibility_changed` with `mode` only; each row carries trigger, `event_type`, `event_name`, `feature_name`, typed params), `tests/test_analytics_source_guards.js` (substring pins); `backend/security/CONFIGURATION_OWNERSHIP.md` (lines 12, 21, 103-104, 116, 134, 144 and the opening paragraphs per the design's Ownership bullet); `AGENTS.md` section 11 learnings by topic (design's list); `docs/TODO.md` (deferred keyboard findings, if any); the design and this plan (divergence log, status, outcome).

- [ ] Step 1: failing guard tests (analytics substrings). Step 2: `node --test tests/test_analytics_source_guards.js` FAIL. Step 3: write the records. Step 4: PASS. Step 5: commit "Record group review columns in docs and ownership (#267)".

### Task E2: Full verification and Definition of Done

- [ ] Run, each read in full with its summary line: `make test`, `make test-security`, `npm run test:frontend:unit`, `npm ci && npm run build` then `make verify-dist-clean`, the review PostgreSQL tests where a database exists, `npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes), headed Firefox and WebKit geometry checks, the Gate 6 startup check, and the Gate 7 rehearsal on a database copy if available.
- [ ] One final independent read-only review of the whole diff (not per task) with the Plan Review Prompt lens and the design's Anti-Goals.
- [ ] Fill the Definition of Done table from evidence only; a skipped or blocked required check keeps its gate open. Update this plan's status, Outcome and Current Accuracy; rename to `DONE-` only after operator acceptance and merge.

## Definition of Done record

Verified 2026-10-20 at implementation head `5ba43fc4` after the identity rewrite (base: `origin/main` `f8167ad9`, merged in `27eb2974`; the Chromium run listed below ran at the pre-rewrite equivalent of `72a650c5`). Node 20.x, Python 3.14.7 locally (CI runs 3.10 and 3.11; touched Python parses under 3.10 rules). A skipped or unrun required check keeps its gate open; "Accepted by" stays empty until the operator accepts.

| Gate | Task coverage | AC | Evidence | Command results | Before / after | Screenshots | Limits | Accepted by / date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Group-wide columns and values | A2, D3b | 1, 2, 14, 15, 16 | `d69db071`, `b77055e4`, `5ba43fc4` | `tests.test_sprint_review` and routes OK (group isolation, cross-workspace, unavailable issues, hiding preference row server test) | | | AC 14 UI half is a stubbed-catalog Playwright test plus a node `buildGroupId` test, not a full Settings add/rename/delete/add flow; operator acceptance of that divergence pending. Hidden-group guarantee is server-side only (UI cannot select a hidden group) | open |
| 2 Sprint views and write contract | A2, C1 | 3, 4, 5, 6, 7, 12 | `d69db071`, `d96d0072` | service, route and controller suites OK; patched-`search` precedence test; node controller tests 2927/2927 | | | Post-PATCH column refresh is an automatic load and can be skipped if a new draft starts first (recovers via reapply) | pass pending acceptance |
| 3 Column order, Archive, Hide | A2, D1, D3b | 8, 9 | `fec8207f`, `b77055e4` | model tests; Playwright Archive copy and geometry; `schemaChanges` anchor assertions | | `tmp/267-ui` (not committed) | Headed Firefox/WebKit geometry for the marker not run | open |
| 4 Hint, group changes, errors | C1, C2, D3b | 10, 11, 13, 26 | `d96d0072`, `b77055e4`, `5ba43fc4` | six-spec Chromium run 361 passed, 3 skipped; headed Firefox and WebKit at 2x: dismiss glyph within 0.19px of frame centre (implementer-reported) | | hint shown/dismissed 375 and 1280, group-blocked | Settings Save Stay/prompt proven at hook level only; modal focus-trap vs scope dialog untested; hint line wraps (no truncation) with a long Sprint name | open |
| 5 Derived Epic/Story columns | D1, D3a | 27 to 32 | `fec8207f`, `028e1584` | model 28/28; four specs 224 passed, 1 skipped (headed-only) | | derived Epic/Story views at 1280 and 390 | Headed Firefox/WebKit marker geometry and painted ink not run | open |
| 6 Storage, counts, concurrency | A1, A2, A3 | 17 to 21 | `c612501d`, `b65b9ea7`, `11c1a523` | CI runner module set on a throwaway PostgreSQL 18 at head: 77 tests OK, 0 skipped; statement counts pinned and equal the design table; offline render and parity tests OK; server starts at head with no warning before the banner and `/api/test` answers 401 `auth_required` (unauthenticated, OAuth mode) | counts: GET 2, values 2, empty PATCH 2, new cell 5 (4 before), column-only 4, layout-only 5, first view 6, add+layout 6/7 | | No GitHub CI run observed (nothing pushed); the local operator database was deliberately not migrated | open pending CI |
| 7 Adoption and cutover | B1, B2 | 22 | `11c1a523`, `8189c9a5` | 23 script tests OK; PostgreSQL race trio OK on throwaway server | | | Cutover rehearsal on a copy of a database with legacy data not done | open |
| 8 Records and analytics | E1 | 23 | `36ed2690` | analytics guard 34/34; budgets OK; ontology paths resolve | | | | pass pending acceptance |
| 9 Suites, budgets, fixtures | C1, C2, D2, D3, E2 | 24, 25, 33 | `72a650c5`, `5ba43fc4` | `make test` 2256 OK/37 skipped (skips are the opt-in PostgreSQL tests, run separately above); `make test-security` 82 OK; `npm run test:frontend:unit` 2927/2927; `npm ci` + `npm run build` reproducible, `make verify-dist-clean` clean; full Chromium `tests/ui` 1781 passed, 12 skipped, 0 failed (run at `72a650c5`; later fixes re-ran the touched specs, 325 passed/1 skipped) | | | Extraction lint reports 6 enforced hook-interface problems unrelated to this work (backendUrl/BACKEND_URL inputs in `GroupBoardSettings.jsx`, `useTeamCatalogLifecycle.js`, other members of `useTeamGroupSettings.js`; they arrived with `origin/main`); no CI runs the lint | open pending full Chromium re-run at the final head and headed browsers |
| 10 Delivery | operator-triggered | none | | | | | Merge commit `27eb2974` had carried a personal author email; the unpushed branch history was rewritten on 2026-10-20 with the operator's approval so every commit uses the noreply identity (hashes after the merge changed; the tree is identical). Delivery itself is still operator-triggered | open |

## Subagent protocol

One implementer per task with a self-contained brief (task contract and Interfaces, exact files, forbidden regressions, commands, "do not commit, push, or use the network beyond git fetch"). I verify each report with `git diff` and the commands before accepting it; completed agents are closed; reviewers are read-only; two failed attempts on one issue stop the run. Trivial or documentation-only fixes are done inline. Commits are made by me after verification, per Gate A.

## Self-review

Coverage: AC 1-33 map to tasks above; AC 14 is split A2 (service) and D3 (UI); AC 20 runs in A3 and B1; AC 23 in E1; AC 33 in E2. Residual risks accepted by the design: any user can fill the 500-view cap (purge runbook in B2); PostgreSQL evidence needs a local database or CI, which this run cannot trigger (Gate 6 and the trio may stay open); extraction digests are re-synced by hand and no CI runs the lint.
