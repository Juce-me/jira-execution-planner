# Board Column Status Colours Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) to implement this plan task by task. Follow repository publication rules; this plan does not authorize commit, push, or PR creation.

**Status:** Proposed, 2026-10-06; decisions confirmed 2026-10-07 (text colour and filter-bar treatment settled the same day); revised after a three-reviewer validation (backend/storage, pill surfaces, settings/process). Plan only; no production code written. No GitHub issue exists yet, so the branch is `feature/board-column-status-colours`; rename it to `feature/<issue>-board-column-status-colours` if an issue is opened.

**Goal:** Add a per-Department checkbox in **Settings → Departments → Boards**. When it is on, every ENG status pill whose status is held by one of that Department's Board columns is filled with that column's colour with the same white text the current pills use. Statuses no column holds keep today's colours. Off by default.

**Architecture:** One boolean, `board.inheritColumnColours`, stored inside the existing shared Department `board` object (same owner, route, validator and save path as the columns). One pure resolver turns `(columns, statusName)` into a colour or `null`; the existing Board filter-option resolver is refactored onto it so there is one status-to-column rule. A small `StatusColourProvider` (context) is mounted once at the dashboard root and is switched on only for the ENG view with the flag on. The shared `StatusPill` gains an opt-in `status` prop that reads the context and applies an inline `background` and `color`; every in-scope pill passes `status`. `StatusTransitionMenu` and `IssueCard` apply it themselves, so most call sites need no edit. No new endpoint, request, schema or migration.

**Tech stack:** Python `unittest` (normalizer, routes), Node `node:test` (model, resolver, source guards), existing Playwright mocked dashboard fixtures.

## Decisions (confirmed by the operator 2026-10-07 unless marked)

