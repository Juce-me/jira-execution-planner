const test = require('node:test');
const assert = require('node:assert/strict');

function story(key, epicKey, issueType = 'Story') {
    return {
        key,
        fields: {
            epicKey,
            issuetype: { name: issueType }
        }
    };
}

test('collectJiraExportKeysFromTasks returns unique sorted epic and story keys from visible tasks', async () => {
    const {
        collectJiraExportKeysFromTasks,
        buildJiraKeyInJql,
        buildJiraIssueSearchUrl
    } = await import('../frontend/src/jiraExportUtils.mjs');
    const tasks = [
        story('APP-2', 'APP-10'),
        story('APP-1', 'APP-10'),
        story('APP-3', 'APP-11'),
        story('APP-4', ''),
        story('APP-5', 'APP-12', 'Bug')
    ];

    assert.deepEqual(collectJiraExportKeysFromTasks(tasks, 'epics'), ['APP-10', 'APP-11', 'APP-12']);
    assert.deepEqual(collectJiraExportKeysFromTasks(tasks, 'stories'), ['APP-1', 'APP-2', 'APP-3', 'APP-4']);
    assert.equal(buildJiraKeyInJql(['APP-2', 'APP-1']), 'key in (APP-1, APP-2)');
    assert.equal(
        buildJiraIssueSearchUrl('https://jira.example.com/', ['APP-2', 'APP-1']),
        'https://jira.example.com/issues/?jql=key%20in%20(APP-1%2C%20APP-2)'
    );
});

test('collectJiraExportKeysFromEpmRollupBoards walks rendered rollup boards without duplicates', async () => {
    const { collectJiraExportKeysFromEpmRollupBoards } = await import('../frontend/src/jiraExportUtils.mjs');
    const boards = [
        {
            project: { id: 'p1' },
            tree: {
                kind: 'tree',
                initiatives: [
                    {
                        issue: { key: 'INIT-1' },
                        epics: [
                            {
                                issue: { key: 'EPIC-2' },
                                stories: [{ key: 'STORY-2' }, { key: 'STORY-1' }]
                            }
                        ],
                        looseStories: [{ key: 'STORY-3' }]
                    }
                ],
                rootEpics: [
                    {
                        issue: { key: 'EPIC-1' },
                        stories: [{ key: 'STORY-1' }]
                    }
                ],
                orphanStories: [{ key: 'STORY-4' }]
            }
        },
        {
            project: { id: 'p2' },
            tree: { kind: 'metadataOnly' }
        }
    ];

    assert.deepEqual(collectJiraExportKeysFromEpmRollupBoards(boards, 'epics'), ['EPIC-1', 'EPIC-2']);
    assert.deepEqual(collectJiraExportKeysFromEpmRollupBoards(boards, 'stories'), ['STORY-1', 'STORY-2', 'STORY-3', 'STORY-4']);
});

test('collectJiraExportKeysFromScenarioIssues can export visible epics or story keys', async () => {
    const { collectJiraExportKeysFromScenarioIssues } = await import('../frontend/src/jiraExportUtils.mjs');
    const issues = [
        { key: 'STORY-3', epicKey: 'EPIC-2' },
        { key: 'STORY-1', epicKey: 'EPIC-1' },
        { key: 'STORY-2', epicKey: 'EPIC-1' }
    ];

    assert.deepEqual(collectJiraExportKeysFromScenarioIssues(issues, 'epics'), ['EPIC-1', 'EPIC-2']);
    assert.deepEqual(collectJiraExportKeysFromScenarioIssues(issues, 'stories'), ['STORY-1', 'STORY-2', 'STORY-3']);
});
