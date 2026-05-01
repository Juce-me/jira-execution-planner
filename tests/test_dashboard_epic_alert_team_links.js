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
        /needsStoriesTeams\.map\(group => \{\s+const keys = group\.items\.map\(item => item\.epic\.key\);\s+const teamLink = buildKeyListLink\(keys\);[\s\S]*?className="alert-team-link"/
    ];

    expectedBlocks.forEach((pattern) => {
        assert.match(
            source,
            pattern
        );
    });
});
