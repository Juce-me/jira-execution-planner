const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Probe for useSettingsPermissions (ST5 R4a). The hook is bundled with a thin React shim that seeds each useState
// from an override table and records every setter call, and with useAdminAccessSettings stubbed so the call
// arguments are observable. Nothing here needs jsdom: the appliers are plain functions over recorded setters.
const hookPath = path.join(__dirname, '../frontend/src/settings/useSettingsPermissions.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');

// Order of the hook's useState cells; the shim names its recorder by this table.
const CELLS = ['settingsAdminOnly', 'userCanEditSettings', 'performanceAdminAvailable', 'userCanEditEpmConfig', 'adminUserManagementAvailable', 'userIsToolAdmin', 'environmentConfigExists'];
const DEFAULTS = { settingsAdminOnly: true, userCanEditSettings: false, performanceAdminAvailable: false, userCanEditEpmConfig: false, adminUserManagementAvailable: false, userIsToolAdmin: false, environmentConfigExists: false };
const RETURN_NAMES = ['adminAccess', 'adminAccessAvailable', 'adminUserManagementAvailable', 'applyBootstrapPermissions', 'applySavePermissions', 'canEditEpmConfiguration', 'canEditSharedConfiguration', 'performanceAdminAvailable', 'preferredSettingsTab', 'setPerformanceAdminAvailable', 'userCanEditSettings'];

let bundlePromise;
function loadBundle() {
    bundlePromise = bundlePromise || esbuild.build({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], loader: { '.jsx': 'jsx' },
        plugins: [{
            name: 'stub-admin-access',
            setup(build) {
                build.onResolve({ filter: /AdminAccessSettings\.jsx$/ }, () => ({ path: 'admin-access-stub', namespace: 'stub' }));
                build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'exports.useAdminAccessSettings = (args) => globalThis.__adminAccessCalls.push(args) && { stub: true };', loader: 'js' }));
            },
        }],
    }).then((result) => result.outputFiles[0].text);
    return bundlePromise;
}

async function instantiate(overrides = {}) {
    const code = await loadBundle();
    const writes = [];
    let index = 0;
    const shimmedReact = {
        ...React,
        useState(initial) {
            const name = CELLS[index++];
            const value = Object.hasOwn(overrides, name) ? overrides[name] : initial;
            return [value, (next) => { writes.push([name, next]); }];
        },
    };
    globalThis.__adminAccessCalls = [];
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => (id === 'react' ? shimmedReact : require(id)));
    const adminAccessCalls = globalThis.__adminAccessCalls;
    return { hook: module.exports.useSettingsPermissions, writes, adminAccessCalls };
}

