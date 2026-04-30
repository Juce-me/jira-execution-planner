const assert = require('assert');
const path = require('path');
const test = require('node:test');
const { pathToFileURL } = require('url');

const helperUrl = pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs')).href;

test('filterEpmProjectsForTab uses strict lifecycle buckets outside active', async () => {
    const { filterEpmProjectsForTab } = await import(helperUrl);
    const projects = [
        { id: 'all-project', tabBucket: 'all' },
        { id: 'active-project', tabBucket: 'active' },
        { id: 'backlog-project', tabBucket: 'backlog' },
        { id: 'pending-state-project', stateValue: 'PENDING' },
        { id: 'paused-state-project', stateLabel: 'Paused' },
        { id: 'archived-project', tabBucket: 'archived' },
        { id: 'completed-state-project', stateValue: 'COMPLETED' },
        { id: 'empty-project', tabBucket: '' },
        { id: 'missing-project' }
    ];

    assert.deepStrictEqual(
        filterEpmProjectsForTab(projects, 'active').map(project => project.id),
        ['all-project', 'active-project']
    );
    assert.deepStrictEqual(
        filterEpmProjectsForTab(projects, 'backlog').map(project => project.id),
        ['backlog-project', 'pending-state-project', 'paused-state-project']
    );
    assert.deepStrictEqual(
        filterEpmProjectsForTab(projects, 'archived').map(project => project.id),
        ['archived-project', 'completed-state-project']
    );
});

