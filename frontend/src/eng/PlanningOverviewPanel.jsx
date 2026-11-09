import * as React from 'react';

// The Table summary in the overview row: short parts joined by " · ", warnings only when above zero (2026-11-09).
export function PlanningOverviewSummary({ childPlural = 'stories', planned = false, count = 0, sp = 0, capacity = null, unestimated = 0, hidden = 0 }) {
    const parts = [
        ...(planned ? [`${count} ${childPlural}`, `${sp.toFixed(1)} SP`] : []),
        capacity == null ? 'Cap unavailable' : `Cap ${capacity.toFixed(1)} SP`,
        ...(unestimated > 0 ? [`${unestimated} unestimated`] : []),
        ...(hidden > 0 ? [`${hidden} hidden`] : []),
    ];
    return <span className="planning-stats compact">{parts.map((part, index) => <React.Fragment key={index}>{index > 0 && ' · '}<span>{part}</span></React.Fragment>)}</span>;
}

export default function PlanningOverviewPanel({ panelRef, compact, isStuck, table, onToggleDetails, capacityStatus = '', actions, summary, notice, planReady = true, capacity, teams, projects, 'data-onboarding-target': onboardingTarget = 'planning-overview' }) {
    const panelControl = table ? <button type="button" className="planning-action-button planning-panel-collapse" aria-expanded={!compact} aria-controls="planning-panel-details"
        aria-label={compact ? 'Show capacity details' : 'Hide capacity details'} onClick={onToggleDetails}>{compact ? 'Details' : 'Hide details'}</button> : null;
    return <div ref={panelRef} className={`planning-panel open${isStuck ? ' stuck' : ''}${compact ? ' planning-panel-compact' : ''}`} data-onboarding-target={onboardingTarget} tabIndex={-1}>
        {/* Table puts the summary and note in the action row's flexible gap; List keeps them below the row. */}
        {table && React.isValidElement(actions) ? React.cloneElement(actions, { panelControl, summary, notice })
            : <>{React.isValidElement(actions) ? React.cloneElement(actions, { panelControl }) : actions}{summary}{notice}</>}
        {capacityStatus && <span className="planning-panel-capacity-status" role="status">{capacityStatus}</span>}
        <div id="planning-panel-details" hidden={compact} className="planning-panel-graphs">
            <div className="planning-panel-capacity-graph" aria-label="Planned effort and capacity">{planReady ? capacity : <p className="planning-review-guidance">Planned effort is unavailable until this plan is loaded.</p>}</div>
            <div className="planning-panel-team-details">{teams}</div>
            <div className="planning-panel-project-graph" aria-label="Planned effort by project">{planReady ? projects : null}</div>
        </div>
    </div>;
}
