import * as React from 'react';
import { fetchStorySubtasks } from '../api/engApi.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { applyLocalSubtaskFieldUpdate } from '../eng/engIssueLocalUpdates.js';

const EMPTY_SUMMARY = { total: 0, done: 0, inProgress: 0, waiting: 0, percentComplete: 0, statusCounts: {} };

export function dropStorySubtaskEntries(state, keys) {
    const reloadKeys = [];
    let next = state;
    (keys || []).forEach((key) => {
        const entry = next[key];
        if (!entry) return;
        if (next === state) next = { ...state };
        if (entry.expanded) {
            reloadKeys.push(key);
            next[key] = { ...entry, loaded: false };
        } else {
            delete next[key];
        }
    });
    return { next, reloadKeys };
}

export function useStorySubtasks({ backendUrl, selectedSprint, onAuthRecoveryRequired, issueEditState = null, getMutationScope } = {}) {
    const [storySubtasksByKey, setStorySubtasksByKey] = React.useState({});
    const storySubtasksByKeyRef = React.useRef(storySubtasksByKey);
    storySubtasksByKeyRef.current = storySubtasksByKey;
    const storySubtasksControllerRef = React.useRef({});

    const clearStorySubtasks = React.useCallback(() => {
        Object.values(storySubtasksControllerRef.current || {}).forEach(controller => controller?.abort?.());
        storySubtasksControllerRef.current = {};
        setStorySubtasksByKey({});
    }, []);

    React.useEffect(() => clearStorySubtasks, [clearStorySubtasks]);
    React.useEffect(() => {
        clearStorySubtasks();
    }, [selectedSprint, clearStorySubtasks]);

    const loadStorySubtasks = React.useCallback(async (task, { forceRefresh = false } = {}) => {
        const storyKey = task?.key;
        if (!storyKey || !selectedSprint) return;

        storySubtasksControllerRef.current[storyKey]?.abort?.();
        const controller = new AbortController();
        storySubtasksControllerRef.current[storyKey] = controller;

        const previousEntry = storySubtasksByKeyRef.current[storyKey];
        setStorySubtasksByKey(prev => {
            return ({
            ...prev,
            [storyKey]: {
                ...(prev[storyKey] || {}),
                expanded: true,
                loading: true,
                error: '',
                summary: prev[storyKey]?.summary || task.fields?.subtaskSummary || null,
                items: prev[storyKey]?.items || [],
                loaded: forceRefresh ? false : !!prev[storyKey]?.loaded,
            }
            });
        });

        try {
            const response = await fetchStorySubtasks(backendUrl, {
                parentKey: storyKey,
                sprint: selectedSprint,
                refresh: forceRefresh,
                signal: controller.signal,
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const error = new Error(errorData.loginUrl ? 'Sign in with Atlassian again to load subtasks.' : 'Failed to load subtasks.');
                error.code = errorData.error;
                error.loginUrl = errorData.loginUrl;
                error.status = response.status;
                throw error;
            }
            const data = await response.json();
            // A freshly read (not server-cached) subtask list is the raw evidence that releases a Subtask's unconfirmed status/priority lock
            // for the scope it was made in; Refresh never reloads subtasks, so nothing else can.
            if (issueEditState && data.cached !== true) {
                issueEditState.releasePlanningLocks({ scope: getMutationScope?.() ?? '', evidence: issueEditState.planningEvidence(data.subtasks || []) });
            }
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: {
                    expanded: true,
                    loading: false,
                    error: '',
                    summary: data.summary || EMPTY_SUMMARY,
                    items: data.subtasks || [],
                    loaded: true,
                }
            }));
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (isAuthenticationRequiredError(err)) {
                setStorySubtasksByKey(prev => {
                    if (previousEntry !== undefined) return { ...prev, [storyKey]: previousEntry };
                    const next = { ...prev };
                    delete next[storyKey];
                    return next;
                });
                return;
            }
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: {
                    ...(prev[storyKey] || {}),
                    expanded: true,
                    loading: false,
                    error: err.message || 'Failed to load subtasks.',
                }
            }));
        } finally {
            if (storySubtasksControllerRef.current[storyKey] === controller) {
                delete storySubtasksControllerRef.current[storyKey];
            }
        }
    }, [backendUrl, selectedSprint, onAuthRecoveryRequired, issueEditState, getMutationScope]);

    const toggleStorySubtasks = React.useCallback((task) => {
        const storyKey = task?.key;
        if (!storyKey) return;
        const current = storySubtasksByKey[storyKey];
        if (current?.expanded) {
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: { ...current, expanded: false }
            }));
            return;
        }
        if (current?.loaded) {
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: { ...current, expanded: true }
            }));
            return;
        }
        if (current?.items?.length || current?.summary) {
            setStorySubtasksByKey(prev => ({
                ...prev,
                [storyKey]: { ...current, expanded: true }
            }));
            if (!current.loading) {
                void loadStorySubtasks(task);
            }
            return;
        }
        void loadStorySubtasks(task);
    }, [loadStorySubtasks, storySubtasksByKey]);

    const retryStorySubtasks = React.useCallback((task) => {
        void loadStorySubtasks(task, { forceRefresh: true });
    }, [loadStorySubtasks]);

    const applyLocalSubtaskField = React.useCallback((issueKey, fieldName, fieldValue, expected) => {
        setStorySubtasksByKey(prev => applyLocalSubtaskFieldUpdate(prev, issueKey, fieldName, fieldValue, expected));
    }, []);

    const invalidateStorySubtasks = React.useCallback((keys) => {
        const { next, reloadKeys } = dropStorySubtaskEntries(storySubtasksByKeyRef.current, keys);
        if (next === storySubtasksByKeyRef.current) return;
        setStorySubtasksByKey(prev => dropStorySubtaskEntries(prev, keys).next);
        reloadKeys.forEach((key) => {
            void loadStorySubtasks({ key }, { forceRefresh: true });
        });
    }, [loadStorySubtasks]);

    return {
        storySubtasksByKey,
        clearStorySubtasks,
        toggleStorySubtasks,
        retryStorySubtasks,
        applyLocalSubtaskField,
        invalidateStorySubtasks,
    };
}
