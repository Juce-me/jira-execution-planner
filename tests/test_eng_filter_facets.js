const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engFilterFacets.js');
}

function multiFacet(id, label, labels, extra = {}) {
    return {
        id,
        label,
        kind: 'multi',
        options: labels.map((optionLabel) => ({ id: optionLabel.toLowerCase(), label: optionLabel })),
        ...extra,
    };
}

const ASSIGNEE_FACET = {
    id: 'assignee',
    label: 'Assignee',
    kind: 'single',
    defaultOptionId: 'anyone',
    options: [
        { id: 'anyone', label: 'Anyone' },
        { id: 'unassigned', label: 'Unassigned only' },
    ],
};

// D33: the two track options do not partition the scope — most epics carry no track at all.
const TRACK_FACET = {
    id: 'track',
    label: 'Project Track',
    kind: 'multi',
    allowEmpty: true,
    showZeroCountOptions: true,
    emptyLabel: 'No Project Track',
    emptyDescription: 'No Project Track — showing epics without a value',
    emptyTotal: 3,
    neutralTotal: 87,
    options: [
        { id: 'committed', label: 'Committed' },
        { id: 'flexible', label: 'Flexible' },
    ],
};

const TRACK_COUNTS = { track: { committed: 8, flexible: 14 } };

function viewOf(module, facet, selection, counts, scopeTotal) {
    const [view] = module.buildFacetView({
        facets: [facet],
        selection,
        counts,
        scopeTotal,
    });
    return view;
}

/* ── D20: an option with nothing in scope is hidden, not shown at zero ───────── */

test('buildFacetView hides an option with zero items in scope', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Trivial']);
    const view = viewOf(
        module,
        facet,
        { priority: ['blocker', 'critical', 'trivial'] },
        { priority: { blocker: 4, critical: 25, trivial: 0 } },
        29,
    );

    assert.deepEqual(view.visibleOptions.map((option) => option.id), ['blocker', 'critical']);
});

test('buildFacetView never hides an option that has items in scope', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Trivial']);
    const view = viewOf(
        module,
        facet,
        { priority: ['blocker'] },
        { priority: { blocker: 4, critical: 25, trivial: 1 } },
        30,
    );

    assert.deepEqual(
        view.visibleOptions.map((option) => ({ id: option.id, label: option.label, count: option.count })),
        [
            { id: 'blocker', label: 'Blocker', count: 4 },
            { id: 'critical', label: 'Critical', count: 25 },
            { id: 'trivial', label: 'Trivial', count: 1 },
        ],
    );
});

test('buildFacetView reads a facet as neutral when its only unticked option is hidden', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Trivial']);
    const view = viewOf(
        module,
        facet,
        { priority: ['blocker', 'critical'] },
        { priority: { blocker: 4, critical: 25, trivial: 0 } },
        29,
    );

    assert.equal(view.isNeutral, true);
});

test('buildFacetView never locks a hidden option', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Trivial']);
    const view = viewOf(
        module,
        facet,
        { priority: ['blocker', 'trivial'] },
        { priority: { blocker: 4, trivial: 0 } },
        4,
    );

    assert.deepEqual(view.lockedOptionIds, ['blocker']);
    assert.deepEqual(view.activeOptionIds, ['blocker']);
});

test('buildFacetView excludes a hidden option from admittedTotal', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Trivial']);
    const view = viewOf(
        module,
        facet,
        { priority: ['blocker', 'trivial'] },
        { priority: { blocker: 4, critical: 25, trivial: 0 } },
        29,
    );

    assert.equal(view.isNeutral, false);
    assert.equal(view.admittedTotal, 4);
});

/* ── §7.3: no facet can reach an empty set ──────────────────────────────────── */

