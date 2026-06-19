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
