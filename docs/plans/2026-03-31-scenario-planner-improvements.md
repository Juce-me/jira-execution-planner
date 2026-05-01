# Scenario Planner Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four scenario planner bugs: epics disappearing in single-team view, person rows not consolidated, killed tasks visible, and excluded capacity placeholder overlapping task bars.

**Architecture:** New `scenarioLaneUtils.js` module extracts and fixes lane grouping logic (killed-task filter, assignee-primary sort, capacity placeholder row). Backend `jira_server.py` drops an erroneous single-team filter that strips out non-dependency issues. `dashboard.jsx` is wired to the new module with minimal surgical changes.

**Tech Stack:** React (dashboard.jsx), vanilla JS ESM (scenarioLaneUtils.js), Node.js built-in test runner (`node:test`), Python unittest (backend test), esbuild (`npm run build`)

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `frontend/src/scenario/scenarioLaneUtils.js` | Pure lane-grouping utilities: killed filter, assignee sort, capacity placeholder |
| Create | `tests/test_scenario_lane_utils.js` | Node.js tests for the new module |
| Modify | `jira_server.py` lines 3352–3353 | Remove single-team dependency filter |
| Modify | `frontend/src/dashboard.jsx` line 5772 | Replace `scenarioIssuesByLane` sort with `buildLaneIssues` call |
| Modify | `frontend/src/dashboard.jsx` lines 5932–5944 | Update `scenarioLaneStacking` to pin capacity placeholder to row 0 |
| Modify | `frontend/src/dashboard.jsx` line 11636 | Add `Team cap.` display name for `__team_capacity__` assignee sentinel |
| Modify | `frontend/src/dashboard.jsx` line 11640 | Add `scenario-assignee-label--team-cap` CSS class |
| Modify | `jira-dashboard.html` (inline `<style>`) | Add `.scenario-assignee-label--team-cap` CSS rule |

---

## Task 0: Create feature branch

- [ ] **Step 0.1: Create and switch to the working branch**

```bash
git checkout main && git pull origin main
git checkout -b improvement/scenario-planner-fixes
```

All subsequent commits land on this branch. Merge to `main` via PR after Task 7.

---

## Task 1: Fix epics-disappearing bug (backend)

**Files:**
- Modify: `jira_server.py:3352–3353`
- Create: `tests/test_scenario_single_team_filter.py`

- [ ] **Step 1.1: Write the failing test**

Create `tests/test_scenario_single_team_filter.py`:

```python
import unittest

class TestSingleTeamFocusFilter(unittest.TestCase):
    """Regression: single-team selection must not drop issues without dependencies."""

    def _compute_focus_keys(self, issue_by_key, adjacency, team_filter_ids):
        """Reproduce the focus_keys logic from jira_server.py lines 3342–3353."""
        focus_keys = [
            key for key in issue_by_key
            if not team_filter_ids or issue_by_key[key].get('team_id') in team_filter_ids
        ]
        # BUG: line below drops issues without deps when len(team_filter_ids) == 1
        if len(team_filter_ids) == 1:
            focus_keys = [k for k in focus_keys if adjacency.get(k)]
        return focus_keys

    def test_single_team_all_issues_included(self):
        """Issues without dependencies must appear when one team is selected."""
        issue_by_key = {
            'TASK-1': {'team_id': 'team-a', 'summary': 'No deps'},
            'TASK-2': {'team_id': 'team-a', 'summary': 'Has dep'},
        }
        adjacency = {'TASK-2': {'TASK-3'}}  # TASK-1 has no adjacency
        # Currently TASK-1 is dropped — this test must fail before the fix
        focus_keys = self._compute_focus_keys(issue_by_key, adjacency, {'team-a'})
        self.assertIn('TASK-1', focus_keys)
        self.assertIn('TASK-2', focus_keys)

if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_scenario_single_team_filter.py -v
```

Expected: FAIL — `AssertionError: 'TASK-1' not found in ['TASK-2']`

- [ ] **Step 1.3: Remove the single-team filter**

In `jira_server.py`, remove lines 3352–3353:

