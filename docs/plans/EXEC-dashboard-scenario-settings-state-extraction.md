# Dashboard Scenario And Settings State Extraction Implementation Plan

> **Status:** Execution in progress, revision 5 (2026-10-02), tracked by [issue #220](https://github.com/Juce-me/jira-execution-planner/issues/220). PR-1 landed revision 3 in [PR #219](https://github.com/Juce-me/jira-execution-planner/pull/219), merge `c9ca8eff`, on 2026-10-01. A fourth readiness review reproduced gaps in nested interface checks, conservation of already-extracted hooks, ST3 effect order, and PR0 characterization/parity captures; revision 4 corrected them. Revision 5 closes six further findings: identity-safe DOM normalization, recursive render/getter timing review, the post-ST5 size milestone, dependency-aware rollback, the permission fix's unused getter, and explicit 11-section/10-snapshot parity. It also requires owner/interface/aggregate budgets, a remaining-App responsibility inventory, and a reproducible runtime-work baseline before extraction. The original source ranges and dry-run measurements remain historical evidence from `89ffe589`; PR0 must refresh them against its latest `origin/main` base. Operator decisions recorded 2026-10-02: D12 is acknowledged; G1 proceeds with the planned split verified against current repository boundaries; G2 preserves the current save sequence and requires a separate fail-closed permission fix before ST5. Execution authorized in chat on 2026-10-02; PR0 P0-1 (`4149b615`) was validated by the operator on 2026-10-02; P0-2 (`a2cc9017`) was validated by the operator on 2026-10-03; P0-3 (`d7d47c60`) was validated by the operator on 2026-10-03; P0-4 (`472e98d8`) was validated by the operator on 2026-10-03; P0-5 (`cb8791d5`) was validated by the operator on 2026-10-03. P0-6 was validated by the operator, and PR0 merged in [PR #227](https://github.com/Juce-me/jira-execution-planner/pull/227) at `6086bf8cbfe78c48c3ea44acfe37d5a194c4e32d` on 2026-10-03. SC1 R1, validated by the operator, starts from that exact fetched main; SC1 R4a (`0b9a78e7`) implements its frozen checkpoint and has operator validation; R5 (`e9d2ea0e`) was validated and SC1 merged in [PR #228](https://github.com/Juce-me/jira-execution-planner/pull/228) at `bc17d28c9e1dae9a2331b4aeadb746142b0eab89` on 2026-10-03; SC2 preflight starts from that freshly fetched main on 2026-10-04; the operator validated its frozen checkpoint in chat, and R4 (`42b2a14f`) completed exact-head verification and was validated by the operator on 2026-10-04; R5 records the measured ratchet and remaining-App inventory; the source/base refresh and old-to-new PR0 rung SHAs are recorded below. SC2 R5 was validated and SC2 merged in [PR #229](https://github.com/Juce-me/jira-execution-planner/pull/229) at `f2e2b51049e1e7b3cce7c8323aa8d14ecff87934` on 2026-10-04; SC3 starts from that exact main; its R2 characterization (`4f9e267a`) and H1 checkpoint were validated by the operator in chat on 2026-10-04, H1 R4 (`38117af3`) was validated by the operator in chat on 2026-10-04, H2 R4 (`c8d0a306`) was validated by the operator in chat on 2026-10-05, and H3 R4 (`20a2a38c`) was validated by the operator in chat on 2026-10-05, H4 R4 (`2fca1fe0`) was validated by the operator in chat on 2026-10-05, and H5 R4 (`e1ed501f`) was reviewed with an A/B save-and-rollback check (below) and the operator chose to finish the split first, H5 and H6 R4 (`70c25a06`) were validated by the operator in chat on 2026-10-05, and SC3 R5 was validated by the operator in chat on 2026-10-05; SC3 was published and merged in [PR #231](https://github.com/Juce-me/jira-execution-planner/pull/231) at `1df92ad1856600211b0bfc3b5f83d19f3cc18068` on 2026-10-05 after the operator asked to merge and proceed (all four CI checks passed); SC4 R4a (`1b995667`) was validated by the operator in chat on 2026-10-05, and SC4 R5 was validated by the operator in chat on 2026-10-05, who then asked to publish and merge SC4. Each rung still requires operator validation and publication remains separately gated. Supersedes the "Extract Scenario Planner ownership" and "Move settings state/actions behind feature hooks" rows of `FUTURE-codebase-operability-improvements.md`.

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

**PR0 initial execution-base refresh (2026-10-02).** Initially fetched `origin/main` was exactly `ffeafb0ea3f37dd17a5d910595c20e1493166c5c`; PR0 branch `improvement/dashboard-extraction-tooling` starts there with no historical issue-branch commits. The reviewed local revision-5 plan/index amendments reapplied cleanly. No open PR touched `dashboard.jsx` at branch creation. Its source is 18,434 lines and its existing structure ceiling is 18,434. Node 20.20.0 and the checkout's `.venv` interpreter run the checks. The upstream instruction template remains 2026-09-08. Fresh gate/interface/owner measurements are recorded below as P0-1 completes; historical counts above are not ceilings.

Fresh unchanged-source suite evidence: `fnm exec --using 20 node --test tests/test_*.js` passed 1,726 tests, zero failures/skips, in 3.747 seconds. The section-6 environment-isolated `.venv/bin/python -m unittest discover -s tests` passed 2,111 tests with 29 skips in 158.643 seconds. `fnm exec --using 20 npm run build` and `make verify-dist-clean` passed with no generated diff. The fresh full Chromium run (`fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4`) passed 1,197 tests with 3 skips and zero failures in 10.1 minutes. P0-5 must refresh these baselines after characterization and record the required runtime-work samples. Initial sandbox browser launch failed at macOS Mach-port registration before any app assertion; the authorized run replaces that environment-failed attempt, which is not a product failure waiver.

**P0-5 fresh baseline refresh (2026-10-03, verified locally).** The exact `ffeafb0ea3f37dd17a5d910595c20e1493166c5c` tree was read through an ignored Git archive without switching the checkout. Its complete frontend source matches the candidate production tree byte-for-byte. Fresh Espree measurements: 18,434 dashboard lines / 1,115,924 bytes, `App` 382–18427, return 15313–18426, 1,511 top-level statements, 327 state / 137 effect / 283 memo / 59 callback / 164 ref / 1 reducer calls. Other JS/JSX/MJS source: 214 files / 40,722 lines. All 41 registered owner LOC counts equal the P0-1 inventory; the 18,434 dashboard / 475 Scenario / 9,803 Settings-EPM / 10,278 unique-owner / 28,712 App-plus-owner ceilings remain measured values, not allowances.

| Fresh check | Exact-base tree | Candidate production source at `472e98d8e3cdb0bf89ceb5b921d609d26b6116a1` |
| --- | --- | --- |
| Pinned Node suite | 1,726 passed, 0 failed/skipped; 4.159 s | 1,728 passed, 0 failed/skipped; 3.358 s |
| Environment-isolated Python suite | 2,111 tests, OK, skipped 29; 158.612 s | 2,112 tests, OK, skipped 29; 260.279 s |
| Full Chromium `tests/ui` | Final complete campaign: 1,197 passed, 0 failed, 3 skipped; 9.1 min. Earlier corrected-root campaign: 1,193 passed, 4 failed, 3 skipped; 13.1 min | Full publication gate remains required at the proposed publication head |
| Recursive extraction gate on unchanged production source | 0 errors / 120 unchanged warnings; 16 sites / 41 modules; 0 enforced, 34 informational, 0 baselined; 0 budget problems | Same byte-identical source and frozen manifest |
| Tooling controls | All 70 pass (7 shell controls plus 63 controls in the JavaScript suite, retaining the original 21 and all 49 additions) | Independent runtime-probe VM controls: 14 pass |

Node uses `fnm exec --using 20 npm run test:frontend:unit`; Python uses the full section-6 explicit basic/jsonfile/local/scopes profile with `.venv/bin/python -m unittest discover -s tests`. The +2 Node checks are the quirk pins; the +1 Python check is the owner-budget test. Concurrent suite workloads make wall times observations, not performance comparisons. No check has an operator waiver.

Archived-root setup initially caused five historical Board paint-boundary cases to fail before their fixture could build: `component_page_2`, `component_batch_2`, `team_parent_lookup_2`, `child_completion`, and `collapsed_first` in `eng_board_progressive_loading.spec.js`. That invalid campaign was aborted (exit 130) after case 272 and retained as diagnostic evidence. The archive has no `.git`; the test's read-only `git ls-tree`/`git show` looked at the parent checkout with the wrong directory prefix. Setting `GIT_DIR` to the checkout metadata and `GIT_WORK_TREE` to the archive fixes its root without editing source/tests. The corrected complete campaign passed those five cases.

The corrected complete campaign had four other failures, retained by exact name: `eng_epic_refresh.spec.js` — “81. a priority change on a story and on an epic issues zero alert requests and does not blank the Stories Required ghosts”; `onboarding_tour.spec.js` — “production Catch Up Status preview resolves its exact Epic owner and never writes Jira”, “production Priority owner bridge rejects every stale descriptor tuple member”, and “hierarchy matrix and editing presence matrix retain deterministic order and compact only all-absent groups”. An unchanged one-worker diagnostic with tracing passed all four (25.5 s), with original assertions/timeouts. The two initial-onboarding failures' snapshots show Catch Up under the automatically opened tour, excluded from the initial role lookup; the matrix timeout snapshot still contains its tour (isolated 14.8 s). The Epic priority menu was absent in its timeout snapshot; static evidence does not prove its closing cause. The final unchanged four-worker complete campaign passed all four and all 1,197 passing cases (3 skips, 9.1 min). No assertions, timeouts or source files were changed; no failure exemption was introduced. The earlier failures remain diagnostic evidence, and later publication still requires its own full committed-head gate.

Current range boundaries were matched to unchanged historical source lines, then checked in the current source. These are navigation evidence only; each slice still re-locates and records exact first/last statements before moving:

**P0-6 main-move refresh (2026-10-03).** Fetched `origin/main` advanced to `c4ab713afccb70223f5dc0e2f94da9d774baaa0b` via the Planning Team editor change (#225): `IssueTeamEditor.jsx`, its UI test, its existing plan record and rebuilt JS bundles. Under D12 and the drift protocol, all five unpublished PR0 commits rebased cleanly. `git range-diff ffeafb0e..cb8791d5 c4ab713a..de7cbac7` shows every patch unchanged (`=`): P0-1 `4149b615` → `e7acc87e`, P0-2 `a2cc9017` → `42e86485`, P0-3 `d7d47c60` → `9b7d17da`, P0-4 `472e98d8` → `a993e56b`, P0-5 `cb8791d5` → `de7cbac7`. Earlier validation and full-suite/runtime evidence above remain exact-revision historical records, not measurements of the new main tree.

Fresh measurements against the new exact base retain dashboard 18,434 lines / 1,115,924 bytes, App/return ranges, all primitive hook counts and 1,511 top-level statements. All 41 owner LOC counts and all five aggregate ceilings are unchanged; the complete interface inventory still has 16 sites / 41 modules / 34 informational findings / zero enforced problems. Other frontend JS/JSX/MJS remains 214 files and is now 40,795 lines, exactly +73 from the upstream Team editor. No extraction or budget allowance was introduced. `dashboard.jsx` and the complete registered owner set match the new base; textual anchors below retain their locations. Full proposed-publication-head suites and committed build remain required before publication.

**Pre-publication main-move refresh (2026-10-03).** Before any push, fetch advanced main again to `06df6615f2b762f6f8b0c93a3c4df0d5592f9c39` (#226, ENG status-menu prefetch). Nothing was published. The six unpublished PR0 rungs rebased cleanly with identical patches before this P0-6 documentation amendment: `e7acc87e` → `f03f74f0`, `42e86485` → `eb830eeb`, `9b7d17da` → `a1e2796b`, `a993e56b` → `c0a6f330`, `de7cbac7` → `2916a8ba`, `c33d9944` → `293397eb`. The amendment refreshes only current-base documentation after the publication precondition failed; it preserves rung scope under D12. Prior publication verification at `c33d9944` remains historical: 1,728 Node passes, 2,112 Python tests OK (29 skips), 1,215 Chromium passes (5 skips), 70 tooling controls, four fresh c4/base–c33/head runtime probes and a clean committed build. Replacement-head verification and publication approval must refer to the replacement revision, not those counts or the previously approved exact head.

At `06df6615`, dashboard LOC remains 18,434, bytes are 1,116,112 (+188 upstream), App/return ranges and 1,511 statements are unchanged, and primitive hook counts remain 327 state / 137 effect / 283 memo / 59 callback / 164 ref / 1 reducer. Other frontend JS/JSX/MJS: 214 files / 40,872 lines (+77 upstream since c4). All 41 registered owner LOC counts, five aggregate ceilings, 16 interface sites and 34 informational findings remain unchanged; the refreshed gate passes with 0 errors / 120 warnings / zero budget problems. No ceiling increase or new failure baseline is introduced.

Independent comparison of App plus the complete upstream-affected `useEngStatusTransitions` hook reports 1,531 → 1,532 statements, five removed/six added residuals, and identical order across 138 effects. Every residual belongs to upstream status-prefetch wiring: App's status destructure and two render helpers, the hook's option loader/return, and its new prefetch callback. That hook is outside the registered Scenario/Settings/EPM owner manifest; its return gains `prefetchSingleIssueStatusOptions` (12 → 13 properties), while input parameters are unchanged. Its timer/event callback is deferred and reads initialized hook bindings. Current Scenario/Settings state, terminal auth lock, save order, G1 and G2 boundaries are unchanged. Fresh runtime/DOM captures and full suites will verify the replacement head before any publication. The new-base before capture campaign passed 182 tests with one intentional runtime skip (1.9 minutes), using the identical PR0 characterization harness and fresh `tmp/pr0-refresh-base/tmp/dom-parity/pr0-refresh-before`. Refreshed ontology verification resolves all four file-map targets, 195 file links, 161 inline paths, nine heading references and 64 symbols. Reviewer and `git diff --check` pass; no production or budget file is amended.

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
# Node unit tests (historical baseline at 89ffe589: 1529 pass)
fnm exec --using 20 node --test tests/test_*.js

# Python suite (historical baseline at 89ffe589: Ran 2006 tests, OK, skipped=25). Explicit env so a local .env cannot leak in.
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

**Completed:** revision 3 landed in [PR #219](https://github.com/Juce-me/jira-execution-planner/pull/219), squash merge `c9ca8eff`, on 2026-10-01. The reviewed PR head was `831acf7a` (three plan commits; three documentation files). The 2026-10-02 fetch confirms the plan is present on `origin/main`. The former remote branch was deleted; its head is still fetchable through `refs/pull/219/head`. Do not repeat PR-1 or treat its former three-commit publication contract as the contract for another slice. Revision 4 and revision 5 amendments subsequently landed through merged PR0 #227 (`6086bf8c`); later slice records remain subject to their own publication gates.

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

- [x] In `tests/ui/scenario_draft_history.spec.js` add `const { captureDomParity } = require('./dom_parity_helpers');`. Add opt-in `options.dependencies` and `options.issueOverrides` to the `/api/scenario` mock response; preserve the existing defaults for all other tests. Dependencies use `{ from, to }` keys (`validateDependencies`, `scenarioUtils.js:77`). Replace that response block with:

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

- [x] Add the always-on characterization test below. Only captures are opt-in. Its fixture puts a forward dependency and two same-assignee overlapping tasks in one visible Team lane; the third asserted task is nonconflicting. The current renderer suppresses backward/overlapping dependency edges, so the dependent must start strictly after the prerequisite ends. Conflicts Only must retain two actual conflict bars, remove the nonconflicting task, and restore it when disabled.

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
- [x] In `tests/ui/scenario_draft_collaboration.spec.js` add `const { captureDomParity } = require('./dom_parity_helpers');` at the top, then add `await captureDomParity(page, '<label>', '.scenario-fullbleed');` (no-op without the env var) at these mounted-state anchors: `presence strip renders remote user and polling stops after scope switch` (`scenario-presence`) immediately after the remote-user/default-poll assertions and before the scope switch; after the last assertion of `lock warning shows same-issue advisory conflict during drag` (`scenario-lock-warning`), `stale draftRevision shows recovery actions and keeps dirty local edits` (`scenario-conflict-recovery`), `write-back stays preview-only and blocked by the gate` (`scenario-writeback-preview`).
- [x] In the same file add the group-switch-and-back test SC1 depends on (it reuses `installDashboard`, `openScenario`, and the `Select group` / `.group-dropdown-option` pattern from `switchScenarioToAlternateGroup`; the fixture's groups are `Default` (`grp-default`) and `Alternate` (`grp-alt`)):

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

P0-3 verification (2026-10-03, unchanged production source at `ffeafb0e`):

- The optional dependency/issue overrides preserve existing fixture defaults. The always-on timeline characterization proves all eight named states, a strictly forward dependency with both endpoints visible, two actual same-assignee conflicts, removal of the nonconflicting bar and restoration. The new group-switch test passes with the planned **Assignee** restoration; no current-behavior exception is needed.
- Mounted collaboration captures prove remote presence, an advisory lock warning, retained dirty conflict recovery, and blocked writeback. Current-source evidence required one mechanical anchor correction: the presence test switches to Alternate before its final polling-stop assertions, so an end-of-test snapshot loses Remote Editor. `scenario-presence` now captures immediately after the Default remote-user/poll assertions and before the switch; the original polling-stop assertions remain intact. No production strategy or behavior changed.
- Headed command: `JEP_DOM_PARITY_DIR=tmp/dom-parity/p0-3-headed JEP_SCENARIO_SCREENSHOT_DIR=tmp/p0-3-headed-shots fnm exec --using 20 npx playwright test tests/ui/scenario_draft_history.spec.js tests/ui/scenario_draft_collaboration.spec.js tests/ui/scenario_focus_positions.spec.js --browser=chromium --headed --workers=4 --output=tmp/p0-3-headed-results`: 40/40 passed in 2.9m. The inactive focus-position template collected no tests and did not load real fixtures. All eight new headed screenshots were visually inspected by coordinator and reviewer: forward edge/endpoints, Epic bars/focus, Assignee lanes, tooltip, two retained red conflict bars and restored blue nonconflicting bar are visible. The existing helper's repeated visual-settle waits require a screenshot-only 60s timeout for the eight-state test (ordinary behavior/parity runs keep the default); no assertion or normalization was weakened.
- The section 6 four-spec Chromium command ran twice with four workers into fresh `tmp/dom-parity/p0-3-run1` and `p0-3-run2`, with separate result directories: 169/169 passed in 2.6m and 1.8m. Each has exactly 34 nonempty labels (the 22 Settings/first-run labels, eight timeline labels, four collaboration labels). `diff -r tmp/dom-parity/p0-3-run1 tmp/dom-parity/p0-3-run2` exited 0 with no output. Explicit snapshot checks prove exactly two conflict bars, absent/restored nonconflicting work and all four collaboration state messages. The real P0-2 helper remains unchanged.
- Gate: 0 errors/120 existing warnings, 16 sites/41 modules, 0 enforced/interface/owner-budget problems. Structure-budget unittest: 2/2 passed in 0.047s. Node 20 build and `make verify-dist-clean` passed. All production source, generated bundles, dependencies and the frozen owner manifest remain unchanged; no extraction conservation residual arises. Read-only review approved the current interface, ownership, closure/save boundaries and non-vacuous regression coverage.
- P0-2 (`a2cc9017`) was validated by the operator's 2026-10-03 continuation. P0-3 (`d7d47c60`) was validated by the operator on 2026-10-03 after review of its tests, headed proof and complete empty two-run comparison. P0-4 is implemented below; later rungs remain unexecuted. Home-write gate remains blocked and is not a dependency here. Analytics impact is internal characterization only, requiring no new event or taxonomy change. No publication is authorized.

### Commit P0-4 (R2): Guard helper, auth-isolation widening, quirk pins

- [x] Create `tests/frontend_source_helpers.js` (flat, matching `tests/css_source_helpers.js`):

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

- [x] Widen `tests/test_auth_isolation_source_guard.js`: run the existing handler lookup **per file** (it uses `source.lastIndexOf` per file) over `frontend/src/dashboard.jsx` and every `.js`/`.jsx` file under `frontend/src/scenario/` and `frontend/src/settings/`; assert the summed count is exactly six and each handler checks `readPendingAuthenticationRequired()` before its first `event.key`; read the negative pins at `:12-36` through `readOwnerSource(['frontend/src/dashboard.jsx', 'frontend/src/scenario', 'frontend/src/settings'], { anchor: 'readPendingAuthenticationRequired' })`. It passes with no source change.
- [x] Create `tests/test_extraction_quirk_pins.js` exactly as printed in section 7 ("Quirk pins"); it passes on the unmodified tree.

**Validation scope:** none in the app; the operator confirms the Node suite passes.

**P0-4 verification (2026-10-03):**

- Implemented as printed: the flat anchored owner-source helper and two quirk pins; widened the six negative auth checks over dashboard/Scenario/Settings and checked window handlers per file across 34 `.js`/`.jsx` owners. Exactly six registrations retain their terminal latch before the first key read. Other authentication assertions and the EPM save guard remain unchanged.
- Fresh fetch confirms base `ffeafb0ea3f37dd17a5d910595c20e1493166c5c`; production source, generated bundles and package dependencies are byte-identical to that base. No extraction occurred, so there are no conservation residuals or new DOM captures in this rung. The P0-3 parity evidence remains applicable.
- `fnm exec --using 20 npm run test:frontend:unit`: **1,728 passed, 0 failed, 0 skipped** (5.690 seconds). `fnm exec --using 20 node --test tests/test_extraction_quirk_pins.js tests/test_auth_isolation_source_guard.js`: **3 passed** on unchanged production source. `fnm exec --using 20 node tmp/p0-4-synthetic-controls.cjs`: **8 passed**, proving recursive JS/JSX/MJS reads, missing-anchor rejection, moved nested handlers, same-name handlers in separate files, rejection of missing/late auth guards, moved forbidden auth behavior, and an extra seventh shortcut. Synthetic copies and the VM harness remain ignored under `tmp/`; production was never mutated.
- `fnm exec --using 20 bash scripts/extraction_lint/run.sh`: **0 errors, 120 unchanged warnings**, 16 destructure sites across 41 modules, 0 enforced/34 informational/0 baselined interface problems, and 0 owner-budget problems. `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: **2 passed** (0.040 seconds). `fnm exec --using 20 npm run build` and `make verify-dist-clean` pass.
- Operator validation scope: no app interaction; confirm the Node suite and the source guard/helper/quirk diff. P0-3 (`d7d47c60`) was validated by the operator's continuation. Stop at this local commit; P0-5 and later rungs remain unexecuted. Home-write remains blocked independently, with no approved target or process inputs. No publication is authorized.

### Runtime-work baseline (PR0 characterization)

Extend `tests/ui/scenario_draft_history.spec.js` with a reusable source-bundle probe on the same synthetic fixture and eight named Scenario transitions used by DOM parity. Run fresh Chromium contexts twice at both the recorded base and candidate SHAs. Enable existing counters with `/?perf=1`, keep normal polling/presence timers active, and permit the fixture's root route to accept the query. There is no production snapshot/reset API: the source-bundle harness applies an **in-memory test-only** esbuild adapter, anchored exactly once immediately after `const perfStateLastRef = useRef({});`:

```js
if (perfEnabled) window.__JEP_EXTRACTION_PERF__ = () => ({ ...perfCountersRef.current });
```

The adapter never modifies tracked production source or generated dist, adds no hook/effect/state update, and writes no counters. Missing/duplicate anchors fail. Read copied snapshots after startup/Run Scenario and each settled action: `renders`, `edgeRequests`, `edgeFrames`, `edgeComputes`, `layoutReads`, `scrollReads`, `laneStacking`, `statsBuild`. Reset a measurement phase by saving a copy and subtracting it from the next copy; never reset production refs or logger baselines. After the eight phases, take a settled snapshot, leave the UI untouched for 5,000 ms, and capture `scenario-idle-5s`. Export per-phase deltas and cumulative snapshots to a fresh ignored directory with exclusive creation, exact SHA, fixture/runtime/browser details and command; require all labels exactly once and no unexpected API requests.

Compare repeat-run observations at the same runtime and fixture. Investigate extra rendering, scheduling, lane/layout or idle work, duplicate listeners/polls/SSE, and render loops; unexplained differences block the source rung for operator review. Explain concurrent-timer/frame-coalescing variation from the raw samples rather than adding arbitrary tolerances. These counters cover existing instrumentation, not all component renders/DOM reads, request counts, CPU duration, or production-scale performance: `edgeRequests` counts scheduling requests, `edgeFrames` accepted frames, and layout/scroll counts instrumented callbacks. Do not claim latency improvements from file size or test wall time.

Historical-source feasibility probes on `831acf7a` passed twice, including all eight transitions and the idle phase. Both idle deltas were renders 4, scheduling requests 10, frames/computes 2, layout/scroll callbacks 2, lane stacking 4, stats builds 0; seven transition deltas matched and Epic-focus counts varied. Positive idle work is therefore preserved behavior, not an automatic failure. PR0 must commit the reusable probe and remeasure its actual-base baseline; these samples are not its acceptance envelope. Rebase refreshes that baseline. Run this named source-bundle probe for each Scenario-affecting R4 and at final acceptance.

### Commit P0-5 (R2): Baselines

- [x] Install and run the reusable runtime-work probe above twice against the unchanged PR0 base; record raw action/idle samples, counter meaning, command and source anchor. Run the 13 DOM-helper controls and all added growth/timing controls; no claim of coverage from the historical probes alone.
- [x] At the recorded PR0 base SHA, refresh the source/hook/budget counts and run the recursive extraction gate, full Chromium `tests/ui`, Node suite, and Python suite. Record pass/fail/skip counts, wall time, and every failure by name in section 1; keep earlier counts labelled historical. Failures are not automatically excluded from later gates: resolve them, or obtain an explicit operator waiver naming each affected check and exact revision before publication. List any such waiver in every affected PR description.

**Validation scope:** review the recorded baselines; no app check.

**P0-5 runtime samples (2026-10-03):**

The new opt-in `Scenario runtime-work baseline` shares P0-3's exact positive eight-state fixture/action assertions. Its source adapter inserts only the printed copied-read function after `const perfStateLastRef = useRef({});` (current line 406), in memory with esbuild `write: false`. It adds no hook, effect, state update, counter write or timer override. Missing/duplicate anchors, invalid provenance, label ordering, counter monotonicity and exclusive output are covered by 14 scratch VM controls. Ordinary runs skip this opt-in measurement.

Fresh directories `tmp/p0-5-runtime/base-run1`, `base-run2`, `candidate-run1`, `candidate-run2` each contain metadata, eleven ordered sample files and a summary. Base source SHA is `ffeafb0ea3f37dd17a5d910595c20e1493166c5c`; candidate source SHA is `472e98d8e3cdb0bf89ceb5b921d609d26b6116a1` (production source matches both revisions exactly). Runtime: Node 20.20.0, Playwright 1.59.1, esbuild 0.27.2, headless Chromium 147.0.7727.15 with 1280×860 viewport. All 222 canonical build inputs have identical verified digests at both revisions. Reconstructed JS and CSS differ only in 257 and 58 source-path comment lines respectively, caused by the archive prefix; every executable/style line is identical. Sample campaigns passed individually in 36.4 / 33.4 / 33.5 / 33.8 seconds, with no unexpected API requests and exactly one Scenario compute POST each.

The ignored driver recorded the exact `bash tmp/p0-5-run-probe.sh <label> <source-root> <source-sha>` invocation; its contents are:

```bash
#!/usr/bin/env bash
set -euo pipefail
label="$1"
source_root="$2"
source_sha="$3"
export JEP_EXTRACTION_PERF_DIR="tmp/p0-5-runtime/$label"
export JEP_EXTRACTION_PERF_SOURCE_ROOT="$source_root"
export JEP_EXTRACTION_PERF_SOURCE_SHA="$source_sha"
export JEP_EXTRACTION_PERF_COMMAND="bash tmp/p0-5-run-probe.sh $label $source_root $source_sha"
fnm exec --using 20 npx playwright test tests/ui/scenario_draft_history.spec.js --browser=chromium --workers=1 --grep 'Scenario runtime-work baseline$' --output="tmp/p0-5-probe-$label-results"
```

Each named call runs alone, with fresh output. Initial `--grep '^Scenario runtime-work baseline$'` matched no tests because Playwright matches qualified titles; the corrected suffix pattern above selected exactly one. That invocation produced no runtime samples and is not sample evidence.

Counters are ordered `renders / edgeRequests / edgeFrames / edgeComputes / layoutReads / scrollReads / laneStacking / statsBuild`. Values are raw phase deltas; each exclusive sample file also contains cumulative counters and API timestamps.

| Phase | Base run 1 | Base run 2 | Candidate run 1 | Candidate run 2 |
| --- | --- | --- | --- | --- |
| scenario-startup | `21/0/0/0/0/0/0/0` | `19/0/0/0/0/0/0/0` | `18/0/0/0/0/0/0/0` | `18/0/0/0/0/0/0/0` |
| scenario-run | `17/34/8/8/5/5/12/0` | `17/34/8/8/5/5/12/0` | `17/34/8/8/5/5/12/0` | `17/34/8/8/5/5/12/0` |
| scenario-team-collapsed-lanes | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` |
| scenario-team-expanded-lane-edges | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` |
| scenario-epic-lanes | `5/15/3/3/3/3/5/0` | `5/15/3/3/3/3/5/0` | `5/15/3/3/3/3/5/0` | `5/15/3/3/3/3/5/0` |
| scenario-epic-focus | `6/16/3/3/2/2/6/0` | `8/21/4/4/3/3/8/0` | `6/16/3/3/2/2/6/0` | `6/16/3/3/2/2/6/0` |
| scenario-assignee-lanes | `10/28/6/6/5/5/10/0` | `10/28/6/6/5/5/10/0` | `10/28/6/6/5/5/10/0` | `10/28/6/6/5/5/10/0` |
| scenario-tooltip | `7/21/5/5/4/5/7/0` | `7/21/5/5/4/5/7/0` | `7/21/5/5/4/5/7/0` | `7/21/5/5/4/5/7/0` |
| scenario-conflicts-only | `7/18/4/4/3/3/7/0` | `7/18/4/4/3/3/7/0` | `7/18/4/4/3/3/7/0` | `7/18/4/4/3/3/7/0` |
| scenario-conflicts-restored | `5/15/3/3/3/3/5/0` | `3/10/2/2/2/2/3/0` | `3/10/2/2/2/2/3/0` | `3/10/2/2/2/2/3/0` |
| scenario-idle-5s | `2/5/1/1/1/1/2/0` | `2/5/1/1/1/1/2/0` | `3/8/2/2/1/1/3/0` | `3/8/2/2/1/1/3/0` |

Raw repeat differences remain visible. Run Scenario and six subsequent action deltas match in all four runs. Startup performs the same 23 API requests, with 18–21 instrumented App renders, consistent with independent bootstrap responses landing and batching; batching is inferred, not instrumented. The restored sample in base run 1 includes a poll before capture (poll 27,672 ms, sample 27,834 ms); base run 2 captures before its next poll (sample 27,066 ms, poll 27,234 ms). Base run 2's focus sample includes an extra render/layout/scroll/frame cycle, consistent with the existing focus range/viewport effects and pending-frame coalescing; callback causality is inferred, not instrumented. These are timing-supported explanations of unchanged-source samples, not proof that raw request timestamps uniquely identify each callback ordering.

All four cumulative accepted edge-frame and compute counts are **35**. Base run 1 has seven event polls; the other three have six because their elapsed sample windows end on different sides of the five-second boundary. Every run has two presence POSTs, one Scenario compute POST, the same four startup task reads, and no SSE connection or draft save. The idle windows are 5,014–5,023 ms. Both base idle deltas are `2/5/1/1/1/1/2/0`; both candidate idle deltas are `3/8/2/2/1/1/3/0`. The extra candidate idle render and scheduling/frame/stacking counts have no extra API or layout/scroll callback: the normal poll and presence heartbeat land milliseconds apart, and `learnScenarioCurrentUserFromPresence` always creates a fresh identity object while the poll creates a fresh realtime-status object. Their updates can batch or land separately; this batching explanation is an inference, not instrumented callback ordering; the three existing edge-scheduling effects count requests before the pending-frame guard. The frame work redistributes between phases while total accepted frames remain 35. Source evidence: poll at 9330–9356, heartbeat at 9372–9390, identity update at 7397–7403, layout/scroll setup at 10880–10956, focus/viewport updates at 11528–11551, and request/frame coalescing at 11555–11601. Re-locate those symbols after moves.

`edgeRequests` counts scheduling requests, `edgeFrames` accepted frames, and layout/scroll counters instrumented callbacks. This is an observation baseline with normal timers, not an arbitrary numerical tolerance, latency comparison, complete component-render/DOM-read inventory, or production-scale performance claim. Future source moves still require repeat raw samples and an explanation of extra work. The final full-base browser campaign passed as recorded in section 1; the full candidate committed-head browser run remains a publication gate.

**P0-5 verification record:**

- Exact-base Node/Python suites ran from the ignored archive; their commands, isolated profile, counts and wall times are in section 1. The final full Chromium command ran there with read-only Git root variables pointing to the checkout metadata/archive: `fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4 --output=../p0-5-base-ui-final-results`. It passed 1,197 tests with 3 skips in 9.1 minutes; the retained earlier failure names and unchanged diagnostic results are in section 1.
- `fnm exec --using 20 bash scripts/extraction_lint/run.sh`: passed, 0 errors / 120 unchanged warnings, 41 owners, 16 sites, 0 budget problems. `fnm exec --using 20 bash scripts/extraction_lint/negative_controls.sh`: all 70 controls passed, including the original 21. `fnm exec --using 20 node tmp/p0-5-probe-controls.cjs`: 14 independent probe controls passed.
- Candidate `fnm exec --using 20 npm run test:frontend:unit`: 1,728 passed in 3.358 seconds. Candidate isolated Python suite: 2,112 tests, OK with 29 skips in 260.279 seconds. `fnm exec --using 20 npm run build` and `make verify-dist-clean`: passed with no generated diff.
- `JEP_DOM_PARITY_DIR=tmp/dom-parity/p0-5-candidate fnm exec --using 20 npx playwright test tests/ui/dom_parity_helpers.spec.js tests/ui/scenario_draft_history.spec.js tests/ui/scenario_draft_collaboration.spec.js tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js --browser=chromium --workers=4 --output=tmp/p0-5-targeted-results`: 182 passed (169 characterization checks plus all 13 helper controls), 1 intentional opt-in runtime skip, 1.9 minutes. All 34 distinct nonempty captures match P0-3 run 2 by filename and byte content; `diff -r tmp/dom-parity/p0-3-run2 tmp/dom-parity/p0-5-candidate` produced no differences. The runtime test passed separately in all four recorded campaigns.
- Production source is byte-identical across the base and candidate; App plus the complete 41-owner set retains the same inventory and budgets. No move occurred, so there is no statement-conservation residual to approve. The shared eight-state oracle retains every existing assertion. This test-only probe adds no user-visible analytics interaction or event; the internal-tooling allowlist applies.
- Operator validation: review this baseline/probe diff and the recorded raw samples, timing explanations and suite evidence; no app interaction. P0-4 was validated by the continuation. Stop at this local P0-5 commit; P0-6 and all extraction rungs remain unexecuted. Home-write is blocked independently, and publication still requires explicit approval and full committed-head checks.

### Commit P0-6 (R5): Ontology and docs

- [x] Update `docs/ontology.md`: add entries "Scenario Planner ownership" and "Settings state ownership" (canonical names, aliases, entry points in `dashboard.jsx` today, this plan, tests, relationships `depends on`/`produces`) with a verification date; update the existing entries that cite `dashboard.jsx` ownership (Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, "Board scope load authority" at line 76, "Startup config timeout" at line 18) and the Coverage line; confirm every cited path resolves.
- [x] Propose to the operator (do not edit unasked) a line for root `AGENTS.md` section 10 Commands naming `scripts/extraction_lint/run.sh`; section 10 is a preserved section and needs approval.

**Validation scope:** review the ontology text; no app check.

**Proposed root `AGENTS.md` section 10 Commands entry (approval pending; root file unchanged):**

```md
- Extraction gate: fnm exec --using 20 bash scripts/extraction_lint/run.sh
```

**P0-6 outcome (2026-10-03):** Implemented as planned. Ontology coverage now includes current Scenario Planner/Settings ownership, six refreshed related entries, current symbols, contracts and relationships verified against `c4ab713a`. Already-extracted hook responsibilities remain explicit; future hook files are not claimed to exist. G1/G2, terminal authentication recovery and imperative saves retain the approved boundaries. This documentation-only rung adds no user-visible interaction or analytics event. The root command proposal is deliberately unapplied; P0-6 completion requires proposing it, not altering the preserved root section.

The approved rebase/source refresh is recorded in section 1. Fresh extraction gate: 0 errors / 120 unchanged warnings, 16 sites / 41 modules / 34 informational findings / zero budget problems. `fnm exec --using 20 npm run test:frontend:unit`: 1,728 passed, zero failures/skips, 10.955 seconds. `fnm exec --using 20 npm run build` and `make verify-dist-clean` passed. The first scratch archive capture invocation used the wrong relative harness-copy directory and was interrupted; no app assertion result from that invalid setup is baseline evidence. After the copy was corrected, the identical six PR0 test/helper files ran against untouched new-base production source: 182 passed, one intentional runtime skip, 2.2 minutes, fresh directory `tmp/p0-6-base/tmp/dom-parity/p0-6-before-corrected`. Logs remain under ignored `tmp/`. All full-suite/runtime samples from the prior base remain labelled exact-revision evidence; full suites at the proposed publication head remain mandatory.

Final independent `.venv/bin/python tmp/p0-6-verification.py`: passed; all four named files, 195 relative Markdown file links, 161 inline paths/module members, nine heading references and 64 current ownership/source symbols resolve. Reviewer found no remaining actionable issue. `git diff --check` passed.

Rebased-head command: `JEP_DOM_PARITY_DIR=tmp/dom-parity/p0-6-after fnm exec --using 20 npx playwright test tests/ui/dom_parity_helpers.spec.js tests/ui/scenario_draft_history.spec.js tests/ui/scenario_draft_collaboration.spec.js tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js tests/ui/codebase_structure_smoke.spec.js tests/ui/eng_issue_field_edits.spec.js --browser=chromium --workers=4 --output=tmp/p0-6-after-results`: 215 passed, one intentional opt-in runtime skip, 3.2 minutes. This covers Scenario/Settings synthetic smoke, structure/startup behavior, 13 DOM-helper controls and the upstream Team editor. All 34 distinct nonempty new-base/head captures have the same filenames and exact bytes; `diff -r tmp/p0-6-base/tmp/dom-parity/p0-6-before-corrected tmp/dom-parity/p0-6-after` produced no differences. Production source matches the new base, so there is no extraction conservation residual; range-diff preserves every unpublished rung patch.

Stop at this local P0-6 commit for operator ontology/proposal review; no app check. Source extraction and publication remain unexecuted. The independent Home-write gate is still blocked and does not prevent this rung.



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

**SC1 R1 outcome (2026-10-03):** Implemented on `improvement/scenario-state-container` from fetched merged PR0 main `6086bf8cbfe78c48c3ea44acfe37d5a194c4e32d`; the worktree was clean and no open PR touched `dashboard.jsx`. Issue #220 was reopened with operator authorization after PR0 wording accidentally triggered GitHub issue closure. PR0 head `e6437899` merged in #227; all four remote checks passed.

Exactly five inert declarations are removed: `scenarioBottleneckLanes`, `scenarioHasAssignees`, `scenarioUnschedulable`, `scenarioDeadlineLeft`, and `scenarioIsSingleTeamFocus` (24 physical lines, 18,434 → 18,410). Each had one declaration and no other reader in frontend source/tests. Their initializers only filter/read/arithmetic over existing data. No current guard pin names any of them, so no passing guard is edited. `scenarioDraftEvents` and its setter remain under D6: `applyScenarioDraftEvent` can call the setter for a zero-number event, then return for expired presence without another state update. Its reset in `runScenario` is batched, but that does not establish every-call batching. `scenarioUndoVersion` and unrelated `isUnscheduled` declarations remain. Interfaces, effect order, closures, request counts, terminal auth recovery, Settings permissions/save order and layout are unchanged. Internal dead-code removal adds no analytics interaction/event.

Fresh verification uses pinned Node 20 and the checkout interpreter. `npm run test:frontend:unit` passed 1,731 tests, zero failures/skips (13.131 s). The section-6 isolated full Python command passed 2,113 tests, 29 skips, zero failures (160.345 s). The first gate and concurrently started Python run detected stale owner *measurements*, not a behavior failure: dashboard 18,434/app-plus-owners 28,712 still described the base. Updating only those measured fields to 18,410/28,688 repaired that failure; the complete Python suite and canonical gate were rerun. Existing ceilings remain 18,434/28,712 until R5, and all 41 owner/interface caps remain unchanged. The canonical gate passes with zero errors, 115 warnings (exactly five unused-variable warnings removed), zero owner-budget problems, 16 sites/41 modules/zero enforced/34 informational findings. Its default warning ceiling is ratcheted to 115. All 70 tooling controls and both budget tests pass.

The exact-base ignored archive ran the three named Scenario specs, structure smoke, server-unavailable recovery, and four instrumented parity specs: 201 passed, one intentional runtime-probe skip (3.2 min). Candidate coverage adds the 13 DOM-helper controls: 214 passed, one identical skip (3.2 min). `scenario_focus_positions.spec.js` remains an inactive local template; positive focus/Escape coverage comes from the history characterization. Fresh directories `tmp/sc1-r1-base/tmp/sc1-r1-before` and `tmp/sc1-r1-after` contain the same 34 distinct nonempty labels and byte-identical HTML (empty recursive diff). No assertion, timeout, fixture or normalizer was weakened. The required SM-S request/conflict/auth/recovery checks are exercised by the unchanged browser tests; operator visual smoke remains below.

Fresh headed screenshot probes captured eight timeline labels before and after. Ordinary captures showed paint variation confined to the existing infinite `conflict-pulse` animation. Repeated captures apply the same screenshot-only animation/transition override in two ignored archive fixtures, leaving production CSS and tracked tests untouched. Baseline and candidate probes each pass (8.6 s / 9.0 s); all eight PNGs in `tmp/sc1-r1-screenshots-before-still` / `tmp/sc1-r1-screenshots-after-still` match by label, dimensions, bytes and pixels. Parent visually reviewed the Epic-focus and Team/edge presentation; no visible change is introduced. The ordinary-animation captures remain labelled evidence, not an exact-pixel claim.

Additional conservation compares App plus all seven existing Scenario/Settings/EPM hook owners at both revisions: 1,698 → 1,693 statements, exactly the five deleted declarations as reviewed residuals, zero additions, identical order across 155 effects. Generated JS and its source map are rebuilt from source; no generated file is hand-edited. Home-write gate recheck finds zero of four process inputs and no approved disposable target; it stays blocked, next review 2026-10-05, independently of SC1.

**Operator validation:** SM-S in full: run Scenario; expand Team lanes; switch Team → Epic → Assignee; focus an Epic then Escape; hover ordinary/right/bottom bars; Edit, drag, check override count, undo and Exit Edit; Save Draft, History and Escape; switch Default → Alternate → Default and verify prior lane/collapse state; interrupt/retry the connection with an unsaved override and confirm one restoration with no extra write. Review the next-move frozen proposal below. Stop at this R1 local commit; R4a implementation, R5 and publication remain pending.

**SC1 R4a outcome (2026-10-03):** Implemented as planned after operator validation of R1 `ae35f76de75ac924c151aa7a2ff79fbbc388e017` and the frozen proposal below. Fetched main remains `6086bf8cbfe78c48c3ea44acfe37d5a194c4e32d`. The three production-source SHA-256 values exactly match that proposal: App `f94221553f3c8640b5d8c298fe5149435359d243509fa593ada1bbff55a0eba4`, state owner `8a5c29f0815a10d6985fa7ac6ab94da1b8d646a4e1817da8d0e4aeac403530fb`, helper `de3aa34ff4805e8ef1d2ce1ee395896a46713735b1d6384bef5ce7c047d227c6`. The reviewed checkpoint is installed before verification: 18,307/210/95 physical lines, 28,890 combined lines, exactly +202 scaffolding and no transfer credit; all 41 existing owner/interface ceilings are preserved. R5 still owns the structure-test and warning-ceiling ratchets; this rung's warning ceiling remains 115.

The seven helper oracles were written first and failed against the missing module (0/7, `ERR_MODULE_NOT_FOUND`), then passed on the implementation. The added SSR probe establishes the ordered 86-name flat return, representative defaults and all 14 memo members; final focused oracle result is 8/8. Both synthetic mutations are killed: changing `||` fallbacks to `??` fails the falsy-snapshot assertion, and unconditional frame cancellation fails the no-pending-frame assertion (each 7/8). All 56 moved state/ref initializer bodies are conserved; the lane initializer receives the same App nullish fallback. App retains 83 readers and drops only unread returned values. There are no new effects or getter closures. The fifteen apply setters preserve their ordered fallbacks; `setScenarioLoading(false)` is consolidated into the helper in the same synchronous React effect batch. Nine transient refs preserve clear/cancel/reset order; `alertDismissedRef` and `epicRefMap` stay in App. Native frame cancellation invokes no callbacks. Global auth, draft/conflict recovery, permissions, imperative saves, analytics and layout remain unchanged; this internal ownership move adds no analytics interaction.

`fnm exec --using 20 node --test tests/test_*.js` passes 1,739 tests with zero failures/skips (3.969 s). The initial full run detected exactly one moved-owner metadata source guard (1,738 pass/one fail); only its positive-anchored state slice now reads `useScenarioState.js`, preserving the scope-builder/runScenario slices and every assertion. Focused guard/oracle checks pass 26/26. The section-6 isolated full Python command passes 2,113 tests with 29 skips (142.406 s), and both structure-budget tests pass. Build and canonical extraction gate pass: zero errors, 113 warnings under the unchanged 115 ceiling, 43 modules/17 sites, zero enforced or owner-budget problems, and 34 unchanged informational findings. All 70 tooling controls pass after reanchoring the TDZ seed to the new call. The first control attempt failed from shell quoting in that synthetic seed; the stable quoted retry passes without relaxing a control. Structured strict scans cover App and both new owners, with no fatal diagnostics and zero hits for any of the 86 returned names.

Conservation compares App and the complete eight existing affected hook owners plus the new state hook at both revisions: 1,696 → 1,700 statements, five removed/nine new residuals, identical order of all 155 effects. Every full residual is included in the local commit message and reviewed independently: lane initializer delegation, four old/new group functions/effect seams, hook call/destructure, scalar state initialization, memo and return. Pure helper bodies are separately covered by source review and the oracles; no residual is treated as an exemption.

Fresh baseline/candidate Chromium runs of the eight Scenario/Settings/recovery/structure/parity-helper specs pass 214 tests with one intentional opt-in runtime skip each (3.0/2.9 min). All 34 distinct nonempty HTML captures match byte-for-byte between `tmp/sc1-r4-before-base/tmp/sc1-r4-before` and `tmp/sc1-r4-after`. No assertion, fixture, timeout or normalization boundary is weakened. Fresh headed screenshot probes pass at both revisions (11.8/8.9 s); all eight timeline PNG labels, dimensions, bytes and pixels match in `tmp/sc1-r4-screenshots-before-still` and `tmp/sc1-r4-screenshots-after-still`. The same screenshot-only animation/transition override settles the existing conflict pulse in two ignored archive fixtures; production CSS and tracked tests are untouched.

Both normal-timer baseline probes at exact R1 SHA pass (34.0/33.0 s), with 11 labels each and no unexpected API calls. Idle timing crosses ordinary polling boundaries: baseline samples have 3/4 renders, 8/10 edge-scheduling requests, 1/2 layouts and 3/4 lane reads; both have two frame computes and zero stats work. Candidate probes must run twice after the local commit using its exact SHA, followed by independent comparison of startup/action/input hashes, raw counts and polling timestamps. The committed-revision build and runtime results are reported at the operator validation stop; they are not claimed here before execution. Evidence directories are `tmp/sc1-r4-runtime-before-{1,2}` inside the exact-base archive and fresh candidate runtime directories.

Home-write gate recheck finds zero of four process inputs and no approved disposable target; it remains independently blocked, next review 2026-10-05. **Operator validation:** SM-S in full as above, especially Default → Alternate → Default retaining lane/collapse state and unsaved-override interruption/retry restoring once with no extra write. Stop after the R4a local commit and its committed-revision verification; R5 and publication remain pending.

**SC1 R5 outcome (2026-10-03):** R4a `0b9a78e7b3ebf83f0811c6b1e7d59f6cae678367` was validated by the operator. Fetched main is still `6086bf8cbfe78c48c3ea44acfe37d5a194c4e32d`. This rung ratchets the structural dashboard ceiling from 18,434 to 18,307 and the default lint ceiling from 115 to 113. The canonical owner manifest already matches every measured per-file/interface/aggregate ceiling within the frozen checkpoint (43 modules, Scenario 780, Settings 9,803, unique owners 10,583, combined 28,890); it is preserved byte-for-byte. The 282 tracked frontend source/dist files are byte-identical to validated R4a, so this rung introduces no visual, behavior, request, analytics or interface change. The per-group markers in `test_stats_module_extraction_source_guards.js` survive and its assertions remain unmodified.

Completed postcommit R4a evidence: the exact-head build and `make verify-dist-clean` passed with no generated diff. Both candidate normal-timer probes at `0b9a78e7` passed (33.9/33.2 s), completing the four-run campaign against R1 `ae35f76d` (34.0/33.0 s). All 11 labels, monotonic counters and raw deltas validate; the nine action-phase counter deltas match exactly across all four samples. The full API sequence is identical: 23 startup requests and 34 total, including one Scenario POST, six event polls and two presence writes, with no unexpected calls. Both candidate idle samples equal baseline sample 1; baseline sample 2 already has one extra render/layout/scroll/stacking pass and two extra edge-scheduling requests while frame computes remain two. Startup renders vary 20/21 within the candidate repeats. Normal polling remains approximately five seconds; response batching is a supported inference, not a proven callback-level explanation. Small wall-clock residuals (up to 24 ms above the two baseline action samples) introduce no extra measured action work; no performance improvement is claimed. Normalized source-input provenance is 222 baseline/224 candidate entries: only the dashboard digest changes and the two expected new owner modules are added; fixture, adapter, CSS and remaining inputs are identical. Independent review found no unexplained candidate work increase.

R5 verification: `fnm exec --using 20 node --test tests/test_*.js` passes 1,739 tests (2.747 s); the section-6 isolated Python discovery passes 2,113 tests with 29 skips (126.167 s); `tests.test_codebase_structure_budgets` passes both tests (0.234 s). The canonical gate passes with zero errors, 113 warnings under the new 113 ceiling, 43 modules/17 sites, zero owner/enforced problems and the same 34 informational findings. All 70 tooling controls pass. The pinned source build succeeds and preserves the committed dist; the committed-revision rebuild/clean check follows this local metadata-only commit before the validation report. The required operator scope is **review the diff only; no additional app smoke**. Stop at this local R5 commit. R6 publication still requires a separate explicit go, fresh full suites/full Chromium and the complete exact-head publication transaction. No publication or later slice is authorized by R4a validation.

**Remaining-App responsibility inventory after SC1** (verified against `0b9a78e7`; costs below are physical SC1 call-site/seam additions, not estimates of future moves or total responsibility size):

| Canonical responsibility | Retained symbols and consumers | Why it remains / owner relationship | SC1 call-site/seam cost |
| --- | --- | --- | ---: |
| Scenario state composition | `scenarioState` and its 83-name App destructure feed the planner, group cache, connection snapshot and timeline | App calls effect-free `useScenarioState` unconditionally; state/ref ownership is extracted, per-render consumers remain until SC2/SC4 | 86 lines (call plus destructure); two module-import lines |
| Cross-feature per-group persistence | `buildDefaultGroupState`, group snapshot, `applyGroupState`, group-cache effects consume `scenarioGroupValues` alongside ENG/Planning/Statistics values | The cache spans several features; only Scenario defaults/setters/transient resets delegate to `scenarioGroupState.js` | Five one-line seams: default spread, snapshot spread, memo dependency, reset call, apply call |
| Scenario compute/draft/realtime orchestration | `runScenario`, `scenarioDraftIdleActionState`, draft/history/presence/lock/drag handlers and their timeline consumers | SC2 will move the approved contiguous behavior cluster; existing clear/reset/view-mode effects stay at shell crossings. Recovery waiting already belongs to `useConnectionScenarioRecovery` | 0 new seam lines; reads extracted state through the flat interface |
| Scenario layout and presentation | `scenarioRawIssues`, `scenarioLanes`, `scenarioPositions`, `scheduleScenarioEdgeUpdate`, `.scenario-fullbleed` JSX | Computation moves under SC2/SC3 and JSX under SC4, preserving the documented split and late-assignment order | 0 new seam lines |
| Settings bootstrap, draft/save authority and modal composition | `openGroupManage`, `loadConfig`, `loadGroupsConfig`, `saveGroupsConfig`, `saveEpmConfig`, `saveAllSettingsOnce`, `saveAllSettings`, `SettingsModal` | ST1–ST5 own later moves. Existing field/catalog/private-preference/Admin Access hooks remain separate owners; G2 preserves imperative save order and the separate permission-fix prerequisite | 0 new seam lines |
| Shared scope, auth and ENG/Planning/Statistics/EPM shell | `savedPrefsRef`, `planningScopeKey`, `acceptedBoardConfigRef`, `engWorkspaceConfigured`, auth/recovery wiring, `EngView`, Planning components, Statistics memo consumers and `useEpmViewData` composition | Cross-feature scope and auth lifetime remain App responsibilities; already-extracted owners consume explicit inputs. This slice transfers no non-Scenario responsibility | 0 new seam lines |

SC1 adds exactly 93 App scaffolding lines (86 + 2 + 5), replaces 28 snapshot/dependency lines and transfers 168 source lines with zero combined transfer credit. Owner files remain 210/95 lines. Neither new owner imports `dashboard.jsx`; imports flow from App to the state/helper modules. This inventory describes current responsibility, not undocumented team ownership; later R5 rungs must update retained consumers and costs.

**SC1 R4a frozen preflight proposal (presented at the R1 validation stop).** This is a current-source dry-run budget/interface checkpoint, not execution of R4a. Exact slice base: `6086bf8cbfe78c48c3ea44acfe37d5a194c4e32d`; incoming R1 dashboard SHA-256: `c5afca1a9632725fcb5c2c7be07da8a486f1885e661fe95558cde47042d66cb2`. The two new owners and wiring remain only in ignored scratch. R4a must write its oracle tests first, observe red against the missing module, then implement and pass full checks, runtime comparison and parity before its own operator stop. Any upstream drift requires a new proposal from the refreshed base.

| Next checkpoint `SC1-state-container` | Incoming measured LOC | Frozen proposed LOC ceiling |
| --- | ---: | ---: |
| `dashboard.jsx` | 18,410 | 18,307 |
| `scenario/useScenarioState.js` (Create) | 0 | 210 |
| `scenario/scenarioGroupState.js` (Create) | 0 | 95 |
| Scenario owners | 475 | 780 |
| Settings owners | 9,803 | 9,803 |
| Unique owners | 10,278 | 10,583 |
| App plus unique owners | 28,688 | 28,890 |

All 41 existing per-file and interface ceilings are carried forward unchanged. Transferred source is 168 physical lines (101 state/ref declarations and 67 default/apply/reset lines); it grants **zero** combined growth credit. Net scaffolding is exactly +202: 109 state-owner lines (imports/wrapper/86-name return/14-field memo), 28 helper wrapper/key-constant lines, 93 App scaffolding lines (86 call/destructure + two imports + five seam replacements), minus 28 old snapshot/dependency lines. The helper's 28 lines comprise 16 frozen-key constant lines, four default function/return wrapper lines, three apply header/null-fallback/closing lines, two reset header/closing lines and three blank separators. No padding or unrelated deletion is credited. Current R1 ceilings remain unchanged until the planned ratchet; these proposed new caps are installed before the R4a checks, not inferred from its finished diff.

Transferred declaration anchors are `scenarioCurrentUserIdentity` (current lines 475–478), the `scenarioLoading` through `scenarioEdgeRender` block (1032–1130, excluding `searchInputRef` and `let scheduleScenarioEdgeUpdate`), and `scenarioRefreshNonceRef` (1188). Preserve their 29 `useState`/27 `useRef` initializers; the state owner adds one memo. Group seam anchors remain `buildDefaultGroupState` (14 entries, 6018–6040), its snapshot (6117–6129), the memo dependencies (6335–6347), apply setters (6232–6254) and final `setScenarioLoading(false)` (6275). The nine reset refs move at 6153–6171 while `alertDismissedRef.current = false` and `epicRefMap.current = new Map()` stay in App. Re-locate these by symbol/text, not by historical line number.

| New export | Outer / expanded inputs | Returns / props | Caller and phase |
| --- | --- | --- | --- |
| `useScenarioState` | 1 / 1 (`initialLaneMode`) | 86 / 0 | App, unconditional hook execution at the earliest declaration |
| `buildDefaultScenarioGroupState` | 1 / 1 (`initialLaneMode`) | 14 / 0 | App's existing `buildDefaultGroupState`, deferred execution |
| `applyScenarioGroupState` | 2 / 29 (15 setters + 14 snapshot fields) | 0 / 0 | App's existing `applyGroupState`, deferred execution |
| `resetScenarioTransientRefs` | 1 / 9 refs | 0 / 0 | App's existing `applyGroupState`, deferred execution |
| `SCENARIO_GROUP_STATE_KEYS` | constant, no input | exact 14 frozen keys | pure module constant, no App import required |

The state hook takes only `initialLaneMode`; App passes `savedPrefsRef.current.scenarioLaneMode ?? 'team'` from an already-initialized ref. The checker reports forwarding of that scalar to `useState(initialLaneMode)`: manual complete member inventory is exactly that one scalar, reviewed against source digest `8a5c29f0815a10d6985fa7ac6ab94da1b8d646a4e1817da8d0e4aeac403530fb`. This review is carried into the next manifest with its matching digest; it is not a baseline exception. No new owner imports App, no owner has an effect, and no getter or later-captured binding is introduced. All helper call sites remain within the current deferred functions; their plain parameters require the explicit manual bag ledger below because automatic hook/container checking does not enforce pure helper contracts. The group's 14 fields appear once in the memo object and its dependencies. App keeps exactly the 83 return names it still reads, omitting only `scenarioScrollLeft`, `scenarioDraftEvents`, `scenarioUndoVersion`; the latter two cells and their setters remain inside the hook.

Frozen flat state return names:

```text
scenarioCurrentUserIdentity
setScenarioCurrentUserIdentity
scenarioLoading
setScenarioLoading
scenarioError
setScenarioError
scenarioData
setScenarioData
scenarioLaneMode
setScenarioLaneMode
scenarioShowConflictsOnly
setScenarioShowConflictsOnly
scenarioTimelineRef
scenarioLayout
setScenarioLayout
scenarioCollapsedLanes
setScenarioCollapsedLanes
scenarioCollapsedCards
setScenarioCollapsedCards
scenarioSummaryHidden
setScenarioSummaryHidden
scenarioHoverKey
setScenarioHoverKey
scenarioFlashKey
setScenarioFlashKey
scenarioScrollTop
setScenarioScrollTop
scenarioScrollLeft
setScenarioScrollLeft
scenarioViewportHeight
setScenarioViewportHeight
scenarioEpicFocus
setScenarioEpicFocus
scenarioRangeOverride
setScenarioRangeOverride
scenarioFocusRestoreRef
scenarioSkipAutoCollapseRef
scenarioTeamCollapseInitRef
scenarioHistoryButtonRef
scenarioHistoryPanelRef
scenarioHistoryTitleRef
scenarioOverrides
setScenarioOverrides
scenarioActiveDraftIdRef
scenarioScopeKeyRef
scenarioDraftMeta
setScenarioDraftMeta
scenarioDraftEvents
setScenarioDraftEvents
scenarioDraftPresence
setScenarioDraftPresence
scenarioDraftLocks
setScenarioDraftLocks
scenarioDraftRealtimeStatus
setScenarioDraftRealtimeStatus
scenarioDraftLastEventNumber
setScenarioDraftLastEventNumber
scenarioEditMode
setScenarioEditMode
scenarioUndoStackRef
scenarioUndoVersion
setScenarioUndoVersion
scenarioDragState
setScenarioDragState
scenarioDragStateRef
scenarioDragFrameRef
scenarioDragLockRefreshRef
scenarioRealtimeCsrfRef
scenarioHistoryRefreshControllerRef
scenarioHistoryActionControllerRef
scenarioViewRangeRef
scenarioWasDraggedRef
scenarioEdgeUpdatePendingRef
scenarioEdgeFrameRef
scenarioScrollFrameRef
scenarioResizeFrameRef
scenarioPendingScrollRef
scenarioTooltip
setScenarioTooltip
scenarioTooltipRef
scenarioTooltipAnchorRef
scenarioIssueRefMap
scenarioEdgeRender
setScenarioEdgeRender
scenarioRefreshNonceRef
scenarioGroupValues
```

The 14 `scenarioGroupValues` members, default return keys and snapshot input keys are exactly the `SCENARIO_GROUP_STATE_KEYS` listed in SC1 above. The apply setter bag is exactly those 14 fields' `setScenario…` names plus `setScenarioLoading`; it retains `||` fallbacks and supports a null snapshot with `snapshot || {}`. The reset bag is exactly `scenarioIssueRefMap`, `scenarioEdgeUpdatePendingRef`, `scenarioFocusRestoreRef`, `scenarioSkipAutoCollapseRef`, `scenarioTeamCollapseInitRef`, `scenarioEdgeFrameRef`, `scenarioScrollFrameRef`, `scenarioResizeFrameRef`, `scenarioPendingScrollRef`, each exposing only `.current`. Preserve the map-clear, frame-truthiness, cancellation and null-reset order. The helper source digest is `de3aa34ff4805e8ef1d2ce1ee395896a46713735b1d6384bef5ce7c047d227c6`; proposed App wiring digest is `f94221553f3c8640b5d8c298fe5149435359d243509fa593ada1bbff55a0eba4`. Proposed direct helper caller lines are 6005/6104/6166; hook call/destructure lines are 477/562. All 83 retained names have source-reader evidence in the ignored scratch ledger; no callback dependency or invocation phase is changed.

Scratch tooling observes 43 modules/17 sites, zero enforced or owner-budget problems, and 34 unchanged informational findings. Full scratch frontend lint observes zero errors/fatal diagnostics and 113 warnings; the two former unread App values are returned from the state owner and omitted from App's destructure. This is a proposed warning checkpoint, not a behavioral test or a new warning exemption. Existing R1 verification still uses its actual 115 ceiling. Scratch conservation includes the new state hook and unchanged existing recovery owner; every state initializer cancels, with the remaining call/destructure/return/memo/group seams requiring explicit R4a conservation review. The pure group helper's statements also require manual source/oracle review.

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

**SC2 current-base preflight (2026-10-04, validated by the operator before R4).** SC1 merged in #228 at `bc17d28c9e1dae9a2331b4aeadb746142b0eab89`; a fresh successful fetch records that exact main SHA, and the plan branch starts there with no additional commits. No open PR exists at this check. Its production tree equals the validated SC1 head. Only this plan, index and gate records are edited; the proposed production move remains an ignored scratch copy. This is a proposed checkpoint, not completed R4 implementation or permission to publish.

Current source ranges, located by symbols, are `let scheduleScenarioEdgeUpdate` at 1118; `matchesScenarioSearch` through `registerScenarioIssueRef` at 5692–5716; `fetchScenarioCsrfToken` through `handleScenarioBarMouseDown` at 7227–7759; `scenarioTeamIds` at 8076–8081; and `scenarioRawIssues` through the last `[scenarioEpicFocus]` effect at 9106–11546. These transfer 3,006 physical lines. The unconditional call occupies the old planner anchor (scratch App 8503), after all 30 App input declarations; no source range is inferred from historical line numbers.

| Checkpoint measure | Current base | Proposed SC2 ceiling |
| --- | ---: | ---: |
| Dashboard | 18,307 | 15,368 |
| New `useScenarioPlanner.js` | absent | 3,201 |
| Unique Scenario owners | 780 | 3,981 |
| Unique Settings/EPM owners | 9,803 | 9,803 |
| Unique owners | 10,583 | 13,784 |
| App plus unique owners | 28,890 | 29,152 |
| Registered owner modules | 43 | 44 |
| Lint warnings | 113 | 113 |

The +262 combined allowance is **only net scaffolding**, with zero growth credit for transferred code: the hook adds 195 lines (12 imports, five blank/run separators, 36 parameter-signature lines, 72 state-destructure lines, 69 return-wrapper lines and one function closing); App adds net 67 (105 call/destructure lines, one import, four retained vacated-run anchor lines, minus 27 orphaned state bindings and 16 net import-pruning lines). Twenty-four import names are removed only where the moved code was their sole consumer. All 43 existing per-file and interface ceilings carry forward unchanged. Existing callers/readers ledgers are refreshed for the new planner responsibility; no prior owner body changes. The 15,368 figure supersedes historical forecasts for this base, rather than raising a frozen cap.

The new hook has one outer object parameter, 34 accepted/required input keys (the state bag, three identity-sensitive constants and 30 App values), 70 consumed state members, 67 flat returns, zero component props and zero getters. The scanner finds 116 expanded paths; lexical input/member tracing, including local aliases and local-call forwarding, yields their complete 267-path union, frozen as the expanded-input ceiling. Four forwarded inputs require reviewed inventory: `BACKEND_URL` and `selectedSprint` are existing scalars; `selectedTeamSet` and `excludedEpicSet` are existing Set collections passed to existing helpers, not dependency bags. The alias resolver converges in three iterations and includes map set/delete, drag-state, focus-restore, DOM-ref method and config/summary fallback aliases. The expanded-member-list SHA-256 is `012c10e6c45aaa399ce234068ae41dd8e9709fc7cdd1ed1b2b7019c55ec49d98`. Ref/record paths below remain explicit; computed collection selectors do not claim runtime issue-record keys.

Ordered input keys:
```text
  scenarioState, BACKEND_URL, EMPTY_ARRAY, EMPTY_OBJECT, perfEnabled, perfCountersRef
  pendingConnectionRecoveryRef, releaseConnectionRecoveryOwnership, connectionRecoveryScenarioStartedRef, setConnectionRecoveryNotice, setConnectionRecoveryStatus, connectionRecoveryStagedRevision
  selectedSprint, availableSprints, sprintsLoading, groupsLoading, activeGroupId, jiraUrl
  showScenario, searchQuery, pendingShellAuthResumeRef, selectedSprintInfo, trackScenarioAction, visibleControlGroups
  selectedSprintState, isCompletedSprintSelected, normalizeEpicKey, registerSprintFetch, cleanupSprintFetch, activeGroup
  teamOptions, selectedTeamSet, isAllTeamsSelected, excludedEpicSet
```

Consumed `scenarioState` members:
```text
  scenarioCurrentUserIdentity, setScenarioCurrentUserIdentity, setScenarioLoading, setScenarioError, scenarioData, setScenarioData
  scenarioLaneMode, setScenarioLaneMode, scenarioShowConflictsOnly, scenarioTimelineRef, scenarioLayout, setScenarioLayout
  scenarioCollapsedLanes, setScenarioCollapsedLanes, scenarioHoverKey, setScenarioFlashKey, scenarioScrollTop, setScenarioScrollTop
  setScenarioScrollLeft, scenarioViewportHeight, setScenarioViewportHeight, scenarioEpicFocus, setScenarioEpicFocus, scenarioRangeOverride
  setScenarioRangeOverride, scenarioFocusRestoreRef, scenarioSkipAutoCollapseRef, scenarioTeamCollapseInitRef, scenarioHistoryButtonRef, scenarioHistoryPanelRef
  scenarioHistoryTitleRef, scenarioOverrides, setScenarioOverrides, scenarioActiveDraftIdRef, scenarioScopeKeyRef, scenarioDraftMeta
  setScenarioDraftMeta, setScenarioDraftEvents, scenarioDraftPresence, setScenarioDraftPresence, scenarioDraftLocks, setScenarioDraftLocks
  scenarioDraftRealtimeStatus, setScenarioDraftRealtimeStatus, scenarioDraftLastEventNumber, setScenarioDraftLastEventNumber, scenarioEditMode, setScenarioEditMode
  scenarioUndoStackRef, setScenarioUndoVersion, scenarioDragState, setScenarioDragState, scenarioDragStateRef, scenarioDragFrameRef
  scenarioDragLockRefreshRef, scenarioRealtimeCsrfRef, scenarioHistoryRefreshControllerRef, scenarioHistoryActionControllerRef, scenarioViewRangeRef, scenarioWasDraggedRef
  scenarioEdgeUpdatePendingRef, scenarioEdgeFrameRef, scenarioScrollFrameRef, scenarioResizeFrameRef, scenarioPendingScrollRef, setScenarioTooltip
  scenarioTooltipRef, scenarioTooltipAnchorRef, scenarioIssueRefMap, setScenarioEdgeRender
```

Ordered flat returns (all retained in App, including Jira export-key memos):
```text
  registerScenarioIssueRef, runScenario, toggleScenarioEditMode, handleScenarioBarMouseDown, scenarioBaseUrl, scenarioHasUnsavedChanges
  scenarioCanSaveDraft, scenarioRemoteEditors, scenarioIssueLockWarnings, scenarioSearchQuery, scenarioSearchMatchSet, scenarioIssueByKey
  scenarioViewStart, scenarioViewEnd, scenarioFocusIssueKeys, scenarioFocusContextKeys, scenarioAssigneeConflicts, scenarioDepViolations
  scenarioDepViolatedKeys, scenarioUndo, scenarioRedo, scenarioOverrideCount, saveScenarioDraft, discardScenarioOverrides
  openScenarioDraftHistory, closeScenarioDraftHistory, requestReloadActiveDraft, cancelReloadActiveDraft, runReloadActiveDraft, requestScenarioHistoryAction
  cancelScenarioHistoryAction, requestScenarioReloadFromJira, cancelScenarioReloadFromJira, runScenarioReloadFromJira, previewScenarioDraftWriteback, checkScenarioDraftWritebackGate
  runScenarioHistoryAction, scenarioLaneInfo, scenarioLateItems, scenarioDeadlineAtRisk, scenarioCriticalPathItems, scenarioUnschedulableItems
  scenarioIssuesByLane, scenarioTicks, scenarioQuarterMarkers, SCENARIO_LANE_HEIGHT, scenarioBarGap, scenarioJiraEpicKeys
  scenarioJiraStoryKeys, scenarioLaneMeta, scenarioLaneAssigneeGroups, scenarioPositions, scenarioEpicBars, scenarioEpicEdges
  scenarioTodayLeft, scenarioVisibleLanes, scenarioUpstreamSet, scenarioDownstreamSet, scenarioBlockedSet, toggleScenarioLane
  showScenarioTooltip, showScenarioTooltipFromElement, moveScenarioTooltip, hideScenarioTooltip, clearScenarioEpicFocus, focusScenarioEpic
  scrollToScenarioIssue
```

Complete expanded-input inventory:
```text
  BACKEND_URL, EMPTY_ARRAY, EMPTY_ARRAY.filter, EMPTY_ARRAY.forEach, EMPTY_ARRAY.length, EMPTY_ARRAY.map
  EMPTY_OBJECT, EMPTY_OBJECT.[computed], EMPTY_OBJECT.[computed].devLead, EMPTY_OBJECT.[computed].size, EMPTY_OBJECT.critical_path, EMPTY_OBJECT.critical_path.filter
  EMPTY_OBJECT.late_items, EMPTY_OBJECT.late_items.filter, EMPTY_OBJECT.quarter_end_date, EMPTY_OBJECT.start_date, EMPTY_OBJECT.unschedulable, EMPTY_OBJECT.unschedulable.filter
  activeGroup, activeGroup.name, activeGroupId, availableSprints, cleanupSprintFetch, connectionRecoveryScenarioStartedRef
  connectionRecoveryStagedRevision, excludedEpicSet, excludedEpicSet.has, groupsLoading, isAllTeamsSelected, isCompletedSprintSelected
  jiraUrl, normalizeEpicKey, pendingConnectionRecoveryRef, pendingConnectionRecoveryRef.current, pendingShellAuthResumeRef, perfCountersRef
  perfCountersRef.current, perfCountersRef.current.edgeComputes, perfCountersRef.current.edgeFrames, perfCountersRef.current.edgeRequests, perfCountersRef.current.laneStacking, perfCountersRef.current.layoutReads
  perfCountersRef.current.scrollReads, perfEnabled, registerSprintFetch, releaseConnectionRecoveryOwnership, scenarioState, scenarioState.scenarioActiveDraftIdRef
  scenarioState.scenarioActiveDraftIdRef.current, scenarioState.scenarioCollapsedLanes, scenarioState.scenarioCollapsedLanes.[computed], scenarioState.scenarioCurrentUserIdentity, scenarioState.scenarioCurrentUserIdentity.displayName, scenarioState.scenarioCurrentUserIdentity.userId
  scenarioState.scenarioData, scenarioState.scenarioData.capacity_by_team, scenarioState.scenarioData.capacity_by_team.[computed], scenarioState.scenarioData.capacity_by_team.[computed].devLead, scenarioState.scenarioData.capacity_by_team.[computed].size, scenarioState.scenarioData.config
  scenarioState.scenarioData.config.quarter_end_date, scenarioState.scenarioData.config.start_date, scenarioState.scenarioData.dependencies, scenarioState.scenarioData.dependencies.filter, scenarioState.scenarioData.dependencies.forEach, scenarioState.scenarioData.focus_set
  scenarioState.scenarioData.focus_set.context_issue_keys, scenarioState.scenarioData.focus_set.focused_issue_keys, scenarioState.scenarioData.issues, scenarioState.scenarioData.issues.length, scenarioState.scenarioData.issues.map, scenarioState.scenarioData.jira_base_url
  scenarioState.scenarioData.sprintBoundaries, scenarioState.scenarioData.sprintBoundaries.next, scenarioState.scenarioData.sprintBoundaries.next.endDate, scenarioState.scenarioData.sprintBoundaries.previous, scenarioState.scenarioData.sprintBoundaries.previous.startDate, scenarioState.scenarioData.sprintBoundaries.selected
  scenarioState.scenarioData.sprintBoundaries.selected.endDate, scenarioState.scenarioData.sprintBoundaries.selected.startDate, scenarioState.scenarioData.summary, scenarioState.scenarioData.summary.critical_path, scenarioState.scenarioData.summary.critical_path.filter, scenarioState.scenarioData.summary.late_items
  scenarioState.scenarioData.summary.late_items.filter, scenarioState.scenarioData.summary.unschedulable, scenarioState.scenarioData.summary.unschedulable.filter, scenarioState.scenarioDraftLastEventNumber, scenarioState.scenarioDraftLocks, scenarioState.scenarioDraftLocks.filter
  scenarioState.scenarioDraftMeta, scenarioState.scenarioDraftMeta.activeDraft, scenarioState.scenarioDraftMeta.activeDraft.draftId, scenarioState.scenarioDraftMeta.baseDraftRevision, scenarioState.scenarioDraftMeta.conflict, scenarioState.scenarioDraftMeta.conflict.activeDraft
  scenarioState.scenarioDraftMeta.conflict.activeDraft.draftId, scenarioState.scenarioDraftMeta.dirtyState, scenarioState.scenarioDraftMeta.historyOpen, scenarioState.scenarioDraftMeta.loadingHistory, scenarioState.scenarioDraftMeta.savedOverrides, scenarioState.scenarioDraftMeta.saving
  scenarioState.scenarioDraftMeta.scopeKey, scenarioState.scenarioDraftMeta.scopePayload, scenarioState.scenarioDraftMeta.staleDraft, scenarioState.scenarioDraftMeta.staleDraft.activeDraft, scenarioState.scenarioDraftMeta.staleDraft.activeDraft.draftId, scenarioState.scenarioDraftPresence
  scenarioState.scenarioDraftPresence.filter, scenarioState.scenarioDraftRealtimeStatus, scenarioState.scenarioDraftRealtimeStatus.paused, scenarioState.scenarioDragFrameRef, scenarioState.scenarioDragFrameRef.current, scenarioState.scenarioDragLockRefreshRef
  scenarioState.scenarioDragLockRefreshRef.current, scenarioState.scenarioDragState, scenarioState.scenarioDragState.issueKey, scenarioState.scenarioDragStateRef, scenarioState.scenarioDragStateRef.current, scenarioState.scenarioDragStateRef.current.currentEnd
  scenarioState.scenarioDragStateRef.current.currentStart, scenarioState.scenarioDragStateRef.current.durationMs, scenarioState.scenarioDragStateRef.current.issueKey, scenarioState.scenarioDragStateRef.current.offsetX, scenarioState.scenarioDragStateRef.current.originalEnd, scenarioState.scenarioDragStateRef.current.originalStart
  scenarioState.scenarioDragStateRef.current.trackLeft, scenarioState.scenarioDragStateRef.current.trackWidth, scenarioState.scenarioEdgeFrameRef, scenarioState.scenarioEdgeFrameRef.current, scenarioState.scenarioEdgeUpdatePendingRef, scenarioState.scenarioEdgeUpdatePendingRef.current
  scenarioState.scenarioEditMode, scenarioState.scenarioEpicFocus, scenarioState.scenarioEpicFocus.key, scenarioState.scenarioEpicFocus.summary, scenarioState.scenarioFocusRestoreRef, scenarioState.scenarioFocusRestoreRef.current
  scenarioState.scenarioFocusRestoreRef.current.collapsedLanes, scenarioState.scenarioFocusRestoreRef.current.laneMode, scenarioState.scenarioFocusRestoreRef.current.rangeOverride, scenarioState.scenarioFocusRestoreRef.current.scrollTop, scenarioState.scenarioHistoryActionControllerRef, scenarioState.scenarioHistoryActionControllerRef.current
  scenarioState.scenarioHistoryActionControllerRef.current.abort, scenarioState.scenarioHistoryButtonRef, scenarioState.scenarioHistoryButtonRef.current, scenarioState.scenarioHistoryButtonRef.current.focus, scenarioState.scenarioHistoryPanelRef, scenarioState.scenarioHistoryPanelRef.current
  scenarioState.scenarioHistoryPanelRef.current.contains, scenarioState.scenarioHistoryRefreshControllerRef, scenarioState.scenarioHistoryRefreshControllerRef.current, scenarioState.scenarioHistoryRefreshControllerRef.current.abort, scenarioState.scenarioHistoryTitleRef, scenarioState.scenarioHistoryTitleRef.current
  scenarioState.scenarioHistoryTitleRef.current.focus, scenarioState.scenarioHoverKey, scenarioState.scenarioIssueRefMap, scenarioState.scenarioIssueRefMap.current, scenarioState.scenarioIssueRefMap.current.delete, scenarioState.scenarioIssueRefMap.current.forEach
  scenarioState.scenarioIssueRefMap.current.set, scenarioState.scenarioLaneMode, scenarioState.scenarioLayout, scenarioState.scenarioLayout.height, scenarioState.scenarioLayout.labelWidth, scenarioState.scenarioLayout.width
  scenarioState.scenarioOverrides, scenarioState.scenarioOverrides.[computed], scenarioState.scenarioPendingScrollRef, scenarioState.scenarioPendingScrollRef.current, scenarioState.scenarioRangeOverride, scenarioState.scenarioRangeOverride.end
  scenarioState.scenarioRangeOverride.end.getTime, scenarioState.scenarioRangeOverride.start, scenarioState.scenarioRangeOverride.start.getTime, scenarioState.scenarioRealtimeCsrfRef, scenarioState.scenarioRealtimeCsrfRef.current, scenarioState.scenarioResizeFrameRef
  scenarioState.scenarioResizeFrameRef.current, scenarioState.scenarioScopeKeyRef, scenarioState.scenarioScopeKeyRef.current, scenarioState.scenarioScrollFrameRef, scenarioState.scenarioScrollFrameRef.current, scenarioState.scenarioScrollTop
  scenarioState.scenarioShowConflictsOnly, scenarioState.scenarioSkipAutoCollapseRef, scenarioState.scenarioSkipAutoCollapseRef.current, scenarioState.scenarioTeamCollapseInitRef, scenarioState.scenarioTeamCollapseInitRef.current, scenarioState.scenarioTimelineRef
  scenarioState.scenarioTimelineRef.current, scenarioState.scenarioTimelineRef.current.addEventListener, scenarioState.scenarioTimelineRef.current.clientHeight, scenarioState.scenarioTimelineRef.current.clientWidth, scenarioState.scenarioTimelineRef.current.getBoundingClientRect, scenarioState.scenarioTimelineRef.current.querySelector
  scenarioState.scenarioTimelineRef.current.removeEventListener, scenarioState.scenarioTimelineRef.current.scrollHeight, scenarioState.scenarioTimelineRef.current.scrollLeft, scenarioState.scenarioTimelineRef.current.scrollTo, scenarioState.scenarioTimelineRef.current.scrollTop, scenarioState.scenarioTimelineRef.current.scrollWidth
  scenarioState.scenarioTooltipAnchorRef, scenarioState.scenarioTooltipAnchorRef.current, scenarioState.scenarioTooltipAnchorRef.current.bottom, scenarioState.scenarioTooltipAnchorRef.current.getBoundingClientRect, scenarioState.scenarioTooltipAnchorRef.current.left, scenarioState.scenarioTooltipAnchorRef.current.right
  scenarioState.scenarioTooltipAnchorRef.current.top, scenarioState.scenarioTooltipRef, scenarioState.scenarioTooltipRef.current, scenarioState.scenarioTooltipRef.current.getBoundingClientRect, scenarioState.scenarioUndoStackRef, scenarioState.scenarioUndoStackRef.current
  scenarioState.scenarioUndoStackRef.current.clear, scenarioState.scenarioUndoStackRef.current.push, scenarioState.scenarioUndoStackRef.current.redo, scenarioState.scenarioUndoStackRef.current.undo, scenarioState.scenarioViewRangeRef, scenarioState.scenarioViewRangeRef.current
  scenarioState.scenarioViewRangeRef.current.end, scenarioState.scenarioViewRangeRef.current.start, scenarioState.scenarioViewportHeight, scenarioState.scenarioWasDraggedRef, scenarioState.scenarioWasDraggedRef.current, scenarioState.setScenarioCollapsedLanes
  scenarioState.setScenarioCurrentUserIdentity, scenarioState.setScenarioData, scenarioState.setScenarioDraftEvents, scenarioState.setScenarioDraftLastEventNumber, scenarioState.setScenarioDraftLocks, scenarioState.setScenarioDraftMeta
  scenarioState.setScenarioDraftPresence, scenarioState.setScenarioDraftRealtimeStatus, scenarioState.setScenarioDragState, scenarioState.setScenarioEdgeRender, scenarioState.setScenarioEditMode, scenarioState.setScenarioEpicFocus
  scenarioState.setScenarioError, scenarioState.setScenarioFlashKey, scenarioState.setScenarioLaneMode, scenarioState.setScenarioLayout, scenarioState.setScenarioLoading, scenarioState.setScenarioOverrides
  scenarioState.setScenarioRangeOverride, scenarioState.setScenarioScrollLeft, scenarioState.setScenarioScrollTop, scenarioState.setScenarioTooltip, scenarioState.setScenarioUndoVersion, scenarioState.setScenarioViewportHeight
  searchQuery, searchQuery.trim, selectedSprint, selectedSprintInfo, selectedSprintInfo.name, selectedSprintState
  selectedTeamSet, setConnectionRecoveryNotice, setConnectionRecoveryStatus, showScenario, sprintsLoading, teamOptions
  teamOptions.filter, trackScenarioAction, visibleControlGroups
```

Source SHA-256 anchors: base App `f94221553f3c8640b5d8c298fe5149435359d243509fa593ada1bbff55a0eba4`; proposed App `8d37e41d33eb9fe1a00e35323a8d1bfc23d5c2d5f0b91db998857190ffa18502`; proposed planner `9beb215d2f058e07add7576783ce61584032505c385a64d2727ad67f0aa3c323`. The first scratch omitted the two Jira export-key App bindings; caller review identified four undefined-name uses, and the final proposal retains both. That failed draft is not a baseline or an exemption.

**Phase and conservation review.** Every App input is initialized before the call (latest base declaration: `excludedEpicSet` at 8110, before original anchor 9106). The sole earlier App output read is `runScenario` in the effect callback at base 7839 / scratch 7241, absent from its dependency array. The structured strict scan covers App and the complete new planner, with zero fatal diagnostics and six returned-name hits, each explicitly reviewed: App `runScenario` is deferred to that effect; hook `scenarioHasUnsavedChanges` at 427 is read inside invoked `runScenario`; at 571 inside the setter updater reached by the Edit handler; `runReloadActiveDraft` at 1471, `runScenarioHistoryAction` at 1579 and `runScenarioReloadFromJira` at 1598 are called only by invoked request handlers. Their baseline bodies and invocation phases are preserved. No getter or latest-value ref is introduced. `scheduleScenarioEdgeUpdate` remains declared before the dependency-array read and assigned later; its dependency remains the existing undefined value. Recovery remains after the auth-resume effect, and six keydown listener contracts remain unchanged.

Complete comparison includes App, the new planner, `useScenarioState`, `useConnectionScenarioRecovery`, `useAdminSettingsGate`, `useAdminAccessSettings`, `useGroupVisibilityPreferences`, `useJiraFieldPickers`, `useTeamCatalogLifecycle`, `useSettingsConfigBaselineRevision` and `useEpmViewData` at both revisions. It reports 1,700 → 1,704 statements, one removed/five added residuals, and identical order across all 155 effects. All six residuals are reviewed wiring: replace the 83-name App state destructure with its retained 56; add the 34-input planner call, 67-name App result destructure, 70-name hook state destructure and 67-name hook return. R4 must repeat this check against its actual revisions and include every full residual in the commit message.

**Actual preflight checks.** Pinned Node 20.20.0; complete pinned extraction dependencies verified. Base gate: zero errors/113 warnings, 43 modules/17 sites, zero enforced/owner problems and 34 informational findings. All 70 tooling controls pass. Fresh full Node suite: 1,739 passed, zero failures/skips. Fresh eight-spec Chromium characterization: 214 passed, one intentional runtime opt-in skip; all 34 required DOM labels are present and nonempty in a fresh before directory. Scratch lint: zero errors/fatal diagnostics and 113 warnings across 218 frontend files; scratch bundle builds; nested interfaces: 44 modules/18 sites, zero enforced problems and the same 34 informational findings. Full conservation and phase review are preflight evidence, not extraction parity. The pure 11-key idle-action legacy oracle is generated from base source; `buildScenarioDraftScope` reads four App closure values and is excluded from standalone pure-helper extraction under the existing body.

Before R4, validate this checkpoint and its interfaces. R4 still requires the exact ordered planner SSR interface probe, helper oracles, justified guard re-pointing, the frozen canonical manifest, fresh after DOM and settled visual comparisons, normal-timer runtime comparisons, full SM-S plus Escape/undo/recovery and the required Node/Python/build checks. R5 and publication remain separately gated. This internal ownership move adds no analytics event and preserves requests, permissions, save order, authentication lock, draft/conflict recovery and layout. The Home-write gate remains independently blocked (0/4 inputs, no approved disposable target) and is not a prerequisite for this slice.

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
| PR-1 | Land revision 3 of the plan | Merged 2026-10-01 | n/a | 18,213 (historical) | #219, `c9ca8eff` | Revision-4/5 amendments landed through PR0 #227 |
| PR0 | Tooling, coverage, baselines | Merged 2026-10-03 | 18,434 (unchanged) | 18,434 | #227, `6086bf8c` | Six validated rungs; all four remote CI checks passed |
| SC1 | Scenario state container and seam | Merged 2026-10-03 | 18,307 | 18,307; lint 113 | #228, `bc17d28c` | Frozen 210-line container/95-line helper; complete measured caps, remaining-App inventory and four-probe audit |
| SC2 | Single Scenario hook | Merged 2026-10-04 | 15,368 | 15,368; lint 113 | #229, `f2e2b510` | Frozen 3,201-line planner, 267 expanded inputs, 67 flat returns; all four CI checks passed |
| SC3 | Split the Scenario hook (G1) | Merged 2026-10-05 | 15,368 (unchanged) | 15,368 (no dashboard budget change); lint 113 | #231, `1df92ad1` | Planner 3,201 → 320 lines; six sub-hooks and a 768-line pure `scenarioLayout.js`; all owner/interface/aggregate ceilings equal measured (combined 29,797) |
| SC4 | Scenario view component | Merged 2026-10-05 | 14,412 | 14,412 (ratcheted); lint 113 | #232, `7a768d5d` | 988-line `ScenarioView`, five props; all owner/interface/aggregate ceilings equal measured (combined 29,829) |
| ST1 | Shared-config section hooks | In progress: R1 (`ba7bd7ac`) and R2 (`495722d0`) validated 2026-10-05; R3 local, awaiting validation | 14,394 after R3 | 14,412 (R5 ratchets); lint 110 | Local commits only | R1 removes 17 inert lines; R2 adds characterization tests only; R3 hoists two declarations |
| ST2 | EPM settings | Not started | | | | |
| ST3 | Team Groups and Labels | Not started | | | | |
| ST4 | First-run configuration | Not started | | | | |
| Permission fix | Explicit Settings editing grant (G2 prerequisite) | Approved; not started | | | | Separate fix after ST4; verify merge before ST5 |
| ST5 | Shared-config save, permissions, shell (G2) | Conditional approval; not started | | | | Permission fix + R0 validation required |

**SC2 R4 implementation record.** The exact base remains `bc17d28c9e1dae9a2331b4aeadb746142b0eab89`. The approved hook proposal is installed unchanged (SHA-256 `9beb215d2f058e07add7576783ce61584032505c385a64d2727ad67f0aa3c323`); App SHA-256 is `3058a47275405c46eeaf649d14b6cb210ecbdc133f400a1ff91dea9a747f004d` after removing spaces from four otherwise blank lines found by `git diff --check`, without changing code or line counts. App is 15,368 lines, the planner 3,201, and the frozen unique-owner combined total 29,152. The 34 inputs, 70 consumed state members, 67 flat returned keys, and 267 expanded dependency paths match the validated checkpoint; all 43 prior owner interfaces/caps remain unchanged. The existing structural ceiling is retained until R5.

Five new tests establish the exact flat SSR interface and pure-helper parity against 35 base-source oracle fixtures (14 search, nine collapsed-lane, 12 edge-render). The initial SSR/interface and idle-action tests observed missing-module RED before implementation; three additional pure-helper oracle tests were added after review and verified against the unchanged exact-base bodies. Moved source guards retain their assertions and read the new owner. No Settings permission/save, analytics, request, draft, conflict-recovery, or auth-lock contract is changed. A tooling false positive rejected the permitted `dashboardAnalytics.js` import by substring: the re-export check now resolves only named/star re-export targets to the actual dashboard entry; the existing direct-import prohibition is retained. The original checker reproduces RED, while new clean-analytics and both forbidden-re-export controls pass with the correction. Conservation's six residuals are exclusively the replaced state destructure and the added hook call, flat return destructure, hook state destructure, and hook return; the full residual text belongs in the R4 commit message.

**SC2 R4 verification outcome (2026-10-04).** Source extraction was committed locally as `42b2a14f62071c56e71378e855f6c3ec72cceb95` and validated by the operator on 2026-10-04. Full Node: 1,744 passed, zero failures/skips. Full Python serial rerun: 2,113 tests, 29 skips, zero failures; the initial concurrent run had one unchanged PostgreSQL-runner subprocess timeout, whose isolated rerun passed before the full serial rerun. Scoped Chromium: 492 passed, one runtime opt-in skip, zero failures. All 34 fresh DOM captures match the base byte-for-byte. Canonical extraction lint reports zero errors and 113 warnings; all 73 tooling controls pass. Conservation compares App and the complete affected hook set: all 155 effects retain identical order; one removed and five added statements are reviewed interface wiring. The generated build and diff whitespace check pass.

Two screenshot campaigns each matched seven of eight states byte/pixel exactly. The first differed in collapsed lanes (357 pixels); identical ignored-helper geometry settling on both revisions made that state exact in the second campaign, which instead differed in conflicts-only (268 pixels, unchanged dimensions, concentrated on an edge curve and bottom button). Both sets and their differences are preserved under ignored `tmp/sc2-r4-verification/`. This evidence does not establish eight-state pixel parity or prove the remaining differences benign. Execution stopped after two attempts under root AGENTS.md section 6. The operator inspected the original/extracted screenshots and residual locations, then accepted them with “proceed. all good” on 2026-10-04. This accepts these preserved visual residuals for R4; it does not establish eight-state pixel identity. No third capture, production layout change, or assertion relaxation was made. Both baseline runtime probes and both exact-R4 candidate probes passed, as recorded below. The committed-revision rebuild and `make verify-dist-clean` passed with a clean worktree. R4 has operator validation; R5 validation, publication, SC3, and SC4 remain gated.


**SC2 R4 completed runtime evidence.** Four normal-timer runs compare exact base `bc17d28c` (33.5/33.7 s) and exact R4 `42b2a14f` (34.5/33.4 s). Each contains all 11 raw labels, matching summaries and monotonic counters. Provenance is pinned Node/browser/viewport/fixture/CSS; normalized source-input inventories contain 224 baseline and 225 candidate entries, with only App changed and the planner added. Every phase has identical method/path request multisets: 23 startup and 34 final requests, including one Scenario POST, six event polls and two presence writes. The first ten phase sequences match; candidate sample 2's final presence POST (27,202 ms) precedes the event GET (27,205 ms), whereas the other samples reverse their near-simultaneous order. The original five-second event and 25-second presence timers are unchanged; no extra requests occur.

Eight action-phase deltas match exactly across all four samples. Epic focus in both candidate samples matches baseline sample 1; baseline sample 2 has two additional renders, five edge requests, one edge frame/compute/layout/scroll pass and two stacking builds. Startup App renders are 19/18 before and 21/19 after, with zero Scenario compute/layout counters in all samples. Idle renders are 2/4 before and 2/3 after; final renders are 80/83 before and 82/81 after. Response/frame batching is a plausible timing inference, not proven causality; complete counter parity is not claimed. Independent review verified raw data, revision input digests and the conserved effect/state/request paths and found no runtime blocker. End-to-end sampled time is 31,836/32,135 ms before and 31,452/31,767 ms after; candidate phase time above baseline maxima is limited to collapsed lanes +25 ms, tooltip +5 ms and idle +1 ms. These uncontrolled timings establish no performance improvement. Raw commands/results and comparisons are retained in ignored `tmp/sc2-r4-verification/verification-report.json` and `runtime-comparison.json`.

**Remaining-App responsibility inventory after SC2** (verified against exact R4 `42b2a14f`; physical seam costs describe retained wiring, not complete responsibility size or future estimates):

| Canonical responsibility | Retained symbols and consumers | Why it remains / owner relationship | Current seam cost |
| --- | --- | --- | ---: |
| Scenario state composition | `scenarioState`, its 56-name App destructure and `scenarioGroupValues` feed group cache, connection snapshot and JSX | App calls effect-free `useScenarioState`; the planner separately consumes 70 container members. Shared feature composition remains in App | 59 lines (462–520); one state-module import line |
| Cross-feature per-group persistence | `buildDefaultGroupState`, group snapshot, `applyGroupState`, group-cache effects | Scenario defaults/setters/transient resets delegate to `scenarioGroupState.js`; the cache also owns ENG/Planning/Statistics state | Five existing one-line seams; no SC2 addition |
| Scenario planner composition and exports | `scenario = useScenarioPlanner(...)`, its 67-name result destructure, early deferred `runScenario` reader, `scenarioJiraEpicKeys`/`scenarioJiraStoryKeys` export readers | The hook owns compute, draft/history/realtime, drag/undo and layout. App retains explicit inputs, result consumers and cross-feature Jira export selection | 105 lines (8503–8607); one planner import line |
| Scenario scope/reset and recovery shell | `clearEngGroupScopeData`, `applyGroupState`, view-mode effects, `connectionRecoverySnapshotRef.current` | Shared scope/reset lifetime and capsule capture span features; Scenario recovery waiting and fresh compute are inside the planner at their preserved effect position | Zero new seam lines; reset delegation counted above |
| Scenario presentation | `.scenario-fullbleed` JSX consumes `scenario`, state-container values and shared controls | SC4 moves the UI after the internal SC3 split; the flat interface remains unchanged | Zero SC2 JSX seam additions |
| Settings bootstrap, draft/save authority and modal composition | `openGroupManage`, `loadConfig`, `loadGroupsConfig`, `saveGroupsConfig`, `saveEpmConfig`, `saveAllSettingsOnce`, `saveAllSettings`, `SettingsModal` | ST1–ST5 own later moves; existing field/catalog/private-preference/Admin Access hooks remain independent; G2 preserves save sequence and requires its separate correction | Zero SC2 seam additions |
| Shared scope, auth and ENG/Planning/Statistics/EPM shell | `savedPrefsRef`, `planningScopeKey`, `acceptedBoardConfigRef`, `engWorkspaceConfigured`, auth/recovery wiring, ENG/Planning/Statistics JSX and `useEpmViewData` | Cross-feature scope/auth lifetime remain App-owned and already-extracted owners consume explicit inputs | Zero SC2 seam additions |

SC2 transfers 3,006 source lines without combined transfer credit. Its owner scaffold is 195 lines; App net scaffold is 67 (105 call/result wiring + one import + four vacated-run blank anchors −27 pruned state bindings −16 net import lines). Thus App shrinks 2,939 lines (18,307→15,368), while the combined checkpoint increases by exactly 262 (28,890→29,152). Existing owner caps/interfaces are unchanged; planner 3,201, Scenario aggregate 3,981, Settings 9,803, unique owners 13,784, combined 29,152. Import direction remains App→owners; no owner imports the dashboard entry. R5 ratchets the structural dashboard ceiling to 15,368 and retains the measured 113 lint ceiling; the R4 manifest already freezes those exact owner/interface/aggregate caps. No generated/source file changes are required in this metadata rung. Operator validation is review of the R5 diff only; publication requires a separate go and the full exact-head transaction checks.


**SC2 R5 verification (2026-10-04).** `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passes both tests (0.076 s); `fnm exec --using 20 npm run test:frontend:unit` passes 1,744 tests with zero failures/skips (3.844 s). `fnm exec --using 20 bash scripts/extraction_lint/run.sh` passes with zero errors, 113 warnings, 44 registered owner modules, 18 destructure sites, zero owner/enforced problems and 34 unchanged informational findings. `fnm exec --using 20 bash scripts/extraction_lint/negative_controls.sh` passes all 73 controls (seven shell and 66 JavaScript). The independent manifest audit confirms every frozen file/interface cap equals its measured checkpoint, without padding; source, dist, manifest and lint-tool bytes are unchanged from R4. Shell syntax for the unchanged gate passes. The pinned source build passes with unchanged generated output; exact committed-revision rebuild/`make verify-dist-clean` follow this local metadata commit before its report. Operator validation is **review the four-path R5 diff only; no additional app smoke**. Stop after the local commit and committed-build verification. Full exact-head Node/Python/Chromium suites, refreshed main/history/scope and the remaining publication checks require the separate R6 publication go; R5 does not authorize push, PR creation or SC3.


**SC3 R2 record (2026-10-04, local, unpublished).**

*Base and drift.* Fetched `origin/main` and `HEAD` are both exactly `f2e2b51049e1e7b3cce7c8323aa8d14ecff87934` (SC2 merged in #229). Branch `improvement/scenario-planner-split` has no commits beyond it and a clean worktree. `GATE-05` was already checked 2026-10-04 and remains Blocked (next review 2026-10-05); it is not a dependency. Refreshed measurements equal the SC2 checkpoint: `dashboard.jsx` 15,368 lines, planner 3,201 lines, unique owners 13,784, combined 29,152. The baseline gate passes with zero errors, 113 warnings, 44 registered modules, 18 destructure sites, 34 informational findings and zero budget problems.

*G1 partition verification (read-only, by symbol).* Every `89ffe589` range maps onto current planner lines by a constant offset (H6 shifts from 8446 to 8462 after the SC1 dead-code deletions). The hook body has 164 top-level statements (H1 28, H2 21, H3 34, H4 8, H5 17, H6 56) and 19 effects (18 statements plus the one inside `useConnectionScenarioRecovery`): H1 2, H2 4, H4 2, H5 2, H6 9, H3 none. Calling H1..H6 in order reproduces today's effect order. The only cross-sub-hook edges are H2→H1, H4→H1/H2/H3, H5→H1 and H6→H3; there is no cycle and no consumer before its producer. Render-phase reads across sub-hooks are exactly the H1→H2 dependency arrays (`scenarioActiveDraftId`, `scenarioActiveDraftReady`, `scenarioScopeKey`), H3→H4 (`scenarioIssueByKey` in the undo effect deps) and H3→H6 (19 bindings in memo factories and deps); every other cross-hook read is deferred to an effect or handler. No material contradiction with the approved design was found. Required placement facts: `let scheduleScenarioEdgeUpdate` moves with its assignment into H6, the assignment staying after the layout effect's deps; the three issue-lock functions belong to H2 and undo/redo, its keydown effect and `scenarioOverrideCount` to H4 (moving undo to H5 would add an undeclared H5→H3 edge); the history-controller abort effect stays in H2 for effect order.

Plan clarifications found (no design change): (1) `tests/test_scenario_planner.js` is a guard for this slice: it extracts `scenarioDraftIdleActionState` (H1), `matchesScenarioSearch` (H3) and the two equality helpers (H6) from the planner text and checks the ordered 67 return keys, so each sub-hook R4 re-points those reads and keeps the planner's return an ordered literal (no spreads). Also re-point `test_scenario_draft_history_source_guards.js`, the Scenario reads in `test_excluded_capacity_stats_source_guards.js` and the `/api/scenario` check in `test_frontend_api_source_guards.js`. (2) `scenarioBaseStart`/`scenarioDeadline` build a new `Date` every render, so eight layout memos and the edge effect recompute each render; preserve that, and every deps array verbatim, including unused (`isAllTeamsSelected`, `scenarioLanes`) and omitted (`scenarioLaneForIssue`, `normalizeEpicKey`) entries. (3) `scenarioTodayLeft` reads `new Date()`: leave it in the hook or inject `today`. (4) Dates parse as local time, so every R4 test that consumes the fixture pins `TZ=UTC`. (5) `buildCapacityPlaceholderRows` is unused in source and not equivalent to the inline clipping; do not substitute it without oracle proof. (6) H6 starts near 1,235 lines; its cap must be frozen at the preceding stop.

*Oracle fixture.* `tests/fixtures/scenario-layout-oracle-example-sanitized.json` (the `*-example-sanitized.json` pattern is the committable fixture name) holds synthetic, sanitized data (DEMO keys, `https://example.test`) with 18 cases and the outputs of 65 H3/H6 derived statements, generated by evaluating the verbatim current statements by symbol under a stubbed React, `TZ=UTC` and a frozen clock (`2026-01-15T12:00:00Z`). Instrumentation (`perfCountersRef`, `performance.mark`, the development `console.debug`) stays in the hook and is stubbed by the harness; two function-valued statements are not serialised. The required categories are single team, several teams, assignee mode, collapsed lanes, overlapping bars and empty input (null data and empty issues), plus Epic lanes, Epic focus, excluded-capacity clipping/stacking with a virtual DevLead, dependencies with hover/edit, search with conflicts-only export, a range override, applied overrides and four boundary cases (unscheduled/touching bars, quarter and year rollover, Epic-summary-only search, viewport buffer edges). The fixture records the base SHA, source SHA-256 (`9beb215d…`), TZ, clock and constants. The generator is ignored scratch (`tmp/sc3-r2/oracle/`) and is not committed; regeneration requires the base source named by the provenance. No test imports it yet: unit tests for each new pure module belong to its R4.

*Independent verification.* A second agent reproduced the fixture byte-for-byte from a different working directory, matched provenance, hand-derived (in a separate re-implementation) the lane order, row indices, conflict pairs, hidden-row counts, heights, Epic bars and dependency sets for six cases with no mismatch, and ran 108 single-token mutations on scratch copies. The first 14-case fixture left 20 mutations with no output change, 13 of them genuine boundary gaps by the verifier's judgement; four cases were added; the final 18-case fixture changes under 91 mutations, 12 more are caught by the generator's own empty-output guards or a crash, and five change nothing, for reasons from the generator author's source analysis (reviewed, not separately re-derived): `info-conflict` (conflicts and the excluded set use the same predicate), `ticks-nextq` and `mark-nextq` (the extra loop steps are dropped by the `ratio >= 0` filters), `eedge-focus` (a focus key leaves at most one lane, so no cross-Epic edge exists) and `stack-capacity-rows3` (the changed operator differs only at size 0, where total and collapsed rows are unchanged). The existing 14 cases were byte-identical after the additions. Output differs under other time zones in dates and pixel values only (238 leaves in Europe/Berlin and America/Los_Angeles; no structural difference), which is why consumers pin UTC.

*H1 `useScenarioDraft` interface (derived mechanically in a scratch tree; proposal, not frozen).* One object parameter with 27 outer keys (`scenarioState` plus 26 planner inputs) and 47 expanded members counted by outer key; the budget manifest instead records nested member paths, 66 for H1 including four forwarded members that need a reviewed list. Statements: 150-191, 315-567, 684-689 and 697-753 (28 statements, 358 lines, moved verbatim, including `runScenario`, effect 710 and the `useConnectionScenarioRecovery` call). Inputs by kind: 17 imports (the `as request…` aliases kept), React plus bare `useEffect`, `BACKEND_URL` by identity, 21 container members and 25 planner-scope parameters; none is declared after the planner call site. Returns: 16 names in an object literal (`runScenario`, `scenarioHasUnsavedChanges`, `scenarioCanSaveDraft`; `postScenarioRealtimeJson`, `pauseScenarioRealtime`, `pollScenarioDraftEvents`, `scenarioActiveDraftReady`, `scenarioActiveDraftId`, `scenarioScopeKey` for H2; `saveScenarioDraftVersion`, `buildScenarioDraftScope`, `fetchScenarioDraft`, `fetchScenarioDraftVersion`, `rollbackScenarioDraft`, `reloadScenarioDraftFromJira`, `isScenarioScopeDraftCurrent` for H5). Counts for the later sub-hooks, from the same analysis: H2 8 outer/24 expanded/5 returns, H3 7/12/22, H4 7/20/5, H5 13/23/15, H6 26/58/31; flat results total 67. The scratch result is the planner 3,201→2,881 lines and a 441-line hook (358 moved plus 83 scaffolding), conservation over App plus all ten owner hooks with 1,704→1,707 statements (the old 70-name state destructure removed; the planner's 66-name destructure, the call/result destructure, the hook's 21-name destructure and its return added) and identical order across all 155 effects, zero lint errors and 113 warnings, and no render-phase read of a later binding.

*Frozen-budget checkpoint for H1 R4 (validated by the operator in chat, 2026-10-04; installed unchanged in R4).* New module `scenario.useScenarioDraft`: cap 441 lines, 27 inputs (expanded ceiling 66 nested paths after human review of the four forwarded members), 16 returns, outer parameter ceiling 1. Planner: cap and 267 expanded-input ceiling stay until R5 (its measured set falls to 255; R5 would ratchet the cap to 2,881), 34 inputs and 67 returns unchanged. Move the `useConnectionScenarioRecovery` caller entry to the new file. Checkpoint aggregates: allowance 121 (hook scaffolding 83 plus net planner scaffolding 38, no transfer credit), giving Scenario 3,981→4,102, Settings 9,803, unique owners 13,784→13,905 and combined 29,152→29,273 with `dashboard.jsx` unchanged at 15,368.

*R2 checks (historical, at `4f9e267a`).* Fresh Node (`fnm exec --using 20 npm run test:frontend:unit`): 1,744 passed, zero failures/skips. Environment-isolated Python suite: 2,113 tests, OK, 29 skips (126.4 s). `tests.test_codebase_structure_budgets`: two tests pass. `fnm exec --using 20 bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 44 modules, 18 sites, zero enforced/budget problems, 34 informational. `negative_controls.sh`: all 73 controls pass (seven shell, 66 JavaScript) and the pinned `tmp/lint` dependencies verify. The fixture is not read by any test or source, so no Chromium, DOM-parity, build or dist check applies to this rung; the full Chromium campaign remains an R6 requirement. Two independent runs of the scratch generator and the committed fixture are byte-identical (SHA-256 `b872c956…`, 485,272 bytes); the fixture contains no `@`, absolute path, non-`example.test` URL or non-DEMO key.

The R2 rung changes no source, test, budget, build output or `dashboard.jsx`. Operator validation was review of the committed diff only; the operator validated R2 and the H1 checkpoint below in chat on 2026-10-04 ("proceed"). Each later sub-hook rung freezes its own checkpoint at the preceding stop.


**SC3 H1 R4 record (2026-10-04, local, unpublished).** Base remains exact main `f2e2b51049e1e7b3cce7c8323aa8d14ecff87934`; R2 `4f9e267a` is its parent and changed no source. The operator-validated H1 checkpoint is installed unchanged in `scripts/extraction_lint/owner_budgets.json` (`SC3-H1-draft-hook`): new module `scenario.useScenarioDraft` capped at 441 lines (27 inputs, 66 reviewed nested paths, 16 returns, one outer parameter); planner line/input ceilings carried forward (3,201 / 267; measured 2,881 / 255, left for R5); aggregates Scenario 4,102, Settings 9,803, unique owners 13,905, combined 29,273; `dashboard.jsx` unchanged at 15,368 with its structural ceiling untouched. The four forwarded inputs were reviewed: `BACKEND_URL` and `selectedSprint` are scalars passed to API wrappers, and `selectedTeamSet` and `excludedEpicSet` are Sets read only through `Array.from`, not dependency bags. The `useConnectionScenarioRecovery` caller entry moved to `useScenarioDraft.js:387`.

*Move.* `useScenarioDraft.js` (441 lines = 358 moved + 83 scaffolding) holds the 28 H1 statements verbatim (the four ranges, including `runScenario`, effect 710, the connection-recovery call and the render-phase ref writes) and is called first in the planner at the old `fetchScenarioCsrfToken` position, destructuring exactly 16 names. Planner 3,201 → 2,881 lines; its remaining text is unchanged except three trimmed and three removed imports, the new import, four state-destructure members and two blank lines. The 67-key flat return, `dashboard.jsx`, hook order and effect order are unchanged; the hooks it calls first were the planner's first hooks, and nothing between the old and new positions reads the two ref writes during render. An independent review found the moved statements byte-identical apart from whitespace (346 = 346 non-blank lines) and no defect.

*Conservation (App plus all ten existing owner hooks, `useScenarioDraft.js` created).* 1,704 → 1,707 statements; one removed (the planner's old 70-name state destructure) and four added (the planner's 66-name destructure, the call with its 16-name result destructure, the hook's 21-name destructure and its return) — all interface wiring; effect order identical across all 155 top-level effects. The full residual text is in the commit message.

*Guard ledger.* All 14 failures were invariant pins reading H1 text from the planner; each was re-pointed to the new owner with its assertions unchanged. `test_scenario_draft_history_source_guards.js` now reads `['frontend/src/dashboard.jsx', 'frontend/src/scenario']` anchored at `export function useScenarioDraft(`, `test_excluded_capacity_stats_source_guards.js` reads `useScenarioDraft.js`, and `test_scenario_planner.js` reads the idle-state oracle from `useScenarioDraft.js` (fixture unchanged). Three end-marker regexes (`runScenario`'s successor and the two save-eligibility spans) were tightened to the now-adjacent statement (`scenarioTeamIds`, `scenarioActiveDraftId`) so they no longer run across file boundaries; each matches in a single file and every assertion on those spans is unchanged. The ordered 67-key planner assertion is unmodified. One new test server-renders the real `useScenarioDraft` with `useScenarioState`: ordered 16 keys, function-typed members, idle defaults, render-phase ref writes and `isScenarioScopeDraftCurrent` branches; seeded mutations (dropped or swapped returns, a dropped ref write) fail it. The passing `/api/scenario` literal pin in `test_frontend_api_source_guards.js` was not edited; the global endpoint-literal and `fetch(` guards already scan every `frontend/src` file, including the new hook. `docs/ontology.md` still describes the planner as owning `runScenario`; its update belongs to R5.

*R4 checks.* Full Node: 1,745 passed (1,744 plus the new test), zero failures/skips. Environment-isolated Python: 2,113 tests OK, 29 skips (126.1 s). `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 45 modules, 19 sites, zero enforced/budget problems, 34 informational; all 73 tooling controls pass. Scoped Chromium (the ten-spec set used by SC2, source-bundled): 492 passed, one runtime opt-in skip, zero failures at the base and after the move; all 34 DOM captures are byte-identical (`diff -r` empty). `npm run build` regenerates only the committed dist, and the exact-head build is recorded below.

*H1 R4 exact-head evidence.* The pre-amend commit `d7166547eced4e3afee0977bf153ecbe054742a3` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`54318bb5a3a668d1f7e6a58083a41eae83a434d2`) byte-identical. Four normal-timer runtime-work samples compare base `f2e2b510` (two runs) and that head (two runs): provenance identical except the added `useScenarioDraft.js` and changed planner inputs, the same fixture, runtime, browser, viewport and CSS. All 11 phases show identical method/path request multisets (23 startup and 34 final requests: one Scenario POST, six event polls, two presence writes, no unexpected request), and ten of eleven phases have identical request sequences; the idle phase differs only in the order of near-simultaneous presence and event requests, as in SC2. Nine of ten action phases have identical render/edge/layout/scroll/stacking deltas in all four samples, and the tenth, startup, shows App renders 20/21 before and 21/19 after, the same startup-render variance recorded for SC2; final cumulative renders are 82/83 before and 83/81 after. These counters and uncontrolled timings establish no performance claim. Raw samples and the comparison are in ignored `tmp/sc3-h1-verification/`.

Operator validation scope: SM-S, H1 area — ENG Scenario mode, Run Scenario, edit and Save Draft, Discard, switching groups (Default → Alternate → Default keeps the lane mode and collapse state noted before the commit), and connection recovery with an unsaved override (one restore, no extra write); plus a diff review of the guard re-points. H2 starts only after validation.


**SC3 H2 R4 record (2026-10-04, local, unpublished).** Base is the operator-validated H1 R4 `38117af37ba8b3b00b48c4563dda00b73ccc674b` on exact main `f2e2b510`; no upstream drift (fetched `origin/main` unchanged). The checkpoint was frozen from a current-base scratch dry run before the move and is installed unchanged in `owner_budgets.json` (`SC3-H2-realtime-hook`); it is reported to the operator with this commit. New module `scenario.useScenarioRealtime`: cap 391 lines, eight inputs (36 reviewed nested paths), five returns, one outer parameter. Planner line and input ceilings carry forward (3,201 / 267; measured 2,534 lines). Allowance 44 (hook scaffolding 42, net planner scaffolding 2, no transfer credit): Scenario 4,102 → 4,146, Settings 9,803, unique owners 13,905 → 13,949, combined 29,273 → 29,317; `dashboard.jsx` unchanged at 15,368.

*Accounting note.* H2 absorbed the planner's last unresolved forwarded input (`BACKEND_URL`), so the checker now measures the planner's raw expanded inputs (95) instead of merging its reviewed list. The reviewed 235-path inventory (255 minus the 20 paths read only by the moved statements) stays in the manifest as the authoritative human count, and R5 ratchets the planner input ceiling to 235, never to the lower raw figure and never above the carried 267. Review noted that, with no unresolved entry left, the checker no longer reads that list or its digest (`check_hook_interfaces.mjs` merges `inventory.memberNames` only for unresolved inputs), so its drift would go unenforced; making the checker always merge a reviewed inventory is a tooling change left to an operator decision rather than part of this move.

*Move.* `useScenarioRealtime.js` (391 lines = 349 moved + 42 scaffolding) holds 21 statements verbatim in three runs — `mergeScenarioDraftPresence` through `applyScenarioDraftEvent` with `SCENARIO_PRESENCE_TTL_MS` (121 lines), the three issue-lock functions (52 lines) and `scenarioCurrentUserIdentifiers` through the SSE effect (176 lines) — and is called in the planner immediately after `useScenarioDraft`, taking `scenarioState`, `BACKEND_URL` and six H1 returns (`pauseScenarioRealtime`, `postScenarioRealtimeJson`, `pollScenarioDraftEvents`, `scenarioScopeKey`, `scenarioActiveDraftId`, `scenarioActiveDraftReady`) and returning five names (the three lock functions, `scenarioRemoteEditors`, `scenarioIssueLockWarnings`). Planner 2,881 → 2,534 lines; its flat 67-key return and `dashboard.jsx` are unchanged. The H1 reads inside H2 at render are the dependency arrays only (all six are declared before the call); the lock functions are read in the planner only by the deferred mouse handler and drag effect, and `scenarioRemoteEditors`/`scenarioIssueLockWarnings` only in the return, after the call. No getter is used. Poll and SSE dependency arrays still include `scenarioDraftLastEventNumber` and the heartbeat's still omits it.

*Conservation (App plus all ten existing owner hooks, `useScenarioDraft.js` unchanged, `useScenarioRealtime.js` created).* 1,707 → 1,710 statements; one removed (the planner's 66-name state destructure) and four added (its 53-name destructure, the call with its five-name result destructure, the hook's 17-name destructure and its return), all interface wiring; effect order identical across all 155 effects. The full residual text is in the commit message.

*Guard ledger.* Exactly one test failed: `test_frontend_api_source_guards.js` asserted that the planner imports `scenarioApi.js`; the import check now reads the owner directory anchored at `export function useScenarioRealtime(`, and the no-`/api/scenario`-literal check now spans the whole Scenario directory (wider, never narrower). The `scenarioApi.js` import and `scenarioApi` boundary guards are otherwise unchanged. The H2 text asserted by `test_scenario_draft_history_source_guards.js` was already read through the directory form from H1, each match lies within one file, and those guards were not edited. The `edited-statement` control in `negative_controls.sh` was re-anchored to the moved `window.setInterval(poll, 5000)` and still proves the conservation tool reports an edited effect statement; all 73 controls pass. A new server-render test covers the five ordered returns, idle values, self/expired/blank filtering of presence and locks, and zero network invocation; seeded mutations (dropped or swapped return, changed default, dropped ready guard) fail it.

*H2 R4 checks.* Full Node 1,746 passed (1,745 plus one), zero failures/skips. Environment-isolated Python 2,113 tests OK, 29 skips (126.9 s). `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings (five `err` warnings moved from the planner into the new hook), 46 modules, 20 sites, zero enforced/budget problems, 34 informational. Scoped Chromium (the same ten-spec source-bundled set, including the collaboration, history, focus-position, recovery and onboarding specs): 492 passed, one runtime opt-in skip, zero failures; all 34 DOM captures byte-identical to the H1 head captures (`diff -r` empty; the H1 head and this base share an identical `frontend` tree).

*H2 R4 exact-head evidence.* The pre-amend commit `40fdf02f79f6399e82be990680dfff4ad7e24cc3` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`a16d0b805329a7bb09f8223041a0169ee06b556b`) byte-identical. The four normal-timer runtime-work samples compare the two H1-head runs (identical `frontend` tree to this base) with two runs at this head: provenance differs only by the added `useScenarioRealtime.js` and changed planner input, with the same fixture, runtime, browser, viewport and CSS. All 11 phases have identical request sequences and multisets in all four samples (23 startup and 34 final requests: one Scenario POST, six event polls, two presence writes, no unexpected request), and all ten action phases have identical render/edge/layout/scroll/stacking deltas in every sample. Startup App renders vary 21/19 at the base and 20/19 at this head (the same startup variance recorded for SC2); final cumulative renders are 83/81 before and 82/81 after. These counters and uncontrolled timings establish no performance claim. Raw samples and the comparison are in ignored `tmp/sc3-h2-verification/`.

Operator validation scope: SM-S, H2 area — two browsers (or the named collaboration specs `scenario_draft_collaboration.spec.js`): presence appears and expires, a lock on a dragged issue shows for the other editor and clears on release, and a remote event updates the draft without an extra write; confirm no extra requests when idle; plus a diff review of the one guard re-point and the re-anchored control. H3 starts only after validation.

**SC3 H3 R4 record (2026-10-05, local, unpublished).** Base is the operator-validated H2 R4 `c8d0a3065e072313e68bfe5b7e281276bbfec2ce` on exact main `f2e2b510`; `origin/main` is unchanged. The `GATE-05` weekly review fell due today: it is still Blocked (0 of 4 probe inputs, no approved target; next review 2026-10-12) and is not a dependency. The checkpoint was frozen from a current-base scratch dry run before the move and is installed unchanged (`SC3-H3-derived-hook`); it is reported to the operator with this commit. New modules: `scenario.useScenarioDerived` (cap 145 lines; seven inputs, 13 expanded, 22 returns, one outer parameter, nothing unresolved) and the pure `scenario.scenarioLayout` (cap 240 lines; 15 exports; plain functions carry no hook/container interface entry). Planner line and input ceilings carry forward (3,201 / 267; measured 2,295 lines and 95 raw inputs). Allowance 146 with no transfer credit: hook scaffolding 47 (including its `scenarioLayout` import), net planner scaffolding 32, pure-module scaffolding 46 (import, blank, 15 signatures, 15 closings, 14 separators) and a net memo call-site change of 21 (51 call-site lines minus 30 removed `useMemo` open/close lines): Scenario 4,146 → 4,292, Settings 9,803, unique owners 13,949 → 14,095, combined 29,317 → 29,463; `dashboard.jsx` unchanged at 15,368.

*Move.* Layer 1 moves 33 statements verbatim (271 lines: `matchesScenarioSearch` and the selector/memo run from `scenarioRawIssues` through `scenarioDepViolatedKeys`, including the `scenarioViewRangeRef` render write) into `useScenarioDerived`, called in the planner immediately before the first later effect. It takes `scenarioState`, `EMPTY_ARRAY`, `EMPTY_OBJECT`, `jiraUrl`, `searchQuery`, `normalizeEpicKey` and `excludedEpicSet`, and returns 22 names (11 read by the planner's flat return and 11 only by H4/H6). Layer 2 extracts the factory bodies of 15 `useMemo` statements (every factory of six or more lines or with branching: sprint bounds, issues, effective issues, search match set, filtered issues, excluded keys, issue map, base end, focus issue/context keys, timeline issues, timeline with segments, assignee conflicts, dependency violations and violated keys) into exported `build*` functions in `scenarioLayout.js` with only their closed-over variables turned into parameters; each hook `useMemo` calls its core with a byte-identical dependency array (19 arrays compared). The per-render `parseScenarioDate` constants, the one-liner memos and `matchesScenarioSearch` stay in the hook. Planner 2,534 → 2,295 lines; its 67-key return and `dashboard.jsx` are unchanged. The first H3 reader at render is the H4 undo-effect dependency on `scenarioIssueByKey`; all other H3 reads are in H6 memo factories, H6 dependency arrays and the planner's return object, after the call. No getter is used.

*Conservation (App plus all ten existing owner hooks, `useScenarioDraft.js` and `useScenarioRealtime.js`, `useScenarioDerived.js` created).* 1,710 → 1,713 statements; 15 removed (the original memo statements, listed by name in the commit message) and 18 added (the same 15 as `useMemo(() => buildX(...), deps)`, the hook's state destructure and return, and the planner call), all itemised and reviewed; effect order identical across all 155 top-level effects. The conservation tool cannot list the non-hook `scenarioLayout.js`; its 15 bodies were compared token by token with the original factory bodies instead (identical), and the oracle conformance test covers their behaviour.

*Oracle and tests.* The R2 fixture is now consumed: `tests/test_scenario_layout.js` (23 tests) pins `TZ=UTC` before any Date or import is evaluated (line 3, after a two-line comment), decodes the fixture encodings, chains the 15 cores in hook order for all 18 cases with strict deep equality, checks exact exports, purity on deep-frozen inputs, per-core non-trivial coverage, and server-renders the real hook for all 18 cases against the fixture. Seeded mutations in the pure module (conflict comparison, segment bounds and clipping, DevLead assignment and spelling) and in the hook (dropped or swapped returns, defaults, ref write) fail it; removing the time-zone pin fails 19 of 23. A new server-render test of `useScenarioDerived` covers the ordered 22 returns, idle fallback identities, base-URL fallback, the render-phase ref write and the per-render `Date` identity quirk. The only guard that broke was the `matchesScenarioSearch` regex oracle, re-pointed to the new hook with its fixture and assertions unchanged. The earlier dry-run oracle check matched 540/540 core outputs.

*H3 R4 checks.* Full Node 1,770 passed (1,746 plus 24), zero failures/skips. `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 48 modules, 21 sites, zero enforced/budget problems. Environment-isolated Python 2,113 tests OK, 29 skips (126.9 s); all 73 tooling controls pass; scoped Chromium (the same ten-spec source-bundled set) 492 passed, one runtime opt-in skip, zero failures, with all 34 DOM captures byte-identical to the H2 head (`diff -r` empty). Exact-head results follow below.

*H3 R4 exact-head evidence.* The pre-amend commit `457acb9a319b8e989930c2bef5087c9657079903` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`8d64984e161e496ece69692f7417d1fc57b5e4a8`) byte-identical. The four normal-timer runtime-work samples compare the two H2-head runs with two runs at this head: provenance differs only by the added `useScenarioDerived.js` and `scenarioLayout.js` and the changed planner input, with the same fixture, runtime, browser, viewport and CSS. All 11 phases have identical request sequences and multisets in all four samples (23 startup and 34 final requests, no unexpected request), and nine of the ten action phases have identical render/edge/layout/scroll/stacking deltas in every sample. Startup App renders vary 20/19/20/20 across the four samples. The 5-second idle phase has three renders, eight scheduling requests and one layout/scroll read in three samples and four, ten and two in the second run at this head (one extra edge-scheduling cycle with the same two frames and computes); the PR0 feasibility probes on `831acf7a` already recorded idle deltas of four renders and ten scheduling requests, and SC2 recorded 2/4 before and 2/3 after, so this is the known timer-alignment variance of the idle window, not added work (request multisets and final request counts are identical). Final cumulative renders are 82/81 at the H2 head and 82/83 at this head. These counters and uncontrolled timings establish no performance claim. Raw samples and the comparison are in ignored `tmp/sc3-h3-verification/`.

**SC3 H4 R4 record (2026-10-05, local, unpublished).** Base is the operator-validated H3 R4 `20a2a38c253d9d8ca220be100ace08056c0e2058` on exact main `f2e2b510`; `origin/main` is unchanged. The checkpoint was frozen from a current-base scratch dry run before the move and is installed unchanged (`SC3-H4-drag-hook`); it is reported to the operator with this commit. New module `scenario.useScenarioDrag`: cap 218 lines, seven inputs (22 expanded paths, nothing unresolved), five returns, one outer parameter. Planner ceilings carry forward (3,201 lines / 267 inputs; measured 2,121 lines, 86 raw inputs). Allowance 44 (hook scaffolding 38, net planner scaffolding 6, no transfer credit): Scenario 4,292 → 4,336, Settings 9,803, unique owners 14,095 → 14,139, combined 29,463 → 29,507; `dashboard.jsx` unchanged at 15,368.

*Move.* `useScenarioDrag.js` (218 lines = 180 moved + 38 scaffolding) holds the eight H4 statements verbatim in two runs: `toggleScenarioEditMode` and `handleScenarioBarMouseDown` (61 lines, previously between the H2 and H3 calls and now later; their only reader is the planner's return), and the run from the drag-effect comment through `scenarioOverrideCount` (119 lines: `scenarioDraggingIssueKey`, the drag mousemove/mouseup effect, `scenarioUndo`, `scenarioRedo`, the undo keydown effect). It takes `scenarioState`, `trackScenarioAction`, `scenarioHasUnsavedChanges` (H1), the three issue-lock functions (H2) and `scenarioIssueByKey` (H3), is called right after `useScenarioDerived`, and returns five names; `scenarioDraggingIssueKey` is not returned because nothing outside H4 reads it. The drag effect's `[scenarioDraggingIssueKey]` dependency array (capturing that render's release function and draft id at drag start), the undo effect's `scenarioIssueByKey` dependency and its authentication check, the deferred `scenarioViewRangeRef` reads and the set-only `scenarioUndoVersion` are unchanged. The planner keeps the `// --- Drag effect, undo/redo, save/discard` section comment above the call, since it also describes the still-resident history code. Planner 2,295 → 2,121 lines; its 67-key return and `dashboard.jsx` are unchanged. The only render-time read of an upstream value inside the hook is `scenarioIssueByKey` in the undo effect's dependency array; no getter is used.

*Conservation (App plus all ten existing owner hooks and the draft, realtime and derived hooks, `useScenarioDrag.js` created).* 1,713 → 1,716 statements; one removed (the planner's 53-name state destructure) and four added (its 44-name destructure, the call with its five-name result destructure, the hook's 14-name destructure and its return), all interface wiring; effect order identical across all 155 effects, so the drag and undo effects still follow the four realtime effects and precede the history Escape effect. The full residual text is in the commit message.

*Guards.* No existing guard needed re-pointing: every text guard on H4 symbols already reads the Scenario directory, and the authentication-isolation guard checks each window keydown handler against its own file (six registrations); undo-before-Escape ordering across files is guaranteed by the identical effect order. A new server-render test covers the five ordered returns and the deterministic non-DOM behaviour of the toggle, undo/redo and mouse-down early returns; effects are covered by the Playwright collaboration and history specs, not claimed here.

*H4 R4 checks.* Full Node 1,771 passed (1,770 plus one), zero failures/skips. Environment-isolated Python 2,113 tests OK, 29 skips (130.5 s). `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 49 modules, 22 sites, zero enforced/budget problems, 34 informational; all 73 tooling controls pass. Scoped Chromium (the same ten-spec source-bundled set, including the collaboration, history, focus-position and recovery specs): 492 passed, one runtime opt-in skip, zero failures; all 34 DOM captures byte-identical to the H3 head (`diff -r` empty). The new test's 18 seeded mutations (return shape, toggle branches and tracking, undo/redo semantics, mouse-down guards, a timer started during render) each fail it. Exact-head results follow below.

*H4 R4 exact-head evidence.* The pre-amend commit `cf71f0233c8753e6089ca21f5d441d5fe841a053` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`8c00fe8e5800b92e4376dab629e1fd45a843bf98`) byte-identical. The four normal-timer runtime-work samples compare the two H3-head runs with two runs at this head: provenance differs only by the added `useScenarioDrag.js` and the changed planner input, with the same fixture, runtime, browser, viewport and CSS. All 11 phases have identical request sequences and multisets in all four samples (23 startup and 34 final requests, no unexpected request), and nine of the ten action phases have identical render/edge/layout/scroll/stacking deltas in every sample. Startup App renders vary 20/20/19/20. The 5-second idle phase has three renders, eight scheduling requests and one layout/scroll read in three samples and four, ten and two in one (a sample from the H3 head this time, with the same two frames and computes), the same timer-alignment variance recorded at H3 and earlier; request multisets and final request counts are identical. Final cumulative renders are 82/83 at the H3 head and 81/82 at this head. These counters and uncontrolled timings establish no performance claim. Raw samples and the comparison are in ignored `tmp/sc3-h4-verification/`.

Operator validation scope: SM-S, H4 area — Edit mode and dragging: enter Edit, drag a bar and see the override count change, Ctrl/Cmd+Z undoes it and Ctrl/Cmd+Shift+Z redoes it, leaving Edit with overrides behaves as before, dragging a bar still takes its lock (visible to a second editor; the named collaboration spec covers it if two browsers are unavailable), and the undo shortcut does nothing while the sign-in recovery screen is showing. H5 starts only after validation.

**SC3 H5 R4 record (2026-10-05, local, unpublished).** Base is the operator-validated H4 R4 `2fca1fe09ca178c0a65c2f31caeb86663c97b09f` on exact main `f2e2b510`; `origin/main` is unchanged. The checkpoint was frozen from a current-base scratch dry run before the move and is installed unchanged (`SC3-H5-history-hook`); it is reported to the operator with this commit. New module `scenario.useScenarioHistory`: cap 654 lines, 13 inputs (24 expanded paths including the `scenarioState` root, nothing unresolved), 15 returns, one outer parameter. Planner ceilings carry forward (3,201 lines / 267 inputs; measured 1,537 lines, 75 raw inputs). Allowance 70 (hook scaffolding 51, net planner scaffolding 19, no transfer credit): Scenario 4,336 → 4,406, Settings 9,803, unique owners 14,139 → 14,209, combined 29,507 → 29,577; `dashboard.jsx` unchanged at 15,368.

*Move.* `useScenarioHistory.js` (654 lines = 603 moved + 51 scaffolding) holds the 18 H5 statements verbatim as one contiguous run from `saveScenarioDraft` through `runScenarioHistoryAction`, including the history-open focus effect and the history Escape keydown effect (authentication check first). It is called immediately after `useScenarioDrag` and takes `scenarioState`, `trackScenarioAction` and eleven H1 returns (`saveScenarioDraftVersion`, `buildScenarioDraftScope`, `fetchScenarioDraft`, `fetchScenarioDraftVersion`, `rollbackScenarioDraft`, `reloadScenarioDraftFromJira`, `postScenarioRealtimeJson`, `isScenarioScopeDraftCurrent`, `scenarioScopeKey`, `scenarioCanSaveDraft`, `scenarioHasUnsavedChanges`); nothing comes from H2, H3 or H4. It returns 15 names read only by the planner's return object. Both history effects depend only on `scenarioDraftMeta.historyOpen`; the three handler-to-run calls that the strict scan flags exist at the base and run only when a handler fires. The planner no longer references the two history controller refs (the H2 realtime cleanup effect still uses them, unchanged), and `scenarioUndoVersion` stays set-only. Planner 2,121 → 1,537 lines; its 67-key return and `dashboard.jsx` are unchanged. No getter is used.

*Conservation (App plus all ten existing owner hooks and the draft, realtime, derived and drag hooks, `useScenarioHistory.js` created).* 1,716 → 1,719 statements; one removed (the planner's 44-name state destructure) and four added (its 33-name destructure, the call with its 15-name result destructure, the hook's 11-name destructure and its return), all interface wiring; effect order identical across all 155 effects. The full residual text is in the commit message.

*Guards.* Three tests in `test_scenario_draft_history_source_guards.js` ended their regexes at `scenarioLaneForIssue`, which now lives in another file; the three end markers became the hook's return (`return {` then `saveScenarioDraft,`), so each still matches the same asserted span, and the discard guard now reads the Scenario directory anchored at `export function useScenarioHistory(`. Every assertion is unchanged. The other guards (analytics source, quirk pins with 17 `trackScenarioAction` calls across files, the authentication-isolation guard with six keydown handlers) pass unmodified. A new server-render test covers the 15 ordered returns and the deterministic non-network behaviour of the discard, request/cancel updaters and guard paths; the history focus and Escape effects are covered by the Playwright history spec, not claimed here.

*H5 R4 checks.* Full Node 1,772 passed (1,771 plus one), zero failures/skips. Environment-isolated Python 2,113 tests OK, 29 skips (131.0 s). `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 50 modules, 23 sites, zero enforced/budget problems, 34 informational; all 73 tooling controls pass. Scoped Chromium (the same ten-spec source-bundled set, including the history, collaboration, focus-position and recovery specs): 492 passed, one runtime opt-in skip, zero failures; all 34 DOM captures byte-identical to the H4 head (`diff -r` empty). The new test's 19 seeded mutations (return shape, discard behaviour, request/cancel updaters, dropped early-return guards, a timer started during render) each fail it. Exact-head results follow below.

*H5 R4 exact-head evidence.* The pre-amend commit `c9328d8d3cfde4ca359bca62d6b87b214543cb12` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`c5fe57ee6bbceed0da0c9e2c867891b9a42a2825`) byte-identical. The four normal-timer runtime-work samples compare the two H4-head runs with two runs at this head: provenance differs only by the added `useScenarioHistory.js` and the changed planner input, with the same fixture, runtime, browser, viewport and CSS. All 11 phases have identical request sequences and multisets in all four samples (23 startup and 34 final requests, no unexpected request), and eight of the ten action phases have identical render/edge/layout/scroll/stacking deltas in every sample. Startup App renders vary 19/20/20/20. In the second run at this head the Epic-focus phase shows eight renders, 21 scheduling requests, four frames and computes, three layout/scroll reads and eight stackings against six, 16, three, three, two and six in the other three samples, and its following idle phase shows two renders, five requests and one frame against three, eight and two. This is the Epic-focus variation already recorded for the SC2 baseline (two extra renders, five requests, one extra frame/compute pass and two stackings in one sample) and the idle-window timer alignment seen at H3 and H4; request multisets and final request counts are identical, so I treat it as batching variance rather than added work. Final cumulative renders are 81/82 at the H4 head and 82/83 at this head. These counters and uncontrolled timings establish no performance claim. Raw samples and the comparison are in ignored `tmp/sc3-h5-verification/`.

Operator validation scope: SM-S, H5 area — History and rollback: edit a bar and Save Draft; open History and see the versions; close it with Escape; roll back to an earlier version and see the guarded confirmation; reload from Jira shows its confirmation; Discard restores the saved overrides while keeping the loaded draft's details; the writeback preview and gate behave as before (use a test group; do not write to Jira); a second tab's conflicting save still shows the keep-editing/history conflict choices. H6 starts only after validation.

**SC3 H5 follow-up: operator-reported history behaviour (2026-10-05).** While validating H5 against a real backend, the operator reported that Scenario draft history (save, rollback, Reload from Jira) is not working as expected, judged it buggy overall and non-critical, and chose to finish the extraction first and rebuild history later; the rebuild is tracked in [issue #230](https://github.com/Juce-me/jira-execution-planner/issues/230). An A/B check against mocked routes with server-modelled draft revisions, versions, numbered events and single-use CSRF tokens ran the same six-step flow (edit and Save; roll back to an older version; roll back straight to the newest; save again; echoed own events during a slow rollback; Reload from Jira returning 503) at exact main `f2e2b510`, H1, H2, H3, H4 and H5 (twice). Every revision passed every flow with identical request bodies (including the second rollback using the first rollback's returned `baseDraftRevision`) and UI states, and a line-by-line comparison found the save, rollback, history, realtime and draft function bodies textually identical to main, so no regression from the extraction was found; the mock cannot show session-specific behaviour of the real backend. Behaviour confirmed as existing: the realtime CSRF token is cached while the server accepts each token once, so every heartbeat or lock call after the first fails with 403, refetches and retries; rollback responses carry the new draft, so no follow-up draft read is expected; Reload from Jira returns 503 when no reload source loader is configured; Save Draft is disabled when the draft is clean. These, and the possible readings of "rollback did nothing" (Current marks the new version rather than the target; a rollback to equal dates moves nothing; a transient "Newer draft available" banner), are inputs to #230 and are deliberately not fixed during extraction. H5 validation remains the operator's word.

**SC3 H6 R4 record (2026-10-05, local, unpublished).** Base is H5 R4 `e1ed501fd851a7507aeae2fd4b971382a91944b7` on exact main `f2e2b510`; `origin/main` is unchanged. The checkpoint was frozen from a current-base scratch dry run before the move and is installed unchanged (`SC3-H6-layout-hook`); it is reported to the operator with this commit. New module `scenario.useScenarioLayout`: cap 909 lines, 26 inputs, 31 returns, one outer parameter, and one unresolved forwarded input (`scenarioTimelineWithSegments`, passed to `buildLaneIssues`) covered by a reviewed 114-path member list. `scenario.scenarioLayout` grows from 240 to 768 lines (36 exports, no interface entry) as a new frozen cap naming the 21 incoming core ranges. Planner ceilings carry forward (3,201 lines / 267 inputs; measured 320 lines and 34 raw inputs). Allowance 220 with no transfer credit (layer 1 +124, layer 2 +96): Scenario 4,406 → 4,626, Settings 9,803, unique owners 14,209 → 14,429, combined 29,577 → 29,797; `dashboard.jsx` unchanged at 15,368.

*Layer 1: verbatim move.* `useScenarioLayout.js` (1,341 lines before layer 2 = 1,235 moved + 106 scaffolding) holds `let scheduleScenarioEdgeUpdate;`, `registerScenarioIssueRef` and the run from `scenarioLaneForIssue` through the Escape epic-focus effect: all nine H6 effects, the late edge-update assignment, both equality helpers (kept hook-local because existing tests read them), the tooltip, focus and scroll handlers and the `perfCountersRef` writes. It is called after `useScenarioHistory` and takes `scenarioState`, `perfEnabled`, `perfCountersRef`, `showScenario`, `normalizeEpicKey`, `isAllTeamsSelected`, `excludedEpicSet` and 19 H3 returns, returning 31 names. The late-assignment quirk is preserved: the `let` is declared at the top of the hook, the layout effect's dependency array still reads it (always `undefined`) and the assignment stays after that effect; it is never a parameter, container member or hoisted `useCallback`. The planner is now its parameters, six sub-hook calls and the unchanged 67-key return (1,537 → 320 lines, no state destructure or React import).

*Layer 2: pure cores.* Twenty-one more `build*` functions were appended to `scenarioLayout.js` under the H3 rule (every factory of six or more lines or with branching): lane info; late, critical-path and unschedulable item lists (three separate verbatim cores); ticks; quarter markers; lane stacking; visible export issues; lane meta; lane assignee groups; positions; edge candidates and index; Epic bars and Epic edges; visible lanes; and the active, upstream, downstream, blocked and focus edge sets. Each hook `useMemo` calls its core with a byte-identical dependency array (27 arrays compared, including unused and deliberately omitted entries). Core bodies are token-identical to the original factory bodies. The one-liners, `scenarioLanes`, `scenarioIssuesByLane`, the Jira key lists, `scenarioBaselineEdges` and `scenarioTodayLeft` (which reads `new Date()`) stay in the hook. Two cores are split around instrumentation and are the only non-verbatim reassemblies: the hook wrapper keeps the empty-lanes early return and the `perfCountersRef` and `performance.mark/measure` blocks around the lane-stacking core call, and the positions wrapper keeps its early returns and the development-only `console.debug` block. The splits change only the order of pure code relative to the instrumentation (the return object is built before the end mark, and the debug block runs before the elapsed time it prints is computed); the counters, mark and measure names and order, and returned values are unchanged.

*Conservation (App plus all ten existing owner hooks, the five earlier SC3 hooks, `useScenarioLayout.js` created).* Layer 1 alone: 1,719 → 1,721 statements, zero removed. With layer 2: 21 removed (the original memo statements, one per core, listed by name in the commit message) and 23 added (the same 21 rewritten as `useMemo(() => buildX(...), deps)`, the hook's return and the planner call), all itemised and reviewed; effect order identical across all 155 top-level effects in both layers. `scenarioLayout.js` is not a hook, so its bodies were compared token by token instead.

*Oracle and tests.* The R2 fixture now covers all 36 cores: the scratch check matched 1,286 of 1,286 chained and isolated outputs across 18 cases (lane stacking in 16 and positions in 15; where the hook's early return fires the core is not reached and the fixture equals the hook's literal values), and a mutated positions core was caught. `tests/test_scenario_layout.js` is extended to the 36 cores with exact exports, hook-order chaining, strict equality, purity and a real-hook server render of both derived and layout hooks against the fixture; a new server-render test of `useScenarioLayout` covers the 31 ordered returns, the instrumentation wrappers and deterministic non-DOM behaviour. Two oracle regex reads of `areScenarioCollapsedLanesEqual` and `areScenarioEdgeRendersEqual` were re-pointed to the layout hook with their fixtures unchanged; effects and DOM geometry are covered by the Playwright specs, not claimed here.

*H6 R4 checks.* Full Node 1,773 passed (1,772 plus one), zero failures/skips. Environment-isolated Python 2,113 tests OK, 29 skips (128.9 s). `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 51 modules, 24 sites, zero enforced/budget problems, 34 informational; all 73 tooling controls pass. Scoped Chromium (the same ten-spec source-bundled set, including the focus-position, history, collaboration and recovery specs): 492 passed, one runtime opt-in skip, zero failures; all 34 DOM captures byte-identical to the H5 head (`diff -r` empty). Seeded mutations across eight H6 cores (stacking rows, lane height, positions, Epic bars, visible-lane boundaries, active and focus edges), the perf wrapper (counter, marks, clears), the debug block, hook returns and the equality helper each fail the extended oracle suite or the new layout-hook test. The reviewer rebuilt the 114-path inventory from the hook's reads and found it exact apart from callee reads of `buildLaneIssues` for the forwarded input, which the manifest rationale states are not counted (as for the other Scenario hooks' forwarded inputs). Exact-head results follow below.

*H6 R4 exact-head evidence.* The pre-amend commit `3379f28362ae9c3fadd24dc1ad02c14d7b49613d` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`29060e2889c050ffa0abb5a7d787ba6f9ef33c19`) byte-identical. The four normal-timer runtime-work samples compare the two H5-head runs with two runs at this head: provenance differs only by the added `useScenarioLayout.js` and the changed planner and `scenarioLayout.js` inputs, with the same fixture, runtime, browser, viewport and CSS. All 11 phases have identical request sequences and multisets in all four samples (23 startup and 34 final requests, no unexpected request), and eight of the ten action phases have identical render/edge/layout/scroll/stacking deltas in every sample. Startup App renders vary 20/20/19/20. The Epic-focus phase shows eight renders, 21 scheduling requests and four frames and computes in one sample (a run at the H5 head) against six, 16 and three in the other three, and the idle phase shows two renders, five requests and one frame in two samples (one per revision) against three, eight and two in the others: the Epic-focus and idle-window variation already recorded for SC2 and at H3 to H5 (extra scheduling in one phase and less in its neighbour, with identical request multisets and final request counts), so I treat it as batching variance rather than added work, and note that it appears at both revisions. Final cumulative renders are 82/83 at the H5 head and 80/82 at this head. These counters and uncontrolled timings establish no performance claim. Raw samples and the comparison are in ignored `tmp/sc3-h6-verification/`.

R5 follow-ups (SC3 close-out): ratchet owner, interface and aggregate ceilings to the measured values within the frozen checkpoints; recompute the planner's reviewed expanded-input inventory and the new hook's 114-path list against the final sources; update `docs/ontology.md` for all six sub-hooks and `scenarioLayout.js` (it still describes the planner as owning the moved code); refresh the remaining-App inventory; record the final measured sizes.

Operator validation scope: SM-S, H6 area — lanes, edges, focus and tooltip: Run Scenario in Team mode (All teams starts collapsed; expand a lane), Epic mode (bars appear; click one for the focus indicator; Escape clears it), Assignee mode; hover a bar near the right and bottom edges for the tooltip; scroll the timeline and check dependency arrows and the sticky header; Conflicts only; a long list scrolled while edges update; Default to Alternate to Default group switch keeps lane mode and collapse state as before. Then review the six SC3 sub-hooks as a set. SC3 R5 starts only after validation.

R5 follow-ups recorded here: recompute the planner's reviewed expanded-input inventory after H6 (it is no longer enforced by the checker), and ratchet to it.

Operator validation scope: SM-S, H3 area — filters and search: Run Scenario; type a search term and see lanes and bars filter; set an Epic focus and clear it; toggle Show conflicts only; confirm conflict markers, late/at-risk counts and dependency-violation highlighting in edit mode match what you saw before this commit; plus a diff review of `scenarioLayout.js` against the original factory bodies. H4 starts only after validation.

**SC3 R5 record (2026-10-05, local, unpublished).** Base is the operator-validated H6 R4 `70c25a068994b39cebedef9745ab6c3113900bc1` on exact main `f2e2b510` (`origin/main` unchanged). R5 is a metadata rung: no source, test or dist change.

*Ratchet.* Every Scenario module's line ceiling and every interface ceiling already equaled its measured value because each rung froze its checkpoint at the measured size. R5 ratchets the last carried caps: the planner's line ceiling 3,201 → 320 and its expanded-input ceiling 267 → 34. The planner now only forwards its parameters by name to six sub-hooks and returns their results; it reads no container member or input member path itself, so its honest count is its 34 input names, replacing the earlier reviewed 235-path list (now stale and obsolete, with its digest re-stamped to the final file and its rationale rewritten). No unresolved input remains. All aggregate ceilings equal measured: Scenario 4,626, Settings 9,803, unique owners 14,429, combined 29,797. No dashboard budget change (`dashboard.jsx` is untouched at 15,368 lines and its structural ceiling stays), and the lint ceiling stays 113 (SC3 moved five `err` and one `isUnscheduled` warning between files but removed none). The manifest audit confirms ceiling equals measured for all 51 modules.

*Final SC3 sizes (lines).* `useScenarioPlanner.js` 320 (was 3,201); `useScenarioDraft.js` 441; `useScenarioRealtime.js` 391; `useScenarioDerived.js` 145; `useScenarioDrag.js` 218; `useScenarioHistory.js` 654; `useScenarioLayout.js` 909; pure `scenarioLayout.js` 768 (36 `build*` cores, all former `useMemo` factory bodies); `useScenarioState.js` 210; `scenarioGroupState.js` 95; `scenarioLaneUtils.js` 69; the other Scenario helpers unchanged. Scenario owners total 4,626 lines against 3,981 after SC2: the 645-line increase is wrapper, signature, destructure and call-site scaffolding for six hooks and 36 functions (allowances 121, 44, 146, 44, 70 and 220, all without transfer credit), not moved behaviour. SC3 added 29 Node tests (an oracle-conformance file and one server-render test per sub-hook) around the stored oracle fixture; the Node suite grew from 1,744 to 1,773 and Python is unchanged at 2,113.

*Remaining-App responsibility inventory after SC3* (verified against `70c25a06`; `dashboard.jsx` is unchanged since SC2, so these rows only change where SC3 changed the planner behind its flat interface):

| Canonical responsibility | Retained symbols and consumers | Why it remains / owner relationship | Current seam cost |
| --- | --- | --- | ---: |
| Scenario state composition | `scenarioState`, its 56-name App destructure and `scenarioGroupValues` feed group cache, connection snapshot and JSX | App calls effect-free `useScenarioState`; the planner and its sub-hooks consume the container members they read. Shared feature composition remains in App | 59 lines (462–520); one state-module import line |
| Cross-feature per-group persistence | `buildDefaultGroupState`, group snapshot, `applyGroupState`, group-cache effects | Unchanged from SC2; Scenario defaults, setters and resets delegate to `scenarioGroupState.js` | Five existing one-line seams |
| Scenario planner composition and exports | `scenario = useScenarioPlanner(...)`, its 67-name result destructure, `runScenario` early reader, Jira export key readers | The planner composes six sub-hooks (draft, realtime, derived, drag, history, layout) with a flat interface identical to SC2; App retains explicit inputs and result consumers | 105 lines (8503–8607); one planner import line |
| Scenario scope/reset and recovery shell | `clearEngGroupScopeData`, `applyGroupState`, view-mode effects, `connectionRecoverySnapshotRef.current` | Recovery waiting and the fresh compute now live in `useScenarioDraft` at their preserved first effect position | Unchanged |
| Scenario presentation | `.scenario-fullbleed` JSX consumes `scenario`, state-container values and shared controls | SC4 moves the UI; the flat interface is unchanged | Zero SC3 JSX changes |
| Settings bootstrap, draft/save authority and modal composition | `openGroupManage`, `loadConfig`, `loadGroupsConfig`, `saveGroupsConfig`, `saveEpmConfig`, `saveAllSettingsOnce`, `saveAllSettings`, `SettingsModal` | ST1–ST5 own later moves; existing hooks remain independent; G2 preserves save sequence and requires its separate correction | Unchanged |
| Shared scope, auth and ENG/Planning/Statistics/EPM shell | `savedPrefsRef`, `planningScopeKey`, `acceptedBoardConfigRef`, `engWorkspaceConfigured`, auth/recovery wiring, ENG/Planning/Statistics JSX and `useEpmViewData` | Cross-feature scope/auth lifetime remain App-owned; already-extracted owners consume explicit inputs | Unchanged |

Import direction remains App → owners; no owner imports the dashboard entry. SC3 is independent of the Settings slices.

*R5 verification.* `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passes both tests; `fnm exec --using 20 bash scripts/extraction_lint/run.sh` passes with zero errors, 113 warnings, 51 modules, 24 sites, zero enforced/budget problems and 34 unchanged informational findings; `negative_controls.sh` passes all 73 controls. `docs/ontology.md` now records the six sub-hooks, `scenarioLayout.js`, the fixture and test contracts and the moved recovery-compute owner, with verification date 2026-10-05; every link in the file resolves. Full exact-head Node/Python/Chromium suites and the publication transaction require the separate R6 publication go; R5 does not authorize push, PR creation or SC4.

Operator validation was **review the R5 diff only; no additional app smoke**, and the operator validated R5 in chat on 2026-10-05 (choosing validation only, not publication). Next: operator verification of SC3 as a set, a separate publication go (the publication transaction in section 8 and `AGENTS.md` section 10), the operator's merge, and only then SC4.

**SC4 R4a record (2026-10-05, local, unpublished).** Base is exact main `1df92ad1856600211b0bfc3b5f83d19f3cc18068` (SC3 merged in #231; the `frontend` tree equals the validated SC3 head). Branch `improvement/scenario-view-component` was cut from it with no open PR touching `dashboard.jsx` or the Scenario owners. The checkpoint was frozen from a current-base scratch dry run before the move and is installed unchanged (`SC4-ScenarioView`); it is reported to the operator with this commit. New module `scenario.ScenarioView`: cap 988 lines, a component interface of five props (101 expanded inputs, nothing unresolved). Allowance 32 with no transfer credit (113 scaffolding lines + 7 call-site lines − 87 removed App destructure names − 1 import line): Scenario 4,626 → 5,614 (the 875 moved lines and 113 scaffolding), Settings 9,803, unique owners 14,429 → 15,417, combined 29,797 → 29,829. `dashboard.jsx` falls 15,368 → 14,412 lines; its structural ceiling stays 15,368 until R5 ratchets it.

*Move.* `dashboard.jsx` lines 13576–14450 (875 lines: the block rooted at `<div className="scenario-fullbleed">` through the tooltip) moved verbatim into the stateless named export `ScenarioView`, indentation reduced by 16 spaces; the block has no multi-line template literal or string whose whitespace the dedent could change. `dashboard.jsx` keeps the unchanged `selectedView === 'eng' && showScenario && engWorkspaceConfigured &&` condition around a seven-line call. The component returns the root div directly, so `.scenario-fullbleed` stays a direct child of `.container` with no wrapper DOM or Fragment. Props are exactly D9's: `scenario` (the planner result; the JSX reads 65 names from it), `scenarioState` (the container; 30 names), and the three scalars `selectedSprint`, `normalizeEpicKey` and `excludedEpicSet`; the mechanical derivation found 104 undefined names (65 + 30 + 3 + 6 imports: `ScenarioBar` and five `scenarioUtils` names) and no other App binding. The body destructures the 65 and 30 names so the JSX text is unchanged, and the first parameter is destructured so the interface checker verifies prop parity (renaming a passed prop at the call site produces both the required-not-passed and passed-not-accepted errors). All five props are evaluated during App's render after their declarations; no getter or later-binding closure crosses the boundary, and the component calls no hooks, so React hook order is unchanged. After the move 63 planner-result names and 24 container names became unused in `App()` and were removed (each has zero remaining occurrences; `runScenario`, `scenarioHasUnsavedChanges`, the Jira export key lists, `scenarioDraftMeta`, `scenarioLaneMode` and the other names App still reads were kept), the `scenarioUtils` import line was deleted and the `ScenarioBar` import line became the `ScenarioView` import.

*Plan deviations, both judgment calls.* The component imports React as `import * as React from 'react'` (40 of the 42 existing owner `.jsx` files, including `ScenarioBar.jsx`, use the namespace form; the plan's default-import form costs the same lines) and uses a named export like `EpmView`. The plan also called for deleting the JSX-order and shape guards in `test_scenario_draft_history_source_guards.js`; only one guard read `dashboard.jsx` text (the visible-failure alert order), so it was re-pointed to `ScenarioView.jsx` with its assertions unchanged, and the Playwright history spec covers the same behaviour at several assertions, so nothing was deleted. `test_epm_shell_source_guards.js` and `test_eng_board_runtime_source_guards.js` pass unmodified, as the plan expected.

*Conservation.* App plus all 16 owner hooks: 1,721 → 1,721 statements; three removed and three added, all outside any hook: the planner-result destructure and the container destructure (each smaller by the removed names) and App's `return (` statement, which contains the call site (its printed text is about 5,400 lines of App JSX and is summarised here rather than copied into the commit message). Effect order is identical across all 155 effects. The `undefined-name` negative control seeded a rename in `dashboard.jsx` text that no longer exists, so it now seeds the same rename inside `ScenarioView.jsx`; the gate reports the expected `no-undef` finding and all 73 controls pass.

*Tests.* A new `tests/test_scenario_view.js` (8 tests) server-renders the real `ScenarioView` with the real planner and container: single root with no wrapper, toolbar order, labels and gates in idle, data and edit modes, the three `role="alert"` blocks in order, tooltip states, all 18 oracle cases (bar, lane, epic-bar, tick and marker counts against the fixture) and the exact five-prop export contract; 13 seeded mutations (extra wrapper, reordered toolbar, relabelled button, moved alert, swapped or renamed props, extra export) each fail it.

*R4a checks.* Full Node 1,781 passed (1,773 plus eight), zero failures/skips. Environment-isolated Python 2,113 tests OK, 29 skips (126.3 s). `bash scripts/extraction_lint/run.sh`: zero errors, 113 warnings, 52 modules, 24 sites, zero enforced/budget problems, 34 informational; all 73 tooling controls pass. Scoped Chromium (the same ten-spec source-bundled set): 492 passed, one runtime opt-in skip, zero failures; all 34 DOM captures byte-identical to the SC3 head (`diff -r` empty). Sticky and transition re-check (`planning_review_integration`, `eng_compact_layout_visual`, `eng_dependency_chip_visual`, `eng_alerts_panel_summary`, which cover the Catch Up, Planning and Scenario transitions and header/filter/panel tiers): 76 passed. Reviewer: verbatim move, props and bindings, timing, budgets, guards and scope all verified with no blocking or medium findings; its one note (the manifest `baseSha` named the SC3 branch commit rather than main) was applied.

*Screenshot comparison.* Raw before/after screenshots of the eight Scenario states differed by 2,000–35,000 pixels, but so did two captures of the same tree (up to 11,000 pixels, only in some states), and the cropped difference was the soft red glow around conflict bars, a CSS animation caught in a different phase. With the project rule applied (animations disabled via `page.screenshot({ animations: 'disabled', caret: 'hide' })` after the existing settle wait and finishing every animation, in a scratch copy of the spec that was deleted afterwards; the base ran from an ignored archive of main), four runs of each tree produced byte-identical images for seven of eight states in all 16 before/after pairs. The tooltip state matched in 12 of 16 pairs; the four misses are a single 128-pixel region (a 34 by 32 box, at most 1/255 per channel) that appeared once in one run of the old tree. The tooltip images are the same size in both trees. So the move changes no pixels; the earlier raw differences were animation phase, not layout. Exact-head runtime results follow below.

*SC4 R4a exact-head runtime evidence.* The pre-amend commit `90dacb73df34bd11587def004f527299330bdb38` was rebuilt (`npm run build` then `make verify-dist-clean`, no diff, clean worktree) and probed; this docs-only amend leaves its `frontend` tree (`a781847533214a6bf458761e954070953b49daf0`) byte-identical. Provenance differs from the SC3-head samples only by the added `ScenarioView.jsx` and the changed `dashboard.jsx`. All 11 phases have identical request multisets and final request counts (23 startup and 34 final requests, no unexpected request), and total renders are unchanged (80 to 83 at both). Unlike SC2 and SC3, the phase boundaries moved: in both exact-head samples and in three alternating base-archive and candidate pairs run in one session (the base bundled from an ignored archive of main), every phase after startup takes 100–400 ms less wall time on the candidate (for example Run 3,262–3,285 ms against 2,866–2,917 ms), so the first action phase's trailing work (two renders, five edge requests) lands in the next phase (zero renders and four renders in place of two and two). This is not extra work, and a dedicated diagnosis explained it: the probe's animation wait is capped at 1.2 s twice per phase and is hit by an infinite 2-second `conflict-pulse` animation on conflict bars in both trees, so animation inventories, durations and settle times are identical (about 2.4 s per phase); the gap is in the action half of each phase, which runs development React. The old inline JSX was rebuilt by every `App()` call, including the React passes that bail out of re-rendering children, whereas the candidate builds one `ScenarioView` element and React skips the child on those passes: `createElement` self-time in a CPU profile of the Run action fell from 594 ms to 281 ms, long tasks from 217, 49, 99 and 97 ms to 80 and 61 ms, and `createElement` calls from 3,265 to 2,702 (about 30% fewer in later phases). With the production React build the phases are equal (Run 265 against 267 ms, expanded lanes 46 against 44, Epic lanes 55 against 50) with identical inventories. The shorter phases also move the five-second event poll across a phase boundary (it falls inside the collapsed-lanes phase on the base and just after it on the candidate), which accounts for where the trailing work is attributed; the React skip rule is inferred from the call counts, and the poll's link to the shifted renders matches the timestamps but was not proven separately. The change has no user-visible effect, is limited to development-mode wasted render work and has no request or visual difference; compare future probe runs by cumulative totals or align phases with the poll rather than by phase wall time. Raw samples, the alternating pairs, the animation inventories and the CPU profiles are in ignored `tmp/sc4-verification/`.

Operator validation scope: SM-S, whole Scenario view — everything the SC3 scopes covered, since the JSX now lives in a new file: Run Scenario; Team, Epic and Assignee lanes; collapsed and expanded lanes; Epic focus and Escape; tooltip near the right and bottom edges; dependency arrows while scrolling; Conflicts Only; Edit, drag, Undo and Redo; Save Draft and History; the Default to Alternate to Default group switch; and the sticky order when moving between Catch Up, Planning and Scenario. SC4 R5 starts only after validation.


**SC4 R5 record (2026-10-05, local, unpublished).** Base is the operator-validated R4a `1b995667658b89ae0884bc947bc3976f6c338531` on exact main `1df92ad1`. R5 changes no source, generated output or test logic.

*Ratchet.* The structural `dashboard.jsx` ceiling in `tests/test_codebase_structure_budgets.py` and the manifest's `dashboard.lineCeiling` move from 15,368 to the measured 14,412. Every owner file, interface and aggregate ceiling already equaled its measured value because R4a froze its checkpoint at the measured size (`ScenarioView` 988 lines and five props; Scenario 5,614, Settings 9,803, unique owners 15,417, combined 29,829); the audit again finds ceiling equal to measured for all 52 modules. The lint ceiling stays 113 (no warning was removed). No unresolved input remains anywhere in the Scenario owners.

*Size milestone.* The plan forecast about 14,494 lines after SC4 (a net reduction of about 870 from 15,364); the measured result is 14,412 from 15,368, a net reduction of 956, because the move also let 87 destructure names and an import line leave `App()`. The combined App-plus-owner total grew by only the 32-line scaffolding allowance (29,797 → 29,829). The program forecast of 10–12k lines after ST5 is unchanged and will be re-measured at ST4.

*Remaining Scenario references in `dashboard.jsx`* (the plan's post-SC4 check; `rg -n '\bscenario[A-Z]\w*'` returns 69 lines): the two seam imports (`scenarioGroupState.js`, `scenarioDraftOverrides.js`); the container call and its 34-line destructure of the 32 names the shell still reads (lines 462–495); the per-group defaults, snapshot and apply seam (`buildDefaultScenarioGroupState`, `scenarioGroupValues`, `resetScenarioTransientRefs`); the clear/reset and view-mode effects that cancel frames and clear refs when Scenario closes or the scope resets; the mount-time compute guard (`scenarioRefreshNonceRef`, `runScenario()`); the planner call, its four-name result destructure and the Jira export key readers (`scenarioJiraEpicKeys`, `scenarioJiraStoryKeys`); the connection-recovery snapshot reads (`scenarioHasUnsavedChanges`, `scenarioDraftMeta`, `scenarioOverrides`, `scenarioEditMode`, `scenarioTimelineRef`); the `showScenario` flag and its mode/analytics/export uses; and the single `<ScenarioView … />` call under the unchanged condition. Nothing else reads Scenario state.

*Remaining-App responsibility inventory after SC4* (verified against `1b995667`; only the Scenario rows changed):

| Canonical responsibility | Retained symbols and consumers | Why it remains / owner relationship | Current seam cost |
| --- | --- | --- | ---: |
| Scenario state composition | `scenarioState` and a 32-name destructure; `scenarioGroupValues` feeds the group cache, connection snapshot and the view | App calls the effect-free `useScenarioState`; the planner, its sub-hooks and `ScenarioView` consume the members they read. Shared feature composition stays in App | 35 lines (461–495); one state-module import line |
| Cross-feature per-group persistence | `buildDefaultGroupState`, group snapshot, `applyGroupState`, group-cache effects | Scenario defaults, setters and resets delegate to `scenarioGroupState.js`; the cache also owns ENG, Planning and Statistics state | Five existing one-line seams |
| Scenario planner composition and exports | `scenario = useScenarioPlanner(...)`, its four-name result destructure, `runScenario` mount reader, Jira export key readers | The planner composes six sub-hooks with a flat 67-name interface; App now reads four outputs, down from 67 | 43 lines (8477–8519); one planner import line |
| Scenario scope/reset and recovery shell | `clearEngGroupScopeData`, `applyGroupState`, view-mode effects, `connectionRecoverySnapshotRef.current` | Recovery waiting and the fresh compute live in `useScenarioDraft`; App only reads the dirty delta for the snapshot | Unchanged |
| Scenario presentation | `<ScenarioView scenario scenarioState selectedSprint normalizeEpicKey excludedEpicSet />` under the unchanged condition | The stateless `ScenarioView` owns the 875-line timeline JSX and calls no hooks | 7 lines (13487–13494); one view import line |
| Settings bootstrap, draft/save authority and modal composition | `openGroupManage`, `loadConfig`, `loadGroupsConfig`, `saveGroupsConfig`, `saveEpmConfig`, `saveAllSettingsOnce`, `saveAllSettings`, `SettingsModal` | ST1–ST5 own later moves; existing hooks remain independent; G2 preserves the save sequence and requires its separate correction | Unchanged |
| Shared scope, auth and ENG/Planning/Statistics/EPM shell | `savedPrefsRef`, `planningScopeKey`, `acceptedBoardConfigRef`, `engWorkspaceConfigured`, auth/recovery wiring, ENG/Planning/Statistics JSX and `useEpmViewData` | Cross-feature scope and auth lifetime remain App-owned; already-extracted owners consume explicit inputs | Unchanged |

Import direction remains App → owners; no owner imports the dashboard entry. The Scenario half of issue #220 is complete after this slice merges; the Settings slices remain.

*R5 verification.* `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passes both tests; `fnm exec --using 20 bash scripts/extraction_lint/run.sh` passes with zero errors, 113 warnings, 52 modules, 24 sites and zero enforced or budget problems; `docs/ontology.md` now records `ScenarioView` and its test contract with verification date 2026-10-05 and every link resolves. Full exact-head Node, Python and Chromium suites and the publication transaction require a separate go; R5 does not authorize push, PR creation or the Settings slices.

Operator validation was **review the R5 diff only; no additional app smoke**, given in chat on 2026-10-05.


**ST1 R1 record (2026-10-05, local, unpublished).** Base is exact main `7a768d5ddf3607a5deb4bed759e8c26198ceaff5` (SC4 merged in #232); branch `improvement/settings-shared-config-sections` was cut from it with a clean tree, no open PR touching `dashboard.jsx`, `frontend/src/settings` or the budget manifest, and `GATE-05` not due for review until 2026-10-12 (not a dependency). The R1 re-location by symbol found the three D6 targets exactly where the plan names them: the `fetchBoards as requestJiraBoards` import, the `jiraBoards`/`loadingBoards` state pairs (every setter call lived inside `fetchJiraBoards`, so no batching question arises) and the `fetchJiraBoards` function (no reader anywhere in `frontend/src` or `tests`). All three were deleted: 17 lines, `dashboard.jsx` 14,412 → 14,395. `fetchBoards` stays exported from `frontend/src/api/jiraCatalogApi.js`: the plan deletes only the import, and that module is outside the slice. No guard names a deleted declaration, so none was edited. Three `no-unused-vars` warnings disappeared (113 → 110) and the lint ceiling default in `run.sh` was lowered to 110. The budget manifest's measured `dashboard.lineCount` (14,395) and `appPlusOwners.measured` (29,812) were refreshed to match, together with the 27 caller/getter ledger line numbers that shifted; every ceiling, interface and checkpoint field is unchanged (the structural `dashboard.jsx` ceiling stays 14,412 until R5).


**ST1 R2 record (2026-10-05, local, unpublished).** Base is the operator-validated R1 `ba7bd7ac` ("proceed" in chat, 2026-10-05). R2 changes no source, generated output, manifest or budget: two test files, both passing on the unmodified source.

*Save order and revision chain* (`tests/ui/settings_unified_save.spec.js`, "the unified save posts administrator sections in the documented order with a chained baseRevision"). One Save with six administrator sections, a Department name and an EPM prefix all dirty, against an OAuth-style snapshot at revision 3 whose queued responses return revisions 4 to 9. The recorded method-and-path sequence (the CSRF fetch and the derived `/api/team-catalog` directory save excluded; the latter persists on its own lifecycle) matches the covered subset of the section 4 order: `projects/selected`, `stats/priority-weights-config`, `board-config`, `capacity/config`, `delivery-owner-field/config`, `issue-types/config`, `groups-config`, one `GET /api/config` refresh, then `epm/config`. Not pinned: the relative order of the sprint, parent-name, story-points and team field saves (only the delivery-owner field is dirtied), the `adminAccess` slot between issue types and groups, and the personal-preferences POST; those remain covered only by the code text until a later slice adds them. The six administrator POSTs carry `baseRevision` 3, 4, 5, 6, 7, 8 (each the revision the previous response committed, covering both the internally committing sections and the `commitSharedConfigRevision(await saveXFieldConfig(...))` path), the groups POST carries its own revision 2, and the EPM POST carries none. The first run observed an extra trailing `POST /api/team-catalog`, which is why that path is excluded. Seeded defect: swapping the `savePriorityWeightsConfig()` and `saveBoardConfig()` calls in `dashboard.jsx` makes the test fail; the source was restored from Git afterwards. The test passed three consecutive isolated runs.

*Key parity and snapshot projection* (`tests/test_settings_section_key_parity.js`, six tests). `FIRST_RUN_ADMIN_SECTION_KEYS` lists the 11 sections in order; the `adminSectionsToSave` save map, the `captureFirstRunSettingsDrafts` admin object and the `restoreSettingsDraftsToCommittedBaselines` restore coverage each equal the same 11 as sets; `settingsDraftSnapshotRef.current` holds exactly the 10 keys without `adminAccess`. Each location is read through `readOwnerSource` over `dashboard.jsx` and `frontend/src/settings` with its own anchor, so the pins follow the code when ST4/ST5 move it and fail loudly if an anchor disappears. Object keys come from a brace-depth scan (itself unit-tested) rather than a line regex. Seeded defects: deleting `deliveryOwnerField` from the snapshot and deleting `adminAccess` from the save map each fail exactly the matching test.

*Checks.* Node suite 1,787 passed (1,781 plus six), zero failures or skips. `settings_unified_save.spec.js`: 51 passed, one opt-in DOM-capture skip. No other suite is affected by test-only additions; the Python suite, build and gate are unchanged from the R1 head. Validation scope: review the diff.


**ST1 R3 record (2026-10-05, local, unpublished).** Base is the operator-validated R2 `495722d0`. R3 moves two declarations inside `App()` and changes nothing else in source.

*Hoists.* `useSettingsConfigBaselineRevision()` (its `settingsConfigBaselineRevision` / `acceptSettingsConfigBaseline` destructure, previously after the issue-types state) and `commitSharedConfigRevision` (previously after the priority-weights loaders, just before `saveBoardConfig`) now sit together immediately before the first section state (`priorityWeightsDraft`), after `sharedConfigRevisionRef`, `setSharedConfigRevision` and every other value they read (verified: their only inputs are those two declarations, 687-688). That is the position the three planned section hooks need, so the later `usePriorityWeightsSettings` / `useJiraProjectSettings` / `useCapacityMappingSettings` calls can receive all three as inputs with no flagged call-site TDZ. Both are verbatim: the hook is `useState` plus a dependency-free `useCallback` with no effect (`settingsConfigReadState.js`), so no effect order changes; `commitSharedConfigRevision` stays a per-render closure (not wrapped in `useCallback`), as section 4 requires. The earliest reader of any of the three names is the dirty memo block, which is below the new position, as are all save handlers; no render-phase read precedes it. `dashboard.jsx` 14,395 → 14,394 (the moved function's trailing blank line was dropped with it). The budget manifest's measured `lineCount` (14,394), `appPlusOwners.measured` (29,811) and 23 shifted ledger lines are refreshed; every ceiling is unchanged.

*Conservation.* `check_move_conservation.mjs --base HEAD` (App only, no owner hook changes): 1,287 statements before and after, 0 removed, 0 new, effect order identical across the 119 top-level effects `App()` itself declares (the program-wide 155 includes owner-hook effects, none of which R3 touches).

*Validation scope:* SM-T, save one admin section (for example change one priority weight, Save, confirm it persists and that a second Save of another section works, so the revision still chains).


## 13. Program acceptance

- Every PR merged in order; `dashboard.jsx` lower and its budget ratcheted in each slice that changes it (PR-1, PR0, and SC3 do not change it); the lint ceiling never raised.
- Size milestones are forecasts until measured. At checked main `ffeafb0e` (18,434 lines), unchanged Scenario ranges project about 15,364 after SC2 (historical net reduction ~3,070), no additional dashboard delta in SC3, and about 14,494 after SC4 (~870 net lines). Re-measure every actual base and net reduction. The full end forecast is approximately **10,000–12,000 lines after ST5**, including retained call sites, destructuring and glue. At ST4, record its measured count and project the remaining G2/ST5 net reduction from verified ranges minus added seams; report a material projected mismatch before ST5. Apply the final measured-size check after ST5. Missing the forecast requires an explanation of retained responsibilities and seam overhead, not unrelated deletions or relaxation of the per-slice ratchet.
- Every affected source file/export is registered and within its frozen/ratcheted owner/interface/aggregate ceilings. Remaining-App responsibilities, readers, getter invocation phases and seam costs are current; no owner imports `dashboard.jsx`. Runtime-work comparisons use the same synthetic fixture and refreshed base, with no unexplained additional work or duplicate lifecycle resources. File size alone establishes no performance improvement.
- Extraction slices have no route, payload, startup-count, sticky-order, analytics, or visual change; the separate G2 fix changes only invalid/missing-grant administrator editing. Extraction DOM parity diff is empty in every R1/R3/R4 commit with complete distinct captures; the conservation residual itemised in every R4 commit message; the full Chromium `tests/ui` run passes before every push, or the exact named failure and revision have an explicit operator waiver. A recorded baseline failure alone is not a waiver.
- Docs: `FUTURE-codebase-operability-improvements.md` and `docs/plans/README.md` aligned; `docs/ontology.md` has "Scenario Planner ownership" and "Settings state ownership" entries and every existing entry that cites `dashboard.jsx` ownership (Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, Board scope load authority, Startup config timeout) points at the new owner files, with verification dates and resolving paths.
- On completion rename this file to `DONE-dashboard-scenario-settings-state-extraction.md` with the status note naming the PRs, per `docs/plans/AGENTS.md`.

## 14. Estimate, risks, and review log

- **Effort.** `FUTURE-codebase-operability-improvements.md` estimates 5-8 days (Scenario) and 4-7 days (Settings). The extraction ladder has 11 PRs and 49 commit stops (PR0 6, SC1 3, SC2 2, SC3 8, SC4 2, ST1 7, ST2 6, ST3 5, ST4 3, ST5 7 including the design note); the separate permission fix adds one PR and one commit stop, for 12 PRs including completed PR-1 and 50 total ladder stops after PR-1 (41 remain after merged PR0 and SC1), plus one publication go per PR after PR-1 (D8); non-source commits (R2, R5, R0) stop for a one-line confirmation. With same-day operator turnaround and no rebases, three to four weeks; with the feature-work churn on `dashboard.jsx` (22 commits since 2026-09-01), plan on five to six.
- **Largest risks.** Drift and rebase breaking validated commits (mitigated by the section 5 protocol and textual anchors); validation that is skipped or falsely green (mitigated by named Playwright tests, `sourceBundle: true`, and the dist hash); a silent non-verbatim edit or an `undefined` prop (mitigated by `check_move_conservation.mjs` and the checker's parameter and prop parity); effect reordering in Settings (mitigated by the effect-crossing table); a guard that goes vacuous (mitigated by `readOwnerSource` anchors). There is no data migration, but rollback must account for transitive consumers, rebuilt dist and retained G2 permission behavior (section 5); an earlier prerequisite PR is not independently revertible after its consumers merge.
- **Review log.** Draft 1 was reviewed by four independent reviewers on 2026-10-01 and found not executable: hook cycles/order, range ownership, weak gates, inaccurate guard maps, and thin characterization. Revision 2's scratch dry runs passed SC1, SC2, ST1, ST2, and corrected ST3/ST4 ranges; tooling and cold-read review still required fixes. Revision 3 added the executable lint/conservation gate, seven seeded controls, cumulative dry runs, commit ladder, and publication protocol; its targeted third review reported no P1. PR #219 landed that revision. The 2026-10-02 fourth review reproduced three P1 findings (ST3 effect order, asymmetric conservation, dashboard-only interface coverage), three P2 findings (backward-edge fixture, empty-only conflict fixture, overwritten auth-expiry capture), and stale PR-1 status. Revision 4 corrects each and adds executable controls; earlier lint-clean dry runs do not establish behavior safety.
- **Revision-4 verification (2026-10-02).** Three subagents verified tooling, Scenario characterization, and Settings behavior on ignored scratch copies. The six tool blocks extracted from this document pass Node syntax checks / `bash -n`. `EXTRACTION_TOOL_DIR=tmp/issue220-printed fnm exec --using 20 node tmp/issue220-printed/tooling_controls.mjs` reports 14/14 controls passing. The printed interface checker on an archive of `ffeafb0e` reports 16 destructure sites in 41 modules, 0 enforced and 34 informational problems. `fnm exec --using 20 node tmp/issue220-printed/check_move_conservation.mjs --base HEAD frontend/src/settings/useGroupVisibilityPreferences.js` compares 1,499 statements on each side with 0 residuals and identical order across 138 effects. The revised Scenario spec passes twice in Chromium, producing eight captures per run with identical file lists and no DOM diff. The Settings synthetic browser probe passes on the current source (reopened A), demonstrates the early-normalization candidate selects B, and passes with the separate normalization hook at its original position (A); none sends a shared save or raises a runtime error. The printed DOM helper passes a Chromium check of opt-in no-op behavior, distinct draft/recovery captures, retained input properties, and duplicate-label rejection without overwrite.
- **Revision-5 verification (2026-10-02).** Three subagents checked the additional findings against source. The replacement DOM helper passes Node syntax and 13/13 synthetic Chromium controls; the Scenario spec passes twice (eight identical labels, recursive DOM diff empty). Two source-bundled runtime probes pass; identical 5s idle work and Epic-focus variation are recorded above. A Node projection probe confirms 11 admin keys and the 10-key snapshot excluding `adminAccess`; an isolated ESLint probe confirms the permission-expression-only change adds an unused-getter warning and omitting that getter removes it while preserving setters. The six printed core tools pass syntax checks and their 14 additional controls still pass. The printed strict JSON scan reports both seeded nested render and deferred uses that the default scan misses, and rejects fatal diagnostics. Committing reusable nested-caller controls and implementing owner-growth checks remain explicit PR0 requirements; these probes do not mean the printed core gate already enforces them.
- **Remaining entry requirements.** These probes validate the revised examples; they do not complete PR0 or approve extraction. The optional full-lint scratch probe could not load `eslint-plugin-react` from the cached dependencies; it provides no warning baseline or gate-pass evidence. PR0 must refresh all ranges/budgets, implement and run the full current-base gate, the existing 21 controls plus all new growth/timing controls and 13 DOM-helper controls, freeze owner/interface budgets, commit/refresh the runtime probe, capture every required Settings/Scenario state, and run the required Python, Node, build, and full Chromium suites. D12 is acknowledged, G1 is approved against current-repository boundaries, and G2 is conditional on the separate verified permission fix and preserving the imperative save sequence. PR0 P0-1 (`4149b615`) has operator validation; P0-2 (`a2cc9017`) has operator validation; P0-3 (`d7d47c60`) and P0-4 (`472e98d8`) have operator validation; P0-5 has operator validation; PR0 merged in #227 at `6086bf8c`; SC1 R1 has operator validation; R4a (`0b9a78e7`) has operator validation. SC1 R5 (`e9d2ea0e`) was validated and SC1 merged in #228 at `bc17d28c`; nine PRs and 41 local commit-validation stops remain. SC2 preflight, its frozen checkpoint and R4 `42b2a14f` have operator validation. Exact-head R4 build/runtime checks pass with recorded residuals; R5 validation and publication remain separately gated.
