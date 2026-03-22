# Scenario Planner

The Scenario Planner builds a quarter timeline from Jira data so users can inspect sequencing, capacity pressure, and dependency risk before changing plans.

## What It Uses

- sprint-scoped Jira work
- team capacity data
- dependency links
- story points
- optional saved overrides

## What It Shows

- per-issue start and end dates
- critical path
- slack
- bottleneck lanes
- late items
- unschedulable work

The planner can render lanes by:
- team
- epic
- assignee

## Scheduling Model

The planner schedules work by:
- respecting dependency order first
- then prioritizing higher-priority work
- then preferring larger story-point items when multiple items are ready

Blocked relationships are treated as prerequisites, so blocked work does not run in parallel with its blockers.

Assignee lanes are single-threaded, which means one assignee can only execute one item at a time in that view.

Planner assumption:
- `1 SP = 2 working weeks`

## Editing

Edit mode is for interactive rescheduling.

Users can:
- drag bars to new date ranges
- undo and redo changes
- save and reload drafts
- discard overrides and return to computed dates

Behavior details:
- dragging snaps to day boundaries
- date-source badges show whether a bar comes from Jira data or a manual override
- dependency violations are highlighted in red
- assignee overlap conflicts update as bars move
- edit mode forces Assignee lane view

## Missing or Partial Data

The planner surfaces incomplete scheduling inputs instead of hiding them.

Examples:
- missing story points
- missing dependencies
- issues that cannot be scheduled safely

Dependency neighbors are also included as context items so cross-epic relationships stay visible even when the main focus is narrower.

## Overrides

Scenario drafts are persisted in `scenario-overrides.json`.

API behavior:
- `GET /api/scenario/overrides?scope_key=<sprint_id>:<group_id>` returns saved overrides for the scope
- `POST /api/scenario/overrides` saves overrides for that scope

This allows users to preserve manual planning experiments without changing Jira itself.

## Technical Rules

This section captures the implementation-level invariants behind the planner.

### Data Flow

```
User Selection → /api/scenario → Scheduler → Timeline Rendering
```

1. **User** selects sprint + teams in UI
2. **Frontend** calls `POST /api/scenario` with:
   - `config.anchor_date`: TODAY (if Active Sprint), else null
   - `config.lane_mode`: "team" | "assignee" | "epic"
   - `filters.sprint`: Sprint label
   - `filters.teams`: Team IDs
3. **Backend** scheduler (`planning/scheduler.py`) computes:
   - `start_date` and `end_date` for each issue (ISO date strings)
   - Respects `anchor_date` for non-done tasks
   - Respects dependencies (dependents start after prerequisites)
4. **Frontend** renders timeline using scheduled dates

### Scheduling Rules

#### Anchor Date (Active Sprint)

For Active Sprint, non-done tasks (`Accepted`, `To Do`, `Blocked`, and similar states) must start on or after today.

Implementation reference in `planning/scheduler.py`:

```python
status = normalize_status(issue.status)
min_start_week = anchor_week if status not in DONE_STATUSES and status not in IN_PROGRESS_STATUSES else 0.0
start_week = max(dep_end, assignee_ready, min_start_week)
```

Status behavior:
- **Done**: `{"done", "killed", "incomplete"}` stay anchored at sprint start
- **In Progress**: `{"in progress", "in review", "in dev"}` can center around today while still respecting dependencies
- **Todo-like**: `"accepted"`, `"to do"`, `"blocked"` and other non-terminal/non-in-progress states anchor to today or later

`"accepted"` is intentionally treated as TODO, not as done.

#### Dependencies

Dependent tasks must start after prerequisite tasks end.

Implementation reference in `planning/scheduler.py`:

```python
dep_end = 0.0
for dep in dependency_keys.get(key, []):
    dep_issue = scheduled.get(dep)
    if dep_issue and dep_issue.duration_weeks is not None:
        dep_end = max(dep_end, dep_issue.duration_weeks + (dep_issue.start_date - config.start_date).days / 7.0)

start_week = max(dep_end, slot_ready, min_start_week)
```

This is what creates the left-to-right “water flow” dependency behavior in the timeline.

#### Unscheduled Issues

Issues without story points or with missing dependencies cannot be safely scheduled.

Typical handling:
- `scheduled_reason = "missing_story_points"`
- `scheduled_reason = "missing_dependency"`
- `start_date = None`, `end_date = None`

The frontend renders these as unscheduled items rather than hiding them.

### Timeline Rendering Rules

#### Date Parsing

Backend dates (`YYYY-MM-DD`) must parse as local dates without timezone shifting.

Implementation reference in `frontend/src/dashboard.jsx`:

```javascript
const parseScenarioDate = (value) => {
    if (!value) return null;
    return new Date(`${value}T00:00:00`);
};
```

Using local midnight avoids day-shift bugs.

#### Bar Positioning

Timeline bars must use scheduled `start` and `end` values from the scenario API response, not raw Jira dates.

Implementation reference in `frontend/src/dashboard.jsx`:

```javascript
const start = parseScenarioDate(issue.start);
const end = parseScenarioDate(issue.end);

const startRatio = Math.max(0, (start - scenarioViewStart) / totalMs);
const endRatio = Math.min(1, (end - scenarioViewStart) / totalMs);
const xStart = startRatio * scenarioLayout.width;
const xEnd = Math.max(xStart + 6, endRatio * scenarioLayout.width);
```

Changing the view range during focus mode is fine because positions are still derived from scheduled dates.

#### Dependency Edges

Edges should render only when endpoints are available in the visible or fallback geometry.

Implementation reference in `frontend/src/dashboard.jsx`:

```javascript
const fromVisible = visibleKeys.has(edge.from);
const toVisible = visibleKeys.has(edge.to);
if (!fromVisible && !toVisible) return;

const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
if (!fromRect || !toRect) return;
```

This prevents edges from pointing at invalid coordinates when issues are filtered out or unavailable.

### Focus Mode Rules

When focusing on an epic, the planner should show:
1. Issues in that epic
2. Direct upstream/downstream dependency neighbors of those issues
3. Edges between the still-visible issues only

Focus mode changes visibility and highlighting, but it does not change the underlying scheduled bar positions.

### Test Coverage

Key regression coverage lives in:
- `tests/test_scheduler_product_33712_active_sprint.py`
- `tests/test_date_parsing.py`

These tests cover active-sprint anchoring, dependency ordering, valid scheduled dates, and timezone-safe parsing.

### Common Pitfalls

Do not use raw Jira dates for timeline positioning:

```javascript
const start = new Date(issue.fields.created); // wrong
```

Use scheduled dates from `/api/scenario`:

```javascript
const start = parseScenarioDate(issue.start); // correct
```

Do not assume every issue has a scheduled range:

```javascript
const xStart = (issue.start - viewStart) / totalMs * width; // wrong if null
```

Guard null dates and render unscheduled items explicitly:

```javascript
if (!issue.start || !issue.end) {
    return;
}
const start = parseScenarioDate(issue.start);
```

Do not render dependency edges if endpoint geometry is missing:

```javascript
const fromRect = visibleRects.get(edge.from);
const toRect = visibleRects.get(edge.to);
```

Use guarded fallback rectangles instead:

```javascript
const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
if (!fromRect || !toRect) return;
```
