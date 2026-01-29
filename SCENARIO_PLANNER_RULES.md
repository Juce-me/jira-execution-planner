# Scenario Planner Rules

This document captures the critical invariants and business rules for the scenario planner feature.

## Data Flow

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

---

## Scheduling Rules (Backend)

### Anchor Date (Active Sprint)

**Rule**: For Active Sprint, non-done tasks (Accepted, To Do, Blocked, etc.) must start on or after TODAY.

**Implementation** (`planning/scheduler.py:235`):
```python
status = normalize_status(issue.status)
min_start_week = anchor_week if status not in DONE_STATUSES and status not in IN_PROGRESS_STATUSES else 0.0
start_week = max(dep_end, assignee_ready, min_start_week)  # Respects anchor!
```

**Statuses**:
- **Done**: `{"done", "killed", "incomplete"}` - Anchored at sprint start (can be before TODAY)
- **In Progress**: `{"in progress", "in review", "in dev"}` - Centered around TODAY but respect dependencies
- **Todo** (everything else): `"accepted"`, `"to do"`, `"blocked"`, etc. - Anchored to TODAY or later

**Critical**: `"accepted"` is treated as TODO (not done, not in-progress) and gets anchored to TODAY.

### Dependencies

**Rule**: Dependent tasks must start after prerequisite tasks end.

**Implementation** (`planning/scheduler.py:236-240`):
```python
dep_end = 0.0
for dep in dependency_keys.get(key, []):
    dep_issue = scheduled.get(dep)
    if dep_issue and dep_issue.duration_weeks is not None:
        dep_end = max(dep_end, dep_issue.duration_weeks + (dep_issue.start_date - config.start_date).days / 7.0)

start_week = max(dep_end, slot_ready, min_start_week)  # Respects dependencies!
```

**Effect**: Dependencies create "water flow" visualization - tasks flow left-to-right in chronological order.

### Unscheduled Issues

**Rule**: Issues without story points or with missing dependencies cannot be scheduled.

**Handling**:
- `scheduled_reason = "missing_story_points"` - No SP value
- `scheduled_reason = "missing_dependency"` - Depends on non-existent issue
- `start_date = None`, `end_date = None`
- Frontend renders these at timeline start with special "unscheduled" styling

---

## Timeline Rendering Rules (Frontend)

### Date Parsing

**Rule**: Dates from backend (YYYY-MM-DD) must parse as local dates without timezone shifting.

**Implementation** (`frontend/src/dashboard.jsx:1992-1995`):
```javascript
const parseScenarioDate = (value) => {
    if (!value) return null;
    return new Date(`${value}T00:00:00`);  // Local midnight, no timezone
};
```

**Critical**: Adding `T00:00:00` without a timezone creates a local date at midnight. This avoids day-shift bugs where "2026-01-29" becomes "2026-01-28" due to timezone conversion.

### Bar Positioning

**Rule**: Bars use scheduled `start`/`end` dates from API response (NOT raw Jira dates).

**Implementation** (`frontend/src/dashboard.jsx:3119-3168`):
```javascript
const start = parseScenarioDate(issue.start);  // From API scheduled dates
const end = parseScenarioDate(issue.end);

const startRatio = Math.max(0, (start - scenarioViewStart) / totalMs);
const endRatio = Math.min(1, (end - scenarioViewStart) / totalMs);
const xStart = startRatio * scenarioLayout.width;
const xEnd = Math.max(xStart + 6, endRatio * scenarioLayout.width);
```

**View Range**:
- Unfocused: `scenarioViewStart = scenario.config.start_date`, `scenarioViewEnd = max(quarter_end, latest_issue_end)`
- Focused: `scenarioViewStart/End` zoom into focused epic's date range (lines 3687-3690)

**Critical**: View range changes when focusing, but bar positions recalculate correctly because they're based on scheduled dates.

### Dependency Edges

**Rule**: Edges must only render when BOTH endpoint bars are visible (either in DOM or in computed positions).

**Implementation** (`frontend/src/dashboard.jsx:3563-3568`):
```javascript
const fromVisible = visibleKeys.has(edge.from);
const toVisible = visibleKeys.has(edge.to);
if (!fromVisible && !toVisible) return;  // Skip if both invisible

const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
if (!fromRect || !toRect) return;  // Skip if either rect is null
```

**Fallback Rect**:
```javascript
const getFallbackRect = (issueKey) => {
    const pos = scenarioPositions[issueKey];
    if (!pos) return null;  // Issue not in timeline → skip edge
    return {
        x: trackLeft + pos.xStart,
        y: lanesTop + pos.y,
        width: Math.max(2, pos.xEnd - pos.xStart),
        height: pos.height
    };
};
```

**Focus Mode** (`frontend/src/dashboard.jsx:3569-3573`):
```javascript
const fromInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.from);
const toInFocus = scenarioEpicFocus && scenarioFocusIssueKeys.has(edge.to);
if (scenarioEpicFocus && !fromInFocus && !toInFocus) {
    return;  // Skip edges where neither endpoint is in focused epic
}
```

