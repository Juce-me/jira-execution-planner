const test = require('node:test');
const assert = require('node:assert/strict');

test('future sprint in customfield_10101 is not treated as backlog', () => {
    return import('../frontend/src/backlogAlertSprintUtils.mjs').then(({
        epicHasExplicitlyEmptySprintValue,
        epicMatchesSelectedSprint
    }) => {
        const epic = {
            key: 'EPIC-1',
            fields: {
                customfield_10101: [{ id: 456, name: 'Sprint 46' }]
            }
        };

        assert.equal(epicHasExplicitlyEmptySprintValue(epic), false);
        assert.equal(
            epicMatchesSelectedSprint(epic, { selectedSprint: '123', selectedSprintName: 'Sprint 45' }),
            false
        );
    });
});

test('explicitly empty sprint value is treated as backlog', () => {
    return import('../frontend/src/backlogAlertSprintUtils.mjs').then(({
        epicHasExplicitlyEmptySprintValue
    }) => {
        const epic = {
            key: 'EPIC-2',
            fields: {
                customfield_10101: null
            }
        };

        assert.equal(epicHasExplicitlyEmptySprintValue(epic), true);
    });
});

test('remote backlog candidates are filtered to explicit empty sprint values only', () => {
    return import('../frontend/src/backlogAlertSprintUtils.mjs').then(({
        filterExplicitBacklogEpics
    }) => {
        const epics = [
            {
                key: 'EPIC-1',
                fields: {
                    customfield_10101: [{ id: 456, name: 'Sprint 46' }]
                }
            },
            {
                key: 'EPIC-2',
                fields: {
                    customfield_10101: null
                }
            }
        ];

        assert.deepEqual(
            filterExplicitBacklogEpics(epics).map((epic) => epic.key),
            ['EPIC-2']
        );
    });
});

test('selected sprint matching accepts raw Jira sprint strings on child stories', () => {
    return import('../frontend/src/backlogAlertSprintUtils.mjs').then(({
        issueMatchesSelectedSprint
    }) => {
        const story = {
            key: 'STORY-1',
            fields: {
                customfield_10101: [
                    'com.atlassian.greenhopper.service.sprint.Sprint@123[id=456,rapidViewId=12,state=FUTURE,name=2026Q2,startDate=2026-04-01T00:00:00.000Z,endDate=2026-06-30T00:00:00.000Z]'
                ]
            }
        };

        assert.equal(
            issueMatchesSelectedSprint(story, {
                selectedSprint: '456',
                selectedSprintName: '2026Q2'
            }),
            true
        );
    });
});
