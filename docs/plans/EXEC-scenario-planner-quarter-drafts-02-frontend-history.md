# Scenario Planner Quarter Drafts 02 Frontend History

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Scenario Planner UI for DB-backed draft history: load the active draft for the current sprint/team/group scope, save a new version, reload old snapshots, rollback the active draft, and handle concurrent-save conflicts without losing local edits.

**Architecture:** Keep `scenarioOverrides` as the applied edit buffer in `frontend/src/dashboard.jsx`; add draft metadata around it. Replace the current `GET/POST /api/scenario/overrides` frontend path with `/api/scenario/drafts`, while the backend keeps `/api/scenario/overrides` for legacy compatibility.

**Tech Stack:** React 19, existing dashboard fetch patterns, CSS in `jira-dashboard.html`, Node source guards, Playwright UI/visual tests. Do not hand-edit `frontend/dist`.

---

## Prerequisite

Execute `EXEC-scenario-planner-quarter-drafts-01-persistence-api.md` first. This slice assumes:

- `GET /api/scenario/drafts?scope_key=<scope>` returns `activeDraft`, `versions`, and `storage`;
- `POST /api/scenario/drafts` saves with `baseRevision`;
- `GET /api/scenario/drafts/<draft_id>/versions/<version_number>` returns a snapshot with `overrides`;
- `POST /api/scenario/drafts/<draft_id>/rollback` creates a new active version from a prior version.

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `frontend/src/dashboard.jsx` | Add draft metadata state, API helpers, history drawer/list, reload/rollback/save conflict handling. |
| Modify | `jira-dashboard.html` | Add compact Scenario history drawer/list, conflict badge, dirty confirmation, and focus styles. |
| Create | `tests/test_scenario_draft_history_source_guards.js` | Guard endpoint use, no `frontend/dist` edits, and native button semantics. |
| Create | `tests/ui/scenario_draft_history.spec.js` | Playwright coverage for active load, save conflict, reload, rollback, dirty confirmations, sticky layout. |
| Modify | `tests/ui/codebase_structure_smoke.spec.js` | Keep Scenario sticky smoke coverage valid with History controls. |

## State Shape

Keep:

```js
const [scenarioOverrides, setScenarioOverrides] = useState({});
```

Add nearby:

```js
const [scenarioDraftMeta, setScenarioDraftMeta] = useState({
    activeDraft: null,
    versions: [],
    loadedVersionNumber: null,
    baseRevision: null,
    savedOverrides: {},
    historyOpen: false,
    loadingHistory: false,
    loadingVersionNumber: null,
    saving: false,
    rollingBackVersionNumber: null,
    pendingHistoryAction: null,
    conflict: null,
    message: '',
    error: ''
});
```

Derived dirty state compares normalized override maps, not object identity:

```js
const scenarioHasUnsavedChanges = !areScenarioOverridesEqual(
    scenarioOverrides,
    scenarioDraftMeta.savedOverrides
);
```

Only compare `start` and `end` string values for each issue key.

## Guardrails

### Shared Group Configuration

The Scenario draft UI uses the currently selected shared environment group as scope. It must not add group-management controls, private per-user group copies, or draft-owned group membership editing. Display `groupId`/group name only as scope metadata; the authoritative group definition remains the shared PM/EPM-managed group configuration.

### No Jira Publish Credentials

This slice must not add Jira publish/write-back behavior. If a future UI exposes publish controls, those controls must call only a future OAuth-backed Jira REST route for the signed-in user. Do not add UI paths that collect Jira/Home API tokens, use Home/Townsquare credentials, or route publish through service credentials.

## Task 1: Draft API Helpers And Load Path

- [ ] Add helper functions near `runScenario()` for:
  - `fetchScenarioDraft(scopeKey, signal)`;
  - `saveScenarioDraftVersion(scopeKey, name, baseRevision, scope, overrides)`;
  - `fetchScenarioDraftVersion(draftId, versionNumber, signal)`;
  - `rollbackScenarioDraft(draftId, targetVersionNumber, baseRevision)`.
- [ ] Add `fetchScenarioCsrfToken()` or reuse `fetchCsrfToken(BACKEND_URL)` from `frontend/src/api/authApi.js` for unsafe draft routes.
- [ ] After `/api/scenario` succeeds in `runScenario()`, call `GET /api/scenario/drafts?scope_key=<scenarioScopeKey>`.
- [ ] If `activeDraft` exists, set `scenarioOverrides` from `activeDraft.overrides`, set `savedOverrides` to the same map, set `baseRevision` to `activeDraft.revision`, and load `versions`.
- [ ] If no active draft exists, clear overrides and metadata for the current scope.
- [ ] On sprint/team/group scope changes, clear old draft metadata before loading the new scenario.
- [ ] Include only display-safe shared group scope metadata in save payloads, such as `groupId` and group name; do not send group membership as draft-owned data.

