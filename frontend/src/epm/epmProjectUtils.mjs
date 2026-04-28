export function shouldUseEpmSprint(tab) {
    return String(tab || '').trim().toLowerCase() === 'active';
}

export function getEpmSprintHelper(tab) {
    return shouldUseEpmSprint(tab) ? '' : 'Active only';
}

export function getEpmProjectIdentity(project) {
    return String(project?.id || '').trim();
}

export function filterEpmProjectsForTab(projects, tab) {
    const normalizedTab = String(tab || 'active').trim().toLowerCase();
    return Array.isArray(projects)
        ? projects.filter((project) => {
            const tabBucket = String(project?.tabBucket || '').trim().toLowerCase();
            return tabBucket === normalizedTab || tabBucket === 'all';
        })
        : [];
}

function collectionValues(collection) {
    if (Array.isArray(collection)) return collection;
    if (collection && typeof collection === 'object') return Object.values(collection);
    return [];
}

function takeIssueOnce(issue, seenKeys) {
    const key = String(issue?.key || '').trim();
    if (!key) return null;
    if (seenKeys.has(key)) return null;
    seenKeys.add(key);
    return issue;
}

function normalizeEpicNode(node, seenKeys) {
    const issue = takeIssueOnce(node?.issue, seenKeys);
    if (!issue) return null;
    return {
        issue,
        stories: collectionValues(node?.stories)
            .map(story => takeIssueOnce(story, seenKeys))
            .filter(Boolean)
    };
}

function normalizeInitiativeNode(node, seenKeys) {
    const issue = takeIssueOnce(node?.issue, seenKeys);
    if (!issue) return null;
    return {
        issue,
        epics: collectionValues(node?.epics)
            .map(epicNode => normalizeEpicNode(epicNode, seenKeys))
            .filter(Boolean),
        looseStories: collectionValues(node?.looseStories)
            .map(story => takeIssueOnce(story, seenKeys))
            .filter(Boolean)
    };
}

export function buildRollupTree(payload) {
    if (payload?.metadataOnly) {
        return { kind: 'metadataOnly' };
    }
    if (payload?.emptyRollup) {
        return { kind: 'emptyRollup' };
    }

    const seenKeys = new Set();
    return {
        kind: 'tree',
        truncated: Boolean(payload?.truncated),
        truncatedQueries: Array.isArray(payload?.truncatedQueries) ? payload.truncatedQueries : [],
        initiatives: collectionValues(payload?.initiatives)
            .map(node => normalizeInitiativeNode(node, seenKeys))
            .filter(Boolean),
        rootEpics: collectionValues(payload?.rootEpics)
            .map(node => normalizeEpicNode(node, seenKeys))
            .filter(Boolean),
        orphanStories: collectionValues(payload?.orphanStories)
            .map(story => takeIssueOnce(story, seenKeys))
            .filter(Boolean)
    };
}

export function buildAggregateRollupBoards(payload) {
    const projects = Array.isArray(payload?.projects) ? payload.projects : [];
    const duplicates = payload?.duplicates && typeof payload.duplicates === 'object' && !Array.isArray(payload.duplicates)
        ? payload.duplicates
        : {};
    return {
        boards: projects.map((entry) => ({
            project: entry?.project || {},
            tree: buildRollupTree(entry?.rollup || {})
        })),
        duplicates,
        truncated: Boolean(payload?.truncated),
        fallback: Boolean(payload?.fallback)
    };
}

export function toEpmEngTask(issue = {}) {
    const assignee = issue.assignee ? { displayName: issue.assignee } : null;
    return {
        id: issue.id || issue.key,
        key: issue.key,
        fields: {
            summary: issue.summary || issue.key || '',
            status: { name: issue.status || 'Unknown' },
            priority: issue.priority ? { name: issue.priority } : null,
            issuetype: issue.issueType ? { name: issue.issueType } : null,
            assignee,
            updated: issue.updated || '',
            customfield_10004: issue.storyPoints,
            teamName: issue.teamName || 'Unknown Team',
            teamId: issue.teamId || issue.teamName || 'Unknown Team',
            parentSummary: issue.parentSummary || '',
            epicKey: issue.parentKey || ''
        }
    };
}

export function toEpmEngEpicDetails(issue = {}) {
    return {
        key: issue.key,
        summary: issue.summary || issue.key || '',
        assignee: issue.assignee ? { displayName: issue.assignee } : null,
        teamName: issue.teamName || 'Unknown Team',
        teamId: issue.teamId || issue.teamName || 'Unknown Team'
    };
}

export function buildEpmEngEpicGroup(epicNode = {}) {
    const epic = epicNode.issue || {};
    const tasks = (epicNode.stories || []).map(toEpmEngTask);
    return {
        key: epic.key || 'NO_EPIC',
        epic: toEpmEngEpicDetails(epic),
        tasks,
        storyPoints: tasks.reduce((sum, task) => {
            const value = parseFloat(task.fields.customfield_10004 || 0);
            return Number.isNaN(value) ? sum : sum + value;
        }, 0),
        parentSummary: epic.summary || ''
    };
}

export function flattenEpmRollupBoardsForDependencies(boards = []) {
    const tasks = [];
    const seen = new Set();
    const addIssue = (issue) => {
        if (!issue?.key || seen.has(issue.key)) return;
        seen.add(issue.key);
        tasks.push(toEpmEngTask(issue));
    };
    (boards || []).forEach(({ tree }) => {
        if (tree?.kind !== 'tree') return;
        tree.initiatives.forEach(initiative => {
            addIssue(initiative.issue);
            initiative.epics.forEach(epic => {
                addIssue(epic.issue);
                epic.stories.forEach(addIssue);
            });
            initiative.looseStories.forEach(addIssue);
        });
        tree.rootEpics.forEach(epic => {
            addIssue(epic.issue);
            epic.stories.forEach(addIssue);
        });
        tree.orphanStories.forEach(addIssue);
    });
    return tasks;
}

export function hydrateEpmProjectDraft(row, homeProject) {
    return {
        ...(row || {}),
        displayName: row?.name || homeProject?.name || ''
    };
}

export function getEpmProjectDisplayName(project) {
    return String(
        project?.displayName ||
        project?.name ||
        project?.homeProjectId ||
        ''
    ).trim();
}

export function normalizeEpmSettingsKeyPart(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeEpmLabelPrefix(config) {
    return String(config?.labelPrefix || '').trim();
}

export function isEpmProjectsConfigReady(config) {
    const subGoalKey = normalizeEpmSettingsKeyPart(config?.scope?.subGoalKey);
    const labelPrefix = normalizeEpmLabelPrefix(config);
    return Boolean(subGoalKey && labelPrefix);
}

export function getEpmProjectPrerequisites(config) {
    const missing = [];
    if (!normalizeEpmSettingsKeyPart(config?.scope?.subGoalKey)) {
        missing.push('subGoal');
    }
    if (!normalizeEpmLabelPrefix(config)) {
        missing.push('labelPrefix');
    }
    return missing;
}

export function getEpmSettingsProjectsCacheKey(config) {
    if (!isEpmProjectsConfigReady(config)) return '';
    return [
        normalizeEpmSettingsKeyPart(config?.scope?.rootGoalKey),
        normalizeEpmSettingsKeyPart(config?.scope?.subGoalKey),
        normalizeEpmLabelPrefix(config)
    ].join('::');
}
