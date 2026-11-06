const validId = value => typeof value === 'string' && value.length <= 128 && /^[1-9][0-9]*$/.test(value);
const validRevision = value => Number.isInteger(value) && value >= 0 && value <= 2147483646;

function readEntries(entries, { allowUnstoredIncluded = false } = {}) {
    if (!Array.isArray(entries)) throw new TypeError('Invalid plan entries.');
    const result = new Map();
    for (const entry of entries) {
        if (!entry || !validId(entry.issueId) || typeof entry.included !== 'boolean' || !validRevision(entry.revision) || (!allowUnstoredIncluded && entry.included && entry.revision === 0) || result.has(entry.issueId)) {
            throw new TypeError('Invalid plan entry.');
        }
        result.set(entry.issueId, { issueId: entry.issueId, included: entry.included, revision: entry.revision });
    }
    return result;
}

// Scope/authorization and parent-to-child expansion belong to the review controller.
// This owner accepts only immutable numeric child IDs, never issue keys or row objects.
export function createPlanningInclusionDraft({ entries = [], historyLimit = 20, planExists = true } = {}) {
    if (!Number.isInteger(historyLimit) || historyLimit < 0 || historyLimit > 20 || typeof planExists !== 'boolean') {
        throw new TypeError('Invalid plan draft options.');
    }
    let baseline = readEntries(entries);
    let desired = new Map();
    let history = [];
    let sequence = 0;
    let initializationPending = false;
    const saved = id => baseline.get(id) || { issueId: id, included: false, revision: 0 };
    const effective = id => desired.has(id) ? desired.get(id) : saved(id).included;
    const setDesired = (id, included) => {
        if (included === saved(id).included) desired.delete(id);
        else desired.set(id, included);
    };
    const changes = () => [...desired].map(([issueId, included]) => ({ issueId, included, baseRevision: saved(issueId).revision }));

    return {
        get effectiveEntries() {
            const result = new Map([...baseline].map(([id, entry]) => [id, { ...entry }]));
            for (const [id, included] of desired) result.set(id, { ...saved(id), included });
            return result;
        },
        get dirtyChanges() { return new Map(changes().map(change => [change.issueId, change])); },
        get actionSequence() { return sequence; },
        get initializationPending() { return initializationPending; },
        get dirty() { return initializationPending || desired.size > 0; },
        get canUndo() { return history.length > 0; },
        apply(ids, included) {
            if (!Array.isArray(ids) || [...ids].some(id => !validId(id)) || typeof included !== 'boolean') {
                throw new TypeError('Invalid inclusion gesture.');
            }
            const before = new Map([...new Set(ids)].filter(id => effective(id) !== included).map(id => [id, effective(id)]));
            if (!before.size) return;
            const gesture = { sequence: ++sequence, before, initializationBefore: initializationPending };
            if (!planExists) initializationPending = true;
            for (const id of before.keys()) setDesired(id, included);
            history.push(gesture);
            if (history.length > historyLimit) history.shift();
        },
        undo() {
            const gesture = history.pop();
            if (!gesture) return false;
            for (const [id, included] of gesture.before) setDesired(id, included);
            initializationPending = !planExists && gesture.initializationBefore;
            sequence++;
            return true;
        },
        snapshot() {
            return Object.freeze({
                sequence,
                initializePlan: initializationPending,
                changes: Object.freeze(changes().sort((a, b) => a.issueId.localeCompare(b.issueId)).map(change => Object.freeze(change))),
            });
        },
        confirm(snapshot, entries) {
            // Recovery may reconstruct this snapshot in a new document. The controller
            // owns scope/generation validation; validate its data before any mutation.
            if (!snapshot || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 ||
                typeof snapshot.initializePlan !== 'boolean' || !Array.isArray(snapshot.changes) ||
                (!planExists && !snapshot.initializePlan)) throw new TypeError('Invalid plan submission.');
            const submitted = readEntries(snapshot.changes.map(change => ({
                issueId: change?.issueId, included: change?.included, revision: change?.baseRevision,
            })), { allowUnstoredIncluded: true });
            const acknowledged = readEntries(entries);
            if (acknowledged.size !== submitted.size || [...submitted].some(([id, change]) => {
                const entry = acknowledged.get(id);
                return !entry || entry.included !== change.included || entry.revision < change.revision || entry.revision < saved(id).revision;
            })) throw new TypeError('Incomplete plan acknowledgement.');
            const current = new Map([...submitted.keys()].map(id => [id, effective(id)]));
            for (const [id, entry] of acknowledged) baseline.set(id, entry);
            for (const [id, included] of current) setDesired(id, included);
            planExists = true;
            initializationPending = false;
            history = history.filter(gesture => gesture.sequence > snapshot.sequence);
        },
        discard(entries, options = {}) {
            const nextExists = options.planExists === undefined ? planExists : options.planExists;
            if (typeof nextExists !== 'boolean') throw new TypeError('Invalid plan existence.');
            const next = readEntries(entries);
            baseline = next;
            planExists = nextExists;
            desired = new Map();
            history = [];
            initializationPending = false;
        },
        restore(changes, { initializePlan = false, sequence: restoredSequence = 0 } = {}) {
            if (!Array.isArray(changes) || typeof initializePlan !== 'boolean' || !Number.isSafeInteger(restoredSequence) || restoredSequence < 0) throw new TypeError('Invalid recovered plan draft.');
            const restored = readEntries(changes.map(change => ({ issueId: change.issueId, included: change.included, revision: change.baseRevision })), { allowUnstoredIncluded: true });
            if ([...restored].some(([id, entry]) => entry.revision !== saved(id).revision || entry.included === saved(id).included)) throw new TypeError('Invalid recovered plan baseline.');
            desired = new Map([...restored].map(([id, entry]) => [id, entry.included]));
            history = [];
            sequence = restoredSequence;
            initializationPending = !planExists && initializePlan;
        },
    };
}
