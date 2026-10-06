const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-render probe for SettingsModalContainer (ST5 R4c). SettingsModal is replaced by a recorder so each prop it
// receives is observable; the container itself is the real component. Conflict-message helpers are real.
const containerPath = path.join(__dirname, '../frontend/src/settings/SettingsModalContainer.jsx');
const containerSource = fs.readFileSync(containerPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');

const PROP_NAMES = ['activeSettingsModalTab', 'canEditEpmConfiguration', 'cancelFirstRunConfiguration', 'discardGroupDraftChanges', 'discardMineOnGroupsConfigConflict', 'firstRunConfigurationActive', 'firstRunHasCommittedSection', 'groupConfigValidationErrors', 'groupDraftError', 'groupManageTab', 'groupTestMessage', 'groupTesting', 'groupsConfigConflict', 'isEpmConfigDirty', 'isGroupBoardDraftDirty', 'isGroupDraftDirty', 'isGroupVisibilityDraftDirty', 'keepMineOnGroupsConfigConflict', 'keepMineOnWorkspaceConfigConflict', 'requestCloseGroupManage', 'setShowGroupDiscardConfirm', 'settingsHeaderAction', 'settingsModalTabs', 'settingsSaveDisabled', 'settingsSaveError', 'settingsSaveHandler', 'settingsSaveLabel', 'settingsSaveTitle', 'settingsShowsSave', 'showGroupDiscardConfirm', 'testGroupsConfigConnection', 'unsavedSectionsCount', 'useLatestWorkspaceConfig', 'workspaceConfigConflict'];

let bundlePromise;
function loadBundle() {
    bundlePromise = bundlePromise || esbuild.build({
        entryPoints: [containerPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], loader: { '.jsx': 'jsx' },
        plugins: [{
            name: 'stub-settings-modal',
            setup(build) {
                build.onResolve({ filter: /SettingsModal\.jsx$/ }, () => ({ path: 'settings-modal-stub', namespace: 'stub' }));
                build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    contents: "import * as React from 'react'; export default function SettingsModal(props) { globalThis.__modalProps = props; return React.createElement('div', { 'data-stub': 'modal' }, props.children); }",
                    loader: 'js',
                }));
            },
        }],
    }).then((result) => result.outputFiles[0].text);
    return bundlePromise;
}
async function component() {
    const module = { exports: {} };
    new Function('module', 'exports', 'require', await loadBundle())(module, module.exports, require);
    return module.exports.default;
}

const noop = () => {};
const baseProps = () => ({
    activeSettingsModalTab: 'departments', canEditEpmConfiguration: true, cancelFirstRunConfiguration: function cancelFirstRun() {}, discardGroupDraftChanges: function discard() {},
    discardMineOnGroupsConfigConflict: function discardMine() {}, firstRunConfigurationActive: false, firstRunHasCommittedSection: false, groupConfigValidationErrors: [],
    groupDraftError: '', groupManageTab: 'teams', groupTestMessage: '', groupTesting: false, groupsConfigConflict: null, isEpmConfigDirty: false, isGroupBoardDraftDirty: false,
    isGroupDraftDirty: true, isGroupVisibilityDraftDirty: false, keepMineOnGroupsConfigConflict: function keepMineGroups() {}, keepMineOnWorkspaceConfigConflict: function keepMineWorkspace() {},
    requestCloseGroupManage: function requestClose() {}, setShowGroupDiscardConfirm: noop, settingsHeaderAction: 'HEADER', settingsModalTabs: [{ id: 'departments' }], settingsSaveDisabled: false,
    settingsSaveError: '', settingsSaveHandler: function save() {}, settingsSaveLabel: 'Save', settingsSaveTitle: '', settingsShowsSave: true, showGroupDiscardConfirm: false,
    testGroupsConfigConnection: function testConnection() {}, unsavedSectionsCount: 2, useLatestWorkspaceConfig: function useLatest() {}, workspaceConfigConflict: null,
});
async function modalProps(overrides = {}, children = 'child') {
    const Container = await component();
    globalThis.__modalProps = undefined;
    const html = renderToStaticMarkup(React.createElement(Container, { ...baseProps(), ...overrides }, children));
    return { props: globalThis.__modalProps, html };
}

