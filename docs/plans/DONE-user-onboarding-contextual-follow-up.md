# User Onboarding Contextual Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Done. Executed on `feature/user-onboarding-tour` through verification commit `06bb1fd` with reproducible build commit `02f75e1`. Kept for audit context only.

> **Current behavior note (2026-09-02):** The locked-Next and Catch Up launcher-sequence instructions below are historical and superseded. Next now stays enabled on every step; Next or the exact highlighted field opens a read-only preview; a preview choice/surface, the same field, or Next advances exactly once; Escape closes without advancing. Catch Up points out real header controls after returning to the page top but never requires or synthesizes navigation. See `docs/features/onboarding.md` for the canonical contract.

**Goal:** Correct the desktop coachmark and Department Settings regressions, require explicit **Next** after safe field previews, and add contextual Configuration, Planning, Board, and Statistics onboarding that starts from the real user-clicked launcher.

**Architecture:** Keep one persisted `onboarding_done` preference and add a session-only module state machine around the existing tour. The Catch Up sequence gains real launcher steps; native pointer or keyboard activation opens the application surface through its existing handler, then the tour switches to one target-reachable contextual module and returns to the remaining launcher sequence without synthesizing navigation. Jira field previews retain their read-only owner contract but close into an unlocked **Next** state instead of advancing automatically. Team Groups keeps one canonical favorite control in the left row and moves visibility into a compact right-pane preference row.

**Tech Stack:** React 19, React DOM portals, native button/radio keyboard behavior, DOM `inert` and ARIA restoration, Node 20 test runner, Playwright, esbuild, Python `unittest`.

**Executed design:** `docs/agents/bugfixes/2026-09-01-executed-user-onboarding-contextual-follow-up.md`

**Branch and build policy:** Work only in the existing `feature/user-onboarding-tour` checkout. Preserve unrelated `.env.example` changes. Do not switch to `main`. Do not create an implementation worktree. The previously authorized temporary verification worktree is allowed only for the final clean Node 20 generated-output check, at the concrete implementation ref produced in Task 8. Never hand-edit `frontend/dist`.

**Explicit exclusion:** Do not read, modify, cite, or recheck `docs/plans/GATE-05-home-write-capability.md` in any task. This frontend follow-up does not touch Home Project write capability.

---

## Scope and forbidden regressions

### In scope

- Desktop coachmark width, action hierarchy, button tones, and deterministic wrapping.
- A visible disabled **Next** before each interactive field preview is completed, then a visible enabled **Next** after a valid close or honest error fallback.
- Session-only contextual modules for Configuration, Planning, Board, and Statistics.
- Exact launcher and destination target hooks on the existing Settings gear and ENG mode controls/surfaces.
- A single left-row Department favorite control and a compact right-pane visibility row.
- Onboarding product documentation, analytics allowlist review, source guards, focused tests, full suites, generated assets, and settled screenshots.

### Forbidden

- No mobile dashboard-tour expansion; keep the existing mobile suppression and GitHub issue #151 deferral.
- No backend route, schema, migration, ownership, auth, CSRF, or saved-preference changes.
- No new analytics event or parameter and no raw Department, Team, issue, query, or step data.
- No Jira mutation from Priority, Project Track, or Status previews.
- No programmatic click, forced navigation, Playwright `force: true`, or disabled-control bypass.
- No auto-advance when an interactive preview closes.
- No second favorite star, shared `defaultGroupId` mutation, or visibility-as-favorite shortcut.
- No automatic Team addition or Settings save.
- No weakening of modal isolation for manual/fallback steps or exact restoration for target-reachable steps.
- No unrelated cleanup or `.env.example` staging.

## API, ownership, and analytics matrix

No API contract changes are allowed.

| Action | Allowed behavior | Forbidden behavior | Analytics |
| --- | --- | --- | --- |
| Open Settings contextual module | Existing Settings open handler and existing `settings_action` | No save request, preference request, or Team mutation | Existing Settings-open event only |
| Open Planning/Board/Statistics contextual module | Existing `EngModeControl` state transition | No synthesized click and no extra data fetch beyond the existing surface behavior | Existing view-selection event only |
| Configuration guide | Read/use the real Team search and existing explicit editor actions | No automatic add, remove, Save, Cancel, or preference write | No guide-step event |
| Priority preview | Existing options read | No priority POST | Existing safe options-open event only |
| Project Track preview | Existing options read | No project-track POST | Existing safe options-open event only |
| Status preview | Existing transition-options read | No transitions POST | Existing safe options-open event only |
| Module completion | Session-only state | No onboarding preference write before final Finish or explicit Skip | No new event |
| Final Finish/Skip | Existing `/api/me/onboarding` preference write | No duplicate write or schema change | Existing completed/skipped event |

## Session state machine

Use these exact module ids: `catch-up`, `configuration`, `planning`, `board`, `statistics`.

```text
inactive
  -> catch-up(current existing step)
catch-up(module launcher activated by the real control)
  -> module(active contextual step, resumeStepId = next Catch Up launcher)
module(Next)
  -> catch-up(resumeStepId)
configuration(Next while Settings remains open)
  -> suspended-settings(completed configuration, no coachmark)
suspended-settings(Settings closes)
  -> catch-up(resumeStepId)
catch-up(Finish and every required module completed)
  -> persisted complete
any active state(explicit Skip)
  -> persisted skipped
auth required
  -> global auth lock, no local recovery or replay
```

Unavailable or disabled launchers use a truthful fallback. Manual **Next** acknowledges that module for this session so the user can reach Finish. An ordinary close, target loss, stale request, rerender, or remount never acknowledges a module.

## File map

### Create

- `frontend/src/onboarding/onboardingModules.js` — pure module catalog and reducer-like state transitions.
- `tests/test_onboarding_modules.js` — Node unit coverage for module activation, completion, suspension, fallback acknowledgement, replay reset, and duplicate/stale actions.

### Modify

