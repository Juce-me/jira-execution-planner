const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stylesDir = path.join(__dirname, '..', 'frontend', 'src', 'styles');
const cssImportPattern = /@import\s+["'](.+?)["'];/;

function readCssWithImports(relativePath, seen = new Set()) {
    const normalizedPath = relativePath.split(path.sep).join('/');
    assert.equal(seen.has(normalizedPath), false, `CSS import cycle detected at ${normalizedPath}`);
    seen.add(normalizedPath);
    const source = fs.readFileSync(path.join(stylesDir, normalizedPath), 'utf8');
    return source.split(/(?<=\n)/).map(line => {
        const match = line.match(cssImportPattern);
        if (!match) return line;
        const nestedPath = path.posix.normalize(path.posix.join(path.posix.dirname(normalizedPath), match[1]));
        return readCssWithImports(nestedPath, new Set(seen));
    }).join('');
}

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
        buildTeamColorMap,
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

    const teamColors = buildTeamColorMap([
        { id: 'team-gamma', name: 'Gamma Team' },
        { id: 'team-alpha', name: 'Alpha Team' },
        { id: 'team-beta', name: 'Beta Team' },
        { id: 'team-beta', name: 'Duplicate Beta' },
    ]);
    assert.deepEqual(teamColors, {
        'team-alpha': '#0ea5e9',
        'team-beta': '#eab308',
        'team-gamma': '#84cc16',
    });
    assert.equal(resolveTeamColor('team-beta', teamColors), '#eab308');
    assert.match(resolveTeamColor('team-outside-group', teamColors), /^#[0-9a-f]{6}$/i);
});

test('compareQuarterLabels orders quarter labels and rejects invalid input', async () => {
    const { compareQuarterLabels } = await import('../frontend/src/cohort/cohortUtils.js');
    assert.equal(compareQuarterLabels('2026Q1', '2026Q2'), -1);
    assert.equal(compareQuarterLabels('2026Q2', '2026Q2'), 0);
    assert.equal(compareQuarterLabels('2026Q3', '2026Q2'), 1);
    assert.equal(compareQuarterLabels('invalid', '2026Q2'), null);
});

test('cohort summary counts actual open Jira statuses for workflow card', async () => {
    const { aggregateCohortSummary } = await import('../frontend/src/cohort/cohortUtils.js');
    const summary = aggregateCohortSummary([
        { key: 'EPIC-1', status: 'open', jiraStatus: 'In Progress' },
        { key: 'EPIC-2', status: 'open', jiraStatus: 'Awaiting Validation' },
        { key: 'EPIC-3', status: 'Postponed', jiraStatus: 'Postponed', terminalDate: '2026-04-15' },
        { key: 'EPIC-4', status: 'open', jiraStatus: 'Accepted' },
    ]);

    assert.equal(summary.open, 3);
    assert.equal(summary.inProgress, 1);
    assert.equal(summary.awaitingValidation, 1);
    assert.equal(summary.postponed, 1);
});

test('filterCohortIssues drops ad_hoc records only when excludeAdHoc is set', async () => {
    const { filterCohortIssues } = await import('../frontend/src/cohort/cohortUtils.js');
    const issues = [
        { key: 'EPIC-1', status: 'open', capacityType: 'ad_hoc' },
        { key: 'EPIC-2', status: 'open', capacityType: 'product' },
        { key: 'EPIC-3', status: 'open' },
    ];
    assert.equal(filterCohortIssues(issues).length, 3);
    assert.equal(filterCohortIssues(issues, { excludeAdHoc: false }).length, 3);
    assert.deepEqual(filterCohortIssues(issues, { excludeAdHoc: true }).map((i) => i.key), ['EPIC-2', 'EPIC-3']);
});

