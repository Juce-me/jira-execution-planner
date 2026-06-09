# Planning Defaults, Shared Excluded Capacity, And Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Future ENG Planning sprint scopes with no saved selection should default to Select All, Planning/Reporting excluded-capacity toggles should update the selected group's shared DB-backed configuration, and users should have one-click Undo for bulk Planning selection changes.

**Architecture:** Keep Planning task selection client-side because it is already scoped and persisted in browser storage by sprint and group. Extend the stored planning-selection state with a small `selectionMode` flag so future sprints can stay in `default_all` mode until the user makes a manual/status/clear selection, while `Select All` restores that mode. Move epic Included/Excluded toggles for Planning and Reporting to the existing shared `/api/groups-config` catalog write path, where `excludedCapacityEpics` is already a group property persisted in DB by workspace and guarded by `configRevision`; remove local `excludedStatsEpics` from active capacity math. Capture a non-persistent loaded-page baseline per planning scope in `dashboard.jsx`; bulk action Undo restores that baseline and then disables itself.

**Tech Stack:** React 19, browser `localStorage`, existing ENG Planning and Statistics components, shared group configuration API, Node `node:test`, Python `unittest`, Playwright, esbuild via `npm run build`.

---

## Assumptions And Scope

- "Future sprint" means the selected sprint object has `state === 'future'`, using the existing `isFutureSprintSelected` flag in `frontend/src/dashboard.jsx`.
- "Each new future sprint" means a sprint/group planning scope where `hasPlanningState(window.localStorage, planningScopeKey)` is false.
- Manual checkbox clicks switch the scope to manual selection persistence. New tasks discovered later are not auto-selected in manual mode.
- Clicking `Select All` on a future sprint switches the scope back to `default_all`, so newly loaded valid tasks in that future sprint are selected too.
- Undo is single-level and restores the selection state captured after the current sprint/group page finished loading. It does not create a multi-step history stack.
- Excluded capacity belongs to the selected group through `group.excludedCapacityEpics`; it is not a per-user UI preference once this plan is implemented.
- Users who can save shared group configuration can check/uncheck an epic's excluded-capacity state from Planning or Reporting. The change writes to the existing `/api/groups-config` route, updates DB-backed workspace group config in DB/OAuth mode, and applies to every user who can access that group after refresh/reload.
- The old `excludedStatsEpics` local preference may remain ignored for backward compatibility with existing localStorage payloads, but it must not feed Planning capacity or Reporting excluded-capacity state.
- No new backend routes, Jira writes, or Home/Townsquare APIs are part of this change. The plan reuses the existing shared group configuration route.
- Analytics uses the existing `planning_action` event with a new `workflow_action=undo_selection`; no new event name or parameter is needed.
- Excluded-capacity group toggles use the existing `settings_action` event with `section=departments`, `workflow_action=toggle_excluded_capacity`, `source_surface=planning|statistics`, `value_state=selected|cleared`, and result events with `result=success|failure`; no new event name or parameter is needed.

## Endpoint Contract Matrix

| Route | Auth And Boundary | CSRF / X-Requested-With | Request Body | Success Body | Error Bodies | Required Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/groups-config` | Existing authenticated settings read. In DB/OAuth mode the shared catalog is scoped by current `workspace_id` from the active Atlassian connection; JSON mode falls back to dashboard config. | Safe read; no CSRF token required. | None. | `{ version, configRevision, source, groups, defaultGroupId, preferences, warnings? }`; each group may include `excludedCapacityEpics`. | Existing auth/config errors from `backend/routes/settings_routes.py`. | Existing `tests.test_shared_group_config_routes.SharedGroupConfigRouteTests.test_get_groups_config_imports_shared_catalog_and_requires_first_run`; Task 4 adds cross-user `excludedCapacityEpics` persistence coverage. |
| `POST /api/groups-config` | Existing authenticated shared group write. DB/OAuth mode saves the selected workspace's `WorkspaceGroupConfig` row through `backend/services/shared_group_config.py`; no user-owned preference row owns `excludedCapacityEpics`. | Must use `requestSaveGroupsConfig`, which calls `postJsonWithCsrf` and sends token-bound CSRF plus `X-Requested-With: jira-execution-planner`. | `buildSharedGroupsPayload(nextGroupsConfig)`: `{ version, baseRevision, groups, defaultGroupId }`; `groups[*].excludedCapacityEpics` is the only changed field for inline Included/Excluded toggles. | `{ version, configRevision, source, groups, defaultGroupId, preferences, warnings? }` with incremented `configRevision`. | `409 { error: 'group_config_conflict', current }` reloads the latest shared catalog; `400 unsupported_group_config_field`; `400 team_groups_cannot_be_cleared_implicitly`; route auth/CSRF failures from existing policy. | Existing revision and spoofing tests in `tests.test_shared_group_config_routes`; Task 4 adds route coverage that another user sees the saved `excludedCapacityEpics`; `tests/test_excluded_capacity_stats_source_guards.js` asserts the frontend uses `requestSaveGroupsConfig`. |
| `POST /api/groups-preferences` | Existing authenticated per-user department visibility write. It must not mutate the shared group catalog or `excludedCapacityEpics`. | Must use existing CSRF and `X-Requested-With` behavior for unsafe browser writes. | `{ visibleGroupIds, activeGroupId }`. | `{ preferences }`; shared groups unchanged. | `409 group_preferences_db_required` in JSON mode; `400 unsupported_group_preference_field`; route auth/CSRF failures from existing policy. | Existing `test_post_group_preferences_saves_user_visibility_without_catalog_change`; Task 4 extends the shared route test to save preferences after an excluded-capacity write and assert the group flag is unchanged. |

## State Machine Checklist

- Initial load: active Planning/Reporting capacity derives `excludedEpicSet` only from `activeGroup.excludedCapacityEpics`; legacy `excludedStatsEpics` localStorage is ignored.
- Inline Included/Excluded click: handler validates epic key, active group id, shared-config permission, and no open dirty Settings group draft before building the next shared group payload.
- Save in flight: `requestSaveGroupsConfig(BACKEND_URL, buildSharedGroupsPayload(nextGroupsConfig))` sends the current `configRevision` as `baseRevision`; no local optimistic state is applied before the server accepts the save.
- Save success: returned payload flows through one shared `applySavedGroupsConfig` helper that updates `groupsConfig`, `groupPreferences`, `groupDraft`, `groupDraftBaselineRef`, warnings/source, active group id, Planning capacity, and Reporting filters.
- Save failure: non-409 errors keep the current rendered state and show `groupDraftError`; analytics emits `toggle_excluded_capacity_result` with `result=failure`.
- Revision conflict: `409 group_config_conflict` applies `current` through `applySavedGroupsConfig`, shows a retryable message, clears stale cache, and does not silently replay the user's toggle against the new version.
- Dirty Settings draft: if the Department settings modal is open and `isGroupDraftDirty` is true, the inline Planning/Reporting toggle is disabled and the handler also refuses the save path; users must save or discard the Settings draft first.
- Reload or user switch: the next `GET /api/groups-config` returns the shared DB value for the selected workspace, so any user with group access sees the same `excludedCapacityEpics`.
- Group/sprint switch: group state snapshots no longer carry `excludedStatsEpics`; switching groups recomputes excluded capacity from the newly active group's shared config.
- Auth-expired recovery: no new route is introduced; existing auth/CSRF recovery for `/api/groups-config` remains the source of truth.

## File Map

- Modify: `frontend/src/planningSelectionState.mjs`
  - Add `selectionMode` normalization and an exported resolver for future default selection.
  - Keep backwards compatibility with existing stored states that only have `selectedTaskKeys` and `selectedTeams`.
- Modify: `tests/test_planning_selection_state.js`
  - Cover default-all future hydration, manual preservation, and Select All returning to default-all mode.
- Modify: `frontend/src/dashboard.jsx`
  - Track `planningSelectionMode`.
  - Apply future default selection after tasks load.
  - Save `selectionMode` with selected task keys.
  - Replace local `excludedStatsEpics` capacity state with shared `activeGroup.excludedCapacityEpics` state.
  - Save epic Included/Excluded toggles through `/api/groups-config` using the current group `configRevision`.
  - Capture loaded-page undo baseline per planning scope.
  - Mark Undo available after bulk actions and restore baseline on Undo.
- Modify: `frontend/src/eng/PlanningActionBar.jsx`
  - Add an Undo button beside existing bulk selection controls.
- Modify: `frontend/src/settings/groupConfigUtils.js`
  - Add a pure helper for toggling one epic key in one group's shared `excludedCapacityEpics`.
- Modify: `tests/test_shared_group_config_routes.py`
  - Guard that `excludedCapacityEpics` saved through `/api/groups-config` is shared across users and not changed by `/api/groups-preferences`.
- Create: `tests/test_group_config_utils.js`
  - Cover the shared group excluded-capacity toggle helper.
- Modify: `tests/test_excluded_capacity_stats_source_guards.js`
  - Guard that Planning/Reporting excluded capacity comes from shared group config, not local `excludedStatsEpics`.
- Modify: `tests/test_planning_action_source_guards.js`
  - Guard the Undo button, props, and dashboard handler wiring.
- Create: `tests/ui/planning_selection_defaults.spec.js`
  - Verify future default Select All, manual checkbox persistence, Select All reset, Undo behavior, and shared group excluded-capacity toggles in the rendered app.
- Modify: `docs/README_ANALYTICS.md`
  - Update the `planning_action` row to include Undo as an existing Planning action.
  - Update the `settings_action` row to include Planning/Reporting group excluded-capacity toggles as shared department configuration changes.
- Regenerate: `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map`
  - Run `npm run build`; do not hand-edit generated output.

---

## Task 1: Extend Planning Selection State Helpers

**Files:**
- Modify: `frontend/src/planningSelectionState.mjs`
- Modify: `tests/test_planning_selection_state.js`

- [ ] **Step 1: Add failing tests for future default selection modes**

Append these tests to `tests/test_planning_selection_state.js`:

```js
test('future planning scopes without stored state default to all valid tasks', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: false,
            storedState: null,
            isFutureSprint: true,
            validTaskKeys: new Set(['PLAN-2', 'PLAN-1']),
            validTeamIds: new Set(['team-a'])
        }),
        {
            selectedTaskKeys: ['PLAN-1', 'PLAN-2'],
            selectedTeams: ['all'],
            selectedTeamId: 'all',
            selectionMode: 'default_all'
        }
    );
});

