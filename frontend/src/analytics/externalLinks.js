const SAFE_ISSUE_KINDS = new Set(['initiative', 'epic', 'story', 'mixed', 'unknown']);
const SAFE_HOME_LINK_TYPES = new Set(['jira_home_project', 'jira_home_update']);

function normalizeIssueKind(issueKind, fallback = 'story') {
    const value = String(issueKind || '').trim().toLowerCase();
    return SAFE_ISSUE_KINDS.has(value) ? value : fallback;
}

function normalizeSourceSurface(sourceSurface, fallback = 'dashboard') {
    const value = String(sourceSurface || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return value || fallback;
}

export function buildJiraIssueListLinkAnalytics({
    issueKind = 'mixed',
    issueCount = 0,
    sourceSurface = 'dashboard',
    result = 'success',
} = {}) {
    return {
        linkType: 'jira_issue_list',
        issueKind: normalizeIssueKind(issueKind, 'mixed'),
        issueCount: Math.max(0, Number(issueCount) || 0),
        sourceSurface: normalizeSourceSurface(sourceSurface),
        result,
    };
}

export function buildJiraBrowseLinkAnalytics({
    issueKind = 'story',
    sourceSurface = 'dashboard',
    result = 'success',
} = {}) {
    return {
        linkType: 'jira_issue_browse',
        issueKind: normalizeIssueKind(issueKind),
        sourceSurface: normalizeSourceSurface(sourceSurface),
        result,
    };
}

export function buildJiraHomeLinkAnalytics({
    linkType = 'jira_home_project',
    sourceSurface = 'epm',
    result = 'success',
} = {}) {
    const normalizedLinkType = SAFE_HOME_LINK_TYPES.has(linkType) ? linkType : 'jira_home_project';
    return {
        linkType: normalizedLinkType,
        sourceSurface: normalizeSourceSurface(sourceSurface, 'epm'),
        result,
    };
}
