# Dashboard Scenario And Settings State Extraction Implementation Plan

> **Status:** Execution in progress, revision 5 (2026-10-02), tracked by [issue #220](https://github.com/Juce-me/jira-execution-planner/issues/220). PR-1 landed revision 3 in [PR #219](https://github.com/Juce-me/jira-execution-planner/pull/219), merge `c9ca8eff`, on 2026-10-01. A fourth readiness review reproduced gaps in nested interface checks, conservation of already-extracted hooks, ST3 effect order, and PR0 characterization/parity captures; revision 4 corrected them. Revision 5 closes six further findings: identity-safe DOM normalization, recursive render/getter timing review, the post-ST5 size milestone, dependency-aware rollback, the permission fix's unused getter, and explicit 11-section/10-snapshot parity. It also requires owner/interface/aggregate budgets, a remaining-App responsibility inventory, and a reproducible runtime-work baseline before extraction. The original source ranges and dry-run measurements remain historical evidence from `89ffe589`; PR0 must refresh them against its latest `origin/main` base. Operator decisions recorded 2026-10-02: D12 is acknowledged; G1 proceeds with the planned split verified against current repository boundaries; G2 preserves the current save sequence and requires a separate fail-closed permission fix before ST5. Execution authorized in chat on 2026-10-02; PR0 P0-1 (`4149b615`) was validated by the operator on 2026-10-02; P0-2 is implemented and awaiting operator validation on the same `ffeafb0ea3f37dd17a5d910595c20e1493166c5c` base. Each rung still requires operator validation and publication remains separately gated. Supersedes the "Extract Scenario Planner ownership" and "Move settings state/actions behind feature hooks" rows of `FUTURE-codebase-operability-improvements.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute one commit at a time under the validation protocol in section 5. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the Scenario Planner and Settings state, effects, handlers, and JSX out of the single `App()` function in `frontend/src/dashboard.jsx` into feature-owned hooks and container components, with no user-visible or contract change, lowering the `dashboard.jsx` line budget in every slice.

**Architecture:** Hooks are called unconditionally from `App()` and receive explicit inputs. Later values use per-render getter closures only in handlers/effects, under D1; no latest-value ref is introduced. Scenario moves first as one verbatim hook (its code is contiguous, so effect order is preserved by construction) and may then be split inside `frontend/src/scenario/`. Settings is interleaved with other code, so it uses layers: shared-config primitives hoisted first, then per-section hooks (state layer at the existing state lines, behavior layer where its inputs exist, and separate effects layers where ordering requires them), then the save orchestrator. Pure computation moves to plain modules with Node unit tests. JSX moves to stateless container components and is checked by DOM parity and visual checks. Hook-statement moves are checked by `check_move_conservation.mjs` against both revisions (section 6), with every residual reviewed explicitly.

**Tech Stack:** React 19, esbuild (classic JSX transform), Node 20 (`fnm exec --using 20`), `node --test`, Python `unittest`, Playwright (Chromium; headed Firefox/WebKit only when a commit touches glyph or form-control geometry).

## Global Constraints

- Behavior-preserving: no route, payload, response-shape, cache-key, `Server-Timing`, startup-request-count, sticky-order (`--sticky-scenario-z: 60`), analytics, or visual change. The separate G2 permission fix is the sole approved behavior correction: invalid/missing edit grants must deny administrator-section editing before ST5; valid-response behavior remains unchanged.
- No new runtime or test dependency in `package.json`. The lint tooling in section 6 installs pinned versions into gitignored `tmp/lint`.
- No `fetch(` or `/api/` literal outside `frontend/src/api/` (`tests/test_frontend_api_source_guards.js:196-217`).
- Generated `frontend/dist` is never hand-edited; every source commit includes the rebuilt dist (Flask serves it, so the operator validates the committed build).
- No agent or tool branding or attribution trailers in branches, commits, or PRs. No local absolute paths, real emails, or real Jira data in committed files.
- Read the postmortems relevant to the area before each slice: MRT003, MRT005 (Scenario conflict detection), MRT006, MRT007 (TDZ after bundling), MRT008, MRT009 (sticky layering), MRT010 (startup fan-out), MRT011 (EPM settings UX, for ST2), MRT016 (plan file-map drift), MRT025 (publication).
- Read `backend/security/CONFIGURATION_OWNERSHIP.md` before every `ST*` PR. Settings load/save functions stay per-render closures (section 4).

---

## 1. Evidence (measured 2026-10-01 at `89ffe589`)

| Fact | Value |
| --- | --- |
| `frontend/src/dashboard.jsx` | 18,203 lines, 1,089,792 bytes; `App()` runs 370-18196 (`return` at 15024) |
| Hook calls inside `App()` (AST) | 323 `useState`, 136 `useEffect`, 281 `useMemo`, 58 `useCallback`, 153 `useRef` |
| Other frontend source | 193 files, 38,133 lines (already extracted) |
| Budget | `tests/test_codebase_structure_budgets.py` caps `dashboard.jsx` at 18,213 |
| Growth | 15,022 lines on 2026-05-28; 104 commits touched the file since 2026-06-01 (22 since 2026-09-01) |
| Scenario | 29 `useState`, 27 `useRef`, 57 `useMemo`, 18 effects in 9156-11589 plus those inside `useConnectionScenarioRecovery`; code at 1081, 5662-5686, 7262-7794, 8107-8112, 9137-11601; JSX 16338-17214. Eight other effects mention Scenario and correctly stay in `App()` (2387, 6367, 6497, 6503, 6510, 6648, 7118, 7860). 7262-7794 is 28 arrow-function constants plus the literal `SCENARIO_PRESENCE_TTL_MS` at 7345 |
| Settings | about 140 `useState`, 40 `useRef`, 32 `useEffect`, 45 `useMemo`, interleaved with non-Settings code between 489 and 5660; JSX 17457-18166 |
| Dry-run result (reviewers, scratch copies) | Historical SC1 + SC2: lint 0 errors, both bundles build, all 136 effects keep their order, `dashboard.jsx` 18,203 to 15,133 lines (hook 3,227 lines, container 213). Historical ST1-ST4 dry runs were gate-clean; revision 4 adds the ST3 ordering correction that lint alone did not prove |
| Python baseline | `Ran 2006 tests ... OK (skipped=25)` (section 6 command) |
| Node baseline | `node --test tests/test_*.js`: 1529 pass, 0 fail |
| Lint baseline (revision-3 config/checker) | Historical: 0 errors, 119 `no-unused-vars` warnings (149 without the two React-scope rules); dashboard-only checker: 16 destructure sites, 0 enforced problems. These are not acceptance counts for the revised recursive checker |
| Full Chromium `tests/ui` at PR-1 head `831acf7a` | PR #219 reports 956 passed, 3 skipped, 1 failed; the named onboarding timeout passed 3/3 isolated reruns. This is historical publication evidence, not a failure exemption for later slices |

**PR0 execution-base refresh (2026-10-02).** Fetched `origin/main` is exactly `ffeafb0ea3f37dd17a5d910595c20e1493166c5c`; PR0 branch `improvement/dashboard-extraction-tooling` starts there with no historical issue-branch commits. The reviewed local revision-5 plan/index amendments reapplied cleanly. No open PR touched `dashboard.jsx` at branch creation. Its source is 18,434 lines and its existing structure ceiling is 18,434. Node 20.20.0 and the checkout's `.venv` interpreter run the checks. The upstream instruction template remains 2026-09-08. Fresh gate/interface/owner measurements are recorded below as P0-1 completes; historical counts above are not ceilings.

Fresh unchanged-source suite evidence: `fnm exec --using 20 node --test tests/test_*.js` passed 1,726 tests, zero failures/skips, in 3.747 seconds. The section-6 environment-isolated `.venv/bin/python -m unittest discover -s tests` passed 2,111 tests with 29 skips in 158.643 seconds. `fnm exec --using 20 npm run build` and `make verify-dist-clean` passed with no generated diff. The fresh full Chromium run (`fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4`) passed 1,197 tests with 3 skips and zero failures in 10.1 minutes. P0-5 must refresh these baselines after characterization and record the required runtime-work samples. Initial sandbox browser launch failed at macOS Mach-port registration before any app assertion; the authorized run replaces that environment-failed attempt, which is not a product failure waiver.

Current range boundaries were matched to unchanged historical source lines, then checked in the current source. These are navigation evidence only; each slice still re-locates and records exact first/last statements before moving:

| Area | Current lines at PR0 base | First textual anchor |
| --- | --- | --- |
| App | 382–18427 | `function App() {` |
| Settings interleaved cluster | 505–5703 | `const [epmConfigDraft, setEpmConfigDraftState] = useState(createEmptyEpmConfigDraft());` |
| Scenario state | 1115–1115 | `let scheduleScenarioEdgeUpdate;` |
| Scenario issue refs | 5705–5729 | `const matchesScenarioSearch = (issue, query) => {` |
| Scenario draft handlers | 7330–7862 | `const fetchScenarioCsrfToken = () =>` |
| Scenario Team inputs | 8179–8184 | `const scenarioTeamIds = React.useMemo(() => {` |
| Scenario planner start | 9209–9227 | `const scenarioRawIssues = scenarioData?.issues || EMPTY_ARRAY;` |
| Scenario planner cluster | 9228–11661 | `useEffect(() => {` |
| Scenario planner end | 11662–11673 | `if (!scenarioEpicFocus) return;` |
| Scenario JSX | 16641–17517 | `{selectedView === 'eng' && showScenario && engWorkspaceConfigured && (` |
| Settings JSX | 17688–18397 | `{showGroupManage && (` |

P0-1 measurements and evidence (production source unchanged):

| Check | Fresh result |
| --- | --- |
| App boundaries and React hooks (Espree) | `App` 382–18427; return 15313–18426; 327 `useState`, 137 `useEffect`, 283 `useMemo`, 59 `useCallback`, 164 `useRef`, 1 `useReducer` |
| Complete pinned tooling dependencies | `eslint@9.39.5`, `globals@14.0.0`, `eslint-plugin-react@7.37.5`, `eslint-plugin-react-hooks@7.1.1`, `espree@10.4.0` installed in ignored `tmp/lint`; every version checked |
| Extraction gate | 0 ESLint errors; 120 warnings (fresh ceiling, no pre-existing enforced problems baselined); 16 destructures across 41 recursively reached modules; 0 enforced, 34 informational interface diagnostics |
| Frozen owner inventory | 41 modules; 32 interfaces; 20 digest-bound reviewed dynamic/forwarded contracts; 475 Scenario lines, 9,803 Settings/EPM lines, 10,278 unique owner lines, 28,712 App-plus-owner lines; exact measured ceilings, no transfer/scaffolding allowance |
| Tooling controls | Original 21 controls plus 49 added budget/schema/registration/alias/ledger/timing controls; all 70 expected results observed |
| Budget unit checks | `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: 2 tests pass |
| Complete current-hook conservation | `check_move_conservation.mjs --base ffeafb0e` with connection recovery, admin gate/access, group visibility, Jira pickers, Team catalog, EPM hooks: 1,698 statements at each revision; zero removed/new residuals; identical order across 155 effects |

The dependency bags and source-digest reviews are explicit inventory, not an exemption from later move review. Caller scans cover imported and same-file hook/container uses, including the seven local component sites found during review. The sole passed getter (`openSettings`) captures later `openGroupManage` and is called only inside the existing admin-gate effect. Its source proof and unchanged dependencies are in the manifest. Other transitive invocation phases still require manual review at each move. DOM parity captures, runtime-work characterization and new behavior characterization tests remain P0-2 through P0-5; no such evidence is claimed for this tooling-only rung. Analytics impact: internal tooling adds no user-visible interaction or event, so no taxonomy or transport change is needed.

Additional current anchors: `scenarioLoading` 1032; `registerScenarioIssueRef` 5722; `runScenario` 7595; `loadGroupsConfig` 2653; `openGroupManage` 2717; `saveGroupsConfig` 3672; `retryFirstRunConfiguration` 5464; `loadConfig` 6803; `activeDepartmentSettingsTab` 14956. G1 preflight found no material source contradiction; the required post-SC2 split review remains pending. G2 is unchanged: current permission expression at 729 is preserved until the separate approved fix.

Line numbers are as of `89ffe589` and drift after every merge. Every range is also identified by a **textual anchor** (the first and last statement text); re-locate by anchor with `rg -n`, never by number alone. Before moving a range, record its first and last statement text in the PR description. Ranges come from read-only scans and two review rounds on 2026-10-01; each commit re-verifies the ranges it moves.

Prior slices (`DONE-codebase-operability-*`) moved presentational components and pure helpers. None moved `App()` state, which is why this plan adds the commit ladder, the DOM parity check, the lint gate, the conservation check, and the guard ledger.

## 2. Scope

In scope: Scenario (state, draft lifecycle and history, presence/locks/realtime, drag/undo, layout/lanes/edges/focus/tooltips, JSX) and Settings (shared-config sections, EPM settings, Team Groups/Labels/board layouts, first-run flow, permissions, shared-config bootstrap and save, modal shell, JSX), the tests and guards that read `dashboard.jsx` as text, and the docs listed in section 13.

Out of scope: ENG Catch Up/Planning/Stats/EPM/Board state, backend, CSS, contracts, new dependencies, analytics events, visual changes.

## 3. Decisions

Settled by design:

- **D1 Layers where needed.** A hook cannot receive a value declared later in `App()` (TDZ at first render). Wherever a hook's inputs are not all available at its state lines, split it into a state layer called at the existing state lines and a behavior layer called where its inputs exist. An effect that would cross another effect writing the same state/ref gets a separate effects layer at its original position (ST3's selection normalization is mandatory). A cycle between layers is resolved by a getter closure (`() => value`, which keeps per-render capture), never by a ref. A getter may be called only from handlers and effects, never during render (a render-phase call is a TDZ error the gate cannot see), and a verbatim `useCallback` keeps its dependency array when its body starts calling a getter.
- **D2 Always mounted.** Hooks are called unconditionally from `App()`. Dirty drafts and mount effects must survive mode and tab changes. Container components are stateless.
- **D3 Strictly sequential.** One PR at a time, each merged before the next branch is cut; start-of-slice preconditions and the rebase recipe are in section 5.
- **D4 Quirks move verbatim** (section 4). They are preserved, not fixed.
- **D5 No new test dependency.** No jsdom. Effect-heavy behavior is proven by Playwright plus the DOM parity check; pure code gets Node unit tests; hook defaults get server-render probes.
- **D6 Dead code is deleted (operator decision, 2026-10-01).** The first source commit of each slice deletes the never-read declarations of its cluster (lists in the PR sections). Only inert declarations are deleted: unread `const`/function/ref declarations, unread `useState` pairs whose every setter call is batched with another state update in the same synchronous block (the commit message lists each removed setter call and why it is batched; otherwise leave the pair), and imports orphaned by the deletion.
- **D7 Gates (operator decisions, 2026-10-02).** G1 is approved: execute the planned Scenario split after verifying its boundaries against the current repository, and retain that design. G2 is conditionally approved: preserve the current imperative save sequence and complete the separate permission fix below before ST5. These strategic choices do not need repeated approval; the per-commit validation stops and publication approvals remain.
- **D8 Commit-gated execution (operator decision).** One commit at a time; after each commit the executor stops, reports the automated results, and gives the operator a validation scope; the next commit starts only after the operator confirms (section 5). The publishing unit stays one PR per slice, assembled from commits the operator has validated. This reading of "one commit at a time" is an assumption; correct it if you meant otherwise.
- **D9 `ScenarioView` takes the planner and the container.** The JSX block uses 98 `App()` bindings: 65 returned by the planner hook, 30 from the SC1 container (data, lane mode, edit mode, draft metadata, layout, tooltip, refs and their setters), and 3 scalars. `ScenarioView` therefore receives `scenario` (the planner object), `scenarioState` (the container object), and the three scalars `selectedSprint`, `normalizeEpicKey`, `excludedEpicSet`. This is a boundary choice inside the plan's own design (no new state or fetching is introduced); the operator can veto it when reviewing the plan.
- **D10 Hook statements are compared mechanically.** `check_move_conservation.mjs` compares `App()` plus the named owner-hook bodies at both revisions. Pass the complete affected hook-file set, including existing callers and newly created/deleted files; both effect sequences are expanded recursively from their own revision. Unchanged statements cancel out; every remaining statement is printed in full and itemised in the commit message. Residuals require human review, not merely a zero exit code. The original SC1 + SC2 dry run had 5 removed and 12 new statements (call sites, destructures, returns, and seam edits); that historical result does not prove later splits.
- **D11 Permission correction before ST5 (operator decision, 2026-10-02).** The current expression `!settingsAdminOnly || userCanEditSettings` can grant administrator-section editing when `Boolean(config.settingsAdminOnly)` receives a missing flag, even without an explicit user grant. The operator chose a separate fix rather than preserving this deviation. Require `userCanEditSettings === true` as the editing authority, including loading, bootstrap, and post-save refresh; absent or mistyped grants deny editing. Successful `/api/config` responses include both flags (`settings_routes.py:699,708`), so preserve every valid backend-authorized journey. Storage errors return 503 and must not grant editing. Department-group and private EPM rights remain independent. ST5 extracts the verified fix verbatim.

- **D12 History rewrite and the transaction (operator acknowledgement, 2026-10-02).** The operator accepted D12 in chat ("d.12 seems logical"). During approved execution, local rung commits are outside the publication transaction; that transaction runs at R6 before push/PR creation. The executor may amend the latest unpublished rung after failed validation and rebase unpublished slice commits onto a moved `main`, preserving scope and rerunning verification at the new head. This does not authorize rewriting pushed history, changing the approved scope, pushing, creating a PR, or merging; those still require the approvals in section 5/8.

Gates (operator go/no-go):

- **G1 — approved 2026-10-02.** Before SC3, verify the planned partition against current source and SC2 results. Proceed with the documented sub-hooks and the same flat external interface; do not reopen the split-vs-single decision or introduce a different architecture. Stop if evidence exposes a material contradiction requiring a design change.
- **G2 — conditionally approved 2026-10-02.** Complete and merge the separate permission fix below after ST4 and before ST5, verify it on ST5's actual base, then proceed with the current imperative save sequence. ST5 R0 documents the selected interface and current layering; its ordinary validation stop remains. A table-driven save rewrite or preservation of the missing-grant deviation is not approved.

## 4. Preserved quirks and invariants

Every commit re-checks the rows that apply.

| Area | Invariant |
| --- | --- |
| Scenario layout | `let scheduleScenarioEdgeUpdate;` (1081) is assigned at 11483 and sits in the layout effect's deps (10884), so that dependency is always `undefined`. It moves in SC2 into the hook body, placed before the first statement that reads it (the earliest render-phase read is the deps array at 10884; the dry run put it right after the container destructure); it is never a parameter, never part of the state container, and never replaced with `useCallback`. Declaring it at the assignment line is caught by `no-use-before-define`. |
| Scenario closures | Drag effect deps `[scenarioDraggingIssueKey]` (9697) capture `releaseScenarioIssueLock` and draft ids at drag start; poll (9297) and SSE (9375) deps include `scenarioDraftLastEventNumber`, heartbeat (9323) does not; `scenarioIssuesByLane` omits `scenarioLaneForIssue` from its deps (10465); render-phase ref writes at 9187-9188 and 9478. `scenarioUndoVersion` is a re-render trigger only (its value is never read): keep its `useState`. |
| Scenario mount | `loadUiPrefs()` forces `showScenario=false`; the cluster fires no request on mount (the 7860 effect returns when `configRefreshNonce === 0`); startup `POST /api/scenario` count is 0. The 7860 effect reads `runScenario` inside a deferred closure and omits it from its deps; that stays valid when `runScenario` comes from a hook called later. |
| Scenario auth | Poll, heartbeat, SSE, and the three Scenario keydown handlers (9742, 10011, 11597) check `readPendingAuthenticationRequired()` or listen on `AUTH_REQUIRED_EVENT`; `window.SCENARIO_DRAFT_SSE_ENABLED` gates SSE. |
| Scenario shared | `perfCountersRef` is written at 10560, 10812, 10840, 11262, 11487, 11496 and read at 2356. `scenarioStartedRef` is owned by `useConnectionRecovery`. `BACKEND_URL` (338), `EMPTY_ARRAY` (316), and `EMPTY_OBJECT` (318) are module constants of `dashboard.jsx`: pass them to hooks as parameters (identity must not change); do not duplicate them. |
| Scenario sticky and lanes | `.scenario-fullbleed` stays a direct child of `.container` with no wrapper DOM. In Team lane mode with All teams selected, the effect at 10759-10775 collapses every lane on first render; `.scenario-epic-bar` elements render only in Epic lane mode (`scenarioEpicBars` returns `[]` otherwise, 10981-10982). |
| Settings mount | The mount effect at 2136 (`loadConfig()` + `loadGroupsConfig()`) stays in always-mounted `App()` with its first-render closure until ST5. The `[showGroupManage]` open effect at 2184 snapshots values at open time; its deps do not change. |
| Settings closures | `loadConfig` has different identities today: the mount effect uses the first-render closure; the call sites at 4283 and 14873 use per-render closures. `saveAllSettings`, the hotkey effect (deps at 4324 include `saveAllSettings` and `requestCloseGroupManage`), and `loadConfig`'s dirty snapshot depend on per-render closures. Settings load/save functions stay per-render closures; hooks must not wrap them in `useCallback` or a latest-ref, and a verbatim move of a `useCallback` with fixed deps (for example `retryFirstRunConfiguration`, 5421) must not add a getter to its deps. |
| Settings draft snapshot | `settingsDraftSnapshotRef.current = {...}` is assigned during render at 810-821 and reads the drafts of the priority-weights, projects, board, capacity, and field-picker sections (10 keys; there are 11 admin sections). It stays a render-time assignment in `App()`; section hooks return a plain `draftSnapshot` value. All section hooks are called before it. |
| Settings save order | Admin sections save sequentially: `projects` (`POST /api/projects/selected`), `priorityWeights` (`/api/stats/priority-weights-config`), `board` (`/api/board-config`), `capacity` (`/api/capacity/config`), then the five field configs (`/api/{sprint-field,parent-name-field,story-points-field,team-field,delivery-owner-field}/config`), then `issueTypes` (`/api/issue-types/config`), then `adminAccess.save()` (a sequential await at 3772 that sends `POST`/`DELETE` to `/api/admin/users/{id}/admin-grant` with no `baseRevision`; only the grant requests inside it run in parallel, `adminApi.js:15-24`), then the groups POST (`/api/groups-config`, `baseRevision`, via `buildSharedGroupsPayload`). `projects`, `priorityWeights`, `board`, `capacity`, and `issueTypes` commit the revision internally; the field saves use `commitSharedConfigRevision(await saveXFieldConfig(sharedConfigRevisionRef.current))` (the five save functions live in `frontend/src/settings/useJiraFieldPickers.js:183-215`). Outside first-run, personal preferences post inside `saveGroupsConfig` (3856), then a `GET /api/config` refresh runs (3882), then EPM saves (4094). In first-run the preference POST follows EPM (4120). EPM saves independently of every shared revision and conflict state. `saveProjectSelection` (5035-5049) sets `groupSaving` false in its `finally` mid-sequence. |
| Settings bootstrap vs save | The post-save refresh (3882-3897) updates a different flag subset than bootstrap: it omits `setUserIsToolAdmin`, `setPerformanceAdminAvailable`, `setJiraUrl`, `setGroupQueryTemplateEnabled`. `setPerformanceAdminAvailable` at 6819 sits before `await completeAuthRecovery`, outside 6861-6949, and stays where it is. `loadConfig`'s fallback branch (6917-6948, when `sharedConfig` is absent) fetches the shared-config sections at mount and stays as is. |
| Settings ownership | `userCanEditSettings` and `userCanEditEpmConfig` default `false`, set only with `=== true`; `settingsAdminOnly` defaults `true` (but see D11). Admin tabs need `canEditSharedConfiguration`; the Settings EPM tab needs `canEditEpmConfiguration`. The Access tab shows when `adminAccessAvailable = !adminUserManagementAvailable || userIsToolAdmin` (694); in Basic mode it shows an informational card. 409 keeps the user's draft; 401 delegates to the global auth gate and is never replayed. EPM data stays in the owning user's private saved view and never enters workspace configuration. Department groups, labels, memberships, exclusions, and board layouts are shared once per workspace; stars, favorites, visibility, and active group are private, and in `groupsConfig.source === 'workspace_db'` mode never touch `defaultGroupId` (the legacy non-DB `toggleDefaultGroupDraft` at 3585 does write it). |
| Settings lazy fetch | With a `sharedConfig` object in `/api/config`, nothing in the shared-config sections fetches before the modal opens. The EPM sub-goals effect at 2765 fetches on the EPM view without the modal and stays. `useAdminAccessSettings` stays gated on `available && active`; the team lifecycle stays gated on the modal being open. |
| Startup | `tests/ui/codebase_structure_smoke.spec.js:1236-1259`: exactly one each of `GET /api/config`, `/api/version`, `/api/groups-config`, `/api/sprints`; zero for `projects/selected`, `board-config`, `capacity/config`, `priority-weights-config`, the field configs, `issue-types/config`, `/api/teams`, `/api/teams/all`, and `POST /api/scenario`. That spec asserts only four of the five field endpoints: PR0 adds `delivery-owner-field/config`. |

## 5. Execution model: commit ladder, operator validation, and drift

### Commit ladder

Every slice is a sequence of commits. Rungs a slice does not need are omitted.

Every source slice's file map also includes the canonical `scripts/extraction_lint/owner_budgets.json` update and its budget checks; a named slice map does not exempt these common files. The parent owns this shared file while subagents edit disjoint feature files.

| Rung | Contents | Operator validation |
| --- | --- | --- |
| R1 Dead code | Delete the slice's inert never-read declarations (D6) and the one guard pin that names a deleted declaration, and nothing else; lower the lint ceiling (`run.sh` default) if warnings drop. | The slice's smoke scope. |
| R2 Characterization | Playwright tests, fixture data, and parity captures of **existing** behavior; they pass on the unmodified source. No source change, and no test that imports a module that does not exist yet (unit tests of an extracted module are written in the R4 that creates it). Oracle fixture data for a function that will move is JSON generated from the current code, not a test. | Review the diff; no app check. |
| R3 Prep | Hoists that make a later move legal (a pure primitive moved above the state lines; a pure module-level helper moved to a module). | The slice's smoke scope. |
| R4 Move | Before the move, freeze the current-base dry-run owner/interface/aggregate ceilings and getter-phase ledger under section 6; record them in the preflight report at the preceding validation stop. Include those ceilings in the move commit; do not derive them from its final diff. One hook or component per rung: the verbatim move; the tests of the new module; the re-pointing of every guard the move breaks (section 7); removal of imports and destructured names the move orphaned; the rebuilt `frontend/dist`. After R4 the whole Node and Python suites are green. | The rung's validation scope. |
| R5 Ratchet | Dashboard and registered owner/aggregate/interface ceilings down to measured values **within the frozen checkpoint** (`tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/owner_budgets.json`; a slice that does not change `dashboard.jsx` states "no dashboard budget change"). The next approved move has a new checkpoint accounting for transferred ownership under section 6. Ratchet the lint-ceiling default in `scripts/extraction_lint/run.sh`; update `docs/ontology.md` and this plan's status table. Test, script-constant, and docs edits only. | Review the diff; no app check. |
| R6 Publish | After the last R5: the Node and Python suites, the committed-revision build with `make verify-dist-clean`, and the full Chromium `tests/ui` run at the exact head; the publication transaction (the section 8 steps apply unchanged), push, PR. | Operator go, then the PR page. |

### After every commit the executor

1. runs the commit's automated checks (section 6) and reads every result,
2. runs `git show --stat HEAD` and `git status` and reads them (the commit contains exactly the intended files; a rename that shows `| 0` has no content change),
3. for R4, runs `check_move_conservation.mjs` and puts every residual line in the commit message,
4. reports to the operator: commit SHA, files changed, automated results, and the **Validation scope**,
5. **stops** until the operator replies that the commit is validated.

### Failed validation, push, and merge

- If the operator finds a defect in the **latest unpublished commit**, the executor may amend it under the recorded D12 acknowledgement, rebuild the dist, rerun the checks, and report again. Scope changes and rewriting pushed history still require separate authorization.
- A defect in an **earlier** commit, or in a commit that was already pushed, stops the executor: state the defect and ask whether to amend by rebase or to add a fix commit (root `AGENTS.md` section 10 forbids rewriting history without authorization).
- "Validated" is not authorization to push. The push happens only at R6, after the full UI run, on the operator's explicit go (one publication go per PR). The operator merges; the executor never merges.

### Dependency-aware rollback

Record each slice's exact merged SHA and direct consumers: imports, hook calls, props, moved guard owners, and data/effect interfaces. An earlier slice cannot be reverted independently after dependent consumers merge. Before rollback, identify its transitive consumer set and present the exact proposed commits, paths, and retained fixes for operator approval. Revert dependent consumers in reverse dependency order before their prerequisite, or prepare a forward repair preserving the current interfaces. For example, undoing SC2 after SC3/SC4 must account for both SC3's sub-hooks and SC4's planner interface; undoing SC3 alone may preserve that flat interface if all checks prove its consumers remain valid. Do not mechanically revert every later PR or rewrite published history.

The G2 fail-closed permission fix is retained across extraction rollback. ST5's rollback base must include it. If restoring earlier Settings code conflicts with the fix, reapply its minimal equivalent and regression tests before publication: explicit boolean editing grant on loading/bootstrap/post-save paths, independent Department-group/private EPM rights, and zero administrator-section POSTs for denied grants. Record the retained fix SHA or equivalent patch. Never publish a rollback that restores the missing-grant deviation.

At the resulting head, rebuild dist and run affected lint/interface/budget checks, conservation with explicit restored/deleted owners, parity and smoke tests, the required full suites, and section 8 publication verification. Rollback requires explicit operator authorization; reversibility is not publication approval.

### Drift and rebase (feature work keeps touching `dashboard.jsx`)

- Start-of-slice preconditions: read the instruction chain, the relevant postmortems, and the `docs/ontology.md` entries the slice touches; run the `docs/plans/GATE-*.md` sweep (every slice is a plan execution; `GATE-05`, Home write capability, next review 2026-10-05, is not a dependency because no slice adds a Home/Townsquare path); `git fetch origin main`; the previous slice is merged; `gh pr list --state open` shows no open PR touching `frontend/src/dashboard.jsx` (ask the operator to hold such merges while a slice is open); the branch is cut from the latest `origin/main`.
- If `main` moves while a slice is in progress: rebase the unpublished commits; rebuild the dist (a dist conflict is resolved by rebuilding, never by hand); re-measure the dashboard and complete owner/interface/aggregate inventory against the recorded new base, explain upstream changes separately from extraction, and refresh dry-run ceilings with the same accounting before resuming (a rebase is not an automatic growth waiver); recapture the "before" DOM parity directory at the new base; rerun the smoke scope at the new head only; re-locate every range by its textual anchor.
- A slice that stays open longer than a week without a push is rebased at the start of each session.

### Operator prerequisites for validation (confirm once before PR0)

Settings slices ST4 and ST5 also need an account with empty group preferences (first-run) and accounts in the non-admin, editor, and tool-admin roles; where an account is not available, the commit report names the Playwright test that covers that scope instead. The commit under test must be what the local app serves: the checkout holding the commits is the one the app runs from, `npm run build` output is committed, and the app is started the usual way from that checkout. State which configuration you use (Basic/jsonfile local config, or your DB/OAuth dev config). Settings validation saves workspace-shared configuration: use a throwaway workspace or revert each edit afterwards.

### Subagent handoff guardrails

The parent alone manages Git, the canonical budget inventory, integration, and operator stops. Give each subagent an explicit rung, exact base/head SHA, verified file map, permitted edits, and named checks; only independent, bounded tasks run concurrently, with disjoint edited files. Subagents must report changed files, moved anchors, contracts and getter invocation phases, conservation residuals, budget deltas, test commands/results, and uncertainties. They do not start a later rung, publish, alter thresholds, merge, or change the approved design. The parent verifies those reports against the diff and current sources before D8 validation. Use the current repository's boundaries for G1 and preserve the G2 imperative save sequence and prerequisite fix.

### Smoke scopes

- **Scenario smoke (SM-S).** ENG tab, Scenario mode: Run Scenario; bars render. Lane Mode Team (with All teams selected the lanes start collapsed; click a lane label to expand it), then Epic (epic summary bars appear), then Assignee. In Epic mode click an epic bar: the focus indicator appears; press Escape: it clears. Hover a bar: the tooltip shows (also near the right and bottom edge). Edit, drag a bar, see the override count, Ctrl+Z, Exit Edit. Save Draft; open History; close it with Escape. Select group, choose Alternate, Scenario, Run Scenario, then select Default again: note the lane mode and collapse state you left on Default before the first commit; the same must hold after each commit. Connection recovery: with an unsaved override, stop the backend (or block `/api/*`), wait for the server-unavailable banner, restore the backend, click Retry connection: the override is restored once, with no extra write.
- **Settings smoke (SM-T).** Requires a tool-admin/editor account (admin tabs need `canEditSharedConfiguration`; the EPM tab needs `canEditEpmConfiguration`). Open the Settings gear: Departments, Admin, Connections, and EPM tabs and their sub-tabs render. In Departments type a new group name: the Unsaved-changes indicator appears; Save closes the modal; reopen and the name persisted; revert it. Edit again and close: the discard prompt appears.
- Requirements that need two tabs (a forced 409) or DevTools (request counts) are covered by named Playwright tests instead and listed in the commit report.

## 6. Verification tooling and per-commit checks

**Environment.** A worktree has no `.venv`; set `JEP_TEST_PYTHON` to the main checkout's interpreter (`<main checkout>/.venv/bin/python`). Run `npm ci` once in a fresh worktree before the first build. Commands below are plain so they work in bash and zsh; prefix each Node command as shown.

```bash
# Node unit tests (baseline: 1529 pass)
fnm exec --using 20 node --test tests/test_*.js

# Python suite (baseline: Ran 2006 tests, OK, skipped=25). Explicit env so a local .env cannot leak in.
# CI sets only JIRA_AUTH_MODE and CONFIG_STORAGE_BACKEND on Python 3.10 and 3.11; this is a superset.
JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local \
ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' \
"${JEP_TEST_PYTHON:-.venv/bin/python}" -m unittest discover -s tests

# Build and commit the dist with the source change; then, at the committed head, rebuild and prove nothing changed
fnm exec --using 20 npm run build
# ...git add + git commit (source + rebuilt dist)...
fnm exec --using 20 npm run build
make verify-dist-clean            # must print no diff: the committed dist equals a fresh build

# Extraction gate and its negative controls (this section)
fnm exec --using 20 bash scripts/extraction_lint/run.sh
fnm exec --using 20 bash scripts/extraction_lint/negative_controls.sh

# Full UI gate before any push (about 8 minutes; set JEP_TEST_PYTHON in a worktree)
fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4
```

Success criteria are "0 failures" plus the baselines recorded in PR0; absolute counts drift as the repo changes.

### The extraction gate

esbuild does not report an identifier left behind by a move, and `no-undef` alone passed seeded defects in review. `run.sh` runs ESLint (`no-undef`, the React JSX import/scope rules, `no-use-before-define` with `variables:false`, `react-hooks/rules-of-hooks`, and ratcheted `no-unused-vars` warnings), then `check_hook_interfaces.mjs`; either failure makes the gate nonzero. Starting at `dashboard.jsx`, the checker recursively inspects reachable modules under `scenario/`, `settings/`, and `epm/`, using each file's imports and lexical scopes. It checks hook-result destructures (including result aliases), required/accepted first-object-parameter keys, absent object arguments, and nested component props. Contracts whose callee is in an owner directory are enforced; shared callees elsewhere remain informational. The revised checker probe on `ffeafb0e` checked 16 destructure sites across 41 modules, with 0 enforced and 34 informational problems; re-measure these counts in PR0.

**Limits:** unresolved callees, non-literal/spread call arguments, and first parameters written as `props` or a defaulted object remain unchecked. Existing examples include `SettingsModal`, `JiraFieldSettings`, and `TeamGroupsSettings`. New owner hooks must return an object literal and new containers must destructure their first parameter so their boundaries can be checked. The Settings prop-parity guard remains the backstop for existing unchecked containers. An exit of 0 proves only the checked boundaries; it does not prove closure timing or behavior.

The original seven seeded defects (`negative_controls.sh`) plus 14 nested-interface/conservation controls (`tooling_controls.mjs`) exercise the gate (a control whose anchor text no longer exists prints `ANCHOR ... re-anchor the control` and counts as a failure, so a slice that moves an anchor re-anchors the control in the same R4; the controls are anchored on text that the early slices move: `scenarioLoading`, `registerScenarioIssueRef`, `window.setInterval(poll, 5000)`, and the `useGroupVisibilityPreferences` call): a deleted JSX import, a render-phase read before declaration, an undefined name, a `.jsx` file without a React import, a destructured name the hook does not return, a required input not passed, and an edited statement the conservation check must report. The original seven were caught on the revision-3 unmodified tree copy; PR0 reruns them against its current base. The additional 14 controls include clean and failing nested hook/component contracts, absent argument objects, shadowed aliases, preserved documented limits, clean existing-hook conservation, dropped/duplicated statements, reordered effects, created/deleted hooks, and literal-whitespace edits. Every expected result must be observed; testing only extraction from a monolithic `App()` is insufficient.

**Known blind spots, and their procedures.**

- `no-use-before-define` with `variables:false` ignores closures that run during render (`useMemo`, synchronous helper calls, or getters invoked by another hook). Maintain a caller/getter phase ledger for every changed owner boundary: declaring module/symbol, all direct and transitive callers, first read, and actual invocation phase. Scan **every changed caller**, including `useScenarioPlanner`/SC3 sub-hooks and all Settings layers, rather than only `dashboard.jsx`. A getter passed into a nested hook is safe only if every eventual invocation is deferred to an effect or event handler; creation of a closure is not proof. Calls during hook execution, render, dependency-array evaluation, or a `useMemo` factory are render-phase reads and block the move if the binding is later. Record deferred uses and the source evidence; unresolved invocation paths block the rung.

  After placing the call sites, collect the moved hooks' returns and every getter's later-captured binding into `tmp/lint/returned-names.txt` (one exact identifier per line). Run the strict scan on the complete caller list from that ledger. This template preserves tooling failures and reads structured diagnostics instead of treating an empty filtered pipe as success:

  ```bash
  fnm exec --using 20 node tmp/lint/check_hook_interfaces.mjs --print-returns <hookfile> <exportName> > tmp/lint/returned-names.txt || exit $?
  # Append other hooks' returns and captured getter bindings; substitute all verified caller paths.
  scan_result=0
  fnm exec --using 20 node tmp/lint/node_modules/eslint/bin/eslint.js \
    --no-config-lookup -c tmp/lint/eslint.config.mjs --format json \
    --rule '{"no-use-before-define":["error",{"functions":false,"classes":false,"variables":true}]}' \
    <caller-file-1> <caller-file-2> > tmp/lint/strict-callers.json || scan_result=$?
  if [ "$scan_result" -gt 1 ]; then exit "$scan_result"; fi
  fnm exec --using 20 node --input-type=module <<'NODE'
  import fs from 'node:fs';
  const wanted = new Set(fs.readFileSync('tmp/lint/returned-names.txt', 'utf8').trim().split(/\s+/).filter(Boolean));
  if (!wanted.size || [...wanted].some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) throw new Error('Missing/invalid caller binding inventory');
  const results = JSON.parse(fs.readFileSync('tmp/lint/strict-callers.json', 'utf8'));
  if (!Array.isArray(results) || !results.length) throw new Error('No caller files scanned');
  for (const result of results) {
      for (const message of result.messages) {
          if (message.fatal || message.ruleId == null) throw new Error(`${result.filePath}: ${message.message}`);
          const name = message.message.match(/^'([^']+)' was used/)?.[1];
          if (message.ruleId === 'no-use-before-define' && wanted.has(name)) {
              console.log(`${result.filePath}:${message.line}:${message.column} ${message.message}`);
          }
      }
  }
  NODE
  ```

  Every filtered hit requires phase classification and every ledger caller must occur in the JSON results. A clean scan does not validate a getter's transitive invocation phase; review that separately. `--print-returns` warns on spreads, so explicitly inventory their members and getter captures rather than treating them as zero. PR0 adds a seeded nested caller whose `useMemo` reads a later hook result: the default scan passes, this strict scan must report it, and the deferred-effect variant remains a documented safe use.
- The lint/interface gate cannot see a wrong-but-defined name or a dropped/duplicated statement. Conservation compares `App()` and the complete named owner-hook set at both revisions. Pass existing owners as positional paths, created owners with `--created-hook <path>`, and deleted owners with `--deleted-hook <path>`; omitting an existing baseline body is a coverage error, not an empty baseline. For a scratch comparison, use `--base-file <dashboard>` plus `--base-hook <current-hook>=<baseline-hook>` for each existing owner. Paths are resolved from the repo root. Examples:

  ```bash
  fnm exec --using 20 node tmp/lint/check_move_conservation.mjs --base HEAD~1 \
    frontend/src/scenario/useScenarioPlanner.js \
    --created-hook frontend/src/scenario/useScenarioDraft.js

  fnm exec --using 20 node tmp/lint/check_move_conservation.mjs \
    --base-file tmp/before/dashboard.jsx --dashboard tmp/after/dashboard.jsx \
    --base-hook tmp/after/usePlanner.js=tmp/before/usePlanner.js tmp/after/usePlanner.js
  ```

  Include previously extracted owners whose effects participate in ordering, such as `useScenarioState` and the planner/sub-hooks in SC3, or the relevant prior Settings layers. The script prints complete residual statements; every one must be itemised and reviewed in the commit message. Inter-token whitespace is ignored; literal contents remain significant. Exit 0 means effect order is identical, not that residuals are approved; exit 1 means an effect mismatch, and exit 2 means a parsing/coverage error. An effect mismatch blocks the commit unless the Settings crossing table proves the exact crossing safe; ST3's open/normalize crossing cannot be waived as disjoint. Use `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change HEAD~1 HEAD` as an additional review aid.

### Owner growth and interface budgets

Reducing `dashboard.jsx` is insufficient if the extraction produces oversized owners or hides dependencies in bags. PR0 must extend `tests/test_codebase_structure_budgets.py` and `check_hook_interfaces.mjs`, and create the canonical `scripts/extraction_lint/owner_budgets.json` inventory. The six printed core tools below do **not** yet implement these extensions; copying them alone does not pass this gate. No new dependency is needed: use the existing Python checks and the checker's AST.

- Inventory every affected existing and new feature-owned source file, including containers and helper modules; give it a stable module ID, repository-relative path, feature membership, exports, measured line count and ceiling. Count each physical file once in the combined total; a helper shared by both clusters is not counted twice. Exclude generated dist, tests, and unrelated imported shared modules from owner totals, and record those exclusions explicitly. Required source registration discovers reachable modules and all source files in the declared feature-owner roots so an unregistered helper cannot silently escape the budget.
- For every exported hook/container, record all input, return and prop names and counts, both outer parameter count and expanded known bag-member count, caller paths, remaining App readers, and getters with invocation phases. Record accepted optional inputs as well as required inputs. Passing 100 dependencies in one object still records 100 expanded members. Spreads, dynamic returns and unresolved contracts require a complete reviewed member inventory linked to their source; unknown is never a zero count or a growth exemption. Preserve the approved flat planner interface and current Settings boundaries; the historical large EPM/Team Groups interfaces require accurate inventory, rather than a speculative redesign.
- The manifest records `schemaVersion`, `baseSha`, `checkpointId`, per-module `id/path/features/exports/lineCeiling`, per-export `inputNames/returnNames/propNames/outerParameterCeiling/expandedInputCeiling/returnCeiling/propCeiling`, and **checkpoint-specific** aggregate ceilings for Scenario, Settings, the unique union of both, and that union plus `dashboard.jsx`. Record the incoming source ranges/ownership transfer and scaffolding allowance for each checkpoint. Owner-only totals necessarily grow as App statements move into owners (SC1 to SC2, for example); a single never-increasing owner-only total would incorrectly forbid the planned extraction. Measured values accompany ceilings; validate schema, duplicate paths/IDs, missing files/exports, and unresolved inventory entries. Symbol-level checks reject added members outside the frozen interface, even when a renamed bag or fewer outer parameters hides them. Per-file caps prevent sibling shrinkage from concealing an oversized owner; aggregate caps prevent many individually legal helpers from inflating the checkpoint.
- Before each R4, derive the next checkpoint from the current-base scratch move, including new owners, transferred statement ranges, and itemized call sites, destructures, returns, imports, layers and other necessary scaffolding. Its combined App-plus-owner ceiling is the prior unique total plus that explicit net scaffolding allowance, minus verified deletions; merely moving statements adds no transfer credit to the combined total. Carry existing per-file/interface caps forward unless the approved move transfers additional responsibility into that owner; any such change must name the incoming ranges/members in the preflight ledger. Freeze the proposal at the preceding operator validation stop and include it in the R4 manifest update before checks. New owners need their initial cap before the move; they cannot remain unbudgeted until R5. R4 cannot raise a **frozen checkpoint** cap or derive it retroactively from the finished implementation. R5 ratchets down within that checkpoint; a later approved transfer receives its own frozen checkpoint, rather than an unexplained growth exemption. If a verified upstream change or necessary seam exceeds a proposal, report the exact delta and stop for a scoped operator decision before changing it; do not add padding or unrelated deletions. Unchanged owner interfaces stay at their prior ceilings.
- Add clean/failing tooling controls for an oversized owner, an unregistered module, added interface members (including hidden bag members), aggregate growth while another file shrinks, and a wrong combined total caused by double-counting a shared helper. A clean authorized App-to-owner transfer must pass its new checkpoint while unaccounted combined growth fails. Run these alongside the existing 21 controls. Python validates source-file/aggregate LOC; the interface checker validates exports/names/counts and registration. `run.sh` invokes both, and `negative_controls.sh` invokes their controls. PR0 records their actual outputs; these checks must pass before the first extraction.

At each R5 update the remaining-App responsibility inventory: canonical responsibility, retained symbols and readers, reason it stays in App, its owner relationship, and call-site/seam line cost. At completion the operator can see what the remaining roughly 10–12k lines do and how much code moved into each owner. Owner modules may not import `dashboard.jsx`; record and check dependency direction so a cycle cannot restore hidden App ownership. LOC and interface counts are maintenance limits, not performance evidence.

### Hook-input derivation (the five kinds of name)

Write the hook with an empty parameter list, run the gate on the new file, and classify every `no-undef` name the lint reports:

1. A name imported by `dashboard.jsx`: add the same import to the hook file (rewrite relative paths: `./scenario/x` becomes `./x`, `./api/x` becomes `../api/x`).
2. A React hook name from the module-level `const { useState, useEffect, ... } = React` destructure: use `React.useEffect` or an equivalent import.
3. A module-level constant of `dashboard.jsx`: a parameter if its identity matters (`BACKEND_URL`, `EMPTY_ARRAY`, `EMPTY_OBJECT`); otherwise, for a pure module-level helper, move it to a small module in the feature folder that both sides import (one instance), for example `createEmptyEpmConfigDraft`, `DEFAULT_EPM_LABEL_PREFIX`, and the `*_TAB_IDS` sets.
4. A name of the SC1 state container: destructure it inside the hook from the container object that is passed in.
5. Everything else (an `App()`-scope binding): a parameter.

Then run the gate on `dashboard.jsx`: every parameter it reports as used before its declaration is a TDZ at the call site and blocks the commit (resolve with a hoist, a layer split, or a getter, never a ref). Do not hand-write input lists from this plan; the lists printed in the PR sections are the dry-run results to compare against.

### Files created in PR0

`scripts/extraction_lint/eslint.config.mjs`

```js
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    {
        files: ['**/*.{js,jsx,mjs}'],
        plugins: { react, 'react-hooks': reactHooks },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            // esbuild defines process.env.NODE_ENV at bundle time.
            globals: { ...globals.browser, process: 'readonly' },
        },
        rules: {
            'no-undef': 'error',
            'react/jsx-no-undef': 'error',
            'react/jsx-uses-vars': 'error',
            // The bundle uses esbuild's classic JSX transform, so every .jsx file needs React in scope.
            'react/jsx-uses-react': 'error',
            'react/react-in-jsx-scope': 'error',
            'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
            'react-hooks/rules-of-hooks': 'error',
        },
    },
    {
        // Three pre-existing errors at base, outside this program.
        files: ['**/eng/EngView.jsx'],
        rules: { 'react-hooks/rules-of-hooks': 'off' },
    },
];
```

`scripts/extraction_lint/check_hook_interfaces.mjs`

```js
// Check dashboard.jsx and the reachable scenario/, settings/, and epm/ modules.
// Each file uses its own imports and lexical bindings; nested hook/component contracts count.
// Spreads, non-literal call arguments, and props/defaulted component parameters remain unchecked.
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';

