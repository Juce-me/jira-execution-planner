# Needs Stories Alert Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the separate future-planning `Create Stories` and `Waiting for Stories` alerts with one merged alert that still shows the specific per-epic reason.

**Architecture:** Keep future-planning alert precedence the same through `Backlog`, `Missing Team`, and `Missing Labels`, then classify remaining epics into one merged `Needs Stories` bucket. Extract the story-readiness decision into a focused helper module so the behavior can be covered with small JS tests instead of coupling tests to the full dashboard component. Render one alert card in the dashboard and display a visible reason on each epic row.

**Tech Stack:** React frontend, ES modules, esbuild output in `frontend/dist`, Node `node:test`, Python `unittest`.

---

### Task 1: Add failing tests for merged alert classification

**Files:**
- Create: `frontend/src/futurePlanningNeedsStories.mjs`
- Test: `tests/test_future_planning_needs_stories.js`

**Step 1: Write the failing test**

Add tests that describe the merged alert behavior:

- epic with no child stories => included with reason `no_stories`
- epic with only `Done`/`Killed`/`Incomplete` child stories => included with reason `only_closed_stories`
- epic with open child stories only in another sprint => included with reason `stories_in_other_sprint`
- epic with at least one open child story in the selected sprint => excluded

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test_future_planning_needs_stories.js
```

Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

Create `frontend/src/futurePlanningNeedsStories.mjs` with a small exported classifier that:

- accepts `epic`, `epicStories`, and callbacks needed to evaluate sprint/status
- returns `null` when the epic is ready for the selected sprint
- otherwise returns `{ epic, reason }`

**Step 4: Run test to verify it passes**

Run:

```bash
node --test tests/test_future_planning_needs_stories.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/futurePlanningNeedsStories.mjs tests/test_future_planning_needs_stories.js
git commit -m "test: cover merged needs stories classifier"
```

### Task 2: Switch dashboard classification to the merged alert

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Write the failing test**

Add one more test case in `tests/test_future_planning_needs_stories.js` that proves the helper keeps `Create Stories` and `Waiting for Stories` semantics distinct internally while returning one merged alert result with a reason code.

**Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/test_future_planning_needs_stories.js
```

Expected: FAIL because the helper or dashboard integration is incomplete.

**Step 3: Write minimal implementation**

Update `frontend/src/dashboard.jsx` to:

- import the new helper
- replace `createStoriesEpics`, `createStoriesEpicKeySet`, and `waitingForStoriesFutureEpics` with one `needsStoriesEntries` collection
- keep earlier precedence filters for `Backlog`, `Missing Team`, and `Missing Labels`
- derive `needsStoriesEpics` and grouped team data from `needsStoriesEntries`
- remove obsolete split-alert counts/state from future-planning mode

**Step 4: Run targeted verification**

Run:

```bash
node --test tests/test_future_planning_needs_stories.js tests/test_future_planning_team_utils.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/src/futurePlanningNeedsStories.mjs tests/test_future_planning_needs_stories.js
git commit -m "feat: merge future planning story alerts"
```

### Task 3: Update alert rendering and copy

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Modify: `docs/features/alerts.md`

**Step 1: Write the failing test**

Add a narrow copy-level assertion where practical in the JS helper tests, or otherwise rely on manual verification for the UI wording while keeping classifier tests green.

**Step 2: Run test to verify baseline**

Run:

```bash
node --test tests/test_future_planning_needs_stories.js tests/test_future_planning_team_utils.js
```

Expected: PASS before the final render-only changes.

**Step 3: Write minimal implementation**

Replace the two future-planning alert cards with one `Needs Stories` card that shows:

- one merged count
- one visible reason per epic:
  - `No stories yet for this sprint.`
  - `Only closed stories exist for this epic.`
  - `Open stories exist, but not in the selected sprint.`

Preserve team grouping, dismiss behavior, and epic links.

Update `docs/features/alerts.md` to describe the single merged alert and the visible reasons.

**Step 4: Run tests and build verification**

Run:

```bash
node --test tests/test_future_planning_needs_stories.js tests/test_future_planning_team_utils.js
python3 -m unittest discover -s tests
```

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/features/alerts.md frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "docs: align merged needs stories alert"
```

### Task 4: Manual validation

**Files:**
- Modify: none

**Step 1: Run the app**

Run:

```bash
python3 jira_server.py
```

**Step 2: Validate future-planning mode**

Check these cases:

- no child stories => one merged card row with `No stories yet for this sprint.`
- only closed child stories => one merged card row with `Only closed stories exist for this epic.`
- open child stories only in another sprint => one merged card row with `Open stories exist, but not in the selected sprint.`
- at least one open child story in selected sprint => epic does not appear in the merged card
- no epic appears in both the merged alert and an earlier precedence alert

**Step 3: Review recent commits**

Run:

```bash
git log --oneline -5
```

Expected: recent commits show the test-first progression and merged alert work.
