const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendSrcPath = path.join(__dirname, '..', 'frontend', 'src');
const read = (...segments) => fs.readFileSync(path.join(frontendSrcPath, ...segments), 'utf8');

function listSourceFiles(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listSourceFiles(fullPath);
        return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [fullPath] : [];
    });
}

test('per-epic refresh code never re-arms alerts, reloads the group, or flips loading state', () => {
    const forbidden = [
        'rearmCatchUpAlerts', 'loadGroupTasks', 'applyLocalEngIssueField', 'localStorage',
        'setLoading(', 'setProductTasksLoading', 'setTechTasksLoading', 'startTransition',
    ];
    for (const file of ['useEpicRefresh.js', 'epicRefreshController.js', 'epicRefreshPatch.js']) {
        const source = read('eng', file);
        for (const token of forbidden) {
            assert.equal(source.includes(token), false, `${file} must not contain ${token}`);
        }
    }
});

test('leaving cards are scheduled from the updater merge and focus is rescued after the dissolve drop', () => {
    const source = read('eng', 'useEpicRefresh.js');
    assert.equal(source.includes('update.removedKeys'), false, 'drop timers must come from the updater merge, not the precomputed list');
    assert.match(source, /merged\.removedKeys\.forEach\(key => leavingSink\.add\(key\)\)/);
    const timerStart = source.indexOf('window.setTimeout(() => {\n                timersRef.current.delete(timer)');
    assert.ok(timerStart > -1, 'drop timer callback not found');
    const timerBody = source.slice(timerStart, source.indexOf('REMOVE_FADE_MS);', timerStart));
    assert.ok(timerBody.indexOf('flushSync') > -1 && timerBody.indexOf('rescueFocus(') > timerBody.indexOf('flushSync'), 'rescueFocus must run after the flushSync drop');
    assert.equal(source.split('rescueFocus(').length - 1, 3, 'one definition and two call sites, no duplicated rescue code');
});

test('loadEpicRefresh is a no-loading forced refresh defined after loadGroupTasks', () => {
    const source = read('eng', 'useEngSprintData.js');
    const groupStart = source.indexOf('const loadGroupTasks');
    const refreshStart = source.indexOf('const loadEpicRefresh');
    assert.ok(groupStart > -1 && refreshStart > groupStart, 'loadEpicRefresh must be defined after loadGroupTasks');
    const body = source.slice(refreshStart, source.indexOf('\n    return {', refreshStart));
    assert.match(body, /useLoading: false/);
    assert.match(body, /forceRefresh: true/);
    assert.match(body, /epicRefresh: true/);
});

test('the epic-refresh request goes through the API module with its own surface', () => {
    const api = read('api', 'engApi.js');
    assert.ok(api.includes("purpose: 'epic-refresh'"));
    assert.ok(api.includes("'epic_refresh'"));
    const apiSegment = `${path.sep}api${path.sep}`;
    const leaks = listSourceFiles(frontendSrcPath)
        .filter((file) => !file.includes(apiSegment))
        .filter((file) => fs.readFileSync(file, 'utf8').includes('/api/tasks-with-team-name'));
    assert.deepEqual(leaks.map((file) => path.relative(frontendSrcPath, file)), []);
});