const OWNER_DIRS = /^(scenario|settings|epm)[\\/]/;
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const baselineFile = flag('--baseline');
const printReturns = args.indexOf('--print-returns');
const parse = (file) => espree.parse(fs.readFileSync(file, 'utf8'), {
    ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true,
});
const resolveImport = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.(jsx?|mjs)$/.test(candidate)) return candidate;
    }
    return null;
};
function children(node) {
    return Object.entries(node).filter(([key]) => key !== 'loc').flatMap(([, value]) => (
        (Array.isArray(value) ? value : [value]).filter((child) => child && typeof child.type === 'string')
    ));
}
function walk(node, visit, skipFunctions = false) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const child of children(node)) if (!(skipFunctions && /Function/.test(child.type))) walk(child, visit, skipFunctions);
}
const keyName = (property) => property.computed ? undefined : property.key?.name ?? property.key?.value;
const cache = new Map();
function moduleAst(file) {
    if (!cache.has(file)) cache.set(file, parse(file));
    return cache.get(file);
}
function findFunction(file, exportedName) {
    const ast = moduleAst(file);
    const functions = new Map();
    let defaultName = null;
    for (const node of ast.body) {
        const decl = /^Export(Named|Default)Declaration$/.test(node.type) ? node.declaration : node;
        if (!decl) continue;
        if (decl.type === 'FunctionDeclaration') {
            if (decl.id) functions.set(decl.id.name, decl);
            if (node.type === 'ExportDefaultDeclaration') functions.set('default', decl);
        }
        if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations) if (d.id.type === 'Identifier' && /Function/.test(d.init?.type)) functions.set(d.id.name, d.init);
        }
        if (node.type === 'ExportDefaultDeclaration') {
            if (decl.type === 'Identifier') defaultName = decl.name;
            else if (/Function/.test(decl.type)) functions.set('default', decl);
        }
    }
    return functions.get(exportedName === 'default' && defaultName ? defaultName : exportedName) ?? null;
}
function returnKeys(fn) {
    const keys = new Set();
    let unknown = false;
    let sawReturn = false;
    walk(fn.body, (node) => {
        if (node.type !== 'ReturnStatement') return;
        sawReturn = true;
        if (node.argument?.type !== 'ObjectExpression') { unknown = true; return; }
        for (const property of node.argument.properties) {
            const name = keyName(property);
            if (property.type === 'SpreadElement' || name === undefined) unknown = true;
            else keys.add(name);
        }
    }, true);
    return { keys, unknown: unknown || !sawReturn };
}
function paramInfo(fn, jsx = false) {
    const pattern = fn.params[0];
    // Preserve the documented limit: props and a defaulted first parameter are not checked.
    if (pattern?.type !== 'ObjectPattern') return null;
    const required = [];
    const accepted = new Set();
    let rest = false;
    for (const property of pattern.properties) {
        if (property.type === 'RestElement') { rest = true; continue; }
        const name = keyName(property);
        if (name === undefined) return null;
        accepted.add(name);
        if (property.value.type !== 'AssignmentPattern' && !(jsx && ['children', 'key', 'ref'].includes(name))) required.push(name);
    }
    return { required, accepted, rest };
}
if (printReturns !== -1) {
    const file = path.resolve(args[printReturns + 1]);
    const fn = findFunction(file, args[printReturns + 2] ?? 'default');
    if (!fn) { console.error('function not found'); process.exit(2); }
    const result = returnKeys(fn);
    if (result.unknown) console.error('warning: the return uses a spread or non-literal; only literal keys are listed');
    console.log([...result.keys].join('\n'));
    process.exit(0);
}
const entry = path.resolve(args[0]);
const sourceRoot = path.dirname(entry);
const owned = (file) => OWNER_DIRS.test(path.relative(sourceRoot, file));
const enforcedProblems = [];
const informational = [];
let checked = 0;
let filesChecked = 0;
// Keep the original enforcement boundary: contracts of shared components outside owner folders
// are informational, even when an owner module calls them (many props are intentionally optional).
const report = (caller, resolved, message) => (owned(resolved) ? enforcedProblems : informational).push(message);

