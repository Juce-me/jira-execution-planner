const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const frontendSrcPath = path.join(repoRoot, 'frontend', 'src');
const dashboardPath = path.join(frontendSrcPath, 'dashboard.jsx');
const legacyScenarioOverridesRoute = ['/api', 'scenario', 'overrides'].join('/');

function listSourceFiles(root) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) return listSourceFiles(fullPath);
        return /\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    });
}

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function relativeFile(filePath) {
    return path.relative(repoRoot, filePath);
}

test('dashboard no longer calls legacy scenario overrides route', () => {
    const dashboardSource = readSource(dashboardPath);

    assert.equal(
        dashboardSource.includes(legacyScenarioOverridesRoute),
        false,
        'frontend/src/dashboard.jsx must use the scenario drafts route instead of the legacy overrides route',
    );
});

test('frontend source has no legacy scenario overrides route strings', () => {
    const violations = listSourceFiles(frontendSrcPath)
        .filter((filePath) => readSource(filePath).includes(legacyScenarioOverridesRoute))
        .map(relativeFile);

    assert.deepEqual(violations, []);
});

test('scenario draft polling helper returns data without mutating realtime state', () => {
    const dashboardSource = readSource(dashboardPath);
    const helperMatch = dashboardSource.match(/const pollScenarioDraftEvents = async[\s\S]*?\n\s*\};\n\n\s*const saveScenarioDraftVersion/);
    const pollingEffectMatch = dashboardSource.match(/React\.useEffect\(\(\) => \{\n\s*if \(!scenarioActiveDraftReady\)[\s\S]*?window\.setInterval\(poll, 5000\);[\s\S]*?\n\s*\}, \[scenarioActiveDraftReady, scenarioActiveDraftId, scenarioScopeKey, scenarioDraftLastEventNumber\]\);/);

    assert.ok(helperMatch, 'Expected pollScenarioDraftEvents helper to exist.');
    assert.ok(pollingEffectMatch, 'Expected scenario draft polling effect to exist.');

    const helperSource = helperMatch[0];
    assert.equal(helperSource.includes('applyScenarioDraftEvent'), false, 'Polling helper must not apply events before the current-draft guard runs.');
    assert.equal(helperSource.includes('setScenarioDraftLastEventNumber'), false, 'Polling helper must not advance the event cursor before the current-draft guard runs.');

    const effectSource = pollingEffectMatch[0];
    assert.ok(effectSource.includes('expectedDraftId'), 'Polling effect must capture the draft id for current-draft checks.');
    assert.ok(effectSource.includes('scenarioActiveDraftIdRef.current === expectedDraftId'), 'Polling effect must ignore old-draft responses.');
    assert.ok(effectSource.includes('scenarioScopeKeyRef.current === expectedScopeKey'), 'Polling effect must ignore old-scope responses.');
    assert.ok(effectSource.includes('data.events.forEach(applyScenarioDraftEvent)'), 'Polling effect should apply events only after the current-draft guard.');
    assert.ok(effectSource.includes('setScenarioDraftLastEventNumber'), 'Polling effect should advance cursor only after the current-draft guard.');
});

