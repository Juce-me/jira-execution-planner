Status: executed
Type: feature

# Group Board Help, Fixed Card Titles, And ADF Tables

## Intended Outcome

The configured ENG Group Board starts directly below its filter bar instead of reserving a wide,
uppercase instruction panel. Guidance remains available from a compact information control in the
existing filter bar. Epic cards keep a consistent height when summaries are long. Jira description
tables retain their row-and-column structure and scroll horizontally inside the selected table
only.

## Approved Interaction Design

### Board help

- Remove the configured-board `Epics by column` title and static instruction copy from the normal
  Board layout.
- Keep the actionable first-run state for an unconfigured board, including its Configure action.
- Use `EngFilterBar`'s existing `viewControls` slot to place one 30px information button beside the
  Board readout. Do not add another toolbar row.
- The button's accessible name is `How Group Board works`; its visual label is `ⓘ`.
- The help is closed by default on every visit. It has no local-storage, server, session, or
  first-view persistence.
- The anchored popover is at most 32rem wide and never wider than the viewport minus its gutters.
  Its copy uses normal sentence case, normal body sizing, and short bullets rather than the current
  full-width uppercase paragraph.
- The popover explains column focus, session stars, priority order, bar scale, drag-to-move, and
  where shared defaults and Min/Max limits are configured.
- Pressing the trigger again, pressing Escape, or clicking outside closes the popover. Escape
  returns focus to the information button; outside-click dismissal leaves focus with the control
  the user chose instead of stealing it back.

### Dynamic Board feedback

- Keep the existing drag/drop live region and its accessible announcement behavior.
- Move it out of the removed configured-board instruction block.
- When empty, it reserves no visual height. When it contains an outcome, it appears as compact
  temporary feedback above the columns and remains `role="status"` with `aria-live="polite"`.

### Epic summaries

- Every epic summary stays on one line in the card.
- The summary owns only the remaining width between the fixed leading indicators/status and the
  fixed issue-key lane.
- When the summary exceeds that width, it uses an ellipsis. It never wraps, expands the card, pushes
  the issue key away, or creates horizontal overflow.
- The full key and summary remain in the card's accessible name, and opening the detail panel shows
  the complete summary. No additional tooltip or title-specific state is introduced.

### Jira description tables

- Extend the existing server-side safe ADF renderer; do not add client-side ADF parsing and never
  inject Jira-provided raw HTML.
- Render valid ADF `heading` nodes as their escaped semantic `h1`–`h6` level. An invalid or missing
  heading level degrades to a paragraph.
- Description headings use a compact but readable normal-case hierarchy. Activating semantic
  heading markup must not inherit the currently dormant uppercase micro-label treatment.
- Support `table`, `tableRow`, `tableHeader`, and `tableCell` using static, allowlisted markup.
  Jira table attributes such as widths, background colours, spans, and inline styles are ignored.
- A table with at least one rendered row becomes:

  ```html
  <div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">
    <table><tbody>…safe rows and cells…</tbody></table>
  </div>
  ```

- `tableHeader` renders as `<th scope="col">`; `tableCell` renders as `<td>`. Cell content is
  recursively rendered through the same escaping, mark, and link policy as the rest of the
  description. Empty cells remain as empty cells so column positions do not collapse.
- Each `.adf-table-scroll` independently owns `overflow-x: auto` and inline overscroll containment.
  The epic panel, description body, modal backdrop, and document never become horizontal
  scrollers.
- Tables use collapsed borders, a subtle header surface, compact cell padding, normal-case text,
  wrapped cell content, and a practical minimum width. A table narrower than the available panel
  width uses the available width; a wider table scrolls only within its own wrapper.

## Architecture And Data Flow

### `EngBoardHelp`

Create a private `frontend/src/eng/EngBoardHelp.jsx` component. It receives the rendered Board
scale and owns only ephemeral open/closed state, trigger/popover refs, outside-click dismissal,
Escape handling, responsive popover placement, and focus return. It performs no fetch, persistence,
analytics call, or Board state mutation.

`EngBoardView` passes the component through `EngFilterBar.viewControls`. The shared filter bar
already defines this consumer-owned slot, so `EngFilterBar` itself needs no new public prop or
Board-specific branch. Board-specific styling and the wrapper z-index lift remain scoped in
`styles/eng/board.css`.

### Board body

`EngBoardView` renders `.board-head` only for `firstRun`. A configured board proceeds from the
filter-bar wrapper directly into `.eng-board` and `.board-scroll`; the filter bar's existing bottom
padding is the only normal vertical spacer. `.board-say` remains mounted for live-region stability
but changes between a visually hidden empty state and compact visible feedback when an announcement
exists.

