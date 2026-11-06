import { buildFocusKeys } from '../issues/dependencyFocusUtils.js';

export const PLANNING_DETAILS_BATCH_SIZE = 20;
export const PLANNING_DETAILS_CATEGORIES = ['depends-on', 'dependents', 'blocked-by', 'blocks'];

// Review parents are flat metadata; IssueCard always consumes a Jira-like fields object.
export function planningDetailsIssue(row) {
    const issue = row?.issue || row;
    if (!issue?.key) return null;
    const source = issue.fields || issue;
    const named = value => typeof value === 'string' ? { name: value } : value;
    return { ...issue, key: issue.key, fields: {
        ...source,
        summary: source.summary || row?.summary || issue.key,
        status: named(source.status) || { name: 'Unknown' },
        priority: named(source.priority),
        issuetype: named(source.issuetype || source.issueType),
        assignee: typeof source.assignee === 'string' ? { displayName: source.assignee } : source.assignee,
        teamName: source.teamName || row?.team?.name,
        customfield_10004: source.customfield_10004 ?? source.storyPoints ?? row?.storyPoints,
    } };
}

export function planningRelatedKeys(dependencyData, issueKey, category) {
    if (!PLANNING_DETAILS_CATEGORIES.includes(category)) return [];
    return [...new Set(buildFocusKeys(dependencyData, issueKey, category))].filter(key => key && key !== issueKey);
}

export async function readPlanningRelatedBatch({ keys, offset = 0, knownIssues = new Map(), request, signal }) {
    const batch = [...new Set(keys)].slice(offset, offset + PLANNING_DETAILS_BATCH_SIZE);
    const issues = new Map(batch.filter(key => knownIssues.has(key)).map(key => [key, planningDetailsIssue(knownIssues.get(key))]));
    const missing = batch.filter(key => !issues.has(key));
    if (missing.length) {
        const response = await request(missing, { signal });
        if (!response.ok) throw new Error('Related issues could not be loaded.');
        const data = await response.json();
        if (!Array.isArray(data.issues)) throw new Error('Related issues could not be loaded.');
        for (const raw of data.issues) {
            if (missing.includes(raw?.key)) issues.set(raw.key, planningDetailsIssue(raw));
        }
    }
    return { issues: batch.map(key => issues.get(key)).filter(Boolean), unavailableKeys: batch.filter(key => !issues.get(key)),
        nextOffset: Math.min(keys.length, offset + batch.length), total: keys.length };
}