```python
        # DELETE THESE TWO LINES:
        if len(team_filter_ids) == 1:
            focus_keys = [key for key in focus_keys if adjacency.get(key)]
```

After deletion, lines 3342–3355 should look like:

```python
        focus_keys = [
            key for key, entry in issue_by_key.items()
            if matches_search(entry) and (not team_filter_ids or entry.get('team_id') in team_filter_ids)
        ]

        adjacency = {}
        for edge in edge_list:
            adjacency.setdefault(edge['from'], set()).add(edge['to'])
            adjacency.setdefault(edge['to'], set()).add(edge['from'])

        focus_set = set(focus_keys)
        context_keys = set()
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/test_scenario_single_team_filter.py -v
```

Expected: PASS

- [ ] **Step 1.5: Commit**

```bash
git add jira_server.py tests/test_scenario_single_team_filter.py
git commit -m "fix: include all team issues in single-team scenario view"
```

---

## Task 2: Create `scenarioLaneUtils.js` with `buildLaneIssues`

**Files:**
- Create: `frontend/src/scenario/scenarioLaneUtils.js`
- Create: `tests/test_scenario_lane_utils.js`

- [ ] **Step 2.1: Write the failing tests**

Create `tests/test_scenario_lane_utils.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('buildLaneIssues filters out killed-status issues', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildLaneIssues }) => {
        const issues = [
            { key: 'T-1', status: 'In Progress', team: 'Alpha', assignee: 'Ana', start: '2026-01-01', end: '2026-01-10' },
            { key: 'T-2', status: 'Killed', team: 'Alpha', assignee: 'Bob', start: '2026-01-02', end: '2026-01-05' },
            { key: 'T-3', status: 'killed', team: 'Alpha', assignee: 'Ana', start: '2026-01-03', end: '2026-01-08' },
            { key: 'T-4', status: 'Done', team: 'Alpha', assignee: 'Ana', start: '2026-01-04', end: '2026-01-09' },
        ];
        const laneFor = (i) => i.team || 'Unassigned';
        const result = buildLaneIssues(issues, 'team', laneFor);
        const alphaKeys = result.get('Alpha').map(i => i.key);
        assert.ok(!alphaKeys.includes('T-2'), 'Killed (capitalized) should be removed');
        assert.ok(!alphaKeys.includes('T-3'), 'killed (lowercase) should be removed');
        assert.ok(alphaKeys.includes('T-1'), 'In Progress should be kept');
        assert.ok(alphaKeys.includes('T-4'), 'Done should be kept');
    });
});

test('buildLaneIssues groups issues by lane using laneForIssue callback', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildLaneIssues }) => {
        const issues = [
            { key: 'T-1', status: 'To Do', team: 'Alpha', assignee: 'Ana', start: '2026-01-01', end: '2026-01-10' },
            { key: 'T-2', status: 'To Do', team: 'Beta', assignee: 'Bob', start: '2026-01-02', end: '2026-01-05' },
            { key: 'T-3', status: 'To Do', team: 'Alpha', assignee: 'Carl', start: '2026-01-03', end: '2026-01-08' },
        ];
        const laneFor = (i) => i.team || 'Unassigned';
        const result = buildLaneIssues(issues, 'team', laneFor);
        assert.equal(result.get('Alpha').length, 2);
        assert.equal(result.get('Beta').length, 1);
    });
});

test('buildLaneIssues sorts team lanes by assignee-primary then start', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildLaneIssues }) => {
        const issues = [
            { key: 'T-1', status: 'To Do', team: 'Alpha', assignee: 'Zara', start: '2026-01-01', end: '2026-01-10' },
            { key: 'T-2', status: 'To Do', team: 'Alpha', assignee: 'Ana', start: '2026-01-05', end: '2026-01-15' },
            { key: 'T-3', status: 'To Do', team: 'Alpha', assignee: 'Ana', start: '2026-01-01', end: '2026-01-07' },
            { key: 'T-4', status: 'To Do', team: 'Alpha', assignee: null, start: '2026-01-01', end: '2026-01-05' },
        ];
        const laneFor = (i) => i.team || 'Unassigned';
        const result = buildLaneIssues(issues, 'team', laneFor);
        const keys = result.get('Alpha').map(i => i.key);
        // Ana (A) before Zara (Z), within Ana: T-3 (Jan 1) before T-2 (Jan 5), unassigned last
        assert.deepEqual(keys, ['T-3', 'T-2', 'T-1', 'T-4']);
    });
});

test('buildLaneIssues sorts non-team lanes by start date only', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildLaneIssues }) => {
        const issues = [
            { key: 'T-1', status: 'To Do', epicKey: 'E-1', assignee: 'Zara', start: '2026-01-05', end: '2026-01-15' },
            { key: 'T-2', status: 'To Do', epicKey: 'E-1', assignee: 'Ana', start: '2026-01-01', end: '2026-01-10' },
        ];
        const laneFor = (i) => i.epicKey || 'No Epic';
        const result = buildLaneIssues(issues, 'epic', laneFor);
        const keys = result.get('E-1').map(i => i.key);
        assert.deepEqual(keys, ['T-2', 'T-1']); // start-date order, not assignee order
    });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
node --test tests/test_scenario_lane_utils.js
```

