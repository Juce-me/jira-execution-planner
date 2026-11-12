import * as React from 'react';
import { usePlanningTeamCapacitySaveStatus } from './PlanningTeamCapacityCards.jsx';
import { RefreshGlyph } from '../ui/EpicRefreshButton.jsx';

// The Table summary in the overview row: short parts joined by " · ", warnings only when above zero (2026-11-09).
export function PlanningOverviewSummary({ childSingular = 'story', childPlural = 'stories', planned = false, count = 0, sp = 0, capacity = null, unestimated = 0, hidden = 0 }) {
    const parts = [
        ...(planned ? [`${count} ${count === 1 ? childSingular : childPlural}`, `${sp.toFixed(1)} SP`] : []),
        capacity == null ? 'Cap unavailable' : `Cap ${capacity.toFixed(1)} SP`,
        ...(unestimated > 0 ? [`${unestimated} unestimated`] : []),
        ...(hidden > 0 ? [`${hidden} hidden`] : []),
    ];
    return <span className="planning-stats compact">{parts.map((part, index) => <React.Fragment key={index}>{index > 0 && ' · '}<span>{part}</span></React.Fragment>)}</span>;
}

export default function PlanningOverviewPanel({ panelRef, compact, isStuck, onToggleDetails, capacityStatus = '', onRefreshCapacity = null, capacityLoading = false, actions, summary, notice, planReady = true, capacity, teams, projects, 'data-onboarding-target': onboardingTarget = 'planning-overview' }) {
    // Stored-number saves in flight or failed (#323) take the action row's state note, compact and expanded, so the row
    // keeps its height (the cards never grow; a failed card's Retry and Discard are in its hover rail). They displace only
    // a ready plan's notes ("Plan saved" and the like): while the plan is not ready its notice (loading, restoring, or the
    // load error with its Retry) always wins.
    // The Team cards' Jira pushes (#323 Task 6) join the same note after the save status; the cards report them here.
    const [pushSummary, setPushSummary] = React.useState('');
    const teamSaveStatus = [usePlanningTeamCapacitySaveStatus(), pushSummary].filter(Boolean).join(' · ');
    const note = teamSaveStatus && planReady ? <span className="planning-review-state-note" role="status">{teamSaveStatus}</span> : notice;
    // Re-reads the Jira capacity tickets for the Sprint; it also retries a failed or stale read.
    const refreshLabel = capacityLoading ? 'Refreshing capacity' : 'Refresh capacity';
    // A synchronous guard: a second activation before the busy render lands would otherwise restart the read. It holds from
    // the click until the read it started settles (capacityLoading true, then false); a gated no-op refresh releases it on
    // the next read cycle.
    const refreshPendingRef = React.useRef(null);
    React.useEffect(() => {
        if (capacityLoading && refreshPendingRef.current) refreshPendingRef.current = 'loading';
        else if (!capacityLoading && refreshPendingRef.current === 'loading') refreshPendingRef.current = null;
    }, [capacityLoading]);
    const requestRefresh = () => {
        if (capacityLoading || refreshPendingRef.current) return;
        refreshPendingRef.current = 'requested';
        onRefreshCapacity();
    };
    const panelControl = <>
        {onRefreshCapacity && <button type="button" className="planning-action-button planning-icon-button planning-panel-refresh" aria-label={refreshLabel} aria-busy={capacityLoading || undefined}
            aria-disabled={capacityLoading || undefined} title="Check and update capacity from the Jira capacity tickets, if they exist"
            onClick={requestRefresh}><RefreshGlyph width="14" height="14" /></button>}
        <button type="button" className="planning-action-button planning-panel-collapse" aria-expanded={!compact} aria-controls="planning-panel-details"
            aria-label={compact ? 'Show capacity details' : 'Hide capacity details'} onClick={onToggleDetails}>{compact ? 'Details' : 'Hide details'}</button>
    </>;
    return <div ref={panelRef} className={`planning-panel open${isStuck ? ' stuck' : ''}${compact ? ' planning-panel-compact' : ''}`} data-onboarding-target={onboardingTarget} tabIndex={-1}>
        {/* The summary and note sit in the action row's flexible gap. */}
        {React.isValidElement(actions) ? React.cloneElement(actions, { panelControl, summary, notice: note }) : <>{summary}{note}</>}
        {/* Every status is a retry message ending "retry with": the line shows the refresh icon's own glyph, so a touch user
            sees which control retries without hovering it. */}
        {capacityStatus && <span className="planning-panel-capacity-status" role="status">{capacityStatus} <span role="img" aria-label="Refresh capacity"><RefreshGlyph width="12" height="12" /></span></span>}
        <div id="planning-panel-details" hidden={compact} className="planning-panel-graphs">
            <div className="planning-panel-capacity-graph" aria-label="Planned effort and capacity">{planReady ? capacity : <p className="planning-review-guidance">Planned effort is unavailable until this plan is loaded.</p>}</div>
            <div className="planning-panel-team-details">{React.isValidElement(teams) ? React.cloneElement(teams, { onPushSummaryChange: setPushSummary }) : teams}</div>
            <div className="planning-panel-project-graph" aria-label="Planned effort by project">{planReady ? projects : null}</div>
        </div>
    </div>;
}
