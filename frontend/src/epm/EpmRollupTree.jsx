import React from 'react';
import { getEpmProjectDisplayName } from './epmProjectUtils.mjs';

export function EpmRollupIssue({ issue, jiraUrl, extraClassName = '' }) {
    const issueHref = jiraUrl ? `${jiraUrl}/browse/${issue.key}` : '#';
    return (
        <div
            key={issue.key}
            className={`task-item ${extraClassName}`.trim()}
            data-task-key={issue.key}
            data-task-id={issue.key}
            data-issue-key={issue.key}
        >
            <div className="task-header">
                <div className="task-headline">
                    <h3 className="task-title">
                        <a href={issueHref} target="_blank" rel="noopener noreferrer">
                            {issue.summary || issue.key}
                        </a>
                    </h3>
                    <span className="task-inline-meta">
                        <a className="task-key-link" href={issueHref} target="_blank" rel="noopener noreferrer">
                            {issue.key}
                        </a>
                        {issue.issueType && (
                            <span className="task-inline-sp">{issue.issueType}</span>
                        )}
                    </span>
                </div>
            </div>
            <div className="task-meta">
                <span className={`task-status ${String(issue.status || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>
                    {issue.status || 'Unknown'}
                </span>
                <span className="task-team">{issue.assignee || 'Unassigned'}</span>
            </div>
        </div>
    );
}

export function EpmEpicNode({ epicNode, jiraUrl }) {
    return (
        <div key={epicNode.issue.key} className="epm-rollup-epic">
            <EpmRollupIssue issue={epicNode.issue} jiraUrl={jiraUrl} extraClassName="epm-rollup-epic-issue" />
            {epicNode.stories.length > 0 && (
                <div className="epm-rollup-children">
                    {epicNode.stories.map(story => (
                        <EpmRollupIssue key={story.key} issue={story} jiraUrl={jiraUrl} extraClassName="epm-rollup-story" />
                    ))}
                </div>
            )}
        </div>
    );
}

export function EpmInitiativeNode({ initiativeNode, jiraUrl, InitiativeIcon }) {
    return (
        <div key={initiativeNode.issue.key} className="initiative-group">
            <div className="initiative-header">
                <InitiativeIcon className="initiative-header-icon" />
                <div className="initiative-label">
                    <span className="initiative-label-name">{initiativeNode.issue.summary || initiativeNode.issue.key}</span>
                    <a
                        className="initiative-label-key"
                        href={jiraUrl ? `${jiraUrl}/browse/${initiativeNode.issue.key}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {initiativeNode.issue.key} ↗
                    </a>
                    <span className="initiative-divider" />
                </div>
            </div>
            <div className="initiative-body">
                {initiativeNode.epics.map(epicNode => (
                    <EpmEpicNode key={epicNode.issue.key} epicNode={epicNode} jiraUrl={jiraUrl} />
                ))}
                {initiativeNode.looseStories.map(story => (
                    <EpmRollupIssue key={story.key} issue={story} jiraUrl={jiraUrl} extraClassName="epm-rollup-story" />
                ))}
            </div>
        </div>
    );
}

export function EpmProjectRemainder({ project, tree, jiraUrl }) {
    if (!tree || (tree.rootEpics.length === 0 && tree.orphanStories.length === 0)) return null;
    return (
        <div className="initiative-group initiative-single">
            <div className="initiative-header">
                <div className="initiative-label initiative-label-only">
                    <span className="initiative-label-name">{getEpmProjectDisplayName(project)}</span>
                    <span className="initiative-label-key">Project</span>
                    <span className="initiative-divider" />
                </div>
            </div>
            <div className="initiative-body">
                {tree.rootEpics.map(epicNode => (
                    <EpmEpicNode key={epicNode.issue.key} epicNode={epicNode} jiraUrl={jiraUrl} />
                ))}
                {tree.orphanStories.length > 0 && (
                    <div className="epm-rollup-orphans">
                        <div className="group-field-helper">Project stories</div>
                        {tree.orphanStories.map(story => (
                            <EpmRollupIssue key={story.key} issue={story} jiraUrl={jiraUrl} extraClassName="epm-rollup-story" />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