1. **Scope is every status pill, whatever the issue type.** Epics, Stories, Subtasks, Initiatives and any other issue type that shows a status pill, when the status is held by a column. Surfaces are listed in the inclusion table below.
2. **Match by status name only, never by issue type.** The column map is keyed by Jira status name, so any issue in `In Progress` takes the colour of the column holding `In Progress`. A status the Department did not put in a column (for example a Subtask-only `Analysis`) keeps its current colour until mapped.
3. **Unmapped means untouched.** This differs from Board *placement*, where an unlisted status lands in the first column (`resolveBoardColumnOwner`, `frontend/src/eng/engBoardColumns.js:151`; backend rule in `project_board`, `backend/services/eng_board.py`). The resolver never calls the placement rule.
4. **White text on a solid column-colour fill, exactly like today's pills (operator choice 2026-10-07, after seeing the numbers).** The operator compared three looks in [the approved visual](../../assets/mockups/board-column-status-colours.html) and chose the first column, "Today's pills: white text on solid fill". This **supersedes the earlier "clearly readable contrast" requirement**: white on the seven enum colours measures grey 3.36, violet 2.94, blue 3.65, teal 2.21, green 2.27, amber 2.20, red 3.27:1, all below WCAG AA's 4.5:1 (the same as today's built-in pills). The rejected alternatives were solid fill with `#141414` text (5.05 to 8.38:1) and the filter-bar soft tint with dark text (about 12 to 14:1). An inherited pill gets an inline `background` of the column colour and an inline `color: #ffffff`; the white is explicit because a status with no built-in palette class (for example `In Review`) has no text colour rule and would otherwise inherit dark text on a coloured fill. Hover, geometry, padding and radius stay exactly the existing `.task-status` / `button.status-pill` rules. If readability is revisited, the lever is a single constant (`STATUS_COLOUR_TEXT`) plus the Task 3 ratio table, not the architecture.
5. **Stored as `board.inheritColumnColours`, written only when exactly `true`.** Absent means false. Anything that is not exactly `true` is treated as absent, on the backend and in the frontend helpers alike: a non-boolean value adds a normalizer **warning** (never an error) and the key is omitted, as an unknown colour does. This is the softest failure and deliberately the least work: a hand-edited bad value cannot discard groups or break a Department's strict Board, and Basic mode (being dropped soon) needs no special handling. Operator decision 2026-10-07 ("make as little as possible" for Basic mode).
6. **Out of scope:** dedicated Basic-mode work (it shares the same normalizer, gets no extra tests, and is only exercised by CI's existing `JIRA_AUTH_MODE=basic` run), EPM, Statistics, per-column opt-out, any colour outside the existing enum, keyboard-only polish (parked in `docs/TODO.md`), the hard-coded Done/Killed card tint and left border on issue cards (`.task-item.status-done` in `frontend/src/styles/eng/issues.css`; a violet "Done" pill will sit on a green-tinted card until a separate decision), and the non-pill status visuals listed under "Excluded surfaces".
7. **The filter-bar Status popover is left as it is.** It already shows the Board column colour as a soft 28% tint with dark text, independent of any setting (`frontend/src/eng/engFilterOptionVisuals.js`, `filter-bar.css`; pinned by `tests/test_task_filter_menu_compaction_source_guards.js` and `docs/plans/EXEC-eng-filter-option-visuals.md`). The operator said "tint in the filters is ok" (2026-10-07), so that surface keeps its tint in both checkbox states. Every other pill is a solid fill, and the filter popover is the one intentional exception. Its resolver is still shared (see file map) so there is one status-to-column rule.
8. **No extra permission gate.** The checkbox has exactly the columns' rights: Department board layouts are `authenticated_read` / `user_write` (`backend/security/CONFIGURATION_OWNERSHIP.md:12`), editable by every authenticated user; `userCanEditSettings` gates only the administrator sections.

## Surface inventory

Included (a `status` prop on the pill or its owning component; line numbers as of `main` da17de89 and must be re-verified on the execution branch):

| Surface | Where | Change |
| --- | --- | --- |
| Interactive status trigger (Catch Up, Planning list/table, Board panel, OAuth editing profile) | `issues/StatusTransitionMenu.jsx:191` | Menu passes `status={statusLabel}` to its own `StatusPill`; no `style` prop is added, so callers (`dashboard.jsx:8200, 8466`, `IssueCard.jsx:277, 384`, `EngBoardEpicPanel.jsx:216, 344`) need no edit |
| Menu option marker dot | `issues/StatusTransitionMenu.jsx:226` | Menu calls the hook for `entry.name` and sets `background` only (the dot has `font-size: 0`, `color: transparent`) |
| Passive pills on cards | `issues/IssueCard.jsx:296, 402` | Add `status=` |
| Epic header / Story row passive pills | `dashboard.jsx:8273, 8494, 8534` | Add `status=` on the pill element (the pill component reads the context, so no hook is called in `App`) |
| Board card | `eng/EngBoardEpicCard.jsx:97` | Add `status=` |
| Board open-Epic panel | `eng/EngBoardEpicPanel.jsx:207-209, 361` | Add `status=` |
| Board drop-menu status markers | `eng/EngBoardView.jsx:1111-1112` | Background only; the non-status confirmation rows keep their existing class |
| Planning Table passive status | `eng/PlanningReviewTable.jsx:310` | Add `status=` |
| Settings composer chips | `settings/GroupBoardSettings.jsx:673` (`renderStatusChipBody`, used at roughly :875, :927, :1092) | Composer wraps itself in its own nested provider built from the **draft** columns and the local flag; unmapped pool chips stay uncoloured, picker rows show their current column's colour |

Excluded, each with its reason (the source guard must name them):

| Surface | Reason |
| --- | --- |
| Filter-bar Status popover (`EngFilterBar.jsx:238-243`) | Keeps its existing soft tint in both states; Decision 7 |
| `PlanningReviewTable.jsx:160` "N Stories awaited" | A count badge, not a status |
| `JiraFieldSettings.jsx:490` | Settings mapping preview, no Board column semantics |
| `EpmRollupPanel.jsx:129-130, 358, 542, 585`, `EpmRollupTree.jsx:53`, `EpmSettings.jsx:501` | EPM; no Department Board applies |
| `EngAlertsPanel.jsx` `.alert-pill.status` | Fixed alert-red tag |
| `IssueDependencies.jsx:192`, `OpenEpicsChart.jsx:100,106` | Not status pills (`dependency-missing-status`, `cohort-open-status`) |
| Subtask/Epic progress segments (`story-subtasks-progress-*`, Board card distribution bars) | Distribution bars, not status pills; confirm with the operator if they should follow |

EPM is reached by the shared `IssueCard` (`EpmRollupPanel.jsx:522`), which is why the provider is enabled only for the ENG view and why Task 4 includes an EPM-unchanged assertion.

## Evidence and boundaries (verified against `main` da17de89, 2026-10-06; reviewer claims spot-checked 2026-10-07)

- `backend/services/group_board.py` `normalize_group_board` runs on every group-config read and builds a new dict, so a key it does not copy is dropped. It already carries one scalar, `doneEpicRetentionDays`, with a presence check (`retention_present`). It is reached from `validate_groups_config`, `_normalize_shared_payload`, `save_shared_groups`, the Basic-mode POST in `backend/routes/settings_routes.py`, and `load_effective_groups`. No allowed-keys list exists for the group `board`; `WorkspaceGroupConfig.payload` is a plain JSON column, so there is no migration and `payload_version` stays 2.
- `frontend/src/settings/groupBoardModel.js` mirrors it: `toStoredBoard` (emits `id, name, statuses, colour, star, min, max` per column, then the retention), `normalizeStoredBoard`, `retentionDaysFromStoredBoard`, `fromStoredBoard` (returns only the composer column array, so the flag needs its own reader helper, as retention has). `groupConfigUtils.js:188` runs `normalizeStoredBoard` on every config normalization.
- `GroupBoardSettings.jsx` keeps retention in `retentionDaysRef` with no UI, re-seeds from `board` only when it arrives from outside (`lastEmittedRef`), and resets on group switch by remount (`key={activeGroupDraft.id}` in `GroupBoardsTab.jsx`). Its own comment (about :142-145) warns about stale closures; `commit()` reads refs.
- Dirty state is a raw `JSON.stringify` comparison (`useTeamGroupSettings.js` `groupDraftSignature`; `groupsConfigConflict.js` `boardDraftIsDirty`). The server returns columns key-sorted (Flask `jsonify`), while `toStoredBoard` emits a different key order, so **any** board edit already leaves the draft dirty after reverting. This change does not alter that; Decision 5's no-spurious-dirty guarantee therefore covers only an untouched board.
- A Department with no board starts the composer with zero columns, and any `commit()` then emits a present empty board, which `validatePresentGroupBoards` and the backend reject ("board must have at least 1 column").
- Strict Board: `normalize_board` and `normalize_measurement_board` ignore unknown keys, so the normalized Board and cohort digest exclude the flag, which is correct and must stay that way. A flag save does bump the shared groups revision, which flows into `scope_version`; in-flight Board loads may get `scope_changed`, and measurement cohorts for that Department split. That is pre-existing behaviour for any shared-group save.
- Pill funnel: `getIssueStatusClassName` → shared `StatusPill`, which spreads `...props`. No `!important` rule in `frontend/src/styles` can beat an inline `background` or `color`; `button.status-pill:hover` only sets `transform`, `filter` and `box-shadow`.
- `App()` renders the provider, so a hook cannot be called inside `renderEpicBlock` or `renderPlanningReviewFieldEditor`; those render functions run above (or in `EngView`, beside) the provider. Putting the hook inside `StatusPill` avoids the problem because the element is mounted below the provider. The app root is one `<div className="container">` (`dashboard.jsx` around :8858) with no ENG-only wrapper; EngView, EngBoardView, EpmView and the Settings modal are siblings inside it.
- Ancestor opacity (`.task-item.status-killed` 0.6, `.status-incomplete` 0.8, `.is-dimmed`) and `button:disabled { opacity: .5 }` change how a pill looks on dimmed cards. Inherited pills receive the same dimming as built-in ones; the tests assert computed `background-color` and `color`, never composited appearance.
- `.group-visible-control` (`frontend/src/styles/settings/group-editor.css:10`, used at `TeamGroupsSettings.jsx:331`) is the existing settings checkbox label class; global `label`/`input` rules otherwise make a bare checkbox uppercase and full width. `.board-columns-toolbar` is `justify-content: space-between; flex-wrap: nowrap`, holding Reset and the optional scroll controls.
- **Three coupled size gates.** `tests/test_codebase_structure_budgets.py` holds (a) `LEGACY_ENTRYPOINT_LINE_BUDGETS["frontend/src/dashboard.jsx"]` (10855; the file is 10851), and (b) `test_extraction_owner_checkpoint`, which reads `scripts/extraction_lint/owner_budgets.json` and requires, for every registered owner and for `dashboard`, `lineCount == actual` and `lineCeiling >= actual`, plus exact aggregates `settings`, `uniqueOwners`, `appPlusOwners`. The manifest registers `GroupBoardSettings.jsx` (1164/1164) and `groupBoardModel.js` (433/433), and freezes `GroupBoardSettings`'s reviewed input inventory (`board.doneEpicRetentionDays`, `expandedInputCeiling` 17, `sourceDigest`). In this repo "ratchet" means lower; here the ceilings must be **raised to the measured counts** with a `(+N)` comment in the existing style. Any edit to those files fails the full suite until the manifest is updated. The 2026-10-07 approval covers `dashboard.jsx`; the operator approved raising the Settings owner ceilings too (2026-10-07).
- New source files go under `frontend/src/issues/` and `frontend/src/ui/` (not owner roots `settings`, `scenario`, `epm`), so they need no manifest registration.
- Parallel work: issue #241 touches the Board status pill/transition path; re-read `EngBoardEpicCard.jsx`, `EngBoardEpicPanel.jsx`, `EngBoardView.jsx` and `StatusTransitionMenu.jsx` on the execution branch.
- Read before executing: `docs/postmortem/` MRT016 (file-map drift), MRT017 (hover bounds), MRT020 and MRT021 (reuse shared controls without overriding layout), MRT025 (publication), MRT028 (Epic header presentation), MRT029; `backend/security/CONFIGURATION_OWNERSHIP.md`; the Boards sections of `docs/plans/EXEC-eng-group-board.md`; `docs/plans/EXEC-eng-filter-option-visuals.md`.

## File map

Create:

| File | Responsibility |
| --- | --- |
| `frontend/src/issues/statusColumnColours.js` | Pure `resolveStatusColumnColour(columns, status)` (first exact owner; non-enum colour → `null`; no trimming, as the filter-option resolver does today), `STATUS_COLOUR_TEXT = '#ffffff'`, `buildStatusStyle(colour)` returning a stable `{ background, color }`, and a WCAG ratio helper used only by tests |
| `frontend/src/issues/StatusColourContext.jsx` | Context, `StatusColourProvider({ columns, enabled, children })` whose value is memoised on a signature of the flag plus status→colour pairs (so config re-normalization does not churn it) and is a stable no-op when off, and `useStatusColourStyle()` returning `(status) => style \| undefined`; default outside a provider is a no-op |
| `assets/mockups/board-column-status-colours.html` | Standalone visual of the three candidate looks on synthetic data (already created; the first column, white text on solid fill, is the approved one) |
| `tests/test_status_column_colours.js` | Resolver, text-colour and hook-default tests |
| `tests/test_status_column_colours_source_guards.js` | Surface table guard (Task 4) |
| `tests/ui/status_column_colours.spec.js` | Rendered colours per surface and profile, settings flow |
| A shared Playwright fixture module under `tests/ui/` (name chosen at execution) | Exports the synthetic Department-with-seven-colour-board fixture, extracted from the spec-local copies in `eng_status_transitions.spec.js` / `eng_group_board_*.spec.js`; the existing specs keep working unchanged |

Modify:

| File | Responsibility |
| --- | --- |
| `backend/services/group_board.py` | Validate and carry `inheritColumnColours` |
| `tests/test_group_board.py` | Normalizer, DB round-trip and route cases (Task 1) |
| `tests/test_shared_group_config_routes.py`, `tests/test_shared_group_config_service.py` | 409 carries the flag; non-admin DB user can POST it; second workspace does not see it |
| `frontend/src/settings/groupBoardModel.js` | Store, normalize and read the flag |
| `frontend/src/settings/GroupBoardSettings.jsx` | Checkbox, ref carry-through, nested provider from draft |
| `frontend/src/ui/StatusPill.jsx` | Opt-in `status` prop |
| `frontend/src/issues/StatusTransitionMenu.jsx`, `IssueCard.jsx`; `frontend/src/eng/EngBoardEpicCard.jsx`, `EngBoardEpicPanel.jsx`, `EngBoardView.jsx`, `PlanningReviewTable.jsx` | Apply per the inclusion table |
| `frontend/src/eng/engFilterOptionVisuals.js` | Delegate to the shared resolver, behaviour unchanged |
| `frontend/src/dashboard.jsx` | Mount `StatusColourProvider` at the root (value off unless ENG view and `activeGroup.board.inheritColumnColours === true`), plus `status=` on the passive pills at its own sites; minimal growth |
| `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/owner_budgets.json` | Raise `dashboard.jsx` and settings ceilings/lineCounts/aggregates to measured values; refresh the `GroupBoardSettings` reviewed inventory (new input `board.inheritColumnColours`, ceiling 17→18, new `sourceDigest`) through the tool's own flow |
| `tests/test_group_board_model.js`, `tests/test_use_team_group_settings.js`, `tests/test_groups_config_conflict.js`, `tests/test_eng_filter_option_visuals.js`, `tests/test_analytics_source_guards.js` | Cases listed in the tasks |
| `tests/ui/group_board_composer.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js` | Settings state-machine cases |
| `docs/features/eng-workflows.md`, `docs/DOMAIN_ONTOLOGY.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md` | Documentation (Task 7) |
| `frontend/dist/*` | Rebuilt output; **always** committed after any `frontend/src` change, because `.github/workflows/verify-frontend-build.yml` fails on any diff after build; never hand-edited |

No change: `backend/db/**`, `backend/routes/**` (beyond tests), `backend/services/eng_board*.py`, `frontend/src/styles/**` (inline style, no new class), `planning/`.

Before executing, run `rg --files` against every named path (MRT016).

## Tasks

Each task writes its failing test first, then the code, then runs the stated command and reads the result. Python commands use `.venv/bin/python` (system `python3` lacks the dependencies on this machine); Node commands run under the repo-pinned Node 20 (`.nvmrc`), the version CI builds with, via the installed runtime manager.

### Task 0: Preflight

- [ ] `git branch --show-current` is `feature/board-column-status-colours`; `git status --short` shows only this plan and `docs/plans/README.md`; the reading list above is read.
- [ ] Startup gate sweep required by `docs/plans/AGENTS.md` for plan execution: list `GATE-*` files and record the result in this plan (expected: not applicable, no auth/DB/Home/EPM scope).
- [ ] Baseline passes before any edit: `.venv/bin/python -m unittest tests.test_group_board tests.test_group_config_service tests.test_shared_group_config_service tests.test_shared_group_config_routes tests.test_codebase_structure_budgets` and `node --test tests/test_group_board_model.js tests/test_group_config_utils.js tests/test_eng_board_columns.js tests/test_eng_filter_option_visuals.js`.
- [ ] Operator decisions are settled (2026-10-07): Decision 4 (white on solid), Decision 5 (warn and omit), Decision 7 (filter tint stays), the progress-bar and subtask-segment exclusion, and the Settings owner-ceiling update in `owner_budgets.json`. Nothing remains open.

### Task 1: Backend carries the flag

- [ ] Extend `tests/test_group_board.py` (the pure normalizer tests, `GroupBoardDbRoundTripTests` and `GroupBoardValidationRouteTests`; no new Basic-mode cases) with: absent key → output has none; `True` → kept; explicit `False` → omitted (so the response differs from the request; assert that); non-bool — `'yes'`, `'false'`, `0`, `1`, `None` → omitted with the warning `board.inheritColumnColours must be true or false; treating it as off.`, prefixed `Group "X" …` at the route, no error and the rest of the board unchanged. Implement as `raw.get('inheritColumnColours') is True` plus a warning when the key is present and not a bool. Idempotent under `normalize_group_board(normalize_group_board(x)[0])`. A legacy board without `doneEpicRetentionDays` plus the flag still runs the Done-moves-right inference exactly once; the flag must not count as "retention present". Existing reference-fixture parity tests (`GroupBoardReferenceFixtureParityTests`, `groupBoardReference.py`/`.mjs`) pass unchanged.
- [ ] Ownership and concurrency in `tests/test_shared_group_config_routes.py` / `_service.py`: a non-admin authenticated DB user can POST the flag and read it back; a second workspace does not see it; a stale-revision 409's `current` payload carries it.
- [ ] Implement in `normalize_group_board` next to the retention block, emitting the flag **last**, after `doneEpicRetentionDays`; keep the module pure.
- [ ] `tests/test_eng_board_service.py`: a board with the flag yields the same normalized `columns` and retention, and the cohort digest is unchanged by the flag.
- [ ] Run the Task 0 Python command plus `tests.test_eng_board_service tests.test_eng_board_routes`.

### Task 2: Frontend model

- [ ] Tests in `tests/test_group_board_model.js`: `toStoredBoard(columns, days, true)` emits the flag **last**; `false`, omitted, or non-boolean emits no key; `normalizeStoredBoard` keeps exactly-`true` and omits everything else, including `{ inheritColumnColours: false }`; a new reader helper (beside `retentionDaysFromStoredBoard`) returns the boolean; a legacy board still round-trips byte-identically. The existing composer-spec `toEqual` shapes (`{ columns, doneEpicRetentionDays: 28 }`) stay valid when the flag is off.
- [ ] `tests/test_groups_config_conflict.js`: a flag-only difference makes `boardDraftIsDirty` true.
- [ ] `tests/test_use_team_group_settings.js`: Department JSON export carries the flag for the active group only; import replaces the active group's board wholesale (an imported group with no board drops the flag); duplicate group (`structuredClone`, `useTeamGroupSettings.js` ~:300-318) copies it; first-run duplicate keeps it. Import/export logic lives in `useTeamGroupSettings.js` (~:831-896), so `tests/test_group_config_utils.js` is not the place for these.
- [ ] Implement with a third defaulted argument to `toStoredBoard` so existing callers and tests keep working.
- [ ] Run: `node --test tests/test_group_board_model.js tests/test_groups_config_conflict.js tests/test_use_team_group_settings.js tests/test_group_config_utils.js tests/test_first_run_group_configuration.js`.

### Task 3: Resolver and context

- [ ] Tests in `tests/test_status_column_colours.js`: flag off, missing board, empty columns → no style for any status; mapped → the column colour; unmapped → `undefined` (not the first column); duplicated status → first column; exact match, no case folding and no trimming; blank/`null` status → none; a colour not in `BOARD_COLUMN_COLOURS` → none (unlike `coerceColour`; assert it, because existing fixtures such as `eng_group_board_panel.spec.js` use `#ffa940`); the style object is the same reference across calls for one colour.
- [ ] Text colour: `buildStatusStyle` always returns `color: '#ffffff'` and the column colour as `background`, for every member of `BOARD_COLUMN_COLOURS`. The ratios of white on the seven colours are recomputed in the test and compared with the table in Decision 4, so a change to the enum or the text constant forces a conscious update of that decision instead of drifting. No 4.5:1 assertion exists, by operator choice.
- [ ] Hook-outside-provider default: render with `renderToStaticMarkup` and `React.createElement`, bundling the `.jsx` with `esbuild` as `tests/test_departments_settings_tab.js` does, never a bare hook call.
- [ ] `tests/test_eng_filter_option_visuals.js` passes unchanged after `engFilterOptionVisuals.js` delegates to the shared resolver.
- [ ] Run: `node --test tests/test_status_column_colours.js tests/test_eng_filter_option_visuals.js tests/test_eng_board_columns.js tests/test_task_filter_menu_compaction_source_guards.js`.

### Task 4: Apply to the pills

- [ ] `StatusPill`: optional `status` prop; when it resolves to a style, merge it **after** the caller's `style`, so the inherited colour wins. Without the prop, or with no provider or flag, output is byte-identical to today.
- [ ] Apply the inclusion table. `getIssueStatusClassName` stays a pure class builder and is not edited. The dashboard provider is mounted as one wrapper at the root with `enabled={selectedView === 'eng' && activeGroup?.board?.inheritColumnColours === true}` (confirm the exact variable names in code); `dashboard.jsx` calls no hook.
- [ ] Source guard `tests/test_status_column_colours_source_guards.js`, built on the repo's `includes`-style guards, not a render-proximity heuristic: a per-file table of the expected number of `getIssueStatusClassName(` calls, each classified `inherits` (the file passes `status=`, or `StatusTransitionMenu`/`IssueCard` apply it) or `excluded` with the reason from the table above; fail if any file imports `getIssueStatusClassName` and is in neither class; assert `dashboard.jsx` does not call `useStatusColourStyle`; assert `statusColumnColours.js` and the provider contain no `trackEvent` or `dataLayer.push`.
- [ ] Playwright `tests/ui/status_column_colours.spec.js` with synthetic fixtures only and the shared fixture module. The test bundle loads built CSS from `frontend/dist/dashboard.css`, so run `npm run build` first. For flag on **and** off, and for **both the interactive (OAuth editing) and passive profiles** wherever both exist, assert computed `background-color` and `color` (white) of the actual pill on: Catch Up Epic header (including an initiative-grouped Epic) and Story; Planning list Story; Planning Table status cell; Board card and open-Epic panel (Epic and Story); the status menu trigger and option marker (marker: `background-color` only; it has no text); the composer chips. Further assertions: an unmapped status keeps its built-in colours in both states; a Story with a mapped status takes the colour (Decision 2); flag off equals today pixel-for-pixel (computed styles) on every surface; the filter-bar Status popover is the existing column tint in **both** states; EPM Story and Epic pills are unchanged with the flag on; a Department without the flag or with no board is unchanged; pill and Epic-header bounding boxes are identical flag-on versus flag-off (MRT028 geometry); the number of network requests during an ENG load is identical flag-on versus flag-off; Save, close Settings, then pills recolour **without a reload**; after reload the checkbox and colours persist (config comes from the initial bootstrap, not from opening Settings). Hover on the interactive pill keeps the inline background (no dark-on-dark flip) and the existing `brightness(0.94)` filter; assert the computed `filter` and `background-color` after the pointer settles for every one of the seven colours.
- [ ] Per-class audit (project rule): before declaring done, list every pill on every included surface and tick each against an assertion; the reported instance is not the class.
- [ ] Visual proof: before/after screenshots of Catch Up, Planning Table and Board with the flag on using a fixture board that exercises all seven enum colours, taken after animations settle and compared with the approved visual's first column, including hover. Screenshots go in PR notes and are not committed.
- [ ] Run: `node --test tests/test_status_column_colours.js tests/test_status_column_colours_source_guards.js tests/test_eng_board_render.js tests/test_eng_board_view_model.js`, then `npx playwright test tests/ui/status_column_colours.spec.js tests/ui/eng_status_transitions.spec.js --browser=chromium`.

### Task 5: Settings checkbox (owner-ceiling update approved 2026-10-07)

- [ ] Placement and class: its own row directly after the composer's `.group-modal-meta` helper and **above** `.board-columns-toolbar` (a third item in that `nowrap`, `space-between` toolbar would float), reusing `.group-visible-control`. No new class, no extra Save button; the shared footer Save already persists dirty Department sections. Label: "Use column colours for statuses". One short helper line only if the screenshot shows the label is ambiguous.
- [ ] No permission gate (Decision 8). Disabled, with a one-line reason, while `columns.length === 0`, so the composer never emits a flag-only board (state machine fix for Departments with no board and for deleting the last column while the flag is on).
- [ ] Wiring: keep the flag in a ref beside `retentionDaysRef` and read it in `commit()`; the toggle handler passes the new value explicitly; the `[board]` re-seed effect also re-seeds the flag; group switch resets by the existing remount. The composer wraps itself in a nested `StatusColourProvider` built from its **local** columns and flag (never the saved `board` prop), so chips preview the draft live and it works in the standalone harness with no outer provider.
- [ ] Tests first, in the existing suites. `tests/ui/group_board_composer.spec.js` (harness exposes `window.__groupBoardHarness.board`): default unchecked; seeded checked from a stored board; toggle on emits `inheritColumnColours: true`; toggle off deep-equals the legacy `{ columns, doneEpicRetentionDays: 28 }` shape; the flag survives column add, edit, delete and Reset to default columns; an external board re-seeds the checkbox; disabled with zero columns and after deleting the last column; the live chip preview. `tests/ui/settings_unified_save.spec.js`, extending the existing 409, Keep mine, Discard mine and unified-save cases: a flag-only edit counts as a dirty board; Keep mine re-POSTs the flag; Discard mine re-seeds it unchecked; Save and Discard enable and clear; group switch isolation; a `userCanEditSettings: false` user can toggle, save and reload while the admin tabs stay locked. `tests/ui/eng_group_board_settings_tab.spec.js` (:339, :371): export/import carry the flag for the active group only.
- [ ] Geometry: element-level assertions on the checkbox row at 375px and desktop (`scrollWidth`/`clientWidth`, label right edge inside its row and clear of the next control), plus a screenshot; run the settings geometry specs headed in Firefox and WebKit as `AGENTS.md` section 10 requires for form-control geometry.
- [ ] Update the budget manifest in the same change (Task 6).
- [ ] Run: `node --test tests/test_group_board_model.js tests/test_first_run_group_configuration.js tests/test_departments_settings_tab.js`, then `npx playwright test tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js tests/ui/settings_unified_save.spec.js --browser=chromium`.

### Task 6: Budgets and full verification

- [ ] Measure the touched files, then update, in one change: `LEGACY_ENTRYPOINT_LINE_BUDGETS["frontend/src/dashboard.jsx"]`; `owner_budgets.json` `dashboard.lineCount`/`lineCeiling`; each touched settings module's `lineCount`/`lineCeiling`; the `settings`, `uniqueOwners` and `appPlusOwners` aggregates (`measured` and `ceiling`) and any `transfer` accounting; the `GroupBoardSettings` reviewed inventory via the tool's own flow. Use the existing `(+N)` comment style, and refresh the numbers quoted in `docs/ontology.md` (the extraction-safety entry).
- [ ] `fnm exec --using 20 bash scripts/extraction_lint/run.sh` passes (it includes the eslint `--max-warnings` ratchet and the hook-interface check).
- [ ] Mirror CI: `npm ci`, `npm run build` under Node 20, then `git diff --exit-code` on everything outside the intended changes, and commit the regenerated `frontend/dist`.
- [ ] `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests` (CI's environment), also run under the repo's default environment.
- [ ] `npm run test:frontend:unit`.
- [ ] `npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes).
- [ ] Launch `.venv/bin/python jira_server.py`, confirm `/api/test`, and read the log for pre-banner warnings.

### Task 7: Documentation and analytics

- [ ] `docs/features/eng-workflows.md` (the "Settings → Departments → Boards" paragraph near :109): the checkbox, off by default, unmapped statuses keep their colours, the filter popover's own tint (unchanged), white text on solid column colours as on today's pills, and the forward-compat note below.
- [ ] `docs/DOMAIN_ONTOLOGY.md` (lines ~17 and ~39-42 say board columns classify Epics by Epic status): add that, with the flag on, a column's colour is also applied to pills for any issue whose status name the column holds.
- [ ] `docs/ontology.md`: a new Department Board status-colour entry with aliases (`board.inheritColumnColours`, "Use column colours for statuses"), entry points, tests, and relationships (depends on `board.columns`; consumes `activeGroup.board`; produces an inline pill style; owner `workspace_group_configs`), updated Coverage line and verification date, and every path/symbol resolving.
- [ ] `docs/README_ANALYTICS.md` **No-Event Allowlist** table (`### No-Event Allowlist`, columns Feature action / Primary anchors / Reason / Reviewed on), not the taxonomy table: extend the existing "Group Board composer draft edits and local scroll navigation" row, keeping the substring `tests/test_analytics_source_guards.js` asserts, to include the checkbox; add one row for passive recolouring (`statusColumnColours.js`, `StatusColourContext.jsx`, the pill call sites). Use the contract wording: trigger none; `event_type=none`; `event_name=none`; `feature_name=settings`; typed params none; no taxonomy or GA4 runbook change; persistence is covered by the existing `settings_action` save events. Add row assertions and the no-`trackEvent`/`dataLayer.push` guard to `tests/test_analytics_source_guards.js` (the doc guards live there, not in `test_analytics_events.js`), and run both.
- [ ] Forward-compat note (corrected): an older backend release does not fail on the flag; its `normalize_group_board` ignores it and drops it on that release's next shared-group save, so rollback means the flag reverts to off, not corrupt data. The real hazard is a **stale browser tab** running the previous bundle: its `normalizeStoredBoard`/`toStoredBoard` drop the key, so any groups save from that tab silently turns the flag off for every Department. The backend cannot tell absent from false. Ship backend and `frontend/dist` together, tell users to reload open tabs after deploy (as the multi-label change already does), and put the same line in the PR text.
- [ ] `docs/plans/README.md`: the index entry already exists (uncommitted); update its status line when the plan state changes.
- [ ] Update this plan's status and add `Outcome` and `Current Accuracy` before ending execution.

### Task 8: Publication (blocked until the operator confirms)

- [ ] Follow the section 10 publication transaction exactly: fetch the base and record base and head SHAs; `git status --short`, `git log --oneline origin/<base>..HEAD`, `git diff --name-status origin/<base>...HEAD`; compare the commit list and every path with this plan's file map; run the verification and committed-revision build at the exact head; send PR Markdown through stdin with `--body-file -`; prove the remote head equals the approved local head, read back the rendered body, verify the remote changed files, commit count and CI state; stop and report on any malformed result. Never add secrets, token placeholders, local paths or real issue keys to the PR text. Do not push, merge, or open a PR without explicit confirmation.

## Acceptance checklist

Each item names its proving test.

- [ ] The checkbox appears only in Settings → Departments → Boards for the selected Department, defaults off, saves with the shared footer Save, and is editable by a non-admin user — `group_board_composer.spec.js`, `settings_unified_save.spec.js` (`userCanEditSettings:false` case).
- [ ] With it on, every included pill for a mapped status has the column colour as `background` and white `color`, including the interactive trigger — `status_column_colours.spec.js`, Task 3 test.
- [ ] With it off, for an unmapped status, in a Department with no board, in EPM, and in the filter popover, colours are exactly as before — `status_column_colours.spec.js`.
- [ ] The flag survives save, reload, Department JSON export/import of the active group, duplicate, revision conflict (Keep mine/Discard mine), and an older-config read — Tasks 1, 2, 5 tests.
- [ ] Toggling recolours after Save with no reload — `status_column_colours.spec.js`.
- [ ] No new request, endpoint, migration, CSS class or analytics event; ENG load request count identical on and off; pill geometry identical on and off — `status_column_colours.spec.js`, source guard, README_ANALYTICS guards.
- [ ] `dashboard.jsx` growth is minimal; all three size gates pass with ceilings raised to measured values and the extraction lint is green — `test_codebase_structure_budgets`, `run.sh`.
- [ ] Full Python (both environments), Node, Chromium UI runs and the CI-equivalent build diff pass; counts are reported with the commands. Publication follows Task 8 only after explicit confirmation.

## Risks

- **Readability.** White text on the seven column colours is below WCAG AA (2.20 to 3.65:1), the same as today's built-in pills; the operator accepted this to keep the familiar look (Decision 4). Teal, green and amber are the weakest. A hard-coded Done card tint can also sit behind a differently coloured Done pill (Decision 6).
- **Recolouring is by status name across issue types** (Decision 2). The helper line next to the checkbox may need to say so.
- **Concurrent edits.** A flag save bumps the whole shared groups revision, so another user's unrelated Department edit can hit the existing 409 banner more often; the existing conflict contract applies.
- **Stale tab and backend/bundle skew** during deploy cannot be closed server-side (Task 7 note).
- **Concurrent edits to the same pill code (#241).** Re-read the four Board/menu files on the execution branch.
- **Operator-reviewed budget checkpoint.** Approved 2026-10-07 for `dashboard.jsx` and for the touched Settings owner files; the manifest must still be updated to the exact measured values in the same change.
