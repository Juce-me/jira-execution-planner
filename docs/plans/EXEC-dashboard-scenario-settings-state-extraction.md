# Dashboard Scenario And Settings State Extraction Implementation Plan

> **Status:** Proposed, revision 2 (2026-10-01), base `89ffe589`. Revision 2 incorporates four independent reviews of draft 1 (hook ordering, range ownership, lint gate, guard table, verification gaps, process). It has **not** been re-validated: a second independent review pass is required before this plan is treated as executable. Supersedes the "Extract Scenario Planner ownership" and "Move settings state/actions behind feature hooks" rows of `FUTURE-codebase-operability-improvements.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute one commit at a time under the validation protocol in section 5. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the Scenario Planner and Settings state, effects, handlers, and JSX out of the single `App()` function in `frontend/src/dashboard.jsx` into feature-owned hooks and container components, with no user-visible or contract change, lowering the `dashboard.jsx` line budget in every PR.

**Architecture:** Hooks are called unconditionally from `App()` and receive explicit inputs; no hook introduces a ref or late-binding callback to reach a value declared later. Scenario moves first as one verbatim hook (its code is contiguous, so effect order is preserved by construction) and may then be split inside `frontend/src/scenario/`. Settings is interleaved with other code, so it uses layers: shared-config primitives hoisted first, then per-section hooks (state layer at the existing state lines, behavior layer where its inputs exist), then the save orchestrator. Pure computation moves to plain modules with Node unit tests. JSX moves to stateless container components.

**Tech Stack:** React 19, esbuild, Node 20 (`fnm exec --using 20`), `node --test`, Python `unittest`, Playwright (Chromium; headed Firefox/WebKit only when a commit touches glyph or form-control geometry).

## Global Constraints

- Behavior-preserving: no route, payload, response-shape, cache-key, `Server-Timing`, startup-request-count, sticky-order (`--sticky-scenario-z: 60`), analytics, or visual change.
- No new runtime or test dependency in `package.json`. The lint tooling in section 6 installs into gitignored `tmp/lint`.
- No `fetch(` or `/api/` literal outside `frontend/src/api/` (`tests/test_frontend_api_source_guards.js:196-217`).
- Generated `frontend/dist` is never hand-edited; every source commit includes the rebuilt dist (Flask serves it, so the operator validates the committed build).
- No agent or tool branding or attribution trailers in branches, commits, or PRs. No local absolute paths, real emails, or real Jira data in committed files.
- Read `backend/security/CONFIGURATION_OWNERSHIP.md` before every `ST*` PR. Settings load/save functions stay per-render closures (section 4).

---

## 1. Evidence (measured 2026-10-01 at `89ffe589`)

| Fact | Value |
| --- | --- |
| `frontend/src/dashboard.jsx` | 18,203 lines, 1,089,792 bytes; `App()` runs 370-18196 (`return` at 15024) |
| Hooks inside `App()` | 318 `useState`, 136 `useEffect`, 281 `useMemo`, 58 `useCallback`, 150 `useRef` |
| Other frontend source | 193 files, 38,133 lines (already extracted) |
| Budget | `tests/test_codebase_structure_budgets.py` caps `dashboard.jsx` at 18,213 |
| Growth | 15,022 lines on 2026-05-28; 104 commits touched the file since 2026-06-01 |
| Scenario | 29 `useState`, 27 `useRef`, 57 `useMemo`, about 19 effects; code 5662-5686, 7262-7794, 9137-11601 (all Scenario effects lie in 9156-11589 with no foreign effect between 9137 and 11601); JSX 16338-17214 |
| Settings | about 140 `useState`, 40 `useRef`, 32 `useEffect`, 45 `useMemo`, interleaved with non-Settings code between 489 and 5660; JSX 17457-18166 |
| Python baseline | `Ran 2006 tests ... OK (skipped=25)` (section 6 command) |
| Node baseline | `node --test tests/test_*.js`: 1529 pass, 0 fail |
| Lint baseline | with `process` declared as a global: 0 `no-undef`, 0 `jsx-no-undef`, 0 `no-use-before-define` in `frontend/src`; 149 `no-unused-vars` warnings; 3 pre-existing `rules-of-hooks` errors at `frontend/src/eng/EngView.jsx:56-58` (out of scope) |
| Full Chromium `tests/ui` baseline | recorded in PR0 (not yet measured) |

Line numbers are as of `89ffe589` and drift after every merge. Re-locate every symbol with `rg -n 'symbolName' frontend/src/dashboard.jsx` before editing. Ranges come from read-only scans and four independent reviews on 2026-10-01; each commit re-verifies the ranges it moves.

Prior slices (`DONE-codebase-operability-*`) moved presentational components and pure helpers. None moved `App()` state, which is why this plan adds the commit ladder, the DOM parity check, the lint gate, and the guard ledger.

## 2. Scope

In scope: Scenario (state, draft lifecycle and history, presence/locks/realtime, drag/undo, layout/lanes/edges/focus/tooltips, JSX) and Settings (shared-config sections, EPM settings, Team Groups/Labels/board layouts, first-run flow, permissions, shared-config bootstrap and save, modal shell, JSX), the tests and guards that read `dashboard.jsx` as text, and the docs listed in section 13.

Out of scope: ENG Catch Up/Planning/Stats/EPM/Board state, backend, CSS, contracts, new dependencies, analytics events, visual changes.

## 3. Decisions

Settled by design:

- **D1 Two layers where needed.** A hook cannot receive a value declared later in `App()` (TDZ at first render). Wherever a hook's inputs are not all available at its state lines, split it into a state layer called at the existing state lines and a behavior layer called where its inputs exist. A cycle between two layers is resolved by a getter closure (`() => value`, which keeps per-render capture), never by a ref.
- **D2 Always mounted.** Hooks are called unconditionally from `App()`. Dirty drafts and mount effects must survive mode and tab changes. Container components are stateless.
- **D3 Strictly sequential.** One PR at a time, each merged before the next branch is cut (`FUTURE-codebase-operability-improvements.md` forbids parallel slices on `dashboard.jsx`). While a PR is open no other PR touches its cluster.
- **D4 Quirks move verbatim** (section 4). They are preserved, not fixed.
- **D5 No new test dependency.** No jsdom. Effect-heavy behavior is proven by Playwright plus the DOM parity check; pure code gets Node unit tests; hook defaults get server-render probes.
- **D6 Dead code is deleted (operator decision, 2026-10-01).** The first source commit of each slice deletes the never-read declarations of its cluster (lists in the PR sections). Only inert declarations are deleted: unread `const`/function/ref declarations, unread `useState` pairs whose every setter call is batched with another state update in the same synchronous block (the commit message lists each removed setter call and why it is batched; otherwise leave the pair), and imports orphaned by the deletion.
- **D7 Safest path for the last Settings PR (operator decision).** `ST5` and the optional Scenario split `SC3` start only after the operator reviews the results of the preceding PRs and says go (G1, G2).
- **D8 Commit-gated execution (operator decision).** One commit at a time; after each commit the executor stops, reports the automated results, and gives the operator a validation scope. The next commit starts only after the operator confirms (section 5). The publishing unit stays one PR per slice, assembled from commits the operator has validated. This reading of "one commit at a time" is an assumption; correct it if you meant otherwise.

Gates (operator go/no-go, not open questions):

- **G1** before `SC3` (split the single Scenario hook into feature hooks): decide after `SC2` whether one hook of about 3,000 lines is acceptable.
- **G2** before `ST5` (shared-config bootstrap, save, modal shell): decide after `ST1`-`ST4` using their measured results.

## 4. Preserved quirks and invariants

Every commit re-checks the rows that apply.

| Area | Invariant |
| --- | --- |
| Scenario layout | `let scheduleScenarioEdgeUpdate;` (1081) is assigned at 11483 and sits in the layout effect's deps (10884), so that dependency is always `undefined`. Keep the `let` and its assignment in the same hook body; never in the state container; never replace it with `useCallback`. |
| Scenario closures | Drag effect deps `[scenarioDraggingIssueKey]` (9697) capture `releaseScenarioIssueLock` and draft ids at drag start; poll (9297) and SSE (9375) deps include `scenarioDraftLastEventNumber`, heartbeat (9323) does not; `scenarioIssuesByLane` omits `scenarioLaneForIssue` from its deps (10465); render-phase ref writes at 9187-9188 and 9478. `scenarioUndoVersion` is a re-render trigger only (its value is never read): keep its `useState`. |
| Scenario mount | `loadUiPrefs()` forces `showScenario=false`; the cluster fires no request on mount (the 7860 effect returns when `configRefreshNonce === 0`); startup `POST /api/scenario` count is 0. The 7860 effect reads `runScenario` inside a deferred closure and omits it from its deps; that stays valid when `runScenario` comes from a hook called later. |
| Scenario auth | Poll, heartbeat, SSE, and the three Scenario keydown handlers (9742, 10011, 11597) check `readPendingAuthenticationRequired()` or listen on `AUTH_REQUIRED_EVENT`; `window.SCENARIO_DRAFT_SSE_ENABLED` gates SSE. |
| Scenario shared | `perfCountersRef` is written at 10560, 10812, 10840, 11262, 11487, 11496 and read at 2356. `scenarioStartedRef` is owned by `useConnectionRecovery`. `BACKEND_URL` (338), `EMPTY_ARRAY` (316), and `EMPTY_OBJECT` (318) are module constants of `dashboard.jsx`: pass them to hooks as inputs (identity must not change); do not duplicate them. |
| Scenario sticky | `.scenario-fullbleed` stays a direct child of `.container` with no wrapper DOM. |
| Settings mount | The mount effect at 2136 (`loadConfig()` + `loadGroupsConfig()`) stays in always-mounted `App()` with its first-render closure until ST5. The `[showGroupManage]` open effect at 2184 snapshots values at open time; its deps do not change. |
| Settings closures | `loadConfig` has different identities today: the mount effect uses the first-render closure; the call sites at 4283 and 14873 use per-render closures. `saveAllSettings`, the hotkey effect (deps at 4324 include `saveAllSettings` and `requestCloseGroupManage`), and `loadConfig`'s dirty snapshot depend on per-render closures. Settings load/save functions stay per-render closures; hooks must not wrap them in `useCallback` or a latest-ref. |
| Settings draft snapshot | `settingsDraftSnapshotRef.current = {...}` is assigned during render at 810-821 and reads the drafts of the priority-weights, projects, board, capacity, and field-picker sections (10 keys). It stays a render-time assignment in `App()`; section hooks return a plain `draftSnapshot` value. All section hooks must be called before it. |
| Settings save order | Admin sections save sequentially: `projects` (`POST /api/projects/selected`), `priorityWeights` (`/api/stats/priority-weights-config`), `board` (`/api/board-config`), `capacity` (`/api/capacity/config`), then the five field configs (`/api/{sprint-field,parent-name-field,story-points-field,team-field,delivery-owner-field}/config`), then `issueTypes` (`/api/issue-types/config`); each carries `baseRevision`. `projects`, `priorityWeights`, `board`, `capacity`, and `issueTypes` commit the revision internally; the field saves use `commitSharedConfigRevision(await saveXFieldConfig(sharedConfigRevisionRef.current))` (the five save functions live in `frontend/src/settings/useJiraFieldPickers.js:183-215`). `adminAccess.save()` is not a workspace-config write: it sends `POST`/`DELETE` to `/api/admin/users/{id}/admin-grant` with no `baseRevision`, in parallel via `Promise.all`. Groups then post to `/api/groups-config` (`baseRevision`, via `buildSharedGroupsPayload`). Outside first-run, personal preferences post inside `saveGroupsConfig` (3855), then a `GET /api/config` refresh runs (3882), then EPM saves (4094). In first-run the preference POST follows EPM (4120). EPM saves independently of every shared revision and conflict state. `saveProjectSelection` (5035-5049) sets `groupSaving` false in its `finally` mid-sequence. |
| Settings bootstrap vs save | The post-save refresh (3882-3897) updates a different flag subset than bootstrap: it omits `setUserIsToolAdmin`, `setPerformanceAdminAvailable`, `setJiraUrl`, `setGroupQueryTemplateEnabled`. `settingsAdminOnly` is set via `Boolean(config.settingsAdminOnly)` (3887, 6865), so a missing flag leaves `canEditSharedConfiguration === true`: preserved quirk, pinned by a unit assertion. |
| Settings ownership | `userCanEditSettings` and `userCanEditEpmConfig` default `false`, set only with `=== true`; `settingsAdminOnly` defaults `true`. Admin tabs need `canEditSharedConfiguration`; the Settings EPM tab needs `canEditEpmConfiguration`. The Access tab shows when `adminAccessAvailable = !adminUserManagementAvailable || userIsToolAdmin` (694); in Basic mode it shows an informational card. 409 keeps the user's draft; 401 delegates to the global auth gate and is never replayed. EPM data stays in the owning user's private saved view and never enters workspace configuration. Department groups, labels, memberships, exclusions, and board layouts are shared once per workspace; stars, favorites, visibility, and active group are private, and in `groupsConfig.source === 'workspace_db'` mode never touch `defaultGroupId` (the legacy non-DB `toggleDefaultGroupDraft` at 3585 does write it). |
| Settings lazy fetch | With a `sharedConfig` object in `/api/config`, nothing in the shared-config sections fetches before the modal opens. `loadConfig`'s fallback branch (6919-6937, when `sharedConfig` is absent) fetches those sections at mount, and the EPM sub-goals effect at 2765 fetches on the EPM view without the modal: both stay as they are. `useAdminAccessSettings` stays gated on `available && active`; the team lifecycle stays gated on the modal being open. |
| Startup | `tests/ui/codebase_structure_smoke.spec.js:1236-1259`: exactly one each of `GET /api/config`, `/api/version`, `/api/groups-config`, `/api/sprints`; zero for `projects/selected`, `board-config`, `capacity/config`, `priority-weights-config`, the field configs, `issue-types/config`, `/api/teams`, `/api/teams/all`, and `POST /api/scenario`. That spec asserts only four of the five field endpoints: PR0 adds `delivery-owner-field/config`. |

## 5. Execution model: commit ladder and operator validation

Every slice is a sequence of commits. After **each** commit the executor:

1. runs the commit's automated checks (section 6) and reads every result,
2. runs `git show --stat HEAD` and `git status` and reads them (the commit contains exactly the intended files; a rename that shows `| 0` has no content change),
3. reports to the operator: commit SHA, files changed, the automated results, and a **Validation scope** (what to open in the running app, what to do, what must still be true),
4. **stops** until the operator replies that the commit is validated. No further commit, push, or PR step happens first.

Commit ladder per slice (a slice omits a rung it does not need):

| Rung | Contents | Operator validation |
| --- | --- | --- |
| R1 Dead code | Delete the slice's inert never-read declarations (D6) and nothing else. | The slice's smoke scope. |
| R2 Tests | New characterization tests, fixtures, parity captures; they pass on the unmodified source. No source change. | Review the diff; no app check. |
| R3 Prep | Hoists that make a later move legal (for example moving a pure primitive above the state lines). | The slice's smoke scope. |
| R4 Move | Verbatim move(s) of the claimed statements into the hook or component, with the rebuilt `frontend/dist`. One rung per hook or component. | The rung's validation scope. |
| R5 Ledger | Guard ledger changes, budget ratchet, lint-ceiling ratchet, ontology and plan-status updates. No behavior change. | Review the diff; no app check. |

Smoke scopes used by the PR sections:

- **Scenario smoke (SM-S):** ENG tab, Scenario mode: Run Scenario; bars render; toggle lane mode Team / Epic / Assignee; collapse and expand a lane; click an epic bar (focus) then press Escape; hover a bar (tooltip near the viewport edge too); Edit, drag a bar, see the override count, Ctrl+Z; Save draft; open History, close with Escape; switch Department group away and back (lane mode and collapse restored); reload with an unsaved override (recovery restores it).
- **Settings smoke (SM-T):** open the Settings gear: Departments, Admin, Connections, and EPM tabs and their sub-tabs render; edit one field in a section, the Unsaved-changes indicator appears; Save closes the modal; reopen and the value persisted; edit again and close to see the discard prompt.

## 6. Verification tooling and per-commit checks

**Environment.** A worktree has no `.venv`; use the main checkout's interpreter via `JEP_TEST_PYTHON`. Node uses the pinned runtime. Run `npm ci` once in a fresh worktree before the first build.

```bash
PY="${JEP_TEST_PYTHON:-.venv/bin/python}"
NODE="fnm exec --using 20"

# Node unit tests (baseline: 1529 pass)
$NODE node --test tests/test_*.js

# Python suite (baseline: Ran 2006 tests, OK, skipped=25); explicit env so a local .env cannot leak in
JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local \
ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' \
"$PY" -m unittest discover -s tests

# Build, then prove the committed dist is current (build first, commit dist, then verify)
$NODE npm run build
make verify-dist-clean

# Extraction lint gate (this section, below)
$NODE bash scripts/extraction_lint/run.sh

# Full UI gate before any push (about 8 minutes; set JEP_TEST_PYTHON in a worktree)
$NODE npx playwright test tests/ui --browser=chromium --workers=4
```

**Extraction lint gate.** esbuild does not report an identifier left behind by a move, and `no-undef` alone passed a seeded defect in review. The gate has four parts, all of which must pass with zero findings: `no-undef`, `react/jsx-no-undef`, `no-use-before-define` (variables:false, so it flags render-phase reads of a binding declared later in the same function, which is the hook-order failure), and a hook-interface check (every name destructured from a local `useX()` call exists in the hook's returned object). `no-unused-vars` warnings may not exceed the recorded ceiling (the ceiling is lowered, never raised, as orphan imports are cleaned up). It is also the derivation tool for hook inputs: write the hook with an empty parameter list, run the gate on the new file, and add exactly the names `no-undef` reports as parameters; then the gate on `dashboard.jsx` reports every input that is declared after the call site.

Files created in PR0 (`scripts/extraction_lint/` is the first content of that directory):

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
// Verify every name destructured from a local `useX()` call exists in that hook's returned object literal.
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';

const entry = path.resolve(process.argv[2]);
const parse = (file) => espree.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } });
const resolveImport = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.js`, `${base}.jsx`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
};
function walk(node, visit, skipFunctions = false) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        const value = node[key];
        const children = Array.isArray(value) ? value : [value];
        for (const child of children) {
            if (child && typeof child.type === 'string' && !(skipFunctions && /Function/.test(child.type))) walk(child, visit, skipFunctions);
        }
    }
}
function hookReturnKeys(file, exportedName) {
    const ast = parse(file);
    let fn = null;
    for (const node of ast.body) {
        if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'FunctionDeclaration' && exportedName === 'default') fn = node.declaration;
        if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration' && node.declaration.id.name === exportedName) fn = node.declaration;
        if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
            for (const declarator of node.declaration.declarations) {
                if (declarator.id.name === exportedName && /Function/.test(declarator.init?.type)) fn = declarator.init;
            }
        }
        if (!fn && node.type === 'FunctionDeclaration' && node.id.name === exportedName) fn = node;
    }
    if (!fn) return { keys: null, reason: 'hook function not found' };
    const keys = new Set();
    let unknown = false;
    let sawReturn = false;
    walk(fn.body, (node) => {
        if (node.type !== 'ReturnStatement') return;
        sawReturn = true;
        if (!node.argument || node.argument.type !== 'ObjectExpression') { unknown = true; return; }
        for (const property of node.argument.properties) {
            if (property.type === 'SpreadElement') unknown = true;
            else keys.add(property.key.name ?? property.key.value);
        }
    }, true);
    return { keys, unknown: unknown || !sawReturn };
}