function render(hook, input) {
    let result;
    function Probe() { result = hook(input); return null; }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

const baseInput = { BACKEND_URL: 'http://backend.test', groupManageTab: 'scope', showGroupManage: false };

test('defaults are fail-closed: no editing, no EPM editing, metadata on, no admin access, Team Groups opens', async () => {
    const { hook, writes } = await instantiate();
    const result = render(hook, baseInput);
    assert.deepEqual(Object.keys(result).sort(), RETURN_NAMES);
    assert.equal(result.userCanEditSettings, false);
    assert.equal(result.canEditSharedConfiguration, false);
    assert.equal(result.canEditEpmConfiguration, false);
    assert.equal(result.performanceAdminAvailable, false);
    assert.equal(result.adminUserManagementAvailable, false);
    assert.equal(result.preferredSettingsTab, 'teams');
    assert.deepEqual(writes, []);
    // The write-only metadata cell keeps its documented default; it is never returned.
    assert.equal(DEFAULTS.settingsAdminOnly, true);
    assert.equal(Object.hasOwn(result, 'settingsAdminOnly'), false);
});

// Grant matrix: only the boolean true reaches the editing flags; settingsAdminOnly never changes the outcome.
const GRANTS = [
    ['true', true, true],
    ["'true'", 'true', false],
    ['1', 1, false],
    ['undefined', undefined, false],
    ['null', null, false],
    ['false', false, false],
];
for (const applier of ['applyBootstrapPermissions', 'applySavePermissions']) {
    for (const [label, grant, expected] of GRANTS) {
        for (const adminOnly of [undefined, false, true]) {
            test(`${applier}: userCanEditSettings=${label}, settingsAdminOnly=${adminOnly} sets the edit cell to ${expected}`, async () => {
                const { hook, writes } = await instantiate();
                const result = render(hook, baseInput);
                result[applier]({ userCanEditSettings: grant, settingsAdminOnly: adminOnly, userCanEditEpmConfig: grant });
                const edit = writes.find(([name]) => name === 'userCanEditSettings');
                const epm = writes.find(([name]) => name === 'userCanEditEpmConfig');
                assert.equal(edit[1], expected);
                assert.equal(epm[1], expected);
                // settingsAdminOnly is written as plain metadata (Boolean-coerced) and has no effect on the edit cell.
                assert.equal(writes.find(([name]) => name === 'settingsAdminOnly')[1], Boolean(adminOnly));
            });
        }
    }
    test(`${applier}: a missing key writes false, never true`, async () => {
        const { hook, writes } = await instantiate();
        render(hook, baseInput)[applier]({});
        for (const name of ['userCanEditSettings', 'userCanEditEpmConfig', 'adminUserManagementAvailable', 'environmentConfigExists']) {
            assert.equal(writes.find(([cell]) => cell === name)[1], false, name);
        }
        assert.equal(writes.find(([cell]) => cell === 'settingsAdminOnly')[1], false);
    });
}

test('edit flags derive from the explicit true only (state seeded with every grant shape)', async () => {
    for (const [label, grant, expected] of GRANTS) {
        const { hook } = await instantiate({ userCanEditSettings: grant, userCanEditEpmConfig: grant });
        const result = render(hook, baseInput);
        assert.equal(result.canEditSharedConfiguration, expected, `shared ${label}`);
        assert.equal(result.canEditEpmConfiguration, expected, `epm ${label}`);
    }
    // Neither flag implies the other (administrator editing never grants private EPM editing).
    const shared = render((await instantiate({ userCanEditSettings: true })).hook, baseInput);
    assert.equal(shared.canEditSharedConfiguration, true);
    assert.equal(shared.canEditEpmConfiguration, false);
    const epm = render((await instantiate({ userCanEditEpmConfig: true })).hook, baseInput);
    assert.equal(epm.canEditSharedConfiguration, false);
    assert.equal(epm.canEditEpmConfiguration, true);
    // settingsAdminOnly=false alone (the pre-fix grant path) grants nothing.
    const metadataOnly = render((await instantiate({ settingsAdminOnly: false })).hook, baseInput);
    assert.equal(metadataOnly.canEditSharedConfiguration, false);
});

test('bootstrap writes the six cells in order with exact coercions; the save refresh omits the tool-admin write', async () => {
    const config = { settingsAdminOnly: 0, userCanEditSettings: true, userCanEditEpmConfig: true, adminUserManagementAvailable: true, userIsToolAdmin: true, environmentConfigExists: 0, projectsConfigured: 1 };
    const boot = await instantiate();
    render(boot.hook, baseInput).applyBootstrapPermissions(config);
    assert.deepEqual(boot.writes, [
        ['settingsAdminOnly', false], ['userCanEditSettings', true], ['userCanEditEpmConfig', true],
        ['adminUserManagementAvailable', true], ['userIsToolAdmin', true], ['environmentConfigExists', true],
    ]);
    const save = await instantiate();
    render(save.hook, baseInput).applySavePermissions(config);
    assert.deepEqual(save.writes, [
        ['settingsAdminOnly', false], ['userCanEditSettings', true], ['userCanEditEpmConfig', true],
        ['adminUserManagementAvailable', true], ['environmentConfigExists', true],
    ]);
    // 'true' strings and 1 never become booleans for the availability and tool-admin cells.
    const strict = await instantiate();
    render(strict.hook, baseInput).applyBootstrapPermissions({ adminUserManagementAvailable: 'true', userIsToolAdmin: 1 });
    assert.equal(strict.writes.find(([name]) => name === 'adminUserManagementAvailable')[1], false);
    assert.equal(strict.writes.find(([name]) => name === 'userIsToolAdmin')[1], false);
    // environmentConfigExists keeps the legacy projectsConfigured fallback.
    const legacy = await instantiate();
    render(legacy.hook, baseInput).applySavePermissions({ projectsConfigured: true });
    assert.equal(legacy.writes.find(([name]) => name === 'environmentConfigExists')[1], true);
});

test('adminAccessAvailable truth table and the access-hook arguments', async () => {
    const table = [
        [false, false, true, false],  // directory unavailable: Access tab shows (informational card)
        [false, true, true, false],
        [true, false, false, false],  // DB user directory: tool admins only
        [true, true, true, true],
    ];
    for (const [management, toolAdmin, available, loadable] of table) {
        const { hook, adminAccessCalls } = await instantiate({ adminUserManagementAvailable: management, userIsToolAdmin: toolAdmin });
        const result = render(hook, { BACKEND_URL: 'http://backend.test', groupManageTab: 'access', showGroupManage: true });
        assert.equal(result.adminAccessAvailable, available, `available ${management}/${toolAdmin}`);
        assert.equal(adminAccessCalls.length, 1);
        assert.deepEqual(adminAccessCalls[0], { backendUrl: 'http://backend.test', available: loadable, active: true });
        assert.deepEqual(result.adminAccess, { stub: true });
    }
    const closed = await instantiate({ adminUserManagementAvailable: true, userIsToolAdmin: true });
    render(closed.hook, { BACKEND_URL: 'x', groupManageTab: 'access', showGroupManage: false });
    assert.equal(closed.adminAccessCalls[0].active, false);
    const otherTab = await instantiate({ adminUserManagementAvailable: true, userIsToolAdmin: true });
    render(otherTab.hook, { BACKEND_URL: 'x', groupManageTab: 'scope', showGroupManage: true });
    assert.equal(otherTab.adminAccessCalls[0].active, false);
});

test('preferredSettingsTab opens Admin scope only for an editor in an unconfigured environment', async () => {
    for (const [edit, configured, expected] of [[true, false, 'scope'], [true, true, 'teams'], [false, false, 'teams'], ['true', false, 'teams']]) {
        const { hook } = await instantiate({ userCanEditSettings: edit, environmentConfigExists: configured });
        assert.equal(render(hook, baseInput).preferredSettingsTab, expected, `${edit}/${configured}`);
    }
});

test('the performance flag setter is returned for the loadConfig site that stays in the dashboard', async () => {
    const { hook, writes } = await instantiate();
    const result = render(hook, baseInput);
    result.setPerformanceAdminAvailable(true);
    assert.deepEqual(writes, [['performanceAdminAvailable', true]]);
    for (const applier of [result.applyBootstrapPermissions, result.applySavePermissions]) {
        const probe = await instantiate();
        render(probe.hook, baseInput);
        applier({});
        assert.equal(probe.writes.some(([name]) => name === 'performanceAdminAvailable'), false, 'appliers never write the performance flag');
    }
    assert.equal(/setPerformanceAdminAvailable\(config\.performanceAdminAvailable === true\);/.test(dashboardSource), true, 'the write before completeAuthRecovery stays in loadConfig');
});

test('call sites: the dashboard routes both config writers through the hook and keeps no permission cell of its own', () => {
    assert.ok(dashboardSource.includes('} = useSettingsPermissions({'));
    assert.ok(dashboardSource.includes('applyBootstrapPermissions(config);'));
    // The post-save refresh lives in the shared-config save hook once that hook exists (R4b); before that it is in the dashboard.
    const saveHookPath = path.join(__dirname, '../frontend/src/settings/useSharedConfigSave.js');
    const refreshOwner = fs.existsSync(saveHookPath) ? fs.readFileSync(saveHookPath, 'utf8') : dashboardSource;
    assert.ok(refreshOwner.includes('applySavePermissions(cfg);'));
    assert.equal(fs.existsSync(saveHookPath) && dashboardSource.includes('applySavePermissions(cfg);'), false, 'the post-save refresh moved with the save hook');
    for (const forbidden of ['setUserCanEditSettings', 'setUserCanEditEpmConfig', 'setAdminUserManagementAvailable', 'setUserIsToolAdmin', 'setEnvironmentConfigExists', 'setSettingsAdminOnly', 'useAdminAccessSettings(']) {
        assert.equal(dashboardSource.includes(forbidden), false, `${forbidden} must live in the hook`);
    }
    // Keep useAdminSettingsGate's openSettings an arrow: passing openGroupManage directly is a TDZ at first render.
    assert.ok(dashboardSource.includes('openSettings: tab => openGroupManage(tab)'));
    assert.equal(/openSettings: openGroupManage\b/.test(dashboardSource), false);
    // Both writers call the gate after the permission write, and the hook runs before the gate hook.
    assert.ok(dashboardSource.indexOf('} = useSettingsPermissions({') < dashboardSource.indexOf('= useAdminSettingsGate({'));
    // The hook is the only owner of the write-only metadata cell and never returns it.
    assert.ok(hookSource.includes('const [, setSettingsAdminOnly] = useState(true);'));
    assert.equal(/\n\s+settingsAdminOnly,/.test(hookSource.slice(hookSource.indexOf('return {'))), false);
});
