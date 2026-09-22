# Connection Recovery Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace partial in-place connection retry with one guarded hard reload that preserves supported tab-local Settings and Scenario Planner drafts and restores the user's position after fresh bootstrap.

**Architecture:** A new pure `connectionRecoveryState` module owns a versioned, bounded, expiring `sessionStorage` capsule. `dashboard.jsx` captures only established Settings and Scenario draft data, probes authenticated backend readiness once, and reloads only after the capsule is safely written; the new document validates the same workspace/private-view principal, reuses the existing ordered shell restoration, overlays local drafts on fresh server baselines, and surfaces revision changes through existing conflict UI. The server-unavailable banner becomes a small recovery state machine, while ordinary auth-focus refresh stays unchanged.

**Tech Stack:** React 19, browser `sessionStorage`, existing authenticated `/api/auth/status`, esbuild, Node `node:test`, Playwright, and the existing Flask dashboard fixture.

---

## Execution Contract

- Execute on `bugfix/connection-recovery-reload`; do not use another worktree.
- Do not alter backend endpoint or credential contracts.
- Do not serialize credentials, email addresses, OAuth data, loaded Jira records, response bodies, or arbitrary React state.
- Do not replay any read or write after the document reloads. Restoration changes local UI state only.
- Do not change the ordinary `authFocusRefresh.js` long-absence state machine.
- Commit each task only after its focused tests pass. Do not push without explicit user confirmation.

## File Map

- Create `frontend/src/api/connectionRecoveryState.js`: strict capsule normalization, storage access, expiry, size, read/write/clear.
- Create `tests/test_connection_recovery_state.js`: deterministic unit coverage for the storage contract.
- Modify `frontend/src/components/ServerUnavailableBanner.jsx`: unavailable/checking/recovered-copy rendering and busy behavior.
- Modify `frontend/src/dashboard.jsx`: capture refs, readiness probe, reload single-flight, visibility return, Refresh Jira gate, staged restoration, conflicts, and scroll restoration.
- Modify `tests/ui/server_unavailable_ui.spec.js`: request/reload counts and banner behavior.
- Modify `tests/ui/settings_unified_save.spec.js`: dirty Settings restoration and revision-conflict preservation.
- Modify `tests/ui/scenario_draft_history.spec.js`: dirty Scenario restoration and revision-conflict preservation.
- Modify `tests/test_frontend_api_source_guards.js`: security and separation guards for recovery storage.
- Modify `docs/ontology.md`: map connection recovery and its relationship to auth recovery and bootstrap.
- Modify `docs/README_ANALYTICS.md`: no-event allowlist entry.
- Modify `docs/plans/README.md`: index this active execution plan.
- Modify `docs/agents/bugfixes/2026-09-22-planned-connection-recovery-reload.md`: execution outcome and accuracy.
- Rename `docs/agents/bugfixes/2026-09-22-planned-connection-recovery-reload.md` to
  `docs/agents/bugfixes/2026-09-22-executed-connection-recovery-reload.md` after verification.
- Rebuild generated `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` through `npm run build`; never edit them by hand.

Every named existing file above was verified before execution. New files are explicitly marked Create.

### Task 1: Tab-local recovery capsule

**Files:**
- Create: `frontend/src/api/connectionRecoveryState.js`
- Create: `tests/test_connection_recovery_state.js`
- Modify: `tests/test_frontend_api_source_guards.js`

- [ ] **Step 1: Write failing capsule unit tests**

Create a CommonJS esbuild/vm harness matching `tests/test_auth_resume_state.js`. Cover:

```javascript
test('writes and reads one same-principal connection recovery capsule', () => {
    const storage = createStorage();
    const snapshot = recoverySnapshot();
    assert.equal(api.writeConnectionRecoveryState(storage, snapshot, 1_000), true);
    assert.deepEqual(
        api.readConnectionRecoveryState(storage, snapshot.principal, 1_001),
        { ...snapshot, version: 1, capturedAt: 1_000 },
    );
});

test('rejects expiry, principal mismatch, oversize, malformed and forbidden keys', () => {
    const storage = createStorage();
    assert.equal(api.writeConnectionRecoveryState(storage, recoverySnapshot(), 1_000), true);
    assert.equal(api.readConnectionRecoveryState(storage, { workspaceId: 'other', viewConfigId: 'view-1' }, 1_001), null);
    assert.equal(storage.getItem(api.CONNECTION_RECOVERY_STORAGE_KEY), null);
});
```

Also assert storage getter failures are no-ops; exact schema rejects `email`, `apiToken`, `authorization`, `response`, `loadedIssues`, and unknown top-level keys; unsupported Settings/Scenario keys fail; negative/non-finite timestamps fail; values over `CONNECTION_RECOVERY_MAX_BYTES` fail; and `clearConnectionRecoveryState` is idempotent.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node --test tests/test_connection_recovery_state.js`

Expected: FAIL because `frontend/src/api/connectionRecoveryState.js` does not exist.

- [ ] **Step 3: Implement the strict capsule module**

Export this public surface:

```javascript
export const CONNECTION_RECOVERY_STORAGE_KEY = 'jira_dashboard_connection_recovery_v1';
export const CONNECTION_RECOVERY_VERSION = 1;
export const CONNECTION_RECOVERY_TTL_MS = 30 * 60 * 1000;
export const CONNECTION_RECOVERY_MAX_BYTES = 512 * 1024;

