const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engCatchUpFilters.js');
}

// Task shape mirrors the app's: fields.status.name, fields.priority.name, fields.projectKey.
function story(key, status, priority, projectKey = 'PROD', epicKey = null) {
    return {
        key,
        fields: {
            status: { name: status },
            priority: priority ? { name: priority } : undefined,
            projectKey,
            epicKey,
        },
    };
}

const isTechTask = (task) => String(task.fields.projectKey || '').toUpperCase() === 'TECH';

// The scope used by most tests: five statuses, five priorities, both projects.
const SCOPE = [
    story('PROD-1', 'To Do', 'Low'),
    story('PROD-2', 'In Progress', 'High'),
    story('PROD-3', 'Blocked', 'Blocker'),
    story('PROD-4', 'Done', 'Critical'),
    story('PROD-5', 'Killed', 'Minor'),
    story('TECH-1', 'In Progress', 'Critical', 'TECH'),
    story('TECH-2', 'To Do', 'Medium', 'TECH'),
];

function modelFor(tasks = SCOPE, epicDetails = {}) {
    return loadModule().then((module) => module.buildEngCatchUpFacetModel({ tasks, isTechTask, epicDetails }));
}

async function resolved(overrides = {}, tasks = SCOPE, epicDetails = {}) {
    const module = await loadModule();
    const model = module.buildEngCatchUpFacetModel({ tasks, isTechTask, epicDetails });
    return module.resolveEngCatchUpFilters({
        model,
        status: null,
        priority: null,
        showTech: true,
        showProduct: true,
        ...overrides,
    });
}

function admittedKeys(filters, tasks = SCOPE) {
    return tasks
        .filter((task) => filters.admitsProject(isTechTask(task)))
        .filter((task) => !filters.admitsProjectTrack || filters.admitsProjectTrack(task))
        .filter((task) => filters.admitsStatus(task.fields.status?.name))
        .filter((task) => filters.admitsPriority(task.fields.priority?.name))
        .map((task) => task.key);
}

// ── The facet model (§7.4 table 1-3, D20) ───────────────────────────────────

test('buildEngCatchUpFacetModel exposes exactly the Catch Up facets, in order', async () => {
    const model = await modelFor();
    assert.deepEqual(model.facets.map((facet) => facet.id), ['status', 'priority', 'projects', 'track']);
    assert.deepEqual(model.facets.map((facet) => facet.label), ['Status', 'Priority', 'Projects', 'Project Track']);
    assert.deepEqual(model.facets.map((facet) => facet.kind), ['multi', 'multi', 'multi', 'multi']);
});

test('buildEngCatchUpFacetModel has an Epic-owned Project Track facet and no Assignee facet', async () => {
    const model = await modelFor();
    const ids = model.facets.map((facet) => facet.id);
    assert.equal(ids.includes('track'), true);
    assert.equal(ids.includes('assignee'), false);
});

test('buildEngCatchUpFacetModel orders statuses in workflow order, not alphabetically', async () => {
    const model = await modelFor();
    const statusFacet = model.facets.find((facet) => facet.id === 'status');
    assert.deepEqual(
        statusFacet.options.map((option) => option.id),
        ['To Do', 'Blocked', 'In Progress', 'Done', 'Killed']
    );
});

test('buildEngCatchUpFacetModel counts statuses over the whole scope, killed included', async () => {
    const model = await modelFor();
    assert.deepEqual(model.counts.status, {
        'To Do': 2,
        'Blocked': 1,
        'In Progress': 2,
        'Done': 1,
        'Killed': 1,
    });
});

test('buildEngCatchUpFacetModel normalizes aliased priorities through PRIORITY_ALIASES', async () => {
    const model = await modelFor();
    // High -> Major and Medium -> Minor; no second normalization is hand-written.
    assert.equal(model.counts.priority.Major, 1);
    assert.equal(model.counts.priority.Minor, 2);
    assert.equal(model.counts.priority.Critical, 2);
    assert.equal(model.counts.priority.Blocker, 1);
    assert.equal(model.counts.priority.Low, 1);
});

