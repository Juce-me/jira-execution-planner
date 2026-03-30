# Planning Module Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist planning selections per sprint and group, restore them safely after refresh, add the missing planning bulk actions, keep dropdowns above sticky elements, and compact the sticky planning panel so it is usable on limited-height screens.

**Architecture:** Extract planner-scope persistence and reconciliation into a small frontend helper so the React dashboard can restore browser-only state from stable identifiers instead of stale task snapshots. Then wire the dashboard to that helper, extend the planning action row with the new status toggles, and tighten the CSS stack and planning-panel layout while preserving the existing sticky-order contract.

**Tech Stack:** React 19, bundled dashboard JSX, static CSS in `frontend/dist/dashboard.css`, Node `node:test` frontend utility coverage, Python `unittest` asset coverage.

---

### Task 1: Lock the planning-scope persistence contract in tests

**Files:**
- Create: `frontend/src/planningSelectionState.mjs`
- Create: `tests/test_planning_selection_state.js`

**Step 1: Write the failing test**

Add Node tests for a new planning-state helper module that lock these rules:

```javascript
assert.equal(
    buildPlanningScopeKey({ sprintId: '2026Q2', groupId: 'group-alpha' }),
    'planning::2026Q2::group-alpha'
);

assert.deepEqual(
    reconcilePlanningSelection({
        selectedTaskKeys: ['A-1', 'A-2'],
        selectedTeamId: 'team-a'
    }, {
        validTaskKeys: new Set(['A-2', 'A-3']),
        validTeamIds: new Set(['team-b'])
    }),
    {
        selectedTaskKeys: ['A-2'],
        selectedTeamId: 'all'
    }
);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/test_planning_selection_state.js`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Create `frontend/src/planningSelectionState.mjs` with small pure helpers for:
- building the scope key from sprint and group
- normalizing stored planning state
- reconciling stored selected task keys against a refreshed valid-task set
- validating the stored selected team against refreshed available teams

**Step 4: Run test to verify it passes**

Run: `node --test tests/test_planning_selection_state.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/planningSelectionState.mjs tests/test_planning_selection_state.js
git commit -m "test: lock planning selection scope rules"
```

### Task 2: Move planning persistence onto scoped browser storage

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/planningSelectionState.mjs`
- Test: `tests/test_planning_selection_state.js`
- Test: `tests/test_team_selection_utils.js`

**Step 1: Write the failing test**

Extend `tests/test_planning_selection_state.js` to cover refresh-safe hydration:

```javascript
assert.deepEqual(
    hydratePlanningState({
        storedState: {
            selectedTaskKeys: ['A-1', 'A-2'],
            selectedTeamId: 'team-a'
        },
        sprintId: '2026Q2',
        groupId: 'group-alpha',
        validTaskKeys: new Set(['A-2']),
        validTeamIds: new Set(['team-a'])
    }),
    {
        selectedTaskKeys: ['A-2'],
        selectedTeamId: 'team-a'
    }
);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/test_planning_selection_state.js`
Expected: FAIL because dashboard hydration helpers do not yet support scoped restore and reconciliation.

**Step 3: Write minimal implementation**

In `frontend/src/dashboard.jsx`:
- replace the current per-group selected-task cookie flow for planning state
- restore planner state from browser storage using `selectedSprint + activeGroupId`
- save planner state back whenever selected planning tasks or the planning-selected team changes
- reconcile restored task keys against the refreshed planning dataset
- reset invalid saved team ids back to `all`

Keep the existing global dashboard team preference behavior outside the planner-specific scoped state.

**Step 4: Run test to verify it passes**

Run:
- `node --test tests/test_planning_selection_state.js`
- `node --test tests/test_team_selection_utils.js`

Expected:
- scoped planning-state tests pass
- team selection utility tests still pass

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/planningSelectionState.mjs tests/test_planning_selection_state.js tests/test_team_selection_utils.js
git commit -m "feat: scope planning selections by sprint and group"
```

### Task 3: Add postponed and awaiting-validation bulk actions

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Create: `tests/test_planning_action_source_guards.js`

**Step 1: Write the failing test**

Add a lightweight source-guard test that asserts the planner JSX now includes the new action labels and their normalized status matches:

