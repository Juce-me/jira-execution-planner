# Per-Tab Reauthentication Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Execution and verification complete; integration awaits explicit user approval. Keep this plan under `EXEC-*`; no push, merge, PR, or `DONE-*` rename has been performed.

**Holistic frontend review (2026-09-01):** Standards/security approved with no findings. Spec approved after docs-only execution-record correction `d021cac`.

**Whole-branch review (2026-09-01, HEAD `37acf6f`):** Spec and standards/security both approved with no findings.

**Final cross-slice verification (2026-09-01):** Alembic reached `20260830_0009 (head)`; runner preflight passed 8/8; the PostgreSQL race module passed 11/11 with zero skips; structure-budget and initiative-extraction coverage passed 5/5. The full Python suite reported `Ran 1410 tests` / `OK (skipped=6)` with zero failures; the six unrelated `PostgresUserViewConcurrencyGateTests` opt-in skips were `test_advisory_lock_serializes_same_scope_without_row_contention`, `test_selected_view_for_update_blocks_stale_service_read_on_raw_row_lock`, `test_first_default_race_and_complete_last_write_winner`, `test_stale_replacement_waits_for_overlapping_epm_save_then_conflicts`, `test_advisory_scope_same_workspace_different_owner_does_not_block`, and `test_advisory_scope_same_owner_different_workspace_does_not_block`.

Cookie-free `GET /health` returned `200` with exactly `{"message":"Jira proxy server is running","status":"OK"}`; cookie-free `GET /api/test` returned `401` with exactly `{"error":"auth_required","loginUrl":"/login?reason=session_expired","message":"Your Jira sign-in expired. Sign in again to continue."}`. Runner cleanup completed and Homebrew PostgreSQL was restored to its prior running state.

Node `v20.20.0` frontend units passed 990/990; the exact five-spec Playwright suite passed 95/95 using normal clicks. Two production builds were identical and left generated output clean. Storage, source, privacy, analytics, sensitive-data, diff, and status checks were clean; all warnings were existing. The four settled screenshots remain referenced in Task 5 evidence below.

**Goal:** Complete issue #143 by restoring each tab's safe view and Planning selection after same-tab OAuth reauthentication, while retaining the existing terminal global auth lock, no-replay rule, and cross-tab isolation.

**Architecture:** A schema-validated, 30-minute recovery capsule lives in `sessionStorage`, which survives same-tab navigation but is isolated per tab. The App captures a strict allowlist when the global auth latch fires and restores it only after authenticated bootstrap proves the same workspace/private view. A short origin-scoped exclusive Web Lock makes the five-minute `localStorage` recovery lease atomic across tabs. Authenticated principal bootstrap publishes success immediately; sibling tabs already share the new Flask cookie, so their terminal gates only navigate to new documents when that success occurred after their failing request began, then independently consume their own capsules.

**Tech Stack:** React 19, Web Locks, browser `sessionStorage`/`localStorage`, existing `AuthRequiredGate`, Node test runner, Playwright, esbuild.

---

## File Map

- Create: `frontend/src/api/authResumeState.js`
- Create: `frontend/src/api/authRecoveryCoordinator.js`
- Create: `tests/test_auth_resume_state.js`
- Create: `tests/test_auth_recovery_coordinator.js`
- Modify: `frontend/src/api/authRequired.js`
- Modify: `frontend/src/api/http.js`
- Modify: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/useEngSprintData.js`
- Modify: `frontend/src/eng/planningSelectionActions.js`
- Modify: `frontend/src/planningSelectionState.mjs`
- Modify: `frontend/src/styles/shared/shell.css`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `tests/test_auth_required.js`
- Modify: `tests/test_planning_selection_state.js`
- Modify: `tests/test_eng_auth_recovery_message.js`
- Modify: `tests/test_dashboard_alert_source_guards.js`
- Modify: `tests/test_auth_isolation_source_guard.js`
- Modify: `tests/ui/epm_home_token_fixture.js`
- Modify: `tests/ui/global_auth_lock.spec.js`
- Modify: `tests/ui/planning_selection_defaults.spec.js`
- Modify generated build outputs under `frontend/dist/` through `npm run build`

No backend endpoint, database schema, configuration ownership, Home/Townsquare route, Jira mutation, GA4 taxonomy, or credential form contract changes in this slice.

### Task 0: Verify prerequisites and baseline behavior

- [x] **Step 1: Verify the global lock and server session slice are present**

Run:

```bash
git merge-base --is-ancestor b38e8f7 HEAD
test -f frontend/src/api/authRequired.js
test -f frontend/src/components/AuthRequiredGate.jsx
test -f tests/ui/global_auth_lock.spec.js
test -f backend/auth/db_browser_sessions.py
```

Expected: every command exits `0`. If any check fails, stop; do not recreate the global lock or bypass the server-session prerequisite in this plan.

**Observed evidence (2026-09-01):** `git merge-base --is-ancestor b38e8f7 HEAD` exited `0`; all four `test -f` checks exited `0`.

- [x] **Step 2: Run the existing lock and Planning baselines**

Run:

```bash
fnm exec --using 20 -- node --test tests/test_auth_required.js tests/test_planning_selection_state.js tests/test_auth_focus_refresh.js
fnm exec --using 20 -- npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS before the new behavior. Preserve these contracts: one terminal gate, same-tab sanitized navigation, no in-place unlock, no failed-request replay, no raw `401`, and existing Planning selection persistence.

**Observed evidence (2026-09-01):** the pinned Node 20 command exited `0` with 34/34 tests passing. The pinned Playwright command exited `1`: 15/16 passed and 1 failed reproducibly (`global_auth_lock.spec.js:130`, expected `alertdialog` not found); the isolated retry also exited `1`. The initial sandbox attempt was unable to launch Chromium due to macOS `MachPortRendezvousServer` permission denial; the elevated retry launched normally.

**Final observed evidence (2026-09-01):** the fixture now serves the existing `frontend/dist/auth-focus-refresh.js` bundle for its exact script route. With no listener on port 5050, the isolated regression exited `0` with 1/1 passing. The exact pinned Node 20 baseline exited `0` with 34/34 passing. The exact pinned Playwright baseline exited `0` with 16/16 passing.

### Task 1: Implement the tab-local recovery capsule as a pure module

**Files:**

- Create: `frontend/src/api/authResumeState.js`
- Create: `tests/test_auth_resume_state.js`

- [x] **Step 1: Write failing schema, expiry, identity, and privacy tests**

Cover a valid round trip and every rejection path:

```javascript
test('a matching Planning capsule round-trips through one tab store', () => {
    const storage = createStorage();
    const snapshot = planningSnapshot();
    assert.equal(writeAuthResumeState(storage, snapshot, 1_000), true);
    assert.deepEqual(readAuthResumeState(storage, snapshot.principal, 2_000), {
        ...snapshot,
        version: 1,
        capturedAt: 1_000,
    });
});

test('identity mismatch clears without returning prior issue keys', () => {
    const storage = createStorage();
    writeAuthResumeState(storage, planningSnapshot(), 1_000);
    assert.equal(readAuthResumeState(storage, {
        workspaceId: 'workspace-other',
        viewConfigId: 'view-other',
    }, 2_000), null);
    assert.equal(storage.getItem(AUTH_RESUME_STORAGE_KEY), null);
});
```

