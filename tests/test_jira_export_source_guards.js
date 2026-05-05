const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const componentSource = fs.readFileSync('frontend/src/components/JiraExportButton.jsx', 'utf8');
const dashboardSource = fs.readFileSync('frontend/src/dashboard.jsx', 'utf8');
const epmViewSource = fs.readFileSync('frontend/src/epm/EpmView.jsx', 'utf8');
const epmRollupPanelSource = fs.readFileSync('frontend/src/epm/EpmRollupPanel.jsx', 'utf8');

test('Jira export control is an icon menu instead of a split text button', () => {
    assert.ok(componentSource.includes('className="secondary compact jira-export-icon-button"'), 'Expected one compact Jira icon trigger');
    assert.ok(componentSource.includes('aria-label="Open Jira issue menu"'), 'Expected accessible icon button label');
    assert.ok(componentSource.includes("renderMenuItem('epics', 'Open epics'"), 'Expected menu action for epics');
    assert.ok(componentSource.includes("renderMenuItem('stories', 'Open stories'"), 'Expected menu action for stories');
    assert.ok(!componentSource.includes('jira-export-primary'), 'Did not expect split primary text button');
    assert.ok(!componentSource.includes('jira-export-caret'), 'Did not expect split caret button');
    assert.ok(!componentSource.includes('Open in Jira'), 'Did not expect visible text inside the trigger');
});

test('Jira export control is mounted once in the shared dashboard header', () => {
    assert.equal((dashboardSource.match(/<JiraExportButton/g) || []).length, 1);
    assert.ok(dashboardSource.includes('activeJiraExportEpicKeys'), 'Expected shared header export epic keys');
    assert.ok(dashboardSource.includes('activeJiraExportStoryKeys'), 'Expected shared header export story keys');
    assert.ok(dashboardSource.includes('className="jira-export-header"'), 'Expected header placement');
    assert.ok(!dashboardSource.includes('jira-export-planning'), 'Did not expect planning-specific export placement');
    assert.ok(!dashboardSource.includes('jira-export-scenario'), 'Did not expect scenario-specific export placement');
    assert.ok(!dashboardSource.includes('jira-export-epm'), 'Did not expect EPM-specific export placement');
    assert.ok(!dashboardSource.includes('jiraExportButton='), 'Did not expect EPM-only export prop wiring');
    assert.ok(!epmViewSource.includes('jiraExportButton'), 'Did not expect EPM view to own export placement');
    assert.ok(!epmRollupPanelSource.includes('jiraExportButton'), 'Did not expect EPM rollup panel to own export placement');
});
