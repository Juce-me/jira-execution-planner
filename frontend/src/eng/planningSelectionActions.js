export const selectedTaskKeysFromMap = (selectedTasks, validTaskKeySet = null) => Object.keys(selectedTasks || {})
    .filter(key => selectedTasks[key] && (!validTaskKeySet || validTaskKeySet.has(key)))
    .sort();

// This adapter owns labels/analytics only. Immutable IDs and all draft state belong to the review controller.
export function createPlanningSelectionHandlers({ controller, selectionTasks = [], visibleTasksForList = [], normalizeStatus, trackPlanningSelection } = {}) {
    const ids = tasks => [...new Set(tasks.map(task => String(task?.id ?? task?.issueId ?? '')).filter(id => /^[1-9][0-9]*$/.test(id)))];
    const selectedKeys = () => selectedTaskKeysFromMap(controller.getSelectedTasks()).join('|');
    const act = (action, tasks, included) => {
        const before = selectedKeys();
        if (included) controller.includeShown(ids(tasks));
        else controller.removeShown(ids(tasks));
        if (before !== selectedKeys()) trackPlanningSelection?.(action, controller.getSelectedTasks(), selectionTasks);
    };
    const matching = statuses => {
        const allowed = new Set(statuses.map(normalizeStatus));
        return visibleTasksForList.filter(task => allowed.has(normalizeStatus(task.fields?.status?.name)));
    };
    return {
        toggleTaskSelection(taskKey) {
            const task = visibleTasksForList.find(candidate => candidate.key === taskKey);
            if (task) act('toggle_task', [task], !controller.getSelectedTasks()[taskKey]);
        },
        selectPlanningReviewStories(stories, included) {
            const matchingKeys = new Set(visibleTasksForList.map(task => task.key));
            act('select_epic_visible', stories.filter(task => matchingKeys.has(task.key)), included);
        },
        clearSelectedTasks() { act('clear_selection', visibleTasksForList, false); },
        selectAllVisiblePlanningTasks() { act('select_all_visible', visibleTasksForList, true); },
        selectPlanningTasksByStatus(statuses) { act('select_status', matching(statuses), true); },
        includePlanningTasksByStatus(statuses) { act('include_status', matching(statuses), true); },
        removePlanningTasksByStatus(statuses) { act('exclude_status', matching(statuses), false); },
        toggleIncludeByStatus(statuses) {
            const tasks = matching(statuses), selected = controller.getSelectedTasks();
            const included = !(tasks.length && tasks.every(task => selected[task.key]));
            act(included ? 'include_status' : 'exclude_status', tasks, included);
        },
        undoPlanningSelectionChange() {
            if (controller.undoInclusion()) trackPlanningSelection?.('undo_selection', controller.getSelectedTasks(), selectionTasks);
        },
    };
}
