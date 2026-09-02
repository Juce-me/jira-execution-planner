Status: executed
Type: feature

# Screen-scoped Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Persist and launch onboarding independently for Catch Up, Configuration, Planning, Board, and Statistics so a user is taught only the surface they are currently using.

**Architecture:** Store canonical completed module ids in a private JSON list on `UserGroupPreference`, with `onboardingDone` derived as compatibility state. The controller opens one module at a time based on the active real surface; completing or skipping persists only that module, while replay clears the list and restarts Catch Up.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy/Alembic, React 19, Node test runner, Playwright, esbuild.

**Approved design:** `docs/agents/features/2026-09-01-executed-screen-scoped-onboarding-design.md`

**Execution constraint:** Work in the current `feature/user-onboarding-tour` checkout. Do not create a worktree, commit, push, merge, or overwrite unrelated dirty changes. Replace commit steps from the generic workflow with explicit diff/review checkpoints.

## Outcome

Implemented with changes. The five modules now persist and run independently, Catch Up stays on its current screen, and Configuration, Planning, Board, and Statistics start on their first real desktop open. Browser review added explicit interruption handling for unsupported surface exits, canonical stale-save settlement, desktop-only Configuration requests, successful/failed real Settings replay coverage, and completed-surface suppression. Scenario remains outside onboarding.

Verification completed on 2026-09-02:

- `npm run build`: passed; generated `frontend/dist/dashboard.js`, source map, and CSS were refreshed from source.
- `node --test tests/test_*.js`: 1,057 passed.
- `CONFIG_STORAGE_BACKEND=jsonfile DATABASE_URL= TEST_DATABASE_URL= .venv/bin/python -m unittest discover -s tests`: 1,404 passed, 7 PostgreSQL-only tests skipped.
- `npx playwright test tests/ui/onboarding_tour.spec.js --reporter=line`: 94 passed.
- JSON-file startup preflight: all checks passed.
- Local OAuth server: clean startup, `/api/auth/status` returned 200, and unauthenticated `/api/test` returned the expected 401. A 200 `/api/test` smoke was not possible without a signed-in OAuth browser session; Basic mode is intentionally unconfigured.
- `git diff --check`: passed.

The configured local PostgreSQL endpoint was offline, so the full Python verification used the repository-supported JSON-file configuration; PostgreSQL-specific tests remained skipped rather than being misreported as executed.

## Current Accuracy

Accurate for the screen-scoped persistence and launcher behavior. A 2026-09-02 follow-up keeps Next enabled on every step, lets Next open field previews, advances exactly once from a preview choice/surface, the same field, or Next, and scrolls the final Catch Up informational targets back to the real page header. Production code, tests, `docs/features/onboarding.md`, and the analytics documentation are the current source of truth; the verification totals above remain the historical execution record.

---

## File map and ownership

- Persistence schema: `backend/db/models.py`, new `backend/db/migrations/versions/20260901_0010_screen_scoped_onboarding.py`.
- Persistence behavior: `backend/services/shared_group_config.py`.
- HTTP contract: `backend/routes/settings_routes.py`, `frontend/src/api/configApi.js`.
- Preference normalization: `frontend/src/settings/groupVisibilityUtils.js`, `frontend/src/settings/groupConfigUtils.js`.
- Pure onboarding state/catalog: `frontend/src/onboarding/onboardingModules.js`, `frontend/src/onboarding/onboardingSteps.js`, `frontend/src/onboarding/useOnboardingTour.js`.
- UI integration: `frontend/src/onboarding/OnboardingTour.jsx`, `frontend/src/eng/EngModeControl.jsx`, `frontend/src/ui/SegmentedControl.jsx` only if required to forward a container data attribute, and `frontend/src/dashboard.jsx`.
- Analytics: `frontend/src/onboarding/onboardingAnalytics.js`, `docs/README_ANALYTICS.md`, and `docs/plans/SUPPORT-ga4-user-configuration.md`.
- Product documentation: `docs/features/onboarding.md`.
- Tests: `tests/test_db_migrations.py`, `tests/test_shared_group_config_service.py`, `tests/test_shared_group_config_routes.py`, `tests/test_group_visibility_utils.js`, `tests/test_frontend_api_source_guards.js`, `tests/test_onboarding_modules.js`, `tests/test_onboarding_tour_utils.js`, `tests/test_onboarding_analytics.js`, `tests/test_analytics_source_guards.js`, `tests/ui/onboarding_tour.spec.js`, and existing structure-budget tests when production entrypoints grow.
- Generated output: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css` only through `npm run build`.

## Canonical contract

```text
module ids, in order:
catch-up, configuration, planning, board, statistics

