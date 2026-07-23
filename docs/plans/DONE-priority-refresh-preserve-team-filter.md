# Planning Priority Refresh Team-Filter Preservation Implementation Plan

> **Status:** Done. Executed and merged in [PR #107](https://github.com/Juce-me/jira-execution-planner/pull/107). Kept for audit context only.

> **Corrected during execution:** team display names come from the team catalog lookup (`teamNameLookup`) merged with in-session retained task-derived names, not `teamLabels` (which are Jira epic labels); found by final review. The `teamOptions` memo retains each team's last known task-derived name for the session, so names stay stable across refreshes without any new initial-load request. The only remaining degradation is a cold load where a configured team has had no tasks in the session AND the team catalog was never warmed (its option shows the raw team id; the filter selection is still preserved). Catalog warm-up on ENG load was deliberately NOT added, honoring the no-new-initial-load-request acceptance criterion; it is left as a user follow-up decision. The in-session retention glue grew `frontend/src/dashboard.jsx` to `15965` lines, superseding Task 1 Step 7's `15953` ceiling statement (which was met at the extraction commit); the structural budget is ratcheted to the exact value with an itemized comment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a configured single-team ENG filter selected when a successful Planning priority change refreshes task data that temporarily contains no issues for that team.

**Architecture:** Treat the active department/group configuration (`teamIds` plus `teamLabels`) as the authoritative team-option catalog. Extract option construction into a pure helper with behavioral Node coverage, then keep the dashboard hydration/reconciliation flow unchanged except that its `validTeamIds` come from the configured catalog rather than the latest fetched issues. Add one focused Playwright regression that performs the real Planning priority mutation/refetch sequence and proves the visible and persisted team selection survives.

**Tech Stack:** React 19, JavaScript ES modules, `node:test`, Playwright, esbuild-generated `frontend/dist`, Python `unittest` structural guards.

## Global Constraints

- Preserve all existing scoped selection storage keys and payloads; do not migrate or clear browser storage.
- When `activeGroupTeamIds` is non-empty, build options only from those configured IDs, resolving each display name from the team catalog lookup (`teamNameLookup`) with a task-derived name and then the raw id as fallbacks; issue/task results must not add or remove options. `teamLabels` are Jira epic labels, never display names, and must not be used as the option name source.
- Preserve the existing task-derived fallback only when the active group has no configured team IDs.
- A team that is removed from the configured group catalog remains invalid and must still reconcile to `All Teams`.
- Do not alter priority mutation APIs, OAuth/CSRF behavior, Jira request payloads, refresh fan-out, or Catch Up targeted-update behavior.
- Do not add a new analytics event. Existing `issue_priority_action` covers the priority mutation; automatic filter retention is not a user filter action and must not emit `filter_changed`.
- Do not hand-edit `frontend/dist`; regenerate it with `npm run build`.
- Preserve unrelated working-tree changes. Stage and commit only files named by the active task.
- Do not use a secondary worktree for this repository.

## Revalidated Source Of Truth

| State | Team-option source | Required result |
| --- | --- | --- |
| Active group has configured `teamIds` | `activeGroup.teamIds` for availability; display names from the team catalog lookup (`teamNameLookup`), then task-derived names, then the raw id (never `teamLabels`, which are Jira epic labels) | Every configured team remains available even with zero returned issues; issue-only teams are excluded. |
| Active group has no configured `teamIds` | Unique team IDs/names from `capacityTasks` through `getTeamInfo` | Preserve the current legacy fallback. |
| Selected team remains configured but disappears from refreshed issues | Configured group catalog | Keep the visible selection and scoped storage value. |
| Selected team is removed from configured group catalog | Configured group catalog | Existing reconciliation falls back to `All Teams`. |

This interpretation follows `docs/postmortem/MRT001-missing-teams-stats.md`: configured team IDs are authoritative and teams must never disappear merely because returned issues omit them. It narrows the older phrase “team has no sprint data” in `tests/test_team_selection_utils.js`; availability now means presence in the authoritative catalog supplied to reconciliation, not presence in the current issue page.

## User-Visible State Checklist

| Transition | Expected state |
| --- | --- |
| Load Planning with scoped `selectedTeams: ['team-alpha']` | Team toggle reads `Alpha Team`; only Alpha issues are shown. |
| Submit a successful priority change | Existing priority API call and analytics remain unchanged. |
| Planning success callback force-refreshes Product/Tech and ready-to-close collections | Refresh calls occur exactly as before. |
| Refreshed payload contains only Beta issues | Options still contain configured Alpha and Beta; Alpha remains valid. |
| React selection hydration/reconciliation reruns | `selectedTeams` remains `['team-alpha']`; it does not become `['all']`. |
| Scoped browser state is read after refresh | `team-selection::<sprint>::<group>` still stores `['team-alpha']`. |
| Group config later removes Alpha | Reconciliation changes selection to `['all']`, preserving the real-invalid-team fallback. |

## API And Ownership Impact

No endpoint contract changes. Existing `GET /api/groups-config`, `GET /api/tasks-with-team-name`, `GET /api/issues/priorities/options`, and `POST /api/issues/priorities` request/auth/response contracts remain untouched. No database, workspace ownership, Jira credential, Home/Townsquare, CSRF, or service-account behavior changes.

## File Map

Modify:

- `frontend/src/teamSelectionUtils.mjs` — add the pure configured-team-first option builder.
- `frontend/src/dashboard.jsx` — import and call the helper from the existing `teamOptions` memo.
- `tests/test_team_selection_utils.js` — behavioral option-source coverage and accurate authoritative-catalog test wording.
- `tests/ui/eng_priority_transitions.spec.js` — Planning priority refresh regression fixture and assertions.
- `tests/test_codebase_structure_budgets.py` — ratchet the dashboard line budget to the exact post-extraction count; do not preserve the partial fix's `+3` allowance.
- `docs/README_ANALYTICS.md` — add the no-event allowlist reason for automatic team-filter retention.
- `docs/plans/README.md` — index this active plan and its expected output.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` — regenerate from source.

Delete:

- `tests/test_team_options_source_guards.js` — replace the untracked source-text regex with behavioral unit and Playwright coverage.

No backend files, route policies, CSS, storage schemas, or analytics schemas change.

---

## Task 1: Extract And Behavior-Test The Authoritative Team Catalog

**Files:**

- Modify: `frontend/src/teamSelectionUtils.mjs`
- Modify: `frontend/src/dashboard.jsx` near the team-selection imports and `teamOptions` memo
- Modify: `tests/test_team_selection_utils.js`
- Delete: `tests/test_team_options_source_guards.js`
- Modify: `tests/test_codebase_structure_budgets.py`

**Interfaces:**

- Consumes: `capacityTasks: Array<object>`, `activeGroupTeamIds: Array<string>`, `teamNameLookup: Record<string,string>` (team id → display name, from the team catalog), and `getTeamInfo(task): {id?: string, name?: string}`. (Corrected during execution: the shipped helper takes `teamNameLookup`, not `activeGroupTeamLabels`; `teamLabels` are Jira epic labels, not display names.)
- Produces: `buildTeamOptionsForScope(args): Array<{id: string, name: string}>`, always beginning with `{ id: 'all', name: 'All Teams' }`.

- [x] **Step 1: Record and preserve the partial working-tree baseline**

Run:

```bash
git status --short --branch
git diff -- frontend/src/dashboard.jsx tests/test_codebase_structure_budgets.py
```

Expected: the branch is not `main`; the inline configured-team fix, generated dist changes, budget adjustment, and untracked source guard are visible. Do not reset, restore, stash, or overwrite them.

- [x] **Step 2: Write behavioral tests before extracting the helper**

Extend `tests/test_team_selection_utils.js` with tests equivalent to:

```js
test('configured group teams stay available when fetched task data omits the selected team', async () => {
    const { buildTeamOptionsForScope } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task?.teamId, name: task?.teamName });

    assert.deepEqual(
        buildTeamOptionsForScope({
            capacityTasks: [{ teamId: 'team-beta', teamName: 'Beta Team' }],
            activeGroupTeamIds: ['team-alpha', 'team-beta'],
            activeGroupTeamLabels: {
                'team-alpha': 'Alpha Team',
                'team-beta': 'Beta Team'
            },
            getTeamInfo
        }),
        [
            { id: 'all', name: 'All Teams' },
            { id: 'team-alpha', name: 'Alpha Team' },
            { id: 'team-beta', name: 'Beta Team' }
        ]
    );
});

