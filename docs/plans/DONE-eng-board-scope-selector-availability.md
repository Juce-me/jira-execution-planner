# ENG shared Sprint selector availability — implementation plan

> **Status: Done.** Implemented and verified from baseline `6aaf9dac117d4708845f0202367e77e00ec24247`, then merged into `bugfix/board-progressive-loading` as `22c5d677056d16a65afa8fd17a00d9808b417971` on 2026-09-14. The selector, readiness model, scheduling protections, acceptance matrix, analytics contract, and documentation are complete. Positive authenticated cross-sprint loading remains unverified because no existing authorized live scope was available without changing shared settings.
>
> **Execution:** Tasks 1–5 and the post-review save/read fence are recorded as six branch commits: `a342077` (`test: define blocked Board selector contract`), `83083a7` (`Separate ENG Board scope readiness`), `9cff873` (`Implement semantic Board scope selector`), `fed8b36` (`Fix Board scope scheduling`), `b5addfa` (`test: complete Board selector acceptance matrix`), and this focused save/read fence follow-up. Execution used no worktree, shared configuration change, Jira write, backend contract change, push, or publication. This plan supersedes only the disabled/no-op scope-selection requirements in [the scope follow-up](EXEC-eng-board-scope-performance-regressions-190.md); its backend authority and measurement protections remain required. [Progressive loading](EXEC-eng-board-progressive-loading-190.md) remains authoritative for the stream, bounds, incomplete results, and measurement.

**Goal:** Make the one shared Sprint selector operable in all five ENG modes, including Component and All work in Board, without confusing a user's selection with permission to start a data load.

**Architecture:** Keep `selectedSprint`/`sprintName` as the saved ordinary-Sprint identity and `boardStrictScope` as the transient Board selection. Derive a separate Board load-readiness state from accepted saved configuration. Render an explicit selected-scope loading/setup/error state until that scope can load; use the existing strict owner only when ready. Ordinary Sprint choices and their data owner do not depend on Board capability.

**Stack:** Existing React 19, Node 20/esbuild, Flask, Node test runner, unittest, and Playwright; no new dependency.

## 1. Findings, ordered by severity

### P1 — missing load authority is implemented as an ignored user selection

- `frontend/src/dashboard.jsx:13654`, `boardConfigAvailable`, now additionally requires `savedSelectedProjects.length || String(savedBoardId).trim()`. `boardComponentEnabled` and `boardAllWorkEnabled` at `:13656` combine that predicate with catalog readiness and Department membership. Both option handlers at `:13711–13716` return before changing selection or closing the menu.
- In the authenticated local browser, the menu contained 17 ordinary Sprint values, including 2027Q2, 2027Q1 and 2026Q4. Both Board options had `aria-disabled=true`. Real pointer clicks on both left the menu open and ordinary Sprint label unchanged. Reading Settings, without editing or saving, showed **zero selected Jira projects**, **no source Board**, **seven Department columns**, **two Components**, and **eight Teams**. Closing Settings did not recover the options. These are UI-exposed runtime values, not a direct database read.
- A source-bundled isolated browser with capability `true`, a settled three-Sprint catalog, two Department columns and one Component reproduced exactly: empty saved projects/source Board → `boardConfigAvailable=false`, both enabled flags false, `boardStrictScope=''`, `strictBoardActive=false`, ignored clicks, zero strict requests. Adding only saved project authority enabled selection; Component preserved the saved Sprint and produced one `scope=component` request without `sprintId`.
- **Required correction:** retain authority as a **load gate**, but accept either Board selection and expose the missing configuration explicitly in the Board content area. Never populate authority from drafts, Sprint values, Department columns, or browser-provided project/JQL fields.
- The prerequisite itself is valid: `backend/routes/eng_board_routes.py:312`, `_resolve_projects`, consumes saved projects or resolves the saved Jira source Board's `location.projectKey`, then checks access. `backend/services/eng_board.py:92`, `normalize_projects`, rejects absent authority. Removing that protection would turn a UX regression into an authorization/scope defect.

### P1 — readiness, selection intent, and active data ownership are not the same state

- `frontend/src/dashboard.jsx:807`, `strictBoardActive`, checks capability/catalog/scope but **not** Department columns, Components/Teams, saved projects, bootstrap completion, or group refresh readiness. The guards are checked only on the initial option click. Once a scope is selected, configuration/group changes can leave a selected scope requesting an invalid configuration.
- Conversely, `:808` clears `boardStrictScope` when capability becomes false, including a config-fetch failure; `loadConfig` at `:6485` and post-save refresh at `:3683` turn failures into false capability. This silently changes the user's selected scope back to the saved Sprint instead of explaining the failure.
- The ordinary task effect at `:6499` waits on unresolved Board capability even when an **ordinary Sprint** is selected in Board. Its dependencies at `:6583` also include `showBoard` and capability, so a mode/capability update may cancel/restart in-flight selected-Sprint work. The existing warmed-cache test covers completed reuse, not this in-flight case.
- The owner receives only `sharedConfigRevision` as `groupRevision` at `:6764`; Department configuration has a separate `groupsConfig.configRevision` preserved by `frontend/src/settings/groupConfigUtils.js:55`. `useEngBoardData` at `frontend/src/eng/useEngBoardData.js:680–691` already retires inactive loads and handles changed group/revision/scope. Feed it the correct accepted configuration identity instead of introducing another load owner.
- **Required correction:** derive requested scope separately from load readiness, block every legacy load entry point while a cross-sprint scope is requested, retire strict loads when authority becomes unresolved/invalid, and recompute on accepted group/config changes. Keep the label and show the reason. Remove Board capability from ordinary-Sprint availability/scheduling.
- Evidence boundary: the direct no-op and delayed-bootstrap cases are reproduced. Stale revision, failed-bootstrap reset and in-flight mode races are source-proven paths requiring the explicit browser red cases below; they are not claimed as the cause of the supplied screenshot.

### P2 — all dropdown choices lack keyboard option semantics

- `frontend/src/dashboard.jsx:13711–13742` renders clickable `div` elements without option roles, focusability or keyboard selection handlers. The filter input at `:13691` handles Escape only. Closed toggle keyboard support does not make the choices keyboard-operable.
- Isolated runtime inspection found `tag=DIV`, `role=null`, `tabIndex=-1` even with capability and authority ready. ArrowDown followed by Enter in the open filter did not select anything. The live accessibility snapshot similarly exposes the options as generic text.
- **Required correction:** give the existing selector a searchable listbox/combobox interaction, selected state, keyboard navigation, Escape/focus return, and descriptive readiness text. Keep one shared selector; no Board-local scope switch.

### P2 — investigation-time tests and documentation encoded the rejected behavior

- At investigation time, `tests/ui/eng_group_board_view.spec.js` expected disabled options and dispatched clicks to do nothing after a valid catalog. Eligibility cases similarly conflated unavailable loading with unavailable selection, and delayed configuration covered eventual enablement but not accepted selection during the wait.
- Those historical tests passed while the defect remained. Implementation replaced them with genuine pointer/keyboard selection plus explicit label, readiness, request, fallback, terminal-card, analytics, and race assertions. The current two-scope authority/readiness table is the executable contract.
- Investigation-time workflow and analytics documentation described ignored clicks. The current documents now separate selection from readiness while preserving the independently owned Sprint-catalog and stream contracts.

