const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Scenario planner under the quarterly work configurations: model-aware names, the draft namespace per
// configuration, the Story Points format without a field id, and the admin lock on the mode entry.
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadComponent(file) {
    const code = esbuild.buildSync({
        entryPoints: [path.join(root, file)], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx', '.js': 'jsx' },
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

test('Legacy draft keys are unchanged and new-model keys carry the configuration id', async () => {
    const { buildScenarioDraftScopeKey } = await import('../frontend/src/scenario/scenarioUtils.js');
    assert.equal(buildScenarioDraftScopeKey({ sprintId: 11, groupId: 'g1', workModel: 'legacy', configurationId: 'legacy' }), '11:g1');
    assert.equal(buildScenarioDraftScopeKey({ sprintId: '11', groupId: '', workModel: 'legacy' }), '11:default');
    assert.equal(buildScenarioDraftScopeKey({ sprintId: '', groupId: 'g1', workModel: 'legacy' }), '');
    assert.equal(buildScenarioDraftScopeKey({ sprintId: '22', groupId: 'g1', workModel: 'rnd_2027', configurationId: 'delivery' }), 'delivery:22:g1');
    assert.equal(buildScenarioDraftScopeKey({ sprintId: '22', groupId: '', workModel: 'rnd_2027', configurationId: 'delivery' }), 'delivery:22:default');
    // Without its configuration id a new-model scope has no draft namespace at all.
    assert.equal(buildScenarioDraftScopeKey({ sprintId: '22', groupId: 'g1', workModel: 'rnd_2027', configurationId: '' }), '');
});

test('the no-parent lane is named after the model parent', async () => {
    const { scenarioNoParentLane } = await import('../frontend/src/scenario/scenarioUtils.js');
    assert.equal(scenarioNoParentLane('legacy'), 'No Epic');
    assert.equal(scenarioNoParentLane(undefined), 'No Epic');
    assert.equal(scenarioNoParentLane('rnd_2027'), 'No Initiative');
});

test('parent lanes group new-model Epics by Initiative and keep the Legacy fallback', async () => {
    const { buildScenarioLaneInfo, buildScenarioEpicEdges } = await import('../frontend/src/scenario/scenarioLayout.js');
    const issues = [
        { key: 'PLAN-1', epicKey: 'PLAN-100', epicSummary: 'First initiative', sp: 3 },
        { key: 'PLAN-2', epicKey: null, sp: 1 },
    ];
    const base = {
        scenarioTimelineIssues: issues, scenarioLaneMode: 'epic', scenarioCapacityByTeam: {}, scenarioEpicFocus: null,
        scenarioFocusIssueKeys: new Set(), scenarioExcludedIssueKeys: new Set(), scenarioAssigneeConflicts: { conflicts: new Map() },
    };
    const lane = (noParentLane) => (issue) => issue.epicKey || noParentLane;
    const modern = buildScenarioLaneInfo({ ...base, scenarioLaneForIssue: lane('No Initiative'), noParentLane: 'No Initiative' });
    assert.deepEqual([...modern.keys()].sort(), ['No Initiative', 'PLAN-100']);
    assert.equal(modern.get('PLAN-100').label, 'First initiative');
    assert.equal(modern.get('No Initiative').label, 'No Initiative');
    const legacy = buildScenarioLaneInfo({ ...base, scenarioLaneForIssue: lane('No Epic') });
    assert.equal(legacy.get('No Epic').label, 'No Epic', 'Legacy default stays No Epic');

    const meta = new Map([['PLAN-100', { top: 0, height: 40 }], ['No Initiative', { top: 40, height: 40 }]]);
    const edges = buildScenarioEpicEdges({
        scenarioDependencies: [{ from: 'PLAN-2', to: 'PLAN-1' }], scenarioLaneMeta: { meta }, scenarioLaneMode: 'epic',
        scenarioIssueByKey: new Map(issues.map(issue => [issue.key, issue])), scenarioEpicFocus: null, noParentLane: 'No Initiative',
    });
    assert.deepEqual(edges.map(edge => [edge.fromEpic, edge.toEpic]), [['No Initiative', 'PLAN-100']]);
});

test('the Scenario tooltip formats Story Points from the value, with no field id in the view', async () => {
    const { formatStoryPointsFixed, formatStoryPointsNumberFixed } = await import('../frontend/src/eng/engTaskUtils.js');
    for (const value of [0, 1, 3, 2.5, 0.75, null, undefined, '', 'x']) {
        assert.equal(formatStoryPointsNumberFixed(value), formatStoryPointsFixed({ fields: { customfield_10004: value } }), String(value));
    }
    const view = read('frontend/src/scenario/ScenarioView.jsx');
    assert.doesNotMatch(view, /customfield_/);
    assert.match(view, /formatStoryPointsNumberFixed\(scenarioTooltip\.sp\)/);
    assert.match(view, /\{entityNames\.parent\}/, 'the parent-lane toggle is named by the model');
});

test('the ENG mode control renders no Scenario entry while Scenario is locked', () => {
    const EngModeControl = loadComponent('frontend/src/eng/EngModeControl.jsx').default;
    const props = { activeMode: 'catch-up', isCompletedSprintSelected: false, onChange() {}, selectedSprint: '11' };
    const unlocked = renderToStaticMarkup(React.createElement(EngModeControl, props));
    const locked = renderToStaticMarkup(React.createElement(EngModeControl, { ...props, scenarioAvailable: false }));
    assert.match(unlocked, />Scenario</);
    assert.doesNotMatch(locked, /Scenario/, 'no hidden, disabled or placeholder Scenario button');
    assert.match(locked, />Statistics</);
});

test('the dashboard opens Scenario only on an explicit grant and leaves a locked Scenario', () => {
    const dashboard = read('frontend/src/dashboard.jsx');
    assert.match(dashboard, /scenarioAvailable=\{scenarioPlannerAvailable === true\}/);
    assert.match(dashboard, /showScenario && engWorkspaceConfigured && scenarioPlannerAvailable === true && \(/);
    assert.match(dashboard, /if \(\(isCompletedSprintSelected \|\| scenarioPlannerAvailable === false\) && showScenario\) \{\s*setShowScenario\(false\);/);
});

test('the Access tab renders the Scenario switch with the existing checkbox grammar', () => {
    const AdminAccessSettings = loadComponent('frontend/src/settings/AdminAccessSettings.jsx').default;
    const access = { enabled: true, setEnabled() {} };
    for (const authMode of ['atlassian_oauth']) {
        const html = renderToStaticMarkup(React.createElement(AdminAccessSettings, {
            authMode, adminUserManagementAvailable: true, adminUsers: [], selectedAdminUserIds: [],
            scenarioPlannerAccess: access, canEditScenarioPlannerAccess: true,
        }));
        assert.match(html, /<label class="group-visible-control"><input type="checkbox"[^>]*checked=""[^>]*\/><span>Scenario planner for everyone<\/span><\/label>/);
        assert.match(html, /class="group-visible-helper"/);
    }
    for (const [authMode, directory] of [['basic', true], ['atlassian_oauth', false]]) {
        const unsupported = renderToStaticMarkup(React.createElement(AdminAccessSettings, {
            authMode, adminUserManagementAvailable: directory, adminUsers: [], selectedAdminUserIds: [],
            scenarioPlannerAccess: access, canEditScenarioPlannerAccess: true,
        }));
        assert.equal(unsupported, '');
    }
    const readOnly = renderToStaticMarkup(React.createElement(AdminAccessSettings, {
        authMode: 'atlassian_oauth', adminUserManagementAvailable: true, adminUsers: [], selectedAdminUserIds: [],
        scenarioPlannerAccess: { enabled: false, setEnabled() {} }, canEditScenarioPlannerAccess: false,
    }));
    assert.match(readOnly, /<input type="checkbox" disabled=""[^>]*\/><span>Scenario planner for everyone/);
});