test('team options fall back to fetched task teams only without configured group teams', async () => {
    const { buildTeamOptionsForScope } = await import('../frontend/src/teamSelectionUtils.mjs');
    const getTeamInfo = task => ({ id: task?.teamId, name: task?.teamName });

    assert.deepEqual(
        buildTeamOptionsForScope({
            capacityTasks: [
                { teamId: 'team-alpha', teamName: 'Alpha Team' },
                { teamId: 'team-alpha', teamName: 'Alpha Team' },
                { teamId: 'team-beta', teamName: 'Beta Team' }
            ],
            activeGroupTeamIds: [],
            activeGroupTeamLabels: {},
            getTeamInfo
        }),
        [
            { id: 'all', name: 'All Teams' },
            { id: 'team-alpha', name: 'Alpha Team' },
            { id: 'team-beta', name: 'Beta Team' }
        ]
    );
});
```

Rename the existing “no data for the selected team” test to say “selected team is absent from the authoritative available-team catalog.” Keep its existing assertion that a genuinely invalid team resolves to `['all']`.

- [x] **Step 3: Run the helper tests and observe the extraction boundary fail**

Run:

```bash
node --test tests/test_team_selection_utils.js
```

Expected before helper extraction: FAIL because `buildTeamOptionsForScope` is not exported. The existing inline partial fix may already satisfy the user-visible behavior; this missing-helper failure is the honest red boundary for replacing its source-text guard with behavioral coverage.

- [x] **Step 4: Implement the smallest pure helper**

Add to `frontend/src/teamSelectionUtils.mjs`:

> **Corrected during execution:** the shipped helper takes `teamNameLookup` (team id → display name from the team catalog), not `activeGroupTeamLabels`. Configured display names resolve `teamNameLookup[id]` first, then a task-derived name (from `capacityTasks` via `getTeamInfo`), then the raw id. `teamLabels` are Jira epic labels used for Future Planning epic matching and JQL, never display names. The code block below shows the original (superseded) signature; the illustrative test and memo blocks in Steps 2 and 5 change `activeGroupTeamLabels` to `teamNameLookup` accordingly.

```js
export function buildTeamOptionsForScope({
    capacityTasks = [],
    activeGroupTeamIds = [],
    activeGroupTeamLabels = {},
    getTeamInfo = () => ({})
} = {}) {
    const allTeams = { id: 'all', name: 'All Teams' };
    const configuredTeamIds = [];
    const configuredSeen = new Set();

    (activeGroupTeamIds || []).forEach((value) => {
        const id = String(value || '').trim();
        if (!id || configuredSeen.has(id)) return;
        configuredSeen.add(id);
        configuredTeamIds.push(id);
    });

    if (configuredTeamIds.length) {
        return [
            allTeams,
            ...configuredTeamIds.map(id => ({
                id,
                name: String(activeGroupTeamLabels?.[id] || id).trim() || id
            }))
        ];
    }

    const taskTeams = [];
    const taskSeen = new Set();
    (capacityTasks || []).forEach((task) => {
        const team = getTeamInfo(task) || {};
        const id = String(team.id || 'unknown').trim() || 'unknown';
        if (taskSeen.has(id)) return;
        taskSeen.add(id);
        taskTeams.push({ id, name: String(team.name || id).trim() || id });
    });
    return [allTeams, ...taskTeams];
}
```

Do not move persistence or reconciliation into this helper.

- [x] **Step 5: Wire the dashboard memo to the helper**

Extend the existing import from `./teamSelectionUtils.mjs` and replace only the inline option construction:

```js
import {
    buildTeamOptionsForScope,
    sanitizeSelectedTeamsForScope,
    selectedTeamSelectionsEqual
} from './teamSelectionUtils.mjs';
```

```js
const teamOptions = React.useMemo(() => buildTeamOptionsForScope({
    capacityTasks,
    activeGroupTeamIds,
    activeGroupTeamLabels,
    getTeamInfo
}), [capacityTasks, activeGroupTeamIds, activeGroupTeamLabels]);
```

Keep the downstream `validTeamIds`, `reconcileTeamSelectionState`, and `sanitizeSelectedTeamsForScope` flow unchanged. Delete `tests/test_team_options_source_guards.js`; a regex over source text is no longer the regression contract.

- [x] **Step 6: Run focused behavior and selection tests**

Run:

```bash
node --test tests/test_team_selection_utils.js tests/test_team_selection_persistence.js tests/test_planning_selection_stats.js tests/test_planning_selection_state.js
```

Expected: all tests pass. Specifically, configured-team option construction passes while true catalog invalidation still falls back to `All Teams`.

- [x] **Step 7: Ratchet the dashboard structural budget**

Run:

```bash
wc -l frontend/src/dashboard.jsx
```

Set `LEGACY_ENTRYPOINT_LINE_BUDGETS['frontend/src/dashboard.jsx']` to that exact integer. Expected: the extraction removes the partial fix's `+3` growth and the final value is no greater than the pre-branch ceiling `15953`. Replace the current budget comment with a concise note that the helper extraction reduced or preserved the entrypoint size. (Superseded during execution: the extraction met this at `15951`, but the later name-retention correction legitimately grew the file to `15965`; see the top correction note.)

Run:

```bash
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
```

Expected: PASS.

- [x] **Step 8: Commit the helper slice**

```bash
git add frontend/src/teamSelectionUtils.mjs frontend/src/dashboard.jsx tests/test_team_selection_utils.js tests/test_codebase_structure_budgets.py
git commit -m "fix: preserve configured team filters on refresh"
```

Expected: only the helper, dashboard wiring, behavioral tests, and budget guard are committed. `tests/test_team_options_source_guards.js` was untracked before deletion, so it has no deletion to stage. Generated dist remains for the final build task.

---

## Task 2: Prove The Planning Priority Refresh Flow In Playwright

**Files:**

- Modify: `tests/ui/eng_priority_transitions.spec.js`

**Interfaces:**

- Consumes: the existing `installEngPriorityFixture`, `setPrefs`, `priorityTrigger`, and `priorityMenu` helpers.
- Produces: one regression test that observes the existing priority POST, ensuing task refetch, visible team label, dropdown catalog, and scoped local-storage state.

> **Corrected during execution:** the fixture's synthetic group carries `teamLabels` as Jira epic-label slugs (not display names), so a regression that named teams from `teamLabels` would fail. Team display names reach the dropdown through task payloads: the `teamOptions` memo retains each team's last known task-derived name for the session, so the configured Alpha name survives a refresh whose payload omits Alpha (Beta's name comes from the refreshed tasks). The warmed team catalog (`GET /api/team-catalog`, populated only when the team-groups Settings modal runs `loadTeamCatalog()`; there is no ENG-load path) still wins over retained names when present. Residual limitation: on a cold load where a configured team has had no tasks in the session and the catalog was never warmed, its option shows the raw team id; the filter selection is still preserved. Catalog warm-up on ENG load was deliberately not added (no-new-initial-load-request acceptance criterion) and is left as a user follow-up decision.

- [x] **Step 1: Extend the existing synthetic fixture without changing production APIs**

Make the fixture represent two configured teams and allow successful priority writes to change subsequent task responses:

```js
const groupTeamIds = ['team-alpha', 'team-beta'];
const groupTeamLabels = {
    'team-alpha': 'Alpha Team',
    'team-beta': 'Beta Team'
};
```

Add `teamLabels: groupTeamLabels` to the synthetic group. Extend `makeStory` with optional `teamId` and `teamName` arguments. Add a fixture option named `omitSelectedTeamAfterPriority` and a `priorityState.successfulWrite` boolean. After a successful priority response, set the boolean; subsequent Product task responses return only a synthetic Beta story when the option is enabled.

Use these exact fixture-shape changes:

```js
function makeStory(
    key,
    sprintId,
    sprintName,
    epicKey = 'PROD-EPIC',
    teamId = 'team-alpha',
    teamName = 'Alpha Team'
) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic story`,
            status: { name: 'To Do' },
            priority: { name: 'Medium' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: 1,
            epicKey,
            parentSummary: 'Synthetic product epic',
            projectKey: 'PROD',
            teamId,
            teamName,
            sprint: [{ id: sprintId, name: sprintName, state: 'active' }],
            subtaskSummary: null
        }
    };
}

async function installEngPriorityFixture(page, {
    stories = null,
    priorityDelayMs = 0,
    priorityWrite = priorityWriteResponse,
    omitSelectedTeamAfterPriority = false
} = {}) {
    const priorityState = { inFlight: 0, maxInFlight: 0, successfulWrite: false };
    // Keep the existing calls collection, route setup, and unrelated fixture responses.
}
```

