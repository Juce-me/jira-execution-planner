Status: planned
Type: feature

# ENG Board Independent Column Scroll Panes

## Intended Outcome

On desktop, every open ENG Board column is a bounded, bordered pane that scrolls independently.
Wheel or trackpad scrolling over a column moves only that column once the board is in sticky mode.
The first downward scroll moves the page until the column titles reach the sticky line under the
ENG filter bar (sticky mode on). Scrolling back up returns the column to its top first, then the
page, which releases sticky mode. Column content never paints outside its pane, so it cannot leak
over the filter bar, the top controls, or any other surface. Column titles are always visible.

## User-Confirmed Decisions (2026-09-24)

1. Replace the page-scroll plus JS-pinned column chrome design with per-column inner scroll panes
   on desktop. This supersedes the "no internal vertical card scroller" constraint of
   [2026-08-08-executed-sticky-board-column-chrome.md](2026-08-08-executed-sticky-board-column-chrome.md),
   [EXEC-sticky-board-column-chrome.md](../../plans/EXEC-sticky-board-column-chrome.md), and the
   "no second scroll container" constraint of
   [2026-08-08-executed-unfolded-board-column-scroll.md](2026-08-08-executed-unfolded-board-column-scroll.md)
   for pane mode only.
2. Sticky mode: page first, then column. Downward scroll moves the page until the board is stuck,
   then only the hovered column scrolls. Upward scroll at a column's top chains to the page and
   releases sticky mode.
3. Mask: each open column is its own bordered pane from its title row to the viewport bottom. Rails
   are unchanged.
4. Mobile and narrow or short viewports keep the existing behavior, including the JS-pinned chrome.
5. Column titles are always visible in every mode; cards scroll under the title.
6. In pane mode the ENG filter bar is the only sticky layer: the compact sticky header is
   suppressed for the Board while pane mode is active. The full top control bar scrolls away as
   normal content and returns when the user scrolls the page back up.

## Why The Compact Header Is Suppressed

`.compact-sticky-header` is `display: none` until `headerRef.bottom <= 0`
(`frontend/src/dashboard.jsx`, compact visibility effect), then enters normal flow and raises
`--epic-sticky-top`. Sizing panes for the stuck state that includes it ends the page before the
full header can scroll off, so the compact header never appears; sizing without it makes panes
overflow once it appears. The sizing is circular. With the filter bar as the only sticky layer,
`--epic-sticky-top` equals the always-rendered, already-measured filter bar height, and pane height
is deterministic.

Rejected alternatives: an on-demand focus/fullscreen control (drops decision 2; `Cmd+F` would also
hijack browser Find), and always rendering the compact header invisibly for measurement (changes a
shared component used by Catch Up, Planning, and EPM; MRT009 risk). An explicit focus control may
be added later on top of this design.

## Design

### Mode gate

`EngBoardView` sets `.board.is-pane-mode` when both hold, re-evaluated in the existing layout pass
(`applyBoardLayout`, resize and `ResizeObserver`):

- viewport width is greater than 760px (repo narrow/mobile convention);
- viewport height minus the pane-mode sticky top (the filter bar height) is at least the open
  column title height plus `--board-strip-h` (340px).

When the gate fails, the current behavior is untouched: page scroll, `syncBoardChrome`,
`.is-chrome-pinned`, `--board-chrome-*`, rail-click vertical reveal, and the compact header.

`EngBoardView` reports pane mode to the dashboard through a callback prop, following the
`onFilterBarHeightChange` pattern, so the compact-header visibility effect can stay hidden while
Board pane mode is active (`aria-hidden` stays truthful; hidden controls are not rendered).

### Pane geometry

In pane mode:

- Each open `.col` (`.is-open` or `.is-focused`) is a vertical flex container whose painted height
  runs from its top to the viewport bottom when stuck:
  `calc(100dvh - var(--epic-sticky-top) - <trailing space>)`. The trailing space is everything the
  document renders below the pane tops' bottom edge (the `.board` horizontal scrollbar, board and
  container bottom padding). The plan must make this exact, measuring it in the existing layout
  pass and publishing it as a custom property if it is not a static value.
- `.col-head` is `flex: none` at the top of the pane. No `position: fixed`, no pinning.
- `.col-body` is `flex: 1 1 auto; min-height: 0`, keeps its grid layout, and is the scroller:
  `overflow-y: hidden` when not stuck, `overflow-y: auto` when stuck, `scrollbar-width: thin`
  matching `.board`. `overscroll-behavior-y` stays `auto` so upward overscroll chains to the page.
- Nothing renders after the Board in Board mode, so at maximum page scroll the pane tops sit at
  `--epic-sticky-top` and pane bottoms sit at the viewport bottom.
- `syncBoardChrome` does not pin in pane mode; `.is-chrome-pinned` and `--board-chrome-*` are never
  applied.

### Sticky state

The existing geometry condition (board frame top at or above `--epic-sticky-top`, 1px sub-pixel
tolerance) toggles `.board.is-pane-stuck` from the existing rAF-coalesced scheduler
(`scheduleBoardChrome`). No new scroll listeners. MRT003 applies: rAF-throttled, cancelled on
unmount.

