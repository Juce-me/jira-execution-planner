function normalizedIssueKey(value) {
    return String(value || '').trim().toUpperCase();
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
            next[storyKey] = { ...state, items };
        } else {
            next[storyKey] = state;
        }
    });
    return changed ? next : storySubtasksByKey;
}

