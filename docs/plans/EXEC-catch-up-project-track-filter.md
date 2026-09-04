# Catch Up Epic Project Track Filter Implementation Plan

> **Status:** Implemented and verified locally on 2026-09-04; pending user acceptance or merge.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Epic-owned Project Track facet to Catch Up and soften Status option backgrounds while preserving the existing Board contract and all no-request/no-analytics boundaries.

**Architecture:** A new pure Project Track classifier defines recognized, unset, unknown, and missing-Epic states once for Board and Catch Up. Catch Up maps Stories to existing parent-Epic metadata, counts unique Epics in the Project Track facet, and uses the generic facet engine's explicit-empty state while its task-list readout continues to count Stories.

**Tech Stack:** React 19, ES modules, Node 20 test runner, Playwright, esbuild, CSS.

---

## Contract

`docs/DOMAIN_ONTOLOGY.md` and `docs/agents/features/2026-09-04-executed-catch-up-project-track-filter.md` are authoritative.

- Project Track belongs to Epic.
- Catch Up filters Stories through `Story -> parent Epic -> Project Track`.
- Project Track facet counts are unique Epics; the task-list readout remains Stories.
- Both unchecked means an existing parent Epic whose field is `null`, missing, or trim-empty.
- Unknown populated values and Stories without an Epic do not match explicit empty.
- Neutral admits all Stories.
- Status backgrounds become softer without dimming their text.
- No backend file, route, request, persistence key, Jira mutation, or analytics event changes.
- No mobile-specific adaptation; existing `+1 more` behavior remains approved.
- `frontend/src/dashboard.jsx` must remain at or below its current structure budget.

## File map

