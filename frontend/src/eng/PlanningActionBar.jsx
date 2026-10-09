import * as React from 'react';

export function PlanningLayoutToggle({ planningLayout = 'list', onTogglePlanningLayout }) {
    return <button type="button" className="planning-action-button planning-icon-button planning-layout-toggle" onClick={onTogglePlanningLayout}
        aria-label={planningLayout === 'table' ? 'Show Planning list' : 'Show Planning table'} aria-pressed={planningLayout === 'table'}
        title={planningLayout === 'table' ? 'Show Planning list' : 'Show Planning table'}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            {planningLayout === 'table' ? <path d="M2 3h12M2 8h12M2 13h12" /> : <><rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M1.5 6h13M1.5 10h13M6 2v12" /></>}
        </svg>
    </button>;
}

export default function PlanningActionBar({
    isAcceptedIncluded,
    isTodoIncluded,
    isPostponedIncluded,
    isAwaitingValidationIncluded,
    areAllVisiblePlanningTasksSelected,
    hasVisibleTasks,
    hasVisiblePlanningTasks,
    hasPostponedTasks,
    hasAwaitingValidationTasks,
    selectedCount,
    jiraUrl,
    onToggleAccepted,
    onToggleTodo,
    onTogglePostponed,
    onToggleAwaitingValidation,
    onSelectAllVisible,
    canUndoPlanningSelection,
    onUndoPlanningSelection,
    onClearSelected,
    onOpenSelectedInJira,
    planningLayout = 'list',
    onTogglePlanningLayout,
    panelControl = null,
    statusTransitionError = '',
    statusTransitionErrorCode = '',
    statusTransitionResult = null,
}) {
    // Feedback only: the status change itself is triggered from the clicked status
    // pill/menu, never from a button in this action bar.
    const statusFeedback = (() => {
        if (statusTransitionResult) {
            const { succeeded = 0, failed = 0 } = statusTransitionResult;
            const noun = (count) => (count === 1 ? 'issue' : 'issues');
            if (failed === 0) return `Status updated for ${succeeded} ${noun(succeeded)}.`;
            if (succeeded === 0) return `Status change failed for ${failed} ${noun(failed)}.`;
            return `Status updated for ${succeeded}, ${failed} failed.`;
        }
        if (statusTransitionError) return statusTransitionError;
        return '';
    })();
    const statusFeedbackIsError = Boolean(statusTransitionErrorCode || statusTransitionError);

    return (
        <div className="planning-actions">
            <button
                className={`planning-action-button ${isAcceptedIncluded ? 'active' : ''}`}
                onClick={onToggleAccepted}
                disabled={!hasVisibleTasks}
                title="Include all Accepted and In Progress stories for the current view"
            >
                Accepted
            </button>
            <button
                className={`planning-action-button ${isTodoIncluded ? 'active' : ''}`}
                onClick={onToggleTodo}
                disabled={!hasVisibleTasks}
                title="Include all To Do / Pending stories for the current view"
            >
                To Do
            </button>
            <button
                className={`planning-action-button ${isPostponedIncluded ? 'active' : ''}`}
                onClick={onTogglePostponed}
                disabled={!hasPostponedTasks}
                title="Include all Postponed stories for the current view"
            >
                Postponed
            </button>
            <button
                className={`planning-action-button ${isAwaitingValidationIncluded ? 'active' : ''}`}
                onClick={onToggleAwaitingValidation}
                disabled={!hasAwaitingValidationTasks}
                title="Include all Awaiting Validation stories for the current view"
            >
                Awaiting Val.
            </button>
            <button
                className={`planning-action-button ${areAllVisiblePlanningTasksSelected ? 'active' : ''}`}
                onClick={onSelectAllVisible}
                disabled={!hasVisiblePlanningTasks}
                title="Select every task currently visible in the planning list"
            >
                Select All
            </button>
            <button
                className="planning-action-button"
                onClick={onUndoPlanningSelection}
                disabled={!canUndoPlanningSelection}
                title="Undo bulk selection changes and restore the loaded planning selection"
            >
                Undo
            </button>
            <button
                className="uncheck-button"
                onClick={onClearSelected}
                disabled={selectedCount === 0}
                title="Clear all selected tasks"
            >
                Clear Selected
            </button>
            <button
                className="planning-action-button planning-icon-button"
                onClick={onOpenSelectedInJira}
                disabled={selectedCount === 0 || !jiraUrl}
                title="Open selected stories in Jira (tip: bulk move them to Accepted)"
                aria-label="Open selected stories in Jira"
            >
                <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M10 2h4v4h-1.5V4.56L8.53 8.53l-1.06-1.06L11.44 3.5H10V2z" />
                    <path d="M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4v1.5H3.5v8h8V9H13z" />
                </svg>
            </button>
            {onTogglePlanningLayout && <PlanningLayoutToggle planningLayout={planningLayout} onTogglePlanningLayout={onTogglePlanningLayout} />}
            {statusFeedback && (
                <span
                    className={`planning-status-feedback${statusFeedbackIsError ? ' is-error' : ''}`}
                    role="status"
                    aria-live="polite"
                >
                    {statusFeedback}
                </span>
            )}
            {panelControl}
        </div>
    );
}
