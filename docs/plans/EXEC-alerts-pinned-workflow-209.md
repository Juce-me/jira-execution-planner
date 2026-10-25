# Alerts Pinned Workflow (#209) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an ENG Catch Up alert pins that alert under the sticky header with a back-to-alerts button; its `×` dismisses the alert and returns the user to the alert block, or fires confetti and scrolls to the top when the block is gone.

**Architecture:** Pin state lives in `dashboard.jsx` and renders in a new sibling component hosted by `EngView` above the loading/error branch. Pure decisions (pin shape, liveness, block-gone, scroll math) live in a new node-testable `frontend/src/eng/alertPin.js`. The pin is a fixed-height sticky tier whose height is added into `epicStickyTop`. Every alert row's click and action-link closures call one shared `pinAlert` wrapper.

**Tech Stack:** React 19, esbuild, `node:test` for unit tests, Playwright for UI tests, Python `unittest` for the structure-budget lint.

**Spec:** `docs/agents/features/2026-10-24-planned-alerts-pinned-workflow-209-design.md` (revision 2). Read it first; this plan only records decisions the spec leaves to the builder and the order of work. Where they disagree, stop and ask.

Issue: Juce-me/jira-execution-planner#209. Branch: `feature/209-alerts-pinned-workflow` (already created from `origin/main`; the design commit is on it).

## Global Constraints

- Frontend only. No backend, API, storage or Jira write path; pin state is in-memory React state.
- Reuse `.alert-story` base rules unchanged; exactly one new modifier class (`alert-story--pinned`); back button is `ui/IconButton.jsx` with `icon-button--sm`; no new button class (MRT029, MRT020, MRT021).
- Pin is `position: sticky`, fixed height `PIN_HEIGHT = 40` (px) at every width, single line (`white-space: nowrap`, ellipsis); `top = compactStickyTop + filterBarHeight` from the `dashboard.jsx` values only (MRT009).
- `pinHeight = isCatchUpMode && pin ? PIN_HEIGHT : 0`, derived in render, added into `epicStickyTop`; `--planning-sticky-top` untouched; no other offset or z-index changes.
- Scroll guard: a scrolled target's top lands at or below `measureStickyBottom() + 12`; smooth unless `prefersReducedMotion` (the `dashboard.jsx` helper).
- Hit area of the back button and the pinned `×` is at least 24 by 24 CSS px; neither is hover-gated; no drag anywhere.
- Confetti: exactly one burst per `×`, via `triggerAlertCelebration`; the pin path suppresses `dismissAlertItem`'s built-in burst. Existing list-`×` confetti gaps are reported, not fixed.
- No analytics event; document the allowlist reason.
- Commits: `git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit ...`, no `Co-Authored-By`, no tool branding; verify the message before committing and `git show --stat HEAD` plus `git status` after (Gate A).
- Do not hand-edit `frontend/dist`; rebuild with `npm run build`. Run `npm ci` first if this is a fresh worktree.
- Port 5050 belongs to the main checkout's server; run any local server for this branch only if the process on the port belongs to this checkout (verify before presenting).
- Do not commit absolute local paths, real emails or real Jira keys; fixtures are synthetic.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises; each is pinned by a test in the owning task:

1. The pinned alert is resolved by editing while an alert reload is pending, so its category looks empty: `×` must not fire confetti or skip a dismissal (Task 1 table, Task 6 spec).
2. One issue key sits in two categories and is dismissed from the pin: confetti only for categories that became empty (Task 1, Task 6).
3. The alert click itself clears filters including `selectedTeams`: the pin must survive that (Task 2 source guard, Task 6).
4. Back or `×` pressed while the alerts panel is hidden or the category collapsed: both expand first, then scroll (Task 5, Task 6).
5. A very long summary, more than 30 alerts, and a 375px-wide viewport: the pin keeps one line and its fixed height (Task 6).

## File Map

| Path | Action | Responsibility |
| --- | --- | --- |
| `frontend/src/eng/alertPin.js` | Create | Pure pin helpers and decision table |
| `tests/test_alert_pin.js` | Create | Node tests for `alertPin.js` |
| `frontend/src/eng/AlertPinBar.jsx` | Create | The pinned row and back button |
| `frontend/src/eng/EngView.jsx` | Modify | Host the pin above the loading branch |
| `frontend/src/eng/EngAlertsPanel.jsx` | Modify | Call `pinAlert` from row click and action-link closures |
| `frontend/src/eng/alertEpicNavigation.js` | Modify | Pin selector in `STICKY_STACK_SELECTORS` |
| `frontend/src/dashboard.jsx` | Modify | Pin state, lifetime, `pinHeight`, close handler, scroll wiring |
| `frontend/src/styles/eng/alerts.css` | Modify | `alert-story--pinned` modifier, fixed height, sticky |
| `tests/ui/eng_alert_pin.spec.js` | Create | Playwright behavior and geometry specs |
| `tests/test_alert_pin_wiring.js` | Create | Source guards for wiring invariants |
| `docs/features/alerts.md`, `docs/design-system.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md`, `docs/plans/README.md` | Modify | Documentation and index |
| `tests/design_system_baseline.json`, `scripts/extraction_lint/owner_budgets.json` | Modify only if the guards require it | Ratchet and budget sync |
| `frontend/dist/` | Build output | Only via `npm run build` |

