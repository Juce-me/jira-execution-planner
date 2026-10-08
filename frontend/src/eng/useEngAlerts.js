import * as React from 'react';
import { normalizeTeamLabelAliases } from '../settings/groupConfigUtils.js';
import { epicHasSelectedSprintLabel, epicMatchesSelectedSprint, filterExplicitBacklogEpics } from '../backlogAlertSprintUtils.mjs';
import { epicHasFuturePlanningTeamLabel, epicMatchesFuturePlanningTeamSelection, getFuturePlanningEpicTeamInfos } from '../futurePlanningTeamUtils.mjs';
import { buildStoryReadinessAlertModel } from './useEngWorkHierarchy.js';
import { getEpicTeamInfo } from './engTaskUtils.js';
import { useEngAlertFilters } from './useEngAlertFilters.js';

export function useEngAlerts({
    scope,
    dismissedAlertKeys, visibleTasks, normalizeStatus, isExcludedStatus, getTeamInfo,
    missingPlanningInfoTasks, isTaskInSelectedSprint, hasStoryPoints, priorityOrder,
    activeGroupTeamLabels, resolveTeamName, tasks, alertScopeTooLarge, epicsInScope,
    isFutureSprintSelected, backlogProductEpics, backlogTechEpics, selectedSprintState,
    dismissedStoryRequirementIds, engWorkHierarchy, readyToCloseEpicsInScope, readyToCloseTasks,
    selectionTasks, visibleTasksForList, searchQuery, epicDetails, engCatchUpFilters,
    burnoutTaskFilter
}) {
    const { selectedSprint, selectedSprintInfo, isAllTeamsSelected, selectedTeamSet, teamNameById, techProjectKeys } = scope;
    const dismissedAlertSet = React.useMemo(() => new Set(dismissedAlertKeys || []), [dismissedAlertKeys]);

    const blockedTasks = visibleTasks.filter(task => {
        const status = normalizeStatus(task.fields.status?.name);
        if (!status) return false;
        if (isExcludedStatus(status)) return false;
        if (dismissedAlertSet.has(task.key)) return false;
        return status.includes('blocked');
    });

    const consolidatedMissingStories = React.useMemo(() => {
        const byKey = new Map();
        const shouldIncludeUnknownTeam = (task, missing) => {
            const teamMissing = !task?.fields?.teamId && !task?.fields?.teamName;
            if (!teamMissing) return true;
            return true;
        };

        const shouldIncludeByTeam = (task) => {
            if (isAllTeamsSelected) return true;
            const teamId = task?.fields?.teamId;
            const teamName = task?.fields?.teamName;
            if (!teamId && !teamName) {
                return true; // can't filter reliably, keep it visible
            }
            return selectedTeamSet.has(getTeamInfo(task).id);
        };

        const excluded = (task) => {
            if (!task?.key) return true;
            if (dismissedAlertSet.has(task.key)) return true;
            const status = normalizeStatus(task.fields.status?.name);
            return status === 'killed' || status === 'done' || status === 'postponed';
        };

        // Start with server-provided missing info, but only keep items in the selected sprint.
        (missingPlanningInfoTasks || []).forEach((task) => {
            if (!task?.key || excluded(task) || !shouldIncludeByTeam(task)) return;
            if (!isTaskInSelectedSprint(task)) return;
            const missing = new Set(task.fields?.missingFields || []);
            if (!shouldIncludeUnknownTeam(task, missing)) return;
            if (missing.size === 0) return;
            byKey.set(task.key, { task, missing });
        });

        // Merge client-side checks (covers missing Story Points / Epic / Team)
        visibleTasks.forEach((task) => {
            if (!task?.key || excluded(task) || !shouldIncludeByTeam(task)) return;
            const current = byKey.get(task.key) || { task, missing: new Set() };

            if (!hasStoryPoints(task)) current.missing.add('Story Points');
            if (!task.fields?.epicKey) current.missing.add('Epic');
            if (!task.fields?.teamId && !task.fields?.teamName) current.missing.add('Team');
            if (!shouldIncludeUnknownTeam(task, current.missing)) return;

            if (current.missing.size > 0) {
                // Prefer the server task object if present (may carry extra fields)
                current.task = current.task || task;
                byKey.set(task.key, current);
            }
        });

        return [...byKey.values()]
            .map(({ task, missing }) => ({ task, missingFields: [...missing] }))
            .sort((a, b) => {
                const diff = b.missingFields.length - a.missingFields.length;
                if (diff !== 0) return diff;
                const priorityA = priorityOrder[a.task.fields.priority?.name] || 999;
                const priorityB = priorityOrder[b.task.fields.priority?.name] || 999;
                if (priorityA !== priorityB) return priorityA - priorityB;
                return (a.task.fields.summary || '').localeCompare(b.task.fields.summary || '');
            });
    }, [
        missingPlanningInfoTasks,
        visibleTasks,
        isAllTeamsSelected,
        selectedTeamSet,
        dismissedAlertKeys,
        selectedSprint,
        selectedSprintInfo?.name
    ]);

    const normalizedActiveGroupTeamLabels = React.useMemo(() => {
        const entries = Object.entries(activeGroupTeamLabels || {})
            .map(([teamId, aliases]) => [String(teamId || '').trim(), normalizeTeamLabelAliases(aliases)])
            .filter(([teamId, aliases]) => teamId && aliases.length);
        return Object.fromEntries(entries);
    }, [activeGroupTeamLabels]);
    const getFuturePlanningTeamInfos = React.useCallback((epic) => {
        return getFuturePlanningEpicTeamInfos(epic, {
            selectedTeamSet,
            teamLabels: normalizedActiveGroupTeamLabels,
            resolveTeamName,
            fallbackSelectedTeamName: selectedTeamSet.size === 1 ? (teamNameById.get(Array.from(selectedTeamSet)[0]) || '') : '',
            teamNameById
        });
    }, [selectedTeamSet, normalizedActiveGroupTeamLabels, resolveTeamName, teamNameById]);
    const storiesByEpicKey = React.useMemo(() => {
        const map = new Map();
        tasks.forEach((task) => {
            const epicKey = task.fields?.epicKey;
            if (!epicKey) return;
            if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return;
            const list = map.get(epicKey) || [];
            list.push(task);
            map.set(epicKey, list);
        });
        return map;
    }, [tasks, isAllTeamsSelected, selectedTeamSet]);
    const epicMatchesPlanningSprintValue = React.useCallback((epic) => {
        return epicMatchesSelectedSprint(epic, {
            selectedSprint,
            selectedSprintName: selectedSprintInfo?.name || ''
        });
    }, [selectedSprint, selectedSprintInfo?.name]);
    const epicHasPlanningSprintLabel = React.useCallback((epic) => {
        return epicHasSelectedSprintLabel(epic, selectedSprintInfo?.name || '');
    }, [selectedSprintInfo?.name]);
    // While the Department is too large for Epic alerts, epicsInScope holds only the primary load's
    // first page; no alert may be derived from it. Separate sources (remote Backlog, sprint Stories,
    // ready-to-close Epics, Story readiness) are unaffected.
    const alertEpicsInScope = React.useMemo(
        () => (alertScopeTooLarge ? [] : epicsInScope),
        [alertScopeTooLarge, epicsInScope]
    );
    const planningCandidateEpics = React.useMemo(() => {
        return alertEpicsInScope.filter((epic) => {
            if (!epic?.key) return false;
            if (dismissedAlertSet.has(epic.key)) return false;
            const status = normalizeStatus(epic.status?.name);
            if (!status || status === 'done' || status === 'killed' || status === 'incomplete') return false;
            if (!epicMatchesFuturePlanningTeamSelection(epic, {
                isAllTeamsSelected,
                selectedTeamSet,
                teamLabels: normalizedActiveGroupTeamLabels
            })) return false;
            return true;
        });
    }, [alertEpicsInScope, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet, normalizedActiveGroupTeamLabels]);
    const backlogEpics = React.useMemo(() => {
        if (!isFutureSprintSelected) return [];
        const seen = new Set();
        const selectedSprintScope = { selectedSprint, selectedSprintName: selectedSprintInfo?.name || '' };
        const remoteBacklog = filterExplicitBacklogEpics([...backlogProductEpics, ...backlogTechEpics], selectedSprintScope);
        const sprintValueBacklog = filterExplicitBacklogEpics(planningCandidateEpics, selectedSprintScope);
        return [...remoteBacklog, ...sprintValueBacklog].filter((epic) => {
            if (!epic?.key || seen.has(epic.key)) return false;
            seen.add(epic.key);
            if (dismissedAlertSet.has(epic.key)) return false;
            if (!epicMatchesFuturePlanningTeamSelection(epic, {
                isAllTeamsSelected,
                selectedTeamSet,
                teamLabels: normalizedActiveGroupTeamLabels
            })) return false;
            const status = normalizeStatus(epic.status?.name);
            if (!status || status === 'done' || status === 'killed' || status === 'incomplete') return false;
            return true;
        });
    }, [isFutureSprintSelected, backlogProductEpics, backlogTechEpics, planningCandidateEpics, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet, normalizedActiveGroupTeamLabels, selectedSprint, selectedSprintInfo?.name]);
    const backlogEpicKeySet = React.useMemo(
        () => new Set(backlogEpics.map(epic => epic.key).filter(Boolean)),
        [backlogEpics]
    );
    const missingTeamEpics = React.useMemo(() => {
        if (!isFutureSprintSelected) return [];
        return planningCandidateEpics.filter((epic) => {
            if (backlogEpicKeySet.has(epic.key)) return false;
            const teamId = String(epic.teamId || '').trim();
            const teamName = String(epic.teamName || '').trim().toLowerCase();
            return !teamId || !teamName || teamName === 'unknown team';
        });
    }, [isFutureSprintSelected, planningCandidateEpics, backlogEpicKeySet]);
    const missingTeamEpicKeySet = React.useMemo(
        () => new Set(missingTeamEpics.map(epic => epic.key).filter(Boolean)),
        [missingTeamEpics]
    );
    const missingLabelEpics = React.useMemo(() => {
        if (!isFutureSprintSelected) return [];
        return planningCandidateEpics.filter((epic) => {
            if (backlogEpicKeySet.has(epic.key) || missingTeamEpicKeySet.has(epic.key)) return false;
            if (!epicMatchesPlanningSprintValue(epic)) return false;
            return !epicHasPlanningSprintLabel(epic) || !epicHasFuturePlanningTeamLabel(epic, {
                selectedTeamSet,
                teamLabels: normalizedActiveGroupTeamLabels
            });
        });
    }, [isFutureSprintSelected, planningCandidateEpics, backlogEpicKeySet, missingTeamEpicKeySet, selectedTeamSet, normalizedActiveGroupTeamLabels, epicMatchesPlanningSprintValue, epicHasPlanningSprintLabel]);
    const missingLabelEpicKeySet = React.useMemo(
        () => new Set(missingLabelEpics.map(epic => epic.key).filter(Boolean)),
        [missingLabelEpics]
    );
    const storyReadinessAlerts = React.useMemo(() => buildStoryReadinessAlertModel({
        selectedSprintState, dismissedIds: dismissedStoryRequirementIds,
        alertTargets: engWorkHierarchy.alertTargets || [], isFutureSprintSelected,
        backlogEpicKeys: backlogEpicKeySet, missingTeamEpicKeys: missingTeamEpicKeySet,
        missingLabelEpicKeys: missingLabelEpicKeySet, normalizeStatus,
    }), [selectedSprintState, dismissedStoryRequirementIds, engWorkHierarchy.alertTargets, isFutureSprintSelected, backlogEpicKeySet, missingTeamEpicKeySet, missingLabelEpicKeySet]);
    const needsStoriesEntries = storyReadinessAlerts.entries;
    const needsStoriesEpics = storyReadinessAlerts.epics;
    const storyReadinessEpicKeySet = storyReadinessAlerts.epicKeySet;

    const emptyEpics = alertEpicsInScope
        .filter(epic => {
            const status = normalizeStatus(epic.status?.name);
            if (status === 'killed' || status === 'done' || status === 'incomplete' || status === 'in progress') return false;
            if (!isAllTeamsSelected && epic.teamId && !selectedTeamSet.has(epic.teamId)) return false;
            return true;
        })
        .filter(epic => typeof epic.totalStories === 'number' && epic.totalStories === 0)
        .filter(epic => !dismissedAlertSet.has(epic.key));
    const futureRoutedEpics = React.useMemo(() => {
        return emptyEpics.filter(epic => {
            const selectedStories = Number(epic.selectedStories || 0);
            const futureOpenStories = Number(epic.futureOpenStories || 0);
            return selectedStories === 0 && futureOpenStories > 0;
        });
    }, [emptyEpics]);

    const readyToCloseStoryStatuses = new Set(['done', 'killed', 'incomplete']);
    const readyToCloseEpicStatuses = new Set(['in progress', 'accepted']);
    const matchesSelectedSprint = epicMatchesPlanningSprintValue;
    const epicHasStoryInSelectedSprint = (epicStories) => {
        if (!epicStories || epicStories.length === 0) return false;
        return epicStories.some(task => isTaskInSelectedSprint(task));
    };
    const epicOrStoriesMatchSelectedSprint = (epic, epicStories) => {
        if (matchesSelectedSprint(epic)) return true;
        return epicHasStoryInSelectedSprint(epicStories);
    };

    const doneStoryEpics = readyToCloseEpicsInScope
        .filter(epic => {
            const status = normalizeStatus(epic.status?.name);
            if (!readyToCloseEpicStatuses.has(status)) return false;
            if (!isAllTeamsSelected && epic.teamId && !selectedTeamSet.has(epic.teamId)) return false;
            return true;
        })
        .filter(epic => {
            const epicStories = tasks.filter(task => {
                if (!task.fields?.epicKey) return false;
                if (task.fields.epicKey !== epic.key) return false;
                if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                return true;
            });
            if (epicStories.length === 0) return false;
            if (!epicOrStoriesMatchSelectedSprint(epic, epicStories)) return false;
            // Authoritative, truncation-free signal from the backend: ready to
            // close only when the epic has zero open (non-terminal) children
            // across all sprints. Fail closed when the count is missing/unloaded
            // so a still-open future-sprint story is never read as "all done".
            return epic.openChildCount === 0;
        })
        .filter(epic => !dismissedAlertSet.has(epic.key));

    const analysisEpicsSource = React.useMemo(() => {
        const seen = new Set();
        const merged = [...readyToCloseEpicsInScope, ...alertEpicsInScope].filter(epic => {
            if (!epic?.key) return false;
            if (seen.has(epic.key)) return false;
            seen.add(epic.key);
            return true;
        });
        return merged;
    }, [readyToCloseEpicsInScope, alertEpicsInScope]);

    const sortByPriorityThenSummary = (a, b) => {
        const priorityA = priorityOrder[a.fields.priority?.name] || 999;
        const priorityB = priorityOrder[b.fields.priority?.name] || 999;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return (a.fields.summary || '').localeCompare(b.fields.summary || '');
    };

    const groupAlertsByTeam = (items, resolveTeam, sortItems) => {
        const groups = new Map();
        (items || []).forEach(item => {
            const teams = [].concat(resolveTeam(item) || []).filter(Boolean);
            if (!teams.length) teams.push({ id: 'unknown', name: 'Unknown Team' });
            const seenTeamIds = new Set();
            teams.forEach((team) => {
                const id = team.id || team.name || 'unknown';
                if (seenTeamIds.has(id)) return;
                seenTeamIds.add(id);
                const entry = groups.get(id) || { id, name: team.name || 'Unknown Team', items: [] };
                entry.items.push(item);
                groups.set(id, entry);
            });
        });
        const list = Array.from(groups.values());
        list.forEach(group => sortItems && group.items.sort(sortItems));
        return list.sort((a, b) => a.name.localeCompare(b.name));
    };

    const postponedTasks = React.useMemo(() => {
        return tasks.filter(task => {
            if (!task?.key) return false;
            if (dismissedAlertSet.has(task.key)) return false;
            const status = normalizeStatus(task.fields.status?.name);
            if (status !== 'postponed') return false;
            if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
            return true;
        });
    }, [tasks, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet]);

    const analysisWaitingEpics = React.useMemo(() => {
        return analysisEpicsSource.filter(epic => {
            if (!epic?.key) return false;
            if (dismissedAlertSet.has(epic.key)) return false;
            const status = normalizeStatus(epic.status?.name);
            if (readyToCloseEpicStatuses.has(status)) return false;
            if (status === 'killed' || status === 'done' || status === 'incomplete') return false;
            if (!isAllTeamsSelected && epic.teamId && !selectedTeamSet.has(epic.teamId)) return false;
            const selectedSprintEpicStories = tasks.filter(task => {
                if (!task.fields?.epicKey) return false;
                if (task.fields.epicKey !== epic.key) return false;
                if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                return true;
            });
            // Waiting for Stories must only surface epics that belong to the currently selected sprint.
            if (!epicOrStoriesMatchSelectedSprint(epic, selectedSprintEpicStories)) return false;
            const epicStories = readyToCloseTasks.filter(task => {
                if (!task.fields?.epicKey) return false;
                if (task.fields.epicKey !== epic.key) return false;
                if (!isAllTeamsSelected && !selectedTeamSet.has(getTeamInfo(task).id)) return false;
                return true;
            });
            if (epicStories.length === 0) return false;
            return epicStories.every(task => readyToCloseStoryStatuses.has(normalizeStatus(task.fields.status?.name)));
        });
    }, [
        analysisEpicsSource,
        dismissedAlertSet,
        isAllTeamsSelected,
        selectedTeamSet,
        tasks,
        readyToCloseTasks,
        readyToCloseStoryStatuses,
        readyToCloseEpicStatuses,
        selectedSprint,
        selectedSprintInfo?.name
    ]);

    const postponedEmptyEpics = React.useMemo(() => {
        return emptyEpics.filter(epic => {
            const status = normalizeStatus(epic.status?.name);
            if (status !== 'postponed') return false;
            if (!isFutureSprintSelected) return false;
            return matchesSelectedSprint(epic);
        });
    }, [emptyEpics, isFutureSprintSelected, selectedSprint, selectedSprintInfo?.name]);
    const epicsWithActionableStoriesInSelectedSprint = React.useMemo(() => {
        const storiesByEpic = new Map();
        selectionTasks.forEach(task => {
            const epicKey = task.fields?.epicKey;
            if (!epicKey) return;
            const status = normalizeStatus(task.fields.status?.name);
            if (!status) return;
            if (status.includes('blocked')) return;
            if (status === 'killed' || status === 'done' || status === 'incomplete') return;
            const list = storiesByEpic.get(epicKey) || [];
            list.push(task);
            storiesByEpic.set(epicKey, list);
        });
        const epicKeys = new Set();
        emptyEpics.forEach(epic => {
            if (!epic?.key) return;
            const epicStories = storiesByEpic.get(epic.key) || [];
            if (!epicStories.length) return;
            if (matchesSelectedSprint(epic) || epicHasStoryInSelectedSprint(epicStories)) {
                epicKeys.add(epic.key);
            }
        });
        return epicKeys;
    }, [selectionTasks, emptyEpics, selectedSprint, selectedSprintInfo?.name]);

    const emptyEpicsForAlert = React.useMemo(() => {
        if (isFutureSprintSelected) return [];
        const futureRoutedEpicKeys = new Set(futureRoutedEpics.map(epic => epic.key).filter(Boolean));
        return emptyEpics.filter(epic => {
            if (!epic?.key) return false;
            if (storyReadinessEpicKeySet.has(epic.key)) return false;
            if (Number(epic.selectedActionableStories || 0) > 0) return false;
            if (epicsWithActionableStoriesInSelectedSprint.has(epic.key)) return false;
            if (futureRoutedEpicKeys.has(epic.key)) return false;
            return true;
        });
    }, [isFutureSprintSelected, emptyEpics, epicsWithActionableStoriesInSelectedSprint, futureRoutedEpics, storyReadinessEpicKeySet]);
    const waitingForStoriesEpics = React.useMemo(() => {
        if (isFutureSprintSelected) {
            return [];
        }
        const seen = new Set();
        const merged = [...analysisWaitingEpics, ...postponedEmptyEpics].filter(epic => {
            if (!epic?.key) return false;
            if (storyReadinessEpicKeySet.has(epic.key)) return false;
            if (seen.has(epic.key)) return false;
            seen.add(epic.key);
            return true;
        });
        return merged;
    }, [isFutureSprintSelected, analysisWaitingEpics, postponedEmptyEpics, storyReadinessEpicKeySet]);

    const {
        visibleAlertCollections,
        missingAlertKeySet,
        blockedAlertKeySet,
        postponedAlertKeySet,
        backlogAlertKeySet,
        needsStoriesAlertKeySet,
        waitingAlertKeySet,
        emptyAlertKeySet,
        doneAlertKeySet,
        alertCounts,
        alertItemCount,
    } = useEngAlertFilters({
        collections: {
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
        },
        visibleTasks: visibleTasksForList,
        searchQuery,
        epicDetails,
        filters: engCatchUpFilters,
        techProjectKeys,
        focusedFilterActive: Boolean(burnoutTaskFilter),
    });

    const missingAlertTeams = groupAlertsByTeam(visibleAlertCollections.consolidatedMissingStories, (item) => getTeamInfo(item.task));
    const blockedAlertTeams = groupAlertsByTeam(visibleAlertCollections.blockedTasks, (task) => getTeamInfo(task), sortByPriorityThenSummary);
    const doneEpicTeams = groupAlertsByTeam(visibleAlertCollections.doneStoryEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const postponedAlertTeams = groupAlertsByTeam(visibleAlertCollections.postponedTasks, (task) => getTeamInfo(task), sortByPriorityThenSummary);
    const postponedEpicTeams = groupAlertsByTeam(visibleAlertCollections.futureRoutedEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const emptyEpicTeams = groupAlertsByTeam(visibleAlertCollections.emptyEpicsForAlert, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const analysisEpicTeams = groupAlertsByTeam(visibleAlertCollections.waitingForStoriesEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const backlogEpicTeams = groupAlertsByTeam(visibleAlertCollections.backlogEpics, (epic) => isFutureSprintSelected ? getFuturePlanningTeamInfos(epic) : getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const missingTeamEpicTeams = groupAlertsByTeam(visibleAlertCollections.missingTeamEpics, (epic) => getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const missingLabelEpicTeams = groupAlertsByTeam(visibleAlertCollections.missingLabelEpics, (epic) => isFutureSprintSelected ? getFuturePlanningTeamInfos(epic) : getEpicTeamInfo(epic), (a, b) => (a.summary || '').localeCompare(b.summary || ''));
    const needsStoriesTeams = groupAlertsByTeam(visibleAlertCollections.needsStoriesEntries, (entry) => entry.team, (a, b) => (a.epic.summary || '').localeCompare(b.epic.summary || ''));

    return {
        visibleAlertCollections, missingAlertKeySet, blockedAlertKeySet, postponedAlertKeySet,
        needsStoriesAlertKeySet, waitingAlertKeySet, emptyAlertKeySet, doneAlertKeySet, alertCounts,
        alertItemCount, missingAlertTeams, blockedAlertTeams, doneEpicTeams, postponedAlertTeams,
        postponedEpicTeams, emptyEpicTeams, analysisEpicTeams, backlogEpicTeams, missingTeamEpicTeams,
        missingLabelEpicTeams, needsStoriesTeams
    };
}