In the existing task and priority route branches, use:

```js
if (url.pathname === '/api/tasks-with-team-name') {
    const project = url.searchParams.get('project');
    const purpose = url.searchParams.get('purpose');
    const refreshedStories = omitSelectedTeamAfterPriority && priorityState.successfulWrite
        ? [makeStory('PROD-BETA-1', activeSprintId, activeSprintName, 'PROD-EPIC', 'team-beta', 'Beta Team')]
        : null;
    const defaultIssues = project === 'product' && !purpose
        ? (refreshedStories || [
            makeStory('PROD-1', activeSprintId, activeSprintName),
            makeStory('PROD-2', activeSprintId, activeSprintName)
        ])
        : [];
    const issues = (stories && project === 'product' && !purpose) ? stories : defaultIssues;
    const epic = makeEpic(activeSprintId, activeSprintName);
    return json(route, {
        issues,
        epics: { [epic.key]: epic },
        epicsInScope: project === 'product' ? [epic] : [],
        names: {}
    });
}

if (url.pathname === '/api/issues/priorities') {
    priorityState.inFlight += 1;
    priorityState.maxInFlight = Math.max(priorityState.maxInFlight, priorityState.inFlight);
    try {
        if (priorityDelayMs) await new Promise(resolve => setTimeout(resolve, priorityDelayMs));
        const responseBody = priorityWrite(body);
        if (responseBody?.succeeded > 0) priorityState.successfulWrite = true;
        return json(route, responseBody);
    } finally {
        priorityState.inFlight -= 1;
    }
}
```

