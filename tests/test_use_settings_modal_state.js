const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Probe for the Settings modal layers (ST5 R4c): the state layer, the behaviour hook and the three effects layers.
// The file is bundled with a thin React shim (named useState recorders, plain refs, captured effects) and with the
// auth latch and the connection test stubbed. App-owned inputs are recording stubs sharing one call log.
const hookPath = path.join(__dirname, '../frontend/src/settings/useSettingsModalState.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
const behaviourSource = hookSource.slice(hookSource.indexOf('export function useSettingsModal({'), hookSource.indexOf('export function useSettingsAutoOpenEffect('));

const STATE_RETURNS = ['adminSettingsTab', 'departmentSettingsTab', 'groupManageButtonRef', 'groupManageTab', 'groupTestMessage', 'groupTesting', 'setAdminSettingsTab', 'setDepartmentSettingsTab', 'setGroupManageTab', 'setGroupTestMessage', 'setGroupTesting', 'setShowGroupDiscardConfirm', 'setShowGroupListMobile', 'setShowGroupManage', 'showGroupDiscardConfirm', 'showGroupListMobile', 'showGroupManage'];
const STATE_INITIALS = ['scope', 'teams', false, false, '', false, false, 'scope'];
const MODAL_RETURNS = ['activeDepartmentSettingsTab', 'activeSettingsModalTab', 'closeGroupManage', 'discardGroupDraftChanges', 'handleAdminSettingsTabKeyDown', 'handleDepartmentSettingsTabKeyDown', 'labelsTabEnabled', 'openBoardAdminScopeSettings', 'openBoardDepartmentSettings', 'openGroupManage', 'requestCloseGroupManage', 'selectAdminSettingsTab', 'selectDepartmentSettingsTab', 'settingsModalTabs', 'settingsSaveDisabled', 'settingsSaveHandler', 'settingsSaveLabel', 'settingsSaveTitle', 'settingsShowsSave', 'testGroupsConfigConnection'];
const inputNamesOf = (source) => {
    const start = source.indexOf('({\n') + 3;
    return source.slice(start, source.indexOf('\n}) {', start)).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
};
const MODAL_INPUTS = inputNamesOf(behaviourSource);
const sliceOf = (name) => hookSource.slice(hookSource.indexOf(`export function ${name}(`));

let bundlePromise;
function loadBundle() {
    bundlePromise = bundlePromise || esbuild.build({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], loader: { '.jsx': 'jsx' },
        plugins: [{
            name: 'stubs',
            setup(build) {
                build.onResolve({ filter: /api\/authRequired\.js$/ }, () => ({ path: 'auth-stub', namespace: 'stub' }));
                build.onResolve({ filter: /api\/configApi\.js$/ }, () => ({ path: 'config-stub', namespace: 'stub' }));
                build.onLoad({ filter: /auth-stub/, namespace: 'stub' }, () => ({ contents: 'exports.readPendingAuthenticationRequired = () => globalThis.__authLatch;', loader: 'js' }));
                build.onLoad({ filter: /config-stub/, namespace: 'stub' }, () => ({ contents: 'exports.testJiraConnection = (url) => globalThis.__testJira(url);', loader: 'js' }));
            },
        }],
    }).then((result) => result.outputFiles[0].text);
    return bundlePromise;
}

async function load({ initials } = {}) {
    const code = await loadBundle();
    const effects = [];
    const stateInitials = [];
    let stateIndex = 0;
    const shimmedReact = {
        ...React,
        useState(initial) { stateInitials.push(initial); stateIndex += 1; return [initial, () => {}]; },
        useRef(initial) { return { current: initial }; },
        useEffect(fn, deps) { effects.push({ fn, deps }); },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => (id === 'react' ? shimmedReact : require(id)));
    return { ...module.exports, effects, stateInitials, stateIndex: () => stateIndex, initials };
}

