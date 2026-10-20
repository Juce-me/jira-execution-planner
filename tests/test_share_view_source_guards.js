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
    assert.ok(call.includes("active: selectedView === 'eng' && showPlanning && planningLayout === 'table' && engWorkspaceConfigured && !shareViewHold && reviewGroupReady, groupId: reviewGroupId,"));
    assert.ok(dashboard.indexOf('const shareViewHold = useShareViewHold();') < dashboard.indexOf('const planningReview = usePlanningSprintReview({'));
    // The review scope comes from the resolved group (#267), derived before the review hook runs.
    const scope = dashboard.indexOf('} = usePlanningGroupScope({ planningReviewGuardRef, activeGroup, groupsLoading,');
    assert.ok(scope > dashboard.indexOf('const activeGroup = React.useMemo(() => {'));
    assert.ok(scope < dashboard.indexOf('const planningReview = usePlanningSprintReview({'));
});

// Every setActiveGroupId writer, pinned by its code (#267). User-initiated changes go through the review guard;
// automatic and forced ones call the raw setter and discard a dirty review like a context change.
const GROUP_WRITERS = {
    'frontend/src/eng/EngControls.jsx': {
        "setActiveGroupId(group.id, () => trackFilterChanged('group', { group_count_bucket: bucketCount(group?.teamIds?.length || 0), scope_type: currentDashboardView() }));": 'user: header dropdown (guarded setter, analytics inside the guarded callback)',
    },
    'frontend/src/eng/usePlanningGroupScope.js': {
        'const apply = () => { onCommit?.(); setActiveGroupId(next); };': 'the guarded setter: commits only after the review guard proceeds',
    },
    'frontend/src/settings/useGroupVisibilityPreferences.js': {
        'setActiveGroupId(nextActiveGroupId);': 'automatic: hide-the-active-group effect',
        'setActiveGroupId(nextPreferences.activeGroupId);': 'user: first-run Department save (guarded before the persist call)',
        'setActiveGroupId(prev => resolveVisibleActiveGroupId(normalized, effectiveIds, nextPreferences.activeGroupId || prev));': 'automatic: apply local preferences',
        'setActiveGroupId(nextPreferences.activeGroupId || null);': 'user: Settings Save (guarded before the persist call)',
    },
    'frontend/src/settings/useTeamGroupSettings.js': {
        'setActiveGroupId(prev => {': 'automatic: favorite re-resolution on load/Retry and after a groups save (two updaters)',
    },
    'frontend/src/settings/useFirstRunConfiguration.js': {
        'setActiveGroupId(captured?.activeGroupId || null);': 'automatic: first-run cancel',
    },
    'frontend/src/shareView/applyController.js': {
        'o.setActiveGroupId(scope.group.id);': 'automatic: share-link apply (cancels while the review is busy)',
    },
    'frontend/src/dashboard.jsx': {
        'if (groupAvailable) setActiveGroupId(requestedGroup);': 'automatic: auth resume',
        'setActiveGroupId(null);': 'automatic: onboarding required',
    },
};

function sourceFiles(directory) {
    return fs.readdirSync(path.join(repoRoot, directory), { withFileTypes: true }).flatMap(entry => {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) return sourceFiles(relative);
        return /\.(jsx?|mjs)$/.test(entry.name) ? [relative] : [];
    });
}

test('every setActiveGroupId writer is classified, and only the pinned writers exist', () => {
    const found = {};
    for (const file of sourceFiles('frontend/src')) {
        for (const line of read(file).split('\n')) {
            if (/\bsetActiveGroupId\(/.test(line)) (found[file] ||= []).push(line.trim());
        }
    }
    const expected = Object.fromEntries(Object.entries(GROUP_WRITERS).map(([file, writers]) => [file, Object.keys(writers)]));
    assert.deepEqual(Object.keys(found).sort(), Object.keys(expected).sort());
    for (const [file, lines] of Object.entries(found)) {
        assert.deepEqual([...new Set(lines)].sort(), [...expected[file]].sort(), file);
    }
    assert.equal(found['frontend/src/settings/useTeamGroupSettings.js'].length, 2);
    assert.equal(found['frontend/src/dashboard.jsx'].length, 2);
});

test('the header dropdown gets the guarded setter and every automatic writer the raw one', () => {
    assert.ok(between(dashboard, '<GroupControl', '/>').includes('setActiveGroupId={guardedSetActiveGroupId}'));
    assert.ok(between(dashboard, '} = useTeamGroupSettings({', '});').includes('                setActiveGroupId,\n'));
    assert.ok(between(dashboard, '} = useFirstRunConfiguration({', '});').includes('                setActiveGroupId,\n'));
    assert.ok(between(dashboard, 'const shareViewOptions = {', '};').includes(' setActiveGroupId, '));
    assert.equal((dashboard.match(/guardedSetActiveGroupId/g) || []).length, 2, 'defined once, passed only to the header dropdown');
    const controls = read('frontend/src/eng/EngControls.jsx');
    assert.equal(controls.includes("trackFilterChanged('group'"), true);
    assert.equal(controls.match(/trackFilterChanged\('group'/g).length, 1, 'group analytics fire only inside the guarded callback');
});

test('Settings Saves that change the active group run the review guard before the persist call', () => {
    const hook = read('frontend/src/settings/useGroupVisibilityPreferences.js');
    for (const [start, end] of [
        ['const saveFirstRunGroupPreferences = React.useCallback(', 'const persistGroupPreferences = React.useCallback('],
        ['const persistGroupPreferences = React.useCallback(', '    return {\n'],
    ]) {
        const body = between(hook, start, end);
        const guard = body.indexOf('await confirmActiveGroupChange(');
        assert.ok(guard > 0, start);
        assert.ok(guard < body.lastIndexOf('await requestSaveGroupPreferences('), start);
        assert.ok(guard < body.indexOf('Saving(true)'), `${start}: the guard runs before the save starts`);
    }
    assert.ok(between(dashboard, '} = useTeamGroupSettings({', '});').includes('groupChangeGuardRef: planningReviewGuardRef,'));
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
