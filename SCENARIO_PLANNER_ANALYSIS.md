# Scenario Planner Analysis & Improvement Proposals

## Executive Summary

The current scenario planner provides topological scheduling based on dependencies, team capacity slots, and priority. However, it **does not enforce critical real-world constraints** around individual assignees, task status, and concurrent work limits per person.

This document analyzes the current implementation and proposes enhancements to make the planner more realistic and actionable.

---

## Current Implementation: What Works

### ✅ Strengths

1. **Dependency-aware scheduling**: Respects block/depend relationships via topological sort
2. **Team capacity modeling**: Uses Jira watchers as proxy for team size
3. **Multi-slot parallelism**: Teams with N people can work on N tasks concurrently
4. **Priority-driven ordering**: Higher priority tasks scheduled first (within dependency constraints)
5. **Capacity factor adjustments**: Vacation and sick leave reduce effective capacity
6. **Epic lane mode**: Groups tasks by epic for product planning view
7. **Team lane mode**: Groups by team for resource planning view

---

## Critical Gaps: What's Missing

### ❌ Problem 1: **No Per-Person Capacity Enforcement**

**Issue**: Multiple tasks can be assigned to the same person simultaneously.

**Current Behavior**:
- Team has 5 people → 5 concurrent task slots available
- Task A assigned to John, scheduled Week 1-3
- Task B assigned to John, **also** scheduled Week 1-3
- **Conflict**: John can't work on 2 tasks at once

**Impact**: Schedule is unrealistic; assignees are over-allocated.

**Root Cause**:
```python
# scheduler.py:27
slot_count = max(1, int(size * effective_wip_limit))
```
Slots are team-level, not per-assignee. The algorithm doesn't track which slot is used by which person.

---

### ❌ Problem 2: **In-Progress Tasks Not Treated as Started**

**Issue**: Tasks with status="In Progress" are rescheduled from scratch.

**Current Behavior**:
```python
# scheduler.py:115-126
if status in ("done", "killed"):
    scheduled[issue.key] = ScheduledIssue(start_date=config.start_date, ...)
```
- "Done" tasks: Placed at start date with 0 duration ✅
- "In Progress" tasks: Treated like "To Do" - full duration scheduled ❌

**Expected Behavior**:
- If a task is "In Progress", it's **already** consuming an assignee slot
- Timeline should show it starting before current date (or at current date if just started)
- Remaining work should be estimated based on progress

**Impact**: Active work is invisible; resource conflicts go undetected.

---

### ❌ Problem 3: **No Validation of Impossible Schedules**

**Issue**: The planner doesn't flag violations, just produces an infeasible schedule.

**Scenarios that should fail but don't**:

1. **Team with 3 people has 5 concurrent tasks**: Currently allowed (team has 3 slots but algorithm might stack tasks)
2. **Person A assigned to 2 in-progress tasks**: Both show as ongoing
3. **Task starts before its dependency completes**: Dependency logic should catch this, but no explicit validation

**Missing Features**:
- ❌ Warning if team capacity exceeded
- ❌ Highlight when assignee has overlapping tasks
- ❌ Visual indicator of constraint violations

---

### ❌ Problem 4: **No Assignee-Specific WIP Limits**

**Issue**: Even if team has capacity, individual can only work on 1 task at a time (or user-defined WIP limit per person).

**Current Behavior**:
- Team WIP = 1.0 → max 1 concurrent task per team member
- If John's on vacation, his slot is still counted as available

**Desired Behavior**:
- Track per-assignee availability: `assignee_available_at[assignee] = end_week`
- When scheduling task assigned to John:
  - Use John's slot
  - If John already has task, find next available slot or delay task
- Handle unassigned tasks separately

**Code Location**: `scheduler.py:build_lane_capacities()` - needs per-assignee tracking

---

## Proposed Improvements

### 🎯 Phase 1: Per-Assignee Capacity Tracking

**Goal**: Enforce that one person can't be on multiple tasks simultaneously.

#### Changes Required

**Backend (`scheduler.py`)**:

1. **New data structure**:
   ```python
   class LaneCapacity:
       lane: str
       slot_count: int
       capacity_factor: float
       available_at: list[float]  # Current: list of slot availability times
       # NEW:
       assignee_slots: dict[str, int]  # assignee_name -> slot_index
       assignee_available_at: dict[str, float]  # assignee_name -> end_week
   ```

