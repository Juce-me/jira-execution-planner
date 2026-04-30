const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const dashboardCssPath = path.join(__dirname, '..', 'frontend', 'dist', 'dashboard.css');
const epmFetchPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmFetch.js');
const epmRollupPanelPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupPanel.jsx');
const epmRollupTreePath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupTree.jsx');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');

const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const dashboardCssSource = fs.existsSync(dashboardCssPath) ? fs.readFileSync(dashboardCssPath, 'utf8') : '';
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
    assert.ok(dashboardSource.includes('fetchEpmAllProjectsRollup(BACKEND_URL'), 'Expected EPM all-projects mode to fetch the aggregate rollup endpoint through wrapper');
    assert.ok(dashboardSource.includes('tab: epmTab'), 'Expected EPM rollup wrapper call to include current tab');
    assert.ok(dashboardSource.includes('sprint: selectedSprint'), 'Expected EPM rollup wrapper call to include selected sprint');
    assert.ok(epmFetchSource.includes("const params = new URLSearchParams({ tab: effectiveTab })"), 'Expected EPM rollup request to include tab parameter');
    assert.ok(epmFetchSource.includes("params.set('sprint', String(sprint))"), 'Expected EPM rollup request to include selected sprint');
    assert.ok(epmFetchSource.includes('/api/epm/projects/rollup/all?${params.toString()}'), 'Expected aggregate EPM rollup request wrapper');
    assert.ok(dashboardSource.includes("epmTab === 'active' && !selectedSprint"), 'Expected active tab to require selectedSprint before rollup fetch');
});

test('EPM initial all-project load fetches rollup before background project metadata refresh', () => {
    const functions = getConstFunctionBodies(dashboardSource);
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
        dashboardSource.includes('void refreshEpmView();'),
        'Expected EPM view load effect to enter the combined refresh workflow'
    );
    assert.ok(
        refreshEpmViewSource.includes("if (epmSelectedProjectId === '') {"),
        'Expected explicit all-project branch in EPM view refresh'
    );
    assert.ok(
        refreshEpmViewSource.includes("await refreshEpmRollup(null, '');"),
        'Expected all-project branch to fetch rollup without waiting for the project picker list'
    );
    assert.ok(
        refreshEpmViewSource.includes('void refreshEpmProjects({ background: true });'),
        'Expected all-project branch to refresh Home project metadata in the background'
    );
    assert.ok(
        dashboardSource.includes("if (epmSelectedProjectId === '') {\n                    void refreshEpmProjects({ background: true });"),
        'Expected EPM bootstrap effect to refresh project metadata in the background for all-project mode'
    );
});

test('EPM board bootstraps saved config from initial user config before loading projects', () => {
    const functions = getConstFunctionBodies(dashboardSource);
    const loadConfigSource = functions.get('loadConfig') || '';
    const refreshEpmRollupSource = functions.get('refreshEpmRollup') || '';
    const effects = getUseEffectBodies(dashboardSource);
    const epmViewLoadEffect = effects.find(body => body.includes("if (selectedView !== 'epm') return;") && body.includes('void refreshEpmView();')) || '';

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
        dashboardSource.includes('}, [selectedView, epmConfigLoaded, hasSavedEpmScope, epmSelectedProjectId]);'),
        'Expected EPM view load effect to rerun after config bootstrap'
    );
});

test('EPM defaults to all projects and exposes sprint controls in Active', () => {
    const pickerSnippet = getSnippetBetween(
        dashboardSource,
        'const renderEpmProjectPicker = () =>',
        'const renderSprintControl ='
    );
    assert.ok(pickerSnippet.includes('<option value="">All projects</option>'), 'Expected blank EPM project selection to mean All projects');
    assert.ok(!pickerSnippet.includes('Select project...'), 'Did not expect single-project placeholder copy');
    assert.ok(dashboardSource.includes("epmSelectedProjectId === ''"), 'Expected explicit all-projects branch for blank EPM project selection');
    assert.ok(dashboardSource.includes("shouldUseEpmSprint(epmTab) && renderSprintControl('main')"), 'Expected EPM Active main controls to render the sprint selector');
    assert.ok(dashboardSource.includes("shouldUseEpmSprint(epmTab) && renderSprintControl('compact')"), 'Expected EPM Active compact controls to render the sprint selector');
    assert.ok(
        dashboardSource.includes("currentProject.matchState === 'metadata-only' && !currentProject.label"),
        'Expected metadata-only shortcut to apply only when no label is present'
    );
    assert.ok(
        dashboardSource.indexOf("epmTab === 'active' && !selectedSprint") <
            dashboardSource.indexOf("currentProject.matchState === 'metadata-only' && !currentProject.label"),
        'Expected sprint-required guard to run before metadata-only rendering'
    );
    assert.ok(
        dashboardSource.includes('flattenEpmRollupBoardsForDependencies'),
        'Expected EPM rollup issues to feed the dependency lookup task list'
    );
    assert.ok(
        epmRollupPanelSource.includes('renderEpicBlock'),
        'Expected EPM rollup panel to reuse the ENG Epic/Story task renderer'
    );
    assert.ok(
        dashboardSource.includes("const shouldRenderIssueDependencies = (selectedView === 'eng' || selectedView === 'epm') && showDependencies"),
        'Expected EPM to show the same dependency pills, strips, and focus details as ENG'
    );
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
    assert.ok(epmRollupPanelSource.includes('tree.initiatives.map'), 'Expected initiatives to be rendered from rollup tree');
    assert.ok(epmRollupPanelSource.includes('initiativeNode.epics.map'), 'Expected epics to be rendered under initiatives');
    assert.ok(epmRollupPanelSource.includes('renderEpicBlock(buildEpmEngEpicGroup(epicNode))'), 'Expected EPM epics to use ENG Epic/Story renderer');
    assert.ok(epmRollupPanelSource.includes('tree.rootEpics.map'), 'Expected root epics to render directly under Project');
    assert.ok(epmRollupPanelSource.includes('tree.orphanStories'), 'Expected orphan stories to render directly under Project');
    assert.ok(epmRollupPanelSource.includes('Project stories'), 'Expected orphan stories section under Project');
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
    assert.ok(epmRollupPanelSource.includes('epm-project-board-update-date'), 'Expected relative date to stay separate from formatted update HTML');
    assert.ok(epmRollupPanelSource.indexOf('className="epm-project-board-update"') < epmRollupPanelSource.indexOf('className="epm-project-board-update-date"'), 'Expected date component to render to the right of the bubble');
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
    assert.ok(helperSource.includes("BACKLOG_EPM_PROJECT_STATES"), 'Expected backlog tab to be limited to paused/pending states');
    assert.ok(helperSource.includes("ARCHIVED_EPM_PROJECT_STATES"), 'Expected archived tab to be limited to archived/completed states');
    assert.ok(helperSource.includes('filterEpmRollupBoardsForSearch'), 'Expected EPM board search helper');
});

test('EPM archived portfolio boards lazy-load Jira rollups on expand', () => {
    assert.ok(epmRollupPanelSource.includes("epmTab === 'archived'"), 'Expected archived boards to initialize collapsed');
    assert.ok(epmRollupPanelSource.includes('onProjectExpand(project)'), 'Expected project expand callback in EpmRollupPanel.jsx');
    assert.ok(dashboardSource.includes('loadArchivedEpmProjectRollup'), 'Expected archived lazy rollup loader in dashboard.jsx');
    assert.ok(dashboardSource.includes('fetchEpmProjectRollup(BACKEND_URL, projectId'), 'Expected archived expand to fetch the per-project rollup');
});
