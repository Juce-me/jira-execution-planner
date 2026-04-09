# Incomplete Stories Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give incomplete stories distinct visual treatment in Catch Up cards (amber + ◐ icon) and scenario bars (two-tone partial fill), with proper scheduler placement (after regular work, consuming capacity, extending past sprint end).

**Architecture:** Backend scheduler handles incomplete as a dedicated post-pass (after regular tasks, consuming assignee slots). Jira `timetracking` field is fetched for progress ratio. Frontend adds CSS classes and conditional rendering for both Catch Up cards and scenario bars.

**Tech Stack:** Python (scheduler, Jira API), React JSX (dashboard.jsx), CSS (dashboard.css), Node.js tests

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `planning/scheduler.py` lines 34, 133-147 | Remove `incomplete` from `DONE_STATUSES`, add post-pass scheduling |
| Modify | `jira_server.py` line 3218-3229 | Add `timetracking` to scenario fields list |
| Modify | `jira_server.py` line 3542-3567 | Pass `timeSpentSeconds` in response |
| Modify | `frontend/src/dashboard.jsx` line 152-153 | Merge `showDone` toggle to include incomplete |
| Modify | `frontend/src/dashboard.jsx` line 4711-4718 | Add `incompleteTasks` memo |
| Modify | `frontend/src/dashboard.jsx` line 6923-6929 | Add incomplete to done filter logic |
| Modify | `frontend/src/dashboard.jsx` line 13205-13220 | Merge done/incomplete toggle button |
| Modify | `frontend/src/dashboard.jsx` line 13322-13324 | Add `isIncomplete` detection |
| Modify | `frontend/src/dashboard.jsx` line 13422 | Add `status-incomplete` class |
| Modify | `frontend/src/dashboard.jsx` line 13442 | Add ◐ icon before title |
| Modify | `frontend/src/dashboard.jsx` line 11737-11741 | Add `isIncomplete` and `incomplete` class to scenario bar |
| Modify | `frontend/dist/dashboard.css` | Add `.task-status.incomplete`, `.task-item.status-incomplete`, `.scenario-bar.incomplete` |

---

## Task 1: Scheduler — separate incomplete from done

**Files:**
- Modify: `planning/scheduler.py`

- [ ] **Step 1.1: Remove `incomplete` from DONE_STATUSES**

In `planning/scheduler.py`, line 34:

```python
DONE_STATUSES = {"done", "killed", "incomplete"}
```

Change to:

```python
DONE_STATUSES = {"done", "killed"}
INCOMPLETE_STATUS = "incomplete"
```

- [ ] **Step 1.2: Add incomplete post-pass after the main scheduling loop**

Find the end of the main scheduling loop (after `all_results = {**scheduled, **unschedulable}` at line 370). Insert the incomplete post-pass BEFORE that line:

```python
    # Post-pass: schedule incomplete tasks after all regular work.
    # They consume assignee time slots (the work happened) and are placed
    # sequentially after the assignee's last scheduled task, extending past
    # sprint end to show the sprint overflowed.
    incomplete_issues = [
        issue for issue in issues
        if normalize_status(issue.status) == INCOMPLETE_STATUS
        and issue.key not in scheduled
        and issue.key not in unschedulable
    ]
    for issue in incomplete_issues:
        lane = issue.team or "Unassigned"
        if config.lane_mode == "assignee":
            lane = issue.assignee or issue.team or "Unassigned"
        lane_capacity = capacities.get(lane)
        if not lane_capacity:
            continue
        duration_weeks = compute_duration_weeks(
            issue.story_points,
            config.sp_to_weeks,
            lane_capacity.capacity_factor,
        )
        if duration_weeks is None:
            unschedulable[issue.key] = ScheduledIssue(
                key=issue.key,
                summary=issue.summary,
                lane=lane,
                start_date=None,
                end_date=None,
                blocked_by=dependencies.get(issue.key, []),
                scheduled_reason="missing_story_points",
                assignee=issue.assignee,
            )
            continue
        issue_assignee = issue.assignee
        if issue_assignee and issue_assignee in lane_capacity.assignee_available_at:
            start_week = lane_capacity.assignee_available_at[issue_assignee]
        else:
            # No prior work for this assignee — start at anchor
            anchor = config.anchor_date or config.start_date
            start_week = max(0.0, (anchor - config.start_date).days / 7.0)
        end_week = start_week + duration_weeks
        start_date = config.start_date + timedelta(weeks=start_week)
        end_date = config.start_date + timedelta(weeks=end_week)
        if issue_assignee:
            lane_capacity.assignee_available_at[issue_assignee] = end_week
        scheduled[issue.key] = ScheduledIssue(
            key=issue.key,
            summary=issue.summary,
            lane=lane,
            start_date=start_date,
            end_date=end_date,
            blocked_by=dependencies.get(issue.key, []),
            scheduled_reason="incomplete",
            duration_weeks=duration_weeks,
            assignee=issue.assignee,
        )

    all_results = {**scheduled, **unschedulable}
```

