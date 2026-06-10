const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const issueCardPath = path.join(__dirname, '..', 'frontend', 'src', 'issues', 'IssueCard.jsx');
const issueViewUtilsPath = path.join(__dirname, '..', 'frontend', 'src', 'issues', 'issueViewUtils.js');
const engViewPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngView.jsx');
const engSprintDataPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useEngSprintData.js');
const engTaskUtilsPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'engTaskUtils.js');
const engAlertsPanelPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx');
const engCssPath = path.join(__dirname, '..', 'frontend', 'src', 'styles', 'eng.css');
const epmCssPath = path.join(__dirname, '..', 'frontend', 'src', 'styles', 'epm.css');

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
    assert.equal(fs.existsSync(engAlertsPanelPath), true, 'Expected ENG alerts panel module');
    const source = fs.readFileSync(engAlertsPanelPath, 'utf8');

    assert.match(
        source,
        /className="alert-chip"\s+href=\{buildKeyListLink\(backlogEpics\.map\(e => e\.key\)\)\}/
    );
});

test('dashboard defines a persisted global alerts panel toggle', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    assert.equal(fs.existsSync(engAlertsPanelPath), true, 'Expected ENG alerts panel module');
    const alertsSource = fs.readFileSync(engAlertsPanelPath, 'utf8');

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
        /import EngAlertsPanel from '\.\/eng\/EngAlertsPanel\.jsx';/
    );
    assert.match(
        alertsSource,
        /className="alerts-panel-toggle"/
    );
    assert.match(
        alertsSource,
        /showAlertsPanel \? 'Hide Alerts' : 'Show Alerts'/
    );
    assert.match(
        alertsSource,
        /\{showAlertsPanel && \(\s*<div className=\{`alert-panels/
    );
});

test('dashboard delegates ENG data loading and view rendering to ENG modules', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const engViewSource = fs.readFileSync(engViewPath, 'utf8');
    const engAlertsSource = fs.readFileSync(engAlertsPanelPath, 'utf8');

    assert.equal(fs.existsSync(engViewPath), true, 'Expected ENG view module');
    assert.equal(fs.existsSync(engSprintDataPath), true, 'Expected ENG sprint data hook module');
    assert.equal(fs.existsSync(engTaskUtilsPath), true, 'Expected ENG task utility module');
    assert.equal(fs.existsSync(engAlertsPanelPath), true, 'Expected ENG alerts panel module');

    assert.match(source, /import EngView from '\.\/eng\/EngView\.jsx';/);
    assert.match(source, /import \{ useEngSprintData \} from '\.\/eng\/useEngSprintData\.js';/);
    assert.match(source, /import \{[\s\S]*getTaskTeamInfo[\s\S]*\} from '\.\/eng\/engTaskUtils\.js';/);
    assert.match(source, /<EngView[\s>]/);
    assert.match(source, /<EngAlertsPanel[\s>]/);
    assert.match(source, /useEngSprintData\(/);
    assert.doesNotMatch(source, /className=\{`alert-card /);
    assert.doesNotMatch(source, /className="filters-strip"/);
    assert.doesNotMatch(source, /className=\{`task-list /);
    assert.match(engAlertsSource, /className=\{`alert-card missing/);
    assert.match(engAlertsSource, /className=\{`alert-card blocked/);
    assert.match(engAlertsSource, /className=\{`alert-card done-epic/);
    assert.match(engViewSource, /className="filters-strip"/);
    assert.match(engViewSource, /className=\{`task-list /);
    assert.match(engViewSource, /<EmptyState title="No tasks found">/);
    assert.doesNotMatch(source, /fetchEngTasks,\s*$/m);
    assert.doesNotMatch(source, /fetchBacklogEpics as requestBacklogEpics/);
});

test('ENG sprint data hook preserves startup request sequencing markers', () => {
    assert.equal(fs.existsSync(engSprintDataPath), true, 'Expected ENG sprint data hook module');
    const source = fs.readFileSync(engSprintDataPath, 'utf8');

    const loadProductIndex = source.indexOf('const loadProductTasks');
    const readyToCloseIndex = source.indexOf("purpose: 'ready-to-close'");
    assert.notEqual(loadProductIndex, -1, 'Expected visible product task loader in ENG data hook');
    assert.notEqual(readyToCloseIndex, -1, 'Expected deferred ready-to-close loader in ENG data hook');
    assert.ok(loadProductIndex < readyToCloseIndex, 'Expected visible sprint task loaders before ready-to-close alert loaders');

    assert.match(source, /const data = await fetchTasks\('product', \{ forceRefresh \}\);/);
    assert.match(source, /const data = await fetchTasks\('tech', \{ forceRefresh \}\);/);
    assert.match(source, /sprintOverride: '',\s*purpose: 'ready-to-close'/);
    assert.match(source, /fetchBacklogEpics = async \(project\) =>/);
    assert.match(source, /activeGroupId && activeGroupTeamIds\.length === 0/);
});

test('dashboard task display uses shared issue view helpers', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const issueCardSource = fs.existsSync(issueCardPath) ? fs.readFileSync(issueCardPath, 'utf8') : '';
    const helperSource = fs.existsSync(issueViewUtilsPath) ? fs.readFileSync(issueViewUtilsPath, 'utf8') : '';

    assert.equal(fs.existsSync(issueCardPath), true, 'Expected shared IssueCard component module');
    assert.equal(fs.existsSync(issueViewUtilsPath), true, 'Expected shared issueViewUtils helper module');
    assert.match(source, /import IssueCard, \{ IssueCardContext \} from '\.\/issues\/IssueCard\.jsx';/);
    assert.match(source, /<IssueCard/);
    assert.match(source, /import \{\s*formatPriorityShort,\s*getIssueStatusClassName,\s*getIssueTeamLabel\s*\} from '\.\/issues\/issueViewUtils\.js';/);
    assert.match(source, /formatPriorityShort\(priority\)/);
    assert.match(issueCardSource, /import StatusPill from '\.\.\/ui\/StatusPill\.jsx';/);
    assert.match(issueCardSource, /<StatusPill/);
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
    assert.equal(getIssueStatusClassName('To Do', 'mapping-preview-dimmable accepted'), 'task-status mapping-preview-dimmable accepted waiting');
    assert.equal(getIssueStatusClassName('Pending'), 'task-status waiting');
    assert.equal(getIssueStatusClassName('Awaiting Validation'), 'task-status waiting');
    assert.equal(getIssueStatusClassName('Accepted'), 'task-status accepted');
    assert.equal(getIssueStatusClassName('Killed'), 'task-status killed');
    assert.equal(getIssueStatusClassName('Incomplete'), 'task-status incomplete');
    assert.equal(getIssueStatusClassName('Analysis'), 'task-status in-progress');
    assert.equal(getIssueStatusClassName('Work In Progress'), 'task-status in-progress');
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

test('issue status CSS keeps waiting statuses gray, progress statuses blue, and closed subtask statuses green', () => {
    const engCss = fs.readFileSync(engCssPath, 'utf8');
    const epmCss = fs.readFileSync(epmCssPath, 'utf8');
    const taskStatusRules = engCss.slice(
        engCss.indexOf('.task-status.done'),
        engCss.indexOf('.epic-status-pill.task-status')
    );
    const waitingRule = taskStatusRules.slice(
        taskStatusRules.indexOf('.task-status.waiting,'),
        taskStatusRules.indexOf('.task-status.postponed')
    );

    assert.ok(taskStatusRules.includes('.task-status.in-progress'));
    assert.ok(taskStatusRules.includes('.task-status.accepted'));
    assert.ok(taskStatusRules.includes('.task-status.done'));
    assert.ok(taskStatusRules.includes('.task-status.killed'));
    assert.ok(taskStatusRules.includes('.task-status.incomplete'));
    assert.match(taskStatusRules, /\.task-status\.done,[\s\S]*\.task-status\.killed,[\s\S]*\.task-status\.incomplete[\s\S]*background: #52c41a;/);
    assert.ok(taskStatusRules.includes('background: #69c0ff;'));
    assert.ok(waitingRule.includes('.task-status.to-do,'));
    assert.equal(waitingRule.includes('.task-status.accepted'), false);
    assert.ok(waitingRule.includes('.task-status.awaiting-validation,'));
    assert.ok(waitingRule.includes('.task-status.pending'));
    assert.ok(waitingRule.includes('background: #8c8c8c;'));
    assert.equal(taskStatusRules.includes('background: #597ef7;'), false);
    assert.match(epmCss, /\.epm-project-board-status-pill\.task-status\.waiting,[\s\S]*\.epm-project-board-status-pill\.task-status\.pending[\s\S]*background: #8c8c8c;/);
});
