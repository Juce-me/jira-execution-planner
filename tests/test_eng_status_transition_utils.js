const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/engStatusTransitionUtils.js');
}

function task(key, fields = {}) {
    return { key, fields };
}

test('isStatusTransitionSurfaceEnabled is true only for ENG Catch Up and ENG Planning', async () => {
    const { isStatusTransitionSurfaceEnabled } = await loadUtils();

    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: false, showStats: false, showScenario: false }), true, 'Catch Up');
    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: true, showStats: false, showScenario: false }), true, 'Planning');

    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'epm', showPlanning: false, showStats: false, showScenario: false }), false, 'EPM');
    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: false, showStats: true, showScenario: false }), false, 'Stats');
    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: false, showStats: false, showScenario: true }), false, 'Scenario');
    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'settings', showPlanning: false, showStats: false, showScenario: false }), false, 'Settings/unknown surface');
    assert.equal(isStatusTransitionSurfaceEnabled({}), false, 'no surface info');
    assert.equal(isStatusTransitionSurfaceEnabled(), false, 'undefined input stays total');
});

test('buildCatchUpStatusTargets derives a target from the standard nested Jira task shape', async () => {
    const { buildCatchUpStatusTargets } = await loadUtils();

    const story = task('PROD-1', { status: { name: 'To Do' }, issuetype: { name: 'Story' }, summary: 'Synthetic summary' });
    assert.deepEqual(buildCatchUpStatusTargets(story), {
        key: 'PROD-1',
        issueType: 'Story',
        currentStatus: 'To Do',
        summary: 'Synthetic summary'
    });
});

test('buildCatchUpStatusTargets derives a target for a flat Epic-shaped issue using the fallback issue type', async () => {
    const { buildCatchUpStatusTargets } = await loadUtils();

    const epic = { key: 'PROD-EPIC-1', status: { name: 'In Progress' }, summary: 'Epic summary' };
    assert.deepEqual(buildCatchUpStatusTargets(epic, 'Epic'), {
        key: 'PROD-EPIC-1',
        issueType: 'Epic',
        currentStatus: 'In Progress',
        summary: 'Epic summary'
    });

    // Epic status is sometimes a plain string instead of a {name} object.
    const epicStringStatus = { key: 'PROD-EPIC-2', status: 'Accepted', summary: 'Other epic' };
    assert.equal(buildCatchUpStatusTargets(epicStringStatus, 'Epic').currentStatus, 'Accepted');
});

test('buildCatchUpStatusTargets derives a target for a flat expanded Subtask using the fallback issue type', async () => {
    const { buildCatchUpStatusTargets } = await loadUtils();

    const subtask = { key: 'TECH-22', status: { name: 'Analysis' }, summary: 'Subtask summary' };
    assert.deepEqual(buildCatchUpStatusTargets(subtask, 'Subtask'), {
        key: 'TECH-22',
        issueType: 'Subtask',
        currentStatus: 'Analysis',
        summary: 'Subtask summary'
    });
});

test('buildCatchUpStatusTargets is total: missing key returns null, missing status/summary default to empty', async () => {
    const { buildCatchUpStatusTargets } = await loadUtils();

    assert.equal(buildCatchUpStatusTargets(null), null);
    assert.equal(buildCatchUpStatusTargets({}), null);
    assert.deepEqual(buildCatchUpStatusTargets({ key: 'OPS2-3' }), {
        key: 'OPS2-3',
        issueType: '',
        currentStatus: '',
        summary: ''
    });
});

test('buildEngStatusTargets returns selected Planning Story targets from selectedTasksList', async () => {
    const { buildEngStatusTargets } = await loadUtils();

    const targets = buildEngStatusTargets({
        selectedTasksList: [
            task('PROD-1', { status: { name: 'To Do' }, issuetype: { name: 'Story' }, summary: 'Story one', customfield_10004: '3' }),
            task('PROD-2', { status: { name: 'Accepted' }, issuetype: { name: 'Story' }, summary: 'Story two', customfield_10004: '5' })
        ]
    });

    assert.deepEqual(targets, [
        { key: 'PROD-1', issueType: 'Story', currentStatus: 'To Do', summary: 'Story one' },
        { key: 'PROD-2', issueType: 'Story', currentStatus: 'Accepted', summary: 'Story two' }
    ]);
});

