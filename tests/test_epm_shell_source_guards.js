const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');

test('dashboard source includes the EPM shell project picker and ENG gating hooks', () => {
    assert.ok(helperSource.includes('filterEpmProjectsForTab'), 'Expected filterEpmProjectsForTab in epmProjectUtils.mjs');
    assert.ok(helperSource.includes('getEpmProjectDisplayName'), 'Expected getEpmProjectDisplayName in epmProjectUtils.mjs');
    assert.ok(helperSource.includes("String(tab || 'active')"), 'Expected active tab defaulting in epmProjectUtils.mjs');
    assert.ok(dashboardSource.includes('const selectedEpmProject = visibleEpmProjects.find((project) => project.homeProjectId === epmSelectedProjectId) || null;'), 'Expected selectedEpmProject derivation in dashboard.jsx');
    assert.ok((dashboardSource.match(/getEpmProjectDisplayName\(selectedEpmProject\)/g) || []).length >= 2, 'Expected selected project display name helper in dashboard.jsx');
    assert.ok(dashboardSource.includes('getEpmProjectDisplayName(project)'), 'Expected project picker display name helper in dashboard.jsx');
    assert.ok(dashboardSource.includes("setEpmSelectedProjectId('')"), 'Expected invalid EPM selection clearing in dashboard.jsx');
    assert.ok(dashboardSource.includes('epmSelectedProjectId'), 'Expected epmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes('setEpmSelectedProjectId'), 'Expected setEpmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showDependencies"), 'Expected ENG-only dependency gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showPlanning"), 'Expected ENG-only planning gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showStats"), 'Expected ENG-only stats gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showScenario"), 'Expected ENG-only scenario gating in dashboard.jsx');
});

test('dashboard source wires Task 7 EPM data loading and metadata-only rendering', () => {
    assert.ok(dashboardSource.includes("if (selectedView !== 'epm') return;"), 'Expected EPM-only project loading effect');
    assert.ok(dashboardSource.includes("fetch(`${BACKEND_URL}/api/epm/projects`, { cache: 'no-cache' })"), 'Expected EPM projects fetch in dashboard.jsx');
    assert.ok(dashboardSource.includes("if (epmTab === 'active' && !selectedSprint) {"), 'Expected Active EPM sprint guard in dashboard.jsx');
    assert.ok(dashboardSource.includes('setEpmIssues([]);'), 'Expected Active EPM sprint guard to clear issues');
    assert.ok(dashboardSource.includes('setEpmIssueEpics({});'), 'Expected Active EPM sprint guard to clear epics');
    assert.ok(dashboardSource.includes('/api/epm/projects/${encodeURIComponent(currentProjectId)}/issues?${params.toString()}'), 'Expected project-scoped EPM issues fetch');
    assert.ok(dashboardSource.includes("selectedEpmProject?.matchState === 'metadata-only'"), 'Expected metadata-only branch in dashboard.jsx');
    assert.ok(dashboardSource.includes('Open in Jira Home'), 'Expected Jira Home CTA copy in dashboard.jsx');
    assert.ok(dashboardSource.includes('Open Settings'), 'Expected settings CTA helper copy in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && !isCompletedSprintSelected"), 'Expected capacity shell to stay ENG-only');
    assert.ok(dashboardSource.includes("selectedView === 'eng' ? ("), 'Expected compact sticky controls to branch by view');
});

test('dashboard source protects EPM selection during project loads and refreshes EPM data after save', () => {
    assert.ok(dashboardSource.includes('const epmProjectsPendingSelectionRef = useRef(false);'), 'Expected a pending EPM project-load ref');
    assert.ok(dashboardSource.includes('if (epmProjectsPendingSelectionRef.current) return;'), 'Expected selection clearing to wait for project loading');
    assert.ok(dashboardSource.includes('await refreshEpmProjects();'), 'Expected EPM config save to refresh project metadata');
});

test('dashboard source adds EPM issue loading state and refresh-button branching', () => {
    assert.ok(dashboardSource.includes('const [epmIssuesLoading, setEpmIssuesLoading] = useState(false);'), 'Expected EPM issues loading state');
    assert.ok(dashboardSource.includes('setEpmIssuesLoading(true);'), 'Expected EPM issues request start loading state');
    assert.ok(dashboardSource.includes('setEpmIssues([]);') && dashboardSource.includes('setEpmIssueEpics({});'), 'Expected EPM issues to clear before reload');
    assert.ok(dashboardSource.includes("if (selectedView === 'epm') {"), 'Expected refresh button EPM branch');
    assert.ok(dashboardSource.includes('void refreshEpmView();'), 'Expected refresh button to call EPM refresh path');
    assert.ok(dashboardSource.includes("disabled={selectedView === 'eng' ? (loading || selectedSprint === null) : (epmProjectsLoading || epmIssuesLoading)}"), 'Expected refresh button disable logic to branch by view');
});
