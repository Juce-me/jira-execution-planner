# ENG Catch Up Control Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the ENG Catch Up upper controls so Alerts, Show only, and Display read as one compact, non-redundant control stack.

**Architecture:** Keep Jira data and issue-card rendering unchanged, but deliberately clean up the ENG control contract. Show only becomes the primary filter row. Display remains the secondary inclusion/layout row. Killed work is controlled only by the Display `Killed` toggle, not by a duplicate Show only stat card or `statusFilter === 'killed'` path. CSS changes stay scoped to ENG filter/alert partials and continue to bundle into the single shipped `frontend/dist/dashboard.css`.

**Tech Stack:** React 19, existing ENG JSX, feature-owned CSS partials bundled by esbuild, Playwright UI checks, Node `node:test` source guards.

---

## Problem Diagnosis

The current upper control area has four issues:

1. `alerts-panel-toolbar`, `.filters-strip .stats`, and `.toggle-container` use different sizing and visual weight, so the rows read as unrelated panels.
2. `.filters-strip .stats` uses a desktop `space-between` override, creating large distributed gaps.
3. Killed is redundant: it appears as a Show only `stat-card killed` and as a Display `Killed` toggle.
4. The Display `Killed` toggle is currently not wired from the caller: `EngView` expects `setShowKilled`, but the dashboard only passes `showKilled`.

This plan fixes the layout and the control contract together because a visual cleanup that leaves redundant or broken controls would preserve the underlying UX problem.

---

## Selected Design Direction

Use a three-row unframed stack:

1. **Alerts:** compact notification lane, left-aligned, visually softer than filters. No solid black total alert pill.
2. **Show only:** primary compact filter row with content-aware widths. These controls filter within the currently included task set.
3. **Display:** secondary row for inclusion/layout toggles: Tech, Product, Closed work, Killed work, and Initiatives. These controls define which work categories are included in the list; they do not isolate a status by themselves.

Killed belongs in Display only. There must be no `.stat-card.killed`, no visible `Killed Tasks` stat card label, and no active `statusFilter === 'killed'` state reachable from the UI.

Long labels must be handled intentionally:

- Replace `Total Tasks` with `Total`.
- Replace `Done Tasks` with `Done`.
- Replace `To Do / Pending / Accepted` with `Queued`.
- Keep exact status meaning in `aria-label` and `title` where the visible label is shortened.
- Keep labels readable before making them smaller. Target one line on desktop with the shorter copy, but allow at most two controlled lines when a viewport or localized copy requires it. Do not shrink stat labels below `0.62rem`.

---

## Scope

In scope:

- ENG Catch Up controls and their focused tests.
- Removing Killed from Show only.
- Fixing the Display `Killed` toggle by passing `setShowKilled`.
- Normalizing legacy saved `statusFilter: "killed"` to `showKilled: true` and `statusFilter: null`.
- Compact, content-aware stat-filter layout.
- Generated `frontend/dist` output from `npm run build`.

Out of scope:

- Jira/API data fetching.
- Planning card layout or selection behavior.
- Non-Planning ENG issue-card layout below the controls, except tests that prove it did not regress.
- EPM, Settings preview, Statistics, and Scenario CSS or JSX.
- CSS-in-JS, CSS modules, inline styles, or component CSS imports.

Analytics impact: none. This changes visual layout and existing control wiring only; no new user action is introduced.

---

## File Map

Modify:

- `frontend/src/dashboard.jsx`
  - Normalize saved/restored `statusFilter: "killed"`.
  - Pass `setShowKilled={setShowKilled}` to `EngView`.
  - Remove the `statusFilter !== 'killed'` Killed visibility bypass.
  - Remove the `statusFilter === 'killed'` visible-task branch.
  - Remove no-longer-used `killedTasksCount` / `killedStoryPoints` calculations if they only feed the removed stat card.