2. **Modified scheduling logic** (`schedule_issues`):
   ```python
   # For each issue:
   issue_assignee = issue.assignee or None

   if issue_assignee:
       # Check if assignee already has a task
       if issue_assignee in lane_capacity.assignee_available_at:
           assignee_ready = lane_capacity.assignee_available_at[issue_assignee]
           start_week = max(dep_end, assignee_ready)
       else:
           # Assignee is free, find an available slot
           slot_index = min(range(slot_count), key=lambda i: available_at[i])
           start_week = max(dep_end, available_at[slot_index])
           lane_capacity.assignee_slots[issue_assignee] = slot_index

       lane_capacity.assignee_available_at[issue_assignee] = start_week + duration_weeks
   else:
       # Unassigned task: use any available slot
       slot_index = min(range(slot_count), key=lambda i: available_at[i])
       start_week = max(dep_end, available_at[slot_index])
       available_at[slot_index] = start_week + duration_weeks
   ```

3. **Return assignee conflict warnings**:
   ```python
   warnings = []
   for assignee, slot in assignee_slots.items():
       if count(assignee in tasks) > 1:
           warnings.append({
               'type': 'assignee_overload',
               'assignee': assignee,
               'tasks': [key for key, issue in scheduled if issue.assignee == assignee]
           })
   ```

**Frontend (`jira-dashboard.html`)**:

4. **Visual indicators**:
   - Add CSS class `.scenario-task-conflict` for overlapping assignee tasks
   - Show warning icon on task bar
   - Tooltip shows "⚠️ Assignee has concurrent tasks"

5. **Lane mode: Add "assignee" mode to UI**:
   ```javascript
   <select value={scenarioLaneMode} onChange={(e) => setScenarioLaneMode(e.target.value)}>
       <option value="team">Team</option>
       <option value="epic">Epic</option>
       <option value="assignee">Assignee</option>  {/* NEW */}
   </select>
   ```

---

### 🎨 Visual Pattern: Red Highlighting for Developer Capacity Stacking

**Core Concept**: When a developer is assigned to multiple overlapping tasks, highlight all conflicting tasks in **red** to immediately show over-allocation.

#### Why This Works

- **Instant visual feedback**: Red = problem, no interpretation needed
- **Simple implementation**: Frontend-only detection, no backend changes required
- **Clear pattern**: Stacked = bad, spread out = good
- **Actionable**: User can immediately see which assignee needs rebalancing

#### Detection Algorithm

```javascript
// Pseudo-code for conflict detection
function detectAssigneeConflicts(issues) {
    const conflicts = new Set();
    const assigneeMap = new Map(); // assignee -> [tasks]

    // Group tasks by assignee
    issues.forEach(issue => {
        if (!issue.assignee) return; // Skip unassigned
        if (!issue.start || !issue.end) return; // Skip unscheduled

        if (!assigneeMap.has(issue.assignee)) {
            assigneeMap.set(issue.assignee, []);
        }
        assigneeMap.get(issue.assignee).push({
            key: issue.key,
            start: parseDate(issue.start),
            end: parseDate(issue.end)
        });
    });

    // Check for overlaps within each assignee
    assigneeMap.forEach((tasks, assignee) => {
        if (tasks.length < 2) return; // Single task = no conflict

        // Sort by start date
        tasks.sort((a, b) => a.start - b.start);

        // Check each pair for overlap
        for (let i = 0; i < tasks.length; i++) {
            for (let j = i + 1; j < tasks.length; j++) {
                const task1 = tasks[i];
                const task2 = tasks[j];

                // If task1 ends after task2 starts = overlap
                if (task1.end > task2.start) {
                    conflicts.add(task1.key);
                    conflicts.add(task2.key);
                }
            }
        }
    });

    return conflicts; // Set of issue keys with conflicts
}
```

#### Visual Implementation