## 2. Proven root cause versus remaining hypotheses

**Proven root cause of the no-op:** frontend scope-selection handlers are conditional on the same prerequisites used to authorize a load. They return silently when any prerequisite is false. Missing authority is a sufficient cause, reproduced with capability true and a nonempty catalog, and matches the local Settings presentation. Keyboard inaccessibility is a separate proven defect affecting ordinary and Board choices.

**Not proven:** whether the live empty authority is intentionally saved, an older import/configuration omission, or a failed/stale bootstrap read; the exact live `boardAllWorkAvailable` value was not directly captured. The browser API did not expose React hooks; direct authenticated API navigation was blocked, and Firefox runtime inspection was denied. No session extraction, auth-profile change, or credential workaround was attempted. The plan must not claim a backend config defect or enable a release-gated adapter on this evidence.

**Falsified as a sufficient permanent cause:** delayed bootstrap alone. Holding config with a valid catalog produced null capability and disabled options; releasing a valid saved configuration enabled both without opening Settings. Ordinary Sprint selection still changed the selected id during that delay. `/api/sprints` latency is not the cause being repaired here.

### Actual investigation evidence

- Live: both Board clicks ignored; ordinary selection changed 2026Q4 → 2026Q3; the shared selector opened and accepted the active ordinary Sprint in Catch Up, Planning, Board, Statistics and Scenario. Statistics was initially disabled because the selected Sprint was future, matching `frontend/src/eng/EngModeControl.jsx:34`; selecting an active Sprint made it accessible. This is not Board capability gating.
- Synthetic source-bundled diagnostic: four scenarios completed successfully—missing authority, false capability, ready authority, and delayed config. All had a valid three-item Sprint catalog. The observation seam was inserted into the **in-memory test bundle only**, with no production file edits. The ready case accepted Component and recorded exactly one strict request; the other cases accepted an ordinary Sprint and recorded zero strict requests. These are characterization assertions, not passing mitigation tests.
- Command: Node 20 `node tmp/selector-investigation/probe.cjs` → exit 0. Sanitized state results and settled screenshots are under ignored `tmp/selector-investigation/`. They are optional local evidence, not executable-plan dependencies; permanent tests must recreate their synthetic inputs.
- Command: `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1 -g 'missing saved Jira authority|completed sprint catalog does not authorize|Board to Planning to Board|Catch Up to Board' --output=tmp/selector-investigation/existing-test-results` → **5 passed, 6.6 seconds**, under Node 20. Chromium initially failed to launch under the sandbox; the approved process-access run succeeded.
- During the original investigation, the live open menu and settled synthetic missing-authority screenshot were inspected before any fix existed. The later implementation evidence and remaining authenticated-live gap are recorded in section 10; the original browser was returned to its ordinary Sprint and Catch Up mode after diagnosis.
- Read root/docs/plans instructions, ontology, both issue #190 plans, ENG workflows, relevant MRT027 postmortem and its instructions, backend contracts, configuration ownership, and the relevant dirty diff. No nested frontend/backend/test instructions were found. Upstream template remains 2026-09-08. Read-only remote-head verification matched local HEAD; no merge was attempted into the dirty checkout.
- `GATE-05` remains blocked and was checked the previous day. This is selector planning, not Home/auth migration or plan execution; no Home mutation or unrelated gate edit is included. The existing gate's required approved disposable target was not supplied.

## 3. Current state pipeline and authority ownership

Line references describe the inspected dirty source; re-resolve symbols before implementation.

| State / symbol | Initialization, producer and consumer |
| --- | --- |
| `availableSprints`, `sprintsLoading` | `dashboard.jsx:488`: existing catalog cache initializes both. `loadSprints`, `:6649–6709`, accepts a nonempty catalog, validates/falls back the ordinary identity and settles loading. Mount calls at `:1876–1884` load groups/config independently, then the catalog after onboarding. Treat this subsystem as read-only. |
| `selectedSprint`, `sprintName` | Saved ordinary identity; catalog validates it; ordinary option at `:13730` changes it. UI preference save at `:6278` persists it. Never write `component`/`all_work` into either value. |
| `boardAllWorkAvailable` | `:695` starts null; `loadConfig :6391` and post-save refresh `:3680` set strict boolean from `/api/config`. Failure paths set false. Backend `settings_routes.py:456` delegates to `strict_adapter_available` (`eng_board.py:43`), true only for the supported DB/OAuth profile. It does not certify saved project scope. |
| `savedSelectedProjects` | `:592` starts empty. DB bootstrap `:6434–6444` accepts `sharedConfig.projects.selected`; fallback `loadSelectedProjects :4574` uses `/api/projects/selected`; successful save `:4786` updates saved state. Draft state is separate. |
| `savedBoardId` | `:634` starts empty. DB bootstrap `:6440–6444` reads `sharedConfig.board.boardId`; fallback `loadBoardConfig :4592` and successful save `:4640` update it. This is the **Jira source Board**, not the Department Board. |
| `activeGroup.board.columns`, `.missingInfoComponents`, `.teamIds` | `loadGroupsConfig :2381` → `applyLocalGroupPreferences`/`normalizeGroupsConfig` → accepted `groupsConfig`, visibility and active id → `activeGroup :5392`; teams normalized at `:5399`. Existing groups load/error state must distinguish absent data from pending/failed reads. Unsaved `groupDraft` is not authority. |
| `sharedConfigReady` | `loadConfig :6388/:6492` toggles false/true, even after failure. Alone it cannot distinguish valid-empty from read failure. Add a Board-specific read status; do not repurpose Settings edit authorization. |
| `boardConfigAvailable` | `:13654` = capability true AND Department columns AND saved projects/source Board. It conflates several reasons and uses array presence, not backend validity. |
| `boardComponentEnabled` / `boardAllWorkEnabled` | `:13656`: catalog settled AND config predicate AND Components / Components-or-Teams. Replace their selection-gate meaning with distinct selectable/load-ready values. |
| `boardStrictScope` | `:696` transient `''`, `component`, `all_work`. Set only by Board pseudo-options; cleared on ordinary choice and the effect at `:808`. Not independently persisted. |
| `strictBoardActive` | `:807` activates strict owner and multiple guards. Currently weaker than click predicates. Split requested cross-sprint presentation/legacy suppression from strict data loading. |
| Ordinary load | Effect `:6497–6583` → `loadMeasuredGroupTasks` → `useEngSprintData`. Completed matching group/Sprint/Team snapshot skips reload. `useEngSprintData.js:102` and its fetch entry points already accept a suppression flag. Preserve that owner and cache. |
| Strict load | `useStrictEngBoardOwner :6764` → `useEngBoardData :680` → `streamEngBoard` → `/api/eng/board`. Owner owns cancellation, revisions, generation rejection and successful snapshots. No handler should also call its load/refresh on selection. |
| Refresh | `refreshActiveViewFromJira :14362` refreshes strict if active; otherwise invokes ordinary catalog/tasks. `retryServerConnection :13950` starts overlapping config and selected-project reads. Route a selected-but-blocked Board scope to configuration retry, never the ordinary fallback. Make accepted read generations coherent. |

### Endpoint contract matrix — no backend changes

