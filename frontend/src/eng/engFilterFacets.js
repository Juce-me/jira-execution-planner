// Facet model for the compact ENG filter bar. Pure: no React, no DOM, no fetching.
// The Board supplies epic-scoped facets and Catch Up story-scoped ones (D19), so every rule
// here is expressed against the facet set it is given rather than against a fixed vocabulary.
//
// Shapes
//   facet     { id, label, kind: 'multi' | 'single', options: [{ id, label }],
//               neutralTotal?, defaultOptionId? }
//   selection { [facetId]: [optionId, ...] }   a 'single' facet always holds exactly one id
//   counts    { [facetId]: { [optionId]: number } }   recomputed on scope change only (O6)

function optionCount(counts, facetId, optionId) {
    const facetCounts = counts && counts[facetId];
    return Number((facetCounts && facetCounts[optionId]) || 0);
}

// D20: an option with nothing in scope is hidden, not shown at zero. Hidden options are then
// excluded from the neutral test, from the last-option lock and from the admitted total.
function visibleOptionsOf(facet, counts) {
    return facet.options
        .map((option) => ({ id: option.id, label: option.label, count: optionCount(counts, facet.id, option.id) }))
        .filter((option) => option.count > 0);
}

// The one place that decides what an absent or explicitly empty selection means. For a `multi`
// facet, both mean neutral — every visible option ticked; an empty multi selection is not a
// representable state in this design, so there is no second meaning worth preserving for it. For
// a `single` facet, both mean `defaultOptionId`.
function selectedIdsOf(selection, facet, counts) {
    const selected = selection && selection[facet.id];
    const hasSelection = Array.isArray(selected) && selected.length > 0;
    if (facet.kind === 'single') {
        return hasSelection ? [selected[0]] : [facet.defaultOptionId];
    }
    return hasSelection ? selected : visibleOptionsOf(facet, counts).map((option) => option.id);
}

// The state a facet is in when it is not filtering: every visible option ticked, or the radio
// facet's default. Also what a chip's clear button and Select all return the facet to.
export function neutralFacetSelection(facet, counts) {
    if (facet.kind === 'single') return [facet.defaultOptionId];
    return visibleOptionsOf(facet, counts).map((option) => option.id);
}

export function buildFacetView({ facets = [], selection = {}, counts = {}, scopeTotal = 0 } = {}) {
    return facets.map((facet) => {
        const visibleOptions = visibleOptionsOf(facet, counts);
        const isSingle = facet.kind === 'single';
        const ticked = new Set(selectedIdsOf(selection, facet, counts));
        const activeOptions = visibleOptions.filter((option) => ticked.has(option.id));
        const activeOptionIds = activeOptions.map((option) => option.id);
        const isNeutral = isSingle
            ? ticked.has(facet.defaultOptionId)
            : activeOptionIds.length === visibleOptions.length;
        // D34/D33: neutral means the facet is not filtering, so its heading reads the whole scope.
        // Delivery track's options do not partition the scope — summing them would omit every
        // epic with no track at all — which is what neutralTotal exists to express.
        const admittedTotal = isNeutral
            ? (facet.neutralTotal ?? scopeTotal)
            : activeOptions.reduce((total, option) => total + option.count, 0);
        // §7.3: the last ticked visible option of a multi facet locks, so no facet can empty.
        const lockedOptionIds = !isSingle && activeOptionIds.length === 1 ? [activeOptionIds[0]] : [];

        return {
            id: facet.id,
            label: facet.label,
            kind: facet.kind,
            visibleOptions,
            isNeutral,
            admittedTotal,
            activeOptionIds,
            lockedOptionIds,
        };
    });
}

// Returns a new selection; the input is never mutated. A multi facet refuses to untick its last
// ticked visible option and returns the selection unchanged, so no facet can reach an empty set.
export function toggleFacetOption(selection, facet, optionId, counts) {
    if (facet.kind === 'single') {
        return { ...selection, [facet.id]: [optionId] };
    }

    const visibleIds = visibleOptionsOf(facet, counts).map((option) => option.id);
    const ticked = new Set(selectedIdsOf(selection, facet, counts));
    if (ticked.has(optionId)) {
        const tickedVisibleIds = visibleIds.filter((id) => ticked.has(id));
        if (tickedVisibleIds.length === 1 && tickedVisibleIds[0] === optionId) return selection;
        ticked.delete(optionId);
    } else {
        ticked.add(optionId);
    }

    return {
        ...selection,
        [facet.id]: facet.options.filter((option) => ticked.has(option.id)).map((option) => option.id),
    };
}

// A scope change recomputes counts, which can hide a ticked option or remove it outright. This
// drops those references and resets a facet that would be left with nothing ticked to neutral,
// so a scope change can never strand the UI in the empty state §7.3 forbids.
export function reconcileSelection({ facets = [], selection = {}, counts = {} } = {}) {
    const reconciled = {};

    facets.forEach((facet) => {
        const visibleIds = visibleOptionsOf(facet, counts).map((option) => option.id);
        if (facet.kind === 'single') {
            const [selected] = selectedIdsOf(selection, facet, counts);
            reconciled[facet.id] = visibleIds.includes(selected)
                ? [selected]
                : neutralFacetSelection(facet, counts);
            return;
        }
        const ticked = new Set(selectedIdsOf(selection, facet, counts));
        const kept = visibleIds.filter((id) => ticked.has(id));
        reconciled[facet.id] = kept.length ? kept : neutralFacetSelection(facet, counts);
    });

    return reconciled;
}

// D35: a chip states the shorter truth about its facet. Enumerating everything ticked produced a
// 565px chip that wrapped the bar onto three rows, so naming the excluded side wins whenever it
// is strictly shorter. Two names then +n; the untruncated list stays in the title.
const CHIP_MAX_NAMES = 2;

function chipCopy(facetLabel, verb, names) {
    return {
        facetLabel,
        verb,
        names: names.slice(0, CHIP_MAX_NAMES),
        overflowCount: Math.max(0, names.length - CHIP_MAX_NAMES),
        title: `${facetLabel} — ${verb ? `${verb} ` : ''}${names.join(', ')}`,
    };
}

export function describeFacetChip(facetView, facet) {
    if (!facetView || facetView.isNeutral) return null;

    if (facetView.kind === 'single') {
        // Radio facets carry no verb: "Assignee Unassigned only" is already the shorter truth.
        const labels = facetView.activeOptionIds.map((optionId) => {
            const option = facet.options.find((candidate) => candidate.id === optionId);
            return option ? option.label : optionId;
        });
        return chipCopy(facetView.label, null, labels);
    }

    const active = new Set(facetView.activeOptionIds);
    const excluded = facetView.visibleOptions.filter((option) => !active.has(option.id));
    const included = facetView.visibleOptions.filter((option) => active.has(option.id));
    return excluded.length < included.length
        ? chipCopy(facetView.label, 'hidden', excluded.map((option) => option.label))
        : chipCopy(facetView.label, 'only', included.map((option) => option.label));
}

// The trigger badge: how many facets are actually filtering.
export function countActiveFacets(facetViews = []) {
    return facetViews.filter((facetView) => !facetView.isNeutral).length;
}