**CSS Styles** (matching current palette):
```css
/* Normal task bar (existing) */
.scenario-bar {
    background: rgba(59, 130, 246, 0.16); /* Blue - existing */
    border: 1px solid rgba(59, 130, 246, 0.5);
}

/* Conflict: Red highlighting (matches .critical color) */
.scenario-bar.assignee-conflict {
    background: rgba(207, 19, 34, 0.16); /* Red - matches critical */
    border: 2px solid #cf1322;
    box-shadow: 0 0 8px rgba(207, 19, 34, 0.3);
}

/* Out of sprint: Orange highlighting (matches .late color) */
.scenario-bar.out-of-sprint {
    background: rgba(212, 56, 13, 0.16); /* Orange */
    border: 2px solid #d4380d;
}

/* Optional: pulse animation for attention */
.scenario-bar.assignee-conflict {
    animation: conflict-pulse 2s ease-in-out infinite;
}

@keyframes conflict-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
}
```

**HTML Integration** (existing scenario bar):
```javascript
<a
    className={`scenario-bar
        ${issue.isCritical ? 'critical' : ''}
        ${issue.isLate ? 'late' : ''}
        ${assigneeConflicts.has(issue.key) ? 'assignee-conflict' : ''}  // NEW
    `}
    // ... rest of props
>
```

**Tooltip Enhancement**:
```
KEY-123: Implement login flow
Assigned to: John Doe
Sprint: 2026Q1 Week 2-3

⚠️ ASSIGNEE CONFLICT
John Doe is also assigned to:
  • KEY-456 (Week 2-4) - overlaps by 2 weeks
  • KEY-789 (Week 3-5) - overlaps by 1 week
```

#### Example Scenarios

**Before (no highlighting)**:
```
Team: Backend
  Week 1-3: [Task A - John] [Task B - Mary]
  Week 2-4: [Task C - John]  ← Problem invisible
```

**After (with red highlighting)**:
```
Team: Backend
  Week 1-3: [🔴 Task A - John] [Task B - Mary]
  Week 2-4: [🔴 Task C - John]  ← Both red = conflict visible
```

#### Epic Lane Mode Specific Behavior

When in **epic lane mode**, conflicts should still be highlighted across epics:

```
Epic: User Authentication
  Week 1-3: [🔴 Login API - John]

Epic: Payment Integration
  Week 2-4: [🔴 Payment Gateway - John]  ← Same John, different epic
```

**Why this matters**: In epic mode, you're focused on product delivery. Red highlighting ensures you don't miss cross-epic resource conflicts.

#### Team Lane Mode Specific Behavior

```
Team: Backend (5 people)
  Week 1-3: [🔴 Task A - John] [Task B - Mary] [🔴 Task C - John]
  Week 3-5: [Task D - Alice]
```

**Visual benefit**: Immediately see that John is double-booked while Alice has capacity.

#### Assignee Lane Mode (Future)

```
John Doe (Backend)
  Week 1-3: [🔴 Task A]
  Week 2-4: [🔴 Task C]  ← All John's tasks in one lane, conflicts obvious

Mary Smith (Backend)
  Week 1-3: [Task B]  ← No conflicts
```

**Maximum clarity**: All assignee's work in one lane makes stacking painfully obvious.

#### Implementation Priority

**Phase 1A (MVP - 2-3 days)**:
1. Add `detectAssigneeConflicts()` function
2. Add CSS class `.assignee-conflict` with red styling
3. Apply class to conflicting task bars
4. Update tooltip to show conflict details

**Phase 1B (Polish - 1 day)**:
5. Add pulse animation for conflicts
6. Add conflict count to lane headers: "⚠️ 3 conflicts"
7. Click conflict to highlight all related tasks

**Phase 1C (Advanced - 1 day)**:
8. Add filters: "Show only conflicts" toggle
9. Add conflict summary panel (like warnings panel)
10. Export conflicts to CSV

---

### 🎯 Phase 2: Handle In-Progress Tasks

**Goal**: Show active work on the timeline; reduce available capacity.

#### Changes Required

**Backend (`scheduler.py`)**:

1. **Detect in-progress tasks**:
   ```python
   # After topo_sort, partition issues:
   in_progress = [issue for issue in issues if issue.status.lower() in ("in progress", "in review", "in dev")]
   to_schedule = [issue for issue in issues if issue not in in_progress]

   # Schedule in-progress first, using status transition date + 50% estimation
   for issue in in_progress:
       # Use status transition date, round to Monday if not on Monday
       status_change_date = issue.status_change_date or config.current_date
       if status_change_date.weekday() != 0:  # Not Monday
           days_since_monday = status_change_date.weekday()
           status_change_date = status_change_date - timedelta(days=days_since_monday)

       # Assume 50% done (no time tracking available)
       elapsed_weeks = (issue.duration_weeks or 0) * 0.5
       start_date = status_change_date
       end_date = start_date + timedelta(weeks=issue.duration_weeks)

       scheduled[issue.key] = ScheduledIssue(
           start_date=start_date,
           end_date=end_date,
           duration_weeks=issue.duration_weeks,
           scheduled_reason="in_progress",
           progress_pct=0.5  # Fixed 50% for all in-progress tasks
       )

       # Mark assignee/slot as occupied until end_date
       if issue.assignee:
           lane_capacity.assignee_available_at[issue.assignee] = \
               (end_date - config.start_date).days / 7.0
   ```

2. **Return in-progress metadata**:
   ```python
   scheduled_issue = {
       'key': issue.key,
       'start': start_date.isoformat(),
       'end': end_date.isoformat(),
       'duration_weeks': duration_weeks,
       'is_in_progress': True,  # NEW
       'progress_pct': 0.5  # NEW: estimated completion %
   }
   ```

**Frontend**:

3. **Visual distinction**:
   - Add CSS class `.scenario-task-in-progress`
   - Different color (e.g., yellow/orange) vs scheduled (blue)
   - Striped pattern to show "ongoing"

4. **Tooltip enhancement**:
   ```
   KEY-123: Implement feature
   Status: In Progress (50% estimated)
   Assigned to: John Doe
   Started: 2 weeks ago
   Expected completion: 1 week
   ```

---

### 🎯 Phase 3: Validation & Warnings UI

**Goal**: Surface constraint violations to the user.

#### Changes Required

**Backend (`scheduler.py`)**:

1. **Validation function**:
   ```python
   def validate_schedule(scheduled, lane_capacities, issues):
       warnings = []

       # Check 1: Team capacity exceeded
       for lane, capacity in lane_capacities.items():
           concurrent_tasks = count_concurrent(scheduled, lane, capacity.slot_count)
           if concurrent_tasks > capacity.slot_count:
               warnings.append({
                   'type': 'team_overcapacity',
                   'lane': lane,
                   'max_capacity': capacity.slot_count,
                   'peak_usage': concurrent_tasks
               })

       # Check 2: Assignee has overlapping tasks
       assignee_tasks = defaultdict(list)
       for key, sched in scheduled.items():
           issue = issue_map[key]
           if issue.assignee:
               assignee_tasks[issue.assignee].append((key, sched.start_date, sched.end_date))

       for assignee, tasks in assignee_tasks.items():
           tasks.sort(key=lambda t: t[1])  # Sort by start date
           for i in range(len(tasks) - 1):
               if tasks[i][2] > tasks[i+1][1]:  # end > next_start
                   warnings.append({
                       'type': 'assignee_overlap',
                       'assignee': assignee,
                       'tasks': [tasks[i][0], tasks[i+1][0]]
                   })

       # Check 3: Late tasks (exceed sprint end)
       for key, sched in scheduled.items():
           if sched.end_date > config.quarter_end_date:
               warnings.append({
                   'type': 'late_task',
                   'key': key,
                   'end_date': sched.end_date.isoformat(),
                   'sprint_end': config.quarter_end_date.isoformat()
               })

       return warnings
   ```

2. **Return warnings in API response**:
   ```python
   return jsonify({
       'scheduled': scheduled_issues,
       'warnings': validation_warnings,  # NEW
       'critical_path': critical_issues,
       'config': config_used
   })
   ```

**Frontend**:

3. **Warnings panel** (similar to missing info alerts):

   **Data Source**: Frontend-computed from scenario data (no new API calls needed)

   ```javascript
   // Compute warnings from existing scenario timeline issues
   const scenarioWarnings = React.useMemo(() => {
       const warnings = [];

       // Check assignee conflicts (already have conflict detection)
       scenarioAssigneeConflicts.forEach(issueKey => {
           const issue = scenarioIssueByKey.get(issueKey);
           const assignee = issue?.assignee;
           if (assignee) {
               const conflictingTasks = scenarioTimelineIssues
                   .filter(t => t.assignee === assignee && scenarioAssigneeConflicts.has(t.key))
                   .map(t => t.key);

               warnings.push({
                   type: 'assignee_overlap',
                   assignee: assignee,
                   tasks: conflictingTasks
               });
           }
       });

       // Check tasks ending after sprint
       scenarioTimelineIssues.forEach(issue => {
           if (issue.end && parseScenarioDate(issue.end) > scenarioViewEnd) {
               warnings.push({
                   type: 'out_of_sprint',
                   key: issue.key,
                   end_date: issue.end
               });
           }
       });

       return warnings;
   }, [scenarioTimelineIssues, scenarioAssigneeConflicts, scenarioViewEnd]);

   // Render warnings panel
   {scenarioWarnings.length > 0 && (
       <div className="scenario-warnings-panel">
           <h4>⚠️ Schedule Warnings ({scenarioWarnings.length})</h4>
           {scenarioWarnings.map((warn, idx) => (
               <div key={idx} className={`warning-${warn.type}`}>
                   {warn.type === 'assignee_overlap' && (
                       <>
                           <strong>{warn.assignee}</strong> has overlapping tasks:
                           {warn.tasks.map(key => <a href={`#${key}`}>{key}</a>)}
                       </>
                   )}
                   {warn.type === 'out_of_sprint' && (
                       <>
                           Task <strong>{warn.key}</strong> extends beyond sprint end:
                           {warn.end_date}
                       </>
                   )}
               </div>
           ))}
       </div>
   )}
   ```

4. **Task-level warning badges**:
   - Add icon to task bar if it's part of a warning
   - Click icon to jump to warnings panel

---

## Implementation Roadmap

### 🚀 Phase 1A: Red Highlighting MVP (2-3 days) - **PRIORITY**

**Goal**: Make assignee conflicts visible immediately with red highlighting.

- [ ] **Frontend only**: Add `detectAssigneeConflicts()` function in React
- [ ] Add CSS class `.assignee-conflict` with red background (#ff4d4f)
- [ ] Apply conflict detection to scenario timeline issues
- [ ] Add red class to conflicting task bars
- [ ] Update tooltip to show "⚠️ Assignee has concurrent tasks"
- [ ] Test in team mode and epic mode

**Why first**: Zero backend changes, immediate visual impact, solves core problem.

**Deliverable**: Users see red bars when developer is double-booked.

---

### Phase 1B: Conflict Details (1 day)

- [ ] Show conflict count in lane headers: "Backend Team (⚠️ 3 conflicts)"
- [ ] Add pulse animation to conflicting tasks
- [ ] Tooltip lists all overlapping tasks for that assignee
- [ ] Add "Show only conflicts" filter toggle

---

### Phase 1C: Backend Assignee Tracking (2-3 weeks)

**Goal**: Scheduler prevents conflicts instead of just highlighting them.

- [ ] Add per-assignee capacity tracking to `LaneCapacity` model
- [ ] Modify `schedule_issues()` to assign tasks to specific assignee slots
- [ ] Serialize tasks for same assignee (task C waits for task A to finish)
- [ ] Return assignee metadata in scheduled issue response
- [ ] Frontend: Enable "Assignee" lane mode in UI

**Deliverable**: Scheduler produces conflict-free schedules by default.

---

### Phase 2: In-Progress Handling (1-2 weeks)

- [ ] Backend: Detect in-progress tasks by status
- [ ] Backend: Pre-schedule in-progress tasks before "to do"
- [ ] Backend: Mark slots/assignees as occupied by active work
- [ ] Frontend: Add visual styling for in-progress tasks (yellow/orange)
- [ ] Frontend: Update tooltips to show progress/status

---

### Phase 3: Validation & Warnings Panel (2 weeks)

- [ ] Backend: Implement `validate_schedule()` function
- [ ] Backend: Add warnings array to `/api/scenario` response
- [ ] Frontend: Create warnings panel component (like missing info alerts)
- [ ] Frontend: Add warning badges to task bars
- [ ] Frontend: Click-to-scroll from warning to task
- [ ] Add conflict summary: "5 assignees over-allocated, 12 tasks affected"

---

### Phase 4: Polish & Edge Cases (1 week)

- [ ] Handle unassigned tasks (use team capacity pool)
- [ ] Support custom WIP limits per assignee (future)
- [ ] Add "What-if" mode: manually reassign tasks and re-run scheduler
- [ ] Export schedule to CSV/Excel with warnings
- [ ] Epic lane mode: Show team capacity annotations on epic headers

---

## Epic Lane Mode: Specific Improvements

### Current Behavior
- Groups tasks by epic
- No capacity constraints shown
- Collapsed view shows 1 row per epic
- Useful for product planning ("What's in this epic?")

### Problems
1. **No indication of team bottlenecks**: Can't see if multiple epics depend on same team
2. **No resource leveling**: Tasks within epic may overload a team
3. **Dependencies across epics hidden**: Only shows intra-epic dependencies clearly

### Proposed Enhancements

#### 1. **Show Team Annotations on Epic Lanes**

Add small team chips to epic header:
```
Epic: User Authentication (8 tasks, 21 SP)
  Teams: Backend (12 SP), Frontend (9 SP)
  ⚠️ Backend team is at 120% capacity