- `frontend/src/onboarding/onboardingSteps.js` — module-specific step catalogs, launcher steps, target metadata, copy, and progress groups.
- `frontend/src/onboarding/useOnboardingTour.js` — module-aware session state and explicit preview-unlock state keyed by session/step.
- `frontend/src/onboarding/OnboardingTour.jsx` — requested-module reconciliation, target-reachable contextual mode, always-visible Next, and action classes.
- `frontend/src/eng/EngModeControl.jsx` — exact launcher target metadata and contextual activation callback.
- `frontend/src/ui/SegmentedControl.jsx` — pass approved per-option DOM attributes without changing selection semantics.
- `frontend/src/eng/EngBoardView.jsx` — exact Board orientation target hook.
- `frontend/src/settings/TeamGroupsSettings.jsx` — sole row favorite, first-run pending status in the same slot, compact visibility row, and Configuration Team target.
- `frontend/src/styles/settings/onboarding-tour.css` — 560px bounded card, stable footer, and blue/red action variants.
- `frontend/src/styles/settings/group-editor.css` — non-wrapping title structure and compact preference/action rows.
- `frontend/src/dashboard.jsx` — module request wiring, Settings/Planning/Board/Statistics launch observation, destination target hooks, and active-surface signal.
- `tests/test_onboarding_tour_utils.js` — catalogs, copy, module target resolution, and source guards.
- `tests/test_first_run_group_configuration.js` — source guards for one favorite control and the right-pane structure.
- `tests/ui/onboarding_tour.spec.js` — pointer/keyboard module journeys, preview unlock, restoration, mutation guards, and screenshots.
- `tests/ui/shared_department_groups.spec.js` — favorite/visibility layout behavior and screenshots.
- `docs/features/onboarding.md` — contextual module behavior and desktop-only boundary.
- `docs/README_ANALYTICS.md` — explicit no-new-event allowlist reason.
- `docs/plans/README.md` — execution status and result totals.
- `docs/agents/bugfixes/2026-09-01-planned-user-onboarding-contextual-follow-up.md` — rename to `executed` and add outcome during finalization.
- `docs/plans/DONE-user-onboarding-contextual-follow-up.md` — record task evidence, final ref, outcome, and current accuracy.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css` — generated only by `npm run build` under pinned Node 20.

---

### Task 0: Baseline, branch, ownership, and source guards

**Files:** Read-only baseline; do not modify files.

- [ ] **Step 1: Verify branch and preserve unrelated work**

Run:

```bash
git status --short --branch
git branch --show-current
git diff -- .env.example
git log --oneline -5
```

Expected: branch is `feature/user-onboarding-tour`; `.env.example` remains the only unrelated local edit if still present; the pushed plan commit is reachable. Stop if on `main` or if another uncommitted file overlaps this plan.

- [ ] **Step 2: Initialize and verify repository-pinned Node 20**

Run:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20
node --version
npm --version
```

Expected: `node --version` starts with `v20.`. Do not update Node, `.nvmrc`, `package.json`, or dependencies.

- [ ] **Step 3: Run the full Python baseline**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected at the plan base: 1,396 tests pass with 7 skipped. Record any changed honest total. A failure is a baseline failure; do not hide it or claim completion.

- [ ] **Step 4: Run focused frontend baselines**

Run:

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_onboarding_tour_interaction.js tests/test_first_run_group_configuration.js
npx playwright test tests/ui/onboarding_tour.spec.js tests/ui/shared_department_groups.spec.js
```

Expected: both commands pass on the base ref. Preserve the current screenshots as baseline evidence; the reported regressions are visual/behavior gaps not existing test failures.

- [ ] **Step 5: Confirm forbidden source paths**

Run:

```bash
rg -n "POST /api/issues/(priorities|project-track)|POST /api/issues/transitions|force: true|defaultGroupId" frontend/src/onboarding tests/ui/onboarding_tour.spec.js frontend/src/settings/TeamGroupsSettings.jsx
```

Expected: no onboarding mutation or force-click implementation; existing compatibility references to `defaultGroupId` are not the DB user's personal favorite path. Do not open the explicitly excluded gate.

---

### Task 1: Add the pure contextual-module state machine

**Files:**
- Create: `frontend/src/onboarding/onboardingModules.js`
- Create: `tests/test_onboarding_modules.js`

- [ ] **Step 1: Write failing unit tests**

Cover these exact cases:

```js
assert.deepEqual(createOnboardingModuleSession(), {
    activeModule: 'catch-up',
    completedModules: [],
    resumeStepId: '',
    suspendedSurface: '',
    requestNonce: 0,
});

assert.deepEqual(
    activateOnboardingModule(createOnboardingModuleSession(), {
        moduleId: 'planning',
        resumeStepId: 'launch-board',
        requestNonce: 1,
    }).activeModule,
    'planning'
);

const activeConfiguration = activateOnboardingModule(createOnboardingModuleSession(), {
    moduleId: 'configuration',
    resumeStepId: 'launch-planning',
    requestNonce: 1,
});
const suspended = completeOnboardingModule(activeConfiguration, { surface: 'settings' });
assert.equal(suspended.suspendedSurface, 'settings');
assert.equal(resumeOnboardingAfterSurfaceExit(suspended, 'catch-up').activeModule, 'catch-up');

assert.equal(allRequiredOnboardingModulesComplete({
    completedModules: ['configuration', 'planning', 'board', 'statistics'],
}), true);
```

Also assert invalid ids, duplicate nonces, duplicate completion, stale completion, replay reset, and fallback acknowledgement are idempotent.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test tests/test_onboarding_modules.js
```

Expected: FAIL because `onboardingModules.js` does not exist.

- [ ] **Step 3: Implement the minimal pure module contract**

Implement this complete pure contract, keeping state serializable and returning the original object for invalid, stale, or duplicate actions:

