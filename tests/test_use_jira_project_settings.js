const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Server-render probe for useJiraProjectSettings (ST1 R4b): defaults and the flat return contract of the
// state layer, plus the two effects layers rendering without error (effects do not run in a server render).
const hookPath = path.join(__dirname, '../frontend/src/settings/useJiraProjectSettings.js');

const EXPECTED_RETURN_NAMES = [
    'jiraProjects', 'loadingProjects', 'projectSearchQuery', 'setProjectSearchQuery', 'setProjectSearchRemoteResults',
    'projectSearchRemoteLoading', 'setProjectSearchRemoteLoading', 'projectSearchOpen', 'setProjectSearchOpen',
    'projectSearchIndex', 'setProjectSearchIndex', 'selectedProjectsDraft', 'setSelectedProjectsDraft',
    'savedSelectedProjects', 'projectSearchInputRef', 'setBoardSearchRemoteResults', 'boardSearchRemoteLoading',
    'setBoardSearchRemoteLoading', 'boardIdDraft', 'setBoardIdDraft', 'savedBoardId', 'boardNameDraft',
    'setBoardNameDraft', 'boardSearchQuery', 'setBoardSearchQuery', 'boardSearchOpen', 'setBoardSearchOpen',
    'boardSearchIndex', 'setBoardSearchIndex', 'boardSearchInputRef', 'jiraFields', 'loadingFields',
    'issueTypesDraft', 'setIssueTypesDraft', 'issueTypeSearchQuery', 'setIssueTypeSearchQuery',
    'issueTypeSearchOpen', 'setIssueTypeSearchOpen', 'issueTypeSearchIndex', 'setIssueTypeSearchIndex',
    'issueTypeSearchInputRef', 'isProjectsDraftDirty', 'isBoardConfigDirty', 'isIssueTypesDraftDirty',
    'boardSearchResults', 'projectSearchResults', 'issueTypeSearchResults', 'fetchJiraProjects',
    'loadSelectedProjects', 'loadBoardConfig', 'saveBoardConfig', 'addProjectSelection', 'clearBoardSelection',
    'removeProjectSelection', 'handleProjectSearchKeyDown', 'handleBoardSearchKeyDown', 'resolveProjectName',
    'saveProjectSelection', 'loadIssueTypesConfig', 'saveIssueTypesConfig', 'fetchAvailableIssueTypes',
    'addIssueType', 'removeIssueType', 'handleIssueTypeSearchKeyDown', 'fetchJiraFields',
    'applyProjectsAndBoardLoaded', 'applyIssueTypesLoaded', 'draftSnapshot',
];

function loadHooks() {
    const code = esbuild.buildSync({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

function renderHook() {
    const { useJiraProjectSettings } = loadHooks();
    let result;
    const noop = () => {};
    function Probe() {
        result = useJiraProjectSettings({
            BACKEND_URL: 'http://example.test',
            acceptSettingsConfigBaseline: noop,
            boardConfigReadGenerationRef: { current: 0 },
            boardConfigSaveReadFenceRef: { current: 0 },
            clearServerConnectionError: noop,
            commitSharedConfigRevision: noop,
            reportServerConnectionError: () => false,
            setGroupDraftError: noop,
            setGroupSaving: noop,
            settingsConfigBaselineRevision: 0,
            settingsDraftSnapshotRef: { current: {} },
            sharedConfigRevisionRef: { current: 0 },
        });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return result;
}

test('the state layer returns the 68 documented names in order', () => {
    assert.equal(EXPECTED_RETURN_NAMES.length, 68);
    assert.deepEqual(Object.keys(renderHook()), EXPECTED_RETURN_NAMES);
});

test('a fresh hook holds empty drafts, is clean and snapshots its three sections', () => {
    const result = renderHook();
    assert.deepEqual(result.jiraProjects, []);
    assert.deepEqual(result.jiraFields, []);
    assert.deepEqual(result.selectedProjectsDraft, []);
    assert.deepEqual(result.issueTypesDraft, ['Story']);
    assert.equal(result.boardIdDraft, '');
    assert.equal(result.isProjectsDraftDirty, false);
    assert.equal(result.isBoardConfigDirty, false);
    assert.equal(result.isIssueTypesDraftDirty, false);
    assert.deepEqual(result.draftSnapshot, {
        projects: '[]',
        board: JSON.stringify({ boardId: '', boardName: '' }),
        issueTypes: JSON.stringify(['Story']),
    });
    assert.deepEqual(result.projectSearchResults, []);
});

test('every function in the result is callable', () => {
    const result = renderHook();
    for (const name of EXPECTED_RETURN_NAMES.filter((key) => /^(set[A-Z]|load[A-Z]|save[A-Z]|fetch[A-Z]|add[A-Z]|remove[A-Z]|clear[A-Z]|handle[A-Z]|resolve[A-Z]|applyProjectsAndBoardLoaded|applyIssueTypesLoaded)/.test(key) && !/^(loadingProjects|loadingFields|savedBoardId|savedSelectedProjects)$/.test(key))) {
        assert.equal(typeof result[name], 'function', name);
    }
});

test('the two effects layers render with the state layer outputs', () => {
    const { useJiraProjectSettings, useJiraProjectSearchEffects, useJiraProjectCatalogEffects } = loadHooks();
    const noop = () => {};
    function Probe() {
        const s = useJiraProjectSettings({
            BACKEND_URL: '', acceptSettingsConfigBaseline: noop, boardConfigReadGenerationRef: { current: 0 },
            boardConfigSaveReadFenceRef: { current: 0 }, clearServerConnectionError: noop, commitSharedConfigRevision: noop,
            reportServerConnectionError: () => false, setGroupDraftError: noop, setGroupSaving: noop,
            settingsConfigBaselineRevision: 0, settingsDraftSnapshotRef: { current: {} }, sharedConfigRevisionRef: { current: 0 },
        });
        useJiraProjectSearchEffects({
            BACKEND_URL: '', boardIdDraft: s.boardIdDraft, boardSearchQuery: s.boardSearchQuery, groupManageTab: 'scope',
            projectSearchQuery: s.projectSearchQuery, setBoardSearchRemoteLoading: s.setBoardSearchRemoteLoading,
            setBoardSearchRemoteResults: s.setBoardSearchRemoteResults, setProjectSearchRemoteLoading: s.setProjectSearchRemoteLoading,
            setProjectSearchRemoteResults: s.setProjectSearchRemoteResults, showGroupManage: false,
        });
        useJiraProjectCatalogEffects({
            boardSearchIndex: s.boardSearchIndex, boardSearchResults: s.boardSearchResults, fetchJiraFields: s.fetchJiraFields,
            issueTypeSearchIndex: s.issueTypeSearchIndex, issueTypeSearchResults: s.issueTypeSearchResults,
            projectSearchIndex: s.projectSearchIndex, projectSearchResults: s.projectSearchResults,
            setBoardSearchIndex: s.setBoardSearchIndex, setIssueTypeSearchIndex: s.setIssueTypeSearchIndex,
            setProjectSearchIndex: s.setProjectSearchIndex, showGroupManage: false,
        });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
});
