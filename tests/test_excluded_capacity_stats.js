const test = require('node:test');
const assert = require('node:assert/strict');

const loadModule = () => import('../frontend/src/stats/excludedCapacityStats.js');

function story({ key, epicKey, epicSummary, teamId, teamName, sprintId, sprintName, points }) {
    return {
        key,
        fields: {
            epicKey,
            epicSummary,
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

test('buildExcludedCapacityTimeSeries respects multi-key filter without changing the denominator', async () => {
    const { buildExcludedCapacityTimeSeries } = await loadModule();
    const sprints = [{ id: 101, name: '2025Q4 Sprint 1', startDate: '2025-10-01' }];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'INT-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 2 }),
        story({ key: 'SYN-3', epicKey: 'OPS-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 1 }),
        story({ key: 'SYN-4', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 5 }),
    ];

    const rows = buildExcludedCapacityTimeSeries(tasks, sprints, {
        excludedEpicKeys: ['BAU-1', 'INT-1', 'OPS-1'],
        excludedEpicKeyFilters: ['BAU-1', 'INT-1']
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].totalPoints, 11);
    assert.equal(rows[0].excludedPoints, 5);
    assert.equal(rows[0].percent, roundMetric(5 / 11));
});

function roundMetric(value) {
    return Math.round(value * 1000) / 1000;
}

test('buildExcludedEpicCatalog returns configured epics with summaries when known and key fallback otherwise', async () => {
    const { buildExcludedEpicCatalog, pickAutoSelectedExcludedEpics } = await loadModule();
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', epicSummary: 'BAU Workstream', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'OPS-1', epicSummary: 'Ad Hoc Requests', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 1 }),
        story({ key: 'SYN-3', epicKey: 'INT-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: '2025Q4 Sprint 1', points: 2 })
    ];
    const catalog = buildExcludedEpicCatalog(tasks, {
        excludedEpicKeys: ['BAU-1', 'OPS-1', 'INT-1', 'GHOST-1']
    });
    const byKey = Object.fromEntries(catalog.map(entry => [entry.key, entry.summary]));
    assert.equal(byKey['BAU-1'], 'BAU Workstream');
    assert.equal(byKey['OPS-1'], 'Ad Hoc Requests');
    assert.equal(byKey['INT-1'], '');
    assert.equal(byKey['GHOST-1'], '');

    const autoSelected = pickAutoSelectedExcludedEpics(catalog);
    assert.deepEqual(autoSelected.sort(), ['BAU-1', 'OPS-1'].sort());
});

test('buildExcludedCapacityLineSeries returns one series per team in teams mode', async () => {
    const { buildExcludedCapacityLineSeries } = await loadModule();
    const sprints = [
        { id: 101, name: 'S1', startDate: '2025-10-01' },
        { id: 102, name: 'S2', startDate: '2026-01-15' }
    ];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 4 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 6 }),
        story({ key: 'SYN-3', epicKey: 'BAU-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 102, sprintName: 'S2', points: 3 }),
        story({ key: 'SYN-4', epicKey: 'PLAN-2', teamId: 'team-beta', teamName: 'Beta', sprintId: 102, sprintName: 'S2', points: 3 })
    ];
    const result = buildExcludedCapacityLineSeries(tasks, sprints, {
        excludedEpicKeys: ['BAU-1'],
        teams: [
            { id: 'team-alpha', name: 'Alpha' },
            { id: 'team-beta', name: 'Beta' }
        ],
        mode: 'teams'
    });
    assert.equal(result.mode, 'teams');
    assert.equal(result.series.length, 2);
    const alpha = result.series.find(s => s.seriesId === 'team-alpha');
    const beta = result.series.find(s => s.seriesId === 'team-beta');
    assert.deepEqual(alpha.points.map(p => p.percent), [0.4, 0]);
    assert.deepEqual(beta.points.map(p => p.percent), [0, 0.5]);
});

test('buildExcludedCapacityLineSeries aggregates across teams in group mode', async () => {
    const { buildExcludedCapacityLineSeries } = await loadModule();
    const sprints = [
        { id: 101, name: 'S1', startDate: '2025-10-01' },
        { id: 102, name: 'S2', startDate: '2026-01-15' }
    ];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 4 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 6 }),
        story({ key: 'SYN-3', epicKey: 'BAU-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: 'S1', points: 2 }),
        story({ key: 'SYN-4', epicKey: 'PLAN-2', teamId: 'team-beta', teamName: 'Beta', sprintId: 102, sprintName: 'S2', points: 10 })
    ];
    const result = buildExcludedCapacityLineSeries(tasks, sprints, {
        excludedEpicKeys: ['BAU-1'],
        teams: [
            { id: 'team-alpha', name: 'Alpha' },
            { id: 'team-beta', name: 'Beta' }
        ],
        mode: 'group',
        groupName: 'Squad'
    });
    assert.equal(result.mode, 'group');
    assert.equal(result.series.length, 1);
    const overall = result.series[0];
    assert.equal(overall.label, 'Squad');
    assert.deepEqual(overall.points.map(p => ({ excluded: p.excludedPoints, total: p.totalPoints, percent: p.percent })), [
        { excluded: 6, total: 12, percent: 0.5 },
        { excluded: 0, total: 10, percent: 0 }
    ]);
});

test('buildExcludedCapacityLineSeries supports story-point and percent metrics consistently', async () => {
    const { buildExcludedCapacityLineSeries } = await loadModule();
    const sprints = [{ id: 101, name: 'S1', startDate: '2025-10-01' }];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 7 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 })
    ];
    const teams = [{ id: 'team-alpha', name: 'Alpha' }];
    const result = buildExcludedCapacityLineSeries(tasks, sprints, {
        excludedEpicKeys: ['BAU-1'],
        teams,
        mode: 'teams'
    });
    const point = result.series[0].points[0];
    assert.equal(point.excludedPoints, 7);
    assert.equal(point.totalPoints, 10);
    assert.equal(point.percent, 0.7);
});

