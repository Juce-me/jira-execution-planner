const test = require('node:test');
const assert = require('node:assert/strict');

const loadModel = () => import('../frontend/src/settings/workConfigurationModel.js');
const loadHook = () => import('../frontend/src/settings/useWorkConfigurationSettings.js');
const loadApi = () => import('../frontend/src/api/configApi.js');

const field = (fieldId = '', fieldName = '') => ({ fieldId, fieldName });
const legacyFields = () => ({
    sprint: field('customfield_10101', 'Sprint'), storyPoints: field('customfield_10102', 'Story Points'),
    parentName: field(), team: field('customfield_10103', 'Team'), projectTrack: field(), deliveryOwner: field(),
});
function legacy(overrides = {}) {
    return {
        id: 'legacy', name: 'Legacy', revision: 0, fromQuarter: null, throughQuarter: '2026Q4', model: 'legacy',
        scope: { projects: [{ key: 'OLD', type: 'product' }], boardId: '7001' },
        legacyIssueTypeNames: ['Story'], legacyDisplayTypes: { parent: null, ancestor: null },
        legacyHierarchyModes: { parent: 'compatibility', ancestor: 'compatibility' },
        hierarchy: { planningIssueTypeId: null, parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: legacyFields(), ...overrides,
    };
}
function delivery(overrides = {}) {
    return {
        id: 'delivery', name: 'DELIVERY', revision: 0, fromQuarter: '2027Q1', throughQuarter: null, model: 'rnd_2027',
        scope: { projects: [], boardId: '' },
        hierarchy: { planningIssueTypeId: null, parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { ...legacyFields(), sprint: field(), storyPoints: field(), team: field(), allocation: field() },
        ...overrides,
    };
}
const bundle = (entries = [legacy(), delivery()], promotionRevision = null) => ({ version: 1, promotionRevision, configurations: entries });

test('a field patch changes only its own value, so a stale mapping callback cannot undo a rename', async () => {
    const { patchBundleEntry, entryById } = await loadModel();
    let draft = bundle();
    draft = patchBundleEntry(draft, 'delivery', { name: 'DELIVERY Q1' });
    // A mapping callback created before the rename emits only its own field patch.
    draft = patchBundleEntry(draft, 'delivery', { fields: { sprint: field('customfield_1', 'Sprint') } });
    assert.equal(entryById(draft, 'delivery').name, 'DELIVERY Q1');
    assert.deepEqual(entryById(draft, 'delivery').fields.sprint, { ...field('customfield_1', 'Sprint'), mode: 'own' }, 'an edit makes the mapping DELIVERY\'s own');
    assert.deepEqual(entryById(draft, 'delivery').fields.team, field(), 'untouched fields are preserved');
});

test('a Legacy slot patch moves the id and the durable mode together; DELIVERY has no mode', async () => {
    const { patchBundleEntry, entryById } = await loadModel();
    let draft = patchBundleEntry(bundle(), 'legacy', { hierarchy: { parentIssueTypeId: '10001' } });
    assert.equal(entryById(draft, 'legacy').hierarchy.parentIssueTypeId, '10001');
    assert.equal(entryById(draft, 'legacy').legacyHierarchyModes.parent, 'mapped');
    assert.equal(entryById(draft, 'legacy').legacyHierarchyModes.ancestor, 'compatibility');
    draft = patchBundleEntry(draft, 'legacy', { hierarchy: { ancestorIssueTypeId: null } });
    assert.equal(entryById(draft, 'legacy').legacyHierarchyModes.ancestor, 'mapped', 'a clear is an explicit mapped null');
    assert.equal(entryById(draft, 'legacy').hierarchy.ancestorIssueTypeId, null);
    draft = patchBundleEntry(draft, 'delivery', { hierarchy: { planningIssueTypeId: '10002' } });
    assert.equal('legacyHierarchyModes' in entryById(draft, 'delivery'), false);
});

test('DELIVERY accepts one project (type other) and refuses a second for every caller', async () => {
    const { addProjectToEntry } = await loadModel();
    const first = addProjectToEntry(delivery(), 'PLAN', 'product');
    assert.deepEqual(first, { projects: [{ key: 'PLAN', type: 'other' }], rejected: false });
    const second = addProjectToEntry(delivery({ scope: { projects: first.projects, boardId: '' } }), 'EXTRA', 'other');
    assert.equal(second.rejected, true);
    assert.deepEqual(second.projects, first.projects);
    const again = addProjectToEntry(delivery({ scope: { projects: first.projects, boardId: '' } }), 'PLAN');
    assert.equal(again.rejected, false, 're-adding the selected project is a no-op, not a limit error');
    const legacyAdd = addProjectToEntry(legacy(), 'NEW');
    assert.deepEqual(legacyAdd.projects.at(-1), { key: 'NEW', type: 'product' }, 'Legacy keeps its product default and multi-project scope');
});

test('validation: quarter grammar, ordering, contiguity, names and one-project limit', async () => {
    const { validateBundle } = await loadModel();
    assert.deepEqual(validateBundle(bundle()).messages, []);
    const bad = validateBundle(bundle([legacy({ throughQuarter: '2026q4' }), delivery()]));
    assert.match(bad.errors.legacy.throughQuarter, /YYYYQ1/);
    for (const value of ['2026Q5', ' 2026Q4', '0000Q1', '20260Q1']) {
        assert.ok(validateBundle(bundle([legacy({ throughQuarter: value }), delivery()])).errors.legacy.throughQuarter, value);
    }
    assert.match(validateBundle(bundle([legacy({ throughQuarter: '2026Q3' }), delivery()])).errors.delivery.fromQuarter, /leave a gap/);
    assert.match(validateBundle(bundle([legacy({ throughQuarter: '2027Q1' }), delivery()])).errors.legacy.throughQuarter, /overlap/);
    assert.match(validateBundle(bundle([legacy({ name: ' ' }), delivery()])).errors.legacy.name, /Enter a configuration name/);
    assert.match(validateBundle(bundle([legacy({ name: 'delivery' }), delivery()])).errors.legacy.name, /different name/);
    const two = delivery({ scope: { projects: [{ key: 'A', type: 'other' }, { key: 'B', type: 'other' }], boardId: '' } });
    assert.equal(validateBundle(bundle([legacy(), two])).errors.delivery.projects, 'DELIVERY uses one Jira project');
    assert.ok(validateBundle(bundle([legacy(), two])).messages.includes('DELIVERY: DELIVERY uses one Jira project'));
});

test('incomplete mappings are reported by Jira entity name, never block Save', async () => {
    const { missingMappings, missingSummary } = await loadModel();
    assert.deepEqual(missingMappings(delivery({ scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' } })),
        ['Board', 'Sprint', 'Story Points', 'Team', 'Epic', 'Initiative']);
    const half = delivery({
        scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' },
        hierarchy: { planningIssueTypeId: '10002', parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { ...delivery().fields, sprint: field('s', 'Sprint'), storyPoints: field('p', 'SP'), team: field('t', 'Team') },
    });
    assert.deepEqual(missingMappings(half), ['Board', 'Initiative'], 'the Board is required');
    // Within the bundle the Legacy Board is inherited, so only the Initiative is missing.
    assert.equal(missingSummary(bundle([legacy(), half])), 'DELIVERY: missing Initiative.');
    // An id absent from a loaded catalog is reported, never dropped.
    assert.deepEqual(missingMappings(half, { types: { 10003: {} } }), ['Board', 'Epic (10002: not found in Jira)', 'Initiative']);
    // Captured Legacy filters and compatibility slots satisfy their rows.
    assert.deepEqual(missingMappings(legacy()), []);
    assert.deepEqual(missingMappings(legacy({ legacyHierarchyModes: { parent: 'mapped', ancestor: 'compatibility' } })), ['Epic']);
});

test('first save derives legacyEdits only for real Legacy changes and echoes the whole bundle', async () => {
    const { buildSaveRequest, patchBundleEntry } = await loadModel();
    const baseline = bundle();
    let draft = patchBundleEntry(baseline, 'legacy', { name: 'Legacy 2026', scope: { boardId: '' }, fields: { team: field('customfield_9', 'Team v2') } });
    draft = patchBundleEntry(draft, 'delivery', { name: 'DELIVERY Q1', scope: { projects: [{ key: 'PLAN', type: 'other' }] } });
    const request = buildSaveRequest({ baseline, draft, promoted: false, baseRevision: 0 });
    assert.equal(request.baseRevision, 0);
    assert.deepEqual(request.workConfigurations, draft);
    assert.equal('clearProjectsForConfigurationIds' in request, false);
    assert.deepEqual(request.legacyEdits, [
        { path: 'name', value: 'Legacy 2026' },
        { path: 'scope.boardId', clear: true },
        { path: 'fields.team.fieldId', value: 'customfield_9' },
        { path: 'fields.team.fieldName', value: 'Team v2' },
    ]);
    assert.deepEqual(buildSaveRequest({ baseline, draft: baseline, promoted: false, baseRevision: 3 }).legacyEdits, []);
});

test('first save encodes captured-filter retirement and explicit slot clears as clears', async () => {
    const { buildSaveRequest, patchBundleEntry } = await loadModel();
    const baseline = bundle();
    // Retire the captured name filter by removing the planning mapping: both ids stay null.
    let draft = patchBundleEntry(baseline, 'legacy', { legacyIssueTypeNames: null, hierarchy: { planningIssueTypeId: null } });
    assert.deepEqual(buildSaveRequest({ baseline, draft, promoted: false, baseRevision: 1 }).legacyEdits,
        [{ path: 'hierarchy.planningIssueTypeId', clear: true }]);
    // Same-id replacement is still an edit when the filter retires.
    draft = patchBundleEntry(baseline, 'legacy', { legacyIssueTypeNames: null, hierarchy: { planningIssueTypeId: '10001' } });
    assert.deepEqual(buildSaveRequest({ baseline, draft, promoted: false, baseRevision: 1 }).legacyEdits,
        [{ path: 'hierarchy.planningIssueTypeId', value: '10001' }]);
    // Clearing the parent slot (compatibility -> mapped null) is a real clear; mapped null stays blank on re-save.
    draft = patchBundleEntry(baseline, 'legacy', { hierarchy: { parentIssueTypeId: null } });
    assert.deepEqual(buildSaveRequest({ baseline, draft, promoted: false, baseRevision: 1 }).legacyEdits,
        [{ path: 'hierarchy.parentIssueTypeId', clear: true }]);
    const mapped = patchBundleEntry(bundle([legacy({ legacyHierarchyModes: { parent: 'mapped', ancestor: 'compatibility' } }), delivery()], 5), 'legacy', {});
    assert.deepEqual(buildSaveRequest({ baseline: mapped, draft: mapped, promoted: true, baseRevision: 5 }).clearProjectsForConfigurationIds, []);
});

test('later saves post the whole bundle; project clears need an explicit clear gesture', async () => {
    const { buildSaveRequest, patchBundleEntry } = await loadModel();
    const planned = delivery({ scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' }, revision: 1 });
    const baseline = bundle([legacy({ revision: 1 }), planned], 7);
    const cleared = patchBundleEntry(baseline, 'delivery', { scope: { projects: [] } });
    const explicit = buildSaveRequest({ baseline, draft: cleared, promoted: true, baseRevision: 7, explicitClears: new Set(['delivery']) });
    assert.deepEqual(explicit, { baseRevision: 7, workConfigurations: cleared, clearProjectsForConfigurationIds: ['delivery'] });
    const echoed = buildSaveRequest({ baseline, draft: cleared, promoted: true, baseRevision: 7, explicitClears: new Set() });
    assert.deepEqual(echoed.clearProjectsForConfigurationIds, [], 'an empty echo without the gesture is not a clear');
    assert.equal('legacyEdits' in explicit, false);
});

test('Keep mine adopts only server-owned parts and keeps the draft; a retired filter is not un-retired', async () => {
    const { adoptServerOwned, rebaseOntoLatest, entryById } = await loadModel();
    const draft = bundle([legacy({ name: 'My Legacy', legacyIssueTypeNames: ['Story'] }), delivery({ name: 'Mine' })]);
    const latest = bundle([
        legacy({ revision: 4, name: 'Theirs', legacyIssueTypeNames: null, legacyDisplayTypes: { parent: { id: '10001', name: 'Epic' }, ancestor: null } }),
        delivery({ revision: 3, name: 'Their delivery' }),
    ], 9);
    const rebased = rebaseOntoLatest(draft, latest);
    assert.equal(rebased.promoted, true);
    const mine = entryById(rebased.draft, 'legacy');
    assert.equal(mine.name, 'My Legacy', 'editor-owned fields stay the user draft');
    assert.equal(mine.revision, 4);
    assert.deepEqual(mine.legacyDisplayTypes.parent, { id: '10001', name: 'Epic' });
    assert.deepEqual(mine.legacyIssueTypeNames, ['Story'], 'the draft still carries the retired filter, so the server can refuse it explicitly');
    assert.equal(rebased.draft.promotionRevision, 9);
    assert.equal(entryById(rebased.baseline, 'delivery').name, 'Their delivery');
    assert.equal(adoptServerOwned(null, latest), null);
});

test('a compatibility-retired 400 maps to a preserved-draft field error with configuration and slot', async () => {
    const { fieldErrorFromServer } = await loadModel();
    assert.deepEqual(fieldErrorFromServer({
        error: 'invalid_work_configurations', configurationId: 'legacy', slot: 'planningIssueTypeId', message: 'retired elsewhere',
    }), { configurationId: 'legacy', slot: 'planningIssueTypeId', message: 'retired elsewhere' });
    assert.equal(fieldErrorFromServer({ error: 'invalid_work_configurations', paths: ['name'] }), null);
    assert.equal(fieldErrorFromServer({ error: 'workspace_config_conflict', configurationId: 'legacy', slot: 'x' }), null);
});

test('hierarchy picker offers only types used by the selected project and flags a saved outside type', async () => {
    const { describeHierarchyRow, normalizeIssueTypes } = await loadModel();
    const types = normalizeIssueTypes([
        { id: '6', name: 'Epic', hierarchyLevel: 1, projectIds: [] },
        { id: '11709', name: 'Epic', hierarchyLevel: 1, projectIds: ['10'] },
        { id: '13401', name: 'Epic', hierarchyLevel: 1, projectIds: [] },
    ]);
    const row = entry => describeHierarchyRow({ entry, slot: 'planningIssueTypeId', index: 0, types, catalogState: 'ready' });
    const scoped = delivery({ scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' }, hierarchy: { planningIssueTypeId: '13401', parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null } });
    assert.deepEqual(row(scoped).options.map(option => option.id), ['11709']);
    assert.equal(row(scoped).status, 'resolved');
    assert.match(row(scoped).selected.name, /not used by the selected project/, 'a saved id outside the project stays visible and removable');
    assert.equal(row(scoped).selected.id, '13401');
    const noProjects = delivery({ scope: { projects: [], boardId: '' } });
    assert.deepEqual(row(noProjects).options.map(option => option.id), ['6', '11709', '13401'], 'no selected project means no applicability filter');
});

test('hierarchy rows: loading, error, resolved, unresolved, duplicate names, unknown level', async () => {
    const { describeHierarchyRow, normalizeIssueTypes } = await loadModel();
    const types = normalizeIssueTypes([
        { id: '2', name: 'Epic', hierarchyLevel: 1, projectIds: ['10'] }, { id: '8', name: 'Epic', hierarchyLevel: 1, projectIds: ['10'] },
        { id: '13', name: 'Epic', hierarchyLevel: 1, projectIds: [] },
        { id: '3', name: 'Initiative', hierarchyLevel: 2, projectIds: ['10'] }, { id: '7', name: 'Mystery', hierarchyLevel: null, projectIds: ['10'] },
        { id: '9', name: 'Sub', hierarchyLevel: 1, subtask: true, projectIds: ['10'] },
    ]);
    const entry = delivery({ scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' }, hierarchy: { planningIssueTypeId: '2', parentIssueTypeId: '999', ancestorIssueTypeId: '7', optionalAncestorIssueTypeId: null } });
    const ready = slot => describeHierarchyRow({ entry, slot: ['planningIssueTypeId', 'parentIssueTypeId', 'ancestorIssueTypeId'][slot], index: slot, types, catalogState: 'ready' });
    assert.equal(ready(0).status, 'resolved');
    assert.deepEqual(ready(0).options.map(option => option.id), ['2', '8'], 'only types used by the selected project are offered; subtasks are excluded');
    assert.ok(ready(0).options.every(option => option.name === 'Epic'), 'the picker row appends the id, so the name is not repeated with it');
    assert.equal(ready(0).selected.name, 'Epic', 'a duplicate name never repeats the id: the Jira IDs setting shows it once');
    const keyed = normalizeIssueTypes([
        { id: '2', name: 'Epic', hierarchyLevel: 1, projectIds: ['10'], projectKeys: ['PLAN'] },
        { id: '8', name: 'Epic', hierarchyLevel: 1, projectIds: ['11'], projectKeys: ['OPS'] },
    ]);
    const keyedRow = describeHierarchyRow({ entry: delivery({ scope: { projects: [{ key: 'PLAN', type: 'other' }, { key: 'OPS', type: 'other' }], boardId: '' }, hierarchy: { planningIssueTypeId: '8', parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null } }), slot: 'planningIssueTypeId', index: 0, types: keyed, catalogState: 'ready' });
    assert.equal(keyedRow.selected.name, 'Epic \u00b7 OPS', 'same-name types are told apart by project');
    assert.equal(ready(1).status, 'unresolved');
    assert.equal(ready(1).selected.name, '999 · Not found in Jira');
    assert.equal(ready(1).selected.id, '999', 'the raw id stays visible and removable');
    assert.equal(ready(2).status, 'unknown-level');
    assert.deepEqual(ready(2).options, [], 'unknown levels are never selectable');
    const loading = describeHierarchyRow({ entry, slot: 'parentIssueTypeId', index: 1, types: [], catalogState: 'loading' });
    assert.equal(loading.status, 'loading');
    assert.match(loading.selected.name, /999 · Loading Jira type/);
    assert.deepEqual(loading.options, []);
    const failed = describeHierarchyRow({ entry, slot: 'parentIssueTypeId', index: 1, types: [], catalogState: 'error' });
    assert.match(failed.selected.name, /Jira catalog unavailable/);
});

test('catalog identity includes revision, projects, Board and mapped parent authority', async () => {
    const { catalogScopeFor } = await loadModel();
    const { catalogScopeKey } = await import('../frontend/src/settings/boardStatusCatalog.js');
    const base = catalogScopeKey(catalogScopeFor(delivery({ revision: 2, scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '1' } })));
    const remapped = catalogScopeKey(catalogScopeFor(delivery({
        revision: 2, scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '1' },
        hierarchy: { planningIssueTypeId: null, parentIssueTypeId: '10003', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
    })));
    assert.notEqual(base, remapped, 'same Board and projects with a new parent mapping must not share a cache entry');
    assert.notEqual(base, catalogScopeKey(catalogScopeFor(delivery({ revision: 3, scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '1' } }))));
    assert.equal(catalogScopeKey(null), '');
});

test('mount state follows the feature flag and durable promotion', async () => {
    const { resolveWorkConfigMode, readWorkConfigBootstrap } = await loadHook();
    assert.equal(resolveWorkConfigMode({ featureEnabled: false, promoted: false }), 'legacy');
    assert.equal(resolveWorkConfigMode({ featureEnabled: true, promoted: false }), 'enabled');
    assert.equal(resolveWorkConfigMode({ featureEnabled: true, promoted: true }), 'enabled');
    assert.equal(resolveWorkConfigMode({ featureEnabled: false, promoted: true }), 'unavailable');
    assert.deepEqual(readWorkConfigBootstrap({}), { featureEnabled: false, promoted: false, summaries: [], missingByConfiguration: {} });
    assert.deepEqual(readWorkConfigBootstrap({
        workConfigurationsEnabled: true, workConfigurationsPromoted: true,
        workConfigurationSummaries: [{ id: 'legacy' }], adminSettingsMissingByConfiguration: { delivery: ['Jira project'] },
    }), { featureEnabled: true, promoted: true, summaries: [{ id: 'legacy' }], missingByConfiguration: { delivery: ['Jira project'] } });
});

test('work-structure API: GET envelope, POST body and structured failures', async () => {
    const api = await loadApi();
    const calls = [];
    const original = globalThis.fetch;
    const envelope = { workConfigurations: bundle(), configRevision: 0, promoted: false, userCanEditSettings: true, featureEnabled: true };
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
        if (String(url).endsWith('/api/auth/csrf')) return new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 });
        if (options.method === 'POST') {
            return new Response(JSON.stringify({ error: 'workspace_config_conflict', configRevision: 5, workConfigurations: bundle() }), { status: 409 });
        }
        return new Response(JSON.stringify(envelope), { status: 200 });
    };
    try {
        assert.deepEqual(await api.fetchWorkStructureConfig('http://b'), envelope);
        await assert.rejects(api.saveWorkStructureConfig('http://b', { baseRevision: 0, workConfigurations: bundle(), legacyEdits: [] }), error => {
            assert.equal(error.status, 409);
            assert.equal(error.code, 'workspace_config_conflict');
            assert.equal(error.payload.configRevision, 5);
            return true;
        });
        const post = calls.find(call => call.method === 'POST');
        assert.equal(post.url, 'http://b/api/work-structure/config');
        assert.deepEqual(Object.keys(post.body), ['baseRevision', 'workConfigurations', 'legacyEdits']);
    } finally {
        globalThis.fetch = original;
    }
});

test('scoped catalog requests name the stored entry; flat reads stay selector-free', async () => {
    const { fetchBoardStatuses } = await import('../frontend/src/api/boardConfigApi.js');
    const { searchComponents } = await import('../frontend/src/api/jiraCatalogApi.js');
    const urls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ statuses: [], components: [] }), { status: 200 }); };
    try {
        await fetchBoardStatuses('http://b');
        await fetchBoardStatuses('http://b', { configurationId: 'delivery', configurationRevision: 4, quarter: '2027Q1' });
        await searchComponents('http://b', { query: 'a' });
        await searchComponents('http://b', { query: 'a', configurationId: 'delivery', configurationRevision: 4 });
    } finally {
        globalThis.fetch = original;
    }
    assert.equal(urls[0], 'http://b/api/board-config/statuses');
    assert.equal(urls[1], 'http://b/api/board-config/statuses?configurationId=delivery&configurationRevision=4&quarter=2027Q1');
    assert.ok(!urls[2].includes('configurationId'));
    assert.match(urls[3], /configurationId=delivery&configurationRevision=4/);
});

test('board status catalog key carries configuration id, revision, digest and parent authority', async () => {
    const catalog = await import('../frontend/src/settings/boardStatusCatalog.js');
    catalog.clearBoardStatusCatalogCache();
    const urls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ statuses: [{ id: '1', name: 'To Do' }] }), { status: 200 }); };
    const scope = { configurationId: 'delivery', configurationRevision: 2, digest: 'PLAN|', parentAuthority: 'mapped:10003', quarter: '2027Q1' };
    try {
        await catalog.loadBoardStatusCatalog('http://b', { boardId: '', projectScopeKey: 'PLAN', catalogScope: scope });
        await catalog.loadBoardStatusCatalog('http://b', { boardId: '', projectScopeKey: 'PLAN', catalogScope: scope });
        await catalog.loadBoardStatusCatalog('http://b', { boardId: '', projectScopeKey: 'PLAN', catalogScope: { ...scope, parentAuthority: 'mapped:10004' } });
    } finally {
        globalThis.fetch = original;
    }
    assert.equal(urls.length, 2, 'one fetch per scope; a new parent authority is a new key');
    catalog.clearBoardStatusCatalogCache();
});