// Build scopes before checking expressions, so imports/aliases cannot leak across shadowing bindings.
function lexicalScopes(ast, file) {
    const scopes = new WeakMap();
    const root = { parent: null, kind: 'Program', bindings: new Map() };
    function bind(pattern, scope, value = {}) {
        if (!pattern) return;
        if (pattern.type === 'Identifier') scope.bindings.set(pattern.name, value);
        else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, value);
        else if (pattern.type === 'RestElement') bind(pattern.argument, scope, value);
        else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) bind(p.type === 'RestElement' ? p.argument : p.value, scope, value);
        else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) bind(p, scope, value);
    }
    function visit(node, scope) {
        if (node.type === 'FunctionDeclaration' && node.id) bind(node.id, scope, { fn: node, resolved: file });
        if (/Function/.test(node.type)) {
            scope = { parent: scope, kind: 'Function', bindings: new Map() };
            if (node.id) bind(node.id, scope, { fn: node, resolved: file });
            for (const param of node.params) bind(param, scope);
        } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) {
            scope = { parent: scope, kind: 'Block', bindings: new Map() };
            if (node.type === 'CatchClause') bind(node.param, scope);
        }
        scopes.set(node, scope);
        if (node.type === 'ImportDeclaration') {
            const resolved = node.source.value.startsWith('.') ? resolveImport(file, node.source.value) : null;
            for (const specifier of node.specifiers) {
                bind(specifier.local, scope, { resolved, exported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name ?? specifier.imported?.value });
            }
        }
        if (node.type === 'VariableDeclaration') {
            let target = scope;
            if (node.kind === 'var') while (target.parent && target.kind === 'Block') target = target.parent;
            for (const d of node.declarations) bind(d.id, target, d.id.type === 'Identifier' ? { init: d.init, initScope: scope } : {});
        }
        if (node.type === 'ClassDeclaration' && node.id) bind(node.id, scope);
        for (const child of children(node)) visit(child, scope);
    }
    visit(ast, root);
    const binding = (name, scope) => {
        for (let current = scope; current; current = current.parent) if (current.bindings.has(name)) return current.bindings.get(name);
        return null;
    };
    function lookup(name, scope, seen = new Set()) {
        const value = binding(name, scope);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        if (value.fn) return value;
        if (value.resolved && value.exported) {
            const fn = findFunction(value.resolved, value.exported);
            return fn ? { fn, resolved: value.resolved } : null;
        }
        if (value.init?.type === 'Identifier') return lookup(value.init.name, value.initScope, seen);
        if (/Function/.test(value.init?.type)) return { fn: value.init, resolved: file };
        return null;
    }
    function resultAlias(name, scope, seen = new Set()) {
        const value = binding(name, scope);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        if (value.init?.type === 'Identifier') return resultAlias(value.init.name, value.initScope, seen);
        if (value.init?.type === 'CallExpression' && value.init.callee.type === 'Identifier' && /^use[A-Z]/.test(value.init.callee.name)) {
            const info = lookup(value.init.callee.name, value.initScope);
            return info ? { name: value.init.callee.name, info } : null;
        }
        return null;
    }
    return { scopes, lookup, resultAlias };
}
const queue = [entry];
const visited = new Set();
while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const ast = moduleAst(file);
    filesChecked += 1;
    for (const node of ast.body) {
        if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
        const resolved = resolveImport(file, node.source.value);
        if (resolved && owned(resolved)) queue.push(resolved);
    }
    const { scopes, lookup, resultAlias } = lexicalScopes(ast, file);
    const at = (node) => `${path.relative(sourceRoot, file)}:line ${node.loc.start.line}`;
    function checkDestructure(pattern, name, info, node) {
        const { keys, unknown } = returnKeys(info.fn);
        checked += 1;
        const wanted = pattern.properties.filter((p) => p.type === 'Property').map(keyName);
        const missing = wanted.filter((key) => !keys.has(key));
        if (missing.length && !unknown) report(file, info.resolved, `${name} (${at(node)}): destructured but not returned -> ${missing.join(', ')}`);
        else if (missing.length) report(file, info.resolved, `${name} (${at(node)}): return uses a spread or non-literal; cannot verify ${missing.length} names`);
    }
    function checkParams(name, info, passed, node, jsx = false, absent = false) {
        const params = paramInfo(info.fn, jsx);
        if (!params) return;
        if (absent && !params.required.length) {
            report(file, info.resolved, `${name} (${at(node)}): required input not passed -> first object argument`);
            return;
        }
        const missing = params.required.filter((key) => !passed.includes(key));
        const unknownKeys = params.rest ? [] : passed.filter((key) => !(jsx && ['key', 'ref'].includes(key)) && !params.accepted.has(key));
        if (missing.length) report(file, info.resolved, `${name} (${at(node)}): required input not passed -> ${missing.join(', ')}`);
        if (unknownKeys.length) report(file, info.resolved, `${name} (${at(node)}): passed but not accepted -> ${unknownKeys.join(', ')}`);
    }
    walk(ast, (node) => {
        const scope = scopes.get(node);
        if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init) {
            if (node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier' && /^use[A-Z]/.test(node.init.callee.name)) {
                const info = lookup(node.init.callee.name, scope);
                if (info) checkDestructure(node.id, node.init.callee.name, info, node);
            } else if (node.init.type === 'Identifier') {
                const alias = resultAlias(node.init.name, scope);
                if (alias) checkDestructure(node.id, alias.name, alias.info, node);
            }
        }
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && /^use[A-Z]/.test(node.callee.name)) {
            const info = lookup(node.callee.name, scope);
            const first = node.arguments[0];
            if (info && !first) checkParams(node.callee.name, info, [], node, false, true);
            if (info && first?.type === 'ObjectExpression' && !first.properties.some((p) => p.type === 'SpreadElement' || p.computed)) {
                checkParams(node.callee.name, info, first.properties.map(keyName), node);
            }
        }
        if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && /^[A-Z]/.test(node.name.name)) {
            const info = lookup(node.name.name, scope);
            if (info && !node.attributes.some((a) => a.type === 'JSXSpreadAttribute')) {
                checkParams(node.name.name, info, node.attributes.map((a) => a.name.name), node, true);
            }
        }
    });
}
const baseline = baselineFile && fs.existsSync(baselineFile) ? new Set(fs.readFileSync(baselineFile, 'utf8').split('\n').filter(Boolean)) : new Set();
const strip = (message) => message.replace(/:line \d+/, '');
const newProblems = enforcedProblems.filter((message) => !baseline.has(strip(message)));
console.log(`checked ${checked} destructure sites in ${filesChecked} modules; enforced problems: ${newProblems.length}; informational: ${informational.length}; baselined: ${enforcedProblems.length - newProblems.length}`);
newProblems.forEach((message) => console.log(`  ENFORCED ${message}`));
if (process.env.CHECKER_VERBOSE) informational.forEach((message) => console.log(`  info ${message}`));
if (process.env.CHECKER_WRITE_BASELINE) fs.writeFileSync(process.env.CHECKER_WRITE_BASELINE, `${enforcedProblems.map(strip).join('\n')}\n`);
process.exitCode = newProblems.length ? 1 : 0;
```

`scripts/extraction_lint/check_move_conservation.mjs`

```js
// Compare App() plus all named owner-hook bodies at BOTH revisions. Full residual statements need
// human review; only effect-order divergence determines exit 1. Parse/coverage errors exit 2.
// Git: --base REF [--created-hook FILE] [--deleted-hook FILE] EXISTING_HOOK_FILES...
// Scratch: --base-file DASHBOARD --dashboard DASHBOARD --base-hook CURRENT_FILE=BASE_FILE ...
// Newly created/deleted files must be explicit; hook paths form the same union on both sides.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as espree from 'espree';

