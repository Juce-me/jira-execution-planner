Status: planned
Type: feature

# Alerts workflow: pinned alert and return to the list (#209)

Issue: Juce-me/jira-execution-planner#209 ("improve alerts workflow").
Branch: `feature/209-alerts-pinned-workflow`.
Scope: ENG Catch Up alert panels only. Board, Planning, Statistics and Scenario render no alerts and must not change in any measurable way (pin height is exactly 0 there).

Revision 2 (2026-10-24): rewritten after three independent reviews (code feasibility, repo rules, issue coverage and testability). Sections marked "review fix" changed substantially.

## Intent

Working through alerts today is a loop: click an alert, get scrolled to its Story or Epic, fix it, scroll back to the alerts by hand and find your place. Nothing on screen says which alert you are fixing, and nothing returns you to the list. Keep the clicked alert in view while its target is edited, and bring the user back to the alert list when they finish.

## Behavior

Confirmed by the operator (items 1 to 7); everything under "My calls" is mine.

1. Clicking an alert pins that alert as a single row directly under the sticky header stack (below the filter bar). Only one alert is pinned at a time.
2. Clicking another alert replaces the pin with the latest click, whether or not the first alert was resolved.
3. A back-to-alerts button sits to the left of the pinned row. It scrolls to the alert list and keeps the pin.
4. The pinned `×` (`task-remove alert-remove`) dismisses the alert (when it is still live), clears the pin, and always scrolls to the alert block (category section) the alert belongs to.
5. If that block no longer exists, confetti fires and the page scrolls to the top.
6. The pinned row reuses the `.alert-story` title/note/dismiss composition (MRT029). The back button is the only added control.
7. Every control works by tap; nothing is hover-only and nothing needs dragging.

## My calls (veto any)

### What clicking pins (review fix)
- The pin is created for **every alert interaction that identifies an alert**: the row's primary navigate click (`handleAlertStoryClick`, the Stories required `handleStoryRequirementClick`, the future-routed Epic row click) **and** the row's action links, including the ones that open Jira in another tab (Fix fields, Move to next sprint, Clean backlog stories, Open epic, Create story, Close epic). The link still opens as today. Reason: for Empty epic, Ready to close, Waiting, Backlog and Postponed the Jira tab is the only real fix path, so the pin is how the user finds their place on return. This is the largest user-visible call; say so if you want only navigate clicks to pin.
- Pin creation goes through one shared `pinAlert(...)` wrapper called from each row's own click and link closures (about 25 call sites in `EngAlertsPanel.jsx`), not scattered state setters.

### What the pin shows (review fix)
- A **static snapshot**: back button | issue key and summary (single line, ellipsis) | category label as the note | `×`. No status pill, no pills, no action column. Reason: a live status pill is a Jira write element needing a design-system contract (AGENTS.md section 10), and a static one goes stale exactly when the user edits the target.
- This needs a different grid than the 5-column `.alert-story` grid. The base class stays untouched; the pin adds one modifier class (for example `alert-story--pinned`) that only sets the grid template and a fixed height. It is the one new class, registered in `docs/design-system.md` (class-hook JSON block) with a ratchet entry and a stated reason. The back button reuses `IconButton` with `icon-button--sm` (as the Inherited-view hint dismiss does); no new button class.

### Where the pin lives (review fix)
- Pin state is owned by `dashboard.jsx`. It is rendered by a sibling **outside `EngAlertsPanel` and outside the `EngView` loading/error branch**, so it survives the panel returning null (last alert resolved), loading states, and task refreshes. The builder chooses the exact host (`EngView.jsx` above the loading ternary, or the Catch Up shell in `dashboard.jsx`), subject to that rule.