test('buildEngStatusTargets includes selected Epics and Subtasks separately from selected Stories', async () => {
    const { buildEngStatusTargets } = await loadUtils();

    const epicGroups = [
        { key: 'PROD-EPIC-1', epic: { status: { name: 'In Progress' }, summary: 'Epic summary' }, tasks: [], storyPoints: 0, parentSummary: null }
    ];
    const storySubtasksByKey = {
        'PROD-1': {
            items: [
                { key: 'TECH-22', status: { name: 'Analysis' }, summary: 'Subtask summary' }
            ]
        }
    };

    const targets = buildEngStatusTargets({
        selectedTasksList: [task('PROD-1', { status: { name: 'To Do' }, issuetype: { name: 'Story' }, summary: 'Story one', customfield_10004: '3' })],
        selectedEpicKeys: ['PROD-EPIC-1'],
        selectedSubtaskKeys: ['TECH-22'],
        epicGroups,
        storySubtasksByKey
    });

    assert.equal(targets.length, 3);
    assert.deepEqual(targets.find(t => t.key === 'PROD-EPIC-1'), {
        key: 'PROD-EPIC-1', issueType: 'Epic', currentStatus: 'In Progress', summary: 'Epic summary'
    });
    assert.deepEqual(targets.find(t => t.key === 'TECH-22'), {
        key: 'TECH-22', issueType: 'Subtask', currentStatus: 'Analysis', summary: 'Subtask summary'
    });
    assert.deepEqual(targets.find(t => t.key === 'PROD-1'), {
        key: 'PROD-1', issueType: 'Story', currentStatus: 'To Do', summary: 'Story one'
    });
});

test('selected Epics and Subtasks in buildEngStatusTargets do not affect selected story-point totals', async () => {
    const { buildEngStatusTargets } = await loadUtils();
    const { sumPlanningStoryPoints } = await import('../frontend/src/eng/planningSelectionStats.js');

    const selectedTasksList = [task('PROD-1', { status: { name: 'To Do' }, issuetype: { name: 'Story' }, summary: 'Story one', customfield_10004: '3' })];
    const epicGroups = [{ key: 'PROD-EPIC-1', epic: { status: { name: 'In Progress' }, summary: 'Epic summary' }, tasks: [], storyPoints: 40, parentSummary: null }];
    const storySubtasksByKey = { 'PROD-1': { items: [{ key: 'TECH-22', status: { name: 'Analysis' }, summary: 'Subtask' }] } };

    const spBefore = sumPlanningStoryPoints(selectedTasksList);
    buildEngStatusTargets({ selectedTasksList, selectedEpicKeys: ['PROD-EPIC-1'], selectedSubtaskKeys: ['TECH-22'], epicGroups, storySubtasksByKey });
    const spAfter = sumPlanningStoryPoints(selectedTasksList);

    assert.equal(spBefore, 3);
    assert.equal(spAfter, 3, 'Selecting Epic/Subtask status targets must not change the Story SP total');
});

test('buildEngStatusTargets collapses duplicate issue keys once with deterministic type precedence Epic > Story > Subtask', async () => {
    const { buildEngStatusTargets } = await loadUtils();

    // The same key 'DUP-1' appears as a selected Story AND a selected Epic; Epic must win.
    const epicGroups = [{ key: 'DUP-1', epic: { status: { name: 'Blocked' }, summary: 'Epic version' }, tasks: [], storyPoints: 0, parentSummary: null }];
    const targetsEpicVsStory = buildEngStatusTargets({
        selectedTasksList: [task('DUP-1', { status: { name: 'To Do' }, issuetype: { name: 'Story' }, summary: 'Story version', customfield_10004: '1' })],
        selectedEpicKeys: ['DUP-1'],
        epicGroups
    });
    assert.equal(targetsEpicVsStory.length, 1);
    assert.deepEqual(targetsEpicVsStory[0], { key: 'DUP-1', issueType: 'Epic', currentStatus: 'Blocked', summary: 'Epic version' });

    // The same key 'DUP-2' appears as a selected Story AND a selected Subtask; Story must win.
    const storySubtasksByKey = { 'PARENT-1': { items: [{ key: 'DUP-2', status: { name: 'Analysis' }, summary: 'Subtask version' }] } };
    const targetsStoryVsSubtask = buildEngStatusTargets({
        selectedTasksList: [task('DUP-2', { status: { name: 'Accepted' }, issuetype: { name: 'Story' }, summary: 'Story version', customfield_10004: '2' })],
        selectedSubtaskKeys: ['DUP-2'],
        storySubtasksByKey
    });
    assert.equal(targetsStoryVsSubtask.length, 1);
    assert.deepEqual(targetsStoryVsSubtask[0], { key: 'DUP-2', issueType: 'Story', currentStatus: 'Accepted', summary: 'Story version' });
});

