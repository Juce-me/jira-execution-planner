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

function startDateFromQuarterLabel(label) {
    const match = String(label || '').trim().match(/^(\d{4})Q([1-4])$/i);
    if (!match) return '';
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = ((quarter - 1) * 3) + 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function buildJiraCohortStatusSearchUrl({
    jiraUrl,
    startQuarter,
    statuses = [],
    issueType = 'Epic',
} = {}) {
    const normalizedStatuses = (statuses || []).map(status => String(status || '').trim()).filter(Boolean);
    const startDate = startDateFromQuarterLabel(startQuarter);
    if (!normalizedStatuses.length || !startDate) return '';

    const clauses = [
        `issuetype = "${escapeJqlLiteral(issueType)}"`,
        `created >= "${startDate}"`
    ];
    if (normalizedStatuses.length === 1) {
        clauses.push(`status = "${escapeJqlLiteral(normalizedStatuses[0])}"`);
    } else {
        clauses.push(`status in (${quoteJqlList(normalizedStatuses)})`);
    }
    return buildJiraIssueSearchUrlFromJql(jiraUrl, clauses.join(' AND '));
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
