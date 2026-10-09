const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

function load(file) {
    const entry = file === 'EpicBlock.jsx'
        ? { stdin: { contents: "export { EpicBlock } from './EpicBlock.jsx'; export { StatusColourProvider } from '../issues/StatusColourContext.jsx';", resolveDir: path.join(__dirname, '../frontend/src/eng'), loader: 'jsx' } }
        : { entryPoints: [path.join(__dirname, '../frontend/src/eng', file)] };
    const code = esbuild.buildSync({ ...entry,
        bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}
const noop = () => {};
const ref = () => ({ current: {} });
function props(surface) {
    return { surface, searchActive: true, searchInput: 'synthetic query', setSearchInput: noop, setSearchFocused: noop, searchInputRef: { current: null },
        showEpmNavigation: true, selectedView: 'eng', trackSelectContent: noop, currentDashboardView: () => 'catch_up', setSelectedView: noop,
        showBoard: false, engSprintSelectorState: { ordinarySelectable: true }, boardStrictScope: '', sprintName: 'Synthetic Sprint', selectedSprint: '1',
        sprintsLoading: false, engWorkspaceConfigured: true, getSprintSelectorOptions: () => [{ kind: 'sprint', label: 'Synthetic Sprint', sprint: { id: '1', state: 'active' } }],
        sprintActiveOptionIndex: 0, showSprintDropdown: false, activeControlSurface: surface, closeSprintSelector: noop, setShowSprintDropdown: noop,
        setSprintActiveOptionIndex: noop, sprintSelectorOriginRef: ref(), commitSprintSelectorOption: noop, sprintDropdownRefs: ref(), sprintSearch: '',
        setSprintSearch: noop, sprintOptionDomId: (value) => `sprint-${value}-option`, sprintTriggerRefs: ref(), openSprintSelector: noop, availableSprints: [{ id: '1' }],
        showGroupControl: true, groupDropdownRefs: ref(), showGroupDropdown: false, groupsLoading: false, applyExclusiveDropdownState: noop,
        groupDropdownQuery: '', setGroupDropdownQuery: noop, setShowGroupDropdown: noop, activeGroup: { name: 'Synthetic group' },
        visibleControlGroups: [{ id: 'one' }], filteredControlGroups: [{ id: 'one', name: 'Synthetic group', teamIds: ['one'] }],
        trackFilterChanged: noop, setActiveGroupId: noop, groupsConfig: { source: 'workspace_db' }, groupPreferences: { activeGroupId: 'one' },
        teamDropdownRefs: ref(), showTeamDropdown: false, isAllTeamsSelected: false, tasks: [{}], loading: false, teamDropdownQuery: '',
        setTeamDropdownQuery: noop, setShowTeamDropdown: noop, selectedTeamsLabel: 'Synthetic team', longestTeamOptionLabel: 'Longest synthetic team',
        filteredTeamOptions: [{ id: 'one', name: 'Synthetic team' }], selectedTeamSet: new Set(['one']), toggleTeamSelection: noop };
}
for (const surface of ['main', 'compact']) {
    for (const [name, label, className] of [['SearchControl', 'Search', 'control-search active-filter applied-filter'], ['SprintControl', 'Sprint', 'sprint-dropdown sprint-selector-control'],
        ['GroupControl', 'Group', 'group-control'], ['TeamControl', 'Teams', 'team-dropdown header-filter-dropdown']]) {
        test(`${name} SSR preserves ${surface} root and native control contract`, () => {
            const html = renderToString(React.createElement(load('EngControls.jsx')[name], props(surface)));
            assert.ok(html.includes(label)); assert.ok(html.includes(className));
            assert.ok(html.includes(`data-onboarding-surface="${surface}"`));
            if (name === 'SearchControl') { assert.ok(html.includes('value="synthetic query"')); assert.ok(html.includes('aria-label="Clear search"')); }
            if (name === 'SprintControl') assert.ok(html.includes(`aria-controls="sprint-${surface}-listbox"`));
        });
    }
    test(`open dropdown SSR preserves ${surface} options and selected native checkbox`, () => {
        const values = { ...props(surface), showSprintDropdown: true, showGroupDropdown: true, showTeamDropdown: true };
        const kit = load('EngControls.jsx');
        const sprint = renderToString(React.createElement(kit.SprintControl, values));
        assert.ok(sprint.includes('role="listbox"')); assert.ok(sprint.includes('aria-selected="true"')); assert.ok(sprint.includes('[A] Synthetic Sprint'));
        const group = renderToString(React.createElement(kit.GroupControl, values)); assert.ok(group.includes('My favorite group'));
        const team = renderToString(React.createElement(kit.TeamControl, values)); assert.match(team, /type="checkbox" checked=""/);
    });
}
test('ViewSwitch SSR preserves main shared control and hidden gate', () => {
    const { ViewSwitch } = load('EngControls.jsx');
    assert.match(renderToString(React.createElement(ViewSwitch, props('main'))), /view-mode-control/);
    assert.equal(renderToString(React.createElement(ViewSwitch, { ...props('main'), showEpmNavigation: false })), '');
});
function epicProps() {
    return { epicGroup: { key: 'SYN-1', epic: { summary: 'Synthetic epic', status: { name: 'In Progress' }, priority: { name: 'High' }, assignee: { displayName: 'Synthetic Person' } }, storyPoints: 5, tasks: [] },
        statusTransitionActiveKey: null, priorityTransitionActiveKey: null, projectTrackTransitionActiveKey: null, issueFieldEdits: { activeEditor: null },
        issueFieldEditsEnabled: false, jiraUrl: 'https://jira.example', excludedEpicSet: new Set(), normalizeEpicKey: String, stickyEpicFocusKey: null, epicRefMap: { current: new Map() },
        priorityTransitionEnabled: false, projectTrackTransitionEnabled: false, statusTransitionEnabled: false, renderPriorityIcon: () => null,
        showStats: false, showPlanning: false, isEpicRefreshMode: false, epicRefresh: { epicStates: {}, leavingKeys: new Set() }, selectedTasks: {}, getTeamInfo: () => ({}),
        shouldRenderIssueDependencies: false, storySubtasksByKey: {}, onboardingPreviewSession: false };
}
test('EpicBlock SSR preserves keyed root status/person metadata and fallback branches', () => {
    const { EpicBlock } = load('EpicBlock.jsx');
    const values = epicProps();
    const html = renderToString(React.createElement(EpicBlock, values)).replace(/<!--.*?-->/g, '');
    for (const token of ['data-epic-key="SYN-1"', 'epic-header', 'Synthetic epic', 'Synthetic Person', 'SP: 5.0', 'epic-status-value', 'In Progress']) assert.ok(html.includes(token), token);
    const fallback = renderToString(React.createElement(EpicBlock, { ...values, epicGroup: { key: 'NO_EPIC', tasks: [] } }));
    assert.ok(fallback.includes('No Epic Linked')); assert.ok(fallback.includes('Unassigned')); assert.equal(fallback.includes('epic-status-value'), false);
    const included = renderToString(React.createElement(EpicBlock, { ...values, showPlanning: true, canToggleSharedGroupExcludedCapacity: false, canEditSharedConfiguration: false }));
    assert.match(included, /epic-stat-toggle active/); assert.match(included, /disabled=""/); assert.ok(included.includes('Included'));
});
test('App returns sibling-keyed EpicBlock and keeps the explicit props bag after refresh initialization', () => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    assert.match(source, /<EpicBlock key=\{epicGroup\.key\} epicGroup=\{epicGroup\} \{\.\.\.epicBlockProps\} \/>/);
    assert.ok(source.indexOf('const epicBlockProps =') > source.indexOf('const epicRefresh = useEpicRefresh('));
    for (const name of ['renderEngModeControl', 'renderEpmControls', 'renderPlanningReviewFieldEditor']) assert.ok(source.includes(`const ${name} =`));
    for (const file of ['EngControls.jsx', 'EpicBlock.jsx']) {
        const owner = fs.readFileSync(path.join(__dirname, '../frontend/src/eng', file), 'utf8');
        assert.doesNotMatch(owner, /import[^\n]*dashboard\.jsx|React\.memo|useEffect|useState|useRef/);
    }
});

test('EpicBlock status inherits its existing provider and keeps status off DOM', () => {
    const { EpicBlock, StatusColourProvider } = load('EpicBlock.jsx');
    const html = renderToString(React.createElement(StatusColourProvider, {
        enabled: true, columns: [{ id: 'doing', name: 'Doing', colour: '#597ef7', statuses: ['In Progress'] }],
    }, React.createElement(EpicBlock, epicProps())));
    assert.match(html, /epic-status-value[^>]*style="background:color-mix\(in srgb, #597ef7 28%, var\(--bg-secondary\)\);color:var\(--text-primary\)"/);
    assert.doesNotMatch(html, / status="In Progress"/);
});

// Frozen from the accepted pre-move lexical ledger, including old renderer arguments.
const expectedProps = {
    "SearchControl": [
        "extraClassName",
        "searchActive",
        "searchInput",
        "searchInputRef",
        "setSearchFocused",
        "setSearchInput",
        "surface"
    ],
    "ViewSwitch": [
        "currentDashboardView",
        "selectedView",
        "setSelectedView",
        "showEpmNavigation",
        "trackSelectContent"
    ],
    "SprintControl": [
        "activeControlSurface",
        "availableSprints",
        "boardStrictScope",
        "closeSprintSelector",
        "commitSprintSelectorOption",
        "engSprintSelectorState",
        "engWorkspaceConfigured",
        "getSprintSelectorOptions",
        "openSprintSelector",
        "selectedSprint",
        "selectedView",
        "setShowSprintDropdown",
        "setSprintActiveOptionIndex",
        "setSprintSearch",
        "showBoard",
        "showSprintDropdown",
        "sprintActiveOptionIndex",
        "sprintDropdownRefs",
        "sprintName",
        "sprintOptionDomId",
        "sprintSearch",
        "sprintSelectorOriginRef",
        "sprintTriggerRefs",
        "sprintsLoading",
        "surface"
    ],
    "GroupControl": [
        "activeControlSurface",
        "activeGroup",
        "applyExclusiveDropdownState",
        "currentDashboardView",
        "filteredControlGroups",
        "groupDropdownQuery",
        "groupDropdownRefs",
        "groupPreferences",
        "groupsConfig",
        "groupsLoading",
        "setActiveGroupId",
        "setGroupDropdownQuery",
        "setShowGroupDropdown",
        "showGroupControl",
        "showGroupDropdown",
        "surface",
        "trackFilterChanged",
        "visibleControlGroups"
    ],
    "TeamControl": [
        "activeControlSurface",
        "applyExclusiveDropdownState",
        "filteredTeamOptions",
        "isAllTeamsSelected",
        "loading",
        "longestTeamOptionLabel",
        "selectedTeamSet",
        "selectedTeamsLabel",
        "setShowTeamDropdown",
        "setTeamDropdownQuery",
        "showTeamDropdown",
        "surface",
        "tasks",
        "teamDropdownQuery",
        "teamDropdownRefs",
        "toggleTeamSelection"
    ],
    "EpicBlock": [
        "canEditSharedConfiguration",
        "canToggleSharedGroupExcludedCapacity",
        "closePriorityControl",
        "closeProjectTrackControl",
        "closeSingleIssueStatusControl",
        "epicGroup",
        "epicRefMap",
        "epicRefresh",
        "excludedEpicSet",
        "getTeamInfo",
        "handleOnboardingPreviewLifecycleChange",
        "handleSubmitStatusTransition",
        "isEpicRefreshMode",
        "isGroupDraftDirty",
        "issueDependencyContext",
        "issueFieldEdits",
        "issueFieldEditsEnabled",
        "jiraUrl",
        "normalizeEpicKey",
        "onboardingPreviewSession",
        "openPriorityControl",
        "openProjectTrackControl",
        "openSingleIssueStatusControl",
        "pendingPriorityIssueKeys",
        "pendingProjectTrackIssueKeys",
        "pendingStatusIssueKeys",
        "prefetchSingleIssueStatusOptions",
        "priorityError",
        "priorityOptions",
        "priorityOptionsLoading",
        "priorityResult",
        "prioritySubmitting",
        "priorityTransitionActiveKey",
        "priorityTransitionEnabled",
        "projectTrackError",
        "projectTrackOptions",
        "projectTrackOptionsLoading",
        "projectTrackResult",
        "projectTrackSubmitting",
        "projectTrackTransitionActiveKey",
        "projectTrackTransitionEnabled",
        "removeTask",
        "renderPriorityIcon",
        "retryStorySubtasks",
        "selectedTasks",
        "shouldRenderIssueDependencies",
        "showGroupManage",
        "showPlanning",
        "showStats",
        "statusTransitionActiveKey",
        "statusTransitionEnabled",
        "statusTransitionSourceSurface",
        "statusTransitionSubmitting",
        "stickyEpicFocusKey",
        "storySubtasksByKey",
        "submitPriorityChange",
        "submitProjectTrackChange",
        "toggleSharedGroupExcludedCapacityEpic",
        "toggleStorySubtasks",
        "toggleTaskSelection",
        "transitionError",
        "transitionErrorCode",
        "transitionOptions",
        "transitionOptionsLoading",
        "transitionResult"
    ]
};
test('all six component signatures preserve every explicit closure binding', () => {
    for (const [name, expected] of Object.entries(expectedProps)) {
        const file = name === 'EpicBlock' ? 'EpicBlock.jsx' : 'EngControls.jsx';
        const source = fs.readFileSync(path.join(__dirname, '../frontend/src/eng', file), 'utf8');
        const signature = source.slice(source.indexOf(`export function ${name}({`) + `export function ${name}({`.length);
        const actual = signature.slice(0, signature.indexOf('})')).split(',').map(value => value.split('=')[0].trim()).filter(Boolean).sort();
        assert.deepEqual(actual, expected, name);
    }
});
