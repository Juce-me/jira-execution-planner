const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { readOwnerSource } = require('./frontend_source_helpers');

// Server-render probe for useFirstRunConfiguration (ST4 R4a): the state layer called at the old state lines and
// the handlers layer called where its inputs exist. A server render cannot run state updates or effects, so both
// layers are bundled against a thin React wrapper that seeds the reducer session and the refs, records every
// useCallback dependency array, and captures the effect callback so a test can run it by hand. App-owned inputs
// are recording stubs: the order of their calls is the observable behaviour.
const hookPath = path.join(__dirname, '../frontend/src/settings/useFirstRunConfiguration.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
const stateSource = hookSource.slice(hookSource.indexOf('export function useFirstRunConfigurationState('), hookSource.indexOf('export function useFirstRunConfiguration({'));
const handlersSource = hookSource.slice(hookSource.indexOf('export function useFirstRunConfiguration({'));

const STATE_RETURN_NAMES = ['dispatchFirstRunConfigurationSession', 'firstRunConfigurationActive', 'firstRunConfigurationSession', 'firstRunConfigurationTargetGroupId', 'firstRunSetupChoice', 'pendingFirstRunConfigurationRef', 'pendingFirstRunGroupPreferencesRef', 'setFirstRunConfigurationTargetGroupId', 'setFirstRunSetupChoice'];
const INPUT_NAMES = ['activeGroupDraft', 'activeGroupId', 'adminAccess', 'boardIdDraft', 'boardNameDraft', 'capacityFieldIdDraft', 'capacityFieldNameDraft', 'capacityProjectDraft', 'deliveryOwnerFieldIdDraft', 'deliveryOwnerFieldNameDraft', 'dispatchFirstRunConfigurationSession', 'epmConfigDraft', 'firstRunConfigurationActive', 'firstRunConfigurationSession', 'firstRunSetupChoice', 'getCloseGroupManage', 'getSaveAllSettings', 'groupDraftBaselineRef', 'groupPreferences', 'groupsConfig', 'groupsConfigConflict', 'issueTypesDraft', 'parentNameFieldIdDraft', 'parentNameFieldNameDraft', 'pendingFirstRunConfigurationRef', 'pendingFirstRunGroupPreferencesRef', 'priorityWeightsDraft', 'saveFirstRunGroupPreferences', 'selectedProjectsDraft', 'setActiveGroupId', 'setDepartmentSettingsTab', 'setFirstRunConfigurationTargetGroupId', 'setFirstRunSetupChoice', 'setGroupDraft', 'setGroupManageTab', 'setGroupPreferences', 'setGroupsConfig', 'setSharedConfigRevision', 'setShowGroupListMobile', 'setShowGroupManage', 'setWorkspaceConfigConflict', 'sharedConfigRevisionRef', 'showGroupManage', 'sprintFieldIdDraft', 'sprintFieldNameDraft', 'storyPointsFieldIdDraft', 'storyPointsFieldNameDraft', 'teamFieldIdDraft', 'teamFieldNameDraft', 'workspaceConfigConflict'];
const RETURN_NAMES = ['advanceFirstRunConfigurationGuide', 'backFirstRunConfigurationGuide', 'cancelFirstRunConfiguration', 'closeFirstRunSetupChoice', 'configureFirstRunGroup', 'continueFirstRunSetupChoice', 'firstRunConfigurationGuideVisible', 'firstRunHasCommittedSection', 'openFirstRunSetupChoice', 'retryFirstRunConfiguration'];
const GUIDE_STEPS = ['name', 'teams', 'components', 'favorite', 'visibility'];

let hooksPromise;
function loadHooks() {
    hooksPromise = hooksPromise || esbuild.build({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], loader: { '.jsx': 'jsx' },
    }).then((result) => result.outputFiles[0].text);
    return hooksPromise;
}

