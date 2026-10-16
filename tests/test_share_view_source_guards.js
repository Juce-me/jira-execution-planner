const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const repoRoot = path.join(__dirname, '..');
const shareViewDir = path.join(repoRoot, 'frontend', 'src', 'shareView');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const dashboard = read('frontend/src/dashboard.jsx');

// esbuild drops ordinary comments, so a rule is checked against code only and a comment may name a forbidden helper.
const codeOf = source => esbuild.transformSync(source, { loader: 'jsx', legalComments: 'none' }).code;
const shareViewFiles = fs.readdirSync(shareViewDir).filter(name => /\.jsx?$/.test(name));
const shareViewCode = Object.fromEntries(shareViewFiles.map(name => [name, codeOf(fs.readFileSync(path.join(shareViewDir, name), 'utf8'))]));

function between(source, startMarker, endMarker, from = 0) {
    const start = source.indexOf(startMarker, from);
    assert.ok(start >= 0, `find ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.ok(end > start, `find ${endMarker} after ${startMarker}`);
    return source.slice(start, end);
}

// Top-level keys of an object literal body, shorthand or `key: value`, ignoring nested brackets.
function topLevelKeys(body) {
    const keys = [];
    let depth = 0;
    let piece = '';
    const flush = () => {
        const match = piece.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
        if (match) keys.push(match[1]);
        piece = '';
    };
    for (const char of body) {
        if ('([{'.includes(char)) depth += 1;
        if (')]}'.includes(char)) depth -= 1;
        if (char === ',' && depth === 0) flush();
        else piece += char;
    }
    flush();
    return keys;
}

test('the link apply never calls the App helpers that reset filters, emit analytics or leave the page', () => {
    for (const [name, code] of Object.entries(shareViewCode)) {
        assert.doesNotMatch(code, /\b(?:applyEngMode|clearEngFilters|resetEngFilters|navigateToAlertStory|handleAlertStoryClick)\b/, name);
    }
});

test('no shareView selector interpolates a value into its selector string', () => {
    for (const [name, code] of Object.entries(shareViewCode)) {
        assert.doesNotMatch(code, /\.(?:querySelector|querySelectorAll|closest|matches)\(\s*`[^`]*\$\{/, name);
    }
});

test('shareView reaches no write API, preference save or CSRF helper', () => {
    for (const [name, code] of Object.entries(shareViewCode)) {
        assert.doesNotMatch(code, /configApi|jiraIssueApi|postJsonWithCsrf|saveGroupPreferences/, name);
    }
});

test('the codec parses the query by hand and never through URLSearchParams', () => {
    assert.ok(shareViewCode['codec.js'], 'the codec must exist');
    assert.doesNotMatch(shareViewCode['codec.js'], /URLSearchParams/);
});

test('shareView registers no window keydown handler; interactions use document capture listeners behind the auth latch', () => {
    for (const [name, code] of Object.entries(shareViewCode)) assert.doesNotMatch(code, /window\.addEventListener\(\s*['"]keydown['"]/, name);
    const guard = shareViewCode['interactionGuard.js'];
    assert.match(guard, /doc\.addEventListener\(type, handle, \{ capture: true, passive: true \}\)/);
    assert.ok(guard.indexOf('readPendingAuthenticationRequired()') < guard.indexOf('onInteraction('), 'the auth latch is read before any interaction is reported');
});

test('the link entry is the first import of the dashboard', () => {
    const firstStatement = dashboard.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('//'));
    assert.equal(firstStatement, "import './shareView/entry.js';");
});

test('the apply hook is declared after the restore effects, the group and Team effects and the mode state', () => {
    const hook = dashboard.indexOf('const shareView = useShareViewApply(shareViewOptions);');
    assert.ok(hook > 0);
    for (const anchor of [
        "if (!restoredInitialEpmViewRef.current && savedInitialViewRef.current === 'epm') {",
        "const nextView = resume.selectedView === 'epm' && showEpmNavigation ? 'epm' : 'eng';",
        'applyGroupState(overlaySnapshot(issueEditStateRef.current.reconcileSnapshot(cached), issueEditStateRef.current.planningEntries()));',
        "teamSelectionSkipPersistScopeRef.current = hydrationWillUpdateSelection ? teamSelectionScopeKey : '';",
        'const { activeEngMode, applyEngMode } = useEngModeState({',
    ]) {
        const at = dashboard.indexOf(anchor);
        assert.ok(at >= 0, `find ${anchor}`);
        assert.ok(at < hook, `the apply hook must follow: ${anchor}`);
    }
});

test('the options object names exactly what the apply reads from it', () => {
    const body = between(dashboard, 'const shareViewOptions = {', '\n            };').slice('const shareViewOptions = {'.length);
    const provided = new Set(topLevelKeys(body));
    const read = new Set();
    for (const name of ['applyController.js', 'useShareViewApply.js']) {
        for (const match of shareViewCode[name].matchAll(/\b(?:o|options)\.([A-Za-z_$][\w$]*)/g)) read.add(match[1]);
    }
    assert.deepEqual([...read].filter(name => !provided.has(name)).sort(), [], 'every option the apply reads is passed by the App');
    assert.deepEqual([...provided].filter(name => !read.has(name)).sort(), [], 'every option the App passes is read by the apply');
});

test('the alert flag pairs cover the ten alert categories, each with its own value and setter', () => {
    const block = between(dashboard, 'alertFlags: {', '\n                },');
    for (const [key, flag] of [
        ['missing', 'MissingAlert'], ['blocked', 'BlockedAlert'], ['followup', 'PostponedAlert'], ['backlog', 'BacklogAlert'],
        ['missingTeam', 'MissingTeamAlert'], ['missingLabels', 'MissingLabelsAlert'], ['needsStories', 'NeedsStoriesAlert'],
        ['waiting', 'WaitingAlert'], ['empty', 'EmptyEpicAlert'], ['done', 'DoneEpicAlert'],
    ]) {
        assert.ok(block.includes(`${key}: [show${flag}, setShow${flag}]`), key);
    }
});

test('the ENG task-load effect holds for a pending link, with the Planning recovery capsule as the only exception', () => {
    const head = between(dashboard, "if (selectedView !== 'eng' || isStatsSourceOnlyStatsView) return;", 'const pendingPlanningResume = pendingPlanningAuthResumeRef.current;');
    assert.ok(head.includes('if (groupPreferences.onboardingRequired) {'));
    assert.ok(head.includes('if (shareViewHold && !pendingPlanningAuthResumeRef.current) {'));
    assert.ok(head.indexOf('if (groupsLoading) {') < head.indexOf('if (shareViewHold'));
    assert.ok(dashboard.includes('groupsLoading, groupPreferences.onboardingRequired, configRefreshNonce, authResumeStagedRevision, shareViewHold]);'));
});

test('the Planning review read holds with the link, so it never reads the review of the recipient saved Sprint', () => {
    const call = between(dashboard, 'const planningReview = usePlanningSprintReview({', '\n            });');
    assert.ok(call.includes("active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured && !shareViewHold,"));
    assert.ok(dashboard.indexOf('const shareViewHold = useShareViewHold();') < dashboard.indexOf('const planningReview = usePlanningSprintReview({'));
});

test('the early link hooks precede both of their consumers and the Catch Up tour waits for the link', () => {
    const early = dashboard.indexOf('const shareViewHold = useShareViewHold();');
    assert.ok(early > 0);
    assert.ok(dashboard.indexOf('const shareViewTerminal = useShareViewApplyTerminal();') > early);
    assert.ok(dashboard.indexOf('const shareViewPlanningTableKey = useShareViewPlanningTableKey();') > early);
    assert.ok(early < dashboard.indexOf('const onboarding = useOnboardingController({'));
    assert.ok(early < dashboard.indexOf("if (selectedView !== 'eng' || isStatsSourceOnlyStatsView) return;"));
    assert.ok(between(dashboard, 'const onboarding = useOnboardingController({', 'trackSettingsAction,').includes('applyTerminal: shareViewTerminal,'));
    // The Planning table reads the link's Epics/Stories seed once, when it mounts, so the link remounts a table that is already open.
    assert.ok(dashboard.includes('<PlanningReviewTable key={shareViewPlanningTableKey} toolbarHost={planningToolbarHost}'));
    const tour = read('frontend/src/onboarding/useOnboardingTour.js');
    assert.ok(tour.includes('&& applyTerminal\n        && activeSurface === \'catch-up\''));
    assert.ok(tour.includes('}, [activeSurface, applyTerminal, bootstrapReady, normalizedCompletedModules, openModule, run]);'));
});
