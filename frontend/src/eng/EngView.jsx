import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import LoadingState from '../ui/LoadingState.jsx';

export default function EngView({
    selectedView,
    sprintCatalogLoading,
    productTasksLoading,
    techTasksLoading,
    loading,
    error,
    onRetry,
    alertCelebrationPieces = [],
    alertsPanel,
    InitiativeIcon,
    visibleTasksForList = [],
    hierarchyCounts = null,
    readinessStatus = 'idle',
    readinessError = '',
    onRetryReadiness,
    activeDependencyFocus,
    handleDependencyFocusClick,
    initiativeGroups,
    epicGroups = [],
    renderEpicBlock,
    jiraUrl,
    onClearFilters,
    planningTable = null,
}) {
    if (selectedView !== 'eng') {
        return null;
    }
    const visibleRowCount = Number.isFinite(hierarchyCounts?.visibleRows)
        ? hierarchyCounts.visibleRows
        : visibleTasksForList.length;
    const hasNoVisibleTasks = visibleRowCount === 0;
    const readinessNeedsAttention = !['idle', 'loading', 'ready'].includes(readinessStatus);

    if (sprintCatalogLoading) {
        return <LoadingState title="Loading sprints" message="Resolving sprint values from Jira." />;
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
                    {readinessNeedsAttention && (
                        <div className="story-readiness-notice" role="status">
                            <span>{readinessError || 'Story readiness is unavailable. Jira Stories remain visible.'}</span>
                            {readinessStatus === 'unavailable' && onRetryReadiness && (
                                <button type="button" className="secondary compact" onClick={onRetryReadiness}>Retry</button>
                            )}
                        </div>
                    )}

                    {planningTable || (hasNoVisibleTasks ? (
                        <EmptyState title="No tasks found" className="eng-empty-results">
                            <p>There are no tasks matching the current criteria</p>
                        </EmptyState>
                    ) : (
                        <div
                            className={`task-list ${activeDependencyFocus ? 'focus-mode' : ''}`}
                            data-onboarding-target="hierarchy"
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
                                                    <div className="initiative-header" data-onboarding-target="hierarchy-initiative">
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
                    ))}

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
