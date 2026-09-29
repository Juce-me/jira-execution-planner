import { matchesEngEpicSearch, matchesEngTaskSearch } from './engTaskUtils.js';

function uniqueEpicsFromRequirements(entries) {
    const seen = new Set();
    return entries.flatMap((entry) => {
        const epic = entry?.epic;
        if (!epic?.key || seen.has(epic.key)) return [];
        seen.add(epic.key);
        return [epic];
    });
}

export function filterEngAlertCollections(collections, query, epicDetails = {}, {
    visibleTaskKeys = null,
    matchesEpicFilters = null,
} = {}) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const hasTaskFilter = visibleTaskKeys instanceof Set;
    if (!normalizedQuery && !hasTaskFilter && matchesEpicFilters == null) return collections;

    const matchesTask = task => (
        (!hasTaskFilter || visibleTaskKeys.has(String(task?.key || '')))
        && matchesEngTaskSearch(task, normalizedQuery, epicDetails)
    );
    const matchesEpic = epic => (
        (!matchesEpicFilters || matchesEpicFilters(epic))
        && matchesEngEpicSearch(epic, normalizedQuery)
    );
    const needsStoriesEntries = (collections.needsStoriesEntries || [])
        .filter(entry => matchesEpic(entry?.epic));

    return {
        ...collections,
        consolidatedMissingStories: (collections.consolidatedMissingStories || [])
            .filter(item => matchesTask(item?.task)),
        blockedTasks: (collections.blockedTasks || []).filter(matchesTask),
        postponedTasks: (collections.postponedTasks || []).filter(matchesTask),
        futureRoutedEpics: (collections.futureRoutedEpics || []).filter(matchesEpic),
        backlogEpics: (collections.backlogEpics || []).filter(matchesEpic),
        missingTeamEpics: (collections.missingTeamEpics || []).filter(matchesEpic),
        missingLabelEpics: (collections.missingLabelEpics || []).filter(matchesEpic),
        needsStoriesEntries,
        needsStoriesEpics: uniqueEpicsFromRequirements(needsStoriesEntries),
        waitingForStoriesEpics: (collections.waitingForStoriesEpics || []).filter(matchesEpic),
        emptyEpicsForAlert: (collections.emptyEpicsForAlert || []).filter(matchesEpic),
        doneStoryEpics: (collections.doneStoryEpics || []).filter(matchesEpic),
    };
}
