// Defaults and closed vocabularies for shareable view links (design: "Link contract" and
// "Semantics"). An omitted link key means the constant kept here, never the recipient's saved
// preference, so the encoder and the apply read the same values. A constant that already has an
// owner module is imported from it; the few owner literals that are not exported are pinned by
// tests/test_share_view_codec.js, so a change at the owner fails a test instead of drifting.
import { DEFAULT_ENG_STATUS_FILTER } from '../eng/engCatchUpFilters.js';
import { DEFAULT_ENG_EPIC_SORT, ENG_EPIC_SORT_OPTIONS } from '../eng/engTaskUtils.js';
import { PROJECT_TRACK_COMMITTED, PROJECT_TRACK_FLEXIBLE } from '../eng/engProjectTrack.js';
import { PRIORITY_AXIS } from '../stats/statsConstants.js';
import { getCurrentQuarterLabel } from '../cohort/cohortUtils.js';
import { buildDefaultExcludedCapacityRange } from '../stats/excludedCapacityStats.js';

export const SHARE_VIEW_VERSION = 1;

// ENG modes a link can carry. Scenario and EPM are out of v1 (design: Non-goals).
export const SHARE_VIEW_MODES = Object.freeze(['catch-up', 'planning', 'board', 'statistics']);

// Board scope tokens; the empty string is the ordinary sprint scope (dashboard.jsx boardStrictScope).
export const SHARE_VIEW_BOARD_SCOPES = Object.freeze(['component', 'all_work']);

export const SHARE_VIEW_PLANNING_LAYOUTS = Object.freeze(['list', 'table']);

// The Planning table's own row modes; the link spells them `epics` and `stories`.
export const SHARE_VIEW_PLANNING_ROWS = Object.freeze(['epic', 'story']);

export const SHARE_VIEW_SORTS = Object.freeze(ENG_EPIC_SORT_OPTIONS.map((option) => option.value));

// Project Track facet option ids (the Epic's recognized values).
export const SHARE_VIEW_TRACK_IDS = Object.freeze([PROJECT_TRACK_COMMITTED, PROJECT_TRACK_FLEXIBLE]);

// The six canonical priority labels; the only ids a `priority` facet atom may resolve to.
export const SHARE_VIEW_PRIORITY_IDS = Object.freeze([...PRIORITY_AXIS]);

// Statistics views and the optional keys each one honors: `teams` for the four task-loading
// views, `from` and `to` for Lead Times quarters (`cohort`) and the three source-only sprint views.
export const SHARE_VIEW_STATS_KEYS_BY_VIEW = Object.freeze({
    teams: Object.freeze(['teams']),
    priority: Object.freeze(['teams']),
    burnout: Object.freeze(['teams']),
    cohort: Object.freeze(['teams', 'from', 'to']),
    excludedCapacity: Object.freeze(['from', 'to']),
    monoCrossShare: Object.freeze(['from', 'to']),
    projectTrack: Object.freeze(['from', 'to']),
});
export const SHARE_VIEW_STATS_VIEWS = Object.freeze(Object.keys(SHARE_VIEW_STATS_KEYS_BY_VIEW));

// Catch Up alert categories; the keys name the ten expand flags, in the panel's order.
export const SHARE_VIEW_ALERT_KEYS = Object.freeze([
    'missing', 'blocked', 'followup', 'backlog', 'missingTeam',
    'missingLabels', 'needsStories', 'waiting', 'empty', 'done',
]);
// `followupEpics` is the second list inside the `followup` card.
export const SHARE_VIEW_ALERT_ANCHORS = Object.freeze([...SHARE_VIEW_ALERT_KEYS, 'followupEpics']);

// Defaults of every optional key. Absent state key = this value. `from` and `to` depend on today
// (Lead Times) or on the link's own Sprint (source-only views), so those two are the owner functions.
// The encoder never relies on `quarterRange`: a Lead Times link always carries its range, so it keeps
// its meaning whatever the date. Only the apply uses it, for a link that has no range.
export const SHARE_VIEW_DEFAULTS = Object.freeze({
    mode: 'catch-up',
    scope: '',
    teams: Object.freeze(['all']),
    find: '',
    status: DEFAULT_ENG_STATUS_FILTER,
    priority: null,
    track: undefined,
    lanes: Object.freeze({ product: true, tech: true }),
    initiatives: null,
    sort: DEFAULT_ENG_EPIC_SORT,
    layout: 'table',
    rows: 'epic',
    stats: 'teams',
    // Panel shown with every category expanded.
    alerts: SHARE_VIEW_ALERT_KEYS,
    quarterRange: () => {
        const quarter = getCurrentQuarterLabel();
        return { from: quarter, to: quarter };
    },
    sprintRange: (sprintId) => {
        const range = buildDefaultExcludedCapacityRange([{ id: sprintId }], sprintId);
        return { from: range.startSprintId, to: range.endSprintId };
    },
});

// Optional ShareViewState keys that apply to each mode. `version`, `mode`, `group` and `sprint`
// apply to every mode and are always written, so they are not listed. Two narrowings follow the
// design's per-view columns: Planning `rows` applies to the table and `initiatives` and `sort` to
// the list; Statistics keys follow SHARE_VIEW_STATS_KEYS_BY_VIEW.
export const SHARE_VIEW_KEYS_BY_MODE = Object.freeze({
    'catch-up': Object.freeze(['teams', 'find', 'status', 'priority', 'track', 'lanes', 'initiatives', 'sort', 'alerts', 'alertTeam', 'focus']),
    planning: Object.freeze(['teams', 'find', 'status', 'priority', 'track', 'lanes', 'layout', 'rows', 'initiatives', 'sort', 'focus']),
    board: Object.freeze(['scope', 'find']),
    statistics: Object.freeze(['teams', 'stats', 'from', 'to']),
});
export const SHARE_VIEW_PLANNING_KEYS_BY_LAYOUT = Object.freeze({
    table: Object.freeze(['rows']),
    list: Object.freeze(['initiatives', 'sort']),
});

// Query key -> notice category (design: Notice). `epic` and `story` fill the one `focus` slot.
export const SHARE_VIEW_CATEGORY_BY_KEY = Object.freeze({
    group: 'group',
    sprint: 'sprint',
    mode: 'mode',
    scope: 'mode',
    layout: 'mode',
    rows: 'mode',
    stats: 'mode',
    from: 'mode',
    to: 'mode',
    teams: 'teams',
    find: 'filters',
    status: 'filters',
    priority: 'filters',
    track: 'filters',
    lanes: 'filters',
    initiatives: 'filters',
    sort: 'filters',
    alerts: 'focus',
    alertTeam: 'focus',
    epic: 'focus',
    story: 'focus',
});