Verification:

```bash
node --test tests/test_scenario_draft_history_source_guards.js
npm run build
```

Expected: source guard and build pass.

## Task 2: Save New Draft Versions

- [ ] Update `saveScenarioDraft()` to fetch `/api/auth/csrf` first, then POST `/api/scenario/drafts` with `X-CSRF-Token`, `scope_key`, generated `name`, `baseRevision`, current scope metadata, and `scenarioOverrides`.
- [ ] On success, clear undo/redo, update `baseRevision`, `loadedVersionNumber`, `savedOverrides`, `activeDraft`, and `versions`.
- [ ] On `409 scenario_draft_conflict`, leave local `scenarioOverrides` and undo/redo untouched; show a conflict banner with `Review history`.
- [ ] Disable Save while `scenarioDraftMeta.saving` is true.
- [ ] Keep Save enabled only when the current overrides differ from `savedOverrides` and there is no unresolved stale-base conflict.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_history.spec.js --grep "save conflict"
```

Expected: mocked stale save leaves the dragged bar in place, shows conflict UI, and opens history without clearing local edits.

## Task 3: History Drawer, Reload, And Rollback

- [ ] Add a compact `History` native button near Save Draft in edit mode and as a secondary Scenario control when data is loaded.
- [ ] Render the history UI inside the Scenario section, not as global app shell.
- [ ] Use `role="dialog"`, `aria-modal="false"`, a labelled title, and a native close button.
- [ ] Each version row shows version number, actor, timestamp, override count, and state: `Current`, `Loaded`, or neither.
- [ ] `Reload` fetches a version snapshot and applies its overrides locally without making it active on the server.
- [ ] `Rollback` fetches `/api/auth/csrf`, calls the backend rollback route with `X-CSRF-Token`, and makes the selected snapshot the new active version.
- [ ] If local edits are dirty, show an inline confirmation before reload or rollback; do not use browser-native `confirm`.
- [ ] On successful reload or rollback, clear undo/redo and conflict state.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_history.spec.js --grep "history|reload|rollback"
```

Expected: version rows render, reload applies old dates, rollback posts target/base revisions, and dirty confirmations appear before replacement.

## Task 4: Accessibility And Keyboard Behavior

- [ ] Make `History`, `Reload`, `Rollback`, `Review history`, `Reload Version`, `Rollback to Version`, `Keep Editing`, and `Close` native buttons.
- [ ] Move focus to the drawer title when opened and return focus to History when closed.
- [ ] Support `Escape` to close only when focus is inside the drawer.
- [ ] Use `aria-live="polite"` for save/reload/rollback success text and `role="alert"` for conflict/error text.
- [ ] Preserve existing Ctrl/Cmd+Z undo behavior when focus is outside the drawer.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_history.spec.js --grep "keyboard|accessibility"
```

Expected: keyboard users can open, navigate, act, and close history controls without breaking Scenario undo/redo.

## Task 5: Sticky Layout And Visual Checks

- [ ] Extend Scenario Playwright coverage to open History after `Run Scenario`.
- [ ] Wait for transitions to settle before screenshots.
- [ ] Capture:
  - current version drawer;
  - dirty reload confirmation;
  - save conflict banner;
  - closed drawer state.
- [ ] Re-check Scenario sticky axis/header behavior after history UI opens and closes.
- [ ] Assert the history UI contains no group edit/create controls and no token input controls.

Verification:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "Scenario"
npx playwright test tests/ui/scenario_draft_history.spec.js
```

Expected: no overlap between Scenario controls, sticky axis, lanes, bars, and history UI.

## Task 6: Final Frontend Verification

Run:

```bash
node --test tests/test_scenario_draft_history_source_guards.js
npm run build
npx playwright test tests/ui/scenario_draft_history.spec.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "Scenario"
```

Expected: all pass, no `frontend/dist` edits, no dashboard auth UI rewrite, no Jira write-back behavior.

## Commit Messages

- Task 1: `git commit -m "feat: load scenario draft history"`
- Task 2: `git commit -m "feat: save scenario draft versions"`
- Task 3: `git commit -m "feat: add scenario draft history controls"`
- Task 4: `git commit -m "test: cover scenario draft history accessibility"`
- Task 5: `git commit -m "test: verify scenario draft history layout"`
- Task 6: `git commit -m "test: verify scenario draft frontend"`
