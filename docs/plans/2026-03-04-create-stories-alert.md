# Create Stories and Backlog Alerts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add future-planning epic alerts for `Backlog`, `Missing Team`, `Missing Labels`, and `Create Stories`, backed by per-group team label mappings and a dedicated labels-management UI, without duplicating epics across the current alert stack.

**Architecture:** Keep alert classification in `frontend/src/dashboard.jsx` and add only the backend payloads needed to support it. The selected sprint name acts as the required planning label, each saved group stores per-team Jira label mappings, and a dedicated backlog-epics fetch handles sprint-empty epics whose membership is determined by epic fields rather than story fields. Future-planning mode uses a dedicated precedence order and hides `Empty Epic`.

**Tech Stack:** Python/Flask backend, React frontend, esbuild build, `unittest` test suite.

---

## Approved Design Inputs

- Future planning uses the selected sprint name as the planning label.
- Group config stores `teamLabels` per group, keyed by team id.
- The group settings modal gets a new `Labels` tab.
- The `Labels` tab unlocks after at least one group has been saved.
- The tab layout is:
  - left panel: saved groups
  - right panel: one team-label selector row per selected team in the active group
- `Empty Epic` does not render in future-planning mode.

## Alert Model

### Future-planning alert order

1. `🧾 Missing Info`
2. `⛔️ Blocked`
3. `⏭️ Postponed Work`
4. `📥 Backlog`
5. `👥 Missing Team`
6. `🏷️ Missing Labels`
7. `📝 Create Stories`
8. `⏳ Waiting for Stories`
9. `✅ Epic Ready to Close`

### Non-future alert order

Keep the existing stack, including `🧺 Empty Epic`.

### Epic precedence rules

Apply these rules in order and stop on first match:

1. `Postponed Work`
2. `Backlog`
3. `Missing Team`
4. `Missing Labels`
5. `Create Stories`
6. `Waiting for Stories`
7. `Epic Ready to Close`

Outside future-planning mode, keep the current `Empty Epic` behavior.

### Matching rules

#### `📥 Backlog`

Future-sprint only. Match open epics where:

- epic team exists
- epic assignee exists
- epic has at least one component
- epic sprint is empty
- epic status is not `Done`, `Killed`, or `Incomplete`

Child stories are only used to compute `cleanupStoryCount`.

#### `👥 Missing Team`

Match open epics whose Jira team is missing or resolves to `Unknown Team`.

#### `🏷️ Missing Labels`

Match open epics with a valid Jira team when either required label is missing from `epic.labels`:

- the selected sprint name
- the configured team label for that epic's team in the active group

If the active group has no configured label for that team, the epic stays in `Missing Labels`.

#### `📝 Create Stories`

Future-sprint only. Match open epics that already have both required labels and have no usable child stories for the selected future sprint because:

- the epic has no child stories, or
- all child stories are `Done`, `Killed`, or `Incomplete`

#### `⏳ Waiting for Stories`

Future-sprint only review state. Match open epics that already have child stories, but none are actionable in the selected future sprint.

If at least one actionable child story is already in the selected future sprint, no `Create Stories` or `Waiting for Stories` alert is shown.

## Task 1: Backend tests for config and payload support

**Files:**
- Create: `tests/test_create_stories_alert.py`
- Modify: `jira_server.py`

**Step 1: Write failing config tests**

Add tests for group-config normalization and validation that assert:

- `teamLabels` is preserved per group
- mappings are keyed by team id
- labels for teams outside `teamIds` are ignored or rejected consistently

**Step 2: Write failing tests for epic labels**

Add tests for `fetch_epics_for_empty_alert()` that assert the returned epic dict includes `labels`.

**Step 3: Write failing tests for backlog epic fetch**

Add tests for a dedicated backlog epic fetch path, for example `fetch_backlog_epics_for_alert()` or `/api/backlog-epics`, that assert:

- epic `components` are returned
- epic `assignee` is returned
- epic `teamName` or `teamId` is returned
- epic Sprint is empty
- a `cleanupStoryCount` is returned for child stories that are still sprinted and not `Done`, `Killed`, or `Incomplete`

The backlog-specific assertion should prove that the epic enters the alert because of epic fields, while child stories are only used for the cleanup count.

**Step 4: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_create_stories_alert
```

Expected: failure because `teamLabels`, epic `labels`, and the backlog epic fetch are not implemented yet.

**Step 5: Commit after green**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "test: cover create stories alert config and payloads"
```

---

