# Dashboard Scenario And Settings State Extraction Implementation Plan

> **Status:** Proposed, revision 3 (2026-10-01), base `89ffe589`. Revision 3 folds in three rounds of independent review (four reviewers on draft 1, four on revision 2, three targeted reviewers on revision 3; the rounds included dry runs on scratch copies of `dashboard.jsx`). The third round found no Blocker and no P1, and its findings are folded in. The Scenario and Settings halves pass their dry runs; the tooling in section 6 was executed (clean on the unmodified tree, all seeded defects caught, effect order verified both ways). The plan awaits the operator's approval, including decision D12 and the gates. Supersedes the "Extract Scenario Planner ownership" and "Move settings state/actions behind feature hooks" rows of `FUTURE-codebase-operability-improvements.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute one commit at a time under the validation protocol in section 5. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the Scenario Planner and Settings state, effects, handlers, and JSX out of the single `App()` function in `frontend/src/dashboard.jsx` into feature-owned hooks and container components, with no user-visible or contract change, lowering the `dashboard.jsx` line budget in every slice.

**Architecture:** Hooks are called unconditionally from `App()` and receive explicit inputs; no hook introduces a ref or late-binding callback to reach a value declared later. Scenario moves first as one verbatim hook (its code is contiguous, so effect order is preserved by construction) and may then be split inside `frontend/src/scenario/`. Settings is interleaved with other code, so it uses layers: shared-config primitives hoisted first, then per-section hooks (state layer at the existing state lines, behavior layer where its inputs exist), then the save orchestrator. Pure computation moves to plain modules with Node unit tests. JSX moves to stateless container components. Every move is proven verbatim by `check_move_conservation.mjs` (section 6), not by eye.

**Tech Stack:** React 19, esbuild (classic JSX transform), Node 20 (`fnm exec --using 20`), `node --test`, Python `unittest`, Playwright (Chromium; headed Firefox/WebKit only when a commit touches glyph or form-control geometry).

## Global Constraints

- Behavior-preserving: no route, payload, response-shape, cache-key, `Server-Timing`, startup-request-count, sticky-order (`--sticky-scenario-z: 60`), analytics, or visual change.
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
| Dry-run result (reviewers, scratch copies) | SC1 + SC2: lint 0 errors, both bundles build, all 136 effects keep their order, `dashboard.jsx` 18,203 to 15,133 lines (hook 3,227 lines, container 213). ST1-ST4: gate-clean after the fixes in section 11 |
| Python baseline | `Ran 2006 tests ... OK (skipped=25)` (section 6 command) |
| Node baseline | `node --test tests/test_*.js`: 1529 pass, 0 fail |
| Lint baseline (section 6 config) | 0 errors, 119 `no-unused-vars` warnings (149 without the two React-scope rules); checker: 16 destructure sites, 0 enforced problems |
| Full Chromium `tests/ui` baseline | recorded in PR0 (not yet measured) |

Line numbers are as of `89ffe589` and drift after every merge. Every range is also identified by a **textual anchor** (the first and last statement text); re-locate by anchor with `rg -n`, never by number alone. Before moving a range, record its first and last statement text in the PR description. Ranges come from read-only scans and two review rounds on 2026-10-01; each commit re-verifies the ranges it moves.

Prior slices (`DONE-codebase-operability-*`) moved presentational components and pure helpers. None moved `App()` state, which is why this plan adds the commit ladder, the DOM parity check, the lint gate, the conservation check, and the guard ledger.

## 2. Scope

In scope: Scenario (state, draft lifecycle and history, presence/locks/realtime, drag/undo, layout/lanes/edges/focus/tooltips, JSX) and Settings (shared-config sections, EPM settings, Team Groups/Labels/board layouts, first-run flow, permissions, shared-config bootstrap and save, modal shell, JSX), the tests and guards that read `dashboard.jsx` as text, and the docs listed in section 13.

Out of scope: ENG Catch Up/Planning/Stats/EPM/Board state, backend, CSS, contracts, new dependencies, analytics events, visual changes.

## 3. Decisions

Settled by design:

- **D1 Two layers where needed.** A hook cannot receive a value declared later in `App()` (TDZ at first render). Wherever a hook's inputs are not all available at its state lines, split it into a state layer called at the existing state lines and a behavior layer called where its inputs exist. A cycle between two layers is resolved by a getter closure (`() => value`, which keeps per-render capture), never by a ref. A getter may be called only from handlers and effects, never during render (a render-phase call is a TDZ error the gate cannot see), and a verbatim `useCallback` keeps its dependency array when its body starts calling a getter.
- **D2 Always mounted.** Hooks are called unconditionally from `App()`. Dirty drafts and mount effects must survive mode and tab changes. Container components are stateless.
- **D3 Strictly sequential.** One PR at a time, each merged before the next branch is cut; start-of-slice preconditions and the rebase recipe are in section 5.
- **D4 Quirks move verbatim** (section 4). They are preserved, not fixed.
- **D5 No new test dependency.** No jsdom. Effect-heavy behavior is proven by Playwright plus the DOM parity check; pure code gets Node unit tests; hook defaults get server-render probes.
- **D6 Dead code is deleted (operator decision, 2026-10-01).** The first source commit of each slice deletes the never-read declarations of its cluster (lists in the PR sections). Only inert declarations are deleted: unread `const`/function/ref declarations, unread `useState` pairs whose every setter call is batched with another state update in the same synchronous block (the commit message lists each removed setter call and why it is batched; otherwise leave the pair), and imports orphaned by the deletion.
- **D7 Gates.** G2 (before the last Settings PR) is the operator's decision. G1 (before splitting the Scenario hook) is this plan's recommendation; the operator may waive it. Both are "awaiting operator go", not open questions.
- **D8 Commit-gated execution (operator decision).** One commit at a time; after each commit the executor stops, reports the automated results, and gives the operator a validation scope; the next commit starts only after the operator confirms (section 5). The publishing unit stays one PR per slice, assembled from commits the operator has validated. This reading of "one commit at a time" is an assumption; correct it if you meant otherwise.
- **D9 `ScenarioView` takes the planner and the container.** The JSX block uses 98 `App()` bindings: 65 returned by the planner hook, 30 from the SC1 container (data, lane mode, edit mode, draft metadata, layout, tooltip, refs and their setters), and 3 scalars. `ScenarioView` therefore receives `scenario` (the planner object), `scenarioState` (the container object), and the three scalars `selectedSprint`, `normalizeEpicKey`, `excludedEpicSet`. This is a boundary choice inside the plan's own design (no new state or fetching is introduced); the operator can veto it when reviewing the plan.
- **D10 Verbatim is proven mechanically.** `check_move_conservation.mjs` compares the `App()` body statements before the change with the `App()` plus hook-body statements after it. Statements that moved unchanged cancel out; every remaining line must be itemised in the commit message (SC1 + SC2 dry run: 5 removed and 12 new statements, all call sites, destructures, return objects, and the intentionally edited seam statements, out of about 3,000 moved lines).
- **D11 Permission quirk acknowledged at G2.** `Boolean(config.settingsAdminOnly)` (3887, 6865) makes a missing flag leave `canEditSharedConfiguration === true`, which `AGENTS.md` section 11 says must never happen. The backend always sends the flag (`settings_routes.py:699`), so the risk is theoretical. The extraction preserves the behavior and pins it with a unit test labelled as a known deviation; fixing it is a separate change the operator decides at G2.

