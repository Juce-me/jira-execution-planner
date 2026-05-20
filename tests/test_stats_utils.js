const test = require('node:test');
const assert = require('node:assert/strict');

test('priority weight helpers normalize rows and fall back to defaults', async () => {
    const {
        DEFAULT_PRIORITY_WEIGHT_ROWS,
        clonePriorityWeightRows,
        buildPriorityWeightMap,
    } = await import('../frontend/src/stats/priorityWeights.js');

    assert.equal(DEFAULT_PRIORITY_WEIGHT_ROWS.length, 6);
    assert.deepEqual(clonePriorityWeightRows([{ priority: ' Major ', weight: 0.25 }]), [
        { priority: 'Major', weight: '0.25' },
    ]);
    assert.deepEqual(buildPriorityWeightMap([{ priority: 'Major', weight: '0.25' }]), {
        major: 0.25,
    });
    assert.equal(buildPriorityWeightMap([]).blocker, 0.4);
});

test('stats utilities normalize priorities, rates, weights, colors, and radar points', async () => {
    const {
        buildRadarPoints,
        computePriorityWeighted,
        computeRate,
        formatPercent,
        getPriorityLabel,
        getRateClass,
        normalizePriority,
        resolveTeamColor,
    } = await import('../frontend/src/stats/statsUtils.js');

    assert.equal(formatPercent(0.125), '12.50%');
    assert.equal(normalizePriority('High'), 'major');
    assert.equal(getPriorityLabel('Highest'), 'Blocker');
    assert.deepEqual(
        computePriorityWeighted({ High: { done: 2, incomplete: 1, killed: 1 } }, { major: 0.2 }),
        { done: 0.4, incomplete: 0.2, killed: 0.2 }
    );
    assert.equal(computeRate({ done: 3, incomplete: 1 }), 0.75);
    assert.equal(getRateClass(1), 'good');
    assert.equal(getRateClass(0.7), 'warn');
    assert.equal(getRateClass(0.5), 'bad');
    assert.match(resolveTeamColor('team-alpha'), /^#[0-9a-f]{6}$/i);
    assert.equal(
        buildRadarPoints({ values: { Blocker: 1 }, radius: 50, center: 60, maxValue: 1, axes: ['Blocker'] }),
        '60.00,10.00'
    );
});

test('buildLocalStatsFromTasks preserves sprint team project buckets and edge cases', async () => {
    const { buildLocalStatsFromTasks } = await import('../frontend/src/stats/statsUtils.js');
    const tasks = [
        {
            key: 'PROD-1',
            fields: {
                status: { name: 'Done' },
                priority: { name: 'High' },
                customfield_10004: 3,
                epicKey: 'EPIC-1',
                projectKey: 'PROD',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
        {
            key: 'TECH-1',
            fields: {
                status: { name: 'In Progress' },
                priority: { name: 'Low' },
                customfield_10004: 5,
                epicKey: 'EPIC-2',
                projectKey: 'TECH',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
        {
            key: 'TECH-2',
            fields: {
                status: { name: 'Killed' },
                priority: { name: 'Blocker' },
                customfield_10004: 2,
                epicKey: 'EPIC-3',
                teamId: 'team-beta',
                teamName: 'Beta',
            },
        },
        {
            key: 'PROD-EXCLUDED',
            fields: {
                status: { name: 'Done' },
                priority: { name: 'Major' },
                customfield_10004: 13,
                epicKey: 'EXCLUDED-1',
                projectKey: 'PROD',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
    ];
    const result = buildLocalStatsFromTasks(tasks, {
        excludedSet: new Set(['EXCLUDED-1']),
        normalizeStatus: (status) => {
            const key = String(status || '').toLowerCase();
            if (key === 'done') return 'done';
            if (key === 'killed') return 'killed';
            return 'incomplete';
        },
        getTeamInfo: (task) => ({ id: task.fields.teamId, name: task.fields.teamName }),
        techProjectKeys: new Set(['TECH']),
        sprintName: '2026Q2',
    });

    assert.equal(result.sprint, '2026Q2');
    assert.equal(result.totals.done, 1);
    assert.equal(result.totals.incomplete, 1);
    assert.equal(result.totals.killed, 1);
    assert.equal(result.storyPoints.total, 10);
    assert.deepEqual(result.teams.map((team) => team.name), ['Alpha', 'Beta']);
    assert.equal(result.teams[0].projects.product.done, 1);
    assert.equal(result.teams[0].projects.tech.incomplete, 1);
    assert.equal(result.teams[1].projects.tech.killed, 1);
    assert.equal(result.teams[0].priorityPoints.High, 3);
    assert.equal(result.teams[0].priorityPoints.Low, 5);
});