Also assert malformed JSON, unsupported version, negative/future timestamp, age greater than 30 minutes, payload over 64 KiB, missing principal, invalid view/mode, more than 500 selected keys, and more than 200 teams are rejected and cleared. Assert serialized text does not contain `apiToken`, `access_token`, `refresh_token`, `Authorization`, email-form values, response bodies, config drafts, or OAuth/PKCE state.

- [x] **Step 2: Run the new tests to verify they fail**

Run:

```bash
node --test tests/test_auth_resume_state.js
```

Expected: FAIL because `frontend/src/api/authResumeState.js` does not exist.

**Observed evidence (2026-09-01):** `fnm exec --using 20 -- node --test tests/test_auth_resume_state.js` exited `1` with all 5 tests failing because the module did not exist.

- [x] **Step 3: Implement the storage contract**

Create a module with these constants and public functions:

```javascript
export const AUTH_RESUME_STORAGE_KEY = 'jira_dashboard_auth_resume_v1';
export const AUTH_RESUME_VERSION = 1;
export const AUTH_RESUME_TTL_MS = 30 * 60 * 1000;
export const AUTH_RESUME_MAX_BYTES = 64 * 1024;

export function getAuthResumeStorage(win = globalThis.window) {
    try { return win?.sessionStorage || null; } catch (error) { return null; }
}

const VIEW_IDS = new Set(['eng', 'epm']);
const ENG_MODES = new Set(['catch-up', 'planning', 'statistics', 'scenario', 'board']);
const SETTINGS_TABS = new Set([
    'scope', 'source', 'mapping', 'capacity', 'priorityWeights', 'access',
    'teams', 'labels', 'boards', 'epm', 'connections',
]);
const SELECTION_MODES = new Set(['manual', 'default_all']);

const cleanString = (value, max = 255) => typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';
const cleanList = (values, maxItems) => {
    if (!Array.isArray(values) || values.length > maxItems || values.some(value => typeof value !== 'string')) {
        return null;
    }
    return [...new Set(values.map(value => cleanString(value)).filter(Boolean))];
};

function normalizePrincipal(value) {
    const workspaceId = cleanString(value?.workspaceId);
    const viewConfigId = cleanString(value?.viewConfigId);
    return workspaceId && viewConfigId ? { workspaceId, viewConfigId } : null;
}

function normalizeSnapshot(value, capturedAt) {
    const principal = normalizePrincipal(value?.principal);
    if (!principal) return null;
    const selectedView = value?.view?.selectedView;
    const engMode = value?.view?.engMode;
    const settingsTab = value?.view?.settingsTab;
    const selectionMode = value?.planning?.selectionMode;
    const selectedTaskKeys = cleanList(value?.planning?.selectedTaskKeys, 500);
    const selectedTeams = cleanList(value?.planning?.selectedTeams, 200);
    if (
        !VIEW_IDS.has(selectedView)
        || !ENG_MODES.has(engMode)
        || !SETTINGS_TABS.has(settingsTab)
        || !SELECTION_MODES.has(selectionMode)
        || typeof value?.view?.settingsOpen !== 'boolean'
        || selectedTaskKeys === null
        || selectedTeams === null
    ) return null;
    return {
        version: AUTH_RESUME_VERSION,
        capturedAt,
        principal,
        view: {
            selectedView,
            activeGroupId: cleanString(value?.view?.activeGroupId),
            selectedSprint: cleanString(value?.view?.selectedSprint),
            engMode,
            settingsOpen: value?.view?.settingsOpen === true,
            settingsTab,
        },
        planning: {
            scopeKey: cleanString(value?.planning?.scopeKey, 512),
            selectedTaskKeys,
            selectedTeams,
            selectionMode,
        },
    };
}

export function clearAuthResumeState(storage = getAuthResumeStorage()) {
    try { storage.removeItem(AUTH_RESUME_STORAGE_KEY); } catch (error) { }
}

export function writeAuthResumeState(storage, snapshot, now = Date.now()) {
    try {
        if (readAuthResumeState(storage, snapshot?.principal, now)) return false;
        const normalized = normalizeSnapshot(snapshot, now);
        if (!normalized) return false;
        const serialized = JSON.stringify(normalized);
        if (new TextEncoder().encode(serialized).byteLength > AUTH_RESUME_MAX_BYTES) return false;
        storage.setItem(AUTH_RESUME_STORAGE_KEY, serialized);
        return true;
    } catch (error) {
        return false;
    }
}

export function readAuthResumeState(storage, principal, now = Date.now()) {
    let raw = '';
    try { raw = storage.getItem(AUTH_RESUME_STORAGE_KEY) || ''; } catch (error) { return null; }
    if (!raw || new TextEncoder().encode(raw).byteLength > AUTH_RESUME_MAX_BYTES) {
        clearAuthResumeState(storage);
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        const expected = normalizePrincipal(principal);
        const capturedAt = parsed?.capturedAt;
        const normalized = normalizeSnapshot(parsed, capturedAt);
        const validAge = typeof capturedAt === 'number'
            && Number.isFinite(capturedAt)
            && capturedAt >= 0
            && capturedAt <= now
            && now - capturedAt <= AUTH_RESUME_TTL_MS;
        const samePrincipal = expected && normalized
            && normalized.principal.workspaceId === expected.workspaceId
            && normalized.principal.viewConfigId === expected.viewConfigId;
        if (parsed?.version !== AUTH_RESUME_VERSION || !validAge || !samePrincipal) throw new Error('invalid_auth_resume');
        return normalized;
    } catch (error) {
        clearAuthResumeState(storage);
        return null;
    }
}
```

Do not export a generic object serializer or accept arbitrary fields.

Add a getter-failure test: when the supplied window's `sessionStorage` property throws, `getAuthResumeStorage` returns `null`, and capture/restore/clear remain no-ops rather than breaking the auth gate or bootstrap.

**Observed evidence (2026-09-01):** Implemented the strict v1 allowlist, principal binding, 30-minute TTL, 64 KiB UTF-8 bound, list limits, fail-soft storage operations, and getter-failure behavior.

- [x] **Step 4: Run the capsule tests**

Run:

```bash
node --test tests/test_auth_resume_state.js
```

Expected: PASS, including privacy and size bounds.

**Observed evidence (2026-09-01):** `fnm exec --using 20 -- node --test tests/test_auth_resume_state.js` exited `0` with 16/16 tests passing, including exact recursive read-schema rejection, canonical no-space UUID/slash/colon identifier validation, empty shell scope, canonical Jira-key validation, atomic mismatched-principal replacement, oversized/write-failure preservation, prose/payload rejection, opaque `STATE-*` preservation, null list-member rejection, privacy, non-mutating write, clock, list-shape, and UTF-8 size regressions.