## Task 2: Backend payload and config changes

**Files:**
- Modify: `jira_server.py`

**Step 1: Extend groups config validation**

Persist `teamLabels` on each normalized group and keep backwards compatibility for groups that do not have any saved mappings yet.

**Step 2: Add `/api/jira/labels` endpoint**

Return Jira labels for autocomplete in the team-group settings modal.

**Step 3: Extend `fetch_epics_for_empty_alert()`**

Return the fields required for label-driven epic alerts:

- `labels`
- existing `summary`, `status`, `assignee`, `team`, `teamName`, `teamId`

Use additive fields only; do not change the current story-count flow.

**Step 4: Extend `fetch_epic_details_bulk()` if needed**

If the frontend selector depends on `epics` as well as `epicsInScope`, make sure `labels` are available in both payloads.

**Step 5: Add a dedicated backlog epic fetch**

Implement a dedicated helper or endpoint for backlog epics because sprint-empty epics will not appear in the selected-sprint epic dataset.

The query should enforce the epic-level condition:

- `issuetype = Epic`
- epic Sprint is empty
- epic Assignee is not empty
- epic Component exists
- epic Team exists
- status not in `Done`, `Killed`, `Incomplete`

Scope it with the same team/component filters used by the planning alerts.

**Step 6: Add child-story cleanup counts**

For each backlog epic, compute `cleanupStoryCount` from child stories where:

- story Sprint is set
- story status is not `Done`, `Killed`, or `Incomplete`

This count is for the row note only; it is not the primary membership test for the alert.

**Step 7: Preserve current missing-info behavior**

Do not repurpose `/api/missing-info` for `Backlog`. Keep its existing contract stable for current callers.

**Step 8: Run targeted tests**

```bash
python3 -m unittest tests.test_create_stories_alert
```

Expected: pass.

**Step 9: Commit**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "feat: return config and payloads for planning epic alerts"
```

---

## Task 3: Settings UI for per-group team labels

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Add draft state for group label editing**

Add draft helpers for per-group `teamLabels` and label-search state.

**Step 2: Add `Labels` tab unlock logic**

Enable the new tab only when at least one group has been saved.

**Step 3: Build the `Labels` tab layout**

Implement the approved UI:

- left panel with saved groups
- right panel with one row per selected team in the active group
- each row uses the existing chip/search interaction to assign one Jira label

Do not move quarter-label logic into config; the selected sprint name remains the planning label.

**Step 4: Build frontend bundle**

```bash
npm run build
```

**Step 5: Run tests**

```bash
python3 -m unittest tests.test_create_stories_alert
```

**Step 6: Commit**

```bash
git add jira_server.py frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map tests/test_create_stories_alert.py
git commit -m "feat: add group label mapping UI for epic alerts"
```

---

## Task 4: Frontend selector layer for new alerts

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Add stable empty helpers if needed**

Keep `EMPTY_ARRAY`, `EMPTY_OBJECT`, and `EMPTY_MAP` stable for any new memo output.

**Step 2: Add UI preference toggles**

Add toggle state and persisted UI prefs for:

- `showBacklogAlert`
- `showMissingTeamAlert`
- `showMissingLabelsAlert`
- `showCreateStoriesAlert`

**Step 3: Build shared selector inputs**

Create memoized helpers for:

- `teamEpicLabelMap`
- `missingTeamEpics`
- `missingLabelEpics`
- `createStoriesEpics`
- `backlogEpics`
- `waitingForStoriesEpics`

The selector inputs must use:

- active group `teamLabels`
- selected sprint name as the planning label
- epic `labels`
- story status and sprint state

The backlog selector must come from the dedicated backlog epic dataset, not from `missingPlanningInfoTasks`.

**Step 4: Keep the data sources separate**

Do not fold `Backlog` into `Missing Info`. `Backlog` is an epic selector and `Missing Info` remains a story selector.

**Step 5: Keep existing epic routing clean**

Filter `waitingForStoriesEpics` and `emptyEpicsForAlert` using the new epic alert key sets so the precedence rules are enforced.

In future-planning mode:

- hide `Empty Epic`
- route no-child and closed-child epics to `Create Stories`
- route story-exists-but-not-actionable epics to `Waiting for Stories`

**Step 6: Build frontend bundle**

```bash
npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "feat: add future planning selectors for epic alerts"
```

---

## Task 5: Render the new alert cards in alert order

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Modify: `ALERT_RULES.md`

**Step 1: Render `📥 Backlog` after `Postponed Work`**

Use the existing alert-card structure:

- same toggle header pattern
- same per-team grouping markup
- Jira links wired through the same helpers
- item count chip
- dismiss button behavior identical to existing alert cards

Only render the card when:

- `isFutureSprintSelected` is true
- `backlogEpics.length > 0`

**Step 2: Render `👥 Missing Team`, `🏷️ Missing Labels`, and `📝 Create Stories`**

Insert them after `Backlog` and before `Waiting for Stories`.

Use the existing epic-card pattern from `Empty Epic` and `Epic Ready to Close` so the UI stays aligned with the current alert system.

For each `Backlog` epic row, include a short note that explains the cleanup action:

- how many child stories are still sprinted
- that those stories should either have Sprint cleared or be moved to `Done`, `Killed`, or `Incomplete`

**Step 3: Update alert counts and celebration types**

Add the new cards to:

- `alertCounts`
- `alertItemCount`
- any celebration palette or highlight routing that depends on alert type

**Step 4: Update alert documentation**

Add `📥 Backlog`, `👥 Missing Team`, `🏷️ Missing Labels`, and `📝 Create Stories` to `ALERT_RULES.md` with:

- trigger conditions
- exclusions and precedence notes
- grouping behavior
- future-sprint-only note for `Backlog`
- note that `Empty Epic` is hidden in future-planning mode

**Step 5: Build frontend bundle**

```bash
npm run build
```

**Step 6: Manual verification**

Check all three views named in `AGENTS.md`:

1. Catch Up
2. Planning
3. Scenario

Validate:

- sticky layout still behaves correctly
- `Backlog` is hidden outside future sprint mode
- `Backlog` is populated from the dedicated backlog epic dataset, not from `Missing Info`
- `futureRoutedEpics` still appear under `Postponed Work`
- `Missing Team`, `Missing Labels`, and `Create Stories` suppress `Waiting for Stories` as planned
- `Empty Epic` does not render in future-planning mode
- groups can be edited in the `Labels` tab and each selected team can be assigned one Jira label

**Step 7: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map ALERT_RULES.md
git commit -m "feat: render future planning epic alerts"
```

