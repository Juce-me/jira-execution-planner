import { matchesEngEpicSearch, sortEpicGroups } from './engTaskUtils.js';
import { buildStoryRequirementId } from './alertEpicNavigation.js';

const SUPPORTED_SPRINT_STATES = new Set(['active', 'future']);

const text = value => String(value ?? '').trim();
const normalized = value => text(value).toLowerCase();

function sprintScope(sprint = {}, filters = {}) {
    return {
        groupId: text(filters.groupId ?? sprint.groupId),
        sprintId: text(sprint.id ?? sprint.sprintId),
        sprintName: text(sprint.name ?? sprint.sprintName),
        sprintState: normalized(sprint.state ?? sprint.sprintState),
    };
}

function snapshotMatches(snapshot, scope) {
    const returned = snapshot?.scope || {};
    return snapshot?.schemaVersion === 1
        && snapshot?.complete === true
        && Boolean(scope.groupId && scope.sprintId && scope.sprintName)
        && SUPPORTED_SPRINT_STATES.has(scope.sprintState)
        && text(returned.groupId) === scope.groupId
        && text(returned.sprintId) === scope.sprintId
        && text(returned.sprintName) === scope.sprintName
        && normalized(returned.sprintState) === scope.sprintState;
}

export function storyRequirementId({ groupId, sprintId, epicKey, teamId } = {}) {
    return buildStoryRequirementId({ groupId, sprintId, epicKey, teamId });
}

export function storyReadinessStatusMessage(status, navigationError = '') {
    if (navigationError) return navigationError;
    return {
        unavailable: 'Story readiness is temporarily unavailable. Jira Stories remain visible.',
        invalid_configuration: 'Story readiness configuration is incomplete. Open Settings to review the Department configuration.',
        access_denied: 'Story readiness is unavailable because Jira project access could not be confirmed.',
        scope_not_found: 'The selected Department is no longer available. Choose a valid Department.',
        invalid_scope: 'Story readiness could not validate the selected sprint.',
        scope_too_large: 'This Department is too large for the bounded Story readiness scan. Narrow the scope or contact support.',
    }[status] || '';
}

export function buildStoryReadinessAlertModel({
    selectedSprintState,
    dismissedIds = [],
    alertTargets = [],
    isFutureSprintSelected = false,
    backlogEpicKeys = new Set(),
    missingTeamEpicKeys = new Set(),
    missingLabelEpicKeys = new Set(),
    normalizeStatus = value => normalized(value),
} = {}) {
    const dismissed = new Set(dismissedIds);
    const entries = ['active', 'future'].includes(normalized(selectedSprintState))
        ? alertTargets.filter((entry) => {
            if (!entry?.id || dismissed.has(entry.id)) return false;
            const epicKey = entry.epic?.key;
            if (!epicKey || normalizeStatus(entry.epic?.status?.name) === 'postponed') return false;
            return !isFutureSprintSelected || !(
                backlogEpicKeys.has(epicKey)
                || missingTeamEpicKeys.has(epicKey)
                || missingLabelEpicKeys.has(epicKey)
            );
        })
        : [];
    const seen = new Set();
    const epics = entries.flatMap((entry) => {
        const key = entry.epic?.key;
        if (!key || seen.has(key)) return [];
        seen.add(key);
        return [entry.epic];
    });
    return {
        entries,
        epics,
        epicKeySet: new Set(alertTargets.map(entry => entry.epic?.key).filter(Boolean)),
    };
}

function canonicalInitiative(value, diagnostics, epicKey) {
    if (!value) return null;
    if (!text(value.key)) {
        diagnostics.push({ code: 'initiative_metadata_invalid', epicKey });
        return null;
    }
    return { ...value, key: text(value.key), summary: text(value.summary) || text(value.key) };
}

function mergeEpic(existing, incoming, diagnostics, epicKey) {
    const base = incoming ? { ...incoming } : {};
    const current = existing ? { ...existing } : {};
    const merged = { ...base };
    for (const [key, value] of Object.entries(current)) {
        if (value !== undefined && value !== null && value !== '') merged[key] = value;
    }
    const initiativeSource = text(current.initiative?.key) ? current.initiative : base.initiative;
    const initiative = canonicalInitiative(initiativeSource, diagnostics, epicKey);
    return { ...merged, key: epicKey, initiative };
}

