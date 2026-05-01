import * as React from 'react';

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
        setActiveGroupDraftId,
        groupsError,
        groupWarnings,
        groupDraftError,
        fetchAllTeamsFromJira,
        loadingTeams,
        teamCacheLabel,
        updateGroupDraftName,
        toggleDefaultGroupDraft,
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
        showGroupAdvanced,
        setShowGroupAdvanced,
        showGroupImport,
        setShowGroupImport,
        exportGroupsConfig,
        groupImportText,
        setGroupImportText,
        importGroupsConfig,
        removeGroupDraft,
    } = props;

    return (
        <>
                                {groupManageTab === 'teams' && (
                                <div className="group-modal-body group-modal-split">
                                    <div className={`group-pane group-pane-left ${showGroupListMobile ? 'is-mobile-active' : ''}`}>
                                        <div className="group-pane-header">
                                            <div className="group-pane-header-row">
                                                <div className="group-pane-title">Groups</div>
                                                <button className="secondary compact group-add-button" onClick={addGroupDraftRow} type="button">
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
                                                />
                                            </div>
                                            <div className="group-pane-count">
                                                {filteredGroupDrafts.length} group{filteredGroupDrafts.length !== 1 ? 's' : ''}
                                            </div>
                                            <button
                                                className="group-pane-mobile-close"
                                                onClick={() => setShowGroupListMobile(false)}
                                                type="button"
                                            >
                                                Back
                                            </button>
                                        </div>
                                        <div className="group-pane-list">
                                            {filteredGroupDrafts.length === 0 ? (
                                                <div className="group-pane-empty">No groups match this search.</div>
                                            ) : filteredGroupDrafts.map(group => {
                                                const teamCount = (group.teamIds || []).length;
                                                const isActive = activeGroupDraft?.id === group.id;
                                                const isDefault = groupDraft?.defaultGroupId === group.id;
                                                return (
                                                    <button
                                                        key={group.id}
                                                        className={`group-list-item ${isActive ? 'active' : ''}`}
                                                        onClick={() => {
                                                            setActiveGroupDraftId(group.id);
                                                            setShowGroupListMobile(false);
                                                        }}
                                                        type="button"
                                                    >
                                                        <div className="group-list-line">
                                                            <span className="group-list-name">{group.name || 'Untitled group'}</span>
                                                            <span className="group-list-dot">·</span>
                                                            <span className="group-list-meta">{teamCount} team{teamCount !== 1 ? 's' : ''}</span>
                                                        </div>
                                                        <div className="group-list-star" aria-hidden="true">
                                                            {isDefault ? '★' : '☆'}
                                                        </div>
                                                    </button>
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
                                        {groupsError && (
                                            <div className="group-modal-warning">{groupsError}</div>
                                        )}
                                        {(groupWarnings || []).length > 0 && (
                                            <div className="group-modal-warning">
                                                {(groupWarnings || []).join(' ')}
                                            </div>
                                        )}
                                        {groupDraftError && (
                                            <div className="group-modal-warning">{groupDraftError}</div>
                                        )}
                                        <div className="group-pane-tools">
                                            <button
                                                className="secondary compact"
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
                                                <div className="group-editor-header">
                                                    <input
                                                        type="text"
                                                        value={activeGroupDraft.name}
                                                        onChange={(event) => updateGroupDraftName(activeGroupDraft.id, event.target.value)}
                                                        placeholder="Group name"
                                                        className="group-name-input"
                                                    />
                                                    <button
                                                        className={`group-star-button ${groupDraft?.defaultGroupId === activeGroupDraft.id ? 'active' : ''}`}
                                                        onClick={() => toggleDefaultGroupDraft(activeGroupDraft.id)}
                                                        title="Set as default group"
                                                        aria-label={groupDraft?.defaultGroupId === activeGroupDraft.id ? 'Unset default group' : 'Set as default group'}
                                                        type="button"
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                                            <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.6l5.8-.8L12 3.5z"/>
                                                        </svg>
                                                    </button>
                                                    <button
                                                        className="secondary compact"
                                                        onClick={() => duplicateGroupDraft(activeGroupDraft.id)}
                                                        type="button"
                                                    >
                                                        Duplicate
                                                    </button>
                                                </div>
                                                <div className="team-selector">
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
                                                            No teams selected. Search and add teams below.
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
                                                <div className="component-selector">
                                                    <label className="component-selector-label">Components for missing info</label>
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
                                                <div className="component-selector">
                                                    <label className="component-selector-label">Epics for excluded capacity</label>
                                                    {(activeGroupDraft?.excludedCapacityEpics || []).length > 0 && (
                                                        <div className="selected-components-list">
                                                            {(activeGroupDraft.excludedCapacityEpics || []).map((epicKey, index) => (
                                                                <div key={epicKey} className="component-chip">
                                                                    <span className="component-name">{epicKey}</span>
                                                                    <button
                                                                        className="remove-btn"
                                                                        onClick={() => removeGroupExcludedCapacityEpic(activeGroupDraft.id, epicKey)}
                                                                        title={`Remove ${epicKey}`}
                                                                        type="button"
                                                                        ref={index === (activeGroupDraft.excludedCapacityEpics || []).length - 1 ? excludedEpicChipLastRef : null}
                                                                    >×</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="component-search-wrapper">
                                                        <input
                                                            type="text"
                                                            className="component-search-input"
                                                            placeholder="Search epics by key or summary..."
                                                            value={excludedEpicSearchQuery}
                                                            onChange={(e) => handleExcludedEpicSearchChange(e.target.value)}
                                                            onFocus={handleExcludedEpicSearchFocus}
                                                            onBlur={handleExcludedEpicSearchBlur}
                                                            onKeyDown={handleExcludedEpicSearchKeyDown}
                                                            ref={excludedEpicSearchInputRef}
                                                        />
                                                        {excludedEpicSearchOpen && excludedEpicSearchQuery.trim() && (
                                                            <div className="component-search-results">
                                                                {excludedEpicSearchLoading ? (
                                                                    <div className="component-search-result-item is-empty">Searching...</div>
                                                                ) : filteredExcludedEpicSearchResults.length === 0 ? (
                                                                    <div className="component-search-result-item is-empty">No epics found</div>
                                                                ) : filteredExcludedEpicSearchResults.map((epic, index) => (
                                                                    <div
                                                                        key={epic.key}
                                                                        className={`component-search-result-item ${index === excludedEpicSearchIndex ? 'active' : ''}`}
                                                                        onMouseDown={(e) => {
                                                                            e.preventDefault();
                                                                            addGroupExcludedCapacityEpic(activeGroupDraft.id, epic.key);
                                                                        }}
                                                                    >
                                                                        <span>{epic.key}</span>
                                                                        {epic.summary ? <span className="component-result-meta"> · {epic.summary}</span> : null}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
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
                                                            <span className="group-modal-meta">Import overwrites current draft.</span>
                                                        </div>
                                                        {showGroupImport && (
                                                            <>
                                                                <textarea
                                                                    value={groupImportText}
                                                                    onChange={(event) => setGroupImportText(event.target.value)}
                                                                    placeholder='{"version":1,"groups":[...]}'
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
