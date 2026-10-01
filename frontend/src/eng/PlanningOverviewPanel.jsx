import * as React from 'react';
import { PlanningLayoutToggle } from './PlanningActionBar.jsx';

export default function PlanningOverviewPanel({ panelRef, compact, isStuck, table, onToggleDetails, onToggleLayout, capacityStatus = '', actions, capacity, teams, projects, 'data-onboarding-target': onboardingTarget = 'planning-overview' }) {
    return <div ref={panelRef} className={`planning-panel open${isStuck ? ' stuck' : ''}${compact ? ' planning-panel-compact' : ''}`} data-onboarding-target={onboardingTarget} tabIndex={-1}>
        {table && <div className="planning-panel-visibility">
            <button type="button" className="planning-action-button" aria-expanded={!compact} aria-controls="planning-panel-details" onClick={onToggleDetails}>{compact ? 'Show panel' : 'Hide panel'}</button>
            {compact && <PlanningLayoutToggle planningLayout="table" onTogglePlanningLayout={onToggleLayout} />}
        </div>}
        {compact && capacityStatus && <span className="planning-panel-capacity-status" role="status">{capacityStatus}</span>}
        <div id="planning-panel-details" hidden={compact}>{actions}</div>
        <div className="planning-panel-graphs">
            <div className="planning-panel-capacity-graph" aria-label="Selected effort and capacity">{capacity}</div>
            <div className="planning-panel-team-details" hidden={compact}>{teams}</div>
            <div className="planning-panel-project-graph" aria-label="Selected effort by project">{projects}</div>
        </div>
    </div>;
}
