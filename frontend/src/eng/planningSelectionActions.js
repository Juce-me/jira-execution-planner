import {
    PLANNING_SELECTION_MODE_DEFAULT_ALL,
    PLANNING_SELECTION_MODE_MANUAL,
    resolvePlanningSelectionState,
    savePlanningState
} from '../planningSelectionState.mjs';
import { sanitizeSelectedTeamsForScope } from '../teamSelectionUtils.mjs';

export const selectedTaskMapFromKeys = (keys) => {
    const next = {};
    (keys || []).forEach((key) => {
        const normalizedKey = String(key || '').trim();
        if (normalizedKey) next[normalizedKey] = true;
    });
    return next;
};

export const selectedTaskKeysFromMap = (selectedTasks, validTaskKeySet = null) => Object.keys(selectedTasks || {})
    .filter(key => selectedTasks[key] && (!validTaskKeySet || validTaskKeySet.has(key)))
    .sort();

export function resolvePlanningSelectionForDashboard({
    selectedTasks,
    selectedTeams,
    planningSelectionMode,
    isFutureSprintSelected,
    selectionTasks,
    teamOptions,
    activeGroupTeamIds
} = {}) {
    const validTaskKeySet = new Set((selectionTasks || []).map(task => String(task?.key || '').trim()).filter(Boolean));
    const validTeamIds = (teamOptions || []).map(team => String(team?.id || '').trim()).filter(id => id && id !== 'all');
    const resolvedPlanningState = resolvePlanningSelectionState({
        hasStoredState: true,
        storedState: {
            selectedTaskKeys: selectedTaskKeysFromMap(selectedTasks, validTaskKeySet),
            selectedTeams,
            selectionMode: planningSelectionMode
        },
        isFutureSprint: isFutureSprintSelected,
        validTaskKeys: validTaskKeySet,
        validTeamIds: new Set(validTeamIds)
    });
    return {
        validTaskKeySet,
        nextSelectedTaskKeys: resolvedPlanningState.selectedTaskKeys,
        nextSelectionMode: resolvedPlanningState.selectionMode,
        nextSelectedTeams: sanitizeSelectedTeamsForScope(resolvedPlanningState.selectedTeams, {
            activeGroupTeamIds,
            availableTeamIds: validTeamIds
        })
    };
}

export function persistPlanningSelectionState({
    storage,
    scopeKey,
    selectedTasks,
    selectionMode,
    selectedTeams,
    normalizeSelectedTeams
} = {}) {
    if (!scopeKey) return;
    savePlanningState(storage, scopeKey, {
        selectedTaskKeys: selectedTaskKeysFromMap(selectedTasks),
        selectedTeams: normalizeSelectedTeams(selectedTeams),
        selectionMode
    });
}

export function toggleTaskSelectionMap(selectedTasks, taskKey) {
    const next = { ...(selectedTasks || {}) };
    if (next[taskKey]) {
        delete next[taskKey];
    } else {
        next[taskKey] = true;
    }
    return next;
}

export function selectAllVisiblePlanningTasksMap(visibleTasksForList) {
    const next = {};
    (visibleTasksForList || []).forEach(task => {
        if (task?.key) next[task.key] = true;
    });
    return next;
}

export function selectPlanningTasksByStatusMap(selectionTasks, statuses, normalizeStatus) {
    const allowed = new Set((statuses || []).map(normalizeStatus));
    const next = {};
    (selectionTasks || []).forEach(task => {
        if (allowed.has(normalizeStatus(task.fields.status?.name))) next[task.key] = true;
    });
    return next;
}

export function includePlanningTasksByStatusMap(selectedTasks, selectionTasks, statuses, normalizeStatus) {
    const next = { ...(selectedTasks || {}) };
    const allowed = new Set((statuses || []).map(normalizeStatus));
    (selectionTasks || []).forEach(task => {
        if (allowed.has(normalizeStatus(task.fields.status?.name))) next[task.key] = true;
    });
    return next;
}

export function toggleIncludeByStatusMap(selectedTasks, selectionTasks, statuses, normalizeStatus) {
    const next = { ...(selectedTasks || {}) };
    const allowed = new Set((statuses || []).map(normalizeStatus));
    const matching = (selectionTasks || []).filter(task => allowed.has(normalizeStatus(task.fields.status?.name)));
    const allSelected = matching.length > 0 && matching.every(task => selectedTasks?.[task.key]);
    matching.forEach(task => {
        if (allSelected) {
            delete next[task.key];
        } else {
            next[task.key] = true;
        }
    });
    return { next, allSelected };
}

