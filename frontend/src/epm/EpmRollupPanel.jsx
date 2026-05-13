import React, { useContext } from 'react';
import IssueCard, { IssueCardContext } from '../issues/IssueCard.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import LoadingState from '../ui/LoadingState.jsx';
import StatusPill from '../ui/StatusPill.jsx';
import { buildEpmProjectUpdateLine, getEpmProjectDisplayName, toEpmEngTask } from './epmProjectUtils.mjs';

export function EpmRollupPanel({
    selectedEpmProject,
    selectedEpmProjectUpdateLine,
    epmTab,
    selectedSprint,
    epmRollupLoading,
    epmRollupTree,
    epmRollupBoards,
    epmDuplicates = {},
    epmAggregateTruncated = false,
    epmProjectRollupLoadingIds,
    collapsedProjectIds,
    setCollapsedProjectIds,
    searchQuery = '',
    onProjectExpand,
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
    const issueCardContext = useContext(IssueCardContext);
    const activeCollapsedProjectIds = collapsedProjectIds instanceof Set ? collapsedProjectIds : new Set();

    const getProjectKey = (project) => project?.id || getEpmProjectDisplayName(project) || '';
    const isCollapsed = (project) => activeCollapsedProjectIds.has(getProjectKey(project));
    const toggleCollapsed = (project) => {
        const key = getProjectKey(project);
        const willExpand = activeCollapsedProjectIds.has(key);
        setCollapsedProjectIds((prev) => {
            const next = new Set(prev instanceof Set ? prev : activeCollapsedProjectIds);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
        if (willExpand && onProjectExpand) {
            onProjectExpand(project);
        }
    };

    const renderChevron = () => (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M5.5 3.75L9.75 8l-4.25 4.25" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );

    const renderProjectUpdate = (updateLine) => {
        if (!updateLine?.text) return null;
        return (
            <div className="epm-project-board-update-row" title={updateLine.title || undefined}>
                <article className="epm-project-board-update" aria-label="Latest Home update">
                    {(updateLine.relativeDate || updateLine.author) && (
                        <div className="epm-project-board-update-meta">
                            {updateLine.relativeDate && <span className="epm-project-board-update-date">{updateLine.relativeDate}</span>}
                            {updateLine.author && <span className="epm-project-board-update-author">{updateLine.author}</span>}
                        </div>
                    )}
                    {updateLine.messageHtml ? (
                        <div className="epm-project-board-update-copy" dangerouslySetInnerHTML={{ __html: updateLine.messageHtml }} />
                    ) : (
                        <span className="epm-project-board-update-copy">{updateLine.message || updateLine.text}</span>
                    )}
                </article>
            </div>
        );
    };

    const getProjectIcon = (project) => (
        String(project?.iconEmoji || project?.emoji || '').trim() || '📌'
    );

    const getProjectOwnerName = (project) => (
        String(project?.ownerName || project?.owner?.name || project?.owner?.displayName || '').trim()
    );

    const getProjectOwnerAvatarUrl = (project) => (
        String(project?.ownerAvatarUrl || project?.owner?.avatarUrl || project?.owner?.picture || '').trim()
    );

    const getOwnerInitials = (name) => {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '?';
        return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
    };

    const formatProjectDateValue = (value) => {
        const text = String(value || '').trim();
        if (!text) return '';
        const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!dateMatch) return text;
        const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00`);
        if (Number.isNaN(date.getTime())) return text;
        return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    };

    const formatProjectDateRange = (startValue, endValue) => {
        const startText = String(startValue || '').trim();
        const endText = String(endValue || '').trim();
        if (!startText || !endText) return formatProjectDateValue(startText || endText);
        const start = new Date(`${startText.slice(0, 10)}T00:00:00`);
        const end = new Date(`${endText.slice(0, 10)}T00:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return formatProjectDateValue(endText || startText);
        }
        const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
        const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
        if (startMonth !== endMonth) return `${startMonth}-${endMonth}`;
        return end.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    };

    const getProjectTargetDateLabel = (project) => {
        const target = project?.targetDate;
        const rangeLabel = formatProjectDateRange(project?.targetDateStart, project?.targetDateEnd);
        if (project?.targetDateLabel || rangeLabel) {
            return String(project?.targetDateLabel || rangeLabel).trim();
        }
        if (typeof target === 'object' && target !== null) {
            return String(
                project?.targetDateLabel ||
                target.label ||
                target.text ||
                target.display ||
                target.displayValue ||
                formatProjectDateRange(target.startDate, target.endDate) ||
                formatProjectDateValue(target.value || target.date)
            ).trim();
        }
        return String(project?.targetDateLabel || formatProjectDateValue(target || project?.dueDate)).trim();
    };

    const renderProjectTargetDate = (project) => {
        const label = getProjectTargetDateLabel(project);
        if (!label) return null;
        return (
            <span className="epm-project-board-target-date" title={`Target date: ${label}`}>
                <span className="epm-project-board-target-date-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16">
                        <path d="M4.5 1.75v2.5M11.5 1.75v2.5M2.75 6.25h10.5M3.5 3.25h9a1.5 1.5 0 0 1 1.5 1.5v7.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4.75a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                </span>
                {label}
            </span>
        );
    };

    const renderProjectOwner = (project) => {
        const ownerName = getProjectOwnerName(project);
        const avatarUrl = getProjectOwnerAvatarUrl(project);
        if (!ownerName && !avatarUrl) return null;
        return (
            <span className="epm-project-board-owner" title={ownerName ? `Owner: ${ownerName}` : 'Project owner'}>
                <span className="epm-project-board-owner-avatar" aria-hidden="true">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt="" />
                    ) : (
                        getOwnerInitials(ownerName)
                    )}
                </span>
                {ownerName && <span className="epm-project-board-owner-name">{ownerName}</span>}
            </span>
        );
    };

    const renderPortfolioHeader = (project) => {
        const collapsed = isCollapsed(project);
        const updateLine = buildEpmProjectUpdateLine(project);
        const projectStatus = String(project?.stateLabel || project?.stateValue || '').trim();
        const projectName = getEpmProjectDisplayName(project);
        const projectTargetDate = renderProjectTargetDate(project);
        const projectOwner = renderProjectOwner(project);
        return (
            <>
                <div
                    className={`epm-project-board-header ${collapsed ? 'is-collapsed' : ''}`}
                >
                    <div className="epm-project-board-title-block">
                        <div className="epm-project-board-title-row">
                            <span className="epm-project-board-home-icon" aria-hidden="true">{getProjectIcon(project)}</span>
                            <h3 className="epm-project-board-name">
                                {project?.homeUrl ? (
                                    <a
                                        className="epm-project-board-name-link"
                                        href={project.homeUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {projectName}
                                    </a>
                                ) : (
                                    projectName
                                )}
                            </h3>
                            {projectStatus && (
                                <StatusPill
                                    className={getIssueStatusClassName(projectStatus, 'epm-project-board-status-pill')}
                                    label={projectStatus}
                                    title={`Project status: ${projectStatus}`}
                                    aria-label={`Project status: ${projectStatus}`}
                                />
                            )}
                            {project?.label && (
                                <StatusPill className="epm-project-board-label-pill" label={project.label} />
                            )}
                        </div>
                        {(projectTargetDate || projectOwner) && (
                            <div className="epm-project-board-meta" aria-label="Project metadata">
                                {projectTargetDate}
                                {projectOwner}
                            </div>
                        )}
                    </div>
                </div>
                {renderProjectUpdate(updateLine)}
            </>
        );
    };

    const renderProjectRollupToggle = (project, collapsed) => (
        <div className="epm-project-board-rollup-control">
            <button
                type="button"
                className="epm-project-board-toggle"
                onClick={() => toggleCollapsed(project)}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? 'Show' : 'Hide'} Jira rollup for ${getEpmProjectDisplayName(project)}`}
            >
                <span className="epm-project-board-chevron">{renderChevron()}</span>
                <span className="epm-project-board-toggle-label">Jira rollup</span>
            </button>
        </div>
    );

    const buildDuplicateClusters = () => {
        const projectsById = new Map();
        (epmRollupBoards || []).forEach(({ project }) => {
            if (project?.id) projectsById.set(project.id, project);
        });
        const clusters = new Map();
        Object.entries(epmDuplicates || {}).forEach(([issueKey, projectIds]) => {
            const sorted = (Array.isArray(projectIds) ? projectIds : [])
                .filter(id => id && projectsById.has(id))
                .slice()
                .sort();
            if (sorted.length < 2) return;
            const clusterKey = sorted.join('|');
            if (!clusters.has(clusterKey)) {
                clusters.set(clusterKey, {
                    clusterKey,
                    projects: sorted.map((id) => projectsById.get(id) || { id, name: id }),
                    issues: [],
                });
            }
            clusters.get(clusterKey).issues.push(issueKey);
        });
        return Array.from(clusters.values());
    };

    const renderDuplicatesCallout = () => {
        const clusters = buildDuplicateClusters();
        if (clusters.length === 0) return null;
        return (
            <div className="epm-duplicates-callout" role="region" aria-label="Issues counted in multiple projects">
                <div className="epm-duplicates-heading">
                    <span className="epm-duplicates-heading-text">Issues counted in multiple projects</span>
                    <button
                        type="button"
                        className="secondary compact epm-duplicates-fix-button"
                        onClick={openEpmSettingsTab}
                    >
                        Fix labels in Settings
                    </button>
                </div>
                <p className="epm-duplicates-explanation">
                    These issues match the Jira labels of more than one project, so they appear in each rollup. Tighten the labels in Settings to give each project a unique scope.
                </p>
                <div className="epm-duplicates-rows">
                    {clusters.map((cluster) => (
                        <div className="epm-duplicates-row" key={cluster.clusterKey}>
                            <div className="epm-duplicates-projects">
                                {cluster.projects.map((project) => (
                                    <span className="epm-duplicates-project-chip" key={project.id || getEpmProjectDisplayName(project)}>
                                        <span className="epm-duplicates-project-name">{getEpmProjectDisplayName(project)}</span>
                                        {project.label && (
                                            <StatusPill className="epm-duplicates-project-label" label={project.label} />
                                        )}
                                    </span>
                                ))}
                            </div>
                            <details className="epm-duplicates-issues">
                                <summary>{`${cluster.issues.length} ${cluster.issues.length === 1 ? 'issue' : 'issues'}`}</summary>
                                <ul>
                                    {cluster.issues.map((key) => (
                                        <li key={key}>
                                            <a href={jiraUrl ? `${jiraUrl}/browse/${key}` : '#'} target="_blank" rel="noopener noreferrer">
                                                {key} ↗
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderMetadataOnlyCard = (project, updateLine, showTitle = true) => (
        <div className="group-config-card epm-home-card">
            {showTitle && <div className="group-pane-title">{getEpmProjectDisplayName(project)}</div>}
            <div className="group-pane-subtitle">
                {updateLine || 'No updates yet'}
            </div>
            {project?.homeUrl && (
                <a href={project.homeUrl} target="_blank" rel="noopener noreferrer">Open in Jira Home</a>
            )}
            <div className="group-field-helper">Add a Jira label in Settings {'->'} EPM to pull Jira work into this view.</div>
            <button
                className="secondary compact"
                onClick={openEpmSettingsTab}
                type="button"
            >
                Open Settings
            </button>
        </div>
    );

    const getTaskTeamInfo = issueCardContext?.dependencyContext?.getTeamInfo || ((task) => {
        const team = task.fields?.team;
        const teamName = task.fields?.teamName || team?.name || team?.displayName || team?.teamName || 'Unknown Team';
        const teamId = task.fields?.teamId || team?.id || team?.teamId || team?.key || teamName;
        return { id: teamId, name: teamName };
    });

    const renderEpmIssueCard = (task) => {
        const teamInfo = getTaskTeamInfo(task);
        return (
            <IssueCard
                key={task.key}
                task={task}
                jiraUrl={jiraUrl}
                teamInfo={teamInfo}
                renderPriorityIcon={issueCardContext.renderPriorityIcon || (() => null)}
                allowSelection={issueCardContext.allowSelection}
                isSelected={!!issueCardContext.selectedTasks?.[task.key]}
                onToggleSelection={issueCardContext.onToggleSelection}
                onRemove={issueCardContext.onRemove}
                shouldRenderIssueDependencies={issueCardContext.shouldRenderIssueDependencies}
                dependencyContext={issueCardContext.dependencyContext}
            />
        );
    };

    const renderEpmIssueGroup = ({ key, renderKey, epic, tasks, storyPoints, parentSummary }) => {
        const epicTitle = epic?.summary || parentSummary || (key === 'NO_EPIC' ? 'No Epic Linked' : key);
        const epicTotalSp = storyPoints || 0;
        const epicStatusClassName = epic?.status
            ? getIssueStatusClassName(epic.status, 'epic-status-pill')
            : '';
        return (
            <div key={renderKey || key} className="epic-block">
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
                            {key !== 'NO_EPIC' ? (
                                <a
                                    className="epic-link"
                                    href={jiraUrl ? `${jiraUrl}/browse/${key}` : '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <span className="epic-name">{epicTitle}</span>
                                    <span className="epic-key">{key}</span>
                                </a>
                            ) : (
                                <>
                                    <span className="epic-name">{epicTitle}</span>
                                    <span className="epic-key">Unassigned</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="epic-meta">
                        {epic?.status && (
                            <StatusPill
                                className={epicStatusClassName}
                                label={epic.status}
                            />
                        )}
                        <span>SP: {epicTotalSp.toFixed(1)}</span>
                        {epic?.assignee?.displayName && (
                            <span className="task-assignee epic-assignee">
                                <span className="task-assignee-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none">
                                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" stroke="currentColor" strokeWidth="2" />
                                        <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                </span>
                                <span>{epic.assignee.displayName}</span>
                            </span>
                        )}
                    </div>
                </div>
                {tasks.map(renderEpmIssueCard)}
            </div>
        );
    };

    const renderEpmEpicBlock = (epicNode = {}) => {
        const epicIssue = epicNode.issue || {};
        const tasks = (epicNode.stories || []).map(toEpmEngTask);
        return renderEpmIssueGroup({
            key: epicIssue.key || 'NO_EPIC',
            epic: {
                key: epicIssue.key,
                summary: epicIssue.summary || epicIssue.key || '',
                status: epicIssue.status || '',
                assignee: epicIssue.assignee ? { displayName: epicIssue.assignee } : null,
            },
            tasks,
            storyPoints: tasks.reduce((sum, task) => {
                const value = parseFloat(task.fields.customfield_10004 || 0);
                return Number.isNaN(value) ? sum : sum + value;
            }, 0),
            parentSummary: epicIssue.summary || '',
        });
    };

    const renderStoryOnlyGroup = (stories, key, parentSummary) => {
        if (!Array.isArray(stories) || stories.length === 0) {
            return null;
        }
        const tasks = stories.map(toEpmEngTask);
        return renderEpmIssueGroup({
            key: 'NO_EPIC',
            renderKey: key,
            epic: null,
            tasks,
            storyPoints: tasks.reduce((sum, task) => {
                const value = Number(task.fields?.customfield_10004 || 0);
                return Number.isFinite(value) ? sum + value : sum;
            }, 0),
            parentSummary
        });
    };

    const renderEpmTreeWithIssueCards = (project, tree) => (
        <>
            {tree.initiatives.map(initiativeNode => (
                <div key={initiativeNode.issue.key} className="initiative-group">
                    <div className="initiative-header">
                        <InitiativeIcon className="initiative-header-icon" />
                        <div className="initiative-label">
                            <span className="initiative-label-name">{initiativeNode.issue.summary || initiativeNode.issue.key}</span>
                            <a className="initiative-label-key" href={jiraUrl ? `${jiraUrl}/browse/${initiativeNode.issue.key}` : '#'} target="_blank" rel="noopener noreferrer">
                                {initiativeNode.issue.key} ↗
                            </a>
                            <span className="initiative-divider" />
                        </div>
                    </div>
                    <div className="initiative-body">
                        {initiativeNode.epics.map(epicNode => renderEpmEpicBlock(epicNode))}
                        {renderStoryOnlyGroup(initiativeNode.looseStories, `${initiativeNode.issue.key}-loose`, 'Initiative stories')}
                    </div>
                </div>
            ))}
            {tree.rootEpics.map(epicNode => renderEpmEpicBlock(epicNode))}
            {renderStoryOnlyGroup(tree.orphanStories, `${project?.id || 'project'}-orphan`, 'Project stories')}
        </>
    );

    if (epmTab === 'active' && !selectedSprint) {
        return (
            <div className="empty-state">
                <h2>Select a sprint</h2>
                <p>Select a sprint to see active work.</p>
            </div>
        );
    }

    if (!selectedEpmProject && (Array.isArray(epmRollupBoards) || epmRollupLoading)) {
        if (epmRollupLoading) {
            return (
                <LoadingState
                    title="Loading Jira issues"
                    message="Refreshing all visible EPM project boards."
                />
            );
        }
        return (
            <div
                className={`task-list epm-issue-board epm-portfolio-board ${issueCardContext.dependencyContext?.activeDependencyFocus ? 'focus-mode' : ''}`}
                onClick={issueCardContext.onDependencyFocusClick}
            >
                {renderDuplicatesCallout()}
                {epmAggregateTruncated && (
                    <div className="group-field-helper">
                        This rollup is truncated; narrow the label or Jira scope.
                    </div>
                )}
                {epmRollupBoards.length === 0 && (
                    <div className="empty-state">
                        <h2>No EPM projects found</h2>
                        <p>{searchQuery ? 'No projects match the search.' : 'No projects are available in this EPM tab.'}</p>
                    </div>
                )}
                {epmRollupBoards.map(({ project, tree }) => {
                    const collapsed = isCollapsed(project);
                    const projectKey = getProjectKey(project);
                    const projectLoading = epmProjectRollupLoadingIds?.has?.(projectKey);
                    return (
                        <section
                            className={`epm-project-board ${collapsed ? 'is-collapsed' : ''}`}
                            key={getProjectKey(project)}
                        >
                            {renderPortfolioHeader(project)}
                            {renderProjectRollupToggle(project, collapsed)}
                            <div className="epm-project-board-body">
                                {projectLoading && (
                                    <LoadingState
                                        className="loading-state-inline"
                                        title="Loading Jira issues"
                                        message="Refreshing this project."
                                    />
                                )}
                                {!projectLoading && tree?.kind === 'metadataOnly' && renderMetadataOnlyCard(project, buildEpmProjectUpdateLine(project).text || 'No updates yet', false)}
                                {tree?.kind === 'emptyRollup' && (
                                    <div className="group-field-helper">No issues in this scope.</div>
                                )}
                                {!projectLoading && tree?.kind === 'tree' && renderEpmTreeWithIssueCards(project, tree)}
                            </div>
                        </section>
                    );
                })}
            </div>
        );
    }

    if (!selectedEpmProject) return null;

    if (epmRollupTree?.kind === 'metadataOnly') {
        return renderMetadataOnlyCard(selectedEpmProject, buildEpmProjectUpdateLine(selectedEpmProject).text || selectedEpmProjectUpdateLine);
    }

    if (epmRollupLoading) {
        return (
            <LoadingState
                title="Loading Jira issues"
                message="Refreshing the selected EPM project board."
            />
        );
    }

    if (epmRollupTree?.kind === 'emptyRollup') {
        return (
            <div className="empty-state">
                <h2>No Jira work found</h2>
                <p>No issues match this label in the current scope.</p>
            </div>
        );
    }

    if (epmRollupTree?.kind !== 'tree') return null;

    return (
        <div
            className={`task-list epm-issue-board ${issueCardContext.dependencyContext?.activeDependencyFocus ? 'focus-mode' : ''}`}
            onClick={issueCardContext.onDependencyFocusClick}
        >
            {epmRollupTree.truncated && (
                <div className="group-field-helper">
                    This rollup is truncated; narrow the label or Jira scope.
                </div>
            )}
            {renderEpmTreeWithIssueCards(selectedEpmProject, epmRollupTree)}
        </div>
    );
}