- `frontend/src/eng/EngView.jsx`
  - Remove the Show only Killed stat card.
  - Remove unused Killed stat props.
  - Keep the Display `Killed (${killedTasks.length})` toggle.
  - Shorten stat labels and add accessible labels/titles.
  - Use native buttons for stat-card controls if needed to keep controls keyboard-accessible.

- `frontend/src/styles/eng/filters.css`
  - Own the ENG filter stack, labels, row rhythm, and Display toggle sizing.

- `frontend/src/styles/stats/summary.css`
  - Own scoped `.filters-strip` stat-card layout.
  - Replace distributed flex behavior with content-aware grid or equivalent left-aligned layout.

- `frontend/src/styles/eng/alerts.css`
  - Normalize alert toolbar and summary chip sizing/alignment.
  - Soften alert summary total treatment.

- `frontend/src/styles/eng/export.css`
  - If Display toggle active styling remains there, make it visually secondary to Show only.

- `tests/ui/eng_compact_layout_visual.spec.js`
  - Replace old flex/full-row assertions with compact control-stack assertions.
  - Rewrite the closed-sprint Killed test to use the Display toggle only.
  - Add deterministic alert data before measuring alert toolbar geometry.

- `tests/test_epm_view_source_guards.js`
  - Replace old compact-filter guards that require `space-between`.
  - Add source guards for scoped control-stack CSS and no Killed stat-card path.

- `tests/test_task_filter_menu_compaction_source_guards.js`
  - Guard compact labels, the retained Display Killed toggle, and the caller wiring for `setShowKilled`.

- `tests/test_dashboard_alert_source_guards.js`
  - Update alert summary sizing/color guards if Task 4 changes alert toolbar or summary pill dimensions.

- `frontend/dist/*`
  - Generated by `npm run build` only.

Do not modify unless a failing assertion proves it is required:

- `frontend/src/styles/planning.css`
- `frontend/src/styles/planning/*`
- `frontend/src/styles/epm/*`
- `frontend/src/styles/settings/*`
- `frontend/src/styles/scenario/*`
- `frontend/src/eng/PlanningBoard.jsx`

---

## Task 1: Add Failing Guards For The Control Contract

**Files:**

- Modify: `tests/test_task_filter_menu_compaction_source_guards.js`
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `tests/ui/eng_compact_layout_visual.spec.js`

- [ ] **Step 1: Guard that Killed is Display-only**

  In `tests/test_task_filter_menu_compaction_source_guards.js`, keep the existing compact Killed Display label assertion and add these checks:

  ```js
  assert.ok(
      engViewSource.includes('`Killed (${killedTasks.length})`'),
      'Expected compact Killed Display toggle label in EngView.jsx'
  );
  assert.equal(
      engViewSource.includes('stat-card killed'),
      false,
      'Killed must not render as a Show only stat-card'
  );
  assert.equal(
      engViewSource.includes('Killed Tasks'),
      false,
      'Killed must not use a redundant Show only stat label'
  );
  assert.ok(
      dashboardSource.includes('setShowKilled={setShowKilled}'),
      'Expected dashboard to pass setShowKilled into EngView for the Killed Display toggle'
  );
  ```

- [ ] **Step 2: Guard the source filter contract**

  Add a `dashboard.jsx` source guard that rejects the old hidden Killed filter path:

  ```js
  assert.equal(
      dashboardSource.includes("statusFilter !== 'killed'"),
      false,
      'Killed visibility must be controlled only by showKilled'
  );
  assert.equal(
      dashboardSource.includes("if (statusFilter === 'killed')"),
      false,
      'Killed must not be reachable as a Show only statusFilter branch'
  );
  ```

  Keep a separate guard that allows legacy migration checks such as `savedStatusFilter === 'killed'`; do not reject every literal `'killed'`.

