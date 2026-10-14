# Shareable View Links Implementation Plan

> **Status:** Proposed 2026-10-14. Implementation not started. Awaiting operator review of this plan.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per-task status and commits are recorded in the Execution status table below, inside this committed file, not in a scratch ledger.

**Goal:** A header Share control copies a readable, self-contained URL for the current ENG view (Catch Up, Planning, Board, Statistics); a recipient in the same workspace who opens it, signing in first if needed, lands in the same view bounded by their own Jira access.

**Architecture:** A pure link codec and resolver in `frontend/src/shareView/`; an entry module that strips the link from the URL before React mounts; a staged apply machine driven by readiness signals and mounted after the App's own restore effects; a focus capture and reveal pair; one Share control rendered on both header surfaces; and a small server stash in the signed session cookie that carries the query through the OAuth login hop. No new route, no stored token.

**Tech Stack:** Python 3.10+ and Flask (stash, redirects); React 19 and esbuild on Node 20.x; `node:test` unit tests bundled through esbuild into a `vm` sandbox; Playwright UI specs; `unittest`.

**Spec:** [`SUPPORT-shareable-view-links-design-194.md`](SUPPORT-shareable-view-links-design-194.md) (validated 2026-10-14; executors read it first). Issue: [#194](https://github.com/Juce-me/jira-execution-planner/issues/194).

## How this plan is organized

This file is the master: status, constraints, file map, contracts and the three lead-owned tasks (0, 13, 14). The code-bearing tasks live in six slice files grouped by area. A task's section is self-contained: an implementer reads this file's Global Constraints and Review Focus plus that task's section.

| Slice file | Tasks |
| --- | --- |
| [`EXEC-shareable-view-links-194-server.md`](EXEC-shareable-view-links-194-server.md) | 1 Server login stash and shared corpus; 2 Log hygiene and privacy notice |
| [`EXEC-shareable-view-links-194-codec.md`](EXEC-shareable-view-links-194-codec.md) | 3 View defaults and link codec |
| [`EXEC-shareable-view-links-194-resolver-store.md`](EXEC-shareable-view-links-194-resolver-store.md) | 4 Resolver; 5 Store and entry |
| [`EXEC-shareable-view-links-194-apply.md`](EXEC-shareable-view-links-194-apply.md) | 6 `dashboard.jsx` extractions; 9 Apply machine; 11a, 11b, 11c Apply hook, mount and acceptance spec |
| [`EXEC-shareable-view-links-194-focus.md`](EXEC-shareable-view-links-194-focus.md) | 7 Alert anchors and focus capture; 8 Focus reveal and Planning rows seed |
| [`EXEC-shareable-view-links-194-control.md`](EXEC-shareable-view-links-194-control.md) | 10 Analytics; 12 Share control, notice and header surfaces |

## Execution status

Record per-task status and commit SHA here as each task lands (statuses: `planned`, `in-progress`, `done`, `blocked`, `declined`). Rename `EXEC-` to `DONE-` only after the work is merged (`docs/plans/AGENTS.md`).

| Task | Title | Status | Commit | Operator gate |
| --- | --- | --- | --- | --- |
| 0 | Baseline and preflight | planned | | |
| 1 | Server login stash and shared corpus | planned | | |
| 2 | Log hygiene and privacy notice | planned | | G1 confirm before executing |
| 3 | View defaults and codec | planned | | |
| 4 | Resolver | planned | | |
| 5 | Store and entry | planned | | |
| 6 | `dashboard.jsx` behavior-preserving extractions | planned | | Checkpoint |
| 7 | Alert anchors and focus capture | planned | | |
| 8 | Focus reveal and Planning rows seed | planned | | |
| 9 | Apply machine (pure) | planned | | |
| 10 | Analytics `share_view_action` | planned | | |
| 11a | Apply controller, capture builder, interaction guard and hook | planned | | |
| 11b | Mount: hold, options, tour wait and Planning table key | planned | | |
| 11c | Link UI acceptance spec | planned | | Checkpoint (Task 11) |
| 12 | Share control, notice and header surfaces | planned | | G2 mock acceptance |
| 13 | Docs, ontology, budgets and plans index | planned | | |
| 14 | Journeys, full verification and publication | planned | | G3 explicit publish go |

Order: 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11a, 11b, 11c, 12, 13, 14, with Task 2 anywhere after Task 1 once G1 is confirmed. Checkpoint tasks end with: report the SHA, files, results and a concrete manual validation scope, then STOP until the operator confirms. If a task fails twice on the same issue, stop, summarize the evidence and ask (`AGENTS.md` section 6).

### Operator gates

- **G1 (Task 2):** the container access-log format change and the `find` key stand or fall together. Confirm design Open item 3 before executing Task 2. If declined: skip the access-log format and the log-redaction extension, still apply Task 2's `docs/PRIVACY.md` edit without the search-text clause (the pending-link cookie needs its notice), apply the "If the operator declines Task 2" edits in Task 3 (they remove `find`), and mark Task 2 `declined`.
- **G2 (Task 12):** the standalone mock of the Share control states is reviewed first; record `Operator acceptance: <date>` in Task 12's Step 2 (in the control slice file) before wiring.
- **G3 (Task 14):** nothing is pushed and no PR is opened without an explicit operator go (`AGENTS.md` section 10, publication transaction).
- **Accepted by default unless the operator objects at plan review** (design "Open items"): Share rendered on both header surfaces; the v1 trims (no Board focus, no Board facets, no Statistics display options, no assignee filters); the Planning rows seed as a one-shot initial value; Board `scope` links opening at most one strict stream; extracting the two `dashboard.jsx` helpers; the budget ratchets in the ledger below; one transient lint warning in Task 11b.

## Global Constraints

Every task's requirements include this section. Values are copied from the design.

- **Link:** plain query at `/`; `v=1` first; `v`, `mode`, `group`, `sprint` always written; every other key written only when it differs from its default constant, except that `stats=cohort` always writes `from` and `to`; an omitted key means its default constant, never the recipient's saved value. Modes: `catch-up`, `planning`, `board`, `statistics`. Search key is `find`; the keys `q`, `s`, `search`, `query`, `keyword` are never emitted.
- **Caps:** whole query at most 1,536 characters; `v` plus at most 40 further pairs; first duplicate wins; allowed alphabet `[A-Za-z0-9._~%&=,:-]`; atoms are `encodeURIComponent` plus `!'()*` percent-encoded; decode never uses `URLSearchParams`; `find` at most 100 code points; at most 20 facet atoms of at most 100 chars; at most 12 Team ids.
- **Stash:** TTL 900 seconds; cookie guard 3,300 bytes; query at most 1,536 bytes; pattern equals the shared corpus fixture; written only on GET in the final unauthenticated branch; consumed at exactly three exits (callback success and the two authenticated `/login` redirects); cleared on logout and on authenticated entry; redirect target is the literal `'/?' + q` or `'/'`; the stash 302 carries `Cache-Control: no-store`.
- **Apply:** staged A scope, B fields, C data-dependent, D focus; the ENG task load is held until one commit after Stage B (not while a Planning recovery capsule is pending); raw setters and refs only; never `applyEngMode`, `clearEngFilters`, `resetEngFilters`, `navigateToAlertStory`, `handleAlertStoryClick`; no link value is ever interpolated into a selector; no mutating request outside the read allowlist (`/api/dependencies`, `/api/stats/*`, sprint-review `values/read`, `/api/performance/loads`, `/api/auth/refresh`); budgets 90 s overall, A and B 5 s each, C 20 s, D 20 s; a reload before the apply completes drops the link; no `sessionStorage` mirror.
- **Focus:** capture treats an element as visible only past `T + 12 + 1`; a reveal lands the target at `T + 12` (`SHARE_VIEW_FOCUS_MARGIN`); no highlight CSS is added.
- **Server:** no new route, no new `EndpointPolicy`; exactly one `@app.before_request` in `jira_server.py`; tests patch `jira_server.<name>` or the helper module, never `auth_routes.<name>` (`bind_server_globals` re-copies globals into the route modules on every request).
- **Frontend:** exactly six `window.addEventListener('keydown', handler)` registrations in the guarded owner files (the interaction guard uses `document` capture listeners in `shareView/`); ESLint warnings never exceed the 106 ratchet (Task 11b adds one transient `no-unused-vars`, cleared in Task 12); Node tests are `tests/test_*.js` (support files are not named `test_*.js`); new `.json` fixtures under `tests/fixtures/` must be named `*-example-sanitized.json` or `*-template.json` or they are gitignored; the regenerated `frontend/dist/` is committed by every task that changes a file under `frontend/src` (the build id hashes the whole tree) and is never hand-edited; `npm ci` before `npm run build` in a fresh worktree.
- **Budgets:** `dashboard.jsx` is pinned in `tests/test_codebase_structure_budgets.py` (legacy dict) and by exact equality in `scripts/extraction_lint/owner_budgets.json` (`dashboard.lineCount`, `dashboard.lineCeiling`, `aggregates.appPlusOwners`), so both move together in the same commit; `jira_server.py` is pinned at its exact line count. The expected sequence is in the ledger below; always measure with `wc -l`.
- **Analytics:** two-trigger dataLayer contract; one new event `share_view_action` with fixed enums only; no URL, id, name or key in any payload; the GA4 page URL is never overridden.
- **Repo hygiene:** commit with `git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit`; no `Co-Authored-By` trailer and no agent or tool branding anywhere (branches, commits, PRs, code, docs); no absolute local path, real email, hostname, secret, token or real Jira key in any committed file; synthetic or sanitized fixtures only; every changed line traces to this plan; after every commit run `git show --stat HEAD` and `git status --short` and read them; never push without an explicit operator go.
- **Commands:** `$PY` is `.venv/bin/python` (in a worktree without `.venv`, the interpreter named by `JEP_TEST_PYTHON`, which Task 0 exports). `$TEST_ENV` is `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access'` so a symlinked real `.env` cannot leak into tests. Node runs the version in `.nvmrc` (`fnm exec --using 20`). Lint is `fnm exec --using 20 bash scripts/extraction_lint/run.sh` (the script is not executable and its budget step reads `JEP_TEST_PYTHON`). Filter Playwright result lines with `grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)'` because several spec titles contain those words. The UI specs read `frontend/dist/*`, so a built, committed `frontend/dist` must exist.
- **Live data:** any operator live check is read-only and transient: numbers-only probes, no saved or published screenshots, the operator signs in themselves.

### Budget ledger (expected values; measure, do not trust)

| After | `dashboard.jsx` lines (legacy pin) | `appPlusOwners` | `jira_server.py` lines (pin) |
| --- | --- | --- | --- |
| Baseline `bd5b2bc2` | 7,573 | 34,175 | 6,487 |
| Task 1 | 7,573 | 34,175 | 6,491 |
| Task 5 | 7,574 | 34,176 | 6,491 |
| Task 6 | 7,585 | 34,187 | 6,491 |
| Task 11b | 7,620 | 34,222 | 6,491 |
| Task 12 | 7,627 | 34,229 | 6,491 |

Net: `dashboard.jsx` plus 54 lines and `jira_server.py` plus 4, each ratcheted with a one-line reason; the precedent is the data-freshness work (plus 48).

## Review Focus

The five input classes the design implies, and the task whose tests pin each:

1. **First-run recipient** (onboarding popup open; the link's group is not the group they pick): the payload is held through the popup, then dropped with a notice, and the Catch Up tour does not auto-start before the link is terminal. Task 11c.
2. **Recipient whose saved view is EPM** (or whose saved mode flags are Scenario): lands in the link's ENG view; the one-shot EPM restore is consumed. Task 11c.
3. **Same-scope link** (group and Sprint already equal the current scope): Stage A is skipped; Stages B and C still apply fields, Teams and facets. Task 11c.
4. **Ids with comma, colon, percent, plus, quote, space and non-ASCII** (a Team, group or status name): round-trip through the codec and still match the stash pattern. Task 3 (with the Task 1 corpus).
5. **`navigator.clipboard` undefined, a rejected write, or an encoded URL over the cap**: a selectable fallback field or a refusal message, never a thrown error and never a truncated URL. Task 12 and Task 3.

## File map

Generated from each task's own `Files` block; the task sections are authoritative. Every task that changes `frontend/src` also commits the regenerated `frontend/dist/`.

| Task | Creates | Modifies | Extends existing tests |
| --- | --- | --- | --- |
| 1 | `backend/auth/share_view_stash.py`<br>`tests/fixtures/share-view-query-corpus-example-sanitized.json`<br>`tests/test_share_view_stash.py` | `jira_server.py`<br>`backend/routes/auth_routes.py`<br>`tests/oauth_test_helpers.py`<br>`tests/test_codebase_structure_budgets.py` | `tests/test_auth_entry_page.py`<br>`tests/test_auth_routes.py`<br>`tests/test_db_oauth_cutover.py` |
| 2 |  | `scripts/docker-entrypoint.sh`<br>`jira_server.py`<br>`docs/PRIVACY.md` | `tests/test_container_packaging.py`<br>`tests/test_logging_migration.py` |
| 3 | `frontend/src/shareView/viewDefaults.js`<br>`frontend/src/shareView/codec.js`<br>`tests/test_share_view_codec.js` |  |  |
| 4 | `frontend/src/shareView/resolver.js`<br>`tests/test_share_view_resolver.js` |  |  |
| 5 | `frontend/src/shareView/store.js`<br>`frontend/src/shareView/entry.js`<br>`tests/test_share_view_store.js` | `frontend/src/dashboard.jsx`<br>`tests/test_codebase_structure_budgets.py`<br>`scripts/extraction_lint/owner_budgets.json` |  |
| 6 | `tests/test_share_view_extraction_characterization.js` | `frontend/src/dashboard.jsx`<br>`tests/test_codebase_structure_budgets.py`<br>`scripts/extraction_lint/owner_budgets.json` |  |
| 7 | `frontend/src/shareView/focusCapture.js`<br>`tests/test_share_view_alert_anchors.js`<br>`tests/test_share_view_focus_capture.js`<br>`tests/ui/share_view_focus.spec.js`<br>`tests/share_view_fake_dom.js`<br>`tests/share_view_alert_panel_fixture.js` | `frontend/src/eng/EngAlertsPanel.jsx` | `tests/ui/eng_alerts_panel_summary.spec.js` |
| 8 | `frontend/src/shareView/focusReveal.js`<br>`tests/test_share_view_focus_reveal.js`<br>`tests/test_share_view_planning_rows_seed.js` | `frontend/src/eng/PlanningReviewTable.jsx`<br>`tests/ui/share_view_focus.spec.js` | `tests/ui/planning_review_table.spec.js` |
| 9 | `frontend/src/shareView/applyMachine.js`<br>`tests/test_share_view_apply_machine.js` |  |  |
| 10 |  | `frontend/src/analytics/events.js`<br>`frontend/src/analytics/dashboardAnalytics.js`<br>`docs/README_ANALYTICS.md`<br>`docs/plans/SUPPORT-ga4-user-configuration.md` | `tests/test_analytics_events.js`<br>`tests/test_analytics_source_guards.js` |
| 11 | `frontend/src/shareView/applyController.js`<br>`frontend/src/shareView/captureState.js`<br>`frontend/src/shareView/interactionGuard.js`<br>`frontend/src/shareView/useShareViewApply.js`<br>`tests/test_share_view_apply_controller.js`<br>`tests/test_share_view_capture_state.js`<br>`tests/test_share_view_interaction_guard.js`<br>`tests/test_share_view_apply_hook.js`<br>`tests/test_share_view_source_guards.js`<br>`tests/test_share_view_onboarding_wait.js`<br>`tests/ui/shareable_view_links.spec.js` | `tests/react_hook_harness.js`<br>`frontend/src/dashboard.jsx`<br>`frontend/src/onboarding/useOnboardingTour.js`<br>`tests/test_dashboard_freshness_interactions.js`<br>`tests/test_codebase_structure_budgets.py`<br>`scripts/extraction_lint/owner_budgets.json` |  |
| 12 | `assets/mockups/share-view-control-194.html`<br>`frontend/src/shareView/ShareViewButton.jsx`<br>`frontend/src/shareView/noticeCopy.js`<br>`tests/test_share_view_control.js`<br>`tests/ui/share_view_control_harness.jsx`<br>`tests/ui/share_view_control.spec.js` | `frontend/src/dashboard.jsx`<br>`frontend/src/styles/shared/controls.css`<br>`tests/ui/codebase_structure_smoke.spec.js`<br>`tests/test_codebase_structure_budgets.py`<br>`scripts/extraction_lint/owner_budgets.json` |  |
| 13 | `docs/features/shareable-view-links.md` | `docs/features/README.md`<br>`docs/features/eng-workflows.md`<br>`README.md`<br>`docs/architecture.md`<br>`docs/SUPPORT-atlassian-oauth-setup.md`<br>`docs/ontology.md`<br>`docs/TODO.md`<br>`docs/plans/README.md` | |
| 14 | | `docs/plans/EXEC-shareable-view-links-194.md`<br>`docs/plans/README.md` | |

## Cross-task contracts

Names one task produces and another consumes. Each is defined in the producing task and used with this spelling everywhere.

| Producer | Names | Consumers |
| --- | --- | --- |
| Task 1 | `stash_share_view_query(request, session, *, now=None)`, `pop_share_view_target(session, *, now=None)`, `clear_share_view_stash(session)`, `SHARE_VIEW_QUERY_PATTERN`; fixture `tests/fixtures/share-view-query-corpus-example-sanitized.json` (`pattern`, `maxQueryBytes`, `accepts`, `rejects`) | Task 3 (corpus test), Task 13 |
| Task 3 | `encodeShareView`, `decodeShareView`, `stripShareViewParams`, `SHARE_VIEW_MAX_QUERY`, `SHARE_VIEW_QUERY_KEYS`, `SHARE_VIEW_CATEGORY_BY_KEY`; `SHARE_VIEW_DEFAULTS`, `SHARE_VIEW_MODES`, `SHARE_VIEW_VERSION`, `SHARE_VIEW_KEYS_BY_MODE`, `SHARE_VIEW_ALERT_KEYS`, `SHARE_VIEW_ALERT_ANCHORS` | Tasks 4, 5, 7, 11a, 12 |
| Task 4 | `resolveShareViewScope`, `buildShareViewFieldPlan`, `resolveShareViewTeams(state, group, mode)`, `resolveShareViewFacets(state, options, mode)`, `resolveShareViewFocus` | Task 11a |
| Task 5 | `initShareViewFromLocation`, `getShareViewSnapshot`, `subscribeShareView`, `beginShareViewStage`, `markShareViewScopeCommitted`, `finishShareView` (returns a boolean), `dismissShareViewNotice`, `setPendingPlanningRowMode`, `takeInitialPlanningRowMode`, `resetShareViewForTests`, `SHARE_VIEW_PHASES` | Tasks 8, 11a, 11b |
| Task 7 | `captureShareViewFocus`, `readPlanningRowsMode`, `alertCardId`, `measureShareViewStickyBottom`, `SHARE_VIEW_FOCUS_MARGIN`; `data-alert-team` on every alert team group | Tasks 8, 11a |
| Task 8 | `revealShareViewFocus`; the Planning rows seed in `PlanningReviewTable.jsx` | Task 11a |
| Task 9 | `stepApplyMachine` | Task 11a |
| Task 10 | `trackShareViewAction`, `buildShareViewActionParams`; `analyticsReady` from `useDashboardAnalytics` | Task 11a and 11b |
| Task 11 | `useShareViewHold`, `useShareViewApply` (result `{ notice, dismissNotice, captureShareUrl, shareDisabled, applyTerminal }`), `useShareViewApplyTerminal`, `useShareViewPlanningTableKey`; `commitSprintSelection` and `persistTeamSelection` inside `App()` | Task 12 |
| Task 12 | `ShareViewButton`, `shareViewNoticeMessage`, `shareViewDroppedCategories` | Task 13 |

Notice categories: `group`, `sprint`, `mode`, `teams`, `filters`, `focus`. Notice kinds: `dropped`, `partial`, `invalid`, `newer`. Apply result to event result: `done` to `success`, `partial` to `partial`, `dropped` and `cancelled` to `rejected`.

---

### Task 0: Baseline and preflight

**Owner note:** First task; blocks everything. Documentation-only commit.

**Files:**
- Modify: `docs/plans/EXEC-shareable-view-links-194.md` (the Baseline table below and the Execution status row)

**Interfaces:**
- Produces: the recorded baseline numbers every later "no regression" claim compares against.

**Forbidden regressions for this task:** none (no code changes).

- [ ] **Step 1: Confirm the branch and the base**

Run:
```bash
git branch --show-current
git status --short
git fetch origin
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; the log shows only this feature's documentation commits; the name-status lists only files under `docs/plans/` (this plan, its slices, the design, the plans index, the FUTURE pointer and the GATE-05 review date). If `origin/main` moved, sync before continuing (for an app-made worktree use the app's `sync_with_base_branch` tool; otherwise merge `origin/main` into the branch), then re-run this step and Step 3. Never merge feature work into local `main`.

- [ ] **Step 2: Read the instruction chain and the related postmortems**

Read root `AGENTS.md` (sections 10 and 11), `docs/plans/AGENTS.md`, `docs/AGENTS.md`, the design `docs/plans/SUPPORT-shareable-view-links-design-194.md`, and these postmortems (the lesson that applies is in parentheses): `MRT009-sticky-layering-regressions.md` (do not change sticky offsets or z-index), `MRT010-startup-api-load-fanout-and-overscoped-payloads.md` (no redundant startup requests), `MRT020-project-track-filter-bar-bespoke-controls.md` and `MRT021-project-track-segmented-control-override.md` (reuse the shared control and its class hooks), `MRT023-alert-enrichment-blocked-first-screen.md` (alert work must not block the first screen), `MRT025-pr-publication-transaction-failures.md` (publication is one verified transaction), `MRT027-board-catalog-pagination.md` and `MRT031-board-discovery-page-token-budget.md` (Board scope and loading contracts). Record "read" in the status row.

- [ ] **Step 3: Verify every existing file this plan modifies exists**

Run:
```bash
for f in \
  .nvmrc \
  Makefile \
  README.md \
  backend/routes/auth_routes.py \
  docs/PRIVACY.md \
  docs/README_ANALYTICS.md \
  docs/SUPPORT-atlassian-oauth-setup.md \
  docs/TODO.md \
  docs/architecture.md \
  docs/features/README.md \
  docs/features/eng-workflows.md \
  docs/ontology.md \
  docs/plans/README.md \
  docs/plans/SUPPORT-ga4-user-configuration.md \
  frontend/src/analytics/dashboardAnalytics.js \
  frontend/src/analytics/events.js \
  frontend/src/dashboard.jsx \
  frontend/src/eng/EngAlertsPanel.jsx \
  frontend/src/eng/PlanningReviewTable.jsx \
  frontend/src/onboarding/useOnboardingTour.js \
  frontend/src/styles/shared/controls.css \
  jira_server.py \
  package.json \
  scripts/docker-entrypoint.sh \
  scripts/extraction_lint/owner_budgets.json \
  scripts/extraction_lint/run.sh \
  tests/oauth_test_helpers.py \
  tests/react_hook_harness.js \
  tests/test_analytics_events.js \
  tests/test_analytics_source_guards.js \
  tests/test_auth_entry_page.py \
  tests/test_auth_routes.py \
  tests/test_codebase_structure_budgets.py \
  tests/test_container_packaging.py \
  tests/test_dashboard_freshness_interactions.js \
  tests/test_db_oauth_cutover.py \
  tests/test_logging_migration.py \
  tests/ui/codebase_structure_smoke.spec.js \
  tests/ui/eng_alerts_panel_summary.spec.js \
  tests/ui/planning_review_table.spec.js; do [ -e "$f" ] && echo "ok       $f" || echo "MISSING  $f"; done
```
Expected: no `MISSING` line. A missing file means the plan is stale: stop and report.

- [ ] **Step 4: Prepare the toolchain**

Run:
```bash
cat .nvmrc && fnm exec --using 20 node -v
npm ci
export JEP_TEST_PYTHON=<path to a Python interpreter that has the repo requirements, for example the main checkout's .venv/bin/python>
"$JEP_TEST_PYTHON" -c "import flask, itsdangerous; print('python ok')"
```
Expected: the Node version printed matches `.nvmrc`; `npm ci` succeeds; `python ok`. The interpreter path is a local choice; do not write it into any committed file.

- [ ] **Step 5: Record the baselines**

Run each command and write the summary line into the Baseline table below.
```bash
env $TEST_ENV $JEP_TEST_PYTHON -m unittest discover -s tests
make test-security
npm run test:frontend:unit
env $TEST_ENV $JEP_TEST_PYTHON -m unittest tests.test_codebase_structure_budgets
fnm exec --using 20 bash scripts/extraction_lint/run.sh
npm run build && make verify-dist-clean
npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/ga4_tag_and_events.spec.js tests/ui/eng_group_board_view.spec.js --browser=chromium
npx playwright test tests/ui/codebase_structure_smoke.spec.js --browser=firefox
npx playwright test tests/ui/codebase_structure_smoke.spec.js --browser=webkit
```
Expected: all pass except the known environment-specific baseline failures, which you record by name instead of fixing: the load-sensitive `test_local_postgresql_runner` signal tests (they pass alone) and two `Task9 freshness reserved copy` cases in `codebase_structure_smoke.spec.js` that already fail in headless WebKit (document width 782 px against 781 and 755 px). Record counts, not just "pass". A baseline failure unrelated to this work is recorded with its name and the run continues only if the operator agrees; do not fix it in this branch.

| Gate | Command | Result | Date |
| --- | --- | --- | --- |
| Python suite | `unittest discover -s tests` | | |
| Security matrix | `make test-security` | | |
| Node unit | `npm run test:frontend:unit` | | |
| Structure budgets | `tests.test_codebase_structure_budgets` | | |
| Extraction lint | `fnm exec --using 20 bash scripts/extraction_lint/run.sh` | | |
| Build and dist | `npm run build && make verify-dist-clean` | | |
| UI baseline, Chromium | the three specs above | | |
| UI baseline, Firefox | `codebase_structure_smoke.spec.js` | | |
| UI baseline, WebKit | `codebase_structure_smoke.spec.js` | | |

- [ ] **Step 6: Run the startup gate sweep (auth work)**

Run `rg --files docs/plans | rg '/GATE-'`, open each `GATE-*` file, and follow `docs/plans/AGENTS.md` "Startup Gate Sweep": update `Checked on` and `Last result` only if the next review date has arrived; run a gate command only when its required inputs exist; never mark a gate passed without its documented `PASS` output.

- [ ] **Step 7: Commit**

```bash
git add docs/plans/EXEC-shareable-view-links-194.md
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Record baseline for shareable view links plan" -m "Baseline gate results measured before any code change, so later no-regression claims compare against recorded numbers."
git show --stat HEAD
git status --short
```
Expected: one file changed; clean tree.

---

## Task index

The code-bearing tasks, in execution order, with the slice that holds each section.

| Task | Delivers | Slice |
| --- | --- | --- |
| 1 | `backend/auth/share_view_stash.py`, its wiring into the entry redirect, the callback, both authenticated `/login` redirects and logout, and the shared corpus fixture | server |
| 2 | Access-log format without query or Referer (path rendered with `%(U)r`), redaction of `/?v=` in development logs, the privacy notice (gate G1) | server |
| 3 | `viewDefaults.js` and `codec.js`: every key, defaults, encoding, decoding, over-cap rules | codec |
| 4 | `resolver.js`: scope, field plan, Teams, facets and focus resolution, all pure | resolver-store |
| 5 | `store.js`, `entry.js` and the first import in `dashboard.jsx`: strip before mount, snapshot store, one-shot Planning rows seed | resolver-store |
| 6 | `commitSprintSelection` and `persistTeamSelection` extracted from `dashboard.jsx` handlers, characterization-tested first | apply |
| 7 | `data-alert-team` on every alert team group; `focusCapture.js` | focus |
| 8 | `focusReveal.js`; the Planning rows seed in `PlanningReviewTable.jsx` | focus |
| 9 | `applyMachine.js`: the pure stage, lifecycle and budget machine | apply |
| 10 | `share_view_action` allowlist entry, builder, `trackShareViewAction`, `analyticsReady`, analytics docs | control |
| 11a | `applyController.js`, `captureState.js`, `interactionGuard.js`, `useShareViewApply.js` | apply |
| 11b | The hold, the options object, the onboarding wait and the Planning table key in `dashboard.jsx` | apply |
| 11c | `tests/ui/shareable_view_links.spec.js` with six negative controls (Task 11 checkpoint) | apply |
| 12 | The mock (gate G2), `ShareViewButton.jsx`, `noticeCopy.js`, header placement on both surfaces, header test updates | control |

---

### Task 13: Docs, ontology, budgets and plans index

**Owner note:** Depends on Tasks 1 to 12. Documentation and budget bookkeeping only; no behavior change.

**Files:**
- Create: `docs/features/shareable-view-links.md`
- Modify: `docs/features/README.md`, `docs/features/eng-workflows.md`, `README.md`, `docs/architecture.md`, `docs/SUPPORT-atlassian-oauth-setup.md`, `docs/ontology.md`, `docs/TODO.md`, `docs/plans/README.md`
- Verify (no edit unless a measurement moved): `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/owner_budgets.json`

**Interfaces:**
- Consumes: the final names, file paths and user-facing strings from Tasks 1 to 12. The apply-result notice strings live in `frontend/src/shareView/noticeCopy.js` (`shareViewNoticeMessage`); read them there rather than retyping from memory.

**Forbidden regressions for this task:** `docs/security/endpoints.md` is left unchanged (it has drifted from `backend/security/policy.py` and no route was added); do not touch application code; do not restate real project names, issue keys, paths or emails in any doc; the repository's source guard for `docs/features/eng-workflows.md` pins its headings and several phrases, so add the pointer under a new heading and rename no existing heading.

- [ ] **Step 1: Verify every path and symbol the docs will name**

Run:
```bash
for f in frontend/src/shareView/viewDefaults.js frontend/src/shareView/codec.js frontend/src/shareView/resolver.js frontend/src/shareView/store.js frontend/src/shareView/entry.js frontend/src/shareView/applyMachine.js frontend/src/shareView/applyController.js frontend/src/shareView/captureState.js frontend/src/shareView/interactionGuard.js frontend/src/shareView/useShareViewApply.js frontend/src/shareView/focusCapture.js frontend/src/shareView/focusReveal.js frontend/src/shareView/ShareViewButton.jsx frontend/src/shareView/noticeCopy.js backend/auth/share_view_stash.py tests/fixtures/share-view-query-corpus-example-sanitized.json tests/ui/shareable_view_links.spec.js tests/ui/share_view_focus.spec.js tests/ui/share_view_control.spec.js tests/ui/share_view_control_harness.jsx assets/mockups/share-view-control-194.html; do [ -e "$f" ] && echo "ok       $f" || echo "MISSING  $f"; done
rg -n "export (function|const) (encodeShareView|decodeShareView|stripShareViewParams|resolveShareViewScope|buildShareViewFieldPlan|resolveShareViewTeams|resolveShareViewFacets|resolveShareViewFocus|captureShareViewFocus|revealShareViewFocus|stepApplyMachine|createApplyController|resolveApplyPlan|buildShareViewState|armInteractionGuard|useShareViewApply|useShareViewHold|useShareViewApplyTerminal|useShareViewPlanningTableKey|initShareViewFromLocation|getShareViewSnapshot|shareViewNoticeMessage|shareViewDroppedCategories)" frontend/src/shareView
rg -n "^def (stash_share_view_query|pop_share_view_target|clear_share_view_stash)" backend/auth/share_view_stash.py
rg -n "commitSprintSelection|persistTeamSelection" frontend/src/dashboard.jsx | head -4
```
Expected: no `MISSING` line; every exported name is found. A name or path that differs from this task's text means the docs must follow the code, not the reverse: fix the doc text and note the difference in the commit body.

- [ ] **Step 2: Create the feature guide**

Create `docs/features/shareable-view-links.md`:

```markdown
# Shareable View Links

Share the ENG view you are looking at as one link. A teammate who opens it, signing in first if needed, lands in the same view. The link carries selectors only (which view, group, Sprint, Teams, filters, search, and where to scroll); everything the teammate sees is loaded with their own Jira sign-in.

## Share a view

1. Set up the view: choose the Sprint, group and Teams, apply filters or search, and scroll to the alerts group, Epic or Story you want to point at.
2. Press **Share** in the header. After you scroll past the main header, the same control appears in the compact bar beside Search.
3. The link is copied and the icon turns into a check for two seconds. If your browser blocks the clipboard, the link appears under the control in a selectable field instead.
4. Paste it into chat.

Share is available in Catch Up, Planning, Board and Statistics. It is hidden in EPM and Scenario, and disabled while the view is still loading.

## What a link carries

| Mode | Carried |
| --- | --- |
| Catch Up | group, Sprint, Teams, search, Status, Priority and Project Track filters, Product/Tech lanes, Initiative grouping, Epic sort, which alert categories are expanded, and one focus target (an alerts team group, an Epic or a Story) |
| Planning | group, Sprint, Teams, search, filters, lanes, List or Table, Epics or Stories rows (Table), Initiative grouping and sort (List), and one Epic or Story focus target |
| Board | group, Sprint, the Board scope (Sprint, Component or All work) and search |
| Statistics | group, Sprint, the Statistics view, its range, and Teams for the views that use them |

A link never carries your saved preferences, Planning row selections or review drafts, Scenario content, EPM state, alert dismissals, Board filters, Statistics display options, assignee filters, tokens or any account detail. It does contain ids (group, Team, Sprint, issue keys) and your search text, so treat it like any internal link. A link is not a permission: it cannot show anything the opener's own Jira access does not already allow.

## When you open a link

- It applies in four stages: the Department and Sprint, then the mode and its options, then Teams and filters once the data has loaded, then a scroll to the target. Your own saved scope is never loaded first.
- Opening a link replaces your own current view with the shared one, the same as clicking those controls yourself; your next visit starts from it.
- A link equal to your current view changes nothing. A recipient whose saved view is EPM or Scenario lands in the link's ENG view.
- If the group or Sprint in the link is not available to you, nothing from the link is applied and a notice says so. If other parts do not apply (a Team you cannot see, a filter value that no longer exists, a mode the Sprint does not allow, a target that is not on screen), the rest is applied and the notice names what was skipped; it never shows a value from the link.
- A click, a tap or a key press while it applies stops the link and keeps what was applied. Scrolling alone does not, until the scroll to the target begins. Reloading the page before it finishes drops the link; open it again.
- A first-time user is held through the Department popup; the link is dropped if its group is not among the Departments they picked. The Catch Up tour starts after the link has finished.
- If you open a link while signed out, you sign in and then land in the shared view. The link is kept for up to 15 minutes.
- The link has 90 seconds in total; the Department and Sprint step and the options step have 5 seconds each, the data step and the scroll 20 seconds each.

@@NOTICE_TABLE@@

## Limits

- A link has to stay under 1,536 characters. When a view would not fit, the lowest-priority parts are left out in this order (search text, the focus target, alert categories, Initiative grouping, sort) and the notice names them; if it still does not fit, nothing is copied.
- A Planning table, Board or Statistics link has no Board focus target and no Board filters in this version.
- Search text is part of the link. In the container deployment the access log records the request path only, never the query string or the Referer.
```
Adjust any sentence that Tasks 1 to 12 made untrue; the guide describes shipped behavior.

- [ ] **Step 3: Fill the notice table from the code**

Read `frontend/src/shareView/noticeCopy.js` and replace the `@@NOTICE_TABLE@@` line in the guide with a section `## What the notices mean` holding a two-column table (`Notice` and `What happened`), one row per message string exactly as `shareViewNoticeMessage` and the Share-side messages render them (apply kinds `partial`, `dropped`, `invalid`, `newer`; the refused over-cap copy; the clipboard fallback; the category names group, Sprint, mode, Teams, filters, focus as the code words them). Do not paraphrase the strings: copy them.

- [ ] **Step 4: Link the guide from the indexes**

In `docs/features/README.md` replace
```
- [ENG Workflows](eng-workflows.md)
```
with
```
- [ENG Workflows](eng-workflows.md)
- [Shareable View Links](shareable-view-links.md)
```
In `docs/features/eng-workflows.md` replace
```
## Continue in Jira
```
with
```
## Share a view

The header **Share** control copies a link to the current Catch Up, Planning, Board or Statistics view. See [Shareable View Links](shareable-view-links.md) for what a link carries and what a recipient sees.

## Continue in Jira
```
In `README.md` replace
```
- ✅ **Alerts** - [Feature guide](docs/features/alerts.md)
```
with
```
- ✅ **Alerts** - [Feature guide](docs/features/alerts.md)
- ✅ **Shareable view links** - Share the current Catch Up, Planning, Board or Statistics view as one link; the recipient signs in and lands in the same view with their own access ([Feature guide](docs/features/shareable-view-links.md))
```
and replace
```
- [Alerts](docs/features/alerts.md)
- [Statistics](docs/features/statistics.md)
```
with
```
- [Alerts](docs/features/alerts.md)
- [Shareable View Links](docs/features/shareable-view-links.md)
- [Statistics](docs/features/statistics.md)
```
Run `rg -n "shareable-view-links" README.md docs/features` and confirm each of the four links resolves to the new file.

- [ ] **Step 5: Architecture and sign-in setup notes**

In `docs/architecture.md` replace
```
  - `backend/routes/auth_routes.py` for Atlassian OAuth, session recovery, CSRF,
    and auth status.
```
with
```
  - `backend/routes/auth_routes.py` for Atlassian OAuth, session recovery, CSRF,
    and auth status. The OAuth return carries a shared view link's query through
    the login hop via `backend/auth/share_view_stash.py`.
```
and, at the end of the Frontend entrypoint bullet list (after the `jira-dashboard.html` bullet), add
```
- Shareable view links: `frontend/src/shareView/` holds the link codec, the
  recipient resolver, the pre-mount URL entry and store, the staged apply
  machine and hook, focus capture and reveal, and the Share control. The design
  is `docs/plans/SUPPORT-shareable-view-links-design-194.md`.
```
In `docs/SUPPORT-atlassian-oauth-setup.md` replace
```
5. Confirm the callback returns to the dashboard.
```
with
```
5. Confirm the callback returns to the dashboard. If you opened a shared view link (`/?v=1&...`) while signed out, it is kept in the signed session cookie for up to 15 minutes and the callback returns to `/?<that query>` so the view opens after sign-in; the registered callback URL does not change.
```

- [ ] **Step 6: Ontology**

In `docs/ontology.md` insert a new section immediately before `## Dashboard feature ownership`, following the format of the neighbouring sections (a `Verified on:` line, then bold-named entries with aliases, entry points, contracts, tests and relationships). Use the verification date of the day this step runs and confirm every symbol with the `rg` commands from Step 1:

```markdown
## Shareable view links

Verified on: <YYYY-MM-DD> against the named symbols (code read plus the unit, Flask and Playwright suites named below).

- **Share view link** (aliases: shareable link, view link; UI: the header Share control): a readable query URL at `/` (`?v=1&mode=...`) selecting a recipient's ENG mode, group, Sprint, Teams, filters, search and one focus target. Codec: `encodeShareView`, `decodeShareView`, `stripShareViewParams` in [`codec.js`](../frontend/src/shareView/codec.js); defaults and vocabularies: [`viewDefaults.js`](../frontend/src/shareView/viewDefaults.js); contract and security rules: [design](plans/SUPPORT-shareable-view-links-design-194.md); tests: `tests/test_share_view_codec.js` and the shared corpus `tests/fixtures/share-view-query-corpus-example-sanitized.json`. Produces the URL the Share control copies; consumed by the entry module and the stash.
- **Share view resolver**: pure resolution of a decoded link against the recipient's visible groups, validated Sprint catalog, Team ids and facet options. Entry points: `resolveShareViewScope`, `buildShareViewFieldPlan`, `resolveShareViewTeams`, `resolveShareViewFacets`, `resolveShareViewFocus` in [`resolver.js`](../frontend/src/shareView/resolver.js). Depends on `viewDefaults.js`; consumed by the apply controller; test: `tests/test_share_view_resolver.js`.
- **Share view entry and store** (alias: pending link): [`entry.js`](../frontend/src/shareView/entry.js) is the first import of `dashboard.jsx`; it strips the link keys from the URL before React mounts and seeds the module store in [`store.js`](../frontend/src/shareView/store.js) (`getShareViewSnapshot`, `subscribeShareView`, `finishShareView`). The store holds the phase, the hold flag and the one-shot Planning rows seed. Test: `tests/test_share_view_store.js`.
- **Share view apply** (alias: link apply): [`stepApplyMachine`](../frontend/src/shareView/applyMachine.js) decides the stage, drops, cancels and budgets; [`createApplyController`](../frontend/src/shareView/applyController.js) and `resolveApplyPlan` run Stage A (scope), B (fields), C (Teams and facets) and D (focus) through raw setters; [`useShareViewApply`](../frontend/src/shareView/useShareViewApply.js) mounts it after the App's own restore effects; `useShareViewHold` holds the ENG task load while a link is pending; `useShareViewApplyTerminal` lets the onboarding tour wait; `useShareViewPlanningTableKey` remounts an open Planning table; [`armInteractionGuard`](../frontend/src/shareView/interactionGuard.js) cancels on a deliberate interaction. The two App closures `commitSprintSelection` and `persistTeamSelection` in `dashboard.jsx` are shared with the click handlers. Depends on the resolver, the store, the codec and the focus modules; tests: `tests/test_share_view_apply_machine.js`, `tests/test_share_view_apply_controller.js`, `tests/test_share_view_apply_hook.js`, `tests/test_share_view_interaction_guard.js`, `tests/test_share_view_onboarding_wait.js`, `tests/test_share_view_source_guards.js`, `tests/ui/shareable_view_links.spec.js`.
- **Share view capture**: [`buildShareViewState`](../frontend/src/shareView/captureState.js) builds the committed view state the encoder turns into a link; `captureShareUrl()` on the apply hook returns `{ ok, url, dropped }` synchronously. Test: `tests/test_share_view_capture_state.js`.
- **Share focus**: [`captureShareViewFocus`](../frontend/src/shareView/focusCapture.js) reads the topmost visible alerts team group, Epic, Story or Planning row at Share time; [`revealShareViewFocus`](../frontend/src/shareView/focusReveal.js) scrolls to and highlights it at apply time; both share `SHARE_VIEW_FOCUS_MARGIN`. Alert groups carry `data-alert-team` in [`EngAlertsPanel.jsx`](../frontend/src/eng/EngAlertsPanel.jsx); the Planning table seeds its row mode from the store in [`PlanningReviewTable.jsx`](../frontend/src/eng/PlanningReviewTable.jsx). Tests: `tests/test_share_view_alert_anchors.js`, `tests/test_share_view_focus_capture.js`, `tests/test_share_view_focus_reveal.js`, `tests/test_share_view_planning_rows_seed.js`, `tests/ui/share_view_focus.spec.js`.
- **Share control**: [`ShareViewButton.jsx`](../frontend/src/shareView/ShareViewButton.jsx), rendered on the main and compact header surfaces of `dashboard.jsx` through `renderShareViewControl`; notice copy: [`noticeCopy.js`](../frontend/src/shareView/noticeCopy.js) (`shareViewNoticeMessage`, `shareViewDroppedCategories`); the notice reuses the connection-recovery banner with `.share-view-notice`; the reviewed mock `assets/mockups/share-view-control-194.html`; analytics event `share_view_action` (`docs/README_ANALYTICS.md`). Tests: `tests/test_share_view_control.js`, `tests/ui/share_view_control.spec.js` with `tests/ui/share_view_control_harness.jsx`.
- **Pending-link stash** (alias: login return): [`share_view_stash.py`](../backend/auth/share_view_stash.py) stores a validated query in the signed session cookie from the unauthenticated dashboard entry (`redirect_unauthenticated_oauth_dashboard_entry` in `jira_server.py`) and returns it at the OAuth callback and the two authenticated `/login` redirects in [`auth_routes.py`](../backend/routes/auth_routes.py). Limits: 1,536 bytes, 900 seconds, 3,300 bytes of cookie. Tests: `tests/test_share_view_stash.py`, `tests/test_auth_entry_page.py`, `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py`.
```
Then in the same file replace the tail of the `Coverage:` paragraph
```
and the remaining `App()` responsibility inventory and Statistics state coupling (2026-10-08). Other application areas remain unmapped.
```
with
```
the remaining `App()` responsibility inventory and Statistics state coupling (2026-10-08), and shareable view links (<YYYY-MM-DD>). Other application areas remain unmapped.
```
Finally update the `## Dashboard extraction verification` current-measurement paragraph (the one that begins `Current #251 measurement`) by replacing the `7,573` figure and the aggregate figures it names with the values now pinned in `tests/test_codebase_structure_budgets.py` and `scripts/extraction_lint/owner_budgets.json` (read them; do not guess), and add the sentence `Shareable view links (issue #194) moved the pins by the net measured lines recorded in the Budget ledger of EXEC-shareable-view-links-194.`

- [ ] **Step 7: Park the deferred scope**

In `docs/TODO.md`, under `## Deferred`, add these bullets after the last existing bullet of that section:
```
- Shareable view links v2 candidates (parked from issue #194): a Board Epic panel link (needs a Share action inside the modal panel and a request consumed after the Board columns contain the key), Board facets and Statistics display options in links, stored or short links with revocation and expiry (`docs/plans/FUTURE-db-additional-features.md`).
- Share control and pending-link keyboard polish — won't do for now (keyboard users are not a priority; touch is). The Share notice does not close on Escape, focus does not return to the Share control after Dismiss, the fallback link field takes focus when it opens, and a pending link cannot be cancelled with Escape (the interaction guard ignores modifier keys only). Related: `frontend/src/shareView/ShareViewButton.jsx`, `frontend/src/shareView/interactionGuard.js`, `docs/plans/EXEC-shareable-view-links-194.md`.
```

- [ ] **Step 8: Update the plans index**

In `docs/plans/README.md`, in the `## Shareable view links (issue #194)` section, set the implementation-plan bullet's status to the plan's current one (`implemented, awaiting merge` once Task 14 closes out) and keep its six slice links and gate list. Do not rename the file to `DONE-` until the work is merged.

- [ ] **Step 9: Reconcile the line budgets**

Run:
```bash
wc -l frontend/src/dashboard.jsx jira_server.py
env $TEST_ENV $JEP_TEST_PYTHON -m unittest tests.test_codebase_structure_budgets tests.test_backend_route_source_guards tests.test_endpoint_policy_inventory
fnm exec --using 20 bash scripts/extraction_lint/run.sh
```
Expected: the two line counts equal the Budget ledger's last row (7,627 and 6,491) and the pins in `tests/test_codebase_structure_budgets.py` and (for `dashboard.jsx`) `scripts/extraction_lint/owner_budgets.json`; the three test modules and the lint pass with no more than 104 warnings. If a count moved after the last pin edit, move the pin in this commit with a one-line reason and record the net change per task in the ledger.

- [ ] **Step 10: Check the docs for local data and run the doc-linked tests**

Run:
```bash
rg -n "/Users/|@criteo|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}" docs/features/shareable-view-links.md docs/ontology.md docs/TODO.md docs/architecture.md docs/SUPPORT-atlassian-oauth-setup.md docs/plans/README.md || echo "no local data"
npm run test:frontend:unit
```
Expected: `no local data`; the Node suite passes (`test_analytics_source_guards.js` cross-checks README_ANALYTICS, the runbook and the YAML; nothing in this task should break it).

- [ ] **Step 11: Commit**

```bash
git add docs/features/shareable-view-links.md docs/features/README.md docs/features/eng-workflows.md README.md docs/architecture.md docs/SUPPORT-atlassian-oauth-setup.md docs/ontology.md docs/TODO.md docs/plans/README.md
git add -u -- tests/test_codebase_structure_budgets.py scripts/extraction_lint/owner_budgets.json
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Document shareable view links and reconcile budgets" -m "Feature guide, indexes, architecture and sign-in notes, ontology entries with verification date, parked v2 scope, and the final line-budget measurements, so the repo describes what shipped."
git show --stat HEAD
git status --short
```
Expected: only the listed docs (and the two budget files if a pin moved) changed; a clean tree.

---

### Task 14: Journeys, full verification and publication

**Owner note:** Last task; depends on Tasks 1 to 13. Publication is blocked by gate G3.

**Files:**
- Modify: `docs/plans/EXEC-shareable-view-links-194.md` (statuses, Outcome, Current Accuracy)
- Modify: `docs/plans/README.md` (the plan index entry)

**Interfaces:**
- Consumes: every earlier task's tests and the Verification table of the design (V1 to V20).

**Forbidden regressions for this task:** everything in the design's "Forbidden regressions".

- [ ] **Step 1: Confirm every task is done**

Open the Execution status table. Tasks 1 to 13 (including 11a, 11b, 11c) are `done` with a commit SHA each; Task 2 is `done` or `declined` with its decline edits applied in Task 3. Run `git log --oneline origin/main..HEAD` and match the commits to the table.

- [ ] **Step 2: Full backend gates**

```bash
env $TEST_ENV $JEP_TEST_PYTHON -m unittest discover -s tests
make test-security
env $TEST_ENV $JEP_TEST_PYTHON -m unittest tests.test_codebase_structure_budgets tests.test_backend_route_source_guards tests.test_endpoint_policy_inventory
```
Expected: the full suite passes with no more skips and no new failures than the Task 0 baseline (the recorded environment-specific failures aside) and no new warning before the Flask startup banner; the security matrix passes; `test_endpoint_policy_inventory` still pins "no new route".

- [ ] **Step 3: Full frontend gates**

```bash
npm run test:frontend:unit
fnm exec --using 20 bash scripts/extraction_lint/run.sh
npm ci && npm run build && make verify-dist-clean
```
Expected: the Node count is the baseline plus this plan's new tests, all passing; ESLint warnings do not exceed the 106 ratchet (104 expected after Task 12); `verify-dist-clean` reports a clean diff after the build.

- [ ] **Step 4: Full Chromium UI run**

```bash
JEP_TEST_PYTHON="$JEP_TEST_PYTHON" npx playwright test tests/ui --browser=chromium --workers=4
```
Expected: the run takes about 8 minutes; read the final summary line. No test is skipped or loosened to pass. `tests/ui` has no CI job by decision; this local run is the gate.

- [ ] **Step 5: Headed Firefox and WebKit for the control**

```bash
JEP_TEST_PYTHON="$JEP_TEST_PYTHON" npx playwright test tests/ui/share_view_control.spec.js tests/ui/codebase_structure_smoke.spec.js --browser=firefox --headed
JEP_TEST_PYTHON="$JEP_TEST_PYTHON" npx playwright test tests/ui/share_view_control.spec.js tests/ui/codebase_structure_smoke.spec.js --browser=webkit --headed
```
Expected: the painted-ink and geometry checks pass in both engines (headless runs and Chromium place glyph ink differently). Compare any failure with the Task 0 Firefox and WebKit baselines: the two known `Task9 freshness reserved copy` WebKit cases are baseline, not regressions. Look at the failure screenshots before changing any assertion.

- [ ] **Step 6: Startup verification**

```bash
sh -n scripts/docker-entrypoint.sh
env $TEST_ENV $JEP_TEST_PYTHON scripts/check_startup_preflight.py
```
Expected: no output from `sh -n`; the preflight passes. If a local `.env`, database and Postgres are available (see the operator's worktree notes), launch `.venv/bin/python jira_server.py` and check `curl http://localhost:5050/api/test`; any Python dependency or runtime warning before the Flask banner is a failed verification. If no local credentials exist, record "not run: no local credentials" instead of claiming it.

- [ ] **Step 7: Walk the five journeys**

| Journey | Automated coverage | Operator live check |
| --- | --- | --- |
| A. Signed-in recipient opens a link | `tests/ui/shareable_view_links.spec.js` (V1, V3, V5, V6) | Open the Share link in a second tab of the operator's own signed-in dashboard |
| B. Unauthenticated recipient (login return) | Task 1 chain tests (`tests/test_auth_entry_page.py`, `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py`) plus the UI spec applying the returned `/?v=` URL | Open a link in a private window, sign in yourself, confirm you land in the shared view |
| C. Expired-session recipient | `TestAuthEntryPage` (`/login?reason=session_expired` keeps the stash) | Optional |
| D. First-run recipient | Review Focus line 1 UI test (Task 11c) | Optional (needs a user with no saved groups) |
| E. Basic mode (local) | Task 1 inertness tests; the UI spec runs in the Basic fixture | Not applicable |

Live checks are read-only and transient: the operator signs in themselves; report numbers only (the mode, counts of visible Epics and Stories, whether the notice appeared); never save or publish screenshots of live data and delete any taken.

- [ ] **Step 8: One whole-branch review**

Dispatch one fresh reviewer with this prompt, then fix what it confirms: "Review the branch diff `git diff origin/main...HEAD` against `docs/plans/SUPPORT-shareable-view-links-design-194.md` and `docs/plans/EXEC-shareable-view-links-194.md` (and its slices) for correctness, execution safety and verification quality. Findings first, ordered Blocker, P1, P2, Minor, each with file:line, the failure scenario and the concrete change. Check: every changed line traces to the plan; no new route; the stash redirect target is always `/` or `/?<validated query>`; apply never calls the forbidden helpers or interpolates link values into selectors; the budgets and the manifest agree; no local path, email or secret is committed."

- [ ] **Step 9: Close out this plan**

Set every row in the Execution status table to its final status with SHAs, add an `## Outcome` (`Implemented as planned` or `Implemented with changes` plus the differences) and a `## Current Accuracy` section per `docs/AGENTS.md`, and update the entry in `docs/plans/README.md`. Do not rename `EXEC-` to `DONE-` until the work is merged.

```bash
git add docs/plans/EXEC-shareable-view-links-194.md docs/plans/README.md
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Record shareable view links execution outcome" -m "Execution status, outcome and accuracy recorded in the plan so the repo carries the result with the work."
git show --stat HEAD
git status --short
```

- [ ] **Step 10: Publication transaction (blocked until gate G3)**

Do not run any of this without an explicit operator go. Treat commit, push and PR creation as one blocking transaction (`AGENTS.md` section 10):
```bash
git fetch origin
git rev-parse HEAD origin/main
git status --short
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
```
Record the exact base and head SHAs. Compare the complete commit list, the commit count and every changed path with this plan's file map; a clean tree is not enough. If the history or scope differs, stop and ask the operator whether to reconstruct it; do not stack cleanup commits or rewrite history. Then re-run Steps 2 to 4 at the exact proposed head, including the committed-revision build. After the go:
```bash
git push -u origin feature/194-shareable-dashboard-view
gh pr create --base main --title "Shareable view links for ENG Catch Up, Planning, Board and Statistics" --body-file - <<'EOF'
<PR body: summary, design and plan links, the verification results with counts, the operator gates and their outcomes, the UI states shown (synthetic data only). No secrets, no local paths, no real issue keys, no attribution footer.>
EOF
gh pr view --json headRefOid,commits,files,body
gh pr checks
```
Expected: the remote head equals the approved local head; the commit count and changed-file list match the comparison above; the body reads back as rendered text (not serialized JSON); CI state is reported as it is. Open the PR page only if the operator asks (the operator's rule is to use `gh` unless a browser is requested); the operator attaches UI screenshots on the PR page. Then call the app's PR tools: get the PR status, bind the PR if it is not reported, read its CI and offer Auto-fix; never poll CI yourself and never enable auto-merge unless asked. If any post-publication check fails, report the publication as malformed and stop for operator direction.
