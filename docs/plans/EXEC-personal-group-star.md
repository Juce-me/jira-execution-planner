# Personal Group Star Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Ready for execution on `improvement/personal-group-star`. Execute and verify this plan before branching or executing `EXEC-user-onboarding-tour.md`.

**Goal:** Make the Department group star a single personal preference for each authenticated workspace/user, replace first-run multi-select with one explicit starred group, and keep temporary dashboard group changes separate from the persisted favorite.

**Architecture:** Retain the existing `user_group_preferences.active_group_id` column and `activeGroupId` wire key for migration compatibility, but make their persisted DB meaning explicit: the user's one personal favorite group. Shared `defaultGroupId` remains a legacy workspace/file configuration field and is never presented or mutated as an authenticated DB user's star. The preferences hook owns a separate Settings favorite draft while `dashboard.jsx` keeps transient current scope in `activeGroupId`.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy, React 19, Node test runner, Playwright, esbuild, existing GA4/GTM `settings_action` and `filter_changed` contracts.

**Spec:** Approved product corrections in the 2026-08-25 and 2026-08-26 task conversation. This plan is the canonical star behavior and selection-UI contract; `EXEC-user-onboarding-tour.md` consumes it without redefining it.

## Global Constraints

- In workspace DB mode, exactly one valid `active_group_id` is the authenticated user's personal favorite group.
- The API and DB keep the existing `activeGroupId`/`active_group_id` names for compatibility. Frontend draft code may use `favoriteGroupId`/`favoriteGroupDraftId` to make the semantics clear.
- Shared `defaultGroupId` must never be written, forced visible, preferred, or displayed as an authenticated DB user's favorite.
- File/JSON mode has no authenticated per-user DB boundary and retains its current shared-default behavior; this plan must not break import/export compatibility.
- First-run group selection is single-select: no preselection, one native radio, outlined/filled star, choosing another group moves the star, and the only star cannot be cleared without choosing another group.
- The first preference-row save must contain exactly one known `visibleGroupIds` id and the same `activeGroupId`. Later Settings saves may expose multiple groups but still require exactly one visible favorite.
- A personal favorite is always visible in that user's controls and cannot be hidden until another visible group is starred.
- Dashboard Group-dropdown changes are temporary scope changes. They do not mutate the Settings favorite draft or issue `/api/groups-preferences`; bootstrap/reload starts from the persisted personal favorite.
- No new endpoint, DB column, dependency, startup request, Jira mutation, or Home/Townsquare route is introduced.
- Reuse existing star, radio, modal, group-list, dropdown, focus, and settings footer styles. Do not add bespoke control geometry, magic-number widths, or shared-component layout overrides.
- Analytics sends no group id/name and adds no event name or custom dimension. Remove the now-constant first-run `selected_count_bucket`; retain bucketed available-group count only.
- Do not hand-edit `frontend/dist/`; rebuild it from source.

## Scenario Contract

| Scenario | Required result |
| --- | --- |
| First DB/OAuth preference, one group | Nothing is preselected; Continue is disabled until the user clicks the group; the row then shows one filled star and saves that group as visible and favorite. |
| First preference, many groups | Search filters locally; one selection survives query changes; clicking another group moves the only filled star. |
| Invalid first payload | Zero visible ids, two visible ids, null favorite, mismatched favorite, unknown id, or shared `defaultGroupId` injection returns `400 invalid_group_preferences`. |
| Existing user with several visible groups | Exactly one personal star is shown; all other groups may remain visible. |
| User stars a hidden group in Settings | The new favorite becomes visible, the old favorite may then be hidden, and one Save persists both preference fields. |
| User clicks the already-starred group | No-op; the user cannot end with zero favorites. |
| Two users in one workspace | Each can star a different group; neither changes the other's row or shared group payload. |
| Same user in two workspaces | Each workspace retains its own personal star. |
| Shared group config is edited | Shared catalog fields save with revision protection, but personal star changes travel only through `/api/groups-preferences`. |
| Dashboard group switch | Current data scope changes and existing `filter_changed` analytics fires; the persisted star and Settings UI remain unchanged. |
| Reload/bootstrap | A valid stored personal favorite wins over local transient scope and shared `defaultGroupId`. |
| Favorite group is deleted | Preferences return `onboardingRequired:true`, no favorite is invented, and group-scoped requests remain blocked until explicit replacement selection. |
| File/JSON mode | Existing shared-default behavior and imports remain unchanged; no DB personal-preference claim is shown. |