bootstrap preference:
{
  completedOnboardingModules: string[],
  onboardingDone: boolean // true iff all five canonical ids are complete
}

POST /api/me/onboarding completion:
{ "completedModule": "planning" }

POST /api/me/onboarding compatibility/reset:
{ "onboardingDone": true }  // complete every module for old clients
{ "onboardingDone": false } // clear every module for Replay onboarding

successful response:
{
  "completedOnboardingModules": ["catch-up", "planning"],
  "onboardingDone": false
}
```

Reject mixed payloads, unknown fields, unknown module ids, non-boolean `onboardingDone`, and duplicate/list-shaped client module input. The server returns modules in canonical order and owns deduplication.

---

### Task 1: Persist canonical module completion

**Files:**
- Modify: `backend/db/models.py`
- Create: `backend/db/migrations/versions/20260901_0010_screen_scoped_onboarding.py`
- Modify: `backend/services/shared_group_config.py`
- Test: `tests/test_db_migrations.py`
- Test: `tests/test_shared_group_config_service.py`

- [x] **Step 1: Write failing service tests for normalization and state transitions**

Add tests that require these public helpers and results:

```python
self.assertEqual(
    service.normalize_completed_onboarding_modules(['planning', 'catch-up', 'planning', 'unknown']),
    ['catch-up', 'planning'],
)
self.assertFalse(service.all_onboarding_modules_complete(['catch-up', 'planning']))
self.assertTrue(service.all_onboarding_modules_complete([
    'catch-up', 'configuration', 'planning', 'board', 'statistics',
]))
```

Extend saved-preference tests so a new row has `completedOnboardingModules: []` and `onboardingDone: False`. Add user/workspace-isolation tests for:

```python
saved = service.complete_onboarding_module(context, 'planning', database_url=self.database_url)
self.assertEqual(saved, {
    'completedOnboardingModules': ['planning'],
    'onboardingDone': False,
})
```

Call the same completion twice and require the same canonical response. Add `set_onboarding_done(..., True)` expectations for all five modules and `False` expectations for an empty list.

- [x] **Step 2: Run the focused service tests and verify RED**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service
```

Expected: FAIL because the completed-module column/helpers and response field do not exist.

- [x] **Step 3: Write a failing migration test**

Extend the existing onboarding migration coverage to upgrade from revision `20260829_0009` to head with one `onboarding_done=true` row and one false row. Require the new JSON column to contain all five canonical ids for true and `[]` for false. Require downgrade to remove only `onboarding_completed_modules` and leave `onboarding_done` intact.

- [x] **Step 4: Run the migration test and verify RED**

Run:

```bash
.venv/bin/python -m unittest tests.test_db_migrations
```

Expected: FAIL because revision `20260901_0010` and the column do not exist.

- [x] **Step 5: Implement the model and migration**

Add to `UserGroupPreference`:

```python
onboarding_completed_modules: Mapped[list] = mapped_column(
    JSON,
    nullable=False,
    default=list,
    server_default=text("'[]'"),
)
```

The migration must use an SQLAlchemy table expression with an `sa.JSON()` column to backfill safely on SQLite and PostgreSQL. Canonical completed rows are:

```python
ALL_MODULES = ['catch-up', 'configuration', 'planning', 'board', 'statistics']
```

Add the column with `server_default=sa.text("'[]'")`, update rows whose `onboarding_done` is true to `ALL_MODULES`, and keep false rows empty. Downgrade drops only the new column.

- [x] **Step 6: Implement canonical service helpers and writes**

In `shared_group_config.py`, define one ordered tuple/set and implement:

