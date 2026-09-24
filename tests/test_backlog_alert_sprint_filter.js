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

test('selected sprint label keeps empty-sprint planning epics out of backlog', () => {
    return import('../frontend/src/backlogAlertSprintUtils.mjs').then(({
        epicMatchesSelectedSprint,
        filterExplicitBacklogEpics
    }) => {
        const epic = {
            key: 'EPIC-3',
            labels: ['2026Q3', 'team_alpha_label'],
            fields: {
                customfield_10101: null
            }
        };

        assert.equal(
            epicMatchesSelectedSprint(epic, { selectedSprint: '123', selectedSprintName: '2026Q3' }),
            true
        );
        assert.deepEqual(
            filterExplicitBacklogEpics([epic], { selectedSprint: '123', selectedSprintName: '2026Q3' }),
            []
        );
    });
});

test('future sprint readiness requires the exact selected sprint label', () => {
    return import('../frontend/src/backlogAlertSprintUtils.mjs').then(({
        epicHasSelectedSprintLabel
    }) => {
        const epicWithOnlyJiraSprint = {
            key: 'EPIC-4',
            labels: ['team_alpha_label'],
            fields: {
                customfield_10101: [{ id: 123, name: '2026Q3' }]
            }
        };
        const epicWithSelectedSprintLabel = {
            ...epicWithOnlyJiraSprint,
            labels: ['team_alpha_label', '2026Q3']
        };

        assert.equal(epicHasSelectedSprintLabel(epicWithOnlyJiraSprint, '2026Q3'), false);
        assert.equal(epicHasSelectedSprintLabel(epicWithSelectedSprintLabel, '2026Q3'), true);
    });
});

test('plain and candidate labels admit empty-sprint Epics without treating suffixes as Jira sprints', async () => {
    const { epicHasSelectedSprintLabel, epicMatchesSelectedSprint, filterExplicitBacklogEpics, issueMatchesSelectedSprint } =
        await import('../frontend/src/backlogAlertSprintUtils.mjs');
    for (const label of ['2026Q4', ' 2026Q4_candidate ', '2026Q4_Candidate', '2026Q4_CANDIDATE']) {
        const epic = { key: label, labels: ['team_alpha_label', label], sprint: null };
        assert.equal(epicHasSelectedSprintLabel(epic, ' 2026Q4 '), true, label);
        assert.equal(epicMatchesSelectedSprint(epic, { selectedSprint: '123', selectedSprintName: '2026Q4' }), true, label);
        assert.deepEqual(filterExplicitBacklogEpics([epic], { selectedSprint: '123', selectedSprintName: '2026Q4' }), [], label);
        assert.equal(issueMatchesSelectedSprint(epic, { selectedSprint: '123', selectedSprintName: '2026Q4' }), false, label);
    }
});

test('candidate sprint labels require the complete selected name and exact suffix', async () => {
    const { epicHasSelectedSprintLabel, filterExplicitBacklogEpics } = await import('../frontend/src/backlogAlertSprintUtils.mjs');
    const options = { selectedSprint: '123', selectedSprintName: '2026Q4' };
    for (const label of ['2026Q4_candidate_extra', '2026Q5_candidate', 'prefix_2026Q4_candidate', '2026Q4_candidates']) {
        const epic = { key: label, labels: [label], sprint: null };
        assert.equal(epicHasSelectedSprintLabel(epic, options.selectedSprintName), false, label);
        assert.deepEqual(filterExplicitBacklogEpics([epic], options), [epic], label);
    }
    assert.equal(epicHasSelectedSprintLabel({ labels: ['2026Q4_candidate'] }, ''), false);
    assert.equal(epicHasSelectedSprintLabel({ labels: ['2026Q4_candidate'] }, '2026Q5'), false);
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