Browsers latch a scroll gesture to one scroller, so a trackpad may need a new swipe to hand off from
column to page at the column top. This native behavior is accepted, not overridden.

Column `scrollTop` is preserved across stuck and unstuck transitions.

### Mask

Each open column pane reuses the folded rail's border and radius (`border: 1px solid var(--border);
border-radius: 8px` from `.col-strip`) with `overflow: hidden` for clipping. The pane background is
unchanged (cards are not restyled). The title keeps its accent underline. Inner padding uses the
existing `.col-body` gap scale so card borders do not touch the pane border.

### Adjusted existing behavior

- Rail click in pane mode (pointer only, as today): focus the column, scroll the page to the stuck
  position, and set the newly opened column's `scrollTop` to 0, instead of revealing the first card
  by window scroll.
- Unchanged: focus, fold, star, drag/drop (including the portalled drop menu), horizontal board
  scroller and centering, off-frame hints, epic panel modal, onboarding spotlight capped to the
  rail height, column widths, 36px rails, 340px rail height.

## Forbidden Regressions

- No JS wheel interception or manual scroll routing.
- No change to the compact header, filter bar, Planning panel, or `.epic-header` behavior outside
  Board pane mode (MRT009; re-verify Catch Up, Planning, Scenario sticky stacks).
- No new z-index tier; no `position: fixed` in pane mode.
- No change to fallback-mode (narrow or short viewport) behavior or its existing tests.
- No restyling of cards, rails, the title row, or the status pills.
- No unscoped board selectors; every rule stays under `.eng-board` (`tests/test_eng_board_styles.js`).
- No analytics event.

## Files Allowed To Touch

- `frontend/src/eng/EngBoardView.jsx`
- `frontend/src/styles/eng/board.css`
- `frontend/src/dashboard.jsx` (pane-mode callback wiring and compact-header visibility condition only)
- `frontend/dist/*` (rebuilt with `npm run build`, never hand-edited)
- `tests/ui/eng_group_board_view.spec.js`, `tests/ui/eng_group_board_filters.spec.js`,
  `tests/ui/eng_sticky_stack_helpers.js` (if the helper needs a pane-mode snapshot),
  `tests/test_eng_board_styles.js`
- `docs/README_ANALYTICS.md` (reword the Board sticky chrome allowlist row)
- `docs/ontology.md` (ENG Board entry)
- `docs/features/eng-workflows.md` (Board section: scrolling behavior)
- The two 2026-08-08 Board scroll artifacts and `docs/plans/EXEC-sticky-board-column-chrome.md`
  (Current Accuracy notes)
- `docs/plans/EXEC-board-column-scroll-panes.md` and `docs/plans/README.md`

## Acceptance Criteria

Desktop pane mode (for example 1440x900 and 1280x800, long fixtures with more than 30 epics in at
least two open columns):

1. Before stuck, a wheel over an open column changes `window.scrollY` and no column `scrollTop`.
2. At maximum page scroll the board is stuck: every open `.col-head` top equals `--epic-sticky-top`
   (within 1px) and every open pane's painted bottom equals `window.innerHeight` (within 1px).
3. When stuck, a wheel over column A changes only A's `.col-body.scrollTop`; column B's
   `scrollTop` and `window.scrollY` are unchanged. Moving the pointer to B and scrolling changes
   only B.
4. Scrolling A back to `scrollTop` 0 and continuing upward (new gesture) decreases `window.scrollY`
   and removes `.is-pane-stuck`.
5. Column titles stay visible (hit-testable) at every scroll position.
6. Hit-testing points inside the filter bar and just outside every pane edge never resolves to a
   card; no card's visible box extends beyond its pane.
7. The compact sticky header is not visible in Board pane mode at any scroll position, and the
   full top bar is reachable by scrolling the page up.
8. Rail click in pane mode leaves the board stuck with the opened column at `scrollTop` 0.
9. Drag/drop between open columns and the drop menu still work while stuck.

Fallback mode:

10. At 420px width and at a desktop width with a short viewport that fails the height gate, the
    existing pinning, release, rail-reveal, and compact-header tests pass unchanged.

Global:

11. Catch Up, Planning, and Scenario sticky stacks are unchanged (`collectStickySnapshots`).
12. Wide and narrow screenshots of stuck and unstuck pane mode, inspected against each criterion,
    with animations settled.
13. Full Python suite, `npm run build`, and the board Playwright specs pass.

## Documentation Impact

- `docs/features/eng-workflows.md`: describe pane mode, sticky mode, and fallback.
- `docs/ontology.md`: ENG Board entry gains the pane-mode layout concept and its tests.
- `docs/README_ANALYTICS.md` "ENG Group Board sticky column chrome" row: reword the allowlist row (passive layout, no scroll collection).
- Mark the superseded 2026-08-08 artifacts and `EXEC-sticky-board-column-chrome.md` with a Current
  Accuracy note limiting them to fallback mode.
