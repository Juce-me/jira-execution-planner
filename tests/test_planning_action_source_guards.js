const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('planning action row includes postponed and awaiting validation bulk actions', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /toggleIncludeByStatus\(\['Postponed'\]\)/);
    assert.match(source, /toggleIncludeByStatus\(\['Awaiting Validation'\]\)/);
    assert.match(componentSource, />\s*Postponed\s*</);
    assert.match(componentSource, />\s*Awaiting Val\.\s*</);
    assert.match(componentSource, /onTogglePostponed/);
    assert.match(componentSource, /onToggleAwaitingValidation/);
});

test('planning action row includes select all for currently visible planning tasks', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /const selectAllVisiblePlanningTasks = \(\) => \{/);
    assert.match(source, /visibleTasksForList\.forEach\(task => \{/);
    assert.match(source, /next\[task\.key\] = true;/);
    assert.match(source, /hasVisiblePlanningTasks=\{visibleTasksForList\.length > 0\}/);
    assert.match(componentSource, /onSelectAllVisible/);
    assert.match(componentSource, /disabled=\{!hasVisiblePlanningTasks\}/);
    assert.match(componentSource, />\s*Select All\s*</);
});

test('planning panel no longer renders capacity bar footer rows', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.doesNotMatch(source, /capacity-bar-footer/);
});

test('planning selection persistence effect is declared after selectionTasks', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const selectionTasksIndex = source.indexOf('const selectionTasks = baseFilteredTasks;');
    const effectIndex = source.indexOf('savePlanningState(window.localStorage, planningScopeKey, {');

    assert.notEqual(selectionTasksIndex, -1);
    assert.notEqual(effectIndex, -1);
    assert.ok(
        effectIndex > selectionTasksIndex,
        'savePlanningState effect should appear after selectionTasks is declared'
    );
});

test('sprint dropdown keeps selected option visible without using document scrollIntoView', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /querySelector\('\.sprint-dropdown-list'\)/);
    assert.match(source, /listEl\.scrollTop = Math\.max\(0, optionTop - padding\)/);
    assert.doesNotMatch(source, /scrollIntoView\(\{ block: 'center' \}\)/);
});

test('planned teams effort jira links are scoped to stories', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /statuses: \['Postponed'\], issueType: 'Story'/);
    assert.match(source, /statuses: \['To Do', 'Pending'\], issueType: 'Story'/);
    assert.match(source, /statuses: \['Accepted'\], issueType: 'Story'/);
});

test('dashboard hydrates scoped team selection from group and sprint storage', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /buildTeamSelectionScopeKey/);
    assert.match(source, /loadTeamSelectionState\(window\.localStorage, teamSelectionScopeKey\)/);
    assert.match(source, /reconcileTeamSelectionState\(/);
    assert.match(source, /saveTeamSelectionState\(window\.localStorage, teamSelectionScopeKey,/);
});

test('selected sp by team forces six teams onto multiple rows', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /const rows = teamCount === 6 \? 2 : Math\.ceil\(teamCount \/ maxPerRow\);/);
});

test('selected sp by team cards still render for a single team entry', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /\{selectedTeamEntries\.length > 0 && \(\(\) => \{/);
});

test('dashboard imports planning capacity helpers from ENG module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /from '\.\/eng\/planningCapacityUtils\.js'/);
    assert.doesNotMatch(source, /const getCapacityStatus = \(/);
    assert.doesNotMatch(source, /const getTeamCapacityMeta = \(/);
});

test('dashboard imports planning selection stat helpers from ENG module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /from '\.\/eng\/planningSelectionStats\.js'/);
    assert.doesNotMatch(source, /selectedTasksList\.reduce\(\(sum, task\) => \{/);
    assert.doesNotMatch(source, /selectedPlanningTasksList\.reduce\(\(acc, task\) => \{/);
});

test('dashboard imports planning capacity aggregate helpers from ENG module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /buildTeamCapacityStats/);
    assert.doesNotMatch(source, /capacityTasks\.reduce\(\(acc, task\) => \{/);
    assert.doesNotMatch(source, /displayedTeamCapacityEntries\.reduce\(\(acc, info\) => \{/);
});

test('dashboard imports dependency focus helpers from issues module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /from '\.\/issues\/dependencyFocusUtils\.js'/);
    assert.doesNotMatch(source, /const getBlockLinkBuckets = \(entries, taskKey\) => \{/);
    assert.doesNotMatch(source, /const dependencyKeySignature = React\.useMemo\(\(\) => \{\s*const keys = Array\.from\(new Set\(dependencyTasks\.map\(task => task\.key\)\.filter\(Boolean\)\)\);/);
});

test('dashboard delegates planning action row to ENG component', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /import PlanningActionBar from '\.\/eng\/PlanningActionBar\.jsx'/);
    assert.match(source, /<PlanningActionBar/);
    assert.doesNotMatch(source, /className="planning-actions"/);
    assert.match(componentSource, /className="planning-actions"/);
    assert.match(componentSource, />\s*Accepted\s*</);
    assert.match(componentSource, />\s*To Do\s*</);
    assert.match(componentSource, />\s*Clear Selected\s*</);
    assert.match(componentSource, /onOpenSelectedInJira/);
});

test('dashboard delegates planning capacity bar to ENG component', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningCapacityBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /import PlanningCapacityBar from '\.\/eng\/PlanningCapacityBar\.jsx'/);
    assert.match(source, /<PlanningCapacityBar/);
    assert.doesNotMatch(source, /className="capacity-bar-graph"/);
    assert.match(componentSource, /className="capacity-bar-graph"/);
    assert.match(componentSource, /capacity-bar-excluded-zone/);
    assert.match(componentSource, /capacity-bar-variance-zone/);
    assert.match(componentSource, /capacity-bar-marker teamcap/);
    assert.match(componentSource, /Selected:/);
    assert.match(componentSource, /\{selectedCount\} · \{selectedSP\.toFixed\(1\)\} SP/);
});