test('future planning manual mode preserves clicked task state', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: true,
            storedState: {
                selectedTaskKeys: ['PLAN-2'],
                selectedTeams: ['team-a'],
                selectionMode: 'manual'
            },
            isFutureSprint: true,
            validTaskKeys: new Set(['PLAN-1', 'PLAN-2', 'PLAN-3']),
            validTeamIds: new Set(['team-a'])
        }),
        {
            selectedTaskKeys: ['PLAN-2'],
            selectedTeams: ['team-a'],
            selectedTeamId: 'team-a',
            selectionMode: 'manual'
        }
    );
});

test('future planning default all mode reselects new valid tasks', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: true,
            storedState: {
                selectedTaskKeys: ['PLAN-1'],
                selectedTeams: ['all'],
                selectionMode: 'default_all'
            },
            isFutureSprint: true,
            validTaskKeys: new Set(['PLAN-1', 'PLAN-2']),
            validTeamIds: new Set(['team-a'])
        }).selectedTaskKeys,
        ['PLAN-1', 'PLAN-2']
    );
});

test('active planning scopes without stored state keep the current empty selection default', async () => {
    const {
        resolvePlanningSelectionState
    } = await import('../frontend/src/planningSelectionState.mjs');

    assert.deepEqual(
        resolvePlanningSelectionState({
            hasStoredState: false,
            storedState: null,
            isFutureSprint: false,
            validTaskKeys: new Set(['PLAN-1']),
            validTeamIds: new Set(['team-a'])
        }).selectedTaskKeys,
        []
    );
});
```

- [ ] **Step 2: Run the helper tests and confirm they fail**

Run:

```bash
node --test tests/test_planning_selection_state.js
```

Expected: FAIL with `resolvePlanningSelectionState` missing or not exported.

- [ ] **Step 3: Add mode-aware helper implementation**

In `frontend/src/planningSelectionState.mjs`, add these constants near `PLANNING_STORAGE_KEY`:

```js
export const PLANNING_SELECTION_MODE_MANUAL = 'manual';
export const PLANNING_SELECTION_MODE_DEFAULT_ALL = 'default_all';

function normalizeSelectionMode(value) {
    return value === PLANNING_SELECTION_MODE_DEFAULT_ALL
        ? PLANNING_SELECTION_MODE_DEFAULT_ALL
        : PLANNING_SELECTION_MODE_MANUAL;
}
```

Update `normalizePlanningState` to include `selectionMode`:

```js
function normalizePlanningState(storedState) {
    const selectedTeams = normalizeTeamIdList(storedState?.selectedTeams ?? storedState?.selectedTeamId ?? 'all');
    return {
        selectedTaskKeys: normalizeKeyList(storedState?.selectedTaskKeys),
        selectedTeams,
        selectedTeamId: selectedTeams.length === 1 ? selectedTeams[0] : selectedTeams[0] || 'all',
        selectionMode: normalizeSelectionMode(storedState?.selectionMode)
    };
}
```

Update `normalizeStoredScopeState` to persist `selectionMode`:

```js
function normalizeStoredScopeState(storedState) {
    const normalized = normalizePlanningState(storedState);
    return {
        selectedTaskKeys: normalized.selectedTaskKeys,
        selectedTeams: normalized.selectedTeams,
        selectedTeamId: normalized.selectedTeamId,
        selectionMode: normalized.selectionMode
    };
}
```

Update `normalizeReconciledPlanningState` to return `selectionMode`:

```js
    return {
        selectedTaskKeys,
        selectedTeams: nextSelectedTeams,
        selectedTeamId,
        selectionMode: normalized.selectionMode
    };
