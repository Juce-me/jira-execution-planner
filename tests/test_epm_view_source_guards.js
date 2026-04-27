const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const epmFetchPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmFetch.js');
const epmRollupPanelPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupPanel.jsx');
const epmRollupTreePath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupTree.jsx');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');

const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const epmFetchSource = fs.readFileSync(epmFetchPath, 'utf8');
const epmRollupPanelSource = fs.existsSync(epmRollupPanelPath) ? fs.readFileSync(epmRollupPanelPath, 'utf8') : '';
const epmRollupTreeSource = fs.existsSync(epmRollupTreePath) ? fs.readFileSync(epmRollupTreePath, 'utf8') : '';
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
    const functionPattern = /const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
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
        'fetchBacklogEpics('
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
        'fetchBacklogEpics('
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
    assert.ok(dashboardSource.includes('mode-switch'), 'Expected mode-switch usage in dashboard.jsx');
    assert.ok(dashboardSource.includes('mode-switch-button'), 'Expected mode-switch-button usage in dashboard.jsx');
    assert.ok(!dashboardSource.includes('view-switch'), 'Did not expect view-switch in dashboard.jsx');
});

test('dashboard source reuses renderViewSwitch in both header contexts', () => {
    assert.ok(dashboardSource.includes('renderViewSwitch()'), 'Expected renderViewSwitch() in dashboard.jsx');
    assert.ok(countOccurrences(dashboardSource, 'renderViewSwitch()') >= 2, 'Expected renderViewSwitch() in both header contexts');
    assert.ok(
        hasCallAfter(dashboardSource, 'header-actions-row', 'renderViewSwitch()'),
        'Expected renderViewSwitch() near the main header actions row'
    );
    assert.ok(
        hasCallAfter(dashboardSource, 'compact-sticky-header-controls', 'renderViewSwitch()'),
        'Expected renderViewSwitch() near the compact sticky header controls'
    );
});

test('dashboard source exposes EPM settings access in both header contexts', () => {
    assert.ok(dashboardSource.includes('openEpmSettingsTab'), 'Expected openEpmSettingsTab in dashboard.jsx');
    assert.ok(
        countOccurrences(dashboardSource, 'Open EPM settings') >= 2,
        'Expected Open EPM settings controls in both full and compact headers'
    );
});

