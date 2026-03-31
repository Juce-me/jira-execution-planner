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
