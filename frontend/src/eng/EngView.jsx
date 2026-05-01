import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';

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
}) {
    if (selectedView !== 'eng') {
        return null;
    }

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
                <div className="loading">Loading tasks...</div>
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
                            <div className="stats">
                                <div
                                    className={`stat-card total ${statusFilter === null ? 'active' : ''} ${baseFilteredTasks.length === 0 ? 'disabled' : ''}`}
                                    onClick={() => {
                                        if (baseFilteredTasks.length === 0) return;
                                        setStatusFilter(null);
                                    }}
                                >
                                    <div className="stat-value">{baseFilteredTasks.length}</div>
                                    <div className="stat-label">Total Tasks</div>
                                    <div className="stats-note">{totalStoryPoints.toFixed(1)} SP</div>
                                </div>
                                <div
                                    className={`stat-card done ${statusFilter === 'done' ? 'active' : ''} ${doneTasksCount === 0 ? 'disabled' : ''}`}
                                    onClick={() => {
                                        if (doneTasksCount === 0) return;
                                        setStatusFilter(statusFilter === 'done' ? null : 'done');
                                    }}
                                >
                                    <div className="stat-value">{doneTasksCount}</div>
                                    <div className="stat-label">Done Tasks</div>
                                    <div className="stats-note">{doneStoryPoints.toFixed(1)} SP</div>
                                </div>
                                <div
                                    className={`stat-card high-priority ${statusFilter === 'high-priority' ? 'active' : ''} ${highPriorityCount === 0 ? 'disabled' : ''}`}
                                    onClick={() => {
                                        if (highPriorityCount === 0) return;
                                        setStatusFilter(statusFilter === 'high-priority' ? null : 'high-priority');
                                    }}
                                >
                                    <div className="stat-value">{highPriorityCount}</div>
                                    <div className="stat-label">High Priority</div>
                                    <div className="stats-note">{highPriorityStoryPoints.toFixed(1)} SP</div>
                                </div>
                                <div
                                    className={`stat-card minor ${statusFilter === 'minor-priority' ? 'active' : ''} ${minorPriorityCount === 0 ? 'disabled' : ''}`}
                                    onClick={() => {
                                        if (minorPriorityCount === 0) return;
                                        setStatusFilter(statusFilter === 'minor-priority' ? null : 'minor-priority');
                                    }}
                                >
                                    <div className="stat-value">{minorPriorityCount}</div>
                                    <div className="stat-label">Minor + Lower</div>
                                    <div className="stats-note">{minorPriorityStoryPoints.toFixed(1)} SP</div>
                                </div>
                                <div
                                    className={`stat-card in-progress ${statusFilter === 'in-progress' ? 'active' : ''} ${inProgressTasksCount === 0 ? 'disabled' : ''}`}
                                    onClick={() => {
                                        if (inProgressTasksCount === 0) return;
                                        setStatusFilter(statusFilter === 'in-progress' ? null : 'in-progress');
                                    }}
                                >
                                    <div className="stat-value">{inProgressTasksCount}</div>
                                    <div className="stat-label">In Progress</div>
                                    <div className="stats-note">{inProgressStoryPoints.toFixed(1)} SP</div>
                                </div>
                                <div
                                    className={`stat-card todo-accepted ${statusFilter === 'todo-accepted' ? 'active' : ''} ${todoAcceptedTasksCount === 0 ? 'disabled' : ''}`}
                                    onClick={() => {
                                        if (todoAcceptedTasksCount === 0) return;
                                        setStatusFilter(statusFilter === 'todo-accepted' ? null : 'todo-accepted');
                                    }}
                                >
                                    <div className="stat-value">{todoAcceptedTasksCount}</div>
                                    <div className="stat-label">To Do / Pending / Accepted</div>
                                    <div className="stats-note">{todoAcceptedStoryPoints.toFixed(1)} SP</div>
                                </div>
                            </div>
                        </div>
                        <div className="filters-group">
                            <div className="filters-label">Display</div>
                            <div className="toggle-container">
                                <button
                                    className={`toggle ${showTech ? 'active' : ''}`}
                                    onClick={() => {
                                        setShowTech(!showTech);
                                    }}
                                >
                                    {`Tech (${techTasksCount})`}
                                </button>
                                <button
                                    className={`toggle ${showProduct ? 'active' : ''}`}
                                    onClick={() => setShowProduct(!showProduct)}
                                >
                                    {`Product (${productTasksCount})`}
                                </button>
                                {(doneTasks.length > 0 || incompleteTasks.length > 0) && (
                                    <button
                                        className={`toggle ${showDone ? 'active' : ''}`}
                                        onClick={() => setShowDone(!showDone)}
                                    >
                                        {`Done / Incomplete (${doneTasks.length + incompleteTasks.length})`}
                                    </button>
                                )}
                                {killedTasks.length > 0 && (
                                    <button
                                        className={`toggle ${showKilled ? 'active' : ''}`}
                                        onClick={() => setShowKilled(!showKilled)}
                                    >
                                        {`Killed (${killedTasks.length})`}
                                    </button>
                                )}
                                {hasInitiativeData && (
                                    <button
                                        className={`toggle initiative-toggle ${groupByInitiative ? 'active' : ''}`}
                                        onClick={() => setGroupByInitiative(prev => !prev)}
                                        title={groupByInitiative ? 'Switch to flat epic view' : 'Group epics by initiative'}
                                        type="button"
                                    >
                                        <InitiativeIcon className="initiative-toggle-icon" size={12} />
                                        Initiatives
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {visibleTasksForList.length === 0 ? (
                        <EmptyState title="No tasks found">
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
                        <button onClick={onRetry}>
                            Refresh
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
