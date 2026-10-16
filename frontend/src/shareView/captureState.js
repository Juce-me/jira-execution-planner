import { SHARE_VIEW_ALERT_KEYS, SHARE_VIEW_VERSION } from './viewDefaults.js';

// The Statistics views that carry a range: a quarter pair (Lead Times) or a Sprint pair (the three source-only views).
export const STATS_RANGE_KIND = Object.freeze({ cohort: 'quarter', excludedCapacity: 'sprint', monoCrossShare: 'sprint', projectTrack: 'sprint' });

// The Board's facet selection and explicitly focused column. A facet the selection leaves absent is neutral, and a single-option
// or both-ticked state is neutral too, so only a narrowing facet is carried.
function boardViewState(mode, snapshot) {
    if (mode !== 'board') return {};
    const selection = snapshot.engBoardFilterSelection || {};
    const out = {};
    BOARD_FACET_KEYS.forEach(([facet, key]) => { if (Array.isArray(selection[facet]) && selection[facet].length) out[key] = [...selection[facet]]; });
    if (Array.isArray(selection.assignee) && selection.assignee[0] === 'unassigned') out.bassignee = ['unassigned'];
    if (Array.isArray(selection.track) && selection.track.length < 2) out.btrack = [...selection.track];
    if (snapshot.boardView?.focusedId) out.bcolumn = String(snapshot.boardView.focusedId);
    return out;
}

// Builds the ShareViewState for the Share control from committed state only: the committed search text
// (not the input), the raw facet state (not the derived selection) and Teams exactly as stored. The
// encoder drops keys equal to their defaults and keys that do not apply to the mode, layout or Statistics view.
const BOARD_FACET_KEYS = [['priority', 'bpriority'], ['projects', 'bprojects']];

export function buildShareViewState({ mode, groupId, sprintId, snapshot, searchQuery, sort, layout, rowsMode, boardStrictScope, sprintRange, alertFlags, alertCounts, focus }) {
    const rendered = SHARE_VIEW_ALERT_KEYS.filter(key => Number(alertCounts?.[key] || 0) > 0);
    const expanded = rendered.filter(key => alertFlags[key][0]);
    const statsView = snapshot.statsView;
    const rangeKind = Object.hasOwn(STATS_RANGE_KIND, statsView) ? STATS_RANGE_KIND[statsView] : null;
    const range = rangeKind === 'quarter' ? { from: snapshot.cohortStartQuarter, to: snapshot.cohortEndQuarter }
        : rangeKind === 'sprint' && sprintRange.start && sprintRange.end ? { from: String(sprintRange.start), to: String(sprintRange.end) }
            : {};
    const candidate = {
        version: SHARE_VIEW_VERSION, mode, group: String(groupId), sprint: String(sprintId),
        scope: boardStrictScope || undefined,
        teams: snapshot.selectedTeams.includes('all') ? ['all'] : [...snapshot.selectedTeams],
        find: searchQuery,
        status: snapshot.engStatusFilter, priority: snapshot.engPriorityFilter,
        track: Array.isArray(snapshot.engProjectTrackFilter) ? [...snapshot.engProjectTrackFilter] : undefined,
        lanes: { product: snapshot.showProduct, tech: snapshot.showTech },
        initiatives: typeof snapshot.groupByInitiativeChoice === 'boolean' ? snapshot.groupByInitiativeChoice : undefined,
        sort, layout, rows: rowsMode || undefined,
        ...boardViewState(mode, snapshot),
        stats: statsView, ...range,
        alerts: rendered.length ? (snapshot.showAlertsPanel ? (expanded.length ? expanded : 'none') : 'off') : undefined,
        alertTeam: focus?.kind === 'alertTeam' ? { anchor: focus.anchor, id: focus.id } : undefined,
        focus: focus && focus.kind !== 'alertTeam' ? { kind: focus.kind, key: focus.key } : undefined,
    };
    return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
}
