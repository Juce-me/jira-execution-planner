export const PRIORITY_ORDER = {
    'Blocker': 0,
    'Highest': 1,
    'Critical': 2,
    'High': 3,
    'Major': 4,
    'Medium': 5,
    'Minor': 6,
    'Low': 7,
    'Trivial': 8,
    'Lowest': 9
};

export function getTaskTeamInfo(task) {
    const team = task.fields?.team;
    const teamName = task.fields?.teamName || team?.name || team?.displayName || team?.teamName || 'Unknown Team';
    const teamId = task.fields?.teamId || team?.id || team?.teamId || team?.key || teamName;
    return { id: teamId, name: teamName };
}

export function getEpicTeamInfo(epic) {
    const teamName = epic?.teamName || epic?.team?.name || epic?.team?.displayName || 'Unknown Team';
    const teamId = epic?.teamId || epic?.team?.id || teamName;
    return { id: teamId, name: teamName };
}

export function groupTasksByTeam(tasks) {
    const groups = new Map();
    (tasks || []).forEach(task => {
        const teamName = getTaskTeamInfo(task).name;
        const items = groups.get(teamName) || [];
        items.push(task);
        groups.set(teamName, items);
    });
    return Array.from(groups.entries()).map(([teamName, items]) => ({ teamName, items }));
}

export function sortTasksByPriority(tasks, priorityOrder = PRIORITY_ORDER) {
    return (tasks || []).sort((a, b) => {
        const priorityA = priorityOrder[a.fields.priority?.name] || 999;
        const priorityB = priorityOrder[b.fields.priority?.name] || 999;
        return priorityA - priorityB;
    });
}

export function filterTasksForTeamSet(tasks, activeGroupTeamIds, activeGroupTeamSet) {
    if (!activeGroupTeamIds.length) return [];
    return (tasks || []).filter(task => activeGroupTeamSet.has(getTaskTeamInfo(task).id));
}

function epicMatchesActiveGroupLabel(epic, activeGroupTeamLabels) {
    const labels = new Set(
        (epic?.labels || [])
            .map(label => String(label || '').trim().toLowerCase())
            .filter(Boolean)
    );
    if (!labels.size) return false;
    return Object.values(activeGroupTeamLabels || {}).some(label => {
        const normalized = String(label || '').trim().toLowerCase();
        return normalized && labels.has(normalized);
    });
}

export function filterEpicsInScopeForTeamSet(epicsInScope, activeGroupTeamIds, activeGroupTeamSet, activeGroupTeamLabels = {}) {
    return activeGroupTeamIds.length
        ? (epicsInScope || []).filter(epic => !epic?.teamId || activeGroupTeamSet.has(epic.teamId) || epicMatchesActiveGroupLabel(epic, activeGroupTeamLabels))
        : [];
}

export function filterEpicsByTaskEpicKeys(epics, tasks) {
    const epicKeys = new Set(
        (tasks || [])
            .map(task => task.fields?.epicKey)
            .filter(Boolean)
    );
    const filteredEpics = {};
    Object.entries(epics || {}).forEach(([key, epic]) => {
        if (epicKeys.has(key)) {
            filteredEpics[key] = epic;
        }
    });
    return filteredEpics;
}

export function resetEngFilters({
    setSearchInput,
    setSearchQuery,
    setSelectedTeams,
    setStatusFilter,
    setShowTech,
    setShowProduct,
    setShowDone,
    setShowKilled,
    setGroupByInitiative,
    hasInitiativeData,
    setBurnoutTaskFilter,
    setShowTeamDropdown,
    setShowGroupDropdown,
    setShowSprintDropdown,
    trackFilterChanged,
    visibleCountBucket
}) {
    setSearchInput('');
    setSearchQuery('');
    setSelectedTeams(['all']);
    setStatusFilter(null);
    setShowTech(true);
    setShowProduct(true);
    setShowDone(true);
    setShowKilled(false);
    setGroupByInitiative(hasInitiativeData);
    setBurnoutTaskFilter(null);
    setShowTeamDropdown(false);
    setShowGroupDropdown(false);
    setShowSprintDropdown(false);
    trackFilterChanged('clear_all', {
        feature_name: 'eng',
        source_surface: 'empty_state',
        visible_count_bucket: visibleCountBucket
    });
}

// --- Epic ordering: effective priority, status phase, Product Track ---

