export function shouldUseEpmSprint(tab) {
    return String(tab || '').trim().toLowerCase() === 'active';
}

export function getEpmProjectIdentity(project) {
    return String(project?.id || '').trim();
}

export function isEmptyCustomEpmProjectRow(row) {
    if (!row) return false;
    if (row.homeProjectId !== null && String(row?.homeProjectId ?? '').trim()) return false;
    return !String(row?.name ?? '').trim() && !String(row?.label ?? '').trim();
}

const ACTIVE_EPM_PROJECT_STATES = new Set(['pending', 'on track', 'at risk', 'off track']);
const BACKLOG_EPM_PROJECT_STATES = new Set(['paused', 'todo', 'to do']);
const ARCHIVED_EPM_PROJECT_STATES = new Set(['completed', 'cancelled', 'archived', 'done', 'release', 'released']);
const RECENT_COMPLETED_EPM_PROJECT_STATES = new Set(['completed', 'done']);
const TERMINAL_EPM_ISSUE_STATUSES = new Set(['done', 'killed', 'incomplete']);
const COMPLETED_EPM_PROGRESS_STATUSES = new Set(['done', 'incomplete']);
const EPM_PROJECT_PRIORITY_ORDER = {
    blocker: 0,
    highest: 1,
    critical: 2,
    high: 3,
    major: 4,
    medium: 5,
    minor: 6,
    low: 7,
    trivial: 8,
    lowest: 9
};
export const EPM_PROJECT_UPDATE_STALE_DAYS = 14;
export const DEFAULT_EPM_PROJECT_SORT = 'priority';
export const EPM_PROJECT_SORT_OPTIONS = Object.freeze([
    { value: 'priority', label: 'Priority' },
    { value: 'updated-desc', label: 'Updated ↓' },
    { value: 'updated-asc', label: 'Updated ↑' }
]);

function getEpmProjectLifecycleBucket(project) {
    const tabBucket = String(project?.tabBucket || '').trim().toLowerCase();
    const status = normalizeEpmSettingsStatus(project?.stateValue || project?.stateLabel || '');
    if (ACTIVE_EPM_PROJECT_STATES.has(status)) return 'active';
    if (BACKLOG_EPM_PROJECT_STATES.has(status)) return 'backlog';
    if (ARCHIVED_EPM_PROJECT_STATES.has(status)) return 'archived';
    if (['active', 'backlog', 'archived', 'all'].includes(tabBucket) && !status) return tabBucket;
    return '';
}

export function isRecentlyCompletedEpmProject(project, now = new Date()) {
    if (project?.recentlyCompleted === true) return true;
    const status = normalizeEpmSettingsStatus(project?.stateValue || project?.stateLabel || '');
    if (!RECENT_COMPLETED_EPM_PROJECT_STATES.has(status)) return false;
    const ageDays = getEpmProjectUpdateAgeDays(project?.latestUpdateDate, now);
    return ageDays !== null && ageDays >= 0 && ageDays < EPM_PROJECT_UPDATE_STALE_DAYS;
}