test('scenario realtime self filtering learns identity from collaboration responses and keeps stable drag lifecycle', () => {
    const dashboardSource = readSource(dashboardPath);
    const remoteEditorsMatch = dashboardSource.match(/const scenarioRemoteEditors = React\.useMemo[\s\S]*?const scenarioIssueLockWarnings = React\.useMemo/);
    const lockWarningsMatch = dashboardSource.match(/const scenarioIssueLockWarnings = React\.useMemo[\s\S]*?\}, \[scenarioDraftLocks, isScenarioCurrentUser\]\);/);
    const dragEffectMatch = dashboardSource.match(/const scenarioDraggingIssueKey = scenarioDragState\?\.issueKey \|\| '';\n\s*React\.useEffect\(\(\) => \{[\s\S]*?\n\s*\}, \[scenarioDraggingIssueKey\]\);/);

    assert.equal(dashboardSource.includes("displayName !== 'profile@example.com'"), false, 'Scenario presence filtering must not hard-code the test fixture email.');
    assert.equal(dashboardSource.includes("holderDisplayName || '').trim() !== 'profile@example.com'"), false, 'Scenario lock filtering must not hard-code the test fixture email.');
    assert.equal(dashboardSource.includes('fetchAuthStatus(BACKEND_URL)'), false, 'Scenario realtime self filtering must not depend on auth status profile fields.');
    assert.ok(dashboardSource.includes('learnScenarioCurrentUserFromPresence(data.presence)'), 'Presence heartbeat responses must teach the current user identity.');
    assert.ok(dashboardSource.includes('learnScenarioCurrentUserFromLock(data.lock)'), 'Own lock responses must teach the current user identity.');
    assert.ok(remoteEditorsMatch, 'Expected remote editor filtering to exist.');
    assert.ok(lockWarningsMatch, 'Expected lock warning filtering to exist.');
    assert.ok(remoteEditorsMatch[0].includes('isScenarioCurrentUser([item?.userId, item?.displayName])'), 'Presence filtering must compare against current user identifiers.');
    assert.ok(lockWarningsMatch[0].includes('isScenarioCurrentUser([lock?.holderUserId, lock?.holderDisplayName])'), 'Lock filtering must compare against current user identifiers.');
    assert.ok(remoteEditorsMatch[0].includes('!isScenarioPresenceExpired(item)'), 'Presence rendering must filter expired historical presence rows.');
    assert.ok(lockWarningsMatch[0].includes('!isScenarioLockExpired(lock)'), 'Lock rendering must filter expired historical locks.');
    assert.ok(dashboardSource.includes('const SCENARIO_PRESENCE_TTL_MS = 30000;'), 'Presence lastSeenAt expiry must use the server TTL window.');
    assert.ok(dashboardSource.includes('lastSeenAt + SCENARIO_PRESENCE_TTL_MS <= Date.now()'), 'Presence lastSeenAt must not be treated as an absolute expiry timestamp.');
    assert.ok(dashboardSource.includes('if (isScenarioPresenceExpired(payload.presence)) return;'), 'Presence events must not store expired historical presence rows.');
    assert.ok(dashboardSource.includes('if (isScenarioLockExpired(payload.lock))'), 'Lock events must not store expired historical locks.');
    assert.ok(dashboardSource.includes('const draftData = await fetchScenarioDraft(historyScopeKey, controller.signal);'), 'Opening draft history must refresh draft metadata after stale realtime events with an abort signal.');
    assert.ok(dashboardSource.includes('scenarioHistoryRefreshControllerRef.current !== controller'), 'History refresh responses must be ignored after a newer request or scope change.');
    assert.ok(dashboardSource.includes('!isScenarioScopeDraftCurrent(historyScopeKey, historyDraftId)'), 'History refresh must verify current scope and draft before mutating state.');
    assert.ok(dashboardSource.includes('scenarioHistoryActionControllerRef.current !== controller'), 'History version/rollback responses must be ignored after a newer request or scope change.');
    assert.ok(dashboardSource.includes('!isScenarioScopeDraftCurrent(expectedScopeKey, draftId)'), 'History actions must verify current scope and draft before mutating overrides or metadata.');
    assert.ok(dashboardSource.includes('fetchScenarioDraftVersion(draftId, action.versionNumber, controller.signal)'), 'History version fetches must receive an abort signal.');
    assert.ok(dashboardSource.includes('controller.signal\n                    );'), 'History rollback writes must receive an abort signal.');
    assert.equal(dashboardSource.includes('setScenarioOverrides(overrides);') && dashboardSource.indexOf('const openScenarioDraftHistory') < dashboardSource.indexOf('setScenarioOverrides(overrides);'), false, 'History refresh must not apply remote overrides over local edits.');
    assert.ok(dragEffectMatch, 'Drag mouse effect must be keyed by dragged issue, not every drag state update.');
    assert.equal(dragEffectMatch[0].includes('[scenarioDragState,'), false, 'Drag effect dependencies must not include mutable scenarioDragState.');
});