test('issue-type catalog: one cached answer per saved scope, failures retried, wrong configuration refused', async () => {
    const catalogs = await import('../frontend/src/settings/workConfigurationCatalogs.js');
    catalogs.clearWorkCatalogCache();
    let calls = 0;
    let mode = 'ok';
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
        calls += 1;
        if (mode === 'fail') return new Response(JSON.stringify({ error: 'configuration_incomplete', message: 'x' }), { status: 409 });
        if (mode === 'other') return new Response(JSON.stringify({ configurationId: 'legacy', issueTypes: [] }), { status: 200 });
        return new Response(JSON.stringify({ configurationId: 'delivery', issueTypes: [{ id: '2', name: 'Epic', hierarchyLevel: 1 }] }), { status: 200 });
    };
    const scope = { configurationId: 'delivery', configurationRevision: 1, digest: 'PLAN|', parentAuthority: 'mapped:', quarter: '' };
    try {
        mode = 'fail';
        await assert.rejects(catalogs.loadIssueTypeCatalog('http://b', scope), error => error.code === 'configuration_incomplete');
        mode = 'ok';
        const first = await catalogs.loadIssueTypeCatalog('http://b', scope);
        await catalogs.loadIssueTypeCatalog('http://b', scope);
        assert.equal(calls, 2, 'the failed read was not cached; the settled one is reused');
        assert.deepEqual(first.types.map(type => type.id), ['2']);
        mode = 'other';
        await assert.rejects(catalogs.loadIssueTypeCatalog('http://b', { ...scope, configurationRevision: 2 }), error => error.code === 'configuration_scope_changed');
    } finally {
        globalThis.fetch = original;
        catalogs.clearWorkCatalogCache();
    }
});