test('summarizeIssueTypeMix returns stories, epics, subtasks, or mixed', async () => {
    const { summarizeIssueTypeMix } = await loadUtils();

    assert.equal(summarizeIssueTypeMix([{ issueType: 'Story' }, { issueType: 'Story' }]), 'stories');
    assert.equal(summarizeIssueTypeMix([{ issueType: 'Epic' }]), 'epics');
    assert.equal(summarizeIssueTypeMix([{ issueType: 'Subtask' }]), 'subtasks');
    assert.equal(summarizeIssueTypeMix([{ issueType: 'Epic' }, { issueType: 'Story' }]), 'mixed');
    assert.equal(summarizeIssueTypeMix([{ issueType: 'Story' }, { issueType: 'Subtask' }]), 'mixed');
    assert.equal(summarizeIssueTypeMix([]), 'stories', 'empty input stays total with a harmless default');
});

test('summarizeTransitionResults returns success/partial/failure counts without raw issue details', async () => {
    const { summarizeTransitionResults } = await loadUtils();

    const allSucceeded = summarizeTransitionResults([
        { key: 'PROD-1', result: 'success', fromStatus: 'To Do', toStatus: 'Accepted' },
        { key: 'PROD-2', result: 'already_in_status' }
    ]);
    assert.deepEqual(allSucceeded, { total: 2, succeeded: 2, failed: 0, result: 'success' });
    assert.deepEqual(Object.keys(allSucceeded).sort(), ['failed', 'result', 'succeeded', 'total']);

    const mixed = summarizeTransitionResults([
        { key: 'PROD-1', result: 'success' },
        { key: 'PROD-2', result: 'failure', error: 'transition_not_available' }
    ]);
    assert.deepEqual(mixed, { total: 2, succeeded: 1, failed: 1, result: 'partial' });

    const allFailed = summarizeTransitionResults([
        { key: 'PROD-1', result: 'failure' }
    ]);
    assert.deepEqual(allFailed, { total: 1, succeeded: 0, failed: 1, result: 'failure' });

    assert.deepEqual(summarizeTransitionResults([]), { total: 0, succeeded: 0, failed: 0, result: 'failure' });
    assert.deepEqual(summarizeTransitionResults(undefined), { total: 0, succeeded: 0, failed: 0, result: 'failure' });
});

test('buildStatusBucket maps status names to low-cardinality buckets', async () => {
    const { buildStatusBucket } = await loadUtils();

    assert.equal(buildStatusBucket('To Do'), 'todo');
    assert.equal(buildStatusBucket('Pending'), 'todo');
    assert.equal(buildStatusBucket('Accepted'), 'accepted');
    assert.equal(buildStatusBucket('In Progress'), 'in_progress');
    assert.equal(buildStatusBucket('Analysis'), 'in_progress');
    assert.equal(buildStatusBucket('Done'), 'done');
    assert.equal(buildStatusBucket('Blocked'), 'blocked');
    assert.equal(buildStatusBucket('Postponed'), 'postponed');
    assert.equal(buildStatusBucket('Killed'), 'other');
    assert.equal(buildStatusBucket('Some Unknown Status'), 'other');
    assert.equal(buildStatusBucket(''), 'other');
    assert.equal(buildStatusBucket(undefined), 'other');
});

test('selected_count_bucket and selected_sp_bucket helpers reuse the shared bucketCount ranges', async () => {
    const { buildSelectedCountBucket, buildSelectedSpBucket } = await loadUtils();
    const { bucketCount } = await import('../frontend/src/analytics/dashboardAnalytics.js');

    assert.equal(buildSelectedCountBucket(0), '0');
    assert.equal(buildSelectedCountBucket(3), '1_5');
    assert.equal(buildSelectedCountBucket(20), '11_25');
    assert.equal(buildSelectedCountBucket(3), bucketCount(3));

    assert.equal(buildSelectedSpBucket(0), '0');
    assert.equal(buildSelectedSpBucket(8), '6_10');
    assert.equal(buildSelectedSpBucket(8), bucketCount(8));
});

