Status: executed
Type: feature

# Sticky Group Board Column Chrome And Filter Bar Spacing

## Intended Outcome

While the user scrolls vertically through a long ENG Group Board, every collapsed column rail and
the header of every open column remain visible. The pinned board chrome starts immediately below
the existing compact header, Planning panel, and ENG filter bar, and stops at the bottom of the
board. In Catch Up and Board, the shared filter-bar wrapper places its existing spacer below the
controls instead of above them, keeping the controls close to the preceding surface while restoring
the missing lower breathing room.

## Design

Keep the existing single column tree and promote each column's existing chrome into a fixed visual
layer only while the board crosses the sticky line. The `EngBoardView` module keeps its current
interface: one semantic `.col` per workflow column containing its own `.col-head`, `.col-strip`,
`.col-body`, drag target, and existing handlers.

Plain `position: sticky` is not viable here. The board must retain `overflow-x: auto`, and Chromium
binds descendant sticky positioning to that horizontal scroll container instead of the page's
vertical scroll. Splitting the chrome and card bodies into parallel rows is also rejected because it
would replace the existing single-column interface with two synchronized column trees, spreading
drag/drop, focus, accessibility, and test changes across the feature.

The selected implementation stays private to `EngBoardView`:

- On page scroll, board scroll, layout, and resize, schedule one animation-frame geometry pass.
- Read the board rectangle and the live dashboard offset from `--epic-sticky-top`.
- When the board's top crosses that offset and its bottom remains below it, prepare one pinned-state
  class for the existing `.board`.
- Before activating that class, measure each `.col` and its currently visible chrome, then publish
  viewport `left` and `width` as inline custom properties. CSS promotes only the visible `.col-head`
  or `.col-strip` to `position: fixed` using those already-populated values, preventing an
  activation-frame flash at an unset position.
- Publish a placeholder height equal to the promoted element's occupied layout height. A column
  pseudo-element uses that height while pinned, so removing the chrome from normal flow does not
  move cards, alter board height, or create a threshold jump.
- Disable transitions on promoted chrome. Folded rails are buttons covered by the global
  `button { transition: all 0.3s; }`; without this pinned-state override, Chromium animates the rail
  from its old `width: 100%` resolved against the viewport to the measured 36px width, producing a
  one-frame board-wide rail despite the correct custom property.
- Publish an independent vertical translation for each promoted element:
  `min(0, boardBottom - stickyTop - chromeHeight)`. This keeps all chrome on the common sticky line
  through the main scroll range, then releases a 340px rail and a shorter open header at their own
  correct board-bottom boundary.
- Recalculate horizontal positions from the existing `.col` rectangles whenever the board scrolls
  or recentres. The original horizontal scroller remains the only scroll owner.
- Use `--epic-sticky-top` directly, so the chrome begins below the compact header, optional Planning
  panel, and ENG filter bar. Keep the chrome below those controls and their overlays in the z-index
  stack, and give open headers an opaque board background so cards cannot show through.

There is no portal, cloned row, duplicate control, additional application state, or new public seam.
Scroll work is coalesced with `requestAnimationFrame`, and cleanup removes listeners, observers,
pending frames, the pinned class, and inline geometry properties when Board unmounts.

The shared `.filterbar-wrap` previously had `padding-top: 0.85rem` and no bottom padding. It now
uses `padding-block: 0 0.85rem`, moving the same spacer below the controls while preserving the
wrapper's rendered height reported by `EngFilterBar` and included by the dashboard in
`--epic-sticky-top`.

## Interaction And State

- Clicking a pinned collapsed rail focuses that column exactly as it does before scrolling.
- Clicking a pinned focused header folds it through the existing handler.
- The pinned star remains keyboard accessible and toggles the existing session state.
- A starred header remains inert except for its star, preserving the existing behavior.
- Horizontal scrolling or focus-centering repositions the promoted chrome from the same existing
  column rectangles, without a second scroll position or visible drift.
- The sticky chrome has no independent persistence, API request, or application state.

## Failure And Boundary Behavior

- Before the board reaches the sticky offset, the chrome remains in its normal board position.
- At the board's lower boundary, each header or rail scrolls away exactly when its own bottom meets
  the board bottom.
- On narrow viewports, the existing fixed column widths, 36px rails, centering, off-frame hints,
  and document-overflow guarantees remain unchanged.
- The compact header, Planning panel, filter bar, dropdowns, and popovers always paint above the
  board chrome and remain clickable.
- A one-column or first-run board keeps its current star/Fold withdrawal behavior.

## Files In Scope

- `frontend/src/eng/EngBoardView.jsx`
- `frontend/src/styles/eng/board.css`
- `frontend/src/styles/eng/filter-bar.css`
- `tests/ui/eng_group_board_view.spec.js`
- `tests/ui/eng_compact_layout_visual.spec.js`
- `tests/ui/eng_group_board_filters.spec.js`
- `tests/test_eng_board_styles.js` for the JS-written custom-property contract
- `docs/README_ANALYTICS.md` for the no-event allowlist row
- Generated `frontend/dist/` output produced by `npm run build`

