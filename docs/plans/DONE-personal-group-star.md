# Personal Group Star Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status:** Completed on 2026-08-26 on `improvement/personal-group-star`.
>
> **Implementation commits:** `50db7ee`, `4e8949c`, `c263a29`, `bf0cd40`, `083a09c`.
>
> **Verification:** Node `v20.20.0`; Python `3.14.7` with OpenSSL `3.6.3`; focused backend `27/27`; focused frontend `96/96`; feature Playwright `9/9`; full Python `1234/1234` with one documented skip; frontend unit `913/913`; full Playwright `414 passed, 2 skipped`, followed by a passing rerun of the sole subpixel-rounding case after its tolerance correction. Two consecutive production builds were stable. Startup preflight passed, the Flask app started cleanly on port `5051`, and unauthenticated `/api/test` returned its expected structured OAuth `401` recovery response (no local interactive OAuth session was available for a live Jira identity check).

**Goal:** Make the Department group star a single personal preference for each authenticated workspace/user, require a newcomer to choose one data-bearing group, and load that group's actual dashboard data only after the preference save succeeds while keeping later dashboard group changes temporary.

**Architecture:** Retain the existing `user_group_preferences.active_group_id` column and `activeGroupId` wire key for migration compatibility, but make their persisted DB meaning explicit: the user's one personal favorite group. Validate the raw `/api/groups-preferences` request before any lossy normalization, keep `onboardingRequired` true until one known group with at least one configured team is saved as both visible and favorite, then release the existing sprint loaders with that group's exact id/team scope. Shared `defaultGroupId` remains a legacy workspace/file configuration field and is never presented or mutated as an authenticated DB user's star; the preferences hook owns a separate Settings favorite draft while `dashboard.jsx` owns transient current scope and the stale-scope cleanup gate.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy, React 19, Node test runner, Playwright, esbuild, existing GA4/GTM `settings_action` and `filter_changed` contracts.

**Spec:** Approved product corrections in the 2026-08-25 and 2026-08-26 task conversation. This plan is the canonical star behavior and selection-UI contract; `EXEC-user-onboarding-tour.md` consumes it without redefining it.

## Global Constraints

- In workspace DB mode, exactly one valid `active_group_id` is the authenticated user's personal favorite group.
- A valid workspace DB favorite is a known group with at least one non-empty configured `teamIds` value. Empty-team groups remain valid shared drafts but cannot be selected as a personal favorite because ENG deliberately returns no scoped data for them.
- The API and DB keep the existing `activeGroupId`/`active_group_id` names for compatibility. Frontend draft code may use `favoriteGroupId`/`favoriteGroupDraftId` to make the semantics clear.
- Shared `defaultGroupId` must never be written, forced visible, preferred, or displayed as an authenticated DB user's favorite.
- Explicitly choosing the same group id that happens to equal shared `defaultGroupId` is valid; sending a `defaultGroupId` request field is not and returns `400 unsupported_group_preference_field`.
- File/JSON mode has no authenticated per-user DB boundary and retains its current shared-default behavior; this plan must not break import/export compatibility.
- First-run group selection is single-select: no preselection, one native radio, outlined/filled star, choosing another group moves the star, and the only star cannot be cleared without choosing another group.
- The first preference-row save must contain exactly one known `visibleGroupIds` id and the same `activeGroupId`. Later Settings saves may expose multiple groups but still require exactly one visible favorite.
- `/api/groups-preferences` accepts one JSON object with exactly `visibleGroupIds` and `activeGroupId`; validate container types, strings, duplicates, known ids, membership, and favorite eligibility against the raw request before normalization.
- A personal favorite is always visible in that user's controls and cannot be hidden until another visible group is starred.
- Dashboard Group-dropdown changes are temporary scope changes. They do not mutate the Settings favorite draft or issue `/api/groups-preferences`; bootstrap/reload starts from the persisted personal favorite.
- `onboardingRequired` is monotonic during mandatory selection: opening, saving, cancelling, or failing the shared group editor never clears it. Only a valid successful personal-preference response with its canonical group snapshot may clear it.
- While `onboardingRequired` is true, abort in-flight group-scoped requests, ignore late completions, clear previously rendered group data, and issue no task, alert, stats, dependency, capacity, or Scenario request for an unresolved group.
- A successful preference response includes the canonical server-side group-config snapshot used for validation. Apply that snapshot, persisted favorite state, and transient current scope before the existing Product/Tech loaders run; never derive the first load from a possibly stale pre-save client draft.
- The released Product/Tech requests must contain only the chosen `groupId` and that response snapshot's configured `teamIds` and must render their returned issue data.
- Personal preference writes use documented last-write-wins semantics per workspace/user. A concurrent first-row insert must not surface an unhandled uniqueness error; retry against the winning row and return the final saved preference.
- A `401` preference-save response with a safe app-owned `/login...` URL renders a visible **Sign in again** action; unsafe/external URLs are never rendered or followed.
- No new endpoint, DB column, dependency, startup request, Jira mutation, or Home/Townsquare route is introduced.
- Reuse existing star, radio, modal, group-list, dropdown, focus, and settings footer styles. Do not add bespoke control geometry, magic-number widths, or shared-component layout overrides.
- Analytics sends no group id/name and adds no event name or custom dimension. Remove the now-constant first-run `selected_count_bucket`; retain bucketed available-group count only.
- Do not hand-edit `frontend/dist/`; rebuild it from source.

## Scenario Contract

