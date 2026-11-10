import * as React from 'react';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import PlanningPopover from './PlanningPopover.jsx';
import JiraMarkIcon from '../ui/JiraMarkIcon.jsx';
import { lowerEntityWord, resolveEntityNames } from './engWorkModel.js';

export const planningScopeHelp = (childWords = 'stories') =>
    `Applies to all ${childWords} matching the current Team and filters, including rows below.`;

function ScopedAction({ children, descriptionId, help, ...props }) {
    return <EpicHeaderValueReadout value={help} alwaysOn suppressed={props.disabled}>
        {({ triggerRef, pointerProps, focusProps }) => <button type="button" ref={triggerRef} {...pointerProps} {...focusProps} {...props} aria-describedby={descriptionId}>{children}</button>}
    </EpicHeaderValueReadout>;
}

export default function PlanningActionBar({
    enabled = false, hasVisiblePlanningTasks, areAllVisiblePlanningTasksSelected,
    matchingIncludedCount = 0, selectedVisibleCount, jiraUrl,
    onSelectAllVisible, canUndoPlanningSelection, onUndoPlanningSelection, onClearSelected, onOpenSelectedInJira,
    statusGroups = [], onIncludeStatus, onRemoveStatus, panelControl = null, summary = null, notice = null,
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
        <PlanningPopover open={statusOpen} onClose={() => setStatusOpen(false)} label="Include by status"
            trigger={<button type="button" className="planning-action-button" aria-label="Include by status" onClick={() => setStatusOpen(open => !open)}>Status <span aria-hidden="true">▾</span></button>}>
            <div className="planning-actions">
                {statusGroups.map(group => {
                    const full = group.total > 0 && group.included === group.total;
                    const count = `${group.included}/${group.total}`;
                    return <button type="button" key={group.label} className={`planning-action-button${full ? ' active' : ''}`} aria-pressed={full}
                        aria-label={`${full ? 'Remove' : 'Include'} all ${group.label}, ${count} included`} aria-describedby={scopeId}
                        disabled={!enabled || group.total === 0} onClick={() => (full ? onRemoveStatus : onIncludeStatus)(group.statuses)}>{`${group.label} · ${count}`}</button>;
                })}
            </div>
        </PlanningPopover>
        <button type="button" className="planning-action-button planning-icon-button" onClick={onOpenSelectedInJira} aria-label={`Open planned ${childWords} in Jira`}
            disabled={selectedVisibleCount === 0 || !jiraUrl} title={`Open planned ${childWords} matching the current Team and filters in Jira`}><JiraMarkIcon className="jira-export-icon" /></button>
        {feedback && <span className={`planning-status-feedback${statusTransitionErrorCode || statusTransitionError ? ' is-error' : ''}`} role="status" aria-live="polite">{feedback}</span>}
        {summary}
        {notice}
        {panelControl}
    </div>;
}