| Method / route | Auth, authority, headers/body | Existing result and required handling |
| --- | --- | --- |
| GET `/api/config?includeViewConfig=true` | Existing authenticated read; workspace/site from request auth, no body, no new CSRF | DB: `{boardAllWorkAvailable:boolean, sharedConfigRevision:integer, sharedConfig:{projects:{selected:[{key,type}]},board:{boardId,boardName}}, ...}`. 503 `config_storage_unavailable` is retryable **configuration read error**, not capability=false. Missing/malformed capability is unknown/error, not authorization. |
| GET `/api/projects/selected`, `/api/board-config` | Existing authenticated reads of the same workspace; no body | `{selected,configRevision}` / `{boardId,boardName,source,configRevision}`. Existing legacy fallback only. Consume matching successful saved values; swallowed errors must not produce a ready state. No extra request when DB bootstrap already has the snapshot. |
| GET `/api/groups-config` | Authenticated workspace read; no body | `{groups,configRevision,source,preferences,...}` normalized by existing utilities. Keep shared Department configuration separate from private active/visible preferences. Failed reads are explicit; keep prior accepted values only as stale display, not new load authority. |
| GET `/api/eng/board` | Supported DB/OAuth; query `departmentId`, `scope=component|all_work`, `refresh=0|1`, optional `focusedColumnId`; **omit `sprintId`**. Backend captures saved config/access; no project/team/JQL authority from browser | 200 NDJSON is not completion. Preserve current terminal checks. Public 409 `board_config_invalid` or `board_unavailable`, 403 `board_permission_denied`, 422 `scope_too_large`, 503 availability errors remain unchanged. `_public_eng_board_error` at `eng_board_routes.py:99` deliberately maps internal config failures. Do not invent more detailed public errors. |
| GET `/api/tasks-with-team-name` and current mode-specific reads | Existing ordinary-Sprint owner and current signed-in Jira scope; preserve existing query/body, headers and lane classification | Synthetic fixture must record full URL, method, Sprint, group/Team scope and Product/Tech lane. Count one request per expected lane, not one total if the existing owner uses two lanes. Ordinary Board entry reuses this data, never `/api/eng/board?scope=sprint`. |
| GET `/api/sprints` | Existing catalog contract, valid nonempty response supplied by fixtures | Read-only dependency for this plan; no endpoint, response, performance, cache, persistence or retry implementation changes. |

Existing Settings writes retain their own `user_write`/`shared_admin_write`, revision conflict and OAuth token-bound `X-CSRF-Token` plus `X-Requested-With` requirements. This plan adds no write route or automatic save. Every application API 401, including a stream auth terminal, retains the global terminal sign-in screen; never local recovery, auto replay or in-place unlock.

## 4. Resolved selector state machine

### Before / after by mode (valid nonempty Sprint catalog)

| ENG mode | Before | After |
| --- | --- | --- |
| Catch Up | Ordinary choices clickable; no keyboard option selection; Board choices absent | Ordinary click/keyboard selection; Board-only reads cannot gate the control or task owner; Board choices absent |
| Planning | Same ordinary selector; entry unavailable for closed/no Sprint by existing mode contract | Same mode eligibility; selector remains operable in Planning, preserves planning invalidation on a real ordinary-Sprint change |
| Board, ordinary Sprint | Ordinary choices clickable, but initial task effect waits on null Board capability; Board pseudo-options can silently reject clicks | Ordinary choices independent of Board readiness; both Board scopes selectable; ordinary Board uses Catch Up owner/snapshot |
| Board, Component / All work | Selection possible only with initial prerequisites; weak active predicate and capability failure can invalidate intent silently | Label represents selected scope immediately; load only when ready; selected scope otherwise displays explicit waiting/setup/error state and no misleading ordinary data |
| Statistics | Ordinary selector works when mode is eligible; future Sprint prevents entering Statistics | Selector retains ordinary choices and keyboard support in Statistics; existing future-Sprint eligibility/render behavior preserved |
| Scenario | Ordinary selector works; entry unavailable for closed/no Sprint | Selector retains ordinary choices and keyboard support; existing Scenario invalidation/dirty-state behavior preserved |

**Catalog boundary:** with a usable cached/live catalog, every listed ordinary choice is selectable regardless of Board configuration status. Preserve the existing no-usable-catalog startup/empty/error behavior and Sprint identity validation; do not redesign discovery. Board scopes become **selectable** when the existing shared selector has a usable catalog and ENG Board is active, even if their load prerequisites are absent. Selection of a blocked scope is meaningful navigation to its explicit state.

### Alternatives considered

1. **Selectable scope with explicit readiness state — selected.** Meets the requested interaction and keeps unauthorized requests at zero; adds a small presentation/readiness model.
2. Enable every scope and always request the backend. Rejected: it creates known-invalid loads for missing configuration and ignores capability gates.
3. Keep options disabled but improve tooltip text. Rejected: it still fails the requirement that both scopes accept selection, and title-only communication does not fix keyboard access.

### Board load readiness (priority order)

| State | Condition | Selected-scope presentation / action | Network |
| --- | --- | --- | --- |
| Auth locked | Existing global lock | Existing global sign-in recovery | No new application work |
| Loading configuration | Accepted config read pending OR groups pending | “Loading Board configuration…”; keep selected scope label; ordinary selector remains usable | No strict or ordinary task load on behalf of requested cross-sprint scope |
| Configuration read failed | Current bootstrap/group read failed or malformed | “Board configuration could not be loaded.” / **Retry configuration** | One coordinated read attempt on explicit retry, no polling |
| Unsupported deployment | Accepted capability is false | “Cross-sprint Board is unavailable in this environment. Choose a Sprint to continue.” | Zero strict requests; do not enable Basic/JSON |
| Missing Department | No active accepted Department | “Choose a Department to use this Board scope.” / existing Department chooser | Zero strict requests |
| Missing Board columns | Accepted Department has no usable columns | “Configure Board columns for this Department.” / existing Departments → Boards | Zero strict requests |
| Missing Jira authority | No saved selected projects and no trimmed saved source Board | “Select Jira projects or a Jira source Board before loading this scope.” / existing Admin → Scope projects when editable; otherwise “Ask a workspace tool administrator to configure Jira scope.” | Zero strict requests |
| Missing Components | Component selected without nonblank configured Components | “Add Components to this Department to use Component scope.” / Departments → Team groups | Zero strict requests; never silently reinterpret as All work |
| Missing Components and Teams | All work selected with neither | “Add Teams or Components to this Department to use All work.” / Departments → Team groups | Zero strict requests |
| Ready | Valid catalog + successful current reads + capability + saved authority + Department prerequisites | Existing strict loading/progressive/complete/error Board | Existing bounded strict owner; one generation per effective transition |

Presence permits an attempt, not proof of Jira permission/validity. Backend remains final authority for malformed columns, invalid projects, saved Board resolution and access. A real public config/permission error becomes an understandable selected-scope error with an explicit settings/retry path; do not inspect raw server diagnostics in product UI. Empty results are shown only after an authoritative completed load, never for missing configuration.

### Transitions and ownership

