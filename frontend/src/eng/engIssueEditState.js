import { applyLocalEpicDetailsFieldUpdate, applyLocalIssueFieldUpdate } from './engIssueLocalUpdates.js';
import { sortTasksByPriority } from './engTaskUtils.js';

const ISSUE_ARRAY_KEYS = Object.freeze([
    'productTasks', 'techTasks', 'loadedProductTasks', 'loadedTechTasks',
    'readyToCloseProductTasks', 'readyToCloseTechTasks',
    'productEpicsInScope', 'techEpicsInScope',
    'readyToCloseProductEpicsInScope', 'readyToCloseTechEpicsInScope',
    'missingPlanningInfoTasks', 'missingInfoEpics',
    'backlogProductEpics', 'backlogTechEpics',
]);

const PLANNING_FIELDS = Object.freeze(['status', 'priority']);

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

export function patchEngIssueList(items, issueKey, field, value, expected) {
    return patchMissingFields(
        applyLocalIssueFieldUpdate(items, issueKey, normalizedStorageField(field), value, expected),
        issueKey, field, value,
    );
}

function patchSnapshot(snapshot, issueKey, field, value, expected) {
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
        const reconciled = patchEngIssueList(snapshot[key], issueKey, field, value, expected);
        if (reconciled !== snapshot[key]) next = { ...next, [key]: reconciled };
    });
    const epicDetails = applyLocalEpicDetailsFieldUpdate(snapshot.epicDetails, issueKey, storageField, value, expected);
    if (epicDetails !== snapshot.epicDetails) next = { ...next, epicDetails };

    if (field === 'storyPoints' || field === 'customfield_10004') {
        next = {
            ...next,
            dependencyData: {}, dependencyLookupCache: {}, excludedCapacityData: null,
        };
    } else if (field === 'team') {
        next = { ...next, dependencyData: {}, dependencyLookupCache: {}, excludedCapacityData: null };
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

export function patchEngLoadedState(state, groups, issueKey, field, value, expected) {
    const nextGroups = new Map();
    (groups instanceof Map ? groups : new Map()).forEach((snapshot, groupId) => {
        nextGroups.set(groupId, patchSnapshot(snapshot, issueKey, field, value, expected));
    });
    return { state: patchSnapshot(state, issueKey, field, value, expected), groups: nextGroups };
}

// Planning status/priority edits are tracked by a reservation registry inside the edit state (see
// createEngIssueEditState). Group caches must hold authoritative values, never an edit's optimistic
// display, so a snapshot is stripped back to each edit's base before it is cached and the overlay is
// re-applied when a cached snapshot is restored. Both act only where the snapshot still shows the
// value being replaced, so a newer read or a later edit is never overwritten.
const valueName = value => String(typeof value === 'string' ? value : value?.name || '').trim().toLowerCase();

// Swaps `from` for `to` only where a snapshot still shows `from`, skipping no-ops so an unchanged
// snapshot keeps its identity (and its memoized consumers).
function swapEntryValue(snapshot, entry, from, to) {
    return valueName(from) === valueName(to) ? snapshot : patchSnapshot(snapshot, entry.issueKey, entry.field, to, from);
}

const displayedValue = entry => (entry.phase === 'locked' ? entry.prior : entry.optimistic);

export function stripPendingOverlays(snapshot, entries) {
    return (entries || []).reduce((next, entry) => swapEntryValue(next, entry, displayedValue(entry), entry.base), snapshot);
}

export function overlaySnapshot(snapshot, entries) {
    return (entries || []).reduce((next, entry) => swapEntryValue(next, entry, entry.base, displayedValue(entry)), snapshot);
}

// While a Planning status/priority edit is pending its issue is SORTED and FILTERED by its original value
// (the display shows the new one), so nothing moves or leaves the list before Jira confirms. `originals` is
// the registry's planningOriginals(): upper-cased issue key -> { status?, priority? }.
export function projectPlanningOriginals(issues, originals) {
    if (!originals?.size || !Array.isArray(issues)) return issues;
    let touched = false;
    const projected = issues.map((issue) => {
        const original = originals.get(normalizedKey(issue?.key));
        if (!original) return issue;
        let out = issue;
        PLANNING_FIELDS.forEach((field) => { if (original[field] !== undefined) out = patchIssue(out, field, original[field]); });
        if (out !== issue) touched = true;
        return out;
    });
    return touched ? projected : issues;
}

// Maps a list produced from projected issues back onto the display issues (same keys, optimistic values).
export function restorePlanningDisplay(projected, display, originals) {
    if (!originals?.size || !Array.isArray(projected) || !Array.isArray(display)) return projected;
    const byKey = new Map(display.map(issue => [normalizedKey(issue?.key), issue]));
    return projected.map(issue => byKey.get(normalizedKey(issue?.key)) || issue);
}

// Re-sorts a lane that contains `issueKey` by priority, on a COPY, exactly as the loader sorts it, with every
// other still-pending issue counted at its original priority so one confirmation never moves another pending
// Story early (and a later rejection moves nothing). Lanes without the key, and unchanged order, keep identity.
export function sortLaneForSettledKey(lane, issueKey, originals, priorityOrder) {
    const key = normalizedKey(issueKey);
    if (!Array.isArray(lane) || !lane.some(issue => normalizedKey(issue?.key) === key)) return lane;
    const settled = originals?.size ? new Map([...originals].filter(([otherKey]) => otherKey !== key)) : originals;
    const view = projectPlanningOriginals(lane, settled);
    const sorted = restorePlanningDisplay(sortTasksByPriority([...view], priorityOrder), lane, settled);
    return sorted.every((issue, index) => issue === lane[index]) ? lane : sorted;
}

// Applies `sortLaneForSettledKey` to the sorted Product and Tech lanes of a snapshot (live state or a group cache).
export function reorderSettledSnapshot(snapshot, issueKey, originals, priorityOrder) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    return ['productTasks', 'techTasks'].reduce((next, name) => {
        const lane = sortLaneForSettledKey(snapshot[name], issueKey, originals, priorityOrder);
        return lane === snapshot[name] ? next : { ...next, [name]: lane };
    }, snapshot);
}