**Edge Cases**:
- Edges between focused issues + their direct dependencies (context) are shown
- Edges to filtered/excluded issues are skipped
- Edges never point to "domain end" fallback - they're skipped if endpoint is missing

**Visual Goal**: Dependencies should read like "water flow" along the timeline (left-to-right chronological order).

---

## Focus Mode Rules

**Rule**: When focusing on an epic, show only:
1. Issues in that epic (`scenarioFocusIssueKeys`)
2. Direct dependencies (upstream/downstream) of those issues (`scenarioFocusContextKeys`)
3. Edges between visible issues only

**Implementation** (`frontend/src/dashboard.jsx:2529-2560`):
```javascript
// 1. Issues in focused epic
const scenarioFocusIssueKeys = new Set();
scenarioIssues.forEach(issue => {
    if (issue.epicKey === scenarioFocusEpicKey) {
        keys.add(issue.key);
    }
});

// 2. Direct dependencies (context)
const scenarioFocusContextKeys = new Set();
scenarioDependencies.forEach(edge => {
    const fromInFocus = scenarioFocusIssueKeys.has(edge.from);
    const toInFocus = scenarioFocusIssueKeys.has(edge.to);
    if (fromInFocus && !toInFocus) {
        keys.add(edge.to);  // Add downstream dependency
    } else if (toInFocus && !fromInFocus) {
        keys.add(edge.from);  // Add upstream dependency
    }
});

// 3. Filter timeline to focus + context
const scenarioTimelineIssues = scenarioIssues.filter(issue =>
    scenarioFocusIssueKeys.has(issue.key) || scenarioFocusContextKeys.has(issue.key)
);
```

**Critical**: Focus mode changes which issues are visible, but does NOT change bar x-positions. Bars use the same scheduled dates; only filtering and highlighting change.

---

## Test Coverage

See `tests/test_scheduler_product_33712_active_sprint.py`:
- ✅ Non-done tasks anchor to TODAY
- ✅ Done tasks stay at sprint start
- ✅ All scheduled issues have valid dates (no None)
- ✅ Dependencies are respected
- ✅ "Accepted" status treated as TODO

See `tests/test_date_parsing.py`:
- ✅ YYYY-MM-DD parsing without timezone shift

---

## Common Pitfalls

### ❌ DON'T: Use raw Jira dates for bar positioning
```javascript
// WRONG: Raw Jira dates ignore scheduler logic
const start = new Date(issue.fields.created);
```

### ✅ DO: Use scheduled dates from API
```javascript
// CORRECT: Use scheduled dates from /api/scenario
const start = parseScenarioDate(issue.start);
```

### ❌ DON'T: Assume all issues have start/end dates
```javascript
// WRONG: Unscheduled issues have null dates
const xStart = (issue.start - viewStart) / totalMs * width;  // Error if issue.start is null
```

### ✅ DO: Check for null dates and handle unscheduled issues
```javascript
// CORRECT: Check and handle unscheduled
if (!issue.start || !issue.end) {
    // Render as unscheduled (at timeline start)
    return;
}
const start = parseScenarioDate(issue.start);
```

### ❌ DON'T: Render edges when endpoints are missing
```javascript
// WRONG: May point to wrong coordinates
const fromRect = visibleRects.get(edge.from);
const toRect = visibleRects.get(edge.to);
const path = `M ${fromRect.x} ${fromRect.y} L ${toRect.x} ${toRect.y}`;  // Crash if null
```

### ✅ DO: Skip edges when endpoints are missing
```javascript
// CORRECT: Guard against missing rects
const fromRect = visibleRects.get(edge.from) || getFallbackRect(edge.from);
const toRect = visibleRects.get(edge.to) || getFallbackRect(edge.to);
if (!fromRect || !toRect) return;  // Skip edge
```

---

## Debugging Tips

### Check if backend is anchoring correctly
```bash
# Run backend tests
python3 -m unittest tests.test_scheduler_product_33712_active_sprint -v

# Expected: All non-done tasks have start_date >= TODAY
```

### Check if frontend is using scheduled dates
```javascript
// In browser console, inspect API response
const response = await fetch('/api/scenario', {method: 'POST', ...});
const data = await response.json();
console.log(data.issues.filter(i => i.status === 'Accepted'));
// Expected: All Accepted issues have start >= config.start_date (or TODAY if Active Sprint)
```

### Check if edges are rendering correctly
```javascript
// In browser console, check edge paths
const edges = scenarioEdgeRender.paths;
console.log(edges.filter(e => !e.d || e.d.includes('NaN')));
// Expected: Empty array (no invalid paths)
```

---

## Related Files

- `planning/scheduler.py` - Backend scheduling logic
- `planning/models.py` - Data models (ScheduledIssue, ScenarioConfig)
- `jira_server.py` - /api/scenario endpoint
- `frontend/src/dashboard.jsx` - Timeline rendering + edges
- `tests/test_scheduler_product_33712_active_sprint.py` - Scheduler tests
- `tests/test_date_parsing.py` - Date parsing tests