### Sticky math (review fix)
- The pin is `position: sticky` in the Catch Up flow directly after the filter bar, with `top = compactStickyTop + filterBarHeight` taken only from the `dashboard.jsx` computed values (MRT009: one shared offset model, no CSS-only `calc` for the pin).
- The pin has a **fixed height** (single line, `white-space: nowrap`, ellipsis, same at every width, including phone). No measurement chain, so no one-frame lag.
- `pinHeight = isCatchUpMode && pin ? PIN_HEIGHT : 0`, derived synchronously in the same render (never from pin state alone, never cleared in a later effect), and added into `epicStickyTop` so `.epic-header` sticks directly below the pin. `--planning-sticky-top` is not touched.
- Every consumer of `epicStickyTop` must be re-verified with the pin present: `computeStickyEpicFocus` and its deps, the `getViewport` callback, `--epic-sticky-top` and `--scenario-sticky-top`, `scroll-margin-block` for story requirements (`styles/eng/issues.css`), and `EngBoardView.jsx`. This is the one MRT009 exception, justified because the pin is a real new sticky tier; no other offset or z-index changes.
- Mounting the pin pushes content below it down once (sticky in flow). The header, filter bar and shell above it do not move. The anti-goal below is worded for that.
- `STICKY_STACK_SELECTORS` in `alertEpicNavigation.js` gains the pin. `shareView/focusCapture.js` keeps its own list and is unaffected (no pin in a shared view); the builder confirms `tests/test_share_view_alert_anchors.js` still passes.

### Scrolling (review fix)
- A new small scroll helper (in a node-testable module, e.g. `frontend/src/eng/alertPin.js`) scrolls a target so its top lands at or below `measureStickyBottom()` plus a 12px guard, with smooth behavior unless reduced motion (use the `dashboard.jsx` `prefersReducedMotion`). Both "back to alerts" and "scroll to block" use it. The `scroll-margin-top: 6rem` on `.alert-card[id^="eng-alert-"]` is not relied on.
- **Back to alerts** targets the top of `.alerts-panel-shell`. **Scroll to block** targets the pinned category's section (`sectionId`). They are different targets.
- Both first call `setShowAlertsPanel(true)` and the category's `setExpanded(true)`, then scroll after two animation frames (the `focusAlertSection` timing), because the element does not exist while hidden or collapsed. The pin stays visible when the user hides the alerts panel, so the route back always exists.
- Story and Epic target scrolling (`scrollToTaskItem`, centered) must not leave the target under the pin: after the pin mounts, a target whose top is above `stickyBottom + 12` is adjusted down. `navigateToStoryRequirement` already measures the stack and gets the pin by selector.

### Liveness, "block gone" and confetti (review fix)
- **Identity:** the Jira issue key for every category except Stories required, whose identity is its requirement id (`entry.id`). The pin also stores its category `sectionId` and which dismiss path applies. A key in two categories is pinned under the category that was clicked; global per-key dismissal hides it in both, which matches the list `×`.
- **Counts are taken from the same filtered collections the panel renders** (`visibleAlertCollections`, per `sectionId`, including `needsStoriesEntries`). "Live" means the identity is still in the pinned category's rendered set. "Block gone" means that category's rendered count is zero after the `×` is applied, evaluated after commit (effect or ref over current collections), never from the pre-dismissal `Set.size === 1` checks in `dismissAlertItem`.
- While the alert cohort is loading or invalidated (reload pending), liveness and block-gone are **unknown**: the `×` scrolls to the block if it exists, otherwise to the top, and never fires confetti or skips a real dismissal because of a transient empty set.
- **Live `×`:** dismiss through the existing path (`dismissAlertItem`, or `dismissStoryRequirement` for Stories required), clear the pin, then scroll or celebrate. **Not live `×`** (resolved by editing): clear the pin only, record no dismissal, then scroll or celebrate by the same block-gone rule.
- **Confetti** reuses `triggerAlertCelebration` and fires exactly once per `×`. `dismissAlertItem` already celebrates for some categories using the old size check; the pin path suppresses that built-in burst (a flag) and celebrates from its own predicate, so all ten categories behave the same and the burst never doubles. The existing gaps (no celebration for Backlog, Missing team, Missing labels, Stories required in the list `×`; Stories required mapped to the `'waiting'` palette) are reported, not fixed, in this change. The pin supplies a palette fallback for categories without one.
- `triggerAlertCelebration` returns early under reduced motion, so the scroll-to-top branch lives outside it and still runs. Confetti and scroll must not race the pin-removal render.
- The builder must read what `alertDismissedRef` gates before adding a pin-driven dismissal, and record it in the plan.