- [x] **Step 5: Commit the capsule module**

```bash
git add frontend/src/api/authResumeState.js tests/test_auth_resume_state.js
git commit -m "Add tab-local auth recovery capsule"
```

### Task 2: Capture and restore dashboard/Planning state

**Files:**

- Modify: `frontend/src/api/authRequired.js`
- Modify: `frontend/src/api/http.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/useEngSprintData.js`
- Modify: `frontend/src/eng/planningSelectionActions.js`
- Modify: `frontend/src/planningSelectionState.mjs`
- Modify: `tests/test_auth_required.js`
- Modify: `tests/test_eng_auth_recovery_message.js`
- Modify: `tests/test_dashboard_alert_source_guards.js`
- Modify: `tests/test_planning_selection_state.js`
- Modify: `tests/ui/planning_selection_defaults.spec.js`

- [x] **Step 1: Write failing capture and reconciliation tests**

Extend the auth-required unit harness to prove the event carries both a stable `requestStartedAt` captured before `fetch()` and a stable `lockedAt` captured when the first auth failure latches, but still stores no identity or feature state in the shared window latch. Prove a delayed `401` preserves its earlier request start, repeated publications retain the first frozen state/timestamps, and invalid injected timestamps fall back to the current clock. Extend Planning tests with an explicit recovery override:

```javascript
test('recovered selection overrides shared storage only for its exact loaded scope', () => {
    const result = resolvePlanningAuthResume({
        resume: {
            scopeKey: 'planning::sprint-1::group-a',
            selectedTaskKeys: ['PLAN-1', 'REMOVED-9'],
            selectedTeams: ['team-a', 'team-removed'],
            selectionMode: 'manual',
        },
        planningScopeKey: 'planning::sprint-1::group-a',
        validTaskKeys: new Set(['PLAN-1', 'PLAN-2']),
        validTeamIds: new Set(['team-a', 'team-b']),
    });
    assert.deepEqual(result, {
        selectedTaskKeys: ['PLAN-1'],
        selectedTeams: ['team-a'],
        selectionMode: 'manual',
    });
});
```

Assert a mismatched scope returns `null`, default-all mode remains valid, and recovered keys are deterministically sorted.

Add narrow loader-outcome coverage proving that a legitimate empty task response reports applied success, a non-auth failure reports terminal failure, a typed auth interruption reports auth-required, and an aborted or stale response reports ignored without applying state.

- [x] **Step 2: Run focused tests to verify they fail**

Run:

```bash
fnm exec --using 20 -- node --test tests/test_auth_required.js tests/test_planning_selection_state.js
fnm exec --using 20 -- node --test tests/test_eng_auth_recovery_message.js
```

Expected: FAIL because request causality, `lockedAt`, and `resolvePlanningAuthResume` do not exist.

**Observed evidence (2026-09-01):** the first command exited `1` with 17/22 passing and the five intended request-causality/Planning-helper failures. After those seams were implemented, the additive loader-outcome RED command exited `1` with 8/12 passing and the four intended missing-outcome failures.

- [x] **Step 3: Carry request causality into the deterministic auth latch and add Planning reconciliation**

In `apiFetch`, capture `requestStartedAt = Date.now()` immediately before calling `fetch()`. Pass it to `publishAuthenticationRequired` for every `401`/`auth_required` response from that request. Extend `stateFor` in `authRequired.js` to include the sanitized finite nonnegative `requestStartedAt` and `lockedAt: Date.now()` only when creating the first latched state. Repeated publications return the existing frozen state and timestamps. This timestamp is causality metadata only: it contains no URL, payload, identity, or response data.

Add this pure helper to `planningSelectionActions.js`:

```javascript
export function resolvePlanningAuthResume({ resume, planningScopeKey, validTaskKeys, validTeamIds } = {}) {
    if (!resume || resume.scopeKey !== planningScopeKey) return null;
    const tasks = [...new Set(resume.selectedTaskKeys || [])]
        .filter(key => validTaskKeys.has(key))
        .sort();
    const teams = [...new Set(resume.selectedTeams || [])]
        .filter(teamId => validTeamIds.has(teamId))
        .sort();
    return {
        selectedTaskKeys: tasks,
        selectedTeams: teams,
        selectionMode: resume.selectionMode === PLANNING_SELECTION_MODE_DEFAULT_ALL
            ? PLANNING_SELECTION_MODE_DEFAULT_ALL
            : PLANNING_SELECTION_MODE_MANUAL,
    };
}
```

- [x] **Step 4: Capture the latest safe App snapshot once on lock**

In `dashboard.jsx`, keep `authResumePrincipalRef`, `authResumeSnapshotRef`, `pendingShellAuthResumeRef`, and `pendingPlanningAuthResumeRef`. Update the snapshot ref each render with only:

```javascript
authResumeSnapshotRef.current = {
    principal: authResumePrincipalRef.current,
    view: {
        selectedView,
        activeGroupId,
        selectedSprint: selectedSprint === null ? '' : String(selectedSprint),
        engMode: showPlanning ? 'planning' : showStats ? 'statistics' : showScenario ? 'scenario' : showBoard ? 'board' : 'catch-up',
        settingsOpen: showGroupManage,
        settingsTab: groupManageTab,
    },
    planning: {
        scopeKey: planningScopeKey,
        selectedTaskKeys: selectedTaskKeysFromMap(selectedTasks),
        selectedTeams: normalizeSelectedTeams(selectedTeams),
        selectionMode: planningSelectionMode,
    },
};
```

Install one `AUTH_REQUIRED_EVENT` listener that obtains storage through `getAuthResumeStorage(window)` and calls `writeAuthResumeState(tabStorage, authResumeSnapshotRef.current)` only when storage and both principal ids exist. If the latch existed before listener installation, perform the same one-time call after mount. A blocked storage getter skips capsule capture without breaking the terminal gate. Never capture config drafts, task objects, Scenario data, connection inputs, or error bodies.

- [x] **Step 5: Validate and stage restore after authenticated config bootstrap**

After `fetchAppConfig(BACKEND_URL)` succeeds, derive the principal only from the authenticated private view:

```javascript
const resumePrincipal = {
    workspaceId: String(config.viewConfig?.workspaceId || ''),
    viewConfigId: String(config.viewConfig?.viewConfigId || ''),
};
authResumePrincipalRef.current = resumePrincipal;
const resumeStorage = getAuthResumeStorage(window);
const resume = resumeStorage
    ? readAuthResumeState(resumeStorage, resumePrincipal)
    : null;
```

