import React from 'react';
import { getEpmProjectDisplayName } from './epmProjectUtils.mjs';
import { EpmInitiativeNode, EpmProjectRemainder } from './EpmRollupTree.jsx';

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
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
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
                {Object.keys(epmDuplicates || {}).length > 0 && (
                    <div className="group-field-helper">
                        {Object.keys(epmDuplicates).length} issues appear in multiple projects - see badges below.
                    </div>
                )}
                {epmAggregateTruncated && (
                    <div className="group-field-helper">
                        This rollup is truncated; narrow the label or Jira scope.
                    </div>
                )}
                {epmRollupBoards.map(({ project, tree }) => (
                    <section className="epm-project-board" key={project?.id || getEpmProjectDisplayName(project)}>
                        <div className="group-pane-title">{getEpmProjectDisplayName(project)}</div>
                        {tree?.kind === 'metadataOnly' && renderMetadataOnlyCard(project, [project?.latestUpdateDate, project?.latestUpdateSnippet || 'No updates yet'].filter(Boolean).join(' · '), false)}
                        {tree?.kind === 'emptyRollup' && (
                            <div className="group-field-helper">No issues in this scope.</div>
                        )}
                        {tree?.kind === 'tree' && (
                            <>
                                {tree.initiatives.map(initiativeNode => (
                                    <EpmInitiativeNode
                                        key={initiativeNode.issue.key}
                                        initiativeNode={initiativeNode}
                                        jiraUrl={jiraUrl}
                                        InitiativeIcon={InitiativeIcon}
                                    />
                                ))}
                                <EpmProjectRemainder project={project} tree={tree} jiraUrl={jiraUrl} />
                            </>
                        )}
                    </section>
                ))}
            </div>
        );
    }

    if (!selectedEpmProject) return null;

    if (epmRollupTree?.kind === 'metadataOnly') {
        return renderMetadataOnlyCard(selectedEpmProject, selectedEpmProjectUpdateLine);
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
            {epmRollupTree.initiatives.map(initiativeNode => (
                <EpmInitiativeNode
                    key={initiativeNode.issue.key}
                    initiativeNode={initiativeNode}
                    jiraUrl={jiraUrl}
                    InitiativeIcon={InitiativeIcon}
                />
            ))}
            <EpmProjectRemainder project={selectedEpmProject} tree={epmRollupTree} jiraUrl={jiraUrl} />
        </div>
    );
}
