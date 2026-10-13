# Design system Part 1 implementation plan

> **Status:** Done — implemented, locally verified and accepted on 2026-10-13. The operator authorized a local commit on 2026-10-13; push and PR remain unauthorized. Execution commit: the first commit adding this DONE record.
> **For implementers:** Implementation is complete. Only the accepted Part 1 local commit is authorized; no push, PR, secondary worktree, PR2, PR3 or spec #3 is authorized.

**Goal:** Establish the UI map, own-issue write contract and shrink-only CSS guards without changing visible appearance or interactions.
**Architecture:** Keep the four App-hosted mutation hooks and current queue/auth/optimistic settlement paths. Move status target binding into the existing presentational menu. Put the machine-readable registry in one JSON block in `docs/design-system.md`; use existing esbuild for source and CSS checks.
**Tech stack:** React 19, Node 20, esbuild, Node test, Playwright, Python unittest.

## Baseline and publication boundary

- Active checkout: dedicated `improvement/design-system-hover-contract` branch.
- Fetched base `origin/main`: `bd5b2bc247be34bd3350a9924b358353b6f4d5bb`.
- Initial head: `4fed42bfb7f9655ba15dece0642ce247223daebc`.
- Initial staged work: deletion of `docs/plans/EXEC-design-system-hover-contract.md`, addition of `docs/plans/SUPPORT-design-system-hover-contract-design.md`, modification of `docs/plans/README.md`. Preserve the index and reclassification; never restore the deleted plan. No other initial changes.
- Local implementation was verified without staging. The operator subsequently authorized one Part 1 commit on 2026-10-13. Push and PR remain separate gated steps under AGENTS section 10 and MRT025; build and `make verify-dist-clean` run again at the committed revision.

## File map

Create:
- `docs/design-system.md`: element kinds, state/hover vocabulary, hook registry, API effects, own-key write bindings and DB exemptions.
- `tests/test_design_system_write_contract.js`: source contract and adversarial cases.
- `tests/test_design_system_ratchets.js`: exact CSS identity/value checks and adversarial cases.
- `tests/design_system_baseline.json`: generated shrink-only CSS allowance inventory.
- `scripts/design_system_css.cjs`: reusable esbuild/CSS analysis with source/context/duplicate-selector identity.
- `scripts/generate_design_system_baseline.cjs`: baseline generation command.
- `tests/ui/design_system_status_contract.spec.js`: synthetic own-key runtime matrix and settled visual parity.
- `tests/test_design_system_status_binding.js`: menu ownership and invalid hook-key behavior.