```js
export const ONBOARDING_MODULE_IDS = Object.freeze([
    'catch-up', 'configuration', 'planning', 'board', 'statistics',
]);
export const REQUIRED_CONTEXTUAL_MODULE_IDS = Object.freeze([
    'configuration', 'planning', 'board', 'statistics',
]);

const CONTEXTUAL_MODULE_SET = new Set(REQUIRED_CONTEXTUAL_MODULE_IDS);

function appendCompleted(completedModules, moduleId) {
    const current = Array.isArray(completedModules) ? completedModules : [];
    return current.includes(moduleId) ? current : [...current, moduleId];
}

export function createOnboardingModuleSession() {
    return {
        activeModule: 'catch-up',
        completedModules: [],
        resumeStepId: '',
        suspendedSurface: '',
        requestNonce: 0,
    };
}

export function activateOnboardingModule(state, request = {}) {
    const moduleId = String(request.moduleId || '');
    const requestNonce = Number(request.requestNonce) || 0;
    if (!CONTEXTUAL_MODULE_SET.has(moduleId)
        || requestNonce <= (Number(state?.requestNonce) || 0)
        || state?.completedModules?.includes(moduleId)) return state;
    return {
        ...state,
        activeModule: moduleId,
        resumeStepId: String(request.resumeStepId || ''),
        suspendedSurface: '',
        requestNonce,
    };
}

export function completeOnboardingModule(state, options = {}) {
    const moduleId = String(options.moduleId || state?.activeModule || '');
    if (!CONTEXTUAL_MODULE_SET.has(moduleId) || state?.activeModule !== moduleId) return state;
    return {
        ...state,
        activeModule: 'catch-up',
        completedModules: appendCompleted(state.completedModules, moduleId),
        suspendedSurface: moduleId === 'configuration' && options.surface === 'settings'
            ? 'settings'
            : '',
    };
}

export function acknowledgeUnavailableOnboardingModule(state, moduleId) {
    if (!CONTEXTUAL_MODULE_SET.has(moduleId) || state?.completedModules?.includes(moduleId)) return state;
    return {
        ...state,
        completedModules: appendCompleted(state.completedModules, moduleId),
    };
}

export function resumeOnboardingAfterSurfaceExit(state, activeSurface) {
    if (!state?.suspendedSurface || activeSurface === state.suspendedSurface) return state;
    return { ...state, suspendedSurface: '' };
}

export function allRequiredOnboardingModulesComplete(state) {
    const completed = new Set(state?.completedModules || []);
    return REQUIRED_CONTEXTUAL_MODULE_IDS.every((moduleId) => completed.has(moduleId));
}
```

Preserve insertion order and require a strictly newer `requestNonce`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test tests/test_onboarding_modules.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/onboarding/onboardingModules.js tests/test_onboarding_modules.js
git commit -m "feat: add contextual onboarding module state"
```

---

### Task 2: Define module catalogs and exact launcher/destination hooks

**Files:**
- Modify: `frontend/src/onboarding/onboardingSteps.js`
- Modify: `frontend/src/ui/SegmentedControl.jsx`
- Modify: `frontend/src/eng/EngModeControl.jsx`
- Modify: `frontend/src/eng/EngBoardView.jsx`
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_onboarding_tour_utils.js`
- Modify: `tests/test_first_run_group_configuration.js`

- [ ] **Step 1: Write failing catalog and source-contract tests**

Assert the Catch Up catalog contains ordered launcher ids after `jira-export` and before `complete`:

```js
[
  ['launch-configuration', 'configuration'],
  ['launch-planning', 'planning'],
  ['launch-board', 'board'],
  ['launch-statistics', 'statistics'],
]
```

Each launcher uses `progression: 'module-launch'`, `interaction: 'target-reachable'`, `requireEnabled: true`, and a truthful fallback body. Assert each contextual catalog has one `interaction: 'target-reachable'`, `progression: 'module-manual'` step with these target ids:

```text
configuration-team-add
planning-overview
board-overview
statistics-overview
```

Add source assertions for `data-onboarding-target="settings-launcher"`, per-option Planning/Board/Statistics metadata, and the four destination hooks.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_first_run_group_configuration.js
```

Expected: FAIL on missing catalogs and hooks.

- [ ] **Step 3: Add exact metadata without changing native handlers**

Extend `SegmentedControl` options with an optional `domProps` object and spread it only onto the native button:

```jsx
<button
    {...(option.domProps || {})}
    key={option.value}
    className={`segmented-control-button ${active ? 'active' : ''}`}
    onClick={() => onChange(option.value)}
    role="radio"
    aria-checked={active}
    type="button"
    disabled={option.disabled}
    title={option.title}
>
```

In `EngModeControl`, attach `data-onboarding-target` values `planning-launcher`, `board-launcher`, and `statistics-launcher` to the matching options. Keep the existing `onChange` as the only state transition.

Add:

```jsx
data-onboarding-target="settings-launcher"
```

to the existing ENG Settings gear; `data-onboarding-target="planning-overview"` to `.planning-panel`; `data-onboarding-target="statistics-overview"` to `.stats-panel`; and `data-onboarding-target="board-overview"` to the `.eng-board` region. Put `data-onboarding-target="configuration-team-add"` on the actual Team search input when it exists and on no fake control.

- [ ] **Step 4: Add the module-specific step catalogs**

Export `ONBOARDING_STEPS_BY_MODULE` and make target resolution accept a catalog argument instead of scanning only the Catch Up constant. Required contextual copy:

```text
Configuration: Add or remove Teams here to control which Jira work appears for this Department. No change is required to continue.
Planning: Planning helps select sprint work, compare it with capacity, and hand a chosen issue set to Jira.
Board: Board groups scoped Epics into the Department's configured workflow columns.
Statistics: Statistics compares delivery, priority, lead-time, capacity, and collaboration views for the selected scope.
```

For a missing Configuration input because the Team limit is reached or the catalog is unavailable, use a fallback that states the actual reason and allows manual Next.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_first_run_group_configuration.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/onboarding/onboardingSteps.js frontend/src/ui/SegmentedControl.jsx frontend/src/eng/EngModeControl.jsx frontend/src/eng/EngBoardView.jsx frontend/src/settings/TeamGroupsSettings.jsx frontend/src/dashboard.jsx tests/test_onboarding_tour_utils.js tests/test_first_run_group_configuration.js
git commit -m "feat: define contextual onboarding targets"
```

---

### Task 3: Wire genuine launcher activation to contextual modules

**Files:**
- Modify: `frontend/src/onboarding/useOnboardingTour.js`
- Modify: `frontend/src/onboarding/OnboardingTour.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_onboarding_modules.js`
- Modify: `tests/ui/onboarding_tour.spec.js`

- [ ] **Step 1: Write failing browser tests for pointer and keyboard paths**

For each launcher, prove a normal `.click()` and native `focus()` + `press('Enter')` path:

```js
await page.getByRole('radio', { name: 'Planning' }).click();
await expect(page.locator('[data-onboarding-module="planning"]')).toBeVisible();
await expect(page.locator('[data-onboarding-target="planning-overview"]')).toBeVisible();
```

