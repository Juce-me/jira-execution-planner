# Shareable View Links Implementation Plan: Extractions, apply machine and hook (Tasks 6, 9 and 11)

> **Status:** Proposed 2026-10-14. Slice of [EXEC-shareable-view-links-194.md](EXEC-shareable-view-links-194.md). Read the master's Global Constraints, Review Focus and Execution status before starting. Statuses and commit SHAs are recorded once, in the master's Task 14 Step 9; keep plan files unmodified between tasks so every Step 0 sees a clean tree. Slices are grouped by area, not by execution order; the master's table gives the order.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`SUPPORT-shareable-view-links-design-194.md`](SUPPORT-shareable-view-links-design-194.md)

**Tasks in this slice:** Task 6 (`dashboard.jsx` behavior-preserving extractions, checkpoint), Task 9 (apply machine, pure), and Task 11 in three commits: 11a (controller, capture builder, interaction guard and hook), 11b (mount: hold, options, tour wait and Planning table key) and 11c (link UI acceptance spec; Task 11 checkpoint).

---

### Task 6: `dashboard.jsx` behavior-preserving extractions

**Owner note:** depends on Task 5 (it starts from `dashboard.jsx` as Task 5 left it: 7,494 lines on the validated base, with the manifest pins at 7,494 and 34,096); blocks Task 11b (the apply calls both helpers through the options object). Checkpoint task: it ends with a report and a stop (Step 10).

**Why this task exists.** The link apply must write a Sprint and a Team selection exactly the way a click does, without the click's analytics, guard or selector side effects. Two closures of `App()` hold that raw half today, welded to their callers: `applyOrdinarySprint` (the Team carry-forward through `teamSelectionCarryForwardRef`, the Sprint id and name, and the Project Track range) and `toggleTeamSelection` (the stored Team selection plus the hydrated-selection marker, written twice with identical text). Duplicating them in `shareView/` would give the carry-forward rule two owners that drift. This task extracts them as `commitSprintSelection` and `persistTeamSelection`, behavior-preserving, characterization tests first.

**Line budget.** The design estimated a net of about minus 8 lines. The extraction adds 11 lines (`dashboard.jsx` 7,494 to 7,505 on the validated base): the two helpers need their signatures and a comment each, and the call sites shrink by less than that. The manifest pins move in this commit (`dashboard.lineCount` and `lineCeiling` to the measured count, `aggregates.appPlusOwners` to that count plus the unchanged unique owners); the legacy ceiling is not edited. The alternative, skipping the extraction and duplicating about 25 lines in the apply, was rejected: it avoids a growth of +11 only by creating a second implementation of the Team carry-forward and the Project Track range write.

**Files:**
- Modify: `frontend/src/dashboard.jsx` (`applyOrdinarySprint`, `toggleTeamSelection`; two new closures declared directly above them)
- Modify: `scripts/extraction_lint/owner_budgets.json` (`dashboard` and `aggregates.appPlusOwners`)
- Create: `tests/test_share_view_extraction_characterization.js`
- Regenerated: `frontend/dist/` (by `npm run build`, never hand-edited)

**Interfaces:**
- Consumes (existing, unchanged): `buildTeamSelectionScopeKey`, `normalizeSelectedTeams`, `saveTeamSelectionState`, `teamSelectionCarryForwardRef`, `teamSelectionHydratedSelectionRef`, `teamSelectionScopeKey`, `excludedCapacityForceRefreshRef` and the Sprint, Team and range setters of `App()`.
- Produces (closures inside `App()`, declared directly above their callers; Task 11b passes both through the options object):
```
commitSprintSelection(sprint, { groupId = activeGroupId, teams = selectedTeams, sprintChanged = true, projectTrackRange = false } = {}) -> void
   // sprint = { id, name }. sprintChanged writes the Team carry-forward (null without a groupId), setSelectedSprint(sprint.id) and setSprintName(sprint.name).
   // projectTrackRange writes both Project Track range ends to String(sprint.id), forces the refresh and bumps the refresh nonce.
persistTeamSelection(nextSelectedTeams) -> void
   // saves the selection for the current scope key and records it as the hydrated selection; does nothing without a scope key; never sets React state.
```

**Forbidden regressions for this task:**
- [ ] The Sprint selector keeps its analytics (`trackFilterChanged('sprint', ...)`), its same-Sprint guard, the Board scope control behavior (`setBoardStrictScope('')` after the commit) and `closeSprintSelector({ restoreFocus: true })`: all of them stay in `applyOrdinarySprint`.
- [ ] The Teams dropdown keeps its analytics (`trackFilterChanged('team', ...)`), its insertion order, the fall back to `['all']` and the persist-inside-the-updater timing.
- [ ] No behavior change anywhere: the characterization tests below pass unchanged before and after the edit, and the UI specs that exercise Sprint and Team selection pass.
- [ ] `dashboard.jsx` grows by exactly 11 lines and the manifest pins move in this commit. No other file under `frontend/src` changes.
- [ ] Analytics impact: none (no new trigger, event or parameter; the existing events fire from the same places).

- [ ] **Step 0: Preflight and baselines**

Run every command of this task from the worktree root with `JEP_TEST_PYTHON` exported (a command may run in a fresh shell, so export it again or write the interpreter path in place of `$PY`; the extraction lint reads `JEP_TEST_PYTHON` too) and with the Python test environment typed inline exactly as the commands show it.

Run:
```bash
git branch --show-current
git status --short
wc -l frontend/src/dashboard.jsx
rg -c "const applyOrdinarySprint = \(sprint, boardScopeControl\) => \{" frontend/src/dashboard.jsx
rg -c "const toggleTeamSelection = \(teamId\) => \{" frontend/src/dashboard.jsx
fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'
fnm exec --using 20 bash scripts/extraction_lint/run.sh 2>&1 | grep -E 'problems \('
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; `7494 frontend/src/dashboard.jsx` (Task 0's baseline plus 1); the two `rg` counts are `1` and `1`; the Node summary shows `# fail 0` (write down the `# tests` number as N0); the lint line shows `0 errors` (write down the warning count as W0). If `dashboard.jsx` is not Task 0's baseline plus 1 (7,494 lines on the validated base), Task 5 did not land as planned: stop and report.

- [ ] **Step 1: Write the characterization tests**

They run the real source of the two closures with stubbed dependencies (the technique of `tests/test_dashboard_freshness_interactions.js`) and pin today's behavior. Create `tests/test_share_view_extraction_characterization.js` with exactly this content:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Characterizes two App() closures by running their real source with stubbed dependencies, the
// same technique as tests/test_dashboard_freshness_interactions.js. The first block pins the
// behavior that existed before issue #194 and must pass unchanged before and after the extraction
// of `commitSprintSelection` and `persistTeamSelection`; the second block pins the contract the
// shareable-link apply relies on.
const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');

// App() declares each helper as a 12-space-indented `const name = ...` that closes with a 12-space `};`.
function appClosure(name) {
    const start = source.indexOf(`\n            const ${name} = `);
    if (start < 0) return null;
    const end = source.indexOf('\n            };\n', start);
    assert.ok(end > start, `${name} must close with a 12-space "};"`);
    return source.slice(start + 1, end + '\n            };'.length);
}

const CLOSURES = ['normalizeSelectedTeams', 'persistTeamSelection', 'commitSprintSelection', 'applyOrdinarySprint', 'toggleTeamSelection'];

function loadClosures(deps) {
    const present = CLOSURES.filter(name => appClosure(name));
    const body = present.map(appClosure).join('\n');
    return new Function(...Object.keys(deps), `${body}\nreturn { ${present.join(', ')} };`)(...Object.values(deps));
}

let persistence;
test.before(async () => { persistence = await import('../frontend/src/teamSelectionPersistence.mjs'); });

function sprintHarness(overrides = {}) {
    const log = [];
    const deps = {
        boardStrictScope: '', selectedSprint: 41, showStats: false, statsView: 'teams',
        excludedCapacityStartSprintId: '', excludedCapacityEndSprintId: '',
        activeGroupId: 'grp-a', selectedTeams: ['team-1', 'team-2'],
        trackFilterChanged: (...args) => log.push(['trackFilterChanged', ...args]),
        analyticsToken: value => `tok:${value}`,
        currentDashboardView: () => 'eng',
        buildTeamSelectionScopeKey: (...args) => persistence.buildTeamSelectionScopeKey(...args),
        teamSelectionCarryForwardRef: { current: 'untouched' },
        setSelectedSprint: value => log.push(['setSelectedSprint', value]),
        setSprintName: value => log.push(['setSprintName', value]),
        excludedCapacityForceRefreshRef: { current: false },
        setExcludedCapacityStartSprintId: value => log.push(['setExcludedCapacityStartSprintId', value]),
        setExcludedCapacityEndSprintId: value => log.push(['setExcludedCapacityEndSprintId', value]),
        setExcludedCapacityRefreshNonce: updater => log.push(['setExcludedCapacityRefreshNonce', updater(7)]),
        setBoardStrictScope: value => log.push(['setBoardStrictScope', value]),
        closeSprintSelector: options => log.push(['closeSprintSelector', options]),
        ...overrides,
    };
    return { api: loadClosures(deps), deps, log };
}

function teamHarness(overrides = {}) {
    const log = [];
    const map = new Map();
    const storage = {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, value); log.push(['storage', Object.values(JSON.parse(value))[0].selectedTeams]); },
    };
    let teams = ['all'];
    const deps = {
        teamSelectionScopeKey: 'team-selection::42::grp-a',
        window: { localStorage: storage },
        saveTeamSelectionState: (...args) => persistence.saveTeamSelectionState(...args),
        teamSelectionHydratedSelectionRef: { current: null },
        setSelectedTeams: arg => { teams = typeof arg === 'function' ? arg(teams) : arg; log.push(['setSelectedTeams', teams]); },
        trackFilterChanged: (...args) => log.push(['trackFilterChanged', ...args]),
        bucketCount: count => `b${count}`,
        ...overrides,
    };
    return { api: loadClosures(deps), deps, log, getTeams: () => teams, storage };
}

// ---- Characterization: must pass before and after the extraction ----

test('a different Sprint reports the change, carries the Team selection forward and commits id and name', () => {
    const { api, deps, log } = sprintHarness();
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Future' }, false);
    assert.deepEqual(log, [
        ['trackFilterChanged', 'sprint', { sprint_selection_state: 'tok:future', source_surface: 'eng', scope_type: 'eng' }],
        ['setSelectedSprint', 42],
        ['setSprintName', 'Sprint 42'],
        ['closeSprintSelector', { restoreFocus: true }],
    ]);
    assert.deepEqual(deps.teamSelectionCarryForwardRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['team-1', 'team-2'] });
});

test('the Board scope control reports a Sprint scope and clears the strict scope after committing', () => {
    const { api, log } = sprintHarness();
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, true);
    assert.deepEqual(log.map(entry => entry[0]), ['trackFilterChanged', 'setSelectedSprint', 'setSprintName', 'setBoardStrictScope', 'closeSprintSelector']);
    assert.deepEqual(log[0][2], { sprint_selection_state: 'tok:active', source_surface: 'eng', scope_type: 'sprint' });
    assert.deepEqual(log[3], ['setBoardStrictScope', '']);
});

test('reselecting the current Sprint outside a strict Board scope only closes the selector', () => {
    const { api, deps, log } = sprintHarness();
    api.applyOrdinarySprint({ id: '41', name: 'Sprint 41', state: 'Active' }, false);
    assert.deepEqual(log, [['closeSprintSelector', { restoreFocus: true }]]);
    assert.equal(deps.teamSelectionCarryForwardRef.current, 'untouched');
});

test('choosing the same Sprint while a strict Board scope is active still commits it', () => {
    const { api, log } = sprintHarness({ boardStrictScope: 'component' });
    api.applyOrdinarySprint({ id: 41, name: 'Sprint 41', state: 'Active' }, true);
    assert.deepEqual(log.map(entry => entry[0]), ['trackFilterChanged', 'setSelectedSprint', 'setSprintName', 'setBoardStrictScope', 'closeSprintSelector']);
});

test('a missing Department stores no Team carry-forward', () => {
    const { api, deps, log } = sprintHarness({ activeGroupId: null });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.equal(deps.teamSelectionCarryForwardRef.current, null);
    assert.deepEqual(log.filter(entry => entry[0] === 'setSelectedSprint'), [['setSelectedSprint', 42]]);
});

test('the Team carry-forward normalizes an empty or string selection', () => {
    for (const [selection, expected] of [[[], ['all']], ['team-1', ['team-1']], [['team-2'], ['team-2']]]) {
        const { api, deps } = sprintHarness({ selectedTeams: selection });
        api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
        assert.deepEqual(deps.teamSelectionCarryForwardRef.current.selectedTeams, expected);
    }
});

test('a Sprint change on the Project Track Statistics view writes both range ends and forces a refresh', () => {
    const { api, deps, log } = sprintHarness({ showStats: true, statsView: 'projectTrack' });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.deepEqual(log.map(entry => entry[0]), [
        'trackFilterChanged', 'setSelectedSprint', 'setSprintName',
        'setExcludedCapacityStartSprintId', 'setExcludedCapacityEndSprintId', 'setExcludedCapacityRefreshNonce', 'closeSprintSelector',
    ]);
    assert.deepEqual(log.slice(3, 6), [
        ['setExcludedCapacityStartSprintId', '42'], ['setExcludedCapacityEndSprintId', '42'], ['setExcludedCapacityRefreshNonce', 8],
    ]);
    assert.equal(deps.excludedCapacityForceRefreshRef.current, true);
});

test('the Project Track range is left alone when the Sprint and range already match', () => {
    const { api, deps, log } = sprintHarness({ showStats: true, statsView: 'projectTrack', selectedSprint: 42, excludedCapacityStartSprintId: '42', excludedCapacityEndSprintId: '42' });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.deepEqual(log, [['closeSprintSelector', { restoreFocus: true }]]);
    assert.equal(deps.excludedCapacityForceRefreshRef.current, false);
});

test('the same Sprint with a stale Project Track range rewrites only the range, without analytics or a Sprint commit', () => {
    const { api, deps, log } = sprintHarness({ showStats: true, statsView: 'projectTrack', selectedSprint: 42, excludedCapacityStartSprintId: '40', excludedCapacityEndSprintId: '42' });
    api.applyOrdinarySprint({ id: 42, name: 'Sprint 42', state: 'Active' }, false);
    assert.deepEqual(log.map(entry => entry[0]), ['setExcludedCapacityStartSprintId', 'setExcludedCapacityEndSprintId', 'setExcludedCapacityRefreshNonce', 'closeSprintSelector']);
    assert.equal(deps.teamSelectionCarryForwardRef.current, 'untouched');
});

test('ticking All Teams persists the scope, records the hydrated selection and then sets the state', () => {
    const { api, deps, log, getTeams, storage } = teamHarness();
    api.toggleTeamSelection('all');
    assert.deepEqual(log, [['storage', ['all']], ['setSelectedTeams', ['all']], ['trackFilterChanged', 'team', { selection_count_bucket: '0' }]]);
    assert.deepEqual(deps.teamSelectionHydratedSelectionRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['all'] });
    assert.deepEqual(persistence.loadTeamSelectionState(storage, 'team-selection::42::grp-a').selectedTeams, ['all']);
    assert.deepEqual(getTeams(), ['all']);
});

test('ticking one Team replaces All, persists inside the update and reports the new count', () => {
    const { api, deps, log, getTeams } = teamHarness();
    api.toggleTeamSelection('team-1');
    assert.deepEqual(log, [['trackFilterChanged', 'team', { selection_count_bucket: 'b1' }], ['storage', ['team-1']], ['setSelectedTeams', ['team-1']]]);
    assert.deepEqual(deps.teamSelectionHydratedSelectionRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['team-1'] });
    assert.deepEqual(getTeams(), ['team-1']);
});

test('ticking a second Team keeps insertion order and unticking the last Team returns to All', () => {
    const { api, getTeams, storage } = teamHarness();
    api.toggleTeamSelection('team-1');
    api.toggleTeamSelection('team-2');
    assert.deepEqual(getTeams(), ['team-1', 'team-2']);
    api.toggleTeamSelection('team-2');
    api.toggleTeamSelection('team-1');
    assert.deepEqual(getTeams(), ['all']);
    assert.deepEqual(persistence.loadTeamSelectionState(storage, 'team-selection::42::grp-a').selectedTeams, ['all']);
});

test('without a scope key a Team change updates the state and persists nothing', () => {
    const { api, deps, log, getTeams } = teamHarness({ teamSelectionScopeKey: '' });
    api.toggleTeamSelection('team-1');
    api.toggleTeamSelection('all');
    assert.equal(log.some(entry => entry[0] === 'storage'), false);
    assert.equal(deps.teamSelectionHydratedSelectionRef.current, null);
    assert.deepEqual(getTeams(), ['all']);
});
```

- [ ] **Step 2: Run them and confirm they pass on the unmodified code**

Run: `fnm exec --using 20 node --test tests/test_share_view_extraction_characterization.js`

Expected: `# tests 13`, `# pass 13`, `# fail 0`. The loader skips a closure that does not exist yet, so these thirteen tests exercise `applyOrdinarySprint` and `toggleTeamSelection` as they are. If one fails, the characterization is wrong: fix the test, never the code.

- [ ] **Step 3: Append the contract tests the extraction must satisfy**

Append this block to the end of the same file (after the last test, with one blank line between):

```js
// ---- Contract for the shareable-link apply: fails until the helpers are extracted ----

test('commitSprintSelection commits a Sprint for a named Department and Team list without analytics, guard or selector side effects', () => {
    const { api, deps, log } = sprintHarness();
    assert.equal(typeof api.commitSprintSelection, 'function', 'dashboard.jsx must declare commitSprintSelection');
    api.commitSprintSelection({ id: 99, name: 'Sprint 99', state: 'Active' }, { groupId: 'grp-b', teams: ['team-9'] });
    assert.deepEqual(log, [['setSelectedSprint', 99], ['setSprintName', 'Sprint 99']]);
    assert.deepEqual(deps.teamSelectionCarryForwardRef.current, { scopeKey: 'team-selection::99::grp-b', selectedTeams: ['team-9'] });
});

test('commitSprintSelection defaults to the current Department and Team selection', () => {
    const { api, deps } = sprintHarness();
    api.commitSprintSelection({ id: 99, name: 'Sprint 99' });
    assert.deepEqual(deps.teamSelectionCarryForwardRef.current, { scopeKey: 'team-selection::99::grp-a', selectedTeams: ['team-1', 'team-2'] });
});

test('commitSprintSelection with no Department stores a null carry-forward and still commits the Sprint', () => {
    const { api, deps, log } = sprintHarness();
    api.commitSprintSelection({ id: 99, name: 'Sprint 99' }, { groupId: null });
    assert.equal(deps.teamSelectionCarryForwardRef.current, null);
    assert.deepEqual(log[0], ['setSelectedSprint', 99]);
});

test('commitSprintSelection writes the Project Track range on request and can write it alone', () => {
    const both = sprintHarness();
    both.api.commitSprintSelection({ id: 99, name: 'Sprint 99' }, { projectTrackRange: true });
    assert.deepEqual(both.log, [
        ['setSelectedSprint', 99], ['setSprintName', 'Sprint 99'],
        ['setExcludedCapacityStartSprintId', '99'], ['setExcludedCapacityEndSprintId', '99'], ['setExcludedCapacityRefreshNonce', 8],
    ]);
    assert.equal(both.deps.excludedCapacityForceRefreshRef.current, true);
    const rangeOnly = sprintHarness();
    rangeOnly.api.commitSprintSelection({ id: 99, name: 'Sprint 99' }, { sprintChanged: false, projectTrackRange: true });
    assert.deepEqual(rangeOnly.log.map(entry => entry[0]), ['setExcludedCapacityStartSprintId', 'setExcludedCapacityEndSprintId', 'setExcludedCapacityRefreshNonce']);
    assert.equal(rangeOnly.deps.teamSelectionCarryForwardRef.current, 'untouched');
});

test('persistTeamSelection saves the scope and records the hydrated selection without touching React state', () => {
    const { api, deps, log, storage } = teamHarness();
    assert.equal(typeof api.persistTeamSelection, 'function', 'dashboard.jsx must declare persistTeamSelection');
    api.persistTeamSelection(['team-3', 'team-4']);
    assert.deepEqual(log, [['storage', ['team-3', 'team-4']]]);
    assert.deepEqual(deps.teamSelectionHydratedSelectionRef.current, { scopeKey: 'team-selection::42::grp-a', selectedTeams: ['team-3', 'team-4'] });
    assert.deepEqual(persistence.loadTeamSelectionState(storage, 'team-selection::42::grp-a').selectedTeams, ['team-3', 'team-4']);
});

test('persistTeamSelection is a no-op without a scope key', () => {
    const { api, deps, log } = teamHarness({ teamSelectionScopeKey: '' });
    api.persistTeamSelection(['team-3']);
    assert.deepEqual(log, []);
    assert.equal(deps.teamSelectionHydratedSelectionRef.current, null);
});
```

- [ ] **Step 4: Run it and confirm the new tests fail**

Run: `fnm exec --using 20 node --test tests/test_share_view_extraction_characterization.js`

Expected: exit status 1 with `# tests 19`, `# pass 13` and `# fail 6`. The six failures are the `commitSprintSelection` and `persistTeamSelection` tests: two report `dashboard.jsx must declare commitSprintSelection` and `dashboard.jsx must declare persistTeamSelection`, and four report `TypeError: api.commitSprintSelection is not a function` or `api.persistTeamSelection is not a function`.

- [ ] **Step 5: Extract the two closures**

All four replacements are in `frontend/src/dashboard.jsx` and each old block occurs exactly once. Apply them in this order.

1. Above `applyOrdinarySprint`, add `commitSprintSelection`:

Replace this:

```js
            const applyOrdinarySprint = (sprint, boardScopeControl) => {
```

with:

```js
            // Raw half of applyOrdinarySprint: no analytics, no guard, no selector side effects. The
            // shareable-link apply calls it with the link's Department, Team list and Sprint.
            const commitSprintSelection = (sprint, { groupId = activeGroupId, teams = selectedTeams, sprintChanged = true, projectTrackRange = false } = {}) => {
                if (sprintChanged) {
                    teamSelectionCarryForwardRef.current = groupId ? {
                        scopeKey: buildTeamSelectionScopeKey({ sprintId: sprint.id, groupId }),
                        selectedTeams: normalizeSelectedTeams(teams),
                    } : null;
                    setSelectedSprint(sprint.id);
                    setSprintName(sprint.name);
                }
                if (projectTrackRange) {
                    excludedCapacityForceRefreshRef.current = true;
                    setExcludedCapacityStartSprintId(String(sprint.id));
                    setExcludedCapacityEndSprintId(String(sprint.id));
                    setExcludedCapacityRefreshNonce(previous => previous + 1);
                }
            };
            const applyOrdinarySprint = (sprint, boardScopeControl) => {
```

2. Inside `applyOrdinarySprint`, replace the Team carry-forward, the Sprint writes and the Project Track range write with one call. The enclosing `if (!sameOrdinarySelection) {` line above the old block stays as it is; the `}` that closes it is the first line of the old and of the new block:

Replace this:

```js
                    teamSelectionCarryForwardRef.current = activeGroupId ? {
                        scopeKey: buildTeamSelectionScopeKey({ sprintId: sprint.id, groupId: activeGroupId }),
                        selectedTeams: normalizeSelectedTeams(selectedTeams),
                    } : null;
                    setSelectedSprint(sprint.id);
                    setSprintName(sprint.name);
                }
                if (projectTrackSprintId && (!sameOrdinarySelection || !projectTrackRangeMatches)) {
                    excludedCapacityForceRefreshRef.current = true;
                    setExcludedCapacityStartSprintId(projectTrackSprintId);
                    setExcludedCapacityEndSprintId(projectTrackSprintId);
                    setExcludedCapacityRefreshNonce(previous => previous + 1);
                }
                if (boardScopeControl) setBoardStrictScope('');
```

with:

```js
                }
                commitSprintSelection(sprint, {
                    sprintChanged: !sameOrdinarySelection,
                    projectTrackRange: Boolean(projectTrackSprintId) && (!sameOrdinarySelection || !projectTrackRangeMatches),
                });
                if (boardScopeControl) setBoardStrictScope('');
```

3. Above `toggleTeamSelection`, add `persistTeamSelection` and use it in the `all` branch:

Replace this:

```js
            const toggleTeamSelection = (teamId) => {
                if (teamId === 'all') {
                    if (teamSelectionScopeKey) {
                        saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, { selectedTeams: ['all'] });
                        teamSelectionHydratedSelectionRef.current = { scopeKey: teamSelectionScopeKey, selectedTeams: ['all'] };
                    }
                    setSelectedTeams(['all']);
```

with:

```js
            // Persistence half of a Team selection (the scope's stored selection and the hydrated-selection marker),
            // shared with the shareable-link apply. Callers set the React state themselves.
            const persistTeamSelection = (nextSelectedTeams) => {
                if (!teamSelectionScopeKey) return;
                saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, { selectedTeams: nextSelectedTeams });
                teamSelectionHydratedSelectionRef.current = { scopeKey: teamSelectionScopeKey, selectedTeams: nextSelectedTeams };
            };
            const toggleTeamSelection = (teamId) => {
                if (teamId === 'all') {
                    persistTeamSelection(['all']);
                    setSelectedTeams(['all']);
```

4. In the same function, use it inside the updater of the single-Team branch:

Replace this:

```js
                    const nextSelectedTeams = next.size ? Array.from(next) : ['all'];
                    if (teamSelectionScopeKey) {
                        saveTeamSelectionState(window.localStorage, teamSelectionScopeKey, { selectedTeams: nextSelectedTeams });
                        teamSelectionHydratedSelectionRef.current = { scopeKey: teamSelectionScopeKey, selectedTeams: nextSelectedTeams };
                    }
                    return nextSelectedTeams;
```

with:

```js
                    const nextSelectedTeams = next.size ? Array.from(next) : ['all'];
                    persistTeamSelection(nextSelectedTeams);
                    return nextSelectedTeams;
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `fnm exec --using 20 node --test tests/test_share_view_extraction_characterization.js`

Expected: `# tests 19`, `# pass 19`, `# fail 0`: the thirteen characterization tests still pass unchanged and the six contract tests pass.

- [ ] **Step 7: Move the manifest pins (same commit)**

`dashboard.jsx` grows by exactly 11 lines (the two helpers need their signatures and a comment each, and the call sites shrink by less). The extraction manifest pins it by exact equality, so its numbers move in this commit; `appPlusOwners` is the dashboard plus the unchanged `uniqueOwners` aggregate. The legacy ceiling in `LEGACY_ENTRYPOINT_LINE_BUDGETS` sits above the file and is not edited (Global Constraints, Budgets). Run `mkdir -p tmp/share-view-budget`, then create `tmp/share-view-budget/pins.py` (`tmp/` is gitignored; an earlier task may have left a copy, which this text replaces) with exactly this content:

```python
import json
import re
import sys

n = int(sys.argv[1])
path = 'scripts/extraction_lint/owner_budgets.json'
text = open(path).read()
unique_owners = json.loads(text)['aggregates']['uniqueOwners']['measured']
text, count = re.subn(
    r'("dashboard": \{\s*"path": "frontend/src/dashboard\.jsx",\s*"lineCount": )\d+(,\s*"lineCeiling": )\d+',
    lambda match: f'{match.group(1)}{n}{match.group(2)}{n}',
    text,
)
assert count == 1, 'dashboard manifest entry not found exactly once'
text, count = re.subn(
    r'("appPlusOwners": \{\s*"measured": )\d+(,\s*"ceiling": )\d+',
    lambda match: f'{match.group(1)}{n + unique_owners}{match.group(2)}{n + unique_owners}',
    text,
)
assert count == 1, 'appPlusOwners aggregate not found exactly once'
open(path, 'w').write(text)
print(f'dashboard.jsx pinned at {n}; appPlusOwners pinned at {n + unique_owners}')
```

Run:
```bash
wc -l frontend/src/dashboard.jsx
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets 2>&1 | grep -E 'differs|exceeds|^Ran |^OK|^FAILED'
N=$(wc -l < frontend/src/dashboard.jsx | tr -d ' ')
$PY tmp/share-view-budget/pins.py "$N"
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets 2>&1 | grep -E 'differs|exceeds|^Ran |^OK|^FAILED'
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY tests/test_codebase_structure_budgets.py --manifest scripts/extraction_lint/owner_budgets.json
git diff --stat -- tests/test_codebase_structure_budgets.py scripts/extraction_lint/owner_budgets.json
```
Expected: `wc -l` prints the previous task's count plus 11 (7,505 on the validated base); the first test run fails only the manifest test (the printed list holds `dashboard measured lineCount differs from actual`, `dashboard exceeds ceiling`, `appPlusOwners: measured aggregate ... differs from unique actual ...` and `appPlusOwners: ... exceeds aggregate ceiling ...`, then `FAILED (failures=1)`); the script prints `dashboard.jsx pinned at <N>; appPlusOwners pinned at <N + uniqueOwners>` (7,505 and 34,107 on the validated base); the second run reports `Ran 2 tests` and `OK`; the manifest run prints `owner budgets: 0 problems`; `git diff --stat` shows only `scripts/extraction_lint/owner_budgets.json` with 8 changed lines. If the legacy test fails too (`frontend/src/dashboard.jsx: <N> lines exceeds budget <M>`), `main` tightened that ceiling after this plan was validated: raise the entry in `tests/test_codebase_structure_budgets.py` to `<N>` with a one-line comment naming issue #194, and add that file to this commit's `git add`.

- [ ] **Step 8: Run the task's regression gate**

1. The whole frontend unit suite: `fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'`. Expected: `# fail 0` and `# tests` equal to N0 plus 19.
2. The Python tests that read `dashboard.jsx`: `env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets tests.test_eng_board_source_guards tests.test_project_packaging tests.test_auth_entry_page`. Expected: `OK`.
3. The extraction gate: `fnm exec --using 20 bash scripts/extraction_lint/run.sh`. Expected: the Task 0 baseline exit status, `0 errors`, a warning count equal to W0, `owner budgets: 0 problems` and `enforced problems: <B>`.
4. The UI specs that exercise Sprint and Team selection, the freshness refresh and the auth lock: `npx playwright test tests/ui/planning_selection_defaults.spec.js tests/ui/shared_department_groups.spec.js tests/ui/global_auth_lock.spec.js tests/ui/dashboard_data_freshness.spec.js --browser=chromium --workers=4 2>&1 | grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)'`. Expected: `204 passed` and no `failed` or `flaky` line (about three minutes; a different total only means an earlier task edited one of these specs, and the requirement is zero failures).
5. Rebuild the generated output: `fnm exec --using 20 npm run build`. Expected: `Dashboard built: ` followed by 64 hexadecimal digits. Then `git status --short -- frontend/dist` must print these four entries, plus renamed chunk files if esbuild re-hashed any (Global Constraints, Generated output): `dashboard.js` and `dashboard.js.map` change because the dashboard source changed, and the manifest name follows the build id:

```
 M frontend/dist/dashboard.js
 M frontend/dist/dashboard.js.map
 D frontend/dist/lazy-views-<previous build id>.json
?? frontend/dist/lazy-views-<new build id>.json
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_share_view_extraction_characterization.js scripts/extraction_lint/owner_budgets.json
git add -A -- frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Extract raw Sprint commit and Team persistence closures" -m "commitSprintSelection (the raw half of applyOrdinarySprint: Sprint id and name, Team carry-forward, Project Track range) and persistTeamSelection (the scope's stored Team selection plus the hydrated-selection marker) become closures that the shareable-link apply (issue 194) shares with the click path. Behavior-preserving: characterization tests pin the existing behavior and pass unchanged before and after. dashboard.jsx grows by 11 lines, so the manifest's line-count pins and aggregate move up by 11."
git show --stat HEAD
git status --short
make verify-dist-clean
```

Read the results: `git show --stat HEAD` lists the regenerated `frontend/dist` files (Global Constraints, Generated output) and exactly three other paths: `frontend/src/dashboard.jsx` (31 insertions and 20 deletions), `scripts/extraction_lint/owner_budgets.json` (8 changed lines) and `tests/test_share_view_extraction_characterization.js` (243 insertions); check them with `git show --name-only --format= HEAD | rg -v '^frontend/dist/'`. `git status --short` prints nothing. `make verify-dist-clean` prints nothing and exits 0.

- [ ] **Step 10: Checkpoint (stop here)**

Report to the operator: the commit SHA, the files above, the results of Steps 6 to 8 (the test counts, the lint count, the UI count) and the line-budget move (`dashboard.jsx` plus 11 lines, 7,494 to 7,505 on the validated base; the design had estimated minus 8, so say so). Then ask the operator to validate by hand in a signed-in dashboard, and stop until they confirm:
1. Header Sprint selector: choose another Sprint. The Sprint changes, the Teams selection you had carries over to the new Sprint, and focus returns to the selector button. Choose the same Sprint again: nothing changes.
2. Teams dropdown: tick All Teams, tick one Team, tick a second, untick both. The selection follows each click, and a reload keeps the last choice.
3. Statistics, Project Track: change the Sprint. The Sprint range follows the selected Sprint.
No behavior may differ from the version before this commit.


