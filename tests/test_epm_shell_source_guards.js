const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const epmApiPath = path.join(__dirname, '..', 'frontend', 'src', 'api', 'epmApi.js');
const epmFetchPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmFetch.js');
const epmViewDataPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'useEpmViewData.js');
const epmRollupPanelPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmRollupPanel.jsx');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const epmApiSource = fs.existsSync(epmApiPath) ? fs.readFileSync(epmApiPath, 'utf8') : '';
const epmFetchSource = fs.readFileSync(epmFetchPath, 'utf8');
const epmViewDataSource = fs.existsSync(epmViewDataPath) ? fs.readFileSync(epmViewDataPath, 'utf8') : '';
const epmRollupPanelSource = fs.readFileSync(epmRollupPanelPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function countOccurrences(source, needle) {
    return (source.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

test('dashboard source includes the EPM shell project picker and ENG gating hooks', () => {
    assert.ok(helperSource.includes('filterEpmProjectsForTab'), 'Expected filterEpmProjectsForTab in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('getEpmProjectDisplayName'), 'Expected getEpmProjectDisplayName in epmProjectUtils.mjs');
    assert.ok(helperSource.includes("String(tab || 'active')"), 'Expected active tab defaulting in epmProjectUtils.mjs');
    assert.ok(epmViewDataSource.includes('const selectedEpmProject = visibleEpmProjects.find((project) => getEpmProjectIdentity(project) === epmSelectedProjectId) || null;'), 'Expected selectedEpmProject derivation in useEpmViewData.js');
    assert.ok(
        countOccurrences(dashboardSource + epmViewDataSource + epmRollupPanelSource, 'getEpmProjectDisplayName(') >= 4,
        'Expected EPM project display name helper across focus and all-project render paths'
    );
    assert.ok(dashboardSource.includes('getEpmProjectDisplayName(project)'), 'Expected project picker display name helper in dashboard.jsx');
    assert.ok(epmViewDataSource.includes("setEpmSelectedProjectId('')"), 'Expected invalid EPM selection clearing in useEpmViewData.js');
    assert.ok(dashboardSource.includes('epmSelectedProjectId'), 'Expected epmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes('setEpmSelectedProjectId'), 'Expected setEpmSelectedProjectId in dashboard.jsx');
    assert.ok(
        dashboardSource.includes("const shouldRenderIssueDependencies = (selectedView === 'eng' || selectedView === 'epm') && showDependencies"),
        'Expected ENG and EPM dependency rendering in dashboard.jsx'
    );
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showPlanning"), 'Expected ENG-only planning gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showStats"), 'Expected ENG-only stats gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showScenario"), 'Expected ENG-only scenario gating in dashboard.jsx');
});

test('dashboard source wires EPM rollup loading and metadata-only rendering', () => {
    assert.ok(fs.existsSync(epmViewDataPath), 'Expected useEpmViewData.js to own EPM view data state');
    assert.ok(epmViewDataSource.includes("if (selectedView !== 'epm') return;"), 'Expected EPM-only project loading effect in useEpmViewData.js');
    assert.ok(epmViewDataSource.includes('fetchEpmProjects(backendUrl, { tab });'), 'Expected EPM hook to load EPM projects through tab-scoped wrapper');
    assert.ok(epmApiSource.includes('const query = params.toString();'), 'Expected EPM projects wrapper to build tab query string');
    assert.ok(epmApiSource.includes('const url = query ? `${backendUrl}/api/epm/projects?${query}` : `${backendUrl}/api/epm/projects`;'), 'Expected EPM projects wrapper to preserve scoped and unscoped project URLs');
    assert.ok(epmApiSource.includes("getJson(url, 'EPM projects', { cache: 'no-cache' })"), 'Expected EPM projects fetch to use the tab-scoped wrapper URL');
    assert.ok(epmApiSource.includes('export function fetchEpmConfigurationProjects(backendUrl, draftConfig, options = {}) {'), 'Expected EPM configuration project loader');
    assert.ok(epmApiSource.includes('const refreshParam = forceRefresh ? \'?refresh=true\' : \'\';'), 'Expected project configuration refresh query support');
    assert.ok(epmApiSource.includes('postJson(`${backendUrl}/api/epm/projects/configuration${refreshParam}`'), 'Expected configuration fetch endpoint');
    assert.ok(!epmApiSource.includes('/api/epm/projects/preview'), 'EPM settings must not call preview endpoint');
    assert.ok(epmFetchSource.includes("export * from '../api/epmApi.js';"), 'Expected epmFetch.js compatibility re-export');
    assert.ok(epmViewDataSource.includes("if (epmTab === 'active' && !selectedSprint) {"), 'Expected Active EPM sprint guard in useEpmViewData.js');
    assert.ok(epmViewDataSource.includes('setEpmRollupTree(null);'), 'Expected Active EPM sprint guard to clear rollup tree');
    assert.ok(epmViewDataSource.includes('setEpmRollupLoading(false);'), 'Expected Active EPM sprint guard to stop rollup loading');
    assert.ok(epmViewDataSource.includes('fetchEpmProjectRollup(backendUrl, currentProjectId'), 'Expected useEpmViewData.js to fetch project-scoped EPM rollup through wrapper');
    assert.ok(epmApiSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}'), 'Expected project-scoped EPM rollup fetch in epmApi.js');
    assert.ok(epmViewDataSource.includes("currentProject.matchState === 'metadata-only'"), 'Expected metadata-only branch in useEpmViewData.js');
    assert.ok(epmRollupPanelSource.includes('Open in Jira Home'), 'Expected Jira Home CTA copy in EpmRollupPanel.jsx');
    assert.ok(epmRollupPanelSource.includes('Open Settings'), 'Expected settings CTA helper copy in EpmRollupPanel.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && !isCompletedSprintSelected"), 'Expected capacity shell to stay ENG-only');
    assert.ok(dashboardSource.includes("selectedView === 'eng' ? ("), 'Expected compact sticky controls to branch by view');
});

test('dashboard source protects EPM selection during project loads and refreshes EPM data after save', () => {
    assert.ok(epmViewDataSource.includes('const epmProjectsPendingSelectionRef = useRef(false);'), 'Expected a pending EPM project-load ref in the EPM hook');
    assert.ok(epmViewDataSource.includes('if (epmProjectsPendingSelectionRef.current) return;'), 'Expected selection clearing to wait for project loading');
    assert.ok(dashboardSource.includes('await refreshEpmProjects();'), 'Expected EPM config save to refresh project metadata');
});

test('dashboard source adds EPM rollup loading state and refresh-button branching', () => {
    assert.ok(epmViewDataSource.includes('const [epmRollupLoading, setEpmRollupLoading] = useState(false);'), 'Expected EPM rollup loading state in the EPM hook');
    assert.ok(epmViewDataSource.includes('setEpmRollupLoading(true);'), 'Expected EPM rollup request start loading state');
    assert.ok(epmViewDataSource.includes('setEpmRollupTree(null);'), 'Expected EPM rollup to clear before reload');
    assert.ok(dashboardSource.includes("if (selectedView === 'epm') {"), 'Expected refresh button EPM branch');
    assert.ok(dashboardSource.includes('void refreshEpmView();'), 'Expected refresh button to call EPM refresh path');
    assert.ok(dashboardSource.includes("disabled={selectedView === 'eng' ? (loading || selectedSprint === null) : (epmProjectsLoading || epmRollupLoading)}"), 'Expected refresh button disable logic to branch by view');
});

test('dashboard delegates EPM view data state to useEpmViewData', () => {
    assert.ok(fs.existsSync(epmViewDataPath), 'Expected EPM view data hook file');
    assert.ok(dashboardSource.includes("import { useEpmViewData } from './epm/useEpmViewData.js';"), 'Expected dashboard to import useEpmViewData');
    assert.ok(dashboardSource.includes('useEpmViewData({'), 'Expected dashboard to call useEpmViewData');
    assert.ok(epmViewDataSource.includes('export function useEpmViewData({'), 'Expected named EPM view data hook export');
    assert.ok(epmViewDataSource.includes('epmTab,') && epmViewDataSource.includes('setEpmTab,'), 'Expected hook to return EPM tab state');
    assert.ok(epmViewDataSource.includes('epmSelectedProjectId,') && epmViewDataSource.includes('setEpmSelectedProjectId,'), 'Expected hook to return selected project state');
    assert.ok(epmViewDataSource.includes('refreshEpmProjects,') && epmViewDataSource.includes('refreshEpmRollup,') && epmViewDataSource.includes('refreshEpmView,'), 'Expected hook to return EPM refresh functions');
    assert.ok(!dashboardSource.includes('fetchEpmAllProjectsRollup(BACKEND_URL'), 'Expected dashboard not to fetch all-project EPM rollups directly');
    assert.ok(!dashboardSource.includes('fetchEpmProjectRollup(BACKEND_URL'), 'Expected dashboard not to fetch project EPM rollups directly');
});
