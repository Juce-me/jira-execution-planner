import * as React from 'react';
const { useEffect } = React;
import { ENG_TASK_LOAD_OUTCOME } from './useEngSprintData.js';
import { persistPlanningSelectionState, resolvePlanningAuthResume, resolvePlanningSelectionForDashboard, selectedTaskKeysFromMap, selectedTaskMapFromKeys } from './planningSelectionActions.js';
import { selectedTeamSelectionsEqual } from '../teamSelectionUtils.mjs';

// Planning selection reconciliation, moved verbatim out of App() (issue #250 Task 0.5, to make line-budget
// headroom). It prunes and persists the Planning selection against the selectable Story pool and resumes
// it after an auth recovery. It is called at the exact site of the original effect, so effect order is
// unchanged; every input is the App binding the effect already closed over.
export function usePlanningSelectionSync({
    pendingPlanningAuthResumeRef, pendingShellAuthResumeRef, planningAuthResumeLoadRef, lastLoadedSprintRef,
    teamSelectionHydratedSelectionRef, planningAuthResumePersistenceFailedRef, planningLoadedSelectionRef, planningBaselineScopeRef,
    clearAuthResumeWhenSettled, normalizeSelectedTeams,
    planningScopeKey, activeGroupId, selectedSprint, teamSelectionScopeKey, isFutureSprintSelected,
    tasksFetched, productTasksLoading, techTasksLoading, selectionTasks, teamOptions,
    selectedTasks, selectedTeams, planningSelectionMode, activeGroupTeamIds,
    authResumeStagedRevision, planningAuthResumeLoadRevision,
    setSelectedTasks, setSelectedTeams, setPlanningSelectionMode, setCanUndoPlanningSelection,
}) {
    useEffect(() => {
        const pendingPlanningResume = pendingPlanningAuthResumeRef.current;
        if (pendingPlanningResume && pendingShellAuthResumeRef.current) return;
        if (pendingPlanningResume && (!planningScopeKey || pendingPlanningResume.scopeKey !== planningScopeKey)) {
            pendingPlanningAuthResumeRef.current = null;
            planningAuthResumeLoadRef.current = null;
            clearAuthResumeWhenSettled();
            return;
        }
        if (pendingPlanningResume) {
            const recoveryLoad = planningAuthResumeLoadRef.current;
            if (!recoveryLoad || recoveryLoad.scopeKey !== planningScopeKey) return;
            if (recoveryLoad.outcome === 'pending') return;
            if (recoveryLoad.outcome === ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE) {
                pendingPlanningAuthResumeRef.current = null;
                planningAuthResumeLoadRef.current = null;
                clearAuthResumeWhenSettled();
                return;
            }
            if (recoveryLoad.outcome !== ENG_TASK_LOAD_OUTCOME.APPLIED) return;
        }
        if (!planningScopeKey || !activeGroupId || selectedSprint === null) return;
        if (!tasksFetched || productTasksLoading || techTasksLoading) return;
        if (lastLoadedSprintRef.current !== selectedSprint) return;
        const hydratedTeamSelection = teamSelectionHydratedSelectionRef.current; if (hydratedTeamSelection?.scopeKey === teamSelectionScopeKey && !selectedTeamSelectionsEqual(selectedTeams, hydratedTeamSelection.selectedTeams)) return;
        if (hydratedTeamSelection?.scopeKey === teamSelectionScopeKey) teamSelectionHydratedSelectionRef.current = null;

        let validTaskKeySet;
        let nextSelectedTaskKeys;
        let nextSelectionMode;
        let nextSelectedTeams;
        if (pendingPlanningResume) {
            validTaskKeySet = new Set(selectionTasks.map(task => String(task?.key || '').trim()).filter(Boolean));
            const resumed = resolvePlanningAuthResume({
                resume: pendingPlanningResume,
                planningScopeKey,
                validTaskKeys: validTaskKeySet,
                validTeamIds: new Set(teamOptions.map(team => String(team?.id || '').trim()).filter(Boolean)),
            });
            nextSelectedTaskKeys = resumed.selectedTaskKeys;
            nextSelectionMode = resumed.selectionMode;
            nextSelectedTeams = resumed.selectedTeams;
        } else {
            ({ validTaskKeySet, nextSelectedTaskKeys, nextSelectionMode, nextSelectedTeams } = resolvePlanningSelectionForDashboard({
                selectedTasks,
                selectedTeams,
                planningSelectionMode,
                isFutureSprintSelected,
                selectionTasks,
                teamOptions,
                activeGroupTeamIds,
            }));
        }

        setSelectedTasks(prev => {
            const prevKeys = selectedTaskKeysFromMap(prev, validTaskKeySet);
            const sameLength = prevKeys.length === nextSelectedTaskKeys.length;
            const sameKeys = sameLength && prevKeys.every((key, index) => key === nextSelectedTaskKeys[index]);
            return sameKeys ? prev : selectedTaskMapFromKeys(nextSelectedTaskKeys);
        });

        setSelectedTeams(prev => {
            const normalizedPrev = normalizeSelectedTeams(prev);
            const sameLength = normalizedPrev.length === nextSelectedTeams.length;
            const sameTeams = sameLength && normalizedPrev.every((id, index) => id === nextSelectedTeams[index]);
            return sameTeams ? prev : nextSelectedTeams;
        });

        setPlanningSelectionMode(prev => prev === nextSelectionMode ? prev : nextSelectionMode);

        const persistenceSucceeded = persistPlanningSelectionState({ storage: window.localStorage, scopeKey: planningScopeKey, selectedTasks: selectedTaskMapFromKeys(nextSelectedTaskKeys), selectionMode: nextSelectionMode, selectedTeams: nextSelectedTeams, normalizeSelectedTeams });
        if (pendingPlanningResume && !persistenceSucceeded) {
            planningAuthResumePersistenceFailedRef.current = planningScopeKey;
            planningLoadedSelectionRef.current = null;
            planningBaselineScopeRef.current = '';
            setCanUndoPlanningSelection(false);
            pendingPlanningAuthResumeRef.current = null;
            planningAuthResumeLoadRef.current = null;
            clearAuthResumeWhenSettled();
            return;
        }
        if (planningAuthResumePersistenceFailedRef.current === planningScopeKey) {
            setCanUndoPlanningSelection(false);
            return;
        }

        if (pendingPlanningResume || planningBaselineScopeRef.current !== planningScopeKey) {
            planningLoadedSelectionRef.current = {
                scopeKey: planningScopeKey,
                selectedTasks: selectedTaskMapFromKeys(nextSelectedTaskKeys),
                selectionMode: nextSelectionMode
            };
            planningBaselineScopeRef.current = planningScopeKey;
            setCanUndoPlanningSelection(false);
        }
        if (pendingPlanningResume) {
            pendingPlanningAuthResumeRef.current = null;
            planningAuthResumeLoadRef.current = null;
            clearAuthResumeWhenSettled();
        }
    }, [
        planningScopeKey,
        activeGroupId,
        selectedSprint, teamSelectionScopeKey,
        isFutureSprintSelected,
        tasksFetched,
        productTasksLoading,
        techTasksLoading,
        selectionTasks,
        teamOptions,
        selectedTasks,
        selectedTeams,
        planningSelectionMode,
        activeGroupTeamIds.join('|'),
        authResumeStagedRevision,
        planningAuthResumeLoadRevision,
        clearAuthResumeWhenSettled,
    ]);
}