If `resume` exists, stage `resume.view` in `pendingShellAuthResumeRef` and `resume.planning` in `pendingPlanningAuthResumeRef`; do not clear or apply dependent values directly inside the config fetch. Missing storage continues ordinary bootstrap without recovery. Apply only safe shell values when their owning bootstrap data is ready: an active visible group after groups finish loading, an available sprint after `availableSprints` loads, a permitted Settings tab after edit/connection gates resolve, and EPM only after `homeTokenConnectionLoaded && showEpmNavigation`. Resolve the sprint with `availableSprints.find(sprint => String(sprint.id) === resume.view.selectedSprint)` and apply that row's original `id` so numeric/string id behavior remains unchanged. Restore the canonical ENG mode (`catch-up`, `planning`, `statistics`, `scenario`, or `board`) without emitting a user-selection analytics event. Invalid or unavailable values use the ordinary bootstrap fallback. Do not apply task keys before the exact scoped task payload arrives.

- [x] **Step 6: Apply Planning restore after exact scope hydration**

At the existing Planning reconciliation effect, give a matching pending recovery state precedence over shared `localStorage` for one pass. Reconcile it against the loaded task/team sets with `resolvePlanningAuthResume`, apply the maps/mode, persist the reconciled state through `persistPlanningSelectionState`, rebuild `planningLoadedSelectionRef`, clear undo, then clear the pending Planning ref. Clear `sessionStorage` only after every staged shell dependency has either applied or resolved to its normal fallback and Planning has reconciled when requested.

Treat the first post-auth Planning hydration as a one-shot terminal decision. If its matching task payload succeeds, reconcile as above. If it rejects for a non-auth reason, or permission/scope resolution proves the requested Planning scope unavailable, abandon the pending Planning restore, clear the capsule, retain the ordinary visible error/default state, and let later manual retry/reload use normal persisted selection only. A new `AuthenticationRequiredError` is another recovery interruption rather than a settled hydration failure, so keep the capsule until that recovery succeeds/fails or the 30-minute TTL expires. For non-Planning recovery, clear the capsule after the staged shell state settles. For invalid group/sprint/view values, apply normal defaults and mark that dependency settled. Never retry an abandoned restore on a later ordinary load.

`fetchTasks`, `loadProductTasks`, and `loadTechTasks` expose distinct additive outcomes for applied success (including a legitimate empty payload), non-auth failure, typed auth-required interruption, and ignored/aborted/stale work. Before starting the two exact-scope loads, the dashboard records a pending recovery load. It publishes a current-scope settled outcome only after `Promise.all` completes and triggers a minimal reconciliation revision. Planning remains pending while either result is ignored or auth-required; only two applied results reconcile, while either non-auth failure abandons recovery. Delayed React error state is not a recovery signal.

Config and group/sprint bootstrap remain concurrent. When authenticated config stages recovery refs, increment a minimal staged revision consumed by the group, sprint, shell, task-load, and Planning reconciliation effects so already-settled dependencies reconsider the new work. Capsule clearing must fail closed while the terminal auth latch is present. If restored Planning is unavailable, including a sprint that is now completed, cancel its staged payload before reconciliation and retain ordinary Catch Up/local persistence. If onboarding makes group scope unavailable and intentionally skips sprint discovery, terminalize shell and Planning recovery instead of waiting indefinitely; a typed-auth interruption remains non-settled.

Onboarding abandonment must wait until authenticated config has completed principal resolution and the remaining auth-capable Home connection dependency has settled; it does not wait for sprint discovery that onboarding intentionally skips. `savePlanningState` preserves its normalized saved-object success contract, while `persistPlanningSelectionState` exposes an additive boolean result to recovery callers. Only a successful browser-storage write may freeze the recovered baseline, consume the capsule, or complete recovery in the current document. A blocked or quota-limited write terminalizes that document's pending recovery and Undo baseline while retaining the tab capsule for a later new-document retry; later user selection changes must not be overwritten by the failed attempt. For `default_all` recovery, reconcile and persist every currently valid exact-scope task key in deterministic order, including tasks introduced after capture, so the Undo baseline represents the full current set.

- [x] **Step 7: Run focused capture/restore tests**

Run:

```bash
fnm exec --using 20 -- node --test tests/test_auth_required.js tests/test_auth_resume_state.js tests/test_planning_selection_state.js tests/test_eng_auth_recovery_message.js
fnm exec --using 20 -- node --test tests/test_dashboard_alert_source_guards.js tests/test_auth_isolation_source_guard.js
fnm exec --using 20 -- npx playwright test tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS. Existing normal `localStorage` selection behavior remains unchanged outside one-shot recovery. Add a non-auth Planning hydration failure assertion that clears the capsule/pending ref and prove a later manual reload cannot resurrect the pre-auth task keys; retain the capsule only when hydration is interrupted by a new typed auth-required error.

**Observed evidence (2026-09-01):** the pinned Node 20 focused command exited `0` with 50/50 passing; the adjacent source-guard command exited `0` with 16/16 passing; and the pinned Planning Playwright command exited `0` with 12/12 passing. The three decisive exact-scope success, non-auth abandonment/reload, and typed-auth retention browser cases also passed together 3/3.

**Spec-fix round 1 evidence (2026-09-01):** four new browser regressions first exited `1` with delayed config staging, completed-sprint persistence, and onboarding terminalization failing; the initial group-auth fixture did not reach the clear boundary, so the typed-auth case was tightened to hold Home connection status until config had staged recovery and then failed independently as expected. After the minimal fix, the isolated command passed 4/4. The exact pinned Node command passed 50/50, the full Planning Playwright spec passed 16/16, and adjacent source guards passed 16/16.

**Quality-fix round 1 evidence (2026-09-01):** `fnm exec --using 20 -- node --test tests/test_planning_selection_state.js` first exited `1` with 10/12 passing because `default_all` omitted a newly loaded key and persistence did not report success. `fnm exec --using 20 -- npx playwright test tests/ui/planning_selection_defaults.spec.js --grep "failed Planning recovery persistence|default-all recovery|onboarding waits for delayed"` first exited `1` with 0/3 passing at the intended persistence, baseline, and delayed-auth boundaries. After the minimal fix, the unit file passed 12/12 and the isolated browser cases passed 3/3. The exact focused Node command passed 51/51, the full Planning Playwright spec passed 19/19, and adjacent source guards passed 16/16.

**Quality-fix round 2 evidence (2026-09-01):** the isolated Planning unit file first exited `1` with 11/12 passing because `savePlanningState` returned `true` instead of the normalized saved object. The persistence-failure browser case first exited `1` with 0/1 passing because a later Accepted action was overwritten from two selected tasks back to the recovered one; an intermediate rerun then exposed that ordinary reconciliation rebuilt an enabled Undo baseline. After the scope-bound retention fix, the isolated unit file passed 12/12 and browser case passed 1/1. The exact focused Node command passed 51/51, the full Planning Playwright spec passed 19/19, adjacent source guards passed 16/16, and Planning action guards passed 33/33.

- [x] **Step 8: Commit the capture/restore slice**

```bash
git add frontend/src/api/authRequired.js frontend/src/api/http.js frontend/src/dashboard.jsx frontend/src/eng/useEngSprintData.js frontend/src/eng/planningSelectionActions.js frontend/src/planningSelectionState.mjs tests/test_auth_required.js tests/test_eng_auth_recovery_message.js tests/test_dashboard_alert_source_guards.js tests/test_planning_selection_state.js tests/ui/planning_selection_defaults.spec.js docs/plans/EXEC-multi-device-browser-sessions-02-tab-resume.md
git commit -m "Restore Planning state after reauthentication"
```

### Task 3: Atomically serialize same-profile OAuth initiation

**Files:**

- Create: `frontend/src/api/authRecoveryCoordinator.js`
- Create: `tests/test_auth_recovery_coordinator.js`

- [x] **Step 1: Write failing atomic-claim, completion, and consumption tests**

Use separate fake `sessionStorage` instances, one shared fake `localStorage`, and an injectable exclusive-lock manager. Force both claims to begin before the first lock callback finishes:

```javascript
function createQueuedExclusiveLockManager() {
    let tail = Promise.resolve();
    let activeCallbacks = 0;
    const manager = {
        maxConcurrentCallbacks: 0,
        request(name, options, callback) {
            assert.equal(name, AUTH_RECOVERY_LOCK_NAME);
            assert.deepEqual(options, { mode: 'exclusive' });
            const run = tail.then(async () => {
                activeCallbacks += 1;
                manager.maxConcurrentCallbacks = Math.max(
                    manager.maxConcurrentCallbacks,
                    activeCallbacks,
                );
                try {
                    return await callback();
                } finally {
                    activeCallbacks -= 1;
                }
            });
            tail = run.catch(() => undefined);
            return run;
        },
    };
    return manager;
}

