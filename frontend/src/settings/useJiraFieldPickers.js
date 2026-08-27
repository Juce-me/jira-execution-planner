import * as React from 'react';
import { fetchFieldConfig as requestFieldConfig, saveFieldConfig as requestSaveFieldConfig } from '../api/configApi.js';

// --- Field picker search helpers (reuse jiraFields) ---
// Pure and exported for unit testing; also used by the five picker hooks below and by the
// capacity field picker in dashboard.jsx.
//
// A real Jira instance has hundreds of fields, so the list has to be capped — but the cap is
// reported, never silent. A picker that shows 20 of 300 matches and says nothing is a picker
// that tells an admin the field they are looking for does not exist.
export const FIELD_SEARCH_RESULT_LIMIT = 20;

export const makeFieldSearchResults = (query, fields) => {
    const q = query.toLowerCase().trim();
    const matches = q
        ? fields.filter(f => f.id.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
        : fields;
    const items = matches.slice(0, FIELD_SEARCH_RESULT_LIMIT);
    return { items, total: matches.length, truncated: matches.length > items.length };
};

export const makeFieldKeyDown = (results, indexState, setIndex, setId, setName, setQuery, setOpen) => (event) => {
    if (event.key === 'ArrowDown') {
        if (!results.length) return;
        event.preventDefault();
        setIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
        if (!results.length) return;
        event.preventDefault();
        setIndex(prev => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
        if (!results.length) return;
        event.preventDefault();
        const f = results[indexState] || results[0];
        if (f) { setId(f.id); setName(f.name); setQuery(''); setOpen(false); }
    } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
    }
};

// Generic load/save helpers for custom field pickers.
const loadFieldConfig = async (backendUrl, endpoint, setId, setName, baselineRef) => {
    try {
        const response = await requestFieldConfig(backendUrl, endpoint);
        if (!response.ok) return;
        const data = await response.json();
        setId(data.fieldId || '');
        setName(data.fieldName || '');
        baselineRef.current = JSON.stringify({ fieldId: data.fieldId || '', fieldName: data.fieldName || '' });
    } catch (err) {
        console.error(`Failed to load ${endpoint} config:`, err);
    }
};

const saveFieldConfig = async (backendUrl, endpoint, fieldId, fieldName, baselineRef, baseRevision) => {
    const payload = await requestSaveFieldConfig(backendUrl, endpoint, { fieldId, fieldName }, baseRevision);
    baselineRef.current = JSON.stringify({ fieldId, fieldName });
    return payload;
};

// Owns the whole five-picker family (sprint, parent name, story points, team, delivery owner):
// their draft/search state, dirty tracking, and load/save wiring. Extracted behaviour-identically
// from dashboard.jsx to keep that file inside its line budget — see
// docs/plans/EXEC-eng-group-board.md §6.5.7 and §14.
export function useJiraFieldPickers({ backendUrl, jiraFields }) {
    // Sprint field picker state
    const [sprintFieldIdDraft, setSprintFieldIdDraft] = React.useState('');
    const [sprintFieldNameDraft, setSprintFieldNameDraft] = React.useState('');
    const sprintFieldBaselineRef = React.useRef('');
    const [sprintFieldSearchQuery, setSprintFieldSearchQuery] = React.useState('');
    const [sprintFieldSearchOpen, setSprintFieldSearchOpen] = React.useState(false);
    const [sprintFieldSearchIndex, setSprintFieldSearchIndex] = React.useState(0);
    const sprintFieldSearchInputRef = React.useRef(null);
    // Parent Name field picker state
    const [parentNameFieldIdDraft, setParentNameFieldIdDraft] = React.useState('');
    const [parentNameFieldNameDraft, setParentNameFieldNameDraft] = React.useState('');
    const parentNameFieldBaselineRef = React.useRef('');
    const [parentNameFieldSearchQuery, setParentNameFieldSearchQuery] = React.useState('');
    const [parentNameFieldSearchOpen, setParentNameFieldSearchOpen] = React.useState(false);
    const [parentNameFieldSearchIndex, setParentNameFieldSearchIndex] = React.useState(0);
    const parentNameFieldSearchInputRef = React.useRef(null);
    // Story Points field picker state
    const [storyPointsFieldIdDraft, setStoryPointsFieldIdDraft] = React.useState('');
    const [storyPointsFieldNameDraft, setStoryPointsFieldNameDraft] = React.useState('');
    const storyPointsFieldBaselineRef = React.useRef('');
    const [storyPointsFieldSearchQuery, setStoryPointsFieldSearchQuery] = React.useState('');
    const [storyPointsFieldSearchOpen, setStoryPointsFieldSearchOpen] = React.useState(false);
    const [storyPointsFieldSearchIndex, setStoryPointsFieldSearchIndex] = React.useState(0);
    const storyPointsFieldSearchInputRef = React.useRef(null);
    // Team field picker state
    const [teamFieldIdDraft, setTeamFieldIdDraft] = React.useState('');
    const [teamFieldNameDraft, setTeamFieldNameDraft] = React.useState('');
    const teamFieldBaselineRef = React.useRef('');
    const [teamFieldSearchQuery, setTeamFieldSearchQuery] = React.useState('');
    const [teamFieldSearchOpen, setTeamFieldSearchOpen] = React.useState(false);
    const [teamFieldSearchIndex, setTeamFieldSearchIndex] = React.useState(0);
    const teamFieldSearchInputRef = React.useRef(null);
    // Delivery owner field picker state
    const [deliveryOwnerFieldIdDraft, setDeliveryOwnerFieldIdDraft] = React.useState('');
    const [deliveryOwnerFieldNameDraft, setDeliveryOwnerFieldNameDraft] = React.useState('');
    const deliveryOwnerFieldBaselineRef = React.useRef('');
    const [deliveryOwnerFieldSearchQuery, setDeliveryOwnerFieldSearchQuery] = React.useState('');
    const [deliveryOwnerFieldSearchOpen, setDeliveryOwnerFieldSearchOpen] = React.useState(false);
    const [deliveryOwnerFieldSearchIndex, setDeliveryOwnerFieldSearchIndex] = React.useState(0);
    const deliveryOwnerFieldSearchInputRef = React.useRef(null);

    const isSprintFieldDirty = React.useMemo(() => Boolean(sprintFieldBaselineRef.current) && JSON.stringify({ fieldId: sprintFieldIdDraft, fieldName: sprintFieldNameDraft }) !== sprintFieldBaselineRef.current, [sprintFieldIdDraft, sprintFieldNameDraft]);
    const isParentNameFieldDirty = React.useMemo(() => Boolean(parentNameFieldBaselineRef.current) && JSON.stringify({ fieldId: parentNameFieldIdDraft, fieldName: parentNameFieldNameDraft }) !== parentNameFieldBaselineRef.current, [parentNameFieldIdDraft, parentNameFieldNameDraft]);
    const isStoryPointsFieldDirty = React.useMemo(() => Boolean(storyPointsFieldBaselineRef.current) && JSON.stringify({ fieldId: storyPointsFieldIdDraft, fieldName: storyPointsFieldNameDraft }) !== storyPointsFieldBaselineRef.current, [storyPointsFieldIdDraft, storyPointsFieldNameDraft]);
    const isTeamFieldDirty = React.useMemo(() => Boolean(teamFieldBaselineRef.current) && JSON.stringify({ fieldId: teamFieldIdDraft, fieldName: teamFieldNameDraft }) !== teamFieldBaselineRef.current, [teamFieldIdDraft, teamFieldNameDraft]);
    const isDeliveryOwnerFieldDirty = React.useMemo(() => Boolean(deliveryOwnerFieldBaselineRef.current) && JSON.stringify({ fieldId: deliveryOwnerFieldIdDraft, fieldName: deliveryOwnerFieldNameDraft }) !== deliveryOwnerFieldBaselineRef.current, [deliveryOwnerFieldIdDraft, deliveryOwnerFieldNameDraft]);

    const loadSprintFieldConfig = () => loadFieldConfig(backendUrl, 'sprint-field', setSprintFieldIdDraft, setSprintFieldNameDraft, sprintFieldBaselineRef);
    const saveSprintFieldConfig = (baseRevision) => saveFieldConfig(backendUrl, 'sprint-field', sprintFieldIdDraft, sprintFieldNameDraft, sprintFieldBaselineRef, baseRevision);
    const loadParentNameFieldConfig = () => loadFieldConfig(backendUrl, 'parent-name-field', setParentNameFieldIdDraft, setParentNameFieldNameDraft, parentNameFieldBaselineRef);
    const saveParentNameFieldConfig = (baseRevision) => saveFieldConfig(backendUrl, 'parent-name-field', parentNameFieldIdDraft, parentNameFieldNameDraft, parentNameFieldBaselineRef, baseRevision);
    const loadStoryPointsFieldConfig = () => loadFieldConfig(backendUrl, 'story-points-field', setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft, storyPointsFieldBaselineRef);
    const saveStoryPointsFieldConfig = (baseRevision) => saveFieldConfig(backendUrl, 'story-points-field', storyPointsFieldIdDraft, storyPointsFieldNameDraft, storyPointsFieldBaselineRef, baseRevision);
    const loadTeamFieldConfig = () => loadFieldConfig(backendUrl, 'team-field', setTeamFieldIdDraft, setTeamFieldNameDraft, teamFieldBaselineRef);
    const saveTeamFieldConfig = (baseRevision) => saveFieldConfig(backendUrl, 'team-field', teamFieldIdDraft, teamFieldNameDraft, teamFieldBaselineRef, baseRevision);
    const loadDeliveryOwnerFieldConfig = () => loadFieldConfig(backendUrl, 'delivery-owner-field', setDeliveryOwnerFieldIdDraft, setDeliveryOwnerFieldNameDraft, deliveryOwnerFieldBaselineRef);
    const saveDeliveryOwnerFieldConfig = (baseRevision) => saveFieldConfig(backendUrl, 'delivery-owner-field', deliveryOwnerFieldIdDraft, deliveryOwnerFieldNameDraft, deliveryOwnerFieldBaselineRef, baseRevision);

    const seedSharedFieldConfigs = (sharedConfig = {}) => {
        const apply = (value, setId, setName, baselineRef) => {
            const normalized = { fieldId: value?.fieldId || '', fieldName: value?.fieldName || '' };
            setId(normalized.fieldId);
            setName(normalized.fieldName);
            baselineRef.current = JSON.stringify(normalized);
        };
        apply(sharedConfig.sprintField, setSprintFieldIdDraft, setSprintFieldNameDraft, sprintFieldBaselineRef);
        apply(sharedConfig.parentNameField, setParentNameFieldIdDraft, setParentNameFieldNameDraft, parentNameFieldBaselineRef);
        apply(sharedConfig.storyPointsField, setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft, storyPointsFieldBaselineRef);
        apply(sharedConfig.teamField, setTeamFieldIdDraft, setTeamFieldNameDraft, teamFieldBaselineRef);
        apply(sharedConfig.deliveryOwnerField, setDeliveryOwnerFieldIdDraft, setDeliveryOwnerFieldNameDraft, deliveryOwnerFieldBaselineRef);
    };

    const sprintFieldSearch = React.useMemo(() => makeFieldSearchResults(sprintFieldSearchQuery, jiraFields), [sprintFieldSearchQuery, jiraFields]);
    const sprintFieldSearchResults = sprintFieldSearch.items;
    const sprintFieldSearchHidden = sprintFieldSearch.total - sprintFieldSearch.items.length;
    React.useEffect(() => { if (sprintFieldSearchIndex >= sprintFieldSearchResults.length) setSprintFieldSearchIndex(0); }, [sprintFieldSearchResults.length]);
    const handleSprintFieldSearchKeyDown = makeFieldKeyDown(sprintFieldSearchResults, sprintFieldSearchIndex, setSprintFieldSearchIndex, setSprintFieldIdDraft, setSprintFieldNameDraft, setSprintFieldSearchQuery, setSprintFieldSearchOpen);

    const parentNameFieldSearch = React.useMemo(() => makeFieldSearchResults(parentNameFieldSearchQuery, jiraFields), [parentNameFieldSearchQuery, jiraFields]);
    const parentNameFieldSearchResults = parentNameFieldSearch.items;
    const parentNameFieldSearchHidden = parentNameFieldSearch.total - parentNameFieldSearch.items.length;
    React.useEffect(() => { if (parentNameFieldSearchIndex >= parentNameFieldSearchResults.length) setParentNameFieldSearchIndex(0); }, [parentNameFieldSearchResults.length]);
    const handleParentNameFieldSearchKeyDown = makeFieldKeyDown(parentNameFieldSearchResults, parentNameFieldSearchIndex, setParentNameFieldSearchIndex, setParentNameFieldIdDraft, setParentNameFieldNameDraft, setParentNameFieldSearchQuery, setParentNameFieldSearchOpen);

    const storyPointsFieldSearch = React.useMemo(() => makeFieldSearchResults(storyPointsFieldSearchQuery, jiraFields), [storyPointsFieldSearchQuery, jiraFields]);
    const storyPointsFieldSearchResults = storyPointsFieldSearch.items;
    const storyPointsFieldSearchHidden = storyPointsFieldSearch.total - storyPointsFieldSearch.items.length;
    React.useEffect(() => { if (storyPointsFieldSearchIndex >= storyPointsFieldSearchResults.length) setStoryPointsFieldSearchIndex(0); }, [storyPointsFieldSearchResults.length]);
    const handleStoryPointsFieldSearchKeyDown = makeFieldKeyDown(storyPointsFieldSearchResults, storyPointsFieldSearchIndex, setStoryPointsFieldSearchIndex, setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft, setStoryPointsFieldSearchQuery, setStoryPointsFieldSearchOpen);

    const teamFieldSearch = React.useMemo(() => makeFieldSearchResults(teamFieldSearchQuery, jiraFields), [teamFieldSearchQuery, jiraFields]);
    const teamFieldSearchResults = teamFieldSearch.items;
    const teamFieldSearchHidden = teamFieldSearch.total - teamFieldSearch.items.length;
    React.useEffect(() => { if (teamFieldSearchIndex >= teamFieldSearchResults.length) setTeamFieldSearchIndex(0); }, [teamFieldSearchResults.length]);
    const handleTeamFieldSearchKeyDown = makeFieldKeyDown(teamFieldSearchResults, teamFieldSearchIndex, setTeamFieldSearchIndex, setTeamFieldIdDraft, setTeamFieldNameDraft, setTeamFieldSearchQuery, setTeamFieldSearchOpen);

    const deliveryOwnerFieldSearch = React.useMemo(() => makeFieldSearchResults(deliveryOwnerFieldSearchQuery, jiraFields), [deliveryOwnerFieldSearchQuery, jiraFields]);
    const deliveryOwnerFieldSearchResults = deliveryOwnerFieldSearch.items;
    const deliveryOwnerFieldSearchHidden = deliveryOwnerFieldSearch.total - deliveryOwnerFieldSearch.items.length;
    React.useEffect(() => { if (deliveryOwnerFieldSearchIndex >= deliveryOwnerFieldSearchResults.length) setDeliveryOwnerFieldSearchIndex(0); }, [deliveryOwnerFieldSearchResults.length]);
    const handleDeliveryOwnerFieldSearchKeyDown = makeFieldKeyDown(deliveryOwnerFieldSearchResults, deliveryOwnerFieldSearchIndex, setDeliveryOwnerFieldSearchIndex, setDeliveryOwnerFieldIdDraft, setDeliveryOwnerFieldNameDraft, setDeliveryOwnerFieldSearchQuery, setDeliveryOwnerFieldSearchOpen);

    const loadAllFieldConfigs = () => {
        loadSprintFieldConfig();
        loadParentNameFieldConfig();
        loadStoryPointsFieldConfig();
        loadTeamFieldConfig();
        loadDeliveryOwnerFieldConfig();
    };

    const anyFieldConfigDirty = React.useMemo(
        () => isSprintFieldDirty || isParentNameFieldDirty || isStoryPointsFieldDirty || isTeamFieldDirty || isDeliveryOwnerFieldDirty,
        [isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty, isDeliveryOwnerFieldDirty]
    );

    const dirtyFieldConfigCount = React.useMemo(
        () => [isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty, isDeliveryOwnerFieldDirty].filter(Boolean).length,
        [isSprintFieldDirty, isParentNameFieldDirty, isStoryPointsFieldDirty, isTeamFieldDirty, isDeliveryOwnerFieldDirty]
    );

    return {
        sprintFieldIdDraft, setSprintFieldIdDraft, sprintFieldNameDraft, setSprintFieldNameDraft,
        sprintFieldSearchQuery, setSprintFieldSearchQuery, sprintFieldSearchOpen, setSprintFieldSearchOpen,
        sprintFieldSearchIndex, setSprintFieldSearchIndex, sprintFieldSearchInputRef, sprintFieldSearchResults, sprintFieldSearchHidden,
        handleSprintFieldSearchKeyDown, isSprintFieldDirty, saveSprintFieldConfig,

        parentNameFieldIdDraft, setParentNameFieldIdDraft, parentNameFieldNameDraft, setParentNameFieldNameDraft,
        parentNameFieldSearchQuery, setParentNameFieldSearchQuery, parentNameFieldSearchOpen, setParentNameFieldSearchOpen,
        parentNameFieldSearchIndex, setParentNameFieldSearchIndex, parentNameFieldSearchInputRef, parentNameFieldSearchResults, parentNameFieldSearchHidden,
        handleParentNameFieldSearchKeyDown, isParentNameFieldDirty, saveParentNameFieldConfig,

        storyPointsFieldIdDraft, setStoryPointsFieldIdDraft, storyPointsFieldNameDraft, setStoryPointsFieldNameDraft,
        storyPointsFieldSearchQuery, setStoryPointsFieldSearchQuery, storyPointsFieldSearchOpen, setStoryPointsFieldSearchOpen,
        storyPointsFieldSearchIndex, setStoryPointsFieldSearchIndex, storyPointsFieldSearchInputRef, storyPointsFieldSearchResults, storyPointsFieldSearchHidden,
        handleStoryPointsFieldSearchKeyDown, isStoryPointsFieldDirty, saveStoryPointsFieldConfig,

        teamFieldIdDraft, setTeamFieldIdDraft, teamFieldNameDraft, setTeamFieldNameDraft,
        teamFieldSearchQuery, setTeamFieldSearchQuery, teamFieldSearchOpen, setTeamFieldSearchOpen,
        teamFieldSearchIndex, setTeamFieldSearchIndex, teamFieldSearchInputRef, teamFieldSearchResults, teamFieldSearchHidden,
        handleTeamFieldSearchKeyDown, isTeamFieldDirty, saveTeamFieldConfig,

        deliveryOwnerFieldIdDraft, setDeliveryOwnerFieldIdDraft, deliveryOwnerFieldNameDraft, setDeliveryOwnerFieldNameDraft,
        deliveryOwnerFieldSearchQuery, setDeliveryOwnerFieldSearchQuery, deliveryOwnerFieldSearchOpen, setDeliveryOwnerFieldSearchOpen,
        deliveryOwnerFieldSearchIndex, setDeliveryOwnerFieldSearchIndex, deliveryOwnerFieldSearchInputRef, deliveryOwnerFieldSearchResults, deliveryOwnerFieldSearchHidden,
        handleDeliveryOwnerFieldSearchKeyDown, isDeliveryOwnerFieldDirty, saveDeliveryOwnerFieldConfig,

        loadAllFieldConfigs, seedSharedFieldConfigs, anyFieldConfigDirty, dirtyFieldConfigCount,
    };
}