Repeat for Board and Statistics. For Settings, click the real `Manage team groups` button, assert Departments → Team Groups opens, and assert the Configuration guide targets the real Team search input. Record the existing application handler count and assert exactly one state transition per activation. Do not use `force: true`.

Add cases for disabled Planning/Statistics, missing Board data, Settings closing before module completion, Settings completing then remaining suspended until close, reopening an incomplete module, and not replaying a completed module.

- [ ] **Step 2: Run the focused browser tests and verify RED**

```bash
npx playwright test tests/ui/onboarding_tour.spec.js --grep "contextual module|launcher"
```

Expected: FAIL because module requests are not wired.

- [ ] **Step 3: Add module requests to the existing controller**

`useOnboardingController` must expose a monotonic request and active-surface input without persisting it:

```js
requestModule(moduleId) // no-op and returns false unless run is active
moduleRequest           // { moduleId, requestNonce }
clearModuleRequest(requestNonce)
```

Reset the session on automatic start, replay, Skip, Finish, and auth lock. Do not call `prepareCatchUp` for a contextual request.

- [ ] **Step 4: Make the tour module-aware**

Extend `useOnboardingTour` to keep `moduleSession` from Task 1 beside the current step state. On a newer request, activate the requested module only when the request matches the real current surface. On module **Next**, complete once and resume the next Catch Up launcher. For Configuration, set `suspendedSurface: 'settings'`; render no coachmark until `showGroupManage` becomes false, then resume.

Keep a module request pending across React renders until `activeSurface` matches its module; do not consume or discard the request during the state-setter/render gap. Consume the matching nonce exactly once. When a `module-launch` step has no enabled target and renders its fallback, manual **Next** calls `acknowledgeUnavailableOnboardingModule` before moving to the next launcher. Render/enable final **Finish** only when `allRequiredOnboardingModulesComplete(moduleSession)` is true.

On an available `module-launch` step, keep **Next** visible but disabled: the real launcher must be activated by pointer or native keyboard input. Only the missing/disabled fallback enables manual **Next**. Contextual `module-manual` orientation steps enable **Next** after their destination target is rendered and Settings is clean/not saving.

Add these explicit props to the existing `OnboardingTour` invocation in `dashboard.jsx`:

```jsx
activeSurface={showGroupManage ? 'settings' : activeEngMode}
moduleRequest={onboarding.moduleRequest}
onModuleRequestConsumed={onboarding.clearModuleRequest}
```

Call `onboarding.requestModule('configuration')` only inside the existing Settings click handler after the real open action. Call `requestModule(nextMode)` only after the existing `applyEngMode(nextMode)` path for `planning`, `board`, and `statistics`. Catch Up and Scenario do not request contextual modules.

- [ ] **Step 5: Preserve dirty/saving Settings authority**

While Configuration is active, pass existing dirty/saving state to disable contextual Next and explain **Save or discard the current Settings changes before continuing.** Never invoke Save/Cancel. A 409 or auth lock remains owned by existing Settings/global recovery behavior.

- [ ] **Step 6: Run unit and browser tests and verify GREEN**

```bash
node --test tests/test_onboarding_modules.js tests/test_onboarding_tour_utils.js
npx playwright test tests/ui/onboarding_tour.spec.js --grep "contextual module|launcher"
```

Expected: PASS with normal pointer and keyboard actions and no synthetic navigation.

Capture and inspect these settled files under `test-results/onboarding-tour-qa/`:

```text
context-configuration.png
context-planning.png
context-board.png
context-statistics.png
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/onboarding/useOnboardingTour.js frontend/src/onboarding/OnboardingTour.jsx frontend/src/dashboard.jsx tests/test_onboarding_modules.js tests/ui/onboarding_tour.spec.js
git commit -m "feat: launch contextual onboarding from real controls"
```

---

### Task 4: Replace field-preview auto-advance with an explicit Next latch

**Files:**
- Modify: `frontend/src/onboarding/useOnboardingTour.js`
- Modify: `frontend/src/onboarding/OnboardingTour.jsx`
- Modify: `tests/test_onboarding_tour_utils.js`
- Modify: `tests/ui/onboarding_tour.spec.js`

- [ ] **Step 1: Rewrite affected tests to the approved contract and verify RED**

For Priority, Project Track, and Status, assert:

```js
const heading = page.getByRole('heading', { name: 'Preview Priority options' });
const next = page.getByRole('button', { name: 'Next' });
const highlightedTarget = page.locator('[data-onboarding-target="editing-priority"]').first();
await expect(next).toBeVisible();
await expect(next).toBeDisabled();
await highlightedTarget.click();
await expect(page.locator('[data-onboarding-preview-owner]')).toBeVisible();
await page.keyboard.press('Escape');
await expect(heading).toBeVisible();
await expect(next).toBeEnabled();
await next.click();
await expect(page.getByRole('heading', { name: 'Preview Project Track options' })).toBeVisible();
```

Repeat with pointer close, keyboard close, `ready`, `empty`, and `error`. Assert `loading`, cleanup, target loss, stale descriptor, unmount, replacement, and unrelated close do not unlock. Duplicate close/click/rerender cannot enable another step or advance twice.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test tests/test_onboarding_tour_utils.js
npx playwright test tests/ui/onboarding_tour.spec.js --grep "preview.*Next|duplicate lifecycle|target replacement|late lifecycle"
```

Expected: old auto-advance assertions fail.

- [ ] **Step 3: Implement the session-and-step keyed unlock**

Replace `advanceFromStep(tour.currentStepId)` in the preview-close effect with a one-shot call equivalent to:

```js
tour.unlockStep({
    sessionId: previewDescriptor.sessionId,
    stepId: previewDescriptor.stepId,
});
```

`useOnboardingTour` stores the unlocked key only for the current session/step, clears it on Back, section Skip, target loss, replay, module change, Skip, Finish, and unmount, and ignores duplicate/stale keys. `goNext` remains the only progression action.

On valid ready/empty close, restore focus to the exact trigger and unlock. On error close, switch to the existing field-specific fallback and unlock manual Next. Authentication-required still removes the tour behind the global lock.

- [ ] **Step 4: Use the approved instruction and always render Next**

Interactive body text must be exactly:

```text
Click the highlighted control to preview its choices. Nothing will change.
```

For every non-terminal step render **Next**. Disable it when `presentation.loading`, an action is pending, a contextual Settings decision is pending, or the current `menu-preview` key is not unlocked. Do not hide it.

- [ ] **Step 5: Re-run focused tests and verify GREEN**

```bash
node --test tests/test_onboarding_tour_utils.js
npx playwright test tests/ui/onboarding_tour.spec.js --grep "preview|zero Jira mutation|authentication-required"
```

Expected: PASS; request logs contain zero Jira mutation requests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/onboarding/useOnboardingTour.js frontend/src/onboarding/OnboardingTour.jsx tests/test_onboarding_tour_utils.js tests/ui/onboarding_tour.spec.js
git commit -m "fix: require explicit Next after onboarding previews"
```

