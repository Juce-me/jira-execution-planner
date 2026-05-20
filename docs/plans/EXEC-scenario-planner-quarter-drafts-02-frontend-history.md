# Scenario Planner Quarter Drafts 02 Frontend History

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Scenario Planner UI for DB-backed draft history: load the active draft for the current sprint/team/group scope, save a new version, reload old snapshots, rollback the active draft, and handle concurrent-save conflicts without losing local edits.

**Architecture:** Keep `scenarioOverrides` as the applied edit buffer in `frontend/src/dashboard.jsx`; add draft metadata around it. Replace both current frontend callers of `/api/scenario/overrides` with `/api/scenario/drafts`, then add a source guard requiring zero frontend references to `/api/scenario/overrides`.

**Tech Stack:** React 19, existing dashboard fetch patterns, CSS in `jira-dashboard.html`, Node source guards, Playwright UI/visual tests. Do not hand-edit `frontend/dist`.

---

## Prerequisite

Execute `EXEC-scenario-planner-quarter-drafts-01-persistence-api.md` first. This slice assumes:

- `GET /api/scenario/drafts?scope_key=<scope>` returns `activeDraft`, `versions`, and `storage`;
- `POST /api/scenario/drafts` saves with `baseDraftRevision`;
- `GET /api/scenario/drafts/<draft_id>/versions/<version_number>` returns a snapshot with `overrides`;
- `POST /api/scenario/drafts/<draft_id>/rollback` creates a new active version from a prior version.

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `frontend/src/dashboard.jsx` | Add draft metadata state, API helpers, history drawer/list, reload/rollback/save conflict handling. |
| Modify | `jira-dashboard.html` | Add compact Scenario history drawer/list, conflict badge, dirty confirmation, and focus styles. |
| Create | `tests/test_scenario_draft_history_source_guards.js` | Guard zero frontend `/api/scenario/overrides` calls, no `frontend/dist` edits, and native button semantics. |
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
    baseDraftRevision: null,
    savedOverrides: {},
    scopeKey: '',
    dirtyState: 'clean',
    pendingScopeChange: null,
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

`dirtyState` values:

- `clean`: `scenarioOverrides` equals `savedOverrides`.
- `dirty_local`: local overrides differ from `savedOverrides`.
- `conflict_remote`: the last save/rollback/reload returned `409 scenario_draft_conflict`.
- `remote_available`: a later collaboration event exists, but local edits are clean.
- `remote_available_dirty`: a later collaboration event exists while local edits are dirty.
- `confirm_scope_switch`: the user selected another sprint/team/group while dirty; keep current overrides and store the target in `pendingScopeChange`.

Silent discard is forbidden. The UI may replace `scenarioOverrides` only after a successful save, explicit reload, explicit rollback, explicit active-draft reload, or an explicit `Discard local edits` action in the inline confirmation.

## Dirty Edit State Machine

