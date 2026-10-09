import * as React from 'react';
import ControlField from '../ui/ControlField.jsx';
import SegmentedControl from '../ui/SegmentedControl.jsx';
import { bucketCount } from '../analytics/dashboardAnalytics.js';

export function SearchControl({
    surface,
    extraClassName = '',
    searchActive,
    searchInput,
    setSearchInput,
    setSearchFocused,
    searchInputRef,
}) {
    return (
        <ControlField label="Search" className={`control-search ${searchActive ? 'active-filter applied-filter' : ''} ${extraClassName}`.trim()}>
            <div className="search-wrap">
                <input
                    data-onboarding-target="search"
                    data-onboarding-surface={surface}
                    type="text"
                    className="search-input"
                    placeholder="Search tickets..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
                    ref={searchInputRef}
                />
                {searchInput && (
                    <button
                        className="search-clear"
                        onClick={() => setSearchInput('')}
                        title="Clear search"
                        aria-label="Clear search"
                        type="button"
                    >
                        ×
                    </button>
                )}
            </div>
        </ControlField>
    );
}

export function ViewSwitch({
    showEpmNavigation,
    selectedView,
    trackSelectContent,
    currentDashboardView,
    setSelectedView,
}) {
    if (!showEpmNavigation) return null;
    return (
        <SegmentedControl
            className="view-mode-control"
            ariaLabel="Dashboard view"
            value={selectedView}
            onChange={(nextView) => {
                trackSelectContent('dashboard_view', nextView, { from_view: currentDashboardView() });
                setSelectedView(nextView);
            }}
            options={[
                { value: 'eng', label: 'ENG' },
                { value: 'epm', label: 'EPM' },
            ]}
        />
    );
}