test('toggleFacetOption refuses to untick the last ticked visible option', async () => {
    const module = await loadModule();
    const facet = multiFacet('projects', 'Projects', ['Tech', 'Product']);
    const counts = { projects: { tech: 48, product: 39 } };
    const selection = { projects: ['tech'] };

    const next = module.toggleFacetOption(selection, facet, 'tech', counts);

    assert.deepEqual(next, { projects: ['tech'] });
    // EngFilterBar.jsx gates its onChange call on `next !== selection` (reference identity is
    // the actual refusal signal); deepEqual alone would stay green for a `{ ...selection }`
    // that fires onChange on every locked click.
    assert.equal(next, selection, 'a refused untick returns the same selection reference');
    assert.deepEqual(selection, { projects: ['tech'] }, 'input selection is not mutated');
});

test('buildFacetView locks the last ticked visible option of a multi facet', async () => {
    const module = await loadModule();
    const facet = multiFacet('projects', 'Projects', ['Tech', 'Product']);
    const view = viewOf(module, facet, { projects: ['tech'] }, { projects: { tech: 48, product: 39 } }, 87);

    assert.deepEqual(view.lockedOptionIds, ['tech']);
});

test('toggleFacetOption unticks an option while another stays ticked', async () => {
    const module = await loadModule();
    const facet = multiFacet('projects', 'Projects', ['Tech', 'Product']);
    const counts = { projects: { tech: 48, product: 39 } };
    const selection = { projects: ['tech', 'product'] };

    const next = module.toggleFacetOption(selection, facet, 'product', counts);

    assert.deepEqual(next, { projects: ['tech'] });
    assert.deepEqual(selection, { projects: ['tech', 'product'] }, 'input selection is not mutated');
});

test('toggleFacetOption unticks from neutral when the facet has no selection yet', async () => {
    const module = await loadModule();
    const facet = multiFacet('projects', 'Projects', ['Tech', 'Product']);
    const counts = { projects: { tech: 48, product: 39 } };

    // An absent facet reads as neutral (every visible option ticked), so the first
    // click narrows away from everything rather than selecting a single option.
    assert.deepEqual(module.toggleFacetOption({}, facet, 'tech', counts), { projects: ['product'] });
    assert.deepEqual(module.toggleFacetOption({ projects: [] }, facet, 'tech', counts), { projects: ['product'] });
});

test('toggleFacetOption ticks an unticked option back on in facet option order', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Major']);
    const counts = { priority: { blocker: 4, critical: 25, major: 25 } };

    const next = module.toggleFacetOption({ priority: ['major'] }, facet, 'blocker', counts);

    assert.deepEqual(next, { priority: ['blocker', 'major'] });
});

test('toggleFacetOption replaces the selection of a single facet', async () => {
    const module = await loadModule();
    const counts = { assignee: { anyone: 87, unassigned: 4 } };

    const next = module.toggleFacetOption({ assignee: ['anyone'] }, ASSIGNEE_FACET, 'unassigned', counts);

    assert.deepEqual(next, { assignee: ['unassigned'] });
});

test('buildFacetView locks nothing in a single facet', async () => {
    const module = await loadModule();
    const view = viewOf(
        module,
        ASSIGNEE_FACET,
        { assignee: ['unassigned'] },
        { assignee: { anyone: 87, unassigned: 4 } },
        87,
    );

    assert.deepEqual(view.lockedOptionIds, []);
});

/* ── an absent or empty multi selection means neutral, never the forbidden empty set ────── */

test('buildFacetView treats a multi facet absent from selection as neutral', async () => {
    const module = await loadModule();
    const view = viewOf(module, TRACK_FACET, {}, TRACK_COUNTS, 87);

    assert.equal(view.isNeutral, true);
    assert.equal(view.admittedTotal, 87, 'an absent selection admits the neutral total, not zero');
    assert.equal(module.describeFacetChip(view, TRACK_FACET), null);
    assert.equal(module.countActiveFacets([view]), 0);
});

