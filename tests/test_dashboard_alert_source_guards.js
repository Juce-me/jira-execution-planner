const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const issueViewUtilsPath = path.join(__dirname, '..', 'frontend', 'src', 'issues', 'issueViewUtils.js');

function loadIssueViewUtils() {
    assert.equal(fs.existsSync(issueViewUtilsPath), true, 'Expected shared issueViewUtils helper module');
    const source = fs.readFileSync(issueViewUtilsPath, 'utf8')
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return { normalizeIssueStatus, getIssueStatusClassName, getIssueTeamLabel, formatPriorityShort };`)();
}

test('dashboard alert logic does not redeclare epicMatchesSelectedSprint locally', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    assert.equal(
        source.includes('const epicMatchesSelectedSprint = (epic, epicStories) => {'),
        false
    );
});

test('backlog alert header chip links to the backlog epic key list in Jira', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    assert.match(
        source,
        /className="alert-chip"\s+href=\{buildKeyListLink\(backlogEpics\.map\(e => e\.key\)\)\}/
    );
});

test('dashboard defines a persisted global alerts panel toggle', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    assert.match(
        source,
        /const \[showAlertsPanel, setShowAlertsPanel\] = useState\(savedPrefsRef\.current\.showAlertsPanel \?\? true\);/
    );
    assert.match(
        source,
        /showAlertsPanel: savedPrefsRef\.current\.showAlertsPanel \?\? true/
    );
    assert.match(
        source,
        /setShowAlertsPanel\(nextState\.showAlertsPanel \?\? true\);/
    );
    assert.match(
        source,
        /className="alerts-panel-toggle"/
    );
    assert.match(
        source,
        /showAlertsPanel \? 'Hide Alerts' : 'Show Alerts'/
    );
    assert.match(
        source,
        /\{showAlertsPanel && \(\s*<div className=\{`alert-panels/
    );
});

test('dashboard task display uses shared issue view helpers', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const helperSource = fs.existsSync(issueViewUtilsPath) ? fs.readFileSync(issueViewUtilsPath, 'utf8') : '';

    assert.equal(fs.existsSync(issueViewUtilsPath), true, 'Expected shared issueViewUtils helper module');
    assert.match(source, /import \{\s*formatPriorityShort,\s*getIssueStatusClassName,\s*getIssueTeamLabel\s*\} from '\.\/issues\/issueViewUtils\.js';/);
    assert.match(source, /formatPriorityShort\(priority\)/);
    assert.match(source, /<StatusPill/);
    assert.match(source, /getIssueStatusClassName\(task\.fields\.status\?\.name\)/);
    assert.match(source, /getIssueTeamLabel\(teamInfo\)/);
    assert.match(helperSource, /export function formatPriorityShort/);
    assert.match(helperSource, /export function getIssueStatusClassName/);
    assert.match(helperSource, /export function getIssueTeamLabel/);
});

test('issue view helpers preserve status, priority, and team display behavior', () => {
    const {
        normalizeIssueStatus,
        getIssueStatusClassName,
        getIssueTeamLabel,
        formatPriorityShort,
    } = loadIssueViewUtils();

    assert.equal(normalizeIssueStatus(' In   Progress '), 'in progress');
    assert.equal(getIssueStatusClassName('In Progress'), 'task-status in-progress');
    assert.equal(getIssueStatusClassName('To Do', 'mapping-preview-dimmable accepted'), 'task-status mapping-preview-dimmable accepted to-do');
    assert.equal(getIssueStatusClassName(''), 'task-status');

    assert.equal(getIssueTeamLabel({ name: 'Platform' }), 'Platform');
    assert.equal(getIssueTeamLabel({ displayName: 'Data Team' }), 'Data Team');
    assert.equal(getIssueTeamLabel({ id: 'team-1' }), 'team-1');
    assert.equal(getIssueTeamLabel('Ops'), 'Ops');
    assert.equal(getIssueTeamLabel({}), 'Unknown Team');

    assert.equal(formatPriorityShort('Blocker'), 'BLKR');
    assert.equal(formatPriorityShort('Critical'), 'CRIT');
    assert.equal(formatPriorityShort('Highest'), 'HIGH');
    assert.equal(formatPriorityShort('High'), 'HIGH');
    assert.equal(formatPriorityShort('Major'), 'MAJR');
    assert.equal(formatPriorityShort('Medium'), 'MED');
    assert.equal(formatPriorityShort('Minor'), 'MIN');
    assert.equal(formatPriorityShort('Lowest'), 'LOW');
    assert.equal(formatPriorityShort('Low'), 'LOW');
    assert.equal(formatPriorityShort(''), 'NONE');
    assert.equal(formatPriorityShort('Custom'), 'CUST');
});