```python
def normalize_completed_onboarding_modules(values):
    requested = {value for value in values or [] if isinstance(value, str)}
    return [module_id for module_id in ONBOARDING_MODULE_IDS if module_id in requested]

def all_onboarding_modules_complete(values):
    return normalize_completed_onboarding_modules(values) == list(ONBOARDING_MODULE_IDS)
```

Load and normalize `row.onboarding_completed_modules` into every DB preference response. Derive `onboardingDone` from the canonical list. For non-personal/JSON mode return all modules complete. On new preference rows store `[]` and preserve the list on ordinary group-preference saves.

Implement `complete_onboarding_module(context, module_id, database_url=None) -> dict`, validating the canonical id before opening the write session, adding it idempotently, updating the legacy boolean from `all_onboarding_modules_complete`, and returning both fields. Update `set_onboarding_done` so true writes all ids and false writes none, returning the same response object rather than a bare boolean.

- [x] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service tests.test_db_migrations
```

Expected: PASS with no new warnings.

- [x] **Step 8: Diff checkpoint**

Run `git diff --check` and inspect only Task 1 files. Confirm no real user/workspace identifiers, unrelated schema changes, or edits to existing dirty frontend files.

---

### Task 2: Expose a strict module-scoped API contract

**Files:**
- Modify: `backend/routes/settings_routes.py`
- Modify: `frontend/src/api/configApi.js`
- Test: `tests/test_shared_group_config_routes.py`
- Test: `tests/test_frontend_api_source_guards.js`

- [x] **Step 1: Write failing route tests**

Add exact response tests for `{completedModule: 'planning'}`, idempotent repeat, `{onboardingDone: true}`, and `{onboardingDone: false}`. Require both response fields. Add 400 cases for:

```python
{},
{'completedModule': 'scenario'},
{'completedModule': ['planning']},
{'onboardingDone': 'false'},
{'completedModule': 'planning', 'onboardingDone': False},
{'completedModule': 'planning', 'extra': True},
```

Keep existing CSRF, authentication, missing-preference, user isolation, workspace isolation, and sanitized storage-error assertions.

- [x] **Step 2: Run route tests and verify RED**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_routes
```

Expected: FAIL because `completedModule` is rejected and responses lack `completedOnboardingModules`.

- [x] **Step 3: Implement strict route parsing**

Set the allowed fields to `{'onboardingDone', 'completedModule'}`. Require exactly one key. Route `completedModule` to `complete_onboarding_module`; route the boolean to the compatibility/reset setter. Return the canonical response object unchanged. Add a dedicated sanitized `invalid_onboarding_module` 400 response for invalid module type/value; do not echo the submitted value.

- [x] **Step 4: Write failing frontend wrapper tests**

Require two wrappers:

```javascript
await configApi.completeOnboardingModule('http://backend', 'planning');
// POST body: { completedModule: 'planning' }

await configApi.resetOnboardingModules('http://backend');
// POST body: { onboardingDone: false }
```

Verify each performs the existing token-bound CSRF request and preserves structured auth recovery errors. Retain `saveOnboardingPreference(backendUrl, onboardingDone)` as a compatibility wrapper if source guards or existing tests still consume it, but production module completion must not call it with `true`.

- [x] **Step 5: Run wrapper tests and verify RED**

Run:

```bash
node --test tests/test_frontend_api_source_guards.js
```

Expected: FAIL because the new wrappers do not exist.

- [x] **Step 6: Implement wrappers and verify GREEN**

