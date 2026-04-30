export function shouldUseEpmSprint(tab) {
    return String(tab || '').trim().toLowerCase() === 'active';
}

export function getEpmSprintHelper(tab) {
    return shouldUseEpmSprint(tab) ? '' : 'Active only';
}

export function getEpmProjectIdentity(project) {
    return String(project?.id || '').trim();
}

export function isEmptyCustomEpmProjectRow(row) {
    if (!row) return false;
    if (row.homeProjectId !== null && String(row?.homeProjectId ?? '').trim()) return false;
    return !String(row?.name ?? '').trim() && !String(row?.label ?? '').trim();
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
    const draftName = String(row?.name ?? '');
    const homeName = String(homeProject?.name || row?.homeName || '');
    const draftLabel = String(row?.label ?? '');
    const homeLabel = String(homeProject?.label || '');
    const name = draftName.trim() ? draftName : homeName;
    const label = draftLabel.trim() ? draftLabel : homeLabel;
    return {
        ...(row || {}),
        name,
        label,
        displayName: name || homeName || ''
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

function normalizeEpmSettingsSortText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeEpmSettingsStatus(value) {
    return normalizeEpmSettingsSortText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function getEpmSettingsStatusRank(project) {
    const status = normalizeEpmSettingsStatus(project?.stateLabel || project?.stateValue || '');
    const ranks = {
        'on track': 10,
        'at risk': 20,
        'off track': 30,
        blocked: 40,
        pending: 50,
        paused: 60,
        done: 70,
        completed: 70,
        release: 80,
        released: 80,
        archived: 90
    };
    return Object.prototype.hasOwnProperty.call(ranks, status) ? ranks[status] : 999;
}

function isArchivedEpmSettingsProject(project) {
    const bucket = normalizeEpmSettingsSortText(project?.tabBucket || '');
    const status = normalizeEpmSettingsStatus(project?.stateLabel || project?.stateValue || '');
    return bucket === 'archived' || ['archived', 'cancelled', 'completed', 'done', 'release', 'released'].includes(status);
}

export function filterEpmSettingsProjectsForView(projects, view = 'current') {
    const source = Array.isArray(projects) ? projects : [];
    const normalizedView = normalizeEpmSettingsSortText(view || 'current');
    if (normalizedView === 'all') return source.slice();
    if (normalizedView === 'archived') {
        return source.filter(project => isArchivedEpmSettingsProject(project));
    }
    return source.filter(project => !isArchivedEpmSettingsProject(project));
}

export function sortEpmSettingsProjects(projects, sortKey = 'status') {
    const source = Array.isArray(projects) ? projects : [];
    const key = String(sortKey || 'status').trim().toLowerCase();

    return source
        .map((project, index) => ({ project, index }))
        .sort((a, b) => {
            if (key === 'name') {
                const aName = normalizeEpmSettingsSortText(getEpmProjectDisplayName(a.project));
                const bName = normalizeEpmSettingsSortText(getEpmProjectDisplayName(b.project));
                const nameCompare = aName.localeCompare(bName);
                return nameCompare || a.index - b.index;
            }
            if (key === 'status') {
                const rankCompare = getEpmSettingsStatusRank(a.project) - getEpmSettingsStatusRank(b.project);
                if (rankCompare) return rankCompare;
                const aStatus = normalizeEpmSettingsStatus(a.project?.stateLabel || a.project?.stateValue || '');
                const bStatus = normalizeEpmSettingsStatus(b.project?.stateLabel || b.project?.stateValue || '');
                const statusCompare = aStatus.localeCompare(bStatus);
                if (statusCompare) return statusCompare;
                const aName = normalizeEpmSettingsSortText(getEpmProjectDisplayName(a.project));
                const bName = normalizeEpmSettingsSortText(getEpmProjectDisplayName(b.project));
                return aName.localeCompare(bName) || a.index - b.index;
            }
            if (key === 'label') {
                const aLabel = normalizeEpmSettingsSortText(a.project?.label || '');
                const bLabel = normalizeEpmSettingsSortText(b.project?.label || '');
                if (aLabel && !bLabel) return -1;
                if (!aLabel && bLabel) return 1;
                const labelCompare = aLabel.localeCompare(bLabel);
                if (labelCompare) return labelCompare;
                const aName = normalizeEpmSettingsSortText(getEpmProjectDisplayName(a.project));
                const bName = normalizeEpmSettingsSortText(getEpmProjectDisplayName(b.project));
                return aName.localeCompare(bName) || a.index - b.index;
            }
            return a.index - b.index;
        })
        .map(entry => entry.project);
}

function parseEpmProjectDate(value) {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatEpmProjectRelativeDate(value, now = new Date()) {
    const date = parseEpmProjectDate(value);
    const nowDay = startOfUtcDay(now);
    if (!date || nowDay === null) return '';
    const dateDay = startOfUtcDay(date);
    const days = Math.max(0, Math.floor((nowDay - dateDay) / 86400000));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) {
        const weeks = Math.max(1, Math.floor(days / 7));
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (days < 365) {
        const months = Math.max(1, Math.floor(days / 30));
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.max(1, Math.floor(days / 365));
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

function getEpmProjectStatusText(project) {
    const status = normalizeEpmSettingsStatus(project?.stateLabel || project?.stateValue || '');
    return status;
}

export function buildEpmProjectUpdateLine(project, now = new Date()) {
    const date = String(project?.latestUpdateDate || '').trim();
    const relativeDate = formatEpmProjectRelativeDate(date, now);
    const snippet = String(project?.latestUpdateSnippet || '').trim();
    const status = getEpmProjectStatusText(project);
    const message = snippet || (status ? `Status is ${status}.` : 'No Home status update.');
    return {
        text: [relativeDate, message].filter(Boolean).join(' · '),
        title: date
    };
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
