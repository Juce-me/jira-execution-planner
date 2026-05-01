import * as React from 'react';
import { normalizeIssueStatus } from './issueViewUtils.js';

function getBlockLinkBuckets(entries, taskKey) {
    const blockedBy = [];
    const blocks = [];
    (entries || []).forEach(dep => {
        if (!dep?.key || !taskKey) return;
        const otherKey = dep.key !== taskKey
            ? dep.key
            : (dep.prereqKey === taskKey ? dep.dependentKey : dep.prereqKey);
        if (!otherKey) return;
        if (dep.dependentKey === taskKey) {
            blockedBy.push(otherKey);
            return;
        }
        if (dep.prereqKey === taskKey) {
            blocks.push(otherKey);
            return;
        }
        if (dep.direction === 'inward') {
            blockedBy.push(otherKey);
            return;
        }
        if (dep.direction === 'outward') {
            blocks.push(otherKey);
        }
    });
    return {
        blockedBy: Array.from(new Set(blockedBy)),
        blocks: Array.from(new Set(blocks))
    };
}

function uniqueDependencyEntries(entries) {
    const seen = new Set();
    return (entries || []).filter(dep => {
        const key = `${dep.key}-${dep.direction}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildMissingLine({ key, lookup, info, normalizeStatus }) {
    const status = lookup?.status || info.status || 'Unknown';
    const summary = lookup?.summary || info.summary || 'Unknown summary';
    const teamName = lookup?.teamName || info.teamName || 'Unknown team';
    const assignee = lookup?.assignee || info.assignee || 'Unassigned';
    const isDone = normalizeStatus(status) === 'done';
    return { key, status, summary, teamName, assignee, isDone };
}

export function buildIssueDependencyViewModel({
    task,
    shouldRender = false,
    entries = [],
    dependencyFocus = null,
    dependencyHover = null,
    activeDependencyFocus = null,
    focusRelatedSet = new Set(),
    issueByKey = new Map(),
    visibleTaskKeySet = new Set(),
    dependencyLookupCache = {},
    normalizeStatus = normalizeIssueStatus,
    getTeamInfo,
}) {
    const empty = {
        shouldRender,
        hasDependencyLinks: false,
        hasDeps: false,
        dependsOnIds: [],
        dependentIds: [],
        blockedByIds: [],
        blocksIds: [],
        isDependsActive: false,
        isDependentsActive: false,
        isBlockedByActive: false,
        isBlocksActive: false,
        isFocusActive: false,
        isRelated: true,
        isFocused: false,
        isUpstream: false,
        isDownstream: false,
        missingLines: [],
        hiddenLines: [],
    };
    if (!task?.key || !shouldRender) return empty;

    const rawDeps = (entries || []).filter(dep => dep.key && dep.category === 'dependency');
    const rawBlockDeps = (entries || []).filter(dep => dep.key && dep.category === 'block');
    const uniqueDeps = uniqueDependencyEntries(rawDeps);
    const dependsOnAll = uniqueDeps.filter(dep => dep.direction === 'outward');
    const dependentsAll = uniqueDeps.filter(dep => dep.direction === 'inward');
    const dependsOnIds = dependsOnAll.map(dep => dep.key).filter(Boolean);
    const dependentIds = dependentsAll.map(dep => dep.key).filter(Boolean);
    const { blockedBy: blockedByIds, blocks: blocksIds } = getBlockLinkBuckets(rawBlockDeps, task.key);
    const hasBlockLinks = blockedByIds.length > 0 || blocksIds.length > 0;
    const hasDependencyLinks = dependsOnIds.length > 0 || dependentIds.length > 0;
    const hasDeps = hasDependencyLinks || hasBlockLinks;

    const isDependsFocusActive = dependencyFocus &&
        dependencyFocus.taskKey === task.key &&
        dependencyFocus.action === 'depends-on';
    const isDependentsFocusActive = dependencyFocus &&
        dependencyFocus.taskKey === task.key &&
        dependencyFocus.action === 'dependents';
    const isBlockedByFocusActive = dependencyFocus &&
        dependencyFocus.taskKey === task.key &&
        dependencyFocus.action === 'blocked-by';
    const isBlocksFocusActive = dependencyFocus &&
        dependencyFocus.taskKey === task.key &&
        dependencyFocus.action === 'blocks';
    const isDependsHoverActive = dependencyHover &&
        dependencyHover.taskKey === task.key &&
        dependencyHover.action === 'depends-on';
    const isDependentsHoverActive = dependencyHover &&
        dependencyHover.taskKey === task.key &&
        dependencyHover.action === 'dependents';
    const isBlockedByHoverActive = dependencyHover &&
        dependencyHover.taskKey === task.key &&
        dependencyHover.action === 'blocked-by';
    const isBlocksHoverActive = dependencyHover &&
        dependencyHover.taskKey === task.key &&
        dependencyHover.action === 'blocks';
    const isFocusActive = !!activeDependencyFocus;
    const isRelated = !isFocusActive || focusRelatedSet.has(task.key);
    const isFocused = isFocusActive && activeDependencyFocus.taskKey === task.key;
    const isUpstream = isFocusActive &&
        (activeDependencyFocus.action === 'depends-on' || activeDependencyFocus.action === 'blocked-by') &&
        !isFocused &&
        focusRelatedSet.has(task.key);
    const isDownstream = isFocusActive &&
        (activeDependencyFocus.action === 'dependents' || activeDependencyFocus.action === 'blocks') &&
        !isFocused &&
        focusRelatedSet.has(task.key);

    const missingKeys = isFocused ? (dependencyFocus?.missingKeys || []) : [];
    const dependencyKeyList = dependencyFocus?.dependencyKeys
        || (dependencyFocus?.relatedKeys || []).filter(key => key !== task.key);
    const hiddenKeys = isFocused
        ? dependencyKeyList.filter(key => issueByKey.has(key) && !visibleTaskKeySet.has(key))
        : [];
    const missingInfoByKey = {};
    uniqueDeps.forEach(dep => {
        if (dep.key) {
            missingInfoByKey[dep.key] = dep;
        }
    });
    const missingLines = missingKeys.map(key => buildMissingLine({
        key,
        lookup: dependencyLookupCache[key],
        info: missingInfoByKey[key] || {},
        normalizeStatus,
    }));
    const hiddenLines = hiddenKeys.map(key => {
        const lookup = issueByKey.get(key);
        const info = missingInfoByKey[key] || {};
        const status = lookup?.fields?.status?.name || lookup?.status?.name || lookup?.status || info.status || 'Unknown';
        const summary = lookup?.fields?.summary || lookup?.summary || info.summary || 'Unknown summary';
        const teamName = lookup?.fields && getTeamInfo
            ? getTeamInfo(lookup).name
            : (lookup?.teamName || info.teamName || 'Unknown team');
        const assignee = lookup?.fields?.assignee?.displayName || lookup?.assignee?.displayName || info.assignee || 'Unassigned';
        const isDone = normalizeStatus(status) === 'done';
        return { key, status, summary, teamName, assignee, isDone };
    });

    return {
        shouldRender,
        hasDependencyLinks,
        hasDeps,
        dependsOnIds,
        dependentIds,
        blockedByIds,
        blocksIds,
        isDependsActive: !!(isDependsFocusActive || isDependsHoverActive),
        isDependentsActive: !!(isDependentsFocusActive || isDependentsHoverActive),
        isBlockedByActive: !!(isBlockedByFocusActive || isBlockedByHoverActive),
        isBlocksActive: !!(isBlocksFocusActive || isBlocksHoverActive),
        isFocusActive,
        isRelated,
        isFocused,
        isUpstream,
        isDownstream,
        missingLines,
        hiddenLines,
    };
}

function MissingIssueLine({ item, jiraUrl }) {
    const content = (
        <>
            <span>{item.teamName}</span>
            <span className="dependency-missing-sep">&middot;</span>
            <span>{item.assignee}</span>
            <span className="dependency-missing-sep">&middot;</span>
            <span>{item.summary}</span>
            <span className="dependency-missing-sep">&middot;</span>
            <span>{item.key}</span>
            <span className="dependency-missing-sep">&middot;</span>
            <span className={`dependency-missing-status ${item.isDone ? 'done' : ''}`}>{item.status}</span>
        </>
    );
    if (!jiraUrl) {
        return <div className="dependency-missing-item" key={`missing-${item.key}`}>{content}</div>;
    }
    return (
        <a
            className="dependency-missing-item"
            key={`missing-${item.key}`}
            href={`${jiraUrl}/browse/${item.key}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${item.key} in Jira`}
        >
            {content}
        </a>
    );
}

export default function IssueDependencies({
    task,
    jiraUrl,
    model,
    placement,
    dependencyLookupLoading = false,
    onHoverEnter = () => {},
    onHoverLeave = () => {},
}) {
    if (!model?.shouldRender) return null;

    if (placement === 'header') {
        if (!model.hasDependencyLinks) return null;
        return (
            <div className="dependency-pill-stack">
                {model.dependsOnIds.length > 0 && (
                    <span className="dependency-pill blocked">&larr; BLOCKED BY</span>
                )}
                {model.dependentIds.length > 0 && (
                    <span className="dependency-pill blocker">BLOCKS &rarr;</span>
                )}
            </div>
        );
    }

    if (placement !== 'details') return null;

    return (
        <>
            {model.hasDeps && (
                <div className="dependency-strip">
                    {model.blockedByIds.length > 0 && (
                        <button
                            type="button"
                            className={`dependency-count ${model.isBlockedByActive ? 'active' : ''}`}
                            data-dep-chip="blocked-by"
                            data-task-id={task.id || task.key}
                            data-task-key={task.key}
                            aria-label={`Blocked by ${model.blockedByIds.length} tasks`}
                            onMouseEnter={() => onHoverEnter(task.key, 'blocked-by')}
                            onMouseLeave={() => onHoverLeave(task.key, 'blocked-by')}
                        >
                            BLOCKED BY {model.blockedByIds.length}
                        </button>
                    )}
                    {model.blocksIds.length > 0 && (
                        <button
                            type="button"
                            className={`dependency-count ${model.isBlocksActive ? 'active' : ''}`}
                            data-dep-chip="blocks"
                            data-task-id={task.id || task.key}
                            data-task-key={task.key}
                            aria-label={`Blocks ${model.blocksIds.length} tasks`}
                            onMouseEnter={() => onHoverEnter(task.key, 'blocks')}
                            onMouseLeave={() => onHoverLeave(task.key, 'blocks')}
                        >
                            BLOCKS {model.blocksIds.length}
                        </button>
                    )}
                    {model.dependsOnIds.length > 0 && (
                        <button
                            type="button"
                            className={`dependency-count ${model.isDependsActive ? 'active' : ''}`}
                            data-dep-chip="depends-on"
                            data-task-id={task.id || task.key}
                            data-task-key={task.key}
                            aria-label={`Depends on ${model.dependsOnIds.length} tasks`}
                            onMouseEnter={() => onHoverEnter(task.key, 'depends-on')}
                            onMouseLeave={() => onHoverLeave(task.key, 'depends-on')}
                        >
                            DEPENDS ON {model.dependsOnIds.length}
                        </button>
                    )}
                    {model.dependentIds.length > 0 && (
                        <button
                            type="button"
                            className={`dependency-count ${model.isDependentsActive ? 'active' : ''}`}
                            data-dep-chip="dependents"
                            data-task-id={task.id || task.key}
                            data-task-key={task.key}
                            aria-label={`Dependents ${model.dependentIds.length} tasks`}
                            onMouseEnter={() => onHoverEnter(task.key, 'dependents')}
                            onMouseLeave={() => onHoverLeave(task.key, 'dependents')}
                        >
                            DEPENDENTS {model.dependentIds.length}
                        </button>
                    )}
                </div>
            )}
            {model.isFocused && (model.missingLines.length > 0 || model.hiddenLines.length > 0) && (
                <div className="dependency-missing">
                    {model.hiddenLines.length > 0 && (
                        <>
                            <div className="dependency-missing-label hidden">Hidden by filter</div>
                            {model.hiddenLines.map(item => (
                                <div className="dependency-missing-item" key={`hidden-${item.key}`}>
                                    <span>{item.teamName}</span>
                                    <span className="dependency-missing-sep">&middot;</span>
                                    <span>{item.assignee}</span>
                                    <span className="dependency-missing-sep">&middot;</span>
                                    <span>{item.summary}</span>
                                    <span className="dependency-missing-sep">&middot;</span>
                                    <span>{item.key}</span>
                                    <span className="dependency-missing-sep">&middot;</span>
                                    <span className={`dependency-missing-status ${item.isDone ? 'done' : ''}`}>{item.status}</span>
                                </div>
                            ))}
                        </>
                    )}
                    {model.missingLines.length > 0 && (
                        <>
                            <div className="dependency-missing-label">Not loaded</div>
                            {model.missingLines.map(item => (
                                <MissingIssueLine item={item} jiraUrl={jiraUrl} key={`missing-${item.key}`} />
                            ))}
                            {dependencyLookupLoading && (
                                <div className="dependency-missing-item">Loading issue details...</div>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
}
