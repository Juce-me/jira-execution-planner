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
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /const rows = teamCount === 6 \? 2 : Math\.ceil\(teamCount \/ maxPerRow\);/);
});

test('selected sp by team cards still render for a single team entry', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /\{selectedTeamEntries\.length > 0 && \(\(\) => \{/);
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

test('ENG status transition hook imports the transition API and auth recovery helpers', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngStatusTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    assert.match(hookSource, /import \{ fetchIssueTransitionOptions, transitionIssues \} from '\.\.\/api\/jiraIssueApi\.js';/);
    assert.match(hookSource, /import \{ authRecoveryLoginUrl, redirectToAuthRecovery \} from '\.\/useEngSprintData\.js';/);
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
    const mutationIndex = hookSource.indexOf('await transitionIssues(');
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

test('ENG priority transition hook keeps a module-level priority options cache shared across hook instances', () => {
    const hookPath = path.resolve(__dirname, '../frontend/src/eng/useEngPriorityTransitions.js');
    const hookSource = fs.readFileSync(hookPath, 'utf8');

    const cacheDeclIndex = hookSource.indexOf('let priorityOptionsCache');
    const hookFnIndex = hookSource.indexOf('export function useEngPriorityTransitions');
    assert.notEqual(cacheDeclIndex, -1, 'Expected a module-level priorityOptionsCache declaration');
    assert.notEqual(hookFnIndex, -1, 'Expected the useEngPriorityTransitions hook export');
    assert.ok(
        cacheDeclIndex !== -1 && hookFnIndex !== -1 && cacheDeclIndex < hookFnIndex,
        'Expected priorityOptionsCache to be declared at module scope, before the hook function, so every hook instance shares one fetch instead of re-fetching per mount'
    );
    assert.match(hookSource, /let priorityOptionsPromise/, 'Expected an in-flight promise so concurrent opens dedupe to one fetch');
    assert.match(hookSource, /export function clearPriorityOptionsCache\(\)/, 'Expected a test/auth-recovery cache-clear escape hatch');
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
    assert.match(source, /\} = useEngPriorityTransitions\(\{/);

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