Expected: fail with `Cannot find module '../frontend/src/scenario/scenarioLaneUtils.js'`

- [ ] **Step 2.3: Create `scenarioLaneUtils.js` with `buildLaneIssues`**

Create `frontend/src/scenario/scenarioLaneUtils.js`:

```js
// Scenario lane grouping utilities.
// Pure functions — no React/DOM dependencies.

const KILLED_STATUS = 'killed';

function normalizeIssueStatus(status) {
    return (status || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Groups issues into lanes, filtering out killed tasks and sorting within each lane.
 *
 * @param {object[]} issues - The flat issue list (scenarioTimelineWithSegments)
 * @param {'team'|'epic'|'assignee'} mode - Current lane mode
 * @param {function} laneForIssue - Maps an issue to its lane key (closure from dashboard.jsx)
 * @returns {Map<string, object[]>} Issues grouped by lane key
 */
export function buildLaneIssues(issues, mode, laneForIssue) {
    const groups = new Map();
    if (!issues || issues.length === 0) return groups;

    issues.forEach(issue => {
        if (normalizeIssueStatus(issue.status) === KILLED_STATUS) return;
        const lane = laneForIssue(issue);
        if (!groups.has(lane)) groups.set(lane, []);
        groups.get(lane).push(issue);
    });

    groups.forEach(list => {
        if (mode === 'team') {
            // Assignee-primary sort ensures same-person rows are always contiguous
            // within the lane stacking algorithm. Unassigned sorts last (\uffff > any letter).
            list.sort((a, b) => {
                const aA = a.assignee || '\uffff';
                const bA = b.assignee || '\uffff';
                if (aA !== bA) return aA.localeCompare(bA);
                return (a.start || '').localeCompare(b.start || '');
            });
        } else {
            list.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        }
    });

    return groups;
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
node --test tests/test_scenario_lane_utils.js
```

Expected: all 4 tests PASS

- [ ] **Step 2.5: Commit**

```bash
git add frontend/src/scenario/scenarioLaneUtils.js tests/test_scenario_lane_utils.js
git commit -m "feat: add scenarioLaneUtils with buildLaneIssues (killed filter + assignee sort)"
```

---

## Task 3: Add `buildCapacityPlaceholderRows` to `scenarioLaneUtils.js`

**Files:**
- Modify: `frontend/src/scenario/scenarioLaneUtils.js`
- Modify: `tests/test_scenario_lane_utils.js`

- [ ] **Step 3.1: Add tests for `buildCapacityPlaceholderRows`**

Append to `tests/test_scenario_lane_utils.js`:

```js
test('buildCapacityPlaceholderRows returns only excluded issues', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildCapacityPlaceholderRows }) => {
        const issues = [
            { key: 'T-1', team: 'Alpha', start: '2026-01-01', end: '2026-06-30' },
            { key: 'T-2', team: 'Alpha', start: '2026-01-01', end: '2026-03-31' },
        ];
        const excludedKeys = new Set(['T-1']);
        const result = buildCapacityPlaceholderRows(issues, excludedKeys, '2026-01-01', '2026-03-31');
        assert.equal(result.length, 1);
        assert.equal(result[0].key, 'T-1');
    });
});

test('buildCapacityPlaceholderRows clips end date to sprint end', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildCapacityPlaceholderRows }) => {
        const issues = [
            { key: 'T-1', team: 'Alpha', start: '2025-10-01', end: '2026-12-31' },
        ];
        const excludedKeys = new Set(['T-1']);
        const result = buildCapacityPlaceholderRows(issues, excludedKeys, '2026-01-01', '2026-03-31');
        assert.equal(result[0].start, '2026-01-01');
        assert.equal(result[0].end, '2026-03-31');
    });
});

test('buildCapacityPlaceholderRows does not mutate original issues', () => {
    return import('../frontend/src/scenario/scenarioLaneUtils.js').then(({ buildCapacityPlaceholderRows }) => {
        const issue = { key: 'T-1', team: 'Alpha', start: '2025-10-01', end: '2026-12-31' };
        const excludedKeys = new Set(['T-1']);
        buildCapacityPlaceholderRows([issue], excludedKeys, '2026-01-01', '2026-03-31');
        assert.equal(issue.start, '2025-10-01'); // original unchanged
        assert.equal(issue.end, '2026-12-31');
    });
});
```

- [ ] **Step 3.2: Run new tests to verify they fail**

```bash
node --test tests/test_scenario_lane_utils.js
```

Expected: the 3 new tests fail with `buildCapacityPlaceholderRows is not a function`

- [ ] **Step 3.3: Implement `buildCapacityPlaceholderRows`**

Append to `frontend/src/scenario/scenarioLaneUtils.js`:

```js
/**
 * Extracts excluded-capacity issues and clips their dates to the sprint window.
 * Used to determine which issues occupy the dedicated team-cap row (row 0).
 *
 * @param {object[]} issues - Full issue list for a lane
 * @param {Set<string>} excludedIssueKeys - Keys of excluded-capacity issues
 * @param {string} sprintStartISO - Sprint start as YYYY-MM-DD
 * @param {string} sprintEndISO   - Sprint end as YYYY-MM-DD
 * @returns {object[]} Clipped copies of the capacity placeholder issues
 */
export function buildCapacityPlaceholderRows(issues, excludedIssueKeys, sprintStartISO, sprintEndISO) {
    if (!issues || !excludedIssueKeys || !sprintStartISO || !sprintEndISO) return [];
    return issues
        .filter(issue => {
            const key = issue.originalKey || issue.key;
            return excludedIssueKeys.has(key);
        })
        .map(issue => ({
            ...issue,
            start: !issue.start || issue.start < sprintStartISO ? sprintStartISO : issue.start,
            end:   !issue.end   || issue.end   > sprintEndISO   ? sprintEndISO   : issue.end,
        }));
}
```

- [ ] **Step 3.4: Run all tests to verify they pass**

```bash
node --test tests/test_scenario_lane_utils.js
```

Expected: all 7 tests PASS

- [ ] **Step 3.5: Commit**

```bash
git add frontend/src/scenario/scenarioLaneUtils.js tests/test_scenario_lane_utils.js
git commit -m "feat: add buildCapacityPlaceholderRows with sprint-window clipping"
```

---

## Task 4: Wire `buildLaneIssues` into `dashboard.jsx`

**Files:**
- Modify: `frontend/src/dashboard.jsx` (line ~5761, the `scenarioIssuesByLane` useMemo)

- [ ] **Step 4.1: Add the import at the top of `dashboard.jsx`**

Find line 3 in `dashboard.jsx` (the existing `scenarioUtils.js` import). Add a NEW import line directly after line 4 (`import ScenarioBar ...`):

```js
import { buildLaneIssues } from './scenario/scenarioLaneUtils.js';
```

- [ ] **Step 4.2: Replace the `scenarioIssuesByLane` useMemo**

Find `const scenarioIssuesByLane = React.useMemo(() => {` at line ~5761.

Replace the entire useMemo (lines 5761–5775) with:

```js
const scenarioIssuesByLane = React.useMemo(() => {
    return buildLaneIssues(scenarioTimelineWithSegments, scenarioLaneMode, scenarioLaneForIssue);
}, [scenarioTimelineWithSegments, scenarioLaneMode, scenarioEpicFocus]);
```

- [ ] **Step 4.3: Build and verify no errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes with no errors. Warnings about bundle size are acceptable.

- [ ] **Step 4.4: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "refactor: replace scenarioIssuesByLane with buildLaneIssues (killed filter + assignee sort)"
```

---

## Task 5: Pin capacity placeholder to row 0 in stacking

**Files:**
- Modify: `frontend/src/dashboard.jsx` (lines ~5932–5944 in `scenarioLaneStacking`)
- Modify: `frontend/src/dashboard.jsx` (line 5, add `buildCapacityPlaceholderRows` to import)

- [ ] **Step 5.1: Add `buildCapacityPlaceholderRows` to the import**

Update the import added in Task 4 (line 5 of `dashboard.jsx`):

```js
import { buildLaneIssues, buildCapacityPlaceholderRows } from './scenario/scenarioLaneUtils.js';
```

- [ ] **Step 5.2: Update the stacking loop to pin capacity issues to row 0**

Find the block in `scenarioLaneStacking` (lines ~5932–5944):

```js
                    const regularIssues = [];
                    const excludedIssues = [];
                    issues.forEach((issue) => {
                        if (!issue?.key) return;
                        const issueKeyForExclude = issue.originalKey || issue.key;
                        if (scenarioExcludedIssueKeys.has(issueKeyForExclude) || excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''))) {
                            excludedIssues.push(issue);
                        } else {
                            regularIssues.push(issue);
                        }
                    });
                    assignRows(regularIssues, rowEnds, 0, rowAssignees);
                    assignRows(excludedIssues, rowEnds, 0, rowAssignees);
```

Replace with:

```js
                    const regularIssues = [];
                    const rawCapacityIssues = [];
                    issues.forEach((issue) => {
                        if (!issue?.key) return;
                        const issueKeyForExclude = issue.originalKey || issue.key;
                        if (scenarioExcludedIssueKeys.has(issueKeyForExclude) || excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''))) {
                            rawCapacityIssues.push(issue);
                        } else {
                            regularIssues.push(issue);
                        }
                    });
                    if (scenarioLaneMode === 'team' && rawCapacityIssues.length > 0) {
                        // Pin capacity placeholders to row 0 (dedicated team-cap row).
                        // Clip their dates so the row end blocks regular tasks within the sprint only.
                        // scenarioViewStart is in the deps array; scenarioDeadline must be added (see below).
                        const sprintStartISO = scenarioViewStart ? dateToISODate(scenarioViewStart) : null;
                        const sprintEndISO   = scenarioDeadline  ? dateToISODate(scenarioDeadline)  : null;
                        const clipped = sprintStartISO && sprintEndISO
                            ? buildCapacityPlaceholderRows(rawCapacityIssues, scenarioExcludedIssueKeys, sprintStartISO, sprintEndISO)
                            : rawCapacityIssues;
                        // Seed row 0: block it from regular-issue packing by setting its end to sprint end
                        const latestCapEnd = clipped.reduce((max, issue) => {
                            const d = parseScenarioDate(issue.end);
                            return d && d > max ? d : max;
                        }, new Date(0));
                        rowEnds[0] = latestCapEnd.getTime() > 0 ? latestCapEnd : new Date(8640000000000000);
                        rowAssignees[0] = '__team_capacity__';
                        clipped.forEach(issue => rowIndexByKey.set(issue.key, 0));
                        assignRows(regularIssues, rowEnds, 0, rowAssignees);
                    } else {
                        assignRows(regularIssues, rowEnds, 0, rowAssignees);
                        assignRows(rawCapacityIssues, rowEnds, 0, rowAssignees);
                    }