test('buildFacetView preserves an explicitly empty allow-empty selection', async () => {
    const module = await loadModule();
    const view = viewOf(module, TRACK_FACET, { track: [] }, TRACK_COUNTS, 87);

    assert.equal(view.isNeutral, false);
    assert.equal(view.isEmptySelection, true);
    assert.deepEqual(view.activeOptionIds, []);
    assert.deepEqual(view.lockedOptionIds, []);
    assert.equal(view.admittedTotal, 3);
    assert.equal(module.describeFacetChip(view, TRACK_FACET).title, 'Project Track — only No Project Track');
    assert.equal(module.countActiveFacets([view]), 1);
});

test('allow-empty facets retain zero-count options and permit all four states', async () => {
    const module = await loadModule();
    const counts = { track: { committed: 4, flexible: 0 } };
    const facet = { ...TRACK_FACET, neutralTotal: 7, emptyTotal: 3 };
    const neutral = viewOf(module, facet, {}, counts, 7);
    assert.deepEqual(neutral.visibleOptions.map(({ id, count }) => ({ id, count })), [
        { id: 'committed', count: 4 }, { id: 'flexible', count: 0 },
    ]);
    assert.equal(neutral.admittedTotal, 7);
    const committed = module.toggleFacetOption({}, facet, 'flexible', counts);
    assert.deepEqual(committed, { track: ['committed'] });
    const empty = module.toggleFacetOption(committed, facet, 'committed', counts);
    assert.deepEqual(empty, { track: [] });
    const flexible = module.toggleFacetOption(empty, facet, 'flexible', counts);
    assert.deepEqual(flexible, { track: ['flexible'] });
    assert.deepEqual(module.toggleFacetOption(flexible, facet, 'committed', counts), { track: ['committed', 'flexible'] });
});

test('resetFacetSelection deletes allow-empty state but preserves ordinary neutral writes', async () => {
    const module = await loadModule();
    assert.deepEqual(module.resetFacetSelection({ track: [] }, TRACK_FACET, TRACK_COUNTS), {});
    const projects = multiFacet('projects', 'Projects', ['Tech', 'Product']);
    assert.deepEqual(
        module.resetFacetSelection({ projects: ['tech'] }, projects, { projects: { tech: 1, product: 1 } }),
        { projects: ['tech', 'product'] },
    );
});

test('ordinary multi facets still treat empty as neutral and hide zero-count options', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Major', 'Minor']);
    const counts = { priority: { major: 2, minor: 0 } };
    const view = viewOf(module, facet, { priority: [] }, counts, 2);
    assert.equal(view.isNeutral, true);
    assert.deepEqual(view.visibleOptions.map((option) => option.id), ['major']);
    assert.deepEqual(view.lockedOptionIds, ['major']);
});

test('buildFacetView treats a single facet absent from selection as its default option', async () => {
    const module = await loadModule();
    const view = viewOf(module, ASSIGNEE_FACET, {}, { assignee: { anyone: 87, unassigned: 4 } }, 87);

    assert.equal(view.isNeutral, true);
    assert.deepEqual(view.activeOptionIds, ['anyone']);
});

/* ── D34 / D33: the heading total is what the facet admits ──────────────────── */

test('buildFacetView reads a neutral facet total from neutralTotal, not the option sum', async () => {
    const module = await loadModule();
    const view = viewOf(module, TRACK_FACET, { track: ['committed', 'flexible'] }, TRACK_COUNTS, 87);

    assert.equal(view.isNeutral, true);
    assert.equal(view.admittedTotal, 87, 'neutral delivery track admits every epic, including untracked ones');
});

test('buildFacetView reads a partial facet total as the sum of its ticked options', async () => {
    const module = await loadModule();
    const view = viewOf(module, TRACK_FACET, { track: ['committed'] }, TRACK_COUNTS, 87);

    assert.equal(view.isNeutral, false);
    assert.equal(view.admittedTotal, 8);
});

test('buildFacetView falls back to the scope total when a neutral facet declares no neutralTotal', async () => {
    const module = await loadModule();
    const facet = multiFacet('projects', 'Projects', ['Tech', 'Product']);
    const view = viewOf(module, facet, { projects: ['tech', 'product'] }, { projects: { tech: 48, product: 39 } }, 87);

    assert.equal(view.admittedTotal, 87);
});

