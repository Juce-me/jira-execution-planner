import * as React from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import { getIssueStatusClassName, getIssueTeamLabel, normalizeIssueStatus } from './issueViewUtils.js';
import IssueDependencies, { buildIssueDependencyViewModel } from './IssueDependencies.jsx';
import { buildStorySubtaskProgress, formatSubtaskUpdatedDate } from './subtaskProgressUtils.js';

export const IssueCardContext = React.createContext({});

export default function IssueCard({
    task,
    jiraUrl,
    teamInfo,
    teamLabel,
    statusClassName,
    renderPriorityIcon = () => null,
    showPlanning = false,
    allowSelection = false,
    isSelected = false,
    onToggleSelection,
    onRemove,
    shouldRenderIssueDependencies = false,
    dependencyContext = {},
    subtaskState = null,
    onToggleSubtasks,
    onRetrySubtasks,
}) {
    const statusName = task.fields.status?.name;
    const isKilled = statusName === 'Killed';
    const isDone = statusName === 'Done';
    const isIncomplete = normalizeIssueStatus(statusName) === 'incomplete';
    const canSelect = showPlanning || allowSelection;
    const embeddedSubtaskSummary = task.fields.subtaskSummary || null;
    const activeSubtaskSummary = subtaskState?.summary || embeddedSubtaskSummary;
    const subtaskProgress = buildStorySubtaskProgress(activeSubtaskSummary);
    const showSubtaskControl = subtaskProgress.total > 0 || subtaskState?.expanded || subtaskState?.loading;
    const subtaskPanelId = `story-subtasks-${task.key}`;
    const subtaskCountLabel = `${subtaskProgress.total} ${subtaskProgress.total === 1 ? 'subtask' : 'subtasks'}`;
    const subtaskToggle = showSubtaskControl ? (
        <button
            type="button"
            className={`story-subtasks-toggle${subtaskState?.expanded ? ' is-expanded' : ''}`}
            onClick={(event) => {
                event.stopPropagation();
                onToggleSubtasks?.(task);
            }}
            aria-expanded={!!subtaskState?.expanded}
            aria-controls={subtaskPanelId}
            aria-label={`${subtaskState?.expanded ? 'Hide' : 'Show'} subtasks for ${task.key}`}
        >
            <span className="story-subtasks-count">{subtaskCountLabel}</span>
            <span className="story-subtasks-progress" aria-hidden="true">
                <span className="story-subtasks-progress-track">
                    {subtaskProgress.hasDone && (
                        <span className="story-subtasks-progress-segment story-subtasks-progress-done" style={{ width: subtaskProgress.doneWidth }} />
                    )}
                    {subtaskProgress.hasInProgress && (
                        <span className="story-subtasks-progress-segment story-subtasks-progress-in-progress" style={{ width: subtaskProgress.inProgressWidth }} />
                    )}
                </span>
                <span className="story-subtasks-progress-percent">{subtaskProgress.percentLabel}</span>
            </span>
        </button>
    ) : null;
    const dependencyModel = buildIssueDependencyViewModel({
        task,
        shouldRender: shouldRenderIssueDependencies,
        entries: dependencyContext.dependencyData?.[task.key] || [],
        dependencyFocus: dependencyContext.dependencyFocus,
        dependencyHover: dependencyContext.dependencyHover,
        activeDependencyFocus: dependencyContext.activeDependencyFocus,
        focusRelatedSet: dependencyContext.focusRelatedSet,
        issueByKey: dependencyContext.issueByKey,
        visibleTaskKeySet: dependencyContext.visibleTaskKeySet,
        dependencyLookupCache: dependencyContext.dependencyLookupCache,
        normalizeStatus: dependencyContext.normalizeStatus || normalizeIssueStatus,
        getTeamInfo: dependencyContext.getTeamInfo,
    });

    return (
        <div
            className={`task-item priority-${task.fields.priority?.name.toLowerCase()} ${isDone ? 'status-done' : ''} ${isKilled ? 'status-killed' : ''} ${isIncomplete ? 'status-incomplete' : ''} ${dependencyModel.isFocusActive && !dependencyModel.isRelated ? 'is-dimmed' : ''} ${dependencyModel.isFocused ? 'is-focused' : ''} ${dependencyModel.isUpstream ? 'is-upstream' : ''} ${dependencyModel.isDownstream ? 'is-downstream' : ''}`}
            data-task-key={task.key}
            data-task-id={task.id || task.key}
            data-issue-key={task.key}
        >
            <div className="task-header">
                {onRemove && (
                    <button
                        className="task-remove"
                        onClick={() => onRemove(task)}
                        title="Remove task from view"
                    >
                        &times;
                    </button>
                )}
                <div className="task-headline">
                    <span className="story-icon" aria-hidden="true" title="STORY">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M7 4h10a2 2 0 012 2v14l-7-4-7 4V6a2 2 0 012-2z" stroke="#55A630" strokeWidth="2" strokeLinejoin="round"/>
                        </svg>
                    </span>
                    {renderPriorityIcon(task.fields.priority?.name, task.key)}
                    <h3 className="task-title">
                        {isIncomplete && <span className="task-incomplete-icon" title="Incomplete - work started but not finished this sprint">&#9680;</span>}
                        <a
                            href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={task.fields.summary || task.key}
                            aria-label={task.fields.summary || task.key}
                        >
                            {task.fields.summary}
                        </a>
                    </h3>
                    <span className="task-inline-meta">
                        <a
                            className="task-key-link"
                            href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {task.key}
                        </a>
                        {task.fields.customfield_10004 && (
                            <span className="task-inline-sp">
                                {task.fields.customfield_10004} SP
                            </span>
                        )}
                    </span>
                    {canSelect && (
                        <input
                            type="checkbox"
                            className="task-checkbox"
                            checked={isSelected}
                            onChange={() => onToggleSelection(task.key)}
                            title="Select for sprint planning"
                        />
                    )}
                </div>
                <div className="task-header-right">
                    <IssueDependencies
                        task={task}
                        jiraUrl={jiraUrl}
                        model={dependencyModel}
                        placement="header"
                    />
                </div>
            </div>
            <div className="task-meta">
                <StatusPill
                    className={statusClassName || getIssueStatusClassName(statusName)}
                    label={statusName}
                />
                <span className="task-team">{teamLabel || getIssueTeamLabel(teamInfo)}</span>
                {task.fields.assignee && (
                    <span className="task-assignee">
                        <span className="task-assignee-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none">
                                <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Z" stroke="currentColor" strokeWidth="1.6"/>
                                <path d="M4 20c1.8-4 6-5.5 8-5.5S18.2 16 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                            </svg>
                        </span>
                        {task.fields.assignee.displayName}
                    </span>
                )}
                {task.fields.updated && (
                    <span className="task-updated">
                        Last Update: {new Date(task.fields.updated).toLocaleDateString('en-CA')}
                    </span>
                )}
                {subtaskToggle && (
                    <span className="task-subtask-meta">
                        {subtaskToggle}
                    </span>
                )}
            </div>
            <IssueDependencies
                task={task}
                jiraUrl={jiraUrl}
                model={dependencyModel}
                placement="details"
                dependencyLookupLoading={dependencyContext.dependencyLookupLoading}
                onHoverEnter={dependencyContext.onHoverEnter}
                onHoverLeave={dependencyContext.onHoverLeave}
            />
            {subtaskState?.expanded && (
                <div id={subtaskPanelId} className="story-subtasks-panel" aria-live="polite">
                    {subtaskState.loading ? (
                        <div className="story-subtasks-message">Loading subtasks...</div>
                    ) : subtaskState.error ? (
                        <div className="story-subtasks-message story-subtasks-error">
                            <span>{subtaskState.error}</span>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRetrySubtasks?.(task);
                                }}
                            >
                                Retry
                            </button>
                        </div>
                    ) : (subtaskState.items || []).length === 0 ? (
                        <div className="story-subtasks-message">No subtasks in selected sprint.</div>
                    ) : (
                        <div className="story-subtasks-rows">
                            {subtaskState.items.map((subtask) => (
                                <div key={subtask.key || subtask.id} className="story-subtask-row">
                                    <a
                                        className="story-subtask-name"
                                        href={jiraUrl ? `${jiraUrl}/browse/${subtask.key}` : '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {subtask.summary || subtask.key}
                                    </a>
                                    <StatusPill
                                        className={getIssueStatusClassName(subtask.status?.name)}
                                        label={subtask.status?.name || 'Unknown'}
                                    />
                                    <span className="story-subtask-assignee">{subtask.assignee?.displayName || 'Unassigned'}</span>
                                    {subtask.updated ? (
                                        <time className="story-subtask-updated" dateTime={subtask.updated}>
                                            {formatSubtaskUpdatedDate(subtask.updated)}
                                        </time>
                                    ) : (
                                        <span className="story-subtask-updated">No update</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
