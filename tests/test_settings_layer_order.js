const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Layer-order and getter pins for the ST5 call sites in dashboard.jsx (R4a-R4c). Lint and bundling accept every
// order that has no render-time TDZ, so the order that preserves effect order (and the phase of each getter)
// is pinned here as text, the same way test_use_first_run_configuration.js pins its layers.
const dashboard = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
const at = (needle, from = 0) => {
    const index = dashboard.indexOf(needle, from);
    assert.notStrictEqual(index, -1, `Expected dashboard to contain ${needle}`);
    return index;
};
const exportsOf = (file, fn) => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/src/settings', file), 'utf8');
    const start = source.indexOf(`export function ${fn}(`);
    const returnStart = source.indexOf('    return {\n', start);
    return source.slice(returnStart + '    return {\n'.length, source.indexOf('\n    };', returnStart)).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
};

test('call order: state layers first, permissions before the gate hook, save hook then modal hook before onboarding', () => {
    const modalState = at('} = useSettingsModalState();');
    const permissions = at('} = useSettingsPermissions({');
    const gate = at('= useAdminSettingsGate({');
    const saveState = at('} = useSharedConfigSaveState();');
    const firstSection = at('} = usePriorityWeightsSettings({');
    const teamGroups = at('} = useTeamGroupSettings({');
    const epm = at('} = useEpmSettings({');
    const save = at('} = useSharedConfigSave({');
    const modal = at('} = useSettingsModal({');
    const onboarding = at('const onboarding = useOnboardingController({');
    assert.ok(modalState < permissions, 'permissions read showGroupManage and groupManageTab while rendering (useAdminAccessSettings)');
    assert.ok(permissions < gate, 'the access hook keeps its effect before the gate hook effect');
    assert.ok(saveState < firstSection, 'the revision refs and board fences feed every section hook');
    assert.ok(teamGroups < save && epm < save, 'the save hook reads the Team Groups and EPM outputs while rendering');
    assert.ok(save < modal && modal < onboarding, 'modal functions read the save hook outputs while rendering and feed useOnboardingController');
    assert.ok(modal - save < 6000, 'the modal hook call follows the save hook call directly');
});