test('Scope boundaries: an exact canonical typed value is offered when it is not in the Sprint list', async () => {
    const { typedSprintOption, sprintValueOptions, patchBundleEntry, validateBundle } = await loadModel();
    const listed = sprintValueOptions({ values: [{ value: '2027Q1', canonical: true, state: 'future', sprintIds: [], configurationIds: [] }] });
    const option = typedSprintOption('2027Q2', listed);
    assert.deepEqual([option.id, option.name, option.detail], ['2027Q2', 'Use 2027Q2', 'not in the Sprint list']);
    assert.equal(typedSprintOption('2027Q1', listed), null, 'a listed value is chosen from the list, never duplicated');
    assert.ok(typedSprintOption('2027Q2', []), 'a failed or empty list still offers the typed value');
    assert.ok(typedSprintOption(' 2027Q2 ', []), 'surrounding whitespace is not part of the value');
    assert.equal(typedSprintOption('0001Q1', []).id, '0001Q1');
    assert.equal(typedSprintOption('9999Q4', []).id, '9999Q4');
    for (const bad of ['', '2027q1', '2027Q5', '2027Q0', '0000Q1', '2027 Q1', '27Q1', '20271Q1', '2027Q1x', 'Q1', null, undefined, 20271]) {
        assert.equal(typedSprintOption(bad, []), null, `${String(bad)} is not canonical`);
    }
    // A non-canonical value listed disabled is not a reason to offer the typed copy of it.
    assert.equal(typedSprintOption('0000Q1', sprintValueOptions({ values: [{ value: '0000Q1', canonical: false }] })), null);
    // Choosing it is an ordinary patch; validation still decides Save.
    let draft = patchBundleEntry(bundle(), 'legacy', { throughQuarter: null });
    assert.match(validateBundle(draft).errors.legacy.throughQuarter, /Choose a Through Sprint/);
    draft = patchBundleEntry(draft, 'legacy', { throughQuarter: option.id });
    assert.ok(!validateBundle(draft).errors.legacy.throughQuarter?.includes('Both inner'));
});

