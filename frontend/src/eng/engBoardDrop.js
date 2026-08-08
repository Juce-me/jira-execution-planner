// Resolving a card drop (§6.4, D37, D42). Pure: no React, no DOM, no fetching — EngBoardView.jsx
// owns the gesture and the menu, and this module owns every rule that can be stated without one,
// so the whole 0/1/many resolution and the unresolved-story gate are unit-testable without a drag.
//
// Dragging a card is a second TRIGGER for the status transition the app already performs, never a
// second way of performing it (§9.5): nothing here calls Jira, patches state or decides how to
// refresh. It answers two questions and stops — "which status does this drop mean?" and "does that
// status need confirming?".

// §5.5's Done column, and the `done` statusCategory in the general case (D42). The three names are
// what the reference configuration ships; the category arm is what makes the rule general, for a
// board whose resolution status is called something else.
const RESOLVED_STATUS_NAMES = ['Done', 'Killed', 'Incomplete'];

const RESOLVED_STATUS_KEYS = new Set(RESOLVED_STATUS_NAMES.map((name) => name.toLowerCase()));

function normalizeStatus(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

function statusName(status) {
    if (!status) return '';
    return typeof status === 'string' ? status : String(status.name || '');
}

// `status` is either a plain name (all the board has at drop time — the transition-options
// endpoint returns names only) or a catalog row `{ name, statusCategoryKey }` from the issue
// transition status catalog (api/jiraIssueApi.js), which is where the general case comes from.
export function isResolvedStatus(status) {
    if (!status) return false;
    if (typeof status !== 'string' && normalizeStatus(status.statusCategoryKey) === 'done') return true;
    return RESOLVED_STATUS_KEYS.has(normalizeStatus(statusName(status)));
}

// Turns the issue transition status catalog (rows of `{ id, name, statusCategoryKey }`) into a lookup the
// gate can use. Without it `isResolvedStatus`'s category arm is unreachable in the running app:
// `board.columns[].statuses` stores NAMES, and the transition-options response returns names too,
// so every status that reaches the gate is a bare string and a `done`-category status called
// anything but the three literal names would move silently past it.
export function buildStatusCategoryIndex(statuses) {
    const index = {};
    (Array.isArray(statuses) ? statuses : []).forEach((status) => {
        const name = String((status && status.name) || '').trim();
        if (!name) return;
        index[name.toLowerCase()] = String((status && status.statusCategoryKey) || '');
    });
    return index;
}

// The exact object the board hands `needsOpenStoryConfirmation`: the status name it is about to
// transition to, paired with that status's category. A name the catalog does not know (or a
// catalog that failed to load) carries no category, so the three literal names still decide —
// the gate degrades to its old behaviour rather than failing open on everything.
export function describeStatus(name, statusCategoryIndex) {
    const key = String(name == null ? '' : name).trim().toLowerCase();
    return { name, statusCategoryKey: (statusCategoryIndex || {})[key] || '' };
}

// The data is already on the card (§6.2's story-progress bar), so noticing this costs no request.
export function openStoryCount(progress) {
    const total = Number(progress && progress.total) || 0;
    const done = Number(progress && progress.done) || 0;
    return Math.max(0, total - done);
}

// D42's whole table in one predicate: not resolved -> move; resolved and everything done -> move;
// resolved with open stories -> ask once. It warns, it never blocks — the caller may proceed.
export function needsOpenStoryConfirmation({ status, progress } = {}) {
    return isResolvedStatus(status) && openStoryCount(progress) > 0;
}

// The status names Jira offers for this issue right now, read from the issue transition-options
// response (backend load_transition_options, fetched by the shared useEngStatusTransitions hook).
// The aggregated `targetStatuses` is the contract; the per-issue `transitions[]` fallback mirrors
// the same defensive read StatusTransitionMenu.jsx makes of the same payload. A per-issue
// `error: 'transitions_unavailable'` entry simply carries no transitions, so it offers nothing.
export function offeredStatusNames(options) {
    const aggregated = Array.isArray(options && options.targetStatuses) ? options.targetStatuses : null;
    const names = [];
    const seen = new Set();
    const push = (value) => {
        const name = String(value || '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        names.push(name);
    };

    if (aggregated) {
        aggregated.forEach((entry) => push(entry && entry.name));
        return names;
    }
    (Array.isArray(options && options.issues) ? options.issues : []).forEach((issue) => {
        (Array.isArray(issue && issue.transitions) ? issue.transitions : []).forEach((transition) => {
            push(transition && (transition.toStatus || transition.name));
        });
    });
    return names;
}

// The one resolution rule (§6.4). `targetColumn` is a rendered column (engBoardColumns.js) or the
// stored record — only `id` and `statuses` are read. Returns the column's statuses intersected
// with what Jira offers, IN COLUMN ORDER, so the menu reads the way the board does:
//
//   no-op     the source column, or nothing to drop on — nothing moves and nothing is asked
//   refused   the column holds no status Jira will accept — nothing moves, and the card says why
//   transition exactly one eligible status — go straight to it (still gated by D42 downstream)
//   choose    several — ask, scoped to these statuses and no others
export function resolveBoardDrop({ sourceColumnId = null, targetColumn = null, offeredStatuses = [] } = {}) {
    if (!targetColumn || !targetColumn.id) return { outcome: 'no-op', statuses: [] };
    if (sourceColumnId && targetColumn.id === sourceColumnId) return { outcome: 'no-op', statuses: [] };

    const offered = new Set((offeredStatuses || []).map(normalizeStatus).filter(Boolean));
    const statuses = (targetColumn.statuses || [])
        .filter((name) => offered.has(normalizeStatus(name)));

    if (!statuses.length) return { outcome: 'refused', statuses: [] };
    if (statuses.length === 1) return { outcome: 'transition', statuses };
    return { outcome: 'choose', statuses };
}
