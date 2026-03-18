# Config Save Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refresh the selected sprint's active view immediately after saving configuration changes so newly added teams appear without a manual page refresh.

**Architecture:** Add a frontend refresh nonce plus a small helper that decides which mode should reload after save. The save flow invalidates sprint-scoped cached state, then the active mode reruns using the current selected sprint and updated group config.

**Tech Stack:** React frontend, esbuild bundle, Python `unittest` verification

---

### Task 1: Add a testable refresh helper

**Files:**
- Create: `frontend/src/configSaveRefreshUtils.mjs`

**Step 1: Write a small helper for active-mode refresh routing**

Export a pure function that maps current UI mode to a refresh target:

- `scenario` when scenario mode is active
- `tasks` for catch-up, planning, and stats
- `none` when no sprint is selected

**Step 2: Verify the helper with a small node assertion command**

Run a short `node --input-type=module` check that imports the helper and asserts the expected outputs.

### Task 2: Force sprint-scoped task views to rerun after save

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Add refresh nonce state and refresh-target bookkeeping**

Track a nonce that increments after successful config saves.

**Step 2: Add a targeted invalidation helper**

Reset sprint-scoped task state and cache refs so stale snapshots cannot satisfy the selected-sprint loader after save.

**Step 3: Update the selected-sprint load effect**

Include the nonce in the dependencies and bypass the cached-state short circuit when a new config-refresh nonce is pending.

### Task 3: Rerun scenario mode after save when active

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Add a scenario refresh effect keyed by the nonce**

When scenario mode is active and a save-refresh nonce changes, rerun `runScenario()` after the new group config is applied.

### Task 4: Verify

**Step 1: Run the helper assertion command**

**Step 2: Build the frontend**

Run:

```bash
npm run build
```

**Step 3: Run the full Python suite**

Run:

```bash
./.venv/bin/python -m unittest discover -s tests
```
