// Pure resolution of a decoded share-view link against the recipient's own catalogs (design:
// docs/plans/SUPPORT-shareable-view-links-design-194.md, "Link contract" and "Apply machine").
// A link only selects among values the recipient already owns. A miss is reported as a notice
// category and its key is skipped; nothing here widens a miss into a value that changes the view.
import { buildQuarterOptions, compareQuarterLabels, getCurrentQuarterLabel } from '../cohort/cohortUtils.js';
import { buildDefaultExcludedCapacityRange, compareSprintsChronologically } from '../stats/excludedCapacityStats.js';
import { PRIORITY_AXIS } from '../stats/statsConstants.js';
import {
    SHARE_VIEW_ALERT_ANCHORS,
    SHARE_VIEW_ALERT_KEYS,
    SHARE_VIEW_DEFAULTS,
    SHARE_VIEW_MODES,
} from './viewDefaults.js';

const MODES = new Set(SHARE_VIEW_MODES);
const ALERT_ANCHORS = new Set(SHARE_VIEW_ALERT_ANCHORS);
const BOARD_SCOPES = new Set(['component', 'all_work']);
// Statistics views that load tasks and so honor Teams; the other three read the stats source only.
const TEAM_STATS_VIEWS = new Set(['teams', 'priority', 'burnout', 'cohort']);
const SPRINT_RANGE_STATS_VIEWS = new Set(['excludedCapacity', 'monoCrossShare', 'projectTrack']);
const FOCUS_KINDS = new Set(['epic', 'story']);
// useStatsData.js builds cohortQuarterOptions as buildQuarterOptions(currentQuarter, 16).
const QUARTER_WINDOW = 16;

const linkValue = (state, key) => (state[key] === undefined ? SHARE_VIEW_DEFAULTS[key] : state[key]);
const unique = (values) => [...new Set(values)];
// Same fold as includesId in eng/engCatchUpFilters.js: trim, then lowercase.
const normalizeId = (value) => String(value ?? '').trim().toLowerCase();
// Same cleaning as activeGroupTeamIds in dashboard.jsx: trimmed, de-duplicated, non-empty.
const normalizeTeamIds = (ids) => unique((ids || []).map((id) => String(id || '').trim()).filter(Boolean));

// ctx = { visibleGroups: [{ id, teamIds }], sprints: [{ id, name, state, ... }],
//         boardScopeReady?: (groupId, scope) => boolean, currentQuarter?: 'YYYYQn' }
export function resolveShareViewScope(state, ctx) {
    const group = (ctx.visibleGroups || []).find((entry) => String(entry.id) === state.group);
    const sprint = (ctx.sprints || []).find((entry) => String(entry.id) === state.sprint);
    const reported = [];
    if (!group) reported.push('group');
    if (!sprint) reported.push('sprint');
    if (!group || !sprint) {
        return { ok: false, reason: group ? 'sprint_unresolved' : 'group_unresolved', reported };
    }
    // EngModeControl disables Planning only for closed Sprints; Board and Statistics are always available.
    const sprintState = String(sprint.state || '').toLowerCase();
    const available = MODES.has(state.mode)
        && !(state.mode === 'planning' && sprintState === 'closed');
    if (!available) reported.push('mode');
    return {
        ok: true,
        group: { id: group.id, teamIds: normalizeTeamIds(group.teamIds) },
        sprint: { id: sprint.id, name: sprint.name, state: sprint.state },
        mode: available ? state.mode : 'catch-up',
        reported,
    };
}

function teamsApply(state, mode) {
    if (mode === 'catch-up' || mode === 'planning') return true;
    return mode === 'statistics' && TEAM_STATS_VIEWS.has(linkValue(state, 'stats'));
}

// `mode` is the resolved mode; it differs from state.mode after a fall-back to Catch Up.
export function resolveShareViewTeams(state, group, mode = state.mode) {
    if (!teamsApply(state, mode)) return { teams: null, reported: [] };
    const requested = unique(linkValue(state, 'teams'));
    if (requested.includes('all')) return { teams: ['all'], reported: [] };
    const inGroup = new Set(normalizeTeamIds(group.teamIds));
    const kept = requested.filter((id) => inGroup.has(id));
    // No match skips the key: sanitizeSelectedTeamsForScope would widen it to ['all'].
    if (!kept.length) return { teams: null, reported: ['teams'] };
    return { teams: kept, reported: kept.length < requested.length ? ['teams'] : [] };
}