const ast = parse(entry);
const imports = new Map();
for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
    const resolved = resolveImport(entry, node.source.value);
    for (const specifier of node.specifiers) {
        const exported = specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name;
        imports.set(specifier.local.name, { resolved, exported });
    }
}
let checked = 0;
const problems = [];
walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'ObjectPattern' || node.init?.type !== 'CallExpression') return;
    const callee = node.init.callee;
    const name = callee.type === 'Identifier' ? callee.name : null;
    if (!name || !imports.has(name)) return;
    const { resolved, exported } = imports.get(name);
    if (!resolved) return;
    const { keys, unknown, reason } = hookReturnKeys(resolved, exported);
    if (!keys) { problems.push(`${name}: ${reason}`); return; }
    checked += 1;
    const wanted = node.id.properties.filter((p) => p.type === 'Property').map((p) => p.key.name ?? p.key.value);
    const missing = wanted.filter((key) => !keys.has(key));
    if (missing.length && !unknown) problems.push(`${name} (line ${node.loc?.start?.line ?? '?'}): destructured but not returned -> ${missing.join(', ')}`);
    else if (missing.length) problems.push(`${name}: return uses a spread or non-literal; cannot verify ${missing.length} names`);
});
console.log(`checked ${checked} hook call sites in ${path.basename(entry)}; problems: ${problems.length}`);
problems.forEach((problem) => console.log(`  ${problem}`));
process.exitCode = problems.length ? 1 : 0;
```

`scripts/extraction_lint/run.sh`

```bash
#!/usr/bin/env bash
# Extraction safety gate. Installs its tools into gitignored tmp/lint (no repo dependency).
set -euo pipefail
cd "$(dirname "$0")/../.."
LINT_DIR=tmp/lint
MAX_WARNINGS="${EXTRACTION_LINT_MAX_WARNINGS:-149}"   # ratchet: lower this as orphan imports are removed
if [ ! -x "$LINT_DIR/node_modules/.bin/eslint" ]; then
    mkdir -p "$LINT_DIR"
    npm install --prefix "$LINT_DIR" --no-audit --no-fund eslint@9 globals eslint-plugin-react eslint-plugin-react-hooks espree
