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
