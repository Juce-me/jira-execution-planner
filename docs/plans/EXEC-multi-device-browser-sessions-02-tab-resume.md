# Per-Tab Reauthentication Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Review required. Execute only after `EXEC-multi-device-browser-sessions-01-server.md` passes and the branch contains `b38e8f7`.

**Goal:** Complete issue #143 by restoring each tab's safe view and Planning selection after same-tab OAuth reauthentication, while retaining the existing terminal global auth lock, no-replay rule, and cross-tab isolation.

**Architecture:** A schema-validated, 30-minute recovery capsule lives in `sessionStorage`, which survives same-tab navigation but is isolated per tab. The App captures a strict allowlist when the global auth latch fires and restores it only after authenticated bootstrap proves the same workspace/private view. A five-minute `localStorage` lease serializes OAuth initiation within one browser profile; successful leader bootstrap makes other locked tabs navigate to new documents and consume their own capsules.

**Tech Stack:** React 19, browser `sessionStorage`/`localStorage`, existing `AuthRequiredGate`, Node test runner, Playwright, esbuild.

---

## File Map

- Create: `frontend/src/api/authResumeState.js`
- Create: `frontend/src/api/authRecoveryCoordinator.js`
- Create: `tests/test_auth_resume_state.js`
- Create: `tests/test_auth_recovery_coordinator.js`
- Modify: `frontend/src/api/authRequired.js`
- Modify: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/planningSelectionActions.js`
- Modify: `frontend/src/styles/shared/shell.css`
- Modify: `tests/test_auth_required.js`
- Modify: `tests/test_planning_selection_state.js`
- Modify: `tests/test_auth_isolation_source_guard.js`
- Modify: `tests/ui/global_auth_lock.spec.js`
- Modify: `tests/ui/planning_selection_defaults.spec.js`
- Modify generated build outputs under `frontend/dist/` through `npm run build`

No backend endpoint, database schema, configuration ownership, Home/Townsquare route, Jira mutation, GA4 taxonomy, or credential form contract changes in this slice.

### Task 0: Verify prerequisites and baseline behavior

- [ ] **Step 1: Verify the global lock and server session slice are present**

Run:

```bash
git merge-base --is-ancestor b38e8f7 HEAD
test -f frontend/src/api/authRequired.js
test -f frontend/src/components/AuthRequiredGate.jsx
test -f tests/ui/global_auth_lock.spec.js
test -f backend/auth/db_browser_sessions.py
```

Expected: every command exits `0`. If any check fails, stop; do not recreate the global lock or bypass the server-session prerequisite in this plan.

- [ ] **Step 2: Run the existing lock and Planning baselines**

Run:

```bash
node --test tests/test_auth_required.js tests/test_planning_selection_state.js tests/test_auth_focus_refresh.js
npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS before the new behavior. Preserve these contracts: one terminal gate, same-tab sanitized navigation, no in-place unlock, no failed-request replay, no raw `401`, and existing Planning selection persistence.

### Task 1: Implement the tab-local recovery capsule as a pure module

**Files:**

- Create: `frontend/src/api/authResumeState.js`
- Create: `tests/test_auth_resume_state.js`

- [ ] **Step 1: Write failing schema, expiry, identity, and privacy tests**

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

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
node --test tests/test_auth_resume_state.js
```

Expected: FAIL because `frontend/src/api/authResumeState.js` does not exist.

- [ ] **Step 3: Implement the storage contract**

Create a module with these constants and public functions:

```javascript
export const AUTH_RESUME_STORAGE_KEY = 'jira_dashboard_auth_resume_v1';
export const AUTH_RESUME_VERSION = 1;
export const AUTH_RESUME_TTL_MS = 30 * 60 * 1000;
export const AUTH_RESUME_MAX_BYTES = 64 * 1024;

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

