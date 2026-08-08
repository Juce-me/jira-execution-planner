const test = require('node:test');
const assert = require('node:assert/strict');

// The Board's facet set (§7.2, D13, D19). Unlike Catch Up, there is no legacy state to migrate
// here — the Board never had a filter bar before this — so the module is a plain facet-model +
// resolve pair, no {only|hidden} storage translation.

async function loadModule() {
    return import('../frontend/src/eng/engBoardFilters.js');
}

// epicGroups shape mirrors dashboard.jsx's groupTasksByEpic output: { key, epic, tasks }.
function epicGroup(key, { priority = null, assignee = null, track = null, projectKeys = ['PROD'] } = {}) {
    return {
        key,
        epic: { key, priority, assignee, projectTrack: track },
        tasks: projectKeys.map((projectKey, index) => ({
            key: `${projectKey}-${key}-${index}`,
            fields: { projectKey },
        })),
    };
}

const isTechTask = (task) => task.fields.projectKey === 'TECH';

// Eight epics, five priorities represented, one mixed Tech/Product epic, two unassigned, one
// with no recognised priority at all.
const SCOPE = [
    epicGroup('E-1', { priority: 'Blocker', assignee: { displayName: 'A' }, track: 'Committed', projectKeys: ['TECH'] }),
    epicGroup('E-2', { priority: 'Critical', assignee: { displayName: 'B' }, track: 'Flexible', projectKeys: ['PROD'] }),
    epicGroup('E-3', { priority: 'Major', assignee: null, track: null, projectKeys: ['TECH', 'PROD'] }),
    epicGroup('E-4', { priority: 'Minor', assignee: null, track: null, projectKeys: ['PROD'] }),
    epicGroup('E-5', { priority: 'Low', assignee: { displayName: 'C' }, track: 'Committed', projectKeys: ['TECH'] }),
    epicGroup('E-6', { priority: 'High', assignee: { displayName: 'D' }, track: null, projectKeys: ['PROD'] }),
];

function modelFor(epicGroups = SCOPE) {
    return loadModule().then((module) => module.buildEngBoardFacetModel({ epicGroups, isTechTask }));
}

async function resolved(selection = {}, epicGroups = SCOPE) {
    const module = await loadModule();
    const model = module.buildEngBoardFacetModel({ epicGroups, isTechTask });
    return module.resolveEngBoardFilters({ model, selection });
}

function admittedKeys(filters, epicGroups = SCOPE) {
    return epicGroups.filter((group) => filters.admitsEpic(group)).map((group) => group.key);
}

// ── The facet set (§7.2, D13) ────────────────────────────────────────────────

test('buildEngBoardFacetModel exposes exactly the Board facets, in order', async () => {
    const model = await modelFor();
    assert.deepEqual(model.facets.map((facet) => facet.id), ['priority', 'projects', 'assignee', 'track']);
    assert.deepEqual(model.facets.map((facet) => facet.label), ['Priority', 'Projects', 'Assignee', 'Delivery track']);
    assert.deepEqual(model.facets.map((facet) => facet.kind), ['multi', 'multi', 'single', 'multi']);
});

test('buildEngBoardFacetModel has no Status facet — status is the column (D13)', async () => {
    const model = await modelFor();
    assert.equal(model.facets.map((facet) => facet.id).includes('status'), false);
});

test('buildEngBoardFacetModel exposes the readout subject and unit for the Board', async () => {
    const filters = await resolved();
    assert.equal(filters.subject, 'Filtering epics');
    assert.equal(filters.readoutUnit, `of ${SCOPE.length} epics`);
});

test('Board priority counts and admission use canonical Jira aliases for string and object shapes', async () => {
    const scope = [
        epicGroup('E-HIGH', { priority: 'High' }),
        epicGroup('E-HIGHEST', { priority: { name: 'Highest' } }),
    ];
    const model = await modelFor(scope);
    assert.equal(model.counts.priority.Major, 1);
    assert.equal(model.counts.priority.Blocker, 1);

    assert.deepEqual(admittedKeys(await resolved({ priority: ['Major'] }, scope), scope), ['E-HIGH']);
    assert.deepEqual(admittedKeys(await resolved({ priority: ['Blocker'] }, scope), scope), ['E-HIGHEST']);
});

// ── Delivery track's neutral state is load-bearing (D33) — the plan's own numbers ───────────────

