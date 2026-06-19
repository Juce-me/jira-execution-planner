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

test('filterCohortIssues narrows to tagged ad_hoc records and drops untagged ones', async () => {
    const { filterCohortIssues } = await import('../frontend/src/cohort/cohortUtils.js');
    const issues = [
        { key: 'EPIC-1', status: 'open', capacityType: 'ad_hoc' },
        { key: 'EPIC-2', status: 'open', capacityType: 'product' },
        { key: 'EPIC-3', status: 'open' },
    ];

    // No capacity filter: every issue passes, including untagged ones.
    assert.equal(filterCohortIssues(issues).length, 3);
    assert.equal(filterCohortIssues(issues, { capacityType: 'all' }).length, 3);

    // ad_hoc filter keeps only tagged ad_hoc records; untagged and other-typed records are dropped.
    const adHocOnly = filterCohortIssues(issues, { capacityType: 'ad_hoc' });
    assert.deepEqual(adHocOnly.map((issue) => issue.key), ['EPIC-1']);
});

test('Tech-project ad_hoc epic stays visible by key and only leaves on a different project', async () => {
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

    // Selectable via the Ad Hoc capacity filter: the tagged Tech-project epic
    // stays in view, and the untagged ordinary Product epic is hidden.
    const adHocSelected = filterCohortIssues(issues, { capacityType: 'ad_hoc' });
    assert.deepEqual(adHocSelected.map((issue) => issue.key), ['TECH-9']);

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