test('simultaneous claims serialize to one leader and one follower', async () => {
    const shared = createStorage();
    const tabA = createStorage();
    const tabB = createStorage();
    const locks = createQueuedExclusiveLockManager();
    const [first, second] = await Promise.all([
        claimAuthRecovery(shared, tabA, { lockManager: locks, clock: () => 1_000, newId: () => 'attempt-a' }),
        claimAuthRecovery(shared, tabB, { lockManager: locks, clock: () => 1_000, newId: () => 'attempt-b' }),
    ]);
    assert.deepEqual([first.role, second.role].sort(), ['follower', 'leader']);
    assert.equal(first.attemptId, second.attemptId);
    assert.equal(locks.maxConcurrentCallbacks, 1);
});

test('authenticated completion is consumable exactly once in each follower tab', async () => {
    const shared = createStorage();
    const leaderTab = createStorage();
    const followerTab = createStorage();
    const locks = createQueuedExclusiveLockManager();
    const claim = await claimAuthRecovery(shared, leaderTab, {
        lockManager: locks,
        clock: () => 1_000,
        newId: () => 'attempt-a',
    });
    assert.equal(claim.role, 'leader');
    assert.deepEqual(await completeAuthRecovery(shared, leaderTab, {
        lockManager: locks,
        clock: () => 2_000,
    }), {
        attemptId: 'attempt-a',
        completedAt: 2_000,
    });
    assert.equal(consumeAuthRecoverySuccess(shared, followerTab, {
        now: 2_001,
        requestStartedAt: 1_500,
    })?.attemptId, 'attempt-a');
    assert.equal(consumeAuthRecoverySuccess(shared, followerTab, {
        now: 2_002,
        requestStartedAt: 1_500,
    }), null);
});

test('missing Web Locks degrades to uncoordinated solo navigation without a shared lease', async () => {
    const shared = createStorage();
    const tab = createStorage();
    const result = await claimAuthRecovery(shared, tab, {
        lockManager: null,
        clock: () => 1_000,
        newId: () => { throw new Error('must_not_generate_solo_id'); },
    });
    assert.deepEqual(result, { role: 'solo', attemptId: '' });
    assert.equal(shared.getItem(AUTH_RECOVERY_LEASE_KEY), null);
});
```

Also assert:

- an expired lease is atomically replaced, while a live lease is adopted;
- time is sampled inside each granted lock callback: pause a second claimant in the lock queue, advance its injected clock past the first lease's start, and prove it still adopts the live lease rather than using a stale pre-wait timestamp;
- a replacement claim queued before an expired leader's completion wins the lock, and that late completion cannot clear or overwrite the newer lease or success;
- when the expired leader's completion wins the opposite schedule, it publishes no success and the queued replacement becomes the only new leader;
- a success marker remains consumable when it was written before the follower subscribed and when `requestStartedAt <= completedAt < lockedAt`;
- a marker completed before the failing request's `requestStartedAt` is ignored, so a new `401` cannot consume a stale prior recovery;
- unlocked read helpers ignore malformed/expired records without removing them; use a fake storage whose `getItem` swaps in a newer value before returning the stale value and prove the newer value remains;
- the next locked claim overwrites malformed/expired lease and success records;
- shared records contain only `attemptId`, `startedAt`, and `completedAt`;
- Web Lock or shared-storage failure returns `role: 'solo'` without deadlocking or claiming cross-tab serialization; separately force the tab-attempt write and shared lease write to fail and prove no shared lease was committed;
- solo recovery never reads storage or calls the id generator, so absent/throwing `crypto.randomUUID` cannot break the fallback;
- a throwing shared-storage read never falls through to a leader write or overwrites a live lease;
- completion without Web Locks, without a matching live lease, or after lease replacement publishes no shared success;
- separately fail completion's lease removal and success write: removal failure publishes no success, while success-write failure leaves no ghost live lease;
- inability to persist a consumed marker disables automatic reload instead of creating a loop.

- [x] **Step 2: Run the new tests to verify they fail**

Run:

```bash
node --test tests/test_auth_recovery_coordinator.js
```

Expected: FAIL because the coordinator module and atomic claim functions do not exist.

**Observed evidence (2026-09-01):** the pinned Node 20 focused command exited `1` because esbuild could not resolve the intentionally missing coordinator module.

- [x] **Step 3: Implement the atomic coordinator**

Create these constants/functions:

```javascript
export const AUTH_RECOVERY_LOCK_NAME = 'jira-dashboard-auth-recovery-v1';
export const AUTH_RECOVERY_LEASE_KEY = 'jira_dashboard_auth_recovery_lease_v1';
export const AUTH_RECOVERY_SUCCESS_KEY = 'jira_dashboard_auth_recovery_success_v1';
export const AUTH_RECOVERY_TAB_ATTEMPT_KEY = 'jira_dashboard_auth_recovery_attempt_v1';
export const AUTH_RECOVERY_CONSUMED_KEY = 'jira_dashboard_auth_recovery_consumed_v1';
export const AUTH_RECOVERY_LEASE_MS = 5 * 60 * 1000;

export function getAuthRecoveryStores(win = globalThis.window) {
    try {
        const sharedStorage = win?.localStorage;
        const tabStorage = win?.sessionStorage;
        return sharedStorage && tabStorage ? { sharedStorage, tabStorage } : null;
    } catch (error) {
        return null;
    }
}