## Endpoint Contract Matrix

| Method/path | Policy | Request | Success | Errors | Required proof |
| --- | --- | --- | --- | --- | --- |
| `GET /api/groups-config` | Existing `authenticated_read` | None | Existing shared config plus isolated user `preferences.activeGroupId` | Existing auth/config errors | Workspace DB response never replaces the personal favorite with `defaultGroupId`; missing/invalid favorite requires selection. |
| `POST /api/groups-preferences` | Existing `user_write`, token-bound CSRF, `X-Requested-With` | `{visibleGroupIds:string[],activeGroupId:string|null}` | `200 {preferences:{...}}` | Existing auth/CSRF errors; `400 invalid_group_preferences`; `400 unsupported_group_preference_field`; `409 group_preferences_db_required` | First row requires one matching visible/favorite id; later rows allow multiple visible ids with one visible favorite; user/workspace isolation. |
| Shared groups-config save | Existing shared-config policy and revision contract | Existing shared payload with `baseRevision` | Existing response | Existing validation/conflict/auth errors | Personal-star interaction does not change or add `defaultGroupId` in this request. |

## File Map

### Create

- `docs/features/personal-group-star.md`: durable explanation of personal favorite versus temporary scope and file-mode compatibility.

### Modify

- `backend/services/shared_group_config.py:195-324`: source-aware visibility/favorite normalization and first-row validation.
- `frontend/src/settings/groupVisibilityUtils.js:13-96`: source-aware visibility, single first-run payload, and favorite-aware signatures.
- `frontend/src/settings/useGroupVisibilityPreferences.js:14-253`: separate first-run favorite, Settings favorite draft, and transient dashboard scope.
- `frontend/src/settings/FirstRunGroupSelectionModal.jsx:3-89`: replace checkbox multi-select/count with one accessible starred radio choice.
- `frontend/src/settings/TeamGroupsSettings.jsx:3-250`: render/edit personal star in workspace DB mode and retain file-mode compatibility.
- `frontend/src/dashboard.jsx:1000-1040,3060-3120,12495-12580,15456-16064`: remove shared-default star wiring in DB mode and display the persisted personal star separately from current scope.
- `tests/test_shared_group_config_service.py`: first-row validation, favorite/default separation, deletion, user/workspace isolation.
- `tests/test_shared_group_config_routes.py`: exact request/error contract and CSRF/isolation coverage.
- `tests/test_group_visibility_utils.js`: source-aware visibility and single-star payload coverage.
- `tests/ui/shared_department_groups.spec.js`: picker, Settings, dashboard, persistence, and screenshot scenarios.
- `tests/test_analytics_source_guards.js`: constant-count removal and forbidden group identity guard.
- `docs/README_ANALYTICS.md`: narrow analytics impact decision.
- `docs/features/README.md`: index the feature guide.
- `docs/plans/README.md`: index this plan before onboarding.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`: generated output.

### Read Only / Must Not Modify

- `backend/db/models.py`: `active_group_id` already provides the correct user/workspace storage boundary; do not add or rename a column.
- Onboarding tour files and `onboarding_done`: owned only by `EXEC-user-onboarding-tour.md`.
- Jira/Home/Townsquare mutation and credential paths.

---

### Task 1: Enforce the personal-favorite preference contract

**Files:**
- Modify: `backend/services/shared_group_config.py:195-324`
- Test: `tests/test_shared_group_config_service.py`
- Test: `tests/test_shared_group_config_routes.py`

**Interfaces:**
- Consumes: `groups_config.source`, `groups_config.groups`, legacy `defaultGroupId`, and `UserGroupPreference.active_group_id`.
- Produces: normalized `preferences.activeGroupId` as one personal favorite for `workspace_db` and `InvalidGroupPreferences` for invalid first/existing saves.
- Preserves: file/JSON shared-default fallback and the current route/auth/CSRF envelope.

- [ ] **Step 1: Add failing service tests for source-aware favorite semantics**

Use a DB-source group config whose shared default differs from both users' choices:

```python
groups = {
    'source': 'workspace_db',
    'groups': [
        {'id': 'default', 'name': 'Default'},
        {'id': 'platform', 'name': 'Platform'},
        {'id': 'mobile', 'name': 'Mobile'},
    ],
    'defaultGroupId': 'default',
}

