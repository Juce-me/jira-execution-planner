# Issue #250: Planning local priority and status edits

**Status:** Planned implementation contract; updated against current fetched `origin/main` on 2026-10-08. The original design and the current-main task contract were separately reviewed, repaired and rereviewed by three independent reviewers on 2026-10-08; their actionable findings are closed. No application implementation. Bulk-action choice awaits operator feedback; the recommended design below retains an explicit confirmed bulk action in List only. Do not describe that choice as accepted or begin the conditional bulk slice until it is resolved.
**Created / verified:** 2026-10-08 (Europe/Berlin).
**Issue:** [#250 — planning improvements: priority update refetch the whole board](https://github.com/Juce-me/jira-execution-planner/issues/250).
**Implementation base:** `33f4452ebd0d3653998d3e5890879a7596a402b3`, fetched `origin/main` on 2026-10-08, including PR #254 (App decomposition).
**Original evaluation base:** `1f161a29423faa3574c6ab512959f6245e574f35`. The evaluation outputs below belong to that revision; they are not test results for the new implementation base.
**Delivery authorization:** The operator authorized a local documentation-only commit on 2026-10-08. Application implementation, push and PR creation remain separate actions; the bulk-product decision remains open.
**Scope:** ENG Planning List and Table, existing Story/Epic priority controls and Story status controls. Keep the shared mutation queue, loaded-state owner, Jira OAuth APIs, review storage and table sorting model.

## Current-main implementation boundary

The local checkout remains on the original evaluation base with only this plan, the plan index and the ontology edited. Current-main source was inspected with `git show` / `git grep` after fetching; no reset, merge, rebase, stash or application edit was performed. Execution must first bring the authorized working branch onto the recorded base while preserving these documents. If main advances again, inspect the delta and update this contract before implementation; do not silently execute against another revision.

PR #254 changes the integration locations, not the issue's root cause:

- `dashboard.jsx` still owns `applyLocalEngIssueField`, `invalidateAlertsAfterEdit`, `handleSubmitStatusTransition`, the active task arrays and `groupStateRef`. Verified current-base anchors: group snapshot write/restore at lines 2875/2888, `useEngWorkHierarchy` at 4465, local edit orchestration at 4969–5108, Table field editors at 5824, and app Refresh at 5935.
- `EpicBlock.jsx` now renders Epic controls and passes the shared Story handlers to `IssueCard`; `EngControls.jsx` owns the extracted control rendering. Trace these components rather than restoring the old inline renderers. Neither needs a behavior change for the default single-Story fix if the existing handler seam suffices.
- `useEngScope.js` supplies the stable shared scope, `useEngAlerts.js` derives alerts, and `useEngCapacity.js` owns capacity. Keep these owners read-only. The fetch-driving alert nonce and readiness hook wiring remain in `dashboard.jsx`; lazy invalidation must change there, not inside the alert derivation hook.
- The structural gate caps `dashboard.jsx` at **7,616 lines**. Add `usePlanningIssueEdits.js` as a feature-owned lifecycle/projection hook and remove the replaced Planning handler logic from App. Keep App within that ceiling and preserve registered owner/interface ceilings. Update only truthful measured App/aggregate counts in `scripts/extraction_lint/owner_budgets.json`; do not raise ceilings or alter the structural tests to fit the implementation.
- The build is now split ESM output from `scripts/build_dashboard.mjs`: the rebuilt main bundle, source maps, changed hashed chunks, and the new `lazy-views-<buildId>.json` replace their obsolete generated counterparts. The generated file list is determined by the build, not the three fixed files from the original design. Do not change build tooling, lazy-view contracts or `jira-dashboard.html`. Use the Flask-served dashboard; direct `file://` loading is unsupported.

These constraints are part of the task/file map below. No configuration ownership migration, new route, Jira pagination change, initial-load fan-out or new dependency is required.

## Assessment and evidence

This is a frontend mutation/orchestration defect. Prioritize the unintended multistory status write as a P1 correctness issue; the priority reload is a separate disruption whose latency has not been measured. The existing write APIs already return per-issue outcomes; a new full-board read or backend endpoint is unnecessary for successful edits.

| Finding | Verified source | Consequence |
| --- | --- | --- |
| Priority treats every Planning edit as a nonsingle operation | [`useEngPriorityTransitions.js`](../../frontend/src/eng/useEngPriorityTransitions.js), `submitPriorityChange`: `isSingleIssueSurface = sourceSurface !== 'planning'` | No optimistic priority patch or per-key pending state in Planning; success calls `onPrioritySuccessRefresh`. |
| That callback loads the whole active task scope | [`useStrictEngBoardIntegration.js`](../../frontend/src/eng/useStrictEngBoardIntegration.js), `strictEngBoardMutationProps`; [`dashboard.jsx`](../../frontend/src/dashboard.jsx), `refreshLegacyBoardTasks` | Planning calls `loadMeasuredGroupTasks({ forceRefresh: true })`, even though only one priority changed. |
| Planning List Story status implicitly targets selection | [`IssueCard.jsx`](../../frontend/src/issues/IssueCard.jsx), Story `onSubmit`; `dashboard.jsx`, `handleSubmitStatusTransition`; [`useEngStatusTransitions.js`](../../frontend/src/eng/useEngStatusTransitions.js), `submitStatusTransition` | The handler omits the clicked Story key; the hook builds the selected Story batch. Its success also refreshes the task scope. |
| Table Story status is already single and optimistic | `dashboard.jsx`, `renderPlanningReviewFieldEditor`, `actsOnSelection={false}` and `{ singleIssue: true }` | Preserve this behavior. Do not attribute every status control to the List defect. |
| Local patching does not reorder List children | [`engIssueEditState.js`](../../frontend/src/eng/engIssueEditState.js), `patchEngIssueList`; [`useEngWorkHierarchy.js`](../../frontend/src/eng/useEngWorkHierarchy.js), `groupTasksByEpic`; [`useEngSprintData.js`](../../frontend/src/eng/useEngSprintData.js), load-time `sortTasksByPriority` | Simply removing the refresh can leave a newly urgent Story in its old List position. |
| Table sorting recomputes without motion or pending-field sort snapshots | [`PlanningReviewTable.jsx`](../../frontend/src/eng/PlanningReviewTable.jsx), `sorted` / `displayed` and keyed `tbody`; [`planningReviewTableModel.js`](../../frontend/src/eng/planningReviewTableModel.js), `sortPlanningReviewRows` | Reordering currently jumps; custom-cell editing already has an order freeze that must be preserved. |
| Read reconciliation excludes status and priority | `engIssueEditState.js`, `createEngIssueEditState().reconcileIssues` | A read dispatched before a confirmed edit can subsequently overwrite these fields. |

The historical [`DONE-eng-targeted-task-updates.md`](DONE-eng-targeted-task-updates.md) explicitly retained Planning batch-and-refresh behavior. Issue #250 supersedes that Planning behavior; Catch Up and strict Board retain their existing owners and refresh contracts. Consult MRT010 (redundant heavy reads) and MRT009 (sticky layering) before execution.

### Evaluation performed

- Read the issue body, labels and comments with `gh issue view 250`; issue is open, labelled bug, with no comments.
- Executed actual priority/status hook submission functions and `strictEngBoardMutationProps` in a Node stdin harness, with synthetic API responses, stubbed React state/effects and the real mutation queue and target builders. No Jira writes occurred. Output:

  ```text
  Planning priority events: write:DEMO-1 -> local-patch -> whole-scope-load
  FAIL no priority patch before write response
  FAIL priority invokes whole-scope load
  Planning List status target keys: DEMO-1,DEMO-2
  FAIL omitted explicit key sends selected Story batch
  PASS Table explicit-key status writes one Story
  ```

- Ran the standalone sort probe in the appendix. It verifies that patching leaves the old order while the existing comparator supplies the intended new order.
- Ran `node --test tests/test_eng_priority_transition_utils.js tests/test_eng_status_transition_utils.js tests/test_eng_issue_mutation_queue.js tests/test_eng_issue_edit_state.js tests/test_planning_review_table_model.js`: **65 passed, 0 failed**. Existing UI tests explicitly expect Planning List batch writes and Planning priority refetches; replace those expectations rather than weakening assertions.
- This is synthetic/source evaluation, not an authenticated browser reproduction. This checkout has no `node_modules`; the initial run used host Node 26.8.1 and emitted module-type warnings. During review, the same five suites were rerun with the installed fnm Node **20.20.0** runtime: **65 passed, 0 failed**; ESM syntax detection works and existing module-type warnings remain. Before implementation verification, activate `.nvmrc`, install with `npm ci`, and run the browser campaign. One initial sort probe imported the React-backed hierarchy hook and failed because React was unavailable; the minimized pure probe ran successfully.
- Root instruction template matches upstream version 2026-09-08. The sole Home-write gate is blocked, next weekly review 2026-10-12; it is not due and this frontend plan does not touch or depend on Home writes. No gate probe, gate edit, dependency installation, implementation, commit, push or PR was performed.

## Proposed behavior and design

### 1. Immediate display; background write; confirmed ordering

For a normal priority/status menu choice:

1. Capture the issue key, full prior field value, target, Department/Sprint/surface identity and a mutation token. For priority capture the full value, not only its name, so rollback preserves IDs/icon metadata.
2. Atomically reserve that field/key before patching. Reject another single or bulk action whose target contains a pending or unconfirmed edit of the same field; never silently omit the overlapping key. Different fields retain independent tokens and original values, while the shared queue still serializes network jobs by issue key. Mark only the reserved issue(s) pending and patch their display through `applyLocalEngIssueField`. Reuse active arrays, Epic metadata and expanded subtasks; distinguish optimistic display from confirmed group-cache authority as specified below. Do not create a Planning-owned copy of Jira tasks.
3. Submit exactly that key through the existing shared queue: four concurrent jobs maximum, serialized for overlapping keys. Other issues remain editable. Close/moving between menus must not redirect a response.
4. Until completion, display the new field but sort/filter that pending field using its captured prior value. Keep per-key/per-field snapshots so one completed edit can settle while another remains pending. Keep nonedited fields live.
5. On per-key `success` or `already_in_*`, record the confirmed field through the existing edit-state observation mechanism and apply the returned value to that key. Then release its ordering snapshot and derive the new order locally. Add the List child-order seam to the already-tested pure `engWorkHierarchy.js`, consuming a sort/filter projection and reusing `sortTasksByPriority`; `useEngWorkHierarchy` passes that projection into the pure builder. Table retains its selected multicolumn criteria, blank placement and immutable-ID tiebreaker. A change must not activate an unselected sort criterion.
6. On a definitive rejection, restore the token's captured field and release its snapshot; no success reorder or whole-scope fetch. On an unconfirmed outcome, restore the prior display only as a provisional value, keep its pre-edit ordering/membership and a per-field/key unconfirmed lock, and show the existing inline result/error area as unconfirmed. Closing a menu must not erase that lock. Require explicit app Refresh acknowledgement before another edit; never claim Jira rolled back or automatically replay the write.

Outcome classification must inspect each requested key, including HTTP-200 batch responses:

- **Confirmed:** exactly one matching result with `success` or the appropriate `already_in_*` and a usable authoritative value (status may use `currentStatus` for already-in-status; priority uses the validated response target/catalog value).
- **Definitive rejection:** documented pre-dispatch input/policy/CSRF errors; per-key `transition_not_available`, `transitions_unavailable`, `invalid_transition`, `transition_forbidden`, `transition_conflict`, `jira_auth_error`, `priority_conflict`, `priority_forbidden`, or `issue_not_found`. These existing codes either prevent the write or report a definite Jira rejection. Verify code origins against the services before implementing the allowlist.
- **Unconfirmed:** `transition_failed`, `transition_timeout`, `priority_update_failed`, `priority_update_timeout`, generic post-dispatch transport/5xx failures, unknown codes, missing/duplicate/mismatched results or unusable success values. The services can return these as HTTP-200 `result: failure` after a Jira POST/PUT was attempted; never treat HTTP 200 or aggregate counts as authority. In a partial batch, classify and settle each key independently.

For an unconfirmed lock, record a reconciliation barrier for that mutation and scope. Carry an explicit operator-Refresh request ID through `loadMeasuredGroupTasks` / `loadGroupTasks` to `useEngSprintData.fetchTasks` and the final Product/Tech lane commits. That loader must preserve validated raw key/field evidence alongside its retained read token and acknowledge accepted current-scope commits before final token disposal. Reconciled display arrays, aggregate outcome strings and `forceRefresh` alone are not raw authority. Automatic long-absence refresh, normal loads and Board refreshes do not acquire explicit-operator provenance. Clear it only after a successful explicit Refresh started after settlement has actually committed a validated snapshot containing that key/field. Failed, aborted, superseded, other-scope, older or missing-issue refreshes leave the lock intact with recoverable guidance. Do not merely clear locks on the Refresh click or successful HTTP status. Unknown status/priority values must not be entered as confirmed observations.

All success/error/result/pending updates must compare the captured scope token with the current scope, including Planning. Include a monotonically increasing scope-visit generation, not only the Department/Sprint/surface string: switching A → B → A must not revive an old A callback. Abort queued jobs on scope changes; already-dispatched jobs may finish remotely but cannot patch a newly selected scope. Preserve terminal global `401` recovery; never unlock or replay locally. Declare `usePlanningIssueEdits` after the existing issue-edit/group refs and available primitive context/Department/Sprint/view state, before cache, readiness, filter and hierarchy consumers. Derive its surface from those already declared view inputs; do not read the later `statusTransitionSourceSurface` or later mutation/editor hook return values. Its transient reservations, held-editor keys, refresh barriers and render revision wrap the existing edit-state authority; it owns no copied task arrays. Later hooks receive its lifecycle callbacks.

Extend `createEngIssueEditState` reconciliation to status/priority and connect token reservation, dispatch, settlement and confirmation to it. Keep a token-owned pending display overlay over incoming current-scope reads while queued/saving, separately from the original-value sort/filter projection. A read resolving before the write must not erase the optimistic field. After settlement, confirmed observations protect against older reads; rejection/unconfirmed settlement removes the desired-value overlay without recording it as confirmed. A genuinely newer validated explicit read remains authoritative. Reconcile flat/nested projections without manufacturing absent fields.

Group caches must contain authoritative values, not optimistic display. For status/priority, introduce a phase/token argument at `applyLocalEngIssueField` (existing other-field callers keep their current semantics): optimistic/provisional phases update current display but do not publish desired values into group caches. At group snapshot commit, strip token-owned pending display overlays back to their authoritative baseline, or decline caching that affected snapshot if it cannot be separated. A never-dispatched cancellation releases its token without leaving an optimistic cache value. An already-dispatched completion after a scope switch may settle only captured-origin cache entries under the same principal/context and token: success may publish confirmed values there, definitive rejection restores only token-owned prior values, and unconfirmed settlement retires affected cached snapshots. None may patch the new mounted scope or overwrite a newer mutation/cache revision. Returning to the original Department must never restore an unconfirmed desired value as authoritative.

Prove queued cancellation, scope switch-away/return with success/rejection/unconfirmed outcome, read settlement while queued/saving/after settlement, and cache restoration after the **last** `finishRead` prunes observations. Do not retain observations indefinitely as a workaround. Preserve other editable-field contracts and aggregate-read invalidation behavior.

No successful Planning mutation may invoke `onPrioritySuccessRefresh`, `onTransitionSuccessRefresh`, `loadMeasuredGroupTasks`, a task-list reload, review refresh or readiness reload. **Change the concrete invalidation seam:** `invalidateAlertsAfterEdit` currently calls `rearmCatchUpAlerts`, which increments `catchUpAlertRefreshNonce`, supplied as `useStoryReadiness.refreshRevision` and therefore immediately fetches readiness. Planning must instead record lazy invalidation without advancing a fetch-driving nonce. Explicit app Refresh and existing scope/view activation may consume that dirty marker through their normal read paths; keep Catch Up/Board behavior unchanged. Retain server cache invalidation: invalidating a cache does not require downloading the list again. Parent subtasks already use the existing local patch/summary helpers.

Add the same pending/confirmed read fence to `useStoryReadiness` department and per-Epic response commits, including readiness-only Epic status/priority display. A per-Epic result must retain its read handle until `useEpicRefresh.recheckEpicAlerts` merges or discards it; the consumer finalizes that handle in `finally`, including stale alert-version/epoch/scope, failures and missing merge callbacks. Do not finish the token merely when `loadEpic` returns, or leave it open when the consumer skips `mergeEpic`. Its current `applyIssueField` allows only summary/team/assignee, and it accepts fetched snapshots without the edit-state reconciliation; explicitly cover these seams. Loaded child arrays do not prove complete readiness membership/actionability: retain the last validated readiness requirements conservatively until the next permitted authoritative read, mark derived readiness dirty, and do not manufacture complete counts or hide readiness-only rows based on an optimistic edit.

### 2. One Story by default; explicit, confirmed bulk status only

- Every Story pill in List and Table changes the clicked Story regardless of checkbox selection, including no selection or a selected set that excludes the clicked Story. Pass its explicit key; do not allow an omitted key to silently mean selection.
- Keep Table single-only. Epic and Subtask pills remain single-only. Selection still drives capacity, Accepted totals, review/export and explicit bulk scope, never an ordinary Story pill.
- Recommended preservation of existing List bulk capability: add an unchecked, compact `Apply to selected Stories (N)` choice inside the existing List Story status menu using `IssueFieldOptionMenu.leadingContent` and existing checkbox styles. It is explicit opt-in, reset on every open/close and scope change. Do not add a toolbar tier or a Table bulk control.
- Opting in fetches transition options for the exact deduplicated selected Story set using `loadTransitionOptions`, with a **bulk-specific** request/cache identity containing sorted exact keys, current workflow tuples and scope identity. Validate returned `issues[].key` against that set and ignore superseded-selection responses. Never reuse another set's issue-specific payload merely because its tuple counts match. Preserve the existing single-menu/prefetch tuple cache contract. No-selection disables bulk; over 50 disables it without truncation or a write. A selected count of one still represents that selected Story, never a silent substitution of the clicked key.
- Apply clicked-current-status option filtering only in single mode. Bulk mode shows statuses offered for its selected targets, even when one equals the clicked, unselected Story's status. Already-at-target keys use the existing per-key no-op outcome, not clicked-status filtering.
- Choosing a bulk target with more than one key opens a confirmation dialog: `Change status for N selected Stories to <status>?` Include the exact local target list and Cancel / `Change N Stories`. Reuse the existing Planning dialog/action styles, extending only this confirmation's geometry to a viewport-bounded dialog with a scrollable target-list body and always-visible tappable actions; all 50 targets must be reachable on a short mobile viewport. No Jira identifiers enter telemetry. Cancel, dismiss or switching scope sends no write and applies no optimistic patch.
- Freeze keys, status and scope identity in the confirmation request. Revalidate selection and scope before confirming; a changed selection invalidates the dialog rather than silently changing its targets. Cap and validation precede any patch or enqueue. Require the confirmed snapshot at the batch dispatch seam; an unconfirmed multikey call sends nothing.
- Before confirmation dispatch, revalidate and atomically reserve every frozen status key; if any is pending/unconfirmed for status, reject the whole action with concise guidance and no patch/write. Never silently reduce the target set. On confirmation patch only the frozen keys, enqueue one existing batch request, and reconcile each key individually under its token. Failed/unconfirmed keys do not inherit another key's success. Keep selection and custom review drafts; partial success never triggers a whole-list refresh.
- Update `PlanningActionBar` feedback so the selected count no longer promises that every Story pill changes selection. Keep result counts and existing selection controls.

This bulk preservation is a proposed choice, not operator approval. If the operator chooses single-only, remove the optional bulk choice/dialog and obsolete implicit batch callsites; omit the new confirmation component from the final file set. The independent priority/local-update design remains the same.

### 3. Visible Table movement

Animate the entire affected row and displaced rows together, so every cell stays attached to its Story; do not move just a priority/status cell into another Story's row.

- Add a small `usePlanningRowMotion` hook scoped to the mounted table. Share the existing rendered identity rule everywhere: `rowKind + (row.id || row.key)` for real rows (immutable ID when present, stable issue-key fallback when absent), and existing unique synthetic IDs. Use it for React keys, refs, order snapshots, highlights and cleanup; multiple no-ID rows must not collide.
- Capture old/new row rectangles around the confirmed order commit and animate positional deltas to zero with native Web Animations, approximately 180–220 ms, plus a subtle settled highlight on the confirmed edited row. No dependency, dragging requirement or new controls.
- Measure rows in batches, once per relevant order change. Cancel previous animations before measuring interrupted motion; clean up on unmount, mode/scope changes and reduced-motion changes. Do not animate initial load, ordinary scroll or column-layout changes.
- If the sort keys do not change order, show only the edited-row highlight. The pending optimistic phase retains pre-edit membership. Once confirmed, apply active filters without clearing them or fetching data, **except** a row hosting an active editor remains temporarily mounted in its previous position until that editor safely closes; then settle deferred removal/motion.
- Track a shared held-row set from Table's local custom-cell `editing` and dashboard-owned `issueFieldEdits.activeEditor`, covering Summary, Story Points, Team and assignee editors. Add an optional active-editor lifecycle callback to `useEngIssueFieldEdits` so its existing controller can notify the early Planning hold setter synchronously when the editor opens, closes or is cleared; the editor controller remains the source of editor truth. Table similarly reports its custom-cell identity through a stable hold callback. Apply that membership hold **before** dashboard Story filtering and preserve any parent structure needed to keep the row mounted. Stable React keys alone do not prevent unmounting. Scope/mode changes retain their existing save/discard guards; do not introduce silent autosave as a way to clear holds. Test delayed priority/status completion exiting filters while Summary and custom drafts are active.
- Respect `prefers-reduced-motion`; use a static brief highlight and final order. Touch taps remain supported. Preserve and extend the custom-cell order freeze to the held-editor set; settle after the editor closes without losing focus/draft state.
- Preserve document vertical scrolling, the horizontal table scroll position and docked header/footer synchronization. Never transform the table wrapper/sticky-control ancestors or use a full-table remount. Verify pinned cells, menu anchors and motion under horizontal scrolling. If DOM reordering would move the viewport's anchor, compensate only that measured displacement.

## Existing endpoint contract (no API changes)

All routes resolve the current user's OAuth Jira context and existing workspace/site boundary. Writes use signed-in-user Jira REST only; no Basic, service-token or Home write path. Basic/passive profiles retain their current edit gates.

| Method / route | Headers and body | Success / failures to preserve |
| --- | --- | --- |
| GET `/api/issues/priorities/options?issueKey=DEMO-1` | Current cookie session; `X-Requested-With`; no mutation CSRF | Per-issue-scheme `priorities[]`; retain existing 400/403/404/502 handling. |
| POST `/api/issues/priorities` | Session, `X-Requested-With`, token-bound `X-CSRF-Token`; `{issueKeys:[key], targetPriorityId}` | HTTP 200 `{requested,succeeded,failed,targetPriority:{id,name},results:[{key,result,fromPriority?,toPriority?,error?}]}`. Validate the matching result, not only aggregate success. |
| POST `/api/issues/transitions/options` | Session, `X-Requested-With`; authenticated-read policy, no mutation CSRF; `{issueKeys}` | `{issues:[{key,currentStatus,issueType,transitions}],targetStatuses:[{name,availableCount,blockedCount}]}`. Options must match single or explicit bulk targets. |
| POST `/api/issues/transitions` | Session, `X-Requested-With`, token-bound `X-CSRF-Token`; `{issueKeys,targetStatus}` | HTTP 200 `{requested,succeeded,failed,targetStatus,results:[{key,result,fromStatus?,toStatus?,currentStatus?,error?}]}`. Per-key partial failures remain possible. |

Both write routes retain 400 input errors, 401 global auth recovery, 403 policy/scope/CSRF errors, sanitized 502 errors and HTTP-200 per-issue outcomes, whose failure codes can be definitive **or unconfirmed** as classified above. Existing route/service tests prove OAuth context forwarding and forbidden Basic header helpers. Jira workflow automation can change related issues server-side; the frontend cannot guarantee no external automation exists. Confirmation covers the application's explicit multikey target set, not an unsupported prediction of Jira automation.

## Awaiting file changes

Every existing path below was verified in the recorded current-main tree. New paths are explicitly marked **Create**. These are expected implementation files, not application files changed during planning.

| File | Planned change |
| --- | --- |
| `frontend/src/eng/useEngPriorityTransitions.js` | Planning per-key optimistic/pending lifecycle, full-value rollback, scope guards, confirmation/ordering notifications; remove Planning success refetch. |
| `frontend/src/eng/useEngStatusTransitions.js` | Explicit single targets, guarded opt-in batch/confirmation snapshot, per-key batch reconciliation, scope guards; no Planning success refetch. |
| `frontend/src/dashboard.jsx` | Existing owner integration, edit observations, pending sort/filter projection, explicit Story callbacks, confirmation mount, table motion inputs; keep changes localized to ENG. |
| `frontend/src/eng/usePlanningIssueEdits.js` — **Create** | Transient scope-visit/reservation/refresh/held-editor lifecycle and projections over the existing edit-state authority; no copied task store, no fetch owner. |
| `frontend/src/eng/useEngIssueFieldEdits.js` | Optional active-editor lifecycle notification to keep the early Planning membership hold aligned with open/close/context/auth cleanup. Preserve existing editing behavior on other surfaces. |
| `frontend/src/issues/IssueCard.jsx` | Planning List Story pills default single and expose explicit bulk opt-in props only for that surface. |
| `frontend/src/issues/StatusTransitionMenu.jsx` | Single-default label and optional List bulk checkbox via existing `leadingContent`; no normal implicit batch action. |
| `frontend/src/eng/PlanningActionBar.jsx` | Correct misleading selection/status feedback without changing selection controls. |
| `frontend/src/eng/PlanningStatusConfirmation.jsx` — **Create, if bulk retained** | Presentational confirmation using frozen targets and existing Planning dialog styles. |
| `frontend/src/eng/engIssueEditState.js` | Reconcile confirmed status/priority against stale reads and cached group snapshots. |
| `frontend/src/eng/useEngWorkHierarchy.js` | Pass pending sort/filter and held-editor projection into the pure hierarchy builder. |
| `frontend/src/eng/engWorkHierarchy.js` | Pure, behaviorally tested List child priority ordering using the existing comparator; preserve Epic/initiative/readiness structure. |
| `frontend/src/eng/useStoryReadiness.js` | Pending/confirmed response-commit fence, retained per-Epic read handles, readiness-only Epic field display and request-free Planning invalidation integration. |
| `frontend/src/eng/useEngSprintData.js` | Explicit Refresh provenance and raw key/field acknowledgement at accepted lane commits; retain/release read tokens through final reconciliation. |
| `frontend/src/eng/useEpicRefresh.js` | Finalize per-Epic readiness read handles after merge or discard, including every stale/ignored result path. |
| `frontend/src/eng/planningReviewTableModel.js` | Optional pending sort-value projection, preserving comparator, tiebreakers, multicolumn sort and cell values. |
| `frontend/src/eng/PlanningReviewTable.jsx` | Pending ordering projection and stable row-ref/motion integration, preserving custom edit freeze and docked geometry. |
| `frontend/src/eng/usePlanningRowMotion.js` — **Create** | Table row movement, interruption/cleanup, reduced motion and viewport preservation. |
| `frontend/src/styles/eng/planning-review-table.css` | Scoped settled-row highlight/reduced motion; if bulk retained, viewport-bounded confirmation and scrollable targets with visible actions. |
| `tests/ui/eng_priority_transitions.spec.js` | Replace Planning refetch expectation; delayed List/Table writes, no reload, confirmed order, rollback, rapid independent edits and team-filter retention. |
| `tests/ui/eng_status_transitions.spec.js` | Replace implicit List batch expectations; single defaults, explicit confirmed bulk/cancel/changed-scope/partial failures, no reload. Preserve Table single regressions. |
| `tests/ui/planning_review_table.spec.js` | Real row motion and stationary pending order, reduced motion, editing/draft/selection preservation, scroll/docking/menu geometry. |
| `tests/test_eng_issue_edit_state.js` | Late-read status/priority protection and authoritative newer reads/cache restoration. |
| `tests/test_planning_issue_mutations.js` — **Create** | Behavioral harness for the actual Planning lifecycle and priority/status hooks, shared queue and injected API promises; outcome, concurrency, stale-scope and Refresh-barrier coverage. |
| `tests/test_eng_issue_field_edits.js` | Editor lifecycle notifications and cleanup; unchanged existing field editing/auth/recovery contracts. |
| `tests/test_story_readiness.js` — **Create** | Behavioral delayed-response hook harness: queued/saving/confirmed overlays, scoped commits, readiness-only Epics, explicit refresh acknowledgement and no mutation-triggered reads. |
| `tests/test_story_readiness_api.js` | Preserve existing gating/request/field-patch source contracts alongside the new behavioral harness. |
| `tests/test_eng_work_hierarchy.js` | Local List priority ordering with pending originals and unchanged hierarchy/requirements. |
| `tests/test_planning_review_table_model.js` | Pending/confirmed sort projection, ascending/descending/multiple criteria, failed edits and unchanged cell values. |
| `tests/test_planning_action_source_guards.js` | Update obsolete implicit-batch expectations; enforce explicit single wiring and confirmation guard. |
| `tests/test_eng_board_drop_source_guards.js` | Update obsolete literal Table arguments, flag occurrence count and keyless Planning fallback assertions; preserve Board explicit-key, auth, shared-queue and refresh safety. |
| `tests/test_epic_refresh_source_guards.js` | Guard retained readiness-handle finalization across merge/discard without weakening scoped refresh ownership. |
| `tests/test_eng_status_transition_utils.js` | Analytics buckets reflect actual submitted targets, including single Story with unrelated selection. |
| `frontend/src/eng/engStatusTransitionUtils.js` | Selection-SP telemetry derived from submitted Story targets rather than unrelated selected Stories. |
| `tests/test_analytics_source_guards.js` | Reused event ownership, safe target counts and no motion/dialog payload leakage. |
| `docs/features/planning-sprint-review.md` | Document local mutation, confirmed ordering/motion and single/bulk behavior. |
| `docs/README_ANALYTICS.md` | Update status taxonomy and no-new-event allowlist for Planning local reconciliation, confirmation/cancel and passive motion. |
| `docs/ontology.md` | Verify new mutation/motion symbols and relationships after implementation. |
| `docs/plans/README.md` and this plan | Keep proposal/execution/outcome and actual file set aligned. |
| `scripts/extraction_lint/owner_budgets.json` | Re-measure changed App and aggregate counts; preserve frozen ceilings and unaffected module/interface inventories. |
| `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`, changed `frontend/dist/chunks/*.js` / `*.js.map`, `frontend/dist/lazy-views-*.json` | Rebuild with `npm run build`; include exact generated additions/deletions and stale-output cleanup. Never hand-edit or preselect hash names. |

Read-only references / existing regression suites: `useStrictEngBoardIntegration.js`, `engIssueMutationQueue.js`, `engIssueLocalUpdates.js`, `IssueFieldOptionMenu.jsx`, `EpicBlock.jsx`, `EngControls.jsx`, `useEngScope.js`, `useEngAlerts.js`, `useEngCapacity.js`, `scripts/build_dashboard.mjs`, `backend/routes/eng_routes.py`, the priority/transition services, security policies, `tests/test_strict_eng_board_integration.js`, `tests/test_use_eng_scope.js`, `tests/test_use_eng_alerts.js`, `tests/test_use_eng_capacity.js`, `tests/test_eng_controls.js`, `tests/test_dashboard_split_build.js`, `tests/test_codebase_structure_budgets.py`, `tests/test_oauth_eng_routes.py`, `tests/test_jira_issue_transitions.py`, `tests/test_jira_issue_priorities.py`. No backend schema, API, credentials, private/shared config ownership or settings changes are expected. If execution needs a wider file set, update the plan with evidence first.

## Ordered implementation tasks

Tasks are implementation work, all still **not started**. Each names its edit set from the file map above. Tests and generated outputs are part of the fix. Task 7 alone depends on the unanswered bulk-product choice; do not infer that preparing this plan authorizes its implementation. No task includes commit, push, PR creation or live Jira writes.

### Task 0 — Establish the exact execution base

**Depends on:** authorization to implement, not granted by this planning request.
**Edit set:** this plan, plan index and ontology only if reconciliation is necessary.

1. Read the instruction chain from the actual execution tree, current plan index and relevant ontology/postmortems. Check due gates according to the root workflow; this fix does not require the Home-write gate to pass.
2. Preserve the three planning documents and all other work. Bring the authorized dedicated bugfix branch onto `33f4452ebd0d3653998d3e5890879a7596a402b3` without discarding changes or importing unrelated feature history. Do not reset, force-push or create a secondary worktree. If ancestry or overlapping user work makes this unsafe, stop with the exact conflict.
3. Verify every existing task path with `git cat-file -e <base>:<path>`; verify Create paths are absent. Read their actual callers/consumers. Record exact base/head, branch, worktree status and the initial file set.
4. Activate Node 20 from `.nvmrc`, use the approved Python runtime and install the existing locked frontend dependencies with `npm ci`. Run the five original focused suites, build, `tests/test_codebase_structure_budgets.py`, and the affected browser baseline. Record actual failures before changing expectations.

**Exit:** the working source matches the recorded base, local documentation is preserved, runtime/build/source-budget gates pass or independently attributable baseline failures are recorded. Do not claim the earlier 65-test result verifies the new tree.

### Task 1 — Write executable regressions for the reported behavior

**Depends on:** Task 0.
**Edit set:** priority/status/Table UI specs; Create `tests/test_planning_issue_mutations.js`; relevant assertions in `tests/test_planning_action_source_guards.js`.

1. Add delayed-response tests for List and Table: clicking priority displays the target immediately, holds pending order, sends one key, and after success locally sorts without any new scope reads. Use two or more synthetic Stories with distinct priorities and stable IDs; also cover missing IDs.
2. Replace the List implicit-selection expectation with clicked-Story-only assertions for zero selection, unrelated selection and multiple selection. Keep the existing Table/Epic/Subtask single-target tests. Clicked Story B must send only B when A and C are selected.
3. Count task-list, strict-board stream, readiness, review schema/values, dependency and excluded-capacity reads after startup and deferred work settle. Permit option reads and the one requested write; require zero mutation-triggered scope reads. Keep filter/selection/capacity/custom-draft assertions live throughout the delay.
4. Build a behavioral harness using the repository's existing hook-test/esbuild patterns, injected API promises and the real mutation queue/target builders. Invoke the actual existing priority/status hooks, with effects, rerenders and cleanup; extend it with the new lifecycle hook only after Task 2 creates that module. Missing imports or setup failures are not acceptable red regressions. Source regexes or SSR alone cannot prove dispatch, rollback or stale-response safety.

**Exit:** the new focused tests fail for the intended old behavior at the recorded base, with no unrelated fixture or setup failures. Record these red cases before the implementation makes them green.

### Task 2 — Implement shared Planning edit authority and scope fencing

**Depends on:** Task 1.
**Edit set:** `engIssueEditState.js`, Create `usePlanningIssueEdits.js`, `useEngSprintData.js`, `dashboard.jsx`, `tests/test_eng_issue_edit_state.js`, `tests/test_planning_issue_mutations.js`.

1. Extend the existing edit-state model with status/priority pending overlays and confirmed observations. Keep display values distinct from original sort/filter values and authoritative cache values. Use per-key/per-field reservation tokens and atomic target-set reservation; reject overlapping same-field sets before any patch/enqueue.
2. Make the new hook own only transient lifecycle/projection state: current principal/context and scope visit, pending fields, held editor keys, refresh barriers and render notifications. Expose the minimum explicit callbacks needed by the existing mutation/read owners; no task arrays, option cache, network loader or whole-dashboard argument bag. Initialize it before cache/read/filter consumers using already-declared primitive inputs.
3. Guard queued/dispatched/settled callbacks with mutation token plus monotonically increasing scope visit. Cancel queued jobs on scope change; keep dispatched results from touching the mounted replacement scope, including A → B → A.
4. Change group snapshot commit/restore and phase-aware local patching. Strip pending desired values before authoritative caching, settle only captured-origin cache entries under the same principal and newer-token checks, and retire uncertain caches. Preserve current semantics for other editable fields and Board/Catch Up owners.
5. Implement explicit operator-Refresh start/commit acknowledgement at the actual loader seam. Propagate its request ID and captured principal/scope visit through `loadMeasuredGroupTasks` / `loadGroupTasks` and lane options into `fetchTasks`; retain validated raw key/field evidence alongside the read token through both reconciliations into `loadProductTasks` / `loadTechTasks`. After the lane passes its current-attempt/scope guard and commits its source arrays, acknowledge only fields actually present in that raw accepted result. A matching successful lane may reconcile its own keys independently; failed or missing-key lanes cannot unlock their keys. Finalize tokens after acknowledgement. A click, projected display array, HTTP success or lane outcome string is insufficient. Automatic long-absence refresh, ordinary loads, Board loads, older reads and retries have no operator provenance.
6. Split Planning lazy invalidation from the fetch-driving `catchUpAlertRefreshNonce` now, before Tasks 3/4 no-read checks. A successful Planning status/priority edit sets only the dirty marker; do not bump the nonce or run scoped alert reads. Existing Catch Up/Board invalidation remains unchanged. Task 5 will fence readiness responses and connect permitted reads to this marker.

**Exit:** behavioral tests cover queued cancellation, independent keys, same-key separate-field serialization, overlap rejection, stale reads in every phase, old-scope success/rejection/unknown, and cache restoration after the last `finishRead`. No indefinitely retained observation or optimistic cache value substitutes for authority.

### Task 3 — Make Planning priority optimistic without success reloads

**Depends on:** Task 2.
**Edit set:** `useEngPriorityTransitions.js`, dashboard wiring, priority UI spec and behavioral mutation tests.

1. Route Planning single-key priority writes through reservation/dispatch/settlement while preserving the queue's four-job limit. Snapshot the full prior priority object, including Table's underlying `row.issue` priority with key/metadata fallback, patch immediately, and keep other keys editable.
2. Classify every matching result using the confirmed/definitive/unconfirmed contract above. Validate response key and usable target/catalog value, not aggregate counts. Restore full prior metadata on rejection; unknown outcomes keep a lock and provisional display until acknowledged Refresh.
3. Remove only Planning's success refresh path. Preserve strict Board/Catch Up refresh contracts, option permissions, terminal auth recovery, telemetry ownership and server-side cache invalidation.

**Exit:** the lifecycle/request-count subset of delayed List/Table success, already-at-target, rejection, all named ambiguous HTTP-200 codes, missing/duplicate result, transport error, menu close and scope-race cases passes. Final ordering, editor preservation and motion regressions remain intentionally red until Tasks 5/6/8. No Planning success reaches `onPrioritySuccessRefresh` or a scope-read owner.

### Task 4 — Default every Planning Story status action to its clicked key

**Depends on:** Task 2; can be implemented independently of Task 3 after authority is in place.
**Edit set:** `useEngStatusTransitions.js`, `dashboard.jsx`, `IssueCard.jsx`, `StatusTransitionMenu.jsx`, `PlanningActionBar.jsx`, `engStatusTransitionUtils.js`, status/analytics/source-guard tests including `tests/test_eng_board_drop_source_guards.js`.

1. Make the normal handler pass the explicit Story key and underlying Story metadata. Remove omitted-key fallback to selection for ordinary Planning actions. Keep Epic, Subtask, Table and strict Board paths explicit. Until Task 7 is chosen and complete, no multikey Planning dispatch is available through a normal pill.
2. Apply the same token-owned optimistic and per-key outcome lifecycle as priority, preserving full prior status data. Remove Planning success reloads, including for single-key status; keep existing owners on other surfaces.
3. Correct action-bar/menu text so selection does not imply an ordinary pill will act on it. Keep selection, Accepted totals and capacity behavior.
4. Derive analytics from the submitted targets: clicked Story SP for a single action, never unrelated selection. Supply Table's underlying `row.issue` with its key/metadata fallback; also pass the complete priority source value in Task 3 so rollback does not lose field metadata. Update the obsolete literal Table argument, flag-count and keyless-batch source assertions without weakening Board single/auth/queue/refresh safety. Omit Story-SP buckets for Epic/Subtask-only actions. Preserve canonical event names and workflow tokens.

**Exit:** the single-target lifecycle/request-count tests pass: writes are immediate, target exactly one clicked key regardless of selection and reconcile without scope reads. The editor/order/motion portions of the integrated regressions become green in Tasks 5/6/8. Auth/error/no-op/unknown and unrelated-selection telemetry tests pass. An omitted-key or unconfirmed multikey Planning call sends nothing.

### Task 5 — Fence readiness reads and preserve active editors

**Depends on:** Tasks 2–4.
**Edit set:** `useStoryReadiness.js`, `useEpicRefresh.js`, `useEngIssueFieldEdits.js`, dashboard filtering/invalidation wiring, Table hold callback, Create `tests/test_story_readiness.js`, `tests/test_epic_refresh_source_guards.js`, editor/readiness tests and UI preservation cases.

1. Give department and per-Epic readiness reads edit-state tokens and scope/visit validation at commit; reconcile status/priority pending/confirmed values without manufacturing fields. Include readiness-only Epic field display. Department reads finalize in their owner on commit/failure/abort/ignore. `loadEpic` returns a retained read handle with its payload; `useEpicRefresh.recheckEpicAlerts` holds it through guard evaluation and merging, then finalizes exactly once in `finally`, including stale alert-version/epoch/scope, missing merge callback and exceptions. The consumer must release discarded handles; finishing at fetch return loses protection and finishing only inside merge leaks tokens. Exercise the real consumer with a delayed discarded payload in the readiness harness.
2. Connect the request-free marker from Task 2 to explicit Refresh and existing activation/load paths. Do not introduce a mutation-driven read. Preserve conservative last-authoritative requirements/counts until a permitted read; raw-field evidence, not a projected readiness value, acknowledges an explicit Refresh lock for a readiness-only Epic.
3. Add the optional synchronous editor lifecycle notification on the existing controller. Report open, close, context-clear and auth-clear identities to the early Planning hold setter; preserve existing consumers when the callback is absent. Table reports custom-cell holds separately and releases them on safe editor completion/cleanup.
4. Apply pending prior-field membership and held-row membership before `visibleTasks`/hierarchy filtering. Keep the held row's required parent mounted and its old position until the editor closes; preserve original filter values and draft text. Avoid late hook-return references or a duplicate field-editor owner.

**Exit:** delayed readiness reads cannot erase edits; mutation success triggers no readiness call. A Story changed beyond an active status/priority filter stays mounted with Summary/custom draft and focus intact, then settles when the editor closes. Readiness-only requirements are not hidden using incomplete child counts. Existing editor auth/conflict/recovery suites pass.

### Task 6 — Settle List and Table order from confirmed local values

**Depends on:** Tasks 3–5.
**Edit set:** `engWorkHierarchy.js`, `useEngWorkHierarchy.js`, `planningReviewTableModel.js`, Table projection wiring, hierarchy/table-model unit tests and priority/status UI tests.

1. Put List child ordering in the pure hierarchy builder using the existing priority comparator and a pending-original projection. Supply the same projected-only sort view to outer `sortEpicGroups` and resulting initiative order: effective Epic priority may come from its own metadata or fallback child priorities, and Epic sorting also reads status. Preserve optimistic objects for display while the sorter reads pending originals. Keep grouping, readiness requirements and the user's Epic sort; do not correct unrelated comparator behavior. Add delayed Epic-priority and no-own-priority Epic/child-fallback cases proving stationary pending groups, confirmed local settlement and no rejection reorder.
2. Add the optional pending-field projection to the Table sorter, leaving rendered values optimistic. Retain chosen ascending/descending multicolumn criteria, blank placement and ID/key tiebreakers. Confirming one issue releases only that issue's projection.
3. Reconcile filters after confirmation while respecting editor holds; preserve selection, capacity, review layout/custom values and other keys still pending. Nonpriority sorts must not become priority sorts.

**Exit:** tests demonstrate unchanged order while queued/saving, correct local order after each confirmation, no reorder on rejection and independent pending snapshots. Hierarchy/requirement and custom-draft preservation assertions pass without any refresh.

### Task 7 — Implement the operator's chosen List bulk behavior

**Depends on:** Tasks 4–6 and an explicit retain-bulk versus single-only decision.
**Edit set if retained:** status hook/menu, IssueCard/dashboard wiring, Create `PlanningStatusConfirmation.jsx`, Planning CSS, status UI/behavioral/source-guard/analytics tests.
**Edit set if removed:** existing status hook/menu/callers/tests only; do not create the confirmation component.

For retained bulk, implement the unchecked List-only opt-in, exact-key/workflow/scope options cache, frozen confirmation snapshot and atomic reservation specified above. Require confirmation for more than one key at the dispatch boundary, not only in the rendered button. Invalidate on changed selection/scope; cancel/dismiss applies no patch and sends no request. A one-key explicit selection acts on that selected Story. Validate zero/one/50/51 targets, duplicates, disjoint equal-tuple selections, clicked-unselected current-status options, overlap, partial failure and unknown outcomes. Never trim targets silently. Every target and the fixed action footer must be reachable in a short touch viewport.

For single-only, remove the implicit batch entry points and obsolete selection/status-target feedback while preserving normal Planning selection for its other uses. Assert every Planning dispatch is single-key. Record the decision and remove conditional files/tests from the final map.

**Exit:** the chosen behavior is documented and green; every multikey route to dispatch requires an explicit current confirmation, or multikey Planning writes are unavailable. No branch of this task may start while the decision remains open.

### Task 8 — Animate confirmed Table row movement

**Depends on:** Tasks 5–6; independent of Task 7's product choice.
**Edit set:** Create `usePlanningRowMotion.js`, Table, scoped Planning CSS, Table UI spec.

1. Use one stable identity function for keys, row refs, order snapshots and highlights: row kind plus immutable ID or issue-key fallback, with existing synthetic IDs. Capture old/new row rectangles in batches around confirmed order changes; animate the complete moved/displaced rows to zero delta with native Web Animations, about 180–220 ms.
2. Cancel prior motion before measuring a superseding change. Clean up on scope/mode/unmount and reduced-motion changes. Skip initial load, scroll and column-only changes. Preserve document/horizontal scroll, menu layering, pinned cells and docked header/totals; do not transform their ancestor wrappers.
3. Enable actual motion in the synthetic fixture. Pause/seek animations and assert intermediate whole-row displacement with its Story identity, then final order; final position or animation-name alone is insufficient. Include consecutive edits, missing IDs, editor holds, filtered removal and static reduced-motion behavior.
4. Run Chromium/Firefox/WebKit geometry/motion cases and a real `hasTouch: true` context using taps. Capture and inspect settled synthetic before/after screenshots; recheck Catch Up/Planning/Scenario sticky tiers.

**Exit:** movement is visible and tied to the correct row; drafts/focus/selection/scroll survive. All three engine checks and touch interactions pass. Reduced motion gives final order plus a static highlight.

### Task 9 — Build, document and close verification

**Depends on:** Tasks 0–8, including the resolved choice in Task 7 for full closure.
**Edit set:** feature/analytics/ontology/plan/index documentation, measured owner-budget counts, generated split output only.

1. Update behavior docs and the analytics no-new-event allowlist. Record actual created/changed/deleted paths, symbols and ownership; preserve the new main's unrelated ontology and plan-index content when applying these planning documents.
2. Keep App at or below 7,616 lines and all existing registered owner/interface ceilings intact. Re-measure App and affected aggregate metadata; do not increase frozen ceilings, change lint policy or weaken structure/source guards. Run extraction lint and structural checks.
3. Rebuild through `npm run build`; inspect all changed/added/deleted chunks and the lazy manifest. Keep output exactly reproducible with the split-build suite, including untracked files in the changed-file inventory. No hand editing or build-tool modification.
4. Run the focused and full verification commands below. Review every diff line against this map, inspect screenshots and report real results. Separate missing live acceptance from proven synthetic acceptance; do not perform live Jira writes to obtain evidence.
5. Leave this plan `EXEC-*` until verified implementation is accepted or merged. Publication requires its separate authorized transaction; this task ends with reviewable local changes and results.

**Exit:** all required checks pass, actual file scope is recorded, unresolved acceptance is explicit and the local fix is ready for operator review. No claim of measured latency improvement without measurements.

## Acceptance matrix

| Journey / state | Required observation |
| --- | --- |
| Ordinary single edit | Immediate clicked-key display; other Stories/drafts/selection remain intact; exactly one write target. |
| Queued / saving | Original sort/filter values keep pending order; incoming reads retain desired display; same-field overlap rejected before dispatch. |
| Confirmed / already-at-target | Valid matching per-key outcome; confirmed cache/read authority; local selected-sort settlement; zero mutation-triggered scope reads. |
| Definitive rejection | Token-owned full prior field restored; no success motion or scope reload; unrelated edits remain intact. |
| Unconfirmed / Refresh | Provisional prior display and persistent key/field lock; only a committed post-settlement explicit authoritative read can unlock. No write replay. |
| Scope / principal change | Queued job cancelled; dispatched completion cannot patch the new mounted scope or a later visit to the same scope. Origin cache settlement is token/context safe. |
| Concurrent reads / remote edits | Pre-edit reads cannot overwrite pending/confirmed local authority; a validated newer read may represent remote changes. No new polling/SSE or multi-user revision claim. |
| Dirty editors / review | Active row and parent stay mounted until editor closes; Summary/custom text, focus, review dirty state, layout and filters survive. |
| Optional explicit bulk | Frozen exact keys, current scope/selection and confirmation required; cancel writes zero; each partial outcome settles independently; max 50 without truncation. |
| Table motion | Entire row and displaced rows move after confirmation; selected sort remains active; reduced motion, touch, docking and scroll preserve geometry. |
| Expired auth | Existing terminal sanitized same-tab recovery covers the mounted app; feature state retained; no local unlock or replay. |

### Verification commands for execution

Use pinned Node 20 and the repository Python runtime. The review verified the five existing unit suites on Node 20.20.0; implementation still requires the expanded suites below. Build before visual tests: focused specs compile current source JS but several fixtures serve generated CSS/chunks. Keep the current-main split-build fixture support; do not replace it with a legacy single-bundle or direct-file shell. The five-suite 65-pass result is historical; baseline execution and the expanded checks below must run in the new-base working tree. The extraction gate uses pinned tools in ignored `tmp/lint` and `JEP_TEST_PYTHON` (or the existing `.venv`).

```sh
npm ci
npm run build
node --test tests/test_eng_priority_transition_utils.js tests/test_eng_status_transition_utils.js tests/test_eng_issue_mutation_queue.js tests/test_eng_issue_edit_state.js tests/test_planning_issue_mutations.js tests/test_eng_issue_field_edits.js tests/test_eng_work_hierarchy.js tests/test_story_readiness.js tests/test_story_readiness_api.js tests/test_planning_review_table_model.js tests/test_planning_action_source_guards.js tests/test_eng_board_drop_source_guards.js tests/test_epic_refresh_source_guards.js tests/test_strict_eng_board_integration.js tests/test_analytics_source_guards.js
node --test tests/test_use_eng_scope.js tests/test_use_eng_alerts.js tests/test_use_eng_capacity.js tests/test_eng_controls.js tests/test_dashboard_split_build.js
python3 -m unittest tests.test_codebase_structure_budgets
./scripts/extraction_lint/run.sh
npx playwright test tests/ui/eng_priority_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/planning_review_table.spec.js tests/ui/planning_review_integration.spec.js tests/ui/eng_issue_field_edits.spec.js --browser=chromium --workers=4
npx playwright test tests/ui/planning_review_table.spec.js --browser=firefox --workers=1
npx playwright test tests/ui/planning_review_table.spec.js --browser=webkit --workers=1
python3 -m unittest tests.test_oauth_eng_routes tests.test_jira_issue_transitions tests.test_jira_issue_priorities
npm run test:frontend:unit
python3 -m unittest discover -s tests
npx playwright test tests/ui --browser=chromium --workers=4
git diff --check
```

For specs starting Flask in a checkout without `.venv`, set `JEP_TEST_PYTHON` to the existing approved runtime. Do not install into unmanaged host Python. Before declaring the fix complete, reproduce and verify in an already authenticated running browser if available; keep live data read-only/transient, let the operator sign in, and never persist live screenshots. Browser verification on synthetic fixtures does not authorize live Jira writes.

The operator subsequently authorized a local commit of this plan, its index entry and the ontology entry on 2026-10-08. That authorization does not include application implementation, push or PR creation. Before later implementation publication, apply the complete repository publication transaction and explicit confirmation gate; revalidate base/head, history, file scope, exact-head build, local UI run and rendered remote PR.

## Analytics impact

Reuse `trigger=userevent`, `event_type=event`, canonical `event_name=issue_priority_action` with `feature_name=eng_priority_changes`, and `event_name=issue_status_action` with `feature_name=eng_status_transitions`. Keep existing `api_result`. Preserve `GA4_ENABLED` and the two GTM triggers; no new GA4 dimensions/runbook/transport changes.

Typed params remain strings/enums: priority `workflow_action=priority_options_open|priority_change_submit|priority_change_result`; status `workflow_action=status_options_open|status_change_submit|status_change_result`; `source_surface=planning`; `issue_type_mix=stories|epics|subtasks|mixed`; string `selected_count_bucket`; priority/status enum buckets; existing result `success|partial|failure`. Submit events occur on actual single dispatch or confirmed bulk dispatch, never on pending confirmation/cancel. Existing options-open telemetry remains owned by the option loader. UI unconfirmed outcomes use the existing failure telemetry token without claiming a definitive remote failure.

For `selected_sp_bucket`, pass the target builders the clicked Story's loaded SP even when it is unselected (Table must supply its underlying `row.issue`, not just a flattened key/status). For explicit bulk, use the deduplicated frozen submitted Stories. Calculate only from those target Stories; omit this optional parameter for Epic/Subtask-only actions, preserving omission on Catch Up/Board. Keep SP/key data local to the builder and send only the existing bucket string. Update the current test that expects unrelated selection SP for a Subtask and assert emitted single/bulk submit/result payloads with unrelated selection present.

Document passive motion, sort reconciliation, confirmation display/cancel and recovery mechanics in the no-new-event allowlist: mutation events already represent adoption/reliability. Do not send raw keys, summaries, status/priority names, Team/Department/Sprint names, checkbox target lists, confirmation text or row positions. Update tests to distinguish a single edited Story from unrelated selected Stories.

## Residual risks

- Bulk preservation is proposed and awaits the operator's choice. No implementation may infer that an unchecked/default Story action targets selection.
- Row transforms can interact with horizontally pinned cells and docked chrome; actual browser geometry and screenshots are required.
- Per-issue Jira results are sufficient for local field edits, not an authoritative full snapshot of Jira workflow automation or remote users' changes. Explicit Refresh remains the reconciliation path.
- This evaluation did not run Playwright or the backend suite, nor claim a measured latency improvement. The verified improvement target is eliminating mutation-triggered full-scope requests, to be proven by request-count regressions.

## Design review record (2026-10-08)

Three independent read-only reviews covered mutation/auth/state authority, UI/sorting/editor preservation, and verification/file map/analytics. Their actionable findings were consolidated into the contracts above:

| Finding | Required repair now in this plan |
| --- | --- |
| P1 stale-scope optimistic group-cache leakage | Confirmed-only cache authority, phase/token settlement and cancellation/switch-return tests. |
| P1 HTTP-200 ambiguous Jira writes | Explicit definitive/unconfirmed code classification and successful-refresh acknowledgement barrier. |
| P1 pending reads can erase optimistic display | Token-owned pending display overlay plus separate original-value ordering projection. |
| P1 filter removal can unmount active drafts | Membership/order hold for custom and Jira editors before dashboard filtering. |
| P1 indirect readiness reload and unfenced readiness response | Separate Planning invalidation from fetch nonces; mapped readiness hook and behavioral tests. |
| P2 single/bulk overlap can corrupt rollback baselines | Reject the complete same-field-overlapping target set before optimistic patch/enqueue. |
| P2 exact bulk option identity and clicked-status filtering | Bulk-specific exact-key cache/response checks; clicked-status omission only for single actions. |
| P2 missing-ID motion identity / long confirmation list | Existing ID/key fallback shared everywhere; bounded scrolling target list and visible touch actions. |
| P2 unit tests miss List ordering implementation | Move ordering into the mapped/tested pure hierarchy builder and pass its projection from the hook. |
| P2 stale CSS / motion and touch proof | Build before visual runs, animation-enabled deterministic motion fixture, three engines and real touch taps. |
| Minor analytics literal and target-SP ambiguity | Canonical workflow tokens and target-owned SP, omitting Epic/Subtask-only SP. |

**Second-pass result:** all three reviewers reread the repaired sections and reported their actionable findings closed, with no additional concrete design/file-map/verification gap from their targeted reviews. A final scope-visit generation requirement also makes the A → B → A stale-response case explicit.

These repairs validate the design contract, not a working implementation. The conditional bulk product choice and all implementation/browser acceptance remain open. No application code, backend contract or shared/private data ownership was changed during review.

## Current-main implementation review (2026-10-08)

Three independent reviewers validated this task contract separately against `33f4452ebd0d3653998d3e5890879a7596a402b3`: mutation/read/cache/auth authority; UI/group ordering/editor/motion; and file-map/task-dependency/build/verification/analytics. This review did not reuse the old-base design verdict as proof.

| Task-level finding | Repair in this contract |
| --- | --- |
| P1 authoritative Refresh lacked its actual raw-data loader seam | Task 2/file map now includes `useEngSprintData`, explicit operator request provenance and raw matching key/field evidence at accepted lane commits before read-token disposal. |
| P2 per-Epic readiness tokens could end too early or leak on discarded responses | Task 5/file map includes `useEpicRefresh`; the consumer retains the handle through guard/merge and finalizes it exactly once in `finally` on every exit. |
| P2 pending outer Epic/initiative ordering could move before confirmation | Task 6 projects Epic status/priority and child-fallback priority for outer sorting as well as child/Table sorting, with delayed group-order regressions. |
| P2 no-read task exits preceded the invalidation fix | The narrow Planning dirty/non-fetch split moved into Task 2; later editor/order/motion checks stay explicitly deferred to their owning tasks. |
| P2 changed Table metadata conflicted with an unmapped Board source guard | `tests/test_eng_board_drop_source_guards.js` is mapped to Task 4 and the commands; obsolete literals/counts/fallback expectations change while Board guarantees remain. |

**Rereview result:** all three reviewers closed their actionable findings with no additional concrete gap in their scoped current-main rereads. The verification reviewer also rechecked the complete map: zero missing existing paths and zero Create collisions. These are contract/source checks; no implementation, new-base unit suite, backend suite or browser campaign has run. Task 7's product decision remains open.

## Appendix: executed pure sort probe

This repository-relative command was run at the evaluation baseline. It intentionally demonstrates the undesired old List order, while proving the existing comparator supplies the desired order; it does not modify files.

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { patchEngIssueList } from './frontend/src/eng/engIssueEditState.js';
import { sortTasksByPriority } from './frontend/src/eng/engTaskUtils.js';
const source = [
  {key:'DEMO-1',fields:{epicKey:'DEMO-10',priority:{name:'High'}}},
  {key:'DEMO-2',fields:{epicKey:'DEMO-10',priority:{name:'Low'}}}
];
const patched = patchEngIssueList(source,'DEMO-2','priority',{name:'Highest'});
assert.deepEqual(patched.map(issue => issue.key), ['DEMO-1','DEMO-2']);
assert.deepEqual(sortTasksByPriority(patched).map(issue => issue.key), ['DEMO-2','DEMO-1']);
console.log('FAIL local priority patch preserves old List order; existing comparator supplies the expected order');
NODE
```
