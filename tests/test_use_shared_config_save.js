const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Probe for the shared-config state layer and useSharedConfigSave (ST5 R4b). The hook file is bundled with a thin
// React shim (useMemo/useCallback run their factory, refs are plain objects) and with ../api/configApi.js stubbed
// so every network entry point appends to one shared call log. Every App-owned input is a recording stub: the
// order of the calls in that log is the observable behaviour (the section 4 save sequence).
const hookPath = path.join(__dirname, '../frontend/src/settings/useSharedConfigSave.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
const stateSource = hookSource.slice(hookSource.indexOf('export function useSharedConfigSaveState('), hookSource.indexOf('export function useSharedConfigSave({'));
const mainSource = hookSource.slice(hookSource.indexOf('export function useSharedConfigSave({'));

const STATE_RETURNS = ['acceptedBoardConfigRef', 'boardConfigReadGenerationRef', 'boardConfigSaveReadFenceRef', 'commitSharedConfigRevision', 'setSharedConfigReady', 'setSharedConfigRevision', 'setWorkspaceConfigConflict', 'settingsDraftSnapshotRef', 'sharedConfigReady', 'sharedConfigRevision', 'sharedConfigRevisionRef', 'workspaceConfigConflict'];
const HOOK_RETURNS = ['applySharedConfigBootstrap', 'discardMineOnGroupsConfigConflict', 'groupConfigValidationErrors', 'isGroupDraftDirty', 'keepMineOnGroupsConfigConflict', 'keepMineOnWorkspaceConfigConflict', 'returnFromFirstRunConfigurationRecovery', 'saveAllSettings', 'saveBlockedReason', 'unsavedSectionsCount', 'useLatestWorkspaceConfig'];
// ST5 R4b passes closeGroupManage directly (it is declared before the hook call); R4c moves it into the modal layer,
// which is called after this hook, so from then on it arrives through a handler-only getter.
const CLOSE_VIA_GETTER = mainSource.includes('getCloseGroupManage');
const GETTERS = ['getActiveDepartmentSettingsTab', 'getLoadConfig', 'getLoadSprints', ...(CLOSE_VIA_GETTER ? ['getCloseGroupManage'] : [])];
const FIELD_SECTIONS = ['sprintField', 'parentNameField', 'storyPointsField', 'teamField', 'deliveryOwnerField'];

let bundlePromise;
function loadBundle() {
    bundlePromise = bundlePromise || esbuild.build({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], loader: { '.jsx': 'jsx' },
        plugins: [{
            name: 'stub-config-api',
            setup(build) {
                build.onResolve({ filter: /api\/configApi\.js$/ }, () => ({ path: 'config-api-stub', namespace: 'stub' }));
                build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    contents: [
                        'exports.fetchAppConfig = async (backendUrl) => globalThis.__net.fetchAppConfig(backendUrl);',
                        'exports.saveGroupsConfig = async (backendUrl, payload) => globalThis.__net.saveGroupsConfig(backendUrl, payload);',
                    ].join('\n'),
                    loader: 'js',
                }));
            },
        }],
    }).then((result) => result.outputFiles[0].text);
    return bundlePromise;
}

async function load() {
    const code = await loadBundle();
    const shimmedReact = {
        ...React,
        useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
        useRef(initial) { return { current: initial }; },
        useMemo(factory) { return factory(); },
        useCallback(fn, deps) { fn.__deps = deps; return fn; },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => (id === 'react' ? shimmedReact : require(id)));
    return module.exports;
}

