const ONBOARDING_ACTIONS = new Set(['started', 'completed', 'skipped']);
const ONBOARDING_SOURCES = new Set(['first_run', 'settings']);

export function buildOnboardingAnalyticsArgs(workflowAction, sourceSurface) {
    if (!ONBOARDING_ACTIONS.has(workflowAction)) {
        throw new Error('unsupported onboarding analytics action');
    }
    if (!ONBOARDING_SOURCES.has(sourceSurface)) {
        throw new Error('unsupported onboarding analytics source');
    }
    const params = { source_surface: sourceSurface };
    if (workflowAction !== 'started') params.result = 'success';
    return ['onboarding', workflowAction, params];
}

export function trackOnboardingAnalytics(trackSettingsAction, workflowAction, sourceSurface) {
    const args = buildOnboardingAnalyticsArgs(workflowAction, sourceSurface);
    if (typeof trackSettingsAction !== 'function') return false;
    trackSettingsAction(...args);
    return true;
}
