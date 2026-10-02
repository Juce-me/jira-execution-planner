import * as React from 'react';
import EngFilterBar from './EngFilterBar.jsx';
import IconButton from '../ui/IconButton.jsx';
import PlanningTableStickyStack from './PlanningTableStickyStack.jsx';
import { ENG_EPIC_SORT_OPTIONS, getEngEpicSortLabel } from './engTaskUtils.js';

// The second controls row is shared by Catch Up and Planning; content and alerts render below it.
export default function EngFilterControls({ engFilters, onFacetChange, onClearFacets,
    onFilterBarHeightChange, boardColumns = [], renderPriorityIcon, hasInitiativeData,
    groupByInitiative, setGroupByInitiative, InitiativeIcon, engEpicSort, setEngEpicSort,
    hierarchyCounts, visibleTasksForList = [], planningTable = false, planningOverview,
    compactHeaderRef, onActivatePlanningSticky, planningToolbarRef }) {
    const realStoryCount = Number.isFinite(hierarchyCounts?.realStories) ? hierarchyCounts.realStories : visibleTasksForList.length;
    const requirementCount = Number(hierarchyCounts?.requirements) || 0;
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

    const filterBar = (<EngFilterBar
                        facets={engFilters.facets}
                        selection={engFilters.selection}
                        counts={engFilters.counts}
                        scopeTotal={engFilters.scopeTotal}
                        subject={engFilters.subject}
                        readoutCount={realStoryCount}
                        readoutUnit={requirementCount > 0 ? `stories · ${requirementCount} required` : engFilters.readoutUnit}
                        onChange={onFacetChange}
                        onClearAll={onClearFacets}
                        onHeightChange={onFilterBarHeightChange}
                        boardColumns={boardColumns}
                        renderPriorityIcon={renderPriorityIcon}
                        viewControls={planningTable ? <span ref={planningToolbarRef} className="planning-review-controls-host" /> : (
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
                    />);
    return planningTable
        ? <PlanningTableStickyStack overview={planningOverview} compactHeaderRef={compactHeaderRef} onActivate={onActivatePlanningSticky}>{filterBar}</PlanningTableStickyStack>
        : <>{filterBar}{planningOverview}</>;
}
