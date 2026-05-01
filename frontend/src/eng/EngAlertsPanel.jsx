import * as React from 'react';

export default function EngAlertsPanel({
    selectedView,
    alertItemCount,
    showAlertsPanel,
    setShowAlertsPanel,
    collapsed,
    alertProps = {},
}) {
    const {
        analysisEpicTeams,
        backlogEpicTeams,
        backlogEpics,
        blockedAlertTeams,
        blockedTasks,
        buildKeyListLink,
        buildTeamStatusLink,
        consolidatedMissingStories,
        dismissAlertItem,
        doneEpicTeams,
        doneStoryEpics,
        emptyEpicTeams,
        emptyEpics,
        emptyEpicsForAlert,
        futureRoutedEpics,
        getBlockedAlertStatusLabel,
        getFuturePlanningNeedsStoriesReasonText,
        handleAlertStoryClick,
        isFutureSprintSelected,
        jiraUrl,
        missingAlertTeams,
        missingLabelEpicTeams,
        missingLabelEpics,
        missingTeamEpicTeams,
        missingTeamEpics,
        needsStoriesEntries,
        needsStoriesTeams,
        postponedAlertTeams,
        postponedEpicTeams,
        postponedTasks,
        setShowBacklogAlert,
        setShowBlockedAlert,
        setShowDoneEpicAlert,
        setShowEmptyEpicAlert,
        setShowMissingAlert,
        setShowMissingLabelsAlert,
        setShowMissingTeamAlert,
        setShowNeedsStoriesAlert,
        setShowPostponedAlert,
        setShowWaitingAlert,
        showBacklogAlert,
        showBlockedAlert,
        showDoneEpicAlert,
        showEmptyEpicAlert,
        showMissingAlert,
        showMissingLabelsAlert,
        showMissingTeamAlert,
        showNeedsStoriesAlert,
        showPostponedAlert,
        showWaitingAlert,
        waitingForStoriesEpics,
    } = alertProps;

    if (selectedView !== 'eng' || alertItemCount <= 0) {
        return null;
    }

    return (
        <div className="alerts-panel-shell">
            <div className="alerts-panel-toolbar">
                <button
                    className="alerts-panel-toggle"
                    onClick={() => setShowAlertsPanel(prev => !prev)}
                    title={showAlertsPanel ? 'Hide the alerts section' : 'Show the alerts section'}
                    type="button"
                >
                    <span className="alerts-panel-toggle-icon" aria-hidden="true">
                        <svg className={`alerts-panel-toggle-chevron ${showAlertsPanel ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </span>
                    <span className="alerts-panel-toggle-label">
                        {showAlertsPanel ? 'Hide Alerts' : 'Show Alerts'}
                    </span>
                </button>
            </div>
            {showAlertsPanel && (
                <div className={`alert-panels ${collapsed ? 'collapsed' : ''}`}>
		                                    {consolidatedMissingStories.length > 0 && (
		                                        <div className={`alert-card missing ${showMissingAlert ? '' : 'collapsed'}`}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowMissingAlert(prev => !prev)}
	                                                    title={showMissingAlert ? 'Collapse missing info panel' : 'Expand missing info panel'}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showMissingAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                    <span className="alert-toggle-label">
	                                                        {showMissingAlert ? 'Hide' : 'Show'}
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">🧾 Missing Info</div>
	                                                <div className="alert-subtitle">These stories are missing planning essentials—fill the fields so they can be scheduled and estimated.</div>
		                                                <a
		                                                    className="alert-chip"
		                                                    href={buildKeyListLink(consolidatedMissingStories.map(item => item.task.key))}
		                                                    target="_blank"
		                                                    rel="noopener noreferrer"
		                                                    title="Open these stories in Jira"
		                                                >
		                                                    {consolidatedMissingStories.length} {consolidatedMissingStories.length === 1 ? 'story' : 'stories'}
		                                                </a>
		                                            </div>
                                            <div className={`alert-card-body ${showMissingAlert ? '' : 'collapsed'}`}>
                                                    {missingAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.task.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} not ready</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} not ready</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(({ task, missingFields }) => (
                                                                        <div key={task.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(task.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }}
                                                                                >
                                                                                    {task.key} · {task.fields.summary}
                                                                                </a>
                                                                            </div>
                                                                            <span className="alert-pill status">Missing: {missingFields.join(', ')}</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Fix fields →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(task.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
	                                        </div>
	                                    )}

	                                    {blockedTasks.length > 0 && (
	                                        <div className={`alert-card blocked ${showBlockedAlert ? '' : 'collapsed'}`}>
                                            <div className="alert-card-header">
                                                <button
                                                    className="alert-toggle"
                                                    onClick={() => setShowBlockedAlert(prev => !prev)}
                                                    title={showBlockedAlert ? 'Collapse blocked panel' : 'Expand blocked panel'}
                                                >
                                                    <span className="alert-toggle-icon" aria-hidden="true">
                                                        <svg className={`alert-toggle-chevron ${showBlockedAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    </span>
                                                    <span className="alert-toggle-label">
                                                        {showBlockedAlert ? 'Hide' : 'Show'}
                                                    </span>
                                                </button>
                                                <div className="alert-title">⛔️ Blocked</div>
                                                <div className="alert-subtitle">Let’s unblock these fast—call out what’s stuck, who’s needed, and what “done” looks like.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(blockedTasks.map(t => t.key), { addSprint: true })}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title="Open blocked stories in Jira"
	                                                >
	                                                    {blockedTasks.length} blocked
	                                                </a>
	                                            </div>
                                            <div className={`alert-card-body ${showBlockedAlert ? '' : 'collapsed'}`}>
                                                    {blockedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} blocked</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'} blocked</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(task => {
                                                                        return (
                                                                            <div key={task.key} className="alert-story alert-story-jump">
                                                                                <div
                                                                                    className="alert-story-main"
                                                                                    role="button"
                                                                                    tabIndex={0}
                                                                                    onClick={() => handleAlertStoryClick(task.key)}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                                                            event.preventDefault();
                                                                                            handleAlertStoryClick(task.key);
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <a
                                                                                        className="alert-story-link"
                                                                                        href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        onClick={(event) => {
                                                                                            event.preventDefault();
                                                                                            event.stopPropagation();
                                                                                            handleAlertStoryClick(task.key);
                                                                                        }}
                                                                                    >
                                                                                        {task.key} · {task.fields.summary}
                                                                                    </a>
                                                                                </div>
                                                                                <button
                                                                                    className="task-remove alert-remove"
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        dismissAlertItem(task.key);
                                                                                    }}
                                                                                    title="Dismiss from alerts"
                                                                                    type="button"
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
	                                        </div>
	                                    )}

                                        {(postponedTasks.length > 0 || futureRoutedEpics.length > 0) && (
                                            <div className={`alert-card following ${showPostponedAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button
                                                        className="alert-toggle"
                                                        onClick={() => setShowPostponedAlert(prev => !prev)}
                                                        title={showPostponedAlert ? 'Collapse postponed stories panel' : 'Expand postponed stories panel'}
                                                    >
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showPostponedAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">
                                                            {showPostponedAlert ? 'Hide' : 'Show'}
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">⏭️ Postponed Work</div>
                                                    <div className="alert-subtitle">Items that should be handled in a future sprint.</div>
                                                    <div className="alert-chip">
                                                        {postponedTasks.length + futureRoutedEpics.length} {(postponedTasks.length + futureRoutedEpics.length) === 1 ? 'item' : 'items'}
                                                    </div>
                                                </div>
                                                <div className={`alert-card-body ${showPostponedAlert ? '' : 'collapsed'}`}>
                                                    {postponedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'}</span>
                                                                </a>
                                                            ) : (
                                                                <div className="alert-team-title">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    <span>{group.items.length} {group.items.length === 1 ? 'story' : 'stories'}</span>
                                                                </div>
                                                            )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(task => (
                                                                        <div key={task.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(task.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(task.key);
                                                                                    }}
                                                                                >
                                                                                    {task.key} · {task.fields.summary}
                                                                                </a>
                                                                            </div>
                                                                            <span className="alert-pill status">Postponed</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Move to next sprint →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(task.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            );
                                                        })}
                                                    {futureRoutedEpics.length > 0 && (
                                                        <>
                                                            <div className="alert-section-title">Epics with only future-sprint stories</div>
                                                            {postponedEpicTeams.map(group => (
                                                                <div key={`future-epic-${group.id}`} className="alert-team-group">
                                                                    <div className="alert-team-header">
                                                                        {jiraUrl ? (
                                                                            <a
                                                                                className="alert-team-link"
                                                                                href={buildTeamStatusLink({
                                                                                    teamId: group.id !== 'unknown' ? group.id : undefined,
                                                                                    issueType: 'Epic',
                                                                                    statuses: ['Accepted', 'To Do', 'Pending']
                                                                                })}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                <span className="alert-pill team">{group.name}</span>
                                                                                <span>{group.items.length} epics</span>
                                                                            </a>
                                                                        ) : (
                                                                            <div className="alert-team-title">
                                                                                <span className="alert-pill team">{group.name}</span>
                                                                                <span>{group.items.length} epics</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="alert-stories">
                                                                        {group.items.map(epic => (
                                                                            <div key={epic.key} className="alert-story">
                                                                                <div className="alert-story-main" onClick={() => handleAlertStoryClick(epic.key)}>
                                                                                    {jiraUrl ? (
                                                                                        <a
                                                                                            className="alert-story-link"
                                                                                            href={`${jiraUrl}/browse/${epic.key}`}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            onClick={(event) => event.stopPropagation()}
                                                                                        >
                                                                                            {epic.key}: {epic.summary}
                                                                                        </a>
                                                                                    ) : (
                                                                                        <div className="alert-story-link">{epic.key}: {epic.summary}</div>
                                                                                    )}
                                                                                    <div className="alert-story-note">Move epic sprint to a future sprint (not in current scope).</div>
                                                                                </div>
                                                                                <span className="alert-pill status">Move to future sprint</span>
                                                                                <button
                                                                                    className="task-remove alert-remove"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        dismissAlertItem(epic.key);
                                                                                    }}
                                                                                    title="Dismiss from alerts"
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {backlogEpics.length > 0 && (
                                            <div className={`alert-card following ${showBacklogAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowBacklogAlert(prev => !prev)} title={showBacklogAlert ? 'Collapse backlog panel' : 'Expand backlog panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showBacklogAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">{showBacklogAlert ? 'Hide' : 'Show'}</span>
                                                    </button>
                                                    <div className="alert-title">📥 Backlog</div>
                                                    <div className="alert-subtitle">These epics are still backlog work. Keep child stories unsprinted unless they are already closed out.</div>
                                                    {buildKeyListLink(backlogEpics.map(e => e.key)) ? (
                                                        <a
                                                            className="alert-chip"
                                                            href={buildKeyListLink(backlogEpics.map(e => e.key))}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="Open these backlog epics in Jira"
                                                        >
                                                            {backlogEpics.length} {backlogEpics.length === 1 ? 'epic' : 'epics'}
                                                        </a>
                                                    ) : (
                                                        <div className="alert-chip">{backlogEpics.length} {backlogEpics.length === 1 ? 'epic' : 'epics'}</div>
                                                    )}
                                                </div>
                                                <div className={`alert-card-body ${showBacklogAlert ? '' : 'collapsed'}`}>
                                                    {backlogEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={`backlog-${group.id}`} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a className="alert-team-link" href={teamLink} target="_blank" rel="noopener noreferrer">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => handleAlertStoryClick(epic.key)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleAlertStoryClick(epic.key); }}>
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                                <div className="alert-story-note">
                                                                                    {epic.cleanupStoryCount > 0 ? `${epic.cleanupStoryCount} child stor${epic.cleanupStoryCount === 1 ? 'y is' : 'ies are'} still sprinted.` : 'No sprinted child stories to clean up.'}
                                                                                </div>
                                                                            </div>
                                                                            <a className="alert-action" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer">Clean backlog stories →</a>
                                                                            <button className="task-remove alert-remove" onClick={(event) => { event.stopPropagation(); dismissAlertItem(epic.key); }} title="Dismiss from alerts" type="button">×</button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {missingTeamEpics.length > 0 && (
                                            <div className={`alert-card following ${showMissingTeamAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowMissingTeamAlert(prev => !prev)} title={showMissingTeamAlert ? 'Collapse missing team panel' : 'Expand missing team panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showMissingTeamAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">{showMissingTeamAlert ? 'Hide' : 'Show'}</span>
                                                    </button>
                                                    <div className="alert-title">👥 Missing Team</div>
                                                    <div className="alert-subtitle">Open epics that still need a Jira Team before planning labels can be evaluated.</div>
                                                    <div className="alert-chip">{missingTeamEpics.length} {missingTeamEpics.length === 1 ? 'epic' : 'epics'}</div>
                                                </div>
                                                <div className={`alert-card-body ${showMissingTeamAlert ? '' : 'collapsed'}`}>
                                                    {missingTeamEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={`missing-team-${group.id}`} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a className="alert-team-link" href={teamLink} target="_blank" rel="noopener noreferrer">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => handleAlertStoryClick(epic.key)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleAlertStoryClick(epic.key); }}>{epic.key} · {epic.summary}</a>
                                                                                <div className="alert-story-note">Add the Jira Team field before planning labels can be applied.</div>
                                                                            </div>
                                                                            <button className="task-remove alert-remove" onClick={(event) => { event.stopPropagation(); dismissAlertItem(epic.key); }} title="Dismiss from alerts" type="button">×</button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {missingLabelEpics.length > 0 && (
                                            <div className={`alert-card following ${showMissingLabelsAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowMissingLabelsAlert(prev => !prev)} title={showMissingLabelsAlert ? 'Collapse missing labels panel' : 'Expand missing labels panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showMissingLabelsAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">{showMissingLabelsAlert ? 'Hide' : 'Show'}</span>
                                                    </button>
                                                    <div className="alert-title">🏷️ Missing Labels</div>
                                                    <div className="alert-subtitle">These epics need both the selected sprint label and the mapped team label.</div>
                                                    <div className="alert-chip">{missingLabelEpics.length} {missingLabelEpics.length === 1 ? 'epic' : 'epics'}</div>
                                                </div>
                                                <div className={`alert-card-body ${showMissingLabelsAlert ? '' : 'collapsed'}`}>
                                                    {missingLabelEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={`missing-labels-${group.id}`} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a className="alert-team-link" href={teamLink} target="_blank" rel="noopener noreferrer">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => handleAlertStoryClick(epic.key)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleAlertStoryClick(epic.key); }}>{epic.key} · {epic.summary}</a>
                                                                                <div className="alert-story-note">Add the selected sprint label and the mapped team label on the epic.</div>
                                                                            </div>
                                                                            <button className="task-remove alert-remove" onClick={(event) => { event.stopPropagation(); dismissAlertItem(epic.key); }} title="Dismiss from alerts" type="button">×</button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {isFutureSprintSelected && needsStoriesEntries.length > 0 && (
                                            <div className={`alert-card following ${showNeedsStoriesAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowNeedsStoriesAlert(prev => !prev)} title={showNeedsStoriesAlert ? 'Collapse needs stories panel' : 'Expand needs stories panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showNeedsStoriesAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">{showNeedsStoriesAlert ? 'Hide' : 'Show'}</span>
                                                    </button>
                                                    <div className="alert-title">📝 Needs Stories</div>
                                                    <div className="alert-subtitle">These epics are labeled correctly but still are not sprint-ready for the selected future sprint.</div>
                                                    <div className="alert-chip">{needsStoriesEntries.length} {needsStoriesEntries.length === 1 ? 'epic' : 'epics'}</div>
                                                </div>
                                                <div className={`alert-card-body ${showNeedsStoriesAlert ? '' : 'collapsed'}`}>
                                                    {needsStoriesTeams.map(group => {
                                                        const keys = group.items.map(item => item.epic.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={`needs-stories-${group.id}`} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a className="alert-team-link" href={teamLink} target="_blank" rel="noopener noreferrer">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(entry => {
                                                                        const epic = entry.epic;
                                                                        return (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => handleAlertStoryClick(epic.key)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleAlertStoryClick(epic.key); }}>{epic.key} · {epic.summary}</a>
                                                                                <div className="alert-story-note">{getFuturePlanningNeedsStoriesReasonText(entry.reason)}</div>
                                                                            </div>
                                                                            <a className="alert-action" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer">Open epic →</a>
                                                                            <button className="task-remove alert-remove" onClick={(event) => { event.stopPropagation(); dismissAlertItem(epic.key); }} title="Dismiss from alerts" type="button">×</button>
                                                                        </div>
                                                                    )})}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {!isFutureSprintSelected && waitingForStoriesEpics.length > 0 && (
                                            <div className={`alert-card following ${showWaitingAlert ? '' : 'collapsed'}`}>
                                                <div className="alert-card-header">
                                                    <button
                                                        className="alert-toggle"
                                                        onClick={() => setShowWaitingAlert(prev => !prev)}
                                                        title={showWaitingAlert ? 'Collapse waiting for stories panel' : 'Expand waiting for stories panel'}
                                                    >
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showWaitingAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                        <span className="alert-toggle-label">
                                                            {showWaitingAlert ? 'Hide' : 'Show'}
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">⏳ Waiting for Stories</div>
                                                    <div className="alert-subtitle">Analysis epics are waiting for stories next quarter.</div>
                                                    <div className="alert-chip">
                                                        {waitingForStoriesEpics.length} {waitingForStoriesEpics.length === 1 ? 'item' : 'items'}
                                                    </div>
                                                </div>
                                                <div className={`alert-card-body ${showWaitingAlert ? '' : 'collapsed'}`}>
                                                    {analysisEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(epic.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }}
                                                                                >
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                                <div className="alert-story-note">Waiting for description to create stories.</div>
                                                                            </div>
                                                                            <span className="alert-pill status">{epic.status?.name || 'Waiting'}</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Open epic →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(epic.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

		                                    {emptyEpicsForAlert.length > 0 && (
		                                        <div className={`alert-card empty-epic ${showEmptyEpicAlert ? '' : 'collapsed'}`}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowEmptyEpicAlert(prev => !prev)}
	                                                    title={showEmptyEpicAlert ? 'Collapse empty epic panel' : 'Expand empty epic panel'}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showEmptyEpicAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                    <span className="alert-toggle-label">
	                                                        {showEmptyEpicAlert ? 'Hide' : 'Show'}
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">🧺 Empty Epic</div>
	                                                <div className="alert-subtitle">These epics have zero stories—please review and create at least one story to make them actionable.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(emptyEpics.map(e => e.key))}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title="Open these epics in Jira"
	                                                >
                                                        {emptyEpicsForAlert.length} {emptyEpicsForAlert.length === 1 ? 'epic' : 'epics'}
                                                    </a>
                                                </div>
                                            <div className={`alert-card-body ${showEmptyEpicAlert ? '' : 'collapsed'}`}>
                                                    {emptyEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(epic.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }}
                                                                                >
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                            </div>
                                                                            {epic.status?.name && (
                                                                                <span className="alert-pill status">{epic.status.name}</span>
                                                                            )}
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Create story →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(epic.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
		                                        </div>
		                                    )}

		                                    {doneStoryEpics.length > 0 && (
		                                        <div className={`alert-card done-epic ${showDoneEpicAlert ? '' : 'collapsed'}`}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowDoneEpicAlert(prev => !prev)}
	                                                    title={showDoneEpicAlert ? 'Collapse ready-to-close epics panel' : 'Expand ready-to-close epics panel'}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showDoneEpicAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                    <span className="alert-toggle-label">
	                                                        {showDoneEpicAlert ? 'Hide' : 'Show'}
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">✅ Epic Ready to Close</div>
	                                                <div className="alert-subtitle">All stories are done, killed, or incomplete, but the epic is still open—time to close the loop.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(doneStoryEpics.map(e => e.key))}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title="Open these epics in Jira"
	                                                >
	                                                    {doneStoryEpics.length} {doneStoryEpics.length === 1 ? 'epic' : 'epics'}
	                                                </a>
	                                            </div>
                                            <div className={`alert-card-body ${showDoneEpicAlert ? '' : 'collapsed'}`}>
                                                    {doneEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
                                                                <div className="alert-team-header">
                                                                    {teamLink ? (
                                                                        <a
                                                                            className="alert-team-link"
                                                                            href={teamLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </a>
                                                                    ) : (
                                                                        <div className="alert-team-title">
                                                                            <span className="alert-pill team">{group.name}</span>
                                                                            <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => handleAlertStoryClick(epic.key)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        handleAlertStoryClick(epic.key);
                                                                                    }}
                                                                                >
                                                                                    {epic.key} · {epic.summary}
                                                                                </a>
                                                                            </div>
                                                                            {epic.assignee?.displayName && (
                                                                                <span className="alert-pill status">{epic.assignee.displayName}</span>
                                                                            )}
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                            >
                                                                                Close epic →
                                                                            </a>
                                                                            <button
                                                                                className="task-remove alert-remove"
                                                                                onClick={(event) => {
                                                                                    event.stopPropagation();
                                                                                    dismissAlertItem(epic.key);
                                                                                }}
                                                                                title="Dismiss from alerts"
                                                                                type="button"
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
		                                        </div>
		                                    )}


                </div>
            )}
        </div>
    );
}
