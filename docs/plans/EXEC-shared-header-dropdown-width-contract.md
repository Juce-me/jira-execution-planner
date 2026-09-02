# Shared Header Dropdown Width Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Implementation and code verification are locally complete on `bugfix/shared-dropdown-width-contract`, merged with `origin/main` at `c82b6f7`, and awaiting acceptance. This is a bounded follow-up to the filterable header controls merged in PR #125; do not re-execute `EXEC-filterable-header-dropdown-inputs.md`.

> **Outcome:** Tasks 1 and 2 are implemented in `6a30287` and `6c0d925`; the structure-budget correction is in `c2189fc`, and `79f1af5` merges the current online onboarding implementation. The final fixture correction makes the scoped DB/OAuth startup test opt into the merged unified shared-config snapshot without changing product behavior or other fixtures. Post-merge verification passed the Node 20 build, 1,144 frontend unit tests, 1,538 Python tests with 9 skips in the isolated file/basic baseline, all 72 tests in the four-file dropdown suite, 100 onboarding-tour browser tests, and 220 onboarding integration browser tests. The real local startup preflight remains blocked because the configured PostgreSQL socket is unavailable.

> **Current accuracy:** The merged implementation, full browser suite, onboarding coexistence checks, and after-state screenshots match the contract. The original ignored before-state screenshots are no longer present, so the narrow compact 760/390/375 result is supported by geometry/no-overflow assertions and reviewed after-state images rather than a retained pixel-for-pixel before comparison. Configured DB-mode startup verification remains unavailable until local PostgreSQL is running; the isolated full Python baseline passes.

**Goal:** Keep the ENG header Sprint, Group, and Teams dropdown shells visually stable while closed, open, and filtered, with each open panel aligned to the same outer width as its trigger.

**Architecture:** Add one semantic CSS contract to the existing three ENG header renderers instead of changing globally reused dropdown classes or introducing another React component. The semantic root owns a preferred width; its existing toggle and panel consume that width; the input shrinks inside the toggle's value slot. Existing compact-header flex allocation remains authoritative. The main row keeps responsive wrapping and is verified as one rendered row only at supported desktop widths.

**Tech Stack:** React 19, CSS, Playwright, esbuild, Node 20.x.

**Spec:** `docs/plans/EXEC-filterable-header-dropdown-inputs.md` defines the existing filter-input interaction contract. The approved 2026-09-02 follow-up design and this plan replace only its width/layout assumptions.

## Global Constraints