try {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) throw new Error(`${name} requires a value`); args.splice(i, 2); return v; };
    const many = (name) => { const values = []; while (args.includes(name)) values.push(flag(name)); return values; };
    const baseRef = flag('--base') ?? 'HEAD';
    const baseFile = flag('--base-file');
    const dashboard = flag('--dashboard') ?? 'frontend/src/dashboard.jsx';
    const created = new Set(many('--created-hook').map((file) => path.resolve(file)));
    const deleted = new Set(many('--deleted-hook').map((file) => path.resolve(file)));
    const baselineHooks = new Map(many('--base-hook').map((value) => {
        const separator = value.indexOf('=');
        if (separator < 1) throw new Error('--base-hook requires CURRENT_FILE=BASE_FILE');
        return [path.resolve(value.slice(0, separator)), value.slice(separator + 1)];
    }));
    if (args.some((arg) => arg.startsWith('--'))) throw new Error(`unknown option: ${args.find((arg) => arg.startsWith('--'))}`);
    const hookFiles = [...new Set([...args.map((file) => path.resolve(file)), ...created, ...deleted, ...baselineHooks.keys()])];
    for (const file of hookFiles) if (created.has(file) && deleted.has(file)) throw new Error(`${file} cannot be both created and deleted`);
    const gitRoot = baseFile ? null : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (!baseFile) execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { stdio: 'ignore' });
    const gitPath = (file) => path.relative(gitRoot, path.resolve(file)).split(path.sep).join('/');
    const gitExists = (file) => {
        try { execFileSync('git', ['cat-file', '-e', `${baseRef}:${gitPath(file)}`], { stdio: 'ignore' }); return true; }
        catch { return false; }
    };
    const gitRead = (file) => execFileSync('git', ['show', `${baseRef}:${gitPath(file)}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const parse = (code) => espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true, tokens: true });
    function module(code, file) {
        const ast = parse(code);
        const functions = new Map();
        const exports = new Map();
        const imports = new Map();
        for (const node of ast.body) {
            if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
                for (const specifier of node.specifiers) imports.set(specifier.local.name, { spec: node.source.value, exported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name });
            }
            const decl = /^Export(Named|Default)Declaration$/.test(node.type) ? node.declaration : node;
            if (!decl) continue;
            if (decl.type === 'FunctionDeclaration' && decl.id) functions.set(decl.id.name, decl);
            if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier' && /Function/.test(d.init?.type)) functions.set(d.id.name, d.init);
            if (node.type === 'ExportDefaultDeclaration') exports.set('default', decl.type === 'Identifier' ? decl.name : decl.id?.name);
            if (node.type === 'ExportNamedDeclaration' && !node.source) for (const specifier of node.specifiers) exports.set(specifier.exported.name, specifier.local.name);
        }
        const statements = (fn) => {
            if (fn.body.type !== 'BlockStatement') throw new Error(`${file}: hook bodies must use a block`);
            return fn.body.body.map((node) => ({
                node, file, line: node.loc.start.line, text: code.slice(node.range[0], node.range[1]),
                // Ignore only inter-token whitespace; preserve string/template/JSX literal contents.
                signature: JSON.stringify(ast.tokens.filter((token) => token.range[0] >= node.range[0] && token.range[1] <= node.range[1]).map((token) => [token.type, code.slice(token.range[0], token.range[1])])),
            }));
        };
        return { functions, exports, imports, statements };
    }
    const dashboardPath = path.resolve(dashboard);
    const beforeModules = new Map([[dashboardPath, module(baseFile ? fs.readFileSync(baseFile, 'utf8') : gitRead(dashboard), dashboardPath)]]);
    const afterModules = new Map([[dashboardPath, module(fs.readFileSync(dashboard, 'utf8'), dashboardPath)]]);
    for (const file of hookFiles) {
        const currentExists = fs.existsSync(file);
        const beforeExists = baselineHooks.has(file) ? fs.existsSync(baselineHooks.get(file)) : baseFile ? false : gitExists(file);
        if (created.has(file)) {
            if (beforeExists || baselineHooks.has(file)) throw new Error(`created hook exists at baseline: ${file}`);
            if (!currentExists) throw new Error(`created hook missing from current tree: ${file}`);
        } else if (!beforeExists) {
            throw new Error(`baseline hook missing: ${file}; mark --created-hook or supply --base-hook CURRENT_FILE=BASE_FILE`);
        }
        if (deleted.has(file)) {
            if (currentExists) throw new Error(`deleted hook still exists in current tree: ${file}`);
        } else if (!currentExists) {
            throw new Error(`current hook missing: ${file}; mark --deleted-hook`);
        }
        if (beforeExists) beforeModules.set(file, module(baselineHooks.has(file) ? fs.readFileSync(baselineHooks.get(file), 'utf8') : gitRead(file), file));
        if (currentExists) afterModules.set(file, module(fs.readFileSync(file, 'utf8'), file));
    }
    function collect(modules) {
        const appModule = modules.get(dashboardPath);
        const app = appModule.functions.get('App');
        if (!app) throw new Error('App() not found');
        const appStatements = appModule.statements(app);
        const bodies = new Map();
        const all = [...appStatements];
        for (const [file, owner] of modules) {
            if (file === dashboardPath) continue;
            const hooks = [...owner.functions].filter(([name]) => /^use[A-Z]/.test(name));
            if (!hooks.length) throw new Error(`no hook function found in ${file}`);
            for (const [name, fn] of hooks) {
                const body = owner.statements(fn);
                bodies.set(`${file}:${name}`, body);
                all.push(...body);
            }
        }
        function lookup(file, name) {
            if (bodies.has(`${file}:${name}`)) return `${file}:${name}`;
            const imported = modules.get(file).imports.get(name);
            if (!imported) return null;
            const base = path.resolve(path.dirname(file), imported.spec);
            const resolved = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find((candidate) => modules.has(candidate));
            if (!resolved) return null; // Unchanged hooks outside the named ownership set stay opaque on BOTH sides.
            const owner = modules.get(resolved);
            const target = owner.exports.get(imported.exported) ?? imported.exported;
            return bodies.has(`${resolved}:${target}`) ? `${resolved}:${target}` : null;
        }
        const calls = (node) => {
            if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression') return [node.expression];
            if (node.type === 'VariableDeclaration') return node.declarations.map((d) => d.init).filter((init) => init?.type === 'CallExpression');
            return [];
        };
        const effectName = (callee) => callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && !callee.computed && callee.object.name === 'React' ? callee.property.name : '';
        function effects(list, stack = []) {
            return list.flatMap((statement) => calls(statement.node).flatMap((call) => {
                if (/^use(Layout)?Effect$/.test(effectName(call.callee))) return [statement];
                if (call.callee.type !== 'Identifier') return [];
                const key = lookup(statement.file, call.callee.name);
                if (!key) return [];
                if (stack.includes(key)) throw new Error(`recursive hook call: ${key}`);
                return effects(bodies.get(key), [...stack, key]);
            }));
        }
        return { all, effects: effects(appStatements) };
    }
    const before = collect(beforeModules);
    const after = collect(afterModules);
    const tally = (list) => {
        const counts = new Map();
        for (const s of list) counts.set(s.signature, (counts.get(s.signature) ?? 0) + 1);
        return counts;
    };
    const unmatched = (list, otherCounts) => {
        const seen = new Map();
        return list.filter((s) => {
            const n = (seen.get(s.signature) ?? 0) + 1;
            seen.set(s.signature, n);
            return n > (otherCounts.get(s.signature) ?? 0);
        });
    };
    const removed = unmatched(before.all, tally(after.all));
    const added = unmatched(after.all, tally(before.all));
    console.log(`App + named hook statements before: ${before.all.length}; after: ${after.all.length}`);
    console.log(`removed and not found in a hook: ${removed.length}; new statements: ${added.length}`);
    removed.forEach((s) => console.log(`- (base ${path.relative(process.cwd(), s.file)} line ${s.line})\n${s.text}`));
    added.forEach((s) => console.log(`+ (${path.relative(process.cwd(), s.file)} line ${s.line})\n${s.text}`));
    let diverge = -1;
    for (let i = 0; i < Math.max(before.effects.length, after.effects.length); i += 1) {
        if (before.effects[i]?.signature !== after.effects[i]?.signature) { diverge = i; break; }
    }
    if (diverge === -1) console.log(`effect order: identical (${before.effects.length} top-level effects)`);
    else {
        console.log(`effect order: DIFFERS at effect ${diverge + 1} (before ${before.effects.length}, after ${after.effects.length})`);
        console.log(`  before: ${before.effects[diverge]?.text ?? '(none)'}`);
        console.log(`  after: ${after.effects[diverge]?.text ?? '(none)'}`);
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
```

`scripts/extraction_lint/tooling_controls.mjs`

```js
// Additional extraction controls, using only Node builtins. Run after run.sh copied tools to tmp/lint:
// EXTRACTION_TOOL_DIR=tmp/lint node scripts/extraction_lint/tooling_controls.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolDir = path.resolve(process.env.EXTRACTION_TOOL_DIR ?? path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve('tmp/negative-controls/tooling');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const write = (relative, code) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code);
    return file;
};
let passed = 0;
function run(name, script, args, status, patterns) {
    const result = spawnSync(process.execPath, [path.join(toolDir, script), ...args], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, status, `${name}: expected exit ${status}, got ${result.status}\n${output}`);
    for (const pattern of patterns) assert.match(output, pattern, `${name}: expected ${pattern}\n${output}`);
    console.log(`ok    ${name}`);
    passed += 1;
}
const dashboard = write('interfaces/dashboard.jsx', 'import { useOuter } from "./scenario/useOuter.js"; function App() { const { actual } = useOuter({ required: 1 }); return null; }\n');
const outer = write('interfaces/scenario/useOuter.js', 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const state = useInner({ required }); const alias = state; const { actual } = alias; return { actual }; }\n');
const inner = write('interfaces/scenario/useInner.js', 'export function useInner({ required }) { return { actual: required }; }\n');
const check = (name, status, patterns) => run(name, 'check_hook_interfaces.mjs', [dashboard], status, patterns);
check('nested-interface-clean', 0, [/checked 2 destructure sites in 3 modules/, /enforced problems: 0/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const state = useInner({}); const alias = state; const { missing } = alias; return { actual: missing }; }\n');
check('nested-interface-missing-return-and-input', 1, [/destructured but not returned -> missing/, /required input not passed -> required/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const { actual } = useInner(); return { actual }; }\n');
check('nested-interface-absent-object-argument', 1, [/required input not passed -> required/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const state = useInner({ required }); { const state = {}; const { missing } = state; void missing; } function deferred(useInner) { const { unrelated } = useInner(); return unrelated; } const { actual } = state; return { actual }; }\n');
check('nested-interface-lexical-shadowing', 0, [/enforced problems: 0/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; import Panel from "./Panel.jsx"; export function useOuter({ required }) { const { actual } = useInner({ required }); return { actual }; } export function View() { return <Panel />; }\n');
write('interfaces/scenario/Panel.jsx', 'export default function Panel({ required }) { return <div>{required}</div>; }\n');
check('nested-component-missing-prop', 1, [/Panel .*required input not passed -> required/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const { actual } = useInner({ ...{ required } }); return { actual }; }\n');
check('spread-input-documented-limit', 0, [/enforced problems: 0/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const { actual } = useInner(); return { actual }; }\n');
fs.writeFileSync(inner, 'export function useInner({ required } = {}) { return { actual: required }; }\n');
check('defaulted-parameter-documented-limit', 0, [/enforced problems: 0/]);

const beforeDashboard = write('conservation/before.jsx', 'import { usePlanner } from "./scenario/usePlanner.js"; function App() { const result = usePlanner(); }\n');
const afterDashboard = write('conservation/dashboard.jsx', fs.readFileSync(beforeDashboard, 'utf8'));
const beforePlanner = write('conservation/base/usePlanner.js', 'export function usePlanner() { retain(); useEffect(() => first(), []); useEffect(() => second(), []); return {}; }\n');
const planner = write('conservation/scenario/usePlanner.js', fs.readFileSync(beforePlanner, 'utf8'));
const conserveArgs = ['--base-file', beforeDashboard, '--dashboard', afterDashboard, '--base-hook', `${planner}=${beforePlanner}`, planner];
const conserve = (name, status, patterns, extra = []) => run(name, 'check_move_conservation.mjs', [...conserveArgs, ...extra], status, patterns);
conserve('existing-hook-clean', 0, [/removed and not found in a hook: 0; new statements: 0/, /identical \(2 top-level effects\)/]);
fs.writeFileSync(planner, 'export function usePlanner() { useEffect(() => first(), []); useEffect(() => second(), []); return {}; }\n');
conserve('existing-hook-dropped-statement-reported', 0, [/removed and not found in a hook: 1; new statements: 0/, /retain\(\);/]);
fs.writeFileSync(planner, 'export function usePlanner() { retain(); retain(); useEffect(() => first(), []); useEffect(() => second(), []); return {}; }\n');
conserve('existing-hook-duplicated-statement-reported', 0, [/removed and not found in a hook: 0; new statements: 1/, /retain\(\);/]);
fs.writeFileSync(planner, 'export function usePlanner() { retain(); useEffect(() => second(), []); useEffect(() => first(), []); return {}; }\n');
conserve('existing-hook-effect-reorder-fails', 1, [/removed and not found in a hook: 0; new statements: 0/, /effect order: DIFFERS/]);
const slice = write('conservation/scenario/useSlice.js', 'export function useSlice() { retain(); useEffect(() => first(), []); return {}; }\n');
fs.writeFileSync(planner, 'import { useSlice } from "./useSlice.js"; export function usePlanner() { const slice = useSlice(); useEffect(() => second(), []); return {}; }\n');
conserve('existing-hook-split-created-child-clean', 0, [/identical \(2 top-level effects\)/], ['--created-hook', slice]);
const deleted = path.join(root, 'conservation/scenario/useDeleted.js');
const deletedBase = write('conservation/base/useDeleted.js', 'export function useDeleted() { useEffect(() => first(), []); return {}; }\n');
fs.writeFileSync(beforeDashboard, 'import { useDeleted } from "./scenario/useDeleted.js"; function App() { const result = useDeleted(); }\n');
fs.writeFileSync(afterDashboard, 'import { useSlice } from "./scenario/useSlice.js"; function App() { const result = useSlice(); }\n');
run('explicit-created-and-deleted-hooks', 'check_move_conservation.mjs', ['--base-file', beforeDashboard, '--dashboard', afterDashboard, '--base-hook', `${deleted}=${deletedBase}`, '--deleted-hook', deleted, '--created-hook', slice], 0, [/identical \(1 top-level effects\)/]);
const literalBefore = write('literal/before.jsx', 'function App() { const label = "two words"; }\n');
const literalAfter = write('literal/after.jsx', 'function App() { const label = "two  words"; }\n');
run('literal-whitespace-change-reported', 'check_move_conservation.mjs', ['--base-file', literalBefore, '--dashboard', literalAfter], 0, [/removed and not found in a hook: 1; new statements: 1/]);
console.log(`tooling controls passed: ${passed}`);
```

`scripts/extraction_lint/run.sh`

```bash
#!/usr/bin/env bash
# Extraction safety gate. Installs its tools into gitignored tmp/lint (no repo dependency).
# Usage: scripts/extraction_lint/run.sh [source-root]    (default: frontend/src)
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="${1:-frontend/src}"
LINT_DIR=tmp/lint
MAX_WARNINGS="${EXTRACTION_LINT_MAX_WARNINGS:-119}"   # ratchet: lower it whenever a commit removes warnings
BASELINE=scripts/extraction_lint/hook_interface_baseline.txt   # optional; absent means empty
if [ ! -x "$LINT_DIR/node_modules/.bin/eslint" ]; then
    mkdir -p "$LINT_DIR"
    npm install --prefix "$LINT_DIR" --no-audit --no-fund \
        eslint@9.39.5 globals@14.0.0 eslint-plugin-react@7.37.5 eslint-plugin-react-hooks@7.1.1 espree@10.4.0
fi
cp scripts/extraction_lint/eslint.config.mjs "$LINT_DIR/eslint.config.mjs"
cp scripts/extraction_lint/check_hook_interfaces.mjs "$LINT_DIR/check_hook_interfaces.mjs"
cp scripts/extraction_lint/check_move_conservation.mjs "$LINT_DIR/check_move_conservation.mjs"
status=0
"$LINT_DIR/node_modules/.bin/eslint" --no-config-lookup -c "$LINT_DIR/eslint.config.mjs" \
    --max-warnings "$MAX_WARNINGS" "$SRC" || status=1
node "$LINT_DIR/check_hook_interfaces.mjs" --baseline "$BASELINE" "$SRC/dashboard.jsx" || status=1
exit "$status"
```

`scripts/extraction_lint/negative_controls.sh`

```bash
#!/usr/bin/env bash
# Seeded-defect controls. Each seeded defect must make the gate fail with the expected finding;
# a control the gate passes means the gate cannot be trusted. Works on copies under tmp/.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=tmp/negative-controls
LINT_DIR=tmp/lint
rm -rf "$OUT"
mkdir -p "$OUT"
failures=0

seed() {   # seed <dir> <python that edits `s` (dashboard.jsx text) or writes files under `src`>
    python3 - "$1/src" <<PY
import pathlib, re, sys
src = pathlib.Path(sys.argv[1])
dash = src / "dashboard.jsx"
s = dash.read_text()
original = s
before_files = {p.name for p in src.iterdir()}
$2
if s == original and {p.name for p in src.iterdir()} == before_files:
    sys.exit(3)
dash.write_text(s)
PY
}

control() {   # control <name> <expected finding> <python seed>
    local dir="$OUT/$1"
    mkdir -p "$dir"
    cp -R frontend/src "$dir/src"
    if ! seed "$dir" "$3"; then
        echo "ANCHOR $1: the seed changed nothing; re-anchor the control (its anchor text moved)"; failures=$((failures + 1)); return
    fi
    if bash scripts/extraction_lint/run.sh "$dir/src" >"$dir/gate.log" 2>&1; then
        echo "FAIL  $1: the gate passed a seeded defect"; failures=$((failures + 1))
    elif grep -q -- "$2" "$dir/gate.log"; then
        echo "ok    $1"
    else
        echo "FAIL  $1: the gate failed without the expected finding ($2)"; failures=$((failures + 1))
    fi
}

control missing-jsx-import 'react/jsx-no-undef' \
's = re.sub(r"^import SettingsModal[^\n]*\n", "", s, count=1, flags=re.M)'
control use-before-define 'no-use-before-define' \
'm = "const [scenarioLoading, setScenarioLoading] = useState(false);"
s = s.replace(m, m + "\n            const __probe = engWorkspaceConfigured;", 1)'
control undefined-name 'no-undef' \
's = s.replace("const registerScenarioIssueRef =", "const registerScenarioIssueRefMoved =", 1)'
control react-not-in-scope 'react-in-jsx-scope' \
'(src / "ProbeView.jsx").write_text("export default function ProbeView() { return <div />; }\n")'
control destructured-name-not-returned 'destructured but not returned' \
's = s.replace("            } = useGroupVisibilityPreferences({", "                bogusName,\n            } = useGroupVisibilityPreferences({", 1)'
control required-input-not-passed 'required input not passed' \
'i = s.index("= useGroupVisibilityPreferences({")
j = s.index("});", i)
s = s[:i] + s[i:j].replace("                groupsLoading,\n", "", 1) + s[j:]'

# The conservation script is not part of the gate; its control proves it reports an edited statement.
dir="$OUT/edited-statement"
mkdir -p "$dir"
cp -R frontend/src "$dir/src"
seed "$dir" 's = s.replace("window.setInterval(poll, 5000)", "window.setInterval(poll, 5001)", 1)' \
    || { echo "ANCHOR edited-statement: the seed changed nothing; re-anchor the control"; failures=$((failures + 1)); }
cp scripts/extraction_lint/check_move_conservation.mjs "$LINT_DIR/check_move_conservation.mjs"
node "$LINT_DIR/check_move_conservation.mjs" --base-file frontend/src/dashboard.jsx --dashboard "$dir/src/dashboard.jsx" >"$dir/conservation.log" 2>&1
if grep -q 'removed and not found in a hook: 1; new statements: 1' "$dir/conservation.log"; then
    echo "ok    edited-statement (conservation)"
else
    echo "FAIL  edited-statement: the conservation check did not report the edit"; failures=$((failures + 1))
fi

EXTRACTION_TOOL_DIR="$LINT_DIR" node scripts/extraction_lint/tooling_controls.mjs \
    || failures=$((failures + 1))

echo "negative controls failed: $failures"
exit "$failures"
```

The `tests/README.md` note (PR0) documents the commands above, all six tool files, the install location, conservation exit codes and explicit created/deleted/base-hook flags, and that nothing is added to `package.json`. Before the first gate run, measure warnings without a ceiling on the unchanged current base and set `MAX_WARNINGS` in `run.sh` to that value (119 is the historical placeholder); ratchet it down afterwards. The optional `scripts/extraction_lint/hook_interface_baseline.txt` contains only reviewed pre-existing enforced problems, with source paths and rationale. Use `CHECKER_WRITE_BASELINE` only to propose that list for review; never baseline a defect introduced by extraction.

### Per-commit checks by rung

R1, R3, R4: gate, negative controls (once per PR), Node suite, Python suite, build plus committed dist plus `make verify-dist-clean`, the slice's targeted Playwright specs, DOM parity diff empty, and for R4 the conservation check. R2: the new tests pass on unmodified source. R5: dashboard/owner/aggregate/interface budget and ceiling tests plus the remaining-App inventory. R4 also compares the section 9 runtime-work baseline for Scenario-affecting moves; unexplained extra work blocks validation. R6: everything plus the full Chromium `tests/ui` run.

### Guard ledger and orphans

Every PR description carries a ledger: for each guard that fails after a move, whether it is an invariant pin (re-point to the new owner file, keep) or a shape/order guard (delete, naming the behavioral test that covers the behavior). Do not edit a guard that still passes. A retained negative pin ("this text must not appear") reads the owner files through `readOwnerSource` with a positive anchor (PR0) so it cannot go vacuous when code moves. After each R4, remove imports and destructured names the move orphaned and prune names from the `App()` destructure that no `App()` code reads.

### DOM parity

`JEP_DOM_PARITY_DIR=tmp/dom-parity/before` is captured at the start of the slice (before R1) and `.../after` after each R1, R3, and R4. Use fresh empty directories for every capture run; remove only generated captures from an earlier run before reusing these paths. Both directories must have a nonempty identical filename list including all required labels (both auth-expiry roots, all eight Scenario states, and ST3's reopened-empty-draft case once added). `diff -r tmp/dom-parity/before tmp/dom-parity/after` must print nothing. Duplicate labels fail rather than overwrite a file. The exact command (it must run every instrumented test, not only the ones titled `dom parity`):

```bash
JEP_DOM_PARITY_DIR=tmp/dom-parity/after fnm exec --using 20 npx playwright test \
  tests/ui/scenario_draft_history.spec.js tests/ui/scenario_draft_collaboration.spec.js \
  tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js --browser=chromium
```

The Scenario specs bundle `dashboard.jsx` from source. The `mockConfigSettings` tests must pass `sourceBundle: true` for parity runs, because the default serves the on-disk `frontend/dist/dashboard.js` and a stale dist gives a vacuous green (the `mockFirstRunDashboard` tests in `shared_department_groups.spec.js` already always serve the source bundle). The helper canonicalizes only identity attributes with a one-to-one mapping: distinct React IDs remain distinct and repeated references stay consistent. It validates unique IDREF targets against the full live document; text and input values remain significant. Its only missing-target exceptions are the exact current inactive Admin/Department/EPM tab-panel pairs, requiring a uniquely mounted selected sibling panel; unknown pairs or a missing selected panel fail. Only the app-owned EPM fetched-time status text is normalized. This covers the listed HTML/ARIA IDREF attributes, not CSS/SVG URL references; inventory those separately if a moved component uses them. The helper writes normalized HTML, so `diff -r` can be empty after a dist rebuild without masking reference changes.

## 7. Guard ledger (known guards, first break)

51 files reference `dashboard.jsx`: 19 UI specs bundle it with esbuild (none read it as text); of the 32 others, 4 mention it only in comments, `tests/test_codebase_structure_budgets.py` counts lines, and 27 are text guards. 16 are listed here; the other 11 (`test_dashboard_epic_icon_source_guards`, `test_dashboard_missing_labels_source_guards`, `test_eng_board_drop_source_guards`, `test_eng_sticky_stack_source_guards`, `test_initiative_grouping_source_guards`, `test_initiative_icon_source_guards`, `test_jira_export_source_guards`, `test_stats_controls_source_guards`, `test_stats_module_extraction_source_guards`, `test_story_subtasks`, `test_task_filter_menu_compaction_source_guards`) were run against SC1 + SC2 dry runs and none breaks on its own; re-run them at every commit regardless.

| Guard | Pins | First breaks | Disposition (done in the R4 that breaks it) |
| --- | --- | --- | --- |
| `tests/test_scenario_draft_history_source_guards.js` (18 tests) | poll `setInterval(poll, 5000)`, `SCENARIO_PRESENCE_TTL_MS = 30000`, drag effect deps, literals, declaration and JSX order; slice regexes end at markers in other slices; `:72` needs `scenarioDraggingIssueKey` directly before the drag effect; `:52` spans `pollScenarioDraftEvents` through `saveScenarioDraftVersion`; the "dist changes require src changes" test | SC2 (13 of 18 at once), SC3 (the `:52` span and the poll/TTL/drag pins land in different sub-hooks), SC4 (the JSX-order tests) | SC2: re-point the three invariant pins and the `:72`/`:52` regexes to `useScenarioPlanner.js`; delete order/shape guards naming the covering specs. SC3: re-point to `readOwnerSource(['frontend/src/scenario'])` inside each breaking R4. SC4: in R4a delete the JSX-order and shape tests (`{scenarioError && ...`, `{scenarioDraftMeta.conflict && (`, `{scenarioLoading &&`, `{scenarioDraftMeta.historyOpen && (`, the Save-button `onClick`) naming the Playwright assertions that cover each. The dist test stays untouched. |
| `tests/test_auth_isolation_source_guard.js` | exactly six `window.addEventListener('keydown', X)` calls each latch-checked; negative pins at `:12-36` (`/api/auth/*`, `session_expired`, `auth_required`, localStorage) read only `dashboard.jsx`; `:96-105` slices `saveEpmConfig` to `normalizeStatus` | PR0 (widen); ST2 (that slice empties) | Count per file over `dashboard.jsx` plus every file under `frontend/src/scenario/` and `frontend/src/settings/`; read the negative pins through `readOwnerSource` with an anchor; re-point the EPM slice in ST2. |
| `tests/test_frontend_api_source_guards.js` | `:1469` scenarioApi import; config/jiraCatalog imports; `:11-17` "save auth outcomes stay in dashboard"; `:1204` `saveGroupsConfig` marker plus `invalidate('settings-save')`; repo-wide no-`fetch(`/no-`/api/` scan (`:196-217`) | SC2, ST5 (stays green through ST1-ST4) | Re-point import and marker checks; keep the repo-wide scan unchanged. |
| `tests/test_excluded_capacity_stats_source_guards.js:841-855` | `buildScenarioPayload` regex assumes 12-space indent | SC2 | Re-point and make indentation-agnostic. |
| `tests/test_epm_settings_source_guards.js` | prop spreads vs child props (`:162-179`), declaration strings (`:157` teamSearchQuery, `:161` priorityWeightsDraft, `:251` hasDraftEpmScope, `:765` `await savePriorityWeightsConfig();`), hotkey order, fail-closed assignments (`:644-671`) and negative pins (`:673-679`), `:753` visibility call arguments ("JSON/basic Department visibility stays browser-local"), EPM seed only from the private view (`:688-694`), workspace-conflict sections exclude EPM (`:706-709`) | ST1 (`:159`, `:160`, `:161`), ST2 (11 tests), ST3 (`:157`, `:158`, `:753`), ST5 (`:765` and the permission pins) | Keep as pinned guards on the new owners: the EPM seed pin, the conflict-section exclusion, `:753`, and the prop-parity check rewritten for the new containers. Convert the fail-closed assignments and negative bans (`userCanEditSettings !== false`, `canEditSharedConfiguration \|\| userCanEditEpmConfig`) into unit assertions on the permissions code (ST5) with inputs `true`, `'true'`, `1`, `undefined`, `null`, and a missing key. Until ST5, keep the text pins on `dashboard.jsx` through `readOwnerSource`. |
| `tests/test_first_run_group_configuration.js` | `:74-97` capture/restore cover all 11 admin sections; declaration-order slices; `:544-573` `saveGroupsConfig`/`saveAllSettingsOnce` slices | ST4 (order slices), ST5 (`:544-573`) | Keep and re-point the section-coverage test: save map (3630-3642), capture (1284-1296), restore (4194-4226), and `FIRST_RUN_ADMIN_SECTION_KEYS` equal all 11 sections; the render snapshot (810-821) equals that set excluding `adminAccess` (10). Assert the exact projection; do not add `adminAccess` to the snapshot. Keep the reducer tests. |
| `tests/test_team_catalog_lifecycle_source_guards.js` | `} = useTeamCatalogLifecycle({`, `buildTeamAvailability({`, `recoverCatalogsAfterRejectedBoardSave` | ST3, ST5 | Re-point. |
| `tests/test_analytics_source_guards.js` | `:500-504` slices `retryFirstRunConfiguration` (5421) to `filteredGroupDrafts` (5449); `openFirstRunSetupChoice` slice bans analytics/`fetch(`/`onboardingDone`/`groupSearchQuery` | ST3 (end marker moves; `indexOf` returns -1 and the slice runs to end of file), ST4 | Re-point both slices; assert both markers exist. |
| `tests/test_onboarding_tour_utils.js` | `setCompletedModules`/`setGroupPreferences`, `onboardingBootstrapReady`, `openGroupManage(configurationTourRequested ? 'teams' : preferredSettingsTab)`, `data-onboarding-target="settings-launcher"` (gear JSX, 15091) | ST5 | Re-point. |
| `tests/test_epm_view_source_guards.js` | `epmConfigLoaded` state, `applySavedEpmConfig` call in `loadConfig`, "Open EPM settings" gear markup, `openEpmSettingsTab` | ST2, ST5 | Re-point. |
| `tests/test_epm_shell_source_guards.js` | `:60` `selectedView === 'eng' && showScenario` (stays); `:122` `dashboardSource.includes('await refreshEpmProjects();')` | ST2 (`:122`) | Re-point `:122`; `:60` must pass unmodified. |
| `tests/test_planning_action_source_guards.js:278` | exactly two `setCapacityEnabled(Boolean(...capacityConfigRequiresResolution...))` | ST5 (both sites, 3886 in `saveGroupsConfig` and 6863 in `loadConfig`, move) | Re-point and keep the count across the owner files. |
| `tests/test_eng_board_runtime_source_guards.js`, `tests/test_strict_eng_board_integration.js`, `tests/test_eng_board_source_guards.py` | `acceptedGroupsConfigRef.current = false;` (only at 2645, inside `loadGroupsConfig`), `acceptedBoardConfigRef.current = false;` (5 sites, 4 in `saveGroupsConfig`), the `loadSprints(false)` line, `if (showScenario) return scenarioJiraStoryKeys;` | ST3, ST5 | Re-point to the owners; the `showScenario` line stays in `dashboard.jsx`. |
| `tests/test_dashboard_alert_source_guards.js:88` | `isCatchUpMode` regex | never | Must pass unmodified. |
| `tests/test_codebase_structure_budgets.py` | `dashboard.jsx` ceiling | every R5 | Lower to the measured count. |

**Quirk pins (PR0).** `tests/test_extraction_quirk_pins.js` reads `dashboard.jsx` plus the owner directories through `readOwnerSource` and pins the quirks that no behavioral test sees. The analytics scope is exactly `dashboard.jsx` plus `frontend/src/scenario`, `frontend/src/settings`, and `frontend/src/epm`: at base `trackScenarioAction(` appears 17 times and `trackSettingsAction(` 33 times (20 in `dashboard.jsx`, 6 in `settings/useGroupVisibilityPreferences.js`, 7 in `settings/sharedExcludedCapacityToggle.js`). `ga4_tag_and_events.spec.js` calls `trackEvent` directly and does not exercise dashboard emissions, so "no analytics change" rests on these counts.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { readOwnerSource } = require('./frontend_source_helpers');

const OWNERS = ['frontend/src/dashboard.jsx', 'frontend/src/scenario', 'frontend/src/settings', 'frontend/src/epm'];
const count = (source, text) => source.split(text).length - 1;

test('analytics call counts do not change when code moves between owner files', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'trackScenarioAction(' });
    assert.equal(count(source, 'trackScenarioAction('), 17);
    assert.equal(count(source, 'trackSettingsAction('), 33);
});

