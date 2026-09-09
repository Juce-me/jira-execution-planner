// Pure adapter between the strict Board frame owner and the existing Board presentation model.
// Wire identity and membership stay authoritative here; presentation-only saved settings are
// joined by stable column id. No fetch, React state, capability decision or legacy fallback lives
// in this module.

import { buildBoardColumns, UNMAPPED_COLUMN_ID, UNCONFIGURED_COLUMN_ID } from './engBoardColumns.js';

function adaptColumn(column, savedById) {
    const saved = savedById.get(column.id) || {};
    return {
        id: column.id,
        name: column.name,
        colour: column.color,
        statuses: (column.statusNames || []).slice(),
        terminal: Boolean(column.terminal),
        star: Boolean(saved.star),
        min: saved.min ?? null,
        max: saved.max ?? null,
        isUnmapped: column.id === UNMAPPED_COLUMN_ID,
        isUnconfigured: column.id === UNCONFIGURED_COLUMN_ID,
    };
}

export function adaptStrictBoardChild(child, patch = null) {
    const current = patch ? { ...child, ...patch } : child;
    return {
        key: current.key,
        projectClassification: current.projectClassification,
        fields: {
            epicKey: current.epicKey,
            summary: current.summary,
            status: current.status,
            priority: current.priority,
            issuetype: current.issueType,
            assignee: current.assignee,
            updated: current.updated,
            customfield_10004: current.storyPoints,
            team: current.team,
            teamId: current.team?.id || '',
            teamName: current.team?.name || '',
            project: current.project,
            sprintIds: (current.sprintIds || []).slice(),
        },
    };
}

function adaptEpic(epic) {
    const parentType = String(epic.parent?.issueType?.name || '').trim().toLowerCase();
    return {
        ...epic,
        initiative: parentType === 'initiative'
            ? { key: epic.parent.key, summary: epic.parent.summary }
            : null,
    };
}

function provisionalMembership(columns, epics) {
    const result = Object.fromEntries(columns.map((column) => [column.id, []]));
    Object.values(epics).forEach((epic) => {
        if (Object.prototype.hasOwnProperty.call(result, epic.columnId)) result[epic.columnId].push(epic.key);
    });
    return result;
}

export function buildStrictEngBoardViewModel(
    displayData = {}, { savedBoard = null, issuePatchesByKey = {} } = {},
) {
    const wireColumns = displayData.columns || [];
    const savedById = new Map((savedBoard?.columns || []).map((column) => [column.id, column]));
    const columnConfigs = wireColumns.map((column) => adaptColumn(column, savedById));
    const epicsByKey = {
        ...(displayData.candidateEpicsByKey || {}),
        ...(displayData.epicsByKey || {}),
    };
    const childrenByEpic = {};
    Object.values(displayData.childrenByKey || {}).forEach((child) => {
        if (!childrenByEpic[child.epicKey]) childrenByEpic[child.epicKey] = [];
        childrenByEpic[child.epicKey].push(adaptStrictBoardChild(child, issuePatchesByKey[child.key]));
    });
    const epicGroups = Object.values(epicsByKey).map((epic) => {
        const tasks = childrenByEpic[epic.key] || [];
        return {
            key: epic.key,
            epic: adaptEpic({ ...epic, ...(issuePatchesByKey[epic.key] || {}) }),
            tasks,
            storyPoints: tasks.reduce(
                (total, task) => total + (Number(task.fields.customfield_10004) || 0),
                0,
            ),
            parentSummary: epic.parent?.summary || null,
        };
    });
    const derivedMembership = provisionalMembership(wireColumns, epicsByKey);
    const explicitMembership = displayData.columnEpicKeys || {};
    const columnEpicKeys = Object.fromEntries(wireColumns.map((column) => [
        column.id,
        Object.prototype.hasOwnProperty.call(explicitMembership, column.id)
            ? explicitMembership[column.id].slice()
            : derivedMembership[column.id],
    ]));

    return {
        columns: buildBoardColumns({ columns: columnConfigs, epicGroups, columnEpicKeys }),
        epicGroups,
        columnEpicKeys,
        progressByColumn: displayData.progressByColumn || {},
        columnErrors: displayData.columnErrors || {},
        membershipAuthoritative: Boolean(displayData.membershipAuthoritative),
        childrenAuthoritative: Boolean(displayData.childrenAuthoritative),
        authoritative: Boolean(displayData.membershipAuthoritative && displayData.childrenAuthoritative),
        stale: Boolean(displayData.stale),
    };
}
