# Design system Part 2: global hover fix

> **Note (2026-10-27):** Superseded by the conflict-resistant architecture plan Task A1: `frontend/dist` is no longer committed, so its `make verify-dist-clean` and "commit `frontend/dist`" steps no longer apply.

> **Status:** Active. Implemented and locally verified 2026-10-13; stays EXEC until acceptance or merge. The final combined Part 2/3 work is committed as `1960753e`. One combined design-system PR with the existing five-commit history and Planning follow-up is authorized 2026-10-14; final full verification has passed; committed-revision and remote publication checks follow the approved transaction. Secondary worktrees remain unauthorized.
> **Execution:** Superpowers planning and task execution, with repository location/publication overrides.

**Goal:** Replace the global dark fill, lift and elevation with the existing 12% currentColor overlay plus ring; remove the three lifts and ten transition-all declarations, retaining resting geometry, selected states, readable text, disabled behavior and interaction contracts.
**Architecture:** Existing class selectors consume Part 1 tokens. Hover treatments are gated by `(hover: hover)` and enabled-state eligibility without raising specificity (`:where(...)` where appropriate). Grandfathered transform:none resets keep their original source/context identity; only their effectful ring/filter declarations move to hover media rules. No components, classes, dependency or cascade layer are introduced.
**Stack:** React 19, existing esbuild, Node 20.20.2, configured Python/unittest, local Playwright.

## Verified starting state and preservation

Part 1 is committed, contrary to the pasted brief's uncommitted premise: `ce5911a96ab00e2284cb0f8c6bd0ede1584e7a69`. The active branch is `improvement/design-system-hover-contract`; the worktree and index are clean. The recorded base is `origin/main` `bd5b2bc247be34bd3350a9924b358353b6f4d5bb` (reconfirm after fetch). No history changes are in scope.

Starting diff and SHA256 hashes of all 1,240 tracked files are recorded in ignored `tmp/design-system-part-2-start.diff` and `tmp/design-system-part-2-start.json`. Part 2 is the diff against the recorded Part 1 commit. Preserve the registry JSON block exactly, issue components/hooks/APIs, backend/auth/storage, original tokens, and the DONE/SUPPORT classification.

## File map

Create:
- `tests/ui/design_system_hover_eng.spec.js`: real mounted Catch Up/Planning List/Table/Board controls, normal menu clicks, selection/disabled/clipped cells, settled screenshots and geometry/contrast evidence.
- `tests/ui/design_system_hover_surfaces.spec.js`: mounted EPM/Settings/Stats/Scenario controls, inline fills, chart readouts, touch, header layering and settled evidence.
- `tests/ui/design_system_hover_helpers.js`: shared measurement/contrast/screenshot helpers only if needed by both specs.
- `tests/test_design_system_hover_foundation.js`: exact global-token/media/disabled/selected contract and lift/transition removal guards with positive exception controls.

