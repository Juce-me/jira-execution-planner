import * as React from 'react';
import { normalizeScenarioDraftOverrides } from './scenarioDraftOverrides.js';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from '../api/authRequired.js';
import { bucketCount } from '../analytics/dashboardAnalytics.js';

export function useScenarioHistory({
    scenarioState,
    trackScenarioAction,
    fetchScenarioDraft,
    postScenarioRealtimeJson,
    saveScenarioDraftVersion,
    fetchScenarioDraftVersion,
    rollbackScenarioDraft,
    reloadScenarioDraftFromJira,
    buildScenarioDraftScope,
    scenarioScopeKey,
    scenarioHasUnsavedChanges,
    scenarioCanSaveDraft,
    isScenarioScopeDraftCurrent,
}) {
    const {
        scenarioHistoryButtonRef,
        scenarioHistoryPanelRef,
        scenarioHistoryTitleRef,
        scenarioOverrides,
        setScenarioOverrides,
        scenarioDraftMeta,
        setScenarioDraftMeta,
        scenarioUndoStackRef,
        setScenarioUndoVersion,
        scenarioHistoryRefreshControllerRef,
        scenarioHistoryActionControllerRef,
    } = scenarioState;
    const saveScenarioDraft = async () => {
        const saveScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        if (!saveScopeKey || !scenarioCanSaveDraft) return;
        trackScenarioAction('draft_save', { dirty_state: scenarioHasUnsavedChanges ? 'dirty' : 'clean', override_count_bucket: bucketCount(Object.keys(normalizeScenarioDraftOverrides(scenarioOverrides)).length) });
        setScenarioDraftMeta(prev => ({
            ...prev,
            saving: true,
            conflict: null,
            message: '',
            error: ''
        }));
        try {
            const saved = await saveScenarioDraftVersion(
                saveScopeKey,
                `Draft ${new Date().toISOString().slice(0, 10)}`,
                scenarioDraftMeta.baseDraftRevision,
                saveScopeKey === scenarioScopeKey ? buildScenarioDraftScope() : (scenarioDraftMeta.scopePayload || {}),
                scenarioOverrides,
            );
            const activeDraft = saved.activeDraft || null;
            const versions = Array.isArray(saved.versions) ? saved.versions : [];
            const savedOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || scenarioOverrides);
            scenarioUndoStackRef.current.clear();
            setScenarioUndoVersion(0);
            setScenarioDraftMeta(prev => ({
                ...prev,
                activeDraft,
                versions,
                loadedVersionNumber: activeDraft?.versionNumber || null,
                baseDraftRevision: activeDraft?.draftRevision || null,
                savedOverrides,
                scopeKey: saveScopeKey,
                dirtyState: 'clean',
                pendingScopeChange: null,
                saving: false,
                staleDraft: null,
                conflict: null,
                message: 'Scenario draft saved.',
                error: ''
            }));
            trackScenarioAction('draft_save_result', { result: 'success' });
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            const conflict = err.payload?.error === 'scenario_draft_conflict' && err.payload?.conflict
                ? {
                    ...err.payload.conflict,
                    activeDraft: err.payload.activeDraft || null,
                    versions: Array.isArray(err.payload.versions) ? err.payload.versions : []
                }
                : null;
            setScenarioDraftMeta(prev => {
                if (conflict) {
                    return {
                        ...prev,
                        versions: conflict.versions.length > 0 ? conflict.versions : prev.versions,
                        saving: false,
                        dirtyState: 'conflict_remote',
                        conflict,
                        error: ''
                    };
                }
                return {
                    ...prev,
                    saving: false,
                    error: err.message || 'Failed to save scenario draft.'
                };
            });
            trackScenarioAction('draft_save_result', { result: 'failure', conflict_state: conflict ? 'conflict_remote' : 'none' });
        }
    };

    const discardScenarioOverrides = () => {
        if (!scenarioHasUnsavedChanges) return;
        setScenarioOverrides(normalizeScenarioDraftOverrides(scenarioDraftMeta.savedOverrides));
        setScenarioDraftMeta(prev => ({
            ...prev,
            dirtyState: 'clean',
                pendingScopeChange: null,
                staleDraft: null,
                conflict: null,
                message: '',
                error: ''
        }));
        scenarioUndoStackRef.current.clear();
        setScenarioUndoVersion(0);
    };

    const openScenarioDraftHistory = async () => {
        trackScenarioAction('history_open');
        const historyScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        const historyDraftId = scenarioDraftMeta.activeDraft?.draftId || '';
        if (scenarioHistoryRefreshControllerRef.current) {
            scenarioHistoryRefreshControllerRef.current.abort();
        }
        const controller = new AbortController();
        scenarioHistoryRefreshControllerRef.current = controller;
        setScenarioDraftMeta(prev => ({
            ...prev,
            historyOpen: true,
            pendingHistoryAction: null,
            loadingHistory: Boolean(historyScopeKey),
            error: ''
        }));
        if (!historyScopeKey) return;
        try {
            const draftData = await fetchScenarioDraft(historyScopeKey, controller.signal);
            if (
                scenarioHistoryRefreshControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(historyScopeKey, historyDraftId)
            ) {
                return;
            }
            const activeDraft = draftData.activeDraft || null;
            const versions = Array.isArray(draftData.versions) ? draftData.versions : [];
            setScenarioDraftMeta(prev => ({
                ...prev,
                activeDraft: activeDraft || prev.activeDraft,
                versions,
                loadingHistory: false,
                staleDraft: prev.staleDraft
                    ? {
                        ...prev.staleDraft,
                        activeDraft: activeDraft || prev.staleDraft.activeDraft || null,
                        draftRevision: activeDraft?.draftRevision || prev.staleDraft.draftRevision
                    }
                    : prev.staleDraft,
                error: ''
            }));
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (
                err.name === 'AbortError'
                || scenarioHistoryRefreshControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(historyScopeKey, historyDraftId)
            ) {
                return;
            }
            setScenarioDraftMeta(prev => ({
                ...prev,
                loadingHistory: false,
                error: err.message || 'Failed to refresh scenario draft history.'
            }));
        } finally {
            if (scenarioHistoryRefreshControllerRef.current === controller) {
                scenarioHistoryRefreshControllerRef.current = null;
            }
        }
    };

    const closeScenarioDraftHistory = () => {
        setScenarioDraftMeta(prev => ({
            ...prev,
            historyOpen: false,
            pendingHistoryAction: null
        }));
        if (scenarioHistoryButtonRef.current && typeof scenarioHistoryButtonRef.current.focus === 'function') {
            scenarioHistoryButtonRef.current.focus();
        }
    };

    const requestReloadActiveDraft = () => {
        if (scenarioHasUnsavedChanges) {
            setScenarioDraftMeta(prev => ({
                ...prev,
                pendingActiveDraftReload: true,
                error: ''
            }));
            return;
        }
        runReloadActiveDraft();
    };

    const cancelReloadActiveDraft = () => {
        setScenarioDraftMeta(prev => ({
            ...prev,
            pendingActiveDraftReload: false
        }));
    };

    const runReloadActiveDraft = async () => {
        const scopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        const expectedDraftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.staleDraft?.activeDraft?.draftId || '';
        if (!scopeKey) return;
        setScenarioDraftMeta(prev => ({
            ...prev,
            loadingActiveDraft: true,
            pendingActiveDraftReload: false,
            message: '',
            error: ''
        }));
        try {
            const draftData = await fetchScenarioDraft(scopeKey);
            if (!isScenarioScopeDraftCurrent(scopeKey, expectedDraftId)) {
                return;
            }
            const activeDraft = draftData.activeDraft || null;
            const versions = Array.isArray(draftData.versions) ? draftData.versions : [];
            if (!activeDraft) {
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    versions,
                    loadingActiveDraft: false,
                    staleDraft: null,
                    message: 'No active scenario draft was found for this scope.',
                    error: ''
                }));
                return;
            }
            const overrides = normalizeScenarioDraftOverrides(activeDraft.overrides || {});
            setScenarioOverrides(overrides);
            scenarioUndoStackRef.current.clear();
            setScenarioUndoVersion(0);
            setScenarioDraftMeta(prev => ({
                ...prev,
                activeDraft,
                versions,
                loadedVersionNumber: activeDraft.versionNumber || null,
                baseDraftRevision: activeDraft.draftRevision || null,
                savedOverrides: overrides,
                scopePayload: activeDraft.scopePayload || prev.scopePayload || {},
                scopeKey,
                dirtyState: 'clean',
                pendingScopeChange: null,
                loadingHistory: false,
                loadingActiveDraft: false,
                staleDraft: null,
                conflict: null,
                writebackPreview: null,
                writebackBlocked: null,
                message: `Reloaded active draft revision ${activeDraft.draftRevision || 'unknown'}.`,
                error: ''
            }));
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (err.name === 'AbortError' || !isScenarioScopeDraftCurrent(scopeKey, expectedDraftId)) {
                return;
            }
            setScenarioDraftMeta(prev => ({
                ...prev,
                loadingActiveDraft: false,
                error: err.message || 'Failed to reload active scenario draft.'
            }));
        }
    };

    React.useEffect(() => {
        if (!scenarioDraftMeta.historyOpen) return undefined;
        const frame = requestAnimationFrame(() => {
            scenarioHistoryTitleRef.current?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [scenarioDraftMeta.historyOpen]);

    React.useEffect(() => {
        if (!scenarioDraftMeta.historyOpen) return undefined;
        const handleKeyDown = (event) => {
            if (readPendingAuthenticationRequired()) return;
            if (event.key !== 'Escape') return;
            const panel = scenarioHistoryPanelRef.current;
            if (!panel || !panel.contains(document.activeElement)) return;
            event.preventDefault();
            closeScenarioDraftHistory();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [scenarioDraftMeta.historyOpen]);

    const requestScenarioHistoryAction = (type, versionNumber) => {
        const action = { type, versionNumber };
        if (scenarioHasUnsavedChanges) {
            setScenarioDraftMeta(prev => ({
                ...prev,
                pendingHistoryAction: action,
                error: ''
            }));
            return;
        }
        runScenarioHistoryAction(action);
    };

    const cancelScenarioHistoryAction = () => {
        setScenarioDraftMeta(prev => ({
            ...prev,
            pendingHistoryAction: null
        }));
    };

    const requestScenarioReloadFromJira = () => {
        if (scenarioHasUnsavedChanges) {
            setScenarioDraftMeta(prev => ({
                ...prev,
                pendingReloadFromJira: true,
                error: ''
            }));
            return;
        }
        runScenarioReloadFromJira();
    };

    const cancelScenarioReloadFromJira = () => {
        setScenarioDraftMeta(prev => ({
            ...prev,
            pendingReloadFromJira: false
        }));
    };

    const runScenarioReloadFromJira = async () => {
        const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
        if (!draftId || !scenarioDraftMeta.baseDraftRevision) return;
        const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        if (scenarioHistoryActionControllerRef.current) {
            scenarioHistoryActionControllerRef.current.abort();
        }
        const controller = new AbortController();
        scenarioHistoryActionControllerRef.current = controller;
        setScenarioDraftMeta(prev => ({
            ...prev,
            pendingReloadFromJira: false,
            reloadingFromJira: true,
            error: '',
            message: ''
        }));
        try {
            const reloaded = await reloadScenarioDraftFromJira(
                draftId,
                scenarioDraftMeta.baseDraftRevision,
                controller.signal
            );
            if (
                scenarioHistoryActionControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
            ) {
                return;
            }
            const activeDraft = reloaded.activeDraft || null;
            const versions = Array.isArray(reloaded.versions) ? reloaded.versions : [];
            const savedOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || {});
            setScenarioOverrides(savedOverrides);
            scenarioUndoStackRef.current.clear();
            setScenarioUndoVersion(0);
            setScenarioDraftMeta(prev => ({
                ...prev,
                activeDraft,
                versions,
                loadedVersionNumber: activeDraft?.versionNumber || null,
                baseDraftRevision: activeDraft?.draftRevision || null,
                savedOverrides,
                dirtyState: 'clean',
                reloadingFromJira: false,
                staleDraft: null,
                conflict: null,
                writebackPreview: null,
                writebackBlocked: null,
                message: `Reloaded from Jira into version ${activeDraft?.versionNumber || 'unknown'}.`,
                error: ''
            }));
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (
                err.name === 'AbortError'
                || scenarioHistoryActionControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
            ) {
                return;
            }
            const conflict = err.payload?.error === 'scenario_draft_conflict' && err.payload?.conflict
                ? {
                    ...err.payload.conflict,
                    activeDraft: err.payload.activeDraft || null,
                    versions: Array.isArray(err.payload.versions) ? err.payload.versions : []
                }
                : null;
            setScenarioDraftMeta(prev => {
                if (conflict) {
                    return {
                        ...prev,
                        versions: conflict.versions.length > 0 ? conflict.versions : prev.versions,
                        dirtyState: 'conflict_remote',
                        reloadingFromJira: false,
                        conflict,
                        message: '',
                        error: ''
                    };
                }
                return {
                    ...prev,
                    reloadingFromJira: false,
                    error: err.message || 'Failed to reload scenario draft from Jira.'
                };
            });
        } finally {
            if (scenarioHistoryActionControllerRef.current === controller) {
                scenarioHistoryActionControllerRef.current = null;
            }
        }
    };

    const previewScenarioDraftWriteback = async () => {
        const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
        if (!draftId) return;
        trackScenarioAction('writeback_preview');
        const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        setScenarioDraftMeta(prev => ({
            ...prev,
            writebackPreviewing: true,
            writebackPreview: null,
            writebackBlocked: null,
            error: '',
            message: ''
        }));
        try {
            const preview = await postScenarioRealtimeJson(draftId, '/writeback/preview', {});
            if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                return;
            }
            setScenarioDraftMeta(prev => ({
                ...prev,
                writebackPreviewing: false,
                writebackPreview: preview,
                writebackBlocked: null,
                error: '',
                message: ''
            }));
            trackScenarioAction('writeback_preview_result', { result: 'success', selected_count_bucket: bucketCount(Array.isArray(preview?.changes) ? preview.changes.length : 0) });
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                return;
            }
            setScenarioDraftMeta(prev => ({
                ...prev,
                writebackPreviewing: false,
                error: err.message || 'Failed to preview Jira write-back.'
            }));
            trackScenarioAction('writeback_preview_result', { result: 'failure' });
        }
    };

    const checkScenarioDraftWritebackGate = async () => {
        const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
        if (!draftId) return;
        trackScenarioAction('writeback_gate');
        const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        setScenarioDraftMeta(prev => ({
            ...prev,
            writebackChecking: true,
            writebackBlocked: null,
            error: '',
            message: ''
        }));
        try {
            await postScenarioRealtimeJson(draftId, '/writeback', {});
            if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                return;
            }
            setScenarioDraftMeta(prev => ({
                ...prev,
                writebackChecking: false,
                writebackBlocked: null,
                message: 'Jira write-back gate unexpectedly allowed the request.',
                error: ''
            }));
            trackScenarioAction('writeback_gate_result', { result: 'success' });
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)) {
                return;
            }
            const blocked = err.payload?.error === 'jira_writeback_gate_blocked'
                ? err.payload
                : null;
            setScenarioDraftMeta(prev => ({
                ...prev,
                writebackChecking: false,
                writebackBlocked: blocked,
                error: blocked ? '' : (err.message || 'Failed to check Jira write-back gate.')
            }));
            trackScenarioAction('writeback_gate_result', { result: blocked ? 'blocked' : 'failure', blocking_reason: blocked ? 'migration_gate' : 'unknown' });
        }
    };

    const runScenarioHistoryAction = async (action) => {
        const draftId = scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.conflict?.activeDraft?.draftId;
        if (!draftId || !action?.versionNumber) return;
        const expectedScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;
        if (scenarioHistoryActionControllerRef.current) {
            scenarioHistoryActionControllerRef.current.abort();
        }
        const controller = new AbortController();
        scenarioHistoryActionControllerRef.current = controller;
        setScenarioDraftMeta(prev => ({
            ...prev,
            pendingHistoryAction: null,
            loadingVersionNumber: action.type === 'reload' ? action.versionNumber : null,
            rollingBackVersionNumber: action.type === 'rollback' ? action.versionNumber : null,
            error: '',
            message: ''
        }));
        try {
            const snapshot = await fetchScenarioDraftVersion(draftId, action.versionNumber, controller.signal);
            if (
                scenarioHistoryActionControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
            ) {
                return;
            }
            const overrides = normalizeScenarioDraftOverrides(snapshot.overrides || {});
            if (action.type === 'reload') {
                setScenarioOverrides(overrides);
                scenarioUndoStackRef.current.clear();
                setScenarioUndoVersion(0);
                setScenarioDraftMeta(prev => ({
                    ...prev,
                    loadedVersionNumber: snapshot.versionNumber || action.versionNumber,
                    dirtyState: 'dirty_local',
                    loadingVersionNumber: null,
                    rollingBackVersionNumber: null,
                    pendingHistoryAction: null,
                    conflict: null,
                    message: `Reloaded version ${snapshot.versionNumber || action.versionNumber} locally. Save Draft to make it current.`,
                    error: ''
                }));
                return;
            }

            const rolledBack = await rollbackScenarioDraft(
                draftId,
                snapshot.versionNumber || action.versionNumber,
                scenarioDraftMeta.baseDraftRevision,
                controller.signal
            );
            if (
                scenarioHistoryActionControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
            ) {
                return;
            }
            const activeDraft = rolledBack.activeDraft || null;
            const versions = Array.isArray(rolledBack.versions) ? rolledBack.versions : [];
            const savedOverrides = normalizeScenarioDraftOverrides(activeDraft?.overrides || overrides);
            setScenarioOverrides(savedOverrides);
            scenarioUndoStackRef.current.clear();
            setScenarioUndoVersion(0);
            setScenarioDraftMeta(prev => ({
                ...prev,
                activeDraft,
                versions,
                loadedVersionNumber: activeDraft?.versionNumber || snapshot.versionNumber || action.versionNumber,
                baseDraftRevision: activeDraft?.draftRevision || null,
                savedOverrides,
                dirtyState: 'clean',
                loadingVersionNumber: null,
                    rollingBackVersionNumber: null,
                    pendingHistoryAction: null,
                    staleDraft: null,
                    conflict: null,
                    message: `Rolled back to version ${snapshot.versionNumber || action.versionNumber}.`,
                    error: ''
            }));
        } catch (err) {
            if (isAuthenticationRequiredError(err)) return;
            if (
                err.name === 'AbortError'
                || scenarioHistoryActionControllerRef.current !== controller
                || !isScenarioScopeDraftCurrent(expectedScopeKey, draftId)
            ) {
                return;
            }
            const conflict = err.payload?.error === 'scenario_draft_conflict' && err.payload?.conflict
                ? {
                    ...err.payload.conflict,
                    activeDraft: err.payload.activeDraft || null,
                    versions: Array.isArray(err.payload.versions) ? err.payload.versions : []
                }
                : null;
            setScenarioDraftMeta(prev => {
                if (conflict) {
                    return {
                        ...prev,
                        versions: conflict.versions.length > 0 ? conflict.versions : prev.versions,
                        dirtyState: 'conflict_remote',
                        loadingVersionNumber: null,
                        rollingBackVersionNumber: null,
                        pendingHistoryAction: null,
                        conflict,
                        message: '',
                        error: ''
                    };
                }
                return {
                    ...prev,
                    loadingVersionNumber: null,
                    rollingBackVersionNumber: null,
                    pendingHistoryAction: null,
                    error: err.message || 'Failed to load scenario draft history.'
                };
            });
        } finally {
            if (scenarioHistoryActionControllerRef.current === controller) {
                scenarioHistoryActionControllerRef.current = null;
            }
        }
    };
    return {
        saveScenarioDraft,
        discardScenarioOverrides,
        openScenarioDraftHistory,
        closeScenarioDraftHistory,
        requestReloadActiveDraft,
        cancelReloadActiveDraft,
        runReloadActiveDraft,
        requestScenarioHistoryAction,
        cancelScenarioHistoryAction,
        requestScenarioReloadFromJira,
        cancelScenarioReloadFromJira,
        runScenarioReloadFromJira,
        previewScenarioDraftWriteback,
        checkScenarioDraftWritebackGate,
        runScenarioHistoryAction,
    };
}
