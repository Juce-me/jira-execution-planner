const normalizeTeam = (value, fallbackId = '') => {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || fallbackId || '').trim();
    if (!id) return null;
    return {
        id,
        name: String(value.name || '').trim(),
        generation: value.generation,
    };
};

export function isTeamMembershipCurrent(membership, current) {
    if (membership?.validated !== true || !current) return false;
    return ['generation', 'modalGeneration', 'sprintId', 'identity', 'browserContextId', 'scopeDigest']
        .every(key => String(membership?.[key] ?? '') === String(current?.[key] ?? ''));
}

export function buildTeamMembershipOwnerKey({ sprintId, modalGeneration, requestGeneration }) {
    return JSON.stringify([
        String(sprintId || ''),
        Number(modalGeneration) || 0,
        Number(requestGeneration) || 0,
    ]);
}

export function shouldForceAfterOrdinaryTeamRead({ lifecycleCurrent, pendingAttemptObserved }) {
    return lifecycleCurrent === true && pendingAttemptObserved !== true;
}

export function shouldRetainTeamMembershipAfterFailure({ membership, failureCode = '', failureCache = null }) {
    if (
        membership?.validated !== true
        || failureCode === 'catalog_identity_changed'
        || failureCode === 'team_catalog_identity_changed'
    ) return false;
    if (!failureCache) return true;
    return ['identity', 'browserContextId', 'scopeDigest']
        .every(key => String(membership?.[key] ?? '') === String(failureCache?.[key] ?? ''));
}

export function buildTeamAvailability({
    directory = {},
    sprintTeams = [],
    configuredTeamIds = [],
    membershipReady = false,
    generation = null,
} = {}) {
    const names = new Map();
    const ids = new Set();
    Object.entries(directory || {}).forEach(([directoryId, value]) => {
        const team = normalizeTeam(value, directoryId);
        if (!team) return;
        ids.add(team.id);
        if (team.name) names.set(team.id, team.name);
    });

    const members = new Set();
    (sprintTeams || []).forEach(value => {
        const team = normalizeTeam(value);
        if (!team) return;
        if (generation != null && team.generation != null && team.generation !== generation) return;
        ids.add(team.id);
        members.add(team.id);
        if (team.name) names.set(team.id, team.name);
    });

    (configuredTeamIds || []).forEach(value => {
        const id = String(value || '').trim();
        if (id) ids.add(id);
    });

    return Array.from(ids, id => {
        const availableInSprint = membershipReady ? members.has(id) : null;
        return {
            id,
            name: names.get(id) || id,
            availableInSprint,
            canAdd: availableInSprint === true,
        };
    }).sort((left, right) => (
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        || left.id.localeCompare(right.id)
    ));
}
