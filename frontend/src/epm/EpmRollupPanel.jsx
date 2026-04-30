import React, { useState } from 'react';
import { buildEpmEngEpicGroup, buildEpmProjectUpdateLine, getEpmProjectDisplayName, toEpmEngTask } from './epmProjectUtils.mjs';

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
    renderEpicBlock,
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
    const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => new Set());

    const getProjectKey = (project) => project?.id || getEpmProjectDisplayName(project) || '';
    const isCollapsed = (project) => collapsedProjectIds.has(getProjectKey(project));
    const toggleCollapsed = (project) => {
        const key = getProjectKey(project);
        setCollapsedProjectIds((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const renderProjectIcon = () => (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" fill="none"/>
            <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6"/>
        </svg>
    );

    const renderChevron = () => (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );

    const renderProjectUpdate = (updateLine) => {
        if (!updateLine?.text) return null;
        return (
            <div className="epm-project-board-update-row" title={updateLine.title || undefined}>
                <div className="epm-project-board-update">
                    {updateLine.messageHtml ? (
                        <div className="epm-project-board-update-copy" dangerouslySetInnerHTML={{ __html: updateLine.messageHtml }} />
                    ) : (
                        <span className="epm-project-board-update-copy">{updateLine.message || updateLine.text}</span>
                    )}
                </div>
                {updateLine.relativeDate && <span className="epm-project-board-update-date">{updateLine.relativeDate}</span>}
            </div>
        );
    };

    const renderPortfolioHeader = (project) => {
        const collapsed = isCollapsed(project);
        const updateLine = buildEpmProjectUpdateLine(project);
        return (
            <>
                <div
                    className={`epm-project-board-header ${collapsed ? 'is-collapsed' : ''}`}
                >
                    <button
                        type="button"
                        className="epm-project-board-toggle"
                        onClick={() => toggleCollapsed(project)}
                        aria-expanded={!collapsed}
                    >
                        <span className="epm-project-board-chevron">{renderChevron()}</span>
                        <span className="epm-project-board-icon">{renderProjectIcon()}</span>
                        <span className="epm-project-board-name">{getEpmProjectDisplayName(project)}</span>
                    </button>
                    <div className="epm-project-board-meta">
                        {project?.label && (
                            <span className="epm-project-board-label-pill">{project.label}</span>
                        )}
                        {project?.homeUrl && (
                            <a
                                className="epm-project-board-link"
                                href={project.homeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Home ↗
                            </a>
                        )}
                    </div>
                </div>
                {renderProjectUpdate(updateLine)}
            </>
        );
    };

    const buildDuplicateClusters = () => {
        const projectsById = new Map();
        (epmRollupBoards || []).forEach(({ project }) => {
            if (project?.id) projectsById.set(project.id, project);
        });
        const clusters = new Map();
        Object.entries(epmDuplicates || {}).forEach(([issueKey, projectIds]) => {
            const sorted = (Array.isArray(projectIds) ? projectIds : []).filter(Boolean).slice().sort();
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
                                            <span className="epm-duplicates-project-label">{project.label}</span>
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

    const renderStoryOnlyGroup = (stories, key, parentSummary) => {
        if (!Array.isArray(stories) || stories.length === 0) {
            return null;
        }
        const tasks = stories.map(toEpmEngTask);
        return (
            <React.Fragment key={key}>
                {renderEpicBlock({
                    key: 'NO_EPIC',
                    epic: null,
                    tasks,
                    storyPoints: tasks.reduce((sum, task) => {
                        const value = Number(task.fields?.customfield_10004 || 0);
                        return Number.isFinite(value) ? sum + value : sum;
                    }, 0),
                    parentSummary
                })}
            </React.Fragment>
        );
    };

    const renderEpmTreeWithEngCards = (project, tree) => (
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
                        {initiativeNode.epics.map(epicNode => renderEpicBlock(buildEpmEngEpicGroup(epicNode)))}
                        {renderStoryOnlyGroup(initiativeNode.looseStories, `${initiativeNode.issue.key}-loose`, 'Initiative stories')}
                    </div>
                </div>
            ))}
            {tree.rootEpics.map(epicNode => renderEpicBlock(buildEpmEngEpicGroup(epicNode)))}
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
                <div className="empty-state">
                    <h2>Loading Jira issues</h2>
                    <p>Refreshing all visible EPM project boards.</p>
                </div>
            );
        }
        return (
            <div className="task-list epm-issue-board epm-portfolio-board">
                {renderDuplicatesCallout()}
                {epmAggregateTruncated && (
                    <div className="group-field-helper">
                        This rollup is truncated; narrow the label or Jira scope.
                    </div>
                )}
                {epmRollupBoards.map(({ project, tree }) => {
                    const collapsed = isCollapsed(project);
                    return (
                        <section
                            className={`epm-project-board ${collapsed ? 'is-collapsed' : ''}`}
                            key={getProjectKey(project)}
                        >
                            {renderPortfolioHeader(project)}
                            <div className="epm-project-board-body">
                                {tree?.kind === 'metadataOnly' && renderMetadataOnlyCard(project, buildEpmProjectUpdateLine(project).text || 'No updates yet', false)}
                                {tree?.kind === 'emptyRollup' && (
                                    <div className="group-field-helper">No issues in this scope.</div>
                                )}
                                {tree?.kind === 'tree' && renderEpmTreeWithEngCards(project, tree)}
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
            <div className="empty-state">
                <h2>Loading Jira issues</h2>
                <p>Refreshing the selected EPM project board.</p>
            </div>
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
        <div className="task-list epm-issue-board">
            {epmRollupTree.truncated && (
                <div className="group-field-helper">
                    This rollup is truncated; narrow the label or Jira scope.
                </div>
            )}
            {renderEpmTreeWithEngCards(selectedEpmProject, epmRollupTree)}
        </div>
    );
}