### Epic card

`EngBoardEpicCard` keeps its current semantic button and three-row structure. CSS makes `.etitle`
the explicit flexible lane (`flex: 1 1 0`) with `min-width: 0`, `white-space: nowrap`, hidden
overflow, and ellipsis. Indicators, status, and `.ekey` remain non-shrinking. No card-height value
or JavaScript measurement is introduced.

### ADF renderer

`GET /api/issues/description` and `EngBoardEpicPanel` remain unchanged at their trust boundary:
the route fetches one Jira ADF description, `backend/epm/home.py` converts it to safe HTML, and the
panel injects only that server-produced HTML. `_render_adf_html_nodes` gains explicit heading and
table branches. Unknown nodes keep the existing recursive content fallback.

## Content

The compact popover uses this meaning, with line breaks or bullets chosen for readability:

- Choose a folded column to centre it.
- Star a column to keep it open for this session.
- Cards are ordered highest priority first.
- The tallest bar represents the current largest epic count (`scaleMax`).
- Drag a card to another column to change its epic status.
- Shared columns, the default star, and Min/Max limits live in Group Board settings.

Do not repeat the `Epics by column` heading inside the Board body.

## Failure And Boundary Behavior

- An unconfigured board still explains why all epics are in one column and offers configuration.
- If the help popover cannot fit at its preferred side, it clamps inside the viewport without
  changing filter-bar height or document width.
- Closing help never changes filters, column focus, star state, or keyboard focus outside the
  trigger.
- A long unbroken summary ellipsizes instead of widening or increasing the card.
- Empty or malformed ADF tables render no unsafe attributes and never crash the route. Supported
  descendant text remains escaped.
- Unsafe links inside table cells continue to be rejected by `_safe_adf_href`; safe links retain
  the existing escaped new-tab contract.
- Existing description loading, empty, error, retry, session cache, clamp, expansion, and Smart
  Link behavior remain unchanged.
- Existing sticky filter/header/column geometry, horizontal Board scrolling, drag/drop, and focus
  behavior remain unchanged.

## Files In Scope

- Create: `frontend/src/eng/EngBoardHelp.jsx`
- Modify: `frontend/src/eng/EngBoardView.jsx`
- Modify: `frontend/src/eng/EngBoardEpicCard.jsx`
- Modify: `frontend/src/styles/eng/board.css`
- Modify: `backend/epm/home.py`
- Modify: `tests/test_oauth_eng_routes.py`
- Modify: `tests/ui/eng_group_board_view.spec.js`
- Modify: `tests/ui/eng_group_board_card.spec.js`
- Modify: `tests/ui/eng_group_board_panel.spec.js`
- Modify: `tests/ui/eng_group_board_drag.spec.js` (Task 1 scale contract assertion only)
- Modify: `tests/ui/eng_group_board_filters.spec.js` (Task 1 help/sticky geometry assertions only)
- Modify: `docs/plans/EXEC-eng-group-board.md`
- Modify: `docs/README_ANALYTICS.md`
- Regenerate from source: `frontend/dist/dashboard.css`, `frontend/dist/dashboard.js`,
  `frontend/dist/dashboard.js.map`
- Update this work artifact and the implementation plan created after approval.

No API route, request shape, Jira field selection, persisted preference, settings payload, Group
Board configuration schema, or database model changes.

## Acceptance Criteria

1. A configured Board has no visible `.board-head-title` or static `.board-head-sub`, and no empty
   announcement block reserves height.
2. The Board columns begin immediately after the filter bar's existing bottom spacer; removing the
   wallpaper introduces no replacement row or extra top margin.
3. The information button lives inside the existing Board filter bar, is closed by default, and
   exposes correct `aria-expanded`/dialog semantics.
4. Help opens to a compact normal-case popover, remains within viewport bounds, and closes through
   its trigger, Escape, and outside click. Escape returns focus to the trigger; outside click does
   not override the clicked control's focus.
5. The first-run Board message and Configure action remain visible and functional.
6. A deliberately long summary has `scrollWidth > clientWidth`, computed one-line ellipsis styles,
   no overlap with the key, and a card height within one pixel of a short-summary card.
7. A valid ADF heading renders the matching semantic heading tag with escaped, normal-case,
   readable content.
8. A valid simple ADF table renders one semantic table with the expected header and body cells;
   unsafe attributes and links do not enter the response HTML.
