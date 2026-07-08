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

test('needs stories team header links to the exact epic keys shown for that team', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'),
        'utf8'
    );

    // The alert list is client-computed (per-team sprint-story coverage, dismissed
    // alerts, team-field fallback routing), so no label/sprint JQL can reproduce
    // it. The team header must open exactly the epics rendered under it.
    assert.match(
        source,
        /needsStoriesTeams\.map\(group => \{\s+const teamLink = buildKeyListLink\(group\.items\.map\(entry => entry\.epic\.key\)\);[\s\S]*?className="alert-team-link"/
    );
    assert.doesNotMatch(source, /buildNeedsStoriesTeamLink/);
});