| Scenario | Required result |
| --- | --- |
| First DB/OAuth preference, one eligible group | Nothing is preselected; Continue is disabled until the user clicks the group; the row then shows one filled star, saves that group as visible/favorite, and renders scoped Product/Tech data returned for its teams. |
| First preference, many groups | Search filters locally; one selection survives query changes; clicking another eligible group moves the only filled star. |
| Empty-team group | The row explains that teams must be configured, its radio cannot be selected, and Configure opens the existing group editor without releasing group-scoped loading. |
| No eligible groups | Configure remains available; Save, Cancel, validation failure, and auth failure all return to or preserve mandatory selection without issuing group-scoped data requests. |
| Invalid first payload | Invalid JSON, a non-object body, missing keys, wrong types, zero/two/duplicate visible ids, null/mismatched/unknown favorite, or an unknown visible id is rejected without normalization inventing a favorite. |
| Forbidden request field | `defaultGroupId`, identity/workspace/site keys, or any unknown extra key returns `400 unsupported_group_preference_field`; an explicit eligible choice whose id equals the shared default is allowed. |
| Existing user with several visible groups | Exactly one personal star is shown; all other groups may remain visible. |
| User stars a hidden eligible group in Settings | The new favorite becomes visible, the old favorite may then be hidden, and one Save persists both preference fields. Empty-team groups cannot become favorites. |
| User clicks the already-starred group | No-op; the user cannot end with zero favorites. |
| Two users in one workspace | Each can star a different group; neither changes the other's row or shared group payload. |
| Same user in two workspaces | Each workspace retains its own personal star. |
| Shared group config is edited | Shared catalog fields save with revision protection, but personal star changes travel only through `/api/groups-preferences`. |
| Dashboard group switch | Current data scope changes and existing `filter_changed` analytics fires; the persisted star and Settings UI remain unchanged. |
| Reload/bootstrap | A valid stored personal favorite wins over local transient scope and shared `defaultGroupId`. |
| Favorite group is deleted or loses all teams | Preferences return `onboardingRequired:true`, no favorite is invented, in-flight scope requests are aborted/ignored, rendered scope data is cleared, and requests remain blocked until explicit replacement selection. |
| Preference save succeeds | No scoped request starts before the `200`; the response's canonical group snapshot replaces any stale client copy, then exactly the selected group's current id/team ids reach the Product/Tech requests and a synthetic returned issue is visible. |
| Active sprint resolves after preference save | The valid favorite remains resolved without sending an empty-sprint request; when the existing sprint bootstrap selects the active sprint, the normal effect loads that sprint with the saved snapshot group/team scope. |
| Preference save fails or auth expires | Mandatory selection and the chosen radio remain; no scoped request starts; retry is available, and a safe `401 loginUrl` is exposed as **Sign in again**. |
| Preference save returns an invalid/incomplete scope snapshot | Treat the response as unusable: keep mandatory selection gated, render a retryable load error, and issue no group-scoped request. |
| Concurrent first save | Same-user/same-workspace requests resolve without `500`; the final committed request wins and the response/bootstrap agree with that row. |
| Shared save succeeds but preference save fails | The shared revision remains committed, the personal favorite draft remains dirty, group data stays gated when no valid persisted favorite exists, and retry sends only the personal preference. |
| File/JSON mode | Existing shared-default behavior and imports remain unchanged; no DB personal-preference claim is shown. |

## First-Run Load State Machine

| State | Entry condition | Allowed UI/action | Data/loading invariant | Exit |
| --- | --- | --- | --- | --- |
| `groups_loading` | Group bootstrap has not resolved | Existing loading shell only | No group-scoped request starts from an unresolved preference | Valid stored preference → `resolved`; missing/invalid preference → `required_unselected` |
| `required_unselected` | `onboardingRequired:true`, no eligible choice | Search, choose an eligible radio, or open Configure | Active group is `null`; old requests are aborted/version-invalidated; scoped data, errors, and loading flags are cleared | Choose → `required_selected`; Configure → `configuring` |
| `required_selected` | One eligible local choice | Change radio, Continue, or Configure | Choice is draft-only; zero group-scoped requests | Continue → `saving_preference`; Configure → `configuring` |
| `configuring` | Existing shared group editor is open from mandatory selection | Edit shared groups; Save/Cancel/close | `onboardingRequired` remains true and the scoped load gate remains closed | Close/save success/save failure → recompute eligibility and return to `required_unselected` or `required_selected` |
| `saving_preference` | One guarded POST is in flight | Disabled Continue; no duplicate submit | Zero group-scoped requests; current data remains cleared | Valid `200` → atomically apply its group snapshot/preferences/current group, then `resolved`; error/invalid snapshot → `required_selected` |
| `resolved` | Stored favorite and the applied canonical snapshot contain the same known group with non-empty teams | Existing dashboard and temporary Group switch | Once `selectedSprint` is available, Product/Tech load with snapshot group/team scope; no empty-sprint request; scope-version predicate owns every completion | Catalog invalidates favorite → `required_unselected`; temporary switch stays `resolved` without preference write |

React state updates for the valid `200` must be committed as one release boundary: `groupsConfig` from `groupsConfigSnapshot`, `groupPreferences` from `preferences`, and transient `activeGroupId` from the same `preferences.activeGroupId`. The primary load effect must observe all three resolved values together; a render with `onboardingRequired:false` plus stale group teams is forbidden.

## Endpoint Contract Matrix

| Method/path | Policy | Request | Success | Errors | Required proof |
| --- | --- | --- | --- | --- | --- |
| `GET /api/groups-config` | Existing `authenticated_read` | None | Existing shared config plus `preferences:{customized,preferenceExists,onboardingRequired,visibleGroupIds,activeGroupId,effectiveVisibleGroupIds}` | Existing auth/config errors | Workspace DB response never replaces the personal favorite with `defaultGroupId`; missing, unknown, hidden, or empty-team favorite returns `onboardingRequired:true`, `activeGroupId:null`, and empty effective scope. |
| `POST /api/groups-preferences` | Existing `user_write`, token-bound CSRF, `X-Requested-With` | Exactly `{visibleGroupIds:string[],activeGroupId:string}` | `200 {preferences:{customized:true,preferenceExists:true,onboardingRequired:false,visibleGroupIds,activeGroupId,effectiveVisibleGroupIds},groupsConfigSnapshot:{version,configRevision,source:'workspace_db',groups,defaultGroupId,preferences}}`; optional existing warnings stay inside the snapshot | `400 invalid_json`; `400 invalid_group_preferences`; `400 unsupported_group_preference_field`; existing `401` with optional safe `/login...`; existing auth/CSRF `403`; `409 group_preferences_db_required` | Raw request validation precedes normalization; first row requires one matching eligible id; later rows allow multiple distinct known visible ids with one visible eligible favorite; snapshot embeds the same preference object and the exact groups used for validation; concurrent first insert is recovered; user/workspace isolation. |
| `POST /api/groups-config` | Existing shared-config policy and revision contract | Existing shared payload with `baseRevision` | Existing response | Existing validation/conflict/auth errors | Personal-star interaction does not change or add `defaultGroupId`; partial shared-success/preference-failure recovery preserves the committed shared revision and dirty favorite draft. |

