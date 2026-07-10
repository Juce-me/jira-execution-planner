const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/engPriorityTransitionUtils.js');
}

function task(key, fields = {}) {
    return { key, fields };
}

function priorityOption(id, rank) {
    return { id, name: `Priority ${id}`, statusColor: '#000000', iconUrl: '', rank };
}

test('buildCatchUpPriorityTargets derives a target from the standard nested Jira task shape', async () => {
    const { buildCatchUpPriorityTargets } = await loadUtils();

    const story = task('PROD-1', { priority: { name: 'High' }, issuetype: { name: 'Story' }, summary: 'Synthetic summary' });
    assert.deepEqual(buildCatchUpPriorityTargets(story), {
        key: 'PROD-1',
        issueType: 'Story',
        currentPriority: 'High',
        summary: 'Synthetic summary'
    });
});

test('buildCatchUpPriorityTargets derives a target for a flat Epic-shaped issue using the fallback issue type', async () => {
    const { buildCatchUpPriorityTargets } = await loadUtils();

    const epic = { key: 'PROD-EPIC-1', priority: { name: 'Highest' }, summary: 'Epic summary' };
    assert.deepEqual(buildCatchUpPriorityTargets(epic, 'Epic'), {
        key: 'PROD-EPIC-1',
        issueType: 'Epic',
        currentPriority: 'Highest',
        summary: 'Epic summary'
    });

    // Priority is sometimes a plain string instead of a {name} object.
    const epicStringPriority = { key: 'PROD-EPIC-2', priority: 'Low', summary: 'Other epic' };
    assert.equal(buildCatchUpPriorityTargets(epicStringPriority, 'Epic').currentPriority, 'Low');
});

test('buildCatchUpPriorityTargets is total: missing key returns null, missing priority/summary default to empty', async () => {
    const { buildCatchUpPriorityTargets } = await loadUtils();

    assert.equal(buildCatchUpPriorityTargets(null), null);
    assert.equal(buildCatchUpPriorityTargets({}), null);
    assert.deepEqual(buildCatchUpPriorityTargets({ key: 'OPS2-3' }), {
        key: 'OPS2-3',
        issueType: '',
        currentPriority: '',
        summary: ''
    });
});

test('sortPriorityOptionsByRank returns an ascending-rank copy without mutating the input', async () => {
    const { sortPriorityOptionsByRank } = await loadUtils();

    const catalog = [priorityOption('3', 30), priorityOption('1', 10), priorityOption('2', 20)];
    const sorted = sortPriorityOptionsByRank(catalog);

    assert.deepEqual(sorted.map((entry) => entry.id), ['1', '2', '3']);
    assert.deepEqual(catalog.map((entry) => entry.id), ['3', '1', '2'], 'Input array must not be mutated');
    assert.deepEqual(sortPriorityOptionsByRank(null), []);
    assert.deepEqual(sortPriorityOptionsByRank([{ id: '9' }, priorityOption('1', 10)]).map((entry) => entry.id), ['9', '1'], 'Missing rank sorts as 0');
});

test('resolvePriorityRank finds the numeric rank for a matching id and is total for unknown/missing input', async () => {
    const { resolvePriorityRank } = await loadUtils();
    const catalog = [priorityOption('1', 10), priorityOption('2', 20), priorityOption('3', 30)];

    assert.equal(resolvePriorityRank(catalog, '2'), 20);
    assert.equal(resolvePriorityRank(catalog, 'unknown-id'), null);
    assert.equal(resolvePriorityRank(catalog, ''), null);
    assert.equal(resolvePriorityRank(catalog, undefined), null);
    assert.equal(resolvePriorityRank(null, '1'), null);
    assert.equal(resolvePriorityRank([], '1'), null);
});

test('buildPriorityBucket maps the default five-tier catalog rank to low-cardinality buckets', async () => {
    const { buildPriorityBucket } = await loadUtils();

    assert.equal(buildPriorityBucket(10), 'highest');
    assert.equal(buildPriorityBucket(20), 'high');
    assert.equal(buildPriorityBucket(30), 'medium');
    assert.equal(buildPriorityBucket(40), 'low');
    assert.equal(buildPriorityBucket(50), 'lowest');
    assert.equal(buildPriorityBucket(60), 'other', 'A rank past the default five tiers falls back to other');
    assert.equal(buildPriorityBucket(null), 'other');
    assert.equal(buildPriorityBucket(undefined), 'other');
    assert.equal(buildPriorityBucket('not-a-number'), 'other');
});

