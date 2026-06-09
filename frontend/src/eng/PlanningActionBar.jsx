import * as React from 'react';

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
}) {
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
        </div>
    );
}
