const DEFAULT_MAX_JQL_KEYS = 250;

function normalizeIssueKind(issueKind) {
    return issueKind === 'epics' ? 'epics' : 'stories';
}

function normalizeIssueKey(value) {
    return String(value || '').trim().toUpperCase();
}

export function normalizeJiraExportKeys(keys) {
    return Array.from(new Set((keys || []).map(normalizeIssueKey).filter(Boolean))).sort();
}

function getIssueTypeName(issue) {
    return String(issue?.fields?.issuetype?.name || issue?.issuetype?.name || issue?.issueType || '').trim();
}

export function collectJiraExportKeysFromTasks(tasks = [], issueKind = 'stories') {
    const kind = normalizeIssueKind(issueKind);
    if (kind === 'epics') {
        return normalizeJiraExportKeys((tasks || []).map(task => task?.fields?.epicKey));
    }
    return normalizeJiraExportKeys((tasks || [])
        .filter(task => getIssueTypeName(task).toLowerCase() === 'story')
        .map(task => task?.key));
}

export function collectJiraExportKeysFromScenarioIssues(issues = [], issueKind = 'stories') {
    const kind = normalizeIssueKind(issueKind);
    if (kind === 'epics') {
        return normalizeJiraExportKeys((issues || []).map(issue => issue?.epicKey));
    }
    return normalizeJiraExportKeys((issues || []).map(issue => issue?.key || issue?.originalKey));
}

export function collectJiraExportKeysFromEpmRollupTree(tree, issueKind = 'stories') {
    const kind = normalizeIssueKind(issueKind);
    const keys = [];
    if (!tree || tree.kind !== 'tree') return keys;

    const addEpicNode = (epicNode) => {
        if (!epicNode) return;
        if (kind === 'epics') {
            keys.push(epicNode.issue?.key);
            return;
        }
        (epicNode.stories || []).forEach(story => keys.push(story?.key));
    };

    (tree.initiatives || []).forEach(initiativeNode => {
        (initiativeNode.epics || []).forEach(addEpicNode);
        if (kind === 'stories') {
            (initiativeNode.looseStories || []).forEach(story => keys.push(story?.key));
        }
    });
    (tree.rootEpics || []).forEach(addEpicNode);
    if (kind === 'stories') {
        (tree.orphanStories || []).forEach(story => keys.push(story?.key));
    }

    return normalizeJiraExportKeys(keys);
}

export function collectJiraExportKeysFromEpmRollupBoards(boards = [], issueKind = 'stories') {
    return normalizeJiraExportKeys((boards || []).flatMap(({ tree }) => collectJiraExportKeysFromEpmRollupTree(tree, issueKind)));
}

export function buildJiraKeyInJql(keys = []) {
    const sortedKeys = normalizeJiraExportKeys(keys);
    if (!sortedKeys.length) return '';
    return `key in (${sortedKeys.join(', ')})`;
}

export function buildJiraIssueSearchUrl(jiraUrl, keys = []) {
    const baseUrl = String(jiraUrl || '').trim().replace(/\/+$/, '');
    const jql = buildJiraKeyInJql(keys);
    if (!baseUrl || !jql) return '';
    return `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`;
}

export function buildJiraIssueSearchUrlFromJql(jiraUrl, jql) {
    const baseUrl = String(jiraUrl || '').trim().replace(/\/+$/, '');
    const query = String(jql || '').trim();
    if (!baseUrl || !query) return '';
    return `${baseUrl}/issues/?jql=${encodeURIComponent(query)}`;
}

function escapeJqlLiteral(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quoteJqlList(values = []) {
    return values.map(value => `"${escapeJqlLiteral(value)}"`).join(', ');
}

function uniqueJqlValues(values = []) {
    const seen = new Set();
    const normalized = [];
    (values || []).forEach((value) => {
        const item = String(value || '').trim();
        if (!item || seen.has(item)) return;
        seen.add(item);
        normalized.push(item);
    });
    return normalized;
}

function startDateFromQuarterLabel(label) {
    const match = String(label || '').trim().match(/^(\d{4})Q([1-4])$/i);
    if (!match) return '';
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = ((quarter - 1) * 3) + 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
}

function nextQuarterStartDate(label) {
    const match = String(label || '').trim().match(/^(\d{4})Q([1-4])$/i);
    if (!match) return '';
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    if (quarter < 4) {
        const month = (quarter * 3) + 1;
        return `${year}-${String(month).padStart(2, '0')}-01`;
    }
    return `${year + 1}-01-01`;
}

function startDateFromMonthLabel(label) {
    const match = String(label || '').trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) return '';
    return `${match[1]}-${match[2]}-01`;
}

