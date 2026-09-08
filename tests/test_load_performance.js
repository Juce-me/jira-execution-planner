import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardLoadMeasurement, createGroupLoadMeasurement,
    evaluateSelectedSprintRegression, laneMetrics } from '../frontend/src/eng/loadPerformance.js';

test('parallel lanes use group wall time and emit only after render', async () => {
    let now = 0;
    let paint;
    const samples = [];
    const measurement = createGroupLoadMeasurement({ enabled: true, groupId: 'synthetic', sprintId: '7',
        now: () => now, emit: sample => samples.push(sample), afterPaint: () => new Promise(resolve => { paint = resolve; }) });
    now = 100;
    measurement.lane({ project: 'product', durationMs: 100 });
    now = 150;
    measurement.lane({ project: 'tech', durationMs: 150 });
    const finishing = measurement.finish(['applied', 'applied']);
    assert.equal(samples.length, 0);
    now = 170;
    paint();
    await finishing;
    await measurement.finish(['applied', 'applied']);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].durationMs, 170);
    assert.equal(samples[0].outcome, 'success');
});

test('cancellation beats late paint and does not emit twice', async () => {
    let paint;
    const samples = [];
    const measurement = createGroupLoadMeasurement({ enabled: true, groupId: 'synthetic', sprintId: '7',
        emit: sample => samples.push(sample), afterPaint: () => new Promise(resolve => { paint = resolve; }) });
    const finishing = measurement.finish(['applied', 'applied']);
    measurement.cancel();
    paint();
    await finishing;
    assert.equal(samples.length, 1);
    assert.equal(samples[0].outcome, 'cancelled');
});

test('disabled collection and failed telemetry cannot affect loads', async () => {
    let emissions = 0;
    const disabled = createGroupLoadMeasurement({ enabled: false, emit: () => { emissions++; } });
    await disabled.finish(['applied', 'applied']);
    disabled.cancel();
    assert.equal(emissions, 0);
    const failing = createGroupLoadMeasurement({ enabled: true, emit: () => Promise.reject(new Error('offline')) });
    await failing.finish(['non_auth_failure', 'applied']);
});

test('lane counts deduplicate identities and do not claim complete legacy data', () => {
    const data = { issues: [{ key: 'S-1', fields: { issuetype: { name: 'Story' }, epicKey: 'E-1' } },
        { key: 'S-1', fields: { issuetype: { name: 'Story' }, epicKey: 'E-1' } }],
        epics: { 'E-1': {} }, epicsInScope: [{ key: 'E-1' }, { key: 'E-2' }] };
    const result = laneMetrics('product', data, new Headers({ 'Server-Timing': 'jira-search;dur=45, cache;dur=1' }), 100, 200);
    assert.equal(result.issueCount, 1);
    assert.equal(result.storyCount, 1);
    assert.equal(result.epicCount, 2);
    assert.equal(result.cacheState, 'hit');
    assert.equal(result.completeness, 'unknown');
    assert.equal(result.stages['jira-search'], 45);
    assert.equal(result.jiraRequests, null);
});

test('first lane render is separate from complete group render', async () => {
    let now = 0;
    const samples = [];
    const measurement = createGroupLoadMeasurement({ enabled: true, now: () => now,
        emit: sample => samples.push(sample), afterPaint: async () => {} });
    now = 100;
    await measurement.contentReady();
    now = 300;
    await measurement.contentReady();
    now = 500;
    await measurement.finish(['applied', 'applied']);
    assert.equal(samples[0].firstContentMs, 100);
    assert.equal(samples[0].durationMs, 500);
});

test('Board measurement emits one closed global observation after paint', async () => {
    let now = 0;
    const samples = [];
    const measurement = createBoardLoadMeasurement({ enabled: true, groupId: 'synthetic',
        scopeType: 'all_work', now: () => now, afterPaint: async () => {}, emit: sample => samples.push(sample) });
    measurement.start({ type: 'start', scopeCohortDigest: 'a'.repeat(64) });
    measurement.addPayloadBytes(120);
    now = 80;
    await measurement.focusedContentReady();
    now = 700;
    await measurement.finish({ outcome: 'success', epicCount: 3, issueCount: 7,
        dependencyDurationMs: 50, diagnostics: { indexMs: 40, focusedCompleteMs: 400,
            jiraRequests: 5, jiraPages: 5, jiraRetries: 0, cacheState: 'miss', peakChildSearches: 2 } });
    await measurement.finish({ outcome: 'error' });
    assert.equal(samples.length, 1);
    assert.deepEqual(samples[0], { schemaVersion: 1, loadId: samples[0].loadId,
        groupId: 'synthetic', sprintId: null, surface: 'eng_board', scopeType: 'all_work',
        outcome: 'success', durationMs: 700, indexMs: 40, firstFocusedContentMs: 80,
        focusedCompleteMs: 400, dependencyDurationMs: 50, epicCount: 3, issueCount: 7,
        payloadBytes: 120, jiraRequests: 5, jiraPages: 5, jiraRetries: 0,
        completeness: 'complete', cacheState: 'miss', peakChildSearches: 2,
        scopeCohortDigest: 'a'.repeat(64) });
});

test('cancelled Board measurement keeps unavailable diagnostics null and unknown', async () => {
    const samples = [];
    const measurement = createBoardLoadMeasurement({ enabled: true, groupId: 'synthetic',
        scopeType: 'sprint', sprintId: 42, afterPaint: async () => {}, emit: sample => samples.push(sample) });
    await measurement.cancel();
    assert.equal(samples[0].sprintId, '42');
    assert.equal(samples[0].outcome, 'cancelled');
    assert.equal(samples[0].scopeCohortDigest, null);
    assert.equal(samples[0].jiraRequests, null);
    assert.equal(samples[0].cacheState, 'unknown');
    assert.equal(samples[0].completeness, 'partial');
});

test('selected-sprint acceptance rejects regression even when both medians are under two seconds', () => {
    const result = evaluateSelectedSprintRegression([800, 800, 800], [1500, 1500, 1500]);
    assert.equal(result.verified, true);
    assert.equal(result.passed, false);
    assert.equal(result.regressionPercent, 87.5);
    assert.equal(evaluateSelectedSprintRegression([], [900]).passed, false);
    assert.equal(evaluateSelectedSprintRegression([0], [900]).verified, false);
});
