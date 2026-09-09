import { applyLocalEpicDetailsFieldUpdate, applyLocalIssueFieldUpdate } from './engIssueLocalUpdates.js';

const ISSUE_ARRAY_KEYS = Object.freeze([
    'productTasks', 'techTasks', 'loadedProductTasks', 'loadedTechTasks',
    'readyToCloseProductTasks', 'readyToCloseTechTasks',
    'productEpicsInScope', 'techEpicsInScope',
    'readyToCloseProductEpicsInScope', 'readyToCloseTechEpicsInScope',
    'missingPlanningInfoTasks', 'missingInfoEpics',
    'backlogProductEpics', 'backlogTechEpics',
]);

function normalizedKey(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizedStorageField(field) {
    if (field === 'storyPoints') return 'customfield_10004';
    return field;
}

function patchMissingFields(items, issueKey, field, value) {
    if (!Array.isArray(items) || value === null || value === undefined) return items;
    const missingName = field === 'storyPoints' ? 'Story Points' : field === 'assignee' ? 'Assignee' : '';
    if (!missingName) return items;
    let changed = false;
    const result = items.map(item => {
        if (normalizedKey(item?.key) !== normalizedKey(issueKey)) return item;
        const nested = Array.isArray(item?.fields?.missingFields);
        const current = nested ? item.fields.missingFields : item?.missingFields;
        if (!Array.isArray(current)) return item;
        const missingFields = current.filter(name => name !== missingName);
        if (missingFields.length === current.length) return item;
        changed = true;
        return nested ? { ...item, fields: { ...item.fields, missingFields } } : { ...item, missingFields };
    }).filter(item => {
        const missingFields = Array.isArray(item?.fields?.missingFields) ? item.fields.missingFields : item?.missingFields;
        return !Array.isArray(missingFields) || missingFields.length > 0;
    });
    return changed ? result : items;
}

export function patchEngIssueList(items, issueKey, field, value) {
    return patchMissingFields(
        applyLocalIssueFieldUpdate(items, issueKey, normalizedStorageField(field), value),
        issueKey, field, value,
    );
}

function patchSnapshot(snapshot, issueKey, field, value) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const key = normalizedKey(issueKey);
    const containsIssue = ISSUE_ARRAY_KEYS.some(name => (
        Array.isArray(snapshot[name]) && snapshot[name].some(item => normalizedKey(item?.key) === key)
    )) || Object.keys(snapshot.epicDetails || {}).some(candidate => normalizedKey(candidate) === key)
        || Object.entries(snapshot.dependencyLookupCache || {}).some(([candidate, issue]) => normalizedKey(candidate) === key || normalizedKey(issue?.key) === key)
        || Object.entries(snapshot.dependencyData || {}).some(([candidate, entries]) => normalizedKey(candidate) === key || (Array.isArray(entries) && entries.some(entry => [entry?.key, entry?.dependentKey].some(value => normalizedKey(value) === key))))
        || (snapshot.excludedCapacityData?.issues || []).some(issue => normalizedKey(issue?.key) === key);
    if (!containsIssue) return snapshot;
    const storageField = normalizedStorageField(field);
    let next = snapshot;
    ISSUE_ARRAY_KEYS.forEach(key => {
        if (!Array.isArray(snapshot[key])) return;
        const reconciled = patchEngIssueList(snapshot[key], issueKey, field, value);
        if (reconciled !== snapshot[key]) next = { ...next, [key]: reconciled };
    });
    const epicDetails = applyLocalEpicDetailsFieldUpdate(snapshot.epicDetails, issueKey, storageField, value);
    if (epicDetails !== snapshot.epicDetails) next = { ...next, epicDetails };

    if (field === 'storyPoints' || field === 'customfield_10004') {
        next = {
            ...next,
            dependencyData: {}, dependencyLookupCache: {}, excludedCapacityData: null,
        };
    } else if (field === 'assignee') {
        next = {
            ...next,
            burnoutData: null, cohortData: null, excludedCapacityData: null,
        };
    }
    return next;
}