export function getConnectionRecoveryStorage(win = globalThis.window) { /* guarded sessionStorage */ }
export function writeConnectionRecoveryState(storage, snapshot, now = Date.now()) { /* normalize + size + write */ }
export function readConnectionRecoveryState(storage, principal, now = Date.now()) { /* validate + same principal */ }
export function clearConnectionRecoveryState(storage = getConnectionRecoveryStorage()) { /* guarded removal */ }
```

Allow exactly these normalized branches:

```javascript
{
  principal: { workspaceId, viewConfigId },
  view: { selectedView, activeGroupId, selectedSprint, engMode, settingsOpen, settingsTab, scrollX, scrollY },
  settings: null | {
    sharedConfigRevision, groupsConfigRevision, activeGroupDraftId, departmentSettingsTab, epmSettingsTab,
    dirty: { projects, priorityWeights, board, capacity, fieldConfigs, issueTypes, adminAccess, groups, groupVisibility, epm },
    drafts: { projects, priorityWeights, board, capacity, fieldConfigs, issueTypes, adminAccess, groups, groupVisibility, epm }
  },
  scenario: null | {
    scopeKey, activeDraftId, baseDraftRevision, savedOverrides, localOverrides,
    editMode, scrollTop, scrollLeft
  }
}
```

Use exact-key validation at every structural level, plain JSON records only, finite bounded numbers, bounded strings/arrays, and a recursive JSON-safety check that rejects `__proto__`, `prototype`, and `constructor`. Preserve only branches explicitly supplied by the dashboard; do not infer defaults that could convert clean state into dirty state.

- [ ] **Step 4: Add source guards**

Assert the module uses `sessionStorage` and contains no `localStorage`, `fetch`, credential names, analytics calls, or event listeners. Assert `authResumeState.js` is unchanged and still excludes Settings and Scenario payloads.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `node --test tests/test_connection_recovery_state.js tests/test_frontend_api_source_guards.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/connectionRecoveryState.js tests/test_connection_recovery_state.js tests/test_frontend_api_source_guards.js
git commit -m "Add tab-local connection recovery capsule"
```

### Task 2: Recovery banner state and single-flight reload

**Files:**
- Modify: `frontend/src/components/ServerUnavailableBanner.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/ui/server_unavailable_ui.spec.js`

- [ ] **Step 1: Extend the browser test to prove current failure**

Add request counters for `/api/auth/status`, `/api/config`, `/api/groups-config`, `/api/sprints`, and document requests. Add cases that assert:

```javascript
await page.getByRole('button', { name: 'Retry connection' }).click();
await expect.poll(() => counters.authStatus).toBe(1);
await expect.poll(() => counters.documents).toBe(2);
expect(counters.retryBootstrapFanout).toBe(0);
```

Cover a failed readiness probe retaining the banner, duplicate Retry clicks producing one probe, a `401` showing the existing auth lock without reload, and the Refresh Jira control being disabled while unavailable/checking.

- [ ] **Step 2: Run the focused browser spec and confirm RED**

Run: `npx playwright test tests/ui/server_unavailable_ui.spec.js`

Expected: FAIL because Retry still calls the parallel loader fan-out and does not reload.

- [ ] **Step 3: Implement the recovery state machine**

In `dashboard.jsx`, replace the string-only retry behavior with:

```javascript
const [connectionRecoveryStatus, setConnectionRecoveryStatus] = useState('idle');
const connectionRecoveryInFlightRef = useRef(false);
const connectionReloadStartedRef = useRef(false);
const serverUnavailableRef = useRef(false);
```

Keep `serverConnectionError` for visible copy. `reportServerConnectionError` sets `unavailable`; a successful ordinary bootstrap clears both. Implement one `recoverServerConnection` callback that:

1. exits unless unavailable and not already in flight;
2. sets `checking`;
3. calls existing `fetchAuthStatus(BACKEND_URL)` with no cache;
4. leaves auth-required handling to `apiFetch`/the global auth lock;
5. on a network failure returns to `unavailable` with the banner intact;
6. on success writes the Task 1 capsule;
7. refuses reload and shows a preservation error if a non-null dirty branch cannot be stored;
8. otherwise sets `restoring`, marks reload started, and calls `window.location.reload()` once.

Delete the old `retryServerConnection` loader fan-out. Pass status and the new callback into `ServerUnavailableBanner`. Render `Checking connection…` while busy and disable the button.

Include `connectionRecoveryStatus !== 'idle'` in `manualRefreshDisabled` so Refresh Jira cannot run during recovery.

- [ ] **Step 4: Run the focused browser spec and confirm GREEN**

Run: `npx playwright test tests/ui/server_unavailable_ui.spec.js`

Expected: all cases pass with one probe, one reload, and no retry fan-out.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ServerUnavailableBanner.jsx frontend/src/dashboard.jsx tests/ui/server_unavailable_ui.spec.js
git commit -m "Reload cleanly after connection recovery"
```

### Task 3: Automatic recovery on visible tab return

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/ui/server_unavailable_ui.spec.js`

- [ ] **Step 1: Add RED visibility-return cases**

Use the existing visibility-state shim pattern from `tests/ui/auth_focus_refresh_counts.spec.js`. Prove hidden → visible while unavailable invokes the shared recovery callback once, a focus/visibility burst does not duplicate it, and ordinary visible returns without the banner issue zero recovery probes and zero document reloads.

- [ ] **Step 2: Run the focused browser spec and confirm RED**

Run: `npx playwright test tests/ui/server_unavailable_ui.spec.js`

Expected: the unavailable visible-return case times out because no listener exists.

- [ ] **Step 3: Add banner-scoped visibility wiring**

Install one `visibilitychange` listener in the dashboard component. On `visible`, call a ref to `recoverServerConnection` only when `serverUnavailableRef.current` is true. Do not add a second `focus` listener and do not modify `authFocusRefresh.js`; this keeps ordinary auth-refresh request counts unchanged and prevents focus/visibility bursts from creating duplicate attempts.

```javascript
const recoverServerConnectionRef = useRef(null);
recoverServerConnectionRef.current = recoverServerConnection;
useEffect(() => {
    const handleConnectionVisibleReturn = () => {
        if (document.visibilityState !== 'visible' || !serverUnavailableRef.current) return;
        void recoverServerConnectionRef.current?.();
    };
    document.addEventListener('visibilitychange', handleConnectionVisibleReturn);
    return () => document.removeEventListener('visibilitychange', handleConnectionVisibleReturn);
}, []);
```

- [ ] **Step 4: Run recovery and auth-focus browser specs**

Run: `npx playwright test tests/ui/server_unavailable_ui.spec.js tests/ui/auth_focus_refresh_counts.spec.js`

Expected: all tests pass; auth-focus document and POST counts remain unchanged when the connection banner is absent.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/server_unavailable_ui.spec.js
git commit -m "Recover unavailable tabs when they become visible"
```