```

Add this exported resolver after `reconcilePlanningSelection`:

```js
export function resolvePlanningSelectionState({
    hasStoredState = false,
    storedState,
    isFutureSprint = false,
    validTaskKeys = new Set(),
    validTeamIds = new Set()
} = {}) {
    const validTaskKeySet = toSet(validTaskKeys);
    const allValidTaskKeys = Array.from(validTaskKeySet)
        .map(toTrimmedString)
        .filter(Boolean)
        .sort();
    const reconciled = reconcilePlanningSelection(storedState, {
        validTaskKeys: validTaskKeySet,
        validTeamIds
    });
    const selectionMode = hasStoredState
        ? reconciled.selectionMode
        : (isFutureSprint ? PLANNING_SELECTION_MODE_DEFAULT_ALL : PLANNING_SELECTION_MODE_MANUAL);
    const selectedTaskKeys = isFutureSprint && selectionMode === PLANNING_SELECTION_MODE_DEFAULT_ALL
        ? allValidTaskKeys
        : reconciled.selectedTaskKeys;

    return {
        ...reconciled,
        selectedTaskKeys,
        selectionMode
    };
}
```

- [ ] **Step 4: Run helper tests and confirm they pass**

Run:

```bash
node --test tests/test_planning_selection_state.js
```

Expected: PASS.

- [ ] **Step 5: Commit the helper slice**

```bash
git add frontend/src/planningSelectionState.mjs tests/test_planning_selection_state.js
git commit -m "Add planning selection default mode helpers"
```

---

## Task 2: Wire Future Default Selection And Loaded-Page Undo Baseline

**Files:**
- Modify: `frontend/src/dashboard.jsx`

- [ ] **Step 1: Update imports and Planning state**

Change the planning selection import near the top of `frontend/src/dashboard.jsx` to include the new helpers:

```js
import {
    PLANNING_SELECTION_MODE_DEFAULT_ALL,
    PLANNING_SELECTION_MODE_MANUAL,
    buildPlanningScopeKey,
    hasPlanningState,
    loadPlanningState,
    resolvePlanningSelectionState,
    resolvePlanningTeamSelection,
    savePlanningState
} from './planningSelectionState.mjs';
```

Add state near the existing `selectedTasks` state:

```js
const [planningSelectionMode, setPlanningSelectionMode] = useState(PLANNING_SELECTION_MODE_MANUAL);
const [canUndoPlanningSelection, setCanUndoPlanningSelection] = useState(false);
```

Add refs near the other Planning/group refs:

```js
const planningLoadedSelectionRef = useRef(null);
const planningBaselineScopeRef = useRef('');
```

- [ ] **Step 2: Preserve `selectionMode` through group state snapshots**

In `buildDefaultGroupState`, include `selectionMode` from stored planning state:

```js
const selectionModeFromPlanning = hasStoredPlanningState
    ? (planningState?.selectionMode || PLANNING_SELECTION_MODE_MANUAL)
    : (isFutureSprintSelected ? PLANNING_SELECTION_MODE_DEFAULT_ALL : PLANNING_SELECTION_MODE_MANUAL);
```

Return it in the default group state:

```js
planningSelectionMode: selectionModeFromPlanning,
```

In `buildGroupStateSnapshot`, add:

```js
planningSelectionMode,
```

In `applyGroupState`, set it:

```js
setPlanningSelectionMode(nextState.planningSelectionMode || PLANNING_SELECTION_MODE_MANUAL);
setCanUndoPlanningSelection(false);
```

Add `planningSelectionMode` to the `groupStateSnapshot` dependency list.

- [ ] **Step 3: Replace the persistence effect selection derivation**

In the existing effect that starts with `if (!planningScopeKey || !activeGroupId || selectedSprint === null) return;` after `const selectionTasks = baseFilteredTasks;`, replace the selected-key derivation with:

```js
const storedPlanningState = loadPlanningState(window.localStorage, planningScopeKey);
const hasStoredPlanningState = hasPlanningState(window.localStorage, planningScopeKey);
const currentPlanningState = {
    selectedTaskKeys: Object.keys(selectedTasks || {}).filter(key => selectedTasks[key]),
    selectedTeams,
    selectionMode: planningSelectionMode
};
const resolvedPlanningState = resolvePlanningSelectionState({
    hasStoredState: hasStoredPlanningState,
    storedState: hasStoredPlanningState ? storedPlanningState : currentPlanningState,
    isFutureSprint: isFutureSprintSelected,
    validTaskKeys: validTaskKeySet,
    validTeamIds: new Set(validTeamIds)
});
const nextSelectedTaskKeys = resolvedPlanningState.selectedTaskKeys;
const nextSelectionMode = resolvedPlanningState.selectionMode;
```

Keep the existing `nextSelectedTeams` calculation, then update the state setters to use the resolved values:

```js
setSelectedTasks(prev => {
    const prevKeys = Object.keys(prev || {})
        .filter(key => prev[key] && validTaskKeySet.has(key))
        .sort();
    const sameLength = prevKeys.length === nextSelectedTaskKeys.length;
    const sameKeys = sameLength && prevKeys.every((key, index) => key === nextSelectedTaskKeys[index]);
    return sameKeys ? prev : selectedTaskMapFromKeys(nextSelectedTaskKeys);
});

setPlanningSelectionMode(prev => prev === nextSelectionMode ? prev : nextSelectionMode);
```

Save mode with the existing state:

```js
savePlanningState(window.localStorage, planningScopeKey, {
    selectedTaskKeys: nextSelectedTaskKeys,
    selectedTeams: nextSelectedTeams,
    selectionMode: nextSelectionMode
});
```

Capture the loaded-page baseline inside this same effect, after `nextSelectedTaskKeys` is known:

```js
if (planningBaselineScopeRef.current !== planningScopeKey) {
    planningLoadedSelectionRef.current = {
        scopeKey: planningScopeKey,
        selectedTasks: selectedTaskMapFromKeys(nextSelectedTaskKeys),
        selectionMode: nextSelectionMode
    };
    planningBaselineScopeRef.current = planningScopeKey;
    setCanUndoPlanningSelection(false);
}
```

Add `isFutureSprintSelected` and `planningSelectionMode` to the effect dependency list.

- [ ] **Step 4: Mark manual and bulk selection modes explicitly**

Update `toggleTaskSelection` so checkbox clicks become manual state:

```js
setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
setSelectedTasks(newSelected);
```

Add this helper before the bulk action handlers:

```js
const markPlanningBulkSelectionChanged = () => {
    if (planningLoadedSelectionRef.current?.scopeKey === planningScopeKey) {
        setCanUndoPlanningSelection(true);
    }
};
```

Update bulk handlers:

```js
const clearSelectedTasks = () => {
    markPlanningBulkSelectionChanged();
    setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
    setSelectedTasks({});
    trackPlanningSelection('clear_selection', {}, selectionTasks);
};