test('Tech-project ad_hoc epic stays visible by key and only leaves when excluded', async () => {
    const { filterCohortIssues, deriveProjectOptions } = await import('../frontend/src/cohort/cohortUtils.js');
    // TECH-9 has a raw project (TECH) outside the cohort project scope; it was
    // returned by the `key in (...)` branch and tagged ad_hoc by the backend.
    const issues = [
        { key: 'PRODUCT-1', status: 'open', projectKey: 'PRODUCT' },
        { key: 'TECH-9', status: 'open', projectKey: 'TECH', capacityType: 'ad_hoc' },
    ];

    // Visible in the unfiltered dataset; its raw project key is preserved.
    assert.equal(filterCohortIssues(issues).length, 2);
    const projectValues = deriveProjectOptions(issues).map((option) => option.value);
    assert.deepEqual(projectValues, ['all', 'PRODUCT', 'TECH']);

    // excludeAdHoc drops the tagged Tech-project epic; the untagged Product
    // epic remains.
    const adHocExcluded = filterCohortIssues(issues, { excludeAdHoc: true });
    assert.deepEqual(adHocExcluded.map((issue) => issue.key), ['PRODUCT-1']);

    // Only removed by raw-project selection when the user picks a different project.
    const productOnly = filterCohortIssues(issues, { projectKey: 'PRODUCT' });
    assert.deepEqual(productOnly.map((issue) => issue.key), ['PRODUCT-1']);

    // Picking the epic's own raw project keeps it.
    const techOnly = filterCohortIssues(issues, { projectKey: 'TECH' });
    assert.deepEqual(techOnly.map((issue) => issue.key), ['TECH-9']);
});

test('open epic lead-time bars include every open epic by default', async () => {
    const { buildOpenEpicsBars } = await import('../frontend/src/cohort/cohortUtils.js');
    const issues = Array.from({ length: 35 }, (_, index) => ({
        key: `OPEN-${index + 1}`,
        summary: `Open epic ${index + 1}`,
        status: 'open',
        jiraStatus: 'In Progress',
        createdDate: '2026-01-01',
    }));

    const bars = buildOpenEpicsBars(issues, { today: new Date('2026-06-01T00:00:00') });

    assert.equal(bars.length, 35);
    assert.equal(bars[0].key, 'OPEN-1');
    assert.equal(bars[34].key, 'OPEN-35');
});

test('completed epic lead-time bars include every terminal epic by default', async () => {
    const { buildCompletedEpicsBars } = await import('../frontend/src/cohort/cohortUtils.js');
    const issues = Array.from({ length: 35 }, (_, index) => ({
        key: `DONE-${index + 1}`,
        summary: `Completed epic ${index + 1}`,
        status: 'done',
        jiraStatus: 'Done',
        createdDate: '2026-01-01',
        terminalDate: '2026-04-01',
        leadTimeDays: 90,
    }));

    const bars = buildCompletedEpicsBars(issues);

    assert.equal(bars.length, 35);
    assert.equal(bars[0].key, 'DONE-1');
    assert.equal(bars[34].key, 'DONE-35');
});