- Scope the semantic contract to ENG header Sprint, Group, and Teams controls on main and compact surfaces. EPM header Sprint, EPM Project/Sort/Sub-goal controls, Statistics ranges, ENG filter-bar sort, ENG Board detail sort, and Excluded Capacity dropdowns must not receive the class.
- Main Sprint is exactly `8.5rem` (136px at the app's 16px root size); Group and Teams remain exactly `12.5rem` (200px). Closed, empty-open, typed-open, and reopened widths differ by no more than 1px.
- Compact Sprint prefers `8.5rem`; compact Group and Teams prefer the existing 170px cap. At supported desktop compact widths (1028px and above), opening or typing must not change the rendered width. At 760/390/375px, preserve the current compact row without widening or restructuring it; the existing outer-flex allocation collapses some controls and is not expanded in this width-contract slice.
- For an opted-in control, root, toggle, and panel left/right edges match within 1px. The input occupies only the toggle's inner value slot, has positive width, stays clear of the caret, and never controls an outer width.
- Equal-width Sprint panels intentionally replace generic content-width panel behavior only for opted-in ENG header controls. Header Sprint options wrap so two long same-prefix sprint names remain distinguishable inside a 136px panel.
- Preserve `.view-filters { flex-wrap: wrap; }`. Do not add `nowrap`: fixed controls need about 976px and would be hidden at tablet widths because `body` suppresses horizontal overflow. Prove one rendered main row at 1091x800 and 1440x900, safe main wrapping at 1028, 768, 761, 760, 390, and 375 CSS pixels, and width-stable compact controls at 1028 and 1440.
- Layer additive semantic rules on existing compact selectors. Do not delete or narrow broad compact rules that EPM also uses.
- Do not add JavaScript measurement/state, hidden sizing labels, a new dropdown component/dependency, row clipping, or local width overrides in `settings/dropdowns.css` or `eng/controls.css`.
- Preserve selection, filtering, focus-on-open, Escape, outside-click, checkbox, analytics, request, and persistence behavior. Focus restoration after Escape is outside this width-only slice.
- This passive layout correction adds no analytics event. Expand the existing no-event allowlist entry without collecting query text or selected names.
- Do not hand-edit `frontend/dist`; regenerate it with `npm run build` before GREEN Playwright verification and again during final verification.
- Allowed files are `frontend/src/dashboard.jsx`, `frontend/src/styles/shared/header.css`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/eng_compact_layout_visual.spec.js`, `tests/ui/eng_group_board_panel.spec.js`, `tests/ui/epm_multi_subgoal_visual.spec.js`, `docs/README_ANALYTICS.md`, this plan, `docs/plans/README.md`, the workflow-required `docs/plans/GATE-05-home-write-capability.md` gate record, and generated `frontend/dist/dashboard.css`, `frontend/dist/dashboard.js`, and `frontend/dist/dashboard.js.map`.
- Do not rename the already-executed `EXEC-filterable-header-dropdown-inputs.md` without separate approval; `docs/plans/AGENTS.md` requires approval before that file move.

---

### Task 1: Capture the current regression and create fail-first contracts

**Files:**
- Modify: `tests/ui/codebase_structure_smoke.spec.js:10-15,446-550,1636-2050,2411-2510,2508-2820,2855-2930`
- Modify: `tests/ui/eng_compact_layout_visual.spec.js:210-235,462-489,1163-1166`
- Modify: `tests/ui/eng_group_board_panel.spec.js:730-756`
- Modify: `tests/ui/epm_multi_subgoal_visual.spec.js:323-365,450-490`

- [x] **Step 1: Confirm the branch, worktree, files, and Node 20 runtime**

Run:

```bash
git branch --show-current
git status --short
test -f frontend/src/dashboard.jsx
test -f frontend/src/styles/shared/header.css
test -f tests/ui/codebase_structure_smoke.spec.js
test -f tests/ui/eng_compact_layout_visual.spec.js
test -f tests/ui/eng_group_board_panel.spec.js
test -f tests/ui/epm_multi_subgoal_visual.spec.js
test -f docs/README_ANALYTICS.md
test "$(cat .nvmrc)" = "20"
node --version
```

Expected: branch `bugfix/shared-dropdown-width-contract`; all named files exist; unrelated changes are absent or recorded; Node reports `v20.x`. If `node_modules` is absent, run `npm ci` with Node 20 before testing.

- [x] **Step 2: Capture a settled before-state without changing production CSS**

Run:

```bash
mkdir -p tmp/shared-header-dropdown-width-contract/before tmp/shared-header-dropdown-width-contract/after
```

When adding screenshot calls, define the paths with `path.join(repoRoot, 'tmp', 'shared-header-dropdown-width-contract', 'before')` or `... 'after'`; do not commit machine-specific absolute paths.

In the existing header-dropdown Playwright fixture, replace the short future Sprint with two synthetic long same-prefix options:

```js
const headerLongSprintEastName = '2026Q3 Sprint 43 — International Platform Reliability and Migration — East';
const headerLongSprintWestName = '2026Q3 Sprint 44 — International Platform Reliability and Migration — West';

sprints: [
    { id: selectedSprintId, name: selectedSprintName, state: 'active' },
    { id: 34624, name: '2026Q2 Sprint 41', state: 'closed' },
    { id: 34627, name: headerLongSprintEastName, state: 'future' },
    { id: 34628, name: headerLongSprintWestName, state: 'future' },
],
```

Use new `headerLongSprint*` constants rather than changing the file's existing `longSprintName`, which belongs to Statistics fixtures. Replace the current `fill('f')`/one-option checks in this header test with the shared query and two-option checks, and select the exact East option where the existing flow commits a Sprint. Create the ignored evidence directories `tmp/shared-header-dropdown-width-contract/before/` and `tmp/shared-header-dropdown-width-contract/after/`. Temporarily add screenshot calls before semantic-class assertions exist. Open the main Sprint, type `International Platform Reliability and Migration`, wait for animations, and capture `tmp/shared-header-dropdown-width-contract/before/stable-header-dropdown-main-before.png`. Scroll until the compact header is visible, open its Sprint at 1440px, type the same query, wait, and capture `tmp/shared-header-dropdown-width-contract/before/stable-compact-header-dropdown-before.png`. Also capture the untouched closed compact row at 760, 390, and 375px as `stable-compact-header-{width}-before.png`; these narrow references protect the existing allocation without pretending its currently collapsed controls are interactive.

Run only the existing header test against the current generated assets:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "open header dropdown toggles filter groups teams and sprints"
```

Expected: PASS and the baseline images exist under the ignored `tmp/shared-header-dropdown-width-contract/before/` directory. This path is outside Playwright's auto-cleaned `test-results/`, so later processes cannot erase it. Inspect them and record the visible width expansion/panel mismatch plus the current narrow compact allocation in the implementation notes. Remove only the temporary baseline screenshot calls before adding the RED assertions; do not remove the long fixtures.

- [x] **Step 3: Add one explicit geometry reader and assertion contract**

Add `readHeaderDropdownGeometry(dropdown, kind)` beside the existing dropdown helpers. It must return these named fields so absent elements cannot pass as zero-width geometry:

```js
{
    hasToggle, hasPanel, hasInput, hasCaret,
    rootWidth, rootLeft, rootRight,
    toggleWidth, toggleLeft, toggleRight, toggleBottom,
    panelWidth, panelLeft, panelRight, panelTop,
    inputWidth, inputLeft, inputRight,
    caretWidth, caretLeft, caretRight,
    inputCaretGap,
    panelWithinViewport,
    panelLeftHitOwned,
    panelRightHitOwned,
}
```

Compute hit ownership with `document.elementFromPoint()` at points 2px inside the panel's left and right edges and require the returned node to be inside that exact panel. Add `expectOpenHeaderDropdownGeometry(geometry, closedWidth)` that checks:

```js
expect(geometry.hasToggle).toBe(true);
expect(geometry.hasPanel).toBe(true);
expect(geometry.hasInput).toBe(true);
expect(geometry.hasCaret).toBe(true);
expect(geometry.toggleWidth).toBeGreaterThan(0);
expect(geometry.panelWidth).toBeGreaterThan(0);
expect(geometry.inputWidth).toBeGreaterThan(0);
expect(geometry.caretWidth).toBeGreaterThan(0);
expect(Math.abs(geometry.rootWidth - closedWidth)).toBeLessThanOrEqual(1);
expect(Math.abs(geometry.toggleWidth - geometry.rootWidth)).toBeLessThanOrEqual(1);
expect(Math.abs(geometry.panelWidth - geometry.rootWidth)).toBeLessThanOrEqual(1);
expect(Math.abs(geometry.toggleLeft - geometry.rootLeft)).toBeLessThanOrEqual(1);
expect(Math.abs(geometry.toggleRight - geometry.rootRight)).toBeLessThanOrEqual(1);
expect(Math.abs(geometry.panelLeft - geometry.rootLeft)).toBeLessThanOrEqual(1);
expect(Math.abs(geometry.panelRight - geometry.rootRight)).toBeLessThanOrEqual(1);
expect(geometry.inputLeft).toBeGreaterThanOrEqual(geometry.toggleLeft - 1);
expect(geometry.inputRight).toBeLessThanOrEqual(geometry.toggleRight + 1);
expect(geometry.inputCaretGap).toBeGreaterThanOrEqual(0);
expect(geometry.caretRight).toBeLessThanOrEqual(geometry.toggleRight + 1);
expect(geometry.panelTop).toBeGreaterThanOrEqual(geometry.toggleBottom - 1);
expect(geometry.panelWithinViewport).toBe(true);
expect(geometry.panelLeftHitOwned).toBe(true);
expect(geometry.panelRightHitOwned).toBe(true);
```

Use this same assertion after empty open, typing, and reopening. Before each open, focus the toggle and press `Enter`; assert the named textbox becomes focused. For the closed state, assert root/toggle widths and left/right edges match before recording `closedWidth`.

- [x] **Step 4: Add main and compact stability assertions, including readable long options**

Drive the three main contracts from this table:

```js
const dropdownCases = [
    { kind: 'sprint', inputName: 'Filter sprints', query: 'International Platform Reliability and Migration', expectedMainWidth: 136 },
    { kind: 'group', inputName: 'Filter groups', query: 'platform delivery '.repeat(6), expectedMainWidth: 200 },
    { kind: 'team', inputName: 'Filter teams', query: 'alpha team '.repeat(8), expectedMainWidth: 200 },
];
```

For each main control:

1. Locate `.${kind}-dropdown.header-filter-dropdown` and assert the matching `header-filter-dropdown--${kind}` class.
2. Assert the closed root/toggle width and the exact main width.
3. Open with focus plus `Enter`, assert focused input, and run the open geometry assertion.
4. Fill the query and run the same geometry assertion.
5. For Sprint, assert both long options remain rendered, the `East` and `West` suffixes are present, computed `white-space` is `normal`, every option has `scrollWidth <= clientWidth + 1`, every option's left/right edges stay inside the panel, and at least one option occupies more than one line.
6. Capture `tmp/shared-header-dropdown-width-contract/after/stable-header-dropdown-typed-open.png` immediately while the typed Sprint is open.
7. Press Escape, reopen with keyboard, assert the query reset, run the same geometry assertion, and capture `tmp/shared-header-dropdown-width-contract/after/stable-header-dropdown-reopened.png` before the final Escape.

Preserve the existing checkbox, option selection, sibling-open reset, outside-click reset, and input-focus assertions.

Repeat the state sequence for compact Sprint, Group, and Teams at supported desktop widths 1440 and 1028 after scrolling the compact header into view. Compact assertions use each control's rendered closed width rather than desktop constants, while requiring:

```js
expect(closedWidth).toBeGreaterThanOrEqual(24);
expect(closedWidth).toBeLessThanOrEqual(170);
expect(geometry.inputWidth).toBeGreaterThan(0);
expect(geometry.caretWidth).toBeGreaterThan(0);
expect(geometry.rootLeft).toBeGreaterThanOrEqual(0);
expect(geometry.rootRight).toBeLessThanOrEqual(viewportWidth + 1);
```

Use normal keyboard/click activation; never `force: true`. Capture the 1440 open state as `tmp/shared-header-dropdown-width-contract/after/stable-compact-header-dropdown-open.png`. At 760, 390, and 375px, do not run the open/input contract: read-only Chromium review found the current outer compact allocation gives some Sprint/Team roots and inputs 0-10px while Group remains 170px. Instead, capture the closed compact row as `stable-compact-header-760-after.png`, `stable-compact-header-390-after.png`, and `stable-compact-header-375-after.png` in the persistent after directory; assert the row creates no new document overflow and compare each image with its same-width before reference. Fixing the compact Group wrapper plus mode/search allocation is a separate layout decision; this plan neither hides nor claims to solve that pre-existing narrow compact behavior.

At 760, 390, and 375px, separately exercise the main (non-sticky) Sprint control through closed, empty-open, typed-open, and reopened states. Before each main sequence, close any open menu, call `window.scrollTo(0, 0)`, wait for the surface-change effect, assert `.compact-sticky-header` no longer has `.is-visible` and has `aria-hidden="true"`, and assert the main `.view-selector` Sprint is visible. Only then open it: panels and input autofocus are intentionally restricted to `activeControlSurface`, so a mounted-but-inactive main toggle is not valid evidence. Require the 136px root/toggle/panel contract, panel hit ownership, input/caret containment, and viewport containment, and capture `stable-main-header-sprint-{width}-open.png` in the persistent after directory. This is the mobile dropdown coverage for this slice.

- [x] **Step 5: Replace the conflicting compact single-line contract**

In `eng_compact_layout_visual.spec.js`, make the mock `/api/sprints` response include both long same-prefix synthetic Sprints. Rename `expectSprintOptionsStaySingleLine` to `expectHeaderSprintOptionsWrapInsidePanel` and replace its assertions with the same scoped wrapping metrics: `white-space: normal`, no horizontal overflow, all option edges inside the panel, distinct `East`/`West` text, and at least one multiline option. Rename the test to `the compact sticky header wraps long sprint options inside its stable panel`.

Do not weaken unrelated single-line/ellipsis assertions for the closed compact toggle.

- [x] **Step 6: Add non-vacuous scope locks in tests that render each excluded consumer**

Every absence guard must first prove its base consumer is present and visible:

- In `Statistics subviews render extracted panels...`, locate `[data-stats-range]:visible .sprint-dropdown`, assert its first item is visible and its count is nonzero, then assert `[data-stats-range] .sprint-dropdown.header-filter-dropdown` has count zero.
- In `Excluded Capacity summary...`, assert `.excluded-capacity-epic-dropdown` is visible before asserting it lacks `.header-filter-dropdown`.
- In `open header dropdown toggles...`, assert `.eng-epic-sort-dropdown` is visible before asserting `.eng-epic-sort-dropdown.header-filter-dropdown` has count zero.
- In `eng_group_board_panel.spec.js` test `the three sort orders...`, assert `.epic-panel-sort-dropdown` is visible, lacks the class, and still opens with a normal click before sorting.
- In `epm_multi_subgoal_visual.spec.js` test `EPM control dropdowns size to short labels and long options`, first assert the main EPM Sprint root, `.epm-project-dropdown`, `.epm-subgoal-dropdown`, and `.epm-sort-dropdown` are each present/visible; then assert each lacks the class. In its compact EPM test, do the same for the actual compact EPM Sprint, Project, Sub-goal, and Sort roots, including a positive visible assertion for `.epm-sort-dropdown` before its class-absence check.

Do not use `.view-selector > .view-filters .header-filter-dropdown` alone as evidence; it is only an aggregate backstop after the positive guards.

- [x] **Step 7: Add an explicit responsive row reader and width sweep**

Create `readHeaderRowGeometry(filters)` returning:

```js
{
    rowLeft, rowRight, rowTop, rowBottom,
    flexWrap, rowScrollWidth, rowClientWidth,
    viewportWidth, documentScrollWidth,
    rowCount,
    childEdges,
    childLineTops,
    childLineBottoms,
    textOverflowingChildren,
}
```

`childEdges` includes every visible direct child. Because `.view-filters` uses `align-items: flex-end` and children have different heights, `rowCount` groups `childLineBottoms` within a 2px tolerance; `childLineTops` is diagnostic only. `textOverflowingChildren` counts visible text-bearing descendants whose `scrollWidth > clientWidth + 1` while their computed `overflow-x` is `visible`; this ignores intentionally clipped ellipsis and the documented internally scrollable `.eng-mode-control`, but catches exposed text escape.

Sweep 1440x900, 1091x800, 1028x800, 768x800, 761x800, 760x800, 390x900, and 375x900 in `multiple groups keep...`. At every width assert `flexWrap === 'wrap'`, `textOverflowingChildren === 0`, row/document horizontal overflow is at most 1px, and all child edges stay within row/viewport bounds. Require exactly one row only at 1440 and 1091. Require more than one row at 760, 390, and 375; at 1028/768/761 accept the measured responsive row count but still enforce containment and no overflow. Preserve the existing settings/refresh adjacency and icon geometry assertions. Write settled main-header images for 1440, 1091, 760, 390, and 375 to `tmp/shared-header-dropdown-width-contract/after/`.

- [x] **Step 8: Run RED and confirm failures are the new contract**

Start the configured server, then run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "open header dropdown toggles|multiple groups keep|Statistics subviews|Excluded Capacity summary"
npx playwright test tests/ui/eng_compact_layout_visual.spec.js --grep "compact sticky header wraps long sprint options"
npx playwright test tests/ui/eng_group_board_panel.spec.js --grep "three sort orders"
npx playwright test tests/ui/epm_multi_subgoal_visual.spec.js --grep "control dropdowns size|compact sticky controls"
```

Expected: failures are specifically missing semantic classes, unstable Sprint/root/panel width, or the old single-line option behavior. Dependency, fixture, server, timeout, or missing-consumer failures are not valid RED evidence and must be fixed before production code.

---

### Task 2: Implement the ENG-only semantic width contract

**Files:**
- Modify: `frontend/src/dashboard.jsx:13026-13276`
- Modify: `frontend/src/styles/shared/header.css:59-102`

**Interfaces:**
- Consumes: existing `renderSprintControl(surface)`, `renderGroupControl(surface)`, `renderTeamControl(surface)`, and existing dropdown root/toggle/panel/input classes.
- Produces: `.header-filter-dropdown`, `.header-filter-dropdown--sprint`, `.header-filter-dropdown--group`, `.header-filter-dropdown--team`, and `--header-filter-dropdown-width`.
- Preserves: exclusive open state, active-surface panel ownership, compact visibility/flex allocation, and every non-header consumer of generic dropdown classes.

- [x] **Step 1: Opt in only ENG header roots**

In `frontend/src/dashboard.jsx`, make Sprint conditional because `renderSprintControl` serves ENG and EPM:

```jsx
const sprintDropdownClassName = [
    'sprint-dropdown',
    selectedView === 'eng' ? 'header-filter-dropdown header-filter-dropdown--sprint' : '',
].filter(Boolean).join(' ');
```

Use `className={sprintDropdownClassName}` on the existing Sprint root. Add the semantic classes to existing Group and Teams roots, which are already ENG-only:

```jsx
<div className="group-dropdown header-filter-dropdown header-filter-dropdown--group" ...>
<div className="team-dropdown header-filter-dropdown header-filter-dropdown--team" ...>
```

Do not change wrappers, descendants, handlers, option rendering, or any EPM/Stats/Sort/Excluded Capacity renderer.

- [x] **Step 2: Add the header-only CSS contract**

Append these rules after existing compact dropdown sizing in `frontend/src/styles/shared/header.css`:

```css
.header-filter-dropdown--sprint {
    --header-filter-dropdown-width: 8.5rem;
}

.header-filter-dropdown--group,
.header-filter-dropdown--team {
    --header-filter-dropdown-width: 12.5rem;
}

.view-selector .header-filter-dropdown {
    width: var(--header-filter-dropdown-width);
    min-width: var(--header-filter-dropdown-width);
    max-width: var(--header-filter-dropdown-width);
}

.view-selector .header-filter-dropdown > .sprint-dropdown-toggle,
.view-selector .header-filter-dropdown > .group-dropdown-toggle,
.view-selector .header-filter-dropdown > .team-dropdown-toggle,
.view-selector .header-filter-dropdown > .sprint-dropdown-panel,
.view-selector .header-filter-dropdown > .group-dropdown-panel,
.view-selector .header-filter-dropdown > .team-dropdown-panel {
    width: 100%;
    min-width: 100%;
    max-width: 100%;
}

.view-selector .header-filter-dropdown .dropdown-toggle-filter-input {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
}

.view-selector .header-filter-dropdown--sprint > .sprint-dropdown-panel .sprint-dropdown-option {
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
}

@media (min-width: 1028px) {
    .compact-sticky-header .header-filter-dropdown {
        width: min(var(--header-filter-dropdown-width), 10.625rem);
        min-width: 0;
        max-width: 100%;
    }

    .compact-sticky-header .header-filter-dropdown > .sprint-dropdown-toggle,
    .compact-sticky-header .header-filter-dropdown > .group-dropdown-toggle,
    .compact-sticky-header .header-filter-dropdown > .team-dropdown-toggle,
    .compact-sticky-header .header-filter-dropdown > .sprint-dropdown-panel,
    .compact-sticky-header .header-filter-dropdown > .group-dropdown-panel,
    .compact-sticky-header .header-filter-dropdown > .team-dropdown-panel {
        width: 100%;
        min-width: 100%;
        max-width: 100%;
    }

    .compact-sticky-header .header-filter-dropdown .dropdown-toggle-filter-input {
        flex: 1 1 0;
        width: 0;
        min-width: 0;
    }

    .compact-sticky-header .header-filter-dropdown--sprint > .sprint-dropdown-panel .sprint-dropdown-option {
        overflow-wrap: anywhere;
        text-overflow: clip;
        white-space: normal;
    }
}
```

Do not set `overflow: visible`; the generic option's clipping boundary must remain intact. The 1028px media gate applies to every compact semantic sizing rule, not only the root, so 760/390/375 keep their existing root, input, panel, and option behavior. Do not change `.view-filters`, generic Sprint rules in `shared/controls.css`, compact EPM selectors, or Group/Teams rules in their owning stylesheets.

- [x] **Step 3: Rebuild immediately so Playwright exercises the new source**

Run:

```bash
npm run build
```

Expected: build passes and generated `frontend/dist/dashboard.css`, `dashboard.js`, and `dashboard.js.map` reflect the source change. Do not run GREEN browser tests against stale generated assets.

- [x] **Step 4: Run the focused GREEN suite and inspect before/after evidence**

Run the four focused commands from Task 1 Step 8 again.

Expected: all pass using normal clicks/keyboard. Inspect the persistent before images from Task 1 beside:

- `stable-header-dropdown-typed-open.png`
- `stable-header-dropdown-reopened.png`
- `stable-compact-header-dropdown-open.png`
- `stable-compact-header-760-after.png`
- `stable-compact-header-390-after.png`
- `stable-compact-header-375-after.png`
- `stable-main-header-sprint-760-open.png`
- `stable-main-header-sprint-390-open.png`
- `stable-main-header-sprint-375-open.png`
- the 1440/1091/760/390/375 row screenshots
- `control-dropdown-widths.png` and `compact-sticky-project-picker.png` from the EPM regression file

Visible checks: no border movement, aligned trigger/panel edges, readable wrapped Sprint suffixes, input/caret containment, no row or viewport clipping, stable compact controls, and unchanged excluded consumers.

---

### Task 3: Record analytics impact and run full regression verification

**Files:**
- Modify: `docs/README_ANALYTICS.md:136`
- Rebuild: `frontend/dist/dashboard.css`
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`

- [x] **Step 1: Record the no-event decision**

Replace the `Header dropdown query typing` allowlist row with:

```markdown
| Header dropdown query typing and width stabilization | `frontend/src/dashboard.jsx`, `frontend/src/styles/shared/header.css` | Query text only filters already-loaded local options and is discarded on close; the stable shell/panel width is passive presentation. Existing `filter_changed` events remain attached to committed Sprint, Group, and Teams selections. No separate `userevent` is emitted, and raw query text, sprint names, group names, and team names are never collected. | 2026-09-02 |
```

- [x] **Step 2: Run complete verification in the required order**

Run:

```bash
npm run build
npm run test:frontend:unit
python3 -m unittest discover -s tests
npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/eng_compact_layout_visual.spec.js tests/ui/epm_multi_subgoal_visual.spec.js tests/ui/eng_group_board_panel.spec.js
git diff --check
git status --short
```

Expected: build, frontend unit tests, full Python suite, all four Playwright files, and diff check pass. The second build leaves no unexpected generated diff. Screenshot artifacts stay untracked/ignored and are not staged.

Result: the Node 20 build and all 1,144 frontend unit tests passed; the isolated file/basic full Python suite passed all 1,538 tests with 9 skips; and the four-file Playwright suite passed all 72 tests after the scoped startup fixture was aligned with the unified shared-config bootstrap. The configured DB-mode run and startup preflight remain unavailable because local PostgreSQL is not running.

- [x] **Step 3: Review the exact diff and scope**

Run:

```bash
git diff --stat
git diff --check
git diff -- frontend/src/dashboard.jsx frontend/src/styles/shared/header.css tests/ui/codebase_structure_smoke.spec.js tests/ui/eng_compact_layout_visual.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/epm_multi_subgoal_visual.spec.js docs/README_ANALYTICS.md frontend/dist/dashboard.css frontend/dist/dashboard.js frontend/dist/dashboard.js.map docs/plans/EXEC-shared-header-dropdown-width-contract.md docs/plans/README.md
git status --short
git log --oneline -5
```

Expected: no local paths, secrets, real Jira identifiers, unrelated formatting, or files outside the allowed map. Every line traces to the width contract, verification, analytics review, generated build, or plan bookkeeping.

Result: controller and independent subagent reviews found no product-source scope leak, onboarding-hook regression, local path, secret, real Jira fixture, or unrelated file change. The only final correction is the scoped Playwright bootstrap fixture plus truthful plan/index bookkeeping.

- [ ] **Step 4: Commit only after explicit user authorization**

After reporting the full verification and recent log, and only after the user authorizes the commit:

```bash
git add frontend/src/dashboard.jsx frontend/src/styles/shared/header.css tests/ui/codebase_structure_smoke.spec.js tests/ui/eng_compact_layout_visual.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/epm_multi_subgoal_visual.spec.js docs/README_ANALYTICS.md frontend/dist/dashboard.css frontend/dist/dashboard.js frontend/dist/dashboard.js.map docs/plans/EXEC-shared-header-dropdown-width-contract.md docs/plans/README.md
git commit -m "fix shared header dropdown widths"
```

Expected: one atomic commit on `bugfix/shared-dropdown-width-contract`. Do not push until the required full-suite result and `git log --oneline -5` are reported and the user explicitly confirms.

## Acceptance Criteria

- ENG main Sprint is 136px and ENG main Group/Teams are 200px while closed, empty-open, typed-open, and reopened.
- Each opted-in root, trigger, and panel matches within 1px; long typing does not change outer width.
- The input and caret have positive width, remain inside the toggle, and never overlap.
- Two long same-prefix ENG Sprint options wrap inside the equal-width panel, retain distinguishable suffixes, and create no horizontal overflow.
- Compact ENG Sprint, Group, and Teams remain 24-170px wide and preserve width through opening, typing, Escape, and reopening at supported desktop compact widths 1440 and 1028. At 760/390/375, settled before/after evidence and overflow assertions prove this slice does not worsen the pre-existing narrow compact allocation.
- The main ENG controls render on one row without clipping at 1091x800 and 1440x900. Existing wrapping keeps controls reachable with no document overflow at 1028, 768, 761, 760, 390, and 375 CSS pixels.
- Every exclusion guard first proves its real consumer is rendered; EPM header Sprint, EPM Project/Sort/Sub-goal, Statistics ranges, ENG sort menus, Board detail sort, and Excluded Capacity never receive the semantic class.
- Compact, mobile, Statistics, EPM, Catch Up, Board, and generated frontend layouts pass the named regression checks.
- Existing interactions and analytics are unchanged; the passive no-event decision is documented.
- Settled before/after screenshots cover typed-open, reopened, desktop compact-open, narrow compact non-regression, mobile main-dropdown/open wrapping, and EPM regression states; images live under ignored `tmp/` or the existing EPM QA path, are reviewed, and are not committed.

## Review Notes

- Three design reviews rejected the original `nowrap` rule as physically unsafe, identified the shared EPM Sprint renderer as a scope leak, and rejected a new dropdown abstraction as UI creep. The plan keeps responsive wrapping, opts in ENG only, and uses one additive semantic CSS contract.
- First-pass plan validation required an immediate pre-GREEN build, positive-presence scope locks, two long same-prefix Sprint fixtures, panel edge/hit ownership checks, non-collapse thresholds, explicit 375px coverage, correctly timed screenshots, and replacement of the existing compact single-line test. Those corrections are incorporated above.
- Read-only Chromium validation showed the existing compact outer flex row already collapses Sprint/Team at 760/390/375 because the Group wrapper, fixed mode control, and 150px-minimum search own the available space. This plan proves the open compact contract at 1028/1440 and uses before/after non-regression evidence at narrower widths; redesigning that outer allocation is deliberately not smuggled into a dropdown-width fix.
- Exact panel width reduces single-line Sprint readability. Scoped multiline option wrapping is therefore part of the approved contract; removing it requires renewed design approval.
- The predecessor filterable-header plan is implemented in current source but remains named `EXEC-*`. Correcting it to `DONE-*` is separate plan hygiene because repository instructions require approval before moving that file.