export function clearAuthResumeState(storage = window.sessionStorage) {
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

- [ ] **Step 4: Run the capsule tests**

Run:

```bash
node --test tests/test_auth_resume_state.js
```

Expected: PASS, including privacy and size bounds.

- [ ] **Step 5: Commit the capsule module**

```bash
git add frontend/src/api/authResumeState.js tests/test_auth_resume_state.js
git commit -m "Add tab-local auth recovery capsule"
```

### Task 2: Capture and restore dashboard/Planning state

**Files:**

- Modify: `frontend/src/api/authRequired.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/planningSelectionActions.js`
- Modify: `tests/test_auth_required.js`
- Modify: `tests/test_planning_selection_state.js`
- Modify: `tests/ui/planning_selection_defaults.spec.js`

- [ ] **Step 1: Write failing capture and reconciliation tests**

Extend the auth-required unit harness to prove the event carries a stable `lockedAt` timestamp but still stores no identity or feature state in the shared window latch. Extend Planning tests with an explicit recovery override:

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

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
node --test tests/test_auth_required.js tests/test_planning_selection_state.js
```

Expected: FAIL because `lockedAt` and `resolvePlanningAuthResume` do not exist.

- [ ] **Step 3: Add deterministic lock time and Planning reconciliation**

Extend `stateFor` in `authRequired.js` to include `lockedAt: Date.now()` only when creating the first latched state. Repeated publications return the existing frozen state and timestamp.

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

- [ ] **Step 4: Capture the latest safe App snapshot once on lock**

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

Install one `AUTH_REQUIRED_EVENT` listener that calls `writeAuthResumeState(window.sessionStorage, authResumeSnapshotRef.current)` only when both principal ids exist. If the latch existed before listener installation, perform the same one-time call after mount. Never capture config drafts, task objects, Scenario data, connection inputs, or error bodies.

- [ ] **Step 5: Validate and stage restore after authenticated config bootstrap**

After `fetchAppConfig(BACKEND_URL)` succeeds, derive the principal only from the authenticated private view:

```javascript
const resumePrincipal = {
    workspaceId: String(config.viewConfig?.workspaceId || ''),
    viewConfigId: String(config.viewConfig?.viewConfigId || ''),
};
authResumePrincipalRef.current = resumePrincipal;
const resume = readAuthResumeState(window.sessionStorage, resumePrincipal);
```

If `resume` exists, stage `resume.view` in `pendingShellAuthResumeRef` and `resume.planning` in `pendingPlanningAuthResumeRef`; do not clear or apply dependent values directly inside the config fetch. Apply only safe shell values when their owning bootstrap data is ready: an active visible group after groups finish loading, an available sprint after `availableSprints` loads, a permitted Settings tab after edit/connection gates resolve, and EPM only after `homeTokenConnectionLoaded && showEpmNavigation`. Resolve the sprint with `availableSprints.find(sprint => String(sprint.id) === resume.view.selectedSprint)` and apply that row's original `id` so numeric/string id behavior remains unchanged. Restore the canonical ENG mode (`catch-up`, `planning`, `statistics`, `scenario`, or `board`) without emitting a user-selection analytics event. Invalid or unavailable values use the ordinary bootstrap fallback. Do not apply task keys before the exact scoped task payload arrives.

- [ ] **Step 6: Apply Planning restore after exact scope hydration**

At the existing Planning reconciliation effect, give a matching pending recovery state precedence over shared `localStorage` for one pass. Reconcile it against the loaded task/team sets with `resolvePlanningAuthResume`, apply the maps/mode, persist the reconciled state through `persistPlanningSelectionState`, rebuild `planningLoadedSelectionRef`, clear undo, then clear the pending Planning ref. Clear `sessionStorage` only after every staged shell dependency has either applied or resolved to its normal fallback and Planning has reconciled when requested.

For non-Planning recovery, clear the capsule after the staged shell state settles. For invalid group/sprint/view values, apply normal defaults and mark that dependency settled. Do not retry restore on subsequent ordinary page loads.

- [ ] **Step 7: Run focused capture/restore tests**

Run:

```bash
node --test tests/test_auth_required.js tests/test_auth_resume_state.js tests/test_planning_selection_state.js
npx playwright test tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS. Existing normal `localStorage` selection behavior remains unchanged outside one-shot recovery.

- [ ] **Step 8: Commit the capture/restore slice**

```bash
git add frontend/src/api/authRequired.js frontend/src/dashboard.jsx frontend/src/eng/planningSelectionActions.js tests/test_auth_required.js tests/test_planning_selection_state.js tests/ui/planning_selection_defaults.spec.js
git commit -m "Restore Planning state after reauthentication"
```

### Task 3: Serialize same-profile OAuth recovery across tabs

**Files:**

- Create: `frontend/src/api/authRecoveryCoordinator.js`
- Create: `tests/test_auth_recovery_coordinator.js`

- [ ] **Step 1: Write failing leader/follower/expiry tests**

Use separate fake `sessionStorage` instances and one shared fake `localStorage`:

```javascript
test('one tab leads and a second tab follows the same live attempt', () => {
    const shared = createStorage();
    const tabA = createStorage();
    const tabB = createStorage();
    const leader = claimAuthRecovery(shared, tabA, 1_000, () => 'attempt-a');
    const follower = claimAuthRecovery(shared, tabB, 2_000, () => 'attempt-b');
    assert.deepEqual(leader, { role: 'leader', attemptId: 'attempt-a' });
    assert.deepEqual(follower, { role: 'follower', attemptId: 'attempt-a' });
});

test('an expired lease can be replaced without accepting its late success', () => {
    const shared = createStorage();
    claimAuthRecovery(shared, createStorage(), 1_000, () => 'old');
    const next = claimAuthRecovery(shared, createStorage(), 1_000 + AUTH_RECOVERY_LEASE_MS + 1, () => 'new');
    assert.deepEqual(next, { role: 'leader', attemptId: 'new' });
    assert.equal(isAuthRecoverySuccess({ attemptId: 'old', completedAt: 2_000 }, next.attemptId), false);
});

test('a locked tab can adopt a live attempt without clicking', () => {
    const shared = createStorage();
    claimAuthRecovery(shared, createStorage(), 1_000, () => 'leader');
    assert.deepEqual(readLiveAuthRecoveryLease(shared, 2_000), {
        attemptId: 'leader',
        startedAt: 1_000,
    });
});
```

Assert expired/malformed leases return `null`; records contain only `attemptId`, `startedAt`, and `completedAt`; and storage failures leave the current tab able to navigate as leader rather than deadlocking recovery.

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
node --test tests/test_auth_recovery_coordinator.js
```

Expected: FAIL because the coordinator module does not exist.

- [ ] **Step 3: Implement the pure coordinator**

Create these constants/functions:

```javascript
export const AUTH_RECOVERY_LEASE_KEY = 'jira_dashboard_auth_recovery_lease_v1';
export const AUTH_RECOVERY_SUCCESS_KEY = 'jira_dashboard_auth_recovery_success_v1';
export const AUTH_RECOVERY_TAB_ATTEMPT_KEY = 'jira_dashboard_auth_recovery_attempt_v1';
export const AUTH_RECOVERY_LEASE_MS = 5 * 60 * 1000;

const parseRecord = (raw) => {
    try { return JSON.parse(raw || 'null'); } catch (error) { return null; }
};

export function readLiveAuthRecoveryLease(sharedStorage, now = Date.now()) {
    try {
        const value = parseRecord(sharedStorage.getItem(AUTH_RECOVERY_LEASE_KEY));
        const live = value?.attemptId
            && Number.isFinite(value.startedAt)
            && value.startedAt <= now
            && now - value.startedAt <= AUTH_RECOVERY_LEASE_MS;
        return live ? { attemptId: String(value.attemptId), startedAt: value.startedAt } : null;
    } catch (error) {
        return null;
    }
}

export function claimAuthRecovery(sharedStorage, tabStorage, now = Date.now(), newId = () => crypto.randomUUID()) {
    try {
        const current = readLiveAuthRecoveryLease(sharedStorage, now);
        if (current) return { role: 'follower', attemptId: current.attemptId };
        const attemptId = String(newId());
        sharedStorage.removeItem(AUTH_RECOVERY_SUCCESS_KEY);
        sharedStorage.setItem(AUTH_RECOVERY_LEASE_KEY, JSON.stringify({ attemptId, startedAt: now }));
        tabStorage.setItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY, attemptId);
        return { role: 'leader', attemptId };
    } catch (error) {
        return { role: 'leader', attemptId: '' };
    }
}

