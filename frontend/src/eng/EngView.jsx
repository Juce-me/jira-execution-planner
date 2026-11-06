import * as React from 'react';
import IssueCard from '../issues/IssueCard.jsx';
import WorkTypeGlyph from '../issues/WorkTypeGlyph.jsx';
import { subscribeEngReading, getEngReadingPresentation } from './engReadingAnchor.js';
import EmptyState from '../ui/EmptyState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import AlertPinBar from './AlertPinBar.jsx';
import { WORK_MODEL_LEGACY, entityArticle, formatEntityCount, resolveEntityNames } from './engWorkModel.js';

const LEGACY_NAMES = resolveEntityNames(WORK_MODEL_LEGACY);

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
    alertPin = null,
    alertPinStyle,
    onPinBack,
    onPinClose,
    onPinOpen,
    InitiativeIcon,
    visibleTasksForList = [],
    hierarchyCounts = null,
    readinessStatus = 'idle',
    readinessError = '',
    onRetryReadiness,
    dependenciesIncomplete = false,
    onRetryDependencies,
    workTypes = null,
    entityNames = null,
    activeDependencyFocus,
    handleDependencyFocusClick,
    initiativeGroups,
    epicGroups = [],
    renderEpicBlock,
    jiraUrl,
    onClearFilters,
    planningTable = null,
}) {
    const readingPresentation = React.useSyncExternalStore(subscribeEngReading, getEngReadingPresentation, () => null);
    const departedTask = readingPresentation?.departure;
    const detachedDeparture = departedTask && !(planningTable && readingPresentation.rowKey) && (planningTable || !epicGroups.some(group => group.key === readingPresentation.epicKey));
    if (selectedView !== 'eng') {
        return null;
    }
    const visibleRowCount = Number.isFinite(hierarchyCounts?.visibleRows)
        ? hierarchyCounts.visibleRows
        : visibleTasksForList.length;
    const hasNoVisibleTasks = visibleRowCount === 0;
    const names = entityNames || LEGACY_NAMES;
    const readinessNeedsAttention = !['idle', 'loading', 'ready'].includes(readinessStatus);
    // New-model links whose Jira parent is not of the configured type (the server reports none for Legacy).
    const mismatches = entityNames ? workTypes?.linkMismatches : null;
    const linkNotices = mismatches ? [['child', 'parent', mismatches.parentCount], ['parent', 'ancestor', mismatches.ancestorCount]]
        .filter(([, , count]) => count > 0)
        .map(([role, parentRole, count]) => `${formatEntityCount(count, entityNames, role)} in this view ${count === 1 ? 'has' : 'have'} a Jira parent that is not ${entityArticle(entityNames[parentRole])} ${entityNames[parentRole]}. An administrator can review Field mapping in Settings.`) : [];

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

            {alertPin && <AlertPinBar pin={alertPin} style={alertPinStyle} onBack={onPinBack} onClose={onPinClose} onOpen={onPinOpen} />}

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
                            <span>{readinessError || `${names.child} readiness is unavailable. Jira ${names.childPlural} remain visible.`}</span>
                            {readinessStatus === 'unavailable' && onRetryReadiness && (
                                <button type="button" className="secondary compact" onClick={onRetryReadiness}>Retry</button>
                            )}
                        </div>
                    )}
                    {dependenciesIncomplete && (
                        <div className="story-readiness-notice" role="status">
                            <span>Some dependencies could not be loaded.</span>
                            <button type="button" className="secondary compact" onClick={onRetryDependencies}>Retry</button>
                        </div>
                    )}
                    {linkNotices.map(text => (
                        <div key={text} className="story-readiness-notice" role="status"><span>{text}</span></div>
                    ))}

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
                                                        {names.ancestorTypeId ? (
                                                            <span className="initiative-icon initiative-header-icon" aria-hidden="true" title={names.ancestor.toUpperCase()}>
                                                                <WorkTypeGlyph level={names.ancestorLevel} typeId={names.ancestorTypeId} InitiativeIcon={InitiativeIcon} size={14} />
                                                            </span>
                                                        ) : <InitiativeIcon className="initiative-header-icon" title={names.ancestor.toUpperCase()} />}
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

                    {detachedDeparture && <IssueCard task={departedTask} jiraUrl={jiraUrl} teamLabel={departedTask.fields?.teamName || ''} readingDeparture entityNames={names} InitiativeIcon={InitiativeIcon} />}

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
