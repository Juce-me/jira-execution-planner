const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingModules.js');
}

test('creates a catch-up onboarding module session', async () => {
    const { createOnboardingModuleSession } = await loadModule();

    assert.deepEqual(createOnboardingModuleSession(), {
        activeModule: 'catch-up',
        completedModules: [],
        resumeStepId: '',
        suspendedSurface: '',
        requestNonce: 0,
    });
});

test('activates contextual modules with a newer request nonce', async () => {
    const { activateOnboardingModule, createOnboardingModuleSession } = await loadModule();
    const initial = createOnboardingModuleSession();
    const activated = activateOnboardingModule(initial, {
        moduleId: 'planning',
        resumeStepId: 'launch-board',
        requestNonce: 1,
    });

    assert.equal(activated.activeModule, 'planning');
    assert.equal(activated.resumeStepId, 'launch-board');
    assert.equal(activated.requestNonce, 1);
    assert.equal(activateOnboardingModule(activated, {
        moduleId: 'board',
        resumeStepId: 'launch-statistics',
        requestNonce: 1,
    }), activated, 'duplicate nonces are idempotent');
    assert.equal(activateOnboardingModule(activated, {
        moduleId: 'board',
        requestNonce: 0,
    }), activated, 'stale nonces are idempotent');
    assert.equal(activateOnboardingModule(activated, {
        moduleId: 'catch-up',
        requestNonce: 2,
    }), activated, 'invalid contextual ids are idempotent');
});

test('completes configuration and resumes after leaving settings', async () => {
    const {
        activateOnboardingModule,
        completeOnboardingModule,
        createOnboardingModuleSession,
        resumeOnboardingAfterSurfaceExit,
    } = await loadModule();
    const activeConfiguration = activateOnboardingModule(createOnboardingModuleSession(), {
        moduleId: 'configuration',
        resumeStepId: 'launch-planning',
        requestNonce: 1,
    });
    const suspended = completeOnboardingModule(activeConfiguration, { surface: 'settings' });

    assert.equal(suspended.suspendedSurface, 'settings');
    assert.equal(resumeOnboardingAfterSurfaceExit(suspended, 'catch-up').activeModule, 'catch-up');
    assert.equal(resumeOnboardingAfterSurfaceExit(suspended, 'catch-up').suspendedSurface, '');
    assert.equal(completeOnboardingModule(suspended, { moduleId: 'configuration' }), suspended,
        'duplicate completion is idempotent');
    assert.equal(completeOnboardingModule(activeConfiguration, { moduleId: 'planning' }), activeConfiguration,
        'stale completion is idempotent');
});

test('acknowledges unavailable modules without duplicating completion entries', async () => {
    const {
        acknowledgeUnavailableOnboardingModule,
        createOnboardingModuleSession,
    } = await loadModule();
    const initial = createOnboardingModuleSession();
    const acknowledged = acknowledgeUnavailableOnboardingModule(initial, 'statistics');

    assert.deepEqual(acknowledged.completedModules, ['statistics']);
    assert.equal(acknowledgeUnavailableOnboardingModule(acknowledged, 'statistics'), acknowledged,
        'duplicate fallback acknowledgement is idempotent');
    assert.equal(acknowledgeUnavailableOnboardingModule(acknowledged, 'catch-up'), acknowledged,
        'invalid fallback acknowledgement is idempotent');
});

test('detects completion of every required contextual module', async () => {
    const { allRequiredOnboardingModulesComplete } = await loadModule();

    assert.equal(allRequiredOnboardingModulesComplete({
        completedModules: ['configuration', 'planning', 'board', 'statistics'],
    }), true);
    assert.equal(allRequiredOnboardingModulesComplete({
        completedModules: ['configuration', 'planning', 'board'],
    }), false);
});