Do not change the URL, method, request body, or response shape of any mocked endpoint.

- [x] **Step 2: Add the user-visible regression test**

Add a test equivalent to:

```js
test('Planning priority refresh preserves a configured single-team filter when refreshed tasks omit that team', async ({ page }) => {
    await setPrefs(page, catchUpPrefs({ showPlanning: true, selectedTeams: ['team-alpha'] }));
    await page.addInitScript(({ scopeKey }) => {
        window.localStorage.setItem('jira_dashboard_team_selection_state_v1', JSON.stringify({
            [scopeKey]: {
                selectedTeams: ['team-alpha'],
                selectedTeamId: 'team-alpha'
            }
        }));
    }, { scopeKey: `team-selection::${activeSprintId}::group-alpha` });

    const { calls } = await installEngPriorityFixture(page, {
        omitSelectedTeamAfterPriority: true
    });
    await page.goto(appBaseUrl);

    const teamToggle = page.locator('.view-selector .team-dropdown-toggle').first();
    const teamLabel = teamToggle.locator('.team-dropdown-selection-label');
    await expect(teamLabel).toHaveText('Alpha Team');
    await expect(page.locator('.task-item[data-task-key="PROD-1"]')).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'before-refresh.png'), fullPage: false });

    const initialTaskRequestCount = calls.filter(call => call.pathname === '/api/tasks-with-team-name').length;
    await priorityTrigger(page, 'story', 'PROD-1').click();
    await priorityMenu(page, 'PROD-1').getByRole('menuitem', { name: 'Major' }).click();

    await expect.poll(() => calls.filter(call => call.pathname === '/api/tasks-with-team-name').length)
        .toBeGreaterThan(initialTaskRequestCount);
    await expect(teamLabel).toHaveText('Alpha Team');
    await teamToggle.click();
    await expect(page.locator('.team-dropdown-panel')).toContainText('Alpha Team');
    await expect(page.locator('.team-dropdown-panel')).toContainText('Beta Team');
    await page.screenshot({ path: path.join(screenshotDir, 'after-refresh.png'), fullPage: false });

    await expect.poll(() => page.evaluate((scopeKey) => {
        const state = JSON.parse(window.localStorage.getItem('jira_dashboard_team_selection_state_v1') || '{}');
        return state[scopeKey]?.selectedTeams || [];
    }, `team-selection::${activeSprintId}::group-alpha`)).toEqual(['team-alpha']);
});
```

