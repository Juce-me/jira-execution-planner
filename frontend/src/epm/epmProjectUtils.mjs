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
