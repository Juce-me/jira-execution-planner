import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import IconButton from '../ui/IconButton.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import EngFilterBar from './EngFilterBar.jsx';
import { ENG_EPIC_SORT_OPTIONS, getEngEpicSortLabel } from './engTaskUtils.js';

export default function EngView({
    selectedView,
    productTasksLoading,
    techTasksLoading,
    loading,
    error,
    onRetry,
    alertCelebrationPieces = [],
    alertsPanel,
    engFilters,
    onFacetChange,
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
    onClearFacets,
    onClearFilters,
    engEpicSort,
    setEngEpicSort,
    onFilterBarHeightChange,
}) {
    if (selectedView !== 'eng') {
        return null;
    }
    const hasNoVisibleTasks = visibleTasksForList.length === 0;

    const [showSortDropdown, setShowSortDropdown] = React.useState(false);
    const sortDropdownRef = React.useRef(null);
    React.useEffect(() => {
        if (!showSortDropdown) return undefined;
        const onDocClick = (e) => {
            if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target)) {
                setShowSortDropdown(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [showSortDropdown]);

    const selectEngEpicSort = (value) => {
        setEngEpicSort(value);   // dashboard handler also fires the sort_changed analytics event
        setShowSortDropdown(false);
    };

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
                    <EngFilterBar
                        facets={engFilters.facets}
                        selection={engFilters.selection}
                        counts={engFilters.counts}
                        scopeTotal={engFilters.scopeTotal}
                        subject={engFilters.subject}
                        readoutCount={visibleTasksForList.length}
                        readoutUnit={engFilters.readoutUnit}
                        onChange={onFacetChange}
                        onClearAll={onClearFacets}
                        onHeightChange={onFilterBarHeightChange}
                        viewControls={(
                            <>
                                <div className="sprint-dropdown sprint-dropdown-compact eng-epic-sort-dropdown" ref={sortDropdownRef}>
                                    <div
                                        className={`sprint-dropdown-toggle ${showSortDropdown ? 'open' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        aria-label="Sort epics"
                                        aria-expanded={showSortDropdown}
                                        onClick={() => setShowSortDropdown(v => !v)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowSortDropdown(v => !v); } }}
                                    >
                                        <span className="cap">Sort</span>
                                        <span>{getEngEpicSortLabel(engEpicSort)}</span>
                                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 9L1 4h10z" /></svg>
                                    </div>
                                    {showSortDropdown && (
                                        <div className="sprint-dropdown-panel">
                                            <div className="sprint-dropdown-list">
                                                {ENG_EPIC_SORT_OPTIONS.map(option => (
                                                    <div
                                                        key={option.value}
                                                        className={`sprint-dropdown-option ${engEpicSort === option.value ? 'selected' : ''}`}
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => selectEngEpicSort(option.value)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEngEpicSort(option.value); } }}
                                                    >
                                                        {option.label}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {hasInitiativeData && (
                                    <span className="initiative-grouping-control">
                                        <IconButton
                                            className="fb-trigger fb-trigger-icon"
                                            onClick={() => setGroupByInitiative(!groupByInitiative)}
                                            aria-label="Group by Initiative"
                                            aria-pressed={groupByInitiative}
                                            aria-describedby="initiative-grouping-tooltip"
                                        >
                                            <InitiativeIcon size={14} title={null} />
                                        </IconButton>
                                        <span
                                            id="initiative-grouping-tooltip"
                                            className="initiative-grouping-tooltip"
                                            role="tooltip"
                                        >
                                            {`Group by Initiative — ${groupByInitiative ? 'On' : 'Off'}`}
                                        </span>
                                    </span>
                                )}
                            </>
                        )}
                    />

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
