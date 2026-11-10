const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/planningSelectionStats.js');
}

function task(key, fields = {}) {
    return { key, fields };
}

const normalizeEpicKey = value => String(value || '').trim().toUpperCase();
const techProjectKeys = new Set(['TECH']);
const getTeamInfo = issue => ({
    id: issue.fields.teamId || 'unknown',
    name: issue.fields.teamName || 'Unknown'
});

test('buildSelectedPlanningTasksList excludes normalized epic keys', async () => {
    const { buildSelectedPlanningTasksList } = await loadUtils();
    const tasks = [
        task('PROD-1', { epicKey: 'ep-1' }),
        task('PROD-2', { epicKey: 'keep-1' }),
        task('PROD-3', {})
    ];

    assert.deepEqual(
        buildSelectedPlanningTasksList(tasks, new Set(['EP-1', 'NO_EPIC']), normalizeEpicKey),
        [tasks[1]]
    );
});

test('sumPlanningStoryPoints preserves invalid and missing story point behavior', async () => {
    const { sumPlanningStoryPoints } = await loadUtils();

    assert.equal(
        sumPlanningStoryPoints([
            task('PROD-1', { customfield_10004: '3.5' }),
            task('PROD-2', { customfield_10004: 'not-a-number' }),
            task('PROD-3', {})
        ]),
        3.5
    );
});

test('buildSelectedTeamStats preserves team names and story point totals', async () => {
    const { buildSelectedTeamStats } = await loadUtils();

    assert.deepEqual(
        buildSelectedTeamStats([
            task('PROD-1', { teamId: 'team-a', teamName: 'Team A', customfield_10004: '2' }),
            task('PROD-2', { teamId: 'team-a', teamName: 'Team A', customfield_10004: 'bad' }),
            task('PROD-3', { teamId: 'team-b', teamName: 'Team B', customfield_10004: '5' })
        ], getTeamInfo),
        {
            'team-a': { name: 'Team A', storyPoints: 2 },
            'team-b': { name: 'Team B', storyPoints: 5 }
        }
    );
});

test('project stats use explicit project key or task key fallback buckets', async () => {
    const { buildSelectedProjectStats, buildExcludedProjectStats } = await loadUtils();
    const tasks = [
        task('TECH-1', { customfield_10004: '8', epicKey: 'ep-1' }),
        task('PROD-1', { projectKey: 'PROD', customfield_10004: '3', epicKey: 'ep-2' }),
        task('TECH-2', { customfield_10004: 'bad', epicKey: 'ep-1' })
    ];

    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys), {
        TECH: 8,
        PRODUCT: 3
    });
    assert.deepEqual(
        buildExcludedProjectStats(tasks, new Set(['EP-1']), techProjectKeys, normalizeEpicKey),
        { TECH: 8 }
    );
});

test('buildSelectedTeamProjectStats buckets product and tech by team', async () => {
    const { buildSelectedTeamProjectStats } = await loadUtils();

    assert.deepEqual(
        buildSelectedTeamProjectStats([
            task('TECH-1', { teamId: 'team-a', teamName: 'Team A', customfield_10004: '8' }),
            task('PROD-1', { teamId: 'team-a', teamName: 'Team A', projectKey: 'PROD', customfield_10004: '3' }),
            task('TECH-2', { teamId: 'team-b', teamName: 'Team B', customfield_10004: '5' })
        ], getTeamInfo, techProjectKeys),
        {
            'team-a': { product: 3, tech: 8 },
            'team-b': { product: 0, tech: 5 }
        }
    );
});

test('Ad Hoc epics count Tech-project stories as Product in selected stats', async () => {
    const { buildSelectedProjectStats, buildSelectedTeamProjectStats } = await loadUtils();
    const adHocEpicSet = new Set(['ADHOC-1']);
    const tasks = [
        task('TECH-1', { customfield_10004: '8', epicKey: 'adhoc-1', teamId: 'team-a', teamName: 'Team A' }),
        task('TECH-2', { customfield_10004: '5', epicKey: 'ep-9', teamId: 'team-a', teamName: 'Team A' }),
        task('PROD-1', { projectKey: 'PROD', customfield_10004: '3', epicKey: 'ep-2', teamId: 'team-a', teamName: 'Team A' })
    ];

    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys, adHocEpicSet), {
        TECH: 5,
        PRODUCT: 11
    });
    assert.deepEqual(buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys, adHocEpicSet), {
        'team-a': { product: 11, tech: 5 }
    });
});

