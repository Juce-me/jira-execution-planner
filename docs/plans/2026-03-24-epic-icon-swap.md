# Epic Icon Swap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dashboard epic icon with the provided SVG in all epic header render points.

**Architecture:** The dashboard already renders the epic icon inline in JSX. The safest implementation is to keep the existing wrappers and replace only the SVG markup in each epic-header instance, then guard the source with a narrow test to prevent regressions.

**Tech Stack:** React JSX, Node `node:test`, esbuild

---

### Task 1: Add a failing source guard

**Files:**
- Create: `tests/test_dashboard_epic_icon_source_guards.js`
- Test: `tests/test_dashboard_epic_icon_source_guards.js`

**Step 1: Write the failing test**

Add a test that reads `frontend/src/dashboard.jsx` and asserts:
- the new `viewBox="0 0 16 16"` epic icon appears twice
- the new purple fill value appears twice
- the old `viewBox="0 0 24 24"` checkmark icon no longer appears in the epic icon blocks

**Step 2: Run test to verify it fails**

Run: `node --test tests/test_dashboard_epic_icon_source_guards.js`

Expected: FAIL because the old icon is still present.

### Task 2: Replace the epic SVG markup

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Update the main epic header icon**

Replace the current inline 24x24 checkmark SVG with the provided 16x16 purple SVG.

**Step 2: Update the mapping preview epic header icon**

Apply the same SVG replacement in the mapping preview epic card so both epic icon entry points stay consistent.

**Step 3: Run test to verify it passes**

Run: `node --test tests/test_dashboard_epic_icon_source_guards.js`

Expected: PASS.

### Task 3: Rebuild and validate

**Files:**
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Rebuild the dashboard bundle**

Run: `npm run build`

**Step 2: Run broader verification**

Run:
- `python3 -m unittest discover -s tests`

Expected: PASS.