test('mergeExcludedCapacityStatsSourceChunks deduplicates sprint chunks and suppresses summary cap warnings', async () => {
    const { mergeExcludedCapacityStatsSourceChunks } = await loadModule();
    const chunks = [
        {
            issues: [
                story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 }),
                story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 5 })
            ],
            meta: {
                warnings: ['epic summary enrichment capped at 200 epics'],
                queryPages: 1
            }
        },
        {
            issues: [
                story({ key: 'SYN-1', epicKey: 'BAU-1', epicSummary: 'BAU Workstream', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 }),
                story({ key: 'SYN-3', epicKey: 'OPS-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 102, sprintName: 'S2', points: 2 })
            ],
            meta: {
                warnings: ['issue fetch capped at 2000 issues'],
                queryPages: 2
            }
        }
    ];

    const merged = mergeExcludedCapacityStatsSourceChunks(chunks, { totalSprintCount: 2 });

    assert.deepEqual(merged.issues.map(issue => issue.key), ['SYN-1', 'SYN-2', 'SYN-3']);
    assert.equal(merged.issues[0].fields.epicSummary, 'BAU Workstream');
    assert.deepEqual(merged.meta.warnings, ['issue fetch capped at 2000 issues']);
    assert.equal(merged.meta.queryPages, 3);
    assert.equal(merged.meta.loadedSprintCount, 2);
    assert.equal(merged.meta.totalSprintCount, 2);
});

test('loadExcludedCapacityStatsSourceChunks loads sprint chunks with bounded concurrency and keeps partial failures', async () => {
    const { loadExcludedCapacityStatsSourceChunks } = await loadModule();
    const activeCounts = [];
    let active = 0;
    const releases = [];
    const fetchSprintChunk = async (sprintId) => {
        active += 1;
        activeCounts.push(active);
        await new Promise(resolve => {
            releases.push(resolve);
        });
        active -= 1;
        if (sprintId === '102') {
            throw new Error('Jira timeout');
        }
        return {
            issues: [story({ key: `SYN-${sprintId}`, epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId, sprintName: sprintId, points: 1 })],
            meta: { warnings: [], queryPages: 1 }
        };
    };

    const progress = [];
    const loading = loadExcludedCapacityStatsSourceChunks(['101', '102', '103'], fetchSprintChunk, {
        maxConcurrent: 2,
        onProgress: (chunks, meta) => {
            progress.push({ loaded: meta.loadedSprintCount, chunks: chunks.length });
        }
    });
    while (releases.length < 2) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(Math.max(...activeCounts), 2);
    releases.shift()();
    while (releases.length < 2) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(activeCounts[activeCounts.length - 1], 2);
    releases.forEach(resolve => resolve());
    const result = await loading;

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].sprintId, '102');
    assert.equal(result.chunks.length, 3);
    assert.deepEqual(result.chunks.map(chunk => chunk.issues.length), [1, 0, 1]);
    assert.ok(result.chunks[1].meta.warnings[0].includes('102'));
    assert.deepEqual(progress.map(item => item.loaded), [1, 2, 3]);
});

