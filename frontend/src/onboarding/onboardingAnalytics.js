const ONBOARDING_ACTIONS = new Set(['started', 'completed', 'skipped']);
const ONBOARDING_SOURCES = new Set(['first_run', 'settings']);
const ONBOARDING_MODULES = new Set(['catch-up', 'configuration', 'planning', 'board', 'statistics']);

export function buildOnboardingAnalyticsArgs(workflowAction, sourceSurface, moduleId) {
    if (!ONBOARDING_ACTIONS.has(workflowAction)) {
        throw new Error('unsupported onboarding analytics action');
    }
    if (!ONBOARDING_SOURCES.has(sourceSurface)) {
        throw new Error('unsupported onboarding analytics source');
    }
    if (!ONBOARDING_MODULES.has(moduleId)) {
        throw new Error('unsupported onboarding analytics module');
    }
    const params = { source_surface: sourceSurface, module_id: moduleId };
    if (workflowAction !== 'started') params.result = 'success';
    return ['onboarding', workflowAction, params];
}

export function trackOnboardingAnalytics(trackSettingsAction, workflowAction, sourceSurface, moduleId) {
    const args = buildOnboardingAnalyticsArgs(workflowAction, sourceSurface, moduleId);
    if (typeof trackSettingsAction !== 'function') return false;
    trackSettingsAction(...args);
    return true;
}