- **D12 History rewrite and the transaction (proposed for the operator's acknowledgement when approving the plan).** Local rung commits are outside the "commit, push, and PR creation are one blocking publication transaction" rule of root `AGENTS.md` section 10; that transaction runs at R6, at push time. Amending the latest unpublished commit after a failed validation, and rebasing unpublished slice commits onto a moved `main`, rewrite local history; only a recorded operator decision can authorize that, not this plan. Until the operator acknowledges D12 in chat, the executor stops and asks before any amend or rebase. Re-validation after a rebase happens at the new head only.

Gates (operator go/no-go):

- **G1** before `SC3` (split the single Scenario hook into feature hooks): decide after `SC2` whether one hook of about 3,200 lines is acceptable.
- **G2** before `ST5` (shared-config bootstrap, save, modal shell): decide after `ST1`-`ST4` using their measured results. The ST5 design note is written after G2 is approved (rung R0) and is itself a commit with an operator stop.

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

| Rung | Contents | Operator validation |
| --- | --- | --- |
| R1 Dead code | Delete the slice's inert never-read declarations (D6) and the one guard pin that names a deleted declaration, and nothing else; lower the lint ceiling (`run.sh` default) if warnings drop. | The slice's smoke scope. |
| R2 Characterization | Playwright tests, fixture data, and parity captures of **existing** behavior; they pass on the unmodified source. No source change, and no test that imports a module that does not exist yet (unit tests of an extracted module are written in the R4 that creates it). Oracle fixture data for a function that will move is JSON generated from the current code, not a test. | Review the diff; no app check. |
| R3 Prep | Hoists that make a later move legal (a pure primitive moved above the state lines; a pure module-level helper moved to a module). | The slice's smoke scope. |
| R4 Move | One hook or component per rung: the verbatim move; the tests of the new module; the re-pointing of every guard the move breaks (section 7); removal of imports and destructured names the move orphaned; the rebuilt `frontend/dist`. After R4 the whole Node and Python suites are green. | The rung's validation scope. |
| R5 Ratchet | Budget (`tests/test_codebase_structure_budgets.py`) to the measured `wc -l` (a slice that does not change `dashboard.jsx` states "no budget change"), the lint-ceiling default in `scripts/extraction_lint/run.sh`, `docs/ontology.md`, this plan's status table. Test, script-constant, and docs edits only. | Review the diff; no app check. |
| R6 Publish | After the last R5: the Node and Python suites, the committed-revision build with `make verify-dist-clean`, and the full Chromium `tests/ui` run at the exact head; the publication transaction (the section 8 steps apply unchanged), push, PR. | Operator go, then the PR page. |

### After every commit the executor

1. runs the commit's automated checks (section 6) and reads every result,
2. runs `git show --stat HEAD` and `git status` and reads them (the commit contains exactly the intended files; a rename that shows `| 0` has no content change),
3. for R4, runs `check_move_conservation.mjs` and puts every residual line in the commit message,
4. reports to the operator: commit SHA, files changed, automated results, and the **Validation scope**,
5. **stops** until the operator replies that the commit is validated.

### Failed validation, push, and merge

- If the operator finds a defect in the **latest unpublished commit**, the executor amends that commit, rebuilds the dist, reruns the checks, and reports again. The operator pre-authorizes this amend for unpublished commits of these slices.
- A defect in an **earlier** commit, or in a commit that was already pushed, stops the executor: state the defect and ask whether to amend by rebase or to add a fix commit (root `AGENTS.md` section 10 forbids rewriting history without authorization).
- "Validated" is not authorization to push. The push happens only at R6, after the full UI run, on the operator's explicit go (one publication go per PR). The operator merges; the executor never merges.

### Drift and rebase (feature work keeps touching `dashboard.jsx`)

- Start-of-slice preconditions: read the instruction chain, the relevant postmortems, and the `docs/ontology.md` entries the slice touches; run the `docs/plans/GATE-*.md` sweep (every slice is a plan execution; `GATE-05`, Home write capability, next review 2026-10-05, is not a dependency because no slice adds a Home/Townsquare path); `git fetch origin main`; the previous slice is merged; `gh pr list --state open` shows no open PR touching `frontend/src/dashboard.jsx` (ask the operator to hold such merges while a slice is open); the branch is cut from the latest `origin/main`.
- If `main` moves while a slice is in progress: rebase the unpublished commits; rebuild the dist (a dist conflict is resolved by rebuilding, never by hand); re-measure `wc -l` and set the budget to the new value; recapture the "before" DOM parity directory at the new base; rerun the smoke scope at the new head only; re-locate every range by its textual anchor.
- A slice that stays open longer than a week without a push is rebased at the start of each session.

### Operator prerequisites for validation (confirm once before PR0)

Settings slices ST4 and ST5 also need an account with empty group preferences (first-run) and accounts in the non-admin, editor, and tool-admin roles; where an account is not available, the commit report names the Playwright test that covers that scope instead. The commit under test must be what the local app serves: the checkout holding the commits is the one the app runs from, `npm run build` output is committed, and the app is started the usual way from that checkout. State which configuration you use (Basic/jsonfile local config, or your DB/OAuth dev config). Settings validation saves workspace-shared configuration: use a throwaway workspace or revert each edit afterwards.

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

esbuild does not report an identifier left behind by a move, and `no-undef` alone passed seeded defects in review. `run.sh` runs ESLint (`no-undef`, `react/jsx-no-undef`, `react/jsx-uses-react`, `react/react-in-jsx-scope` because the bundle uses the classic JSX transform, `no-use-before-define` with `variables:false` so a render-phase read of a binding declared later in the same function is an error, `react-hooks/rules-of-hooks`; `no-unused-vars` warnings may not exceed the ceiling) and then `check_hook_interfaces.mjs`, and exits non-zero if either fails. The checker verifies, for every local hook and component imported by `dashboard.jsx`: names destructured from the hook result (also through an alias, `const state = useX(...); const {...} = state;`) are returned by it; required keys of the callee's first object parameter are passed by the caller (spread calls are skipped); keys passed are accepted by the callee. Problems in files under `scenario/`, `settings/`, or `epm/` are enforced; everything else prints as informational (8 pre-existing at base, none enforced). **Limits, stated so nobody over-trusts it:** components whose first parameter is `props` or a defaulted parameter (eight today, among them `SettingsModal`, `JiraFieldSettings`, `TeamGroupsSettings`) and components or hooks it cannot resolve are not checked; calls that pass `{...{ a, b }}` spreads are skipped; a hook under `scenario/`, `settings/`, or `epm/` must return an object literal and a new container must destructure its first parameter, because otherwise the checker can only report "cannot verify". The prop-parity rewrite of `test_epm_settings_source_guards.js` stays as the backstop for the Settings containers.

Seven seeded defects (`negative_controls.sh`) prove the gate (a control whose anchor text no longer exists prints `ANCHOR ... re-anchor the control` and counts as a failure, so a slice that moves an anchor re-anchors the control in the same R4; the controls are anchored on text that the early slices move: `scenarioLoading`, `registerScenarioIssueRef`, `window.setInterval(poll, 5000)`, and the `useGroupVisibilityPreferences` call): a deleted JSX import, a render-phase read before declaration, an undefined name, a `.jsx` file without a React import, a destructured name the hook does not return, a required input not passed, and an edited statement the conservation check must report. All seven are caught on the unmodified tree's copy.

**Known blind spots, and their procedures.**

- `no-use-before-define` with `variables:false` ignores closures that run during render (a `useMemo` callback). After the call site is placed, list the hook's returned names (`node tmp/lint/check_hook_interfaces.mjs --print-returns <hookfile> <exportName>`) and filter the strict scan to those names:

  ```bash
  fnm exec --using 20 node tmp/lint/check_hook_interfaces.mjs --print-returns <hookfile> <exportName> | sed "s/.*/'&' was used/" > tmp/lint/returned-names.txt
  tmp/lint/node_modules/.bin/eslint --no-config-lookup -c tmp/lint/eslint.config.mjs \
    --rule '{"no-use-before-define":["error",{"functions":false,"classes":false,"variables":true}]}' \
    frontend/src/dashboard.jsx | grep -F -f tmp/lint/returned-names.txt
  ```

  (the unfiltered scan prints about 100 hits that are not about the hook). Every remaining hit must be a deferred closure (effect callback or event handler), and the PR description lists them; the SC2 dry run found exactly one, `runScenario()` in the 7860 effect. `--print-returns` warns when the hook returns a spread, because only literal keys are then listed.
- The gate cannot see a wrong-but-defined name or a dropped or duplicated statement. `check_move_conservation.mjs` covers those: run `fnm exec --using 20 node tmp/lint/check_move_conservation.mjs --base <ref> <hook files...>` (or `--base-file <path>`); the residual must be fully itemised in the commit message. Human aid: `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change HEAD~1 HEAD`; non-dimmed lines are not verbatim. The script also prints the order of the top-level effects with hook bodies inlined at their call sites (`effect order: identical (136 top-level effects)` for the SC1 + SC2 dry run, or the first divergence); anything other than `identical` blocks the commit unless the effect-crossing table (Settings) justifies it.

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
// Verify the contracts between App() and the hooks/components it calls from local files:
//  1. every name destructured from a local `useX()` result is in the hook's returned object literal;
//  2. every required key of the hook's (or component's) first object parameter is passed by the caller;
//  3. a key passed to a hook or component is accepted by its first object parameter.
// Problems under frontend/src/scenario, settings, or epm are enforced (exit 1) unless listed in the
// baseline file; everything else is informational. `--print-returns <file> [export]` lists return keys.
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';

const OWNER_DIRS = /^(scenario|settings|epm)[\\/]/;   // relative to the source root, so copies under tmp/ behave the same
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
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
};
function walk(node, visit, skipFunctions = false) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'parent') continue;
        const value = node[key];
        for (const child of Array.isArray(value) ? value : [value]) {
            if (child && typeof child.type === 'string' && !(skipFunctions && /Function/.test(child.type))) walk(child, visit, skipFunctions);
        }
    }
}
const keyName = (property) => property.key?.name ?? property.key?.value;
const cache = new Map();
function findFunction(file, exportedName) {
    const ast = cache.get(file) ?? parse(file);
    cache.set(file, ast);
    let fn = null;
    for (const node of ast.body) {
        const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
        if (!decl) continue;
        const isDefault = node.type === 'ExportDefaultDeclaration';
        if (decl.type === 'FunctionDeclaration' && ((isDefault && exportedName === 'default') || decl.id?.name === exportedName)) fn = decl;
        if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations) if (d.id.name === exportedName && /Function/.test(d.init?.type)) fn = d.init;
        }
        if (isDefault && exportedName === 'default' && decl.type === 'Identifier') {
            const target = decl.name;
            for (const n of ast.body) {
                if (n.type === 'FunctionDeclaration' && n.id.name === target) fn = n;
                if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.name === target && /Function/.test(d.init?.type)) fn = d.init;
            }
        }
    }
    return fn;
}
function returnKeys(fn) {
    const keys = new Set();
    let unknown = false;
    let sawReturn = false;
    walk(fn.body, (node) => {
        if (node.type !== 'ReturnStatement') return;
        sawReturn = true;
        if (!node.argument || node.argument.type !== 'ObjectExpression') { unknown = true; return; }
        for (const property of node.argument.properties) {
            if (property.type === 'SpreadElement') unknown = true;
            else keys.add(keyName(property));
        }
    }, true);
    return { keys, unknown: unknown || !sawReturn };
}
function paramInfo(fn) {
    const pattern = fn.params[0];
    if (!pattern || pattern.type !== 'ObjectPattern') return null;
    const required = [];
    const accepted = new Set();
    let rest = false;
    for (const property of pattern.properties) {
        if (property.type === 'RestElement') { rest = true; continue; }
        const name = keyName(property);
        accepted.add(name);
        // children arrive as JSX content and key/ref are consumed by React, so none of them are call-site inputs.
        if (property.value.type !== 'AssignmentPattern' && name !== 'children') required.push(name);
    }
    return { required, accepted, rest };
}