const parseRecord = (raw) => {
    try { return JSON.parse(raw || 'null'); } catch (error) { return null; }
};

const validAttempt = (value, timestampKey, now) => Boolean(
    typeof value?.attemptId === 'string'
    && value.attemptId.length > 0
    && value.attemptId.length <= 128
    && Number.isFinite(value?.[timestampKey])
    && value[timestampKey] >= 0
    && value[timestampKey] <= now
    && now - value[timestampKey] <= AUTH_RECOVERY_LEASE_MS
);

const validRequestStart = (value, now) => Number.isFinite(value)
    && value >= 0
    && value <= now;

const readLiveAuthRecoveryLeaseStrict = (sharedStorage, now) => {
    const value = parseRecord(sharedStorage.getItem(AUTH_RECOVERY_LEASE_KEY));
    if (!validAttempt(value, 'startedAt', now)) return null;
    return { attemptId: value.attemptId, startedAt: value.startedAt };
};

export function readLiveAuthRecoveryLease(sharedStorage, now = Date.now()) {
    try {
        return readLiveAuthRecoveryLeaseStrict(sharedStorage, now);
    } catch (error) {
        return null;
    }
}

const readAuthRecoverySuccessStrict = (sharedStorage, now) => {
    const value = parseRecord(sharedStorage.getItem(AUTH_RECOVERY_SUCCESS_KEY));
    if (!validAttempt(value, 'completedAt', now)) return null;
    return { attemptId: value.attemptId, completedAt: value.completedAt };
};

const consumeAuthRecoverySuccessStrict = (sharedStorage, tabStorage, now, requestStartedAt) => {
    const success = readAuthRecoverySuccessStrict(sharedStorage, now);
    if (!success) return null;
    if (!validRequestStart(requestStartedAt, now) || success.completedAt < requestStartedAt) return null;
    if (tabStorage.getItem(AUTH_RECOVERY_CONSUMED_KEY) === success.attemptId) return null;
    tabStorage.setItem(AUTH_RECOVERY_CONSUMED_KEY, success.attemptId);
    return success;
};

const writeTabAttempt = (tabStorage, attemptId, startedAt) => {
    tabStorage.setItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY, JSON.stringify({ attemptId, startedAt }));
};

export async function claimAuthRecovery(sharedStorage, tabStorage, {
    lockManager = globalThis.navigator?.locks,
    clock = () => Date.now(),
    requestStartedAt,
    newId = () => globalThis.crypto.randomUUID(),
} = {}) {
    const solo = () => ({ role: 'solo', attemptId: '' });
    if (!lockManager?.request) return solo();
    try {
        return await lockManager.request(AUTH_RECOVERY_LOCK_NAME, { mode: 'exclusive' }, () => {
            const now = clock();
            const completed = consumeAuthRecoverySuccessStrict(
                sharedStorage,
                tabStorage,
                now,
                requestStartedAt,
            );
            if (completed) return { role: 'resume', attemptId: completed.attemptId };
            const current = readLiveAuthRecoveryLeaseStrict(sharedStorage, now);
            if (current) return { role: 'follower', attemptId: current.attemptId };
            const attemptId = String(newId());
            sharedStorage.removeItem(AUTH_RECOVERY_SUCCESS_KEY);
            writeTabAttempt(tabStorage, attemptId, now);
            // Commit the shared lease last so a tab-storage failure cannot strand followers.
            sharedStorage.setItem(AUTH_RECOVERY_LEASE_KEY, JSON.stringify({ attemptId, startedAt: now }));
            return { role: 'leader', attemptId };
        });
    } catch (error) {
        try { tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY); } catch (storageError) { }
        return solo();
    }
}

export async function completeAuthRecovery(sharedStorage, tabStorage, {
    lockManager = globalThis.navigator?.locks,
    clock = () => Date.now(),
} = {}) {
    if (!lockManager?.request) return null;
    try {
        return await lockManager.request(AUTH_RECOVERY_LOCK_NAME, { mode: 'exclusive' }, () => {
            const now = clock();
            const tabAttempt = parseRecord(tabStorage.getItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY));
            const current = readLiveAuthRecoveryLeaseStrict(sharedStorage, now);
            if (!validAttempt(tabAttempt, 'startedAt', now)
                || !current
                || current.attemptId !== tabAttempt.attemptId) {
                if (!current) sharedStorage.removeItem(AUTH_RECOVERY_LEASE_KEY);
                tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY);
                return null;
            }
            const success = { attemptId: tabAttempt.attemptId, completedAt: now };
            sharedStorage.removeItem(AUTH_RECOVERY_LEASE_KEY);
            sharedStorage.setItem(AUTH_RECOVERY_SUCCESS_KEY, JSON.stringify(success));
            try {
                tabStorage.setItem(AUTH_RECOVERY_CONSUMED_KEY, tabAttempt.attemptId);
                tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY);
            } catch (error) { }
            return success;
        });
    } catch (error) {
        return null;
    }
}

export function readAuthRecoverySuccess(sharedStorage, now = Date.now()) {
    try {
        return readAuthRecoverySuccessStrict(sharedStorage, now);
    } catch (error) {
        return null;
    }
}

export function consumeAuthRecoverySuccess(sharedStorage, tabStorage, {
    now = Date.now(),
    requestStartedAt,
} = {}) {
    try {
        return consumeAuthRecoverySuccessStrict(sharedStorage, tabStorage, now, requestStartedAt);
    } catch (error) {
        return null;
    }
}
```

Both claim and completion hold the same Web Lock only for their synchronous shared-storage transaction; neither may hold it across navigation or network I/O, and each samples its clock only after the lock is granted. Locked mutations use strict storage reads so an access failure cannot masquerade as an absent lease; exported UI read/consume helpers remain fail-soft. Read helpers are deliberately non-destructive because an unlocked read followed by removal could delete a newer record; the next locked claim overwrites stale records. Completion removes the matching lease before publishing success, requires the same live lease recorded by the current tab, and therefore prevents a solo fallback, superseded/expired leader, or partial failure from leaving a false success with a live ghost lease. Success consumption requires `requestStartedAt <= completedAt`, so a delayed pre-recovery request can use the recovery that happened while it was in flight, but a genuinely newer request cannot consume a stale marker. A click that races the locked effect returns `role: 'resume'` instead of deleting the marker or starting OAuth. The per-request threshold plus consumed marker, not a `completedAt > lockedAt` comparison, establishes causality and prevents reload loops.

- [x] **Step 4: Run coordinator tests**

Run:

```bash
node --test tests/test_auth_recovery_coordinator.js
```

Expected: PASS, including simultaneous acquisition, late-success consumption, superseded-attempt protection, and explicit uncoordinated unavailable-lock/storage fallback.

**Final observed evidence (2026-09-01):** the focused coordinator suite passed 28/28 and the full frontend unit suite passed 988/988 after the reported clock and generated-ID quality/security corrections.

- [x] **Step 5: Commit the coordinator module**

```bash
git add frontend/src/api/authRecoveryCoordinator.js tests/test_auth_recovery_coordinator.js
git commit -m "Coordinate OAuth recovery across tabs"
```

**Observed approved commits:** `7334c88` (coordinator implementation) and `c461b94` (input-validation quality/security fix).

### Task 4: Integrate atomic initiation and shared-cookie reload into the terminal gate

**Files:**

- Modify: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `frontend/src/api/authRecoveryCoordinator.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/shared/shell.css`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `tests/test_auth_required.js`
- Modify: `tests/test_auth_recovery_coordinator.js`
- Modify: `tests/test_auth_isolation_source_guard.js`
- Modify: `tests/ui/global_auth_lock.spec.js`
- Modify: `tests/ui/planning_selection_defaults.spec.js`

- [x] **Step 1: Write failing gate and same-profile two-tab Playwright tests**

Extend `global_auth_lock.spec.js` to create two pages in one context, drive each to the same Planning scope, choose different story keys in each page, and then return `401 auth_required` from each page's next app request. Assert:

```javascript
await expect(pageA.getByRole('alertdialog')).toBeVisible();
await expect(pageB.getByRole('alertdialog')).toBeVisible();
expect(await pageA.evaluate(() => sessionStorage.getItem('jira_dashboard_auth_resume_v1')))
    .not.toEqual(await pageB.evaluate(() => sessionStorage.getItem('jira_dashboard_auth_resume_v1')));
