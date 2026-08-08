// The Board's facet set for the compact ENG filter bar (§7.2, D13, D19, D21). Pure: no React,
// no DOM, no fetching. The Board filters EPICS — there is no status facet, because status is
// the column (D13) — and unlike Catch Up there is no legacy state to migrate: the Board never
// had a filter bar before this, so `selection` here is exactly the shape engFilterFacets.js
// already understands, with no {only|hidden} storage translation on top of it.
//
// Projects reuses classifyEpicProjects (engBoardCardModel.js, D41 — Task 12's single-sourced
// isTechTask derivation): an epic's Tech/Product side comes from its own stories, and an epic
// with stories on both sides matches BOTH options, never squeezed into one.

import { PRIORITY_AXIS } from '../stats/statsConstants.js';
import { getPriorityLabel } from '../stats/statsUtils.js';
import { epicPriorityName } from './engBoardColumns.js';
import { classifyEpicProjects } from './engBoardCardModel.js';
import { buildFacetView, countActiveFacets, reconcileSelection } from './engFilterFacets.js';

export const ENG_BOARD_SUBJECT = 'Filtering epics';

const ASSIGNEE_ANYONE = 'anyone';
const ASSIGNEE_UNASSIGNED = 'unassigned';
const TRACK_COMMITTED = 'committed';
const TRACK_FLEXIBLE = 'flexible';

export function mergeBoardEpicGroups({ storyGroups = {}, epicsInScope = [], epicDetails = {} } = {}) {
    const grouped = { ...storyGroups };
    epicsInScope.forEach((epic) => {
        const key = String(epic?.key || '').trim();
        if (!key) return;
        const detail = epicDetails[key] || epic;
        if (grouped[key]) {
            if (!grouped[key].epic) grouped[key] = { ...grouped[key], epic: detail };
            return;
        }
        grouped[key] = {
            epic: detail,
            key,
            tasks: [],
            storyPoints: 0,
            parentSummary: null,
        };
    });
    return Object.values(grouped).filter((group) => group && group.epic);
}

// An epic's priority as one of PRIORITY_AXIS, or '' when it has none or an unrecognised one —
// the same convention the Board's own column sort already uses (engBoardColumns.js's
// PRIORITY_RANK), so an unranked epic is admitted while Priority is neutral and excluded once
// it narrows, exactly like Catch Up's story-level priority facet.
function priorityAxisLabel(epic) {
    const label = getPriorityLabel(epicPriorityName(epic));
    return PRIORITY_AXIS.includes(label) ? label : '';
}

// Defends against a missing epic the same way epicPriorityName/priorityAxisLabel already do
// (engBoardColumns.js's own sibling filter drops such groups upstream, but this module should
// not throw if it is ever handed one anyway).
function trackId(epic) {
    if (!epic) return null;
    if (epic.projectTrack === 'Committed') return TRACK_COMMITTED;
    if (epic.projectTrack === 'Flexible') return TRACK_FLEXIBLE;
    return null;
}

