const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const dashboardCssPath = path.join(__dirname, '..', 'frontend', 'src', 'styles', 'dashboard.css');
const epmApiPath = path.join(__dirname, '..', 'frontend', 'src', 'api', 'epmApi.js');
const epmViewDataPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'useEpmViewData.js');
const epmControlsPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmControls.jsx');
const epmViewPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmView.jsx');
const epmSettingsPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmSettings.jsx');
const epmRollupPanelPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupPanel.jsx');
const epmRollupTreePath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupTree.jsx');
const engViewPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngView.jsx');
const issueCardPath = path.join(__dirname, '..', 'frontend', 'src', 'issues', 'IssueCard.jsx');
const issueDependenciesPath = path.join(__dirname, '..', 'frontend', 'src', 'issues', 'IssueDependencies.jsx');
const engSprintDataPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngSprintData.js');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');
const segmentedControlPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'SegmentedControl.jsx');
const controlFieldPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'ControlField.jsx');
const iconButtonPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'IconButton.jsx');
const loadingRowsPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'LoadingRows.jsx');
const loadingStatePath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'LoadingState.jsx');
const emptyStatePath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'EmptyState.jsx');
const statusPillPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'StatusPill.jsx');

const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const segmentedControlSource = fs.existsSync(segmentedControlPath) ? fs.readFileSync(segmentedControlPath, 'utf8') : '';
const controlFieldSource = fs.existsSync(controlFieldPath) ? fs.readFileSync(controlFieldPath, 'utf8') : '';
const iconButtonSource = fs.existsSync(iconButtonPath) ? fs.readFileSync(iconButtonPath, 'utf8') : '';
const loadingRowsSource = fs.existsSync(loadingRowsPath) ? fs.readFileSync(loadingRowsPath, 'utf8') : '';
const loadingStateSource = fs.existsSync(loadingStatePath) ? fs.readFileSync(loadingStatePath, 'utf8') : '';
const emptyStateSource = fs.existsSync(emptyStatePath) ? fs.readFileSync(emptyStatePath, 'utf8') : '';
const statusPillSource = fs.existsSync(statusPillPath) ? fs.readFileSync(statusPillPath, 'utf8') : '';
const dashboardCssSource = fs.existsSync(dashboardCssPath) ? fs.readFileSync(dashboardCssPath, 'utf8') : '';
const epmApiSource = fs.existsSync(epmApiPath) ? fs.readFileSync(epmApiPath, 'utf8') : '';
const epmViewDataSource = fs.existsSync(epmViewDataPath) ? fs.readFileSync(epmViewDataPath, 'utf8') : '';
const epmControlsSource = fs.existsSync(epmControlsPath) ? fs.readFileSync(epmControlsPath, 'utf8') : '';
const epmViewSource = fs.existsSync(epmViewPath) ? fs.readFileSync(epmViewPath, 'utf8') : '';
const epmSettingsSource = fs.existsSync(epmSettingsPath) ? fs.readFileSync(epmSettingsPath, 'utf8') : '';
const epmRollupPanelSource = fs.existsSync(epmRollupPanelPath) ? fs.readFileSync(epmRollupPanelPath, 'utf8') : '';
const epmRollupTreeSource = fs.existsSync(epmRollupTreePath) ? fs.readFileSync(epmRollupTreePath, 'utf8') : '';
const engViewSource = fs.existsSync(engViewPath) ? fs.readFileSync(engViewPath, 'utf8') : '';
const issueCardSource = fs.existsSync(issueCardPath) ? fs.readFileSync(issueCardPath, 'utf8') : '';
const issueDependenciesSource = fs.existsSync(issueDependenciesPath) ? fs.readFileSync(issueDependenciesPath, 'utf8') : '';
const engSprintDataSource = fs.existsSync(engSprintDataPath) ? fs.readFileSync(engSprintDataPath, 'utf8') : '';
const helperSource = fs.existsSync(helperPath) ? fs.readFileSync(helperPath, 'utf8') : '';

function countOccurrences(source, needle) {
    return (source.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

function hasCallAfter(source, marker, call) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) return false;
    return source.indexOf(call, markerIndex) !== -1;
}

