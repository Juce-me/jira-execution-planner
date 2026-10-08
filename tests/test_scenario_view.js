// The layout oracle was generated under TZ=UTC and parseScenarioDate builds local-midnight Dates, so the
// zone is pinned before any Date is constructed.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scenarioDir = path.join(__dirname, '../frontend/src/scenario');
const viewPath = path.join(scenarioDir, 'ScenarioView.jsx');
const dashboardPath = path.join(__dirname, '../frontend/src/dashboard.jsx');
const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures/scenario-layout-oracle-example-sanitized.json'), 'utf8'));

const VIEW_PROP_NAMES = ['scenario', 'scenarioState', 'selectedSprint', 'normalizeEpicKey', 'excludedEpicSet'];

// ------------------------------------------------------------------ fixture decoding (mirrors tests/test_scenario_layout.js)
const fnCache = new Map();
function decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    if ('$undefined' in v) return undefined;
    if ('$number' in v) return { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }[v.$number];
    if ('$date' in v) return new Date(v.$date === 'Invalid Date' ? NaN : v.$date);
    if ('$map' in v) return new Map(v.$map.map(([k, x]) => [decode(k), decode(x)]));
    if ('$set' in v) return new Set(v.$set.map(decode));
    if ('$frozen' in v) return Object.freeze(decode(v.$frozen));
    if ('$fn' in v) {
        if (!fnCache.has(v.source)) fnCache.set(v.source, vm.runInThisContext(`(${v.source})`));
        return fnCache.get(v.source);
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = decode(v[k]);
    return o;
}
const decodeObject = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decode(v)]));
const fixtureCase = (name) => {
    const testCase = fixture.cases.find(c => c.name === name);
    assert.ok(testCase, `oracle case ${name}`);
    return { name, inputs: decodeObject(testCase.inputs), outputs: decodeObject(testCase.outputs) };
};

// ------------------------------------------------------------------ bundling
const compileModule = (contents, sourcefile) => {
    const esbuild = require('esbuild');
    const Module = require('node:module');
    const compiled = esbuild.buildSync({
        stdin: { contents, resolveDir: scenarioDir, sourcefile },
        bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    }).outputFiles[0].text;
    const probeModule = new Module(viewPath, module);
    probeModule.filename = viewPath;
    probeModule.paths = module.paths;
    probeModule._compile(compiled, viewPath);
    return probeModule.exports;
};
let probeExports = null;
const loadProbe = () => {
    probeExports = probeExports || compileModule(
        "export { ScenarioView } from './ScenarioView.jsx'; export { useScenarioPlanner } from './useScenarioPlanner.js'; export { useScenarioState } from './useScenarioState.js';",
        'scenarioViewProbe.js');
    return probeExports;
};

// ------------------------------------------------------------------ server render through the real hooks
const noop = () => {};
const defaultNormalizeEpicKey = value => String(value || '').trim().toUpperCase() || 'NO_EPIC';