### Task 4: Settings draft capture and staged restoration

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/ui/settings_unified_save.spec.js`

- [ ] **Step 1: Add RED same-revision and changed-revision cases**

Extend the existing config fixture so a document reload can return either the same or incremented workspace/group/EPM revisions. In both cases, create dirty Settings values before forcing connection failure and recovery. Assert after reload:

- Settings reopens on the prior tab;
- only previously dirty sections differ from fresh baselines;
- credential inputs are blank;
- no POST occurred during restoration;
- Save remains enabled;
- same revisions restore as ordinary dirty state;
- changed workspace/group revision renders the existing conflict copy and retains local values.

- [ ] **Step 2: Run the focused cases and confirm RED**

Run: `npx playwright test tests/ui/settings_unified_save.spec.js --grep "connection recovery"`

Expected: restored Settings values are absent after the reload.

- [ ] **Step 3: Capture only dirty Settings sections**

Reuse the established draft values already collected by `captureFirstRunSettingsDrafts`, but build a connection snapshot that includes `groupDraft` rather than the saved `groupsConfig`. Store each section only when its existing dirty predicate is true. Store `sharedConfigRevisionRef.current`, `groupDraft.configRevision`, current Settings tabs, and `activeGroupDraftId`. Exclude Connections and all credential fields.

- [ ] **Step 4: Restore after fresh baselines are ready**

Read the capsule in `loadConfig` only after `resumePrincipal` is established. Stage it in refs; do not apply drafts inside the fetch callback. Reuse the existing shell ordering for group, sprint, view, and Settings tab. In a separate effect gated on `sharedConfigReady`, `!groupsLoading`, and the required EPM/admin loaders:

- apply captured dirty admin values through their existing setters;
- apply `groupDraft`, group-visibility draft setters, and EPM draft through existing normalizers/setters;
- restore the active Settings subtab and draft row;
- compare captured workspace/group revisions to fresh revisions;
- on mismatch set `workspaceConfigConflict` or `groupsConfigConflict` with existing message shapes and current revisions;
- never invoke `saveAllSettings`, any request function, or analytics during restoration.

Mark the Settings phase settled once. Keep the capsule until Scenario and scroll phases also settle.

Use an idempotent staged effect shaped as follows; the implementation fills every named dirty section
with the existing setter already listed in `captureFirstRunSettingsDrafts`:

```javascript
useEffect(() => {
    const pending = pendingConnectionRecoveryRef.current;
    if (!pending?.settings || connectionRecoverySettledRef.current.has('settings')) return;
    if (!sharedConfigReady || groupsLoading) return;
    const captured = pending.settings;
    applyCapturedConnectionSettings(captured, {
        setSelectedProjectsDraft, setPriorityWeightsDraft, setBoardIdDraft, setBoardNameDraft,
        setCapacityProjectDraft, setCapacityFieldIdDraft, setCapacityFieldNameDraft,
        setSprintFieldIdDraft, setSprintFieldNameDraft, setParentNameFieldIdDraft,
        setParentNameFieldNameDraft, setStoryPointsFieldIdDraft, setStoryPointsFieldNameDraft,
        setTeamFieldIdDraft, setTeamFieldNameDraft, setDeliveryOwnerFieldIdDraft,
        setDeliveryOwnerFieldNameDraft, setIssueTypesDraft, setEpmConfigDraft, setGroupDraft,
        setVisibleGroupDraftIds, setFavoriteGroupDraftId,
    });
    if (captured.sharedConfigRevision !== sharedConfigRevisionRef.current) {
        setWorkspaceConfigConflict(buildConnectionWorkspaceConflict(captured.dirty, sharedConfigRevisionRef.current));
    }
    if (captured.groupsConfigRevision !== Number(groupsConfig.configRevision || 0)) {
        setGroupsConfigConflict({ current: groupsConfig, savedSections: [] });
    }
    connectionRecoverySettledRef.current.add('settings');
    settleConnectionRecoveryIfComplete();
}, [sharedConfigReady, groupsLoading, groupsConfig]);
```

Define `applyCapturedConnectionSettings` and `buildConnectionWorkspaceConflict` as pure helpers in
`connectionRecoveryState.js`; unit-test that clean/absent sections never call an apply callback and
that pending conflict labels match the dirty section map.

- [ ] **Step 5: Run focused Settings and unit tests**

Run: `npx playwright test tests/ui/settings_unified_save.spec.js --grep "connection recovery"`

Run: `node --test tests/test_connection_recovery_state.js tests/test_workspace_config_conflict.js tests/test_epm_settings_source_guards.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/settings_unified_save.spec.js
git commit -m "Restore unsaved Settings after connection reload"
```

### Task 5: Scenario draft and timeline restoration

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/ui/scenario_draft_history.spec.js`