test('scheduleScenarioEdgeUpdate keeps its late-assignment quirk', () => {
    const source = readOwnerSource(OWNERS, { anchor: 'let scheduleScenarioEdgeUpdate;' });
    const declaration = source.indexOf('let scheduleScenarioEdgeUpdate;');
    const layoutDeps = source.indexOf('scenarioLaneMeta, scheduleScenarioEdgeUpdate, perfEnabled]);');
    const assignment = source.indexOf('scheduleScenarioEdgeUpdate = React.useCallback(() => {');
    assert.equal(count(source, 'let scheduleScenarioEdgeUpdate;'), 1);
    assert.equal(count(source, 'scheduleScenarioEdgeUpdate = React.useCallback(() => {'), 1);
    // The layout effect's dependency array reads the variable before the assignment has run.
    assert.ok(declaration !== -1 && declaration < layoutDeps && layoutDeps < assignment);
});
```

## 8. PR-1: Completed plan landing and publication protocol

**Completed:** revision 3 landed in [PR #219](https://github.com/Juce-me/jira-execution-planner/pull/219), squash merge `c9ca8eff`, on 2026-10-01. The reviewed PR head was `831acf7a` (three plan commits; three documentation files). The 2026-10-02 fetch confirms the plan is present on `origin/main`. The former remote branch was deleted; its head is still fetchable through `refs/pull/219/head`. Do not repeat PR-1 or treat its former three-commit publication contract as the contract for another slice. Revision 4 is a local plan amendment until separately authorized publication is verified.

**Publication protocol for every remaining slice:**

- [ ] Fetch the intended base and record the exact base/head SHAs. Run `git status --short`, `git log --oneline -5`, `git log --oneline origin/main..HEAD`, and `git diff --name-status origin/main...HEAD`. Compare the complete commit list/count and every path against that slice's approved rungs and file map, including rebuilt dist and documentation. Stop on any mismatch and ask the operator; do not reuse PR-1's count of three or its docs-only file map. D12 controls any exception for local rung commits; root `AGENTS.md` remains authoritative until that decision is recorded.
- [ ] Run the Node suite, Python suite, full Chromium `tests/ui`, and committed-revision build at the exact head (`fnm exec --using 20 npm run build`, then `make verify-dist-clean`). There is no docs-only exception. A pre-existing failure is evidence to triage, not an automatic exemption; any waiver must be an explicit operator decision naming the failure and revision before publication.
- [ ] Wait for the operator's explicit publication go. Send the PR body through stdin with `gh pr create --body-file -`; prove the remote head equals the approved local head, read back the rendered body, visually inspect the PR page, verify the remote changed-file list and commit count, and report the actual CI state. If any post-publication check fails, report the publication as malformed and stop for operator direction.
- [ ] The operator merges. Fetch and confirm the slice's merge on `origin/main` before cutting the next branch.

---

## 9. PR0: Tooling, coverage, and baselines

**Branch:** `improvement/dashboard-extraction-tooling`. This PR changes tests, scripts, and docs only; no production `dashboard.jsx` change. Its dashboard ceiling stays at the measured base, and it installs the new owner/interface/aggregate accounting.

**Files:**
- Create: `scripts/extraction_lint/{eslint.config.mjs,check_hook_interfaces.mjs,check_move_conservation.mjs,tooling_controls.mjs,run.sh,negative_controls.sh}` (section 6), `scripts/extraction_lint/owner_budgets.json`, `tests/ui/dom_parity_helpers.js`, `tests/ui/dom_parity_helpers.spec.js`, `tests/frontend_source_helpers.js`, `tests/test_extraction_quirk_pins.js`
- Modify: `tests/test_codebase_structure_budgets.py`, `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/test_auth_isolation_source_guard.js`, `tests/README.md`, `docs/ontology.md`, this plan (baselines in section 1)

### Commit P0-1 (R2): extraction gate

- [x] Add the scripts from section 6 and the `tests/README.md` note. Measure the lint warning ceiling on PR0's unchanged current base; run `fnm exec --using 20 bash scripts/extraction_lint/run.sh`: it must exit 0 with zero errors and zero new enforced interface problems. Record the recursive module/site counts and any reviewed pre-existing interface baseline; do not require the obsolete 16-site dashboard-only count. Run `negative_controls.sh`: every control, including nested contracts and already-extracted-hook conservation, must print `ok`.
- [x] Implement the owner/interface/aggregate budget extensions specified in section 6, register current owners, and test the manifest schema/registration/dependency direction. Add the growth and nested render-phase controls; wire budget checks into `run.sh` and all new controls into `negative_controls.sh`. The printed core scripts are the starting implementation, not evidence these additional gates already pass.
- [x] Record the output of the gate and every control in the commit message.

**Validation scope:** none in the app. The operator reviews the scripts and the two run outputs.

### Commit P0-2 (R2): DOM parity helper and Settings captures

- [x] Create `tests/ui/dom_parity_helpers.js` (flat, like `eng_sticky_stack_helpers.js`; Playwright's default `testMatch` does not run it):

```js
const fs = require('node:fs');
const path = require('node:path');

// Opt-in snapshots; use a fresh gitignored directory for each capture run.
async function captureDomParity(page, label, selector) {
    const dir = process.env.JEP_DOM_PARITY_DIR;
    if (!dir) return;
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
        throw new Error(`captureDomParity(${label}): selector not found: ${selector}`);
    });
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document.getAnimations({ subtree: true });
        await Promise.race([
            Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
            new Promise((resolve) => window.setTimeout(resolve, 1200)),
        ]);
        await new Promise(requestAnimationFrame);
    });
    const html = await page.locator(selector).first().evaluate((root) => {
        const all = (node) => [node, ...node.querySelectorAll('*')];
        const sources = all(root);
        const clone = root.cloneNode(true);
        const copies = all(clone);
        const referenceAttributes = [
            'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns',
            'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto',
            'for', 'headers', 'list', 'form',
        ];
        const singleReferences = new Set(['for', 'list', 'form', 'aria-activedescendant']);
        const ids = new Map();
        const reactIds = new Map();
        // The full live document is authoritative: labels/descriptions may be outside the capture.
        // Assign by document order, retaining distinct identities and every repeated reference.
        for (const node of root.ownerDocument.querySelectorAll('[id]')) {
            const id = node.id;
            if (!ids.has(id)) ids.set(id, []);
            ids.get(id).push(node);
            if (/^_r_[0-9a-z]+_$/.test(id) && !reactIds.has(id)) reactIds.set(id, `_r_parity_${reactIds.size}_`);
        }
        const canonical = (id) => reactIds.get(id) || id;
        const targets = (value, attribute) => singleReferences.has(attribute)
            ? [value.trim()].filter(Boolean) : value.trim().split(/\s+/).filter(Boolean);
        // Existing Settings tab strips unmount inactive panels. Keep only these exact legacy
        // unselected-tab/panel pairs; the selected sibling must still have its unique live panel.
        // Evidence: AdminSettingsTabs.jsx, EpmSettings.jsx, dashboard.jsx Department tab strip.
        const deferredPanels = new Map([
            ['Admin settings sections', ['admin-settings', ['scope', 'source', 'mapping', 'capacity', 'priorityWeights', 'access', 'performance']]],
            ['Departments settings sections', ['department-settings', ['teams', 'labels', 'boards']]],
            ['EPM settings sections', ['epm-settings', ['scope', 'projects']]],
        ]);
        function isDeferredPanel(node, attribute, id) {
            if (attribute !== 'aria-controls' || node.getAttribute('role') !== 'tab' || node.getAttribute('aria-selected') !== 'false') return false;
            const strip = node.closest('[role="tablist"]');
            const pattern = deferredPanels.get(strip?.getAttribute('aria-label'));
            if (!pattern) return false;
            const [prefix, sections] = pattern;
            if (!sections.some((section) => node.id === `${prefix}-${section}-tab` && id === `${prefix}-${section}-panel`)) return false;
            const selected = [...strip.querySelectorAll('[role="tab"][aria-selected="true"]')];
            if (selected.length !== 1) return false;
            const active = selected[0];
            const section = sections.find((name) => active.id === `${prefix}-${name}-tab` && active.getAttribute('aria-controls') === `${prefix}-${name}-panel`);
            const panels = ids.get(`${prefix}-${section}-panel`) || [];
            return Boolean(section && panels.length === 1 && panels[0].getAttribute('role') === 'tabpanel');
        }
        sources.forEach((source, index) => {
            const copy = copies[index];
            if (source.id) {
                if (ids.get(source.id)?.length !== 1) throw new Error(`duplicate id in capture: ${source.id}`);
                copy.setAttribute('id', canonical(source.id));
            }
            for (const attribute of referenceAttributes) {
                if (!source.hasAttribute(attribute)) continue;
                const references = targets(source.getAttribute(attribute), attribute);
                for (const id of references) {
                    const matches = ids.get(id) || [];
                    if (!matches.length && !isDeferredPanel(source, attribute, id)) throw new Error(`dangling ${attribute}: ${id}`);
                    if (matches.length > 1) throw new Error(`duplicate ${attribute} target: ${id}`);
                }
                copy.setAttribute(attribute, references.map(canonical).join(' '));
            }
            // Normalize only DOM identity attributes. Text and input values, including strings
            // resembling React ids or fetch timestamps, remain significant.
            if (source.matches('input, select, textarea')) {
                if ('checked' in source) copy.setAttribute('data-parity-checked', String(source.checked));
                if ('value' in source) copy.setAttribute('data-parity-value', String(source.value));
            }
        });
        // This app-owned wall-clock readout is the only text normalization (EpmSettings.jsx).
        for (const meta of clone.querySelectorAll('#epm-settings-projects-panel .epm-projects-header-actions .group-modal-meta[aria-live="polite"]')) {
            for (const node of meta.childNodes) if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = node.textContent.replace(/(\bfetched )\d{1,2}:\d{2}(?:[\s\u202f]?[AP]M)?/gi, '$1HH:MM');
            }
        }
        return clone.outerHTML;
    });
    const normalized = html.replace(/></g, '>\n<');
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(dir, `${label}.html`);
    try {
        fs.writeFileSync(destination, `${normalized}\n`, { flag: 'wx' });
    } catch (error) {
        if (error.code === 'EEXIST') throw new Error(`captureDomParity(${label}): duplicate label or nonempty capture directory`);
        throw error;
    }
}

module.exports = { captureDomParity };
```

- [x] Add `tests/ui/dom_parity_helpers.spec.js` with synthetic browser controls for valid ID renumbering, repeated references, changed references to another existing target, dangling references, duplicate captured IDs, unique external targets, duplicate external targets, retained form properties/user text, opt-in no-op, duplicate capture-label rejection, the exact inactive-tab exception, rejected unknown pairs/missing selected panels, and scoped clock normalization. Valid renumbering compares equal; changed reference relationships compare unequal; invalid targets throw before writing. These 13 controls must pass before trusting parity captures. Do not broaden the inactive-panel allowlist to make new failures disappear.

- [x] In `tests/ui/settings_unified_save.spec.js` add `const { captureDomParity } = require('./dom_parity_helpers');` at the top and the opt-in test below. Top-level Settings tabs are `.group-modal-tab` buttons, but the nested sub-tab strips (Departments, Admin, EPM) use the same class, so the top-level locator is scoped by structure. `mockConfigSettings` already returns `userCanEditEpmConfig: true`, so the EPM tab renders; `sourceBundle: true` is required.

```js
test('dom parity capture: every Settings tab, then an edited tab', async ({ page }) => {
    test.skip(!process.env.JEP_DOM_PARITY_DIR, 'opt-in refactor check');
    await mockConfigSettings(page, { sourceBundle: true });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const topTabs = dialog.locator('.group-modal > .group-modal-tabs > .group-modal-tab');
    const topCount = await topTabs.count();
    for (let t = 0; t < topCount; t += 1) {
        const top = topTabs.nth(t);
        if (!(await top.isEnabled())) continue;
        const topName = (await top.innerText()).trim();
        await top.click();
        const subTabs = dialog.getByRole('tab');
        const subCount = await subTabs.count();
        if (subCount === 0) {
            await captureDomParity(page, `settings-${t}-${slug(topName)}`, '[role="dialog"]');
            continue;
        }
        for (let s = 0; s < subCount; s += 1) {
            const sub = subTabs.nth(s);
            if (!(await sub.isEnabled())) continue;
            const subName = (await sub.innerText()).trim();
            await sub.click();
            await captureDomParity(page, `settings-${t}-${slug(topName)}-${s}-${slug(subName)}`, '[role="dialog"]');
        }
    }
    // An edited tab: the dirty badge and the enabled Save button are what the ST1 isDirty hooks drive.
    // The top-level order is Admin, Departments, Connections, EPM; the loop above left the last sub-tab selected.
    await topTabs.filter({ hasText: 'Departments' }).click();
    await dialog.getByRole('tab', { name: 'Team groups' }).click();
    await dialog.getByPlaceholder('Group name').fill('Parity Group');
    await expect(dialog.getByText('Unsaved changes')).toBeVisible();
    await captureDomParity(page, 'settings-edited-departments', '[role="dialog"]');
});
```

- [x] Add `const { captureDomParity } = require('./dom_parity_helpers');` to `tests/ui/shared_department_groups.spec.js` (Settings already imports it above). Add `await captureDomParity(...)` lines (no-ops without the env var) **at the stated mid-test anchor**, not at the end of the test (several of these tests end with the dialog closed, which a capture would time out on). Pass `sourceBundle: true` in the `mockConfigSettings` call of the `settings_unified_save.spec.js` tests; the `mockFirstRunDashboard` tests already serve the source bundle.
  - `settings_unified_save.spec.js` `workspace conflict preserves later drafts and Keep mine rebases onto the server revision`: label `settings-workspace-conflict`, selector `[role="dialog"]`, immediately before `await banner.getByRole('button', { name: 'Keep mine' }).click();`.
  - `workspace auth expiry preserves the draft, Cancel confirmation, and safe re-auth path`: after the last assertion (the test ends on the sign-in lock, not on a Cancel confirmation): capture `.group-modal` as `settings-auth-expired-draft` and `[role="alertdialog"]` as `settings-auth-expired-recovery`. Assert both files exist and the draft snapshot retains the edited value; never reuse one label for two roots.
  - `Discard mine applies the server config and clears the dirty state`: label `settings-discard-mine`, selector `[role="dialog"]`, at the last assertion that shows the cleared dirty state while the dialog is still open (read the test; if it ends with the dialog closed, capture one assertion earlier).
  - `shared_department_groups.spec.js` `first-run department selection blocks group-scoped task loads until preferences are saved`: label `first-run-selection`, selector `[role="dialog"]`, after `await expect(page.getByText('Add at least one team or component before choosing this Department')).toBeVisible();` and before the `Continue` click.
  - `first-run saving locks every picker mutation and restores controls after failure`: label `first-run-saving-locked`, selector `[role="dialog"]`, after `await expect(picker.getByRole('button', { name: 'Add Department' })).toBeDisabled();` (the locked state, before the gate resolves).
  - `first-run Add Department opens the anchored configuration guide and Cancel restores the picker`: label `first-run-guide`, selector `.group-modal`, after `await expect(settingsDialog.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);` and before Cancel.
  - `first-run configuration guide target loss restores focus state and offers Return`: label `first-run-guide-target-loss`, selector `.first-run-configuration-guide`, after `await expect(guide.getByRole('button', { name: 'Return' })).toBeVisible();` and before the Return click.
- [x] Add `delivery-owner-field/config` to the zero-request startup assertions in `tests/ui/codebase_structure_smoke.spec.js` next to the four field endpoints it already lists (lines 1243-1252).
- [x] Prove the helper rejects a duplicate label without replacing the first file, and that the two auth-expiry labels produce two files containing the retained draft and recovery dialog respectively. Use a synthetic page; no live issue/user data.
- [x] Determinism check: run the instrumented specs (section 6 command) twice on the unmodified tree into fresh empty `tmp/dom-parity/run1` and `run2`; each run must produce a nonempty matching file list including both auth-expiry snapshots. `diff -r` must print nothing. Investigate differences before adding narrowly scoped normalization; never normalize away a draft, value, class, or missing DOM node. Do not continue with a nondeterministic capture. Clear only these generated captures before retrying; the helper deliberately rejects stale files.

**Validation scope:** none in the app; confirm the two-run diff is empty and the new assertions pass.

P0-2 verification (2026-10-02, unchanged production source at `ffeafb0e`):

- The helper matches the printed contract exactly. The 13 synthetic controls plus the scoped ENG startup/sticky smoke passed together: 14/14 in 9.9s. The added delivery-owner-field startup assertion remains zero requests.
- The section 6 four-spec Chromium command ran with four workers, separately into fresh `tmp/dom-parity/run1` and `run2`: 167/167 passed in 1.9m and 1.8m, respectively. Both runs contain the exact same 22 nonempty labels: 13 Settings section captures (7 Admin, 3 Departments, Connections, 2 EPM), edited Department, workspace conflict, discard, two distinct auth-expiry roots, and four first-run states. `diff -r tmp/dom-parity/run1 tmp/dom-parity/run2` exited 0 with no output. Both runs explicitly prove `Parity Group` in the live edited value, retained cleared-board/dirty auth draft, and separate sign-in recovery.
- Capture-only fixture details: enable the current Performance capability with a synthetic empty-history endpoint response and wait for its settled state; assert exact top/sub-tab inventories and enabled controls. Read source tab text with `textContent` because CSS uppercases `innerText`. Pin `Date` only in the opt-in all-tabs test so the existing Team-cache Updated readout is deterministic, with real timers preserved. No extra helper normalization or production change was made.
- Gate: 0 errors/120 existing warnings, 16 destructure sites/41 modules, 0 enforced and 0 owner-budget problems. Structure-budget tests: 2/2 passed. Node 20 build and `make verify-dist-clean` passed; generated output matches the base. The owner manifest and production source/dependencies remain unchanged. No move conservation residual arises in this characterization-only rung. Read-only review approved the interfaces/ownership/save boundaries and capture coverage.
- P0-1 (`4149b615`) was validated by the operator's 2026-10-02 continuation. P0-2 now stops for review of the 13 controls and the complete two-run comparison; no app exercise is required. P0-3 and later rungs remain unexecuted. Analytics impact remains internal characterization only, requiring no event or taxonomy change. Publication is not authorized.

### Commit P0-3 (R2): Scenario coverage that does not exist today

Existing Scenario specs never render an edge, a lane mode, an epic bar, focus, or a tooltip: every fixture has `dependencies: []`, `scenario_focus_positions.spec.js` is entirely commented out, and nothing tests the group-switch restore that SC1 changes. Add the following; all pass on the unmodified source.

- [ ] In `tests/ui/scenario_draft_history.spec.js` add `const { captureDomParity } = require('./dom_parity_helpers');`. Add opt-in `options.dependencies` and `options.issueOverrides` to the `/api/scenario` mock response; preserve the existing defaults for all other tests. Dependencies use `{ from, to }` keys (`validateDependencies`, `scenarioUtils.js:77`). Replace that response block with:

```js
        if (url.pathname === '/api/scenario' && method === 'POST') {
            scenarioPosts.push(requestBody(request));
            const payload = scenarioPayload();
            if (options.dependencies) payload.dependencies = options.dependencies;
            if (options.issueOverrides) {
                payload.issues = payload.issues.map(issue => ({
                    ...issue,
                    ...(options.issueOverrides[issue.key] || {}),
                }));
            }
            return json(route, payload);
        }
```

- [ ] Add the always-on characterization test below. Only captures are opt-in. Its fixture puts a forward dependency and two same-assignee overlapping tasks in one visible Team lane; the third asserted task is nonconflicting. The current renderer suppresses backward/overlapping dependency edges, so the dependent must start strictly after the prerequisite ends. Conflicts Only must retain two actual conflict bars, remove the nonconflicting task, and restore it when disabled.

```js
test('Scenario lane modes, forward edge, epic focus, tooltip, and conflict filter', async ({ page }) => {
    await installDashboardFromSource(page, {
        dependencies: [{ from: 'PROD-1', to: 'PROD-2' }],
        issueOverrides: {
            'PROD-2': {
                summary: 'Nonconflicting dependent work',
                team: 'Scenario Team 1',
                assignee: 'Dependency Owner',
                start: '2026-04-12',
                end: '2026-04-15',
            },
            'PROD-3': {
                summary: 'Overlapping scenario work',
                team: 'Scenario Team 1',
                assignee: 'Alpha Owner',
                start: '2026-04-07',
                end: '2026-04-10',
            },
        },
    });
    await openScenario(page);
    const root = '.scenario-fullbleed';
    const laneButton = name => page.locator('.scenario-toggle-group').getByRole('button', { name, exact: true });
    const original = page.locator('.scenario-bar', { hasText: 'Build product scenario path' }).first();
    const overlapping = page.locator('.scenario-bar', { hasText: 'Overlapping scenario work' }).first();
    const nonconflicting = page.locator('.scenario-bar', { hasText: 'Nonconflicting dependent work' }).first();

    // All teams starts collapsed. This fixture puts all three asserted bars in one lane.
    const laneLabel = page.locator('.scenario-lane-label').first();
    await expect(laneLabel).toHaveAttribute('aria-expanded', 'false');
    await captureDomParity(page, 'scenario-team-collapsed-lanes', root);
    await laneLabel.click();
    await expect(laneLabel).toHaveAttribute('aria-expanded', 'true');
    await expect(original).toBeVisible();
    await expect(overlapping).toBeVisible();
    await expect(nonconflicting).toBeVisible();
    // The dependent starts strictly after the prerequisite ends, so the edge can render.
    await expect(page.locator('.scenario-edge').first()).toBeVisible();
    await captureDomParity(page, 'scenario-team-expanded-lane-edges', root);

    await laneButton('Epic').click();
    const epicBar = page.locator('.scenario-epic-bar').first();
    await expect(epicBar).toBeVisible();
    await captureDomParity(page, 'scenario-epic-lanes', root);
    await epicBar.click();
    await expect(page.locator('.scenario-focus-indicator')).toBeVisible();
    await captureDomParity(page, 'scenario-epic-focus', root);
    await page.keyboard.press('Escape');
    await expect(page.locator('.scenario-focus-indicator')).toHaveCount(0);

    await laneButton('Assignee').click();
    await expect(page.locator('.scenario-lane-label').first()).toContainText('Alpha Owner');
    await captureDomParity(page, 'scenario-assignee-lanes', root);
    await laneButton('Team').click();

    await original.hover();
    await expect(page.locator('.scenario-tooltip.visible')).toBeVisible();
    await captureDomParity(page, 'scenario-tooltip', root);

    await expect(original).toHaveClass(/assignee-conflict/);
    await expect(overlapping).toHaveClass(/assignee-conflict/);
    await expect(nonconflicting).not.toHaveClass(/assignee-conflict/);
    const conflictsOnly = page.getByRole('button', { name: 'Conflicts Only', exact: true });
    await conflictsOnly.click();
    await expect(original).toBeVisible();
    await expect(overlapping).toBeVisible();
    await expect(page.locator('.scenario-bar')).toHaveCount(2);
    await expect(nonconflicting).toHaveCount(0);
    await captureDomParity(page, 'scenario-conflicts-only', root);

    await conflictsOnly.click();
    await expect(original).toBeVisible();
    await expect(overlapping).toBeVisible();
    await expect(nonconflicting).toBeVisible();
    await captureDomParity(page, 'scenario-conflicts-restored', root);
});
```

Run the test headed once before the commit and confirm each asserted state is on screen (collapsed Team lane, visible forward edge and both endpoints after expansion, Epic bars/focus, tooltip, and retained conflict bars). A capture of only an empty conflict result is insufficient. Run it with the real helper twice into fresh directories: both runs must pass, produce the eight stated Scenario labels, and have an empty `diff -r`.
- [ ] In `tests/ui/scenario_draft_collaboration.spec.js` add `const { captureDomParity } = require('./dom_parity_helpers');` at the top, then add `await captureDomParity(page, '<label>', '.scenario-fullbleed');` (no-op without the env var) after the last assertion of these existing tests: `presence strip renders remote user and polling stops after scope switch` (`scenario-presence`), `lock warning shows same-issue advisory conflict during drag` (`scenario-lock-warning`), `stale draftRevision shows recovery actions and keeps dirty local edits` (`scenario-conflict-recovery`), `write-back stays preview-only and blocked by the gate` (`scenario-writeback-preview`).
- [ ] In the same file add the group-switch-and-back test SC1 depends on (it reuses `installDashboard`, `openScenario`, and the `Select group` / `.group-dropdown-option` pattern from `switchScenarioToAlternateGroup`; the fixture's groups are `Default` (`grp-default`) and `Alternate` (`grp-alt`)):

```js
test('group switch away and back restores Scenario lane mode', async ({ page }) => {
    const calls = await installDashboard(page);
    await openScenario(page);
    await page.locator('.scenario-toggle-group').getByRole('button', { name: 'Assignee', exact: true }).click();
    await expect(page.locator('.scenario-toggle-group .scenario-toggle.active')).toHaveText('Assignee');
    await switchScenarioToAlternateGroup(page, calls);
    await page.getByLabel('Select group').click();
    await page.locator('.group-dropdown-option', { hasText: 'Default' }).click();
    await page.getByRole('radio', { name: 'Scenario' }).click();
    await expect(page.locator('.scenario-toggle-group .scenario-toggle.active')).toHaveText('Assignee');
    expect(calls.unexpected).toEqual([]);
});
```

Run it against the unmodified source first. If the restored lane mode differs from the assertion, the test has found the real current behavior: assert that behavior (and say so in the commit message), because SC1 must preserve what exists.

**Validation scope:** none in the app; run the three Scenario specs headed once and confirm each new test exercises what its title says.

### Commit P0-4 (R2): Guard helper, auth-isolation widening, quirk pins

- [ ] Create `tests/frontend_source_helpers.js` (flat, matching `tests/css_source_helpers.js`):

```js
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function listSourceFiles(relative) {
    const absolute = path.join(repoRoot, relative);
    if (fs.statSync(absolute).isFile()) return [absolute];
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) return listSourceFiles(child);
        return /\.(jsx?|mjs)$/.test(entry.name) ? [path.join(repoRoot, child)] : [];
    });
}

