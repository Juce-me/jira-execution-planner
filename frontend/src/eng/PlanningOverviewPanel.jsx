import * as React from 'react';

export default function PlanningOverviewPanel({ panelRef, compact, isStuck, table, onToggleDetails, capacityStatus = '', actions, summary, notice, planReady = true, capacity, teams, projects, 'data-onboarding-target': onboardingTarget = 'planning-overview' }) {
    const panelControl = table ? <button type="button" className="planning-action-button planning-panel-collapse" aria-expanded={!compact} aria-controls="planning-panel-details" onClick={onToggleDetails}>{compact ? 'Show capacity details' : 'Hide capacity details'}</button> : null;
    return <div ref={panelRef} className={`planning-panel open${isStuck ? ' stuck' : ''}${compact ? ' planning-panel-compact' : ''}`} data-onboarding-target={onboardingTarget} tabIndex={-1}>
        {React.isValidElement(actions) ? React.cloneElement(actions, { panelControl }) : actions}
        {summary}
        {notice}
        {capacityStatus && !compact && <span className="planning-panel-capacity-status" role="status">{capacityStatus}</span>}
        <div id="planning-panel-details" hidden={compact} className="planning-panel-graphs">
            <div className="planning-panel-capacity-graph" aria-label="Planned effort and capacity">{planReady ? capacity : <p className="planning-review-guidance">Planned effort is unavailable until this plan is loaded.</p>}</div>
            <div className="planning-panel-team-details">{teams}</div>
            <div className="planning-panel-project-graph" aria-label="Planned effort by project">{planReady ? projects : null}</div>
        </div>
    </div>;
}
