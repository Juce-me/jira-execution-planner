# Team Selection Persistence And Compact Team Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist team dropdown selection by `group + sprint` and keep the `Selected SP by Team` cards compact for low team counts while forcing `6` teams onto multiple rows.

**Architecture:** Extend the frontend with a small browser-side scoped team-selection cache and reuse existing team sanitization to reconcile invalid values. Update the `Selected SP by Team` rendering logic so compact card height is independent of low team count and the `6`-team case explicitly breaks into multiple rows.

**Tech Stack:** React 19, browser storage, esbuild bundle in `frontend/dist`, Python `unittest`, Node `node:test`

---

### Task 1: Add scoped team-selection cache helpers

**Files:**
- Create: `frontend/src/teamSelectionPersistence.mjs`
- Test: `tests/test_team_selection_persistence.js`

**Step 1: Write the failing test**

Add tests for:
- building a stable scope key from `groupId + sprintId`
- loading a saved team choice for a scope
- reconciling invalid team IDs back to `['all']`

**Step 2: Run test to verify it fails**

Run: `node --test tests/test_team_selection_persistence.js`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Implement helpers for:
- building the scope key
- loading/saving scoped team selection
- reconciling the saved team against valid team IDs

**Step 4: Run test to verify it passes**

Run: `node --test tests/test_team_selection_persistence.js`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/teamSelectionPersistence.mjs tests/test_team_selection_persistence.js
git commit -m "test: add scoped team selection persistence helpers"
```

### Task 2: Hydrate and persist scoped team selection in the dashboard

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Test: `tests/test_team_selection_utils.js`
- Test: `tests/test_planning_action_source_guards.js`

**Step 1: Write the failing test**

Add source-guard or helper tests that assert:
- sprint/group scoped team selection is read on load
- invalid scoped team selections fall back to `All Teams`
- valid scoped selections survive refresh and sprint change

**Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/test_team_selection_utils.js
node --test tests/test_planning_action_source_guards.js
```
Expected: FAIL because the dashboard still relies only on the current global UI state.

**Step 3: Write minimal implementation**

Update `frontend/src/dashboard.jsx` to:
- derive the `group + sprint` scope key
- load the scoped team selection when scope changes
- reconcile it against the available team options
- persist the live selection back into the scoped cache when the dropdown changes
- keep `selectedTeams` as the live React state

**Step 4: Rebuild dist output**

Run: `npm run build`
Expected: `frontend/dist/dashboard.js` and `.map` update successfully.

**Step 5: Run tests to verify they pass**

Run:
```bash
node --test tests/test_team_selection_utils.js
node --test tests/test_planning_action_source_guards.js
```
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map tests/test_team_selection_utils.js tests/test_planning_action_source_guards.js
git commit -m "feat: persist team selection by sprint and group"
```

### Task 3: Tighten low-count team-card layout

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Test: `tests/test_planning_action_source_guards.js`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

Add narrow coverage for:
- compact team-card layout remaining active for low team counts
- `6` selected teams using multi-row rendering

**Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/test_planning_action_source_guards.js
python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssFileContract.test_dashboard_css_includes_compact_sticky_header_contract -v
```
Expected: FAIL until the layout rules are updated.

**Step 3: Write minimal implementation**

Update the `Selected SP by Team` rendering so:
- compact card height does not expand for `1-2` teams
- the `6`-team case uses multiple rows
- existing compact bar/card sizing remains in place

**Step 4: Rebuild dist output**

Run: `npm run build`
Expected: successful bundle rebuild.

**Step 5: Run tests to verify they pass**

Run:
```bash
node --test tests/test_planning_action_source_guards.js
python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssFileContract.test_dashboard_css_includes_compact_sticky_header_contract -v
```
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css frontend/dist/dashboard.js frontend/dist/dashboard.js.map tests/test_planning_action_source_guards.js tests/test_dashboard_css_extraction.py
git commit -m "improvement: compact low-count planning team cards"
```

### Task 4: Final verification and docs touch-up

**Files:**
- Modify: `README.md` if behavior description needs adjustment after implementation

**Step 1: Run full verification**

Run:
```bash
python3 -m unittest discover -s tests
node --test tests/test_team_selection_persistence.js
node --test tests/test_team_selection_utils.js
node --test tests/test_planning_action_source_guards.js
npm run build
```
Expected: all tests pass and build completes.

**Step 2: Update README if needed**

Add or adjust brief wording if the persisted team-selection behavior needs to be documented.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note scoped team selection behavior"
```
