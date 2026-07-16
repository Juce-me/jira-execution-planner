const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/eng/engProjectTrackTransitionUtils.js');
}

test('CANONICAL_PROJECT_TRACKS is exactly Flexible then Committed', async () => {
    const { CANONICAL_PROJECT_TRACKS } = await loadUtils();
    assert.deepEqual(CANONICAL_PROJECT_TRACKS, ['Flexible', 'Committed']);
});

test('normalizeProjectTrackValue trims/case-folds to the canonical spelling and rejects unknown input', async () => {
    const { normalizeProjectTrackValue } = await loadUtils();

    assert.equal(normalizeProjectTrackValue('committed '), 'Committed');
    assert.equal(normalizeProjectTrackValue('FLEXIBLE'), 'Flexible');
    assert.equal(normalizeProjectTrackValue(''), '');
    assert.equal(normalizeProjectTrackValue(null), '');
    assert.equal(normalizeProjectTrackValue(undefined), '');
    assert.equal(normalizeProjectTrackValue('Other'), '');
});

test('filterProjectTrackOptions omits the current recognized track and keeps only canonical values', async () => {
    const { filterProjectTrackOptions } = await loadUtils();

    assert.deepEqual(
        filterProjectTrackOptions([{ value: 'Flexible' }, { value: 'Committed' }], 'Committed'),
        [{ value: 'Flexible' }]
    );
    assert.deepEqual(
        filterProjectTrackOptions([{ value: 'Flexible' }, { value: 'Committed' }], 'Flexible'),
        [{ value: 'Committed' }]
    );
});

test('filterProjectTrackOptions returns both options when the current track is unidentified', async () => {
    const { filterProjectTrackOptions } = await loadUtils();

    assert.deepEqual(
        filterProjectTrackOptions([{ value: 'Flexible' }, { value: 'Committed' }], ''),
        [{ value: 'Flexible' }, { value: 'Committed' }]
    );
    assert.deepEqual(
        filterProjectTrackOptions([{ value: 'Flexible' }, { value: 'Committed' }], 'Other'),
        [{ value: 'Flexible' }, { value: 'Committed' }]
    );
});

test('filterProjectTrackOptions is total for missing/malformed input', async () => {
    const { filterProjectTrackOptions } = await loadUtils();

    assert.deepEqual(filterProjectTrackOptions(null, 'Committed'), []);
    assert.deepEqual(filterProjectTrackOptions(undefined, 'Committed'), []);
    assert.deepEqual(filterProjectTrackOptions([{ value: 'Bogus' }, {}, null], 'Committed'), []);
});

test('buildProjectTrackActionAnalyticsParams omits value_state/result when not provided', async () => {
    const { buildProjectTrackActionAnalyticsParams } = await loadUtils();

    const params = buildProjectTrackActionAnalyticsParams({ sourceSurface: 'catch_up' });
    assert.deepEqual(params, {
        source_surface: 'catch_up',
        issue_type_mix: 'epics',
        selected_count_bucket: '1_5',
    });
    assert.equal('value_state' in params, false, 'project_track_options_open has no target track yet');
    assert.equal('result' in params, false);
});

test('buildProjectTrackActionAnalyticsParams includes lowercase value_state and result when provided', async () => {
    const { buildProjectTrackActionAnalyticsParams } = await loadUtils();

    const params = buildProjectTrackActionAnalyticsParams({
        sourceSurface: 'planning',
        targetTrack: 'Committed',
        result: 'success',
    });
    assert.deepEqual(params, {
        source_surface: 'planning',
        issue_type_mix: 'epics',
        selected_count_bucket: '1_5',
        value_state: 'committed',
        result: 'success',
    });
});

test('buildProjectTrackActionAnalyticsParams never leaks a raw issue key or the un-normalized track value', async () => {
    const { buildProjectTrackActionAnalyticsParams } = await loadUtils();

    const params = buildProjectTrackActionAnalyticsParams({
        sourceSurface: 'catch_up',
        targetTrack: '  FLEXIBLE  ',
        issueKey: 'PROD-1',
    });
    assert.deepEqual(Object.keys(params).sort(), ['issue_type_mix', 'selected_count_bucket', 'source_surface', 'value_state']);
    assert.equal(params.value_state, 'flexible');
    assert.equal('issueKey' in params, false);
    assert.equal('issue_key' in params, false);
    assert.notEqual(params.value_state, '  FLEXIBLE  ');
});