export function completeAuthRecovery(sharedStorage, tabStorage, now = Date.now()) {
    try {
        const attemptId = String(tabStorage.getItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY) || '');
        if (!attemptId) return null;
        const lease = parseRecord(sharedStorage.getItem(AUTH_RECOVERY_LEASE_KEY));
        if (lease?.attemptId !== attemptId) return null;
        const success = { attemptId, completedAt: now };
        sharedStorage.setItem(AUTH_RECOVERY_SUCCESS_KEY, JSON.stringify(success));
        sharedStorage.removeItem(AUTH_RECOVERY_LEASE_KEY);
        tabStorage.removeItem(AUTH_RECOVERY_TAB_ATTEMPT_KEY);
        return success;
    } catch (error) {
        return null;
    }
}

export function isAuthRecoverySuccess(value, expectedAttemptId, lockedAt = 0) {
    return Boolean(
        value?.attemptId
        && value.attemptId === expectedAttemptId
        && Number(value.completedAt) > Number(lockedAt || 0)
    );
}
```

- [ ] **Step 4: Run coordinator tests**

Run:

```bash
node --test tests/test_auth_recovery_coordinator.js
```

Expected: PASS, including unavailable-storage fallback.

- [ ] **Step 5: Commit the coordinator module**

```bash
git add frontend/src/api/authRecoveryCoordinator.js tests/test_auth_recovery_coordinator.js
git commit -m "Coordinate OAuth recovery across tabs"
```

### Task 4: Integrate leader/follower recovery into the terminal gate

**Files:**

- Modify: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/shared/shell.css`
- Modify: `tests/test_auth_required.js`
- Modify: `tests/test_auth_isolation_source_guard.js`
- Modify: `tests/ui/global_auth_lock.spec.js`