- Create `frontend/src/eng/engProjectTrack.js`: shared pure Epic Project Track classification.
- Create `tests/test_eng_project_track.js`: classifier tests.
- Modify `frontend/src/eng/engBoardFilters.js`: consume shared classification without behavior change.
- Modify `frontend/src/eng/engCatchUpFilters.js`: build/resolve/store the Epic-owned relational facet.
- Modify `frontend/src/dashboard.jsx`: provide Epic metadata, preserve per-scope Track state, and apply Story admission.
- Modify `frontend/src/styles/eng/filter-bar.css`: soften Status backgrounds while keeping opaque text.
- Modify the corresponding frontend unit/source-guard and Playwright ENG filter tests.
- Modify `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, this plan, and the approved feature artifact.
- Generate `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css` only with `npm run build`.

### Task 1: Shared Epic Project Track classification

- [x] Add RED unit cases in `tests/test_eng_project_track.js` for canonical case-insensitive values, genuinely unset values, populated unknown values, and a missing Epic.
- [x] Run `node --test tests/test_eng_project_track.js`; expect module-not-found RED.
- [x] Create `frontend/src/eng/engProjectTrack.js` exporting fixed ids and `classifyEpicProjectTrack(epic)` with `recognized`, `unset`, `unknown`, and `missing_epic` results.
- [x] Run the classifier test; expect pass.
- [x] Replace Board's local normalization/unset predicates with the shared classifier.
- [x] Run `node --test tests/test_eng_project_track.js tests/test_eng_board_filters.js`; expect pass with unchanged Board behavior.

### Task 2: Catch Up facet model and storage state

- [x] Add RED cases in `tests/test_eng_catch_up_filters.js` using multiple Stories beneath one Epic plus an `epicDetails` map.
- [x] Assert facet order `status`, `priority`, `projects`, `track`; fixed zero-visible Track options; unique-Epic counts; and a neutral Epic heading total excluding the missing-Epic synthetic group.
- [x] Assert neutral, one-option, and explicit-empty Story admission. Empty excludes unknown populated Epics and Stories without an Epic.
- [x] Assert storage preserves `track: []`, restores neutral by omitting the key, and retains recognized selections in facet order.
- [x] Run the Catch Up unit tests; expect RED because Catch Up has no Track facet/state.
- [x] Extend the Catch Up model, resolver, admission predicate, and storage adapter with the smallest implementation satisfying those cases.
- [x] Run `node --test tests/test_eng_filter_facets.js tests/test_eng_project_track.js tests/test_eng_board_filters.js tests/test_eng_catch_up_filters.js`; expect pass.

### Task 3: Dashboard state and task-list admission

- [x] Add RED source guards proving `dashboard.jsx` passes `epicDetails`, owns Track selection, applies `admitsProjectTrack(task)`, and adds no API or analytics literal.
- [x] Run affected source guards; expect RED.
- [x] Add adjacent React state/snapshot plumbing that preserves explicit `[]` through rerenders, task-list mode changes, Teams changes, and same-scope Department restoration, while new Department/sprint snapshots start neutral.
- [x] Pass `epicDetails` into the model and include Project Track in visible Story admission.
- [x] Keep `dashboard.jsx` line-neutral by consolidating only touched adjacent wiring.
- [x] Run source guards and `tests/test_codebase_structure_budgets.py`; expect pass without a budget increase.

### Task 4: Softer Status rendering

- [x] Add a RED source/Playwright assertion that Status backgrounds use a surface-mixed tint while text stays opaque and reaches 4.5:1 contrast.
- [x] Run the focused assertion; expect RED against the solid background.
- [x] Update the filter Status rendering/CSS to mix configured and vocabulary colors into the panel surface. Never apply opacity to the whole pill.
- [x] Rerun the focused Status tests; expect pass.

### Task 5: Catch Up browser behavior and screenshots

- [x] Add RED Playwright coverage for fixed Track options, unique-Epic counts, Story readout, all four Track states, unknown/missing-parent exclusions, restoration/reset lifecycle, and no new network or analytics behavior.
- [x] Add desktop screenshot proof. Preserve the approved mobile `+1 more` compaction without adaptation.
- [x] Run the new tests; expect RED before dashboard/model wiring.
- [x] Make only production changes required by the failing behavior.
- [x] Rerun the focused Playwright files with isolated headless Chromium against the running service; expect pass.
- [x] Inspect screenshots for readable softened Status labels and the four-state Track facet.

### Task 6: Documentation and complete gates

- [x] Update `docs/features/eng-workflows.md` and the existing no-event row in `docs/README_ANALYTICS.md`.
- [x] Activate Node 20 and run `npm run build` twice; verify the second build is stable and `git diff --check` passes.
- [x] Run the complete frontend unit suite and record its exact result.
- [x] Run focused ENG Playwright files, then `npm run test:frontend:ui`; serially rerun failures only to distinguish product failures from infrastructure contention.
- [x] Run `python3 -m unittest discover -s tests` and record its exact result.
- [x] Run startup preflight and the approved local service health check without accessing the user's personal browser.
- [x] Inspect the full diff, confirm `.env.example` remains untouched by this work, and confirm every changed line traces to the approved feature.
- [x] Only after all gates pass, rename the feature artifact to `2026-09-04-executed-catch-up-project-track-filter.md`, record the outcome, and update this plan's status/checks.
- [x] Stop and report if any gate fails for an unrelated reason. Do not weaken tests, expand scope, push, open a PR, merge, or close the issue.

## Outcome

Executed on `feature/issue-150-filter-option-visuals` from the required immutable base
`f359ade2cf01233d3694b3e0bc1da8f994254bf0`.

RED evidence covered the missing classifier, Catch Up model/state, dashboard source wiring, and
solid Status background. The final Catch Up Playwright regression also failed under a controlled
runtime mutation that removed `admitsProjectTrack(task)`, admitting five incorrect Stories, then
passed after restoring the production predicate.

GREEN evidence: 153 focused frontend assertions; 1,163 complete frontend unit tests; 45 focused ENG
Playwright tests; 665 complete Playwright tests with 2 skipped; and 1,538 Python tests with 9
skipped. Two consecutive Node 20 builds were byte-stable, startup preflight passed with migrations
at head, `git diff --check` passed, and `frontend/src/dashboard.jsx` remained at its 17,493-line
budget. Screenshots were inspected for the softened Status labels and complete Catch Up Project
Track facet. The first sandboxed Python/preflight attempts could not reach local PostgreSQL; their
authorized reruns passed.

The CLI `/api/test` request returned the expected OAuth-mode `401` without a browser session, while
the service root returned `302` and the complete Playwright suite loaded the same running service.
No personal browser was accessed. No push, PR, merge, Jira mutation, analytics event, or issue
closure was performed.