// Renders <ScenarioView> fed by the real useScenarioState and the real useScenarioPlanner (all sub-hooks).
// stateOverrides replace container values on the one scenarioState object both the planner and the view read;
// draftMeta merges into the container's default scenarioDraftMeta.
function renderView({ inputs = {}, stateOverrides = {}, draftMeta = null, selectedSprint = '' } = {}) {
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const { ScenarioView, useScenarioPlanner, useScenarioState } = loadProbe();
    const normalizeEpicKey = inputs.normalizeEpicKey || defaultNormalizeEpicKey;
    const excludedEpicSet = inputs.excludedEpicSet || new Set();
    const laneMode = stateOverrides.scenarioLaneMode || inputs.scenarioLaneMode || 'team';
    let captured = null;
    function Probe() {
        const base = useScenarioState({ initialLaneMode: laneMode });
        const scenarioState = { ...base, ...stateOverrides };
        if (draftMeta) scenarioState.scenarioDraftMeta = { ...base.scenarioDraftMeta, ...draftMeta };
        const scenario = useScenarioPlanner({
            scenarioState, BACKEND_URL: '', EMPTY_ARRAY: inputs.EMPTY_ARRAY || [], EMPTY_OBJECT: inputs.EMPTY_OBJECT || {},
            perfEnabled: false, perfCountersRef: { current: {} },
            pendingConnectionRecoveryRef: { current: null },
            releaseConnectionRecoveryOwnership: noop,
            connectionRecoveryScenarioStartedRef: { current: false },
            setConnectionRecoveryNotice: noop, setConnectionRecoveryStatus: noop,
            connectionRecoveryStagedRevision: 0, selectedSprint, availableSprints: [],
            sprintsLoading: false, groupsLoading: false, activeGroupId: '', jiraUrl: inputs.jiraUrl || '',
            showScenario: true, searchQuery: inputs.searchQuery || '', pendingShellAuthResumeRef: { current: null },
            selectedSprintInfo: null, trackScenarioAction: noop, visibleControlGroups: [],
            selectedSprintState: '', isCompletedSprintSelected: false,
            normalizeEpicKey,
            registerSprintFetch: noop, cleanupSprintFetch: noop,
            activeGroup: null, teamOptions: [], selectedTeamSet: new Set(),
            isAllTeamsSelected: Boolean(inputs.isAllTeamsSelected), excludedEpicSet,
        });
        captured = { scenario, scenarioState, base };
        return React.createElement(ScenarioView, { scenario, scenarioState, selectedSprint, normalizeEpicKey, excludedEpicSet });
    }
    // scenarioTodayLeft reads a no-arg new Date(); pin it to the oracle's frozen clock.
    const RealDate = Date;
    const frozenNow = RealDate.parse(fixture.provenance.frozenNow);
    class FrozenDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [frozenNow])); }
        static now() { return frozenNow; }
    }
    const savedNodeEnv = process.env.NODE_ENV;
    globalThis.Date = FrozenDate;
    process.env.NODE_ENV = fixture.provenance.processEnvNodeEnv;
    let html;
    try {
        html = renderToString(React.createElement(Probe));
    } finally {
        globalThis.Date = RealDate;
        if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedNodeEnv;
    }
    return { html, ...captured };
}

const caseStateOverrides = (inputs) => ({
    scenarioData: inputs.scenarioData, scenarioLaneMode: inputs.scenarioLaneMode,
    scenarioShowConflictsOnly: inputs.scenarioShowConflictsOnly, scenarioLayout: inputs.scenarioLayout,
    scenarioCollapsedLanes: inputs.scenarioCollapsedLanes, scenarioHoverKey: inputs.scenarioHoverKey,
    scenarioScrollTop: inputs.scenarioScrollTop, scenarioViewportHeight: inputs.scenarioViewportHeight,
    scenarioEpicFocus: inputs.scenarioEpicFocus, scenarioRangeOverride: inputs.scenarioRangeOverride,
    scenarioOverrides: inputs.scenarioOverrides, scenarioEditMode: inputs.scenarioEditMode,
});
const renderCase = (name, extra = {}) => {
    const testCase = fixtureCase(name);
    const rendered = renderView({ inputs: testCase.inputs, ...extra,
        stateOverrides: { ...caseStateOverrides(testCase.inputs), ...(extra.stateOverrides || {}) } });
    return { ...rendered, testCase };
};

