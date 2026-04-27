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
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
    if (!selectedEpmProject) return null;

    if (epmRollupTree?.kind === 'metadataOnly') {
        return (
            <div className="group-config-card epm-home-card">
                <div className="group-pane-title">{getEpmProjectDisplayName(selectedEpmProject)}</div>
                <div className="group-pane-subtitle">
                    {selectedEpmProjectUpdateLine || 'No updates yet'}
                </div>
                <a href={selectedEpmProject.homeUrl} target="_blank" rel="noopener noreferrer">Open in Jira Home</a>
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
    }

    if (epmTab === 'active' && !selectedSprint) {
        return (
            <div className="empty-state">
                <h2>Select a sprint</h2>
                <p>Select a sprint to see active work.</p>
            </div>
        );
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