Note: remove the existing `all_results` line and replace with the block above ending with the same line.

- [ ] **Step 1.3: Run existing tests**

```bash
.venv/bin/python -m pytest tests/ -v --timeout=30
```

Expected: all existing tests pass (the scheduler change should not break done/killed handling).

- [ ] **Step 1.4: Commit**

```bash
git add planning/scheduler.py
git commit -m "Schedule incomplete stories after regular work, consuming assignee capacity"
```

---

## Task 2: Backend — fetch timetracking and pass timeSpentSeconds

**Files:**
- Modify: `jira_server.py`

- [ ] **Step 2.1: Add `timetracking` to scenario fields list**

In `jira_server.py`, find the `fields_list` at line ~3218:

```python
        fields_list = [
            'summary',
            'status',
            'priority',
            'issuetype',
            'assignee',
            'updated',
            get_story_points_field_id(),
            'parent',
            'startDate',
            'duedate',
        ]
```

Add `'timetracking'` to the list:

```python
        fields_list = [
            'summary',
            'status',
            'priority',
            'issuetype',
            'assignee',
            'updated',
            get_story_points_field_id(),
            'parent',
            'startDate',
            'duedate',
            'timetracking',
        ]
```

- [ ] **Step 2.2: Extract timeSpentSeconds in the issue-building loop**

Find the line where `jira_start_date` and `jira_due_date` are extracted (line ~3269-3270):

```python
            jira_start_date = fields.get('startDate')   # ISO string or None
            jira_due_date = fields.get('duedate')       # ISO string or None
```

Add after it:

```python
            time_tracking = fields.get('timetracking') or {}
            time_spent_seconds = time_tracking.get('timeSpentSeconds')
```

- [ ] **Step 2.3: Store timeSpentSeconds in issue_by_key**

Find the `issue_by_key[issue_obj.key]` dict construction (line ~3290). Add `timeSpentSeconds` to it:

```python
                issue_by_key[issue_obj.key] = {
                    'key': issue_obj.key,
                    'summary': issue_obj.summary,
                    'type': issue_type,
                    'team': team_name,
                    'team_id': team_id,
                    'assignee': issue_obj.assignee,
                    'sp': story_points,
                    'priority': priority,
                    'status': status,
                    'epicKey': epic_key,
                    'jiraStartDate': jira_start_date,
                    'jiraDueDate': jira_due_date,
                    'timeSpentSeconds': time_spent_seconds,
                }
```

- [ ] **Step 2.4: Pass timeSpentSeconds in the response**

Find the `response_issues.append({` block (line ~3542). Add `timeSpentSeconds`:

After the `'jiraDueDate'` line, add:

```python
                'timeSpentSeconds': entry.get('timeSpentSeconds'),
```

- [ ] **Step 2.5: Commit**

```bash
git add jira_server.py
git commit -m "Fetch Jira timetracking and pass timeSpentSeconds in scenario response"
```

---

## Task 3: Frontend — Catch Up card styling for incomplete

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`

- [ ] **Step 3.1: Add `incompleteTasks` memo**

Find line ~4715 (the `doneTasks` memo):

```javascript
            const doneTasks = React.useMemo(
                () => tasks.filter(t => t.fields.status?.name === 'Done'),
                [tasks]
            );
```

Add after it:

```javascript
            const incompleteTasks = React.useMemo(
                () => tasks.filter(t => normalizeStatus(t.fields.status?.name) === 'incomplete'),
                [tasks]
            );
