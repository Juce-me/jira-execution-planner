import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import LoadingState from '../ui/LoadingState.jsx';

export default function EngView({
    selectedView,
    productTasksLoading,
    techTasksLoading,
    loading,
    error,
    onRetry,
    alertCelebrationPieces = [],
    alertsPanel,
    statusFilter,
    setStatusFilter,
    baseFilteredTasks = [],
    totalStoryPoints = 0,
    doneTasksCount = 0,
    doneStoryPoints = 0,
    highPriorityCount = 0,
    highPriorityStoryPoints = 0,
    minorPriorityCount = 0,
    minorPriorityStoryPoints = 0,
    inProgressTasksCount = 0,
    inProgressStoryPoints = 0,
    todoAcceptedTasksCount = 0,
    todoAcceptedStoryPoints = 0,
    showTech,
    setShowTech,
    techTasksCount = 0,
    showProduct,
    setShowProduct,
    productTasksCount = 0,
    doneTasks = [],
    incompleteTasks = [],
    showDone,
    setShowDone,
    killedTasks = [],
    showKilled,
    setShowKilled,
    hasInitiativeData,
    groupByInitiative,
    setGroupByInitiative,
    InitiativeIcon,
    visibleTasksForList = [],
    activeDependencyFocus,
    handleDependencyFocusClick,
    initiativeGroups,
    epicGroups = [],
    renderEpicBlock,
    jiraUrl,
    onClearFilters,
}) {
    if (selectedView !== 'eng') {
        return null;
    }
    const hasNoVisibleTasks = visibleTasksForList.length === 0;
    const appliedFilterClass = (active) => (active ? ' applied-filter' : '');

    return (
        <>
            {(productTasksLoading || techTasksLoading) && (
                <div className="loading-status" style={{
                    padding: '0.5rem 1rem',
                    background: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '0.5rem',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)'
                }}>
                    {productTasksLoading && <div>⏳ Loading product tasks...</div>}
                    {techTasksLoading && <div>⏳ Loading tech tasks...</div>}
                </div>
            )}

            {loading ? (
                <LoadingState
                    title="Loading tasks"
                    message="Refreshing Jira sprint work."
                />
            ) : error ? (
                <div className="error">
                    {error}
                    <div style={{ marginTop: '1rem' }}>
                        <button onClick={onRetry}>Retry</button>
                    </div>
                </div>
            ) : (
                <>
                    {alertCelebrationPieces.length > 0 && (
                        <div className="alert-celebration" aria-hidden="true">
                            {alertCelebrationPieces.map(piece => (
                                <span
                                    key={piece.id}
                                    className="alert-confetti"
                                    style={{
                                        '--confetti-left': `${piece.left}%`,
                                        '--confetti-size': `${piece.size}px`,
                                        '--confetti-height': `${piece.height}px`,
                                        '--confetti-color': piece.color,
                                        '--confetti-rot': `${piece.rotate}deg`,
                                        '--confetti-drift': `${piece.drift}px`,
                                        '--confetti-fall': `${piece.duration}s`,
                                        '--confetti-delay': `${piece.delay}s`,
                                        borderRadius: piece.shape === 'round' ? '999px' : '2px',
                                        clipPath: piece.shape === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : 'none'
                                    }}
                                />
                            ))}
                        </div>
                    )}
                    {alertsPanel}
                    <div className="filters-strip">
                        <div className="filters-group">
                            <div className="filters-label">Show only</div>
                            <div className="stats status-filter-grid">
                                <button
                                    type="button"
                                    className={`stat-card total ${statusFilter === null ? 'active' : ''} ${baseFilteredTasks.length === 0 ? 'disabled' : ''}`}
                                    disabled={baseFilteredTasks.length === 0}
                                    aria-pressed={statusFilter === null}
                                    aria-label="Show all included tasks"
                                    title="Show all included tasks"
                                    onClick={() => {
                                        if (baseFilteredTasks.length === 0) return;
                                        setStatusFilter(null);
                                    }}
                                >
                                    <span className="stat-value">{baseFilteredTasks.length}</span>
                                    <span className="stat-label">Total</span>
                                    <span className="stats-note">{totalStoryPoints.toFixed(1)} SP</span>
                                </button>
                                <button
                                    type="button"
                                    className={`stat-card done ${statusFilter === 'done' ? 'active' : ''}${appliedFilterClass(statusFilter === 'done')} ${doneTasksCount === 0 ? 'disabled' : ''}`}
                                    disabled={doneTasksCount === 0}
                                    aria-pressed={statusFilter === 'done'}
                                    aria-label="Show only Done tasks"
                                    title="Done"
                                    onClick={() => {
                                        if (doneTasksCount === 0) return;
                                        setStatusFilter(statusFilter === 'done' ? null : 'done');
                                    }}
                                >
                                    <span className="stat-value">{doneTasksCount}</span>
                                    <span className="stat-label">Done</span>
                                    <span className="stats-note">{doneStoryPoints.toFixed(1)} SP</span>
                                </button>
                                <button
                                    type="button"
                                    className={`stat-card high-priority ${statusFilter === 'high-priority' ? 'active' : ''}${appliedFilterClass(statusFilter === 'high-priority')} ${highPriorityCount === 0 ? 'disabled' : ''}`}
                                    disabled={highPriorityCount === 0}
                                    aria-pressed={statusFilter === 'high-priority'}
                                    aria-label="Show only high priority tasks"
                                    title="High priority"
                                    onClick={() => {
                                        if (highPriorityCount === 0) return;
                                        setStatusFilter(statusFilter === 'high-priority' ? null : 'high-priority');
                                    }}
                                >
                                    <span className="stat-value">{highPriorityCount}</span>
                                    <span className="stat-label">High Priority</span>
                                    <span className="stats-note">{highPriorityStoryPoints.toFixed(1)} SP</span>
                                </button>
                                <button
                                    type="button"
                                    className={`stat-card minor ${statusFilter === 'minor-priority' ? 'active' : ''}${appliedFilterClass(statusFilter === 'minor-priority')} ${minorPriorityCount === 0 ? 'disabled' : ''}`}
                                    disabled={minorPriorityCount === 0}
                                    aria-pressed={statusFilter === 'minor-priority'}
                                    aria-label="Show only minor and lower priority tasks"
                                    title="Minor and lower priority"
                                    onClick={() => {
                                        if (minorPriorityCount === 0) return;
                                        setStatusFilter(statusFilter === 'minor-priority' ? null : 'minor-priority');
                                    }}
                                >
                                    <span className="stat-value">{minorPriorityCount}</span>
                                    <span className="stat-label">Minor + Lower</span>
                                    <span className="stats-note">{minorPriorityStoryPoints.toFixed(1)} SP</span>
                                </button>
                                <button
                                    type="button"
                                    className={`stat-card in-progress ${statusFilter === 'in-progress' ? 'active' : ''}${appliedFilterClass(statusFilter === 'in-progress')} ${inProgressTasksCount === 0 ? 'disabled' : ''}`}
                                    disabled={inProgressTasksCount === 0}
                                    aria-pressed={statusFilter === 'in-progress'}
                                    aria-label="Show only In Progress tasks"
                                    title="In Progress"
                                    onClick={() => {
                                        if (inProgressTasksCount === 0) return;
                                        setStatusFilter(statusFilter === 'in-progress' ? null : 'in-progress');
                                    }}
                                >
                                    <span className="stat-value">{inProgressTasksCount}</span>
                                    <span className="stat-label">In Progress</span>
                                    <span className="stats-note">{inProgressStoryPoints.toFixed(1)} SP</span>
                                </button>
                                <button
                                    type="button"
                                    className={`stat-card todo-accepted ${statusFilter === 'todo-accepted' ? 'active' : ''}${appliedFilterClass(statusFilter === 'todo-accepted')} ${todoAcceptedTasksCount === 0 ? 'disabled' : ''}`}
                                    disabled={todoAcceptedTasksCount === 0}
                                    aria-pressed={statusFilter === 'todo-accepted'}
                                    aria-label="Show only To Do, Pending, and Accepted tasks"
                                    title="To Do, Pending, and Accepted"
                                    onClick={() => {
                                        if (todoAcceptedTasksCount === 0) return;
                                        setStatusFilter(statusFilter === 'todo-accepted' ? null : 'todo-accepted');
                                    }}
                                >
                                    <span className="stat-value">{todoAcceptedTasksCount}</span>
                                    <span className="stat-label">Queued</span>
                                    <span className="stats-note">{todoAcceptedStoryPoints.toFixed(1)} SP</span>
                                </button>
                            </div>
                        </div>
                        <div className="filters-group">
                            <div className="filters-label">Display</div>
                            <div className="stats display-filter-grid">
                                <button
                                    type="button"
                                    className={`stat-card display-filter-card display-tech ${showTech ? 'is-visible' : 'is-hidden'}${appliedFilterClass(!showTech)}`}
                                    aria-pressed={showTech}
                                    aria-label={showTech ? 'Hide Tech tasks' : 'Show Tech tasks'}
                                    onClick={() => {
                                        setShowTech(!showTech);
                                    }}
                                >
                                    <span className="stat-value">{techTasksCount}</span>
                                    <span className="stat-label">Tech</span>
                                    <span className="stats-note">{showTech ? 'Shown' : 'Hidden'}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`stat-card display-filter-card display-product ${showProduct ? 'is-visible' : 'is-hidden'}${appliedFilterClass(!showProduct)}`}
                                    aria-pressed={showProduct}
                                    aria-label={showProduct ? 'Hide Product tasks' : 'Show Product tasks'}
                                    onClick={() => setShowProduct(!showProduct)}
                                >
                                    <span className="stat-value">{productTasksCount}</span>
                                    <span className="stat-label">Product</span>
                                    <span className="stats-note">{showProduct ? 'Shown' : 'Hidden'}</span>
                                </button>
                                {(doneTasks.length > 0 || incompleteTasks.length > 0) && (
                                    <button
                                        type="button"
                                        className={`stat-card display-filter-card display-closed-work ${showDone ? 'is-visible' : 'is-hidden'}${appliedFilterClass(!showDone)}`}
                                        aria-pressed={showDone}
                                        aria-label="Include Done and Incomplete tasks"
                                        title="Include Done and Incomplete tasks"
                                        onClick={() => setShowDone(!showDone)}
                                    >
                                        <span className="stat-value">{doneTasks.length + incompleteTasks.length}</span>
                                        <span className="stat-label">Closed Work</span>
                                        <span className="stats-note">{showDone ? 'Shown' : 'Hidden'}</span>
                                    </button>
                                )}
                                {killedTasks.length > 0 && (
                                    <button
                                        type="button"
                                        className={`stat-card display-filter-card display-killed ${showKilled ? 'is-visible' : 'is-hidden'}${appliedFilterClass(showKilled)}`}
                                        aria-pressed={showKilled}
                                        aria-label="Include Killed tasks"
                                        title="Include Killed tasks"
                                        onClick={() => setShowKilled(!showKilled)}
                                    >
                                        <span className="stat-value">{killedTasks.length}</span>
                                        <span className="stat-label">Killed</span>
                                        <span className="stats-note">{showKilled ? 'Shown' : 'Hidden'}</span>
                                    </button>
                                )}
                                {hasInitiativeData && (
                                    <button
                                        className={`stat-card display-filter-card display-initiative ${groupByInitiative ? 'active' : ''}`}
                                        aria-pressed={groupByInitiative}
                                        onClick={() => setGroupByInitiative(prev => !prev)}
                                        title={groupByInitiative ? 'Switch to flat epic view' : 'Group epics by initiative'}
                                        type="button"
                                    >
                                        <span className="stat-value display-filter-icon">
                                            <InitiativeIcon className="initiative-toggle-icon" size={14} />
                                        </span>
                                        <span className="stat-label">Initiatives</span>
                                        <span className="stats-note">{groupByInitiative ? 'Grouped' : 'Flat'}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {hasNoVisibleTasks ? (
                        <EmptyState title="No tasks found" className="eng-empty-results">
                            <p>There are no tasks matching the current criteria</p>
                        </EmptyState>
                    ) : (
                        <div
                            className={`task-list ${activeDependencyFocus ? 'focus-mode' : ''}`}
                            onClick={handleDependencyFocusClick}
                        >
                            {initiativeGroups ? (
                                initiativeGroups.map(ig => {
                                    const ini = ig.initiative;
                                    const isMultiEpic = ini && ig.epicGroups.length > 1;
                                    return (
                                        <div
                                            key={ini ? ini.key : 'no-initiative'}
                                            className={ini ? (isMultiEpic ? 'initiative-group' : 'initiative-group initiative-single') : ''}
                                        >
                                            {ini && (
                                                <>
                                                    <div className="initiative-header">
                                                        <InitiativeIcon className="initiative-header-icon" />
                                                        <div className={`initiative-label ${isMultiEpic ? '' : 'initiative-label-only'}`}>
                                                            <span className="initiative-label-name">{ini.summary}</span>
                                                            <a
                                                                className="initiative-label-key"
                                                                href={jiraUrl ? `${jiraUrl}/browse/${ini.key}` : '#'}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                {ini.key} ↗
                                                            </a>
                                                            <span className="initiative-divider" />
                                                        </div>
                                                    </div>
                                                    <div className="initiative-body">
                                                        {ig.epicGroups.map(epicGroup => renderEpicBlock(epicGroup))}
                                                    </div>
                                                </>
                                            )}
                                            {!ini && ig.epicGroups.map(epicGroup => renderEpicBlock(epicGroup))}
                                        </div>
                                    );
                                })
                            ) : (
                                epicGroups.map(epicGroup => renderEpicBlock(epicGroup))
                            )}
                        </div>
                    )}

                    <div style={{marginTop: '3rem', textAlign: 'center'}}>
                        <button onClick={hasNoVisibleTasks && onClearFilters ? onClearFilters : onRetry}>
                            {hasNoVisibleTasks && onClearFilters ? 'Clear all filters' : 'Refresh'}
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