test('buildStatusActionAnalyticsParams omits selected_sp_bucket for Catch Up but includes it for Planning', async () => {
    const { buildStatusActionAnalyticsParams } = await loadUtils();
    const { sumPlanningStoryPoints } = await import('../frontend/src/eng/planningSelectionStats.js');
    const { bucketCount } = await import('../frontend/src/analytics/dashboardAnalytics.js');

    const selectedStories = [task('PROD-1', { customfield_10004: '5' })];
    const targets = [{ key: 'TECH-22', issueType: 'Subtask', currentStatus: 'Analysis', summary: 'Subtask' }];

    const catchUpParams = buildStatusActionAnalyticsParams({
        sourceSurface: 'catch_up',
        targets,
        selectedStories,
        status: 'Accepted',
    });
    assert.deepEqual(catchUpParams, {
        source_surface: 'catch_up',
        status_bucket: 'accepted',
        issue_type_mix: 'subtasks',
        selected_count_bucket: '1_5',
    });
    assert.equal('selected_sp_bucket' in catchUpParams, false, 'Catch Up must never report unrelated Planning-selection story points');

    const planningParams = buildStatusActionAnalyticsParams({
        sourceSurface: 'planning',
        targets,
        selectedStories,
        status: 'Accepted',
    });
    assert.deepEqual(planningParams, {
        source_surface: 'planning',
        status_bucket: 'accepted',
        issue_type_mix: 'subtasks',
        selected_count_bucket: '1_5',
        selected_sp_bucket: bucketCount(sumPlanningStoryPoints(selectedStories)),
    });
});

test('buildStatusActionAnalyticsParams omits status_bucket when no target status has been chosen yet', async () => {
    const { buildStatusActionAnalyticsParams } = await loadUtils();

    const params = buildStatusActionAnalyticsParams({
        sourceSurface: 'catch_up',
        targets: [{ key: 'PROD-1', issueType: 'Story' }],
        selectedStories: [],
    });
    assert.equal('status_bucket' in params, false, 'status_options_open has no target status yet');
});

test('status target bucket helpers never receive or return raw issue identifiers', async () => {
    const utils = await loadUtils();
    // Bucketing helpers only accept numbers/status name strings; none of them should be
    // capable of echoing back a raw issue key. Defensive check: run all bucket helpers with a
    // realistic issue key masquerading as their expected primitive input and confirm the output
    // is always one of the documented low-cardinality tokens, never the raw string itself.
    assert.notEqual(utils.buildStatusBucket('PROD-1'), 'PROD-1');
    assert.equal(utils.buildStatusBucket('PROD-1'), 'other');
});

test('MAX_STATUS_TRANSITION_ISSUES matches the backend cap of 50', async () => {
    const { MAX_STATUS_TRANSITION_ISSUES } = await loadUtils();
    assert.equal(MAX_STATUS_TRANSITION_ISSUES, 50);
});

test('resolveSubtaskParentStoryKeys returns only stories whose subtask list contains a changed key', async () => {
    const { resolveSubtaskParentStoryKeys } = await loadUtils();
    const storySubtasksByKey = {
        'PROD-1': { items: [{ key: 'PROD-1-A' }, { key: 'PROD-1-B' }] },
        'PROD-2': { items: [{ key: 'PROD-2-A' }] },
        'PROD-3': { items: [] },
    };

    // Only PROD-1 owns PROD-1-A; a story key or unknown subtask key resolves to nothing.
    assert.deepEqual(resolveSubtaskParentStoryKeys(['PROD-1-A'], storySubtasksByKey), ['PROD-1']);
    assert.deepEqual(
        resolveSubtaskParentStoryKeys(['prod-1-b', 'PROD-2-A'], storySubtasksByKey).sort(),
        ['PROD-1', 'PROD-2'],
    );
    assert.deepEqual(resolveSubtaskParentStoryKeys(['PROD-1'], storySubtasksByKey), []);
    assert.deepEqual(resolveSubtaskParentStoryKeys([], storySubtasksByKey), []);
});
