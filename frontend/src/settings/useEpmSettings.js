import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_EPM_LABEL_PREFIX, createEmptyEpmConfigDraft } from './epmConfigDraft.js';
import { getLabelRowKey } from './labelRowKey.js';
import { bucketCount } from '../analytics/dashboardAnalytics.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    fetchEpmConfig,
    fetchEpmConfigurationProjects,
    fetchEpmGoals,
    fetchEpmScope,
    saveEpmConfig as requestSaveEpmConfig,
} from '../api/epmApi.js';
import { fetchJiraLabels as requestJiraLabels } from '../api/jiraCatalogApi.js';
import {
    filterEpmSettingsProjectsForView,
    getEpmProjectPrerequisites,
    getEpmSettingsProjectsCacheKey,
    hydrateEpmProjectDraft,
    isEmptyCustomEpmProjectRow,
    normalizeEpmLabelPrefixMask,
    normalizeEpmScopeSubGoalKeys,
    sortEpmSettingsProjects,
} from '../epm/epmProjectUtils.mjs'

export function useEpmSettings({
    BACKEND_URL,
    canEditEpmConfiguration,
    getEpmViewActions,
    labelSearchIndex,
    labelSearchOpen,
    labelSearchQuery,
    labelSearchRequestIdRef,
    labelSearchResults,
    setGroupDraftError,
    setGroupManageTab,
    setLabelSearchIndex,
    setLabelSearchLoading,
    setLabelSearchOpen,
    setLabelSearchQuery,
    setLabelSearchResults,
    setShowGroupManage,
    trackSettingsAction,
    trackSortChanged,
}) {
    const [epmConfigDraft, setEpmConfigDraftState] = useState(createEmptyEpmConfigDraft());
    const epmConfigDraftRef = useRef(epmConfigDraft);
    const epmConfigDraftGenerationRef = useRef(0);
    const setEpmConfigDraft = React.useCallback((updater) => {
        setEpmConfigDraftState((previous) => {
            const next = typeof updater === 'function' ? updater(previous) : updater;
            epmConfigDraftRef.current = next;
            epmConfigDraftGenerationRef.current += 1;
            return next;
        });
    }, []);
    const [epmConfigLoading, setEpmConfigLoading] = useState(false);
    const [epmConfigSaving, setEpmConfigSaving] = useState(false);
    const [epmConfigLoaded, setEpmConfigLoaded] = useState(false);
    const [epmSettingsProjects, setEpmSettingsProjects] = useState([]);
    const [epmSettingsProjectsLoading, setEpmSettingsProjectsLoading] = useState(false);
    const [epmSettingsProjectsError, setEpmSettingsProjectsError] = useState('');
    const [epmSettingsProjectsLoaded, setEpmSettingsProjectsLoaded] = useState(false);
    const [epmSettingsProjectsLoadedAt, setEpmSettingsProjectsLoadedAt] = useState('');
    const [epmSettingsProjectsFetchMeta, setEpmSettingsProjectsFetchMeta] = useState({
        cacheHit: false,
        fetchedAt: '',
        homeProjectCount: 0,
        homeProjectLimit: null,
        possiblyTruncated: false,
    });
    const [epmSettingsProjectsRefreshing, setEpmSettingsProjectsRefreshing] = useState(false);
    const [removedEpmProjectIds, setRemovedEpmProjectIds] = React.useState(() => new Set());
    const [epmSettingsProjectSort, setEpmSettingsProjectSort] = useState('status');
    const [epmSettingsProjectView, setEpmSettingsProjectView] = useState('current');
    const [epmSettingsTab, setEpmSettingsTab] = useState('scope');
    const [epmLabelShowAll, setEpmLabelShowAll] = useState({});
    const [epmLabelChanging, setEpmLabelChanging] = useState({});
    const [epmLabelMenuAnchor, setEpmLabelMenuAnchor] = useState(null);
    const epmLabelMenuInputRef = useRef(null);
    const pendingLabelFocusRef = React.useRef(null);
    const epmConfigBaselineRef = useRef(JSON.stringify(createEmptyEpmConfigDraft()));
    const [epmScopeMeta, setEpmScopeMeta] = useState({ cloudId: '', error: '' });
    const [epmRootGoals, setEpmRootGoals] = useState([]);
    const [epmSubGoals, setEpmSubGoals] = useState([]);
    const [epmRootGoalsLoading, setEpmRootGoalsLoading] = useState(false);
    const [epmSubGoalsLoading, setEpmSubGoalsLoading] = useState(false);
    const [epmRootGoalsError, setEpmRootGoalsError] = useState('');
    const [epmSubGoalsError, setEpmSubGoalsError] = useState('');
    const [epmRootGoalQuery, setEpmRootGoalQuery] = useState('');
    const [epmSubGoalQuery, setEpmSubGoalQuery] = useState('');
    const [epmRootGoalOpen, setEpmRootGoalOpen] = useState(false);
    const [epmSubGoalOpen, setEpmSubGoalOpen] = useState(false);
    const [epmRootGoalIndex, setEpmRootGoalIndex] = useState(0);
    const [epmSubGoalIndex, setEpmSubGoalIndex] = useState(0);
    const epmSettingsProjectsRequestIdRef = useRef(0);
    const epmSettingsProjectsCacheRef = useRef(new Map());
    const epmDraftIdCounterRef = useRef(0);
    const epmSubGoalsRequestIdRef = useRef(0);
    const epmSubGoalsCacheRef = useRef(new Map());

    const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);
    const loadEpmScopeMeta = () => fetchEpmScope(BACKEND_URL);
    const loadEpmGoals = (rootGoalKey = '') => fetchEpmGoals(BACKEND_URL, rootGoalKey);
    const loadEpmConfigurationProjects = async (draftConfig, options = {}) => {
        return fetchEpmConfigurationProjects(BACKEND_URL, draftConfig, options);
    };
    const resetEpmSettingsProjectRows = () => {
        epmSettingsProjectsRequestIdRef.current += 1;
        setEpmSettingsProjects([]);
        setEpmSettingsProjectsLoading(false);
        setEpmSettingsProjectsError('');
        setEpmSettingsProjectsLoaded(false);
        setEpmSettingsProjectsLoadedAt('');
        setEpmSettingsProjectsRefreshing(false);
    };
    const getHomeBackedEpmSettingsProjects = (projects) => {
        return Array.isArray(projects)
            ? projects.filter(project => project?.homeProjectId !== null)
            : [];
    };

    const ensureEpmSettingsProjectsLoaded = async (options = {}) => {
        const forceRefresh = Boolean(options.forceRefresh);
        const draftConfig = normalizeEpmConfigDraft(options.draftConfig || epmConfigDraft);
        const cacheKey = options.cacheKey || getEpmSettingsProjectsCacheKey(draftConfig);
        epmSettingsProjectsRequestIdRef.current += 1;
        const requestId = epmSettingsProjectsRequestIdRef.current;
        if (!cacheKey) {
            setEpmSettingsProjectsError('');
            setEpmSettingsProjectsLoading(false);
            setEpmSettingsProjectsRefreshing(false);
            setEpmSettingsProjectsLoaded(false);
            setEpmSettingsProjectsLoadedAt('');
            return [];
        }
        if (!forceRefresh && epmSettingsProjectsCacheRef.current.has(cacheKey)) {
            const cachedEntry = epmSettingsProjectsCacheRef.current.get(cacheKey) || {};
            const cachedProjects = Array.isArray(cachedEntry.projects) ? cachedEntry.projects : [];
            const cachedLoadedAt = String(cachedEntry.loadedAt || '');
            setEpmSettingsProjects(cachedProjects);
            setEpmSettingsProjectsFetchMeta(cachedEntry.meta || {
                cacheHit: true,
                fetchedAt: '',
                homeProjectCount: cachedProjects.length,
                homeProjectLimit: null,
                possiblyTruncated: false,
            });
            setEpmSettingsProjectsError('');
            setEpmSettingsProjectsLoaded(true);
            setEpmSettingsProjectsLoadedAt(cachedLoadedAt);
            return cachedProjects;
        }

        const hasExistingRows = epmSettingsProjectsLoaded && epmSettingsProjectRows.length > 0;
        setEpmSettingsProjectsLoading(!hasExistingRows);
        setEpmSettingsProjectsRefreshing(hasExistingRows);
        setEpmSettingsProjectsError('');
        try {
            const payload = await loadEpmConfigurationProjects(draftConfig, { forceRefresh });
            if (epmSettingsProjectsRequestIdRef.current !== requestId) {
                return [];
            }
            const nextProjects = getHomeBackedEpmSettingsProjects(payload.projects);
            const nextMeta = {
                cacheHit: Boolean(payload.cacheHit),
                fetchedAt: String(payload.fetchedAt || ''),
                homeProjectCount: Number(payload.homeProjectCount || nextProjects.filter(project => project?.homeProjectId).length || 0),
                homeProjectLimit: payload.homeProjectLimit ?? null,
                possiblyTruncated: Boolean(payload.possiblyTruncated),
            };
            const loadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            epmSettingsProjectsCacheRef.current.set(cacheKey, { projects: nextProjects, meta: nextMeta, loadedAt });
            setEpmSettingsProjects(nextProjects);
            if (forceRefresh) { setRemovedEpmProjectIds(new Set()); }
            setEpmSettingsProjectsFetchMeta(nextMeta);
            setEpmSettingsProjectsLoaded(true);
            setEpmSettingsProjectsLoadedAt(loadedAt);
            return nextProjects;
        } catch (err) {
            if (epmSettingsProjectsRequestIdRef.current !== requestId) {
                return [];
            }
            if (isAuthenticationRequiredError(err)) return [];
            console.error('Failed to load EPM projects:', err);
            setEpmSettingsProjectsError(err?.message || 'Failed to load EPM projects.');
            return [];
        } finally {
            if (epmSettingsProjectsRequestIdRef.current === requestId) {
                setEpmSettingsProjectsLoading(false);
                setEpmSettingsProjectsRefreshing(false);
            }
        }
    };
    const updateEpmSettingsProjectRowsAfterSave = (savedConfig) => {
        const previousCacheKey = getEpmSettingsProjectsCacheKey(epmConfigDraft);
        const nextCacheKey = getEpmSettingsProjectsCacheKey(savedConfig);
        if (!nextCacheKey) return;
        const rawPreviousEntry = previousCacheKey
            ? epmSettingsProjectsCacheRef.current.get(previousCacheKey)
            : null;
        const previousEntry = rawPreviousEntry
            ? {
                ...rawPreviousEntry,
                projects: getHomeBackedEpmSettingsProjects(rawPreviousEntry.projects),
            }
            : null;
        const currentEntry = epmSettingsProjects.length > 0
            ? {
                projects: getHomeBackedEpmSettingsProjects(epmSettingsProjects),
                meta: epmSettingsProjectsFetchMeta,
                loadedAt: epmSettingsProjectsLoadedAt,
            }
            : null;
        const nextEntry = previousEntry || currentEntry;
        if (nextEntry) {
            epmSettingsProjectsCacheRef.current.set(nextCacheKey, nextEntry);
        }
    };
    const saveEpmConfig = async () => {
        const { refreshEpmProjects, setEpmProjects, setEpmProjectsError } = getEpmViewActions();
        setEpmConfigSaving(true);
        setGroupDraftError('');
        trackSettingsAction('epm', 'save', { dirty_state: isEpmConfigDirty ? 'dirty' : 'clean', project_count_bucket: bucketCount(epmConfigDraft?.projects?.length || 0) });
        try {
            const submittedGeneration = epmConfigDraftGenerationRef.current;
            const normalizedDraft = normalizeEpmConfigDraft(epmConfigDraftRef.current);
            const payload = await requestSaveEpmConfig(BACKEND_URL, normalizedDraft);
            const nextConfig = normalizeEpmConfigDraft(payload);
            const draftUnchanged = epmConfigDraftGenerationRef.current === submittedGeneration;
            if (draftUnchanged) {
                applySavedEpmConfig(nextConfig);
            } else {
                epmConfigBaselineRef.current = JSON.stringify(nextConfig);
                setEpmConfigLoaded(true);
            }
            updateEpmSettingsProjectRowsAfterSave(nextConfig);
            if (hasSavedEpmScopeConfig(nextConfig)) {
                await refreshEpmProjects();
            } else {
                setEpmProjects([]);
                setEpmProjectsError('');
                setEpmSettingsProjects([]);
                setEpmSettingsProjectsLoaded(false);
            }
            trackSettingsAction('epm', 'save_result', { result: 'success' });
            return draftUnchanged;
        } catch (err) {
            if (isAuthenticationRequiredError(err)) throw err;
            const message = err?.message || 'Failed to save EPM settings.';
            setGroupDraftError(message);
            console.error('Failed to save EPM config:', err);
            if (err?.status !== 409) trackSettingsAction('epm', 'save_result', { result: 'failure' });
            throw err;
        } finally {
            setEpmConfigSaving(false);
        }
    };
    const updateEpmLabelPrefixDraft = (value) => {
        setEpmConfigDraft((prev) => ({
            ...prev,
            labelPrefix: value,
        }));
        setLabelSearchResults(prev => {
            const next = { ...prev };
            Object.keys(next).forEach((key) => {
                if (key.startsWith(`${EPM_LABEL_SEARCH_GROUP_ID}:`)) {
                    delete next[key];
                }
            });
            return next;
        });
    };
    const updateEpmProjectDraft = (projectId, field, value) => {
        setEpmConfigDraft((prev) => {
            const prevProjects = prev.projects || {};
            const rowSource = epmSettingsProjectRows.find(row => row.id === projectId);
            const prevRow = prevProjects[projectId] || { id: projectId, homeProjectId: rowSource?.homeProjectId };
            return {
                ...prev,
                projects: {
                    ...prevProjects,
                    [projectId]: { ...prevRow, id: projectId, [field]: value },
                },
            };
        });
    };
    const EPM_LABEL_SEARCH_GROUP_ID = 'epm-project';
    const getEpmLabelRowKey = (projectId) => getLabelRowKey(EPM_LABEL_SEARCH_GROUP_ID, projectId);
    const getEpmLabelSearchResults = (projectId) => {
        const key = getEpmLabelRowKey(projectId);
        const query = String(labelSearchQuery[key] || '').trim();
        const results = labelSearchResults[key] || [];
        if (!query) return results;
        const normalizedQuery = query.toLowerCase();
        return results.filter(label => String(label || '').toLowerCase().includes(normalizedQuery));
    };
    const addCustomEpmProjectDraft = () => {
        epmDraftIdCounterRef.current += 1;
        const draftId = `draft-${Date.now().toString(36)}-${epmDraftIdCounterRef.current}`;
        setEpmConfigDraft((prev) => ({
            ...prev,
            projects: {
                ...(prev.projects || {}),
                [draftId]: {
                    id: draftId,
                    homeProjectId: null,
                    name: '',
                    label: '',
                },
            },
        }));
    };
    const removeEpmProjectDraft = (projectId) => {
        setEpmConfigDraft((prev) => {
            const nextProjects = { ...(prev.projects || {}) };
            delete nextProjects[projectId];
            return {
                ...prev,
                projects: nextProjects,
            };
        });
    };
    const deleteEpmProjectRow = (project) => {
        if (!project.homeProjectId) {
            removeEpmProjectDraft(project.id);
        } else {
            setRemovedEpmProjectIds(prev => {
                const next = new Set(prev);
                if (project.id) next.add(String(project.id));
                if (project.homeProjectId) next.add(String(project.homeProjectId));
                return next;
            });
        }
    };
    const loadEpmProjectLabels = async (projectId, showAll = false) => {
        const key = getEpmLabelRowKey(projectId);
        const requestId = (labelSearchRequestIdRef.current[key] || 0) + 1;
        labelSearchRequestIdRef.current[key] = requestId;
        setLabelSearchLoading(prev => ({ ...prev, [key]: true }));
        try {
            const prefix = normalizeEpmLabelPrefixMask(epmConfigDraft.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX);
            const payload = await requestJiraLabels(BACKEND_URL, showAll || !prefix
                ? { limit: 200 }
                : { prefix, limit: 200 });
            const nextResults = Array.isArray(payload.labels) ? payload.labels : [];
            if (labelSearchRequestIdRef.current[key] === requestId) {
                setLabelSearchResults(prev => ({ ...prev, [key]: nextResults }));
                setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
            }
        } catch (error) {
            if (isAuthenticationRequiredError(error)) return;
            if (labelSearchRequestIdRef.current[key] === requestId) {
                setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
                setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
            }
        } finally {
            if (labelSearchRequestIdRef.current[key] === requestId) {
                setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
            }
        }
    };
    const requestEpmLabelFocus = (projectId) => {
        const rowKey = getEpmLabelRowKey(projectId);
        setEpmLabelChanging(prev => ({ ...prev, [rowKey]: true }));
        pendingLabelFocusRef.current = rowKey;
    };
    const registerEpmLabelInput = (projectId, node) => {
        const rowKey = getEpmLabelRowKey(projectId);
        if (node && pendingLabelFocusRef.current === rowKey) {
            node.focus();
            pendingLabelFocusRef.current = null;
        }
    };
    const selectEpmProjectLabel = React.useCallback((projectId, label) => {
        const key = getEpmLabelRowKey(projectId);
        updateEpmProjectDraft(projectId, 'label', label);
        setLabelSearchQuery(prev => ({ ...prev, [key]: '' }));
        setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
        setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
        setEpmLabelChanging(prev => ({ ...prev, [key]: false }));
        setEpmLabelMenuAnchor(null);
        epmLabelMenuInputRef.current = null;
    }, [updateEpmProjectDraft]);
    const openEpmLabelMenu = (projectId, inputNode, showAllLabels) => {
        if (!inputNode) return;
        const rowKey = getEpmLabelRowKey(projectId);
        const rect = inputNode.getBoundingClientRect();
        epmLabelMenuInputRef.current = inputNode;
        setEpmLabelMenuAnchor({
            projectId,
            rowKey,
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
        });
        setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
        void loadEpmProjectLabels(projectId, showAllLabels);
    };

    const handleEpmLabelSearchKeyDown = React.useCallback((projectId, event, results) => {
        const key = getEpmLabelRowKey(projectId);
        if (event.key === 'ArrowDown') {
            if (!results.length) return;
            event.preventDefault();
            setLabelSearchOpen(prev => ({ ...prev, [key]: true }));
            setLabelSearchIndex(prev => ({
                ...prev,
                [key]: Math.min((prev[key] || 0) + 1, results.length - 1)
            }));
            return;
        }
        if (event.key === 'ArrowUp') {
            if (!results.length) return;
            event.preventDefault();
            setLabelSearchOpen(prev => ({ ...prev, [key]: true }));
            setLabelSearchIndex(prev => ({
                ...prev,
                [key]: Math.max((prev[key] || 0) - 1, 0)
            }));
            return;
        }
        if (event.key === 'Enter') {
            if (!results.length) return;
            event.preventDefault();
            const index = labelSearchIndex[key] || 0;
            const label = results[index] || results[0];
            if (label) {
                selectEpmProjectLabel(projectId, label);
            }
            return;
        }
        if (event.key === 'Escape' && labelSearchOpen[key]) {
            event.preventDefault();
            event.stopPropagation();
            setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
        }
    }, [labelSearchIndex, labelSearchOpen, selectEpmProjectLabel]);
    const updateEpmScopeDraft = (field, value) => {
        setEpmConfigDraft((prev) => ({
            ...prev,
            scope: {
                ...(prev.scope || {}),
                [field]: value,
            },
        }));
    };
    const clearEpmSubGoalOptions = () => {
        epmSubGoalsRequestIdRef.current += 1;
        setEpmSubGoals([]);
        setEpmSubGoalsLoading(false);
        setEpmSubGoalsError('');
        setEpmSubGoalOpen(false);
        setEpmSubGoalIndex(0);
    };
    const loadEpmSubGoalsForRoot = async (rootGoalKey, expectedSubGoalKey = '', options = {}) => {
        const normalizedRootGoalKey = String(rootGoalKey || '').trim().toUpperCase();
        const normalizedExpectedSubGoalKey = String(expectedSubGoalKey || '').trim().toUpperCase();
        const forceRefresh = Boolean(options.forceRefresh);
        epmSubGoalsRequestIdRef.current += 1;
        const requestId = epmSubGoalsRequestIdRef.current;
        if (!normalizedRootGoalKey) {
            setEpmSubGoals([]);
            setEpmSubGoalsLoading(false);
            setEpmSubGoalsError('');
            return { goals: [], hasExpectedSubGoal: !normalizedExpectedSubGoalKey, lookupFailed: false };
        }
        if (!forceRefresh && epmSubGoalsCacheRef.current.has(normalizedRootGoalKey)) {
            const cachedGoals = epmSubGoalsCacheRef.current.get(normalizedRootGoalKey) || [];
            const hasExpectedSubGoal = !normalizedExpectedSubGoalKey
                || cachedGoals.some((goal) => String(goal?.key || '').trim().toUpperCase() === normalizedExpectedSubGoalKey);
            setEpmSubGoals(cachedGoals);
            setEpmSubGoalsLoading(false);
            setEpmSubGoalsError('');
            return { goals: cachedGoals, hasExpectedSubGoal, lookupFailed: false };
        }
        setEpmSubGoalsLoading(true);
        setEpmSubGoalsError('');
        try {
            const payload = await loadEpmGoals(normalizedRootGoalKey);
            if (epmSubGoalsRequestIdRef.current !== requestId) {
                return { goals: [], hasExpectedSubGoal: false, lookupFailed: true };
            }
            const nextGoals = Array.isArray(payload.goals) ? payload.goals : [];
            epmSubGoalsCacheRef.current.set(normalizedRootGoalKey, nextGoals);
            const lookupError = String(payload?.error || '').trim();
            const lookupFailed = Boolean(lookupError);
            const hasExpectedSubGoal = lookupFailed
                || !normalizedExpectedSubGoalKey
                || nextGoals.some((goal) => String(goal?.key || '').trim().toUpperCase() === normalizedExpectedSubGoalKey);
            setEpmSubGoals(nextGoals);
            setEpmSubGoalsError(lookupError);
            if (normalizedExpectedSubGoalKey && !lookupFailed && !hasExpectedSubGoal) {
                setEpmConfigDraft((prev) => {
                    const prevRootGoalKey = String(prev?.scope?.rootGoalKey || '').trim().toUpperCase();
                    const prevSubGoalKeys = normalizeEpmScopeSubGoalKeys(prev?.scope);
                    if (prevRootGoalKey !== normalizedRootGoalKey || !prevSubGoalKeys.includes(normalizedExpectedSubGoalKey)) {
                        return prev;
                    }
                    return {
                        ...prev,
                        scope: {
                            ...(prev.scope || {}),
                            subGoalKeys: prevSubGoalKeys.filter(key => key !== normalizedExpectedSubGoalKey),
                        },
                    };
                });
            }
            return { goals: nextGoals, hasExpectedSubGoal, lookupFailed };
        } catch (err) {
            if (epmSubGoalsRequestIdRef.current !== requestId) {
                return { goals: [], hasExpectedSubGoal: false, lookupFailed: true };
            }
            if (isAuthenticationRequiredError(err)) return { goals: [], hasExpectedSubGoal: true, lookupFailed: true };
            console.error('Failed to fetch EPM sub-goals:', err);
            setEpmSubGoals([]);
            setEpmSubGoalsError(err?.message || '');
            return { goals: [], hasExpectedSubGoal: true, lookupFailed: true };
        } finally {
            if (epmSubGoalsRequestIdRef.current === requestId) {
                setEpmSubGoalsLoading(false);
            }
        }
    };
    const selectEpmRootGoal = async (goal) => {
        const rootGoalKey = String(goal?.key || '').trim().toUpperCase();
        const previousRootGoalKey = String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase();
        const rootChanged = previousRootGoalKey !== rootGoalKey;
        if (rootChanged) {
            resetEpmSettingsProjectRows();
        }
        setEpmConfigDraft((prev) => ({
            ...prev,
            scope: {
                ...(prev.scope || {}),
                rootGoalKey,
                subGoalKeys: rootChanged ? [] : normalizeEpmScopeSubGoalKeys(prev.scope),
            },
        }));
        setEpmRootGoalQuery('');
        setEpmSubGoalQuery('');
        setEpmRootGoalOpen(false);
        setEpmRootGoalIndex(0);
        if (rootChanged) {
            clearEpmSubGoalOptions();
        }
        if (!rootGoalKey) {
            return;
        }
        await loadEpmSubGoalsForRoot(rootGoalKey);
    };
    const clearEpmRootGoal = () => {
        resetEpmSettingsProjectRows();
        updateEpmScopeDraft('rootGoalKey', '');
        updateEpmScopeDraft('subGoalKeys', []);
        setEpmRootGoalQuery('');
        setEpmSubGoalQuery('');
        setEpmRootGoalOpen(false);
        setEpmRootGoalIndex(0);
        clearEpmSubGoalOptions();
    };
    const clearEpmSubGoal = (subGoalKey) => {
        resetEpmSettingsProjectRows();
        const normalizedSubGoalKey = String(subGoalKey || '').trim().toUpperCase();
        setEpmConfigDraft((prev) => ({
            ...prev,
            scope: {
                ...(prev.scope || {}),
                subGoalKeys: normalizeEpmScopeSubGoalKeys(prev.scope).filter(key => key !== normalizedSubGoalKey),
            },
        }));
        setEpmSubGoalQuery('');
        setEpmSubGoalOpen(false);
        setEpmSubGoalIndex(0);
    };
    const selectEpmSubGoal = (goal) => {
        const subGoalKey = String(goal?.key || '').trim().toUpperCase();
        if (!subGoalKey) return;
        resetEpmSettingsProjectRows();
        setEpmConfigDraft((prev) => {
            const subGoalKeys = normalizeEpmScopeSubGoalKeys(prev.scope);
            return {
                ...prev,
                scope: {
                    ...(prev.scope || {}),
                    subGoalKeys: subGoalKeys.includes(subGoalKey) ? subGoalKeys : [...subGoalKeys, subGoalKey],
                },
            };
        });
        setEpmSubGoalQuery('');
        setEpmSubGoalOpen(false);
        setEpmSubGoalIndex(0);
    };

    const normalizeEpmConfigDraft = (config) => {
        const sourceProjects = config?.projects && typeof config.projects === 'object' ? config.projects : {};
        const projects = {};
        Object.entries(sourceProjects).forEach(([projectId, row]) => {
            if (!row || typeof row !== 'object') return;
            const id = String(row.id || projectId || '').trim();
            if (!id) return;
            const normalizedRow = {
                id,
                name: String(row?.name ?? ''),
                label: String(row?.label ?? ''),
            };
            if (row.homeProjectId === null) {
                normalizedRow.homeProjectId = null;
            } else if (row.homeProjectId !== undefined) {
                normalizedRow.homeProjectId = String(row.homeProjectId || '').trim();
            }
            if (isEmptyCustomEpmProjectRow(normalizedRow)) return;
            projects[id] = normalizedRow;
        });
        return {
            version: 2,
            labelPrefix: String(config?.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX).trim(),
            scope: {
                rootGoalKey: String(config?.scope?.rootGoalKey || '').trim().toUpperCase(),
                subGoalKeys: normalizeEpmScopeSubGoalKeys(config?.scope),
            },
            issueTypes: config?.issueTypes && typeof config.issueTypes === 'object' ? config.issueTypes : undefined,
            projects,
        };
    };
    const applySavedEpmConfig = (config) => {
        const nextConfig = normalizeEpmConfigDraft(config);
        setEpmConfigDraft(nextConfig);
        epmConfigBaselineRef.current = JSON.stringify(nextConfig);
        setEpmConfigLoaded(true);
        return nextConfig;
    };
    const hasSavedEpmScopeConfig = (config) => {
        return Boolean(config?.scope?.rootGoalKey && normalizeEpmScopeSubGoalKeys(config?.scope).length > 0);
    };
    const filteredEpmRootGoals = React.useMemo(() => {
        const query = String(epmRootGoalQuery || '').trim().toLowerCase();
        if (!query) return epmRootGoals;
        return epmRootGoals.filter((goal) => {
            const name = String(goal?.name || '').toLowerCase();
            const key = String(goal?.key || '').toLowerCase();
            return name.includes(query) || key.includes(query);
        });
    }, [epmRootGoals, epmRootGoalQuery]);
    const filteredEpmSubGoals = React.useMemo(() => {
        const query = String(epmSubGoalQuery || '').trim().toLowerCase();
        if (!query) return epmSubGoals;
        return epmSubGoals.filter((goal) => {
            const name = String(goal?.name || '').toLowerCase();
            const key = String(goal?.key || '').toLowerCase();
            return name.includes(query) || key.includes(query);
        });
    }, [epmSubGoals, epmSubGoalQuery]);
    const selectedEpmRootGoal = React.useMemo(() => {
        const key = String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase();
        if (!key) return null;
        return epmRootGoals.find((goal) => String(goal?.key || '').trim().toUpperCase() === key) || { key, name: key };
    }, [epmConfigDraft.scope?.rootGoalKey, epmRootGoals]);
    const selectedEpmSubGoals = React.useMemo(() => {
        const keys = normalizeEpmScopeSubGoalKeys(epmConfigDraft.scope);
        if (!keys.length) return [];
        return keys.map((key) => (
            epmSubGoals.find((goal) => String(goal?.key || '').trim().toUpperCase() === key) || { key, name: key }
        ));
    }, [epmConfigDraft.scope?.subGoalKeys, epmSubGoals]);
    const visibleEpmRootGoals = filteredEpmRootGoals.slice(0, 10);
    const selectedEpmSubGoalKeySet = React.useMemo(
        () => new Set(normalizeEpmScopeSubGoalKeys(epmConfigDraft.scope)),
        [epmConfigDraft.scope?.subGoalKeys]
    );
    const visibleEpmSubGoals = filteredEpmSubGoals
        .filter((goal) => !selectedEpmSubGoalKeySet.has(String(goal?.key || '').trim().toUpperCase()))
        .slice(0, 10);
    const activeEpmRootGoalIndex = Math.min(epmRootGoalIndex, Math.max(visibleEpmRootGoals.length - 1, 0));
    const activeEpmSubGoalIndex = Math.min(epmSubGoalIndex, Math.max(visibleEpmSubGoals.length - 1, 0));
    const showEpmRootGoalResults = epmRootGoalOpen && (epmRootGoalsLoading || Boolean(epmRootGoalsError) || Boolean(epmRootGoalQuery.trim()) || visibleEpmRootGoals.length > 0 || (!epmRootGoalsLoading && !epmRootGoalsError && epmRootGoals.length === 0));
    const showEpmSubGoalResults = epmSubGoalOpen && Boolean(epmConfigDraft.scope?.rootGoalKey) && (epmSubGoalsLoading || Boolean(epmSubGoalsError) || Boolean(epmSubGoalQuery.trim()) || visibleEpmSubGoals.length > 0 || (!epmSubGoalsLoading && !epmSubGoalsError && epmSubGoals.length === 0));
    const handleEpmRootGoalSearchKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            if (!visibleEpmRootGoals.length) return;
            event.preventDefault();
            setEpmRootGoalOpen(true);
            setEpmRootGoalIndex((prev) => Math.min(prev + 1, visibleEpmRootGoals.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            if (!visibleEpmRootGoals.length) return;
            event.preventDefault();
            setEpmRootGoalOpen(true);
            setEpmRootGoalIndex((prev) => Math.max(prev - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            if (!visibleEpmRootGoals.length) return;
            event.preventDefault();
            const goal = visibleEpmRootGoals[activeEpmRootGoalIndex] || visibleEpmRootGoals[0];
            if (goal) {
                void selectEpmRootGoal(goal);
            }
            return;
        }
        if (event.key === 'Escape' && epmRootGoalOpen) {
            event.preventDefault();
            event.stopPropagation();
            setEpmRootGoalOpen(false);
        }
    };
    const handleEpmSubGoalSearchKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            if (!visibleEpmSubGoals.length) return;
            event.preventDefault();
            setEpmSubGoalOpen(true);
            setEpmSubGoalIndex((prev) => Math.min(prev + 1, visibleEpmSubGoals.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            if (!visibleEpmSubGoals.length) return;
            event.preventDefault();
            setEpmSubGoalOpen(true);
            setEpmSubGoalIndex((prev) => Math.max(prev - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            if (!visibleEpmSubGoals.length) return;
            event.preventDefault();
            const goal = visibleEpmSubGoals[activeEpmSubGoalIndex] || visibleEpmSubGoals[0];
            if (goal) {
                selectEpmSubGoal(goal);
            }
            return;
        }
        if (event.key === 'Escape' && epmSubGoalOpen) {
            event.preventDefault();
            event.stopPropagation();
            setEpmSubGoalOpen(false);
        }
    };

    const isEpmConfigDirty = React.useMemo(() => {
        return JSON.stringify(epmConfigDraft) !== epmConfigBaselineRef.current;
    }, [epmConfigDraft]);
    const hasSavedEpmScope = React.useMemo(() => {
        try {
            const savedConfig = JSON.parse(epmConfigBaselineRef.current || '{}');
            return hasSavedEpmScopeConfig(savedConfig);
        } catch (err) {
            return false;
        }
    }, [epmConfigDraft]);
    const savedEpmSubGoalKeys = React.useMemo(
        () => normalizeEpmScopeSubGoalKeys(epmConfigDraft.scope),
        [epmConfigDraft.scope?.subGoalKeys]
    );
    const savedEpmRootGoalKey = React.useMemo(
        () => String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase(),
        [epmConfigDraft.scope?.rootGoalKey]
    );

    const epmProjectPrerequisites = React.useMemo(() => getEpmProjectPrerequisites(epmConfigDraft), [epmConfigDraft]);
    const canLoadEpmProjects = epmProjectPrerequisites.length === 0;
    const epmSettingsProjectsCacheKey = React.useMemo(() => getEpmSettingsProjectsCacheKey(epmConfigDraft), [epmConfigDraft]);

    const epmSettingsProjectRows = React.useMemo(() => {
        const configuredProjects = epmConfigDraft.projects || {};
        const rows = [];
        const seen = new Set();
        (epmSettingsProjects || []).forEach((project) => {
            const projectId = String(project?.id || project?.homeProjectId || '').trim();
            if (!projectId) return;
            const homeProjectId = String(project?.homeProjectId || projectId).trim();
            const configuredRow = configuredProjects[projectId] || configuredProjects[homeProjectId] || {};
            rows.push(hydrateEpmProjectDraft({
                id: projectId,
                homeProjectId,
                homeName: String(project?.name || ''),
                homeUrl: project?.homeUrl || project?.url || '',
                stateLabel: project?.stateLabel || '',
                stateValue: project?.stateValue || '',
                latestUpdateDate: project?.latestUpdateDate || '',
                latestUpdateSnippet: project?.latestUpdateSnippet || '',
                name: String(configuredRow?.name ?? ''),
                label: String(configuredRow?.label ?? ''),
                missingFromHomeFetch: Boolean(project?.missingFromHomeFetch),
            }, project));
            seen.add(projectId);
            seen.add(homeProjectId);
        });
        Object.entries(configuredProjects).forEach(([projectId, row]) => {
            if (!row || typeof row !== 'object') return;
            const id = String(row.id || projectId || '').trim();
            if (!id || seen.has(id)) return;
            const homeProjectId = row.homeProjectId === null ? null : String(row.homeProjectId || '').trim();
            if (homeProjectId && seen.has(homeProjectId)) return;
            rows.push(hydrateEpmProjectDraft({
                id,
                homeProjectId,
                homeName: '',
                homeUrl: '',
                stateLabel: '',
                stateValue: '',
                latestUpdateDate: '',
                latestUpdateSnippet: '',
                name: String(row?.name ?? ''),
                label: String(row?.label ?? ''),
            }, null));
        });
        const filteredRows = rows.filter(row => {
            const id = String(row.id || '').trim();
            if (id && removedEpmProjectIds.has(id)) return false;
            if (row.homeProjectId && removedEpmProjectIds.has(String(row.homeProjectId))) return false;
            return true;
        });
        return sortEpmSettingsProjects(filterEpmSettingsProjectsForView(filteredRows, epmSettingsProjectView), epmSettingsProjectSort);
    }, [epmConfigDraft, epmSettingsProjectSort, epmSettingsProjectView, epmSettingsProjects, removedEpmProjectIds]);

    const openEpmSettingsTab = () => {
        if (!canEditEpmConfiguration) {
            return;
        }
        trackSettingsAction('epm', 'open', { source_surface: 'epm' });
        resetEpmSettingsProjectRows();
        setShowGroupManage(true);
        setGroupManageTab('epm');
        setEpmSettingsTab('projects');
    };

    const focusEpmScopeField = React.useCallback((field) => {
        setEpmSettingsTab('scope');
        window.requestAnimationFrame(() => {
            const selector = field === 'labelPrefix'
                ? '[data-epm-scope-field="labelPrefix"]'
                : '[data-epm-scope-field="subGoal"]';
            const node = document.querySelector(selector);
            if (node && typeof node.focus === 'function') {
                node.focus();
            }
        });
    }, []);

    const handleEpmSettingsTabKeyDown = (event) => {
        const tabs = ['scope', 'projects'];
        const focusTab = (tab) => {
            window.requestAnimationFrame(() => {
                const node = document.getElementById(`epm-settings-${tab}-tab`);
                if (node && typeof node.focus === 'function') {
                    node.focus();
                }
            });
        };
        const currentIndex = tabs.indexOf(epmSettingsTab);
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];
            setEpmSettingsTab(nextTab);
            focusTab(nextTab);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setEpmSettingsTab('scope');
            focusTab('scope');
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            setEpmSettingsTab('projects');
            focusTab('projects');
        }
    };

    const setTrackedEpmSettingsProjectSort = (sortKey) => {
        trackSortChanged('epm_settings_projects', sortKey, { sort_direction: 'asc', source_surface: 'epm_settings' });
        setEpmSettingsProjectSort(sortKey);
    };

    return {
        epmConfigDraft,
        epmConfigDraftRef,
        epmConfigDraftGenerationRef,
        setEpmConfigDraft,
        epmConfigLoading,
        setEpmConfigLoading,
        epmConfigSaving,
        epmConfigLoaded,
        epmSettingsProjects,
        epmSettingsProjectsLoading,
        epmSettingsProjectsError,
        epmSettingsProjectsLoaded,
        setEpmSettingsProjectsLoaded,
        epmSettingsProjectsLoadedAt,
        setEpmSettingsProjectsLoadedAt,
        epmSettingsProjectsFetchMeta,
        setEpmSettingsProjectsFetchMeta,
        epmSettingsProjectsRefreshing,
        removedEpmProjectIds,
        setRemovedEpmProjectIds,
        epmSettingsProjectSort,
        epmSettingsProjectView,
        setEpmSettingsProjectView,
        epmSettingsTab,
        setEpmSettingsTab,
        epmLabelShowAll,
        setEpmLabelShowAll,
        epmLabelChanging,
        setEpmLabelChanging,
        epmLabelMenuAnchor,
        setEpmLabelMenuAnchor,
        epmLabelMenuInputRef,
        epmConfigBaselineRef,
        epmScopeMeta,
        setEpmScopeMeta,
        setEpmRootGoals,
        epmSubGoals,
        epmRootGoalsLoading,
        setEpmRootGoalsLoading,
        epmSubGoalsLoading,
        epmRootGoalsError,
        setEpmRootGoalsError,
        epmSubGoalsError,
        epmRootGoalQuery,
        setEpmRootGoalQuery,
        epmSubGoalQuery,
        setEpmSubGoalQuery,
        setEpmRootGoalOpen,
        setEpmSubGoalOpen,
        setEpmRootGoalIndex,
        setEpmSubGoalIndex,
        epmSettingsProjectsCacheRef,
        loadEpmConfig,
        loadEpmScopeMeta,
        loadEpmGoals,
        ensureEpmSettingsProjectsLoaded,
        saveEpmConfig,
        updateEpmLabelPrefixDraft,
        updateEpmProjectDraft,
        getEpmLabelRowKey,
        getEpmLabelSearchResults,
        addCustomEpmProjectDraft,
        removeEpmProjectDraft,
        deleteEpmProjectRow,
        loadEpmProjectLabels,
        requestEpmLabelFocus,
        registerEpmLabelInput,
        selectEpmProjectLabel,
        openEpmLabelMenu,
        handleEpmLabelSearchKeyDown,
        loadEpmSubGoalsForRoot,
        selectEpmRootGoal,
        clearEpmRootGoal,
        clearEpmSubGoal,
        selectEpmSubGoal,
        normalizeEpmConfigDraft,
        applySavedEpmConfig,
        filteredEpmRootGoals,
        filteredEpmSubGoals,
        selectedEpmRootGoal,
        selectedEpmSubGoals,
        visibleEpmRootGoals,
        visibleEpmSubGoals,
        activeEpmRootGoalIndex,
        activeEpmSubGoalIndex,
        showEpmRootGoalResults,
        showEpmSubGoalResults,
        handleEpmRootGoalSearchKeyDown,
        handleEpmSubGoalSearchKeyDown,
        isEpmConfigDirty,
        hasSavedEpmScope,
        savedEpmSubGoalKeys,
        savedEpmRootGoalKey,
        epmProjectPrerequisites,
        canLoadEpmProjects,
        epmSettingsProjectsCacheKey,
        epmSettingsProjectRows,
        openEpmSettingsTab,
        focusEpmScopeField,
        handleEpmSettingsTabKeyDown,
        setTrackedEpmSettingsProjectSort,
    };
}

export function useEpmLabelMenuEffects({
    epmLabelMenuAnchor,
    epmLabelMenuInputRef,
    epmSettingsTab,
    groupManageTab,
    setEpmLabelMenuAnchor,
    setRemovedEpmProjectIds,
    showGroupManage,
}) {
    useEffect(() => {
        if (!epmLabelMenuAnchor) return;
        const reposition = () => {
            const inputNode = epmLabelMenuInputRef.current;
            if (!inputNode || !document.body.contains(inputNode)) {
                setEpmLabelMenuAnchor(null);
                epmLabelMenuInputRef.current = null;
                return;
            }
            const rect = inputNode.getBoundingClientRect();
            setEpmLabelMenuAnchor(prev => prev ? {
                ...prev,
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            } : prev);
        };
        const scrollRegion = document.querySelector('.epm-projects-scroll-region');
        window.addEventListener('resize', reposition);
        scrollRegion?.addEventListener('scroll', reposition, { passive: true });
        return () => {
            window.removeEventListener('resize', reposition);
            scrollRegion?.removeEventListener('scroll', reposition);
        };
    }, [epmLabelMenuAnchor?.rowKey]);
    useEffect(() => {
        if (showGroupManage && groupManageTab === 'epm' && epmSettingsTab === 'projects') return;
        setEpmLabelMenuAnchor(null);
        epmLabelMenuInputRef.current = null;
    }, [showGroupManage, groupManageTab, epmSettingsTab]);
    useEffect(() => {
        if (!showGroupManage) setRemovedEpmProjectIds(new Set());
    }, [showGroupManage]);
}

export function useEpmSettingsLoadEffect({
    applySavedEpmConfig,
    epmConfigDraft,
    epmConfigDraftGenerationRef,
    epmConfigDraftRef,
    groupManageTab,
    isEpmConfigDirty,
    loadEpmConfig,
    loadEpmGoals,
    loadEpmScopeMeta,
    loadEpmSubGoalsForRoot,
    setEpmConfigLoading,
    setEpmRootGoalIndex,
    setEpmRootGoalOpen,
    setEpmRootGoalQuery,
    setEpmRootGoals,
    setEpmRootGoalsError,
    setEpmRootGoalsLoading,
    setEpmScopeMeta,
    setEpmSubGoalIndex,
    setEpmSubGoalOpen,
    setEpmSubGoalQuery,
    setGroupDraftError,
    showGroupManage,
}) {
    useEffect(() => {
        if (!showGroupManage || groupManageTab !== 'epm') return;
        let cancelled = false;
        const loadEpmSettings = async () => {
            const emptyEpmConfig = createEmptyEpmConfigDraft();
            setEpmConfigLoading(true);
            setEpmScopeMeta({ cloudId: '', error: '' });
            setEpmRootGoals([]);
            setEpmRootGoalsLoading(false);
            setEpmRootGoalsError('');
            let rootGoalKey = '';
            let loadedConfig = null;
            let requestGeneration = null;
            try {
                if (isEpmConfigDirty) {
                    loadedConfig = epmConfigDraft;
                    rootGoalKey = String(epmConfigDraft.scope?.rootGoalKey || '').trim().toUpperCase();
                } else {
                    requestGeneration = epmConfigDraftGenerationRef.current;
                    const config = await loadEpmConfig();
                    if (!cancelled) {
                        const nextConfig = epmConfigDraftGenerationRef.current === requestGeneration
                            ? applySavedEpmConfig(config)
                            : epmConfigDraftRef.current;
                        loadedConfig = nextConfig;
                        rootGoalKey = String(nextConfig.scope?.rootGoalKey || '').trim().toUpperCase();
                    }
                }
                if (!cancelled) {
                    setEpmRootGoalQuery('');
                    setEpmSubGoalQuery('');
                    setEpmRootGoalOpen(false);
                    setEpmSubGoalOpen(false);
                    setEpmRootGoalIndex(0);
                    setEpmSubGoalIndex(0);
                }
            } catch (err) {
                if (isAuthenticationRequiredError(err)) return;
                console.error('Failed to load EPM config:', err);
                if (!cancelled) {
                    if (requestGeneration === epmConfigDraftGenerationRef.current) {
                        applySavedEpmConfig(emptyEpmConfig);
                    }
                    setGroupDraftError('Failed to load EPM settings.');
                    setEpmConfigLoading(false);
                }
                return;
            } finally {
                if (cancelled) {
                    setEpmConfigLoading(false);
                }
            }
            if (cancelled) return;
            try {
                const scopeMeta = await loadEpmScopeMeta();
                if (!cancelled) {
                    setEpmScopeMeta({
                        cloudId: String(scopeMeta?.cloudId || '').trim(),
                        error: String(scopeMeta?.error || '').trim(),
                    });
                }
            } catch (err) {
                if (isAuthenticationRequiredError(err)) return;
                console.error('Failed to load EPM scope metadata:', err);
                if (!cancelled) {
                    setEpmScopeMeta({ cloudId: '', error: err?.message || '' });
                }
            }
            if (cancelled) return;
            setEpmRootGoalsLoading(true);
            try {
                const rootGoalsPayload = await loadEpmGoals();
                if (!cancelled) {
                    setEpmRootGoals(Array.isArray(rootGoalsPayload?.goals) ? rootGoalsPayload.goals : []);
                    setEpmRootGoalsError(String(rootGoalsPayload?.error || '').trim());
                }
            } catch (err) {
                if (isAuthenticationRequiredError(err)) return;
                console.error('Failed to load EPM root goals:', err);
                if (!cancelled) {
                    setEpmRootGoals([]);
                    setEpmRootGoalsError(err?.message || '');
                }
            } finally {
                if (!cancelled) {
                    setEpmRootGoalsLoading(false);
                }
            }
            if (!cancelled && rootGoalKey) {
                await loadEpmSubGoalsForRoot(rootGoalKey);
            }
            if (!cancelled) {
                setEpmConfigLoading(false);
            }
        };
        loadEpmSettings();
        return () => {
            cancelled = true;
            setEpmConfigLoading(false);
        };
    }, [showGroupManage, groupManageTab]);
}

export function useEpmSavedSubGoalsEffect({
    epmConfigLoaded,
    loadEpmSubGoalsForRoot,
    savedEpmRootGoalKey,
    savedEpmSubGoalKeys,
    selectedView,
    showEpmNavigation,
}) {
    useEffect(() => {
        if (!showEpmNavigation || selectedView !== 'epm' || !epmConfigLoaded || savedEpmSubGoalKeys.length < 1 || !savedEpmRootGoalKey) return;
        void loadEpmSubGoalsForRoot(savedEpmRootGoalKey);
    }, [showEpmNavigation, selectedView, epmConfigLoaded, savedEpmRootGoalKey, savedEpmSubGoalKeys]);
}

export function useEpmSettingsProjectsEffects({
    canLoadEpmProjects,
    ensureEpmSettingsProjectsLoaded,
    epmConfigDraft,
    epmSettingsProjectsCacheKey,
    epmSettingsProjectsCacheRef,
    epmSettingsTab,
    groupManageTab,
    normalizeEpmConfigDraft,
    setEpmSettingsProjectsFetchMeta,
    setEpmSettingsProjectsLoaded,
    setEpmSettingsProjectsLoadedAt,
    showGroupManage,
}) {
    useEffect(() => {
        if (epmSettingsProjectsCacheKey && epmSettingsProjectsCacheRef.current.has(epmSettingsProjectsCacheKey)) return;
        setEpmSettingsProjectsLoaded(false);
        setEpmSettingsProjectsLoadedAt('');
        setEpmSettingsProjectsFetchMeta({
            cacheHit: false,
            fetchedAt: '',
            homeProjectCount: 0,
            homeProjectLimit: null,
            possiblyTruncated: false,
        });
    }, [epmSettingsProjectsCacheKey]);

    useEffect(() => {
        if (!showGroupManage || groupManageTab !== 'epm' || epmSettingsTab !== 'projects') return;
        if (!canLoadEpmProjects || !epmSettingsProjectsCacheKey) return;
        const draftSnapshot = normalizeEpmConfigDraft(epmConfigDraft);
        const cacheKeySnapshot = getEpmSettingsProjectsCacheKey(draftSnapshot);
        if (!cacheKeySnapshot || cacheKeySnapshot !== epmSettingsProjectsCacheKey) return;
        void ensureEpmSettingsProjectsLoaded({
            draftConfig: draftSnapshot,
            cacheKey: cacheKeySnapshot,
        }).catch(() => {});
    }, [showGroupManage, groupManageTab, epmSettingsTab, canLoadEpmProjects, epmSettingsProjectsCacheKey]);
}
