const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/engStatusTransitionUtils.js');
}

function task(key, fields = {}) {
    return { key, fields };
}

test('isStatusTransitionSurfaceEnabled is true only for ENG Catch Up, Planning and Board', async () => {
    const { isStatusTransitionSurfaceEnabled } = await loadUtils();

    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: false, showStats: false, showScenario: false }), true, 'Catch Up');
    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: true, showStats: false, showScenario: false }), true, 'Planning');
    assert.equal(isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showPlanning: false, showStats: false, showScenario: false, showBoard: true }), true, 'Board');

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

test('buildStatusActionAnalyticsParams reports the submitted Story\'s points for Planning only, and never for a Subtask, an Epic or Catch Up', async () => {
    const { buildStatusActionAnalyticsParams } = await loadUtils();
    const { bucketCount } = await import('../frontend/src/analytics/dashboardAnalytics.js');

    const subtask = [{ key: 'TECH-22', issueType: 'Subtask', currentStatus: 'Analysis', summary: 'Subtask', storyPoints: 5 }];
    const story = [{ key: 'PROD-1', issueType: 'Story', currentStatus: 'To Do', summary: 'Story', storyPoints: '5' }];

    const catchUpParams = buildStatusActionAnalyticsParams({ sourceSurface: 'catch_up', targets: story, status: 'Accepted' });
    assert.deepEqual(catchUpParams, {
        source_surface: 'catch_up',
        status_bucket: 'accepted',
        issue_type_mix: 'stories',
        selected_count_bucket: '1_5',
    });
    assert.equal('selected_sp_bucket' in catchUpParams, false, 'Catch Up never reports Story points');

    const planningParams = buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: story, status: 'Accepted' });
    assert.deepEqual(planningParams, {
        source_surface: 'planning',
        status_bucket: 'accepted',
        issue_type_mix: 'stories',
        selected_count_bucket: '1_5',
        selected_sp_bucket: bucketCount(5),
    });

    const subtaskParams = buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: subtask, status: 'Accepted' });
    assert.equal('selected_sp_bucket' in subtaskParams, false, 'a Subtask-only action omits the parameter');
    const epicParams = buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: [{ key: 'PROD-9', issueType: 'Epic' }], status: 'Accepted' });
    assert.equal('selected_sp_bucket' in epicParams, false, 'an Epic-only action omits the parameter');
});

test('buildCatchUpStatusTargets carries a Story\'s loaded points, nested or flat, and nothing when the issue has none', async () => {
    const { buildCatchUpStatusTargets } = await loadUtils();
    assert.equal(buildCatchUpStatusTargets({ key: 'PROD-1', fields: { customfield_10004: 8 } }).storyPoints, 8);
    assert.equal(buildCatchUpStatusTargets({ key: 'PROD-1', storyPoints: 3 }).storyPoints, 3);
    assert.equal('storyPoints' in buildCatchUpStatusTargets({ key: 'PROD-1', status: 'To Do' }), false);
});