test('the dashboard mounts the per-epic refresh in Catch Up without touching the alert re-arm paths', () => {
    const source = read('dashboard.jsx');
    for (const token of ['useEpicRefresh(', 'EpicRefreshButton', 'isLeaving={', 'loadEpochRef', 'alertCohortRef', 'data-epic-refresh-status']) {
        assert.ok(source.includes(token), `dashboard.jsx must contain ${token}`);
    }
    assert.equal((source.match(/rearmCatchUpAlerts\(\);/g) || []).length, 3);
    assert.equal((source.match(/onAlertDataInvalidated: rearmCatchUpAlerts/g) || []).length, 2);
    assert.match(source, /const loadMeasuredGroupTasks = \(options = \{\}\) => \{\s*loadEpochRef\.current \+= 1;/);
    assert.match(source, /const applyLocalEngIssueField = React\.useCallback\(\(issueKey, fieldName, fieldValue\) => \{\s*recentEditKeysRef\.current\.set\(issueKey, Date\.now\(\)\);/);
    const hookCall = source.indexOf('const epicRefresh = useEpicRefresh(');
    assert.ok(hookCall > source.indexOf('window.addEventListener(AUTH_LONG_ABSENCE_EVENT'), 'the hook call must follow the long-absence effect so every input is declared');
    assert.ok(hookCall > source.indexOf('const manualRefreshDisabled ='));
    assert.match(source, /\{isEpicRefreshMode && epicGroup\.key !== 'NO_EPIC' && \(\s*<EpicRefreshButton/, 'the button mounts in Catch Up and Planning only');
    assert.equal((source.match(/data-epic-refresh-status/g) || []).length, 1, 'one status region');
    assert.equal(source.includes('aria-live="polite" data-epic-refresh-status'), false);
});

test('the epic refresh guards dependencies, subtasks and the alert cohort without touching the dependencies effect', () => {
    const source = read('dashboard.jsx');
    for (const token of ['dependencySkipRef', 'refreshEpicDependencies', 'markDependencySignature', 'invalidateStorySubtasks', 'Promise.allSettled([alertEpicsLoad']) {
        assert.ok(source.includes(token), `dashboard.jsx must contain ${token}`);
    }
    const start = source.indexOf('if (!showDependencies && !showBlockedAlert) {');
    const slice = source.slice(start, source.indexOf('}, [', start));
    for (const token of ['dependencySkipRef', 'refreshEpicDependencies', 'markDependencySignature', 'alertCohortRef']) {
        assert.equal(slice.includes(token), false, `the dependencies effect body must not reference ${token}`);
    }
    const digest = require('node:crypto').createHash('sha256').update(slice).digest('hex');
    assert.equal(digest, 'b4454164077752fb961b04fb041ea2565133683226ecd26c9e64028eca9d036f', 'the dependencies effect body must stay byte-identical');
    assert.ok(source.includes('useEffect(() => { dependencySkipRef.current.disarm(); }, [dependencyKeySignature]);'));
    assert.ok(source.includes("import { createDependencySkip } from './eng/epicRefreshDependencySkip.js';"));
    assert.ok(source.includes('const dependencySkipRef = useRef(createDependencySkip());'));
    assert.ok(source.includes("if (dependencySkipRef.current.consume(keys.join('|'), loadEpochRef.current)) return ENG_TASK_LOAD_OUTCOME.APPLIED;"), 'fetchDependencies consumes the skip against the current department load epoch');
    assert.ok(source.includes('const armEpoch = loadEpochRef.current;') && source.includes(".join('|'), armEpoch);"), 'the wrapper arms the skip with the epoch captured before the loader runs');
    assert.ok(source.includes('dependencySkipRef.current.arm(next, epoch)'));
    assert.equal(source.split('if (alertCohortRef.current === alertCohortToken) alertCohortRef.current = null;').length - 1, 2, 'the settle handler and the effect cleanup both token-check before clearing');
    assert.ok(source.includes('alertCohortRef.current = alertCohortToken;'));
    assert.ok(source.includes('const readyToCloseProductLoad = loadReadyToCloseProductTasks(') && source.includes('backlogLoad = loadBacklog();'));
    assert.match(source, /const loadEpicRefreshWithDependencySkip = async \(args\) => \{[\s\S]*markDependencySignature\(.*\);\s*return lanes;/, 'the skip is armed before the merge commit, not in afterApply');
    const afterApply = source.slice(source.indexOf('afterApply: (update) => {'), source.indexOf('getAlertVersion:'));
    assert.ok(afterApply.includes('refreshEpicDependencies(') && afterApply.includes('invalidateStorySubtasks('));
    const refreshBody = source.slice(source.indexOf('const refreshEpicDependencies'), source.indexOf('const markDependencySignature'));
    for (const token of ['setDependencyRefreshNonce', 'setDependencyLookupCache', 'rearmCatchUpAlerts', 'loadGroupTasks']) {
        assert.equal(refreshBody.includes(token), false, `refreshEpicDependencies must not use ${token}`);
    }
    assert.ok(refreshBody.includes('refresh: true') && refreshBody.includes('isCurrentAggregateRead'));
    assert.ok(read('api', 'engApi.js').includes('JSON.stringify(refresh ? { keys, refresh: true } : { keys })'), 'existing callers keep the plain { keys } body');
});

test('Planning enablement: one mode gate, the Planning surface, and the capacity scope hold', () => {
    const source = read('dashboard.jsx');
    assert.match(source, /const isEpicRefreshMode = selectedView === 'eng' && !showStats && !showScenario && !showBoard;/, 'Catch Up and Planning, never Stats, Scenario or Board');
    const guards = source.slice(source.indexOf('readGuards: (epicKey) => ({'), source.indexOf('getProtectedKeys:'));
    assert.ok(guards.includes('!isEpicRefreshMode') && !guards.includes('!isCatchUpMode'), 'the click guard allows Planning');
    assert.ok(source.includes("sourceSurface: isCatchUpMode ? 'catch_up' : 'planning'"), 'the analytics surface follows the mode');
    assert.ok(source.includes('capacityScopeHoldRef,'), 'the hook receives the hold ref');
    // The signature is pinned while the hold is set and released only by a user scope change or a department reload.
    assert.match(source, /if \(showPlanning && capacityScopeHoldRef\.current && activeCapacityScopeRef\.current && !capacityScopePinRef\.current\) capacityScopePinRef\.current = \{ key: capacityScopeKey, signature: activeCapacityScopeRef\.current \};/);
    assert.match(source, /const capacityScopeSignature = capacityScopePinRef\.current \? capacityScopePinRef\.current\.signature : buildCapacityScopeSignature\(/);
    assert.ok(/const capacityScopeKey = \[[^\]]*loadEpochRef\.current[^\]]*isAllTeamsSelected[^\]]*selectedTeamSet/.test(source), 'the pin key covers the sprint, group, team scope and the department load epoch');
    const hook = read('eng', 'useEpicRefresh.js');
    const apply = hook.slice(hook.indexOf('const apply = async update'), hook.indexOf('const setEpicState'));
    assert.ok(apply.indexOf('capacityScopeHoldRef.current = true') > -1 && apply.indexOf('capacityScopeHoldRef.current = true') < apply.indexOf('flushSync(() => {'), 'the hold is set before the merge');
    assert.match(apply, /await twoFrames\(\);\s*\} finally \{\s*if \(capacityScopeHoldRef\) capacityScopeHoldRef\.current = false;/, 'the hold is cleared two frames after the merge, on every path');
    assert.equal(hook.includes('alertCallsFor({ ...update, epicChangedFields }, { isFutureSprint: latest.current.isFutureSprint === true, isCatchUp: sourceSurface === \'catch_up\' })'), true, 'Planning issues no alert request');
});

test('EPM surfaces carry no epic-refresh or glare hooks', () => {
    const files = [
        ...listSourceFiles(path.join(frontendSrcPath, 'epm')),
        path.join(frontendSrcPath, 'epm', 'EpmRollupPanel.jsx'),
    ];
    for (const file of new Set(files)) {
        const source = fs.readFileSync(file, 'utf8');
        assert.equal(source.includes('data-glare'), false, `${path.relative(frontendSrcPath, file)} must not use data-glare`);
        assert.equal(source.includes('epicRefresh'), false, `${path.relative(frontendSrcPath, file)} must not use epicRefresh`);
    }
});