test('Scope boundaries: a Sprint value in both configurations is two labelled options of one bare value', async () => {
    const { typedSprintOption, sprintValueOptions } = await loadModel();
    const options = sprintValueOptions({ values: [
        { value: '2027Q1', label: '2027Q1 - legacy', canonical: true, state: 'future', sprintIds: [102], configurationIds: ['legacy'] },
        { value: '2027Q1', label: '2027Q1 - delivery', canonical: true, state: 'active', sprintIds: [201], configurationIds: ['delivery'] },
        { value: '2026Q4', label: '2026Q4', canonical: true, state: 'closed', sprintIds: [99], configurationIds: ['delivery'] },
    ] });
    assert.deepEqual(options.map(option => [option.id, option.name, option.value]), [
        ['2027Q1 - legacy', '2027Q1 - legacy', '2027Q1'],
        ['2027Q1 - delivery', '2027Q1 - delivery', '2027Q1'],
        ['2026Q4', '2026Q4', '2026Q4'],
    ]);
    assert.equal(new Set(options.map(option => option.id)).size, options.length, 'option ids are unique');
    assert.equal(options[1].detail, 'active · Jira id 201');
    assert.equal(typedSprintOption('2027Q1', options), null, 'the duplicate check compares the bare value');
    assert.equal(typedSprintOption('2027Q2', options).value, '2027Q2', 'a typed option carries its bare value');
});