Use the existing `postJsonWithCsrf` and `jsonOrStructuredError` path; do not duplicate the endpoint literal outside `configApi.js`.

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_routes
node --test tests/test_frontend_api_source_guards.js
```

Expected: both commands PASS.

- [x] **Step 7: Diff checkpoint**

Inspect Task 2 files and run `git diff --check`.

---

### Task 3: Make onboarding state and catalogs surface-scoped

**Files:**
- Modify: `frontend/src/settings/groupVisibilityUtils.js`
- Modify: `frontend/src/settings/groupConfigUtils.js`
- Modify: `frontend/src/onboarding/onboardingModules.js`
- Modify: `frontend/src/onboarding/onboardingSteps.js`
- Modify: `frontend/src/onboarding/useOnboardingTour.js`
- Test: `tests/test_group_visibility_utils.js`
- Test: `tests/test_onboarding_modules.js`
- Test: `tests/test_onboarding_tour_utils.js`

- [x] **Step 1: Write failing preference-normalization tests**

Require missing arrays to normalize to all modules only when `onboardingDone === true`, otherwise `[]`; require unknown and duplicate ids to be removed in canonical order; require `onboardingDone` to be derived from the normalized list when the array is present.

- [x] **Step 2: Write failing catalog tests**

Replace the existing launcher expectations with this Catch Up tail:

```javascript
['jira-export', 'settings-info', 'eng-mode-info', 'complete']
```

Require both new steps to use `progression: 'manual'`, contain no `moduleId`, and use selectors for `settings-launcher` and `eng-mode-control`. Require the Catch Up copy to describe managing Departments and switching tools without imperatives to open another screen.

Keep one destination-specific manual step each for Configuration, Planning, Board, and Statistics.

- [x] **Step 3: Write failing pure controller/module tests**

Define expectations for:

```javascript
isOnboardingModuleComplete(completed, 'catch-up')
nextOnboardingModuleRequest({ run: false, completedModules: ['catch-up'] }, 'planning')
```

The request must open only known incomplete modules, ignore replay of completed modules, and support Catch Up as a real module. Finishing/skipping returns the current module id to persistence and closes the session; it must not require all five modules or resume Catch Up. Closing an unfinished contextual surface closes/interrupts the session without adding completion.

- [x] **Step 4: Run focused Node tests and verify RED**

Run:

```bash
node --test tests/test_group_visibility_utils.js tests/test_onboarding_modules.js tests/test_onboarding_tour_utils.js
```

Expected: FAIL on the old global/module-launch behavior.

- [x] **Step 5: Implement canonical frontend normalization**

Export one frozen `ONBOARDING_MODULE_IDS` list from `onboardingModules.js` and helpers that preserve its order. In preference normalization, use the server array when present; use legacy `onboardingDone` only as fallback. Ensure local non-DB mode remains fully complete.

- [x] **Step 6: Replace Catch Up launchers with informational steps**

Delete `launch-configuration`, `launch-planning`, `launch-board`, and `launch-statistics`. Add:

```javascript
{
  id: 'settings-info',
  progression: 'manual',
  selectors: [target('settings-launcher')],
  title: 'Manage Departments in Settings',
  body: 'Use Settings when you want to add or manage Departments.',
}
{
  id: 'eng-mode-info',
  progression: 'manual',
  selectors: [target('eng-mode-control')],
  title: 'Switch tools here',
  body: 'Use this control to switch between Catch Up, Planning, Board, Statistics, and Scenario.',
}
```

Keep `complete` as the Catch Up finish step. Remove launcher insertion and unavailable-module acknowledgement paths made obsolete by the new model.

- [x] **Step 7: Refactor controller/tour state minimally**

Pass `completedModules` into the controller. Automatic startup opens Catch Up only if incomplete. `requestModule(moduleId)` sets `run=true`, creates a nonce request, and tracks a start only when the module is known and incomplete. Completion/skip callbacks receive the current `moduleId`, persist it, merge the server's canonical list through `setCompletedModules`, and close/reset only the active module.

Replay calls the reset wrapper, updates the local list to `[]`, closes Settings, prepares Catch Up, and starts Catch Up. Remove `allRequiredOnboardingModulesComplete` as a finish gate. A contextual module's final Next calls the same persisted finish path; it must not return to a Catch Up launcher.

- [x] **Step 8: Run focused Node tests and verify GREEN**

Run:

```bash
node --test tests/test_group_visibility_utils.js tests/test_onboarding_modules.js tests/test_onboarding_tour_utils.js
```

Expected: PASS.

- [x] **Step 9: Diff checkpoint**

Run `git diff --check`; inspect for dead launcher/session code and ensure no programmatic click or forced navigation was added.

---

### Task 4: Wire real surfaces and module-scoped analytics

**Files:**
- Modify: `frontend/src/onboarding/OnboardingTour.jsx`
- Modify: `frontend/src/eng/EngModeControl.jsx`
- Modify: `frontend/src/ui/SegmentedControl.jsx` only if container props are not already supported
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/onboarding/onboardingAnalytics.js`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/SUPPORT-ga4-user-configuration.md`
- Test: `tests/test_onboarding_analytics.js`
- Test: `tests/test_analytics_source_guards.js`
- Test: `tests/test_onboarding_tour_utils.js`
- Test: relevant structure-budget tests

- [x] **Step 1: Write failing analytics tests**

Require:

```javascript
buildOnboardingAnalyticsArgs('started', 'first_run', 'catch-up')
// ['onboarding', 'started', { source_surface: 'first_run', module_id: 'catch-up' }]
```

Completed/skipped add `result: 'success'`. Reject unknown module ids. Update source guards to require a typed `module_id` and preserve `pageview`/`userevent`; no new event name or boolean presence dimension.

- [x] **Step 2: Write failing integration source tests**

Require `EngModeControl` to expose `data-onboarding-target="eng-mode-control"` on the whole segmented-control element, not individual buttons. Require dashboard controller props for `completedOnboardingModules`, module-scoped completion/reset wrappers, and real-surface request calls for Configuration, Planning, Board, and Statistics. Require the scenario button to remain outside onboarding modules.

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests/test_onboarding_analytics.js tests/test_analytics_source_guards.js tests/test_onboarding_tour_utils.js
```

