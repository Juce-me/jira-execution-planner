const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('planning action row includes postponed and awaiting validation bulk actions', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /toggleIncludeByStatus\(\['Postponed'\]\)/);
    assert.match(source, /toggleIncludeByStatus\(\['Awaiting Validation'\]\)/);
    assert.match(source, /status === 'postponed'/);
    assert.match(source, /status === 'awaiting validation'/);
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