### Pin lifetime (review fix)
- Cleared when leaving Catch Up (via the derived `pinHeight`, plus clearing the state), and when the user changes the **selected Sprint or Department group**. Compared by user-selected values; a cache-to-live resolution of the same selection must not clear it.
- **Not cleared** by `selectedTeams` or filter changes: the alert click itself calls `clearEngFilters` before pinning, and that must not remove the pin. The clearing effect must not share dependencies with the confetti-clearing effect (`[selectedSprint, activeGroupId, selectedTeams]`).
- For Stories required, pin clearing lives in the same effect that clears `dismissedStoryRequirementIds` on scope change, so the two cannot drift.
- Task refreshes, per-edit alert rechecks and background alert reloads keep the pin.

### Other calls
- "Block" means the alert category section, the unit the summary chips already scroll to. Team groups are not blocks.
- Touch targets: the back button and the pinned `×` each get at least a 24 by 24 CSS px hit area (WCAG 2.2 AA minimum). The pinned `×` may enlarge its hit area inside the modifier class without changing its look; the list `×` is untouched. The pinned `×` is not hover-gated (it must stay visible on touch; the global `.task-remove` hover-reveal does not apply to `alert-remove`, and the test proves it).
- No analytics event: internal navigation, and the pin `×` is the same user action as the list `×`, which has none. Add the row to the No-Event Allowlist table in `docs/README_ANALYTICS.md` (trigger none, `event_type` none, `event_name` none, `feature_name` alerts, params none, date) and an "Analytics allowlist reason" line in `docs/features/alerts.md`; a Playwright check proves no `dataLayer` entry is pushed by the pin controls.

## Goals

- The user always sees which alert they are fixing while editing its target.
- Returning to the alerts after a fix is one tap and lands on the right place.
- Clearing the last alert of a category feels finished: confetti, back at the top.

## Non-goals

- No new alert category, no change to what alerts show, to alert filtering, or to dismissal persistence.
- No multi-pin, no pin persistence across reloads, none in shareable view links.
- No redesign of alert rows, no live Jira write element in the pin, no new row actions.
- No fixes to the existing list-`×` confetti gaps (reported only).
- No keyboard-specific work beyond what existing controls give (parked in `docs/TODO.md`).

## Anti-goals

- The pin moves, covers or re-layers the compact header, filter bar or Epic header beyond the single justified `epicStickyTop` addition; no other offset or z-index changes (MRT009).
- The header, filter bar or shell above the pin move when it appears or disappears (content below it shifts once on mount, by design).
- The pin or back button restyle `.alert-story` base rules or add a bespoke button (MRT029, MRT020, MRT021); only the single registered modifier class is allowed.
- Dismissing from the pin hides a different alert than the one pinned, or records a dismissal for a resolved alert.
- Confetti fires twice, fires on a transient empty set during reload, or fires for the wrong category.
- Clicking an alert whose target is hidden by filters leaves the user at the alert (existing `navigateToAlertStory` filter clearing keeps working).
- The pin affects Board, Planning, Statistics or Scenario sticky offsets.

## Constraints