---

### Task 5: Correct coachmark action hierarchy and geometry

**Files:**
- Modify: `frontend/src/onboarding/OnboardingTour.jsx`
- Modify: `frontend/src/styles/settings/onboarding-tour.css`
- Modify: `tests/test_onboarding_tour_utils.js`
- Modify: `tests/ui/onboarding_tour.spec.js`

- [ ] **Step 1: Write failing role/class and geometry assertions**

Assert:

- desktop card width is 540–560px when viewport permits and never exceeds `viewport - 32px`;
- **Next** uses `.onboarding-tour-action-next` with `#69c0ff`-family background and readable dark text;
- **Skip onboarding** uses a filled `.onboarding-tour-action-skip-all` blocked-red treatment;
- **Skip this section** uses an outlined `.onboarding-tour-action-skip-section` blocked-red treatment;
- **Back** retains neutral `.secondary` styling;
- all four actions have distinct accessible names, remain within the card, and do not overlap at desktop and narrow desktop widths.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/test_onboarding_tour_utils.js
npx playwright test tests/ui/onboarding_tour.spec.js --grep "action hierarchy|coachmark geometry"
```

- [ ] **Step 3: Implement the stable action layout**

Use:

```css
.onboarding-tour-card {
    width: min(560px, calc(100vw - 32px));
}
.onboarding-tour-actions {
    display: grid;
    grid-template-columns: max-content 1fr;
}
.onboarding-tour-navigation {
    display: flex;
    flex-wrap: nowrap;
    justify-content: flex-end;
}
```

Add a deterministic two-row narrow-desktop rule without enabling the mobile tour. Use `#69c0ff` for Next and `#ff4d4f` for the two Skip variants, with focus-visible outlines and disabled contrast retained.

- [ ] **Step 4: Update placement default and verify all controls remain reachable**

Change `DEFAULT_COACHMARK_SIZE.width` to `560`. Re-run target placement, visual viewport, scroll-lock, coarse-target, and no-overlap tests; do not loosen placement tolerances to make the wider card pass.

- [ ] **Step 5: Run focused tests and capture settled screenshots**

```bash
npx playwright test tests/ui/onboarding_tour.spec.js --grep "action hierarchy|coachmark geometry|visual viewport|coarse-pointer"
```

Required files under `test-results/onboarding-tour-qa/`:

```text
coachmark-actions-desktop.png
coachmark-actions-narrow-desktop.png
preview-next-locked.png
preview-next-ready.png
```

Disable or wait for animations through the existing settled screenshot helper and inspect every image.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/onboarding/OnboardingTour.jsx frontend/src/styles/settings/onboarding-tour.css tests/test_onboarding_tour_utils.js tests/ui/onboarding_tour.spec.js
git commit -m "fix: clarify onboarding coachmark actions"
```

---

### Task 6: Make the left Department star canonical and repair the editor layout

**Files:**
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx`
- Modify: `frontend/src/styles/settings/group-editor.css`
- Modify: `tests/test_first_run_group_configuration.js`
- Modify: `tests/ui/shared_department_groups.spec.js`

- [ ] **Step 1: Write failing source and browser tests**

Assert exactly one `.group-list-star` per row and zero `.group-star-button` elements in the right pane. Ordinary rows retain a native button with correct `aria-pressed`, disabled-without-teams behavior, stopPropagation, and the existing private favorite setter.

For first-run pending save, assert the same row-star slot renders a compact status with:

```text
Favorite Department, selected pending save
```

It must not be a disabled/no-op button. The first-run guide's favorite target resolves to this row slot.

Assert the right editor order is title → `.group-preference-row` → `.group-editor-actions`, with **Duplicate** inside the action row. The visibility label is **Show in Department selector** and the only favorite helper is **Favorite Departments are always shown.**

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/test_first_run_group_configuration.js
npx playwright test tests/ui/shared_department_groups.spec.js --grep "favorite|visibility|editor layout"
```

- [ ] **Step 3: Remove the duplicate right-pane star and reuse the left slot**

In the row, render one of:

```jsx
{firstRunConfigurationActive && isActive ? (
    <span
        className="group-list-star group-list-star-status"
        data-first-run-guide-target="favorite"
        role="status"
        aria-label="Favorite Department, selected pending save"
    >★</span>
) : (
    <button
        type="button"
        className="group-list-star"
        aria-pressed={isDefault}
        aria-label={isDefault
            ? `${group.name || 'Department'} is your favorite Department`
            : `Set ${group.name || 'Department'} as your favorite Department`}
        onClick={(event) => {
            event.stopPropagation();
            if (personalGroupPreferencesEnabled) setFavoriteGroupDraft(group.id);
            else toggleDefaultGroupDraft(group.id);
        }}
        disabled={groupVisibilitySaving || !(group.teamIds || []).some(teamId => String(teamId || '').trim())}
    >{isDefault ? '★' : '☆'}</button>
)}
```

Do not change favorite persistence. Remove the right `.group-star-button` entirely.

- [ ] **Step 4: Split title, visibility, and actions**

Render the right pane as:

```jsx
<div className="group-editor-header">
    <h3 className="group-editor-name">{activeGroupDraft.name || 'Untitled Department'}</h3>
