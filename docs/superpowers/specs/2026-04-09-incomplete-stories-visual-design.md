# Incomplete Stories — Visual & Scheduling Design Spec

**Date:** 2026-04-09
**Status:** Approved

---

## Problem

Incomplete stories (started but not finished in the sprint, closed as "incomplete" in Jira) have no visual distinction from active work. In Catch Up mode they render as default cards with no status color. In the scenario planner they render as default blue bars. There is no way to tell at a glance what was attempted but not completed.

---

## Decisions

| Area | Decision |
|---|---|
| Catch Up card styling | Amber background tint, amber left border, ◐ icon, `INCOMPLETE` badge (#fa8c16) |
| Card opacity | Slightly muted (~0.8), not as dimmed as killed (0.6) |
| Toggle button | Merge with done: "Hide Done/Incomplete (N)" |
| Scenario bar | Two-tone partial fill: left green (work done), right faded red (unfinished) |
| Scenario fill ratio | `logged_time / (SP × 2 weeks)`, fallback 50% if no time logged |
| Scenario filter | Always visible, no toggle |
| Scheduler | Own `scheduledReason: 'incomplete'`, consumes assignee time slots, placed after all regular tasks |
| buildLaneIssues | No filtering (unlike killed which is hidden) |

---

## Catch Up Mode — Task Cards

### Status badge
- CSS class: `.task-status.incomplete`
- Background: `#fa8c16` (amber), white text
- Same pill style as existing status badges (done, killed, in-progress, etc.)

### Card styling
- CSS class: `.task-item.status-incomplete`
- Background: `#fffbf0` (light amber tint)
- Left border: `#fa8c16` (amber)
- Opacity: `0.8` (muted but readable, between normal 1.0 and killed 0.6)
- Text color for title/meta: `#8c6d00` (warm dark amber)

### Icon
- Unicode half-circle `◐` placed before the task title
- Communicates "partially done" at a glance

### Detection
- Add `isIncomplete` check: `task.fields.status?.name === 'Incomplete'` (case-normalized)
- Add `status-incomplete` to the task-item className alongside existing `status-done` and `status-killed`

### Toggle
- Merge the existing "Hide Done Tasks (N)" button with incomplete: "Hide Done/Incomplete (N)"
- The count includes both done and incomplete stories
- Single toggle controls visibility of both statuses
- Default: shown (same as current done behavior)

---

## Scenario Planner — Timeline Bar

### Visual
- CSS class: `.scenario-bar.incomplete`
- Two-tone gradient: left portion green (`rgba(34,197,94,0.16)`), right portion faded red (`rgba(239,68,68,0.08)`)
- Split point determined by progress ratio
- Border: `1px solid rgba(34,197,94,0.3)`
- Text color: `#888`

### Progress ratio
- Computed as: `logged_time / (SP × 2 weeks)`
- `logged_time` comes from Jira's `timetracking.timeSpentSeconds` field (convert to weeks: `seconds / 3600 / 40`)
- `SP × 2 weeks` uses the same `sp_to_weeks` factor as the scheduler (default 2.0)
- Fallback: 50% if `timeSpentSeconds` is null/zero
- Clamped to [5%, 95%] to always show both colors

### CSS implementation
- Use CSS custom property `--incomplete-progress` set via inline style
- Background: `linear-gradient(90deg, rgba(34,197,94,0.16) var(--incomplete-progress), rgba(239,68,68,0.08) var(--incomplete-progress))`

---

## Scheduler — Placement

### Detection
- In `planning/scheduler.py`, detect `normalize_status(issue.status) == 'incomplete'`
- Incomplete issues are NOT handled in the existing done/in-progress branches
- They go through a dedicated post-pass after all regular scheduling

### Post-pass scheduling
1. All regular tasks (in-progress, to-do) are scheduled first via the normal pipeline
2. After the main loop, collect incomplete issues per assignee
3. For each assignee, start at `assignee_available_at` (end of their last scheduled task)
4. Stack incomplete issues sequentially: each starts where the previous ends
5. Duration: `SP × sp_to_weeks / capacity_factor` (same formula as regular tasks)
6. End dates naturally extend past `quarter_end_date` — this is correct and intentional (shows sprint overflow)
7. Update `assignee_available_at` after each (they consume the slot)
8. Set `scheduledReason: 'incomplete'`

### Data flow
- `jira_server.py` passes incomplete issues to the scheduler (they are NOT excluded like killed)
- The scheduler returns them with computed dates
- Frontend receives `scheduledReason: 'incomplete'` and applies the two-tone bar style

---

## Backend — Time Tracking Data

### Jira field
- `timetracking.timeSpentSeconds` — total time logged on the issue
- Must be added to the scenario endpoint's `fields_list` if not already fetched
- Passed through to the frontend as `timeSpentSeconds` on the issue object

### Response format
- Add `timeSpentSeconds` to the issue dict in `jira_server.py`'s scenario response builder
- Frontend computes progress ratio client-side

---

## Out of Scope

- Progress bar on task list cards (decided against — icon only)
- Separate toggle for incomplete (merged with done)
- Changes to Planning mode cards
- Changes to Statistics mode
- Changes to cohort analysis (already has its own incomplete toggle)