test('Scope boundaries: removing one required boundary never blanks the other configuration', async () => {
    const { patchBundleEntry } = await loadModel();
    const before = bundle();
    const after = patchBundleEntry(before, 'legacy', { throughQuarter: null });
    const pick = id => after.configurations.find(entry => entry.id === id);
    assert.equal(pick('legacy').throughQuarter, null);
    assert.equal(pick('delivery').fromQuarter, before.configurations.find(entry => entry.id === 'delivery').fromQuarter);
    assert.ok(pick('delivery').fromQuarter, 'DELIVERY keeps its From boundary');
});

test('Scope boundaries: options come from observed Sprint values; a non-canonical value is disabled', async () => {
    const { sprintValueOptions, validateBundle, patchBundleEntry } = await loadModel();
    const options = sprintValueOptions({ values: [
        { value: '2027Q1', canonical: true, state: 'future', sprintIds: [45459], configurationIds: ['delivery'] },
        { value: '0000Q1', canonical: false, state: 'closed', sprintIds: [3], configurationIds: [] },
        { value: '2019Q1', canonical: true, state: '', sprintIds: [], configurationIds: [] },
    ] });
    assert.deepEqual(options.map(option => [option.id, option.name, option.disabled]), [['2027Q1', '2027Q1', false], ['0000Q1', '0000Q1', true], ['2019Q1', '2019Q1', false]]);
    assert.equal(options[0].detail, 'future · Jira id 45459');
    assert.equal(options[1].detail, 'not a valid boundary · closed · Jira id 3');
    assert.equal(options[2].detail, '2019Q1', 'no metadata falls back to the value, never an empty hint');
    assert.deepEqual(sprintValueOptions(undefined), []);
    assert.deepEqual(sprintValueOptions({ state: 'loading', values: [] }), []);
    // A value outside the saved range is a valid pick; ordering, gaps and the Legacy-first rule still decide Save.
    let draft = bundle();
    draft = patchBundleEntry(draft, 'delivery', { fromQuarter: '2030Q4' });
    assert.match(validateBundle(draft).errors.delivery.fromQuarter, /leave a gap/);
    draft = patchBundleEntry(patchBundleEntry(draft, 'legacy', { throughQuarter: '2030Q3' }), 'delivery', {});
    assert.deepEqual(validateBundle(draft).messages, []);
    draft = patchBundleEntry(draft, 'legacy', { throughQuarter: null });
    assert.match(validateBundle(draft).errors.legacy.throughQuarter, /Choose a Through Sprint/);
    assert.ok(validateBundle(patchBundleEntry(bundle(), 'legacy', { throughQuarter: '0000Q1' })).errors.legacy.throughQuarter, 'a stored non-canonical boundary still fails validation');
});

