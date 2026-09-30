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