function render(hook, input) {
    let result;
    function Probe() { result = hook(input); return null; }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

const SETTERS = MODAL_INPUTS.filter((name) => /^set[A-Z]/.test(name));
function modalHarness(overrides = {}) {
    const log = [];
    const rec = (name, value) => (...args) => { log.push([name, ...args]); return value; };
    const input = {
        BACKEND_URL: 'http://backend.test',
        adminAccessAvailable: true,
        adminSettingsTab: 'mapping',
        canEditEpmConfiguration: true,
        canEditSharedConfiguration: true,
        departmentSettingsTab: 'teams',
        epmConfigBaselineRef: { current: '{"base":1}' },
        epmConfigSaving: false,
        firstRunConfigurationActive: false,
        firstRunConfigurationSession: { guideStep: 'name' },
        groupDraft: { groups: [{ id: 'g' }] },
        groupManageTab: 'teams',
        groupPreferences: { onboardingDone: true },
        groupSaving: false,
        groupsConfig: { groups: [] },
        isEpmConfigDirty: false,
        isGroupDraftDirty: false,
        openEpmSettingsTab: rec('openEpmSettingsTab'),
        performanceAdminAvailable: true,
        preferredSettingsTab: 'teams',
        saveAllSettings: async (options) => { log.push(['saveAllSettings', options]); return overrides.outcome || {}; },
        saveBlockedReason: '',
        trackSettingsAction: rec('trackSettingsAction'),
        userCanEditSettings: true,
        ...Object.fromEntries(SETTERS.map((name) => [name, rec(name)])),
        ...overrides.input,
    };
    return { input, log };
}
async function mountModal(options = {}) {
    const mod = await load();
    const harness = modalHarness(options);
    const hook = render(mod.useSettingsModal, harness.input);
    return { ...harness, hook, mod };
}

test('state layer: 0 inputs, 17 returns, nine cells with the documented defaults and a null button ref', async () => {
    const mod = await load();
    const state = render(mod.useSettingsModalState, undefined);
    assert.deepEqual(Object.keys(state).sort(), STATE_RETURNS);
    assert.deepEqual(mod.stateInitials, STATE_INITIALS.map((value) => value));
    assert.equal(state.adminSettingsTab, 'scope');
    assert.equal(state.departmentSettingsTab, 'teams');
    assert.equal(state.groupManageTab, 'scope');
    assert.equal(state.showGroupManage, false);
    assert.equal(state.groupManageButtonRef.current, null);
    assert.equal(mod.useSettingsModalState.length, 0);
    assert.equal(mod.effects.length, 0, 'the state layer registers no effect');
});

test('behaviour hook: 55 inputs, 20 returns, no effects, no ref or state of its own', async () => {
    assert.equal(MODAL_INPUTS.length, 55);
    const { hook, mod } = await mountModal();
    assert.deepEqual(Object.keys(hook).sort(), MODAL_RETURNS);
    assert.equal(mod.effects.length, 0, 'the behaviour layer registers no effect, so its call position crosses none');
    assert.equal(mod.stateIndex(), 0);
    assert.equal(/\buseEffect\(|\buseState\(|\buseRef\(/.test(behaviourSource), false);
});

test('openGroupManage defaults to the preferred tab and sets tab before visibility', async () => {
    const preferred = await mountModal({ input: { preferredSettingsTab: 'scope' } });
    preferred.hook.openGroupManage();
    assert.deepEqual(preferred.log, [['setGroupManageTab', 'scope'], ['setShowGroupManage', true]]);
    const explicit = await mountModal();
    explicit.hook.openGroupManage('epm');
    assert.deepEqual(explicit.log, [['setGroupManageTab', 'epm'], ['setShowGroupManage', true]]);
});

test('closeGroupManage resets visibility, drafts, search state, test state and the tab in the original order', async () => {
    const { hook, log } = await mountModal({ input: { preferredSettingsTab: 'scope' } });
    hook.closeGroupManage();
    assert.deepEqual(log, [
        ['setShowGroupManage', false], ['setGroupDraftError', ''], ['setSettingsSaveError', ''], ['setGroupsConfigConflict', null],
        ['setGroupImportText', ''], ['setShowGroupImport', false], ['setShowGroupAdvanced', false], ['setShowGroupDiscardConfirm', false],
        ['setShowGroupListMobile', false], ['setGroupManageTab', 'scope'],
        ['setProjectSearchQuery', ''], ['setProjectSearchOpen', false], ['setProjectSearchIndex', 0],
        ['setBoardSearchQuery', ''], ['setBoardSearchOpen', false], ['setBoardSearchIndex', 0],
        ['setComponentSearchQuery', ''], ['setComponentSearchOpen', false], ['setComponentSearchIndex', 0],
        ['setExcludedEpicSearchQuery', ''], ['setExcludedEpicSearchOpen', false], ['setExcludedEpicSearchIndex', 0],
        ['setGroupTesting', false], ['setGroupTestMessage', ''],
        ['setCapacityProjectSearchQuery', ''], ['setCapacityProjectSearchOpen', false], ['setCapacityFieldSearchQuery', ''], ['setCapacityFieldSearchOpen', false],
    ]);
});

test('requestCloseGroupManage: a save in flight blocks it, a dirty draft asks, a clean draft closes', async () => {
    const saving = await mountModal({ input: { groupSaving: true, isGroupDraftDirty: true } });
    saving.hook.requestCloseGroupManage();
    assert.deepEqual(saving.log, []);
    const dirty = await mountModal({ input: { isGroupDraftDirty: true, groupManageTab: 'scope' } });
    dirty.hook.requestCloseGroupManage();
    assert.deepEqual(dirty.log, [['trackSettingsAction', 'scope', 'cancel', { dirty_state: 'dirty' }], ['setShowGroupDiscardConfirm', true]]);
    const clean = await mountModal({ input: { groupManageTab: 'teams' } });
    clean.hook.requestCloseGroupManage();
    assert.deepEqual(clean.log.slice(0, 3), [['trackSettingsAction', 'teams', 'cancel', { dirty_state: 'clean' }], ['setShowGroupManage', false], ['setGroupDraftError', '']]);
});

test('discardGroupDraftChanges restores the private EPM baseline only when dirty, tolerates a bad baseline, then closes', async () => {
    const dirty = await mountModal({ input: { isEpmConfigDirty: true } });
    dirty.hook.discardGroupDraftChanges();
    assert.deepEqual(dirty.log.slice(0, 3), [['setEpmConfigDraft', { base: 1 }], ['setShowGroupDiscardConfirm', false], ['setShowGroupManage', false]]);
    const clean = await mountModal();
    clean.hook.discardGroupDraftChanges();
    assert.equal(clean.log.some((entry) => entry[0] === 'setEpmConfigDraft'), false);
    assert.deepEqual(clean.log.slice(0, 2), [['setShowGroupDiscardConfirm', false], ['setShowGroupManage', false]]);
    const bad = await mountModal({ input: { isEpmConfigDirty: true, epmConfigBaselineRef: { current: '{nope' } } });
    bad.hook.discardGroupDraftChanges();
    assert.equal(bad.log.some((entry) => entry[0] === 'setEpmConfigDraft'), false);
    assert.equal(bad.log.some((entry) => entry[0] === 'setShowGroupManage'), true);
    const empty = await mountModal({ input: { isEpmConfigDirty: true, epmConfigBaselineRef: { current: '' } } });
    empty.hook.discardGroupDraftChanges();
    assert.deepEqual(empty.log[0], ['setEpmConfigDraft', {}]);
});

test('labelsTabEnabled follows the draft first, then the saved groups', async () => {
    for (const [draft, saved, expected] of [[{ groups: [{}] }, [], true], [{ groups: [] }, [{}], false], [undefined, [{}], true], [undefined, [], false], [null, undefined, false]]) {
        const { hook } = await mountModal({ input: { groupDraft: draft, groupsConfig: { groups: saved } } });
        assert.equal(hook.labelsTabEnabled, expected, JSON.stringify([draft, saved]));
    }
});

test('testGroupsConfigConnection: success, HTTP failure, network failure and the always-reset testing flag', async () => {
    const ok = await mountModal({ input: { groupManageTab: 'source' } });
    globalThis.__testJira = async (url) => { ok.log.push(['testJira', url]); return { ok: true, json: async () => ({ message: 'fine' }) }; };
    await ok.hook.testGroupsConfigConnection();
    assert.deepEqual(ok.log, [
        ['setGroupTesting', true], ['setGroupTestMessage', ''], ['trackSettingsAction', 'source', 'test'], ['testJira', 'http://backend.test'],
        ['setGroupTestMessage', 'fine'], ['trackSettingsAction', 'source', 'test_result', { result: 'success' }], ['setGroupTesting', false],
    ]);
    const bare = await mountModal();
    globalThis.__testJira = async () => ({ ok: true, json: async () => ({}) });
    await bare.hook.testGroupsConfigConnection();
    assert.ok(bare.log.some((entry) => entry[0] === 'setGroupTestMessage' && entry[1] === 'Connection to Jira API looks good.'));
    const http = await mountModal();
    globalThis.__testJira = async () => ({ ok: false, status: 502, json: async () => ({ error: 'bad gateway' }) });
    await http.hook.testGroupsConfigConnection();
    assert.ok(http.log.some((entry) => entry[0] === 'setGroupTestMessage' && entry[1] === 'bad gateway'));
    assert.deepEqual(http.log.find((entry) => entry[0] === 'trackSettingsAction' && entry[2] === 'test_result').slice(1), ['teams', 'test_result', { result: 'failure' }]);
    const status = await mountModal();
    globalThis.__testJira = async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    await status.hook.testGroupsConfigConnection();
    assert.ok(status.log.some((entry) => entry[0] === 'setGroupTestMessage' && entry[1] === 'Test failed (500)'));
    const thrown = await mountModal();
    globalThis.__testJira = async () => { throw new Error('offline'); };
    await thrown.hook.testGroupsConfigConnection();
    assert.ok(thrown.log.some((entry) => entry[0] === 'setGroupTestMessage' && entry[1] === 'offline'));
    assert.deepEqual(thrown.log[thrown.log.length - 1], ['setGroupTesting', false]);
    const unnamed = await mountModal();
    globalThis.__testJira = async () => { throw {}; };
    await unnamed.hook.testGroupsConfigConnection();
    assert.ok(unnamed.log.some((entry) => entry[0] === 'setGroupTestMessage' && entry[1] === 'Connection test failed.'));
});

test('tab selection: Departments Labels is blocked without a group, both selectors set the leaf and the modal tab', async () => {
    const blocked = await mountModal({ input: { groupDraft: { groups: [] }, groupsConfig: { groups: [] } } });
    blocked.hook.selectDepartmentSettingsTab('labels');
    assert.deepEqual(blocked.log, []);
    blocked.hook.selectDepartmentSettingsTab('boards');
    assert.deepEqual(blocked.log, [['setDepartmentSettingsTab', 'boards'], ['setGroupManageTab', 'boards']]);
    const allowed = await mountModal();
    allowed.hook.selectDepartmentSettingsTab('labels');
    assert.deepEqual(allowed.log, [['setDepartmentSettingsTab', 'labels'], ['setGroupManageTab', 'labels']]);
    allowed.log.length = 0;
    allowed.hook.selectAdminSettingsTab('capacity');
    assert.deepEqual(allowed.log, [['setAdminSettingsTab', 'capacity'], ['setGroupManageTab', 'capacity']]);
});

test('sub-tab keyboard navigation wraps, Home/End jump, and the tab lists follow the labels, access and performance gates', async () => {
    const frames = [];
    const focused = [];
    globalThis.window = { requestAnimationFrame: (fn) => { frames.push(fn); fn(); } };
    globalThis.document = { getElementById: (id) => ({ focus: () => focused.push(id) }) };
    const press = (handler, key) => { const event = { key, prevented: 0, preventDefault() { this.prevented += 1; } }; handler(event); return event; };
    const department = await mountModal({ input: { departmentSettingsTab: 'boards' } });
    const wrapped = press(department.hook.handleDepartmentSettingsTabKeyDown, 'ArrowRight');
    assert.equal(wrapped.prevented, 1);
    assert.deepEqual(department.log, [['setDepartmentSettingsTab', 'teams'], ['setGroupManageTab', 'teams']]);
    assert.deepEqual(focused, ['department-settings-teams-tab']);
    department.log.length = 0;
    press(department.hook.handleDepartmentSettingsTabKeyDown, 'ArrowLeft');
    assert.deepEqual(department.log[0], ['setDepartmentSettingsTab', 'labels']);
    department.log.length = 0;
    press(department.hook.handleDepartmentSettingsTabKeyDown, 'End');
    assert.deepEqual(department.log[0], ['setDepartmentSettingsTab', 'boards']);
    press(department.hook.handleDepartmentSettingsTabKeyDown, 'Home');
    assert.deepEqual(department.log[2], ['setDepartmentSettingsTab', 'teams']);
    const ignored = press(department.hook.handleDepartmentSettingsTabKeyDown, 'a');
    assert.equal(ignored.prevented, 0);
    const noLabels = await mountModal({ input: { departmentSettingsTab: 'boards', groupDraft: { groups: [] }, groupsConfig: { groups: [] } } });
    press(noLabels.hook.handleDepartmentSettingsTabKeyDown, 'ArrowLeft');
    assert.deepEqual(noLabels.log[0], ['setDepartmentSettingsTab', 'teams'], 'without a group the strip is teams/boards only');
    const admin = await mountModal({ input: { adminSettingsTab: 'priorityWeights' } });
    press(admin.hook.handleAdminSettingsTabKeyDown, 'ArrowRight');
    assert.deepEqual(admin.log[0], ['setAdminSettingsTab', 'access']);
    const noAccess = await mountModal({ input: { adminSettingsTab: 'priorityWeights', adminAccessAvailable: false } });
    press(noAccess.hook.handleAdminSettingsTabKeyDown, 'ArrowRight');
    assert.deepEqual(noAccess.log[0], ['setAdminSettingsTab', 'performance']);
    const bare = await mountModal({ input: { adminSettingsTab: 'priorityWeights', adminAccessAvailable: false, performanceAdminAvailable: false } });
    press(bare.hook.handleAdminSettingsTabKeyDown, 'ArrowRight');
    assert.deepEqual(bare.log[0], ['setAdminSettingsTab', 'scope'], 'the strip wraps over the five core tabs');
    const unknownCurrent = await mountModal({ input: { adminSettingsTab: 'nope' } });
    press(unknownCurrent.hook.handleAdminSettingsTabKeyDown, 'ArrowLeft');
    assert.deepEqual(unknownCurrent.log[0], ['setAdminSettingsTab', 'performance'], 'an unknown current tab is treated as the first');
    delete globalThis.window; delete globalThis.document;
});

test('derived tab values: grouped active tab, Labels fallback, permission-filtered descriptors and their click handlers', async () => {
    for (const [tab, expected] of [['scope', 'admin'], ['access', 'admin'], ['performance', 'admin'], ['teams', 'departments'], ['labels', 'departments'], ['boards', 'departments'], ['connections', 'connections'], ['epm', 'epm']]) {
        const { hook } = await mountModal({ input: { groupManageTab: tab } });
        assert.equal(hook.activeSettingsModalTab, expected, tab);
    }
    const fallback = await mountModal({ input: { departmentSettingsTab: 'labels', groupDraft: { groups: [] }, groupsConfig: { groups: [] } } });
    assert.equal(fallback.hook.activeDepartmentSettingsTab, 'teams');
    const present = await mountModal({ input: { departmentSettingsTab: 'labels' } });
    assert.equal(present.hook.activeDepartmentSettingsTab, 'labels');
    const full = await mountModal();
    assert.deepEqual(full.hook.settingsModalTabs.map((tab) => [tab.id, tab.label]), [['admin', 'Admin'], ['departments', 'Departments'], ['connections', 'Connections'], ['epm', 'EPM']]);
    const restricted = await mountModal({ input: { canEditSharedConfiguration: false, canEditEpmConfiguration: false } });
    assert.deepEqual(restricted.hook.settingsModalTabs.map((tab) => tab.id), ['departments', 'connections']);
    const onlyEpm = await mountModal({ input: { canEditSharedConfiguration: false } });
    assert.deepEqual(onlyEpm.hook.settingsModalTabs.map((tab) => tab.id), ['departments', 'connections', 'epm']);
    const byId = Object.fromEntries(full.hook.settingsModalTabs.map((tab) => [tab.id, tab]));
    byId.admin.onClick();
    byId.departments.onClick();
    byId.connections.onClick();
    assert.deepEqual(full.log, [
        ['trackSettingsAction', 'admin', 'tab_change'], ['setGroupManageTab', 'mapping'],
        ['trackSettingsAction', 'departments', 'tab_change'], ['setGroupManageTab', 'teams'],
        ['trackSettingsAction', 'connections', 'open'], ['setShowGroupManage', true], ['setGroupManageTab', 'connections'],
    ]);
    assert.equal(byId.epm.onClick, full.input.openEpmSettingsTab, 'the EPM tab uses the EPM hook handler itself');
});

test('footer Save: handler clears the error, passes the first-run session only while active, surfaces the outcome error; label/title/disabled table', async () => {
    const plain = await mountModal({ outcome: { error: 'nope' } });
    plain.hook.settingsSaveHandler();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(plain.log, [['setSettingsSaveError', ''], ['saveAllSettings', { firstRunSession: null }], ['setSettingsSaveError', 'nope']]);
    const session = { guideStep: 'teams', pendingGroupId: 'g' };
    const firstRun = await mountModal({ outcome: { ok: true }, input: { firstRunConfigurationActive: true, firstRunConfigurationSession: session } });
    firstRun.hook.settingsSaveHandler();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(firstRun.log, [['setSettingsSaveError', ''], ['saveAllSettings', { firstRunSession: session }]]);
    for (const [input, expected] of [
        [{}, { disabled: false, title: '', label: 'Save', shows: true }],
        [{ saveBlockedReason: 'No changes to save' }, { disabled: true, title: 'No changes to save', label: 'Save', shows: true }],
        [{ groupSaving: true }, { disabled: false, title: '', label: 'Saving...', shows: true }],
        [{ epmConfigSaving: true }, { disabled: false, title: '', label: 'Saving...', shows: true }],
        [{ firstRunConfigurationActive: true, groupPreferences: { onboardingDone: false } }, { disabled: false, title: '', label: 'Save and continue', shows: true }],
        [{ firstRunConfigurationActive: true, groupPreferences: { onboardingDone: true } }, { disabled: false, title: '', label: 'Save', shows: true }],
        [{ firstRunConfigurationActive: false, groupPreferences: { onboardingDone: false } }, { disabled: false, title: '', label: 'Save', shows: true }],
        [{ groupManageTab: 'connections' }, { disabled: false, title: '', label: 'Save', shows: false }],
    ]) {
        const { hook } = await mountModal({ input });
        assert.deepEqual({ disabled: hook.settingsSaveDisabled, title: hook.settingsSaveTitle, label: hook.settingsSaveLabel, shows: hook.settingsShowsSave }, expected, JSON.stringify(input));
    }
});

test('Board call-to-actions: Department tabs open for anyone, the Admin scope tab only for an explicit editor', async () => {
    const dept = await mountModal();
    dept.hook.openBoardDepartmentSettings('boards');
    assert.deepEqual(dept.log, [['trackSettingsAction', 'boards', 'open', { source_surface: 'board' }], ['setShowGroupManage', true], ['setDepartmentSettingsTab', 'boards'], ['setGroupManageTab', 'boards']]);
    const admin = await mountModal();
    admin.hook.openBoardAdminScopeSettings();
    assert.deepEqual(admin.log, [['trackSettingsAction', 'scope', 'open', { source_surface: 'board' }], ['setShowGroupManage', true], ['setAdminSettingsTab', 'scope'], ['setGroupManageTab', 'scope']]);
    for (const grant of [false, undefined, null, 'true', 1]) {
        const denied = await mountModal({ input: { userCanEditSettings: grant } });
        denied.hook.openBoardAdminScopeSettings();
        assert.deepEqual(denied.log, [], `grant ${String(grant)} must not open Admin scope`);
    }
});

test('auto-open effect: dependency array, loading gate, once-only latch, and only for an auto-created configuration', async () => {
    const mod = await load();
    const calls = [];
    render(mod.useSettingsAutoOpenEffect, { groupConfigSource: 'auto', groupsLoading: false, setShowGroupManage: (value) => calls.push(value) });
    assert.equal(mod.effects.length, 1);
    assert.deepEqual(mod.effects[0].deps, [false, 'auto']);
    mod.effects[0].fn();
    mod.effects[0].fn();
    assert.deepEqual(calls, [true], 'the latch opens the modal once');
    for (const [loading, source] of [[true, 'auto'], [false, 'jsonfile'], [false, 'workspace_db'], [false, undefined]]) {
        const other = await load();
        const seen = [];
        render(other.useSettingsAutoOpenEffect, { groupConfigSource: source, groupsLoading: loading, setShowGroupManage: (value) => seen.push(value) });
        other.effects[0].fn();
        assert.deepEqual(seen, [], `${loading}/${source}`);
    }
});

function fakeWindow() {
    const listeners = [];
    const removed = [];
    globalThis.window = { addEventListener: (type, fn) => listeners.push([type, fn]), removeEventListener: (type, fn) => removed.push([type, fn]) };
    const guideTarget = { focus: () => guideTarget.focused.push('focus'), focused: [] };
    globalThis.document = { querySelector: (selector) => { guideTarget.selector = selector; return guideTarget; } };
    return { listeners, removed, guideTarget };
}
async function hotkey(inputOverrides = {}) {
    const mod = await load();
    const log = [];
    const input = {
        closeAllTeamSearchDropdowns: () => log.push('closeAllTeamSearchDropdowns'),
        epmConfigSaving: false,
        firstRunConfigurationActive: false,
        firstRunConfigurationSession: { guideStep: 'teams' },
        groupManageTab: 'teams',
        groupSaving: false,
        requestCloseGroupManage: () => log.push('requestCloseGroupManage'),
        saveAllSettings: async (options) => { log.push(['saveAllSettings', options]); },
        setShowGroupDiscardConfirm: (value) => log.push(['setShowGroupDiscardConfirm', value]),
        showGroupDiscardConfirm: false,
        showGroupManage: true,
        teamSearchOpen: {},
        ...inputOverrides,
    };
    render(mod.useSettingsHotkeyEffect, input);
    const env = fakeWindow();
    globalThis.__authLatch = null;
    const cleanup = mod.effects[0].fn();
    const press = (event) => { const full = { prevented: 0, preventDefault() { this.prevented += 1; }, ...event }; env.listeners[0][1](full); return full; };
    return { mod, log, env, cleanup, press, input };
}

test('hotkey layer: dependency array, no listener while closed, cleanup removes the registered handler', async () => {
    const open = await hotkey();
    assert.deepEqual(open.mod.effects[0].deps, [true, 'teams', false, false, false, { guideStep: 'teams' }, {}, false, open.input.requestCloseGroupManage, open.input.saveAllSettings].map((value, index) => (index === 5 ? open.input.firstRunConfigurationSession : index === 6 ? open.input.teamSearchOpen : value)));
    assert.equal(open.env.listeners.length, 1);
    assert.equal(open.env.listeners[0][0], 'keydown');
    open.cleanup();
    assert.deepEqual(open.env.removed, [['keydown', open.env.listeners[0][1]]]);
    const closed = await hotkey({ showGroupManage: false });
    assert.equal(closed.env.listeners.length, 0);
    assert.equal(closed.cleanup, undefined);
});

test('hotkey layer: Cmd/Ctrl+S saves unless on Connections or already saving, always prevents default, carries the first-run session', async () => {
    for (const modifier of ['metaKey', 'ctrlKey']) {
        const { press, log } = await hotkey();
        const event = press({ key: 'S', [modifier]: true });
        assert.equal(event.prevented, 1);
        assert.deepEqual(log, [['saveAllSettings', { firstRunSession: null }]]);
    }
    const connections = await hotkey({ groupManageTab: 'connections' });
    assert.equal(connections.press({ key: 's', metaKey: true }).prevented, 1);
    assert.deepEqual(connections.log, []);
    for (const busy of [{ groupSaving: true }, { epmConfigSaving: true }]) {
        const blocked = await hotkey(busy);
        blocked.press({ key: 's', ctrlKey: true });
        assert.deepEqual(blocked.log, []);
    }
    const session = { guideStep: 'name', pendingGroupId: 'g' };
    const firstRun = await hotkey({ firstRunConfigurationActive: true, firstRunConfigurationSession: session });
    firstRun.press({ key: 's', ctrlKey: true });
    assert.deepEqual(firstRun.log, [['saveAllSettings', { firstRunSession: session }]]);
    const plain = await hotkey();
    assert.equal(plain.press({ key: 's' }).prevented, 0, 's without a modifier is ignored');
    assert.deepEqual(plain.log, []);
});

test('hotkey layer: Escape order is first-run guide focus, open dropdowns, discard confirmation, then close; the auth latch silences everything', async () => {
    const firstRun = await hotkey({ firstRunConfigurationActive: true, firstRunConfigurationSession: { guideStep: 'favorite' }, teamSearchOpen: { g: true }, showGroupDiscardConfirm: true });
    assert.equal(firstRun.press({ key: 'Escape' }).prevented, 1);
    assert.equal(firstRun.env.guideTarget.selector, '[data-first-run-guide-target="favorite"]');
    assert.deepEqual(firstRun.env.guideTarget.focused, ['focus']);
    assert.deepEqual(firstRun.log, []);
    const dropdown = await hotkey({ teamSearchOpen: { a: false, b: true }, showGroupDiscardConfirm: true });
    assert.equal(dropdown.press({ key: 'Escape' }).prevented, 1);
    assert.deepEqual(dropdown.log, ['closeAllTeamSearchDropdowns']);
    const discard = await hotkey({ showGroupDiscardConfirm: true });
    discard.press({ key: 'Escape' });
    assert.deepEqual(discard.log, [['setShowGroupDiscardConfirm', false]]);
    const close = await hotkey();
    assert.equal(close.press({ key: 'Escape' }).prevented, 1);
    assert.deepEqual(close.log, ['requestCloseGroupManage']);
    const nullDropdowns = await hotkey({ teamSearchOpen: null });
    nullDropdowns.press({ key: 'Escape' });
    assert.deepEqual(nullDropdowns.log, ['requestCloseGroupManage']);
    const latched = await hotkey();
    globalThis.__authLatch = { locked: true };
    assert.equal(latched.press({ key: 'Escape' }).prevented, 0);
    assert.equal(latched.press({ key: 's', metaKey: true }).prevented, 0);
    assert.deepEqual(latched.log, []);
    globalThis.__authLatch = null;
    const other = await hotkey();
    assert.equal(other.press({ key: 'Enter' }).prevented, 0);
});

test('tab guard layer: redirects an ungranted EPM or shared tab to Teams, leaves granted ones, and mirrors the leaf into its sub-tab state', async () => {
    const run = async (inputs, effectIndex = 0) => {
        const mod = await load();
        const calls = [];
        render(mod.useSettingsTabGuardEffects, {
            canEditEpmConfiguration: true, canEditSharedConfiguration: true, groupManageTab: 'teams', showGroupManage: true,
            setAdminSettingsTab: (value) => calls.push(['admin', value]), setDepartmentSettingsTab: (value) => calls.push(['department', value]), setGroupManageTab: (value) => calls.push(['tab', value]),
            ...inputs,
        });
        assert.equal(mod.effects.length, 2);
        mod.effects[effectIndex].fn();
        return { calls, mod };
    };
    assert.deepEqual((await run({ groupManageTab: 'epm', canEditEpmConfiguration: false })).calls, [['tab', 'teams']]);
    assert.deepEqual((await run({ groupManageTab: 'epm', canEditEpmConfiguration: true, canEditSharedConfiguration: false })).calls, []);
    for (const tab of ['scope', 'source', 'mapping', 'capacity', 'priorityWeights', 'access', 'performance']) {
        assert.deepEqual((await run({ groupManageTab: tab, canEditSharedConfiguration: false })).calls, [['tab', 'teams']], tab);
        assert.deepEqual((await run({ groupManageTab: tab, canEditSharedConfiguration: true })).calls, [], tab);
    }
    assert.deepEqual((await run({ groupManageTab: 'teams', canEditSharedConfiguration: false })).calls, []);
    assert.deepEqual((await run({ groupManageTab: 'epm', canEditEpmConfiguration: false, showGroupManage: false })).calls, [], 'a closed modal is never redirected');
    const mod = (await run({})).mod;
    assert.deepEqual(mod.effects[0].deps, [true, true, true, 'teams']);
    assert.deepEqual(mod.effects[1].deps, ['teams']);
    assert.deepEqual((await run({ groupManageTab: 'mapping' }, 1)).calls, [['admin', 'mapping']]);
    assert.deepEqual((await run({ groupManageTab: 'boards' }, 1)).calls, [['department', 'boards']]);
    assert.deepEqual((await run({ groupManageTab: 'connections' }, 1)).calls, []);
    assert.deepEqual((await run({ groupManageTab: 'epm' }, 1)).calls, []);
});

test('effects layers own all four moved effects: nothing but the three layers registers them', () => {
    assert.equal((hookSource.match(/\buseEffect\(/g) || []).length, 4);
    for (const name of ['useSettingsAutoOpenEffect', 'useSettingsHotkeyEffect', 'useSettingsTabGuardEffects']) assert.ok(sliceOf(name).length > 0, name);
    assert.equal(/\buseEffect\(/.test(hookSource.slice(0, hookSource.indexOf('export function useSettingsAutoOpenEffect('))), false, 'no effect in the state or behaviour layers');
    assert.equal(dashboardSource.includes('data-first-run-guide-target='), false, 'the hotkey effect (its only reader of the guide target) left the dashboard');
    assert.equal(dashboardSource.includes("key.toLowerCase() === 's'"), false, 'the Cmd/Ctrl+S handler left the dashboard');
});