- [ ] **Step 1: Add RED Scenario recovery cases**

Create local unsaved overrides, timeline scroll offsets, and edit mode, then trigger connection recovery. After reload assert the same scope and draft reopen, local overrides remain dirty, the undo stack is empty, no scenario POST occurred, and scroll offsets restore after the timeline renders. Add a second case where the server draft revision advances during reload; assert local overrides remain and the established remote-conflict UI appears.

- [ ] **Step 2: Run the focused cases and confirm RED**

Run: `npx playwright test tests/ui/scenario_draft_history.spec.js --grep "connection recovery"`

Expected: local overrides and scroll position disappear after reload.

- [ ] **Step 3: Capture normalized Scenario state**

When `scenarioHasUnsavedChanges`, capture only normalized `savedOverrides` and `localOverrides`, `scenarioDraftMeta.scopeKey`, active draft id, base draft revision, edit mode, and timeline scroll offsets. Exclude issues, summaries, presence, locks, events, undo history, writeback previews, and loaded response payloads.

- [ ] **Step 4: Restore after the fresh draft baseline loads**

Gate restoration on the exact selected group/sprint scope, loaded Scenario data, and completed active-draft fetch. If draft id and base revision match, apply normalized local overrides, set dirty state, restore edit mode, and clear undo. If the server revision or active draft differs, retain local overrides and set the existing `conflict_remote`/conflict presentation without changing the fresh saved baseline. Never auto-save or replay a Scenario request.

After layout, restore timeline `scrollTop`/`scrollLeft` in one `requestAnimationFrame`; restore window scroll only after the target view/modal exists. Record both phases as settled and clear the capsule.

```javascript
useEffect(() => {
    const pending = pendingConnectionRecoveryRef.current;
    if (!pending?.scenario || connectionRecoverySettledRef.current.has('scenario')) return;
    if (!scenarioData || scenarioDraftMeta.loadingHistory || pending.scenario.scopeKey !== scenarioScopeKey) return;
    const restored = resolveConnectionScenarioDraft(pending.scenario, {
        activeDraftId: scenarioDraftMeta.activeDraft?.draftId || '',
        baseDraftRevision: scenarioDraftMeta.baseDraftRevision,
        savedOverrides: scenarioDraftMeta.savedOverrides,
    });
    setScenarioOverrides(restored.localOverrides);
    setScenarioEditMode(restored.editMode);
    scenarioUndoStackRef.current.clear();
    setScenarioUndoVersion(0);
    setScenarioDraftMeta(previous => ({
        ...previous,
        dirtyState: restored.conflict ? 'conflict_remote' : 'dirty',
        conflict: restored.conflict || previous.conflict,
    }));
    requestAnimationFrame(() => {
        if (scenarioTimelineRef.current) {
            scenarioTimelineRef.current.scrollTop = pending.scenario.scrollTop;
            scenarioTimelineRef.current.scrollLeft = pending.scenario.scrollLeft;
        }
        connectionRecoverySettledRef.current.add('scenario');
        settleConnectionRecoveryIfComplete();
    });
}, [scenarioData, scenarioDraftMeta.loadingHistory, scenarioDraftMeta.baseDraftRevision, scenarioScopeKey]);
```