Expected: FAIL on missing `module_id`, whole-control target, and new controller wiring.

- [x] **Step 4: Implement analytics and documentation contract**

Change analytics builder/emitter signatures to accept `moduleId`, validate against canonical ids, and add `module_id`. Document the parameter in the existing onboarding taxonomy/runbook entries. Do not register all module values as separate custom dimensions and do not change the GTM trigger names.

- [x] **Step 5: Implement whole-control targeting**

Prefer a `containerProps`/`domProps` passthrough already supported by `SegmentedControl`. If absent, add the smallest generic `containerProps` prop and spread it exactly once on the radiogroup root. In `EngModeControl`, pass `data-onboarding-target="eng-mode-control"` to that root. Keep existing button launcher attributes only if other tests/features still consume them; onboarding must not depend on them.

- [x] **Step 6: Wire dashboard preferences and surfaces**

Pass the canonical completion array from `groupPreferences` to the controller and tour. Replace global setters with a canonical response merge:

```javascript
setGroupPreferences((current) => ({
  ...current,
  completedOnboardingModules: payload.completedOnboardingModules,
  onboardingDone: payload.onboardingDone,
}));
```

Configuration requests its module immediately before the real Settings open. Planning/Board/Statistics request theirs after the mode state changes, using the existing normal click path. Catch Up automatic startup must not call `applyEngMode` or click anything. The tour component renders the active module and persists Finish/Skip for that module only.

- [x] **Step 7: Run focused tests and structure budgets**

Run:

```bash
node --test tests/test_onboarding_analytics.js tests/test_analytics_source_guards.js tests/test_onboarding_tour_utils.js tests/test_codebase_structure_budgets.js
```

Expected: PASS. If a legacy structure budget is exceeded only by required integration lines, ratchet the specific existing budget by the exact justified delta and document it in the test.

- [x] **Step 8: Diff checkpoint**

Inspect all Task 4 files. Confirm no unrelated dashboard refactor, no new analytics event, and no raw auth error path.

---

### Task 5: Prove independent first-open tours in the browser

**Files:**
- Modify: `tests/ui/onboarding_tour.spec.js`
- Modify: `tests/ui/shared_department_groups.spec.js` only if the real bootstrap fixture must expose the new preference field
- Modify: `docs/features/onboarding.md`

- [x] **Step 1: Update the harness contract and write failing browser tests**

Make harness preference writes return the canonical response. Add one serial journey that:

1. Boots with `completedOnboardingModules: []` on Catch Up.
2. Advances through Catch Up and asserts the URL/surface never changes.
3. Verifies Settings and `.segmented-control.eng-mode-control` are pointed out without a forced click.
4. Finishes Catch Up and observes exactly `{completedModule: 'catch-up'}`.
5. Opens Planning normally and sees only `data-onboarding-module="planning"`; finish and assert only Planning is added.
6. Repeats first-open behavior for Board, Statistics, and Configuration.
7. Returns to each completed surface and asserts no tour.
8. Replays onboarding, asserts `{onboardingDone: false}`, and sees Catch Up again.

