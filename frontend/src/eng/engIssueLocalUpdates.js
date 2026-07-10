function normalizedIssueKey(value) {
    return String(value || '').trim().toUpperCase();
}

const DONE_STATUS_NAMES = new Set(['done']);
const IN_PROGRESS_STATUS_NAMES = new Set(['analysis', 'in progress', 'release', 'waiting for release']);
const EXCLUDED_STATUS_NAMES = new Set(['killed']);

function normalizedStatusName(value) {
    return String(typeof value === 'string' ? value : value?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildLocalSubtaskSummary(items) {
    const summary = { total: 0, done: 0, inProgress: 0, waiting: 0, percentComplete: 0, statusCounts: {} };
    (Array.isArray(items) ? items : []).forEach((item) => {
        const statusName = String(item?.status?.name || '').trim();
        const normalized = normalizedStatusName(statusName);
        if (EXCLUDED_STATUS_NAMES.has(normalized)) return;
        summary.total += 1;
        if (statusName) summary.statusCounts[statusName] = (summary.statusCounts[statusName] || 0) + 1;
        if (DONE_STATUS_NAMES.has(normalized)) summary.done += 1;
        else if (IN_PROGRESS_STATUS_NAMES.has(normalized)) summary.inProgress += 1;
        else summary.waiting += 1;
    });
    if (summary.total) summary.percentComplete = Math.round((summary.done / summary.total) * 1000) / 10;
    return summary;
}

export function applyLocalIssueFieldUpdate(issues, issueKey, fieldName, fieldValue) {
    const key = normalizedIssueKey(issueKey);
    const field = String(fieldName || '').trim();
    if (!Array.isArray(issues) || !key || !field) return issues;

    let changed = false;
    const next = issues.map((issue) => {
        if (normalizedIssueKey(issue?.key) !== key) return issue;
        changed = true;
        if (issue?.fields && typeof issue.fields === 'object') {
            return { ...issue, fields: { ...issue.fields, [field]: fieldValue } };
        }
        return { ...issue, [field]: fieldValue };
    });
    return changed ? next : issues;
}

export function applyLocalEpicDetailsFieldUpdate(epicDetails, issueKey, fieldName, fieldValue) {
    const key = normalizedIssueKey(issueKey);
    const field = String(fieldName || '').trim();
    if (!epicDetails || typeof epicDetails !== 'object' || !key || !field) return epicDetails;

    const storedKey = Object.keys(epicDetails).find(candidate => normalizedIssueKey(candidate) === key);
    if (!storedKey || !epicDetails[storedKey]) return epicDetails;
    return {
        ...epicDetails,
        [storedKey]: { ...epicDetails[storedKey], [field]: fieldValue },
    };
}

export function applyLocalSubtaskFieldUpdate(storySubtasksByKey, issueKey, fieldName, fieldValue) {
    if (!storySubtasksByKey || typeof storySubtasksByKey !== 'object') return storySubtasksByKey;

    let changed = false;
    const next = {};
    Object.entries(storySubtasksByKey).forEach(([storyKey, state]) => {
        const items = applyLocalIssueFieldUpdate(state?.items, issueKey, fieldName, fieldValue);
        if (items !== state?.items) {
            changed = true;
            next[storyKey] = {
                ...state,
                items,
                ...(String(fieldName || '').trim() === 'status' ? { summary: buildLocalSubtaskSummary(items) } : {}),
            };
        } else {
            next[storyKey] = state;
        }
    });
    return changed ? next : storySubtasksByKey;
}