---

### Task 9: Apply machine (pure)

**Owner note:** no dependency on another `shareView` module (the machine imports nothing); blocks Task 11a (the controller steps it every tick). It changes no existing file, so no budget pin moves here.

**What it is.** `stepApplyMachine(state, input)` returns `{ state, actions }`. It owns ordering and timing only: the caller (Task 11a) reads one plain readiness snapshot per tick, executes the returned actions with raw setters and feeds the next snapshot back. It never reads a clock, a ref or the DOM, so every row of the design's Stages, Lifecycle and Budget tables is testable with a fake clock (the `now` field of the input). It issues at most one `run` action per step, so a stage's writes commit before the next stage reads state.

**Files:**
- Create: `frontend/src/shareView/applyMachine.js`
- Test (new): `tests/test_share_view_apply_machine.js`
- Regenerated: `frontend/dist/` (the build id hashes every file under `frontend/src`, so adding a module renames the manifest and changes `dashboard.js`)

**Interfaces:**
- Consumes: nothing.
- Produces (`frontend/src/shareView/applyMachine.js`):
```
APPLY_OVERALL_BUDGET_MS = 90000
APPLY_STAGE_BUDGET_MS = { A: 5000, B: 5000, C: 20000, D: 20000 }     // frozen
APPLY_SETTLE_FALLBACK_MS = 250
createApplyMachine() -> state
stepApplyMachine(state, input) -> { state, actions }       // state is never mutated; a finished machine returns no action

input = {
  now,                                   // a number of ms from any monotonic clock; the machine never reads one
  commit,                                // count of React commits so far
  paused,                                // the first-run popup or an onboarding tour is open
  authLocked,                            // the terminal auth latch
  reviewBusy,                            // the Planning review is dirty, saving or has a pending scope change
  interrupt,                             // null | 'deliberate' (pointerdown, non-modifier keydown, touchstart) | 'scroll' (wheel, touchmove)
  reported,                              // notice categories already known: decode-time and resolver reports
  gate: { configSettled, groupsLoading, groupsFailed, onboardingRequired, adminGate, catalog, capsulesPending, homeTokenReady },
        // adminGate: 'clear' | 'missing' | other; catalog: 'validated' | 'failed' | 'pending'
  resolution,                            // null (not available yet) | { ok: true, plan } | { ok: false, categories }
        // plan = { c: { teams: boolean, facets: boolean }, d: boolean }  (what Stages C and D owe)
  scope: { equal },                      // the link's group and Sprint already equal the committed ones
  b: { groupApplied, planningHydrated, restoring, scopePending },
  c: { epoch, lanesLoading, tasksFetched, lastLoadedMatches, teamsHydrated, expected },
  d: { cohortSettled, recoveryIdle, visible },
  focusResult,                           // null | 'revealed' | 'missing' | 'cancelled'
}
actions = [ { type: 'run', stage: 'A', scopeChange } | { type: 'run', stage: 'B' } | { type: 'run', stage: 'C', part: 'teams' | 'facets' }
          | { type: 'run', stage: 'D' } | { type: 'releaseHold' } | { type: 'cancelReveal' }
          | { type: 'finish', result: 'done' | 'partial' | 'dropped' | 'cancelled', categories: string[] } ]
```

**How the machine realises the design** (every row is pinned by a test below):

| Design | Machine |
| --- | --- |
| Readiness (Apply machine, "Readiness and hold") | Stage A needs `configSettled` and, once `!groupsLoading && !onboardingRequired && adminGate === 'clear' && catalog === 'validated' && !capsulesPending && homeTokenReady`, a resolved scope. Until `configSettled` nothing is timed. |
| Lifecycle: immediate drops | `groupsFailed`, `adminGate === 'missing'` and `catalog === 'failed'` finish `dropped`, as does an unresolved group or Sprint (the resolver's categories). A link that could not start names no category: the notice stays neutral. Only a group or Sprint the recipient does not have is named. |
| Lifecycle: auth lock, dirty review | `authLocked` finishes `dropped`, `reviewBusy` finishes `cancelled`, both with no category. |
| Lifecycle: interactions | Before Stage D a `deliberate` interrupt finishes `cancelled` (no notice); `scroll` is ignored. From Stage D any interrupt emits one `cancelReveal` and the link still finishes with the applied stages. While `paused` interrupts are ignored. |
| Budgets | The overall budget (90 s) runs from the first step after `configSettled`; Stage A's 5 s window opens when the readiness gate first opens; B, C and D each start when the previous stage finished. All are measured on an active clock that stops while `paused`. A stage that runs out is skipped and its categories reported (`B` mode and filters, `C` teams and filters, `D` focus). The overall budget finishes `dropped` if Stage A never ran, otherwise `partial` listing what was still owed. A Stage A timeout drops the link. |
| Stage A | One `run A` with `scopeChange: !input.scope.equal`. A same-scope link still runs A (it sets the ENG view and consumes the one-shot EPM restore) but writes no scope. |
| Stage B | Needs the scope committed (`scope.equal`), the group applied, the Planning scope hydrated, no group restore in flight, no pending Board scope readiness, and, for a scope change, one commit after Stage A (`applyGroupState` has run by then). |
| Hold | `releaseHold` is emitted one commit after Stage B ran (or after 250 ms of active time when nothing committed, or when Stage B timed out). Stage C waits for it. |
| Stage C | Waits for the hold release, then skips silently when the committed mode loads no tasks (`!c.expected`) or the plan owes nothing. Otherwise it needs the scope loaded: `epoch` newer than at Stage A, no lane loading, `tasksFetched`, `lastLoadedMatches` and `teamsHydrated`. Teams run first, then facets one commit later (or after the 250 ms settle). |
| Stage D | Runs when the plan owes a focus target and `cohortSettled && recoveryIdle && visible`. It finishes on `focusResult`: `revealed` and `cancelled` finish `done`, `missing` finishes `partial` with `focus`. A reveal that never answers is cancelled at its own 20 s budget. |

- Decision: the hold is released after Stage B commits, not after Stage A as the design text says. Between Stage A and Stage B's commit the App still carries the recipient's saved mode flags, so a released hold would start a Catch Up task load for a link whose mode loads no Catch Up tasks (a source-only Statistics link, a strict Board link). Task 11c pins this with a request log.

**Forbidden regressions for this task:**
- [ ] The module imports nothing and reads no clock, timer, ref, DOM or random source (a test scans its code).
- [ ] The budgets match the design: 90 s overall, A and B 5 s, C 20 s, D 20 s, and the clock stops while paused.
- [ ] No existing file changes; no new ESLint warning; `dashboard.jsx` is untouched, so the manifest pins stay where Task 6 left them.
- [ ] Analytics impact: none (a pure module; Task 11a sends the apply event).

- [ ] **Step 0: Preflight and baselines**

Run every command of this task from the worktree root with `JEP_TEST_PYTHON` exported (a command may run in a fresh shell, so export it again or write the interpreter path in place of `$PY`; the extraction lint reads `JEP_TEST_PYTHON` too) and with the Python test environment typed inline exactly as the commands show it.

Run:
```bash
git branch --show-current
git status --short
ls frontend/src/shareView
fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'
fnm exec --using 20 bash scripts/extraction_lint/run.sh 2>&1 | grep -E 'problems \('
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; the listing shows no `applyMachine.js`; the Node summary shows `# fail 0` (write down `# tests` as N0); the lint line shows `0 errors` (write down the warning count as W0).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_share_view_apply_machine.js` with exactly this content (a fake clock, one `step()` helper that merges the fields a test names into a ready-to-run input, and a seeded fuzz at the end):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'shareView', 'applyMachine.js');

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', source)(module, module.exports);
    return module.exports;
}

const {
    APPLY_OVERALL_BUDGET_MS, APPLY_SETTLE_FALLBACK_MS, APPLY_STAGE_BUDGET_MS,
    createApplyMachine, stepApplyMachine,
} = loadModule();

test('the machine is pure: it imports nothing and reads no clock, timer, ref, DOM or random source', () => {
    const code = esbuild.transformSync(fs.readFileSync(MODULE_PATH, 'utf8'), { loader: 'js' }).code;
    assert.doesNotMatch(code, /\b(?:import|require|Date|performance|setTimeout|setInterval|requestAnimationFrame|document|window|Math\.random)\b/);
});

const FULL_PLAN = { c: { teams: true, facets: true }, d: true };
const READY_GATE = {
    configSettled: true, groupsLoading: false, groupsFailed: false, onboardingRequired: false,
    adminGate: 'clear', catalog: 'validated', capsulesPending: false, homeTokenReady: true,
};

// Nested groups merge one level deep so a test names only the fields it changes.
function makeInput(over = {}) {
    const base = {
        now: 0, commit: 1, paused: false, authLocked: false, reviewBusy: false, interrupt: null, reported: [],
        gate: READY_GATE, resolution: { ok: true, plan: FULL_PLAN }, scope: { equal: false },
        b: { groupApplied: true, planningHydrated: true, restoring: false, scopePending: false },
        c: { epoch: 0, lanesLoading: false, tasksFetched: false, lastLoadedMatches: false, teamsHydrated: false, expected: true },
        d: { cohortSettled: false, recoveryIdle: true, visible: true },
        focusResult: null,
    };
    const merged = { ...base, ...over };
    for (const key of ['gate', 'scope', 'b', 'c', 'd']) merged[key] = { ...base[key], ...(over[key] || {}) };
    return merged;
}

function simulate() {
    let state = createApplyMachine();
    let now = 0;
    return {
        get state() { return state; },
        step(over = {}, advance = 0) {
            now += advance;
            const out = stepApplyMachine(state, makeInput({ now, ...over }));
            state = out.state;
            return out.actions;
        },
    };
}

const LOADED = { epoch: 1, tasksFetched: true, lastLoadedMatches: true, teamsHydrated: true, expected: true };

// Drives a scope-changing link through A and B (and the commit that releases the hold).
function throughB(sim, { plan = FULL_PLAN, commitAtA = 1 } = {}) {
    assert.deepEqual(sim.step({ commit: commitAtA, resolution: { ok: true, plan } }), [{ type: 'run', stage: 'A', scopeChange: true }]);
    assert.deepEqual(sim.step({ commit: commitAtA + 1, scope: { equal: true } }), [{ type: 'run', stage: 'B' }]);
    assert.deepEqual(sim.step({ commit: commitAtA + 2, scope: { equal: true } }), [{ type: 'releaseHold' }]);
}

test('nothing is timed or applied before the shared config settles', () => {
    const sim = simulate();
    for (let tick = 0; tick < 5; tick += 1) assert.deepEqual(sim.step({ gate: { configSettled: false } }, 60000), []);
    assert.equal(sim.state.startActive, null);
    assert.deepEqual(sim.step({}, 1), [{ type: 'run', stage: 'A', scopeChange: true }]);
});

test('a missing readiness input keeps the link waiting', () => {
    for (const blocker of [
        { groupsLoading: true }, { onboardingRequired: true }, { adminGate: 'pending' },
        { catalog: 'pending' }, { capsulesPending: true }, { homeTokenReady: false },
    ]) {
        const sim = simulate();
        assert.deepEqual(sim.step({ gate: blocker }), [], JSON.stringify(blocker));
        assert.deepEqual(sim.step({ gate: blocker }, 1000), [], JSON.stringify(blocker));
        assert.deepEqual(sim.step({}, 1000), [{ type: 'run', stage: 'A', scopeChange: true }], JSON.stringify(blocker));
    }
});

test('fast drops end the link immediately and name only what was already reported', () => {
    for (const gate of [{ groupsFailed: true }, { adminGate: 'missing' }, { catalog: 'failed' }]) {
        const sim = simulate();
        assert.deepEqual(
            sim.step({ gate, reported: ['teams'] }),
            [{ type: 'finish', result: 'dropped', categories: ['teams'] }],
            JSON.stringify(gate),
        );
        assert.deepEqual(sim.step({}), [], 'a finished machine issues nothing');
    }
});

test('an unresolved group or Sprint drops the link with the resolver categories', () => {
    const sim = simulate();
    assert.deepEqual(
        sim.step({ resolution: { ok: false, categories: ['sprint'] }, reported: ['mode'] }),
        [{ type: 'finish', result: 'dropped', categories: ['sprint', 'mode'] }],
    );
});

test('the link waits while the resolution is not available yet', () => {
    const sim = simulate();
    assert.deepEqual(sim.step({ resolution: null }), []);
    assert.deepEqual(sim.step({}), [{ type: 'run', stage: 'A', scopeChange: true }]);
});

test('a terminal auth lock drops the link at any stage and never reports a notice category', () => {
    const early = simulate();
    assert.deepEqual(early.step({ authLocked: true }), [{ type: 'finish', result: 'dropped', categories: [] }]);
    const late = simulate();
    throughB(late);
    assert.deepEqual(late.step({ authLocked: true }), [{ type: 'finish', result: 'dropped', categories: [] }]);
});

test('a dirty, saving or pending-scope Planning review cancels the link without a notice', () => {
    const before = simulate();
    assert.deepEqual(before.step({ reviewBusy: true }), [{ type: 'finish', result: 'cancelled', categories: [] }]);
    const during = simulate();
    throughB(during);
    assert.deepEqual(during.step({ reviewBusy: true, commit: 9 }), [{ type: 'finish', result: 'cancelled', categories: [] }]);
});

test('Stage A runs once and records whether the scope changes', () => {
    const changing = simulate();
    assert.deepEqual(changing.step(), [{ type: 'run', stage: 'A', scopeChange: true }]);
    assert.equal(changing.state.ran.A, true);
    const same = simulate();
    assert.deepEqual(same.step({ scope: { equal: true } }), [{ type: 'run', stage: 'A', scopeChange: false }]);
    assert.deepEqual(same.step({ scope: { equal: true }, b: { restoring: true } }), [], 'B waits; A is not repeated');
});

test('Stage A must run within its budget of the gate first opening, or the link is dropped', () => {
    const sim = simulate();
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }), []);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, 60000), []);
    assert.equal(sim.state.armedActive, null, 'the window opens with the gate, not with the config');
    assert.deepEqual(sim.step({ resolution: null }), [], 'gate open, resolution not yet available');
    assert.equal(sim.state.armedActive, 60000);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, APPLY_STAGE_BUDGET_MS.A - 1), []);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, 1), [{ type: 'finish', result: 'dropped', categories: [] }]);
});

test('Stage B waits for every part of its predicate, and for one commit when the scope changed', () => {
    const blockers = [
        { scope: { equal: false } }, { b: { groupApplied: false } }, { b: { planningHydrated: false } },
        { b: { restoring: true } }, { commit: 1 }, { b: { scopePending: true } },
    ];
    for (const blocker of blockers) {
        const sim = simulate();
        sim.step({ commit: 1 });
        assert.deepEqual(sim.step({ commit: 2, scope: { equal: true }, ...blocker, b: { ...blocker.b } }), [], JSON.stringify(blocker));
    }
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ commit: 2, scope: { equal: true } }), [{ type: 'run', stage: 'B' }]);
});

test('a same-scope link does not wait for a commit before Stage B', () => {
    const sim = simulate();
    sim.step({ commit: 4, scope: { equal: true } });
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true } }), [{ type: 'run', stage: 'B' }]);
});

test('Stage B waits while the Board scope readiness is pending and runs once it is not', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ commit: 2, scope: { equal: true }, b: { scopePending: true } }), []);
    assert.deepEqual(sim.step({ commit: 3, scope: { equal: true }, b: { scopePending: false } }), [{ type: 'run', stage: 'B' }]);
});

test('the hold is released one commit after Stage B, or after the settle fallback when nothing committed', () => {
    const byCommit = simulate();
    byCommit.step({ commit: 1 });
    byCommit.step({ commit: 2, scope: { equal: true } });
    assert.deepEqual(byCommit.step({ commit: 2, scope: { equal: true } }, APPLY_SETTLE_FALLBACK_MS - 1), []);
    assert.deepEqual(byCommit.step({ commit: 3, scope: { equal: true } }, 1), [{ type: 'releaseHold' }]);
    assert.deepEqual(byCommit.step({ commit: 4, scope: { equal: true } }), [], 'released once');

    const byFallback = simulate();
    byFallback.step({ commit: 1 });
    byFallback.step({ commit: 2, scope: { equal: true } });
    assert.deepEqual(byFallback.step({ commit: 2, scope: { equal: true } }, APPLY_SETTLE_FALLBACK_MS), [{ type: 'releaseHold' }]);
});

test('Stage B past its budget is skipped, reports mode and filters, and still releases the hold', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ commit: 2, b: { restoring: true } }, APPLY_STAGE_BUDGET_MS.B - 1), []);
    assert.deepEqual(sim.step({ commit: 3, b: { restoring: true } }, 1), [{ type: 'releaseHold' }]);
    assert.deepEqual(sim.state.skipped, ['mode', 'filters']);
    assert.equal(sim.state.stage, 'C');
});

test('Stage C waits until the scope is loaded: a newer epoch, idle lanes, fetched tasks, the right Sprint and a hydrated Team selection', () => {
    for (const blocker of [
        { epoch: 0 }, { lanesLoading: true }, { tasksFetched: false }, { lastLoadedMatches: false }, { teamsHydrated: false },
    ]) {
        const sim = simulate();
        throughB(sim);
        assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: { ...LOADED, ...blocker } }), [], JSON.stringify(blocker));
    }
});

test('the epoch must be newer than the one seen when Stage A ran', () => {
    const sim = simulate();
    sim.step({ commit: 1, c: { epoch: 3 } });
    sim.step({ commit: 2, scope: { equal: true }, c: { epoch: 3 } });
    sim.step({ commit: 3, scope: { equal: true }, c: { epoch: 3 } });
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: { ...LOADED, epoch: 3 } }), [], 'a load that finished before Stage A is not this scope');
    assert.deepEqual(sim.step({ commit: 5, scope: { equal: true }, c: { ...LOADED, epoch: 4 } }), [{ type: 'run', stage: 'C', part: 'teams' }]);
});

test('Stage C waits for the hold to be released after Stage B, then skips silently when the committed mode loads no tasks', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    sim.step({ commit: 2, scope: { equal: true } });
    assert.deepEqual(sim.step({ commit: 2, scope: { equal: true }, c: { ...LOADED, expected: false } }), [], 'Stage B has not committed yet');
    assert.deepEqual(sim.step({ commit: 3, scope: { equal: true }, c: { ...LOADED, expected: false } }), [{ type: 'releaseHold' }]);
    assert.equal(sim.state.stage, 'D', 'Teams and facets are not applied where no task list loads');
    assert.deepEqual(sim.state.skipped, [], 'a view that never loads tasks owes nothing');
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, d: { cohortSettled: true } }), [{ type: 'run', stage: 'D' }]);
});

test('Stage C applies Teams, then facets one commit later', () => {
    const sim = simulate();
    throughB(sim);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'teams' }]);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }), [], 'facets wait for a commit');
    assert.deepEqual(sim.step({ commit: 5, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'facets' }]);
    assert.equal(sim.state.stage, 'D');
});

test('the facets part proceeds after the settle fallback when the Team write committed nothing', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }, APPLY_SETTLE_FALLBACK_MS - 1), []);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }, 1), [{ type: 'run', stage: 'C', part: 'facets' }]);
});

test('a plan without Teams applies facets only, and one without either skips Stage C', () => {
    const facetsOnly = simulate();
    throughB(facetsOnly, { plan: { c: { teams: false, facets: true }, d: false } });
    assert.deepEqual(facetsOnly.step({ commit: 4, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'facets' }]);
    const teamsOnly = simulate();
    throughB(teamsOnly, { plan: { c: { teams: true, facets: false }, d: false } });
    assert.deepEqual(teamsOnly.step({ commit: 4, scope: { equal: true }, c: LOADED }), [{ type: 'run', stage: 'C', part: 'teams' }]);
    assert.deepEqual(teamsOnly.step({ commit: 5, scope: { equal: true }, c: LOADED }), [{ type: 'finish', result: 'done', categories: [] }]);
    const none = simulate();
    throughB(none, { plan: { c: { teams: false, facets: false }, d: false } });
    assert.deepEqual(none.step({ commit: 4, scope: { equal: true } }), [{ type: 'finish', result: 'done', categories: [] }]);
});

test('Stage C past its budget is skipped with the categories of the parts it still owed', () => {
    const both = simulate();
    throughB(both);
    assert.deepEqual(both.step({ commit: 4, scope: { equal: true } }, APPLY_STAGE_BUDGET_MS.C - 1), []);
    assert.deepEqual(both.step({ commit: 5, scope: { equal: true } }, 1), []);
    assert.deepEqual(both.state.skipped, ['teams', 'filters']);
    assert.equal(both.state.stage, 'D');

    const factsOwed = simulate();
    throughB(factsOwed);
    factsOwed.step({ commit: 4, scope: { equal: true }, c: LOADED });
    factsOwed.step({ commit: 4, scope: { equal: true }, c: { ...LOADED, lanesLoading: true } }, APPLY_STAGE_BUDGET_MS.C);
    assert.deepEqual(factsOwed.state.skipped, ['filters']);
});

test('Stage D needs the alert cohort settled, an idle recovery scroll and a visible document', () => {
    for (const blocker of [{ cohortSettled: false }, { recoveryIdle: false }, { visible: false }]) {
        const sim = simulate();
        throughB(sim);
        sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
        assert.deepEqual(sim.step({ commit: 6, scope: { equal: true }, d: { cohortSettled: true, recoveryIdle: true, visible: true, ...blocker } }), [], JSON.stringify(blocker));
    }
});

test('Stage D runs the reveal once and finishes on its result', () => {
    const reach = () => {
        const sim = simulate();
        throughB(sim);
        sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
        assert.deepEqual(sim.step({ commit: 6, d: { cohortSettled: true } }), [{ type: 'run', stage: 'D' }]);
        assert.deepEqual(sim.step({ commit: 7, d: { cohortSettled: true } }, 100), [], 'D is not repeated while the reveal is pending');
        return sim;
    };
    assert.deepEqual(reach().step({ focusResult: 'revealed' }), [{ type: 'finish', result: 'done', categories: [] }]);
    assert.deepEqual(reach().step({ focusResult: 'missing' }), [{ type: 'finish', result: 'partial', categories: ['focus'] }]);
    assert.deepEqual(reach().step({ focusResult: 'cancelled' }), [{ type: 'finish', result: 'done', categories: [] }]);
});

test('a link without a focus target finishes after Stage C and merges reported categories into the result', () => {
    const sim = simulate();
    throughB(sim, { plan: { c: { teams: true, facets: false }, d: false } });
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    assert.deepEqual(sim.step({ commit: 5, scope: { equal: true }, reported: ['teams', 'filters'] }), [
        { type: 'finish', result: 'partial', categories: ['teams', 'filters'] },
    ]);
});

test('Stage D past its budget is skipped and reports focus', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
    assert.deepEqual(sim.step({ commit: 6, d: { visible: false } }, APPLY_STAGE_BUDGET_MS.D - 1), []);
    assert.deepEqual(sim.step({ commit: 7, d: { visible: false } }, 1), [{ type: 'finish', result: 'partial', categories: ['focus'] }]);
});

test('a reveal that never reports back is cancelled at its own budget and reports focus', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 6, d: { cohortSettled: true } });
    assert.deepEqual(sim.step({ commit: 7 }, APPLY_STAGE_BUDGET_MS.D), [
        { type: 'cancelReveal' }, { type: 'finish', result: 'partial', categories: ['focus'] },
    ]);
});

test('a deliberate interaction before Stage D starts cancels the link and keeps what was applied', () => {
    for (const phase of ['gate', 'afterA', 'afterB', 'waitingC', 'waitingD']) {
        const sim = simulate();
        if (phase === 'gate') sim.step({ gate: { catalog: 'pending' } });
        else {
            sim.step({ commit: 1 });
            if (phase !== 'afterA') sim.step({ commit: 2, scope: { equal: true } });
            if (phase === 'waitingD') {
                sim.step({ commit: 3, scope: { equal: true } });
                sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
                sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
            }
        }
        assert.deepEqual(sim.step({ interrupt: 'deliberate', commit: 6 }), [{ type: 'finish', result: 'cancelled', categories: [] }], phase);
    }
});

test('scrolling alone does not cancel before Stage D', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ interrupt: 'scroll', commit: 2 }), []);
});

test('during Stage D any interaction cancels only the reveal and the link still finishes with the applied stages', () => {
    for (const interrupt of ['deliberate', 'scroll']) {
        const sim = simulate();
        throughB(sim);
        sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
        sim.step({ commit: 6, d: { cohortSettled: true } });
        assert.deepEqual(sim.step({ interrupt, commit: 7 }), [{ type: 'cancelReveal' }], interrupt);
        assert.deepEqual(sim.step({ interrupt, commit: 8 }), [], 'cancelled once');
        assert.deepEqual(sim.step({ commit: 9, focusResult: 'cancelled' }), [{ type: 'finish', result: 'done', categories: [] }]);
    }
});

test('while a tour or the first-run popup pauses the link nothing runs, interactions are ignored and the clock stops', () => {
    const sim = simulate();
    sim.step({ commit: 1 });
    assert.deepEqual(sim.step({ paused: true, interrupt: 'deliberate', commit: 2, scope: { equal: true } }, 1000), []);
    const frozen = sim.state.active;
    for (let tick = 0; tick < 4; tick += 1) assert.deepEqual(sim.step({ paused: true, commit: 3 + tick, scope: { equal: true } }, APPLY_OVERALL_BUDGET_MS), []);
    assert.equal(sim.state.active, frozen, 'a paused interval adds no active time');
    assert.deepEqual(sim.step({ commit: 8, scope: { equal: true } }, 1), [{ type: 'run', stage: 'B' }]);
});

test('the active clock counts only the unpaused intervals', () => {
    const sim = simulate();
    sim.step({ gate: { onboardingRequired: true } });
    sim.step({ paused: true, gate: { onboardingRequired: true } }, 10000);
    sim.step({ paused: true, gate: { onboardingRequired: true } }, 600000);
    assert.equal(sim.state.active, 10000, 'the interval that began unpaused counts, later paused ones do not');
    assert.deepEqual(sim.step({}, 1), [{ type: 'run', stage: 'A', scopeChange: true }]);
});

test('the overall budget drops a link that never reached Stage A and names only what was already reported', () => {
    const sim = simulate();
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }), []);
    assert.deepEqual(sim.step({ gate: { catalog: 'pending' } }, APPLY_OVERALL_BUDGET_MS - 1), []);
    assert.deepEqual(
        sim.step({ gate: { catalog: 'pending' }, reported: ['mode'] }, 1),
        [{ type: 'finish', result: 'dropped', categories: ['mode'] }],
    );
});

test('the overall budget ends an applying link as partial and names every step it still owed', () => {
    const sim = simulate();
    throughB(sim);
    assert.deepEqual(sim.step({ commit: 4, scope: { equal: true } }, APPLY_OVERALL_BUDGET_MS), [
        { type: 'finish', result: 'partial', categories: ['teams', 'filters', 'focus'] },
    ]);
});

test('the overall budget also cancels a reveal that is still running', () => {
    const sim = simulate();
    throughB(sim);
    sim.step({ commit: 4, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 5, scope: { equal: true }, c: LOADED });
    sim.step({ commit: 6, d: { cohortSettled: true } });
    assert.deepEqual(sim.step({ commit: 7 }, APPLY_OVERALL_BUDGET_MS), [
        { type: 'cancelReveal' }, { type: 'finish', result: 'partial', categories: ['focus'] },
    ]);
});

test('the full chain runs strictly in order, one run action per step, and finishes done', () => {
    const sim = simulate();
    const runs = [];
    const record = actions => actions.filter(action => action.type === 'run').forEach(action => runs.push(`${action.stage}${action.part || ''}`));
    record(sim.step({ commit: 1 }));
    record(sim.step({ commit: 2, scope: { equal: true } }));
    record(sim.step({ commit: 3, scope: { equal: true } }));
    record(sim.step({ commit: 4, scope: { equal: true }, c: LOADED }));
    record(sim.step({ commit: 5, scope: { equal: true }, c: LOADED }));
    record(sim.step({ commit: 6, d: { cohortSettled: true } }));
    assert.deepEqual(runs, ['A', 'B', 'Cteams', 'Cfacets', 'D']);
    assert.deepEqual(sim.step({ commit: 7, focusResult: 'revealed' }), [{ type: 'finish', result: 'done', categories: [] }]);
    assert.deepEqual(sim.step({ commit: 8 }), [], 'a finished machine is inert');
});

test('every stage budget and the overall budget match the design', () => {
    assert.deepEqual({ ...APPLY_STAGE_BUDGET_MS }, { A: 5000, B: 5000, C: 20000, D: 20000 });
    assert.equal(APPLY_OVERALL_BUDGET_MS, 90000);
});

