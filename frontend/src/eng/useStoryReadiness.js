import * as React from 'react';
import { fetchEpicReadiness, fetchStoryReadiness } from '../api/engApi.js';
import { mergeReadinessEpic, patchReadinessEpicField } from './epicRefreshAlerts.js';

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

// Fences the raw epics of a readiness read with the Planning edit state, exactly as the task loaders fence theirs: the read's own
// values supply the base and the evidence of an open edit, then a confirmed edit newer than the read and every pending edit's
// optimistic value go back on top, so a read that started before an edit cannot erase it. Fields an epic does not carry are not invented.
export function fenceReadinessEpics(issueEditState, epics, readToken) {
    if (!issueEditState || !readToken || !Array.isArray(epics)) return epics;
    issueEditState.capturePlanningBases(epics, readToken);
    issueEditState.notePlanningRawRead(epics, readToken);
    return issueEditState.overlayPlanningIssues(issueEditState.reconcilePlanningFields(epics, readToken));
}

function fencedSnapshot(issueEditState, snapshot, readToken) {
    const epics = fenceReadinessEpics(issueEditState, snapshot?.epics, readToken);
    return epics === snapshot?.epics ? snapshot : { ...snapshot, epics };
}

function idleState() {
    return { status: STORY_READINESS_STATUS.IDLE, snapshot: null, error: null, canRetry: false };
}

export function applyStoryReadinessIssueField(snapshot, issueKey, field, value) {
    if (!snapshot || !Array.isArray(snapshot.epics)) return snapshot;
    const key = String(issueKey || '').trim().toUpperCase();
    if (!key || !['summary', 'team', 'assignee'].includes(field)) return snapshot;
    let changed = false;
    const epics = snapshot.epics.map(epic => {
        if (String(epic.key || '').trim().toUpperCase() !== key) return epic;
        changed = true;
        return { ...epic, [field]: value };
    });
    return changed ? { ...snapshot, epics } : snapshot;
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
    issueEditState = null,
    requestStoryReadiness = fetchStoryReadiness,
    requestEpicReadiness = fetchEpicReadiness,
} = {}) {
    const scope = React.useMemo(() => normalizedScope({ groupId, sprintId, sprintName, sprintState }), [
        groupId, sprintId, sprintName, sprintState,
    ]);
    const scopeKey = storyReadinessScopeKey(scope);
    const shouldLoad = Boolean(enabled && primaryReady && scopeKey);
    const [state, setState] = React.useState(idleState);
    const [retryRevision, setRetryRevision] = React.useState(0);
    const completedRefreshRevisionRef = React.useRef(0);
    const scopeRef = React.useRef(scope);
    scopeRef.current = scope;

    React.useEffect(() => {
        if (!shouldLoad) {
            setState(idleState());
            return undefined;
        }

        const controller = new AbortController();
        let current = true;
        const requestRefresh = Number(refreshRevision) !== 0
            && refreshRevision !== completedRefreshRevisionRef.current;
        // The read token is finished exactly once, on commit, failure, abort or an ignored result.
        const readToken = issueEditState?.beginRead();
        const finishRead = () => issueEditState?.finishRead(readToken);
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
            setState({ status: STORY_READINESS_STATUS.READY, snapshot: fencedSnapshot(issueEditState, snapshot, readToken), error: null, canRetry: false });
        }).catch((error) => {
            if (!current || controller.signal.aborted || error?.name === 'AbortError') return;
            const classified = classifyStoryReadinessError(error);
            if (!classified.canRetry) completedRefreshRevisionRef.current = refreshRevision;
            setState({ ...classified, snapshot: null, error: { code: classified.code, recoveryUrl: classified.recoveryUrl } });
        }).finally(finishRead);

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

    const applyIssueField = React.useCallback((issueKey, field, value) => {
        setState(current => {
            const snapshot = applyStoryReadinessIssueField(current.snapshot, issueKey, field, value);
            return snapshot === current.snapshot ? current : { ...current, snapshot };
        });
    }, []);

    // Per-epic refresh (issue #213): upsert or delete one epic in the held snapshot. Unlike the department load it never blanks the
    // snapshot, so the other epics' ghosts stay put; it is a no-op unless the department snapshot is READY for the same scope.
    const mergeEpic = React.useCallback((epicKey, payload, { epicDetails, readToken } = {}) => {
        if (payload && !storyReadinessScopeMatches(payload, scopeRef.current)) return;
        const epicPayload = payload && readToken ? fencedSnapshot(issueEditState, payload, readToken) : payload;
        setState((prev) => {
            if (prev.status !== STORY_READINESS_STATUS.READY || !prev.snapshot) return prev;
            const snapshot = mergeReadinessEpic({ snapshot: prev.snapshot, epicPayload, epicKey, epicDetails });
            return snapshot === prev.snapshot ? prev : { ...prev, snapshot };
        });
    }, [issueEditState]);

    // Local field patch of one epic in the held snapshot (an inline edit of a Stories Required epic that has no sprint stories). Makes no
    // request, never blanks the snapshot and never changes the status; a no-op for an unknown epic or a snapshot that is not READY.
    const patchEpic = React.useCallback((epicKey, field, value) => {
        setState((prev) => {
            if (prev.status !== STORY_READINESS_STATUS.READY || !prev.snapshot) return prev;
            const snapshot = patchReadinessEpicField(prev.snapshot, epicKey, field, value);
            return snapshot === prev.snapshot ? prev : { ...prev, snapshot };
        });
    }, []);

    // One epic's readiness for the current scope: { status: 'ok', payload, readToken, release } or a status that changes nothing (failures are
    // silent). An 'ok' answer retains its edit-state read until the consumer calls `release()` after merging or discarding it; every other
    // answer has already finished its read.
    const loadEpic = React.useCallback(async (epicKey, { signal } = {}) => {
        const requested = scopeRef.current;
        if (!shouldLoad || !storyReadinessScopeKey(requested)) return { status: 'ignored' };
        const readToken = issueEditState?.beginRead();
        let retained = false;
        try {
            const payload = await requestEpicReadiness(backendUrl, {
                sprint: requested.sprintId,
                sprintName: requested.sprintName,
                sprintState: requested.sprintState,
                groupId: requested.groupId,
                epicKey,
                signal,
            });
            if (!storyReadinessScopeMatches(payload, requested)) return { status: 'failed' };
            retained = true;
            return { status: 'ok', payload, readToken, release: () => issueEditState?.finishRead(readToken) };
        } catch (error) {
            return { status: error?.name === 'AbortError' ? 'ignored' : 'failed' };
        } finally {
            if (!retained) issueEditState?.finishRead(readToken);
        }
    }, [shouldLoad, backendUrl, requestEpicReadiness, issueEditState]);

    return { ...state, scope, scopeKey, retry, applyIssueField, mergeEpic, patchEpic, loadEpic };
}