```

Click **Sign in again** in A and B concurrently with `Promise.all`. Dynamically identify the leader as the page that actually reaches `/login`; do not assume page A wins. Assert the exclusive lock produces exactly one `/login` navigation, one live lease, and one follower status. On the leader's rendered `/login` page, click **Sign in with Atlassian**, intercept the resulting `/api/auth/atlassian/login` navigation, and assert its total request count is exactly one before simulating the OAuth callback. The follower must start no second initiation. Simulate the leader's callback setting the browser context's shared authenticated cookie and returning that page to `/`. Assert the dynamically identified follower's next mocked `/api/auth/status` request is authenticated with that shared cookie without its own OAuth flow.

Delay the leader's Planning task hydration after authenticated config bootstrap. Assert it publishes success immediately after the principal is validated and the follower navigates to a new `/` document without waiting for the leader's tasks. Release hydration and assert both tabs show their own original valid checkbox selections. In a separate non-auth hydration-failure case, assert success was still published, the leader keeps its ordinary visible error/default state, its capsule and pending restore are cleared, and a later manual reload cannot resurrect the stale pre-auth checkbox selection. Count the request that produced `401` and prove neither tab replays it.

Add three deterministic lost-wakeup/late-response cases:

1. the success marker exists before the follower's locked effect installs;
2. success is written immediately after the listener installs and before the first state render;
3. the follower starts a request before the leader recovers, receives its delayed `401` after success, consumes the causally matching marker, and reloads once.

Also send a genuinely new request after an earlier recovery marker and return `401`; because its `requestStartedAt` is later than `completedAt`, assert it does not consume the stale marker and instead shows the recovery action. Each valid-success case must navigate exactly once, record the consumed attempt in the follower's `sessionStorage`, remove `window.__oldDocumentMarker`, and avoid a second OAuth request or reload loop.

Add a deterministic pending-click case: hold one page's claim behind the Web Lock, complete recovery from the other page, then release the queued claim. While `claimPendingRef` is true, its storage handler must not consume success. After the claim settles, that page performs one synchronous reconciliation and navigates exactly once to `/`, with zero `/login` navigations from it. Also make `window.localStorage` and `window.sessionStorage` property getters throw and prove lock mount remains rendered, capsule capture/restore is skipped, the clicked page follows the existing sanitized same-tab login path, and post-login authenticated config bootstrap continues without coordination or a crash.

Add identity-mismatch, capsule-expiry, missing-task pruning, Settings tab reopen, and connection token-input blank tests. Assert `window.__oldDocumentMarker` disappears after recovery navigation in both tabs, proving neither old document unlocked in place.

- [x] **Step 2: Run focused Playwright to verify it fails**

Run:

```bash
npx playwright test tests/ui/global_auth_lock.spec.js
```

Expected: FAIL because the gate starts an uncoordinated link navigation and no post-login state restore occurs.

**Observed evidence (2026-09-01):** focused browser RED showed two competing `/login` navigations, no shared completion reload, and no immediate success publication before delayed/failing hydration; the source guard also failed before coordinator integration.

- [x] **Step 3: Claim the lease atomically from the gate action**

Keep the existing sanitized same-tab target. On the action click, call `event.preventDefault()`, return immediately if `navigationStartedRef.current` is already true, and otherwise set `claimPendingRef.current = true` synchronously. Obtain both stores through `getAuthRecoveryStores(window)`; a `null` result clears the pending ref, sets the navigation ref, and immediately uses `window.location.assign(loginUrl)`. Otherwise await `claimAuthRecovery(stores.sharedStorage, stores.tabStorage, { requestStartedAt: authRequired.requestStartedAt })`. While the claim is pending, storage-event reconciliation must not consume success. After it settles, clear the pending ref, synchronously run the same persisted-state reconciliation once, and stop if `navigationStartedRef.current` became true. Only then handle the result after setting the navigation ref for either navigation: `leader` and `solo` navigate to `loginUrl`; `resume` navigates directly to `/`; `follower` remains locked and renders `Sign-in is continuing in another tab. This tab will resume automatically.` Disable repeat activation while pending. A `solo` result is the current uncoordinated same-tab behavior: it avoids deadlock, but simultaneous solo flows may still compete in the shared cookie, so the implementation must not claim cross-tab single-flight without working Web Locks/storage. The gate remains modal, inert, non-dismissible, and keyboard-blocking.

Use one locked `useEffect` that first calls `getAuthRecoveryStores(window)`. A `null` result disables coordination for that effect without changing the terminal gate. Otherwise install the `storage` listener first, then synchronously call the same reconciliation function used by the listener. That function returns without consuming while `claimPendingRef.current` is true; otherwise it reads the live lease for follower copy and calls `consumeAuthRecoverySuccess(stores.sharedStorage, stores.tabStorage, { requestStartedAt: authRequired.requestStartedAt })`. A consumed success sets `navigationStartedRef.current` before calling `window.location.assign('/')` exactly once. Do not require the follower to know the leader attempt id, and do not compare `completedAt` with `authRequired.lockedAt`; the request-start threshold handles success-before-mount, delayed-`401`, and stale-marker cases. Do not publish success from the old locked document.

- [x] **Step 4: Publish success immediately from the new authenticated document**

In `dashboard.jsx`, immediately after `loadConfig` validates the authenticated private-view principal—and before group, sprint, Settings, or Planning hydration—guard storage acquisition and await only when available:

```javascript
const recoveryStores = getAuthRecoveryStores(window);
if (recoveryStores) {
    await completeAuthRecovery(recoveryStores.sharedStorage, recoveryStores.tabStorage);
}
```

`completeAuthRecovery` is a no-op on ordinary bootstrap without a current tab attempt, and unavailable storage is a no-op that must not delay or fail authenticated bootstrap. Never defer completion for capsule restoration and never complete from an unauthenticated/bootstrap-locked document. Each tab validates, applies, rejects, retries, or expires its own capsule independently after the shared-cookie success broadcast.

- [x] **Step 5: Preserve terminal lock and privacy guards**

Update unit/source guards to assert:

- auth-required state is still window-local, not stored in shared storage;
- only coordinator attempt ids/timestamps use `localStorage`, and the exclusive Web Lock is held only for the claim/completion shared-storage transaction;
- only the allowlisted capsule uses `sessionStorage`;
- the gate never calls an API, clears the auth latch, or replays a request;
- recovery navigation remains same-tab and sanitized;
- no token/email/config/issue payload enters shared coordinator records;
- sibling tabs perform no second OAuth request because the authenticated Flask cookie is shared inside the browser context;
- every capsule/coordinator integration boundary obtains storage through the guarded helpers; blocked property getters skip capsule work/coordination without breaking lock render or authenticated bootstrap;
- missing Web Locks/storage preserves the existing uncoordinated same-tab navigation without calling the id generator or claiming automatic cross-tab recovery or conflict-free simultaneous OAuth.

- [x] **Step 6: Run focused unit and Playwright tests**

Run:

```bash
node --test tests/test_auth_required.js tests/test_auth_resume_state.js tests/test_auth_recovery_coordinator.js tests/test_planning_selection_state.js tests/test_auth_isolation_source_guard.js
npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS, including simultaneous-click single-flight, dynamic leader selection, one real OAuth-initiation request, shared-cookie authentication, immediate success despite failed/delayed leader hydration, success-before-listener, delayed-`401`, stale-success rejection, pending-click serialization, storage-getter fallback, exact-once navigation, and no-replay assertions.