export function SprintControl({
    surface,
    selectedView,
    showBoard,
    engSprintSelectorState,
    boardStrictScope,
    sprintName,
    selectedSprint,
    sprintsLoading,
    engWorkspaceConfigured,
    getSprintSelectorOptions,
    sprintActiveOptionIndex,
    showSprintDropdown,
    activeControlSurface,
    closeSprintSelector,
    setShowSprintDropdown,
    setSprintActiveOptionIndex,
    sprintSelectorOriginRef,
    commitSprintSelectorOption,
    sprintDropdownRefs,
    sprintSearch,
    setSprintSearch,
    sprintOptionDomId,
    sprintTriggerRefs,
    openSprintSelector,
    availableSprints,
}) {
    const boardScopeControl = selectedView === 'eng' && showBoard;
    const canOpen = engSprintSelectorState.ordinarySelectable;
    const displayedSprint = boardScopeControl && boardStrictScope
        ? (boardStrictScope === 'component' ? 'Component' : 'All work')
        : (sprintName || (!selectedSprint && sprintsLoading && engWorkspaceConfigured ? 'Loading…' : 'Sprint'));
    const options = getSprintSelectorOptions(boardScopeControl);
    const activeIndex = options.length
        ? Math.min(Math.max(sprintActiveOptionIndex, 0), options.length - 1)
        : -1;
    const listboxId = `sprint-${surface}-listbox`;
    const isActiveOpen = showSprintDropdown && surface === activeControlSurface;
    const handleFilterKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSprintSelector({ restoreFocus: true });
            return;
        }
        if (event.key === 'Tab') {
            window.setTimeout(() => {
                setShowSprintDropdown(false);
                setSprintActiveOptionIndex(0);
                sprintSelectorOriginRef.current = null;
            }, 0);
            return;
        }
        if (!options.length) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSprintActiveOptionIndex(Math.min(activeIndex + 1, options.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSprintActiveOptionIndex(Math.max(activeIndex - 1, 0));
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setSprintActiveOptionIndex(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            setSprintActiveOptionIndex(options.length - 1);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            commitSprintSelectorOption(options[activeIndex], boardScopeControl);
        }
    };
    return (<ControlField label="Sprint">
        <div className={`sprint-dropdown sprint-selector-control${selectedView === 'eng' ? ' header-filter-dropdown header-filter-dropdown--sprint' : ''}`} ref={(node) => { sprintDropdownRefs.current[surface] = node; }}>
            {isActiveOpen ? (
                <div
                    className="sprint-dropdown-toggle open"
                    data-onboarding-target="sprint"
                    data-onboarding-surface={surface}
                >
                    <input
                        type="text"
                        className="dropdown-toggle-filter-input"
                        value={sprintSearch}
                        onChange={(event) => {
                            setSprintSearch(event.target.value);
                            setSprintActiveOptionIndex(0);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={handleFilterKeyDown}
                        placeholder={displayedSprint}
                        aria-label="Filter sprints"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls={listboxId}
                        aria-activedescendant={activeIndex >= 0
                            ? sprintOptionDomId(surface, options[activeIndex])
                            : undefined}
                        autoFocus
                    />
                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 9L1 4h10z"/>
                    </svg>
                </div>
            ) : (
                <button
                    ref={(node) => { sprintTriggerRefs.current[surface] = node; }}
                    type="button"
                    className="sprint-dropdown-toggle"
                    aria-label="Select sprint"
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    aria-controls={listboxId}
                    aria-disabled={!canOpen}
                    disabled={!canOpen}
                    tabIndex={canOpen ? 0 : -1}
                    onClick={() => {
                        if (!canOpen) return;
                        openSprintSelector(surface, options);
                    }}
                    data-onboarding-target="sprint"
                    data-onboarding-surface={surface}
                >
                    <span>{displayedSprint}</span>
                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 9L1 4h10z"/>
                    </svg>
                </button>
            )}
            {isActiveOpen && (
                <div className="sprint-dropdown-panel">
                    <div className="sprint-dropdown-list" id={listboxId} role="listbox" aria-label="Sprint options">
                        {sprintsLoading && options.length === 0 ? (
                            <div className="dropdown-filter-empty" role="status" aria-label="Sprint options status">Loading sprints...</div>
                        ) : availableSprints.length === 0 && options.length === 0 ? (
                            <div className="dropdown-filter-empty" role="status" aria-label="Sprint options status">No sprints available</div>
                        ) : options.length === 0 ? (
                            <div className="dropdown-filter-empty" role="status" aria-label="Sprint options status">No matching sprints</div>
                        ) : (
                            options.map((option, optionIndex) => {
                                const selected = option.kind === 'scope'
                                    ? boardStrictScope === option.scope
                                    : !boardStrictScope && String(option.sprint.id) === String(selectedSprint);
                                const state = option.kind === 'sprint'
                                    ? (option.sprint.state || '').toLowerCase()
                                    : '';
                                const marker = state === 'closed' ? '[C]' : state === 'active' ? '[A]' : '[F]';
                                const readinessText = option.kind === 'scope'
                                    ? (option.readiness === 'ready' ? 'Ready'
                                        : ['loading', 'catalog_pending'].includes(option.readiness)
                                            ? 'Loading configuration'
                                            : 'Setup needed')
                                    : '';
                                const descriptionId = option.kind === 'scope'
                                    ? `${sprintOptionDomId(surface, option)}-readiness`
                                    : undefined;
                                return (
                                    <button
                                        key={option.kind === 'scope' ? option.scope : option.sprint.id}
                                        id={sprintOptionDomId(surface, option)}
                                        type="button"
                                        role="option"
                                        tabIndex={-1}
                                        aria-label={option.label}
                                        aria-selected={selected}
                                        aria-describedby={descriptionId}
                                        className={`sprint-dropdown-option${selected ? ' selected' : ''}${optionIndex === activeIndex ? ' is-active' : ''}`}
                                        data-sprint-id={option.kind === 'sprint' ? option.sprint.id : undefined}
                                        onMouseMove={() => setSprintActiveOptionIndex(optionIndex)}
                                        onClick={() => commitSprintSelectorOption(option, boardScopeControl)}
                                    >
                                        <span>{option.kind === 'sprint' ? `${marker} ${option.label}` : option.label}</span>
                                        {option.kind === 'scope' && (
                                            <span id={descriptionId} className="sprint-option-readiness">{readinessText}</span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    </ControlField>);
}

export function GroupControl({
    surface,
    showGroupControl,
    groupDropdownRefs,
    showGroupDropdown,
    groupsLoading,
    applyExclusiveDropdownState,
    groupDropdownQuery,
    setGroupDropdownQuery,
    setShowGroupDropdown,
    activeGroup,
    activeControlSurface,
    visibleControlGroups,
    filteredControlGroups,
    trackFilterChanged,
    currentDashboardView,
    setActiveGroupId,
    groupsConfig,
    groupPreferences,
}) {
    if (!showGroupControl) return null;
    return (
        <div className="group-control">
            <ControlField label="Group">
                <div className="group-dropdown header-filter-dropdown header-filter-dropdown--group" ref={(node) => { groupDropdownRefs.current[surface] = node; }}>
                    <div
                        className={`group-dropdown-toggle ${showGroupDropdown ? 'open' : ''}`}
                        role={showGroupDropdown ? undefined : 'button'}
                        aria-label={showGroupDropdown ? undefined : 'Select group'}
                        tabIndex={showGroupDropdown ? undefined : (groupsLoading ? -1 : 0)}
                        onClick={() => {
                            if (showGroupDropdown) return;
                            if (groupsLoading) return;
                            applyExclusiveDropdownState('group', showGroupDropdown);
                        }}
                        onKeyDown={(event) => {
                            if (showGroupDropdown) return;
                            if (groupsLoading) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                applyExclusiveDropdownState('group', showGroupDropdown);
                            }
                        }}
                        aria-disabled={groupsLoading}
                        data-onboarding-target="group"
                        data-onboarding-surface={surface}
                    >
                        {showGroupDropdown ? (
                            <input
                                type="text"
                                className="dropdown-toggle-filter-input"
                                value={groupDropdownQuery}
                                onChange={(event) => setGroupDropdownQuery(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        setShowGroupDropdown(false);
                                    }
                                }}
                                placeholder={activeGroup?.name || 'Group'}
                                aria-label="Filter groups"
                                autoFocus={surface === activeControlSurface}
                            />
                        ) : (
                            <span>{activeGroup?.name || (groupsLoading ? 'Loading...' : 'Group')}</span>
                        )}
                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                            <path d="M6 9L1 4h10z"/>
                        </svg>
                    </div>
                    {showGroupDropdown && surface === activeControlSurface && (
                        <div className="group-dropdown-panel">
                            {groupsLoading ? (
                                <div className="group-dropdown-option">Loading groups...</div>
                            ) : (visibleControlGroups || []).length === 0 ? (
                                <div className="group-dropdown-option">No groups yet</div>
                            ) : filteredControlGroups.length === 0 ? (
                                <div className="dropdown-filter-empty" role="status">No matching groups</div>
                            ) : (
                                filteredControlGroups.map(group => (
                                    <div
                                        key={group.id}
                                        className="group-dropdown-option"
                                        onClick={() => {
                                            trackFilterChanged('group', { group_count_bucket: bucketCount(group?.teamIds?.length || 0), scope_type: currentDashboardView() });
                                            setActiveGroupId(group.id);
                                            setShowGroupDropdown(false);
                                        }}
                                    >
                                        <span>{group.name}</span>
                                        <div className="group-option-tags">
                                            {(groupsConfig.source === 'workspace_db'
                                                ? groupPreferences.activeGroupId === group.id
                                                : groupsConfig.defaultGroupId === group.id) && (
                                                <span
                                                    className="group-option-default"
                                                    title={groupsConfig.source === 'workspace_db' ? 'My favorite group' : 'Default group'}
                                                >★</span>
                                            )}
                                            <span className="group-option-meta">
                                                {group.teamIds?.length || 0} teams
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </ControlField>
        </div>
    );
}

export function TeamControl({
    surface,
    teamDropdownRefs,
    showTeamDropdown,
    isAllTeamsSelected,
    tasks,
    loading,
    applyExclusiveDropdownState,
    teamDropdownQuery,
    setTeamDropdownQuery,
    setShowTeamDropdown,
    selectedTeamsLabel,
    activeControlSurface,
    longestTeamOptionLabel,
    filteredTeamOptions,
    selectedTeamSet,
    toggleTeamSelection,
}) {
    return (
        <ControlField label="Teams">
            <div className="team-dropdown header-filter-dropdown header-filter-dropdown--team" ref={(node) => { teamDropdownRefs.current[surface] = node; }}>
                <div
                    className={`team-dropdown-toggle ${showTeamDropdown ? 'open' : ''} ${!isAllTeamsSelected ? 'active-filter applied-filter' : ''}`}
                    role={showTeamDropdown ? undefined : 'button'}
                    aria-label={showTeamDropdown ? undefined : 'Filter teams'}
                    tabIndex={showTeamDropdown ? undefined : (tasks.length === 0 && loading ? -1 : 0)}
                    onClick={() => {
                        if (showTeamDropdown) return;
                        if (tasks.length === 0 && loading) return;
                        applyExclusiveDropdownState('team', showTeamDropdown);
                    }}
                    onKeyDown={(event) => {
                        if (showTeamDropdown) return;
                        if (tasks.length === 0 && loading) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            applyExclusiveDropdownState('team', showTeamDropdown);
                        }
                    }}
                    aria-disabled={tasks.length === 0 && loading}
                    data-onboarding-target="teams"
                    data-onboarding-surface={surface}
                >
                    {showTeamDropdown ? (
                        <input
                            type="text"
                            className="dropdown-toggle-filter-input"
                            value={teamDropdownQuery}
                            onChange={(event) => setTeamDropdownQuery(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setShowTeamDropdown(false);
                                }
                            }}
                            placeholder={selectedTeamsLabel}
                            aria-label="Filter teams"
                            autoFocus={surface === activeControlSurface}
                        />
                    ) : (
                        <span style={{flex: 1, display: 'grid', textAlign: 'left', minWidth: 0}}>
                            <span className="team-dropdown-selection-label" style={{gridArea: '1/1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{selectedTeamsLabel}</span>
                            <span className="team-dropdown-width-label" style={{gridArea: '1/1', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap'}} aria-hidden="true">{longestTeamOptionLabel}</span>
                        </span>
                    )}
                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 9L1 4h10z"/>
                    </svg>
                </div>
                {showTeamDropdown && surface === activeControlSurface && (
                    <div className="team-dropdown-panel">
                        {filteredTeamOptions.length === 0 && teamDropdownQuery.trim() ? (
                            <div className="dropdown-filter-empty" role="status">No matching teams</div>
                        ) : filteredTeamOptions.map(team => (
                            <label key={team.id} className="team-dropdown-option">
                                <input
                                    type="checkbox"
                                    checked={team.id === 'all' ? isAllTeamsSelected : selectedTeamSet.has(team.id)}
                                    onChange={() => toggleTeamSelection(team.id)}
                                />
                                <span>{team.name}</span>
                            </label>
                        ))}
                    </div>
                )}
            </div>
        </ControlField>
    );
}