function canonicalStoryGroups(groups, diagnostics) {
    const byKey = new Map();
    for (const candidate of groups || []) {
        const key = text(candidate?.key ?? candidate?.epic?.key);
        if (!key) {
            diagnostics.push({ code: 'epic_key_missing' });
            continue;
        }
        const tasks = Array.isArray(candidate.tasks) ? candidate.tasks : [];
        if (!byKey.has(key)) {
            byKey.set(key, {
                ...candidate,
                key,
                epic: mergeEpic(candidate.epic, null, diagnostics, key),
                tasks: [...tasks],
                storyPoints: Number(candidate.storyPoints) || 0,
                requirements: [],
            });
            continue;
        }
        diagnostics.push({ code: 'duplicate_epic_group', epicKey: key });
        const current = byKey.get(key);
        const seen = new Set(current.tasks.map(task => text(task?.key)).filter(Boolean));
        for (const task of tasks) {
            const taskKey = text(task?.key);
            if (!taskKey || !seen.has(taskKey)) current.tasks.push(task);
            if (taskKey) seen.add(taskKey);
        }
        current.storyPoints += Number(candidate.storyPoints) || 0;
        current.epic = mergeEpic(current.epic, candidate.epic, diagnostics, key);
    }
    return byKey;
}

function selectedTeamSet(filters) {
    const values = filters.selectedTeamIds ?? filters.selectedTeams;
    if (!Array.isArray(values) && !(values instanceof Set)) return null;
    const ids = new Set(Array.from(values).map(text).filter(value => value && value !== 'all'));
    return filters.allTeamsSelected === true || ids.size === 0 ? null : ids;
}

function projectVisible(epic, filters) {
    const projectClass = normalized(epic?.projectClass);
    if (projectClass === 'tech') return filters.showTech !== false;
    if (projectClass === 'product') return filters.showProduct !== false;
    return false;
}

function projectTrackVisible(epic, filters) {
    if (typeof filters.admitsEpicProjectTrack === 'function') return filters.admitsEpicProjectTrack(epic);
    const selection = filters.projectTracks ?? filters.projectTrack;
    if (selection == null) return true;
    const values = selection instanceof Set ? Array.from(selection) : (Array.isArray(selection) ? selection : [selection]);
    const allowed = new Set(values.map(normalized));
    const track = normalized(epic?.projectTrack);
    if (!allowed.size) return !track;
    return allowed.has(track);
}

function storyFacetsAreNeutral(filters) {
    const statusNeutral = filters.statusNeutral ?? filters.status?.isNeutral ?? !filters.statusNarrowed;
    const priorityNeutral = filters.priorityNeutral ?? filters.priority?.isNeutral ?? !filters.priorityNarrowed;
    return statusNeutral !== false && priorityNeutral !== false;
}

function requirementVisible(requirement, filters) {
    return storyFacetsAreNeutral(filters)
        && projectVisible(requirement.epic, filters)
        && projectTrackVisible(requirement.epic, filters)
        && matchesEngEpicSearch(requirement.epic, filters.searchQuery);
}

function requirementFrom(epic, team, scope) {
    const id = storyRequirementId({
        groupId: scope.groupId,
        sprintId: scope.sprintId,
        epicKey: epic.key,
        teamId: team.id,
    });
    return {
        kind: 'story_requirement',
        id,
        targetId: id,
        epicKey: epic.key,
        epic,
        team: { id: text(team.id), name: text(team.name) || text(team.id) },
        reason: text(team.reason),
        sprint: { id: scope.sprintId, name: scope.sprintName, state: scope.sprintState },
    };
}

function partitionRequirementsFirst(items, hasRequirement) {
    return [
        ...items.filter(hasRequirement),
        ...items.filter(item => !hasRequirement(item)),
    ];
}

function groupByInitiative(epicGroups, diagnostics) {
    const groups = new Map();
    const ungrouped = [];
    for (const epicGroup of epicGroups) {
        const initiative = canonicalInitiative(epicGroup.epic?.initiative, diagnostics, epicGroup.key);
        if (!initiative) {
            ungrouped.push(epicGroup);
            continue;
        }
        if (!groups.has(initiative.key)) groups.set(initiative.key, { initiative, epicGroups: [] });
        groups.get(initiative.key).epicGroups.push(epicGroup);
    }
    const result = Array.from(groups.values());
    if (ungrouped.length) result.push({ initiative: null, epicGroups: ungrouped });
    return result;
}