test('generated frontend dist files are not part of this task diff', () => {
    const result = childProcess.spawnSync('git', ['status', '--short', 'frontend/dist'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
});

test('dirty scenario draft reruns are blocked before loading new scenario data', () => {
    const dashboardSource = readSource(dashboardPath);
    const dirtyGuardIndex = dashboardSource.indexOf('if (scenarioHasUnsavedChanges) {');
    const scenarioFetchIndex = dashboardSource.indexOf('fetch(`${BACKEND_URL}/api/scenario`,');
    const setScenarioDataIndex = dashboardSource.indexOf('setScenarioData(data);');

    assert.ok(dirtyGuardIndex > -1, 'Expected runScenario to guard any dirty draft changes with derived dirty state.');
    assert.ok(scenarioFetchIndex > -1, 'Expected runScenario scenario fetch to exist.');
    assert.ok(setScenarioDataIndex > -1, 'Expected runScenario scenario data application to exist.');
    assert.ok(dirtyGuardIndex < scenarioFetchIndex, 'Dirty draft guard must run before scenario fetch.');
    assert.ok(dirtyGuardIndex < setScenarioDataIndex, 'Dirty draft guard must run before scenario data is applied.');
    assert.match(
        dashboardSource.slice(dirtyGuardIndex, scenarioFetchIndex),
        /pendingScopeChange:\s*\{\s*scopeKey:\s*scenarioScopeKey\s*\}[\s\S]*return;/,
        'Dirty draft guard must defer the pending scope and return before loading new data.',
    );
    assert.equal(
        dashboardSource.slice(dirtyGuardIndex, scenarioFetchIndex).includes('scenarioDraftMeta.scopeKey !== scenarioScopeKey'),
        false,
        'Dirty draft guard must not be limited to cross-scope changes.',
    );
    assert.equal(
        dashboardSource.slice(dirtyGuardIndex, scenarioFetchIndex).includes("scenarioDraftMeta.dirtyState === 'dirty'"),
        false,
        'Dirty draft guard must not rely on async dirtyState mirror.',
    );
});

test('clean scenario scope resets draft state before new scenario data is applied', () => {
    const dashboardSource = readSource(dashboardPath);
    const resetMatch = dashboardSource.match(/setScenarioOverrides\(\{\}\);\n[\s\S]*?setScenarioDraftMeta\(prev => \(\{\n\s*\.\.\.prev,[\s\S]*?activeDraft: null,[\s\S]*?savedOverrides: \{\},[\s\S]*?scopePayload,[\s\S]*?scopeKey: scenarioScopeKey,[\s\S]*?\}\)\);/);
    const setScenarioDataIndex = dashboardSource.indexOf('setScenarioData(data);');

    const foundResetIndex = resetMatch ? resetMatch.index : -1;

    assert.ok(foundResetIndex > -1, 'Expected runScenario to reset draft metadata for the new scope.');
    assert.ok(setScenarioDataIndex > -1, 'Expected runScenario to apply scenario data.');
    assert.ok(foundResetIndex < setScenarioDataIndex, 'Draft metadata reset must happen before new scenario data is visible.');

    const resetSource = dashboardSource.slice(foundResetIndex, setScenarioDataIndex);
    assert.ok(resetSource.includes('setScenarioOverrides({});'), 'Draft reset must clear old overrides before new scenario data is visible.');
    assert.ok(resetSource.includes('loadingHistory: Boolean(scenarioScopeKey)'), 'Draft reset must mark draft history loading for the new scope.');
    assert.ok(resetSource.includes("dirtyState: 'clean'"), 'Draft reset must leave the new scope in a clean state while loading.');
    assert.ok(resetSource.includes('setScenarioDraftPresence([]);'), 'Draft reset must clear old-scope presence before new scenario data is visible.');
    assert.ok(resetSource.includes('setScenarioDraftLocks([]);'), 'Draft reset must clear old-scope locks before new scenario data is visible.');
    assert.ok(resetSource.includes('setScenarioDraftLastEventNumber(0);'), 'Draft reset must clear old-scope event cursor.');
    assert.ok(resetSource.includes('staleDraft: null'), 'Draft reset must clear stale draft warnings for the new scope.');
});

test('discarding scenario overrides preserves loaded draft metadata', () => {
    const dashboardSource = readSource(dashboardPath);
    const discardMatch = dashboardSource.match(/const discardScenarioOverrides = \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const scenarioLaneForIssue/);

    assert.ok(discardMatch, 'Expected discardScenarioOverrides function to exist.');
    const discardSource = discardMatch[0];

    assert.ok(
        discardSource.includes('setScenarioOverrides(normalizeScenarioDraftOverrides(scenarioDraftMeta.savedOverrides));'),
        'Discard should restore saved override state instead of dropping draft metadata.',
    );
    assert.equal(discardSource.includes('activeDraft: null'), false, 'Discard must not clear activeDraft locally.');
    assert.equal(discardSource.includes('baseDraftRevision: null'), false, 'Discard must not clear baseDraftRevision locally.');
    assert.equal(discardSource.includes('versions: []'), false, 'Discard must not clear draft versions locally.');
});

test('draft save route sends csrf and baseDraftRevision', () => {
    const dashboardSource = readSource(dashboardPath);
    const saveHelperMatch = dashboardSource.match(/const saveScenarioDraftVersion = async[\s\S]*?\n\s*\};\n\n\s*const fetchScenarioDraftVersion/);
    const saveCallerMatch = dashboardSource.match(/const saveScenarioDraft = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const discardScenarioOverrides/);

    assert.ok(saveHelperMatch, 'Expected saveScenarioDraftVersion helper to exist.');
    assert.ok(saveCallerMatch, 'Expected saveScenarioDraft caller to exist.');
    const saveHelperSource = saveHelperMatch[0];
    const saveCallerSource = saveCallerMatch[0];

    assert.ok(saveHelperSource.includes('fetchScenarioCsrfToken()'), 'Draft save helper must fetch a CSRF token.');
    assert.ok(saveHelperSource.includes("'X-CSRF-Token': csrfToken"), 'Draft save helper must send the CSRF header.');
    assert.ok(saveHelperSource.includes('baseDraftRevision,'), 'Draft save payload must include baseDraftRevision.');
    assert.ok(saveHelperSource.includes('scenarioOverrides: normalizeScenarioDraftOverrides(overrides)'), 'Draft save payload must include scenarioOverrides.');
    assert.ok(saveCallerSource.includes('scenarioDraftMeta.baseDraftRevision'), 'Draft save caller must pass the loaded baseDraftRevision.');
    assert.ok(saveCallerSource.includes('const saveScopeKey = scenarioDraftMeta.scopeKey || scenarioScopeKey;'), 'Draft save must prefer the loaded draft scope while dirty.');
    assert.ok(saveCallerSource.includes('scenarioDraftMeta.scopePayload || {}'), 'Dirty old-scope save must use stored scope payload.');
    assert.equal(saveCallerSource.includes('scenarioDraftMeta.activeDraft?.scopePayload || {}'), false, 'Dirty old-scope save must not depend on activeDraft existing.');
});

test('scenario draft metadata stores display-safe scope payload without group membership', () => {
    const dashboardSource = readSource(dashboardPath);
    const stateMatch = dashboardSource.match(/const \[scenarioDraftMeta, setScenarioDraftMeta\] = useState\(\{[\s\S]*?\n\s*\}\);/);
    const scopeBuilderMatch = dashboardSource.match(/const buildScenarioDraftScope = \(\) => \(\{[\s\S]*?\n\s*\}\);/);
    const runScenarioMatch = dashboardSource.match(/const runScenario = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const toggleScenarioEditMode/);

    assert.ok(stateMatch, 'Expected scenarioDraftMeta state to exist.');
    assert.ok(scopeBuilderMatch, 'Expected buildScenarioDraftScope to exist.');
    assert.ok(runScenarioMatch, 'Expected runScenario to exist.');

    const stateSource = stateMatch[0];
    const scopeBuilderSource = scopeBuilderMatch[0];
    const runScenarioSource = runScenarioMatch[0];

    assert.ok(stateSource.includes('scopePayload: {}'), 'Draft metadata must initialize stored scope payload.');
    assert.ok(scopeBuilderSource.includes('groupId:'), 'Scope payload should include groupId.');
    assert.ok(scopeBuilderSource.includes('groupName:'), 'Scope payload should include groupName.');
    assert.ok(scopeBuilderSource.includes('sprintId:'), 'Scope payload should include sprintId.');
    assert.ok(scopeBuilderSource.includes('sprintName:'), 'Scope payload should include sprintName.');
    assert.equal(/members|teamIds/.test(scopeBuilderSource), false, 'Scope payload must not include group membership.');
    assert.ok(runScenarioSource.includes('const scopePayload = buildScenarioDraftScope();'), 'Scenario load must capture current display-safe scope payload.');
    assert.ok(runScenarioSource.includes('scopePayload,'), 'Scenario load must store scope payload when resetting metadata.');
    assert.ok(runScenarioSource.includes('scopePayload: activeDraft.scopePayload || scopePayload'), 'Active draft load must keep server scope payload or current display-safe fallback.');
});

test('draft load failure clears stale overrides for the newly applied scope', () => {
    const dashboardSource = readSource(dashboardPath);
    const failureMatch = dashboardSource.match(/catch \(err\) \{\n\s*if \(err\.name === 'AbortError'\) throw err;[\s\S]*?Failed to load scenario draft\.[\s\S]*?\n\s*\}\);/);

    assert.ok(failureMatch, 'Expected draft-load failure handler to exist.');
    const failureSource = failureMatch[0];

    assert.ok(failureSource.includes('setScenarioOverrides({});'), 'Draft-load failure must clear old local overrides.');
    assert.ok(failureSource.includes('activeDraft: null'), 'Draft-load failure must clear old activeDraft.');
    assert.ok(failureSource.includes('baseDraftRevision: null'), 'Draft-load failure must clear old baseDraftRevision.');
    assert.ok(failureSource.includes('savedOverrides: {}'), 'Draft-load failure must clear old savedOverrides.');
    assert.ok(failureSource.includes('scopeKey: scenarioScopeKey'), 'Draft-load failure must reset metadata to the newly applied scope.');
});

