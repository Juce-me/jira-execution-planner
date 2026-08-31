const slugifyGroupName = (name) => String(name || 'department')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'department';

const uniqueGroupIdentity = (baseName, existingGroups) => {
    const names = new Set((existingGroups || []).map(group => String(group?.name || '').trim().toLowerCase()));
    const ids = new Set((existingGroups || []).map(group => String(group?.id || '').trim()).filter(Boolean));
    let index = 1;
    while (true) {
        const name = index === 1 ? baseName : `${baseName} ${index}`;
        const id = slugifyGroupName(name);
        if (!names.has(name.toLowerCase()) && !ids.has(id)) return { id, name };
        index += 1;
    }
};

export const shouldShowFirstRunGroupSearch = (groupCount) => Number(groupCount) >= 4;

export const FIRST_RUN_CONFIGURATION_GUIDE_STEPS = ['name', 'teams', 'components', 'favorite', 'visibility'];

const normalizeCommittedSections = (sections = {}) => ({
    admin: Boolean(sections.admin),
    groups: Boolean(sections.groups),
    epm: Boolean(sections.epm),
    preference: Boolean(sections.preference),
});

export const createFirstRunConfigurationSession = (overrides = {}) => ({
    status: 'idle',
    mode: null,
    pendingGroupId: null,
    guideStep: 'name',
    guideComplete: false,
    capturedDrafts: null,
    latestNormalizedGroups: null,
    error: '',
    recoveryAction: null,
    ...overrides,
    committedSections: normalizeCommittedSections(overrides.committedSections),
});

const mergeCommittedSections = (current, next) => normalizeCommittedSections({
    ...current,
    ...Object.fromEntries(Object.entries(next || {}).filter(([, value]) => value)),
});

const hasCommittedSection = (sections) => Object.values(normalizeCommittedSections(sections)).some(Boolean);

export function firstRunConfigurationSessionReducer(state, action) {
    const current = state || createFirstRunConfigurationSession();
    switch (action?.type) {
        case 'start':
            return createFirstRunConfigurationSession({
                status: 'editing',
                mode: action.mode,
                pendingGroupId: action.pendingGroupId,
                capturedDrafts: structuredClone(action.drafts || null),
            });
        case 'set_guide_step':
            return { ...current, guideStep: action.step };
        case 'complete_guide':
            return { ...current, guideStep: 'visibility', guideComplete: true };
        case 'save_sections_started':
        case 'retry_sections':
            return { ...current, status: 'saving_sections', error: '', recoveryAction: null };
        case 'save_sections_failed': {
            const committedSections = mergeCommittedSections(current.committedSections, action.committedSections);
            const partial = hasCommittedSection(committedSections);
            return {
                ...current,
                status: partial ? 'sections_pending' : 'editing',
                committedSections,
                error: action.error || '',
                recoveryAction: partial ? 'retry_sections' : null,
            };
        }
        case 'sections_saved':
            return {
                ...current,
                status: 'preference_pending',
                committedSections: mergeCommittedSections(current.committedSections, action.committedSections),
                latestNormalizedGroups: action.normalizedGroups || current.latestNormalizedGroups,
                error: '',
                recoveryAction: 'retry_preference',
            };
        case 'preference_save_failed':
            return { ...current, status: 'preference_pending', error: action.error || '', recoveryAction: 'retry_preference' };
        case 'preference_saved':
            return {
                ...current,
                status: 'complete',
                error: '',
                recoveryAction: null,
                committedSections: mergeCommittedSections(current.committedSections, { preference: true }),
            };
        case 'rebase':
            return { ...current, latestNormalizedGroups: action.normalizedGroups || current.latestNormalizedGroups };
        case 'return_after_sections':
        case 'return_after_preference':
            return createFirstRunConfigurationSession();
        case 'cancel':
            return hasCommittedSection(current.committedSections) ? current : createFirstRunConfigurationSession();
        case 'discard':
            return current.status === 'sections_pending' ? current : createFirstRunConfigurationSession();
        default:
            return current;
    }
}

export const canAdvanceFirstRunConfigurationGuide = (step, group, groups = []) => {
    if (step === 'name') {
        const name = String(group?.name || '').trim();
        if (!name) return false;
        return !(groups || []).some(candidate => candidate?.id !== group?.id
            && String(candidate?.name || '').trim().toLowerCase() === name.toLowerCase());
    }
    if (step === 'teams') {
        return (group?.teamIds || []).some(teamId => String(teamId || '').trim());
    }
    return FIRST_RUN_CONFIGURATION_GUIDE_STEPS.includes(step);
};

export const buildPendingFirstRunGroupPreferencesDraft = (visibleGroupIds, favoriteGroupId) => {
    const favoriteId = String(favoriteGroupId || '').trim();
    const seen = new Set();
    const normalizedVisibleGroupIds = [...(visibleGroupIds || []), favoriteId]
        .map(groupId => String(groupId || '').trim())
        .filter(groupId => {
            if (!groupId || seen.has(groupId)) return false;
            seen.add(groupId);
            return true;
        });
    return {
        visibleGroupIds: normalizedVisibleGroupIds,
        favoriteGroupId: favoriteId || null,
    };
};

export const beginFirstRunGroupConfiguration = ({
    mode,
    sourceGroupId = null,
    removeTeams = false,
    removeComponents = false,
}) => ({
    mode,
    sourceGroupId,
    removeTeams: Boolean(removeTeams),
    removeComponents: Boolean(removeComponents),
});

export const buildFirstRunGroupDraft = ({
    mode,
    sourceGroup = null,
    existingGroups = [],
    removeTeams = false,
    removeComponents = false,
}) => {
    if (mode === 'create') {
        return {
            ...uniqueGroupIdentity('New Department', existingGroups),
            teamIds: [],
            missingInfoComponents: [],
            excludedCapacityEpics: [],
        };
    }
    if (mode !== 'duplicate' || !sourceGroup) return null;

    const identity = uniqueGroupIdentity(`${sourceGroup.name || 'Department'} Copy`, existingGroups);
    const draft = structuredClone(sourceGroup);
    return {
        ...draft,
        ...identity,
        ...(removeTeams ? { teamIds: [], teamLabels: {} } : {}),
        ...(removeComponents ? { missingInfoComponents: [] } : {}),
    };
};
