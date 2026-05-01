import * as React from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';

export default function JiraFieldSettings(props) {
    const {
        groupManageTab,
        showTechnicalFieldIds,
        setShowTechnicalFieldIds,
        sprintFieldNameDraft,
        sprintFieldIdDraft,
        setSprintFieldIdDraft,
        setSprintFieldNameDraft,
        loadingFields,
        sprintFieldSearchQuery,
        setSprintFieldSearchQuery,
        setSprintFieldSearchOpen,
        setSprintFieldSearchIndex,
        handleSprintFieldSearchKeyDown,
        sprintFieldSearchInputRef,
        jiraFields,
        sprintFieldSearchOpen,
        sprintFieldSearchResults,
        sprintFieldSearchIndex,
        boardIdDraft,
        boardSearchRemoteLoading,
        boardSearchQuery,
        setBoardSearchQuery,
        setBoardSearchOpen,
        setBoardSearchIndex,
        handleBoardSearchKeyDown,
        boardSearchInputRef,
        boardSearchOpen,
        boardSearchResults,
        boardSearchIndex,
        setBoardIdDraft,
        setBoardNameDraft,
        boardNameDraft,
        clearBoardSelection,
        loadingProjects,
        jiraProjects,
        projectSearchQuery,
        setProjectSearchQuery,
        setProjectSearchOpen,
        setProjectSearchIndex,
        handleProjectSearchKeyDown,
        projectSearchInputRef,
        projectSearchOpen,
        projectSearchRemoteLoading,
        projectSearchResults,
        projectSearchIndex,
        addProjectSelection,
        selectedProjectsDraft,
        resolveProjectName,
        removeProjectSelection,
        mappingHoverKey,
        setMappingHoverKey,
        issueTypesDraft,
        parentNameFieldNameDraft,
        storyPointsFieldNameDraft,
        teamFieldNameDraft,
        parentNameFieldIdDraft,
        storyPointsFieldIdDraft,
        teamFieldIdDraft,
        issueTypeSearchQuery,
        setIssueTypeSearchQuery,
        setIssueTypeSearchOpen,
        setIssueTypeSearchIndex,
        handleIssueTypeSearchKeyDown,
        issueTypeSearchInputRef,
        issueTypeSearchOpen,
        issueTypeSearchResults,
        issueTypeSearchIndex,
        addIssueType,
        removeIssueType,
        setParentNameFieldIdDraft,
        setParentNameFieldNameDraft,
        parentNameFieldSearchQuery,
        setParentNameFieldSearchQuery,
        setParentNameFieldSearchOpen,
        setParentNameFieldSearchIndex,
        handleParentNameFieldSearchKeyDown,
        parentNameFieldSearchInputRef,
        parentNameFieldSearchOpen,
        parentNameFieldSearchResults,
        parentNameFieldSearchIndex,
        setStoryPointsFieldIdDraft,
        setStoryPointsFieldNameDraft,
        storyPointsFieldSearchQuery,
        setStoryPointsFieldSearchQuery,
        setStoryPointsFieldSearchOpen,
        setStoryPointsFieldSearchIndex,
        handleStoryPointsFieldSearchKeyDown,
        storyPointsFieldSearchInputRef,
        storyPointsFieldSearchOpen,
        storyPointsFieldSearchResults,
        storyPointsFieldSearchIndex,
        teamFieldSearchQuery,
        setTeamFieldSearchQuery,
        setTeamFieldSearchOpen,
        setTeamFieldSearchIndex,
        handleTeamFieldSearchKeyDown,
        teamFieldSearchInputRef,
        teamFieldSearchOpen,
        teamFieldSearchResults,
        teamFieldSearchIndex,
        setTeamFieldIdDraft,
        setTeamFieldNameDraft,
        capacityProjectDraft,
        resolveCapacityProjectName,
        setCapacityProjectDraft,
        capacityProjectSearchQuery,
        setCapacityProjectSearchQuery,
        setCapacityProjectSearchOpen,
        setCapacityProjectSearchIndex,
        handleCapacityProjectSearchKeyDown,
        capacityProjectSearchInputRef,
        capacityProjectSearchOpen,
        capacityProjectSearchResults,
        capacityProjectSearchIndex,
        capacityFieldNameDraft,
        capacityFieldIdDraft,
        setCapacityFieldIdDraft,
        setCapacityFieldNameDraft,
        capacityFieldSearchQuery,
        setCapacityFieldSearchQuery,
        setCapacityFieldSearchOpen,
        setCapacityFieldSearchIndex,
        handleCapacityFieldSearchKeyDown,
        capacityFieldSearchInputRef,
        capacityFieldSearchOpen,
        capacityFieldSearchResults,
        capacityFieldSearchIndex,
        priorityWeightsSource,
        priorityWeightsDraft,
        updatePriorityWeightDraft,
        priorityWeightsSum,
        resetPriorityWeightsDraft,
        priorityWeightsValidationError,
    } = props;

    return (
        <>
                                {(groupManageTab === 'scope' || groupManageTab === 'source' || groupManageTab === 'mapping' || groupManageTab === 'capacity' || groupManageTab === 'priorityWeights') && (
                                    <div className="group-modal-body group-modal-split group-projects-layout">
                                        {(groupManageTab === 'source' || groupManageTab === 'scope') && (
                                        <>
                                        {groupManageTab === 'source' && (
                                        <div className="group-pane group-projects-pane-left group-single-pane" style={{ borderRight: 'none' }}>
                                            <div className="group-pane-tools group-pane-tools-right" style={{ padding: '0.8rem 1rem 0 1rem' }}>
                                                <button
                                                    className={`secondary compact ${showTechnicalFieldIds ? 'active' : ''}`}
                                                    onClick={() => setShowTechnicalFieldIds((prev) => !prev)}
                                                    type="button"
                                                >
                                                    {showTechnicalFieldIds ? 'Hide Jira technical IDs' : 'Show Jira technical IDs'}
                                                </button>
                                            </div>
                                            <div className="group-projects-subsection" style={{padding: '12px 16px 0'}}>
                                                <div className="group-pane-title">Jira Source</div>
                                                <div className="group-field-helper">Configure how sprint data is discovered and read from Jira.</div>
                                            </div>
                                            <div className="settings-two-col-grid settings-source-grid" style={{ padding: '12px 16px 12px' }}>
                                                <div className="group-projects-subsection" style={{marginTop: 0}}>
                                                    <div className="team-selector-label">Sprint Field</div>
                                                    <div className="group-field-helper">Used to determine which sprint each ticket belongs to.</div>
                                                    <div className="capacity-inline-row">
                                                        {sprintFieldNameDraft ? (
                                                            <div className="selected-team-chip" title={sprintFieldIdDraft || ''}>
                                                                <span className="team-name"><strong>{sprintFieldNameDraft}</strong>{showTechnicalFieldIds && sprintFieldIdDraft && <span className="field-id-hint">({sprintFieldIdDraft})</span>}</span>
                                                                <button className="remove-btn" onClick={() => { setSprintFieldIdDraft(''); setSprintFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove sprint field">&times;</button>
                                                            </div>
                                                        ) : (
                                                        <div className="team-search-wrapper capacity-inline-search">
                                                            <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={sprintFieldSearchQuery} onChange={(e) => { setSprintFieldSearchQuery(e.target.value); setSprintFieldSearchOpen(true); setSprintFieldSearchIndex(0); }} onFocus={() => setSprintFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setSprintFieldSearchOpen(false), 120); }} onKeyDown={handleSprintFieldSearchKeyDown} ref={sprintFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                            {sprintFieldSearchOpen && sprintFieldSearchResults.length > 0 && (
                                                                <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                    {sprintFieldSearchResults.map((f, index) => (
                                                                        <div key={f.id} className={`team-search-result-item ${index === sprintFieldSearchIndex ? 'active' : ''}`} onClick={() => { setSprintFieldIdDraft(f.id); setSprintFieldNameDraft(f.name); setSprintFieldSearchQuery(''); setSprintFieldSearchOpen(false); }}>
                                                                            <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="group-projects-subsection" style={{marginTop: 0}}>
                                                    <div className="team-selector-label">Sprint Board (optional)</div>
                                                    <div className="group-field-helper">Used for faster sprint loading. If empty, the server falls back to env/default issue-based sprint discovery.</div>
                                                    {!boardIdDraft && (
                                                        <div className="capacity-inline-row">
                                                            <div className="team-search-wrapper capacity-inline-search">
                                                                    <input
                                                                        type="text"
                                                                        className="team-search-input"
                                                                        placeholder={boardSearchRemoteLoading ? 'Searching boards...' : 'Search boards...'}
                                                                        value={boardSearchQuery}
                                                                        onChange={(e) => { setBoardSearchQuery(e.target.value); setBoardSearchOpen(true); setBoardSearchIndex(0); }}
                                                                        onFocus={() => { setBoardSearchOpen(true); }}
                                                                        onBlur={() => { window.setTimeout(() => setBoardSearchOpen(false), 120); }}
                                                                        onKeyDown={handleBoardSearchKeyDown}
                                                                        ref={boardSearchInputRef}
                                                                        disabled={false}
                                                                    />
                                                                {boardSearchOpen && boardSearchQuery.trim() && (
                                                                    <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                        {boardSearchRemoteLoading ? (
                                                                            <div className="team-search-result-item is-empty">Searching boards...</div>
                                                                        ) : boardSearchResults.length === 0 ? (
                                                                            <div className="team-search-result-item is-empty">No boards found</div>
                                                                        ) : boardSearchResults.map((b, index) => (
                                                                            <div
                                                                                key={b.id}
                                                                                className={`team-search-result-item ${index === boardSearchIndex ? 'active' : ''}`}
                                                                                onClick={() => {
                                                                                    setBoardIdDraft(String(b.id || ''));
                                                                                    setBoardNameDraft(String(b.name || ''));
                                                                                    setBoardSearchQuery('');
                                                                                    setBoardSearchOpen(false);
                                                                            }}
                                                                        >
                                                                                <strong>{b.name || `Board ${b.id}`}</strong> <span style={{opacity: 0.55}}>({b.id}{b.type ? ` · ${b.type}` : ''})</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {boardIdDraft ? (
                                                        <div className="selected-teams-list" style={{ marginTop: '0.45rem' }}>
                                                            <div className="selected-team-chip" title={boardIdDraft}>
                                                                <span className="team-name">
                                                                    <strong>{boardNameDraft || `Board ${boardIdDraft}`}</strong>
                                                                    {showTechnicalFieldIds && boardNameDraft ? ` (${boardIdDraft})` : ''}
                                                                </span>
                                                                <button className="remove-btn" onClick={clearBoardSelection} type="button" title="Clear board" aria-label="Clear sprint board">&times;</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="team-selector-empty">No board selected (fallback mode).</div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        )}
                                        {groupManageTab === 'scope' && (
                                        <div className={`group-pane group-projects-pane-right group-single-pane ${groupManageTab === 'mapping' ? 'mapping-config-pane' : ''}`}>
                                            <div className="group-pane-header group-projects-pane-header">
                                                <div className="group-pane-title">Dashboard Projects</div>
                                                <div className="group-projects-desc">
                                                    Select which Jira projects to include in dashboard queries and assign each to Product or Tech for the planning split.
                                                </div>
                                                <div className="team-search-wrapper">
                                                    <input
                                                        type="text"
                                                        className="team-search-input"
                                                        placeholder={loadingProjects ? 'Loading projects...' : 'Search projects to add...'}
                                                        value={projectSearchQuery}
                                                        onChange={(e) => { setProjectSearchQuery(e.target.value); setProjectSearchOpen(true); setProjectSearchIndex(0); }}
                                                        onFocus={() => setProjectSearchOpen(true)}
                                                        onBlur={() => { window.setTimeout(() => setProjectSearchOpen(false), 120); }}
                                                        onKeyDown={handleProjectSearchKeyDown}
                                                        ref={projectSearchInputRef}
                                                        disabled={loadingProjects && !jiraProjects.length}
                                                    />
                                                    {projectSearchOpen && projectSearchQuery.trim() && (
                                                        <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                            {projectSearchRemoteLoading ? (
                                                                <div className="team-search-result-item is-empty">Searching Jira projects...</div>
                                                            ) : projectSearchResults.length === 0 ? (
                                                                <div className="team-search-result-item is-empty">No projects found</div>
                                                            ) : projectSearchResults.map((p, index) => (
                                                                <div
                                                                    key={p.key}
                                                                    className={`team-search-result-item ${index === projectSearchIndex ? 'active' : ''}`}
                                                                >
                                                                    <span className="project-result-label"><strong>{p.key}</strong> &mdash; {p.name}</span>
                                                                    <span className="project-result-actions">
                                                                        <button type="button" className="project-type-btn product" onClick={() => addProjectSelection(p.key, 'product')}>Product</button>
                                                                        <button type="button" className="project-type-btn tech" onClick={() => addProjectSelection(p.key, 'tech')}>Tech</button>
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="group-pane-list group-projects-pane-list">
                                                <div className="settings-two-col-grid settings-scope-grid">
                                                <div className="group-projects-subsection">
                                                    <div className="team-selector-label">Product</div>
                                                    <div className="group-field-helper">Projects counted as Product work in planning and stats.</div>
                                                    {selectedProjectsDraft.filter(p => p.type === 'product').length === 0 ? (
                                                        <div className="team-selector-empty">No product projects.</div>
                                                    ) : (
                                                        <div className="selected-teams-list">
                                                            {selectedProjectsDraft.filter(p => p.type === 'product').map(p => (
                                                                <div key={p.key} className="selected-team-chip product-chip">
                                                                    <span className="team-name"><strong>{p.key}</strong>{resolveProjectName(p.key) !== p.key ? ` \u2014 ${resolveProjectName(p.key)}` : ''}</span>
                                                                    <button className="remove-btn" onClick={() => removeProjectSelection(p.key)} type="button" title="Remove project" aria-label={`Remove product project ${p.key}`}>&times;</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="group-projects-subsection">
                                                    <div className="team-selector-label">Tech</div>
                                                    <div className="group-field-helper">Projects counted as Tech work in planning and stats.</div>
                                                    {selectedProjectsDraft.filter(p => p.type === 'tech').length === 0 ? (
                                                        <div className="team-selector-empty">No tech projects.</div>
                                                    ) : (
                                                        <div className="selected-teams-list">
                                                            {selectedProjectsDraft.filter(p => p.type === 'tech').map(p => (
                                                                <div key={p.key} className="selected-team-chip tech-chip">
                                                                    <span className="team-name"><strong>{p.key}</strong>{resolveProjectName(p.key) !== p.key ? ` \u2014 ${resolveProjectName(p.key)}` : ''}</span>
                                                                    <button className="remove-btn" onClick={() => removeProjectSelection(p.key)} type="button" title="Remove project" aria-label={`Remove tech project ${p.key}`}>&times;</button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                </div>
                                            </div>
                                        </div>
                                        )}
                                        </>
                                        )}
                                        {(groupManageTab === 'mapping' || groupManageTab === 'capacity' || groupManageTab === 'priorityWeights') && (
                                        <div className="group-pane group-projects-pane-right group-single-pane">
                                            <div className="group-pane-tools group-pane-tools-right">
                                                {(groupManageTab === 'mapping' || groupManageTab === 'capacity') && (
                                                    <button
                                                        className={`secondary compact ${showTechnicalFieldIds ? 'active' : ''}`}
                                                        onClick={() => setShowTechnicalFieldIds((prev) => !prev)}
                                                        type="button"
                                                    >
                                                        {showTechnicalFieldIds ? 'Hide Jira technical IDs' : 'Show Jira technical IDs'}
                                                    </button>
                                                )}
                                            </div>
                                            {groupManageTab === 'mapping' && (
                                            <>
                                            <div className="mapping-preview-section group-config-card">
                                                <div className="group-pane-title">Preview</div>
                                                <div className="group-field-helper">This is how a story will be shown with your current mapping.</div>
                                                {(() => {
                                                    const previewIssueType = issueTypesDraft[0] || 'Issue Type';
                                                    const previewParentFieldName = parentNameFieldNameDraft || 'Parent Name Field';
                                                    const previewStoryPointsFieldName = storyPointsFieldNameDraft || 'Story Points Field';
                                                    const previewTeamFieldName = teamFieldNameDraft || 'Team Field';
                                                    const previewParentFieldId = parentNameFieldIdDraft || '';
                                                    const previewStoryPointsFieldId = storyPointsFieldIdDraft || '';
                                                    const previewTeamFieldId = teamFieldIdDraft || '';
                                                    const previewEpic = {
                                                        key: 'Parent-Key',
                                                        parentValue: parentNameFieldNameDraft || 'Parent Name Field'
                                                    };
                                                    const previewStories = [
                                                        {
                                                            key: 'STORY-KEY',
                                                            summary: 'Story Summary',
                                                            status: 'Status',
                                                            statusClass: 'accepted',
                                                            updated: 'Last Updated Date',
                                                            storyPoints: storyPointsFieldNameDraft ? 'Story Points' : 'Story Points Field',
                                                            team: teamFieldNameDraft ? 'Team Name' : 'Team Field'
                                                        }
                                                    ];
                                                    const renderFieldLabel = (label, id) => (
                                                        <>
                                                            {label}
                                                            {showTechnicalFieldIds && id && <span className="field-id-hint">({id})</span>}
                                                        </>
                                                    );
                                                    return (
                                                            <div className={`epic-block mapping-preview-card ${mappingHoverKey ? 'mapping-hover-active' : ''}`}>
                                                                <div className="epic-header">
                                                                    <div className="epic-title">
                                                                        <div className="epic-title-row">
                                                                            <span className="epic-icon" aria-hidden="true" title="EPIC">
                                                                                <svg viewBox="0 0 16 16" fill="none">
                                                                                    <path
                                                                                        clipRule="evenodd"
                                                                                        d="m10.271.050656c.2887.111871.479.38969.479.699344v4.63515l3.1471.62941c.2652.05303.4812.24469.5655.50161s.0238.53933-.1584.73914l-7.74997 8.49999c-.20863.2288-.53644.3059-.82517.194-.28874-.1118-.47905-.3896-.47905-.6993v-4.6351l-3.14708-.62947c-.26515-.05303-.48123-.24468-.56553-.5016-.08431-.25692-.02379-.53933.1584-.73915l7.75-8.499996c.20863-.2288201.53643-.305899.8252-.194028zm-6.57276 8.724134 3.05177.61036v3.92915l5.55179-6.08909-3.05179-.61036v-3.9291z"
                                                                                        fill="#bf63f3"
                                                                                        fillRule="evenodd"
                                                                                    />
                                                                                </svg>
                                                                            </span>
                                                                        <a
                                                                            className={`epic-link mapping-preview-dimmable mapping-preview-linkable mapping-preview-link-parent ${mappingHoverKey === 'parent' ? 'is-linked-hover' : ''}`}
                                                                            href="#"
                                                                            onClick={(e) => e.preventDefault()}
                                                                            onMouseEnter={() => setMappingHoverKey('parent')}
                                                                            onMouseLeave={() => setMappingHoverKey(null)}
                                                                            data-map-key="parent"
                                                                        >
                                                                            <span className="epic-name mapping-preview-parent-value">{previewEpic.parentValue}</span>
                                                                            <span className="epic-key">{previewEpic.key}</span>
                                                                        </a>
                                                                    </div>
                                                                </div>
                                                                <div className="epic-meta mapping-preview-epic-meta">
                                                                    <span
                                                                        className={`mapping-preview-dimmable mapping-preview-linkable mapping-preview-link-story-points ${mappingHoverKey === 'storyPoints' ? 'is-linked-hover' : ''}`}
                                                                        onMouseEnter={() => setMappingHoverKey('storyPoints')}
                                                                        onMouseLeave={() => setMappingHoverKey(null)}
                                                                        data-map-key="storyPoints"
                                                                    >
                                                                        SP: Story Points Total
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {previewStories.map((story) => (
                                                                <div
                                                                    key={story.key}
                                                                    className="task-item priority-major"
                                                                    data-task-key={`preview-${story.key}`}
                                                                >
                                                                    <div className="task-header">
                                                                        <div className="task-headline">
                                                                            <span className="story-icon" aria-hidden="true" title="STORY">
                                                                                <svg viewBox="0 0 24 24" fill="none">
                                                                                    <path d="M7 4h10a2 2 0 012 2v14l-7-4-7 4V6a2 2 0 012-2z" stroke="#55A630" strokeWidth="2" strokeLinejoin="round"/>
                                                                                </svg>
                                                                            </span>
                                                                            <h3 className="task-title">
                                                                                <a
                                                                                    href="#"
                                                                                    onClick={(e) => e.preventDefault()}
                                                                                    className={`mapping-preview-dimmable mapping-preview-linkable mapping-preview-link-issue ${mappingHoverKey === 'issueType' ? 'is-linked-hover' : ''}`}
                                                                                    onMouseEnter={() => setMappingHoverKey('issueType')}
                                                                                    onMouseLeave={() => setMappingHoverKey(null)}
                                                                                    data-map-key="issueType"
                                                                                    title={showTechnicalFieldIds ? `Issue Type: ${previewIssueType}` : undefined}
                                                                                >
                                                                                    {story.summary}
                                                                                </a>
                                                                            </h3>
                                                                            <span className="task-inline-meta">
                                                                                <a
                                                                                    className={`task-key-link mapping-preview-dimmable mapping-preview-linkable mapping-preview-link-issue ${mappingHoverKey === 'issueType' ? 'is-linked-hover' : ''}`}
                                                                                    href="#"
                                                                                    onClick={(e) => e.preventDefault()}
                                                                                    onMouseEnter={() => setMappingHoverKey('issueType')}
                                                                                    onMouseLeave={() => setMappingHoverKey(null)}
                                                                                    data-map-key="issueType"
                                                                                    title={showTechnicalFieldIds ? `Issue Type: ${previewIssueType}` : undefined}
                                                                                >
                                                                                    {story.key}
                                                                                </a>
                                                                                <span
                                                                                    className={`task-inline-sp mapping-preview-dimmable mapping-preview-linkable mapping-preview-link-story-points ${mappingHoverKey === 'storyPoints' ? 'is-linked-hover' : ''}`}
                                                                                    onMouseEnter={() => setMappingHoverKey('storyPoints')}
                                                                                    onMouseLeave={() => setMappingHoverKey(null)}
                                                                                    data-map-key="storyPoints"
                                                                                >
                                                                                    {storyPointsFieldNameDraft ? 'Story Points' : 'SP Value'}
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="task-meta">
                                                                        <StatusPill
                                                                            className={getIssueStatusClassName(story.status, `mapping-preview-dimmable ${story.statusClass || ''}`)}
                                                                            label={story.status}
                                                                        />
                                                                        <span
                                                                            className={`task-team mapping-preview-dimmable mapping-preview-task-team mapping-preview-linkable mapping-preview-link-team ${mappingHoverKey === 'team' ? 'is-linked-hover' : ''}`}
                                                                            onMouseEnter={() => setMappingHoverKey('team')}
                                                                            onMouseLeave={() => setMappingHoverKey(null)}
                                                                            data-map-key="team"
                                                                        >
                                                                            {story.team}
                                                                        </span>
                                                                        <span className="task-updated mapping-preview-dimmable">
                                                                            Last Update: {story.updated}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                            <div className="mapping-config-grid">
                                            <div
                                                className={`group-projects-section group-config-card ${mappingHoverKey === 'issueType' ? 'is-linked-hover' : ''}`}
                                                onMouseEnter={() => setMappingHoverKey('issueType')}
                                                onMouseLeave={() => setMappingHoverKey(null)}
                                                data-map-key="issueType"
                                            >
                                                <div className="group-pane-title">Issue Type</div>
                                                <div className="group-field-helper">Only these issue types are loaded into the dashboard.</div>
                                                <div className="capacity-inline-row">
                                                    {issueTypesDraft.length > 0 ? (
                                                        <div className="selected-team-chip issue-type-chip">
                                                            <span className="team-name">{issueTypesDraft[0]}</span>
                                                            <button className="remove-btn" onClick={() => removeIssueType(issueTypesDraft[0])} type="button" title="Remove" aria-label={`Remove issue type ${issueTypesDraft[0]}`}>&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input
                                                            type="text"
                                                            className="team-search-input"
                                                            placeholder="Search issue types..."
                                                            value={issueTypeSearchQuery}
                                                            onChange={(e) => { setIssueTypeSearchQuery(e.target.value); setIssueTypeSearchOpen(true); setIssueTypeSearchIndex(0); }}
                                                            onFocus={() => setIssueTypeSearchOpen(true)}
                                                            onBlur={() => { window.setTimeout(() => setIssueTypeSearchOpen(false), 120); }}
                                                            onKeyDown={handleIssueTypeSearchKeyDown}
                                                            ref={issueTypeSearchInputRef}
                                                        />
                                                        {issueTypeSearchOpen && issueTypeSearchQuery.trim() && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {issueTypeSearchResults.length === 0 ? (
                                                                    <div className="team-search-result-item is-empty">No issue types found</div>
                                                                ) : issueTypeSearchResults.map((it, index) => (
                                                                    <div
                                                                        key={it.name}
                                                                        className={`team-search-result-item ${index === issueTypeSearchIndex ? 'active' : ''}`}
                                                                        onClick={() => addIssueType(it.name)}
                                                                    >
                                                                        {it.name}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                                {issueTypesDraft.length === 0 && (
                                                    <div className="team-selector-empty">No filter — all issue types will be included.</div>
                                                )}
                                            </div>
                                            <div
                                                className={`group-projects-subsection ${mappingHoverKey === 'parent' ? 'is-linked-hover' : ''}`}
                                                onMouseEnter={() => setMappingHoverKey('parent')}
                                                onMouseLeave={() => setMappingHoverKey(null)}
                                                data-map-key="parent"
                                            >
                                                <div className="team-selector-label">Parent Name Field</div>
                                                <div className="group-field-helper">Field used to map stories back to their parent epic name.</div>
                                                <div className="capacity-inline-row">
                                                    {parentNameFieldNameDraft ? (
                                                        <div className="selected-team-chip mapping-parent-chip" title={parentNameFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{parentNameFieldNameDraft}</strong>{showTechnicalFieldIds && parentNameFieldIdDraft && <span className="field-id-hint">({parentNameFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setParentNameFieldIdDraft(''); setParentNameFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove parent name field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={parentNameFieldSearchQuery} onChange={(e) => { setParentNameFieldSearchQuery(e.target.value); setParentNameFieldSearchOpen(true); setParentNameFieldSearchIndex(0); }} onFocus={() => setParentNameFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setParentNameFieldSearchOpen(false), 120); }} onKeyDown={handleParentNameFieldSearchKeyDown} ref={parentNameFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {parentNameFieldSearchOpen && parentNameFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {parentNameFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === parentNameFieldSearchIndex ? 'active' : ''}`} onClick={() => { setParentNameFieldIdDraft(f.id); setParentNameFieldNameDraft(f.name); setParentNameFieldSearchQuery(''); setParentNameFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div
                                                className={`group-projects-subsection ${mappingHoverKey === 'storyPoints' ? 'is-linked-hover' : ''}`}
                                                onMouseEnter={() => setMappingHoverKey('storyPoints')}
                                                onMouseLeave={() => setMappingHoverKey(null)}
                                                data-map-key="storyPoints"
                                            >
                                                <div className="team-selector-label">Story Points Field</div>
                                                <div className="group-field-helper">Field used for effort, velocity, and capacity comparisons.</div>
                                                <div className="capacity-inline-row">
                                                    {storyPointsFieldNameDraft ? (
                                                        <div className="selected-team-chip mapping-sp-chip" title={storyPointsFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{storyPointsFieldNameDraft}</strong>{showTechnicalFieldIds && storyPointsFieldIdDraft && <span className="field-id-hint">({storyPointsFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setStoryPointsFieldIdDraft(''); setStoryPointsFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove story points field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={storyPointsFieldSearchQuery} onChange={(e) => { setStoryPointsFieldSearchQuery(e.target.value); setStoryPointsFieldSearchOpen(true); setStoryPointsFieldSearchIndex(0); }} onFocus={() => setStoryPointsFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setStoryPointsFieldSearchOpen(false), 120); }} onKeyDown={handleStoryPointsFieldSearchKeyDown} ref={storyPointsFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {storyPointsFieldSearchOpen && storyPointsFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {storyPointsFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === storyPointsFieldSearchIndex ? 'active' : ''}`} onClick={() => { setStoryPointsFieldIdDraft(f.id); setStoryPointsFieldNameDraft(f.name); setStoryPointsFieldSearchQuery(''); setStoryPointsFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div
                                                className={`group-projects-subsection ${mappingHoverKey === 'team' ? 'is-linked-hover' : ''}`}
                                                onMouseEnter={() => setMappingHoverKey('team')}
                                                onMouseLeave={() => setMappingHoverKey(null)}
                                                data-map-key="team"
                                            >
                                                <div className="team-selector-label">Team Field</div>
                                                <div className="group-field-helper">Field used to assign each ticket to a team.</div>
                                                <div className="capacity-inline-row">
                                                    {teamFieldNameDraft ? (
                                                        <div className="selected-team-chip mapping-team-chip" title={teamFieldIdDraft || ''}>
                                                            <span className="team-name"><strong>{teamFieldNameDraft}</strong>{showTechnicalFieldIds && teamFieldIdDraft && <span className="field-id-hint">({teamFieldIdDraft})</span>}</span>
                                                            <button className="remove-btn" onClick={() => { setTeamFieldIdDraft(''); setTeamFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove team field">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input type="text" className="team-search-input" placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'} value={teamFieldSearchQuery} onChange={(e) => { setTeamFieldSearchQuery(e.target.value); setTeamFieldSearchOpen(true); setTeamFieldSearchIndex(0); }} onFocus={() => setTeamFieldSearchOpen(true)} onBlur={() => { window.setTimeout(() => setTeamFieldSearchOpen(false), 120); }} onKeyDown={handleTeamFieldSearchKeyDown} ref={teamFieldSearchInputRef} disabled={loadingFields && !jiraFields.length} />
                                                        {teamFieldSearchOpen && teamFieldSearchResults.length > 0 && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {teamFieldSearchResults.map((f, index) => (
                                                                    <div key={f.id} className={`team-search-result-item ${index === teamFieldSearchIndex ? 'active' : ''}`} onClick={() => { setTeamFieldIdDraft(f.id); setTeamFieldNameDraft(f.name); setTeamFieldSearchQuery(''); setTeamFieldSearchOpen(false); }}>
                                                                        <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                            </div>
                                            </>
                                            )}
                                            {groupManageTab === 'capacity' && (
                                            <div className="group-projects-section group-config-card">
                                                <div className="group-pane-title">Capacity Project</div>
                                                <div className="group-projects-desc">
                                                    Select one Jira project that stores team capacity entries, and the numeric field used for estimated capacity (used by the <strong>Planning</strong> module).
                                                </div>
                                                <div className="capacity-inline-row">
                                                    {capacityProjectDraft ? (
                                                        <div className="selected-team-chip">
                                                            <span className="team-name"><strong>{capacityProjectDraft}</strong>{resolveCapacityProjectName(capacityProjectDraft) ? ` \u2014 ${resolveCapacityProjectName(capacityProjectDraft)}` : ''}</span>
                                                            <button className="remove-btn" onClick={() => setCapacityProjectDraft('')} type="button" title="Remove" aria-label="Remove capacity project">&times;</button>
                                                        </div>
                                                    ) : (
                                                    <div className="team-search-wrapper capacity-inline-search">
                                                        <input
                                                            type="text"
                                                            className="team-search-input"
                                                            placeholder="Search projects..."
                                                            value={capacityProjectSearchQuery}
                                                            onChange={(e) => { setCapacityProjectSearchQuery(e.target.value); setCapacityProjectSearchOpen(true); setCapacityProjectSearchIndex(0); }}
                                                            onFocus={() => setCapacityProjectSearchOpen(true)}
                                                            onBlur={() => { window.setTimeout(() => setCapacityProjectSearchOpen(false), 120); }}
                                                            onKeyDown={handleCapacityProjectSearchKeyDown}
                                                            ref={capacityProjectSearchInputRef}
                                                        />
                                                        {capacityProjectSearchOpen && capacityProjectSearchQuery.trim() && (
                                                            <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                {capacityProjectSearchResults.length === 0 ? (
                                                                    <div className="team-search-result-item is-empty">No projects found</div>
                                                                ) : capacityProjectSearchResults.map((p, index) => (
                                                                    <div
                                                                        key={p.key}
                                                                        className={`team-search-result-item ${index === capacityProjectSearchIndex ? 'active' : ''}`}
                                                                        onClick={() => { setCapacityProjectDraft(p.key); setCapacityProjectSearchQuery(''); setCapacityProjectSearchOpen(false); }}
                                                                    >
                                                                        <strong>{p.key}</strong> &mdash; {p.name}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    )}
                                                </div>
                                                <div className="group-projects-subsection">
                                                    <div className="team-selector-label">Capacity Field</div>
                                                    <div className="group-field-helper">Numeric field that stores each team capacity entry.</div>
                                                    <div className="capacity-inline-row">
                                                        {capacityFieldNameDraft ? (
                                                            <div className="selected-team-chip" title={capacityFieldIdDraft || ''}>
                                                                <span className="team-name"><strong>{capacityFieldNameDraft}</strong>{showTechnicalFieldIds && capacityFieldIdDraft && <span className="field-id-hint">({capacityFieldIdDraft})</span>}</span>
                                                                <button className="remove-btn" onClick={() => { setCapacityFieldIdDraft(''); setCapacityFieldNameDraft(''); }} type="button" title="Remove" aria-label="Remove capacity field">&times;</button>
                                                            </div>
                                                        ) : (
                                                        <div className="team-search-wrapper capacity-inline-search">
                                                            <input
                                                                type="text"
                                                                className="team-search-input"
                                                                placeholder={loadingFields ? 'Loading fields...' : 'Search fields...'}
                                                                value={capacityFieldSearchQuery}
                                                                onChange={(e) => { setCapacityFieldSearchQuery(e.target.value); setCapacityFieldSearchOpen(true); setCapacityFieldSearchIndex(0); }}
                                                                onFocus={() => setCapacityFieldSearchOpen(true)}
                                                                onBlur={() => { window.setTimeout(() => setCapacityFieldSearchOpen(false), 120); }}
                                                                onKeyDown={handleCapacityFieldSearchKeyDown}
                                                                ref={capacityFieldSearchInputRef}
                                                                disabled={loadingFields && !jiraFields.length}
                                                            />
                                                            {capacityFieldSearchOpen && capacityFieldSearchResults.length > 0 && (
                                                                <div className="team-search-results" onMouseDown={(e) => e.preventDefault()}>
                                                                    {capacityFieldSearchResults.map((f, index) => (
                                                                        <div
                                                                            key={f.id}
                                                                            className={`team-search-result-item ${index === capacityFieldSearchIndex ? 'active' : ''}`}
                                                                            onClick={() => { setCapacityFieldIdDraft(f.id); setCapacityFieldNameDraft(f.name); setCapacityFieldSearchQuery(''); setCapacityFieldSearchOpen(false); }}
                                                                        >
                                                                            <strong>{f.name}</strong> <span style={{opacity: 0.5}}>({f.id})</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            )}
                                            {groupManageTab === 'priorityWeights' && (
                                            <div className="group-projects-section group-config-card">
                                                <div className="group-pane-title">Priority Weights</div>
                                                <div className="group-field-helper">
                                                    Used for the weighted delivery metric in Statistics. Source: <strong>{priorityWeightsSource}</strong>.
                                                </div>
                                                <div className="group-field-helper">
                                                    Higher values increase the impact of that priority on weighted completion rate.
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start', marginTop: '0.35rem' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', minWidth: '320px', flex: '0 1 420px' }}>
                                                        {(priorityWeightsDraft || []).map((row) => (
                                                            <div key={row.priority} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 120px', gap: '0.6rem', alignItems: 'center' }}>
                                                                <label className="team-selector-label" style={{ margin: 0 }}>{row.priority}</label>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="team-search-input"
                                                                    value={row.weight}
                                                                    onChange={(e) => updatePriorityWeightDraft(row.priority, e.target.value)}
                                                                    aria-label={`${row.priority} weight`}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div style={{ flex: '1 1 260px', minWidth: '240px', border: '1px solid var(--border)', borderRadius: '12px', background: '#fbfaf7', padding: '0.8rem 0.9rem' }}>
                                                        <div className="team-selector-label" style={{ margin: 0 }}>Weights Sum</div>
                                                        <div style={{ marginTop: '0.35rem', fontFamily: '\'IBM Plex Mono\', monospace', fontSize: '1.1rem', color: '#111827' }}>
                                                            {priorityWeightsSum.toFixed(2)}
                                                        </div>
                                                        <div className="group-field-helper" style={{ marginTop: '0.25rem' }}>
                                                            Recommended target: <strong>1.00</strong>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="group-pane-tools" style={{ marginTop: '0.55rem' }}>
                                                    <button
                                                        type="button"
                                                        className="secondary compact"
                                                        onClick={resetPriorityWeightsDraft}
                                                    >
                                                        Reset to defaults
                                                    </button>
                                                </div>
                                                {priorityWeightsValidationError && (
                                                    <div className="group-test-message error" style={{ marginTop: '0.35rem' }}>
                                                        {priorityWeightsValidationError}
                                                    </div>
                                                )}
                                            </div>
                                            )}
                                        </div>
                                        )}
                                    </div>
                                )}
        </>
    );
}