// ------------------------------------------------------------------ tiny DOM-free HTML helpers
// Index just past the </div> that closes the <div ...> opening at `start`.
function divEnd(html, start) {
    assert.ok(html.startsWith('<div', start), `expected a <div at ${start}`);
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tag.exec(html))) {
        depth += match[1] ? -1 : 1;
        if (depth === 0) return tag.lastIndex;
    }
    throw new Error('unbalanced <div>');
}
const divAt = (html, openTag, from = 0) => {
    const start = html.indexOf(openTag, from);
    assert.ok(start > -1, `expected ${openTag}`);
    return html.slice(start, divEnd(html, start));
};
const allDivs = (html, openTag) => {
    const blocks = [];
    let start = html.indexOf(openTag);
    while (start > -1) {
        blocks.push(html.slice(start, divEnd(html, start)));
        start = html.indexOf(openTag, start + openTag.length);
    }
    return blocks;
};
const textOf = (fragment) => fragment.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").trim();
const buttonsOf = (fragment) => [...fragment.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(([, attrs, inner]) => ({ text: textOf(inner), attrs, disabled: /\sdisabled=""/.test(attrs) }));
const countOf = (html, pattern) => (html.match(pattern) || []).length;
const toolbarOf = (html) => divAt(html, '<div class="scenario-controls">');

const SHELL_OPEN = '<div class="scenario-fullbleed"><div class="scenario-panel open"><div class="scenario-inner"><div class="scenario-header">';

// ------------------------------------------------------------------ (a) single root element
test('ScenarioView server-renders one scenario-fullbleed root with no wrapper or sibling DOM', () => {
    const idle = renderView();
    assert.ok(idle.html.startsWith(SHELL_OPEN), idle.html.slice(0, 200));
    assert.equal(divEnd(idle.html, 0), idle.html.length, 'the root <div> must close at the end of the output');

    const { html } = renderCase('single-team-team-lanes');
    assert.ok(html.startsWith(SHELL_OPEN));
    assert.equal(divEnd(html, 0), html.length, 'the root <div> must close at the end of the output with data');
    assert.equal(countOf(html, /class="scenario-fullbleed"/g), 1);
});

// ------------------------------------------------------------------ (b) toolbar order, labels and gates
test('ScenarioView toolbar keeps the established control order, labels and disabled gates', () => {
    // Idle: no data, no sprint. Edit is disabled, History is absent, Run Scenario is disabled.
    const idle = toolbarOf(renderView().html);
    assert.ok(idle.indexOf('<label>Lane Mode</label>') > -1);
    assert.ok(idle.indexOf('<label>Lane Mode</label>') < idle.indexOf('<button'), 'Lane Mode label precedes the toggles');
    assert.deepEqual(buttonsOf(idle).map(b => b.text),
        ['Team', 'Epic', 'Assignee', 'Show Summary', 'Edit', 'Conflicts Only', 'Run Scenario']);
    assert.deepEqual(buttonsOf(idle).map(b => b.disabled), [false, false, false, false, true, false, true]);
    assert.match(buttonsOf(idle)[0].attrs, /class="scenario-toggle active"/, 'initial team lane mode is active');
    assert.match(buttonsOf(idle)[3].attrs, /title="Show summary cards"/);
    assert.equal(countOf(idle, /scenario-dirty-indicator/g), 0);

    // A selected sprint enables Run Scenario; loading relabels and disables it and shows the loading line.
    assert.equal(buttonsOf(toolbarOf(renderView({ selectedSprint: '42' }).html)).at(-1).disabled, false);
    const loading = renderView({ selectedSprint: '42', stateOverrides: { scenarioLoading: true } }).html;
    const loadingRun = buttonsOf(toolbarOf(loading)).at(-1);
    assert.deepEqual([loadingRun.text, loadingRun.disabled], ['Running...', true]);
    assert.ok(loading.includes('<div class="scenario-loading">Computing scenario timeline...</div>'));

    // With data outside edit mode: Edit is enabled and History sits between Edit and Conflicts Only.
    const viewing = renderCase('epic-lanes', { selectedSprint: '42', stateOverrides: { scenarioSummaryHidden: false } });
    const viewingButtons = buttonsOf(toolbarOf(viewing.html));
    assert.deepEqual(viewingButtons.map(b => b.text),
        ['Team', 'Epic', 'Assignee', 'Hide Summary', 'Edit', 'History', 'Conflicts Only', 'Run Scenario']);
    assert.ok(viewingButtons.every(b => !b.disabled));
    assert.match(viewingButtons[1].attrs, /class="scenario-toggle active"/, 'epic lane mode is active');
    assert.match(viewingButtons[0].attrs, /class="scenario-toggle "/);
    assert.match(viewingButtons[3].attrs, /class="scenario-toggle active"/, 'visible summary marks the toggle active');

    // Edit mode without overrides: Exit Edit, then the edit cluster after Run Scenario; Discard is disabled.
    const editing = renderCase('single-team-team-lanes', { selectedSprint: '42', stateOverrides: { scenarioEditMode: true } });
    const editingButtons = buttonsOf(toolbarOf(editing.html));
    assert.deepEqual(editingButtons.map(b => b.text),
        ['Team', 'Epic', 'Assignee', 'Show Summary', 'Exit Edit', 'Conflicts Only', 'Run Scenario',
            'Undo', 'Redo', 'Save Draft', 'History', 'Discard']);
    assert.match(editingButtons[4].attrs, /class="scenario-edit-toggle active"/);
    assert.deepEqual(editingButtons.slice(7).map(b => b.disabled), [true, true, true, false, true]);
    assert.equal(editing.scenario.scenarioOverrideCount, 0);
    assert.equal(countOf(editing.html, /scenario-dirty-indicator/g), 0);

    // Edit mode with overrides: Discard and Save Draft follow the planner's gates and the indicator counts them.
    const dirty = renderCase('overrides-applied', { selectedSprint: '42', stateOverrides: { scenarioEditMode: true } });
    const dirtyButtons = buttonsOf(toolbarOf(dirty.html));
    assert.deepEqual(dirtyButtons.slice(7).map(b => b.text), ['Undo', 'Redo', 'Save Draft', 'History', 'Discard']);
    assert.equal(dirty.scenario.scenarioHasUnsavedChanges, true);
    assert.equal(dirtyButtons.at(-1).disabled, false, 'Discard is enabled when overrides are unsaved');
    assert.equal(dirtyButtons[9].disabled, !dirty.scenario.scenarioCanSaveDraft);
    assert.equal(dirty.scenario.scenarioOverrideCount, 2);
    assert.ok(toolbarOf(dirty.html).endsWith('<span class="scenario-dirty-indicator">2<!-- --> override<!-- -->s</span></div>'));
    const single = renderView({ selectedSprint: '42', stateOverrides: {
        ...caseStateOverrides(fixtureCase('overrides-applied').inputs), scenarioEditMode: true,
        scenarioOverrides: { 'DEMO-111': { start: '2026-02-09', end: '2026-02-27' } } } });
    assert.equal(textOf(divAt(single.html, '<div class="scenario-controls">').match(/<span class="scenario-dirty-indicator">[\s\S]*?<\/span>/)[0]), '1 override');
    assert.equal(buttonsOf(toolbarOf(single.html)).find(b => b.text === 'Save Draft').text, 'Save Draft');
    const saving = renderCase('overrides-applied', { stateOverrides: { scenarioEditMode: true }, draftMeta: { saving: true } });
    assert.ok(buttonsOf(toolbarOf(saving.html)).some(b => b.text === 'Saving...'));
});

// ------------------------------------------------------------------ (c) idle state and fixture-driven lanes/bars
test('ScenarioView idle state renders only the header: no summary, lanes, bars or tooltip', () => {
    const { html } = renderView();
    const header = divAt(html, '<div class="scenario-header">');
    assert.equal(html, '<div class="scenario-fullbleed"><div class="scenario-panel open"><div class="scenario-inner">'
        + header + '</div></div></div>');
    for (const pattern of [/scenario-summary/, /scenario-timeline/, /scenario-lane/, /class="scenario-bar/, /scenario-epic-bar/,
        /scenario-tooltip/, /role="alert"/, /scenario-draft-history-panel/]) {
        assert.doesNotMatch(html, pattern);
    }
});

const expectedCounts = ({ inputs, outputs }) => {
    const visibleLanes = outputs.scenarioVisibleLanes;
    const conflicts = outputs.scenarioAssigneeConflicts.conflicts;
    let bars = 0;
    for (const lane of visibleLanes) {
        const laneIssues = (outputs.scenarioIssuesByLane.get(lane) || [])
            .filter(issue => !inputs.scenarioShowConflictsOnly || conflicts.has(issue.key));
        bars += laneIssues.filter(issue => outputs.scenarioPositions[issue.key] && inputs.scenarioLayout.width).length;
    }
    return {
        lanes: visibleLanes.length,
        bars,
        epicBars: outputs.scenarioEpicBars.filter(bar => visibleLanes.includes(bar.lane)).length,
        ticks: outputs.scenarioTicks.length,
        quarterLines: inputs.scenarioLayout.width > 0 ? outputs.scenarioQuarterMarkers.length : 0,
        today: outputs.scenarioTodayLeft === null ? 0 : 1,
    };
};
const renderedCounts = (html) => ({
    lanes: countOf(html, /<button class="scenario-lane-label"/g),
    bars: countOf(html, /<a class="scenario-bar[ "]/g),
    epicBars: countOf(html, /class="scenario-epic-bar[ "]/g),
    ticks: countOf(html, /class="scenario-axis-tick"/g),
    quarterLines: countOf(html, /class="scenario-quarter-line"/g),
    today: countOf(html, /class="scenario-today"/g),
});