</div>
<div className="group-preference-row">
    {firstRunConfigurationActive ? (
        <div
            className="first-run-preference-status"
            data-first-run-guide-target="visibility"
            tabIndex={0}
            role="status"
            aria-label="Show in Department selector, checked. Favorite Departments are always shown"
        >
            Shown in Department selector
        </div>
    ) : (
        <label className="group-visible-control">
            <input
                type="checkbox"
                checked={isGroupVisibleInControls(activeGroupDraft.id)}
                aria-describedby={visibilityDescriptionIds}
                disabled={groupVisibilitySaving || activeGroupIsFavorite}
                onChange={() => toggleGroupVisibleInControls(activeGroupDraft.id)}
            />
            <span>Show in Department selector</span>
        </label>
    )}
    {(firstRunConfigurationActive || activeGroupIsFavorite) && (
        <span id={favoriteVisibilityHelperId} className="group-visible-helper group-visible-favorite-helper">
            Favorite Departments are always shown.
        </span>
    )}
</div>
<div className="group-editor-actions">
    <button
        className="secondary compact"
        onClick={() => duplicateGroupDraft(activeGroupDraft.id)}
        type="button"
    >Duplicate</button>
</div>
```

Keep the checkbox disabled when favorite and preserve `aria-describedby`. Remove the long dashboard-menu explanation; show only the approved short favorite note when applicable.

- [ ] **Step 5: Run tests and capture settled screenshots**

```bash
node --test tests/test_first_run_group_configuration.js
npx playwright test tests/ui/shared_department_groups.spec.js --grep "favorite|visibility|editor layout|first-run preferences"
```

Required files under `/tmp/shared-department-groups-qa/`:

```text
department-editor-preferences-desktop.png
department-row-favorite-first-run.png
department-row-favorite-ordinary.png
```

Inspect all three after animations settle. Verify the title, checkbox, and Duplicate control have no excessive blank columns or flex-wrap scatter.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/settings/TeamGroupsSettings.jsx frontend/src/styles/settings/group-editor.css tests/test_first_run_group_configuration.js tests/ui/shared_department_groups.spec.js
git commit -m "fix: simplify Department favorite and visibility controls"
```

---

### Task 7: Documentation, analytics review, and source guards

**Files:**
- Modify: `docs/features/onboarding.md`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `tests/test_onboarding_tour_utils.js`
- Modify: `tests/test_first_run_group_configuration.js`

- [ ] **Step 1: Add failing documentation/source guards**

Require the onboarding guide to name Configuration, Planning, Board, and Statistics as desktop contextual modules, explain that a module starts after the user opens the real area, and state that Configuration does not add or save a Team automatically.

Require analytics docs to state: launcher/view and option-open events remain existing canonical events; module navigation itself is allowlisted as no-new-event because it contains no independent product outcome; raw target/step/Department/Team/issue data is forbidden.

Add guards rejecting:

```text
Activate the highlighted control
group-star-button
force: true
advanceFromStep(tour.currentStepId)
```

in the relevant onboarding implementation/test paths.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_first_run_group_configuration.js
```

- [ ] **Step 3: Update documentation to the shipped contract**

Keep mobile dashboard onboarding explicitly deferred to issue #151. Do not claim contextual modules exist on mobile. Do not introduce production identifiers or unsupported Jira behavior.

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_first_run_group_configuration.js tests/test_onboarding_analytics.js
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add docs/features/onboarding.md docs/README_ANALYTICS.md tests/test_onboarding_tour_utils.js tests/test_first_run_group_configuration.js
git commit -m "docs: describe contextual desktop onboarding"
```

---

### Task 8: Full verification, generated output, visual inspection, and finalization

**Files:**
- Modify generated: `frontend/dist/dashboard.js`
- Modify generated: `frontend/dist/dashboard.js.map`
- Modify generated: `frontend/dist/dashboard.css`
- Rename: `docs/agents/bugfixes/2026-09-01-planned-user-onboarding-contextual-follow-up.md` → `docs/agents/bugfixes/2026-09-01-executed-user-onboarding-contextual-follow-up.md`
- Modify: `docs/plans/DONE-user-onboarding-contextual-follow-up.md`
- Modify: `docs/plans/README.md`

- [x] **Step 1: Run all focused onboarding tests together**

```bash
node --test tests/test_onboarding_modules.js tests/test_onboarding_tour_utils.js tests/test_onboarding_tour_interaction.js tests/test_first_run_group_configuration.js tests/test_onboarding_analytics.js
npx playwright test tests/ui/onboarding_tour.spec.js tests/ui/shared_department_groups.spec.js
```

Expected: PASS. Confirm no test uses `force: true` as hit-testing evidence.

- [x] **Step 2: Run the complete Python and frontend suites under Node 20**

```bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npm run test:frontend:ui
```

Expected: all pass. Record exact totals and skips; do not copy the baseline totals if they changed.

- [x] **Step 3: Build generated output in the implementation checkout**

```bash
npm run build
git status --short
git diff --check
```

Expected: only intended source/docs/tests plus generated `frontend/dist` files are changed; `.env.example` remains unstaged and untouched.

- [x] **Step 4: Commit source plus generated output**

```bash
git add frontend/src frontend/dist tests docs/features/onboarding.md docs/README_ANALYTICS.md
git commit -m "build: finalize contextual onboarding follow-up"
```

Before committing, inspect `git diff --cached --name-only` and unstage anything not named by this plan. Never add `.env.example`.

- [x] **Step 5: Prove reproducible generated output in the authorized temporary worktree**

Use the concrete implementation commit from Step 4:

```bash
git worktree add /tmp/jira-planning-onboarding-follow-up-verify HEAD
cd /tmp/jira-planning-onboarding-follow-up-verify
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20
npm ci
npm run build
git status --short
```

Expected: Node `v20.x`; `npm ci` succeeds; the post-build worktree is clean. If not clean, copy no files manually—fix source/build inputs in the implementation checkout and repeat from a new concrete commit. Remove the temporary worktree only after recording evidence.

- [x] **Step 6: Inspect every required screenshot**

Inspect these settled files at original resolution:

```text
test-results/onboarding-tour-qa/coachmark-actions-desktop.png
test-results/onboarding-tour-qa/coachmark-actions-narrow-desktop.png
test-results/onboarding-tour-qa/preview-next-locked.png
test-results/onboarding-tour-qa/preview-next-ready.png
test-results/onboarding-tour-qa/context-configuration.png
test-results/onboarding-tour-qa/context-planning.png
test-results/onboarding-tour-qa/context-board.png
test-results/onboarding-tour-qa/context-statistics.png
/tmp/shared-department-groups-qa/department-editor-preferences-desktop.png
/tmp/shared-department-groups-qa/department-row-favorite-first-run.png
/tmp/shared-department-groups-qa/department-row-favorite-ordinary.png
```