test("delivery track's neutral heading reads the full scope, not the option sum — 8 + 14 against 87", async () => {
    const scope = [
        ...Array.from({ length: 8 }, (_, i) => epicGroup(`C-${i}`, { track: 'Committed' })),
        ...Array.from({ length: 14 }, (_, i) => epicGroup(`F-${i}`, { track: 'Flexible' })),
        ...Array.from({ length: 65 }, (_, i) => epicGroup(`U-${i}`, { track: null })),
    ];
    assert.equal(scope.length, 87);

    const module = await loadModule();
    const model = module.buildEngBoardFacetModel({ epicGroups: scope, isTechTask });
    const trackFacet = model.facets.find((facet) => facet.id === 'track');
    assert.deepEqual(model.counts.track, { committed: 8, flexible: 14 });

    const { buildFacetView } = await import('../frontend/src/eng/engFilterFacets.js');
    const neutralView = buildFacetView({ facets: [trackFacet], selection: {}, counts: model.counts, scopeTotal: model.scopeTotal })[0];
    assert.equal(neutralView.isNeutral, true);
    // The bug this guards: 8 + 14 = 22, which is what an option-sum would report and would
    // silently drop the 65 untracked epics from the heading.
    assert.equal(neutralView.admittedTotal, 87);

    const narrowedView = buildFacetView({
        facets: [trackFacet],
        selection: { track: ['committed'] },
        counts: model.counts,
        scopeTotal: model.scopeTotal,
    })[0];
    assert.equal(narrowedView.admittedTotal, 8);
});

test('resolveEngBoardFilters: both track options ticked admits epics with no track at all', async () => {
    const scope = [epicGroup('T-1', { track: 'Committed' }), epicGroup('T-2', { track: 'Flexible' }), epicGroup('T-3', { track: null })];
    const filters = await resolved({}, scope);
    assert.deepEqual(admittedKeys(filters, scope), ['T-1', 'T-2', 'T-3']);
});

test('resolveEngBoardFilters: narrowing to Committed excludes Flexible and untracked epics', async () => {
    const scope = [epicGroup('T-1', { track: 'Committed' }), epicGroup('T-2', { track: 'Flexible' }), epicGroup('T-3', { track: null })];
    const filters = await resolved({ track: ['committed'] }, scope);
    assert.deepEqual(admittedKeys(filters, scope), ['T-1']);
});

// ── Assignee is a single facet (§7.2) ────────────────────────────────────────

test('buildEngBoardFacetModel: Assignee defaults to Anyone', async () => {
    const model = await modelFor();
    const assigneeFacet = model.facets.find((facet) => facet.id === 'assignee');
    assert.equal(assigneeFacet.defaultOptionId, 'anyone');
    assert.deepEqual(assigneeFacet.options.map((option) => option.id), ['anyone', 'unassigned']);
});

test('resolveEngBoardFilters: Unassigned only narrows to epics with a null assignee', async () => {
    const filters = await resolved({ assignee: ['unassigned'] });
    assert.deepEqual(admittedKeys(filters), ['E-3', 'E-4']);
});

test('resolveEngBoardFilters: Anyone (the default) admits assigned and unassigned epics alike', async () => {
    const filters = await resolved({ assignee: ['anyone'] });
    assert.deepEqual(admittedKeys(filters), SCOPE.map((group) => group.key));
});

// ── Projects: an epic on both sides matches BOTH options (D41) ──────────────

test('a mixed Tech/Product epic is admitted by the Tech option alone', async () => {
    const filters = await resolved({ projects: ['tech'] });
    assert.ok(admittedKeys(filters).includes('E-3'), 'E-3 has a Tech story and must match Tech-only');
});

test('the same mixed epic is admitted by the Product option alone (D41 — not a defect)', async () => {
    const filters = await resolved({ projects: ['product'] });
    assert.ok(admittedKeys(filters).includes('E-3'), 'E-3 has a Product story and must match Product-only');
});

test('a Tech-only epic is excluded once Projects narrows to Product', async () => {
    const filters = await resolved({ projects: ['product'] });
    assert.equal(admittedKeys(filters).includes('E-1'), false);
});