function render(hook, input) {
    let result;
    function Probe() { result = hook(input); return null; }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

// Names the hook receives as inputs, partitioned by how the harness stubs them.
const INPUT_NAMES = (() => {
    const start = mainSource.indexOf('({\n') + 3;
    return mainSource.slice(start, mainSource.indexOf('\n}) {')).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
})();

function makeHarness({ overrides = {}, net = {}, groupDraft, dirty = {}, committed = [] } = {}) {
    const log = [];
    const rec = (name, value) => (...args) => { log.push([name, ...args]); return value; };
    const recAsync = (name, value) => async (...args) => { log.push([name, ...args]); return typeof value === 'function' ? value(...args) : value; };
    const refs = {
        sharedConfigRevisionRef: { value: 5, get current() { return this.value; }, set current(next) { log.push(['sharedConfigRevisionRef=', next]); this.value = next; } },
        groupDraftBaselineRef: { current: 'baseline' },
    };
    const draft = groupDraft === undefined ? { groups: [{ id: 'g1', teamIds: ['t1'], name: 'G1' }], defaultGroupId: 'g1', configRevision: 11 } : groupDraft;
    const input = {
        BACKEND_URL: 'http://backend.test',
        acceptedBoardConfigRef: { current: true },
        acceptedGroupsConfigRef: { current: false },
        activeGroupId: 'g1',
        adminAccess: { isDirty: false, save: recAsync('adminAccess.save'), selectedUserIds: [], toggleUser: rec('adminAccess.toggleUser') },
        anyFieldConfigDirty: false,
        applyAdminSettingsGateConfig: (config) => { log.push(['applyAdminSettingsGateConfig', config]); return { status: 'clear' }; },
        applyCapacityLoaded: rec('applyCapacityLoaded'),
        applyJiraIssueTypesLoaded: rec('applyJiraIssueTypesLoaded'),
        applyJiraProjectsAndBoardLoaded: rec('applyJiraProjectsAndBoardLoaded'),
        applyPriorityWeightsLoaded: rec('applyPriorityWeightsLoaded'),
        applySavePermissions: rec('applySavePermissions'),
        applySavedEpmConfig: rec('applySavedEpmConfig'),
        applySavedGroupsConfig: (config) => { log.push(['applySavedGroupsConfig', config]); return config; },
        authMode: 'atlassian_oauth',
        boardConfigReadGenerationRef: { current: 0 },
        boardConfigSaveReadFenceRef: { current: 0 },
        canEditEpmConfiguration: true,
        canEditSharedConfiguration: true,
        capacityFieldIdDraft: 'cf', capacityProjectDraft: 'CAP',
        commitSharedConfigRevision: (payload) => { log.push(['commitSharedConfigRevision', payload]); if (Number.isInteger(payload?.configRevision)) refs.sharedConfigRevisionRef.current = payload.configRevision; },
        dirtyFieldConfigCount: 0,
        dispatchFirstRunConfigurationSession: rec('dispatchFirstRunConfigurationSession'),
        epmConfigLoading: false,
        epmConfigSaving: false,
        favoriteGroupValidationError: '',
        firstRunConfigurationActive: false,
        firstRunConfigurationSession: { committedAdminSections: {}, committedSections: {}, capturedDrafts: null, pendingGroupId: null, guideComplete: true, status: 'idle' },
        getActiveDepartmentSettingsTab: () => 'teams',
        closeGroupManage: rec('closeGroupManage'),
        getCloseGroupManage: () => rec('closeGroupManage'),
        getLoadConfig: () => recAsync('loadConfig', true),
        getLoadSprints: () => recAsync('loadSprints'),
        groupDraft: draft,
        groupDraftBaselineRef: refs.groupDraftBaselineRef,
        groupDraftSignature: 'changed',
        groupManageTab: 'scope',
        groupSaving: false,
        groupStateRef: { current: { delete: rec('groupStateRef.delete'), clear: rec('groupStateRef.clear') } },
        groupsConfig: { groups: [{ id: 'g1', teamIds: ['t1'] }], source: 'workspace_db' },
        groupsConfigConflict: null,
        groupsReadGenerationRef: { current: 0 },
        groupsSaveReadFenceRef: { current: 0 },
        invalidateSprintDataForConfigSave: rec('invalidateSprintDataForConfigSave'),
        invalidateTeamMembership: rec('invalidateTeamMembership'),
        isBoardConfigDirty: false, isCapacityDraftDirty: false, isDeliveryOwnerFieldDirty: false, isEpmConfigDirty: false,
        isGroupVisibilityDraftDirty: false, isIssueTypesDraftDirty: false, isParentNameFieldDirty: false, isPriorityWeightsDirty: false,
        isProjectsDraftDirty: false, isSprintFieldDirty: false, isStoryPointsFieldDirty: false, isTeamFieldDirty: false,
        parentNameFieldIdDraft: 'p', persistGroupPreferences: recAsync('persistGroupPreferences'),
        priorityWeightsValidationError: '',
        queueConfigSaveRefresh: rec('queueConfigSaveRefresh'),
        saveBoardConfig: recAsync('saveBoardConfig'),
        saveCapacityConfig: recAsync('saveCapacityConfig'),
        saveDeliveryOwnerFieldConfig: recAsync('saveDeliveryOwnerFieldConfig', () => ({ configRevision: 10 })),
        saveEpmConfig: recAsync('saveEpmConfig', true),
        saveFirstRunGroupPreferences: recAsync('saveFirstRunGroupPreferences', { ok: true }),
        saveIssueTypesConfig: recAsync('saveIssueTypesConfig'),
        saveParentNameFieldConfig: recAsync('saveParentNameFieldConfig', () => ({ configRevision: 7 })),
        savePriorityWeightsConfig: recAsync('savePriorityWeightsConfig'),
        saveProjectSelection: recAsync('saveProjectSelection'),
        saveSprintFieldConfig: recAsync('saveSprintFieldConfig', () => ({ configRevision: 6 })),
        saveStoryPointsFieldConfig: recAsync('saveStoryPointsFieldConfig', () => ({ configRevision: 8 })),
        saveTeamFieldConfig: recAsync('saveTeamFieldConfig', () => ({ configRevision: 9 })),
        seedSharedFieldConfigs: rec('seedSharedFieldConfigs'),
        selectedProjectsDraft: [{ key: 'P' }],
        selectedSprint: 'sprint-1',
        sharedConfigReady: true,
        sharedConfigRevisionRef: refs.sharedConfigRevisionRef,
        showScenario: false,
        sprintCatalogControllerRef: { current: { invalidate: rec('sprintCatalog.invalidate'), acceptSource: rec('sprintCatalog.acceptSource') } },
        sprintFieldIdDraft: 's', storyPointsFieldIdDraft: 'sp', teamFieldIdDraft: 't',
        trackSettingsAction: rec('trackSettingsAction'),
        workspaceConfigConflict: null,
        ...Object.fromEntries(INPUT_NAMES.filter((name) => /^set[A-Z]/.test(name)).map((name) => [name, rec(name)])),
        ...overrides,
    };
    for (const [section, flag] of Object.entries({ projects: 'isProjectsDraftDirty', priorityWeights: 'isPriorityWeightsDirty', board: 'isBoardConfigDirty', capacity: 'isCapacityDraftDirty', sprintField: 'isSprintFieldDirty', parentNameField: 'isParentNameFieldDirty', storyPointsField: 'isStoryPointsFieldDirty', teamField: 'isTeamFieldDirty', deliveryOwnerField: 'isDeliveryOwnerFieldDirty', issueTypes: 'isIssueTypesDraftDirty' })) {
        if (dirty[section]) input[flag] = true;
    }
    if (dirty.adminAccess) input.adminAccess = { ...input.adminAccess, isDirty: true };
    globalThis.__net = {
        fetchAppConfig: async (url) => { log.push(['GET /api/config', url]); return net.config || { authMode: 'atlassian_oauth', userCanEditSettings: true, capacityProject: 'CAP', sprintCatalogSource: { id: 's' } }; },
        saveGroupsConfig: async (url, payload) => {
            log.push(['POST /api/groups-config', payload]);
            if (net.groupsResponse) return net.groupsResponse(payload);
            return { ok: true, status: 200, json: async () => ({ ...payload, groups: payload.groups, configRevision: payload.baseRevision + 1, source: 'workspace_db', preferences: {} }) };
        },
    };
    return { input, log, refs };
}

async function mount(options) {
    const mod = await load();
    const harness = makeHarness(options);
    const hook = render(mod.useSharedConfigSave, harness.input);
    return { ...harness, hook, mod };
}

const sequence = (log) => log.map((entry) => entry[0]);
const before = (log, first, second) => { const a = sequence(log).indexOf(first); const b = sequence(log).indexOf(second); return a !== -1 && b !== -1 && a < b; };

test('interface: 123 inputs, 11 returns, state layer 0 inputs and 12 returns, four getters', async () => {
    assert.equal(INPUT_NAMES.length, 123);
    for (const getter of GETTERS) assert.ok(INPUT_NAMES.includes(getter), getter);
    for (const forbidden of ['loadConfig', 'loadSprints', 'activeDepartmentSettingsTab', ...(CLOSE_VIA_GETTER ? ['closeGroupManage'] : ['getCloseGroupManage'])]) assert.equal(INPUT_NAMES.includes(forbidden), false, `${forbidden} is reached through a getter`);
    const mod = await load();
    const state = render(mod.useSharedConfigSaveState, undefined);
    assert.deepEqual(Object.keys(state).sort(), STATE_RETURNS);
    const { hook } = await mount();
    assert.deepEqual(Object.keys(hook).sort(), HOOK_RETURNS);
    assert.equal(mod.useSharedConfigSaveState.length, 0);
});

test('state layer: defaults, per-instance refs, and commitSharedConfigRevision only accepts integer revisions', async () => {
    const mod = await load();
    const state = render(mod.useSharedConfigSaveState, undefined);
    assert.equal(state.workspaceConfigConflict, null);
    assert.equal(state.sharedConfigRevision, 0);
    assert.equal(state.sharedConfigRevisionRef.current, 0);
    assert.equal(state.sharedConfigReady, false);
    assert.equal(state.acceptedBoardConfigRef.current, false);
    assert.equal(state.boardConfigReadGenerationRef.current, 0);
    assert.equal(state.boardConfigSaveReadFenceRef.current, 0);
    assert.deepEqual(state.settingsDraftSnapshotRef.current, {});
    state.commitSharedConfigRevision({ configRevision: 12 });
    assert.equal(state.sharedConfigRevisionRef.current, 12);
    for (const bad of [null, undefined, {}, { configRevision: '13' }, { configRevision: 1.5 }, { configRevision: null }]) {
        state.commitSharedConfigRevision(bad);
        assert.equal(state.sharedConfigRevisionRef.current, 12, JSON.stringify(bad));
    }
    const other = render(mod.useSharedConfigSaveState, undefined);
    assert.notStrictEqual(other.sharedConfigRevisionRef, state.sharedConfigRevisionRef);
});

test('full save sequence: admin sections sequential, adminAccess fixed step, groups POST with baseRevision, then refresh, then EPM nothing', async () => {
    const all = Object.fromEntries(['projects', 'priorityWeights', 'board', 'capacity', ...FIELD_SECTIONS, 'issueTypes', 'adminAccess'].map((key) => [key, true]));
    const { hook, log, refs } = await mount({ dirty: all });
    const outcome = await hook.saveAllSettings({});
    assert.equal(outcome.ok, true);
    const order = sequence(log).filter((name) => /^save|^adminAccess\.save$|^POST |^GET /.test(name));
    assert.deepEqual(order.slice(0, 12), [
        'saveProjectSelection', 'savePriorityWeightsConfig', 'saveBoardConfig', 'saveCapacityConfig',
        'saveSprintFieldConfig', 'saveParentNameFieldConfig', 'saveStoryPointsFieldConfig', 'saveTeamFieldConfig', 'saveDeliveryOwnerFieldConfig',
        'saveIssueTypesConfig', 'adminAccess.save', 'POST /api/groups-config',
    ]);
    assert.ok(order.indexOf('POST /api/groups-config') < order.indexOf('GET /api/config'), 'the refresh follows the groups POST');
    // Field saves are handed the revision committed by the previous step (sequential, never parallel).
    assert.deepEqual(log.filter((entry) => /Field/.test(entry[0]) && entry[0].startsWith('save')).map((entry) => [entry[0], entry[1]]), [
        ['saveSprintFieldConfig', 5], ['saveParentNameFieldConfig', 6], ['saveStoryPointsFieldConfig', 7], ['saveTeamFieldConfig', 8], ['saveDeliveryOwnerFieldConfig', 9],
    ]);
    assert.equal(refs.sharedConfigRevisionRef.current, 10);
    const post = log.find((entry) => entry[0] === 'POST /api/groups-config')[1];
    assert.equal(post.baseRevision, 11, 'the groups POST carries the draft baseRevision');
    assert.deepEqual(post.groups, [{ id: 'g1', teamIds: ['t1'], name: 'G1' }]);
    assert.equal(Object.hasOwn(post, 'configRevision'), false);
    // Board-affecting admin save invalidates the Sprint catalog and Team membership before any write.
    assert.ok(before(log, 'sprintCatalog.invalidate', 'saveProjectSelection'));
    assert.ok(before(log, 'invalidateTeamMembership', 'saveProjectSelection'));
    assert.ok(before(log, 'POST /api/groups-config', 'closeGroupManage') && before(log, 'queueConfigSaveRefresh', 'closeGroupManage'), 'the modal closes only after the refresh');
    assert.equal(sequence(log).filter((name) => name === 'closeGroupManage').length, 1, 'the unified save closes the modal exactly once');
    // After the refresh the permission, gate, catalog and sprint reload follow in order, then close.
    const tail = sequence(log).slice(sequence(log).indexOf('GET /api/config'));
    assert.deepEqual(tail.filter((name) => ['GET /api/config', 'applySavePermissions', 'applyAdminSettingsGateConfig', 'sprintCatalog.acceptSource', 'loadSprints', 'invalidateSprintDataForConfigSave', 'queueConfigSaveRefresh', 'closeGroupManage'].includes(name)), [
        'GET /api/config', 'applySavePermissions', 'applyAdminSettingsGateConfig', 'sprintCatalog.acceptSource', 'loadSprints', 'invalidateSprintDataForConfigSave', 'queueConfigSaveRefresh', 'closeGroupManage',
    ]);
});

test('permission gating: without canEditSharedConfiguration no administrator write or admin POST is attempted', async () => {
    const all = Object.fromEntries(['projects', 'priorityWeights', 'board', 'capacity', ...FIELD_SECTIONS, 'issueTypes', 'adminAccess'].map((key) => [key, true]));
    for (const grant of [false, undefined, null, 0, '']) {
        const { hook, log } = await mount({ dirty: all, overrides: { canEditSharedConfiguration: grant } });
        const outcome = await hook.saveAllSettings({});
        assert.equal(outcome.ok, true);
        const writes = sequence(log).filter((name) => /^save(?!First|Epm)|^adminAccess\.save$/.test(name));
        assert.deepEqual(writes, [], `no admin section write for grant ${String(grant)}`);
        assert.ok(sequence(log).includes('POST /api/groups-config'), 'the shared Department groups still save for a normal user');
    }
    // EPM saves only under its own explicit grant, independent of the administrator grant.
    const noEpmGrant = await mount({ overrides: { canEditEpmConfiguration: false, isEpmConfigDirty: true } });
    assert.equal((await noEpmGrant.hook.saveAllSettings({})).ok, true);
    assert.equal(sequence(noEpmGrant.log).includes('POST /api/groups-config'), true);
    assert.equal(sequence(noEpmGrant.log).includes('saveEpmConfig'), false, 'a dirty EPM draft without its own grant is never written');
    // A normal user's private EPM draft still saves under its own grant.
    const epm = await mount({ overrides: { canEditSharedConfiguration: false, isEpmConfigDirty: true, groupDraftSignature: 'baseline' } });
    await epm.hook.saveAllSettings({});
    assert.ok(sequence(epm.log).includes('saveEpmConfig'));
    assert.equal(sequence(epm.log).includes('POST /api/groups-config'), false);
});

test('only dirty sections are written and skipAdminSections excludes already committed first-run sections', async () => {
    const { hook, log } = await mount({ dirty: { board: true, capacity: true, teamField: true } });
    await hook.saveAllSettings({});
    assert.deepEqual(sequence(log).filter((name) => /^save/.test(name)), ['saveBoardConfig', 'saveCapacityConfig', 'saveTeamFieldConfig']);
    const resumed = await mount({ dirty: { board: true, capacity: true }, overrides: { firstRunConfigurationActive: true, firstRunConfigurationSession: { committedAdminSections: { board: true }, committedSections: { admin: true }, pendingGroupId: 'g1', guideComplete: true, status: 'configuring' } } });
    await resumed.hook.saveAllSettings({ firstRunSession: resumed.input.firstRunConfigurationSession });
    assert.deepEqual(sequence(resumed.log).filter((name) => /^saveBoardConfig|^saveCapacityConfig/.test(name)), ['saveCapacityConfig']);
    for (const section of ['projects', 'priorityWeights', 'board', 'capacity', ...FIELD_SECTIONS, 'issueTypes', 'adminAccess']) {
        const skipped = await mount({ dirty: { [section]: true }, overrides: { firstRunConfigurationActive: true, firstRunConfigurationSession: { committedAdminSections: { [section]: true }, committedSections: {}, pendingGroupId: 'g1', guideComplete: true, status: 'configuring' } } });
        await skipped.hook.saveAllSettings({ firstRunSession: skipped.input.firstRunConfigurationSession });
        assert.equal(sequence(skipped.log).some((name) => /^save(?!First|Epm)|^adminAccess\.save$/.test(name)), false, `${section} stays skipped once committed`);
    }
});

test('409 on the groups POST keeps the draft: the conflict is raised with the committed section labels, nothing is applied, no replay', async () => {
    const response = { ok: false, status: 409, json: async () => ({ error: 'groups_config_conflict', message: 'stale', current: { configRevision: 20, groups: [] } }) };
    const { hook, log } = await mount({ dirty: { projects: true, board: true }, net: { groupsResponse: () => response } });
    const outcome = await hook.saveAllSettings({});
    assert.equal(outcome.ok, false);
    assert.equal(outcome.conflict, true);
    assert.equal(outcome.error, 'stale');
    const conflict = log.find((entry) => entry[0] === 'setGroupsConfigConflict' && entry[1]);
    assert.deepEqual(conflict[1].current, { configRevision: 20, groups: [] });
    assert.deepEqual(conflict[1].savedSections, ['Scope projects', 'Jira board']);
    assert.equal(sequence(log).includes('applySavedGroupsConfig'), false, 'the server config is not applied over the draft');
    assert.equal(sequence(log).filter((name) => name === 'POST /api/groups-config').length, 1, 'no replay');
    assert.ok(log.some((entry) => entry[0] === 'setSettingsSaveError' && entry[1] === 'stale'));
    assert.equal(sequence(log).includes('closeGroupManage'), false);
});

test('workspace 409 during an admin step stores the conflict with committed and pending section labels', async () => {
    const conflictPayload = { error: 'workspace_config_conflict', message: 'moved', currentRevision: 40 };
    const failing = async () => { const error = new Error('moved'); error.status = 409; error.payload = conflictPayload; throw error; };
    const { hook, log } = await mount({ dirty: { projects: true, board: true, capacity: true }, overrides: { saveBoardConfig: async (...args) => { log.push(['saveBoardConfig', ...args]); return failing(); } } });
    // The override closes over `log` declared by makeHarness; rebuild with the harness log instead.
    const harness = makeHarness({ dirty: { projects: true, board: true, capacity: true } });
    harness.input.saveBoardConfig = async () => { harness.log.push(['saveBoardConfig']); return failing(); };
    const mod = await load();
    const result = render(mod.useSharedConfigSave, harness.input);
    const outcome = await result.saveAllSettings({});
    assert.equal(outcome.conflict, true);
    const stored = harness.log.find((entry) => entry[0] === 'setWorkspaceConfigConflict' && entry[1]);
    assert.equal(stored[1].currentRevision, 40);
    assert.deepEqual(stored[1].savedSections, ['Scope projects']);
    assert.deepEqual(stored[1].pendingSections, ['Jira board', 'Capacity']);
    assert.equal(sequence(harness.log).includes('saveCapacityConfig'), false, 'the sequence stops at the failing step');
    assert.equal(sequence(harness.log).includes('POST /api/groups-config'), false);
    assert.ok(hook, 'mounted');
});

test('authentication required: the draft is preserved, the outcome says so, the request is not replayed, no error text', async () => {
    const authError = Object.assign(new Error('auth'), { name: 'AuthenticationRequiredError' });
    const harness = makeHarness({ dirty: { projects: true } });
    harness.input.saveProjectSelection = async () => { harness.log.push(['saveProjectSelection']); throw authError; };
    const mod = await load();
    const result = render(mod.useSharedConfigSave, harness.input);
    const outcome = await result.saveAllSettings({});
    assert.equal(outcome.authRequired, true);
    assert.equal(sequence(harness.log).filter((name) => name === 'saveProjectSelection').length, 1);
    assert.equal(sequence(harness.log).includes('setSettingsSaveError') && harness.log.some((entry) => entry[0] === 'setSettingsSaveError' && entry[1]), false);
    assert.equal(sequence(harness.log).includes('POST /api/groups-config'), false);
    assert.equal(outcome.pendingSections.admin, true);
});

test('saveAllSettings guards re-entry and releases the flag after success and after a throw', async () => {
    const mod = await load();
    const harness = makeHarness({ overrides: { isGroupVisibilityDraftDirty: true } });
    let gate;
    let calls = 0;
    harness.input.persistGroupPreferences = () => { calls += 1; return calls === 1 ? new Promise((resolve) => { gate = resolve; }) : Promise.resolve(); };
    const result = render(mod.useSharedConfigSave, harness.input);
    const first = result.saveAllSettings({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1, 'the first save is parked inside its preference write');
    const second = await result.saveAllSettings({});
    assert.equal(second.inFlight, true);
    assert.equal(second.ok, false);
    assert.equal(calls, 1, 'the guarded call performs no write');
    gate();
    assert.equal((await first).ok, true);
    const third = await result.saveAllSettings({});
    assert.equal(third.inFlight, false);
    assert.equal(third.ok, true, 'the flag is released after success');
    // ... and after a throw inside the guarded save.
    const failing = makeHarness();
    failing.input.saveEpmConfig = async () => { throw new Error('boom'); };
    failing.input.isEpmConfigDirty = true;
    failing.input.groupDraftSignature = 'baseline';
    const failed = render(mod.useSharedConfigSave, failing.input);
    const failure = await failed.saveAllSettings({});
    assert.equal(failure.ok, false);
    assert.equal(failure.error, 'boom');
    failing.input.saveEpmConfig = async () => true;
    const retry = await failed.saveAllSettings({});
    assert.equal(retry.inFlight, false, 'the in-flight flag is cleared by the finally block');
});

test('aggregates: isGroupDraftDirty, unsavedSectionsCount and saveBlockedReason follow the permission and dirtiness tables', async () => {
    const clean = await mount({ overrides: { groupDraftSignature: 'baseline' } });
    assert.equal(clean.hook.isGroupDraftDirty, false);
    assert.equal(clean.hook.unsavedSectionsCount, 0);
    assert.equal(clean.hook.saveBlockedReason, 'No changes to save');
    const dirtyGroups = await mount();
    assert.equal(dirtyGroups.hook.isGroupDraftDirty, true);
    assert.equal(dirtyGroups.hook.unsavedSectionsCount, 1);
    assert.equal(dirtyGroups.hook.saveBlockedReason, '');
    // A dirty shared section counts only for an explicit editor; EPM only for an EPM editor; visibility always.
    const editor = await mount({ dirty: { projects: true, board: true, adminAccess: true }, overrides: { groupDraftSignature: 'baseline', dirtyFieldConfigCount: 2, anyFieldConfigDirty: true } });
    assert.equal(editor.hook.isGroupDraftDirty, true);
    assert.equal(editor.hook.unsavedSectionsCount, 3 + 2);
    const viewer = await mount({ dirty: { projects: true, board: true, adminAccess: true }, overrides: { canEditSharedConfiguration: false, groupDraftSignature: 'baseline', dirtyFieldConfigCount: 2, anyFieldConfigDirty: true } });
    assert.equal(viewer.hook.isGroupDraftDirty, false);
    assert.equal(viewer.hook.unsavedSectionsCount, 0);
    const epm = await mount({ overrides: { isEpmConfigDirty: true, groupDraftSignature: 'baseline' } });
    assert.equal(epm.hook.isGroupDraftDirty, true);
    assert.equal(epm.hook.unsavedSectionsCount, 1);
    const noEpm = await mount({ overrides: { isEpmConfigDirty: true, canEditEpmConfiguration: false, groupDraftSignature: 'baseline' } });
    assert.equal(noEpm.hook.isGroupDraftDirty, false);
    const visibility = await mount({ overrides: { isGroupVisibilityDraftDirty: true, groupDraftSignature: 'baseline' } });
    assert.equal(visibility.hook.isGroupDraftDirty, true);
    assert.equal(visibility.hook.unsavedSectionsCount, 1);
    // Blocked reasons, first match wins.
    const reasons = [
        [{ groupSaving: true }, 'Save in progress'],
        [{ epmConfigSaving: true }, 'Save in progress'],
        [{ firstRunConfigurationActive: true, firstRunConfigurationSession: { guideComplete: false, committedAdminSections: {} } }, 'Complete the configuration guide before saving'],
        [{ authMode: 'atlassian_oauth', sharedConfigReady: false }, 'Shared settings are loading'],
        [{ isEpmConfigDirty: true, epmConfigLoading: true }, 'EPM settings are loading'],
    ];
    for (const [overrides, expected] of reasons) {
        const blocked = await mount({ overrides });
        assert.equal(blocked.hook.saveBlockedReason, expected, JSON.stringify(Object.keys(overrides)));
    }
    const basic = await mount({ overrides: { authMode: 'jira_basic', sharedConfigReady: false } });
    assert.equal(basic.hook.saveBlockedReason, '', 'the shared-config loading gate applies to OAuth only');
});

test('validation errors: required admin fields, capacity pairing, Capacity/Ad Hoc overlap, favorite error outside first-run, board validation', async () => {
    const dirtyAdmin = { dirty: { projects: true } };
    const base = await mount(dirtyAdmin);
    assert.deepEqual(base.hook.groupConfigValidationErrors, []);
    const missing = await mount({ ...dirtyAdmin, overrides: { selectedProjectsDraft: [], sprintFieldIdDraft: '', parentNameFieldIdDraft: '', storyPointsFieldIdDraft: '', teamFieldIdDraft: '', capacityProjectDraft: 'CAP', capacityFieldIdDraft: '', priorityWeightsValidationError: 'Weights must total 100.' } });
    assert.deepEqual(missing.hook.groupConfigValidationErrors, [
        'Add at least one dashboard project before saving.', 'Sprint field is required.', 'Parent name field is required.', 'Story points field is required.', 'Team field is required.',
        'Capacity field is required when a capacity project is selected.', 'Weights must total 100.',
    ]);
    const reversed = await mount({ ...dirtyAdmin, overrides: { capacityProjectDraft: '', capacityFieldIdDraft: 'cf' } });
    assert.deepEqual(reversed.hook.groupConfigValidationErrors, ['Capacity project is required when a capacity field is selected.']);
    // Admin validation applies only to editors, and only when an admin tab is open or a core section is dirty.
    const viewer = await mount({ ...dirtyAdmin, overrides: { canEditSharedConfiguration: false, selectedProjectsDraft: [] } });
    assert.deepEqual(viewer.hook.groupConfigValidationErrors, []);
    const idle = await mount({ overrides: { selectedProjectsDraft: [], groupManageTab: 'teams' } });
    assert.deepEqual(idle.hook.groupConfigValidationErrors, []);
    const onAdminTab = await mount({ overrides: { selectedProjectsDraft: [], groupManageTab: 'scope' } });
    assert.deepEqual(onAdminTab.hook.groupConfigValidationErrors, ['Add at least one dashboard project before saving.']);
    const accessTab = await mount({ overrides: { selectedProjectsDraft: [], groupManageTab: 'access' } });
    assert.deepEqual(accessTab.hook.groupConfigValidationErrors, [], 'the access and performance tabs never validate Admin scope');
    const overlap = await mount({ overrides: { groupManageTab: 'teams', groupDraft: { groups: [{ id: 'g1', name: 'Core', teamIds: [], excludedCapacityEpics: ['abc-1', 'X-2'], adHocCapacityEpics: ['ABC-1'] }], configRevision: 1 } } });
    assert.deepEqual(overlap.hook.groupConfigValidationErrors, ['Core: ABC-1 cannot be both excluded capacity and Ad Hoc capacity.']);
    const favorite = await mount({ overrides: { groupManageTab: 'teams', favoriteGroupValidationError: 'Pick a favorite.' } });
    assert.deepEqual(favorite.hook.groupConfigValidationErrors, ['Pick a favorite.']);
    const favoriteFirstRun = await mount({ overrides: { groupManageTab: 'teams', favoriteGroupValidationError: 'Pick a favorite.', firstRunConfigurationActive: true } });
    assert.deepEqual(favoriteFirstRun.hook.groupConfigValidationErrors, []);
});

test('validation errors short-circuit the save: the error is set, the failure tracked, no write, catalogs recovered for board-affecting saves', async () => {
    const harness = makeHarness({ dirty: { board: true }, overrides: { selectedProjectsDraft: [] } });
    const mod = await load();
    const result = render(mod.useSharedConfigSave, harness.input);
    const outcome = await result.saveAllSettings({});
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, 'Add at least one dashboard project before saving.');
    assert.ok(harness.log.some((entry) => entry[0] === 'setGroupDraftError' && entry[1] === 'Add at least one dashboard project before saving.'));
    assert.equal(sequence(harness.log).includes('saveBoardConfig'), false);
    assert.equal(sequence(harness.log).includes('POST /api/groups-config'), false);
});

test('saveAllSettings(connections tab) is a no-op and a missing group draft reports unavailability', async () => {
    const connections = await mount({ overrides: { groupManageTab: 'connections' } });
    assert.equal(await connections.hook.saveAllSettings({}), undefined);
    assert.deepEqual(connections.log, []);
});

test('keep/discard/use-latest exits: Keep mine rebases on the reported revision; Discard applies the server copy; Use latest clears then loads', async () => {
    const current = { configRevision: 31, groups: [{ id: 'srv' }] };
    const keep = await mount({ overrides: { groupsConfigConflict: { current } } });
    await keep.hook.keepMineOnGroupsConfigConflict();
    const rebased = keep.log.find((entry) => entry[0] === 'setGroupDraft');
    assert.equal(typeof rebased[1], 'function');
    assert.deepEqual(rebased[1]({ groups: [], configRevision: 1 }), { groups: [], configRevision: 31 });
    assert.equal(rebased[1](null), null);
    assert.ok(sequence(keep.log).includes('POST /api/groups-config'));
    const discard = await mount({ overrides: { groupsConfigConflict: { current } } });
    discard.hook.discardMineOnGroupsConfigConflict();
    assert.deepEqual(sequence(discard.log).slice(0, 3), ['applySavedGroupsConfig', 'setGroupsConfigConflict', 'setGroupDraftError']);
    const none = await mount();
    await none.hook.keepMineOnGroupsConfigConflict();
    none.hook.discardMineOnGroupsConfigConflict();
    assert.deepEqual(none.log, []);
    const workspace = await mount({ overrides: { workspaceConfigConflict: { currentRevision: '44' } } });
    await workspace.hook.keepMineOnWorkspaceConfigConflict();
    assert.equal(workspace.refs.sharedConfigRevisionRef.current, 44);
    assert.deepEqual(sequence(workspace.log).slice(0, 3), ['sharedConfigRevisionRef=', 'setSharedConfigRevision', 'setWorkspaceConfigConflict']);
    const idle = await mount();
    await idle.hook.keepMineOnWorkspaceConfigConflict();
    assert.deepEqual(idle.log, []);
    const latest = await mount({ overrides: { isEpmConfigDirty: true } });
    await latest.hook.useLatestWorkspaceConfig();
    assert.deepEqual(sequence(latest.log).slice(0, 3), ['setWorkspaceConfigConflict', 'setGroupDraftError', 'loadConfig']);
    assert.deepEqual(latest.log.find((entry) => entry[0] === 'loadConfig')[1], { preserveEpmDraft: true, replaceWorkspaceDrafts: true });
});

test('first-run recovery: restore only uncommitted sections, preserve committed ones, then return and close', async () => {
    const session = {
        status: 'preference_pending', capturedDrafts: {
            admin: { projects: [{ key: 'OLD' }], board: { boardId: '7', boardName: 'B' }, capacity: { project: 'C', fieldId: 'f', fieldName: 'F' }, sprintField: { fieldId: 'sf', fieldName: 'SF' }, issueTypes: ['Epic'], adminAccess: ['u1'] },
            epm: { scope: 'e' }, private: { visibleGroupIds: ['a'] },
        },
        committedAdminSections: { board: true }, committedSections: {}, latestNormalizedGroups: { groups: [{ id: 'n' }] }, guideComplete: true,
    };
    const { hook, log } = await mount({ overrides: { firstRunConfigurationSession: session, firstRunConfigurationActive: true, adminAccess: { selectedUserIds: ['u2'], toggleUser: (id) => log.push(['toggleUser', id]), save: async () => {} } } });
    hook.returnFromFirstRunConfigurationRecovery();
    const names = sequence(log);
    assert.ok(names.includes('setSelectedProjectsDraft'));
    assert.equal(names.includes('setBoardIdDraft'), false, 'a committed section is not restored');
    assert.ok(names.includes('setCapacityProjectDraft') && names.includes('setSprintFieldIdDraft') && names.includes('setIssueTypesDraft'));
    assert.deepEqual(log.filter((entry) => entry[0] === 'toggleUser').map((entry) => entry[1]).sort(), ['u1', 'u2']);
    assert.ok(names.includes('setEpmConfigDraft') && names.includes('setGroupPreferences'));
    assert.deepEqual(log.find((entry) => entry[0] === 'dispatchFirstRunConfigurationSession')[1], { type: 'return_after_preference' });
    assert.ok(before(log, 'applySavedGroupsConfig', 'setSelectedProjectsDraft'), 'the saved groups snapshot is applied before restore');
    assert.equal(names[names.length - 1], 'closeGroupManage');
    assert.deepEqual(hook.returnFromFirstRunConfigurationRecovery.__deps.length, 2);
});

test('applySharedConfigBootstrap: sections apply in order with the preserve predicates; EPM applies only when not preserved; revision commits and conflict clears', async () => {
    const config = { sharedConfig: { projects: [] }, sharedConfigRevision: 17, viewConfig: { view: { epm: { scope: 'private' } } }, epm: { scope: 'legacy' } };
    const preserveSettings = () => false;
    const apply = await mount();
    apply.hook.applySharedConfigBootstrap(config, preserveSettings, () => false);
    assert.deepEqual(sequence(apply.log), ['applyJiraProjectsAndBoardLoaded', 'applyCapacityLoaded', 'applyPriorityWeightsLoaded', 'applyJiraIssueTypesLoaded', 'seedSharedFieldConfigs', 'applySavedEpmConfig', 'sharedConfigRevisionRef=', 'setSharedConfigRevision', 'setWorkspaceConfigConflict']);
    assert.deepEqual(apply.log[0].slice(1), [config.sharedConfig, preserveSettings]);
    assert.deepEqual(apply.log[1].slice(1), [config.sharedConfig, preserveSettings, config]);
    assert.deepEqual(apply.log[4].slice(1), [config.sharedConfig, { shouldPreserveDraft: preserveSettings }]);
    assert.deepEqual(apply.log[5].slice(1), [{ scope: 'private' }], 'the private view EPM wins over the compatibility field');
    assert.equal(apply.refs.sharedConfigRevisionRef.current, 17);
    assert.deepEqual(apply.log[6].slice(1), [17]);
    assert.deepEqual(apply.log[7].slice(1), [17]);
    assert.deepEqual(apply.log[8].slice(1), [null]);
    const preserved = await mount();
    preserved.hook.applySharedConfigBootstrap({ ...config, viewConfig: undefined }, preserveSettings, () => true);
    assert.equal(sequence(preserved.log).includes('applySavedEpmConfig'), false);
    const legacy = await mount();
    legacy.hook.applySharedConfigBootstrap({ ...config, viewConfig: undefined }, preserveSettings, () => false);
    assert.deepEqual(legacy.log.find((entry) => entry[0] === 'applySavedEpmConfig').slice(1), [{ scope: 'legacy' }]);
});

test('getters are read only inside handlers: render with throwing getters, first read inside the save and conflict handlers', async () => {
    const throwing = Object.fromEntries(GETTERS.map((name) => [name, () => { throw new Error(`${name} read during render`); }]));
    const mod = await load();
    const harness = makeHarness({ overrides: throwing });
    const result = render(mod.useSharedConfigSave, harness.input);
    assert.equal(typeof result.saveAllSettings, 'function');
    const reads = [];
    const probe = makeHarness({ overrides: Object.fromEntries(GETTERS.map((name) => [name, () => { reads.push(name); return makeHarness().input[name](); }])) });
    const rendered = render(mod.useSharedConfigSave, probe.input);
    assert.deepEqual(reads, [], 'no getter is read while rendering');
    await rendered.saveAllSettings({});
    assert.ok(reads.includes('getLoadSprints') && reads.includes('getActiveDepartmentSettingsTab') && (!CLOSE_VIA_GETTER || reads.includes('getCloseGroupManage')));
    assert.equal(hookSource.split('getLoadConfig()').length - 1, 1, 'loadConfig is read once, inside useLatestWorkspaceConfig');
    assert.equal(hookSource.split('getLoadSprints()').length - 1, 1);
    assert.equal(hookSource.split('getActiveDepartmentSettingsTab()').length - 1, 1);
    assert.equal(hookSource.split('getCloseGroupManage()').length - 1, CLOSE_VIA_GETTER ? 3 : 0, 'saveGroupsConfig, saveAllSettingsOnce and the recovery callback');
});

test('verbatim closures: no useCallback or latest-ref around the save functions; the two recovery callbacks keep their dependency arrays', () => {
    assert.equal(/React\.useCallback\(\(\) => saveAllSettings/.test(hookSource), false);
    assert.equal(/latest.*Ref|useLatest\(/i.test(mainSource.replace('useLatestWorkspaceConfig', '')), false);
    for (const name of ['saveGroupsConfig', 'saveAllSettingsOnce', 'saveAllSettings']) assert.ok(hookSource.includes(`const ${name} = async`), name);
    assert.ok(hookSource.includes('}, [adminAccess, firstRunConfigurationSession]);'));
    assert.ok(hookSource.includes('}, [firstRunConfigurationSession, restoreSettingsDraftsToCommittedBaselines]);'));
    assert.equal((mainSource.match(/\buseEffect\(|React\.useEffect\(/g) || []).length, 0, 'the save hook registers no effect, so its call position crosses none');
});

test('dashboard call sites: state layer before the first Settings section hook, save hook after useEpmSettings, getters are arrows, nothing reads them', () => {
    const at = (needle, from = 0) => { const index = dashboardSource.indexOf(needle, from); assert.notStrictEqual(index, -1, needle); return index; };
    const stateCall = at('} = useSharedConfigSaveState();');
    const firstSection = at('} = usePriorityWeightsSettings({');
    const epmCall = at('} = useEpmSettings({');
    const teamGroupsCall = at('} = useTeamGroupSettings({');
    const saveCall = at('} = useSharedConfigSave({');
    assert.ok(stateCall < firstSection, 'the state layer feeds every section hook');
    assert.ok(teamGroupsCall < saveCall && epmCall < saveCall, 'the save hook is called after the hooks whose outputs it reads while rendering');
    const callSource = dashboardSource.slice(saveCall, dashboardSource.indexOf('\n            });', saveCall));
    for (const [getter, binding] of [['getActiveDepartmentSettingsTab', 'activeDepartmentSettingsTab'], ['getLoadConfig', 'loadConfig'], ['getLoadSprints', 'loadSprints']]) {
        assert.ok(callSource.includes(`${getter}: () => ${binding},`), getter);
    }
    assert.equal(/get(?:LoadConfig|LoadSprints|ActiveDepartmentSettingsTab|CloseGroupManage)\(/.test(dashboardSource), false, 'App never calls a getter');
    assert.equal(dashboardSource.includes('const saveGroupsConfig ='), false);
    assert.equal(dashboardSource.includes('const saveAllSettings ='), false);
    assert.equal(dashboardSource.includes('const settingsSaveInFlightRef'), false);
    // Both loadConfig and the save refresh keep their per-render closures: no useCallback around the hook inputs.
    assert.equal(/getLoad(?:Config|Sprints): React\.useCallback/.test(dashboardSource), false);
    assert.ok(dashboardSource.includes('applySharedConfigBootstrap(config, shouldPreserveSettingsDraft, shouldPreserveEpmDraft);'));
    assert.ok(dashboardSource.includes('const loadConfig = async ({ preserveEpmDraft = false, replaceWorkspaceDrafts = false } = {}) => {'));
});