fi
cp scripts/extraction_lint/eslint.config.mjs "$LINT_DIR/eslint.config.mjs"
cp scripts/extraction_lint/check_hook_interfaces.mjs "$LINT_DIR/check_hook_interfaces.mjs"
"$LINT_DIR/node_modules/.bin/eslint" --no-config-lookup -c "$LINT_DIR/eslint.config.mjs" --max-warnings "$MAX_WARNINGS" frontend/src
node "$LINT_DIR/check_hook_interfaces.mjs" frontend/src/dashboard.jsx
```

Document the command and install note in `tests/README.md` (PR0). If PR0 measures a warning count different from 149 on the unmodified tree, set `MAX_WARNINGS` to the measured value.

**Per-commit checks by rung.** R1, R3, R4: lint gate, Node suite, Python suite, build plus committed dist plus `make verify-dist-clean`, the slice's targeted Playwright specs, DOM parity diff empty. R2: the new tests pass on unmodified source; no source change. R5: everything above plus the full Chromium `tests/ui` run (also required before any push).

**Guard ledger.** Every PR description carries a ledger: for each guard that fails after a move, whether it is an invariant pin (re-point to the new owner file, keep) or a shape/order guard (delete, naming the behavioral test that covers the behavior). Do not edit a guard that still passes. A retained negative pin ("this text must not appear") must read the owner files through `readOwnerSource` with a positive anchor (PR0) so it cannot go vacuous when code moves. Section 7 lists the known guards and when each first breaks.

**Orphans and destructures.** After each R4, remove imports and destructured names the move made unused (the `no-unused-vars` ceiling catches them), and prune names from the `App()` destructure that no `App()` code reads any more.

**DOM parity.** `JEP_DOM_PARITY_DIR=tmp/dom-parity/before` is captured before the first R4/R3 of a slice and `.../after` after each R4; `diff -r tmp/dom-parity/before tmp/dom-parity/after` must print nothing. Commands use `-g 'dom parity'` plus the instrumented tests named in PR0.

## 7. Guard ledger (known guards, first break)

51 files reference `dashboard.jsx`: 19 UI specs bundle it with esbuild (none read it as text); of the 32 others, 4 mention it only in comments, `tests/test_codebase_structure_budgets.py` counts lines, and 27 are text guards. 16 are listed here; the other 11 (`test_dashboard_epic_icon_source_guards`, `test_dashboard_missing_labels_source_guards`, `test_eng_board_drop_source_guards`, `test_eng_sticky_stack_source_guards`, `test_initiative_grouping_source_guards`, `test_initiative_icon_source_guards`, `test_jira_export_source_guards`, `test_stats_controls_source_guards`, `test_stats_module_extraction_source_guards`, `test_story_subtasks`, `test_task_filter_menu_compaction_source_guards`) were checked and none breaks on its own; re-run them at every commit regardless.

| Guard | Pins | First breaks | Disposition |
| --- | --- | --- | --- |
| `tests/test_scenario_draft_history_source_guards.js` (18 tests) | poll `setInterval(poll, 5000)`, `SCENARIO_PRESENCE_TTL_MS = 30000`, drag effect deps, literals, declaration and JSX order; slice regexes end at markers in other slices (`scenarioLaneForIssue`, `scenarioSprintBounds`, `toggleScenarioEditMode`); `:72` needs `scenarioDraggingIssueKey` directly before the drag effect; `:52` spans `pollScenarioDraftEvents` through `saveScenarioDraftVersion`; the "dist changes require src changes" test | SC2 (most tests, all at once) | Re-point the three invariant pins and the `:72`/`:52` regexes to `useScenarioPlanner.js`; delete order/shape guards naming the covering specs. The dist test stays untouched. |
| `tests/test_auth_isolation_source_guard.js` | exactly six `window.addEventListener('keydown', X)` calls each latch-checked; `:96-105` slices `saveEpmConfig` to `normalizeStatus` | PR0 (widen); ST2 (that slice empties) | Count per file over `dashboard.jsx` plus every file under `frontend/src/scenario/` and `frontend/src/settings/`; re-point the EPM slice to the new owner in ST2. |
| `tests/test_frontend_api_source_guards.js` | `:1469` scenarioApi import; config/jiraCatalog imports; `:11-17` "save auth outcomes stay in dashboard"; `:1204` `saveGroupsConfig` marker plus `invalidate('settings-save')`; repo-wide no-`fetch(`/no-`/api/` scan (`:196-217`) | SC2, ST1, ST5 | Re-point import and marker checks; keep the repo-wide scan unchanged. |
| `tests/test_excluded_capacity_stats_source_guards.js:841-855` | `buildScenarioPayload` regex assumes 12-space indent | SC2 | Re-point and make indentation-agnostic. |
| `tests/test_epm_settings_source_guards.js` | prop spreads vs child props (`:162-179`), declaration strings (`:157` teamSearchQuery, `:161` priorityWeightsDraft, `:251` hasDraftEpmScope, `:765` `await savePriorityWeightsConfig();`), hotkey order, fail-closed assignments (`:644-671`) and negative pins (`:673-679`), EPM seed only from the private view (`:688-694`), workspace-conflict sections exclude EPM (`:706-709`) | ST1 (`:161`, `:765`), ST2, ST3 (`:157`), ST5 | Keep as pinned guards on the new owners: the EPM seed pin, the conflict-section exclusion, the prop-parity check rewritten for the new containers. Convert the fail-closed assignments and negative bans (`userCanEditSettings !== false`, `canEditSharedConfiguration \|\| userCanEditEpmConfig`) into unit assertions on the permissions code (ST5) with inputs `true`, `'true'`, `1`, `undefined`, `null`, and a missing key. Until ST5, keep the text pins on `dashboard.jsx` via `readOwnerSource`. |
| `tests/test_first_run_group_configuration.js` | `:74-97` capture/restore cover all 11 admin sections; declaration-order slices; `:544-573` `saveGroupsConfig`/`saveAllSettingsOnce` slices | ST4 (order slices), ST5 (`:544-573`) | Keep the section-coverage test and re-point it; add a key-parity test across the save map (3630-3642), the capture object (1284-1296), the restore function (4194-4226), `FIRST_RUN_ADMIN_SECTION_KEYS`, and the 10-key snapshot (810-821). Keep the reducer tests. |
| `tests/test_team_catalog_lifecycle_source_guards.js` | `} = useTeamCatalogLifecycle({`, `buildTeamAvailability({`, `recoverCatalogsAfterRejectedBoardSave` | ST3, ST5 | Re-point. |
| `tests/test_analytics_source_guards.js` | `:500-504` slices `retryFirstRunConfiguration` (5421) to `filteredGroupDrafts` (5449); `openFirstRunSetupChoice` slice bans analytics/`fetch(`/`onboardingDone`/`groupSearchQuery` | ST3 (end marker moves; `indexOf` returns -1 and the slice runs to end of file), ST4 | Re-point both slices; assert both markers exist. |
| `tests/test_onboarding_tour_utils.js` | `setCompletedModules`/`setGroupPreferences`, `onboardingBootstrapReady`, `openGroupManage(configurationTourRequested ? 'teams' : preferredSettingsTab)`, `data-onboarding-target="settings-launcher"` (gear JSX, 15091) | ST5 | Re-point. |
| `tests/test_epm_view_source_guards.js` | `epmConfigLoaded` state, `applySavedEpmConfig` call in `loadConfig`, "Open EPM settings" gear markup, `openEpmSettingsTab` | ST2, ST5 | Re-point. |
| `tests/test_planning_action_source_guards.js:278` | exactly two `setCapacityEnabled(Boolean(...capacityConfigRequiresResolution...))` | ST5 (both sites, 3886 in `saveGroupsConfig` and 6863 in `loadConfig`, move) | Re-point and keep the count across the owner files. |
| `tests/test_eng_board_runtime_source_guards.js`, `tests/test_strict_eng_board_integration.js`, `tests/test_eng_board_source_guards.py` | `acceptedGroupsConfigRef.current = false;` (only at 2645, inside `loadGroupsConfig`), `acceptedBoardConfigRef.current = false;` (5 sites, 4 in `saveGroupsConfig`), the `loadSprints(false)` line, `if (showScenario) return scenarioJiraStoryKeys;` | ST3, ST5 | Re-point to the owners; the `showScenario` line stays in `dashboard.jsx`. |
| `tests/test_epm_shell_source_guards.js:60`, `tests/test_dashboard_alert_source_guards.js:88` | `selectedView === 'eng' && showScenario`, `isCatchUpMode` regex | never, if the shell text stays | Must keep passing unmodified. |
| `tests/test_codebase_structure_budgets.py` | `dashboard.jsx` ceiling | every R5 | Lower to the measured count. |

## 8. PR-1: Land this plan on `main`

**Why:** every later PR cuts from `origin/main`, which does not contain this plan, and an execution handoff must only be published once the referenced plan is fetchable from the named remote ref.

**Branch:** `docs/dashboard-scenario-settings-extraction-plan` (already holds the draft commit and this revision).

- [ ] Run the second independent review of revision 2 (section 14) and fold its findings in; the plan stays `Proposed` until it passes.
- [ ] Follow the publication transaction in root `AGENTS.md` section 10 in full: fetch the base; record the base and head SHAs; run `git status --short`, `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`; compare the commit list and changed paths with this section (three docs files: this plan, `docs/plans/README.md`, `docs/plans/FUTURE-codebase-operability-improvements.md`); stop on any mismatch; run the checks that apply to a docs-only change at the exact head; wait for the operator's explicit confirmation; send the PR body through stdin with `gh pr create --body-file -`; then prove the remote head equals the approved local head, read back the rendered body, inspect the PR page, verify the remote changed-file list and commit count, and report the actual CI state.
- [ ] Merge, then `git fetch` and confirm the plan is on `origin/main` before PR0 starts.

---

## 9. PR0: Tooling, coverage, and baselines

**Branch:** `improvement/dashboard-extraction-tooling`. Source commits in this PR change tests, scripts, and docs only; no `dashboard.jsx` change, so no budget change.

**Files:**
- Create: `scripts/extraction_lint/eslint.config.mjs`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/run.sh` (section 6), `tests/ui/helpers/domParity.js`, `tests/frontend_source_helpers.js`
- Modify: `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/test_auth_isolation_source_guard.js`, `tests/README.md`, `docs/ontology.md`, this plan (record the baselines in section 1)

### Commit P0-1 (R2): lint gate

- [ ] Add the three files from section 6 and the `tests/README.md` note. Run `$NODE bash scripts/extraction_lint/run.sh`; it must pass on the unmodified tree. If the warning count is not 149, set `MAX_WARNINGS` in `run.sh` to the measured count.
- [ ] Negative controls (do not commit the probe files): in `tmp/`, copy `frontend/src/dashboard.jsx` and (a) delete the `SettingsModal` import, (b) insert `const __probe = engWorkspaceConfigured;` after the `scenarioLoading` state line, (c) add a name to a hook destructure that the hook does not return. The gate must fail each one. Record the three failures in the commit message.

**Validation scope:** none in the app. The operator confirms the negative-control results and the script.

### Commit P0-2 (R2): DOM parity helper and Settings capture

- [ ] Create `tests/ui/helpers/domParity.js` (a new directory with its first real file; Playwright's default `testMatch` does not run it):

```js
const fs = require('node:fs');
const path = require('node:path');

// Opt-in DOM parity capture for behavior-preserving refactors. Set JEP_DOM_PARITY_DIR to a
// gitignored folder (for example tmp/dom-parity/before) to write one normalized HTML file per label.
async function captureDomParity(page, label, selector) {
    const dir = process.env.JEP_DOM_PARITY_DIR;
    if (!dir) return;
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
    const html = await page.locator(selector).first().evaluate((root) => root.outerHTML);
    const normalized = html
        // React useId values (for example _r_3_) depend on hook order, which these refactors change.
        .replace(/_r_[0-9a-z]+_/g, '_r_#_')
        // The EPM Projects tab renders wall-clock fetch time.
        .replace(/fetched \d{1,2}:\d{2}/g, 'fetched HH:MM')
        .replace(/></g, '>\n<');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${label}.html`), `${normalized}\n`);
}

module.exports = { captureDomParity };
```

- [ ] In `tests/ui/settings_unified_save.spec.js` add an opt-in test. Top-level Settings tabs are `.group-modal-tab` buttons (`SettingsModal.jsx`); sub-tabs are `role="tab"` (Departments, Admin, EPM); "Group labels" is disabled unless labels are enabled, so guard every click. `mockConfigSettings` already returns `userCanEditEpmConfig: true`, so the EPM tab renders. Add `const { captureDomParity } = require('./helpers/domParity');` at the top and:

```js
test('dom parity capture: every Settings tab', async ({ page }) => {
    test.skip(!process.env.JEP_DOM_PARITY_DIR, 'opt-in refactor check');
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const topTabs = dialog.locator('.group-modal-tab');
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
});
```

- [ ] Extend the same file's existing tests with one `await captureDomParity(...)` line each (no-op without the env var) at the point where the state is visible: the discard-confirm state, a workspace-conflict state, and the first-run states, using the test names in that file that already reach them. Read the file to choose; each added call names its state in the label.
- [ ] Add `delivery-owner-field/config` to the zero-request startup assertions in `tests/ui/codebase_structure_smoke.spec.js` next to the four field endpoints it already lists.
- [ ] Determinism check: run the parity tests twice on the unmodified tree into `tmp/dom-parity/run1` and `run2`; `diff -r` must print nothing. If it prints differences (timestamps, animation state), extend the normalization until it is empty. Do not continue with a nondeterministic capture.

**Validation scope:** none in the app; confirm the two-run diff is empty and the new assertions pass.

### Commit P0-3 (R2): Scenario coverage that does not exist today

Existing Scenario specs never render an edge, a lane mode, a collapsed lane, epic focus, or a tooltip: every fixture has `dependencies: []`, `scenario_focus_positions.spec.js` is entirely commented out, and nothing tests the group-switch restore that SC1 changes. Add the following; all pass on the unmodified source.

- [ ] In `tests/ui/scenario_draft_history.spec.js` (add the `domParity` require at the top). First give `installDashboardFromSource(page, options)` an `options.dependencies` array (default `[]`) used where it builds the `/api/scenario` response (find the single place that returns `scenarioPayload()`; set `dependencies` from the option). Edges use `{ from, to }` keys (`validateDependencies`, `scenarioUtils.js:77`). Then:

```js
test('dom parity capture: lane modes, collapsed lane, edges, epic focus, tooltip', async ({ page }) => {
    test.skip(!process.env.JEP_DOM_PARITY_DIR, 'opt-in refactor check');
    await installDashboardFromSource(page, { dependencies: [{ from: 'PROD-1', to: 'PROD-2' }] });
    await openScenario(page);
    const root = '.scenario-fullbleed';
    await captureDomParity(page, 'scenario-team-lanes-edges', root);

    const laneButton = (name) => page.locator('.scenario-toggle-group').getByRole('button', { name, exact: true });
    await laneButton('Epic').click();
    await captureDomParity(page, 'scenario-epic-lanes', root);
    await laneButton('Assignee').click();
    await captureDomParity(page, 'scenario-assignee-lanes', root);
    await laneButton('Team').click();

    // Collapsing a lane renders its epic summary bars (.scenario-epic-bar).
    const laneLabel = page.locator('.scenario-lane-label').first();
    await laneLabel.click();
    await expect(laneLabel).toHaveAttribute('aria-expanded', 'false');
    await captureDomParity(page, 'scenario-team-collapsed-lane', root);

    await page.locator('.scenario-epic-bar').first().click();
    await expect(page.locator('.scenario-focus-indicator')).toBeVisible();
    await captureDomParity(page, 'scenario-epic-focus', root);
    await page.keyboard.press('Escape');
    await expect(page.locator('.scenario-focus-indicator')).toHaveCount(0);

    await page.locator('.scenario-bar').first().hover();
    await expect(page.locator('.scenario-tooltip.visible')).toBeVisible();
    await captureDomParity(page, 'scenario-tooltip', root);

    await page.getByRole('button', { name: 'Conflicts Only', exact: true }).click();
    await captureDomParity(page, 'scenario-conflicts-only', root);
});
```

Run the test headed once before the commit and confirm each state is on screen when it is captured (for example, that a collapsed lane really shows `.scenario-epic-bar` elements and that the tooltip is visible); a test that passes only because a locator matched nothing is a defect.

- [ ] In `tests/ui/scenario_draft_collaboration.spec.js` add `await captureDomParity(page, '<label>', '.scenario-fullbleed');` (no-op without the env var) after the last assertion of these existing tests: presence strip renders remote user (label `scenario-presence`), lock warning shows same-issue advisory conflict during drag (`scenario-lock-warning`), stale draftRevision shows recovery actions (`scenario-conflict-recovery`), write-back stays preview-only and blocked (`scenario-writeback-preview`).
- [ ] In the same file add the group-switch-and-back test SC1 depends on (it reuses `installDashboard`, `openScenario`, and the `Select group` / `.group-dropdown-option` pattern from `switchScenarioToAlternateGroup`; the fixture's groups are `Default` (`grp-default`) and `Alternate` (`grp-alt`)):

```js
test('group switch away and back restores Scenario lane mode and collapsed state', async ({ page }) => {
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

Run it against the unmodified source first. If the restored lane mode differs from the assertion, the test has found the real current behavior: assert that behavior (and say so in the commit message), not the one assumed here, because SC1 must preserve what exists.

**Validation scope:** none in the app; run the three Scenario specs headed once and confirm each new test exercises what its title says.

### Commit P0-4 (R2): Guard helper and auth-isolation widening

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

- [ ] Widen `tests/test_auth_isolation_source_guard.js`: run the existing handler lookup **per file** (it uses `source.lastIndexOf` per file) over `frontend/src/dashboard.jsx` and every `.js`/`.jsx` file under `frontend/src/scenario/` and `frontend/src/settings/`; assert the summed count is exactly six and each handler checks `readPendingAuthenticationRequired()` before its first `event.key`. It passes with no source change (the current files use `document.addEventListener`).

**Validation scope:** none in the app; the operator confirms the Node suite passes.

### Commit P0-5 (R2): Baselines and ontology

- [ ] Run the full Chromium `tests/ui` suite and record pass/fail/skip counts, wall time, and every pre-existing failure by name in section 1. Those failures are excluded from "must pass" later and listed in every PR description.
- [ ] Create `docs/ontology.md` entries "Scenario Planner ownership" and "Settings state ownership" (canonical names, aliases, entry points in `dashboard.jsx` today, the extraction plan, tests, relationships `depends on`/`produces`), with a verification date; confirm every cited path resolves. Add the entries named in section 13 that cite `loadConfig`/`loadGroupsConfig` ("Board scope load authority", "Startup config timeout").

**Validation scope:** review the recorded baselines and the ontology text; no app check.

---

## 10. Scenario slices

All Scenario hook and component files live in `frontend/src/scenario/`. The Scenario dead-code list (R1; every name appears once in `dashboard.jsx` and nowhere else in `frontend/src` or `tests`): `scenarioBottleneckLanes`, `scenarioDeadlineLeft`, `scenarioHasAssignees`, `scenarioIsSingleTeamFocus`, `scenarioUnschedulable`, and the value of `scenarioDraftEvents` only if every `setScenarioDraftEvents` call is batched with another update (otherwise leave the pair, D6). `scenarioUndoVersion` stays.

### SC1: State container and per-group seam

**Branch:** `improvement/scenario-state-container`. Targeted specs: the three Scenario specs, `tests/ui/codebase_structure_smoke.spec.js`.

**Files:** create `frontend/src/scenario/useScenarioState.js`, `frontend/src/scenario/scenarioGroupState.js`, `tests/test_scenario_group_state.js`; modify `frontend/src/dashboard.jsx`, budget test, docs.

**Interfaces.** `useScenarioState({ initialLaneMode })` returns, under the same names as today, every `useState` value and setter and every `useRef` declared at 463-466 (`scenarioCurrentUserIdentity`, its setter), 998-1010, 1012-1080, 1082-1096, and 1151 (`scenarioRefreshNonceRef`). It excludes `searchInputRef` (1011, not Scenario) and `let scheduleScenarioEdgeUpdate` (1081, section 4). It also returns `scenarioGroupValues`, a `useMemo` object of the 14 per-group fields whose identity changes iff one of them changes. The 14 fields (from `buildDefaultGroupState` 5975-5998, the snapshot literal 6074-6087, the apply block 6189-6212, the memo deps 6292-6305): `scenarioData`, `scenarioError`, `scenarioLaneMode`, `scenarioCollapsedLanes`, `scenarioEpicFocus`, `scenarioRangeOverride`, `scenarioScrollTop`, `scenarioScrollLeft`, `scenarioViewportHeight`, `scenarioHoverKey`, `scenarioFlashKey`, `scenarioLayout`, `scenarioEdgeRender`, `scenarioTooltip`. `scenarioGroupState.js` exports `SCENARIO_GROUP_STATE_KEYS`, `buildDefaultScenarioGroupState(initialLaneMode)`, `applyScenarioGroupState(setters, snapshot)`, `resetScenarioTransientRefs(refs)`. The container has no effects and takes only `initialLaneMode` (all initializers depend on `savedPrefsRef` at 371).

**Commit ladder:**

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Delete the Scenario dead declarations above. | SM-S. |
| R2 | `tests/test_scenario_group_state.js` (below) and the P0-3 group-switch test already exist; add the server-render probe for the container defaults. | Review the diff. |
| R4 | Create the two files, wire `dashboard.jsx`: call `useScenarioState` once at the position of the earliest declaration (463) and destructure every returned name under its existing name; replace the 14 default entries with `...buildDefaultScenarioGroupState(savedPrefsRef.current.scenarioLaneMode)`, the 14 snapshot entries with `...scenarioGroupValues`, the 14 memo deps with `scenarioGroupValues`, the nine-ref reset lines (6110-6118 and 6120-6128; **not** 6119 `alertDismissedRef.current = false;` and **not** 6129 `epicRefMap.current = new Map()`, which stay) with `resetScenarioTransientRefs({ ...nine refs })` at the same position, and the 14 setter lines (6189-6212) with one `applyScenarioGroupState({ ...fifteen setters }, nextState)` at the position of the first setter line, leaving `setScenarioLoading(false)` inside the call (the original runs at 6232; the move is batched with the neighbouring updates). | SM-S, with emphasis on group switch away and back and lane mode persisting across a reload. |
| R5 | Ledger: `test_stats_module_extraction_source_guards.js` slices the per-group seam (its markers survive; verify); budget; lint ceiling; remove the now-orphan `createUndoStack` import (used only at 1065); ontology and status. | Review the diff. |

**Tests** (`tests/test_scenario_group_state.js`; the expectations are copied from the base code, so they also serve as the oracle). Written first; they fail on the missing module:

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

`resetScenarioTransientRefs` mirrors the original truthy checks (`if (ref.current) { cancelAnimationFrame(ref.current); ref.current = null; }`). The container server-render probe asserts the defaults of the cells whose defaults are not obvious (for example `scenarioSummaryHidden === true`, `scenarioEdgeRender`, `scenarioDraftMeta.dirtyState === 'clean'`).

### SC2: One verbatim Scenario hook

**Branch:** `improvement/scenario-planner-hook`. Targeted specs: `tests/ui/scenario_draft_history.spec.js`, `tests/ui/scenario_draft_collaboration.spec.js` (including the auth-lock test at `:1111`), `tests/ui/codebase_structure_smoke.spec.js:1184-1310`, `tests/ui/eng_group_board_view.spec.js`, `tests/ui/onboarding_tour.spec.js`.

**Why one hook:** the Scenario statements 7262-7794 are all effect-free arrow-function constants, and every Scenario effect (9156-11589) is contiguous with no non-Scenario effect between 9137 and 11601. Moving both runs verbatim, in original order, into one hook called once at the position of 9137 preserves effect order by construction and avoids cross-hook cycles. The review found that splitting by feature at this stage creates a draft/realtime cycle (`postScenarioRealtimeJson`) and an ordering failure (`scenarioIssueByKey`, declared at 9451, is read by the drag effect's deps at 9744).

**Files:** create `frontend/src/scenario/useScenarioPlanner.js`; modify `frontend/src/dashboard.jsx`, the guards in section 7, budget test, docs.

**Moves (all into the one hook, in original order):** `matchesScenarioSearch` (5662-5677) and `registerScenarioIssueRef` (5679-5686); `scenarioTeamIds` (8107-8112) if only Scenario code reads it (the gate decides); the whole of 7262-7794 (CSRF and realtime wrappers `postScenarioRealtimeJson` 7285, presence/lock helpers incl. `isTimestampExpired` 7347 which only Scenario helpers use, `applyScenarioDraftEvent` 7372, `pollScenarioDraftEvents` wrapper 7427, `buildScenarioDraftScope` 7488, `buildScenarioPayload` 7495, `scenarioDraftIdleActionState` 7513, `runScenario` 7527-7679, `toggleScenarioEditMode` 7681-7694, lock functions 7696-7747, `handleScenarioBarMouseDown` 7749-7794); and the whole of 9137-11601 (derivations, draft state machine, realtime effects, derived memos, drag/undo, history 9748-10350 including `runScenarioHistoryAction` 10229-10350, write-back 10145 and 10186, lane/stacking/positions 10352-11151, tooltips 11177-11258, edges 11260-11418, focus and scroll to 11601). It stays out: the JSX, the per-group seam from SC1, the clear/reset entry points at 2086-2090, 6453-6478, 7118-7121, the view-mode effects 6497-6532, and the 7860 effect.

**Interfaces.** The hook takes the SC1 container object, the three module constants (`BACKEND_URL`, `EMPTY_ARRAY`, `EMPTY_OBJECT`), and every other free variable the moved code reads, **derived by the lint procedure in section 6, not by hand**: write the hook with an empty parameter list, run the gate on `useScenarioPlanner.js`, add the reported names as parameters, then run the gate on `dashboard.jsx`; any parameter it reports as used before its declaration blocks the commit (the review found, for example, that the draft code never reads `engWorkspaceConfigured`, declared at 12074, so it must not be passed). It returns a flat object of exactly the names the reference scan finds outside the moved ranges (about 85 JSX names, the 14440-14459 recovery snapshot reads `scenarioHasUnsavedChanges`, `scenarioDraftMeta`, `scenarioOverrides`, `scenarioEditMode`, `scenarioTimelineRef`, the export keys `scenarioJiraEpicKeys`/`scenarioJiraStoryKeys` read at 12182-12193, and `runScenario` read by the 7860 effect). The return must be an object literal (the interface checker cannot verify a spread). The call site is at the position of 9137.

**Commit ladder:**

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R2 | Server-render probe for the hook's return keys (`Object.keys` equals the destructured names) and pure tests for any Scenario helper that has no ref/DOM/closure reads (`scenarioDraftIdleActionState`, `buildScenarioDraftScope` if pure; oracle method: copy the legacy body into a throwaway script, run synthetic fixtures, store outputs next to the test). | Review the diff. |
| R4a | Create `useScenarioPlanner.js` containing the claimed ranges verbatim and wire the call site; everything else unchanged; dist rebuilt; DOM parity diff empty. | SM-S in full, plus: reload with an unsaved override (connection-recovery), Escape inside and outside History, Ctrl+Z. |
| R5 | Ledger per section 7 (`test_scenario_draft_history_source_guards.js`, `test_excluded_capacity_stats_source_guards.js:841-855`, `test_frontend_api_source_guards.js:1469`, `test_jira_export_source_guards.js`); budget; lint ceiling; prune the `App()` destructure; ontology; status. | Review the diff. |

**PR-specific checks:** the `useConnectionScenarioRecovery` call keeps its position after the auth-resume effect at 6367-6412; the Escape handler (10011) and undo keydown (9742) keep their relative order (the single hook preserves it); the six keydown listeners still total six; no `fetch(`/`/api/` literal in the new file; `new window.EventSource(buildScenarioDraftEventsStreamUrl(...))` stays; the ENG load effect cleanup still aborts an in-flight `runScenario` through `registerSprintFetch`/`cleanupSprintFetch` passed in as inputs. Expected `dashboard.jsx` change: about -2,900 lines (estimate from the ranges; record the measured value).

### SC3 (gate G1): Split the hook inside `frontend/src/scenario/`

Start only after the operator says go. `dashboard.jsx` is not touched again (this is why SC3 does not widen the D3 conflict window).

**Partition** (contiguous runs of the original order; the review found zero provider-called-later edges; each sub-hook is called in this order inside `useScenarioPlanner`): H1 draft (7262-7303, 7427-7679, 9143-9199, including `scenarioHasStoredDraftScope`, `scenarioActiveDraftId`), H2 realtime (7305-7425, 7696-7747, 9200-9375), H3 derived memos (9137-9142, 9376-9628, including `scenarioIssueByKey`), H4 drag/edit mode (7681-7694, 7749-7794, 9629-9746), H5 history (9748-10350), H6 layout (10352-11601 incl. `scenarioVisibleExportIssues` 10685-10702, `areScenarioCollapsedLanesEqual`, `areScenarioEdgeRendersEqual`). Each sub-hook returns an object literal, and `useScenarioPlanner` merges them with explicit keys.

**Pure extraction:** `frontend/src/scenario/scenarioLayout.js` receives only code with no DOM, ref, `performance`, or `console` reads. `scenarioLaneStacking` writes `perfCountersRef` and calls `performance.mark` (10559-10562) and `scenarioPositions` has a development-only `console.debug` (10893), so split the pure core from the instrumented wrapper (instrumentation stays in the hook). `computeScenarioEdgePaths` and anything using `scenarioIssueRefMap` or `getBoundingClientRect` stay in the hook. Extend `frontend/src/scenario/scenarioLaneUtils.js` and `tests/test_scenario_lane_utils.js` rather than creating a parallel module where the functions overlap. Oracle fixtures (synthetic) cover a single team, several teams, assignee mode, collapsed lanes, overlapping bars, and the empty case.

**Ladder:** R2 (oracle fixtures and tests), then one R4 per sub-hook in the order above (each with the DOM parity diff empty and the SM-S scope for the area it moves), then R5. Quirks stay intact: the `let scheduleScenarioEdgeUpdate` and its assignment stay together in H6; the layout effect deps array is unchanged.

### SC4: Scenario view component

**Branch:** `improvement/scenario-view-component`.

**Files:** create `frontend/src/scenario/ScenarioView.jsx`; modify `dashboard.jsx`, guards, budget, docs. **Moves:** the JSX block 16338-17214 rooted at `<div className="scenario-fullbleed">` (16339), including the tooltip JSX near 17190-17207. `dashboard.jsx` keeps `{selectedView === 'eng' && showScenario && engWorkspaceConfigured && ( <ScenarioView ... /> )}`.

**Props:** the JSX block uses 98 `App()` bindings: 92 Scenario-named and 6 others. The 6 others are `selectedSprint`, `normalizeEpicKey`, `excludedEpicSet`, and `requestReloadActiveDraft`, `cancelReloadActiveDraft`, `runReloadActiveDraft` (which come from the planner hook). `ScenarioView` receives `scenario` (the planner object) plus `selectedSprint`, `normalizeEpicKey`, `excludedEpicSet`. If SC3 has run, `scenario` is grouped (`draft`, `realtime`, `drag`, `layout`); otherwise it is the flat planner object, which is acceptable because it is one cohesive feature object, not a long list of separate props. It does not take `jiraUrl` or `selectedSprintInfo` (the JSX does not use them).

**Ladder:** R2 (parity captures for the JSX states already exist from P0-3), R4 (move the JSX, rebuilt dist, parity diff empty; validation SM-S with sticky order re-checked in Catch Up, Planning, and Scenario modes and before/after screenshots in the PR notes), R5 (delete the JSX-order guards in `test_scenario_draft_history_source_guards.js`, naming the Playwright assertions that cover each; `test_epm_shell_source_guards.js:60` and `test_eng_board_runtime_source_guards.js:50` pass unmodified). `.scenario-fullbleed` remains the component root and a direct child of `.container`. Expected change: about -870 lines.

After SC4, `rg -n '\bscenario[A-Z]\w*' frontend/src/dashboard.jsx` returns only hook call sites, the `showScenario` flag usages, the per-group seam, the export-key and recovery-snapshot reads, and the clear/reset entry points; list the remaining hits in the PR.

---

## 11. Settings slices

**Rules for every `ST*` PR.** (1) Ownership: each statement has exactly one owning PR, taken from the table below. Statements in no table row stay in `App()`, are listed in the PR description, and are not a defect. (2) Hook map: the PR description contains a generated map (hook, call-site line, inputs and their declaration lines) produced with the section 6 procedure. (3) Layering: a section hook is one hook when every input is available at its state lines; otherwise a state layer at the state lines plus a behavior layer where the inputs exist, both in one file. A remaining cycle is resolved with a getter closure, never a ref or latest-ref. (4) Read `backend/security/CONFIGURATION_OWNERSHIP.md` first. (5) Run the `docs/plans/GATE-*.md` sweep at the start of every ST PR (all touch config/auth/EPM surfaces); `GATE-05` (Home write capability) is not a dependency because no slice adds a Home/Townsquare path.

**Ownership table (exclusive; base line numbers).**

| PR | Owns |
| --- | --- |
| ST1 | Layer-0 hoists: `commitSharedConfigRevision` (4882-4886) and the `useSettingsConfigBaselineRevision()` call (806-809) move up inside `App()` to just before 705; both depend only on 643-644 (which stay in `App()` until ST5) and on nothing declared later. Priority weights: state 705-708, dirty memo 2731-2733, validation 2965-2984, load and mutators 4860-4880, 4900-4911, 4928-4938 (`updatePriorityWeightDraft`, `resetPriorityWeightsDraft`), `effectivePriorityWeightsRows` (consumed at 7885). Capacity mapping draft: state 766-774, dirty memo 2737-2740, functions 5051-5084, 5190-5260 (not the Planning capacity read at 982-997/12742-13005, not `PlanningTeamCapacityCards`/`updateCapacity` at 17248-17272, not `capacityEnabled` 982). Jira projects / source board / issue types / field catalog: state 709-717, 749-765, 775-780 (`jiraFields`, `loadingFields`), 804-805, 822-826, dirty memos 2727-2729, 2735, 2742-2744, functions 4326-4420, 4800-4858, 4888-4898 (`saveBoardConfig`), 5035-5049 (`saveProjectSelection`), 5086-5188; `useJiraFieldPickers` stays as is. The tab JSX in 17493-17687 (Connections and Admin bodies, including the large `JiraFieldSettings` spread) moves to stateless containers in `frontend/src/settings/`. |
| ST2 | EPM settings: state 489-518, 522-540 (519-521 are the modal tab ids and belong to ST5), refs 1144-1148, handlers 1362-1892, 3106, 3123-3136 (`openEpmSettingsTab`, `focusEpmScopeField`, `handleEpmSettingsTabKeyDown`), normalization and memos 2466-2608, dirty and saved scope 2746-2768, project rows 2849-2932, effects 1667-1699, 2235-2335, 2765, 2856-2879, JSX 17688-17777. Plus the prep hoist of the pure `getLabelRowKey` (5508) to module scope. |
| ST3 | Team Groups / Labels / board layouts: state 605-617 (including the group read fences 613-615, so the `acceptedGroupsConfigRef` text pin moves with it), 626, 641, 652-680 except 656-657 and 678-679 (ST5), 718-736; `loadGroupsConfig` 2610-2657, `handleGroupDraftChange` and `loadTeamsFromCurrentView` 2659-2672, `activeGroupDraftId` normalising effect 2337-2351, draft mutators and team search 3234-3611 except the app-update notice 3340-3353 (not Settings; stays), `applySavedGroupsConfig` 3612-3625, `handleComponentSearchKeyDown` 4570-4593, debounced searches 4423-4569, epic helpers 4594-4798, export/import 5262-5345, team directory memos 5347-5380, team-results block 5464-5487, `filteredGroupDrafts` 5449, label search 5508-5660, dirty and validation 2710-2725, 2945, 2987; the `useGroupVisibilityPreferences` call (1253) and `applyPreferenceGroupsSnapshot` (1218-1228) (the hook's inputs and outputs feed Team Groups both ways, so the Team Groups behavior layer calls it at that position); JSX tab strip 17778-17815, `TeamGroupsSettings` 17816-17934, Labels tab 17935-18092, `GroupBoardsTab` 18093-18120, group-board props 14926-14942. |
| ST4 | First-run: 629-638 (but `settingsSaveInFlightRef` 639 stays with ST5), 1268-1348, 5382-5447, JSX 18125-18149 (the `<OnboardingTour>` at 18150-18166 stays). The onboarding controller (3042-3084, `useOnboardingController` at 3056) and `onboarding.replay` (14848-14868) stay in `App()`; `closeGroupManage` (2679) is already declared before the controller, so there is no cycle. Handlers that call `saveAllSettings` (`retryFirstRunConfiguration` 5443, `keepMine*` 4253/4275) receive a getter `() => saveAllSettings` until ST5. |
| ST5 (gate G2) | Permissions: 685-704 (including 694 `adminAccessAvailable` with its exact expression, and the `adminAccess` hook call 696-700; `performanceGate` 688, `activePerformanceLoadRef` 689, `performanceLoadRevision` 690 are ENG load performance and stay). Shared-config snapshot and save: 639, 642-651, aggregates 2934-3041 (`saveBlockedReason` 3033), `buildSettingsSaveOutcome` 3627, `saveGroupsConfig` 3629-4006, `saveAllSettingsOnce` 4008-4182, `saveAllSettings` 4184-4192, restore/return 4194-4244, conflict exits 4249-4285, and the Settings part of `loadConfig` (6760-6966, statements 6861-6949 interleaved with non-Settings writes). Modal shell: 519-521, 625, 656-657, 678-679, 682, 859, functions 2674-2708, 3086-3105, 3117, 3137-3232, 14783-14841, 14948-14958, effects 2175, 4287-4324, 5488, 5500, JSX gears 15075-15112 and `<SettingsModal>` shell 17457-17492. |

Settings outputs read outside these ranges are listed in the PR description and kept stable by name: 5843-5844 and 6394-6399 (auth resume; fail-closed tab checks), 12449-12460 (`saveSharedExcludedCapacityToggle` uses `applySavedGroupsConfig`), 14440-14443 (`dirtySettings`), 2387-2424 (perf snapshot reads `showGroupManage`, `groupSaving`), 2145/8428/8688/8836/12074/15187 (`adminSettingsGate`), 5728-5780 and 5762-5764 (saved projects/board and strict-board revision).

**Dead code (R1) per PR:**

- ST1: `fetchJiraBoards` (4340), `jiraBoards`/`loadingBoards` (751-752), and the orphaned import `fetchBoards as requestJiraBoards` (251).
- ST2: `hasDraftEpmScope` (2849); its declaration string is pinned at `tests/test_epm_settings_source_guards.js:251`, so that guard is updated in the same commit.
- ST3: `updateGroupDraftTeams` (3330), `toggleTeamInGroup` (3355) (unread everywhere), the `parseTeamIdList` import (211) if it becomes orphaned, and the unused `setShowGroupManage`/`setGroupManageTab`/`setDepartmentSettingsTab` arguments passed to `useGroupVisibilityPreferences` plus their destructuring at `frontend/src/settings/useGroupVisibilityPreferences.js:37-39`.
- ST5: `lastCommittedWorkspaceSectionsRef` (writes only, at 3917 and 4029) and `groupQueryTemplateEnabled` with its setter (681, 6864). The UI fixtures also mock a `groupQueryTemplateEnabled` response key; leave the fixtures untouched.

### ST1: Shared-config section hooks

**Branch:** `improvement/settings-shared-config-sections`. Targeted specs: `tests/ui/settings_unified_save.spec.js`, `tests/ui/settings_admin_access.spec.js`, `tests/ui/jira_field_picker_read_race.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js`, `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/codebase_structure_smoke.spec.js` (zero shared-config reads before the modal opens with `sharedConfig` present).

**Hooks:** `usePriorityWeightsSettings`, `useJiraProjectSettings` (projects, board, issue types, field catalog), `useCapacityMappingSettings` in `frontend/src/settings/`. Call order at the state lines: priority weights (705), Jira (709), capacity (766); the capacity hook takes `jiraFields`/`setJiraFields`/`setLoadingFields` from the Jira hook (declared earlier now). Each returns its drafts, setters, `isDirty`, section `save()` (the existing function names, `savePriorityWeightsConfig`, `saveBoardConfig`, `saveCapacityConfig`, `saveProjectSelection`, `saveIssueTypesConfig`, keep their names so the `:765` guard pin only needs a file re-point), `applyLoaded(config)` (the seeding done by `loadConfig` at 6900-6904 and the S3-S5 statements there, taking the `shouldPreserve*` predicates as arguments), and a plain `draftSnapshot` for the render-time assignment at 810-821. `App()` keeps `saveGroupsConfig`'s section order and `restoreSettingsDraftsToCommittedBaselines`, which now call the hooks' setters.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Dead code (above). | SM-T. |
| R2 | Playwright test: dirty `priorityWeights`, `board`, `capacity`, and `issueTypes` together and assert the recorded POST sequence (method and path, ignoring `/api/auth/csrf`) equals the section 4 order, each with `baseRevision`; server-render probes for each hook's defaults and `isDirty === false`; a key-parity test across the save map (3630-3642), the capture object (1284-1296), the restore function (4194-4226), `FIRST_RUN_ADMIN_SECTION_KEYS`, and the 10-key snapshot (810-821). | Review the diff. |
| R3 | Hoist `commitSharedConfigRevision` and the baseline-revision hook above 705. | SM-T: save one admin section. |
| R4a | `usePriorityWeightsSettings` | Admin: edit priority weights, Save, reload, persisted; reset to defaults. |
| R4b | `useJiraProjectSettings` | Admin: Scope projects (add/remove), Jira source board (set/clear), issue types, field pickers; Save; startup shows no extra requests. |
| R4c | `useCapacityMappingSettings` and the tab JSX containers | Admin: Capacity mapping project and field; Save; Planning capacity bar still resolves. |
| R5 | Ledger (`test_epm_settings_source_guards.js:161,:765`, `test_frontend_api_source_guards.js`), budget, lint ceiling, ontology, status. | Review the diff. |

### ST2: EPM settings

**Branch:** `improvement/settings-epm-hook`. Targeted specs: `tests/ui/epm_initial_config_load.spec.js`, `tests/ui/epm-settings-gear.spec.js`, `tests/ui/epm_settings_visual_states.spec.js`, `tests/ui/home_token_connection_settings.spec.js`, `tests/ui/settings-home-token-connection.spec.js`.

**Design.** `useEpmSettings` is called from `App()`; `EpmSettingsTab.jsx` (new, `frontend/src/epm/`) is a stateless container that receives the hook's return object. It must not own the hook: the tab JSX is conditionally mounted (17688), the state is read by `loadConfig` seeding (6910, 6918, 6961), by `useEpmViewData` (2798-2800), and by `unsavedSectionsCount`/`saveAllSettingsOnce` (4094), and owning the hook in the container would drop the private draft on tab switch. Layers: the state layer at 489; the behavior layer after its inputs exist. `saveEpmConfig` (1488) calls `setEpmProjects`, `setEpmProjectsError`, and `refreshEpmProjects` (1506-1509), which come from `useEpmViewData` (2793), whose own arguments are EPM outputs (2798-2800): pass those three as a getter `() => ({ refreshEpmProjects, setEpmProjects, setEpmProjectsError })`. `labelSearch*` and `setGroupDraftError` stay in `App()` and are passed in until ST3.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | `hasDraftEpmScope` (and its guard pin). | SM-T, EPM tab. |
| R2 | Server-render probe of `EpmSettingsTab` with fixture props; unit assertions of the EPM seed-only-from-private-view pin. | Review the diff. |
| R3 | Hoist pure `getLabelRowKey` to module scope. | SM-T. |
| R4a | `useEpmSettings` state layer and behavior layer. | EPM tab: Scope (sub-goal) and Projects load with the saved selection and no modal-open dependency on first load; edit a project label; Save; reload persisted; EPM view still refreshes after save. |
| R4b | `EpmSettingsTab.jsx` container. | EPM tab sub-tabs, Home token states, discard prompt. |
| R5 | Ledger (`test_epm_settings_source_guards.js`, `test_auth_isolation_source_guard.js:96-105`, `test_epm_view_source_guards.js`); budget; ontology; status. | Review the diff. |

### ST3: Team Groups, Labels, and board layouts

**Branch:** `improvement/settings-team-groups-hook`. Targeted specs: `tests/ui/shared_department_groups.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/eng_group_board_settings_tab.spec.js`.

**Design.** State layer at 605; behavior layer at the position of the `useGroupVisibilityPreferences` call (1253), which it calls internally (the hook's inputs are Team Groups state and its outputs feed Team Groups). `teamOptions` (7938) reaches `loadTeamsFromCurrentView` through a getter closure (`() => teamOptions`), which keeps per-render capture. Move `labelSearch*` ownership here and update `useEpmSettings` to read it from this hook. First consumer of `groupsConfig` is line 1229; the hook is therefore called before it. Group JSON export/import stays selected-group scoped. Team label aliases (up to three per Team) behave exactly as before.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Dead code (above). | SM-T, Departments tab. |
| R2 | Oracle-fixture unit tests for any pure group helper moved; group switch / favorite / visibility spec assertions if missing. | Review the diff. |
| R4a | State layer + behavior layer (without JSX). | Departments: create, rename, duplicate, delete a group; add/remove a Team; edit up to three label aliases for a Team; star a group; Save; reload persisted. |
| R4b | Departments panel containers incl. the Labels tab and Boards tab. | Departments sub-tabs, Group labels (when enabled), Boards layout edit; export and import the active group only. |
| R5 | Ledger (`test_analytics_source_guards.js:500-504`, `test_eng_board_*` `acceptedGroupsConfigRef` pin, `test_epm_settings_source_guards.js:157`, `test_team_catalog_lifecycle_source_guards.js`), budget, ontology, status. | Review the diff. |

### ST4: First-run configuration

**Branch:** `improvement/settings-first-run-hook`. Targeted specs: `tests/ui/onboarding_tour.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`.

First-run keeps its committed-section tracking, `settingsSaveInFlightRef` (still ST5's until then), the `rebaseOnto` flow, the "save shared groups first, then EPM, then the private favorite, then continue" order, and the rule that create/duplicate marks the new draft as the pending favorite and visible group without presenting `defaultGroupId` as the user's favorite. Delete the declaration-order slices in `tests/test_first_run_group_configuration.js` and keep its reducer tests and the section-coverage test.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R2 | Key-parity and reducer tests (if not already in ST1); first-run Playwright states captured in P0-2. | Review the diff. |
| R4a | `useFirstRunConfiguration` (state + handlers with `getSaveAllSettings`). | First-run user (empty preferences): group-selection popup, setup choice, configuration guide; create a group, Save, favorite persisted, dashboard continues; retry after a failed save. |
| R4b | First-run JSX container (18125-18149). | The same flow visually; the tour still launches from the gear. |
| R5 | Ledger (`test_first_run_group_configuration.js`, `test_analytics_source_guards.js`), budget, ontology, status. | Review the diff. |

### ST5 (gate G2): Shared-config bootstrap, save, permissions, and modal shell

**Entry gate.** Do not start until the operator approves G2. Before any code, append a short design note here comparing two candidate interfaces for the save orchestrator (design it twice): (a) a table-driven sequence of `{ id, isDirty, save }` records in the section 4 order, preserving both commit conventions and keeping `adminAccess.save()` outside the ordered list (it runs in parallel); (b) keep `saveGroupsConfig` imperative and move it intact into a hook that receives the section hooks. Choose one with reasons, then replace this paragraph with the final interface.

**Files:** create `frontend/src/settings/useSettingsPermissions.js`, `useSharedConfigSave.js`, `useSettingsModalState.js`, `SettingsModalContainer.jsx`. Targeted specs: `settings_unified_save`, `settings_admin_access`, `unconfigured_workspace_gate`, `global_auth_lock`, `server_unavailable_ui`, `load_performance`, `codebase_structure_smoke`.

**Design points.** `useSettingsPermissions` exposes `applyBootstrapPermissions(config)` and `applySavePermissions(config)` (the second omits `setUserIsToolAdmin`, `setPerformanceAdminAvailable`, `setJiraUrl`, `setGroupQueryTemplateEnabled`); defaults `false`/`false`/`true`; values set only with `=== true` (and `Boolean(config.settingsAdminOnly)`). `loadConfig` also writes non-Settings state (`setJiraUrl`, `setAuthMode`, `setBoardAllWorkAvailable`, `performanceGate.resolve`, auth-resume and recovery refs, the sprint catalog controller): extract only the Settings statements (6861-6949) behind one named call such as `settings.applyBootstrap(config, preserve)` and leave the other writes where they are. `loadConfig` is also called from `retryBoardScopeConfiguration` (14873) and `useLatestWorkspaceConfig` (4283); keep each call site's closure semantics (section 4). Both `loadConfig` and `loadGroupsConfig` failure paths must still resolve `adminSettingsGate` (6957) and `groupsLoading`. Payload scope: each admin section is gated by `canEditSharedConfiguration && isXDirty && !skip`; every workspace-config POST carries `baseRevision` from `sharedConfigRevisionRef`; groups post via `buildSharedGroupsPayload`; personal preferences post separately; the footer Save persists all dirty editable sections together without mixing fields across endpoints.

| Rung | Commit | Validation scope |
| --- | --- | --- |
| R1 | Dead code (above). | SM-T. |
| R2 | Full-order Playwright test: with every workspace section dirty, the recorded sequence (method and path, ignoring `/api/auth/csrf`, `adminAccess` calls treated as unordered) equals the section 4 order and ends with `POST /api/groups-config`; permissions unit tests (`true`, `'true'`, `1`, `undefined`, `null`, missing key; missing `settingsAdminOnly`); fallback-path fixture (no `sharedConfig`) startup test. | Review the diff. |
| R4a | `useSettingsPermissions`. | Sign in as a non-admin, an editor, and a tool admin (or fixtures): tab visibility and read-only state; Access tab states. |
| R4b | `useSharedConfigSave` per the approved interface. | Edit several sections, Save: order and conflict handling; force a 409 (stale revision) and see the draft preserved with the recovery actions; expired auth shows the recovery screen, no replay. |
| R4c | `useSettingsModalState` and `SettingsModalContainer.jsx`. | Open from gear/hotkey/Board call-to-action; tab keyboard navigation; discard prompt; first-run still works; auth-resume reopens the same tab. |
| R5 | Ledger (`test_epm_settings_source_guards.js` fail-closed pins become unit assertions, `test_planning_action_source_guards.js:278`, `test_first_run_group_configuration.js:544-573`, `test_frontend_api_source_guards.js:11-17,:1204`, `test_onboarding_tour_utils.js`, `test_eng_board_*` `acceptedBoardConfigRef` pins), budget, ontology (add "Board scope load authority" and "Startup config timeout" entries that cite `loadConfig`/`loadGroupsConfig`), status. | Review the diff. |

---

## 12. Execution status

Updated in each R5 commit (root `AGENTS.md` section 4: the plan must match the result).

| PR | Slice | Status | `dashboard.jsx` lines after | Budget after | Notes |
| --- | --- | --- | --- | --- | --- |
| PR-1 | Land the plan | Not started | n/a | 18,213 | needs second review first |
| PR0 | Tooling, coverage, baselines | Not started | n/a | 18,213 | UI baseline pending |
| SC1 | Scenario state container and seam | Not started | | | |
| SC2 | Single Scenario hook | Not started | | | |
| SC3 | Split the Scenario hook (G1) | Gated | | | |
| SC4 | Scenario view component | Not started | | | |
| ST1 | Shared-config section hooks | Not started | | | |
| ST2 | EPM settings | Not started | | | |
| ST3 | Team Groups and Labels | Not started | | | |
| ST4 | First-run configuration | Not started | | | |
| ST5 | Shared-config save, permissions, shell (G2) | Gated | | | |

## 13. Program acceptance

- Every PR merged in order; `dashboard.jsx` lower and its budget ratcheted in each; the lint ceiling never raised.
- Estimated end state (replace with measured values): the two clusters total about 8,000 lines of the 18,203; `App()` keeps call sites, destructuring, and glue, so the realistic end size is about 11,000 plus or minus 1,000 lines. If the measured size after ST4 is above that range, report it to the operator before ST5.
- No route, payload, startup-count, sticky-order, analytics, or visual change; DOM parity diff empty in every R4 commit; the full Chromium `tests/ui` run passes (modulo the baseline failures recorded in PR0) before every push.
- Docs: `FUTURE-codebase-operability-improvements.md` and `docs/plans/README.md` aligned; `docs/ontology.md` has "Scenario Planner ownership" and "Settings state ownership" entries and every existing entry that cites `dashboard.jsx` ownership (Connection recovery, Scenario recovery compute, Unconfigured-workspace gate, Department group label mapping, Board scope load authority, Startup config timeout) points at the new owner files, with verification dates and resolving paths.
- On completion rename this file to `DONE-dashboard-scenario-settings-state-extraction.md` with the status note naming the PRs, per `docs/plans/AGENTS.md`.

## 14. Estimate, risks, and review log

- **Effort.** `FUTURE-codebase-operability-improvements.md` estimates 5-8 days (Scenario) and 4-7 days (Settings). This plan has 11 PRs and roughly 50 operator validation stops (every commit stops, D8); non-source commits (R2, R5) stop for a one-line confirmation. Plan on the upper end: about three to four weeks elapsed, dominated by validation round-trips and a full UI run per PR.
- **Largest risks.** A hook input declared after its call site (TDZ; mitigated by the lint gate and the hook map), changed effect order (mitigated by the single verbatim Scenario hook and per-commit parity), a stranded or double-claimed statement (mitigated by the ownership table and the rule that unclaimed code stays), a guard that goes vacuous (mitigated by `readOwnerSource` anchors), and merge conflicts with feature work (mitigated by D3 and short-lived branches). Each PR is revertable; there is no data migration.
- **Review log.** Draft 1 (committed as `Add first draft of ...`) was reviewed by four independent reviewers on 2026-10-01 (Scenario slices, Settings slices, hook order and architecture, tests and compliance), all returning NOT READY. This revision addresses: Scenario hook cycle and ordering (single verbatim hook), Settings layering and range ownership (sections 3 and 11), lint gate strength (section 6), guard table accuracy (section 7), verification coverage (P0-2, P0-3), dist commit ordering (section 6), landing the plan on `main` (PR-1), save-order and closure facts (section 4), and the operator's decisions on dead code, gates, and commit-gated execution. **A second independent review of this revision is required before the plan is executable.**