test('interface: stateless, first parameter destructured with the 34 explicit props plus children', () => {
    const start = containerSource.indexOf('({\n') + 3;
    const names = containerSource.slice(start, containerSource.indexOf('\n}) {', start)).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
    assert.deepEqual(names.filter((name) => name !== 'children').sort(), PROP_NAMES);
    assert.equal(names[names.length - 1], 'children');
    assert.equal(/useState\(|useEffect\(|useRef\(|useMemo\(|useCallback\(|useReducer\(/.test(containerSource), false, 'the container is stateless');
    assert.equal(/props\./.test(containerSource), false);
});

test('DOM parity: the container adds no wrapper element and forwards children unchanged', async () => {
    const { html } = await modalProps({}, 'child');
    assert.equal(html, '<div data-stub="modal">child</div>');
    const { html: nested } = await modalProps({}, [React.createElement('i', { key: 'a' }, 'one'), React.createElement('b', { key: 'b' }, 'two')]);
    assert.equal(nested, '<div data-stub="modal"><i>one</i><b>two</b></div>');
});

test('passthrough props map one to one', async () => {
    const input = baseProps();
    const { props } = await modalProps();
    assert.equal(props.headerAction, 'HEADER');
    assert.equal(props.activeTab, input.activeSettingsModalTab);
    assert.deepEqual(props.tabs, input.settingsModalTabs);
    assert.equal(props.onTestConfiguration.name, 'testConnection');
    assert.equal(props.onSave.name, 'save');
    assert.equal(props.onDiscard.name, 'discard');
    assert.equal(props.showSave, true);
    assert.equal(props.saveDisabled, false);
    assert.equal(props.saveTitle, '');
    assert.equal(props.saveLabel, 'Save');
    assert.equal(props.showDiscardConfirm, false);
    assert.equal(props.testConfigurationMessage, '');
    const { props: flipped } = await modalProps({ settingsShowsSave: false, settingsSaveDisabled: true, settingsSaveTitle: 'Why', settingsSaveLabel: 'Saving...', showGroupDiscardConfirm: true, groupTestMessage: 'ok', headerAction: undefined });
    assert.equal(flipped.showSave, false);
    assert.equal(flipped.saveDisabled, true);
    assert.equal(flipped.saveTitle, 'Why');
    assert.equal(flipped.saveLabel, 'Saving...');
    assert.equal(flipped.showDiscardConfirm, true);
    assert.equal(flipped.testConfigurationMessage, 'ok');
});

test('Connections tab: never dirty, no unsaved count, no validation messages or actions, Close label, no Test button', async () => {
    const { props } = await modalProps({ groupManageTab: 'connections', isGroupDraftDirty: true, unsavedSectionsCount: 5, groupConfigValidationErrors: ['x'], workspaceConfigConflict: { savedSections: [] }, groupsConfigConflict: { current: {} } });
    assert.equal(props.isDirty, false);
    assert.equal(props.unsavedSectionsCount, 0);
    assert.deepEqual(props.validationMessages, []);
    assert.equal(props.validationActions, null);
    assert.equal(props.cancelLabel, 'Close');
    assert.equal(props.showTestConfiguration, false);
    const { props: other } = await modalProps();
    assert.equal(other.isDirty, true);
    assert.equal(other.unsavedSectionsCount, 2);
    assert.equal(other.cancelLabel, 'Cancel');
    const { props: clean } = await modalProps({ isGroupDraftDirty: false });
    assert.equal(clean.isDirty, false);
});

test('Test configuration is offered on every tab except EPM, Connections, Access and Performance; its busy state and label follow groupTesting', async () => {
    for (const [tab, expected] of [['teams', true], ['scope', true], ['source', true], ['mapping', true], ['labels', true], ['boards', true], ['epm', false], ['connections', false], ['access', false], ['performance', false]]) {
        const { props } = await modalProps({ groupManageTab: tab });
        assert.equal(props.showTestConfiguration, expected, tab);
    }
    const idle = (await modalProps()).props;
    assert.deepEqual([idle.testConfigurationDisabled, idle.testConfigurationLabel], [false, 'Test configuration']);
    const busy = (await modalProps({ groupTesting: true })).props;
    assert.deepEqual([busy.testConfigurationDisabled, busy.testConfigurationLabel], [true, 'Testing...']);
});

test('first-run mandatory guide: backdrop close is a no-op, Cancel is the exact first-run restore; otherwise both use the shared close handler', async () => {
    const normal = (await modalProps()).props;
    assert.equal(normal.onRequestClose.name, 'requestClose');
    assert.equal(normal.onCancel.name, 'requestClose');
    const firstRun = (await modalProps({ firstRunConfigurationActive: true })).props;
    assert.notEqual(firstRun.onRequestClose.name, 'requestClose');
    assert.equal(firstRun.onRequestClose(), undefined);
    assert.equal(firstRun.onCancel.name, 'cancelFirstRun');
});

test('Keep editing hides the discard confirmation', async () => {
    const calls = [];
    const { props } = await modalProps({ setShowGroupDiscardConfirm: (value) => calls.push(value) });
    props.onKeepEditing();
    assert.deepEqual(calls, [false]);
});

test('validationMessages: workspace conflict, group conflict with pending sections, the save error only for shared tabs without a conflict, then field errors', async () => {
    const workspace = { savedSections: ['Capacity'], pendingSections: ['Jira board'], currentRevision: 3 };
    const groups = { current: { configRevision: 4 }, savedSections: ['Scope projects'] };
    const both = (await modalProps({ groupManageTab: 'scope', workspaceConfigConflict: workspace, groupsConfigConflict: groups, groupConfigValidationErrors: ['E1', 'E2'], settingsSaveError: 'boom' })).props.validationMessages;
    assert.deepEqual(both.slice(0, 3), [
        'Shared settings changed while you were editing. Your changes are still unsaved.', 'Already saved: Capacity.', 'Still unsaved: Jira board.',
    ]);
    assert.ok(both.some((message) => /Scope projects/.test(message)), 'the group conflict message lists the saved sections');
    assert.deepEqual(both.slice(-2), ['E1', 'E2']);
    assert.equal(both.includes('boom'), false, 'the save error is suppressed while a conflict banner is shown');
    const errorOnly = (await modalProps({ groupManageTab: 'scope', settingsSaveError: 'boom', groupDraftError: 'ignored', groupConfigValidationErrors: ['E1'] })).props.validationMessages;
    assert.deepEqual(errorOnly, ['boom', 'E1']);
    const draftError = (await modalProps({ groupManageTab: 'mapping', groupDraftError: 'draft broke' })).props.validationMessages;
    assert.deepEqual(draftError, ['draft broke']);
    const departmentError = (await modalProps({ groupManageTab: 'teams', settingsSaveError: 'boom' })).props.validationMessages;
    assert.deepEqual(departmentError, [], 'the save error shows for shared-configuration tabs only');
    const pendingEpm = (await modalProps({ groupsConfigConflict: groups, isEpmConfigDirty: true, canEditEpmConfiguration: true, isGroupVisibilityDraftDirty: true })).props.validationMessages;
    assert.ok(pendingEpm.some((message) => /EPM settings/.test(message)) && pendingEpm.some((message) => /group visibility preferences/.test(message)));
    const noEpmGrant = (await modalProps({ groupsConfigConflict: groups, isEpmConfigDirty: true, canEditEpmConfiguration: false })).props.validationMessages;
    assert.equal(noEpmGrant.some((message) => /EPM settings/.test(message)), false, 'an EPM draft without its grant is not listed as pending');
    const boardDraft = (await modalProps({ groupsConfigConflict: groups, isGroupBoardDraftDirty: true })).props.validationMessages;
    const noBoardDraft = (await modalProps({ groupsConfigConflict: groups, isGroupBoardDraftDirty: false })).props.validationMessages;
    assert.notDeepEqual(boardDraft, noBoardDraft, 'the board-draft flag reaches the conflict message builder');
});

test('validationActions: workspace Use latest/Keep mine, group Discard mine/Keep mine, none after a first-run commit or without a conflict', async () => {
    const workspace = { savedSections: [], pendingSections: [] };
    const groups = { current: { configRevision: 1 } };
    const text = (element) => React.Children.toArray(element.props.children).map((child) => child.props.children);
    const clickers = (element) => React.Children.toArray(element.props.children).map((child) => child.props.onClick.name);
    const ws = (await modalProps({ workspaceConfigConflict: workspace })).props.validationActions;
    assert.equal(ws.props['data-testid'], 'workspace-config-conflict-actions');
    assert.deepEqual(text(ws), ['Use latest', 'Keep mine']);
    assert.deepEqual(clickers(ws), ['useLatest', 'keepMineWorkspace']);
    const grp = (await modalProps({ groupsConfigConflict: groups })).props.validationActions;
    assert.equal(grp.props['data-testid'], undefined);
    assert.deepEqual(text(grp), ['Discard mine', 'Keep mine']);
    assert.deepEqual(clickers(grp), ['discardMine', 'keepMineGroups']);
    const both = (await modalProps({ workspaceConfigConflict: workspace, groupsConfigConflict: groups })).props.validationActions;
    assert.equal(both.props['data-testid'], 'workspace-config-conflict-actions', 'the workspace conflict wins when both exist');
    for (const overrides of [{ workspaceConfigConflict: workspace, firstRunHasCommittedSection: true }, { groupsConfigConflict: groups, firstRunHasCommittedSection: true }, {}]) {
        assert.equal((await modalProps(overrides)).props.validationActions, null, JSON.stringify(Object.keys(overrides)));
    }
});

test('dashboard call site: the open-state conditional stays in the app, props are explicit name={name} attributes matching the destructure, children are the tab bodies', () => {
    const open = dashboardSource.indexOf('<SettingsModalContainer');
    assert.notStrictEqual(open, -1);
    assert.ok(/\{showGroupManage && \(\s*<SettingsModalContainer/.test(dashboardSource));
    const openTagEnd = dashboardSource.indexOf('\n                        >', open);
    const call = dashboardSource.slice(open, openTagEnd);
    const passed = call.split('\n').map((line) => line.trim().match(/^([A-Za-z_$][\w$]*)=\{([A-Za-z_$][\w$]*)\}$/)).filter(Boolean);
    assert.deepEqual(passed.map((match) => match[1]).sort(), PROP_NAMES);
    assert.equal(passed.every((match) => match[1] === match[2]), true, 'every prop is name={name}');
    assert.equal(call.split('\n').filter((line) => line.trim() && !/^<SettingsModalContainer$|^[A-Za-z_$][\w$]*=\{[A-Za-z_$][\w$]*\}$/.test(line.trim())).length, 0, 'no spread or inline expression in the call');
    const children = dashboardSource.slice(openTagEnd, dashboardSource.indexOf('</SettingsModalContainer>', openTagEnd));
    for (const marker of ["groupManageTab === 'connections'", '<UserConnectionsSettings', '<AdminSettingsContainer', "groupManageTab === 'epm'", '<EpmSettingsTab', '<DepartmentsSettingsTab']) assert.ok(children.includes(marker), marker);
    assert.equal(dashboardSource.includes('<SettingsModal\n'), false, 'the dashboard reaches the shell only through the container');
    assert.ok(dashboardSource.includes("import SettingsModalContainer from './settings/SettingsModalContainer.jsx';"));
});
