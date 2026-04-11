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