test('Sprint values read: a plain GET with no query, no CSRF and structured failures', async () => {
    const api = await loadApi();
    const calls = [];
    const original = globalThis.fetch;
    const body = { sprintValues: [{ value: '2027Q1', canonical: true, state: 'future', sprintIds: [1], configurationIds: ['delivery'] }], sources: [], promoted: true };
    let status = 200;
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET' });
        return status === 200 ? new Response(JSON.stringify(body), { status }) : new Response(JSON.stringify({ error: 'sprint_values_read_failed', message: 'x' }), { status });
    };
    try {
        assert.deepEqual(await api.fetchWorkSprintValues('http://b'), body);
        assert.deepEqual(calls, [{ url: 'http://b/api/work-structure/sprint-values', method: 'GET' }]);
        status = 500;
        await assert.rejects(api.fetchWorkSprintValues('http://b'), error => error.status === 500 && error.code === 'sprint_values_read_failed');
    } finally {
        globalThis.fetch = original;
    }
});

test('sourceCause names the concrete reason a source holds no Sprint for the quarter', async () => {
    const { sourceCause } = await loadModel();
    const diag = (overrides = {}) => ({ state: 'ready', code: null, scannedIssueCount: null, issuesWithSprintValueCount: null, observedSprintCount: null, ...overrides });
    assert.equal(sourceCause(null, '2027Q1'), null);
    assert.equal(sourceCause(diag(), '2027Q1'), null);
    assert.match(sourceCause(diag({ code: 'jira_unavailable' }), '2027Q1'), /could not be reached/);
    assert.match(sourceCause(diag({ code: 'catalog_incomplete' }), '2027Q1'), /incomplete/);
    assert.match(sourceCause(diag({ code: 'other' }), '2027Q1'), /failed/);
    assert.match(sourceCause(diag({ scannedIssueCount: 0, issuesWithSprintValueCount: 0, observedSprintCount: 0 }), '2027Q1'), /No issues matched/);
    assert.equal(sourceCause(diag({ scannedIssueCount: 12, issuesWithSprintValueCount: 0, observedSprintCount: 0 }), '2027Q1'), '12 issues were read and none has a Sprint value; check the Sprint field.');
    assert.equal(sourceCause(diag({ scannedIssueCount: 12, issuesWithSprintValueCount: 9, observedSprintCount: 4 }), '2027Q1'), '4 Sprints were found, none for 2027Q1.');
    assert.equal(sourceCause(diag({ observedSprintCount: 3 }), '2027Q1'), '3 Sprints were found, none for 2027Q1.');
});