- [ ] **Step 1: Write failing gate and two-tab Playwright tests**

Extend `global_auth_lock.spec.js` to create two pages in one context, drive each to the same Planning scope, choose different story keys in each page, and then return `401 auth_required` from each page's next app request. Assert:

```javascript
await expect(pageA.getByRole('alertdialog')).toBeVisible();
await expect(pageB.getByRole('alertdialog')).toBeVisible();
expect(await pageA.evaluate(() => sessionStorage.getItem('jira_dashboard_auth_resume_v1')))
    .not.toEqual(await pageB.evaluate(() => sessionStorage.getItem('jira_dashboard_auth_resume_v1')));
```

Click **Sign in again** only in A and assert only A navigates to `/login`; B adopts A's lease automatically and renders the follower status without a click or second OAuth request. Simulate the leader's authenticated return, let its bootstrap publish success, and assert B navigates to a new `/` document. After task hydration, A and B must show their original valid checkbox selections. Count the request that produced `401` and prove neither tab replays it.

Add identity-mismatch, capsule-expiry, missing-task pruning, Settings tab reopen, and connection token-input blank tests. Assert `window.__oldDocumentMarker` disappears after recovery navigation in both tabs, proving neither old document unlocked in place.

- [ ] **Step 2: Run focused Playwright to verify it fails**

Run:

```bash
npx playwright test tests/ui/global_auth_lock.spec.js
```

Expected: FAIL because the gate starts an uncoordinated link navigation and no post-login state restore occurs.

- [ ] **Step 3: Claim a recovery lease from the gate action**

Keep the existing sanitized same-tab target. On the action click, call `claimAuthRecovery(window.localStorage, window.sessionStorage)`. Leaders navigate to the safe URL. Followers call `event.preventDefault()`, store the active attempt id in component state, and render an accessible status such as `Sign-in is continuing in another tab. This tab will resume automatically.` The gate remains modal, inert, non-dismissible, and keyboard-blocking.

On gate mount and whenever `AUTH_RECOVERY_LEASE_KEY` changes, call `readLiveAuthRecoveryLease` and adopt its attempt id as follower state, even when this tab never clicked. Install the `storage` listener only while locked. When `AUTH_RECOVERY_SUCCESS_KEY` contains a success matching the adopted/claimed attempt and newer than `authRequired.lockedAt`, call `window.location.assign('/')` exactly once. Do not publish a success from the old locked document.

- [ ] **Step 4: Publish success only from a new authenticated document**