| Event | Clean behavior | Dirty behavior |
|---|---|---|
| Sprint/team/group changes | Clear old draft metadata, run `/api/scenario`, then load `/api/scenario/drafts` for the new `scopeKey`. | Set `dirtyState: "confirm_scope_switch"`, keep current `scenarioOverrides`, show inline `Save first`, `Discard local edits`, and `Cancel` actions, and do not call the new scope APIs until the user chooses. |
| Save succeeds | Replace `savedOverrides`, `baseDraftRevision`, `activeDraft`, and `versions` from the response; clear undo/redo and conflict state. | Same. |
| Save returns `409 scenario_draft_conflict` | Set `conflict_remote` and render the conflict body details. | Keep local `scenarioOverrides` and undo/redo untouched; set `conflict_remote`; show `Review history`, `Reload active draft`, and `Keep editing locally`. |
| Reload old version | Apply fetched snapshot locally, clear undo/redo, set `loadedVersionNumber`, but do not save to server. | First show inline confirmation. If confirmed, apply fetched snapshot; if cancelled, keep local edits. |
| Rollback | POST rollback with `baseDraftRevision`; on success replace local state from response. | First show inline confirmation. If confirmed and backend returns `409`, keep local edits and show conflict; if cancelled, keep local edits. |
| Remote event with higher `draftRevision` | Set `remote_available` and offer `Reload active draft`. | Set `remote_available_dirty`; never auto-apply remote overrides over dirty local edits. |
| User chooses `Keep editing locally` | Clear banner only if no newer event remains. | Keep local overrides, keep dirty state, and keep the current `baseDraftRevision` so the next save can still produce a conflict. |
| Save fails with network error, `5xx`, or unexpected JSON | Keep `savedOverrides`, `baseDraftRevision`, `activeDraft`, and undo/redo unchanged; set `error` with retry text. | Same; never clear local edits or conflict details. |
| Save fails with `403 csrf_required` | Fetch a fresh CSRF token once and retry the same save request once. If retry fails, keep local edits and show a recoverable auth/CSRF error. | Same; no automatic discard or reload. |
| Reload active draft | Fetch the current active draft for `scopeKey`, then apply only after user action. | First show inline confirmation; if confirmed, replace local overrides and update `baseDraftRevision`; if cancelled, keep local edits. |
| Reconnect after polling/SSE interruption | Resume with last known draft metadata and show a reconnecting state until the next poll succeeds. | Keep editing local-only; when reconnect sees a higher `draftRevision`, transition to `remote_available_dirty`. |

Conflict recovery rules:

- `conflict_remote` disables blind Save while the conflict banner is unresolved.
- `Keep editing locally` dismisses the blocking banner, transitions back to `dirty_local`, keeps the stale `baseDraftRevision`, and re-enables Save. The next Save may intentionally receive another canonical `409 scenario_draft_conflict`.
- `Reload active draft` or successful rollback replaces local state, updates `savedOverrides` and `baseDraftRevision`, and returns to `clean`.
- `Review history` opens the drawer only; it must not change `scenarioOverrides`, `savedOverrides`, or `baseDraftRevision`.

## Guardrails

### Shared Group Configuration

The Scenario draft UI uses the currently selected shared environment group as scope. It must not add group-management controls, private per-user group copies, or draft-owned group membership editing. Display `groupId`/group name only as scope metadata; the authoritative group definition remains the shared PM/EPM-managed group configuration.

### No Jira Publish Credentials

This slice must not add Jira publish/write-back behavior. If a future UI exposes publish controls, those controls must call only a future OAuth-backed Jira REST route for the signed-in user. Do not add UI paths that collect Jira/Home API tokens, use Home/Townsquare credentials, or route publish through service credentials.

## Task 1: Draft API Helpers And Load Path

- [ ] Add helper functions near `runScenario()` for:
  - `fetchScenarioDraft(scopeKey, signal)`;
  - `saveScenarioDraftVersion(scopeKey, name, baseDraftRevision, scope, overrides)`;
  - `fetchScenarioDraftVersion(draftId, versionNumber, signal)`;
  - `rollbackScenarioDraft(draftId, targetVersionNumber, baseDraftRevision)`.
- [ ] Add `fetchScenarioCsrfToken()` or reuse `fetchCsrfToken(BACKEND_URL)` from `frontend/src/api/authApi.js` for unsafe draft routes.
- [ ] Replace the `runScenario()` post-scenario load from `GET /api/scenario/overrides?scope_key=...` to `GET /api/scenario/drafts?scope_key=<scenarioScopeKey>`.
- [ ] If `activeDraft` exists, set `scenarioOverrides` from `activeDraft.overrides`, set `savedOverrides` to the same map, set `baseDraftRevision` to `activeDraft.draftRevision`, and load `versions`.
- [ ] If no active draft exists, clear overrides and metadata for the current scope.
- [ ] On sprint/team/group scope changes, follow the dirty edit state machine above; do not clear old draft metadata or local overrides while dirty unless the user explicitly discards them.
- [ ] Include only display-safe shared group scope metadata in save payloads, such as `groupId` and group name; do not send group membership as draft-owned data.
- [ ] Add source guard assertions that `frontend/src/dashboard.jsx` does not contain `/api/scenario/overrides`, and `frontend/src/` has no `/api/scenario/overrides` route strings.