export function buildEngBoardFacetModel({ epicGroups = [], isTechTask = () => false } = {}) {
    const scopeTotal = epicGroups.length;
    const priorityCounts = {};
    const projectCounts = { tech: 0, product: 0 };
    const trackCounts = { committed: 0, flexible: 0 };
    let unassigned = 0;

    epicGroups.forEach((group) => {
        const label = priorityAxisLabel(group.epic);
        if (label) priorityCounts[label] = (priorityCounts[label] || 0) + 1;

        const { isTech, isProduct } = classifyEpicProjects(group, isTechTask);
        if (isTech) projectCounts.tech += 1;
        if (isProduct) projectCounts.product += 1;

        if (!(group.epic && group.epic.assignee)) unassigned += 1;
        const id = trackId(group.epic);
        if (id) trackCounts[id] += 1;
    });

    return {
        scopeTotal,
        counts: {
            priority: PRIORITY_AXIS.reduce((all, label) => ({ ...all, [label]: priorityCounts[label] || 0 }), {}),
            projects: projectCounts,
            assignee: { [ASSIGNEE_ANYONE]: scopeTotal, [ASSIGNEE_UNASSIGNED]: unassigned },
            track: trackCounts,
        },
        // Threaded through here, and read from `model` rather than re-accepted by
        // resolveEngBoardFilters/admitsEpic: the SAME predicate that produced these counts is the
        // only one that can ever admit against them, so a call site cannot desync the two by
        // passing a different one at resolve or admission time.
        isTechTask,
        facets: [
            {
                id: 'priority',
                label: 'Priority',
                kind: 'multi',
                neutralTotal: scopeTotal,
                options: PRIORITY_AXIS.map((label) => ({ id: label, label })),
            },
            {
                // D41: Tech and Product do not partition the scope — an epic with stories on
                // both sides counts under both — so both-ticked needs neutralTotal too, or the
                // option-sum would double-count it.
                id: 'projects',
                label: 'Projects',
                kind: 'multi',
                neutralTotal: scopeTotal,
                options: [{ id: 'tech', label: 'Tech' }, { id: 'product', label: 'Product' }],
            },
            {
                id: 'assignee',
                label: 'Assignee',
                kind: 'single',
                defaultOptionId: ASSIGNEE_ANYONE,
                options: [
                    { id: ASSIGNEE_ANYONE, label: 'Anyone' },
                    { id: ASSIGNEE_UNASSIGNED, label: 'Unassigned only' },
                ],
            },
            {
                // D21: deliberately last — the coarsest cut, and the one most often left alone.
                // D33: both ticked is neutral, and it is the only state that admits the epics
                // with no track set at all — an option-sum would silently under-report them.
                id: 'track',
                label: 'Delivery track',
                kind: 'multi',
                neutralTotal: scopeTotal,
                options: [
                    { id: TRACK_COMMITTED, label: 'Committed' },
                    { id: TRACK_FLEXIBLE, label: 'Flexible' },
                ],
            },
        ],
    };
}

export function resolveEngBoardFilters({ model, selection = {} } = {}) {
    const { facets, counts, scopeTotal, isTechTask = () => false } = model;
    // A scope change (sprint/group/team — O6) can hide or drop a ticked option; this is what
    // stops that reaching the empty set §7.3 forbids, exactly like Catch Up's own resolve step.
    const reconciled = reconcileSelection({ facets, selection, counts });
    const facetViews = buildFacetView({ facets, selection: reconciled, counts, scopeTotal });
    const [priorityView, projectsView, assigneeView, trackView] = facetViews;

    const admits = (view, id) => view.isNeutral || view.activeOptionIds.includes(id);

    return {
        facets,
        counts,
        scopeTotal,
        selection: reconciled,
        facetViews,
        activeFacetCount: countActiveFacets(facetViews),
        subject: ENG_BOARD_SUBJECT,
        readoutUnit: `of ${scopeTotal} epics`,
        // D41: an epic with stories on both sides is admitted by EITHER Projects option, so this
        // checks isTech / isProduct independently rather than folding them into one admits() call.
        // `isTechTask` comes from `model` — see the comment there — not from this call site.
        admitsEpic: (epicGroup) => {
            if (!admits(priorityView, priorityAxisLabel(epicGroup.epic))) return false;
            const { isTech, isProduct } = classifyEpicProjects(epicGroup, isTechTask);
            const admitsProjects = projectsView.isNeutral
                || (isTech && admits(projectsView, 'tech'))
                || (isProduct && admits(projectsView, 'product'));
            if (!admitsProjects) return false;
            const epic = epicGroup.epic;
            if (!admits(assigneeView, (epic && epic.assignee) ? ASSIGNEE_ANYONE : ASSIGNEE_UNASSIGNED)) return false;
            return admits(trackView, trackId(epic));
        },
    };
}