Modify:
- `frontend/src/issues/StatusTransitionMenu.jsx`: `onSubmit?.(targetStatus, issue)`.
- `frontend/src/issues/IssueCard.jsx`, `frontend/src/eng/EpicBlock.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `frontend/src/dashboard.jsx`: six bare status handlers.
- `frontend/src/eng/useEngStatusTransitions.js`: before coercion, `if (typeof explicitTargetKey !== 'string') return null;`.
- `frontend/src/styles/shared/shell.css`: unused foundation tokens.
- `frontend/src/styles/eng/alerts.css`: same-colour focus variable rename.
- `tests/test_eng_board_drop_source_guards.js`: update closure pin to own-issue/bare-handler contract.
- `docs/ontology.md`, `AGENTS.md` section 10, `docs/README_ANALYTICS.md`, `docs/TODO.md`, `docs/plans/README.md`: affected documentation only.
- `docs/plans/GATE-05-home-write-capability.md`: required startup check metadata only, no dependent implementation.

Generated only:
- `frontend/dist/*`: rebuild through `npm run build`; never hand-edit.
- Synthetic visual comparison outputs in ignored `test-results/`; no live data.

## Tasks and acceptance criteria

### 1. Verify source and inventory
- [x] Read instruction chains, relevant ontology and MRT009/MRT020/MRT021/MRT025; inspect six menu sites, runtime consumers, four hook hosts, Jira API exports, editor open/submit bindings, Board drop and capacity path.
- [x] Record actual CSS source files, hover occurrences, transforms, transitions, typography/radius values and duplicate selectors from generated analysis. Never copy approximate design counts.
- [x] Read startup gate and check input presence only; keep blocked without documented PASS.
- [x] Run Node 20 `npm ci` before build.

### 2. Contract document
- [x] Create one JSON block with paths/symbols, hook hosts/counts, API effects, call-site handler/issue bindings, editor keys and capacity key; map all existing matching class names.
- [x] Explain option-read POSTs and reasoned DB-write exemptions; Scenario Jira publication stays blocked.

### 3. Regression checks before binding changes
- [x] Prove menu passes the exact issue prop even when another issue is active.
- [x] Prove arrays/objects/numbers/null/blank explicit keys produce no reservation/enqueue/write; a string key still writes once.
- [x] Cover Catch Up Story/subtask/Epic, Planning list/table, Board Story/Epic and Board drop using synthetic Epic children and selection. Assert one request with the clicked key and unchanged child status.
- [x] Run checks before editing binding and record expected failures.

### 4. Minimal binding change
- [x] Apply exact changes above; six bare handlers, non-string early refusal. App stays line-neutral or smaller.
- [x] Preserve queue, optimistic updates, confirmation/rejection/unconfirmed behavior, locks, analytics, Board refresh and global auth recovery.

### 5. Write guards
- [x] Validate files/symbols, all exports by effect, hook hosts/counts, import ownership and presentational boundaries, bare status handlers and own-key forwarding, StatusPill permitted handlers.
- [x] Reject alias/namespace/dynamic bypass and production `updateField` overrides while keeping `createEngIssueFieldEditController` injection for tests.
- [x] Scope iteration checks to mutation target construction; keep legitimate option/queue iteration. Adversarial cases must include Epic-to-children widening.

### 6. Token declarations and ratchets
- [x] Declare unused ring/inset/overlay/12-percent/focus-colour/motion tokens. Focus colour remains `#2563eb`; no hover migration or offender deletion.
- [x] Bundle CSS in memory using esbuild. Keys retain source file, nested at-context, selector, duplicate occurrence and exact property; values retained. Reject new/stale entries and `none` becoming a lift.
- [x] Generate baseline with `node scripts/generate_design_system_baseline.cjs`; cover font family/size/radius, hover offenders and registered class names. Prove behavior with adversarial snippets including `text-transform`, duplicate selectors and nested contexts.

### 7. Documentation
- [x] Update affected ontology entries/date and append UI-layer coverage without changing Coverage line.
- [x] Add design's five section-10 rules; no stale-learning cleanup in Part 1.
- [x] Add No-Event Allowlist reason (existing mutation analytics unchanged), deferred PR2/PR3/spec #3 scope, active plan index/status.

### 8. Verification and diff review
- [x] Rebuild before dist-consuming tests.
- [x] Focused: `node --test tests/test_design_system_*.js tests/test_eng_board_drop_source_guards.js tests/test_planning_issue_mutations.js`.
- [x] Run `make test`, `npm run test:frontend:unit`, `JEP_TEST_PYTHON=.venv/bin/python npx playwright test tests/ui --browser=chromium --workers=4`, `npm run build`.
- [x] Verify structure budgets via `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets` and analytics via `node --test tests/test_analytics_source_guards.js`.
- [x] Compare settled synthetic before/after screenshots and computed geometry; no visible difference expected. Do not capture live data.
- [x] Hash all generated dist files, rebuild and compare hashes for reproducibility. Inspect full diff, unstaged/staged boundaries and App line count.

## Forbidden regressions

No backend endpoint/auth/storage/ownership changes; no bulk Jira status writes, no field-key coercion bypass or injected production writers, no widened selection/children targets; no new dependency; no hover lift removal, new applied ring treatment, typography/radius migration, sticky/layer geometry or interaction changes. Preserve staged work and controller injection used in tests. Never claim an unrun test passed.

## Execution record

Plan created before implementation. The operator accepted the locally verified Part 1 result on 2026-10-13; this record is kept for audit.

- Startup: fetched origin successfully; current branch already contains the fetched main base. Upstream AGENTS template is the same `2026-09-08` version. Node `20.20.2`; `npm ci` succeeded (9 packages). Home gate has 0/4 process inputs and no approved disposable target; not run, remains blocked, next review 2026-10-19.
- Inventory: six static status-menu sites (IssueCard Story/subtask, EpicBlock Epic, Board panel Story/Epic, App Table cell). Runtime consumers include Catch Up and Planning List via shared renderers, Table Story/Epic, Board panel Story/Epic and drop. Four hooks each hosted once by App. Field editors bind task/row/Epic issue descriptors, controller sends frozen editor.issueKey. Capacity API's frontend method is PATCH, with candidate.issueKey; the backend performs the Jira issue update. No backend changes.
- Before binding changes: new Node regressions 3 pass / 5 expected failures (missing menu issue argument, non-string keys reaching reservation/coercion). Initial synthetic runtime matrix 10/10 passed; stronger selection/child UI assertions are being validated before patching.
- `make test`: 2,131 tests, OK (29 skipped; 2,102 passed), 126.232 seconds.
- Structure budget unittest: 2/2 passed.
- Analytics source guards: 30/30 passed.


- Measured CSS: 49 bundled source files; 204 actual hover selector occurrences across 41 files (the raw-text count 206 includes two comment mentions). Distinct values: 7 font-family, 52 font-size, 27 border-radius; 41 suffix-matching classes. Raw declarations: 80 transform:none and 45 unrelated text-transform:none; hover/active transforms include 66 none resets and 9 non-none declarations (3 lifts, 6 placement/reveal). Ten transition-all declarations. Twenty-five shadow offender declarations expand to 27 selector identities; total baseline 122 identities (85 transforms, 10 transitions, 27 shadows). Duplicate tooltip selectors in planning/capacity.css are separately keyed by occurrence.
- Independent review reproduced a CSS-nesting bypass. The analyzer now fails closed on unsupported nested style blocks, with adversarial hover/media/supports/class tests; the existing nested at-rule context parser is preserved. Fixer's 11/11 ratchet tests pass and the baseline is byte-identical. JSX inline styles remain outside Part 1.
- Minimal binding runtime diff: six bare menu handlers, menu issue forwarding and one non-string early-return line; dashboard.jsx stays 7,573 lines. Focused Node 47/47 passes. Synthetic after matrix 10/10 passes, including multiple selected Table Stories and mounted unchanged child pills. Nine before/after geometry pairs identical; seven screenshots pixel-identical. Two Planning List pairs differ in tiny icon-raster regions with no layout/style change, inspected visually. No hover/drop screenshot captured; drop behavior is covered separately. Evidence retained under ignored test-results/design-system-parity; full UI run uses a separate output directory.
- First full Node run overlapped the in-progress write guards: 2,498 passed / 5 failed, all in the new write-contract guard file; remaining existing tests passed. Guard completion and final full rerun pending. Full Chromium suite running.

- Final initial implementation frontend suite: `npm run test:frontend:unit` passed 2,508/2,508; combined focused checks passed 70/70. Independent write-guard review then reproduced local writer-reference aliases and extensionless/dynamic presentation imports that escaped the guard; strengthening these checks is in progress. This changes tests only and does not alter the verified runtime bundle.
- Independent status-binding/CSS task review is clean after the nesting repair. Root independently verified all nine geometry files and seven identical PNG files and visually compared the Planning List Story pair.

- Write-guard repairs verified independently: local writer aliases/repeated dispatch, dynamic presentation imports and extensionless paths now reject; a final review also reproduced local hook/component aliases, fixed with direct-reference confinement. Final independent re-review is clean. Guard 14/14 and frontend unit 2,510/2,510 pass after these repairs; only tests changed after runtime visual verification.
- First full Chromium command (with `--output=test-results/full-ui-run` to retain comparison artifacts): 1,528 passed, 8 skipped, 1 failed in `planning_review_table.spec.js` scroll-motion assertion (expected scrollY 1801, received 159). Isolated unchanged rerun (`--workers=1 --grep 'the page scrolls to a moved row'`) passed 1/1 in 8.0 seconds. Second full unchanged four-worker run is in progress; the first failure is not hidden or treated as a pass.

- Execution ordering: independent source-guard and CSS-analysis preparation ran in parallel with contract work. Inert token source declarations were prepared before the unchanged-dist visual baseline; no build occurred until those before captures. Regression checks ran red before the status-binding runtime change. Final verification covers the integrated result; no later-part treatment was applied.

- Final whole-change review is clean after local hook/presentation-reference alias guards. Fixer's final `npm run test:frontend:unit`: 2,510/2,510 passed; focused write guard 14/14 passed. No runtime edits after the original status-binding patch.
- Root independently decoded the two non-identical PNG pairs: Planning List Story differs by 203 pixels within `(209,688)–(226,706)` (Epic glyph); Planning List Epic differs by 13 pixels within `(1116,679)–(1118,698)` (refresh-button edge). All nine geometry/style records are identical. Both pairs were visually inspected; no changed typography, spacing or control geometry was observed.


## Final outcome and current accuracy

Implemented locally. The file map and acceptance criteria describe the current worktree; source, docs and generated output are aligned. Part 1 is complete, locally verified and accepted on 2026-10-13; the operator subsequently authorized commit-only delivery. The original staged EXEC-to-SUPPORT reclassification and index changes are included unchanged in meaning. At local acceptance, HEAD was the recorded initial SHA and no commit, staging, push or PR had been performed.

| Final check | Actual result |
| --- | --- |
| `make test` | 2,131 run; OK, 29 skipped (2,102 passed), 165.850 seconds |
| `npm run test:frontend:unit` (Node 20.20.2) | 2,512 passed, 0 failed |
| `JEP_TEST_PYTHON=.venv/bin/python npx playwright test tests/ui --browser=chromium --workers=4 --output=test-results/full-ui-final` | 1,529 passed, 8 skipped, 0 failed; 12.9 minutes |
| `node --test tests/test_design_system_*.js tests/test_eng_board_drop_source_guards.js tests/test_planning_issue_mutations.js` | 74 passed, 0 failed |
| `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets` | 2 passed; App 7,573 lines, unchanged |
| `node --test tests/test_analytics_source_guards.js` | 30 passed, 0 failed |
| `npm run build` twice | Both exit 0; all 20 generated files byte-identical to the UI-tested bundle and each other |
| Baseline generator | Shrink-only regeneration exit 0; baseline unchanged; generator growth/changed-value adversarial checks pass |
| `git diff --check` | Clean |

The first full UI run's scroll assertion failure remains recorded above. Its isolated rerun and the complete unchanged final run both passed; no scroll code or assertion was changed. Independent task and whole-change reviews are clean after the documented guard repairs.

Visual evidence: nine synthetic settled before/after control geometry/style records are identical; seven PNG pairs are identical and two contain the localized raster differences recorded above. No hover or drop screenshots were captured; Board drop is verified by requests and mounted child pills. Headed Firefox/WebKit geometry was not run because Part 1 changes no emoji or form-control geometry. CSS JSX inline styles and later hover treatments remain deferred. The analyzer fails closed on modern nested style blocks rather than silently omitting them; nested at-rule contexts remain supported.

`make verify-dist-clean` was deliberately deferred during implementation: it is the committed-output gate. Commit-only authorization now permits the committed-revision build and that gate immediately after the local commit. Local reproducibility was already proved without staging or committing. The unrelated Home-write gate remains blocked and does not block this work.


## Commit-only delivery contract

Authorized on 2026-10-13. Fetched `origin/main` remains `bd5b2bc247be34bd3350a9924b358353b6f4d5bb`; pre-commit HEAD remains `4fed42bfb7f9655ba15dece0642ce247223daebc`. The existing two-commit range is the original design commit `2a152d37` and the base merge `4fed42bf`; neither is reconstructed or rewritten. The approved delta is the Part 1 file map, this accepted DONE record, the pre-existing staged design reclassification and generated build manifest replacement. One new atomic local commit is authorized. No push, PR, remote mutation or history rewrite is authorized.

Commit metadata uses the configured author name and the verified account's noreply identity. Required full-suite evidence is the unchanged implementation's final passing results above; the commit-boundary check also reruns focused guards, build and diff validation. After committing, rebuild from the exact committed tree, run `make verify-dist-clean`, and verify the commit paths, parent, metadata and clean status. Do not claim the committed-output gate passed before running it.
