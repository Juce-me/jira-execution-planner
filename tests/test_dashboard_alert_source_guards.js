const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dashboard alert logic does not redeclare epicMatchesSelectedSprint locally', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );

    assert.equal(
        source.includes('const epicMatchesSelectedSprint = (epic, epicStories) => {'),
        false
    );
});

test('backlog alert header chip links to the backlog epic key list in Jira', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );

    assert.match(
        source,
        /className="alert-chip"\s+href=\{buildKeyListLink\(backlogEpics\.map\(e => e\.key\)\)\}/
    );
});

test('dashboard defines a persisted global alerts panel toggle', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
        'utf8'
    );

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
