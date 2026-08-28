import * as React from 'react';
import { fetchStorySubtasks } from '../api/engApi.js';
import { authRecoveryLoginUrl, redirectToAuthRecovery } from '../eng/useEngSprintData.js';
import { applyLocalSubtaskFieldUpdate } from '../eng/engIssueLocalUpdates.js';

const EMPTY_SUMMARY = { total: 0, done: 0, inProgress: 0, waiting: 0, percentComplete: 0, statusCounts: {} };

export function useStorySubtasks({ backendUrl, selectedSprint, onAuthRecoveryRequired } = {}) {
    const [storySubtasksByKey, setStorySubtasksByKey] = React.useState({});
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

        setStorySubtasksByKey(prev => ({
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
        }));

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
            if (authRecoveryLoginUrl(err)) {
                onAuthRecoveryRequired?.();
                redirectToAuthRecovery(err);
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
    }, [backendUrl, selectedSprint, onAuthRecoveryRequired]);

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

    const applyLocalSubtaskField = React.useCallback((issueKey, fieldName, fieldValue) => {
        setStorySubtasksByKey(prev => applyLocalSubtaskFieldUpdate(prev, issueKey, fieldName, fieldValue));
    }, []);

    return {
        storySubtasksByKey,
        clearStorySubtasks,
        toggleStorySubtasks,
        retryStorySubtasks,
        applyLocalSubtaskField,
    };
}
