const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const epmFetchPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmFetch.js');
const epmRollupPanelPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupPanel.jsx');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const epmFetchSource = fs.readFileSync(epmFetchPath, 'utf8');
const epmRollupPanelSource = fs.readFileSync(epmRollupPanelPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function countOccurrences(source, needle) {
    return (source.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

test('dashboard source includes the EPM shell project picker and ENG gating hooks', () => {
    assert.ok(helperSource.includes('filterEpmProjectsForTab'), 'Expected filterEpmProjectsForTab in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('getEpmProjectDisplayName'), 'Expected getEpmProjectDisplayName in epmProjectUtils.mjs');
    assert.ok(helperSource.includes("String(tab || 'active')"), 'Expected active tab defaulting in epmProjectUtils.mjs');
    assert.ok(dashboardSource.includes('const selectedEpmProject = visibleEpmProjects.find((project) => getEpmProjectIdentity(project) === epmSelectedProjectId) || null;'), 'Expected selectedEpmProject derivation in dashboard.jsx');
    assert.ok(
        countOccurrences(dashboardSource + epmRollupPanelSource, 'getEpmProjectDisplayName(selectedEpmProject)') >= 2,
        'Expected selected project display name helper across dashboard.jsx and EpmRollupPanel.jsx'
    );
    assert.ok(dashboardSource.includes('getEpmProjectDisplayName(project)'), 'Expected project picker display name helper in dashboard.jsx');
    assert.ok(dashboardSource.includes("setEpmSelectedProjectId('')"), 'Expected invalid EPM selection clearing in dashboard.jsx');
    assert.ok(dashboardSource.includes('epmSelectedProjectId'), 'Expected epmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes('setEpmSelectedProjectId'), 'Expected setEpmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showDependencies"), 'Expected ENG-only dependency gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showPlanning"), 'Expected ENG-only planning gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showStats"), 'Expected ENG-only stats gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showScenario"), 'Expected ENG-only scenario gating in dashboard.jsx');
});

test('dashboard source wires EPM rollup loading and metadata-only rendering', () => {
    assert.ok(dashboardSource.includes("if (selectedView !== 'epm') return;"), 'Expected EPM-only project loading effect');
    assert.ok(dashboardSource.includes('const loadEpmProjects = () => fetchEpmProjects(BACKEND_URL);'), 'Expected dashboard.jsx to load EPM projects through wrapper');
    assert.ok(epmFetchSource.includes("fetch(`${backendUrl}/api/epm/projects`, { cache: 'no-cache' })"), 'Expected EPM projects fetch in epmFetch.js');
    assert.ok(epmFetchSource.includes('export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {'), 'Expected EPM configuration project loader');
    assert.ok(epmFetchSource.includes('const refreshParam = forceRefresh ? \'?refresh=true\' : \'\';'), 'Expected project configuration refresh query support');
    assert.ok(epmFetchSource.includes('fetch(`${backendUrl}/api/epm/projects/configuration${refreshParam}`'), 'Expected configuration fetch endpoint');
    assert.ok(!epmFetchSource.includes('/api/epm/projects/preview'), 'EPM settings must not call preview endpoint');
    assert.ok(dashboardSource.includes("if (epmTab === 'active' && !selectedSprint) {"), 'Expected Active EPM sprint guard in dashboard.jsx');
    assert.ok(dashboardSource.includes('setEpmRollupTree(null);'), 'Expected Active EPM sprint guard to clear rollup tree');
    assert.ok(dashboardSource.includes('setEpmRollupLoading(false);'), 'Expected Active EPM sprint guard to stop rollup loading');
    assert.ok(dashboardSource.includes('fetchEpmProjectRollup(BACKEND_URL, currentProjectId'), 'Expected dashboard.jsx to fetch project-scoped EPM rollup through wrapper');
    assert.ok(epmFetchSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}'), 'Expected project-scoped EPM rollup fetch in epmFetch.js');
    assert.ok(dashboardSource.includes("currentProject.matchState === 'metadata-only'"), 'Expected metadata-only branch in dashboard.jsx');
    assert.ok(epmRollupPanelSource.includes('Open in Jira Home'), 'Expected Jira Home CTA copy in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('Open Settings'), 'Expected settings CTA helper copy in EpmRollupPanel.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && !isCompletedSprintSelected"), 'Expected capacity shell to stay ENG-only');
    assert.ok(dashboardSource.includes("selectedView === 'eng' ? ("), 'Expected compact sticky controls to branch by view');
});

test('dashboard source protects EPM selection during project loads and refreshes EPM data after save', () => {
    assert.ok(dashboardSource.includes('const epmProjectsPendingSelectionRef = useRef(false);'), 'Expected a pending EPM project-load ref');
    assert.ok(dashboardSource.includes('if (epmProjectsPendingSelectionRef.current) return;'), 'Expected selection clearing to wait for project loading');
    assert.ok(dashboardSource.includes('await refreshEpmProjects();'), 'Expected EPM config save to refresh project metadata');
});

test('dashboard source adds EPM rollup loading state and refresh-button branching', () => {
    assert.ok(dashboardSource.includes('const [epmRollupLoading, setEpmRollupLoading] = useState(false);'), 'Expected EPM rollup loading state');
    assert.ok(dashboardSource.includes('setEpmRollupLoading(true);'), 'Expected EPM rollup request start loading state');
    assert.ok(dashboardSource.includes('setEpmRollupTree(null);'), 'Expected EPM rollup to clear before reload');
    assert.ok(dashboardSource.includes("if (selectedView === 'epm') {"), 'Expected refresh button EPM branch');
    assert.ok(dashboardSource.includes('void refreshEpmView();'), 'Expected refresh button to call EPM refresh path');
    assert.ok(dashboardSource.includes("disabled={selectedView === 'eng' ? (loading || selectedSprint === null) : (epmProjectsLoading || epmRollupLoading)}"), 'Expected refresh button disable logic to branch by view');
});