test('empty Ad Hoc set leaves selected stats classification unchanged', async () => {
    const { buildSelectedProjectStats, buildExcludedProjectStats } = await loadUtils();
    const tasks = [
        task('TECH-1', { customfield_10004: '8', epicKey: 'adhoc-1' }),
        task('PROD-1', { projectKey: 'PROD', customfield_10004: '3', epicKey: 'ep-2' })
    ];

    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys), {
        TECH: 8,
        PRODUCT: 3
    });
    // buildExcludedProjectStats stays excluded-only and never accepts Ad Hoc keys.
    assert.deepEqual(
        buildExcludedProjectStats(tasks, new Set(['ADHOC-1']), techProjectKeys, normalizeEpicKey),
        { TECH: 8 }
    );
});

test('all reducer totals normalize binary drift only for integer hundredths', async () => {
    const {
        sumPlanningStoryPoints,
        buildSelectedTeamStats,
        buildSelectedProjectStats,
        buildSelectedTeamProjectStats,
        buildExcludedProjectStats,
    } = await loadUtils();
    const tenths = [
        task('PROD-1', { projectKey: 'PROD', epicKey: 'EP-1', teamId: 'team-a', teamName: 'Team A', customfield_10004: 0.1 }),
        task('PROD-2', { projectKey: 'PROD', epicKey: 'EP-1', teamId: 'team-a', teamName: 'Team A', customfield_10004: 0.2 }),
    ];

    assert.equal(sumPlanningStoryPoints(tenths), 0.3);
    assert.equal(buildSelectedTeamStats(tenths, getTeamInfo)['team-a'].storyPoints, 0.3);
    assert.equal(buildSelectedProjectStats(tenths, techProjectKeys).PRODUCT, 0.3);
    assert.equal(buildSelectedTeamProjectStats(tenths, getTeamInfo, techProjectKeys)['team-a'].product, 0.3);
    assert.equal(buildExcludedProjectStats(tenths, new Set(['EP-1']), techProjectKeys, normalizeEpicKey).PRODUCT, 0.3);

    const hundredths = [
        task('PROD-5', { projectKey: 'PROD', teamId: 'team-a', teamName: 'Team A', customfield_10004: 0.07 }),
        task('PROD-6', { projectKey: 'PROD', teamId: 'team-a', teamName: 'Team A', customfield_10004: 0.14 }),
    ];
    assert.notEqual(0.07 + 0.14, 0.21, 'the fixture drifts as a float sum');
    assert.equal(sumPlanningStoryPoints(hundredths), 0.21);
    assert.equal(buildSelectedTeamStats(hundredths, getTeamInfo)['team-a'].storyPoints, 0.21);

    const precise = [task('PROD-3', { customfield_10004: 1.234 }), task('PROD-4', { customfield_10004: 0.2 })];
    assert.equal(sumPlanningStoryPoints(precise), 1.434);
});

test('edited fractional story points recalculate selected fixtures without changing selection inputs', async () => {
    const { sumPlanningStoryPoints, buildSelectedPlanningTasksList } = await loadUtils();
    const { applyLocalIssueFieldUpdate } = await import('../frontend/src/eng/engIssueLocalUpdates.js');
    const stories = [
        task('DEMO-1', { epicKey: 'EP-1', customfield_10004: 1.5 }),
        task('DEMO-2', { epicKey: 'EP-2', customfield_10004: 3 }),
        task('DEMO-3', { epicKey: 'EXCLUDED-1', customfield_10004: 0 }),
        task('DEMO-4', { epicKey: 'EP-4', customfield_10004: null }),
    ];
    const selectedKeys = { 'DEMO-1': true, 'DEMO-2': true };
    const updated = applyLocalIssueFieldUpdate(stories, 'DEMO-1', 'customfield_10004', 2);

    assert.equal(sumPlanningStoryPoints(updated.filter(item => selectedKeys[item.key])), 5);
    assert.equal(sumPlanningStoryPoints(updated.filter(item => item.key === 'DEMO-2')), 3);
    assert.equal(sumPlanningStoryPoints(buildSelectedPlanningTasksList(updated, new Set(['EXCLUDED-1']), normalizeEpicKey)), 5);
    assert.deepEqual(selectedKeys, { 'DEMO-1': true, 'DEMO-2': true });
    assert.equal(stories[0].fields.customfield_10004, 1.5);
});