| Action | Selection and presentation | Required load behavior |
| --- | --- | --- |
| ordinary → Component | Set only `boardStrictScope='component'`; keep saved Sprint id/name and Catch Up cache | Ready → existing owner loads Component once; otherwise show readiness state. Suppress legacy fetches immediately in both cases |
| ordinary → All work | Same with `all_work` | Same gating; exact union semantics unchanged |
| Component ↔ All work | Change transient scope, close menu, preserve ordinary identity | Cancel/retire prior generation; one new strict request if ready; late frames cannot replace new scope |
| Component/All work → ordinary | Clear transient scope; set ordinary id/name only if changed; restore saved Team selection semantics | Retire strict owner; reuse matching completed ordinary snapshot. If unavailable, run exactly the normal lane load once, never strict Sprint load |
| Board → another ENG mode → Board | Preserve ordinary id/name; clear transient Board scope on departure, as existing behavior does; return to ordinary Board | Other mode uses saved ordinary Sprint. Returning to warmed Board causes no extra task requests. Do not resurrect previous cross-sprint selection from owner cache |
| Department change | Preserve ordinary identity and current transient Board scope; recompute all prerequisites for newly accepted Department | Retire old group; no old cards/export under new group; ready new group loads once, incomplete configuration shows explicit state. Existing per-group focus/filter behavior retained |
| Config/group refresh pending | Preserve current selection; mark loading/config stale, retire affected strict generation | No new strict load until current accepted reads settle. Ordinary choice remains usable; do not refetch ordinary work because capability changed |
| Accepted config changes | Recompute readiness and strict revision from saved values, never drafts | One load for changed ready authority; no second imperative load. No automatic load for invalid config; same accepted revision/content does not refetch |
| Config refresh fails / capability revoked | Preserve selected scope and reason; no reset to ordinary | Retire strict load; no legacy fallback. Retry is explicit; false capability is not retried as a server error |
| Settings dirty / cancel / 409 conflict | Existing editor and conflict flow owns draft; selected label remains | Draft cannot grant/revoke authority. Cancel/discard restores editor only. 409 does not count as accepted config, does not trigger strict reload |
| Ordinary Refresh / strict Refresh / blocked-scope Refresh | Preserve selected intent | Ordinary current behavior; strict current owner `refresh`; blocked scope retries configuration. Never fall through to ordinary refresh for blocked scope |
| Out-of-order read or stream / auth recovery | Ignore obsolete read results; existing global lock wins | No stale authority overwrite, late stream application, hidden load, or request replay |

## 5. Exact implemented file map

This is the complete 30-path implementation diff from `6aaf9dac117d4708845f0202367e77e00ec24247` through branch `HEAD`. `Create` entries are deliberate new files. No catalog or backend production file changed.

| Action | File | Responsibility |
| --- | --- | --- |
| Create | `frontend/src/eng/engSprintSelectorState.js` | Pure scope-readiness/selection model, no fetching, persistence, React or auth implementation |
| Modify | `frontend/src/dashboard.jsx` | Integrate model, accepted bootstrap status/generations, shared semantic dropdown, explicit Board state, requested-versus-loading guards, refresh/revision wiring, and cache-bypassing Project Track source-range synchronization on explicit Sprint commitment |
| Create | `frontend/src/settings/settingsConfigReadState.js` | Snapshot and generation guards for accepting asynchronous Settings baselines without overwriting interim drafts |
| Modify | `frontend/src/settings/useJiraFieldPickers.js` | Preserve dirty field-picker drafts across delayed or stale configuration reads and recompute aggregate dirty state when accepted baselines change |
| Modify | `frontend/src/styles/shared/header.css` | Scoped native option/button reset, active/focus/readiness text; retain main/compact geometry and stacking |
| Modify | `frontend/src/ui/LoadingState.jsx` | Add an optional accessible status label used by the explicit Board loading state |
| Create | `tests/test_eng_sprint_selector_state.js` | Pure readiness and transition-contract test matrix |
| Modify | `tests/ui/eng_group_board_view.spec.js` | Replace no-op expectations, source-bundled five-mode/keyboard/scope/request regression matrix and screenshots; keep existing strict fixtures |
| Modify | `tests/test_eng_board_data.js` | Existing owner changed-revision/retire/late-frame/cached ordinary restoration coverage as needed for integration contract |
| Modify | `tests/test_eng_board_source_guards.py` | Pin requested-versus-ready strict activation and ordinary-load suppression in the dashboard source seam |
| Modify | `tests/test_epm_settings_source_guards.js` | Preserve and guard `replaceWorkspaceDrafts` compatibility for fenced workspace config reads and saves |
| Modify | `tests/test_strict_eng_board_integration.js` | Assert selected-but-blocked presentation cannot expose legacy data or mutation/export authority; update any source wiring assertions |
| Modify | `tests/test_jira_field_pickers.js` | Unit coverage for accepted baselines, dirty-draft preservation, and stale field-read rejection |
| Create | `tests/test_settings_config_read_state.js` | Unit coverage for Settings draft snapshots and baseline-revision acceptance |
| Create | `tests/ui/jira_field_picker_read_race.spec.js` | Browser coverage through the real field loaders for interim edits and stale fallback generations |
| Modify | `tests/ui/settings_unified_save.spec.js` | Source-bundled Settings coverage proving delayed fallback completion preserves drafts and recomputes unified Save eligibility |
| Modify | `tests/ui/codebase_structure_smoke.spec.js` | Update shared selector role queries and verify stable, readable native Sprint-option styling, including EPM reuse |
| Modify | `tests/ui/eng_board_progressive_loading.spec.js` | Use semantic current-branch options while retaining the historical selector lookup for baseline campaign comparisons |
| Modify | `tests/test_codebase_structure_budgets.py` | Record the reviewed dashboard integration growth, including the Task 5 Project Track range/cache correction |
| Modify | `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md` | Correct selection-vs-load and Project Track wording, analytics allowlist, and canonical selector/load-authority mapping while retaining catalog/stream facts |
| Modify | `docs/postmortem/MRT027-board-catalog-pagination.md` | Amend the obsolete prevention bullet that required disabled missing-authority options while preserving historical evidence |
| Rename/modify | `docs/plans/DONE-eng-board-scope-selector-availability.md`, `docs/plans/README.md`, `docs/plans/EXEC-eng-board-scope-performance-regressions-190.md`, `docs/plans/EXEC-persistent-sprint-team-catalogs.md` | Record completed execution/merge and supersession of only the obsolete no-op requirement |
| Modify | `docs/plans/GATE-05-home-write-capability.md` | Record the required 2026-09-14 weekly gate review; keep the unsupported Home-write gate blocked |
| Generate only | `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css` | Normal build output; never edit by hand |

Read-only contracts: `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/useStrictEngBoardIntegration.js`, `frontend/src/eng/useEngBoardData.js`, `frontend/src/eng/EngBoardView.jsx`, `frontend/src/eng/EngModeControl.jsx`, `frontend/src/eng/engModeState.js`, `frontend/src/api/engBoardApi.js`, `frontend/src/settings/groupConfigUtils.js`, `frontend/src/ui/EmptyState.jsx`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `backend/routes/settings_routes.py`, `backend/routes/eng_board_routes.py`, `backend/services/eng_board.py`, and `backend/security/policy.py`. Their APIs remain unchanged; readiness presentation is a conditional sibling of `EngBoardView` in dashboard, so no Board renderer redesign was required.