test('filterEpmRollupBoardsForSearch narrows EPM boards by project, label, update, and issue text', async () => {
    const { filterEpmRollupBoardsForSearch } = await import(helperUrl);
    const boards = [
        {
            project: {
                id: 'project-a',
                displayName: 'Data Partnership: Support Revenue Share Fee Model',
                label: 'rnd_project_data_partnerships_ui',
                latestUpdateSnippet: 'Finance Gateway handoff is on track'
            },
            tree: {
                kind: 'tree',
                initiatives: [],
                rootEpics: [
                    {
                        issue: { key: 'PRODUCT-32946', summary: 'Data partnership UI' },
                        stories: [{ key: 'PRODUCT-36553', summary: 'Data Partnership JSON Support' }]
                    }
                ],
                orphanStories: []
            }
        },
        {
            project: {
                id: 'project-b',
                displayName: 'Pubcid2LR mapping',
                label: 'rnd_project_bsw_pubcid2lr_mapping',
                latestUpdateSnippet: 'Final update'
            },
            tree: {
                kind: 'tree',
                initiatives: [],
                rootEpics: [],
                orphanStories: [{ key: 'PRODUCT-31722', summary: 'Assess the cost of pubcid2lr collection' }]
            }
        }
    ];

    assert.deepStrictEqual(
        filterEpmRollupBoardsForSearch(boards, 'data partnership').map(board => board.project.id),
        ['project-a']
    );
    assert.deepStrictEqual(
        filterEpmRollupBoardsForSearch(boards, 'PRODUCT-31722').map(board => board.project.id),
        ['project-b']
    );
    assert.deepStrictEqual(
        filterEpmRollupBoardsForSearch(boards, 'missing').map(board => board.project.id),
        []
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

test('EPM rollup issues adapt to ENG task cards and dependency lookup', async () => {
    const { buildEpmEngEpicGroup, toEpmEngTask, flattenEpmRollupBoardsForDependencies } = await import(helperUrl);
    const story = {
        id: '30001',
        key: 'PRODUCT-30001',
        summary: 'Generate RFP outline',
        status: 'In Progress',
        priority: 'High',
        assignee: 'Alex',
        storyPoints: 3,
        updated: '2026-04-28T12:00:00.000+0000',
        teamName: 'Team A',
        teamId: 'team-a',
        issueType: 'Story'
    };
    const task = toEpmEngTask(story);

    assert.strictEqual(task.id, '30001');
    assert.strictEqual(task.key, 'PRODUCT-30001');
    assert.strictEqual(task.fields.summary, 'Generate RFP outline');
    assert.strictEqual(task.fields.status.name, 'In Progress');
    assert.strictEqual(task.fields.priority.name, 'High');
    assert.strictEqual(task.fields.assignee.displayName, 'Alex');
    assert.strictEqual(task.fields.customfield_10004, 3);
    assert.strictEqual(task.fields.teamName, 'Team A');
    assert.strictEqual(task.fields.teamId, 'team-a');

    const epicGroup = buildEpmEngEpicGroup({
        issue: { key: 'PRODUCT-29920', issueType: 'Epic', summary: 'AI for RFP creation', assignee: 'Aleksandr Petrovskii' },
        stories: [story]
    });
    assert.strictEqual(epicGroup.key, 'PRODUCT-29920');
    assert.strictEqual(epicGroup.epic.summary, 'AI for RFP creation');
    assert.strictEqual(epicGroup.storyPoints, 3);
    assert.strictEqual(epicGroup.tasks[0].key, 'PRODUCT-30001');

    const dependencyTasks = flattenEpmRollupBoardsForDependencies([
        {
            tree: {
                kind: 'tree',
                initiatives: [],
                rootEpics: [{ issue: { key: 'PRODUCT-29920', issueType: 'Epic', summary: 'AI for RFP creation' }, stories: [story] }],
                orphanStories: []
            }
        }
    ]);
    assert.deepStrictEqual(dependencyTasks.map(item => item.key), ['PRODUCT-29920', 'PRODUCT-30001']);
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

test('hydrateEpmProjectDraft fills blank draft name and label from Home project', async () => {
    const { hydrateEpmProjectDraft } = await import(helperUrl);

    const row = hydrateEpmProjectDraft(
        {
            id: 'home-1',
            homeProjectId: 'home-1',
            homeName: 'Pubcid for lastimp signal',
            name: '',
            label: ''
        },
        {
            name: 'Pubcid for lastimp signal',
            label: 'rnd_project_pubcid_lastimp'
        }
    );

    assert.strictEqual(row.name, 'Pubcid for lastimp signal');
    assert.strictEqual(row.label, 'rnd_project_pubcid_lastimp');
    assert.strictEqual(row.displayName, 'Pubcid for lastimp signal');
});

test('sortEpmSettingsProjects defaults to status-first sorting without mutating input', async () => {
    const { sortEpmSettingsProjects } = await import(helperUrl);
    const projects = [
        { id: 'b', displayName: 'Beta', stateLabel: 'Pending', label: '' },
        { id: 'c', displayName: 'Alpha', stateValue: 'ON_TRACK', label: 'rnd_project_alpha' },
        { id: 'a', displayName: 'Gamma', stateLabel: 'Archived', label: 'rnd_project_gamma' },
        { id: 'd', displayName: 'Delta', stateLabel: '', label: 'rnd_project_delta' }
    ];

    assert.deepStrictEqual(
        sortEpmSettingsProjects(projects).map(project => project.id),
        ['c', 'b', 'a', 'd']
    );
    assert.deepStrictEqual(
        sortEpmSettingsProjects(projects, 'name').map(project => project.id),
        ['c', 'b', 'd', 'a']
    );
    assert.deepStrictEqual(
        sortEpmSettingsProjects(projects, 'status').map(project => project.id),
        ['c', 'b', 'a', 'd']
    );
    assert.deepStrictEqual(
        sortEpmSettingsProjects(projects, 'label').map(project => project.id),
        ['c', 'd', 'a', 'b']
    );
    assert.deepStrictEqual(projects.map(project => project.id), ['b', 'c', 'a', 'd']);
});

test('filterEpmSettingsProjectsForView hides archived Home projects from Current', async () => {
    const { filterEpmSettingsProjectsForView } = await import(helperUrl);
    const projects = [
        { id: 'on-track', tabBucket: 'active', stateValue: 'ON_TRACK' },
        { id: 'completed', tabBucket: 'archived', stateValue: 'COMPLETED' },
        { id: 'cancelled', stateLabel: 'Cancelled' },
        { id: 'custom', tabBucket: 'all', homeProjectId: null },
        { id: 'missing-home', tabBucket: 'all', missingFromHomeFetch: true, homeProjectId: 'home-1' }
    ];

    assert.deepStrictEqual(
        filterEpmSettingsProjectsForView(projects, 'current').map(project => project.id),
        ['on-track', 'custom', 'missing-home']
    );
    assert.deepStrictEqual(
        filterEpmSettingsProjectsForView(projects, 'archived').map(project => project.id),
        ['completed', 'cancelled']
    );
    assert.deepStrictEqual(
        filterEpmSettingsProjectsForView(projects, 'all').map(project => project.id),
        ['on-track', 'completed', 'cancelled', 'custom', 'missing-home']
    );
});

test('buildEpmProjectUpdateLine uses relative dates and status fallback', async () => {
    const { buildEpmProjectUpdateLine } = await import(helperUrl);
    const now = new Date('2026-04-30T12:00:00Z');

    assert.deepStrictEqual(
        buildEpmProjectUpdateLine({
            latestUpdateDate: '2026-04-16',
            latestUpdateSnippet: '[on track] Work is progressing',
            stateLabel: 'On track'
        }, now),
        {
            text: '2 weeks ago · [on track] Work is progressing',
            title: '2026-04-16',
            relativeDate: '2 weeks ago',
            message: '[on track] Work is progressing'
        }
    );
    assert.deepStrictEqual(
        buildEpmProjectUpdateLine({
            latestUpdateDate: '2026-04-30',
            latestUpdateSnippet: '',
            stateLabel: 'Pending'
        }, now),
        {
            text: 'today · Status is pending.',
            title: '2026-04-30',
            relativeDate: 'today',
            message: 'Status is pending.'
        }
    );
    assert.deepStrictEqual(
        buildEpmProjectUpdateLine({ stateValue: 'ON_TRACK' }, now),
        {
            text: 'Status is on track.',
            title: '',
            relativeDate: '',
            message: 'Status is on track.'
        }
    );
});

test('buildEpmProjectUpdateLine exposes formatted Home update html when available', async () => {
    const { buildEpmProjectUpdateLine } = await import(helperUrl);
    const now = new Date('2026-04-30T12:00:00Z');

    assert.deepStrictEqual(
        buildEpmProjectUpdateLine({
            latestUpdateDate: '2026-04-29',
            latestUpdateSnippet: 'Build ready and linked.',
            latestUpdateHtml: '<p><strong>Build ready</strong> and <a href="https://example.test">linked</a>.</p>'
        }, now),
        {
            text: 'yesterday · Build ready and linked.',
            title: '2026-04-29',
            relativeDate: 'yesterday',
            message: 'Build ready and linked.',
            messageHtml: '<p><strong>Build ready</strong> and <a href="https://example.test">linked</a>.</p>'
        }
    );
});

test('empty custom EPM project rows are disposable before save', async () => {
    const { isEmptyCustomEpmProjectRow } = await import(helperUrl);

    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'draft-1', homeProjectId: null, name: '', label: '' }),
        true
    );
    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'draft-2', homeProjectId: null, name: '  ', label: '   ' }),
        true
    );
    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'legacy-empty-1', name: '', label: '' }),
        true
    );
    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'legacy-empty-2', homeProjectId: '', name: '', label: '' }),
        true
    );
    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'home-1', homeProjectId: 'home-1', name: '', label: '' }),
        false
    );
    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'draft-3', homeProjectId: null, name: 'Custom project', label: '' }),
        false
    );
    assert.strictEqual(
        isEmptyCustomEpmProjectRow({ id: 'draft-4', homeProjectId: null, name: '', label: 'rnd_project_custom' }),
        false
    );
});
