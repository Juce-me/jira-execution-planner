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
    assert.ok(helperSource.includes("String(tab || 'active')"), 'Expected active tab defaulting in epmProjectUtils.mjs');
    assert.ok(dashboardSource.includes('const selectedEpmProject = visibleEpmProjects.find((project) => project.homeProjectId === epmSelectedProjectId) || null;'), 'Expected selectedEpmProject derivation in dashboard.jsx');
    assert.ok(dashboardSource.includes("setEpmSelectedProjectId('')"), 'Expected invalid EPM selection clearing in dashboard.jsx');
    assert.ok(dashboardSource.includes('epmSelectedProjectId'), 'Expected epmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes('setEpmSelectedProjectId'), 'Expected setEpmSelectedProjectId in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showDependencies"), 'Expected ENG-only dependency gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showPlanning"), 'Expected ENG-only planning gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showStats"), 'Expected ENG-only stats gating in dashboard.jsx');
    assert.ok(dashboardSource.includes("selectedView === 'eng' && showScenario"), 'Expected ENG-only scenario gating in dashboard.jsx');
});