function patchIssue(issue, field, value) {
    if (field === 'storyPoints' && !issue?.fields && Object.prototype.hasOwnProperty.call(issue || {}, 'storyPoints')) {
        return { ...issue, storyPoints: value };
    }
    return applyLocalIssueFieldUpdate([issue], issue?.key, normalizedStorageField(field), value)[0];
}

export function patchEngLoadedState(state, groups, issueKey, field, value) {
    const nextGroups = new Map();
    (groups instanceof Map ? groups : new Map()).forEach((snapshot, groupId) => {
        nextGroups.set(groupId, patchSnapshot(snapshot, issueKey, field, value));
    });
    return { state: patchSnapshot(state, issueKey, field, value), groups: nextGroups };
}

export function createEngIssueEditState(options = {}) {
    let clock = 0;
    let generation = 0;
    let invalidationHandler = typeof options.onInvalidate === 'function' ? options.onInvalidate : null;
    const readers = new Map();
    const observations = new Map();

    const observationKey = (issueKey, field) => `${normalizedKey(issueKey)}::${field}`;
    const prune = () => {
        const oldestReaderVersion = Math.min(...Array.from(readers.values(), token => token.version), Infinity);
        observations.forEach((entry, key) => {
            if (oldestReaderVersion >= entry.version) observations.delete(key);
        });
    };

    const beginRead = (options = {}) => {
        const token = { id: ++clock, version: clock, generation, aggregate: options.aggregate === true };
        readers.set(token.id, token);
        return token;
    };
    const finishRead = token => {
        if (token?.id) readers.delete(token.id);
        prune();
    };
    const beginMutation = (issueKey, field, mappingRevision) => ({
        issueKey: normalizedKey(issueKey), field, mappingRevision, generation: ++generation, unknown: false,
    });
    const confirmMutation = (mutation, value, options = {}) => {
        if (!mutation?.issueKey || !mutation.field) return false;
        const revision = options.mappingRevision === undefined ? mutation.mappingRevision : options.mappingRevision;
        if (mutation.unknown && (!revision || revision !== mutation.mappingRevision)) return false;
        observations.set(observationKey(mutation.issueKey, mutation.field), {
            issueKey: mutation.issueKey, field: mutation.field, value, version: ++clock,
        });
        generation += 1;
        mutation.unknown = false;
        return true;
    };
    const markUnknown = mutation => {
        if (!mutation) return;
        mutation.unknown = true;
        generation += 1;
        invalidationHandler?.({ issueKey: mutation.issueKey, field: mutation.field, outcome: 'unknown' });
    };
    const reconcileIssues = (issues, token) => (Array.isArray(issues) ? issues : []).map(issue => {
        let next = issue;
        for (const field of ['assignee', 'deliveryOwner', 'storyPoints']) {
            const key = observationKey(issue?.key, field);
            const latest = observations.get(key);
            if (latest && latest.version > (token?.version || 0)) {
                next = patchIssue(next, field, latest.value);
            } else if (token && issue?.key) {
                const storageField = normalizedStorageField(field);
                const isTaskField = issue.fields && Object.prototype.hasOwnProperty.call(issue.fields, storageField);
                const isFlatStoryPoints = field === 'storyPoints' && !issue.fields && Object.prototype.hasOwnProperty.call(issue, 'storyPoints');
                const isEpicField = !issue.fields && Object.prototype.hasOwnProperty.call(issue, storageField);
                if (isTaskField || isFlatStoryPoints || isEpicField) {
                    const value = isTaskField ? issue.fields[storageField] : isFlatStoryPoints ? issue.storyPoints : issue[storageField];
                    observations.set(key, { issueKey: normalizedKey(issue.key), field, value, version: ++clock });
                }
            }
        }
        return next;
    });
    const reconcileSnapshot = snapshot => {
        let next = snapshot;
        observations.forEach(entry => {
            next = patchSnapshot(next, entry.issueKey, entry.field, entry.value);
        });
        return next;
    };

    return {
        beginRead, finishRead, beginMutation, confirmMutation, markUnknown, reconcileIssues,
        reconcileSnapshot,
        setInvalidationHandler: handler => { invalidationHandler = typeof handler === 'function' ? handler : null; },
        isCurrentAggregateRead: token => Boolean(token && token.generation === generation),
        activeReadCount: () => readers.size,
    };
}