```

#### 2. **Capacity Heatmap Mode**

Toggle view to show "team load per epic":
```
Epic 1: ████████░░ (80% Backend capacity)
Epic 2: ███████░░░ (70% Frontend capacity)
Epic 3: ██████████ (100% Backend) ⚠️
```

#### 3. **Inter-Epic Dependency Highlighting**

When Epic A blocks Epic B:
- Draw edge from Epic A lane to Epic B lane
- Show "Epic B starts 2 weeks after Epic A" tooltip
- Highlight critical path through epics

#### 4. **Drill-Down Mode**

Click epic to expand into "mini-team-view":
```
Epic: User Authentication
  ├─ Backend Lane (3 people)
  │   ├─ Task A (John, Week 1-2)
  │   └─ Task B (Mary, Week 2-3)
  └─ Frontend Lane (2 people)
      └─ Task C (Alice, Week 3-4)
```

---

## Example: Before & After

### Before (Current - No Conflict Detection)

**Visual Timeline**:
```
Team: Backend (5 people)
┌─────────────────────────────────────┐
│ Week 1-2: [Task A - John]           │
│           [Task B - Mary]           │
│           [Task C - John]           │ ← John on 2 tasks at once!
│ Week 3-4: [Task D - Alice]          │
└─────────────────────────────────────┘
```

**Problems**:
- ❌ John assigned to Task A and Task C simultaneously (Week 1-2)
- ❌ No visual indicator of the conflict
- ❌ User must manually scan assignee names to find issues
- ❌ Schedule looks valid but is physically impossible

---

### After Phase 1A: Red Highlighting (2-3 days implementation)

**Important**: Red highlighting ONLY appears if John is stacked (multiple tasks at same time). If tasks can be aligned sequentially, they should be arranged one after another in epic view without red highlighting.

**Visual Timeline (Team Mode)**:
```
Team: Backend (5 people)
┌─────────────────────────────────────┐
│ Week 1-2: [🔴 Task A - John]        │ ← RED (conflict: same time)
│           [Task B - Mary]           │
│           [🔴 Task C - John]        │ ← RED (same assignee overlap)
│ Week 3-4: [Task D - Alice]          │
└─────────────────────────────────────┘
```

**Visual Timeline (Epic Mode - No Stack)**:
```
Epic: User Authentication
┌─────────────────────────────────────┐
│ Week 1-2: [Task A - John]           │ ← No red (sequential)
│ Week 2-3: [Task C - John]           │ ← Aligned after Task A
│ Week 1-3: [Task B - Mary]           │
└─────────────────────────────────────┘
```

**Visual Timeline (Epic Mode - With Stack)**:
```
Epic: User Authentication
┌─────────────────────────────────────┐
│ Week 1-2: [🔴 Task A - John]        │ ← RED (conflict detected)
│           [🔴 Task C - John]        │ ← RED (stacked at same time)
│ Week 1-3: [Task B - Mary]           │
└─────────────────────────────────────┘
```

**Improvements**:
- ✅ **Red bars only for actual time conflicts** - sequential tasks stay blue
- ✅ Hover tooltip: "⚠️ John Doe has concurrent tasks: KEY-456 (Week 1-2)"
- ✅ Frontend-only change, no backend required
- ✅ Works in both team mode and epic mode

**User Action**: Now aware of conflict, can manually reassign Task C to Mary or Alice.

---

### After Phase 1C: Backend Conflict Prevention (3 weeks implementation)

**Visual Timeline**:
```
Team: Backend (5 people)
┌─────────────────────────────────────┐
│ Week 1-2: [Task A - John]           │
│           [Task B - Mary]           │
│ Week 2-3: [Task C - John]           │ ← Automatically delayed (no overlap)
│ Week 3-4: [Task D - Alice]          │
└─────────────────────────────────────┘
```

**Improvements**:
- ✅ Scheduler automatically serializes John's tasks
- ✅ Task C waits for Task A to finish
- ✅ No manual intervention needed
- ✅ Schedule is guaranteed conflict-free

---

### After Phase 2-3: Full Implementation

**Visual Timeline**:
```
Team: Backend (5 people, 3 in-progress)
┌─────────────────────────────────────┐
│ Week 1-2: [🟡 Task A - John]        │ ← Yellow (in progress, 50% done)
│           [🟡 Task B - Mary]        │ ← Yellow (in progress, 30% done)
│ Week 2-3: [Task C - John]           │ ← Blue (scheduled, waits for A)
│ Week 3-4: [Task D - Alice]          │
└─────────────────────────────────────┘

