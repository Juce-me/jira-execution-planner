import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTrackPhaseDurations, sortEpicsByTotalAge } from '../frontend/src/stats/projectTrackPhaseStats.js';

// Minimal epic record factory.
// created: ISO string; durations: { [stateName]: days }; transitions: [{ date, from, to }]
const epic = (key, durations, transitions = [], opts = {}) => ({
    key,
    summary: `${key} summary`,
    currentValue: opts.currentValue || null,
    durations,
    created: opts.created || '2026-01-01T00:00:00.000+0000',
    transitions,
});

// ---- byState sums -------------------------------------------------------

test('byState sums days across all epics per state', () => {
    const epics = [
        epic('E1', { 'Committed': 10, 'Flexible': 5 }),
        epic('E2', { 'Committed': 7, 'null (no value)': 3 }),
    ];
    const { byState } = summarizeTrackPhaseDurations(epics);
    assert.equal(byState['Committed'], 17);
    assert.equal(byState['Flexible'], 5);
    assert.equal(byState['null (no value)'], 3);
});

test('byState handles empty epics array', () => {
    const { byState, avgDaysToFirstTrack, avgDaysToCommitted } = summarizeTrackPhaseDurations([]);
    assert.deepEqual(byState, {});
    assert.equal(avgDaysToFirstTrack, 0);
    assert.equal(avgDaysToCommitted, null);
});

test('byState missing state key counts as zero for that epic (not accumulated)', () => {
    const epics = [
        epic('E1', { 'Committed': 10 }),
        epic('E2', { 'Flexible': 4 }),
    ];
    const { byState } = summarizeTrackPhaseDurations(epics);
    assert.equal(byState['Committed'], 10);
    assert.equal(byState['Flexible'], 4);
    assert.equal(byState['null (no value)'], undefined);
});

// ---- avgDaysToFirstTrack ------------------------------------------------

test('avgDaysToFirstTrack averages "null (no value)" days across epics that have any transition', () => {
    // Both epics have transitions (so they were ever tracked).
    // E1 spent 5d untracked; E2 spent 3d untracked.
    const epics = [
        epic('E1', { 'null (no value)': 5, 'Committed': 10 }, [{ date: '2026-02-01', from: null, to: 'Committed' }]),
        epic('E2', { 'null (no value)': 3, 'Flexible': 7 }, [{ date: '2026-02-10', from: null, to: 'Flexible' }]),
    ];
    const { avgDaysToFirstTrack } = summarizeTrackPhaseDurations(epics);
    assert.equal(avgDaysToFirstTrack, 4); // (5 + 3) / 2
});

test('avgDaysToFirstTrack treats missing "null (no value)" key as 0 for epics with transitions', () => {
    // E1 has transitions but no untracked time recorded.
    // E2 has 6d untracked time.
    const epics = [
        epic('E1', { 'Committed': 10 }, [{ date: '2026-02-01', from: null, to: 'Committed' }]),
        epic('E2', { 'null (no value)': 6, 'Committed': 4 }, [{ date: '2026-02-10', from: null, to: 'Committed' }]),
    ];
    const { avgDaysToFirstTrack } = summarizeTrackPhaseDurations(epics);
    assert.equal(avgDaysToFirstTrack, 3); // (0 + 6) / 2
});

test('avgDaysToFirstTrack is 0 when no epics have any transitions', () => {
    const epics = [
        epic('E1', { 'null (no value)': 5 }), // no transitions
    ];
    const { avgDaysToFirstTrack } = summarizeTrackPhaseDurations(epics);
    assert.equal(avgDaysToFirstTrack, 0);
});

// ---- avgDaysToCommitted -------------------------------------------------

test('avgDaysToCommitted is null when no epic reached Committed', () => {
    const epics = [
        epic('E1', { 'Flexible': 10 }, [{ date: '2026-02-01', from: null, to: 'Flexible' }]),
        epic('E2', { 'null (no value)': 5 }), // never transitioned
    ];
    const { avgDaysToCommitted } = summarizeTrackPhaseDurations(epics);
    assert.equal(avgDaysToCommitted, null);
});

test('avgDaysToCommitted computes days from created to first Committed transition', () => {
    // E1: created 2026-01-01, first Committed 2026-02-01 => 31 days
    // E2: created 2026-01-01, first Committed 2026-03-01 => 59 days
    const epics = [
        epic('E1', { 'Committed': 31 },
            [{ date: '2026-02-01T00:00:00.000+0000', from: null, to: 'Committed' }],
            { created: '2026-01-01T00:00:00.000+0000' }),
        epic('E2', { 'Committed': 59 },
            [{ date: '2026-03-01T00:00:00.000+0000', from: null, to: 'Committed' }],
            { created: '2026-01-01T00:00:00.000+0000' }),
    ];
    const { avgDaysToCommitted } = summarizeTrackPhaseDurations(epics);
    // (31 + 59) / 2 = 45
    assert.equal(avgDaysToCommitted, 45);
});

test('avgDaysToCommitted ignores epics that never reached Committed (only averages those that did)', () => {
    // E1 reached Committed: 31 days. E2 never did.
    const epics = [
        epic('E1', { 'Committed': 31 },
            [{ date: '2026-02-01T00:00:00.000+0000', from: null, to: 'Committed' }],
            { created: '2026-01-01T00:00:00.000+0000' }),
        epic('E2', { 'Flexible': 45 },
            [{ date: '2026-02-10T00:00:00.000+0000', from: null, to: 'Flexible' }],
            { created: '2026-01-01T00:00:00.000+0000' }),
    ];
    const { avgDaysToCommitted } = summarizeTrackPhaseDurations(epics);
    assert.equal(avgDaysToCommitted, 31);
});

test('avgDaysToCommitted uses first Committed transition when there are multiple transitions', () => {
    // E1: created 2026-01-01
    //   transition 1: 2026-01-20 null -> Flexible (20 days)
    //   transition 2: 2026-02-01 Flexible -> Committed (first Committed => 31 days from created)
    const epics = [
        epic('E1', { 'null (no value)': 5, 'Flexible': 12, 'Committed': 14 },
            [
                { date: '2026-01-20T00:00:00.000+0000', from: null, to: 'Flexible' },
                { date: '2026-02-01T00:00:00.000+0000', from: 'Flexible', to: 'Committed' },
            ],
            { created: '2026-01-01T00:00:00.000+0000' }),
    ];
    const { avgDaysToCommitted } = summarizeTrackPhaseDurations(epics);
    assert.equal(avgDaysToCommitted, 31);
});

// ---- sortEpicsByTotalAge ------------------------------------------------

test('sortEpicsByTotalAge orders descending by sum of all durations', () => {
    const epics = [
        epic('E1', { 'Committed': 10, 'Flexible': 5 }), // total 15
        epic('E2', { 'Committed': 30 }),                 // total 30
        epic('E3', { 'null (no value)': 7 }),             // total 7
    ];
    const sorted = sortEpicsByTotalAge(epics);
    assert.deepEqual(sorted.map(e => e.key), ['E2', 'E1', 'E3']);
});

test('sortEpicsByTotalAge handles epics with no durations (total = 0)', () => {
    const epics = [
        epic('E1', {}),               // total 0
        epic('E2', { 'Committed': 5 }), // total 5
    ];
    const sorted = sortEpicsByTotalAge(epics);
    assert.deepEqual(sorted.map(e => e.key), ['E2', 'E1']);
});
