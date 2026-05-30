import {
    bucketCount,
    bucketDuration,
    sanitizeAnalyticsParams,
    validateAnalyticsPayload
} from './events.js';

let initialized = false;
let enabled = false;
let currentWindow = null;
let analyticsUserId = null;
let measurementId = null;
let debugMode = false;
let contextFetcher = null;
let contextRefreshTimer = null;

const DEFAULT_CONTEXT_REFRESH_INTERVAL_MS = 60000;

const API_SURFACES = new Set([
    'config_bootstrap',
    'auth_status',
    'home_connection',
    'eng_tasks',
    'stats_source',
    'scenario',
    'scenario_drafts',
    'epm_projects',
    'epm_rollup',
    'settings_save'
]);

function getWindow() {
    if (typeof window === 'undefined') return null;
    if (currentWindow && currentWindow !== window) {
        stopContextRefreshTimer();
        initialized = false;
        enabled = false;
        analyticsUserId = null;
        measurementId = null;
        debugMode = false;
        contextFetcher = null;
    }
    currentWindow = window;
    return window;
}

function ensureDataLayer() {
    const win = getWindow();
    if (!win) return null;
    if (!win.dataLayer) {
        win.dataLayer = [];
    }
    return win.dataLayer;
}

function pushDataLayer(payload) {
    const dataLayer = ensureDataLayer();
    if (!dataLayer || !enabled || !initialized) return;
    const entry = validateAnalyticsPayload(payload);
    dataLayer.push(entry);
}

function appendGtmScript(containerId) {
    if (!containerId || typeof document === 'undefined' || !document.head) return;
    if (document.querySelector?.(`[data-analytics-gtm="${containerId}"]`)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
    script.dataset.analyticsGtm = containerId;
    document.head.appendChild(script);
}

function setGoogleAnalyticsDisabled(id, disabled) {
    const win = getWindow();
    if (!win || !id) return;
    win[`ga-disable-${id}`] = Boolean(disabled);
}

function stopContextRefreshTimer() {
    if (!contextRefreshTimer) return;
    clearInterval(contextRefreshTimer);
    contextRefreshTimer = null;
}

function startContextRefreshTimer(intervalMs) {
    stopContextRefreshTimer();
    const refreshMs = Number(intervalMs);
    if (!enabled || !Number.isFinite(refreshMs) || refreshMs <= 0) return;
    contextRefreshTimer = setInterval(() => {
        refreshAnalyticsContext().catch(() => {});
    }, refreshMs);
    contextRefreshTimer.unref?.();
}

async function defaultFetchContext() {
    const response = await fetch('/api/analytics/context', {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'jira-execution-planner' }
    });
    if (!response.ok) {
        return { enabled: false };
    }
    return response.json();
}

function applyAnalyticsContext(context = {}) {
    initialized = true;
    const nextEnabled = Boolean(context?.enabled);
    const nextMeasurementId = context?.measurementId || measurementId;
    if (!nextEnabled) {
        setGoogleAnalyticsDisabled(nextMeasurementId, true);
        enabled = false;
        analyticsUserId = null;
        debugMode = false;
        stopContextRefreshTimer();
        return { enabled, ga4UserId: analyticsUserId };
    }

    enabled = true;
    measurementId = context?.measurementId || null;
    analyticsUserId = context?.ga4UserId || null;
    debugMode = Boolean(context?.debugMode);
    setGoogleAnalyticsDisabled(measurementId, false);
    appendGtmScript(context?.gtmContainerId);
    return { enabled, ga4UserId: analyticsUserId };
}

async function fetchAnalyticsContext(fetchContext) {
    try {
        return await fetchContext();
    } catch (err) {
        return { enabled: false };
    }
}

export async function initAnalytics(options = {}) {
    ensureDataLayer();
    contextFetcher = options.fetchContext || defaultFetchContext;
    const context = await fetchAnalyticsContext(contextFetcher);
    const result = applyAnalyticsContext(context);
    startContextRefreshTimer(options.contextRefreshIntervalMs ?? DEFAULT_CONTEXT_REFRESH_INTERVAL_MS);
    return result;
}

export async function refreshAnalyticsContext() {
    if (!contextFetcher) {
        return { enabled: false, ga4UserId: null };
    }
    const context = await fetchAnalyticsContext(contextFetcher);
    return applyAnalyticsContext(context);
}

export function setAnalyticsUser(userId) {
    analyticsUserId = userId || null;
}

function withContext(params) {
    return {
        ...params,
        ...(analyticsUserId ? { ga4_user_id: analyticsUserId } : {}),
        ...(debugMode ? { debug_mode: true } : {})
    };
}

export function trackPageview(pageName, params = {}) {
    const clean = sanitizeAnalyticsParams({ ...params, page_name: pageName }, 'page_view');
    pushDataLayer(withContext({
        event: 'pageview',
        trigger: 'pageview',
        event_type: 'pageview',
        event_name: 'page_view',
        ...clean
    }));
}

export function trackEvent(eventName, params = {}) {
    const clean = sanitizeAnalyticsParams(params, eventName);
    pushDataLayer(withContext({
        event: 'userevent',
        trigger: 'userevent',
        event_type: 'event',
        event_name: eventName,
        ...clean
    }));
}

export function trackExternalLinkOpened({
    linkType,
    issueKind,
    issueCount,
    epmTab,
    projectScope,
    sourceSurface,
    result
} = {}) {
    trackEvent('external_link_opened', {
        feature_name: 'external_links',
        link_type: linkType,
        ...(issueKind ? { issue_kind: issueKind } : {}),
        ...(issueCount === undefined ? {} : { issue_count_bucket: bucketCount(issueCount) }),
        ...(epmTab ? { epm_tab: epmTab } : {}),
        ...(projectScope ? { project_scope: projectScope } : {}),
        source_surface: sourceSurface,
        result
    });
}

function statusBucket(status) {
    const value = Number(status) || 0;
    if (value >= 200 && value < 300) return '2xx';
    if (value >= 300 && value < 400) return '3xx';
    if (value >= 400 && value < 500) return '4xx';
    if (value >= 500 && value < 600) return '5xx';
    return '0';
}

export function trackApiResult(apiSurface, {
    featureName = 'api',
    method = 'GET',
    status = 0,
    durationMs = 0,
    cacheState = 'unknown',
    epmTab,
    projectScope,
    subgoalScope
} = {}) {
    if (!API_SURFACES.has(apiSurface)) {
        throw new Error(`unsupported api surface: ${apiSurface}`);
    }
    const normalizedStatus = Number(status) || 0;
    trackEvent('api_result', {
        feature_name: featureName,
        api_surface: apiSurface,
        method: String(method || 'GET').toUpperCase(),
        status_bucket: statusBucket(normalizedStatus),
        result: normalizedStatus >= 200 && normalizedStatus < 400 ? 'success' : 'failure',
        duration_bucket: bucketDuration(durationMs),
        duration_ms: Math.max(0, Number(durationMs) || 0),
        cache_state: cacheState || 'unknown',
        ...(epmTab ? { epm_tab: epmTab } : {}),
        ...(projectScope ? { project_scope: projectScope } : {}),
        ...(subgoalScope ? { subgoal_scope: subgoalScope } : {})
    });
}

export {
    bucketCount,
    bucketDuration,
    sanitizeAnalyticsParams
};
