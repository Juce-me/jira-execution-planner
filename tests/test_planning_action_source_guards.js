const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('planning action row includes postponed and awaiting validation bulk actions', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /toggleIncludeByStatus\(\['Postponed'\]\)/);
    assert.match(source, /toggleIncludeByStatus\(\['Awaiting Validation'\]\)/);
    assert.match(componentSource, />\s*Postponed\s*</);
    assert.match(componentSource, />\s*Awaiting Val\.\s*</);
    assert.match(componentSource, /onTogglePostponed/);
    assert.match(componentSource, /onToggleAwaitingValidation/);
});

test('planning action row includes select all for currently visible planning tasks', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const helperPath = path.resolve(__dirname, '../frontend/src/eng/planningSelectionActions.js');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const helperSource = fs.readFileSync(helperPath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(helperSource, /selectAllVisiblePlanningTasks\(\) \{/);
    assert.match(helperSource, /selectAllVisiblePlanningTasksMap\(visibleTasksForList\)/);
    assert.match(helperSource, /next\[task\.key\] = true;/);
    assert.match(source, /hasVisiblePlanningTasks=\{visibleTasksForList\.length > 0\}/);
    assert.match(componentSource, /onSelectAllVisible/);
    assert.match(componentSource, /disabled=\{!hasVisiblePlanningTasks\}/);
    assert.match(componentSource, />\s*Select All\s*</);
});

test('planning action row exposes undo for bulk selection changes', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const helperPath = path.resolve(__dirname, '../frontend/src/eng/planningSelectionActions.js');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const helperSource = fs.readFileSync(helperPath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(helperSource, /undoPlanningSelectionChange\(\) \{/);
    assert.match(source, /canUndoPlanningSelection=\{canUndoPlanningSelection\}/);
    assert.match(source, /onUndoPlanningSelection=\{undoPlanningSelectionChange\}/);
    assert.match(helperSource, /trackPlanningSelection\('undo_selection'/);
    assert.match(componentSource, /canUndoPlanningSelection/);
    assert.match(componentSource, /onUndoPlanningSelection/);
    assert.match(componentSource, /disabled=\{!canUndoPlanningSelection\}/);
    assert.match(componentSource, />\s*Undo\s*</);
});

test('planning action bar shows status-target feedback but adds no status-change control', () => {
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    // Feedback-only props are accepted and surfaced.
    assert.match(componentSource, /statusTransitionTargetsCount/);
    assert.match(componentSource, /statusTransitionSubmitting/);
    assert.match(componentSource, /statusTransitionError/);
    assert.match(componentSource, /statusTransitionResult/);
    assert.match(componentSource, /planning-status-feedback/);

    // The status change itself is never triggered from the action bar: no submit/open
    // handler, no transition menu markup, no native select, no status-change button.
    assert.doesNotMatch(componentSource, /onSubmitStatusTransition/);
    assert.doesNotMatch(componentSource, /onOpenStatusTransition/);
    assert.doesNotMatch(componentSource, /status-transition-submit/);
    assert.doesNotMatch(componentSource, /<select/);
    assert.doesNotMatch(componentSource, /Change [Ss]tatus/);

    // Existing selection controls stay intact.
    assert.match(componentSource, />\s*Select All\s*</);
    assert.match(componentSource, />\s*Undo\s*</);
    assert.match(componentSource, />\s*Clear Selected\s*</);
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
    const effectIndex = source.indexOf('persistPlanningSelectionState({ storage: window.localStorage, scopeKey: planningScopeKey');

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

test('dashboard hydrates scoped team selection from group and sprint storage', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /buildTeamSelectionScopeKey/);
    assert.match(source, /loadTeamSelectionState\(window\.localStorage, teamSelectionScopeKey\)/);
    assert.match(source, /reconcileTeamSelectionState\(/);
    assert.match(source, /saveTeamSelectionState\(window\.localStorage, teamSelectionScopeKey,/);
});

test('selected sp by team forces six teams onto multiple rows', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/eng/PlanningTeamCapacityCards.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /const rows = teamCount === 6 \? 2 : Math\.ceil\(teamCount \/ 6\);/);
    assert.match(source, /'--planning-team-columns': columns/);
});

test('selected sp by team cards still render for a single team entry', () => {
    const dashboardSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    const componentSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng/PlanningTeamCapacityCards.jsx'), 'utf8');

    assert.match(dashboardSource, /<PlanningTeamCapacityCards/);
    assert.match(componentSource, /if \(sortedTeams\.length === 0\) return null;/);
    assert.match(componentSource, /\{sortedTeams\.map\(\(entry\) => \{/);
});

test('dashboard imports planning capacity helpers from ENG module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /from '\.\/eng\/planningCapacityUtils\.js'/);
    assert.doesNotMatch(source, /const getCapacityStatus = \(/);
    assert.doesNotMatch(source, /const getTeamCapacityMeta = \(/);
});

test('dashboard imports planning selection stat helpers from ENG module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /from '\.\/eng\/planningSelectionStats\.js'/);
    assert.doesNotMatch(source, /selectedTasksList\.reduce\(\(sum, task\) => \{/);
    assert.doesNotMatch(source, /selectedPlanningTasksList\.reduce\(\(acc, task\) => \{/);
});

test('dashboard imports planning capacity aggregate helpers from ENG module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /buildTeamCapacityStats/);
    assert.doesNotMatch(source, /capacityTasks\.reduce\(\(acc, task\) => \{/);
    assert.doesNotMatch(source, /displayedTeamCapacityEntries\.reduce\(\(acc, info\) => \{/);
});

test('dashboard delegates capacity API and state shaping without owning editor UI', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');

    assert.match(source, /import \{ fetchCapacity as requestCapacity, updateCapacity \} from '\.\/api\/capacityApi\.js';/);
    assert.match(source, /reduceCapacityReadLifecycle/);
    assert.match(source, /applyCapacitySaveResultForScope/);
    assert.match(source, /resolveUniqueCapacityValue/);
    assert.match(source, /requestCapacity\(BACKEND_URL,/);
    assert.doesNotMatch(source, /const normalizeCapacityKey =/);
    assert.doesNotMatch(source, /const toCapacityShortName =/);
    assert.doesNotMatch(source, /className="capacity-editor/);
    assert.doesNotMatch(source, /data-capacity-editor/);
    assert.doesNotMatch(source, /document\.addEventListener\([^\n]*capacity/i);
});

test('dashboard delegates team capacity cards with OAuth and server-attested mutation gates', () => {
    const dashboardSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningTeamCapacityCards.jsx');

    assert.equal(fs.existsSync(componentPath), true);
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(dashboardSource, /import PlanningTeamCapacityCards from '\.\/eng\/PlanningTeamCapacityCards\.jsx';/);
    assert.match(dashboardSource, /<PlanningTeamCapacityCards/);
    assert.match(dashboardSource, /canOpenCapacityJira=\{authMode === 'atlassian_oauth'\}/);
    assert.match(dashboardSource, /canEditCapacity=\{authMode === 'atlassian_oauth' && capacityMutationEnabled === true\}/);
    assert.doesNotMatch(
        dashboardSource,
        /canEditCapacity=\{[^}]*?(?:userCanEditSettings|userCanEditEpmConfig|settingsAdminOnly)/,
    );
    assert.doesNotMatch(dashboardSource, /className="team-capacity-editor/);
    assert.doesNotMatch(dashboardSource, /className="team-capacity-action-rail/);
    assert.doesNotMatch(dashboardSource, /document\.addEventListener\(['"]pointerdown/);
    assert.match(componentSource, /document\.addEventListener\(['"]pointerdown/);
    assert.doesNotMatch(componentSource, /safeCapacityRecoveryUrl|recoveryUrl|Recover Atlassian access/);
    assert.doesNotMatch(componentSource, /redirectToAuthRecovery|location\.assign/);
    assert.doesNotMatch(
        componentSource,
        /userCanEditSettings|userCanEditEpmConfig|SETTINGS_ADMIN_ONLY|settingsAdminOnly/,
    );
});

test('planning capacity actions use the shared IconButton sizing contract', () => {
    const componentSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng/PlanningTeamCapacityCards.jsx'), 'utf8');
    const iconButtonSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/ui/IconButton.jsx'), 'utf8');
    const sharedControlsSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/styles/shared/controls.css'), 'utf8');
    const capacityStyles = fs.readFileSync(path.resolve(__dirname, '../frontend/src/styles/planning/stat-cards.css'), 'utf8');

    assert.match(iconButtonSource, /size = ''/);
    assert.match(iconButtonSource, /icon-button--\$\{size\}/);
    assert.match(iconButtonSource, /React\.forwardRef/);
    assert.match(sharedControlsSource, /\.icon-button--sm/);
    assert.match(sharedControlsSource, /\.icon-button--md/);
    assert.match(componentSource, /size="sm"/);
    assert.match(componentSource, /size="md"/);
    assert.doesNotMatch(capacityStyles, /\.team-capacity-action\s*\{[^}]*\bheight\s*:/s);
    assert.doesNotMatch(capacityStyles, /\.team-capacity-editor-action\s*\{[^}]*\bheight\s*:/s);
});

test('smoke screenshots keep general output separate from Task 8 capacity evidence', () => {
    const smokeSource = fs.readFileSync(path.resolve(__dirname, './ui/codebase_structure_smoke.spec.js'), 'utf8');

    assert.match(smokeSource, /test-results', 'codebase-structure-smoke/);
    assert.match(smokeSource, /const capacityArtifactDir = path\.join\(repoRoot, '\.superpowers'/);
    assert.match(smokeSource, /async function captureCapacitySmokeScreenshot/);
    assert.match(smokeSource, /captureCapacitySmokeScreenshot\(page, 'planning-capacity-pending'\)/);
    assert.doesNotMatch(smokeSource, /const screenshotDir = path\.join\(repoRoot, '\.superpowers'/);
});

test('the Jira mark paths have one shared JSX owner', () => {
    const sourceRoot = path.resolve(__dirname, '../frontend/src');
    const jiraIconPath = path.join(sourceRoot, 'ui', 'JiraMarkIcon.jsx');

    assert.equal(fs.existsSync(jiraIconPath), true);
    const jsxSources = [];
    const visit = (directory) => {
        fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(entryPath);
            if (entry.isFile() && entry.name.endsWith('.jsx')) {
                jsxSources.push([entryPath, fs.readFileSync(entryPath, 'utf8')]);
            }
        });
    };
    visit(sourceRoot);

    for (const pathData of [
        'M11.8 3.2 3 12l8.8 8.8 3-3L9 12l5.8-5.8-3-3z',
        'M12.2 3.2 21 12l-8.8 8.8-3-3L15 12 9.2 6.2l3-3z',
    ]) {
        const owners = jsxSources.filter(([, source]) => source.includes(pathData)).map(([file]) => file);
        assert.deepEqual(owners, [jiraIconPath]);
    }
});

test('capacity read state is atomic, scope-tagged, and advances revision only after HTTP success', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');

    assert.match(source, /const \[capacityState, setCapacityState\] = useState/);
    assert.match(source, /capacityByTeam:\s*\{\},\s*capacityTargetsByTeam:\s*\{\},\s*capacityIssueCount:\s*null,\s*mutationEnabled:\s*false,\s*scopeSignature:\s*''/);
    assert.match(source, /const \[capacityReadRevision, setCapacityReadRevision\] = useState\(0\)/);
    assert.match(source, /const \[capacityReadError, setCapacityReadError\] = useState\(''\)/);
    assert.match(source, /const \[capacityDataStale, setCapacityDataStale\] = useState\(false\)/);
    assert.match(source, /capacityState\.scopeSignature === capacityScopeSignature/);
    assert.match(source, /const capacityMutationEnabled = effectiveCapacityState\.mutationEnabled === true/);
    assert.equal((source.match(/setCapacityEnabled\(Boolean\([^)]*capacityConfigRequiresResolution[^)]*\)\)/g) || []).length, 2);
    assert.match(source, /commitCapacityReadLifecycle\(\{ type: 'success', scopeSignature, payload: data \}\)/);
    assert.doesNotMatch(source, /handleCapacitySaved[\s\S]{0,800}setCapacityReadRevision/);
});

test('capacity request orchestration delegates ownership and collision-proof scope identity', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    const effectStart = source.indexOf('const capacityScopeSignature =');
    const effectEnd = source.indexOf('const capacityTeamIds =', effectStart);
    const effect = source.slice(effectStart, effectEnd);

    assert.notEqual(effectStart, -1);
    assert.notEqual(effectEnd, -1);
    assert.match(effect, /buildCapacityScopeSignature\(/);
    assert.doesNotMatch(effect, /capacityTeamNames\.join\(/);
    assert.match(effect, /beginCapacityReadOwnership\(\{/);
    assert.match(effect, /if \(!ownership\.shouldFetch\)/);
    assert.match(effect, /signal: ownership\.controller\.signal/);
    assert.match(effect, /error\?\.name === 'AbortError'/);
    assert.match(effect, /return ownership\.cleanup;/);
});

test('capacity gates, success, and failure use the executable lifecycle reducer', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    const effectStart = source.indexOf('const capacityScopeSignature =');
    const effectEnd = source.indexOf('const capacityTeamIds =', effectStart);
    const effect = source.slice(effectStart, effectEnd);

    assert.match(effect, /commitCapacityReadLifecycle\(\{ type: 'gate', scopeSignature \}\)/);
    assert.match(effect, /commitCapacityReadLifecycle\(\{ type: 'start', scopeSignature \}\)/);
    assert.match(effect, /commitCapacityReadLifecycle\(\{ type: 'success', scopeSignature, payload: data \}\)/);
    assert.match(effect, /commitCapacityReadLifecycle\(\{ type: 'failure', scopeSignature \}\)/);
});

test('capacity scope refresh and save reconciliation stay scoped without extra card requests', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');

    assert.match(source, /const \[capacityRefreshNonce, setCapacityRefreshNonce\] = useState\(0\)/);
    assert.match(source, /setCapacityRefreshNonce\(previous => previous \+ 1\)/);
    assert.match(source, /capacityRefreshNonce[\s\S]{0,300}\]\);/);
    assert.match(source, /activeCapacityScopeRef\.current = capacityScopeSignature/);
    assert.match(source, /if \(result\.scopeSignature !== activeCapacityScopeRef\.current\) return;/);
    assert.match(source, /const nextState = applyCapacitySaveResultForScope\([\s\S]{0,180}previous,[\s\S]{0,180}result,[\s\S]{0,180}activeCapacityScopeRef\.current/);
    assert.equal((source.match(/requestCapacity\(BACKEND_URL,/g) || []).length, 1);
    assert.doesNotMatch(source, /onMouse(?:Enter|Over)=[^\n]*fetchCapacity/);
});

test('dashboard imports dependency focus helpers from issues module', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /from '\.\/issues\/dependencyFocusUtils\.js'/);
    assert.doesNotMatch(source, /const getBlockLinkBuckets = \(entries, taskKey\) => \{/);
    assert.doesNotMatch(source, /const dependencyKeySignature = React\.useMemo\(\(\) => \{\s*const keys = Array\.from\(new Set\(dependencyTasks\.map\(task => task\.key\)\.filter\(Boolean\)\)\);/);
});

test('dashboard delegates planning action row to ENG component', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /import PlanningActionBar from '\.\/eng\/PlanningActionBar\.jsx'/);
    assert.match(source, /<PlanningActionBar/);
    assert.doesNotMatch(source, /className="planning-actions"/);
    assert.match(componentSource, /className="planning-actions"/);
    assert.match(componentSource, />\s*Accepted\s*</);
    assert.match(componentSource, />\s*To Do\s*</);
    assert.match(componentSource, />\s*Clear Selected\s*</);
    assert.match(componentSource, /onOpenSelectedInJira/);
});

test('dashboard delegates planning capacity bar to ENG component', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningCapacityBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /import PlanningCapacityBar from '\.\/eng\/PlanningCapacityBar\.jsx'/);
    assert.match(source, /<PlanningCapacityBar/);
    assert.doesNotMatch(source, /className="capacity-bar-graph"/);
    assert.match(componentSource, /className="capacity-bar-graph"/);
    assert.match(componentSource, /capacity-bar-excluded-zone/);
    assert.match(componentSource, /capacity-bar-variance-zone/);
    assert.match(componentSource, /capacity-bar-marker teamcap/);
    assert.match(componentSource, /Selected:/);
    assert.match(componentSource, /\{selectedCount\} · \{selectedSP\.toFixed\(1\)\} SP/);
});

test('dashboard delegates planning project split bar to ENG component', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningProjectSplitBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /import PlanningProjectSplitBar from '\.\/eng\/PlanningProjectSplitBar\.jsx'/);
    assert.match(source, /<PlanningProjectSplitBar/);
    assert.doesNotMatch(source, /className="project-bar-graph"/);
    assert.doesNotMatch(source, /className="project-bar-fill product"/);
    assert.match(componentSource, /Selected SP by Project:/);
    assert.match(componentSource, /className="project-bar-graph"/);
    assert.match(componentSource, /className="project-bar-fill product"/);
    assert.match(componentSource, /className="project-bar-fill tech"/);
    assert.match(componentSource, /Target<br\/>/);
    assert.match(componentSource, /No tasks selected/);
});

test('ENG status transition hook imports the transition API and typed global auth contract', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    assert.match(hookSource, /import \{ fetchIssueTransitionOptions, transitionIssues \} from '\.\.\/api\/jiraIssueApi\.js';/);
    assert.match(hookSource, /import \{ isAuthenticationRequiredError \} from '\.\.\/api\/authRequired\.js';/);
    assert.doesNotMatch(hookSource, /redirectToAuthRecovery|location\.assign/);
});

test('ENG status transition hook aborts in-flight option requests when the target signature changes', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    assert.match(hookSource, /new AbortController\(\)/);
    assert.match(hookSource, /signal: controller\.signal/);
    assert.match(hookSource, /optionsRequestRef\.current\.signature === signature/);
    assert.match(hookSource, /optionsRequestRef\.current\.controller\.abort\(\);/);
});

test('ENG status transition hook tracks status_change_submit before mutating and threads source_surface through', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    const submitIndex = hookSource.indexOf("trackIssueStatusAction('status_change_submit'");
    const mutationIndex = hookSource.indexOf('transitionIssues(backendUrl');
    assert.notEqual(submitIndex, -1, 'Expected a status_change_submit analytics call');
    assert.notEqual(mutationIndex, -1, 'Expected the transitionIssues mutation call');
    assert.ok(submitIndex < mutationIndex, 'Expected status_change_submit to be tracked before the mutation call');

    assert.match(hookSource, /sourceSurface === 'catch_up'/);
    // source_surface threading now goes through the shared buildStatusActionAnalyticsParams
    // helper (frontend/src/eng/engStatusTransitionUtils.js) instead of an inline object
    // literal, so both status_options_open and status_change_submit hand their real
    // sourceSurface value to the shared builder rather than a hardcoded string.
    assert.match(hookSource, /import \{[^}]*buildStatusActionAnalyticsParams[^}]*\} from '\.\/engStatusTransitionUtils\.js';/);
    assert.match(hookSource, /buildStatusActionAnalyticsParams\(\{\s*\n\s*sourceSurface,/);
});

test('ENG status transition hook refreshes only after at least one issue succeeds', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    const guardIndex = hookSource.indexOf('if (summary.succeeded > 0) {');
    assert.notEqual(guardIndex, -1, 'Expected an explicit succeeded > 0 guard');
    // The refresh now carries the affected story keys so only those expanded subtask rows
    // re-fetch (Fix wave 1); it still fires only inside the succeeded > 0 block. The window
    // widened past 1000 chars to also cover the tuple/per-key transitionOptionsCache
    // invalidation (Step 3.4 + degenerate-signature fix) that now runs earlier in the same
    // guard block.
    const guardBody = hookSource.slice(guardIndex, guardIndex + 3000);
    assert.match(guardBody, /onTransitionSuccessRefresh\?\.\(\{ affectedSubtaskStoryKeys \}\)/);
    // The flag widened from `sourceSurface === 'catch_up'` to `sourceSurface !== 'planning'` and was
    // renamed with it (EXEC-eng-group-board §13's one permitted hook generalization): PLANNING is
    // the batch surface, and every single-issue surface — Catch Up and Board — reconciles locally
    // instead of starting a scope refresh. Catch Up evaluates identically either way.
    assert.match(guardBody, /if \(!isSingleIssueSurface\) \{\s*onTransitionSuccessRefresh/, 'Single-issue surfaces must reconcile locally instead of starting scope refreshes');
});

test('ENG status and priority hooks invalidate alert data after successful mutations on every surface', () => {
    const statusSource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js'), 'utf8');
    const prioritySource = fs.readFileSync(path.resolve(__dirname, '../frontend/src/eng/useEngPriorityTransitions.js'), 'utf8');
    const statusSuccessStart = statusSource.indexOf('if (summary.succeeded > 0) {');
    const prioritySuccessStart = prioritySource.indexOf("trackIssuePriorityAction('priority_change_result'");
    const statusSuccess = statusSource.slice(statusSuccessStart, statusSource.indexOf('return response;', statusSuccessStart));
    const prioritySuccess = prioritySource.slice(prioritySuccessStart, prioritySource.indexOf('return response;', prioritySuccessStart));

    assert.match(statusSource, /onAlertDataInvalidated,/);
    assert.match(statusSuccess, /if \(isCurrentMutation\) onAlertDataInvalidated\?\.\(\);/);
    assert.match(prioritySource, /onAlertDataInvalidated,/);
    assert.match(prioritySuccess, /if \(summary\.succeeded > 0 && isCurrentMutation\) onAlertDataInvalidated\?\.\(\);/);
    assert.doesNotMatch(statusSuccess, /if \(!isSingleIssueSurface\) \{\s*onAlertDataInvalidated/);
    assert.doesNotMatch(prioritySuccess, /else if \(summary\.succeeded > 0\) \{[\s\S]*onAlertDataInvalidated/);
});

test('ENG status transition hook never mutates Planning selectedTasks for Epics or Subtasks', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    assert.doesNotMatch(hookSource, /\bselectedTasks\b/, 'Hook must never read/write the raw Planning selectedTasks map, only selectedStories');
    assert.doesNotMatch(hookSource, /setSelectedTasks/);
});

test('ENG status transition hook moved its options cache to module scope shared across hook instances', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    const cacheDeclIndex = hookSource.indexOf('const transitionOptionsCache = new Map();');
    const hookFnIndex = hookSource.indexOf('export function useEngStatusTransitions');
    assert.notEqual(cacheDeclIndex, -1, 'Expected a module-level transitionOptionsCache Map');
    assert.notEqual(hookFnIndex, -1, 'Expected the useEngStatusTransitions hook export');
    assert.ok(
        cacheDeclIndex !== -1 && hookFnIndex !== -1 && cacheDeclIndex < hookFnIndex,
        'Expected transitionOptionsCache to be declared at module scope, before the hook function, so every hook instance/mount shares one cache instead of re-creating a per-instance ref'
    );
    assert.doesNotMatch(hookSource, /React\.useRef\(new Map\(\)\)/, 'Options cache must no longer be a per-instance React ref');
    assert.match(hookSource, /function transitionOptionCacheKey\(targets\)/, 'Expected the tuple-based cache key helper');
    assert.match(hookSource, /export function clearTransitionOptionsCache\(\)/, 'Expected a test/auth-recovery cache-clear escape hatch');
});

test('transitionOptionCacheKey keeps the mandated tuple for full targets and never collapses degenerate targets into a shared bucket', async () => {
    const { transitionOptionCacheKey } = await import('../frontend/src/eng/useEngStatusTransitions.js');

    // Full targets keep the mandated project|issueType|currentStatus tuple: two issues
    // sharing project/type/status intentionally share one cache signature.
    assert.equal(
        transitionOptionCacheKey([{ key: 'PROD-1', issueType: 'Story', currentStatus: 'To Do', summary: 'A' }]),
        'PROD|Story|To Do'
    );
    assert.equal(
        transitionOptionCacheKey([{ key: 'PROD-2', issueType: 'Story', currentStatus: 'To Do', summary: 'B' }]),
        'PROD|Story|To Do'
    );

    // Raw string keys must not collapse into one shared "||" bucket across issues.
    const rawA = transitionOptionCacheKey(['PROD-1']);
    const rawB = transitionOptionCacheKey(['TECH-9']);
    assert.notEqual(rawA, rawB, 'distinct raw keys must produce distinct cache signatures');
    assert.ok(!rawA.includes('|'), `raw-key signature must not degenerate to a tuple: ${rawA}`);

    // Type/status-less fallback targets (submit's explicit-key shape) must be unique per
    // issue key too, not a shared "PREFIX||" bucket for a whole project.
    const fallbackA = transitionOptionCacheKey([{ key: 'PROD-1', issueType: '', currentStatus: '', summary: '' }]);
    const fallbackB = transitionOptionCacheKey([{ key: 'PROD-2', issueType: '', currentStatus: '', summary: '' }]);
    assert.notEqual(fallbackA, fallbackB, 'distinct context-less targets must produce distinct cache signatures');
    assert.notEqual(fallbackA, 'PROD||', 'context-less targets must not share a project-wide degenerate tuple');
    assert.equal(fallbackA, rawA, 'raw key and context-less target for the same issue share one per-key signature so key-based invalidation reaches both');

    // A degenerate signature can never equal any real tuple entry.
    assert.notEqual(fallbackA, transitionOptionCacheKey([{ key: 'PROD-1', issueType: 'Story', currentStatus: 'To Do' }]));
});

test('ENG status transition submit invalidation covers degenerate and per-key cache signatures', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    const guardIndex = hookSource.indexOf('if (summary.succeeded > 0) {');
    assert.notEqual(guardIndex, -1, 'Expected an explicit succeeded > 0 guard');
    const guardBody = hookSource.slice(guardIndex, guardIndex + 3000);

    // Fallback-submit targets ({key, issueType:'', currentStatus:''}) carry no workflow
    // context, so the tuple entries that covered them cannot be identified: the success
    // path must clear the whole cache rather than under-invalidate.
    assert.match(
        guardBody,
        /succeededTargets\.some\(\(target\) => !target\.issueType && !target\.currentStatus\)/,
        'Expected the succeeded-target degenerate-context check'
    );
    assert.match(
        guardBody,
        /clearTransitionOptionsCache\(\);/,
        'Expected a whole-cache clear on the degenerate fallback-submit path'
    );
    // Full-target invalidation must also drop any per-key entry cached for the same issue
    // by a raw-key/context-less options load.
    assert.match(
        guardBody,
        /transitionOptionKeySignature\(target\.key\)/,
        'Expected per-key signature invalidation alongside tuple invalidation'
    );
});

test('ENG priority transition hook keeps a module-level per-tuple priority options cache shared across hook instances', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngPriorityTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    const cacheDeclIndex = hookSource.indexOf('const priorityOptionsCache = new Map()');
    const hookFnIndex = hookSource.indexOf('export function useEngPriorityTransitions');
    assert.notEqual(cacheDeclIndex, -1, 'Expected a module-level priorityOptionsCache Map keyed by project|issueType tuple');
    assert.notEqual(hookFnIndex, -1, 'Expected the useEngPriorityTransitions hook export');
    assert.ok(
        cacheDeclIndex !== -1 && hookFnIndex !== -1 && cacheDeclIndex < hookFnIndex,
        'Expected priorityOptionsCache to be declared at module scope, before the hook function, so every hook instance shares one per-tuple fetch instead of re-fetching per mount'
    );
    assert.match(hookSource, /const priorityOptionsPromises = new Map\(\)/, 'Expected a per-tuple in-flight promise map so concurrent opens of one tuple dedupe to a single fetch');
    assert.match(hookSource, /priorityOptionCacheKey/, 'Expected the hook to key the cache by the project|issueType tuple');
    assert.match(hookSource, /priorities\.length > 0/, 'Expected only successful NON-EMPTY schemes to be cached so an uneditable issue never poisons the tuple');
    assert.match(hookSource, /export function clearPriorityOptionsCache\(\)/, 'Expected a test/auth-recovery cache-clear escape hatch');
});

test('ENG targeted mutations guard same-key duplicates and stale scope completions', () => {
    const statusPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const priorityPath = path.resolve(__dirname, '../frontend/src/eng/useEngPriorityTransitions.js');
    const statusSource = fs.readFileSync(statusPath, 'utf8');
    const prioritySource = fs.readFileSync(priorityPath, 'utf8');

    assert.match(statusSource, /mutationScopeKey/);
    assert.match(statusSource, /mutationScopeRef/);
    assert.match(statusSource, /pendingMutationKeysRef/);
    // Renamed with the flag it is gated by: the per-key in-flight guard now serves every
    // single-issue surface (Catch Up and Board), not Catch Up alone. Same guard, same behaviour.
    assert.match(statusSource, /pendingMutationKeysRef\.current\.has\(singleIssueKey\)/);
    assert.match(prioritySource, /mutationScopeKey/);
    assert.match(prioritySource, /mutationScopeRef/);
    assert.match(prioritySource, /pendingMutationKeysRef/);
    assert.match(prioritySource, /pendingMutationKeysRef\.current\.has\(key\)/);
});

test('priority options per-tuple cache: two tuples fetch twice, same tuple once, empty is not cached, clear wipes', async () => {
    const { loadPriorityOptionsForTuple, clearPriorityOptionsCache } = await import('../frontend/src/eng/useEngPriorityTransitions.js');
    clearPriorityOptionsCache();

    let fetchCount = 0;
    const nonEmpty = () => { fetchCount += 1; return Promise.resolve({ priorities: [{ id: '1', name: 'Highest', rank: 10 }], source: 'jira', cached: false }); };

    // Two distinct tuples -> two fetches.
    await loadPriorityOptionsForTuple('PROD|Story', 'PROD-1', 'http://x', nonEmpty);
    await loadPriorityOptionsForTuple('PROD|Epic', 'PROD-EPIC', 'http://x', nonEmpty);
    assert.equal(fetchCount, 2);

    // Same tuple again (a different issue) -> cache hit, no new fetch.
    await loadPriorityOptionsForTuple('PROD|Story', 'PROD-2', 'http://x', nonEmpty);
    assert.equal(fetchCount, 2);

    // An empty (uneditable) result must NOT be cached: a later editable issue of the SAME
    // tuple still fetches.
    clearPriorityOptionsCache();
    let attempts = 0;
    const emptyThenFull = () => {
        attempts += 1;
        return Promise.resolve(attempts === 1
            ? { priorities: [], source: 'jira', cached: false }
            : { priorities: [{ id: '1', name: 'Highest', rank: 10 }], source: 'jira', cached: false });
    };
    const first = await loadPriorityOptionsForTuple('PROD|Story', 'PROD-1', 'http://x', emptyThenFull);
    assert.deepEqual(first.priorities, []);
    const second = await loadPriorityOptionsForTuple('PROD|Story', 'PROD-9', 'http://x', emptyThenFull);
    assert.equal(second.priorities.length, 1, 'empty result must not poison the tuple');
    assert.equal(attempts, 2, 'the empty result was not cached, so the second call refetched');

    // clear wipes the map: a previously cached tuple refetches.
    clearPriorityOptionsCache();
    fetchCount = 0;
    await loadPriorityOptionsForTuple('PROD|Story', 'PROD-1', 'http://x', nonEmpty);
    assert.equal(fetchCount, 1);
});

test('priority options per-tuple cache dedups concurrent loads and never poisons a tuple after a failed fetch', async () => {
    const { loadPriorityOptionsForTuple, clearPriorityOptionsCache } = await import('../frontend/src/eng/useEngPriorityTransitions.js');

    // Concurrent opens of the same tuple share ONE fetch.
    clearPriorityOptionsCache();
    let fetchCount = 0;
    const slow = () => { fetchCount += 1; return new Promise((resolve) => setTimeout(() => resolve({ priorities: [{ id: '1', name: 'Highest', rank: 10 }], source: 'jira', cached: false }), 10)); };
    const [a, b] = await Promise.all([
        loadPriorityOptionsForTuple('PROD|Story', 'PROD-1', 'http://x', slow),
        loadPriorityOptionsForTuple('PROD|Story', 'PROD-2', 'http://x', slow),
    ]);
    assert.equal(fetchCount, 1, 'concurrent opens of the same tuple share one fetch');
    assert.deepEqual(a, b);

    // A failed fetch is not cached: the next open of the same tuple retries.
    clearPriorityOptionsCache();
    let attempts = 0;
    const failThenSucceed = () => {
        attempts += 1;
        return attempts === 1
            ? Promise.reject(new Error('boom'))
            : Promise.resolve({ priorities: [{ id: '1', name: 'Highest', rank: 10 }], source: 'jira', cached: false });
    };
    await assert.rejects(() => loadPriorityOptionsForTuple('PROD|Story', 'PROD-1', 'http://x', failThenSucceed));
    const recovered = await loadPriorityOptionsForTuple('PROD|Story', 'PROD-1', 'http://x', failThenSucceed);
    assert.equal(recovered.priorities.length, 1, 'a failed fetch must not poison the tuple');
    assert.equal(attempts, 2);
});

test('dashboard wires the priority hook and menu without owning their catalog/menu/API logic', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngPriorityTransitions.js');
    const menuPath = path.resolve(__dirname, '../frontend/src/issues/PriorityTransitionMenu.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(fs.existsSync(hookPath), 'Expected frontend/src/eng/useEngPriorityTransitions.js to exist');
    assert.ok(fs.existsSync(menuPath), 'Expected frontend/src/issues/PriorityTransitionMenu.jsx to exist');

    // dashboard.jsx imports the hook and the presentational menu, and calls the hook once.
    assert.match(source, /import \{ useEngPriorityTransitions \} from '\.\/eng\/useEngPriorityTransitions\.js';/);
    assert.match(source, /import PriorityTransitionMenu from '\.\/issues\/PriorityTransitionMenu\.jsx';/);
    // Called exactly once. The assertion is on the CALL, not on the destructuring form that used
    // to follow it: the Board's epic panel takes the hook result as one object, so dashboard.jsx
    // now assigns it before destructuring.
    assert.equal((source.match(/useEngPriorityTransitions\(\{/g) || []).length, 1);

    // Menu/catalog/submit logic lives in the hook + PriorityTransitionMenu; dashboard.jsx
    // must only wire props, never inline the priority API, a second module-level catalog
    // cache, the shared option-menu renderer, or the interactive trigger's data attribute.
    assert.doesNotMatch(source, /jiraIssueApi/, 'dashboard.jsx must not import the priority/transition API directly');
    assert.doesNotMatch(source, /fetchIssuePriorityOptions\(/, 'dashboard.jsx must not call the priority options fetch directly');
    assert.doesNotMatch(source, /updateIssuePriorities\(/, 'dashboard.jsx must not call the priority mutation directly');
    assert.doesNotMatch(source, /IssueFieldOptionMenu/, 'dashboard.jsx must not import the shared option-menu renderer directly');
    assert.doesNotMatch(source, /priorityOptionsCache/, 'dashboard.jsx must not own a second priority catalog cache');
    assert.doesNotMatch(source, /data-priority-transition-trigger/, 'dashboard.jsx must not hand-roll the priority trigger attribute');
});

test('every IssueFieldOptionMenu consumer emits the trigger attribute its focus restore resolves', () => {
    const issuesDir = path.resolve(__dirname, '../frontend/src/issues');
    const menuSource = fs.readFileSync(path.join(issuesDir, 'IssueFieldOptionMenu.jsx'), 'utf8');

    // On Escape the shared menu hands focus back to its trigger, resolved inside dismissRef by
    // this attribute. A consumer that names its trigger differently would turn the restore into
    // a silent no-op and strand keyboard users on <body> — which breaks any surrounding focus
    // trap (the board's epic panel binds Escape/Tab to the panel element).
    assert.match(menuSource, /\[data-\$\{blockClass\}-trigger\]/, 'IssueFieldOptionMenu must resolve its trigger from data-<blockClass>-trigger');

    [
        ['StatusTransitionMenu.jsx', 'status-transition'],
        ['PriorityTransitionMenu.jsx', 'priority-transition'],
        ['ProjectTrackTransitionMenu.jsx', 'project-track-transition'],
    ].forEach(([file, blockClass]) => {
        const source = fs.readFileSync(path.join(issuesDir, file), 'utf8');
        assert.match(source, new RegExp(`blockClass="${blockClass}"`), `${file} must pass blockClass="${blockClass}"`);
        assert.match(source, new RegExp(`data-${blockClass}-trigger`), `${file}'s trigger must carry data-${blockClass}-trigger`);
        assert.match(source, /dismissRef=\{fieldRef\}/, `${file} must pass the trigger+menu wrapper as dismissRef`);
    });
});