```

- [ ] **Step 3.2: Add incomplete to the done filter in baseFilteredTasks**

Find line ~6928:

```javascript
                    // Filter by Done status
                    if (!showDone && task.fields.status?.name === 'Done') {
                        return false;
                    }
```

Change to:

```javascript
                    // Filter by Done/Incomplete status
                    if (!showDone && (task.fields.status?.name === 'Done' || normalizeStatus(task.fields.status?.name) === 'incomplete')) {
                        return false;
                    }
```

- [ ] **Step 3.3: Add `isIncomplete` to task card rendering**

Find line ~13323:

```javascript
                                                    const isKilled = task.fields.status?.name === 'Killed';
                                                    const isDone = task.fields.status?.name === 'Done';
```

Change to:

```javascript
                                                    const isKilled = task.fields.status?.name === 'Killed';
                                                    const isDone = task.fields.status?.name === 'Done';
                                                    const isIncomplete = normalizeStatus(task.fields.status?.name) === 'incomplete';
```

- [ ] **Step 3.4: Add `status-incomplete` to task-item className**

Find line ~13422:

```javascript
                                                            className={`task-item priority-${task.fields.priority?.name.toLowerCase()} ${isDone ? 'status-done' : ''} ${isKilled ? 'status-killed' : ''} ${isFocusActive && !isRelated ? 'is-dimmed' : ''} ${isFocused ? 'is-focused' : ''} ${isUpstream ? 'is-upstream' : ''} ${isDownstream ? 'is-downstream' : ''}`}
```

Change to:

```javascript
                                                            className={`task-item priority-${task.fields.priority?.name.toLowerCase()} ${isDone ? 'status-done' : ''} ${isKilled ? 'status-killed' : ''} ${isIncomplete ? 'status-incomplete' : ''} ${isFocusActive && !isRelated ? 'is-dimmed' : ''} ${isFocused ? 'is-focused' : ''} ${isUpstream ? 'is-upstream' : ''} ${isDownstream ? 'is-downstream' : ''}`}
```

- [ ] **Step 3.5: Add ◐ icon before task title**

Find line ~13442:

```javascript
                                                                <h3 className="task-title">
                                                                    <a href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'} target="_blank" rel="noopener noreferrer">
                                                                        {task.fields.summary}
                                                                    </a>
                                                                </h3>
```

Change to:

```javascript
                                                                <h3 className="task-title">
                                                                    {isIncomplete && <span className="task-incomplete-icon" title="Incomplete — work started but not finished this sprint">◐</span>}
                                                                    <a href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'} target="_blank" rel="noopener noreferrer">
                                                                        {task.fields.summary}
                                                                    </a>
                                                                </h3>
```

- [ ] **Step 3.6: Merge done/incomplete toggle button**

Find lines ~13205-13220:

```javascript
                                        {doneTasks.length > 0 && (
                                            <button
                                                className={`toggle ${showDone ? 'active' : ''}`}
                                                onClick={() => setShowDone(!showDone)}
                                            >
                                                {showDone ? `Hide Done Tasks (${doneTasks.length})` : `Show Done Tasks (${doneTasks.length})`}
                                            </button>
                                        )}
```

Change to:

```javascript
                                        {(doneTasks.length > 0 || incompleteTasks.length > 0) && (
                                            <button
                                                className={`toggle ${showDone ? 'active' : ''}`}
                                                onClick={() => setShowDone(!showDone)}
                                            >
                                                {showDone ? `Hide Done/Incomplete (${doneTasks.length + incompleteTasks.length})` : `Show Done/Incomplete (${doneTasks.length + incompleteTasks.length})`}
                                            </button>
                                        )}
```

- [ ] **Step 3.7: Add CSS for incomplete card and badge**

In `frontend/dist/dashboard.css`, find `.task-item.status-killed` (around line 2735). Add after the killed block:

```css
        .task-item.status-incomplete {
            background: #fffbf0;
            border-left-color: #fa8c16;
            opacity: 0.8;
        }

        .task-item.status-incomplete .task-title,
        .task-item.status-incomplete .task-inline-meta,
        .task-item.status-incomplete .task-meta {
            color: #8c6d00;
        }
