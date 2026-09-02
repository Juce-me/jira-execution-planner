const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingModules.js');
}

test('exports the frozen canonical module order and normalization helpers', async () => {
    const {
        ONBOARDING_MODULE_IDS,
        allOnboardingModulesComplete,
        isOnboardingModuleComplete,
        normalizeCompletedOnboardingModules,
    } = await loadModule();

    assert.equal(Object.isFrozen(ONBOARDING_MODULE_IDS), true);
    assert.deepEqual(ONBOARDING_MODULE_IDS, [
        'catch-up', 'configuration', 'planning', 'board', 'statistics',
    ]);
    assert.deepEqual(
        normalizeCompletedOnboardingModules(['statistics', 'unknown', 'catch-up', 'statistics']),
        ['catch-up', 'statistics'],
    );
    assert.equal(isOnboardingModuleComplete(['catch-up'], 'catch-up'), true);
    assert.equal(isOnboardingModuleComplete(['catch-up'], 'planning'), false);
    assert.equal(isOnboardingModuleComplete(ONBOARDING_MODULE_IDS, 'unknown'), false);
    assert.equal(allOnboardingModulesComplete(ONBOARDING_MODULE_IDS), true);
    assert.equal(allOnboardingModulesComplete(['configuration', 'planning', 'board', 'statistics']), false);
});

test('creates a closed onboarding module session', async () => {
    const { createOnboardingModuleSession } = await loadModule();

    assert.deepEqual(createOnboardingModuleSession(), {
        activeModule: '',
        completedModules: [],
        requestNonce: 0,
    });
});

test('next request opens only known incomplete modules even when run is false', async () => {
    const {
        nextOnboardingModuleRequest,
    } = await loadModule();
    const initial = { run: false, completedModules: ['catch-up'], requestNonce: 4, moduleRequest: null };
    assert.deepEqual(nextOnboardingModuleRequest(initial, 'planning'), {
        run: true,
        completedModules: ['catch-up'],
        activeModule: 'planning',
        requestNonce: 5,
        moduleRequest: { moduleId: 'planning', requestNonce: 5 },
    });
    assert.equal(nextOnboardingModuleRequest(initial, 'catch-up'), initial);
    assert.equal(nextOnboardingModuleRequest(initial, 'unknown'), initial);

    const fresh = { run: false, completedModules: [], requestNonce: 0, moduleRequest: null };
    assert.equal(nextOnboardingModuleRequest(fresh, 'catch-up').activeModule, 'catch-up');
});

test('unfinished automatic Catch Up can restart after a user visits Planning and returns', async () => {
    const {
        isEngOnboardingModuleSurface,
        nextOnboardingModuleRequest,
    } = await loadModule();
    const initial = { run: false, completedModules: [], requestNonce: 0, moduleRequest: null };
    const automaticCatchUp = nextOnboardingModuleRequest(initial, 'catch-up');
    const planning = nextOnboardingModuleRequest(automaticCatchUp, 'planning');
    const restartedCatchUp = nextOnboardingModuleRequest(planning, 'catch-up');

    assert.equal(isEngOnboardingModuleSurface('catch-up'), true);
    assert.equal(isEngOnboardingModuleSurface('planning'), true);
    assert.equal(isEngOnboardingModuleSurface('board'), true);
    assert.equal(isEngOnboardingModuleSurface('statistics'), true);
    assert.equal(isEngOnboardingModuleSurface('scenario'), false);
    assert.equal(isEngOnboardingModuleSurface('configuration'), false);
    assert.deepEqual(automaticCatchUp.moduleRequest, { moduleId: 'catch-up', requestNonce: 1 });
    assert.deepEqual(planning.moduleRequest, { moduleId: 'planning', requestNonce: 2 });
    assert.deepEqual(restartedCatchUp.moduleRequest, { moduleId: 'catch-up', requestNonce: 3 });
    assert.deepEqual(restartedCatchUp.completedModules, []);
});

test('replay reset clears completions and prepares a fresh Catch Up request', async () => {
    const { resetOnboardingModuleRequest } = await loadModule();

    assert.deepEqual(resetOnboardingModuleRequest({
        run: false,
        activeModule: '',
        completedModules: ['catch-up', 'planning'],
        requestNonce: 8,
        moduleRequest: null,
    }), {
        run: true,
        activeModule: 'catch-up',
        completedModules: [],
        requestNonce: 1,
        moduleRequest: { moduleId: 'catch-up', requestNonce: 1 },
    });
});

test('completion closes only the active module while interruption remains incomplete', async () => {
    const {
        activateOnboardingModule,
        closeOnboardingModuleSession,
        completeOnboardingModule,
        createOnboardingModuleSession,
    } = await loadModule();
    const first = activateOnboardingModule(createOnboardingModuleSession(), {
        moduleId: 'planning',
        requestNonce: 1,
    });
    const interrupted = closeOnboardingModuleSession(first);
    assert.equal(interrupted.activeModule, '');
    assert.deepEqual(interrupted.completedModules, []);

    const reopened = activateOnboardingModule(interrupted, {
        moduleId: 'planning',
        requestNonce: 2,
    });
    assert.equal(reopened.activeModule, 'planning');
    assert.equal(reopened.requestNonce, 2);

    const completed = completeOnboardingModule(reopened);
    assert.equal(completed.activeModule, '');
    assert.deepEqual(completed.completedModules, ['planning']);
    assert.equal(activateOnboardingModule(completed, {
        moduleId: 'planning',
        requestNonce: 3,
    }), completed, 'a completed module cannot replay in the same session');
    assert.equal(activateOnboardingModule(completed, {
        moduleId: 'unknown',
        requestNonce: 4,
    }), completed, 'an unknown module cannot open');
});
