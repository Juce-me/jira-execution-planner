# Compact Sticky Header Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a compact sticky header that replaces the main header controls after scroll, stays single-line, and preserves the existing sticky ordering across Catch Up, Planning, and Scenario modes.

**Architecture:** Extend the current React dashboard with a dedicated compact sticky header that reuses existing control state. Measure the compact header and planning panel heights, expose them as shared CSS variables, and derive every sticky `top` value from that stack so the planning panel, epic header, and scenario axis remain ordered under the new header.

**Tech Stack:** React 19, bundled dashboard JSX, static CSS in `frontend/dist/dashboard.css`, Python `unittest` smoke coverage for served assets.

---

### Task 1: Lock the sticky stack contract in a failing asset test

**Files:**
- Modify: `tests/test_dashboard_css_extraction.py`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

Add an assertion that `/frontend/dist/dashboard.css` contains the new compact sticky header selectors and shared sticky stack variables, for example:

```python
self.assertIn('.compact-sticky-header', css)
self.assertIn('--compact-header-offset', css)
self.assertIn('--sticky-stack-top', css)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: FAIL because the compact sticky header selectors and variables are not in the stylesheet yet.

**Step 3: Write minimal implementation**

Add placeholder compact sticky header selectors and shared sticky variables in `frontend/dist/dashboard.css` so the asset test can pass once the real layout work lands.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/test_dashboard_css_extraction.py frontend/dist/dashboard.css
git commit -m "test: lock compact sticky header css contract"
```

### Task 2: Add compact header visibility state and measurements

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

Extend the CSS asset test with one more assertion for the derived stack variables that lower sticky layers will consume:

```python
self.assertIn('--planning-sticky-top', css)
self.assertIn('--epic-sticky-top', css)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: FAIL because the derived stack variables are still missing.

**Step 3: Write minimal implementation**

In `frontend/src/dashboard.jsx`:
- add a `headerRef`
- add a `compactStickyVisible` state
- add a `compactHeaderRef`
- measure compact header height with `ResizeObserver`
- replace the single `planningOffset` container style with a shared stack style object, for example:

```jsx
style={{
  '--compact-header-offset': `${compactStickyOffset}px`,
  '--planning-offset': `${planningOffset}px`,
  '--planning-sticky-top': `${compactStickyOffset}px`,
  '--epic-sticky-top': `${compactStickyOffset + planningOffset}px`
}}
```

Use an `IntersectionObserver` on the main header to toggle `compactStickyVisible` when the header leaves the viewport.

In `frontend/dist/dashboard.css`:
- define the new stack variables in `:root`
- switch lower sticky elements to consume them instead of standalone `top` values

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css tests/test_dashboard_css_extraction.py
git commit -m "refactor: add shared sticky stack offsets"
```

### Task 3: Render the compact sticky header with existing controls

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

Add a stylesheet assertion for the compact header layout primitives:

```python
self.assertIn('.compact-sticky-header.is-visible', css)
self.assertIn('.compact-sticky-header-controls', css)
self.assertIn('.compact-sticky-header-search', css)
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: FAIL because those selectors do not exist yet.

**Step 3: Write minimal implementation**

In `frontend/src/dashboard.jsx`:
- add the compact sticky header container above the planning panel
- render compact versions of the sprint, group, team, and search controls
- keep mode buttons only in the main header
- reuse the existing state and handlers for all control interactions

In `frontend/dist/dashboard.css`:
- add the one-line compact header layout
- put sprint/group/team on the left and search on the right
- add the bottom border and background surface
- prevent wrapping with `flex-wrap: nowrap`, shrinking widths, and `min-width: 0`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest tests.test_dashboard_css_extraction.TestDashboardCssExtraction.test_dashboard_css_asset_served -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css tests/test_dashboard_css_extraction.py
git commit -m "feat: add compact sticky header controls"
```

### Task 4: Reattach sticky lower layers under the compact header

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`

**Step 1: Write the failing test**

Write down the manual failure condition to verify against before editing:

```text
Planning mode overlap failure:
- compact sticky header covers planning panel
- epic header no longer sits directly below planning panel
- scenario axis overlaps either sticky layer
```

**Step 2: Run test to verify it fails**

Run: manual browser check in Catch Up, Planning, and Scenario.
Expected: FAIL or regress visually until lower sticky elements are moved onto the shared stack variables.

**Step 3: Write minimal implementation**

Update sticky rules in `frontend/dist/dashboard.css`:
- planning panel `top: var(--planning-sticky-top)`
- epic header `top: var(--epic-sticky-top)`
- scenario axis `top: var(--scenario-sticky-top)`

Update any derived style values in `frontend/src/dashboard.jsx` so:
- `--scenario-sticky-top` includes compact header and planning panel height when applicable
- the existing sticky epic focus logic uses the new derived top value instead of the older planning-only offset

**Step 4: Run test to verify it passes**

Run: manual browser check in Catch Up, Planning, and Scenario.
Expected: PASS with no sticky overlap in either the main-header-visible state or the compact-header-visible state.

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css
git commit -m "fix: restack sticky layers under compact header"
```

### Task 5: Build and run full verification

**Files:**
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Test: `tests/test_dashboard_css_extraction.py`

**Step 1: Write the failing test**

No new code test. Use the existing verification list as the gate for completion.

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL if JSX or bundling is inconsistent.

**Step 3: Write minimal implementation**

Build the frontend bundle after the JSX/CSS changes so the shipped assets match the source.

**Step 4: Run test to verify it passes**

Run:
- `npm run build`
- `python3 -m unittest tests.test_dashboard_css_extraction -v`
- `python3 -m unittest discover -s tests`

Expected:
- build passes
- CSS extraction test passes
- full Python suite passes

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.css frontend/dist/dashboard.js frontend/dist/dashboard.js.map tests/test_dashboard_css_extraction.py
git commit -m "build: ship compact sticky header"
```
