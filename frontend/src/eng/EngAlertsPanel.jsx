import * as React from 'react';
import { ALERT_CATEGORY_STYLE } from './alertPin.js';
import { isCombinedWorkModel, lowerEntityWord, resolveEntityNames } from './engWorkModel.js';

// The summary pills in panel order; `label` is the category name (also the pin note), `one` its singular for a count of 1.
const alertSummaryConfig = names => [
    { key: 'missing', label: 'Missing info', tone: 'missing', sectionId: 'eng-alert-missing' },
    { key: 'blocked', label: 'Blocked', tone: 'blocked', sectionId: 'eng-alert-blocked' },
    { key: 'followup', label: 'Postponed', tone: 'following', sectionId: 'eng-alert-followup' },
    { key: 'backlog', label: 'Backlog', tone: 'following', sectionId: 'eng-alert-backlog' },
    { key: 'missingTeam', label: 'Missing team', tone: 'following', sectionId: 'eng-alert-missing-team' },
    { key: 'missingLabels', label: 'Missing labels', tone: 'following', sectionId: 'eng-alert-missing-labels' },
    { key: 'needsStories', label: `${names.childPlural} required`, one: `${names.child} required`, tone: 'following', sectionId: 'eng-alert-needs-stories' },
    { key: 'waiting', label: 'Waiting', tone: 'following', sectionId: 'eng-alert-waiting' },
    { key: 'empty', label: `Empty ${lowerEntityWord(names.parent)}`, tone: 'empty', sectionId: 'eng-alert-empty' },
    { key: 'done', label: 'Ready to close', tone: 'done', sectionId: 'eng-alert-done' },
];

// Parent-hygiene panels the combined (rnd_2027) model retires: an Initiative legitimately has no Sprint, optional Initiative Team is
// not a defect and quarter labels are not required. Unsprinted Epics stay in the Backlog view.
const RETIRED_COMBINED_SECTIONS = new Set(['eng-alert-backlog', 'eng-alert-missing-team', 'eng-alert-missing-labels']);