// Atoms matched case-insensitively against the option ids present now, each returned as the
// option's own id; an atom with no option is dropped.
function matchOptionIds(atoms, optionIds) {
    const byId = new Map((optionIds || []).map((id) => [normalizeId(id), id]));
    const matched = atoms.filter((atom) => byId.has(normalizeId(atom)));
    return { ids: unique(matched.map((atom) => byId.get(normalizeId(atom)))), dropped: matched.length < atoms.length };
}

// null = neutral, { only } or { hidden }. Returns { value } or null when the key is skipped.
function resolveMultiFacet(link, fallback, optionIds, reported) {
    if (link === undefined) return { value: fallback };
    if (link === null) return { value: null };
    const form = Array.isArray(link.only) ? 'only' : 'hidden';
    const { ids, dropped } = matchOptionIds(link[form], optionIds);
    if (dropped) reported.push('filters');
    return ids.length ? { value: { [form]: ids } } : null;
}

// undefined = neutral, [] = only Epics without a Project Track, else the listed option ids.
function resolveTrackFacet(link, optionIds, reported) {
    if (link === undefined) return { value: SHARE_VIEW_DEFAULTS.track };
    if (!link.length) return { value: [] };
    const { ids, dropped } = matchOptionIds(link, optionIds);
    if (dropped) reported.push('filters');
    return ids.length ? { value: ids } : null;
}

// options = { status, priority, track }: the facet option ids present when the scope has loaded.
// `apply.track` is an own property holding undefined when the link leaves it neutral; a skipped
// key is absent, so callers test Object.hasOwn(apply, key).
export function resolveShareViewFacets(state, options, mode = state.mode) {
    const apply = {};
    const reported = [];
    if (mode !== 'catch-up' && mode !== 'planning') return { apply, reported };
    // Priority is limited to the six canonical labels the facet is built from.
    const priorityIds = (options.priority || []).filter((id) => PRIORITY_AXIS.includes(id));
    const resolved = {
        status: resolveMultiFacet(state.status, SHARE_VIEW_DEFAULTS.status, options.status, reported),
        priority: resolveMultiFacet(state.priority, SHARE_VIEW_DEFAULTS.priority, priorityIds, reported),
        track: resolveTrackFacet(state.track, options.track, reported),
    };
    for (const [key, facet] of Object.entries(resolved)) {
        if (facet) apply[key] = facet.value;
    }
    return { apply, reported: unique(reported) };
}

// Omitted means the default constant: panel shown, every category expanded. `off` hides only the
// panel; `none` collapses all. A category the sprint state does not render is not an error.
function resolveAlerts(value) {
    const keys = [...SHARE_VIEW_ALERT_KEYS];
    const open = new Set(Array.isArray(value) ? value : value === 'none' ? [] : keys);
    return { panel: value !== 'off', expanded: Object.fromEntries(keys.map((key) => [key, open.has(key)])) };
}

// The default (no strict scope) needs no readiness; a strict scope applies only once the Board is
// ready for the link's group. Returns undefined to skip the key.
function resolveBoardScope(state, scope, ctx, reported) {
    const requested = linkValue(state, 'scope');
    if (requested === SHARE_VIEW_DEFAULTS.scope) return requested;
    if (BOARD_SCOPES.has(requested) && ctx.boardScopeReady?.(scope.group.id, requested) === true) return requested;
    reported.push('mode');
    return undefined;
}

function quarterRange(from, to, currentQuarter) {
    const quarters = buildQuarterOptions(currentQuarter, QUARTER_WINDOW);
    return quarters.includes(from) && quarters.includes(to) && compareQuarterLabels(from, to) <= 0 ? { from, to } : null;
}

function sprintRange(from, to, sprints) {
    const ordered = [...sprints].sort(compareSprintsChronologically);
    const start = ordered.findIndex((entry) => String(entry.id) === from);
    const end = ordered.findIndex((entry) => String(entry.id) === to);
    return start >= 0 && end >= start ? { from: String(ordered[start].id), to: String(ordered[end].id) } : null;
}

