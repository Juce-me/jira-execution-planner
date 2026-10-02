# Planning Sprint review

Planning defaults to Table when no valid layout preference is saved. An explicit
List choice remains remembered. The icon beside Open selected stories in Jira switches
between List and a compact spreadsheet, including when no Stories are selected.
The layout is a private browser presentation preference. The shared header,
Sprint/Teams controls and filters retain their list width. Every Table scope,
including multiple Teams, starts with the sticky Planning overview reduced to
one desktop row of capacity and Product/Tech graph bars. Graph labels stay readable when either fill is hovered. Collapse panel returns
expanded details to that same graph row. Show panel restores selection
actions and per-Team capacity details without changing selection or fetching
new datasets. List retains the full Planning overview. On narrow screens, the
graphs stack to keep their values readable. Capacity errors remain visible in
the compact row. Only the spreadsheet region widens; extra columns scroll inside it.
Summary titles and Teams in scope use bounded single lines with ellipsis in both
read-only and editable profiles. Hover or keyboard focus reveals full text using
the shared in-app readout above table/sticky layers. Clicking an editable title opens a wrapping editor inside its
cell; Enter or leaving the cell saves through Jira, and Escape cancels. Validation
and recovery remain inline, without a Summary popup or large Save/Cancel controls.
Status cells reuse the shared status chips in both read-only and editable profiles.
Column creation aligns its compact input, type selector and actions on one baseline.
Table headings and drag handles have no inherited button margins; custom inputs
use compact 100px columns. Longer headings or values can widen a column rather
than clipping; Summary and Teams in scope remain bounded with full-text readouts.
Each heading shares one edge with its values and totals: the left edge for text
columns, the right edge for numeric ones. Every movable column has a 34px lane on the
right, in the cell's padding outside the content box that headings and values share,
so it never pushes a heading away from the values below it. The lane holds the drag
grip and a chevron that opens the column menu; both show while the pointer is over
the header cell or focus is inside it (and always on touch devices, where the lane is
48px), and a faint divider after each movable heading shows which cell they belong
to. The select column has no visible title (Select stays
as its accessible name) and the totals row is marked with a Σ (accessible name Total),
so every visible heading shares one typography. A custom input fills the content box, so its box never
extends past the heading or under the grip (its text keeps the field's own padding); the
Capacity chip has no extra left margin. A Playwright audit checks this for every
column in both modes, including that no input pokes past its heading span.
In Table view, Filters precedes the capacity graphs in a shared sticky stack below
the compact header. The first document scroll brings that stack into its sticky
position. The shared `EngFilterControls` module occupies the second dashboard controls row,
before Catch Up alerts and Planning capacity content; List also uses Filters-first
ordering.
Numeric headings, cells, editors and totals align right; text aligns left.
A real Epic or Story row with 0 SP (a missing Jira value counts as 0) is tinted red
across the whole row, with the same `#fff1f0` the alerts and board use. Awaiting-creation
placeholders and the No Epic group row are never tinted.
Rows scroll with the page; column headings dock below the shared controls and totals remain visible at the viewport bottom until their natural row enters view.
Stories expose the parent Epic summary in the Epic column, linked to that Epic in Jira (falling back to the key when its summary is missing). Assignee is a visible
column, without a Fields menu. Component, Project, Capacity and Project Track are optional and
hidden by default; use Columns to show or hide them. Saved visibility choices
take precedence over defaults, including an explicitly saved all-visible layout. Story Points have a visible
in-cell input with Enter to save and Escape to cancel in the signed-in Jira editor;
Epic Sprint SP remains a computed total. Story Capacity and Project Track
reflect the parent Epic; capacity changes use the existing shared Department setting.
Capacity chips retain a pale green Included or light gray Excluded background
on hover and keyboard focus, with a visible focus outline.

Epics show scoped child Story Points and contributing Teams. Story mode includes
orphans and awaiting-creation placeholders, one per uncovered Team. Readiness-only
Epics remain in the Epic table, marked with a "N Story awaited" chip beside the title
(not a second line), so the row keeps its normal height even for a long, truncated title. Each
placeholder shows its Team and links its parent Epic; it has no Jira key or
Story Points and cannot be selected or edited. Table placeholders remain visible
through Story status/priority filters, while Department, Team, project, Project
Track and search scope still apply. List filtering retains its existing behavior. Selection reuses Planning
Story selection and Undo; Epic checkboxes affect visible real child Stories.
Synthetic rows cannot edit Jira or store custom values. Team and Project columns
appear for multiple admitted Teams/projects. List sort/group controls keep their
stored choices and do not change table ordering.

The single-row toolbar contains Epics/Stories, + Column and Columns, with matching
heights and typography. Use + Column to create a Number or Text column and Columns
to show or hide columns and manage review columns. Discard and Save appear at the
right end only while the review has local changes (Discard asks for an inline
confirmation); a muted Loading… note shows there while the review loads. There is
no options menu or usage help: the app-header Refresh also reloads the shared
review (drafts are preserved; it leaves a review that is already loading or
saving alone), and a third click on a sorted heading clears the sort. Both popups are 300px, anchored above the table without shifting the page
layout. Opening one focuses the panel (+ Column focuses its name field); Escape or
an outside click dismisses it; the popups stay within the viewport.
+ Column has a name field, the shared Number | Text segmented control and Add
column; Enter adds, Escape cancels. Columns uses the Filters popover grammar: its
subject names the active row mode (Columns · Epics or Stories); Jira fields lists
the optional Jira columns as one-line toggles; Review columns · shared lists custom
columns as the same toggle plus a Σ total toggle (numbers only), an inline rename
(Enter or leaving the field saves, Escape cancels and keeps the popup open) and an
archive action behind an inline confirmation. Archived columns stay listed, muted,
and cannot be restored from the UI.
The chevron opens a column menu anchored to the header cell (also from the docked
header; an open menu closes when the header docks or undocks). Move left and Move right
step the column past its nearest visible neighbour like dragging does and stay open;
optional Jira columns and review columns also offer Hide column, which closes the
menu; a muted line explains that Shift-click on a heading sorts by several columns.
Drag column handles to place Jira and custom columns in any order after the pinned
Key and Summary columns. Arrow keys on a focused handle move it past the nearest
visible neighbour, stepping over hidden columns; the headers are the only place to
reorder. Columns controls optional visibility.
Order and visibility are shared per workspace + Sprint, separately for Epics and
Stories, and remain drafts until Save review. Reload/Refresh loads the saved view;
concurrent layout saves use the same schema revision conflict protection. Save
accepts layout changes only when its response confirms their exact order and
visibility; missing or mismatched confirmation preserves the draft and requires
explicit refresh/reapply recovery.
Schema and values are shared within workspace + Sprint, independent of Department
and Team filters. Epic and Story cells are separate and use immutable Jira IDs.
Numbers allow at most one decimal place (up to 999999999.9) and show without trailing
zeros (12, 12.5); totals stay exact across visible rows, and values stored earlier with
more decimals still read and total exactly;
blank values are distinct from zero. Heading clicks cycle ascending, descending
and off; Shift-click adds up to five ordered sort criteria, and the position number
shows only with two or more criteria. Custom changes remain local until Save review.

Dirty drafts survive filter, Department, mode and layout changes. Sprint changes
require Save, Discard or Stay. Browser exit uses the browser's unsaved-change
prompt. Refresh, including the app-header Refresh, preserves drafts; conflicts offer deliberate Load current or
Reapply. Unconfirmed writes are never automatically replayed.

Shared saving requires database-backed OAuth. Other profiles retain the Jira
spreadsheet with capability guidance. Review routes derive identity from the
request context and authorize every real issue through current-user Jira search.
They require the normal requested-with and CSRF protections, including values
reads. All API 401 responses use the terminal global authentication recovery.

API: GET `/api/eng/sprints/<sprint_id>/review` returns definitions, shared layouts and
capabilities. POST `/review/values/read` returns requested authorized cells.
PATCH `/review` atomically applies schema and per-cell revision changes. Limits
are 30 active columns per row kind, 100 changed cells per save, 500 issues per
read, 256 KiB requests and 1 MiB responses. Larger reads show bounded progress.

Summary and Team edits use the existing signed-in Jira OAuth field controller,
with stale-value and mapping-revision checks. Team options require actual Jira
schema/editmeta eligibility. Missing eligible options disables the editor; Team
clearing and subtask Team writes are unsupported. Epic Team editing changes the
Epic's own Team, separately from the read-only Teams in scope.

Migration `20261001_0017` adds the dedicated review tables; `20261001_0018`
adds shared column layouts without changing existing definitions or values. It is not applied to
production by this implementation. Authenticated live Team editing and release
acceptance require separate verification with an approved disposable Jira issue.

Story Points edits use only the in-cell input: Enter saves to Jira, Escape cancels, and leaving the input discards the unsaved value. No Save/Cancel buttons are shown.

In normal mode, the Epics/Stories and column toolbar sits directly above the spreadsheet. When sticky mode activates on scroll, the toolbar moves below capacity in the shared controls stack, following its width. Returning to the page top restores the toolbar above the table; selection and review drafts are preserved.

In expanded Table mode, Collapse panel is part of the selection control line, without a separate row above it.

Custom-cell inputs use a compact fixed height and vertical alignment; focus changes their border without adding a glow or changing column/row geometry.

The spreadsheet uses the page’s vertical scroll; its wrapper only scrolls horizontally. While rows are on screen, column headings dock below the measured Filters/capacity/toolbar stack and totals dock at the viewport bottom until the natural total row becomes visible. Both rows use measured column widths and synchronized horizontal positions, including horizontal scrolling from the bottom total row. Rows above the docked headings are clipped so they cannot peek beside the narrower controls. Frozen identification columns, sorting, reordering, editing and shared review drafts are preserved.