if (printReturns !== -1) {
    const file = path.resolve(args[printReturns + 1]);
    const exported = args[printReturns + 2] ?? 'default';
    const fn = findFunction(file, exported) ?? findFunction(file, args[printReturns + 2] ?? '');
    if (!fn) { console.error('function not found'); process.exit(2); }
    const result = returnKeys(fn);
    if (result.unknown) console.error('warning: the return uses a spread or non-literal; only literal keys are listed');
    console.log([...result.keys].join('\n'));
    process.exit(0);
}

const entry = path.resolve(args[0]);
const ast = parse(entry);
const imports = new Map();
for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
    const resolved = resolveImport(entry, node.source.value);
    for (const specifier of node.specifiers) {
        imports.set(specifier.local.name, {
            resolved,
            exported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name,
        });
    }
}
const enforcedProblems = [];
const informational = [];
let checked = 0;
const sourceRoot = path.dirname(entry);
const report = (resolved, message) => (resolved && OWNER_DIRS.test(path.relative(sourceRoot, resolved)) ? enforcedProblems : informational).push(message);
const at = (node) => `line ${node.loc?.start?.line ?? '?'}`;
const aliases = new Map();

function checkDestructure(pattern, name, info, node) {
    const { fn, resolved } = info;
    const { keys, unknown } = returnKeys(fn);
    checked += 1;
    const wanted = pattern.properties.filter((p) => p.type === 'Property').map(keyName);
    const missing = wanted.filter((key) => !keys.has(key));
    if (missing.length && !unknown) report(resolved, `${name} (${at(node)}): destructured but not returned -> ${missing.join(', ')}`);
    else if (missing.length) report(resolved, `${name} (${at(node)}): return uses a spread or non-literal (in scenario/, settings/, epm/ return an object literal); cannot verify ${missing.length} names`);
}
function lookup(name) {
    const entryInfo = imports.get(name);
    if (!entryInfo?.resolved) return null;
    const fn = findFunction(entryInfo.resolved, entryInfo.exported);
    return fn ? { fn, resolved: entryInfo.resolved } : null;
}
function checkParams(name, info, passed, hasSpread, node) {
    const params = paramInfo(info.fn);
    if (!params || hasSpread) return;
    const missing = params.required.filter((key) => !passed.includes(key));
    const unknownKeys = params.rest ? [] : passed.filter((key) => key !== 'key' && key !== 'ref' && !params.accepted.has(key));
    if (missing.length) report(info.resolved, `${name} (${at(node)}): required input not passed -> ${missing.join(', ')}`);
    if (unknownKeys.length) report(info.resolved, `${name} (${at(node)}): passed but not accepted -> ${unknownKeys.join(', ')}`);
}

walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.init) {
        if (node.id.type === 'ObjectPattern' && node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier') {
            const info = lookup(node.init.callee.name);
            if (info && /^use[A-Z]/.test(node.init.callee.name)) checkDestructure(node.id, node.init.callee.name, info, node);
        }
        if (node.id.type === 'Identifier' && node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier' && /^use[A-Z]/.test(node.init.callee.name)) {
            const info = lookup(node.init.callee.name);
            if (info) aliases.set(node.id.name, { name: node.init.callee.name, info });
        }
        if (node.id.type === 'ObjectPattern' && node.init.type === 'Identifier' && aliases.has(node.init.name)) {
            const { name, info } = aliases.get(node.init.name);
            checkDestructure(node.id, name, info, node);
        }
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && /^use[A-Z]/.test(node.callee.name)) {
        const info = lookup(node.callee.name);
        const first = node.arguments[0];
        if (info && first?.type === 'ObjectExpression') {
            const hasSpread = first.properties.some((p) => p.type === 'SpreadElement');
            checkParams(node.callee.name, info, first.properties.filter((p) => p.type === 'Property').map(keyName), hasSpread, node);
        }
    }
    if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && /^[A-Z]/.test(node.name.name)) {
        const info = lookup(node.name.name);
        if (info) {
            const hasSpread = node.attributes.some((a) => a.type === 'JSXSpreadAttribute');
            checkParams(node.name.name, info, node.attributes.filter((a) => a.type === 'JSXAttribute').map((a) => a.name.name), hasSpread, node);
        }
    }
});

const baseline = baselineFile && fs.existsSync(baselineFile)
    ? new Set(fs.readFileSync(baselineFile, 'utf8').split('\n').filter(Boolean)) : new Set();
const strip = (message) => message.replace(/ \(line \d+\)/, '');
const newProblems = enforcedProblems.filter((message) => !baseline.has(strip(message)));
console.log(`checked ${checked} destructure sites in ${path.basename(entry)}; enforced problems: ${newProblems.length}; informational: ${informational.length}; baselined: ${enforcedProblems.length - newProblems.length}`);
newProblems.forEach((message) => console.log(`  ENFORCED ${message}`));
if (process.env.CHECKER_VERBOSE) informational.forEach((message) => console.log(`  info ${message}`));
if (process.env.CHECKER_WRITE_BASELINE) fs.writeFileSync(process.env.CHECKER_WRITE_BASELINE, `${enforcedProblems.map(strip).join('\n')}\n`);
process.exitCode = newProblems.length ? 1 : 0;
```

`scripts/extraction_lint/check_move_conservation.mjs`

```js
// Prove a move was verbatim: compare the App() body statements before the change (a git ref or a file)
// with the App() body statements plus the hook-function body statements after it. Statements that moved
// unchanged cancel out; every remaining line (call sites, return objects, edited statements) must be
// itemised in the commit message. Whitespace is collapsed, so re-indentation is not a difference.
// It also compares the order of the top-level effects: hook bodies are inlined at their call sites.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as espree from 'espree';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const baseRef = flag('--base');
const baseFile = flag('--base-file');
const dashboard = flag('--dashboard') ?? 'frontend/src/dashboard.jsx';
const hookFiles = args;

