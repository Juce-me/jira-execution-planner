const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

// Server-render probe for useEpmSettings (ST2 R4a): the single state-plus-behavior hook and its four effects
// layers. A server render cannot run state updates, so the hook is bundled against a thin React wrapper that
// (a) seeds named useState/useRef values and (b) records setter calls; effects do not run in a server render.
const hookPath = path.join(__dirname, '../frontend/src/settings/useEpmSettings.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const mainSource = hookSource.slice(hookSource.indexOf('export function useEpmSettings('), hookSource.indexOf('export function useEpmLabelMenuEffects('));
const STATE_NAMES = [...mainSource.matchAll(/const \[(\w+), (\w+)\] = (?:React\.)?useState\(/g)].map((match) => [match[1], match[2]]);
const REF_NAMES = [...mainSource.matchAll(/const (\w+) = (?:React\.)?useRef\(/g)].map((match) => match[1]);

const INPUT_NAMES = [
    'BACKEND_URL', 'canEditEpmConfiguration', 'getEpmViewActions', 'labelSearchIndex', 'labelSearchOpen',
    'labelSearchQuery', 'labelSearchRequestIdRef', 'labelSearchResults', 'setGroupDraftError', 'setGroupManageTab',
    'setLabelSearchIndex', 'setLabelSearchLoading', 'setLabelSearchOpen', 'setLabelSearchQuery',
    'setLabelSearchResults', 'setShowGroupManage', 'trackSettingsAction', 'trackSortChanged',
];

const RETURN_NAMES = [
    'epmConfigDraft', 'epmConfigDraftRef', 'epmConfigDraftGenerationRef', 'setEpmConfigDraft', 'epmConfigLoading',
    'setEpmConfigLoading', 'epmConfigSaving', 'epmConfigLoaded', 'epmSettingsProjects', 'epmSettingsProjectsLoading',
    'epmSettingsProjectsError', 'epmSettingsProjectsLoaded', 'setEpmSettingsProjectsLoaded',
    'epmSettingsProjectsLoadedAt', 'setEpmSettingsProjectsLoadedAt', 'epmSettingsProjectsFetchMeta',
    'setEpmSettingsProjectsFetchMeta', 'epmSettingsProjectsRefreshing', 'removedEpmProjectIds',
    'setRemovedEpmProjectIds', 'epmSettingsProjectSort', 'epmSettingsProjectView', 'setEpmSettingsProjectView',
    'epmSettingsTab', 'setEpmSettingsTab', 'epmLabelShowAll', 'setEpmLabelShowAll', 'epmLabelChanging',
    'setEpmLabelChanging', 'epmLabelMenuAnchor', 'setEpmLabelMenuAnchor', 'epmLabelMenuInputRef',
    'epmConfigBaselineRef', 'epmScopeMeta', 'setEpmScopeMeta', 'setEpmRootGoals', 'epmSubGoals',
    'epmRootGoalsLoading', 'setEpmRootGoalsLoading', 'epmSubGoalsLoading', 'epmRootGoalsError',
    'setEpmRootGoalsError', 'epmSubGoalsError', 'epmRootGoalQuery', 'setEpmRootGoalQuery', 'epmSubGoalQuery',
    'setEpmSubGoalQuery', 'setEpmRootGoalOpen', 'setEpmSubGoalOpen', 'setEpmRootGoalIndex', 'setEpmSubGoalIndex',
    'epmSettingsProjectsCacheRef', 'loadEpmConfig', 'loadEpmScopeMeta', 'loadEpmGoals',
    'ensureEpmSettingsProjectsLoaded', 'saveEpmConfig', 'updateEpmLabelPrefixDraft', 'updateEpmProjectDraft',
    'getEpmLabelRowKey', 'getEpmLabelSearchResults', 'addCustomEpmProjectDraft', 'removeEpmProjectDraft',
    'deleteEpmProjectRow', 'loadEpmProjectLabels', 'requestEpmLabelFocus', 'registerEpmLabelInput',
    'selectEpmProjectLabel', 'openEpmLabelMenu', 'handleEpmLabelSearchKeyDown', 'loadEpmSubGoalsForRoot',
    'selectEpmRootGoal', 'clearEpmRootGoal', 'clearEpmSubGoal', 'selectEpmSubGoal', 'normalizeEpmConfigDraft',
    'applySavedEpmConfig', 'filteredEpmRootGoals', 'filteredEpmSubGoals', 'selectedEpmRootGoal',
    'selectedEpmSubGoals', 'visibleEpmRootGoals', 'visibleEpmSubGoals', 'activeEpmRootGoalIndex',
    'activeEpmSubGoalIndex', 'showEpmRootGoalResults', 'showEpmSubGoalResults', 'handleEpmRootGoalSearchKeyDown',
    'handleEpmSubGoalSearchKeyDown', 'isEpmConfigDirty', 'hasSavedEpmScope', 'savedEpmSubGoalKeys',
    'savedEpmRootGoalKey', 'epmProjectPrerequisites', 'canLoadEpmProjects', 'epmSettingsProjectsCacheKey',
    'epmSettingsProjectRows', 'openEpmSettingsTab', 'focusEpmScopeField', 'handleEpmSettingsTabKeyDown',
    'setTrackedEpmSettingsProjectSort',
];

function loadHooks({ state = {}, ref = {}, setterCalls = [] } = {}) {
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
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => (id === 'react' ? shimmedReact : require(id)));
    return module.exports;
}

function appInputs(overrides = {}) {
    const calls = [];
    const record = (name) => (...args) => { calls.push([name, ...args]); };
    const inputs = {
        BACKEND_URL: 'http://example.test',
        canEditEpmConfiguration: true,
        getEpmViewActions: () => ({ refreshEpmProjects: record('refreshEpmProjects'), setEpmProjects: record('setEpmProjects'), setEpmProjectsError: record('setEpmProjectsError') }),
        labelSearchIndex: {},
        labelSearchOpen: {},
        labelSearchQuery: {},
        labelSearchRequestIdRef: { current: {} },
        labelSearchResults: {},
        setGroupDraftError: record('setGroupDraftError'),
        setGroupManageTab: record('setGroupManageTab'),
        setLabelSearchIndex: record('setLabelSearchIndex'),
        setLabelSearchLoading: record('setLabelSearchLoading'),
        setLabelSearchOpen: record('setLabelSearchOpen'),
        setLabelSearchQuery: record('setLabelSearchQuery'),
        setLabelSearchResults: record('setLabelSearchResults'),
        setShowGroupManage: record('setShowGroupManage'),
        trackSettingsAction: record('trackSettingsAction'),
        trackSortChanged: record('trackSortChanged'),
        ...overrides,
    };
    return { inputs, calls };
}

function renderHook({ state, ref, overrides } = {}) {
    const setterCalls = [];
    const { useEpmSettings } = loadHooks({ state, ref, setterCalls });
    const { inputs, calls } = appInputs(overrides);
    let result;
    function Probe() {
        result = useEpmSettings(inputs);
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
    return { result, inputs, calls, setterCalls };
}

const SAVED_DRAFT = {
    version: 2,
    labelPrefix: 'rnd_project_',
    scope: { rootGoalKey: 'GOAL-1', subGoalKeys: ['SUB-1'] },
    projects: { p1: { id: 'p1', name: 'Alpha', label: 'rnd_project_alpha', homeProjectId: 'p1' } },
};

test('the hook takes the 18 documented inputs and returns its 101 names in order', () => {
    assert.equal(INPUT_NAMES.length, 18);
    assert.equal(RETURN_NAMES.length, 101);
    assert.equal(STATE_NAMES.length, 31);
    const { result, inputs } = renderHook();
    assert.deepEqual(Object.keys(inputs), INPUT_NAMES);
    assert.deepEqual(Object.keys(result), RETURN_NAMES);
});

test('a fresh hook holds the empty private draft and clean settings defaults', () => {
    const { result } = renderHook();
    assert.deepEqual(result.epmConfigDraft, { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} });
    assert.equal(result.epmConfigDraftRef.current, result.epmConfigDraft);
    assert.equal(result.epmConfigDraftGenerationRef.current, 0);
    assert.equal(result.epmConfigBaselineRef.current, JSON.stringify(result.epmConfigDraft));
    assert.equal(result.epmSettingsTab, 'scope');
    assert.equal(result.epmSettingsProjectSort, 'status');
    assert.equal(result.epmSettingsProjectView, 'current');
    assert.equal(result.epmConfigLoaded, false);
    assert.equal(result.epmConfigLoading, false);
    assert.equal(result.epmConfigSaving, false);
    assert.equal(result.removedEpmProjectIds.size, 0);
    assert.deepEqual(result.epmSettingsProjects, []);
    assert.equal(result.isEpmConfigDirty, false);
    assert.equal(result.hasSavedEpmScope, false);
    assert.equal(result.canLoadEpmProjects, false);
    assert.ok(result.epmProjectPrerequisites.length > 0);
    assert.deepEqual(result.epmSettingsProjectRows, []);
});

test('every function returned by the hook is callable', () => {
    const { result } = renderHook();
    const values = new Set(['epmConfigDraft', 'epmConfigLoading', 'epmConfigSaving', 'epmConfigLoaded', 'epmSettingsProjects', 'epmSettingsProjectsLoading', 'epmSettingsProjectsError', 'epmSettingsProjectsLoaded', 'epmSettingsProjectsLoadedAt', 'epmSettingsProjectsFetchMeta', 'epmSettingsProjectsRefreshing', 'removedEpmProjectIds', 'epmSettingsProjectSort', 'epmSettingsProjectView', 'epmSettingsTab', 'epmLabelShowAll', 'epmLabelChanging', 'epmLabelMenuAnchor', 'epmScopeMeta', 'epmRootGoals', 'epmSubGoals', 'epmRootGoalsLoading', 'epmSubGoalsLoading', 'epmRootGoalsError', 'epmSubGoalsError', 'epmRootGoalQuery', 'epmSubGoalQuery', 'epmRootGoalOpen', 'epmSubGoalOpen', 'epmRootGoalIndex', 'epmSubGoalIndex', 'isEpmConfigDirty', 'hasSavedEpmScope', 'savedEpmSubGoalKeys', 'savedEpmRootGoalKey', 'epmProjectPrerequisites', 'canLoadEpmProjects', 'epmSettingsProjectsCacheKey', 'epmSettingsProjectRows', 'filteredEpmRootGoals', 'filteredEpmSubGoals', 'selectedEpmRootGoal', 'selectedEpmSubGoals', 'visibleEpmRootGoals', 'visibleEpmSubGoals', 'activeEpmRootGoalIndex', 'activeEpmSubGoalIndex', 'showEpmRootGoalResults', 'showEpmSubGoalResults']);
    for (const name of RETURN_NAMES.filter((key) => !values.has(key) && !/Ref$/.test(key))) {
        assert.equal(typeof result[name], 'function', name);
    }
    for (const name of RETURN_NAMES.filter((key) => /Ref$/.test(key))) assert.equal(typeof result[name], 'object', name);
});

test('derived values follow the draft and the saved baseline', () => {
    const projects = [{ id: 'p1', homeProjectId: 'p1', name: 'Alpha home', stateLabel: 'On track', stateValue: 'on-track' }];
    const clean = renderHook({ state: { epmConfigDraft: SAVED_DRAFT, epmSettingsProjects: projects }, ref: { epmConfigBaselineRef: JSON.stringify(SAVED_DRAFT) } }).result;
    assert.equal(clean.isEpmConfigDirty, false);
    assert.equal(clean.hasSavedEpmScope, true);
    assert.equal(clean.savedEpmRootGoalKey, 'GOAL-1');
    assert.deepEqual(clean.savedEpmSubGoalKeys, ['SUB-1']);
    assert.equal(clean.canLoadEpmProjects, true);
    assert.deepEqual(clean.epmProjectPrerequisites, []);
    assert.equal(clean.epmSettingsProjectRows.length, 1);
    assert.equal(clean.epmSettingsProjectRows[0].id, 'p1');
    assert.equal(clean.epmSettingsProjectRows[0].homeName, 'Alpha home');
    assert.equal(clean.epmSettingsProjectRows[0].label, 'rnd_project_alpha');
    const dirty = renderHook({ state: { epmConfigDraft: SAVED_DRAFT } }).result;
    assert.equal(dirty.isEpmConfigDirty, true);
    assert.equal(dirty.hasSavedEpmScope, false);
    const removed = renderHook({ state: { epmConfigDraft: SAVED_DRAFT, epmSettingsProjects: projects, removedEpmProjectIds: new Set(['p1']) } }).result;
    assert.deepEqual(removed.epmSettingsProjectRows, []);
});

test('normalization uppercases scope keys, trims the prefix and drops empty custom rows', () => {
    const { result } = renderHook();
    const normalized = result.normalizeEpmConfigDraft({
        labelPrefix: ' rnd_project_ ',
        scope: { rootGoalKey: ' goal-9 ', subGoalKeys: ['sub-9'] },
        projects: { empty: { id: 'draft-1', name: '', label: '', homeProjectId: null }, kept: { id: 'p2', name: 'Beta', label: 'rnd_project_beta' } },
    });
    assert.equal(normalized.version, 2);
    assert.equal(normalized.labelPrefix, 'rnd_project_');
    assert.equal(normalized.scope.rootGoalKey, 'GOAL-9');
    assert.deepEqual(normalized.scope.subGoalKeys, ['SUB-9']);
    assert.deepEqual(Object.keys(normalized.projects), ['p2']);
    assert.equal(result.getEpmLabelRowKey('p2'), 'epm-project::p2');
});

test('handlers call their inputs and their own state setters: open tab, tracked sort, tab keyboard navigation', () => {
    const previousWindow = global.window;
    const previousDocument = global.document;
    global.window = { requestAnimationFrame: (callback) => callback() };
    global.document = { getElementById: () => null };
    try {
        const allowed = renderHook();
        allowed.result.openEpmSettingsTab();
        assert.deepEqual(allowed.calls.map(([name]) => name), ['trackSettingsAction', 'setShowGroupManage', 'setGroupManageTab']);
        assert.deepEqual(allowed.calls[0], ['trackSettingsAction', 'epm', 'open', { source_surface: 'epm' }]);
        assert.deepEqual(allowed.calls[2], ['setGroupManageTab', 'epm']);
        assert.deepEqual(allowed.setterCalls.at(-1), ['setEpmSettingsTab', 'projects']);
        assert.ok(allowed.setterCalls.some(([name, value]) => name === 'setEpmSettingsProjects' && Array.isArray(value) && value.length === 0), 'opening the tab resets the cached project rows');
        const denied = renderHook({ overrides: { canEditEpmConfiguration: false } });
        denied.result.openEpmSettingsTab();
        assert.deepEqual(denied.calls, []);
        assert.deepEqual(denied.setterCalls, []);
        const sorted = renderHook();
        sorted.result.setTrackedEpmSettingsProjectSort('name');
        assert.deepEqual(sorted.calls, [['trackSortChanged', 'epm_settings_projects', 'name', { sort_direction: 'asc', source_surface: 'epm_settings' }]]);
        assert.deepEqual(sorted.setterCalls, [['setEpmSettingsProjectSort', 'name']]);
        const keyed = renderHook();
        keyed.result.handleEpmSettingsTabKeyDown({ key: 'End', preventDefault() {} });
        keyed.result.handleEpmSettingsTabKeyDown({ key: 'Home', preventDefault() {} });
        keyed.result.handleEpmSettingsTabKeyDown({ key: 'ArrowRight', preventDefault() {} });
        assert.deepEqual(keyed.setterCalls.map(([, value]) => value), ['projects', 'scope', 'projects']);
    } finally {
        global.window = previousWindow;
        global.document = previousDocument;
    }
});

test('saveEpmConfig reaches the EPM view through the handler-only getter after saving', async () => {
    const previousFetch = global.fetch;
    const respond = (payload) => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => payload });
    const run = async (savedConfig) => {
        global.fetch = async (url) => respond(String(url).endsWith('/api/auth/csrf') ? { csrfToken: 'token' } : savedConfig);
        const { result, calls } = renderHook({ state: { epmConfigDraft: SAVED_DRAFT } });
        const draftUnchanged = await result.saveEpmConfig();
        return { draftUnchanged, names: calls.map(([name]) => name) };
    };
    try {
        const withScope = await run(SAVED_DRAFT);
        assert.equal(withScope.draftUnchanged, true);
        assert.deepEqual(withScope.names.filter((name) => /^(refreshEpmProjects|setEpmProjects|setEpmProjectsError)$/.test(name)), ['refreshEpmProjects']);
        const withoutScope = await run({ version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} });
        assert.deepEqual(withoutScope.names.filter((name) => /^(refreshEpmProjects|setEpmProjects|setEpmProjectsError)$/.test(name)), ['setEpmProjects', 'setEpmProjectsError']);
    } finally {
        global.fetch = previousFetch;
    }
});

test('the four effects layers render with the hook outputs', () => {
    const { useEpmSettings, useEpmLabelMenuEffects, useEpmSettingsLoadEffect, useEpmSavedSubGoalsEffect, useEpmSettingsProjectsEffects } = loadHooks();
    const { inputs } = appInputs();
    const noop = () => {};
    function Probe() {
        const h = useEpmSettings(inputs);
        useEpmLabelMenuEffects({
            epmLabelMenuAnchor: h.epmLabelMenuAnchor, epmLabelMenuInputRef: h.epmLabelMenuInputRef, epmSettingsTab: h.epmSettingsTab,
            groupManageTab: 'epm', setEpmLabelMenuAnchor: h.setEpmLabelMenuAnchor, setRemovedEpmProjectIds: h.setRemovedEpmProjectIds, showGroupManage: false,
        });
        useEpmSettingsLoadEffect({
            applySavedEpmConfig: h.applySavedEpmConfig, epmConfigDraft: h.epmConfigDraft, epmConfigDraftGenerationRef: h.epmConfigDraftGenerationRef,
            epmConfigDraftRef: h.epmConfigDraftRef, groupManageTab: 'epm', isEpmConfigDirty: h.isEpmConfigDirty, loadEpmConfig: h.loadEpmConfig,
            loadEpmGoals: h.loadEpmGoals, loadEpmScopeMeta: h.loadEpmScopeMeta, loadEpmSubGoalsForRoot: h.loadEpmSubGoalsForRoot,
            setEpmConfigLoading: h.setEpmConfigLoading, setEpmRootGoalIndex: h.setEpmRootGoalIndex, setEpmRootGoalOpen: h.setEpmRootGoalOpen,
            setEpmRootGoalQuery: h.setEpmRootGoalQuery, setEpmRootGoals: h.setEpmRootGoals, setEpmRootGoalsError: h.setEpmRootGoalsError,
            setEpmRootGoalsLoading: h.setEpmRootGoalsLoading, setEpmScopeMeta: h.setEpmScopeMeta, setEpmSubGoalIndex: h.setEpmSubGoalIndex,
            setEpmSubGoalOpen: h.setEpmSubGoalOpen, setEpmSubGoalQuery: h.setEpmSubGoalQuery, setGroupDraftError: noop, showGroupManage: false,
        });
        useEpmSavedSubGoalsEffect({
            epmConfigLoaded: h.epmConfigLoaded, loadEpmSubGoalsForRoot: h.loadEpmSubGoalsForRoot, savedEpmRootGoalKey: h.savedEpmRootGoalKey,
            savedEpmSubGoalKeys: h.savedEpmSubGoalKeys, selectedView: 'eng', showEpmNavigation: false,
        });
        useEpmSettingsProjectsEffects({
            canLoadEpmProjects: h.canLoadEpmProjects, ensureEpmSettingsProjectsLoaded: h.ensureEpmSettingsProjectsLoaded, epmConfigDraft: h.epmConfigDraft,
            epmSettingsProjectsCacheKey: h.epmSettingsProjectsCacheKey, epmSettingsProjectsCacheRef: h.epmSettingsProjectsCacheRef,
            epmSettingsTab: h.epmSettingsTab, groupManageTab: 'epm', normalizeEpmConfigDraft: h.normalizeEpmConfigDraft,
            setEpmSettingsProjectsFetchMeta: h.setEpmSettingsProjectsFetchMeta, setEpmSettingsProjectsLoaded: h.setEpmSettingsProjectsLoaded,
            setEpmSettingsProjectsLoadedAt: h.setEpmSettingsProjectsLoadedAt, showGroupManage: false,
        });
        return null;
    }
    assert.equal(renderToString(React.createElement(Probe)), '');
});
