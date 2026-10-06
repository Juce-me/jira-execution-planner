import * as React from 'react';
import { useRef, useState } from 'react';

import { createSettingsDraftReadGuard } from './settingsConfigReadState.js';
import { makeFieldSearchResults } from './useJiraFieldPickers.js';
import {
    fetchCapacityConfig as requestCapacityConfig,
    saveCapacityConfig as requestSaveCapacityConfig,
} from '../api/configApi.js';

export function useCapacityMappingSettings({
    BACKEND_URL,
    acceptSettingsConfigBaseline,
    authMode,
    commitSharedConfigRevision,
    jiraFields,
    jiraProjects,
    settingsConfigBaselineRevision,
    settingsDraftSnapshotRef,
    sharedConfigRevisionRef,
}) {
    const [capacityProjectDraft, setCapacityProjectDraft] = useState('');
    const [capacityFieldIdDraft, setCapacityFieldIdDraft] = useState('');
    const [capacityFieldNameDraft, setCapacityFieldNameDraft] = useState('');
    const capacityBaselineRef = useRef('');
    const [capacityVerificationRequired, setCapacityVerificationRequired] = useState(false);
    const [capacityProjectSearchQuery, setCapacityProjectSearchQuery] = useState('');
    const [capacityProjectSearchOpen, setCapacityProjectSearchOpen] = useState(false);
    const [capacityProjectSearchIndex, setCapacityProjectSearchIndex] = useState(0);
    const capacityProjectSearchInputRef = useRef(null);
    const [capacityFieldSearchQuery, setCapacityFieldSearchQuery] = useState('');
    const [capacityFieldSearchOpen, setCapacityFieldSearchOpen] = useState(false);
    const [capacityFieldSearchIndex, setCapacityFieldSearchIndex] = useState(0);
    const capacityFieldSearchInputRef = useRef(null);
    const draftSnapshot = JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft });

    const isCapacityDraftDirty = React.useMemo(() => Boolean(capacityBaselineRef.current) && (
        JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft }) !== capacityBaselineRef.current
        || (capacityVerificationRequired && Boolean(capacityProjectDraft && capacityFieldIdDraft))
    ), [capacityProjectDraft, capacityFieldIdDraft, capacityFieldNameDraft, capacityVerificationRequired, settingsConfigBaselineRevision]);

    const loadCapacityConfig = async ({ authMode: requestedAuthMode = authMode, shouldApplyDraft = () => true } = {}) => {
        const preserveDraft = isCapacityDraftDirty;
        const draftReadGuard = createSettingsDraftReadGuard(() => settingsDraftSnapshotRef.current);
        try {
            const response = await requestCapacityConfig(BACKEND_URL);
            if (!response.ok) return;
            const data = await response.json();
            if (!preserveDraft && !draftReadGuard.draftChanged('capacity') && shouldApplyDraft()) {
                setCapacityProjectDraft(data.project || '');
                setCapacityFieldIdDraft(data.fieldId || '');
                setCapacityFieldNameDraft(data.fieldName || '');
            }
            acceptSettingsConfigBaseline(capacityBaselineRef, JSON.stringify({ project: data.project || '', fieldId: data.fieldId || '', fieldName: data.fieldName || '' }));
            setCapacityVerificationRequired(Boolean(
                requestedAuthMode === 'atlassian_oauth'
                && data.project
                && data.fieldId
                && data.mutationEnabled !== true
            ));
        } catch (err) {
            console.error('Failed to load capacity config:', err);
        }
    };

    const saveCapacityConfig = async () => {
        const payload = await requestSaveCapacityConfig(
            BACKEND_URL,
            { project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft },
            sharedConfigRevisionRef.current,
        );
        commitSharedConfigRevision(payload);
        acceptSettingsConfigBaseline(capacityBaselineRef, JSON.stringify({ project: capacityProjectDraft, fieldId: capacityFieldIdDraft, fieldName: capacityFieldNameDraft }));
        setCapacityVerificationRequired(false);
    };

    const resolveCapacityProjectName = (key) => {
        if (!key) return '';
        const p = jiraProjects.find(p => p.key === key);
        return p ? p.name : '';
    };

    const capacityProjectSearchResults = React.useMemo(() => {
        const query = capacityProjectSearchQuery.toLowerCase().trim();
        if (!query) return [];
        return jiraProjects.filter(p => {
            return p.key.toLowerCase().includes(query) || p.name.toLowerCase().includes(query);
        }).slice(0, 10);
    }, [capacityProjectSearchQuery, jiraProjects]);

    const handleCapacityProjectSearchKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            if (!capacityProjectSearchResults.length) return;
            event.preventDefault();
            setCapacityProjectSearchIndex(prev => Math.min(prev + 1, capacityProjectSearchResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            if (!capacityProjectSearchResults.length) return;
            event.preventDefault();
            setCapacityProjectSearchIndex(prev => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter') {
            if (!capacityProjectSearchResults.length) return;
            event.preventDefault();
            const p = capacityProjectSearchResults[capacityProjectSearchIndex] || capacityProjectSearchResults[0];
            if (p) { setCapacityProjectDraft(p.key); setCapacityProjectSearchQuery(''); setCapacityProjectSearchOpen(false); }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setCapacityProjectSearchOpen(false);
        }
    };

    // Same search and the same reported cap as the five Mapping pickers.
    const capacityFieldSearch = React.useMemo(
        () => makeFieldSearchResults(capacityFieldSearchQuery, jiraFields),
        [capacityFieldSearchQuery, jiraFields],
    );
    const capacityFieldSearchResults = capacityFieldSearch.items;
    const capacityFieldSearchHidden = capacityFieldSearch.total - capacityFieldSearch.items.length;

    const handleCapacityFieldSearchKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            if (!capacityFieldSearchResults.length) return;
            event.preventDefault();
            setCapacityFieldSearchIndex(prev => Math.min(prev + 1, capacityFieldSearchResults.length - 1));
        } else if (event.key === 'ArrowUp') {
            if (!capacityFieldSearchResults.length) return;
            event.preventDefault();
            setCapacityFieldSearchIndex(prev => Math.max(prev - 1, 0));
        } else if (event.key === 'Enter') {
            if (!capacityFieldSearchResults.length) return;
            event.preventDefault();
            const f = capacityFieldSearchResults[capacityFieldSearchIndex] || capacityFieldSearchResults[0];
            if (f) { setCapacityFieldIdDraft(f.id); setCapacityFieldNameDraft(f.name); setCapacityFieldSearchQuery(''); setCapacityFieldSearchOpen(false); }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setCapacityFieldSearchOpen(false);
        }
    };

    const applyLoaded = (sharedConfig, shouldPreserveSettingsDraft, config) => {
        const capacity = sharedConfig.capacity || {};
        if (!shouldPreserveSettingsDraft('capacity')) {
            setCapacityProjectDraft(capacity.project || '');
            setCapacityFieldIdDraft(capacity.fieldId || '');
            setCapacityFieldNameDraft(capacity.fieldName || '');
        }
        acceptSettingsConfigBaseline(capacityBaselineRef, JSON.stringify({ project: capacity.project || '', fieldId: capacity.fieldId || '', fieldName: capacity.fieldName || '' }));
        setCapacityVerificationRequired(Boolean(
            config.authMode === 'atlassian_oauth'
            && capacity.project
            && capacity.fieldId
            && config.capacityMutationEnabled !== true
        ));
    };

    return {
        capacityProjectDraft,
        setCapacityProjectDraft,
        capacityFieldIdDraft,
        setCapacityFieldIdDraft,
        capacityFieldNameDraft,
        setCapacityFieldNameDraft,
        capacityProjectSearchQuery,
        setCapacityProjectSearchQuery,
        capacityProjectSearchOpen,
        setCapacityProjectSearchOpen,
        capacityProjectSearchIndex,
        setCapacityProjectSearchIndex,
        capacityProjectSearchInputRef,
        capacityFieldSearchQuery,
        setCapacityFieldSearchQuery,
        capacityFieldSearchOpen,
        setCapacityFieldSearchOpen,
        capacityFieldSearchIndex,
        setCapacityFieldSearchIndex,
        capacityFieldSearchInputRef,
        isCapacityDraftDirty,
        loadCapacityConfig,
        saveCapacityConfig,
        resolveCapacityProjectName,
        capacityProjectSearchResults,
        handleCapacityProjectSearchKeyDown,
        capacityFieldSearchResults,
        capacityFieldSearchHidden,
        handleCapacityFieldSearchKeyDown,
        applyLoaded,
        draftSnapshot,
    };
}

export function useCapacityMappingEffects({
    capacityFieldSearchIndex,
    capacityFieldSearchResults,
    capacityProjectSearchIndex,
    capacityProjectSearchResults,
    setCapacityFieldSearchIndex,
    setCapacityProjectSearchIndex,
}) {
    React.useEffect(() => {
        if (capacityProjectSearchIndex >= capacityProjectSearchResults.length) setCapacityProjectSearchIndex(0);
    }, [capacityProjectSearchResults.length]);

    React.useEffect(() => {
        if (capacityFieldSearchIndex >= capacityFieldSearchResults.length) setCapacityFieldSearchIndex(0);
    }, [capacityFieldSearchResults.length]);
}