test('a blank Board shows the nearest configuration\'s Board as inherited; an explicit Board wins and nothing is stored', async () => {
    const { inheritedBoard } = await loadModel();
    const entries = [
        { id: 'legacy', name: 'Legacy', scope: { boardId: '7001' } },
        { id: 'delivery', name: 'DELIVERY', scope: { boardId: '' } },
    ];
    assert.deepEqual(inheritedBoard(entries, 'delivery'), { boardId: '7001', fromId: 'legacy', fromName: 'Legacy' });
    assert.equal(entries[1].scope.boardId, '', 'display only: the stored entry stays blank');
    assert.equal(inheritedBoard(entries, 'legacy'), null, 'an explicit Board is its own');
    entries[1].scope.boardId = '19095';
    assert.equal(inheritedBoard(entries, 'delivery'), null, 'an override wins');
    assert.equal(inheritedBoard([{ id: 'legacy', scope: { boardId: '' } }, { id: 'delivery', scope: { boardId: '' } }], 'delivery'), null);
});

test('refreshableSources: an inherited Board and shared Sprint field make DELIVERY refreshable', async () => {
    const { refreshableSources } = await loadModel();
    const entries = [legacy(), delivery()];
    assert.deepEqual(refreshableSources(entries).map(entry => entry.id), ['legacy', 'delivery']);
});

test('a configuration with no Board, no projects and no inherited Board is not refreshable', async () => {
    const { refreshableSources } = await loadModel();
    const entries = [legacy({ scope: { projects: [], boardId: '' } }), delivery()];
    assert.deepEqual(refreshableSources(entries), []);
});

