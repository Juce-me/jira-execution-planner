# Conflict-Resistant Repository and Dashboard Architecture Plan

> **Status:** Proposed on 2026-10-26, revision R1 the same day after two independent read-only reviews (findings and dispositions in the [Review Log](#review-log)). Not approved. No task is authorized to run; commit, push and PR authority are separate operator decisions under `AGENTS.md` section 10. Decisions D-1 to D-9 are open and gate the tasks named in [Decisions](#decisions).
> **Branch:** every task starts from freshly fetched `origin/main` on its own `improvement/`, `bugfix/` or `docs/` branch (see D-2). This document was authored on an auto-generated branch name; rename it before its first commit (MRT022).
> **Base:** authored against `origin/main` `abd0258b`. Measurements were taken at `7316263a`; PR #307 then landed and changed `dashboard.jsx` by one line, so the length is still 7,659. Re-measure every anchor at the start of each task.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unrelated branches from being forced to resolve conflicts, and make a feature edit local to its own module. Track A removes the shared files every PR must edit and that cannot be merged by hand. Track B reshapes `frontend/src/dashboard.jsx` so a feature PR no longer edits it in many places.

**Architecture:** Track A runs first because the measurements below put almost all conflict volume there: committed generated output (`frontend/dist`), exact line-count registries, and append-style docs. Track B is the dashboard decomposition, built on the handle pattern the repo already uses for Scenario and Stats (one `use<Feature>()` hook returns one handle; `App()` stops destructuring and re-listing names). A data-only slice descriptor handles the per-group persisted keys, and only after a spike proves it. `App()` stays the always-mounted host; no React context and no external store.

**Tech Stack:** Node 20 (`node --test`, esbuild 0.27), Python 3.10+ `unittest`, bash, git 2.40 or newer for the measurement script, Playwright (Chromium). No new dependency.

**Spec:** this document. [Evidence](#evidence) is the rationale. Supporting analyses were five independent read-only reports on 2026-10-26 (merge simulation, `App()` structure map, choke-point inventory, Track A specification, Track B design) and two review reports on this plan; scratch output is outside the repository and every figure used here is reproduced in this file.

## Global Constraints

- Behavior-preserving. No API request, response, route, storage or analytics change. Analytics allowlist reason: Track A is tooling, configuration and docs; Track B is a pure refactor with unchanged canonical events and typed params. The one carve-out is D-9c: the same persisted keys, but two latent save-trigger gaps are closed.
- No new runtime dependency and no new GitHub Actions job. Do not add a CI job for `tests/ui` (recorded decision in `AGENTS.md` section 10).
- `AGENTS.md` section 10 applies to every task: dedicated branch from fetched `origin/main` with zero inherited commits, atomic commits, full unittest and full Chromium `tests/ui` run before push, explicit user confirmation, and the publication transaction (MRT025). This plan waives none of it. At about 8 minutes per UI run, budget one per PR.
- Commit and merge with the noreply identity through one-shot `-c user.name=... -c user.email=...` flags, never the clone's configured address, and never edit git config files. Verify with `git log -3 --format='%h %an <%ae>'` before any push.
- Do not hand-edit `frontend/dist/`. Until Task A1 lands, rebuild it with `npm run build` and commit it. After A1 it is untracked build output.
- Track B keeps hook call order and effect order unchanged. Persisted per-group state stays in `App()`; moving it into a component that can unmount is forbidden (`applyGroupState` writes it on every group switch).
- Every Track B phase keeps: cold-load request set unchanged, reopening Statistics adds zero requests, chart hover does not re-render `App()`, sticky layering untouched (MRT009), no fetch unification (MRT010). These are proven only by tests that actually run: the render-count and hover specs in `tests/ui/codebase_structure_smoke.spec.js` skip unless `JEP_RUNTIME_PROBE=1` (lines 4171 and 4259; the bundle is built only under that variable at line 77). Every Track B phase command sets `JEP_RUNTIME_PROBE=1` and checks with `--list` that the named specs are selected, not skipped.
- Rule changes land only in `AGENTS.md` sections 10 and 11 (template updates overwrite everything else), in `docs/plans/AGENTS.md` and in `docs/ontology.md`, and only after the approval recorded in D-5.
- Docs are first-class deliverables: each task updates the docs named in its Files list in the same commit as the change. Before each commit, `git diff --name-status` is compared with the task's Files and any divergence is recorded in this plan (MRT016).
- Never commit secrets, absolute local paths, real emails or real Jira keys. No agent attribution in commits or PRs.

## Review Focus

Failure modes the tasks do not otherwise exercise, most likely first. Each has an owning test.

1. A fresh clone, an old worktree or a pulled branch has no or a stale `frontend/dist` after Task A1, and the server serves assets with a generic 404. Owner: A1 `frontend_build_problem` unit tests, the preflight check and a startup warning in `python jira_server.py` (the documented run path).
2. An open branch that modified `frontend/dist` hits a modify/delete conflict on its first sync past A1, and a branch without `.gitattributes` misses `merge=union` on the first sync past A3. Owner: A4 tests for both paths.
3. `merge=union` silently keeps both versions of a bullet edited on both sides. Owner: A3 `tests/test_agents_md_learnings.py` (whole-file bullet uniqueness, 40-character prefix collisions, no conflict markers).
4. The sync script commits with the personal email or auto-commits an unreviewed rerere resolution. Owner: A4 author test and the no-autoupdate rule.
5. Derived budgets stop auto-ratcheting down, so an owner file can grow up to its headroom unnoticed. Owner: A2 tests pin exact failing and passing line counts; the `dashboard.jsx` ceiling stays exact.
6. A group switch (A, then B, then A) restores different state after a slice extraction, including the lone `showAlertsPanel` toggle. Owner: B0b asserting spec and B4 golden tests; hook order by `check_move_conservation`.
7. A handle is missing a name a consumer destructures, or a handle is used as a dependency, and lint cannot see it. Owner: handle contract tests in B1 to B3 and the B0b AST guard.

## Evidence

Window: 2026-09-01 to 2026-10-26, `origin/main`. Conflicts were re-simulated with `git merge-tree --write-tree` for every merge reachable from `main` and the branch refs (git 2.54), using a throwaway object directory; the worktree was never touched. The conflict share depends on the population: 25 of 35 for all refs, 14 of 21 for remote-only refs, 11 of 17 for sync merges reachable from `main`; every population is a majority. `main` has no branch protection and no rulesets (`gh api` returned 404 and `[]`).

| Fact | Number |
| --- | --- |
| PRs landed | 94 at `abd0258b` (56 squash through #248, 38 merge-commit from #254); 93 at `7316263a` |
| PR landings that conflicted at merge time | 0 of 37 merge-commit landings (35 landed with the branch already at main's tip) |
| Branch-sync merges that conflicted (all refs) | 25 of 35 (71%) |
| Of those 25: involving `frontend/dist` / registries / plan docs / tests / `dashboard.jsx` | 20 / 17 / 8 / 6 / 4 |
| Conflicting only in dist, registries or plan docs | 18 of 25 |
| `dashboard.jsx` conflicts before / after 2026-10-07 | 4 / 0 |
| PRs that rewrite `frontend/dist` | 82 of 94 (87%); every PR touching `frontend/src` also touches it |
| `dist/dashboard.js` and its `.map` conflicting when both sides touched them | 20 of 21 and 19 of 20 (minified into 34 and 7 lines); `dashboard.css` 0 of 8 |
| If dist, registries and plan docs never conflicted, PRs still hitting a conflict | about 7 of 66 (11%); upper bound 11 of 66 (17%) |
| PRs per file since 2026-09-01 (37 first-parent merge landings at `7316263a`) | `dist/dashboard.js` 30, `docs/ontology.md` 27, `docs/README_ANALYTICS.md` 25, `dashboard.jsx` 19, `owner_budgets.json` 18, `AGENTS.md` 16, `docs/plans/README.md` 14 |

Why registries conflict: append-at-the-same-spot or single-line edits. `AGENTS.md` section 11 bullets appended at the end; the `docs/ontology.md` line-3 "Coverage" header (edited by 20 of 84 non-merge commits); one status line per plan in `docs/plans/README.md`; table rows in `docs/README_ANALYTICS.md`; `Checked on` stamps in `GATE-05`; and in `scripts/extraction_lint/owner_budgets.json` exact per-file `lineCount`, aggregate `measured` counters and 90 whole-file `sourceDigest` hashes. `tests/test_codebase_structure_budgets.py` requires equality (`:160-161` modules, `:190-191` dashboard, `:200-201` aggregates), so any PR that changes the length of `dashboard.jsx` edits both files. Since #227, 23 of 30 PRs that edit `dashboard.jsx` also edit one of them: its length conflicts even when its text merges cleanly.

Why Track B still matters, and what it does not claim. `dashboard.jsx` caused 4 of 25 conflicted merges, none since 2026-10-07, so Track B is not justified by measured conflicts. It is justified by edit cost and regrowth risk:

| Fact (re-measured at `7316263a` and re-checked by a reviewer at `abd0258b`) | Number |
| --- | --- |
| `dashboard.jsx` | 7,659 lines; `App()` 248-7653; logic 249-6294; `return (` at 6295 |
| Hook occurrences in `App()` (all in `App`) | 119 `useState`, 82 `useRef`, 72 `useMemo`, 69 `useEffect`, 28 `useCallback` |
| Names in the one `App()` scope | 1,580 (reproduced with espree), of which about 830 to 840 (52%, depends on the definition) are couriers that `App()` only forwards through shorthand bag keys, bare JSX props or deps entries |
| Object literals with 25 or more keys in `App()` | 19 (an earlier count of 28 used a looser definition); Stats 123, `useSharedConfigSave` 123, freshness owners 95, share-view options 84, `epicBlockProps` 65, ui-prefs 62 |
| Hunks per feature PR in `dashboard.jsx` since 2026-10-08 | 224 hunks over 33 commits, median 3; nine commits with 7 or more hold 74% of hunks |
| Edit sites for one persisted per-group key | 7 to 9 here, plus 3 to 4 in `stats/` (Lead Times Mode `cohortMode`: 12 sites, 13 lines in this file) |
| Latent defects found | the ui-prefs object saves 62 keys but lists 58 deps (four Project Track keys do not trigger a save); `showAlertsPanel` is in the group snapshot (2739), apply (2798) and prefs, but missing from the snapshot memo deps |
| Lines changed since 2026-10-08 by region | Stats wiring 276 (32% of all hot lines); `epicBlockProps` 63 of 67; alert pin 41 of 66; share options and controls 60 of 141; Settings 23 of 1,294; Planning capacity table 0 of 402 |

Considered and not chosen: unminifying `dist` (load-performance regression); a post-merge bot that regenerates dist (commit loops, and moot after A1); CODEOWNERS (routes review, prevents no conflict); a React context layer or an external store for `App()` state (`App()` cannot consume a context it provides, a child state host would run its effects before the parent's and break `check_move_conservation`, and rewriting 119 `useState` changes batching and invalidates every render-count gate); a blanket widened `readAppSource` test helper (a reviewer's preload experiment showed 12 of 38 direct-only test files fail when the searched source widens, because absence and count pins break); relaxing the "verify at the exact pushed head" publication rule (operator policy, outside this plan, but a real amplifier: `main` is unprotected and the pressure to sync comes from unmergeable dist plus that rule).

## Decisions

Each recommended default is what the tasks assume if the operator accepts it. A task whose decision is open does not start.

| ID | Decision | Recommended default | Gates |
| --- | --- | --- | --- |
| D-1 | Stop committing `frontend/dist` on `main` | Yes. If declined, run the A1 fallback (merge driver plus rebuild on sync) | A1, A4, all Track B |
| D-2 | PR granularity | One PR per task: A0 to A5, B0b, B1 to B3, B4a to B4c, optional B5 (14 PRs; the B0c spike is never merged). Each lands before the next branch is cut | all |
| D-3 | Budgets: drop all `aggregates`; owner ceilings re-baselined once to `ceil(actual * 1.10 / 10) * 10`; the `dashboard.jsx` and `jira_server.py` ceilings stay exact. Growers of those two files still edit one ceiling line (the replay found 24 of 54 `dashboard.jsx` commits grew it); A5 measures that residual | Accept. Alternative: keep one `appPlusOwners` ceiling | A2 |
| D-4 | `sourceDigest`: `sha256` of the sorted `unresolved[].reason` strings joined with `\n`, computed only when `unresolved` is non-empty. The migration re-stamps only interfaces whose old digest verifies; the five that fail today stay red until re-reviewed. Alternatives: drop it, or put the lint in CI | Reason digest | A2 |
| D-5 | Approve these rule edits, all in `AGENTS.md` sections 10 and 11 unless noted: dist rules (section 10 Commands and Layout; the section 11 line at about 319 rewritten; the line at about 346 tightened to "a fresh worktree runs `npm ci && npm run build` first"); the section 11 budgets re-sync rule (about 462); a section 10 override of the template's ontology bullets ("never edit `docs/ontology.md` line 3; date only the touched section's `Verified on`"); GATE sweep writes `Checked on`/`Last result` only when the result changes or `Next review` has passed (section 11 line at about 295, a section 10 override of the template's section 6 sweep bullet, and `docs/plans/AGENTS.md` sweep step 5); the `merge=union` note | Accept all | A1, A2, A3 |
| D-6 | `docs/plans/README.md` | `merge=union` plus convention (one-line link, status only in the plan's top `> **Status:**`). A generated index (`scripts/plan_index.py`) only if A5 shows it is still hot | A3 |
| D-7 | `scripts/sync_main.sh`: (a) may auto-run `git rm -rq --cached frontend/dist` on the one-time modify/delete conflict; (b) enables `rerere` per invocation with `-c`, never persistent config and never `rerere.autoupdate`, so a replayed resolution is never auto-staged or auto-committed; (c) commits with an identity supplied by `SYNC_GIT_NAME` and `SYNC_GIT_EMAIL`, and refuses without them | Yes to all three | A4 |
| D-8 | Include `scripts/measure_merge_conflicts.py`; remote refs by default (`--local` adds local branches) | Yes | A0 |
| D-9 | Track B scope: (a) include Settings composition (about 410 couriers, 1.8% hot)? (b) include the optional Planning capacity table component (B5)? (c) close the two save-trigger gaps (four Project Track prefs deps, `showAlertsPanel` snapshot dep) or preserve today's behavior with explicit tests? (d) approve `frontend/src/app/`, which needs code changes: add `app` to the `features` set in `tests/test_codebase_structure_budgets.py:154` and `check_hook_interfaces.mjs`, model it as an `ownerRoots` entry like `scenario`, `settings` and `epm`, and copy `check_app_metrics.mjs` in `run.sh` as the other two checkers are | (a) No, (b) skip, (c) close both, (d) approve | B0b, B4, B5 |

Gates between tracks. **G-A** (after A5): an operator decision, with no automatic criterion, on three inputs: A0 before/after numbers (the union effect by counterfactual replay; the dist class zero by construction because the files are untracked), the A5 residual-growth measurement, and the B0b baseline metrics. Default recommendation: run B0b to B3 regardless (low risk, removes the hottest region) and take B4 only after G-B. **G-B** (after B0c): go/no-go for B4 on the spike's evidence.

## Task Order

A0, A1, A2, A3, A4, A5, G-A, B0b, B1, B2, B3, B0c, G-B, B4a, B4b, B4c, B5. One at a time; each is a PR that merges before the next branch is cut. A2 and A3 may swap. A4 follows A1 and A3. B1 should land quickly after B0b because it removes the hottest region. B0c needs B1 (its drill needs the Stats handle). The `GATE-05` document's next review is overdue; until D-5 lands, a session that executes this plan stamps it as `docs/plans/AGENTS.md` requires, and that edit is recorded as an expected divergence from each task's Files list.

**Per-task checklist.** `git fetch origin main`; branch from `origin/main` with `git log origin/main..HEAD` empty; Node 20 and `npm ci` in a fresh worktree; commit subjects descriptive and under 72 characters with a body for the reason; no attribution trailers; one-shot noreply identity flags; run the Verification Matrix; compare `git diff --name-status` with the Files list.

## Track A: remove the conflict choke points

### Task A0: Land this plan, then the measurement script

**Files:** Modify this plan (record D-1 to D-8 answers; docs-only PR). Create `scripts/measure_merge_conflicts.py`, `tests/test_measure_merge_conflicts.py`. Modify `tests/README.md` (one line). `.gitignore` already contains `tmp/` (line 81), so tests may build temporary repositories under `tmp/`.

**Interfaces:**
- Produces: `python3 scripts/measure_merge_conflicts.py [--main origin/main] [--since 2026-09-01] [--limit N] [--local] [--attrs head|none] [--list]`, read-only, exit 0.
- "Branch-sync merge": a merge commit with two parents that is not on the first-parent chain of `--main` (PR landings are on the chain).
- Classes by path: `dist` = `frontend/dist/`; `registries` = `AGENTS.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, `docs/postmortem/README.md`, `docs/TODO.md`, `docs/design-system.md`, `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`; `plan docs` = other `docs/plans/**`; `dashboard.jsx` = `frontend/src/dashboard.jsx`; `tests` = `tests/**` otherwise; `other`. A merge counts in every class it conflicts in.
- Output lines, exactly: `ref: <main> since <date>`, `examined: N`, `conflicted: N (P%)`, `only dist/registries/plan docs: N`, then `class <name>: N` for each class.
- Mechanism: `git merge-tree --write-tree` into a temporary object directory (`GIT_OBJECT_DIRECTORY` with the repository as alternate), so the object count and worktree are unchanged. `--attr-source` needs an existing tree, so create the empty tree with `git mktree </dev/null` in the temporary directory; use it for history, `HEAD` for `--attrs head` counterfactuals. Plain `merge-tree` reads the worktree's `.gitattributes`, which is why pinning is required. Print a clear error on git older than 2.40.

- [ ] **Step 0:** Open the docs-only PR that records the operator's D-1 to D-8 answers in this plan and sets its status; merge it before Step 1.
- [ ] **Step 1:** Write `tests/test_measure_merge_conflicts.py` using a synthetic repository under `tmp/`: two branches that append to the same line of `AGENTS.md` (class `registries`), one clean sync merge, one conflicting merge. Assert the exact output lines, that `git status --porcelain` is empty and that the object count is unchanged afterward.
- [ ] **Step 2:** Run `python3 -m unittest tests.test_measure_merge_conflicts` and confirm it fails (module missing).
- [ ] **Step 3:** Implement the script (about 100 lines, standard library only).
- [ ] **Step 4:** Run the test (pass) and the script on this repository. Record the baseline in Outcome as numbers only (analysis values: remote refs default 14 of 21 conflicted, `--local` 27 of 37; the 25 of 35 figure excludes one throwaway and one backup merge).

**Acceptance:** read-only; baseline recorded; the `dist` class is documented as meaningless after A1. **Rollback:** revert.

### Task A1: Stop committing `frontend/dist` (D-1, D-5)

**Files:**
- Create `backend/frontend_build.py` and `tests/test_frontend_build.py`. Before creating the module, check `tests/test_codebase_structure_budgets.py` for any backend module registration it requires.
- Modify `.gitignore` (delete lines 22-23, the `!frontend/dist/` negations); `git rm -r --cached frontend/dist` (20 tracked files, 8.3 MB).
- Modify `.github/workflows/verify-frontend-build.yml` (remove "Fail if dist changed" and "Fail if dist has untracked output", lines 40-49) and `.github/workflows/release-latest.yml` (remove the two "defensive" dist steps, lines 44-54). Keep job ids. The release job already builds before tests and zip (l.24-27); the Docker image builds its own dist and `.dockerignore` excludes it, so `verify-container.yml` is independent.
- Modify `Makefile`: delete `verify-dist-clean` (target, the `.PHONY` entry at line 3 and its use in `verify`); `install` ends with `npm ci && npm run build`.
- Modify `scripts/install.sh`: after the pip steps, `if [ -d frontend/src ] && [ ! -f frontend/dist/dashboard.js ]; then npm ci && npm run build; fi`, printing a clear message when `node` is missing (a release zip has no `frontend/src`).
- Modify `scripts/check_startup_preflight.py` and `tests/test_startup_preflight.py`; modify `jira_server.py` (a call to `frontend_build_problem` in the startup validation function around line 815-823 that logs a warning and does not raise; at most four lines) and the exact `jira_server.py` ceiling and its ledger comment in `tests/test_codebase_structure_budgets.py` (the established practice).
- Modify `tests/test_scenario_draft_history_source_guards.js:102-117` (delete the committed-dist assertion) and `tests/ui/eng_group_board_settings_tab.spec.js:187-195` (drop the `JEP_BOARD_COLUMN_BASE_REF` `git show ...:frontend/dist/...` branch).
- Modify docs: `README.md` (about lines 55, 82 "no Node required", 242-255, 268, 568), `INSTALL.md` (about 212 and the source-checkout sections), `runners/local/README.md` (prerequisites, about line 7), `docs/architecture.md` (about 64, 154, 166), `tests/README.md` (build before tests), `AGENTS.md` per D-5. The plans that cite `make verify-dist-clean` or "commit dist" (about 19; list them with `rg -l 'verify-dist-clean|commit frontend/dist' docs/plans`) each get a one-line note, not a rewrite.

**Interfaces:**
- Produces `frontend_build_problem(repo_root: Path) -> str | None` in `backend/frontend_build.py`: returns a message containing `npm run build` when `frontend/dist/dashboard.js` is missing, or older (mtime) than the newest file under `frontend/src` or than `package-lock.json`; otherwise `None`. A checkout or pull touches changed sources, so a stale dist is detected exactly when it becomes stale.
- `scripts/check_startup_preflight.py` gains an item `frontend_build` that fails with that message; `tests/test_startup_preflight.py::_run` (the helper at lines 13-23) additionally patches `scripts.check_startup_preflight.frontend_build_problem` to return `None`, so the existing exit-0 tests stay valid wherever dist is absent.
- Tests that read dist (Python `tests/test_dashboard_css_extraction.py`; Node `test_lazy_view_loaders.js:104-110`, `test_initiative_icon_source_guards.js:16`, `test_task_filter_menu_compaction_source_guards.js:24`; 34 `tests/ui` files) assume `npm run build` ran first; section 10 Commands and `make verify` say so.

- [ ] **Step 1:** Write `tests/test_frontend_build.py` (missing dist returns a message containing `npm run build`; dist newer than all sources returns `None`; a source or the lockfile newer returns the message) and two `tests/test_startup_preflight.py` cases that leave the helper unpatched (pass with a fresh dist, fail with a missing dist). Run them and confirm they fail because the module does not exist.
- [ ] **Step 2:** Implement `frontend_build_problem`, the preflight item, the `_run` patch and the startup warning; rerun (pass).
- [ ] **Step 3:** Apply the `.gitignore`, `git rm --cached`, workflow, Makefile, `install.sh`, test and docs edits above.
- [ ] **Step 4:** Verify: `rm -rf frontend/dist && npm ci && npm run build && git status --short` prints nothing; a second build is byte-identical (sha256 of the 20 files; a symlinked `node_modules` renames chunks and must not be used); `python3 -m unittest discover -s tests` and `npm run test:frontend:unit` pass after a build; the release zip step, replayed with untracked dist, contains `frontend/dist` (22 entries in the analysis); starting `python jira_server.py` without dist logs the warning.
- [ ] **Step 5:** The PR body carries the recipe for open branches: after syncing past this commit, `git rm -rq --cached frontend/dist` if git reports a modify/delete conflict, then `npm ci && npm run build` (the merge deletes the tracked dist files from the working tree, so a running local server loses its assets until the rebuild).

**Acceptance:** CI no longer needs dist in the tree; the fresh-clone path is documented and detected; both workflows still build and test. **Rollback:** revert the commit, then `npm run build && git add -f frontend/dist` and commit (a bare revert restores a stale dist).

**Fallback if D-1 is declined (A1-F):** create `.gitattributes` with `frontend/dist/** merge=jep-dist` (A3 later appends its lines). Merge drivers live in git config, so the sync script passes `-c merge.jep-dist.driver=true` per invocation (an undefined driver degrades to a normal conflict, verified). The driver keeps "ours" for `dashboard.js`, but both sides' hash-named chunks and `lazy-views-*.json` survive, so the sync runs `git merge --no-commit --no-ff origin/main`, `npm run build`, `git add -A frontend/dist`, then commits.

### Task A2: Budgets without per-PR edits (D-3, D-4, D-5)

**Files:** Modify `scripts/extraction_lint/owner_budgets.json`, `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/check_hook_interfaces.mjs`, `scripts/extraction_lint/tooling_controls.mjs`, `tests/README.md` (about line 60), `docs/ontology.md` (the statements that aggregates are tracked or that every manifest ceiling equals its measured value), `AGENTS.md` (about line 462, section 11 re-sync rule).

**Interfaces:**
- Manifest: delete `modules[].lineCount`, `dashboard.lineCount` and `aggregates`; keep `lineCeiling` (dashboard exact at the then-current length; owners re-baselined once with 10% headroom per D-3), `transfer`, `interfaces`.
- Test: drop `aggregates` and `lineCount` from the required keys (`:102`, `:123`, `:182`); delete the equality checks `:160-164`, `:194-203` and the aggregate comparisons `:115-116`, `:121`; merge `:190-192` into one ceiling failure naming the file; delete the legacy `dashboard.jsx: 7659` entry at `:89`. `jira_server.py` keeps its exact ceiling and ledger.
- Lint: stop emitting `lineCount` and aggregates (`check_hook_interfaces.mjs:407-409, 453-458`); `sourceDigest` per D-4 (`:396, :479, :516`); delete the controls in `tooling_controls.mjs` whose subject is gone (`:93-98, 109-117, 122-123, 130-131, 141-151, 355-356`) and add controls for the new digest: a changed `unresolved` reason invalidates it, an edit to the module that leaves the reasons alone does not.

- [ ] **Step 1:** Add tests that call the existing validator against a temporary repo tree (it takes `repo_root`): `dashboard.jsx` one line over its ceiling fails with `7660 lines exceeds ceiling 7659` style text; ten lines shorter passes with no manifest edit (red today); an owner file at its ceiling passes and one line over fails naming the file; an unregistered new file under an owner root fails with `unregistered owner source`; a ceiling set to 10 fails; the `--manifest` CLI exits 0. Run them and confirm the shrink case is red against the current code.
- [ ] **Step 2:** Edit the manifest and test as specified; rerun until green.
- [ ] **Step 3:** Update the lint and controls; run `scripts/extraction_lint/run.sh`. It is red at `7316263a` (6 problems: five independently recomputed digests and one stale `expandedInputCount`). This task must not add problems, must not re-stamp the five stale digests, and lists the remainder in its Outcome.
- [ ] **Step 4:** Edit the docs and rule text. Run the full Python suite.

**Acceptance:** a PR that grows neither `dashboard.jsx` nor `jira_server.py` and stays under every owner ceiling never edits the manifest or this test; ceilings still fail when exceeded; growers of the two exact-ceiling files still edit one ceiling line, and A5 measures how often. **Risks:** the App-to-owner net-growth guard disappears (B0b adds the regrowth guard); owner caps loosen by at most 10%; a reasons digest can miss a changed member list with identical reasons. **Rollback:** revert.

### Task A3: Append-only docs (D-5, D-6)

**Files:** Create `.gitattributes` (or modify it if A1-F created it) and `tests/test_agents_md_learnings.py`. Modify `AGENTS.md` (the union note and the ontology and GATE wording per D-5), `docs/ontology.md` (the line-3 rule only), `docs/plans/AGENTS.md` (sweep step 5 wording, plan index convention), `docs/plans/README.md` (convention note and this plan's entry).

**Interfaces:**
- `.gitattributes`: `/AGENTS.md merge=union`, `/docs/README_ANALYTICS.md merge=union`, `/docs/plans/README.md merge=union`. Anchor with a leading slash: an unanchored `AGENTS.md` also matches `docs/AGENTS.md` and `docs/plans/AGENTS.md`. Not applied to `docs/ontology.md` (same-line edits would duplicate) or to JSON, JS or `dist`. `CLAUDE.md`, `GEMINI.md`, `docs/CLAUDE.md` and `docs/plans/CLAUDE.md` are symlinks and never conflict.
- `tests/test_agents_md_learnings.py`: asserts that across the whole file every bullet line starting with `- ` is unique, that no two bullets share their first 40 characters, that no conflict markers exist, that the file ends with a newline, and that `.gitattributes` contains the three anchored lines.

- [ ] **Step 1:** Write the test with a synthetic duplicate and a synthetic same-prefix pair that must fail; confirm they fail before the guard exists, then that today's `AGENTS.md` passes (reviewers found 0 prefix collisions across 321 bullets; re-measure).
- [ ] **Step 2:** Add `.gitattributes` and verify in a scratch repository under `tmp/`: two end-of-file appends merge clean with both kept; an identical bullet is deduplicated; a bullet edited on both sides keeps both versions (the failure the test catches); an end-of-file append plus a mid-file insert is clean; `docs/plans/AGENTS.md` is unaffected.
- [ ] **Step 3:** Apply the rule edits approved in D-5 and D-6.
- [ ] **Step 4:** Re-run A0's counterfactual (`--attrs head`); the analysis predicts conflicted merges 27 to 24 and the registries class 17 to 6. Record the measured numbers.

**Limits:** GitHub's web merge button is believed to ignore user `.gitattributes` merge drivers (reports from 2017 through 2026; unverified here), so union helps only local merges, which is why A4 makes the local sync the standard path. A branch that lacks `.gitattributes` still conflicts on the first merge that brings the file in; A4 covers that case. **Rollback:** delete `.gitattributes`.

### Task A4: One sync command (D-7)

**Files:** Create `scripts/sync_main.sh`, `tests/test_sync_main.py`. Modify `Makefile` (`sync` target), `README.md` and `AGENTS.md` section 10 (one line naming `make sync` and the identity variables).

**Interfaces:** `make sync` or `scripts/sync_main.sh`, bash with `set -Eeuo pipefail` (as `runners/local/run.sh`), Python via `${JEP_TEST_PYTHON:-.venv/bin/python}`. Exit codes: 0 synced or already up to date; 1 conflicts left open; 2 refused; 3 the post-merge budgets command failed; 4 `git fetch` failed. "Dirty" means `git status --porcelain --untracked-files=no` is non-empty.
1. Refuse (2) on `main`, detached HEAD, a dirty tree, or when `SYNC_GIT_NAME` or `SYNC_GIT_EMAIL` is unset. Every merge and commit runs with `-c user.name=... -c user.email=...`, `-c rerere.enabled=true` and, so a branch without `.gitattributes` still gets union on its first sync, `-c core.attributesFile=<temporary copy of origin/main's .gitattributes>` (verify in a scratch repo that git honors it when the tree has none; fallback: write the same content to the common git directory's `info/attributes` for the duration of the merge and remove it). No persistent git config is written.
2. `git fetch origin main` (failure: 4); `git merge --no-commit --no-ff origin/main`. Decide by `git diff --name-only --diff-filter=U`, not the exit code (replayed rerere resolutions can exit 1 with no unmerged files).
3. If unmerged: print `GENERATED:` (paths under `frontend/dist/`; with D-7a, run `git rm -rq --cached frontend/dist`) and `HAND-EDIT:` (everything else), leave the merge open, exit 1. A rerere-replayed resolution is left unstaged for review.
4. If clean: rebuild when `frontend/src` or `package-lock.json` changed, or when `frontend/dist/dashboard.js` is missing; commit with the supplied identity; run `${JEP_SYNC_BUDGETS_CMD:-<the unittest command for tests.test_codebase_structure_budgets>}` (3 on failure).

- [ ] **Step 1:** Write `tests/test_sync_main.py` (unittest; repositories under `tmp/`; an `npm` stub on `PATH` as `DOCKER_STUB` does in `tests/test_local_postgresql_runner.py`; `JEP_SYNC_BUDGETS_CMD=false` for the exit-3 case). Cases: clean merge; union-resolved `AGENTS.md` on a branch that lacks `.gitattributes`; hand conflict (exit 1, `MERGE_HEAD` kept, paths classified); the modify/delete `frontend/dist` auto-fix; dirty tree (2); on `main` (2); missing identity (2); already up to date (0); fetch failure (4); budgets failure (3); a replayed rerere resolution left unstaged; and the merge commit's author equals the supplied identity while the repository's configured `user.email` is a different address. Confirm they fail first.
- [ ] **Step 2:** Implement; rerun until green; run the script once on a throwaway local branch that is behind `origin/main`.

**Acceptance:** one documented command updates a branch, rebuilds local output, never commits with the configured address and names which conflicted paths are generated versus hand-edited. **Rollback:** delete the script and target.

### Task A5: Track A close-out

**Files:** Modify this plan (Outcome, Current Accuracy, status), the `docs/plans/README.md` entry, and any doc still naming committed dist or the aggregate budgets.

- [ ] **Step 1:** Re-run A0 on the post-A4 history and record before/after numbers. Replay cannot rewrite old trees, so A1 and A2 are verified by construction (dist untracked; no per-PR manifest edit unless a ceiling is exceeded) and A3 by the `--attrs head` counterfactual; the true conflict rate is re-measured after at least 10 later sync merges or 3 weeks, whichever is later, and appended to Outcome then.
- [ ] **Step 2:** Measure the residual: the share of recent PRs that grew `dashboard.jsx` or `jira_server.py` and therefore edited a ceiling line.
- [ ] **Step 3:** Check every named doc was updated (`README.md`, `INSTALL.md`, `runners/local/README.md`, `docs/architecture.md`, `tests/README.md`, `AGENTS.md`, `docs/plans/AGENTS.md`).
- [ ] **Step 4:** Present G-A.

## Track B: dashboard.jsx so a feature edit stays local

### Target architecture

- **Handle (adopt, the spine).** `const x = useX(inputs)`; `App()` keeps a destructure only for names that non-feature code reads (computed with the B0b AST script at each phase start) and passes `{ x }` onward; a handle is never a dependency, only its members are. Call positions do not change, so hook and effect order are preserved by construction. Precedent: Scenario (`scenario`, `scenarioState`) and the mutation hooks. `eslint` enables only `rules-of-hooks`, not `exhaustive-deps`, so "no bare handle in a dependency array" is enforced by the B0b AST guard.
- **Slice descriptor (adopt, narrow, after a spike).** A pure, data-only module per feature declares its persisted per-group keys and ui-pref keys; generic helpers build defaults, snapshot, restore and prefs. Hooks stay explicit (the lint enforces `react-hooks/rules-of-hooks`). Share-link keys stay in `shareView/codec.js` and `viewDefaults.js` (a URL wire format); analytics names stay in `analytics/events.js`.
  ```ts
  type KeySpec = { init:(prefs,ctx)=>unknown; restore?:(cached,ctx)=>unknown;
                   group?: boolean /* default true */; pref?: boolean };   // Stats persists non-group prefs too
  defineGroupSlice(id: string, keys: Record<string,KeySpec>,
                   hooks?: { before?(ctx): void; after?(ctx): void }): {   // Scenario needs setScenarioLoading(false) and resetScenarioTransientRefs
    keys: string[]; prefKeys: string[];
    defaults(prefs,ctx): Rec; restore(setters,cached,ctx): void;
    snapshot(values): Rec;   prefs(values): Rec }
  // state hooks add memos only (no effects): { groupValues, groupSetters /* stable */, prefValues }
  // the one central line per slice, in App():
  const groupSlices = [[statsSlice, stats], [scenarioSlice, scenarioState], ...];
  // helpers in app/groupState.js: composeGroupDefaults, composeGroupSnapshot, restoreGroupSlices, composePrefs
  ```
  The existing apply functions differ in signature (`applyStatsGroupState(next, setters, ctx)` versus `applyScenarioGroupState(setters, snapshot)`); the descriptor normalizes them.
- **Scope.** `useEngScope` may gain members and stays an argument named `scope` (its 12 names are frozen by `tests/test_use_eng_scope.js:28,33`).
- **Rejected:** context providers and an external store (see Evidence).
- **What stays central, honestly:** a new feature adds one hook-call line, one JSX mount line, at most one `scope` member and one `groupSlices` row. A new persisted key on an existing feature adds no line in `dashboard.jsx`, but it still edits the per-feature frozen lists that exist today (the 93-name list in `tests/test_use_stats_state.js`, the exact `inputNames`/`returnNames` in `owner_budgets.json` `interfaces`), and the reset paths `resetSprintScopedState` (3014-3041) and `clearEngGroupScopeData` (1628-1665) bypass the seam. B4 removes the frozen Stats list; the rest are named residuals.

Worked example. `cohortMode` today costs 12 sites and 13 lines here plus 4 in `statsGroupState.js`, 3 in `useStatsState.js` and the frozen 93-name list. After B1 and B4 it is zero lines in `dashboard.jsx`, one spec entry and one state pair (share-link capture and apply still edit `captureState.js` and `applyController.js` if the key rides links). The alert pin spans state (975), `pinHeight` (4448), the scope effect and closures (5577-5621) and JSX props (7077-7081); after B2 it is one hook call, the scope effect calling the handle's `clear`, and one prop.

### Metrics (shrink-only ceilings)

Definitions are fixed in B0b: names = `App()`-scope bindings by espree scope analysis; courier = a binding whose every reference is a shorthand object key, a bare JSX prop or a dependency-array entry; bag = an object literal with 25 or more properties inside `App()`; hook counts are occurrences (`rg -o` semantics), not lines.

| Metric | Baseline | Target after B4 |
| --- | --- | --- |
| `dashboard.jsx` lines | 7,659 | about 6,800 (estimate; re-measure each phase) |
| Names in `App()` scope | 1,580 | well below 1,000 |
| Courier names | about 830 to 840 | below 400 |
| Bags with 25 or more keys | 19 | below 10 |
| ui-prefs explicit keys | 62 (58 deps) | about 15, deps gap 0 |
| Canary lines in `dashboard.jsx`: `cohortMode`, `alertPin`, `showDoneEpicAlert` (word-boundary, case-sensitive) | 9, 12, 10 | 0 |
| Median hunks per feature PR in `dashboard.jsx` | 3 (7 since Oct 8) | at most 1 |

Phase line deltas below are estimates, not commitments.

### Task B0b: Pin audit, characterization and regrowth guards

**Files:** Create `scripts/extraction_lint/check_app_metrics.mjs` (espree; the definitions above; also an AST guard that no dependency array in `App()` contains a bare handle identifier), `tests/test_dashboard_regrowth_guard.js`, `tests/ui/group_switch_state_restore.spec.js`, `tests/ui/app_render_counts.spec.js`. Modify `scripts/extraction_lint/run.sh` (copy `check_app_metrics.mjs` as it does the other two checkers), `scripts/extraction_lint/owner_budgets.json` (the hook-count ceilings live under `dashboard`, beside `lineCeiling`, so no second exact-count file is created), `tests/test_codebase_structure_budgets.py` (accept the new keys, per D-9d), `tests/README.md`, this plan's Outcome.

- [ ] **Step 1 (pin audit):** classify every test that reads `dashboard.jsx` directly (about 56 at `abd0258b`: 38 direct-only and 18 mixed with `readOwnerSource`; recount with the same regex) as positive-include, absence, count or exact-statement pin. Record counts and the per-phase migration list in Outcome. No blanket helper is added: each phase in B1 to B4 moves only the positive pins it breaks, with `readOwnerSource(relatives, { anchor })` (already in `tests/frontend_source_helpers.js:20`) and explicit roots; absence and count pins stay dashboard-only; the three reads in `tests/test_eng_board_source_guards.py` are handled in the phase that touches them.
- [ ] **Step 2 (asserting runtime gates):** `tests/ui/app_render_counts.spec.js` reuses `tests/ui/runtime_probe_helpers.js` `buildRuntimeProbeBundle` and asserts numeric render-count ceilings (recorded from the unmodified base) for a filter change, a Stats view switch, a group switch, an alert toggle and an alert pin. The existing smoke specs (Stats hover isolation near line 4170, render counts near 4258, cold-load and reopen near 4283, analytics near 4325, A to B to A near 4381; the render-count one only logs and annotates today) are run with `JEP_RUNTIME_PROBE=1` and their selection is checked with `--list`. Reuse the existing DOM-parity and `JEP_EXTRACTION_PERF_DIR` mechanisms (`tests/README.md:72,78`).
- [ ] **Step 3:** `tests/ui/group_switch_state_restore.spec.js`: A to B to A restores alert toggles, dismissed alerts, ENG filters, Tech/Product, selected tasks and dependency focus, keeps the deliberate quirk that the assignee resets to "all" (smoke `:4412-4414`), and covers a lone `showAlertsPanel` toggle (today's behavior is recorded as-is and D-9c decides whether B4 changes it).
- [ ] **Step 4:** `tests/test_dashboard_regrowth_guard.js` (runs in CI under `npm run test:frontend:unit`) compares occurrence counts of `useState(`, `useEffect(`, `useRef(`, `useMemo(`, `useCallback(` and line count in `dashboard.jsx` with the manifest ceilings; `useReducer` and `useLayoutEffect` are added to the counts. Record the baseline metrics table.

**Gate:** everything green on the unmodified base, baselines recorded; `check_hook_interfaces.mjs` reports the same enforced problems as before this task (six at `7316263a`) and eslint warnings stay at or below `MAX_WARNINGS` (104 of 106 now). **Rollback:** revert.

**Per-phase conservation command (B1 to B4):** after `scripts/extraction_lint/run.sh`, `fnm exec --using 20 node tmp/lint/check_move_conservation.mjs --base "$TASK_START_SHA"` with the phase's created-owner, pure and component symbols and any `--allow-effect-move` allowances written into the phase's Files record, following the contract in `docs/plans/EXEC-dashboard-app-decomposition.md` (its Task 0 section). Review every residual; a zero exit alone does not approve a move.

### Task B1: Stats handle

**Files:** Modify `frontend/src/dashboard.jsx`, `frontend/src/stats/useStatsState.js` and the derived hooks only if their argument bags change, `scripts/extraction_lint/owner_budgets.json` (`interfaces` for `useStatsState` and `useStatsDerivedA/B/C`), `tests/test_use_stats_state.js` (the statement pins at about `:146,177` and the frozen 93-name list), `tests/test_stats_module_extraction_source_guards.js`, `docs/ontology.md` (Statistics entry). Create `tests/test_stats_handle_contract.js`.

**Moves:** the `useStatsState` destructure (832-926), the derived-hook call bags (about 4204-4216, 4220-4250, 4357-4368), the 123-key Stats prop bag (6868-6991) and `statsQueryScope` (about 6070). Of the 93 state names, about 67 are still referenced elsewhere in the file (resets near 1539-1553, 1651-1662, 4911, 5988-5995, 6047-6071; share-view setters near 5665-5666; `burnoutTaskFilter` near 4330-4402 and 5355; prefs near 3230-3253 and 3289-3308; snapshot and apply near 2726, 2785 and 2845-2866). Rule: B1 keeps destructures only for names read outside the Stats call bags and JSX bag, and leaves the snapshot, apply and prefs sites alone (B4 owns them). `stats` becomes the merged handle `{ ...stats, ...statsA, ...statsB, ...statsC }`; `StatsPanel` keeps its single `stats` prop.

**Proof:** `tests/test_stats_handle_contract.js` (every name `StatsPanel` destructures exists on the handle, using `tests/react_hook_harness.js`); the runtime-probe specs for hover isolation, cold-load and reopen, analytics and A to B to A; the four hooks keep their call positions; the AST guard.
**Gate:** about -190 bag keys at most (the call bags hold only 14 and 53 Stats-state keys, so the earlier -226 was the whole-bag count), couriers about 830 to 710, `cohortMode` lines 9 to 5 or fewer, about -250 lines. **Rollback:** revert.

### Task B2: Alerts

**Files:** Modify `frontend/src/dashboard.jsx`, `scripts/extraction_lint/owner_budgets.json` (`useEngAlerts` interface), `tests/test_alert_pin_wiring.js`, `docs/ontology.md` (Alert pin entry). Create `frontend/src/eng/useAlertPin.js`, `tests/test_alert_handle_contract.js`.

**Moves:** the `alertPin` state (975) and the pure pin closures (5587-5621) into `eng/useAlertPin.js` as a state layer plus a behavior layer with a late-bound `alertFlags` getter; stop destructuring `useEngAlerts`; `alertProps` (55 keys, 7092-7148) becomes handle members. The scope effect (5577-5586; it calls `setAlertPin(null)` twice and shares `storyRequirementScopeRef`, declared at 1005, after the state) stays in `App()` and calls the handle's stable `clear`, so its position and dependency array do not change. `renderAlertShareControl` and `renderEpicShareControl` stay (design-system pins).
**Tests deliberately rewritten:** `tests/test_alert_pin_wiring.js` pins the effect deps as exactly `[activeGroupId, isCatchUpMode, selectedSprint]`, requires `setAlertPin(null)` exactly three times and pins `const pinHeight = isCatchUpMode && alertPin ? PIN_HEIGHT : 0;`; they change in this PR with an explanation.
**Proof:** pin and alert Playwright specs, the runtime-probe specs, design-system write contract. **Gate:** about -150 to -230 lines; `alertPin` lines 12 to 3 or fewer. **Rollback:** revert.

### Task B3: Mutation handles

**Files:** Modify `frontend/src/dashboard.jsx`, `frontend/src/eng/EpicBlock.jsx`, `docs/design-system.md` (the write-contract registry JSON, about lines 330-440, updated before the implementation commit as `AGENTS.md` requires), `tests/test_eng_controls.js` (the exact `EpicBlock` signature pin, about lines 190-250), `docs/ontology.md`. Create `tests/test_mutation_handle_contract.js`.

**Moves:** stop unpacking the three transition handles (destructures at about 4979, 5004, 5023 supply 27 of the 65 `epicBlockProps` keys, 33 with the derived `*ActiveKey` and `*Enabled` locals); `epicBlockProps` (6228-6294) folds to about 35 keys. The other 32 keys (selection, dependencies, epic refresh, share and admin flags) are out of this plan unless named handles are added in a later plan. `EpicBlock` maps to the unchanged flat `IssueCard` props; hooks stay called once in `App()`.
**Proof:** `tests/test_design_system_write_contract.js`; status, priority, Project Track and field-edit specs. **Gate:** `epicBlockProps` at or below 40 keys. **Rollback:** revert.

### Task B0c: Spike (throwaway, never merged; needs B1)

On top of B1, build the Stats and Scenario slices (`defineGroupSlice`, `app/groupState.js`) in a scratch copy and a throwaway branch. It must show: pref-only keys, `before`/`after` hooks and the two apply signatures work; the A to B to A and render-count checks equal the B0b baselines; hover isolation holds; `check_move_conservation` has zero unexplained effects; and the drill (adding a dummy persisted Stats key) needs zero hunks in `dashboard.jsx`. It also settles D-9c on evidence (what `showAlertsPanel` and the four Project Track keys do under restore). **G-B go/no-go** for B4. Discard the branch; keep the findings in this plan.

### Task B4: Group slices (only after G-B go; D-9 approvals)

Three PRs, each with golden tests, the A to B to A matrix, `scripts/extraction_lint/check_group_state_parity.mjs`, and render counts at or below the B0b ceilings. The parity script asserts that the union of the slices' keys and the App-owned keys equals a frozen copy of the pre-refactor snapshot key set, and that every key has a default, a snapshot entry and an apply setter. The golden tests run frozen synthetic values through `composeGroupSnapshot`, then `restoreGroupSlices`, and compare. Pins rewritten: `tests/test_use_stats_state.js:146,177`, `tests/test_stats_module_extraction_source_guards.js:200-260` (slices of `saveUiPrefs({` and the snapshot deps), `tests/test_stats_group_state.js`. The `interfaces` entries and `docs/ontology.md` are re-measured in each PR.
- **B4a** Stats and Scenario: create `app/groupState.js`, `stats/statsGroupSlice.js`; the `groupSlices` row; the snapshot memo deps become `[...ownDeps, ...slices.map(([, h]) => h.groupValues)]`. Task data stays on the legacy path.
- **B4b** Alert toggles (10 names, about 90 lines), dependencies, view-mode: `eng/alertsGroupSlice.js`.
- **B4c** Filters and Board.
**Gate:** ui-prefs object 62 keys to about 15 explicit; canary lines 0; D-9c applied or excluded with a test. **Rollback:** per PR.

### Task B5: Optional size-only extraction (D-9b)

Move the Planning capacity table (402 lines at 6462-6863, 13 `App` inputs, no state; the conditional opens at 6461) to `eng/PlanningCapacityPanel.jsx`, and optionally the link builders (5193-5302, 5 inputs). About -500 lines, zero traffic win. Proof: DOM parity capture and sticky and geometry specs (MRT009). Skip unless line count itself is a goal.

### Dropped or deferred

Settings composition (about 1,100 lines, 410 couriers, 1.8% hot; D-9a); Sprint catalog and selector (high risk, cache-first startup, out of scope); header, sticky layout and dropdowns (MRT009 and `renderSprintControl('main'/'compact')` call-count pins); perf counters (`const perfStateLastRef = useRef({});` at line 272 is a text anchor for two UI helpers; keep it); an IssueCard context (B3 handles suffice); a blanket widened test helper (see Evidence).

## Verification Matrix

- `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`; single files while iterating.
- `npm run test:frontend:unit` (`node --test tests/test_*.js`) under Node 20; after A1 run `npm run build` first.
- `scripts/extraction_lint/run.sh` and `tests.test_codebase_structure_budgets` per task (no CI job runs the lint); pass criterion: no new enforced problems and eslint warnings at or below `MAX_WARNINGS`.
- `JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/app_render_counts.spec.js --browser=chromium` plus a `--list` check that the Stats, render-count and A to B to A specs are selected (Track B phases).
- `npx playwright test tests/ui --browser=chromium --workers=4` before every push; headed Firefox and WebKit only when a task touches emoji or form-control geometry (none planned).
- Before declaring a Track B phase done, launch `.venv/bin/python jira_server.py` on a port other than 5050 from the worktree and check `/api/test`; verify the listening process belongs to this checkout and serves the current build.

## Risks

| Risk | Detection before merge |
| --- | --- |
| Re-render fan-out from handles | Handles are plain per-render objects like today's bag literals; `React.memo` leaves take no new context; asserting render-count ceilings from B0b |
| Hook and effect order | Call positions unchanged; `check_move_conservation`, `check_hook_interfaces` every phase |
| Stale-closure semantics of handle rewrites inside callbacks | Same as today by construction; reviewed in each phase; no `exhaustive-deps` rule exists |
| `StatusColourProvider` placement | B1 to B4 add no contexts; any later provider goes inside it |
| Group switch correctness | Parity script, golden tests, A to B to A matrix; `restoringGroupRef` stays in `App()`; React 19 batching of the apply setters is unrun until B0c |
| In-flight PRs conflict with extractions | Land B1 first; each extraction PR body carries a rebase recipe; one PR per task |
| Open branches break on A1 | Recipe in the PR body; A4 auto-fix |
| Personal email on sync commits | A4 identity test |
| Ceilings loosen (A2) | Exact `dashboard.jsx` and `jira_server.py` ceilings; owner headroom at most 10%; B0b regrowth guard |
| Analytics drift | Existing analytics contract and source-guard tests |

## Unverified

- No Playwright or full-suite run was part of the analysis or the reviews; phase line deltas are estimates.
- GitHub's web merge behavior with `.gitattributes` (A3); out-of-repository deployments that `git pull` and run Flask (A1); whether a Linux build is byte-identical to a macOS one (main CI is green, which suggests yes); that `core.attributesFile` is honored by `git merge` when the tree has no `.gitattributes` (A4 verifies in a scratch repository).
- The Track B hot-line map covers 18 days; `useStatsDerived*` accepting handles without changing dependency semantics (B1 proves, B0c extends); that React 19 batches every `applyGroupState` setter (read, not run); only one of the seven alert-pin commits was measured.
- 28 early-September squash PRs have no recoverable branch history; the simulation ignores what authors actually resolved by hand; the reflog shows no rebases but reflogs expire.

## Review Log

Two independent read-only reviews on 2026-10-26 (Track A: 1 blocker, 4 P1, 6 P2; Track B: 1 blocker, 6 P1, 5 P2). All findings were accepted except as noted.

| Finding | Disposition |
| --- | --- |
| A4 would commit with the personal email and writes persistent rerere config | D-7 rewritten: per-invocation `-c` flags, `SYNC_GIT_*` identity, no autoupdate; author test added |
| Runtime-probe and render-count gates skip without `JEP_RUNTIME_PROBE=1` and assert nothing | Global Constraints and Verification Matrix set the variable and check `--list`; B0b adds an asserting spec |
| Blanket `readAppSource` breaks absence and count pins | Dropped; B0a removed; pin audit in B0b and per-phase migration with `readOwnerSource` |
| B2 moved a scope effect that shares a later-declared ref | Effect stays in `App()` calling a stable `clear`; closures 5587-5621 only; pins named |
| Preflight misses `python jira_server.py`; no stale-dist guard | `frontend_build_problem` with mtime check, preflight item and startup warning |
| Union misses the first sync; unanchored `AGENTS.md` pattern; weak duplicate test | `core.attributesFile` per invocation; anchored patterns; whole-file bullet and prefix test |
| D-5 edited template-owned sections | Rule edits moved to sections 10 and 11 |
| A2 acceptance overstated; digest could launder stale reviews | Residual stated and measured in A5; reason digest with no re-stamp and new controls |
| A5/G-A measurement infeasible by replay | Verified by construction plus a later window; G-A has defined inputs |
| File Map gaps (plans citing `verify-dist-clean`, `runners/local/README.md`, `tests/README.md`, `docs/plans/README.md`, double `.gitattributes` create) | Added |
| `showAlertsPanel` missing from snapshot deps | Evidence row, B0b test case and D-9c |
| B0c could not prove what it claimed; order | B0c now follows B1 |
| B1 scope and gate overstated; B3 gate unreachable; B4 sketch gaps; `app/` root incomplete; regrowth guard conflict-prone | Rewritten as above |
| Evidence arithmetic (94 versus 93, 33 versus 34 UI files, 79 versus 84, 28 versus 19 bags) | Corrected |
| Reviewer note that conflict rates differ by population | Evidence states all three populations |

## Outcome

Not executed. Current Accuracy: this plan is a proposal against `abd0258b`.
