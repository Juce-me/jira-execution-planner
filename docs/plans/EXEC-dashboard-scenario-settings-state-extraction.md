# Dashboard Scenario And Settings State Extraction Implementation Plan

> **Status:** Proposed (not started). Written 2026-10-01 against base `89ffe589`. Not executable until the open decisions in section 3 are answered by the operator. Supersedes the "Extract Scenario Planner ownership" and "Move settings state/actions behind feature hooks" rows of `FUTURE-codebase-operability-improvements.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute one PR section at a time, strictly in order. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the Scenario Planner and Settings state, effects, handlers, and JSX out of the single `App()` function in `frontend/src/dashboard.jsx` into feature-owned hooks and container components, with no user-visible or contract change, lowering the `dashboard.jsx` line budget in every PR.

**Architecture:** Each feature gets a two-layer hook pair. A state container hook is called early in `App()`, owns every `useState`/`useRef` cell of the feature, has no effects, and takes no inputs from later code. One or more behavior hooks are called later, receive explicit inputs (including the container), and own the effects, memos, and handlers. Pure computation moves to plain modules with Node unit tests. JSX moves to container components that receive one `scenario`/`settings` object instead of a prop sink. Hooks stay called unconditionally from `App()` because dirty drafts and mount effects must survive mode switches.

**Tech Stack:** React 19, esbuild, Node 20 (`node --test`), Python `unittest`, Playwright (Chromium; headed Firefox/WebKit only where a slice touches glyph or form-control geometry).

---

## 1. Evidence (measured 2026-10-01 at `89ffe589`)

| Fact | Value |
| --- | --- |
| `frontend/src/dashboard.jsx` | 18,203 lines, 1,089,792 bytes |
| `App()` span | lines 370-18199 (`return` starts at 15024) |
| Hooks inside `App()` | 318 `useState`, 136 `useEffect`, 281 `useMemo`, 58 `useCallback`, 150 `useRef` |
| Other frontend source | 193 files, 38,133 lines (already extracted) |
| Budget | `tests/test_codebase_structure_budgets.py` caps `dashboard.jsx` at 18,213 |
| Growth | 15,022 lines on 2026-05-28; 104 commits touched the file since 2026-06-01 |
| Scenario cluster | 29 `useState`, 27 `useRef`, 57 `useMemo`, 19 effects; code ranges 7262-7794 and 9137-11601; JSX 16338-17214 (about 4,070 lines incl. mirrors) |
| Settings cluster | about 140 `useState`, 40 `useRef`, 32 `useEffect`, 45 `useMemo`; code 2466-5660 plus 489-540 and 605-827; JSX 17457-18166 (about 4,175 lines) |
| Python baseline | `Ran 2006 tests ... OK (skipped=25)` with the explicit env in section 6 |
| Node baseline | `node --test tests/test_*.js`: 1529 pass, 0 fail |
| Ad hoc `no-undef` lint baseline | 3 errors, all `'process' is not defined` at lines 10893, 11327, 11353 (esbuild defines `process.env.NODE_ENV`) |
| Full `tests/ui` Chromium baseline | recorded in PR0 (not yet measured) |

Line numbers below are as of `89ffe589`. They drift after every merge: always re-locate by symbol with `rg -n 'symbolName' frontend/src/dashboard.jsx` before editing. The inventories behind these numbers were produced by read-only repository scans on 2026-10-01; the executor re-verifies each range while performing the move.

Prior extraction slices (`DONE-codebase-operability-*`) moved presentational components and pure helpers. None moved `App()` state. This plan is the first to move state, which is why it adds the container/behavior split, the DOM parity check, and the undeclared-identifier check.

## 2. Scope

In scope:
- Scenario Planner: state, draft lifecycle and history, presence/locks/realtime, drag/undo, layout/lanes/edges/focus/tooltips, and the Scenario JSX.
- Settings: priority weights, Capacity mapping, Jira projects/source board/issue types/field configs, EPM settings, Team Groups/Labels/board layouts, first-run flow, permissions, shared-config bootstrap and sequential save, modal shell and tab state, and the Settings JSX.
- Tests that read `dashboard.jsx` as text for these clusters (replaced or re-pointed, section 5).
- `docs/ontology.md`, `docs/plans/README.md`, and `FUTURE-codebase-operability-improvements.md` alignment.

Out of scope: ENG Catch Up/Planning/Stats/EPM/Board state, backend, CSS, route or payload contracts, sticky offsets and z-index, new dependencies, analytics events, and any visual change.

## 3. Decisions

Settled by design (reasons in the sections that use them):

- **D1 Two-layer hooks.** `App()` reads Scenario state at about line 5975 (per-group snapshot) while behavior inputs such as `teamOptions` exist only at 7938. A single hook cannot be called at both points. The state container (no inputs, no effects) is called first; behavior hooks are called after their inputs exist.
- **D2 Always mounted.** Hooks are called unconditionally from `App()`. A container rendered only in Scenario mode would unmount dirty drafts that the connection-recovery snapshot reads (14440-14459). JSX containers (`ScenarioView`) may stay conditional because they own no state.
- **D3 Strictly sequential PRs, each merged before the next starts.** `FUTURE-codebase-operability-improvements.md` forbids parallel slices touching `dashboard.jsx`. While an `SC*`/`ST*` PR is open, no other PR may touch the same cluster.
- **D4 Quirks move verbatim.** Section 4 lists intentional or latent quirks (for example the `let scheduleScenarioEdgeUpdate` dependency that is always `undefined`). They are preserved, not fixed, in this program.
- **D5 No new test dependency.** The repo has no jsdom or React renderer, so Node tests can server-render a probe (no effects). Behavior of effect-heavy code is proven by the existing Playwright specs plus the DOM parity check. Adding jsdom would be a new dependency and needs a separate decision.

Open, need the operator's answer before PR0 starts:

- **OD1 Dead declarations.** The inventories found never-read declarations: Scenario `scenarioBottleneckLanes`, `scenarioDeadlineLeft`, `scenarioHasAssignees`, `scenarioIsSingleTeamFocus`, `scenarioUnschedulable`, the `scenarioDraftEvents` value; Settings `groupQueryTemplateEnabled` (read nowhere; set at 681 and 6864), `fetchJiraBoards`/`jiraBoards`/`loadingBoards` (751-752, 4340), `hasDraftEpmScope` (2849), `lastCommittedWorkspaceSectionsRef` (write-only), and the unused `setShowGroupManage`/`setGroupManageTab`/`setDepartmentSettingsTab` arguments passed to `useGroupVisibilityPreferences`. Recommendation: delete each in the first commit of the PR that moves its cluster (zero behavior change, proven by build, lint, and tests). Default if not approved: move them verbatim, unchanged. Root `AGENTS.md` section 3 says not to delete pre-existing dead code unless asked, so this needs an explicit yes.
- **OD2 Go/no-go before ST6.** ST6 (shared-config bootstrap, sequential save, modal shell) is the highest-risk slice. Recommendation: review ST1-ST5 results and the measured `dashboard.jsx` size before approving ST6.
- **OD3 Merge cadence.** Each PR is reviewed and merged by the operator before the next branch is cut. Confirm this, or state the alternative.

## 4. Preserved quirks and invariants

Every PR re-checks the rows that apply to it.

| Area | Invariant | Where it bites |
| --- | --- | --- |
| Scenario layout | `let scheduleScenarioEdgeUpdate;` (1081) is assigned at 11483 and sits in the layout effect's deps (10884), so that dependency is always `undefined`. Declaring it with `useCallback` would add re-runs and layout reads. | SC5: keep the `let` and its assignment in the same hook body. It must not move into the state container. |
| Scenario closures | Drag effect (deps `[scenarioDraggingIssueKey]`) captures `releaseScenarioIssueLock` and draft ids at drag start; poll and SSE effects re-subscribe on every cursor advance; `scenarioIssuesByLane` omits `scenarioLaneForIssue` from deps; render-phase ref writes at 9187-9188 and 9478. | SC2-SC5: preserve deps arrays and render-phase writes exactly. |
| Scenario mount | Hook must be always mounted; `loadUiPrefs()` forces `showScenario=false` on load; the cluster fires no request on mount (7860 effect returns when `configRefreshNonce === 0`); startup counts `POST /api/scenario === 0`. | Every SC PR. |
| Scenario auth | Poll (9254), heartbeat (9304), SSE (9327-9366), and the three keydown handlers (9742, 10011, 11597) check `readPendingAuthenticationRequired()` or listen on `AUTH_REQUIRED_EVENT`. `window.SCENARIO_DRAFT_SSE_ENABLED` gates SSE. | SC2-SC5. |
| Scenario sticky | `--sticky-scenario-z: 60` (`frontend/src/styles/shared/shell.css:30`) used by `.scenario-axis` and `.scenario-tooltip`; `.scenario-fullbleed` must stay a direct child of `.container` with no wrapper DOM. | SC6. |
| Scenario perf | `perfCountersRef` is written at 10560, 10812, 10840, 11262, 11487, 11496 and read by the perf interval at 2356-2368. | SC5: pass the ref in as an input. |
| Settings mount | The mount effect at 2136 (`loadConfig()` + `loadGroupsConfig()`) stays in always-mounted `App()` with its first-render closure until ST6. No `StrictMode`. The `[showGroupManage]` open effect at 2184 deliberately snapshots values at open time; its deps do not change. | ST4, ST6. |
| Settings draft snapshot | `settingsDraftSnapshotRef.current` is assigned during render at 810-821 and spans S3-S5 drafts. It stays a render-time assignment in `App()`; extracted hooks return a plain `draftSnapshot` value that `App()` composes. | ST1, ST2. |
| Settings save order | Admin sections save sequentially in this order: `projects`, `priorityWeights`, `board`, `capacity`, `sprintField`, `parentNameField`, `storyPointsField`, `teamField`, `deliveryOwnerField`, `issueTypes`, `adminAccess`; then groups (`POST /api/groups-config`, with `baseRevision`/`configRevision`); then personal preferences; EPM saves independently of every shared revision. Field-config saves use the `commitSharedConfigRevision(await saveXFieldConfig(sharedConfigRevisionRef.current))` convention; the others commit internally. | ST1, ST2, ST6. |
| Settings read fences | `boardConfigReadGenerationRef`, `boardConfigSaveReadFenceRef`, `groupsReadGenerationRef`, `groupsSaveReadFenceRef`, `settingsSaveReadFenceSequenceRef`, `sharedConfigRevisionRef` are shared by `loadConfig`, `loadGroupsConfig`, and `saveGroupsConfig`. | ST6 only; earlier PRs pass them through unchanged. |
| Settings post-save asymmetry | The post-save refresh (3882-3897) updates a different flag subset than bootstrap: it omits `setUserIsToolAdmin`, `setPerformanceAdminAvailable`, `setJiraUrl`, `setGroupQueryTemplateEnabled`. Preserve it. | ST6. |
| Settings ownership | `userCanEditSettings`/`userCanEditEpmConfig` default `false` and are set only with `=== true`; `settingsAdminOnly` defaults `true`; admin tabs need `canEditSharedConfiguration`, the EPM tab needs `canEditEpmConfiguration`; Access tab only for tool admins; 409 keeps the user's draft; 401 delegates to the global auth gate and is never replayed. Read `backend/security/CONFIGURATION_OWNERSHIP.md` before every ST PR. | ST1-ST6. |
| Settings lazy fetch | `useAdminAccessSettings` stays gated on `available && active`; the team lifecycle stays gated on the modal being open; nothing in S3-S6 may fetch before the modal opens. | ST2-ST6. |
| Startup | `tests/ui/codebase_structure_smoke.spec.js:1245-1262`: exactly one each of `GET /api/config`, `/api/version`, `/api/groups-config`, `/api/sprints`; zero for `projects/selected`, `board-config`, `capacity/config`, `priority-weights-config`, the five field configs, `issue-types/config`, `/api/teams`, `/api/teams/all`. | Every PR. |

## 5. Test strategy and source-guard disposition

Three layers, in this order of preference:

1. **Pure functions with Node unit tests.** Where moved code has no DOM or ref reads, extract it as a plain function with explicit inputs. Capture expected outputs from the legacy implementation on synthetic fixtures *before* the move (copy the body into a throwaway oracle script, run it on the fixtures, store the outputs as JSON next to the test), then assert the new function against the stored outputs. Fixtures are synthetic or sanitized; never real Jira data.
2. **Server-render probes** (`renderToStaticMarkup` with a probe component, as in `tests/test_eng_mode_state.js`) for hook defaults and fail-closed values. Server rendering does not run effects.
3. **Existing Playwright specs plus the DOM parity check** for effect-heavy behavior (polling, SSE, locks, drag, save sequencing). The specs bundle `dashboard.jsx` with esbuild and follow imports, so they keep working when code moves.

**Guard rule.** A source-text guard may be kept only if it pins a non-obvious invariant that no behavioral test exercises; keep it, re-pointed at the new owner file. Guards that only pin declaration order, JSX order, or file location are deleted in the PR that moves the code, and the PR description names the behavioral test that covers the behavior.

| Guard file | Pins | Disposition |
| --- | --- | --- |
| `tests/test_scenario_draft_history_source_guards.js` (15 tests) | poll `setInterval(poll, 5000)`, `SCENARIO_PRESENCE_TTL_MS = 30000`, drag effect deps, literals, declaration and JSX order | SC2-SC6: keep and re-point the three invariant pins; delete order/shape guards, naming `tests/ui/scenario_draft_history.spec.js` and `tests/ui/scenario_draft_collaboration.spec.js` tests as cover. The "dist changes require src changes" test stays untouched. |
| `tests/test_auth_isolation_source_guard.js` | exactly six `window.addEventListener('keydown', X)` calls, each checking `readPendingAuthenticationRequired()` before the first `event.key` | PR0: widen to scan `dashboard.jsx` plus every file under `frontend/src/scenario/` and `frontend/src/settings/`; the total stays six. Permanent. |
| `tests/test_frontend_api_source_guards.js` | `from './api/scenarioApi.js'`, `configApi.js`, `jiraCatalogApi.js` imports in `dashboard.jsx`; no `fetch(` or `/api/` literal outside `frontend/src/api/` (lines 196-217); `sprintCatalogControllerRef.current.invalidate('settings-save')` placement | Re-point import checks to the new owner files; keep the repo-wide no-`fetch(`/no-`/api/` scan unchanged (new hooks must contain neither). |
| `tests/test_excluded_capacity_stats_source_guards.js:841-855` | `buildScenarioPayload` regex assumes 12-space indent | SC2: re-point to the new owner and make the regex indentation-agnostic. |
| `tests/test_epm_settings_source_guards.js` | `<SettingsModal` prop spreads vs child props, exact declaration strings, hotkey effect order, fail-closed flag assignments | ST3/ST6: replace with the Playwright EPM specs plus a server-render probe of the new container; keep fail-closed defaults as unit assertions on the permissions hook. |
| `tests/test_first_run_group_configuration.js` | declaration-order slices (`captureFirstRunSettingsDrafts` before `configureFirstRunGroup`, and similar) | ST5: delete order slices; reducer tests in the same file stay; cover with `tests/ui/onboarding_tour.spec.js`. |
| `tests/test_team_catalog_lifecycle_source_guards.js`, `tests/test_analytics_source_guards.js`, `tests/test_onboarding_tour_utils.js`, `tests/test_epm_view_source_guards.js` | hook-call text, slice bans, regexes | Update only the ones whose text actually moves; re-point to the new owner. |
| `tests/test_planning_action_source_guards.js:278` | exactly two `setCapacityEnabled(Boolean(...capacityConfigRequiresResolution...))` matches in `dashboard.jsx` | Unchanged: `capacityEnabled` is a bootstrap output that stays in `App()`/`loadConfig` until ST6. |
| `tests/test_eng_board_runtime_source_guards.js`, `tests/test_strict_eng_board_integration.js`, `tests/test_eng_board_source_guards.py`, `tests/test_epm_shell_source_guards.js:60`, `tests/test_dashboard_alert_source_guards.js:88` | text that stays in `dashboard.jsx` (`acceptedBoardConfigRef.current = false;`, `selectedView === 'eng' && showScenario`, ...) | Must keep passing unmodified. If one fails, the move took text it should not have. |
| `tests/test_codebase_structure_budgets.py` | line ceiling | Lowered to the measured count in every PR. |

## 6. Slice Protocol (applies to every PR below)

Verification environment. Python needs explicit overrides so a symlinked real `.env` cannot leak in; in a git worktree without `.venv`, point at the main checkout's interpreter. Node uses the pinned runtime.

```bash
# Node unit tests
fnm exec --using 20 node --test tests/test_*.js

# Python suite (baseline: 2006 tests, OK, skipped=25)
JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local \
ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' \
.venv/bin/python -m unittest discover -s tests

# Build (run `npm ci` first in a fresh worktree) and generated-output cleanliness
fnm exec --using 20 npm run build
make verify-dist-clean

# Full UI gate before any push (about 8 minutes). In a worktree without .venv set JEP_TEST_PYTHON.
npx playwright test tests/ui --browser=chromium --workers=4
```

Undeclared-identifier check. esbuild does not report an identifier that was left behind when code moved; it fails only at runtime on the path that uses it. The check below needs no repo dependency. Install the tool once in a scratch directory outside the repo (`npm install eslint@9 globals` there), write the config below to that directory as `eslint.config.mjs`, and run it:

```js
import globals from 'globals';

export default [
    {
        files: ['**/*.{js,jsx,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser },
        },
        rules: { 'no-undef': 'error' },
    },
];
```

```bash
fnm exec --using 20 "$LINT_DIR/node_modules/.bin/eslint" --no-config-lookup -c "$LINT_DIR/eslint.config.mjs" \
  frontend/src/dashboard.jsx frontend/src/scenario frontend/src/settings
```

Expected: only the `'process' is not defined` hits (3 at base; they move with their code). Any other `no-undef` is a missed name and blocks the PR.

Per-PR steps (each PR section lists only what is specific):

- [ ] **Step 1: Preflight.** `git fetch origin main`; the previous PR is merged; cut `improvement/<slice-name>` from the latest `origin/main`; `git branch --show-current` shows a descriptive name (no `claude/`/`cld/` prefix). Read root `AGENTS.md`, `docs/plans/AGENTS.md`, this plan's section for the slice, the relevant `docs/ontology.md` entries, and for ST PRs `backend/security/CONFIGURATION_OWNERSHIP.md`. For ST3 and ST6 (EPM and auth surfaces) run the `docs/plans/GATE-*.md` sweep; `GATE-05` (Home write capability) is not a dependency of any slice here because none adds a Home/Townsquare path.
- [ ] **Step 2: Re-locate and record the baseline.** Re-find every symbol in the PR section with `rg -n`. Record `wc -l frontend/src/dashboard.jsx`. Run the lint check and the targeted specs listed in the PR section; all must pass before any edit. Run the DOM parity capture to `tmp/dom-parity/before` (PR0 defines it): `JEP_DOM_PARITY_DIR=tmp/dom-parity/before npx playwright test tests/ui/<spec> --browser=chromium -g 'dom parity'`.
- [ ] **Step 3: Characterize.** Write the new Node tests first (pure-function oracle fixtures, server-render probes). Commit them; they pass against the unchanged code where they target legacy behavior, and fail on the missing module where they target the new file.
- [ ] **Step 4: Move verbatim.** Cut the listed ranges into the new files. The only permitted edits are imports, turning free variables into explicit parameters, and a return object. No logic, formatting, comment, or dependency-array change. Commit the move separately.
- [ ] **Step 5: Interface by reference scan.** For every name declared inside a moved range, run `rg -n '\bNAME\b' frontend/src/dashboard.jsx` outside that range. The hook returns exactly the names with a hit. Record the scan result in the PR description.
- [ ] **Step 6: Effect-order proof.** List the moved effects and every non-moved effect located between the first and last moved effect in the original. Place the hook call where the earliest moved effect was. If a non-moved effect between them reads or writes the same state or refs, split into two hook calls or keep the pair together. Record the table in the PR description. Effects run in declaration order per component, so a hook's effects run at its call site.
- [ ] **Step 7: Guards.** Apply the section 5 disposition for each guard the PR breaks. Do not edit a guard that still passes.
- [ ] **Step 8: Verify.** Lint check (only the `process` hits), Node suite, Python suite, build and `make verify-dist-clean`, DOM parity diff empty (`diff -r tmp/dom-parity/before tmp/dom-parity/after`), the PR's targeted Playwright specs, then the full Chromium `tests/ui` run. Read every summary line. For UI-bearing slices (SC6, ST3-ST6) attach before/after screenshots to the PR notes and re-verify sticky order in Catch Up, Planning, and Scenario modes.
- [ ] **Step 9: Ratchet and docs.** Set `LEGACY_ENTRYPOINT_LINE_BUDGETS["frontend/src/dashboard.jsx"]` to the measured post-PR line count with a one-line comment naming the slice (the value must be lower than before; a PR that cannot lower it is not done). Update the affected `docs/ontology.md` entries (new owner files, verified date, and re-check that each path and symbol resolves), the status row in section 7 of this plan, and `docs/plans/README.md`.
- [ ] **Step 10: Publish.** Follow the Git workflow publication transaction in root `AGENTS.md` section 10: fetch base, record base and head SHAs, compare commit list and changed paths with this plan's PR section, build at the exact head, `gh pr create --body-file -` via stdin, verify the remote head, read back the rendered body, and report actual CI state. Wait for explicit operator confirmation before the first push. Commit messages carry no agent attribution. After every commit run `git show --stat HEAD` and `git status` and read them.

Analytics impact review (all PRs): no user-visible change, so no new event. `trackScenarioAction` and `trackSettingsAction` call sites move verbatim; `tests/test_analytics_events.js` and `tests/test_analytics_source_guards.js` must pass. Allowlist reason: behavior-preserving refactor.

---

## PR0: Baselines and verification tooling

**Branch:** `improvement/dashboard-extraction-baselines`

**Files:**
- Create: `tests/ui/helpers/domParity.js`
- Modify: `tests/ui/scenario_draft_history.spec.js` (one opt-in test), `tests/ui/settings_unified_save.spec.js` (one opt-in test), `tests/test_auth_isolation_source_guard.js`
- Modify: this plan (record the UI baseline in section 1)

**Interfaces:**
- Produces: `captureDomParity(page, label, selector)`; writes `${JEP_DOM_PARITY_DIR}/${label}.html` when the env var is set and does nothing otherwise.

- [ ] **Step 1: Record the full Chromium `tests/ui` baseline** with the Slice Protocol command. Write pass/fail/skip counts and wall time into section 1. Any pre-existing failure is listed by name; those tests are excluded from "must pass" in later PRs and the list is repeated in every PR description.

- [ ] **Step 2: Create the DOM parity helper.**

```js
// tests/ui/helpers/domParity.js
const fs = require('node:fs');
const path = require('node:path');

// Opt-in DOM parity capture for behavior-preserving refactors. Set JEP_DOM_PARITY_DIR to a
// gitignored folder (for example tmp/dom-parity/before) to write one normalized HTML file per label.
async function captureDomParity(page, label, selector) {
    const dir = process.env.JEP_DOM_PARITY_DIR;
    if (!dir) return;
    const html = await page.locator(selector).first().evaluate((root) => root.outerHTML);
    // React useId values (for example _r_3_) depend on hook order, which these refactors change.
    const normalized = html.replace(/_r_[0-9a-z]+_/g, '_r_#_').replace(/></g, '>\n<');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${label}.html`), `${normalized}\n`);
}

module.exports = { captureDomParity };
```

- [ ] **Step 3: Add the opt-in Scenario capture.** Add `const { captureDomParity } = require('./helpers/domParity');` with the other requires at the top of `tests/ui/scenario_draft_history.spec.js`, and append this test at the end of the file (it reuses `installDashboardFromSource` and `openScenarioWithDirtyDraft`):

```js
test('dom parity capture: Scenario with dirty draft and History open', async ({ page }) => {
    test.skip(!process.env.JEP_DOM_PARITY_DIR, 'opt-in refactor check');
    await installDashboardFromSource(page);
    await openScenarioWithDirtyDraft(page);
    await captureDomParity(page, 'scenario-dirty-draft', '.scenario-fullbleed');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Scenario draft history' })).toBeVisible();
    await captureDomParity(page, 'scenario-history-open', '.scenario-fullbleed');
});
```

- [ ] **Step 4: Add the opt-in Settings capture** to `tests/ui/settings_unified_save.spec.js`. Tabs are `role="tab"` (see `openBoardsTab` in that file). Open the dialog with the same sequence as the `catalog failure leaves unrelated dirty sections saveable` test, then loop over `dialog.getByRole('tab')` names, click each, and capture `[role="dialog"]` as `settings-<index>-<tab name slug>`. Also click the `Admin` button and loop its tabs. Run it once headed to confirm each tab panel is visible before capture.

- [ ] **Step 5: Prove determinism.** Run the parity tests twice on the unchanged code into `tmp/dom-parity/run1` and `tmp/dom-parity/run2`; `diff -r tmp/dom-parity/run1 tmp/dom-parity/run2` must print nothing. If it prints differences (timestamps, animation state), extend the normalization in the helper until it is empty, then repeat. Do not proceed with a nondeterministic capture.

- [ ] **Step 6: Widen the auth-isolation guard.** In `tests/test_auth_isolation_source_guard.js` replace the dashboard-only count with a scan over `frontend/src/dashboard.jsx` plus every `.js`/`.jsx` file under `frontend/src/scenario/` and `frontend/src/settings/`. The total must remain exactly six `window.addEventListener('keydown', X)` calls and each must still check `readPendingAuthenticationRequired()` before its first `event.key`. Run it; it passes with no source change.

- [ ] **Step 7: Verify and publish** per the Slice Protocol (no `dashboard.jsx` change, so no budget change). Commit: `Add DOM parity capture and widen auth-isolation guard for extraction`.

**Acceptance:** UI baseline recorded; parity capture deterministic; guard widened and passing; no production source changed.

---

## SC1: Scenario state container and per-group seam

**Branch:** `improvement/scenario-state-container`

**Files:**
- Create: `frontend/src/scenario/useScenarioState.js`, `frontend/src/scenario/scenarioGroupState.js`, `tests/test_scenario_group_state.js`
- Modify: `frontend/src/dashboard.jsx`, `tests/test_codebase_structure_budgets.py`, docs per Step 9
- Targeted specs: `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- Produces `useScenarioState({ initialLaneMode })`: returns every `useState` value and setter and every `useRef` declared at base lines 463-466 (`scenarioCurrentUserIdentity`, `setScenarioCurrentUserIdentity`), 998-1010, 1012-1080, 1082-1096, and 1151 (`scenarioRefreshNonceRef`), under the same names as today. It excludes `searchInputRef` (1011, not Scenario) and `let scheduleScenarioEdgeUpdate` (1081, see section 4). It also returns `scenarioGroupValues`, a memoized object of the 14 per-group fields below whose identity changes iff any of them changes.
- Produces `scenarioGroupState.js` exports: `SCENARIO_GROUP_STATE_KEYS`, `buildDefaultScenarioGroupState(initialLaneMode)`, `applyScenarioGroupState(setters, snapshot)`, `resetScenarioTransientRefs(refs)`.
- Consumes: `savedPrefsRef.current.scenarioLaneMode ?? 'team'` as `initialLaneMode`.

The 14 per-group fields (from `buildDefaultGroupState` at 5975-5998, the snapshot literal at 6074-6087, the apply block at 6189-6212, and the snapshot memo deps at 6292-6305): `scenarioData`, `scenarioError`, `scenarioLaneMode`, `scenarioCollapsedLanes`, `scenarioEpicFocus`, `scenarioRangeOverride`, `scenarioScrollTop`, `scenarioScrollLeft`, `scenarioViewportHeight`, `scenarioHoverKey`, `scenarioFlashKey`, `scenarioLayout`, `scenarioEdgeRender`, `scenarioTooltip`.

- [ ] **Step 1: Write the failing test** `tests/test_scenario_group_state.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../frontend/src/scenario/scenarioGroupState.js');

const EXPECTED_KEYS = [
    'scenarioData', 'scenarioError', 'scenarioLaneMode', 'scenarioCollapsedLanes', 'scenarioEpicFocus',
    'scenarioRangeOverride', 'scenarioScrollTop', 'scenarioScrollLeft', 'scenarioViewportHeight',
    'scenarioHoverKey', 'scenarioFlashKey', 'scenarioLayout', 'scenarioEdgeRender', 'scenarioTooltip',
];

function recordingSetters() {
    const calls = {};
    const setters = {};
    for (const key of [...EXPECTED_KEYS, 'scenarioLoading']) {
        const name = `set${key[0].toUpperCase()}${key.slice(1)}`;
        setters[name] = (value) => { calls[name] = value; };
    }
    return { calls, setters };
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

test('applying a null snapshot restores the same fallbacks the old applyGroupState used', async () => {
    const { applyScenarioGroupState } = await load();
    const { calls, setters } = recordingSetters();
    applyScenarioGroupState(setters, null);
    assert.equal(calls.setScenarioData, null);
    assert.equal(calls.setScenarioError, '');
    assert.equal(calls.setScenarioLaneMode, 'team');
    assert.deepEqual(calls.setScenarioCollapsedLanes, {});
    assert.equal(calls.setScenarioScrollTop, 0);
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

test('resetScenarioTransientRefs clears refs and cancels pending animation frames', async () => {
    const { resetScenarioTransientRefs } = await load();
    const cancelled = [];
    globalThis.window = { cancelAnimationFrame: (id) => cancelled.push(id) };
    try {
        const refs = {
            scenarioIssueRefMap: { current: new Map([['A-1', {}]]) },
            scenarioEdgeUpdatePendingRef: { current: true },
            scenarioFocusRestoreRef: { current: { x: 1 } },
            scenarioSkipAutoCollapseRef: { current: true },
            scenarioTeamCollapseInitRef: { current: true },
            scenarioEdgeFrameRef: { current: 11 },
            scenarioScrollFrameRef: { current: 12 },
            scenarioResizeFrameRef: { current: 13 },
            scenarioPendingScrollRef: { current: { top: 1 } },
        };
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
```

- [ ] **Step 2: Run it and confirm it fails** because the module does not exist: `fnm exec --using 20 node --test tests/test_scenario_group_state.js` (expect `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Create `scenarioGroupState.js`.** `SCENARIO_GROUP_STATE_KEYS` is the 14-name array above. `buildDefaultScenarioGroupState(initialLaneMode)` returns the object asserted in Step 1 with `scenarioLaneMode: initialLaneMode ?? 'team'`. `applyScenarioGroupState(setters, snapshot)` copies the apply block at 6189-6212 exactly (each `setX(next.x || fallback)`, including the `|| 'team'` lane-mode fallback and the tooltip fallback object) using `const next = snapshot || {}`, then calls `setters.setScenarioLoading(false)` (moved from 6232). `resetScenarioTransientRefs(refs)` copies 6110-6118 and 6120-6128 verbatim (skipping 6119 `alertDismissedRef.current = false;`): clear `scenarioIssueRefMap.current`, set `scenarioEdgeUpdatePendingRef`/`scenarioSkipAutoCollapseRef`/`scenarioTeamCollapseInitRef` to `false`, `scenarioFocusRestoreRef` and `scenarioPendingScrollRef` to `null`, and for `scenarioEdgeFrameRef`, `scenarioScrollFrameRef`, `scenarioResizeFrameRef` call `window.cancelAnimationFrame(ref.current)` then set `null` when non-null. `alertDismissedRef.current = false` and `epicRefMap.current = new Map()` stay in `App()`.

- [ ] **Step 4: Create `useScenarioState.js`** by cutting the declarations listed under Interfaces verbatim (the `useState`/`useRef` initializers unchanged, `createUndoStack` imported from `./scenarioUtils.js`) and returning them in one flat object. Add `scenarioGroupValues = React.useMemo(() => ({ ...the 14 fields }), [the 14 fields])`.

- [ ] **Step 5: Wire `dashboard.jsx`.** Call the hook once at the position of the earliest declaration (463) with `{ initialLaneMode: savedPrefsRef.current.scenarioLaneMode ?? 'team' }` (`savedPrefsRef` is declared at 371) and destructure every returned name under its existing name, so the rest of `App()` is unchanged. Replace the 14 default entries in `buildDefaultGroupState` with `...buildDefaultScenarioGroupState(savedPrefsRef.current.scenarioLaneMode)`, the 14 shorthand entries in the snapshot literal with `...scenarioGroupValues`, the 14 deps in the snapshot memo with `scenarioGroupValues`, the ref-reset lines in `applyGroupState` with `resetScenarioTransientRefs({ ...nine refs })` at the same position, and the 14 setter lines plus `setScenarioLoading(false)` with one `applyScenarioGroupState({ ...fifteen setters }, nextState)` at the position of the old first setter line.

- [ ] **Step 6: Run the Slice Protocol Steps 5-9.** The container has no effects, so the effect-order table is empty and must say so. Expected `dashboard.jsx` change: about -80 to -120 lines (estimate; record the measured value).

- [ ] **Step 7: Commit** (tests first, then source): `Add Scenario state container and per-group state seam`.

**Acceptance:** `tests/test_scenario_group_state.js` passes; group switch still clears Scenario transient state (covered by `tests/ui/scenario_draft_history.spec.js` and `tests/ui/eng_group_board_view.spec.js` group-switch tests, named in the PR); parity diff empty; startup counts unchanged; budget lowered.

---

## SC2: Draft lifecycle, history, and write-back preview

**Branch:** `improvement/scenario-draft-hook`

**Files:**
- Create: `frontend/src/scenario/useScenarioDraft.js`
- Modify: `frontend/src/dashboard.jsx`, guard files per section 5, budget test, docs
- Targeted specs: `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/server_unavailable_ui.spec.js`, `tests/ui/global_auth_lock.spec.js`

**Moves (base ranges):** CSRF and realtime fetch wrappers 7262-7283 and 7427-7486; `buildScenarioDraftScope` 7488, `buildScenarioPayload` 7495, `scenarioDraftIdleActionState` 7513; `runScenario` 7527-7679 (includes connection recovery at about 7594-7603); `scenarioScopeKey` 9143, signatures 9148-9155, dirty-mirror effect 9156-9162, `scenarioHasUnsavedChanges` 9163, the `useConnectionScenarioRecovery` call 9164-9174, `scenarioCanSaveDraft` 9180, render-phase ref writes 9187-9188, `isScenarioScopeDraftCurrent` 9189, `scenarioActiveDraftReady` 9194; `saveScenarioDraft` 9748, `discardScenarioOverrides` 9819, history open/close/reload/rollback 9835-10229 with request helpers 9908-9925 and 10015-10052, history effects 9993-10013, write-back `previewScenarioDraftWriteback` 10145 and `checkScenarioDraftWritebackGate` 10186.

**Interfaces:**
- Consumes: the SC1 container object; inputs (all named in the inventory): `selectedSprint`, `selectedSprintInfo`, `selectedSprintState`, `isCompletedSprintSelected`, `activeGroupId`, `activeGroup`, `activeGroupTeamIds`, `selectedTeams`, `selectedTeamSet`, `isAllTeamsSelected`, `teamOptions`, `excludedEpicSet`, `normalizeEpicKey`, `searchQuery`, `jiraUrl`, `engWorkspaceConfigured`, `groupsLoading`, `tasksFetched`, `productTasksLoading`, `techTasksLoading`, `configRefreshNonce`, `configRefreshTargetRef`, `restoringGroupRef`, `registerSprintFetch`, `cleanupSprintFetch`, `perfEnabled`, `perfCountersRef`, the connection-recovery refs and setters, `pendingShellAuthResumeRef`, `trackScenarioAction`, `analyticsToken`, `bucketCount`, `BACKEND_URL`. The hook is called after `teamOptions` (7938) exists, at the position of the first moved effect (9156).
- Produces: `runScenario`, `saveScenarioDraft`, `discardScenarioOverrides`, history actions, write-back actions, `buildScenarioPayload`, `scenarioScopeKey`, `scenarioHasUnsavedChanges`, `scenarioCanSaveDraft`, `scenarioActiveDraftReady`, `isScenarioScopeDraftCurrent`, plus whatever the Step 5 scan finds referenced outside the range (the `7860-7882` config-refresh effect calls `runScenario`; the `14440-14459` recovery snapshot reads `scenarioHasUnsavedChanges`, `scenarioDraftMeta`, `scenarioOverrides`, `scenarioEditMode`, `scenarioTimelineRef`).

**PR-specific checks:**
- Effect order: `useConnectionScenarioRecovery` must stay after the auth-resume effect at 6367-6412 (it reads and relies on `pendingShellAuthResumeRef` having been processed). The Escape handler at 10001-10013 and the undo keydown at 9729-9744 stay in the original relative order (covered by `scenario_draft_history.spec.js` "Escape outside history keeps drawer open and Ctrl+Z still undoes scenario edits").
- Cleanup effect: the ENG load effect cleanup calls `abortSprintFetches()`, which aborts an in-flight `runScenario` because it registers its controller through `registerSprintFetch`; the hook must receive `registerSprintFetch`/`cleanupSprintFetch` and not create its own controller registry.
- Add a pure test for `scenarioDraftIdleActionState` and `buildScenarioDraftScope` if they have no ref reads (verify; the oracle method of section 5).
- Guard changes: `test_scenario_draft_history_source_guards.js` literals `if (!recovery && scenarioHasUnsavedChanges) {`, `requestScenarioRun(BACKEND_URL, buildScenarioPayload(),`, `setScenarioData(data);`, `const dirtyScenario = scenarioHasUnsavedChanges;`, `scenarioDraftMeta.scopePayload?.groupId` re-point to `useScenarioDraft.js` only where no behavioral spec covers them; `test_excluded_capacity_stats_source_guards.js:841-855` per section 5.
- No `fetch(` or `/api/` literal in the new file (`test_frontend_api_source_guards.js:196-217`); the only network construction allowed here is through `frontend/src/api/scenarioApi.js` wrappers.

**Expected change:** about -850 to -1,000 lines in `dashboard.jsx` (estimate from the inventory ranges; record the measured value). Commit: `Move Scenario draft lifecycle into useScenarioDraft`.

---

## SC3: Presence, locks, and realtime

**Branch:** `improvement/scenario-realtime-hook`

**Files:**
- Create: `frontend/src/scenario/useScenarioRealtime.js` (and `scenarioPresence.js` if the lock/presence merge helpers prove pure)
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/global_auth_lock.spec.js`, `tests/ui/auth_focus_refresh_counts.spec.js`

**Moves:** helpers 7268-7425 (presence and lock merging, identity learning, `SCENARIO_PRESENCE_TTL_MS` 7345, `applyScenarioDraftEvent` 7372; `isTimestampExpired` at 7347 is not Scenario-named, so run the Step 5 scan and keep it exported or shared if anything else uses it), locks `acquireScenarioIssueLock` 7696, `refresh...` 7714, `release...` 7732, derived values 9200-9234, effects: history-controller abort 9236, 5s poll 9247-9297, 25s heartbeat 9299-9323, SSE 9325-9375.

**PR-specific checks:**
- Preserve: poll and SSE effects re-subscribe on every `scenarioDraftLastEventNumber` advance; SSE gated by `window.SCENARIO_DRAFT_SSE_ENABLED`; `new window.EventSource(buildScenarioDraftEventsStreamUrl(...))` stays with no `/api/` literal; poll, heartbeat, and SSE check `readPendingAuthenticationRequired()`/`AUTH_REQUIRED_EVENT`; the 4s lock-refresh interval started by `handleScenarioBarMouseDown` (7749-7794) is SC4's, not this PR's.
- Pure-function tests: lock/presence merge and event application, if free of refs (oracle fixtures: two editors, expired TTL, out-of-order event numbers).
- Pins to keep (re-pointed): `SCENARIO_PRESENCE_TTL_MS = 30000` and `window.setInterval(poll, 5000)` plus its deps array.
- Auth-isolation guard (PR0) must still count six keydown listeners across the scanned files.

**Expected change:** about -400 to -450 lines (estimate). Commit: `Move Scenario presence, locks, and realtime into useScenarioRealtime`.

---

## SC4: Drag and undo

**Branch:** `improvement/scenario-drag-hook`

**Files:**
- Create: `frontend/src/scenario/useScenarioDrag.js`
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: `tests/ui/scenario_draft_collaboration.spec.js` (drag and lock tests), `tests/ui/scenario_draft_history.spec.js` (Ctrl+Z test)

**Moves:** `handleScenarioBarMouseDown` 7749-7794 (starts the 4s lock-refresh interval), drag effect 9630-9697 (deps `[scenarioDraggingIssueKey]`), `scenarioUndo` 9699, `scenarioRedo` 9718, Ctrl/Cmd+Z keydown effect 9729-9744. `scenarioUndoVersion` stays (it is the re-render trigger for the `canUndo()` buttons).

**PR-specific checks:**
- Preserve the drag effect's stale closure over `releaseScenarioIssueLock` and the draft ids at drag start (section 4). Do not add dependencies.
- The undo keydown handler is one of the six auth-latched listeners; the widened guard must still find it.
- Consumes SC3 lock actions; the hook is called after `useScenarioRealtime`.

**Expected change:** about -250 lines (estimate). Commit: `Move Scenario drag and undo into useScenarioDrag`.

---

## SC5: Layout, lanes, edges, focus, and tooltips

**Branch:** `improvement/scenario-layout-hook`

**Files:**
- Create: `frontend/src/scenario/scenarioLayout.js` (pure), `frontend/src/scenario/useScenarioLayout.js`, `tests/test_scenario_layout.js`, `tests/fixtures/scenario_layout/*.json` (synthetic)
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: `tests/ui/scenario_draft_history.spec.js` (sticky and overlap helper `expectScenarioStickyAndNoOverlap`), `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/codebase_structure_smoke.spec.js` lines 1184-1310

**Moves:** data derivations 9137-9142 and 9376-9628; lanes `scenarioLaneForIssue` 10352, `scenarioLaneInfo` 10364, lane memos 10431-10545, `scenarioLaneStacking` 10547-10684, export keys `scenarioJiraEpicKeys` 10703 and `scenarioJiraStoryKeys` 10707, `scenarioLaneMeta` 10711, `scenarioLaneAssigneeGroups` 10727; effects 10760 (auto-collapse), 10803 (reset), 10807-10884 (layout and scroll observer); positions and edges 10886-11133 (`scenarioPositions` through `scenarioFocusEdges`), `toggleScenarioLane` 11153, tooltip functions 11177-11258, `computeScenarioEdgePaths` 11260-11418, `clearScenarioEpicFocus` 11420, `focusScenarioEpic` 11441, `scheduleScenarioEdgeUpdate` 11483-11501 with effects 11503, 11516, 11521, `scrollToScenarioIssue` 11532 with effects 11569, 11578, 11589 (epic-focus Escape handler).

**PR-specific checks:**
- Pure extraction: only code with no DOM or ref reads goes to `scenarioLayout.js` (verify by reading each body; `computeScenarioEdgePaths` and anything using `scenarioIssueRefMap`, `getBoundingClientRect`, or `window` stays in the hook). Candidates: lane stacking, lane membership, positions. Capture oracle outputs on synthetic fixtures covering a single team, multiple teams, assignee lane mode, collapsed lanes, overlapping bars, and the empty case, then test the extracted functions against them.
- `let scheduleScenarioEdgeUpdate;` and its assignment stay in the same hook body so the layout effect's deps entry remains `undefined` (section 4). Add a one-line comment only if the move requires touching that region; do not "fix" it.
- `scenarioIssuesByLane` keeps its deps array without `scenarioLaneForIssue`.
- `perfCountersRef` is an input; its writes at the six sites move verbatim.
- Sticky: no CSS change; `expectScenarioStickyAndNoOverlap` must pass; verify Catch Up, Planning, and Scenario sticky order with screenshots.
- The 11589 Escape handler is the third auth-latched Scenario keydown listener.

**Expected change:** about -1,600 lines (estimate; this is the largest slice, split into two commits, pure functions then hook, and into two PRs if the diff exceeds what can be reviewed in one sitting). Commit: `Move Scenario layout, lanes, and edges into useScenarioLayout`.

---

## SC6: Scenario view component

**Branch:** `improvement/scenario-view-component`

**Files:**
- Create: `frontend/src/scenario/ScenarioView.jsx`
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: all Scenario specs plus `tests/ui/eng_group_board_view.spec.js`, `tests/ui/onboarding_tour.spec.js`

**Moves:** the JSX block 16338-17214, rooted at `<div className="scenario-fullbleed">` (16339), including the tooltip JSX near 17190-17207. `dashboard.jsx` keeps `{selectedView === 'eng' && showScenario && engWorkspaceConfigured && ( <ScenarioView ... /> )}`.

**Interfaces:** `ScenarioView` takes a single `scenario` object (the merge of the SC1-SC5 hook returns) plus only these non-Scenario `App()` values, confirmed by the Step 5 scan: `jiraUrl`, `selectedSprintInfo`, and any other value the scan finds. Anything beyond `scenario` plus about ten explicit props is a design smell to resolve before merging, not to accept silently.

**PR-specific checks:**
- `.scenario-fullbleed` remains the component's root and a direct child of `.container`: no wrapper element.
- `tests/test_epm_shell_source_guards.js:60` (`selectedView === 'eng' && showScenario`) and `tests/test_eng_board_runtime_source_guards.js:50` (`if (showScenario) return scenarioJiraStoryKeys;`) pass unmodified.
- Delete the JSX-order guards (`{scenarioError && ...`, `{scenarioDraftMeta.conflict && (`, `{scenarioLoading &&`, `{scenarioDraftMeta.historyOpen && (`, and the Save-button `onClick` literal) and name the Playwright assertions that cover each.
- DOM parity diff must be empty for both captured Scenario states.

**Expected change:** about -870 lines (estimate). After this PR, `rg -n '\bscenario[A-Z]\w*' frontend/src/dashboard.jsx` returns only hook call sites, the `showScenario` mode flag usages, the per-group seam, the export-key and recovery-snapshot reads, and clear/reset entry points. List the remaining hits in the PR description. Commit: `Move Scenario JSX into ScenarioView`.

---

## ST1: Priority weights and Capacity mapping

**Branch:** `improvement/settings-priority-capacity-hooks`

**Files:**
- Create: `frontend/src/settings/usePriorityWeightsSettings.js`, `frontend/src/settings/useCapacityMappingSettings.js`, tests for each hook's defaults and dirty logic
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: `tests/ui/settings_unified_save.spec.js`, `tests/ui/settings_admin_access.spec.js`, `tests/ui/planning_capacity_editing.spec.js`

**Moves:** Priority weights (S4): state 705-708; functions 2731, 2965-2984, 4860-4880, 4900-4911, 4930-4938; the seed in `loadConfig` 6900-6904 stays in `loadConfig` and calls the hook's `applyLoaded(config)`. Capacity mapping draft (S5): state 766-780, 2737, 5051-5084, 5190-5260. Not moved: the Planning capacity read lifecycle (982-997, consumers 12742-13005), the team-card editor (`PlanningTeamCapacityCards`, `updateCapacity` at 17248-17272), and `capacityEnabled` (982), which belong to Planning/bootstrap.

**Interfaces (each hook):** returns the draft values and setters, `isDirty`, the section's `save()` (`savePriorityWeightsConfig`, `saveCapacityConfig`, keeping their current internal revision commit), `applyLoaded(config)`, and a plain `draftSnapshot` for the render-time `settingsDraftSnapshotRef` assignment. `App()` keeps the section ordering in `saveGroupsConfig` and keeps `restoreSettingsDraftsToCommittedBaselines`, which now calls the hooks' setters. Inputs: `canEditSharedConfiguration`, `sharedConfigRevisionRef`, `commitSharedConfigRevision`, the read-guard helpers from `settingsConfigReadState.js`. `effectivePriorityWeightsRows` (consumed at 7884) is returned by the priority-weights hook.

**PR-specific checks:**
- New Playwright test in `settings_unified_save.spec.js`: dirty priority weights and Capacity mapping together with one neighboring section; assert POST order is `/api/stats/priority-weights-config` then `/api/capacity/config` (and that the neighbor keeps its position per the section 4 order), each carrying `baseRevision`.
- Test: both hooks server-render with `isDirty === false` and the same defaults as the old `useState` initializers.
- Nothing in these hooks may fetch before the modal opens.

Commit: `Move priority weights and Capacity mapping settings into hooks`.

---

## ST2: Jira projects, source board, issue types, and field configs

**Branch:** `improvement/settings-jira-config-hooks`

**Files:**
- Create: `frontend/src/settings/useJiraProjectSettings.js` (projects, source board, issue types, and the five field-config save functions); extend, do not duplicate, `useJiraFieldPickers.js`
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: `tests/ui/settings_unified_save.spec.js`, `tests/ui/jira_field_picker_read_race.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js`

**Moves (S3):** state 709-717, 751-765, 775-780, 804-826 (baselines and snapshot ref feed `settingsDraftSnapshotRef`, see section 4); functions and effects 4326-4420, 4800-4858, 4913-5049, 5086-5188.

**PR-specific checks:**
- Keep the five field-config saves on the `commitSharedConfigRevision(await saveXFieldConfig(sharedConfigRevisionRef.current))` convention and in the section 4 order.
- Projects and board changes feed the strict-board revision (5762), `techProjectKeys`, and ENG selector state: export exactly what the Step 5 scan finds.
- `savedSelectedProjects`/`savedBoardId` keep their consumers at 5728-5729 and 5773-5780 unchanged.
- Playwright: dirty `projects`, `board`, and `issueTypes` together and assert the POST order from section 4 against `/api/board-config` and `/api/issue-types/config` (the projects endpoint comes from `saveSelectedProjects` in `configApi.js`; read it, do not guess).
- `tests/ui/codebase_structure_smoke.spec.js:1245-1262`: zero config reads before the modal opens.

Commit: `Move Jira project, board, and field settings into hooks`.

---

## ST3: EPM settings

**Branch:** `improvement/settings-epm-hook`

**Files:**
- Create: `frontend/src/settings/useEpmSettings.js`, `frontend/src/epm/EpmSettingsTab.jsx` (container that owns the hook and renders the existing presentational `EpmSettings.jsx`)
- Modify: `dashboard.jsx`, `tests/test_epm_settings_source_guards.js`, budget test, docs
- Targeted specs: `tests/ui/epm_initial_config_load.spec.js`, `tests/ui/epm-settings-gear.spec.js`, `tests/ui/epm_settings_visual_states.spec.js`, `tests/ui/home_token_connection_settings.spec.js`, `tests/ui/settings-home-token-connection.spec.js`

**Moves (S6):** state 489-540; refs 1144-1148; functions 1362-1892 (including `saveEpmConfig`, `loadEpmSettings` effect at 2235 with deps `[showGroupManage, groupManageTab]`); normalization and memos 2466-2608; dirty and saved-scope 2746-2768; project rows 2849-2932; effects 1667-1699, 2235-2335, 2765, 2856-2879; JSX 17688-17777.

**PR-specific checks:**
- Run the `docs/plans/GATE-*.md` sweep first (EPM surface); no Home/Townsquare route or write path is added; EPM data stays in the owning user's private saved view and never enters workspace configuration.
- EPM saves stay independent of every shared revision and conflict state; the slice from `saveEpmConfig` to `normalizeStatus` must not reference `sharedConfigRevisionRef`, `commitSharedConfigRevision`, or `setWorkspaceConfigConflict` (this is an invariant of the old guard; keep it as a pinned guard on the new file).
- Shared with Team Groups: the `labelSearch*` maps (the EPM label picker clears `epm-project:` keys at 1531) and `setGroupDraftError`. Keep both in `App()` and pass them in as explicit inputs until ST4 moves Team Groups.
- `epmConfigLoaded`, `hasSavedEpmScope`, `savedEpmSubGoalKeys` still feed `useEpmViewData` (2793-2800); `epmSubGoals` still feeds `EpmControls` (14057). `loadConfig` seeding at 6909-6918 and 6961 calls the hook's `applyLoaded`.
- Replace the `<SettingsModal` spread-props guard with a server-render probe of `EpmSettingsTab` using fixture props, plus the Playwright specs above.
- Preserve the Settings-header `epm-settings-gear` accessible label and the rule that the EPM tab appears only for `canEditEpmConfiguration` (and, in DB/OAuth mode, only after the current user connected a Home/Townsquare token).

Commit: `Move EPM settings into useEpmSettings and EpmSettingsTab`.

---

## ST4: Team Groups, Labels, and board layouts

**Branch:** `improvement/settings-team-groups-hook`

**Files:**
- Create: `frontend/src/settings/useTeamGroupsSettings.js`, `frontend/src/settings/DepartmentSettingsPanels.jsx` (containers for the tab bodies, including the Labels tab, which is fully inline today)
- Modify: `dashboard.jsx`, guards, budget test, docs
- Targeted specs: `tests/ui/shared_department_groups.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js`

**Moves (S2):** state and refs `groupsConfig` and related 605-617 and 626, conflict 641, search and label state 652-680, component/excluded-epic/ad-hoc-epic search 718-736; `loadGroupsConfig` 2610; draft mutators and team search 3234-3611; `applySavedGroupsConfig` 3612; debounced searches 4423-4569; epic helpers 4594-4798; export/import 5262-5345; team directory memos 5347-5380; `filteredGroupDrafts` 5449; label search 5508-5660; dirty and validation 2710-2725, 2945, 2987; JSX tab strip 17778-17815, `TeamGroupsSettings` 17816-17934, Labels tab 17935-18092, `GroupBoardsTab` 18093-18120.

**PR-specific checks:**
- Ownership: department groups, labels, memberships, exclusions, and board layouts are shared once per workspace and editable by every authenticated user; stars, favorites, visibility, and active group stay private per user and never touch `defaultGroupId`. Keep `useGroupVisibilityPreferences` and `useTeamCatalogLifecycle` as they are, passing their results in.
- Outputs read elsewhere must keep their names and values: `groupsConfig` (5764, 12459, 14316, 18128), `groupsLoading`, `boardGroupsReadFailed`, `visibleControlGroups`, `teamNameLookup`, `resolveTeamName`. `teamOptions` is computed at 7938 after use at 2666, so `loadTeamsFromCurrentView` receives a getter or ref, not a captured value.
- Group JSON export/import stays selected-group scoped (active group only).
- Team label aliases (up to three per Team, one `labelSearch*` entry per Team) behave exactly as before.
- Move `labelSearch*` ownership here and update the ST3 `EpmSettingsTab` input to read it from this hook.
- Keep the first-run flag `firstRunConfigurationActive` as an input; first-run itself moves in ST5.

Commit: `Move Team Groups settings into useTeamGroupsSettings`.

---

## ST5: First-run configuration and personal favorite

**Branch:** `improvement/settings-first-run-hook`

**Files:**
- Create: `frontend/src/settings/useFirstRunConfiguration.js`
- Modify: `dashboard.jsx`, `tests/test_first_run_group_configuration.js`, `tests/test_analytics_source_guards.js`, `tests/test_onboarding_tour_utils.js`, budget test, docs
- Targeted specs: `tests/ui/onboarding_tour.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`

**Moves (S10):** state, refs, and handlers 629-638, 1218-1348, 3042-3084, 5382-5447, 14842-14868 (`settingsHeaderAction` replay); JSX 18125-18166; `captureFirstRunSettingsDrafts`, `configureFirstRunGroup`, `restoreSettingsDraftsToCommittedBaselines` (4194+), `returnFromFirstRunConfigurationRecovery`, `keepMineOnGroupsConfigConflict`, `keepMineOnWorkspaceConfigConflict`, `retryFirstRunConfiguration`, `openFirstRunSetupChoice`.

**PR-specific checks:**
- Circular dependency (inventory): the onboarding controller (3056) needs `closeGroupManage`, while Settings needs `onboarding.requestModule` (15084) and `onboarding.replay` (14855). Resolve with the two-layer pattern: the modal-shell cells (`showGroupManage`, tabs, `closeGroupManage`) are created before the onboarding controller and passed to it; the controller's `requestModule`/`replay` are passed into this hook as inputs. Do not introduce a ref or a late-binding callback to break the cycle without recording why the two-layer split could not.
- The first-run flow keeps its committed-section tracking, `settingsSaveInFlightRef`, the `rebaseOnto` flow, and the "save shared groups first, then the private favorite, then continue" order. The first-run create/duplicate action still marks the new draft as the pending favorite and visible group without presenting `defaultGroupId` as the user's favorite.
- Delete the declaration-order slices in `test_first_run_group_configuration.js`; keep its reducer tests. Re-point the analytics slice guard (no analytics, `fetch(`, `onboardingDone`, `groupSearchQuery` in the `openFirstRunSetupChoice` through next-`useEffect` slice) to the new file.

Commit: `Move first-run configuration into useFirstRunConfiguration`.

---

## ST6 (gated by OD2): Shared-config bootstrap, sequential save, permissions, and modal shell

**Branch:** `improvement/settings-save-orchestrator`

**Entry gate:** do not start until the operator approves OD2 after reviewing ST1-ST5 results. Before any code, append a short design note to this section comparing two candidate interfaces for the save orchestrator (design it twice): (a) a table-driven sequence of `{ id, isDirty, save }` records in the section 4 order, preserving the two commit conventions; (b) keep `saveGroupsConfig` imperative and move it intact into a hook that receives the section hooks. Choose one with reasons, then replace this paragraph with the final interface.

**Files:**
- Create: `frontend/src/settings/useSettingsPermissions.js`, `frontend/src/settings/useSharedConfigSave.js`, `frontend/src/settings/useSettingsModalState.js`, `frontend/src/settings/SettingsModalContainer.jsx`
- Modify: `dashboard.jsx`, `tests/test_epm_settings_source_guards.js`, guards, budget test, docs
- Targeted specs: `tests/ui/settings_unified_save.spec.js`, `tests/ui/settings_admin_access.spec.js`, `tests/ui/unconfigured_workspace_gate.spec.js`, `tests/ui/global_auth_lock.spec.js`, `tests/ui/server_unavailable_ui.spec.js`, `tests/ui/load_performance.spec.js`, `tests/ui/codebase_structure_smoke.spec.js`

**Moves:**
- Permissions (S7): `settingsAdminOnly` 685, `userCanEditSettings` 686, `performanceAdminAvailable` 687, `userCanEditEpmConfig` 691, `adminUserManagementAvailable` 692, `userIsToolAdmin` 693, `environmentConfigExists` 695, derived `canEditSharedConfiguration` 701, `canEditEpmConfiguration` 703, `preferredSettingsTab` 704. `performanceGate` 688, `activePerformanceLoadRef` 689, and `performanceLoadRevision` 690 are ENG load performance, not Settings; they stay. The hook exposes two entry points, `applyBootstrapPermissions(config)` and `applySavePermissions(config)`, preserving the post-save asymmetry in section 4. Defaults: `userCanEditSettings` and `userCanEditEpmConfig` false, `settingsAdminOnly` true, set only with `=== true`.
- Shared-config snapshot and save (S8): state and refs 639-651, `sharedConfigRevisionRef` 644, aggregates 2934-3041, `saveBlockedReason` 3033, `saveGroupsConfig` 3629-4006, `saveAllSettingsOnce` 4008, `saveAllSettings` 4184, restore and return 4194-4244, conflict exits 4249-4285, `commitSharedConfigRevision` 4882, and the Settings part of `loadConfig` (6760-6966). `loadConfig` also writes non-Settings state (`setJiraUrl`, `setAuthMode`, `setBoardAllWorkAvailable`, `performanceGate.resolve`, auth-resume and recovery refs, the sprint catalog controller): extract only the Settings part and leave those writes where they are.
- Gate (S9): `useAdminSettingsGate` stays as is; its consumers (2143-2147, 3655, 3893, 6871, 6957, 8428, 8688, 8836, 12074, notice at 15187) keep working through inputs.
- Modal shell (S1): `showGroupManage` 625, `groupManageTab` 682, `epmSettingsTab` 519, `adminSettingsTab` 520, `departmentSettingsTab` 521, `showGroupDiscardConfirm` 679, `showGroupListMobile` 678, `groupTesting` 656, `groupTestMessage` 657, `groupDraftError` 627, `settingsSaveError` 628, `groupManageButtonRef` 859; functions 2674-2708, 3086-3232, 14783-14841, 14948-14958; effects: auto-open 2175, hotkey 4287-4324, permission fallback 5488, tab sync 5500; JSX gear buttons 15075-15112 and `<SettingsModal>` shell 17457-17492.

**PR-specific checks:**
- The mount effect at 2136 and the `[showGroupManage]` open effect at 2184 stay in `App()` (or in a hook called at the same position) with unchanged dependencies. `loadConfig` is also called from `retryBoardScopeConfiguration` (14873) and `useLatestWorkspaceConfig` (4283): keep one function identity for all three call sites.
- Both `loadConfig` and `loadGroupsConfig` failure paths must still resolve `adminSettingsGate` (6957) and `groupsLoading` so Sprint discovery is not blocked forever.
- Save payload scope: each admin section is gated by `canEditSharedConfiguration && isXDirty && !skip`; every workspace-config POST carries `baseRevision` from `sharedConfigRevisionRef`, advanced by `commitSharedConfigRevision`; groups post via `buildSharedGroupsPayload` with `configRevision`; personal preferences post separately; the footer Save persists all dirty editable sections together without mixing fields across endpoints.
- Add the full-order Playwright test: with every workspace section dirty, the recorded POST sequence equals the section 4 order, ending with `/api/groups-config`.
- The hotkey effect at 4287-4324 is one of the six auth-latched keydown listeners and must still be counted by the widened guard.
- Replace the remaining `test_epm_settings_source_guards.js` assertions: keep `userCanEditSettings`/`userCanEditEpmConfig` fail-closed as server-render unit assertions on `useSettingsPermissions`; drop shape and order guards, naming the Playwright specs that cover them.
- Re-verify headed Chromium and, for glyph or form-control geometry, Firefox and WebKit, per root `AGENTS.md` section 10.

Commit: `Move shared-config save and Settings modal state into hooks`.

---

## 7. Execution status

Update this table in each PR (root `AGENTS.md` section 4: the plan must match the result).

| PR | Slice | Status | Measured `dashboard.jsx` lines after | Budget after | Notes |
| --- | --- | --- | --- | --- | --- |
| PR0 | Baselines and tooling | Not started | n/a | 18,213 | UI baseline pending |
| SC1 | Scenario state container | Not started | | | |
| SC2 | Draft lifecycle and history | Not started | | | |
| SC3 | Presence, locks, realtime | Not started | | | |
| SC4 | Drag and undo | Not started | | | |
| SC5 | Layout, lanes, edges | Not started | | | |
| SC6 | Scenario view component | Not started | | | |
| ST1 | Priority weights, Capacity mapping | Not started | | | |
| ST2 | Jira projects, board, fields | Not started | | | |
| ST3 | EPM settings | Not started | | | |
| ST4 | Team Groups and Labels | Not started | | | |
| ST5 | First-run configuration | Not started | | | |
| ST6 | Shared-config save and modal shell | Gated (OD2) | | | |

## 8. Program acceptance

- Every PR merged in order; `dashboard.jsx` is lower and its budget ratcheted in each.
- Estimated end state (to be replaced by measured values): the two clusters total about 8,000 lines of the 18,203. After extraction `App()` keeps call sites, destructuring, and glue, so the realistic end size is about 11,000 plus or minus 1,000 lines. If the measured result after ST5 is above that range, report it before starting ST6.
- No route, payload, startup-count, sticky-order, analytics, or visual change; DOM parity diff empty in every PR.
- Backlog: `FUTURE-codebase-operability-improvements.md` rows for Scenario ownership and settings hooks marked converted; `docs/plans/README.md` entry present; `docs/ontology.md` entries for Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, and any new Scenario/Settings concept point at their new owner files with verification dates.
- On completion rename this file to `DONE-dashboard-scenario-settings-state-extraction.md` with the status note naming the PRs, per `docs/plans/AGENTS.md`.

## 9. Estimate and risks

`FUTURE-codebase-operability-improvements.md` estimates 5-8 days for Scenario and 4-7 days for Settings. This plan splits them into 13 PRs, each needing a full roughly 8-minute UI run and a review cycle, so plan on the upper end: about 3 weeks of elapsed work if reviews are prompt. The largest risks are missed identifiers (mitigated by the lint check), changed effect order (mitigated by the per-PR order table and the Scenario/Settings Playwright coverage), and merge conflicts with feature work (mitigated by D3 and short-lived branches). Each PR is independently revertable; there is no data migration.
