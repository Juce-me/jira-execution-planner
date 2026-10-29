# Board Status Pill Non-Blocking Implementation Plan

> **Status:** Planned. Validated on 2026-10-29 against `ca92b08b` (current `origin/main` merge of #325), revised after two independent reviews; not executed. Branch: `bugfix/241-board-status-pill-nonblocking`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changing an Epic or Story status through a Board pill behaves like drag and drop: the new status shows at once, the menu is closed, nothing else on the Board is locked, a failure rolls back with a visible announcement, and a second change on another Epic is accepted while the first is pending.

**Architecture:** Two of issue #241's three causes are already fixed on `main` (see Validation). The remaining work removes the Board-only global lock in `handleSubmitStatusTransition` so the hook's per-key protection does the work, makes the drag cleanup key-aware so concurrent moves cannot close each other's menu, reports each pill outcome through a per-call `onSettled` callback into the Board's existing announcement area, keeps other Epics' pending patches across a Priority/Project Track refresh, and pins everything with tests, including a new strict-scope (Component / All work) fixture.

**Tech Stack:** React 19, esbuild, Playwright (Chromium), Node `node:test`, Python `unittest`.

**Spec:** GitHub issue #241, read with the Validation and Decisions sections below, which supersede its cause list.

## Validation of issue #241

Issue filed 2026-10-06.

| Claim | Status | Evidence |
| --- | --- | --- |
| 1. Menu stays open after a pick | Already fixed (2026-10-09, `d2ee26ca`) | `useEngStatusTransitions.js` `submitStatusTransition` calls `closeSingleIssueStatusControl()` right after the edit reservation. Needs a pinning test only. |
| 2. Global lock | **Valid** | `dashboard.jsx` `handleSubmitStatusTransition` sets `statusTransitionSubmitting` for the whole await and returns `null` for a second Board submit. The flag also reaches `submitting` on Board pills (`EngBoardEpicPanel.jsx`) and, as a dead prop, Catch Up (`EpicBlock.jsx`, `IssueCard.jsx`). |
| 3. Full refresh in strict scopes | Already fixed (2026-10-15, `c87102be`, `b89e80fd`) | `strictEngBoardMutationProps.status.onTransitionSuccessRefresh` no longer reloads in strict scope; `buildStrictEngBoardViewModel` moves a patched Epic to the owning column optimistically. The "re-home patched keys" decision is shipped. |
| A strict refresh clears all patches | Valid for Priority and Project Track only | `useStrictEngBoardOwner.refresh` runs `setIssuePatchesByKey({})` on any non-automatic success; the priority and track success handlers call it, status no longer does. `afterCommit` already reconciles against each committed snapshot. |
| Failure announcement | Valid gap | A pill failure is stored in hook state and shown only inside an open menu, now closed, so a rollback is silent on Board. Drag announces through `announce()` in `EngBoardView.jsx`. |

## Decisions (operator, 2026-10-29)

- **D1 Lock scope:** remove the lock for pills and drag; make drag cleanup key-aware (Task 3). Rejected: pills-only, per-move target capture (changes the pinned hook signature).
- **D2 Write order:** document as-is. Strict scopes serialize writes through the Board coordinator (B's POST is sent only after A settles). The sprint Board has no coordinator: `enqueueEngIssueMutations` runs up to 4 different-key writes in parallel and serializes per key, which is safe because each write touches only its own key. Tests assert the right timing per scope. This reverses the documented "Board holds one write at a time" comment and the guard text in `tests/test_eng_board_drop_source_guards.js`; update both.
- **D3 Announcements:** one slot, last outcome wins (documented), plus a test that the announcement is not covered by the Epic panel backdrop; fix layering only if that test fails.
- **D4 Scope:** strict fixture, strict tests and the patch-retention fix are all in this plan.

Known accepted risk (not changed): the coordinator has no timeout, so a hung first Jira write blocks later strict-scope Board mutations (status, priority, track) while the UI stays optimistic; and `complete()` is called by every hook even when a planning-surface submit bypassed `enqueue`, which is harmless today because no coordinator is passed on Planning.

## Global Constraints

- A Jira write element writes only its own issue key; no new write path. The single `transitionIssues(` call in the hook stays, and `handleSubmitStatusTransition` forwards only `issue.key`.
- Reuse the Board `board-say` announcement area and the existing `StatusTransitionMenu`/`StatusPill`; no new class, control or CSS (so no new hover/geometry assertion unless Task 4's visibility test forces a layering fix, in which case section 11 hover/geometry rules apply).
- Strict-scope membership stays server-authoritative beyond the existing patch rule. Epic header and `.ecard-open` hover are untouched.
- Touch must work; no new keyboard-only work.
- Analytics: no new event; `status_change_submit` / `status_change_result` payloads are unchanged. Add the allowlist row to `docs/README_ANALYTICS.md` (Task 8).
- Never use port 5050 from this worktree. Fixtures are synthetic; delete any screenshot of live data.

## Review Focus

- Two Epics changed back to back, first write held: both show the new status at once; strict scope sends B's POST only after A settles, sprint scope sends both.
- First write fails while the second is queued: only the first rolls back; its failure text is announced (and, per D3, may be replaced by the second outcome within 6 s).
- Same Epic changed twice while pending: the second submit is refused by the per-key guard; its own pill stays disabled, other pills do not.
- Two drags back to back, first held: the first's completion never closes the second's menu, stalls its drop or rolls it back to no status. A drag completing while a pill menu for another key is open leaves that menu open.
- Pill failure in strict scope: the card returns to its source column and the announcement is visible, not covered by the panel backdrop.
- Unconfirmed write, auth abandon, scope switch while a write is queued: no "did not go through" text; unconfirmed has its own copy, the others stay silent.
- Priority or Project Track refresh while another Epic's status write is pending: that Epic's patch survives. (The refreshing issue's own patch is also retained until the next committed snapshot reconciles it, which is harmless; a finished status write whose Jira view still lags is dropped as today, not a regression.)
- A drag dropped on a column while another Epic's drop menu is open must not leave that menu pointing at a closed target (it would write with an empty current status).

---

### Task 1: Per-key held transitions and failing UI tests (sprint scope)

**Files:**
- Modify: `tests/ui/eng_group_board_panel.spec.js` (the `/api/issues/transitions` and options mocks near lines 139-225; new tests beside "a status pill click in the panel performs a real transition", ~937)
- Reuse: the `transitionGate` / `transitionFails` pattern in `tests/ui/eng_group_board_drag.spec.js:224-240`

**Interfaces:**
- Produces: `openBoard(page, calls, { holdTransitions: true })` with `calls.held: Map<issueKey, { release(), fail() }>`. The transitions mock echoes each request's `issueKeys` and `targetStatus` into its `results` (it currently always answers for `PLAT-1-b`), the options mock returns real `issues` entries per key, and `calls.push` happens before the gate.

- [ ] **Step 1: Implement the key-echoing, per-key-gated mock** described above.
- [ ] **Step 2: Write failing tests** in the panel spec:
  - `pill status change shows at once and closes the menu while Jira is pending`: Story row and Epic pill (`.m-controls`) show `Done`, `.status-transition-menu` count 0, POST held.
  - `other pills stay enabled while a status write is pending`: another Story row's pill is enabled and opens its menu; the pending issue's own pill is disabled.
  - `a second Epic status change is accepted while the first is pending`: pick Done on Epic A, close the panel (Escape), open Epic B, pick Done; both POSTs carry only their own key; releasing both lands both statuses.
  - `same Epic cannot be changed twice while pending`: no second POST.
  - `a failed pill status change rolls back and is announced`: fail A's write; pill returns to the old status; `.board-say.is-error` contains the key.
  - `a successful pill status change is announced`: `.board-say.has-message` contains `→ Done`; the Story-row pill announces too.
- [ ] **Step 3: Run them and confirm the expected failures**

Run: `npm run build && npx playwright test tests/ui/eng_group_board_panel.spec.js --browser=chromium -g "pill status change shows at once|other pills stay enabled|second Epic status change|cannot be changed twice|failed pill status change|successful pill status change"`
Expected red until Task 2 (the "lock tests"): `other pills stay enabled` and `second Epic status change`. Expected red until Task 4: both announcement assertions (the rollback half of `failed pill status change` already passes). Expected green now: at-once, menu-closed, same-Epic, rollback.

- [ ] **Step 4: Commit** the red tests locally as `Pin Board status pill behavior with failing tests (#241)`; squash into the fix commits before the publication transaction so no pushed head is red.

### Task 2: Remove the Board global lock

**Files:**
- Modify: `frontend/src/dashboard.jsx` (state ~4769, `handleSubmitStatusTransition` ~4911-4921 and its dependency list, props ~5699, ~6085, ~6718)
- Modify: `frontend/src/eng/EngBoardView.jsx` (prop 106, pass 1366), `frontend/src/eng/EngBoardEpicPanel.jsx` (prop 53, `submitting` ~225 and ~353), `frontend/src/eng/EpicBlock.jsx` (39, 280, 370), `frontend/src/issues/IssueCard.jsx` (39, 285, 392)
- Modify tests: `tests/test_design_system_write_contract.js:191-198` (`statusHandlerPolicy`: assert exactly one `submitStatusTransition(` call forwarding `targetStatus,issue.key`; keep every widening check; Task 4 relaxes it to allow a trailing `,options`), `tests/test_eng_controls.js:215` (drop the name from the EpicBlock prop list), `tests/test_eng_board_drop_source_guards.js` (first test matches the keyless refusal followed directly by the passthrough return; new test: `dashboard.jsx` has no `setStatusTransitionSubmitting`; remove the "single-issue path remains serialized" comment per D2, and the stale "Board additionally holds one write at a time" comment above the handler in `dashboard.jsx`)
- Modify: `scripts/extraction_lint/owner_budgets.json`: `dashboard.jsx` `lineCeiling` set to the exact new `wc -l` (currently 7302 = actual) and `hookCeilings.useState` 117 to 116; the `eng.EpicBlock` interface: remove `statusTransitionSubmitting` from `propNames`, `expandedInputNames` and `inventory.memberNames` (it is not in `inputNames`), lower `propCount`/`propCeiling` (37) and `expandedInputCount`/`expandedInputCeiling` (119) by one, update `callers` if it changes, re-stamp `inventory.sourceDigest`. `rg statusTransitionSubmitting scripts` must return nothing. `EngBoardView.jsx`, `EngBoardEpicPanel.jsx`, `IssueCard.jsx` and `useStrictEngBoardIntegration.js` are not registered, so need no entry

**Interfaces:**
- Produces: `handleSubmitStatusTransition(targetStatus: string, issue: { key: string }) => Promise<response | null>` that refuses a keyless issue and otherwise returns `submitStatusTransition(targetStatus, issue.key)` on every surface (the `options` argument is added in Task 4); every `submitting` prop is `!!statusTransitions.pendingIssueKeys?.has(key)` only.

- [ ] **Step 1: Make the handler the keyed passthrough** and remove the state and every `statusTransitionSubmitting` reference listed above; `rg statusTransitionSubmitting frontend/src` must return nothing.
- [ ] **Step 2: Update the three tests and the budget entries** as listed.
- [ ] **Step 3: Run** `node --test tests/test_design_system_write_contract.js tests/test_eng_controls.js tests/test_eng_board_drop_source_guards.js tests/test_planning_action_source_guards.js`, then the Task 1 lock tests. Expected: pass.
- [ ] **Step 4: Run** `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` and `bash scripts/extraction_lint/run.sh` (no CI runs it). Expected: pass, with only the entries above re-stamped.
- [ ] **Step 5: Commit** `Stop locking the whole Board while one status write is pending (#241)`.

### Task 3: Key-aware cleanup so concurrent moves cannot close each other's menu

**Files:**
- Modify: `frontend/src/eng/useEngStatusTransitions.js` (`closeSingleIssueStatusControl`), `frontend/src/eng/EngBoardView.jsx` (`releaseStatusTarget`, `refuse`, `closeDropMenu`, `submitMove` finally)
- Test: `tests/ui/eng_group_board_drag.spec.js` (reuse its drag helpers), `tests/test_planning_action_source_guards.js` or the nearest hook unit test for the key guard

**Interfaces:**
- Produces: `closeSingleIssueStatusControl(onlyIfKey?: string)`: only when `typeof onlyIfKey === 'string'` (an event object passed by a future `onClick={close}` must not be read as a key) it closes just when `activeSingleIssueTargetRef.current?.key === onlyIfKey`; otherwise unchanged. All existing callers (`StatusTransitionMenu` `onClose`, `EpicBlock`, `IssueCard`, `EngBoardEpicPanel`, `dashboard.jsx`) pass no argument and are untouched. `releaseStatusTarget(epicKey: string)` passes that move's key from every call site: `refuse`, `closeDropMenu` (read the key inside the `setDrop` updater or add `drop` to its deps), the pending-drop effect (`pendingDrop.epicKey`), the `submitMove` finally, and `handleColumnDrop` (~:480), which also closes the open drop menu for any other Epic before it takes the hook target.

- [ ] **Step 1: Add the per-key held-transition and key-echo mock to the drag spec** (the drag spec has one global `transitionGate`): extract the Task 1 mock into `tests/ui/eng_board_dashboard_fixture.js` and use it from both specs rather than copying it.
- [ ] **Step 2: Write failing tests:** `two drags back to back: the first completing does not disturb the second` (hold A's POST, drag B, release A; B's drop resolves, B's POST carries its own key, a failed B rolls back to its real prior status); `a drop on another column closes an open drop menu for a different Epic`; and a hook-level unit test `closeSingleIssueStatusControl('X') leaves an open target 'Y' open` (the pill-menu-open-during-drag case cannot be built through the UI because the Epic panel is a modal).
- [ ] **Step 3: Run to confirm FAIL, implement, run to confirm PASS.**
- [ ] **Step 3: Commit** `Make Board drag cleanup release only its own status target (#241)`.

### Task 4: Announce pill outcomes (per-call `onSettled`)

**Files:**
- Modify: `frontend/src/eng/useEngStatusTransitions.js` (`submitStatusTransition`), `frontend/src/dashboard.jsx` (handler forwards `options`), `frontend/src/eng/EngBoardView.jsx` (new callback beside `submitMove`, passed only to `EngBoardEpicPanel`)
- Test: panel spec (Task 1 tests) and one visibility test

**Interfaces:**
- Produces: `submitStatusTransition(targetStatus: string, explicitTargetKey: string, options?: { onSettled?: (outcome: 'confirmed' | 'rejected' | 'unconfirmed') => void })`. `onSettled` is called at most once per submit, only when `sameVisit()` holds, with the classified outcome (`classifyStatusResult` / `classifyWriteError`). Call it immediately after `settle(...)` and before `await onTransitionSuccessRefresh`, and guard with a `settledReported` flag so the catch path cannot report a second, contradictory outcome if the refresh throws. In the catch path report `'rejected'` only when `started` is true (a queued job aborted before it started also classifies as `'rejected'`, and the existing error text is gated the same way); `'unconfirmed'` is reported as the existing code raises it, with no `started` gate. It is never called for a pending-key refusal, a locked edit, an auth abandon or a pre-start abort (those stay silent). Drag passes no options, so its own `submitMove` announcement is not duplicated. In the same commit relax `statusHandlerPolicy` to accept a trailing `,options`, keep one `transitionIssues(` call in the hook, and add a guard assertion for it.
- Produces: `submitPanelStatus(status: string, issue: { key: string }) => Promise<response | null>` in `EngBoardView` (`useCallback`, deps `[announce, onSubmitStatusTransition]`), which passes `onSettled` and announces: confirmed `${key} → ${status}`; rejected `${key} — the change to ${status} did not go through. Nothing changed.` (error); unconfirmed `${key} — could not confirm the change to ${status}. Check Jira before trying again.` (error). It is only ever handed the open menu's key.

- [ ] **Step 1: Write the failing visibility test** `the Board announcement is not covered by the Epic panel backdrop`: with the panel open, in pane and non-pane layouts, `document.elementFromPoint` at the center of the `.board-say.has-message` rect returns that element (pattern: `.board-say` measurement near `tests/ui/eng_group_board_view.spec.js:4567`). Fix layering only if it fails.
- [ ] **Step 2: Implement** `onSettled` and `submitPanelStatus`; keep `transitionError` and the open-menu failure path for Catch Up and Planning.
- [ ] **Step 3: Run** the Task 1 announcement tests, the visibility test and `eng_group_board_drag.spec.js` (drag announcements unchanged). Expected: pass.
- [ ] **Step 4: Commit** `Announce Board status pill outcomes like drag (#241)`.

### Task 5: Strict-scope fixture

**Files:**
- Modify: `tests/ui/eng_group_board_view.spec.js` (`installBoardFixture({ strictBoard: true })`, ~99-385; its `/api/eng/board` handler at ~314-365; always `sourceBundle: true`)
- Modify (only if the drag gesture helpers must be shared): move them into `tests/ui/eng_board_dashboard_fixture.js` rather than copying them

**Interfaces:**
- Produces: a strict fixture with at least two Epics in different columns (each with a child) and an NDJSON payload that carries both; `/api/issues/transitions` and `/api/issues/transitions/options` routes that echo the requested keys; per-key `holdTransitions` gates; a `requests` log that records `/api/eng/board` calls.

- [ ] **Step 1: Extend the fixture** as above without changing the existing single-Epic tests' defaults.
- [ ] **Step 2: Run** the existing strict tests in the view spec; expected unchanged results.
- [ ] **Step 3: Commit** `Extend the strict Board fixture with several Epics and transition routes (#241)`.

### Task 6: Strict-scope tests for pill and drag (Component / All work)

**Files:**
- Test: `tests/ui/eng_group_board_view.spec.js`

- [ ] **Step 1: Write the tests, for both scopes, pill and drag:**
  - `strict pill change moves the card to the owning column at once and sends no Board reload`: card in the target column while the POST is held; no `/api/eng/board` request after release.
  - `strict failed pill change returns the card and announces`.
  - `strict second Epic change is accepted while the first is pending`: B's POST is sent only after A is released (coordinator order).
  - `strict scope switch while B is queued behind A`: no announcement into the new scope.
- [ ] **Step 2: Run** `npx playwright test tests/ui/eng_group_board_view.spec.js --browser=chromium -g "strict"`; expected PASS. A failure is a real strict-scope bug: fix its cause in the owning file, do not weaken the test.
- [ ] **Step 3: Commit** `Cover strict Board scopes for status pill and drag (#241)`.

### Task 7: Keep other Epics' pending patches across a Priority or Project Track refresh

**Files:**
- Modify: `frontend/src/eng/useStrictEngBoardIntegration.js` (`useStrictEngBoardOwner.refresh`, line 54)
- Test: `tests/test_strict_eng_board_integration.js`

**Interfaces:**
- Produces: exported `retainPendingBoardPatches(patches: Record<string, object>, pendingKeys: Set<string>) => Record<string, object>` keeping only the keys in `pendingKeys`; `refresh` calls `setIssuePatchesByKey(previous => retainPendingBoardPatches(previous, freshnessBridge?.current?.pendingKeys?.() ?? new Set()))` instead of `setIssuePatchesByKey({})`. `afterCommit`'s existing `reconcileStrictBoardPatches` is unchanged.

- [ ] **Step 1: Write the failing test** `retainPendingBoardPatches keeps a pending Epic's patch and drops a settled one`; run to confirm FAIL.
- [ ] **Step 2: Implement and wire** `refresh`; run to confirm PASS.
- [ ] **Step 3: Commit** `Keep pending Board patches across a Priority or Track refresh (#241)`.

### Task 8: Gates, docs, plan completion

**Files:**
- Modify: `docs/README_ANALYTICS.md` (one allowlist row: Board status pill non-blocking, files, reason, date), `docs/ontology.md` (the Board write-path entries near lines 21 and 119: touched sections and their `Verified on` only, never line 3), `docs/design-system.md` (handler registry wording only if it mentions the Board path), `docs/plans/README.md` (the entry already exists once; keep it a one-line description with no status wording and fix the link on rename), this plan

- [ ] **Step 1: Run the full gates** at the exact head: `npm run build`; `npm run test:frontend:unit`; `python3 -m unittest discover -s tests`; `.venv/bin/python -m unittest tests.test_agents_md_learnings tests.test_codebase_structure_budgets`; `bash scripts/extraction_lint/run.sh`; `npx playwright test tests/ui --browser=chromium --workers=4`. Rerun any known flaky spec alone before calling it flaky.
- [ ] **Step 2: Verify visually** with an element-level screenshot of a pill change mid-flight (menu closed, other pills enabled, announcement visible), taken after animations settle, from synthetic fixtures only.
- [ ] **Step 3: Update this plan** (Outcome, Current Accuracy, branch or head commit) and rename it to `DONE-board-status-pill-nonblocking-241.md`; fix the README link in the same commit.
- [ ] **Step 4: Follow the publication transaction** in root `AGENTS.md` section 10 and wait for explicit user confirmation before push.
