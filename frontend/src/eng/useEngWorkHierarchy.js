import * as React from 'react';
import { buildEngWorkHierarchy } from './engWorkHierarchy.js';
export { buildStoryReadinessAlertModel, storyReadinessStatusMessage } from './engWorkHierarchy.js';

export function groupTasksByEpic(taskList = [], epicDetails = {}) {
    const grouped = {};
    taskList.forEach((task) => {
        const epicKey = task.fields.epicKey || 'NO_EPIC';
        if (!grouped[epicKey]) {
            grouped[epicKey] = {
                epic: epicDetails[epicKey] || null,
                key: epicKey,
                tasks: [],
                storyPoints: 0,
                parentSummary: task.fields.parentSummary || null,
            };
        }
        grouped[epicKey].tasks.push(task);
        const storyPoints = parseFloat(task.fields.customfield_10004 || 0);
        if (!Number.isNaN(storyPoints)) grouped[epicKey].storyPoints += storyPoints;
        if (!grouped[epicKey].parentSummary && task.fields.parentSummary) {
            grouped[epicKey].parentSummary = task.fields.parentSummary;
        }
    });
    return grouped;
}

export function useEngWorkHierarchy({
    visibleTasksForList = [],
    epicDetails = {},
    capacityTasks = [],
    readinessSnapshot = null,
    readinessStatus = 'idle',
    showPlanning = false,
    selectedSprint,
    selectedSprintName = '',
    selectedSprintState = '',
    activeGroupId,
    selectedTeams = [],
    isAllTeamsSelected = true,
    showTech = true,
    showProduct = true,
    searchQuery = '',
    statusNeutral = true,
    priorityNeutral = true,
    admitsEpicProjectTrack,
    engEpicSort = 'priority',
    groupByInitiativeChoice = null,
} = {}) {
    const groupTasks = React.useCallback(
        taskList => groupTasksByEpic(taskList, epicDetails),
        [epicDetails],
    );
    const storyEpicGroups = React.useMemo(
        () => Object.values(groupTasks(visibleTasksForList)),
        [groupTasks, visibleTasksForList],
    );
    const hasInitiativeData = React.useMemo(() => (
        capacityTasks.some((task) => {
            const epicKey = task?.fields?.epicKey;
            return Boolean(epicKey && epicDetails[epicKey]?.initiative?.key);
        }) || (readinessSnapshot?.epics || []).some(epic => Boolean(epic?.initiative?.key))
    ), [capacityTasks, epicDetails, readinessSnapshot]);
    const groupByInitiative = groupByInitiativeChoice ?? hasInitiativeData;
    const hierarchy = React.useMemo(() => buildEngWorkHierarchy({
        mode: showPlanning ? 'planning' : 'catch_up',
        sprint: {
            id: selectedSprint,
            name: selectedSprintName,
            state: selectedSprintState,
        },
        storyEpicGroups,
        readinessSnapshot,
        readinessStatus,
        filters: {
            groupId: activeGroupId,
            selectedTeamIds: selectedTeams,
            allTeamsSelected: isAllTeamsSelected,
            showTech,
            showProduct,
            searchQuery,
            statusNeutral,
            priorityNeutral,
            admitsEpicProjectTrack,
        },
        sort: engEpicSort,
        groupByInitiative,
    }), [
        showPlanning, selectedSprint, selectedSprintName, selectedSprintState, storyEpicGroups,
        readinessSnapshot, readinessStatus, activeGroupId, selectedTeams, isAllTeamsSelected,
        showTech, showProduct, searchQuery, statusNeutral, priorityNeutral, admitsEpicProjectTrack,
        engEpicSort, groupByInitiative,
    ]);
    return {
        hierarchy,
        epicGroups: hierarchy.epicGroups,
        initiativeGroups: hierarchy.initiativeGroups,
        hasInitiativeData,
        groupByInitiative,
        groupTasksByEpic: groupTasks,
    };
}