Define the directory beside `repoRoot` and create it in the existing `beforeAll`:

```js
const screenshotDir = path.join(repoRoot, 'tmp', 'priority-team-filter');

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    // Preserve the existing in-memory dashboard bundle build.
});
```

`tmp/` is already gitignored. The screenshots are local verification artifacts only and must not be staged.

- [x] **Step 3: Run the focused Playwright file**

Run:

```bash
npx playwright test tests/ui/eng_priority_transitions.spec.js
```

Expected: all cases pass, including the new Planning refresh regression. Inspect both local screenshots and confirm the team label reads `Alpha Team` before and after refresh. Because the inline partial fix predates this plan, the UI regression may be green when first added; the Node helper test in Task 1 provides the red extraction boundary, while this test provides end-to-end regression sensitivity.

- [x] **Step 4: Commit the UI regression**

```bash
git add tests/ui/eng_priority_transitions.spec.js
git commit -m "test: cover team filter after priority refresh"
```

Expected: no screenshot, trace, video, or `tmp/` artifact is staged.

---

## Task 3: Analytics Rationale, Build, And Full Verification

**Files:**

- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/README.md`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Update this plan's status only after implementation verification; keep the `EXEC-*` filename until acceptance or merge.

**Interfaces:** None. This task documents the existing analytics contract and regenerates shipped assets.

- [x] **Step 1: Add the no-event allowlist row**

Add this row under `### No-Event Allowlist` in `docs/README_ANALYTICS.md`:

```markdown
| Planning priority refresh team-filter preservation | `frontend/src/teamSelectionUtils.mjs`, `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngPriorityTransitions.js` | Corrective state retention after the existing tracked priority mutation; no new user action is introduced. Existing `issue_priority_action` covers the mutation, while `filter_changed` remains reserved for explicit user filter changes. Automatic retention sends no team IDs, team names, issue keys, priorities, or Jira URLs. | 2026-07-12 |
```

Do not modify `frontend/src/analytics/events.js`, GTM configuration, or event payload code.

- [x] **Step 2: Confirm the plan index remains accurate**

Ensure the `docs/plans/README.md` entry for this plan says the expected output is: configured group teams remain authoritative across Planning priority refreshes, true config removal still falls back to `All Teams`, behavioral Node and Playwright coverage passes, and generated dist is rebuilt.

- [x] **Step 3: Regenerate frontend output**

Run:

```bash
npm run build
```

Expected: successful auth, JavaScript, and CSS builds. `frontend/dist/dashboard.js` and `.map` reflect the source change; no hand edits exist. Unrelated generated files should remain unchanged unless the build deterministically updates them.

- [x] **Step 4: Run focused verification**

```bash
node --test tests/test_team_selection_utils.js tests/test_team_selection_persistence.js tests/test_planning_selection_stats.js tests/test_planning_selection_state.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
npx playwright test tests/ui/eng_priority_transitions.spec.js
```

Expected: every command passes; the Playwright output includes the new Planning priority refresh case.

- [x] **Step 5: Run repository-level verification**

```bash
npm run test:frontend:unit
.venv/bin/python -m unittest discover -s tests
git diff --check
git status --short
git diff --stat
git log --oneline -5
```

Expected: all frontend unit and Python tests pass; no whitespace errors; only plan-scoped source, tests, docs, and generated dist changes remain. Review output for secrets, real Jira data, absolute local paths, and unintended artifacts.

- [x] **Step 6: Commit docs and generated assets**

```bash
git add docs/README_ANALYTICS.md docs/plans/README.md docs/plans/EXEC-priority-refresh-preserve-team-filter.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "docs: record priority refresh filter contract"
```

Expected: the branch contains atomic helper/fix, UI regression, and docs/build commits. Do not push until the user explicitly confirms after reviewing full verification and `git log --oneline -5`.

## Acceptance Criteria

- `teamOptions` for a configured active group no longer depends on returned task membership.
- A successful Planning priority change can refresh to a payload with zero selected-team issues without changing the selected team to `All Teams`.
- The visible team label and scoped local-storage value both remain the configured team.
- Removing the team from group configuration still invalidates the selection and falls back to `All Teams`.
- The source-text regex guard is removed and replaced by behavioral Node plus Playwright coverage.
- No priority API, auth, persistence schema, analytics event, initial-load request, or non-Planning behavior changes.
- Frontend dist is regenerated, structural budget is ratcheted, focused tests pass, and full frontend/Python suites pass before push.

## Plan Self-Review

- Scope is one frontend state-source correction with one pure helper boundary and one existing UI fixture extension; no independent subsystem requires another plan.
- No endpoint, credential, workspace, DB, Home/Townsquare, CSRF, or concurrency migration is implied.
- The partial uncommitted implementation is explicitly preserved and replaced incrementally.
- The red/green limitation caused by the pre-existing inline fix is explicit; no false claim of a newly observed failing UI test is allowed.
- Every changed production behavior has a named behavioral test and exact verification command.
- No placeholders, real Jira identifiers, secrets, personal data, or machine-specific paths are included.
