const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = () => fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'),
    'utf8'
);

test('alert team labels no longer link to Jira: the count text is the copy-link control', () => {
    const source = panel();
    assert.doesNotMatch(source, /alert-team-link/);
    assert.doesNotMatch(source, /alert-team-title/);
    assert.doesNotMatch(source, /buildTeamStatusLink/);
});

test('every category chip opens exactly the issues listed under it in Jira', () => {
    const source = panel();
    assert.match(source, /const renderCategoryChip = \(keys, text, title\) => \{\s+const href = buildKeyListLink\(keys\);/);
    // The three epic categories whose team headers used to carry the link, plus Postponed and Waiting, keep a Jira link on their chip.
    for (const keys of [
        /renderCategoryChip\(missingTeamEpics\.map\(epic => epic\.key\)/,
        /renderCategoryChip\(missingLabelEpics\.map\(epic => epic\.key\)/,
        // The alert list is client-computed (per-team sprint-story coverage, dismissed alerts, team-field fallback routing),
        // so no label/sprint JQL can reproduce it: the chip opens exactly the epics rendered.
        /renderCategoryChip\(needsStoriesTeams\.flatMap\(group => group\.items\.map\(entry => entry\.epic\.key\)\)/,
        /renderCategoryChip\(waitingForStoriesEpics\.map\(epic => epic\.key\)/,
        /renderCategoryChip\(\[\.\.\.postponedTasks\.map\(task => task\.key\), \.\.\.futureRoutedEpics\.map\(epic => epic\.key\)\]/,
    ]) assert.match(source, keys);
    assert.doesNotMatch(source, /buildNeedsStoriesTeamLink/);
});
