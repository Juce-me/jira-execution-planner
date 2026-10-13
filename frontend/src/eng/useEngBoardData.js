import * as React from 'react';

function emptyWorking() {
    return {
        columns: [],
        declaredColumnIds: [],
        indexReceived: false,
        scopeVersion: null,
        scopeCohortDigest: null,
        epicsByKey: {},
        candidateEpicsByKey: {},
        columnEpicKeys: {},
        childrenByKey: {},
        childColumnByKey: {},
        columnChildKeys: {},
        columnAuthority: {},
        progressByColumn: {},
        columnErrors: {},
        membershipAuthoritative: false,
        childrenAuthoritative: false,
        terminal: null,
    };
}

export function createEngBoardDataState() {
    return {
        mounted: true,
        authLocked: false,
        activeGroupId: null,
        groupRevisions: {},
        scopesByGroup: {},
        activeKey: null,
        requestId: null,
        generationId: null,
        status: 'idle',
        error: null,
        refreshing: false,
        working: emptyWorking(),
        staleSnapshot: null,
        snapshots: {},
        staged: null,
    };
}

function normalizeSprintId(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

export function normalizeEngBoardScope(scope, inheritedSprintId = null) {
    if (scope?.type === 'all_work' || scope?.type === 'component') return { type: scope.type };
    const sprintId = normalizeSprintId(scope?.sprintId ?? inheritedSprintId);
    return sprintId === null ? { type: 'uninitialized' } : { type: 'sprint', sprintId };
}

function hasAuthoritativeIndexScope(scope) {
    return scope?.type === 'all_work' || scope?.type === 'component';
}

function scopeKey(groupId, revision, scope) {
    return [String(groupId), String(revision ?? ''), scope.type, scope.type === 'sprint' ? scope.sprintId : ''].join(':');
}

function mapByKey(items) {
    const result = {};
    for (const item of items || []) result[item.key] = item;
    return result;
}

function columnEpicRefs(epics) {
    const refs = {};
    for (const epic of epics || []) {
        if (!refs[epic.columnId]) refs[epic.columnId] = [];
        refs[epic.columnId].push(epic.key);
    }
    return refs;
}

function replaceColumnItems(existing, ownership, columnId, items) {
    const nextItems = { ...existing };
    const nextOwnership = { ...ownership };
    for (const [key, ownerColumnId] of Object.entries(nextOwnership)) {
        if (ownerColumnId === columnId) {
            delete nextItems[key];
            delete nextOwnership[key];
        }
    }
    for (const item of items || []) {
        nextItems[item.key] = item;
        nextOwnership[item.key] = columnId;
    }
    return { items: nextItems, ownership: nextOwnership };
}

function snapshotFrom(state, working) {
    return {
        ...working,
        stale: false,
        groupId: state.activeGroupId,
        scope: state.scopesByGroup[state.activeGroupId],
        groupRevision: state.groupRevisions[state.activeGroupId],
    };
}

function withTerminalError(state, code, terminal = null) {
    if (code === 'auth_required') {
        return { ...state, authLocked: true, status: 'auth_locked', error: { code }, refreshing: false };
    }
    const retainContent = ['deadline_exceeded', 'jira_unavailable', 'unexpected_eof', 'scope_too_large'].includes(code)
        && state.working.indexReceived;
    return {
        ...state,
        status: 'error',
        error: { code },
        refreshing: false,
        working: retainContent
            ? { ...state.working, childrenAuthoritative: false, terminal: terminal || { type: 'error', code } }
            : { ...emptyWorking(), columns: state.working.columns, terminal },
    };
}

function withScopeChangedError(state, terminal) {
    const snapshots = { ...state.snapshots };
    delete snapshots[state.activeKey];
    return {
        ...withTerminalError(state, 'scope_changed', terminal),
        staleSnapshot: null,
        snapshots,
    };
}

function invalidFrame(state, frame) {
    return withTerminalError(state, 'invalid_frame', frame);
}

function knowsColumn(working, columnId) {
    return working.declaredColumnIds.includes(columnId);
}

function applyFrame(state, frame) {
    if (state.authLocked || !state.mounted) return state;
    if (state.status === 'error' || state.status === 'success' || state.status === 'partial_error') return state;
    if (frame.type !== 'start' && frame.generationId !== state.generationId) return state;

    if (frame.type === 'start') {
        const requestedScope = state.scopesByGroup[state.activeGroupId]?.type;
        if (frame.scope !== requestedScope) return invalidFrame(state, frame);
        const declaredColumnIds = frame.columns.map(column => column.id);
        if (new Set(declaredColumnIds).size !== declaredColumnIds.length) return invalidFrame(state, frame);
        const staleSnapshot = state.staleSnapshot?.scopeVersion === frame.scopeVersion
            ? state.staleSnapshot
            : null;
        const snapshots = staleSnapshot || !state.staleSnapshot
            ? state.snapshots
            : { ...state.snapshots };
        if (!staleSnapshot && state.staleSnapshot) delete snapshots[state.activeKey];
        return {
            ...state,
            generationId: frame.generationId,
            staleSnapshot,
            snapshots,
            working: {
                ...emptyWorking(),
                columns: frame.columns,
                declaredColumnIds,
                scopeVersion: frame.scopeVersion,
                scopeCohortDigest: frame.scopeCohortDigest,
            },
        };
    }

    if (frame.type === 'index') {
        if ((state.working.indexReceived && (state.working.membershipAuthoritative
                || !hasAuthoritativeIndexScope(state.scopesByGroup[state.activeGroupId])))
            || frame.epics.some(epic => !knowsColumn(state.working, epic.columnId))) {
            return invalidFrame(state, frame);
        }
        const authoritative = frame.membership === 'authoritative';
        return {
            ...state,
            working: {
                ...state.working,
                epicsByKey: authoritative ? mapByKey(frame.epics) : state.working.epicsByKey,
                candidateEpicsByKey: authoritative ? {} : mapByKey(frame.epics),
                columnEpicKeys: authoritative ? columnEpicRefs(frame.epics) : state.working.columnEpicKeys,
                membershipAuthoritative: authoritative,
                indexReceived: true,
            },
        };
    }

    if (frame.type === 'progress') {
        const scope = state.scopesByGroup[state.activeGroupId];
        if ((hasAuthoritativeIndexScope(scope) && !state.working.membershipAuthoritative)
            || !knowsColumn(state.working, frame.columnId)) return invalidFrame(state, frame);
        return {
            ...state,
            working: {
                ...state.working,
                progressByColumn: {
                    ...state.working.progressByColumn,
                    [frame.columnId]: { loadedChildren: frame.loadedChildren, byEpic: frame.byEpic },
                },
            },
        };
    }

    if (frame.type === 'column') {
        const scope = state.scopesByGroup[state.activeGroupId];
        if (!state.working.indexReceived
            || (hasAuthoritativeIndexScope(scope) && !state.working.membershipAuthoritative)
            || !knowsColumn(state.working, frame.columnId)
            || frame.epics.some(epic => epic.columnId !== frame.columnId)
            || Object.prototype.hasOwnProperty.call(state.working.columnAuthority, frame.columnId)) {
            return invalidFrame(state, frame);
        }
        const incomingEpics = mapByKey(frame.epics);
        const epicsByKey = { ...state.working.epicsByKey };
        if (hasAuthoritativeIndexScope(scope) && state.working.membershipAuthoritative) {
            for (const [key, value] of Object.entries(incomingEpics)) {
                if (epicsByKey[key]) epicsByKey[key] = value;
            }
        } else {
            Object.assign(epicsByKey, incomingEpics);
        }
        const storedChildren = replaceColumnItems(
            state.working.childrenByKey,
            state.working.childColumnByKey,
            frame.columnId,
            frame.children
        );
        const progressByColumn = { ...state.working.progressByColumn };
        delete progressByColumn[frame.columnId];
        const columnErrors = { ...state.working.columnErrors };
        delete columnErrors[frame.columnId];
        return {
            ...state,
            working: {
                ...state.working,
                epicsByKey,
                columnEpicKeys: hasAuthoritativeIndexScope(scope) && state.working.membershipAuthoritative
                    ? state.working.columnEpicKeys
                    : { ...state.working.columnEpicKeys, [frame.columnId]: frame.epics.map(item => item.key) },
                childrenByKey: storedChildren.items,
                childColumnByKey: storedChildren.ownership,
                columnChildKeys: { ...state.working.columnChildKeys, [frame.columnId]: frame.children.map(item => item.key) },
                columnAuthority: { ...state.working.columnAuthority, [frame.columnId]: true },
                progressByColumn,
                columnErrors,
            },
        };
    }

    if (frame.type === 'column_error') {
        const scope = state.scopesByGroup[state.activeGroupId];
        if (!state.working.indexReceived
            || (hasAuthoritativeIndexScope(scope) && !state.working.membershipAuthoritative)
            || !knowsColumn(state.working, frame.columnId)
            || Object.prototype.hasOwnProperty.call(state.working.columnAuthority, frame.columnId)) {
            return invalidFrame(state, frame);
        }
        return {
            ...state,
            working: {
                ...state.working,
                columnAuthority: { ...state.working.columnAuthority, [frame.columnId]: false },
                columnErrors: { ...state.working.columnErrors, [frame.columnId]: { code: frame.code, retryable: frame.retryable } },
            },
        };
    }

    if (frame.type === 'error') {
        return frame.code === 'scope_changed'
            ? withScopeChangedError(state, frame)
            : withTerminalError(state, frame.code, frame);
    }

    if (frame.type === 'complete' && frame.outcome === 'partial_error') {
        return {
            ...state,
            status: 'partial_error',
            refreshing: false,
            error: { code: 'partial_error', failedColumnIds: frame.failedColumnIds },
            working: { ...state.working, childrenAuthoritative: false, terminal: frame },
        };
    }

    if (frame.type === 'complete') {
        const scope = state.scopesByGroup[state.activeGroupId];
        if (!state.working.indexReceived
            || (hasAuthoritativeIndexScope(scope) && !state.working.membershipAuthoritative)
            || !state.working.declaredColumnIds.every(columnId => state.working.columnAuthority[columnId] === true)) {
            return invalidFrame(state, frame);
        }
        let epicsByKey = state.working.epicsByKey;
        let columnEpicKeys = state.working.columnEpicKeys;
        if (scope?.type === 'sprint') {
            const qualifiedKeys = new Set(Object.values(columnEpicKeys).flat());
            epicsByKey = Object.fromEntries(
                Object.entries({ ...state.working.candidateEpicsByKey, ...epicsByKey })
                    .filter(([key]) => qualifiedKeys.has(key))
            );
            columnEpicKeys = Object.fromEntries(
                Object.entries(columnEpicKeys).map(([columnId, keys]) => [
                    columnId, keys.filter(key => Object.prototype.hasOwnProperty.call(epicsByKey, key)),
                ])
            );
        }
        const working = {
            ...state.working,
            epicsByKey,
            candidateEpicsByKey: {},
            columnEpicKeys,
            progressByColumn: {},
            membershipAuthoritative: true,
            childrenAuthoritative: true,
            terminal: frame,
        };
        if (Object.keys(epicsByKey).length !== frame.epicCount
            || Object.keys(working.childrenByKey).length !== frame.childCount) {
            return invalidFrame(state, frame);
        }
        const snapshot = snapshotFrom(state, working);
        return {
            ...state,
            status: 'success',
            refreshing: false,
            error: null,
            working,
            staleSnapshot: null,
            snapshots: { ...state.snapshots, [state.activeKey]: snapshot },
        };
    }

    return state;
}

export function engBoardDataReducer(state, action) {
    if (!state.mounted && action.type !== 'mount') return state;
    switch (action.type) {
        case 'select_group': {
            const groupId = String(action.groupId);
            const existingScope = state.scopesByGroup[groupId];
            const inheritedScope = normalizeEngBoardScope(null, action.inheritedSprintId);
            const scopesByGroup = !Object.prototype.hasOwnProperty.call(state.scopesByGroup, groupId)
                ? { ...state.scopesByGroup, [groupId]: inheritedScope }
                : existingScope.type === 'uninitialized' && inheritedScope.type === 'sprint'
                    ? { ...state.scopesByGroup, [groupId]: inheritedScope }
                    : state.scopesByGroup;
            const groupRevisions = { ...state.groupRevisions, [groupId]: action.revision ?? null };
            const scope = scopesByGroup[groupId];
            return {
                ...state,
                activeGroupId: groupId,
                scopesByGroup,
                groupRevisions,
                activeKey: scopeKey(groupId, groupRevisions[groupId], scope),
                requestId: state.activeGroupId === groupId ? state.requestId : null,
                status: state.activeGroupId === groupId ? state.status : 'idle',
                error: state.activeGroupId === groupId ? state.error : null,
                working: state.activeGroupId === groupId ? state.working : emptyWorking(),
                staleSnapshot: state.activeGroupId === groupId ? state.staleSnapshot : null,
                generationId: state.activeGroupId === groupId ? state.generationId : null,
            };
        }
        case 'set_scope': {
            const groupId = String(action.groupId);
            const scope = normalizeEngBoardScope(action.scope);
            const active = state.activeGroupId === groupId;
            return {
                ...state,
                scopesByGroup: { ...state.scopesByGroup, [groupId]: scope },
                activeKey: active ? scopeKey(groupId, state.groupRevisions[groupId], scope) : state.activeKey,
                requestId: active ? null : state.requestId,
                generationId: active ? null : state.generationId,
                status: active ? 'idle' : state.status,
                error: active ? null : state.error,
                working: active ? emptyWorking() : state.working,
                staleSnapshot: active ? null : state.staleSnapshot,
            };
        }
        case 'start_automatic': {
            if (state.authLocked || !state.activeKey) return state;
            const data = engBoardDataReducer(state, { type: 'start_load', requestId: action.requestId, refresh: true });
            return { ...state, staged: { requestId: action.requestId, data: { ...data, staged: null } } };
        }
        case 'staged_frame': {
            if (state.staged?.requestId !== action.requestId) return state;
            let data = state.staged.data;
            if (action.frame.type === 'start' && data.staleSnapshot
                && data.staleSnapshot.scopeCohortDigest === action.frame.scopeCohortDigest) {
                data = { ...data, staleSnapshot: { ...data.staleSnapshot, scopeVersion: action.frame.scopeVersion } };
            }
            return { ...state, staged: { ...state.staged, data: applyFrame(data, action.frame) } };
        }
        case 'commit_staged': {
            if (state.staged?.requestId !== action.requestId || state.staged.data.status !== 'success') return state;
            return { ...state.staged.data, staged: null };
        }
        case 'deny_staged': {
            if (state.staged?.requestId !== action.requestId) return state;
            const snapshots = { ...state.snapshots }; delete snapshots[state.activeKey];
            return { ...state, staged: null, snapshots, staleSnapshot: null,
                working: { ...emptyWorking(), membershipAuthoritative: true, childrenAuthoritative: true },
                status: 'success', error: null, refreshing: false };
        }
        case 'discard_staged':
            return state.staged?.requestId === action.requestId ? { ...state, staged: null } : state;
        case 'start_load': {
            if (state.authLocked || !state.activeKey) return state;
            const compatible = state.snapshots[state.activeKey] || null;
            return {
                ...state,
                requestId: action.requestId,
                staged: null,
                generationId: null,
                status: 'loading',
                error: null,
                refreshing: Boolean(action.refresh),
                working: emptyWorking(),
                staleSnapshot: compatible ? { ...compatible, stale: true } : null,
            };
        }
        case 'frame':
            if (action.requestId !== state.requestId) return state;
            return applyFrame(state, action.frame);
        case 'load_failed':
            if (action.requestId !== state.requestId || state.authLocked) return state;
            return withTerminalError(state, action.code || 'jira_unavailable');
        case 'group_revision_changed': {
            const groupId = String(action.groupId);
            const snapshots = Object.fromEntries(
                Object.entries(state.snapshots).filter(([, value]) => value.groupId !== groupId)
            );
            if (state.activeGroupId !== groupId) {
                return { ...state, snapshots, groupRevisions: { ...state.groupRevisions, [groupId]: action.revision ?? null } };
            }
            const scope = state.scopesByGroup[groupId];
            return {
                ...state,
                snapshots,
                groupRevisions: { ...state.groupRevisions, [groupId]: action.revision ?? null },
                activeKey: scopeKey(groupId, action.revision ?? null, scope),
                requestId: null,
                generationId: null,
                status: 'idle',
                error: null,
                working: emptyWorking(),
                staleSnapshot: null,
            };
        }
        case 'auth_lock':
            return { ...state, authLocked: true, status: 'auth_locked', error: { code: 'auth_required' }, refreshing: false };
        case 'retire':
            return {
                ...state,
                requestId: null,
                generationId: null,
                status: 'idle',
                error: null,
                refreshing: false,
                working: emptyWorking(),
                staleSnapshot: null,
            };
        case 'unmount':
            return {
                ...state,
                mounted: false,
                requestId: null,
                generationId: null,
                status: 'idle',
                refreshing: false,
                working: emptyWorking(),
                staleSnapshot: null,
            };
        case 'mount':
            return { ...state, mounted: true };
        default:
            return state;
    }
}

function isAuthError(error) {
    return error?.code === 'auth_required' || error?.name === 'AuthenticationRequiredError' || error?.status === 401;
}

export function createEngBoardDataOwner({
    streamBoard,
    onAuthRequired = () => {},
    createMeasurement = null,
    beforeCommit = () => {},
    afterCommit = () => {},
}) {
    let state = createEngBoardDataState();
    let requestSequence = 0;
    let activeEntry = null;
    let resolvedFocusColumnId = null;
    let listeners = new Set();

    const emit = action => {
        const next = engBoardDataReducer(state, action);
        if (next === state) return;
        const committing = ['commit_staged', 'deny_staged'].includes(action.type);
        const bridge = committing ? beforeCommit(next.working, action.shouldApply, action.deniedEpicKeys, action.scopeDenied ? { scopeDenied: true } : null) : null;
        state = next;
        for (const listener of listeners) listener();
        if (committing) return afterCommit(bridge, next.working);
    };

    const observe = (callback, onSettled = null) => {
        const settle = () => {
            if (!onSettled) return;
            try { onSettled(); } catch (_) { /* optional observer cleanup */ }
        };
        try {
            void Promise.resolve(callback()).then(settle, settle);
        } catch (_) {
            // Optional Board measurement must not fail or delay Board data.
            settle();
        }
    };

    const retireMeasurement = entry => {
        if (!entry?.measurement || !['active', 'finishing'].includes(entry.measurementState)) return;
        entry.measurementState = 'retired';
        observe(() => (typeof entry.measurement.retire === 'function'
            ? entry.measurement.retire()
            : entry.measurement.cancel?.()));
    };

    const cancelActive = () => {
        const entry = activeEntry;
        if (!entry) return;
        entry.controller.abort();
        retireMeasurement(entry);
        if (entry.automatic) emit({ type: 'discard_staged', requestId: entry.requestId });
        if (activeEntry === entry) activeEntry = null;
    };

    const load = async ({ refresh = false, source, signal, shouldApply = () => true } = {}) => {
        const automatic = source === 'automatic';
        if (automatic && (signal?.aborted || !shouldApply())) return 'ignored';
        if (!state.mounted || state.authLocked || !state.activeGroupId) return 'ignored';
        if (state.scopesByGroup[state.activeGroupId]?.type === 'uninitialized') return 'uninitialized';
        if (automatic && (state.status === 'loading' || (activeEntry && !activeEntry.automatic))) return 'ignored';
        cancelActive();
        const requestId = ++requestSequence;
        const controller = new AbortController();
        emit({ type: automatic ? 'start_automatic' : 'start_load', requestId, refresh });
        const groupId = state.activeGroupId;
        const scope = state.scopesByGroup[groupId];
        const initialFocus = resolvedFocusColumnId;
        let measurement = null;
        if (createMeasurement && !automatic) {
            try {
                measurement = createMeasurement({
                    groupId,
                    scopeType: scope.type,
                    sprintId: scope.type === 'sprint' ? scope.sprintId : null,
                }) || null;
            } catch (_) {
                measurement = null;
            }
        }
        const entry = {
            requestId, controller, automatic, measurement, measurementState: 'active', streamSettled: false,
        };
        activeEntry = entry;
        const current = () => activeEntry === entry && !controller.signal.aborted && state.mounted
            && !state.authLocked && (!automatic || (shouldApply() && !signal?.aborted && state.staged?.requestId === requestId));
        const abort = () => { controller.abort(); retireMeasurement(entry); if (automatic) emit({ type: 'discard_staged', requestId }); };
        signal?.addEventListener('abort', abort, { once: true });
        let measuredFocusColumnId = initialFocus || null;
        let acceptedTerminal = null;
        let automaticFailure = false;
        const finishMeasurement = terminal => {
            if (!measurement || entry.measurementState !== 'active' || activeEntry !== entry
                || !state.mounted || state.authLocked) return;
            entry.measurementState = 'finishing';
            observe(() => measurement.finish?.(terminal), () => {
                if (entry.measurementState === 'finishing') entry.measurementState = 'settled';
                if (entry.streamSettled && activeEntry === entry) activeEntry = null;
            });
        };
        try {
            await streamBoard({
                departmentId: groupId,
                scope: scope.type,
                sprintId: scope.type === 'sprint' ? scope.sprintId : undefined,
                focusedColumnId: initialFocus || undefined,
                refresh,
                signal: controller.signal,
                onFrame: (nextFrame, frameMeta = {}) => {
                    // Terminal authentication wins even when its request was retired.
                    if (nextFrame.type === 'error' && nextFrame.code === 'auth_required') {
                        emit({ type: 'auth_lock' }); onAuthRequired(); retireMeasurement(entry); return;
                    }
                    if (!current() || (!automatic && state.requestId !== requestId)) { abort(); return; }
                    observe(() => measurement?.addPayloadBytes?.(frameMeta.payloadBytes));
                    if (nextFrame.type === 'start') {
                        if (automatic && state.snapshots[state.activeKey]?.scopeCohortDigest
                            && state.snapshots[state.activeKey].scopeCohortDigest !== nextFrame.scopeCohortDigest) { automaticFailure = true; abort(); return; }
                        observe(() => measurement?.start?.(nextFrame));
                        if (!nextFrame.columns.some(column => column.id === measuredFocusColumnId)) {
                            measuredFocusColumnId = nextFrame.columns[0]?.id || null;
                        }
                    }
                    if (automatic) emit({ type: 'staged_frame', requestId, frame: nextFrame });
                    else {
                    emit({ type: 'frame', requestId, frame: nextFrame });
                    }
                    const frameState = automatic ? state.staged?.data : state;
                    if (!frameState) return;
                    if (frameState.status === 'error' && frameState.error?.code === 'invalid_frame') {
                        automaticFailure = automatic;
                        controller.abort();
                        if (automatic) retireMeasurement(entry); else finishMeasurement({ outcome: 'error' });
                        return;
                    }
                    if (nextFrame.type === 'column' && nextFrame.columnId === measuredFocusColumnId
                        && frameState.working.columnAuthority[nextFrame.columnId] === true) {
                        observe(() => measurement?.focusedContentReady?.());
                    }
                    if (nextFrame.type === 'complete' || nextFrame.type === 'error') {
                        if (nextFrame.type === 'error' && nextFrame.code === 'auth_required') onAuthRequired();
                        if (state.authLocked) {
                            retireMeasurement(entry);
                            return;
                        }
                        const success = nextFrame.type === 'complete'
                            && nextFrame.outcome === 'success' && frameState.status === 'success';
                        if (automatic && (!success || !current())) { retireMeasurement(entry); return; }
                        const terminalSample = {
                            outcome: success ? 'success' : 'error',
                            diagnostics: nextFrame.diagnostics || null,
                            epicCount: success ? Object.keys(frameState.working.epicsByKey).length : null,
                            issueCount: success ? Object.keys(frameState.working.childrenByKey).length : null,
                            dependencyDurationMs: null,
                        };
                        if (automatic) acceptedTerminal = terminalSample;
                        else finishMeasurement(terminalSample);
                    }
                },
            });
            if (automatic) {
                if (automaticFailure && activeEntry === entry && state.mounted && !state.authLocked && shouldApply() && !signal?.aborted) return 'error';
                if (!current()) return 'ignored';
                const outcome = state.staged.data.status;
                if (outcome === 'success') {
                    await emit({ type: 'commit_staged', requestId, shouldApply });
                    if (shouldApply() && !signal?.aborted) finishMeasurement(acceptedTerminal);
                    else retireMeasurement(entry);
                }
                return outcome === 'loading' ? 'error' : outcome;
            }
            return state.requestId === requestId ? state.status : 'ignored';
        } catch (error) {
            if (isAuthError(error)) {
                emit({ type: 'auth_lock' });
                onAuthRequired(error);
                retireMeasurement(entry);
                return 'auth_locked';
            }
            if (automaticFailure && activeEntry === entry && state.mounted && !state.authLocked && shouldApply() && !signal?.aborted) return 'error';
            if (error?.name === 'AbortError' || !current() || (!automatic && state.requestId !== requestId)) return 'ignored';
            if (automatic && error?.status === 403 && error.code === 'board_permission_denied') {
                const deniedEpicKeys = Object.keys(state.working.epicsByKey);
                retireMeasurement(entry); await emit({ type: 'deny_staged', requestId, shouldApply, deniedEpicKeys, scopeDenied: true }); return 'denied';
            }
            if (automatic) { retireMeasurement(entry); return 'error'; }
            emit({ type: 'load_failed', requestId, code: error?.code || 'jira_unavailable' });
            finishMeasurement({ outcome: 'error' });
            return 'error';
        } finally {
            signal?.removeEventListener('abort', abort);
            if (automatic && entry.measurementState === 'active') retireMeasurement(entry);
            if (automatic) emit({ type: 'discard_staged', requestId });
            entry.streamSettled = true;
            if (entry.measurementState !== 'finishing' && activeEntry === entry) activeEntry = null;
        }
    };

    return {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        selectGroup(groupId, inheritedSprintId, revision = null) {
            const normalizedGroupId = String(groupId);
            const wasInitialized = Object.prototype.hasOwnProperty.call(state.scopesByGroup, normalizedGroupId);
            const previousScope = state.scopesByGroup[normalizedGroupId];
            const groupChanged = state.activeGroupId !== normalizedGroupId;
            const previousRevision = state.groupRevisions[String(groupId)];
            const revisionChanged = previousRevision !== undefined && previousRevision !== revision;
            if (groupChanged) cancelActive();
            if (revisionChanged) {
                cancelActive();
                emit({ type: 'group_revision_changed', groupId, revision });
            }
            emit({ type: 'select_group', groupId, inheritedSprintId, revision });
            const inheritedNow = previousScope?.type === 'uninitialized'
                && state.scopesByGroup[normalizedGroupId]?.type === 'sprint';
            return !wasInitialized || inheritedNow || groupChanged || revisionChanged;
        },
        setScope(scope) {
            if (!state.activeGroupId) return Promise.resolve('ignored');
            cancelActive();
            emit({ type: 'set_scope', groupId: state.activeGroupId, scope });
            return load({ refresh: false });
        },
        setResolvedFocus(columnId) {
            resolvedFocusColumnId = columnId || null;
        },
        load,
        refresh: options => load({ ...options, refresh: true }),
        retry: () => load({ refresh: true }),
        changeGroupRevision(groupId, revision) {
            cancelActive();
            emit({ type: 'group_revision_changed', groupId, revision });
            return state.activeGroupId === String(groupId) ? load({ refresh: true }) : Promise.resolve('ignored');
        },
        retire() {
            cancelActive();
            emit({ type: 'retire' });
        },
        mount() {
            emit({ type: 'mount' });
        },
        dispose() {
            cancelActive();
            emit({ type: 'unmount' });
        },
    };
}

export function useEngBoardData({
    active = true,
    departmentId,
    inheritedSprintId,
    groupRevision = null,
    resolvedFocusColumnId = null,
    streamBoard,
    onAuthRequired,
    createMeasurement,
    strictScope = null,
    beforeCommit, afterCommit,
}) {
    const commitRef = React.useRef(null); commitRef.current = { beforeCommit, afterCommit };
    const ownerRef = React.useRef(null);
    if (!ownerRef.current) {
        ownerRef.current = createEngBoardDataOwner({ streamBoard, onAuthRequired, createMeasurement,
            beforeCommit: (data, guard, deniedKeys, observation) => commitRef.current.beforeCommit?.(data, guard, deniedKeys, observation), afterCommit: (bridge, data) => commitRef.current.afterCommit?.(bridge, data) });
    }
    const owner = ownerRef.current;
    const state = React.useSyncExternalStore(owner.subscribe, owner.getState, owner.getState);

    React.useEffect(() => {
        owner.mount();
        return () => owner.dispose();
    }, [owner]);
    React.useEffect(() => {
        if (!active || !departmentId) {
            owner.retire();
            return;
        }
        const changed = owner.selectGroup(departmentId, inheritedSprintId, groupRevision);
        if (['all_work', 'component'].includes(strictScope)
            && owner.getState().scopesByGroup[String(departmentId)]?.type !== strictScope) {
            void owner.setScope({ type: strictScope });
            return;
        }
        if (changed || owner.getState().status === 'idle') owner.load();
    }, [active, departmentId, inheritedSprintId, groupRevision, owner, strictScope]);
    React.useEffect(() => {
        if (active) owner.setResolvedFocus(resolvedFocusColumnId);
    }, [active, resolvedFocusColumnId, owner]);

    return {
        ...state,
        scope: state.activeGroupId ? state.scopesByGroup[state.activeGroupId] : null,
        displayData: state.staleSnapshot || state.working,
        setScope: owner.setScope,
        refresh: owner.refresh,
        retry: owner.retry,
        setResolvedFocus: owner.setResolvedFocus,
    };
}
