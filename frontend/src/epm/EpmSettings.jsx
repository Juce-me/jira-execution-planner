import * as React from 'react';
import IconButton from '../ui/IconButton.jsx';
import StatusPill from '../ui/StatusPill.jsx';

export default function EpmSettings(props) {
    const {
        DEFAULT_EPM_LABEL_PREFIX,
        epmSettingsTab,
        setEpmSettingsTab,
        handleEpmSettingsTabKeyDown,
        epmScopeMeta,
        selectedEpmRootGoal,
        clearEpmRootGoal,
        epmRootGoalQuery,
        setEpmRootGoalQuery,
        setEpmRootGoalOpen,
        setEpmRootGoalIndex,
        handleEpmRootGoalSearchKeyDown,
        epmRootGoalsLoading,
        showEpmRootGoalResults,
        epmRootGoalsError,
        filteredEpmRootGoals,
        visibleEpmRootGoals,
        activeEpmRootGoalIndex,
        selectEpmRootGoal,
        selectedEpmSubGoal,
        clearEpmSubGoal,
        epmConfigDraft,
        epmSubGoalQuery,
        setEpmSubGoalQuery,
        setEpmSubGoalOpen,
        setEpmSubGoalIndex,
        loadEpmSubGoalsForRoot,
        handleEpmSubGoalSearchKeyDown,
        epmSubGoalsLoading,
        showEpmSubGoalResults,
        epmSubGoalsError,
        filteredEpmSubGoals,
        visibleEpmSubGoals,
        activeEpmSubGoalIndex,
        selectEpmSubGoal,
        updateEpmLabelPrefixDraft,
        epmProjectPrerequisites,
        canLoadEpmProjects,
        epmConfigLoading,
        epmConfigSaving,
        epmSettingsProjectsError,
        epmSettingsProjectsRefreshing,
        ensureEpmSettingsProjectsLoaded,
        epmSettingsProjectsLoadedAt,
        epmSettingsProjectsFetchMeta,
        epmSettingsProjectView,
        setEpmSettingsProjectView,
        focusEpmScopeField,
        addCustomEpmProjectDraft,
        epmSettingsProjectsLoading,
        renderEpmProjectSkeletonRows,
        epmSettingsProjectsLoaded,
        epmSettingsProjectRows,
        epmSettingsProjectSort,
        setEpmSettingsProjectSort,
        epmSettingsProjects,
        getEpmLabelRowKey,
        getEpmLabelSearchResults,
        labelSearchLoading,
        epmLabelShowAll,
        epmLabelChanging,
        labelSearchIndex,
        isEmptyCustomEpmProjectRow,
        setEpmLabelChanging,
        openEpmLabelMenu,
        loadEpmProjectLabels,
        updateEpmProjectDraft,
        labelSearchQuery,
        setLabelSearchQuery,
        setLabelSearchIndex,
        setLabelSearchOpen,
        setEpmLabelMenuAnchor,
        epmLabelMenuInputRef,
        handleEpmLabelSearchKeyDown,
        setEpmLabelShowAll,
        removeEpmProjectDraft,
        epmLabelMenuAnchor,
        labelSearchOpen,
        selectEpmProjectLabel,
    } = props;

    return (
                                <div className="group-modal-body group-projects-layout">
                                    <div className="group-pane group-single-pane">
                                        <div
                                            className="group-modal-tabs epm-settings-tabs"
                                            role="tablist"
                                            aria-label="EPM settings sections"
                                            onKeyDown={handleEpmSettingsTabKeyDown}
                                        >
                                            <button
                                                className={`group-modal-tab ${epmSettingsTab === 'scope' ? 'active' : ''}`}
                                                onClick={() => setEpmSettingsTab('scope')}
                                                role="tab"
                                                aria-selected={epmSettingsTab === 'scope'}
                                                aria-controls="epm-settings-scope-panel"
                                                id="epm-settings-scope-tab"
                                                type="button"
                                            >Scope</button>
                                            <button
                                                className={`group-modal-tab ${epmSettingsTab === 'projects' ? 'active' : ''}`}
                                                onClick={() => setEpmSettingsTab('projects')}
                                                role="tab"
                                                aria-selected={epmSettingsTab === 'projects'}
                                                aria-controls="epm-settings-projects-panel"
                                                id="epm-settings-projects-tab"
                                                type="button"
                                            >Projects</button>
                                        </div>
                                        {epmSettingsTab === 'scope' && (
                                            <div
                                                id="epm-settings-scope-panel"
                                                className="group-pane-list epm-settings-tab-panel"
                                                role="tabpanel"
                                                aria-labelledby="epm-settings-scope-tab"
                                            >
                                                <div className="group-pane-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
                                                    <div className="group-pane-title">EPM scope</div>
                                                    <div className="group-pane-subtitle">Choose the Jira Home goal scope and label prefix used for EPM project mapping.</div>
                                                </div>
                                                <div className="group-config-card" style={{ marginBottom: '0.9rem' }}>
                                                    <div className="group-projects-subsection">
                                                        <div className="team-selector-label">Atlassian site</div>
                                                        <div className="group-field-helper">
                                                            {epmScopeMeta.cloudId
                                                                ? `Detected from Jira tenant_info: ${epmScopeMeta.cloudId}`
                                                                : (epmScopeMeta.error || 'The Jira Home site will be detected automatically from your Atlassian credentials.')}
                                                        </div>
                                                    </div>
                                                    <div className="group-projects-subsection" style={{ marginTop: '0.8rem' }}>
                                                        <div className="team-selector-label">Root goal</div>
                                                        <div className="group-field-helper">Choose the Jira Home parent goal that owns the EPM project catalog.</div>
                                                        {selectedEpmRootGoal && (
                                                            <div className="selected-team-chip" style={{ marginTop: '0.35rem' }}>
                                                                <span className="team-name">
                                                                    {selectedEpmRootGoal.name || selectedEpmRootGoal.key}
                                                                    {selectedEpmRootGoal.key ? ` (${selectedEpmRootGoal.key})` : ''}
                                                                </span>
                                                                <button
                                                                    className="remove-btn"
                                                                    onClick={clearEpmRootGoal}
                                                                    type="button"
                                                                    title="Clear root goal"
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        )}
                                                        {!selectedEpmRootGoal && (
                                                            <div className="team-search-wrapper" style={{ minWidth: 0, marginTop: '0.5rem' }}>
                                                                <input
                                                                    type="text"
                                                                    className="team-search-input"
                                                                    value={epmRootGoalQuery}
                                                                    onChange={(event) => {
                                                                        setEpmRootGoalQuery(event.target.value);
                                                                        setEpmRootGoalOpen(true);
                                                                        setEpmRootGoalIndex(0);
                                                                    }}
                                                                    onFocus={() => setEpmRootGoalOpen(true)}
                                                                    onBlur={() => { window.setTimeout(() => setEpmRootGoalOpen(false), 120); }}
                                                                    onKeyDown={handleEpmRootGoalSearchKeyDown}
                                                                    placeholder={epmRootGoalsLoading ? 'Loading root goals...' : 'Search root goals...'}
                                                                />
                                                                {showEpmRootGoalResults && (
                                                                    <div className="team-search-results" onMouseDown={(event) => event.preventDefault()}>
                                                                        {epmRootGoalsLoading ? (
                                                                            <div className="team-search-result-item is-empty">Loading root goals...</div>
                                                                        ) : epmRootGoalsError ? (
                                                                            <div className="team-search-result-item is-empty">{epmRootGoalsError}</div>
                                                                        ) : !filteredEpmRootGoals.length ? (
                                                                            <div className="team-search-result-item is-empty">No root goals found</div>
                                                                        ) : (
                                                                            visibleEpmRootGoals.map((goal, index) => (
                                                                                <div
                                                                                    key={goal.id || goal.key}
                                                                                    className={`team-search-result-item ${activeEpmRootGoalIndex === index ? 'active' : ''}`}
                                                                                    onClick={() => { void selectEpmRootGoal(goal); }}
                                                                                >
                                                                                    <strong>{goal.name || goal.key}</strong>
                                                                                    {goal.key ? ` (${goal.key})` : ''}
                                                                                </div>
                                                                            ))
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="group-projects-subsection" style={{ marginTop: '0.8rem' }}>
                                                        <div className="team-selector-label">Sub-goal</div>
                                                        <div className="group-field-helper">
                                                            {!epmConfigDraft.scope?.rootGoalKey
                                                                ? 'Select a root goal before choosing a sub-goal.'
                                                                : 'Choose the Jira Home child goal that owns the direct EPM projects.'}
                                                        </div>
                                                        {selectedEpmSubGoal && (
                                                            <div className="selected-team-chip" style={{ marginTop: '0.35rem' }}>
                                                                <span className="team-name">
                                                                    {selectedEpmSubGoal.name || selectedEpmSubGoal.key}
                                                                    {selectedEpmSubGoal.key ? ` (${selectedEpmSubGoal.key})` : ''}
                                                                </span>
                                                                <button
                                                                    className="remove-btn"
                                                                    onClick={clearEpmSubGoal}
                                                                    type="button"
                                                                    title="Clear sub-goal"
                                                                    data-epm-scope-field="subGoal"
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        )}
                                                        {!selectedEpmSubGoal && (
                                                            <div className="team-search-wrapper" style={{ minWidth: 0, marginTop: '0.5rem' }}>
                                                                <input
                                                                    type="text"
                                                                    className="team-search-input"
                                                                    value={epmSubGoalQuery}
                                                                    onChange={(event) => {
                                                                        setEpmSubGoalQuery(event.target.value);
                                                                        setEpmSubGoalOpen(true);
                                                                        setEpmSubGoalIndex(0);
                                                                    }}
                                                                    onFocus={() => {
                                                                        if (!epmConfigDraft.scope?.rootGoalKey) return;
                                                                        setEpmSubGoalOpen(true);
                                                                        void loadEpmSubGoalsForRoot(epmConfigDraft.scope.rootGoalKey);
                                                                    }}
                                                                    onBlur={() => { window.setTimeout(() => setEpmSubGoalOpen(false), 120); }}
                                                                    onKeyDown={handleEpmSubGoalSearchKeyDown}
                                                                    placeholder={epmSubGoalsLoading ? 'Loading sub-goals...' : 'Search sub-goals...'}
                                                                    disabled={!epmConfigDraft.scope?.rootGoalKey}
                                                                    data-epm-scope-field="subGoal"
                                                                />
                                                                {showEpmSubGoalResults && (
                                                                    <div className="team-search-results" onMouseDown={(event) => event.preventDefault()}>
                                                                        {epmSubGoalsLoading ? (
                                                                            <div className="team-search-result-item is-empty">Loading sub-goals...</div>
                                                                        ) : epmSubGoalsError ? (
                                                                            <div className="team-search-result-item is-empty">{epmSubGoalsError}</div>
                                                                        ) : !filteredEpmSubGoals.length ? (
                                                                            <div className="team-search-result-item is-empty">No sub-goals found</div>
                                                                        ) : (
                                                                            visibleEpmSubGoals.map((goal, index) => (
                                                                                <div
                                                                                    key={goal.id || goal.key}
                                                                                    className={`team-search-result-item ${activeEpmSubGoalIndex === index ? 'active' : ''}`}
                                                                                    onClick={() => selectEpmSubGoal(goal)}
                                                                                >
                                                                                    <strong>{goal.name || goal.key}</strong>
                                                                                    {goal.key ? ` (${goal.key})` : ''}
                                                                                </div>
                                                                            ))
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="group-projects-subsection" style={{ marginTop: '0.8rem' }}>
                                                    <div className="team-selector-label">Label prefix</div>
                                                    <input
                                                        type="text"
                                                        className="team-search-input"
                                                        value={epmConfigDraft.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX}
                                                        onChange={(event) => updateEpmLabelPrefixDraft(event.target.value)}
                                                        placeholder={DEFAULT_EPM_LABEL_PREFIX}
                                                        data-epm-scope-field="labelPrefix"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {epmSettingsTab === 'projects' && (
                                            <div
                                                id="epm-settings-projects-panel"
                                                className="group-pane-list epm-settings-tab-panel epm-projects-tab-panel"
                                                role="tabpanel"
                                                aria-labelledby="epm-settings-projects-tab"
                                            >
                                                <div className="group-pane-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
                                                    <div className="group-pane-header-row">
                                                        <div>
                                                            <div className="group-pane-title">EPM projects</div>
                                                            <div className="group-pane-subtitle">Map direct Jira Home projects under the selected sub-goal to exact Jira labels.</div>
                                                        </div>
                                                        <div className="epm-projects-header-actions">
                                                            {canLoadEpmProjects && (
                                                                <span className="group-modal-meta" aria-live="polite">
                                                                    {epmSettingsProjectsRefreshing
                                                                        ? 'Refreshing...'
                                                                        : epmSettingsProjectsLoadedAt
                                                                            ? `${epmSettingsProjectsFetchMeta.homeProjectCount} Home projects · fetched ${epmSettingsProjectsLoadedAt}${epmSettingsProjectsFetchMeta.cacheHit ? ' · cached' : ''}`
                                                                            : 'Not loaded'}
                                                                    {epmSettingsProjectsFetchMeta.possiblyTruncated && epmSettingsProjectsFetchMeta.homeProjectLimit
                                                                        ? ` · reached ${epmSettingsProjectsFetchMeta.homeProjectLimit} project limit`
                                                                        : ''}
                                                                </span>
                                                            )}
                                                            <button
                                                                className="secondary compact"
                                                                onClick={() => { void ensureEpmSettingsProjectsLoaded({ forceRefresh: true }).catch(() => {}); }}
                                                                disabled={epmConfigLoading || epmConfigSaving || epmSettingsProjectsLoading || epmSettingsProjectsRefreshing || !canLoadEpmProjects}
                                                                type="button"
                                                            >
                                                                {epmSettingsProjectsRefreshing ? 'Refreshing...' : 'Refresh from Jira Home'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="epm-projects-scroll-region">
                                                {epmProjectPrerequisites.length > 0 && (
                                                    <div className="epm-prerequisite-panel">
                                                        <div className="group-pane-title">Setup required</div>
                                                        <div className="group-pane-subtitle">Choose the Jira Home sub-goal and label prefix before loading project configuration.</div>
                                                        <div className="epm-prerequisite-actions">
                                                            {epmProjectPrerequisites.includes('subGoal') && (
                                                                <button className="secondary compact" type="button" onClick={() => focusEpmScopeField('subGoal')}>
                                                                    Set sub-goal
                                                                </button>
                                                            )}
                                                            {epmProjectPrerequisites.includes('labelPrefix') && (
                                                                <button className="secondary compact" type="button" onClick={() => focusEpmScopeField('labelPrefix')}>
                                                                    Set label prefix
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="group-pane-tools" style={{ marginTop: '0.8rem', justifyContent: 'space-between', gap: '0.7rem' }}>
                                                    <div className="epm-project-view-control" role="group" aria-label="EPM project view" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                                                        {['current', 'archived', 'all'].map((view) => (
                                                            <button
                                                                key={view}
                                                                className={`secondary compact ${epmSettingsProjectView === view ? 'active' : ''}`}
                                                                onClick={() => setEpmSettingsProjectView(view)}
                                                                type="button"
                                                                aria-pressed={epmSettingsProjectView === view}
                                                                style={{ padding: '0.26rem 0.55rem', fontSize: '0.62rem' }}
                                                            >
                                                                {view === 'current' ? 'Current' : view === 'archived' ? 'Archived' : 'All'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                        className="secondary compact"
                                                        onClick={addCustomEpmProjectDraft}
                                                        type="button"
                                                    >
                                                        Add custom Project
                                                    </button>
                                                </div>
                                                {epmConfigLoading ? (
                                                    renderEpmProjectSkeletonRows()
                                                ) : epmProjectPrerequisites.length > 0 ? null
                                                : (epmSettingsProjectsLoading && epmSettingsProjectRows.length === 0) ? (
                                                    renderEpmProjectSkeletonRows()
                                                ) : (epmSettingsProjectsError && epmSettingsProjectRows.length === 0) ? (
                                                    <div className="epm-project-load-error">
                                                        <div className="group-pane-subtitle">Failed to load EPM projects: {epmSettingsProjectsError}</div>
                                                        <div className="epm-project-state-actions">
                                                            <button
                                                                className="secondary compact"
                                                                onClick={() => { void ensureEpmSettingsProjectsLoaded({ forceRefresh: true }).catch(() => {}); }}
                                                                type="button"
                                                            >Retry</button>
                                                            <button
                                                                className="secondary compact"
                                                                onClick={addCustomEpmProjectDraft}
                                                                type="button"
                                                            >Add custom Project</button>
                                                        </div>
                                                    </div>
                                                ) : epmSettingsProjectRows.length > 0 ? (
                                                    <div className="epm-project-settings-table" role="table" aria-label="EPM project labels" style={{ display: 'grid', rowGap: 0 }}>
                                                        {epmSettingsProjectsError && (
                                                            <div className="group-field-helper epm-project-load-error">
                                                                Failed to refresh: {epmSettingsProjectsError}
                                                                <button
                                                                    className="secondary compact"
                                                                    onClick={() => { void ensureEpmSettingsProjectsLoaded({ forceRefresh: true }).catch(() => {}); }}
                                                                    type="button"
                                                                >Retry</button>
                                                            </div>
                                                        )}
                                                        <div className="epm-project-table-header" role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(18rem, 1.35fr) 7rem minmax(18rem, 1fr) auto', alignItems: 'center', columnGap: '0.65rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(148,163,184,0.24)' }}>
                                                            <button
                                                                className="epm-project-table-sort"
                                                                onClick={() => setEpmSettingsProjectSort('name')}
                                                                type="button"
                                                                aria-pressed={epmSettingsProjectSort === 'name'}
                                                                style={{ justifySelf: 'start', padding: 0, border: 0, background: 'transparent', color: 'var(--text-muted)', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
                                                            >
                                                                Project{epmSettingsProjectSort === 'name' ? ' ↑' : ''}
                                                            </button>
                                                            <button
                                                                className="epm-project-table-sort"
                                                                onClick={() => setEpmSettingsProjectSort('status')}
                                                                type="button"
                                                                aria-pressed={epmSettingsProjectSort === 'status'}
                                                                style={{ justifySelf: 'start', padding: 0, border: 0, background: 'transparent', color: 'var(--text-muted)', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
                                                            >
                                                                Status{epmSettingsProjectSort === 'status' ? ' ↑' : ''}
                                                            </button>
                                                            <button
                                                                className="epm-project-table-sort"
                                                                onClick={() => setEpmSettingsProjectSort('label')}
                                                                type="button"
                                                                aria-pressed={epmSettingsProjectSort === 'label'}
                                                                style={{ justifySelf: 'start', padding: 0, border: 0, background: 'transparent', color: 'var(--text-muted)', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
                                                            >
                                                                Jira label{epmSettingsProjectSort === 'label' ? ' ↑' : ''}
                                                            </button>
                                                            <span aria-hidden="true" />
                                                        </div>
                                                        {epmSettingsProjectRows.map((project) => {
                                                            const rowKey = getEpmLabelRowKey(project.id);
                                                            const currentLabel = project.label || '';
                                                            const results = getEpmLabelSearchResults(project.id);
                                                            const isSearching = Boolean(labelSearchLoading[rowKey]);
                                                            const showAllLabels = Boolean(epmLabelShowAll[rowKey]);
                                                            const isChangingLabel = Boolean(epmLabelChanging[rowKey]);
                                                            const activeIndex = Math.min(labelSearchIndex[rowKey] || 0, Math.max(results.length - 1, 0));
                                                            const projectStatus = String(project.stateLabel || project.stateValue || '').trim();
                                                            const canRemoveProject = project.homeProjectId === null || project.missingFromHomeFetch;
                                                            const isEmptyCustomProject = isEmptyCustomEpmProjectRow(project);
                                                            const openEpmLabelSearchFromButton = (event) => {
                                                                setEpmLabelChanging(prev => ({ ...prev, [rowKey]: true }));
                                                                window.setTimeout(() => {
                                                                    const wrapper = event.target.closest('.epm-project-settings-row');
                                                                    const input = wrapper ? wrapper.querySelector('.team-search-input[placeholder*="Search Jira labels"]') : null;
                                                                    if (input) {
                                                                        input.focus();
                                                                        openEpmLabelMenu(project.id, input, showAllLabels);
                                                                    } else {
                                                                        setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                                                                        void loadEpmProjectLabels(project.id, showAllLabels);
                                                                    }
                                                                }, 0);
                                                            };
                                                            return (
                                                                <div key={project.id} className="epm-project-settings-row" role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(18rem, 1.35fr) 7rem minmax(18rem, 1fr) auto', alignItems: 'center', columnGap: '0.65rem', rowGap: '0.35rem', padding: '0.55rem 0', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
                                                                    <div className="epm-project-name-cell" role="cell" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, maxWidth: '100%' }}>
                                                                        <input
                                                                            type="text"
                                                                            className="team-search-input"
                                                                            value={project.name || ''}
                                                                            onChange={(event) => updateEpmProjectDraft(project.id, 'name', event.target.value)}
                                                                            placeholder={project.homeName || project.name || 'Project name'}
                                                                            aria-label={`Project name for ${project.displayName || project.homeName || project.id}`}
                                                                            style={{ height: '2rem', minWidth: 0, width: '100%', padding: '0.3rem 0.55rem', fontSize: '0.82rem' }}
                                                                        />
                                                                        {project.homeUrl && (
                                                                            <IconButton
                                                                                as="a"
                                                                                className="epm-project-home-shortcut"
                                                                                href={project.homeUrl}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                title="Open Jira Home project"
                                                                                aria-label={`Open Jira Home project for ${project.displayName || project.homeName || project.id}`}
                                                                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1.75rem', height: '1.75rem', border: '1px solid var(--border)', borderRadius: '999px', background: '#fff', color: 'var(--accent)', textDecoration: 'none' }}
                                                                            >
                                                                                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
                                                                                    <path d="M7 17L17 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                                                                    <path d="M9 7h8v8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                                                                </svg>
                                                                            </IconButton>
                                                                        )}
                                                                    </div>
                                                                    <div className="epm-project-status-cell" role="cell" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                                                                        {projectStatus && (
                                                                            <StatusPill className="epm-home-status-pill" title="Jira Home status" label={projectStatus} style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '999px', padding: '0.16rem 0.45rem', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.58rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', background: '#fbfaf7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} />
                                                                        )}
                                                                    </div>
                                                                    <div className="epm-project-label-cell" role="cell" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, maxWidth: '100%', flexWrap: 'wrap' }}>
                                                                        {currentLabel ? (
                                                                            <div className="epm-label-selected-chip" title={currentLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, maxWidth: '100%', border: '1px solid var(--border)', borderRadius: '999px', background: '#f8f9fa', padding: '0.18rem 0.25rem 0.18rem 0.55rem' }}>
                                                                                <span className="team-name" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{currentLabel}</span>
                                                                                <IconButton
                                                                                    className="epm-label-change-shortcut"
                                                                                    onClick={openEpmLabelSearchFromButton}
                                                                                    title="Change label"
                                                                                    aria-label={`Change Jira label for ${project.displayName || project.homeName || project.id}`}
                                                                                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1.35rem', height: '1.35rem', flex: '0 0 auto', border: '1px solid var(--border)', borderRadius: '999px', background: '#fff', color: 'var(--text-muted)', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.8rem', lineHeight: 1, padding: 0, cursor: 'pointer' }}
                                                                                >
                                                                                    &times;
                                                                                </IconButton>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="epm-label-choice-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, flexWrap: 'wrap' }}>
                                                                                <div className="group-field-helper" style={{ margin: 0, whiteSpace: 'nowrap' }}>No Jira label selected.</div>
                                                                                {!isChangingLabel && !isEmptyCustomProject && (
                                                                                    <button
                                                                                        className="secondary compact"
                                                                                        onClick={openEpmLabelSearchFromButton}
                                                                                        type="button"
                                                                                        style={{ padding: '0.22rem 0.55rem', fontSize: '0.62rem', whiteSpace: 'nowrap' }}
                                                                                    >
                                                                                        Choose label
                                                                                    </button>
                                                                                )}
                                                                                {isEmptyCustomProject && (
                                                                                    <button
                                                                                        className="secondary compact"
                                                                                        onClick={() => removeEpmProjectDraft(project.id)}
                                                                                        type="button"
                                                                                        title="Delete empty project"
                                                                                        aria-label="Delete empty project"
                                                                                        style={{ padding: '0.22rem 0.55rem', fontSize: '0.62rem', whiteSpace: 'nowrap' }}
                                                                                    >
                                                                                        Delete
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        {isChangingLabel && (
                                                                        <div className="team-search-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: '1 1 260px', minWidth: 0 }}>
                                                                            <input
                                                                                type="text"
                                                                                className="team-search-input"
                                                                                placeholder={isSearching ? 'Searching labels...' : 'Search Jira labels...'}
                                                                                value={labelSearchQuery[rowKey] || ''}
                                                                                onChange={(event) => {
                                                                                    const value = event.target.value;
                                                                                    setLabelSearchQuery(prev => ({ ...prev, [rowKey]: value }));
                                                                                    openEpmLabelMenu(project.id, event.currentTarget, showAllLabels);
                                                                                    setLabelSearchIndex(prev => ({ ...prev, [rowKey]: 0 }));
                                                                                }}
                                                                                onFocus={(event) => {
                                                                                    openEpmLabelMenu(project.id, event.currentTarget, showAllLabels);
                                                                                }}
                                                                                onBlur={() => window.setTimeout(() => {
                                                                                    setLabelSearchOpen(prev => ({ ...prev, [rowKey]: false }));
                                                                                    setEpmLabelMenuAnchor(prev => (prev && prev.rowKey === rowKey ? null : prev));
                                                                                    if (epmLabelMenuInputRef.current && !document.body.contains(epmLabelMenuInputRef.current)) {
                                                                                        epmLabelMenuInputRef.current = null;
                                                                                    }
                                                                                }, 120)}
                                                                                onKeyDown={(event) => handleEpmLabelSearchKeyDown(project.id, event, results)}
                                                                                style={{ height: '2rem', minWidth: '10rem', flex: '1 1 180px', padding: '0.3rem 0.55rem', fontSize: '0.82rem' }}
                                                                            />
                                                                            <button
                                                                                className="secondary compact"
                                                                                onClick={(event) => {
                                                                                    const nextShowAll = !showAllLabels;
                                                                                    setEpmLabelShowAll(prev => ({ ...prev, [rowKey]: nextShowAll }));
                                                                                    const wrapper = event.target.closest('.team-search-wrapper');
                                                                                    const input = wrapper ? wrapper.querySelector('.team-search-input') : null;
                                                                                    if (input) {
                                                                                        openEpmLabelMenu(project.id, input, nextShowAll);
                                                                                    } else {
                                                                                        setLabelSearchOpen(prev => ({ ...prev, [rowKey]: true }));
                                                                                        void loadEpmProjectLabels(project.id, nextShowAll);
                                                                                    }
                                                                                }}
                                                                                type="button"
                                                                                style={{ padding: '0.28rem 0.55rem', whiteSpace: 'nowrap' }}
                                                                            >
                                                                                {showAllLabels ? 'Use prefix' : 'Show all labels'}
                                                                            </button>
                                                                        </div>
                                                                        )}
                                                                    </div>
                                                                    {canRemoveProject && !isEmptyCustomProject && (
                                                                        <button
                                                                            className="secondary compact"
                                                                            onClick={() => removeEpmProjectDraft(project.id)}
                                                                            type="button"
                                                                            title="Remove Project"
                                                                            aria-label={`Remove ${project.displayName || project.homeName || project.id}`}
                                                                            style={{ padding: '0.28rem 0.55rem', flex: '0 0 auto' }}
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    )}
                                                                    {project.missingFromHomeFetch && (
                                                                        <div className="group-field-helper epm-project-row-warning" style={{ gridColumn: '1 / -1', margin: 0 }}>
                                                                            Not returned by latest Jira Home refresh.
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (epmSettingsProjects.length > 0 && epmSettingsProjectsLoaded && !epmSettingsProjectsLoading && !epmSettingsProjectsError) ? (
                                                    <div className="epm-project-empty-state">
                                                        <div className="group-pane-subtitle">No projects in this view.</div>
                                                    </div>
                                                ) : (epmSettingsProjects.length === 0 && epmSettingsProjectsLoaded && !epmSettingsProjectsLoading && !epmSettingsProjectsError) ? (
                                                    <div className="epm-project-empty-state">
                                                        <div className="group-pane-subtitle">No Home projects under the configured sub-goal.</div>
                                                        <div className="group-pane-subtitle">This sub-goal has no direct Jira Home projects. Choose a different child goal.</div>
                                                        <div className="epm-project-state-actions">
                                                            <button
                                                                className="secondary compact"
                                                                onClick={addCustomEpmProjectDraft}
                                                                type="button"
                                                            >Add custom Project</button>
                                                        </div>
                                                    </div>
                                                ) : (epmSettingsProjectsLoading || epmSettingsProjectsRefreshing) ? (
                                                    renderEpmProjectSkeletonRows()
                                                ) : null}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {epmLabelMenuAnchor && labelSearchOpen[epmLabelMenuAnchor.rowKey] && (
                                        <div
                                            className="team-search-results epm-label-menu-layer"
                                            style={{
                                                top: epmLabelMenuAnchor.top,
                                                left: epmLabelMenuAnchor.left,
                                                width: epmLabelMenuAnchor.width,
                                            }}
                                            onMouseDown={(event) => event.preventDefault()}
                                        >
                                            {getEpmLabelSearchResults(epmLabelMenuAnchor.projectId).length === 0 ? (
                                                <div className="team-search-result-item is-empty">
                                                    {labelSearchLoading[epmLabelMenuAnchor.rowKey] ? 'Searching labels...' : 'No labels found'}
                                                </div>
                                            ) : getEpmLabelSearchResults(epmLabelMenuAnchor.projectId).map((label, index) => (
                                                <div
                                                    key={`${epmLabelMenuAnchor.rowKey}-${label}`}
                                                    className={`team-search-result-item ${(labelSearchIndex[epmLabelMenuAnchor.rowKey] || 0) === index ? 'active' : ''}`}
                                                    onMouseEnter={() => setLabelSearchIndex(prev => ({ ...prev, [epmLabelMenuAnchor.rowKey]: index }))}
                                                    onClick={() => selectEpmProjectLabel(epmLabelMenuAnchor.projectId, label)}
                                                >
                                                    {label}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
    );
}
