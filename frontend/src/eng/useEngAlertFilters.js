import * as React from 'react';
import { filterEngAlertCollections } from './engAlertFilters.js';

function buildAlertKeySets(collections) {
    return {
        missingAlertKeySet: new Set(collections.consolidatedMissingStories.map(item => item.task?.key).filter(Boolean)),
        blockedAlertKeySet: new Set(collections.blockedTasks.map(task => task.key).filter(Boolean)),
        postponedAlertKeySet: new Set([
            ...collections.postponedTasks.map(task => task.key),
            ...collections.futureRoutedEpics.map(epic => epic.key),
        ].filter(Boolean)),
        backlogAlertKeySet: new Set(collections.backlogEpics.map(epic => epic.key).filter(Boolean)),
        needsStoriesAlertKeySet: new Set(collections.needsStoriesEpics.map(epic => epic.key).filter(Boolean)),
        waitingAlertKeySet: new Set(collections.waitingForStoriesEpics.map(epic => epic.key).filter(Boolean)),
        emptyAlertKeySet: new Set(collections.emptyEpicsForAlert.map(epic => epic.key).filter(Boolean)),
        doneAlertKeySet: new Set(collections.doneStoryEpics.map(epic => epic.key).filter(Boolean)),
    };
}

function buildAlertCounts(collections) {
    const alertCounts = {
        missing: collections.consolidatedMissingStories.length,
        blocked: collections.blockedTasks.length,
        followup: collections.postponedTasks.length + collections.futureRoutedEpics.length,
        backlog: collections.backlogEpics.length,
        missingTeam: collections.missingTeamEpics.length,
        missingLabels: collections.missingLabelEpics.length,
        needsStories: collections.needsStoriesEpics.length,
        waiting: collections.waitingForStoriesEpics.length,
        empty: collections.emptyEpicsForAlert.length,
        done: collections.doneStoryEpics.length,
    };
    const alertItemCount = Object.values(alertCounts).reduce((total, count) => total + count, 0);
    return { alertCounts, alertItemCount };
}

export function useEngAlertFilters({
    collections, visibleTasks, searchQuery, epicDetails, filters, techProjectKeys,
    focusedFilterActive,
}) {
    const {
        consolidatedMissingStories, blockedTasks, postponedTasks, futureRoutedEpics, backlogEpics,
        missingTeamEpics, missingLabelEpics, needsStoriesEntries, needsStoriesEpics,
        waitingForStoriesEpics, emptyEpicsForAlert, doneStoryEpics,
    } = collections;
    const visibleTaskKeys = React.useMemo(
        () => new Set(visibleTasks.map(task => String(task?.key || '')).filter(Boolean)),
        [visibleTasks]
    );
    const visibleEpicKeys = React.useMemo(
        () => new Set(visibleTasks.map(task => String(task?.fields?.epicKey || '')).filter(Boolean)),
        [visibleTasks]
    );
    const matchesEpicFilters = React.useCallback((epic) => {
        const projectClass = String(epic?.projectClass || '').trim().toLowerCase();
        const projectKey = String(epic?.projectKey || epic?.key || '').split('-')[0].toUpperCase();
        const isTechEpic = projectClass === 'tech'
            || (projectClass !== 'product' && techProjectKeys.has(projectKey));
        return filters.admitsProject(isTechEpic)
            && filters.admitsEpicProjectTrack(epic)
            && filters.admitsStatus(epic?.status?.name)
            && filters.admitsPriority(epic?.priority?.name)
            && (!focusedFilterActive || visibleEpicKeys.has(String(epic?.key || '')));
    }, [filters, techProjectKeys, focusedFilterActive, visibleEpicKeys]);
    const visibleAlertCollections = React.useMemo(
        () => filterEngAlertCollections({
            consolidatedMissingStories,
            blockedTasks,
            postponedTasks,
            futureRoutedEpics,
            backlogEpics,
            missingTeamEpics,
            missingLabelEpics,
            needsStoriesEntries,
            needsStoriesEpics,
            waitingForStoriesEpics,
            emptyEpicsForAlert,
            doneStoryEpics,
        }, searchQuery, epicDetails, {
            visibleTaskKeys,
            matchesEpicFilters,
        }),
        [
            consolidatedMissingStories,
            blockedTasks,
            postponedTasks,
            futureRoutedEpics,
            backlogEpics,
            missingTeamEpics,
            missingLabelEpics,
            needsStoriesEntries,
            needsStoriesEpics,
            waitingForStoriesEpics,
            emptyEpicsForAlert,
            doneStoryEpics,
            searchQuery,
            epicDetails,
            visibleTaskKeys,
            matchesEpicFilters,
        ]
    );
    const alertKeySets = React.useMemo(
        () => buildAlertKeySets(visibleAlertCollections),
        [visibleAlertCollections]
    );
    const alertTotals = React.useMemo(
        () => buildAlertCounts(visibleAlertCollections),
        [visibleAlertCollections]
    );

    return { visibleAlertCollections, ...alertKeySets, ...alertTotals };
}