Define and unit-test `resolveConnectionScenarioDraft` in `connectionRecoveryState.js`; it returns the
captured normalized local overrides and a conflict descriptor whenever draft identity or base revision
does not match the fresh baseline.

- [ ] **Step 5: Run focused Scenario and recovery tests**

Run: `npx playwright test tests/ui/scenario_draft_history.spec.js --grep "connection recovery" tests/ui/server_unavailable_ui.spec.js`

Expected: all tests pass with zero mutation replay and one reload.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx tests/ui/scenario_draft_history.spec.js
git commit -m "Restore unsaved Scenario work after recovery"
```

### Task 6: Documentation, analytics, build, and verification

**Files:**
- Modify: `docs/ontology.md`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/agents/bugfixes/2026-09-22-planned-connection-recovery-reload.md`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`

- [ ] **Step 1: Update maintained documentation**

Add a verified Connection Recovery ontology entry naming the banner, capsule, dashboard bootstrap consumer, auth-focus relationship, and tests. Add the no-event analytics allowlist reason: internal reliability state, existing `api_result`/`app_error_shown`, and explicit prohibition on capsule contents or restore outcomes. After verification, rename the bugfix artifact to `2026-09-22-executed-connection-recovery-reload.md`, set `Status: executed`, and record the actual result and any divergence.

Add `EXEC-connection-recovery-reload.md` to the Frontend Planning Workflow in `docs/plans/README.md`
before execution begins; when complete, describe the verified result without renaming the plan to
`DONE-*` until the implementation is accepted or merged.

- [ ] **Step 2: Build generated frontend output**

Run: `npm run build`

Expected: esbuild completes all auth, JS, and CSS bundles without errors; generated dashboard files change only through the build.

- [ ] **Step 3: Run focused verification**

Run:

```bash
node --test tests/test_connection_recovery_state.js tests/test_frontend_api_source_guards.js tests/test_workspace_config_conflict.js tests/test_epm_settings_source_guards.js
npx playwright test tests/ui/server_unavailable_ui.spec.js tests/ui/auth_focus_refresh_counts.spec.js tests/ui/settings_unified_save.spec.js tests/ui/scenario_draft_history.spec.js
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Run repository verification proportional to the cross-cutting UI change**

Run:

```bash
python3 -m unittest discover -s tests
npm run test:frontend:unit
```

Expected: every command exits 0. If the complete Playwright suite is practical in the configured environment, also run `npx playwright test`; otherwise report the focused browser suite exactly.

- [ ] **Step 5: Perform visual and runtime verification**

Start the local server through the repository runtime, verify `/api/test`, and capture before/after screenshots for unavailable, checking, restored Settings draft, and restored Scenario conflict states. Confirm no browser console errors and no repeated document reload when the backend stays unavailable.

- [ ] **Step 6: Review the final diff and commit**

Confirm every changed line traces to this bug, generated files match source, no local paths or Jira data entered documentation/tests, and no secret-shaped fields enter the capsule.

```bash
git add docs/ontology.md docs/README_ANALYTICS.md docs/plans/README.md docs/agents/bugfixes/2026-09-22-executed-connection-recovery-reload.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "Document and build connection recovery"
```

Do not push or create a pull request without explicit user confirmation and the repository's publication transaction checks.