test('save and discard use normalized dirty state rather than override count', () => {
    const dashboardSource = readSource(dashboardPath);
    const dirtyStateMatch = dashboardSource.match(/const scenarioHasUnsavedChanges = scenarioOverridesSignature !== savedScenarioOverridesSignature;/);
    const saveCallerMatch = dashboardSource.match(/const saveScenarioDraft = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const discardScenarioOverrides/);
    const discardMatch = dashboardSource.match(/const discardScenarioOverrides = \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const scenarioLaneForIssue/);
    const saveButtonMatch = dashboardSource.match(/onClick=\{saveScenarioDraft\}[\s\S]*?title="Save draft overrides to server"/);
    const discardButtonMatch = dashboardSource.match(/onClick=\{discardScenarioOverrides\}[\s\S]*?title="Discard all overrides"/);

    assert.ok(dirtyStateMatch, 'Expected normalized dirty comparison to be derived.');
    assert.ok(saveCallerMatch, 'Expected saveScenarioDraft caller to exist.');
    assert.ok(discardMatch, 'Expected discardScenarioOverrides function to exist.');
    assert.ok(saveButtonMatch, 'Expected save draft button to exist.');
    assert.ok(discardButtonMatch, 'Expected discard button to exist.');

    const saveCallerSource = saveCallerMatch[0];
    const discardSource = discardMatch[0];
    const saveButtonSource = saveButtonMatch[0];
    const discardButtonSource = discardButtonMatch[0];

    assert.ok(dashboardSource.includes('const scenarioCanSaveDraft = scenarioHasUnsavedChanges'), 'Save eligibility must use dirty state.');
    assert.ok(dashboardSource.includes('!scenarioDraftMeta.loadingHistory'), 'Save eligibility must block while draft metadata is loading.');
    assert.equal(saveCallerSource.includes('scenarioOverrideCount === 0'), false, 'Save must allow empty override versions when dirty.');
    assert.ok(discardSource.includes('!scenarioHasUnsavedChanges'), 'Discard early return must use dirty state.');
    assert.equal(discardSource.includes('scenarioOverrideCount === 0'), false, 'Discard must restore saved overrides even when current overrides are empty.');
    assert.ok(saveButtonSource.includes('!scenarioCanSaveDraft'), 'Save button must be gated by shared save eligibility.');
    assert.equal(saveButtonSource.includes('scenarioOverrideCount === 0'), false, 'Save button must not be gated by override count.');
    assert.ok(discardButtonSource.includes('!scenarioHasUnsavedChanges'), 'Discard button must be gated by dirty state.');
    assert.equal(discardButtonSource.includes('scenarioOverrideCount === 0'), false, 'Discard button must not be gated by override count.');
});