⚠️ Warnings Panel (2):
  1. Backend team: 2 active tasks reduce available slots to 3
  2. Task C start delayed by 1 week due to John's availability
```

**Improvements**:
- ✅ In-progress work shown in yellow with progress indicator
- ✅ Active tasks reduce available capacity
- ✅ Warnings panel explains schedule constraints
- ✅ Timeline reflects reality (past + future)

---

## Data Requirements

### New Jira Fields to Fetch
- `status` (already fetched, now used differently)
- `assignee` (already fetched, now enforced)
- `statuscategorychangedate` (status transition date, for in-progress tasks)

**Note**: Time tracking fields NOT used - estimation based on status transition date + 50% assumption

### New API Response Fields
```json
{
  "scheduled": [
    {
      "key": "KEY-123",
      "start": "2026-02-01",
      "end": "2026-02-15",
      "duration_weeks": 2.0,
      "lane": "Backend",
      "assignee": "John Doe",
      "is_in_progress": true,
      "progress_pct": 0.5,
      "conflicts": ["KEY-456"]  // Other tasks overlapping with this assignee
    }
  ],
  "warnings": [
    {
      "type": "assignee_overlap",
      "assignee": "John Doe",
      "tasks": ["KEY-123", "KEY-456"],
      "overlap_weeks": 1.0
    }
  ]
}
```

---

## Decisions Made

1. **Unassigned tasks**: ✅ Add "Unassigned" pseudo-lane with team's total capacity

2. **WIP limit per person**: ✅ Default=1 task at a time
   - Single task: Stack normally (blue)
   - Multiple tasks: Prolong timeline (sequential scheduling)
   - Time overlap: Red highlighting (conflict)
   - Out of sprint: Red highlighting (late)

3. **Partially completed tasks**: ✅ No time tracking available
   - Use status transition date (rounded to Monday)
   - Assume 50% completion for all in-progress tasks
   - Estimation based on weeks (1 SP = 2 weeks)

4. **Cross-team dependencies**: ✅ No coordination buffer needed
   - Already included in SP estimation (1 SP = 2 weeks)
   - Handoff time part of task estimates

5. **Epic lane mode validation**: ✅ Show warnings if epic's tasks exceed team capacity

---

## Success Metrics

### Phase 1 Success Criteria
- [ ] No assignee appears on 2+ concurrent tasks without warning
- [ ] "Assignee" lane mode groups tasks correctly
- [ ] Conflict warnings appear in API response

### Phase 2 Success Criteria
- [ ] In-progress tasks show as active on timeline
- [ ] Assignee slots marked as occupied by active work
- [ ] Timeline starts in past for in-progress tasks

### Phase 3 Success Criteria
- [ ] Warnings panel shows all constraint violations
- [ ] Click warning to jump to conflicting task
- [ ] Schedule export includes warnings

### Overall Goal
**"The scenario planner produces schedules that are physically possible for the team to execute."**

---

## Next Steps

1. **Review this proposal**
2. **Prioritize phases** based on business impact
3. **Spike: Assignee tracking** (1 day) - prove feasibility
4. **Design UI mockups** for warnings panel
5. **Start Sprint 1 implementation**