- Frontend only: no backend, API or storage change. Pin state is in-memory React state.
- Hover and focus use design-system foundation tokens; no transform in `:hover`/`:active`; no `transition: all`.
- `frontend/dist` is rebuilt with `npm run build`, never hand-edited.
- `dashboard.jsx` appears many times in `scripts/extraction_lint/owner_budgets.json`; confirm which touched files are registered, re-sync ceiling, aggregates, `unresolved` and `sourceDigest` in the same commit, and run `tests.test_codebase_structure_budgets` (no CI runs the lint).
- The implementation plan goes in `docs/plans/` per `docs/plans/AGENTS.md` (read it first); this document stays the design.

## Files allowed to touch

- `frontend/src/dashboard.jsx` (pin state, `pinHeight`, `epicStickyTop`, clear effect, dismiss flag, scroll wiring)
- `frontend/src/eng/EngAlertsPanel.jsx` (shared `pinAlert` calls only)
- `frontend/src/eng/EngView.jsx` (pin host, if chosen)
- `frontend/src/eng/alertEpicNavigation.js` (pin in `STICKY_STACK_SELECTORS`)
- new `frontend/src/eng/alertPin.js` (pure helpers: pin shape, liveness, block-gone, scroll target)
- `frontend/src/styles/eng/alerts.css` (modifier class and fixed height)
- `frontend/dist/` (via build only)
- `tests/ui/eng_alerts_panel_summary.spec.js` or a new `tests/ui/eng_alert_pin.spec.js`, plus a node test for `alertPin.js` run the way `tests/test_share_view_alert_anchors.js` is
- `docs/features/alerts.md`, `docs/design-system.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md`, `tests/design_system_baseline.json` ratchet entries, `scripts/extraction_lint/owner_budgets.json`, this document

## Left to the builder

Pin host choice within the stated rule, state shape, back-button icon and label, the exact fixed pin height, animation details, and fixture strategy within the testing rules below.

## Definition of Done

Every item needs evidence from a command output or a looked-at screenshot before it is ticked.

Behavior (Playwright, route-mocked fixture; the fixture gains data for Postponed, Backlog, Missing team, Missing labels and Stories required, so all ten categories exist)
- [ ] For each of the ten categories, a primary row click pins that alert: one assertion per category on the pinned row's text and position.
- [ ] For each category's action links (including the Jira-opening ones), a click pins the alert and the link still opens (popup or target attribute asserted).
- [ ] A second click replaces the pin; exactly one `.alert-story--pinned` exists at all times.
- [ ] Back to alerts: after settling, `.alerts-panel-shell` top is at or below the pin bottom and within 24px of it; the pin remains; nothing is dismissed; works with the alerts panel hidden and the category collapsed.
- [ ] Pinned `×` on a live alert dismisses exactly that alert, clears the pin, and after settling the category block top is at or below the pin's former bottom stack and within 24px of the sticky stack bottom; a collapsed or hidden block is expanded first.
- [ ] Confetti: pieces (`.alert-celebration .alert-confetti`) appear when the pinned `×` empties its category (one assertion per category), do not appear when a sibling alert remains, appear exactly once (one burst), and under `emulateMedia({ reducedMotion: 'reduce' })` do not appear while `scrollY === 0` still holds after settling.
- [ ] Block gone: after settling, `scrollY === 0`.
- [ ] Resolved by editing, last in category: edit driven through the real Story Points or status edit path (not by mutating mock state), pin stays, `×` records no dismissal (the key stays absent from the dismissed set and reappears if its alert returns), confetti once, `scrollY === 0`.
- [ ] A key present in two categories: dismissing from the pin hides it in both and fires confetti only for categories that became empty.
- [ ] Pin lifetime: survives a Refresh, a per-edit alert recheck and a background alert reload; clears on leaving Catch Up, on user Sprint change and on Department group change; does not clear on a cache-to-live resolution of the same Sprint, on `selectedTeams` change, or on the filter clearing done by the alert click; survives hiding the alerts panel.
- [ ] Reload pending: `×` neither fires confetti nor skips dismissal because of a transient empty set.
- [ ] Hidden-by-filters target: click reveals the target, pins the alert, and the target is not covered by the pin (target top at or below pin bottom).
- [ ] Stories required: identity uses `entry.id`; pin clears in the same effect as `dismissedStoryRequirementIds`.