saved = service.save_group_preferences(
    self.context,
    {'visibleGroupIds': ['platform'], 'activeGroupId': 'platform'},
    groups,
    database_url=self.database_url,
)
self.assertEqual(saved['effectiveVisibleGroupIds'], ['platform'])
self.assertEqual(saved['activeGroupId'], 'platform')
```

Add cases proving the shared default is not inserted, another user can save `mobile`, another workspace remains isolated, and an existing row may save `['platform','mobile']` only when its `activeGroupId` is one of those ids.

- [ ] **Step 2: Add failing first-row and invalid-favorite route tests**

For a user without a preference row, assert each payload returns `400 invalid_group_preferences`:

```python
invalid_payloads = (
    {'visibleGroupIds': [], 'activeGroupId': None},
    {'visibleGroupIds': ['platform', 'mobile'], 'activeGroupId': 'platform'},
    {'visibleGroupIds': ['platform'], 'activeGroupId': None},
    {'visibleGroupIds': ['platform'], 'activeGroupId': 'mobile'},
)
```

Also assert unknown/extra fields remain rejected, missing `X-Requested-With` or token-bound CSRF remains `403`, file mode remains `409 group_preferences_db_required`, and a valid first request returns exactly one visible/favorite id.

- [ ] **Step 3: Run focused backend tests and verify RED**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service tests.test_shared_group_config_routes
```

Expected: failures show shared `defaultGroupId` is still forced/preferred and first-row multi-selection is still accepted. Auth/bootstrap fixture failures are not the required RED result.

- [ ] **Step 4: Implement source-aware normalization and exact first-row validation**

Branch shared-default compatibility by source:

```python
uses_personal_preferences = str((groups_config or {}).get('source') or '') == GROUPS_SOURCE_DB
if not uses_personal_preferences:
    default_group_id = str((groups_config or {}).get('defaultGroupId') or '').strip()
    if default_group_id and default_group_id in ids and default_group_id not in visible:
        visible.insert(0, default_group_id)
```

For persisted workspace DB rows, do not invent a star. A missing, unknown, or non-visible stored favorite returns `onboardingRequired:true`, `activeGroupId:None`, and empty effective scope. During `save_group_preferences`, query the row and enforce the exact initial contract before inserting:

```python
if row is None:
    visible_ids = preferences['visibleGroupIds']
    favorite_group_id = preferences['activeGroupId']
    if len(visible_ids) != 1 or favorite_group_id != visible_ids[0]:
        raise InvalidGroupPreferences('first run must select exactly one personal favorite group')
elif preferences['activeGroupId'] not in preferences['effectiveVisibleGroupIds']:
    raise InvalidGroupPreferences('personal favorite group must remain visible')
```

Never update shared group config from this service.

- [ ] **Step 5: Run focused backend tests and commit**

Run the Step 3 command. Expected: PASS for first-row validation, existing-row multi-visibility, deletion recovery, file compatibility, and user/workspace isolation.

Commit:

```bash
git add backend/services/shared_group_config.py tests/test_shared_group_config_service.py tests/test_shared_group_config_routes.py
git commit -m "fix: make group favorite user-scoped"
```

### Task 2: Replace first-run multi-select with one explicit star

**Files:**
- Modify: `frontend/src/settings/groupVisibilityUtils.js:13-96`
- Modify: `frontend/src/settings/useGroupVisibilityPreferences.js:39-165`
- Modify: `frontend/src/settings/FirstRunGroupSelectionModal.jsx:3-89`
- Test: `tests/test_group_visibility_utils.js`
- Modify/Test: `tests/ui/shared_department_groups.spec.js`