test('new model buckets selected, team-project and excluded stats by the Allocation stamp, never OTHER', async () => {
    const { buildSelectedProjectStats, buildSelectedTeamProjectStats, buildExcludedProjectStats } = await loadUtils();
    const tasks = [
        task('PLAN-E1', { teamId: 'team-a', teamName: 'Team A', epicKey: 'PLAN-I1', customfield_10004: 8, projectClassification: 'tech' }),
        task('PLAN-E2', { teamId: 'team-a', teamName: 'Team A', epicKey: 'PLAN-I1', customfield_10004: 3 }),
    ];

    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys, new Set()), { TECH: 8, PRODUCT: 3 });
    assert.deepEqual(buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys, new Set()), { 'team-a': { product: 3, tech: 8 } });
    assert.deepEqual(buildExcludedProjectStats(tasks, new Set(['PLAN-I1']), techProjectKeys, normalizeEpicKey), { TECH: 8, PRODUCT: 3 });
    // Ad Hoc follows the Allocation stamp; only the unstamped (Legacy-path) task falls to Product.
    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys, new Set(['PLAN-I1'])), { TECH: 8, PRODUCT: 3 });
});

test('new model buckets include No Allocation', async () => {
    const { buildSelectedProjectStats, buildSelectedTeamProjectStats, buildExcludedProjectStats } = await loadUtils();
    const tasks = [
        task('PLAN-E1', { teamId: 'team-a', teamName: 'Team A', epicKey: 'PLAN-I1', customfield_10004: 8, projectClassification: 'tech' }),
        task('PLAN-E2', { teamId: 'team-a', teamName: 'Team A', epicKey: 'PLAN-I2', customfield_10004: 3, projectClassification: 'product' }),
        task('TECH-E3', { teamId: 'team-a', teamName: 'Team A', epicKey: 'PLAN-I3', customfield_10004: 5, projectClassification: 'none' }),
    ];

    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys, new Set()), { TECH: 8, PRODUCT: 3, NONE: 5 });
    assert.deepEqual(buildSelectedTeamProjectStats(tasks, getTeamInfo, techProjectKeys, new Set()), { 'team-a': { product: 3, tech: 8, none: 5 } });
    assert.deepEqual(buildExcludedProjectStats(tasks, new Set(['PLAN-I3']), techProjectKeys, normalizeEpicKey), { NONE: 5 });
    // Ad Hoc No Allocation work stays No Allocation.
    assert.deepEqual(buildSelectedProjectStats(tasks, techProjectKeys, new Set(['PLAN-I3'])), { TECH: 8, PRODUCT: 3, NONE: 5 });
    // Legacy (no stamp): exactly the current keys, never NONE.
    const legacy = [task('TECH-1', { teamId: 'team-a', epicKey: 'EP-1', customfield_10004: 2 }), task('PROD-1', { teamId: 'team-a', epicKey: 'EP-2', customfield_10004: 1 })];
    assert.deepEqual(buildSelectedProjectStats(legacy, techProjectKeys, new Set()), { TECH: 2, PRODUCT: 1 });
    assert.deepEqual(buildSelectedTeamProjectStats(legacy, getTeamInfo, techProjectKeys, new Set()), { 'team-a': { product: 1, tech: 2 } });
});

test('shared plan totals retain hidden included work, deduplicate IDs and follow Team rather than filters', async () => {
    const { buildPlanningSelectionSummary } = await loadUtils();
    const a = { id: '1', ...task('SYN-1', { teamId: 'a', customfield_10004: 3 }) };
    const b = { id: '2', ...task('SYN-2', { teamId: 'a', customfield_10004: 5 }) };
    const other = { id: '3', ...task('SYN-3', { teamId: 'b', customfield_10004: 8 }) };
    const result = buildPlanningSelectionSummary({ tasks: [a, b, other, a], shownTasks: [a], selectedTasks: { 'SYN-1': true, 'SYN-2': true, 'SYN-3': true }, selectedTeamIds: new Set(['a']), allTeams: false, getTeamInfo });
    assert.deepEqual(result.selectedTasks, [a, b]);
    assert.deepEqual([result.count, result.sp, result.hiddenCount], [2, 8, 1]);
});

test('planned effort distinguishes missing estimates from an explicit zero', async () => {
    const { buildPlanningSelectionSummary } = await loadUtils();
    const tasks = [0, null, 'invalid'].map((value, index) => ({ id: String(index + 1), ...task('SYN-' + (index + 1), { customfield_10004: value }) }));
    const result = buildPlanningSelectionSummary({ tasks, shownTasks: tasks, selectedTasks: Object.fromEntries(tasks.map(issue => [issue.key, true])), selectedTeamIds: new Set(), allTeams: true, getTeamInfo });
    assert.equal(result.sp, 0);
    assert.equal(result.count, 3);
    assert.equal(result.missingEstimateCount, 2);
});