Layout and design system (screenshots plus element-level geometry; look at the screenshots)
- [ ] Pinned row uses the `.alert-story` composition with only the registered modifier class; back button reuses `IconButton` `icon-button--sm`; the class is in `docs/design-system.md` and the ratchet baseline, with the ratchet test run.
- [ ] Geometry: pin top equals filter-bar bottom; `.epic-header` top equals pin bottom when stuck, in List with and without Group by Initiative (direct and under `.initiative-body`); back button left of the row; no clipping (`scrollWidth <= clientWidth`); back button and pinned `×` hit area at least 24 by 24; pin height identical at desktop and phone width (375 wide) and does not wrap.
- [ ] Header, filter bar and shell positions are unchanged across pin show and hide at `scrollY` 0 and when scrolled.
- [ ] `pinHeight` and `--epic-sticky-top` are unchanged versus a no-pin baseline in Board, Planning, Statistics and Scenario, and return to baseline in the same render that leaves Catch Up.
- [ ] Verified with a long summary (ellipsis, no growth) and with more than 30 alerts.
- [ ] Taps (touch emulation) work for every pin control; the pinned `×` is visible without hover.
- [ ] Pin controls push no `dataLayer` entry.

Verification gates
- [ ] Node test for `alertPin.js` (pin replace and clear, liveness, block-gone per `sectionId`, scroll target math) fails without the change and passes with it.
- [ ] `tests/test_share_view_alert_anchors.js` and the existing alert specs (`eng_alerts_panel_summary`, `eng_alert_loading_order`) still pass.
- [ ] `npm run build` clean; `frontend/dist` committed if `verify-frontend-build.yml` requires it.
- [ ] Full Python suite green with the command and summary line quoted, including `tests.test_codebase_structure_budgets`.
- [ ] Full Chromium `tests/ui` run green (known flaky specs rerun alone and reported as such), command and summary line quoted.
- [ ] Authenticated localhost dashboard checked in a real browser, read-only, numbers-only, no saved screenshots of live data; pass criterion: clicking an alert pins it under the header, `×` returns to the block, and the sticky Epic header stays aligned beneath the pin.

Documentation and process
- [ ] `docs/features/alerts.md`: pin, back button, `×`, confetti and scroll rules, plus the analytics allowlist line.
- [ ] `docs/design-system.md`, `docs/README_ANALYTICS.md` (No-Event Allowlist row), `docs/ontology.md` (new "alert pin" entry with entry points and verification date) updated; paths and symbols resolve.
- [ ] Extraction budgets re-synced if a registered file grew.
- [ ] The existing list-`×` confetti gaps are listed in the PR notes as out of scope.
- [ ] This document renamed to `executed` with `Outcome` and `Current Accuracy`; divergences recorded.
- [ ] Publication follows the section 10 transaction in `AGENTS.md`: base and head SHAs, commit list and changed paths compared against the plan, PR body via `--body-file -`, remote head verified, CI state reported; PR notes include before/after screenshots.

Follow-up 1 checks
- [x] All ten categories map to the summary-pill tone and the header icon (`tests/test_alert_pin.js`, `tests/test_alert_pin_bar.js` header render check); Playwright asserts icon, accent colour and tint per category (10 category specs, plus 2 width specs for the 40px row).
- [x] Pin stays exactly 40px with a long summary at 1280 and 375 for the blocked, missing, following and done tones, `scrollWidth <= clientWidth`; screenshots looked at (tmp only).
- [x] Epic headers still never paint over the pin (existing spec green).
- [x] (Superseded by follow-up 2: the title now goes to the Story or Epic; this locate behavior and its specs were removed.) Title click after scrolling deep lands the alert row at or below the stack and within 24px, pin kept (no remount), row count unchanged; panel hidden and category collapsed are expanded first; a key in two categories lands the pinned category's row; a resolved row falls back to the block, a gone block to the alert list, with no page error; tap and Enter work.
- [x] Discrimination: a broken row lookup fails 8 of the 10 locate specs (removed in follow-up 2); removing the `[data-tone]` rule fails the 10 per-category tone specs.
- [x] Gates: node 3038 pass, design-system 60 pass, budgets OK, Python 2413 OK (50 skipped), Chromium `tests/ui` 1910 passed, 12 skipped, 0 failed (18.9m); `npm run build` clean.