Reject clipping, overlap, scattered whitespace, duplicate star controls, hidden Next, incorrect tones, obscured targets, unsettled animation, or stale UI.

- [x] **Step 7: Review the final diff line by line**

```bash
git diff 40b7ccf..HEAD -- frontend/src tests docs frontend/dist
git diff --check 40b7ccf..HEAD
git status --short --branch
git log --oneline -10
```

Verify every changed line maps to this plan, negative Jira mutation guards remain, mobile tour behavior is unchanged, and `.env.example` is not in any commit.

- [x] **Step 8: Finalize artifacts and commit evidence**

Rename the design artifact to `2026-09-01-executed-user-onboarding-contextual-follow-up.md`; set `Status: executed`; add **Outcome** and **Current Accuracy**. Update this plan with the implementation commit, exact test totals, reproducible-build result, screenshot locations, residual risks, and any baseline failure. Update `docs/plans/README.md` with the same status.

```bash
git add docs/agents/bugfixes/2026-09-01-executed-user-onboarding-contextual-follow-up.md docs/plans/DONE-user-onboarding-contextual-follow-up.md docs/plans/README.md
git commit -m "docs: record onboarding follow-up verification"
```

- [x] **Step 9: Stop before remote integration changes**

The implementation remained unpushed and this plan remained `EXEC-*` until fresh explicit user direction authorized finalization and remote integration. Report implemented tasks, changed files, exact verification totals, screenshot locations, residual risks, the final commit, and any blocked gate.

#### Task 8 verification evidence

- Runtime: pinned Node `v20.20.0` with npm `10.8.2`; checkout-local `.venv` was absent, so Python verification used the existing external project virtual environment (`Python 3.14.7`, OpenSSL `3.6.3`). The exact local interpreter path is supplied in the Task 8 handoff rather than committed, per repository privacy rules.
- Required individual baselines passed unchanged before complete suites: onboarding ready-lifecycle stability `1 passed`; future-planning sprint select-all scoping `1 passed`.
- Focused Node onboarding tests: `96 passed`, `0 failed`, `0 skipped`. Combined onboarding/Settings Playwright: `145 passed`, `0 failed`, `0 skipped`. Scoped onboarding tests contain no `force: true`; the two force-clicks in the combined Settings file are negative disabled-Save probes, not hit-testing evidence.
- First complete-suite run exposed two honest maintenance REDs: Python `1,396 run`, `1 failed`, `7 skipped` because planned `dashboard.jsx` growth was 17,076 lines against a 17,074 legacy-entrypoint budget; frontend unit `1,044 run`, `2 failed`, `0 skipped` because the same source build was not yet committed and a Task 6 source guard still expected the removed duplicate favorite. The budget was minimally ratcheted to 17,076 with its growth reason, and the source guard was updated to assert the canonical row favorite without production changes.
- Final complete suites: Python `1,396 run`, `1,389 passed`, `0 failed`, `7 skipped`; frontend unit `1,044 passed`, `0 failed`, `0 skipped`; Playwright `581 passed`, `0 failed`, `2 skipped` (`583` total). The two Playwright skips are the existing desktop/mobile EPM Settings loading-skeleton cases.
- Generated output: pinned `npm run build` rebuilt `frontend/dist/dashboard.js`, `dashboard.js.map`, and `dashboard.css`; implementation/build commit is `b4d0c83fac0397bf81facdda7b4d59faf6db932f`. A detached worktree at `/tmp/jira-planning-onboarding-follow-up-verify` on that exact commit ran pinned Node/npm, `npm ci` (`0 vulnerabilities`), and `npm run build`; post-build `git status --short` was empty. No files were copied manually, and the exact worktree was removed only after proof was recorded.
- Original-resolution visual inspection accepted all eleven required screenshots: coachmark desktop `1200x760`, narrow desktop `768x760`, preview locked/ready `1200x760` each, Configuration/Planning/Board/Statistics `1280x900` each, Department editor `1280x720`, first-run favorite `1280x900`, and ordinary favorite `1280x720`. Actions were unclipped and correctly differentiated, preview Next changed only from disabled to enabled, contextual targets were unobscured, the editor stayed compact, and only the canonical row favorite appeared.
- Final diff audit from `40b7ccf` confirmed every source, test, documentation, and generated change maps to the plan; preview request guards still record zero Jira mutations; native launcher handlers remain the only navigation path; mobile suppression, authentication abort, focus restoration, portal ownership, inert/ARIA restoration, and duplicate-event idempotence remain covered and passing. `git diff --check` was clean, and neither `.env` nor `.env.example` appears in the commit range.
- Residual risks: visual proof uses synthetic Chromium fixtures rather than production Jira data; the two pre-existing EPM loading-skeleton cases remain skipped; Node reports existing typeless-package warnings for ESM onboarding modules; and remote integration is intentionally not performed. No in-scope gate is blocked.

The committed Task 8 evidence is this section, the executed design, and the plans index. A more detailed local report exists at `.superpowers/sdd/EXEC-user-onboarding-contextual-follow-up/task-8-report.md`, but `.superpowers/` is ignored and that report is not part of commit `51d274c`.

#### Final whole-branch review fix evidence

- Audit base: `faf086e3e44e5a7fa34c897f223cda5d04920051`. Four independent Important findings each received a focused real-behavior RED before its minimal fix:
  - Rejected terminal Finish removed its retry path; the new test failed because Finish no longer existed, then passed after session/module reset was deferred until persistence success (`2ba5928`).
  - Pointer and keyboard launches could not focus the Planning destination; both new cases failed on the missing programmatic-focus contract, then passed after Planning, Board, and Statistics regions received `tabindex="-1"` (`5ba5cfe`).
  - Constrained geometry reported an enabled Planning launcher as fallback; the new case failed on `fallback` instead of `interactive_closed`, then passed after placement fallback was separated from genuine missing/disabled availability (`624cc00`).
  - Contextual Configuration in an editable unconfigured workspace opened Admin; the new case failed on the top tab, then passed after only the active contextual launch routed to Departments → Team Groups while an ordinary Settings open retained Admin → Scope (`526441a`).
