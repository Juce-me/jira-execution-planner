import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import {
    GROUPS_CONFIG_VERSION,
    TEAM_LABEL_ALIAS_LIMIT,
    addTeamLabelAlias,
    applyLocalGroupPreferences,
    buildGroupId,
    normalizeGroupsConfig,
    removeTeamLabelAlias,
    validateImportedTeamLabels,
} from './groupConfigUtils.js';
import { boardDraftIsDirty } from './groupsConfigConflict.js';
import { buildTeamAvailability } from './teamAvailability.js';
import { getLabelRowKey } from './labelRowKey.js';
import { useGroupVisibilityPreferences } from './useGroupVisibilityPreferences.js';
import {
    buildSharedGroupsPayload,
    effectiveVisibleGroupIds,
    resolveVisibleActiveGroupId,
} from './groupVisibilityUtils.js';
import { bucketCount } from '../analytics/dashboardAnalytics.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { fetchGroupsConfig as requestGroupsConfig } from '../api/configApi.js';
import {
    fetchJiraLabels as requestJiraLabels,
    searchComponents as requestComponentSearch,
    searchEpics as requestEpicSearch,
} from '../api/jiraCatalogApi.js';

export function useTeamGroupSettings({
    BACKEND_URL,
    activeGroupId,
    clearServerConnectionError,
    firstRunConfigurationActive,
    getTeamOptions,
    markConnectionBootstrapHealthy,
    reportServerConnectionError,
    savedPrefsRef,
    selectedSprintInfo,
    setActiveGroupId,
    setGroupDraftError,
    setShowGroupListMobile,
    showGroupManage,
    teamCatalogState,
    teamMembershipState,
    trackSettingsAction,
}) {
    const [groupsConfig, setGroupsConfig] = useState({
        version: 1,
        groups: [],
        defaultGroupId: '',
    });
    const [groupsLoading, setGroupsLoading] = useState(true);
    const [groupsError, setGroupsError] = useState('');
    const [boardGroupsReadFailed, setBoardGroupsReadFailed] = useState(false);
    const acceptedGroupsConfigRef = useRef(false);
    const groupsReadGenerationRef = useRef(0);
    const groupsSaveReadFenceRef = useRef(0);
    const [groupWarnings, setGroupWarnings] = useState([]);
    const [groupConfigSource, setGroupConfigSource] = useState('');
    const [groupDraft, setGroupDraft] = useState(null);
    // { current, savedSections }: a rejected groups POST, kept so the draft survives it (D45).
    const [groupsConfigConflict, setGroupsConfigConflict] = useState(null);
    const [groupImportText, setGroupImportText] = useState('');
    const [showGroupImport, setShowGroupImport] = useState(false);
    const [showGroupAdvanced, setShowGroupAdvanced] = useState(false);
    const [teamNameInputs, setTeamNameInputs] = useState([]);
    const [teamSearchQuery, setTeamSearchQuery] = useState({});
    const [teamSearchOpen, setTeamSearchOpen] = useState({});
    const [teamSearchIndex, setTeamSearchIndex] = useState({});
    const [teamSearchFeedback, setTeamSearchFeedback] = useState({});
    const teamSearchInputRefs = useRef({});
    const teamSearchFeedbackTimersRef = useRef({});
    const teamChipLastRef = useRef({});
    const [labelSearchQuery, setLabelSearchQuery] = useState({});
    const [labelSearchOpen, setLabelSearchOpen] = useState({});
    const [labelSearchResults, setLabelSearchResults] = useState({});
    const [labelSearchLoading, setLabelSearchLoading] = useState({});
    const [labelSearchIndex, setLabelSearchIndex] = useState({});
    const [labelAddOpen, setLabelAddOpen] = useState({});
    const labelAddButtonRefs = useRef({});
    const labelSearchCacheRef = useRef({});
    const labelSearchRequestIdRef = useRef({});
    const labelSearchDebounceRef = useRef({});
    const [groupSearchQuery, setGroupSearchQuery] = useState('');
    const [activeGroupDraftId, setActiveGroupDraftId] = useState(null);
    const groupDraftBaselineRef = useRef('');
    const [componentSearchQuery, setComponentSearchQuery] = useState('');
    const [componentSearchResults, setComponentSearchResults] = useState([]);
    const [componentSearchOpen, setComponentSearchOpen] = useState(false);
    const [componentSearchIndex, setComponentSearchIndex] = useState(0);
    const [componentSearchLoading, setComponentSearchLoading] = useState(false);
    const [excludedEpicSearchQuery, setExcludedEpicSearchQuery] = useState('');
    const [excludedEpicSearchResults, setExcludedEpicSearchResults] = useState([]);
    const [excludedEpicSearchOpen, setExcludedEpicSearchOpen] = useState(false);
    const [excludedEpicSearchIndex, setExcludedEpicSearchIndex] = useState(0);
    const [excludedEpicSearchLoading, setExcludedEpicSearchLoading] = useState(false);
    const excludedEpicSearchInputRef = useRef(null);
    const excludedEpicChipLastRef = useRef(null);
    const [adHocEpicSearchQuery, setAdHocEpicSearchQuery] = useState('');
    const [adHocEpicSearchResults, setAdHocEpicSearchResults] = useState([]);
    const [adHocEpicSearchOpen, setAdHocEpicSearchOpen] = useState(false);
    const [adHocEpicSearchIndex, setAdHocEpicSearchIndex] = useState(0);
    const [adHocEpicSearchLoading, setAdHocEpicSearchLoading] = useState(false);
    const adHocEpicSearchInputRef = useRef(null);
    const adHocEpicChipLastRef = useRef(null);

    const applyPreferenceGroupsSnapshot = React.useCallback((snapshot) => {
        const normalized = normalizeGroupsConfig(snapshot);
        setGroupsConfig(normalized);
        setGroupWarnings(snapshot?.warnings || []);
        setGroupConfigSource(normalized.source || snapshot?.source || '');
        if (showGroupManage) {
            setGroupDraft(normalized);
            groupDraftBaselineRef.current = JSON.stringify(buildSharedGroupsPayload(normalized));
        }
        return normalized;
    }, [showGroupManage]);
    const personalGroupPreferencesEnabled = groupsConfig.source === 'workspace_db';

    const {
        groupPreferences,
        setGroupPreferences,
        visibleGroupDraftIds,
        setVisibleGroupDraftIds,
        favoriteGroupDraftId,
        setFavoriteGroupDraftId,
        setFavoriteGroupDraft,
        favoriteGroupValidationError,
        setGroupPreferencesSaving,
        groupVisibilitySaving,
        isGroupVisibilityDraftDirty,
        visibleControlGroups,
        initializeGroupPreferencesDraft,
        isGroupVisibleInControls,
        toggleGroupVisibleInControls,
        firstRunFavoriteGroupId,
        selectFirstRunFavoriteGroup,
        saveFirstRunGroupPreferences,
        firstRunSaving,
        firstRunError,
        persistGroupPreferences,
    } = useGroupVisibilityPreferences({
        backendUrl: BACKEND_URL,
        groupsConfig,
        groupsLoading,
        groupDraft,
        activeGroupId,
        setActiveGroupId,
        applyPreferenceGroupsSnapshot,
        trackSettingsAction,
        bucketCount,
        useBackendPreferences: personalGroupPreferencesEnabled,
    });

    const loadGroupsConfig = async () => {
        const saveReadFence = groupsSaveReadFenceRef.current;
        const readGeneration = saveReadFence
            ? groupsReadGenerationRef.current
            : groupsReadGenerationRef.current + 1;
        if (!saveReadFence) groupsReadGenerationRef.current = readGeneration;
        const shouldApplyResult = () => saveReadFence === 0
            && groupsSaveReadFenceRef.current === 0
            && groupsReadGenerationRef.current === readGeneration;
        setGroupsLoading(true);
        setGroupsError('');
        try {
            const response = await requestGroupsConfig(BACKEND_URL);
            if (!response.ok) {
                throw new Error(`Groups config error ${response.status}`);
            }
            const payload = await response.json();
            if (!shouldApplyResult()) return false;
            const normalized = applyLocalGroupPreferences(payload, savedPrefsRef.current);
            acceptedGroupsConfigRef.current = true;
            clearServerConnectionError();
            setGroupsConfig(normalized);
            setGroupPreferences(normalized.preferences);
            setGroupWarnings(payload.warnings || []);
            setGroupConfigSource(normalized.source || payload.source || '');
            markConnectionBootstrapHealthy('groups');
            setBoardGroupsReadFailed(false);
            setActiveGroupId(prev => {
                const effectiveIds = effectiveVisibleGroupIds(normalized, normalized.preferences);
                const preferred = normalized.preferences?.activeGroupId || savedPrefsRef.current.activeGroupId || prev;
                return resolveVisibleActiveGroupId(normalized, effectiveIds, preferred);
            });
            return true;
        } catch (err) {
            if (!shouldApplyResult()) return false;
            acceptedGroupsConfigRef.current = false;
            setBoardGroupsReadFailed(true);
            if (isAuthenticationRequiredError(err)) return false;
            if (reportServerConnectionError(err, { bootstrapPart: 'groups' })) {
                setGroupsError('');
            } else {
                setGroupsError(err.message || 'Failed to load groups config.');
            }
            return false;
        } finally {
            if (shouldApplyResult()) setGroupsLoading(false);
        }
    };

    const handleGroupDraftChange = (updater) => {
        setGroupDraft(prev => {
            if (!prev) return prev;
            return updater(prev);
        });
    };

    const loadTeamsFromCurrentView = () => {
        // Use teams from already-loaded tasks (same as teams dropdown)
        const teams = getTeamOptions()
            .filter(team => team.id !== 'all')
            .map(team => ({ id: team.id, name: team.name }));
        return teams;
    };

    const groupDraftSignature = React.useMemo(() => {
        if (!groupDraft) return '';
        return JSON.stringify(buildSharedGroupsPayload(groupDraft));
    }, [groupDraft]);

    // Whether the dirty group draft's trigger for the conflict banner is a board edit
    // specifically, so the banner names a board only when one is actually unsaved.
    const isGroupBoardDraftDirty = React.useMemo(() => {
        let baselineGroups = [];
        try {
            baselineGroups = JSON.parse(groupDraftBaselineRef.current || '{}').groups || [];
        } catch (_) {
            baselineGroups = [];
        }
        return boardDraftIsDirty(groupDraft, baselineGroups);
    }, [groupDraft, groupDraftSignature]);

    const closeAllTeamSearchDropdowns = () => {
        setTeamSearchOpen(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                next[key] = false;
            });
            return next;
        });
    };

    const setTeamFeedback = (groupId, message, tone = 'neutral') => {
        if (!groupId) return;
        setTeamSearchFeedback(prev => ({
            ...prev,
            [groupId]: { message, tone }
        }));
        if (teamSearchFeedbackTimersRef.current[groupId]) {
            clearTimeout(teamSearchFeedbackTimersRef.current[groupId]);
        }
        teamSearchFeedbackTimersRef.current[groupId] = window.setTimeout(() => {
            setTeamSearchFeedback(prev => {
                const next = { ...prev };
                delete next[groupId];
                return next;
            });
            delete teamSearchFeedbackTimersRef.current[groupId];
        }, 2200);
    };

    const addGroupDraftRow = () => {
        let nextId = '';
        handleGroupDraftChange(prev => {
            const existingIds = new Set((prev.groups || []).map(group => group.id));
            nextId = buildGroupId('New Group', existingIds);
            const nextGroup = {
                id: nextId,
                name: 'New Group',
                teamIds: [],
                missingInfoComponents: [],
                excludedCapacityEpics: []
            };
            return {
                ...prev,
                groups: [...(prev.groups || []), nextGroup]
            };
        });
        if (nextId) {
            setActiveGroupDraftId(nextId);
            setVisibleGroupDraftIds(prev => prev.includes(nextId) ? prev : [...prev, nextId]);
            setShowGroupListMobile(false);
        }
    };

    const updateGroupDraftName = (groupId, name) => {
        handleGroupDraftChange(prev => ({
            ...prev,
            groups: (prev.groups || []).map(group =>
                group.id === groupId ? { ...group, name } : group
            )
        }));
    };

    const duplicateGroupDraft = (groupId) => {
        let nextId = '';
        handleGroupDraftChange(prev => {
            const source = (prev.groups || []).find(group => group.id === groupId);
            if (!source) return prev;
            const existingIds = new Set((prev.groups || []).map(group => group.id));
            const nextName = `${source.name || 'Group'} Copy`;
            nextId = buildGroupId(nextName, existingIds);
            const nextGroup = {
                ...structuredClone(source),
                id: nextId,
                name: nextName
            };
            return {
                ...prev,
                groups: [...(prev.groups || []), nextGroup]
            };
        });
        if (nextId) {
            setActiveGroupDraftId(nextId);
            setVisibleGroupDraftIds(prev => prev.includes(nextId) ? prev : [...prev, nextId]);
            setShowGroupListMobile(false);
        }
    };

    const updateGroupDraftBoard = (groupId, board) => {
        handleGroupDraftChange(prev => ({
            ...prev,
            groups: (prev.groups || []).map(group =>
                group.id === groupId ? { ...group, board } : group
            )
        }));
    };

    const focusTeamSearchInput = (groupId) => {
        const node = teamSearchInputRefs.current[groupId];
        if (node && typeof node.focus === 'function') {
            node.focus();
        }
    };

    const addTeamToGroup = (groupId, teamId) => {
        const candidate = availableTeams.find(team => team.id === teamId);
        if (!candidate?.canAdd) {
            setTeamFeedback(groupId, candidate?.availableInSprint === false
                ? 'Not in the selected sprint'
                : 'Wait for team membership to load', 'warn');
            return;
        }
        let added = false;
        let alreadyAdded = false;
        let limitReached = false;
        handleGroupDraftChange(prev => ({
            ...prev,
            groups: (prev.groups || []).map(group => {
                if (group.id !== groupId) return group;
                const currentTeams = group.teamIds || [];
                if (currentTeams.includes(teamId)) {
                    alreadyAdded = true;
                    return group;
                }
                if (currentTeams.length >= 12) {
                    limitReached = true;
                    return group;
                }
                added = true;
                return {
                    ...group,
                    teamIds: [...currentTeams, teamId],
                    teamLabels: { ...(group.teamLabels || {}) }
                };
            })
        }));
        if (alreadyAdded) {
            setTeamFeedback(groupId, 'Already added');
        }
        if (limitReached) {
            setTeamFeedback(groupId, 'Limit reached (12 max)', 'warn');
        }
        if (added) {
            setTeamSearchOpen(prev => ({ ...prev, [groupId]: true }));
            focusTeamSearchInput(groupId);
        }
    };

    const removeTeamFromGroup = (groupId, teamId) => {
        handleGroupDraftChange(prev => ({
            ...prev,
            groups: (prev.groups || []).map(group => {
                if (group.id !== groupId) return group;
                const nextTeamLabels = { ...(group.teamLabels || {}) };
                delete nextTeamLabels[teamId];
                return {
                    ...group,
                    teamIds: (group.teamIds || []).filter(id => id !== teamId),
                    teamLabels: nextTeamLabels
                };
            })
        }));
    };

    // Returns the add status from the rendered draft so a stale duplicate or over-limit
    // selection is reported without relying on when React runs the updater.
    const addTeamLabelToGroup = (groupId, teamId, label) => {
        const currentGroup = (groupDraft?.groups || []).find(group => group.id === groupId);
        const { status } = addTeamLabelAlias(currentGroup?.teamLabels, teamId, label);
        if (status !== 'added') return status;
        handleGroupDraftChange(prev => ({
            ...prev,
            groups: (prev.groups || []).map(group => {
                if (group.id !== groupId) return group;
                const result = addTeamLabelAlias(group.teamLabels, teamId, label);
                return result.status === 'added' ? { ...group, teamLabels: result.teamLabels } : group;
            })
        }));
        return status;
    };

    const removeTeamLabelFromGroup = (groupId, teamId, label) => {
        handleGroupDraftChange(prev => ({
            ...prev,
            groups: (prev.groups || []).map(group => (
                group.id === groupId
                    ? { ...group, teamLabels: removeTeamLabelAlias(group.teamLabels, teamId, label) }
                    : group
            ))
        }));
    };

    const handleTeamSearchChange = (groupId, value) => {
        setTeamSearchQuery(prev => ({ ...prev, [groupId]: value }));
        setTeamSearchOpen(prev => ({ ...prev, [groupId]: true }));
        setTeamSearchIndex(prev => ({ ...prev, [groupId]: 0 }));
        if (teamSearchFeedback[groupId]) {
            setTeamSearchFeedback(prev => {
                const next = { ...prev };
                delete next[groupId];
                return next;
            });
        }
    };

    const handleTeamSearchFocus = (groupId) => {
        setTeamSearchOpen(prev => ({ ...prev, [groupId]: true }));
    };

    const handleTeamSearchBlur = (groupId) => {
        window.setTimeout(() => {
            setTeamSearchOpen(prev => ({ ...prev, [groupId]: false }));
        }, 120);
    };

    const focusLastTeamChip = (groupId) => {
        const node = teamChipLastRef.current[groupId];
        if (node && typeof node.focus === 'function') {
            node.focus();
        }
    };

    const getGroupTeamSearchResults = (group, queryText) => {
        if (!group) return [];
        const teamsInOtherGroups = new Set();
        (groupDraft?.groups || []).forEach(g => {
            if (g.id !== group.id) {
                (g.teamIds || []).forEach(teamId => teamsInOtherGroups.add(teamId));
            }
        });
        const currentTeams = new Set(group.teamIds || []);
        const query = String(queryText || '').toLowerCase();
        return availableTeams.filter(team => {
            if (currentTeams.has(team.id)) return false;
            if (teamsInOtherGroups.has(team.id)) return false;
            const nameLower = String(team.name || '').toLowerCase();
            return nameLower.includes(query);
        });
    };

    const handleTeamSearchKeyDown = (groupId, event, results) => {
        if (!groupId) return;
        const value = teamSearchQuery[groupId] || '';
        const enabledIndexes = results.reduce((indexes, team, index) => {
            if (team.canAdd) indexes.push(index);
            return indexes;
        }, []);
        if (event.key === 'ArrowDown') {
            if (!enabledIndexes.length) return;
            event.preventDefault();
            const current = teamSearchIndex[groupId] || 0;
            const currentPosition = enabledIndexes.indexOf(current);
            setTeamSearchIndex(prev => ({
                ...prev,
                [groupId]: enabledIndexes[Math.min(currentPosition + 1, enabledIndexes.length - 1)]
            }));
            return;
        }
        if (event.key === 'ArrowUp') {
            if (!enabledIndexes.length) return;
            event.preventDefault();
            const current = teamSearchIndex[groupId] || 0;
            const currentPosition = enabledIndexes.indexOf(current);
            setTeamSearchIndex(prev => ({
                ...prev,
                [groupId]: enabledIndexes[currentPosition <= 0 ? 0 : currentPosition - 1]
            }));
            return;
        }
        if (event.key === 'Enter') {
            if (!enabledIndexes.length) return;
            event.preventDefault();
            const index = teamSearchIndex[groupId] || 0;
            const team = results[index]?.canAdd ? results[index] : results[enabledIndexes[0]];
            if (team?.id) {
                addTeamToGroup(groupId, team.id);
            }
            return;
        }
        if (event.key === 'Escape') {
            if (teamSearchOpen[groupId]) {
                event.preventDefault();
                event.stopPropagation();
                setTeamSearchOpen(prev => ({ ...prev, [groupId]: false }));
            }
            return;
        }
        if (event.key === 'Backspace' && !value) {
            focusLastTeamChip(groupId);
        }
    };

    const removeGroupDraft = (groupId) => {
        let nextActiveId = activeGroupDraftId;
        handleGroupDraftChange(prev => {
            const nextGroups = (prev.groups || []).filter(group => group.id !== groupId);
            const nextDefault = prev.defaultGroupId === groupId ? '' : prev.defaultGroupId;
            if (activeGroupDraftId === groupId) {
                nextActiveId = nextGroups[0]?.id || null;
            }
            return {
                ...prev,
                groups: nextGroups,
                defaultGroupId: nextDefault
            };
        });
        if (activeGroupDraftId === groupId) {
            setActiveGroupDraftId(nextActiveId);
        }
        setVisibleGroupDraftIds(prev => prev.filter(id => id !== groupId));
    };

    const toggleDefaultGroupDraft = (groupId) => {
        handleGroupDraftChange(prev => ({
            ...prev,
            defaultGroupId: prev.defaultGroupId === groupId ? '' : groupId
        }));
    };

    const applySavedGroupsConfig = (payload) => {
        const normalized = applyLocalGroupPreferences(payload, savedPrefsRef.current);
        setGroupsConfig(normalized);
        setGroupPreferences(normalized.preferences);
        setGroupWarnings(payload?.warnings || []);
        setGroupConfigSource(normalized.source || payload?.source || '');
        setGroupDraft(normalized);
        groupDraftBaselineRef.current = JSON.stringify(buildSharedGroupsPayload(normalized));
        setActiveGroupId(prev => {
            const effectiveIds = effectiveVisibleGroupIds(normalized, normalized.preferences);
            return resolveVisibleActiveGroupId(normalized, effectiveIds, prev);
        });
        return normalized;
    };

    const filteredComponentSearchResults = React.useMemo(() => {
        const group = activeGroupDraftId
            ? (groupDraft?.groups || []).find(g => g.id === activeGroupDraftId)
            : null;
        const selected = new Set((group?.missingInfoComponents || []).map(c => c.toLowerCase()));
        return componentSearchResults.filter(c => !selected.has(c.name.toLowerCase()));
    }, [componentSearchResults, groupDraft, activeGroupDraftId]);

    const filteredExcludedEpicSearchResults = React.useMemo(() => {
        const group = activeGroupDraftId
            ? (groupDraft?.groups || []).find(g => g.id === activeGroupDraftId)
            : null;
        const selected = new Set((group?.excludedCapacityEpics || []).map(key => String(key || '').trim().toUpperCase()));
        return excludedEpicSearchResults.filter((epic) => {
            const key = String(epic?.key || '').trim().toUpperCase();
            return key && !selected.has(key);
        });
    }, [excludedEpicSearchResults, groupDraft, activeGroupDraftId]);

    const filteredAdHocEpicSearchResults = React.useMemo(() => {
        const group = activeGroupDraftId
            ? (groupDraft?.groups || []).find(g => g.id === activeGroupDraftId)
            : null;
        const selected = new Set((group?.adHocCapacityEpics || []).map(key => String(key || '').trim().toUpperCase()));
        return adHocEpicSearchResults.filter((epic) => {
            const key = String(epic?.key || '').trim().toUpperCase();
            return key && !selected.has(key);
        });
    }, [adHocEpicSearchResults, groupDraft, activeGroupDraftId]);

    const handleComponentSearchKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            if (!filteredComponentSearchResults.length) return;
            event.preventDefault();
            setComponentSearchIndex(prev => Math.min(prev + 1, filteredComponentSearchResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            if (!filteredComponentSearchResults.length) return;
            event.preventDefault();
            setComponentSearchIndex(prev => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter') {
            if (!filteredComponentSearchResults.length) return;
            event.preventDefault();
            const comp = filteredComponentSearchResults[componentSearchIndex] || filteredComponentSearchResults[0];
            if (comp && activeGroupDraft) addGroupMissingInfoComponent(activeGroupDraft.id, comp.name);
        } else if (event.key === 'Escape') {
            if (componentSearchOpen) {
                event.preventDefault();
                event.stopPropagation();
                setComponentSearchOpen(false);
            }
        }
    };

    const addGroupMissingInfoComponent = (groupId, componentName) => {
        setGroupDraft(prev => {
            if (!prev) return prev;
            const groups = (prev.groups || []).map(g => {
                if (g.id !== groupId) return g;
                const existing = g.missingInfoComponents || [];
                if (existing.some(c => c.toLowerCase() === componentName.toLowerCase())) return g;
                return { ...g, missingInfoComponents: [...existing, componentName] };
            });
            return { ...prev, groups };
        });
        setComponentSearchQuery('');
        setComponentSearchOpen(false);
    };

    const removeGroupMissingInfoComponent = (groupId, componentName) => {
        setGroupDraft(prev => {
            if (!prev) return prev;
            const groups = (prev.groups || []).map(g => {
                if (g.id !== groupId) return g;
                return { ...g, missingInfoComponents: (g.missingInfoComponents || []).filter(c => c !== componentName) };
            });
            return { ...prev, groups };
        });
    };

    const addGroupExcludedCapacityEpic = (groupId, epicKey) => {
        const normalizedKey = String(epicKey || '').trim().toUpperCase();
        if (!normalizedKey) return;
        let added = false;
        setGroupDraft(prev => {
            if (!prev) return prev;
            const groups = (prev.groups || []).map(g => {
                if (g.id !== groupId) return g;
                const existing = (g.excludedCapacityEpics || []).map(key => String(key || '').trim().toUpperCase());
                if (existing.includes(normalizedKey)) return g;
                added = true;
                return { ...g, excludedCapacityEpics: [...existing, normalizedKey] };
            });
            return { ...prev, groups };
        });
        if (added) {
            setExcludedEpicSearchOpen(true);
            focusExcludedEpicSearchInput();
        }
    };

    const removeGroupExcludedCapacityEpic = (groupId, epicKey) => {
        const normalizedKey = String(epicKey || '').trim().toUpperCase();
        setGroupDraft(prev => {
            if (!prev) return prev;
            const groups = (prev.groups || []).map(g => {
                if (g.id !== groupId) return g;
                return {
                    ...g,
                    excludedCapacityEpics: (g.excludedCapacityEpics || [])
                        .map(key => String(key || '').trim().toUpperCase())
                        .filter(key => key !== normalizedKey)
                };
            });
            return { ...prev, groups };
        });
    };

    const addGroupAdHocCapacityEpic = (groupId, epicKey) => {
        const normalizedKey = String(epicKey || '').trim().toUpperCase();
        if (!normalizedKey) return;
        let added = false;
        setGroupDraft(prev => {
            if (!prev) return prev;
            const groups = (prev.groups || []).map(g => {
                if (g.id !== groupId) return g;
                const existing = (g.adHocCapacityEpics || []).map(key => String(key || '').trim().toUpperCase()).filter(Boolean);
                if (existing.includes(normalizedKey)) return g;
                added = true;
                return { ...g, adHocCapacityEpics: [...existing, normalizedKey] };
            });
            return { ...prev, groups };
        });
        if (added) {
            setAdHocEpicSearchOpen(true);
            focusAdHocEpicSearchInput();
        }
    };

    const removeGroupAdHocCapacityEpic = (groupId, epicKey) => {
        const normalizedKey = String(epicKey || '').trim().toUpperCase();
        setGroupDraft(prev => {
            if (!prev) return prev;
            const groups = (prev.groups || []).map(g => {
                if (g.id !== groupId) return g;
                return {
                    ...g,
                    adHocCapacityEpics: (g.adHocCapacityEpics || [])
                        .map(key => String(key || '').trim().toUpperCase())
                        .filter(key => key !== normalizedKey)
                };
            });
            return { ...prev, groups };
        });
    };

    const handleExcludedEpicSearchKeyDown = (event) => {
        const value = excludedEpicSearchQuery || '';
        if (event.key === 'ArrowDown') {
            if (!filteredExcludedEpicSearchResults.length) return;
            event.preventDefault();
            setExcludedEpicSearchIndex(prev => Math.min(prev + 1, filteredExcludedEpicSearchResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            if (!filteredExcludedEpicSearchResults.length) return;
            event.preventDefault();
            setExcludedEpicSearchIndex(prev => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter') {
            if (!filteredExcludedEpicSearchResults.length) return;
            event.preventDefault();
            const epic = filteredExcludedEpicSearchResults[excludedEpicSearchIndex] || filteredExcludedEpicSearchResults[0];
            if (epic && activeGroupDraft) addGroupExcludedCapacityEpic(activeGroupDraft.id, epic.key);
        } else if (event.key === 'Escape') {
            if (excludedEpicSearchOpen) {
                event.preventDefault();
                event.stopPropagation();
                setExcludedEpicSearchOpen(false);
            }
        } else if (event.key === 'Backspace' && !value) {
            const node = excludedEpicChipLastRef.current;
            if (node && typeof node.focus === 'function') {
                node.focus();
            }
        }
    };

    const focusExcludedEpicSearchInput = () => {
        const node = excludedEpicSearchInputRef.current;
        if (node && typeof node.focus === 'function') {
            node.focus();
        }
    };

    const handleAdHocEpicSearchKeyDown = (event) => {
        const value = adHocEpicSearchQuery || '';
        if (event.key === 'ArrowDown') {
            if (!filteredAdHocEpicSearchResults.length) return;
            event.preventDefault();
            setAdHocEpicSearchIndex(prev => Math.min(prev + 1, filteredAdHocEpicSearchResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            if (!filteredAdHocEpicSearchResults.length) return;
            event.preventDefault();
            setAdHocEpicSearchIndex(prev => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter') {
            if (!filteredAdHocEpicSearchResults.length) return;
            event.preventDefault();
            const epic = filteredAdHocEpicSearchResults[adHocEpicSearchIndex] || filteredAdHocEpicSearchResults[0];
            if (epic && activeGroupDraft) addGroupAdHocCapacityEpic(activeGroupDraft.id, epic.key);
        } else if (event.key === 'Escape') {
            if (adHocEpicSearchOpen) {
                event.preventDefault();
                event.stopPropagation();
                setAdHocEpicSearchOpen(false);
            }
        } else if (event.key === 'Backspace' && !value) {
            const node = adHocEpicChipLastRef.current;
            if (node && typeof node.focus === 'function') {
                node.focus();
            }
        }
    };

    const focusAdHocEpicSearchInput = () => {
        const node = adHocEpicSearchInputRef.current;
        if (node && typeof node.focus === 'function') {
            node.focus();
        }
    };

    const handleExcludedEpicSearchChange = (value) => {
        setExcludedEpicSearchQuery(value);
        setExcludedEpicSearchOpen(true);
        setExcludedEpicSearchIndex(0);
    };

    const handleExcludedEpicSearchFocus = () => {
        setExcludedEpicSearchOpen(true);
    };

    const handleExcludedEpicSearchBlur = () => {
        window.setTimeout(() => {
            setExcludedEpicSearchOpen(false);
        }, 120);
    };

    const handleAdHocEpicSearchChange = (value) => {
        setAdHocEpicSearchQuery(value);
        setAdHocEpicSearchOpen(true);
        setAdHocEpicSearchIndex(0);
    };

    const handleAdHocEpicSearchFocus = () => {
        setAdHocEpicSearchOpen(true);
    };

    const handleAdHocEpicSearchBlur = () => {
        window.setTimeout(() => {
            setAdHocEpicSearchOpen(false);
        }, 120);
    };

    const exportGroupsConfig = async () => {
        setGroupDraftError('');
        try {
            const selectedGroupId = String(activeGroupDraftId || '').trim();
            if (!selectedGroupId) {
                throw new Error('Select a group before exporting.');
            }
            const response = await requestGroupsConfig(BACKEND_URL);
            if (!response.ok) {
                throw new Error(`Export failed (${response.status})`);
            }
            const source = normalizeGroupsConfig(await response.json());
            const selectedGroup = source.groups.find(group => group.id === selectedGroupId);
            if (!selectedGroup) {
                throw new Error('Save the selected group before exporting.');
            }
            const payload = {
                version: GROUPS_CONFIG_VERSION,
                group: selectedGroup,
            };
            const json = JSON.stringify(payload, null, 2);
            const objectUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const link = document.createElement('a');
            try {
                link.href = objectUrl;
                const safeGroupId = selectedGroupId.replace(/[^a-z0-9_-]+/gi, '-');
                link.download = `group-${safeGroupId || 'selected'}.json`;
                document.body.appendChild(link);
                link.click();
            } finally {
                link.remove();
                URL.revokeObjectURL(objectUrl);
            }
        } catch (err) {
            setGroupDraftError(err.message || 'Failed to export groups configuration.');
        }
    };

    const importGroupsConfig = () => {
        if (!groupImportText.trim()) return;
        try {
            const selectedGroupId = String(activeGroupDraftId || '').trim();
            const selectedGroup = (groupDraft?.groups || []).find(group => group.id === selectedGroupId);
            if (!selectedGroup) {
                throw new Error('Select a group before importing.');
            }
            const parsed = JSON.parse(groupImportText);
            let importedGroup = parsed?.group;
            if (!importedGroup && Array.isArray(parsed?.groups)) {
                importedGroup = parsed.groups.find(group => String(group?.id || '').trim() === selectedGroupId);
                if (!importedGroup && parsed.groups.length === 1) {
                    [importedGroup] = parsed.groups;
                }
            }
            if (!importedGroup || typeof importedGroup !== 'object') {
                throw new Error('Imported JSON must contain one group or a group matching the selected group.');
            }
            const teamLabelsError = validateImportedTeamLabels(importedGroup.teamLabels);
            if (teamLabelsError) {
                throw new Error(teamLabelsError);
            }
            const normalized = normalizeGroupsConfig({
                version: parsed?.version || groupDraft?.version || GROUPS_CONFIG_VERSION,
                groups: [importedGroup],
            });
            if (!normalized.groups.length) {
                throw new Error('Imported config has no valid group.');
            }
            const importedSettings = normalized.groups[0];
            handleGroupDraftChange(prev => ({
                ...prev,
                groups: (prev.groups || []).map(group => (
                    group.id === selectedGroupId
                        ? { ...importedSettings, id: group.id, name: group.name }
                        : group
                )),
            }));
            setGroupDraftError('');
            setGroupImportText('');
            setShowGroupImport(false);
        } catch (err) {
            setGroupDraftError(err.message || 'Invalid JSON.');
        }
    };

    const configuredTeamIds = React.useMemo(() => (
        Array.from(new Set((groupDraft?.groups || []).flatMap(group => group.teamIds || [])))
    ), [groupDraft]);
    const teamNameDirectory = React.useMemo(() => {
        const directory = { ...(teamCatalogState?.catalog || {}) };
        (teamNameInputs || []).forEach(team => {
            const teamId = String(team?.id || '').trim();
            const name = String(team?.name || '').trim();
            if (teamId && name && !directory[teamId]) {
                directory[teamId] = { id: teamId, name };
            }
        });
        return directory;
    }, [teamCatalogState, teamNameInputs]);
    const availableTeams = React.useMemo(() => buildTeamAvailability({
        directory: teamNameDirectory,
        sprintTeams: teamMembershipState.snapshot,
        configuredTeamIds,
        membershipReady: teamMembershipState.status === 'ready'
            || teamMembershipState.validated === true,
        generation: teamMembershipState.generation,
    }), [teamNameDirectory, teamMembershipState, configuredTeamIds]);
    const teamNameLookup = React.useMemo(() => Object.fromEntries(
        availableTeams.map(team => [team.id, team.name || team.id])
    ), [availableTeams]);

    const resolveTeamName = (teamId) => {
        return teamNameLookup[teamId] || teamId;
    };

    const activeGroupDraft = React.useMemo(() => {
        if (!groupDraft || !activeGroupDraftId) return null;
        return (groupDraft.groups || []).find(group => group.id === activeGroupDraftId) || null;
    }, [groupDraft, activeGroupDraftId]);

    const filteredGroupDrafts = React.useMemo(() => {
        const groups = groupDraft?.groups || [];
        if (firstRunConfigurationActive) return groups;
        const query = groupSearchQuery.trim().toLowerCase();
        if (!query) return groups;
        return groups.filter(group => {
            const nameMatch = String(group.name || '').toLowerCase().includes(query);
            if (nameMatch) return true;
            return (group.teamIds || []).some(teamId => {
                const teamName = String(teamNameLookup[teamId] || teamId || '').toLowerCase();
                return teamName.includes(query);
            });
        });
    }, [firstRunConfigurationActive, groupDraft, groupSearchQuery, teamNameLookup]);

    const teamCacheMeta = React.useMemo(() => {
        return teamCatalogState?.meta || {};
    }, [teamCatalogState]);

    const teamCacheLabel = React.useMemo(() => {
        const stamp = teamCacheMeta?.updatedAt ? new Date(teamCacheMeta.updatedAt) : null;
        const formatted = stamp && !Number.isNaN(stamp.getTime()) ? stamp.toLocaleString() : '';
        if (!formatted) {
            return `Teams: Not cached • ${availableTeams.length} available`;
        }
        return `Teams: Cached • ${availableTeams.length} available • Updated ${formatted}`;
    }, [teamCacheMeta, availableTeams]);
    const teamCatalogCanRefresh = Boolean(selectedSprintInfo);

    const activeTeamQuery = activeGroupDraft ? (teamSearchQuery[activeGroupDraft.id] || '') : '';
    const activeTeamResults = React.useMemo(() => {
        if (!activeGroupDraft) return [];
        return getGroupTeamSearchResults(activeGroupDraft, activeTeamQuery);
    }, [activeGroupDraft, activeTeamQuery, availableTeams, groupDraft]);
    const activeTeamResultsLimited = activeTeamResults.slice(0, 10);
    const activeTeamAvailabilityKey = activeTeamResultsLimited
        .map(team => `${team.id}:${team.canAdd ? '1' : '0'}`)
        .join('|');
    const activeTeamIndex = activeGroupDraft ? (teamSearchIndex[activeGroupDraft.id] || 0) : 0;

    // Jira autocomplete results minus the Team's already-selected aliases (client-side only).
    const getLabelSearchResults = (groupId, teamId, selectedAliases = []) => {
        const key = getLabelRowKey(groupId, teamId);
        const query = String(labelSearchQuery[key] || '').trim();
        if (query.length < 3) return [];
        const selected = new Set(selectedAliases.map(alias => alias.toLowerCase()));
        return (labelSearchResults[key] || []).filter(label => !selected.has(String(label || '').trim().toLowerCase()));
    };
    const focusLabelAddButton = (key) => {
        window.setTimeout(() => labelAddButtonRefs.current[key]?.focus(), 0);
    };
    const closeTeamLabelSearch = (key) => {
        setLabelSearchQuery(prev => ({ ...prev, [key]: '' }));
        setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
        setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
        setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
        setLabelAddOpen(prev => ({ ...prev, [key]: false }));
    };
    const selectTeamLabel = React.useCallback((groupId, teamId, label) => {
        const key = getLabelRowKey(groupId, teamId);
        const status = addTeamLabelToGroup(groupId, teamId, label);
        if (status === 'duplicate') {
            setTeamFeedback(key, 'Already added');
            return;
        }
        if (status === 'limit') {
            setTeamFeedback(key, `Limit reached (${TEAM_LABEL_ALIAS_LIMIT} max)`, 'warn');
            return;
        }
        closeTeamLabelSearch(key);
        focusLabelAddButton(key);
    }, [addTeamLabelToGroup]);
    const handleLabelSearchKeyDown = React.useCallback((groupId, teamId, event, results) => {
        const key = getLabelRowKey(groupId, teamId);
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
                selectTeamLabel(groupId, teamId, label);
            }
            return;
        }
        if (event.key === 'Escape' && labelSearchOpen[key]) {
            event.preventDefault();
            event.stopPropagation();
            setLabelSearchOpen(prev => ({ ...prev, [key]: false }));
            return;
        }
        if (event.key === 'Escape' && labelAddOpen[key]) {
            event.preventDefault();
            event.stopPropagation();
            closeTeamLabelSearch(key);
            focusLabelAddButton(key);
        }
    }, [labelSearchIndex, labelSearchOpen, labelAddOpen, selectTeamLabel]);
    const loadJiraLabels = React.useCallback(async (groupId, teamId, rawQuery) => {
        const query = String(rawQuery || '').trim();
        const key = getLabelRowKey(groupId, teamId);
        if (query.length < 3) {
            setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
            setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
            setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
            return;
        }
        const cacheKey = query.toLowerCase();
        if (labelSearchCacheRef.current[cacheKey]) {
            setLabelSearchResults(prev => ({ ...prev, [key]: labelSearchCacheRef.current[cacheKey] }));
            setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
            setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
            return;
        }
        const requestId = (labelSearchRequestIdRef.current[key] || 0) + 1;
        labelSearchRequestIdRef.current[key] = requestId;
        setLabelSearchLoading(prev => ({ ...prev, [key]: true }));
        try {
            const payload = await requestJiraLabels(BACKEND_URL, { query, limit: 20 });
            const nextResults = Array.isArray(payload.labels) ? payload.labels : [];
            labelSearchCacheRef.current[cacheKey] = nextResults;
            if (labelSearchRequestIdRef.current[key] === requestId) {
                setLabelSearchResults(prev => ({ ...prev, [key]: nextResults }));
                setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
            }
        } catch (error) {
            if (labelSearchRequestIdRef.current[key] === requestId) {
                setLabelSearchResults(prev => ({ ...prev, [key]: [] }));
                setLabelSearchIndex(prev => ({ ...prev, [key]: 0 }));
            }
        } finally {
            if (labelSearchRequestIdRef.current[key] === requestId) {
                setLabelSearchLoading(prev => ({ ...prev, [key]: false }));
            }
        }
    }, []);
    const scheduleJiraLabelSearch = React.useCallback((groupId, teamId, rawQuery) => {
        const query = String(rawQuery || '').trim();
        const key = getLabelRowKey(groupId, teamId);
        const existingTimer = labelSearchDebounceRef.current[key];
        if (existingTimer) {
            window.clearTimeout(existingTimer);
            delete labelSearchDebounceRef.current[key];
        }
        if (query.length < 3) {
            loadJiraLabels(groupId, teamId, query);
            return;
        }
        labelSearchDebounceRef.current[key] = window.setTimeout(() => {
            delete labelSearchDebounceRef.current[key];
            loadJiraLabels(groupId, teamId, query);
        }, 250);
    }, [loadJiraLabels]);

    return {
        groupsConfig,
        setGroupsConfig,
        groupsLoading,
        setGroupsLoading,
        groupsError,
        setGroupsError,
        boardGroupsReadFailed,
        setBoardGroupsReadFailed,
        acceptedGroupsConfigRef,
        groupsReadGenerationRef,
        groupsSaveReadFenceRef,
        groupWarnings,
        groupConfigSource,
        groupDraft,
        setGroupDraft,
        groupsConfigConflict,
        setGroupsConfigConflict,
        groupImportText,
        setGroupImportText,
        showGroupImport,
        setShowGroupImport,
        showGroupAdvanced,
        setShowGroupAdvanced,
        setTeamNameInputs,
        setTeamSearchQuery,
        teamSearchOpen,
        setTeamSearchOpen,
        setTeamSearchIndex,
        teamSearchFeedback,
        setTeamSearchFeedback,
        teamSearchInputRefs,
        teamChipLastRef,
        labelSearchQuery,
        setLabelSearchQuery,
        labelSearchOpen,
        setLabelSearchOpen,
        labelSearchResults,
        setLabelSearchResults,
        labelSearchLoading,
        setLabelSearchLoading,
        labelSearchIndex,
        setLabelSearchIndex,
        labelAddOpen,
        setLabelAddOpen,
        labelAddButtonRefs,
        labelSearchRequestIdRef,
        labelSearchDebounceRef,
        groupSearchQuery,
        setGroupSearchQuery,
        activeGroupDraftId,
        setActiveGroupDraftId,
        groupDraftBaselineRef,
        componentSearchQuery,
        setComponentSearchQuery,
        setComponentSearchResults,
        componentSearchOpen,
        setComponentSearchOpen,
        componentSearchIndex,
        setComponentSearchIndex,
        componentSearchLoading,
        setComponentSearchLoading,
        excludedEpicSearchQuery,
        setExcludedEpicSearchQuery,
        setExcludedEpicSearchResults,
        excludedEpicSearchOpen,
        setExcludedEpicSearchOpen,
        excludedEpicSearchIndex,
        setExcludedEpicSearchIndex,
        excludedEpicSearchLoading,
        setExcludedEpicSearchLoading,
        excludedEpicSearchInputRef,
        excludedEpicChipLastRef,
        adHocEpicSearchQuery,
        setAdHocEpicSearchResults,
        adHocEpicSearchOpen,
        adHocEpicSearchIndex,
        setAdHocEpicSearchIndex,
        adHocEpicSearchLoading,
        setAdHocEpicSearchLoading,
        adHocEpicSearchInputRef,
        adHocEpicChipLastRef,
        personalGroupPreferencesEnabled,
        groupPreferences,
        setGroupPreferences,
        visibleGroupDraftIds,
        setVisibleGroupDraftIds,
        favoriteGroupDraftId,
        setFavoriteGroupDraftId,
        setFavoriteGroupDraft,
        favoriteGroupValidationError,
        setGroupPreferencesSaving,
        groupVisibilitySaving,
        isGroupVisibilityDraftDirty,
        visibleControlGroups,
        initializeGroupPreferencesDraft,
        isGroupVisibleInControls,
        toggleGroupVisibleInControls,
        firstRunFavoriteGroupId,
        selectFirstRunFavoriteGroup,
        saveFirstRunGroupPreferences,
        firstRunSaving,
        firstRunError,
        persistGroupPreferences,
        loadGroupsConfig,
        loadTeamsFromCurrentView,
        groupDraftSignature,
        isGroupBoardDraftDirty,
        closeAllTeamSearchDropdowns,
        addGroupDraftRow,
        updateGroupDraftName,
        duplicateGroupDraft,
        updateGroupDraftBoard,
        addTeamToGroup,
        removeTeamFromGroup,
        removeTeamLabelFromGroup,
        handleTeamSearchChange,
        handleTeamSearchFocus,
        handleTeamSearchBlur,
        handleTeamSearchKeyDown,
        removeGroupDraft,
        toggleDefaultGroupDraft,
        applySavedGroupsConfig,
        filteredComponentSearchResults,
        filteredExcludedEpicSearchResults,
        filteredAdHocEpicSearchResults,
        handleComponentSearchKeyDown,
        addGroupMissingInfoComponent,
        removeGroupMissingInfoComponent,
        addGroupExcludedCapacityEpic,
        removeGroupExcludedCapacityEpic,
        addGroupAdHocCapacityEpic,
        removeGroupAdHocCapacityEpic,
        handleExcludedEpicSearchKeyDown,
        handleAdHocEpicSearchKeyDown,
        handleExcludedEpicSearchChange,
        handleExcludedEpicSearchFocus,
        handleExcludedEpicSearchBlur,
        handleAdHocEpicSearchChange,
        handleAdHocEpicSearchFocus,
        handleAdHocEpicSearchBlur,
        exportGroupsConfig,
        importGroupsConfig,
        availableTeams,
        teamNameLookup,
        resolveTeamName,
        activeGroupDraft,
        filteredGroupDrafts,
        teamCacheLabel,
        teamCatalogCanRefresh,
        activeTeamQuery,
        activeTeamResultsLimited,
        activeTeamAvailabilityKey,
        activeTeamIndex,
        getLabelSearchResults,
        closeTeamLabelSearch,
        selectTeamLabel,
        handleLabelSearchKeyDown,
        scheduleJiraLabelSearch,
    };
}

export function useTeamGroupSelectionEffect({
    activeGroupDraftId,
    firstRunConfigurationActive,
    firstRunConfigurationTargetGroupId,
    groupDraft,
    setActiveGroupDraftId,
    showGroupManage,
}) {
    useEffect(() => {
        if (!showGroupManage) return;
        if (!groupDraft) return;
        const groups = groupDraft?.groups || [];
        if (!groups.length) {
            setActiveGroupDraftId(null);
            return;
        }
        if (!activeGroupDraftId || !groups.some(group => group.id === activeGroupDraftId)) {
            if (firstRunConfigurationActive
                && firstRunConfigurationTargetGroupId
                && !groups.some(group => group.id === firstRunConfigurationTargetGroupId)) return;
            setActiveGroupDraftId(groups[0].id);
        }
    }, [showGroupManage, groupDraft, activeGroupDraftId, firstRunConfigurationActive, firstRunConfigurationTargetGroupId]);
}

export function useTeamGroupSearchEffects({
    BACKEND_URL,
    adHocEpicSearchIndex,
    adHocEpicSearchQuery,
    componentSearchIndex,
    componentSearchQuery,
    excludedEpicSearchIndex,
    excludedEpicSearchQuery,
    filteredAdHocEpicSearchResults,
    filteredComponentSearchResults,
    filteredExcludedEpicSearchResults,
    groupManageTab,
    setAdHocEpicSearchIndex,
    setAdHocEpicSearchLoading,
    setAdHocEpicSearchResults,
    setComponentSearchIndex,
    setComponentSearchLoading,
    setComponentSearchResults,
    setExcludedEpicSearchIndex,
    setExcludedEpicSearchLoading,
    setExcludedEpicSearchResults,
    showGroupManage,
}) {
    // Component search debounced fetch
    useEffect(() => {
        const query = componentSearchQuery.trim();
        if (!showGroupManage || groupManageTab !== 'teams' || !query) {
            setComponentSearchResults([]);
            setComponentSearchLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(async () => {
            setComponentSearchLoading(true);
            try {
                const response = await requestComponentSearch(BACKEND_URL, { query, signal: controller.signal });
                if (!response.ok) throw new Error(`Components search error ${response.status}`);
                const data = await response.json();
                setComponentSearchResults(data.components || []);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Failed to search components:', err);
                    setComponentSearchResults([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setComponentSearchLoading(false);
                }
            }
        }, 220);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [showGroupManage, groupManageTab, componentSearchQuery]);

    // Excluded epic search debounced fetch
    useEffect(() => {
        const query = excludedEpicSearchQuery.trim();
        if (!showGroupManage || groupManageTab !== 'teams' || !query) {
            setExcludedEpicSearchResults([]);
            setExcludedEpicSearchLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(async () => {
            setExcludedEpicSearchLoading(true);
            try {
                const response = await requestEpicSearch(BACKEND_URL, { query, signal: controller.signal });
                if (!response.ok) throw new Error(`Excluded epics search error ${response.status}`);
                const data = await response.json();
                setExcludedEpicSearchResults(data.epics || []);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Failed to search excluded epics:', err);
                    setExcludedEpicSearchResults([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setExcludedEpicSearchLoading(false);
                }
            }
        }, 220);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [showGroupManage, groupManageTab, excludedEpicSearchQuery]);

    useEffect(() => {
        const query = adHocEpicSearchQuery.trim();
        if (!showGroupManage || groupManageTab !== 'teams' || !query) {
            setAdHocEpicSearchResults([]);
            setAdHocEpicSearchLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(async () => {
            setAdHocEpicSearchLoading(true);
            try {
                const response = await requestEpicSearch(BACKEND_URL, { query, signal: controller.signal });
                if (!response.ok) throw new Error(`Ad Hoc epics search error ${response.status}`);
                const data = await response.json();
                setAdHocEpicSearchResults(data.epics || []);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Failed to search Ad Hoc epics:', err);
                    setAdHocEpicSearchResults([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setAdHocEpicSearchLoading(false);
                }
            }
        }, 220);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [showGroupManage, groupManageTab, adHocEpicSearchQuery]);

    React.useEffect(() => {
        const maxIndex = filteredComponentSearchResults.length - 1;
        if (componentSearchIndex > maxIndex) setComponentSearchIndex(0);
    }, [filteredComponentSearchResults.length]);

    React.useEffect(() => {
        const maxIndex = filteredExcludedEpicSearchResults.length - 1;
        if (excludedEpicSearchIndex > maxIndex) setExcludedEpicSearchIndex(0);
    }, [filteredExcludedEpicSearchResults.length]);

    React.useEffect(() => {
        const maxIndex = filteredAdHocEpicSearchResults.length - 1;
        if (adHocEpicSearchIndex > maxIndex) setAdHocEpicSearchIndex(0);
    }, [filteredAdHocEpicSearchResults.length]);
}

export function useTeamGroupLabelEffects({
    activeGroupDraft,
    activeTeamAvailabilityKey,
    activeTeamResultsLimited,
    labelSearchDebounceRef,
    setTeamSearchIndex,
}) {
    useEffect(() => {
        return () => {
            Object.values(labelSearchDebounceRef.current).forEach((timerId) => {
                window.clearTimeout(timerId);
            });
            labelSearchDebounceRef.current = {};
        };
    }, []);

    useEffect(() => {
        if (!activeGroupDraft) return;
        const maxIndex = activeTeamResultsLimited.length - 1;
        setTeamSearchIndex(prev => {
            const current = prev[activeGroupDraft.id] || 0;
            if (current <= maxIndex && activeTeamResultsLimited[current]?.canAdd) return prev;
            const firstEnabled = activeTeamResultsLimited.findIndex(team => team.canAdd);
            return { ...prev, [activeGroupDraft.id]: firstEnabled < 0 ? 0 : firstEnabled };
        });
    }, [activeTeamResultsLimited.length, activeTeamAvailabilityKey, activeGroupDraft]);
}