Verify every "Modify" path exists before editing (`ls`); `AlertPinBar.jsx`, `alertPin.js` and both new tests are `Create`.

## Execution Ledger

Record per task: status, commit hash, divergences, verification output. Empty until execution starts.

#### Task 0 (done 2026-10-25)

- Step 1: branch is `feature/209-alerts-pinned-workflow`; `origin/main..HEAD` holds only the design and plan commits (the plan commit is the one added after the design).
- `alertDismissedRef` (`frontend/src/dashboard.jsx`): three occurrences and no reader. Declared at 973 (`useRef(false)`); reset to `false` in `applyGroupState` at 2746; set to `true` in `dismissAlertItem` at 4630. Nothing reads `.current` anywhere in `frontend/src` (the dist bundle is generated). It gates nothing today, so a pin-driven close that calls `dismissAlertItem` changes no behavior through it. Decision: no change needed; the dismissal path may set it as before. A new option on `dismissAlertItem` that skips `triggerAlertCelebration` (4627-4629) must leave 4630-4631 (the ref write and `setDismissedAlertKeys`) untouched.
- Alert-cohort loading signals (Task 2 `loading` input): there is no React state for cohort loading. `alertCohortRef` (declared 995; set at 3840 when a cohort starts, cleared in the settle `finally` at 3878 and in the effect cleanup at 3879) is non-null while it loads, but it is a ref and does not re-render. The settle test already used elsewhere is `catchUpAlertLoadRef.current === catchUpAlertScopeKey && alertCohortRef.current === null` (`frontend/src/shareView/applyController.js:178`). Reactive inputs that precede the cohort starting: `tasksFetched` (278), `productTasksLoading` / `techTasksLoading` (279-280), `groupsLoading`, plus `catchUpAlertScopeKey` (3815) whose change invalidates the cohort (the effect at 3825-3880 re-runs and aborts the old one); `alertScopeTooLargeKey` (288) records an oversized scope. `loading` (290) is the visible-task load flag. Task 2 must either derive `loading` from `!tasksFetched || productTasksLoading || techTasksLoading` plus a settle flag, or add one small state flipped beside 3840/3878/3879; decide there.
- Registration formats. Class hook: `docs/design-system.md` has one fenced JSON block (opens at line 87) with `classHooks` (sorted string array starting line 91, e.g. `"alert-pill"` at 93) and `classHookMap` (objects `{ "class": "alert-pill", "paths": ["frontend/src/styles/eng/alerts.css"] }`, at 503-506). A new class needs both entries, the CSS path being the file defining it. No-Event Allowlist row (`docs/README_ANALYTICS.md`, table at 153): `| Feature action | Primary anchors | Reason | Reviewed on |`, for example the row "Derived column marker and readout" with backticked repo paths in anchors, a reason beginning "Presentation only: trigger none; `event_type=none`; canonical `event_name=none`; `feature_name=<feature>`; typed params none." and ending "No GA4 runbook change.", then the date.
- Baseline (Step 4), all green, nothing pre-existing failing: `node --test tests/test_*.js` tests 2983, pass 2983, fail 0; `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` Ran 2 tests, OK; Playwright `eng_alerts_panel_summary` + `eng_alert_loading_order` (chromium) 23 passed.

#### Tasks 1-7 (done 2026-10-25)