**Current accuracy:** The file map above matches every path in `git diff --name-status 6aaf9da..HEAD`; the initial planning-only state is historical. Task 5 evidence reviews added one scoped production correction in `dashboard.jsx`: an explicit shared-Sprint commitment in Project Track synchronizes that source-only range and arms the existing force-refresh/nonce path for one current POST. This includes a current-Sprint commitment when its Project Track range diverges, but leaves an already matching reselect untouched. No Sprint catalog, backend production, owner, stream, Scenario-compute, or task-backed Statistics implementation changed.

## 6. Test-first implementation tasks

Run commands under the repository's Node 20 runtime (`nvm use` with installed `.nvmrc` environment) and existing `.venv`. No dependency installation, worktree or publication is required. Each task has a red loop, implementation boundary and green command; do not weaken a network protection to make a click test pass.

### Task 1 — turn the live no-op into the correct failing browser contract

**Files:** `tests/ui/eng_group_board_view.spec.js`.

- [x] Add source-bundled cases named `selector regression: missing authority selects Component` and `selector regression: missing authority selects All work`. Use `selectedProjects: [], savedBoardId: ''`, valid capability, Department columns/Components/Teams, and valid nonempty Sprint catalog. Keep screenshot labels 2027Q2, 2027Q1, 2026Q4 with distinct synthetic ids. Capture full request URLs/methods, not just paths.
- [x] Replace the existing missing-authority no-op expectations with actual user selection and an explicit selected-scope configuration state. The core desired assertion sequence is:

```js
await page.getByRole('button', { name: 'Select sprint', exact: true }).first().click();
await page.getByRole('option', { name: scopeLabel, exact: true }).click();
await expect(page.getByRole('button', { name: 'Select sprint', exact: true }).first())
    .toContainText(scopeLabel);
await expect(page.getByRole('status')).toContainText(
    'Select Jira projects or a Jira source Board before loading this scope.');
expect(requestUrls.filter(url => url.startsWith('/api/eng/board?'))).toEqual([]);
await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('jira_dashboard_ui_prefs_v1')).selectedSprint)).toBe(selectedSprintId);
```

Use the existing fixture's `selectedSprintId`; `scopeLabel` is explicitly parameterized over `Component` and `All work`. Configure the status region so it is uniquely identifiable by an accessible name if another status exists; use that same name in assertions. Assert no ordinary tasks are triggered by a blocked-scope selection and no old Epic cards/export are presented as its result. Use genuine unforced clicks for the new operable choices.

- [x] Red command: `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1 -g 'selector regression:'`. Expected current failure: no semantic option/accepted selection/configuration state. Do not count timeout caused by missing fixture onboarding as a valid red.
- [x] Keep these tests red until Tasks 2–4. Preserve all unrelated issue #190 tests and endpoint-shaped authority fixtures. Do not import a `.spec.js` from another spec.

### Task 2 — model selection separately from readiness

**Files:** new model and unit test, dashboard integration.

- [x] Add table tests for pending/failed bootstrap, capability false/null/malformed, missing columns, missing saved authority, Component-only, Team-only, no group, group pending/failure, valid projects and saved Board fallback. All Board options are selectable with a usable catalog; only eligible scope loads. Ordinary selection eligibility never changes across Board states.
- [x] Red: `node --test tests/test_eng_sprint_selector_state.js`; expected missing module first, then expected-state mismatches while integrating.
- [x] Implement this pure decision contract (input names below are the new helper interface, not renamed persistence fields):

```js
const present = values => Array.isArray(values)
    && values.some(value => String(value ?? '').trim());

export function resolveEngSprintSelectorState({
    boardMode, catalogReady, bootstrapStatus, capability,
    groupsLoading, groupsFailed, group, savedProjects, savedBoardId,
}) {
    const selectable = Boolean(catalogReady);
    const common = bootstrapStatus === 'loading' || groupsLoading ? 'loading'
        : bootstrapStatus !== 'ready' || groupsFailed ? 'error'
        : capability === false ? 'unsupported'
        : capability !== true ? 'error'
        : !group ? 'department_required'
        : !group.board?.columns?.length ? 'columns_required'
        : !(Array.isArray(savedProjects) && savedProjects.length)
            && !String(savedBoardId ?? '').trim() ? 'projects_required'
        : 'ready';
    const components = present(group?.missingInfoComponents);
    const teams = present(group?.teamIds);
    const readiness = scope => !catalogReady ? 'catalog_pending'
        : common !== 'ready' ? common
        : scope === 'component' && !components ? 'components_required'
        : scope === 'all_work' && !components && !teams ? 'membership_required'
        : 'ready';
    return {
        ordinarySelectable: selectable,
        boardSelectable: Boolean(boardMode && selectable),
        componentReadiness: readiness('component'),
        allWorkReadiness: readiness('all_work'),
    };
}
```

- [x] Add `boardBootstrapStatus` (`loading|ready|error`) next to current capability state and a Board-facing group-read failure flag updated by `loadGroupsConfig`; `groupsError` alone is insufficient because connection failures intentionally clear its text. Clear the group-read failure flag only on a successful current group read. Guard group-read completion with its own generation so an older retry cannot overwrite the newest group result. `loadConfig` and its post-save capability refresh must mark pending/error explicitly and distinguish false capability from read failure. Accept state only from the latest read generation. For existing section fallbacks, return success/failure from `loadSelectedProjects`/`loadBoardConfig` and propagate failure to readiness; do not silently mark an empty default ready. Preserve their existing callers and config/draft ownership. Keep required ordinary-Sprint loads independent of this status.
- [x] A fresh DB bootstrap must atomically make its saved authority and capability usable without a Settings visit or extra catalog/section read. Failed reads never promote draft/old state as current authority. Consolidate the Board-related calls in connection retry so separate selected-project requests cannot overwrite a newer bootstrap snapshot. Preserve unrelated EPM draft protections and Settings dirty values.
- [x] Keep the early `boardScopeRequested = selectedView === 'eng' && showBoard && ['component','all_work'].includes(boardStrictScope)` near current `:807`. Move **load** readiness calculation after `activeGroup`/normalized Team derivation (`:5392`) and before its first loader use; do not introduce a temporal-dead-zone read of `activeGroup` near `:807`.
- [x] Derive `strictBoardActive = boardScopeRequested && selectedScopeReadiness === 'ready'`; keep current catalog validation in the resolver inputs. Clear scope on ENG/Board departure, but remove capability-false from the reset effect. Ordinary selection still clears it.
- [x] Green: same unit command, then Task 1 browser command after Task 3. Expected unit matrix green; do not declare browser contract done before semantic selection and explicit state render exist.

### Task 3 — implement semantic selection and explicit Board state

**Files:** dashboard and scoped header styles; browser tests.

- [x] Before changing the control, add `selector keyboard: ordinary`, `selector keyboard: Component`, and `selector keyboard: All work` cases: focus/open trigger, ArrowDown to the intended named option, Enter, assert new selected label and exact request scope (or explicit blocked state). Assert Escape returns trigger focus, Tab exits, and filtering never leaves a missing active-descendant target. Red command: `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1 -g 'selector keyboard:'`; expected current failure is absent semantic options/unchanged selection after Enter, not failed fixture setup.

