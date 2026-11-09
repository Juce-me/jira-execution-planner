// Catch Up's facet set for the compact ENG filter bar (§7.4). Pure: no React, no DOM, no
// fetching. Catch Up filters STORIES, so Status stays a facet here — D13's "no status facet"
// is the Board's rule, not this one (D14).
//
// This module also owns the state shape that replaced Catch Up's single `statusFilter`.
// Status and Priority are stored as one of three values so the two orthogonal multi-selects
// are representable, which the single select was not:
//
//   null                        not filtering — every option in scope is admitted
//   { only: [id, ...] }         exactly these, and nothing that appears later
//   { hidden: [id, ...] }       everything except these, including options that appear later
//
// Both shapes are needed and neither is redundant. `{ hidden: ['Killed'] }` is the migration
// of `showKilled: false`, and it must survive a scope in which no story is Killed; `{ only:
// ['In Progress'] }` is the migration of `statusFilter: 'in-progress'`, and it must not widen
// when a new status turns up. Which one a user edit produces is the same rule the chip uses
// (D35): the smaller side wins.
//
// Projects stays on the existing `showTech` / `showProduct` booleans — two options, two
// booleans that already persist and already capture per group. The two task fetches are not
// touched by any of this (§4.4 / MRT010).
//
// DELIVERY (`rnd_2027`) replaces Projects with Allocation, an Initiative property built like
// Project Track: counted per Initiative, both options always shown, and both unticked is the
// explicit empty list that admits only No Allocation (`none`) work. It is stored as one value,
// `undefined` (neutral) or an array, never as the Legacy booleans.

import { PRIORITY_AXIS } from '../stats/statsConstants.js';
import { getPriorityLabel } from '../stats/statsUtils.js';
import { getStatusPhaseRank } from './engTaskUtils.js';
import { WORK_MODEL_LEGACY, isCombinedWorkModel, lowerEntityWord, resolveEntityNames } from './engWorkModel.js';
import { buildFacetView, countActiveFacets, reconcileSelection } from './engFilterFacets.js';
import {
    classifyEpicProjectTrack,
    PROJECT_TRACK_COMMITTED,
    PROJECT_TRACK_FLEXIBLE,
} from './engProjectTrack.js';

const LEGACY_NAMES = resolveEntityNames(WORK_MODEL_LEGACY);

// Today's default is `showKilled ?? false`, so a user with no saved preference must still
// arrive with Killed hidden and everything else shown.
export const DEFAULT_ENG_STATUS_FILTER = Object.freeze({ hidden: ['Killed'] });

// The two Display toggles reached exactly these statuses: Killed, and Done together with
// Incomplete. Their exclusions still gate the planning scope (`baseFilteredTasks`), which is
// why the set has a name rather than being inlined at the call site.
const CLOSED_WORK_STATUS_KEYS = new Set(['done', 'incomplete', 'killed']);

// §7.4's mapping table, as data. `killed` is absent on purpose: dashboard.jsx:397-404 already
// normalized that legacy value to `showKilled: true` with no status narrowing, so the stories
// it admits are all of them.
const STATUS_ONLY_BY_LEGACY_FILTER = {
    'in-progress': ['In Progress'],
    'todo-accepted': ['To Do', 'Pending', 'Accepted'],
    'done': ['Done'],
};

// Highest -> Blocker and High -> Major via PRIORITY_ALIASES, so these are the canonical labels.
const PRIORITY_ONLY_BY_LEGACY_FILTER = {
    'high-priority': ['Blocker', 'Critical', 'Major'],
    'minor-priority': ['Minor', 'Low', 'Trivial'],
};

const normalizeId = (value) => String(value ?? '').trim().toLowerCase();

const includesId = (ids, id) => (ids || []).some((candidate) => normalizeId(candidate) === normalizeId(id));

export function isEngClosedWorkStatus(statusName) {
    return CLOSED_WORK_STATUS_KEYS.has(String(statusName || '').toLowerCase().replace(/\s+/g, ' ').trim());
}

// A story's priority as one of PRIORITY_AXIS, or '' when it has none or an unrecognized one.
// Those stories are admitted while Priority is neutral and excluded once it narrows, which is
// what `statusFilter: 'high-priority'` did.
function priorityAxisLabel(priorityName) {
    const label = getPriorityLabel(priorityName);
    return PRIORITY_AXIS.includes(label) ? label : '';
}

