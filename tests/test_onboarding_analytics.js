const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingAnalytics.js');
}

async function loadAnalyticsEvents() {
    return import('../frontend/src/analytics/events.js');
}

const MODULE_IDS = ['catch-up', 'configuration', 'planning', 'board', 'statistics'];

test('onboarding analytics builder returns the exact started contract for every module', async () => {
    const { buildOnboardingAnalyticsArgs } = await loadModule();

    for (const moduleId of MODULE_IDS) {
        assert.deepEqual(
            buildOnboardingAnalyticsArgs('started', 'first_run', moduleId),
            ['onboarding', 'started', { source_surface: 'first_run', module_id: moduleId }],
        );
        assert.deepEqual(
            buildOnboardingAnalyticsArgs('started', 'settings', moduleId),
            ['onboarding', 'started', { source_surface: 'settings', module_id: moduleId }],
        );
    }
});

test('onboarding analytics builder adds success only to persisted outcomes', async () => {
    const { buildOnboardingAnalyticsArgs } = await loadModule();

    for (const workflowAction of ['completed', 'skipped']) {
        for (const sourceSurface of ['first_run', 'settings']) {
            for (const moduleId of MODULE_IDS) {
                assert.deepEqual(
                    buildOnboardingAnalyticsArgs(workflowAction, sourceSurface, moduleId),
                    ['onboarding', workflowAction, {
                        source_surface: sourceSurface,
                        module_id: moduleId,
                        result: 'success',
                    }],
                );
            }
        }
    }
});

test('onboarding analytics builder rejects every unsupported action, source, and module', async () => {
    const { buildOnboardingAnalyticsArgs } = await loadModule();

    for (const workflowAction of ['', 'start', 'finished', 'failed', 'Started', null, undefined]) {
        assert.throws(
            () => buildOnboardingAnalyticsArgs(workflowAction, 'first_run', 'catch-up'),
            /unsupported onboarding analytics action/,
        );
    }
    for (const sourceSurface of ['', 'dashboard', 'first-run', 'Settings', null, undefined]) {
        assert.throws(
            () => buildOnboardingAnalyticsArgs('started', sourceSurface, 'catch-up'),
            /unsupported onboarding analytics source/,
        );
    }
    for (const moduleId of ['', 'scenario', 'catch_up', 'Planning', null, undefined]) {
        assert.throws(
            () => buildOnboardingAnalyticsArgs('started', 'first_run', moduleId),
            /unsupported onboarding analytics module/,
        );
    }
});

test('analytics schema accepts only canonical onboarding module ids', async () => {
    const { sanitizeAnalyticsParams } = await loadAnalyticsEvents();

    for (const moduleId of MODULE_IDS) {
        assert.deepEqual(
            sanitizeAnalyticsParams({ feature_name: 'settings', module_id: moduleId }, 'settings_action'),
            { feature_name: 'settings', module_id: moduleId },
        );
    }
    for (const moduleId of ['scenario', 'catch_up', 'planning_2', 'Planning']) {
        assert.throws(
            () => sanitizeAnalyticsParams({ feature_name: 'settings', module_id: moduleId }, 'settings_action'),
            /unsupported analytics value for module_id/,
        );
    }
});

test('onboarding analytics emitter routes only the builder output', async () => {
    const { trackOnboardingAnalytics } = await loadModule();
    const calls = [];

    assert.equal(trackOnboardingAnalytics((...args) => calls.push(args), 'completed', 'settings', 'board'), true);
    assert.deepEqual(calls, [[
        'onboarding',
        'completed',
        { source_surface: 'settings', module_id: 'board', result: 'success' },
    ]]);
    assert.equal(trackOnboardingAnalytics(null, 'started', 'first_run', 'catch-up'), false);
    assert.throws(
        () => trackOnboardingAnalytics(() => {}, 'unexpected', 'first_run', 'catch-up'),
        /unsupported onboarding analytics action/,
    );
});
