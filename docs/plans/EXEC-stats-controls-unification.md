# Stats Controls Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse existing controls to unify the Statistics range selectors (a `Sprint`/`Quarter` heading over `Start`/`End` dropdowns) across Project Track, Mono vs Cross, Excluded Capacity, and Lead Times; make Lead Times Group By a segmented control; and replace the odd Lead Times Capacity dropdown with the two exclusion checkboxes that already exist in Project Track.

**Architecture:** ASSEMBLE existing elements — do NOT invent a component or new CSS. Reuse `ControlField` (`control-label`), the existing `.sprint-dropdown` markup + `.sprint-dropdown-*` rules, `SegmentedControl`, and Project Track's `project-track-checkbox` exclusions. The ONLY new code is a `dashboard.jsx` render helper mirroring the existing `renderSprintControl`, parameterized by `{options,value,onChange}`, plus one `openRangeDropdown` open-key state with an outside-click listener copied from the sprint dropdown. NO new component file.

**Tech Stack:** React 19, JavaScript ES modules, esbuild, Node `node:test`, Playwright.

## Global Constraints

- Implement on `improvement/stats-controls-unification` (branched off `bugfix/statistics-colors-capacity-lead-time`). Do not use another worktree.
- Run every node/npm/npx command via `fnm exec --using 20 ...`. Python via `.venv/bin/python`.
- REUSE existing design elements. No new component file, no new CSS class, no new visual style. A new class/style for something that already exists is a review-stop.
- The 3 sprint views (Excluded Capacity, Mono vs Cross, Project Track) share ONE state pair `excludedCapacityStartSprintId`/`excludedCapacityEndSprintId` + `excludedCapacitySprintOptions`; Lead Times uses `cohortStartQuarter`/`cohortEndQuarter` + `cohortQuarterOptions`. Preserve each view's data/refetch/regroup exactly.
- Lead Times Start/End Quarter reconciliation (last-control-wins) and the single debounced cohort refetch MUST be preserved. Group By stays client-side (NOT in the cohort query key / refetch deps).
- The global top SPRINT control (`renderSprintControl`) is OUT of scope — do not modify it (sticky/compact-header, MRT009). Only reuse its markup/classes.
- Project and Assignee selects stay native `<select>` (out of scope).
- New dropdown panels inside stats controls need a `:has(.sprint-dropdown-panel)` z-index lift mirroring `.view-selector:has(.sprint-dropdown-panel)` (`controls.css:150-154`), or the panel renders under the content. Prove options are clickable with a NORMAL (non-forced) Playwright click.
- Do not hand-edit `frontend/dist/`; rebuild with `npm run build` and commit generated output in the final task. Keep dist unstaged until then.
- No analytics event added (matches existing uninstrumented cohort filters). Keep the existing `Lead Times capacity cohort filter` No-Event Allowlist row in `docs/README_ANALYTICS.md` (the analytics source guard asserts that phrase) and update its description for the checkboxes.

## File Map