test('buildEngCatchUpFacetModel keeps the full PRIORITY_AXIS so zero counts drive D20', async () => {
    const model = await modelFor();
    const priorityFacet = model.facets.find((facet) => facet.id === 'priority');
    assert.deepEqual(
        priorityFacet.options.map((option) => option.id),
        ['Blocker', 'Critical', 'Major', 'Minor', 'Low', 'Trivial']
    );
    assert.equal(model.counts.priority.Trivial, 0);
});

test('buildEngCatchUpFacetModel counts projects as Tech and Product', async () => {
    const model = await modelFor();
    assert.deepEqual(model.counts.projects, { tech: 2, product: 5 });
    const projectsFacet = model.facets.find((facet) => facet.id === 'projects');
    assert.deepEqual(projectsFacet.options, [
        { id: 'tech', label: 'Tech' },
        { id: 'product', label: 'Product' },
    ]);
});

test('buildEngCatchUpFacetModel reports the scope total as every facet neutral total', async () => {
    const model = await modelFor();
    assert.equal(model.scopeTotal, 7);
    model.facets.slice(0, 3).forEach((facet) => assert.equal(facet.neutralTotal, 7));
});

test('buildEngCatchUpFacetModel hides a status with no story in scope', async () => {
    const model = await modelFor([story('PROD-1', 'To Do', 'Low')]);
    const statusFacet = model.facets.find((facet) => facet.id === 'status');
    assert.deepEqual(statusFacet.options.map((option) => option.id), ['To Do']);
});

const TRACK_EPICS = {
    'EPIC-C1': { key: 'EPIC-C1', projectTrack: 'Committed' },
    'EPIC-C2': { key: 'EPIC-C2', projectTrack: ' committed ' },
    'EPIC-F1': { key: 'EPIC-F1', projectTrack: 'Flexible' },
    'EPIC-U1': { key: 'EPIC-U1', projectTrack: null },
    'EPIC-X1': { key: 'EPIC-X1', projectTrack: 'Other' },
};

const TRACK_SCOPE = [
    story('C1-A', 'To Do', 'Major', 'PROD', 'EPIC-C1'),
    story('C1-B', 'In Progress', 'Minor', 'PROD', 'EPIC-C1'),
    story('C2-A', 'To Do', 'Major', 'PROD', 'EPIC-C2'),
    story('F1-A', 'To Do', 'Minor', 'PROD', 'EPIC-F1'),
    story('U1-A', 'Blocked', 'Low', 'PROD', 'EPIC-U1'),
    story('U1-B', 'To Do', 'Low', 'PROD', 'EPIC-U1'),
    story('X1-A', 'To Do', 'Low', 'PROD', 'EPIC-X1'),
    story('NO-EPIC', 'To Do', 'Low'),
];

test('Catch Up Project Track counts unique existing Epics, not Stories', async () => {
    const model = await modelFor(TRACK_SCOPE, TRACK_EPICS);
    const track = model.facets.find((facet) => facet.id === 'track');
    assert.equal(track.label, 'Project Track');
    assert.equal(track.allowEmpty, true);
    assert.equal(track.showZeroCountOptions, true);
    assert.equal(track.neutralTotal, 5);
    assert.equal(track.emptyTotal, 1);
    assert.deepEqual(model.counts.track, { committed: 2, flexible: 1 });
    assert.deepEqual(track.options, [
        { id: 'committed', label: 'Committed' },
        { id: 'flexible', label: 'Flexible' },
    ]);
});

test('Catch Up Project Track filters Stories through their parent Epic', async () => {
    const neutral = await resolved({}, TRACK_SCOPE, TRACK_EPICS);
    assert.deepEqual(admittedKeys(neutral, TRACK_SCOPE), TRACK_SCOPE.map((task) => task.key));

    const committed = await resolved({ track: ['committed'] }, TRACK_SCOPE, TRACK_EPICS);
    assert.deepEqual(admittedKeys(committed, TRACK_SCOPE), ['C1-A', 'C1-B', 'C2-A']);

    const flexible = await resolved({ track: ['flexible'] }, TRACK_SCOPE, TRACK_EPICS);
    assert.deepEqual(admittedKeys(flexible, TRACK_SCOPE), ['F1-A']);
});