test('random readiness never breaks the machine invariants', () => {
    let seed = 20261014;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const chance = probability => random() < probability;
    const order = ['A', 'B', 'Cteams', 'Cfacets', 'D'];
    for (let run = 0; run < 300; run += 1) {
        const plan = { c: { teams: chance(0.7), facets: chance(0.7) }, d: chance(0.6) };
        const sim = simulate();
        const seen = [];
        let releases = 0;
        let finishes = 0;
        for (let step = 0; step < 120; step += 1) {
            const wasFinished = sim.state.finished;
            const actions = sim.step({
                commit: step, paused: chance(0.05), authLocked: chance(0.004), reviewBusy: chance(0.004),
                interrupt: chance(0.01) ? (chance(0.5) ? 'deliberate' : 'scroll') : null,
                resolution: chance(0.9) ? { ok: true, plan } : { ok: false, categories: ['group'] },
                gate: { configSettled: chance(0.9), groupsLoading: chance(0.2), catalog: chance(0.7) ? 'validated' : 'pending', onboardingRequired: chance(0.1) },
                scope: { equal: chance(0.5) },
                b: { groupApplied: chance(0.8), planningHydrated: chance(0.8), restoring: chance(0.2), scopePending: chance(0.1) },
                c: { epoch: Math.floor(step / 10), lanesLoading: chance(0.2), tasksFetched: chance(0.8), lastLoadedMatches: chance(0.8), teamsHydrated: chance(0.8), expected: chance(0.9) },
                d: { cohortSettled: chance(0.5), recoveryIdle: chance(0.8), visible: chance(0.8) },
                focusResult: chance(0.1) ? 'revealed' : null,
                reported: chance(0.1) ? ['teams'] : [],
            }, chance(0.1) ? 5000 : 40);
            if (wasFinished) assert.deepEqual(actions, [], 'a finished machine stays inert');
            assert.ok(actions.filter(action => action.type === 'run').length <= 1, 'at most one stage runs per step');
            for (const action of actions) {
                if (action.type === 'run') seen.push(`${action.stage}${action.part || ''}`);
                if (action.type === 'releaseHold') releases += 1;
                if (action.type === 'finish') finishes += 1;
            }
        }
        assert.ok(releases <= 1 + (seen.includes('B') ? 0 : 1), 'the hold is released at most once per path');
        assert.ok(finishes <= 1, 'one terminal action');
        assert.deepEqual(seen, order.filter(stage => seen.includes(stage)), 'stages run once, in order');
    }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `fnm exec --using 20 node --test tests/test_share_view_apply_machine.js`

Expected: exit status 1 and an esbuild error `Could not resolve` followed by the absolute path of `frontend/src/shareView/applyMachine.js` (the test bundles the module when the file loads, so the whole file fails at once).

- [ ] **Step 3: Implement the machine**

Create `frontend/src/shareView/applyMachine.js` with exactly this content:

```js
// Pure apply machine for a shareable view link (issue #194). It owns ordering and timing only: the
// caller reads a plain readiness snapshot each tick, executes the returned actions and feeds the next
// snapshot back. It never reads a clock, a ref or the DOM, so every lifecycle row is testable with a
// fake clock.
//
// Stages (docs/plans/SUPPORT-shareable-view-links-design-194.md, "Apply machine"):
//   A scope, B fields, C data-dependent (Teams, then facets), D focus.
// One `run` action is issued per step so a stage's writes commit before the next stage reads state.
// Every stage budget is measured on the active clock, which stops while `input.paused`.

export const APPLY_OVERALL_BUDGET_MS = 90000;
// A: the readiness gate first opened -> Stage A runs. B, C, D: the previous stage finished -> this one runs.
export const APPLY_STAGE_BUDGET_MS = Object.freeze({ A: 5000, B: 5000, C: 20000, D: 20000 });
// A commit normally follows a stage's writes; when every write was a no-op none does, so the next
// step proceeds after this long instead of waiting for one.
export const APPLY_SETTLE_FALLBACK_MS = 250;

const unique = values => [...new Set(values)];

export function createApplyMachine() {
    return {
        finished: false, lastNow: null, lastPaused: false, active: 0, startActive: null,
        stage: 'A', armedActive: null, plan: null, owed: [], skipped: [],
        ran: { A: false, D: false }, scopeChange: false, aCommit: 0, epochAtA: 0,
        holdPending: false, bCommit: 0, bActive: 0, cPart: null, cCommit: 0, cActive: 0,
        dActive: 0, revealCancelled: false,
    };
}

// The categories each step of the chain owes; a step leaves the list when it runs or is skipped.
function owedSteps(plan) {
    return [
        { step: 'B', categories: ['mode', 'filters'] },
        ...(plan.c.teams ? [{ step: 'Ct', categories: ['teams'] }] : []),
        ...(plan.c.facets ? [{ step: 'Cf', categories: ['filters'] }] : []),
        ...(plan.d ? [{ step: 'D', categories: ['focus'] }] : []),
    ];
}

export function stepApplyMachine(previous, input) {
    const state = { ...previous, ran: { ...previous.ran }, skipped: [...previous.skipped], owed: [...previous.owed] };
    const actions = [];
    const elapsed = state.lastNow === null ? 0 : Math.max(0, input.now - state.lastNow);
    if (!state.lastPaused) state.active += elapsed;
    state.lastNow = input.now;
    state.lastPaused = input.paused;
    if (state.finished) return { state, actions };

    const reported = input.reported || [];
    const wait = () => ({ state, actions });
    const finish = (result, categories) => {
        state.finished = true;
        actions.push({ type: 'finish', result, categories: unique(categories) });
        return { state, actions };
    };
    // A link dropped before Stage A names only what the resolver and the decoder reported: a group or Sprint the
    // recipient does not have. A link that could not start (groups failed, a timeout) names nothing.
    const drop = (categories = []) => finish('dropped', [...categories, ...reported]);
    const cancelReveal = () => {
        if (state.revealCancelled) return;
        state.revealCancelled = true;
        actions.push({ type: 'cancelReveal' });
    };
    const settle = () => {
        const categories = [...reported, ...state.skipped];
        return finish(categories.length ? 'partial' : 'done', categories);
    };
    const complete = step => { state.owed = state.owed.filter(entry => entry.step !== step); };
    const moveTo = (stage, skippedSteps = []) => {
        for (const step of skippedSteps) {
            state.skipped.push(...state.owed.find(entry => entry.step === step).categories);
            complete(step);
        }
        state.stage = stage;
        state.armedActive = state.active;
    };

    if (input.authLocked) return finish('dropped', []);
    if (input.reviewBusy) return finish('cancelled', []);
    if (!input.paused && input.interrupt) {
        if (state.ran.D) cancelReveal();
        else if (input.interrupt === 'deliberate') return finish('cancelled', []);
    }
    if (!input.gate.configSettled) return wait();
    if (state.startActive === null) state.startActive = state.active;
    if (state.active - state.startActive >= APPLY_OVERALL_BUDGET_MS) {
        if (!state.ran.A) return drop();
        if (state.ran.D) cancelReveal();
        return finish('partial', [...reported, ...state.skipped, ...state.owed.flatMap(entry => entry.categories)]);
    }
    if (input.paused) return wait();

    // Stage A: scope. Nothing else is meaningful until the link's own group and Sprint are in place.
    if (!state.ran.A) {
        const { gate } = input;
        if (gate.groupsFailed || gate.adminGate === 'missing' || gate.catalog === 'failed') return drop();
        const open = !gate.groupsLoading && !gate.onboardingRequired && gate.adminGate === 'clear'
            && gate.catalog === 'validated' && !gate.capsulesPending && gate.homeTokenReady;
        if (open && state.armedActive === null) state.armedActive = state.active;
        if (!open) return state.armedActive !== null && state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.A ? drop() : wait();
        if (!input.resolution) return wait();
        if (!input.resolution.ok) return drop(input.resolution.categories);
        state.plan = input.resolution.plan;
        state.owed = owedSteps(state.plan);
        state.scopeChange = !input.scope.equal;
        state.ran.A = true;
        state.aCommit = input.commit;
        state.epochAtA = input.c.epoch;
        moveTo('B');
        actions.push({ type: 'run', stage: 'A', scopeChange: state.scopeChange });
        return { state, actions };
    }

    // The hold only exists to stop a default-scope load, so it outlives Stage B's writes until they commit.
    if (state.holdPending && (input.commit > state.bCommit || state.active - state.bActive >= APPLY_SETTLE_FALLBACK_MS)) {
        state.holdPending = false;
        actions.push({ type: 'releaseHold' });
    }

    if (state.stage === 'B') {
        const { b } = input;
        const settled = input.scope.equal && b.groupApplied && b.planningHydrated && !b.restoring
            && (!state.scopeChange || input.commit > state.aCommit) && !b.scopePending;
        if (settled) {
            state.bCommit = input.commit;
            state.bActive = state.active;
            state.holdPending = true;
            complete('B');
            moveTo('C');
            actions.push({ type: 'run', stage: 'B' });
        } else if (state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.B) {
            moveTo('C', ['B']);
            actions.push({ type: 'releaseHold' });
        }
        return { state, actions };
    }

    if (state.stage === 'C') {
        const { c } = state.plan;
        const scope = input.c;
        if (state.holdPending) return { state, actions };
        if ((!c.teams && !c.facets) || !scope.expected) {
            complete('Ct');
            complete('Cf');
            moveTo('D');
            return { state, actions };
        }
        if (state.cPart === null) state.cPart = c.teams ? 'teams' : 'facets';
        const loaded = scope.epoch > state.epochAtA && !scope.lanesLoading && scope.tasksFetched
            && scope.lastLoadedMatches && scope.teamsHydrated;
        const committed = input.commit > state.cCommit || state.active - state.cActive >= APPLY_SETTLE_FALLBACK_MS;
        if (loaded && state.cPart === 'teams') {
            state.cCommit = input.commit;
            state.cActive = state.active;
            complete('Ct');
            actions.push({ type: 'run', stage: 'C', part: 'teams' });
            if (c.facets) state.cPart = 'facets';
            else moveTo('D');
        } else if (loaded && state.cPart === 'facets' && (!c.teams || committed)) {
            complete('Cf');
            actions.push({ type: 'run', stage: 'C', part: 'facets' });
            moveTo('D');
        } else if (state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.C) {
            moveTo('D', state.cPart === 'teams' ? ['Ct', ...(c.facets ? ['Cf'] : [])] : ['Cf']);
        }
        return { state, actions };
    }

    // Stage D: focus. Applied stages are kept whatever happens here.
    if (!state.plan.d) return settle();
    if (!state.ran.D) {
        const { d } = input;
        if (d.cohortSettled && d.recoveryIdle && d.visible) {
            state.ran.D = true;
            state.dActive = state.active;
            actions.push({ type: 'run', stage: 'D' });
        } else if (state.active - state.armedActive >= APPLY_STAGE_BUDGET_MS.D) {
            moveTo('D', ['D']);
            return settle();
        }
        return { state, actions };
    }
    if (input.focusResult === 'revealed' || input.focusResult === 'cancelled') return settle();
    if (input.focusResult === 'missing') { moveTo('D', ['D']); return settle(); }
    if (state.active - state.dActive >= APPLY_STAGE_BUDGET_MS.D) {
        cancelReveal();
        moveTo('D', ['D']);
        return settle();
    }
    return { state, actions };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `fnm exec --using 20 node --test tests/test_share_view_apply_machine.js`

Expected: `# tests 38`, `# pass 38`, `# fail 0`. The last test is the seeded fuzz (300 runs of 120 random steps): it asserts at most one `run` per step, stages in order and each at most once, at most one terminal action, an inert finished machine and the hold released at most once.

- [ ] **Step 5: Run the task's regression gate**

1. The whole frontend unit suite: `fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'`. Expected: `# fail 0` and `# tests` equal to N0 plus 38.
2. The structure budgets: `env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets`. Expected: `Ran 2 tests` and `OK` (a file under `shareView/` needs no registration: only `scenario/`, `settings/` and `epm/` do).
3. The extraction gate: `fnm exec --using 20 bash scripts/extraction_lint/run.sh`. Expected: the Task 0 baseline exit status, `0 errors`, a warning count equal to W0, `owner budgets: 0 problems` and `enforced problems: <B>`.
4. Rebuild: `fnm exec --using 20 npm run build`. Expected: `Dashboard built: ` followed by 64 hexadecimal digits. Then `git status --short -- frontend/dist` must print these entries (the module is not imported yet, so only `dashboard.js` and the manifest name change; the source map keeps its content):

```
 M frontend/dist/dashboard.js
 D frontend/dist/lazy-views-<previous build id>.json
?? frontend/dist/lazy-views-<new build id>.json
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shareView/applyMachine.js tests/test_share_view_apply_machine.js
git add -A -- frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add the pure shareable-link apply machine" -m "A pure state machine for the staged apply of a shared link (issue 194): scope, fields, data-dependent Teams and facets, then focus, one run action per step, driven by plain readiness inputs and a caller-supplied clock. It encodes the design's lifecycle table, the 90 s overall and per-stage budgets on an active clock that stops while a tour or the first-run popup is open, and the hold release one commit after the fields were written."
git show --stat HEAD
git status --short
make verify-dist-clean
```

Read the results: `git show --stat HEAD` lists exactly four paths: `frontend/dist/dashboard.js`, the renamed `frontend/dist/lazy-views-*.json`, `frontend/src/shareView/applyMachine.js` (191 added lines) and `tests/test_share_view_apply_machine.js` (474 added lines); the `dist` counts depend on the bundle. `git status --short` prints nothing. `make verify-dist-clean` prints nothing and exits 0.


---

### Task 11a: Apply controller, capture builder, interaction guard and hook

**Owner note:** depends on Task 3 (`viewDefaults.js`, `codec.js`), Task 4 (`resolver.js`), Task 5 (`store.js`), Task 7 (`focusCapture.js`), Task 8 (`focusReveal.js`) and Task 9 (`applyMachine.js`); blocks Task 11b (the App mounts the hook). Task 11 lands as three commits: 11a (the modules and their unit tests; nothing is mounted, so no behavior changes), 11b (the App wiring, the hold, the tour wait and the budget pins), 11c (the UI acceptance spec). Task 11 is a checkpoint: the stop sits at the end of 11c.

**What lands here.** Four modules in `frontend/src/shareView/`:
- `applyController.js`: one controller per App lifetime. Each tick it reads the committed App state through `readOptions()`, builds the machine's plain input, steps the machine (Task 9) and executes the actions with raw setters and refs only. It owns the apply analytics event (queued once, sent only when analytics is ready).
- `captureState.js`: builds the `ShareViewState` the Share control encodes, from committed values only.
- `interactionGuard.js`: the `document` capture-phase listeners that cancel a pending link, behind the auth latch.
- `useShareViewApply.js`: the thin React layer: three early hooks (`useShareViewHold`, `useShareViewApplyTerminal`, `useShareViewPlanningTableKey`) and `useShareViewApply(options)`.

**Files:**
- Create: `frontend/src/shareView/applyController.js`, `frontend/src/shareView/captureState.js`, `frontend/src/shareView/interactionGuard.js`, `frontend/src/shareView/useShareViewApply.js`
- Modify: `tests/react_hook_harness.js` (`createRuntime().react`: one line, `useSyncExternalStore`)
- Test (new): `tests/test_share_view_apply_controller.js`, `tests/test_share_view_capture_state.js`, `tests/test_share_view_interaction_guard.js`, `tests/test_share_view_apply_hook.js`
- Regenerated: `frontend/dist/`

**Interfaces:**
- Consumes (siblings, exact):
  - `store.js` (Task 5): `SHARE_VIEW_PHASES`, `getShareViewSnapshot()`, `subscribeShareView(listener)`, `beginShareViewStage(stage)`, `markShareViewScopeCommitted()`, `finishShareView(result, categories) -> boolean` (true only for the call that ended the apply), `dismissShareViewNotice()`, `setPendingPlanningRowMode(mode)`.
  - `resolver.js` (Task 4): `resolveShareViewScope(state, ctx)`, `buildShareViewFieldPlan(state, scope, ctx) -> { apply, reported }`, `resolveShareViewTeams(state, group, mode)`, `resolveShareViewFacets(state, options, mode)`, `resolveShareViewFocus(state, mode)`. The controller passes the resolved `scope.mode` to the last three, so a Planning or Statistics link that fell back to Catch Up is handled as Catch Up. `resolveShareViewFocus` returns no `reported`: the `focus` category comes from the field plan's `reported`.
  - `viewDefaults.js` (Task 3): `SHARE_VIEW_VERSION`, `SHARE_VIEW_ALERT_KEYS`, `SHARE_VIEW_KEYS_BY_MODE`. `codec.js`: `encodeShareView(state) -> { ok, query, dropped } | { ok: false, reason }`.
  - `focusCapture.js` (Task 7): `captureShareViewFocus({ mode, rowsMode, root, win })` and `readPlanningRowsMode(root)`. `focusReveal.js` (Task 8): `revealShareViewFocus(target, { mode, root, win, timeoutMs, isCancelled }) -> { cancel(), done }`.
  - `applyMachine.js` (Task 9): `createApplyMachine`, `stepApplyMachine`. Existing: `readPendingAuthenticationRequired` (`api/authRequired.js`), `selectedTeamSelectionsEqual` (`teamSelectionUtils.mjs`).
- Produces:
```
// applyController.js
createApplyController({ readOptions, now = clock }) -> { noteCommit(), noteInterrupt(kind), isPaused(), evaluate(), flushTrack(track, analyticsReady) }
resolveApplyPlan(o, state) -> { ok: true, scope, teams, reported, plan } | { ok: false, categories }
readFacetOptionIds(facetModel) -> { status: string[], priority: string[], track: string[] }
// captureState.js
STATS_RANGE_KIND                       // { cohort: 'quarter', excludedCapacity: 'sprint', monoCrossShare: 'sprint', projectTrack: 'sprint' }
buildShareViewState({ mode, groupId, sprintId, snapshot, searchQuery, sort, layout, rowsMode, boardStrictScope, sprintRange, alertFlags, alertCounts, focus }) -> ShareViewState
// interactionGuard.js
armInteractionGuard({ doc = document, onInteraction, isPaused = () => false }) -> disarm()
SHARE_VIEW_MODIFIER_KEYS               // Set of the eleven modifier and lock keys that are not an interaction
// useShareViewApply.js
useShareViewHold() -> boolean                       // true while a pending link must hold the default-scope ENG load
useShareViewApplyTerminal() -> boolean              // false only while a link is pending or running
useShareViewPlanningTableKey() -> 0 | 1             // changes once, when Stage C begins; the App keys the Planning table on it
useShareViewApply(options) -> { notice, dismissNotice(), captureShareUrl(), shareDisabled, applyTerminal }
   // captureShareUrl() is synchronous: { ok: true, url, dropped } | { ok: false, reason: 'disabled' | 'too_long' | 'invalid_state' }
```

**The options object.** `useShareViewApply(options)` takes one flat object; the controller and the hook read exactly these 73 names, and Task 11b's source guard fails if the App passes one the apply does not read or leaves one out. The "Passed by the App as" column is the call site that Task 11b adds.

| Option | Passed by the App as | Read by | Meaning |
| --- | --- | --- | --- |
| `sharedConfigReady` | `sharedConfigReady` | controller | The shared config has settled (set in a finally, so it means settled, not ok). Nothing is timed before it. |
| `groupsLoading` | `groupsLoading` | controller and hook | The Department groups are still loading. |
| `groupsFailed` | `Boolean(groupsError \|\| boardGroupsReadFailed)` | controller | The groups read failed (the groups config or the Board groups read). |
| `onboardingRequired` | `groupPreferences.onboardingRequired` | controller and hook | The first-run Department popup is open (valid only once groups have loaded). Pauses the link. |
| `adminSettingsGate` | `adminSettingsGate` | controller and hook | The workspace gate; `status` is `clear`, `missing` (no workspace configuration) or pending. |
| `sprintCatalogState` | `sprintCatalogState` | controller and hook | The Sprint catalog: `authority`, `status`, `validatedSnapshot` and `availableSprints` (entries with start dates). |
| `homeTokenConnectionLoaded` | `homeTokenConnectionLoaded` | controller | The Home token read finished; needed only when the saved view is EPM. |
| `savedViewIsEpm` | `savedInitialViewRef.current === 'epm'` | controller | The recipient's saved initial view is EPM, so the one-shot EPM restore has to fire first. |
| `visibleControlGroups` | `visibleControlGroups` | controller | The Departments the recipient has made visible (the link's group must be one of them). |
| `pendingShellAuthResumeRef` | `pendingShellAuthResumeRef` | controller | The staged auth-recovery capsule; the link waits for it to be consumed. |
| `pendingPlanningAuthResumeRef` | `pendingPlanningAuthResumeRef` | controller | The staged Planning recovery capsule; the link waits for it and the ENG load runs for it despite the hold. |
| `pendingConnectionRecoveryRef` | `pendingConnectionRecoveryRef` | controller | The connection-recovery scroll; Stage D waits until it is idle. |
| `tourRunning` | `onboarding.run` | controller | An onboarding tour is running. Pauses the link. |
| `planningReviewBusy` | `Boolean(planningReview.dirty \|\| planningReview.saving \|\| planningReview.pendingScopeChange)` | controller | The Planning review is dirty, saving or has a pending scope change. Cancels the link. |
| `activeGroupId` | `activeGroupId` | controller and hook | The committed Department. |
| `selectedSprint` | `selectedSprint` | controller and hook | The committed Sprint id. |
| `planningScopeKey` | `planningScopeKey` | controller | The Planning scope key (group plus Sprint); Stage B waits for it to hydrate. |
| `teamSelectionScopeKey` | `teamSelectionScopeKey` | controller and hook | The Team selection scope key; the Team hydrate has to reach it before Stage C. |
| `selectedView` | `selectedView` | hook | The committed top-level view (`eng` or `epm`). |
| `selectedTeams` | `selectedTeams` | controller | The committed Team selection; Stage C writes Teams only when it differs from the link. |
| `tasksFetched` | `tasksFetched` | controller | A task load has completed for the committed scope. |
| `tasksLoading` | `productTasksLoading \|\| techTasksLoading` | controller | A Product or Tech task lane is loading. |
| `engLoadsTasks` | `selectedView === 'eng' && !isStatsSourceOnlyStatsView && !boardScopeRequested` | controller and hook | The committed mode loads a task list: false for a strict Board scope and the source-only Statistics views. The apply skips Teams and facets there, and Share does not wait for a Team hydrate that never runs. |
| `activeGroupRef` | `activeGroupRef` | controller | The group the group-state effect last applied. |
| `planningHydratedScopeRef` | `planningHydratedScopeRef` | controller | The Planning scope that has hydrated. |
| `restoringGroupRef` | `restoringGroupRef` | controller | A group restore is in flight. |
| `teamSelectionHydratedScopeRef` | `teamSelectionHydratedScopeRef` | controller and hook | The Team selection scope that has hydrated. |
| `lastLoadedSprintRef` | `lastLoadedSprintRef` | controller | The Sprint the last task load was for. |
| `loadEpochRef` | `loadEpochRef` | controller | A counter that increments when a task load completes. |
| `catchUpAlertLoadRef` | `catchUpAlertLoadRef` | controller | The scope key the Catch Up alert cohort last loaded for. |
| `catchUpAlertScopeKey` | `catchUpAlertScopeKey` | controller | The committed Catch Up alert scope key. |
| `alertCohortRef` | `alertCohortRef` | controller | The alert cohort still being gathered (null once settled). |
| `engSprintSelectorState` | `engSprintSelectorState` | controller | The Board scope readiness for the Component and All work scopes. |
| `engCatchUpFacetModel` | `engCatchUpFacetModel` | controller | The Catch Up facet model; its option ids are what status, priority and Project Track atoms match. |
| `restoredInitialEpmViewRef` | `restoredInitialEpmViewRef` | controller | The one-shot EPM restore flag, consumed by Stage A. |
| `setSelectedView` | `setSelectedView` | controller | Raw setter: `selectedView`. |
| `setActiveGroupId` | `setActiveGroupId` | controller | Raw setter: the Department. |
| `commitSprintSelection` | `commitSprintSelection` | controller | The Task 6 helper: Sprint, Team carry-forward and the Project Track range. |
| `persistTeamSelection` | `persistTeamSelection` | controller | The Task 6 helper: stores a Team selection for the scope. |
| `setShowPlanning` | `setShowPlanning` | controller | Raw setter: Planning mode flag. |
| `setShowStats` | `setShowStats` | controller | Raw setter: Statistics mode flag. |
| `setShowScenario` | `setShowScenario` | controller | Raw setter: Scenario mode flag (always written false). |
| `setShowBoard` | `setShowBoard` | controller | Raw setter: Board mode flag. |
| `setSearchInput` | `setSearchInput` | controller | Raw setter: the search input text. |
| `setSearchQuery` | `setSearchQuery` | controller | Raw setter: the committed search text. |
| `setShowProduct` | `setShowProduct` | controller | Raw setter: the Product lane. |
| `setShowTech` | `setShowTech` | controller | Raw setter: the Tech lane. |
| `setGroupByInitiativeChoice` | `setGroupByInitiativeChoice` | controller | Raw setter: initiative grouping (`null`, `true` or `false`). |
| `setEngEpicSort` | `setEngEpicSort` | controller | Raw setter: Epic sort. |
| `setPlanningLayout` | `setPlanningLayout` | controller | Raw setter: Planning layout (`list` or `table`). |
| `setStatsView` | `setStatsView` | controller | Raw setter: the Statistics view. |
| `setCohortStartQuarter` | `setCohortStartQuarter` | controller | Raw setter: Lead Times range start. |
| `setCohortEndQuarter` | `setCohortEndQuarter` | controller | Raw setter: Lead Times range end. |
| `setExcludedCapacityStartSprintId` | `setExcludedCapacityStartSprintId` | controller | Raw setter: Sprint range start of the source-only views. |
| `setExcludedCapacityEndSprintId` | `setExcludedCapacityEndSprintId` | controller | Raw setter: Sprint range end of the source-only views. |
| `setShowAlertsPanel` | `setShowAlertsPanel` | controller | Raw setter: the alerts panel. |
| `setBoardStrictScope` | `setBoardStrictScope` | controller | Raw setter: the Board strict scope (`''`, `component`, `all_work`). |
| `setSelectedTeams` | `setSelectedTeams` | controller | Raw setter: the Team selection state. |
| `setEngStatusFilter` | `setEngStatusFilter` | controller | Raw setter: the status facet. |
| `setEngPriorityFilter` | `setEngPriorityFilter` | controller | Raw setter: the priority facet. |
| `setEngProjectTrackFilter` | `setEngProjectTrackFilter` | controller | Raw setter: the Project Track facet. |
| `alertFlags` | `{ missing: [showMissingAlert, setShowMissingAlert], ... }` (ten pairs) | controller and hook | The ten alert categories, each as `[expanded, setExpanded]` (`missing`, `blocked`, `followup`, `backlog`, `missingTeam`, `missingLabels`, `needsStories`, `waiting`, `empty`, `done`). |
| `activeEngMode` | `activeEngMode` | controller and hook | The mode derived from the four flags; capture reads it, and a link that never resolved reports it as its analytics surface. |
| `buildGroupStateSnapshot` | `buildGroupStateSnapshot` | hook | A fresh snapshot function (not the memoized `groupStateSnapshot`, whose dependency list omits `showAlertsPanel`). |
| `searchQuery` | `searchQuery` | hook | The committed search text (never `searchInput`). |
| `engEpicSort` | `engEpicSort` | hook | The committed Epic sort. |
| `planningLayout` | `planningLayout` | hook | The committed Planning layout. |
| `boardStrictScope` | `boardStrictScope` | hook | The committed Board strict scope. |
| `excludedCapacityStartSprintId` | `excludedCapacityStartSprintId` | hook | The committed Sprint range start of the source-only views. |
| `excludedCapacityEndSprintId` | `excludedCapacityEndSprintId` | hook | The committed Sprint range end of the source-only views. |
| `alertCounts` | `alertCounts` | hook | How many alerts each category rendered (capture lists only rendered, expanded categories). |
| `trackShareViewAction` | `trackShareViewAction` | hook | Task 10: sends the apply event. |
| `analyticsReady` | `analyticsReady` | hook | Task 10: the analytics context is ready; an earlier event would be dropped. |

**Rules the code keeps** (each is pinned by a test below):
- Raw setters and refs only. `applyEngMode`, `clearEngFilters`, `resetEngFilters`, `navigateToAlertStory` and `handleAlertStoryClick` are never used (the controller test hands the options bag throwing getters for them and for `saveGroupPreferences`; Task 11b adds a source guard).
- The resolver is re-run before every stage, so a settings save or a refresh that removed the group or Sprint mid-apply stops the link (`partial`, naming `group`). A fault anywhere in a tick is caught: the link finishes `partial` (or `dropped` when Stage A never ran) naming what was unfinished, and the dashboard stays up.
- The apply event is queued once. It is sent by `flushTrack` only when analytics is ready and only when `finishShareView` returned true. Its `sourceSurface` is the link's resolved mode, else the recipient's current ENG mode, else `catch_up`: never missing. A link that is already terminal when the store initializes (`newer`, `invalid`) reports one `rejected` event from the first tick.
- Planning rows: Stage B decides the Epics/Stories rows and the first Stage C run seeds them (`setPendingPlanningRowMode`) before the stage begins. The first ENG load after the hold unmounts the Planning table, so a seed taken at the table's first mount would be lost; `useShareViewPlanningTableKey` flips when Stage C begins and the App keys the table on it, so the seed is read by a fresh mount.
- The capture reads committed state only: `searchQuery` (not the input), the raw facet state from `buildGroupStateSnapshot()` (a fresh function: the memoized `groupStateSnapshot` omits `showAlertsPanel` from its dependencies), `selectedTeams` exactly as stored, and the Planning rows mode from the rendered table through `readPlanningRowsMode`. The encoder drops defaults and keys outside the mode, layout and Statistics view.
- Interaction cancel: before Stage D a deliberate interaction (`pointerdown`, a non-modifier `keydown`, `touchstart`) cancels the link with no notice; `wheel` and `touchmove` are ignored; from Stage D any of the five cancels only the reveal; while the first-run popup or a tour pauses the link the listeners are ignored. A key press is not an interaction when it is one of `SHARE_VIEW_MODIFIER_KEYS`: Shift, Control, Alt, AltGraph, Meta, CapsLock, NumLock, ScrollLock, Fn, FnLock, OS (one pinned list). The listeners are `document` capture-phase, passive, read the auth latch first, and ignore untrusted events: they are not `window.addEventListener('keydown', handler)` registrations, whose count `tests/test_auth_isolation_source_guard.js` pins.
- The reveal is started with an `isCancelled` that is true when the machine cancelled it, when the guard reported an interaction since the last tick, or when the terminal auth latch is set, so it stops at its next frame without waiting for a tick.
- Share is disabled until the scope is settled: a Sprint, loaded Departments, no first-run popup, a configured workspace, a validated catalog, no pending apply, a Team scope key and, only where a task list loads (`engLoadsTasks`), a Team selection hydrated to that key. A source-only Statistics view and a strict Board scope load no tasks, so no Team hydrate ever runs there and Share does not wait for one.

**Forbidden regressions for this task:**
- [ ] No write path: `shareView/` imports no `configApi`, `jiraIssueApi`, `postJsonWithCsrf` or `saveGroupPreferences`, and issues no network request (Task 11b adds the source guard, Task 11c the request log).
- [ ] No link value is interpolated into a selector; no browser storage use; no `window` `keydown` listener.
- [ ] The hook result is exactly `{ notice, dismissNotice, captureShareUrl, shareDisabled, applyTerminal }` (Task 12 renders the notice inside the Share control and calls `dismissNotice()` with no arguments).
- [ ] Share is enabled in every settled view, including a source-only Statistics view and a strict Board scope (the hook test pins `engLoadsTasks: false` with an un-hydrated selection).
- [ ] `captureShareUrl()` stays synchronous (Safari requires the clipboard write inside the click handler).
- [ ] Nothing is mounted by this task: `dashboard.jsx` is untouched, so the manifest pins stay where Task 6 left them and no behavior changes.
- [ ] Analytics impact: the `apply_link` event is the only one; it carries enum tokens only (Task 10's builder), never a URL, id, name or key.

- [ ] **Step 0: Preflight and baselines**

Run every command of this task from the worktree root with `JEP_TEST_PYTHON` exported (a command may run in a fresh shell, so export it again or write the interpreter path in place of `$PY`; the extraction lint reads `JEP_TEST_PYTHON` too) and with the Python test environment typed inline exactly as the commands show it.

Run:
```bash
git branch --show-current
git status --short
rg -n "export (function|const) (encodeShareView|resolveShareViewScope|buildShareViewFieldPlan|resolveShareViewTeams|resolveShareViewFacets|resolveShareViewFocus|captureShareViewFocus|readPlanningRowsMode|revealShareViewFocus|finishShareView|markShareViewScopeCommitted|beginShareViewStage|setPendingPlanningRowMode|dismissShareViewNotice|subscribeShareView|getShareViewSnapshot)\b" frontend/src/shareView | wc -l
ls frontend/src/shareView/applyMachine.js
rg -n "export function trackShareViewAction|analyticsReady," frontend/src/analytics/dashboardAnalytics.js
fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'
fnm exec --using 20 bash scripts/extraction_lint/run.sh 2>&1 | grep -E 'problems \('
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; the first `rg` prints `16` (every sibling export named above exists: if fewer, an earlier task is missing or renamed a name, so stop and report); `applyMachine.js` exists; the analytics module exports `trackShareViewAction` and returns `analyticsReady`; the Node summary shows `# fail 0` (write down `# tests` as N0); the lint line shows `0 errors` (write down the warning count as W0).

- [ ] **Step 1: Write the failing tests**

First give the hook harness a `useSyncExternalStore` (the early hooks read the store through it). In `tests/react_hook_harness.js`, inside `createRuntime()`'s `react` object:

Replace this:

```js
        useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
        useEffect(effect, deps) {
```

with:

```js
        useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
        useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
        useEffect(effect, deps) {
```

Create `tests/test_share_view_apply_controller.js`. It bundles the controller with the REAL store, codec, resolver and view defaults (one bundle, evaluated afresh per rig so each rig owns its store) and doubles only the DOM reveal; a Sprint catalog with start dates, two Departments, and a log of what the store went through:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const SHARE_VIEW = path.join(__dirname, '..', 'frontend', 'src', 'shareView');
const ALERT_KEYS = ['missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done'];
const NOW = new Date();
const THIS_QUARTER = `${NOW.getFullYear()}Q${Math.floor(NOW.getMonth() / 3) + 1}`;

// The controller runs against the real store, codec, resolver and view defaults, so the test sees what the app sees. Only the
// DOM reveal is a double. One bundle serves every rig; each rig evaluates it afresh, so each rig owns its store.
const BUNDLE = esbuild.buildSync({
    stdin: {
        contents: "export * from './applyController.js'; export * as store from './store.js'; export { encodeShareView } from './codec.js';",
        resolveDir: SHARE_VIEW, sourcefile: 'apply-controller-test-entry.js',
    },
    bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['./focusReveal.js'],
}).outputFiles[0].text;

const SPRINTS = [
    { id: 41, name: 'Sprint 41', state: 'active', startDate: '2026-01-05' },
    { id: 42, name: 'Sprint 42', state: 'future', startDate: '2026-01-19' },
    { id: 40, name: 'Sprint 40', state: 'closed', startDate: '2025-12-22' },
];

function createRig({ link, search, options = {} } = {}) {
    const revealLog = [];
    const reveal = {
        revealShareViewFocus: (target, revealOptions) => {
            let cancelled = false;
            let resolveDone;
            const done = new Promise((resolve) => { resolveDone = resolve; });
            const handle = { target, options: revealOptions, cancel: () => { cancelled = true; resolveDone('cancelled'); }, finish: result => resolveDone(result), get cancelled() { return cancelled; }, done };
            revealLog.push(handle);
            return handle;
        },
    };
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', BUNDLE)(loaded, loaded.exports, () => reveal);
    const { createApplyController, readFacetOptionIds, store, encodeShareView } = loaded.exports;
    const query = search ?? (link ? `?${encodeShareView(link).query}` : '');
    store.initShareViewFromLocation({ location: { search: query, pathname: '/', hash: '' }, history: { state: null, replaceState() {} } });
    // What the store went through, in the shapes the assertions read: stage starts, the hold release and the end.
    const storeLog = [];
    let seen = store.getShareViewSnapshot();
    store.subscribeShareView(() => {
        const next = store.getShareViewSnapshot();
        if (next.phase === 'running' && (seen.phase !== 'running' || next.stage !== seen.stage)) storeLog.push(['begin', next.stage]);
        if (seen.hold && !next.hold && !next.terminal) storeLog.push(['holdReleased']);
        if (next.terminal && !seen.terminal) storeLog.push(['finish', next.phase, next.notice ? [...next.notice.categories] : []]);
        seen = next;
    });
    const log = [];
    const spy = name => (...args) => log.push([name, ...args]);
    const o = {
        sharedConfigReady: true, groupsLoading: false, groupsFailed: false, onboardingRequired: false, adminSettingsGate: { status: 'clear' },
        sprintCatalogState: { authority: 'validated', status: 'ready', validatedSnapshot: {}, availableSprints: SPRINTS },
        homeTokenConnectionLoaded: true, savedViewIsEpm: false,
        visibleControlGroups: [{ id: 'grp-a', teamIds: ['t1', 't2'] }, { id: 'grp-b', teamIds: ['t3', ' t4 ', 't3'] }],
        pendingShellAuthResumeRef: { current: null }, pendingPlanningAuthResumeRef: { current: null }, pendingConnectionRecoveryRef: { current: null },
        tourRunning: false, planningReviewBusy: false,
        activeGroupId: 'grp-a', selectedSprint: 41, planningScopeKey: 'planning::41::grp-a', teamSelectionScopeKey: 'team-selection::41::grp-a',
        selectedTeams: ['all'], tasksFetched: false, tasksLoading: false, engLoadsTasks: true, activeEngMode: 'catch-up',
        activeGroupRef: { current: 'grp-a' }, planningHydratedScopeRef: { current: 'planning::41::grp-a' }, restoringGroupRef: { current: false },
        teamSelectionHydratedScopeRef: { current: '' }, lastLoadedSprintRef: { current: null }, loadEpochRef: { current: 0 },
        catchUpAlertLoadRef: { current: '' }, catchUpAlertScopeKey: 'alert-scope', alertCohortRef: { current: null },
        engSprintSelectorState: { componentReadiness: 'ready', allWorkReadiness: 'ready' },
        engCatchUpFacetModel: { facets: [
            { id: 'status', options: [{ id: 'In Progress' }, { id: 'To Do' }, { id: 'Done' }] },
            { id: 'priority', options: [{ id: 'Blocker' }, { id: 'Major' }] },
            { id: 'track', options: [{ id: 'Committed' }, { id: 'Flexible' }] },
        ] },
        restoredInitialEpmViewRef: { current: false },
        setSelectedView: spy('setSelectedView'), setActiveGroupId: spy('setActiveGroupId'),
        commitSprintSelection: spy('commitSprintSelection'), persistTeamSelection: spy('persistTeamSelection'),
        setShowPlanning: spy('setShowPlanning'), setShowStats: spy('setShowStats'), setShowScenario: spy('setShowScenario'), setShowBoard: spy('setShowBoard'),
        setSearchInput: spy('setSearchInput'), setSearchQuery: spy('setSearchQuery'), setShowProduct: spy('setShowProduct'), setShowTech: spy('setShowTech'),
        setGroupByInitiativeChoice: spy('setGroupByInitiativeChoice'), setEngEpicSort: spy('setEngEpicSort'), setPlanningLayout: spy('setPlanningLayout'),
        setStatsView: spy('setStatsView'), setCohortStartQuarter: spy('setCohortStartQuarter'), setCohortEndQuarter: spy('setCohortEndQuarter'),
        setExcludedCapacityStartSprintId: spy('setExcludedCapacityStartSprintId'), setExcludedCapacityEndSprintId: spy('setExcludedCapacityEndSprintId'),
        setShowAlertsPanel: spy('setShowAlertsPanel'), setBoardStrictScope: spy('setBoardStrictScope'), setSelectedTeams: spy('setSelectedTeams'),
        setEngStatusFilter: spy('setEngStatusFilter'), setEngPriorityFilter: spy('setEngPriorityFilter'), setEngProjectTrackFilter: spy('setEngProjectTrackFilter'),
        alertFlags: Object.fromEntries(ALERT_KEYS.map(key => [key, [true, spy(`flag:${key}`)]])),
        ...options,
    };
    // None of the App's navigation, reset or analytics-emitting helpers may be reachable from the apply.
    for (const name of ['applyEngMode', 'clearEngFilters', 'resetEngFilters', 'navigateToAlertStory', 'handleAlertStoryClick', 'saveGroupPreferences']) {
        Object.defineProperty(o, name, { get() { throw new Error(`${name} must never be read by the link apply`); }, enumerable: false });
    }
    const clock = { now: 0 };
    const controller = createApplyController({ readOptions: () => o, now: () => clock.now });
    const tick = (advance = 0, { commit = true } = {}) => {
        clock.now += advance;
        if (commit) controller.noteCommit();
        controller.evaluate();
    };
    const tracked = [];
    const flush = (analyticsReady = true) => controller.flushTrack(payload => tracked.push(payload), analyticsReady);
    const take = () => log.splice(0);
    return {
        o, log, take, controller, tick, flush, tracked, revealLog, readFacetOptionIds,
        store: { log: storeLog, module: store, snapshot: () => store.getShareViewSnapshot() },
    };
}

const LINK = {
    version: 1, mode: 'catch-up', group: 'grp-b', sprint: '42', teams: ['t3'], find: 'login', lanes: { product: false, tech: true },
    initiatives: true, sort: 'status', alerts: ['blocked'], status: { only: ['in progress'] }, priority: { hidden: ['major'] }, track: [],
};

// What React would have committed after Stage A (the Department and Sprint are now the link's).
function commitScope(rig, { group = 'grp-b', sprint = 42 } = {}) {
    const { o } = rig;
    o.activeGroupId = group;
    o.selectedSprint = sprint;
    o.activeGroupRef.current = group;
    o.planningScopeKey = `planning::${sprint}::${group}`;
    o.planningHydratedScopeRef.current = o.planningScopeKey;
    o.teamSelectionScopeKey = `team-selection::${sprint}::${group}`;
}

function finishLoad(rig, { group = 'grp-b', sprint = 42 } = {}) {
    const { o } = rig;
    o.loadEpochRef.current += 1;
    o.tasksFetched = true;
    o.lastLoadedSprintRef.current = sprint;
    o.teamSelectionHydratedScopeRef.current = `team-selection::${sprint}::${group}`;
}

test('a scope-changing Catch Up link applies scope, fields, Teams and facets in four separate stages', () => {
    const rig = createRig({ link: LINK });
    rig.tick();
    assert.deepEqual(rig.take(), [
        ['setSelectedView', 'eng'],
        ['setActiveGroupId', 'grp-b'],
        ['commitSprintSelection', { id: 42, name: 'Sprint 42', state: 'future' }, { groupId: 'grp-b', teams: ['t3'], projectTrackRange: false }],
    ]);
    assert.equal(rig.o.restoredInitialEpmViewRef.current, true);
    assert.deepEqual(rig.store.log, [['begin', 'A']]);

    rig.tick();
    assert.deepEqual(rig.take(), [], 'Stage B waits for the scope to commit');
    commitScope(rig);
    rig.tick();
    assert.deepEqual(rig.take(), [
        ['setShowPlanning', false], ['setShowStats', false], ['setShowScenario', false], ['setShowBoard', false],
        ['setSearchInput', 'login'], ['setSearchQuery', 'login'], ['setShowProduct', false], ['setShowTech', true],
        ['setGroupByInitiativeChoice', true], ['setEngEpicSort', 'status'],
        ['setShowAlertsPanel', true],
        ...ALERT_KEYS.map(key => [`flag:${key}`, key === 'blocked']),
    ]);
    assert.deepEqual(rig.store.log, [['begin', 'A'], ['begin', 'B']]);

    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['holdReleased'], 'the hold is released only after Stage B committed');

    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.tick();
    assert.deepEqual(rig.take(), [], 'the hydrate effect already applied the carried-forward Teams');
    rig.tick();
    assert.deepEqual(rig.take(), [
        ['setEngStatusFilter', { only: ['In Progress'] }], ['setEngPriorityFilter', { hidden: ['Major'] }], ['setEngProjectTrackFilter', []],
    ]);
    rig.tick();
    assert.deepEqual(rig.store.log.slice(-1), [['finish', 'done', []]]);
});

test('Stage C corrects Teams only when the hydrate effect did not already set them', () => {
    const rig = createRig({ link: { ...LINK, teams: ['t3', 'zz'] } });
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    rig.take();
    finishLoad(rig);
    rig.tick();
    assert.deepEqual(rig.take(), [['persistTeamSelection', ['t3']], ['setSelectedTeams', ['t3']]]);
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['teams']], 'the dropped Team id is named, never its value');
});

test('a same-scope link skips the scope write but still syncs the view and applies fields, Teams and facets', () => {
    const rig = createRig({ link: { ...LINK, group: 'grp-a', sprint: '41', teams: ['t1'] } });
    rig.tick();
    assert.deepEqual(rig.take(), [['setSelectedView', 'eng']]);
    assert.equal(rig.o.restoredInitialEpmViewRef.current, true);
    rig.tick();
    assert.equal(rig.log.some(([name]) => name === 'setShowPlanning'), true, 'Stage B runs next, without waiting for a commit');
    rig.take();
    rig.tick();
    finishLoad(rig, { group: 'grp-a', sprint: 41 });
    rig.tick();
    assert.deepEqual(rig.take(), [['persistTeamSelection', ['t1']], ['setSelectedTeams', ['t1']]]);
    rig.tick();
    rig.tick();
    assert.equal(rig.log.some(([name]) => name === 'setEngStatusFilter'), true);
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []]);
});