**Interfaces:**
- Consumes: Task 1's exact first-row API contract.
- Produces: `buildFirstRunGroupPreferencesPayload(selectedGroupId)`, `firstRunFavoriteGroupId:string|null`, and `selectFirstRunFavoriteGroup(groupId)`.
- Preserves: existing local search, error/retry display, mandatory request blocking, and current Add group behavior. Configure-your-own expansion belongs to onboarding.

- [ ] **Step 1: Add failing helper and picker tests**

Add the exact helper assertion:

```js
assert.deepEqual(
    buildFirstRunGroupPreferencesPayload('mobile'),
    { visibleGroupIds: ['mobile'], activeGroupId: 'mobile' },
);
```

Playwright must prove no star is preselected with one or many groups, Continue is disabled initially, rows contain native radios rather than checkboxes, clicking another row moves the one filled star, selection survives search changes, and Continue posts the exact one-id payload.

- [ ] **Step 2: Run focused frontend tests and verify RED**

Run:

```bash
node --test tests/test_group_visibility_utils.js
npx playwright test tests/ui/shared_department_groups.spec.js --grep "first-run|personal star|mandatory"
```

Expected: failures because the helper accepts arrays/default, the modal uses checkboxes/count, and one shared-default group is auto-selected.

- [ ] **Step 3: Implement single-id state and payload**

Replace the helper:

```js
export const buildFirstRunGroupPreferencesPayload = (selectedGroupId) => {
    const favoriteGroupId = normalizeId(selectedGroupId);
    return {
        visibleGroupIds: favoriteGroupId ? [favoriteGroupId] : [],
        activeGroupId: favoriteGroupId || null,
    };
};
```

In the hook, replace `firstRunSelectedGroupIds`/toggle logic with:

```js
const [firstRunFavoriteGroupId, setFirstRunFavoriteGroupId] = React.useState(null);
const selectFirstRunFavoriteGroup = React.useCallback((groupId) => {
    setFirstRunFavoriteGroupId(String(groupId || '').trim() || null);
}, []);
```

Reset to null whenever mandatory selection opens. Do not preselect the sole group or shared default. Save only the one-id payload and set current dashboard scope from the successful response.

- [ ] **Step 4: Render an accessible starred radio list**

Use heading **Choose your group** and subtitle **Star one group to use as your personal starting group**. Remove selected count and render one native radio plus visual star per row:

```jsx
<input
    type="radio"
    name="first-run-favorite-group"
    checked={selectedGroupId === group.id}
    onChange={() => onSelectGroup(group.id)}
/>
<span className="department-first-run-star" aria-hidden="true">
    {selectedGroupId === group.id ? '★' : '☆'}
</span>
```

Keep Continue disabled until `selectedGroupId` is non-empty. Do not add onboarding Skip, tour copy, or replay here.

- [ ] **Step 5: Run focused frontend tests and commit**

Run the Step 2 commands. Expected: PASS with exactly one explicit star and no task request before the save succeeds.

Commit:

```bash
git add frontend/src/settings/groupVisibilityUtils.js frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/settings/FirstRunGroupSelectionModal.jsx tests/test_group_visibility_utils.js tests/ui/shared_department_groups.spec.js
git commit -m "fix: require one first-run favorite group"
```

### Task 3: Make Settings and dashboard stars personal

