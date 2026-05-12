const test = require('node:test');
const assert = require('node:assert/strict');

const loadModule = () => import('../frontend/src/stats/excludedCapacityStats.js');

function story({ key, epicKey, teamId, teamName, sprintId, sprintName, points }) {
    return {
        key,
        fields: {
            epicKey,
            teamId,
            teamName,
            customfield_10004: points,
            customfield_10101: [{ id: sprintId, name: sprintName }]
        }
    };
}

test('buildExcludedCapacityTimeSeries calculates excluded percentage by team and sprint', async () => {
    const { buildExcludedCapacityTimeSeries } = await loadModule();
    const sprints = [
        { id: 101, name: '2025Q4 Sprint 1', startDate: '2025-10-01' },
        { id: 102, name: '2026Q1 Sprint 2', startDate: '2026-01-15' },
    ];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 9 }),
        story({ key: 'SYN-3', epicKey: 'BAU-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 2 }),
        story({ key: 'SYN-4', epicKey: 'PLAN-2', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 2 }),
        story({ key: 'SYN-5', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: '2026Q1 Sprint 2', points: 5 }),
        story({ key: 'SYN-6', epicKey: 'PLAN-3', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: '2026Q1 Sprint 2', points: 5 }),
    ];

    const rows = buildExcludedCapacityTimeSeries(tasks, sprints, {
        excludedEpicKeys: ['BAU-1'],
        teams: [
            { id: 'team-alpha', name: 'Alpha' },
            { id: 'team-beta', name: 'Beta' },
        ]
    });

    assert.deepEqual(
        rows.map(row => ({
            sprintId: row.sprintId,
            teamId: row.teamId,
            total: row.totalPoints,
            excluded: row.excludedPoints,
            percent: row.percent
        })),
        [
            { sprintId: '101', teamId: 'team-alpha', total: 12, excluded: 3, percent: 0.25 },
            { sprintId: '101', teamId: 'team-beta', total: 4, excluded: 2, percent: 0.5 },
            { sprintId: '102', teamId: 'team-alpha', total: 10, excluded: 5, percent: 0.5 },
            { sprintId: '102', teamId: 'team-beta', total: 0, excluded: 0, percent: 0 },
        ]
    );
});

test('buildExcludedCapacityTimeSeries filters the numerator by excluded epic without changing the denominator', async () => {
    const { buildExcludedCapacityTimeSeries } = await loadModule();
    const sprints = [{ id: 101, name: '2025Q4 Sprint 1', startDate: '2025-10-01' }];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'INT-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 2 }),
        story({ key: 'SYN-3', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 5 }),
    ];

    const rows = buildExcludedCapacityTimeSeries(tasks, sprints, {
        excludedEpicKeys: ['BAU-1', 'INT-1'],
        excludedEpicKeyFilter: 'INT-1'
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalPoints, 10);
    assert.equal(rows[0].excludedPoints, 2);
    assert.equal(rows[0].percent, 0.2);
});

test('buildEpicTeamModeShare classifies mono-team and cross-team excluded epic share by team', async () => {
    const { buildEpicTeamModeShare } = await loadModule();
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-MONO', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'BAU-CROSS', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 2 }),
        story({ key: 'SYN-3', epicKey: 'BAU-CROSS', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 4 }),
        story({ key: 'SYN-4', epicKey: 'BAU-LINKED', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: '2026Q1 Sprint 2', points: 1 }),
        story({ key: 'SYN-5', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: '2026Q1 Sprint 2', points: 99 }),
    ];
    const dependencies = {
        'SYN-4': [
            { key: 'SYN-9', teamId: 'team-beta', teamName: 'Beta', category: 'dependency' }
        ]
    };

    const rows = buildEpicTeamModeShare(tasks, {
        excludedEpicKeys: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED'],
        dependencies
    });

    assert.deepEqual(
        rows.map(row => ({
            teamId: row.teamId,
            mono: row.monoPoints,
            cross: row.crossPoints,
            total: row.totalPoints,
            crossPercent: row.crossPercent
        })),
        [
            { teamId: 'team-alpha', mono: 3, cross: 3, total: 6, crossPercent: 0.5 },
            { teamId: 'team-beta', mono: 0, cross: 4, total: 4, crossPercent: 1 },
        ]
    );
});

test('getSprintQuarterLabel groups by explicit sprint quarter before date fallback', async () => {
    const { getSprintQuarterLabel } = await loadModule();

    assert.equal(
        getSprintQuarterLabel({ id: 101, name: '2025Q4 Sprint 1', startDate: '2026-01-01' }),
        '2025 Q4'
    );
    assert.equal(
        getSprintQuarterLabel({ id: 102, name: 'Sprint 2', startDate: '2026-02-01' }),
        '2026 Q1'
    );
});