test('a recipient whose saved view is EPM waits for the Home token read, then lands in ENG without the one-shot restore', () => {
    const rig = createRig({ link: LINK, options: { savedViewIsEpm: true, homeTokenConnectionLoaded: false } });
    rig.tick();
    assert.deepEqual(rig.take(), []);
    rig.o.homeTokenConnectionLoaded = true;
    rig.tick();
    assert.deepEqual(rig.take().slice(0, 1), [['setSelectedView', 'eng']]);
    assert.equal(rig.o.restoredInitialEpmViewRef.current, true);
});

test('saved Scenario flags are overwritten by the four mode booleans with Scenario always off', () => {
    const rig = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'table', rows: 'story' } });
    rig.tick();
    rig.take();
    rig.tick();
    const names = rig.take().filter(([name]) => name.startsWith('setShow') && !name.startsWith('setShowAlerts') && name !== 'setShowProduct' && name !== 'setShowTech');
    assert.deepEqual(names, [['setShowPlanning', true], ['setShowStats', false], ['setShowScenario', false], ['setShowBoard', false]]);
});

test('the Planning rows are seeded once, when Stage C begins after the scope has loaded: the first load unmounts the table', () => {
    const rig = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'table', rows: 'story' } });
    const { module: store } = rig.store;
    rig.tick();
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.store.log.map(entry => entry[0]), ['begin', 'begin', 'holdReleased']);
    assert.equal(store.takeInitialPlanningRowMode(), null, 'nothing is seeded after Stage B: the table that mounts then is unmounted again by the load');
    finishLoad(rig, { group: 'grp-a', sprint: 41 });
    rig.tick();
    assert.equal(store.getShareViewSnapshot().stage, 'C');
    assert.equal(store.takeInitialPlanningRowMode(), 'story', 'the seed holds the link rows until the table remounts');
    rig.tick();
    rig.tick();
    assert.equal(store.takeInitialPlanningRowMode(), null, 'later Stage C parts and Stage D do not seed again');

    const list = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'list' } });
    for (let step = 0; step < 4; step += 1) { finishLoad(list, { group: 'grp-a', sprint: 41 }); list.tick(); }
    assert.equal(list.store.module.takeInitialPlanningRowMode(), null, 'the List layout has no rows to seed');

    const cancelled = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'table', rows: 'story' } });
    cancelled.tick();
    cancelled.tick();
    cancelled.controller.noteInterrupt('deliberate');
    cancelled.tick();
    assert.deepEqual(cancelled.store.log.at(-1), ['finish', 'cancelled', []]);
    assert.equal(cancelled.store.module.takeInitialPlanningRowMode(), null, 'a cancelled link seeds nothing');
});

test('a pending auth or Planning recovery capsule holds the link until the capsule is consumed', () => {
    for (const ref of ['pendingShellAuthResumeRef', 'pendingPlanningAuthResumeRef']) {
        const rig = createRig({ link: LINK, options: { [ref]: { current: { scopeKey: 'x' } } } });
        rig.tick();
        rig.tick(2000);
        assert.deepEqual(rig.take(), [], ref);
        rig.o[ref].current = null;
        rig.tick();
        assert.equal(rig.log.some(([name]) => name === 'setActiveGroupId'), true, ref);
    }
});

test('the first-run popup pauses the link; a group the recipient does not have drops it with the group category on the recipient surface', () => {
    const rig = createRig({ link: { ...LINK, group: 'grp-link' }, options: { onboardingRequired: true, visibleControlGroups: [] } });
    for (let step = 0; step < 5; step += 1) rig.tick(30000);
    assert.deepEqual(rig.take(), []);
    assert.equal(rig.controller.isPaused(), true);
    rig.o.onboardingRequired = false;
    rig.o.visibleControlGroups = [{ id: 'grp-picked', teamIds: ['t1'] }];
    rig.tick(100);
    assert.deepEqual(rig.take(), []);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', ['group']]]);
    rig.flush(false);
    assert.deepEqual(rig.tracked, [], 'nothing is sent before analytics is ready');
    rig.flush(true);
    rig.flush(true);
    assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'rejected', sourceSurface: 'catch_up' }], 'exactly one apply event');

    const planning = createRig({ link: { ...LINK, group: 'grp-link' }, options: { activeEngMode: 'planning' } });
    planning.tick();
    planning.flush(true);
    assert.deepEqual(planning.tracked.map(entry => entry.sourceSurface), ['planning'], 'a link that never resolved reports the recipient mode');
});

test('an unresolvable Sprint drops the link and applies nothing', () => {
    const rig = createRig({ link: { ...LINK, sprint: '999' } });
    rig.tick();
    assert.deepEqual(rig.take(), []);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', ['sprint']]]);
});

test('a link that cannot start names no category, so the notice stays neutral', () => {
    const rig = createRig({ link: LINK, options: { groupsFailed: true } });
    rig.tick();
    assert.deepEqual(rig.take(), []);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', []]]);
});

test('a Planning link for a closed Sprint is applied as Catch Up and reports the mode', () => {
    const rig = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '40' } });
    rig.tick();
    commitScope(rig, { group: 'grp-a', sprint: 40 });
    rig.tick();
    rig.tick();
    const modeWrites = rig.take().filter(([name]) => name === 'setShowPlanning' || name === 'setShowBoard');
    assert.deepEqual(modeWrites, [['setShowPlanning', false], ['setShowBoard', false]]);
    for (let step = 0; step < 6; step += 1) { finishLoad(rig, { group: 'grp-a', sprint: 40 }); rig.tick(); }
    assert.equal(rig.store.log.at(-1)[1], 'partial');
    assert.ok(rig.store.log.at(-1)[2].includes('mode'));
});

test('a Statistics link whose Sprint is still in the future is applied as Catch Up: Teams and facets resolve for the resolved mode', () => {
    const rig = createRig({ link: { version: 1, mode: 'statistics', group: 'grp-a', sprint: '42', stats: 'projectTrack' } });
    rig.tick();
    assert.deepEqual(rig.take().pop(), ['commitSprintSelection', { id: 42, name: 'Sprint 42', state: 'future' }, { groupId: 'grp-a', teams: ['all'], projectTrackRange: false }]);
    commitScope(rig, { group: 'grp-a', sprint: 42 });
    rig.tick();
    rig.tick();
    rig.take();
    finishLoad(rig, { group: 'grp-a', sprint: 42 });
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.take().filter(([name]) => /^setEng/.test(name)), [
        ['setEngStatusFilter', { hidden: ['Killed'] }], ['setEngPriorityFilter', null], ['setEngProjectTrackFilter', undefined],
    ]);
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['mode']]);
    rig.flush(true);
    assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'partial', sourceSurface: 'catch_up' }]);
});

test('decode-time reports reach the notice and the result is partial', () => {
    const rig = createRig({ search: '?v=1&mode=catch-up&group=grp-a&sprint=41&status=bogus' });
    for (let step = 0; step < 8; step += 1) { finishLoad(rig, { group: 'grp-a', sprint: 41 }); rig.tick(); }
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['filters']]);
});

test('every raw write goes through the options bag: the throwing helpers are never read', () => {
    const rig = createRig({ link: { ...LINK, focus: { kind: 'epic', key: 'PROJ-1' } } });
    for (let step = 0; step < 12; step += 1) {
        if (step === 1) commitScope(rig);
        if (step === 4) finishLoad(rig);
        if (step === 8) { rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey; }
        rig.tick(50);
    }
    assert.equal(rig.revealLog.length, 1, 'Stage D ran without touching a forbidden helper');
});

test('Stage D reveals the focus target once the alert cohort settles and finishes on the reveal result', async () => {
    const rig = createRig({ link: { ...LINK, focus: { kind: 'epic', key: 'PROJ-1' } } });
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.tick();
    rig.tick();
    rig.tick();
    assert.equal(rig.revealLog.length, 0, 'the alert cohort has not settled');
    rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
    rig.tick();
    assert.equal(rig.revealLog.length, 1);
    assert.deepEqual(rig.revealLog[0].target, { kind: 'epic', key: 'PROJ-1' });
    assert.equal(rig.revealLog[0].options.mode, 'catch-up');
    assert.equal(rig.revealLog[0].options.isCancelled(), false);
    rig.revealLog[0].finish('revealed');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []]);
});

test('a missing focus target is reported as focus', async () => {
    const rig = createRig({ link: { ...LINK, alertTeam: { anchor: 'blocked', id: 't3' } } });
    rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.tick();
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.revealLog[0].target, { kind: 'alertTeam', anchor: 'blocked', id: 't3' });
    rig.revealLog[0].finish('missing');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['focus']]);
    rig.flush(true);
    assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'partial', sourceSurface: 'catch_up' }]);
});

test('a deliberate interaction before the reveal cancels the link without a notice; scrolling alone does not', () => {
    const rig = createRig({ link: LINK });
    rig.tick();
    rig.controller.noteInterrupt('scroll');
    rig.tick();
    assert.equal(rig.store.log.some(([name]) => name === 'finish'), false);
    rig.controller.noteInterrupt('deliberate');
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'cancelled', []]);
    assert.equal(rig.store.snapshot().notice, null);
    rig.flush(true);
    assert.deepEqual(rig.tracked.map(entry => entry.result), ['rejected']);
});

test('an interaction during the reveal cancels only the reveal and keeps the applied stages', async () => {
    const rig = createRig({ link: { ...LINK, focus: { kind: 'story', key: 'PROJ-9' } } });
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
    rig.tick();
    rig.tick();
    rig.tick();
    assert.equal(rig.revealLog.length, 1);
    rig.controller.noteInterrupt('deliberate');
    rig.tick();
    assert.equal(rig.revealLog[0].cancelled, true);
    assert.equal(rig.revealLog[0].options.isCancelled(), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []], 'the user scrolled on their own, so focus is not reported');
});

test('the reveal is cancelled by an interaction the guard reported since the last tick and by the terminal auth lock', () => {
    const drive = () => {
        const rig = createRig({ link: { ...LINK, focus: { kind: 'story', key: 'PROJ-9' } } });
        rig.tick();
        commitScope(rig);
        rig.tick();
        rig.tick();
        finishLoad(rig);
        rig.o.selectedTeams = ['t3'];
        rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
        rig.tick();
        rig.tick();
        rig.tick();
        assert.equal(rig.revealLog.length, 1);
        return rig;
    };
    const interacted = drive();
    const { isCancelled } = interacted.revealLog[0].options;
    assert.equal(isCancelled(), false);
    interacted.controller.noteInterrupt('scroll');
    assert.equal(isCancelled(), true, 'the reveal stops at its next frame, without waiting for the next tick');
    interacted.tick();
    assert.equal(isCancelled(), true, 'and stays cancelled after the tick consumed the interaction');

    const locked = drive();
    assert.equal(locked.revealLog[0].options.isCancelled(), false);
    globalThis.window = { __JEP_AUTH_REQUIRED__: { locked: true } };
    try { assert.equal(locked.revealLog[0].options.isCancelled(), true, 'a terminal auth lock stops the reveal'); } finally { delete globalThis.window; }
});

test('a dirty Planning review, a terminal auth lock and a vanished group each end the link', () => {
    const review = createRig({ link: LINK, options: { planningReviewBusy: true } });
    review.tick();
    assert.deepEqual(review.store.log, [['finish', 'cancelled', []]]);

    const locked = createRig({ link: LINK });
    globalThis.window = { __JEP_AUTH_REQUIRED__: { locked: true } };
    try { locked.tick(); } finally { delete globalThis.window; }
    assert.deepEqual(locked.store.log, [['finish', 'dropped', []]]);

    const vanished = createRig({ link: LINK });
    vanished.tick();
    commitScope(vanished);
    vanished.o.visibleControlGroups = [{ id: 'grp-a', teamIds: ['t1'] }];
    vanished.tick();
    assert.deepEqual(vanished.store.log.at(-1), ['finish', 'partial', ['group']], 'the re-check before Stage B stops a link whose group disappeared');
    assert.deepEqual(vanished.log.filter(([name]) => name === 'setShowPlanning'), [], 'Stage B wrote nothing');
});

test('a throwing writer ends the link and keeps the dashboard alive', () => {
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        const early = createRig({ link: LINK, options: { setSelectedView: () => { throw new Error('writer failed'); } } });
        early.tick();
        assert.deepEqual(early.store.log.at(-1), ['finish', 'partial', ['group', 'sprint', 'mode', 'filters', 'teams']], 'the scope write failed, everything it owed is named');
        early.tick();
        assert.equal(early.store.log.filter(([name]) => name === 'finish').length, 1, 'the failed link stays finished');

        const late = createRig({ link: LINK });
        late.tick();
        commitScope(late);
        late.o.setShowPlanning = () => { throw new Error('writer failed'); };
        late.tick();
        assert.deepEqual(late.store.log.at(-1), ['finish', 'partial', ['mode', 'filters', 'teams']], 'the failing Stage B and the stages after it are named');

        const unresolved = createRig({ link: LINK, options: { sprintCatalogState: { get availableSprints() { throw new Error('catalog failed'); }, authority: 'validated', status: 'ready', validatedSnapshot: {} } } });
        unresolved.tick();
        assert.deepEqual(unresolved.store.log.at(-1), ['finish', 'dropped', []], 'a fault before Stage A leaves the view as it was and names nothing');
        assert.equal(errors.length, 3);
    } finally {
        console.error = originalError;
    }
});

test('Board scope is applied only when ready, and a Board link has no Teams or facets stage', () => {
    const ready = createRig({ link: { version: 1, mode: 'board', group: 'grp-a', sprint: '41', scope: 'component', find: 'x' } });
    ready.tick();
    ready.take();
    ready.tick();
    const writes = ready.take();
    assert.deepEqual(writes.filter(([name]) => name === 'setShowBoard' || name === 'setBoardStrictScope'), [['setShowBoard', true], ['setBoardStrictScope', 'component']]);
    ready.tick();
    ready.tick();
    assert.deepEqual(ready.store.log.at(-1), ['finish', 'done', []]);

    const pending = createRig({ link: { version: 1, mode: 'board', group: 'grp-a', sprint: '41', scope: 'all_work' }, options: { engSprintSelectorState: { componentReadiness: 'catalog_pending', allWorkReadiness: 'catalog_pending' } } });
    pending.tick();
    pending.tick(1000);
    assert.equal(pending.log.some(([name]) => name === 'setShowBoard'), false, 'Stage B waits for the readiness');
    pending.o.engSprintSelectorState = { componentReadiness: 'ready', allWorkReadiness: 'components_required' };
    pending.tick(100);
    assert.deepEqual(pending.log.filter(([name]) => name === 'setBoardStrictScope'), [], 'an unavailable scope is skipped');
    for (let step = 0; step < 4; step += 1) pending.tick(100);
    assert.deepEqual(pending.store.log.at(-1), ['finish', 'partial', ['mode']]);
});

test('Statistics writes its view and range, and a source-only view skips Stage C silently', () => {
    const cohort = createRig({ link: { version: 1, mode: 'statistics', group: 'grp-a', sprint: '41', stats: 'cohort', from: THIS_QUARTER, to: THIS_QUARTER, teams: ['t1'] } });
    cohort.tick();
    cohort.take();
    cohort.tick();
    assert.deepEqual(cohort.take().filter(([name]) => /^set(Stats|Cohort|Excluded)/.test(name)), [
        ['setStatsView', 'cohort'], ['setCohortStartQuarter', THIS_QUARTER], ['setCohortEndQuarter', THIS_QUARTER],
    ]);

    const sourceOnly = createRig({ link: { version: 1, mode: 'statistics', group: 'grp-b', sprint: '41', stats: 'projectTrack', from: '40', to: '41' }, options: { engLoadsTasks: false } });
    sourceOnly.tick();
    assert.deepEqual(sourceOnly.take().pop(), ['commitSprintSelection', { id: 41, name: 'Sprint 41', state: 'active' }, { groupId: 'grp-b', teams: undefined, projectTrackRange: true }]);
    commitScope(sourceOnly, { group: 'grp-b', sprint: 41 });
    sourceOnly.tick();
    assert.deepEqual(sourceOnly.take().filter(([name]) => /^setExcluded/.test(name)), [['setExcludedCapacityStartSprintId', '40'], ['setExcludedCapacityEndSprintId', '41']]);
    sourceOnly.tick();
    sourceOnly.tick();
    sourceOnly.tick();
    assert.deepEqual(sourceOnly.take(), [], 'no Teams or facets where no task list loads');
    assert.deepEqual(sourceOnly.store.log.at(-1), ['finish', 'done', []]);
});

test('a Sprint range is ordered by the catalog start dates, not by the Sprint names', () => {
    const sprints = [
        { id: 61, name: 'Sprint 9', state: 'closed', startDate: '2026-01-05' },
        { id: 62, name: 'Sprint 10', state: 'closed', startDate: '2026-02-02' },
        { id: 63, name: 'Sprint 11', state: 'active', startDate: '2026-03-02' },
    ];
    const rig = createRig({
        link: { version: 1, mode: 'statistics', group: 'grp-a', sprint: '63', stats: 'excludedCapacity', from: '61', to: '62' },
        options: { selectedSprint: 63, sprintCatalogState: { authority: 'validated', status: 'ready', validatedSnapshot: {}, availableSprints: sprints }, engLoadsTasks: false },
    });
    rig.tick();
    rig.take();
    rig.tick();
    assert.deepEqual(rig.take().filter(([name]) => /^setExcluded/.test(name)), [['setExcludedCapacityStartSprintId', '61'], ['setExcludedCapacityEndSprintId', '62']]);
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []], 'alphabetical order would have made the range invalid and reported the mode');
});

test('an invalid or newer link that never became pending reports one rejected apply event on the recipient surface', () => {
    for (const [search, activeEngMode, sourceSurface] of [['?v=2&mode=board', 'planning', 'planning'], ['?v=01&mode=board', 'catch-up', 'catch_up'], ['?v=2', 'scenario', 'catch_up']]) {
        const rig = createRig({ search, options: { activeEngMode } });
        assert.equal(rig.store.snapshot().entry, null);
        rig.tick();
        rig.flush(true);
        rig.tick();
        rig.flush(true);
        assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'rejected', sourceSurface }], search);
    }
    const absent = createRig({});
    absent.tick();
    absent.flush(true);
    assert.deepEqual(absent.tracked, [], 'no link, no event');
});

test('an apply that the store already ended reports no apply event', () => {
    const rig = createRig({ link: LINK });
    Object.defineProperty(rig.o, 'planningReviewBusy', { get() { rig.store.module.finishShareView('dropped', ['sprint']); return true; }, configurable: true });
    rig.tick();
    rig.flush(true);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', ['sprint']]], 'the first ending stands');
    assert.deepEqual(rig.tracked, [], 'only the call that ended the apply reports it');
});

test('the facet option ids are read from the facet model', () => {
    const rig = createRig({ link: LINK });
    assert.deepEqual(rig.readFacetOptionIds(rig.o.engCatchUpFacetModel), {
        status: ['In Progress', 'To Do', 'Done'], priority: ['Blocker', 'Major'], track: ['Committed', 'Flexible'],
    });
    assert.deepEqual(rig.readFacetOptionIds(undefined), { status: [], priority: [], track: [] });
});
```

Create `tests/test_share_view_capture_state.js` (the builder against the real codec: a capture is judged by the link a recipient would decode from it):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const SHARE_VIEW = path.join(__dirname, '..', 'frontend', 'src', 'shareView');

// The builder runs against the real view defaults and codec: a capture is judged by the link a recipient would decode from it.
function loadModules() {
    const source = esbuild.buildSync({
        stdin: {
            contents: "export * from './captureState.js'; export { encodeShareView, decodeShareView } from './codec.js'; export { SHARE_VIEW_ALERT_KEYS } from './viewDefaults.js';",
            resolveDir: SHARE_VIEW, sourcefile: 'capture-state-test-entry.js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', source)(loaded, loaded.exports);
    return loaded.exports;
}

const { buildShareViewState, encodeShareView, decodeShareView, SHARE_VIEW_ALERT_KEYS } = loadModules();

const noFlags = Object.fromEntries(SHARE_VIEW_ALERT_KEYS.map(key => [key, [true, () => {}]]));

function input(overrides = {}) {
    return {
        mode: 'catch-up', groupId: 'grp-a', sprintId: 4182,
        snapshot: {
            selectedTeams: ['all'], engStatusFilter: { hidden: ['Killed'] }, engPriorityFilter: null, engProjectTrackFilter: undefined,
            showProduct: true, showTech: true, groupByInitiativeChoice: null, statsView: 'teams',
            cohortStartQuarter: '2026Q3', cohortEndQuarter: '2026Q4', showAlertsPanel: true,
        },
        searchQuery: '', sort: 'priority', layout: 'table', rowsMode: null, boardStrictScope: '',
        sprintRange: { start: '', end: '' }, alertFlags: noFlags, alertCounts: {}, focus: null,
        ...overrides,
    };
}

// The link a recipient decodes from this capture: the encoder drops defaults and keys that do not apply to the mode.
function received(overrides) {
    const encoded = encodeShareView(buildShareViewState(input(overrides)));
    assert.equal(encoded.ok, true);
    const decoded = decodeShareView(`?${encoded.query}`);
    assert.equal(decoded.kind, 'ok');
    assert.deepEqual(decoded.reported, []);
    return { state: decoded.state, query: encoded.query };
}

test('a Catch Up capture carries the raw committed state and nothing outside the mode', () => {
    const { state, query } = received({
        searchQuery: 'login', focus: { kind: 'story', key: 'PROJ-7' }, rowsMode: 'story', boardStrictScope: 'component',
        snapshot: { ...input().snapshot, selectedTeams: ['t1', 't2'], engPriorityFilter: { only: ['Major'] }, engProjectTrackFilter: [], groupByInitiativeChoice: false },
    });
    assert.deepEqual(state, {
        version: 1, mode: 'catch-up', group: 'grp-a', sprint: '4182',
        teams: ['t1', 't2'], find: 'login', priority: { only: ['Major'] }, track: [], initiatives: false, focus: { kind: 'story', key: 'PROJ-7' },
    });
    assert.doesNotMatch(query, /(?:^|&)(?:rows|scope)=/, 'Planning rows and the Board scope are not Catch Up keys');
});

test('Teams are all only when the sender selection contains all, and an explicit full list stays explicit', () => {
    assert.deepEqual(buildShareViewState(input()).teams, ['all']);
    assert.deepEqual(buildShareViewState(input({ snapshot: { ...input().snapshot, selectedTeams: ['t1', 'all'] } })).teams, ['all']);
    const everyTeam = received({ snapshot: { ...input().snapshot, selectedTeams: ['t1', 't2', 't3'] } });
    assert.deepEqual(everyTeam.state.teams, ['t1', 't2', 't3']);
});

test('a null status filter is carried as neutral, and an undefined Project Track filter is left out', () => {
    const { state } = received({ snapshot: { ...input().snapshot, engStatusFilter: null } });
    assert.equal(Object.hasOwn(state, 'status'), true);
    assert.equal(state.status, null);
    assert.equal(Object.hasOwn(state, 'track'), false);
});

test('an alert focus is captured as an alertTeam and a Planning capture keeps its rows mode', () => {
    const alertState = buildShareViewState(input({ focus: { kind: 'alertTeam', anchor: 'blocked', id: 't1' } }));
    assert.deepEqual(alertState.alertTeam, { anchor: 'blocked', id: 't1' });
    assert.equal(Object.hasOwn(alertState, 'focus'), false);
    const planning = received({ mode: 'planning', rowsMode: 'story', focus: { kind: 'epic', key: 'PROJ-1' } });
    assert.deepEqual(planning.state, { version: 1, mode: 'planning', group: 'grp-a', sprint: '4182', rows: 'story', focus: { kind: 'epic', key: 'PROJ-1' } });
});

test('alerts lists only the categories that rendered and are expanded, none when all rendered ones are collapsed, off when the panel is hidden', () => {
    const flags = { ...noFlags, blocked: [false, () => {}], done: [false, () => {}] };
    const counts = { missing: 2, blocked: 1, done: 3 };
    assert.deepEqual(buildShareViewState(input({ alertFlags: flags, alertCounts: counts })).alerts, ['missing']);
    const collapsed = Object.fromEntries(Object.keys(noFlags).map(key => [key, [false, () => {}]]));
    assert.equal(buildShareViewState(input({ alertFlags: collapsed, alertCounts: counts })).alerts, 'none');
    assert.equal(buildShareViewState(input({ alertCounts: counts, snapshot: { ...input().snapshot, showAlertsPanel: false } })).alerts, 'off');
    assert.equal(Object.hasOwn(buildShareViewState(input()), 'alerts'), false, 'no alert rendered, nothing to carry');
});

test('a Board capture carries only the strict scope and the search text', () => {
    const { state } = received({ mode: 'board', boardStrictScope: 'all_work', searchQuery: 'epic one', snapshot: { ...input().snapshot, selectedTeams: ['t1'] } });
    assert.deepEqual(state, { version: 1, mode: 'board', group: 'grp-a', sprint: '4182', scope: 'all_work', find: 'epic one' });
    assert.equal(Object.hasOwn(received({ mode: 'board' }).state, 'scope'), false);
});

test('a Statistics capture carries the view, its range and Teams', () => {
    const cohort = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'cohort', selectedTeams: ['t1'] } });
    assert.deepEqual(cohort.state, { version: 1, mode: 'statistics', group: 'grp-a', sprint: '4182', teams: ['t1'], stats: 'cohort', from: '2026Q3', to: '2026Q4' });
    const sprintRange = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'projectTrack' }, sprintRange: { start: 4180, end: '4182' } });
    assert.equal(sprintRange.state.from, '4180');
    assert.equal(sprintRange.state.to, '4182');
    const noRange = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'burnout' } });
    assert.equal(Object.hasOwn(noRange.state, 'from'), false);
    const unsetRange = received({ mode: 'statistics', snapshot: { ...input().snapshot, statsView: 'monoCrossShare' } });
    assert.equal(Object.hasOwn(unsetRange.state, 'to'), false);
});
```

