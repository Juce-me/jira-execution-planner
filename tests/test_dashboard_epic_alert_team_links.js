const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('epic alert team headers link their epic counts to Jira', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'),
        'utf8'
    );

    const expectedBlocks = [
        /backlogEpicTeams\.map\(group => \{\s+const keys = group\.items\.map\(item => item\.key\);\s+const teamLink = buildKeyListLink\(keys\);[\s\S]*?className="alert-team-link"/,
        /missingTeamEpicTeams\.map\(group => \{\s+const keys = group\.items\.map\(item => item\.key\);\s+const teamLink = buildKeyListLink\(keys\);[\s\S]*?className="alert-team-link"/,
        /missingLabelEpicTeams\.map\(group => \{\s+const keys = group\.items\.map\(item => item\.key\);\s+const teamLink = buildKeyListLink\(keys\);[\s\S]*?className="alert-team-link"/,
    ];

    expectedBlocks.forEach((pattern) => {
        assert.match(
            source,
            pattern
        );
    });
});

test('needs stories team header links to a semantic JQL filter, not a key list', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'),
        'utf8'
    );

    assert.match(
        source,
        /needsStoriesTeams\.map\(group => \{\s+const teamLink = buildNeedsStoriesTeamLink\(\{ id: group\.id, name: group\.name \}\);[\s\S]*?className="alert-team-link"/
    );
});