const selectAllVisiblePlanningTasks = () => {
    markPlanningBulkSelectionChanged();
    const next = {};
    visibleTasksForList.forEach(task => {
        if (task?.key) {
            next[task.key] = true;
        }
    });
    setPlanningSelectionMode(isFutureSprintSelected ? PLANNING_SELECTION_MODE_DEFAULT_ALL : PLANNING_SELECTION_MODE_MANUAL);
    setSelectedTasks(next);
    trackPlanningSelection('select_all_visible', next, selectionTasks);
};
```

In `toggleIncludeByStatus`, call `markPlanningBulkSelectionChanged()` before mutating and set manual mode:

```js
markPlanningBulkSelectionChanged();
setPlanningSelectionMode(PLANNING_SELECTION_MODE_MANUAL);
```

Apply the same manual-mode rule to `selectPlanningTasksByStatus` and `includePlanningTasksByStatus` if they still have callers. If they are dead after inspection with `rg "selectPlanningTasksByStatus|includePlanningTasksByStatus" frontend/src/dashboard.jsx`, delete them in this task only if they are truly unreferenced.

- [ ] **Step 5: Add the Undo handler**

Add this handler near the selection handlers:

```js
const undoPlanningSelectionChange = () => {
    const baseline = planningLoadedSelectionRef.current;
    if (!baseline || baseline.scopeKey !== planningScopeKey) return;
    const nextSelectedTasks = baseline.selectedTasks || {};
    const nextSelectionMode = baseline.selectionMode || PLANNING_SELECTION_MODE_MANUAL;
    setSelectedTasks(nextSelectedTasks);
    setPlanningSelectionMode(nextSelectionMode);
    setCanUndoPlanningSelection(false);
    trackPlanningSelection('undo_selection', nextSelectedTasks, selectionTasks);
};
```

- [ ] **Step 6: Run focused source tests**

Run:

```bash
node --test tests/test_planning_selection_state.js tests/test_planning_action_source_guards.js
```

Expected: PASS after Task 3 updates the source guards. At this point in Task 2, `tests/test_planning_action_source_guards.js` may still fail until the Undo UI is added.

- [ ] **Step 7: Commit the dashboard behavior slice**

```bash
git add frontend/src/dashboard.jsx
git commit -m "Wire planning future selection defaults"
```

---

## Task 3: Add Planning Undo UI And Analytics Contract Update

**Files:**
- Modify: `frontend/src/eng/PlanningActionBar.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_planning_action_source_guards.js`
- Modify: `docs/README_ANALYTICS.md`

- [ ] **Step 1: Add failing source guards for the Undo control**

Append to `tests/test_planning_action_source_guards.js`:

```js
test('planning action row exposes undo for bulk selection changes', () => {
    const sourcePath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const componentPath = path.resolve(__dirname, '../frontend/src/eng/PlanningActionBar.jsx');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const componentSource = fs.readFileSync(componentPath, 'utf8');

    assert.match(source, /const undoPlanningSelectionChange = \(\) => \{/);
    assert.match(source, /canUndoPlanningSelection=\{canUndoPlanningSelection\}/);
    assert.match(source, /onUndoPlanningSelection=\{undoPlanningSelectionChange\}/);
    assert.match(source, /trackPlanningSelection\('undo_selection'/);
    assert.match(componentSource, /canUndoPlanningSelection/);
    assert.match(componentSource, /onUndoPlanningSelection/);
    assert.match(componentSource, /disabled=\{!canUndoPlanningSelection\}/);
    assert.match(componentSource, />\s*Undo\s*</);
});
```

Run:

```bash
node --test tests/test_planning_action_source_guards.js
```

Expected: FAIL because the Undo button is not wired yet.

- [ ] **Step 2: Add Undo props and button**

Update the `PlanningActionBar` signature:

```jsx
    canUndoPlanningSelection,
    onUndoPlanningSelection,
```

Place this button after `Select All` and before `Clear Selected`:

```jsx
            <button
                className="planning-action-button"
                onClick={onUndoPlanningSelection}
                disabled={!canUndoPlanningSelection}
                title="Undo bulk selection changes and restore the loaded planning selection"
            >
                Undo
            </button>
```

Pass the props from `dashboard.jsx`:

```jsx
                            canUndoPlanningSelection={canUndoPlanningSelection}
                            onUndoPlanningSelection={undoPlanningSelectionChange}
```

- [ ] **Step 3: Update the analytics contract**

In `docs/README_ANALYTICS.md`, update the `planning_action` trigger description from:

```md
Task select, bulk select, or include-state change
```

to:

```md
Task select, bulk select, include-state change, or Planning selection undo
```

No `frontend/src/analytics/events.js` change is needed because `workflow_action` already accepts safe enum-like values and `planning_action` already exists.

- [ ] **Step 4: Run source guards**

Run:

```bash
node --test tests/test_planning_action_source_guards.js tests/test_analytics_events.js
```

Expected: PASS.

- [ ] **Step 5: Commit the UI and analytics contract slice**

```bash
git add frontend/src/eng/PlanningActionBar.jsx frontend/src/dashboard.jsx tests/test_planning_action_source_guards.js docs/README_ANALYTICS.md
git commit -m "Add planning bulk selection undo"
```

---

## Task 4: Persist Excluded Capacity As Shared Group State

**Files:**
- Modify: `frontend/src/settings/groupConfigUtils.js`
- Modify: `tests/test_shared_group_config_routes.py`
- Create: `tests/test_group_config_utils.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_excluded_capacity_stats_source_guards.js`
- Modify: `docs/README_ANALYTICS.md`

- [ ] **Step 1: Add a route contract guard for shared excluded-capacity persistence**

Add this test to `tests/test_shared_group_config_routes.py` inside `SharedGroupConfigRouteTests`:

```python
    def test_post_groups_config_persists_excluded_capacity_epics_as_shared_catalog(self):
        loaded = self._get_groups_config().get_json()
        payload = {
            'version': 1,
            'baseRevision': loaded['configRevision'],
            'groups': [{
                'id': 'platform',
                'name': 'Platform',
                'teamIds': ['team-a'],
                'excludedCapacityEpics': ['PLAN-EPIC'],
            }],
            'defaultGroupId': 'platform',
        }
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            saved = self.client.post('/api/groups-config', json=payload, headers=self._csrf_headers())

        self._install_session('session-2', 'account-2', self.other_connection_id)
        loaded_for_other_user = self._get_groups_config(fallback={'version': 1}).get_json()
        with self._env_patch(), patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
            preferences = self.client.post(
                '/api/groups-preferences',
                json={'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
                headers=self._csrf_headers(),
            )
        after_preferences = self._get_groups_config(fallback={'version': 1}).get_json()

        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json()['groups'][0]['excludedCapacityEpics'], ['PLAN-EPIC'])
        self.assertEqual(loaded_for_other_user['groups'][0]['excludedCapacityEpics'], ['PLAN-EPIC'])
        self.assertEqual(preferences.status_code, 200, preferences.get_data(as_text=True))
        self.assertEqual(after_preferences['groups'][0]['excludedCapacityEpics'], ['PLAN-EPIC'])
```

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_routes.SharedGroupConfigRouteTests.test_post_groups_config_persists_excluded_capacity_epics_as_shared_catalog
```

Expected: PASS. This route already supports group-level `excludedCapacityEpics`; this test prevents the frontend work from accidentally treating it as a per-user preference.

- [ ] **Step 2: Add failing tests for shared group excluded-capacity toggles**

Create `tests/test_group_config_utils.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('buildGroupsConfigWithExcludedCapacityToggle adds an epic to the active group only', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = buildGroupsConfigWithExcludedCapacityToggle({
        version: 1,
        configRevision: 7,
        groups: [
            { id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: ['BAU-1'] },
            { id: 'beta', name: 'Beta', teamIds: ['team-b'], excludedCapacityEpics: ['BAU-2'] }
        ],
        defaultGroupId: 'alpha'
    }, 'alpha', ' bau-3 ');

    assert.equal(result.changed, true);
    assert.equal(result.nextExcluded, true);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['BAU-1', 'BAU-3']);
    assert.deepEqual(result.config.groups[1].excludedCapacityEpics, ['BAU-2']);
    assert.equal(result.config.configRevision, 7);
});

test('buildGroupsConfigWithExcludedCapacityToggle removes an existing epic from the active group', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const result = buildGroupsConfigWithExcludedCapacityToggle({
        version: 1,
        groups: [
            { id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: ['BAU-1', 'BAU-3'] }
        ],
        defaultGroupId: 'alpha'
    }, 'alpha', 'BAU-3');

    assert.equal(result.changed, true);
    assert.equal(result.nextExcluded, false);
    assert.deepEqual(result.config.groups[0].excludedCapacityEpics, ['BAU-1']);
});

test('buildGroupsConfigWithExcludedCapacityToggle reports unchanged for missing group or key', async () => {
    const {
        buildGroupsConfigWithExcludedCapacityToggle
    } = await import('../frontend/src/settings/groupConfigUtils.js');

    const config = {
        version: 1,
        groups: [{ id: 'alpha', name: 'Alpha', teamIds: ['team-a'], excludedCapacityEpics: [] }],
        defaultGroupId: 'alpha'
    };

    assert.deepEqual(
        buildGroupsConfigWithExcludedCapacityToggle(config, 'missing', 'BAU-1'),
        { config, changed: false, nextExcluded: false }
    );
    assert.deepEqual(
        buildGroupsConfigWithExcludedCapacityToggle(config, 'alpha', ''),
        { config, changed: false, nextExcluded: false }
    );
});
```

Run:

```bash
node --test tests/test_group_config_utils.js
```

Expected: FAIL because `buildGroupsConfigWithExcludedCapacityToggle` is not exported.

- [ ] **Step 3: Add the shared group toggle helper**

In `frontend/src/settings/groupConfigUtils.js`, add:

```js
export function buildGroupsConfigWithExcludedCapacityToggle(config, groupId, epicKey) {
    const targetGroupId = String(groupId || '').trim();
    const normalizedEpicKey = String(epicKey || '').trim().toUpperCase();
    if (!targetGroupId || !normalizedEpicKey) {
        return { config, changed: false, nextExcluded: false };
    }

    let changed = false;
    let nextExcluded = false;
    const groups = (config?.groups || []).map(group => {
        if (String(group?.id || '').trim() !== targetGroupId) return group;
        const existing = Array.isArray(group.excludedCapacityEpics)
            ? group.excludedCapacityEpics.map(key => String(key || '').trim().toUpperCase()).filter(Boolean)
            : [];
        const seen = new Set();
        const normalizedExisting = [];
        existing.forEach(key => {
            if (!key || seen.has(key)) return;
            seen.add(key);
            normalizedExisting.push(key);
        });
        const hasKey = seen.has(normalizedEpicKey);
        changed = true;
        nextExcluded = !hasKey;
        return {
            ...group,
            excludedCapacityEpics: hasKey
                ? normalizedExisting.filter(key => key !== normalizedEpicKey)
                : [...normalizedExisting, normalizedEpicKey]
        };
    });

    if (!changed) return { config, changed: false, nextExcluded: false };
    return {
        config: {
            ...config,
            groups
        },
        changed,
        nextExcluded
    };
}
```

Run:

```bash
node --test tests/test_group_config_utils.js
```

Expected: PASS.

- [ ] **Step 4: Add failing source guards for removing local excluded-capacity state**

Append this test to `tests/test_excluded_capacity_stats_source_guards.js`:

```js
test('planning and reporting excluded capacity are backed by shared group config', () => {
    const dashboardPath = path.resolve(__dirname, '../frontend/src/dashboard.jsx');
    const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

    assert.ok(
        dashboardSource.includes('buildGroupsConfigWithExcludedCapacityToggle'),
        'Expected dashboard to use the shared group excluded-capacity toggle helper'
    );
    assert.ok(
        dashboardSource.includes("trackSettingsAction('departments', 'toggle_excluded_capacity'"),
        'Expected shared excluded-capacity toggles to emit settings_action analytics'
    );
    assert.ok(
        dashboardSource.includes('requestSaveGroupsConfig(BACKEND_URL, buildSharedGroupsPayload(nextGroupsConfig))'),
        'Expected excluded-capacity toggle to save through /api/groups-config'
    );
    assert.ok(
        dashboardSource.includes('showGroupManage && isGroupDraftDirty'),
        'Expected inline excluded-capacity toggles to guard against open dirty Department settings drafts'
    );
    assert.ok(
        dashboardSource.includes("setGroupDraftError('Save or discard open Department settings changes before changing excluded capacity from the board.')"),
        'Expected dirty draft guard to tell users how to recover'
    );
    assert.ok(
        dashboardSource.includes('applySavedGroupsConfig(payload)'),
        'Expected shared group saves to reuse the same config application helper'
    );
    assert.ok(
        /const excludedEpicSet = React\.useMemo\(\(\) => \{\s*const set = new Set\(\);\s*\(activeGroupExcludedCapacityEpics \|\| \[\]\)\.forEach/.test(dashboardSource),
        'Expected excludedEpicSet to be derived from activeGroupExcludedCapacityEpics'
    );
    assert.doesNotMatch(
        dashboardSource,
        /excludedStatsEpics/,
        'Local excludedStatsEpics must not drive Planning or Reporting excluded capacity'
    );
});
```

Run:

```bash
node --test tests/test_excluded_capacity_stats_source_guards.js
```

Expected: FAIL because `excludedStatsEpics` still exists and epic toggles still mutate local state.

- [ ] **Step 5: Import the helper and remove local excluded capacity preference state**

Update the `frontend/src/dashboard.jsx` import from `./settings/groupConfigUtils.js`:

```js
import {
    applyLocalGroupPreferences,
    buildGroupId,
    buildGroupsConfigWithExcludedCapacityToggle,
    buildTeamCatalogList,
    mergeTeamCatalog,
    normalizeGroupsConfig,
    parseTeamIdList,
    resolveInitialGroupId
} from './settings/groupConfigUtils.js';
```

Remove these pieces from `frontend/src/dashboard.jsx`:

```js
const [excludedStatsEpics, setExcludedStatsEpics] = useState(savedPrefsRef.current.excludedStatsEpics ?? []);
```

Remove `excludedStatsEpics` from:

```js
buildDefaultGroupState()
buildGroupStateSnapshot()
applyGroupState()
groupStateSnapshot dependencies
saveUiPrefs(...)
saveUiPrefs effect dependencies
```

Change `excludedEpicSet` so it only uses the active group's shared config:

```js
const excludedEpicSet = React.useMemo(() => {
    const set = new Set();
    (activeGroupExcludedCapacityEpics || []).forEach((key) => {
        const normalized = String(key || '').trim().toUpperCase();
        if (normalized) set.add(normalized);
    });
    return set;
}, [activeGroupExcludedCapacityEpics]);
```

- [ ] **Step 6: Add the shared save handler for epic Included/Excluded toggles**

Add this helper near the current Planning/Stats selection handlers in `frontend/src/dashboard.jsx`:

```js
const applySavedGroupsConfig = (payload) => {
    const normalized = applyLocalGroupPreferences(payload, savedPrefsRef.current);
    setGroupsConfig(normalized);
    setGroupPreferences(normalized.preferences);
    setGroupWarnings(payload?.warnings || []);
    setGroupConfigSource(normalized.source || payload?.source || '');
    setGroupDraft(normalized);
    groupDraftBaselineRef.current = JSON.stringify(buildSharedGroupsPayload(normalized));
    setActiveGroupId(prev => {
        const effectiveIds = effectiveVisibleGroupIds(normalized, normalized.preferences);
        return resolveVisibleActiveGroupId(normalized, effectiveIds, prev);
    });
    return normalized;
};

const toggleSharedGroupExcludedCapacityEpic = async (epicKey) => {
    const normalizedEpicKey = String(epicKey || '').trim().toUpperCase();
    if (!normalizedEpicKey || !activeGroupId) return;
    if (!canEditSharedConfiguration) {
        setGroupDraftError('You do not have permission to edit shared department configuration.');
        trackSettingsAction('departments', 'toggle_excluded_capacity', {
            source_surface: showPlanning ? 'planning' : 'statistics',
            result: 'failure'
        });
        return;
    }
    if (showGroupManage && isGroupDraftDirty) {
        setGroupDraftError('Save or discard open Department settings changes before changing excluded capacity from the board.');
        trackSettingsAction('departments', 'toggle_excluded_capacity', {
            source_surface: showPlanning ? 'planning' : 'statistics',
            result: 'failure'
        });
        return;
    }

    const { config: nextGroupsConfig, changed, nextExcluded } = buildGroupsConfigWithExcludedCapacityToggle(
        groupsConfig,
        activeGroupId,
        normalizedEpicKey
    );
    if (!changed) return;

    setGroupDraftError('');
    trackSettingsAction('departments', 'toggle_excluded_capacity', {
        source_surface: showPlanning ? 'planning' : 'statistics',
        value_state: nextExcluded ? 'selected' : 'cleared'
    });

    try {
        const response = await requestSaveGroupsConfig(BACKEND_URL, buildSharedGroupsPayload(nextGroupsConfig));
        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            if (response.status === 409 && errorPayload.current) {
                applySavedGroupsConfig(errorPayload.current);
                setGroupDraftError('Department groups were changed by another user. Reloaded latest group configuration; retry the excluded-capacity change.');
            } else {
                const errorMessage = errorPayload.message || (errorPayload.errors || []).join(' ') || errorPayload.error || `Save failed (${response.status})`;
                setGroupDraftError(errorMessage);
            }
            trackSettingsAction('departments', 'toggle_excluded_capacity_result', {
                source_surface: showPlanning ? 'planning' : 'statistics',
                result: 'failure'
            });
            return;
        }

        const payload = await response.json();
        applySavedGroupsConfig(payload);
        groupStateRef.current.delete(activeGroupId);
        excludedCapacityCacheRef.current = {};
        trackSettingsAction('departments', 'toggle_excluded_capacity_result', {
            source_surface: showPlanning ? 'planning' : 'statistics',
            result: 'success'
        });
    } catch (err) {
        setGroupDraftError(err.message || 'Failed to update excluded capacity.');
        trackSettingsAction('departments', 'toggle_excluded_capacity_result', {
            source_surface: showPlanning ? 'planning' : 'statistics',
            result: 'failure'
        });
    }
};
```

In the existing `saveGroupsConfig` shared group save branch, replace this code:

```js
payload = await response.json();
normalized = applyLocalGroupPreferences(payload, savedPrefsRef.current);
```

with:

```js
payload = await response.json();
normalized = applySavedGroupsConfig(payload);
```

Then remove the duplicate state-application statements from the later `if (sharedGroupsChanged) { ... }` block:

```js
setGroupsConfig(normalized);
setGroupPreferences(normalized.preferences);
setGroupWarnings(payload?.warnings || []);
setGroupConfigSource(normalized.source || payload?.source || '');
setGroupDraft(normalized);
groupDraftBaselineRef.current = JSON.stringify(buildSharedGroupsPayload(normalized));
setActiveGroupId(prev => {
    const effectiveIds = effectiveVisibleGroupIds(normalized, normalized.preferences);
    return resolveVisibleActiveGroupId(normalized, effectiveIds, prev);
});
```

Keep the active-group team-signature cache invalidation in that block. The goal is one shared path for applying saved group config from Settings saves, inline excluded-capacity saves, and 409 conflict recovery.

If `canEditSharedConfiguration` is not the right permission flag for department group saves after inspection, use the same permission flag that enables saving Team Groups in Settings. Do not create a new permission model.

- [ ] **Step 7: Wire the epic header toggle to shared group state**

Add this derived flag near the `toggleSharedGroupExcludedCapacityEpic` handler:

```js
const canToggleSharedGroupExcludedCapacity = canEditSharedConfiguration && !(showGroupManage && isGroupDraftDirty);
```

Replace the current epic stat button handler:

```jsx
onClick={() => {
    const epicKey = String(epicGroup.key || 'NO_EPIC').trim().toUpperCase();
    setExcludedStatsEpics((prev) => {
        const set = new Set(prev || []);
        if (set.has(epicKey)) {
            set.delete(epicKey);
        } else {
            set.add(epicKey);
        }
        return Array.from(set);
    });
}}
```

with:

```jsx
onClick={() => toggleSharedGroupExcludedCapacityEpic(epicGroup.key)}
disabled={!canToggleSharedGroupExcludedCapacity}
```

Update the title:

```jsx
title={!canEditSharedConfiguration
    ? 'You do not have permission to edit shared group capacity settings'
    : (showGroupManage && isGroupDraftDirty)
        ? 'Save or discard open Department settings changes before changing excluded capacity'
        : 'Include/exclude this epic in shared group capacity and reporting'}
```

- [ ] **Step 8: Update analytics documentation**

In `docs/README_ANALYTICS.md`, update the `settings_action` row trigger description from:

```md
Settings tab open, test, save, cancel, validation failure, Department visibility preference change, or first-run Department selection completion
```

to:

```md
Settings tab open, test, save, cancel, validation failure, Department visibility preference change, first-run Department selection completion, or shared excluded-capacity epic toggle from Planning/Reporting
```

No `frontend/src/analytics/events.js` change is needed because `settings_action`, `section`, `workflow_action`, `source_surface`, and `result` already exist.

- [ ] **Step 9: Run focused shared excluded-capacity tests**

Run:

```bash
node --test tests/test_group_config_utils.js tests/test_excluded_capacity_stats_source_guards.js tests/test_analytics_events.js
.venv/bin/python -m unittest tests.test_group_config_service tests.test_shared_group_config_routes tests.test_group_excluded_capacity_epics_api
```

Expected: PASS.

- [ ] **Step 10: Commit the shared excluded-capacity slice**

```bash
git add frontend/src/settings/groupConfigUtils.js frontend/src/dashboard.jsx tests/test_shared_group_config_routes.py tests/test_group_config_utils.js tests/test_excluded_capacity_stats_source_guards.js docs/README_ANALYTICS.md
git commit -m "Persist excluded capacity in group config"
```

---

## Task 5: Add Rendered UI Coverage

**Files:**
- Create: `tests/ui/planning_selection_defaults.spec.js`

- [ ] **Step 1: Create a focused Playwright spec**

Create `tests/ui/planning_selection_defaults.spec.js` with a small dashboard fixture. Use the existing app shell pattern from `tests/ui/codebase_structure_smoke.spec.js`: bundle `frontend/src/dashboard.jsx` with esbuild in `beforeAll`, call `installDashboardShell(page, dashboardJs)`, and route the minimum APIs used by ENG Planning.

Start the file with:

```js
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const activeSprintId = 3001;
const activeSprintName = '2026Q2 Sprint 42';
const futureSprintId = 4002;
const futureSprintName = '2026Q3 Sprint 1';
const groupTeamIds = ['team-alpha'];
let dashboardJs;

test.beforeAll(() => {
    const result = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    dashboardJs = result.outputFiles[0].text;
});
```

The test data must include:

```js
const futureStories = [
    makeStory('PLAN-1', 'To Do'),
    makeStory('PLAN-2', 'Pending'),
    makeStory('PLAN-3', 'Accepted'),
];
```

Define the fixture helpers before the tests:

```js
function json(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function makeStory(key, status) {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic future planning story`,
            status: { name: status },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Alpha Owner' },
            customfield_10004: 1,
            epicKey: 'PLAN-EPIC',
            parentSummary: 'Future planning epic',
            projectKey: 'PLAN',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
        },
    };
}

