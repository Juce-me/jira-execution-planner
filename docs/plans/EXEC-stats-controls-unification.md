# Stats Controls Unification Implementation Plan

> **Status:** Validated against the current source, existing test contracts, and MRT009/MRT018/MRT020/MRT021 on 2026-07-15. Implementation has not started.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse existing controls to unify the Statistics range selectors (a `Sprint`/`Quarter` heading over `Start`/`End` dropdowns) across Project Track, Mono vs Cross, Excluded Capacity, and Lead Times; make Lead Times Group By a segmented control; and replace the odd Lead Times Capacity dropdown with the two exclusion checkboxes that already exist in Project Track.

**Architecture:** Extract one stats-owned `StatsRangeControl` from the app's existing inline `sprint-dropdown` pattern, then render that component in all four Statistics views. The component composes the existing `ControlField`, `.stats-control-group`, `.controls-label`, `.view-filters`, and `.sprint-dropdown*` contracts; it owns only open/close and keyboard behavior, while `dashboard.jsx` keeps all range state and reconciliation. Reuse `SegmentedControl` unchanged for Group By and reuse the corrected Project Track checkbox markup/classes for Lead Times Capacity; do not create a parallel visual system or modify the load-bearing global Sprint control.

**Tech Stack:** React 19, JavaScript ES modules, esbuild, Node `node:test`, Playwright.

## Global Constraints

- Implement on `improvement/stats-controls-unification` (branched off `bugfix/statistics-colors-capacity-lead-time`). Do not use another worktree.
- Run every node/npm/npx command via `fnm exec --using 20 ...`. Python via `.venv/bin/python`.
- Before Playwright, launch `.venv/bin/python jira_server.py` in a separate terminal and require `curl -fsS http://127.0.0.1:5050/api/test` to succeed. Treat dependency/runtime warnings before the Flask banner as a failed server preflight.
- REUSE existing design elements. `StatsRangeControl.jsx` is an extraction boundary for markup already repeated eight times, not a new visual design: it may use only `ControlField`, `.stats-control-group`, `.controls-label`, `.view-filters`, and `.sprint-dropdown*`. No new dropdown/range CSS class, inline style, color, radius, hover, caret, spacing token, or checkbox style.
- The 3 sprint views (Excluded Capacity, Mono vs Cross, Project Track) share ONE state pair `excludedCapacityStartSprintId`/`excludedCapacityEndSprintId` + `excludedCapacitySprintOptions`; Lead Times uses `cohortStartQuarter`/`cohortEndQuarter` + `cohortQuarterOptions`. Preserve each view's data/refetch/regroup exactly.
- Lead Times Start/End Quarter reconciliation (last-control-wins) and the single debounced cohort refetch MUST be preserved. Group By stays client-side (NOT in the cohort query key / refetch deps).
- The global top SPRINT control (`renderSprintControl`) is OUT of scope — do not modify it (sticky/compact-header, MRT009). Only reuse its markup/classes.
- Project and Assignee selects stay native `<select>` (out of scope).
- New dropdown panels inside stats controls need a positioned `:has(.sprint-dropdown-panel)` z-index lift mirroring `.view-selector:has(.sprint-dropdown-panel)` (`controls.css:150-154`), or the `z-index` is inert and the panel can render under content. Prove the panel is the top hit target and options are clickable with a NORMAL (non-forced) Playwright click.
- Every custom range dropdown must expose a native button trigger with `aria-haspopup="listbox"`, `aria-expanded`, and a unique `aria-controls`; options use `role="option"` + `aria-selected`; Enter/Space/Arrow keys open and move, Escape closes and restores trigger focus, outside pointer/focus closes, and switching Statistics views closes the hidden view's menu.
- The range pair reuses `.view-filters` so Start/End can wrap at narrow widths. A 375 px Playwright viewport must have no document-level horizontal overflow.
- Do not hand-edit `frontend/dist/`; rebuild with `npm run build` and commit generated output in the final task. Keep dist unstaged until then.
- No analytics event added (matches existing uninstrumented cohort filters). Keep the existing `Lead Times capacity cohort filter` No-Event Allowlist row in `docs/README_ANALYTICS.md` (the analytics source guard asserts that phrase) and update its description for the checkboxes.

## File Map