```

- [ ] **Step 5.2b: Add `scenarioDeadline` to the `scenarioLaneStacking` dependency array**

Find the closing `}, [` of the `scenarioLaneStacking` useMemo (currently ends at line ~5982 with `perfEnabled`). Add `scenarioDeadline` to the array:

```js
            }, [
                scenarioLanes,
                scenarioIssuesByLane,
                scenarioViewStart,
                scenarioCollapsedLanes,
                scenarioLaneMode,
                scenarioCapacityByTeam,
                scenarioExcludedIssueKeys,
                isAllTeamsSelected,
                scenarioEpicFocus,
                scenarioDeadline,
                perfEnabled
            ]);
```

- [ ] **Step 5.3: Build and verify no errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 5.4: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: pin excluded capacity placeholder to row 0 in team lane stacking"
```

---

## Task 6: Render the team-cap row label and add CSS

**Files:**
- Modify: `frontend/src/dashboard.jsx` (line ~11636, assignee label rendering)
- Modify: `jira-dashboard.html` (inline `<style>` block)

- [ ] **Step 6.1: Update assignee label display name**

Find line ~11636 in `dashboard.jsx`:

```js
                                                                    const displayName = group.assignee ? (() => { const parts = group.assignee.split(' '); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]; })() : 'Unassigned';
```

Replace with:

```js
                                                                    const isTeamCap = group.assignee === '__team_capacity__';
                                                                    const displayName = isTeamCap
                                                                        ? 'Team cap.'
                                                                        : group.assignee
                                                                        ? (() => { const parts = group.assignee.split(' '); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]; })()
                                                                        : 'Unassigned';
```

- [ ] **Step 6.2: Add CSS class to the team-cap assignee label div**

Find line ~11640:

```js
                                                                        <div key={`al-${idx}`} className="scenario-assignee-label"
                                                                             style={{ top: `${top}px`, height: `${height}px` }}
                                                                             title={group.assignee || 'Unassigned'}>
```

Replace with:

```js
                                                                        <div key={`al-${idx}`}
                                                                             className={`scenario-assignee-label${isTeamCap ? ' scenario-assignee-label--team-cap' : ''}`}
                                                                             style={{ top: `${top}px`, height: `${height}px` }}
                                                                             title={isTeamCap ? 'Reserved team capacity' : (group.assignee || 'Unassigned')}>
```

- [ ] **Step 6.3: Add CSS for the team-cap label**

Open `jira-dashboard.html`. Find the `.scenario-assignee-label` rule in the `<style>` block. Add the following rule directly after it:

```css
.scenario-assignee-label--team-cap {
    color: #b07d2a;
    font-style: italic;
    background: rgba(253, 245, 228, 0.5);
    border-radius: 0.3rem;
}
```

- [ ] **Step 6.4: Build and verify no errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 6.5: Commit**

```bash
git add frontend/src/dashboard.jsx jira-dashboard.html
git commit -m "feat: render Team cap. label with warm-yellow tint for capacity placeholder row"
```

---

## Task 7: Smoke-test all four fixes end-to-end

- [ ] **Step 7.1: Run full test suite**

```bash
node --test tests/test_scenario_lane_utils.js && node --test tests/test_future_planning_team_utils.js && .venv/bin/python -m pytest tests/test_scenario_single_team_filter.py tests/test_scenario_issue_dates.py -v
```

Expected: all tests pass.

- [ ] **Step 7.2: Manual verify — epics bug**

Start the server, select a single team (e.g. "R&D Perimeter"), switch to EPIC lane mode. Verify all epics/stories appear in the timeline (not just those with dependencies).

- [ ] **Step 7.3: Manual verify — person row consolidation**

In team lane mode, find a team where the same person had multiple disconnected row groups (e.g. "Oleg M." in R&D Distribution). Verify each person now appears as a single contiguous block with one label.

- [ ] **Step 7.4: Manual verify — killed tasks**

Confirm no killed-status tasks appear anywhere in the scenario timeline.

- [ ] **Step 7.5: Manual verify — capacity placeholder row**

Find a team that has an excluded capacity issue (Ad Hoc, Interrupt, Dev Lead, Perf Review). Verify it renders at the top of the team lane with an italic "Team cap." label and warm-yellow tint, and does not overlap regular task bars.

- [ ] **Step 7.6: Final commit if any fixups were needed**

```bash
git add -p  # review and stage any fixups
git commit -m "fix: scenario planner smoke-test fixups"
```