In `dashboard.jsx`, after `loadConfig` validates the authenticated private-view principal and the capsule has either been applied or rejected, call:

```javascript
completeAuthRecovery(window.localStorage, window.sessionStorage);
```

For Planning recovery, defer completion until scoped task reconciliation finishes. For a leader with no capsule, complete immediately after authenticated config bootstrap. Never complete from an unauthenticated/bootstrap-locked document.

- [ ] **Step 5: Preserve terminal lock and privacy guards**

Update unit/source guards to assert:

- auth-required state is still window-local, not stored in shared storage;
- only coordinator attempt ids/timestamps use `localStorage`;
- only the allowlisted capsule uses `sessionStorage`;
- the gate never calls an API, clears the auth latch, or replays a request;
- recovery navigation remains same-tab and sanitized;
- no token/email/config/issue payload enters shared coordinator records.

- [ ] **Step 6: Run focused unit and Playwright tests**

Run:

```bash
node --test tests/test_auth_required.js tests/test_auth_resume_state.js tests/test_auth_recovery_coordinator.js tests/test_planning_selection_state.js tests/test_auth_isolation_source_guard.js
npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js
```

Expected: PASS, including the two-tab recovery and no-replay assertions.

- [ ] **Step 7: Commit the gate integration**

```bash
git add frontend/src/components/AuthRequiredGate.jsx frontend/src/dashboard.jsx frontend/src/styles/shared/shell.css tests/test_auth_required.js tests/test_auth_isolation_source_guard.js tests/ui/global_auth_lock.spec.js tests/ui/planning_selection_defaults.spec.js
git commit -m "Resume locked tabs after OAuth login"
```

### Task 5: Build and verify the complete frontend slice

**Files:**

- Modify generated outputs under `frontend/dist/` only through the build
- Modify source/tests only if verification finds a requirement-scoped defect

- [ ] **Step 1: Install the pinned frontend dependencies in this worktree**

Run:

```bash
npm ci
```

Expected: exit `0`; dependencies resolve inside this worktree rather than from an ancestor checkout.

- [ ] **Step 2: Run all focused Node tests**

Run:

```bash
node --test tests/test_auth_required.js tests/test_auth_resume_state.js tests/test_auth_recovery_coordinator.js tests/test_auth_focus_refresh.js tests/test_planning_selection_state.js tests/test_auth_isolation_source_guard.js tests/test_frontend_api_source_guards.js
```

Expected: PASS.

- [ ] **Step 3: Build generated frontend assets**

Run:

```bash
npm run build
```

Expected: exit `0`; `frontend/dist/dashboard.js`, CSS, maps, and the separate auth-focus bundle are regenerated from source. Do not hand-edit them.

- [ ] **Step 4: Run the focused browser suite**

Run:

```bash
npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/auth_focus_refresh_counts.spec.js tests/ui/planning_selection_defaults.spec.js tests/ui/settings_unified_save.spec.js tests/ui/scenario_draft_collaboration.spec.js
```

Expected: PASS. Capture a screenshot of each locked tab before leader navigation and each restored Planning tab after bootstrap for PR evidence.

- [ ] **Step 5: Run full repository verification**

Run:

```bash
python3 -m unittest discover -s tests
npm run build
git diff --check
```

Expected: Python suite PASS; second build exits `0`; `git diff --check` passes; the second build introduces no additional generated diff.

- [ ] **Step 6: Inspect storage and analytics privacy**

Run:

```bash
rg -n "AUTH_RESUME|AUTH_RECOVERY|sessionStorage|localStorage" frontend/src tests
rg -n "auth_resume|recovery_attempt|browser_session_id|selectedTaskKeys" docs/README_ANALYTICS.md frontend/src/analytics
```

Expected: storage use is limited to the two new modules and their explicit integration/tests; no new GA4 parameter/event is present; issue keys, attempt ids, capsule contents, and browser-session ids are absent from analytics.

- [ ] **Step 7: Commit generated assets and any verified correction**

```bash
git add frontend/dist frontend/src tests
git commit -m "Verify per-tab authentication recovery"
```

If Tasks 1-4 already committed every source/test change and the build produced no tracked change, do not create an empty commit.