- `frontend/src/stats/StatsRangeControl.jsx` — create the stats-owned range component by extracting the existing `sprint-dropdown` interaction/markup and composing existing control classes; no request, storage, analytics, or range-reconciliation ownership.
- `frontend/src/dashboard.jsx` — import `StatsRangeControl`; replace the 8 native range selectors with 4 component instances; Group By → `SegmentedControl`; Capacity → 2 existing-style checkboxes; remove `cohortCapacityFilter`/`resolveCohortCapacityFilter` + the standalone "Excluded Capacity" toggle; add `cohortExcludeAdHoc`; persistence at 4 sites.
- `frontend/src/cohort/cohortUtils.js` — `filterCohortIssues`: drop the inclusive `capacityType` filter, add `excludeAdHoc`.
- `frontend/src/styles/stats/shell.css` — add only the positioned open-panel z-index lift; range layout reuses `.view-filters` with no new class.
- `frontend/src/styles/stats/project-track.css` — broaden only the existing `.project-track-exclusions` group selector so Lead Times reuses the already-corrected checkbox layout.
- `tests/test_stats_utils.js` — `filterCohortIssues` `excludeAdHoc` behavior.
- `tests/test_stats_module_extraction_source_guards.js` — source guard for `cohortExcludeAdHoc` persistence sites.
- `tests/test_stats_controls_source_guards.js` — guard the shared-component boundary, existing-class reuse, four call sites, global Sprint non-migration, and absence of native Start/End range selects.
- `tests/test_analytics_source_guards.js` — rewrite the Lead Times Capacity guard (`:132-152`) for the checkbox markup.
- `tests/ui/codebase_structure_smoke.spec.js` — rewrite the range/Group By/Capacity control locators (they assume native `<select>`).
- `docs/README_ANALYTICS.md` — update the existing Lead Times capacity no-event row.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css` — generated output (final task).
- `docs/plans/EXEC-stats-controls-unification.md`, `docs/plans/README.md` — status/index at close.

## Reference: existing pieces (verbatim anchors)

- `ControlField` (`frontend/src/ui/ControlField.jsx`): `<div class="control-field" data-label={label}><span class="control-label">{label}</span>{children}</div>`.
- Sprint dropdown markup: `dashboard.jsx:12378-12446` (`.sprint-dropdown` > `.sprint-dropdown-toggle` [`<span>` value + caret `<svg>`] > `.sprint-dropdown-panel` > `.sprint-dropdown-search` + `.sprint-dropdown-list` > `.sprint-dropdown-option`). Extract the no-search single-select subset; do not change this global control.
- Sprint dropdown outside-click effect: `dashboard.jsx:5227-5237` (document `mousedown`, closes if click outside the ref node).
- `SegmentedControl` (`frontend/src/ui/SegmentedControl.jsx`): props `{ className, ariaLabel, options:[{value,label}], value, onChange }`; used with `className="eng-mode-control"` (Project Track Mode `:13927`).
- Project Track exclusion checkboxes: `dashboard.jsx:13890-13924` (`project-track-checkbox` label + `<input type="checkbox">` + `<span>Exclude Ad Hoc</span>` / `<span>Exclude Excluded Capacity</span>`).
- `.sprint-dropdown*` CSS: `styles/shared/controls.css:271-403`. z-index lift: `controls.css:150-154`. Exclusions CSS: `styles/stats/project-track.css:21-52`.
- The 8 selectors + shared state, and all cohort persistence sites, are enumerated in `docs/plans/SUPPORT-stats-controls-unification-design.md`.

## Route And State Contracts

No endpoint, auth, CSRF, workspace, Jira/Home credential, or mutation contract changes. The only networked path in scope remains existing `POST /api/stats/epic-cohort`: Start/End Quarter still produces one debounced request with a non-inverted pair. Sprint ranges continue to regroup the already-loaded stats source, while Group By and both Capacity exclusions stay client-side and must not add requests.

State-machine verification is mandatory:

| Flow | Required result |
| --- | --- |
| Open by pointer or Enter/Space/ArrowDown | One listbox opens below its trigger; the selected option receives focus. |
| ArrowDown/ArrowUp/Home/End | Focus moves within the current option list without changing data. |
| Enter/Space on an option | Value changes once, menu closes, and focus returns to its trigger. |
| Escape, outside pointer, or focus leaving the range group | Menu closes without changing the value. |
| Statistics view switch | Any menu in the previous hidden view closes and stays closed when returning. |
| Start crosses End / End crosses Start | Lead Times preserves last-control-wins and sends exactly one debounced, never-inverted request. |
| Group By or Capacity checkbox change | Client-side re-slice/regroup only; cohort request count is unchanged. |
| Group-state snapshot/apply and reload | `cohortExcludeAdHoc` and `cohortExcludeCapacity` round-trip; legacy `cohortCapacityFilter` is removed. |
| Narrow viewport | Start/End wrap through existing `.view-filters`; no page-level horizontal overflow. |

---

### Task 1: Extract the existing dropdown pattern into `StatsRangeControl`; pilot on Project Track

**Files:**
- Create: `frontend/src/stats/StatsRangeControl.jsx`
- Modify: `frontend/src/dashboard.jsx` (import near other stats components; replace Project Track Start/End Sprint ~`:13843-13868`)
- Modify: `frontend/src/styles/stats/shell.css`
- Create: `tests/test_stats_controls_source_guards.js`
- Test: `tests/ui/codebase_structure_smoke.spec.js` (Project Track test ~`:1280-1485`)

**Interfaces:**
- Produces: `<StatsRangeControl idPrefix kindLabel options startValue endValue onStartChange onEndChange active />`.
- `options`: `Array<{value: string, label: string}>`; callbacks receive the exact selected `value`.
- Owns: one open end (`null | 'start' | 'end'`), outside/focus/Escape close, roving option focus, and existing dropdown markup/classes.
- Does not own: range ordering, persistence, analytics, requests, or shared sprint/quarter state.

- [x] **Step 0: Record the clean baseline before editing**:

```bash
fnm exec --using 20 node --test tests/test_stats_utils.js tests/test_stats_module_extraction_source_guards.js tests/test_analytics_source_guards.js
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Project Track tab|Excluded Capacity summary"
```

Save settled baseline screenshots for Lead Times, Excluded Capacity, Mono vs Cross, and Project Track under ignored `tmp/stats-controls-unification/before/`. If either focused suite is red, stop and record the exact baseline failure before changing implementation; do not pre-authorize known failures.

```bash
mkdir -p tmp/stats-controls-unification/before
cp /tmp/codebase-structure-qa/statistics-lead-times.png tmp/stats-controls-unification/before/lead-times.png
cp /tmp/codebase-structure-qa/excluded-capacity-share-summary.png tmp/stats-controls-unification/before/excluded-capacity.png
cp /tmp/codebase-structure-qa/statistics-mono-cross.png tmp/stats-controls-unification/before/mono-cross.png
cp /tmp/codebase-structure-qa/statistics-project-track-epic.png tmp/stats-controls-unification/before/project-track.png
```

- [x] **Step 1: Write failing source guards** in `tests/test_stats_controls_source_guards.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dashboard = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');
const rangePath = 'frontend/src/stats/StatsRangeControl.jsx';

test('stats ranges use one stats-owned component and existing control classes', () => {
    assert.equal(fs.existsSync(rangePath), true);
    const source = fs.readFileSync(rangePath, 'utf8');
    ['ControlField', 'stats-control-group', 'controls-label', 'view-filters', 'sprint-dropdown',
        'sprint-dropdown-toggle', 'sprint-dropdown-panel', 'sprint-dropdown-list',
        'sprint-dropdown-option'].forEach((token) => assert.ok(source.includes(token), token));
    assert.equal(source.includes('style={{'), false);
    assert.equal(source.includes("import './"), false);
});

