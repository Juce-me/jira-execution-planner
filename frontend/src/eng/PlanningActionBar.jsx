import * as React from 'react';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import PlanningPopover from './PlanningPopover.jsx';
import { lowerEntityWord, resolveEntityNames } from './engWorkModel.js';

export const planningScopeHelp = (childWords = 'stories') =>
    `Applies to all ${childWords} matching the current Team and filters, including rows below.`;

// Retained until Table details acceptance allows the last Planning List callers to be removed.
export function PlanningLayoutToggle({ planningLayout = 'list', onTogglePlanningLayout }) {
    return <button type="button" className="planning-action-button planning-icon-button planning-layout-toggle" onClick={onTogglePlanningLayout}
        aria-label={planningLayout === 'table' ? 'Show Planning list' : 'Show Planning table'} aria-pressed={planningLayout === 'table'}
        title={planningLayout === 'table' ? 'Show Planning list' : 'Show Planning table'}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            {planningLayout === 'table' ? <path d="M2 3h12M2 8h12M2 13h12" /> : <><rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M1.5 6h13M1.5 10h13M6 2v12" /></>}
        </svg>
    </button>;
}

function ScopedAction({ children, descriptionId, help, ...props }) {
    return <EpicHeaderValueReadout value={help} alwaysOn suppressed={props.disabled}>
        {({ triggerRef, pointerProps, focusProps }) => <button type="button" ref={triggerRef} {...pointerProps} {...focusProps} {...props} aria-describedby={descriptionId}>{children}</button>}
    </EpicHeaderValueReadout>;
}

export default function PlanningActionBar({
    enabled = false, hasVisiblePlanningTasks, areAllVisiblePlanningTasksSelected,
    matchingIncludedCount = 0, selectedVisibleCount, jiraUrl,
    onSelectAllVisible, canUndoPlanningSelection, onUndoPlanningSelection, onClearSelected, onOpenSelectedInJira,
    statusGroups = [], onIncludeStatus, onRemoveStatus, panelControl = null,
    planningLayout = 'table', onTogglePlanningLayout,
    statusTransitionError = '', statusTransitionErrorCode = '', statusTransitionResult = null, entityNames = null,
}) {
    const childWords = lowerEntityWord((entityNames || resolveEntityNames()).childPlural);
    const scopeHelp = planningScopeHelp(childWords);
    const [statusOpen, setStatusOpen] = React.useState(false);
    const scopeId = React.useId();
    const undoId = React.useId();
    React.useEffect(() => { if (!enabled) setStatusOpen(false); }, [enabled]);
    const feedback = (() => {
        if (!statusTransitionResult) return statusTransitionError;
        const { succeeded = 0, failed = 0 } = statusTransitionResult;
        const noun = count => count === 1 ? 'issue' : 'issues';
        if (failed === 0) return `Status updated for ${succeeded} ${noun(succeeded)}.`;
        if (succeeded === 0) return `Status change failed for ${failed} ${noun(failed)}.`;
        return `Status updated for ${succeeded}, ${failed} failed.`;
    })();
    return <div className="planning-actions">
        <span id={scopeId} className="planning-review-sr-only">{scopeHelp}</span>
        <span id={undoId} className="planning-review-sr-only">Undo the last inclusion change.</span>
        <ScopedAction className={`planning-action-button${areAllVisiblePlanningTasksSelected ? ' active' : ''}`} descriptionId={scopeId} help={scopeHelp}
            disabled={!enabled || !hasVisiblePlanningTasks || areAllVisiblePlanningTasksSelected} onClick={onSelectAllVisible}>Select All</ScopedAction>
        <ScopedAction className="uncheck-button" descriptionId={scopeId} help={scopeHelp} disabled={!enabled || matchingIncludedCount === 0} onClick={onClearSelected}>Clear Selection</ScopedAction>
        <button type="button" className="planning-action-button" aria-describedby={undoId} title="Undo the last inclusion change."
            disabled={!enabled || !canUndoPlanningSelection} onClick={onUndoPlanningSelection}>Undo</button>
        <PlanningPopover open={statusOpen} onClose={() => setStatusOpen(false)} label="Planning options"
            trigger={<button type="button" className="planning-action-button planning-icon-button" aria-label="Planning options" title="Planning options" onClick={() => setStatusOpen(open => !open)}>
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="13" cy="8" r="1" /></svg>
            </button>}>
            <div className="pop-group"><div className="pop-list">
                {panelControl && React.cloneElement(panelControl, { className: 'pop-opt pop-opt-plain', 'data-review-popover-close': true,
                    children: <span className="pop-opt-content"><span className="pop-opt-label">{panelControl.props.children}</span></span> })}
                <button type="button" className="pop-opt pop-opt-plain" data-review-popover-close onClick={onOpenSelectedInJira}
                    disabled={selectedVisibleCount === 0 || !jiraUrl} title={`Open planned ${childWords} matching the current Team and filters in Jira`}>
                    <span className="pop-opt-content"><span className="pop-opt-label">{`Open planned ${childWords} in Jira`}</span></span>
                </button>
                {onTogglePlanningLayout && <PlanningLayoutToggle planningLayout={planningLayout} onTogglePlanningLayout={onTogglePlanningLayout} />}
            </div></div>
            <div className="pop-subject">Include by status</div>
            {statusGroups.map(group => <div className="pop-group" key={group.label}>
                <div className="pop-head"><span className="pop-facet">{group.label}</span></div>
                <div className="pop-list">
                    <button type="button" className="pop-opt pop-opt-plain" aria-label={`Include ${group.label}`} disabled={!enabled || !group.canInclude}
                        data-review-popover-close onClick={() => onIncludeStatus(group.statuses)}><span className="pop-opt-content"><span className="pop-opt-label">Include</span></span></button>
                    <button type="button" className="pop-opt pop-opt-plain" aria-label={`Remove ${group.label}`} disabled={!enabled || !group.canRemove}
                        data-review-popover-close onClick={() => onRemoveStatus(group.statuses)}><span className="pop-opt-content"><span className="pop-opt-label">Remove</span></span></button>
                </div>
            </div>)}
        </PlanningPopover>
        {feedback && <span className={`planning-status-feedback${statusTransitionErrorCode || statusTransitionError ? ' is-error' : ''}`} role="status" aria-live="polite">{feedback}</span>}
    </div>;
}
