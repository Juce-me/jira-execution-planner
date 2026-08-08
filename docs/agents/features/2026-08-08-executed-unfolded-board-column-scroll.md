Status: executed
Type: feature

# ENG Group Board Unfold Scroll Alignment

## Intended Outcome

When a user clicks a folded ENG Group Board column rail, the column opens and the page scrolls
upward until the first epic card in that newly opened column sits immediately below the live sticky
column header. Its first card aligns vertically with the first card in any column that was already
open, so the user starts reading both columns from the same point.

## Design

Keep the existing Board focus and horizontal-centering path. A folded-rail click records that the
target column needs a one-time vertical reveal, then calls the existing `focusColumn` behavior.
After React commits the newly focused column, a layout effect resolves that column from the existing
`boardRef`, finds its first `.ecard`, and scrolls the page using rendered geometry:

- Read the live sticky-stack top from the board's existing `--epic-sticky-top` property.
- Read the newly opened header's rendered bottom spacing rather than introducing a fixed offset.
- Compute the page position that places the first card immediately below that header.
- Animate the vertical move for normal motion preferences and complete it immediately when the
  user requests reduced motion.
- Preserve the existing smooth horizontal centering and do not change the board's horizontal
  scroll position as part of the vertical reveal.

The pending reveal is consumed once. It applies only when the user clicks a folded `.col-strip`.
Normal mount/restoration, off-frame hint navigation, header folding, star changes, and other focus
updates retain their current vertical behavior.

`scrollIntoView` plus a CSS `scroll-margin` is not used because the sticky stack is runtime-sized
and `scrollIntoView` may also alter the board's horizontal scroll. Scrolling before the focus change
is also rejected because the target card is not rendered until the column opens.

## Boundary Behavior

- If the opened column has no epic cards, keep the current page scroll position.
- If the pending column no longer exists after the render, discard the reveal request.
- Use the live sticky offset, so compact-header, Planning, and filter-bar height changes remain
  authoritative.
- Do not add a second scroll container, duplicate Board chrome, or change focus/star persistence.

## Files In Scope

- `frontend/src/eng/EngBoardView.jsx`
- `tests/ui/eng_group_board_view.spec.js`
- Generated `frontend/dist/` output from `npm run build`
- This design artifact and the implementation plan required by the active project workflow

No backend, API, Jira, Home/Townsquare, configuration, CSS, or persistence changes are in scope.

## Acceptance Criteria

- Clicking a folded column rail opens and horizontally centres that column as before.
- On a vertically scrolled long board, the click scrolls the page upward until the new column's
  first epic card begins immediately below its live sticky header.
- The new column's first card and the first card in an already-open column have matching viewport
  tops within one pixel.
- The card is not obscured by the compact header, Planning panel, filter bar, or Board header.
- Empty folded columns do not change the page's vertical scroll position.
- Header fold, star, off-frame hint, keyboard, drag/drop, and horizontal Board behavior do not
  acquire this vertical scroll side effect.

## Verification

1. Add a Playwright regression using a long Board fixture and a folded column with epic cards.
2. Scroll far enough to activate pinned Board chrome, click the folded rail, and first observe the
   test fail because the page remains at its old vertical position.
3. After implementation, assert that `window.scrollY` decreases, the first newly visible card is
   immediately below its header, and first-card viewport tops across open columns match within one
   pixel.
4. Add an empty-column assertion proving the vertical position remains unchanged.
5. Capture and inspect a settled screenshot of the aligned open columns.
6. Run the focused Board Playwright coverage and `npm run build`; inspect the generated diff rather
   than editing `frontend/dist/` directly.

## Analytics Impact

No analytics event is added. The scroll is navigation assistance attached to the existing Board
column-focus action and does not introduce a new user intent or application state. The existing
analytics allowlist for ENG Board column focus/fold/star remains applicable.

## Outcome

Implemented as planned. Pointer clicks on folded column rails now consume a one-time, live-geometry
vertical reveal after the column opens, while existing horizontal centring and non-rail focus paths
retain their behavior. The implementation includes long-board, empty-column, keyboard, star, fold,
off-frame hint, and accepted drag/drop regression coverage.

## Current Accuracy

Accurate. The implementation uses the files and behavior described above. Normal-motion smooth
scrolling is explicit in production; the deterministic geometry regression runs with reduced motion
and does not directly time the smooth animation branch.

## Forbidden Regressions

- Do not hard-code sticky heights or card/header offsets.
- Do not change column widths, folded-rail geometry, sticky layering, or focus-transfer rules.
- Do not let programmatic vertical reveal disturb horizontal centring.
- Do not hand-edit generated frontend output.
- Do not modify unrelated user work.