Follow-up 2 checks
- [x] Shape: the pin's computed radius is 10px on all four corners, its border `1px solid` in the `--border` colour on all four sides, its left and right edges equal the filter bar card's (`.filterbar`) within 1px at 1280 and 1440, in flow and stuck, at 40px; corner points outside the rounded shape hit the pin when stuck (no content shows through). RED: 2 specs failed on the old CSS through the radius and border assertions; removing the corner fill fails both again. The edge assertions are a regression guard only: in the mocked fixture the boxes already shared the edges, so they would also pass against the old strip. Real alignment in the authenticated app is for the operator to verify.
- [x] Measured edges (fixture): `.filterbar`, the pin, `.alerts-panel-shell` and `.epic-block` share the same box, 136.5 to 1128.5 at 1280, 216.5 to 1208.5 at 1440 and 24 to 351 at 375. Filter bar card to pin gap: 13.6px (the wrap's 0.85rem bottom padding), stuck and in flow.
- [x] Title click: a Story (Blocked), an Epic (Waiting) and a Story requirement (Stories required) start out of view and land at or below the sticky stack, inside the viewport and uncovered; a target hidden by filters is revealed; Enter and tap work; pin kept (no remount), row count unchanged, no page error. A target missing from the list (Empty epic) behaves as the row's own title (no scroll, no popup in the fixture). RED: 7 of 7 failed on the locate bundle; a no-op handler fails 6 of 7 (the missing-target spec passes by design).
- [x] Contrast: label, key and summary reach 4.5:1 on the tint composited over the opaque base for all five tones (label 4.68 missing/empty, 5.34 blocked, 6.54 following, 4.83 done; key `#666` 4.65 to 4.96; summary 14.1 to 15.1); the base equals the body background. RED: 3 specs failed with the old label colours.
- [x] Screenshots looked at (tmp only, synthetic data): five tones at 1280 and 375, the pin under the filter bar card with the Epic card below, in flow and stuck.
- [ ] Gates at the merged head (`90bf6ad8`, with the dismiss-ring and Epic-reveal fixes): re-run pending; numbers to be recorded.
- [x] Gates before the merge (at `6095b615`): `node --test tests/test_*.js` 3038 pass, 0 fail; `node --test tests/test_design_system_*.js` 60 pass; `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` OK (dashboard.jsx unchanged at 7659 lines); `.venv/bin/python -m unittest discover -s tests` 2413 OK (50 skipped); pin spec (82) plus `eng_alerts_panel_summary`, `eng_alert_loading_order` and `eng_missing_story_ghosts` 133 passed; `npx playwright test tests/ui --browser=chromium --workers=4` 1909 passed, 12 skipped, 0 failed (17.4m), no reruns; `npm run build` clean.

## Divergences found during execution

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
- (xiii) Follow-up 1 (operator review in the real app): the pin gained its category tone and icon, and its title scrolled to the alert's own row (a misreading, replaced in follow-up 2: the title goes to the Story or Epic); see "Follow-up 1 (2026-10-25)". Within it: no existing highlight fits alert rows (`task-highlight` paints only `.task-item`), so the locate click scrolls without one; the header icons moved into `ALERT_CATEGORY_STYLE` (one source for headers and pin) instead of a source guard; the pin gained `padding-inline: 0.5rem` so the accent does not touch the Back button.
- (xiv) Follow-up 2 (operator review in the real app): the pin became a rounded bordered card aligned with the filter bar card, and its title goes to the Story or Epic; see "Follow-up 2 (2026-10-25)". Within it: an absolutely positioned `::before` paints the corners outside the rounded shape with the page background (padding box only, so the row does not overflow by 1px); the accent stays an inset shadow and follows the radius; the title calls `handleAlertStoryClick(key, false)`, so a Missing info pin does not open the Story Points editor the way its list row does when Story Points are missing.

### Follow-up 1 (2026-10-25)

The operator looked at the pinned row in the real app and asked for two changes: (1) the row "looks odd, something is missing", it needs a focus such as an icon or contrast to be noticeable; (2) once the page has scrolled, clicking the pinned alert's title should scroll back to that alert in the list.

Built: (1) the pin takes its category's summary-pill tone (`data-tone` on `.alert-story--pinned`: a 3px inset left accent, the pill's 0.1 tint layered over `--bg-primary`, the tone colour on the label only) and shows the card header's icon before the label; the icons live in `ALERT_CATEGORY_STYLE` (`eng/alertPin.js`), read by both the card headers and the pin. The 40px box, z-index and opaque base are unchanged. (2) the title (`alert-story-main`) is a `role="button"` control like the list rows' own (click, tap, Enter, Space). It reuses the block reveal (panel shown, pinned category expanded, two frames), then lands the row found by `data-alert-id` inside the pinned category with `alertLandingTop`; `findPinTarget` falls back to the block, then the alert list, never throws. The pin stays, nothing is dismissed, Back and `×` are unchanged. Request (2) was misread: the operator meant the alert's Story or Epic, not the alert row. Follow-up 2 replaced this behavior and removed `findPinTarget`, `data-alert-id` and the locate plumbing.