export function filterEpmProjectsForTab(projects, tab, now = new Date()) {
    const normalizedTab = String(tab || 'active').trim().toLowerCase();
    return Array.isArray(projects)
        ? projects.filter((project) => {
            const tabBucket = getEpmProjectLifecycleBucket(project);
            const recentlyCompleted = isRecentlyCompletedEpmProject(project, now);
            if (normalizedTab === 'active') {
                return tabBucket === 'active' || tabBucket === 'all' || recentlyCompleted;
            }
            return tabBucket === normalizedTab;
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

export function normalizeEpmProjectSort(value) {
    const key = String(value || '').trim().toLowerCase();
    return EPM_PROJECT_SORT_OPTIONS.some(option => option.value === key) ? key : DEFAULT_EPM_PROJECT_SORT;
}

export function getEpmProjectSortLabel(value) {
    const normalized = normalizeEpmProjectSort(value);
    return EPM_PROJECT_SORT_OPTIONS.find(option => option.value === normalized)?.label || 'Priority';
}

function getEpmProjectUpdatedTime(project) {
    const parsed = parseEpmProjectDate(project?.latestUpdateDate);
    return parsed ? parsed.getTime() : null;
}

function collectEpmTreeEpicNodes(tree) {
    if (!tree || tree.kind !== 'tree') return [];
    const epics = [];
    tree.initiatives.forEach(initiative => {
        initiative.epics.forEach(epic => epics.push(epic));
    });
    tree.rootEpics.forEach(epic => epics.push(epic));
    return epics;
}

function getEpmIssuePriorityRank(issue) {
    const priority = normalizeEpmSettingsSortText(issue?.priority);
    return Object.prototype.hasOwnProperty.call(EPM_PROJECT_PRIORITY_ORDER, priority)
        ? EPM_PROJECT_PRIORITY_ORDER[priority]
        : 999;
}

function getEpmBoardPriorityRank(board) {
    const ranks = collectEpmTreeEpicNodes(board?.tree)
        .map(epicNode => epicNode?.issue)
        .filter(issue => !TERMINAL_EPM_ISSUE_STATUSES.has(normalizeEpmSettingsStatus(issue?.status)))
        .map(getEpmIssuePriorityRank);
    return ranks.length ? Math.min(...ranks) : 999;
}

function compareNullableTime(left, right, direction) {
    const leftMissing = left === null || Number.isNaN(left);
    const rightMissing = right === null || Number.isNaN(right);
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return direction === 'asc' ? left - right : right - left;
}

function compareEpmBoardName(a, b) {
    return normalizeEpmSettingsSortText(getEpmProjectDisplayName(a.board?.project))
        .localeCompare(normalizeEpmSettingsSortText(getEpmProjectDisplayName(b.board?.project)));
}

export function sortEpmRollupBoards(boards, sortKey = DEFAULT_EPM_PROJECT_SORT, now = new Date()) {
    const key = normalizeEpmProjectSort(sortKey);
    const source = Array.isArray(boards) ? boards : [];
    return source
        .map((board, index) => ({
            board,
            index,
            recentlyCompletedRank: isRecentlyCompletedEpmProject(board?.project, now) ? 0 : 1,
            priorityRank: getEpmBoardPriorityRank(board),
            updatedTime: getEpmProjectUpdatedTime(board?.project)
        }))
        .sort((a, b) => {
            const completedCompare = a.recentlyCompletedRank - b.recentlyCompletedRank;
            if (completedCompare) return completedCompare;
            if (key === 'updated-asc') {
                const updatedCompare = compareNullableTime(a.updatedTime, b.updatedTime, 'asc');
                if (updatedCompare) return updatedCompare;
                const priorityCompare = a.priorityRank - b.priorityRank;
                if (priorityCompare) return priorityCompare;
            } else if (key === 'updated-desc') {
                const updatedCompare = compareNullableTime(a.updatedTime, b.updatedTime, 'desc');
                if (updatedCompare) return updatedCompare;
                const priorityCompare = a.priorityRank - b.priorityRank;
                if (priorityCompare) return priorityCompare;
            } else {
                const priorityCompare = a.priorityRank - b.priorityRank;
                if (priorityCompare) return priorityCompare;
                const updatedCompare = compareNullableTime(a.updatedTime, b.updatedTime, 'desc');
                if (updatedCompare) return updatedCompare;
            }
            return compareEpmBoardName(a.board, b.board) || a.index - b.index;
        })
        .map(entry => entry.board);
}

function normalizeEpmSearchText(value) {
    return String(value || '').trim().toLowerCase();
}

function collectEpmIssueSearchText(issue) {
    return [
        issue?.key,
        issue?.summary,
        issue?.status,
        issue?.issueType,
        issue?.assignee,
        issue?.teamName,
        issue?.parentKey,
        issue?.parentSummary
    ].map(normalizeEpmSearchText).filter(Boolean).join(' ');
}

function collectEpmTreeSearchText(tree) {
    if (!tree || tree.kind !== 'tree') return '';
    const parts = [];
    tree.initiatives.forEach(initiative => {
        parts.push(collectEpmIssueSearchText(initiative.issue));
        initiative.epics.forEach(epic => {
            parts.push(collectEpmIssueSearchText(epic.issue));
            epic.stories.forEach(story => parts.push(collectEpmIssueSearchText(story)));
        });
        initiative.looseStories.forEach(story => parts.push(collectEpmIssueSearchText(story)));
    });
    tree.rootEpics.forEach(epic => {
        parts.push(collectEpmIssueSearchText(epic.issue));
        epic.stories.forEach(story => parts.push(collectEpmIssueSearchText(story)));
    });
    tree.orphanStories.forEach(story => parts.push(collectEpmIssueSearchText(story)));
    return parts.filter(Boolean).join(' ');
}

export function filterEpmRollupBoardsForSearch(boards, query) {
    if (!Array.isArray(boards)) return [];
    const normalizedQuery = normalizeEpmSearchText(query);
    if (!normalizedQuery) return boards;
    return boards.filter(({ project, tree }) => {
        const projectText = [
            getEpmProjectDisplayName(project),
            project?.label,
            project?.stateLabel,
            project?.stateValue,
            project?.latestUpdateSnippet,
            project?.latestUpdateDate,
            project?.homeProjectId
        ].map(normalizeEpmSearchText).filter(Boolean).join(' ');
        return `${projectText} ${collectEpmTreeSearchText(tree)}`.includes(normalizedQuery);
    });
}

function collectEpmProjectStories(tree) {
    if (!tree || tree.kind !== 'tree') return [];
    const stories = [];
    tree.initiatives.forEach(initiative => {
        initiative.epics.forEach(epic => {
            epic.stories.forEach(story => stories.push(story));
        });
        initiative.looseStories.forEach(story => stories.push(story));
    });
    tree.rootEpics.forEach(epic => {
        epic.stories.forEach(story => stories.push(story));
    });
    tree.orphanStories.forEach(story => stories.push(story));
    return stories;
}

function getEpmStoryPoints(issue) {
    const value = Number(issue?.storyPoints);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildEpmProjectProgress(tree) {
    const progress = {
        completedStoryPoints: 0,
        incompleteStoryPoints: 0,
        doneStoryPoints: 0,
        killedStoryPoints: 0,
        remainingStoryPoints: 0,
        totalStoryPoints: 0,
        progressPercent: 0
    };

    collectEpmProjectStories(tree).forEach((story) => {
        const storyPoints = getEpmStoryPoints(story);
        if (storyPoints <= 0) return;
        const status = normalizeEpmSettingsStatus(story?.status);
        if (status === 'killed') {
            progress.killedStoryPoints += storyPoints;
            return;
        }
        progress.totalStoryPoints += storyPoints;
        if (!COMPLETED_EPM_PROGRESS_STATUSES.has(status)) return;
        progress.completedStoryPoints += storyPoints;
        if (status === 'done') {
            progress.doneStoryPoints += storyPoints;
        } else {
            progress.incompleteStoryPoints += storyPoints;
        }
    });

    if (progress.totalStoryPoints <= 0) return null;
    progress.remainingStoryPoints = Math.max(0, progress.totalStoryPoints - progress.completedStoryPoints);
    progress.progressPercent = (progress.completedStoryPoints / progress.totalStoryPoints) * 100;
    return progress;
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

function getEpmProjectUpdateAgeDays(value, now = new Date()) {
    const date = parseEpmProjectDate(value);
    const nowDay = startOfUtcDay(now);
    if (!date || nowDay === null) return null;
    const dateDay = startOfUtcDay(date);
    return Math.max(0, Math.floor((nowDay - dateDay) / 86400000));
}

function formatEpmProjectRelativeDate(value, now = new Date()) {
    const days = getEpmProjectUpdateAgeDays(value, now);
    if (days === null) return '';
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

function buildEpmProjectUpdateFreshness(date, hasHomeUpdate, now = new Date()) {
    const ageDays = getEpmProjectUpdateAgeDays(date, now);
    const base = {
        ageDays,
        thresholdDays: EPM_PROJECT_UPDATE_STALE_DAYS
    };
    if (!hasHomeUpdate) {
        return {
            state: 'missing',
            label: 'No Home update',
            ...base,
            ageDays: null
        };
    }
    if (ageDays === null) {
        return {
            state: 'unknown',
            label: 'Update date missing',
            ...base
        };
    }
    if (ageDays > EPM_PROJECT_UPDATE_STALE_DAYS) {
        return {
            state: 'stale',
            label: 'Stale update',
            ...base
        };
    }
    return {
        state: 'fresh',
        label: 'Updated recently',
        ...base
    };
}

function getEpmProjectStatusText(project) {
    const status = normalizeEpmSettingsStatus(project?.stateLabel || project?.stateValue || '');
    return status;
}

export function buildEpmProjectUpdateLine(project, now = new Date()) {
    const date = String(project?.latestUpdateDate || '').trim();
    const relativeDate = formatEpmProjectRelativeDate(date, now);
    const snippet = String(project?.latestUpdateSnippet || '').trim();
    const messageHtml = String(project?.latestUpdateHtml || '').trim();
    const author = String(project?.latestUpdateAuthor || '').trim();
    const updateUrl = String(project?.latestUpdateUrl || '').trim();
    const hasHomeUpdate = Boolean(date || snippet || messageHtml || author || updateUrl);
    const freshness = buildEpmProjectUpdateFreshness(date, hasHomeUpdate, now);
    const status = getEpmProjectStatusText(project);
    const message = snippet || (status ? `Status is ${status}.` : 'No Home status update.');
    const line = {
        text: [relativeDate, author, message].filter(Boolean).join(' · '),
        title: [date, author].filter(Boolean).join(' · '),
        relativeDate,
        message,
        freshness
    };
    if (author) {
        line.author = author;
    }
    if (messageHtml) {
        line.messageHtml = messageHtml;
    }
    if (updateUrl) {
        line.url = updateUrl;
    }
    return line;
}

export function normalizeEpmSettingsKeyPart(value) {
    return String(value || '').trim().toUpperCase();
}

export function normalizeEpmScopeSubGoalKeys(scope) {
    const values = Array.isArray(scope?.subGoalKeys) ? scope.subGoalKeys : [];
    const source = values.length ? values : [scope?.subGoalKey];
    const seen = new Set();
    const normalized = [];
    source.forEach((value) => {
        const key = normalizeEpmSettingsKeyPart(value);
        if (!key || seen.has(key)) return;
        seen.add(key);
        normalized.push(key);
    });
    return normalized;
}

export function getNextEpmSubGoalSelection(savedSubGoalKeys, selectedSubGoalKeys, clickedSubGoalKey) {
    const savedKeys = normalizeEpmScopeSubGoalKeys({ subGoalKeys: savedSubGoalKeys });
    const selectedKeys = normalizeEpmScopeSubGoalKeys({ subGoalKeys: selectedSubGoalKeys })
        .filter(key => savedKeys.includes(key));
    const clickedKey = normalizeEpmSettingsKeyPart(clickedSubGoalKey);
    if (!clickedKey || !savedKeys.includes(clickedKey)) {
        return selectedKeys;
    }

    const nextSet = new Set(selectedKeys.length ? selectedKeys : savedKeys);
    if (nextSet.has(clickedKey)) {
        nextSet.delete(clickedKey);
    } else {
        nextSet.add(clickedKey);
    }

    const nextKeys = savedKeys.filter(savedKey => nextSet.has(savedKey));
    return nextKeys.length === savedKeys.length ? [] : nextKeys;
}

export function getEpmSubGoalDisplayParts(goal, fallbackKey = '') {
    const key = normalizeEpmSettingsKeyPart(goal?.key || fallbackKey);
    const rawName = String(goal?.name || '').trim();
    const prettyName = rawName.replace(/^\[EPM\]\s*/i, '').trim();
    const name = prettyName && normalizeEpmSettingsKeyPart(prettyName) !== key ? prettyName : key;
    return { name, key };
}

function normalizeEpmLabelPrefix(config) {
    return String(config?.labelPrefix || '').trim();
}

export function isEpmProjectsConfigReady(config) {
    const subGoalKeys = normalizeEpmScopeSubGoalKeys(config?.scope);
    const labelPrefix = normalizeEpmLabelPrefix(config);
    return Boolean(subGoalKeys.length && labelPrefix);
}

export function getEpmProjectPrerequisites(config) {
    const missing = [];
    if (normalizeEpmScopeSubGoalKeys(config?.scope).length === 0) {
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
        normalizeEpmScopeSubGoalKeys(config?.scope).join(','),
        normalizeEpmLabelPrefix(config)
    ].join('::');
}