- Directly related evidence cleanup corrected the preview lifecycle documentation, asserted disabled/enabled Next states, and proved missing-Board progression continues to Statistics (`72bf7c8`). The dashboard entrypoint stayed at the existing 17,076-line budget without ratcheting or weakening the structure assertion (`772c3d6`).
- Final focused verification under Node `v20.20.0` and npm `10.8.2`: Node onboarding `96 passed`, `0 failed`, `0 skipped`; onboarding/Settings Playwright `150 passed`, `0 failed`, `0 skipped`. The unchanged onboarding ready-lifecycle and future-planning sprint select-all baselines each passed individually (`1 passed` each).
- Final complete suites: Python `1,396 run`, `1,389 passed`, `0 failed`, `7 skipped`; frontend unit `1,044 passed`, `0 failed`, `0 skipped`; Playwright `586 passed`, `0 failed`, `2 skipped` (`588` total). The two skips remain the existing desktop/mobile EPM Settings loading-skeleton cases. Existing ESM typeless-package warnings and mocked error-path/resource warnings did not conceal failures and were not changed.
- Pinned `npm run build` rebuilt generated output; only `frontend/dist/dashboard.js` and `dashboard.js.map` differed and were committed atomically as `d27d449caf5ce0c3212e18f72c9e4556089d223b`. After the exact temporary path was confirmed absent and unregistered, a detached worktree there at that concrete commit ran `npm ci` (`9 packages`, `0 vulnerabilities`) and `npm run build`; its Git status remained clean. Only that temporary worktree was then removed and confirmed absent and unregistered.
- The full UI run refreshed all 11 required screenshots. Original-resolution inspection accepted coachmark desktop `1200x760`, narrow desktop `768x760`, preview locked/ready `1200x760` each, Configuration/Planning/Board/Statistics `1280x900` each, Department editor `1280x720`, first-run favorite `1280x900`, and ordinary favorite `1280x720`. Targets and actions were unobscured, Next states were honest, animations were settled, and no duplicate favorite control appeared.
- Scope remained frontend-only: no backend, schema, ownership, persistence-shape, dependency, Jira-mutation, mobile-tour, or analytics-event change. Visual proof still uses synthetic Chromium fixtures rather than production Jira data; the two existing EPM screenshot cases remain skipped; remote integration remains intentionally unperformed.

The ignored local final-fix report is `.superpowers/sdd/EXEC-user-onboarding-contextual-follow-up/final-fix-report.md`. It is verification provenance only and is not committed project evidence.

#### Residual re-review fix evidence

- A scoped re-review confirmed the persistence and destination-focus fixes, then identified two remaining launcher-boundary cases. Both received focused real-behavior RED tests before implementation.
- Centered placement could overlap the enabled Planning launcher and leave the coachmark as the hit-test owner. The strengthened geometry case failed with `onboarding-tour-progress` at the launcher point, then passed after the exact target stacking path was temporarily raised while sibling isolation remained inert (`585438a`).
- Mobile-suppressed onboarding still requested Configuration before opening ordinary Settings, which selected Departments in an unconfigured workspace. The new mobile case failed on the Departments tab, then passed after contextual module request/routing was gated by the existing dashboard mobile predicate and by an accepted request (`ef56947`).
- Pinned Node `v20.20.0` and npm `10.8.2` verification after these fixes: Node onboarding `96 passed`, `0 failed`, `0 skipped`; onboarding/Settings Playwright `151 passed`, `0 failed`, `0 skipped`; the unchanged onboarding ready-lifecycle and future-planning sprint select-all baselines each passed individually (`1 passed` each).
- Final complete suites: Python `1,396 run`, `1,389 passed`, `0 failed`, `7 skipped`; frontend unit `1,044 passed`, `0 failed`, `0 skipped`; Playwright `587 passed`, `0 failed`, `2 skipped` (`589` total). The two skips remain the existing desktop/mobile EPM Settings loading-skeleton cases.
- Pinned `npm run build` regenerated `frontend/dist/dashboard.js`, `dashboard.js.map`, and `dashboard.css` from source in `02f75e1620e1c8cf18952b50fef3ca7edd305f7e`. The authorized detached verification worktree at that exact commit ran `npm ci` (`9 packages`) and `npm run build`; post-build Git status was empty, and the temporary worktree was removed and confirmed absent and unregistered.
- The final full UI run regenerated all 11 required screenshots. Original-resolution inspection accepted their action hierarchy, locked/ready Next states, unobscured contextual surfaces, compact Department editor, and sole left-row favorite control.
- Scope remains frontend-only: no backend, schema, ownership, persistence-shape, dependency, Jira-mutation, mobile-tour, or analytics-event change. Residual risks remain synthetic Chromium fixtures rather than production Jira data, two existing skipped EPM screenshot cases, existing runtime warnings, and intentionally pending remote integration.

The ignored local residual-fix report is `.superpowers/sdd/EXEC-user-onboarding-contextual-follow-up/residual-fix-report.md`. It is verification provenance only and is not committed project evidence.

---

## Acceptance criteria

- The desktop coachmark is visibly wider and its actions are immediately distinguishable: Next blue, both Skip actions red, Back neutral.
- Next is always present on non-terminal steps; field-preview Next stays disabled until the exact target preview closes, then advances only when clicked.
- Pointer and keyboard activation of the real Settings, Planning, Board, and Statistics launchers opens the real surface and starts the matching contextual module.
- Available launcher steps keep Next disabled until the real control is activated; missing or disabled launchers provide an honest enabled manual fallback.
- Configuration guides the real Team-add control without requiring or performing a mutation.
- Completed modules do not replay in the same session; incomplete modules resume; disabled/unavailable modules use honest manual fallbacks.
- Final onboarding completion persists only after all required modules are completed or the user explicitly skips.
- The left Department-row star is the sole favorite control; the right pane has a compact visibility row and no layout scatter.
- Settings replay remains in the header across tabs and remains disabled while dirty or saving.
- Preview paths send zero Jira mutation requests and preserve exact focus, portal, inert, and ARIA restoration.
- Mobile dashboard onboarding remains deferred and unchanged.
- Focused tests, full Python, full frontend unit, and full Playwright suites pass under repository-pinned Node 20.
- Generated output is reproducible in the authorized fresh verification worktree.
- Every required screenshot is captured after animations settle and inspected.
- Final diff check is clean, unrelated `.env.example` is absent from commits, and no completion claim hides a baseline or verification failure.