// Source of every file that may own a moved cluster. A retained negative pin must pass an
// anchor (a string that exists today) so it cannot go vacuous when the code moves.
function readOwnerSource(relatives, { anchor } = {}) {
    const source = relatives.flatMap(listSourceFiles).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    if (anchor && !source.includes(anchor)) throw new Error(`owner source is missing anchor: ${anchor}`);
    return source;
}

module.exports = { readOwnerSource, repoRoot };
```

- [ ] Widen `tests/test_auth_isolation_source_guard.js`: run the existing handler lookup **per file** (it uses `source.lastIndexOf` per file) over `frontend/src/dashboard.jsx` and every `.js`/`.jsx` file under `frontend/src/scenario/` and `frontend/src/settings/`; assert the summed count is exactly six and each handler checks `readPendingAuthenticationRequired()` before its first `event.key`; read the negative pins at `:12-36` through `readOwnerSource(['frontend/src/dashboard.jsx', 'frontend/src/scenario', 'frontend/src/settings'], { anchor: 'readPendingAuthenticationRequired' })`. It passes with no source change.
- [ ] Create `tests/test_extraction_quirk_pins.js` exactly as printed in section 7 ("Quirk pins"); it passes on the unmodified tree.

**Validation scope:** none in the app; the operator confirms the Node suite passes.

### Runtime-work baseline (PR0 characterization)

Extend `tests/ui/scenario_draft_history.spec.js` with a reusable source-bundle probe on the same synthetic fixture and eight named Scenario transitions used by DOM parity. Run fresh Chromium contexts twice at both the recorded base and candidate SHAs. Enable existing counters with `/?perf=1`, keep normal polling/presence timers active, and permit the fixture's root route to accept the query. There is no production snapshot/reset API: the source-bundle harness applies an **in-memory test-only** esbuild adapter, anchored exactly once immediately after `const perfStateLastRef = useRef({});`:

```js
if (perfEnabled) window.__JEP_EXTRACTION_PERF__ = () => ({ ...perfCountersRef.current });
```

The adapter never modifies tracked production source or generated dist, adds no hook/effect/state update, and writes no counters. Missing/duplicate anchors fail. Read copied snapshots after startup/Run Scenario and each settled action: `renders`, `edgeRequests`, `edgeFrames`, `edgeComputes`, `layoutReads`, `scrollReads`, `laneStacking`, `statsBuild`. Reset a measurement phase by saving a copy and subtracting it from the next copy; never reset production refs or logger baselines. After the eight phases, take a settled snapshot, leave the UI untouched for 5,000 ms, and capture `scenario-idle-5s`. Export per-phase deltas and cumulative snapshots to a fresh ignored directory with exclusive creation, exact SHA, fixture/runtime/browser details and command; require all labels exactly once and no unexpected API requests.

Compare repeat-run observations at the same runtime and fixture. Investigate extra rendering, scheduling, lane/layout or idle work, duplicate listeners/polls/SSE, and render loops; unexplained differences block the source rung for operator review. Explain concurrent-timer/frame-coalescing variation from the raw samples rather than adding arbitrary tolerances. These counters cover existing instrumentation, not all component renders/DOM reads, request counts, CPU duration, or production-scale performance: `edgeRequests` counts scheduling requests, `edgeFrames` accepted frames, and layout/scroll counts instrumented callbacks. Do not claim latency improvements from file size or test wall time.

Historical-source feasibility probes on `831acf7a` passed twice, including all eight transitions and the idle phase. Both idle deltas were renders 4, scheduling requests 10, frames/computes 2, layout/scroll callbacks 2, lane stacking 4, stats builds 0; seven transition deltas matched and Epic-focus counts varied. Positive idle work is therefore preserved behavior, not an automatic failure. PR0 must commit the reusable probe and remeasure its actual-base baseline; these samples are not its acceptance envelope. Rebase refreshes that baseline. Run this named source-bundle probe for each Scenario-affecting R4 and at final acceptance.

### Commit P0-5 (R2): Baselines

- [ ] Install and run the reusable runtime-work probe above twice against the unchanged PR0 base; record raw action/idle samples, counter meaning, command and source anchor. Run the 13 DOM-helper controls and all added growth/timing controls; no claim of coverage from the historical probes alone.
- [ ] At the recorded PR0 base SHA, refresh the source/hook/budget counts and run the recursive extraction gate, full Chromium `tests/ui`, Node suite, and Python suite. Record pass/fail/skip counts, wall time, and every failure by name in section 1; keep earlier counts labelled historical. Failures are not automatically excluded from later gates: resolve them, or obtain an explicit operator waiver naming each affected check and exact revision before publication. List any such waiver in every affected PR description.

**Validation scope:** review the recorded baselines; no app check.

### Commit P0-6 (R5): Ontology and docs

- [ ] Update `docs/ontology.md`: add entries "Scenario Planner ownership" and "Settings state ownership" (canonical names, aliases, entry points in `dashboard.jsx` today, this plan, tests, relationships `depends on`/`produces`) with a verification date; update the existing entries that cite `dashboard.jsx` ownership (Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, "Board scope load authority" at line 76, "Startup config timeout" at line 18) and the Coverage line; confirm every cited path resolves.
- [ ] Propose to the operator (do not edit unasked) a line for root `AGENTS.md` section 10 Commands naming `scripts/extraction_lint/run.sh`; section 10 is a preserved section and needs approval.

**Validation scope:** review the ontology text; no app check.

---

## 10. Scenario slices

All Scenario hook and component files live in `frontend/src/scenario/`. The Scenario dead-code list (R1; every name appears once in `dashboard.jsx` and nowhere else in `frontend/src` or `tests`): `scenarioBottleneckLanes`, `scenarioDeadlineLeft`, `scenarioHasAssignees`, `scenarioIsSingleTeamFocus`, `scenarioUnschedulable`, and the value of `scenarioDraftEvents` only if every `setScenarioDraftEvents` call is batched with another update (otherwise leave the pair, D6). `scenarioUndoVersion` stays. `isUnscheduled` is a separate pre-existing dead declaration outside this list; mention it in the PR, do not delete it.

### SC1: State container and per-group seam

**Branch:** `improvement/scenario-state-container`. Targeted specs: the three Scenario specs, `tests/ui/codebase_structure_smoke.spec.js`.

**Files:** create `frontend/src/scenario/useScenarioState.js`, `frontend/src/scenario/scenarioGroupState.js`, `tests/test_scenario_group_state.js`; modify `frontend/src/dashboard.jsx`, guards, budget test, docs.

**Anchors.** Container cells: `const [scenarioCurrentUserIdentity, setScenarioCurrentUserIdentity] = useState({` (463), `const [scenarioLoading, setScenarioLoading] = useState(false);` (998) through `const [scenarioEdgeRender, setScenarioEdgeRender] = useState({ width: 0, height: 0, paths: [] });` (1096) excluding `searchInputRef` (1011) and `let scheduleScenarioEdgeUpdate;` (1081), and `const scenarioRefreshNonceRef = useRef(0);` (1151).

**Interfaces.** `useScenarioState({ initialLaneMode })` returns, under the same names as today, every `useState` value and setter and every `useRef` of those cells (86 names before R1 removes dead declarations: 29 `useState`, 27 `useRef`, 1 `useMemo`). It also returns `scenarioGroupValues`, a `useMemo` object of the 14 per-group fields whose identity changes iff one of them changes. The 14 fields (from `buildDefaultGroupState` 5975-5998, the snapshot literal 6074-6087, the apply block 6189-6212, the memo deps 6292-6305): `scenarioData`, `scenarioError`, `scenarioLaneMode`, `scenarioCollapsedLanes`, `scenarioEpicFocus`, `scenarioRangeOverride`, `scenarioScrollTop`, `scenarioScrollLeft`, `scenarioViewportHeight`, `scenarioHoverKey`, `scenarioFlashKey`, `scenarioLayout`, `scenarioEdgeRender`, `scenarioTooltip`. `scenarioGroupState.js` exports `SCENARIO_GROUP_STATE_KEYS`, `buildDefaultScenarioGroupState(initialLaneMode)`, `applyScenarioGroupState(setters, snapshot)`, `resetScenarioTransientRefs(refs)`. The container has no effects and takes only `initialLaneMode` (all initializers depend on `savedPrefsRef` at 371).

In `App()` keep `const scenarioState = useScenarioState({ initialLaneMode: savedPrefsRef.current.scenarioLaneMode ?? 'team' });` followed by `const { ...every name App still reads } = scenarioState;` (the checker follows the alias). Prune names that no `App()` code reads after the seam (for example `scenarioScrollLeft`, which loses its reader).

**Commit ladder:**

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Delete the Scenario dead declarations above. | SM-S. |
| R4a | Create the two files and `tests/test_scenario_group_state.js` (below, written first and run red against the missing module, then green), wire `dashboard.jsx`: the container call at the position of the earliest declaration (463); the 14 default entries become `...buildDefaultScenarioGroupState(savedPrefsRef.current.scenarioLaneMode)`, the 14 snapshot entries `...scenarioGroupValues`, the 14 memo deps `scenarioGroupValues`; the nine-ref reset lines (6110-6118 and 6120-6128; **not** 6119 `alertDismissedRef.current = false;` and **not** 6129 `epicRefMap.current = new Map()`, which stay) become `resetScenarioTransientRefs({ ...nine refs })` at the same position; the 14 setter lines (6189-6212) become one `applyScenarioGroupState({ ...fifteen setters }, nextState)` at the position of the first setter line, and the original line 6232 `setScenarioLoading(false);` is **deleted** because the apply function includes it. Remove the orphaned `createUndoStack` import (used only at 1065). Gate, conservation check (itemise the seam edits), dist, parity. | SM-S, with emphasis on group switch away and back, and lane mode persisting. |
| R5 | Budget, lint ceiling, ontology, status. `test_stats_module_extraction_source_guards.js` slices the per-group seam (its markers survive; verify). | Review the diff. |

**Tests** (`tests/test_scenario_group_state.js`; the expectations are copied from the base code, so they also serve as the oracle; the last two cases kill the mutants that survived review: `||` changed to `??`, and an unconditional `cancelAnimationFrame`):

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../frontend/src/scenario/scenarioGroupState.js');

const EXPECTED_KEYS = [
    'scenarioData', 'scenarioError', 'scenarioLaneMode', 'scenarioCollapsedLanes', 'scenarioEpicFocus',
    'scenarioRangeOverride', 'scenarioScrollTop', 'scenarioScrollLeft', 'scenarioViewportHeight',
    'scenarioHoverKey', 'scenarioFlashKey', 'scenarioLayout', 'scenarioEdgeRender', 'scenarioTooltip',
];
const SETTER_NAMES = [...EXPECTED_KEYS, 'scenarioLoading'].map((key) => `set${key[0].toUpperCase()}${key.slice(1)}`);

function recordingSetters() {
    const calls = {};
    const setters = {};
    for (const name of SETTER_NAMES) setters[name] = (value) => { calls[name] = value; };
    return { calls, setters };
}

function nineRefs(overrides = {}) {
    return {
        scenarioIssueRefMap: { current: new Map([['A-1', {}]]) },
        scenarioEdgeUpdatePendingRef: { current: true },
        scenarioFocusRestoreRef: { current: { x: 1 } },
        scenarioSkipAutoCollapseRef: { current: true },
        scenarioTeamCollapseInitRef: { current: true },
        scenarioEdgeFrameRef: { current: 11 },
        scenarioScrollFrameRef: { current: 12 },
        scenarioResizeFrameRef: { current: 13 },
        scenarioPendingScrollRef: { current: { top: 1 } },
        ...overrides,
    };
}

test('group state keys match the 14 fields the App snapshot carries', async () => {
    const { SCENARIO_GROUP_STATE_KEYS } = await load();
    assert.deepEqual([...SCENARIO_GROUP_STATE_KEYS], EXPECTED_KEYS);
});

test('default group state mirrors the previous buildDefaultGroupState literal', async () => {
    const { buildDefaultScenarioGroupState } = await load();
    assert.deepEqual(buildDefaultScenarioGroupState('assignee'), {
        scenarioData: null,
        scenarioError: '',
        scenarioLaneMode: 'assignee',
        scenarioCollapsedLanes: {},
        scenarioEpicFocus: null,
        scenarioRangeOverride: null,
        scenarioScrollTop: 0,
        scenarioScrollLeft: 0,
        scenarioViewportHeight: 0,
        scenarioHoverKey: null,
        scenarioFlashKey: null,
        scenarioLayout: { width: 0, height: 0 },
        scenarioEdgeRender: { width: 0, height: 0, paths: [] },
        scenarioTooltip: {
            visible: false, x: 0, y: 0, summary: '', key: '', sp: null, note: '', assignee: null, team: null,
        },
    });
    assert.equal(buildDefaultScenarioGroupState(undefined).scenarioLaneMode, 'team');
});

test('applying a null snapshot calls all 15 setters with the old fallbacks', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, null);
    assert.deepEqual(Object.keys(calls).sort(), [...SETTER_NAMES].sort());
    assert.equal(calls.setScenarioData, null);
    assert.equal(calls.setScenarioError, '');
    assert.equal(calls.setScenarioLaneMode, 'team');
    assert.deepEqual(calls.setScenarioCollapsedLanes, {});
    assert.equal(calls.setScenarioEpicFocus, null);
    assert.equal(calls.setScenarioRangeOverride, null);
    assert.equal(calls.setScenarioScrollTop, 0);
    assert.equal(calls.setScenarioScrollLeft, 0);
    assert.equal(calls.setScenarioViewportHeight, 0);
    assert.equal(calls.setScenarioHoverKey, null);
    assert.equal(calls.setScenarioFlashKey, null);
    assert.deepEqual(calls.setScenarioLayout, { width: 0, height: 0 });
    assert.deepEqual(calls.setScenarioEdgeRender, { width: 0, height: 0, paths: [] });
    assert.equal(calls.setScenarioTooltip.visible, false);
    assert.equal(calls.setScenarioLoading, false);
});

test('applying a snapshot passes captured values through and always clears loading', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, { scenarioLaneMode: 'assignee', scenarioScrollTop: 40, scenarioError: 'x' });
    assert.equal(calls.setScenarioLaneMode, 'assignee');
    assert.equal(calls.setScenarioScrollTop, 40);
    assert.equal(calls.setScenarioError, 'x');
    assert.equal(calls.setScenarioLoading, false);
});

test('falsy snapshot values fall back with || (not ??), as the old applyGroupState did', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, { scenarioLaneMode: '', scenarioScrollTop: null, scenarioError: undefined });
    assert.equal(calls.setScenarioLaneMode, 'team');
    assert.equal(calls.setScenarioScrollTop, 0);
    assert.equal(calls.setScenarioError, '');
});

test('resetScenarioTransientRefs clears refs and cancels pending animation frames in order', async () => {
    const { resetScenarioTransientRefs } = await load();
    const cancelled = [];
    globalThis.window = { cancelAnimationFrame: (id) => cancelled.push(id) };
    try {
        const refs = nineRefs();
        resetScenarioTransientRefs(refs);
        assert.equal(refs.scenarioIssueRefMap.current.size, 0);
        assert.equal(refs.scenarioEdgeUpdatePendingRef.current, false);
        assert.equal(refs.scenarioFocusRestoreRef.current, null);
        assert.equal(refs.scenarioSkipAutoCollapseRef.current, false);
        assert.equal(refs.scenarioTeamCollapseInitRef.current, false);
        assert.equal(refs.scenarioEdgeFrameRef.current, null);
        assert.equal(refs.scenarioScrollFrameRef.current, null);
        assert.equal(refs.scenarioResizeFrameRef.current, null);
        assert.equal(refs.scenarioPendingScrollRef.current, null);
        assert.deepEqual(cancelled, [11, 12, 13]);
    } finally {
        delete globalThis.window;
    }
});

test('resetScenarioTransientRefs does not cancel frames that are not pending', async () => {
    const { resetScenarioTransientRefs } = await load();
    const cancelled = [];
    globalThis.window = { cancelAnimationFrame: (id) => cancelled.push(id) };
    try {
        const refs = nineRefs({
            scenarioEdgeFrameRef: { current: null },
            scenarioScrollFrameRef: { current: null },
            scenarioResizeFrameRef: { current: null },
        });
        resetScenarioTransientRefs(refs);
        assert.deepEqual(cancelled, []);
    } finally {
        delete globalThis.window;
    }
});
```

`resetScenarioTransientRefs` mirrors the original truthy checks (`if (ref.current) { cancelAnimationFrame(ref.current); ref.current = null; }`). The container server-render probe (same R4a) asserts the defaults whose values are not obvious (`scenarioSummaryHidden === true`, `scenarioEdgeRender`, `scenarioDraftMeta.dirtyState === 'clean'`, `scenarioLaneMode` from `initialLaneMode`) and uses the render-probe pattern of `tests/test_eng_board_render.js`.

### SC2: One verbatim Scenario hook

**Branch:** `improvement/scenario-planner-hook`. Targeted specs: `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js` (including the auth-lock test at `:1111`), `tests/ui/codebase_structure_smoke.spec.js:1184-1310`, `tests/ui/eng_group_board_view.spec.js`, `tests/ui/onboarding_tour.spec.js`.

**Why one hook:** the Scenario statements 7262-7794 are all effect-free arrow-function constants, and every Scenario effect (9156-11589) is contiguous with no non-Scenario effect between 9137 and 11601. Moving the runs verbatim, in original order, into one hook called once at the position of 9137 preserves effect order by construction and avoids cross-hook cycles. The first review found that splitting by feature at this stage creates a draft/realtime cycle (`postScenarioRealtimeJson`) and an ordering failure (`scenarioIssueByKey`, declared at 9451, is read by the drag effect's deps at 9744). The SC1 + SC2 dry run confirmed: lint clean, both bundles build, all 136 effects keep their order, and the 7860 effect is the only early reference to a hook output (deferred).

**Files:** create `frontend/src/scenario/useScenarioPlanner.js` (`.js`, no JSX); modify `frontend/src/dashboard.jsx`, the guards in section 7, budget test, docs.

**Moves, in original order, with anchors.**

| Lines | First statement | Last statement |
| --- | --- | --- |
| 1081 | `let scheduleScenarioEdgeUpdate;` (placed before its first reader in the hook body) | same |
| 5662-5686 | `const matchesScenarioSearch = (issue, query) => {` | closing `};` of `registerScenarioIssueRef` |
| 7262-7794 | `const fetchScenarioCsrfToken = () =>` | closing `};` of `handleScenarioBarMouseDown` |
| 8107-8112 | `const scenarioTeamIds = React.useMemo(() => {` (read only at 7508 and 7528, both inside moved code, so it moves unconditionally) | `}, [isAllTeamsSelected, selectedTeamSet, teamOptions]);` |
| 9137-11601 | `const scenarioRawIssues = scenarioData?.issues \|\| EMPTY_ARRAY;` | `}, [scenarioEpicFocus]);` |

It stays out: the JSX, the SC1 seam, the clear/reset entry points at 2086-2090, 6453-6478, 7118-7121, the view-mode effects 6497-6532, and the 7860 effect.

**Interface (dry-run result; compare, do not hand-write).** `useScenarioPlanner({ scenarioState, BACKEND_URL, EMPTY_ARRAY, EMPTY_OBJECT, ...30 App-scope inputs })`. The hook destructures the 70 container names it uses (counted before R1 removes dead declarations) from `scenarioState` inside its body. The 30 App-scope inputs with their base declaration lines: `activeGroupId` 621, `activeGroup` 5699, `selectedSprint` 473, `selectedSprintInfo` 1162, `selectedSprintState` 2129, `excludedEpicSet` 8141 (the latest), `trackScenarioAction` 1215, `isCompletedSprintSelected` 2130, `registerSprintFetch` 5688, `releaseConnectionRecoveryOwnership` 430, `setConnectionRecoveryNotice` 433, `pendingConnectionRecoveryRef` 428, `cleanupSprintFetch` 5694, `isAllTeamsSelected` 7972, `teamOptions` 7938, `selectedTeamSet` 7971, `jiraUrl` 828, `availableSprints` 602, `groupsLoading` 610, `pendingShellAuthResumeRef` 871, `connectionRecoveryScenarioStartedRef` 432, `setConnectionRecoveryStatus` 435, `showScenario` 834, `sprintsLoading` 603, `connectionRecoveryStagedRevision` 436, `visibleControlGroups` 1243, `searchQuery` 840, `normalizeEpicKey` 2457, `perfEnabled` 377, `perfCountersRef` 381. All are declared before the call site at 9137. `engWorkspaceConfigured` (12074) is never an input: the moved code does not read it. The hook imports 33 names (from `authApi`, `scenarioApi`, `authRequired`, `scenarioDraftOverrides`, `dashboardAnalytics`, `connectionScenarioRecovery`, `useConnectionRecovery`, `scenarioUtils`, `scenarioLaneUtils`, `jiraExportUtils`) and `React`'s `useEffect`. It returns an object literal of 67 names (65 used by the JSX, plus `scenarioJiraEpicKeys` and `scenarioJiraStoryKeys`), among them `runScenario` (read by the 7860 effect) and `scenarioHasUnsavedChanges`; the other values the recovery snapshot at 14440-14459 reads (`scenarioDraftMeta`, `scenarioOverrides`, `scenarioEditMode`, `scenarioTimelineRef`) come from the container, not from the planner. The call site is the position of 9137, as `const scenario = useScenarioPlanner({ ... }); const { ...67 names } = scenario;` (the checker follows the alias, and SC4 passes `scenario` on as one object).

**Commit ladder:**

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | none (SC1 deleted the Scenario dead code). | n/a |
| R4a | Create `useScenarioPlanner.js` with the claimed ranges verbatim and wire the call site; the hook's server-render probe asserts `Object.keys(result)` equals the 67 names; pure tests for any helper with no ref/DOM/closure reads (`scenarioDraftIdleActionState`, `buildScenarioDraftScope` if pure; oracle method: copy the legacy body into a throwaway script, run synthetic fixtures, store the outputs next to the test); re-point the guards (section 7: `test_scenario_draft_history_source_guards.js`, `test_excluded_capacity_stats_source_guards.js:841-855`, `test_frontend_api_source_guards.js:1469`); prune orphan imports and the `App()` destructure; rebuild dist. Gate, closure scan, conservation check (SC1 + SC2 together left 17 residual statements in the dry run, 5 removed and 12 new: the container call and destructure, the seam statements, the planner call site and destructure, the hook's container-name destructure and return object; itemise every one in the commit message, and treat any unlisted line as a defect), effect order `identical`, parity. | SM-S in full; additionally Escape inside and outside History, Ctrl+Z, and the connection-recovery step. |
| R5 | Budget (about 15,133 expected; record the measured value), lint ceiling, ontology, status. | Review the diff. |

**PR-specific checks:** `useConnectionScenarioRecovery` keeps its position after the auth-resume effect at 6367-6412; the Escape handler (10011) and undo keydown (9742) keep their relative order (the single hook preserves it); the six keydown listeners still total six; no `fetch(`/`/api/` literal in the new file; `new window.EventSource(buildScenarioDraftEventsStreamUrl(...))` stays; the ENG load effect cleanup still aborts an in-flight `runScenario` through `registerSprintFetch`/`cleanupSprintFetch` passed in as inputs. Expected `dashboard.jsx` change: about -3,000 lines.

### SC3 (gate G1): Split the hook inside `frontend/src/scenario/`

**Branch:** `improvement/scenario-planner-split`. **Files:** create the sub-hook files under `frontend/src/scenario/` (`useScenarioDraft.js`, `useScenarioRealtime.js`, `useScenarioDerived.js`, `useScenarioDrag.js`, `useScenarioHistory.js`, `useScenarioLayout.js`) and `scenarioLayout.js`; modify `useScenarioPlanner.js`, `scenarioLaneUtils.js`, `scripts/extraction_lint/owner_budgets.json`, the guards in section 7, docs. **Targeted specs:** the three Scenario specs and `codebase_structure_smoke.spec.js:1184-1310`, plus owner/interface/aggregate budget checks. G1 is approved; start after SC2 merges and the current-source partition is verified. `dashboard.jsx` is not touched: `useScenarioPlanner` keeps returning the same flat object, so the App call site, dashboard budget, and SC4 props are unaffected. New owners and scaffolding remain subject to the common budgets.

**Partition** (contiguous runs of the original order; the first review found zero provider-called-later edges and the dry run confirmed the edges H2→H1, H4→H1/H2/H3, H5→H1, H6→H3 with no cycle; each sub-hook is called in this order inside `useScenarioPlanner`): H1 draft (7262-7303, 7427-7679, 9143-9199 incl. `scenarioHasStoredDraftScope` and `scenarioActiveDraftId`, and `scenarioTeamIds` 8107-8112), H2 realtime (7305-7425, 7696-7747, 9200-9375), H3 derived memos (9137-9142, 9376-9628 incl. `scenarioIssueByKey`, and `matchesScenarioSearch` 5662-5677), H4 drag/edit mode (7681-7694, 7749-7794, 9629-9746), H5 history (9748-10350), H6 layout (10352-11601 incl. `scenarioVisibleExportIssues` 10685-10702, `areScenarioCollapsedLanesEqual`, `areScenarioEdgeRendersEqual`, `registerScenarioIssueRef` 5679-5686, and the `let scheduleScenarioEdgeUpdate` with its assignment). Each sub-hook returns an object literal.

**Pure extraction:** `frontend/src/scenario/scenarioLayout.js` receives only code with no DOM, ref, `performance`, or `console` reads. `scenarioLaneStacking` writes `perfCountersRef` and calls `performance.mark` (10559-10562) and `scenarioPositions` has a development-only `console.debug` (10893), so split the pure core from the instrumented wrapper (instrumentation stays in the hook). `computeScenarioEdgePaths` and anything using `scenarioIssueRefMap` or `getBoundingClientRect` stay in the hook. Extend `frontend/src/scenario/scenarioLaneUtils.js` and `tests/test_scenario_lane_utils.js` rather than creating a parallel module where the functions overlap. Oracle fixtures (synthetic) cover a single team, several teams, assignee mode, collapsed lanes, overlapping bars, and the empty case.

**Ladder:** R2 (oracle fixture data as JSON generated from the current functions, with no test that imports a new module), then one R4 per sub-hook in the order above, each creating the sub-hook, its unit tests (pure functions against the stored oracle outputs), and re-pointing the guards it breaks to `readOwnerSource(['frontend/src/scenario'])`, (each with parity, conservation with effect order `identical`, and the SM-S scope for the area it moves: H1 Run/Save/Discard, H2 two-browser presence or the named collaboration specs, H3 filters and search, H4 drag and undo, H5 History and rollback, H6 lanes, edges, focus, tooltip), then R5 (owner/interface/aggregate ratchets, lint ceiling, ontology and status; record "no dashboard budget change" because `dashboard.jsx` is untouched). The `let scheduleScenarioEdgeUpdate` and its assignment stay together in H6; the layout effect deps array is unchanged.

### SC4: Scenario view component

**Branch:** `improvement/scenario-view-component`.

**Files:** create `frontend/src/scenario/ScenarioView.jsx`; modify `dashboard.jsx`, guards, budget, docs. **Moves:** the JSX block 16338-17214 rooted at `<div className="scenario-fullbleed">` (16339), including the tooltip JSX near 17190-17207. `dashboard.jsx` keeps `{selectedView === 'eng' && showScenario && engWorkspaceConfigured && ( <ScenarioView ... /> )}`.

**Props (D9):** `scenario` (the planner object), `scenarioState` (the container object), `selectedSprint`, `normalizeEpicKey`, `excludedEpicSet`. It does not take `jiraUrl` or `selectedSprintInfo` (the JSX does not use them). The checker verifies the prop parity of this container.

**Ladder:** R4a (move the JSX with `import React from 'react'` at the top of the new `.jsx` file; delete the JSX-order and shape guards in `test_scenario_draft_history_source_guards.js` in this same commit, naming the Playwright assertions that cover each, because they read JSX text from `dashboard.jsx` and fail the moment it moves; `test_epm_shell_source_guards.js:60` and `test_eng_board_runtime_source_guards.js:50` pass unmodified; rebuilt dist; parity diff empty; conservation does not apply to JSX; sticky order re-checked in Catch Up, Planning, and Scenario modes; before/after screenshots in the PR notes) validated by SM-S; R5 (budget, lint ceiling, ontology, status). `.scenario-fullbleed` remains the component root and a direct child of `.container`. Expected change: about -870 lines.

After SC4, `rg -n '\bscenario[A-Z]\w*' frontend/src/dashboard.jsx` returns only the container and planner call sites and destructures, the `showScenario` flag usages, the per-group seam, the export-key and recovery-snapshot reads, and the clear/reset entry points; list the remaining hits in the PR.

---

## 11. Settings slices

**Rules for every `ST*` PR.**

1. **Ownership.** Each statement has exactly one owning PR, from the table below. Statements in no row stay in `App()`, are listed in the PR description, and are not a defect.
2. **Hook map.** The PR description contains a generated map (hook, call-site line, inputs and their declaration lines), produced with the section 6 derivation procedure, plus an **effect-crossing table**: for every moved effect, the unmoved effects between its old and new position. Reordering relative to unmoved effects is allowed only when the table shows disjoint state and refs and no ordering reliance; otherwise choose a call position that keeps the order or split the hook at the effect. ST3's normalization effect must stay after modal-open initialization: both write `activeGroupDraftId`, so that crossing is forbidden, even if lint passes. Its separate effects layer crosses zero effects; re-measure crossings for the other eight ST3 effects. Historical dry-run counts for the other sections: the Jira hook's 6 effects (4354, 4388, 4970, 4975, 5139, 5185) crossed 31 with 4940-5033 included (4 crossed 33 if that range stayed in `App()`); capacity's 2 crossed 37; ST2 crossed 13 to 15 at the candidate call positions; ST4 crossed none at 1268. Recompute against the current base. One concrete hazard is `fetchJiraFields` (5185) firing before the modal-open effect (2184). Playwright coverage for each crossing is named in the PR.
3. **Layering.** One hook per section when every input is available at its state lines; otherwise a state layer at the state lines plus a behavior layer where the inputs exist, both in one file. Add a separate effects layer where order must be preserved; ST3's selection layer and ST5's hotkey layer are required. A remaining cycle is resolved with a getter closure, never a ref or latest-ref.
4. **Module-level names.** Non-exported module-level declarations used by moved code (`createEmptyEpmConfigDraft`, `DEFAULT_EPM_LABEL_PREFIX`, the `*_TAB_IDS` sets, `stableAcceptedConfigValue`, `getLabelRowKey`) move to a small module in `frontend/src/settings/` that both `dashboard.jsx` and the hook import, so there is one instance. A hook file cannot import from `dashboard.jsx` (circular). JSX-returning helpers (for example `renderEpmProjectSkeletonRows`, 1382) go to a `.jsx` file, because esbuild rejects JSX in `.js`.
5. Read `backend/security/CONFIGURATION_OWNERSHIP.md` first. Run the `docs/plans/GATE-*.md` sweep at the start of every slice (all PRs here are plan executions); `GATE-05` (Home write capability, next review 2026-10-05) is not a dependency because no slice adds a Home/Townsquare path.

**Ownership table (exclusive; base line numbers; re-locate by anchor).**

| PR | Owns |
| --- | --- |
| ST1 | Layer-0 hoists: `commitSharedConfigRevision` (4882-4886, depends only on 643-644, which stay in `App()` until ST5) and the `useSettingsConfigBaselineRevision()` call (806-809, no inputs) move up inside `App()` to just before 705. Priority weights: state 705-708, dirty memo 2731-2733, validation 2965-2984, load and mutators 4860-4880, 4900-4911, 4930-4938 (`updatePriorityWeightDraft`, `resetPriorityWeightsDraft`), `effectivePriorityWeightsRows` (consumed at 7885). Capacity mapping draft: state 766-774 and 777-780 (`capacityFieldSearch*`), dirty memo 2737-2740, functions 5051-5084, 5190-5260 (not the Planning capacity read at 982-997/12742-13005, not `PlanningTeamCapacityCards`/`updateCapacity` at 17248-17272, not `capacityEnabled` 982). Jira projects / source board / issue types / field catalog: state 709-717, 749-765, 775-776 (`jiraFields`, `loadingFields`), 804-805, 822-826, dirty memos 2727-2729, 2735, 2742-2744, functions 4326-4420, 4800-4858, 4888-4898 (`saveBoardConfig`), 4913-4928 (`clearBoardSelection` ends at 4928), 4940-5033 and 5035-5049 (`saveProjectSelection`) provided the gate shows no late inputs (otherwise they stay in `App()`), 5086-5188. The tab JSX in 17493-17687 (Connections and Admin bodies, including the large `JiraFieldSettings` spread) moves to stateless containers in `frontend/src/settings/`. |
| ST2 | EPM settings: state 489-518 and 522-540 (519-521 are the modal tab ids and belong to ST5), refs 1144-1148, handlers 1362-1892, 3106-3115, 3123-3134, 3136-3167 (`handleEpmSettingsTabKeyDown`), 14832-14835 (`setTrackedEpmSettingsProjectSort`), normalization and memos 2466-2608, dirty and saved scope 2746-2768, project rows 2849-2932, effects 1667-1699, 2235-2335, 2765, 2856-2879, JSX 17688-17777. Prep (R3): `getLabelRowKey` (5508) to a settings module. |
| ST3 | Team Groups / Labels / board layouts: state 605-617 (including the group read fences 613-615, so the `acceptedGroupsConfigRef` text pin moves with it), 626, 641, 652-680 except 656-657 and 678-679 (ST5), 718-736; `loadGroupsConfig` 2610-2657, `handleGroupDraftChange` and `loadTeamsFromCurrentView` 2659-2672, the `activeGroupDraftId` normalising effect 2337-2351 (owned here but moved to `useTeamGroupSelectionEffect` called at its original position, not into the early behavior layer), draft mutators and team search 3234-3611 except the app-update notice 3340-3353 (not Settings; stays), `applySavedGroupsConfig` 3612-3625, debounced searches 4423-4569, `handleComponentSearchKeyDown` 4570-4593, epic helpers 4594-4798, export/import 5262-5345, team directory memos 5347-5380, `filteredGroupDrafts` 5449, team-results block 5464-5487, label search 5510-5660 (5508 `getLabelRowKey` is ST2's hoist); the `useGroupVisibilityPreferences` call statement (1231-1267) and `applyPreferenceGroupsSnapshot` (1218-1228) (the hook's inputs and outputs feed Team Groups both ways, so the Team Groups behavior layer calls it at that position); dirty and validation 2710-2725 (`groupDraftSignature`, `isGroupBoardDraftDirty`); JSX 17778-18122 (the department-tabs conditional: tab strip 17778-17815, `TeamGroupsSettings` 17816-17934, Labels tab 17935-18092, `GroupBoardsTab` 18093-18120, and its closing `</>` and `)}` at 18121-18122), group-board props 14926-14942 and `const random = Math.random` (14943, a `GroupBoardsTab` prop). **Not ST3:** the aggregates `isGroupDraftDirty` (2945) and `groupConfigValidationErrors` (2987), which read `isEpmConfigDirty`, `isSharedConfigurationDraftDirty`, `shouldValidateAdminSettings`, and `priorityWeightsValidationError` and belong to ST5's aggregates layer. |
| ST4 | First-run: state 629-638 (`settingsSaveInFlightRef` 639 stays with ST5), handlers 1268-1348, 5382-5447, JSX 18125-18149 (the `<OnboardingTour>` at 18150-18166 stays). The onboarding controller (3042-3084, `useOnboardingController` at 3056) and `onboarding.replay` (14848-14868) stay in `App()`. The `keepMine*` handlers (4249-4285) are ST5's. |
| ST5 (gate G2) | Permissions: 685-704 (including 694 `adminAccessAvailable` with its exact expression, and the `adminAccess` hook call 696-700; `performanceGate` 688, `activePerformanceLoadRef` 689, `performanceLoadRevision` 690 are ENG load performance and stay). Shared-config snapshot and save: 639, 642-651, aggregates 2934-3041 except ST1's 2965-2984 (this includes `isGroupDraftDirty` 2945, `groupConfigValidationErrors` 2987, `saveBlockedReason` 3033), `buildSettingsSaveOutcome` 3627, `saveGroupsConfig` 3629-4006, `saveAllSettingsOnce` 4008-4182, `saveAllSettings` 4184-4192, restore/return 4194-4244, conflict exits 4249-4285, and the Settings part of `loadConfig` (6760-6966, statements 6861-6949 interleaved with non-Settings writes; 6819 stays). Modal shell: 519-521, 625, 656-657, 678-679, 682, 859, functions 2674-2708, 3086-3105, 3117, 3168-3232, 14783-14841 except 14832-14835, 14948-14958, effects 2175, 4287-4324, 5488, 5500, JSX gears 15075-15112, `<SettingsModal>` shell 17457-17492 and its closing `</SettingsModal>` and `)}` at 18123-18124. |

Statements that stay in `App()` unless a later decision claims them: 627 `groupDraftError`, 628 `settingsSaveError`, 683 `showTechnicalFieldIds`, 684 `mappingHoverKey` (read by `JiraFieldSettings` props), 781-803 (the existing `useJiraFieldPickers` call; its 70-plus outputs feed the ST1 JSX container and the draft snapshot), 1166-1183 (the `useTeamCatalogLifecycle` call), 2136-2147 and 2184-2233 (the mount and open effects, section 4), 14842-14847 (first-run derived values), the unassigned `adminSettingsGate` consumers. Settings outputs read outside these ranges are listed in the PR description and kept stable by name: 5843-5844 and 6394-6399 (auth resume; fail-closed tab checks), 12449-12460 (`saveSharedExcludedCapacityToggle` uses `applySavedGroupsConfig`), 14440-14443 (`dirtySettings`), 2387-2424 (perf snapshot reads `showGroupManage`, `groupSaving`), 2145/8428/8688/8836/12074/15187 (`adminSettingsGate`), 5728-5780 and 5762-5764 (saved projects/board and strict-board revision).

**Dead code (R1) per PR:**

- ST1: `fetchJiraBoards` (4340), `jiraBoards`/`loadingBoards` (751-752; setters used only inside `fetchJiraBoards`), and the orphaned import `fetchBoards as requestJiraBoards` (251).
- ST2: `hasDraftEpmScope` (2849); its declaration string is pinned at `tests/test_epm_settings_source_guards.js:251`, so that guard is updated in the same commit.
- ST3: `updateGroupDraftTeams` (3330), `toggleTeamInGroup` (3355) (unread everywhere), the `parseTeamIdList` import (211, used only at 3331) once orphaned, and the unused `setShowGroupManage`/`setGroupManageTab`/`setDepartmentSettingsTab` arguments passed to `useGroupVisibilityPreferences` plus their destructuring at `frontend/src/settings/useGroupVisibilityPreferences.js:37-39`.
- ST5: `lastCommittedWorkspaceSectionsRef` (writes only, at 3917 and 4029) and `groupQueryTemplateEnabled` with its setter (681, 6864). The UI fixtures also mock a `groupQueryTemplateEnabled` response key; leave the fixtures untouched.

### ST1: Shared-config section hooks

**Branch:** `improvement/settings-shared-config-sections`. Targeted specs: `tests/ui/settings_unified_save.spec.js`, `tests/ui/settings_admin_access.spec.js`, `tests/ui/jira_field_picker_read_race.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js`, `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/codebase_structure_smoke.spec.js` (zero shared-config reads before the modal opens with `sharedConfig` present).

**Hooks (dry-run derived inputs, to compare):** `usePriorityWeightsSettings` at 705 (8 inputs: `BACKEND_URL`, `acceptSettingsConfigBaseline`, `clearServerConnectionError` 423, `commitSharedConfigRevision`, `reportServerConnectionError` 431, `settingsConfigBaselineRevision`, `settingsDraftSnapshotRef` 651, `sharedConfigRevisionRef` 644), `useJiraProjectSettings` at 709 (14 inputs: the same primitives plus `boardConfigReadGenerationRef`, `boardConfigSaveReadFenceRef`, `groupManageTab`, `setGroupDraftError`, `setGroupSaving`, `showGroupManage`), `useCapacityMappingSettings` at 766 (9 inputs: the same primitives plus `authMode`, `jiraFields`, `jiraProjects`, taken from the Jira hook declared earlier). Without R3 the gate flags `acceptSettingsConfigBaseline`, `commitSharedConfigRevision`, and `settingsConfigBaselineRevision` at the call sites; with R3 there are no flagged inputs and the render-time draft-snapshot assignment (810-821) can read the hooks' `draftSnapshot` (705 < 810). Each hook returns its drafts, setters, `isDirty`, the section's `save()` under the existing function names (`savePriorityWeightsConfig`, `saveBoardConfig`, `saveCapacityConfig`, `saveProjectSelection`, `saveIssueTypesConfig`, so the `:765` guard pin only needs a file re-point), `applyLoaded(config)` (the seeding done by `loadConfig` at 6900-6904 and the S3-S5 statements there, taking the `shouldPreserve*` predicates as arguments), and `draftSnapshot`. `App()` keeps `saveGroupsConfig`'s section order and `restoreSettingsDraftsToCommittedBaselines`, which call the hooks' setters.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Dead code (above). | SM-T. |
| R2 | Playwright test: dirty `priorityWeights`, `board`, `capacity`, and `issueTypes` together and assert the recorded request sequence (method and path, ignoring `/api/auth/csrf`) equals the section 4 order, each with `baseRevision`; key-parity assertions compare the save map (3630-3642), first-run admin capture (1284-1296), restore coverage (4194-4226), and `FIRST_RUN_ADMIN_SECTION_KEYS` against the same 11 admin sections. Separately assert `settingsDraftSnapshotRef.current` (810-821) contains exactly that set excluding `adminAccess` (10 keys); do not add `adminAccess` to the render-time snapshot. Read through `readOwnerSource` with an anchor for each location and re-point those locations in ST4/ST5. Existing first-run restoration coverage alone does not assert the snapshot projection. | Review the diff. |
| R3 | Hoist `commitSharedConfigRevision` and the baseline-revision hook above 705. | SM-T: save one admin section. |
| R4a | `usePriorityWeightsSettings` (+ its server-render probe: defaults, `isDirty === false`). | Admin: edit priority weights, Save, reload, persisted; reset to defaults. |
| R4b | `useJiraProjectSettings` (+ probe). | Admin: Scope projects (add/remove), Jira source board (set/clear), issue types, field pickers; Save. |
| R4c | `useCapacityMappingSettings` and the tab JSX containers (+ probe). | Admin: Capacity mapping project and field; Save; the Planning capacity bar still resolves. |
| R5 | Ledger tail (`test_epm_settings_source_guards.js:159-161` are re-pointed inside R4; `:765` stays valid until ST5, and `test_frontend_api_source_guards.js` stays green until ST5), budget, lint ceiling, ontology, status. | Review the diff. |

### ST2: EPM settings

**Branch:** `improvement/settings-epm-hook`. Targeted specs: `tests/ui/epm_initial_config_load.spec.js`, `tests/ui/epm-settings-gear.spec.js`, `tests/ui/epm_settings_visual_states.spec.js`, `tests/ui/home_token_connection_settings.spec.js`, `tests/ui/settings-home-token-connection.spec.js`.

**Design.** `useEpmSettings` is called from `App()`; `EpmSettingsTab.jsx` (new, `frontend/src/epm/`, with `import React`) is a stateless container that receives the hook's return object and owns `renderEpmProjectSkeletonRows`. It must not own the hook: the tab JSX is conditionally mounted (17688), the state is read by `loadConfig` seeding (6910, 6918, 6961), by `useEpmViewData` (2798-2800), and by `unsavedSectionsCount`/`saveAllSettingsOnce` (4094), and owning the hook in the container would drop the private draft on tab switch. Layers: the state layer at 489 (dry run: 1 input, `createEmptyEpmConfigDraft`, which moves to a settings module); the behavior layer after its inputs exist, called at 1362 (80 inputs without `setTrackedEpmSettingsProjectSort`, 82 with it; the valid call window starts at 1218, because 1213-1217 is one statement, and ends before 2799, the first output reader `hasSavedEpmScope`). `saveEpmConfig` (1488) calls `setEpmProjects`, `setEpmProjectsError`, and `refreshEpmProjects` (1506-1509), which come from `useEpmViewData` (2793), whose own arguments are EPM outputs (2798-2800): pass those three as a getter `() => ({ refreshEpmProjects, setEpmProjects, setEpmProjectsError })`. `labelSearch*` and `setGroupDraftError` stay in `App()` and are passed in until ST3. The dry run: 0 gate errors with the getter and the `getLabelRowKey` hoist.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | `hasDraftEpmScope` (and its guard pin). | SM-T, EPM tab. |
| R2 | Unit assertions of the EPM seed-only-from-private-view pin (`test_epm_settings_source_guards.js:688-694`) as a reusable helper over the owner directories. | Review the diff. |
| R3 | Hoist pure `getLabelRowKey` to a settings module. | SM-T. |
| R4a | `useEpmSettings` state layer and behavior layer. | EPM tab: Scope and Projects load with the saved selection with no modal-open dependency on first load; edit a project label; Save; reload persisted; the EPM view still refreshes after save. |
| R4b | `EpmSettingsTab.jsx` container (+ server-render probe with fixture props). | EPM tab sub-tabs, Home token states, discard prompt. |
| R5 | Ledger tail (`test_epm_settings_source_guards.js` 11 tests, `test_auth_isolation_source_guard.js:96-105`, `test_epm_view_source_guards.js`, `test_epm_shell_source_guards.js:122` are re-pointed inside R4), budget, ontology, status. | Review the diff. |

### ST3: Team Groups, Labels, and board layouts

**Branch:** `improvement/settings-team-groups-hook`. Targeted specs: `tests/ui/shared_department_groups.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js`.

**Design.** State layer at 605 (historical dry run: 0 inputs, 95 outputs); behavior layer at the position of the `useGroupVisibilityPreferences` statement (1231), which it calls internally (historical 103 inputs). The `activeGroupDraftId` normalization effect (2337-2351) is excluded from that early behavior layer: export a separate `useTeamGroupSelectionEffect` from the same hook file and call it at the effect's original position, after the modal-open effect (2184-2233). Its explicit inputs are `showGroupManage`, `groupDraft`, `activeGroupDraftId`, `firstRunConfigurationActive`, `firstRunConfigurationTargetGroupId`, and `setActiveGroupDraftId`; retain the existing dependency array and body verbatim. Both effects write the selection, so swapping them is unsafe. The two late behavior inputs remain `teamOptions` (7938) through a getter closure (`() => teamOptions`) feeding `loadTeamsFromCurrentView`, and `getLabelRowKey` (5508) through ST2's hoist. The historical dry run had 0 gate errors **provided** aggregates 2945 and 2987 were not moved here (4 errors otherwise); that lint result did not prove effect order. Move `labelSearch*` ownership here and update `useEpmSettings` to read it from this hook. Group JSON export/import stays selected-group scoped. Team label aliases (up to three per Team) behave exactly as before.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Dead code (above). | SM-T, Departments tab. |
| R2 | Add `discarding an empty Department draft preserves selection when Settings reopens` to `settings_unified_save.spec.js`: use saved synthetic groups A/B with legacy default B, delete both draft groups, discard, reopen, and assert the unchanged implementation selects A (modal-open queues B, then normalization sees the old empty draft, queues null, and the next render normalizes to A). Capture the reopened modal as `settings-empty-draft-reopen`; include it in the parity command. Keep group switch / favorite / visibility assertions; generate oracle JSON for pure helpers, writing module tests in R4. | Review the diff; the new test must pass before extraction. |
| R4a | State layer + behavior layer + `useTeamGroupSelectionEffect` at the original normalization-effect position (without JSX). Compare both revisions' effects; the open/normalize ordering must remain identical, not be waived by the crossing table. | Departments: create, rename, duplicate, delete a group; add/remove a Team; edit up to three label aliases for a Team; star a group; Save; reload persisted; delete-all/discard/reopen regression remains green. |
| R4b | Departments panel containers incl. the Labels tab and Boards tab (+ probe). | Departments sub-tabs, Group labels (when enabled), Boards layout edit; export and import the active group only. |
| R5 | Ledger tail (`test_analytics_source_guards.js:500-504`, the `acceptedGroupsConfigRef` pins in the three Board guards, `test_epm_settings_source_guards.js:157-158,:753`, `test_team_catalog_lifecycle_source_guards.js` are re-pointed inside R4), budget, ontology, status. | Review the diff. |

Use the existing `mockConfigSettings` helper and PR0's `captureDomParity` import in `settings_unified_save.spec.js`. This characterization passes on the current source and the separate hook called at the original effect position; moving normalization ahead of modal-open selects B and fails the final assertion.

```javascript
test('discarding an empty Department draft preserves selection when Settings reopens', async ({ page }) => {
    const calls = await mockConfigSettings(page, {
        sourceBundle: true,
        workspaceSnapshots: [{ authMode: 'basic' }],
        groupsConfig: {
            version: 1,
            groups: [
                { id: 'a', name: 'A', teamIds: ['team-platform'] },
                { id: 'b', name: 'B', teamIds: ['team-platform'] },
            ],
            defaultGroupId: 'b',
            configRevision: 2,
            source: 'jsonfile',
        },
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const gear = page.getByRole('button', { name: 'Manage team groups' }).first();
    await gear.click();
    const dialog = page.locator('.group-modal');
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Team groups', exact: true }).click();
    const departmentName = dialog.getByRole('textbox', { name: 'Department name', exact: true });
    await expect(departmentName).toHaveValue('B');
    await dialog.getByRole('button', { name: 'Delete group', exact: true }).click();
    await expect(departmentName).toHaveValue('A');
    await dialog.getByRole('button', { name: 'Delete group', exact: true }).click();
    await expect(dialog.locator('.group-list-item')).toHaveCount(0);
    await expect(dialog.getByText('No groups match this search.', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog).toBeHidden();
    await gear.click();
    await dialog.getByRole('button', { name: 'Departments', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Team groups', exact: true }).click();
    await expect(departmentName).toHaveValue('A');
    expect(calls.filter(call => call.method === 'POST' && call.pathname === '/api/groups-config')).toHaveLength(0);
    expect(errors).toEqual([]);
    await captureDomParity(page, 'settings-empty-draft-reopen', '.group-modal');
});
```

### ST4: First-run configuration

**Branch:** `improvement/settings-first-run-hook`. Targeted specs: `tests/ui/onboarding_tour.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`.

**Design (dry run).** Two layers: the state layer at 629 (0 inputs) and the handlers layer at 1268 (49 inputs). The handlers layer has two late inputs: `saveAllSettings` (4184) and `closeGroupManage` (2679, used at 5418 and 5435): give both getters (`() => saveAllSettings`, `() => closeGroupManage`) and call the layer at 1268, where its one effect (1343) crosses no unmoved effect; calling it at 5382 instead would make that effect cross 36 and is not allowed. The dry run had 0 gate errors with the getters. A verbatim `useCallback` (`retryFirstRunConfiguration`, 5421) keeps its dependency array unchanged. First-run keeps its committed-section tracking, `settingsSaveInFlightRef` (ST5's until then), the `rebaseOnto` flow, the "save shared groups first, then EPM, then the private favorite, then continue" order, and the rule that create/duplicate marks the new draft as the pending favorite and visible group without presenting `defaultGroupId` as the user's favorite. Delete the declaration-order slices in `tests/test_first_run_group_configuration.js` and keep its reducer tests and the section-coverage test.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R4a | `useFirstRunConfiguration` (state layer + handlers layer). | First-run user (empty preferences): group-selection popup, setup choice, configuration guide; create a group, Save, favorite persisted, dashboard continues; retry after a failed save. |
| R4b | First-run JSX container (18125-18149). | The same flow visually; the tour still launches from the gear. |
| R5 | Ledger tail (`test_first_run_group_configuration.js`, `test_analytics_source_guards.js` are re-pointed inside R4), budget, ontology, status. | Review the diff. |

### G2 prerequisite: Fail-closed Settings permission fix

**Branch:** `bugfix/220-settings-permission-fail-closed`. This is a separate behavior correction after ST4 and before ST5, approved on 2026-10-02. Do not fold it into a verbatim extraction commit.

**Files:** current permission expressions/bootstrap/save-refresh in `frontend/src/dashboard.jsx`, `tests/ui/settings_admin_access.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/test_epm_settings_source_guards.js` where coverage needs tightening, rebuilt `frontend/dist/`, and affected plan/index/ontology entries. Verify this file map against the post-ST4 tree. No backend policy, persistence, route, credential, or save-order change is in scope.

**Change and acceptance:** require the explicit boolean `userCanEditSettings === true` before enabling administrator-section tabs, controls, or save steps. Initial/loading state, missing grants, `undefined`, `null`, `'true'`, `1`, and `false` deny editing regardless of `settingsAdminOnly`; that metadata never grants access by itself. An explicit true grant preserves the authorized journey. Apply the rule on bootstrap and post-save config refresh. When replacing the expression, omit the now-unused `settingsAdminOnly` getter with `const [, setSettingsAdminOnly] = useState(true)` while preserving the existing initialization and bootstrap/save-refresh setter writes; do not export unused metadata or remove potentially meaningful rerender writes to silence lint. The warning ceiling remains unchanged. Preserve independent collaborative Department-group writes and private EPM rights under `CONFIGURATION_OWNERSHIP.md`.

**Verification:** add synthetic browser regressions that fail on the old expressions and pass with the fix, including missing `settingsAdminOnly` without a true user grant and `settingsAdminOnly: false` with absent/mistyped/false grants. Cover valid editor/non-editor responses, loading, post-save permission refresh, tab/control visibility, and zero administrator-section POSTs when denied. A valid non-admin must still save groups and private EPM settings under their own grants. Trace the backend response contract and retain the existing negative source pins. Keep global 401 lock, 403 handling, and 409 draft preservation unchanged.

**Ladder:** one minimal fix-and-regression-test commit with rebuilt dist and affected guards/docs. Run relevant browser tests, Node/Python suites, extraction gate, and before/after captures (valid responses unchanged; malformed responses deny editing). Report the exact commit and validation scope, then stop under D8. Complete section 8 publication on explicit operator go and verify the merge before ST5. Record base/head SHAs, failing-before/passing-after evidence, full-suite results, and merge in the status table. No failing permission test is waived as a preserved quirk.

### ST5 (gate G2): Shared-config bootstrap, save, permissions, and modal shell

**Entry gate.** G2 is conditionally approved: start after the separate permission fix is merged and verified on this slice's base. Preserve `saveGroupsConfig` as an imperative sequence moved intact into a hook receiving the section hooks. R0 remains a docs-only commit and validation stop; append fix evidence, measured layering, and a comparison explaining why a table-driven `{ id, isDirty, save }` rewrite adds risk without helping this extraction. Keep `adminAccess.save()` as a fixed sequential step between `issueTypes` and the groups POST (only its grant requests are parallel). Re-verify this historical layering data:

- Modal state (519-521, 625, 656-657, 678-679, 682) has 0 inputs and `adminAccess` (696) reads it, so it is a state layer called by 519. The cells 642-651 (`sharedConfigRevisionRef`, `settingsDraftSnapshotRef`, board fences) are inputs of every ST1 hook and need a state layer before 705.
- Permissions' first output reader is `adminSettingsGate` at 949; its `openSettings: tab => openGroupManage(tab)` stays an arrow created in `App()` (passing `openGroupManage` at 2674 directly is a TDZ).
- The modal functions need `saveAllSettings` (getter) and `isGroupDraftDirty` (2945); their first output reader is `closeGroupManage` at 3074, so their call lies in the window (2945, 3056].
- The hotkey effect (4287-4324) reads `saveAllSettings` and `requestCloseGroupManage` in its dependency array at render time (4324). A getter cannot serve there (a render-phase call is a TDZ error that neither lint rule sees), so that effect goes in a separate effects layer called after the orchestrator (between 4184 and 4287); effects 2175, 5488, and 5500 and the modal functions may use the early layer. Give those four effects an effect-crossing table and a Playwright check of Cmd+S and Escape.
- The save orchestrator needs `closeGroupManage` (2679, declared before it, so no getter), `loadConfig` (6760), `loadSprints` (7123), and `activeDepartmentSettingsTab` (14788, which needs hoisting). The aggregates, the modal functions, and the orchestrator form a three-way cycle, so the aggregates (2934-3041) get their own layer first.

**Files:** create `frontend/src/settings/useSettingsPermissions.js`, `useSharedConfigSave.js`, `useSettingsModalState.js`, `SettingsModalContainer.jsx`. Targeted specs: `settings_unified_save`, `settings_admin_access`, `unconfigured_workspace_gate`, `global_auth_lock`, `server_unavailable_ui`, `load_performance`, `codebase_structure_smoke`.

**Design points.** `useSettingsPermissions` exposes `applyBootstrapPermissions(config)` and `applySavePermissions(config)` (the second omits `setUserIsToolAdmin`, `setPerformanceAdminAvailable`, `setJiraUrl`, `setGroupQueryTemplateEnabled`); defaults `false`/`false`/`true`; editing is granted only by `userCanEditSettings === true`, preserving the verified D11 fix. `settingsAdminOnly` remains metadata and cannot grant editing. The write at 6819 stays where it is. `loadConfig` also writes non-Settings state (`setJiraUrl`, `setAuthMode`, `setBoardAllWorkAvailable`, `performanceGate.resolve`, auth-resume and recovery refs, the sprint catalog controller): extract only the Settings statements behind one named call such as `settings.applyBootstrap(config, preserve)` and leave the other writes where they are. `loadConfig` is also called from `retryBoardScopeConfiguration` (14873) and `useLatestWorkspaceConfig` (4283); keep each call site's closure semantics (section 4). Both `loadConfig` and `loadGroupsConfig` failure paths must still resolve `adminSettingsGate` (6957) and `groupsLoading`. Payload scope: each admin section is gated by `canEditSharedConfiguration && isXDirty && !skip`; every workspace-config POST carries `baseRevision` from `sharedConfigRevisionRef`; groups post via `buildSharedGroupsPayload`; personal preferences post separately; the footer Save persists all dirty editable sections together without mixing fields across endpoints.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R0 | Design note appended to this section (docs only; includes permission-fix evidence and current layering). | Validate the approved imperative interface and verified prerequisites. |
| R1 | Dead code (above). | SM-T. |
| R2 | Full-order Playwright test: with every workspace section dirty, the recorded sequence (method and path, ignoring `/api/auth/csrf`) equals the section 4 order including the `adminAccess` grant requests as a fixed step between `issueTypes` and `POST /api/groups-config`; a fallback-path fixture (no `sharedConfig`) startup test; the permissions unit tests are written in R4a with `useSettingsPermissions`. | Review the diff. |
| R4a | `useSettingsPermissions` and its unit tests (`true`, `'true'`, `1`, `undefined`, `null`, missing key; missing/false `settingsAdminOnly` cannot override an absent or false user grant). Preserve the verified D11 fix; no known-deviation exemption. | Sign in as a non-admin, an editor, and a tool admin: tab visibility and read-only state; Access tab states. Where an account is not available, the commit report names the Playwright test (`settings_admin_access.spec.js`) that covers that scope instead. |
| R4b | `useSharedConfigSave` per the approved interface. | Edit several sections, Save: order and conflict handling; the forced 409 and expired-auth cases are covered by the named Playwright tests, and you confirm the draft is preserved with the recovery actions and no replay. |
| R4c | `useSettingsModalState` and `SettingsModalContainer.jsx`. | Open from gear/hotkey/Board call-to-action; tab keyboard navigation; discard prompt; first-run still works; auth-resume reopens the same tab. |
| R5 | Ledger tail (`test_epm_settings_source_guards.js` fail-closed pins become unit assertions, `test_planning_action_source_guards.js:278`, `test_first_run_group_configuration.js:544-573`, `test_frontend_api_source_guards.js:11-17,:1204`, `test_onboarding_tour_utils.js`, `test_eng_board_*` `acceptedBoardConfigRef` pins are re-pointed inside R4), budget, ontology, status. | Review the diff. |

---

## 12. Execution status

Updated in each R5 commit and the separate permission-fix commit (root `AGENTS.md` section 4). Strategic approval does not replace a gate's verification prerequisites, per-commit validation, or publication approval.

| PR | Slice | Status | `dashboard.jsx` lines after | Budget after | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| PR-1 | Land revision 3 of the plan | Merged 2026-10-01 | n/a | 18,213 (historical) | #219, `c9ca8eff` | Revision-5 amendment remains local until authorized publication |
| PR0 | Tooling, coverage, baselines | P0-1 validated; P0-2 implemented, awaiting validation | 18,434 (unchanged) | 18,434 | | Fresh base recorded above; later coverage/capture/baseline rungs pending |
| SC1 | Scenario state container and seam | Not started | | | | |
| SC2 | Single Scenario hook | Not started | | | | |
| SC3 | Split the Scenario hook (G1) | Approved strategy; not started | | | | Verify current-source boundaries after SC2 |
| SC4 | Scenario view component | Not started | | | | |
| ST1 | Shared-config section hooks | Not started | | | | |
| ST2 | EPM settings | Not started | | | | |
| ST3 | Team Groups and Labels | Not started | | | | |
| ST4 | First-run configuration | Not started | | | | |
| Permission fix | Explicit Settings editing grant (G2 prerequisite) | Approved; not started | | | | Separate fix after ST4; verify merge before ST5 |
| ST5 | Shared-config save, permissions, shell (G2) | Conditional approval; not started | | | | Permission fix + R0 validation required |

## 13. Program acceptance

- Every PR merged in order; `dashboard.jsx` lower and its budget ratcheted in each slice that changes it (PR-1, PR0, and SC3 do not change it); the lint ceiling never raised.
- Size milestones are forecasts until measured. At checked main `ffeafb0e` (18,434 lines), unchanged Scenario ranges project about 15,364 after SC2 (historical net reduction ~3,070), no additional dashboard delta in SC3, and about 14,494 after SC4 (~870 net lines). Re-measure every actual base and net reduction. The full end forecast is approximately **10,000–12,000 lines after ST5**, including retained call sites, destructuring and glue. At ST4, record its measured count and project the remaining G2/ST5 net reduction from verified ranges minus added seams; report a material projected mismatch before ST5. Apply the final measured-size check after ST5. Missing the forecast requires an explanation of retained responsibilities and seam overhead, not unrelated deletions or relaxation of the per-slice ratchet.
- Every affected source file/export is registered and within its frozen/ratcheted owner/interface/aggregate ceilings. Remaining-App responsibilities, readers, getter invocation phases and seam costs are current; no owner imports `dashboard.jsx`. Runtime-work comparisons use the same synthetic fixture and refreshed base, with no unexplained additional work or duplicate lifecycle resources. File size alone establishes no performance improvement.
- Extraction slices have no route, payload, startup-count, sticky-order, analytics, or visual change; the separate G2 fix changes only invalid/missing-grant administrator editing. Extraction DOM parity diff is empty in every R1/R3/R4 commit with complete distinct captures; the conservation residual itemised in every R4 commit message; the full Chromium `tests/ui` run passes before every push, or the exact named failure and revision have an explicit operator waiver. A recorded baseline failure alone is not a waiver.
- Docs: `FUTURE-codebase-operability-improvements.md` and `docs/plans/README.md` aligned; `docs/ontology.md` has "Scenario Planner ownership" and "Settings state ownership" entries and every existing entry that cites `dashboard.jsx` ownership (Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, Board scope load authority, Startup config timeout) points at the new owner files, with verification dates and resolving paths.
- On completion rename this file to `DONE-dashboard-scenario-settings-state-extraction.md` with the status note naming the PRs, per `docs/plans/AGENTS.md`.

## 14. Estimate, risks, and review log

- **Effort.** `FUTURE-codebase-operability-improvements.md` estimates 5-8 days (Scenario) and 4-7 days (Settings). The extraction ladder has 11 PRs and 49 commit stops (PR0 6, SC1 3, SC2 2, SC3 8, SC4 2, ST1 7, ST2 6, ST3 5, ST4 3, ST5 7 including the design note); the separate permission fix adds one PR and one commit stop, for 12 PRs including completed PR-1 and 50 remaining ladder stops plus one publication go per PR after PR-1 (D8); non-source commits (R2, R5, R0) stop for a one-line confirmation. With same-day operator turnaround and no rebases, three to four weeks; with the feature-work churn on `dashboard.jsx` (22 commits since 2026-09-01), plan on five to six.
- **Largest risks.** Drift and rebase breaking validated commits (mitigated by the section 5 protocol and textual anchors); validation that is skipped or falsely green (mitigated by named Playwright tests, `sourceBundle: true`, and the dist hash); a silent non-verbatim edit or an `undefined` prop (mitigated by `check_move_conservation.mjs` and the checker's parameter and prop parity); effect reordering in Settings (mitigated by the effect-crossing table); a guard that goes vacuous (mitigated by `readOwnerSource` anchors). There is no data migration, but rollback must account for transitive consumers, rebuilt dist and retained G2 permission behavior (section 5); an earlier prerequisite PR is not independently revertible after its consumers merge.
- **Review log.** Draft 1 was reviewed by four independent reviewers on 2026-10-01 and found not executable: hook cycles/order, range ownership, weak gates, inaccurate guard maps, and thin characterization. Revision 2's scratch dry runs passed SC1, SC2, ST1, ST2, and corrected ST3/ST4 ranges; tooling and cold-read review still required fixes. Revision 3 added the executable lint/conservation gate, seven seeded controls, cumulative dry runs, commit ladder, and publication protocol; its targeted third review reported no P1. PR #219 landed that revision. The 2026-10-02 fourth review reproduced three P1 findings (ST3 effect order, asymmetric conservation, dashboard-only interface coverage), three P2 findings (backward-edge fixture, empty-only conflict fixture, overwritten auth-expiry capture), and stale PR-1 status. Revision 4 corrects each and adds executable controls; earlier lint-clean dry runs do not establish behavior safety.
- **Revision-4 verification (2026-10-02).** Three subagents verified tooling, Scenario characterization, and Settings behavior on ignored scratch copies. The six tool blocks extracted from this document pass Node syntax checks / `bash -n`. `EXTRACTION_TOOL_DIR=tmp/issue220-printed fnm exec --using 20 node tmp/issue220-printed/tooling_controls.mjs` reports 14/14 controls passing. The printed interface checker on an archive of `ffeafb0e` reports 16 destructure sites in 41 modules, 0 enforced and 34 informational problems. `fnm exec --using 20 node tmp/issue220-printed/check_move_conservation.mjs --base HEAD frontend/src/settings/useGroupVisibilityPreferences.js` compares 1,499 statements on each side with 0 residuals and identical order across 138 effects. The revised Scenario spec passes twice in Chromium, producing eight captures per run with identical file lists and no DOM diff. The Settings synthetic browser probe passes on the current source (reopened A), demonstrates the early-normalization candidate selects B, and passes with the separate normalization hook at its original position (A); none sends a shared save or raises a runtime error. The printed DOM helper passes a Chromium check of opt-in no-op behavior, distinct draft/recovery captures, retained input properties, and duplicate-label rejection without overwrite.
- **Revision-5 verification (2026-10-02).** Three subagents checked the additional findings against source. The replacement DOM helper passes Node syntax and 13/13 synthetic Chromium controls; the Scenario spec passes twice (eight identical labels, recursive DOM diff empty). Two source-bundled runtime probes pass; identical 5s idle work and Epic-focus variation are recorded above. A Node projection probe confirms 11 admin keys and the 10-key snapshot excluding `adminAccess`; an isolated ESLint probe confirms the permission-expression-only change adds an unused-getter warning and omitting that getter removes it while preserving setters. The six printed core tools pass syntax checks and their 14 additional controls still pass. The printed strict JSON scan reports both seeded nested render and deferred uses that the default scan misses, and rejects fatal diagnostics. Committing reusable nested-caller controls and implementing owner-growth checks remain explicit PR0 requirements; these probes do not mean the printed core gate already enforces them.
- **Remaining entry requirements.** These probes validate the revised examples; they do not complete PR0 or approve extraction. The optional full-lint scratch probe could not load `eslint-plugin-react` from the cached dependencies; it provides no warning baseline or gate-pass evidence. PR0 must refresh all ranges/budgets, implement and run the full current-base gate, the existing 21 controls plus all new growth/timing controls and 13 DOM-helper controls, freeze owner/interface budgets, commit/refresh the runtime probe, capture every required Settings/Scenario state, and run the required Python, Node, build, and full Chromium suites. D12 is acknowledged, G1 is approved against current-repository boundaries, and G2 is conditional on the separate verified permission fix and preserving the imperative save sequence. PR0 P0-1 (`4149b615`) has operator validation; P0-2 is implemented and awaiting operator validation, with later rungs unexecuted. No publication is authorized.