test('summarizePriorityTransitionResults returns success/partial/failure counts without raw issue details, treating already_in_priority as success', async () => {
    const { summarizePriorityTransitionResults } = await loadUtils();

    const allSucceeded = summarizePriorityTransitionResults([
        { key: 'PROD-1', result: 'success', fromPriority: 'High', toPriority: 'Highest' },
        { key: 'PROD-2', result: 'already_in_priority' }
    ]);
    assert.deepEqual(allSucceeded, { total: 2, succeeded: 2, failed: 0, result: 'success' });
    assert.deepEqual(Object.keys(allSucceeded).sort(), ['failed', 'result', 'succeeded', 'total']);

    const mixed = summarizePriorityTransitionResults([
        { key: 'PROD-1', result: 'success' },
        { key: 'PROD-2', result: 'failure', error: 'priority_forbidden' }
    ]);
    assert.deepEqual(mixed, { total: 2, succeeded: 1, failed: 1, result: 'partial' });

    const allFailed = summarizePriorityTransitionResults([
        { key: 'PROD-1', result: 'failure' }
    ]);
    assert.deepEqual(allFailed, { total: 1, succeeded: 0, failed: 1, result: 'failure' });

    assert.deepEqual(summarizePriorityTransitionResults([]), { total: 0, succeeded: 0, failed: 0, result: 'failure' });
    assert.deepEqual(summarizePriorityTransitionResults(undefined), { total: 0, succeeded: 0, failed: 0, result: 'failure' });
});

test('isRecognizedPriorityIconName matches the app priority-icon vocabulary and rejects exotic names', async () => {
    const { isRecognizedPriorityIconName } = await loadUtils();

    // Standard project priorities the app renders a real icon for (mirrors renderPriorityIcon).
    for (const name of ['Blocker', 'Critical', 'Highest', 'High', 'Major', 'Medium', 'Minor', 'Lowest', 'Low', 'Trivial']) {
        assert.equal(isRecognizedPriorityIconName(name), true, `${name} should be recognized`);
    }
    // Case/substring tolerant, mirroring the includes-based matching in renderPriorityIcon.
    assert.equal(isRecognizedPriorityIconName('low (migrated)'), true);
    // Exotic priorities the app has no icon for fall through to the Jira color-dot fallback.
    assert.equal(isRecognizedPriorityIconName('Urgent'), false);
    assert.equal(isRecognizedPriorityIconName('P0'), false);
    assert.equal(isRecognizedPriorityIconName(''), false);
    assert.equal(isRecognizedPriorityIconName(null), false);
    assert.equal(isRecognizedPriorityIconName(undefined), false);
});

test('buildPriorityActionAnalyticsParams omits priority_bucket when no target priority has been chosen yet', async () => {
    const { buildPriorityActionAnalyticsParams } = await loadUtils();

    const params = buildPriorityActionAnalyticsParams({
        sourceSurface: 'catch_up',
        targets: [{ key: 'PROD-1', issueType: 'Story' }],
    });
    assert.deepEqual(params, {
        source_surface: 'catch_up',
        issue_type_mix: 'stories',
        selected_count_bucket: '1_5',
    });
    assert.equal('priority_bucket' in params, false, 'priority_options_open has no target priority yet');
    assert.equal('result' in params, false);
});

test('buildPriorityActionAnalyticsParams includes priority_bucket and result derived from the catalog rank', async () => {
    const { buildPriorityActionAnalyticsParams } = await loadUtils();
    const priorityOptions = [priorityOption('1', 10), priorityOption('2', 20), priorityOption('3', 30)];

    const params = buildPriorityActionAnalyticsParams({
        sourceSurface: 'planning',
        targets: [{ key: 'PROD-1', issueType: 'Epic' }],
        priorityId: '2',
        priorityOptions,
        result: 'success',
    });

    assert.deepEqual(params, {
        source_surface: 'planning',
        issue_type_mix: 'epics',
        selected_count_bucket: '1_5',
        priority_bucket: 'high',
        result: 'success',
    });
});

test('priority bucket helpers never receive or return raw issue identifiers or priority ids', async () => {
    const utils = await loadUtils();
    // Defensive check mirroring engStatusTransitionUtils.js: bucket helpers only accept
    // numbers/catalog entries, so a realistic issue key or priority id masquerading as
    // their expected input must always fall back to the documented 'other' token.
    assert.equal(utils.buildPriorityBucket('PROD-1'), 'other');
    assert.equal(utils.resolvePriorityRank([{ id: 'PROD-1', rank: 10 }], 'PROD-1'), 10, 'id lookup is exact-match only, never echoes the id back as a bucket');
    assert.notEqual(utils.buildPriorityBucket('PROD-1'), 'PROD-1');
});