test('dashboard keeps the global Sprint control isolated from stats ranges', () => {
    const globalSprint = dashboard.match(/const renderSprintControl = \(surface\) => \([\s\S]*?const renderGroupControl/)?.[0] || '';
    assert.ok(globalSprint.includes('<ControlField label="Sprint">'));
    assert.equal(globalSprint.includes('StatsRangeControl'), false);
});
```

Run: `fnm exec --using 20 node --test tests/test_stats_controls_source_guards.js`

Expected: FAIL because `StatsRangeControl.jsx` does not exist.

- [x] **Step 2: Create `StatsRangeControl.jsx` using only existing classes**:

```jsx
import * as React from 'react';
import ControlField from '../ui/ControlField.jsx';

const optionIndexFor = (options, value) => options.findIndex(
    (option) => String(option.value) === String(value)
);

export default function StatsRangeControl({
    idPrefix,
    kindLabel,
    options,
    startValue,
    endValue,
    onStartChange,
    onEndChange,
    active = true,
}) {
    const rootRef = React.useRef(null);
    const toggleRefs = React.useRef({ start: null, end: null });
    const [openEnd, setOpenEnd] = React.useState(null);
    const normalizedOptions = Array.isArray(options) ? options : [];

    const close = React.useCallback((focusEnd = null) => {
        setOpenEnd(null);
        if (focusEnd) {
            window.requestAnimationFrame(() => toggleRefs.current[focusEnd]?.focus());
        }
    }, []);

    React.useEffect(() => {
        if (!active) setOpenEnd(null);
    }, [active]);

    React.useEffect(() => {
        if (!openEnd) return undefined;
        const handlePointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpenEnd(null);
        };
        const handleFocusIn = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpenEnd(null);
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(openEnd);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [close, openEnd]);

    React.useEffect(() => {
        if (!openEnd) return undefined;
        const frame = window.requestAnimationFrame(() => {
            const dropdown = rootRef.current?.querySelector(`[data-range-end="${openEnd}"]`);
            const selected = dropdown?.querySelector('[role="option"][aria-selected="true"]');
            const first = dropdown?.querySelector('[role="option"]');
            (selected || first)?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [endValue, normalizedOptions.length, openEnd, startValue]);

    const focusOption = (end, index) => {
        const nodes = rootRef.current?.querySelectorAll(`[data-range-end="${end}"] [role="option"]`) || [];
        nodes[index]?.focus();
    };

    const renderDropdown = (end, value, onChange) => {
        const selectedIndex = optionIndexFor(normalizedOptions, value);
        const selected = normalizedOptions[selectedIndex] || normalizedOptions[0];
        const isOpen = openEnd === end;
        const listboxId = `${idPrefix}-${end}-listbox`;
        const accessibleLabel = `${end === 'start' ? 'Start' : 'End'} ${kindLabel.toLowerCase()}`;
        const choose = (option) => {
            onChange(option.value);
            close(end);
        };
        return (
            <div className="sprint-dropdown" data-range-end={end}>
                <button
                    type="button"
                    ref={(node) => { toggleRefs.current[end] = node; }}
                    className={`sprint-dropdown-toggle ${isOpen ? 'open' : ''}`}
                    aria-label={accessibleLabel}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    disabled={normalizedOptions.length === 0}
                    onClick={() => setOpenEnd(isOpen ? null : end)}
                    onKeyDown={(event) => {
                        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
                            event.preventDefault();
                            setOpenEnd(end);
                        }
                    }}
                >
                    <span>{selected?.label || 'No options'}</span>
                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 9L1 4h10z" />
                    </svg>
                </button>
                {isOpen && normalizedOptions.length > 0 && (
                    <div className="sprint-dropdown-panel">
                        <div id={listboxId} className="sprint-dropdown-list" role="listbox" aria-label={accessibleLabel}>
                            {normalizedOptions.map((option, index) => {
                                const selectedOption = String(option.value) === String(value);
                                return (
                                    <div
                                        key={option.value}
                                        className={`sprint-dropdown-option ${selectedOption ? 'selected' : ''}`}
                                        role="option"
                                        aria-selected={selectedOption}
                                        tabIndex={selectedOption || (selectedIndex < 0 && index === 0) ? 0 : -1}
                                        data-range-value={option.value}
                                        onClick={() => choose(option)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                                event.preventDefault();
                                                const delta = event.key === 'ArrowDown' ? 1 : -1;
                                                focusOption(end, (index + delta + normalizedOptions.length) % normalizedOptions.length);
                                            } else if (event.key === 'Home' || event.key === 'End') {
                                                event.preventDefault();
                                                focusOption(end, event.key === 'Home' ? 0 : normalizedOptions.length - 1);
                                            } else if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                choose(option);
                                            }
                                        }}
                                    >
                                        {option.label}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div ref={rootRef} className="stats-control-group" role="group" aria-label={`${kindLabel} range`} data-stats-range={idPrefix}>
            <div className="controls-label">{kindLabel}</div>
            <div className="view-filters">
                <ControlField label="Start" dataLabel={`Start ${kindLabel}`}>
                    {renderDropdown('start', startValue, onStartChange)}
                </ControlField>
                <ControlField label="End" dataLabel={`End ${kindLabel}`}>
                    {renderDropdown('end', endValue, onEndChange)}
                </ControlField>
            </div>
        </div>
    );
}
```

No search input: the current sprint/quarter option sets are bounded and `.sprint-dropdown-list` already scrolls at 200 px.

- [x] **Step 3: Add the positioned overlay lift** in `frontend/src/styles/stats/shell.css`:

```css
.stats-controls:has(.sprint-dropdown-panel) {
    position: relative;
    z-index: calc(var(--sticky-control-overlay-z) + 2);
}
```

Do not add `stats-range-*` classes. `.view-filters` already supplies flex, gap, width, and wrapping.

- [x] **Step 4: Import and pilot on Project Track**:

```jsx
import StatsRangeControl from './stats/StatsRangeControl.jsx';
```

Replace both Project Track native selects with:

```jsx
<StatsRangeControl
    idPrefix="project-track-sprint"
    kindLabel="Sprint"
    options={excludedCapacitySprintOptions.map((sprint) => ({ value: String(sprint.id), label: sprint.name || String(sprint.id) }))}
    startValue={excludedCapacityStartSprintId}
    endValue={excludedCapacityEndSprintId}
    onStartChange={setExcludedCapacityStartSprintId}
    onEndChange={setExcludedCapacityEndSprintId}
    active={statsView === 'projectTrack'}
/>
```

- [x] **Step 5: Replace the Project Track native-select assertion with interaction, layer, and keyboard checks**:

```js
const rangeGroup = controls.locator('[data-stats-range="project-track-sprint"]');
await expect(rangeGroup).toHaveAttribute('aria-label', 'Sprint range');
await expect(rangeGroup.locator('.controls-label')).toHaveText('Sprint');
const startToggle = rangeGroup.getByRole('button', { name: 'Start sprint' });
await expect(startToggle).toHaveAttribute('aria-haspopup', 'listbox');
await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
await startToggle.click();
await expect(startToggle).toHaveAttribute('aria-expanded', 'true');
const listbox = rangeGroup.getByRole('listbox', { name: 'Start sprint' });
const option = listbox.getByRole('option', { name: selectedSprintName });
const geometry = await option.evaluate((node) => {
    const panel = node.closest('.sprint-dropdown-panel').getBoundingClientRect();
    const toggle = node.closest('.sprint-dropdown').querySelector('.sprint-dropdown-toggle').getBoundingClientRect();
    const point = { x: panel.left + Math.min(12, panel.width / 2), y: panel.top + Math.min(12, panel.height / 2) };
    return {
        opensBelow: panel.top >= toggle.bottom,
        topHitIsPanel: node.closest('.sprint-dropdown-panel').contains(document.elementFromPoint(point.x, point.y)),
    };
});
expect(geometry.opensBelow).toBeTruthy();
expect(geometry.topHitIsPanel).toBeTruthy();
await option.click(); // normal, never force
await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
await expect(startToggle).toBeFocused();
await startToggle.click();
await controls.getByRole('radio', { name: 'Epic' }).focus();
await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
await startToggle.click();
await controls.getByRole('radio', { name: 'Epic' }).click();
await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
await startToggle.press('Enter');
await expect(listbox).toBeVisible();
await listbox.getByRole('option', { name: selectedSprintName }).press('Escape');
await expect(startToggle).toHaveAttribute('aria-expanded', 'false');
await expect(startToggle).toBeFocused();
```

Keep the existing Capacity side, Mode, and exclusion geometry assertions unchanged.

- [x] **Step 6: Run focused verification**:

```bash
fnm exec --using 20 node --test tests/test_stats_controls_source_guards.js
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Project Track tab"
```

Expected: PASS. Keep `frontend/dist/` unstaged.

- [x] **Step 7: Commit**:

```bash
git add frontend/src/stats/StatsRangeControl.jsx frontend/src/dashboard.jsx frontend/src/styles/stats/shell.css tests/test_stats_controls_source_guards.js tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: extract shared statistics range control"
```

### Task 2: Apply `StatsRangeControl` to Excluded Capacity + Mono vs Cross

**Files:**
- Modify: `frontend/src/dashboard.jsx` (Excluded Capacity ~13572-13595; Mono vs Cross ~13729-13752)
- Test: `tests/ui/codebase_structure_smoke.spec.js` (Statistics subviews + Excluded Capacity summary tests)

**Interfaces:** Consumes `StatsRangeControl` (Task 1) + the shared `excludedCapacity*SprintId` state. The two views intentionally continue to share the same values; only one view is active at a time.

- [ ] **Step 1: Convert Excluded Capacity Start/End Sprint** — replace both native selects at `dashboard.jsx:13572-13595`:

```jsx
<StatsRangeControl
    idPrefix="excluded-capacity-sprint"
    kindLabel="Sprint"
    options={excludedCapacitySprintOptions.map((sprint) => ({ value: String(sprint.id), label: sprint.name || String(sprint.id) }))}
    startValue={excludedCapacityStartSprintId}
    endValue={excludedCapacityEndSprintId}
    onStartChange={setExcludedCapacityStartSprintId}
    onEndChange={setExcludedCapacityEndSprintId}
    active={statsView === 'excludedCapacity'}
/>
```

- [ ] **Step 2: Convert Mono vs Cross Start/End Sprint** — replace both native selects at `dashboard.jsx:13729-13752`:

```jsx
<StatsRangeControl
    idPrefix="mono-cross-sprint"
    kindLabel="Sprint"
    options={excludedCapacitySprintOptions.map((sprint) => ({ value: String(sprint.id), label: sprint.name || String(sprint.id) }))}
    startValue={excludedCapacityStartSprintId}
    endValue={excludedCapacityEndSprintId}
    onStartChange={setExcludedCapacityStartSprintId}
    onEndChange={setExcludedCapacityEndSprintId}
    active={statsView === 'monoCrossShare'}
/>
```

- [ ] **Step 3: Extend the source guard**:

```js
test('implemented stats ranges use StatsRangeControl and native non-range selects remain', () => {
    assert.equal((dashboard.match(/<StatsRangeControl/g) || []).length, 3);
    assert.equal(/<label>Start (?:Sprint|Quarter)<\/label>/.test(dashboard), false);
    assert.equal(/<label>End (?:Sprint|Quarter)<\/label>/.test(dashboard), false);
    assert.ok(dashboard.includes('<label>Project</label>'));
    assert.ok(dashboard.includes('<label>Assignee</label>'));
});
```

Task 3 changes the expected call-site count from `3` to `4` when Lead Times is migrated; do not weaken the final assertion.

- [ ] **Step 4: Update Playwright** — in the Statistics subviews and Excluded Capacity summary tests, assert each active view has exactly one range group with the expected `data-stats-range`, Start/End buttons, and no native Start/End `<select>`. Open the End menu in Excluded Capacity, switch to Mono vs Cross, return, and prove `aria-expanded="false"` so hidden-view state does not leak:

```js
const excludedRange = page.locator('[data-stats-range="excluded-capacity-sprint"]');
const excludedEnd = excludedRange.getByRole('button', { name: 'End sprint' });
await excludedEnd.click();
await expect(excludedEnd).toHaveAttribute('aria-expanded', 'true');
await statsTabs.getByRole('radio', { name: 'Mono vs Cross' }).click();
await expect(page.locator('[data-stats-range="mono-cross-sprint"]')).toBeVisible();
await statsTabs.getByRole('radio', { name: 'Excluded Capacity' }).click();
await expect(excludedEnd).toHaveAttribute('aria-expanded', 'false');
```

- [ ] **Step 5: Build + run**

```bash
fnm exec --using 20 node --test tests/test_stats_controls_source_guards.js
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Excluded Capacity summary"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_stats_controls_source_guards.js tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: unify statistics sprint range controls"
```

### Task 3: Lead Times Start/End Quarter via `StatsRangeControl` (preserve reconciliation)

**Files:**
- Modify: `frontend/src/dashboard.jsx:14018-14051`
- Test: `tests/ui/codebase_structure_smoke.spec.js:1190-1256`

**Interfaces:** Consumes `StatsRangeControl`, `cohortStartQuarter/EndQuarter`, `cohortQuarterOptions`, `compareQuarterLabels`. Reconciliation stays in the parent callbacks.

- [ ] **Step 1: Convert Lead Times Start/End Quarter, keeping inline reconciliation** — replace both native quarter selects at `dashboard.jsx:14018-14051` with:

```jsx
<StatsRangeControl
    idPrefix="lead-times-quarter"
    kindLabel="Quarter"
    options={cohortQuarterOptions.map((quarter) => ({ value: quarter, label: quarter }))}
    startValue={cohortStartQuarter}
    endValue={cohortEndQuarter}
    onStartChange={(nextStart) => {
        setCohortStartQuarter(nextStart);
        if (compareQuarterLabels(nextStart, cohortEndQuarter) > 0) setCohortEndQuarter(nextStart);
        setCohortSelectedRow(null);
    }}
    onEndChange={(nextEnd) => {
        setCohortEndQuarter(nextEnd);
        if (compareQuarterLabels(cohortStartQuarter, nextEnd) > 0) setCohortStartQuarter(nextEnd);
        setCohortSelectedRow(null);
    }}
    active={statsView === 'cohort'}
/>
```

- [ ] **Step 2: Raise the source-guard call-site count from 3 to 4** and run `fnm exec --using 20 node --test tests/test_stats_controls_source_guards.js` → PASS.

- [ ] **Step 3: Rewrite the Lead Times quarter locators** in `codebase_structure_smoke.spec.js:1190-1256`. Use accessible names instead of text-bearing ancestor selectors:

```js
const quarterRange = cohortControls.locator('[data-stats-range="lead-times-quarter"]');
const quarterButton = (end) => quarterRange.getByRole('button', { name: `${end} quarter` });
const pickQuarter = async (end, quarter) => {
    const button = quarterButton(end);
    await button.click();
    await quarterRange.getByRole('listbox', { name: `${end} quarter` })
        .getByRole('option', { name: quarter })
        .click();
};
const quarterValue = async (end) => (await quarterButton(end).locator('span').innerText()).trim();
```

Replace `selectOption('2026Q3')` → `pickQuarter('Start', '2026Q3')`, and `toHaveValue('2026Q3')` → `expect(await quarterValue('Start')).toBe('2026Q3')`. Preserve every reconciliation, request-count, never-inverted, persistence, and reload assertion.

- [ ] **Step 4: Add keyboard + responsive proof** after the reconciliation block:

```js
const startQuarterButton = quarterButton('Start');
await startQuarterButton.press('ArrowDown');
const startListbox = quarterRange.getByRole('listbox', { name: 'Start quarter' });
await expect(startListbox).toBeVisible();
const selectedOption = startListbox.locator('[role="option"][aria-selected="true"]');
await expect(selectedOption).toBeFocused();
await selectedOption.press('ArrowDown');
await expect(startListbox.locator('[role="option"]:focus')).toHaveCount(1);
await startListbox.locator('[role="option"]:focus').press('Escape');
await expect(startQuarterButton).toHaveAttribute('aria-expanded', 'false');
await expect(startQuarterButton).toBeFocused();

await page.setViewportSize({ width: 375, height: 760 });
const reflow = await quarterRange.evaluate((node) => ({
    documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    controlsVisible: Array.from(node.querySelectorAll('.sprint-dropdown-toggle')).every((toggle) => {
        const rect = toggle.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
    }),
}));
expect(reflow.documentOverflow).toBeFalsy();
expect(reflow.controlsVisible).toBeTruthy();
await page.setViewportSize({ width: 1280, height: 760 });
```

- [ ] **Step 5: Build + run**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_stats_controls_source_guards.js tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: unify lead times quarter controls"
```

### Task 4: Lead Times Group By → SegmentedControl

**Files:**
- Modify: `frontend/src/dashboard.jsx:14052-14065`
- Test: `tests/ui/codebase_structure_smoke.spec.js:1252-1258`

- [ ] **Step 1: Replace the Group By `<select>` with `SegmentedControl`** — replace `dashboard.jsx:14052-14065` with:

```jsx
<div className="stats-control-group">
    <label>Group By</label>
    <SegmentedControl
        className="eng-mode-control"
        ariaLabel="Group by"
        value={cohortGroupBy}
        onChange={(next) => { setCohortGroupBy(next === 'month' ? 'month' : 'quarter'); setCohortSelectedRow(null); }}
        options={[{ value: 'quarter', label: 'Quarter' }, { value: 'month', label: 'Month' }]}
    />
</div>
```

Group By is already absent from the cohort refetch deps (`:6916`) — do not add it. No refetch.

- [ ] **Step 2: Update the Group By Playwright assertion** — in the no-refetch block (`:1252-1258`):

```js
const groupBy = cohortControls.locator('.stats-control-group', { hasText: 'Group By' }).getByRole('radiogroup');
await expect(groupBy).toHaveClass(/eng-mode-control/);
await expect(groupBy).not.toHaveClass(/stats-view-toggle/);
await groupBy.getByRole('radio', { name: 'Month' }).click();
await groupBy.getByRole('radio', { name: 'Quarter' }).click();
await page.waitForTimeout(400);
expect(callsFor(calls, '/api/stats/epic-cohort', 'POST').length).toBe(cohortRequestCountAfterReload);
const groupByLayout = await groupBy.evaluate((node) => ({
    flexWrap: getComputedStyle(node).flexWrap,
    height: Math.round(node.getBoundingClientRect().height),
    buttonTops: Array.from(node.querySelectorAll('.segmented-control-button')).map((button) => Math.round(button.getBoundingClientRect().top)),
}));
expect(groupByLayout.flexWrap).toBe('nowrap');
expect(groupByLayout.height).toBeLessThanOrEqual(42);
expect(new Set(groupByLayout.buttonTops).size).toBe(1);
```

Do not add a Lead-Times-local `SegmentedControl` layout override; MRT021 makes the existing component plus `eng-mode-control` the complete visual contract.

- [ ] **Step 3: Build + run**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: make lead times group by a segmented control"
```

### Task 5: Lead Times Capacity → two exclusion checkboxes

**Files:**
- Modify: `frontend/src/cohort/cohortUtils.js:133-167`
- Modify: `frontend/src/dashboard.jsx` (state `:684,701`; Capacity dropdown `:14098-14111`; standalone toggle `:14114-14124`; filter memo `:6930-6938`; persistence `:4665-4671,4768-4774,4983-4989,4876-4882,5350-5357,5406-5413`)
- Modify: `frontend/src/styles/stats/project-track.css:21-52`
- Test: `tests/test_stats_utils.js:107-150`
- Test: `tests/test_stats_module_extraction_source_guards.js:153-194`
- Test: `tests/test_analytics_source_guards.js:132-152`
- Test: `tests/ui/codebase_structure_smoke.spec.js` (new focused Lead Times capacity-exclusions test)
- Modify: `docs/README_ANALYTICS.md`

**Interfaces:** `filterCohortIssues` accepts `excludeAdHoc: boolean`, drops the inclusive `capacityType` selector. `cohortExcludeAdHoc` defaults false; `cohortExcludeCapacity` keeps its existing default true and key. A saved legacy `cohortCapacityFilter: 'ad_hoc'` does not map to the inverse exclusion control; it resets to `cohortExcludeAdHoc: false`, then disappears on the next preference save.

- [ ] **Step 1: Failing `filterCohortIssues` test** — replace the ad-hoc-narrowing test in `tests/test_stats_utils.js:107-122` with:

```js
test('filterCohortIssues drops ad_hoc records only when excludeAdHoc is set', async () => {
    const { filterCohortIssues } = await import('../frontend/src/cohort/cohortUtils.js');
    const issues = [
        { key: 'EPIC-1', status: 'open', capacityType: 'ad_hoc' },
        { key: 'EPIC-2', status: 'open', capacityType: 'product' },
        { key: 'EPIC-3', status: 'open' },
    ];
    assert.equal(filterCohortIssues(issues).length, 3);
    assert.equal(filterCohortIssues(issues, { excludeAdHoc: false }).length, 3);
    assert.deepEqual(filterCohortIssues(issues, { excludeAdHoc: true }).map((i) => i.key), ['EPIC-2', 'EPIC-3']);
});
```

Update the `:124-150` test to exercise `excludeAdHoc` (ad_hoc epic dropped under `excludeAdHoc:true`, present otherwise) instead of the removed `capacityType` narrowing.

- [ ] **Step 2: Run — verify fail:** `fnm exec --using 20 node --test tests/test_stats_utils.js` → FAIL.

- [ ] **Step 3: Update `filterCohortIssues`** — in `cohort/cohortUtils.js` replace `const capacityFilter = String(filters.capacityType || 'all');` with `const excludeAdHoc = Boolean(filters.excludeAdHoc);` and replace the capacity clause with:

```js
        if (excludeAdHoc && String(issue?.capacityType || '') === 'ad_hoc') {
            return false;
        }
```

- [ ] **Step 4: Run — verify pass:** `fnm exec --using 20 node --test tests/test_stats_utils.js` → PASS.

- [ ] **Step 5: State + explicit legacy behavior** — in `dashboard.jsx` delete `resolveCohortCapacityFilter` (`:684`) and `cohortCapacityFilter` useState (`:701`); add after `:702`:

```jsx
const [cohortExcludeAdHoc, setCohortExcludeAdHoc] = useState(Boolean(savedPrefsRef.current.cohortExcludeAdHoc));
```

- [ ] **Step 6: Replace the Capacity dropdown with two checkboxes** — replace `dashboard.jsx:14098-14111` with:

```jsx
<div className="stats-control-group project-track-exclusions" data-stats-capacity-filters>
    <label>Capacity</label>
    <label className="project-track-checkbox">
        <input type="checkbox" checked={cohortExcludeAdHoc}
            onChange={(e) => { setCohortExcludeAdHoc(e.target.checked); setCohortSelectedRow(null); }} />
        <span>Exclude Ad Hoc</span>
    </label>
    <label className="project-track-checkbox">
        <input type="checkbox" checked={cohortExcludeCapacity}
            onChange={(e) => { setCohortExcludeCapacity(e.target.checked); setCohortSelectedRow(null); }} />
        <span>Exclude Excluded Capacity</span>
    </label>
</div>
```

- [ ] **Step 7: Remove the standalone "Excluded Capacity" toggle button** at `dashboard.jsx:14114-14124`; keep the `cohortStatusControls.map(...)` status toggles.

- [ ] **Step 8: Update the filter memo** at `:6930-6938`:

```jsx
const cohortFilteredIssues = React.useMemo(() => {
    return filterCohortIssues(cohortIssues, {
        projectKey: cohortProjectFilter,
        assigneeKey: cohortAssigneeFilter,
        excludeAdHoc: cohortExcludeAdHoc,
        excludeEpicKeys: cohortExcludeCapacity ? excludedEpicSet : EMPTY_ARRAY,
        statusToggles: cohortStatusToggles
    });
}, [cohortIssues, cohortProjectFilter, cohortAssigneeFilter, cohortExcludeAdHoc, cohortExcludeCapacity, cohortStatusToggles, excludedEpicSet]);
```

- [ ] **Step 9: Persistence** — at all four state-transfer sites (`buildDefaultGroupState:4670`, `buildGroupStateSnapshot` payload `:4773` + memo deps `:4988`, `applyGroupState:4881`, `saveUiPrefs` payload `:5355` + effect deps `:5411`): remove `cohortCapacityFilter`, add `cohortExcludeAdHoc`. Defaults: `buildDefaultGroupState` → `cohortExcludeAdHoc: Boolean(savedPrefsRef.current.cohortExcludeAdHoc)`; `applyGroupState` → `setCohortExcludeAdHoc(Boolean(nextState.cohortExcludeAdHoc))`. Leave `cohortExcludeCapacity` at every site. Because `saveUiPrefs` replaces the entire localStorage object, the next save must remove the obsolete legacy key.

- [ ] **Step 10: Reuse the corrected checkbox layout** — in `styles/stats/project-track.css:21`, broaden only `.project-track-controls .stats-control-group.project-track-exclusions` to `.stats-control-group.project-track-exclusions`. Leave every child rule unchanged; do not add a Lead Times override. Re-run Project Track's label-boundary and SegmentedControl geometry assertions because MRT020/MRT021 make sibling-control verification mandatory.

- [ ] **Step 11: Source guard for `cohortExcludeAdHoc`** — in `tests/test_stats_module_extraction_source_guards.js`, add:

```js
test('cohort capacity exclusions replace the legacy inclusive filter at every state site', () => {
    assert.ok(dashboardSource.includes('const [cohortExcludeAdHoc, setCohortExcludeAdHoc]'));
    assert.equal(dashboardSource.includes('cohortCapacityFilter'), false);

    const defaultState = sliceBetween(
        dashboardSource,
        'const buildDefaultGroupState = (groupId) => {',
        'const buildGroupStateSnapshot = () => ('
    );
    const snapshot = sliceBetween(
        dashboardSource,
        'const buildGroupStateSnapshot = () => (',
        'const applyGroupState = (state) => {'
    );
    const applyState = sliceBetween(
        dashboardSource,
        'const applyGroupState = (state) => {',
        'const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), ['
    );
    const snapshotDeps = sliceBetween(
        dashboardSource,
        'const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [',
        ']);'
    );
    const savedPrefs = sliceBetween(dashboardSource, 'saveUiPrefs({', ']);');

    assert.ok(defaultState.includes('cohortExcludeAdHoc: Boolean(savedPrefsRef.current.cohortExcludeAdHoc)'));
    assert.ok(defaultState.includes('cohortExcludeCapacity:'));
    assert.ok(snapshot.includes('cohortExcludeAdHoc,'));
    assert.ok(snapshot.includes('cohortExcludeCapacity,'));
    assert.ok(snapshotDeps.includes('cohortExcludeAdHoc,'));
    assert.ok(snapshotDeps.includes('cohortExcludeCapacity,'));
    assert.ok(applyState.includes('setCohortExcludeAdHoc(Boolean(nextState.cohortExcludeAdHoc))'));
    assert.ok(applyState.includes('setCohortExcludeCapacity(nextState.cohortExcludeCapacity ?? true)'));
    assert.equal((savedPrefs.match(/cohortExcludeAdHoc/g) || []).length >= 2, true);
    assert.equal((savedPrefs.match(/cohortExcludeCapacity/g) || []).length >= 2, true);
});
```

- [ ] **Step 12: Rewrite the analytics guard** in `tests/test_analytics_source_guards.js`:

```js
test('Lead Times capacity exclusions change local state without an app-owned event', () => {
    const source = read('frontend/src/dashboard.jsx');
    const start = source.indexOf('data-stats-capacity-filters');
    const end = source.indexOf('<div className="stats-actions cohort-status-actions">', start);
    assert.ok(start >= 0 && end > start, 'Expected the Lead Times capacity checkbox block');
    const capacityControls = source.slice(start, end);
    assert.ok(capacityControls.includes('setCohortExcludeAdHoc'));
    assert.ok(capacityControls.includes('setCohortExcludeCapacity'));
    assert.ok(capacityControls.includes('Exclude Ad Hoc'));
    assert.ok(capacityControls.includes('Exclude Excluded Capacity'));
    assert.equal(capacityControls.includes('setCohortCapacityFilter'), false);
    assert.equal(/trackFilterChanged|trackStatsAnalyticsAction|trackEvent/.test(capacityControls), false);
    assert.ok(read('docs/README_ANALYTICS.md').includes('Lead Times capacity cohort filter'));
});
```

Do not regex against a closing `</select>` that no longer exists.

- [ ] **Step 13: Analytics doc** — replace the existing row (do not add a second row):

```markdown
| Lead Times capacity cohort filter | `frontend/src/dashboard.jsx`, `frontend/src/cohort/cohortUtils.js` | The existing uninstrumented local-only Capacity filter is expressed as `Exclude Ad Hoc` and `Exclude Excluded Capacity` checkboxes. Both only re-slice already-fetched issues, add no request or data contract, and send no epic keys, summaries, team names, or other user data; this preserves the existing no-event decision. | 2026-07-15 |
```

Do not claim there is "no new user action"; the defensible reason is continuity with the existing no-event decision and zero new data/refetch/PII contract.

- [ ] **Step 14: Add a browser-state test for semantics, no-refetch, migration, and reload**:

```js
test('Lead Times capacity exclusions re-slice locally and replace the legacy inclusive filter', async ({ page }) => {
    const calls = [];
    const issues = [
        { ...makeOpenCohortEpic(1), key: 'ADHOC-1', summary: 'Ad Hoc epic', capacityType: 'ad_hoc' },
        { ...makeOpenCohortEpic(2), key: 'BAU-EPIC', summary: 'Excluded capacity epic' },
        { ...makeOpenCohortEpic(3), key: 'PRODUCT-1', summary: 'Product epic', capacityType: 'product' },
    ];
    const apiMocks = await installApiMocks(page, calls, { cohortIssues: issues, excludedCapacityEpics: ['BAU-EPIC'] });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng', selectedSprint: selectedSprintId, sprintName: selectedSprintName,
        activeGroupId: 'grp-default', selectedTeams: ['all'], showStats: true, statsView: 'cohort',
        cohortStartQuarter: '2026Q1', cohortEndQuarter: '2026Q1', cohortCapacityFilter: 'ad_hoc',
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await waitForCallCount(calls, (call) => call.pathname === '/api/stats/epic-cohort', 1);
    const view = page.locator('.stats-view.open');
    const excludeAdHoc = view.getByRole('checkbox', { name: 'Exclude Ad Hoc' });
    const excludeExcluded = view.getByRole('checkbox', { name: 'Exclude Excluded Capacity' });
    await expect(excludeAdHoc).not.toBeChecked();
    await expect(excludeExcluded).toBeChecked();
    await expect(view.getByText('ADHOC-1', { exact: true })).toBeVisible();
    await expect(view.getByText('BAU-EPIC', { exact: true })).toHaveCount(0);
    const requestCount = callsFor(calls, '/api/stats/epic-cohort', 'POST').length;
    await excludeAdHoc.check();
    await expect(view.getByText('ADHOC-1', { exact: true })).toHaveCount(0);
    await excludeExcluded.uncheck();
    await expect(view.getByText('BAU-EPIC', { exact: true })).toBeVisible();
    expect(callsFor(calls, '/api/stats/epic-cohort', 'POST').length).toBe(requestCount);
    await expect.poll(() => page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}');
        return {
            excludeAdHoc: stored.cohortExcludeAdHoc,
            excludeCapacity: stored.cohortExcludeCapacity,
            hasLegacyKey: Object.prototype.hasOwnProperty.call(stored, 'cohortCapacityFilter'),
        };
    })).toEqual({ excludeAdHoc: true, excludeCapacity: false, hasLegacyKey: false });
    const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1') || '{}'));
    expect(saved).not.toHaveProperty('cohortCapacityFilter');
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, saved);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('checkbox', { name: 'Exclude Ad Hoc' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Exclude Excluded Capacity' })).not.toBeChecked();
    expect(apiMocks.unexpectedCalls).toEqual([]);
});
```

- [ ] **Step 15: Run focused tests + build**

```bash
fnm exec --using 20 node --test tests/test_stats_utils.js tests/test_stats_module_extraction_source_guards.js tests/test_analytics_source_guards.js tests/test_stats_controls_source_guards.js
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Lead Times capacity exclusions|Project Track tab"
```

- [ ] **Step 16: Commit**

```bash
git add frontend/src/cohort/cohortUtils.js frontend/src/dashboard.jsx frontend/src/styles/stats/project-track.css tests/test_stats_utils.js tests/test_stats_module_extraction_source_guards.js tests/test_analytics_source_guards.js tests/ui/codebase_structure_smoke.spec.js docs/README_ANALYTICS.md
git commit -m "fix: replace lead times capacity dropdown with exclusion checkboxes"
```

### Task 6: Build, regress, compare visuals, commit dist and plan status

**Files:**
- Modify generated: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`
- Modify at close: `docs/plans/EXEC-stats-controls-unification.md`, `docs/plans/README.md`

- [ ] **Step 1: Build:** `fnm exec --using 20 npm run build`

- [ ] **Step 2: Budget canary:** `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`. Do not raise the `dashboard.jsx` budget: extracting `StatsRangeControl` should keep or reduce dashboard ownership. If it grows, simplify or move duplicated range composition into the component.

- [ ] **Step 3: Full regression**

```bash
fnm exec --using 20 npm run test:frontend:unit
.venv/bin/python -m unittest discover -s tests
fnm exec --using 20 npm run test:frontend:ui
```

Expected: all three commands green. Do not normalize or waive a red test as "pre-existing" unless Task 1 Step 0 reproduced and recorded that exact failure before implementation; even then, the touched Statistics suites must be green.

- [ ] **Step 4: Settled before/after visual verification** — save after screenshots under ignored `tmp/stats-controls-unification/after/`, open every before/after pair, and inspect the actual text-bearing controls (not only container boxes):

```text
Project Track / Mono vs Cross / Excluded Capacity: existing typography, spacing, radii, caret, and control height preserved; "SPRINT" groups Start/End; Project Track Capacity side / Mode / Exclusions are visually unchanged.
Lead Times: "QUARTER" groups Start/End; Group By is the existing fixed-height single-row segmented control; Capacity is the corrected existing checkbox treatment; no leftover Capacity dropdown or standalone "Excluded Capacity" button.
Desktop and 375 px: no clipped labels, sibling overlap, page-level horizontal overflow, or dropdown panel clipping. Panels open below their triggers and above content.
```

Screenshots are evidence only after they have been opened and inspected; MRT020/MRT021 prohibit treating green container geometry as visual proof.

```bash
mkdir -p tmp/stats-controls-unification/after
cp /tmp/codebase-structure-qa/statistics-lead-times.png tmp/stats-controls-unification/after/lead-times.png
cp /tmp/codebase-structure-qa/excluded-capacity-share-summary.png tmp/stats-controls-unification/after/excluded-capacity.png
cp /tmp/codebase-structure-qa/statistics-mono-cross.png tmp/stats-controls-unification/after/mono-cross.png
cp /tmp/codebase-structure-qa/statistics-project-track-epic.png tmp/stats-controls-unification/after/project-track.png
```

Open all eight files with the image viewer before accepting the comparison.

- [ ] **Step 5: Repo state:** `git diff --check` && `git status --short`.

- [ ] **Step 6: Commit generated output**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "build: refresh stats controls frontend bundle"
```

Then confirm drift-free: `fnm exec --using 20 npm run build && git status --short` shows no dist change.

- [ ] **Step 7: Status note + index (kept as `EXEC-` pending acceptance/merge)** — add a top `Status:` note naming the execution commits and verified branch, then update the existing `docs/plans/README.md` entry with the same state. Do not claim a merge that has not happened and do not rename to `DONE-` before acceptance/merge.

- [ ] **Step 8: Commit plan/index status and final cleanliness**:

```bash
git add docs/plans/EXEC-stats-controls-unification.md docs/plans/README.md
git commit -m "docs: record stats controls execution"
git diff --check
git status --short
git log --oneline -5
```

Expected: clean worktree, no dist drift, no tracked files under `tmp/`. Wait for explicit user confirmation before push, per repo workflow.
