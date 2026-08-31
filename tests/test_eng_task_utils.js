const test = require('node:test');
const assert = require('node:assert/strict');

test('epics in scope can match active group by configured team label', async () => {
    const { filterEpicsInScopeForTeamSet } = await import('../frontend/src/eng/engTaskUtils.js');

    const activeGroupTeamIds = ['team-alpha', 'team-beta'];
    const activeGroupTeamSet = new Set(activeGroupTeamIds);
    const activeGroupTeamLabels = {
        'team-alpha': 'team_alpha_label',
        'team-beta': 'team_beta_label'
    };
    const epics = [
        {
            key: 'PRODUCT-1',
            teamId: 'product-team',
            teamName: 'Product Team',
            labels: ['2026Q3', 'team_alpha_label']
        },
        {
            key: 'PRODUCT-2',
            teamId: 'product-team',
            teamName: 'Product Team',
            labels: ['2026Q3', 'other_label']
        }
    ];

    assert.deepEqual(
        filterEpicsInScopeForTeamSet(epics, activeGroupTeamIds, activeGroupTeamSet, activeGroupTeamLabels)
            .map(epic => epic.key),
        ['PRODUCT-1']
    );
});

test('ENG search expands Initiative and Epic matches to loaded descendant stories', async () => {
    const { matchesEngTaskSearch } = await import('../frontend/src/eng/engTaskUtils.js');
    const task = (key, epicKey, summary, assignee = 'Story Owner') => ({
        key,
        fields: {
            summary,
            epicKey,
            assignee: { displayName: assignee },
        },
    });
    const tasks = [
        task('PROD-1', 'PROD-EPIC-A', 'Gateway story'),
        task('PROD-2', 'PROD-EPIC-A', 'Checkout story'),
        task('PROD-3', 'PROD-EPIC-B', 'Invoice story'),
        task('PROD-4', 'PROD-EPIC-B', 'Refund story'),
        task('TECH-1', 'TECH-EPIC-X', 'Unrelated platform story'),
    ];
    const epicDetails = {
        'PROD-EPIC-A': {
            summary: 'Payments API',
            assignee: { displayName: 'Payments Lead' },
            initiative: { key: 'INIT-42', summary: 'Payments Initiative' },
        },
        'PROD-EPIC-B': {
            summary: 'Payments Experience',
            assignee: { displayName: 'Payments Lead' },
            initiative: { key: 'INIT-42', summary: 'Payments Initiative' },
        },
        'TECH-EPIC-X': {
            summary: 'Platform Maintenance',
            initiative: { key: 'INIT-99', summary: 'Platform Initiative' },
        },
    };
    const matchingKeys = (query) => tasks
        .filter(item => matchesEngTaskSearch(item, query, epicDetails))
        .map(item => item.key);

    assert.deepEqual(matchingKeys('INIT-42'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.deepEqual(matchingKeys('payments initiative'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.deepEqual(matchingKeys('PROD-EPIC-A'), ['PROD-1', 'PROD-2']);
    assert.deepEqual(matchingKeys('payments api'), ['PROD-1', 'PROD-2']);
    assert.deepEqual(matchingKeys('PROD-1'), ['PROD-1']);
    assert.deepEqual(matchingKeys('gateway story'), ['PROD-1']);
    assert.deepEqual(matchingKeys('story owner'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4', 'TECH-1']);
    assert.deepEqual(matchingKeys('payments lead'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.deepEqual(matchingKeys(''), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4', 'TECH-1']);
    assert.equal(matchesEngTaskSearch({ key: 'SAFE-1', fields: {} }, 'missing', {}), false);
});

test('ENG search independently covers hierarchy text and supported assignees', async () => {
    const { matchesEngTaskSearch } = await import('../frontend/src/eng/engTaskUtils.js');
    const story = {
        key: 'STORY-7',
        fields: {
            summary: 'Story summary',
            epicKey: 'EPIC-3',
            assignee: { displayName: 'Story Owner' },
        },
    };
    const epicDetails = {
        'EPIC-3': {
            summary: 'Epic summary',
            assignee: { displayName: 'Epic Owner' },
            initiative: { key: 'INIT-1', summary: 'Initiative summary' },
        },
    };

    assert.equal(matchesEngTaskSearch(story, 'INIT-1', epicDetails), true, 'Initiative key');
    assert.equal(matchesEngTaskSearch(story, 'Initiative summary', epicDetails), true, 'Initiative summary');
    assert.equal(matchesEngTaskSearch(story, 'Epic Owner', epicDetails), true, 'Epic assignee');
    assert.equal(matchesEngTaskSearch(story, 'Story Owner', epicDetails), true, 'Story assignee');
});
