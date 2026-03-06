# Create Stories and Backlog Alerts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the new epic planning alerts (`Backlog`, `Missing Team`, `Missing Labels`, `Create Stories`) without duplicating items across the existing alert stack.

**Architecture:** Reuse the current alert pipeline in `frontend/src/dashboard.jsx`, but keep all new planning alerts in the epic lane. `Missing Team`, `Missing Labels`, and `Create Stories` continue to come from `epicsInScope` plus epic labels from `jira_server.py`. `Backlog` also becomes an epic alert, but it needs a separate backend fetch because the primary condition is on the epic itself: Team exists, Component exists, Assignee exists, and epic Sprint is empty. Child stories are only used to compute a cleanup count and remediation note for the alert row. Every new selector must follow a single precedence order so an issue only appears in one alert card.

**Tech Stack:** Python/Flask backend, React frontend, esbuild build, `unittest` test suite.

---

## Current Baseline (2026-03-06)

The current alert cards in [frontend/src/dashboard.jsx](/Users/juce/Documents/codex/jira-planning/frontend/src/dashboard.jsx) are:

1. `🧾 Missing Info`
2. `⛔️ Blocked`
3. `⏭️ Postponed Work`
4. `⏳ Waiting for Stories`
5. `🧺 Empty Epic`
6. `✅ Epic Ready to Close`

Relevant current behavior:

- `futureRoutedEpics` already route empty epics with only future stories into `Postponed Work`.
- `Waiting for Stories` is intentionally restricted to epics that match the selected sprint.
- `Missing Info` only keeps stories that are already in the selected sprint, so it is the wrong source for a backlog rule whose main condition lives on sprint-empty epics.
- `fetch_epics_for_empty_alert()` does not currently return the label data needed for label-driven epic alerts.
- The current task response does not include a dedicated dataset for sprint-empty backlog epics, so the frontend has no clean source for this alert today.

## Root Changes This Plan Must Address

1. The plan must treat `Backlog` as an epic alert whose main condition is evaluated on epic fields, not on story fields.
2. The backend must return enough metadata to evaluate the new rules directly:
   - Epic lane: `labels`
   - Backlog lane: epic `components`, `assignee`, `team`, `Sprint`, plus child-story cleanup counts
3. The frontend must use a shared alert precedence model so the new cards do not leak duplicate items into `Missing Info`, `Waiting for Stories`, or `Empty Epic`.
4. The test commands in the old plan were written for `pytest`; this repo uses `python3 -m unittest`.

## Desired Alert Model

### Alert ordering

Keep the existing visual structure, but insert the new cards in this order:

1. `🧾 Missing Info`
2. `⛔️ Blocked`
3. `⏭️ Postponed Work`
4. `📥 Backlog` (future sprint only)
5. `👥 Missing Team`
6. `🏷️ Missing Labels`
7. `📝 Create Stories`
8. `⏳ Waiting for Stories`
9. `🧺 Empty Epic`
10. `✅ Epic Ready to Close`

### Precedence rules

Apply these rules in order and stop on first match:

1. `Postponed Work`
2. `Backlog` (epics with empty epic sprint, future sprint mode only)
3. `Missing Team`
4. `Missing Labels`
5. `Create Stories`
6. `Waiting for Stories`
7. `Empty Epic`
8. `Epic Ready to Close`

### Suppression rules

- An epic shown in `Missing Team` must be excluded from `Missing Labels`, `Create Stories`, `Waiting for Stories`, and `Empty Epic`.
- An epic shown in `Missing Labels` must be excluded from `Create Stories`, `Waiting for Stories`, and `Empty Epic`.
- An epic shown in `Create Stories` must be excluded from `Waiting for Stories` and `Empty Epic`.
- `futureRoutedEpics` stay in `Postponed Work`; the new `Backlog` card is not a replacement for that behavior.
- `Backlog` should not be computed from `Missing Info`; it is a separate epic dataset.

## Matching Rules

### `📥 Backlog`

This is an epic-level alert and only renders when `selectedSprintState === 'future'`.

An epic belongs in `Backlog` when all of the following are true on the epic itself:

- epic status is not `Done`, `Killed`, or `Incomplete`
- epic `teamId` or `teamName` exists
- epic `assignee.displayName` exists
- epic `components` contains at least one value
- epic Sprint is empty
- epic is not dismissed

Grouping: by epic team, using the same team-group pattern as the other epic alerts.

Subtitle: `These epics are still backlog work. Keep child stories unsprinted unless they are already closed out.`

Epic row note: if the epic has open child stories still assigned to a sprint, show a note like `3 child stories still sprinted`.

CTA: `Clean backlog stories ->`

Remediation note: if an epic is in `Backlog`, child stories should not remain actively sprinted. The allowed actions are:

- remove Sprint from stories under that epic
- or move those stories to `Done`, `Killed`, or `Incomplete`

### `👥 Missing Team`

Epic-level alert.

Match when:

- epic is open
- epic is in scope
- Jira Team field is empty or resolves to `Unknown Team`

Grouping: flat list or `Unknown Team` bucket.

### `🏷️ Missing Labels`

Epic-level alert.

Match when:

- epic has a valid Jira Team
- epic is open
- selected sprint label is missing from `epic.labels`
  or
- the configured team `epicLabel` is missing from `epic.labels`

Grouping: by Jira Team.

### `📝 Create Stories`

Epic-level alert.

Match when:

- epic has a valid Jira Team
- sprint label exists
- team label exists
- epic has zero actionable stories in the selected sprint
- epic is open

Grouping: by Jira Team.

---

## Task 1: Backend tests for epic labels and backlog-epic payload

**Files:**
- Create: `tests/test_create_stories_alert.py`
- Modify: `jira_server.py`

**Step 1: Write failing tests for epic labels**

Add tests for `fetch_epics_for_empty_alert()` that assert the returned epic dict includes `labels`.

**Step 2: Write failing tests for backlog epic fetch**

Add tests for a dedicated backlog epic fetch path, for example `fetch_backlog_epics_for_alert()` or `/api/backlog-epics`, that assert:

- epic `components` are returned
- epic `assignee` is returned
- epic `teamName` or `teamId` is returned
- epic Sprint is empty
- a `cleanupStoryCount` is returned for child stories that are still sprinted and not `Done`, `Killed`, or `Incomplete`

The backlog-specific assertion should prove that the epic enters the alert because of epic fields, while child stories are only used for the cleanup count.

**Step 3: Run targeted tests**

Run:

```bash
python3 -m unittest tests.test_create_stories_alert
```

Expected: failure because labels are not returned yet and the backlog epic fetch does not exist yet.

**Step 4: Commit after green**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "test: cover create stories and backlog alert payloads"
```

---

## Task 2: Backend payload changes for alert classification

**Files:**
- Modify: `jira_server.py`

**Step 1: Extend `fetch_epics_for_empty_alert()`**

Return the fields required for label-driven epic alerts:

- `labels`
- existing `summary`, `status`, `assignee`, `team`, `teamName`, `teamId`

Use additive fields only; do not change the current story-count flow.

**Step 2: Extend `fetch_epic_details_bulk()` if needed**

If the frontend selector depends on `epics` as well as `epicsInScope`, make sure `labels` are available in both payloads.

**Step 3: Add a dedicated backlog epic fetch**

Implement a dedicated helper or endpoint for backlog epics because sprint-empty epics will not appear in the selected-sprint epic dataset.

The query should enforce the epic-level condition:

- `issuetype = Epic`
- epic Sprint is empty
- epic Assignee is not empty
- epic Component exists
- epic Team exists
- status not in `Done`, `Killed`, `Incomplete`

Scope it with the same team/component filters used by the planning alerts.

**Step 4: Add child-story cleanup counts**

For each backlog epic, compute `cleanupStoryCount` from child stories where:

- story Sprint is set
- story status is not `Done`, `Killed`, or `Incomplete`

This count is for the row note only; it is not the primary membership test for the alert.

**Step 5: Preserve current missing-info behavior**

Do not repurpose `/api/missing-info` for `Backlog`. Keep its existing contract stable for current callers.

**Step 6: Run targeted tests**

```bash
python3 -m unittest tests.test_create_stories_alert
```

Expected: pass.

**Step 7: Commit**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "feat: return metadata for create stories and backlog alerts"
```

---

## Task 3: Backend and settings support for epic labels

**Files:**
- Modify: `jira_server.py`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

**Step 1: Add `/api/jira/labels` endpoint**

Return Jira labels for autocomplete in the team-group settings modal.

**Step 2: Extend normalized team catalog entries with `epicLabel`**

Preserve `epicLabel` in both list-shaped and dict-shaped catalog inputs.

**Step 3: Add settings UI for `epicLabel`**

In the existing team-groups settings flow, add a label input that uses the same selected-chip pattern already used by the modal. Do not introduce a separate interaction model.

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
git commit -m "feat: add epic label configuration for alert routing"
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

The backlog selector must come from the dedicated backlog epic dataset, not from `missingPlanningInfoTasks`.

**Step 4: Keep the data sources separate**

Do not fold `Backlog` into `Missing Info`. `Backlog` is an epic selector and `Missing Info` remains a story selector.

**Step 5: Keep existing epic routing clean**

Filter `waitingForStoriesEpics` and `emptyEpicsForAlert` using the new epic alert key sets so the precedence rules are enforced.

**Step 6: Build frontend bundle**

```bash
npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "feat: add selector pipeline for backlog and epic planning alerts"
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
- `Missing Team`, `Missing Labels`, and `Create Stories` suppress `Waiting for Stories` and `Empty Epic` as planned

**Step 7: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map ALERT_RULES.md
git commit -m "feat: render backlog and epic planning alert cards"
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
- Do not reuse `Waiting for Stories` for epics that belong in `Create Stories`.
- Do not claim any performance improvement without before/after timing evidence.

## Acceptance Checklist

- [ ] Epic payloads expose `labels`
- [ ] Team settings support `epicLabel`
- [ ] `📥 Backlog` appears only in future sprint mode
- [ ] `📥 Backlog` only includes epics where Team, Component, and Assignee exist and epic Sprint is empty
- [ ] `📥 Backlog` shows a cleanup count for child stories that are still sprinted and still open
- [ ] `📥 Backlog` tells the user to clear Sprint from those stories or move them to `Done`, `Killed`, or `Incomplete`
- [ ] `👥 Missing Team` works for epics with missing Jira Team
- [ ] `🏷️ Missing Labels` shows missing sprint and/or team labels
- [ ] `📝 Create Stories` shows fully labeled epics with no actionable stories
- [ ] `⏳ Waiting for Stories` and `🧺 Empty Epic` no longer duplicate epics claimed by the new alert cards