### Follow-up 2 (2026-10-25)

The operator looked at the pin in the real app and asked: (1) "are you sure this bluish UI is aligned with the design doc? rounded corners or the app?"; (2) "click on alert-story-main should lead to the story/epic in the catch up, not back to the alert list." Follow-up 1 had read the earlier title request as "scroll back to the alert row"; the operator meant the alert's target.

Built: (1) `.alert-story--pinned` is a card like the filter bar card: the existing 10px radius and `1px solid var(--border)`, `box-sizing: border-box` inside the 40px box, on the filter bar card's left and right edges (in the route-mocked fixture the boxes already shared them, so the edge specs are a regression guard, not RED proof; the square, borderless strip read as a different element; real-app alignment is for the operator to verify). A `::before` paints the corners outside the rounded shape with the page background, as `.filterbar-wrap::before` does for the filter bar. The tint and the inset 3px accent stay; the accent follows the radius. (2) The title calls the list row's own handlers: `handleAlertStoryClick(pin.key, false)` for issues and `handleStoryRequirementClick({ id: pin.identity })` for Stories required. Their filter-clearing reveal and their fallbacks apply unchanged. `findPinTarget`, `data-alert-id` on the rows and `onLocate`/`onPinLocate`/`locateAlertPin` are removed; Back keeps `revealAlertBlock`'s `target`. (3) Review finding I1: the orange and red tones get a darker label colour (`--alert-pin-label`: `#ad4e00`, `#b02a05`), and the tone spec asserts 4.5:1. Review minors: the base colour is asserted against the body background, the note drops the leading space without an icon, and the tone screenshots are written only when `PIN_SHOT_LABEL` is set.

Open question for the operator: a Missing info pin goes to the Story but does not open the Story Points editor that its row title opens when Story Points are missing. Parity would need the pin snapshot to store the alert's missing fields; behavior is unchanged until the operator decides.

Merge: the follow-up 2 commits were merged with the dismiss-ring and Epic-reveal fixes (merge commit `90bf6ad8`); the full gates at the merged head are being re-run, and their numbers will be recorded there.