test('dirty stored draft scope can be saved after current scenario data is cleared', () => {
    const dashboardSource = readSource(dashboardPath);
    const saveEligibilityMatch = dashboardSource.match(/const scenarioHasStoredDraftScope = Boolean\([\s\S]*?\);\n\s*const scenarioCanSaveDraft =[\s\S]*?;\n\s*const scenarioSprintBounds/);
    const saveCallerMatch = dashboardSource.match(/const saveScenarioDraft = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const discardScenarioOverrides/);
    const saveButtonMatch = dashboardSource.match(/onClick=\{saveScenarioDraft\}[\s\S]*?title="Save draft overrides to server"/);

    assert.ok(saveEligibilityMatch, 'Expected shared save eligibility to exist.');
    assert.ok(saveCallerMatch, 'Expected saveScenarioDraft caller to exist.');
    assert.ok(saveButtonMatch, 'Expected Save Draft button to exist.');

    const saveEligibilitySource = saveEligibilityMatch[0];
    const saveCallerSource = saveCallerMatch[0];
    const saveButtonSource = saveButtonMatch[0];

    assert.ok(saveEligibilitySource.includes('scenarioDraftMeta.scopeKey'), 'Stored draft scope key must contribute to save eligibility.');
    assert.ok(saveEligibilitySource.includes('scenarioDraftMeta.scopePayload'), 'Stored draft scope payload must contribute to save eligibility.');
    assert.ok(saveEligibilitySource.includes('(scenarioData && scenarioScopeKey) || scenarioHasStoredDraftScope'), 'Save eligibility must allow stored draft scope without current scenarioData.');
    assert.equal(saveCallerSource.includes('!scenarioData'), false, 'Save helper must not hard-require current scenarioData.');
    assert.equal(saveButtonSource.includes('!scenarioData'), false, 'Save button must not hard-require current scenarioData.');
    assert.equal(saveButtonSource.includes('!scenarioScopeKey'), false, 'Save button must not hard-require current scenarioScopeKey when stored scope exists.');
    assert.ok(saveCallerSource.includes('!scenarioCanSaveDraft'), 'Save helper must use shared save eligibility.');
    assert.ok(saveButtonSource.includes('!scenarioCanSaveDraft'), 'Save button must use shared save eligibility.');
});

