import * as React from 'react';
import GroupEpicSelector from './GroupEpicSelector.jsx';
import { formatGroupBoardSummary } from './groupConfigUtils.js';

export default function TeamGroupsSettings(props) {
    const {
        groupManageTab,
        showGroupListMobile,
        setShowGroupListMobile,
        addGroupDraftRow,
        groupSearchQuery,
        setGroupSearchQuery,
        filteredGroupDrafts,
        activeGroupDraft,
        groupDraft,
        visibleGroupDraftIds,
        toggleGroupVisibleInControls,
        isGroupVisibleInControls,
        groupVisibilitySaving,
        setActiveGroupDraftId,
        groupsError,
        groupWarnings,
        groupDraftError,
        fetchAllTeamsFromJira,
        loadingTeams,
        teamCacheLabel,
        updateGroupDraftName,
        toggleDefaultGroupDraft,
        personalGroupPreferencesEnabled,
        favoriteGroupDraftId,
        setFavoriteGroupDraft,
        duplicateGroupDraft,
        resolveTeamName,
        removeTeamFromGroup,
        teamChipLastRef,
        availableTeams,
        activeTeamQuery,
        handleTeamSearchChange,
        handleTeamSearchFocus,
        handleTeamSearchBlur,
        handleTeamSearchKeyDown,
        activeTeamResultsLimited,
        teamSearchInputRefs,
        teamSearchOpen,
        activeTeamIndex,
        addTeamToGroup,
        teamSearchFeedback,
        componentSearchQuery,
        setComponentSearchQuery,
        setComponentSearchOpen,
        componentSearchOpen,
        componentSearchLoading,
        filteredComponentSearchResults,
        componentSearchIndex,
        handleComponentSearchKeyDown,
        addGroupMissingInfoComponent,
        removeGroupMissingInfoComponent,
        excludedEpicSearchQuery,
        handleExcludedEpicSearchChange,
        handleExcludedEpicSearchFocus,
        handleExcludedEpicSearchBlur,
        handleExcludedEpicSearchKeyDown,
        excludedEpicSearchInputRef,
        excludedEpicSearchOpen,
        excludedEpicSearchLoading,
        filteredExcludedEpicSearchResults,
        excludedEpicSearchIndex,
        addGroupExcludedCapacityEpic,
        removeGroupExcludedCapacityEpic,
        excludedEpicChipLastRef,
        adHocEpicSearchQuery,
        handleAdHocEpicSearchChange,
        handleAdHocEpicSearchFocus,
        handleAdHocEpicSearchBlur,
        handleAdHocEpicSearchKeyDown,
        adHocEpicSearchInputRef,
        adHocEpicSearchOpen,
        adHocEpicSearchLoading,
        filteredAdHocEpicSearchResults,
        adHocEpicSearchIndex,
        addGroupAdHocCapacityEpic,
        removeGroupAdHocCapacityEpic,
        adHocEpicChipLastRef,
        showGroupAdvanced,
        setShowGroupAdvanced,
        showGroupImport,
        setShowGroupImport,
        exportGroupsConfig,
        groupImportText,
        setGroupImportText,
        importGroupsConfig,
        removeGroupDraft,
        selectDepartmentSettingsTab,
        firstRunConfigurationActive,
    } = props;

    const hasDuplicableGroup = (groupDraft?.groups || []).some(group => String(group?.id || '').trim());
    const nameFocusValueRef = React.useRef(new Map());
    const favoriteVisibilityHelperId = React.useId();
    const activeGroupIsFavorite = Boolean(activeGroupDraft && (
        personalGroupPreferencesEnabled ? favoriteGroupDraftId : groupDraft?.defaultGroupId
    ) === activeGroupDraft.id);
    const visibilityDescriptionIds = activeGroupIsFavorite ? favoriteVisibilityHelperId : undefined;

    return (
        <>
                                {groupManageTab === 'teams' && (
                                <div className="group-modal-body group-modal-split">
                                    <div className={`group-pane group-pane-left ${showGroupListMobile ? 'is-mobile-active' : ''}`}>
                                        <div className="group-pane-header">
                                            <div className="group-pane-header-row">
                                                <div className="group-pane-title">Groups</div>
                                                <button className="secondary compact group-add-button" onClick={addGroupDraftRow} type="button" disabled={firstRunConfigurationActive}>
                                                    + Add group
                                                </button>
                                            </div>
                                            <div className="group-pane-search">
                                                <input
                                                    type="text"
                                                    className="group-filter-input"
                                                    placeholder="Search groups or teams..."
                                                    value={groupSearchQuery}
                                                    onChange={(event) => setGroupSearchQuery(event.target.value)}
                                                    disabled={firstRunConfigurationActive}
                                                />
                                            </div>
                                            <div className="group-pane-count">
                                                {filteredGroupDrafts.length} group{filteredGroupDrafts.length !== 1 ? 's' : ''}
                                            </div>
                                            <button
                                                className="group-pane-mobile-close"
                                                onClick={() => { if (!firstRunConfigurationActive) setShowGroupListMobile(false); }}
                                                disabled={firstRunConfigurationActive}
                                                type="button"
                                            >
                                                Back
                                            </button>
                                        </div>
                                        <div className="group-pane-list">
                                            {filteredGroupDrafts.length === 0 ? (
                                                <div className="group-pane-empty">No groups match this search.</div>
                                            ) : filteredGroupDrafts.map(group => {
                                                const teamCount = (group.teamIds || []).filter(teamId => String(teamId || '').trim()).length;
                                                const isActive = activeGroupDraft?.id === group.id;
                                                const isDefault = personalGroupPreferencesEnabled
                                                    ? favoriteGroupDraftId === group.id
                                                    : groupDraft?.defaultGroupId === group.id;
                                                const normalizedName = String(group.name || '').trim();
                                                const nameConflict = !normalizedName || (groupDraft?.groups || []).some(candidate => (
                                                    candidate.id !== group.id
                                                    && String(candidate.name || '').trim().toLowerCase() === normalizedName.toLowerCase()
                                                ));
                                                return (
                                                    <div
                                                        key={group.id}
                                                        className={`group-list-item ${isActive ? 'active' : ''}`}
                                                        onClick={() => {
                                                            if (firstRunConfigurationActive) return;
                                                            setActiveGroupDraftId(group.id);
                                                            setShowGroupListMobile(false);
                                                        }}
                                                    >
                                                        {isActive ? (
                                                            <input
                                                                className="group-list-name-input"
                                                                data-first-run-guide-target="name"
                                                                value={group.name || ''}
                                                                placeholder="Group name"
                                                                aria-label="Department name"
                                                                aria-invalid={nameConflict || undefined}
                                                                aria-describedby={nameConflict ? `group-name-error-${group.id}` : undefined}
                                                                onClick={(event) => event.stopPropagation()}
                                                                onFocus={() => {
                                                                    if (!nameFocusValueRef.current.has(group.id)) {
                                                                        nameFocusValueRef.current.set(group.id, group.name || '');
                                                                    }
                                                                }}
                                                                onChange={(event) => updateGroupDraftName(group.id, event.target.value)}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === 'Enter') {
                                                                        event.preventDefault();
                                                                        if (!nameConflict) updateGroupDraftName(group.id, normalizedName);
                                                                    }
                                                                    if (event.key === 'Escape') {
                                                                        event.preventDefault();
                                                                        updateGroupDraftName(group.id, nameFocusValueRef.current.get(group.id) ?? group.name ?? '');
                                                                        event.currentTarget.focus();
                                                                    }
                                                                }}
                                                                onBlur={(event) => {
                                                                    if (nameConflict) return;
                                                                    updateGroupDraftName(group.id, event.currentTarget.value.trim());
                                                                    nameFocusValueRef.current.delete(group.id);
                                                                }}
                                                            />
                                                        ) : (
                                                            <button
                                                                className="group-list-select"
                                                                onClick={() => {
                                                                    if (firstRunConfigurationActive) return;
                                                                    setActiveGroupDraftId(group.id);
                                                                    setShowGroupListMobile(false);
                                                                }}
                                                                type="button"
                                                                disabled={firstRunConfigurationActive}
                                                            >
                                                                <span className="group-list-name">{group.name || 'Untitled group'}</span>
                                                            </button>
                                                        )}
                                                        <div className="group-list-line group-list-meta-line">
                                                            <span className="group-list-dot">·</span>
                                                            <span className="group-list-meta">{teamCount} team{teamCount !== 1 ? 's' : ''}</span>
                                                        </div>
                                                        {firstRunConfigurationActive && isActive ? (
                                                            <span
                                                                className="group-list-star group-list-star-status"
                                                                data-first-run-guide-target="favorite"
                                                                tabIndex={0}
                                                                role="status"
                                                                aria-label="Favorite Department, selected pending save"
                                                            >♥</span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                className="group-list-star"
                                                                aria-pressed={isDefault}
                                                                aria-label={isDefault
                                                                    ? `${group.name || 'Department'} is your favorite Department`
                                                                    : `Set ${group.name || 'Department'} as your favorite Department`}
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    if (personalGroupPreferencesEnabled) setFavoriteGroupDraft(group.id);
                                                                    else toggleDefaultGroupDraft(group.id);
                                                                }}
                                                                disabled={groupVisibilitySaving || !(group.teamIds || []).some(teamId => String(teamId || '').trim())}
                                                            >{isDefault ? '♥' : '♡'}</button>
                                                        )}
                                                        {isActive && nameConflict && (
                                                            <span id={`group-name-error-${group.id}`} className="group-list-name-error" role="alert">
                                                                {normalizedName ? 'Department names must be unique.' : 'Department name is required.'}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="group-pane group-pane-right">
                                        <div className="group-pane-mobile-header">
                                            <button
                                                className="secondary compact"
                                                onClick={() => setShowGroupListMobile(true)}
                                                type="button"
                                            >
                                                Groups
                                            </button>
                                            <div className="group-pane-mobile-title">
                                                {activeGroupDraft ? (activeGroupDraft.name || 'Untitled group') : 'No group selected'}
                                            </div>
                                        </div>
                                        {firstRunConfigurationActive && (
                                            <div className="group-modal-meta">
                                                {hasDuplicableGroup
                                                    ? 'Easiest way to get started: duplicate an existing group, then adjust its teams.'
                                                    : 'Create a Department group, add its teams, then save and choose it as your starting group.'}
                                            </div>
                                        )}
                                        {groupsError && (
                                            <div className="group-modal-warning">{groupsError}</div>
                                        )}
                                        {(groupWarnings || []).length > 0 && (
                                            <div className="group-modal-warning">
                                                {(groupWarnings || []).join(' ')}
                                            </div>
                                        )}
                                        {groupDraftError && (
                                            <div className="group-modal-warning">
                                                {groupDraftError}
                                            </div>
                                        )}
                                        <div className="group-pane-tools">
                                            <button
                                                className="secondary compact"
                                                data-first-run-guide-allow={firstRunConfigurationActive ? 'teams' : undefined}
                                                onClick={fetchAllTeamsFromJira}
                                                type="button"
                                                disabled={loadingTeams}
                                            >
                                                {loadingTeams ? 'Refreshing...' : 'Refresh teams'}
                                            </button>
                                            <span className="group-modal-meta">{teamCacheLabel}</span>
                                            <span className="group-modal-helper" title="Team list is scoped to the currently selected sprint.">
                                                Scoped to sprint
                                            </span>
                                        </div>
                                        {loadingTeams && (
                                            <div className="group-modal-meta">Loading teams...</div>
                                        )}
                                        {(groupDraft?.groups || []).length === 0 && (
                                            <div className="group-pane-empty">No groups yet. Click "Add group" to create one.</div>
                                        )}
                                        {activeGroupDraft ? (
                                            <div className="group-editor">
                                                <div className="group-preference-row">
                                                    {firstRunConfigurationActive ? (
                                                        <div
                                                            className="first-run-preference-status"
                                                            data-first-run-guide-target="visibility"
                                                            tabIndex={0}
                                                            role="status"
                                                            aria-label="Show in Department selector, checked. Favorite Departments are always shown"
                                                        >
                                                            Shown in Department selector
                                                        </div>
                                                    ) : (
                                                        <label className="group-visible-control">
                                                            <input
                                                                type="checkbox"
                                                                checked={isGroupVisibleInControls(activeGroupDraft.id)}
                                                                aria-describedby={visibilityDescriptionIds}
                                                                disabled={groupVisibilitySaving || activeGroupIsFavorite}
                                                                onChange={() => toggleGroupVisibleInControls(activeGroupDraft.id)}
                                                            />
                                                            <span>Show in Department selector</span>
                                                        </label>
                                                    )}
                                                    {(firstRunConfigurationActive || activeGroupIsFavorite) && (
                                                        <span id={favoriteVisibilityHelperId} className="group-visible-helper group-visible-favorite-helper">
                                                            Favorite Departments are always shown.
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="group-editor-actions">
                                                    <button
                                                        className="secondary compact"
                                                        onClick={() => duplicateGroupDraft(activeGroupDraft.id)}
                                                        type="button"
                                                    >
                                                        Duplicate
                                                    </button>
                                                </div>
                                                <div
                                                    className="team-selector"
                                                    data-first-run-guide-target="teams"
                                                    data-onboarding-configuration-team-count={(activeGroupDraft.teamIds || []).length}
                                                    data-onboarding-configuration-team-catalog-unavailable={availableTeams.length === 0 && !loadingTeams ? 'true' : 'false'}
                                                    tabIndex={-1}
                                                >
                                                    <div className="team-selector-header">
                                                        <div className="team-selector-label">
                                                            Teams {(activeGroupDraft.teamIds || []).length}/12
                                                        </div>
                                                        {(activeGroupDraft.teamIds || []).length >= 12 && (
                                                            <div className="team-selector-limit">Limit reached (12 max)</div>
                                                        )}
                                                    </div>
                                                    {(activeGroupDraft.teamIds || []).length === 0 ? (
                                                        <div className="team-selector-empty">
                                                            Add at least one team. Teams define which Jira work appears for this Department.
                                                        </div>
                                                    ) : (
                                                        <div className="selected-teams-list is-capped">
                                                            {(activeGroupDraft.teamIds || []).map((teamId, index) => {
                                                                const teamName = resolveTeamName(teamId);
                                                                const isLast = index === (activeGroupDraft.teamIds || []).length - 1;
                                                                return (
                                                                    <div key={teamId} className="selected-team-chip">
                                                                        <span className="team-name">{teamName}</span>
                                                                        <button
                                                                            className="remove-btn"
                                                                            onClick={() => removeTeamFromGroup(activeGroupDraft.id, teamId)}
                                                                            type="button"
                                                                            title="Remove team"
                                                                            ref={isLast ? (node) => { teamChipLastRef.current[activeGroupDraft.id] = node; } : null}
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {availableTeams.length === 0 && !loadingTeams ? (
                                                        <div className="team-selector-empty">
                                                            No teams available. Load tasks first or refresh teams above.
                                                        </div>
                                                    ) : (activeGroupDraft.teamIds || []).length < 12 && (
                                                        <div className="team-search-wrapper">
                                                            <input
                                                                data-onboarding-target="configuration-team-add"
                                                                type="text"
                                                                className="team-search-input"
                                                                placeholder="Search teams to add..."
                                                                value={activeTeamQuery}
                                                                onChange={(event) => handleTeamSearchChange(activeGroupDraft.id, event.target.value)}
                                                                onFocus={() => handleTeamSearchFocus(activeGroupDraft.id)}
                                                                onBlur={() => handleTeamSearchBlur(activeGroupDraft.id)}
                                                                onKeyDown={(event) => handleTeamSearchKeyDown(activeGroupDraft.id, event, activeTeamResultsLimited)}
                                                                ref={(node) => { teamSearchInputRefs.current[activeGroupDraft.id] = node; }}
                                                            />
                                                            {teamSearchOpen[activeGroupDraft.id] && activeTeamQuery.trim() && (
                                                                <div
                                                                    className={`team-search-results ${(activeGroupDraft.teamIds || []).length >= 12 ? 'disabled' : ''}`}
                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                >
                                                                    {activeTeamResultsLimited.length === 0 ? (
                                                                        <div className="team-search-result-item is-empty">
                                                                            No teams found
                                                                        </div>
                                                                    ) : activeTeamResultsLimited.map((team, index) => (
                                                                        <div
                                                                            key={team.id}
                                                                            className={`team-search-result-item ${index === activeTeamIndex ? 'active' : ''}`}
                                                                            onClick={() => addTeamToGroup(activeGroupDraft.id, team.id)}
                                                                        >
                                                                            {team.name}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {teamSearchFeedback[activeGroupDraft.id] && (
                                                                <div className={`team-search-feedback ${teamSearchFeedback[activeGroupDraft.id].tone || ''}`}>
                                                                    {teamSearchFeedback[activeGroupDraft.id].message}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="component-selector" data-first-run-guide-target="components" tabIndex={-1}>
                                                    <label className="component-selector-label">Components for Missing Information and Lead Times</label>
                                                    <div className="group-modal-meta">Component is a Jira issue field, usually set on an Epic.</div>
                                                    {(activeGroupDraft?.missingInfoComponents || []).length > 0 && (
                                                        <div className="selected-components-list">
                                                            {activeGroupDraft.missingInfoComponents.map(comp => (
                                                                <div key={comp} className="component-chip">
                                                                    <span className="component-name">{comp}</span>
                                                                    <button
                                                                        className="remove-btn"
                                                                        onClick={() => removeGroupMissingInfoComponent(activeGroupDraft.id, comp)}
                                                                        title={`Remove ${comp}`}
                                                                        type="button"
                                                                    >×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="component-search-wrapper">
                                                        <input
                                                            type="text"
                                                            className="component-search-input"
                                                            placeholder="Search components..."
                                                            value={componentSearchQuery}
                                                            onChange={(e) => {
                                                                setComponentSearchQuery(e.target.value);
                                                                setComponentSearchOpen(true);
                                                            }}
                                                            onFocus={() => setComponentSearchOpen(true)}
                                                            onBlur={() => window.setTimeout(() => setComponentSearchOpen(false), 200)}
                                                            onKeyDown={handleComponentSearchKeyDown}
                                                        />
                                                        {componentSearchOpen && componentSearchQuery.trim() && (
                                                            <div className="component-search-results">
                                                                {componentSearchLoading ? (
                                                                    <div className="component-search-result-item is-empty">Searching...</div>
                                                                ) : filteredComponentSearchResults.length === 0 ? (
                                                                    <div className="component-search-result-item is-empty">No components found</div>
                                                                ) : filteredComponentSearchResults.map((comp, index) => (
                                                                    <div
                                                                        key={comp.id || comp.name}
                                                                        className={`component-search-result-item ${index === componentSearchIndex ? 'active' : ''}`}
                                                                        onMouseDown={(e) => {
                                                                            e.preventDefault();
                                                                            addGroupMissingInfoComponent(activeGroupDraft.id, comp.name);
                                                                        }}
                                                                    >
                                                                        {comp.name}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <GroupEpicSelector
                                                    label="Epics for excluded capacity"
                                                    selectedEpics={activeGroupDraft?.excludedCapacityEpics || []}
                                                    searchQuery={excludedEpicSearchQuery}
                                                    onSearchChange={handleExcludedEpicSearchChange}
                                                    onSearchFocus={handleExcludedEpicSearchFocus}
                                                    onSearchBlur={handleExcludedEpicSearchBlur}
                                                    onSearchKeyDown={handleExcludedEpicSearchKeyDown}
                                                    searchInputRef={excludedEpicSearchInputRef}
                                                    searchOpen={excludedEpicSearchOpen}
                                                    searchLoading={excludedEpicSearchLoading}
                                                    searchResults={filteredExcludedEpicSearchResults}
                                                    searchIndex={excludedEpicSearchIndex}
                                                    onAddEpic={(epicKey) => addGroupExcludedCapacityEpic(activeGroupDraft.id, epicKey)}
                                                    onRemoveEpic={(epicKey) => removeGroupExcludedCapacityEpic(activeGroupDraft.id, epicKey)}
                                                    chipLastRef={excludedEpicChipLastRef}
                                                />
                                                <GroupEpicSelector
                                                    label="Epics for Ad Hoc capacity"
                                                    selectedEpics={activeGroupDraft?.adHocCapacityEpics || []}
                                                    searchQuery={adHocEpicSearchQuery}
                                                    onSearchChange={handleAdHocEpicSearchChange}
                                                    onSearchFocus={handleAdHocEpicSearchFocus}
                                                    onSearchBlur={handleAdHocEpicSearchBlur}
                                                    onSearchKeyDown={handleAdHocEpicSearchKeyDown}
                                                    searchInputRef={adHocEpicSearchInputRef}
                                                    searchOpen={adHocEpicSearchOpen}
                                                    searchLoading={adHocEpicSearchLoading}
                                                    searchResults={filteredAdHocEpicSearchResults}
                                                    searchIndex={adHocEpicSearchIndex}
                                                    onAddEpic={(epicKey) => addGroupAdHocCapacityEpic(activeGroupDraft.id, epicKey)}
                                                    onRemoveEpic={(epicKey) => removeGroupAdHocCapacityEpic(activeGroupDraft.id, epicKey)}
                                                    chipLastRef={adHocEpicChipLastRef}
                                                />
                                                <div className="component-selector">
                                                    <span className="component-selector-label">Board</span>
                                                    <div className="group-projects-subsection">
                                                        <span className="group-modal-meta">
                                                            {formatGroupBoardSummary(activeGroupDraft?.board)}
                                                        </span>
                                                        <div>
                                                            <button
                                                                className="secondary compact"
                                                                onClick={() => selectDepartmentSettingsTab('boards')}
                                                                type="button"
                                                            >
                                                                Configure board →
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <details className="group-advanced" open={showGroupAdvanced}>
                                                    <summary onClick={(event) => {
                                                        event.preventDefault();
                                                        setShowGroupAdvanced(prev => {
                                                            const next = !prev;
                                                            if (!next) {
                                                                setShowGroupImport(false);
                                                            }
                                                            return next;
                                                        });
                                                    }}>
                                                        Advanced
                                                    </summary>
                                                    <div className="group-advanced-body">
                                                        <div className="group-advanced-row">
                                                            <button className="secondary compact" onClick={exportGroupsConfig} type="button">
                                                                Export JSON
                                                            </button>
                                                        </div>
                                                        <div className="group-advanced-row">
                                                            <button
                                                                className="secondary compact"
                                                                onClick={() => {
                                                                    setShowGroupAdvanced(true);
                                                                    setShowGroupImport(true);
                                                                }}
                                                                type="button"
                                                            >
                                                                Import JSON
                                                            </button>
                                                            <span className="group-modal-meta">Replaces only the selected group settings draft; Save to persist.</span>
                                                        </div>
                                                        {showGroupImport && (
                                                            <>
                                                                <textarea
                                                                    value={groupImportText}
                                                                    onChange={(event) => setGroupImportText(event.target.value)}
                                                                    placeholder='{"version":1,"group":{...}}'
                                                                />
                                                                <div className="group-advanced-row">
                                                                    <button className="secondary compact" onClick={importGroupsConfig} type="button">
                                                                        Apply Import
                                                                    </button>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </details>
                                                <div className="group-danger-zone">
                                                    <div className="group-danger-title">Danger zone</div>
                                                    <button
                                                        className="secondary compact danger"
                                                        onClick={() => removeGroupDraft(activeGroupDraft.id)}
                                                        type="button"
                                                    >
                                                        Delete group
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="group-pane-empty">Select a group to edit, or add a new one.</div>
                                        )}
                                    </div>
                                </div>
                                )}
        </>
    );
}
