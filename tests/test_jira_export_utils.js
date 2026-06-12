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
        buildJiraIssueSearchUrl,
        buildJiraIssueSearchUrlFromJql,
        buildJiraCohortStatusSearchUrl,
        buildJiraCohortIssueSearchUrl
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
    assert.equal(
        buildJiraIssueSearchUrlFromJql('https://jira.example.com/', 'status = "In Progress"'),
        'https://jira.example.com/issues/?jql=status%20%3D%20%22In%20Progress%22'
    );

    const statusUrl = buildJiraCohortStatusSearchUrl({
        jiraUrl: 'https://jira.example.com/',
        startQuarter: '2026Q2',
        statuses: ['In Progress', 'Postponed', 'Awaiting Validation'],
        issueType: 'Epic'
    });
    const decodedJql = decodeURIComponent(new URL(statusUrl).searchParams.get('jql'));
    assert.equal(
        decodedJql,
        'issuetype = "Epic" AND created >= "2026-04-01" AND status in ("In Progress", "Postponed", "Awaiting Validation")'
    );

    const cohortUrl = buildJiraCohortIssueSearchUrl({
        jiraUrl: 'https://jira.example.com/',
        startQuarter: '2026Q2',
        statuses: ['In Progress', 'Awaiting Validation', 'In Progress'],
        issueType: 'Epic',
        projectKey: 'PROD',
        components: ['Backend API', 'R&D "Data"'],
        teamIds: ['team-alpha', 'team-beta'],
        assigneeKey: 'alpha-lead'
    });
    const cohortJql = decodeURIComponent(new URL(cohortUrl).searchParams.get('jql'));
    assert.equal(
        cohortJql,
        'issuetype = "Epic" AND created >= "2026-04-01" AND project = "PROD" AND status in ("In Progress", "Awaiting Validation") AND component in ("Backend API", "R&D \\"Data\\"") AND "Team[Team]" in ("team-alpha", "team-beta") AND assignee in ("alpha-lead")'
    );
    assert.equal(cohortJql.includes('key in'), false);
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