function findMatchingBrace(source, openBraceIndex) {
    let depth = 0;
    for (let index = openBraceIndex; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function getUseEffectBodies(source) {
    const bodies = [];
    const effectPattern = /(?:React\.)?useEffect\(\(\) => \{/g;
    let match;
    while ((match = effectPattern.exec(source)) !== null) {
        const openBraceIndex = match.index + match[0].length - 1;
        const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
        assert.notStrictEqual(closeBraceIndex, -1, `Expected closing brace for useEffect at ${match.index}`);
        bodies.push(source.slice(openBraceIndex + 1, closeBraceIndex));
        effectPattern.lastIndex = closeBraceIndex + 1;
    }
    return bodies;
}

function getConstFunctionBodies(source) {
    const bodies = new Map();
    const functionPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*(?:React\.useCallback\(\s*)?(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
    let match;
    while ((match = functionPattern.exec(source)) !== null) {
        const openBraceIndex = match.index + match[0].length - 1;
        const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
        assert.notStrictEqual(closeBraceIndex, -1, `Expected closing brace for function ${match[1]}`);
        bodies.set(match[1], source.slice(openBraceIndex + 1, closeBraceIndex));
        functionPattern.lastIndex = closeBraceIndex + 1;
    }
    return bodies;
}

function getSnippetBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notStrictEqual(start, -1, `Expected start marker ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(end, -1, `Expected end marker ${endMarker}`);
    return source.slice(start, end);
}

function callsFunction(source, functionName) {
    return new RegExp(`\\b${functionName}\\s*\\(`).test(source);
}

function functionCallIndex(source, functionName) {
    const match = new RegExp(`\\b${functionName}\\s*\\(`).exec(source);
    return match ? match.index : -1;
}

function getEngTaskFunctionNames() {
    const functionBodies = getConstFunctionBodies(dashboardSource);
    const engMarkers = [
        '/api/tasks-with-team-name',
        '/api/backlog-epics',
        'setProductTasksLoading(true)',
        'setTechTasksLoading(true)',
        'fetchTasks(',
        'fetchBacklogEpics(',
        'loadProductTasks(',
        'loadTechTasks(',
        'loadReadyToCloseProductTasks(',
        'loadReadyToCloseTechTasks('
    ];
    const engFunctions = new Set();

    functionBodies.forEach((body, name) => {
        if (engMarkers.some(marker => body.includes(marker))) {
            engFunctions.add(name);
        }
    });

    let changed = true;
    while (changed) {
        changed = false;
        functionBodies.forEach((body, name) => {
            if (engFunctions.has(name)) return;
            if (Array.from(engFunctions).some(engFunction => callsFunction(body, engFunction))) {
                engFunctions.add(name);
                changed = true;
            }
        });
    }

    return engFunctions;
}

function firstEngTaskWorkIndex(body, engFunctions) {
    const directMarkers = [
        '/api/tasks-with-team-name',
        '/api/backlog-epics',
        'setProductTasksLoading(true)',
        'setTechTasksLoading(true)',
        'fetchTasks(',
        'fetchBacklogEpics(',
        'loadProductTasks(',
        'loadTechTasks(',
        'loadReadyToCloseProductTasks(',
        'loadReadyToCloseTechTasks('
    ];
    const indexes = directMarkers
        .map(marker => body.indexOf(marker))
        .filter(index => index !== -1);
    Array.from(engFunctions).forEach(functionName => {
        const index = functionCallIndex(body, functionName);
        if (index !== -1) {
            indexes.push(index);
        }
    });
    return indexes.length ? Math.min(...indexes) : -1;
}

function leadingEngGuardMatch(body) {
    const skippedPrefix = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/.exec(body)[0];
    const guardPattern = /if\s*\(\s*selectedView\s*!==\s*'eng'\s*\)\s*(?:return\s*;|\{\s*return\s*;\s*\})/;
    const match = guardPattern.exec(body.slice(skippedPrefix.length));
    if (!match || match.index !== 0) return null;
    return {
        index: skippedPrefix.length,
        end: skippedPrefix.length + match[0].length
    };
}

function assertUseEffectGuardedForEng(label, body, firstEngWorkIndex) {
    const guardMatch = leadingEngGuardMatch(body);
    assert.ok(
        guardMatch && guardMatch.index < firstEngWorkIndex,
        `Expected ${label} to start with selectedView ENG guard before ENG-only work`
    );
}

function assertAllEngTaskEffectsGuarded() {
    const engFunctions = getEngTaskFunctionNames();
    const matchingEffects = getUseEffectBodies(dashboardSource)
        .map((body, index) => ({ body, index }))
        .map(effect => ({
            ...effect,
            firstEngWorkIndex: firstEngTaskWorkIndex(effect.body, engFunctions)
        }))
        .filter(effect => effect.firstEngWorkIndex !== -1);
    assert.ok(matchingEffects.length > 0, 'Expected at least one useEffect to reach ENG task fetching work');
    matchingEffects.forEach(effect => {
        assertUseEffectGuardedForEng(`useEffect #${effect.index}`, effect.body, effect.firstEngWorkIndex);
    });
}

test('dashboard source keeps the ENG and EPM switch contract', () => {
    assert.ok(dashboardSource.includes('selectedView'), 'Expected selectedView state in dashboard.jsx');
    assert.ok(dashboardSource.includes('epmTab'), 'Expected epmTab state in dashboard.jsx');
    assert.ok(dashboardSource.includes('renderEngModeControl'), 'Expected ENG mode control renderer in dashboard.jsx');
    assert.ok(dashboardSource.includes('ariaLabel="ENG view mode"'), 'Expected ENG modes to use a segmented radiogroup');
    assert.ok(dashboardSource.includes('className="eng-mode-control"'), 'Expected ENG modes to keep their control class');
    assert.ok(!dashboardSource.includes('mode-switch-button'), 'Expected ENG modes to avoid independent toggle buttons');
    assert.ok(!dashboardSource.includes('view-switch'), 'Did not expect view-switch in dashboard.jsx');
});

test('dashboard source renders mutually exclusive view controls and delegates EPM tab controls', () => {
    assert.ok(fs.existsSync(epmControlsPath), 'Expected EPM controls component');
    assert.ok(dashboardSource.includes('<SegmentedControl'), 'Expected dashboard selectors to use the shared segmented primitive');
    assert.ok(dashboardSource.includes('className="view-mode-control"'), 'Expected ENG/EPM selector to keep the view-mode-control class');
    assert.ok(dashboardSource.includes("import { EpmControls } from './epm/EpmControls.jsx';"), 'Expected dashboard to import EpmControls');
    assert.ok(dashboardSource.includes('<EpmControls'), 'Expected dashboard to render EpmControls');
    assert.ok(!dashboardSource.includes('const renderEpmTabs = () =>'), 'Expected dashboard not to own EPM tabs renderer');
    assert.ok(epmControlsSource.includes('className="epm-state-control"'), 'Expected EPM project-state selector to keep the epm-state-control class');
    assert.ok(epmControlsSource.includes('ariaLabel="EPM project state"'), 'Expected EPM tabs to preserve their accessible label');
    assert.ok(segmentedControlSource.includes("['segmented-control', className]"), 'Expected SegmentedControl to preserve the segmented-control wrapper class');
    assert.ok(segmentedControlSource.includes('role="radiogroup"'), 'Expected SegmentedControl to expose radio group semantics');
    assert.ok(segmentedControlSource.includes('role="radio"'), 'Expected segmented options to expose radio semantics');
    assert.ok(segmentedControlSource.includes('aria-checked={active}'), 'Expected segmented options to expose checked state');
});

test('dashboard source uses shared basic UI primitives for representative controls and states', () => {
    assert.ok(fs.existsSync(epmControlsPath), 'Expected EPM controls component');
    assert.ok(fs.existsSync(epmViewPath), 'Expected EPM view component');
    assert.ok(fs.existsSync(segmentedControlPath), 'Expected shared SegmentedControl primitive');
    assert.ok(fs.existsSync(controlFieldPath), 'Expected shared ControlField primitive');
    assert.ok(fs.existsSync(iconButtonPath), 'Expected shared IconButton primitive');
    assert.ok(fs.existsSync(loadingRowsPath), 'Expected shared LoadingRows primitive');
    assert.ok(fs.existsSync(loadingStatePath), 'Expected shared LoadingState primitive');
    assert.ok(fs.existsSync(emptyStatePath), 'Expected shared EmptyState primitive');
    assert.ok(dashboardSource.includes("import SegmentedControl from './ui/SegmentedControl.jsx';"), 'Expected dashboard to import SegmentedControl');
    assert.ok(dashboardSource.includes("import ControlField from './ui/ControlField.jsx';"), 'Expected dashboard to import ControlField');
    assert.ok(dashboardSource.includes("import IconButton from './ui/IconButton.jsx';"), 'Expected dashboard to import IconButton');
    assert.ok(dashboardSource.includes("import LoadingRows from './ui/LoadingRows.jsx';"), 'Expected dashboard to import LoadingRows');
    assert.ok(epmViewSource.includes("import LoadingState from '../ui/LoadingState.jsx';"), 'Expected EPM view to import LoadingState');
    assert.ok(engViewSource.includes("import LoadingState from '../ui/LoadingState.jsx';"), 'Expected ENG view to import LoadingState');
    assert.ok(dashboardSource.includes("import EmptyState from './ui/EmptyState.jsx';"), 'Expected dashboard to import EmptyState');
    assert.ok(dashboardSource.includes('<SegmentedControl') && dashboardSource.includes('className="view-mode-control"'), 'Expected ENG/EPM selector to use SegmentedControl');
    assert.ok(dashboardSource.includes('<ControlField') && dashboardSource.includes('label="Search"'), 'Expected header search control to use ControlField');
    assert.ok(dashboardSource.includes('<IconButton') && dashboardSource.includes('className="refresh-icon"'), 'Expected compact refresh action to use IconButton');
    assert.ok(dashboardSource.includes('<LoadingRows') && dashboardSource.includes('className="epm-project-skeleton-list"'), 'Expected EPM project loading rows to use LoadingRows');
    assert.ok(loadingStateSource.includes('epm-burst.svg'), 'Expected LoadingState to use the EPM burst asset');
    assert.ok(loadingStateSource.includes('loading-mark-spinner'), 'Expected LoadingState to expose a rotating spinner mark');
    assert.ok(epmViewSource.includes('<LoadingState') && epmViewSource.includes('title="Loading EPM settings"'), 'Expected EPM loading states to use LoadingState');
    assert.ok(epmControlsSource.includes("import SegmentedControl from '../ui/SegmentedControl.jsx';"), 'Expected EpmControls to import SegmentedControl');
    assert.ok(epmControlsSource.includes("import ControlField from '../ui/ControlField.jsx';"), 'Expected EpmControls to import ControlField');
    assert.ok(epmViewSource.includes("import EmptyState from '../ui/EmptyState.jsx';"), 'Expected EpmView to import EmptyState');
    assert.ok(controlFieldSource.includes("['control-field', className]"), 'Expected ControlField to preserve the control-field wrapper class');
    assert.ok(controlFieldSource.includes('data-label={dataLabel}'), 'Expected ControlField to preserve compact data-label behavior');
    assert.ok(controlFieldSource.includes('<span className="control-label">{label}</span>'), 'Expected ControlField to preserve visible control labels');
    assert.ok(iconButtonSource.includes("[variant, className, isLoading ? 'is-loading' : '']"), 'Expected IconButton to preserve variant/class/loading composition order');
    assert.ok(iconButtonSource.includes("if (Element === 'button')") && iconButtonSource.includes('elementProps.type = type'), 'Expected IconButton to keep button type handling off anchors');
    assert.ok(loadingRowsSource.includes('Array.from({ length: rows }') && loadingRowsSource.includes('Array.from({ length: columns }'), 'Expected LoadingRows to generate the requested row and column skeleton spans');
    assert.ok(emptyStateSource.includes("['empty-state', className]"), 'Expected EmptyState to preserve the empty-state wrapper class');
    assert.ok(emptyStateSource.includes('<h2>{title}</h2>'), 'Expected EmptyState to preserve the heading structure');
});

test('compact sticky header keeps search available for every dashboard view', () => {
    const compactHeader = getSnippetBetween(
        dashboardSource,
        'className={`compact-sticky-header ${compactStickyVisible ?',
        "{selectedView === 'eng' && !isCompletedSprintSelected && ("
    );
    assert.ok(compactHeader.includes('compact-sticky-header-search'), 'Expected compact header to render its search container');
    assert.ok(compactHeader.includes("{renderSearchControl('compact', 'compact-sticky-header-search-field')}"), 'Expected compact header search to use the shared search control');
    assert.ok(!compactHeader.includes("{selectedView === 'eng' && (\n                                    <div className=\"compact-sticky-header-search\">"), 'Expected compact search not to be ENG-only');
});

test('EPM rollup panel shows Jira Home project status and epic status pills', () => {
    assert.ok(epmRollupPanelSource.includes("import { getIssueStatusClassName } from '../issues/issueViewUtils.js';"), 'Expected EPM rollup to use shared issue status classes');
    assert.ok(epmRollupPanelSource.includes('epm-project-board-status-pill'), 'Expected EPM project board headers to render Jira Home status pills');
    assert.ok(epmRollupPanelSource.includes('epic-status-pill'), 'Expected EPM epic headers to render epic status pills');
    assert.ok(epmRollupPanelSource.includes('label={epic.status}'), 'Expected EPM epic status label to come from Jira issue status');
});

test('EPM status and label chips use the shared StatusPill primitive', () => {
    assert.ok(fs.existsSync(statusPillPath), 'Expected shared StatusPill primitive');
    assert.ok(statusPillSource.includes("['status-pill', className]"), 'Expected StatusPill to preserve a stable base class');
    assert.ok(statusPillSource.includes('title={title || label}'), 'Expected StatusPill to default the title to the rendered label');
    assert.ok(epmRollupPanelSource.includes("import StatusPill from '../ui/StatusPill.jsx';"), 'Expected EpmRollupPanel to import StatusPill');
    assert.ok(epmRollupPanelSource.includes('<StatusPill') && epmRollupPanelSource.includes('className="epm-project-board-label-pill"'), 'Expected EPM project board labels to render through StatusPill');
    assert.ok(epmRollupPanelSource.includes('<StatusPill') && epmRollupPanelSource.includes('className="epm-duplicates-project-label"'), 'Expected EPM duplicate project labels to render through StatusPill');
    assert.ok(epmSettingsSource.includes("import StatusPill from '../ui/StatusPill.jsx';"), 'Expected EpmSettings to import StatusPill for settings status chips');
    assert.ok(epmSettingsSource.includes('<StatusPill') && epmSettingsSource.includes('className="epm-home-status-pill"'), 'Expected EPM settings Home statuses to render through StatusPill');
});

test('EPM project picker uses the sprint-style custom dropdown', () => {
    assert.ok(fs.existsSync(epmControlsPath), 'Expected EPM controls component');
    const pickerSource = getConstFunctionBodies(epmControlsSource).get('renderEpmProjectPicker') || '';
    assert.ok(pickerSource, 'Expected EPM project picker renderer');

    assert.ok(pickerSource.includes('className="sprint-dropdown epm-project-dropdown"'), 'Expected Project to use the same dropdown shell as Sprint');
    assert.ok(pickerSource.includes('className={`sprint-dropdown-toggle ${showEpmProjectDropdown ? \'open\' : \'\'}`}'), 'Expected Project toggle to use sprint dropdown toggle styling');
    assert.ok(pickerSource.includes('className="sprint-dropdown-panel"'), 'Expected Project menu to use sprint dropdown panel styling');
    assert.ok(pickerSource.includes('className="sprint-dropdown-search"'), 'Expected Project menu to use the sprint dropdown search styling');
    assert.ok(pickerSource.includes('className="sprint-dropdown-option"'), 'Expected Project options to use sprint dropdown option styling');
    assert.ok(!pickerSource.includes('<select'), 'Project picker must not use a native select');
});

test('dashboard source keeps the ENG/EPM switch in the main header only', () => {
    assert.ok(dashboardSource.includes('renderViewSwitch()'), 'Expected renderViewSwitch() in dashboard.jsx');
    assert.strictEqual(countOccurrences(dashboardSource, 'renderViewSwitch()'), 1, 'Expected renderViewSwitch() only in the main header');
    assert.ok(
        hasCallAfter(dashboardSource, 'header-actions-row', 'renderViewSwitch()'),
        'Expected renderViewSwitch() near the main header actions row'
    );
});

test('dashboard source omits view and project selectors from compact sticky controls', () => {
    const compactControlsSource = getSnippetBetween(
        dashboardSource,
        'className="compact-sticky-header-controls"',
        'className="compact-sticky-header-search"'
    );
    assert.ok(!compactControlsSource.includes('renderViewSwitch()'), 'Did not expect ENG/EPM switch in compact sticky controls');
    assert.ok(!compactControlsSource.includes('renderEpmProjectPicker()'), 'Did not expect Project selector in compact sticky controls');
    assert.ok(!compactControlsSource.includes('showProjectPicker={true}'), 'Did not expect Project selector in compact sticky controls');
    assert.ok(compactControlsSource.includes("renderEpmControls('compact', false)"), 'Expected compact EPM controls to disable the Project selector');
    assert.ok(
        compactControlsSource.includes("shouldUseEpmSprint(epmTab) && renderSprintControl('compact')"),
        'Expected compact EPM Active controls to keep the sprint selector'
    );
});

test('dashboard source exposes EPM settings access in both header contexts', () => {
    assert.ok(dashboardSource.includes('openEpmSettingsTab'), 'Expected openEpmSettingsTab in dashboard.jsx');
    assert.ok(
        countOccurrences(dashboardSource, 'Open EPM settings') >= 2,
        'Expected Open EPM settings controls in both full and compact headers'
    );
});

test('epm helper file exists without ambiguous Active-only helper copy', () => {
    assert.ok(fs.existsSync(helperPath), 'Expected frontend/src/epm/epmProjectUtils.mjs to exist');
    assert.ok(helperSource.includes('shouldUseEpmSprint'), 'Expected shouldUseEpmSprint in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('buildRollupTree'), 'Expected buildRollupTree in epmProjectUtils.mjs');
    assert.ok(!helperSource.includes('getEpmSprintHelper'), 'Did not expect extra EPM sprint helper copy');
    assert.ok(!helperSource.includes('Active only'), 'Did not expect ambiguous Active only copy');
    assert.ok(!dashboardSource.includes('getEpmSprintHelper'), 'Did not expect dashboard.jsx to render ambiguous Active only copy');
    assert.ok(dashboardSource.includes('shouldUseEpmSprint'), 'Expected dashboard.jsx to reference shouldUseEpmSprint');
    assert.ok(epmViewDataSource.includes('buildRollupTree'), 'Expected useEpmViewData.js to reference buildRollupTree');
});

test('EPM module homes own rollup fetch and rendering while staying isolated from ENG concerns', () => {
    assert.ok(fs.existsSync(epmViewPath), 'Expected EPM view component');
    assert.ok(
        epmApiSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}') || epmApiSource.includes('/api/epm/projects/'),
        'Expected EPM fetch URLs to live in api/epmApi.js'
    );
    assert.ok(epmRollupPanelSource.includes('This rollup is truncated; narrow the label or Jira scope.'), 'Expected rollup truncation UI in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('No issues match this label in the current scope.'), 'Expected empty rollup UI in EpmRollupPanel.jsx');
    assert.ok(epmRollupTreeSource.includes('EpmInitiativeNode'), 'Expected reusable initiative renderer in EpmRollupTree.jsx');
    assert.ok(epmRollupTreeSource.includes('EpmEpicNode'), 'Expected reusable epic renderer in EpmRollupTree.jsx');
    assert.ok(epmRollupTreeSource.includes('EpmRollupIssue'), 'Expected reusable issue renderer in EpmRollupTree.jsx');

    for (const source of [epmApiSource, epmViewSource, epmRollupPanelSource, epmRollupTreeSource]) {
        assert.ok(!source.includes('/api/tasks-with-team-name'), 'EPM modules must not fetch ENG tasks');
        assert.ok(!source.includes('/api/backlog-epics'), 'EPM modules must not fetch ENG backlog epics');
        assert.ok(!source.includes('showPlanning'), 'EPM modules must not own planning state');
        assert.ok(!source.includes('showScenario'), 'EPM modules must not own scenario state');
    }
});

test('ENG task fetching effects are unreachable in EPM view', () => {
    assert.ok(fs.existsSync(engSprintDataPath), 'Expected ENG sprint data hook');
    assert.ok(engSprintDataSource.includes('fetchEngTasks(backendUrl'), 'Expected ENG task request wrapper in useEngSprintData.js');
    assert.ok(engSprintDataSource.includes('requestBacklogEpics(backendUrl'), 'Expected ENG backlog request wrapper in useEngSprintData.js');
    assert.ok(engSprintDataSource.includes('setProductTasksLoading(true)'), 'Expected product task loading state in useEngSprintData.js');
    assert.ok(engSprintDataSource.includes('setTechTasksLoading(true)'), 'Expected tech task loading state in useEngSprintData.js');
    assert.ok(!dashboardSource.includes('fetchEngTasks(BACKEND_URL'), 'Dashboard must not retain ENG task request wrapper markers');
    assert.ok(!dashboardSource.includes('requestBacklogEpics(BACKEND_URL'), 'Dashboard must not retain ENG backlog request wrapper markers');
    assertAllEngTaskEffectsGuarded();
});

test('EPM board fetches rollup with tab and sprint params while preserving active sprint gating', () => {
    assert.ok(fs.existsSync(epmViewDataPath), 'Expected useEpmViewData.js to own EPM view data fetching');
    assert.ok(epmViewDataSource.includes('fetchEpmProjectRollup(backendUrl, currentProjectId'), 'Expected EPM hook to fetch the rollup endpoint through wrapper');
    assert.ok(epmViewDataSource.includes('fetchEpmAllProjectsRollup(backendUrl'), 'Expected EPM hook to fetch the aggregate rollup endpoint through wrapper');
    assert.ok(epmViewDataSource.includes('tab: epmTab'), 'Expected EPM rollup wrapper call to include current tab');
    assert.ok(epmViewDataSource.includes('sprint: selectedSprint'), 'Expected EPM rollup wrapper call to include selected sprint');
    assert.ok(epmApiSource.includes("const params = new URLSearchParams({ tab: effectiveTab })"), 'Expected EPM rollup request to include tab parameter');
    assert.ok(epmApiSource.includes("params.set('sprint', String(sprint))"), 'Expected EPM rollup request to include selected sprint');
    assert.ok(epmApiSource.includes('/api/epm/projects/rollup/all?${params.toString()}'), 'Expected aggregate EPM rollup request wrapper');
    assert.ok(epmViewDataSource.includes("epmTab === 'active' && !selectedSprint"), 'Expected active tab to require selectedSprint before rollup fetch');
});

test('EPM project metadata fetch is scoped to the current lifecycle tab', () => {
    assert.ok(
        epmApiSource.includes('new URLSearchParams()') && epmApiSource.includes("params.set('tab', String(tab))"),
        'Expected EPM projects wrapper to add tab query parameter when provided'
    );
    assert.ok(
        epmViewDataSource.includes('fetchEpmProjects(backendUrl, { tab })'),
        'Expected EPM hook project metadata fetches to pass the current EPM tab'
    );
    assert.ok(
        epmViewDataSource.includes('const refreshEpmProjects = React.useCallback(async (options = {}) => {') &&
            epmViewDataSource.includes('const tab = options.tab || epmTab;'),
        'Expected refreshEpmProjects to default to the current EPM tab'
    );
    assert.ok(
        epmViewDataSource.includes('}, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId, epmTab]);'),
        'Expected EPM view refresh effect to reload project metadata when the EPM tab changes'
    );
});

test('EPM initial all-project load warms project metadata before all-project rollup', () => {
    assert.ok(fs.existsSync(epmViewDataPath), 'Expected useEpmViewData.js to own EPM cold-load sequencing');
    const functions = getConstFunctionBodies(epmViewDataSource);
    const refreshEpmViewSource = functions.get('refreshEpmView') || '';
    const refreshEpmRollupSource = functions.get('refreshEpmRollup') || '';
    assert.ok(
        refreshEpmRollupSource.includes('if (!hasSavedEpmScope) {'),
        'Expected EPM rollup refresh to skip when saved EPM scope is not loaded'
    );
    assert.ok(
        refreshEpmRollupSource.includes('if (epmProjectsPendingSelectionRef.current) {'),
        'Expected EPM rollup refresh to wait while project metadata is loading'
    );
    assert.ok(
        epmViewDataSource.includes('void refreshEpmView();'),
        'Expected EPM view load effect to enter the combined refresh workflow'
    );
    assert.ok(
        refreshEpmViewSource.includes("if (epmSelectedProjectId === '') {"),
        'Expected explicit all-project branch in EPM view refresh'
    );
    const projectsIndex = refreshEpmViewSource.indexOf('await refreshEpmProjects();');
    const rollupIndex = refreshEpmViewSource.indexOf("await refreshEpmRollup(null, '');");
    assert.ok(projectsIndex !== -1, 'Expected all-project branch to fetch project metadata first');
    assert.ok(rollupIndex !== -1, 'Expected all-project branch to fetch aggregate rollup after metadata');
    assert.ok(projectsIndex < rollupIndex, 'Expected project metadata to warm cache before aggregate rollup');
    assert.ok(
        !epmViewDataSource.includes("if (epmSelectedProjectId === '') {\n                    void refreshEpmProjects({ background: true });"),
        'EPM bootstrap must not start a background project fetch that races aggregate rollup'
    );
});

test('EPM board bootstraps saved config from initial user config before loading projects', () => {
    const functions = getConstFunctionBodies(dashboardSource);
    const loadConfigSource = functions.get('loadConfig') || '';
    const hookFunctions = getConstFunctionBodies(epmViewDataSource);
    const refreshEpmRollupSource = hookFunctions.get('refreshEpmRollup') || '';
    const effects = getUseEffectBodies(dashboardSource);
    const hookEffects = getUseEffectBodies(epmViewDataSource);
    const epmViewLoadEffect = hookEffects.find(body => body.includes("if (selectedView !== 'epm') return;") && body.includes('void refreshEpmView();')) || '';

    assert.ok(
        dashboardSource.includes('const [epmConfigLoaded, setEpmConfigLoaded] = useState(false);'),
        'Expected explicit EPM config loaded state'
    );
    assert.ok(
        dashboardSource.includes('const applySavedEpmConfig = (config) => {'),
        'Expected shared helper for applying saved EPM config'
    );
    assert.ok(
        loadConfigSource.includes('applySavedEpmConfig(config.epm);'),
        'Expected main user config load to hydrate saved EPM config'
    );
    assert.ok(
        refreshEpmRollupSource.includes('if (!epmConfigLoaded) {'),
        'Expected rollup refresh to wait for saved EPM config bootstrap'
    );
    assert.ok(
        epmViewLoadEffect.includes('if (!epmConfigLoaded) return;'),
        'Expected EPM view load effect to wait for saved EPM config bootstrap'
    );
    assert.ok(
        epmViewDataSource.includes('}, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId, epmTab]);'),
        'Expected EPM view load effect to rerun after config bootstrap and tab changes'
    );
});

test('EPM defaults to all projects and exposes sprint controls in Active', () => {
    assert.ok(fs.existsSync(epmControlsPath), 'Expected EPM controls component');
    const pickerSnippet = getConstFunctionBodies(epmControlsSource).get('renderEpmProjectPicker') || '';
    assert.ok(pickerSnippet, 'Expected EPM project picker renderer');
    assert.ok(pickerSnippet.includes('All projects'), 'Expected blank EPM project selection to mean All projects');
    assert.ok(!pickerSnippet.includes('Select project...'), 'Did not expect single-project placeholder copy');
    assert.ok(epmViewDataSource.includes("epmSelectedProjectId === ''"), 'Expected explicit all-projects branch for blank EPM project selection');
    assert.ok(dashboardSource.includes("shouldUseEpmSprint(epmTab) && renderSprintControl('main')"), 'Expected EPM Active main controls to render the sprint selector');
    assert.ok(dashboardSource.includes("shouldUseEpmSprint(epmTab) && renderSprintControl('compact')"), 'Expected EPM Active compact controls to render the sprint selector');
    assert.ok(
        epmViewDataSource.includes("currentProject.matchState === 'metadata-only' && !currentProject.label"),
        'Expected metadata-only shortcut to apply only when no label is present'
    );
    assert.ok(
        epmViewDataSource.indexOf("epmTab === 'active' && !selectedSprint") <
            epmViewDataSource.indexOf("currentProject.matchState === 'metadata-only' && !currentProject.label"),
        'Expected sprint-required guard to run before metadata-only rendering'
    );
    assert.ok(
        dashboardSource.includes('flattenEpmRollupBoardsForDependencies'),
        'Expected EPM rollup issues to feed the dependency lookup task list'
    );
    assert.ok(
        epmRollupPanelSource.includes("from '../issues/IssueCard.jsx';"),
        'Expected EPM rollup panel to render the shared issue card directly'
    );
    assert.ok(!epmRollupPanelSource.includes('renderEpicBlock'), 'EPM rollup panel must not depend on dashboard ENG render callbacks');
    assert.ok(
        dashboardSource.includes("const shouldRenderIssueDependencies = (selectedView === 'eng' || selectedView === 'epm') && showDependencies"),
        'Expected EPM to show the same dependency pills, strips, and focus details as ENG'
    );
});

test('ENG and EPM issue cards use shared issue components without EPM importing dashboard code', () => {
    assert.ok(fs.existsSync(issueCardPath), 'Expected shared IssueCard component');
    assert.ok(fs.existsSync(issueDependenciesPath), 'Expected shared IssueDependencies component');
    assert.ok(issueCardSource.includes("from './IssueDependencies.jsx';"), 'Expected IssueCard to compose IssueDependencies');
    assert.ok(issueCardSource.includes('<StatusPill'), 'Expected IssueCard to preserve status pill rendering');
    assert.ok(issueCardSource.includes('className="task-header"'), 'Expected IssueCard to preserve task header structure');
    assert.ok(issueCardSource.includes('className="task-team"'), 'Expected IssueCard to preserve team label structure');
    assert.ok(issueDependenciesSource.includes('dependency-pill-stack'), 'Expected dependency pills in IssueDependencies');
    assert.ok(issueDependenciesSource.includes('dependency-strip'), 'Expected dependency strips in IssueDependencies');
    assert.ok(issueDependenciesSource.includes('dependency-missing'), 'Expected dependency focus details in IssueDependencies');
    assert.ok(dashboardSource.includes("from './issues/IssueCard.jsx';"), 'Expected dashboard ENG renderer to import shared IssueCard');
    assert.ok(epmRollupPanelSource.includes("from '../issues/IssueCard.jsx';"), 'Expected EPM renderer to import shared IssueCard');
    assert.ok(!epmRollupPanelSource.includes("from '../dashboard"), 'EPM must not import dashboard modules');
    assert.ok(!epmRollupPanelSource.includes('buildEpmEngEpicGroup'), 'EPM must not adapt rollups through ENG epic groups');
    assert.ok(!epmViewSource.includes('renderEpicBlock'), 'EPM view shell must not pass dashboard ENG render callbacks');
});

test('EPM project identity positions use project id only', () => {
    assert.ok(fs.existsSync(epmControlsPath), 'Expected EPM controls component');
    assert.ok(helperSource.includes("return String(project?.id || '').trim()"), 'Expected project identity helper to use project.id only');
    assert.ok(!helperSource.includes('project?.id || project?.homeProjectId'), 'Expected no homeProjectId fallback in identity helper');

    const selectedLookupSnippet = getSnippetBetween(
        epmViewDataSource,
        'const selectedEpmProject = visibleEpmProjects.find',
        'const filteredEpmProjects'
    );
    assert.ok(selectedLookupSnippet.includes('getEpmProjectIdentity(project) === epmSelectedProjectId'), 'Expected selected lookup to use project id identity helper');
    assert.ok(!selectedLookupSnippet.includes('homeProjectId'), 'Expected selected lookup not to reference homeProjectId');

    const rollupFetchSnippet = getSnippetBetween(
        epmViewDataSource,
        'const refreshEpmRollup = React.useCallback',
        'const loadArchivedEpmProjectRollup = React.useCallback'
    );
    assert.ok(rollupFetchSnippet.includes('getEpmProjectIdentity(currentProject)'), 'Expected rollup URL id to come from project id identity helper');
    assert.ok(rollupFetchSnippet.includes('fetchEpmProjectRollup(backendUrl, currentProjectId'), 'Expected rollup request to use current project id');
    assert.ok(epmApiSource.includes('encodeURIComponent(projectId)}/rollup'), 'Expected rollup URL wrapper to encode current project id');
    assert.ok(!rollupFetchSnippet.includes('homeProjectId'), 'Expected rollup URL path logic not to reference homeProjectId');

    const pickerSnippet = getConstFunctionBodies(epmControlsSource).get('renderEpmProjectPicker') || '';
    assert.ok(pickerSnippet, 'Expected EPM project picker renderer');
    assert.ok(epmViewDataSource.includes('const projects = visibleEpmProjects.filter(project => getEpmProjectIdentity(project));'), 'Expected picker source to omit projects with no project.id');
    assert.ok(pickerSnippet.includes('const projectId = getEpmProjectIdentity(project)'), 'Expected picker option key/value to use project id identity helper');
    assert.ok(pickerSnippet.includes('key={projectId}'), 'Expected picker option key to use project id');
    assert.ok(pickerSnippet.includes('data-project-id={projectId}'), 'Expected picker option value to use project id');
    assert.ok(!pickerSnippet.includes('homeProjectId'), 'Expected picker identity logic not to reference homeProjectId');
});

test('EPM rollup renderer branches on metadata, empty, truncated, and tree states', () => {
    assert.ok(epmRollupPanelSource.includes("epmRollupTree?.kind === 'metadataOnly'"), 'Expected metadata-only rollup branch in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('Open Settings'), 'Expected metadata-only branch to show OPEN SETTINGS CTA');
    assert.ok(epmRollupPanelSource.includes("epmRollupTree?.kind === 'emptyRollup'"), 'Expected empty rollup branch in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('No issues match this label in the current scope'), 'Expected distinct empty rollup message');
    assert.ok(epmRollupPanelSource.includes("epmRollupTree?.kind !== 'tree'"), 'Expected populated tree guard in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('This rollup is truncated; narrow the label or Jira scope.'), 'Expected truncated rollup warning');
});

test('EPM rollup renderer groups Initiative to Epic to Story and keeps orphans under Project', () => {
    assert.ok(epmRollupPanelSource.includes('tree.initiatives.map'), 'Expected initiatives to be rendered from rollup tree');
    assert.ok(epmRollupPanelSource.includes('initiativeNode.epics.map'), 'Expected epics to be rendered under initiatives');
    assert.ok(epmRollupPanelSource.includes('renderEpmEpicBlock(epicNode)'), 'Expected EPM epics to use shared issue card renderer');
    assert.ok(epmRollupPanelSource.includes('tree.rootEpics.map'), 'Expected root epics to render directly under Project');
    assert.ok(epmRollupPanelSource.includes('tree.orphanStories'), 'Expected orphan stories to render directly under Project');
    assert.ok(epmRollupPanelSource.includes('Project stories'), 'Expected orphan stories section under Project');
    assert.ok(epmRollupPanelSource.includes("key: 'NO_EPIC'") && epmRollupPanelSource.includes('renderKey: key'), 'Expected story-only groups to keep unique React keys without linking synthetic Jira issue keys');
});

test('EPM portfolio project header separates collapse control from metadata', () => {
    const headerSource = getSnippetBetween(
        epmRollupPanelSource,
        'const renderPortfolioHeader = (project) => {',
        'const buildDuplicateClusters = () => {'
    );
    const toggleStart = headerSource.indexOf('className="epm-project-board-toggle"');
    const toggleEnd = headerSource.indexOf('</button>', toggleStart);
    assert.notStrictEqual(toggleStart, -1, 'Expected a dedicated project board toggle button');
    assert.notStrictEqual(toggleEnd, -1, 'Expected project board toggle button to close');
    const toggleSource = headerSource.slice(toggleStart, toggleEnd);

    assert.ok(headerSource.includes('className={`epm-project-board-header ${collapsed ? \'is-collapsed\' : \'\'}`}'), 'Expected project header wrapper');
    assert.ok(headerSource.includes('className="epm-project-board-meta"'), 'Expected project metadata wrapper outside the toggle');
    assert.ok(!toggleSource.includes('epm-project-board-link'), 'Project Home link must not be nested inside the toggle button');
    assert.ok(!toggleSource.includes('epm-project-board-update'), 'Project update text must not be nested inside the toggle button');
    assert.ok(!toggleSource.includes('<a'), 'Project toggle button must not contain nested anchors');
    assert.ok(dashboardCssSource.includes('.epm-project-board-toggle'), 'Expected CSS for the dedicated project board toggle');
    assert.ok(dashboardCssSource.includes('.epm-project-board-meta'), 'Expected CSS for bounded project board metadata');
});

test('EPM portfolio update line renders below the project header with relative date fallback', () => {
    const headerSource = getSnippetBetween(
        epmRollupPanelSource,
        'const renderPortfolioHeader = (project) => {',
        'const buildDuplicateClusters = () => {'
    );
    const headerCloseIndex = headerSource.indexOf('</div>');
    const updateIndex = headerSource.indexOf('renderProjectUpdate(updateLine)');
    assert.ok(epmRollupPanelSource.includes('className="epm-project-board-update"'), 'Expected visible project board update line');
    assert.ok(updateIndex > headerCloseIndex, 'Project update line must render after the header wrapper');

    const metaStart = headerSource.indexOf('className="epm-project-board-meta"');
    const metaEnd = headerSource.indexOf('</div>', metaStart);
    const metaSource = headerSource.slice(metaStart, metaEnd);
    assert.ok(!metaSource.includes('epm-project-board-update'), 'Project update line must not live inside metadata');
    assert.ok(epmRollupPanelSource.includes('buildEpmProjectUpdateLine(project)'), 'Expected board update line to use shared relative-date helper');
    assert.ok(epmRollupPanelSource.includes('title={updateLine.title || undefined}'), 'Expected exact update date on hover');
    assert.ok(helperSource.includes('export function buildEpmProjectUpdateLine'), 'Expected shared EPM project update line helper');
});

test('EPM portfolio update line preserves formatted Home update HTML safely', () => {
    assert.ok(epmRollupPanelSource.includes('className="epm-project-board-update-row"'), 'Expected update row wrapper to separate bubble from date');
    assert.ok(epmRollupPanelSource.includes('updateLine.messageHtml'), 'Expected update renderer to branch on formatted Home update HTML');
    assert.ok(epmRollupPanelSource.includes('dangerouslySetInnerHTML={{ __html: updateLine.messageHtml }}'), 'Expected formatted update HTML to be injected from sanitized server output');
    const updateRendererSource = getSnippetBetween(
        epmRollupPanelSource,
        'const renderProjectUpdate = (updateLine) => {',
        'const renderPortfolioHeader = (project) => {'
    );
    assert.ok(updateRendererSource.includes('epm-project-board-update-date'), 'Expected relative date label in the update bubble');
    assert.ok(
        updateRendererSource.indexOf('epm-project-board-update-date') < updateRendererSource.indexOf('epm-project-board-update-copy'),
        'Expected relative date label to render above the update copy'
    );
    assert.ok(helperSource.includes('messageHtml'), 'Expected shared update helper to expose formatted update HTML');
    assert.ok(helperSource.includes('message:'), 'Expected shared update helper to expose plain message without the date');
});

test('EPM project hover states document and enforce accessible contrast', () => {
    assert.ok(
        dashboardCssSource.includes('EPM hover contrast principle:'),
        'Expected CSS to document the EPM hover contrast principle'
    );
    assert.ok(
        dashboardCssSource.includes('--epm-project-radius: 8px;'),
        'Expected EPM project rectangles to share one radius token'
    );
    assert.ok(
        countOccurrences(dashboardCssSource, 'border-radius: var(--epm-project-radius);') >= 3,
        'Expected EPM project rectangular surfaces to reuse the shared radius token'
    );
    assert.ok(
        !dashboardCssSource.includes('border-radius: 18px 18px 18px 5px;'),
        'Expected update bubble to avoid bespoke large/tail rounding'
    );
    assert.ok(
        dashboardCssSource.includes('.epm-project-board-toggle:hover {'),
        'Expected EPM project toggle to own its hover style instead of inheriting global button:hover'
    );
    assert.ok(
        dashboardCssSource.includes('background: var(--epm-project-hover-surface);'),
        'Expected EPM project toggle hover to use a light accent surface'
    );
    assert.ok(
        dashboardCssSource.includes('transform: none;'),
        'Expected EPM project toggle hover to reset the global button hover transform'
    );
    assert.ok(
        dashboardCssSource.includes('box-shadow: 0 2px 8px rgba(7, 71, 166, 0.14);'),
        'Expected EPM project toggle hover to use a visible but low-contrast-safe affordance'
    );
});

test('EPM rollup helper dedupes by issue key before rendering', () => {
    assert.ok(helperSource.includes('const seenKeys = new Set()'), 'Expected rollup tree builder to track seen issue keys');
    assert.ok(helperSource.includes('seenKeys.has(key)'), 'Expected rollup tree builder to skip duplicate issue keys');
    assert.ok(helperSource.includes('seenKeys.add(key)'), 'Expected rollup tree builder to remember rendered issue keys');
});

test('EPM project helper uses strict backlog and archived lifecycle buckets', () => {
    assert.ok(helperSource.includes("normalizedTab === 'active'"), 'Expected active tab to own custom all project visibility');
    assert.ok(helperSource.includes("ACTIVE_EPM_PROJECT_STATES = new Set(['pending', 'on track', 'at risk', 'off track'])"), 'Expected active tab to include pending and active Home states');
    assert.ok(helperSource.includes("BACKLOG_EPM_PROJECT_STATES = new Set(['paused'])"), 'Expected backlog tab to be limited to paused states');
    assert.ok(helperSource.includes("ARCHIVED_EPM_PROJECT_STATES"), 'Expected archived tab to be limited to archived/completed states');
    assert.ok(helperSource.includes('filterEpmRollupBoardsForSearch'), 'Expected EPM board search helper');
});

test('EPM archived portfolio boards lazy-load Jira rollups on expand', () => {
    assert.ok(epmRollupPanelSource.includes("epmTab === 'archived'"), 'Expected archived boards to initialize collapsed');
    assert.ok(epmRollupPanelSource.includes('onProjectExpand(project)'), 'Expected project expand callback in EpmRollupPanel.jsx');
    assert.ok(dashboardSource.includes('loadArchivedEpmProjectRollup'), 'Expected archived lazy rollup loader in dashboard.jsx');
    assert.ok(epmViewDataSource.includes('fetchEpmProjectRollup(backendUrl, projectId'), 'Expected archived expand to fetch the per-project rollup');
});
