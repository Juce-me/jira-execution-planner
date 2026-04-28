const assert = require('assert');
const path = require('path');
const test = require('node:test');
const { pathToFileURL } = require('url');

const helperUrl = pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs')).href;

test('filterEpmProjectsForTab treats all as wildcard and hides malformed buckets', async () => {
    const { filterEpmProjectsForTab } = await import(helperUrl);
    const projects = [
        { id: 'all-project', tabBucket: 'all' },
        { id: 'active-project', tabBucket: 'active' },
        { id: 'backlog-project', tabBucket: 'backlog' },
        { id: 'archived-project', tabBucket: 'archived' },
        { id: 'empty-project', tabBucket: '' },
        { id: 'missing-project' }
    ];

    assert.deepStrictEqual(
        filterEpmProjectsForTab(projects, 'active').map(project => project.id),
        ['all-project', 'active-project']
    );
    assert.deepStrictEqual(
        filterEpmProjectsForTab(projects, 'backlog').map(project => project.id),
        ['all-project', 'backlog-project']
    );
    assert.deepStrictEqual(
        filterEpmProjectsForTab(projects, 'archived').map(project => project.id),
        ['all-project', 'archived-project']
    );
});

test('buildRollupTree returns metadata-only and empty states distinctly', async () => {
    const { buildRollupTree } = await import(helperUrl);

    assert.deepStrictEqual(buildRollupTree({ metadataOnly: true }), { kind: 'metadataOnly' });
    assert.deepStrictEqual(buildRollupTree({ emptyRollup: true }), { kind: 'emptyRollup' });
});

test('buildRollupTree preserves hierarchy and dedupes repeated issue keys', async () => {
    const { buildRollupTree } = await import(helperUrl);
    const duplicateStory = { key: 'STORY-1', summary: 'Shared story', issueType: 'Story' };
    const tree = buildRollupTree({
        truncated: true,
        truncatedQueries: ['q2'],
        initiatives: {
            'INIT-1': {
                issue: { key: 'INIT-1', summary: 'Initiative', issueType: 'Initiative' },
                epics: {
                    'EPIC-1': {
                        issue: { key: 'EPIC-1', summary: 'Epic', issueType: 'Epic' },
                        stories: [
                            duplicateStory,
                            { key: 'STORY-2', summary: 'Second story', issueType: 'Story' }
                        ]
                    }
                },
                looseStories: [
                    { key: 'STORY-3', summary: 'Loose story', issueType: 'Story' }
                ]
            }
        },
        rootEpics: {
            'EPIC-2': {
                issue: { key: 'EPIC-2', summary: 'Root epic', issueType: 'Epic' },
                stories: [duplicateStory, { key: 'STORY-4', summary: 'Root story', issueType: 'Story' }]
            }
        },
        orphanStories: [
            duplicateStory,
            { key: 'STORY-5', summary: 'Orphan story', issueType: 'Story' }
        ]
    });

    assert.strictEqual(tree.kind, 'tree');
    assert.strictEqual(tree.truncated, true);
    assert.deepStrictEqual(tree.truncatedQueries, ['q2']);
    assert.deepStrictEqual(tree.initiatives.map(node => node.issue.key), ['INIT-1']);
    assert.deepStrictEqual(tree.initiatives[0].epics.map(node => node.issue.key), ['EPIC-1']);
    assert.deepStrictEqual(tree.initiatives[0].epics[0].stories.map(issue => issue.key), ['STORY-1', 'STORY-2']);
    assert.deepStrictEqual(tree.initiatives[0].looseStories.map(issue => issue.key), ['STORY-3']);
    assert.deepStrictEqual(tree.rootEpics[0].stories.map(issue => issue.key), ['STORY-4']);
    assert.deepStrictEqual(tree.orphanStories.map(issue => issue.key), ['STORY-5']);
});

test('buildAggregateRollupBoards normalizes project entries and duplicate metadata', async () => {
    const { buildAggregateRollupBoards } = await import(helperUrl);
    const result = buildAggregateRollupBoards({
        projects: [
            {
                project: { id: 'project-a', displayName: 'Project A' },
                rollup: {
                    initiatives: {},
                    rootEpics: {},
                    orphanStories: [{ key: 'STORY-1', summary: 'Story 1' }]
                }
            },
            {
                project: { id: 'project-b', displayName: 'Project B' },
                rollup: { metadataOnly: true }
            }
        ],
        duplicates: { 'STORY-1': ['project-a', 'project-c'] },
        truncated: true,
        fallback: true
    });

    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.fallback, true);
    assert.deepStrictEqual(result.duplicates, { 'STORY-1': ['project-a', 'project-c'] });
    assert.deepStrictEqual(result.boards.map(board => board.project.id), ['project-a', 'project-b']);
    assert.strictEqual(result.boards[0].tree.kind, 'tree');
    assert.strictEqual(result.boards[1].tree.kind, 'metadataOnly');
});

test('EPM settings project readiness and cache key use sub-goal plus prefix', async () => {
    const {
        getEpmProjectPrerequisites,
        getEpmSettingsProjectsCacheKey,
        isEpmProjectsConfigReady,
        normalizeEpmSettingsKeyPart
    } = await import(helperUrl);

    assert.strictEqual(normalizeEpmSettingsKeyPart(' child-34 '), 'CHILD-34');
    assert.strictEqual(normalizeEpmSettingsKeyPart(null), '');

    const config = {
        labelPrefix: ' rnd_project_ ',
        scope: {
            rootGoalKey: ' root-223 ',
            subGoalKey: ' child-34 '
        }
    };

    assert.strictEqual(isEpmProjectsConfigReady(config), true);
    assert.strictEqual(
        getEpmSettingsProjectsCacheKey(config),
        'ROOT-223::CHILD-34::rnd_project_'
    );

    assert.strictEqual(isEpmProjectsConfigReady({ ...config, labelPrefix: ' ' }), false);
    assert.deepStrictEqual(getEpmProjectPrerequisites({ ...config, labelPrefix: ' ' }), ['labelPrefix']);
    assert.strictEqual(
        isEpmProjectsConfigReady({ ...config, scope: { rootGoalKey: 'ROOT-223', subGoalKey: '' } }),
        false
    );
    assert.deepStrictEqual(
        getEpmProjectPrerequisites({ ...config, scope: { rootGoalKey: 'ROOT-223', subGoalKey: '' } }),
        ['subGoal']
    );
    assert.deepStrictEqual(getEpmProjectPrerequisites({}), ['subGoal', 'labelPrefix']);
    assert.strictEqual(getEpmSettingsProjectsCacheKey({}), '');
});