test('buildStatusActionAnalyticsParams omits status_bucket when no target status has been chosen yet', async () => {
    const { buildStatusActionAnalyticsParams } = await loadUtils();

    const params = buildStatusActionAnalyticsParams({
        sourceSurface: 'catch_up',
        targets: [{ key: 'PROD-1', issueType: 'Story' }],
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

// §9.5 / §10.3: Board is the third status-transition surface. Like Catch Up it acts on ONE
// explicit issue, unrelated to the Planning selection, so it must omit selected_sp_bucket for the
// same reason Catch Up does — the `!== 'catch_up'` form silently reported Planning's story points
// against a Board transition.
test('buildStatusActionAnalyticsParams reports board and omits Planning-selection story points', async () => {
    const { buildStatusActionAnalyticsParams } = await loadUtils();

    const params = buildStatusActionAnalyticsParams({
        sourceSurface: 'board',
        targets: [{ key: 'PROD-1', issueType: 'Epic', currentStatus: 'To Do', summary: 'Epic' }],
        status: 'Done',
    });
    assert.deepEqual(params, {
        source_surface: 'board',
        status_bucket: 'done',
        issue_type_mix: 'epics',
        selected_count_bucket: '1_5',
    });
    assert.equal('selected_sp_bucket' in params, false, 'Board acts on one epic, not the Planning selection');
});

// ---- outcome classification (issue #250) -------------------------------------------------------
const statusResponse = (entry, extra = {}) => ({ requested: 1, succeeded: 0, failed: 0, targetStatus: 'In Progress', results: [{ key: 'DEMO-1', ...entry }], ...extra });

test('classifyWriteError: only the enumerated HTTP status/code pairs are rejections, everything else is unconfirmed', async () => {
    const { classifyWriteError } = await loadUtils();
    const definitive = [
        [400, 'invalid_json'], [400, 'issue_keys_required'], [400, 'invalid_issue_key'], [400, 'too_many_issues'],
        [400, 'target_status_required'], [400, 'target_priority_required'], [400, 'invalid_priority_id'],
        [403, 'csrf_required'], [403, 'jira_oauth_required'], [503, 'config_storage_unavailable'],
    ];
    definitive.forEach(([status, code]) => assert.equal(classifyWriteError({ status, code }), 'rejected', `${status} ${code}`));
    assert.equal(classifyWriteError({ name: 'AbortError' }), 'rejected', 'a queued job cancelled before dispatch');

    const unconfirmed = [
        [502, 'jira_transition_failed'], [502, 'jira_priority_update_failed'], [500, 'internal_error'], [403, 'something_else'],
        [400, 'unlisted_code'], [503, 'service_unavailable'], [undefined, undefined], [429, 'rate_limited'],
    ];
    unconfirmed.forEach(([status, code]) => assert.equal(classifyWriteError({ status, code }), 'unconfirmed', `${status} ${code}`));
    assert.equal(classifyWriteError(new Error('network down')), 'unconfirmed');
    assert.equal(classifyWriteError(null), 'unconfirmed');
});

test('classifyStatusResult confirms only a matching success and treats every definitive code as a rejection', async () => {
    const { classifyStatusResult } = await loadUtils();

    assert.deepEqual(classifyStatusResult(statusResponse({ result: 'success', toStatus: 'In Progress' }), 'demo-1'), { outcome: 'confirmed', value: { name: 'In Progress' } });
    assert.deepEqual(classifyStatusResult(statusResponse({ result: 'success' }), 'DEMO-1').value, { name: 'In Progress' }, 'falls back to the response target');
    assert.equal(classifyStatusResult(statusResponse({ result: 'already_in_status', currentStatus: 'In Progress' }), 'DEMO-1').outcome, 'confirmed');

    const definitive = ['transition_not_available', 'transitions_unavailable', 'invalid_transition', 'transition_forbidden', 'transition_conflict', 'jira_auth_error', 'issue_not_found'];
    definitive.forEach(code => {
        const outcome = classifyStatusResult(statusResponse({ result: 'failure', error: code, currentStatus: 'To Do' }), 'DEMO-1');
        assert.equal(outcome.outcome, 'rejected', code);
        assert.equal(outcome.currentStatus, 'To Do');
    });
    ['transition_failed', 'transition_timeout', 'something_new', undefined].forEach(code => {
        assert.equal(classifyStatusResult(statusResponse({ result: 'failure', error: code }), 'DEMO-1').outcome, 'unconfirmed', String(code));
    });
});

test('classifyStatusResult never trusts counts: missing, duplicate, mismatched or unusable results are unconfirmed', async () => {
    const { classifyStatusResult } = await loadUtils();

    assert.deepEqual(classifyStatusResult({ succeeded: 1, results: [] }, 'DEMO-1'), { outcome: 'unconfirmed', code: 'missing_result' });
    assert.deepEqual(classifyStatusResult({ succeeded: 1, results: [{ key: 'DEMO-2', result: 'success' }] }, 'DEMO-1'), { outcome: 'unconfirmed', code: 'missing_result' });
    assert.deepEqual(classifyStatusResult({ succeeded: 2, results: [{ key: 'DEMO-1', result: 'success' }, { key: 'demo-1', result: 'success' }] }, 'DEMO-1'), { outcome: 'unconfirmed', code: 'duplicate_result' });
    assert.equal(classifyStatusResult(statusResponse({ result: 'queued' }), 'DEMO-1').code, 'unknown_result');
    assert.equal(classifyStatusResult({ results: [{ key: 'DEMO-1', result: 'success' }] }, 'DEMO-1').code, 'unusable_value', 'a success with no usable status');
    assert.equal(classifyStatusResult(null, 'DEMO-1').code, 'missing_result');
});

test('already_in_status is unconfirmed when this session wrote the issue since the last evidenced read', async () => {
    const { classifyStatusResult } = await loadUtils();
    const response = statusResponse({ result: 'already_in_status', currentStatus: 'To Do' });

    assert.equal(classifyStatusResult(response, 'DEMO-1', { staleAlreadyIn: false }).outcome, 'confirmed');
    assert.deepEqual(classifyStatusResult(response, 'DEMO-1', { staleAlreadyIn: true }), { outcome: 'unconfirmed', code: 'stale_already_in' });
});
