import * as React from 'react';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';
import { clearAuthResumeState, getAuthResumeStorage } from '../api/authResumeState.js';
import { buildConnectionRecoveryShellState } from '../api/useConnectionRecovery.js';
import { completeConnectionRecoveryOwner, isConnectionRecoveryOwnerComplete } from '../scenario/connectionScenarioRecovery.js';
import { ENG_TASK_LOAD_OUTCOME } from './useEngSprintData.js';

// Auth and connection recovery share the staged Planning draft, but retain their
// separate capsule lifetimes until the shell and feature owners have settled.
export function usePlanningAuthResumeRecovery() {
    const planningRecoveryRestoringRef = React.useRef(false);
    const stagedConnectionRecoveryRef = React.useRef(null);
    const pendingShellAuthResumeRef = React.useRef(null);
    const pendingPlanningAuthResumeRef = React.useRef(null);
    const authResumeShellSettledRef = React.useRef(null);
    const planningAuthResumeLoadRef = React.useRef(null);
    const [planningRecoveryError, setPlanningRecoveryError] = React.useState('');
    const [authResumeStagedRevision, setAuthResumeStagedRevision] = React.useState(0);
    const [planningAuthResumeLoadRevision, setPlanningAuthResumeLoadRevision] = React.useState(0);
    const clearAuthResumeWhenSettled = React.useCallback(() => {
        if (readPendingAuthenticationRequired()) return;
        if (pendingShellAuthResumeRef.current || pendingPlanningAuthResumeRef.current) return;
        clearAuthResumeState(getAuthResumeStorage(window));
    }, []);
    const stageAuthResume = React.useCallback((resume, connectionResume) => {
        const firstConnectionResume = connectionResume && stagedConnectionRecoveryRef.current !== connectionResume;
        if (firstConnectionResume) stagedConnectionRecoveryRef.current = connectionResume;
        if (resume) {
            pendingShellAuthResumeRef.current = resume.view;
            authResumeShellSettledRef.current = new Set();
            planningAuthResumeLoadRef.current = null;
            pendingPlanningAuthResumeRef.current = resume.version === 2 && resume.planning ? resume.planning : null;
            setAuthResumeStagedRevision(revision => revision + 1);
        } else if (firstConnectionResume) {
            pendingShellAuthResumeRef.current = buildConnectionRecoveryShellState(connectionResume);
            authResumeShellSettledRef.current = new Set();
            pendingPlanningAuthResumeRef.current = !isConnectionRecoveryOwnerComplete(connectionResume, 'planning') ? connectionResume.planning || null : null;
            setAuthResumeStagedRevision(revision => revision + 1);
        }
    }, []);
    const restorePlanningRecovery = React.useCallback(({
        planningReview, groupsLoading, sprintsLoading, tasksFetched, productTasksLoading, techTasksLoading,
        pendingConnectionRecoveryRef, releaseConnectionRecoveryOwnership, restoreSelectedTeams,
    }) => {
        const recovery = pendingPlanningAuthResumeRef.current;
        if (!recovery || pendingShellAuthResumeRef.current || planningRecoveryRestoringRef.current || groupsLoading || sprintsLoading) return;
        const scope = planningReview.getPlanSnapshot().scope;
        if (!scope || ['workspaceId', 'groupId', 'sprintId', 'namespaceId'].some(key => scope[key] !== recovery.scope[key])) {
            setPlanningRecoveryError('The recovered plan scope is unavailable. Your changes are retained in this tab.');
            return;
        }
        if (!planningReview.planReady && planningReview.error) {
            setPlanningRecoveryError('Plan recovery could not load its baseline. Your changes are retained in this tab.');
            return;
        }
        if (!tasksFetched || productTasksLoading || techTasksLoading || !planningReview.planReady || planningReview.loading) return;
        const loaded = planningAuthResumeLoadRef.current;
        if (loaded?.outcome === ENG_TASK_LOAD_OUTCOME.NON_AUTH_FAILURE) {
            setPlanningRecoveryError('Plan recovery could not load its stories. Your changes are retained in this tab.');
            return;
        }
        // Capture the actual owner before awaiting: a replacement capsule can
        // contain the same draft and still belongs to a different recovery.
        const connectionRecovery = pendingConnectionRecoveryRef.current;
        const connectionOwner = connectionRecovery?.planning
            && JSON.stringify(connectionRecovery.planning) === JSON.stringify(recovery) ? connectionRecovery : null;
        planningRecoveryRestoringRef.current = true;
        return planningReview.restorePlanRecovery(recovery).then(restored => {
            if (pendingPlanningAuthResumeRef.current !== recovery) return;
            if (restored) {
                if (connectionOwner) {
                    completeConnectionRecoveryOwner({ pendingRecoveryRef: pendingConnectionRecoveryRef, owner: 'planning',
                        releaseOwnership: releaseConnectionRecoveryOwnership, recovery: connectionOwner });
                }
                pendingPlanningAuthResumeRef.current = null;
                planningAuthResumeLoadRef.current = null;
                restoreSelectedTeams(recovery.selectedTeams);
                setPlanningAuthResumeLoadRevision(revision => revision + 1);
                setPlanningRecoveryError('');
                clearAuthResumeWhenSettled();
            } else setPlanningRecoveryError('Plan recovery could not finish. Your changes are retained in this tab.');
        }).catch(() => setPlanningRecoveryError('Plan recovery could not finish. Your changes are retained in this tab.'))
            .finally(() => { planningRecoveryRestoringRef.current = false; });
    }, [clearAuthResumeWhenSettled]);
    return {
        pendingShellAuthResumeRef, pendingPlanningAuthResumeRef, planningRecoveryRestoringRef,
        authResumeShellSettledRef, planningAuthResumeLoadRef,
        planningRecoveryError, setPlanningRecoveryError, authResumeStagedRevision, setAuthResumeStagedRevision,
        planningAuthResumeLoadRevision, setPlanningAuthResumeLoadRevision,
        clearAuthResumeWhenSettled, stageAuthResume, restorePlanningRecovery,
    };
}