- `frontend/src/dashboard.jsx` — range-dropdown render helper + `openRangeDropdown` state + outside-click; convert the 8 selectors; Group By → `SegmentedControl`; Capacity → 2 checkboxes; remove `cohortCapacityFilter`/`resolveCohortCapacityFilter` + the standalone "Excluded Capacity" toggle; add `cohortExcludeAdHoc`; persistence at 4 sites.
- `frontend/src/cohort/cohortUtils.js` — `filterCohortIssues`: drop the inclusive `capacityType` filter, add `excludeAdHoc`.
- `frontend/src/styles/stats/shell.css` — z-index lift + range-group flex row (reuse tokens; no new visual style).
- `frontend/src/styles/stats/project-track.css` — generalize the `.project-track-exclusions` layout selector so Lead Times reuses it.
- `tests/test_stats_utils.js` — `filterCohortIssues` `excludeAdHoc` behavior.
- `tests/test_stats_module_extraction_source_guards.js` — source guard for `cohortExcludeAdHoc` persistence sites.
- `tests/test_analytics_source_guards.js` — rewrite the Lead Times Capacity guard (`:132-152`) for the checkbox markup.
- `tests/ui/codebase_structure_smoke.spec.js` — rewrite the range/Group By/Capacity control locators (they assume native `<select>`).
- `docs/README_ANALYTICS.md` — update the existing Lead Times capacity no-event row.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` — generated output (final task).
- `docs/plans/EXEC-stats-controls-unification.md`, `docs/plans/README.md` — status/index at close.

## Reference: existing pieces (verbatim anchors)

- `ControlField` (`frontend/src/ui/ControlField.jsx`): `<div class="control-field" data-label={label}><span class="control-label">{label}</span>{children}</div>`.
- Sprint dropdown markup: `dashboard.jsx:12378-12446` (`.sprint-dropdown` > `.sprint-dropdown-toggle` [`<span>` value + caret `<svg>`] > `.sprint-dropdown-panel` > `.sprint-dropdown-search` + `.sprint-dropdown-list` > `.sprint-dropdown-option`).
- Sprint dropdown outside-click effect: `dashboard.jsx:5227-5237` (document `mousedown`, closes if click outside the ref node).
- `SegmentedControl` (`frontend/src/ui/SegmentedControl.jsx`): props `{ className, ariaLabel, options:[{value,label}], value, onChange }`; used with `className="eng-mode-control"` (Project Track Mode `:13927`).
- Project Track exclusion checkboxes: `dashboard.jsx:13890-13924` (`project-track-checkbox` label + `<input type="checkbox">` + `<span>Exclude Ad Hoc</span>` / `<span>Exclude Excluded Capacity</span>`).
- `.sprint-dropdown*` CSS: `styles/shared/controls.css:271-403`. z-index lift: `controls.css:150-154`. Exclusions CSS: `styles/stats/project-track.css:21-52`.
- The 8 selectors + shared state, and all cohort persistence sites, are enumerated in `docs/plans/SUPPORT-stats-controls-unification-design.md`.

---

### Task 1: Range-dropdown render helper + open-state, piloted on Project Track

**Files:**
- Modify: `frontend/src/dashboard.jsx` (add helper near `renderSprintControl` ~12378; `openRangeDropdown` state near `:765`; outside-click effect near `:5227`; convert Project Track Start/End Sprint ~13843-13868)
- Modify: `frontend/src/styles/stats/shell.css`
- Test: `tests/ui/codebase_structure_smoke.spec.js` (Project Track test ~`:1280-1485`)

**Interfaces:**
- Produces: `renderRangeDropdown({ dropdownKey, options, value, onChange, disabled })` → the `.sprint-dropdown` markup bound to `openRangeDropdown`.
- Produces: `openRangeDropdown` state (`null | string`), `rangeDropdownRefs` ref map.
- Consumes: existing `ControlField`, `.sprint-dropdown*` classes.

- [ ] **Step 1: Add open-state + refs** — near `dashboard.jsx:765`:

```jsx
const [openRangeDropdown, setOpenRangeDropdown] = useState(null);
const rangeDropdownRefs = useRef({});
```

- [ ] **Step 2: Add the outside-click effect** — mirror `:5227-5237`:

```jsx
useEffect(() => {
    if (!openRangeDropdown) return undefined;
    const handleClickOutside = (event) => {
        const node = rangeDropdownRefs.current[openRangeDropdown];
        if (node && !node.contains(event.target)) setOpenRangeDropdown(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
}, [openRangeDropdown]);
```

- [ ] **Step 3: Add the render helper (reusing the sprint-dropdown markup)** — beside `renderSprintControl`:

```jsx
const renderRangeDropdown = ({ dropdownKey, options, value, onChange, disabled = false }) => {
    const isOpen = openRangeDropdown === dropdownKey;
    const selected = options.find((opt) => String(opt.value) === String(value));
    return (
        <div className="sprint-dropdown" ref={(node) => { rangeDropdownRefs.current[dropdownKey] = node; }}>
            <div
                className={`sprint-dropdown-toggle ${isOpen ? 'open' : ''}`}
                role="button"
                aria-label="Select value"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                onClick={() => { if (!disabled) setOpenRangeDropdown(isOpen ? null : dropdownKey); }}
                onKeyDown={(event) => {
                    if (disabled) return;
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenRangeDropdown(isOpen ? null : dropdownKey); }
                }}
            >
                <span>{selected ? selected.label : (options[0]?.label || '')}</span>
                <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 9L1 4h10z"/></svg>
            </div>
            {isOpen && (
                <div className="sprint-dropdown-panel">
                    <div className="sprint-dropdown-list">
                        {options.length === 0 ? (
                            <div className="sprint-dropdown-option">No options</div>
                        ) : options.map((opt) => (
                            <div
                                key={opt.value}
                                className={`sprint-dropdown-option ${String(opt.value) === String(value) ? 'selected' : ''}`}
                                data-range-value={opt.value}
                                onClick={() => { onChange(opt.value); setOpenRangeDropdown(null); }}
                            >
                                {opt.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
```

(No search box — quarter/sprint lists are short; `.sprint-dropdown-list` already scrolls at `max-height:200px`.)

- [ ] **Step 4: Convert Project Track Start/End Sprint** — replace `dashboard.jsx:13845-13868` with:

```jsx
<div className="stats-control-group stats-range-group">
    <label>Sprint</label>
    <div className="stats-range-fields">
        <ControlField label="Start">
            {renderRangeDropdown({
                dropdownKey: 'projectTrackStartSprint',
                options: excludedCapacitySprintOptions.map((s) => ({ value: String(s.id), label: s.name || s.id })),
                value: excludedCapacityStartSprintId,
                onChange: (v) => setExcludedCapacityStartSprintId(v),
            })}
        </ControlField>
        <ControlField label="End">
            {renderRangeDropdown({
                dropdownKey: 'projectTrackEndSprint',
                options: excludedCapacitySprintOptions.map((s) => ({ value: String(s.id), label: s.name || s.id })),
                value: excludedCapacityEndSprintId,
                onChange: (v) => setExcludedCapacityEndSprintId(v),
            })}
        </ControlField>
    </div>
</div>
```

- [ ] **Step 5: z-index lift + range-group row** — in `frontend/src/styles/stats/shell.css`:

```css
.stats-range-group .stats-range-fields { display: flex; gap: 0.75rem; }
.stats-controls:has(.sprint-dropdown-panel) { z-index: calc(var(--sticky-control-overlay-z) + 2); }
```

- [ ] **Step 6: Rewrite Project Track Playwright control assertions**

`await expect(controls.locator('select')).toHaveCount(2)` is now wrong. Replace the range-control block with:

```js
const rangeGroup = controls.locator('.stats-range-group');
await expect(rangeGroup.locator('> label')).toHaveText('Sprint');
await expect(rangeGroup.locator('.control-label', { hasText: 'Start' })).toBeVisible();
await expect(rangeGroup.locator('.control-label', { hasText: 'End' })).toBeVisible();
const startToggle = rangeGroup.locator('.control-field', { hasText: 'Start' }).locator('.sprint-dropdown-toggle');
await startToggle.click();
const panel = rangeGroup.locator('.control-field', { hasText: 'Start' }).locator('.sprint-dropdown-panel');
await expect(panel).toBeVisible();
const toggleBox = await startToggle.boundingBox();
const panelBox = await panel.boundingBox();
expect(panelBox.y).toBeGreaterThan(toggleBox.y); // opens DOWN
await panel.locator('.sprint-dropdown-option').first().click(); // NORMAL click, not force
await expect(panel).toBeHidden();
```

Keep the existing `getByRole('radiogroup', { name: 'Capacity side' })` / `'Mode'` and `Exclude Ad Hoc`/`Exclude Excluded Capacity` assertions unchanged.

- [ ] **Step 7: Build + run**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Project Track tab"
```

Expected: PASS. Keep `frontend/dist/` unstaged.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/styles/stats/shell.css tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: reuse sprint dropdown for project track range controls"
```

### Task 2: Apply the range dropdown to Excluded Capacity + Mono vs Cross

**Files:**
- Modify: `frontend/src/dashboard.jsx` (Excluded Capacity ~13572-13595; Mono vs Cross ~13729-13752)
- Test: `tests/ui/codebase_structure_smoke.spec.js` (Statistics subviews + Excluded Capacity summary tests)

**Interfaces:** Consumes `renderRangeDropdown` (Task 1) + the shared `excludedCapacity*SprintId` state.

- [ ] **Step 1: Convert Excluded Capacity Start/End Sprint** — replace `dashboard.jsx:13572-13595` with the Task 1 Step 4 block, `dropdownKey: 'excludedStartSprint'`/`'excludedEndSprint'`, keeping the wrapper classes: `className="stats-control-group stats-range-group excluded-capacity-sprint-control"`.

- [ ] **Step 2: Convert Mono vs Cross Start/End Sprint** — replace `dashboard.jsx:13729-13752` likewise, `dropdownKey: 'monoCrossStartSprint'`/`'monoCrossEndSprint'`.

- [ ] **Step 3: Update Playwright** — in the Statistics subviews (`~:1260-1275`) and Excluded Capacity summary (`~:1563-1601`) tests, if any assertion drives these sprint selects via `select`/`selectOption`, replace with the `.stats-range-group` + `.control-label` pattern from Task 1 Step 6; otherwise confirm they still pass.

- [ ] **Step 4: Build + run**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Excluded Capacity summary"
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: reuse sprint dropdown for excluded capacity and mono cross range controls"
```

### Task 3: Lead Times Start/End Quarter via the range dropdown (preserve reconciliation)

**Files:**
- Modify: `frontend/src/dashboard.jsx:14018-14051`
- Test: `tests/ui/codebase_structure_smoke.spec.js:1190-1256`

**Interfaces:** Consumes `renderRangeDropdown`, `cohortStartQuarter/EndQuarter`, `cohortQuarterOptions`, `compareQuarterLabels`.

- [ ] **Step 1: Convert Lead Times Start/End Quarter, keeping inline reconciliation** — replace `dashboard.jsx:14018-14051` with:

```jsx
<div className="stats-control-group stats-range-group">
    <label>Quarter</label>
    <div className="stats-range-fields">
        <ControlField label="Start">
            {renderRangeDropdown({
                dropdownKey: 'cohortStartQuarter',
                options: cohortQuarterOptions.map((q) => ({ value: q, label: q })),
                value: cohortStartQuarter,
                onChange: (v) => {
                    setCohortStartQuarter(v);
                    if (compareQuarterLabels(v, cohortEndQuarter) > 0) setCohortEndQuarter(v);
                    setCohortSelectedRow(null);
                },
            })}
        </ControlField>
        <ControlField label="End">
            {renderRangeDropdown({
                dropdownKey: 'cohortEndQuarter',
                options: cohortQuarterOptions.map((q) => ({ value: q, label: q })),
                value: cohortEndQuarter,
                onChange: (v) => {
                    setCohortEndQuarter(v);
                    if (compareQuarterLabels(cohortStartQuarter, v) > 0) setCohortStartQuarter(v);
                    setCohortSelectedRow(null);
                },
            })}
        </ControlField>
    </div>
</div>
```

- [ ] **Step 2: Rewrite the Lead Times quarter locators** in `codebase_structure_smoke.spec.js:1190-1256`. Add helpers:

```js
const pickQuarter = async (endLabel, quarter) => {
    const field = cohortControls.locator('.control-field', { hasText: endLabel });
    await field.locator('.sprint-dropdown-toggle').click();
    await field.locator('.sprint-dropdown-option', { hasText: quarter }).click();
};
const quarterValue = async (endLabel) =>
    (await cohortControls.locator('.control-field', { hasText: endLabel }).locator('.sprint-dropdown-toggle span').innerText()).trim();
```

Replace `selectOption('2026Q3')` → `pickQuarter('Start', '2026Q3')`, and `toHaveValue('2026Q3')` → `expect(await quarterValue('Start')).toBe('2026Q3')`. Preserve every reconciliation / one-debounced-request / never-inverted assertion exactly.

- [ ] **Step 3: Build + run**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/codebase_structure_smoke.spec.js
git commit -m "refactor: reuse sprint dropdown for lead times quarter controls"
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
await groupBy.getByRole('radio', { name: 'Month' }).click();
await groupBy.getByRole('radio', { name: 'Quarter' }).click();
await page.waitForTimeout(400);
expect(callsFor(calls, '/api/stats/epic-cohort', 'POST').length).toBe(cohortRequestCountAfterReload);
```

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
- Modify: `docs/README_ANALYTICS.md`

**Interfaces:** `filterCohortIssues` accepts `excludeAdHoc: boolean`, drops `capacityType`. `cohortExcludeAdHoc` state (default false); `cohortExcludeCapacity` kept.

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

- [ ] **Step 5: State** — in `dashboard.jsx` delete `resolveCohortCapacityFilter` (`:684`) and `cohortCapacityFilter` useState (`:701`); add after `:702`:

```jsx
const [cohortExcludeAdHoc, setCohortExcludeAdHoc] = useState(Boolean(savedPrefsRef.current.cohortExcludeAdHoc));
```

- [ ] **Step 6: Replace the Capacity dropdown with two checkboxes** — replace `dashboard.jsx:14098-14111` with:

```jsx
<div className="stats-control-group project-track-exclusions">
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

- [ ] **Step 8: Update the filter memo** at `:6930-6938`: remove `capacityType: cohortCapacityFilter`, add `excludeAdHoc: cohortExcludeAdHoc`; keep `excludeEpicKeys`. Deps: remove `cohortCapacityFilter`, add `cohortExcludeAdHoc`.

- [ ] **Step 9: Persistence** — at all four sites (`buildDefaultGroupState:4670`, `buildGroupStateSnapshot` payload `:4773` + memo deps `:4988`, `applyGroupState:4881`, `saveUiPrefs` payload `:5355` + effect deps `:5411`): remove the `cohortCapacityFilter` line, add `cohortExcludeAdHoc`. Defaults: `buildDefaultGroupState` → `cohortExcludeAdHoc: Boolean(savedPrefsRef.current.cohortExcludeAdHoc)`; `applyGroupState` → `setCohortExcludeAdHoc(Boolean(nextState.cohortExcludeAdHoc))`. Leave `cohortExcludeCapacity` at every site.

- [ ] **Step 10: Generalize the exclusions CSS** — in `styles/stats/project-track.css:21`, broaden the selector so Lead Times reuses the layout, e.g. change `.project-track-controls .stats-control-group.project-track-exclusions {` to `.stats-control-group.project-track-exclusions {` (drop the `.project-track-controls` scope). Verify the Project Track exclusions still render unchanged.

- [ ] **Step 11: Source guard for `cohortExcludeAdHoc`** — in `tests/test_stats_module_extraction_source_guards.js`, add a test mirroring the `cohortEndQuarter` guard (`:153-194`) for `cohortExcludeAdHoc` across all four sites, plus `assert.equal(dashboardSource.includes('cohortCapacityFilter'), false)`.

- [ ] **Step 12: Rewrite the analytics guard** — in `tests/test_analytics_source_guards.js:132-152`, the guard regex-matches `<label>Capacity</label>[\s\S]*?</select>` and asserts `setCohortCapacityFilter` + `value="ad_hoc"/"all"`. Rewrite it to match the new checkbox block (e.g. capture from `<label>Capacity</label>` to the end of the second `project-track-checkbox`), assert it calls `setCohortExcludeAdHoc` and `setCohortExcludeCapacity`, contains no `trackFilterChanged`/`trackStatsAnalyticsAction`/`trackEvent`, and still asserts `analyticsDoc.includes('Lead Times capacity cohort filter')`.

- [ ] **Step 13: Analytics doc** — UPDATE the existing `Lead Times capacity cohort filter` row in `docs/README_ANALYTICS.md` (keep that exact phrase) to describe the dropdown→checkboxes change; do not add a second row.

- [ ] **Step 14: Run focused tests + build**

```bash
fnm exec --using 20 node --test tests/test_stats_utils.js tests/test_stats_module_extraction_source_guards.js tests/test_analytics_source_guards.js
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Lead Times caps"
```

- [ ] **Step 15: Commit**

```bash
git add frontend/src/cohort/cohortUtils.js frontend/src/dashboard.jsx frontend/src/styles/stats/project-track.css tests/test_stats_utils.js tests/test_stats_module_extraction_source_guards.js tests/test_analytics_source_guards.js docs/README_ANALYTICS.md
git commit -m "fix: replace lead times capacity dropdown with exclusion checkboxes"
```

### Task 6: Build, regress, visually verify, commit dist

**Files:**
- Modify generated: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`
- Modify (only if budget changed): `tests/test_codebase_structure_budgets.py`
- Modify at close: `docs/plans/EXEC-stats-controls-unification.md`, `docs/plans/README.md`

- [ ] **Step 1: Build:** `fnm exec --using 20 npm run build`

- [ ] **Step 2: Budget canary:** `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` — if it fails on `frontend/src/dashboard.jsx` growth from this work, ratchet that entry to the exact `wc -l` count with a one-line comment and include the budget file in the final commit; else leave it.

- [ ] **Step 3: Full regression**

```bash
fnm exec --using 20 npm run test:frontend:unit
.venv/bin/python -m unittest discover -s tests
fnm exec --using 20 npm run test:frontend:ui
```

Expected: node + python green; Playwright green except the 2 pre-existing `eng_alerts_panel_summary` failures (unrelated — this branch touches no alert code). Any NEW failure is a regression to fix.

- [ ] **Step 4: Settled visual verification (screenshots)** — READ each stats view; confirm against the reference screenshots:

```text
Project Track / Mono vs Cross / Excluded Capacity: "SPRINT" heading over Start/End dropdowns opening DOWNWARD; CAPACITY SIDE / MODE segmented + EXCLUSIONS checkboxes unchanged.
Lead Times: "QUARTER" heading over Start/End dropdowns; Group By segmented; Capacity = Exclude Ad Hoc + Exclude Excluded Capacity checkboxes; no leftover dropdown or "Excluded Capacity" button.
Panels open downward, above content (not clipped), options clickable with a normal click.
```

Save to `tmp/stats-controls-unification/`.

- [ ] **Step 5: Repo state:** `git diff --check` && `git status --short`.

- [ ] **Step 6: Commit generated output**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "build: refresh stats controls frontend bundle"
```

Then confirm drift-free: `fnm exec --using 20 npm run build && git status --short` shows no dist change.

- [ ] **Step 7: Status note + index (kept as `EXEC-` pending merge)** — add a top `Status:` note naming the execution commits + the merge into `bugfix/statistics-colors-capacity-lead-time`; update the `docs/plans/README.md` entry. Do NOT rename to `DONE-` (kept `EXEC-` until merged to `main`, per repo convention).