export function buildEngWorkHierarchy({
    mode = 'catch_up',
    sprint = {},
    storyEpicGroups = [],
    readinessSnapshot = null,
    readinessStatus = 'idle',
    filters = {},
    sort = 'priority',
    groupByInitiative: shouldGroupByInitiative = false,
} = {}) {
    const diagnostics = [];
    const scope = sprintScope(sprint, filters);
    const epicGroupsByKey = canonicalStoryGroups(storyEpicGroups, diagnostics);
    const snapshotIsCurrent = snapshotMatches(readinessSnapshot, scope);
    const teamIds = selectedTeamSet(filters);
    const allRequirements = [];
    const readinessEpicKeys = new Set();

    if (readinessSnapshot && !snapshotIsCurrent) diagnostics.push({ code: 'readiness_snapshot_not_current' });
    if (snapshotIsCurrent) {
        const readinessEpics = Array.isArray(readinessSnapshot.epics) ? readinessSnapshot.epics : [];
        if (!Array.isArray(readinessSnapshot.epics)) diagnostics.push({ code: 'readiness_epics_invalid' });
        for (const readinessEpic of readinessEpics) {
            const epicKey = text(readinessEpic?.key);
            if (!epicKey) {
                diagnostics.push({ code: 'epic_key_missing' });
                continue;
            }
            if (readinessEpicKeys.has(epicKey)) {
                diagnostics.push({ code: 'duplicate_readiness_epic', epicKey });
                continue;
            }
            readinessEpicKeys.add(epicKey);
            const projectClass = normalized(readinessEpic?.projectClass);
            if (projectClass !== 'product' && projectClass !== 'tech') {
                diagnostics.push({ code: 'project_class_invalid', epicKey });
                continue;
            }
            const existing = epicGroupsByKey.get(epicKey);
            const epic = mergeEpic(existing?.epic, readinessEpic, diagnostics, epicKey);
            const seenTeams = new Set();
            const requirements = [];
            const missingTeams = Array.isArray(readinessEpic.missingTeams) ? readinessEpic.missingTeams : [];
            if (!Array.isArray(readinessEpic.missingTeams)) diagnostics.push({ code: 'missing_teams_invalid', epicKey });
            for (const team of missingTeams) {
                const teamId = text(team?.id);
                if (!teamId || seenTeams.has(teamId)) {
                    diagnostics.push({ code: teamId ? 'duplicate_requirement' : 'requirement_team_missing', epicKey });
                    continue;
                }
                if (!['no_stories', 'selected_stories_not_actionable', 'stories_outside_sprint', 'team_uncovered'].includes(text(team?.reason))) {
                    diagnostics.push({ code: 'requirement_reason_invalid', epicKey, teamId });
                    continue;
                }
                seenTeams.add(teamId);
                if (teamIds && !teamIds.has(teamId)) continue;
                const requirement = requirementFrom(epic, team, scope);
                requirements.push(requirement);
                allRequirements.push(requirement);
            }
            const visibleRequirements = requirements.filter(requirement => requirementVisible(requirement, filters));
            if (!existing && visibleRequirements.length === 0) continue;
            const group = existing || {
                key: epicKey,
                epic,
                tasks: [],
                storyPoints: 0,
                parentSummary: null,
                requirements: [],
            };
            group.epic = epic;
            group.requirements = visibleRequirements;
            group.hasNoChildStories = requirements.length > 0
                && requirements.every(requirement => requirement.reason === 'no_stories');
            epicGroupsByKey.set(epicKey, group);
        }
    }

    let epicGroups = Array.from(epicGroupsByKey.values()).map((group) => {
        const requirements = group.requirements || [];
        const taskRows = group.tasks.map(task => ({ kind: 'story', id: text(task?.key), task }));
        const requirementRows = requirements.map(requirement => ({ ...requirement }));
        const rows = mode === 'planning'
            ? [...requirementRows, ...taskRows]
            : [...taskRows, ...requirementRows];
        return { ...group, requirements, rows };
    });
    epicGroups = sortEpicGroups(epicGroups, sort);
    if (mode === 'planning') {
        epicGroups = partitionRequirementsFirst(epicGroups, group => group.requirements.length > 0);
    }

    let initiativeGroups = shouldGroupByInitiative ? groupByInitiative(epicGroups, diagnostics) : null;
    if (mode === 'planning' && initiativeGroups) {
        initiativeGroups = partitionRequirementsFirst(
            initiativeGroups,
            group => group.epicGroups.some(epicGroup => epicGroup.requirements.length > 0),
        );
    }

    const requirements = epicGroups.flatMap(group => group.requirements);
    const realStories = epicGroups.reduce((count, group) => count + group.tasks.length, 0);
    const alertTargetById = Object.fromEntries(allRequirements.map(requirement => [requirement.id, requirement]));
    return {
        epicGroups,
        initiativeGroups,
        requirements,
        alertTargets: allRequirements,
        alertTargetById,
        counts: {
            realStories,
            requirements: requirements.length,
            visibleRows: realStories + requirements.length,
        },
        readiness: {
            status: snapshotIsCurrent ? 'ready' : readinessStatus,
            complete: snapshotIsCurrent,
            scope,
        },
        diagnostics,
    };
}
