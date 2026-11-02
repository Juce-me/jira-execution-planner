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
    assert.deepEqual(entryById(draft, 'delivery').fields.sprint, field('customfield_1', 'Sprint'));
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
    assert.match(validateBundle(bundle([legacy({ throughQuarter: '2026Q3' }), delivery()])).errors.delivery.fromQuarter, /without a gap/);
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
        ['Sprint', 'Story Points', 'Team', 'Epic', 'Initiative']);
    const half = delivery({
        scope: { projects: [{ key: 'PLAN', type: 'other' }], boardId: '' },
        hierarchy: { planningIssueTypeId: '10002', parentIssueTypeId: null, ancestorIssueTypeId: null, optionalAncestorIssueTypeId: null },
        fields: { ...delivery().fields, sprint: field('s', 'Sprint'), storyPoints: field('p', 'SP'), team: field('t', 'Team') },
    });
    assert.deepEqual(missingMappings(half), ['Initiative']);
    assert.equal(missingSummary(bundle([legacy(), half])), 'DELIVERY: missing Initiative.');
    // An id absent from a loaded catalog is reported, never dropped.
    assert.deepEqual(missingMappings(half, { types: { 10003: {} } }), ['Epic (10002: not found in Jira)', 'Initiative']);
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
    assert.equal(request.workConfigurations, draft);
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
    assert.equal(ready(0).selected.name, 'Epic (2)');
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