// Both bounds or neither, from <= to, quarters inside the 16-quarter window, Sprint ids in the
// catalog. Anything else falls back to the default range and reports `mode`.
function resolveStatsRange(state, view, scope, ctx, reported) {
    const quarterBased = view === 'cohort';
    if (!quarterBased && !SPRINT_RANGE_STATS_VIEWS.has(view)) return null;
    const currentQuarter = ctx.currentQuarter || getCurrentQuarterLabel();
    let fallback = { from: currentQuarter, to: currentQuarter };
    if (!quarterBased) {
        const { startSprintId, endSprintId } = buildDefaultExcludedCapacityRange(ctx.sprints, scope.sprint.id);
        fallback = { from: startSprintId, to: endSprintId };
    }
    const { from, to } = state;
    if (from === undefined && to === undefined) return fallback;
    // A lone bound matches nothing in either validator, so only complete pairs survive.
    const range = quarterBased ? quarterRange(from, to, currentQuarter) : sprintRange(from, to, ctx.sprints);
    if (!range) reported.push('mode');
    return range || fallback;
}

function focusApplies(candidate, state, mode) {
    if (candidate.kind === 'alertTeam') {
        return mode === 'catch-up' && state.alerts !== 'off' && ALERT_ANCHORS.has(candidate.anchor);
    }
    // The Board reveals Epic cards only; its Epics are the cards of the focused column.
    if (mode === 'board') return candidate.kind === 'epic';
    if (!FOCUS_KINDS.has(candidate.kind) || (mode !== 'catch-up' && mode !== 'planning')) return false;
    // The Planning table never switches its Epics/Stories rows: the target must be in the link's rows.
    if (mode === 'planning' && linkValue(state, 'layout') === 'table') {
        return candidate.kind === (linkValue(state, 'rows') === 'story' ? 'story' : 'epic');
    }
    return true;
}

// At most one target; alertTeam outranks epic and story. `dropped` is true when the link carried
// a target that was not chosen, so the notice names `focus`.
function selectFocus(state, mode) {
    const candidates = [];
    if (state.alertTeam) candidates.push({ kind: 'alertTeam', anchor: state.alertTeam.anchor, id: state.alertTeam.id });
    if (state.focus) candidates.push({ kind: state.focus.kind, key: state.focus.key });
    const target = candidates.find((candidate) => focusApplies(candidate, state, mode)) || null;
    return { target, dropped: candidates.length > (target ? 1 : 0) };
}

export function resolveShareViewFocus(state, mode) {
    return selectFocus(state, mode).target;
}

// Only the keys that apply to the resolved mode, each the link value or its default constant.
// Teams, facets and focus are resolved by their own functions once their data has loaded.
export function buildShareViewFieldPlan(state, scope, ctx = {}) {
    const apply = {};
    const reported = [];
    const take = (...keys) => keys.forEach((key) => { apply[key] = linkValue(state, key); });
    if (scope.mode === 'board') {
        take('find');
        // The Board's own facet selection (an absent facet is neutral) and the focused column; an unknown column id is ignored by the Board.
        const facets = { priority: state.bpriority, projects: state.bprojects, assignee: state.bassignee, track: state.btrack };
        apply.boardFilters = Object.fromEntries(Object.entries(facets).filter(([, ids]) => ids !== undefined));
        apply.boardColumn = state.bcolumn ?? null;
        const boardScope = resolveBoardScope(state, scope, ctx, reported);
        if (boardScope !== undefined) apply.scope = boardScope;
    } else if (scope.mode === 'statistics') {
        take('stats');
        apply.range = resolveStatsRange(state, apply.stats, scope, ctx, reported);
    } else {
        take('find', 'lanes');
        if (scope.mode === 'planning') {
            take('layout');
            if (apply.layout === 'table') take('rows');
            else take('initiatives', 'sort');
        } else {
            take('initiatives', 'sort');
            apply.alerts = resolveAlerts(state.alerts);
        }
    }
    if (selectFocus(state, scope.mode).dropped) reported.push('focus');
    return { apply, reported: unique(reported) };
}