- [x] Preserve `renderSprintControl(surface)`, active surface refs, filtering, main/compact placement, one visible panel and width tokens. Use a native closed toggle button with `type=button`, `aria-haspopup=listbox`, `aria-expanded`, `aria-controls`, accessible `Select sprint` name and existing catalog gating.
- [x] Open filter input uses `role=combobox`, `aria-autocomplete=list`, `aria-expanded=true`, `aria-controls` and a valid `aria-activedescendant`. The panel list has `role=listbox`; each ordinary/Board choice is a native `button type=button role=option tabindex=-1` with stable surface-specific id and `aria-selected`. Board readiness descriptions use `aria-describedby`, not an inaccurate `aria-disabled` or native title-only tooltip. Visible suffixes may say “Loading configuration” or “Setup needed” without changing the option's accessible name. Loading/no-match rows are statuses, not options.
- [x] Add one active-option index per open selector. ArrowDown/ArrowUp navigate and scroll active option into view; Home/End choose first/last; Enter commits active option through the **same** handler as pointer clicks. Typing filters locally and clamps/resets active index. Space remains search text when editing. Escape closes and restores focus to the originating surface's trigger. Tab closes without trapping or stealing focus. Pointer selection closes and restores trigger focus after it remounts. Viewport/surface changes close the panel and discard stale active-descendant ids.
- [x] The Board handler no longer checks load eligibility or invokes fetches. It checks only `boardSelectable`, sets the transient requested scope, emits the existing explicit filter event and closes. Same-scope reselect is a no-op with no duplicate event/load. Ordinary selection keeps existing Team carry-forward, id/name setters and analytics, clearing transient scope even when returning to the same saved Sprint.
- [x] Before the existing `EngBoardView` at `dashboard.jsx:16655`, render `LoadingState` or `EmptyState` inside a named `role=status` region for a requested but blocked scope. Use the exact reason/action table in section 4. Do not show the ordinary snapshot, facets, per-card edit controls or export under a cross-sprint label. Configure actions open existing Settings tabs only on explicit click and retain `userCanEditSettings === true` as the Admin edit gate; Department editing follows its existing authenticated-user policy.
- [x] Keep the shared header, mode control and ordinary choices usable. Scope-blocked Refresh invokes one coordinated config retry; unsupported deployment shows the explanation and requires an ordinary selection to resume data. Existing strict stream errors retain selection and current bounded retry behavior. A backend config error may offer generic setup guidance; do not guess which saved field failed.
- [x] Green: Task 1 command. Add pointer and keyboard tests for all three Board scope types and all five modes. Assert role, selected labels, active-descendant target, focus return, no-match announcement, and readiness communication. Preserve header/menu layering, hit testing, fixed control/icon geometry at main and compact widths; style only the selector classes.

### Task 4 — make scheduling follow selected intent and accepted configuration

**Files:** dashboard, existing owner/integration tests, browser spec. Keep backend and owner production code unchanged unless new evidence requires a separately reviewed amendment.

- [x] First add `selector scheduling: held capability permits ordinary load`, `selector scheduling: blocked scope never falls back`, `selector scheduling: capability failure preserves intent`, `selector scheduling: group revision retires old generation`, and `selector scheduling: in-flight ordinary Board reuse`. Use the held responses and exact assertions specified below; record failures with `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1 -g 'selector scheduling:'` before changing scheduling. Expected failures include ordinary work waiting on held capability, scope reset, or obsolete data/load counts; a test that already passes remains regression protection rather than claimed red evidence.

- [x] In the ordinary task effect, suppress on `boardScopeRequested`, not merely `strictBoardActive`. Remove `(showBoard && boardAllWorkAvailable === null)` and Board capability from the ordinary effect dependencies. Avoid `showBoard` dependency causing a warmed or in-flight ordinary Board entry to restart identical tasks; dependency should follow actual data scope/owner change. Preserve catalog, group/onboarding, auth-resume and config-save invalidation conditions and request cancellation.
- [x] Pass `boardScopeRequested` to the existing `useEngSprintData` suppression parameter (`strictBoardActive`) so its independent task/backlog/alert entry points cannot run during requested-but-blocked Board. Preserve the hook's external API. Audit all dashboard uses of `strictBoardActive`: owner load uses **ready**; legacy suppression, blocked Board presentation, Jira export key inputs and mutation availability use **requested/blocked** as appropriate. Dependencies, refresh/retry and ancillary loads cannot fall through to legacy solely because strict readiness is false.
- [x] Give the existing strict owner one stable accepted revision key which includes workspace config revision **and** Department config revision/content. `groupsConfig.configRevision` is the normalized field; the fixture's generic `revision` is not a substitute. For revisionless legacy fixtures, stable serialization of accepted Board columns, Components and normalized Teams supplies the local invalidation identity. Include saved projects/source Board when their successful section read changes; keep this key in memory only, out of URLs/analytics/operational payloads. A stable string is supported by `scopeKey` at `useEngBoardData.js:60`.
- [x] Use existing `owner.selectGroup` / `owner.setScope` / `owner.retire` sequencing. No click-handler load plus effect load, no independent fetch on readiness render, no polling. Readiness becoming ready after an accepted selection produces one generation. Same ready config refresh with unchanged revision/content does not trigger a load; explicit data Refresh still does once.
- [x] Add held-config, failed-config, held-child, config-revoked and group-change tests with controlled promises released in `finally`. A late old read must not authorize the new group/config; late old frames must not replace ordinary data or new scope. Capability failure keeps the selected label and explicit error, never flips to Sprint automatically. Group/config deletion shows setup with zero new invalid loads; repairing it starts exactly one eligible request.
- [x] Fence Board-affecting Settings transactions before the first shared mutation: invalidate applicable config/group read generations, reject reads begun before or during the save, and restore authority only from the successful authoritative group response or designated current post-save config read. Preserve preference-only warm generations, direct read callers, dirty drafts, conflicts, failures and global auth locking.
- [x] Red/green: `node --test tests/test_eng_board_data.js tests/test_strict_eng_board_integration.js` and `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1 -g 'selector|authority|delayed|Planning to Board|Catch Up to Board'`. First record new failures on the pre-task wiring, then require green after integration.

### Task 5 — complete the acceptance and safety matrix

**Files:** `frontend/src/dashboard.jsx`, the existing browser spec, structure-budget test, generated dashboard bundle, and docs in the file map; no backend changes.