export default function EngAlertsPanel({
    workModel,
    entityNames = null,
    selectedView,
    alertItemCount,
    alertCounts = {},
    alertScopeTooLarge = false,
    showAlertsPanel,
    setShowAlertsPanel,
    collapsed,
    alertProps = {},
    renderAlertShareControl,
}) {
    const {
        analysisEpicTeams,
        backlogEpicTeams,
        backlogEpics,
        blockedAlertTeams,
        blockedTasks,
        buildKeyListLink,
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
        handleStoryRequirementClick,
        dismissStoryRequirement,
        isFutureSprintSelected,
        storyReadinessSprintState,
        jiraUrl,
        missingAlertTeams,
        missingLabelEpicTeams,
        missingLabelEpics,
        missingTeamEpicTeams,
        missingTeamEpics,
        needsStoriesEntries,
        needsStoriesEpics,
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

    const focusAlertSection = React.useCallback((sectionId) => {
        if (!sectionId || typeof window === 'undefined' || typeof document === 'undefined') {
            return;
        }
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                const target = document.getElementById(sectionId);
                if (!target) return;
                target.scrollIntoView({ block: 'start', behavior: 'smooth' });
                target.focus({ preventScroll: true });
            });
        });
    }, []);

    const handleAlertSummaryClick = React.useCallback((item) => {
        setShowAlertsPanel(true);
        if (item.setExpanded) {
            item.setExpanded(true);
        }
        focusAlertSection(item.sectionId);
    }, [focusAlertSection, setShowAlertsPanel]);

    // Pins the alert the user is acting on; a static snapshot (the category label as the note), never a live status.
    const names = entityNames || resolveEntityNames(workModel);
    const summaryConfig = alertSummaryConfig(names);
    const pinFor = (sectionId, key, title, { kind = 'issue', identity = key } = {}) => {
        const note = summaryConfig.find(item => item.sectionId === sectionId)?.label;
        alertProps.pinAlert?.({ kind, identity, sectionId, key, title, note });
    };
    const openAlertStory = (sectionId, key, title, ...args) => {
        pinFor(sectionId, key, title);
        handleAlertStoryClick(key, ...args);
    };

    const combined = isCombinedWorkModel(workModel);
    const [parentWord, parentWords, childWord, childWords] = [names.parent, names.parentPlural, names.child, names.childPlural].map(lowerEntityWord);
    const parentCount = count => `${count} ${count === 1 ? parentWord : parentWords}`;
    const retired = (sectionId) => combined && RETIRED_COMBINED_SECTIONS.has(sectionId);
    if (selectedView !== 'eng' || (alertItemCount <= 0 && !alertScopeTooLarge)) {
        return null;
    }

    const alertScopeNotice = alertScopeTooLarge ? (
        <div className="story-readiness-notice" role="status">
            <span>This Department is too large for {names.parent} alerts: more than 2,000 open {names.parentPlural} match its Teams and labels in Product or Tech. {names.parent} alerts are hidden; {names.child} alerts are still shown. Narrow the Department's Teams or labels.</span>
        </div>
    ) : null;

    if (alertItemCount <= 0) {
        return <div className="alerts-panel-shell">{alertScopeNotice}</div>;
    }

    const alertSummaryActions = {
        missing: { setExpanded: setShowMissingAlert, isExpanded: showMissingAlert },
        blocked: { setExpanded: setShowBlockedAlert, isExpanded: showBlockedAlert },
        followup: { setExpanded: setShowPostponedAlert, isExpanded: showPostponedAlert },
        backlog: { setExpanded: setShowBacklogAlert, isExpanded: showBacklogAlert },
        missingTeam: { setExpanded: setShowMissingTeamAlert, isExpanded: showMissingTeamAlert },
        missingLabels: { setExpanded: setShowMissingLabelsAlert, isExpanded: showMissingLabelsAlert },
        needsStories: { setExpanded: setShowNeedsStoriesAlert, isExpanded: showNeedsStoriesAlert },
        waiting: { setExpanded: setShowWaitingAlert, isExpanded: showWaitingAlert },
        empty: { setExpanded: setShowEmptyEpicAlert, isExpanded: showEmptyEpicAlert },
        done: { setExpanded: setShowDoneEpicAlert, isExpanded: showDoneEpicAlert },
    };

    // The group's count text is its copy-link control when the group can be named in a link, plain text otherwise.
    const renderTeamCount = (anchor, group, text) => renderAlertShareControl?.(anchor, group, text) || <span>{text}</span>;

    // A category chip opens exactly the issues listed under it in Jira; without a Jira link builder it is plain text.
    const renderCategoryChip = (keys, text, title) => {
        const href = buildKeyListLink(keys);
        return href
            ? <a className="alert-chip" href={href} target="_blank" rel="noopener noreferrer" title={title}>{text}</a>
            : <div className="alert-chip">{text}</div>;
    };

    const alertSummaryItems = summaryConfig
        .filter(item => !retired(item.sectionId))
        .map(item => ({ ...item, ...alertSummaryActions[item.key], count: Number(alertCounts[item.key] || 0) }))
        .filter(item => item.count > 0)
        .map(item => ({ ...item, label: item.count === 1 && item.one ? item.one : item.label }));

    return (
        <div className="alerts-panel-shell">
            {alertScopeNotice}
            <div className="alerts-panel-toolbar">
                <button
                    className="alerts-panel-toggle"
                    onClick={() => setShowAlertsPanel(prev => !prev)}
                    title={showAlertsPanel ? 'Hide the alerts section' : 'Show the alerts section'}
                    type="button"
                    aria-expanded={showAlertsPanel}
                    aria-controls="eng-alert-panels"
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
                <div className="alerts-panel-summary" aria-live="polite" aria-label={`${alertItemCount} total alerts`}>
                    <span className="alerts-panel-summary-pill total">
                        {alertItemCount} total
                    </span>
                    {alertSummaryItems.map(item => (
                        <button
                            key={item.key}
                            className={`alerts-panel-summary-pill ${item.tone}`}
                            type="button"
                            aria-controls={item.sectionId}
                            aria-expanded={Boolean(showAlertsPanel && item.isExpanded)}
                            aria-label={`Open ${item.count} ${item.label} ${item.count === 1 ? 'alert' : 'alerts'}`}
                            onClick={() => handleAlertSummaryClick(item)}
                        >
                            <span className="alerts-panel-summary-count">{item.count}</span>
                            <span> {item.label}</span>
                        </button>
                    ))}
                </div>
            </div>
            {showAlertsPanel && (
                <div className={`alert-panels ${collapsed ? 'collapsed' : ''}`} id="eng-alert-panels">
		                                    {consolidatedMissingStories.length > 0 && (
		                                        <div className={`alert-card missing ${showMissingAlert ? '' : 'collapsed'}`} id="eng-alert-missing" tabIndex={-1}>
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
	                                                </button>
	                                                <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-missing'].icon} Missing Info</div>
	                                                <div className="alert-subtitle">These {childWords} are missing planning essentials—fill the fields so they can be scheduled and estimated.</div>
		                                                <a
		                                                    className="alert-chip"
		                                                    href={buildKeyListLink(consolidatedMissingStories.map(item => item.task.key))}
		                                                    target="_blank"
		                                                    rel="noopener noreferrer"
		                                                    title={`Open these ${childWords} in Jira`}
		                                                >
		                                                    {consolidatedMissingStories.length} {consolidatedMissingStories.length === 1 ? childWord : childWords}
		                                                </a>
		                                            </div>
                                            <div className={`alert-card-body ${showMissingAlert ? '' : 'collapsed'}`}>
                                                    {missingAlertTeams.map(group => {
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('missing', group, `${group.items.length} ${group.items.length === 1 ? childWord : childWords} not ready`)}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(({ task, missingFields }) => {
                                                                        const editStoryPoints = missingFields.includes('Story Points');
                                                                        const navigateToStory = () => openAlertStory('eng-alert-missing', task.key, task.fields.summary, editStoryPoints);
                                                                        return <div key={task.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={navigateToStory}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        navigateToStory();
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <a
                                                                                    className="alert-story-link"
                                                                                    href={`#story-${encodeURIComponent(task.key)}`}
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        navigateToStory();
                                                                                    }}
                                                                                >
                                                                                    <span className="epic-key">{task.key}</span>{' '}{task.fields.summary}
                                                                                </a>
                                                                            </div>
                                                                            <span className="alert-pill status">Missing: {missingFields.join(', ')}</span>
                                                                            {editStoryPoints ? (
                                                                                <a className="alert-action" href={`#story-${encodeURIComponent(task.key)}`} onClick={(event) => { event.preventDefault(); navigateToStory(); }}>Fix fields →</a>
                                                                            ) : (
                                                                                <a className="alert-action" href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={() => pinFor('eng-alert-missing', task.key, task.fields.summary)}>Fix fields →</a>
                                                                            )}
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
                                                                        </div>;
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
	                                        </div>
	                                    )}

	                                    {blockedTasks.length > 0 && (
	                                        <div className={`alert-card blocked ${showBlockedAlert ? '' : 'collapsed'}`} id="eng-alert-blocked" tabIndex={-1}>
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
                                                </button>
                                                <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-blocked'].icon} Blocked</div>
                                                <div className="alert-subtitle">Let’s unblock these fast—call out what’s stuck, who’s needed, and what “done” looks like.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(blockedTasks.map(t => t.key), { addSprint: true })}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title={`Open blocked ${childWords} in Jira`}
	                                                >
	                                                    {blockedTasks.length} blocked
	                                                </a>
	                                            </div>
                                            <div className={`alert-card-body ${showBlockedAlert ? '' : 'collapsed'}`}>
                                                    {blockedAlertTeams.map(group => {
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('blocked', group, `${group.items.length} ${group.items.length === 1 ? childWord : childWords} blocked`)}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(task => {
                                                                        return (
                                                                            <div key={task.key} className="alert-story alert-story-jump">
                                                                                <div
                                                                                    className="alert-story-main"
                                                                                    role="button"
                                                                                    tabIndex={0}
                                                                                    onClick={() => openAlertStory('eng-alert-blocked', task.key, task.fields.summary)}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                                                            event.preventDefault();
                                                                                            openAlertStory('eng-alert-blocked', task.key, task.fields.summary);
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
                                                                                            openAlertStory('eng-alert-blocked', task.key, task.fields.summary);
                                                                                        }}
                                                                                    >
                                                                                        <span className="epic-key">{task.key}</span>{' '}{task.fields.summary}
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
                                            <div className={`alert-card following ${showPostponedAlert ? '' : 'collapsed'}`} id="eng-alert-followup" tabIndex={-1}>
                                                <div className="alert-card-header">
                                                    <button
                                                        className="alert-toggle"
                                                        onClick={() => setShowPostponedAlert(prev => !prev)}
                                                        title={`${showPostponedAlert ? 'Collapse' : 'Expand'} postponed ${childWords} panel`}
                                                    >
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showPostponedAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-followup'].icon} Postponed Work</div>
                                                    <div className="alert-subtitle">Items that should be handled in a future sprint.</div>
                                                    {renderCategoryChip([...postponedTasks.map(task => task.key), ...futureRoutedEpics.map(epic => epic.key)], `${postponedTasks.length + futureRoutedEpics.length} ${(postponedTasks.length + futureRoutedEpics.length) === 1 ? 'item' : 'items'}`, 'Open these postponed items in Jira')}
                                                </div>
                                                <div className={`alert-card-body ${showPostponedAlert ? '' : 'collapsed'}`}>
                                                    {postponedAlertTeams.map(group => {
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('followup', group, `${group.items.length} ${group.items.length === 1 ? childWord : childWords}`)}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(task => (
                                                                        <div key={task.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => openAlertStory('eng-alert-followup', task.key, task.fields.summary)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        openAlertStory('eng-alert-followup', task.key, task.fields.summary);
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
                                                                                        openAlertStory('eng-alert-followup', task.key, task.fields.summary);
                                                                                    }}
                                                                                >
                                                                                    <span className="epic-key">{task.key}</span>{' '}{task.fields.summary}
                                                                                </a>
                                                                            </div>
                                                                            <span className="alert-pill status">Postponed</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                onClick={() => pinFor('eng-alert-followup', task.key, task.fields.summary)}
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
                                                            <div className="alert-section-title">{names.parentPlural} with only future-sprint {childWords}</div>
                                                            {postponedEpicTeams.map(group => (
                                                                <div key={`future-epic-${group.id}`} className="alert-team-group" data-alert-team={group.id} data-alert-kind="epic">
                                                                    <div className="alert-team-header">
                                                                        <span className="alert-pill team">{group.name}</span>
                                                                        {renderTeamCount('followupEpics', group, parentCount(group.items.length))}
                                                                    </div>
                                                                    <div className="alert-stories">
                                                                        {group.items.map(epic => (
                                                                            <div key={epic.key} className="alert-story">
                                                                                <div className="alert-story-main" onClick={() => openAlertStory('eng-alert-followup', epic.key, epic.summary)}>
                                                                                    {jiraUrl ? (
                                                                                        <a
                                                                                            className="alert-story-link"
                                                                                            href={`${jiraUrl}/browse/${epic.key}`}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            onClick={(event) => { pinFor('eng-alert-followup', epic.key, epic.summary); event.stopPropagation(); }}
                                                                                        >
                                                                                            <span className="epic-key">{epic.key}</span>{' '}{epic.summary}
                                                                                        </a>
                                                                                    ) : (
                                                                                        <div className="alert-story-link"><span className="epic-key">{epic.key}</span>{' '}{epic.summary}</div>
                                                                                    )}
                                                                                </div>
                                                                                <div className="alert-story-note">Move {parentWord} sprint to a future sprint (not in current scope).</div>
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

                                        {!retired('eng-alert-backlog') && backlogEpics.length > 0 && (
                                            <div className={`alert-card following ${showBacklogAlert ? '' : 'collapsed'}`} id="eng-alert-backlog" tabIndex={-1}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowBacklogAlert(prev => !prev)} title={showBacklogAlert ? 'Collapse backlog panel' : 'Expand backlog panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showBacklogAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-backlog'].icon} Backlog</div>
                                                    <div className="alert-subtitle">These {parentWords} are still backlog work. Keep child {childWords} unsprinted unless they are already closed out.</div>
                                                    {buildKeyListLink(backlogEpics.map(e => e.key)) ? (
                                                        <a
                                                            className="alert-chip"
                                                            href={buildKeyListLink(backlogEpics.map(e => e.key))}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title={`Open these backlog ${parentWords} in Jira`}
                                                        >
                                                            {parentCount(backlogEpics.length)}
                                                        </a>
                                                    ) : (
                                                        <div className="alert-chip">{parentCount(backlogEpics.length)}</div>
                                                    )}
                                                </div>
                                                <div className={`alert-card-body ${showBacklogAlert ? '' : 'collapsed'}`}>
                                                    {backlogEpicTeams.map(group => {
                                                        return (
                                                            <div key={`backlog-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('backlog', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => openAlertStory('eng-alert-backlog', epic.key, epic.summary)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openAlertStory('eng-alert-backlog', epic.key, epic.summary); }}>
                                                                                    <span className="epic-key">{epic.key}</span>{' '}{epic.summary}
                                                                                </a>
                                                                            </div>
                                                                            <div className="alert-story-note">
                                                                                    {epic.cleanupStoryCount > 0 ? `${epic.cleanupStoryCount} child ${epic.cleanupStoryCount === 1 ? `${childWord} is` : `${childWords} are`} still sprinted.` : `No sprinted child ${childWords} to clean up.`}
                                                                                </div>
                                                                            <a className="alert-action" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={() => pinFor('eng-alert-backlog', epic.key, epic.summary)}>Clean backlog {childWords} →</a>
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

                                        {!retired('eng-alert-missing-team') && missingTeamEpics.length > 0 && (
                                            <div className={`alert-card following ${showMissingTeamAlert ? '' : 'collapsed'}`} id="eng-alert-missing-team" tabIndex={-1}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowMissingTeamAlert(prev => !prev)} title={showMissingTeamAlert ? 'Collapse missing team panel' : 'Expand missing team panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showMissingTeamAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-missing-team'].icon} Missing Team</div>
                                                    <div className="alert-subtitle">Open {parentWords} that still need a Jira Team before planning labels can be evaluated.</div>
                                                    {renderCategoryChip(missingTeamEpics.map(epic => epic.key), parentCount(missingTeamEpics.length), `Open these ${parentWords} in Jira`)}
                                                </div>
                                                <div className={`alert-card-body ${showMissingTeamAlert ? '' : 'collapsed'}`}>
                                                    {missingTeamEpicTeams.map(group => {
                                                        return (
                                                            <div key={`missing-team-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('missingTeam', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => openAlertStory('eng-alert-missing-team', epic.key, epic.summary)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openAlertStory('eng-alert-missing-team', epic.key, epic.summary); }}><span className="epic-key">{epic.key}</span>{' '}{epic.summary}</a>
                                                                            </div>
                                                                            <div className="alert-story-note">Add the Jira Team field before planning labels can be applied.</div>
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

                                        {!retired('eng-alert-missing-labels') && missingLabelEpics.length > 0 && (
                                            <div className={`alert-card following ${showMissingLabelsAlert ? '' : 'collapsed'}`} id="eng-alert-missing-labels" tabIndex={-1}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowMissingLabelsAlert(prev => !prev)} title={showMissingLabelsAlert ? 'Collapse missing labels panel' : 'Expand missing labels panel'}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showMissingLabelsAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-missing-labels'].icon} Missing Labels</div>
                                                    <div className="alert-subtitle">These {parentWords} need the selected sprint label or its _candidate form, plus the mapped team label.</div>
                                                    {renderCategoryChip(missingLabelEpics.map(epic => epic.key), parentCount(missingLabelEpics.length), `Open these ${parentWords} in Jira`)}
                                                </div>
                                                <div className={`alert-card-body ${showMissingLabelsAlert ? '' : 'collapsed'}`}>
                                                    {missingLabelEpicTeams.map(group => {
                                                        return (
                                                            <div key={`missing-labels-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('missingLabels', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div className="alert-story-main" role="button" tabIndex={0} onClick={() => openAlertStory('eng-alert-missing-labels', epic.key, epic.summary)}>
                                                                                <a className="alert-story-link" href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openAlertStory('eng-alert-missing-labels', epic.key, epic.summary); }}><span className="epic-key">{epic.key}</span>{' '}{epic.summary}</a>
                                                                            </div>
                                                                            <div className="alert-story-note">Add the selected sprint label or its _candidate form, plus the mapped team label on the {parentWord}.</div>
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

                                        {needsStoriesEntries.length > 0 && (
                                            <div className={`alert-card ${storyReadinessSprintState === 'active' ? 'blocked' : 'following'} ${showNeedsStoriesAlert ? '' : 'collapsed'}`} id="eng-alert-needs-stories" tabIndex={-1}>
                                                <div className="alert-card-header">
                                                    <button className="alert-toggle" onClick={() => setShowNeedsStoriesAlert(prev => !prev)} title={`${showNeedsStoriesAlert ? 'Collapse' : 'Expand'} ${names.childPlural} Required panel`}>
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showNeedsStoriesAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-needs-stories'].icon} {names.childPlural} Required</div>
                                                    <div className="alert-subtitle">These labeled {names.parentPlural} still need an actionable {names.child} for the selected sprint and Team.</div>
                                                    {renderCategoryChip(needsStoriesTeams.flatMap(group => group.items.map(entry => entry.epic.key)), parentCount(needsStoriesEpics.length), `Open these ${parentWords} in Jira`)}
                                                </div>
                                                <div className={`alert-card-body ${showNeedsStoriesAlert ? '' : 'collapsed'}`}>
                                                    {needsStoriesTeams.map(group => {
                                                        return (
                                                            <div key={`needs-stories-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('needsStories', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(entry => {
                                                                        const epic = entry.epic;
                                                                        return (
                                                                        <div key={entry.id} className="alert-story">
                                                                            <div className="alert-story-main">
                                                                                <button className="alert-story-link alert-story-local-link" type="button" onClick={() => { pinFor('eng-alert-needs-stories', epic.key, epic.summary, { kind: 'requirement', identity: entry.id }); handleStoryRequirementClick(entry); }}><span className="epic-key">{epic.key}</span>{' '}{epic.summary}</button>
                                                                            </div>
                                                                            <div className="alert-story-note">{getFuturePlanningNeedsStoriesReasonText(entry.reason, names)}</div>
                                                                            <button className="task-remove alert-remove" onClick={(event) => { event.stopPropagation(); dismissStoryRequirement(entry); }} title={`Dismiss this ${names.child} requirement from alerts`} type="button">×</button>
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
                                            <div className={`alert-card following ${showWaitingAlert ? '' : 'collapsed'}`} id="eng-alert-waiting" tabIndex={-1}>
                                                <div className="alert-card-header">
                                                    <button
                                                        className="alert-toggle"
                                                        onClick={() => setShowWaitingAlert(prev => !prev)}
                                                        title={`${showWaitingAlert ? 'Collapse' : 'Expand'} waiting for ${childWords} panel`}
                                                    >
                                                        <span className="alert-toggle-icon" aria-hidden="true">
                                                            <svg className={`alert-toggle-chevron ${showWaitingAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
                                                                <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            </svg>
                                                        </span>
                                                    </button>
                                                    <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-waiting'].icon} Waiting for {names.childPlural}</div>
                                                    <div className="alert-subtitle">Analysis {parentWords} are waiting for {childWords} next quarter.</div>
                                                    {renderCategoryChip(waitingForStoriesEpics.map(epic => epic.key), `${waitingForStoriesEpics.length} ${waitingForStoriesEpics.length === 1 ? 'item' : 'items'}`, `Open these ${parentWords} in Jira`)}
                                                </div>
                                                <div className={`alert-card-body ${showWaitingAlert ? '' : 'collapsed'}`}>
                                                    {analysisEpicTeams.map(group => {
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('waiting', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => openAlertStory('eng-alert-waiting', epic.key, epic.summary)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        openAlertStory('eng-alert-waiting', epic.key, epic.summary);
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
                                                                                        openAlertStory('eng-alert-waiting', epic.key, epic.summary);
                                                                                    }}
                                                                                >
                                                                                    <span className="epic-key">{epic.key}</span>{' '}{epic.summary}
                                                                                </a>
                                                                            </div>
                                                                            <div className="alert-story-note">Waiting for description to create {childWords}.</div>
                                                                            <span className="alert-pill status">{epic.status?.name || 'Waiting'}</span>
                                                                            <a
                                                                                className="alert-action"
                                                                                href={jiraUrl ? `${jiraUrl}/browse/${epic.key}` : '#'}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                onClick={() => pinFor('eng-alert-waiting', epic.key, epic.summary)}
                                                                            >
                                                                                Open {parentWord} →
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
		                                        <div className={`alert-card empty-epic ${showEmptyEpicAlert ? '' : 'collapsed'}`} id="eng-alert-empty" tabIndex={-1}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowEmptyEpicAlert(prev => !prev)}
	                                                    title={`${showEmptyEpicAlert ? 'Collapse' : 'Expand'} empty ${parentWord} panel`}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showEmptyEpicAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-empty'].icon} Empty {names.parent}</div>
	                                                <div className="alert-subtitle">These {parentWords} have zero {childWords}—please review and create at least one {childWord} to make them actionable.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(emptyEpics.map(e => e.key))}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title={`Open these ${parentWords} in Jira`}
	                                                >
                                                        {parentCount(emptyEpicsForAlert.length)}
                                                    </a>
                                                </div>
                                            <div className={`alert-card-body ${showEmptyEpicAlert ? '' : 'collapsed'}`}>
                                                    {emptyEpicTeams.map(group => {
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('empty', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => openAlertStory('eng-alert-empty', epic.key, epic.summary)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        openAlertStory('eng-alert-empty', epic.key, epic.summary);
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
                                                                                        openAlertStory('eng-alert-empty', epic.key, epic.summary);
                                                                                    }}
                                                                                >
                                                                                    <span className="epic-key">{epic.key}</span>{' '}{epic.summary}
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
                                                                                onClick={() => pinFor('eng-alert-empty', epic.key, epic.summary)}
                                                                            >
                                                                                Create {childWord} →
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
		                                        <div className={`alert-card done-epic ${showDoneEpicAlert ? '' : 'collapsed'}`} id="eng-alert-done" tabIndex={-1}>
	                                            <div className="alert-card-header">
	                                                <button
	                                                    className="alert-toggle"
	                                                    onClick={() => setShowDoneEpicAlert(prev => !prev)}
	                                                    title={`${showDoneEpicAlert ? 'Collapse' : 'Expand'} ready-to-close ${parentWords} panel`}
	                                                >
	                                                    <span className="alert-toggle-icon" aria-hidden="true">
	                                                        <svg className={`alert-toggle-chevron ${showDoneEpicAlert ? '' : 'collapsed'}`} viewBox="0 0 12 12">
	                                                            <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	                                                        </svg>
	                                                    </span>
	                                                </button>
	                                                <div className="alert-title">{ALERT_CATEGORY_STYLE['eng-alert-done'].icon} {names.parent} Ready to Close</div>
	                                                <div className="alert-subtitle">All {childWords} are done, killed, or incomplete, but the {parentWord} is still open—time to close the loop.</div>
	                                                <a
	                                                    className="alert-chip"
	                                                    href={buildKeyListLink(doneStoryEpics.map(e => e.key))}
	                                                    target="_blank"
	                                                    rel="noopener noreferrer"
	                                                    title={`Open these ${parentWords} in Jira`}
	                                                >
	                                                    {parentCount(doneStoryEpics.length)}
	                                                </a>
	                                            </div>
                                            <div className={`alert-card-body ${showDoneEpicAlert ? '' : 'collapsed'}`}>
                                                    {doneEpicTeams.map(group => {
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
                                                                <div className="alert-team-header">
                                                                    <span className="alert-pill team">{group.name}</span>
                                                                    {renderTeamCount('done', group, parentCount(group.items.length))}
                                                                </div>
                                                                <div className="alert-stories">
                                                                    {group.items.map(epic => (
                                                                        <div key={epic.key} className="alert-story">
                                                                            <div
                                                                                className="alert-story-main"
                                                                                role="button"
                                                                                tabIndex={0}
                                                                                onClick={() => openAlertStory('eng-alert-done', epic.key, epic.summary)}
                                                                                onKeyDown={(event) => {
                                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                                        event.preventDefault();
                                                                                        openAlertStory('eng-alert-done', epic.key, epic.summary);
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
                                                                                        openAlertStory('eng-alert-done', epic.key, epic.summary);
                                                                                    }}
                                                                                >
                                                                                    <span className="epic-key">{epic.key}</span>{' '}{epic.summary}
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
                                                                                onClick={() => pinFor('eng-alert-done', epic.key, epic.summary)}
                                                                            >
                                                                                Close {parentWord} →
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