test('open stats panel height contributes to page scrolling', () => {
    const css = readCssWithImports('stats-summary.css');
    const block = css.match(/\.stats-panel\.open\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';

    assert.match(block, /max-height:\s*none;/);
    assert.equal(block.includes('max-height: 2000px;'), false);
});

test('open stats view height is not capped inside the panel', () => {
    const css = readCssWithImports('stats.css');
    const block = css.match(/\.stats-view\.open\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';

    assert.match(block, /max-height:\s*none;/);
    assert.match(block, /overflow:\s*visible;/);
    assert.equal(block.includes('max-height: 2400px;'), false);
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

test('buildLocalStatsFromTasks counts Tech-project Ad Hoc stories as Product', async () => {
    const { buildLocalStatsFromTasks } = await import('../frontend/src/stats/statsUtils.js');
    const tasks = [
        {
            key: 'TECH-1',
            fields: {
                status: { name: 'Done' },
                priority: { name: 'High' },
                customfield_10004: 8,
                epicKey: 'adhoc-1',
                projectKey: 'TECH',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
        {
            key: 'TECH-2',
            fields: {
                status: { name: 'In Progress' },
                priority: { name: 'Low' },
                customfield_10004: 2,
                epicKey: 'EPIC-9',
                projectKey: 'TECH',
                teamId: 'team-alpha',
                teamName: 'Alpha',
            },
        },
    ];
    const baseOptions = {
        normalizeStatus: (status) => {
            const key = String(status || '').toLowerCase();
            if (key === 'done') return 'done';
            if (key === 'killed') return 'killed';
            return 'incomplete';
        },
        getTeamInfo: (task) => ({ id: task.fields.teamId, name: task.fields.teamName }),
        techProjectKeys: new Set(['TECH']),
    };

    const adHoc = buildLocalStatsFromTasks(tasks, { ...baseOptions, adHocEpicSet: new Set(['ADHOC-1']) });
    assert.equal(adHoc.projects.product.done, 1);
    assert.equal(adHoc.projects.tech.done, 0);
    assert.equal(adHoc.projects.tech.incomplete, 1);
    assert.equal(adHoc.teams[0].projects.product.done, 1);
    // Totals are unchanged: 1 done + 1 incomplete, 10 SP.
    assert.equal(adHoc.totals.done, 1);
    assert.equal(adHoc.totals.incomplete, 1);
    assert.equal(adHoc.storyPoints.total, 10);

    // Without the Ad Hoc set, the same story stays Tech.
    const plain = buildLocalStatsFromTasks(tasks, baseOptions);
    assert.equal(plain.projects.product.done, 0);
    assert.equal(plain.projects.tech.done, 1);
});

// ---- buildCohortGridModel characterization (Lead Times modes Task 5): today's output, pinned before the overflow option ----
const GRID_ISSUES = [
    { key: 'A-1', summary: 'Epic A-1', createdDate: '2025-01-10', status: 'done', terminalDate: '2025-02-15' },
    { key: 'A-2', summary: 'Epic A-2', createdDate: '2025-01-20', status: 'done', terminalDate: '2025-05-01' },
    { key: 'A-3', summary: 'Epic A-3', createdDate: '2025-02-03', status: 'killed', terminalDate: '2025-11-20' },
    { key: 'A-4', summary: 'Epic A-4', createdDate: '2025-02-10', status: 'done', terminalDate: '2026-03-01' },
    { key: 'A-5', summary: 'Epic A-5', createdDate: '2025-04-02', status: 'open', terminalDate: null },
    { key: 'A-6', summary: 'Epic A-6', createdDate: '2025-07-05', status: 'incomplete', terminalDate: '2025-07-06' },
];
const GRID_GOLDEN_QUARTER = {
    "groupBy": "quarter",
    "columns": [
        {
            "index": 0,
            "key": "Q+0",
            "label": "Q+0"
        },
        {
            "index": 1,
            "key": "Q+1",
            "label": "Q+1"
        },
        {
            "index": 2,
            "key": "Q+2",
            "label": "Q+2"
        },
        {
            "index": 3,
            "key": "Q+3",
            "label": "Q+3"
        }
    ],
    "rows": [
        {
            "key": "2025Q1",
            "label": "2025Q1",
            "totalCreated": 4,
            "openCount": 0,
            "cells": [
                {
                    "index": 0,
                    "count": 1,
                    "samples": [
                        {
                            "key": "A-1",
                            "summary": "Epic A-1",
                            "status": "done",
                            "terminalDate": "2025-02-15"
                        }
                    ],
                    "statusCounts": {
                        "done": 1,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 1,
                    "count": 1,
                    "samples": [
                        {
                            "key": "A-2",
                            "summary": "Epic A-2",
                            "status": "done",
                            "terminalDate": "2025-05-01"
                        }
                    ],
                    "statusCounts": {
                        "done": 1,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 2,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 3,
                    "count": 1,
                    "samples": [
                        {
                            "key": "A-3",
                            "summary": "Epic A-3",
                            "status": "killed",
                            "terminalDate": "2025-11-20"
                        }
                    ],
                    "statusCounts": {
                        "done": 0,
                        "killed": 1,
                        "incomplete": 0,
                        "postponed": 0
                    }
                }
            ]
        },
        {
            "key": "2025Q2",
            "label": "2025Q2",
            "totalCreated": 1,
            "openCount": 1,
            "cells": [
                {
                    "index": 0,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 1,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 2,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 3,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                }
            ]
        },
        {
            "key": "2025Q3",
            "label": "2025Q3",
            "totalCreated": 1,
            "openCount": 0,
            "cells": [
                {
                    "index": 0,
                    "count": 1,
                    "samples": [
                        {
                            "key": "A-6",
                            "summary": "Epic A-6",
                            "status": "incomplete",
                            "terminalDate": "2025-07-06"
                        }
                    ],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 1,
                        "postponed": 0
                    }
                },
                {
                    "index": 1,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 2,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 3,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                }
            ]
        },
        {
            "key": "2025Q4",
            "label": "2025Q4",
            "totalCreated": 0,
            "openCount": 0,
            "cells": [
                {
                    "index": 0,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 1,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 2,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                },
                {
                    "index": 3,
                    "count": 0,
                    "samples": [],
                    "statusCounts": {
                        "done": 0,
                        "killed": 0,
                        "incomplete": 0,
                        "postponed": 0
                    }
                }
            ]
        }
    ],
    "maxCellCount": 1,
    "totals": {
        "created": 6,
        "resolvedWithDate": 4
    }
};
const GRID_GOLDEN_MONTH = {
    "columns": [
        "M+0",
        "M+1",
        "M+2",
        "M+3",
        "M+4"
    ],
    "rows": [
        [
            "2025-01",
            2,
            0,
            "01001"
        ],
        [
            "2025-02",
            2,
            0,
            "00000"
        ],
        [
            "2025-03",
            0,
            0,
            "00000"
        ],
        [
            "2025-04",
            1,
            1,
            "00000"
        ],
        [
            "2025-05",
            0,
            0,
            "00000"
        ],
        [
            "2025-06",
            0,
            0,
            "00000"
        ],
        [
            "2025-07",
            1,
            0,
            "10000"
        ],
        [
            "2025-08",
            0,
            0,
            "00000"
        ]
    ],
    "maxCellCount": 1,
    "totals": {
        "created": 6,
        "resolvedWithDate": 3
    }
};

test('buildCohortGridModel keeps its quarter and month output without the overflow option', async () => {
    const { buildCohortGridModel } = await import('../frontend/src/cohort/cohortUtils.js');
    const quarter = buildCohortGridModel(GRID_ISSUES, { groupBy: 'quarter', maxColumns: 3, rangeStartDate: '2025-01-01', rangeEndDate: '2025-12-31' });
    assert.deepEqual(JSON.parse(JSON.stringify(quarter)), GRID_GOLDEN_QUARTER);
    const month = buildCohortGridModel(GRID_ISSUES, { groupBy: 'month', maxColumns: 4, rangeStartDate: '2025-01-01', rangeEndDate: '2025-08-31' });
    assert.deepEqual({
        columns: month.columns.map((column) => column.label),
        rows: month.rows.map((row) => [row.key, row.totalCreated, row.openCount, row.cells.map((cell) => cell.count).join('')]),
        maxCellCount: month.maxCellCount,
        totals: month.totals,
    }, GRID_GOLDEN_MONTH);
});

test('Lead Times mode and Last N resolvers fall back to Created and 30', async () => {
    const { LEAD_TIMES_MODES, LEAD_TIMES_LAST_N_OPTIONS, resolveLeadTimesMode, resolveLeadTimesLastN } = await import('../frontend/src/cohort/cohortUtils.js');
    assert.deepEqual([...LEAD_TIMES_MODES], ['created', 'closed', 'last_n']);
    assert.deepEqual([...LEAD_TIMES_LAST_N_OPTIONS], [30, 50, 60]);
    assert.equal(resolveLeadTimesMode(undefined), 'created');
    assert.equal(resolveLeadTimesMode('foo'), 'created');
    assert.equal(resolveLeadTimesMode('closed'), 'closed');
    assert.equal(resolveLeadTimesMode('last_n'), 'last_n');
    assert.equal(resolveLeadTimesLastN('50'), 50);
    assert.equal(resolveLeadTimesLastN(60), 60);
    assert.equal(resolveLeadTimesLastN(45), 30);
    assert.equal(resolveLeadTimesLastN(undefined), 30);
    assert.equal(resolveLeadTimesLastN(''), 30);
});

test('buildCohortRequest keeps the Created body byte-identical and adds mode only for the closed modes', async () => {
    const { buildCohortRequest } = await import('../frontend/src/cohort/cohortUtils.js');
    const shared = { teamIds: ['T1'], components: ['Alpha'], adHocCapacityEpics: ['TECH-9'] };
    const created = buildCohortRequest({ mode: 'created', startQuarter: '2026Q1', endQuarter: '2026Q2', ...shared });
    assert.deepEqual(Object.keys(created), ['startQuarter', 'endQuarter', 'teamIds', 'components', 'adHocCapacityEpics', 'refresh']);
    assert.equal(JSON.stringify(created), JSON.stringify({
        startQuarter: '2026Q1', endQuarter: '2026Q2', teamIds: ['T1'], components: ['Alpha'], adHocCapacityEpics: ['TECH-9'], refresh: false,
    }));
    assert.deepEqual(buildCohortRequest({ mode: 'closed', startQuarter: '2025Q4', endQuarter: '2026Q1', ...shared }), {
        mode: 'closed', startQuarter: '2025Q4', endQuarter: '2026Q1', ...shared, refresh: false,
    });
    const lastN = buildCohortRequest({ mode: 'last_n', startQuarter: '2026Q1', endQuarter: '2026Q2', ...shared });
    assert.deepEqual(lastN, { mode: 'last_n', ...shared, refresh: false });
    assert.equal('startQuarter' in lastN, false);
});

test('selectLastClosedEpics ranks by terminal day then key in codepoint order and skips undated Epics', async () => {
    const { selectLastClosedEpics } = await import('../frontend/src/cohort/cohortUtils.js');
    const epic = (key, terminalDate) => ({ key, terminalDate });
    const issues = [epic('a-1', '2026-02-10'), epic('Z-1', '2026-02-10'), epic('B-1', '2026-02-11'), epic('C-1', '2026-02-09'), epic('U-1', null), epic('G-1', 'garbage')];
    assert.deepEqual(selectLastClosedEpics(issues, 3).map((item) => item.key), ['B-1', 'Z-1', 'a-1']);
    assert.deepEqual(selectLastClosedEpics(issues, 50).map((item) => item.key), ['B-1', 'Z-1', 'a-1', 'C-1']);
    assert.deepEqual(selectLastClosedEpics(issues, 0), []);
    assert.deepEqual(selectLastClosedEpics(null, 5), []);
});

test('createdRangeOf spans the earliest to the latest valid created date', async () => {
    const { createdRangeOf } = await import('../frontend/src/cohort/cohortUtils.js');
    const epic = (createdDate) => ({ createdDate });
    assert.deepEqual(createdRangeOf([epic('2025-06-10'), epic('2023-02-01'), epic('nope'), epic('2026-01-31')]), { startDate: '2023-02-01', endDate: '2026-01-31' });
    assert.deepEqual(createdRangeOf([epic('2025-06-10')]), { startDate: '2025-06-10', endDate: '2025-06-10' });
    assert.equal(createdRangeOf([epic('bad'), {}]), null);
    assert.equal(createdRangeOf([]), null);
});

test('filterCohortIssues closedOnly drops open and Postponed Epics whatever the toggles say', async () => {
    const { filterCohortIssues } = await import('../frontend/src/cohort/cohortUtils.js');
    const issues = ['done', 'killed', 'incomplete', 'postponed', 'In Progress'].map((status, index) => ({ key: `K-${index}`, status }));
    const toggles = { done: true, killed: true, incomplete: true, postponed: true, open: true };
    assert.deepEqual(filterCohortIssues(issues, { statusToggles: toggles }).map((item) => item.key), ['K-0', 'K-1', 'K-2', 'K-3', 'K-4']);
    assert.deepEqual(filterCohortIssues(issues, { statusToggles: toggles, closedOnly: true }).map((item) => item.key), ['K-0', 'K-1', 'K-2']);
});

const OVERFLOW_ISSUES = [
    { key: 'L-1', summary: 'Long one', createdDate: '2022-02-10', status: 'done', terminalDate: '2026-08-15' },
    { key: 'L-2', summary: 'Long two', createdDate: '2022-05-01', status: 'killed', terminalDate: '2027-01-05' },
    { key: 'L-3', summary: 'Long three', createdDate: '2022-02-12', status: 'done', terminalDate: '2025-08-01' },
    { key: 'S-1', summary: 'Short one', createdDate: '2026-01-10', status: 'done', terminalDate: '2026-02-01' },
];

test('overflow column carries over-budget Epics and keeps column index equal to array position', async () => {
    const { buildCohortGridModel } = await import('../frontend/src/cohort/cohortUtils.js');
    const withOverflow = buildCohortGridModel(OVERFLOW_ISSUES, { groupBy: 'quarter', maxColumns: 12, overflowColumn: true, rangeStartDate: '2022-01-01', rangeEndDate: '2026-12-31' });
    assert.deepEqual(withOverflow.columns.map((column) => column.label), ['Q+0', 'Q+12+']);
    withOverflow.columns.forEach((column, position) => assert.equal(column.index, position));
    assert.equal(withOverflow.columns[1].overflow, true);
    const rows = Object.fromEntries(withOverflow.rows.map((row) => [row.key, row]));
    assert.equal(rows['2022Q1'].totalCreated, 2);
    assert.equal(rows['2022Q1'].cells[1].count, 2);
    assert.equal(rows['2022Q1'].cells[1].samples.length, 2);
    assert.deepEqual(rows['2022Q1'].cells[1].statusCounts, { done: 2, killed: 0, incomplete: 0, postponed: 0 });
    assert.equal(rows['2022Q2'].cells[1].statusCounts.killed, 1);
    assert.equal(rows['2026Q1'].cells[0].count, 1);
    assert.equal(rows['2026Q1'].cells[1].count, 0);
    assert.equal(withOverflow.totals.resolvedWithDate, 4);

    const withoutOverflow = buildCohortGridModel(OVERFLOW_ISSUES, { groupBy: 'quarter', maxColumns: 12, rangeStartDate: '2022-01-01', rangeEndDate: '2026-12-31' });
    assert.deepEqual(withoutOverflow.columns.map((column) => column.label), ['Q+0']);
    assert.equal(withoutOverflow.totals.resolvedWithDate, 1);
    assert.equal(withoutOverflow.rows.find((row) => row.key === '2022Q1').totalCreated, 2);
});

test('overflow column uses the month budget label and only exists when something overflows', async () => {
    const { buildCohortGridModel } = await import('../frontend/src/cohort/cohortUtils.js');
    const month = buildCohortGridModel(OVERFLOW_ISSUES, { groupBy: 'month', maxColumns: 24, overflowColumn: true, rangeStartDate: '2022-01-01', rangeEndDate: '2026-12-31' });
    assert.equal(month.columns[month.columns.length - 1].label, 'M+24+');
    const inBudgetOnly = buildCohortGridModel([OVERFLOW_ISSUES[3]], { groupBy: 'quarter', maxColumns: 12, overflowColumn: true, rangeStartDate: '2026-01-01', rangeEndDate: '2026-12-31' });
    assert.deepEqual(inBudgetOnly.columns.map((column) => column.label), ['Q+0']);
});
