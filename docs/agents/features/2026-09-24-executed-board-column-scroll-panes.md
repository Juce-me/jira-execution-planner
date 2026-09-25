Status: executed
Type: feature

# ENG Board Independent Column Scroll Panes

## Intended Outcome

On desktop, every ENG Board column is a bounded, bordered pane running from its title line to the
screen bottom. Open columns scroll independently: once the board is in sticky mode, wheel or
trackpad scrolling over a column moves only that column. The first downward scroll moves the page
until the column titles reach the sticky line under the ENG filter bar (sticky mode on). Scrolling
back up returns the column to its top first, then the page, which releases sticky mode. Column
content never paints outside its pane, so it cannot leak over the filter bar, the top controls, or
any other surface. Column titles are always visible.

## User-Confirmed Decisions

2026-09-24:

1. Replace the page-scroll plus JS-pinned column chrome design with per-column inner scroll panes
   on desktop. This supersedes the "no internal vertical card scroller" constraint of
   [2026-08-08-executed-sticky-board-column-chrome.md](2026-08-08-executed-sticky-board-column-chrome.md),
   [EXEC-sticky-board-column-chrome.md](../../plans/EXEC-sticky-board-column-chrome.md), and the
   "no second scroll container" constraint of
   [2026-08-08-executed-unfolded-board-column-scroll.md](2026-08-08-executed-unfolded-board-column-scroll.md)
   for pane mode only. (`.board` is already a horizontal scroll container today, so the latter
   constraint was already only about vertical scrolling.)
2. Sticky mode: page first, then column.
3. Mask: each column is its own bordered pane from its title line to the screen bottom.
4. Mobile and viewports that fail the pane-mode gate keep the existing behavior, including the
   JS-pinned chrome and the compact header.
5. Column titles are always visible in every mode; cards scroll under the title.
6. In pane mode the ENG filter bar is the only sticky layer: the compact sticky header is
   suppressed for the Board while pane mode is active. The full top control bar scrolls away as
   normal content and returns when the user scrolls the page back up.

2026-09-25 (after adversarial review):

7. Collapsed rails also extend from the title line to the screen bottom in pane mode.
8. Open columns keep their scroll position when the board un-sticks, so the user controls the
   scroll state of visible columns. A column that is folded resets to the top; reopening it starts
   at `scrollTop` 0.

## Why The Compact Header Is Suppressed

`.compact-sticky-header` is `display: none` until `headerRef.bottom <= 0`
(`frontend/src/dashboard.jsx`, compact visibility effect), then enters normal flow and raises
`--epic-sticky-top` through `compactStickyTop`. Sizing panes for a stuck state that includes it
ends the page before the full header can scroll off, so the compact header never appears; sizing
without it makes panes overflow once it appears. The sizing is circular. With the filter bar as the
only sticky layer, the sticky line equals the always-rendered, already-measured filter bar height.

Rejected alternatives: an on-demand focus/fullscreen control (drops decision 2; `Cmd+F` would also
hijack browser Find), and always rendering the compact header invisibly for measurement (changes a
shared component used by Catch Up, Planning, and EPM; MRT009 risk). An explicit focus control may
be added later on top of this design.

## Design

### State ownership

`EngBoardView` owns two classes on the `.eng-board` root, `is-pane-mode` and `is-pane-stuck`. Both
are toggled imperatively by the same function that already owns `is-chrome-pinned`
(`syncBoardChrome`, scheduled by the rAF-coalesced `scheduleBoardChrome`). Neither is rendered
through React `className`, so a React render cannot wipe one while the other survives. No new
scroll listeners; MRT003 applies (rAF-throttled, cancelled on unmount).

### Mode gate

Pane mode is on only when all hold, re-evaluated in the existing layout pass (`applyBoardLayout`,
resize, `ResizeObserver`) and whenever the measured filter bar height changes:

- viewport width is greater than 760px (repo narrow/mobile convention);
- `matchMedia('(hover: hover) and (pointer: fine)')` matches, so touch tablets in landscape keep
  the existing behavior;
- `innerHeight - filterBarHeight >= max(--board-strip-h, colHeadHeight + minBody)`,
  where `filterBarHeight` is the measured `.filterbar-wrap` height (never `--epic-sticky-top`,
  which may still include the compact header offset when the gate is first evaluated) and
  `minBody` is one card height. The plan fixes the exact numbers from measurement.

A few pixels of hysteresis prevent flapping when filter chips wrap. When the gate fails, the
current behavior is untouched: page scroll, `syncBoardChrome` pinning, `.is-chrome-pinned`,
`--board-chrome-*`, rail-click vertical reveal, and the compact header. Switching mode clears the
other mode's classes and inline properties in the same pass.