Create `tests/test_share_view_interaction_guard.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const MODULE_PATH = path.join(__dirname, '..', 'frontend', 'src', 'shareView', 'interactionGuard.js');

function loadModule() {
    const source = esbuild.buildSync({
        entryPoints: [MODULE_PATH], bundle: true, write: false, format: 'cjs', platform: 'browser',
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', source)(module, module.exports);
    return module.exports;
}

const { armInteractionGuard, SHARE_VIEW_MODIFIER_KEYS } = loadModule();

function fakeDocument() {
    const listeners = [];
    return {
        listeners,
        addEventListener: (type, handler, options) => listeners.push({ type, handler, options }),
        removeEventListener: (type, handler, options) => {
            const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler && entry.options.capture === options.capture);
            if (index >= 0) listeners.splice(index, 1);
        },
        dispatch(event) { listeners.filter(entry => entry.type === event.type).forEach(entry => entry.handler(event)); },
    };
}

test('the guard listens on the document in the capture phase for the five interaction events and removes them again', () => {
    const doc = fakeDocument();
    const disarm = armInteractionGuard({ doc, onInteraction: () => {} });
    assert.deepEqual(doc.listeners.map(entry => entry.type).sort(), ['keydown', 'pointerdown', 'touchmove', 'touchstart', 'wheel']);
    assert.ok(doc.listeners.every(entry => entry.options.capture === true && entry.options.passive === true));
    disarm();
    assert.deepEqual(doc.listeners, []);
});

test('pointer, touch and non-modifier key presses are deliberate and scrolling is only a scroll', () => {
    const doc = fakeDocument();
    const seen = [];
    armInteractionGuard({ doc, onInteraction: kind => seen.push(kind) });
    doc.dispatch({ type: 'pointerdown' });
    doc.dispatch({ type: 'touchstart' });
    doc.dispatch({ type: 'keydown', key: 'a' });
    doc.dispatch({ type: 'keydown', key: 'Escape' });
    doc.dispatch({ type: 'wheel' });
    doc.dispatch({ type: 'touchmove' });
    assert.deepEqual(seen, ['deliberate', 'deliberate', 'deliberate', 'deliberate', 'scroll', 'scroll']);
});

test('the modifier and lock keys are one pinned list of eleven', () => {
    assert.deepEqual([...SHARE_VIEW_MODIFIER_KEYS], ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS']);
});

test('modifier keys, untrusted events and a paused link are ignored', () => {
    const doc = fakeDocument();
    const seen = [];
    let paused = false;
    armInteractionGuard({ doc, onInteraction: kind => seen.push(kind), isPaused: () => paused });
    for (const key of SHARE_VIEW_MODIFIER_KEYS) doc.dispatch({ type: 'keydown', key });
    doc.dispatch({ type: 'pointerdown', isTrusted: false });
    paused = true;
    doc.dispatch({ type: 'pointerdown' });
    doc.dispatch({ type: 'wheel' });
    assert.deepEqual(seen, []);
    paused = false;
    doc.dispatch({ type: 'pointerdown', isTrusted: true });
    assert.deepEqual(seen, ['deliberate']);
});

test('the terminal auth latch is read first, so a locked app never reacts', () => {
    const doc = fakeDocument();
    const seen = [];
    armInteractionGuard({ doc, onInteraction: kind => seen.push(kind) });
    globalThis.window = { __JEP_AUTH_REQUIRED__: { locked: true } };
    try {
        doc.dispatch({ type: 'pointerdown' });
        doc.dispatch({ type: 'keydown', key: 'a' });
        assert.deepEqual(seen, []);
    } finally {
        delete globalThis.window;
    }
    doc.dispatch({ type: 'pointerdown' });
    assert.deepEqual(seen, ['deliberate']);
});
```

Create `tests/test_share_view_apply_hook.js` (the real hook bundled with doubles for the store, the controller and the focus capture; the real codec and view defaults):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

const ENTRY = path.join(__dirname, '..', 'frontend', 'src', 'shareView', 'useShareViewApply.js');
const PHASES = { ABSENT: 'absent', PENDING: 'pending', RUNNING: 'running', DONE: 'done', PARTIAL: 'partial', DROPPED: 'dropped', CANCELLED: 'cancelled' };
const ALERT_KEYS = ['missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done'];

// The store, the controller and the focus capture have their own tests; the hook only wires them, so they are doubles that
// record calls and keep their binding shapes. The codec and the view defaults are the real modules.
function createDoubles() {
    const calls = [];
    const doubles = { calls, snapshot: { phase: PHASES.PENDING, stage: null, entry: { state: {}, reported: [] }, hold: true, terminal: false, notice: null }, focus: null, rowsMode: null };
    const store = {
        SHARE_VIEW_PHASES: PHASES,
        getShareViewSnapshot: () => doubles.snapshot,
        subscribeShareView: () => () => {},
        dismissShareViewNotice: () => calls.push(['dismissNotice']),
    };
    const controller = {
        noteCommit: () => calls.push(['noteCommit']),
        evaluate: () => calls.push(['evaluate']),
        flushTrack: (track, ready) => calls.push(['flushTrack', track, ready]),
        noteInterrupt: kind => calls.push(['noteInterrupt', kind]),
        isPaused: () => doubles.paused === true,
    };
    return {
        doubles,
        modules: {
            './store.js': store,
            './applyController.js': { createApplyController: (config) => { calls.push(['createController', typeof config.readOptions]); doubles.config = config; return controller; } },
            './focusCapture.js': {
                captureShareViewFocus: (args) => { calls.push(['captureFocus', args]); return doubles.focus; },
                readPlanningRowsMode: (root) => { calls.push(['readRowsMode', root]); return doubles.rowsMode; },
            },
        },
    };
}

function makeOptions(overrides = {}) {
    return {
        selectedSprint: 41, groupsLoading: false, onboardingRequired: false, adminSettingsGate: { status: 'clear' }, engLoadsTasks: true,
        teamSelectionScopeKey: 'team-selection::41::grp-a', teamSelectionHydratedScopeRef: { current: 'team-selection::41::grp-a' },
        sprintCatalogState: { authority: 'validated' }, selectedView: 'eng', activeEngMode: 'catch-up', activeGroupId: 'grp-a',
        buildGroupStateSnapshot: () => ({
            selectedTeams: ['all'], engStatusFilter: { hidden: ['Killed'] }, engPriorityFilter: null, engProjectTrackFilter: undefined,
            showProduct: true, showTech: true, groupByInitiativeChoice: null, statsView: 'teams', cohortStartQuarter: '2026Q3', cohortEndQuarter: '2026Q3', showAlertsPanel: true,
        }),
        searchQuery: 'login', engEpicSort: 'priority', planningLayout: 'table', boardStrictScope: '',
        excludedCapacityStartSprintId: '', excludedCapacityEndSprintId: '', alertCounts: {},
        alertFlags: Object.fromEntries(ALERT_KEYS.map(key => [key, [true, () => {}]])),
        trackShareViewAction: () => {}, analyticsReady: false,
        ...overrides,
    };
}

function withBrowser(fn) {
    const timers = [];
    const originals = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
    const listeners = [];
    globalThis.setInterval = (callback, delay) => { timers.push({ callback, delay, cleared: false }); return timers.length - 1; };
    globalThis.clearInterval = id => { timers[id].cleared = true; };
    globalThis.document = {
        visibilityState: 'visible', querySelector: () => null,
        addEventListener: (type, handler, options) => listeners.push({ type, handler, options }),
        removeEventListener: (type, handler) => { const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler); if (index >= 0) listeners.splice(index, 1); },
    };
    globalThis.window = { location: { origin: 'https://planner.example' } };
    try { return fn({ timers, listeners }); } finally {
        Object.assign(globalThis, originals);
        delete globalThis.document;
        delete globalThis.window;
    }
}

// The real authRequired, interactionGuard, captureState, codec and viewDefaults modules are bundled; only the doubles' specifiers are external.
function mountHook(doubles, options) {
    return mountBundledHook({ entry: ENTRY, exportName: 'useShareViewApply', modules: doubles.modules, makeProps: () => options });
}

function mountEarly(exportName, modules) {
    return mountBundledHook({ entry: ENTRY, exportName, modules, makeProps: () => ({}) });
}

test('the early hooks read the hold, the terminal state and the Planning table key from the store snapshot', () => {
    const { doubles, modules } = createDoubles();
    const hold = mountEarly('useShareViewHold', modules);
    assert.equal(hold.render(), true);
    doubles.snapshot = { ...doubles.snapshot, hold: false };
    assert.equal(hold.render(), false);

    const terminal = mountEarly('useShareViewApplyTerminal', modules);
    assert.equal(terminal.render(), false, 'a pending link is not terminal');
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.DONE, terminal: true };
    assert.equal(terminal.render(), true);
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.ABSENT, terminal: false };
    assert.equal(terminal.render(), true, 'no link at all counts as settled');

    const key = mountEarly('useShareViewPlanningTableKey', modules);
    for (const stage of [null, 'A', 'B']) {
        doubles.snapshot = { ...doubles.snapshot, phase: PHASES.RUNNING, terminal: false, stage };
        assert.equal(key.render(), 0, `before Stage C (${stage})`);
    }
    for (const stage of ['C', 'D']) {
        doubles.snapshot = { ...doubles.snapshot, stage };
        assert.equal(key.render(), 1, `from Stage C on (${stage})`);
    }
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.DONE, terminal: true };
    assert.equal(key.render(), 1, 'the key stays once the link ended, so the table is not remounted a second time');
});

test('every commit refreshes the options, counts the commit, steps the apply and flushes analytics', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    const options = makeOptions({ analyticsReady: true });
    const hook = mountHook({ modules }, options);
    hook.render();
    assert.deepEqual(doubles.calls.slice(0, 4).map(call => call[0]), ['createController', 'noteCommit', 'evaluate', 'flushTrack']);
    assert.equal(doubles.calls[3][1], options.trackShareViewAction);
    assert.equal(doubles.calls[3][2], true);
    assert.equal(doubles.config.readOptions().searchQuery, 'login', 'the controller reads the latest committed options');
    const next = makeOptions({ searchQuery: 'next' });
    hook.render(next);
    assert.equal(doubles.config.readOptions().searchQuery, 'next');
    assert.equal(doubles.calls.filter(call => call[0] === 'createController').length, 1, 'one controller for the App lifetime');
    assert.equal(doubles.calls.filter(call => call[0] === 'noteCommit').length, 2);
    hook.unmount();
}));

test('a pending link steps on an interval and arms the interaction guard; a settled link does neither', () => withBrowser(({ timers, listeners }) => {
    const { doubles, modules } = createDoubles();
    const hook = mountHook({ modules }, makeOptions());
    hook.render();
    assert.deepEqual(timers.map(timer => timer.delay), [50]);
    assert.deepEqual(listeners.map(entry => entry.type).sort(), ['keydown', 'pointerdown', 'touchmove', 'touchstart', 'wheel']);
    const before = doubles.calls.length;
    timers[0].callback();
    assert.deepEqual(doubles.calls.slice(before), [['evaluate']]);
    const keydown = listeners.find(entry => entry.type === 'keydown');
    keydown.handler({ type: 'keydown', key: 'a' });
    assert.deepEqual(doubles.calls.slice(before + 1), [['noteInterrupt', 'deliberate'], ['evaluate']]);
    doubles.paused = true;
    keydown.handler({ type: 'keydown', key: 'b' });
    assert.equal(doubles.calls.filter(call => call[0] === 'noteInterrupt').length, 1, 'a paused link ignores interactions');
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.DONE, terminal: true };
    hook.render();
    assert.equal(timers[0].cleared, true);
    assert.deepEqual(listeners, []);
    hook.unmount();
}));

test('the Share control is disabled until the scope is settled, whatever the blocker', () => withBrowser(() => {
    const blockers = [
        { selectedSprint: null }, { groupsLoading: true }, { onboardingRequired: true }, { adminSettingsGate: { status: 'missing' } },
        { teamSelectionScopeKey: '' }, { teamSelectionHydratedScopeRef: { current: 'another-scope' } },
        { sprintCatalogState: { authority: 'display_only' } }, { selectedView: 'epm' }, { activeEngMode: 'scenario' },
    ];
    for (const blocker of blockers) {
        const { doubles, modules } = createDoubles();
        doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
        const hook = mountHook({ modules }, makeOptions(blocker));
        hook.render();
        assert.equal(hook.render().shareDisabled, true, JSON.stringify(blocker));
    }
    // A source-only Statistics view and a strict Board scope load no task list, so no Team hydrate ever runs there and Share does not wait for one.
    for (const [overrides, disabled] of [
        [{ engLoadsTasks: false, teamSelectionHydratedScopeRef: { current: '' } }, false],
        [{ engLoadsTasks: false, teamSelectionScopeKey: '', teamSelectionHydratedScopeRef: { current: '' } }, true],
        [{ engLoadsTasks: true, teamSelectionHydratedScopeRef: { current: '' } }, true],
    ]) {
        const { doubles: scoped, modules: scopedModules } = createDoubles();
        scoped.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
        const scopedHook = mountHook({ modules: scopedModules }, makeOptions(overrides));
        scopedHook.render();
        assert.equal(scopedHook.render().shareDisabled, disabled, JSON.stringify(overrides));
    }
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    const hook = mountHook({ modules }, makeOptions());
    assert.equal(hook.render().shareDisabled, true, 'the first render is disabled until a commit settled it');
    assert.equal(hook.render().shareDisabled, false);
    doubles.snapshot = { phase: PHASES.PENDING, stage: null, entry: { state: {}, reported: [] }, hold: true, terminal: false, notice: null };
    hook.render();
    assert.equal(hook.render().shareDisabled, true, 'a link that is still applying blocks sharing');
}));

test('the hook returns the binding shape with the store notice and dismiss action', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.PARTIAL, stage: null, entry: null, hold: false, terminal: true, notice: { kind: 'partial', categories: ['teams'] } };
    const hook = mountHook({ modules }, makeOptions());
    const result = hook.render();
    assert.deepEqual(Object.keys(result).sort(), ['applyTerminal', 'captureShareUrl', 'dismissNotice', 'notice', 'shareDisabled']);
    assert.deepEqual(result.notice, { kind: 'partial', categories: ['teams'] });
    assert.equal(result.applyTerminal, true);
    result.dismissNotice();
    assert.deepEqual(doubles.calls.at(-1), ['dismissNotice']);
}));

test('captureShareUrl builds the state from committed values, encodes it and returns an absolute plain URL synchronously', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    doubles.focus = { kind: 'epic', key: 'PROJ-1' };
    const hook = mountHook({ modules }, makeOptions());
    hook.render();
    const { captureShareUrl } = hook.render();
    const result = captureShareUrl();
    assert.equal(typeof result.then, 'undefined', 'the click handler copies inside the user gesture, so the result is not a promise');
    assert.deepEqual(result, { ok: true, url: 'https://planner.example/?v=1&mode=catch-up&group=grp-a&sprint=41&find=login&epic=PROJ-1', dropped: [] });
    const focusArgs = doubles.calls.find(call => call[0] === 'captureFocus')[1];
    assert.equal(focusArgs.mode, 'catch-up');
    assert.equal(focusArgs.rowsMode, null);
    assert.equal(focusArgs.root, globalThis.document);
    assert.equal(focusArgs.win, globalThis.window);
    assert.equal(doubles.calls.find(call => call[0] === 'readRowsMode')[1], globalThis.document, 'the rows mode is read from the rendered table');

    doubles.rowsMode = 'story';
    doubles.focus = null;
    const planning = mountHook({ modules }, makeOptions({ activeEngMode: 'planning' }));
    planning.render();
    const { url } = planning.render().captureShareUrl();
    assert.equal(url, 'https://planner.example/?v=1&mode=planning&group=grp-a&sprint=41&rows=stories&find=login');
}));

test('captureShareUrl refuses while disabled and passes an encoder failure through without a URL', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    const blocked = mountHook({ modules }, makeOptions({ groupsLoading: true }));
    blocked.render();
    assert.deepEqual(blocked.render().captureShareUrl(), { ok: false, reason: 'disabled' });
    assert.equal(doubles.calls.some(call => call[0] === 'captureFocus'), false, 'nothing is captured while disabled');

    const invalid = mountHook({ modules }, makeOptions({ activeGroupId: 'g'.repeat(300) }));
    invalid.render();
    assert.deepEqual(invalid.render().captureShareUrl(), { ok: false, reason: 'invalid_state' });

    const teams = Array.from({ length: 12 }, (_, index) => `${String(index).padStart(2, '0')}${'x'.repeat(128)}`);
    const longSnapshot = { ...makeOptions().buildGroupStateSnapshot(), selectedTeams: teams };
    const tooLong = mountHook({ modules }, makeOptions({ buildGroupStateSnapshot: () => longSnapshot }));
    tooLong.render();
    assert.deepEqual(tooLong.render().captureShareUrl(), { ok: false, reason: 'too_long' });
}));
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `fnm exec --using 20 node --test tests/test_share_view_apply_controller.js tests/test_share_view_capture_state.js tests/test_share_view_interaction_guard.js tests/test_share_view_apply_hook.js`

Expected: exit status 1. The controller, capture and guard files fail while they bundle, with an esbuild `Could not resolve` error for the missing module, and every test of the hook file fails with the same error for `useShareViewApply.js`.

- [ ] **Step 3: Implement the four modules**

Create `frontend/src/shareView/interactionGuard.js`:

```js
import { readPendingAuthenticationRequired } from '../api/authRequired.js';

// A deliberate interaction cancels a pending link; scrolling cancels only a running reveal. The
// listeners are document capture-phase listeners rather than window keydown handlers, whose count
// tests/test_auth_isolation_source_guard.js pins over a fixed owner list that excludes shareView/.
const DELIBERATE_EVENTS = ['pointerdown', 'touchstart', 'keydown'];
const SCROLL_EVENTS = ['wheel', 'touchmove'];
// Modifier and lock keys: pressing one is not an interaction.
export const SHARE_VIEW_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS']);

export function armInteractionGuard({ doc = document, onInteraction, isPaused = () => false }) {
    const handle = (event) => {
        if (readPendingAuthenticationRequired()) return;
        if (isPaused() || event.isTrusted === false) return;
        if (event.type === 'keydown' && SHARE_VIEW_MODIFIER_KEYS.has(event.key)) return;
        onInteraction(DELIBERATE_EVENTS.includes(event.type) ? 'deliberate' : 'scroll');
    };
    const types = [...DELIBERATE_EVENTS, ...SCROLL_EVENTS];
    types.forEach(type => doc.addEventListener(type, handle, { capture: true, passive: true }));
    return () => types.forEach(type => doc.removeEventListener(type, handle, { capture: true }));
}
```

Create `frontend/src/shareView/captureState.js`:

```js
import { SHARE_VIEW_ALERT_KEYS, SHARE_VIEW_VERSION } from './viewDefaults.js';

// The Statistics views that carry a range: a quarter pair (Lead Times) or a Sprint pair (the three source-only views).
export const STATS_RANGE_KIND = Object.freeze({ cohort: 'quarter', excludedCapacity: 'sprint', monoCrossShare: 'sprint', projectTrack: 'sprint' });

// Builds the ShareViewState for the Share control from committed state only: the committed search text
// (not the input), the raw facet state (not the derived selection) and Teams exactly as stored. The
// encoder drops keys equal to their defaults and keys that do not apply to the mode, layout or Statistics view.
export function buildShareViewState({ mode, groupId, sprintId, snapshot, searchQuery, sort, layout, rowsMode, boardStrictScope, sprintRange, alertFlags, alertCounts, focus }) {
    const rendered = SHARE_VIEW_ALERT_KEYS.filter(key => Number(alertCounts?.[key] || 0) > 0);
    const expanded = rendered.filter(key => alertFlags[key][0]);
    const statsView = snapshot.statsView;
    const rangeKind = Object.hasOwn(STATS_RANGE_KIND, statsView) ? STATS_RANGE_KIND[statsView] : null;
    const range = rangeKind === 'quarter' ? { from: snapshot.cohortStartQuarter, to: snapshot.cohortEndQuarter }
        : rangeKind === 'sprint' && sprintRange.start && sprintRange.end ? { from: String(sprintRange.start), to: String(sprintRange.end) }
            : {};
    const candidate = {
        version: SHARE_VIEW_VERSION, mode, group: String(groupId), sprint: String(sprintId),
        scope: boardStrictScope || undefined,
        teams: snapshot.selectedTeams.includes('all') ? ['all'] : [...snapshot.selectedTeams],
        find: searchQuery,
        status: snapshot.engStatusFilter, priority: snapshot.engPriorityFilter,
        track: Array.isArray(snapshot.engProjectTrackFilter) ? [...snapshot.engProjectTrackFilter] : undefined,
        lanes: { product: snapshot.showProduct, tech: snapshot.showTech },
        initiatives: typeof snapshot.groupByInitiativeChoice === 'boolean' ? snapshot.groupByInitiativeChoice : undefined,
        sort, layout, rows: rowsMode || undefined,
        stats: statsView, ...range,
        alerts: rendered.length ? (snapshot.showAlertsPanel ? (expanded.length ? expanded : 'none') : 'off') : undefined,
        alertTeam: focus?.kind === 'alertTeam' ? { anchor: focus.anchor, id: focus.id } : undefined,
        focus: focus && focus.kind !== 'alertTeam' ? { kind: focus.kind, key: focus.key } : undefined,
    };
    return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
}
```

Create `frontend/src/shareView/applyController.js`:

```js
import {
    SHARE_VIEW_PHASES, beginShareViewStage, finishShareView, getShareViewSnapshot,
    markShareViewScopeCommitted, setPendingPlanningRowMode,
} from './store.js';
import { SHARE_VIEW_ALERT_KEYS, SHARE_VIEW_KEYS_BY_MODE } from './viewDefaults.js';
import {
    buildShareViewFieldPlan, resolveShareViewFacets, resolveShareViewFocus, resolveShareViewScope, resolveShareViewTeams,
} from './resolver.js';
import { revealShareViewFocus } from './focusReveal.js';
import { createApplyMachine, stepApplyMachine } from './applyMachine.js';
import { STATS_RANGE_KIND } from './captureState.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';
import { selectedTeamSelectionsEqual } from '../teamSelectionUtils.mjs';

// Drives one shareable-link apply. Each tick reads the committed App state through `readOptions()`, steps the
// pure machine and executes its actions with raw setters and refs only: never applyEngMode, the filter-reset
// helpers or the alert navigation helpers, whose analytics, resets and Jira fallbacks a link must not trigger.

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const has = (object, key) => Object.hasOwn(object, key);
const unique = values => [...new Set(values)];
const SURFACE_BY_MODE = new Map([['catch-up', 'catch_up'], ['planning', 'planning'], ['board', 'board'], ['statistics', 'statistics']]);
// The apply event's surface: the link's resolved mode, else the recipient's current ENG mode, else Catch Up.
const surfaceFor = (mode, currentMode) => SURFACE_BY_MODE.get(mode) ?? SURFACE_BY_MODE.get(currentMode) ?? 'catch_up';
const ANALYTICS_RESULT = Object.freeze({ done: 'success', partial: 'partial', dropped: 'rejected', cancelled: 'rejected' });
const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
// What an action that did not finish leaves unapplied.
const STEP_CATEGORIES = Object.freeze({ A: ['group', 'sprint'], B: ['mode', 'filters'], Cteams: ['teams'], Cfacets: ['filters'], D: ['focus'] });

export function readFacetOptionIds(model) {
    const ids = facetId => ((model?.facets || []).find(facet => facet.id === facetId)?.options || []).map(option => option.id);
    return { status: ids('status'), priority: ids('priority'), track: ids('track') };
}

// The resolver reads each Sprint's start date to order a Statistics range, so the catalog entries go in as they are.
const resolverContext = o => ({
    visibleGroups: o.visibleControlGroups || [],
    sprints: o.sprintCatalogState.availableSprints || [],
});

// Re-run before every stage, so a settings save or a refresh that removed the group or Sprint mid-apply stops the link.
export function resolveApplyPlan(o, state) {
    const scope = resolveShareViewScope(state, resolverContext(o));
    if (!scope.ok) return { ok: false, categories: scope.reported };
    // The resolved mode, not the link's: a Planning or Statistics link that fell back to Catch Up is applied as Catch Up.
    const teams = resolveShareViewTeams(state, scope.group, scope.mode);
    return {
        ok: true, scope, teams, reported: [...scope.reported, ...teams.reported],
        plan: { c: { teams: teams.teams !== null, facets: SHARE_VIEW_KEYS_BY_MODE[scope.mode].includes('status') }, d: resolveShareViewFocus(state, scope.mode) !== null },
    };
}

function runStageA(o, state, { scope, teams }, scopeChange) {
    o.setSelectedView('eng');
    o.restoredInitialEpmViewRef.current = true;
    if (!scopeChange) return;
    o.setActiveGroupId(scope.group.id);
    o.commitSprintSelection(scope.sprint, {
        groupId: scope.group.id, teams: teams.teams ?? undefined,
        projectTrackRange: scope.mode === 'statistics' && state.stats === 'projectTrack',
    });
}

function writeRange(o, view, range) {
    const kind = has(STATS_RANGE_KIND, view) ? STATS_RANGE_KIND[view] : null;
    if (kind === 'quarter') {
        o.setCohortStartQuarter(range.from);
        o.setCohortEndQuarter(range.to);
    } else if (kind === 'sprint') {
        o.setExcludedCapacityStartSprintId(String(range.from));
        o.setExcludedCapacityEndSprintId(String(range.to));
    }
}

// Mode booleans first, then every key of the mode: its default or the link's value. Returns what the link leaves unapplied
// and the Planning rows mode to seed once the scope has loaded.
function runStageB(o, state, scope) {
    const boardScopeReady = (_groupId, token) => (token === 'component' ? o.engSprintSelectorState.componentReadiness : o.engSprintSelectorState.allWorkReadiness) === 'ready';
    const { apply, reported } = buildShareViewFieldPlan(state, scope, { ...resolverContext(o), boardScopeReady });
    o.setShowPlanning(scope.mode === 'planning');
    o.setShowStats(scope.mode === 'statistics');
    o.setShowScenario(false);
    o.setShowBoard(scope.mode === 'board');
    if (has(apply, 'find')) { o.setSearchInput(apply.find); o.setSearchQuery(apply.find); }
    if (has(apply, 'lanes')) { o.setShowProduct(apply.lanes.product); o.setShowTech(apply.lanes.tech); }
    if (has(apply, 'initiatives')) o.setGroupByInitiativeChoice(apply.initiatives);
    if (has(apply, 'sort')) o.setEngEpicSort(apply.sort);
    if (has(apply, 'layout')) o.setPlanningLayout(apply.layout);
    if (has(apply, 'stats')) o.setStatsView(apply.stats);
    if (apply.range) writeRange(o, apply.stats, apply.range);
    if (has(apply, 'alerts')) {
        o.setShowAlertsPanel(apply.alerts.panel);
        SHARE_VIEW_ALERT_KEYS.forEach(key => o.alertFlags[key][1](Boolean(apply.alerts.expanded[key])));
    }
    if (has(apply, 'scope')) o.setBoardStrictScope(apply.scope);
    return { reported, rows: has(apply, 'rows') ? apply.rows : null };
}

// A scope-changing link left the Team carry-forward for the hydrate effect to consume; this only corrects what it did not set.
function runStageCTeams(o, fresh) {
    const { teams } = fresh.teams;
    if (teams === null || selectedTeamSelectionsEqual(o.selectedTeams, teams)) return;
    o.persistTeamSelection(teams);
    o.setSelectedTeams(teams);
}

function runStageCFacets(o, state, mode) {
    const { apply, reported } = resolveShareViewFacets(state, readFacetOptionIds(o.engCatchUpFacetModel), mode);
    if (has(apply, 'status')) o.setEngStatusFilter(apply.status);
    if (has(apply, 'priority')) o.setEngPriorityFilter(apply.priority);
    if (has(apply, 'track')) o.setEngProjectTrackFilter(apply.track);
    return reported;
}

function readGate(o) {
    const catalog = o.sprintCatalogState;
    const validated = catalog.authority === 'validated';
    const unrecoverable = catalog.authority === 'auth_locked'
        || (!validated && !catalog.validatedSnapshot && (catalog.status === 'error' || catalog.status === 'exhausted'));
    return {
        configSettled: Boolean(o.sharedConfigReady), groupsLoading: Boolean(o.groupsLoading), groupsFailed: Boolean(o.groupsFailed),
        onboardingRequired: Boolean(o.onboardingRequired), adminGate: o.adminSettingsGate.status,
        catalog: validated ? ((catalog.availableSprints || []).length ? 'validated' : 'failed') : unrecoverable ? 'failed' : 'pending',
        capsulesPending: Boolean(o.pendingShellAuthResumeRef.current || o.pendingPlanningAuthResumeRef.current),
        homeTokenReady: !o.savedViewIsEpm || Boolean(o.homeTokenConnectionLoaded),
    };
}

const isApplyPaused = o => Boolean(o.onboardingRequired || o.tourRunning);

export function createApplyController({ readOptions, now = clock }) {
    let machine = createApplyMachine();
    let commit = 0;
    let interrupt = null;
    let focusResult = null;
    let reveal = null;
    let revealCancelled = false;
    let seeded = false;
    let locked = null;
    let resolved = null;
    let planningRows = null;
    let pendingTrack = null;
    let trackQueued = false;
    const reported = new Set();
    const addReported = categories => (categories || []).forEach(category => reported.add(category));

    const queueTrack = (result, sourceSurface) => {
        if (trackQueued) return;
        trackQueued = true;
        pendingTrack = { workflowAction: 'apply_link', result: ANALYTICS_RESULT[result], sourceSurface };
    };

    const buildInput = (o, state) => {
        const preScope = !machine.ran.A;
        resolved = preScope ? resolveApplyPlan(o, state) : resolved;
        const target = preScope ? (resolved.ok ? { groupId: resolved.scope.group.id, sprintId: String(resolved.scope.sprint.id) } : null) : locked.target;
        const mode = preScope ? resolved.scope?.mode : locked.mode;
        const boardToken = mode === 'board' && (state.scope === 'component' || state.scope === 'all_work') ? state.scope : null;
        const readiness = boardToken === 'component' ? o.engSprintSelectorState.componentReadiness : o.engSprintSelectorState.allWorkReadiness;
        const teamsHydrated = Boolean(o.teamSelectionScopeKey) && o.teamSelectionHydratedScopeRef.current === o.teamSelectionScopeKey;
        return {
            now: now(), commit, paused: isApplyPaused(o), authLocked: Boolean(readPendingAuthenticationRequired()),
            reviewBusy: Boolean(o.planningReviewBusy), interrupt, reported: [...reported],
            gate: readGate(o),
            resolution: preScope ? (resolved.ok ? { ok: true, plan: resolved.plan } : { ok: false, categories: resolved.categories }) : null,
            scope: { equal: Boolean(target) && String(o.activeGroupId) === target.groupId && String(o.selectedSprint) === target.sprintId },
            b: {
                groupApplied: o.activeGroupRef.current === o.activeGroupId,
                planningHydrated: Boolean(o.planningScopeKey) && o.planningHydratedScopeRef.current === o.planningScopeKey,
                restoring: Boolean(o.restoringGroupRef.current),
                scopePending: Boolean(boardToken) && (readiness === 'catalog_pending' || readiness === 'loading'),
            },
            c: {
                epoch: o.loadEpochRef.current, lanesLoading: Boolean(o.tasksLoading), tasksFetched: Boolean(o.tasksFetched),
                lastLoadedMatches: Boolean(target) && String(o.lastLoadedSprintRef.current ?? '') === target.sprintId,
                teamsHydrated, expected: Boolean(o.engLoadsTasks),
            },
            d: {
                cohortSettled: mode === 'catch-up' ? o.catchUpAlertLoadRef.current === o.catchUpAlertScopeKey && o.alertCohortRef.current === null : true,
                recoveryIdle: !o.pendingConnectionRecoveryRef.current, visible: isVisible(),
            },
            focusResult,
        };
    };

    const conclude = ({ result, categories }) => {
        revealCancelled = true;
        reveal?.cancel();
        // The store ends an apply once; only the call that ended it reports the apply event.
        if (!finishShareView(result, categories)) return;
        queueTrack(result, surfaceFor(locked?.mode, readOptions().activeEngMode));
    };

    const abort = (categories) => {
        machine = { ...machine, finished: true };
        conclude({ result: 'partial', categories: unique([...reported, ...categories]) });
    };

    // Returns false when the link no longer resolves, which ends it.
    const runStage = (action, o, state) => {
        // The Planning table is unmounted by the first ENG load, which the hold delays until after Stage B, so its Epics/Stories
        // rows are seeded once that load is done. The seed comes first: the table remounts when Stage C begins (a key on the table).
        if (action.stage === 'C' && planningRows) { setPendingPlanningRowMode(planningRows); planningRows = null; }
        beginShareViewStage(action.stage);
        const fresh = action.stage === 'A' ? resolved : resolveApplyPlan(o, state);
        if (!fresh.ok) { abort(fresh.categories); return false; }
        addReported(fresh.reported);
        if (action.stage === 'A') {
            locked = { target: { groupId: fresh.scope.group.id, sprintId: String(fresh.scope.sprint.id) }, mode: fresh.scope.mode };
            runStageA(o, state, fresh, action.scopeChange);
        } else if (action.stage === 'B') {
            const applied = runStageB(o, state, fresh.scope);
            addReported(applied.reported);
            planningRows = applied.rows;
        } else if (action.stage === 'C') {
            if (action.part === 'teams') runStageCTeams(o, fresh);
            else addReported(runStageCFacets(o, state, fresh.scope.mode));
        } else {
            const target = resolveShareViewFocus(state, fresh.scope.mode);
            if (!target) { focusResult = 'missing'; return true; }
            // Cancelled by the machine, by an interaction the guard reported since the last tick, or by the terminal auth lock.
            reveal = revealShareViewFocus(target, { mode: fresh.scope.mode, isCancelled: () => revealCancelled || interrupt !== null || Boolean(readPendingAuthenticationRequired()) });
            reveal.done.catch(() => 'missing').then((result) => { focusResult = result; controller.evaluate(); });
        }
        return true;
    };

    const controller = {
        noteCommit() { commit += 1; },
        noteInterrupt(kind) { if (kind === 'deliberate' || interrupt === null) interrupt = kind; },
        isPaused: () => isApplyPaused(readOptions()),
        evaluate() {
            const snapshot = getShareViewSnapshot();
            const active = snapshot.phase === SHARE_VIEW_PHASES.PENDING || snapshot.phase === SHARE_VIEW_PHASES.RUNNING;
            if (!active) {
                if (snapshot.phase === SHARE_VIEW_PHASES.DROPPED && !snapshot.entry) queueTrack('dropped', surfaceFor(undefined, readOptions().activeEngMode));
                return;
            }
            if (machine.finished || !snapshot.entry) return;
            if (!seeded) { seeded = true; addReported(snapshot.entry.reported); }
            const state = snapshot.entry.state;
            let failing = null;
            try {
                const o = readOptions();
                const input = buildInput(o, state);
                interrupt = null;
                const stepped = stepApplyMachine(machine, input);
                machine = stepped.state;
                for (const action of stepped.actions) {
                    if (action.type === 'releaseHold') markShareViewScopeCommitted();
                    else if (action.type === 'cancelReveal') { revealCancelled = true; reveal?.cancel(); }
                    else if (action.type === 'run') { failing = action; if (!runStage(action, o, state)) break; failing = null; }
                    else conclude(action);
                }
            } catch (error) {
                // A link must never take the dashboard down: stop applying and keep whatever was already written.
                console.error('Shareable link apply failed', error);
                machine = { ...machine, finished: true };
                const unfinished = [...(failing ? STEP_CATEGORIES[`${failing.stage}${failing.part || ''}`] : []), ...machine.skipped, ...machine.owed.flatMap(entry => entry.categories)];
                conclude({ result: machine.ran.A ? 'partial' : 'dropped', categories: unique([...reported, ...unfinished]) });
            }
        },
        // The apply event is sent once, and only when analytics is ready (earlier events are dropped).
        flushTrack(track, analyticsReady) {
            if (!pendingTrack || !analyticsReady) return;
            track(pendingTrack);
            pendingTrack = null;
        },
    };
    return controller;
}
```

