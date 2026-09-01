export const ONBOARDING_MODULE_IDS = Object.freeze([
    'catch-up', 'configuration', 'planning', 'board', 'statistics',
]);
export const REQUIRED_CONTEXTUAL_MODULE_IDS = Object.freeze([
    'configuration', 'planning', 'board', 'statistics',
]);

const CONTEXTUAL_MODULE_SET = new Set(REQUIRED_CONTEXTUAL_MODULE_IDS);

function appendCompleted(completedModules, moduleId) {
    const current = Array.isArray(completedModules) ? completedModules : [];
    return current.includes(moduleId) ? current : [...current, moduleId];
}

export function createOnboardingModuleSession() {
    return {
        activeModule: 'catch-up',
        completedModules: [],
        resumeStepId: '',
        suspendedSurface: '',
        requestNonce: 0,
    };
}

export function activateOnboardingModule(state, request = {}) {
    const moduleId = String(request.moduleId || '');
    const requestNonce = Number(request.requestNonce) || 0;
    if (!CONTEXTUAL_MODULE_SET.has(moduleId)
        || !Number.isFinite(requestNonce)
        || requestNonce <= (Number(state?.requestNonce) || 0)
        || state?.completedModules?.includes(moduleId)) return state;
    return {
        ...state,
        activeModule: moduleId,
        resumeStepId: String(request.resumeStepId || ''),
        suspendedSurface: '',
        requestNonce,
    };
}

export function completeOnboardingModule(state, options = {}) {
    const moduleId = String(options.moduleId || state?.activeModule || '');
    if (!CONTEXTUAL_MODULE_SET.has(moduleId) || state?.activeModule !== moduleId) return state;
    return {
        ...state,
        activeModule: 'catch-up',
        completedModules: appendCompleted(state.completedModules, moduleId),
        suspendedSurface: moduleId === 'configuration' && options.surface === 'settings'
            ? 'settings'
            : '',
    };
}

export function acknowledgeUnavailableOnboardingModule(state, moduleId) {
    if (!CONTEXTUAL_MODULE_SET.has(moduleId) || state?.completedModules?.includes(moduleId)) return state;
    return {
        ...state,
        completedModules: appendCompleted(state.completedModules, moduleId),
    };
}

export function resumeOnboardingAfterSurfaceExit(state, activeSurface) {
    if (!state?.suspendedSurface || activeSurface === state.suspendedSurface) return state;
    return { ...state, suspendedSurface: '' };
}

export function allRequiredOnboardingModulesComplete(state) {
    const completed = new Set(state?.completedModules || []);
    return REQUIRED_CONTEXTUAL_MODULE_IDS.every((moduleId) => completed.has(moduleId));
}