No backend, Jira, Home/Townsquare, configuration, or persistence files are in scope.

## Acceptance Criteria

- After vertical scrolling, every collapsed `.col-strip` remains visible with its top aligned to
  the calculated board sticky offset.
- Every open `.col-head` remains visible at the same top line.
- Pinned chrome does not overlap the compact header, Planning panel, or ENG filter bar.
- Pinned chrome releases at the board's bottom rather than covering later page content.
- Horizontal scrolling and focus-centering keep each promoted chrome item aligned with its original
  `.col` to within one pixel.
- Pin activation changes neither the board height nor the first card's document position by more
  than one pixel.
- The first animation frame after pin activation has no width transition and every promoted rail
  already matches its owning column width.
- Fold, focus, star, keyboard, and drag-and-drop behavior remain unchanged.
- Wide and narrow viewport screenshots show the pinned headers and rails without clipping,
  document overflow, or content bleed-through.
- In Catch Up and Board, the filter bar has at most 1px of top inset and retains the existing
  0.85rem spacer below it, while the outer wrapper height and downstream sticky offset remain
  unchanged.

## Verification

1. Add a Playwright regression that scrolls a long fixture and fails before the implementation
   because the active header and collapsed rails leave the viewport.
2. Assert element-level geometry for every open header and every collapsed rail after vertical
   scroll, including their relation to the live sticky offset and existing sticky controls.
3. Assert board height and the first card's document position remain stable across pin activation.
4. Assert horizontal alignment before and after horizontal scrolling/focus-centering.
5. Assert each header and rail releases at its own board-bottom boundary and does not cover
   subsequent content.
6. Re-run the existing compact-header layering, board geometry, focus/fold/star, and drag/drop
   coverage.
7. Add element-level Catch Up and Board assertions for the filter bar's top/bottom insets and outer
   height, then inspect both user-provided layout states after the spacer transfer.
8. Capture settled wide and narrow screenshots and inspect the actual rendered chrome.
9. Run `npm run build`, relevant source guards, focused Playwright coverage, and the full test suite
   before any push.

## Design Validation

A standalone Chromium prototype exercised the selected geometry before this document was revised:

- A naive sticky child inside `overflow-x: auto` moved to `-150px` instead of sticking, confirming
  that CSS-only descendant stickiness is invalid for the production board structure.
- Promoting the existing chrome preserved a `1570px` board height and the first card's `242px`
  document position before and after activation.
- All tested headers and rails landed at the `60px` prototype sticky offset with `0px` alignment
  error against their source columns.
- After the horizontal scroller moved to its maximum `148px`, every promoted element still had
  `0px` alignment error and the promoted header accepted its click.
- Near the board boundary, the 340px rail and 34px header independently translated until both
  bottoms equalled the board bottom at `80px`; neither persisted over following content.

These values validate the algorithm rather than prescribe production dimensions. Production tests
must read the live sticky offset and rendered element sizes instead of copying prototype constants.

## Analytics Impact

No new analytics event is emitted. Sticky positioning and shared filter-bar spacing are passive
presentation changes with no new user action or application state. Board focus, fold, and star
interactions remain intentionally untracked under the existing Board allowlist. Add both reasons
to the analytics no-event allowlist.

## Forbidden Regressions

- Do not replace normal page scrolling with an internal vertical card scroller.
- Do not pin the whole card column or cover existing sticky controls.
- Do not split the board into synchronized chrome/body column trees, create a portal, or duplicate
  interactive or accessibility-visible column chrome.
- Do not change column widths, rail height, focus transfer, star persistence, or fold semantics.
- Do not hand-edit `frontend/dist/`.
- Do not disturb unrelated staged or unstaged work already present in the checkout.

## Outcome

Implemented with changes. The existing Group Board column chrome is promoted only during the
live sticky range, releases independently at the board bottom, and the shared filter-bar spacer
now appears below the controls. Generated frontend output was rebuilt. The source guard passed
all 6 tests; the combined Board Playwright run passed 82 of 83 tests, and the Catch Up visual run
passed 23 of 24 tests. The remaining failures are recorded below and were not changed by this
feature. A scoped in-memory Python diagnostic completed 1,216 tests with 4 failures and 1 skip;
that run establishes suite breadth only and is not a passing full-suite result.

## Current Accuracy

Partially accurate: the implementation matches the stated behavior and the focused Board/filter
regressions pass, but the full verification matrix is not clean. The pre-existing Board drag
warning test still fails. The Planning sticky-stack failure is a stale fixture that enables
Planning while expecting the Catch-Up-only alert toolbar. The canonical Python run stalls because
synthetic `db:5432` leaks into migration validation; the scoped diagnostic bypassed that validation
and completed with four failures, three from configured PostgreSQL leaking into excluded-capacity
API tests and one caused by the diagnostic patch itself. The plan remains the active `EXEC-*`
record pending acceptance or merge.