test('DELIVERY Sprint and Story Points share Legacy\'s mapping until overridden; an own blank is a deliberate clear; Team is always shared', async () => {
    const { effectiveEntry, missingMappings, patchBundleEntry, entryById } = await loadModel();
    const shared = { fieldId: '', fieldName: '', mode: 'shared' };
    const start = delivery({ scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' },
        hierarchy: { planningIssueTypeId: '10002', parentIssueTypeId: '10001', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { ...delivery().fields, sprint: shared, storyPoints: shared, team: shared } });
    const entries = [legacy(), start];
    // Initial setup: nothing to pick; Legacy's fields and Board are what DELIVERY runs with.
    const effective = effectiveEntry(entries, start);
    assert.equal(effective.fields.storyPoints.fieldId, 'customfield_10102');
    assert.equal(effective.fields.team.fieldId, 'customfield_10103');
    assert.equal(effective.scope.boardId, '7001');
    assert.equal(start.fields.storyPoints.fieldId, '', 'the draft keeps no value of its own');
    assert.deepEqual(missingMappings(start, {}, entries), []);
    // Override: picking a field makes it DELIVERY's own.
    let draft = patchBundleEntry(bundle(entries), 'delivery', { fields: { storyPoints: field('customfield_8', 'Epic Points') } });
    assert.deepEqual(entryById(draft, 'delivery').fields.storyPoints, { fieldId: 'customfield_8', fieldName: 'Epic Points', mode: 'own' });
    // Deliberate clear: removing it keeps it own and blank, so it is missing instead of falling back.
    draft = patchBundleEntry(draft, 'delivery', { fields: { storyPoints: field() } });
    assert.deepEqual(entryById(draft, 'delivery').fields.storyPoints, { fieldId: '', fieldName: '', mode: 'own' });
    assert.deepEqual(missingMappings(entryById(draft, 'delivery'), {}, draft.configurations), ['Story Points']);
    // Back to shared: the explicit action drops DELIVERY's own value.
    draft = patchBundleEntry(draft, 'delivery', { fields: { storyPoints: { mode: 'shared' } } });
    assert.deepEqual(entryById(draft, 'delivery').fields.storyPoints, shared);
    // Team is one field for every configuration: an edit never gives DELIVERY its own.
    draft = patchBundleEntry(draft, 'delivery', { fields: { team: field('customfield_8', 'Delivery Team') } });
    assert.deepEqual(entryById(draft, 'delivery').fields.team, shared);
    // Legacy mappings take no mode, and DELIVERY follows Legacy's Team.
    draft = patchBundleEntry(draft, 'legacy', { fields: { team: field('customfield_3', 'Team') } });
    assert.deepEqual(entryById(draft, 'legacy').fields.team, field('customfield_3', 'Team'));
    assert.equal(effectiveEntry(draft.configurations, entryById(draft, 'delivery')).fields.team.fieldId, 'customfield_3');
});

test('typeNamesNeedingSave asks to save when a configured type id has no captured name or Jira renamed it', async () => {
    const { typeNamesNeedingSave } = await loadModel();
    const types = [
        { id: '19002', name: 'Epic', hierarchyLevel: 1 }, { id: '19003', name: 'Initiative', hierarchyLevel: 2 },
        { id: '19001', name: 'Story', hierarchyLevel: 0 }, { id: '19009', name: 'Feature', hierarchyLevel: 1 },
    ];
    const ready = { state: 'ready', types };
    const saved = delivery({ hierarchy: { planningIssueTypeId: '19002', parentIssueTypeId: '19003', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null } });
    const captured = { planning: { id: '19002', name: 'Epic', hierarchyLevel: 1 }, parent: { id: '19003', name: 'Initiative', hierarchyLevel: 2 }, ancestor: null, optionalAncestor: null };
    const run = (roleTypes, catalog = ready, entries = [saved]) => typeNamesNeedingSave({
        entries, summaries: [{ id: 'delivery', roleTypes }], catalogFor: () => catalog,
    });
    assert.deepEqual(run({ planning: null, parent: null, ancestor: null, optionalAncestor: null }), ['delivery'], 'null capture needs a save');
    assert.deepEqual(run(null), ['delivery'], 'a summary without roleTypes needs a save');
    assert.deepEqual(run(captured), [], 'a matching capture does not');
    assert.deepEqual(run({ ...captured, parent: { id: '19003', name: 'Initiative (old)', hierarchyLevel: 2 } }), ['delivery'], 'a Jira rename needs a save');
    assert.deepEqual(run({ ...captured, planning: { id: '19002', name: 'Epic', hierarchyLevel: 0 } }), ['delivery'], 'a level change needs a save');
    assert.deepEqual(run({ ...captured, planning: { id: '19001', name: 'Story', hierarchyLevel: 0 } }), ['delivery'], 'a capture of another id needs a save');
    for (const state of ['loading', 'error', 'unscoped']) {
        assert.deepEqual(run(null, { state, types: [] }), [], `catalog ${state}: never nag`);
    }
    assert.deepEqual(typeNamesNeedingSave({ entries: [saved], summaries: [{ id: 'delivery', roleTypes: null }], catalogFor: () => undefined }), [], 'no catalog: never nag');
    assert.deepEqual(run(null, { state: 'ready', types: [] }), [], 'an id Jira does not describe cannot be captured');
    assert.deepEqual(typeNamesNeedingSave({ entries: [saved], summaries: [], catalogFor: () => ready }), [], 'no summary: unknown, never nag');

    // Legacy: compatibility slots and the captured name filter are fixed names, never captured from the catalog.
    const legacyNone = { planning: { id: null, name: 'Story', hierarchyLevel: 0 }, parent: { id: null, name: 'Epic', hierarchyLevel: 1 }, ancestor: { id: null, name: 'Initiative', hierarchyLevel: 2 }, optionalAncestor: null };
    const compat = legacy();
    assert.deepEqual(typeNamesNeedingSave({ entries: [compat], summaries: [{ id: 'legacy', roleTypes: legacyNone }], catalogFor: () => ready }), []);
    // A compatibility slot keeps its fixed name even when a stale id lingers in the bundle.
    const lingering = legacy({ hierarchy: { planningIssueTypeId: null, parentIssueTypeId: '19009', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null } });
    assert.deepEqual(typeNamesNeedingSave({ entries: [lingering], summaries: [{ id: 'legacy', roleTypes: legacyNone }], catalogFor: () => ready }), []);
    // Mapped Legacy slots are compared by id like the new model.
    const mapped = legacy({
        legacyIssueTypeNames: null, legacyHierarchyModes: { parent: 'mapped', ancestor: 'compatibility' },
        hierarchy: { planningIssueTypeId: '19001', parentIssueTypeId: '19009', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
    });
    const mappedCaptured = { ...legacyNone, planning: { id: '19001', name: 'Story', hierarchyLevel: 0 }, parent: { id: '19009', name: 'Feature', hierarchyLevel: 1 } };
    assert.deepEqual(typeNamesNeedingSave({ entries: [mapped], summaries: [{ id: 'legacy', roleTypes: mappedCaptured }], catalogFor: () => ready }), []);
    assert.deepEqual(typeNamesNeedingSave({ entries: [mapped], summaries: [{ id: 'legacy', roleTypes: { ...mappedCaptured, parent: null } }], catalogFor: () => ready }), ['legacy']);
});

test('typeNamesSignature changes when a capture arrives, Jira renames a type or another configuration is listed', async () => {
    const { typeNamesSignature } = await loadModel();
    const saved = delivery({ hierarchy: { planningIssueTypeId: '19002', parentIssueTypeId: '19003', ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null } });
    const types = [{ id: '19002', name: 'Epic', hierarchyLevel: 1 }, { id: '19003', name: 'Initiative', hierarchyLevel: 2 }];
    const sign = ({ ids = ['delivery'], roleTypes = null, catalogTypes = types, entries = [saved, legacy()] } = {}) => typeNamesSignature({
        ids, entries, summaries: [{ id: 'delivery', roleTypes }, { id: 'legacy', roleTypes: null }], catalogFor: () => ({ state: 'ready', types: catalogTypes }),
    });
    assert.equal(sign({ ids: [] }), '', 'nothing listed, nothing to acknowledge');
    assert.equal(sign(), sign(), 'stable for the same inputs');
    assert.notEqual(sign(), sign({ roleTypes: { planning: { id: '19002', name: 'Epic', hierarchyLevel: 1 } } }), 'a new capture re-arms');
    assert.notEqual(sign(), sign({ catalogTypes: [{ ...types[0], name: 'Deliverable' }, types[1]] }), 'a Jira rename re-arms');
    assert.notEqual(sign(), sign({ ids: ['delivery', 'legacy'] }), 'another listed configuration re-arms');
    assert.equal(sign(), sign({ catalogTypes: [...types, { id: '19099', name: 'Unrelated', hierarchyLevel: 0 }] }), 'unconfigured catalog types do not');
});

test('administrator saves omit dormant Allocation mappings on first promotion and subsequent saves', async () => {
    const { buildSaveRequest } = await loadModel();
    const draft = bundle([legacy(), delivery({ allocationTypes: [{ value: 'Dormant', type: 'tech' }] })]);
    for (const promoted of [false, true]) {
        const request = buildSaveRequest({ baseline: draft, draft, promoted, baseRevision: 5 });
        assert.equal(Object.hasOwn(request.workConfigurations.configurations[1], 'allocationTypes'), false);
        assert.deepEqual(draft.configurations[1].allocationTypes, [{ value: 'Dormant', type: 'tech' }]);
    }
});