## File Map

### Create

- `docs/features/personal-group-star.md`: durable explanation of personal favorite versus temporary scope and file-mode compatibility.

### Modify

- `backend/services/shared_group_config.py:195-324`: source-aware visibility/favorite normalization and first-row validation.
- `backend/routes/settings_routes.py:34-51,459-482`: exact preference request schema, invalid-JSON/error mapping, and canonical group snapshot response.
- `frontend/src/settings/groupVisibilityUtils.js:13-96`: source-aware visibility, single first-run payload, and favorite-aware signatures.
- `frontend/src/settings/useGroupVisibilityPreferences.js:14-253`: separate first-run favorite, Settings favorite draft, and transient dashboard scope.
- `frontend/src/settings/FirstRunGroupSelectionModal.jsx:3-89`: replace checkbox multi-select/count with one accessible starred radio choice.
- `frontend/src/settings/TeamGroupsSettings.jsx:3-250`: render/edit personal star in workspace DB mode and retain file-mode compatibility.
- `frontend/src/dashboard.jsx:1000-1040,1620-1667,3060-3298,5483-5551,12495-12580,15456-16064`: remove shared-default star wiring in DB mode, preserve the mandatory loading gate, clear invalid scope data, and display the persisted personal star separately from current scope.
- `frontend/src/eng/useEngSprintData.js:238-311`: let primary Product/Tech loads reject late results after the selected group scope changes.
- `frontend/src/styles/settings/first-run.css:24-149`: remove count layout, place radio/name/team-count/star on one row, and reuse existing star visual sizing.
- `tests/test_shared_group_config_service.py`: first-row validation, favorite/default separation, deletion, user/workspace isolation.
- `tests/test_shared_group_config_routes.py`: exact request/error contract and CSRF/isolation coverage.
- `tests/test_group_visibility_utils.js`: source-aware visibility and single-star payload coverage.
- `tests/test_dashboard_alert_source_guards.js`: primary-load stale-result guard coverage without changing deferred-alert ownership.
- `tests/ui/shared_department_groups.spec.js`: picker, Settings, dashboard, persistence, and screenshot scenarios.
- `tests/test_analytics_source_guards.js`: constant-count removal and forbidden group identity guard.
- `tests/test_frontend_api_source_guards.js`: exact CSRF request payload and safe auth-recovery URL coverage.
- `docs/README_ANALYTICS.md`: narrow analytics impact decision.
- `docs/features/README.md`: index the feature guide.
- `docs/plans/README.md`: review the existing prerequisite index during implementation and update it only in the completion/rename task.
- `docs/plans/EXEC-user-onboarding-tour.md`: update only the prerequisite filename/status after this plan is fully verified; do not change onboarding behavior.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`: generated output.

### Read Only / Must Not Modify

- `backend/db/models.py`: `active_group_id` already provides the correct user/workspace storage boundary; do not add or rename a column.
- Onboarding tour behavior and `onboarding_done`: owned only by `EXEC-user-onboarding-tour.md`; Task 6 may mechanically update this prerequisite plan's filename/status references.
- Jira/Home/Townsquare mutation and credential paths.

---

### Task 1: Enforce the personal-favorite preference contract

**Files:**
- Modify: `backend/services/shared_group_config.py:195-324`
- Modify: `backend/routes/settings_routes.py:34-51,459-482`
- Test: `tests/test_shared_group_config_service.py`
- Test: `tests/test_shared_group_config_routes.py`

**Interfaces:**
- Consumes: `groups_config.source`, `groups_config.groups`, legacy `defaultGroupId`, and `UserGroupPreference.active_group_id`.
- Produces: `_validate_raw_group_preferences(payload, groups_config, preference_exists)`, normalized `preferences.activeGroupId` as one eligible personal favorite for `workspace_db`, `InvalidGroupPreferences` for invalid first/existing saves, and a route-level GET-compatible `groupsConfigSnapshot` carrying that same preference object.
- Preserves: file/JSON shared-default fallback and the current route/auth/CSRF envelope.

- [x] **Step 1: Add failing service tests for source-aware favorite semantics**

Use a DB-source group config whose shared default differs from both users' choices and whose eligible groups carry synthetic teams:

```python
groups = {
    'source': 'workspace_db',
    'groups': [
        {'id': 'default', 'name': 'Default', 'teamIds': ['team-default']},
        {'id': 'platform', 'name': 'Platform', 'teamIds': ['team-platform']},
        {'id': 'mobile', 'name': 'Mobile', 'teamIds': ['team-mobile']},
        {'id': 'empty', 'name': 'Empty', 'teamIds': []},
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

Add cases proving the shared default is not inserted, another user can save `mobile`, another workspace remains isolated, and an existing row may save `['platform','mobile']` only when its `activeGroupId` is one of those ids and has teams. Add load cases proving a deleted, hidden, unknown, or now-empty-team stored favorite returns `onboardingRequired:true`, `activeGroupId:None`, and `effectiveVisibleGroupIds:[]` without rewriting the row.

- [x] **Step 2: Add failing first-row and invalid-favorite route tests**

For a user without a preference row, assert each payload returns `400 invalid_group_preferences` without being repaired by normalization:

```python
invalid_payloads = (
    {'visibleGroupIds': [], 'activeGroupId': None},
    {'visibleGroupIds': ['platform', 'mobile'], 'activeGroupId': 'platform'},
    {'visibleGroupIds': ['platform'], 'activeGroupId': None},
    {'visibleGroupIds': ['platform'], 'activeGroupId': 'mobile'},
    {'visibleGroupIds': ['platform', 'platform'], 'activeGroupId': 'platform'},
    {'visibleGroupIds': ['unknown'], 'activeGroupId': 'unknown'},
    {'visibleGroupIds': ['empty'], 'activeGroupId': 'empty'},
    {'visibleGroupIds': 'platform', 'activeGroupId': 'platform'},
    {'visibleGroupIds': ['platform'], 'activeGroupId': 7},
)
```

Also assert:

- malformed JSON and a non-object JSON body return `400 invalid_json` and `400 invalid_group_preferences` respectively;
- missing required keys return `400 invalid_group_preferences`;
- `defaultGroupId`, identity/workspace/site keys, and an arbitrary future key return `400 unsupported_group_preference_field`;
- explicitly selecting eligible group `default` remains valid even though its id equals the shared default;
- missing `X-Requested-With` or token-bound CSRF remains `403`;
- file mode remains `409 group_preferences_db_required`;
- a valid first request returns the complete success shape from the endpoint matrix, with `groupsConfigSnapshot.preferences == preferences` and the chosen group's canonical non-empty `teamIds`;
- a simulated unique-insert race retries as an existing-row update and returns `200`, while two sequential conflicting saves demonstrate documented last-write-wins state.

- [x] **Step 3: Run focused backend tests and verify RED**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service tests.test_shared_group_config_routes
```

Expected: failures show shared `defaultGroupId` is still forced/preferred, raw null/unknown/duplicate values are normalized into valid-looking preferences, empty-team favorites are accepted, arbitrary fields are ignored, malformed JSON is collapsed to `{}`, the response omits the canonical group snapshot, and concurrent insertion is not recovered. Auth/bootstrap fixture failures are not the required RED result.

- [x] **Step 4: Implement source-aware normalization and exact first-row validation**

First make route parsing and field ownership exact before calling the service:

```python
from werkzeug.exceptions import BadRequest

_GROUP_PREFERENCE_FIELDS = {'visibleGroupIds', 'activeGroupId'}

if not request.is_json:
    return jsonify({'error': 'invalid_json'}), 400
try:
    payload = request.get_json()
except BadRequest:
    return jsonify({'error': 'invalid_json'}), 400
if not isinstance(payload, dict):
    return jsonify({'error': 'invalid_group_preferences'}), 400
unsupported = sorted(set(payload) - _GROUP_PREFERENCE_FIELDS)
if unsupported:
    return jsonify({'error': 'unsupported_group_preference_field'}), 400
```

Do not use `_unsupported_group_fields` as the complete preference schema: it protects identity fields but intentionally does not reject unknown future group-config fields.

Then branch shared-default compatibility by source:

```python
uses_personal_preferences = str((groups_config or {}).get('source') or '') == GROUPS_SOURCE_DB
if not uses_personal_preferences:
    default_group_id = str((groups_config or {}).get('defaultGroupId') or '').strip()
    if default_group_id and default_group_id in ids and default_group_id not in visible:
        visible.insert(0, default_group_id)
```

Make `_resolve_active_group_id` source-aware. File/JSON mode keeps default/first-visible fallback. Workspace DB loads return only an explicitly stored, visible, known, data-bearing favorite; otherwise `normalize_group_preferences` returns `onboardingRequired:true`, `activeGroupId:None`, and empty effective scope.

During `save_group_preferences`, query the workspace/user row first and validate the raw payload before calling `normalize_group_preferences`:

```python
visible_ids = payload.get('visibleGroupIds')
favorite_group_id = payload.get('activeGroupId')
if not isinstance(visible_ids, list) or not all(isinstance(value, str) for value in visible_ids):
    raise InvalidGroupPreferences('visibleGroupIds must be an array of group ids')
if not isinstance(favorite_group_id, str) or not favorite_group_id.strip():
    raise InvalidGroupPreferences('activeGroupId must be a group id')
normalized_visible_ids = [value.strip() for value in visible_ids]
if any(not value for value in normalized_visible_ids) or len(set(normalized_visible_ids)) != len(normalized_visible_ids):
    raise InvalidGroupPreferences('visibleGroupIds must contain distinct non-empty group ids')
if set(normalized_visible_ids) - set(_group_ids(groups_config)):
    raise InvalidGroupPreferences('visibleGroupIds contains an unknown group')
if row is None:
    if len(normalized_visible_ids) != 1 or favorite_group_id.strip() != normalized_visible_ids[0]:
        raise InvalidGroupPreferences('first run must select exactly one personal favorite group')
elif favorite_group_id.strip() not in normalized_visible_ids:
    raise InvalidGroupPreferences('personal favorite group must remain visible')
favorite_group = next(group for group in groups_config['groups'] if group['id'] == favorite_group_id.strip())
if not [str(team_id or '').strip() for team_id in favorite_group.get('teamIds') or [] if str(team_id or '').strip()]:
    raise InvalidGroupPreferences('personal favorite group must have at least one configured team')
```

Only after this validation may the service normalize and persist. Never update shared group config from this service.

Wrap first insertion so `IntegrityError` from `uq_user_group_preferences_workspace_user` opens a fresh transaction, reloads the winning row, revalidates the same raw payload as an existing-row save, and applies it. The endpoint remains last-write-wins and never leaks an unhandled database exception.

After persistence, the route copies the already loaded/validated `groups_config`, attaches the returned `preferences`, and returns it beside the top-level preferences:

```python
groups_config_snapshot = dict(groups_config)
groups_config_snapshot['preferences'] = preferences
return jsonify({
    'preferences': preferences,
    'groupsConfigSnapshot': groups_config_snapshot,
})
```

Do not reload through a second endpoint and do not omit `source`, `configRevision`, `groups`, `defaultGroupId`, or the embedded matching preferences; this snapshot is the frontend's release boundary for current team scope.

- [x] **Step 5: Run focused backend tests and commit**

Run the Step 3 command. Expected: PASS for exact JSON/field/type validation, eligible first-row validation, existing-row multi-visibility, concurrent insert recovery, deletion/empty-team recovery, file compatibility, and user/workspace isolation.

Commit:

```bash
git add backend/services/shared_group_config.py backend/routes/settings_routes.py tests/test_shared_group_config_service.py tests/test_shared_group_config_routes.py
git commit -m "fix: make group favorite user-scoped"
```

### Task 2: Replace first-run multi-select with one explicit star

**Files:**
- Modify: `frontend/src/settings/groupVisibilityUtils.js:13-96`
- Modify: `frontend/src/settings/useGroupVisibilityPreferences.js:39-165`
- Modify: `frontend/src/settings/FirstRunGroupSelectionModal.jsx:3-89`
- Modify: `frontend/src/dashboard.jsx:1620-1667,5483-5551,16053-16064`
- Modify: `frontend/src/eng/useEngSprintData.js:238-311`
- Modify: `frontend/src/styles/settings/first-run.css:24-149`
- Test: `tests/test_group_visibility_utils.js`
- Test: `tests/test_dashboard_alert_source_guards.js`
- Test: `tests/test_frontend_api_source_guards.js`
- Modify/Test: `tests/ui/shared_department_groups.spec.js`

**Interfaces:**
- Consumes: Task 1's exact first-row API contract.
- Produces: `buildFirstRunGroupPreferencesPayload(selectedGroupId)`, `firstRunFavoriteGroupId:string|null`, `firstRunRecoveryLoginUrl:string`, `selectFirstRunFavoriteGroup(groupId)`, `applyPreferenceGroupsSnapshot(snapshot)`, and a primary-load `shouldApplyResult` guard tied to group/sprint scope.
- Preserves: existing local search, mandatory selection across group-editor open/close, deferred alert loading, and the current shared group editor. Configure-your-own explanatory expansion belongs to onboarding.

- [x] **Step 1: Add failing helper and picker tests**

Add the exact helper assertion:

```js
assert.deepEqual(
    buildFirstRunGroupPreferencesPayload('mobile'),
    { visibleGroupIds: ['mobile'], activeGroupId: 'mobile' },
);
```

Playwright must prove:

- no star is preselected with one or many eligible groups and Continue is disabled initially;
- rows contain native radios rather than checkboxes, clicking another eligible row moves the one filled star, and selection survives search changes;
- an empty-team row is labelled **Configure teams before choosing this group**, has a disabled radio, and cannot become selected;
- opening Add/Configure, cancelling it, failing its shared save, and completing its shared save leave `onboardingRequired` true and issue no `/api/tasks-with-team-name`, alert, stats, dependency, capacity, or Scenario request;
- Continue posts the exact one-id payload once even after a rapid double click;
- while the preference POST is delayed, no scoped request starts; seed the browser with stale `team-old` but return canonical `team-platform` in `groupsConfigSnapshot`, then prove Product/Tech calls use `groupId=platform` and only `teamIds=team-platform` and render a synthetic `PLAT-1` story;
- if active-sprint bootstrap is still delayed when the preference response succeeds, no empty-sprint task request starts; releasing the sprint response later triggers the same exact group/team request and visible issue;
- a `200` missing a matching eligible `groupsConfigSnapshot` keeps the modal gated, shows a retryable error, and starts no scoped request;
- a `401` with `/login?reason=session_expired` preserves the chosen radio and renders **Sign in again**, while an external `loginUrl` renders no link;
- when a previously valid favorite is deleted or loses all teams, active requests are aborted/ignored, visible issue rows and loading/errors are cleared, and delayed old-scope success or failure responses never alter the replacement scope or trigger auth recovery.

- [x] **Step 2: Run focused frontend tests and verify RED**

Run:

```bash
node --test tests/test_group_visibility_utils.js
node --test tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js --grep "first-run|personal star|mandatory"
```

Expected: failures because the helper accepts arrays/default, the modal uses checkboxes/count, one shared-default group is auto-selected, empty-team groups are selectable, Add group clears the mandatory gate, primary loads have no per-scope late-result predicate, auth recovery has no visible link, and the browser proof returns no visible issue.

- [x] **Step 3: Implement single-id state and payload**

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
const [firstRunRecoveryLoginUrl, setFirstRunRecoveryLoginUrl] = React.useState('');
const firstRunSaveInFlightRef = React.useRef(false);
const selectFirstRunFavoriteGroup = React.useCallback((groupId) => {
    setFirstRunFavoriteGroupId(String(groupId || '').trim() || null);
    setFirstRunRecoveryLoginUrl('');
}, []);
```

Reset selection to null whenever mandatory selection opens for a new unresolved preference. Do not reset it for an ordinary failed POST, search change, or Settings round trip. Do not preselect the sole group or shared default. Compute eligibility from normalized non-empty `teamIds`; reject selection of an ineligible id in both the setter and submit path.

Guard submit with `firstRunSaveInFlightRef` before the first `await`, clear it in `finally`, and save only the one-id payload. Before releasing the gate on success, require `groupsConfigSnapshot.source === 'workspace_db'`, matching embedded/top-level preferences, a matching selected group, and at least one normalized snapshot `teamIds` value. Apply that snapshot through a dashboard callback, then set normalized persisted preferences and current scope from the same response in one React batch. A missing/mismatched snapshot is a retryable response error and must leave `onboardingRequired:true`. On `401`, keep the selection and expose `errorPayload.loginUrl` only when it matches `^/login(?:[/?#]|$)`; reject protocol-relative and lookalike paths such as `//login.example` and `/login.example`. Clear the recovery URL on retry, success, and non-auth errors.

Change `openFirstRunAddGroup` so it opens the existing editor without mutating `groupPreferences.onboardingRequired`. The render already suppresses the mandatory modal while `showGroupManage` is true; closing Settings therefore returns to the same unresolved selection state.

Implement `applyPreferenceGroupsSnapshot` in `dashboard.jsx` using the same normalization/state rules as group bootstrap: update `groupsConfig`, warnings, and source from the response snapshot before current scope can resolve. If Settings is open and its shared draft was already clean or successfully committed in this Save, align `groupDraft` and `groupDraftBaselineRef` to the snapshot too; never use this callback to clear `groupPreferencesBaselineRef` or a failed personal favorite draft.

Extract the data-reset portion of `invalidateSprintDataForConfigSave` into a local `clearEngGroupScopeData()` callback and call it when `groupsLoading` finishes with `groupPreferences.onboardingRequired === true`. It must:

- call `abortSprintFetches()` and increment the existing alert cohort/version guard;
- clear `groupStateRef`, Product/Tech/loaded task arrays, Epic/detail arrays, ready-to-close/backlog/missing-info arrays, dependencies, capacity, Scenario, and group-scoped stats results;
- reset `tasksFetched`, `techLoaded`, `lastLoadedSprintRef`, sprint-load refs, primary/general loading flags, and group-scoped error state;
- set transient `activeGroupId` to `null` without modifying the persisted preference object.

Extend `loadProductTasks` and `loadTechTasks` to accept `shouldApplyResult` and pass it into `fetchTasks`. The dashboard primary-load effect captures a monotonically increasing group-load version plus `selectedSprint`, current group id, and team signature, passes the predicate to both loaders, and invalidates it in cleanup. In `fetchTasks`, check the predicate before successful Epic/task-related writes and again before error text, auth recovery, redirects, or general-loading writes; always clean up the request controller. In each outer loader, check it before task/loaded-task/fetched/sprint-ref writes and before clearing Product/Tech loading. This prevents an old request's `catch` or `finally` from overwriting the new scope while preserving the existing alert-specific predicate and request ordering.

- [x] **Step 4: Render an accessible starred radio list**

Use heading **Choose your group** and subtitle **Star one group to use as your personal starting group**. Remove selected count and render one native radio plus visual star per row. Disable ineligible rows without hiding them:

```jsx
<input
    type="radio"
    name="first-run-favorite-group"
    checked={selectedGroupId === group.id}
    disabled={!group.teamIds?.length}
    onChange={() => onSelectGroup(group.id)}
/>
<span className="department-first-run-star" aria-hidden="true">
    {selectedGroupId === group.id ? '★' : '☆'}
</span>
```

Keep Continue disabled until an eligible `selectedGroupId` is non-empty. Render the safe recovery URL as `<a href={recoveryLoginUrl}>Sign in again</a>` beside the retryable error. Do not add onboarding Skip, tour copy, or replay here.

Update `frontend/src/styles/settings/first-run.css` to use four explicit columns—radio, minmax name, team-count, star—and reuse `.group-list-star`'s `0.85rem` star sizing/color. Do not introduce a 30×30 button: Settings keeps the shared `.group-star-button` 26×26 contract, while the first-run star remains non-interactive visual state next to the native radio. Add compact-width assertions that the name, team count, and star stay in the same row without clipping.

- [x] **Step 5: Run focused frontend tests and commit**

Run the Step 2 commands. Expected: PASS with exactly one eligible explicit star, a monotonic mandatory gate, safe auth recovery, no scoped request before save success, server-snapshot Product/Tech scope after success, visible synthetic data, and no stale old-scope completion.

Commit:

```bash
git add frontend/src/settings/groupVisibilityUtils.js frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/settings/FirstRunGroupSelectionModal.jsx frontend/src/dashboard.jsx frontend/src/eng/useEngSprintData.js frontend/src/styles/settings/first-run.css tests/test_group_visibility_utils.js tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js tests/ui/shared_department_groups.spec.js
git commit -m "fix: require one first-run favorite group"
```

### Task 3: Make Settings and dashboard stars personal

**Files:**
- Modify: `frontend/src/settings/groupVisibilityUtils.js:33-66,89-92`
- Modify: `frontend/src/settings/useGroupVisibilityPreferences.js:72-253`
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx:3-250`
- Modify: `frontend/src/dashboard.jsx:1000-1040,3060-3298,12495-12580,15780-15855`
- Test: `tests/test_group_visibility_utils.js`
- Test: `tests/test_frontend_api_source_guards.js`
- Modify/Test: `tests/ui/shared_department_groups.spec.js`

**Interfaces:**
- Consumes: persisted `groupPreferences.activeGroupId` from Task 1.
- Produces: `favoriteGroupDraftId`, `setFavoriteGroupDraft(groupId)`, `settingsPreferenceRecoveryLoginUrl`, source-aware visibility/current-scope helpers, and `personalGroupPreferencesEnabled` UI mode.
- Preserves: shared Save-all ordering with explicit partial-save recovery, dirty-state protection, file-mode shared default, visible-group editing, and transient dashboard selection handlers.

- [x] **Step 1: Add failing Settings/dashboard behavior and geometry tests**

Add Playwright cases proving:

1. Workspace DB group list/editor/dashboard dropdown all mark the same persisted personal favorite.
2. Starring another group moves one star, ensures it is visible, and makes Settings dirty without changing `groupDraft.defaultGroupId`.
3. Save posts the favorite only through `/api/groups-preferences`; the shared groups-config payload retains its previous `defaultGroupId` byte-for-byte.
4. The favorite visibility checkbox cannot remove the favorite; after another star is chosen the old group can be hidden.
5. An empty-team group cannot be starred and exposes **Configure teams before setting as favorite**; removing every team from the favorite blocks Save until a different eligible favorite is chosen or teams are restored.
6. Two user fixtures retain different stars in one workspace.
7. Header Group-dropdown selection changes current scope and existing analytics but sends no preference write and does not move the Settings star.
8. A workspace DB response with shared default `default` and personal visibility `['platform']` exposes only `platform`; file mode still forces/prefers `default`.
9. When shared groups save succeeds and the preference POST fails, the shared revision/baseline remains committed, the favorite draft remains dirty and selected, Settings stays open, and retry posts only `/api/groups-preferences`.
10. A shared revision `409` sends no preference request and preserves both drafts for Keep mine/Discard mine. If the chosen group becomes stale before the preference POST, refresh/reconciliation keeps Settings open and requires a new eligible favorite.
11. A successful preference response carrying a newer canonical config revision/team list updates Settings and the next dashboard load from that snapshot rather than the pre-save draft.
12. A Settings preference `401` renders a safe **Sign in again** link and preserves the draft; external login URLs are ignored.
13. File-mode fixture retains current shared-default star behavior.
14. Star buttons are native buttons using the shared 26×26 geometry, visible focus, accessible names, no clipping, and one filled star.

- [x] **Step 2: Run the focused UI suite and verify RED**

Run:

```bash
npx playwright test tests/ui/shared_department_groups.spec.js --grep "favorite|star|temporary group scope|file mode|partial|recovery|stale"
```

Expected: failures because frontend helpers still force/prefer shared `defaultGroupId`, the Settings/dashboard star reads and mutates that field, the preference draft uses transient `activeGroupId`, empty-team groups remain star-eligible, and partial preference failures have no explicit recovery contract.

- [x] **Step 3: Separate favorite draft from current dashboard scope**

In the preferences hook:

```js
const [favoriteGroupDraftId, setFavoriteGroupDraftId] = React.useState(null);

const setFavoriteGroupDraft = React.useCallback((groupId) => {
    const normalizedId = String(groupId || '').trim();
    const group = (groupDraft?.groups || []).find(candidate => candidate.id === normalizedId);
    const hasTeams = (group?.teamIds || []).some(teamId => String(teamId || '').trim());
    if (!normalizedId || !hasTeams) return;
    setFavoriteGroupDraftId(normalizedId);
    setVisibleGroupDraftIds((previous) => (
        previous.includes(normalizedId) ? previous : [...previous, normalizedId]
    ));
}, [groupDraft?.groups]);
```

Initialize the draft from `groupPreferences.activeGroupId`, never current dashboard scope. Use `favoriteGroupDraftId` in the dirty signature and preference save payload. Prevent hiding it and include an ineligible-favorite validation error in the unified Settings save gate. After a successful Settings save, make the saved favorite current; ordinary dashboard scope changes continue to update only transient `activeGroupId`.

Make both helpers source-aware rather than relying only on the backend response:

```js
const usesPersonalPreferences = groupsConfig?.source === 'workspace_db';
// effectiveVisibleGroupIds: prepend defaultGroupId only when !usesPersonalPreferences.
// resolveVisibleActiveGroupId: prefer defaultGroupId only when !usesPersonalPreferences.
```

Add unit cases for customized and non-customized DB preferences, an explicit personal favorite whose id equals the shared default, invalid/empty effective scope, and unchanged `file`/`env`/`auto` fallbacks.

Keep preference errors structured through `status`, `code`, and a URL accepted only by `^/login(?:[/?#]|$)`. On shared-success/preference-failure, keep the shared response applied so `groupDraftBaselineRef` advances to the committed revision, but do not update `groupPreferencesBaselineRef` and do not clear `favoriteGroupDraftId` or `visibleGroupDraftIds`. The next Save therefore sees shared groups as clean and preferences as dirty, so it retries only `/api/groups-preferences`.

On preference success, apply its `groupsConfigSnapshot` before making the saved favorite current so a concurrent team-list change cannot launch a stale-scope request. On `invalid_group_preferences` caused by a stale catalog, reload `/api/groups-config`, preserve still-known visible draft ids, clear an invalid favorite draft, keep Settings open, and require a new eligible favorite. On shared `409`, preserve the existing Keep mine/Discard mine path and prove no personal preference request was sent before conflict resolution. Personal preference updates otherwise remain last-write-wins.

- [x] **Step 4: Render source-aware personal stars without layout reinvention**

Pass `personalGroupPreferencesEnabled={groupsConfig.source === 'workspace_db'}`. In workspace DB mode:

- derive list/editor stars from `favoriteGroupDraftId` and dropdown star from persisted `groupPreferences.activeGroupId`;
- replace `toggleDefaultGroupDraft` with `setFavoriteGroupDraft` for the user-facing star;
- use **My favorite group**, **Set {name} as my favorite group**, and **{name} is my favorite group**;
- disable the star for empty-team groups with the accessible explanation **Configure teams before setting as favorite**;
- make clicking the filled star a no-op;
- disable favorite removal from **Show in my controls**;
- never label a DB star **Default group**.

When the flag is false, retain the existing file/JSON shared-default UI. Reuse `.group-list-star` and the existing 26×26 `.group-star-button`; do not override shared layout.

When a Settings preference save returns `401` with a safe `/login...`, render **Sign in again** beside the existing error without closing Settings or clearing dirty state. Reject external, protocol-relative, and `/login`-lookalike URLs in unit and Playwright coverage.

- [x] **Step 5: Run UI tests, inspect screenshots, and commit**

Run the Step 2 command plus:

```bash
node --test tests/test_group_visibility_utils.js tests/test_frontend_api_source_guards.js
```

Capture settled desktop plus mobile screenshots of Settings and the dashboard dropdown. Inspect the actual stars, disabled empty-team state, labels, focus ring, row alignment, clipping, one-star invariant, and safe recovery link.

Commit:

```bash
git add frontend/src/settings/groupVisibilityUtils.js frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/settings/TeamGroupsSettings.jsx frontend/src/dashboard.jsx tests/test_group_visibility_utils.js tests/test_frontend_api_source_guards.js tests/ui/shared_department_groups.spec.js
git commit -m "fix: show personal group favorites"
```

### Task 4: Lock analytics and documentation boundaries

**Files:**
- Modify: `tests/test_analytics_source_guards.js`
- Modify: `docs/README_ANALYTICS.md`
- Create: `docs/features/personal-group-star.md`
- Modify: `docs/features/README.md`
- Review: `docs/plans/README.md` (the plan is already indexed before onboarding)

**Interfaces:**
- Consumes: existing `settings_action` and `filter_changed` events.
- Produces: no new event name, parameter, custom definition, GTM trigger, or runbook action.
- Documents: personal favorite ownership, temporary scope, and file compatibility.

- [x] **Step 1: Add failing analytics source guards**

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

- [x] **Step 2: Run the analytics guard and verify RED**

Run:

```bash
node --test tests/test_analytics_source_guards.js
```

Expected: FAIL because first-run still emits `selected_count_bucket` and the durable contract still describes bucketed selected count for that action.

- [x] **Step 3: Update the durable contracts and feature guide**

Keep existing `settings_action(section=departments, workflow_action=first_run_selection|preference_change)` and `filter_changed(filter_type=group)` ownership. Remove only first-run `selected_count_bucket`; retain `group_count_bucket`. Document that the star's id/name is forbidden and that no event is added for rendering a star.

In `docs/features/personal-group-star.md`, explain personal star versus temporary scope, the data-bearing-group eligibility rule, the monotonic mandatory loading gate, exact first-run selection, selected-scope Product/Tech load handoff, stale-response cleanup, Settings partial-save/retry behavior, safe auth recovery, deletion/empty-team recovery, user/workspace isolation, and file/JSON compatibility. Index the guide in `docs/features/README.md`; verify the existing prerequisite entry in `docs/plans/README.md` remains correct rather than editing it gratuitously.

- [x] **Step 4: Run docs/analytics checks and commit**

Run:

```bash
node --test tests/test_analytics_source_guards.js
git diff --check
```

Expected: PASS with no unsafe identity parameters or whitespace errors.

Commit:

```bash
git add tests/test_analytics_source_guards.js docs/README_ANALYTICS.md docs/features/personal-group-star.md docs/features/README.md
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

- [x] **Step 1: Verify the pinned runtimes before running tests**

Activate the repository's Node 20 toolchain (for example `nvm use` from `.nvmrc`) and verify both runtimes:

```bash
node --version
.venv/bin/python --version
```

Expected: Node reports `v20.x`; Python reports 3.10 or newer. If plain `node`, `npm`, or `npx` fails to start or Node is not 20.x, stop and repair/activate the pinned toolchain before treating any frontend verification as valid. Do not substitute the bundled Node 24 runtime or install into host Python.

- [x] **Step 2: Run focused backend/frontend/UI checks**

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_service tests.test_shared_group_config_routes
node --test tests/test_group_visibility_utils.js tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js
```

Expected: all focused checks pass with raw-schema validation, eligible first-row validation, concurrent insert recovery, personal isolation, monotonic loading gates, selected-scope request parameters, visible synthetic issue data, stale-response rejection, partial-save/auth recovery, file compatibility, temporary scope, accessibility, and screenshots.

- [x] **Step 3: Build twice and prove generated output stability**

Run:

```bash
npm run build
git status --short
npm run build
git diff --exit-code -- frontend/dist
```

Expected: both builds succeed and the second build produces no additional dist change.

- [x] **Step 4: Run full regression suites**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui
```

Expected: all suites pass aside from an explicitly documented environment-only skip. Do not substitute source-only assertions for UI behavior.

- [x] **Step 5: Inspect visual and network evidence**

Open the settled screenshots and verify the one filled star, outlined alternatives, disabled empty-team state, 26×26 Settings star geometry, first-run radio/star alignment, focus ring, safe auth-recovery link, no clipping, personal labels, mobile containment, and unchanged file-mode display.

Inspect the captured request log and prove:

- zero group-scoped data requests before personal-preference `200`, including every Configure path;
- the preference response carries the canonical config revision/group/team snapshot used by the browser;
- afterward Product and Tech use only the chosen `groupId` and that snapshot's configured `teamIds`, never stale pre-save teams;
- the returned synthetic issue appears in the selected scope;
- invalidation aborts/ignores the delayed old-scope response;
- DB personal-star actions never mutate shared `defaultGroupId`;
- a shared-success/preference-failure retry sends only `/api/groups-preferences`.

- [x] **Step 6: Run preflight and final diff review**

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

- [x] **Step 7: Commit generated output**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "build: update personal group star bundle"
```

### Task 6: Close the verified execution plan

**Files:**
- Rename: `docs/plans/EXEC-personal-group-star.md` → `docs/plans/DONE-personal-group-star.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/plans/EXEC-user-onboarding-tour.md` (dependency references only)

**Interfaces:**
- Consumes: actual PASS evidence from Task 5; near-complete or environment-blocked verification is not sufficient.
- Produces: an executed `DONE-*` artifact and an onboarding prerequisite reference that points to it.
- Preserves: every onboarding behavior, task, acceptance criterion, and out-of-scope boundary.

- [x] **Step 1: Record actual execution evidence**

Only after every required Task 5 check passes, mark Tasks 1-5 complete and replace the header status with the execution date, final verification commands/results, and implementing commit ids. Do not write `PASS`, measured behavior, screenshots, or runtime versions that were not actually observed.

- [x] **Step 2: Rename the plan and update prerequisite references**

Run:

```bash
git mv docs/plans/EXEC-personal-group-star.md docs/plans/DONE-personal-group-star.md
```

Update the existing `docs/plans/README.md` entry to the `DONE-*` filename and completed status. In `docs/plans/EXEC-user-onboarding-tour.md`, replace only `EXEC-personal-group-star.md` dependency references with `DONE-personal-group-star.md` and mark the prerequisite satisfied; do not edit its design or implementation tasks.

- [x] **Step 3: Verify the closeout diff and commit**

Run:

```bash
rg -n "personal-group-star\.md" docs/plans --glob '!DONE-personal-group-star.md'
git diff --check
git diff --name-status
```

Expected: every reported external reference uses `DONE-personal-group-star.md`, the plan is a recorded rename, and only the plan index plus onboarding dependency text changed beside it.

Commit:

```bash
git add docs/plans/DONE-personal-group-star.md docs/plans/README.md docs/plans/EXEC-user-onboarding-tour.md
git commit -m "docs: close personal group star plan"
```

## Acceptance Criteria

- `/api/groups-preferences` rejects malformed/non-object JSON, missing/extra keys, wrong types, duplicates, unknown ids, zero/multiple first ids, mismatches, and empty-team favorites before normalization; it recovers a concurrent first insert without `500`.
- First-run selection requires one explicit eligible personal star; empty-team groups remain configurable shared groups but cannot release mandatory selection or group data loading.
- No group-scoped task, alert, stats, dependency, capacity, or Scenario request starts before the personal-preference save succeeds.
- After success, the canonical response snapshot replaces stale client group/team data before Product/Tech requests carry only the chosen group/team scope and render returned synthetic issue data; an invalid snapshot keeps the gate closed, and delayed invalid/previous-scope success, failure, and `finally` handling cannot overwrite its data, errors, auth state, or loading state.
- Workspace DB users each retain exactly one eligible favorite per workspace; shared `defaultGroupId` never supplies or receives that star, while explicitly choosing the same eligible group id remains valid.
- Settings star changes persist only through user preferences, use Save-all dirty semantics, keep the favorite visible, preserve dirty state across partial failure/auth recovery, and do not affect other users.
- Dashboard Group-dropdown changes remain temporary and do not move the persisted favorite.
- Missing, deleted, hidden, or empty-team favorites reopen mandatory selection, abort/clear stale scope data, and never invent a fallback.
- Safe `/login...` recovery is visible after a `401`; unsafe/external login URLs are ignored.
- File/JSON behavior remains compatible.
- Analytics contains no group identity and removes the constant first-run selection count without introducing a new event.
- Node 20, focused/full tests, clean rebuild, source review, request-order/absence proof, element-level geometry, and inspected screenshots provide acceptance evidence.
- After that evidence passes, the plan is renamed to `DONE-personal-group-star.md` and onboarding references the completed prerequisite without behavior changes.

## Out of Scope

- `onboarding_done`, tour content, spotlight/coachmark UI, Skip/Finish, replay, configure-your-own onboarding guidance, or onboarding outcome analytics.
- Renaming/removing the existing DB column or API wire key.
- Adding a favorites list or supporting more than one personal star.
- Requiring every shared group to have teams; only personal-favorite eligibility requires a data-bearing group.
- Changing shared group catalog permissions, revision behavior, import/export schema, Jira behavior, or Home/Townsquare behavior.