test('Catch Up explicit empty admits only Stories under genuinely unset existing Epics', async () => {
    const filters = await resolved({ track: [] }, TRACK_SCOPE, TRACK_EPICS);
    assert.deepEqual(admittedKeys(filters, TRACK_SCOPE), ['U1-A', 'U1-B']);
    const trackView = filters.facetViews.find((facet) => facet.id === 'track');
    assert.equal(trackView.isEmptySelection, true);
    assert.equal(trackView.admittedTotal, 1);
});

// ── Closed work (the two Display toggles' reach) ─────────────────────────────

test('isEngClosedWorkStatus covers exactly Done, Incomplete and Killed', async () => {
    const { isEngClosedWorkStatus } = await loadModule();
    assert.equal(isEngClosedWorkStatus('Done'), true);
    assert.equal(isEngClosedWorkStatus('Killed'), true);
    assert.equal(isEngClosedWorkStatus('Incomplete'), true);
    assert.equal(isEngClosedWorkStatus('incomplete'), true);
    assert.equal(isEngClosedWorkStatus('In Progress'), false);
    assert.equal(isEngClosedWorkStatus('To Do'), false);
    assert.equal(isEngClosedWorkStatus(undefined), false);
});

// ── Migration of the saved prefs (the §7.4 mapping table) ────────────────────

test('migrateEngCatchUpFilters defaults a fresh user to hiding Killed only', async () => {
    const { migrateEngCatchUpFilters, DEFAULT_ENG_STATUS_FILTER } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({}), { status: DEFAULT_ENG_STATUS_FILTER, priority: null });
    assert.deepEqual(DEFAULT_ENG_STATUS_FILTER, { hidden: ['Killed'] });
});

test('migrateEngCatchUpFilters maps statusFilter in-progress to Status only In Progress', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'in-progress' }), {
        status: { only: ['In Progress'] },
        priority: null,
    });
});

test('migrateEngCatchUpFilters maps todo-accepted to the three queued statuses', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'todo-accepted' }), {
        status: { only: ['To Do', 'Pending', 'Accepted'] },
        priority: null,
    });
});

test('migrateEngCatchUpFilters maps done to Status only Done even when showDone was false', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    // Today's predicate escapes the Done display toggle for this exact filter
    // (`!showDone && statusFilter !== 'done'`), so Done must still be admitted.
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'done', showDone: false }), {
        status: { only: ['Done'] },
        priority: null,
    });
});

test('migrateEngCatchUpFilters maps high-priority to Blocker, Critical and Major', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'high-priority' }).priority, {
        only: ['Blocker', 'Critical', 'Major'],
    });
});

test('migrateEngCatchUpFilters maps minor-priority to Minor, Low and Trivial', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'minor-priority' }).priority, {
        only: ['Minor', 'Low', 'Trivial'],
    });
});

test('migrateEngCatchUpFilters keeps hiding Killed alongside a saved priority filter', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'high-priority', showKilled: false }), {
        status: { hidden: ['Killed'] },
        priority: { only: ['Blocker', 'Critical', 'Major'] },
    });
});

test('migrateEngCatchUpFilters turns showDone false into hidden Done and Incomplete', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ showDone: false, showKilled: false }).status, {
        hidden: ['Killed', 'Done', 'Incomplete'],
    });
});

test('migrateEngCatchUpFilters hides nothing when showKilled was true', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    assert.deepEqual(migrateEngCatchUpFilters({ showKilled: true }), { status: null, priority: null });
});

test('migrateEngCatchUpFilters treats the legacy killed statusFilter as showKilled', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    // dashboard.jsx:397-404 already normalized statusFilter 'killed' to showKilled = true and
    // statusFilter = null, so the stories admitted are all of them, not only the killed ones.
    assert.deepEqual(migrateEngCatchUpFilters({ statusFilter: 'killed', showKilled: false }), {
        status: null,
        priority: null,
    });
});

// ── Resolving stored filters into predicates ─────────────────────────────────

test('resolveEngCatchUpFilters admits every story when nothing is stored', async () => {
    const filters = await resolved();
    assert.deepEqual(admittedKeys(filters), SCOPE.map((task) => task.key));
    assert.equal(filters.activeFacetCount, 0);
});

