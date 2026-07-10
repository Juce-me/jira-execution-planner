import * as JepAnalytics from './analytics.js';

export const bucketCount = JepAnalytics.bucketCount;

export function analyticsToken(value, fallback = 'unknown') {
    return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

export function exposeAnalyticsForTests() {
    if (typeof window !== 'undefined') {
        window.JepAnalytics = JepAnalytics;
    }
}

function safeTrackEvent(eventName, params = {}) {
    try {
        JepAnalytics.trackEvent(eventName, params);
    } catch (err) {
        console.warn('Analytics event skipped:', err.message);
    }
}

function safeTrackApiResult(apiSurface, params = {}) {
    try {
        JepAnalytics.trackApiResult(apiSurface, params);
    } catch (err) {
        console.warn('Analytics API result skipped:', err.message);
    }
}

export function buildSortChangedParams(sortScope, sortKey, params = {}) {
    return {
        feature_name: params.feature_name || 'epm',
        sort_scope: sortScope,
        sort_key: analyticsToken(sortKey),
        source_surface: params.source_surface || 'epm',
        ...params,
    };
}

export function planningAnalyticsPayload(nextSelectedTasks, selectionTasks) {
    const selectedKeySet = new Set(Object.keys(nextSelectedTasks || {}).filter(key => nextSelectedTasks[key]));
    let storyPoints = 0;
    (selectionTasks || []).forEach(task => {
        if (!selectedKeySet.has(task.key)) return;
        storyPoints += Number(task.fields.customfield_10004) || 0;
    });
    return {
        feature_name: 'planning',
        status_bucket: selectedKeySet.size > 0 ? 'selected' : '0',
        selected_count: selectedKeySet.size,
        selected_count_bucket: bucketCount(selectedKeySet.size),
        selected_story_points: Math.round(storyPoints * 10) / 10,
        selected_sp_bucket: bucketCount(storyPoints),
        source_surface: 'planning'
    };
}

export function useDashboardAnalytics(React, {
    authMode,
    selectedView,
    showPlanning,
    showStats,
    showScenario,
    serverConnectionError,
}) {
    const { useCallback, useEffect, useRef, useState } = React;
    const [analyticsReady, setAnalyticsReady] = useState(false);
    const analyticsInitializedRef = useRef(false);
    const analyticsPageviewRef = useRef('');
    const analyticsLoginRef = useRef(false);
    const analyticsServerErrorRef = useRef('');
    const analyticsSearchRef = useRef('');
    const currentDashboardView = useCallback(() => (selectedView === 'epm' ? 'epm' : 'eng'), [selectedView]);

    useEffect(() => {
        if (!authMode || analyticsInitializedRef.current) return;
        analyticsInitializedRef.current = true;
        JepAnalytics.initAnalytics()
            .then(() => setAnalyticsReady(true))
            .catch(() => setAnalyticsReady(false));
    }, [authMode]);

    useEffect(() => {
        if (!analyticsReady || !authMode) return;
        const engMode = showScenario ? 'scenario' : showStats ? 'statistics' : showPlanning ? 'planning' : 'catch_up';
        const pageParams = {
            dashboard_view: currentDashboardView(),
            auth_mode: analyticsToken(authMode),
            source_surface: 'dashboard',
            ...(selectedView === 'eng' ? { eng_mode: engMode } : {})
        };
        const signature = JSON.stringify(pageParams);
        if (analyticsPageviewRef.current === signature) return;
        analyticsPageviewRef.current = signature;
        JepAnalytics.trackPageview('dashboard', pageParams);
    }, [analyticsReady, authMode, selectedView, showPlanning, showStats, showScenario, currentDashboardView]);

    const trackProductEvent = useCallback(safeTrackEvent, []);
    const trackApiResult = useCallback(safeTrackApiResult, []);
    const trackAppError = useCallback((errorArea, errorCode, recoverableState, params = {}) => {
        trackProductEvent('app_error_shown', {
            feature_name: errorArea === 'auth' ? 'auth' : 'reliability',
            error_area: errorArea,
            error_code: errorCode,
            recoverable_state: recoverableState,
            source_surface: 'dashboard',
            ...params
        });
    }, [trackProductEvent]);

    useEffect(() => {
        if (!analyticsReady || !authMode || analyticsLoginRef.current) return;
        const mode = analyticsToken(authMode);
        if (mode === 'basic' || mode === 'local_basic') return;
        const sessionKey = `jep.analytics.login.${mode}`;
        try {
            if (window.sessionStorage?.getItem(sessionKey) === '1') return;
            window.sessionStorage?.setItem(sessionKey, '1');
        } catch (err) {
            // Session storage can be unavailable; keep analytics non-blocking.
        }
        analyticsLoginRef.current = true;
        trackProductEvent('login', {
            feature_name: 'auth',
            method: mode,
            auth_mode: mode,
            result: 'success',
            source_surface: 'dashboard'
        });
    }, [analyticsReady, authMode, trackProductEvent]);

    useEffect(() => {
        if (!serverConnectionError) {
            analyticsServerErrorRef.current = '';
            return;
        }
        if (analyticsServerErrorRef.current === serverConnectionError) return;
        analyticsServerErrorRef.current = serverConnectionError;
        trackAppError('server', 'server_unavailable', 'retryable');
    }, [serverConnectionError, trackAppError]);

    const trackSettingsAction = useCallback((section, workflowAction, params = {}) => {
        trackProductEvent('settings_action', {
            feature_name: 'settings',
            section: analyticsToken(section),
            workflow_action: workflowAction,
            source_surface: 'settings',
            ...params
        });
    }, [trackProductEvent]);

    const trackScenarioAction = useCallback((workflowAction, params = {}) => {
        trackProductEvent('scenario_action', {
            feature_name: 'scenario',
            workflow_action: workflowAction,
            source_surface: 'scenario',
            ...params
        });
    }, [trackProductEvent]);

    const trackStatsAction = useCallback((eventName, statsView, params = {}) => {
        trackProductEvent(eventName, {
            feature_name: 'stats',
            stats_view: analyticsToken(statsView),
            source_surface: 'stats',
            ...params
        });
    }, [trackProductEvent]);

    const trackEpmAction = useCallback((workflowAction, params = {}) => {
        trackProductEvent('epm_action', {
            feature_name: 'epm',
            workflow_action: workflowAction,
            source_surface: 'epm',
            ...params
        });
    }, [trackProductEvent]);

    const trackIssueStatusAction = useCallback((workflowAction, params = {}) => {
        trackProductEvent('issue_status_action', {
            feature_name: 'eng_status_transitions',
            workflow_action: workflowAction,
            ...params
        });
    }, [trackProductEvent]);

    const trackIssuePriorityAction = useCallback((workflowAction, params = {}) => {
        trackProductEvent('issue_priority_action', {
            feature_name: 'eng_priority_changes',
            workflow_action: workflowAction,
            ...params
        });
    }, [trackProductEvent]);

    const trackSelectContent = useCallback((contentType, contentId, params = {}) => {
        trackProductEvent('select_content', {
            feature_name: 'dashboard',
            content_type: contentType,
            content_id: analyticsToken(contentId),
            source_surface: 'dashboard',
            ...params
        });
    }, [trackProductEvent]);

    const trackFilterChanged = useCallback((filterType, params = {}) => {
        trackProductEvent('filter_changed', {
            feature_name: params.feature_name || 'dashboard',
            filter_type: filterType,
            source_surface: params.source_surface || 'dashboard',
            scope_type: params.scope_type || currentDashboardView(),
            ...params
        });
    }, [currentDashboardView, trackProductEvent]);

    const trackSortChanged = useCallback((sortScope, sortKey, params = {}) => {
        trackProductEvent('sort_changed', buildSortChangedParams(sortScope, sortKey, params));
    }, [trackProductEvent]);

    const trackPlanningSelection = useCallback((workflowAction, nextSelectedTasks, selectionTasks) => {
        trackProductEvent('planning_action', {
            workflow_action: workflowAction,
            ...planningAnalyticsPayload(nextSelectedTasks, selectionTasks)
        });
    }, [trackProductEvent]);

    const trackSearch = useCallback((searchQuery, resultCount) => {
        const trimmed = String(searchQuery || '').trim();
        if (!trimmed) return;
        const scope = currentDashboardView();
        const signature = `${scope}:${trimmed.length}:${resultCount}`;
        if (analyticsSearchRef.current === signature) return;
        analyticsSearchRef.current = signature;
        trackProductEvent('app_search', {
            feature_name: 'dashboard',
            search_scope: scope,
            source_surface: 'dashboard',
            query_length_bucket: bucketCount(trimmed.length),
            result_count_bucket: bucketCount(resultCount),
            auth_mode: analyticsToken(authMode)
        });
    }, [authMode, currentDashboardView, trackProductEvent]);

    return {
        bucketCount,
        currentDashboardView,
        trackAppError,
        trackApiResult,
        trackEpmAction,
        trackFilterChanged,
        trackIssuePriorityAction,
        trackIssueStatusAction,
        trackPlanningSelection,
        trackProductEvent,
        trackScenarioAction,
        trackSearch,
        trackSelectContent,
        trackSettingsAction,
        trackSortChanged,
        trackStatsAction,
    };
}