test('scenario draft load and save failures are visibly rendered', () => {
    const dashboardSource = readSource(dashboardPath);
    const scenarioErrorIndex = dashboardSource.indexOf('{scenarioError && <div className="scenario-error" role="alert">{scenarioError}</div>}');
    const draftErrorIndex = dashboardSource.indexOf('{scenarioDraftMeta.error && (');
    const draftConflictIndex = dashboardSource.indexOf('{scenarioDraftMeta.conflict && (');

    assert.ok(scenarioErrorIndex > -1, 'Expected scenario error surface to exist.');
    assert.ok(draftErrorIndex > -1, 'Expected scenario draft error surface to exist.');
    assert.ok(draftConflictIndex > -1, 'Expected scenario draft conflict surface to exist.');
    assert.ok(draftErrorIndex > scenarioErrorIndex, 'Draft error should render in the scenario status area.');
    assert.ok(draftConflictIndex > scenarioErrorIndex, 'Draft conflict should render in the scenario status area.');

    const draftStatusSource = dashboardSource.slice(scenarioErrorIndex, draftConflictIndex + 250);
    assert.ok(draftStatusSource.includes('scenarioDraftMeta.error'), 'Draft load/save errors must be rendered from scenarioDraftMeta.error.');
    assert.ok(draftStatusSource.includes('scenarioDraftMeta.conflict'), 'Draft save conflicts must be rendered from scenarioDraftMeta.conflict.');
    assert.ok(draftStatusSource.includes('role="alert"'), 'Draft errors/conflicts should use alert semantics.');
    assert.ok(draftStatusSource.includes('Scenario draft conflict'), 'Draft conflict alert should have visible text.');
});

test('draft save conflict blocks blind save with keep-editing and history actions', () => {
    const dashboardSource = readSource(dashboardPath);
    const saveEligibilityMatch = dashboardSource.match(/const scenarioCanSaveDraft = scenarioHasUnsavedChanges[\s\S]*?;\n\s*const scenarioSprintBounds/);
    const saveCatchMatch = dashboardSource.match(/const saveScenarioDraft = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const discardScenarioOverrides/);

    assert.ok(saveEligibilityMatch, 'Expected shared save eligibility to exist.');
    assert.ok(saveCatchMatch, 'Expected save failure handler to exist.');

    const saveEligibilitySource = saveEligibilityMatch[0];
    const saveSource = saveCatchMatch[0];
    const saveCatchIndex = saveSource.indexOf('} catch (err) {');
    assert.ok(saveCatchIndex > -1, 'Expected save failure catch block to exist.');
    const saveCatchSource = saveSource.slice(saveCatchIndex);
    const conflictRenderIndex = dashboardSource.indexOf('{scenarioDraftMeta.conflict && (');
    const scenarioLoadingIndex = dashboardSource.indexOf('{scenarioLoading &&', conflictRenderIndex);
    assert.ok(conflictRenderIndex > -1, 'Expected conflict render block to exist.');
    assert.ok(scenarioLoadingIndex > conflictRenderIndex, 'Expected scenario loading block after conflict render.');
    const conflictRenderSource = dashboardSource.slice(conflictRenderIndex, scenarioLoadingIndex);

    assert.ok(saveEligibilitySource.includes("scenarioDraftMeta.dirtyState !== 'conflict_remote'"), 'Unresolved remote conflicts must block blind Save.');
    assert.ok(saveEligibilitySource.includes('!scenarioDraftMeta.conflict'), 'Visible conflict banners must block Save until resolved.');
    assert.ok(saveCatchSource.includes("dirtyState: 'conflict_remote'"), 'Canonical conflicts must move draft state to conflict_remote.');
    assert.ok(saveCatchSource.includes('err.payload?.error === \'scenario_draft_conflict\''), 'Only canonical scenario_draft_conflict responses should use conflict recovery UI.');
    assert.equal(saveCatchSource.includes('setScenarioOverrides('), false, 'Save conflict must not mutate local scenarioOverrides.');
    assert.equal(saveCatchSource.includes('scenarioUndoStackRef.current.clear()'), false, 'Save conflict must not clear undo/redo.');
    assert.equal(saveCatchSource.includes('baseDraftRevision: null'), false, 'Save conflict must not reset baseDraftRevision.');

    assert.ok(conflictRenderSource.includes('currentDraftRevision'), 'Conflict UI must show currentDraftRevision.');
    assert.ok(conflictRenderSource.includes('currentVersionNumber'), 'Conflict UI must show currentVersionNumber.');
    assert.ok(conflictRenderSource.includes('activeDraft?.updatedBy'), 'Conflict UI must show actor from activeDraft.updatedBy.');
    assert.ok(conflictRenderSource.includes('activeDraft?.updatedAt'), 'Conflict UI must show time from activeDraft.updatedAt.');
    assert.ok(conflictRenderSource.includes('Keep Editing'), 'Conflict UI must expose Keep Editing.');
    assert.ok(conflictRenderSource.includes("dirtyState: 'dirty_local'"), 'Keep editing locally must return to dirty_local.');
    assert.ok(conflictRenderSource.includes('Review history'), 'Conflict UI must expose Review history.');
    assert.ok(conflictRenderSource.includes('onClick={openScenarioDraftHistory}'), 'Review history must open history without applying remote state.');
    assert.ok(conflictRenderSource.includes('role="dialog"'), 'Review history must render a minimal visible history-open panel.');
    assert.ok(conflictRenderSource.includes('Scenario draft history'), 'Review history panel must be labelled.');
});