- [ ] **Step 3: Replace old compact CSS source guards**

  In `tests/test_epm_view_source_guards.js`, replace the assertions that currently require:

  ```js
  assertRuleIncludes('.filters-strip .stats', 'justify-content: space-between;');
  assertRuleIncludes('.filters-strip .stat-card', 'width: max-content;');
  assertRuleIncludes('.filters-strip .stat-card', 'grid-template-columns: max-content max-content;');
  ```

  with assertions for the new scoped behavior:

  ```js
  assertRuleIncludes('.filters-strip .stats', 'display: grid;');
  assertRuleIncludes('.filters-strip .stats', 'justify-content: start;');
  assertRuleIncludes('.filters-strip .stats', 'width: 100%;');
  assertRuleExcludes('.filters-strip .stats', 'justify-content: space-between;');
  assertRuleIncludes('.filters-strip .stat-card', 'width: auto;');
  assertRuleIncludes('.filters-strip .stat-card', 'inline-size: 100%;');
  assertRuleIncludes('.filters-strip .stat-card', 'max-width: 13rem;');
  assertRuleExcludes('.filters-strip .stat-card', 'width: 100%;');
  assert.equal(
      dashboardCssSource.includes('.stat-card.killed'),
      false,
      'Killed stat-card CSS should be removed with the Killed Show only card'
  );
  ```

  Keep existing EPM `task-list:not(.epm-issue-board)` guards intact.

- [ ] **Step 4: Replace old Playwright flex metrics**

  In `tests/ui/eng_compact_layout_visual.spec.js`, remove expectations that require:

  ```js
  expect(metrics.statsDisplay).toBe('flex');
  expect(metrics.statsFlexWrap).toBe(expectedStatsFlexWrap);
  expect(metrics.cardSpanWidth / metrics.statsWidth).toBeGreaterThanOrEqual(0.98);
  expect(metrics.lastCardRightGap).toBeLessThanOrEqual(1);
  expect(metrics.longLabelLines).toBe(1);
  ```

  Replace them with grid/content-aware checks:

  ```js
  expect(metrics.statsDisplay).toBe('grid');
  expect(metrics.statsColumnGap).toBeLessThanOrEqual(12);
  expect(metrics.maxStatGap).toBeLessThanOrEqual(12);
  expect(metrics.firstCardLeftGap).toBeLessThanOrEqual(1);
  expect(Math.max(...metrics.cardWidths)).toBeLessThanOrEqual(208);
  expect(Math.min(...metrics.cardWidths)).toBeGreaterThanOrEqual(110);
  expect(metrics.filterOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.displayOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.maxLabelLines).toBeLessThanOrEqual(2);
  expect(metrics.maxLabelOverflow).toBeLessThanOrEqual(1);
  ```

  Use `.toggle-container button.toggle`, not `.toggle-container .toggle-btn`.
  Do not assert that the stat-card span reaches the row's right edge. Source guards and width caps prevent full-row tiles; screenshots cover final visual balance.

- [ ] **Step 5: Add deterministic alert data before measuring alert geometry**

  In the compact visual fixture, seed at least one alert category or reuse the deterministic alert fixture pattern from `tests/ui/eng_alerts_panel_summary.spec.js`.

  Before collecting control-stack geometry, require:

  ```js
  await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
  ```

  Also move `screenshotDir` from `/tmp/eng-compact-layout-qa` to the repo-local ignored path:

  ```js
  const screenshotDir = 'test-results/eng-compact-layout-qa';
  ```

- [ ] **Step 6: Rewrite the closed-sprint Killed Playwright test**

  Replace `Killed show-only card isolates killed work in closed sprints` with a test named:

  ```js
  test('Killed Display toggle includes killed work without a Show only card', async ({ page }) => {
  ```

  Required assertions:

  ```js
  await openEngCatchUp(page, { width: 1792, height: 900 }, {
      sprintState: 'closed',
      productTasks: closedSprintProductTasks,
      techTasks: [],
      expectedStatCardCount: 6,
  });

  await expect(page.locator('.filters-strip .stat-card.killed')).toHaveCount(0);

  const killedToggle = page.locator('.toggle-container button.toggle', { hasText: /^Killed \\(1\\)$/ });
  await expect(killedToggle).toBeVisible();
  await expect(killedToggle).not.toHaveClass(/active/);

  const taskList = page.locator('.task-list:not(.epm-issue-board)');
  await expect(taskList).toContainText('Closed sprint done story');
  await expect(taskList).toContainText('Closed sprint stale in progress story');
  await expect(taskList).not.toContainText('Closed sprint killed story');

  await killedToggle.click();

  await expect(killedToggle).toHaveClass(/active/);
  await expect(taskList).toContainText('Closed sprint killed story');
  await expect(taskList).toContainText('Closed sprint done story');
  await expect(taskList).toContainText('Closed sprint stale in progress story');
  ```

