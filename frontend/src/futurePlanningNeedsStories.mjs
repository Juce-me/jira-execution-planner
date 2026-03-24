function isTerminalStory(task, normalizeStatus) {
    const status = normalizeStatus(task?.fields?.status?.name);
    return status === 'done' || status === 'killed' || status === 'incomplete';
}

export function getFuturePlanningNeedsStoriesReasonText(reason) {
    if (reason === 'no_stories') return 'No stories yet for this sprint.';
    if (reason === 'only_closed_stories') return 'Only closed stories exist for this epic.';
    if (reason === 'stories_in_other_sprint') return 'Open stories exist, but not in the selected sprint.';
    return 'Needs sprint-ready stories.';
}

export function classifyFuturePlanningNeedsStories({
    epic,
    epicStories = [],
    normalizeStatus,
    isTaskInSelectedSprint
} = {}) {
    const stories = Array.isArray(epicStories) ? epicStories : [];
    const selectedActionableStories = Number(epic?.selectedActionableStories || 0);
    const openStoriesOutsideSelected = Number(epic?.openStoriesOutsideSelected || 0);
    const totalStories = Number(epic?.totalStories || 0);

    if (selectedActionableStories > 0) {
        return null;
    }
    if (openStoriesOutsideSelected > 0) {
        return { epic, reason: 'stories_in_other_sprint' };
    }
    if (totalStories > 0 && stories.length === 0) {
        return { epic, reason: 'only_closed_stories' };
    }

    if (!stories.length) {
        return { epic, reason: 'no_stories' };
    }

    if (stories.every((task) => isTerminalStory(task, normalizeStatus))) {
        return { epic, reason: 'only_closed_stories' };
    }

    const hasOpenStoryInSelectedSprint = stories.some((task) => {
        if (isTerminalStory(task, normalizeStatus)) return false;
        return isTaskInSelectedSprint(task);
    });

    if (hasOpenStoryInSelectedSprint) {
        return null;
    }

    return { epic, reason: 'stories_in_other_sprint' };
}