test('buildFacetView totals a single facet from its default and its selection', async () => {
    const module = await loadModule();
    const counts = { assignee: { anyone: 87, unassigned: 4 } };

    const neutral = viewOf(module, ASSIGNEE_FACET, { assignee: ['anyone'] }, counts, 87);
    const narrowed = viewOf(module, ASSIGNEE_FACET, { assignee: ['unassigned'] }, counts, 87);

    assert.equal(neutral.isNeutral, true);
    assert.equal(neutral.admittedTotal, 87);
    assert.equal(narrowed.isNeutral, false);
    assert.equal(narrowed.admittedTotal, 4);
});

/* ── D35: a chip states the shorter truth ───────────────────────────────────── */

const STATUS_LABELS = ['To Do', 'Analysis', 'In Progress', 'Blocked', 'Review', 'Release', 'Done', 'Killed'];
const STATUS_FACET = multiFacet('status', 'Status', STATUS_LABELS);
const STATUS_COUNTS = {
    status: Object.fromEntries(STATUS_LABELS.map((label, index) => [label.toLowerCase(), index + 1])),
};

function chipFor(module, facet, selection, counts, scopeTotal) {
    const view = viewOf(module, facet, selection, counts, scopeTotal);
    return module.describeFacetChip(view, facet);
}

test('describeFacetChip names the excluded options when fewer are excluded than included', async () => {
    const module = await loadModule();
    const selection = { status: STATUS_LABELS.filter((label) => label !== 'Killed').map((label) => label.toLowerCase()) };

    const chip = chipFor(module, STATUS_FACET, selection, STATUS_COUNTS, 36);

    assert.equal(chip.facetLabel, 'Status');
    assert.equal(chip.verb, 'hidden');
    assert.deepEqual(chip.names, ['Killed']);
    assert.equal(chip.overflowCount, 0);
    assert.equal(chip.title, 'Status — hidden Killed');
});

test('describeFacetChip names the included options when more are excluded than included', async () => {
    const module = await loadModule();
    const selection = { status: ['in progress', 'blocked'] };

    const chip = chipFor(module, STATUS_FACET, selection, STATUS_COUNTS, 36);

    assert.equal(chip.verb, 'only');
    assert.deepEqual(chip.names, ['In Progress', 'Blocked']);
    assert.equal(chip.overflowCount, 0);
    assert.equal(chip.title, 'Status — only In Progress, Blocked');
});

test('describeFacetChip breaks the even split towards only, since the rule is strictly fewer excluded', async () => {
    const module = await loadModule();
    const selection = { status: ['to do', 'analysis', 'in progress', 'blocked'] };

    const chip = chipFor(module, STATUS_FACET, selection, STATUS_COUNTS, 36);

    assert.equal(chip.verb, 'only');
    assert.deepEqual(chip.names, ['To Do', 'Analysis']);
    assert.equal(chip.overflowCount, 2);
});

test('describeFacetChip caps the chip at two names and keeps the full list in the title', async () => {
    const module = await loadModule();
    const selection = { status: ['to do', 'analysis', 'in progress', 'blocked', 'review'] };

    const chip = chipFor(module, STATUS_FACET, selection, STATUS_COUNTS, 36);

    assert.equal(chip.verb, 'hidden');
    assert.deepEqual(chip.names, ['Release', 'Done']);
    assert.equal(chip.overflowCount, 1);
    assert.equal(chip.title, 'Status — hidden Release, Done, Killed');
});

test('describeFacetChip returns null for a neutral facet', async () => {
    const module = await loadModule();
    const selection = { status: STATUS_LABELS.map((label) => label.toLowerCase()) };

    assert.equal(chipFor(module, STATUS_FACET, selection, STATUS_COUNTS, 36), null);
    assert.equal(
        chipFor(module, ASSIGNEE_FACET, { assignee: ['anyone'] }, { assignee: { anyone: 87, unassigned: 4 } }, 87),
        null,
    );
});