test('buildEpicTeamModeShare classifies cross only from story teams in the same sprint', async () => {
    const { buildEpicTeamModeShare, buildEpicTeamModeOverall, buildEpicTeamModeSprintRows } = await loadModule();
    const sprints = [
        { id: 101, name: 'S1', startDate: '2025-10-01' },
        { id: 102, name: 'S2', startDate: '2025-10-15' }
    ];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-MONO', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'BAU-CROSS', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 2 }),
        story({ key: 'SYN-3', epicKey: 'BAU-CROSS', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: 'S1', points: 4 }),
        story({ key: 'SYN-4', epicKey: 'BAU-LINKED', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: 'S2', points: 1 }),
        story({ key: 'SYN-5', epicKey: 'OPS-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: 'S2', points: 8 })
    ];
    const rows = buildEpicTeamModeShare(tasks, {
        excludedEpicKeys: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED', 'OPS-1'],
        excludedEpicKeyFilters: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED'],
        sprints
    });
    assert.deepEqual(
        rows.map(row => ({
            teamId: row.teamId,
            mono: row.monoPoints,
            cross: row.crossPoints,
            shared: row.sharedPoints,
            percent: row.crossPercent
        })),
        [
            { teamId: 'team-alpha', mono: 4, cross: 2, shared: 6, percent: roundMetric(2 / 6) },
            { teamId: 'team-beta', mono: 0, cross: 4, shared: 4, percent: 1 }
        ]
    );
    const overall = buildEpicTeamModeOverall(tasks, {
        excludedEpicKeys: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED', 'OPS-1'],
        excludedEpicKeyFilters: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED'],
        sprints
    });
    assert.equal(overall.monoPoints, 4);
    assert.equal(overall.crossPoints, 6);
    assert.equal(overall.sharedPoints, 10);
    assert.equal(overall.totalPoints, 10);
    assert.equal(overall.crossPercent, 0.6);

    const sprintRows = buildEpicTeamModeSprintRows(tasks, {
        excludedEpicKeys: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED', 'OPS-1'],
        excludedEpicKeyFilters: ['BAU-MONO', 'BAU-CROSS', 'BAU-LINKED'],
        sprints
    });
    assert.deepEqual(
        sprintRows.map(row => ({
            sprintId: row.sprintId,
            cross: row.crossPoints,
            shared: row.sharedPoints,
            percent: row.crossPercent
        })),
        [
            { sprintId: '101', cross: 6, shared: 9, percent: roundMetric(6 / 9) },
            { sprintId: '102', cross: 0, shared: 1, percent: 0 }
        ]
    );
});

test('buildEpicTeamModeShare counts included and excluded epics together when requested', async () => {
    const { buildEpicTeamModeShare, buildEpicTeamModeOverall, buildEpicTeamModeSprintRows } = await loadModule();
    const sprints = [{ id: 101, name: 'S1', startDate: '2025-10-01' }];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 2 }),
        story({ key: 'SYN-3', epicKey: 'PLAN-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: 'S1', points: 5 })
    ];
    const options = {
        includeAllEpics: true,
        excludedEpicKeys: ['BAU-1'],
        excludedEpicKeyFilters: ['BAU-1'],
        sprints
    };

    const rows = buildEpicTeamModeShare(tasks, options);
    assert.deepEqual(
        rows.map(row => ({
            teamId: row.teamId,
            mono: row.monoPoints,
            cross: row.crossPoints,
            shared: row.sharedPoints,
            percent: row.crossPercent
        })),
        [
            { teamId: 'team-alpha', mono: 3, cross: 2, shared: 5, percent: 0.4 },
            { teamId: 'team-beta', mono: 0, cross: 5, shared: 5, percent: 1 }
        ]
    );

    const overall = buildEpicTeamModeOverall(tasks, options);
    assert.equal(overall.monoPoints, 3);
    assert.equal(overall.crossPoints, 7);
    assert.equal(overall.sharedPoints, 10);
    assert.equal(overall.crossPercent, 0.7);

    const sprintRows = buildEpicTeamModeSprintRows(tasks, options);
    assert.deepEqual(
        sprintRows.map(row => ({
            sprintId: row.sprintId,
            cross: row.crossPoints,
            shared: row.sharedPoints,
            percent: row.crossPercent
        })),
        [{ sprintId: '101', cross: 7, shared: 10, percent: 0.7 }]
    );
});