---

## Task 6: Full verification

**Files:**
- Modify: none

**Step 1: Run unit tests**

```bash
python3 -m unittest discover -s tests
```

Expected: all tests pass.

**Step 2: Build frontend**

```bash
npm run build
```

Expected: successful bundle with updated `frontend/dist/dashboard.js` and sourcemap.

**Step 3: Review recent commits**

```bash
git log --oneline -5
```

**Step 4: Do not push yet**

Per repo workflow, stop after showing the commit list and wait for explicit user approval before pushing.

---

## Implementation Notes

- Keep all new frontend memos guarded with early returns to satisfy the postmortem rules already referenced by the original plan.
- Treat `Backlog` as an epic alert with epic-field membership and child-story cleanup notes.
- Do not move `Backlog` items into `Postponed Work`; those are separate concepts with separate existing selectors.
- Do not render `Backlog` as a flat story list; the card should surface epics and explain the child-story cleanup required.
- The selected sprint name is the planning label; do not store quarter labels in config.
- Store team label mappings on the group, not on the shared team catalog.
- In future-planning mode, `Empty Epic` should be suppressed rather than reclassified.
- Do not reuse `Waiting for Stories` for epics that belong in `Create Stories`.
- Do not claim any performance improvement without before/after timing evidence.

## Acceptance Checklist

- [ ] Epic payloads expose `labels`
- [ ] Group config supports per-team `teamLabels`
- [ ] Group settings modal has a `Labels` tab with saved groups on the left and selected-team label mapping on the right
- [ ] `📥 Backlog` appears only in future sprint mode
- [ ] `📥 Backlog` only includes epics where Team, Component, and Assignee exist and epic Sprint is empty
- [ ] `📥 Backlog` shows a cleanup count for child stories that are still sprinted and still open
- [ ] `📥 Backlog` tells the user to clear Sprint from those stories or move them to `Done`, `Killed`, or `Incomplete`
- [ ] `👥 Missing Team` works for epics with missing Jira Team
- [ ] `🏷️ Missing Labels` shows epics missing the selected sprint label and/or the configured team label
- [ ] `📝 Create Stories` shows fully labeled epics with no child stories or only closed child stories
- [ ] `⏳ Waiting for Stories` shows epics that have child stories but none actionable in the selected future sprint
- [ ] `🧺 Empty Epic` is hidden in future-planning mode