**Files:**
- Modify: `frontend/src/settings/useGroupVisibilityPreferences.js:72-253`
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx:3-250`
- Modify: `frontend/src/dashboard.jsx:1000-1040,3060-3120,12495-12580,15780-15855`
- Modify/Test: `tests/ui/shared_department_groups.spec.js`

**Interfaces:**
- Consumes: persisted `groupPreferences.activeGroupId` from Task 1.
- Produces: `favoriteGroupDraftId`, `setFavoriteGroupDraft(groupId)`, and `personalGroupPreferencesEnabled` UI mode.
- Preserves: shared Save-all ordering, dirty-state protection, file-mode shared default, visible-group editing, and transient dashboard selection handlers.

- [ ] **Step 1: Add failing Settings/dashboard behavior and geometry tests**

Add Playwright cases proving:

1. Workspace DB group list/editor/dashboard dropdown all mark the same persisted personal favorite.
2. Starring another group moves one star, ensures it is visible, and makes Settings dirty without changing `groupDraft.defaultGroupId`.
3. Save posts the favorite only through `/api/groups-preferences`; the shared groups-config payload retains its previous `defaultGroupId` byte-for-byte.
4. The favorite visibility checkbox cannot remove the favorite; after another star is chosen the old group can be hidden.
5. Two user fixtures retain different stars in one workspace.
6. Header Group-dropdown selection changes current scope and existing analytics but sends no preference write and does not move the Settings star.
7. File-mode fixture retains current shared-default star behavior.
8. Star buttons are native buttons with stable 30×30 geometry, visible focus, accessible names, no clipping, and one filled star.

- [ ] **Step 2: Run the focused UI suite and verify RED**

Run:

```bash
npx playwright test tests/ui/shared_department_groups.spec.js --grep "favorite|star|temporary group scope|file mode"
```

Expected: failures because the Settings/dashboard star currently reads and mutates shared `defaultGroupId`, and the preference draft uses transient `activeGroupId`.

- [ ] **Step 3: Separate favorite draft from current dashboard scope**

In the preferences hook:

```js
const [favoriteGroupDraftId, setFavoriteGroupDraftId] = React.useState(null);

const setFavoriteGroupDraft = React.useCallback((groupId) => {
    const normalizedId = String(groupId || '').trim();
    if (!normalizedId) return;
    setFavoriteGroupDraftId(normalizedId);
    setVisibleGroupDraftIds((previous) => (
        previous.includes(normalizedId) ? previous : [...previous, normalizedId]
    ));
}, []);
```

Initialize the draft from `groupPreferences.activeGroupId`, never current dashboard scope. Use `favoriteGroupDraftId` in the dirty signature and preference save payload. Prevent hiding it. After a successful Settings save, make the saved favorite current; ordinary dashboard scope changes continue to update only transient `activeGroupId`.

- [ ] **Step 4: Render source-aware personal stars without layout reinvention**

Pass `personalGroupPreferencesEnabled={groupsConfig.source === 'workspace_db'}`. In workspace DB mode:

- derive list/editor stars from `favoriteGroupDraftId` and dropdown star from persisted `groupPreferences.activeGroupId`;
- replace `toggleDefaultGroupDraft` with `setFavoriteGroupDraft` for the user-facing star;
- use **My favorite group**, **Set {name} as my favorite group**, and **{name} is my favorite group**;
- make clicking the filled star a no-op;
- disable favorite removal from **Show in my controls**;
- never label a DB star **Default group**.

When the flag is false, retain the existing file/JSON shared-default UI. Reuse `.group-list-star` and `.group-star-button`; add only the selector needed for the first-run star and do not override shared layout.

- [ ] **Step 5: Run UI tests, inspect screenshots, and commit**

Run the Step 2 command and capture settled desktop plus mobile screenshots of Settings and the dashboard dropdown. Inspect the actual stars, labels, focus ring, row alignment, clipping, and one-star invariant.

Commit:

```bash
git add frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/settings/TeamGroupsSettings.jsx frontend/src/dashboard.jsx tests/ui/shared_department_groups.spec.js
git commit -m "fix: show personal group favorites"
```

### Task 4: Lock analytics and documentation boundaries

**Files:**
- Modify: `tests/test_analytics_source_guards.js`
- Modify: `docs/README_ANALYTICS.md`
- Create: `docs/features/personal-group-star.md`
- Modify: `docs/features/README.md`
- Modify: `docs/plans/README.md`

**Interfaces:**
- Consumes: existing `settings_action` and `filter_changed` events.
- Produces: no new event name, parameter, custom definition, GTM trigger, or runbook action.
- Documents: personal favorite ownership, temporary scope, and file compatibility.

- [ ] **Step 1: Add failing analytics source guards**

Require `first_run_selection` to omit the constant count and reject group identity:

```js
assert.doesNotMatch(
    source,
    /first_run_selection'[\s\S]{0,240}selected_count_bucket/,
);
for (const forbidden of ['favorite_group_id', 'group_id', 'group_name']) {
    assert.equal(capturedEvent.eventParams?.[forbidden], undefined);
}
```

Also assert dashboard scope changes retain existing `filter_changed` ownership and do not add a second star event.

- [ ] **Step 2: Run the analytics guard and verify RED**

Run:

```bash
node --test tests/test_analytics_source_guards.js
```

Expected: FAIL because first-run still emits `selected_count_bucket` and the durable contract still describes bucketed selected count for that action.

- [ ] **Step 3: Update the durable contracts and feature guide**

Keep existing `settings_action(section=departments, workflow_action=first_run_selection|preference_change)` and `filter_changed(filter_type=group)` ownership. Remove only first-run `selected_count_bucket`; retain `group_count_bucket`. Document that the star's id/name is forbidden and that no event is added for rendering a star.

In `docs/features/personal-group-star.md`, explain personal star versus temporary scope, single first-run selection, Settings Save behavior, deletion recovery, user/workspace isolation, and file/JSON compatibility. Index the guide and this plan.

- [ ] **Step 4: Run docs/analytics checks and commit**

Run:

```bash
node --test tests/test_analytics_source_guards.js
git diff --check
```

Expected: PASS with no unsafe identity parameters or whitespace errors.

Commit:

```bash
git add tests/test_analytics_source_guards.js docs/README_ANALYTICS.md docs/features/personal-group-star.md docs/features/README.md docs/plans/README.md
git commit -m "docs: define personal group favorites"
```

### Task 5: Rebuild and verify the complete star feature

**Files:**
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`
- Rebuild: `frontend/dist/dashboard.css`
- Review: every file in this plan's File Map

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: an independently releasable personal-star feature and the prerequisite contract for onboarding.