test('epm helper file exists and owns the Active only copy', () => {
    assert.ok(fs.existsSync(helperPath), 'Expected frontend/src/epm/epmProjectUtils.mjs to exist');
    assert.ok(helperSource.includes('shouldUseEpmSprint'), 'Expected shouldUseEpmSprint in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('getEpmSprintHelper'), 'Expected getEpmSprintHelper in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('buildRollupTree'), 'Expected buildRollupTree in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('Active only'), 'Expected Active only in epmProjectUtils.mjs');
    assert.ok(dashboardSource.includes('getEpmSprintHelper'), 'Expected dashboard.jsx to reference getEpmSprintHelper');
    assert.ok(dashboardSource.includes('shouldUseEpmSprint'), 'Expected dashboard.jsx to reference shouldUseEpmSprint');
    assert.ok(dashboardSource.includes('buildRollupTree'), 'Expected dashboard.jsx to reference buildRollupTree');
});

test('EPM module homes own rollup fetch and rendering while staying isolated from ENG concerns', () => {
    assert.ok(
        epmFetchSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}') || epmFetchSource.includes('/api/epm/projects/'),
        'Expected EPM fetch URLs to live in epmFetch.js'
    );
    assert.ok(epmRollupPanelSource.includes('This rollup is truncated; narrow the label or Jira scope.'), 'Expected rollup truncation UI in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('No issues match this label in the current scope.'), 'Expected empty rollup UI in EpmRollupPanel.jsx');
    assert.ok(epmRollupTreeSource.includes('EpmInitiativeNode'), 'Expected reusable initiative renderer in EpmRollupTree.jsx');
    assert.ok(epmRollupTreeSource.includes('EpmEpicNode'), 'Expected reusable epic renderer in EpmRollupTree.jsx');
    assert.ok(epmRollupTreeSource.includes('EpmRollupIssue'), 'Expected reusable issue renderer in EpmRollupTree.jsx');

    for (const source of [epmFetchSource, epmRollupPanelSource, epmRollupTreeSource]) {
        assert.ok(!source.includes('/api/tasks-with-team-name'), 'EPM modules must not fetch ENG tasks');
        assert.ok(!source.includes('/api/backlog-epics'), 'EPM modules must not fetch ENG backlog epics');
        assert.ok(!source.includes('showPlanning'), 'EPM modules must not own planning state');
        assert.ok(!source.includes('showScenario'), 'EPM modules must not own scenario state');
    }
});

test('ENG task fetching effects are unreachable in EPM view', () => {
    assert.ok(dashboardSource.includes('/api/tasks-with-team-name'), 'Expected ENG task endpoint in dashboard.jsx');
    assert.ok(dashboardSource.includes('/api/backlog-epics'), 'Expected ENG backlog endpoint in dashboard.jsx');
    assert.ok(dashboardSource.includes('setProductTasksLoading(true)'), 'Expected product task loading state in dashboard.jsx');
    assert.ok(dashboardSource.includes('setTechTasksLoading(true)'), 'Expected tech task loading state in dashboard.jsx');
    assertAllEngTaskEffectsGuarded();
});

test('EPM board fetches rollup with tab and sprint params while preserving active sprint gating', () => {
    assert.ok(dashboardSource.includes('fetchEpmProjectRollup(BACKEND_URL, currentProjectId'), 'Expected EPM board to fetch the rollup endpoint through wrapper');
    assert.ok(dashboardSource.includes('tab: epmTab'), 'Expected EPM rollup wrapper call to include current tab');
    assert.ok(dashboardSource.includes('sprint: selectedSprint'), 'Expected EPM rollup wrapper call to include selected sprint');
    assert.ok(epmFetchSource.includes("const params = new URLSearchParams({ tab: effectiveTab })"), 'Expected EPM rollup request to include tab parameter');
    assert.ok(epmFetchSource.includes("params.set('sprint', String(sprint))"), 'Expected EPM rollup request to include selected sprint');
    assert.ok(dashboardSource.includes("epmTab === 'active' && !selectedSprint"), 'Expected active tab to require selectedSprint before rollup fetch');
});

test('EPM project identity positions use project id only', () => {
    assert.ok(helperSource.includes("return String(project?.id || '').trim()"), 'Expected project identity helper to use project.id only');
    assert.ok(!helperSource.includes('project?.id || project?.homeProjectId'), 'Expected no homeProjectId fallback in identity helper');

    const selectedLookupSnippet = getSnippetBetween(
        dashboardSource,
        'const selectedEpmProject = visibleEpmProjects.find',
        'const loadEpmConfig'
    );
    assert.ok(selectedLookupSnippet.includes('getEpmProjectIdentity(project) === epmSelectedProjectId'), 'Expected selected lookup to use project id identity helper');
    assert.ok(!selectedLookupSnippet.includes('homeProjectId'), 'Expected selected lookup not to reference homeProjectId');

    const rollupFetchSnippet = getSnippetBetween(
        dashboardSource,
        'const refreshEpmRollup = async',
        'const refreshEpmView = async'
    );
    assert.ok(rollupFetchSnippet.includes('getEpmProjectIdentity(currentProject)'), 'Expected rollup URL id to come from project id identity helper');
    assert.ok(rollupFetchSnippet.includes('fetchEpmProjectRollup(BACKEND_URL, currentProjectId'), 'Expected rollup request to use current project id');
    assert.ok(epmFetchSource.includes('encodeURIComponent(projectId)}/rollup'), 'Expected rollup URL wrapper to encode current project id');
    assert.ok(!rollupFetchSnippet.includes('homeProjectId'), 'Expected rollup URL path logic not to reference homeProjectId');

    const pickerSnippet = getSnippetBetween(
        dashboardSource,
        'const renderEpmProjectPicker = () =>',
        'const renderSprintControl ='
    );
    assert.ok(pickerSnippet.includes('visibleEpmProjects.filter(project => getEpmProjectIdentity(project)).map'), 'Expected picker to omit projects with no project.id');
    assert.ok(pickerSnippet.includes('const projectId = getEpmProjectIdentity(project)'), 'Expected picker option key/value to use project id identity helper');
    assert.ok(pickerSnippet.includes('<option key={projectId} value={projectId}>'), 'Expected picker option key/value to use project id');
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
    assert.ok(epmRollupPanelSource.includes('epmRollupTree.initiatives.map'), 'Expected initiatives to be rendered from rollup tree');
    assert.ok(epmRollupTreeSource.includes('initiativeNode.epics.map'), 'Expected epics to be rendered under initiatives');
    assert.ok(epmRollupTreeSource.includes('epicNode.stories.map'), 'Expected stories to be rendered under epics');
    assert.ok(epmRollupTreeSource.includes('tree.rootEpics.map'), 'Expected root epics to render directly under Project');
    assert.ok(epmRollupTreeSource.includes('tree.orphanStories.map'), 'Expected orphan stories to render directly under Project');
    assert.ok(epmRollupTreeSource.includes('Project stories'), 'Expected orphan stories section under Project');
});

test('EPM rollup helper dedupes by issue key before rendering', () => {
    assert.ok(helperSource.includes('const seenKeys = new Set()'), 'Expected rollup tree builder to track seen issue keys');
    assert.ok(helperSource.includes('seenKeys.has(key)'), 'Expected rollup tree builder to skip duplicate issue keys');
    assert.ok(helperSource.includes('seenKeys.add(key)'), 'Expected rollup tree builder to remember rendered issue keys');
});

test('EPM project helper keeps custom all bucket visible on every tab', () => {
    assert.ok(helperSource.includes("tabBucket === 'all'"), 'Expected tabBucket all wildcard in filterEpmProjectsForTab');
    assert.ok(helperSource.includes('tabBucket === normalizedTab'), 'Expected lifecycle buckets to match only the current tab');
});