```

Find `.task-status.postponed` (around line 3360). Add after it:

```css
        .task-status.incomplete {
            background: #fa8c16;
            color: white;
        }
```

Find `.task-title` styling. Add:

```css
        .task-incomplete-icon {
            margin-right: 0.3rem;
            font-size: 0.85em;
            opacity: 0.8;
        }
```

- [ ] **Step 3.8: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 3.9: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "Add incomplete story styling to Catch Up cards with amber theme and half-circle icon"
```

---

## Task 4: Frontend — scenario bar two-tone fill

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/dist/dashboard.css`

- [ ] **Step 4.1: Add `isIncomplete` detection in scenario bar rendering**

Find line ~11737:

```javascript
                                                                    const isDone = issue.scheduledReason === 'already_done';
```

Add after it:

```javascript
                                                                    const isIncomplete = issue.scheduledReason === 'incomplete';
```

- [ ] **Step 4.2: Compute progress ratio for incomplete bars**

Add after the `isIncomplete` line:

```javascript
                                                                    const incompleteProgress = isIncomplete ? (() => {
                                                                        const timeSpent = issue.timeSpentSeconds || 0;
                                                                        const sp = Number(issue.sp) || 0;
                                                                        if (timeSpent > 0 && sp > 0) {
                                                                            const spWeeks = sp * 2; // sp_to_weeks = 2.0
                                                                            const spSeconds = spWeeks * 5 * 8 * 3600; // weeks * days/week * hours/day * seconds/hour
                                                                            const ratio = Math.min(0.95, Math.max(0.05, timeSpent / spSeconds));
                                                                            return `${(ratio * 100).toFixed(0)}%`;
                                                                        }
                                                                        return '50%'; // fallback
                                                                    })() : null;
```

- [ ] **Step 4.3: Add `incomplete` class to barClassName**

Find the `barClassName` construction at line ~11741. Find `${isDone ? 'done' : ''}` and add incomplete after it:

Change:

```javascript
const barClassName = `scenario-bar ${isDone ? 'done' : ''} ${issue.isCritical ...
```

To:

```javascript
const barClassName = `scenario-bar ${isDone ? 'done' : ''} ${isIncomplete ? 'incomplete' : ''} ${issue.isCritical ...
```

- [ ] **Step 4.4: Pass progress as CSS custom property in bar style**

Find line ~11742:

```javascript
                                                                    const barStyle = { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top };
```

Change to:

```javascript
                                                                    const barStyle = isIncomplete && incompleteProgress
                                                                        ? { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top, '--incomplete-progress': incompleteProgress }
                                                                        : { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top };
```

- [ ] **Step 4.5: Add CSS for scenario bar incomplete**

In `frontend/dist/dashboard.css`, find `.scenario-bar.done` (around line 4128). Add after it:

```css
        .scenario-bar.incomplete {
            background: linear-gradient(90deg,
                rgba(34, 197, 94, 0.16) var(--incomplete-progress, 50%),
                rgba(239, 68, 68, 0.08) var(--incomplete-progress, 50%)
            );
            border: 1px solid rgba(34, 197, 94, 0.3);
            color: #888;
        }
```

- [ ] **Step 4.6: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 4.7: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "Add two-tone partial fill for incomplete stories in scenario planner"
```

---

## Task 5: Smoke test

- [ ] **Step 5.1: Run all tests**

```bash
node --test tests/test_scenario_lane_utils.js && .venv/bin/python -m pytest tests/test_scenario_single_team_filter.py -v
```

Expected: all pass.

- [ ] **Step 5.2: Manual verify — Catch Up mode**

Start server, open Catch Up. Find an incomplete story. Verify:
- Amber background tint on the card
- Amber left border
- ◐ icon before the title
- `INCOMPLETE` badge in amber
- "Hide Done/Incomplete (N)" toggle hides both done and incomplete stories

- [ ] **Step 5.3: Manual verify — Scenario planner**

Run scenario. Find an incomplete story. Verify:
- Two-tone bar: left green, right faded red
- Bar is placed after the assignee's regular work
- Bar extends past sprint end (shows overflow)
- Progress split reflects logged time (or 50% fallback)

- [ ] **Step 5.4: Commit if fixups needed**

```bash
git add -p
git commit -m "fix: incomplete stories smoke-test fixups"
```