Create `frontend/src/shareView/useShareViewApply.js`:

```js
import * as React from 'react';
import { SHARE_VIEW_PHASES, dismissShareViewNotice, getShareViewSnapshot, subscribeShareView } from './store.js';
import { createApplyController } from './applyController.js';
import { armInteractionGuard } from './interactionGuard.js';
import { buildShareViewState } from './captureState.js';
import { encodeShareView } from './codec.js';
import { captureShareViewFocus, readPlanningRowsMode } from './focusCapture.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';

// Refs have no notifications, so a pending link is stepped on every commit and on this interval.
const APPLY_TICK_MS = 50;

const isApplyTerminal = snapshot => snapshot.terminal || snapshot.phase === SHARE_VIEW_PHASES.ABSENT;
const selectHold = () => getShareViewSnapshot().hold;
const selectApplyTerminal = () => isApplyTerminal(getShareViewSnapshot());
const ROWS_SEEDED_STAGES = new Set(['C', 'D']);
const selectPlanningTableKey = () => (ROWS_SEEDED_STAGES.has(getShareViewSnapshot().stage) ? 1 : 0);

// Declared early in App, before the ENG task-load effect: a pending link holds the default-scope load.
export function useShareViewHold() {
    return React.useSyncExternalStore(subscribeShareView, selectHold, selectHold);
}

// Declared early as well, before the onboarding controller: the Catch Up tour waits for the link to settle.
export function useShareViewApplyTerminal() {
    return React.useSyncExternalStore(subscribeShareView, selectApplyTerminal, selectApplyTerminal);
}

// Stage C seeds the Planning table's Epics/Stories rows for its next mount, and a mounted table never re-reads the seed.
// The App keys the table on this value, which changes once, when Stage C begins and the scope has loaded.
export function useShareViewPlanningTableKey() {
    return React.useSyncExternalStore(subscribeShareView, selectPlanningTableKey, selectPlanningTableKey);
}

// Sharing needs a settled scope: a Sprint, loaded Departments, a validated catalog and no pending apply, and, where a task list loads, a
// hydrated Team selection. A source-only Statistics view and a strict Board scope load no tasks, so no Team hydrate ever runs there.
const isShareDisabled = (o, applyTerminal) => !applyTerminal
    || o.selectedSprint === null || o.groupsLoading || o.onboardingRequired || o.adminSettingsGate.status === 'missing'
    || !o.teamSelectionScopeKey || (o.engLoadsTasks && o.teamSelectionHydratedScopeRef.current !== o.teamSelectionScopeKey)
    || o.sprintCatalogState.authority !== 'validated' || o.selectedView !== 'eng' || o.activeEngMode === 'scenario'
    || Boolean(readPendingAuthenticationRequired());

export function useShareViewApply(options) {
    const snapshot = React.useSyncExternalStore(subscribeShareView, getShareViewSnapshot, getShareViewSnapshot);
    const optionsRef = React.useRef(options);
    const controllerRef = React.useRef(null);
    if (!controllerRef.current) controllerRef.current = createApplyController({ readOptions: () => optionsRef.current });
    const controller = controllerRef.current;
    const [shareDisabled, setShareDisabled] = React.useState(true);
    const active = snapshot.phase === SHARE_VIEW_PHASES.PENDING || snapshot.phase === SHARE_VIEW_PHASES.RUNNING;

    // After every commit, so the apply reads state that React has committed and the refs the earlier effects just wrote.
    React.useEffect(() => {
        optionsRef.current = options;
        controller.noteCommit();
        controller.evaluate();
        controller.flushTrack(options.trackShareViewAction, options.analyticsReady);
        setShareDisabled(isShareDisabled(options, selectApplyTerminal()));
    });

    React.useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => controller.evaluate(), APPLY_TICK_MS);
        const disarm = armInteractionGuard({
            onInteraction: (kind) => { controller.noteInterrupt(kind); controller.evaluate(); },
            isPaused: () => controller.isPaused(),
        });
        return () => { clearInterval(timer); disarm(); };
    }, [active, controller]);

    const captureShareUrl = React.useCallback(() => {
        const o = optionsRef.current;
        if (isShareDisabled(o, selectApplyTerminal())) return { ok: false, reason: 'disabled' };
        const rowsMode = readPlanningRowsMode(document);
        const state = buildShareViewState({
            mode: o.activeEngMode, groupId: o.activeGroupId, sprintId: o.selectedSprint, snapshot: o.buildGroupStateSnapshot(),
            searchQuery: o.searchQuery, sort: o.engEpicSort, layout: o.planningLayout, rowsMode, boardStrictScope: o.boardStrictScope,
            sprintRange: { start: o.excludedCapacityStartSprintId, end: o.excludedCapacityEndSprintId },
            alertFlags: o.alertFlags, alertCounts: o.alertCounts,
            focus: captureShareViewFocus({ mode: o.activeEngMode, rowsMode, root: document, win: window }),
        });
        const encoded = encodeShareView(state);
        return encoded.ok ? { ok: true, url: `${window.location.origin}/?${encoded.query}`, dropped: encoded.dropped } : { ok: false, reason: encoded.reason };
    }, []);

    return {
        notice: snapshot.notice, dismissNotice: dismissShareViewNotice, captureShareUrl, shareDisabled,
        applyTerminal: isApplyTerminal(snapshot),
    };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `fnm exec --using 20 node --test tests/test_share_view_apply_controller.js tests/test_share_view_capture_state.js tests/test_share_view_interaction_guard.js tests/test_share_view_apply_hook.js`

Expected: `# tests 46`, `# pass 46`, `# fail 0` (27 controller, 7 capture, 5 guard, 7 hook). The hook file ends the process cleanly: every `withBrowser` run stubs the timers and `document`, and the tests unmount their hooks.

- [ ] **Step 5: Run the task's regression gate**

1. The whole frontend unit suite: `fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'`. Expected: `# fail 0` and `# tests` equal to N0 plus 46. This run includes `tests/test_auth_isolation_source_guard.js` (the `window` `keydown` count stays at six) and `tests/test_frontend_api_source_guards.js`.
2. The structure budgets: `env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets`. Expected: `Ran 2 tests` and `OK`.
3. The extraction gate: `fnm exec --using 20 bash scripts/extraction_lint/run.sh`. Expected: the Task 0 baseline exit status, `0 errors`, a warning count equal to W0, `owner budgets: 0 problems` and `enforced problems: <B>`.
4. Rebuild: `fnm exec --using 20 npm run build`. Expected: `Dashboard built: ` followed by 64 hexadecimal digits. Then `git status --short -- frontend/dist` must print the same three entries as in Task 9 (the modules are not imported by the App yet, so the bundle only changes by its build id):

```
 M frontend/dist/dashboard.js
 D frontend/dist/lazy-views-<previous build id>.json
?? frontend/dist/lazy-views-<new build id>.json
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shareView/applyController.js frontend/src/shareView/captureState.js frontend/src/shareView/interactionGuard.js frontend/src/shareView/useShareViewApply.js tests/react_hook_harness.js tests/test_share_view_apply_controller.js tests/test_share_view_capture_state.js tests/test_share_view_interaction_guard.js tests/test_share_view_apply_hook.js
git add -A -- frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add the shareable-link apply controller and hook" -m "The controller steps the pure apply machine each tick and executes its actions with raw setters and refs only, re-resolving the link before every stage, catching faults, seeding the Planning rows once the scope has loaded and reporting one apply event when analytics is ready. A capture builder, document-level interaction listeners behind the auth latch and a thin hook with three early hooks complete it. Nothing is mounted yet (issue 194)."
git show --stat HEAD
git status --short
make verify-dist-clean
```

Read the results: `git show --stat HEAD` lists exactly eleven paths: `frontend/dist/dashboard.js`, the renamed `frontend/dist/lazy-views-*.json`, the four modules, `tests/react_hook_harness.js` (1 insertion) and the four test files (the `dist` counts depend on the bundle). `git status --short` prints nothing. `make verify-dist-clean` prints nothing and exits 0.


---

### Task 11b: Mount the apply: hold, options, tour wait and Planning table key

**Owner note:** depends on Task 6 (`commitSprintSelection`, `persistTeamSelection`), Task 10 (the analytics hook returns `trackShareViewAction` and `analyticsReady`) and Task 11a (the hook and its early hooks); blocks Task 11c and Task 12. Anchors this task assumes are already applied: Task 5's first line (`import './shareView/entry.js';`, which no block below touches), Task 6's two closures, Task 10's analytics module. It assumes none of Task 12: Task 12 runs after this task and its anchors (the `JiraExportButton` import, `renderEpmControls`, `renderSearchControl('main')`, `compact-sticky-header-search`) do not overlap any block here; its Step 0 needs exactly one `const shareView = useShareViewApply(` line, which this task adds. This task mounts no notice: Task 12 renders the notice inside the Share control and reads `shareView.notice`.

**What lands here.** The only behavior change of Task 11 in `dashboard.jsx`, in nine small replacements:

| # | Where | What |
| --- | --- | --- |
| 1 | the `dashboardAnalytics.js` import | import `useShareViewApply`, `useShareViewApplyTerminal`, `useShareViewHold`, `useShareViewPlanningTableKey` |
| 2 | the `useDashboardAnalytics` destructure | `trackShareViewAction, analyticsReady` (Task 10's exact edit; it changes no line count and is made here so ESLint sees both names used) |
| 3 | before the onboarding controller | the three early hooks, declared before both consumers |
| 4 | the `useOnboardingController` call | `applyTerminal: shareViewTerminal` |
| 5 | the ENG task-load effect, after the first-run check | return while the link holds, except for a staged Planning recovery capsule |
| 6 | the same effect's dependency list | append `shareViewHold` |
| 7 | after `useEngModeState` | the flat `shareViewOptions` object (the 73 names of Task 11a's table) and `const shareView = useShareViewApply(shareViewOptions);` |
| 8 | the Planning table element | `key={shareViewPlanningTableKey}` |
| 9 | the `usePlanningSprintReview` call | its `active` expression gains `&& !shareViewHold` (no line count change) |

Plus a three-line change in `frontend/src/onboarding/useOnboardingTour.js`: the Catch Up tour's auto-start waits for `applyTerminal`.

**The hold.** A link is pending from the moment the entry module decoded it. While `useShareViewHold()` is true the ENG task-load effect returns early exactly as it does for `groupsLoading`, so no request is issued for the recipient's saved scope, and the Planning review stays inactive, so a Planning table that is already mounted does not read the review schema of the recipient's saved Sprint (a Planning link or a Catch Up link would otherwise add `GET /api/eng/sprints/<saved Sprint>/review`, which a manual run never issues). The hold ends when the machine emits `releaseHold` (one commit after Stage B) or when the link finishes, so an unresolvable link never blocks the default load. The one exception is a staged Planning recovery capsule (`pendingPlanningAuthResumeRef.current`): `usePlanningSelectionSync` clears it only after the ENG load, so holding would wait on itself. The link waits for the capsule (the readiness gate includes `capsulesPending`) and the capsule's own load runs.

**The tour wait.** `useShareViewApplyTerminal()` is false only while a link is pending or running. The onboarding controller is declared before `useEngModeState`, so this early hook is the only way to pass it down; the Catch Up tour's auto-start waits for it and starts as before once the link is terminal (a link that settles after Catch Up was already completed starts nothing).

**The Planning table key.** The Planning table's Epics/Stories rows are local state seeded once at mount (Task 8). The controller seeds them when Stage C begins, after the first ENG load (which unmounts the table), and `useShareViewPlanningTableKey()` flips at the same moment, so the keyed table remounts and reads the seed. A seed taken at the table's first mount would be lost: the first ENG load, which the hold delays until after Stage B, unmounts the table, and the next mount starts from Epics.

**Files:**
- Modify: `frontend/src/dashboard.jsx` (the nine replacements above)
- Modify: `frontend/src/onboarding/useOnboardingTour.js` (`shouldAutomaticallyStartOnboarding`, `useOnboardingController`, its auto-start effect)
- Modify: `tests/test_dashboard_freshness_interactions.js` (the `normalEngLoadEffect` inputs, one new test)
- Modify: `scripts/extraction_lint/owner_budgets.json` (the `dashboard.jsx` manifest pins, same commit)
- Test (new): `tests/test_share_view_source_guards.js`, `tests/test_share_view_onboarding_wait.js`
- Regenerated: `frontend/dist/`

**Interfaces:**
- Consumes: Task 11a's four hook exports; Task 6's `commitSprintSelection(sprint, options)` and `persistTeamSelection(nextSelectedTeams)`; Task 10's `trackShareViewAction({ workflowAction, result, sourceSurface })` and `analyticsReady`.
- Produces (identifiers in `App()`): `shareViewHold` (boolean), `shareViewTerminal` (boolean), `shareViewPlanningTableKey` (0 or 1), `shareViewOptions` (the flat object) and `shareView = { notice, dismissNotice, captureShareUrl, shareDisabled, applyTerminal }` (the name and shape Task 12 consumes). `useOnboardingController` gains `applyTerminal` (default `true`) and `shouldAutomaticallyStartOnboarding` gains the same field.

**Forbidden regressions for this task:**
- [ ] Reauth recovery and its source guards are untouched: no `AuthRequiredGate`, `authRecoveryCoordinator` or `sanitizeLoginUrl` edit; `tests/test_auth_isolation_source_guard.js` still counts exactly six `window.addEventListener('keydown', handler)` registrations; the staged Planning recovery capsule still loads.
- [ ] Non-link startup is unchanged: without a link the hold is false and the tour's `applyTerminal` is true, so the ENG load effect and the tour behave exactly as before (the freshness test pins the load with `shareViewHold: false`). The dependency list only gains `shareViewHold` at its tail.
- [ ] The first load stays cache-first and performance-critical: no new request, no extra fetch, and no review read for the saved Sprint (Task 11c compares the request multiset with a manual run, for a Catch Up recipient and for a recipient who saved a Planning table).
- [ ] No notice mount, no Share control and no CSS here (Task 12). No sticky offset or z-index changes.
- [ ] `dashboard.jsx` grows by exactly 35 lines and the manifest pins move in this commit.
- [ ] Analytics impact: the `apply_link` event of Task 11a is the only new event; Task 13 documents it.
- [ ] ESLint: this task adds exactly one warning, `'shareView' is assigned a value but never used`, which Task 12 removes by rendering the control. The ratchet (106) holds.

- [ ] **Step 0: Preflight and baselines**

Run every command of this task from the worktree root with `JEP_TEST_PYTHON` exported (a command may run in a fresh shell, so export it again or write the interpreter path in place of `$PY`; the extraction lint reads `JEP_TEST_PYTHON` too) and with the Python test environment typed inline exactly as the commands show it.

Run:
```bash
git branch --show-current
git status --short
wc -l frontend/src/dashboard.jsx
rg -c "const shareView" frontend/src/dashboard.jsx
rg -n "export function useShareViewApply|export function useShareViewHold|export function useShareViewApplyTerminal|export function useShareViewPlanningTableKey" frontend/src/shareView/useShareViewApply.js | wc -l
rg -n "^        analyticsReady,$|^        trackShareViewAction,$" frontend/src/analytics/dashboardAnalytics.js | wc -l
fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'
fnm exec --using 20 bash scripts/extraction_lint/run.sh 2>&1 | grep -E 'problems \('
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; `wc -l` prints Task 6's count (`7505 frontend/src/dashboard.jsx` on the validated base); the `rg -c "const shareView"` command prints nothing (no match yet); the second `rg` prints `4` and the third prints `2` (the hook returns both new members); the Node summary shows `# fail 0` (write down `# tests` as N0); the lint line shows `0 errors` (write down the warning count as W0).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_share_view_onboarding_wait.js` (the real `useOnboardingController` through the hook harness):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

const ENTRY = path.join(__dirname, '..', 'frontend', 'src', 'onboarding', 'useOnboardingTour.js');

function mountController(props) {
    return mountBundledHook({
        entry: ENTRY, exportName: 'useOnboardingController', modules: {},
        makeProps: () => ({ bootstrapReady: true, activeSurface: 'catch-up', completedModules: [], trackSettingsAction: () => {}, ...props }),
    });
}

function withWindow(fn) {
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    try { return fn(); } finally { delete globalThis.window; }
}

test('the Catch Up tour does not auto-start while a shareable link is still applying, and starts once it settles', () => withWindow(() => {
    const hook = mountController({ applyTerminal: false });
    hook.render();
    assert.equal(hook.render().run, false);
    assert.equal(hook.render({ applyTerminal: true }).run, false, 'the start is requested by the effect and shown on the next render');
    assert.equal(hook.render({ applyTerminal: true }).run, true);
    hook.unmount();
}));

test('without a link the tour starts as before', () => withWindow(() => {
    const hook = mountController({});
    hook.render();
    assert.equal(hook.render().run, true);
    hook.unmount();
}));

test('a link that settles after the user already completed Catch Up does not start the tour', () => withWindow(() => {
    const hook = mountController({ applyTerminal: false, completedModules: ['catch-up'] });
    hook.render();
    hook.render({ applyTerminal: true });
    assert.equal(hook.render({ applyTerminal: true }).run, false);
    hook.unmount();
}));
```

Create `tests/test_share_view_source_guards.js`. It checks code only (comments are stripped with esbuild, so a comment may name a forbidden helper) and pins: no forbidden helper, no template-literal selector, no write API, no `URLSearchParams` in the codec, no `window` `keydown` handler in `shareView/`, the entry import first, the hook declared after the restore effects and after `useEngModeState`, the options parity in both directions, the ten alert-flag pairs, the hold in the ENG effect with its capsule exception and dependency, the hold on the Planning review read, and the early hooks with the tour wait and the table key:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const repoRoot = path.join(__dirname, '..');
const shareViewDir = path.join(repoRoot, 'frontend', 'src', 'shareView');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const dashboard = read('frontend/src/dashboard.jsx');

// esbuild drops ordinary comments, so a rule is checked against code only and a comment may name a forbidden helper.
const codeOf = source => esbuild.transformSync(source, { loader: 'jsx', legalComments: 'none' }).code;
const shareViewFiles = fs.readdirSync(shareViewDir).filter(name => /\.jsx?$/.test(name));
const shareViewCode = Object.fromEntries(shareViewFiles.map(name => [name, codeOf(fs.readFileSync(path.join(shareViewDir, name), 'utf8'))]));

function between(source, startMarker, endMarker, from = 0) {
    const start = source.indexOf(startMarker, from);
    assert.ok(start >= 0, `find ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.ok(end > start, `find ${endMarker} after ${startMarker}`);
    return source.slice(start, end);
}

// Top-level keys of an object literal body, shorthand or `key: value`, ignoring nested brackets.
function topLevelKeys(body) {
    const keys = [];
    let depth = 0;
    let piece = '';
    const flush = () => {
        const match = piece.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
        if (match) keys.push(match[1]);
        piece = '';
    };
    for (const char of body) {
        if ('([{'.includes(char)) depth += 1;
        if (')]}'.includes(char)) depth -= 1;
        if (char === ',' && depth === 0) flush();
        else piece += char;
    }
    flush();
    return keys;
}

test('the link apply never calls the App helpers that reset filters, emit analytics or leave the page', () => {
    for (const [name, code] of Object.entries(shareViewCode)) {
        assert.doesNotMatch(code, /\b(?:applyEngMode|clearEngFilters|resetEngFilters|navigateToAlertStory|handleAlertStoryClick)\b/, name);
    }
});

test('no shareView selector interpolates a value into its selector string', () => {
    for (const [name, code] of Object.entries(shareViewCode)) {
        assert.doesNotMatch(code, /\.(?:querySelector|querySelectorAll|closest|matches)\(\s*`[^`]*\$\{/, name);
    }
});

test('shareView reaches no write API, preference save or CSRF helper', () => {
    for (const [name, code] of Object.entries(shareViewCode)) {
        assert.doesNotMatch(code, /configApi|jiraIssueApi|postJsonWithCsrf|saveGroupPreferences/, name);
    }
});

test('the codec parses the query by hand and never through URLSearchParams', () => {
    assert.ok(shareViewCode['codec.js'], 'the codec must exist');
    assert.doesNotMatch(shareViewCode['codec.js'], /URLSearchParams/);
});

test('shareView registers no window keydown handler; interactions use document capture listeners behind the auth latch', () => {
    for (const [name, code] of Object.entries(shareViewCode)) assert.doesNotMatch(code, /window\.addEventListener\(\s*['"]keydown['"]/, name);
    const guard = shareViewCode['interactionGuard.js'];
    assert.match(guard, /doc\.addEventListener\(type, handle, \{ capture: true, passive: true \}\)/);
    assert.ok(guard.indexOf('readPendingAuthenticationRequired()') < guard.indexOf('onInteraction('), 'the auth latch is read before any interaction is reported');
});

test('the link entry is the first import of the dashboard', () => {
    const firstStatement = dashboard.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('//'));
    assert.equal(firstStatement, "import './shareView/entry.js';");
});

test('the apply hook is declared after the restore effects, the group and Team effects and the mode state', () => {
    const hook = dashboard.indexOf('const shareView = useShareViewApply(shareViewOptions);');
    assert.ok(hook > 0);
    for (const anchor of [
        "if (!restoredInitialEpmViewRef.current && savedInitialViewRef.current === 'epm') {",
        "const nextView = resume.selectedView === 'epm' && showEpmNavigation ? 'epm' : 'eng';",
        'applyGroupState(overlaySnapshot(issueEditStateRef.current.reconcileSnapshot(cached), issueEditStateRef.current.planningEntries()));',
        "teamSelectionSkipPersistScopeRef.current = hydrationWillUpdateSelection ? teamSelectionScopeKey : '';",
        'const { activeEngMode, applyEngMode } = useEngModeState({',
    ]) {
        const at = dashboard.indexOf(anchor);
        assert.ok(at >= 0, `find ${anchor}`);
        assert.ok(at < hook, `the apply hook must follow: ${anchor}`);
    }
});

test('the options object names exactly what the apply reads from it', () => {
    const body = between(dashboard, 'const shareViewOptions = {', '\n            };').slice('const shareViewOptions = {'.length);
    const provided = new Set(topLevelKeys(body));
    const read = new Set();
    for (const name of ['applyController.js', 'useShareViewApply.js']) {
        for (const match of shareViewCode[name].matchAll(/\b(?:o|options)\.([A-Za-z_$][\w$]*)/g)) read.add(match[1]);
    }
    assert.deepEqual([...read].filter(name => !provided.has(name)).sort(), [], 'every option the apply reads is passed by the App');
    assert.deepEqual([...provided].filter(name => !read.has(name)).sort(), [], 'every option the App passes is read by the apply');
});

test('the alert flag pairs cover the ten alert categories, each with its own value and setter', () => {
    const block = between(dashboard, 'alertFlags: {', '\n                },');
    for (const [key, flag] of [
        ['missing', 'MissingAlert'], ['blocked', 'BlockedAlert'], ['followup', 'PostponedAlert'], ['backlog', 'BacklogAlert'],
        ['missingTeam', 'MissingTeamAlert'], ['missingLabels', 'MissingLabelsAlert'], ['needsStories', 'NeedsStoriesAlert'],
        ['waiting', 'WaitingAlert'], ['empty', 'EmptyEpicAlert'], ['done', 'DoneEpicAlert'],
    ]) {
        assert.ok(block.includes(`${key}: [show${flag}, setShow${flag}]`), key);
    }
});

test('the ENG task-load effect holds for a pending link, with the Planning recovery capsule as the only exception', () => {
    const head = between(dashboard, "if (selectedView !== 'eng' || isStatsSourceOnlyStatsView) return;", 'const pendingPlanningResume = pendingPlanningAuthResumeRef.current;');
    assert.ok(head.includes('if (groupPreferences.onboardingRequired) {'));
    assert.ok(head.includes('if (shareViewHold && !pendingPlanningAuthResumeRef.current) {'));
    assert.ok(head.indexOf('if (groupsLoading) {') < head.indexOf('if (shareViewHold'));
    assert.ok(dashboard.includes('groupsLoading, groupPreferences.onboardingRequired, configRefreshNonce, authResumeStagedRevision, shareViewHold]);'));
});

test('the Planning review read holds with the link, so it never reads the review of the recipient saved Sprint', () => {
    const call = between(dashboard, 'const planningReview = usePlanningSprintReview({', '\n            });');
    assert.ok(call.includes("active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured && !shareViewHold,"));
    assert.ok(dashboard.indexOf('const shareViewHold = useShareViewHold();') < dashboard.indexOf('const planningReview = usePlanningSprintReview({'));
});

test('the early link hooks precede both of their consumers and the Catch Up tour waits for the link', () => {
    const early = dashboard.indexOf('const shareViewHold = useShareViewHold();');
    assert.ok(early > 0);
    assert.ok(dashboard.indexOf('const shareViewTerminal = useShareViewApplyTerminal();') > early);
    assert.ok(dashboard.indexOf('const shareViewPlanningTableKey = useShareViewPlanningTableKey();') > early);
    assert.ok(early < dashboard.indexOf('const onboarding = useOnboardingController({'));
    assert.ok(early < dashboard.indexOf("if (selectedView !== 'eng' || isStatsSourceOnlyStatsView) return;"));
    assert.ok(between(dashboard, 'const onboarding = useOnboardingController({', 'trackSettingsAction,').includes('applyTerminal: shareViewTerminal,'));
    // The Planning table reads the link's Epics/Stories seed once, when it mounts, so the link remounts a table that is already open.
    assert.ok(dashboard.includes('<PlanningReviewTable key={shareViewPlanningTableKey} toolbarHost={planningToolbarHost}'));
    const tour = read('frontend/src/onboarding/useOnboardingTour.js');
    assert.ok(tour.includes('&& applyTerminal\n        && activeSurface === \'catch-up\''));
    assert.ok(tour.includes('}, [activeSurface, applyTerminal, bootstrapReady, normalizedCompletedModules, openModule, run]);'));
});
```

Extend `tests/test_dashboard_freshness_interactions.js`. First the inputs of the load-effect harness gain the hold, off:

Replace this:

```js
        activeGroupId: 'sample-group', activeGroupTeamIds: ['sample-team'], groupsLoading: false,
```

with:

```js
        activeGroupId: 'sample-group', activeGroupTeamIds: ['sample-team'], groupsLoading: false, shareViewHold: false,
```

Then a new test directly above `held catalog display cannot authorize a normal ENG acquisition before validation`:

Replace this:

```js
test('held catalog display cannot authorize a normal ENG acquisition before validation', () => {
```

with:

```js
test('a pending shareable link holds the normal ENG load until it is released, unless a Planning recovery capsule needs its own load', () => {
    const held = normalEngLoadEffect({ cached: false, overrides: { shareViewHold: true } });
    assert.equal(held.capture().callback(), undefined);
    assert.equal(held.inputs.groupLoadVersionRef.current, 7, 'a held link starts no load and fences nothing');
    assert.deepEqual(held.calls, []); assert.deepEqual(held.writes, []);
    assert.notDeepEqual(held.capture({ shareViewHold: false }).dependencies, held.capture().dependencies, 'releasing the hold re-runs the effect');

    const released = normalEngLoadEffect({ cached: false });
    released.capture().callback();
    assert.equal(released.calls.length, 1, 'the same scope loads once the hold is released');

    const capsule = normalEngLoadEffect({ cached: false, overrides: { shareViewHold: true, pendingPlanningAuthResumeRef: { current: { scopeKey: 'planning::sample-sprint::sample-group' } } } });
    capsule.capture().callback();
    assert.equal(capsule.calls.length, 1, 'only the recovery load can clear the capsule the link waits for');
});

test('held catalog display cannot authorize a normal ENG acquisition before validation', () => {
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `fnm exec --using 20 node --test tests/test_share_view_source_guards.js tests/test_share_view_onboarding_wait.js tests/test_dashboard_freshness_interactions.js`

Expected: exit status 1 with eight failures and everything else passing. In the source guards: `the apply hook is declared after the restore effects, the group and Team effects and the mode state`, `the options object names exactly what the apply reads from it`, `the alert flag pairs cover the ten alert categories, each with its own value and setter`, `the ENG task-load effect holds for a pending link, with the Planning recovery capsule as the only exception`, `the Planning review read holds with the link, so it never reads the review of the recipient saved Sprint` and `the early link hooks precede both of their consumers and the Catch Up tour waits for the link`. In the onboarding file: `the Catch Up tour does not auto-start while a shareable link is still applying, and starts once it settles`. In the freshness file: `a pending shareable link holds the normal ENG load until it is released, unless a Planning recovery capsule needs its own load`.

- [ ] **Step 3: Make the Catch Up tour wait for the link**

Three replacements in `frontend/src/onboarding/useOnboardingTour.js`, each occurring once. In `shouldAutomaticallyStartOnboarding` (the new field defaults to true, so every other caller is unchanged):

Replace this:

```js
    activeSurface = 'catch-up',
} = {}) {
    return Boolean(bootstrapReady
        && activeSurface === 'catch-up'
```

with:

```js
    activeSurface = 'catch-up',
    applyTerminal = true,
} = {}) {
    return Boolean(bootstrapReady
        && applyTerminal
        && activeSurface === 'catch-up'
```

In `useOnboardingController`'s parameter list:

Replace this:

```js
export function useOnboardingController({
    bootstrapReady = false,
    activeSurface = 'catch-up',
    completedModules,
```

with:

```js
export function useOnboardingController({
    bootstrapReady = false,
    activeSurface = 'catch-up',
    applyTerminal = true,
    completedModules,
```

In its auto-start effect (the argument and the dependency):

Replace this:

```js
            replayPending: replayPendingRef.current,
            activeSurface,
        })) return;
        automaticStartedRef.current = openModule('catch-up', 'first_run');
    }, [activeSurface, bootstrapReady, normalizedCompletedModules, openModule, run]);
```

with:

```js
            replayPending: replayPendingRef.current,
            activeSurface,
            applyTerminal,
        })) return;
        automaticStartedRef.current = openModule('catch-up', 'first_run');
    }, [activeSurface, applyTerminal, bootstrapReady, normalizedCompletedModules, openModule, run]);
```

- [ ] **Step 4: Mount the apply in `dashboard.jsx`**

Nine replacements in `frontend/src/dashboard.jsx`, each old block occurring exactly once. Apply them in this order.

1. The import (below the analytics import):

Replace this:

```js
import { analyticsToken, buildPlanningReviewAnalyticsParams, bucketCount, exposeAnalyticsForTests, useDashboardAnalytics } from './analytics/dashboardAnalytics.js';
```

with:

```js
import { analyticsToken, buildPlanningReviewAnalyticsParams, bucketCount, exposeAnalyticsForTests, useDashboardAnalytics } from './analytics/dashboardAnalytics.js';
import { useShareViewApply, useShareViewApplyTerminal, useShareViewHold, useShareViewPlanningTableKey } from './shareView/useShareViewApply.js';
```

2. The analytics destructure inside `App()` (Task 10's edit; no line count change):

Replace this:

```js
                trackSettingsAction, trackSortChanged, trackStatsAction, trackProductEvent,
```

with:

```js
                trackSettingsAction, trackSortChanged, trackStatsAction, trackProductEvent, trackShareViewAction, analyticsReady,
```

3. The three early hooks, directly above the onboarding surface (so before the onboarding controller and before the ENG task-load effect, their two consumers):

Replace this:

```js
            const onboardingActiveSurface = showGroupManage
```

with:

```js
            // A pending shareable link holds the default-scope ENG load and the Catch Up tour's auto-start until it settles,
            // and a link that seeds the Planning rows remounts the Planning table once so that it re-reads the seed.
            const shareViewHold = useShareViewHold();
            const shareViewTerminal = useShareViewApplyTerminal();
            const shareViewPlanningTableKey = useShareViewPlanningTableKey();
            const onboardingActiveSurface = showGroupManage
```

4. The tour wait, in the `useOnboardingController` call:

Replace this:

```js
                bootstrapReady: onboardingBootstrapReady,
                activeSurface: onboardingActiveSurface,
```

with:

```js
                bootstrapReady: onboardingBootstrapReady,
                applyTerminal: shareViewTerminal,
                activeSurface: onboardingActiveSurface,
```

5. The hold, in the ENG task-load effect right after the first-run check (the `groupsLoading` return above it stays first):

Replace this:

```js
                if (groupPreferences.onboardingRequired) {
                    return;
                }

                const pendingPlanningResume = pendingPlanningAuthResumeRef.current;
```

with:

```js
                if (groupPreferences.onboardingRequired) {
                    return;
                }
                // A pending shareable link holds the default-scope load. A pending Planning recovery capsule is the exception:
                // only its own load can clear it, and the link waits for the capsule.
                if (shareViewHold && !pendingPlanningAuthResumeRef.current) {
                    return;
                }

                const pendingPlanningResume = pendingPlanningAuthResumeRef.current;
```

6. The dependency list of the same effect:

Replace this:

```js
groupsLoading, groupPreferences.onboardingRequired, configRefreshNonce, authResumeStagedRevision]);
```

with:

```js
groupsLoading, groupPreferences.onboardingRequired, configRefreshNonce, authResumeStagedRevision, shareViewHold]);
```

7. The options object and the hook, right after `useEngModeState` (the last block of that call is the old text; every identifier in the object is declared above this point):

Replace this:

```js
                onEnterCatchUp: () => { if (planningAlertsDirtyRef.current) rearmCatchUpAlerts(); },
            });
            const renderEngModeControl = () => (
```

with:

```js
                onEnterCatchUp: () => { if (planningAlertsDirtyRef.current) rearmCatchUpAlerts(); },
            });
            const shareViewOptions = {
                sharedConfigReady, groupsLoading, groupsFailed: Boolean(groupsError || boardGroupsReadFailed), onboardingRequired: groupPreferences.onboardingRequired,
                adminSettingsGate, sprintCatalogState, homeTokenConnectionLoaded, savedViewIsEpm: savedInitialViewRef.current === 'epm', visibleControlGroups,
                pendingShellAuthResumeRef, pendingPlanningAuthResumeRef, pendingConnectionRecoveryRef, tourRunning: onboarding.run,
                planningReviewBusy: Boolean(planningReview.dirty || planningReview.saving || planningReview.pendingScopeChange),
                activeGroupId, selectedSprint, planningScopeKey, teamSelectionScopeKey, selectedView, selectedTeams, tasksFetched,
                tasksLoading: productTasksLoading || techTasksLoading, engLoadsTasks: selectedView === 'eng' && !isStatsSourceOnlyStatsView && !boardScopeRequested,
                activeGroupRef, planningHydratedScopeRef, restoringGroupRef, teamSelectionHydratedScopeRef, lastLoadedSprintRef, loadEpochRef,
                catchUpAlertLoadRef, catchUpAlertScopeKey, alertCohortRef, engSprintSelectorState, engCatchUpFacetModel,
                restoredInitialEpmViewRef, setSelectedView, setActiveGroupId, commitSprintSelection, persistTeamSelection,
                setShowPlanning, setShowStats, setShowScenario, setShowBoard, setSearchInput, setSearchQuery, setShowProduct, setShowTech,
                setGroupByInitiativeChoice, setEngEpicSort, setPlanningLayout, setStatsView, setCohortStartQuarter, setCohortEndQuarter,
                setExcludedCapacityStartSprintId, setExcludedCapacityEndSprintId, setShowAlertsPanel, setBoardStrictScope, setSelectedTeams,
                setEngStatusFilter, setEngPriorityFilter, setEngProjectTrackFilter,
                alertFlags: {
                    missing: [showMissingAlert, setShowMissingAlert], blocked: [showBlockedAlert, setShowBlockedAlert], followup: [showPostponedAlert, setShowPostponedAlert],
                    backlog: [showBacklogAlert, setShowBacklogAlert], missingTeam: [showMissingTeamAlert, setShowMissingTeamAlert], missingLabels: [showMissingLabelsAlert, setShowMissingLabelsAlert],
                    needsStories: [showNeedsStoriesAlert, setShowNeedsStoriesAlert], waiting: [showWaitingAlert, setShowWaitingAlert], empty: [showEmptyEpicAlert, setShowEmptyEpicAlert], done: [showDoneEpicAlert, setShowDoneEpicAlert],
                },
                activeEngMode, buildGroupStateSnapshot, searchQuery, engEpicSort, planningLayout, boardStrictScope,
                excludedCapacityStartSprintId, excludedCapacityEndSprintId, alertCounts, trackShareViewAction, analyticsReady,
            };
            const shareView = useShareViewApply(shareViewOptions);
            const renderEngModeControl = () => (
```

8. The key on the Planning table element (the rest of the line stays as it is):

Replace this:

```js
<PlanningReviewTable toolbarHost={planningToolbarHost} onInteractionChange=
```

with:

```js
<PlanningReviewTable key={shareViewPlanningTableKey} toolbarHost={planningToolbarHost} onInteractionChange=
```

9. The Planning review read, in the `usePlanningSprintReview` call (the hold is declared far above it, with the other early hooks): the review stays inactive while the link is pending, so it never reads the review of the saved Sprint. The line count does not change:

Replace this:

```js
                sprintId: selectedSprint, active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured,
```

with:

```js
                sprintId: selectedSprint, active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured && !shareViewHold,
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `fnm exec --using 20 node --test tests/test_share_view_source_guards.js tests/test_share_view_onboarding_wait.js tests/test_dashboard_freshness_interactions.js`

Expected: `# fail 0`. The source guards report 12 passing tests and the onboarding file 3. The freshness file passes its existing tests (every test that runs the load effect needs the harness input added in Step 1: without it the effect throws `ReferenceError: shareViewHold`) plus the new hold test.

- [ ] **Step 6: Move the manifest pins (same commit)**

`dashboard.jsx` grows by exactly 35 lines (the apply mount, its options object, the early hold hooks and the ENG load-effect hold). The extraction manifest pins it by exact equality, so its numbers move in this commit; `appPlusOwners` is the dashboard plus the unchanged `uniqueOwners` aggregate. The legacy ceiling in `LEGACY_ENTRYPOINT_LINE_BUDGETS` sits above the file and is not edited (Global Constraints, Budgets). Run `mkdir -p tmp/share-view-budget`, then create `tmp/share-view-budget/pins.py` (`tmp/` is gitignored; an earlier task may have left a copy, which this text replaces) with exactly this content:

```python
import json
import re
import sys

n = int(sys.argv[1])
path = 'scripts/extraction_lint/owner_budgets.json'
text = open(path).read()
unique_owners = json.loads(text)['aggregates']['uniqueOwners']['measured']
text, count = re.subn(
    r'("dashboard": \{\s*"path": "frontend/src/dashboard\.jsx",\s*"lineCount": )\d+(,\s*"lineCeiling": )\d+',
    lambda match: f'{match.group(1)}{n}{match.group(2)}{n}',
    text,
)
assert count == 1, 'dashboard manifest entry not found exactly once'
text, count = re.subn(
    r'("appPlusOwners": \{\s*"measured": )\d+(,\s*"ceiling": )\d+',
    lambda match: f'{match.group(1)}{n + unique_owners}{match.group(2)}{n + unique_owners}',
    text,
)
assert count == 1, 'appPlusOwners aggregate not found exactly once'
open(path, 'w').write(text)
print(f'dashboard.jsx pinned at {n}; appPlusOwners pinned at {n + unique_owners}')
```

Run:
```bash
wc -l frontend/src/dashboard.jsx
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets 2>&1 | grep -E 'differs|exceeds|^Ran |^OK|^FAILED'
N=$(wc -l < frontend/src/dashboard.jsx | tr -d ' ')
$PY tmp/share-view-budget/pins.py "$N"
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets 2>&1 | grep -E 'differs|exceeds|^Ran |^OK|^FAILED'
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY tests/test_codebase_structure_budgets.py --manifest scripts/extraction_lint/owner_budgets.json
git diff --stat -- tests/test_codebase_structure_budgets.py scripts/extraction_lint/owner_budgets.json
```
Expected: `wc -l` prints the previous task's count plus 35 (7,540 on the validated base); the first test run fails only the manifest test (the printed list holds `dashboard measured lineCount differs from actual`, `dashboard exceeds ceiling`, `appPlusOwners: measured aggregate ... differs from unique actual ...` and `appPlusOwners: ... exceeds aggregate ceiling ...`, then `FAILED (failures=1)`); the script prints `dashboard.jsx pinned at <N>; appPlusOwners pinned at <N + uniqueOwners>` (7,540 and 34,142 on the validated base); the second run reports `Ran 2 tests` and `OK`; the manifest run prints `owner budgets: 0 problems`; `git diff --stat` shows only `scripts/extraction_lint/owner_budgets.json` with 8 changed lines. If the legacy test fails too (`frontend/src/dashboard.jsx: <N> lines exceeds budget <M>`), `main` tightened that ceiling after this plan was validated: raise the entry in `tests/test_codebase_structure_budgets.py` to `<N>` with a one-line comment naming issue #194, and add that file to this commit's `git add`.

- [ ] **Step 7: Run the task's regression gate**

1. The whole frontend unit suite: `fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^# (tests|pass|fail)'`. Expected: `# fail 0` and `# tests` equal to N0 plus 16 (12 source guards, 3 onboarding, 1 freshness). This run includes `tests/test_auth_isolation_source_guard.js` and `tests/test_epm_shell_source_guards.js`.
2. The Python tests that read `dashboard.jsx`: `env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets tests.test_eng_board_source_guards tests.test_project_packaging tests.test_auth_entry_page`. Expected: `OK`.
3. The extraction gate: `fnm exec --using 20 bash scripts/extraction_lint/run.sh`. Expected: the Task 0 baseline exit status, `0 errors`, a warning count equal to W0 plus 1 (the one `shareView` warning named above), `owner budgets: 0 problems` and `enforced problems: <B>`. Also confirm Task 12's precondition: `rg -n "const shareView = useShareViewApply\(" frontend/src/dashboard.jsx` prints exactly one line.
4. The UI specs that exercise startup, the ENG load, onboarding, recovery and the Board reuse: `npx playwright test tests/ui/onboarding_tour.spec.js tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js tests/ui/dashboard_data_freshness.spec.js tests/ui/shared_department_groups.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/server_unavailable_ui.spec.js --browser=chromium --workers=4 2>&1 | grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)'`. Expected: `535 passed` and no `failed` or `flaky` line (about six minutes; a different total only means an earlier task edited one of these specs, and the requirement is zero failures).
5. Rebuild: `fnm exec --using 20 npm run build`. Expected: `Dashboard built: ` followed by 64 hexadecimal digits. Then `git status --short -- frontend/dist` must print these four entries (the dashboard source changed, so the bundle and its source map change, and the manifest name follows the build id), plus renamed chunk files if esbuild re-hashed any (Global Constraints, Generated output):

```
 M frontend/dist/dashboard.js
 M frontend/dist/dashboard.js.map
 D frontend/dist/lazy-views-<previous build id>.json
?? frontend/dist/lazy-views-<new build id>.json
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/onboarding/useOnboardingTour.js tests/test_share_view_source_guards.js tests/test_share_view_onboarding_wait.js tests/test_dashboard_freshness_interactions.js scripts/extraction_lint/owner_budgets.json
git add -A -- frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Mount the shareable-link apply, hold and tour wait" -m "dashboard.jsx mounts useShareViewApply after the mode state with one flat options object of raw setters and refs, holds the default-scope ENG load while a link is pending (a staged Planning recovery capsule excepted), keys the Planning table so it re-reads the link rows, and makes the Catch Up tour wait for the link (issue 194). Source guards pin the options parity, the hook order, the hold and the forbidden helpers. dashboard.jsx grows by 35 lines, so the manifest's line-count pins and aggregate move up by 35."
git show --stat HEAD
git status --short
make verify-dist-clean
```

Read the results: `git show --stat HEAD` lists the regenerated `frontend/dist` files (Global Constraints, Generated output) and exactly six other paths: `frontend/src/dashboard.jsx` (39 insertions and 4 deletions), `frontend/src/onboarding/useOnboardingTour.js` (5 insertions and 1 deletion), `scripts/extraction_lint/owner_budgets.json` (8 changed lines), `tests/test_dashboard_freshness_interactions.js` (17 insertions and 1 deletion), `tests/test_share_view_onboarding_wait.js` (42 insertions) and `tests/test_share_view_source_guards.js` (145 insertions); check them with `git show --name-only --format= HEAD | rg -v '^frontend/dist/'`. `git status --short` prints nothing. `make verify-dist-clean` prints nothing and exits 0.


---

### Task 11c: Shareable-link UI acceptance spec

**Owner note:** depends on Task 10 (the spec reads the apply event from `window.dataLayer`) and Task 11b (it drives the mounted hook); no later task builds on it, but Task 14's journey A cites it. It adds one test file and changes no source, so there is no `dist` rebuild and no budget move. Task 11 is a checkpoint: this task ends with a report and a stop (Step 13).

**What the spec proves.** Real pages in Chromium, with the real App, the real store, codec, resolver, controller and hook, and a mocked network that records every request. It covers V1, V3, V5, V6 (for a Catch Up recipient and for a recipient who saved a Planning table), V7, V15, V16 and V19 of the design, the focus-miss clause of V4, the Review Focus lines RF1, RF2 and RF3, the Stage D reveal, the Planning rows seed, the three non-Catch-Up modes and when Share is enabled.

| Test | Pins |
| --- | --- |
| a link for another Department and Sprint keeps its fields, Teams and filters through the group-state reset | V5: Stage B and C survive `applyGroupState`; the saved prefs are overwritten by the link, not merged; one `apply_link` event with `result: success` |
| opening the link strips its keys from the URL before Tag Manager is requested | V3: `history.replaceState` runs before the Tag Manager script is appended, and the frame URL at the `gtm.js` request has an empty search |
| a scope-changing link issues no default-scope load and the requests of a manual run pre-seeded to the same state | V6: no task request for the saved scope; the multiset of requests (method, path, sorted parameter names, aborted ones counted) equals a manual run whose Department is pre-seeded through the groups config; both runs load only the link's Department and Sprint |
| a Planning link, and a Catch Up link, for a recipient with a saved Planning table issue the requests of a manual run and never read the review of the saved Sprint | V6 for the Planning review: the hold also covers the review read, so no `GET /api/eng/sprints/<saved Sprint>/review` is issued |
| the link overrides the staged auth and connection recovery capsules | V7: both capsules are consumed and the final view is the link's |
| a recipient whose saved view is EPM, and one whose saved flags are Scenario, end in the link ENG view | V15 and RF2: the one-shot EPM restore does not win; Scenario flags are overwritten |
| a same-scope link skips the scope write but still applies its fields, Teams and facets with one load | RF3: Stage A writes no scope, Stages B and C still apply; one load per lane |
| opening a link performs no mutating request outside the read-only allowlist | V1: zero non-GET requests outside `/api/dependencies`, `/api/stats/*`, `values/read`, `/api/performance/loads` and the session refresh; no preference, onboarding, issue or groups-config write; no link value in an analytics payload |
| the link Department becomes the local favorite in JSON mode and never writes the server favorite in DB mode | V19 |
| a planning, a board and a statistics link apply their mode and fields | each mode lands with its flags and surface (`planning`, `board`, `statistics`) whatever the saved mode |
| a deliberate interaction while the scope loads cancels the link and keeps what was applied | V16: a click ends the link with one `rejected` event; the applied fields stay |
| a terminal auth lock drops the pending link and leaves the lock unchanged | V16 |
| a first-run recipient is held through the Department popup, then the link is dropped and the Catch Up tour waits for it | RF1: nothing loads or reports while the popup is open; after the pick the link drops with one `rejected` event; then the tour starts |
| the Catch Up tour does not auto-start while the link is still applying | RF1 |
| a focus target that exists is revealed and one that does not is reported as partial | Stage D: the Epic block is revealed and the link ends `success`; an absent valid key ends `partial` after the reveal's own 8 s poll, the Teams the link set stay, and no `filter_changed` event is emitted (the V4 clause) |
| a Planning link switches a Planning table that is already open to the rows of the link | the keyed table re-reads the Stage C rows seed |
| a source-only Statistics link for another Department loads no Catch Up tasks for any scope | the hold is released after Stage B, not after Stage A |
| a link equal to the recipient current view writes nothing new and still completes with one load | the identity link |
| Share stays disabled while a link applies and is enabled once the view has settled | the hook's `shareDisabled` and `applyTerminal`, read from the page |
| Share is enabled in a source-only Statistics view, which loads no task list and so never hydrates the Team selection | a saved source-only view and the same view reached by a link: no task request, and Share is enabled |

**Fixture facts the spec relies on:** the shared fixture `tests/ui/epm_home_token_fixture.js` routes `/` with a pattern that never matches a URL with a query, so the spec registers its own route for `/?v=1...`; the fixture reads `frontend/dist/*` when a spec file loads, so a built `frontend/dist` must exist (it is committed); the dashboard bundle itself is built from source in an async `beforeAll`. The Share control is a later task, so the build adds a probe through an esbuild plugin: it wraps the real `useShareViewApply` and publishes its result as `window.__shareViewProbe`, which the two Share tests read; no production file carries a test seam, and the plugin throws if the hook's declaration changes. All data is synthetic: two Departments with their own Teams and an active, a future and a closed Sprint. An Epic key in a link must match the Jira key pattern (`BET-100`, not `BET-EPIC`), or the decoder reports `focus` and no reveal happens. A manual run starts from the link's resolved state, and the Department of a manual run comes from `groupsConfig.preferences.activeGroupId`: the saved prefs alone do not move it.

**Files:**
- Create: `tests/ui/shareable_view_links.spec.js`

**Interfaces:**
- Consumes: the mounted apply (Task 11b), `share_view_action` in `window.dataLayer` (Task 10: `feature_name`, `workflow_action`, `result`, `source_surface`), the real modules of Tasks 3 to 9 and 11a.
- Produces: the executable acceptance evidence for V1, V3, V5, V6, V7, V15, V16, V19, the V4 focus-miss clause, RF1, RF2 and RF3.

**Forbidden regressions for this task:**
- [ ] No source file changes in this task (the negative controls below are reverted before the commit).
- [ ] The spec contains no real identifier: synthetic Department, Team, Sprint and Epic ids only, no real Jira key, URL, email or token; no screenshot is saved.
- [ ] Analytics impact: none (the spec reads the existing event).

- [ ] **Step 0: Preflight**

Run:
```bash
git branch --show-current
git status --short
fnm exec --using 20 npm run build 2>&1 | grep -E 'Dashboard built'
git status --short -- frontend/dist
ls tests/ui/shareable_view_links.spec.js
```
Expected: the branch is `feature/194-shareable-dashboard-view`; `git status --short` prints nothing; the build prints `Dashboard built: ` followed by 64 hexadecimal digits; the second `git status --short` prints nothing (the committed `frontend/dist` is current: if it prints a line, Task 11b's rebuild is stale, so stop and report); `ls` reports `No such file or directory`.

- [ ] **Step 1: Write the spec**

Create `tests/ui/shareable_view_links.spec.js` with exactly this content:

```js
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');
const PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const TEAM_SELECTION_KEY = 'jira_dashboard_team_selection_state_v1';
let dashboardJs;

// The Share control is a later task, so the spec reads the hook result from the page through a build-time probe on the real module:
// the bundle publishes what `useShareViewApply` returns as `window.__shareViewProbe`. No production code carries a test seam.
const HOOK_DECLARATION = 'export function useShareViewApply(options) {';
const shareViewProbe = {
    name: 'share-view-probe',
    setup(build) {
        build.onLoad({ filter: /shareView[\\/]useShareViewApply\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            if (!source.includes(HOOK_DECLARATION)) throw new Error('useShareViewApply is declared differently now: update the probe');
            return {
                contents: `${source.replace(HOOK_DECLARATION, 'function useShareViewApplyOriginal(options) {')}
export function useShareViewApply(options) {
    const result = useShareViewApplyOriginal(options);
    window.__shareViewProbe = result;
    return result;
}
`,
                loader: 'js',
            };
        });
    },
};

test.beforeAll(async () => {
    dashboardJs = (await esbuild.build({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
        plugins: [shareViewProbe],
    })).outputFiles[0].text;
});

// Synthetic data: two Departments with their own Teams, and an active, a future and a closed Sprint.
const SPRINTS = [
    { id: 41, name: 'Sprint 41', state: 'active', startDate: '2026-05-01' },
    { id: 42, name: 'Sprint 42', state: 'future', startDate: '2026-05-15' },
    { id: 40, name: 'Sprint 40', state: 'closed', startDate: '2026-04-15' },
];
const GROUPS = [
    { id: 'grp-a', name: 'Alpha', teamIds: ['team-a1', 'team-a2'] },
    { id: 'grp-b', name: 'Beta', teamIds: ['team-b1', 'team-b2'] },
];
const TEAM_NAMES = { 'team-a1': 'Alpha One', 'team-a2': 'Alpha Two', 'team-b1': 'Beta One', 'team-b2': 'Beta Two' };
const STATUSES = ['To Do', 'In Progress', 'Blocked'];

function storiesFor(groupId, sprintId) {
    const prefix = groupId === 'grp-b' ? 'BET' : 'ALP';
    const teams = GROUPS.find(group => group.id === groupId)?.teamIds || [];
    return STATUSES.flatMap((status, index) => teams.map((teamId, teamIndex) => {
        const number = index * 10 + teamIndex + 1;
        return {
            id: `${prefix}-${number}`, key: `${prefix}-${number}`,
            fields: {
                summary: `${prefix} story ${number}`, status: { name: status }, priority: { name: index === 2 ? 'Blocker' : 'Major' },
                issuetype: { name: 'Story' }, assignee: { displayName: 'Synthetic Owner' }, updated: '2026-05-01T00:00:00.000+0000',
                customfield_10004: 2, epicKey: `${prefix}-100`, parentSummary: `${prefix} delivery epic`, projectKey: prefix,
                teamId, teamName: TEAM_NAMES[teamId], sprint: [{ id: sprintId, name: `Sprint ${sprintId}`, state: 'active' }],
            },
        };
    }));
}

function epicFor(groupId, sprintId) {
    const prefix = groupId === 'grp-b' ? 'BET' : 'ALP';
    return {
        key: `${prefix}-100`, summary: `${prefix} delivery epic`, status: { name: 'In Progress' }, teamId: GROUPS.find(group => group.id === groupId).teamIds[0],
        teamName: TEAM_NAMES[GROUPS.find(group => group.id === groupId).teamIds[0]], sprint: [{ id: sprintId, name: `Sprint ${sprintId}`, state: 'active' }],
    };
}

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

// The shared fixture's `/` route only matches a bare origin, so the link URL gets its own route.
async function installDocumentRoutes(page) {
    await page.route(/https?:\/\/[^/]+\/\?v=[^#]*$/, route => route.fulfill({ status: 200, contentType: 'text/html', body: dashboardHtml }));
}

async function installLinkFixture(page, {
    groupsSource = 'workspace_db', preferences = {}, taskGate = null, taskAuthFailure = false, homeToken = { connected: false },
    prefs = {}, teamSelection = null, analytics = null, capsules = null,
} = {}) {
    const calls = [];
    page.on('requestfailed', (request) => {
        const call = [...calls].reverse().find(candidate => candidate.url === request.url() && !candidate.completed);
        if (call) call.aborted = true;
    });
    // Only the Workspace DB owns personal Department preferences; the JSON source has none.
    const groupsConfig = {
        version: 1, configRevision: 1, source: groupsSource, defaultGroupId: 'grp-a', groups: GROUPS,
        ...(groupsSource === 'workspace_db' ? {
            preferences: {
                onboardingRequired: false, onboardingDone: true, completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
                customized: false, visibleGroupIds: [], effectiveVisibleGroupIds: GROUPS.map(group => group.id), activeGroupId: 'grp-a', ...preferences,
            },
        } : {}),
    };
    await installDashboardShell(page);
    await installDocumentRoutes(page);
    await page.addInitScript(({ prefsKey, teamKey, savedPrefs, savedTeams, savedCapsules }) => {
        if (window.sessionStorage.getItem('share_link_fixture_seeded')) return;
        window.sessionStorage.setItem('share_link_fixture_seeded', 'true');
        window.localStorage.setItem(prefsKey, JSON.stringify(savedPrefs));
        if (savedTeams) window.localStorage.setItem(teamKey, JSON.stringify(savedTeams));
        Object.entries(savedCapsules || {}).forEach(([key, value]) => window.sessionStorage.setItem(key, JSON.stringify(value)));
    }, { prefsKey: PREFS_KEY, teamKey: TEAM_SELECTION_KEY, savedPrefs: { selectedView: 'eng', planningLayout: 'list', selectedSprint: 41, sprintName: 'Sprint 41', activeGroupId: 'grp-a', ...prefs }, savedTeams: teamSelection, savedCapsules: capsules });
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: dashboardJs }));
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const call = {
            method: request.method(), url: request.url(), pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()),
            body: request.method() === 'POST' ? request.postData() : null,
        };
        calls.push(call);
        const reply = (body, status = 200) => { call.completed = true; return json(route, body, status); };
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return reply({ csrfToken: 'csrf-token' });
        if (url.pathname === '/api/auth/status') return reply({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        if (url.pathname === '/api/me/connections/home-token') return reply(homeToken);
        if (url.pathname === '/api/analytics/context') return reply(analytics || { enabled: false });
        if (url.pathname === '/api/config') {
            return reply({
                jiraUrl: 'https://jira.example', capacityProject: '', authMode: 'atlassian_oauth', groupQueryTemplateEnabled: false,
                settingsAdminOnly: false, userCanEditSettings: true, projectsConfigured: true, environmentConfigExists: true,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
                viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: { epm: { version: 2, labelPrefix: '', scope: {}, projects: {} } } },
            });
        }
        if (url.pathname === '/api/version') return reply({ enabled: false });
        if (url.pathname === '/api/groups-config') return reply(groupsConfig);
        if (url.pathname === '/api/projects/selected') return reply({ selected: [] });
        if (url.pathname === '/api/sprints') return reply({ sprints: SPRINTS });
        if (url.pathname === '/api/stats/priority-weights-config') return reply({ weights: [], source: 'test' });
        if (url.pathname === '/api/eng/story-readiness') return reply({ schemaVersion: 1, complete: true, scope: {}, epics: [] });
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose') || '';
            const groupId = url.searchParams.get('groupId');
            const sprintId = Number(url.searchParams.get('sprint'));
            if (taskGate && !purpose) await taskGate.promise;
            if (taskAuthFailure && !purpose) return reply({ error: 'auth_required', loginUrl: '/login?reason=session_expired' }, 401);
            if (project !== 'product' || purpose) return reply({ issues: [], epics: {}, epicsInScope: [], names: {} });
            const epic = epicFor(groupId, sprintId);
            return reply({ issues: storiesFor(groupId, sprintId), epics: { [epic.key]: epic }, epicsInScope: [epic], names: {} });
        }
        if (url.pathname === '/api/missing-info') return reply({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return reply({ epics: [] });
        if (url.pathname === '/api/capacity') return reply({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return reply({ dependencies: {} });
        if (url.pathname === '/api/issues/subtasks') return reply({ parentKey: '', sprint: '', cached: false, summary: null, subtasks: [] });
        return reply({});
    });
    return calls;
}

// Reads that use POST, plus the session refresh every load sends; none of them writes a view.
const READ_ONLY_POSTS = new Set(['/api/dependencies', '/api/performance/loads', '/api/auth/refresh']);
const isReadOnlyPost = call => READ_ONLY_POSTS.has(call.pathname) || call.pathname.startsWith('/api/stats/') || /\/values\/read$/.test(call.pathname);
const mutatingCalls = calls => calls.filter(call => call.method !== 'GET' && !isReadOnlyPost(call));
const signature = call => `${call.method} ${call.pathname}?${Object.keys(call.params).sort().join('&')}${call.aborted ? ' aborted' : ''}`;
const apiSignatures = calls => calls.map(signature).sort();
const taskCalls = calls => calls.filter(call => call.pathname === '/api/tasks-with-team-name' && !call.params.purpose);

const readPrefs = page => page.evaluate(key => JSON.parse(window.localStorage.getItem(key) || '{}'), PREFS_KEY);
const engMode = (page, name) => page.locator('.view-selector .eng-mode-control').getByRole('radio', { name });
const teamLabel = page => page.locator('.view-selector .team-dropdown').first().locator('.team-dropdown-selection-label');
// Lead Times quarters are validated against a window that ends at the current quarter, so the test derives its own.
const quarterLabel = (offset = 0) => {
    const now = new Date();
    const index = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) + offset;
    return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
};
const groupToggle = page => page.locator('.group-dropdown-toggle').first();
const sprintToggle = page => page.locator('.sprint-dropdown').first().locator('.sprint-dropdown-toggle');
const settled = (page, calls) => expect.poll(() => calls.some(call => call.pathname === '/api/missing-info')).toBe(true);

// A link keeps its own query out of analytics; the apply event is the only evidence of its terminal state.
const applyEvents = page => page.evaluate(() => (window.dataLayer || []).filter(entry => entry && entry.event_name === 'share_view_action'));
const ANALYTICS_ENABLED = { enabled: true, measurementId: 'G-SYNTHETIC', ga4UserId: 'synthetic-user', debugMode: false };

const FULL_LINK = '/?v=1&mode=catch-up&group=grp-b&sprint=42&teams=team-b1&find=story&status=only:In%20Progress,Blocked&lanes=product&sort=status&alerts=blocked';

test('a link for another Department and Sprint keeps its fields, Teams and filters through the group-state reset (V5)', async ({ page }) => {
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED,
        prefs: { searchQuery: 'saved search', showProduct: false, showTech: true, showMissingAlert: false, engEpicSort: 'priority', selectedTeams: ['team-a1'], engStatusFilter: { only: ['To Do'] } },
        teamSelection: { 'team-selection::42::grp-b': { selectedTeams: ['team-b2'], selectedTeamId: 'team-b2' } },
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    expect(page.url()).toBe(`${appBaseUrl}/`);
    await expect(page.getByRole('textbox', { name: 'Search tickets...' })).toHaveValue('story');
    await expect(teamLabel(page)).toHaveText('Beta One');
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    const prefs = await readPrefs(page);
    expect(prefs).toMatchObject({
        activeGroupId: 'grp-b', selectedSprint: 42, sprintName: 'Sprint 42', searchQuery: 'story', selectedTeams: ['team-b1'],
        engStatusFilter: { only: ['In Progress', 'Blocked'] }, showProduct: true, showTech: false, engEpicSort: 'status',
        showBlockedAlert: true, showMissingAlert: false, showPlanning: false, showStats: false, showScenario: false, showBoard: false,
    });
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
    expect((await applyEvents(page))[0]).toMatchObject({ workflow_action: 'apply_link', result: 'success', source_surface: 'catch_up' });
});


test('opening the link strips its keys from the URL before Tag Manager is requested (V3)', async ({ page }) => {
    await installLinkFixture(page, { analytics: { ...ANALYTICS_ENABLED, gtmContainerId: 'GTM-NZJW2CFN' } });
    await page.addInitScript(() => {
        window.__shareOrder = [];
        const replaceState = History.prototype.replaceState;
        History.prototype.replaceState = function patchedReplaceState(...args) {
            window.__shareOrder.push('replaceState');
            return replaceState.apply(this, args);
        };
        const appendChild = Node.prototype.appendChild;
        Node.prototype.appendChild = function patchedAppendChild(node) {
            if (node && node.tagName === 'SCRIPT' && node.dataset && node.dataset.analyticsGtm) window.__shareOrder.push('gtm');
            return appendChild.call(this, node);
        };
    });
    const gtmFrameUrls = [];
    await page.route('https://www.googletagmanager.com/gtm.js?id=GTM-NZJW2CFN', (route) => {
        gtmFrameUrls.push(route.request().frame().url());
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => gtmFrameUrls.length).toBe(1);
    const order = await page.evaluate(() => window.__shareOrder);
    expect(order.indexOf('replaceState')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('replaceState')).toBeLessThan(order.indexOf('gtm'));
    expect(new URL(gtmFrameUrls[0]).search).toBe('');
});

// A manual run starts from the link's resolved state. The Department comes from the groups config (the saved prefs alone do not move it);
// the Sprint, the mode flags and the fields come from the saved prefs.
const MANUAL_DEPARTMENT_B = { preferences: { activeGroupId: 'grp-b' } };
const MANUAL_SCOPE_B42 = { activeGroupId: 'grp-b', selectedSprint: 42, sprintName: 'Sprint 42' };
const reviewCalls = calls => calls.filter(call => /\/api\/eng\/sprints\/[^/]+\/review$/.test(call.pathname));

async function loadRun(browser, setup, entry) {
    const page = await browser.newPage();
    const calls = await installLinkFixture(page, setup);
    await page.goto(`${appBaseUrl}${entry}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return { page, calls };
}

test('a scope-changing link issues no default-scope load and the requests of a manual run pre-seeded to the same state (V6)', async ({ browser }) => {
    const link = await loadRun(browser, { prefs: { engEpicSort: 'priority' } }, FULL_LINK);
    const manual = await loadRun(browser, {
        ...MANUAL_DEPARTMENT_B,
        prefs: {
            ...MANUAL_SCOPE_B42, searchQuery: 'story', selectedTeams: ['team-b1'], showProduct: true, showTech: false,
            engEpicSort: 'status', engStatusFilter: { only: ['In Progress', 'Blocked'] }, showBlockedAlert: true,
        },
        teamSelection: { 'team-selection::42::grp-b': { selectedTeams: ['team-b1'], selectedTeamId: 'team-b1' } },
    }, '/');
    for (const run of [link, manual]) {
        expect(taskCalls(run.calls).length).toBeGreaterThan(0);
        expect(taskCalls(run.calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
    }
    expect(link.calls.some(call => call.params.groupId === 'grp-a' || call.params.sprint === '41')).toBe(false);
    expect(apiSignatures(link.calls)).toEqual(apiSignatures(manual.calls));
    await link.page.close();
    await manual.page.close();
});

// The Planning review reads the review schema for the Sprint it is mounted on, so the hold covers it too: a recipient who saved a Planning
// table never reads the review of the saved Sprint, and a Catch Up link never reads one at all.
for (const [title, entry, manualFlags] of [
    ['a Planning link', '/?v=1&mode=planning&group=grp-b&sprint=42', { showPlanning: true }],
    ['a Catch Up link', '/?v=1&mode=catch-up&group=grp-b&sprint=42', { showPlanning: false }],
]) {
    test(`${title} for a recipient with a saved Planning table issues the requests of a manual run and never reads the review of the saved Sprint (V6)`, async ({ browser }) => {
        const saved = { showPlanning: true, planningLayout: 'table' };
        const link = await loadRun(browser, { prefs: saved }, entry);
        const manual = await loadRun(browser, { ...MANUAL_DEPARTMENT_B, prefs: { ...MANUAL_SCOPE_B42, ...saved, ...manualFlags } }, '/');
        for (const run of [link, manual]) expect(taskCalls(run.calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
        expect(link.calls.some(call => call.params.groupId === 'grp-a' || call.params.sprint === '41' || call.pathname.includes('/sprints/41/'))).toBe(false);
        expect(reviewCalls(link.calls).map(call => call.pathname)).toEqual(reviewCalls(manual.calls).map(call => call.pathname));
        expect(apiSignatures(link.calls)).toEqual(apiSignatures(manual.calls));
        await link.page.close();
        await manual.page.close();
    });
}

test('the link overrides the staged auth and connection recovery capsules (V7)', async ({ page }) => {
    const capturedAt = Date.now();
    const principal = { workspaceId: 'workspace-test', viewConfigId: 'view-test' };
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED,
        capsules: {
            jira_dashboard_auth_resume_v1: {
                version: 1, capturedAt, principal,
                view: { selectedView: 'eng', activeGroupId: 'grp-a', selectedSprint: '41', engMode: 'catch-up', settingsOpen: false, settingsTab: 'teams' },
                planning: { scopeKey: 'planning::41::grp-a', selectedTaskKeys: [], selectedTeams: ['all'], selectionMode: 'manual' },
            },
            jira_dashboard_connection_recovery_v1: {
                version: 1, capturedAt, principal, outage: { id: 'outage-1' }, droppedSettings: false, scenario: null,
                view: { selectedView: 'eng', activeGroupId: 'grp-a', selectedSprint: '41', engMode: 'catch-up', scrollX: 0, scrollY: 0 },
            },
        },
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(groupToggle(page)).toContainText('Beta');
    await expect(sprintToggle(page)).toContainText('Sprint 42');
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, searchQuery: 'story' });
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_auth_resume_v1'))).toBe(null);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('jira_dashboard_connection_recovery_v1'))).toBe(null);
    expect((await applyEvents(page))[0].result).toBe('success');
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-b' && call.params.sprint === '42')).toBe(true);
});

test('a recipient whose saved view is EPM, and one whose saved flags are Scenario, end in the link ENG view (V15, RF2)', async ({ page }) => {
    const activeHomeToken = { connected: true, provider: 'atlassian_user_api_token', credentialSubject: 'profile@example.com', status: 'active', lastValidatedAt: '2026-05-11T09:00:00Z', needsReconnect: false };
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, homeToken: activeHomeToken, prefs: { selectedView: 'epm', showScenario: true } });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    await expect(groupToggle(page)).toContainText('Beta');
    await page.waitForTimeout(1500);
    await expect(engMode(page, 'Catch Up')).toHaveAttribute('aria-checked', 'true');
    expect(await readPrefs(page)).toMatchObject({ selectedView: 'eng', showScenario: false, showPlanning: false, showStats: false, showBoard: false, activeGroupId: 'grp-b' });
});

test('a same-scope link skips the scope write but still applies its fields, Teams and facets with one load (RF3)', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { selectedTeams: ['team-a2'], engStatusFilter: { only: ['To Do'] }, showTech: false } });
    await page.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-a&sprint=41&teams=team-a1&find=story&status=only:Blocked`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(teamLabel(page)).toHaveText('Alpha One');
    await expect(page.getByRole('textbox', { name: 'Search tickets...' })).toHaveValue('story');
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-a', selectedSprint: 41, selectedTeams: ['team-a1'], engStatusFilter: { only: ['Blocked'] }, showTech: true });
    expect(taskCalls(calls).filter(call => call.params.groupId === 'grp-a' && call.params.sprint === '41').length).toBe(2);
    expect(calls.filter(call => call.pathname === '/api/sprints')).toHaveLength(1);
    expect((await applyEvents(page))[0].result).toBe('success');
});

test('opening a link performs no mutating request outside the read-only allowlist, and reaches no preference or write route (V1)', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await settled(page, calls);
    await page.waitForLoadState('networkidle');
    expect(mutatingCalls(calls)).toEqual([]);
    expect(calls.filter(call => call.pathname === '/api/groups-preferences' || call.pathname.startsWith('/api/me/onboarding')
        || call.pathname.startsWith('/api/issues/') || (call.pathname === '/api/groups-config' && call.method !== 'GET'))).toEqual([]);
    const serialized = JSON.stringify(await applyEvents(page));
    expect(serialized).not.toMatch(/grp-b|team-b1|story|BET-|Beta/);
});

test('the link Department becomes the local favorite in JSON mode and never writes the server favorite in DB mode (V19)', async ({ browser }) => {
    const jsonPage = await browser.newPage();
    const jsonCalls = await installLinkFixture(jsonPage, { groupsSource: 'jsonfile', analytics: ANALYTICS_ENABLED });
    await jsonPage.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(jsonPage).then(events => events.length)).toBe(1);
    await expect.poll(async () => (await readPrefs(jsonPage)).groupVisibilityPreferences?.activeGroupId).toBe('grp-b');
    expect(jsonCalls.filter(call => call.pathname === '/api/groups-preferences')).toEqual([]);

    const dbPage = await browser.newPage();
    const dbCalls = await installLinkFixture(dbPage, { groupsSource: 'workspace_db', analytics: ANALYTICS_ENABLED });
    await dbPage.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(dbPage).then(events => events.length)).toBe(1);
    await expect(groupToggle(dbPage)).toContainText('Beta');
    await dbPage.waitForLoadState('networkidle');
    expect(dbCalls.filter(call => call.pathname === '/api/groups-preferences')).toEqual([]);
    expect((await readPrefs(dbPage)).groupVisibilityPreferences?.activeGroupId).toBe('grp-a');
    await jsonPage.close();
    await dbPage.close();
});

for (const [mode, query, radio, flags] of [
    ['planning', 'mode=planning&group=grp-b&sprint=42&layout=table', 'Planning', { showPlanning: true, planningLayout: 'table' }],
    ['board', 'mode=board&group=grp-a&sprint=41&find=story', 'Board', { showBoard: true, searchQuery: 'story' }],
    ['statistics', `mode=statistics&group=grp-a&sprint=41&stats=cohort&from=${quarterLabel(-1)}&to=${quarterLabel(0)}`, 'Statistics', { showStats: true, statsView: 'cohort', cohortStartQuarter: quarterLabel(-1), cohortEndQuarter: quarterLabel(0) }],
]) {
    test(`a ${mode} link applies its mode and fields whatever the recipient's saved mode`, async ({ page }) => {
        await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { showScenario: true } });
        await page.goto(`${appBaseUrl}/?v=1&${query}`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
        await expect(engMode(page, radio)).toHaveAttribute('aria-checked', 'true');
        expect(await readPrefs(page)).toMatchObject({ showScenario: false, ...flags });
        expect((await applyEvents(page))[0]).toMatchObject({ result: 'success', source_surface: mode });
    });
}

test('a deliberate interaction while the scope loads cancels the link and keeps what was applied (V16)', async ({ page }) => {
    const taskGate = deferred();
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, taskGate, prefs: { engStatusFilter: { only: ['To Do'] } } });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    await expect.poll(async () => (await readPrefs(page)).searchQuery).toBe('story');
    await page.mouse.click(2, 2);
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['rejected']);
    taskGate.resolve();
    await settled(page, calls);
    await page.waitForLoadState('networkidle');
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, engStatusFilter: { only: ['To Do'] } });
    expect(await applyEvents(page)).toHaveLength(1);
});