- [x] Parameterize all five modes with an active Sprint initially so existing mode eligibility does not invalidate setup. In each, select a different ordinary Sprint by click and keyboard; assert selected label/id and the resulting intended data scope. Include closed/future Sprint mode-eligibility preservation separately. For `statsView=projectTrack`, inspect exact POST counts and bodies so pointer and keyboard selections each issue one current source-only reload containing only the new Sprint id, while stale initial requests, prewarmed range/per-Sprint caches and task reads cannot satisfy the assertion. A current-Sprint commitment repairs a divergent range and reloads once; the same choice with an already matching range emits no event or request. Preserve the existing task-backed case. Scenario remains its existing explicit compute workflow, with no new automatic compute or write.
- [x] For each mode repeat capability/config delayed, false/unavailable, and failed-read responses while a valid nonempty Sprint catalog is available. The ordinary option must remain operable. Project Track repeats the exact new-Sprint POST-body/count assertion in each state. In Board, ordinary data must not wait for a held **Board** capability response. Keep existing auth/group/Sprint protections; selection accessibility does not authorize unrelated unsupported loads.
- [x] Board matrix: both strict scopes × saved projects / saved source Board / missing authority / missing columns / Team-only / Components-only / no membership / config pending / config failed / false capability. Assert labels and requests, not option presence alone. Valid readiness dispatches exactly one matching request without `sprintId`; blocked selection shows explicit state with zero strict and zero fallback task requests. Positive fixtures return endpoint-shaped valid terminal streams, not just HTTP 200.
- [x] Round trips: both strict scopes → ordinary; ordinary Board → each sibling mode → Board; strict → each sibling → Board. Verify saved ordinary identity throughout, cached Catch Up/Board restoration, no duplicate expected lane request, no strict Sprint request. Hold an ordinary lane during Catch Up → Board to catch cancellation/restart duplication masked by completed-cache tests.
- [x] Repeated ready scope click, rapid Component → All work → ordinary, group A → invalid B → A, refresh before/after bootstrap, same-revision refresh, changed Department config revision, changed saved authority, failed retry then success, and late stale results must obey section 4. Distinguish one **intended** reload after a real config change from a duplicate.
- [x] Assert global 401 locking from config and strict stream, including delayed responses after lock, no retry/replay, and an empty post-lock selector `filter_changed` event sink. After lock, prove the semantic trigger is absent from the accessibility tree, a normal pointer attempt is intercepted, and Tab/Shift+Tab remain contained on Sign in with no listbox or request. Distinguish the accepted pre-lock selection event from passive late completion. Keep existing backend negative tests exercising real authority capture, selected-project precedence, saved-Board fallback without accessible project, denied project, unsupported Basic/JSON and workspace isolation. No backend contract change is needed to satisfy this plan.
- [x] Run `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_eng_board_routes tests.test_eng_board_service tests.test_eng_board_source_guards tests.test_eng_board_basic_compat`; those existing security/scope tests should remain green throughout. If a failure reveals a required backend behavior change, amend the plan with evidence before proceeding.
- [x] Run the full affected browser spec plus `tests/ui/eng_board_stream.spec.js` and `tests/ui/eng_board_progressive_loading.spec.js` serially. Then `npm run test:frontend:unit` and `npm run build`. Inspect generated files and screenshots; never hand-edit dist. Full Python discovery is required before any later push, not to substantiate this documentation-only investigation. Record actual results, warnings, skips and unresolved failures without borrowing prior task results.

## 7. Analytics impact

Keep the existing contract: `trigger=userevent`, `event_type=event`, canonical `event_name=filter_changed`, `feature_name=dashboard`, `filter_type=sprint`. Ordinary choices retain existing source-surface and bounded Sprint-state mapping; Board choices retain `source_surface=board`, `scope_type=component|all_work`, `sprint_selection_state=component|all_work`. All parameters here are strings/enums; never send Sprint/group/project ids, names, query text or reasons copied from raw server errors.

Accepting a Board scope into its explicit setup/loading state is now a real filter selection and emits once. Automatic config resolution, readiness updates, stale-response rejection and rendering emit none. Same selected option emits none. Configuration CTA reuses the existing `settings_action` open contract; configuration retry needs no new event because it is passive recovery through an existing state. Tests inspect accepted filter payloads and ensure no event on typing, automatic readiness or rejected auth-locked interaction. Keep the existing `api_result` terminal measurement contract unchanged; do not fabricate a strict result event when no strict request ran.

Update only the affected allowlist explanation in `docs/README_ANALYTICS.md`. No new event, transport trigger, GA4 custom dimension, consent UI or runbook change is required. The app's existing analytics transport gate remains unchanged.

## 8. Non-goals and protection of existing work

- **All `/api/sprints` performance, caching, persistence, response and discovery implementation.** Another task owns it; assume/stub a valid nonempty catalog. Do not edit `backend/services/sprints.py`, Sprint caching in `settings_routes.py`/`jira_server.py`, `frontend/src/dashboardRuntime.js`, or catalog fetch/refresh behavior in `frontend/src/api/engApi.js`/`loadSprints`.
- No Board-local scope selector, independent persisted Board Sprint, automatic selection of All work on Board entry, private Department definitions, or automatic Settings save.
- No auth/DB/Home/EPM migration, capability rollout, new credentials, API writes, schema, dependencies, source Board creation, arbitrary Jira fallback, or widened authority.
- No progressive stream/paging/resource changes: preserve exact Component matching, All work Team-parent union, ordinary snapshot reuse, 30-second budget, two child workers, 1,000 admitted Epics, 10,000 child/Team-work bounds, 7,000-byte queries, 8 MiB frames and 32 MiB generation. Enhanced issue search remains `nextPageToken`/`isLast`; project catalog remains `startAt`/`isLast`.
- No broad Settings, mode eligibility, Scenario compute, chart, export-policy or product redesign. A blocked selected scope must not expose unrelated ordinary exports, but existing authoritative/provisional strict export policy remains intact.
- The pre-execution boundary required preserving the issue #190 backend, owner, measurement and generated changes and prohibited reset, restore, push, history rewriting, or publication. Authorized execution then produced the six scoped branch commits recorded at the top; no push, merge, PR, or execution handoff occurred.

## 9. Final authenticated browser validation after implementation

1. Recheck current source and build; use the existing authenticated local environment and an already configured Department. Do not change shared settings to manufacture a positive case. Reload after the build and wait for CSS transitions to settle.
2. With a valid catalog, open the shared menu. Capture the screenshot-shaped regression with ordinary Sprint rows and both Board scopes. Select each by pointer and by keyboard. Confirm menu closes, selected label updates, focus returns, saved ordinary identity remains unchanged and the correct ready/loading/setup/error presentation appears.
3. In the affected missing-authority environment, both scopes must show the explicit Jira setup state, with **zero strict requests and zero ordinary fallback loads**. Settings read-only values and resulting explanation must agree. No authority bypass counts as success.
4. In an existing authorized configured environment, verify one real `scope=component` and one `scope=all_work` request with no `sprintId`, actual validated stream terminal, and settled cards/counts. If none is available, record positive authenticated loading as unverified; synthetic success is not a substitute.
5. Verify ordinary Sprint click/keyboard selection and selected-scope requests in all five modes; test Board/sibling round trips, group changes, config refresh and explicit retry. Record Product/Tech request counts separately and confirm no duplicates or unintended hidden loads. Preserve applicable Planning/Scenario dirty-state and mode eligibility behavior.
6. Capture settled main and compact screenshots: open menu, selected Component, selected All work, loading configuration, missing authority, failed config with retry, and recovered ordinary Board. Assert menu stacking above Board/epic headers, control/icon geometry, focus visibility, no clipping, and one interactive selector panel. Inspect the images. Keep real screenshots/identifiers out of committed fixtures and documentation.
7. Recheck the diff, test/build results and plan state. Keep `EXEC-*` until implementation is verified and accepted/merged. No publication is part of this plan.

## 10. Implementation outcome and verification — 2026-09-14