### Compact header suppression

`EngBoardView` reports pane mode through a callback prop following the `onFilterBarHeightChange`
pattern. The dashboard derives `compactStickyVisible = headerScrolledAway && !boardPaneMode`, so
`compactStickyTop`, the active control surface, dropdown ownership, and the dropdown-close effect
all see the suppressed state. `EngBoardView` reports `false` on unmount, on its loading, error, and
empty early returns, and whenever `.board` is absent, so the compact header can never stay
suppressed outside Board pane mode. A top-bar dropdown left open when the top bar scrolls away is
closed.

### Structural pane geometry

The height is structural, not measured per column:

- In pane mode `.board` gets `height: calc(100dvh - var(--epic-sticky-top))` and
  `padding-bottom: 0`.
- Open columns and rails stretch to `.board`'s content box (`align-self: stretch`). That box
  already excludes the board's horizontal scrollbar, so overlay and classic scrollbars, and the
  scrollbar appearing or disappearing, need no measurement.
- The remaining document space below the board (today `.container`'s 3rem bottom padding) is
  cancelled by a negative bottom margin on `.eng-board` in pane mode. The value is measured in the
  existing layout pass and published as a custom property registered in
  `tests/test_eng_board_styles.js`; it is not hard-coded from `shell.css`.
- Result: at maximum page scroll the board top sits at the sticky line and the board bottom at the
  viewport bottom. Pane bottom borders are painted inside the viewport, above the horizontal
  scrollbar when one is present.
- Open column: vertical flex container. `.col-head` is `flex: none` at the top, no pinning.
  `.col-body` is `flex: 1 1 auto; min-height: 0`, keeps its grid, and is the scroller:
  `overflow-y: hidden` when not stuck, `overflow-y: auto` when stuck, `overflow-x: hidden`,
  `scrollbar-gutter: stable` (no card reflow when the scrollbar appears on classic-scrollbar
  platforms), `scrollbar-width: thin` matching `.board`. `overscroll-behavior-y` stays `auto` so
  upward overscroll chains to the page.
- Rail: `.col-strip` stretches to the board height instead of the fixed 340px. The fill keeps its
  existing percentage-of-track sizing, so rail ratios are unchanged and the chart grows with the
  track. The onboarding spotlight stays capped at `--board-strip-h` (340px).
- `.board-say` announcements are taken out of flow in pane mode and float at the bottom of the
  board (the viewport bottom when stuck) using the rail's border, radius, and surface, so a drop or
  refusal announcement neither pushes the board off the sticky line nor hides under the filter bar.

### Sticky state

Stuck is true in pane mode when the board frame top is at or above `--epic-sticky-top + 1px`, or
the page is at maximum scroll (`scrollY >= scrollHeight - innerHeight - 1`). The maximum-scroll arm
keeps columns reachable under fractional zoom and device pixel ratios. Both the check and the tests
use one shared tolerance constant.

Browsers latch a scroll gesture to one scroller, in both directions: a single flick stops at the
stuck point and a new gesture continues in the column; at a column's top a new gesture continues on
the page. A diagonal trackpad gesture over a stuck column latches to the column, so board panning
needs a horizontal-first swipe. This native behavior is accepted, not overridden.

Wheel over anything that is not an open column body (rails, gaps between columns, the filter bar)
scrolls the page. While stuck, an upward wheel there scrolls the page up and releases sticky mode.
This is expected: those surfaces have nothing to scroll.

### Scroll position

Open columns keep their `scrollTop` across stuck and unstuck transitions (decision 8). While not
stuck, a column with `scrollTop > 0` keeps its offset; the next downward page scroll re-sticks the
board and the column is scrollable again. Folding a column resets it; reopening sets `scrollTop` to
0 after commit.

`overflow-y: hidden` is still programmatically scrollable: `focusCard`, `closePanel` focus return,
Tab navigation, and the onboarding tour's `scrollIntoView` can scroll a column while not stuck.
When focus enters a column body in pane mode while not stuck, the page scrolls to the stuck
position so the focused card is inside a scrollable pane. This is focus handling, not wheel
interception.

### Mask

Each pane (open column and rail) reuses the rail's border and radius (`border: 1px solid
var(--border); border-radius: 8px` from `.col-strip`) with `overflow: hidden` for clipping. The open
pane background is unchanged; cards are not restyled; the title keeps its accent underline.
`.col-body` gets at least 4px of top and inline padding so card focus rings and the drop outline
are not clipped; the card hover shadow may be clipped at the pane edge.

The existing breach styling moves from `.col.is-breach .col-body` to the open pane in pane mode
with the same values, so the glow is not clipped and no second nested border appears.

Card popovers that follow their trigger on scroll (person editor, value readout) close when
their trigger scrolls out of its pane.

### Adjusted existing behavior

- Rail click in pane mode (pointer only, as today): focus the column, scroll the page to maximum
  scroll (`scrollHeight - innerHeight`), and set the newly opened column's `scrollTop` to 0 after
  commit. Reduced motion uses instant scrolling, as today.
- Off-frame hint pips stay centered on the board-scroll area, which is now viewport-tall; their
  resulting mid-pane position is a documented visible change.
- Unchanged: focus, fold, star, drag/drop (including the portalled drop menu), horizontal board
  scroller and centering, epic panel modal, column widths, 36px rail width.

## Forbidden Regressions

- No JS wheel interception or manual scroll routing.
- No change to the compact header, filter bar, Planning panel, or `.epic-header` behavior outside
  Board pane mode (MRT009; re-verify Catch Up, Planning, Scenario sticky stacks).
- No new z-index tier; no `position: fixed` in pane mode.
- No change to fallback-mode behavior.
- No restyling of cards, the title row, status pills, or rail fill; breach styling only moves.
- No unscoped board selectors; every rule stays under `.eng-board` (`tests/test_eng_board_styles.js`).
- No analytics event.

## Existing Tests That Change

These run at viewports that pass the new gate and assert the old model, so they move to a viewport
that fails the gate with clear margin (the plan picks it from measurement, for example 1280x440),
keeping their assertions:

- `tests/ui/eng_group_board_view.spec.js`: the pinning test ("open headers and every collapsed rail
  pin below the live sticky stack..."), rail reveal and its sub-cases, non-rail no-reveal, pinned
  chrome release, and CSS variable resolution tests.
- `tests/ui/eng_group_board_filters.spec.js`: the popover-over-board sticky snapshot test at
  1280x600.

A new test pins the gate boundary. The existing 800x420 tests sit about 10px from the boundary and
are re-checked against the measured gate.

## Files Allowed To Touch

- `frontend/src/eng/EngBoardView.jsx`
- `frontend/src/styles/eng/board.css`
- `frontend/src/dashboard.jsx` (pane-mode callback wiring and the `compactStickyVisible` derivation only)
- `tests/test_codebase_structure_budgets.py` (itemized `(+N)` ratchet for `dashboard.jsx`, which has
  2 lines of budget left, and for `EngBoardView.jsx` if needed)
- The card popover hooks only if they need the out-of-pane close (`useIssueFieldPopover.js`,
  `EpicHeaderValueReadout.jsx`)
- `frontend/dist/*` (rebuilt with `npm run build`, never hand-edited)
- `tests/ui/eng_group_board_view.spec.js`, `tests/ui/eng_group_board_filters.spec.js`,
  `tests/ui/eng_group_board_drag.spec.js`, `tests/ui/eng_group_board_card.spec.js`,
  `tests/ui/eng_sticky_stack_helpers.js`,
  `tests/test_eng_board_styles.js`
- `docs/README_ANALYTICS.md` ("ENG Group Board sticky column chrome" allowlist row)
- `docs/ontology.md` (ENG Board entry)
- `docs/features/eng-workflows.md` (Board section: scrolling behavior)
- The two 2026-08-08 Board scroll artifacts and `docs/plans/EXEC-sticky-board-column-chrome.md`
  (Current Accuracy notes)
- `docs/plans/EXEC-board-column-scroll-panes.md` and `docs/plans/README.md`

## Postmortems To Review Before Implementation

MRT003 (rAF scroll work), MRT009 (sticky layering), MRT017 (fixed overlays in scrollable panels),
MRT018 (inner overflow clipping, long lists), MRT020/MRT021 (element-level geometry, reuse without
overriding), MRT027/MRT028 (confirmed constraints as acceptance criteria), MRT029 (reuse visual
language).

## Acceptance Criteria

Desktop pane mode at 1440x900 and 1280x800, plus one run at 125% zoom or device pixel ratio 1.25.
Long fixtures with more than 30 epics in at least two open columns. Wheel tests move the pointer
and wait out the gesture latch between phases, and poll until scroll values settle.

1. Before stuck, a wheel over an open column changes `window.scrollY` and no column `scrollTop`.
2. At maximum page scroll the board is stuck: every pane (`.col`) top equals `--epic-sticky-top`,
   the `.board` bottom equals `innerHeight`, and every pane bottom equals the board's content-box
   bottom (`board top + clientTop + clientHeight`), each within the shared tolerance.
3. When stuck, a wheel over open column A changes only A's `.col-body.scrollTop`; column B's
   `scrollTop` and `window.scrollY` are unchanged. Moving the pointer to B and scrolling changes
   only B.
4. With A at `scrollTop` 0, a new upward gesture decreases `window.scrollY` and removes
   `.is-pane-stuck`.
5. Un-sticking by scrolling up over a rail keeps B's non-zero `scrollTop`; the next downward page
   scroll re-sticks and B scrolls again. Folding and reopening a column starts it at `scrollTop` 0.
6. Every `.col-head .nm` title text is visible and within its pane's inner border at every scroll
   position, clipped only by its own ellipsis.
7. Leak class, reproducing the reported screenshot state (wide desktop, starred In Progress beside
   the focused column, stuck and partially scrolled): hit-testing inside the filter bar, the top bar
   area, and just outside every pane edge never resolves to a card, and no card's visible box
   extends beyond its pane. Filter-bar dropdowns, the Board help popover, the drop menu, the epic
   panel, and the onboarding spotlight still paint above the panes, each opened with a normal click.
8. The compact sticky header is not visible in Board pane mode at any scroll position, the full top
   bar is reachable by scrolling up, and after switching Board to Catch Up the compact header
   returns (shared header layering assertion per AGENTS.md).
9. Card widths are identical stuck and not stuck.
10. Rail click in pane mode leaves the board stuck with the opened column at `scrollTop` 0, after
    the smooth scroll settles.
11. Drag/drop between open columns and the drop menu work while stuck, and the board stays stuck
    after the drop announcement appears.
12. Focus entering a card in a not-stuck column (Tab, panel close focus return) scrolls the page
    to the stuck position.
13. A breached open column shows the unclipped breach ring and glow on the pane.
14. Rails reach the board bottom; fill ratios match the pre-change ratios.

Fallback mode:

15. At 420px width, at a gate-failing short desktop viewport, and with touch emulation at 1024x768,
    the board uses the existing pinned-chrome model and the moved fallback tests pass with their
    original assertions. The gate boundary test passes.

Global:

16. Catch Up, Planning, and Scenario sticky stacks are unchanged (`collectStickySnapshots`).
17. Before-and-after screenshots at 1440x900 and 1280x800 (stuck and not stuck), one fallback
    short-viewport shot, one breached column, and one short-list board showing full-height panes,
    with animations settled and each inspected against these criteria.
18. Full Python suite, `node tests/test_eng_board_styles.js`, `npm run build`, and the board
    Playwright specs pass. Firefox and Safari handoff behavior is checked manually and reported.

## Documentation Impact

- `docs/features/eng-workflows.md`: describe pane mode, sticky mode, the gate, and fallback.
- `docs/ontology.md`: ENG Board entry gains the pane-mode layout concept and its tests.
- `docs/README_ANALYTICS.md` "ENG Group Board sticky column chrome" row: reword (passive layout, no
  scroll collection).
- Mark the superseded 2026-08-08 artifacts and `EXEC-sticky-board-column-chrome.md` with a Current
  Accuracy note limiting them to fallback mode.

## Revision 2026-09-25: Fixed-Height Page (after live review)

The user reviewed the shipped pane mode on real data and changed three decisions. This section
supersedes decisions 2, 6 and 7 and every design rule, test and acceptance criterion below that
depends on them (sticky state, page-first hand-off, compact-header suppression, full-height rails).

User-confirmed decisions (2026-09-25):

9. No sticky mode. In desktop pane mode the page itself never scrolls: the full top bar (title,
   Sprint/Teams, ENG/EPM, mode switcher, search, settings) and the ENG filter bar stay in normal
   flow at the top, and the board fills exactly the remaining viewport height. Every open column
   body is always independently scrollable. There is no stuck state, no page-first hand-off, and
   no compact header (the top bar never scrolls away, so the compact-header suppression wiring is
   removed).
10. Collapsed rails return to their previous fixed 340px track (`--board-strip-h`); the rail fill
    scale is unchanged. Open panes keep their bordered full-height frame.
11. When pane mode cannot apply, Board keeps today's page-scroll model (pinned column chrome,
    compact header) and shows one compact alert strip above the board, reusing the existing
    `.board-data-state` strip and `secondary compact` button: text "Board needs a larger screen.",
    button "Request small-screen support". This applies to every non-pane case: a desktop too
    short for the top bar + filter bar + one 340px column, a viewport 760px wide or narrower, and
    a touch/no-hover pointer.
12. The button sends one analytics event per click through the existing `userevent` transport, then
    is replaced by "Thanks, noted" for the rest of the Board mount. Contract: `trigger=userevent`,
    `event_type=event`, canonical `event_name=board_action`, `feature_name=eng_board`,
    `workflow_action=small_screen_support_request`, `reason` (`short`|`narrow`|`touch`; touch wins
    over narrow, narrow over short), `source_surface=board`. No viewport sizes, ids, names or free
    text. No custom-definition registration.

Revised design rules:

- Gate: pane mode when `(min-width: 761px) and (hover: hover) and (pointer: fine)` matches and
  `innerHeight - boardDocumentTop >= max(--board-strip-h, focused head space + first card height)`
  (8px hysteresis when turning off), where `boardDocumentTop` is the `.board` top in document
  coordinates. The gate also yields the alert `reason` when it fails.
- Geometry: `.board` height is `calc(100dvh - var(--board-pane-top))`, where `--board-pane-top`
  is the measured `boardDocumentTop`, published by `EngBoardView` in the existing layout pass;
  the existing trailing-space negative margin stays so the document is exactly one viewport tall
  and maximum page scroll is 0.
- `.col-body` in pane mode is always `overflow-y: auto` (with `scrollbar-gutter: stable`,
  `overflow-x: hidden`). `is-pane-stuck`, its tolerance, the focus re-stick handler, the pointer
  guard, and the rail-click page reveal in pane mode are removed; a rail click in pane mode only
  focuses the column, which opens at `scrollTop` 0 (the open-column reset stays).
- Kept from the first iteration: bordered open panes, breach ring on the pane, drop announcement
  floating at the board bottom, clipped-trigger popover dismissal, open-column scroll position
  kept while open, folded column reopens at the top.

Revised acceptance criteria (replace 1-5, 8, 10, 12, 14 above):

- R1. Desktop pane mode at 1440x900 and 1280x800 with long fixtures: maximum page scroll <= 1px;
  the top bar, filter bar and every open `.col-head` stay at their initial positions after any
  wheel; the `.board` bottom equals `innerHeight` within 1px; pane bottoms equal the board content
  bottom.
- R2. Wheel over open column A changes only A's `scrollTop`; B and `window.scrollY` unchanged;
  moving to B scrolls only B; this works from the first gesture, with no page scroll first.
- R3. Rails are 340px tall in pane mode and fallback; fill ratios unchanged.
- R4. The compact header never appears on Board in pane mode; Catch Up still gets it.
- R5. At a short desktop viewport, at 760px width, and with touch emulation, the alert strip shows
  above the old page-scroll board with the right `reason`; the button sends exactly one
  `board_action` event with the contract above and then shows "Thanks, noted"; pane mode shows no
  alert.
- R6. Focus into a card never scrolls the page in pane mode.

## Outcome

Implemented with changes. Approved deviations from this spec, recorded in the execution ledger:

- The gate is re-evaluated from a `window` `resize` listener in addition to the existing layout
  pass and `ResizeObserver`, because the `documentElement` `ResizeObserver` stops firing once the
  page is taller than the viewport, so a shrinking window height would never re-evaluate the gate.
- The `wheelOver` test helper aims the pointer at the part of the target box that is actually inside
  the viewport, rather than its full-box center, so wheel tests exercise a visible point.
- An open column's `scrollTop` resets to 0 on reopen regardless of input (pointer or keyboard),
  because `.col-body` stays mounted through a fold/reopen cycle and a keyboard reopen would
  otherwise restore a stale offset. This is implemented as a reset in the main layout effect rather
  than only inside the pointer-only rail-reveal branch.
- The drop announcement (`.board-say`) floats at the bottom of the board rather than at a fixed
  offset, so it stays in view while the board is stuck; while loose it sits at the board bottom
  and the live region still announces.
- The focus re-stick skips pointer-initiated focus: a card button takes focus on mousedown, and
  moving the page before mouseup dropped the click. Keyboard and programmatic focus (Tab, panel
  focus return, drop-menu close) still stick the board.
- Onboarding preview popovers are exempted from the clipped-trigger dismissal added for card field
  popovers, so a preview does not close itself while its own tour step scrolls the page.
- Several existing tests that assumed the page-scroll/pinned-chrome model at viewports that now
  pass the pane-mode gate were moved to fallback viewports (`FALLBACK_VIEWPORT` 800x380, or 760x620
  for one width-gated case); their assertions are unchanged. See the execution plan's
  "Moved-to-fallback tests" list for the complete set.

## Current Accuracy

Accurate as of 2026-09-25; the implementation and tests are the source of truth.