export function migrateEngCatchUpFilters({ statusFilter = null, showDone = true, showKilled = false } = {}) {
    const priorityOnly = PRIORITY_ONLY_BY_LEGACY_FILTER[statusFilter];
    const priority = priorityOnly ? { only: priorityOnly } : null;

    const statusOnly = STATUS_ONLY_BY_LEGACY_FILTER[statusFilter];
    if (statusOnly) {
        // A saved status narrowing already pins the exact set, so the Display toggles it
        // outranked today add nothing.
        return { status: { only: statusOnly }, priority };
    }

    const hidden = [];
    // dashboard.jsx:397-404 read the legacy 'killed' value as "include killed work", not as a
    // narrowing, so it wins over a stale showKilled: false saved beside it.
    if (showKilled === false && statusFilter !== 'killed') hidden.push('Killed');
    if (showDone === false) hidden.push('Done', 'Incomplete');
    return { status: hidden.length ? { hidden } : null, priority };
}

function countBy(tasks, keyOf) {
    const counts = {};
    tasks.forEach((task) => {
        const key = keyOf(task);
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
}

// D20 hides zero-count options, so a facet may declare options that are absent from scope;
// Status is built from the data instead, since its vocabulary is the workflow's, not ours.
// Workflow order comes from the app's existing status→phase ranks so the facet reads To Do →
// Analysis → Ready → Blocked → In Progress → Done rather than alphabetically.
function statusOptionsInWorkflowOrder(statusCounts) {
    return Object.keys(statusCounts)
        .sort((a, b) => (getStatusPhaseRank(a) - getStatusPhaseRank(b)) || a.localeCompare(b))
        .map((name) => ({ id: name, label: name }));
}

function epicForTask(task, epicDetails) {
    const epicKey = String(task?.fields?.epicKey || '').trim();
    return epicKey ? epicDetails?.[epicKey] || null : null;
}

const ALLOCATION_CLASSES = new Set(['product', 'tech', 'none']);
const validAllocation = (value) => (ALLOCATION_CLASSES.has(value) ? value : null);

// A DELIVERY item's Allocation class ('product' | 'tech' | 'none'): its Initiative's own
// `allocationClass`, else the server's stamp on the item (`projectClassification` on an Epic,
// `projectClass` on a readiness or alert Initiative). Anything unreadable is No Allocation.
export function allocationClassOf(item, epicDetails = {}) {
    const epicKey = String(item?.fields?.epicKey || '').trim();
    return validAllocation(epicKey ? epicDetails?.[epicKey]?.allocationClass : null)
        || validAllocation(item?.fields?.projectClassification ?? item?.projectClassification)
        || validAllocation(String(item?.projectClass || '').trim().toLowerCase())
        || 'none';
}

// `names` is the viewed configuration's EntityNames (Legacy defaults when absent).
export function buildEngCatchUpFacetModel({ tasks = [], isTechTask = () => false, epicDetails = {}, workModel, names = workModel ? resolveEntityNames(workModel) : LEGACY_NAMES } = {}) {
    const allocation = isCombinedWorkModel(workModel);
    const statusCounts = countBy(tasks, (task) => task.fields?.status?.name);
    const priorityCounts = countBy(tasks, (task) => priorityAxisLabel(task.fields?.priority?.name));
    const projectCounts = { tech: 0, product: 0 };
    const trackCounts = { [PROJECT_TRACK_COMMITTED]: 0, [PROJECT_TRACK_FLEXIBLE]: 0 };
    const countedEpicKeys = new Set();
    const allocationEpicKeys = new Set();
    let trackEpicTotal = 0;
    let unsetTrackEpicTotal = 0;
    let noAllocationTotal = 0;
    tasks.forEach((task) => {
        const epicKey = String(task?.fields?.epicKey || '').trim();
        if (!allocation) projectCounts[isTechTask(task) ? 'tech' : 'product'] += 1;
        else if (epicKey && !allocationEpicKeys.has(epicKey)) {
            allocationEpicKeys.add(epicKey);
            const classId = allocationClassOf(task, epicDetails);
            if (classId === 'none') noAllocationTotal += 1;
            else projectCounts[classId] += 1;
        }
        const epic = epicForTask(task, epicDetails);
        if (!epicKey || !epic || countedEpicKeys.has(epicKey)) return;
        countedEpicKeys.add(epicKey);
        trackEpicTotal += 1;
        const classification = classifyEpicProjectTrack(epic);
        if (classification.kind === 'recognized') trackCounts[classification.id] += 1;
        if (classification.kind === 'unset') unsetTrackEpicTotal += 1;
    });
    const scopeTotal = tasks.length;
    const projectsFacet = allocation
        ? {
            id: 'projects',
            label: 'Allocation',
            kind: 'multi',
            allowEmpty: true,
            showZeroCountOptions: true,
            emptyLabel: 'No Allocation',
            emptyDescription: `No Allocation — showing ${lowerEntityWord(names.childPlural)} under ${lowerEntityWord(names.parentPlural)} without a value`,
            emptyTotal: noAllocationTotal,
            neutralTotal: allocationEpicKeys.size,
            options: [{ id: 'product', label: 'Product' }, { id: 'tech', label: 'Tech' }],
        }
        : {
            id: 'projects',
            label: 'Projects',
            kind: 'multi',
            neutralTotal: scopeTotal,
            options: [{ id: 'tech', label: 'Tech' }, { id: 'product', label: 'Product' }],
        };

    return {
        scopeTotal,
        epicDetails,
        names,
        allocation,
        counts: {
            status: statusCounts,
            priority: PRIORITY_AXIS.reduce((all, label) => ({ ...all, [label]: priorityCounts[label] || 0 }), {}),
            projects: projectCounts,
            track: trackCounts,
        },
        facets: [
            {
                id: 'status',
                label: 'Status',
                kind: 'multi',
                neutralTotal: scopeTotal,
                options: statusOptionsInWorkflowOrder(statusCounts),
            },
            {
                id: 'priority',
                label: 'Priority',
                kind: 'multi',
                neutralTotal: scopeTotal,
                options: PRIORITY_AXIS.map((label) => ({ id: label, label })),
            },
            projectsFacet,
            {
                id: 'track',
                label: 'Project Track',
                kind: 'multi',
                allowEmpty: true,
                showZeroCountOptions: true,
                emptyLabel: 'No Project Track',
                emptyDescription: `No Project Track — showing ${lowerEntityWord(names.childPlural)} under ${lowerEntityWord(names.parentPlural)} without a value`,
                emptyTotal: unsetTrackEpicTotal,
                neutralTotal: trackEpicTotal,
                options: [
                    { id: PROJECT_TRACK_COMMITTED, label: 'Committed' },
                    { id: PROJECT_TRACK_FLEXIBLE, label: 'Flexible' },
                ],
            },
        ],
    };
}

function tickedIdsFor(stored, visibleIds) {
    if (!stored) return visibleIds.slice();
    if (Array.isArray(stored.only)) return visibleIds.filter((id) => includesId(stored.only, id));
    if (Array.isArray(stored.hidden)) return visibleIds.filter((id) => !includesId(stored.hidden, id));
    return visibleIds.slice();
}

const visibleIdsOf = (facet, counts) => facet.options
    .map((option) => option.id)
    .filter((id) => Number(counts[facet.id]?.[id] || 0) > 0);

export function resolveEngCatchUpFilters({
    model,
    status = null,
    priority = null,
    showTech = true,
    showProduct = true,
    track,
    allocation,
} = {}) {
    const { facets, counts, scopeTotal } = model;
    const [statusFacet, priorityFacet] = facets;

    const rawSelection = {
        status: tickedIdsFor(status, visibleIdsOf(statusFacet, counts)),
        priority: tickedIdsFor(priority, visibleIdsOf(priorityFacet, counts)),
        ...(model.allocation
            ? (Array.isArray(allocation) ? { projects: allocation } : {})
            : { projects: [showTech ? 'tech' : null, showProduct ? 'product' : null].filter(Boolean) }),
        ...(Array.isArray(track) ? { track } : {}),
    };
    // Scope changes recompute counts, which can hide every option a stored filter names.
    // Reconciling here is what stops that reaching the empty set §7.3 forbids.
    const selection = reconcileSelection({ facets, selection: rawSelection, counts });
    const facetViews = buildFacetView({ facets, selection, counts, scopeTotal });
    const [statusView, priorityView, projectsView, trackView] = facetViews;

    const admits = (view, value) => view.isNeutral || view.activeOptionIds.some((id) => normalizeId(id) === normalizeId(value));
    // Neutral admits every class; the explicit empty list admits only No Allocation.
    const admitsAllocation = (classId) => (projectsView.isEmptySelection ? classId === 'none' : admits(projectsView, classId));

    // The planning pool stays no narrower than the Done and Killed Display toggles were, and a
    // Display toggle could only ever hide a status. An `{ only: [...] }` narrowing is a view
    // filter: letting it reach `baseFilteredTasks` would prune and then persist the user's saved
    // planning selection, which no status narrowing did before the bar existed. The exclusion
    // form still reaches it, because that is what showDone / showKilled were. Under `only` the
    // pool is strictly wider than the old toggles' — a wider pool can only restore keys.
    const statusExcludes = Array.isArray(status && status.hidden);

    return {
        facets,
        counts,
        scopeTotal,
        selection,
        facetViews,
        activeFacetCount: countActiveFacets(facetViews),
        subject: `Filtering ${lowerEntityWord(model.names.childPlural)}`,
        readoutUnit: `of ${scopeTotal} ${lowerEntityWord(scopeTotal === 1 ? model.names.child : model.names.childPlural)}`,
        admitsStatus: (statusName) => admits(statusView, statusName),
        admitsStatusForPlanning: (statusName) => !statusExcludes || admits(statusView, statusName),
        admitsPriority: (priorityName) => admits(priorityView, priorityAxisLabel(priorityName)),
        allocationFacet: Boolean(model.allocation),
        allocationClassOf: (item) => allocationClassOf(item, model.epicDetails),
        admitsAllocation,
        admitsProject: (isTech) => (model.allocation ? admitsAllocation(isTech ? 'tech' : 'product') : admits(projectsView, isTech ? 'tech' : 'product')),
        admitsProjectTrack: (task) => {
            if (trackView.isNeutral) return true;
            const classification = classifyEpicProjectTrack(epicForTask(task, model.epicDetails));
            if (trackView.isEmptySelection) return classification.kind === 'unset';
            return classification.kind === 'recognized' && trackView.activeOptionIds.includes(classification.id);
        },
        admitsEpicProjectTrack: (epic) => {
            if (trackView.isNeutral) return true;
            const classification = classifyEpicProjectTrack(epic);
            if (trackView.isEmptySelection) return classification.kind === 'unset';
            return classification.kind === 'recognized' && trackView.activeOptionIds.includes(classification.id);
        },
    };
}

// A stored value can name an option that has no story in the current scope — `{ hidden:
// ['Killed'] }` in a sprint with nothing killed, or `{ only: ['To Do', 'Pending', 'Accepted'] }`
// in one with no Accepted story. D20 hides those options, so the user cannot have expressed
// anything about them; recomputing the stored value from the ticked list alone would drop them
// and silently widen the filter on the next scope that does have them. Each form therefore
// carries its own out-of-scope entries forward. Across forms they survive by construction: an
// `{ only: [...] }` result excludes an out-of-scope hidden id because it names everything it
// admits, and a `{ hidden: [...] }` result admits an out-of-scope included id because it names
// everything it excludes.
const outOfScopeIds = (ids, visibleIds) => (ids || []).filter((id) => !includesId(visibleIds, id));

// D35's rule, reused as the storage rule: keep whichever side is shorter, so unticking one
// option of many stores an exclusion that survives new options appearing, while narrowing to
// one option stores exactly that one.
function storedFromTicked(tickedIds, visibleIds, prior) {
    // `tickedIds` is never an empty array: the bar's last-option lock refuses the untick that
    // would empty a multi facet, and reconcileSelection resets one a scope change emptied. An
    // absent list means neutral, which is every visible option ticked.
    const ticked = new Set(tickedIds && tickedIds.length ? tickedIds : visibleIds);
    const excluded = visibleIds.filter((id) => !ticked.has(id));
    const carriedHidden = outOfScopeIds(prior && prior.hidden, visibleIds);
    // Every visible option ticked reads as neutral, so a carried `only` list is dropped here
    // rather than contradicting the bar; a carried exclusion is what neutral already means.
    if (!excluded.length) return carriedHidden.length ? { hidden: carriedHidden } : null;
    const included = visibleIds.filter((id) => ticked.has(id));
    return excluded.length < included.length
        ? { hidden: [...excluded, ...carriedHidden] }
        : { only: [...included, ...outOfScopeIds(prior && prior.only, visibleIds)] };
}

// An `allowEmpty` facet's stored value: undefined (neutral, every option ticked), or the ticked
// ids in option order, the empty list included.
function storedAllowEmpty(selection, facetViews, facetId) {
    if (!Object.prototype.hasOwnProperty.call(selection, facetId)) return undefined;
    const ticked = Array.isArray(selection[facetId]) ? selection[facetId] : [];
    const view = facetViews.find((facet) => facet.id === facetId);
    const visibleIds = (view?.visibleOptions || []).map((option) => option.id);
    const ordered = visibleIds.filter((id) => ticked.includes(id));
    return ticked.length === 0 || ordered.length < visibleIds.length ? ordered : undefined;
}

// `allocation: true` (DELIVERY) reads the projects facet as `allocation` instead of the Legacy booleans.
export function readEngCatchUpFilterState(selection, facetViews, stored = {}, { allocation = false } = {}) {
    const [statusView, priorityView] = facetViews;
    const projects = selection.projects || [];
    const next = {
        status: storedFromTicked(selection.status, statusView.visibleOptions.map((option) => option.id), stored.status),
        priority: storedFromTicked(selection.priority, priorityView.visibleOptions.map((option) => option.id), stored.priority),
        ...(allocation ? {} : { showTech: projects.includes('tech'), showProduct: projects.includes('product') }),
    };
    if (allocation) next.allocation = storedAllowEmpty(selection, facetViews, 'projects');
    const track = storedAllowEmpty(selection, facetViews, 'track');
    if (track !== undefined) next.track = track;
    return next;
}