**Outcome:** Implemented, verified, accepted, and merged into `bugfix/board-progressive-loading` as `22c5d677056d16a65afa8fd17a00d9808b417971`. The production change remains frontend-only. Task 5 adds acceptance/safety coverage, documentation, the corresponding legacy-entrypoint budget record, and one evidence-driven Project Track correction: explicit shared-Sprint commitment synchronizes its source-only range and performs one forced current reload even when matching frontend source caches are warm. The post-review fix adds a per-resource transaction fence around Board-affecting Settings saves, preventing older or concurrent config/group reads from applying partial or stale accepted authority between sequential writes. A current-Sprint commitment repairs a divergent range once; an already matching reselect remains a no-op. It changes no backend production contract, Sprint catalog implementation, authority source, owner, stream bound, analytics event, Scenario compute, or saved-setting behavior.

**Acceptance evidence:**

- The five-mode pointer/keyboard matrix, closed/future eligibility, exact Project Track source-only POST bodies/counts and `refresh` marker for both selected Sprint ids, prewarmed range/per-Sprint cache bypass, divergent-range repair, matching-range no-op, task-backed Statistics, and the explicit Scenario compute boundary pass.
- Delayed, unavailable and failed Board configuration remain independent from ordinary Sprint choice in every mode. The parameterized 22-cell Board matrix covers both scopes against saved projects, saved source Board, missing authority/columns/membership, Team-only, Components-only, pending/error, unsupported, and missing-Department states. Every cell asserts the selected trigger label. Ready cases produce exactly one matching terminal stream request without `sprintId` and render its authoritative terminal card; blocked cases assert the exact reason, zero strict requests, and an unchanged ordinary fallback count.
- Strict/ordinary/mode round trips, held ordinary lanes, reselects, rapid scope changes, configuration and Department revisions, saved-authority changes, failed-read recovery, late generations and global configuration/stream 401 locking pass without duplicate or replayed loads. Config and stream `401` cases inspect the analytics sink, attempt the selector by pointer and keyboard containment after lock, and prove neither that attempt nor delayed completion emits a selector event or request.
- Controlled workspace and Department saves hold stale successful `/api/config` and `/api/groups-config` reads across sequential mutations and commit. Those reads cannot replace accepted projects, source Board, Department revision/content or Settings drafts; cannot trigger a false conflict/partial save; and cannot reactivate strict or ordinary work. Exactly one replacement strict generation begins only after current post-save config acceptance.
- Existing backend authority, access, unsupported-profile and workspace-isolation tests remain unchanged and green. No backend production file changed.

**Task 5 test-first record:** The initial Task 5 mode, Board, round-trip and race additions were largely regression evidence after Tasks 1–4. The first 43-case focused run passed 36 cases; seven fixture assumptions were corrected without production edits. The first combined campaign's six progressive failures were likewise an obsolete test-only DIV/`aria-disabled` contract and were corrected while preserving historical-revision coverage. The first evidence review then produced a genuine four-case Project Track RED: expected statistics-source count 2 versus received 1 after selecting Sprint `34624`. The initial correction synchronized start/end only for a changed ordinary Sprint. Quality review exposed two remaining gaps with another six-case RED: five explicit-change cases POSTed without `refresh=true`, so cached data could still satisfy them, and the divergent current-Sprint case stayed at one request instead of two. The minimal follow-up arms the existing force-refresh/nonce path for an explicit changed-Sprint commitment or divergent current-Sprint repair only. All six now pass, including a controlled return to a prewarmed range/per-Sprint cache and an already-matching no-op. The strengthened 22-cell Board matrix and two analytics-negative auth-lock cases pass. Auth assertions were corrected after runtime showed the locked app is `aria-hidden` rather than exposing an `inert` attribute; the final cases prove accessibility-tree removal, modal pointer interception, focus containment, and an empty event/request sink. Infrastructure launch denial and fixture-only failures are not counted as behavior REDs.

**Post-review save/read fence test-first record:** The controlled workspace RED released a stale successful config snapshot between sequential writes and observed two Component requests where one was required. The controlled Department RED released a stale successful groups snapshot after commit and reopened Settings with the old `To do` column instead of `Group fence backlog`. The fence invalidates both pre-save generations and reads begun during the transaction, while the authoritative group-save response and designated post-save config read retain their existing acceptance roles. A Settings compatibility RED then showed the explicit Use latest replacement path needed to preserve fallback drafts/baselines independently; the narrow split now passes both replacement and interim-edit cases.

**Verification:**

- `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_eng_board_routes tests.test_eng_board_service tests.test_eng_board_source_guards tests.test_eng_board_basic_compat tests.test_codebase_structure_budgets` — 108 passed.
- Focused correction checks — Project Track source/body/cache/range matrix 6 passed after the recorded 6-case RED; complete Task 5 selector matrices 48 passed, including the 22-cell Board authority/readiness table and two config/strict-stream auth-lock interaction cases.
- `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_board_stream.spec.js tests/ui/eng_board_progressive_loading.spec.js --workers=1 --timeout=1800000` — 163 passed serially in 3.6 minutes, including all 22 scheduling cases. Chromium required the approved local process/IPC run. The runner warned that `NO_COLOR` was ignored because `FORCE_COLOR` was set.
- `npx --no-install playwright test tests/ui/settings_unified_save.spec.js tests/ui/jira_field_picker_read_race.spec.js --workers=1 --timeout=1800000` — 36 passed, covering unified save/conflict/auth and delayed fallback field reads.
- `npm run test:frontend:unit` — 1,384 passed, zero failed or skipped. Node emitted the existing module-type warnings for `.js` ES modules in a package without `type: module`.
- `npm run build` — passed; esbuild retained the existing 1.1 MiB dashboard bundle-size warning and regenerated `frontend/dist/dashboard.js` plus its source map from the scoped source correction.
- `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests` — 1,797 tests, 9 skipped at Task 5 `b5addfa`. The selector/readiness growth, Settings save/read fence and evidence-driven Project Track corrections are documented in `tests/test_codebase_structure_budgets.py`; the focused final structure check passed at the explicit 18,078-line budget. Existing negative-path logs and static-file `ResourceWarning`s remain warnings only.
- `git diff --check` passed, and the final committed-revision `git diff --name-status 6aaf9da..HEAD` audit accounted for all 30 changed paths in the file map.

**Visual and live validation:** Settled synthetic screenshots for the main and compact selector, Component, All work, missing-authority setup, strict error and recovered ordinary Board were inspected; the panel remains singular, readable and unclipped in those captures. No local server was available on port 5050, so no existing authenticated environment could be validated without starting/changing shared state. Positive authenticated Component/All work streams, live request counts, and authenticated loading/error/recovery screenshots remain explicitly unverified; synthetic success is not treated as a substitute. No real identifiers or screenshots are committed.

## 11. Plan review and residual risks

Self-review used the repository plan-review prompt: source-of-truth callers, backend authority, workspace/config ownership, unsafe-route boundaries, dirty/conflict flows, request concurrency, release gates and verification were checked against the cited sources. Every implementation path is listed; backend interfaces are read-only. Existing no-op tests must change their UI assertions, not their unauthorized-load protections.

Residual risks: live capability/raw configuration response provenance remains unknown; actual saved authority may require an operator configuration decision outside this fix. Positive authenticated cross-sprint success and live performance remain unverified. The acceptance matrix now proves changed Department authority invalidates the current generation and counts mode-specific task/source requests by their real lane contracts rather than an invented single-request model.