function nextMonthStartDate(label) {
    const match = String(label || '').trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 12) {
        return `${year}-${String(month + 1).padStart(2, '0')}-01`;
    }
    return `${year + 1}-01-01`;
}

function cohortDateClauses({ startQuarter, groupBy, rowKey } = {}) {
    if (rowKey && groupBy === 'month') {
        const startDate = startDateFromMonthLabel(rowKey);
        const endDate = nextMonthStartDate(rowKey);
        if (startDate && endDate) return [`created >= "${startDate}"`, `created < "${endDate}"`];
    }
    if (rowKey) {
        const startDate = startDateFromQuarterLabel(rowKey);
        const endDate = nextQuarterStartDate(rowKey);
        if (startDate && endDate) return [`created >= "${startDate}"`, `created < "${endDate}"`];
    }
    const startDate = startDateFromQuarterLabel(startQuarter);
    return startDate ? [`created >= "${startDate}"`] : [];
}

function pushInClause(clauses, fieldName, values) {
    const normalized = uniqueJqlValues(values);
    if (!normalized.length) return;
    clauses.push(`${fieldName} in (${quoteJqlList(normalized)})`);
}

export function buildJiraCohortIssueSearchUrl({
    jiraUrl,
    startQuarter,
    groupBy = 'quarter',
    rowKey = '',
    statuses = [],
    issueType = 'Epic',
    projectKey = '',
    components = [],
    teamIds = [],
    teamFieldName = 'Team[Team]',
    assigneeKey = '',
} = {}) {
    const dateClauses = cohortDateClauses({ startQuarter, groupBy, rowKey });
    const normalizedStatuses = uniqueJqlValues(statuses);
    if (!dateClauses.length || !normalizedStatuses.length) return '';

    const clauses = [
        `issuetype = "${escapeJqlLiteral(issueType)}"`,
        ...dateClauses
    ];
    const normalizedProject = String(projectKey || '').trim();
    if (normalizedProject && normalizedProject !== 'all') {
        clauses.push(`project = "${escapeJqlLiteral(normalizedProject)}"`);
    }
    pushInClause(clauses, 'status', normalizedStatuses);
    pushInClause(clauses, 'component', components);
    pushInClause(clauses, `"${escapeJqlLiteral(teamFieldName)}"`, teamIds);
    const normalizedAssignee = String(assigneeKey || '').trim();
    if (normalizedAssignee && normalizedAssignee !== 'all') {
        pushInClause(clauses, 'assignee', [normalizedAssignee]);
    }
    return buildJiraIssueSearchUrlFromJql(jiraUrl, clauses.join(' AND '));
}

export function buildJiraCohortStatusSearchUrl({
    jiraUrl,
    startQuarter,
    statuses = [],
    issueType = 'Epic',
} = {}) {
    return buildJiraCohortIssueSearchUrl({
        jiraUrl,
        startQuarter,
        statuses,
        issueType
    });
}

export function openJiraIssueSearch({
    jiraUrl,
    keys,
    opener,
    onOverflow,
    maxKeys = DEFAULT_MAX_JQL_KEYS
} = {}) {
    const sortedKeys = normalizeJiraExportKeys(keys);
    const url = buildJiraIssueSearchUrl(jiraUrl, sortedKeys);
    if (!url) {
        return { opened: false, url: '', keyCount: sortedKeys.length, overflow: false };
    }
    const overflow = sortedKeys.length > maxKeys;
    if (overflow && typeof onOverflow === 'function') {
        onOverflow(sortedKeys.length);
    }
    const open = opener || (typeof window !== 'undefined' ? window.open : null);
    if (typeof open === 'function') {
        open(url, '_blank', 'noopener,noreferrer');
    }
    return { opened: true, url, keyCount: sortedKeys.length, overflow };
}