export function createPlanningSelectionHandlers({
    storage,
    planningScopeKey,
    selectedTasks,
    selectedTeams,
    selectionTasks,
    visibleTasksForList,
    isFutureSprintSelected,
    normalizeStatus,
    normalizeSelectedTeams,
    setPlanningSelectionMode,
    setCanUndoPlanningSelection,
    setSelectedTasks,
    trackPlanningSelection,
    planningLoadedSelectionRef
} = {}) {
    const savePlanningSelection = (nextSelectedTasks, selectionMode, nextSelectedTeams = selectedTeams) =>
        persistPlanningSelectionState({ storage, scopeKey: planningScopeKey, selectedTasks: nextSelectedTasks, selectionMode, selectedTeams: nextSelectedTeams, normalizeSelectedTeams });
    const markPlanningBulkSelectionChanged = () => {
        if (planningLoadedSelectionRef.current?.scopeKey === planningScopeKey) {
            setCanUndoPlanningSelection(true);
        }
    };
    return {
        toggleTaskSelection(taskKey) {
            const newSelected = toggleTaskSelectionMap(selectedTasks, taskKey);
            setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
            savePlanningSelection(newSelected, PLANNING_SELECTION_MODE_MANUAL);
            setSelectedTasks(newSelected);
            trackPlanningSelection('toggle_task', newSelected, selectionTasks);
        },
        clearSelectedTasks() {
            markPlanningBulkSelectionChanged();
            setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
            savePlanningSelection({}, PLANNING_SELECTION_MODE_MANUAL);
            setSelectedTasks({});
            trackPlanningSelection('clear_selection', {}, selectionTasks);
        },
        selectAllVisiblePlanningTasks() {
            markPlanningBulkSelectionChanged();
            const next = selectAllVisiblePlanningTasksMap(visibleTasksForList);
            const nextMode = isFutureSprintSelected ? PLANNING_SELECTION_MODE_DEFAULT_ALL : PLANNING_SELECTION_MODE_MANUAL;
            setPlanningSelectionMode(nextMode);
            savePlanningSelection(next, nextMode);
            setSelectedTasks(next);
            trackPlanningSelection('select_all_visible', next, selectionTasks);
        },
        selectPlanningTasksByStatus(statuses) {
            const next = selectPlanningTasksByStatusMap(selectionTasks, statuses, normalizeStatus);
            markPlanningBulkSelectionChanged();
            setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
            savePlanningSelection(next, PLANNING_SELECTION_MODE_MANUAL);
            setSelectedTasks(next);
            trackPlanningSelection('select_status', next, selectionTasks);
        },
        includePlanningTasksByStatus(statuses) {
            setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
            setSelectedTasks(prev => {
                const next = includePlanningTasksByStatusMap(prev, selectionTasks, statuses, normalizeStatus);
                savePlanningSelection(next, PLANNING_SELECTION_MODE_MANUAL);
                return next;
            });
        },
        toggleIncludeByStatus(statuses) {
            const { next, allSelected } = toggleIncludeByStatusMap(selectedTasks, selectionTasks, statuses, normalizeStatus);
            markPlanningBulkSelectionChanged();
            setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
            savePlanningSelection(next, PLANNING_SELECTION_MODE_MANUAL);
            setSelectedTasks(next);
            trackPlanningSelection(allSelected ? 'exclude_status' : 'include_status', next, selectionTasks);
        },
        undoPlanningSelectionChange() {
            const baseline = planningLoadedSelectionRef.current;
            if (!baseline || baseline.scopeKey !== planningScopeKey) return;
            const nextSelectedTasks = baseline.selectedTasks || {};
            const nextSelectionMode = baseline.selectionMode || PLANNING_SELECTION_MODE_MANUAL;
            setSelectedTasks(nextSelectedTasks);
            setPlanningSelectionMode(nextSelectionMode);
            savePlanningSelection(nextSelectedTasks, nextSelectionMode);
            setCanUndoPlanningSelection(false);
            trackPlanningSelection('undo_selection', nextSelectedTasks, selectionTasks);
        }
    };
}