test('resolveEngCatchUpFilters drops the hidden statuses and keeps the rest', async () => {
    const filters = await resolved({ status: { hidden: ['Killed'] } });
    assert.deepEqual(admittedKeys(filters), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4', 'TECH-1', 'TECH-2']);
});

test('resolveEngCatchUpFilters admits only the named statuses for an only filter', async () => {
    const filters = await resolved({ status: { only: ['In Progress'] } });
    assert.deepEqual(admittedKeys(filters), ['PROD-2', 'TECH-1']);
});

test('resolveEngCatchUpFilters matches a stored status id case-insensitively', async () => {
    const filters = await resolved({ status: { only: ['in progress'] } });
    assert.deepEqual(admittedKeys(filters), ['PROD-2', 'TECH-1']);
});

test('resolveEngCatchUpFilters admits an unprioritized story while Priority is neutral', async () => {
    const scope = [story('PROD-1', 'To Do', null), story('PROD-2', 'To Do', 'Blocker')];
    const filters = await resolved({}, scope);
    assert.deepEqual(admittedKeys(filters, scope), ['PROD-1', 'PROD-2']);
});

test('resolveEngCatchUpFilters excludes an unprioritized story once Priority narrows', async () => {
    const scope = [
        story('PROD-1', 'To Do', null),
        story('PROD-2', 'To Do', 'Blocker'),
        story('PROD-3', 'To Do', 'Low'),
    ];
    const filters = await resolved({ priority: { only: ['Blocker'] } }, scope);
    assert.deepEqual(admittedKeys(filters, scope), ['PROD-2']);
});

test('resolveEngCatchUpFilters composes Status and Priority orthogonally', async () => {
    // The state today's single select cannot reach: two dimensions at once.
    const filters = await resolved({
        status: { only: ['In Progress', 'Blocked'] },
        priority: { only: ['Blocker', 'Critical', 'Major'] },
    });
    assert.deepEqual(admittedKeys(filters), ['PROD-2', 'PROD-3', 'TECH-1']);
    assert.equal(filters.activeFacetCount, 2);
});

test('resolveEngCatchUpFilters narrows further than either facet alone', async () => {
    const statusOnly = await resolved({ status: { only: ['In Progress', 'Blocked'] } });
    const priorityOnly = await resolved({ priority: { only: ['Blocker', 'Critical'] } });
    const both = await resolved({
        status: { only: ['In Progress', 'Blocked'] },
        priority: { only: ['Blocker', 'Critical'] },
    });
    assert.deepEqual(admittedKeys(both), ['PROD-3', 'TECH-1']);
    assert.ok(admittedKeys(both).length < admittedKeys(statusOnly).length);
    assert.ok(admittedKeys(both).length < admittedKeys(priorityOnly).length);
});

test('resolveEngCatchUpFilters reconciles a stale selection back to neutral', async () => {
    // Residual note 1: a selection made under one scope must not strand the bar when the
    // scope changes to one where those options have no stories left.
    const scope = [story('PROD-1', 'To Do', 'Low')];
    const filters = await resolved({ status: { only: ['Done'] } }, scope);
    assert.deepEqual(admittedKeys(filters, scope), ['PROD-1']);
    assert.equal(filters.facetViews[0].isNeutral, true);
    assert.equal(filters.activeFacetCount, 0);
});

test('resolveEngCatchUpFilters keeps the surviving half of a partly stale selection', async () => {
    const scope = [story('PROD-1', 'To Do', 'Low'), story('PROD-2', 'Done', 'Low')];
    const filters = await resolved({ status: { only: ['Done', 'Blocked'] } }, scope);
    assert.deepEqual(admittedKeys(filters, scope), ['PROD-2']);
});

test('resolveEngCatchUpFilters drives project admission from the facet, not the raw booleans', async () => {
    const bothOff = await resolved({ showTech: false, showProduct: false });
    // No facet can reach an empty set, so both-off resolves to neutral rather than blanking.
    assert.deepEqual(admittedKeys(bothOff), SCOPE.map((task) => task.key));
    const techOnly = await resolved({ showProduct: false });
    assert.deepEqual(admittedKeys(techOnly), ['TECH-1', 'TECH-2']);
});

test('resolveEngCatchUpFilters states the Catch Up subject and story unit', async () => {
    const filters = await resolved();
    assert.equal(filters.subject, 'Filtering stories');
    assert.equal(filters.readoutUnit, 'of 7 stories');
});

// ── Writing the bar's selection back to stored state ─────────────────────────

test('readEngCatchUpFilterState collapses an all-ticked facet to neutral', async () => {
    const module = await loadModule();
    const filters = await resolved();
    const next = module.readEngCatchUpFilterState(filters.selection, filters.facetViews);
    assert.deepEqual(next, { status: null, priority: null, showTech: true, showProduct: true });
});

test('readEngCatchUpFilterState stores the excluded side when it is smaller', async () => {
    const module = await loadModule();
    const filters = await resolved();
    const selection = {
        ...filters.selection,
        status: ['To Do', 'Blocked', 'In Progress', 'Done'],
    };
    assert.deepEqual(module.readEngCatchUpFilterState(selection, filters.facetViews).status, {
        hidden: ['Killed'],
    });
});

test('readEngCatchUpFilterState stores the included side when it is smaller or equal', async () => {
    const module = await loadModule();
    const filters = await resolved();
    const selection = { ...filters.selection, status: ['In Progress'] };
    assert.deepEqual(module.readEngCatchUpFilterState(selection, filters.facetViews).status, {
        only: ['In Progress'],
    });
});

test('readEngCatchUpFilterState maps the Projects facet back onto the two toggles', async () => {
    const module = await loadModule();
    const filters = await resolved();
    const selection = { ...filters.selection, projects: ['product'] };
    const next = module.readEngCatchUpFilterState(selection, filters.facetViews);
    assert.equal(next.showTech, false);
    assert.equal(next.showProduct, true);
});

test('readEngCatchUpFilterState round-trips a stored filter through resolve unchanged', async () => {
    const module = await loadModule();
    const filters = await resolved({ status: { hidden: ['Killed'] } });
    const next = module.readEngCatchUpFilterState(filters.selection, filters.facetViews);
    assert.deepEqual(next.status, { hidden: ['Killed'] });
    assert.deepEqual(next.priority, null);
});

test('readEngCatchUpFilterState preserves explicit empty Track and omits neutral Track', async () => {
    const module = await loadModule();
    const neutral = await resolved({}, TRACK_SCOPE, TRACK_EPICS);
    const neutralState = module.readEngCatchUpFilterState(neutral.selection, neutral.facetViews);
    assert.equal(Object.prototype.hasOwnProperty.call(neutralState, 'track'), false);

    const emptySelection = { ...neutral.selection, track: [] };
    const emptyState = module.readEngCatchUpFilterState(emptySelection, neutral.facetViews);
    assert.deepEqual(emptyState.track, []);

    const committedSelection = { ...neutral.selection, track: ['committed'] };
    const committedState = module.readEngCatchUpFilterState(committedSelection, neutral.facetViews);
    assert.deepEqual(committedState.track, ['committed']);
});

// ── Out-of-scope entries survive an edit to any facet ────────────────────────
// D20 hides an option with no story in scope, so the user cannot untick it and cannot mean to.
// Recomputing the stored value from the ticked list alone silently dropped it, which widened
// the filter as soon as the next scope had one — the exact guarantee showKilled: false gave.

// A sprint with no Killed and no Incomplete story, so both are out of the Status facet.
const NO_CLOSED_WORK_SCOPE = [
    story('PROD-1', 'To Do', 'Low'),
    story('PROD-2', 'In Progress', 'Major'),
    story('PROD-3', 'Done', 'Critical'),
    story('TECH-1', 'In Progress', 'Blocker', 'TECH'),
];

async function editedState(stored, mutate, tasks = NO_CLOSED_WORK_SCOPE) {
    const module = await loadModule();
    const filters = await resolved(stored, tasks);
    const nextSelection = mutate({ ...filters.selection });
    return module.readEngCatchUpFilterState(nextSelection, filters.facetViews, stored);
}

test('a Status edit keeps hiding a status that has no story in this scope', async () => {
    const next = await editedState(
        { status: { hidden: ['Killed'] } },
        (selection) => ({ ...selection, status: ['To Do', 'In Progress'] })
    );
    assert.deepEqual(next.status, { hidden: ['Done', 'Killed'] });
});

test('a Priority edit keeps hiding a status that has no story in this scope', async () => {
    // handleEngFacetChange rewrites status and priority together, so a Priority tick used to
    // erase the Killed exclusion just as surely as a Status tick did.
    const next = await editedState(
        { status: { hidden: ['Killed'] } },
        (selection) => ({ ...selection, priority: ['Blocker', 'Critical'] })
    );
    assert.deepEqual(next.status, { hidden: ['Killed'] });
    assert.deepEqual(next.priority, { only: ['Blocker', 'Critical'] });
});

test('a Projects edit keeps hiding a status that has no story in this scope', async () => {
    const next = await editedState(
        { status: { hidden: ['Killed'] } },
        (selection) => ({ ...selection, projects: ['product'] })
    );
    assert.deepEqual(next.status, { hidden: ['Killed'] });
    assert.equal(next.showTech, false);
});

test('the showDone migration keeps Incomplete hidden after one unrelated tick', async () => {
    const { migrateEngCatchUpFilters } = await loadModule();
    const stored = { status: migrateEngCatchUpFilters({ showDone: false, showKilled: false }).status };
    assert.deepEqual(stored.status, { hidden: ['Killed', 'Done', 'Incomplete'] });
    // An active sprint has no Killed and no Incomplete story, so only Done is tickable.
    const next = await editedState(stored, (selection) => ({ ...selection, projects: ['product'] }));
    assert.deepEqual(next.status, { hidden: ['Done', 'Killed', 'Incomplete'] });
});

test('an only filter keeps a named status that has no story in this scope', async () => {
    // The mirror image: `{ only: [...] }` names everything it admits, so dropping an
    // out-of-scope name narrows the filter the user never narrowed.
    const next = await editedState(
        { status: { only: ['To Do', 'Pending', 'Accepted'] } },
        (selection) => ({ ...selection, priority: ['Blocker'] })
    );
    assert.deepEqual(next.status, { only: ['To Do', 'Pending', 'Accepted'] });
});

test('ticking every visible option clears an only filter but keeps an exclusion', async () => {
    // All ticked reads as neutral in the bar. A carried exclusion is consistent with that; a
    // carried inclusion list would contradict it, so only the exclusion survives.
    const cleared = await editedState(
        { status: { only: ['To Do', 'Pending'] } },
        (selection) => ({ ...selection, status: ['To Do', 'In Progress', 'Done'] })
    );
    assert.equal(cleared.status, null);
    const kept = await editedState(
        { status: { hidden: ['Killed'] } },
        (selection) => ({ ...selection, status: ['To Do', 'In Progress', 'Done'] })
    );
    assert.deepEqual(kept.status, { hidden: ['Killed'] });
});

// ── The planning pool sees exclusions only ───────────────────────────────────

test('admitsStatusForPlanning drops closed work the Status facet excludes', async () => {
    const filters = await resolved({ status: { hidden: ['Killed'] } });
    assert.equal(filters.admitsStatusForPlanning('Killed'), false);
    assert.equal(filters.admitsStatusForPlanning('Done'), true);
});

test('admitsStatusForPlanning ignores an only narrowing so planning keeps its stories', async () => {
    // baseFilteredTasks feeds resolvePlanningSelectionForDashboard, which then persists the
    // pruned set. Only the two Display toggles ever reached it, and both were exclusions.
    const filters = await resolved({ status: { only: ['In Progress'] } });
    assert.equal(filters.admitsStatus('Done'), false);
    assert.equal(filters.admitsStatusForPlanning('Done'), true);
    assert.equal(filters.admitsStatusForPlanning('Killed'), true);
});

test('admitsStatusForPlanning admits everything while Status is neutral', async () => {
    const filters = await resolved();
    assert.equal(filters.admitsStatusForPlanning('Killed'), true);
    assert.equal(filters.admitsStatusForPlanning('Done'), true);
});