test('draft save retries csrf_required once and preserves failed local edits', () => {
    const dashboardSource = readSource(dashboardPath);
    const saveCatchMatch = dashboardSource.match(/const saveScenarioDraft = async \(\) => \{[\s\S]*?\n\s*\};\n\n\s*const discardScenarioOverrides/);

    const saveHelperIndex = dashboardSource.indexOf('const saveScenarioDraftVersion = async');
    const fetchVersionIndex = dashboardSource.indexOf('const fetchScenarioDraftVersion', saveHelperIndex);
    assert.ok(saveHelperIndex > -1, 'Expected saveScenarioDraftVersion helper to exist.');
    assert.ok(fetchVersionIndex > saveHelperIndex, 'Expected fetchScenarioDraftVersion after save helper.');
    assert.ok(saveCatchMatch, 'Expected save failure handler to exist.');

    const saveHelperSource = dashboardSource.slice(saveHelperIndex, fetchVersionIndex);
    const saveSource = saveCatchMatch[0];
    const saveCatchIndex = saveSource.indexOf('} catch (err) {');
    assert.ok(saveCatchIndex > -1, 'Expected save failure catch block to exist.');
    const saveCatchSource = saveSource.slice(saveCatchIndex);

    assert.ok(saveHelperSource.includes('postScenarioDraft(csrfToken)'), 'Save helper should post with the fetched CSRF token.');
    assert.ok(saveHelperSource.includes("err.payload?.error === 'csrf_required'"), 'Save helper must detect csrf_required.');
    assert.ok(saveHelperSource.includes('freshCsrfToken'), 'Save helper must fetch a fresh CSRF token for the one retry.');
    assert.equal((saveHelperSource.match(/fetchScenarioCsrfToken\(\)/g) || []).length, 2, 'Save helper must fetch CSRF at most twice.');
    assert.ok(saveHelperSource.includes('csrfRetry'), 'Retry failure must surface a recoverable CSRF error.');

    assert.equal(saveCatchSource.includes('setScenarioOverrides('), false, 'Failed saves must not mutate local scenarioOverrides.');
    assert.equal(saveCatchSource.includes('scenarioUndoStackRef.current.clear()'), false, 'Failed saves must not clear undo/redo.');
    assert.equal(saveCatchSource.includes('activeDraft: null'), false, 'Failed saves must not clear activeDraft.');
    assert.equal(saveCatchSource.includes('baseDraftRevision: null'), false, 'Failed saves must not reset baseDraftRevision.');
    assert.equal(saveCatchSource.includes('savedOverrides: {}'), false, 'Failed saves must not overwrite savedOverrides.');
});

