function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function pushSprintToken(tokens, value) {
    if (value === null || value === undefined) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    tokens.push(normalized);
}

function collectSprintTokens(tokens, value) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
        value.forEach((entry) => collectSprintTokens(tokens, entry));
        return;
    }
    if (typeof value === 'object') {
        pushSprintToken(tokens, value.id);
        pushSprintToken(tokens, value.name);
        pushSprintToken(tokens, value.state);
        return;
    }
    if (typeof value === 'string') {
        pushSprintToken(tokens, value);
        const match = value.match(/id=([0-9]+)/);
        if (match) {
            pushSprintToken(tokens, match[1]);
        }
        return;
    }
    pushSprintToken(tokens, value);
}

export function getIssueSprintTokens(issue) {
    const tokens = [];
    const fields = issue?.fields || {};

    collectSprintTokens(tokens, issue?.sprintId);
    collectSprintTokens(tokens, issue?.sprintName);
    collectSprintTokens(tokens, fields.sprintId);
    collectSprintTokens(tokens, fields.sprintName);
    collectSprintTokens(tokens, issue?.sprint);
    collectSprintTokens(tokens, fields.sprint);
    collectSprintTokens(tokens, fields.customfield_10101);

    return [...new Set(tokens)];
}

export function issueMatchesSelectedSprint(issue, { selectedSprint, selectedSprintName } = {}) {
    const tokens = getIssueSprintTokens(issue);
    if (!tokens.length) return false;

    const selectedId = String(selectedSprint || '').trim();
    if (selectedId && tokens.includes(selectedId)) return true;

    const normalizedSelectedName = String(selectedSprintName || '').trim().toLowerCase();
    if (!normalizedSelectedName) return false;

    return tokens.some((token) => {
        const normalizedToken = String(token || '').trim().toLowerCase();
        if (!normalizedToken) return false;
        return normalizedToken === normalizedSelectedName ||
            normalizedToken.includes(normalizedSelectedName) ||
            normalizedSelectedName.includes(normalizedToken);
    });
}

export function epicHasExplicitlyEmptySprintValue(epic) {
    const fields = epic?.fields || {};
    const hasExplicitSprintField =
        hasOwn(epic || {}, 'sprintId') ||
        hasOwn(epic || {}, 'sprintName') ||
        hasOwn(epic || {}, 'sprint') ||
        hasOwn(fields, 'sprintId') ||
        hasOwn(fields, 'sprintName') ||
        hasOwn(fields, 'sprint') ||
        hasOwn(fields, 'customfield_10101');

    if (!hasExplicitSprintField) return false;
    return getIssueSprintTokens(epic).length === 0;
}

export function filterExplicitBacklogEpics(epics) {
    return (epics || []).filter((epic) => epicHasExplicitlyEmptySprintValue(epic));
}

export function epicMatchesSelectedSprint(epic, { selectedSprint, selectedSprintName } = {}) {
    return issueMatchesSelectedSprint(epic, { selectedSprint, selectedSprintName });
}
