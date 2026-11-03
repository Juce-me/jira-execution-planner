// Pure helpers for the private quarter selection and the immutable work-configuration context.
//
// A viewed quarter is UI intent (`selectedQuarter`); the configuration that answers for it is resolved
// from the saved ranges; a physical Jira Sprint is admitted afterwards, from that configuration's
// catalog, and may be absent. No helper here ever turns a quarter into a Sprint id.

export const MODEL_LEGACY = 'legacy';

const QUARTER = /^([0-9]{4})Q([1-4])$/;
const QUARTER_IN_NAME = /(?<![0-9A-Za-z])([0-9]{4}Q[1-4])(?![0-9A-Za-z])/;

export function parseQuarter(value) {
    if (typeof value !== 'string') return null;
    const match = QUARTER.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    if (year < 1) return null;
    const quarter = Number(match[2]);
    return { year, quarter, index: year * 4 + quarter - 1 };
}

// Canonical form is the exact string `YYYYQn`; whitespace, lowercase and year 0000 are never repaired.
export const canonicalQuarter = value => (parseQuarter(value) ? value : null);
export const quarterIndex = value => parseQuarter(value)?.index ?? null;

export function quarterFromIndex(index) {
    if (!Number.isInteger(index)) return null;
    const year = Math.floor(index / 4);
    if (year < 1 || year > 9999) return null;
    return `${String(year).padStart(4, '0')}Q${(index % 4) + 1}`;
}

export const nextQuarter = value => {
    const index = quarterIndex(value);
    return index === null ? null : quarterFromIndex(index + 1);
};

export function calendarQuarter(date = new Date()) {
    return `${String(date.getFullYear()).padStart(4, '0')}Q${Math.ceil((date.getMonth() + 1) / 3)}`;
}

// The quarter a Jira Sprint name carries, e.g. `2026Q4` or `2026Q4 Sprint 3`; null when it names none.
export function quarterFromSprintName(name) {
    const match = QUARTER_IN_NAME.exec(String(name ?? ''));
    return match ? canonicalQuarter(match[1]) : null;
}

export function quarterInRange(quarter, range) {
    const index = quarterIndex(quarter);
    if (index === null) return false;
    const from = quarterIndex(range?.fromQuarter);
    const through = quarterIndex(range?.throughQuarter);
    return (from === null || index >= from) && (through === null || index <= through);
}

// Legacy is consulted first so an overlapping saved range can never move a Legacy quarter to another era.
export function configurationForQuarter(summaries, quarter) {
    if (!canonicalQuarter(quarter) || !Array.isArray(summaries)) return null;
    const ordered = [
        ...summaries.filter(summary => summary?.model === MODEL_LEGACY),
        ...summaries.filter(summary => summary?.model !== MODEL_LEGACY),
    ];
    return ordered.find(summary => summary?.id && quarterInRange(quarter, summary)) || null;
}

// The immutable stamp every scoped request carries and every late completion is compared against.
export function buildConfigurationContext(summary, quarter) {
    const canonical = canonicalQuarter(quarter);
    if (!summary?.id || !canonical) return null;
    const revision = Number.isInteger(summary.revision) ? summary.revision : null;
    if (revision === null) return null;
    return Object.freeze({
        id: String(summary.id),
        revision,
        quarter: canonical,
        digest: typeof summary.digest === 'string' && summary.digest ? summary.digest : null,
        fromQuarter: canonicalQuarter(summary.fromQuarter),
        throughQuarter: canonicalQuarter(summary.throughQuarter),
    });
}

// Catalog reads answer per configuration; the quarter only selects it.
export const catalogContextKey = context => (context
    ? `${context.id}|${context.revision}|${context.digest || ''}` : '');
export const contextKey = context => (context ? `${catalogContextKey(context)}|${context.quarter}` : '');
export const sameContext = (left, right) => contextKey(left) === contextKey(right);
export const sameCatalogContext = (left, right) => catalogContextKey(left) === catalogContextKey(right);

export function contextSelector(context) {
    if (!context) return {};
    const selector = { configurationId: context.id, configurationRevision: String(context.revision), quarter: context.quarter };
    if (context.digest) selector.configurationDigest = context.digest;
    return selector;
}

// `includeDigest: false` is for routes whose strict query allowlist has no `configurationDigest` (the ENG Board stream).
export function applyContextToParams(params, context, { includeQuarter = true, includeDigest = true } = {}) {
    if (!context) return params;
    const selector = contextSelector(context);
    for (const [key, value] of Object.entries(selector)) {
        if (key === 'quarter' && !includeQuarter) continue;
        if (key === 'configurationDigest' && !includeDigest) continue;
        params.set(key, String(value));
    }
    return params;
}

// The nested stamp the own-key write routes take in their JSON body: `configuration: {id, revision, quarter, digest}`.
// `digest` is always present (null when the summary carries none); the revision is an integer, never a string.
export function writeStampOf(context) {
    if (!context) return null;
    return { id: context.id, revision: context.revision, quarter: context.quarter, digest: context.digest || null };
}

export const contextBody = context => (context ? contextSelector(context) : {});

// A response may carry the context it answered for; it is accepted only when it matches the current one.
export function responseMatchesContext(current, answered) {
    if (!current || !answered || typeof answered !== 'object') return true;
    const id = answered.configurationId ?? answered.id;
    const revision = answered.configurationRevision ?? answered.revision;
    if (id !== undefined && String(id) !== current.id) return false;
    if (revision !== undefined && Number(revision) !== current.revision) return false;
    if (answered.digest !== undefined && answered.digest !== null && current.digest && answered.digest !== current.digest) return false;
    return true;
}