// One scope identity for every ENG mutation hook, so a response can be matched to the Department,
// Sprint and surface it was started in.
export function buildMutationScopeKey({ boardScopeType, boardScopeSprintId, selectedSprint, activeGroupId, sourceSurface } = {}) {
    return `${boardScopeType || ''}|${boardScopeSprintId || selectedSprint || ''}|${activeGroupId || ''}|${sourceSurface || ''}`;
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
        for (const field of ['assignee', 'deliveryOwner', 'storyPoints', 'summary', 'team', ...PLANNING_FIELDS]) {
            const key = observationKey(issue?.key, field);
            const latest = observations.get(key);
            if (latest && latest.version > (token?.version || 0)) {
                next = patchIssue(next, field, latest.value);
            } else if (token && issue?.key && field !== 'summary' && field !== 'team' && !PLANNING_FIELDS.includes(field)) {
                // These new fields can have endpoint-specific projections.
                // Only confirmed edits may override another in-flight read.
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
    // The status/priority part of `reconcileIssues` alone, for reads that must not record other fields as observations
    // (readiness epics): a confirmed edit newer than the read's start replaces the read's value.
    const reconcilePlanningFields = (issues, token) => (Array.isArray(issues) ? issues : []).map(issue => PLANNING_FIELDS.reduce((next, field) => {
        const latest = observations.get(observationKey(issue?.key, field));
        return latest && latest.version > (token?.version || 0) ? patchIssue(next, field, latest.value) : next;
    }, issue));
    // Planning registry. Reservations are NON-BUMPING: unlike beginMutation/confirmMutation/markUnknown
    // they never advance `generation`, because that would invalidate in-flight aggregate reads and
    // make the dependency fetch reload on every edit.
    const planning = new Map();
    // key -> clock of the last settled (confirmed or unconfirmed) write that no committed read has evidenced yet.
    const unevidencedWrites = new Map();
    const planningListeners = new Set();
    let planningRevision = 0;
    let projectionCache = { revision: -1, value: new Map() };
    const planningKey = (issueKey, field) => `${normalizedKey(issueKey)}::${field}`;
    const planningChanged = () => {
        planningRevision += 1;
        planningListeners.forEach(listener => listener(planningRevision));
    };
    const rawFieldValue = (issue, field) => (issue?.fields && typeof issue.fields === 'object' ? issue.fields[field] : issue?.[field]);
    const entryFor = token => {
        const entry = planning.get(planningKey(token?.issueKey, token?.field));
        return entry && entry.token === token ? entry : null;
    };

    // Reserves one issue/field for an edit. Returns a token, or null when that issue/field is already
    // pending, locked (unconfirmed) or abandoned, so a second action can never start from a stale base.
    const reservePlanningEdit = ({ issueKey, field, prior, optimistic, scope = '' } = {}) => {
        if (!PLANNING_FIELDS.includes(field) || !normalizedKey(issueKey)) return null;
        const key = planningKey(issueKey, field);
        if (planning.has(key)) return null;
        const token = { id: ++clock, issueKey: normalizedKey(issueKey), field, scope };
        planning.set(key, {
            token, issueKey: token.issueKey, field, prior, optimistic, base: prior, baseReadVersion: token.id, phase: 'pending', scope,
        });
        planningChanged();
        return token;
    };
    const planningPhase = (issueKey, field) => planning.get(planningKey(issueKey, field))?.phase || null;
    const settlePlanningConfirmed = (token, value) => {
        if (!entryFor(token)) return false;
        planning.delete(planningKey(token.issueKey, token.field));
        observations.set(observationKey(token.issueKey, token.field), {
            issueKey: token.issueKey, field: token.field, value, version: ++clock,
        });
        unevidencedWrites.set(planningKey(token.issueKey, token.field), clock);
        planningChanged();
        return true;
    };
    // Returns what the display must settle to: the base (the latest raw read value, initially the
    // captured prior) and the optimistic value the caller guards its patch with.
    const settlePlanningRejected = token => {
        const entry = entryFor(token);
        if (!entry) return null;
        planning.delete(planningKey(token.issueKey, token.field));
        planningChanged();
        return { base: entry.base, optimistic: entry.optimistic, prior: entry.prior };
    };
    const settlePlanningUnconfirmed = token => {
        const entry = entryFor(token);
        if (!entry) return false;
        entry.phase = 'locked';
        unevidencedWrites.set(planningKey(token.issueKey, token.field), ++clock);
        planningChanged();
        return true;
    };
    // already_in_* comes from an eventually consistent Jira search snapshot, so it is trustworthy only
    // when no write of this issue/field has happened since the last committed read that carried it.
    const hasUnevidencedPlanningWrite = (issueKey, field) => unevidencedWrites.has(planningKey(issueKey, field));
    // Call once per COMMITTED raw read: a read that started after a write is evidence for it.
    const notePlanningRawRead = (issues, readToken) => {
        if (!unevidencedWrites.size || !readToken?.version) return;
        (Array.isArray(issues) ? issues : []).forEach((issue) => {
            PLANNING_FIELDS.forEach((field) => {
                const key = planningKey(issue?.key, field);
                if (unevidencedWrites.has(key) && readToken.version > unevidencedWrites.get(key) && rawFieldValue(issue, field) !== undefined) {
                    unevidencedWrites.delete(key);
                }
            });
        });
    };
    // A terminal 401 abandons every outcome: no rollback, no lock, no cache write. The entry stays so the
    // original-value projection (and therefore the selection) stays frozen until the page navigates.
    const abandonPlanningEdit = token => {
        const entry = entryFor(token);
        if (!entry) return false;
        entry.phase = 'abandoned';
        planningChanged();
        return true;
    };
    // Called once per raw read, before any overlay or sort: the first read STARTED after the
    // reservation (and after the previous base capture) supplies the base, so an older read that
    // finishes late can never regress it and an overlaid array is never mistaken for raw data.
    const capturePlanningBases = (issues, readToken) => {
        if (!planning.size || !readToken?.version) return;
        (Array.isArray(issues) ? issues : []).forEach((issue) => {
            PLANNING_FIELDS.forEach((field) => {
                const entry = planning.get(planningKey(issue?.key, field));
                if (!entry || readToken.version <= entry.baseReadVersion) return;
                const raw = rawFieldValue(issue, field);
                if (raw === undefined) return;
                entry.base = raw;
                entry.baseReadVersion = readToken.version;
            });
        });
    };
    // Puts every pending edit's optimistic value (and every lock's provisional prior) back on top of a
    // freshly read list, so a read that resolves while an edit is queued or saving cannot erase it.
    const overlayPlanningIssues = (issues) => {
        if (!planning.size || !Array.isArray(issues)) return issues;
        let touched = false;
        const next = issues.map((issue) => {
            let out = issue;
            PLANNING_FIELDS.forEach((field) => {
                const entry = planning.get(planningKey(issue?.key, field));
                if (entry) out = patchIssue(out, field, entry.phase === 'locked' ? entry.prior : entry.optimistic);
            });
            if (out !== issue) touched = true;
            return out;
        });
        return touched ? next : issues;
    };
    // Raw-result evidence for lock release: the issue/field keys of locked entries that this raw
    // result actually carries. A projected array or a cache hit is not evidence.
    const planningEvidence = (issues) => {
        const evidence = new Set();
        (Array.isArray(issues) ? issues : []).forEach((issue) => {
            PLANNING_FIELDS.forEach((field) => {
                const key = planningKey(issue?.key, field);
                if (planning.get(key)?.phase === 'locked' && rawFieldValue(issue, field) !== undefined) evidence.add(key);
            });
        });
        return evidence;
    };
    const releasePlanningLocks = ({ scope, evidence } = {}) => {
        const released = [];
        planning.forEach((entry, key) => {
            if (entry.phase !== 'locked' || entry.scope !== scope || !evidence?.has(key)) return;
            planning.delete(key);
            released.push({ issueKey: entry.issueKey, field: entry.field });
        });
        if (released.length) planningChanged();
        return released;
    };
    // The original (pre-edit) status/priority of every issue with an open edit, used to sort and filter
    // while the edit is pending. Stable between changes so it can feed memo dependencies.
    const planningOriginals = () => {
        if (projectionCache.revision === planningRevision) return projectionCache.value;
        const originals = new Map();
        planning.forEach((entry) => {
            originals.set(entry.issueKey, { ...(originals.get(entry.issueKey) || {}), [entry.field]: entry.prior });
        });
        projectionCache = { revision: planningRevision, value: originals };
        return originals;
    };
    const planningEntries = () => Array.from(planning.values(), entry => ({
        issueKey: entry.issueKey, field: entry.field, prior: entry.prior, optimistic: entry.optimistic,
        base: entry.base, phase: entry.phase, scope: entry.scope,
    }));
    const subscribePlanning = (listener) => {
        planningListeners.add(listener);
        return () => planningListeners.delete(listener);
    };

    const reconcileSnapshot = snapshot => {
        let next = snapshot;
        observations.forEach(entry => {
            next = patchSnapshot(next, entry.issueKey, entry.field, entry.value);
        });
        return next;
    };

    return {
        beginRead, finishRead, beginMutation, confirmMutation, markUnknown, reconcileIssues, reconcilePlanningFields,
        reconcileSnapshot,
        reservePlanningEdit, planningPhase, settlePlanningConfirmed, settlePlanningRejected, settlePlanningUnconfirmed,
        abandonPlanningEdit, capturePlanningBases, overlayPlanningIssues, planningEvidence, releasePlanningLocks,
        hasUnevidencedPlanningWrite, notePlanningRawRead,
        planningOriginals, planningEntries, subscribePlanning, planningRevision: () => planningRevision,
        setInvalidationHandler: handler => { invalidationHandler = typeof handler === 'function' ? handler : null; },
        isCurrentAggregateRead: token => Boolean(token && token.generation === generation),
        activeReadCount: () => readers.size,
    };
}