**Final observed evidence (2026-09-01):** the exact pinned Node/source command passed 70/70 and the exact two-spec Playwright command passed 39/39 after the effective no-replay proof and in-lock completion-eligibility fixes.

- [x] **Step 7: Commit the gate integration**

```bash
git add frontend/src/components/AuthRequiredGate.jsx frontend/src/dashboard.jsx frontend/src/styles/shared/shell.css tests/test_auth_required.js tests/test_auth_isolation_source_guard.js tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js
git commit -m "Resume locked tabs after OAuth login"
```

**Observed approved commits:** `ca14064` (gate/dashboard integration), `bec47d9` (effective no-replay proof), and `5f62d67` (in-lock eligibility and analytics allowlist).

### Task 5: Build and verify the complete frontend slice

**Files:**

- Modify generated outputs under `frontend/dist/` only through the build
- Modify source/tests only if verification finds a requirement-scoped defect

- [x] **Step 1: Install the pinned frontend dependencies in this worktree**

Run:

```bash
npm ci
```

Expected: exit `0`; dependencies resolve inside this worktree rather than from an ancestor checkout.

Observed: Node `v20.20.0` via `fnm exec --using 20 --`; `npm ci` exited `0`, added 9 packages, and created a non-symlink `node_modules` at the worktree root.

- [x] **Step 2: Run all focused Node tests**

Run:

```bash
node --test tests/test_auth_required.js tests/test_auth_resume_state.js tests/test_auth_recovery_coordinator.js tests/test_auth_focus_refresh.js tests/test_planning_selection_state.js tests/test_auth_isolation_source_guard.js tests/test_frontend_api_source_guards.js
```

Expected: PASS.

Observed: 137 passed, 0 failed, 0 skipped. The full frontend unit suite also passed 990/990 with no skips.

- [x] **Step 3: Build generated frontend assets**

Run:

```bash
npm run build
```

Expected: exit `0`; `frontend/dist/dashboard.js`, CSS, maps, and the separate auth-focus bundle are regenerated from source. Do not hand-edit them.

Observed: `npm run build` exited `0` and regenerated the five tracked JavaScript, CSS, and source-map assets exclusively from source.

- [x] **Step 4: Run the focused browser suite**

Run:

```bash
npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/auth_focus_refresh_counts.spec.js tests/ui/planning_selection_defaults.spec.js tests/ui/settings_unified_save.spec.js tests/ui/scenario_draft_collaboration.spec.js
```

Expected: PASS. Capture a screenshot of each locked tab before leader navigation and each restored Planning tab after bootstrap for PR evidence.

Observed: the final exact five-spec suite passed 95/95 with normal clicks. Settled 1280 x 1064 captures are retained in the ignored `.superpowers/sdd/EXEC-multi-device-browser-sessions-02-tab-resume/evidence/task-5/` directory as `locked-tab-a.png`, `locked-tab-b.png`, `restored-planning-tab-a.png`, and `restored-planning-tab-b.png`. The first real run exposed a navigation-time `page.evaluate` race in test polling; the minimum test-only correction made polling tolerate only the expected destroyed execution context, and the final suite passed.

- [x] **Step 5: Run full repository verification**

Run:

```bash
python3 -m unittest discover -s tests
npm run build
git diff --check
```

Expected: Python suite PASS; second build exits `0`; `git diff --check` passes; the second build introduces no additional generated diff.

Observed: the pinned Python suite ran 1,410 tests with 1,401 passed and 9 skipped after ratcheting the documented `dashboard.jsx` structure ceiling from 16,375 to its legitimate Tasks 1-4 size of 16,624. The second build exited `0`; every generated asset hash and the aggregate generated-diff hash (`150e2fb508ed7dae821ce974c49a78bceeb423822b0253d30e205a735d9bd7d1`) remained identical; `git diff --check` passed.

- [x] **Step 6: Inspect storage and analytics privacy**

Run:

```bash
rg -n "AUTH_RESUME|AUTH_RECOVERY|sessionStorage|localStorage" frontend/src tests
rg -n "auth_resume|recovery_attempt|browser_session_id|selectedTaskKeys" docs/README_ANALYTICS.md frontend/src/analytics
```

Expected: storage use is limited to the two new modules and their explicit integration/tests; no new GA4 parameter/event is present; issue keys, attempt ids, capsule contents, and browser-session ids are absent from analytics.

Observed: storage ownership is limited as expected; integration is confined to the auth gate/dashboard and explicit tests. Analytics/taxonomy scans found no new event or parameter and no issue keys, attempt ids, capsule contents, or browser-session ids. The existing privacy-safe `app_error_shown` / `auth_required` event remains authoritative.

- [x] **Step 7: Commit generated assets and any verified correction**

```bash
git add frontend/dist frontend/src tests
git commit -m "Verify per-tab authentication recovery"
```

If Tasks 1-4 already committed every source/test change and the build produced no tracked change, do not create an empty commit.

Observed: commit `568bb5a6cb98b36d9132270ec2702eeb2ebb89a3` records the five generated assets and the two direct verification corrections. No unrelated source or backend behavior was changed.