function makeEpic() {
    return {
        key: 'PLAN-EPIC',
        summary: 'Future planning epic',
        status: { name: 'In Progress' },
        assignee: { displayName: 'Alpha Lead' },
        teamId: 'team-alpha',
        teamName: 'Alpha Team',
        labels: ['alpha_label'],
        sprint: [{ id: futureSprintId, name: futureSprintName, state: 'future' }],
    };
}

async function installPlanningFixture(page) {
    const calls = [];
    let groupsConfigPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-alpha',
        groups: [{
            id: 'group-alpha',
            name: 'Alpha Department',
            teamIds: groupTeamIds,
            labels: ['alpha_label'],
            excludedCapacityEpics: []
        }],
    };
    await installDashboardShell(page, dashboardJs);
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let body = null;
        if (request.method() === 'POST') {
            try {
                body = request.postDataJSON();
            } catch (err) {
                body = null;
            }
        }
        calls.push({ method: request.method(), pathname: url.pathname, body });

        if (url.pathname === '/api/auth/status') {
            return json(route, { authMode: 'basic', authenticated: true, profile: { email: 'profile@example.com' } });
        }
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/csrf') return json(route, { csrfToken: 'csrf-token' });
        if (url.pathname === '/api/config') {
            return json(route, {
                jiraUrl: 'https://jira.example',
                capacityProject: '',
                authMode: 'basic',
                projectsConfigured: true,
                userCanEditSettings: true,
                environmentConfigExists: true,
            });
        }
        if (url.pathname === '/api/version') return json(route, { enabled: false });
        if (url.pathname === '/api/groups-config' && request.method() === 'GET') {
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/groups-config' && request.method() === 'POST') {
            const payload = request.postDataJSON();
            if (payload.baseRevision !== groupsConfigPayload.configRevision) {
                return json(route, { error: 'group_config_conflict', current: groupsConfigPayload }, 409);
            }
            groupsConfigPayload = {
                version: payload.version || 1,
                source: 'workspace_db',
                configRevision: groupsConfigPayload.configRevision + 1,
                defaultGroupId: payload.defaultGroupId || '',
                groups: payload.groups || []
            };
            return json(route, groupsConfigPayload);
        }
        if (url.pathname === '/api/projects/selected') return json(route, { selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json(route, { weights: [], source: 'test' });
        if (url.pathname === '/api/board-config') return json(route, { boardId: '5494', boardName: 'Synthetic Board' });
        if (url.pathname === '/api/capacity/config') return json(route, { project: '', fieldId: '', fieldName: '' });
        if (url.pathname.endsWith('/config') && url.pathname.includes('-field')) return json(route, { fieldId: '', fieldName: '' });
        if (url.pathname === '/api/issue-types/config') return json(route, { issueTypes: ['Epic', 'Story'] });
        if (url.pathname === '/api/issue-types') return json(route, { issueTypes: [{ name: 'Epic' }, { name: 'Story' }] });
        if (url.pathname === '/api/sprints') {
            return json(route, {
                sprints: [
                    { id: activeSprintId, name: activeSprintName, state: 'active', startDate: '2026-05-01' },
                    { id: futureSprintId, name: futureSprintName, state: 'future', startDate: '2026-07-01' },
                ],
            });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const project = url.searchParams.get('project');
            const purpose = url.searchParams.get('purpose');
            const issues = project === 'product' && !purpose ? futureStories : [];
            const epic = makeEpic();
            return json(route, {
                issues,
                epics: { [epic.key]: epic },
                epicsInScope: project === 'product' ? [epic] : [],
                names: {},
            });
        }
        if (url.pathname === '/api/missing-info') return json(route, { issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json(route, { epics: [] });
        if (url.pathname === '/api/capacity') return json(route, { enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json(route, { dependencies: {} });
        if (url.pathname === '/api/analytics/context') return json(route, { enabled: false });
        return json(route, { error: `Unexpected ${request.method()} ${url.pathname}` }, 404);
    });
    return { calls, getGroupsConfig: () => groupsConfigPayload };
}

async function openFuturePlanning(page) {
    await page.getByRole('button', { name: /sprint/i }).click();
    await page.getByText(futureSprintName).click();
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning' }).click();
    await expect(page.locator('.planning-panel.open')).toBeVisible();
}
```

Keep fixture values synthetic and avoid real Jira data.

- [ ] **Step 2: Test new future sprint defaults to all selected**

Add this test flow:

```js
test('new future planning sprint defaults to all selected stories', async ({ page }) => {
    await installPlanningFixture(page);
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await expect(page.locator('.planning-panel.open')).toBeVisible();
    await expect(page.getByText('Selected: 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select All' })).toHaveClass(/active/);
});
```

- [ ] **Step 3: Test manual checkbox edits persist until Select All**

Add:

```js
test('manual future planning checkbox edits persist until Select All is clicked', async ({ page }) => {
    await installPlanningFixture(page);
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await page.getByRole('checkbox', { name: /PLAN-2/ }).click();
    await expect(page.getByText('Selected: 2')).toBeVisible();
    await page.reload();
    await openFuturePlanning(page);
    await expect(page.getByText('Selected: 2')).toBeVisible();

    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(page.getByText('Selected: 3')).toBeVisible();
    await page.reload();
    await openFuturePlanning(page);
    await expect(page.getByText('Selected: 3')).toBeVisible();
});
```

- [ ] **Step 4: Test Undo restores loaded-page baseline after bulk action**

Add:

```js
test('planning undo restores loaded selection after a bulk status action', async ({ page }) => {
    await installPlanningFixture(page);
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await expect(page.getByText('Selected: 3')).toBeVisible();
    await page.getByRole('button', { name: 'To Do' }).click();
    await expect(page.getByText('Selected: 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Selected: 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
```

- [ ] **Step 5: Test excluded capacity writes to shared group config and survives reload**

Add:

```js
test('planning epic excluded-capacity toggle updates shared group config', async ({ page }) => {
    const fixture = await installPlanningFixture(page);
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(appBaseUrl);
    await openFuturePlanning(page);

    await page.getByRole('button', { name: /Included/ }).first().click();
    await expect(page.getByRole('button', { name: /Excluded/ }).first()).toBeVisible();

    const saveCalls = fixture.calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config');
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].body.baseRevision).toBe(1);
    expect(saveCalls[0].body.groups[0].excludedCapacityEpics).toEqual(['PLAN-EPIC']);
    expect(fixture.getGroupsConfig().groups[0].excludedCapacityEpics).toEqual(['PLAN-EPIC']);

    await page.reload();
    await openFuturePlanning(page);
    await expect(page.getByRole('button', { name: /Excluded/ }).first()).toBeVisible();
});
```

- [ ] **Step 6: Run the focused UI spec**

Run:

```bash
npx playwright test tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS and no unexpected API calls.

- [ ] **Step 7: Capture visual proof**

Run the existing sticky Planning smoke after the focused spec:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks"
```

Expected: PASS. Include the generated Planning screenshot path from the Playwright output in PR notes.

- [ ] **Step 8: Commit the UI test slice**

```bash
git add tests/ui/planning_selection_defaults.spec.js
git commit -m "Cover planning default selection undo"
```

---

## Task 6: Build, Dist, And Final Verification

**Files:**
- Regenerate: `frontend/dist/dashboard.js`
- Regenerate: `frontend/dist/dashboard.js.map`

- [ ] **Step 1: Run focused Node tests**

```bash
node --test tests/test_planning_selection_state.js tests/test_group_config_utils.js tests/test_planning_action_source_guards.js tests/test_excluded_capacity_stats_source_guards.js tests/test_analytics_events.js
.venv/bin/python -m unittest tests.test_group_config_service tests.test_shared_group_config_routes tests.test_group_excluded_capacity_epics_api
```

Expected: PASS.

- [ ] **Step 2: Run focused Playwright tests**

```bash
npx playwright test tests/ui/planning_selection_defaults.spec.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks"
```

Expected: PASS. Screenshots should show the Planning action row with the new Undo button and no overlap with existing controls.

- [ ] **Step 3: Rebuild frontend dist**

```bash
npm run build
```

Expected: PASS and `frontend/dist/dashboard.js` plus `frontend/dist/dashboard.js.map` updated from source changes.

- [ ] **Step 4: Run the full test suite before push**

```bash
python3 -m unittest discover -s tests
```

Expected: PASS. If the Python suite does not cover Node tests, keep the Node and Playwright results in the PR notes too.

- [ ] **Step 5: Inspect generated and source diffs**

```bash
git diff -- frontend/src/planningSelectionState.mjs frontend/src/settings/groupConfigUtils.js frontend/src/dashboard.jsx frontend/src/eng/PlanningActionBar.jsx tests/test_planning_selection_state.js tests/test_shared_group_config_routes.py tests/test_group_config_utils.js tests/test_planning_action_source_guards.js tests/test_excluded_capacity_stats_source_guards.js tests/ui/planning_selection_defaults.spec.js docs/README_ANALYTICS.md
git diff -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map
```

Expected: diffs are limited to Planning selection behavior, shared group excluded-capacity behavior, Undo UI, analytics documentation, focused tests, and generated frontend output.

- [ ] **Step 6: Commit the generated dist output**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "Build planning selection defaults"
```

- [ ] **Step 7: Pre-push review**

```bash
git log --oneline -5
git status --short
```

Expected: feature commits are on the feature/docs branch, working tree is clean except for intentional local files, and no push is performed without explicit user confirmation.

---

## Acceptance Criteria

- A future sprint/group planning scope with no stored Planning state loads with all valid visible Planning stories selected.
- Existing active and completed sprint selection defaults do not change.
- Manual checkbox edits in a future sprint persist across reloads and group/sprint switches.
- `Select All` reselects all visible Planning tasks and restores future `default_all` behavior for that scope.
- Status bulk buttons and Clear Selected switch the scope to manual selected keys.
- Undo is disabled on initial load, enabled after bulk selection actions, restores the loaded-page selection baseline, tracks `planning_action` with `workflow_action=undo_selection`, and disables after use.
- Planning localStorage remains backwards-compatible with existing `jira_dashboard_planning_state_v1` entries.
- Planning and Reporting excluded-capacity state is derived from `activeGroup.excludedCapacityEpics`, not local `excludedStatsEpics`.
- Checking or unchecking an epic's Included/Excluded state saves the selected group's `excludedCapacityEpics` through `/api/groups-config` with `baseRevision`.
- Successful shared excluded-capacity saves update `groupsConfig`, `groupDraft`, active group state, Planning capacity, and Reporting excluded-capacity filters without requiring a Settings modal save.
- Stale shared group saves handle `409 group_config_conflict` by reloading the current shared group config and showing a recoverable error.
- If the Department settings modal has unsaved changes, Planning/Reporting Included/Excluded controls are disabled and the handler refuses to overwrite the open draft.
- `/api/groups-config` route tests prove a saved `excludedCapacityEpics` value is visible to another user in the same workspace.
- `/api/groups-preferences` route tests prove per-user visibility saves do not mutate group-level `excludedCapacityEpics`.
- Any user with access to the group and permission to save shared department configuration sees the same excluded-capacity state after refresh/reload.
- No new backend/Jira/Home write paths are added.
- Analytics taxonomy is updated without adding unsafe parameters or new event names.
- Focused Node tests, focused Python shared group tests, focused Playwright tests, existing sticky Planning smoke, `npm run build`, and the full Python unittest suite pass before push.