- [ ] **Step 1: Run focused backend/frontend/UI checks**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service tests.test_shared_group_config_routes
node --test tests/test_group_visibility_utils.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js
```

Expected: all focused checks pass with exact first-row validation, personal isolation, file compatibility, temporary scope, accessibility, and screenshots.

- [ ] **Step 2: Build twice and prove generated output stability**

Run:

```bash
npm run build
git status --short
npm run build
git diff --exit-code -- frontend/dist
```

Expected: both builds succeed and the second build produces no additional dist change.

- [ ] **Step 3: Run full regression suites**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui
```

Expected: all suites pass aside from an explicitly documented environment-only skip. Do not substitute source-only assertions for UI behavior.

- [ ] **Step 4: Inspect visual evidence**

Open the settled screenshots and verify the one filled star, outlined alternatives, row/control geometry, focus ring, no clipping, personal labels, mobile containment, and unchanged file-mode display. Confirm captured requests show no shared `defaultGroupId` mutation from DB personal-star actions.

- [ ] **Step 5: Run preflight and final diff review**

Run:

```bash
.venv/bin/python scripts/check_startup_preflight.py
git diff --check
git diff --stat
git diff --name-only
git status --short
git log --oneline -5
```

Before any push, launch `.venv/bin/python jira_server.py`, verify `/api/test`, review the full diff for unrelated lines/local data, and wait for explicit user confirmation.

- [ ] **Step 6: Commit generated output**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "build: update personal group star bundle"
```

## Acceptance Criteria

- First-run selection requires one explicit personal star and rejects zero/multiple/mismatched payloads.
- Workspace DB users each retain exactly one favorite per workspace; shared `defaultGroupId` never supplies or receives that star.
- Settings star changes persist only through user preferences, use Save-all dirty semantics, keep the favorite visible, and do not affect other users.
- Dashboard Group-dropdown changes remain temporary and do not move the persisted favorite.
- Missing/deleted favorites reopen mandatory selection instead of inventing a fallback.
- File/JSON behavior remains compatible.
- Analytics contains no group identity and removes the constant first-run selection count without introducing a new event.
- Focused/full tests, clean rebuild, source review, element-level geometry, and inspected screenshots provide acceptance evidence.

## Out of Scope

- `onboarding_done`, tour content, spotlight/coachmark UI, Skip/Finish, replay, configure-your-own onboarding guidance, or onboarding outcome analytics.
- Renaming/removing the existing DB column or API wire key.
- Adding a favorites list or supporting more than one personal star.
- Changing shared group catalog permissions, revision behavior, import/export schema, Jira behavior, or Home/Townsquare behavior.
