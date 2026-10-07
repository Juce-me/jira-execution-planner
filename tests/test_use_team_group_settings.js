const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Server-render probe for useTeamGroupSettings (ST3 R4a): the single state-plus-behavior hook and its three
// effects layers. A server render cannot run state updates or effects, so the hook is bundled against a thin
// React wrapper that (a) seeds named useState/useRef values, (b) records setter calls and (c) captures effect
// callbacks with their dependency arrays so a test can run one by hand.
const hookPath = path.join(__dirname, '../frontend/src/settings/useTeamGroupSettings.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const mainSource = hookSource.slice(hookSource.indexOf('export function useTeamGroupSettings('), hookSource.indexOf('export function useTeamGroupSelectionEffect('));
const STATE_NAMES = [...mainSource.matchAll(/const \[(\w+), (\w+)\] = (?:React\.)?useState\(/g)].map((match) => [match[1], match[2]]);
const REF_NAMES = [...mainSource.matchAll(/const (\w+) = (?:React\.)?useRef\(/g)].map((match) => match[1]);

const INPUT_NAMES = ["BACKEND_URL", "activeGroupId", "clearServerConnectionError", "firstRunConfigurationActive", "getTeamOptions", "markConnectionBootstrapHealthy", "reportServerConnectionError", "savedPrefsRef", "selectedSprintInfo", "setActiveGroupId", "setGroupDraftError", "setShowGroupListMobile", "showGroupManage", "teamCatalogState", "teamMembershipState", "trackSettingsAction"];
const RETURN_NAMES = ["groupsConfig", "setGroupsConfig", "groupsLoading", "setGroupsLoading", "groupsError", "setGroupsError", "boardGroupsReadFailed", "setBoardGroupsReadFailed", "acceptedGroupsConfigRef", "groupsReadGenerationRef", "groupsSaveReadFenceRef", "groupWarnings", "groupConfigSource", "groupDraft", "setGroupDraft", "groupsConfigConflict", "setGroupsConfigConflict", "groupImportText", "setGroupImportText", "showGroupImport", "setShowGroupImport", "showGroupAdvanced", "setShowGroupAdvanced", "setTeamNameInputs", "setTeamSearchQuery", "teamSearchOpen", "setTeamSearchOpen", "setTeamSearchIndex", "teamSearchFeedback", "setTeamSearchFeedback", "teamSearchInputRefs", "teamChipLastRef", "labelSearchQuery", "setLabelSearchQuery", "labelSearchOpen", "setLabelSearchOpen", "labelSearchResults", "setLabelSearchResults", "labelSearchLoading", "setLabelSearchLoading", "labelSearchIndex", "setLabelSearchIndex", "labelAddOpen", "setLabelAddOpen", "labelAddButtonRefs", "labelSearchRequestIdRef", "labelSearchDebounceRef", "groupSearchQuery", "setGroupSearchQuery", "activeGroupDraftId", "setActiveGroupDraftId", "groupDraftBaselineRef", "componentSearchQuery", "setComponentSearchQuery", "setComponentSearchResults", "componentSearchOpen", "setComponentSearchOpen", "componentSearchIndex", "setComponentSearchIndex", "componentSearchLoading", "setComponentSearchLoading", "excludedEpicSearchQuery", "setExcludedEpicSearchQuery", "setExcludedEpicSearchResults", "excludedEpicSearchOpen", "setExcludedEpicSearchOpen", "excludedEpicSearchIndex", "setExcludedEpicSearchIndex", "excludedEpicSearchLoading", "setExcludedEpicSearchLoading", "excludedEpicSearchInputRef", "excludedEpicChipLastRef", "adHocEpicSearchQuery", "setAdHocEpicSearchResults", "adHocEpicSearchOpen", "adHocEpicSearchIndex", "setAdHocEpicSearchIndex", "adHocEpicSearchLoading", "setAdHocEpicSearchLoading", "adHocEpicSearchInputRef", "adHocEpicChipLastRef", "personalGroupPreferencesEnabled", "groupPreferences", "setGroupPreferences", "visibleGroupDraftIds", "setVisibleGroupDraftIds", "favoriteGroupDraftId", "setFavoriteGroupDraftId", "setFavoriteGroupDraft", "favoriteGroupValidationError", "setGroupPreferencesSaving", "groupVisibilitySaving", "isGroupVisibilityDraftDirty", "visibleControlGroups", "initializeGroupPreferencesDraft", "isGroupVisibleInControls", "toggleGroupVisibleInControls", "firstRunFavoriteGroupId", "selectFirstRunFavoriteGroup", "saveFirstRunGroupPreferences", "firstRunSaving", "firstRunError", "persistGroupPreferences", "loadGroupsConfig", "loadTeamsFromCurrentView", "groupDraftSignature", "isGroupBoardDraftDirty", "closeAllTeamSearchDropdowns", "addGroupDraftRow", "updateGroupDraftName", "duplicateGroupDraft", "updateGroupDraftBoard", "addTeamToGroup", "removeTeamFromGroup", "removeTeamLabelFromGroup", "handleTeamSearchChange", "handleTeamSearchFocus", "handleTeamSearchBlur", "handleTeamSearchKeyDown", "removeGroupDraft", "toggleDefaultGroupDraft", "applySavedGroupsConfig", "filteredComponentSearchResults", "filteredExcludedEpicSearchResults", "filteredAdHocEpicSearchResults", "handleComponentSearchKeyDown", "addGroupMissingInfoComponent", "removeGroupMissingInfoComponent", "addGroupExcludedCapacityEpic", "removeGroupExcludedCapacityEpic", "addGroupAdHocCapacityEpic", "removeGroupAdHocCapacityEpic", "handleExcludedEpicSearchKeyDown", "handleAdHocEpicSearchKeyDown", "handleExcludedEpicSearchChange", "handleExcludedEpicSearchFocus", "handleExcludedEpicSearchBlur", "handleAdHocEpicSearchChange", "handleAdHocEpicSearchFocus", "handleAdHocEpicSearchBlur", "exportGroupsConfig", "importGroupsConfig", "availableTeams", "teamNameLookup", "resolveTeamName", "activeGroupDraft", "filteredGroupDrafts", "teamCacheLabel", "teamCatalogCanRefresh", "activeTeamQuery", "activeTeamResultsLimited", "activeTeamAvailabilityKey", "activeTeamIndex", "getLabelSearchResults", "closeTeamLabelSearch", "selectTeamLabel", "handleLabelSearchKeyDown", "scheduleJiraLabelSearch"];

function loadHooks({ state = {}, ref = {}, setterCalls = [], effects = [] } = {}) {
    const code = esbuild.buildSync({
        entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
    }).outputFiles[0].text;
    let stateCalls = 0;
    let refCalls = 0;
    const shimmedReact = {
        ...React,
        useState(initial) {
            const [name, setter] = STATE_NAMES[stateCalls++] || [];
            const value = name in state ? state[name] : typeof initial === 'function' ? initial() : initial;
            return [value, (next) => { setterCalls.push([setter, next]); }];
        },
        useRef(initial) {
            const name = REF_NAMES[refCalls++];
            return { current: name in ref ? ref[name] : initial };
        },
        useEffect(fn, deps) { effects.push({ fn, deps }); },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => (id === 'react' ? shimmedReact : require(id)));
    return module.exports;
}

function appInputs(overrides = {}) {
    const calls = [];
    const record = (name, value) => (...args) => { calls.push([name, ...args]); return value; };
    const inputs = {
        BACKEND_URL: 'http://example.test',
        activeGroupId: null,
        clearServerConnectionError: record('clearServerConnectionError'),
        firstRunConfigurationActive: false,
        getTeamOptions: record('getTeamOptions', [{ id: 'all', name: 'All teams' }, { id: 't1', name: 'Team One' }]),
        markConnectionBootstrapHealthy: record('markConnectionBootstrapHealthy'),
        reportServerConnectionError: record('reportServerConnectionError', false),
        savedPrefsRef: { current: {} },
        selectedSprintInfo: null,
        setActiveGroupId: record('setActiveGroupId'),
        setGroupDraftError: record('setGroupDraftError'),
        setShowGroupListMobile: record('setShowGroupListMobile'),
        showGroupManage: false,
        teamCatalogState: { catalog: {}, meta: {} },
        teamMembershipState: { status: 'idle', snapshot: null, generation: null, validated: false },
        trackSettingsAction: record('trackSettingsAction'),
        ...overrides,
    };
    return { inputs, calls };
}

function renderHook({ state, ref, overrides } = {}) {
    const setterCalls = [];
    const effects = [];
    const { useTeamGroupSettings } = loadHooks({ state, ref, setterCalls, effects });
    const { inputs, calls } = appInputs(overrides);
    let result;
    function Probe() {
        result = useTeamGroupSettings(inputs);
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return { result, inputs, calls, setterCalls, effects };
}

const DRAFT = {
    version: 1,
    defaultGroupId: 'g1',
    groups: [
        { id: 'g1', name: 'Alpha', teamIds: ['t1', 't2'], teamLabels: { t1: ['one', 'two', 'three'] }, missingInfoComponents: [], excludedCapacityEpics: [] },
        { id: 'g2', name: 'Beta', teamIds: ['t3'], missingInfoComponents: [], excludedCapacityEpics: [] },
    ],
};

test('the hook takes the 16 documented inputs and returns its 158 names in order', () => {
    const signature = hookSource.slice(hookSource.indexOf('export function useTeamGroupSettings({') + 'export function useTeamGroupSettings({\n'.length, hookSource.indexOf('\n}) {'));
    assert.deepEqual(signature.split('\n').map((line) => line.trim().replace(/,$/, '')), INPUT_NAMES);
    assert.equal(INPUT_NAMES.length, 16);
    assert.equal(RETURN_NAMES.length, 158);
    assert.equal(STATE_NAMES.length, 39);
    const { result, inputs } = renderHook();
    assert.deepEqual(Object.keys(inputs), INPUT_NAMES);
    assert.deepEqual(Object.keys(result), RETURN_NAMES);
});

test('a fresh hook holds empty group state, the loading flag and clean dirty/derived defaults', () => {
    const { result, effects } = renderHook();
    assert.deepEqual(result.groupsConfig, { version: 1, groups: [], defaultGroupId: '' });
    assert.equal(result.groupsLoading, true);
    assert.equal(result.groupsError, '');
    assert.equal(result.boardGroupsReadFailed, false);
    assert.equal(result.acceptedGroupsConfigRef.current, false);
    assert.equal(result.groupsReadGenerationRef.current, 0);
    assert.equal(result.groupsSaveReadFenceRef.current, 0);
    assert.equal(result.groupDraft, null);
    assert.equal(result.groupsConfigConflict, null);
    assert.equal(result.groupDraftBaselineRef.current, '');
    assert.equal(result.activeGroupDraftId, null);
    assert.equal(result.groupSearchQuery, '');
    assert.equal(result.groupImportText, '');
    assert.equal(result.showGroupImport, false);
    assert.equal(result.showGroupAdvanced, false);
    assert.deepEqual(result.teamSearchOpen, {});
    assert.equal(result.componentSearchIndex, 0);
    assert.equal(result.personalGroupPreferencesEnabled, false);
    assert.equal(result.groupDraftSignature, '');
    assert.equal(result.isGroupBoardDraftDirty, false);
    assert.equal(result.activeGroupDraft, null);
    assert.deepEqual(result.filteredGroupDrafts, []);
    assert.deepEqual(result.activeTeamResultsLimited, []);
    assert.equal(result.activeTeamQuery, '');
    assert.equal(result.activeTeamIndex, 0);
    assert.equal(result.teamCatalogCanRefresh, false);
    assert.equal(result.groupVisibilitySaving, false);
    assert.equal(effects.length >= 2, true, 'the nested group-visibility hook still registers its own effects inside this hook');
});

test('derived draft values follow the seeded draft, the active id and the search query', () => {
    const base = { groupDraft: DRAFT, activeGroupDraftId: 'g2' };
    const { result } = renderHook({ state: base });
    assert.equal(result.activeGroupDraft.id, 'g2');
    assert.equal(JSON.parse(result.groupDraftSignature).groups.length, 2, 'the signature is the shared payload of the draft');
    assert.deepEqual(result.filteredGroupDrafts.map((group) => group.id), ['g1', 'g2']);
    const searched = renderHook({ state: { ...base, groupSearchQuery: 'bet' } });
    assert.deepEqual(searched.result.filteredGroupDrafts.map((group) => group.id), ['g2']);
    const firstRun = renderHook({ state: { ...base, groupSearchQuery: 'bet' }, overrides: { firstRunConfigurationActive: true } });
    assert.deepEqual(firstRun.result.filteredGroupDrafts.map((group) => group.id), ['g1', 'g2'], 'the first-run guide shows every group regardless of the query');
    const workspace = renderHook({ state: { groupsConfig: { version: 1, groups: [], defaultGroupId: '', source: 'workspace_db' } } });
    assert.equal(workspace.result.personalGroupPreferencesEnabled, true);
});

test('the Team options getter is read only when loadTeamsFromCurrentView runs, never during render', () => {
    const { result, calls } = renderHook();
    assert.equal(calls.filter(([name]) => name === 'getTeamOptions').length, 0, 'a render-phase getter call would be a TDZ in App');
    assert.deepEqual(result.loadTeamsFromCurrentView(), [{ id: 't1', name: 'Team One' }]);
    assert.equal(calls.filter(([name]) => name === 'getTeamOptions').length, 1);
});

test('draft mutators update the draft through functional updaters and keep Team labels to three aliases', () => {
    const { result, setterCalls } = renderHook({ state: { groupDraft: DRAFT, activeGroupDraftId: 'g1' } });
    const lastDraftSetter = () => setterCalls.filter(([name]) => name === 'setGroupDraft').at(-1)[1];
    const apply = () => lastDraftSetter()(DRAFT);
    result.toggleDefaultGroupDraft('g1');
    assert.equal(apply().defaultGroupId, '');
    result.toggleDefaultGroupDraft('g2');
    assert.equal(apply().defaultGroupId, 'g2');
    result.updateGroupDraftName('g2', 'Gamma');
    assert.deepEqual(apply().groups.map((group) => group.name), ['Alpha', 'Gamma']);
    result.addGroupDraftRow();
    const added = apply();
    assert.equal(added.groups.length, 3);
    assert.equal(added.groups[2].name, 'New Group');
    result.removeGroupDraft('g1');
    assert.deepEqual(apply().groups.map((group) => group.id), ['g2']);
    assert.equal(setterCalls.some(([name]) => name === 'setActiveGroupDraftId'), true, 'removing the active group re-selects through the active-id setter');
    assert.deepEqual(setterCalls.filter(([name]) => name === undefined).at(-1)[1](['g1', 'g2']), ['g2'], 'the removed group leaves the personal visibility draft (a state setter of the nested group-visibility hook)');
    result.removeTeamFromGroup('g1', 't1');
    const removedTeam = apply().groups[0];
    assert.deepEqual(removedTeam.teamIds, ['t2']);
    assert.equal(removedTeam.teamLabels.t1, undefined, 'removing a Team drops its label aliases');
    const previousWindow = global.window;
    global.window = { setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {} };
    try {
        const feedbackOf = () => {
            const call = setterCalls.filter(([name]) => name === 'setTeamSearchFeedback').at(-1);
            return call[1]({});
        };
        const draftCalls = () => setterCalls.filter(([name]) => name === 'setGroupDraft').length;
        const before = draftCalls();
        result.selectTeamLabel('g1', 't1', 'four');
        assert.deepEqual(Object.values(feedbackOf()), [{ message: 'Limit reached (3 max)', tone: 'warn' }], 'a fourth alias is refused with the limit message');
        result.selectTeamLabel('g1', 't1', 'TWO');
        assert.deepEqual(Object.values(feedbackOf()), [{ message: 'Already added', tone: 'neutral' }]);
        assert.equal(draftCalls(), before, 'refused aliases never touch the draft');
        result.selectTeamLabel('g1', 't2', 'solo');
        assert.equal(draftCalls(), before + 1);
        assert.deepEqual(apply().groups[0].teamLabels.t2, ['solo']);
    } finally {
        global.window = previousWindow;
    }
    result.removeTeamLabelFromGroup('g1', 't1', 'two');
    assert.deepEqual(apply().groups[0].teamLabels.t1, ['one', 'three']);
});

test('loadGroupsConfig applies a accepted read and records the failure path', async () => {
    const previousFetch = global.fetch;
    const respond = (ok, payload, status = ok ? 200 : 500) => ({ ok, status, headers: { get: () => '' }, json: async () => payload });
    try {
        global.fetch = async () => respond(true, { version: 1, defaultGroupId: 'g1', source: 'jsonfile', warnings: ['w'], groups: [{ id: 'g1', name: 'Alpha', teamIds: ['t1'] }] });
        const ok = renderHook();
        assert.equal(await ok.result.loadGroupsConfig(), true);
        const names = ok.setterCalls.map(([name]) => name);
        assert.deepEqual(names.filter((name) => ['setGroupsLoading', 'setGroupsError', 'setBoardGroupsReadFailed', 'setGroupsConfig', 'setGroupWarnings', 'setGroupConfigSource'].includes(name)),
            ['setGroupsLoading', 'setGroupsError', 'setGroupsConfig', 'setGroupWarnings', 'setGroupConfigSource', 'setBoardGroupsReadFailed', 'setGroupsLoading']);
        assert.equal(ok.setterCalls.find(([name]) => name === 'setGroupsConfig')[1].groups[0].id, 'g1');
        assert.equal(ok.result.acceptedGroupsConfigRef.current, true);
        assert.deepEqual(ok.calls.filter(([name]) => /^(clearServerConnectionError|markConnectionBootstrapHealthy)$/.test(name)), [['clearServerConnectionError'], ['markConnectionBootstrapHealthy', 'groups']]);
        assert.deepEqual(ok.setterCalls.filter(([name]) => name === 'setGroupsLoading').map(([, value]) => value), [true, false]);

        global.fetch = async () => respond(false, {}, 503);
        const failed = renderHook({ ref: { acceptedGroupsConfigRef: true } });
        assert.equal(await failed.result.loadGroupsConfig(), false);
        assert.equal(failed.result.acceptedGroupsConfigRef.current, false);
        assert.deepEqual(failed.setterCalls.filter(([name]) => /^(setBoardGroupsReadFailed|setGroupsError)$/.test(name)).map(([name, value]) => [name, value]),
            [['setGroupsError', ''], ['setBoardGroupsReadFailed', true], ['setGroupsError', 'Groups config error 503']]);
        assert.equal(failed.calls.some(([name, , options]) => name === 'reportServerConnectionError' && options?.bootstrapPart === 'groups'), true);

        const fenced = renderHook({ ref: { groupsSaveReadFenceRef: 1 } });
        assert.equal(await fenced.result.loadGroupsConfig(), false, 'a read started under a save fence is discarded');
        assert.equal(fenced.setterCalls.some(([name]) => name === 'setGroupsConfig'), false);
    } finally {
        global.fetch = previousFetch;
    }
});

test('export and import stay scoped to the selected group', async () => {
    const previousFetch = global.fetch;
    const previous = { window: global.window, document: global.document, URL: global.URL };
    const blobs = [];
    const respond = (payload) => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => payload });
    try {
        global.fetch = async () => respond(DRAFT);
        const link = { click() {}, remove() {} };
        global.document = { createElement: () => link, body: { appendChild() {} } };
        global.URL = Object.assign(function URLShim() {}, { createObjectURL: (blob) => { blobs.push(blob); return 'blob:x'; }, revokeObjectURL() {} });
        const none = renderHook();
        await none.result.exportGroupsConfig();
        assert.equal(none.calls.some(([name, value]) => name === 'setGroupDraftError' && value === 'Select a group before exporting.'), true);
        const exported = renderHook({ state: { groupDraft: DRAFT, activeGroupDraftId: 'g2' } });
        await exported.result.exportGroupsConfig();
        const payload = JSON.parse(await blobs[0].text());
        assert.deepEqual(Object.keys(payload).sort(), ['group', 'version']);
        assert.equal(payload.group.id, 'g2');
        assert.equal(link.download, 'group-g2.json');

        const text = JSON.stringify({ version: 1, group: { id: 'zzz', name: 'Imported', teamIds: ['t9'], teamLabels: { t9: ['a', 'b'] } } });
        const imported = renderHook({ state: { groupDraft: DRAFT, activeGroupDraftId: 'g1', groupImportText: text } });
        imported.result.importGroupsConfig();
        const next = imported.setterCalls.find(([name]) => name === 'setGroupDraft')[1](DRAFT);
        assert.deepEqual(next.groups.map((group) => [group.id, group.name]), [['g1', 'Alpha'], ['g2', 'Beta']], 'the import keeps the selected group id and name and leaves siblings alone');
        assert.deepEqual(next.groups[0].teamIds, ['t9']);
        assert.deepEqual(next.groups[1], DRAFT.groups[1]);
        const tooMany = renderHook({ state: { groupDraft: DRAFT, activeGroupDraftId: 'g1', groupImportText: JSON.stringify({ group: { id: 'q', name: 'Q', teamIds: ['t9'], teamLabels: { t9: ['a', 'b', 'c', 'd'] } } }) } });
        tooMany.result.importGroupsConfig();
        assert.equal(tooMany.setterCalls.some(([name]) => name === 'setGroupDraft'), false);
        assert.equal(tooMany.calls.filter(([name]) => name === 'setGroupDraftError').length, 1);
    } finally {
        global.fetch = previousFetch;
        Object.assign(global, previous);
    }
});

test('the Board colour flag follows export, import and duplicate of the selected group only', async () => {
    const previousFetch = global.fetch;
    const previous = { window: global.window, document: global.document, URL: global.URL };
    const blobs = [];
    const board = { columns: [{ id: 'col-00000001', name: 'To do', statuses: ['To Do'], colour: '#8c8c8c', star: false, min: null, max: null }], doneEpicRetentionDays: 28, inheritColumnColours: true };
    const flagged = { ...DRAFT, groups: [{ ...DRAFT.groups[0], board }, DRAFT.groups[1]] };
    try {
        global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => flagged });
        const link = { click() {}, remove() {} };
        global.document = { createElement: () => link, body: { appendChild() {} } };
        global.URL = Object.assign(function URLShim() {}, { createObjectURL: (blob) => { blobs.push(blob); return 'blob:x'; }, revokeObjectURL() {} });

        await renderHook({ state: { groupDraft: flagged, activeGroupDraftId: 'g1' } }).result.exportGroupsConfig();
        assert.equal(JSON.parse(await blobs[0].text()).group.board.inheritColumnColours, true);
        await renderHook({ state: { groupDraft: flagged, activeGroupDraftId: 'g2' } }).result.exportGroupsConfig();
        assert.equal(Object.hasOwn(JSON.parse(await blobs[1].text()).group, 'board'), false, 'the other group carries no flag');

        const importText = (group) => JSON.stringify({ version: 1, group });
        const withFlag = renderHook({ state: { groupDraft: DRAFT, activeGroupDraftId: 'g1', groupImportText: importText({ id: 'z', name: 'Z', teamIds: ['t9'], board }) } });
        withFlag.result.importGroupsConfig();
        const imported = withFlag.setterCalls.find(([name]) => name === 'setGroupDraft')[1](DRAFT);
        assert.equal(imported.groups[0].board.inheritColumnColours, true);
        assert.equal(Object.hasOwn(imported.groups[1], 'board'), false);

        const withoutBoard = renderHook({ state: { groupDraft: flagged, activeGroupDraftId: 'g1', groupImportText: importText({ id: 'z', name: 'Z', teamIds: ['t9'] }) } });
        withoutBoard.result.importGroupsConfig();
        const replaced = withoutBoard.setterCalls.find(([name]) => name === 'setGroupDraft')[1](flagged);
        assert.equal(Object.hasOwn(replaced.groups[0], 'board'), false, 'an import without a board drops the flag');

        const duplicating = renderHook({ state: { groupDraft: flagged, activeGroupDraftId: 'g1' } });
        duplicating.result.duplicateGroupDraft('g1');
        const duplicated = duplicating.setterCalls.find(([name]) => name === 'setGroupDraft')[1](flagged);
        assert.equal(duplicated.groups[2].board.inheritColumnColours, true);
    } finally {
        global.fetch = previousFetch;
        Object.assign(global, previous);
    }
});

test('the selection effect keeps its body and dependency array', () => {
    const { useTeamGroupSelectionEffect } = loadHooks();
    const run = (props) => {
        const effects = [];
        const calls = [];
        const hooks = loadHooks({ effects });
        function Probe() {
            hooks.useTeamGroupSelectionEffect({ showGroupManage: true, groupDraft: DRAFT, activeGroupDraftId: 'g2', firstRunConfigurationActive: false, firstRunConfigurationTargetGroupId: null, setActiveGroupDraftId: (value) => calls.push(value), ...props });
            return null;
        }
        renderToString(React.createElement(Probe));
        assert.equal(effects.length, 1);
        effects[0].fn();
        return { calls, deps: effects[0].deps };
    };
    assert.equal(typeof useTeamGroupSelectionEffect, 'function');
    assert.deepEqual(run({}).calls, []);
    assert.deepEqual(run({ activeGroupDraftId: 'missing' }).calls, ['g1']);
    assert.deepEqual(run({ groupDraft: { ...DRAFT, groups: [] } }).calls, [null]);
    assert.deepEqual(run({ showGroupManage: false, activeGroupDraftId: 'missing' }).calls, []);
    assert.deepEqual(run({ groupDraft: null, activeGroupDraftId: 'missing' }).calls, []);
    assert.deepEqual(run({ activeGroupDraftId: 'missing', firstRunConfigurationActive: true, firstRunConfigurationTargetGroupId: 'new-draft' }).calls, [], 'a pending first-run target keeps the selection');
    assert.deepEqual(run({ activeGroupDraftId: 'missing', firstRunConfigurationActive: true, firstRunConfigurationTargetGroupId: 'g2' }).calls, ['g1']);
    assert.deepEqual(run({}).deps, [true, DRAFT, 'g2', false, null]);
});

test('the search and label effects layers keep their clamps, cleanups and dependency arrays', () => {
    const effects = [];
    const calls = [];
    const record = (name) => (...args) => calls.push([name, ...args]);
    const hooks = loadHooks({ effects });
    function Probe() {
        hooks.useTeamGroupSearchEffects({
            BACKEND_URL: 'x', adHocEpicSearchIndex: 4, adHocEpicSearchQuery: '', componentSearchIndex: 5, componentSearchQuery: '',
            excludedEpicSearchIndex: 0, excludedEpicSearchQuery: '', filteredAdHocEpicSearchResults: [{}], filteredComponentSearchResults: [{}, {}],
            filteredExcludedEpicSearchResults: [], groupManageTab: 'teams', setAdHocEpicSearchIndex: record('setAdHocEpicSearchIndex'),
            setAdHocEpicSearchLoading: record('setAdHocEpicSearchLoading'), setAdHocEpicSearchResults: record('setAdHocEpicSearchResults'),
            setComponentSearchIndex: record('setComponentSearchIndex'), setComponentSearchLoading: record('setComponentSearchLoading'),
            setComponentSearchResults: record('setComponentSearchResults'), setExcludedEpicSearchIndex: record('setExcludedEpicSearchIndex'),
            setExcludedEpicSearchLoading: record('setExcludedEpicSearchLoading'), setExcludedEpicSearchResults: record('setExcludedEpicSearchResults'),
            showGroupManage: true,
        });
        hooks.useTeamGroupLabelEffects({
            activeGroupDraft: { id: 'g1' }, activeTeamAvailabilityKey: 'a', activeTeamResultsLimited: [{ canAdd: false }, { canAdd: true }],
            labelSearchDebounceRef: debounceRef, setTeamSearchIndex: record('setTeamSearchIndex'),
        });
        return null;
    }
    const debounceRef = { current: { k: 7 } };
    const cleared = [];
    const previousWindow = global.window;
    global.window = { clearTimeout: (id) => cleared.push(id) };
    renderToString(React.createElement(Probe));
    assert.equal(effects.length, 8, 'six search effects plus two label effects');
    const cleanups = effects.map((effect) => effect.fn());
    global.window = previousWindow;
    assert.deepEqual(calls.filter(([name]) => /Results$|Loading$/.test(name)).map(([name]) => name),
        ['setComponentSearchResults', 'setComponentSearchLoading', 'setExcludedEpicSearchResults', 'setExcludedEpicSearchLoading', 'setAdHocEpicSearchResults', 'setAdHocEpicSearchLoading'],
        'empty queries clear results and loading for the three searches in order');
    assert.deepEqual(calls.filter(([name]) => /Index$/.test(name) && name !== 'setTeamSearchIndex'), [['setComponentSearchIndex', 0], ['setExcludedEpicSearchIndex', 0], ['setAdHocEpicSearchIndex', 0]], 'out-of-range indexes clamp to zero');
    assert.equal(calls.some(([name]) => name === 'setTeamSearchIndex'), true);
    assert.equal(typeof cleanups[6], 'function', 'the label layer keeps its unmount cleanup');
    global.window = { clearTimeout: (id) => cleared.push(id) };
    cleanups[6]();
    global.window = previousWindow;
    assert.deepEqual(cleared, [7]);
    assert.deepEqual(debounceRef.current, {}, 'unmount drops the pending label search timers');
    assert.deepEqual(effects.map((effect) => effect.deps), [[true, 'teams', ''], [true, 'teams', ''], [true, 'teams', ''], [2], [0], [1], [], [2, 'a', { id: 'g1' }]]);
});
