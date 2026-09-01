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
    assert.equal(activateOnboardingModule(activated, {
        moduleId: 'board',
        requestNonce: Infinity,
    }), activated, 'non-finite nonces are idempotent');
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

test('replay reset returns to catch-up and remains idempotent on a fresh session', async () => {
    const {
        activateOnboardingModule,
        completeOnboardingModule,
        createOnboardingModuleSession,
        resumeOnboardingAfterSurfaceExit,
    } = await loadModule();
    const active = activateOnboardingModule(createOnboardingModuleSession(), {
        moduleId: 'planning',
        resumeStepId: 'launch-board',
        requestNonce: 1,
    });
    const reset = completeOnboardingModule(active);

    assert.equal(reset.activeModule, 'catch-up');
    assert.equal(completeOnboardingModule(reset, { moduleId: 'planning' }), reset);

    const fresh = createOnboardingModuleSession();
    assert.equal(resumeOnboardingAfterSurfaceExit(fresh, 'catch-up'), fresh);
    assert.equal(activateOnboardingModule(fresh, {
        moduleId: 'planning',
        resumeStepId: 'launch-board',
        requestNonce: 1,
    }).activeModule, 'planning');
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

test('reopens only incomplete modules and applies each newer request once', async () => {
    const {
        activateOnboardingModule,
        completeOnboardingModule,
        createOnboardingModuleSession,
    } = await loadModule();
    const first = activateOnboardingModule(createOnboardingModuleSession(), {
        moduleId: 'configuration',
        resumeStepId: 'launch-planning',
        requestNonce: 1,
    });
    const interrupted = {
        ...first,
        activeModule: 'catch-up',
        resumeStepId: '',
    };
    const reopened = activateOnboardingModule(interrupted, {
        moduleId: 'configuration',
        resumeStepId: 'launch-planning',
        requestNonce: 2,
    });

    assert.equal(reopened.activeModule, 'configuration');
    assert.equal(reopened.requestNonce, 2);
    assert.equal(activateOnboardingModule(reopened, {
        moduleId: 'configuration',
        resumeStepId: 'launch-planning',
        requestNonce: 2,
    }), reopened, 'the same request cannot cause a second transition');

    const completed = completeOnboardingModule(reopened, { surface: 'settings' });
    assert.equal(activateOnboardingModule(completed, {
        moduleId: 'configuration',
        resumeStepId: 'launch-planning',
        requestNonce: 3,
    }), completed, 'a completed module cannot replay in the same session');
});