// Built-in status→phase rank fallback: the BSWRND prod/tech board column order
// (To Do → Analysis → Ready → Blocked → In Progress → Done) extended with the app's known
// status synonyms (mirrors the buckets in getTaskCategory()/statusColors.js). Unmapped → 999
// (sorted last). A future per-group board-import foundation can pass a board-derived map via
// sortEpicGroups(..., { phaseRanks }); this constant is the fallback.
export const DEFAULT_STATUS_PHASE_RANKS = Object.freeze({
    // 0 — To Do
    'to do': 0, 'todo': 0, 'open': 0, 'reopened': 0, 'backlog': 0, 'selected for development': 0,
    // 1 — Analysis
    'analysis': 1,
    // 2 — Ready to start
    'accepted': 2, 'awaiting validation': 2, 'postponed': 2, 'pending': 2,
    // 3 — Blocked / external
    'blocked': 3, 'external block': 3, 'on hold': 3, 'impediment': 3, 'waiting': 3, 'waiting for release': 3,
    // 4 — In progress
    'in progress': 4, 'in development': 4, 'in review': 4, 'in testing': 4, 'incomplete': 4, 'release': 4,
    // 5 — Done / terminal
    'done': 5, 'closed': 5, 'resolved': 5, 'released': 5, 'complete': 5, 'completed': 5,
    'killed': 5, 'cancelled': 5, 'canceled': 5, 'rejected': 5, "won't do": 5,
});

export const PROJECT_TRACK_EMOJI = Object.freeze({
    committed: '🔒',
    flexible: '🤷',
});

export const DEFAULT_ENG_EPIC_SORT = 'priority';

export const ENG_EPIC_SORT_OPTIONS = Object.freeze([
    { value: 'priority', label: 'Priority' },
    { value: 'status', label: 'Status' },
    { value: 'track-committed', label: 'Committed ⬇' },
    { value: 'track-flexible', label: 'Flexible ⬇' },
]);

export function normalizeEngEpicSort(value) {
    return ENG_EPIC_SORT_OPTIONS.some(o => o.value === value) ? value : DEFAULT_ENG_EPIC_SORT;
}

export function getEngEpicSortLabel(value) {
    const match = ENG_EPIC_SORT_OPTIONS.find(o => o.value === normalizeEngEpicSort(value));
    return match ? match.label : '';
}

// Most-urgent (lowest PRIORITY_ORDER rank) child-task priority. Returns { name, rank }.
// A present-but-unrecognized priority name resolves to rank 998 (still outranks a no-priority
// epic, which is { name:null, rank:999 } and sorts last).
export function getEpicEffectivePriority(epicGroup, priorityOrder = PRIORITY_ORDER) {
    let bestName = null;
    let bestRank = 999;
    const tasks = (epicGroup && epicGroup.tasks) || [];
    for (const task of tasks) {
        const name = task && task.fields && task.fields.priority && task.fields.priority.name;
        if (!name) continue;
        const rank = priorityOrder[name];
        const resolved = (rank === undefined || rank === null) ? 998 : rank;
        if (resolved < bestRank) {
            bestRank = resolved;
            bestName = name;
        }
    }
    return { name: bestName, rank: bestName === null ? 999 : bestRank };
}

function epicStatusName(epic) {
    const status = epic && epic.status;
    if (!status) return '';
    return typeof status === 'string' ? status : (status.name || '');
}

export function getStatusPhaseRank(statusName, phaseRanks = DEFAULT_STATUS_PHASE_RANKS) {
    if (!statusName) return 999;
    const key = String(statusName).trim().toLowerCase();
    const rank = phaseRanks[key];
    return (rank === undefined || rank === null) ? 999 : rank;
}

export function getProjectTrackRank(track, committedFirst = true) {
    const t = String(track || '').trim().toLowerCase();
    if (t === 'committed') return committedFirst ? 0 : 1;
    if (t === 'flexible') return committedFirst ? 1 : 0;
    return 2;
}

export function getProjectTrackEmoji(track) {
    const t = String(track || '').trim().toLowerCase();
    return PROJECT_TRACK_EMOJI[t] || '';
}

export function compareEpicGroups(a, b, sortMode, opts = {}) {
    const {
        priorityOrder = PRIORITY_ORDER,
        phaseRanks = DEFAULT_STATUS_PHASE_RANKS,
    } = opts;
    const mode = normalizeEngEpicSort(sortMode);

    // Effective priority is the primary key for every mode; equal-rank ties fall
    // through to 0 so the stable sort keeps the input (Jira-returned) order.
    const pa = getEpicEffectivePriority(a, priorityOrder).rank;
    const pb = getEpicEffectivePriority(b, priorityOrder).rank;

    if (mode === 'status') {
        const sa = getStatusPhaseRank(epicStatusName(a.epic), phaseRanks);
        const sb = getStatusPhaseRank(epicStatusName(b.epic), phaseRanks);
        if (sa !== sb) return sa - sb;
        return pa - pb;
    }
    if (mode === 'track-committed' || mode === 'track-flexible') {
        const committedFirst = mode === 'track-committed';
        const ta = getProjectTrackRank(a.epic && a.epic.projectTrack, committedFirst);
        const tb = getProjectTrackRank(b.epic && b.epic.projectTrack, committedFirst);
        if (ta !== tb) return ta - tb;
        return pa - pb;
    }
    // priority
    return pa - pb;
}

export function sortEpicGroups(groups, sortMode, opts = {}) {
    return [...(groups || [])].sort((a, b) => compareEpicGroups(a, b, sortMode, opts));
}