Add an interrupted-module case: open Planning, close/return before completion, reopen Planning, and require its tour to restart without a write. Add a failed module completion response and require the tour to remain visible/retryable. Never use `click({ force: true })`.

- [x] **Step 2: Run selected Playwright tests and verify RED**

Run the exact new test names first:

```bash
npx playwright test tests/ui/onboarding_tour.spec.js --grep "screen-scoped|unfinished module|module completion failure"
```

Expected: FAIL on the current cross-screen flow and boolean-only writes.

- [x] **Step 3: Update product documentation**

Replace the cross-screen contextual-launch sequence in `docs/features/onboarding.md` with independent first-open semantics, module persistence, per-module skip/finish, replay-all behavior, and the Catch Up Settings/mode-control informational steps. Preserve the mobile deferral and non-mutating Configuration statements where still accurate.

- [x] **Step 4: Run the complete onboarding browser spec**

Run:

```bash
npx playwright test tests/ui/onboarding_tour.spec.js
```

Expected: PASS with no forced interactions and no console/page errors.

- [x] **Step 5: Capture visual evidence**

Using the existing Playwright screenshot conventions, capture stable desktop screenshots after animations settle for the Catch Up Settings step, Catch Up mode-control step, and one contextual module. Store only in the repository's existing screenshot/output location if already tracked by the workflow; otherwise report the test artifacts without adding binaries.

- [x] **Step 6: Diff checkpoint**

Run `git diff --check`; verify documentation matches the browser behavior and no real Jira data appears in fixtures or screenshots.

---

### Task 6: Build and full verification

**Files:**
- Generated: `frontend/dist/dashboard.js`
- Generated: `frontend/dist/dashboard.js.map`
- Generated: `frontend/dist/dashboard.css` when build output changes it
- Update: both feature artifacts' status/outcome sections after all gates pass

- [x] **Step 1: Run the complete focused regression set**

```bash
node --test \
  tests/test_group_visibility_utils.js \
  tests/test_frontend_api_source_guards.js \
  tests/test_onboarding_modules.js \
  tests/test_onboarding_tour_utils.js \
  tests/test_onboarding_analytics.js \
  tests/test_analytics_source_guards.js
.venv/bin/python -m unittest \
  tests.test_db_migrations \
  tests.test_shared_group_config_service \
  tests.test_shared_group_config_routes
```

Expected: all tests PASS.

- [x] **Step 2: Build generated frontend output**

```bash
npm run build
```

Expected: exit 0. Do not hand-edit `frontend/dist/`.

- [x] **Step 3: Run preflight and server smoke test**

```bash
.venv/bin/python scripts/check_startup_preflight.py
```

Then launch `.venv/bin/python jira_server.py` using the established background command and verify:

```bash
curl http://localhost:5050/api/test
```

Expected: preflight passes, startup has no dependency/runtime warning before the Flask banner, and `/api/test` returns success. Stop only the verified spawned process id.

- [x] **Step 4: Run full automated suites**

```bash
python3 -m unittest discover -s tests
npx playwright test tests/ui/onboarding_tour.spec.js
```

Expected: zero failures. Read complete output and investigate any failure before proceeding.

- [x] **Step 5: Inspect final diff and generated-output cleanliness**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- frontend/src frontend/dist backend tests docs/features docs/README_ANALYTICS.md docs/agents/features
```

Confirm every changed line traces to this request or was an unrelated pre-existing change preserved intact. Confirm the build produced the only `frontend/dist/` changes attributable to this feature.

- [x] **Step 6: Final independent review**

Dispatch a fresh spec-compliance reviewer against the approved design and this plan, then a fresh code-quality reviewer. Resolve every Critical or Important issue and rerun the affected verification commands.

- [x] **Step 7: Close artifacts without committing**

Rename this plan to `2026-09-01-executed-screen-scoped-onboarding-implementation.md`, set `Status: executed`, and record actual commands/results under `Outcome` and `Current Accuracy`. Update the design artifact's Outcome/Current Accuracy to point to shipped code as source of truth. Do not commit or push without explicit user confirmation.