test('describeFacetChip gives a single facet no verb', async () => {
    const module = await loadModule();

    const chip = chipFor(
        module,
        ASSIGNEE_FACET,
        { assignee: ['unassigned'] },
        { assignee: { anyone: 87, unassigned: 4 } },
        87,
    );

    assert.equal(chip.verb, null);
    assert.deepEqual(chip.names, ['Unassigned only']);
    assert.equal(chip.overflowCount, 0);
    assert.equal(chip.title, 'Assignee — Unassigned only');
});

/* ── reconcileSelection: a scope change must not strand an empty facet ──────── */

test('reconcileSelection drops a ticked option that no longer has anything in scope', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Major']);

    const next = module.reconcileSelection({
        facets: [facet],
        selection: { priority: ['blocker', 'critical'] },
        counts: { priority: { blocker: 0, critical: 25, major: 25 } },
    });

    assert.deepEqual(next, { priority: ['critical'] });
});

test('reconcileSelection resets a facet left with nothing ticked to neutral, never to empty', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Major']);

    const next = module.reconcileSelection({
        facets: [facet],
        selection: { priority: ['blocker'] },
        counts: { priority: { blocker: 0, critical: 25, major: 25 } },
    });

    assert.deepEqual(next, { priority: ['critical', 'major'] });
});

test('reconcileSelection seeds a facet the selection does not mention as neutral', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Major']);

    const next = module.reconcileSelection({
        facets: [facet],
        selection: {},
        counts: { priority: { blocker: 4, critical: 25, major: 0 } },
    });

    assert.deepEqual(next, { priority: ['blocker', 'critical'] });
});

test('reconcileSelection falls a single facet back to its default when its option vanishes', async () => {
    const module = await loadModule();

    const next = module.reconcileSelection({
        facets: [ASSIGNEE_FACET],
        selection: { assignee: ['unassigned'] },
        counts: { assignee: { anyone: 87, unassigned: 0 } },
    });

    assert.deepEqual(next, { assignee: ['anyone'] });
});

test('reconcileSelection keeps a still-valid single selection', async () => {
    const module = await loadModule();

    const next = module.reconcileSelection({
        facets: [ASSIGNEE_FACET],
        selection: { assignee: ['unassigned'] },
        counts: { assignee: { anyone: 87, unassigned: 4 } },
    });

    assert.deepEqual(next, { assignee: ['unassigned'] });
});

/* ── the trigger badge, and the neutral state a chip clear returns to ───────── */

test('countActiveFacets counts only the facets that are filtering', async () => {
    const module = await loadModule();
    const facets = [multiFacet('projects', 'Projects', ['Tech', 'Product']), ASSIGNEE_FACET, TRACK_FACET];
    const views = module.buildFacetView({
        facets,
        selection: { projects: ['tech'], assignee: ['anyone'], track: ['committed', 'flexible'] },
        counts: { projects: { tech: 48, product: 39 }, assignee: { anyone: 87, unassigned: 4 }, ...TRACK_COUNTS },
        scopeTotal: 87,
    });

    assert.deepEqual(views.map((view) => view.isNeutral), [false, true, true]);
    assert.equal(module.countActiveFacets(views), 1);
});

test('neutralFacetSelection ticks every visible option, and picks the default for a single facet', async () => {
    const module = await loadModule();
    const facet = multiFacet('priority', 'Priority', ['Blocker', 'Critical', 'Trivial']);

    assert.deepEqual(
        module.neutralFacetSelection(facet, { priority: { blocker: 4, critical: 25, trivial: 0 } }),
        ['blocker', 'critical'],
    );
    assert.deepEqual(
        module.neutralFacetSelection(ASSIGNEE_FACET, { assignee: { anyone: 87, unassigned: 4 } }),
        ['anyone'],
    );
});