- Task 1 (`5dd9c2e1` Add pure helpers for the pinned alert decisions (#209)): review clean. Minors deferred: `resolvePinClose` treats an absent section id as empty (callers pass all ten sections); one redundant `scrollTargetTop` assertion pair.
- Task 2 (`1d449e60` Hold the pinned alert in dashboard state and its sticky tier (#209)): review clean. Ruling: `alertCohortSettled` state flipped beside the `alertCohortRef` set/clear sites supplies `loading`. Ruling: `owner_budgets.json` re-synced and dist committed in the same commit (dashboard.jsx grew). Minors deferred: block-gone computed before the dismissal (equivalent, see Divergences ix); brittle wiring test counting three `setAlertPin(null)` sites; category-to-palette map duplicated in `closeAlertPin` and `dismissAlertItem`.
- Task 3 (`02f4c920` Render the pinned alert bar under the filter bar (#209)): review clean. Ruling: `alert-story--pinned` not registered in the design-system registry (Divergences i). `--sticky-filterbar-z` and a background added on the modifier. Minors deferred to Tasks 6-7 and done there: z-index proof, 24px hit areas, 375px single line.
- Task 4 (`2a8c2a96` Pin the alert from every row click and action link (#209)): review clean. Minors deferred: lazy-regex source guard could mask one unpinned `alert-action`; panel-tree fixture stubs `React.useCallback` globally.
- Task 5 (`9714937e` Scroll back to the alert block and keep targets clear of the pin (#209), fix `2b201918` Measure the landing sticky stack for alert target scrolls (#209)): review found 2 Important issues (alert-target scrolls measured a stack that misses `.filterbar-wrap` and counts a non-landing Epic header; the 24px criterion would fail). Fix round 1 of 5 addressed both; re-review clean. Landing now uses `alertLandingTop`. Minors deferred: tall-Epic `scrollToTaskItem` clearance not covered by a spec.
- Task 6 (`c2b42100` Give the pinned alert dismiss its 24px hit area (#209); `70b278af` Cover the pinned alert workflow with UI specs (#209); `4320af4e` Neutralize the global button surface on the pinned alert back button (#209); `01b4b5e3` Expand the pinned category when going back to the alert list (#209); `cd62600c` Wait on real responses in the pinned alert specs (#209)): review found 2 Important issues (reload-pending and pin-lifetime steps used `waitForLoadState('networkidle')`, a no-op after first load, so assertions ran before the reload landed). Fix round 1 of 5 replaced them with real-response waits; re-review clean. 61 pin specs and 23 existing alert specs pass. Rulings: a second category emptied by global dismissal gets no burst; the compact-header edge lands about 25px below the stack and is asserted as "not covered"; the pin sits 2px below the filter bar in flow and flush when stuck. Minors deferred: `watchPin` installs after `clickPrimary` in the filter-clearing step; confusing diagnostics on `Promise.all` response-wait rejection.
- Task 7 (`804b6f20` Document the pinned alert workflow and sync budgets (#209)): docs only, no dist and no budget change. Gates: `node --test tests/test_*.js` 3027 pass, 0 fail; `.venv/bin/python -m unittest discover -s tests` 2413 tests OK (50 skipped) including `tests.test_codebase_structure_budgets`; `node --test tests/test_design_system_*.js` 60 pass; `npx playwright test tests/ui --browser=chromium --workers=4` 1888 passed, 12 skipped, 0 failed (17.4m); `npm run build` clean. `scripts/extraction_lint/run.sh` reports 6 owner-budget problems, all in `frontend/src/settings/` files this branch does not touch (pre-existing). Step 5 (authenticated localhost) not run.
- Final review fix wave: share-view focus capture counts the pin (`[data-alert-pin]` in `frontend/src/shareView/focusCapture.js`, test in `tests/test_share_view_focus_capture.js`); `node --test tests/test_*.js` 3028 pass after it.
- Follow-up 1 (operator review, 2026-10-25): `4182fe12` Give the pinned alert its category tone and icon (#209); `9b022906` Scroll to the alert's own row when the pinned alert is clicked (#209). The pin takes its category's summary-pill tone and header icon, and its title lands the alert's own row (`data-alert-id`, fallback block then alert list). TDD: node RED 4 then 6 failing, GREEN; Playwright tone specs RED 12 failing on the old bundle; discrimination runs fail 8 locate and 10 tone specs. Gates: `node --test tests/test_*.js` 3038 pass, 0 fail; `node --test tests/test_design_system_*.js` 60 pass; `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` OK (dashboard.jsx 7656 -> 7659, re-synced); `.venv/bin/python -m unittest discover -s tests` 2413 OK (50 skipped); pin spec plus `eng_alerts_panel_summary` and `eng_alert_loading_order` 106 passed; `npx playwright test tests/ui --browser=chromium --workers=4` 1910 passed, 12 skipped, 0 failed (18.9m); `npm run build` clean. No highlight on the landed row (none fits alert rows).
- Follow-up 2 (operator review, 2026-10-25): `f4d5903d` Round the pinned alert like the app's cards and align it with the filter bar; `db8da98d` Send the pinned alert title to its Story or Epic; `6095b615` Use readable label colours on the pinned alert tones; merged with the dismiss-ring and Epic-reveal fixes in `90bf6ad8` (full gates at the merged head are being re-run; numbers to follow). The pin is a 10px rounded `1px solid var(--border)` card on the filter bar card's edges; its title calls the list row's own handlers (follow-up 1's row locate, a misreading, removed with `findPinTarget` and `data-alert-id`); the orange and red tone labels use `--alert-pin-label` for 4.5:1 (review I1) plus minors M1-M5. TDD: node RED 1, 4 and 2 failing, GREEN; Playwright RED 2 shape, 7 title and 3 contrast specs failing on the old bundle; discrimination: no corner fill fails 2, a no-op title handler fails 6 of 7; the edge-alignment assertions are a regression guard only (the fixture already shared the edges). Gates before the merge, at `6095b615`: `node --test tests/test_*.js` 3038 pass, 0 fail; `node --test tests/test_design_system_*.js` 60 pass; `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` OK (dashboard.jsx unchanged at 7659 lines); `.venv/bin/python -m unittest discover -s tests` 2413 OK (50 skipped); pin spec (82) plus `eng_alerts_panel_summary`, `eng_alert_loading_order` and `eng_missing_story_ghosts` 133 passed; `npx playwright test tests/ui --browser=chromium --workers=4` 1909 passed, 12 skipped, 0 failed (17.4m), no reruns; `npm run build` clean.
- Task 8 (publication): not started; blocked on explicit user confirmation.

#### Divergences from the plan and design

- (i) `alert-story--pinned` is NOT registered in `classHooks`/`classHookMap` and has no ratchet entry (the hook-registry guard rejects it); it is documented as a row-layout modifier in `docs/design-system.md`.
- (ii) Scroll landing uses `alertLandingTop` with the dashboard's own offsets via a per-render ref, not `measureStickyBottom`.
- (iii) While the alert cohort is loading, `×` always dismisses (even for a resolved identity) and never celebrates.
- (iv) The pin's note slot shows the category label.
- (v) Reduced-motion scroll to the top is instant.
- (vi) The compact-header landing band is asserted as "not covered" (about 25px below the stack), not the 24px bound.
- (vii) One confetti burst per `×`, for the pinned category only (a second category emptied by global dismissal gets none).
- (viii) `z-index` (`--sticky-filterbar-z`) and a background were added on the modifier so Epic headers (z 50) never paint over the pin.
- (ix) Block-gone is computed in `resolvePinClose` before the dismissal as "no other identity left in the section"; equivalent to the design's after-commit evaluation because global per-key dismissal only removes the pinned identity.
- (x) The Back button reuses `planning-review-column-action` (Task 6 fix).
- (xi) Back also expands the pinned category (Task 6 fix).
- (xii) An extra `alertCohortSettled` state adds one render per cohort settle (deferred, unmeasured).

#### Known limitations (for the PR notes)

- Tall-Epic `scrollToTaskItem` clearance is not covered by a spec.
- Chromium only: Firefox and WebKit were not run.
- The authenticated-localhost check was not run (the operator signs in).
- The existing list-`×` confetti gaps (Backlog, Missing team, Missing labels, Stories required) are out of scope and unchanged.

---

### Task 0: Baseline and open questions

**Files:** none changed (ledger only).

- [x] **Step 1:** Confirm `git branch --show-current` is `feature/209-alerts-pinned-workflow` and `git log --oneline origin/main..HEAD` shows only the design commit.
- [x] **Step 2:** Read `docs/design-system.md`, `docs/features/alerts.md`, `docs/postmortem/MRT009`, `MRT029` and `docs/README_ANALYTICS.md` (No-Event Allowlist table); note the exact registration format for a modifier class and an allowlist row in the ledger.
- [x] **Step 3:** Find every reader of `alertDismissedRef` (`rg -n alertDismissedRef frontend/src`) and record what it gates. If a pin-driven dismissal would change that behavior, record the decision in the ledger before Task 2.
- [x] **Step 4:** Baseline run, recording summary lines: `node --test tests/test_*.js`; `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`; `npx playwright test tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_alert_loading_order.spec.js --browser=chromium`. Any pre-existing failure gets its cause, impact and reproducibility written down before proceeding (AGENTS.md section 11).

### Task 1: Pure pin helpers (`alertPin.js`)

**Files:** Create `frontend/src/eng/alertPin.js`, `tests/test_alert_pin.js`.

**Interfaces:**
- Produces:
  - `PIN_HEIGHT: 40`
  - `createAlertPin({ kind: 'issue' | 'requirement', identity: string, sectionId: string, key: string, title: string, note: string }): AlertPin` (trims strings; `identity` is the issue key for `issue`, `entry.id` for `requirement`)
  - `alertIdentitiesBySection(collections): Record<string, string[]>`; keys are the ten `sectionId`s (`eng-alert-missing`, `-blocked`, `-followup`, `-backlog`, `-missing-team`, `-missing-labels`, `-needs-stories`, `-waiting`, `-empty`, `-done`); input uses the flat collection names the panel fixture uses (`consolidatedMissingStories[].task.key`, `blockedTasks`, `postponedTasks` plus `futureRoutedEpics`, `backlogEpics`, `missingTeamEpics`, `missingLabelEpics`, `needsStoriesEntries[].id`, `waitingForStoriesEpics`, `emptyEpicsForAlert`, `doneStoryEpics`)
  - `resolvePinClose(pin, identitiesBySection, { loading: boolean }): { dismiss: boolean, celebrate: boolean, scroll: 'block' | 'top' | 'block-or-top' }`
  - `pinScopeKey({ groupId, sprintId }): string`
  - `scrollTargetTop({ elementTop, scrollY, stickyBottom, guard = 12 }): number` (absolute `scrollTo` top so the element's top sits at `stickyBottom + guard`, never negative)
- Consumes: nothing.

- [x] **Step 1: Write failing tests** in `tests/test_alert_pin.js` (`node:test`, ESM like `tests/test_alert_epic_navigation.js`), with synthetic data:
  - `resolvePinClose` table, one test per row: live and sibling remains → `{ dismiss: true, celebrate: false, scroll: 'block' }`; live and last in section → `{ dismiss: true, celebrate: true, scroll: 'top' }`; not live (resolved) and last → `{ dismiss: false, celebrate: true, scroll: 'top' }`; not live and sibling remains → `{ dismiss: false, celebrate: false, scroll: 'block' }`; `loading: true` → `{ dismiss: true, celebrate: false, scroll: 'block-or-top' }` regardless of emptiness (Review Focus 1).
  - Same key in two sections: dismissing from `eng-alert-missing` leaves the pin's own section decision independent of `eng-alert-blocked` contents (Review Focus 2).
  - `alertIdentitiesBySection` maps each of the ten sections, including a requirement entry id.
  - `pinScopeKey` differs for different group or sprint and is equal for equal values regardless of catalog fields.
  - `scrollTargetTop`: element 500 below viewport top, `scrollY` 1000, `stickyBottom` 120, guard 12 → `1368`; clamps to 0.
- [x] **Step 2:** Run `node --test tests/test_alert_pin.js`; expect FAIL (module missing).
- [x] **Step 3:** Implement the module to the signatures above. `resolvePinClose` is the single place the decision is made; the count excludes the pin's own identity.
- [x] **Step 4:** Run `node --test tests/test_alert_pin.js`; expect all PASS.
- [x] **Step 5:** Commit `Add pure helpers for the pinned alert decisions (#209)`.

### Task 2: Pin state, lifetime and sticky tier in `dashboard.jsx`

**Files:** Modify `frontend/src/dashboard.jsx`; Create `tests/test_alert_pin_wiring.js`.

**Interfaces:**
- Consumes: everything from Task 1.
- Produces in `dashboard.jsx` (passed to `EngView` as props `alertPin`, `onPinBack`, `onPinClose`, and to `EngAlertsPanel` via `alertProps.pinAlert`): `pinAlert(spec)` where `spec` is the `createAlertPin` input; `closeAlertPin()`; `alertPin` state (`AlertPin | null`).

- [x] **Step 1: Write failing source-guard tests** in `tests/test_alert_pin_wiring.js` (pattern: `tests/test_share_view_alert_anchors.js`, reading source text): (a) `epicStickyTop` expression includes `pinHeight`; (b) `pinHeight` is defined from `isCatchUpMode` and the pin in the same render (no `useEffect` sets it); (c) the pin-clearing effect depends on the `pinScopeKey` inputs and not on `selectedTeams` (Review Focus 3); (d) `dismissAlertItem` accepts an option that suppresses its built-in `triggerAlertCelebration`; (e) the pin is cleared in the same effect that clears `dismissedStoryRequirementIds`.
- [x] **Step 2:** Run `node --test tests/test_alert_pin_wiring.js`; expect FAIL.
- [x] **Step 3:** Add `alertPin` state beside `alertCelebrationPieces` (`dashboard.jsx` near line 971). Define `pinHeight = isCatchUpMode && alertPin ? PIN_HEIGHT : 0` before `epicStickyTop` (near line 4442) and add it to that sum. Pass `top = compactStickyTop + filterBarHeight` to the host as a CSS variable.
- [x] **Step 4:** Implement `pinAlert` (replace-on-click, one pin) and `closeAlertPin`: compute `identitiesBySection` from `visibleAlertCollections` and `needsStoriesEntries`; call `resolvePinClose` with `loading` true when the alert cohort is loading or invalidated (reuse the existing loading signals; name them in the ledger); when `dismiss`, call `dismissAlertItem(identity, { suppressCelebration: true })` or `dismissStoryRequirement(entry)` for `kind: 'requirement'`; clear the pin; when `celebrate`, call `triggerAlertCelebration({ types: [palette type for the section, falling back to the default palette] })`; scroll per Task 5. Add the suppress option to `dismissAlertItem` without changing its default behavior.
- [x] **Step 5:** Add the clearing effect keyed on `pinScopeKey({ groupId: activeGroupId, sprintId: selectedSprint })` and on leaving Catch Up, in the same effect that clears `dismissedStoryRequirementIds`. Task refreshes and alert reloads must not touch it.
- [x] **Step 6:** Run `node --test tests/test_alert_pin_wiring.js tests/test_alert_pin.js`; expect PASS. Run `npm run build`; expect no errors.
- [x] **Step 7:** Commit `Hold the pinned alert in dashboard state and its sticky tier (#209)`.

### Task 3: Pin bar component, host and styling

**Files:** Create `frontend/src/eng/AlertPinBar.jsx`; Modify `frontend/src/eng/EngView.jsx`, `frontend/src/styles/eng/alerts.css`, `docs/design-system.md`, `tests/design_system_baseline.json` (only as the guard requires).

**Interfaces:**
- Consumes: Task 2 props.
- Produces: `AlertPinBar({ pin, top, onBack, onClose })` rendering `<div class="alert-story alert-story--pinned" data-alert-pin>`: `IconButton` (`icon-button--sm`, accessible name "Back to alerts") | key and summary link-less text with ellipsis | note | `<button class="task-remove alert-remove" title="Dismiss from alerts" type="button">×</button>`.

- [x] **Step 1: Write failing render test** (extend `tests/test_alert_pin.js` or a new section in `tests/test_alert_pin_wiring.js`) using `renderToStaticMarkup`: markup contains exactly one `alert-story--pinned`, the back button before the title, one `alert-remove`, no status pill and no `alert-action`. Also a design-system test expectation: `alert-story--pinned` is registered (run `node --test tests/test_design_system_*.js` and read which guard names the missing class).
- [x] **Step 2:** Run it; expect FAIL.
- [x] **Step 3:** Implement `AlertPinBar.jsx`. Host it in `EngView.jsx` immediately after the filter bar and before the `loading ? ... : error ? ... : ...` ternary, so loading and an empty alerts panel do not unmount it (spec "Where the pin lives").
- [x] **Step 4:** Add the CSS: `.alert-story--pinned` sets only `grid-template-columns` (back | title | note | dismiss), `height: var(--alert-pin-height)` (`40px`), `position: sticky`, `top: var(--alert-pin-top)`, `white-space: nowrap`, ellipsis on the title, and the 24px hit area for the back button and `×` within the modifier; use foundation hover and focus tokens, no transform in `:hover`, no `transition: all`. A z-index from the existing `--sticky-*` variables is only allowed if the geometry test shows it is needed; record it in the ledger.
- [ ] **Step 5:** Register the class in the `docs/design-system.md` class-hook JSON block and the ratchet baseline with the reason "pin modifier of `.alert-story`, grid template and fixed height only". Run `node --test tests/test_design_system_*.js`; expect PASS. Not done as written: see Divergences (i).
- [x] **Step 6:** `npm run build`, then commit `Render the pinned alert bar under the filter bar (#209)`.

### Task 4: Pin from every alert interaction

**Files:** Modify `frontend/src/eng/EngAlertsPanel.jsx`; extend `tests/test_alert_pin_wiring.js` and use `tests/share_view_alert_panel_fixture.js`.

**Interfaces:** Consumes `alertProps.pinAlert(spec)` from Task 2. Produces: every row's primary click and every action link calls it with `{ kind, identity, sectionId, key, title, note }`.

- [x] **Step 1: Write failing tests.** Source guard: every `className="alert-story-link"`, `alert-action` and Stories-required button closure contains a `pinAlert(` call (count must match the inventory you list in the ledger from `rg -n "alert-story-link|alert-action|handleStoryRequirementClick" frontend/src/eng/EngAlertsPanel.jsx`; the reviewed estimate is about 25 sites). Rendered test using the panel fixture: supply a recording `pinAlert` and simulate each closure by invoking the rendered handlers (extend the fixture's `SETTERS` with `pinAlert`); assert the call payload per category, including `sectionId` and, for Stories required, `kind: 'requirement'` with `identity === entry.id`.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Add one local helper in the panel (for example `pinFor(item, sectionId, kind)`) and call it from each closure before the existing navigate or link behavior. External Jira links keep opening exactly as today; the pin call must not `preventDefault`. Include the future-routed Epic row's padding click and its link (`stopPropagation` link at the future-routed Epic row).
- [x] **Step 4:** Run `node --test tests/test_*.js`; expect PASS (confirm the existing `tests/test_share_view_alert_anchors.js` still passes).
- [x] **Step 5:** Commit `Pin the alert from every row click and action link (#209)`.

### Task 5: Scrolling, expansion and target clearance

**Files:** Modify `frontend/src/dashboard.jsx`, `frontend/src/eng/EngAlertsPanel.jsx` (expose the existing `focusAlertSection` timing), `frontend/src/eng/alertEpicNavigation.js`.

**Interfaces:** Consumes `scrollTargetTop`, `measureStickyBottom`. Produces: `scrollToAlertTarget(element)`; `onPinBack()`; the close handler's scroll step.

- [x] **Step 1: Write failing test** (in `tests/test_alert_epic_navigation.js`): `STICKY_STACK_SELECTORS` includes the pin selector `[data-alert-pin]`, and `measureStickyBottom` counts a sticky element carrying it (follow that file's existing fake-DOM style).
- [x] **Step 2:** Run `node --test tests/test_alert_epic_navigation.js`; expect FAIL.
- [x] **Step 3:** Add `[data-alert-pin]` to `STICKY_STACK_SELECTORS`. Implement `scrollToAlertTarget` with `scrollTargetTop` and `prefersReducedMotion`. `onPinBack` calls `setShowAlertsPanel(true)` then scrolls `.alerts-panel-shell`; the block scroll calls `setShowAlertsPanel(true)`, the category's `setExpanded(true)` (from the `alertSummaryActions` map), waits two animation frames, then scrolls to the section `sectionId`. `resolvePinClose` outcome `top` scrolls to 0 (instant under reduced motion) outside `triggerAlertCelebration`; `block-or-top` scrolls to the block if its element exists, else 0.
- [x] **Step 4:** In `scrollToTaskItem`, after the existing centered `scrollIntoView`, adjust once if the target top is above `measureStickyBottom() + 12` (no change when the pin is absent). Do not touch `scroll-margin-top: 6rem` on alert cards.
- [x] **Step 5:** Run `node --test tests/test_*.js`; expect PASS. `npm run build`.
- [x] **Step 6:** Commit `Scroll back to the alert block and keep targets clear of the pin (#209)`.

### Task 6: Playwright behavior and geometry specs

**Files:** Create `tests/ui/eng_alert_pin.spec.js` (reuse `installDashboardShell` and the fixture helpers from `tests/ui/eng_alerts_panel_summary.spec.js`; extract shared helpers only if copying would exceed what one reviewer can read).

- [x] **Step 1:** Extend the fixture data so all ten categories have at least two alerts (add Postponed, Backlog, Missing team, Missing labels and Stories required data; synthetic keys only), then write the specs mapped one-to-one to the spec's Definition of Done "Behavior" and "Layout" lists: per-category pin and replace; action-link pin with the link still opening; back and block scroll tolerances (block top at or below the pin bottom and within 24px of the stack bottom; shell top likewise); confetti present/absent/once and `scrollY === 0` under `emulateMedia({ reducedMotion: 'reduce' })`; resolved-by-edit through the real Story Points edit path with no dismissal recorded; two-category key; reload-pending `×`; pin lifetime including the negatives (same-Sprint cache-to-live, `selectedTeams`, the click's own filter clearing, hiding the panel); hidden-by-filters target uncovered; geometry (pin top equals filter-bar bottom, `.epic-header` top equals pin bottom when stuck, with and without Group by Initiative, no clipping, 24px hit areas, identical height at 1280 and 375 wide, long summary and 30+ alerts); no layout shift of header, filter bar and shell; `pinHeight` and `--epic-sticky-top` equal the no-pin baseline in Board, Planning, Statistics and Scenario and return in the same render on leaving Catch Up; touch emulation taps; no `dataLayer` push. Wait for CSS transitions and scrolling to settle before every geometry read and screenshot.
- [x] **Step 2:** Run `npx playwright test tests/ui/eng_alert_pin.spec.js --browser=chromium`; the new specs must fail only where the feature is missing, never from fixture errors. Fix fixture errors first.
- [x] **Step 3:** Fix implementation defects the specs expose (not the specs); rerun until all pass; take before/after screenshots of the pinned state at desktop and 375 wide into `tmp/` (ensure it is gitignored) and look at them.
- [x] **Step 4:** Commit `Cover the pinned alert workflow with UI specs (#209)`.

### Task 7: Documentation, budgets and full verification

**Files:** Modify `docs/features/alerts.md`, `docs/design-system.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md`, `docs/plans/README.md`, `scripts/extraction_lint/owner_budgets.json` (if a registered file grew), `frontend/dist/` (build).

- [x] **Step 1:** Update `docs/features/alerts.md` (pin, back, `×`, confetti and scroll rules, and the line "Analytics allowlist reason: no analytics event is added; the pin controls are internal navigation and the pinned `×` is the same action as the list `×`"). Add the No-Event Allowlist row to `docs/README_ANALYTICS.md` in the table's format. Add an "alert pin" entry to `docs/ontology.md` with entry points (`alertPin.js`, `AlertPinBar.jsx`, `pinAlert` in `dashboard.jsx`), tests, relationships and today's verification date; confirm every path and symbol resolves. Update the `docs/plans/README.md` entry for this plan.
- [x] **Step 2:** Run `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`. If it fails because a registered file grew, re-sync that file's ceiling, aggregates, `unresolved` inventory and `sourceDigest` deliberately in this commit; do not golf unrelated lines.
- [x] **Step 3:** `npm run build`; commit any `frontend/dist` change if `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff.
- [x] **Step 4:** Full gates, quoting the command and summary line for each: `node --test tests/test_*.js`; `python3 -m unittest discover -s tests` (full suite, including `test_initiative_extraction` and `test_codebase_structure_budgets`); `npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes; known flaky specs from `flaky-tests-under-load` are rerun alone and reported as such); `node --test tests/test_design_system_*.js`.
- [ ] **Step 5:** Authenticated-localhost check (read-only, numbers only, no saved screenshots): confirm the process on the port belongs to this checkout and serves the current bundle (`curl` the bundle and compare, per the learning); sign-in is the user's. Pass criterion: clicking an alert pins it under the header, `×` returns to the block, and the sticky Epic header stays aligned beneath the pin. If sign-in is unavailable, say so rather than claiming it. Not run: the operator signs in.
- [x] **Step 6:** Commit `Document the pinned alert workflow and sync budgets (#209)`; run Gate A checks.

### Task 8: Publication (blocked on explicit user confirmation)

Do not start without the user's explicit go-ahead.

- [ ] **Step 1:** Run the AGENTS.md section 10 publication transaction: fetch base, record base and head SHAs, `git status --short`, `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`; the commit list must be the design commit plus the plan commit plus Tasks 1 to 7 commits and every path must be in the File Map; stop and ask on any difference.
- [ ] **Step 2:** Re-run the full verification at the exact proposed head and the committed-revision build.
- [ ] **Step 3:** Push and open the PR with `gh pr create --body-file -` (body via stdin, before/after screenshots from sanitized synthetic data, out-of-scope note listing the existing list-`×` confetti gaps, no secrets or real keys); then prove remote head equals local head, read back the rendered body, verify the changed-file list and commit count, report actual CI state; bind the PR with the ccd_pr tools.
- [ ] **Step 4:** After merge or acceptance: rename this plan to `DONE-alerts-pinned-workflow-209.md` with the status note and `docs/plans/README.md` entry, and rename the design doc to `executed` with `Outcome` and `Current Accuracy`.

## Self-Review (completed 2026-10-24)

- Spec coverage: pin on every interaction (Task 4), one-pin replace (Task 2), content and modifier class (Task 3), host outside loading (Task 3), sticky math and `pinHeight` (Tasks 2, 3), scrolling rules and panel expansion (Task 5), liveness and confetti table (Tasks 1, 2), lifetime rules (Task 2), analytics and docs (Task 7), Definition of Done geometry and behavior (Task 6), publication (Task 8).
- Type consistency: `createAlertPin`, `resolvePinClose`, `alertIdentitiesBySection`, `pinScopeKey`, `scrollTargetTop`, `PIN_HEIGHT`, `pinAlert`, `closeAlertPin`, `AlertPinBar` are named identically wherever used.
- Open items for execution to settle and record: the exact alert-cohort loading signal for `loading` (Task 2 Step 4), the z-index need (Task 3 Step 4), the exact call-site inventory (Task 4 Step 1), and `alertDismissedRef` consumers (Task 0 Step 3).
