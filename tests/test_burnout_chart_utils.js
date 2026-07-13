const test = require('node:test');
const assert = require('node:assert/strict');

test('buildBurnoutChartModel builds story-point burndown summary and visible teams', async () => {
    const { buildBurnoutChartModel } = await import('../frontend/src/stats/burnoutChartUtils.js');
    const model = buildBurnoutChartModel({
        burnoutData: {
            range: { startDate: '2026-04-01', endDate: '2026-04-03' },
            issuesMeta: [
                {
                    issueKey: 'PROD-1',
                    createdDate: '2026-03-30',
                    assignee: { id: 'a1', name: 'Alex' },
                    teamAtStart: { id: 'team-alpha', name: 'Alpha' },
                },
                {
                    issueKey: 'PROD-2',
                    createdDate: '2026-04-02',
                    assignee: { id: 'a1', name: 'Alex' },
                    teamAtCreated: { id: 'team-alpha', name: 'Alpha' },
                },
            ],
            events: [
                {
                    issueKey: 'PROD-1',
                    date: '2026-04-03',
                    teamId: 'team-alpha',
                    teamName: 'Alpha',
                    assigneeName: 'Alex',
                    bucket: 'done',
                },
            ],
        },
        assigneeFilter: 'all',
        taskTeamByIssueKey: new Map(),
        taskStatusByIssueKey: new Map([['PROD-1', 'done'], ['PROD-2', 'to do']]),
        issueWeightByKey: new Map([['PROD-1', 3], ['PROD-2', 5]]),
        isCompletedSprintSelected: false,
        metric: 'storyPoints',
        resolveTeamColor: () => '#2563eb',
    });

    assert.ok(model);
    assert.equal(model.summary.start, 3);
    assert.equal(model.summary.added, 5);
    assert.equal(model.summary.closed, 3);
    assert.equal(model.summary.remaining, 5);
    assert.equal(model.summary.closureBuckets.done, 1);
    assert.equal(model.metric.key, 'storyPoints');
    assert.deepEqual(model.teams.map((team) => team.name), ['Alpha']);
    assert.ok(Array.isArray(model.rows));
    assert.ok(Array.isArray(model.areas));
    assert.ok(Array.isArray(model.issueSnapshots));
    assert.equal(model.teamNameByKey['team-alpha'], 'Alpha');
});

test('buildBurnoutChartModel filters assignees and closed-before-start stories', async () => {
    const { buildBurnoutChartModel } = await import('../frontend/src/stats/burnoutChartUtils.js');
    const model = buildBurnoutChartModel({
        burnoutData: {
            range: { startDate: '2026-04-01', endDate: '2026-04-03' },
            issuesMeta: [
                { issueKey: 'OPEN-1', createdDate: '2026-03-30', assignee: { id: 'a1', name: 'Alex' } },
                { issueKey: 'DONE-OLD', createdDate: '2026-03-30', assignee: { id: 'a1', name: 'Alex' } },
                { issueKey: 'OTHER-1', createdDate: '2026-03-30', assignee: { id: 'a2', name: 'Blair' } },
            ],
            events: [],
        },
        assigneeFilter: 'a1',
        taskTeamByIssueKey: new Map([['OPEN-1', { id: 'team-alpha', name: 'Alpha' }]]),
        taskStatusByIssueKey: new Map([['OPEN-1', 'to do'], ['DONE-OLD', 'done'], ['OTHER-1', 'to do']]),
        issueWeightByKey: new Map([['OPEN-1', 1], ['DONE-OLD', 1], ['OTHER-1', 1]]),
        isCompletedSprintSelected: false,
        metric: 'issueCount',
        resolveTeamColor: () => '#2563eb',
    });

    assert.ok(model);
    assert.equal(model.summary.start, 1);
    assert.deepEqual(model.issueSnapshots.map((snapshot) => snapshot.issueKey), ['OPEN-1']);
});

test('buildBurnoutChartModel preserves injected shared team colors', async () => {
    const { buildBurnoutChartModel } = await import('../frontend/src/stats/burnoutChartUtils.js');
    const colors = { 'team-alpha': '#111111', 'team-beta': '#eeeeee' };
    const model = buildBurnoutChartModel({
        burnoutData: {
            range: { startDate: '2026-04-01', endDate: '2026-04-03' },
            issuesMeta: [
                { issueKey: 'A-1', createdDate: '2026-03-30', teamAtStart: { id: 'team-alpha', name: 'Alpha Team' }, assignee: {} },
                { issueKey: 'B-1', createdDate: '2026-03-30', teamAtStart: { id: 'team-beta', name: 'Beta Team' }, assignee: {} },
            ],
            events: [],
        },
        assigneeFilter: 'all',
        taskTeamByIssueKey: new Map(),
        taskStatusByIssueKey: new Map([['A-1', 'to do'], ['B-1', 'to do']]),
        issueWeightByKey: new Map([['A-1', 1], ['B-1', 1]]),
        isCompletedSprintSelected: false,
        metric: 'issueCount',
        resolveTeamColor: (teamId) => colors[teamId],
    });
    assert.deepEqual(model.teams.map(({ key, color }) => [key, color]), [
        ['team-alpha', '#111111'],
        ['team-beta', '#eeeeee'],
    ]);
});