test('buildEpicTeamCrossShareLineSeries uses total sprint team story points as denominator', async () => {
    const { buildEpicTeamCrossShareLineSeries } = await loadModule();
    const sprints = [{ id: 101, name: 'S1', startDate: '2025-10-01' }];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 2 }),
        story({ key: 'SYN-3', epicKey: 'PLAN-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: 'S1', points: 5 }),
        story({ key: 'SYN-4', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 4 })
    ];

    const model = buildEpicTeamCrossShareLineSeries(tasks, sprints, {
        teams: [
            { id: 'team-alpha', name: 'Alpha' },
            { id: 'team-beta', name: 'Beta' }
        ]
    });

    assert.deepEqual(
        model.series.map(row => ({
            teamId: row.seriesId,
            points: row.points.map(point => ({
                sprintId: point.sprintId,
                cross: point.excludedPoints,
                total: point.totalPoints,
                percent: point.percent
            }))
        })),
        [
            { teamId: 'team-alpha', points: [{ sprintId: '101', cross: 2, total: 9, percent: roundMetric(2 / 9) }] },
            { teamId: 'team-beta', points: [{ sprintId: '101', cross: 5, total: 5, percent: 1 }] }
        ]
    );
});

test('buildEpicTeamModeShare keeps scoped teams that have no excluded stories', async () => {
    const { buildEpicTeamModeShare } = await loadModule();
    const sprints = [{ id: 101, name: 'S1', startDate: '2025-10-01' }];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 3 }),
        story({ key: 'SYN-2', epicKey: 'PLAN-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 101, sprintName: 'S1', points: 5 })
    ];
    const rows = buildEpicTeamModeShare(tasks, {
        excludedEpicKeys: ['BAU-1'],
        sprints,
        teams: [
            { id: 'team-alpha', name: 'Alpha' },
            { id: 'team-beta', name: 'Beta' }
        ]
    });

    assert.deepEqual(
        rows.map(row => ({ teamId: row.teamId, mono: row.monoPoints, cross: row.crossPoints, shared: row.sharedPoints })),
        [
            { teamId: 'team-alpha', mono: 3, cross: 0, shared: 3 },
            { teamId: 'team-beta', mono: 0, cross: 0, shared: 0 }
        ]
    );
});

test('buildEpicTeamModeOverall classifies the same epic separately per sprint', async () => {
    const { buildEpicTeamModeOverall } = await loadModule();
    const sprints = [
        { id: 101, name: 'S1', startDate: '2025-10-01' },
        { id: 102, name: 'S2', startDate: '2025-10-15' },
        { id: 103, name: 'S3', startDate: '2025-10-29' }
    ];
    const tasks = [
        story({ key: 'SYN-1', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 101, sprintName: 'S1', points: 5 }),
        story({ key: 'SYN-2', epicKey: 'BAU-1', teamId: 'team-alpha', teamName: 'Alpha', sprintId: 102, sprintName: 'S2', points: 5 }),
        story({ key: 'SYN-3', epicKey: 'BAU-1', teamId: 'team-beta', teamName: 'Beta', sprintId: 103, sprintName: 'S3', points: 5 })
    ];
    const overall = buildEpicTeamModeOverall(tasks, {
        excludedEpicKeys: ['BAU-1'],
        sprints
    });
    assert.equal(overall.totalPoints, 15);
    assert.equal(overall.monoPoints, 15);
    assert.equal(overall.crossPoints, 0);
    assert.equal(overall.sharedPoints, 15);
    assert.equal(overall.monoPercent, 1);
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
