import * as React from 'react';

import FirstRunGroupConfigurationGuide from './FirstRunGroupConfigurationGuide.jsx';
import GroupBoardsTab from './GroupBoardsTab.jsx';
import TeamGroupsSettings from './TeamGroupsSettings.jsx';
import { TEAM_LABEL_ALIAS_LIMIT, normalizeTeamLabelAliases } from './groupConfigUtils.js';
import { getLabelRowKey } from './labelRowKey.js';

export default function DepartmentsSettingsTab({
    BACKEND_URL,
    activeGroupDraft,
    activeTeamIndex,
    activeTeamQuery,
    activeTeamResultsLimited,
    adHocEpicChipLastRef,
    adHocEpicSearchIndex,
    adHocEpicSearchInputRef,
    adHocEpicSearchLoading,
    adHocEpicSearchOpen,
    adHocEpicSearchQuery,
    addGroupAdHocCapacityEpic,
    addGroupDraftRow,
    addGroupExcludedCapacityEpic,
    addGroupMissingInfoComponent,
    addTeamToGroup,
    advanceFirstRunConfigurationGuide,
    availableTeams,
    backFirstRunConfigurationGuide,
    cancelFirstRunConfiguration,
    closeTeamLabelSearch,
    componentSearchIndex,
    componentSearchLoading,
    componentSearchOpen,
    componentSearchQuery,
    duplicateGroupDraft,
    epicsByStatus,
    excludedEpicChipLastRef,
    excludedEpicSearchIndex,
    excludedEpicSearchInputRef,
    excludedEpicSearchLoading,
    excludedEpicSearchOpen,
    excludedEpicSearchQuery,
    exportGroupsConfig,
    favoriteGroupDraftId,
    fetchAllTeamsFromJira,
    filteredAdHocEpicSearchResults,
    filteredComponentSearchResults,
    filteredExcludedEpicSearchResults,
    filteredGroupDrafts,
    firstRunConfigurationActive,
    firstRunConfigurationGuideVisible,
    firstRunConfigurationSession,
    getLabelSearchResults,
    groupDraft,
    groupDraftError,
    groupImportText,
    groupManageTab,
    groupSearchQuery,
    groupVisibilitySaving,
    groupWarnings,
    groupsError,
    handleAdHocEpicSearchBlur,
    handleAdHocEpicSearchChange,
    handleAdHocEpicSearchFocus,
    handleAdHocEpicSearchKeyDown,
    handleComponentSearchKeyDown,
    handleDepartmentSettingsTabKeyDown,
    handleExcludedEpicSearchBlur,
    handleExcludedEpicSearchChange,
    handleExcludedEpicSearchFocus,
    handleExcludedEpicSearchKeyDown,
    handleLabelSearchKeyDown,
    handleTeamSearchBlur,
    handleTeamSearchChange,
    handleTeamSearchFocus,
    handleTeamSearchKeyDown,
    importGroupsConfig,
    isGroupVisibleInControls,
    labelAddButtonRefs,
    labelAddOpen,
    labelSearchIndex,
    labelSearchLoading,
    labelSearchOpen,
    labelSearchQuery,
    labelsTabEnabled,
    loadingTeams,
    personalGroupPreferencesEnabled,
    removeGroupAdHocCapacityEpic,
    removeGroupDraft,
    removeGroupExcludedCapacityEpic,
    removeGroupMissingInfoComponent,
    removeTeamFromGroup,
    removeTeamLabelFromGroup,
    resolveTeamName,
    retryFirstRunConfiguration,
    returnFromFirstRunConfigurationRecovery,
    savedBoardId,
    savedSelectedProjects,
    scheduleJiraLabelSearch,
    selectDepartmentSettingsTab,
    selectTeamLabel,
    setActiveGroupDraftId,
    setComponentSearchOpen,
    setComponentSearchQuery,
    setFavoriteGroupDraft,
    setGroupImportText,
    setGroupSearchQuery,
    setLabelAddOpen,
    setLabelSearchIndex,
    setLabelSearchOpen,
    setLabelSearchQuery,
    setShowGroupAdvanced,
    setShowGroupImport,
    setShowGroupListMobile,
    showGroupAdvanced,
    showGroupImport,
    showGroupListMobile,
    teamCacheLabel,
    teamCatalogCanRefresh,
    teamCatalogReady,
    teamChipLastRef,
    teamSearchFeedback,
    teamSearchInputRefs,
    teamSearchOpen,
    toggleDefaultGroupDraft,
    toggleGroupVisibleInControls,
    updateGroupDraftBoard,
    updateGroupDraftName,
    visibleGroupDraftIds,
}) {
    // Group Board composer props (Boards tab, GroupBoardsTab.jsx). The Save gate validates
    // groupDraft directly (see groupConfigValidationErrors above); GroupBoardSettings reports
    // nothing upward, so there is no validation callback to wire here.
    const board = activeGroupDraft?.board || null;
    const backendUrl = BACKEND_URL;
    // Saved, not draft: the statuses route resolves board/project scope server-side, so
    // unsaved Admin edits must not key the response the server produces.
    const boardId = savedBoardId;
    const projectScopeKey = savedSelectedProjects
        .map((project) => String(project?.key || '').trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(',');
    const groupName = activeGroupDraft?.name || '';
    const onChange = (nextBoard) => {
        if (activeGroupDraft) updateGroupDraftBoard(activeGroupDraft.id, nextBoard);
    };
    const random = Math.random;
    return (
        <>
        <div
            className="group-modal-tabs epm-settings-tabs"
            role="tablist"
            aria-label="Departments settings sections"
            onKeyDown={handleDepartmentSettingsTabKeyDown}
        >
            <button
                className={`group-modal-tab ${groupManageTab === 'teams' ? 'active' : ''}`}
                onClick={() => selectDepartmentSettingsTab('teams')}
                role="tab"
                aria-selected={groupManageTab === 'teams'}
                aria-controls="department-settings-teams-panel"
                id="department-settings-teams-tab"
                type="button"
            >Team groups</button>
            <button
                className={`group-modal-tab ${groupManageTab === 'labels' ? 'active' : ''}`}
                onClick={() => selectDepartmentSettingsTab('labels')}
                role="tab"
                aria-selected={groupManageTab === 'labels'}
                aria-controls="department-settings-labels-panel"
                id="department-settings-labels-tab"
                type="button"
                disabled={!labelsTabEnabled}
                title={labelsTabEnabled ? '' : 'Save at least one group first'}
            >Group labels</button>
            <button
                className={`group-modal-tab ${groupManageTab === 'boards' ? 'active' : ''}`}
                onClick={() => selectDepartmentSettingsTab('boards')}
                role="tab"
                aria-selected={groupManageTab === 'boards'}
                aria-controls="department-settings-boards-panel"
                id="department-settings-boards-tab"
                type="button"
            >Boards</button>
        </div>
        {groupManageTab === 'teams' && (
        <div
            id="department-settings-teams-panel"
            role="tabpanel"
            aria-labelledby="department-settings-teams-tab"
        >
        <TeamGroupsSettings
            {...{
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
                teamCatalogReady,
                teamCatalogCanRefresh,
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
            }}
        />
        {firstRunConfigurationGuideVisible && (
            <FirstRunGroupConfigurationGuide
                step={firstRunConfigurationSession.guideStep}
                group={activeGroupDraft}
                groups={groupDraft?.groups || []}
                onBack={backFirstRunConfigurationGuide}
                onContinue={advanceFirstRunConfigurationGuide}
                onCancel={cancelFirstRunConfiguration}
                onRetry={retryFirstRunConfiguration}
                onReturn={returnFromFirstRunConfigurationRecovery}
                status={firstRunConfigurationSession.status}
                interactionReady={teamCatalogReady}
                busy={firstRunConfigurationSession.status === 'saving_sections'
                    || (firstRunConfigurationSession.status === 'preference_pending' && !firstRunConfigurationSession.error)}
                error={firstRunConfigurationSession.error}
            />
        )}
        </div>
        )}
        {groupManageTab === 'labels' && (
        <div
            id="department-settings-labels-panel"
            role="tabpanel"
            aria-labelledby="department-settings-labels-tab"
        >
        <div className="group-modal-body group-modal-split">
            <div className="group-pane group-list-pane">
                <div className="group-pane-header">
                    <div className="group-pane-title">Groups</div>
                    <div className="group-pane-subtitle">Choose a team group to map Jira labels per team.</div>
                </div>
                <div className="group-pane-list">
                    {(filteredGroupDrafts || []).map((group) => {
                        const isActive = activeGroupDraft?.id === group.id;
                        const teamCount = (group.teamIds || []).length;
                        return (
                            <button
                                key={`label-group-${group.id}`}
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
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="group-pane group-editor-pane">
                <div className="group-pane-header">
                    <div className="group-pane-title">Team labels</div>
                    <div className="group-pane-subtitle">Map up to three Jira Epic labels per Team; any of them matches the Team. Use labels only this Team applies.</div>
                </div>
                {!activeGroupDraft ? (
                    <div className="group-pane-empty">Select a group to edit its team label mappings.</div>
                ) : (activeGroupDraft.teamIds || []).length === 0 ? (
                    <div className="group-pane-empty">Add teams in Team groups first, then return here to map labels.</div>
                ) : (
                    <div className="group-pane-list">
                        {(activeGroupDraft.teamIds || []).map((teamId) => {
                            const rowKey = getLabelRowKey(activeGroupDraft.id, teamId);
                            const teamName = resolveTeamName(teamId);
                            const aliases = normalizeTeamLabelAliases(activeGroupDraft?.teamLabels?.[teamId]);
                            const atLimit = aliases.length >= TEAM_LABEL_ALIAS_LIMIT;
                            const showSearch = !atLimit && (aliases.length === 0 || Boolean(labelAddOpen[rowKey]));
                            const results = getLabelSearchResults(activeGroupDraft.id, teamId, aliases);
                            const query = String(labelSearchQuery[rowKey] || '').trim();
                            const isSearching = Boolean(labelSearchLoading[rowKey]);
                            const activeIndex = Math.min(labelSearchIndex[rowKey] || 0, Math.max(results.length - 1, 0));
                            const feedback = teamSearchFeedback[rowKey];
                            return (
                                <div key={rowKey} className="group-projects-subsection" style={{ marginTop: 0, paddingBottom: '1rem', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                                    <div className="team-label-row">
                                        <div className="team-selector-label" style={{ margin: 0 }}>{teamName}</div>
                                        <div className="team-label-aliases">
                                            {aliases.length > 0 && (
                                                <div className="selected-teams-list">
                                                    {aliases.map((alias) => (
                                                        <div key={`${rowKey}-chip-${alias}`} className="selected-team-chip">
                                                            <span className="team-name">{alias}</span>
                                                            <button
                                                                className="remove-btn"
                                                                onClick={() => removeTeamLabelFromGroup(activeGroupDraft.id, teamId, alias)}
                                                                type="button"
                                                                title="Remove label"
                                                                aria-label={`Remove ${alias} from ${teamName}`}
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {atLimit ? (
                                                        <span className="group-modal-meta team-label-count">{`${TEAM_LABEL_ALIAS_LIMIT} of ${TEAM_LABEL_ALIAS_LIMIT} labels`}</span>
                                                    ) : !showSearch && (
                                                        <button
                                                            className="secondary compact team-label-add"
                                                            type="button"
                                                            ref={(node) => {
                                                                if (node) labelAddButtonRefs.current[rowKey] = node;
                                                                else delete labelAddButtonRefs.current[rowKey];
                                                            }}
                                                            aria-label={`Add label for ${teamName}`}
                                                            onClick={() => setLabelAddOpen(prev => ({ ...prev, [rowKey]: true }))}
                                                        >
                                                            + Add label
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {showSearch && (
                                                <div className="team-search-wrapper" style={{ minWidth: 0 }}>
                                                    <input
                                                        type="text"
                                                        className="team-search-input"
                                                        placeholder="Type at least 3 characters..."
                                                        aria-label={`Search Jira labels for ${teamName}`}
                                                        autoFocus={aliases.length > 0}
                                                        value={labelSearchQuery[rowKey] || ''}
                                                        onChange={(event) => {
                                                            const value = event.target.value;
                                                            setLabelSearchQuery(prev => ({ ...prev, [rowKey]: value }));
                                                            setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                                                            setLabelSearchIndex(prev => ({ ...prev, [rowKey]: 0 }));
                                                            scheduleJiraLabelSearch(activeGroupDraft.id, teamId, value);
                                                        }}
                                                        onFocus={() => {
                                                            setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                                                        }}
                                                        onBlur={() => window.setTimeout(() => {
                                                            if (aliases.length > 0) closeTeamLabelSearch(rowKey);
                                                            else setLabelSearchOpen(prev => ({ ...prev, [rowKey]: false }));
                                                        }, 120)}
                                                        onKeyDown={(event) => handleLabelSearchKeyDown(activeGroupDraft.id, teamId, event, results)}
                                                    />
                                                    {labelSearchOpen[rowKey] && (
                                                        <div className="team-search-results" onMouseDown={(event) => event.preventDefault()}>
                                                            {query.length < 3 ? (
                                                                <div className="team-search-result-item is-empty">Type at least 3 characters</div>
                                                            ) : results.length === 0 ? (
                                                                <div className="team-search-result-item is-empty">{isSearching ? 'Searching labels...' : 'No labels found'}</div>
                                                            ) : results.map((label, index) => (
                                                                <div
                                                                    key={`${rowKey}-${label}`}
                                                                    className={`team-search-result-item ${activeIndex === index ? 'active' : ''}`}
                                                                    onMouseEnter={() => setLabelSearchIndex(prev => ({ ...prev, [rowKey]: index }))}
                                                                    onClick={() => selectTeamLabel(activeGroupDraft.id, teamId, label)}
                                                                >
                                                                    {label}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {feedback && (
                                                <div className={`team-search-feedback ${feedback.tone || ''}`} role="status">
                                                    {feedback.message}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
        </div>
        )}
        {groupManageTab === 'boards' && (
        <div
            id="department-settings-boards-panel"
            role="tabpanel"
            aria-labelledby="department-settings-boards-tab"
        >
        <GroupBoardsTab
            {...{
                groupManageTab,
                filteredGroupDrafts,
                activeGroupDraft,
                groupSearchQuery,
                setGroupSearchQuery,
                setActiveGroupDraftId,
                showGroupListMobile,
                setShowGroupListMobile,
                board,
                backendUrl,
                boardId,
                projectScopeKey,
                groupName,
                epicsByStatus,
                onChange,
                random,
            }}
        />
        </div>
        )}
        </>
    );
}