Modify, after reading each selector's actual state changes:
- `frontend/src/styles/eng/controls.css`: global button/secondary/disabled foundation; Team dropdown and input explicit transitions. Disabled Team dropdown fixes are limited to eliminating verified hover-only deltas.
- `frontend/src/styles/eng/alerts.css`: alert row lift and transition; preserve border semantics, local-link focus outline, row composition and actions.
- `frontend/src/styles/settings/group-editor.css`: lift-hover rule and select transition; preserve confirmation/dropdown geometry and danger semantics. Disabled Revoke hover restores only its resting danger border.
- `frontend/src/styles/settings/group-board.css`: restore only resting border/text for real max-column disabled Add column.
- `frontend/src/styles/scenario/shell.css`: restore only resting transparent fill/text for disabled inactive Scenario toggles while preserving the original enabled/reset rule.
- `frontend/src/styles/shared/controls.css`: search input and Sprint trigger explicit transitions, plus disabled-only Sprint restoration for the real loading selector.
- `frontend/src/styles/planning/selection.css`: checkbox background/border explicit transitions.
- `frontend/src/styles/planning/stat-cards.css`: uncheck-button explicit transition and verified disabled shadow restoration.
- `frontend/src/styles/settings/dropdowns.css`: group-dropdown-toggle explicit transition, plus disabled-only loading Group restoration.
- `frontend/src/styles/planning/actions.css`, `frontend/src/styles/eng/filter-bar.css`: verified disabled-only Planning action, review Save/Discard, locked menu option and filter clear restorations. Keep enabled hover values and reset identities unchanged.
- `frontend/src/styles/eng/planning-review-table.css`: conditional disabled-only Capacity correction. `dashboard.jsx::renderPlanningReviewFieldEditor` renders this button disabled when shared capacity editing is unavailable; its existing hovered pale/green fill rule still replaces the disabled resting fill. Preserve every enabled hover/focus declaration and transform:none identity.
- `frontend/src/styles/eng/status-transitions.css`, `frontend/src/styles/eng/dependencies.css`, `frontend/src/styles/stats/priority.css`: replace three blue rings using ring/inset tokens; retain original transform:none resets, pill brightness and semantic tints, focus-visible outlines. Disabled eligibility is part of this fix.
- `scripts/design_system_css.cjs`, `scripts/generate_design_system_baseline.cjs`, `tests/test_design_system_ratchets.js`: recognize only the verified safe foundation shadow tokens, with unknown-variable and token-drift negative checks; retain fail-closed parsing and shrink-only identity/value checks. Generator reporting uses the same validated token context as the analyzer.
- `tests/design_system_baseline.json`: generator-produced removals only.
- `tests/ui/pill_hover.spec.js`, `tests/ui/planning_selection_defaults.spec.js`, `tests/ui/planning_review_table.spec.js`, `tests/ui/eng_epic_refresh.spec.js`: update only obsolete affected hover expectations to positive decided treatment/contrast assertions; preserve geometry and interactions.
- `tests/ui/eng_status_transitions.spec.js`, `tests/ui/epm_portfolio_header_visual.spec.js`: replace the other two obsolete global-dark negative assertions with positive actual-surface contracts; keep unrelated bespoke EPM hover intact.
- Existing source guards only if their positively anchored CSS expectation changes: `tests/test_eng_board_styles.js`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_excluded_capacity_stats_source_guards.js`, `tests/test_epm_view_source_guards.js`, `tests/test_dashboard_css_extraction.py`. Unrelated bespoke rules stay pinned.
- `docs/design-system.md` prose only, `docs/ontology.md` affected entries without changing Coverage, `docs/features/planning-sprint-review.md` affected hover text, `docs/README_ANALYTICS.md`, `docs/TODO.md`, `docs/plans/README.md`, `AGENTS.md` only stale section-11 causes removed by Part 2.
- `docs/plans/GATE-05-home-write-capability.md`: startup-check metadata only; no Home implementation.

Verified without modification: `frontend/src/styles/settings/team-groups.css`. The real disabled Group labels tab has identical resting/hover text; `--text-muted` is currently undeclared and both states compute to inherited primary text. Its mounted no-delta check and original enabled source pin remain; no speculative token correction is included.

Generated:
- `frontend/dist/*` through `npm run build`, never hand-edited.
- Synthetic captures and computed-style JSON under ignored `test-results/design-system-part-2/`; separate outputs for full suites preserve these.

If a real disabled control exposes an ancestor-specific survivor in another existing stylesheet, record its verified selector/path and add it to this map before a narrowly scoped disabled-only correction. Do not migrate its enabled treatment or remove unrelated resets.

## Task sequence, dependencies and acceptance

### 1. Inventory and before evidence
- [x] Read root/docs/plan instructions, design, Part 1 record, UI map, ontology, MRT007/009/017/020/021.
- [x] Confirm ten transition-all declarations across seven files; three lift declarations and three ring literals. Trace consumers and ancestor overrides; record baseline offenders (122) and preserved property/value sets.
- [x] Capture settled synthetic before screenshots and computed styles on all eight named surfaces (Catch Up, Planning List, Planning Table, Board, EPM, Settings, Stats, Scenario), including filled/secondary/light/transparent/inline-filled/selected/disabled controls, chart buttons and clipped cells.
- [x] No source CSS or build change before before captures finish. Source tests/fixtures may be created first.

### 2. Fail-first real-surface tests (depends on Task 1)
- [x] Add geometry and text-range comparisons, resulting-fill contrast, overlay/ring assertions, selected/resting-fill preservation and disabled no-delta assertions. Fixed colors alone are insufficient.
- [x] Normal click proves menus are not covered; header icons retain bounds/layering; chart readouts stay near pointer and contained; touch actions remain reachable.
- [x] Run before implementation, record expected failures separately from fixture failures. A supported fixture must positively prove the mounted control and real CSS ownership.

### 3. Foundation and ten transitions (depends on Task 2)
- [x] Global hover: `box-shadow: var(--hover-overlay), var(--hover-ring)`; do not set background, transform or elevation. Explicit property transitions use `--motion-hover` where the foundation is shared.
- [x] Global and effectful hover selectors are gated by `(hover: hover)` and disabled eligibility. Avoid raising specificity; do not conceal survivors with !important. Selected/resting/inline background fills are unchanged.
- [x] Remove alert/group-editor lifts and associated elevation; retain appropriate border/danger semantics. Replace all ten all-transitions with property lists traced from source.
- [x] Replace three ring literals; use inset in clipped cells where measurements require it. Preserve transform:none declarations at their original identities and brightness/tints. Do not remove entrance/placement/reveal transforms or z-index lifts.

### 4. Static guards and baseline (depends on Task 3)
- [x] Foundation guards reject the three lifts, all-transition returns, global dark-fill/selected replacement, unknown or unsafe shadow tokens and ungated effectful foundation hover.
- [x] Safe token recognition never blesses arbitrary CSS variables. Declared token shape and overrides are validated; parser nesting refusal remains.
- [x] `node scripts/generate_design_system_baseline.cjs`: only stale removals; no new/changed offender allowances. Preserve typography/radius/class sets and remaining exact placement/reveal/reset entries.
- [x] Update affected expectations to overlay/ring/contrast, never relax write-contract/interaction/geometry assertions.

### 5. After evidence and documentation (depends on Tasks 3–4)
- [x] Compare settled before/after screenshots and rest geometry on every consumer; measure ring/card contrast >=3:1, text contrast against composited resulting fill, and ring visibility in clipped cells at pixel level.
- [x] Confirm disabled no-hover deltas and selected fills with surviving specificity overrides. Preserve normal click layering, chart readouts and touch fallbacks.
- [x] Document surviving bespoke enabled hover rules as Part 3; mark map/ontology/feature prose and No-Event Allowlist accurately. Registry JSON and mutation behavior stay byte-identical.
- [x] Retire only stale section-11 assumptions about the removed global dark fill/lift; keep geometry/layering/readability rules.

### 6. Final verification (depends on integrated Tasks 1–5)
- [x] Rebuild dist before dist consumers with Node 20.
- [x] Focused: `node --test tests/test_design_system_*.js tests/test_eng_board_styles.js tests/test_dashboard_alert_source_guards.js tests/test_excluded_capacity_stats_source_guards.js tests/test_epm_view_source_guards.js tests/test_analytics_source_guards.js`.
- [x] Focused UI: `JEP_TEST_PYTHON=.venv/bin/python npx playwright test tests/ui/design_system_hover_eng.spec.js tests/ui/design_system_hover_surfaces.spec.js tests/ui/pill_hover.spec.js --browser=chromium --workers=1`.
- [x] `make test`.
- [x] `npm run test:frontend:unit`.
- [x] `JEP_TEST_PYTHON=.venv/bin/python npx playwright test tests/ui --browser=chromium --workers=4 --output=test-results/part-2-full-ui`.
- [x] Relevant headed geometry: both new real-surface specs and existing `eng_group_board_card.spec.js` Project Track glyph case with `--headed --browser=firefox`, then `--headed --browser=webkit`, one worker, 2x where glyph clipping requires it.
- [x] `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets`; analytics source guards included above.
- [x] `npm run build` twice and compare all generated-file hashes without staging. Do not run `make verify-dist-clean` before a separately authorized commit.
- [x] Compare full Part 2 diff and untouched Part 1 hashes/registry; verify no staging, commit or head change. Record actual outcomes, screenshots inspected, offender reduction and limitations; leave EXEC active.

## Forbidden regressions and publication boundary

No Part 3 migration or wholesale reset deletion; no shared Button, new kind classes, grouped selector lists, cascade layer, dependency, typography/radius/spacing/JSX style changes. No issue-write binding, backend, auth, storage, ownership or configuration changes. No live data/screenshots, forced clicks, weakened interaction/geometry guards, new grandfathered offender or blanket !important. No commit/push/PR/worktree. Keyboard behavior and focus outlines stay; touch remains required.

## Execution record

Plan written before implementation. Initial clean state and hashes recorded; Part 1 commit identified. Verification and deviations will be recorded here as work proceeds.


Inventory refinement: the ten transition-all owners are `.search-input`, `.sprint-dropdown-toggle`, `.group-dropdown-toggle`, `select`, `.team-dropdown-toggle`, `input`, `button`, `.alert-story:hover`, `.uncheck-button`, and `.task-checkbox`. The three non-positioning lifts are `button:hover`, `.alert-story:hover`, and `.secondary.compact.lift-hover:hover`. The three ring literals are status, dependency and Epic capacity controls. Planning Table Capacity has a separate positive light-fill/box-shadow:none/filter:none override; it is retained as Part 3 scope and its existing checks stay.

Integration finding: a held initial task request renders the real Team trigger with `aria-disabled="true"` rather than native disabled. Hover eligibility therefore excludes both forms; the Team-specific resting neutral/active-filter restoration covers both without changing enabled treatments. A dedicated mounted loading case captures the baseline leak and verifies the fix.

Final disabled audit: native/aria-disabled Sprint (`EngControls.jsx`), aria-disabled Group, and permission-disabled Table Capacity have surviving higher-specificity hover rules. Add real loading/permission fixtures and preserve their resting styles with disabled-only restoration; enabled bespoke rules and baseline identities remain unchanged. Existing disabled Uncheck is also verified on mounted Planning List.

### Integration and verification record (local, acceptance pending)

- The initial eight-surface before capture completed before source CSS/build changes. Additional real loading, permission, pending and max-column cases replayed the exact full Part 1 `frontend/dist/dashboard.css` from the recorded commit with the unchanged synthetic mounted app; original surface captures and explicitly named replay evidence are retained separately. No live data was used.
- Fail-first checks rejected the old global lift/dark fills, old rings, disabled hover leaks and the actual alert/Cancel lifts. A first full campaign was interrupted while fixtures were being corrected; its two dependency failures incorrectly expected removal of the existing semantic red tint, which is required to survive. The next complete campaign passed 1,540 tests with eight skips before the final disabled audit additions.
- The disabled audit added narrow restorations for actual native/ARIA-disabled consumers. It preserved every enabled bespoke declaration and transform:none identity. A caught corner-control regression initially restored secondary text on a primary-text corner; the final rule preserves that variant. Key-column controls are compared with the same ancestor header hover state to retain the intentional reveal grammar.
- Actual disabled Group labels already have no hover delta: the existing undeclared `--text-muted` falls back to inherited primary text. No team-groups stylesheet change was made; its existing enabled rule and real no-delta test remain.
- One headed Firefox 1x ring-pixel attempt failed because fractional antialiasing produced too few opaque-blue pixels. Final Firefox/WebKit use 2x; pixel bands derive screenshot scale, with unchanged color thresholds. Chromium remains 1x. One 2x run was interrupted to fix image-space band scaling; no CSS or threshold weakening was used.
- Static foundation/ratchet checks: 37 passed. Focused design-system, source, structure-related frontend and analytics guards: 199 passed. Full frontend unit command: 2,536 passed. `make test`: 2,131 run, 2,102 passed, 29 skipped. Latest focused Python structure/CSS extraction: 14 passed. Headed Firefox and WebKit Project Track glyph guards: one passed per engine.
- Baseline regeneration remains shrink-only: 122 → 106 (three lifts, ten all-transitions, three elevations). All 106 surviving identities/values and all version/typography/class sets are unchanged. Inventory: 49 source stylesheets, 226 hover selector occurrences across 41 files; 80 exact transform:none, 66 hover/active none resets and six placement/reveal transforms preserved.
- Existing semantic status-palette contrast is approximately 1.97:1; hover checks preserve the prior brightness/palette rather than widening this slice into color redesign. Measured foundation text contrast is at least 4.89:1, and ring/card contrast at least 3.18:1. Dependency inset bottom-edge paint is explicitly checked in all engines.

Final browser campaigns, build reproducibility and preservation checks are recorded after completion below. No publication is authorized or performed.

### Final result

Implemented with the verified disabled-only extensions above. The source and current map describe the result; Part 3 remains deferred. Acceptance is pending, so this plan remains EXEC.

- `JEP_TEST_PYTHON=.venv/bin/python JEP_HOVER_PHASE=verified-full npx playwright test tests/ui --browser=chromium --workers=4 --output=test-results/part-2-verified-full-ui`: 1,557 total, 1,549 passed, eight skipped, exit 0 (11.9 minutes). A preceding full attempt was stopped after the corner-variant mistake; it is not counted as successful final verification.
- Final mounted campaigns: ENG 10/10 and EPM/Settings/Stats/Scenario 10/10 in Chromium 1x, headed Firefox 2x and headed WebKit 2x. The final max-column mock was corrected to valid persisted column IDs and nonblank unique statuses, passed `normalize_group_board` with zero errors/warnings, and its exact baseline/after case was rerun successfully on all three engines. This fixture-only correction happened during the full campaign; all production CSS and bundles stayed frozen.
- Before/after: 40 ENG controls preserve resting bounds, fills and text ranges. Twenty-three other-surface controls additionally have pixel-identical resting crops; the Burndown readout image is pixel-identical. Root visual inspection covered all eight surfaces, the alert/Cancel lifts, filled Save and secondary Run rings, dependency bottom paint, and additional disabled Capacity/corner/Revoke/History controls. Initial crop-method differences were resolved with explicit exact-Part-1-CSS replay rather than claimed as pixel equality.
- Two final Node 20 `npm run build` runs produced identical SHA256 hashes for all 20 generated files. No staging and no `make verify-dist-clean` were used.
- Final preservation audit: all 1,240 starting tracked files remain, with 1,206 byte-unchanged. The registry JSON block is byte-identical. Components, hooks, APIs, dashboard JSX, backend, auth, storage, configuration and ownership files are unchanged. Only generated dashboard CSS differs in dist. All 106 retained baseline identities/values and every other baseline field are unchanged. Local documentation links resolve; `git diff --check` passes.
- HEAD remains the recorded Part 1 commit and the index is empty. No commit, push, PR, history change or worktree was created. Final independent spec/code-quality review reports no unresolved findings.

Evidence is under ignored `test-results/design-system-part-2/`; command logs, starting hashes, final build hashes and preservation report are under ignored `tmp/`. The No-Event Allowlist covers this presentation correction; there is no event/runbook or mutation-contract change. Existing low-contrast semantic status colors and unrelated enabled bespoke hover treatments remain documented limitations.

### User-requested card hover correction

The user authorized a targeted Board exception after seeing the generic inner-button ring on `ecard-open`. Before editing, verified that `EngBoardEpicCard` delegates activation to this button while `.ecard` already owns column-colored border/soft-shadow hover and drag. Add only a hover-capability-gated `box-shadow: none` override on `.eng-board .ecard-open:hover`, preserving the resting transparent trigger, outer card treatment, focus outline, geometry and drag handlers. This does not authorize the general Part 3 migration.

Additional scope: `frontend/src/styles/eng/board.css`, `tests/ui/eng_group_board_card.spec.js`, `tests/test_eng_board_styles.js`, affected Board prose in `docs/features/eng-workflows.md`, the existing map/ontology/analytics row, and one concrete section-11 learning. Dist is rebuilt. Verify fail-first mounted screenshot, settled after geometry/text, keyboard activation/focus, existing Board card and drag tests, CSS ratchets and source guards.

Card correction outcome: the mounted fail-first case reproduced the 12% inset overlay and blue inner ring. The scoped override removes both; settled screenshots show a plain title/progress surface inside the existing whole-card highlight. Bounding boxes and text geometry match resting state. Keyboard focus/Enter opening and existing drag interactions remain intact. Validation: Chromium card+drag specs 66 passed/one headed-only skip; dedicated headed Firefox and WebKit cases passed one each (WebKit uses its native macOS Option-Tab path to include buttons). Full frontend unit suite 2,537 passed; 79 focused source/foundation/ratchet/analytics checks, 45 documentation/analytics/ratchet checks and two structure-budget checks passed. Two Node 20 builds were byte-identical across 20 generated files. Baseline remains 106 unchanged offenders; hover occurrences are now 227. Screenshot pair: ignored `tmp/eng-group-board-card/card-hover-before.png` and `card-hover-after.png`. No commit or publication.

### Separate user-requested Board column insertion fix

The user accepted the other behavior and requested either insertion before default Done or unrestricted column movement. Selected the first option, preserving the existing structural final-column/Done-retention contract. `GroupBoardSettings.addColumn` appended after the terminal, making the new column the fixed final item; the already-tested `insertColumnBeforeTerminal` helper was present but unused by the composer. Wired that helper without changing the model, storage schema, endpoint, ownership or terminal rules.

Additional authorized scope: `frontend/src/settings/GroupBoardSettings.jsx` (helper import/call), `tests/ui/eng_group_board_settings_tab.spec.js` (real creation/keyboard reorder/save/reload regression), `tests/ui/group_board_composer.spec.js` (created-ID assertions follow the new penultimate position), and affected feature/ontology/analytics/learning text. This is a separate configuration-workflow bug, not the general Part 3 hover migration. The owner stays at its existing 1,199-line ceiling; no budget allowance was increased.

The fail-first real Settings case reproduced `Done, New column` ordering; an exact committed-JS replay with current CSS captured the same before state. The corrected ordering is `New column, Done`, and the new column can move left before Save and again after save/reload. Existing saved final-column identities are preserved rather than guessed from display names or silently rewritten; a column already saved as final retains that terminal role. It can be deleted/recreated through existing Settings controls if the user wants to restore Done as final.

Validation: Board composer/settings browser campaign 76 passed; model unit checks 61 passed; full frontend unit suite 2,537 passed; backend Board schema/structure checks 61 passed. Dedicated headed Firefox passed the creation/reorder/save/reload regression; WebKit and final visual inspection recorded below. No commit or publication.

Board column follow-up final verification: dedicated Chromium, headed Firefox and headed WebKit save/reload cases each passed. Settled same-browser images show `Done, New column` before and `New column, Done` after; the new working column correctly requires a status before Save. Source/analytics/write-contract/ratchet checks passed 59/59. Two final Node 20 builds produced identical hashes for all 20 generated files. `git diff --check` passes, the index is empty, and HEAD remains the original Part 1 commit. Prior hover work remains present; no stored user configuration was edited or migrated.

Current integrated verification (2026-10-14): [Part 3](EXEC-design-system-part-3.md#final-local-outcome-2026-10-14) verifies the final tree including both Board follow-ups: complete Chromium 1,592 passed/eight skipped, configured Python 2,102 passed/29 skipped, frontend unit 2,538/2,538, final headed Firefox/WebKit 27/27 each, structure 14/14, analytics/design-system/write/ratchets 90/90 and two identical 20-file builds. Earlier Part 2 totals remain historical. Parts 2/3 remain uncommitted and acceptance/publication remain pending.

Final combined local commit gate (2026-10-14): the current-tree full Chromium suite after all approved hover refinements passes 1,594 cases with eight skips; Python 2,102 passed/29 skipped, frontend 2,538/2,538, source/analytics/write/ratchets 90/90, structure 14/14 and headed glyph guards pass. See the current Part 3 record for exact outputs and the authorized local commit boundary. No remote publication is authorized.
