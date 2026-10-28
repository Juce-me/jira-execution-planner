import * as React from 'react';
import { alertIdentitiesBySection, createAlertPin, resolvePinClose } from './alertPin.js';
import { alertCardId } from '../shareView/focusCapture.js';

// State layer: the pinned alert (null when nothing is pinned). App() calls it where the old useState sat, so hook order is unchanged.
// `clearAlertPin` and `pinAlert` have stable identity (the scope effect calls the former and keeps its dependency array).
export function useAlertPinState() {
    const [alertPin, setAlertPin] = React.useState(null);
    const clearAlertPin = React.useCallback(() => setAlertPin(null), []);
    const pinAlert = React.useCallback(spec => setAlertPin(createAlertPin(spec)), []);
    return { alertPin, clearAlertPin, pinAlert };
}

// Behavior layer: plain per-render closures, as they were in App(). `getAlertFlags` is late-bound: `shareViewOptions` is declared
// after these closures are created, so it is safe only from click handlers (temporal dead zone otherwise).
export function createAlertPinActions({
    alertPin, clearAlertPin, getAlertFlags, setShowAlertsPanel, afterTwoFrames, scrollToAlertTarget, scrollToTop,
    handleStoryRequirementClick, handleAlertStoryClick, dismissStoryRequirement, dismissAlertItem,
    triggerAlertCelebration, visibleAlertCollections, alertCohortSettled,
}) {
    // Opens the panel and the category (absent from the DOM while hidden or collapsed), then scrolls once they render.
    const revealAlertBlock = (sectionId, fallbackToTop, target = () => document.getElementById(sectionId)) => {
        setShowAlertsPanel(true);
        getAlertFlags()[Object.keys(getAlertFlags()).find(key => alertCardId(key) === sectionId)]?.[1](true);
        afterTwoFrames(() => {
            if (!scrollToAlertTarget(target()) && fallbackToTop) scrollToTop();
        });
    };
    // Runs outside triggerAlertCelebration, which returns early under reduced motion.
    const scrollAfterPinClose = (outcome, sectionId) => {
        if (outcome === 'top') scrollToTop();
        else revealAlertBlock(sectionId, outcome === 'block-or-top');
    };
    // Back expands the pinned category too, then lands on the alert list's top.
    const scrollBackToAlerts = () => revealAlertBlock(alertPin?.sectionId, true, () => document.querySelector('.alerts-panel-shell') || document.querySelector('[id^="eng-alert-"]'));
    // The pin's title goes where its alert row's title goes: the Story or Epic, or the Story requirement, in the Catch Up list.
    const openAlertPinTarget = () => (alertPin?.kind === 'requirement' ? handleStoryRequirementClick({ id: alertPin.identity }) : alertPin && handleAlertStoryClick(alertPin.key, false));
    const closeAlertPin = () => {
        if (!alertPin) return;
        const outcome = resolvePinClose(alertPin, alertIdentitiesBySection(visibleAlertCollections), { loading: !alertCohortSettled });
        if (outcome.dismiss) {
            if (alertPin.kind === 'requirement') dismissStoryRequirement({ id: alertPin.identity });
            else dismissAlertItem(alertPin.identity, { suppressCelebration: true });
        }
        clearAlertPin();
        if (outcome.celebrate) {
            const paletteType = {
                'eng-alert-missing': 'missing', 'eng-alert-blocked': 'blocked', 'eng-alert-followup': 'followup',
                'eng-alert-needs-stories': 'waiting', 'eng-alert-waiting': 'waiting', 'eng-alert-empty': 'empty', 'eng-alert-done': 'done'
            }[alertPin.sectionId];
            triggerAlertCelebration(paletteType ? { types: [paletteType] } : {});
        }
        scrollAfterPinClose(outcome.scroll, alertPin.sectionId);
    };
    return { scrollBackToAlerts, openAlertPinTarget, closeAlertPin };
}

// The alerts panel reads each category's flag as `show<Name>Alert` / `setShow<Name>Alert`; `alertFlags` pairs them per category key.
const ALERT_FLAG_NAMES = [
    ['Missing', 'missing'], ['Blocked', 'blocked'], ['Postponed', 'followup'], ['Backlog', 'backlog'],
    ['MissingTeam', 'missingTeam'], ['MissingLabels', 'missingLabels'], ['NeedsStories', 'needsStories'],
    ['Waiting', 'waiting'], ['EmptyEpic', 'empty'], ['DoneEpic', 'done'],
];

// The `alertProps` bag of EngAlertsPanel: `alerts` is the useEngAlerts handle, the rest are App-owned inputs.
export function createAlertPanelProps({
    alerts, alertFlags, buildKeyListLink, dismissAlertItem, getBlockedAlertStatusLabel, getFuturePlanningNeedsStoriesReasonText,
    handleAlertStoryClick, handleStoryRequirementClick, dismissStoryRequirement, isFutureSprintSelected, selectedSprintState,
    jiraUrl, pinAlert,
}) {
    const collections = alerts.visibleAlertCollections;
    const flagProps = {};
    for (const [name, key] of ALERT_FLAG_NAMES) {
        flagProps[`show${name}Alert`] = alertFlags[key][0];
        flagProps[`setShow${name}Alert`] = alertFlags[key][1];
    }
    return {
        ...flagProps,
        analysisEpicTeams: alerts.analysisEpicTeams,
        backlogEpicTeams: alerts.backlogEpicTeams,
        backlogEpics: collections.backlogEpics,
        blockedAlertTeams: alerts.blockedAlertTeams,
        blockedTasks: collections.blockedTasks,
        buildKeyListLink,
        consolidatedMissingStories: collections.consolidatedMissingStories,
        dismissAlertItem,
        doneEpicTeams: alerts.doneEpicTeams,
        doneStoryEpics: collections.doneStoryEpics,
        emptyEpicTeams: alerts.emptyEpicTeams,
        emptyEpics: collections.emptyEpicsForAlert,
        emptyEpicsForAlert: collections.emptyEpicsForAlert,
        futureRoutedEpics: collections.futureRoutedEpics,
        getBlockedAlertStatusLabel,
        getFuturePlanningNeedsStoriesReasonText,
        handleAlertStoryClick,
        handleStoryRequirementClick,
        dismissStoryRequirement,
        isFutureSprintSelected,
        storyReadinessSprintState: selectedSprintState,
        jiraUrl,
        missingAlertTeams: alerts.missingAlertTeams,
        missingLabelEpicTeams: alerts.missingLabelEpicTeams,
        missingLabelEpics: collections.missingLabelEpics,
        missingTeamEpicTeams: alerts.missingTeamEpicTeams,
        missingTeamEpics: collections.missingTeamEpics,
        needsStoriesEntries: collections.needsStoriesEntries,
        needsStoriesEpics: collections.needsStoriesEpics,
        needsStoriesTeams: alerts.needsStoriesTeams,
        pinAlert,
        postponedAlertTeams: alerts.postponedAlertTeams,
        postponedEpicTeams: alerts.postponedEpicTeams,
        postponedTasks: collections.postponedTasks,
        waitingForStoriesEpics: collections.waitingForStoriesEpics,
    };
}
