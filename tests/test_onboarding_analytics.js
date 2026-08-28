const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingAnalytics.js');
}

test('onboarding analytics builder returns the exact started contract', async () => {
    const { buildOnboardingAnalyticsArgs } = await loadModule();

    assert.deepEqual(
        buildOnboardingAnalyticsArgs('started', 'first_run'),
        ['onboarding', 'started', { source_surface: 'first_run' }],
    );
    assert.deepEqual(
        buildOnboardingAnalyticsArgs('started', 'settings'),
        ['onboarding', 'started', { source_surface: 'settings' }],
    );
});

test('onboarding analytics builder adds success only to persisted outcomes', async () => {
    const { buildOnboardingAnalyticsArgs } = await loadModule();

    for (const workflowAction of ['completed', 'skipped']) {
        for (const sourceSurface of ['first_run', 'settings']) {
            assert.deepEqual(
                buildOnboardingAnalyticsArgs(workflowAction, sourceSurface),
                ['onboarding', workflowAction, {
                    source_surface: sourceSurface,
                    result: 'success',
                }],
            );
        }
    }
});

test('onboarding analytics builder rejects every unsupported action and source', async () => {
    const { buildOnboardingAnalyticsArgs } = await loadModule();

    for (const workflowAction of ['', 'start', 'finished', 'failed', 'Started', null, undefined]) {
        assert.throws(
            () => buildOnboardingAnalyticsArgs(workflowAction, 'first_run'),
            /unsupported onboarding analytics action/,
        );
    }
    for (const sourceSurface of ['', 'dashboard', 'first-run', 'Settings', null, undefined]) {
        assert.throws(
            () => buildOnboardingAnalyticsArgs('started', sourceSurface),
            /unsupported onboarding analytics source/,
        );
    }
});

test('onboarding analytics emitter routes only the builder output', async () => {
    const { trackOnboardingAnalytics } = await loadModule();
    const calls = [];

    assert.equal(trackOnboardingAnalytics((...args) => calls.push(args), 'completed', 'settings'), true);
    assert.deepEqual(calls, [[
        'onboarding',
        'completed',
        { source_surface: 'settings', result: 'success' },
    ]]);
    assert.equal(trackOnboardingAnalytics(null, 'started', 'first_run'), false);
    assert.throws(
        () => trackOnboardingAnalytics(() => {}, 'unexpected', 'first_run'),
        /unsupported onboarding analytics action/,
    );
});