- [ ] **Step 7: Add a legacy Killed statusFilter migration test**

  Add a Playwright case that seeds the old persisted state before loading the dashboard:

  ```js
  test('legacy Killed status filter migrates to the Display Killed toggle', async ({ page }) => {
      await openEngCatchUp(page, { width: 1792, height: 900 }, {
          sprintState: 'closed',
          productTasks: closedSprintProductTasks,
          techTasks: [],
          expectedStatCardCount: 6,
          prefs: {
              statusFilter: 'killed',
              showKilled: false,
          },
      });

      await expect(page.locator('.filters-strip .stat-card.killed')).toHaveCount(0);

      const killedToggle = page.locator('.toggle-container button.toggle', { hasText: /^Killed \\(1\\)$/ });
      await expect(killedToggle).toHaveClass(/active/);

      const taskList = page.locator('.task-list:not(.epm-issue-board)');
      await expect(taskList).toContainText('Closed sprint killed story');
      await expect(taskList).toContainText('Closed sprint done story');
      await expect(taskList).toContainText('Closed sprint stale in progress story');

      const prefs = await page.evaluate(() => JSON.parse(window.localStorage.getItem('jira_dashboard_ui_prefs_v1')));
      expect(prefs.statusFilter).toBeNull();
      expect(prefs.showKilled).toBe(true);
  });
  ```

  If `openEngCatchUp` does not yet accept `prefs`, extend the helper to merge the supplied object into its existing preference seed.

- [ ] **Step 8: Run source guards and dist-backed Playwright checks to confirm failures**

  Run source guards:

  ```bash
  node --test tests/test_task_filter_menu_compaction_source_guards.js
  node --test tests/test_epm_view_source_guards.js
  ```

  Expected: FAIL because the implementation still renders `.stat-card.killed`, omits `setShowKilled={setShowKilled}`, and uses old compact layout CSS.

  Build before Playwright because this spec reads `frontend/dist`:

  ```bash
  npm run build
  npx playwright test tests/ui/eng_compact_layout_visual.spec.js
  ```

  Expected: FAIL because the dist still contains the old flex layout, Killed Show only card, and legacy Killed statusFilter behavior.

---

## Task 2: Remove The Redundant Killed Filter Path

**Files:**

- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/EngView.jsx`

- [ ] **Step 1: Normalize legacy saved Killed filter state**

  In `frontend/src/dashboard.jsx`, immediately before the `showKilled` state is initialized, add normalized initial values:

  ```jsx
  const initialSavedStatusFilter = savedPrefsRef.current.statusFilter ?? null;
  const normalizedInitialStatusFilter = initialSavedStatusFilter === 'killed'
      ? null
      : initialSavedStatusFilter;
  const normalizedInitialShowKilled = initialSavedStatusFilter === 'killed'
      ? true
      : (savedPrefsRef.current.showKilled ?? false);
  const [showKilled, setShowKilled] = useState(normalizedInitialShowKilled);
  ```

  Replace the existing line:

  ```jsx
  const [showKilled, setShowKilled] = useState(savedPrefsRef.current.showKilled ?? false);
  ```

  Replace the existing `statusFilter` initializer with:

  ```jsx
  const [statusFilter, setStatusFilter] = useState(normalizedInitialStatusFilter); // null = show all, 'in-progress', 'todo-accepted', 'done', 'high-priority'
  ```

- [ ] **Step 2: Normalize restored group state**

  Wherever group/UI state restores currently do this:

  ```jsx
  setShowKilled(nextState.showKilled ?? false);
  setStatusFilter(nextState.statusFilter ?? null);
  ```

  replace with:

  ```jsx
  const nextStatusFilter = nextState.statusFilter === 'killed'
      ? null
      : (nextState.statusFilter ?? null);
  setShowKilled(nextState.statusFilter === 'killed' ? true : (nextState.showKilled ?? false));
  setStatusFilter(nextStatusFilter);
  ```

- [ ] **Step 3: Pass the Killed setter into EngView**

  In the `EngView` render call in `frontend/src/dashboard.jsx`, pass:

  ```jsx
  setShowKilled={setShowKilled}
  ```

  next to the existing `showKilled={showKilled}` prop.

- [ ] **Step 4: Make `showKilled` the only Killed inclusion flag**

  Replace the old base-filter branch:

  ```jsx
  if (!showKilled && statusFilter !== 'killed' && task.fields.status?.name === 'Killed') {
      return false;
  }
  ```

  with:

  ```jsx
  if (!showKilled && task.fields.status?.name === 'Killed') {
      return false;
  }
  ```

  Remove this visible-task branch entirely:

  ```jsx
  if (statusFilter === 'killed') {
      return task.fields.status?.name === 'Killed';
  }
  ```

- [ ] **Step 5: Remove Killed stat-card props and calculations**

  If `killedTasksCount` and `killedStoryPoints` only feed the removed Show only stat card, delete:

  ```jsx
  const killedTasksCount = killedTasks.length;
  const killedStoryPoints = killedTasks.reduce((sum, task) => {
      const sp = parseFloat(task.fields.customfield_10004 || 0);
      return sum + (Number.isNaN(sp) ? 0 : sp);
  }, 0);
  ```

  and remove these `EngView` props:

  ```jsx
  killedTasksCount={killedTasksCount}
  killedStoryPoints={killedStoryPoints}
  ```

  Also guard that `EngView.jsx` no longer destructures `killedTasksCount` or `killedStoryPoints`.

- [ ] **Step 6: Remove the Show only Killed card**

  In `frontend/src/eng/EngView.jsx`, delete the entire block that starts with:

  ```jsx
  {killedTasksCount > 0 && (
      <div
          className={`stat-card killed ${statusFilter === 'killed' ? 'active' : ''}`}
  ```

  and ends with the matching `)}`.

  Also remove `killedTasksCount` and `killedStoryPoints` from the component props.

- [ ] **Step 7: Run focused source guards**

  ```bash
  node --test tests/test_task_filter_menu_compaction_source_guards.js
  ```

  Expected: PASS for Killed control contract after Task 2.

---

## Task 3: Shorten Labels And Make Controls Semantically Clear

**Files:**

- Modify: `frontend/src/eng/EngView.jsx`
- Modify: `tests/test_task_filter_menu_compaction_source_guards.js`
- Modify: `tests/ui/eng_compact_layout_visual.spec.js`

- [ ] **Step 1: Shorten Show only stat labels**

  In `frontend/src/eng/EngView.jsx`, update visible labels:

  ```jsx
  <span className="stat-label">Total</span>
  <span className="stat-label">Done</span>
  <span className="stat-label">High Priority</span>
  <span className="stat-label">Minor + Lower</span>
  <span className="stat-label">In Progress</span>
  <span className="stat-label">Queued</span>
  ```

  Keep the underlying `statusFilter` keys unchanged except for removing `killed`.

- [ ] **Step 2: Preserve exact meaning with accessible labels**

  If the stat cards remain clickable containers, add `role="button"`, `tabIndex`, `aria-pressed`, and keyboard handlers. Prefer replacing each clickable stat-card `div` with a native button:

  ```jsx
  <button
      type="button"
      className={`stat-card todo-accepted ${statusFilter === 'todo-accepted' ? 'active' : ''} ${todoAcceptedTasksCount === 0 ? 'disabled' : ''}`}
      disabled={todoAcceptedTasksCount === 0}
      aria-pressed={statusFilter === 'todo-accepted'}
      aria-label="Show only To Do, Pending, and Accepted tasks"
      title="To Do, Pending, and Accepted"
      onClick={() => {
          if (todoAcceptedTasksCount === 0) return;
          setStatusFilter(statusFilter === 'todo-accepted' ? null : 'todo-accepted');
      }}
  >
      <span className="stat-value">{todoAcceptedTasksCount}</span>
      <span className="stat-label">Queued</span>
      <span className="stats-note">{todoAcceptedStoryPoints.toFixed(1)} SP</span>
  </button>
  ```

  Apply the same native-button pattern to the other Show only stat cards.

- [ ] **Step 3: Reduce Display row redundancy**

  Keep Display as the secondary row label only while the row also contains the Initiatives layout toggle. If the row later contains inclusion toggles only, rename the row label to `Include`. Make status inclusion semantics clear in visible labels and accessible labels:

  ```jsx
  {`Tech (${techTasksCount})`}
  {`Product (${productTasksCount})`}
  {`Closed work (${doneTasks.length + incompleteTasks.length})`}
  {`Killed (${killedTasks.length})`}
  ```

  Add `aria-label="Include Done and Incomplete tasks"` and `title="Include Done and Incomplete tasks"` to the `Closed work` toggle. Keep the `Killed` toggle label as `Killed (n)` and add `aria-label="Include Killed tasks"`.

  This distinction is required: `Show only > Done` isolates Done work inside the included task set, while `Display > Closed work` controls whether Done/Incomplete work is included at all.

- [ ] **Step 4: Update label source guards**

  In `tests/test_task_filter_menu_compaction_source_guards.js`, update label expectations:

  ```js
  assert.ok(engViewSource.includes('>Total<'), 'Expected compact Total stat label');
  assert.ok(engViewSource.includes('>Done<'), 'Expected compact Done stat label');
  assert.ok(engViewSource.includes('>Queued<'), 'Expected compact Queued stat label');
  assert.ok(
      engViewSource.includes('`Closed work (${doneTasks.length + incompleteTasks.length})`'),
      'Expected compact Closed work Display toggle label'
  );
  assert.ok(
      engViewSource.includes('aria-label="Show only To Do, Pending, and Accepted tasks"'),
      'Expected Queued stat filter to preserve exact status meaning'
  );
  ```

  Remove source expectations for old `Done / Incomplete` and `To Do / Pending / Accepted` visible copy. Add a guard that `EngView.jsx` includes `aria-label="Include Done and Incomplete tasks"` so the Done filter and Closed work inclusion toggle do not read as duplicate controls.

- [ ] **Step 5: Run source guards**

  ```bash
  node --test tests/test_task_filter_menu_compaction_source_guards.js
  ```

  Expected: PASS after label and Killed control changes.

---

## Task 4: Replace Distributed Tiles With A Compact Control Bar

**Files:**

- Modify: `frontend/src/styles/eng/filters.css`
- Modify: `frontend/src/styles/stats/summary.css`
- Modify: `frontend/src/styles/eng/export.css`
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `tests/ui/eng_compact_layout_visual.spec.js`

- [ ] **Step 1: Keep the row stack unframed and aligned**

  In `frontend/src/styles/eng/filters.css`, keep the stack full-width but not card-framed:

  ```css
  .filters-strip {
      margin: 0.45rem 0 0.85rem;
      display: grid;
      gap: 0.55rem;
      width: 100%;
      animation: task-appear 0.18s ease-out both;
  }

  .filters-group {
      display: grid;
      gap: 0.28rem;
      width: 100%;
      animation: none;
  }
  ```

- [ ] **Step 2: Use content-aware stat tracks, not full-width tiles**

  In `frontend/src/styles/stats/summary.css`, replace the `.filters-strip .stats` flex rules and the desktop `space-between` override with:

  ```css
  .filters-strip .stats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(7.4rem, max-content));
      justify-content: start;
      align-items: stretch;
      width: 100%;
      gap: 0.45rem;
  }

  .filters-strip .stat-card {
      min-height: 0;
      width: auto;
      inline-size: 100%;
      min-width: 7.4rem;
      max-width: 13rem;
      padding: 0.34rem 0.55rem;
      border-radius: 8px;
      grid-template-columns: max-content minmax(0, 1fr);
      grid-template-rows: 1fr auto auto 1fr;
      column-gap: 0.5rem;
      row-gap: 0.1rem;
      text-align: center;
      align-items: stretch;
      justify-content: start;
      transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
  }

  .filters-strip .stat-card.todo-accepted {
      min-width: 8.2rem;
  }
  ```

  Do not use `1fr` in the outer `.filters-strip .stats` track definition and do not set `.filters-strip .stat-card { width: 100%; }`. `minmax(0, 1fr)` is acceptable inside a single stat card for the label column because it does not distribute cards across the row.

  Remove the stale Killed stat color rule because Killed no longer renders as a stat card:

  ```css
  .stat-card.killed .stat-value {
      color: #d46b08;
  }
  ```

- [ ] **Step 3: Let labels remain readable**

  Keep labels readable and allow controlled wrapping instead of shrinking text below the readable floor:

  ```css
  .filters-strip .stat-label {
      grid-column: 2;
      grid-row: 2;
      justify-content: center;
      justify-self: stretch;
      text-align: center;
      font-size: 0.62rem;
      letter-spacing: 0;
      line-height: 1.15;
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
  }
  ```

- [ ] **Step 4: Make Display toggles secondary**

  In `frontend/src/styles/eng/export.css` or a more specific ENG filter partial, keep Display toggles compact and visually lighter than Show only:

  ```css
  .toggle-container button.toggle {
      min-height: 2.65rem;
      border-radius: 8px;
      padding: 0.42rem 0.78rem;
  }

  .toggle-container button.toggle.active {
      background: #f4f2ec;
      color: var(--text-primary);
      border-color: #d8d2c5;
      box-shadow: inset 0 0 0 1px rgba(22, 22, 22, 0.05);
  }
  ```

  Keep enough contrast for active states. Do not use the solid black active treatment for Display toggles.

- [ ] **Step 5: Build before dist-backed Playwright**

  ```bash
  npm run build
  node --test tests/test_epm_view_source_guards.js
  npx playwright test tests/ui/eng_compact_layout_visual.spec.js
  ```

  Expected: PASS after Task 4. If Playwright fails, inspect the screenshot before changing thresholds.

---

## Task 5: Align Alerts Without Creating A New Panel

**Files:**

- Modify: `frontend/src/styles/eng/alerts.css`
- Modify: `tests/test_dashboard_alert_source_guards.js`
- Modify: `tests/ui/eng_compact_layout_visual.spec.js`

- [ ] **Step 1: Align alert toolbar rhythm**

  Keep `.alerts-panel-toolbar` left-aligned with the control rows:

  ```css
  .alerts-panel-toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.45rem;
      flex-wrap: wrap;
      margin-bottom: 0.4rem;
      min-width: 0;
  }
  ```

- [ ] **Step 2: Soften alert total**

  Replace the solid black alert total treatment:

  ```css
  .alerts-panel-summary-pill.total {
      background: #f4f2ec;
      border-color: #d8d2c5;
      color: var(--text-primary);
  }
  ```

  Keep category-colored alert pills readable but visually secondary to active Show only filters.

- [ ] **Step 3: Verify collapsed and expanded alert states**

  In `tests/ui/eng_compact_layout_visual.spec.js`, capture both states:

  ```js
  await expect(page.locator('.alerts-panel-toolbar')).toBeVisible();
  await page.locator('.alerts-panel-toggle').click();
  await waitForVisualSettled(page);
  await expect(page.locator('.alert-panels')).toBeHidden();
  await page.locator('.alerts-panel-toggle').click();
  await waitForVisualSettled(page);
  await expect(page.locator('.alert-panels')).toBeVisible();
  ```

  Geometry assertions should apply to the toolbar and filter rows, not to expanded alert detail cards.

- [ ] **Step 4: Run alert guards**

  ```bash
  node --test tests/test_dashboard_alert_source_guards.js
  npm run build
  npx playwright test tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_compact_layout_visual.spec.js
  ```

  Expected: PASS.

---

## Task 6: Verify Scope And Generated Output

**Files:**

- Generated: `frontend/dist/*`

- [ ] **Step 1: Run focused source guards**

  ```bash
  node --test tests/test_task_filter_menu_compaction_source_guards.js
  node --test tests/test_dashboard_alert_source_guards.js
  node --test tests/test_epm_view_source_guards.js
  ```

  Expected: PASS.

- [ ] **Step 2: Build before every dist-backed Playwright run**

  ```bash
  npm run build
  npx playwright test tests/ui/eng_compact_layout_visual.spec.js
  npx playwright test tests/ui/eng_alerts_panel_summary.spec.js
  ```

  Expected: PASS.

- [ ] **Step 3: Run adjacent layout checks**

  ```bash
  npm run build
  npx playwright test tests/ui/eng_story_subtasks.spec.js
  npx playwright test tests/ui/eng_dependency_chip_visual.spec.js
  npx playwright test tests/ui/planning_selection_defaults.spec.js
  ```

  Expected: PASS. These checks guard ENG card rows and Planning behavior that should not change.

- [ ] **Step 4: Review generated output broadly**

  ```bash
  git diff -- frontend/dist
  git status --short frontend/dist
  ```

  Expected:

  - Dist changes correspond to source changes.
  - No local absolute paths, secrets, screenshots, or debug-only output appear.
  - `frontend/dist/dashboard.css` remains the single bundled dashboard stylesheet.

- [ ] **Step 5: Final diff review**

  ```bash
  git diff --check
  git diff --stat
  git diff
  ```

  Confirm:

  - No `.stat-card.killed` render path remains.
  - `Killed (${killedTasks.length})` remains as a Display toggle.
  - `setShowKilled={setShowKilled}` is passed to `EngView`.
  - No `.filters-strip .stats` rule uses `justify-content: space-between`.
  - No `1fr` full-row stat grid or `.filters-strip .stat-card { width: 100%; }` was introduced.
  - No Planning, EPM, Settings preview, Statistics, or Scenario selectors were edited.

- [ ] **Step 6: Run full pre-push suite if feasible**

  ```bash
  python3 -m unittest discover -s tests
  ```

  Expected: PASS. If runtime/dependency setup blocks this command, document the blocker and the focused verification already completed.

- [ ] **Step 7: Commit implementation and generated dist output**

  Suggested commit message:

  ```text
  Unify ENG catch up controls

  Remove the duplicate Killed Show only filter, fix the Display Killed
  toggle wiring, and align the ENG alert, filter, and display controls
  as one compact stack with generated frontend output in sync.
  ```

---

## Acceptance Criteria

- Alerts, Show only, and Display read as one aligned ENG control stack.
- Show only stat filters are compact, content-aware, and left-aligned; they do not stretch into distributed tiles.
- Killed is not present in Show only and never renders as `.stat-card.killed`.
- Display `Killed (n)` is the only Killed control and it works because `setShowKilled` is passed to `EngView`.
- Legacy saved `statusFilter: "killed"` is normalized to visible killed work without leaving an invisible active filter.
- Long stat labels are shortened, with exact meanings preserved in accessible labels/titles.
- Display controls are visually secondary and not redundant with Show only.
- Existing filter/toggle behavior is unchanged except for the intentional Killed cleanup.
- Planning cards, non-Planning ENG cards, EPM, Settings preview, Statistics, and Scenario layouts are not modified.
- Dist-backed Playwright checks run only after `npm run build`.
- `frontend/dist/dashboard.css` remains the single bundled dashboard stylesheet.
