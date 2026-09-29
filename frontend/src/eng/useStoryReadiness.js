import * as React from 'react';
import { fetchStoryReadiness } from '../api/engApi.js';

const SUPPORTED_SPRINT_STATES = new Set(['active', 'future']);

export const STORY_READINESS_STATUS = Object.freeze({
    IDLE: 'idle',
    LOADING: 'loading',
    READY: 'ready',
    UNAVAILABLE: 'unavailable',
    INVALID_CONFIGURATION: 'invalid_configuration',
    ACCESS_DENIED: 'access_denied',
    SCOPE_NOT_FOUND: 'scope_not_found',
    INVALID_SCOPE: 'invalid_scope',
    SCOPE_TOO_LARGE: 'scope_too_large',
});

function normalizedScope({ groupId, sprintId, sprintName, sprintState } = {}) {
    return {
        groupId: String(groupId ?? '').trim(),
        sprintId: String(sprintId ?? '').trim(),
        sprintName: String(sprintName ?? '').trim(),
        sprintState: String(sprintState ?? '').trim().toLowerCase(),
    };
}

export function storyReadinessScopeKey(scope = {}) {
    const normalized = normalizedScope(scope);
    if (!normalized.groupId || !normalized.sprintId || !normalized.sprintName
        || !SUPPORTED_SPRINT_STATES.has(normalized.sprintState)) return '';
    return [normalized.groupId, normalized.sprintId, normalized.sprintName, normalized.sprintState]
        .map(value => `${value.length}:${value}`)
        .join('|');
}

export function storyReadinessScopeMatches(snapshot, scope) {
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.complete !== true) return false;
    const requested = normalizedScope(scope);
    const returned = normalizedScope({
        groupId: snapshot.scope?.groupId,
        sprintId: snapshot.scope?.sprintId,
        sprintName: snapshot.scope?.sprintName,
        sprintState: snapshot.scope?.sprintState,
    });
    return Boolean(storyReadinessScopeKey(requested))
        && requested.groupId === returned.groupId
        && requested.sprintId === returned.sprintId
        && requested.sprintName === returned.sprintName
        && requested.sprintState === returned.sprintState;
}

export function classifyStoryReadinessError(error = {}) {
    const status = Number(error.status) || 0;
    const code = String(error.code || '');
    if (status === 409 || code === 'story_readiness_configuration_invalid') {
        return { status: STORY_READINESS_STATUS.INVALID_CONFIGURATION, code: 'story_readiness_configuration_invalid', canRetry: false };
    }
    if (status === 403 || code === 'missing_project_access') {
        return { status: STORY_READINESS_STATUS.ACCESS_DENIED, code: 'missing_project_access', canRetry: false, recoveryUrl: error.recoveryUrl };
    }
    if (status === 404 || code === 'story_readiness_scope_not_found') {
        return { status: STORY_READINESS_STATUS.SCOPE_NOT_FOUND, code: 'story_readiness_scope_not_found', canRetry: false };
    }
    if (status === 400 || code === 'invalid_story_readiness_scope') {
        return { status: STORY_READINESS_STATUS.INVALID_SCOPE, code: 'invalid_story_readiness_scope', canRetry: false };
    }
    if (status === 422 || code === 'story_readiness_scope_too_large') {
        return { status: STORY_READINESS_STATUS.SCOPE_TOO_LARGE, code: 'story_readiness_scope_too_large', canRetry: false };
    }
    return { status: STORY_READINESS_STATUS.UNAVAILABLE, code: 'story_readiness_unavailable', canRetry: true };
}

function idleState() {
    return { status: STORY_READINESS_STATUS.IDLE, snapshot: null, error: null, canRetry: false };
}

export function useStoryReadiness({
    backendUrl,
    enabled = false,
    primaryReady = false,
    groupId,
    sprintId,
    sprintName,
    sprintState,
    authRevision = '',
    configRevision = '',
    refreshRevision = 0,
    requestStoryReadiness = fetchStoryReadiness,
} = {}) {
    const scope = React.useMemo(() => normalizedScope({ groupId, sprintId, sprintName, sprintState }), [
        groupId, sprintId, sprintName, sprintState,
    ]);
    const scopeKey = storyReadinessScopeKey(scope);
    const shouldLoad = Boolean(enabled && primaryReady && scopeKey);
    const [state, setState] = React.useState(idleState);
    const [retryRevision, setRetryRevision] = React.useState(0);
    const completedRefreshRevisionRef = React.useRef(0);

    React.useEffect(() => {
        if (!shouldLoad) {
            setState(idleState());
            return undefined;
        }

        const controller = new AbortController();
        let current = true;
        const requestRefresh = Number(refreshRevision) !== 0
            && refreshRevision !== completedRefreshRevisionRef.current;
        setState({ status: STORY_READINESS_STATUS.LOADING, snapshot: null, error: null, canRetry: false });

        void requestStoryReadiness(backendUrl, {
            sprint: scope.sprintId,
            sprintName: scope.sprintName,
            sprintState: scope.sprintState,
            groupId: scope.groupId,
            refresh: requestRefresh,
            signal: controller.signal,
        }).then((snapshot) => {
            if (!current || controller.signal.aborted) return;
            if (!storyReadinessScopeMatches(snapshot, scope)) {
                completedRefreshRevisionRef.current = refreshRevision;
                setState({
                    status: STORY_READINESS_STATUS.INVALID_SCOPE,
                    snapshot: null,
                    error: { code: 'invalid_story_readiness_scope' },
                    canRetry: false,
                });
                return;
            }
            completedRefreshRevisionRef.current = refreshRevision;
            setState({ status: STORY_READINESS_STATUS.READY, snapshot, error: null, canRetry: false });
        }).catch((error) => {
            if (!current || controller.signal.aborted || error?.name === 'AbortError') return;
            const classified = classifyStoryReadinessError(error);
            if (!classified.canRetry) completedRefreshRevisionRef.current = refreshRevision;
            setState({ ...classified, snapshot: null, error: { code: classified.code, recoveryUrl: classified.recoveryUrl } });
        });

        return () => {
            current = false;
            controller.abort();
        };
    }, [
        shouldLoad,
        backendUrl,
        scopeKey,
        authRevision,
        configRevision,
        refreshRevision,
        retryRevision,
        requestStoryReadiness,
    ]);

    const retry = React.useCallback(() => {
        if (state.canRetry) setRetryRevision(value => value + 1);
    }, [state.canRetry]);

    return { ...state, scope, scopeKey, retry };
}