test('history reload and rollback use inline dialog controls and guarded rollback writes', () => {
    const dashboardSource = readSource(dashboardPath);
    const historyActionMatch = dashboardSource.match(/const requestScenarioHistoryAction = \(type, versionNumber\) => \{[\s\S]*?\n\s*\};\n\n\s*const scenarioLaneForIssue/);
    const rollbackHelperMatch = dashboardSource.match(/const rollbackScenarioDraft = async[\s\S]*?\n\s*\};\n\n\s*const buildScenarioDraftScope/);
    const historyRenderIndex = dashboardSource.indexOf('{scenarioDraftMeta.historyOpen && (');
    const scenarioLoadingIndex = dashboardSource.indexOf('{scenarioLoading &&', historyRenderIndex);

    assert.ok(historyActionMatch, 'Expected history reload/rollback action handlers to exist.');
    assert.ok(rollbackHelperMatch, 'Expected rollback helper to exist.');
    assert.ok(historyRenderIndex > -1, 'Expected history dialog render block to exist.');
    assert.ok(scenarioLoadingIndex > historyRenderIndex, 'Expected scenario loading block after history dialog.');

    const historyActionSource = historyActionMatch[0];
    const rollbackHelperSource = rollbackHelperMatch[0];
    const historyRenderSource = dashboardSource.slice(historyRenderIndex, scenarioLoadingIndex);

    assert.equal(historyActionSource.includes('window.confirm('), false, 'Dirty history replacement must not use browser-native confirm.');
    assert.equal(historyActionSource.includes('confirm('), false, 'Dirty history replacement must not use browser-native confirm.');
    assert.ok(historyRenderSource.includes('role="dialog"'), 'History UI must use dialog semantics.');
    assert.ok(historyRenderSource.includes('aria-modal="false"'), 'History dialog must be non-modal.');
    assert.ok(historyRenderSource.includes('aria-labelledby="scenario-draft-history-title"'), 'History dialog must have a labelled title.');
    assert.ok(historyRenderSource.includes('Close'), 'History dialog must expose a native close button.');
    assert.ok(historyRenderSource.includes('Version {versionNumber}'), 'History rows must render version numbers.');
    assert.ok(historyRenderSource.includes('override{overrideCount === 1 ?'), 'History rows must render override counts.');
    assert.ok(historyRenderSource.includes('Current'), 'History rows must render current state.');
    assert.ok(historyRenderSource.includes('Loaded'), 'History rows must render loaded state.');
    assert.ok(historyRenderSource.includes('scenarioDraftMeta.conflict?.currentVersionNumber || scenarioDraftMeta.activeDraft?.versionNumber'), 'Conflict current version must take precedence over stale activeDraft version in history rows.');
    assert.ok(historyRenderSource.includes('!isCurrent && isLoaded'), 'History row state must be mutually exclusive with Current taking precedence over Loaded.');
    assert.ok(historyRenderSource.includes('Reload Version'), 'History rows must expose reload actions.');
    assert.ok(historyRenderSource.includes('Rollback to Version'), 'History rows must expose rollback actions.');
    assert.equal(historyRenderSource.includes('Continue reload version'), false, 'Dirty reload confirmation must not expose a generic Continue action.');
    assert.equal(historyRenderSource.includes('Continue rollback to version'), false, 'Dirty rollback confirmation must not expose a generic Continue action.');
    assert.equal(historyRenderSource.includes('Continue'), false, 'Dirty history confirmation must use the action name instead of Continue.');
    assert.ok(historyRenderSource.includes('pendingHistoryAction'), 'Dirty reload/rollback must use inline pending confirmation state.');

    assert.ok(historyActionSource.includes('if (scenarioHasUnsavedChanges)'), 'History replacement actions must guard dirty local edits.');
    assert.ok(historyActionSource.includes('fetchScenarioDraftVersion(draftId, action.versionNumber, controller.signal)'), 'Reload and rollback must fetch the target snapshot with an abort signal.');
    assert.ok(historyActionSource.includes("action.type === 'reload'"), 'History actions must support local reload.');
    assert.ok(historyActionSource.includes('rollbackScenarioDraft('), 'History actions must support backend rollback.');
    assert.ok(historyActionSource.includes('scenarioUndoStackRef.current.clear()'), 'Successful history replacement must clear undo/redo.');
    assert.ok(historyActionSource.includes("err.payload?.error === 'scenario_draft_conflict'"), 'Rollback conflicts must use canonical stale-draft conflict UI.');

    assert.ok(rollbackHelperSource.includes('fetchScenarioCsrfToken()'), 'Rollback helper must fetch CSRF token.');
    assert.ok(rollbackHelperSource.includes("'X-Requested-With': 'jira-execution-planner'"), 'Rollback helper must send requested-with header.');
    assert.ok(rollbackHelperSource.includes("'X-CSRF-Token': csrfToken"), 'Rollback helper must send CSRF header.');
    assert.ok(rollbackHelperSource.includes('targetVersionNumber,'), 'Rollback payload must send targetVersionNumber.');
    assert.ok(rollbackHelperSource.includes('baseDraftRevision'), 'Rollback payload must send baseDraftRevision.');
});
