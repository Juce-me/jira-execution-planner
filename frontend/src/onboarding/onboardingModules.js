export const ONBOARDING_MODULE_IDS = Object.freeze([
    'catch-up', 'configuration', 'planning', 'board', 'statistics',
]);
const ONBOARDING_MODULE_SET = new Set(ONBOARDING_MODULE_IDS);
const ENG_ONBOARDING_MODULE_SET = new Set(['catch-up', 'planning', 'board', 'statistics']);

export function isEngOnboardingModuleSurface(moduleId) {
    return ENG_ONBOARDING_MODULE_SET.has(moduleId);
}

export function normalizeCompletedOnboardingModules(values) {
    const requested = new Set(Array.isArray(values) ? values : []);
    return ONBOARDING_MODULE_IDS.filter((moduleId) => requested.has(moduleId));
}

export function isOnboardingModuleComplete(completedModules, moduleId) {
    return ONBOARDING_MODULE_SET.has(moduleId)
        && normalizeCompletedOnboardingModules(completedModules).includes(moduleId);
}

export function allOnboardingModulesComplete(completedModules) {
    return normalizeCompletedOnboardingModules(completedModules).length === ONBOARDING_MODULE_IDS.length;
}

export function createOnboardingModuleSession(completedModules = []) {
    return {
        activeModule: '',
        completedModules: normalizeCompletedOnboardingModules(completedModules),
        requestNonce: 0,
    };
}

export function activateOnboardingModule(state, request = {}) {
    const moduleId = String(request.moduleId || '');
    const requestNonce = Number(request.requestNonce) || 0;
    if (!ONBOARDING_MODULE_SET.has(moduleId)
        || !Number.isFinite(requestNonce)
        || requestNonce <= (Number(state?.requestNonce) || 0)
        || isOnboardingModuleComplete(state?.completedModules, moduleId)) return state;
    return {
        ...state,
        activeModule: moduleId,
        requestNonce,
    };
}

export function closeOnboardingModuleSession(state) {
    if (!state?.activeModule) return state;
    return {
        ...state,
        activeModule: '',
    };
}

export function completeOnboardingModule(state, options = {}) {
    const moduleId = String(options.moduleId || state?.activeModule || '');
    if (!ONBOARDING_MODULE_SET.has(moduleId) || state?.activeModule !== moduleId) return state;
    return {
        ...state,
        activeModule: '',
        completedModules: normalizeCompletedOnboardingModules([
            ...(state.completedModules || []),
            moduleId,
        ]),
    };
}

export function nextOnboardingModuleRequest(state, moduleId) {
    const normalizedModuleId = String(moduleId || '');
    if (!ONBOARDING_MODULE_SET.has(normalizedModuleId)
        || isOnboardingModuleComplete(state?.completedModules, normalizedModuleId)) return state;
    const requestNonce = (Number(state?.requestNonce) || 0) + 1;
    return {
        ...state,
        run: true,
        activeModule: normalizedModuleId,
        requestNonce,
        moduleRequest: { moduleId: normalizedModuleId, requestNonce },
    };
}

export function resetOnboardingModuleRequest(state) {
    return nextOnboardingModuleRequest({
        ...state,
        run: false,
        activeModule: '',
        completedModules: [],
        requestNonce: 0,
        moduleRequest: null,
    }, 'catch-up');
}