export const isMissingMappings = (missingByConfiguration, configurationId) => {
    const missing = missingByConfiguration?.[configurationId];
    return Array.isArray(missing) ? missing.length > 0 : Boolean(missing && Object.keys(missing).length);
};

// Quarters offered by the Sprint dropdown: observed names, the private quarter, the current/next calendar
// quarter and each finite saved boundary. The open range is never enumerated.
export function quarterCandidates({ observed = [], privateQuarter = null, now = new Date(), summaries = [] } = {}) {
    const set = new Set();
    const add = value => { const quarter = canonicalQuarter(value); if (quarter) set.add(quarter); };
    observed.forEach(add);
    add(privateQuarter);
    const current = calendarQuarter(now);
    add(current);
    add(nextQuarter(current));
    for (const summary of summaries || []) { add(summary?.fromQuarter); add(summary?.throughQuarter); }
    return [...set].sort((left, right) => quarterIndex(left) - quarterIndex(right));
}

export const unavailableQuarterLabel = (quarter, availability) => (availability === 'setup_required'
    ? `${quarter} — setup required`
    : availability === 'not_observed' ? `${quarter} — not observed` : quarter);

// What the viewed quarter can currently show: the configuration, its setup state and the admitted Sprint.
export function resolveQuarterAdmission({ quarter, summaries, missingByConfiguration, sprints, catalogSettled, retainedSprintId = null }) {
    const canonical = canonicalQuarter(quarter);
    if (!canonical) return { quarter: null, configuration: null, sprint: null, status: 'no_quarter' };
    const configuration = configurationForQuarter(summaries, canonical);
    if (!configuration) return { quarter: canonical, configuration: null, sprint: null, status: 'no_configuration' };
    if (isMissingMappings(missingByConfiguration, configuration.id)) {
        return { quarter: canonical, configuration, sprint: null, status: 'setup_required' };
    }
    const inQuarter = (Array.isArray(sprints) ? sprints : []).filter(sprint => quarterFromSprintName(sprint?.name) === canonical);
    const retained = retainedSprintId == null ? null : inQuarter.find(sprint => String(sprint.id) === String(retainedSprintId));
    const sprint = retained
        || inQuarter.find(candidate => String(candidate.state || '').toLowerCase() === 'active')
        || inQuarter[inQuarter.length - 1] || null;
    if (sprint) return { quarter: canonical, configuration, sprint, status: 'admitted' };
    return { quarter: canonical, configuration, sprint: null, status: catalogSettled ? 'not_observed' : 'pending' };
}

// Where a quarter's own catalog stands, for the dropdown label. `unknown` until that configuration's
// catalog has been read in this session, so a quarter is never called unobserved before anyone looked.
export function quarterAvailability({ quarter, summaries, missingByConfiguration, observedByCatalog, currentContext, currentCatalogSettled }) {
    const configuration = configurationForQuarter(summaries, quarter);
    if (!configuration) return null;
    if (isMissingMappings(missingByConfiguration, configuration.id)) return 'setup_required';
    const key = catalogContextKey(buildConfigurationContext(configuration, quarter));
    if (observedByCatalog?.[key]?.includes(quarter)) return 'unknown';
    const settled = currentContext && catalogContextKey(currentContext) === key && currentCatalogSettled;
    return settled || observedByCatalog?.[key] ? 'not_observed' : 'unknown';
}

// Dropdown rows for quarters the current catalog has no Sprint for. Rows carry a quarter, never an id.
export function quarterOptionRows({
    search = '', rawSearch = '', activeQuarter = null, selectedSprint = null, sprints = [], summaries = [],
    missingByConfiguration = {}, observedByCatalog = {}, currentContext = null, currentCatalogSettled = false, now = new Date(),
    quarterStates = {}, includeUnobserved = true,
}) {
    const inCatalog = new Set(sprints.map(sprint => quarterFromSprintName(sprint.name)).filter(Boolean));
    const exact = canonicalQuarter(rawSearch.trim());
    const quarters = new Set([
        ...quarterCandidates({ observed: [...Object.values(observedByCatalog).flat(), ...Object.keys(quarterStates)], privateQuarter: activeQuarter, summaries, now }),
        ...(exact ? [exact] : []),
    ]);
    const observed = new Set([...Object.values(observedByCatalog).flat(), ...Object.keys(quarterStates)]);
    return [...quarters].filter(quarter => !inCatalog.has(quarter) && (includeUnobserved || observed.has(quarter))).flatMap((quarter) => {
        const availability = quarterAvailability({ quarter, summaries, missingByConfiguration, observedByCatalog, currentContext, currentCatalogSettled });
        if (!availability) return [];
        const label = unavailableQuarterLabel(quarter, availability);
        if (search && !label.toLowerCase().includes(search)) return [];
        return [{ kind: 'quarter', quarter, availability, label, state: quarterStates[quarter] || '', selected: selectedSprint === null && quarter === activeQuarter }];
    });
}

// Sprint and placeholder-quarter rows read as one newest-first list, whichever configuration supplied them; scope rows stay first.
export function sortSprintOptionRows(options) {
    const key = option => (option.kind === 'sprint' ? (quarterFromSprintName(option.sprint.name) || option.label) : option.quarter);
    const rows = options.filter(option => option.kind !== 'scope').sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
    return [...options.filter(option => option.kind === 'scope'), ...rows];
}