test('ScenarioView renders the oracle lanes, bars, epic bars and ticks for every fixture case', () => {
    let nonEmpty = 0;
    for (const name of fixture.cases.map(c => c.name)) {
        const { html, scenario, testCase } = renderCase(name);
        // The real hooks reproduce the oracle under the same state, so the view is fed the oracle's values.
        assert.deepEqual(Object.keys(scenario.scenarioPositions), Object.keys(testCase.outputs.scenarioPositions), name);
        assert.deepEqual(scenario.scenarioVisibleLanes, testCase.outputs.scenarioVisibleLanes, name);
        assert.equal(divEnd(html, 0), html.length, name);
        if (!testCase.inputs.scenarioData) {
            assert.doesNotMatch(html, /scenario-timeline/, name);
            continue;
        }
        const expected = expectedCounts(testCase);
        assert.deepEqual(renderedCounts(html), expected, name);
        assert.equal(countOf(html, /<div class="scenario-lane"/g), expected.lanes, name);
        if (expected.bars > 0) nonEmpty += 1;
    }
    assert.ok(nonEmpty >= 10, `expected most oracle cases to render bars, got ${nonEmpty}`);
});

test('ScenarioView renders epic bars only in epic lane mode and team lane metadata only in team mode', () => {
    const team = renderCase('single-team-team-lanes');
    const teamExpected = expectedCounts(team.testCase);
    assert.deepEqual(renderedCounts(team.html), { lanes: 1, bars: 5, epicBars: 0, ticks: 1, quarterLines: teamExpected.quarterLines, today: 1 });
    assert.equal(teamExpected.bars, 5);
    assert.equal(countOf(team.html, /class="scenario-lane-status /g), 1);
    assert.ok(textOf(divAt(team.html, '<div class="scenario-lane"')).startsWith('Team Alpha'));

    const epic = renderCase('epic-lanes');
    const epicExpected = expectedCounts(epic.testCase);
    assert.ok(epicExpected.epicBars > 0);
    assert.deepEqual(renderedCounts(epic.html), epicExpected);
    assert.equal(epicExpected.lanes, 4);
    assert.equal(countOf(epic.html, /class="scenario-lane-status /g), 0);
    assert.equal(countOf(epic.html, /class="scenario-epic-bar excluded"/g),
        epic.testCase.outputs.scenarioEpicBars.filter(bar => bar.isExcluded).length);

    for (const name of ['single-team-team-lanes', 'multi-team-all-teams', 'assignee-lanes']) {
        assert.equal(countOf(renderCase(name).html, /scenario-epic-bar/g), 0, name);
    }
});

// ------------------------------------------------------------------ (d) alert regions
test('ScenarioView renders run, draft error and draft conflict alerts in the status-area order', () => {
    assert.equal(countOf(renderView().html, /role="alert"/g), 0);
    const { html } = renderView({
        stateOverrides: { scenarioError: 'Scenario run failed' },
        draftMeta: {
            error: 'Draft save failed',
            conflict: { currentDraftRevision: 7, currentVersionNumber: 3, activeDraft: { updatedBy: 'Reviewer', updatedAt: '2026-01-02' } },
        },
    });
    const alerts = allDivs(html, '<div class="scenario-error" role="alert">');
    assert.equal(alerts.length, 3);
    assert.equal(countOf(html, /role="alert"/g), 3);
    assert.equal(textOf(alerts[0]), 'Scenario run failed');
    assert.equal(textOf(alerts[1]), 'Draft save failed');
    assert.equal(textOf(alerts[2].match(/<span>[\s\S]*?<\/span>/)[0]),
        'Scenario draft conflict. Current draft revision 7, version 3 by Reviewer at 2026-01-02.');
    assert.deepEqual(buttonsOf(alerts[2]).map(b => b.text), ['Keep Editing', 'Review history']);
    // The alerts follow the header inside scenario-inner, in JSX order.
    const headerEnd = html.indexOf('<div class="scenario-header">') + divAt(html, '<div class="scenario-header">').length;
    const positions = alerts.map(block => html.indexOf(block));
    assert.equal(positions[0], headerEnd);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);

    // Missing conflict metadata falls back to "unknown" with no actor suffix.
    const bare = renderView({ draftMeta: { conflict: {} } }).html;
    assert.equal(textOf(allDivs(bare, '<div class="scenario-error" role="alert">')[0].match(/<span>[\s\S]*?<\/span>/)[0]),
        'Scenario draft conflict. Current draft revision unknown, version unknown.');
});

// ------------------------------------------------------------------ (e) tooltip
test('ScenarioView tooltip is absent without data, hidden by default and visible when tooltip state is seeded', () => {
    assert.doesNotMatch(renderView().html, /scenario-tooltip/);

    const hidden = renderCase('single-team-team-lanes').html;
    const hiddenTip = divAt(hidden, '<div class="scenario-tooltip');
    assert.equal(hiddenTip, '<div class="scenario-tooltip " style="left:0px;top:0px"><div></div></div>');
    const timeline = divAt(hidden, '<div class="scenario-timeline">');
    assert.ok(timeline.endsWith(`${hiddenTip}</div>`), 'tooltip is the last child of the timeline');

    const shown = renderCase('single-team-team-lanes', { stateOverrides: { scenarioTooltip: {
        visible: true, x: 12, y: 34, summary: 'Tip summary', key: 'DEMO-1', sp: 3, note: 'Tip note', assignee: 'Ada', team: 'Team Alpha',
    } } }).html;
    const tip = divAt(shown, '<div class="scenario-tooltip');
    assert.ok(tip.startsWith('<div class="scenario-tooltip visible" style="left:12px;top:34px">'), tip);
    const inner = tip.slice(tip.indexOf('>') + 1, -'</div>'.length);
    assert.deepEqual([...inner.matchAll(/<div( class="[^"]*")?>([\s\S]*?)<\/div>/g)].map(([, cls, body]) => [cls || '', textOf(body)]), [
        ['', 'Tip summary'],
        [' class="scenario-tooltip-key"', 'DEMO-1'],
        [' class="scenario-tooltip-key"', '👤 Ada'],
        [' class="scenario-tooltip-key"', '👥 Team Alpha'],
        [' class="scenario-tooltip-key"', 'SP: 3.0'],
        [' class="scenario-tooltip-note"', 'Tip note'],
    ]);
});

// ------------------------------------------------------------------ (f) interface contract
test('ScenarioView module exports only ScenarioView, which destructures exactly its five props', () => {
    const source = fs.readFileSync(viewPath, 'utf8');
    assert.deepEqual([...source.matchAll(/^export\s+(?:default\s+)?(?:function|const|let|class)?\s*(\w+)/gm)].map(m => m[1]), ['ScenarioView']);
    assert.doesNotMatch(source, /^export\s*\{/m);
    assert.deepEqual(Object.keys(compileModule("export * from './ScenarioView.jsx';", 'scenarioViewExports.js')), ['ScenarioView']);
    const { ScenarioView } = loadProbe();
    assert.equal(typeof ScenarioView, 'function');
    assert.equal(ScenarioView.length, 1);

    const signature = source.match(/export function ScenarioView\(\{([^}]*)\}\)/);
    assert.ok(signature, 'Expected a destructured ScenarioView signature');
    assert.deepEqual(signature[1].split(',').map(s => s.trim()).filter(Boolean), VIEW_PROP_NAMES);

    // The view reads only names the real hooks return.
    const destructured = (from) => {
        const match = source.match(new RegExp(`const \\{([^}]*)\\} = ${from};`));
        assert.ok(match, `Expected a destructure of ${from}`);
        return match[1].split(',').map(s => s.trim()).filter(Boolean);
    };
    const { scenario, base } = renderView();
    const scenarioNames = destructured('scenario');
    const stateNames = destructured('scenarioState');
    assert.equal(scenarioNames.length, 65);
    assert.equal(stateNames.length, 30);
    for (const name of scenarioNames) assert.ok(name in scenario, `useScenarioPlanner returns ${name}`);
    for (const name of stateNames) assert.ok(name in base, `useScenarioState returns ${name}`);

    // The dashboard passes exactly those five props, each under its own name.
    const dashboard = fs.readFileSync(dashboardPath, 'utf8');
    assert.match(dashboard, /const loadScenarioView = createLazyViewLoader\(\{ viewId: 'scenario',[\s\S]*?initialLoad: \(\) => import\('\.\/scenario\/ScenarioView\.jsx'\)\.then\([\s\S]*?module => \(\{ default: module\.ScenarioView \}\)\)/);
    assert.match(dashboard, /<LazyViewBoundary load=\{loadScenarioView\} fallback=\{scenarioLoadingFallback\}>\s*\{ScenarioView => <ScenarioView/);
    const callsites = [...dashboard.matchAll(/<ScenarioView\b([\s\S]*?)\/>/g)];
    assert.equal(callsites.length, 1);
    assert.deepEqual([...callsites[0][1].matchAll(/(\w+)=\{(\w+)\}/g)].map(([, prop, value]) => [prop, value]),
        VIEW_PROP_NAMES.map(name => [name, name]));
});