Verification:

```bash
node --test tests/test_scenario_draft_history_source_guards.js
npm run build
```

Expected: source guard and build pass.

## Task 2: Save New Draft Versions

- [ ] Update `saveScenarioDraft()` so it no longer posts to `/api/scenario/overrides`.
- [ ] Fetch `/api/auth/csrf` first, then POST `/api/scenario/drafts` with `X-Requested-With: jira-execution-planner`, `X-CSRF-Token`, `scope_key`, generated `name`, `baseDraftRevision`, current scope metadata, and `scenarioOverrides`.
- [ ] On success, clear undo/redo, update `baseDraftRevision`, `loadedVersionNumber`, `savedOverrides`, `activeDraft`, and `versions`.
- [ ] On the canonical `409 scenario_draft_conflict` body, leave local `scenarioOverrides` and undo/redo untouched; show `currentDraftRevision`, `currentVersionNumber`, actor/time from `activeDraft.updatedBy`/`updatedAt`, and a `Review history` action.
- [ ] Disable Save while `scenarioDraftMeta.saving` is true.
- [ ] Keep Save enabled only when the current overrides differ from `savedOverrides` and either there is no unresolved stale-base conflict or the user has explicitly chosen `Keep editing locally`.
- [ ] Add tests for failed saves: one `500`/network failure keeps local edits and one `403 csrf_required` refreshes the CSRF token once before surfacing a recoverable error.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_history.spec.js --grep "save conflict"
```

Expected: mocked stale save leaves the dragged bar in place, shows conflict UI from the exact response shape, and opens history without clearing local edits.

## Task 3: History Drawer, Reload, And Rollback

- [ ] Add a compact `History` native button near Save Draft in edit mode and as a secondary Scenario control when data is loaded.
- [ ] Render the history UI inside the Scenario section, not as global app shell.
- [ ] Use `role="dialog"`, `aria-modal="false"`, a labelled title, and a native close button.
- [ ] Each version row shows version number, actor, timestamp, override count, and state: `Current`, `Loaded`, or neither.
- [ ] `Reload` fetches a version snapshot and applies its overrides locally without making it active on the server.
- [ ] `Rollback` fetches `/api/auth/csrf`, calls the backend rollback route with `X-Requested-With: jira-execution-planner`, `X-CSRF-Token`, and `baseDraftRevision`, and makes the selected snapshot the new active version.
- [ ] If local edits are dirty, show an inline confirmation before reload or rollback; do not use browser-native `confirm`.
- [ ] On successful reload or rollback, clear undo/redo and conflict state.
- [ ] On rollback `409 scenario_draft_conflict`, preserve dirty local edits and render the same conflict UI as stale save.

Verification:

```bash
npx playwright test tests/ui/scenario_draft_history.spec.js --grep "history|reload|rollback"
```

Expected: version rows render, reload applies old dates, rollback posts target version plus `baseDraftRevision`, and dirty confirmations appear before replacement.

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
- [ ] Update Scenario UI mocks in `tests/ui/codebase_structure_smoke.spec.js` from `/api/scenario/overrides` to `/api/scenario/drafts`.
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

Expected: all pass, no `frontend/dist` edits, no frontend `/api/scenario/overrides` calls, no dashboard auth UI rewrite, no Jira write-back behavior.

## Commit Messages

- Task 1: `git commit -m "feat: load scenario draft history"`
- Task 2: `git commit -m "feat: save scenario draft versions"`
- Task 3: `git commit -m "feat: add scenario draft history controls"`
- Task 4: `git commit -m "test: cover scenario draft history accessibility"`
- Task 5: `git commit -m "test: verify scenario draft history layout"`
- Task 6: `git commit -m "test: verify scenario draft frontend"`