async function instantiate({ session, stateOverrides = {}, setterCalls = [], dispatchCalls = [], callbacks = [], effects = [] } = {}) {
    const code = await loadHooks();
    const initialSession = session;
    const shimmedReact = {
        ...React,
        useState(initial) {
            const next = stateOverrides[`state${(shimmedReact.stateIndex = (shimmedReact.stateIndex || 0) + 1)}`];
            return [next === undefined ? initial : next, (value) => { setterCalls.push(['state', value]); }];
        },
        useReducer(reducer, arg, init) {
            return [initialSession || init(arg), (action) => { dispatchCalls.push(action); }];
        },
        useRef(initial) { return { current: initial }; },
        useCallback(fn, deps) { callbacks.push({ fn, deps }); return fn; },
        useEffect(fn, deps) { effects.push({ fn, deps }); },
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

const sessionOf = (overrides = {}) => ({
    status: 'configuring', mode: 'create', guideStep: 'name', guideComplete: false, pendingGroupId: 'g-new',
    capturedDrafts: null, committedSections: {}, committedAdminSections: {}, latestNormalizedGroups: null, ...overrides,
});

// Handler-layer harness: every App input is a recording stub in one shared call log.
async function handlers({ session = sessionOf(), overrides = {}, stateOverrides } = {}) {
    const log = [];
    const callbacks = [];
    const effects = [];
    const dispatchCalls = [];
    const rec = (name, value) => (...args) => { log.push([name, ...args]); return value; };
    const { useFirstRunConfiguration } = await instantiate({ session, stateOverrides, callbacks, effects, dispatchCalls });
    const input = {
        activeGroupDraft: { id: 'g-new' },
        activeGroupId: 'g-active',
        adminAccess: { selectedUserIds: ['u1', 'u2'] },
        boardIdDraft: 'b-id', boardNameDraft: 'b-name',
        capacityFieldIdDraft: 'cap-f-id', capacityFieldNameDraft: 'cap-f-name', capacityProjectDraft: 'cap-p',
        deliveryOwnerFieldIdDraft: 'do-id', deliveryOwnerFieldNameDraft: 'do-name',
        dispatchFirstRunConfigurationSession: (action) => { log.push(['dispatch', action]); },
        epmConfigDraft: { epm: true },
        firstRunConfigurationActive: true,
        firstRunConfigurationSession: session,
        firstRunSetupChoice: null,
        getCloseGroupManage: () => { log.push(['getCloseGroupManage']); return rec('closeGroupManage'); },
        getSaveAllSettings: () => { log.push(['getSaveAllSettings']); return async (options) => { log.push(['saveAllSettings', options]); return { ok: true }; }; },
        groupDraftBaselineRef: { current: '' },
        groupPreferences: { customized: false, visibleGroupIds: [] },
        groupsConfig: { version: 1, groups: [{ id: 'g1', name: 'Alpha' }], defaultGroupId: 'g1' },
        groupsConfigConflict: null,
        issueTypesDraft: ['Story'],
        parentNameFieldIdDraft: 'pn-id', parentNameFieldNameDraft: 'pn-name',
        pendingFirstRunConfigurationRef: { current: null },
        pendingFirstRunGroupPreferencesRef: { current: { stale: true } },
        priorityWeightsDraft: { p: 1 },
        saveFirstRunGroupPreferences: async (args) => { log.push(['saveFirstRunGroupPreferences', args]); return { ok: true }; },
        selectedProjectsDraft: [{ key: 'A' }],
        setActiveGroupId: rec('setActiveGroupId'),
        setDepartmentSettingsTab: rec('setDepartmentSettingsTab'),
        setFirstRunConfigurationTargetGroupId: rec('setFirstRunConfigurationTargetGroupId'),
        setFirstRunSetupChoice: rec('setFirstRunSetupChoice'),
        setGroupDraft: rec('setGroupDraft'),
        setGroupManageTab: rec('setGroupManageTab'),
        setGroupPreferences: rec('setGroupPreferences'),
        setGroupsConfig: rec('setGroupsConfig'),
        setSharedConfigRevision: rec('setSharedConfigRevision'),
        setShowGroupListMobile: rec('setShowGroupListMobile'),
        setShowGroupManage: rec('setShowGroupManage'),
        setWorkspaceConfigConflict: rec('setWorkspaceConfigConflict'),
        sharedConfigRevisionRef: { current: 3 },
        showGroupManage: false,
        sprintFieldIdDraft: 'sp-id', sprintFieldNameDraft: 'sp-name',
        storyPointsFieldIdDraft: 'st-id', storyPointsFieldNameDraft: 'st-name',
        teamFieldIdDraft: 'tf-id', teamFieldNameDraft: 'tf-name',
        workspaceConfigConflict: null,
        ...overrides,
    };
    const result = render(useFirstRunConfiguration, input);
    return { result, input, log, callbacks, effects };
}

test('the state layer holds idle first-run defaults and returns its nine names in order', async () => {
    const setterCalls = [];
    const { useFirstRunConfigurationState } = await instantiate({ setterCalls });
    const result = render(useFirstRunConfigurationState, undefined);
    assert.deepEqual(Object.keys(result), STATE_RETURN_NAMES);
    assert.equal(result.firstRunSetupChoice, null);
    assert.equal(result.firstRunConfigurationTargetGroupId, null);
    assert.equal(result.firstRunConfigurationSession.status, 'idle');
    assert.equal(result.firstRunConfigurationActive, false);
    assert.deepEqual(result.pendingFirstRunConfigurationRef, { current: null });
    assert.deepEqual(result.pendingFirstRunGroupPreferencesRef, { current: null });
    assert.equal(typeof result.dispatchFirstRunConfigurationSession, 'function');
    assert.equal(stateSource.includes('settingsSaveInFlightRef'), false, 'the in-flight save ref is ST5-owned and stays in App');
    assert.equal(stateSource.includes('useEffect'), false, 'the state layer owns no effect');
});

test('first-run configuration is active for every session status except idle and complete', async () => {
    for (const [status, active] of [['idle', false], ['complete', false], ['configuring', true], ['sections_pending', true], ['preference_pending', true], ['saving_sections', true]]) {
        const { useFirstRunConfigurationState } = await instantiate({ session: sessionOf({ status }) });
        assert.equal(render(useFirstRunConfigurationState, undefined).firstRunConfigurationActive, active, status);
    }
});

test('the handlers layer takes the 50 documented inputs and returns its 10 names in order', async () => {
    const signature = hookSource.slice(hookSource.indexOf('export function useFirstRunConfiguration({') + 'export function useFirstRunConfiguration({\n'.length, hookSource.indexOf('\n}) {'));
    assert.deepEqual(signature.split('\n').map((line) => line.trim().replace(/,$/, '')), INPUT_NAMES);
    assert.equal(INPUT_NAMES.length, 50);
    const { result, input } = await handlers();
    assert.deepEqual(Object.keys(input), INPUT_NAMES);
    assert.deepEqual(Object.keys(result), RETURN_NAMES);
});

test('both getters are handler-only: rendering the layer never calls them', async () => {
    const { log } = await handlers();
    assert.equal(log.some((entry) => entry[0] === 'getCloseGroupManage' || entry[0] === 'getSaveAllSettings'), false);
    // Throwing getters would surface a TDZ-style render-phase read as a render failure.
    const throwing = () => { throw new Error('getter invoked during render'); };
    await handlers({ overrides: { getCloseGroupManage: throwing, getSaveAllSettings: throwing } });
});

test('each useCallback keeps its original dependency array and no getter joins one', async () => {
    const { callbacks, input } = await handlers();
    assert.equal(callbacks.length, 10);
    const [open, openSettings, close, capture, configure, proceed, advance, back, cancel, retry] = callbacks;
    for (const callback of [open, openSettings, close]) assert.deepEqual(callback.deps, []);
    assert.equal(capture.deps.length, 23, 'captureFirstRunSettingsDrafts');
    assert.deepEqual(configure.deps, [capture.fn, openSettings.fn], 'configureFirstRunGroup');
    assert.deepEqual(proceed.deps, [capture.fn, input.firstRunSetupChoice, input.groupsConfig.groups, openSettings.fn], 'continueFirstRunSetupChoice');
    assert.deepEqual(advance.deps, [input.firstRunConfigurationSession.guideStep]);
    assert.deepEqual(back.deps, [input.firstRunConfigurationSession.guideStep]);
    assert.deepEqual(cancel.deps, [input.firstRunConfigurationSession]);
    assert.deepEqual(retry.deps, [input.firstRunConfigurationSession, input.groupsConfigConflict, input.workspaceConfigConflict, input.saveFirstRunGroupPreferences]);
    for (const { deps } of callbacks) {
        assert.equal(deps.includes(input.getCloseGroupManage) || deps.includes(input.getSaveAllSettings), false, 'no getter enters a dependency array');
    }
});

test('opening and closing the setup choice stage and clear it with the original shapes', async () => {
    const { result, log } = await handlers();
    result.openFirstRunSetupChoice();
    result.closeFirstRunSetupChoice();
    assert.deepEqual(log, [
        ['setFirstRunSetupChoice', { mode: 'create', sourceGroupId: null, removeTeams: false, removeComponents: false }],
        ['setFirstRunSetupChoice', null],
    ]);
});

test('configuring a group stages a repair, starts the session with every captured draft and opens Settings in order', async () => {
    const { result, log, input } = await handlers();
    result.configureFirstRunGroup('g1');
    assert.deepEqual(input.pendingFirstRunConfigurationRef.current, { mode: 'repair', sourceGroupId: 'g1', removeTeams: false, removeComponents: false });
    const [targetCall, clearCall, dispatchCall, ...open] = log;
    assert.deepEqual(targetCall, ['setFirstRunConfigurationTargetGroupId', 'g1']);
    assert.deepEqual(clearCall, ['setFirstRunSetupChoice', null]);
    assert.equal(dispatchCall[0], 'dispatch');
    const action = dispatchCall[1];
    assert.deepEqual({ type: action.type, mode: action.mode, pendingGroupId: action.pendingGroupId }, { type: 'start', mode: 'repair', pendingGroupId: 'g1' });
    assert.deepEqual(open, [['setGroupManageTab', 'teams'], ['setDepartmentSettingsTab', 'teams'], ['setShowGroupListMobile', true], ['setShowGroupManage', true]]);
});

test('captured drafts map every administrator section, the shared, private and EPM drafts and the active group', async () => {
    const { result, log, input } = await handlers();
    result.configureFirstRunGroup('g1');
    const drafts = log.find((entry) => entry[0] === 'dispatch')[1].drafts;
    assert.equal(drafts.shared, input.groupsConfig);
    assert.equal(drafts.private, input.groupPreferences);
    assert.equal(drafts.activeGroupId, 'g-active');
    assert.equal(drafts.epm, input.epmConfigDraft);
    assert.deepEqual(drafts.admin, {
        projects: input.selectedProjectsDraft,
        priorityWeights: input.priorityWeightsDraft,
        board: { boardId: 'b-id', boardName: 'b-name' },
        capacity: { project: 'cap-p', fieldId: 'cap-f-id', fieldName: 'cap-f-name' },
        sprintField: { fieldId: 'sp-id', fieldName: 'sp-name' },
        parentNameField: { fieldId: 'pn-id', fieldName: 'pn-name' },
        storyPointsField: { fieldId: 'st-id', fieldName: 'st-name' },
        teamField: { fieldId: 'tf-id', fieldName: 'tf-name' },
        deliveryOwnerField: { fieldId: 'do-id', fieldName: 'do-name' },
        issueTypes: ['Story'],
        adminAccess: ['u1', 'u2'],
    });
});

test('continuing a create choice marks the new draft as the pending favorite, stages it and opens Settings', async () => {
    const { result, log, input } = await handlers({ overrides: { firstRunSetupChoice: { mode: 'create', sourceGroupId: null, removeTeams: false, removeComponents: false } } });
    result.continueFirstRunSetupChoice();
    const staged = input.pendingFirstRunConfigurationRef.current;
    assert.equal(staged.mode, 'create');
    assert.equal(staged.draft.id, 'new-department');
    assert.equal(staged.draft.name, 'New Department');
    const [targetCall, clearCall, dispatchCall, ...open] = log;
    assert.deepEqual(targetCall, ['setFirstRunConfigurationTargetGroupId', 'new-department']);
    assert.deepEqual(clearCall, ['setFirstRunSetupChoice', null]);
    assert.deepEqual({ type: dispatchCall[1].type, mode: dispatchCall[1].mode, pendingGroupId: dispatchCall[1].pendingGroupId }, { type: 'start', mode: 'create', pendingGroupId: 'new-department' });
    assert.equal(open.length, 4);
});

test('continuing a duplicate choice builds its draft from the source group and existing groups', async () => {
    const { result, input } = await handlers({ overrides: { firstRunSetupChoice: { mode: 'duplicate', sourceGroupId: 'g1', removeTeams: true, removeComponents: false } } });
    result.continueFirstRunSetupChoice();
    assert.equal(input.pendingFirstRunConfigurationRef.current.draft.name, 'Alpha Copy');
    assert.equal(input.pendingFirstRunConfigurationRef.current.draft.id, 'alpha-copy');
});

test('continuing without a choice, or with a duplicate whose source is missing, does nothing', async () => {
    const none = await handlers();
    none.result.continueFirstRunSetupChoice();
    assert.deepEqual(none.log, []);
    const orphan = await handlers({ overrides: { firstRunSetupChoice: { mode: 'duplicate', sourceGroupId: 'missing', removeTeams: false, removeComponents: false } } });
    orphan.result.continueFirstRunSetupChoice();
    assert.deepEqual(orphan.log, []);
    assert.equal(orphan.input.pendingFirstRunConfigurationRef.current, null);
});

test('the guide advances one step, completes on the last step and reveals the editor after the name step', async () => {
    for (const [index, step] of GUIDE_STEPS.entries()) {
        const session = sessionOf({ guideStep: step });
        const { result, log } = await handlers({ session, overrides: { firstRunConfigurationSession: session } });
        result.advanceFirstRunConfigurationGuide();
        if (index === GUIDE_STEPS.length - 1) {
            assert.deepEqual(log, [['dispatch', { type: 'complete_guide' }]]);
        } else if (step === 'name') {
            assert.deepEqual(log, [['dispatch', { type: 'set_guide_step', step: 'teams' }], ['setShowGroupListMobile', false]]);
        } else {
            assert.deepEqual(log, [['dispatch', { type: 'set_guide_step', step: GUIDE_STEPS[index + 1] }]]);
        }
    }
    const unknown = sessionOf({ guideStep: 'bogus' });
    const none = await handlers({ session: unknown, overrides: { firstRunConfigurationSession: unknown } });
    none.result.advanceFirstRunConfigurationGuide();
    assert.deepEqual(none.log, []);
});

test('the guide steps back, restores the list on the name step and stops at the first step', async () => {
    for (const [index, step] of GUIDE_STEPS.entries()) {
        const session = sessionOf({ guideStep: step });
        const { result, log } = await handlers({ session, overrides: { firstRunConfigurationSession: session } });
        result.backFirstRunConfigurationGuide();
        if (index === 0) assert.deepEqual(log, []);
        else if (index === 1) assert.deepEqual(log, [['dispatch', { type: 'set_guide_step', step: 'name' }], ['setShowGroupListMobile', true]]);
        else assert.deepEqual(log, [['dispatch', { type: 'set_guide_step', step: GUIDE_STEPS[index - 1] }]]);
    }
});

test('cancel restores the captured drafts, dispatches cancel and only then reads and calls the close getter', async () => {
    const captured = { shared: { version: 1, groups: [{ id: 'g1' }], defaultGroupId: 'g1' }, private: { customized: true }, activeGroupId: 'g-old' };
    const session = sessionOf({ capturedDrafts: captured });
    const { result, log, input } = await handlers({ session, overrides: { firstRunConfigurationSession: session } });
    result.cancelFirstRunConfiguration();
    assert.deepEqual(log.map((entry) => entry[0]), ['setGroupsConfig', 'setGroupDraft', 'setGroupPreferences', 'setActiveGroupId', 'dispatch', 'getCloseGroupManage', 'closeGroupManage']);
    assert.equal(log[0][1], captured.shared);
    assert.equal(log[3][1], 'g-old');
    assert.deepEqual(log[4][1], { type: 'cancel' });
    assert.match(input.groupDraftBaselineRef.current, /"g1"/, 'baseline is rewritten from the captured shared groups');
});

test('cancel is a no-op once any section is committed and falls back to a null active group', async () => {
    const committed = sessionOf({ committedSections: { groups: true }, capturedDrafts: { shared: { version: 1, groups: [] } } });
    const blocked = await handlers({ session: committed, overrides: { firstRunConfigurationSession: committed } });
    blocked.result.cancelFirstRunConfiguration();
    assert.deepEqual(blocked.log, []);
    const bare = sessionOf({ capturedDrafts: {} });
    const { result, log } = await handlers({ session: bare, overrides: { firstRunConfigurationSession: bare } });
    result.cancelFirstRunConfiguration();
    assert.deepEqual(log.map((entry) => entry[0]), ['setActiveGroupId', 'dispatch', 'getCloseGroupManage', 'closeGroupManage']);
    assert.equal(log[0][1], null);
});

test('retry after a failed preference save reports it and only closes after the preference saved', async () => {
    const session = sessionOf({ status: 'preference_pending', latestNormalizedGroups: { groups: [{ id: 'g1' }] }, pendingGroupId: 'g1' });
    const base = { session, overrides: { firstRunConfigurationSession: session } };
    const ok = await handlers(base);
    await ok.result.retryFirstRunConfiguration();
    assert.deepEqual(ok.log, [
        ['saveFirstRunGroupPreferences', { groupsSnapshot: session.latestNormalizedGroups, selectedGroupId: 'g1' }],
        ['dispatch', { type: 'preference_saved' }],
        ['getCloseGroupManage'],
        ['closeGroupManage'],
    ]);
    const failed = await handlers({ ...base, overrides: { ...base.overrides, saveFirstRunGroupPreferences: async () => ({ ok: false }) } });
    await failed.result.retryFirstRunConfiguration();
    assert.deepEqual(failed.log, [['dispatch', { type: 'preference_save_failed', error: 'Your favorite Department could not be saved.' }]]);
    for (const outcome of [{ authRequired: true }, { inFlight: true }]) {
        const parked = await handlers({ ...base, overrides: { ...base.overrides, saveFirstRunGroupPreferences: async () => outcome } });
        await parked.result.retryFirstRunConfiguration();
        assert.deepEqual(parked.log, [], 'auth-required and in-flight outcomes neither dispatch nor close');
    }
});

test('retry re-runs the unified save on the reported revision with the first-run session and rebase target', async () => {
    const session = sessionOf({ status: 'sections_pending' });
    const conflict = { current: { groups: [{ id: 'g9' }], configRevision: 9 } };
    const { result, log, input } = await handlers({ session, overrides: { firstRunConfigurationSession: session, groupsConfigConflict: conflict, workspaceConfigConflict: { currentRevision: '7' } } });
    await result.retryFirstRunConfiguration();
    assert.equal(input.sharedConfigRevisionRef.current, 7);
    assert.deepEqual(log, [
        ['setSharedConfigRevision', 7],
        ['setWorkspaceConfigConflict', null],
        ['getSaveAllSettings'],
        ['saveAllSettings', { rebaseOnto: conflict.current, firstRunSession: session }],
    ]);
    const plain = await handlers({ session, overrides: { firstRunConfigurationSession: session } });
    await plain.result.retryFirstRunConfiguration();
    assert.deepEqual(plain.log, [['getSaveAllSettings'], ['saveAllSettings', { rebaseOnto: null, firstRunSession: session }]]);
    assert.equal(plain.input.sharedConfigRevisionRef.current, 3);
});

test('the reset effect fires once the modal closes during an active session and keeps its dependencies', async () => {
    const closed = await handlers({ overrides: { showGroupManage: false, firstRunConfigurationActive: true } });
    assert.equal(closed.effects.length, 1);
    assert.deepEqual(closed.effects[0].deps, [false, true]);
    closed.effects[0].fn();
    assert.equal(closed.input.pendingFirstRunGroupPreferencesRef.current, null);
    assert.deepEqual(closed.log, [['setFirstRunConfigurationTargetGroupId', null]]);
    const open = await handlers({ overrides: { showGroupManage: true, firstRunConfigurationActive: true } });
    open.effects[0].fn();
    assert.deepEqual(open.log, []);
    assert.deepEqual(open.input.pendingFirstRunGroupPreferencesRef.current, { stale: true });
    const inactive = await handlers({ overrides: { showGroupManage: false, firstRunConfigurationActive: false } });
    inactive.effects[0].fn();
    assert.deepEqual(inactive.log, []);
});

test('the guide is visible only for an active session with a draft until completion or a pending recovery state', async () => {
    const cases = [
        [sessionOf({ guideComplete: false }), true, { id: 'g' }, true],
        [sessionOf({ guideComplete: true, status: 'configuring' }), true, { id: 'g' }, false],
        [sessionOf({ guideComplete: true, status: 'sections_pending' }), true, { id: 'g' }, true],
        [sessionOf({ guideComplete: true, status: 'preference_pending' }), true, { id: 'g' }, true],
        [sessionOf({ guideComplete: false }), false, { id: 'g' }, false],
        [sessionOf({ guideComplete: false }), true, null, false],
    ];
    for (const [session, active, draft, visible] of cases) {
        const { result } = await handlers({ session, overrides: { firstRunConfigurationSession: session, firstRunConfigurationActive: active, activeGroupDraft: draft } });
        assert.equal(Boolean(result.firstRunConfigurationGuideVisible), visible, JSON.stringify([session.status, session.guideComplete, active, Boolean(draft)]));
    }
    for (const [committed, active, expected] of [[{ groups: true }, true, true], [{}, true, false], [{ epm: false }, true, false], [{ groups: true }, false, false]]) {
        const session = sessionOf({ committedSections: committed });
        const { result } = await handlers({ session, overrides: { firstRunConfigurationSession: session, firstRunConfigurationActive: active } });
        assert.equal(Boolean(result.firstRunHasCommittedSection), expected, JSON.stringify([committed, active]));
    }
});

test('layer order and getter phase: the state layer precedes its first reader and each getter is read only inside its callbacks', () => {
    const at = (needle, from = 0) => {
        const index = dashboardSource.indexOf(needle, from);
        assert.notStrictEqual(index, -1, `Expected dashboard to contain ${needle}`);
        return index;
    };
    const stateCall = at('} = useFirstRunConfigurationState();');
    const teamGroupsCall = at('} = useTeamGroupSettings({');
    const epmCall = at('} = useEpmSettings({');
    const handlersCall = at('} = useFirstRunConfiguration({');
    const homeTokenEffect = at('if (!homeTokenConnectionLoaded) return;');
    const modalOpenEffect = at('const nextGroupDraft = pendingDraft ? {');
    assert.ok(stateCall < teamGroupsCall, 'the state layer is called before useTeamGroupSettings, which reads firstRunConfigurationActive while rendering');
    assert.ok(epmCall < handlersCall && handlersCall < homeTokenEffect && handlersCall < modalOpenEffect, 'the handlers layer sits at the old handler position, after useEpmSettings and before the next unmoved effect');
    const between = dashboardSource.slice(epmCall, handlersCall);
    assert.doesNotMatch(between, /\buseEffect\(|useLayoutEffect\(|Effects?\(\{/, 'the reset effect crosses no unmoved effect');
    assert.equal(dashboardSource.split('getCloseGroupManage: () => closeGroupManage').length - 1, 1);
    assert.equal(dashboardSource.split('getSaveAllSettings: () => saveAllSettings').length - 1, 1);
    assert.equal(/getCloseGroupManage\(|getSaveAllSettings\(/.test(dashboardSource), false, 'App never calls a getter');
    const calls = (name) => [...handlersSource.matchAll(new RegExp(`${name}\\(\\)`, 'g'))].map((match) => match.index);
    const within = (index, startMarker, endMarker) => {
        const start = handlersSource.indexOf(startMarker);
        const end = handlersSource.indexOf(endMarker, start);
        return start >= 0 && index > start && index < end;
    };
    assert.equal(calls('getCloseGroupManage').length, 2);
    assert.ok(within(calls('getCloseGroupManage')[0], 'const cancelFirstRunConfiguration = React.useCallback(', 'const retryFirstRunConfiguration'));
    assert.ok(within(calls('getCloseGroupManage')[1], 'const retryFirstRunConfiguration = React.useCallback(async () => {', '    const firstRunConfigurationGuideVisible'));
    assert.equal(calls('getSaveAllSettings').length, 1);
    assert.ok(within(calls('getSaveAllSettings')[0], 'const retryFirstRunConfiguration = React.useCallback(async () => {', '    const firstRunConfigurationGuideVisible'));
    assert.ok(readOwnerSource(['frontend/src/settings/useFirstRunConfiguration.js'], { anchor: 'getSaveAllSettings' }).length > 0);
});