test('effects layers sit at their original positions: auto-open, hotkey and tab guards cross no unmoved effect', () => {
    const autoOpen = at('useSettingsAutoOpenEffect({');
    const abortSprint = at('}, [abortSprintFetches]);');
    const openEffect = at('const nextGroupDraft = pendingDraft ? {');
    const hotkey = at('useSettingsHotkeyEffect({');
    const epmProjectsEffects = at('useEpmSettingsProjectsEffects({');
    const jiraSearch = at('useJiraProjectSearchEffects({');
    const teamSearch = at('useTeamGroupSearchEffects({');
    const jiraCatalog = at('useJiraProjectCatalogEffects({');
    const capacityEffects = at('useCapacityMappingEffects({');
    const tabGuards = at('useSettingsTabGuardEffects({');
    const labels = at('useTeamGroupLabelEffects({');
    assert.ok(abortSprint < autoOpen && autoOpen < openEffect, 'auto-open stays right before the modal-open effect');
    assert.ok(epmProjectsEffects < hotkey && hotkey < jiraSearch, 'the hotkey layer follows the save hook and precedes the Jira project search effects');
    assert.ok(jiraSearch < teamSearch && teamSearch < jiraCatalog && jiraCatalog < capacityEffects && capacityEffects < tabGuards && tabGuards < labels, 'tab guards sit between the capacity effects and the label effects');
    assert.equal(/\buseEffect\(/.test(dashboard.slice(hotkey, jiraSearch)), false);
    assert.equal(/\buseEffect\(/.test(dashboard.slice(capacityEffects, labels)), false);
    assert.equal(/\buseEffect\(/.test(dashboard.slice(abortSprint, openEffect)) && dashboard.slice(abortSprint, autoOpen).includes('useEffect('), false);
});

test('every output read before its layer is declared is an arrow (deferred) read: gate opener, first-run getters, save-hook getters', () => {
    const layers = [
        ['useSettingsModalState', 'settings/useSettingsModalState.js', '} = useSettingsModalState();', 'useSettingsModalState'],
        ['useSettingsPermissions', 'settings/useSettingsPermissions.js', '} = useSettingsPermissions({', 'useSettingsPermissions'],
        ['useSharedConfigSaveState', 'settings/useSharedConfigSave.js', '} = useSharedConfigSaveState();', 'useSharedConfigSaveState'],
        ['useSharedConfigSave', 'settings/useSharedConfigSave.js', '} = useSharedConfigSave({', 'useSharedConfigSave'],
        ['useSettingsModal', 'settings/useSettingsModalState.js', '} = useSettingsModal({', 'useSettingsModal'],
    ];
    for (const [label, file, marker, fn] of layers) {
        const markerIndex = at(marker);
        const callIndex = dashboard.lastIndexOf('\n            const {\n', markerIndex);
        assert.ok(callIndex !== -1 && markerIndex - callIndex < 4000, `${label}: destructure start`);
        const names = exportsOf(file.replace('settings/', ''), fn);
        assert.ok(names.length > 0, label);
        for (const name of names) {
            const pattern = new RegExp(`\\b${name}\\b`, 'g');
            for (const match of dashboard.slice(0, callIndex).matchAll(pattern)) {
                const lineStart = dashboard.lastIndexOf('\n', match.index) + 1;
                const line = dashboard.slice(lineStart, dashboard.indexOf('\n', match.index));
                // The only permitted early mentions: an arrow created for a later binding (deferred), or the layer's own destructure list.
                assert.ok(/=>/.test(line.slice(0, line.indexOf(name) + name.length)), `${label}: ${name} is read at "${line.trim()}" before its layer`);
            }
        }
    }
});

test('getter contract: App creates arrows only and never calls one; each getter is passed once per consumer', () => {
    assert.equal(/\b(?:getCloseGroupManage|getSaveAllSettings|getActiveDepartmentSettingsTab|getLoadConfig|getLoadSprints|getTeamOptions)\(/.test(dashboard.replace(/\/\/.*$/gm, '')), false, 'the dashboard never reads a getter');
    const pairs = [
        ['getCloseGroupManage: () => closeGroupManage,', 2],
        ['getSaveAllSettings: () => saveAllSettings,', 1],
        ['getActiveDepartmentSettingsTab: () => activeDepartmentSettingsTab,', 1],
        ['getLoadConfig: () => loadConfig,', 1],
        ['getLoadSprints: () => loadSprints,', 1],
    ];
    for (const [needle, count] of pairs) assert.equal(dashboard.split(needle).length - 1, count, needle);
    // No latest-value ref bridges a cycle.
    assert.equal(/Ref\.current = (?:closeGroupManage|saveAllSettings|loadConfig|loadSprints|requestCloseGroupManage)\b/.test(dashboard), false);
    // loadConfig and the save functions stay per-render closures.
    assert.equal(/(?:loadConfig|saveAllSettings|closeGroupManage) = React\.use(?:Callback|Memo)\(/.test(dashboard), false);
});

test('the gears stay in the dashboard header: the Settings launcher keeps its onboarding target and ref, and the EPM gear its handler', () => {
    assert.ok(dashboard.includes('ref={groupManageButtonRef}'));
    assert.ok(dashboard.includes('data-onboarding-target="settings-launcher"'));
    assert.ok(dashboard.includes("openGroupManage(configurationTourRequested ? 'teams' : preferredSettingsTab);"));
    assert.ok(dashboard.includes('onClick={openEpmSettingsTab}'));
});

test('moved cells and functions are gone from the dashboard (one owner each)', () => {
    for (const gone of [
        'const [showGroupManage, setShowGroupManage] = useState(', 'const [groupManageTab, setGroupManageTab] = useState(', 'const [groupTesting, setGroupTesting] = useState(',
        'const openGroupManage =', 'const closeGroupManage =', 'const requestCloseGroupManage =', 'const discardGroupDraftChanges =', 'const settingsModalAllTabs =',
        'const saveGroupsConfig =', 'const saveAllSettingsOnce =', 'const saveAllSettings =', 'const keepMineOnGroupsConfigConflict =', 'const useLatestWorkspaceConfig =',
        'const isGroupDraftDirty =', 'const saveBlockedReason =', 'const groupConfigValidationErrors =', 'const buildSettingsSaveOutcome =',
        'const commitSharedConfigRevision =', 'const settingsSaveInFlightRef', 'const [userCanEditSettings,', 'const groupManageButtonRef =',
    ]) assert.equal(dashboard.includes(gone), false, gone);
});
