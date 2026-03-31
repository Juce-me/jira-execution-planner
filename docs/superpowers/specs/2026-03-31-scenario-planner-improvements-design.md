# Scenario Planner Improvements — Design Spec

**Date:** 2026-03-31  
**Status:** Approved

---

## Problem Summary

The scenario planner has four distinct usability bugs:

1. **Epics disappear in single-team EPIC mode** — selecting one team leaves only a handful of dependency-context bars; all regular work vanishes.
2. **Person rows are not consolidated** — the same assignee appears as multiple disconnected sub-row groups within a team lane (e.g. "Oleg M." listed three times, interleaved with other people).
3. **Excluded capacity placeholder overlaps task bars** — a team-wide reserved-capacity issue (e.g. "Ad Hoc", "Interrupt", "Dev Lead") floats on top of individual task bars and can overflow the sprint window.
4. **Killed tasks are visible** — issues with a killed status clutter the timeline with irrelevant entries.

---

## Decisions

| Issue | Decision |
|---|---|
| Person rows | Consolidate: same assignee always contiguous within a team lane, one label |
| Killed tasks | Hidden entirely — not rendered, not counted |
| Excluded capacity placeholder | Dedicated top row per team lane, bar clipped to sprint window |
| Epics disappearing | Fix: `focus_set` controls highlighting only, not visibility |
| Cross-team assignees | Intentional — same person may appear in multiple team lanes, no change |

---

## Approach: Extract Lane Logic, Fix While Extracted

All four frontend fixes touch the same computed section of `dashboard.jsx` that produces `scenarioIssuesByLane` and `scenarioPositions`. Rather than patching in-place in a 565KB file, extract that logic into a new module and fix the bugs in the extracted code where they are isolated and testable.

---

## Architecture

### New module: `frontend/src/scenario/scenarioLaneUtils.js`

Peer to the existing `scenarioUtils.js`. Pure functions, no React/DOM dependencies. Owns exactly one concern: given a flat list of issues and config, produce lane groups and bar positions.

**Exports:**

```js
buildLaneIssues(issues, mode, excludedKeys, killedStatuses)
```
- Filters out issues whose `status` is in `killedStatuses` (reuses the existing killed-status set from `isBurnoutClosedStatus`)
- Groups remaining issues by lane key: `issue.team` (team mode), `issue.epicKey` (epic mode), `issue.assignee` (assignee mode)
- Returns `Map<laneKey, Issue[]>`

```js
consolidateAssigneeRows(laneIssues)
```
- Runs on team-mode lanes only
- Stable-sorts each lane's issues by `assignee` as primary key, preserving existing within-assignee row order
- Ensures all issues for the same person are contiguous — no interleaving
- "Unassigned" sorts last
- The existing label rendering (which reads `scenarioLaneAssigneeGroups`) produces one entry per person automatically once the sort is correct

```js
buildCapacityPlaceholderRows(issues, excludedIssueKeys, sprintStart, sprintEnd)
```
- Selects issues already in `excludedIssueKeys` (issues whose epic is in user's `excludedCapacityEpics` config — covers ad hoc, interrupt, dev lead, perf review, etc.)
- Clips each issue's `start`/`end` to `[sprintStart, sprintEnd]` — no overflow
- Returns them as a synthetic `__team_capacity__` row to be prepended to the top of each team lane
- These issues are removed from the regular assignee groups

```js
computeBarPositions(laneGroups, trackWidth, viewStart, viewEnd)
```
- Existing position calculation logic, moved here from `dashboard.jsx`

### Changes to `dashboard.jsx`

The current derived-state block that builds lane groups and positions is replaced with calls to the above functions. `ScenarioBar` and all other renderers are unchanged.

---

## Bug Fix: Epics Disappearing (single-team EPIC mode)

**Root cause (to confirm during implementation):** `scenarioTimelineIssues` is likely filtered to `focus_set.focused_issue_keys ∪ focus_set.context_issue_keys`. With a small or misconfigured focus set for a single-team run, most regular work items are dropped before they ever reach lane grouping.

**Fix:** `focus_set` controls highlighting and dependency arrow emphasis only — not visibility. All issues belonging to the active team(s) must always be included in the rendered lane. The investigation step in the implementation plan will locate the exact filter in `dashboard.jsx` and scope it to highlighting only.

---

## Visual Design

### Capacity placeholder row
- Rendered at the **top** of each team lane (above assignee rows)
- Left label: `"Team cap."` in a muted style
- Background tint: warm yellow (`#fdf5e4`) to read as infrastructure, not work
- Bar clipped hard to sprint end — no visual overflow

### Killed tasks
- Not rendered at all — removed before lane grouping
- No toggle, no gray-out

### Person row consolidation
- Each assignee's rows form one contiguous block under a single label
- No structural change to the row/bar rendering — just sort order

---

## Out of Scope

- Drag-and-drop for capacity placeholder rows
- Per-person capacity allocation view
- Combining/merging a person's view across teams they participate in
- Any changes to `ScenarioBar.jsx` or `scenarioUtils.js`