test('a zero-story epic remains admitted while Projects is neutral', async () => {
    const module = await loadModule();
    const zeroStory = epicGroup('E-EMPTY', { projectKeys: [] });
    const groups = module.mergeBoardEpicGroups({
        storyGroups: {},
        epicsInScope: [zeroStory.epic],
        epicDetails: { 'E-EMPTY': zeroStory.epic },
    });
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].tasks, []);
    const filters = await resolved({}, groups);
    assert.deepEqual(admittedKeys(filters, groups), ['E-EMPTY']);
});

// ── D20: zero-count options are hidden; a present option is never hidden ────

test('an option with zero epics in scope is hidden', async () => {
    const model = await modelFor();
    const { buildFacetView } = await import('../frontend/src/eng/engFilterFacets.js');
    const priorityFacet = model.facets.find((facet) => facet.id === 'priority');
    const view = buildFacetView({ facets: [priorityFacet], selection: {}, counts: model.counts, scopeTotal: model.scopeTotal })[0];
    // High canonicalises to Major; Trivial alone has no epic in SCOPE.
    assert.equal(view.visibleOptions.some((option) => option.id === 'Trivial'), false);
});

test('an option with epics in scope is never hidden', async () => {
    const model = await modelFor();
    const { buildFacetView } = await import('../frontend/src/eng/engFilterFacets.js');
    const priorityFacet = model.facets.find((facet) => facet.id === 'priority');
    const view = buildFacetView({ facets: [priorityFacet], selection: {}, counts: model.counts, scopeTotal: model.scopeTotal })[0];
    // 'Low' has exactly one epic (E-5) in scope.
    const low = view.visibleOptions.find((option) => option.id === 'Low');
    assert.ok(low, 'Low must stay visible with a single epic in scope');
    assert.equal(low.count, 1);
});

// ── Composition: two facets narrowed together (mirrors §12.3's Status+Priority case) ────────────

test('Priority and Projects compose to something neither reaches alone', async () => {
    const filters = await resolved({ priority: ['Blocker', 'Critical'], projects: ['tech'] });
    // Blocker/Critical: E-1, E-2. Tech: E-1, E-3. Intersection: E-1 only.
    assert.deepEqual(admittedKeys(filters), ['E-1']);
});

// ── No facet combination reaches an empty facet, even when every facet is narrowed at once ──────

test('narrowing every facet at once never empties a facet, even if it empties the epic list', async () => {
    const filters = await resolved({
        priority: ['Blocker'],
        projects: ['product'],
        assignee: ['unassigned'],
        track: ['flexible'],
    });
    // Every facetView still has at least one active option — the model's own no-empty-set rule —
    // even though the intersection of all four admits zero epics in this fixture.
    filters.facetViews.forEach((view) => {
        assert.ok(view.activeOptionIds.length > 0, `${view.label} must keep at least one active option`);
    });
});

test('an empty epicGroups scope does not throw', async () => {
    const filters = await resolved({}, []);
    assert.equal(filters.scopeTotal, 0);
    assert.deepEqual(admittedKeys(filters, []), []);
});

// ── isTechTask is threaded through the model — admitsEpic no longer takes a second one ──────────

test('the model carries the same isTechTask used to build its counts', async () => {
    const module = await loadModule();
    const model = module.buildEngBoardFacetModel({ epicGroups: SCOPE, isTechTask });
    assert.equal(model.isTechTask, isTechTask);
});

test('admitsEpic takes only the epic group — isTechTask is not a second, desyncable argument', async () => {
    const filters = await resolved();
    // A call site cannot pass a mismatched predicate: there is no parameter for one.
    assert.equal(filters.admitsEpic.length, 1);
});

// ── Defends against a group with no epic, matching engBoardColumns.js's own sibling defence ─────

test('a group with no epic does not throw, in either the model or admitsEpic', async () => {
    const module = await loadModule();
    const noEpicGroups = [{ key: 'NO_EPIC', epic: null, tasks: [{ key: 'PROD-1', fields: { projectKey: 'PROD' } }] }];
    assert.doesNotThrow(() => module.buildEngBoardFacetModel({ epicGroups: noEpicGroups, isTechTask }));
    const model = module.buildEngBoardFacetModel({ epicGroups: noEpicGroups, isTechTask });
    const filters = module.resolveEngBoardFilters({ model, selection: {} });
    assert.doesNotThrow(() => filters.admitsEpic(noEpicGroups[0]));
    // Neutral admits it (no epic means no assignee, no track, and priorityAxisLabel('') -> '').
    assert.equal(filters.admitsEpic(noEpicGroups[0]), true);
});
