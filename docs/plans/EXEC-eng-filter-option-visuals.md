# ENG Filter Option Visuals Implementation Plan

> **For agentic workers:** Execute this plan task by task. Add the named tests before production changes, record RED/GREEN evidence, and stop when a gate fails for a reason unrelated to the task.

| Field | Value |
| --- | --- |
| Date | 2026-09-03 |
| Status | Ready for execution |
| Issue | [#150 — Improve Filters UI](https://github.com/Juce-me/jira-execution-planner/issues/150) |
| Design | [`SUPPORT-eng-filter-option-visuals-design.md`](./SUPPORT-eng-filter-option-visuals-design.md) |
| Surfaces | Shared ENG task-list filter popovers and Board filter popover |

## Goal

Color each shared ENG task-list Status option label itself, reuse the application's existing Priority and Project Track visuals, and give Board Project Track an explicit four-state filter in which both unchecked means only genuinely unset values. The task-list bar appears in Catch Up, Planning, Scenario, and Statistics modes other than the three stats-source-only views and Lead Times focus mode.

The approved neutral example is:

```text
PROJECT TRACK           7
[✓]  🔒 Committed      4
[✓]  🤷 Flexible       0
```

The heading is the facet-admitted total, not the sum of the two named option counts. In this fixture the other three epics have no Project Track value. Both named rows remain visible and enabled at zero.

## Architecture

Keep membership, count, reconciliation, and reset behavior in the existing pure filter modules. Put option-presentation classification behind one pure interface:

```js
resolveEngFilterOptionVisual({ facetId, option, boardColumns })
```

`EngFilterBar` remains the shared React presentation module. It consumes the descriptor, uses the existing passive `StatusPill`, existing `renderPriorityIcon`, and existing `getProjectTrackEmoji`, and owns no fetching, persistence, or analytics. Its task-list and Board callers pass already-loaded Department board columns and the existing priority renderer.

Do not add two ordinary lines to `frontend/src/dashboard.jsx`: it is already at its 17,493-line structure budget. Add the two task-list props line-neutrally on the existing `engFilters` prop line, or consolidate only adjacent formatting/comments made obsolete by this change. Do not ratchet `tests/test_codebase_structure_budgets.py`.

## Endpoint, ownership, and state matrices

### Endpoint matrix

None. This plan adds no route, request, Jira query, mutation, auth/CSRF behavior, storage key, database field, cache, polling, SSE, or fan-out. Native Jira board discovery remains out of scope.

### Data ownership

- Status colors come from the active Department's already-loaded shared ENG Board configuration, read-only.
- Filter selection remains local React state in the existing per-Department/per-scope snapshot.
- No workspace-shared or user-private persisted configuration changes.
- No Jira/Home credential or token path is touched.

### Project Track state machine

| Committed | Flexible | Meaning | Heading for 4 / 0 / 3 fixture |
| --- | --- | --- | ---: |
| checked | checked | Neutral; all scoped epics | 7 |
| checked | unchecked | Committed only | 4 |
| unchecked | checked | Flexible only | 0 |
| unchecked | unchecked | Null/missing/trim-empty Project Track only | 3 |

An explicit empty selection is represented only by an own-property `track: []`. A missing `track` property is neutral. A populated noncanonical value such as `Other` is admitted only in neutral state; it is not No Project Track.

### Lifecycle checklist

| Event | Required result |
| --- | --- |
| Ordinary render or data refresh in the current snapshot | Preserve explicit `track: []`. |
| Board → another ENG mode → Board | Preserve the current Board selection. |
| Switch away from and back to the same Department with the same sprint/team scope | Restore that Department's cached selection. |
| Change the Teams dropdown within the current Department/sprint snapshot | Preserve and reconcile the current selection against the reduced candidates. |
| Previously unseen Department or new sprint snapshot | Preserve the existing lifecycle: initialize Board filters as neutral. |
| Select all, Project Track chip clear, or global Clear all | Remove explicit-empty meaning and restore neutral. |
| Invalid stored nonempty option ids | Reconcile to neutral, never reinterpret as No Project Track. |
| Empty-state result | Render the existing filtered-empty UI; no retry, rollback, or request. |
| Auth expiry, remote event, save conflict | Not applicable because this feature performs no request or save. |

## Scope and file map

### Create

- `frontend/src/eng/engFilterOptionVisuals.js`
- `tests/test_eng_filter_option_visuals.js`

### Modify

- `frontend/src/eng/engFilterFacets.js`
- `frontend/src/eng/engBoardFilters.js`
- `frontend/src/eng/EngFilterBar.jsx`
- `frontend/src/eng/EngView.jsx`
- `frontend/src/eng/EngBoardView.jsx`
- `frontend/src/dashboard.jsx` line-neutrally
- `frontend/src/styles/eng/filter-bar.css`
- `tests/test_eng_filter_facets.js`
- `tests/test_eng_catch_up_filters.js`
- `tests/test_eng_board_filters.js`
- `tests/test_task_filter_menu_compaction_source_guards.js`
- `tests/test_analytics_source_guards.js`
- `tests/ui/eng_compact_layout_visual.spec.js`
- `tests/ui/eng_group_board_filters.spec.js`
- `docs/features/eng-workflows.md`
- `docs/README_ANALYTICS.md` existing no-event allowlist row
- generated `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`

### Verify but do not modify

- `tests/test_codebase_structure_budgets.py`
- `tests/test_eng_filter_reset.js`
- `frontend/src/issues/issueViewUtils.js`
- `frontend/src/ui/StatusPill.jsx`
- `frontend/src/eng/engTaskUtils.js`
- `frontend/src/settings/groupBoardModel.js`
- `frontend/src/styles/eng/epics.css`
- `frontend/src/styles/eng/issues.css`

Before Task 1, verify every Modify/Verify path exists and every Create path does not. Stop if the file map is stale or required work overlaps uncertain user edits.

## Task 0 — Establish the baseline and capture before-state evidence

**Files:** none.

- [ ] Confirm execution is on a dedicated non-`main` branch created from the published documentation ref named in the issue handoff.
- [ ] Read the root and nested `AGENTS.md` files, this plan, the design, and MRT020/MRT021.
- [ ] Activate the repository's Node 20 toolchain and assert the major version before installing or testing. If `.venv/bin/python` is absent, bootstrap it with `./scripts/install.sh`; then verify Python 3.10+ and a non-LibreSSL OpenSSL runtime. Run startup preflight before starting Flask:

```bash
node -e "if (process.versions.node.split('.')[0] !== '20') process.exit(1)"
test -x .venv/bin/python || ./scripts/install.sh
.venv/bin/python -c "import ssl, sys; assert sys.version_info >= (3, 10); assert 'LibreSSL' not in ssl.OPENSSL_VERSION; print(sys.version.split()[0], ssl.OPENSSL_VERSION)"
.venv/bin/python scripts/check_startup_preflight.py
```

- [ ] Run `npm ci` in the actual fresh feature worktree before any build. Do not resolve dependencies through an ancestor checkout.
- [ ] Confirm the file map and the 17,493-line `dashboard.jsx` budget:

```bash
git status --short --branch
test -f frontend/src/eng/engFilterFacets.js
test -f frontend/src/eng/engBoardFilters.js
test -f frontend/src/eng/EngFilterBar.jsx
test -f tests/ui/eng_compact_layout_visual.spec.js
test -f tests/ui/eng_group_board_filters.spec.js
test ! -e frontend/src/eng/engFilterOptionVisuals.js
test ! -e tests/test_eng_filter_option_visuals.js
python3 -m unittest tests.test_codebase_structure_budgets
```

- [ ] Run the focused model/source baseline:

```bash
node --test \
  tests/test_eng_filter_facets.js \
  tests/test_eng_catch_up_filters.js \
  tests/test_eng_board_filters.js \
  tests/test_eng_filter_reset.js \
  tests/test_task_filter_menu_compaction_source_guards.js \
  tests/test_analytics_source_guards.js
```

- [ ] Build before browser/source checks that read `frontend/dist`:

```bash
npm run build
git diff --exit-code -- frontend/dist
```

- [ ] Start the configured Flask server on isolated port `5051`, inspect all output before the Flask banner, and treat an unexpected dependency/runtime warning as failed server verification:

```bash
SERVER_PORT=5051 .venv/bin/python jira_server.py
```

- [ ] In another terminal, verify the server and run the two existing browser files against that exact server:

```bash
curl -fsS http://127.0.0.1:5051/api/test
JEP_TEST_BASE_URL=http://127.0.0.1:5051 npx playwright test \
  tests/ui/eng_compact_layout_visual.spec.js \
  tests/ui/eng_group_board_filters.spec.js
```

- [ ] Capture and inspect settled before-state popovers at 1440px and 375×667 for Catch Up and Board. These are temporary QA evidence, not committed assets. Measure the actual label/count edges and scrolling content; container boxes alone are insufficient.
- [ ] Stop the isolated server cleanly.

Expected: the baseline is green, generated output is reproducible, and before-state screenshots show the current text-only options. Stop on a real baseline regression; do not weaken tests to proceed.

## Task 1 — Implement the Project Track count and four-state model

**Files:**

- Modify `tests/test_eng_filter_facets.js`
- Modify `tests/test_eng_board_filters.js`
- Modify `tests/test_eng_catch_up_filters.js`
- Modify `frontend/src/eng/engFilterFacets.js`
- Modify `frontend/src/eng/engBoardFilters.js`

### Step 1.1 — Add RED model coverage

- [ ] Change the Board facet's expected label to exactly `Project Track`.
- [ ] Add an opt-in test facet with:

```js
{
    id: 'track',
    label: 'Project Track',
    kind: 'multi',
    allowEmpty: true,
    showZeroCountOptions: true,
    emptyLabel: 'No Project Track',
    emptyDescription: 'No Project Track — showing epics without a value',
    emptyTotal: 3,
    options: [
        { id: 'committed', label: 'Committed' },
        { id: 'flexible', label: 'Flexible' },
    ],
}
```

- [ ] Prove Committed and Flexible remain in `visibleOptions` and remain enabled for `{ committed: 4, flexible: 0 }` and `{ committed: 0, flexible: 0 }`.
- [ ] Prove the approved count fixture: absent/both-selected is neutral with heading `7`; Committed-only is `4`; Flexible-only is active with `0`; own-property `track: []` is active empty with `3`.
- [ ] Prove all six transitions in the design table, including last untick and checking either value from explicit empty.
- [ ] Prove explicit empty has `activeOptionIds: []`, `lockedOptionIds: []`, `isEmptySelection: true`, active-facet count `1`, and chip copy `Project Track only No Project Track`.
- [ ] Prove an absent track remains neutral, explicit empty survives same-snapshot reconciliation, and a corrupt nonempty selection containing no declared id becomes neutral rather than empty.
- [ ] Prove `resetFacetSelection(selection, facet, counts)` deletes the own track property for `allowEmpty`, but ordinary facets still receive `neutralFacetSelection` exactly as today.
- [ ] Retain regression cases proving Status/Priority/Projects hide zero-count options, treat explicit empty as neutral, and lock their last selected option.
- [ ] Prove Catch Up Projects reset still yields `showTech: true` and `showProduct: true` through `readEngCatchUpFilterState`.
- [ ] Add Board fixtures for `null`, missing property, empty string, whitespace, normalized Committed/Flexible casing/whitespace, and populated `Other`. Only the genuinely empty forms match No Project Track; `Other` is neutral-only.

Run the changed tests and confirm RED for missing capabilities, not syntax or fixture errors:

```bash
node --test \
  tests/test_eng_filter_facets.js \
  tests/test_eng_catch_up_filters.js \
  tests/test_eng_board_filters.js \
  tests/test_eng_filter_reset.js
```

### Step 1.2 — Implement GREEN behavior

- [ ] In `engFilterFacets.js`, make `visibleOptionsOf` return all declared options only when `showZeroCountOptions` is true; every ordinary facet retains count-`> 0` filtering.
- [ ] Detect explicit empty only when `facet.allowEmpty` is true, the selection owns the facet key, the value is an array, and its length is zero. Use `Object.prototype.hasOwnProperty.call`.
- [ ] In `buildFacetView`, decide `isEmptySelection` before the usual zero-options-equals-neutral comparison. Empty is active, uses `emptyTotal ?? 0`, and locks nothing.
- [ ] In `toggleFacetOption`, bypass the last-option refusal only for `allowEmpty`; preserve facet option ordering in returned arrays.
- [ ] In `reconcileSelection`, preserve valid explicit empty only for `allowEmpty`; never manufacture empty from absent or invalid state.
- [ ] Export `resetFacetSelection`. For `allowEmpty`, clone and delete the facet key. For all other facets, assign `neutralFacetSelection(facet, counts)`.
- [ ] In `describeFacetChip`, handle explicit empty before ordinary included/excluded copy and use `emptyLabel`.
- [ ] In `engBoardFilters.js`, rename the label to `Project Track`; enable `allowEmpty` and `showZeroCountOptions`; expose `emptyLabel`, `emptyDescription`, and the true `emptyTotal`.
- [ ] Separate canonical normalization from emptiness detection. Canonical ids trim and compare case-insensitively; `hasNoProjectTrack` returns true only for null/undefined/trim-empty raw values.
- [ ] Count only genuine empties into `emptyTotal`. During admission, branch on `trackView.isEmptySelection`; neutral admits every value, named states admit only matching canonical ids, and empty admits only `hasNoProjectTrack`.
- [ ] Keep raw `track: []` in `engBoardFilterSelection`; do not synchronize reconciled selection back into state or change `useEngBoardFilters` ownership.

Run the focused Task 1 suite and require GREEN.

## Task 2 — Add the pure option-visual resolver

**Files:**

- Create `tests/test_eng_filter_option_visuals.js`
- Create `frontend/src/eng/engFilterOptionVisuals.js`

### Step 2.1 — Add RED resolver coverage

- [ ] Status returns `{ kind: 'status_label', configuredColour }` from the first exact status-owning board column.
- [ ] A duplicate later owner cannot override the first.
- [ ] A color not in `BOARD_COLUMN_COLOURS` yields `configuredColour: null`.
- [ ] Missing, non-array, and malformed columns fail safely without mutating inputs.
- [ ] Priority returns `{ kind: 'priority', value: option.label }`.
- [ ] Track returns `{ kind: 'project_track', value: option.label }`.
- [ ] Projects, Assignee, and unknown facets return `null`.

Run and confirm RED because the new module does not exist:

```bash
node --test tests/test_eng_filter_option_visuals.js
```

### Step 2.2 — Implement the pure interface

- [ ] Implement `resolveEngFilterOptionVisual({ facetId, option, boardColumns })`.
- [ ] Import only the board color enum needed for validation.
- [ ] Match Status names exactly and retain first-column-wins behavior from `buildBoardColumns`.
- [ ] Add no React, DOM, fetch, storage, analytics, status-palette copy, or Project Track emoji copy.

Run the new test and require GREEN.

## Task 3 — Render and wire the shared visuals

**Files:**

- Modify `tests/test_task_filter_menu_compaction_source_guards.js`
- Modify `frontend/src/eng/EngFilterBar.jsx`
- Modify `frontend/src/eng/EngView.jsx`
- Modify `frontend/src/eng/EngBoardView.jsx`
- Modify `frontend/src/dashboard.jsx` line-neutrally
- Modify `frontend/src/styles/eng/filter-bar.css`

### Step 3.1 — Add RED source/structure guards

- [ ] Both bar consumers pass `boardColumns` and `renderPriorityIcon`; Catch Up, Planning, Scenario, and applicable Statistics modes share the same `EngView` path.
- [ ] The new resolver and bar add no fetch, storage, persistence, mutation, or analytics path.
- [ ] Priority SVG paths remain single-sourced in `dashboard.jsx`.
- [ ] Status rendering contains a text pill and no circle, dot, or swatch marker.
- [ ] Priority and Project Track visual wrappers are decorative.
- [ ] Multi-option lists have labelled group semantics, and the empty description is associated only in explicit-empty Project Track state.
- [ ] A nested Status pill cannot mask the locked-option reason.
- [ ] The option row remains exactly three grid columns.
- [ ] `dashboard.jsx` remains at or below 17,493 lines.

Run and confirm RED for the missing wiring/markup.

### Step 3.2 — Implement shared rendering and wiring

- [ ] Add `boardColumns = []` and `renderPriorityIcon` to `EngFilterBar`.
- [ ] Call one unconditional `React.useId()` per mounted bar. Use a sanitized form plus facet/option ids for priority SVG seeds; retain a valid unique DOM id for the empty-description relationship.
- [ ] Replace the inline reset logic with `resetFacetSelection`.
- [ ] Replace the anonymous second span with `.pop-opt-content`, containing an optional fixed `.pop-opt-visual` and a `.pop-opt-label` with full-text `title`.
- [ ] Status renders a passive `StatusPill` using `getIssueStatusClassName(option.label, 'eng-filter-status-pill')`. A validated configured board color is the only inline background override.
- [ ] Priority delegates to `renderPriorityIcon` defensively. Track delegates to `getProjectTrackEmoji`. Do not duplicate either visual vocabulary.
- [ ] Priority and Track wrappers use `aria-hidden="true"`; Status text remains part of the option's accessible name.
- [ ] Give multi-option lists `role="group"` and the facet label as their accessible name. When `isEmptySelection`, render `emptyDescription` below the two options with `role="status"` and `aria-live="polite"`, and connect only that explicit-empty track group through `aria-describedby`.
- [ ] When a Status option is locked, pass the lock reason through the nested pill title or otherwise suppress the pill's default title so it cannot mask the button's explanation.
- [ ] `EngView` accepts/passes board columns and the existing priority renderer. This automatically covers Catch Up, Planning, Scenario, and applicable Statistics modes.
- [ ] `dashboard.jsx` passes both values line-neutrally on the existing task-list `engFilters` prop line.
- [ ] `EngBoardView` passes `board?.columns || []` and its existing renderer.

### Step 3.3 — Add only scoped CSS

- [ ] Preserve `.pop-opt { grid-template-columns: 13px 1fr auto; }`.
- [ ] Make `.pop-opt-content` a `min-width: 0` flex cell; use a fixed 16px visual slot and ellipsize only the label.
- [ ] Replace the current `span:nth-child(2)` locked-label selector with the named hook.
- [ ] Give unknown Status a neutral `#8c8c8c` background through a selector that ties the later classic status selectors, allowing `epics.css` to choose known backgrounds.
- [ ] Use a higher-specificity filter-only foreground rule such as `.popover .task-status.eng-filter-status-pill { color: var(--text-primary); }`. Do not inherit white; all seven configured board colors fail 4.5:1 against white.
- [ ] Suppress the inherited `.task-priority-icon[data-priority]::after` hover tooltip only inside `.pop-opt-visual`.
- [ ] Do not change shared `.task-status`, `.task-priority-icon`, popover width/max-height, outer bar geometry, Board columns, issue cards, or transition menus.

Build first, then run Task 2/3 source checks:

```bash
npm run build
node --test \
  tests/test_eng_filter_option_visuals.js \
  tests/test_task_filter_menu_compaction_source_guards.js
python3 -m unittest tests.test_codebase_structure_budgets
```

Expected: all pass, generated JS/CSS contains the new source behavior, and the legacy composition-root budget does not move.

## Task 4 — Prove browser behavior, accessibility, and visual layout

**Files:**

- Modify `tests/ui/eng_compact_layout_visual.spec.js`
- Modify `tests/ui/eng_group_board_filters.spec.js`

### Step 4.1 — Parameterize fixtures without rewriting baselines

- [ ] Keep each file's default fixture unchanged so existing counts and geometry remain stable.
- [ ] Let the Catch Up fixture accept per-test Department board columns and tasks.
- [ ] Let the Board fixture accept per-test Epic specs.
- [ ] Add a dedicated seven-Epic `4 Committed / 0 Flexible / 3 unset` fixture; do not replace the existing six-Epic fixture, which is needed for nonzero Flexible transitions.

### Step 4.2 — Shared task-list visual assertions

- [ ] Parameterize configured-status coverage across all seven `BOARD_COLUMN_COLOURS`; also include representative known but unmapped classic status categories, a genuinely unknown status, and Critical priority. Include one mapped status whose configured color conflicts with its classic color.
- [ ] Assert each Status row contains exactly one colored text pill and no separate marker.
- [ ] Assert the configured background wins, known fallback keeps its classic background, and unknown fallback is nontransparent gray.
- [ ] Compute contrast from actual browser styles and require at least 4.5:1 for every configured color case, every classic fallback case, and neutral gray. Assert a filled/nontransparent background and verify an issue-card Status pill outside the popover is unchanged.
- [ ] Assert every Priority row contains one existing `.task-priority-icon`; all rendered `priority-grad-*` ids are unique and every Critical path references its local id.
- [ ] Hover the filter Priority icon and assert the pseudo-element has no content and creates no popover overflow.
- [ ] Assert Projects has no visual slot.
- [ ] Assert the same Status/Priority treatment appears in Planning, Scenario, and one Statistics mode that retains the shared task list. Assert the bar remains absent in a stats-source-only view and Lead Times focus mode. Do not add mode-specific implementation branches.
- [ ] Switch to another Department that maps the same status to a different configured color, assert the rendered color updates from already-loaded group data, switch back, and prove the interaction introduces no request.

### Step 4.3 — Board Project Track behavior

- [ ] In the dedicated seven-Epic fixture, assert the exact neutral display: heading `Project Track 7`, Committed `4`, Flexible `0`; both rows are visible, enabled, and pressed.
- [ ] Assert the rows use exactly `🔒` for Committed and `🤷` for Flexible, Board Priority uses the existing SVG icon, and Projects/Assignee remain glyph-free.
- [ ] In the existing six-Epic fixture, exercise every state with ordinary clicks: neutral → Committed-only → explicit empty → Flexible-only → neutral.
- [ ] In explicit empty, assert both buttons are not pressed, heading/readout reflect only genuinely unset epics, only unset Epic cards remain, the active chip reads `Project Track only No Project Track`, and the polite explanatory line is associated with the option group.
- [ ] From empty, select a zero-count option and assert the existing filtered-empty UI rather than reconciliation to neutral.
- [ ] Prove `null`, missing, empty string, and whitespace match No Project Track; populated `Other` does not.
- [ ] Prove Select all, chip clear, and global Clear all restore neutral.
- [ ] Prove Board mode unmount/remount, Teams-dropdown changes, and a same-scope Department round trip preserve/reconcile explicit empty. Prove a previously unseen Department or new sprint snapshot starts neutral.
- [ ] Keep Board without a Status facet; Projects/Assignee remain text-only; sibling facets retain hide-at-zero and last-option lock behavior.

### Step 4.4 — Geometry and screenshots

- [ ] At 1440px and 375×667, assert actual text/count right edges, `scrollWidth <= clientWidth` where clipping is forbidden, last-option reachability, normal-click hit testing, and no document horizontal overflow.
- [ ] Reassert the 42px desktop filter bar and existing sticky adjacency in Catch Up, Planning, Scenario, the tested Statistics mode, and Board.
- [ ] Capture and inspect settled after-state screenshots with animations disabled:
  - Catch Up 1440px, decorated popover open.
  - Catch Up 375×667, decorated popover open.
  - Board 1440px, neutral `7 / 4 / 0` Project Track popover open.
  - Board 375×667, both rows unchecked with the No Project Track explanation, active chip, and readout in one viewport.

Build, run the isolated server, then execute:

```bash
npm run build
SERVER_PORT=5051 .venv/bin/python jira_server.py
curl -fsS http://127.0.0.1:5051/api/test
JEP_TEST_BASE_URL=http://127.0.0.1:5051 npx playwright test \
  tests/ui/eng_compact_layout_visual.spec.js \
  tests/ui/eng_group_board_filters.spec.js
```

Inspect every screenshot at original resolution. A green geometry assertion is not visual approval. Stop the server cleanly afterward.

## Task 5 — Align permanent documentation and analytics guards

**Files:**

- Modify `docs/features/eng-workflows.md`
- Modify the existing no-event row in `docs/README_ANALYTICS.md`
- Modify `tests/test_analytics_source_guards.js`

- [ ] Document the `Project Track` label, fixed Committed/Flexible rows including zero, admitted heading total independent from option sums, all four states, strict null/missing/trim-empty meaning, reset behavior, and existing scope lifecycle.
- [ ] Keep the existing no-event decision. Expand its rationale to cover passive option visuals and the local No Project Track state; add no canonical event, parameter, custom dimension, or GA4 runbook registration.
- [ ] Guard the new resolver and touched filter modules against analytics imports/emission.
- [ ] Extend the Board browser analytics case to snapshot app-owned `dataLayer` events, enter explicit empty, and reset through the supported actions without emitting `app_search` or another event.

Run:

```bash
node --test tests/test_analytics_source_guards.js
SERVER_PORT=5051 .venv/bin/python jira_server.py
curl -fsS http://127.0.0.1:5051/api/test
JEP_TEST_BASE_URL=http://127.0.0.1:5051 npx playwright test \
  tests/ui/eng_group_board_filters.spec.js --grep "analytics|app_search"
```

Start the server in a separate terminal, inspect its pre-banner output, and stop it cleanly after the browser check.

## Task 6 — Regenerate, verify, inspect, and hand off

**Generated files:**

- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `frontend/dist/dashboard.css`

- [ ] Run all focused tests:

```bash
node --test \
  tests/test_eng_filter_option_visuals.js \
  tests/test_eng_filter_facets.js \
  tests/test_eng_catch_up_filters.js \
  tests/test_eng_board_filters.js \
  tests/test_eng_filter_reset.js \
  tests/test_task_filter_menu_compaction_source_guards.js \
  tests/test_analytics_source_guards.js
python3 -m unittest tests.test_codebase_structure_budgets
```

- [ ] Rebuild from the fresh worktree's verified Node 20 dependencies:

```bash
npm run build
```

- [ ] Start the isolated server again, inspect its pre-banner output, keep it alive through both focused and full Playwright runs, inspect all four screenshots, then stop it cleanly:

```bash
SERVER_PORT=5051 .venv/bin/python jira_server.py
```
- [ ] In another terminal, use the same server for the focused browser files before the full browser suite:

```bash
curl -fsS http://127.0.0.1:5051/api/test
JEP_TEST_BASE_URL=http://127.0.0.1:5051 npx playwright test \
  tests/ui/eng_compact_layout_visual.spec.js \
  tests/ui/eng_group_board_filters.spec.js
```

- [ ] Run full repository verification:

```bash
npm run test:frontend:unit
JEP_TEST_BASE_URL=http://127.0.0.1:5051 npm run test:frontend:ui
python3 -m unittest discover -s tests
git diff --check
git status --short
git log --oneline -5
```

- [ ] Review the complete diff. Every changed line must trace to issue #150, the approved count/selection behavior, required documentation, tests, or generated output. Confirm no secrets, local paths, real Jira keys, unrelated formatting, or auxiliary refactor entered the diff.
- [ ] Commit source, tests, docs, and generated output atomically. After that commit, run `npm run build` once more and require:

```bash
git diff --exit-code -- frontend/dist
```

- [ ] Report exact command results and screenshot paths. Stop before push, PR creation, merge, or issue closure unless the user explicitly authorizes those actions.

## Acceptance criteria

- Every shared task-list Status option label carries configured/classic/neutral color; no separate dot, circle, or swatch renders.
- Configured status colors come from the active Department's saved ENG Board columns with exact first-owner matching and safe invalid-color fallback.
- Filter Status text has at least 4.5:1 computed contrast, while issue-card and transition-menu pills remain unchanged.
- Every shared task-list and Board Priority option reuses the existing priority icons with unique SVG ids and no duplicate filter tooltip.
- Board uses the `Project Track` label and always renders `🔒 Committed` and `🤷 Flexible`, including zero.
- For 4 Committed, 0 Flexible, and 3 unset epics, neutral displays heading `7` and option counts `4` and `0`.
- The four checkbox states map exactly to neutral, Committed-only, Flexible-only, and genuinely unset-only; both unchecked is visible in the popover and active chip.
- Populated unknown Project Track values are not mislabeled as unset.
- Status, Priority, and Projects retain current hide-at-zero/last-option/reset behavior; Catch Up Projects still resets to both Product and Tech.
- Existing per-scope snapshot/reset behavior, requests, auth, persistence, Jira data, and analytics remain unchanged.
- Desktop/mobile popovers remain reachable and unclipped; Catch Up, Planning, Scenario, applicable Statistics modes, and Board sticky geometry remains unchanged.
- Focused and full tests pass, the `dashboard.jsx` structure budget does not increase, all screenshots are inspected, and a post-commit rebuild leaves `frontend/dist` clean.

## Out of scope

- Backend/API work, native Jira board discovery, Jira mutation, auth, storage, database, cache, or migration changes.
- A synthetic third No Project Track option.
- A Status facet on Board or Project Track facet on any task-list mode.
- Icons for Projects/Assignee or icons in active chips.
- Priority renderer extraction or SVG redesign.
- Global restyling of status pills, priority icons, shared controls, Board columns, cards, transition menus, or Settings.
- Cross-scope Project Track filter persistence.

## Plan self-review

- The source-of-truth seam remains the existing pure facet model plus one pure visual resolver; callers only pass loaded dependencies.
- The `7 / 4 / 0` contract, strict unset membership, four states, reset compatibility, and lifecycle transitions each have concrete unit/browser checks.
- The endpoint/auth/workspace/concurrency matrix is empty by design and guarded against accidental requests, persistence, mutation, or analytics.
- MRT020/MRT021 prevention is applied through shared visual reuse, named row hooks, element-level measurements, and mandatory screenshot inspection.
- The legacy composition root cannot grow; the existing structure-budget test remains unchanged and required.