test('a terminal auth lock drops the pending link and leaves the lock unchanged (V16)', async ({ page }) => {
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, taskAuthFailure: true });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['rejected']);
    await expect(page.getByRole('alertdialog', { name: 'Sign in required' })).toBeVisible();
});

test('a first-run recipient is held through the Department popup, then the link is dropped and the Catch Up tour waits for it (RF1, V16)', async ({ page }) => {
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED,
        preferences: { onboardingRequired: true, onboardingDone: false, completedOnboardingModules: [], effectiveVisibleGroupIds: [], activeGroupId: null },
    });
    await page.route('**/api/groups-preferences', async (route) => {
        const body = route.request().postDataJSON() || {};
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: false, completedOnboardingModules: [], visibleGroupIds: body.visibleGroupIds, activeGroupId: body.activeGroupId, effectiveVisibleGroupIds: body.visibleGroupIds },
                groupsConfigSnapshot: {
                    version: 1, configRevision: 1, source: 'workspace_db', defaultGroupId: 'grp-a', groups: GROUPS,
                    preferences: { customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: false, completedOnboardingModules: [], visibleGroupIds: body.visibleGroupIds, activeGroupId: body.activeGroupId, effectiveVisibleGroupIds: body.visibleGroupIds },
                },
            }),
        });
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    const picker = page.getByRole('dialog', { name: 'Choose your Department' });
    await expect(picker).toBeVisible();
    await page.waitForTimeout(1000);
    expect(taskCalls(calls)).toEqual([]);
    expect(await applyEvents(page)).toEqual([]);
    await picker.getByRole('radio', { name: /Alpha/ }).check();
    await picker.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['rejected']);
    await expect(groupToggle(page)).toHaveCount(0);
    expect(taskCalls(calls).every(call => call.params.groupId === 'grp-a')).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toBeVisible();
});

test('the Catch Up tour does not auto-start while the link is still applying (RF1)', async ({ page }) => {
    const taskGate = deferred();
    const calls = await installLinkFixture(page, {
        analytics: ANALYTICS_ENABLED, taskGate,
        preferences: { onboardingDone: false, completedOnboardingModules: [] },
    });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await applyEvents(page)).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toHaveCount(0);
    taskGate.resolve();
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect(page.getByRole('dialog', { name: 'Choose a sprint' })).toBeVisible();
});

test('a focus target that exists is revealed and one that does not is reported as partial (Stage D)', async ({ browser }) => {
    const found = await browser.newPage();
    await installLinkFixture(found, { analytics: ANALYTICS_ENABLED });
    await found.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-b&sprint=42&epic=BET-100`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(found).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(found.locator('.epic-block[data-epic-key="BET-100"]')).toBeVisible();

    const missing = await browser.newPage();
    await installLinkFixture(missing, { analytics: ANALYTICS_ENABLED });
    await missing.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-b&sprint=42&teams=team-b1&epic=BET-999`, { waitUntil: 'domcontentloaded' });
    // The reveal polls for a mounted target for up to eight seconds before it reports a miss.
    await expect.poll(() => applyEvents(missing).then(events => events.map(event => event.result)), { timeout: 20000 }).toEqual(['partial']);
    expect(await readPrefs(missing)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 42, selectedTeams: ['team-b1'] });
    await expect(teamLabel(missing)).toHaveText('Beta One');
    // A miss never opens Jira and never clears a filter: no filter event is emitted and the Teams stay as the link set them (V4).
    expect(await missing.evaluate(() => (window.dataLayer || []).filter(entry => entry && entry.event_name === 'filter_changed'))).toEqual([]);
    await found.close();
    await missing.close();
});

test('a Planning link switches a Planning table that is already open to the rows of the link', async ({ page }) => {
    await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, prefs: { showPlanning: true, planningLayout: 'table' } });
    await page.goto(`${appBaseUrl}/?v=1&mode=planning&group=grp-a&sprint=41&rows=stories`, { waitUntil: 'domcontentloaded' });
    const rows = page.locator('[aria-label="Planning review rows"]');
    await expect(rows).toBeVisible();
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(rows.getByRole('radio', { name: 'Stories' })).toHaveAttribute('aria-checked', 'true');
    await expect(rows.getByRole('radio', { name: 'Epics' })).toHaveAttribute('aria-checked', 'false');
});

test('a source-only Statistics link for another Department loads no Catch Up tasks for any scope', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED });
    await page.goto(`${appBaseUrl}/?v=1&mode=statistics&group=grp-b&sprint=41&stats=projectTrack&from=41&to=41`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect(engMode(page, 'Statistics')).toHaveAttribute('aria-checked', 'true');
    await page.waitForLoadState('networkidle');
    expect(taskCalls(calls)).toEqual([]);
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-b', selectedSprint: 41, showStats: true, statsView: 'projectTrack', excludedCapacityStartSprintId: '41', excludedCapacityEndSprintId: '41' });
});

test('a link equal to the recipient current view writes nothing new and still completes with one load', async ({ page }) => {
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED });
    await page.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=grp-a&sprint=41`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(page).then(events => events.map(event => event.result))).toEqual(['success']);
    await settled(page, calls);
    expect(taskCalls(calls).filter(call => call.params.groupId === 'grp-a' && call.params.sprint === '41')).toHaveLength(2);
    expect(await readPrefs(page)).toMatchObject({ activeGroupId: 'grp-a', selectedSprint: 41, searchQuery: '', showPlanning: false });
});

const shareState = page => page.evaluate(() => (window.__shareViewProbe ? { disabled: window.__shareViewProbe.shareDisabled, terminal: window.__shareViewProbe.applyTerminal } : null));

test('Share stays disabled while a link applies and is enabled once the view has settled', async ({ page }) => {
    const taskGate = deferred();
    const calls = await installLinkFixture(page, { analytics: ANALYTICS_ENABLED, taskGate });
    await page.goto(`${appBaseUrl}${FULL_LINK}`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => taskCalls(calls).length).toBeGreaterThan(0);
    expect(await shareState(page)).toEqual({ disabled: true, terminal: false });
    taskGate.resolve();
    await expect.poll(() => applyEvents(page).then(events => events.length)).toBe(1);
    await expect.poll(() => shareState(page)).toEqual({ disabled: false, terminal: true });
});

test('Share is enabled in a source-only Statistics view, which loads no task list and so never hydrates the Team selection', async ({ browser }) => {
    const saved = await browser.newPage();
    const savedCalls = await installLinkFixture(saved, { prefs: { showStats: true, statsView: 'projectTrack', excludedCapacityStartSprintId: '41', excludedCapacityEndSprintId: '41' } });
    await saved.goto(`${appBaseUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(engMode(saved, 'Statistics')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => shareState(saved)).toEqual({ disabled: false, terminal: true });
    expect(taskCalls(savedCalls)).toEqual([]);

    const linked = await browser.newPage();
    const linkedCalls = await installLinkFixture(linked, { analytics: ANALYTICS_ENABLED });
    await linked.goto(`${appBaseUrl}/?v=1&mode=statistics&group=grp-b&sprint=41&stats=projectTrack&from=41&to=41`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => applyEvents(linked).then(events => events.map(event => event.result))).toEqual(['success']);
    await expect.poll(() => shareState(linked)).toEqual({ disabled: false, terminal: true });
    expect(taskCalls(linkedCalls)).toEqual([]);
    await saved.close();
    await linked.close();
});
```

- [ ] **Step 2: Run it and confirm it passes**

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`

Expected: `23 passed` (about one minute) and no numbered failure line. The spec needs no running server and no `JEP_TEST_PYTHON`: every request is answered by the fixture. If one test fails, read its error context under `test-results/` and fix the cause in the code under test, never in the assertion; if the cause is in a sibling task's module, report it against that task.

- [ ] **Step 3: Negative control 1: no hold**

Prove the spec bites. Apply this edit to `frontend/src/dashboard.jsx` (the ENG task-load effect), run the whole spec, then revert:

Replace this:

```js
                if (shareViewHold && !pendingPlanningAuthResumeRef.current) {
```

with:

```js
                if (false && shareViewHold && !pendingPlanningAuthResumeRef.current) {
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_source_guards.js tests/test_dashboard_freshness_interactions.js 2>&1 | grep -E '^# (pass|fail)'`, then `git checkout -- frontend/src/dashboard.jsx`.

Expected before the revert: `9 failed` and `14 passed`. The failures are the V5 test, the V6 test, both Planning-table V6 tests, the V7 test, the RF3 test, the source-only Statistics test, the identity-link test and the source-only Share test: with no hold the recipient's saved scope loads first. The unit counterparts report `# fail 2`.

- [ ] **Step 4: Negative control 2: the hold released with Stage A**

Apply this edit to `frontend/src/shareView/applyMachine.js` (the Stage A branch):

Replace this:

```js
        actions.push({ type: 'run', stage: 'A', scopeChange: state.scopeChange });
        return { state, actions };
```

with:

```js
        actions.push({ type: 'run', stage: 'A', scopeChange: state.scopeChange });
        actions.push({ type: 'releaseHold' });
        return { state, actions };
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_apply_machine.js 2>&1 | grep -E '^# (pass|fail)'`, then `git checkout -- frontend/src/shareView/applyMachine.js`.

Expected before the revert: `3 failed` and `20 passed`: `a Catch Up link for a recipient with a saved Planning table ...`, `a source-only Statistics link for another Department loads no Catch Up tasks for any scope` and `Share is enabled in a source-only Statistics view ...` (between Stage A and Stage B's commit the App still carries the recipient's saved flags, so the released hold starts a load that the link's mode never needs), and the machine file reports `# fail 21`.

- [ ] **Step 5: Negative control 3: the Planning table is not keyed**

Apply this edit to `frontend/src/dashboard.jsx` (the Planning table element):

Replace this:

```js
<PlanningReviewTable key={shareViewPlanningTableKey} toolbarHost=
```

with:

```js
<PlanningReviewTable toolbarHost=
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium -g 'Planning table that is already open' 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_source_guards.js 2>&1 | grep -E '^# (pass|fail)'`, then `git checkout -- frontend/src/dashboard.jsx`.

Expected before the revert: the one UI test fails (the open table stays on Epics, so the Stories radio is not checked) and the source guards report one failure (`the early link hooks precede both of their consumers and the Catch Up tour waits for the link`).

- [ ] **Step 6: Negative control 4: the Planning rows seeded at Stage B**

Apply both edits to `frontend/src/shareView/applyController.js`: remove the Stage C seed and seed in Stage B instead.

Replace this:

```js
        if (action.stage === 'C' && planningRows) { setPendingPlanningRowMode(planningRows); planningRows = null; }
```

with:

```js

```

Replace this:

```js
    if (has(apply, 'stats')) o.setStatsView(apply.stats);
```

with:

```js
    if (has(apply, 'rows')) setPendingPlanningRowMode(apply.rows);
    if (has(apply, 'stats')) o.setStatsView(apply.stats);
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium -g 'Planning table that is already open' 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_apply_controller.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`, then `git checkout -- frontend/src/shareView/applyController.js`.

Expected before the revert: the UI test fails (the first ENG load after the hold unmounts the table and the next mount finds the seed already taken) and the controller test `the Planning rows are seeded once, when Stage C begins after the scope has loaded: the first load unmounts the table` fails.

- [ ] **Step 7: Negative control 5: the Catch Up tour does not wait**

Apply this edit to `frontend/src/onboarding/useOnboardingTour.js` (`shouldAutomaticallyStartOnboarding`):

Replace this:

```js
        && applyTerminal
```

with:

```js

```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium -g 'tour does not auto-start while the link' 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_onboarding_wait.js tests/test_share_view_source_guards.js 2>&1 | grep -E '^# (pass|fail)'`, then `git checkout -- frontend/src/onboarding/useOnboardingTour.js`.

Expected before the revert: the UI test fails (the sprint dialog of the tour opens while the link is still applying) and the unit files report two failures.

- [ ] **Step 8: Negative control 6: every interaction counts as scrolling**

Apply this edit to `frontend/src/shareView/interactionGuard.js` (the handler):

Replace this:

```js
        onInteraction(DELIBERATE_EVENTS.includes(event.type) ? 'deliberate' : 'scroll');
```

with:

```js
        onInteraction('scroll');
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium -g 'deliberate interaction while the scope loads' 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_interaction_guard.js tests/test_share_view_apply_hook.js 2>&1 | grep -E '^# (pass|fail)'`, then `git checkout -- frontend/src/shareView/interactionGuard.js`.

Expected before the revert: the UI test fails (the click no longer cancels the link, so no `rejected` event arrives) and the unit files report four failures.

- [ ] **Step 9: Negative control 7: Share waits for a Team hydrate in every view**

Apply this edit to `frontend/src/shareView/useShareViewApply.js` (`isShareDisabled`):

Replace this:

```js
    || !o.teamSelectionScopeKey || (o.engLoadsTasks && o.teamSelectionHydratedScopeRef.current !== o.teamSelectionScopeKey)
```

with:

```js
    || !o.teamSelectionScopeKey || o.teamSelectionHydratedScopeRef.current !== o.teamSelectionScopeKey
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium -g 'Share is enabled in a source-only' 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_apply_hook.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`, then `git checkout -- frontend/src/shareView/useShareViewApply.js`.

Expected before the revert: the UI test fails (a source-only Statistics view never hydrates the Team selection, so Share stays disabled) and the hook test `the Share control is disabled until the scope is settled, whatever the blocker` fails.

- [ ] **Step 10: Negative control 8: the Planning review is not held**

Apply this edit to `frontend/src/dashboard.jsx` (the `usePlanningSprintReview` call):

Replace this:

```js
                sprintId: selectedSprint, active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured && !shareViewHold,
```

with:

```js
                sprintId: selectedSprint, active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured,
```

Run: `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium -g 'recipient with a saved Planning table' 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'`, then `fnm exec --using 20 node --test tests/test_share_view_source_guards.js 2>&1 | grep -E '^not ok|^# (pass|fail)'`, then `git checkout -- frontend/src/dashboard.jsx`.

Expected before the revert: both Planning-table V6 tests fail (the review of the saved Sprint is read during the link run only) and the source guard `the Planning review read holds with the link, so it never reads the review of the recipient saved Sprint` fails.

- [ ] **Step 11: Confirm the reverts and rerun the spec**

Run:
```bash
git status --short
npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium 2>&1 | grep -E '^ +[0-9]+\) |^ +[0-9]+ (passed|failed|flaky|skipped)'
```
Expected: `git status --short` prints exactly `?? tests/ui/shareable_view_links.spec.js` (every negative control was reverted); the spec reports `23 passed`.

- [ ] **Step 12: Commit**

```bash
git add tests/ui/shareable_view_links.spec.js
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add the shareable-link UI acceptance spec" -m "Real-page acceptance for the staged apply (issue 194): the group-state reset cannot undo a link, the hold avoids the default-scope load and the Planning review read so the request set equals a manual run, recovery capsules and the one-shot EPM restore yield to the link, no mutating request is issued, the first-run popup pauses the link and the Catch Up tour waits for it, interactions and the auth lock end it, the reveal and the Planning rows seed work, a focus miss changes no filter, Share is enabled in every settled view, and the strip-before-Tag-Manager order holds."
git show --stat HEAD
git status --short
```

Read the results: `git show --stat HEAD` lists exactly one path, `tests/ui/shareable_view_links.spec.js`, and `git status --short` prints nothing. No `frontend/dist` change is expected (the commit changes no file under `frontend/src`).

- [ ] **Step 13: Checkpoint (stop here)**

Report to the operator: the SHAs of Tasks 11a, 11b and 11c, the files of each, the results (the Node counts, `23 passed` for the spec, the passed count of Task 11b's regression run, the lint warning count, and that the eight negative controls each failed the intended tests), the budget moves (`dashboard.jsx` plus 35 lines in Task 11b, 7,505 to 7,540 on the validated base) and any deviation from this plan. Then ask the operator to validate the live behavior by hand and stop until they confirm. The Share control does not exist before Task 12, so the check uses a typed link:
1. In a signed-in dashboard open the browser's network panel and note one Department id (`/api/groups-config`) and one Sprint id (`/api/sprints`); ids only.
2. Open `<origin>/?v=1&mode=catch-up&group=<id>&sprint=<id>` in a new tab. The address bar shows plain `/` as soon as the page paints; the view lands on that Department and Sprint, and the first task request in the network panel already carries that Department and Sprint (the saved scope never loads).
3. Add `&find=<text>` and `&status=only:<one status name>`: the search box shows the text and the status filter is applied. Try `&mode=planning` and `&mode=board`.
4. Press a key while the page is still loading: the link stops applying and nothing already applied is undone.
5. Use an unknown group id: nothing changes (the notice itself arrives with Task 12).
Live checks are read-only and transient: you sign in yourself, report numbers only (the mode, counts of visible Epics and Stories), and save or publish no screenshot of live data.


---

## Notes for the executor

Settled decisions for this slice; none changes a binding name in the master.

1. Task 6 measures plus 11 lines (`dashboard.jsx` 7,494 to 7,505 on the validated base; manifest pins 7,505 and 34,107). The extraction stays: the alternative is a second implementation of about 25 lines inside `shareView/`. This is design Open item 6.
2. The hold is released one commit after Stage B (design refinement 1). It gates the ENG task load and the Planning review read (the `active` expression of `usePlanningSprintReview` gains `&& !shareViewHold`, net zero lines) and does not apply while a staged Planning recovery capsule is pending (`pendingPlanningAuthResumeRef` clears only after the ENG load).
3. Share is disabled until the Team hydrate has reached the scope key only when the ENG load runs tasks (`engLoadsTasks`); source-only Statistics views and strict Board never hydrate Teams. The interaction guard's modifier-key list is exported as `SHARE_VIEW_MODIFIER_KEYS` and is the single list (Task 8's reveal copies it with a comment, because Task 8 runs first); the controller passes the reveal an `isCancelled` that also covers a pending guard interrupt and the auth latch.
4. The overall 90 s budget ends `partial` when stages ran; a Stage A timeout drops the link (its 5 s window opens when the readiness gate first opens); drops before the start name no category.
5. The Planning rows seed is written at the first Stage C run and `useShareViewPlanningTableKey()` flips with it. The hook module also exports `useShareViewApplyTerminal()` (the onboarding controller is declared before `useEngModeState`, where `shareView` cannot yet exist) and `useShareViewPlanningTableKey()`. The hook result keeps exactly `{ notice, dismissNotice, captureShareUrl, shareDisabled, applyTerminal }` for Task 12.
6. Task 11b leaves one transient lint warning (`shareView` is unused until Task 12 renders the control): 105 against the ratchet of 106, back to 104 after Task 12. After Tasks 6 and 11b `dashboard.jsx` is 7,540 lines on the validated base (`appPlusOwners` 34,142); Task 12 adds 7.
7. The V1 read allowlist in the UI spec includes `POST /api/auth/refresh`. `persistTeamSelection` is the persistence pair (selection store and hydrated-selection marker); `setSelectedTeams` stays at the call sites.
8. The Sprint catalog goes to the resolver unchanged: its start dates order a Sprint range chronologically (a name-only shape sorted `Sprint 10` before `Sprint 9`).
9. Commands: lint is `fnm exec --using 20 bash scripts/extraction_lint/run.sh` with `JEP_TEST_PYTHON` exported (the script is not executable and its budget step reads that variable); filter Playwright result lines with `grep -E '^ +[0-9]+ (passed|failed|flaky|skipped)'` because several spec titles contain those words; the UI specs read `frontend/dist/*`, so a built, committed `frontend/dist` must exist.
10. Accepted limits: the hold covers the ENG task load and the Planning review read only (a source-only Statistics link fetches its own source, a strict Board link runs the Board pipeline once); Stage D starts only in a visible document; a Stage C timeout remounts an open Planning table to its default rows once; a reload before the apply completes drops the link; a second tab can overwrite what a link persisted.
11. Checkpoints: after Task 6 and after Task 11c, report the SHAs, files, results and a concrete manual validation scope, then stop until the operator confirms.