const parse = (code) => espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true });
const squash = (text) => text.replace(/\s+/g, ' ').trim();
function findFunction(node, predicate) {
    let found = null;
    (function visit(n) {
        if (found || !n || typeof n.type !== 'string') return;
        if (predicate(n)) { found = n; return; }
        for (const key of Object.keys(n)) {
            if (key === 'loc' || key === 'range') continue;
            const value = n[key];
            for (const child of Array.isArray(value) ? value : [value]) visit(child);
        }
    })(node);
    return found;
}
function statements(code, fn) {
    return fn.body.body.map((node) => ({ text: squash(code.slice(node.range[0], node.range[1])), line: node.loc.start.line }));
}
const beforeCode = baseFile ? fs.readFileSync(baseFile, 'utf8') : execFileSync('git', ['show', `${baseRef ?? 'HEAD'}:${dashboard}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
const afterCode = fs.readFileSync(dashboard, 'utf8');
const isApp = (n) => n.type === 'FunctionDeclaration' && n.id?.name === 'App';
const before = statements(beforeCode, findFunction(parse(beforeCode), isApp));
const after = statements(afterCode, findFunction(parse(afterCode), isApp));
const afterApp = [...after];
const hooks = new Map();   // hook function name -> its body statements
for (const file of hookFiles) {
    const code = fs.readFileSync(file, 'utf8');
    const ast = parse(code);
    const fns = [];
    for (const node of ast.body) {
        const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
        if (decl?.type === 'FunctionDeclaration' && /^use[A-Z]/.test(decl.id?.name ?? '')) fns.push(decl);
    }
    if (!fns.length) { console.error(`no hook function found in ${file}`); process.exit(2); }
    for (const fn of fns) {
        const body = statements(code, fn).map((s) => ({ ...s, file: path.basename(file) }));
        hooks.set(fn.id.name, body);
        for (const s of body) after.push(s);
    }
}
const tally = (list) => {
    const counts = new Map();
    for (const s of list) counts.set(s.text, (counts.get(s.text) ?? 0) + 1);
    return counts;
};
const beforeCounts = tally(before);
const afterCounts = tally(after);
const unmatched = (list, otherCounts) => {
    const seen = new Map();
    return list.filter((s) => {
        const n = (seen.get(s.text) ?? 0) + 1;
        seen.set(s.text, n);
        return n > (otherCounts.get(s.text) ?? 0);
    });
};
const removed = unmatched(before, afterCounts);
const added = unmatched(after, beforeCounts);
const snippet = (s) => (s.text.length > 110 ? `${s.text.slice(0, 107)}...` : s.text);
console.log(`App() statements before: ${before.length}; after (App + hooks): ${after.length}`);
console.log(`removed and not found in a hook: ${removed.length}; new statements: ${added.length}`);
removed.forEach((s) => console.log(`- (base line ${s.line}) ${snippet(s)}`));
added.forEach((s) => console.log(`+ (${s.file ?? 'dashboard.jsx'} line ${s.line}) ${snippet(s)}`));

// Effect order: expand hook calls inline, then compare the sequence of top-level effect statements.
const isEffect = (text) => /^(React\.)?use(Layout)?Effect\(/.test(text);
const expand = (list, depth = 0) => list.flatMap((s) => {
    const called = [...hooks.keys()].find((name) => depth < 8 && new RegExp(`\\b${name}\\(`).test(s.text));
    return called ? expand(hooks.get(called), depth + 1) : [s];
});
const afterEffects = expand(afterApp).filter((s) => isEffect(s.text));
const beforeEffects = before.filter((s) => isEffect(s.text));
const label = (s) => `${s.text.slice(Math.max(0, s.text.lastIndexOf('}, [')), s.text.length).slice(0, 80)}`;
let diverge = -1;
for (let i = 0; i < Math.max(beforeEffects.length, afterEffects.length); i += 1) {
    if (beforeEffects[i]?.text !== afterEffects[i]?.text) { diverge = i; break; }
}
if (diverge === -1) {
    console.log(`effect order: identical (${beforeEffects.length} top-level effects)`);
} else {
    console.log(`effect order: DIFFERS at effect ${diverge + 1} of ${beforeEffects.length} (before ${beforeEffects.length}, after ${afterEffects.length})`);
    console.log(`  before: ${beforeEffects[diverge] ? label(beforeEffects[diverge]) : '(none)'}`);
    console.log(`  after:  ${afterEffects[diverge] ? label(afterEffects[diverge]) : '(none)'}`);
}
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

echo "negative controls failed: $failures"
exit "$failures"
```

The `tests/README.md` note (PR0) documents the five commands above, the install location, and that nothing is added to `package.json`. If PR0 measures a warning count other than 119 on the unmodified tree, set `MAX_WARNINGS` in `run.sh` to the measured value. The optional file `scripts/extraction_lint/hook_interface_baseline.txt` is created only if a pre-existing enforced problem appears (none at base).

### Per-commit checks by rung

R1, R3, R4: gate, negative controls (once per PR), Node suite, Python suite, build plus committed dist plus `make verify-dist-clean`, the slice's targeted Playwright specs, DOM parity diff empty, and for R4 the conservation check. R2: the new tests pass on unmodified source. R5: budget and ceiling tests. R6: everything plus the full Chromium `tests/ui` run.

### Guard ledger and orphans

Every PR description carries a ledger: for each guard that fails after a move, whether it is an invariant pin (re-point to the new owner file, keep) or a shape/order guard (delete, naming the behavioral test that covers the behavior). Do not edit a guard that still passes. A retained negative pin ("this text must not appear") reads the owner files through `readOwnerSource` with a positive anchor (PR0) so it cannot go vacuous when code moves. After each R4, remove imports and destructured names the move orphaned and prune names from the `App()` destructure that no `App()` code reads.

### DOM parity

`JEP_DOM_PARITY_DIR=tmp/dom-parity/before` is captured at the start of the slice (before R1) and `.../after` after each R1, R3, and R4; `diff -r tmp/dom-parity/before tmp/dom-parity/after` must print nothing. The exact command (it must run every instrumented test, not only the ones titled `dom parity`):

```bash
JEP_DOM_PARITY_DIR=tmp/dom-parity/after fnm exec --using 20 npx playwright test \
  tests/ui/scenario_draft_history.spec.js tests/ui/scenario_draft_collaboration.spec.js \
  tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js --browser=chromium
```

The Scenario specs bundle `dashboard.jsx` from source. The `mockConfigSettings` tests must pass `sourceBundle: true` for parity runs, because the default serves the on-disk `frontend/dist/dashboard.js` and a stale dist gives a vacuous green (the `mockFirstRunDashboard` tests in `shared_department_groups.spec.js` already always serve the source bundle). The helper writes only the normalized HTML, so `diff -r` can be empty after a dist rebuild.

## 7. Guard ledger (known guards, first break)

51 files reference `dashboard.jsx`: 19 UI specs bundle it with esbuild (none read it as text); of the 32 others, 4 mention it only in comments, `tests/test_codebase_structure_budgets.py` counts lines, and 27 are text guards. 16 are listed here; the other 11 (`test_dashboard_epic_icon_source_guards`, `test_dashboard_missing_labels_source_guards`, `test_eng_board_drop_source_guards`, `test_eng_sticky_stack_source_guards`, `test_initiative_grouping_source_guards`, `test_initiative_icon_source_guards`, `test_jira_export_source_guards`, `test_stats_controls_source_guards`, `test_stats_module_extraction_source_guards`, `test_story_subtasks`, `test_task_filter_menu_compaction_source_guards`) were run against SC1 + SC2 dry runs and none breaks on its own; re-run them at every commit regardless.

| Guard | Pins | First breaks | Disposition (done in the R4 that breaks it) |
| --- | --- | --- | --- |
| `tests/test_scenario_draft_history_source_guards.js` (18 tests) | poll `setInterval(poll, 5000)`, `SCENARIO_PRESENCE_TTL_MS = 30000`, drag effect deps, literals, declaration and JSX order; slice regexes end at markers in other slices; `:72` needs `scenarioDraggingIssueKey` directly before the drag effect; `:52` spans `pollScenarioDraftEvents` through `saveScenarioDraftVersion`; the "dist changes require src changes" test | SC2 (13 of 18 at once), SC3 (the `:52` span and the poll/TTL/drag pins land in different sub-hooks), SC4 (the JSX-order tests) | SC2: re-point the three invariant pins and the `:72`/`:52` regexes to `useScenarioPlanner.js`; delete order/shape guards naming the covering specs. SC3: re-point to `readOwnerSource(['frontend/src/scenario'])` inside each breaking R4. SC4: in R4a delete the JSX-order and shape tests (`{scenarioError && ...`, `{scenarioDraftMeta.conflict && (`, `{scenarioLoading &&`, `{scenarioDraftMeta.historyOpen && (`, the Save-button `onClick`) naming the Playwright assertions that cover each. The dist test stays untouched. |
| `tests/test_auth_isolation_source_guard.js` | exactly six `window.addEventListener('keydown', X)` calls each latch-checked; negative pins at `:12-36` (`/api/auth/*`, `session_expired`, `auth_required`, localStorage) read only `dashboard.jsx`; `:96-105` slices `saveEpmConfig` to `normalizeStatus` | PR0 (widen); ST2 (that slice empties) | Count per file over `dashboard.jsx` plus every file under `frontend/src/scenario/` and `frontend/src/settings/`; read the negative pins through `readOwnerSource` with an anchor; re-point the EPM slice in ST2. |
| `tests/test_frontend_api_source_guards.js` | `:1469` scenarioApi import; config/jiraCatalog imports; `:11-17` "save auth outcomes stay in dashboard"; `:1204` `saveGroupsConfig` marker plus `invalidate('settings-save')`; repo-wide no-`fetch(`/no-`/api/` scan (`:196-217`) | SC2, ST5 (stays green through ST1-ST4) | Re-point import and marker checks; keep the repo-wide scan unchanged. |
| `tests/test_excluded_capacity_stats_source_guards.js:841-855` | `buildScenarioPayload` regex assumes 12-space indent | SC2 | Re-point and make indentation-agnostic. |
| `tests/test_epm_settings_source_guards.js` | prop spreads vs child props (`:162-179`), declaration strings (`:157` teamSearchQuery, `:161` priorityWeightsDraft, `:251` hasDraftEpmScope, `:765` `await savePriorityWeightsConfig();`), hotkey order, fail-closed assignments (`:644-671`) and negative pins (`:673-679`), `:753` visibility call arguments ("JSON/basic Department visibility stays browser-local"), EPM seed only from the private view (`:688-694`), workspace-conflict sections exclude EPM (`:706-709`) | ST1 (`:159`, `:160`, `:161`), ST2 (11 tests), ST3 (`:157`, `:158`, `:753`), ST5 (`:765` and the permission pins) | Keep as pinned guards on the new owners: the EPM seed pin, the conflict-section exclusion, `:753`, and the prop-parity check rewritten for the new containers. Convert the fail-closed assignments and negative bans (`userCanEditSettings !== false`, `canEditSharedConfiguration \|\| userCanEditEpmConfig`) into unit assertions on the permissions code (ST5) with inputs `true`, `'true'`, `1`, `undefined`, `null`, and a missing key. Until ST5, keep the text pins on `dashboard.jsx` through `readOwnerSource`. |
| `tests/test_first_run_group_configuration.js` | `:74-97` capture/restore cover all 11 admin sections; declaration-order slices; `:544-573` `saveGroupsConfig`/`saveAllSettingsOnce` slices | ST4 (order slices), ST5 (`:544-573`) | Keep the section-coverage test and re-point it; add a key-parity test across the save map (3630-3642), the capture object (1284-1296), the restore function (4194-4226), `FIRST_RUN_ADMIN_SECTION_KEYS`, and the 10-key snapshot (810-821). Keep the reducer tests. |
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

## 8. PR-1: Land this plan on `main`

**Why:** every later PR cuts from `origin/main`, which does not contain this plan, and an execution handoff must only be published once the referenced plan is fetchable from the named remote ref.

**Branch:** `docs/dashboard-scenario-settings-extraction-plan` (holds the draft commit, the revision-2 commit, and the revision-3 commit: three commits; publish as three unless the operator authorizes squashing them into one, which is a history rewrite and needs explicit authorization).

- [ ] The third check of revision 3 is complete: it found no Blocker and no P1, and its findings are folded in. Verify that no place still says the check is pending (the status block at the top, the section 12 PR-1 row, the last sentence of section 14, and the README entry), then make the single revision-3 commit, so HEAD holds exactly three plan commits (the draft, revision 2, revision 3) and no fourth commit exists.
- [ ] Verification at the exact proposed head. Root `AGENTS.md` section 10 requires the full test suite and the full Chromium `tests/ui` run before any push and has no docs-only exception, so run: the Node suite, the Python suite (section 6 commands), and the full Chromium UI run, or record an explicit operator waiver in chat before the push. Run the committed-revision build at the exact head too (`fnm exec --using 20 npm run build`, then `make verify-dist-clean`; a docs-only head leaves `frontend/dist` unchanged).
- [ ] The publication transaction, step by step: fetch the base; record the base and head SHAs; run `git status --short`, `git log --oneline -5`, `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`; compare the commit list (3), the commit count, and the changed paths with this section (three docs files: this plan, `docs/plans/README.md`, `docs/plans/FUTURE-codebase-operability-improvements.md`); stop on any mismatch and ask the operator; wait for explicit operator confirmation before the first push; send the PR body through stdin with `gh pr create --body-file -`; then prove the remote head equals the approved local head, read back the rendered body, visually inspect the PR page, verify the remote changed-file list and commit count, and report the actual CI state. If any post-publication check fails, report the publication as malformed and stop for operator direction.
- [ ] The operator merges. The executor then runs `git fetch` and confirms the plan is on `origin/main` before PR0 starts.

---

## 9. PR0: Tooling, coverage, and baselines

**Branch:** `improvement/dashboard-extraction-tooling`. This PR changes tests, scripts, and docs only; no `dashboard.jsx` change, so no budget change.

**Files:**
- Create: `scripts/extraction_lint/{eslint.config.mjs,check_hook_interfaces.mjs,check_move_conservation.mjs,run.sh,negative_controls.sh}` (section 6), `tests/ui/dom_parity_helpers.js`, `tests/frontend_source_helpers.js`, `tests/test_extraction_quirk_pins.js`
- Modify: `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/test_auth_isolation_source_guard.js`, `tests/README.md`, `docs/ontology.md`, this plan (baselines in section 1)

### Commit P0-1 (R2): extraction gate

- [ ] Add the five scripts from section 6 and the `tests/README.md` note. Run `fnm exec --using 20 bash scripts/extraction_lint/run.sh`: it must exit 0 with "0 errors, 119 warnings" and "enforced problems: 0". Run `negative_controls.sh`: all seven controls must print `ok`.
- [ ] Record the output of both runs in the commit message.

**Validation scope:** none in the app. The operator reviews the scripts and the two run outputs.

### Commit P0-2 (R2): DOM parity helper and Settings captures

- [ ] Create `tests/ui/dom_parity_helpers.js` (flat, like `eng_sticky_stack_helpers.js`; Playwright's default `testMatch` does not run it):

```js
const fs = require('node:fs');
const path = require('node:path');

// Opt-in DOM parity capture for behavior-preserving refactors. Set JEP_DOM_PARITY_DIR to a
// gitignored folder (for example tmp/dom-parity/before) to write one normalized HTML file per label.
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
        // outerHTML ignores properties set after mount; stamp them into attributes on a clone.
        const clone = root.cloneNode(true);
        const sources = root.querySelectorAll('input, select, textarea');
        clone.querySelectorAll('input, select, textarea').forEach((node, index) => {
            const source = sources[index];
            if (!source) return;
            if ('checked' in source) node.setAttribute('data-parity-checked', String(source.checked));
            if ('value' in source) node.setAttribute('data-parity-value', String(source.value));
        });
        return clone.outerHTML;
    });
    const normalized = html
        // React useId values (for example _r_3_) depend on hook order, which these refactors change.
        .replace(/_r_[0-9a-z]+_/g, '_r_#_')
        // The EPM Projects tab renders wall-clock fetch time (dashboard.jsx:1440, toLocaleTimeString).
        .replace(/fetched \d{1,2}:\d{2}(?:[\s\u202f]?[AP]M)?/gi, 'fetched HH:MM')
        .replace(/></g, '>\n<');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${label}.html`), `${normalized}\n`);
}

module.exports = { captureDomParity };
```

- [ ] In `tests/ui/settings_unified_save.spec.js` add `const { captureDomParity } = require('./dom_parity_helpers');` at the top and the opt-in test below. Top-level Settings tabs are `.group-modal-tab` buttons, but the nested sub-tab strips (Departments, Admin, EPM) use the same class, so the top-level locator is scoped by structure. `mockConfigSettings` already returns `userCanEditEpmConfig: true`, so the EPM tab renders; `sourceBundle: true` is required.

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

- [ ] Add `await captureDomParity(...)` lines (no-ops without the env var) **at the stated mid-test anchor**, not at the end of the test (several of these tests end with the dialog closed, which a capture would time out on). Pass `sourceBundle: true` in the `mockConfigSettings` call of the `settings_unified_save.spec.js` tests; the `mockFirstRunDashboard` tests already serve the source bundle.
  - `settings_unified_save.spec.js` `workspace conflict preserves later drafts and Keep mine rebases onto the server revision`: label `settings-workspace-conflict`, selector `[role="dialog"]`, immediately before `await banner.getByRole('button', { name: 'Keep mine' }).click();`.
  - `workspace auth expiry preserves the draft, Cancel confirmation, and safe re-auth path`: after the last assertion (the test ends on the sign-in lock, not on a Cancel confirmation): label `settings-auth-expired-lock`, selectors `.group-modal` and `[role="alertdialog"]` (two calls).
  - `Discard mine applies the server config and clears the dirty state`: label `settings-discard-mine`, selector `[role="dialog"]`, at the last assertion that shows the cleared dirty state while the dialog is still open (read the test; if it ends with the dialog closed, capture one assertion earlier).
  - `shared_department_groups.spec.js` `first-run department selection blocks group-scoped task loads until preferences are saved`: label `first-run-selection`, selector `[role="dialog"]`, after `await expect(page.getByText('Add at least one team or component before choosing this Department')).toBeVisible();` and before the `Continue` click.
  - `first-run saving locks every picker mutation and restores controls after failure`: label `first-run-saving-locked`, selector `[role="dialog"]`, after `await expect(picker.getByRole('button', { name: 'Add Department' })).toBeDisabled();` (the locked state, before the gate resolves).
  - `first-run Add Department opens the anchored configuration guide and Cancel restores the picker`: label `first-run-guide`, selector `.group-modal`, after `await expect(settingsDialog.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);` and before Cancel.
  - `first-run configuration guide target loss restores focus state and offers Return`: label `first-run-guide-target-loss`, selector `.first-run-configuration-guide`, after `await expect(guide.getByRole('button', { name: 'Return' })).toBeVisible();` and before the Return click.
- [ ] Add `delivery-owner-field/config` to the zero-request startup assertions in `tests/ui/codebase_structure_smoke.spec.js` next to the four field endpoints it already lists (lines 1243-1252).
- [ ] Determinism check: run the instrumented specs (section 6 command) twice on the unmodified tree into `tmp/dom-parity/run1` and `run2`; `diff -r` must print nothing. If it prints differences (timestamps, animation state), extend the normalization until it is empty. Do not continue with a nondeterministic capture.

**Validation scope:** none in the app; confirm the two-run diff is empty and the new assertions pass.

### Commit P0-3 (R2): Scenario coverage that does not exist today

Existing Scenario specs never render an edge, a lane mode, an epic bar, focus, or a tooltip: every fixture has `dependencies: []`, `scenario_focus_positions.spec.js` is entirely commented out, and nothing tests the group-switch restore that SC1 changes. Add the following; all pass on the unmodified source.

- [ ] In `tests/ui/scenario_draft_history.spec.js` (add the `domParity` require at the top). First give `installDashboardFromSource(page, options)` an `options.dependencies` array (default `[]`) used where it builds the `/api/scenario` response (the single `scenarioPayload()` return); edges use `{ from, to }` keys (`validateDependencies`, `scenarioUtils.js:77`). Then:

```js
test('dom parity capture: lane modes, edges, epic focus, tooltip, conflicts-only', async ({ page }) => {
    test.skip(!process.env.JEP_DOM_PARITY_DIR, 'opt-in refactor check');
    await installDashboardFromSource(page, { dependencies: [{ from: 'PROD-1', to: 'PROD-2' }] });
    await openScenario(page);
    const root = '.scenario-fullbleed';
    const laneButton = (name) => page.locator('.scenario-toggle-group').getByRole('button', { name, exact: true });

    // Team mode with All teams collapses every lane on first render (effect at dashboard.jsx:10759).
    const laneLabel = page.locator('.scenario-lane-label').first();
    await expect(laneLabel).toHaveAttribute('aria-expanded', 'false');
    await captureDomParity(page, 'scenario-team-collapsed-lanes', root);
    await laneLabel.click();
    await expect(laneLabel).toHaveAttribute('aria-expanded', 'true');
    // .scenario-edge renders only when scenarioEdgeRender.width > 0; confirm in a headed run that the PROD-1 to PROD-2 edge draws here.
    await expect(page.locator('.scenario-edge').first()).toBeAttached();
    await captureDomParity(page, 'scenario-team-expanded-lane-edges', root);

    // Epic summary bars exist only in Epic lane mode.
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
    await captureDomParity(page, 'scenario-assignee-lanes', root);
    await laneButton('Team').click();

    await page.locator('.scenario-bar').first().hover();
    await expect(page.locator('.scenario-tooltip.visible')).toBeVisible();
    await captureDomParity(page, 'scenario-tooltip', root);

    await page.getByRole('button', { name: 'Conflicts Only', exact: true }).click();
    await captureDomParity(page, 'scenario-conflicts-only', root);
});
```

Run the test headed once before the commit and confirm each state is on screen when it is captured (a collapsed lane in Team mode, `.scenario-epic-bar` elements in Epic mode, a visible tooltip); a test that passes only because a locator matched nothing is a defect. Add the same two-run determinism diff as in P0-2.
- [ ] In `tests/ui/scenario_draft_collaboration.spec.js` add `await captureDomParity(page, '<label>', '.scenario-fullbleed');` (no-op without the env var) after the last assertion of these existing tests: `presence strip renders remote user and polling stops after scope switch` (`scenario-presence`), `lock warning shows same-issue advisory conflict during drag` (`scenario-lock-warning`), `stale draftRevision shows recovery actions and keeps dirty local edits` (`scenario-conflict-recovery`), `write-back stays preview-only and blocked by the gate` (`scenario-writeback-preview`).
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

### Commit P0-5 (R2): Baselines

- [ ] Run the full Chromium `tests/ui` suite and record pass/fail/skip counts, wall time, and every pre-existing failure by name in section 1. Those failures are excluded from "must pass" later and listed in every PR description. Record the Node and Python suite results as well.

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

**Branch:** `improvement/scenario-planner-split`. **Files:** create the sub-hook files under `frontend/src/scenario/` (`useScenarioDraft.js`, `useScenarioRealtime.js`, `useScenarioDerived.js`, `useScenarioDrag.js`, `useScenarioHistory.js`, `useScenarioLayout.js`) and `scenarioLayout.js`; modify `useScenarioPlanner.js`, `scenarioLaneUtils.js`, the guards in section 7, docs. **Targeted specs:** the three Scenario specs and `codebase_structure_smoke.spec.js:1184-1310`. Start only after the operator says go. `dashboard.jsx` is not touched: `useScenarioPlanner` keeps returning the same flat object, so the call site, the budget, and the SC4 props are unaffected.

**Partition** (contiguous runs of the original order; the first review found zero provider-called-later edges and the dry run confirmed the edges H2→H1, H4→H1/H2/H3, H5→H1, H6→H3 with no cycle; each sub-hook is called in this order inside `useScenarioPlanner`): H1 draft (7262-7303, 7427-7679, 9143-9199 incl. `scenarioHasStoredDraftScope` and `scenarioActiveDraftId`, and `scenarioTeamIds` 8107-8112), H2 realtime (7305-7425, 7696-7747, 9200-9375), H3 derived memos (9137-9142, 9376-9628 incl. `scenarioIssueByKey`, and `matchesScenarioSearch` 5662-5677), H4 drag/edit mode (7681-7694, 7749-7794, 9629-9746), H5 history (9748-10350), H6 layout (10352-11601 incl. `scenarioVisibleExportIssues` 10685-10702, `areScenarioCollapsedLanesEqual`, `areScenarioEdgeRendersEqual`, `registerScenarioIssueRef` 5679-5686, and the `let scheduleScenarioEdgeUpdate` with its assignment). Each sub-hook returns an object literal.

**Pure extraction:** `frontend/src/scenario/scenarioLayout.js` receives only code with no DOM, ref, `performance`, or `console` reads. `scenarioLaneStacking` writes `perfCountersRef` and calls `performance.mark` (10559-10562) and `scenarioPositions` has a development-only `console.debug` (10893), so split the pure core from the instrumented wrapper (instrumentation stays in the hook). `computeScenarioEdgePaths` and anything using `scenarioIssueRefMap` or `getBoundingClientRect` stay in the hook. Extend `frontend/src/scenario/scenarioLaneUtils.js` and `tests/test_scenario_lane_utils.js` rather than creating a parallel module where the functions overlap. Oracle fixtures (synthetic) cover a single team, several teams, assignee mode, collapsed lanes, overlapping bars, and the empty case.

**Ladder:** R2 (oracle fixture data as JSON generated from the current functions, with no test that imports a new module), then one R4 per sub-hook in the order above, each creating the sub-hook, its unit tests (pure functions against the stored oracle outputs), and re-pointing the guards it breaks to `readOwnerSource(['frontend/src/scenario'])`, (each with parity, conservation with effect order `identical`, and the SM-S scope for the area it moves: H1 Run/Save/Discard, H2 two-browser presence or the named collaboration specs, H3 filters and search, H4 drag and undo, H5 History and rollback, H6 lanes, edges, focus, tooltip), then R5 (lint ceiling and ontology and status only: "no budget change", because `dashboard.jsx` is untouched). The `let scheduleScenarioEdgeUpdate` and its assignment stay together in H6; the layout effect deps array is unchanged.

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
2. **Hook map.** The PR description contains a generated map (hook, call-site line, inputs and their declaration lines), produced with the section 6 derivation procedure, plus an **effect-crossing table**: for every moved effect, the unmoved effects between its old and new position. Reordering relative to unmoved effects is allowed only when the table shows disjoint state and refs and no ordering reliance; otherwise choose a call position that keeps the order or split the hook at the effect. The dry runs counted crossings: ST3's 9 effects cross 32 unmoved ones; the Jira hook's 6 effects (4354, 4388, 4970, 4975, 5139, 5185) cross 31 with 4940-5033 included (4 cross 33 if that range stays in `App()`); the capacity hook's 2 cross 37; ST2's moved effects cross 13 to 15 depending on the call position (name it: 1362, the first ST2 statement); ST4 none at 1268. One concrete hazard is `fetchJiraFields` (5185) firing before the modal-open effect (2184). Playwright coverage for each crossing is named in the PR.
3. **Layering.** One hook per section when every input is available at its state lines; otherwise a state layer at the state lines plus a behavior layer where the inputs exist, both in one file. A remaining cycle is resolved with a getter closure, never a ref or latest-ref.
4. **Module-level names.** Non-exported module-level declarations used by moved code (`createEmptyEpmConfigDraft`, `DEFAULT_EPM_LABEL_PREFIX`, the `*_TAB_IDS` sets, `stableAcceptedConfigValue`, `getLabelRowKey`) move to a small module in `frontend/src/settings/` that both `dashboard.jsx` and the hook import, so there is one instance. A hook file cannot import from `dashboard.jsx` (circular). JSX-returning helpers (for example `renderEpmProjectSkeletonRows`, 1382) go to a `.jsx` file, because esbuild rejects JSX in `.js`.
5. Read `backend/security/CONFIGURATION_OWNERSHIP.md` first. Run the `docs/plans/GATE-*.md` sweep at the start of every slice (all PRs here are plan executions); `GATE-05` (Home write capability, next review 2026-10-05) is not a dependency because no slice adds a Home/Townsquare path.

**Ownership table (exclusive; base line numbers; re-locate by anchor).**

| PR | Owns |
| --- | --- |
| ST1 | Layer-0 hoists: `commitSharedConfigRevision` (4882-4886, depends only on 643-644, which stay in `App()` until ST5) and the `useSettingsConfigBaselineRevision()` call (806-809, no inputs) move up inside `App()` to just before 705. Priority weights: state 705-708, dirty memo 2731-2733, validation 2965-2984, load and mutators 4860-4880, 4900-4911, 4930-4938 (`updatePriorityWeightDraft`, `resetPriorityWeightsDraft`), `effectivePriorityWeightsRows` (consumed at 7885). Capacity mapping draft: state 766-774 and 777-780 (`capacityFieldSearch*`), dirty memo 2737-2740, functions 5051-5084, 5190-5260 (not the Planning capacity read at 982-997/12742-13005, not `PlanningTeamCapacityCards`/`updateCapacity` at 17248-17272, not `capacityEnabled` 982). Jira projects / source board / issue types / field catalog: state 709-717, 749-765, 775-776 (`jiraFields`, `loadingFields`), 804-805, 822-826, dirty memos 2727-2729, 2735, 2742-2744, functions 4326-4420, 4800-4858, 4888-4898 (`saveBoardConfig`), 4913-4928 (`clearBoardSelection` ends at 4928), 4940-5033 and 5035-5049 (`saveProjectSelection`) provided the gate shows no late inputs (otherwise they stay in `App()`), 5086-5188. The tab JSX in 17493-17687 (Connections and Admin bodies, including the large `JiraFieldSettings` spread) moves to stateless containers in `frontend/src/settings/`. |
| ST2 | EPM settings: state 489-518 and 522-540 (519-521 are the modal tab ids and belong to ST5), refs 1144-1148, handlers 1362-1892, 3106-3115, 3123-3134, 3136-3167 (`handleEpmSettingsTabKeyDown`), 14832-14835 (`setTrackedEpmSettingsProjectSort`), normalization and memos 2466-2608, dirty and saved scope 2746-2768, project rows 2849-2932, effects 1667-1699, 2235-2335, 2765, 2856-2879, JSX 17688-17777. Prep (R3): `getLabelRowKey` (5508) to a settings module. |
| ST3 | Team Groups / Labels / board layouts: state 605-617 (including the group read fences 613-615, so the `acceptedGroupsConfigRef` text pin moves with it), 626, 641, 652-680 except 656-657 and 678-679 (ST5), 718-736; `loadGroupsConfig` 2610-2657, `handleGroupDraftChange` and `loadTeamsFromCurrentView` 2659-2672, the `activeGroupDraftId` normalising effect 2337-2351, draft mutators and team search 3234-3611 except the app-update notice 3340-3353 (not Settings; stays), `applySavedGroupsConfig` 3612-3625, debounced searches 4423-4569, `handleComponentSearchKeyDown` 4570-4593, epic helpers 4594-4798, export/import 5262-5345, team directory memos 5347-5380, `filteredGroupDrafts` 5449, team-results block 5464-5487, label search 5510-5660 (5508 `getLabelRowKey` is ST2's hoist); the `useGroupVisibilityPreferences` call statement (1231-1267) and `applyPreferenceGroupsSnapshot` (1218-1228) (the hook's inputs and outputs feed Team Groups both ways, so the Team Groups behavior layer calls it at that position); dirty and validation 2710-2725 (`groupDraftSignature`, `isGroupBoardDraftDirty`); JSX 17778-18122 (the department-tabs conditional: tab strip 17778-17815, `TeamGroupsSettings` 17816-17934, Labels tab 17935-18092, `GroupBoardsTab` 18093-18120, and its closing `</>` and `)}` at 18121-18122), group-board props 14926-14942 and `const random = Math.random` (14943, a `GroupBoardsTab` prop). **Not ST3:** the aggregates `isGroupDraftDirty` (2945) and `groupConfigValidationErrors` (2987), which read `isEpmConfigDirty`, `isSharedConfigurationDraftDirty`, `shouldValidateAdminSettings`, and `priorityWeightsValidationError` and belong to ST5's aggregates layer. |
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
| R2 | Playwright test: dirty `priorityWeights`, `board`, `capacity`, and `issueTypes` together and assert the recorded request sequence (method and path, ignoring `/api/auth/csrf`) equals the section 4 order, each with `baseRevision`; the key-parity test across the save map (3630-3642), the capture object (1284-1296), the restore function (4194-4226), `FIRST_RUN_ADMIN_SECTION_KEYS`, and the 10-key snapshot (810-821), reading through `readOwnerSource` with an anchor on each location (those locations move in ST4 and ST5, where the test is re-pointed). | Review the diff. |
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

**Design.** State layer at 605 (dry run: 0 inputs, 95 outputs); behavior layer at the position of the `useGroupVisibilityPreferences` statement (1231), which it calls internally (103 inputs). The two late inputs are resolved as `teamOptions` (7938) through a getter closure (`() => teamOptions`) feeding `loadTeamsFromCurrentView`, and `getLabelRowKey` (5508) through ST2's hoist. The dry run: 0 gate errors **provided** the aggregates 2945 and 2987 are not moved here (4 errors otherwise). Move `labelSearch*` ownership here and update `useEpmSettings` to read it from this hook. Group JSON export/import stays selected-group scoped. Team label aliases (up to three per Team) behave exactly as before.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Dead code (above). | SM-T, Departments tab. |
| R2 | Playwright assertions for group switch / favorite / visibility if missing; oracle fixture data (JSON generated from the current functions) for any pure group helper that will move, with the unit tests written in the R4 that creates the module. | Review the diff. |
| R4a | State layer + behavior layer (without JSX). | Departments: create, rename, duplicate, delete a group; add/remove a Team; edit up to three label aliases for a Team; star a group; Save; reload persisted. |
| R4b | Departments panel containers incl. the Labels tab and Boards tab (+ probe). | Departments sub-tabs, Group labels (when enabled), Boards layout edit; export and import the active group only. |
| R5 | Ledger tail (`test_analytics_source_guards.js:500-504`, the `acceptedGroupsConfigRef` pins in the three Board guards, `test_epm_settings_source_guards.js:157-158,:753`, `test_team_catalog_lifecycle_source_guards.js` are re-pointed inside R4), budget, ontology, status. | Review the diff. |

### ST4: First-run configuration

**Branch:** `improvement/settings-first-run-hook`. Targeted specs: `tests/ui/onboarding_tour.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`.

**Design (dry run).** Two layers: the state layer at 629 (0 inputs) and the handlers layer at 1268 (49 inputs). The handlers layer has two late inputs: `saveAllSettings` (4184) and `closeGroupManage` (2679, used at 5418 and 5435): give both getters (`() => saveAllSettings`, `() => closeGroupManage`) and call the layer at 1268, where its one effect (1343) crosses no unmoved effect; calling it at 5382 instead would make that effect cross 36 and is not allowed. The dry run had 0 gate errors with the getters. A verbatim `useCallback` (`retryFirstRunConfiguration`, 5421) keeps its dependency array unchanged. First-run keeps its committed-section tracking, `settingsSaveInFlightRef` (ST5's until then), the `rebaseOnto` flow, the "save shared groups first, then EPM, then the private favorite, then continue" order, and the rule that create/duplicate marks the new draft as the pending favorite and visible group without presenting `defaultGroupId` as the user's favorite. Delete the declaration-order slices in `tests/test_first_run_group_configuration.js` and keep its reducer tests and the section-coverage test.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R4a | `useFirstRunConfiguration` (state layer + handlers layer). | First-run user (empty preferences): group-selection popup, setup choice, configuration guide; create a group, Save, favorite persisted, dashboard continues; retry after a failed save. |
| R4b | First-run JSX container (18125-18149). | The same flow visually; the tour still launches from the gear. |
| R5 | Ledger tail (`test_first_run_group_configuration.js`, `test_analytics_source_guards.js` are re-pointed inside R4), budget, ontology, status. | Review the diff. |

### ST5 (gate G2): Shared-config bootstrap, save, permissions, and modal shell

**Entry gate.** Do not start until the operator approves G2. Rung R0 is a docs-only commit (an operator stop) that appends a design note here, before any code, comparing two candidate interfaces for the save orchestrator (design it twice): (a) a table-driven sequence of `{ id, isDirty, save }` records in the section 4 order, preserving both commit conventions, with `adminAccess.save()` as a fixed sequential step between `issueTypes` and the groups POST (only its grant requests are parallel); (b) keep `saveGroupsConfig` imperative and move it intact into a hook that receives the section hooks. Choose one with reasons. The note must also use this layering data (from the AST dry run):

- Modal state (519-521, 625, 656-657, 678-679, 682) has 0 inputs and `adminAccess` (696) reads it, so it is a state layer called by 519. The cells 642-651 (`sharedConfigRevisionRef`, `settingsDraftSnapshotRef`, board fences) are inputs of every ST1 hook and need a state layer before 705.
- Permissions' first output reader is `adminSettingsGate` at 949; its `openSettings: tab => openGroupManage(tab)` stays an arrow created in `App()` (passing `openGroupManage` at 2674 directly is a TDZ).
- The modal functions need `saveAllSettings` (getter) and `isGroupDraftDirty` (2945); their first output reader is `closeGroupManage` at 3074, so their call lies in the window (2945, 3056].
- The hotkey effect (4287-4324) reads `saveAllSettings` and `requestCloseGroupManage` in its dependency array at render time (4324). A getter cannot serve there (a render-phase call is a TDZ error that neither lint rule sees), so that effect goes in a separate effects layer called after the orchestrator (between 4184 and 4287); effects 2175, 5488, and 5500 and the modal functions may use the early layer. Give those four effects an effect-crossing table and a Playwright check of Cmd+S and Escape.
- The save orchestrator needs `closeGroupManage` (2679, declared before it, so no getter), `loadConfig` (6760), `loadSprints` (7123), and `activeDepartmentSettingsTab` (14788, which needs hoisting). The aggregates, the modal functions, and the orchestrator form a three-way cycle, so the aggregates (2934-3041) get their own layer first.

**Files:** create `frontend/src/settings/useSettingsPermissions.js`, `useSharedConfigSave.js`, `useSettingsModalState.js`, `SettingsModalContainer.jsx`. Targeted specs: `settings_unified_save`, `settings_admin_access`, `unconfigured_workspace_gate`, `global_auth_lock`, `server_unavailable_ui`, `load_performance`, `codebase_structure_smoke`.

**Design points.** `useSettingsPermissions` exposes `applyBootstrapPermissions(config)` and `applySavePermissions(config)` (the second omits `setUserIsToolAdmin`, `setPerformanceAdminAvailable`, `setJiraUrl`, `setGroupQueryTemplateEnabled`); defaults `false`/`false`/`true`; values set only with `=== true` (and `Boolean(config.settingsAdminOnly)`, see D11). The write at 6819 stays where it is. `loadConfig` also writes non-Settings state (`setJiraUrl`, `setAuthMode`, `setBoardAllWorkAvailable`, `performanceGate.resolve`, auth-resume and recovery refs, the sprint catalog controller): extract only the Settings statements behind one named call such as `settings.applyBootstrap(config, preserve)` and leave the other writes where they are. `loadConfig` is also called from `retryBoardScopeConfiguration` (14873) and `useLatestWorkspaceConfig` (4283); keep each call site's closure semantics (section 4). Both `loadConfig` and `loadGroupsConfig` failure paths must still resolve `adminSettingsGate` (6957) and `groupsLoading`. Payload scope: each admin section is gated by `canEditSharedConfiguration && isXDirty && !skip`; every workspace-config POST carries `baseRevision` from `sharedConfigRevisionRef`; groups post via `buildSharedGroupsPayload`; personal preferences post separately; the footer Save persists all dirty editable sections together without mixing fields across endpoints.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R0 | Design note appended to this section (docs only; includes the layering data above). | Review the note; approve the chosen interface. |
| R1 | Dead code (above). | SM-T. |
| R2 | Full-order Playwright test: with every workspace section dirty, the recorded sequence (method and path, ignoring `/api/auth/csrf`) equals the section 4 order including the `adminAccess` grant requests as a fixed step between `issueTypes` and `POST /api/groups-config`; a fallback-path fixture (no `sharedConfig`) startup test; the permissions unit tests are written in R4a with `useSettingsPermissions`. | Review the diff. |
| R4a | `useSettingsPermissions` and its unit tests (`true`, `'true'`, `1`, `undefined`, `null`, missing key; a missing `settingsAdminOnly`, labelled a known deviation per D11). | Sign in as a non-admin, an editor, and a tool admin: tab visibility and read-only state; Access tab states. Where an account is not available, the commit report names the Playwright test (`settings_admin_access.spec.js`) that covers that scope instead. |
| R4b | `useSharedConfigSave` per the approved interface. | Edit several sections, Save: order and conflict handling; the forced 409 and expired-auth cases are covered by the named Playwright tests, and you confirm the draft is preserved with the recovery actions and no replay. |
| R4c | `useSettingsModalState` and `SettingsModalContainer.jsx`. | Open from gear/hotkey/Board call-to-action; tab keyboard navigation; discard prompt; first-run still works; auth-resume reopens the same tab. |
| R5 | Ledger tail (`test_epm_settings_source_guards.js` fail-closed pins become unit assertions, `test_planning_action_source_guards.js:278`, `test_first_run_group_configuration.js:544-573`, `test_frontend_api_source_guards.js:11-17,:1204`, `test_onboarding_tour_utils.js`, `test_eng_board_*` `acceptedBoardConfigRef` pins are re-pointed inside R4), budget, ontology, status. | Review the diff. |

---

## 12. Execution status

Updated in each R5 commit (root `AGENTS.md` section 4: the plan must match the result). "Awaiting operator go" is a gate, not a document gate.

| PR | Slice | Status | `dashboard.jsx` lines after | Budget after | PR | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| PR-1 | Land the plan | Ready to publish after the single revision-3 commit | n/a | 18,213 | | third check complete |
| PR0 | Tooling, coverage, baselines | Not started | n/a | 18,213 | | UI baseline pending |
| SC1 | Scenario state container and seam | Not started | | | | |
| SC2 | Single Scenario hook | Not started | | | | |
| SC3 | Split the Scenario hook (G1) | Awaiting operator go | | | | |
| SC4 | Scenario view component | Not started | | | | |
| ST1 | Shared-config section hooks | Not started | | | | |
| ST2 | EPM settings | Not started | | | | |
| ST3 | Team Groups and Labels | Not started | | | | |
| ST4 | First-run configuration | Not started | | | | |
| ST5 | Shared-config save, permissions, shell (G2) | Awaiting operator go | | | | |

## 13. Program acceptance

- Every PR merged in order; `dashboard.jsx` lower and its budget ratcheted in each slice that changes it (PR-1, PR0, and SC3 do not change it); the lint ceiling never raised.
- Estimated end state (replace with measured values): SC1 + SC2 were measured at about -3,070 lines in the dry run; the two clusters total about 8,000 lines of the 18,203, and `App()` keeps call sites, destructuring, and glue, so the realistic end size is about 11,000 plus or minus 1,000 lines. If the measured size after ST4 is above that range, report it to the operator before ST5.
- No route, payload, startup-count, sticky-order, analytics, or visual change; DOM parity diff empty in every R1/R3/R4 commit; the conservation residual itemised in every R4 commit message; the full Chromium `tests/ui` run passes (modulo the baseline failures recorded in PR0) before every push.
- Docs: `FUTURE-codebase-operability-improvements.md` and `docs/plans/README.md` aligned; `docs/ontology.md` has "Scenario Planner ownership" and "Settings state ownership" entries and every existing entry that cites `dashboard.jsx` ownership (Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, Board scope load authority, Startup config timeout) points at the new owner files, with verification dates and resolving paths.
- On completion rename this file to `DONE-dashboard-scenario-settings-state-extraction.md` with the status note naming the PRs, per `docs/plans/AGENTS.md`.

## 14. Estimate, risks, and review log

- **Effort.** `FUTURE-codebase-operability-improvements.md` estimates 5-8 days (Scenario) and 4-7 days (Settings). This plan has 11 PRs and 49 commit stops (41 without SC3: PR0 6, SC1 3, SC2 2, SC3 8, SC4 2, ST1 7, ST2 6, ST3 5, ST4 3, ST5 7 including the design note) plus one publication go per PR after PR-1 (D8); non-source commits (R2, R5, R0) stop for a one-line confirmation. With same-day operator turnaround and no rebases, three to four weeks; with the feature-work churn on `dashboard.jsx` (22 commits since 2026-09-01), plan on five to six.
- **Largest risks.** Drift and rebase breaking validated commits (mitigated by the section 5 protocol and textual anchors); validation that is skipped or falsely green (mitigated by named Playwright tests, `sourceBundle: true`, and the dist hash); a silent non-verbatim edit or an `undefined` prop (mitigated by `check_move_conservation.mjs` and the checker's parameter and prop parity); effect reordering in Settings (mitigated by the effect-crossing table); a guard that goes vacuous (mitigated by `readOwnerSource` anchors). Each PR is revertable; there is no data migration.
- **Review log.** Draft 1 (commit `Add first draft of ...`) was reviewed by four independent reviewers on 2026-10-01 and found not executable (hook cycles and ordering, range ownership, weak lint gate, guard table errors, thin coverage). Revision 2 (commit `Revise ... after independent review`) was reviewed by four fresh reviewers: Scenario and Settings halves READY WITH FIXES (dry runs on scratch copies passed for SC1, SC2, ST1, ST2; ST3 and ST4 after range fixes), tooling and cold-read NOT READY with mechanical fixes. Revision 3 applies those fixes: the single-hook Scenario design verified by dry run; the corrected checker (spread returns informational, `loc`, parameter and prop parity, alias following, owner-directory enforcement relative to the source root), the React-scope lint rules, the conservation script, the negative controls and `run.sh` combining both stages (all executed on a scratch copy of the unmodified tree: gate exit 0 with 0 errors and 119 warnings, seven of seven seeded defects caught); the ladder reordering (tests of new modules and guard re-points inside R4; R5 for ratchets and docs only; R6 publish); the failed-validation, push, and drift protocols; executable smoke scopes; the corrected Scenario coverage (epic bars only in Epic mode; lanes collapsed by default in Team mode); the Settings ownership corrections and layer data; the `adminAccess` ordering; the `setPerformanceAdminAvailable` position; the D11 deviation record; the full publication transaction for PR-1; and the operator's decisions on dead code, gates, and commit-gated execution. A targeted third check of revision 3 (tooling executed as printed and PR0 test code traced; Scenario table and process coherence; Settings ownership and layering with a cumulative ST1-ST4 dry run) found no Blocker and no P1; its P2 and Minor findings are folded into this revision (SC4 guard re-pointing, SC3 fields, R2 rule, quirk-pin scope, JSX tail ownership, ST5 hotkey-effect layering, ledger timing, capture anchors, tooling fixes). The plan stays `Proposed` until the operator approves it, including D12 and the gates.