9. At a narrow viewport, the selected table wrapper has horizontal overflow and can change its own
   `scrollLeft`; the panel, modal, and document have no horizontal overflow beyond one pixel.
10. Multiple tables own independent horizontal positions; scrolling one does not move another.
11. Description clamp/expand, safe ordinary and Smart Links, loading/error/retry/cache, sticky
    Board chrome, drag/drop, and filter-bar height regressions remain green.

## Verification Design

Keep browser coverage focused on behavior only the browser can prove:

- Extend the existing Board view/card Playwright files with one help/gap regression and one
  long-summary geometry regression. Do not create screenshot-only duplicates.
- Extend the existing Board panel Playwright file with one table semantics/overflow regression at
  desktop and narrow widths. Assert actual `scrollLeft` movement and outer-overflow bounds.
- Add backend route/unit coverage for headings, semantic table markup, escaping, unsafe link/attr
  rejection, empty cells, malformed table content, and existing Smart Link compatibility.
- Capture settled configured Board, help-open, long-summary, and narrow-table screenshots for
  visual inspection, while keeping element-level assertions as the regression gates.
- Re-run focused Board view, card, panel, drag, filter, sticky-stack, ADF route/security, build, and
  source-guard coverage. Run the repository's full Python suite and report any pre-existing or
  environment-dependent failures accurately.

## Analytics Impact

No new analytics event. The help disclosure is ephemeral and changes no application or shared
state; existing Board focus/fold/star and filter controls are already intentionally untracked.
Title truncation and semantic table rendering are passive presentation changes. Continue to track
only `eng_issue_description` API reliability and existing issue mutations, never help copy,
description text, cell content, URLs, summaries, or issue keys. Record this decision in the
analytics no-event allowlist.

## Approaches Considered

1. **Selected — information control in the existing filter bar.** Removes the wallpaper and all
   replacement vertical chrome while keeping help available where the Board is used.
2. **Separate Board help toolbar.** Rejected because it recreates a persistent vertical row after
   the user asked to remove the gap.
3. **Help only in Group Board settings.** Rejected because the mechanics would be difficult to find
   during Board use.
4. **Auto-open once and persist dismissal.** Rejected because the approved behavior is closed by
   default and does not justify another preference or migration.
5. **Reflow description tables into cards.** Rejected because it destroys column comparison and
   contradicts the approved table-local horizontal scrolling behavior.

## Forbidden Regressions

- Do not replace the wallpaper with another persistent help row, onboarding card, or first-view
  popup.
- Do not add help persistence, a preference key, analytics payload, API request, or settings field.
- Do not remove or hide the actionable unconfigured-board state.
- Do not wrap long epic summaries, vary card height, hide the issue key, or widen the card.
- Do not render raw Jira HTML, broaden allowed URL schemes, trust Jira table attributes, or add a
  client-side ADF parser.
- Do not make the panel, modal, Board, or document horizontally scroll because of a description
  table.
- Do not hand-edit `frontend/dist`; rebuild it.
- Do not weaken existing sticky, focus, drag/drop, description-security, or accessibility tests.

## Outcome

Implemented with changes. The configured Board help, fixed-height summary lane,
semantic ADF heading/table renderer, table-local overflow, canonical ADF policy, analytics
no-event allowlist, and generated frontend assets are implemented. The focused behavior tests
introduced by this work pass, both builds completed, and the full Python suite ran 1,219 tests:
1,218 passed and 1 skipped.

The first five-spec Board Playwright run passed 100 of 107 tests and supplied the RED evidence for
five stale assertions invalidated by the approved help contract. Those tests now read the dynamic
scale from on-demand help, create a synthetic sticky witness without restoring production chrome,
and assert the measured 3+1 desktop / two-row 375px help-control layout. Their focused rerun passed
5/5. Finalization traced the remaining done-category drag failure to a stale mocked endpoint and
updated that fixture to the transition status catalog used by production. No product drag or
transition behavior changed.

## Current Accuracy

Accurate for the implemented feature boundaries, files, acceptance criteria, analytics decision,
and security constraints. Node style/source guards passed 55/55, issue-description route tests
passed 12/12, the contract-correction checks passed 5/5, the compact sticky check passed 1/1, the
full frontend unit suite passed 903/903, and the final six-spec Board/EPM matrix passed 113/113.
The full Python suite ran 1,219 tests with 1,218 passed and 1 skipped. The implementation plan
remains `EXEC-*` pending requester acceptance or merge.