```javascript
assert.match(source, /Include Postponed/);
assert.match(source, /Include Awaiting Validation/);
assert.match(source, /status === 'postponed'/);
assert.match(source, /status === 'awaiting validation'/);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/test_planning_action_source_guards.js`
Expected: FAIL because the new buttons and status wiring do not exist yet.

**Step 3: Write minimal implementation**

In `frontend/src/dashboard.jsx`:
- add derived task lists for `postponed` and `awaiting validation`
- add active-state checks for both bulk buttons
- render the two new buttons in the planning action row
- keep the existing batch-toggle semantics used by the accepted and todo buttons

**Step 4: Run test to verify it passes**

Run: `node --test tests/test_planning_action_source_guards.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_planning_action_source_guards.js
git commit -m "feat: add planning bulk actions for postponed and awaiting validation"
```

### Task 4: Raise planner dropdown overlays above sticky layers

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

Extend the CSS extraction test with assertions for a shared control-overlay layer, for example:

```python
self.assertIn('--sticky-control-overlay-z', css)
self.assertIn('.team-dropdown-panel', css)
self.assertIn('.sprint-dropdown-panel', css)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: FAIL because the shared overlay layer is not defined yet.

**Step 3: Write minimal implementation**

In `frontend/dist/dashboard.css`:
- define one shared z-layer for planner control overlays above sticky panels
- apply it to sprint, group, and team dropdown panels

In `frontend/src/dashboard.jsx`:
- keep the current control structure
- only adjust whatever class or container wiring is needed so both main-header and compact-header dropdowns use the same overlay rules

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css tests/test_dashboard_css_extraction.py
git commit -m "fix: lift planner dropdowns above sticky layers"
```

### Task 5: Compact the planning panel and remove bar footers

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

Add a CSS asset assertion for the compacted planning hooks that will replace the footer-heavy layout, for example:

```python
self.assertIn('.planning-actions', css)
self.assertIn('.team-stats-grid', css)
self.assertNotIn('.capacity-bar-footer', rendered_markup_contract)
```

If a negative markup assertion is awkward in the current Python test, capture the manual failure condition in the task notes instead:
- planning panel still consumes too much vertical space
- capacity/project bars still render footer rows
- team cards remain oversized on limited-height screens

**Step 2: Run test to verify it fails**

Run:
- `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
- manual browser check in Planning mode

Expected: FAIL or remain visually incorrect until the panel is compacted.

**Step 3: Write minimal implementation**

In `frontend/src/dashboard.jsx`:
- remove `.capacity-bar-footer` markup from the capacity bar and project split bar
- keep essential secondary information inline or in existing tooltips

In `frontend/dist/dashboard.css`:
- reduce planning-panel padding and gaps
- reduce bar heights and marker spacing
- reduce team-card spacing and microbar size
- keep the sticky planning panel readable while materially shortening it

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
- manual browser check in Planning mode on a constrained viewport

Expected:
- CSS test passes
- no `capacity-bar-footer` remains in the planning panel markup
- the sticky planning panel is noticeably shorter and still readable

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css tests/test_dashboard_css_extraction.py
git commit -m "style: compact planning panel layout"
```

### Task 6: Build and run full verification

**Files:**
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Test: `tests/test_planning_selection_state.js`
- Test: `tests/test_planning_action_source_guards.js`
- Test: `tests/test_team_selection_utils.js`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

No new test file. Use build and regression commands as the completion gate.

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL if JSX or bundle output is inconsistent with the source changes.

**Step 3: Write minimal implementation**

Build the frontend bundle so the shipped dashboard assets match the source updates.

**Step 4: Run test to verify it passes**

Run:
- `npm run build`
- `node --test tests/test_planning_selection_state.js`
- `node --test tests/test_planning_action_source_guards.js`
- `node --test tests/test_team_selection_utils.js`
- `python3 -m unittest tests.test_dashboard_css_extraction -v`
- `python3 -m unittest discover -s tests`

Expected:
- frontend build passes
- targeted Node tests pass
- CSS extraction test passes
- full Python suite passes

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/planningSelectionState.mjs frontend/dist/dashboard.css frontend/dist/dashboard.js frontend/dist/dashboard.js.map tests/test_planning_selection_state.js tests/test_planning_action_source_guards.js tests/test_dashboard_css_extraction.py
git commit -m "build: ship planning module improvements"
```
