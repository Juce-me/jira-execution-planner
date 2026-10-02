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
hidden by default; use Show hidden in the Add popover to show them. Saved visibility choices
take precedence over defaults, including an explicitly saved all-visible layout. Story Points have a visible
in-cell input with Enter to save and Escape to cancel in the signed-in Jira editor;
Epic Sprint SP remains a computed total. Story Capacity and Project Track
reflect the parent Epic; capacity changes use the existing shared Department setting.
Capacity chips retain a pale green Included or light gray Excluded background
on hover and keyboard focus, with a visible focus outline.

Accepted is a computed number column right after the points column, visible by default
(it is optional, so it can be hidden, moved and restored like the other Jira columns, and its
order and visibility save with the shared layout). A Story row shows its points only while
that Story is ticked; an Epic row (and the No Epic group) shows the sum of its ticked real
child Stories; awaiting-creation placeholders show nothing. The footer total is the sum over
the rows in the current mode, so it reads 0 with nothing ticked. It stands in for the accepted
numbers of the Planned Teams Effort panel inside the table, is never editable, and selecting
Stories does not make the review dirty.

In Table view the Planned Teams Effort panel is a one-line strip (its title with a caret) until
the user expands it, which keeps the table near the top of the page; its header is the toggle (a
native button, so it works by tap), the grid stays mounted but hidden while collapsed, and
expanding neither refetches nor changes selection. The choice is a private browser preference
(`planningTeamsEffortExpanded` in the saved UI preferences) that survives reloads; collapsed is
the default. Planning List shows the full panel exactly as before. The accepted numbers it
shows are also available in the table through the Accepted column.

The table's surfaces, borders and secondary text use the shared design tokens (`--bg-primary`,
`--bg-secondary`, `--border`, `--text-primary`, `--text-secondary`) rather than slate literals, so it
reads like the rest of ENG. Editable Summary, Team and Assignee triggers rest in neutral ink at
weight 400 and turn amber on hover and focus; the red zero-point tint, the green Included chip and
the blue drop and insertion cues keep their own colours.

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
appear for multiple admitted Teams/projects. Sort epics and Group by Initiative are not
rendered in Table view (they never changed table ordering); List and Catch Up keep them and
their stored choices.

There is no table toolbar tier. The Epics/Stories switch (the shared SegmentedControl in its
compact form, `eng-mode-control segmented-control-compact`) sits in the Filters row's
view-controls slot, followed at the right end by Discard and Save, which appear only while
the review has local changes (Discard asks for an inline confirmation, using the Filters
button style; Save is the row's single filled button); a muted Loading… note shows there
while the review loads. There is
no options menu or usage help: the app-header Refresh also reloads the shared
review (drafts are preserved; it leaves a review that is already loading or
saving alone), and a third click on a sorted heading clears the sort.
Column work happens in the table header. The corner + in the pinned select header cell
(accessible name + Add column, a disabled control without a saving-capable profile)
opens the 300px Add popover, anchored to the table without shifting the page layout and
inside the viewport. Its subject names the active row mode (Add column · Epics or
Stories); the name field takes focus, with the shared Number | Text segmented control
and Add column beside it (Enter adds, Escape cancels) and the note that the column is
shared with everyone reviewing the Sprint. A new column is appended after the last
movable column. Below, Show hidden lists the hidden optional Jira columns and hidden
review columns as one-line rows in the Filters popover grammar; a row shows its column
again and the popover stays open. Archived review columns are not listed and cannot be
restored from the UI. Escape or an outside click dismisses either popup.
On pointer devices a boundary + follows the mouse along the header row: within 5px of the
edge after Summary or after any movable column (and until 9px once it is showing) a
16×24px + button on a 2px blue edge line appears, and that cell's chevron steps aside
while it does. Clicking it opens the same Add popover anchored at that boundary; a new
column, or one restored from Show hidden, is placed directly after the left neighbour
(after the pinned columns for the Summary boundary). Edges of columns scrolled under the frozen columns are not offered; the last column's edge is, even at maximum scroll. It works on the docked header. It is
not shown on touch devices (the corner + is the touch path), while a column grip is being
dragged, while a popup is open, after any scroll until the pointer moves again, outside the
header row, or when the review cannot be edited.
The chevron opens a column menu anchored to the header cell (also from the docked
header; an open menu closes when the header docks or undocks). Move left and Move right
step the column past its nearest visible neighbour like dragging does and stay open;
optional Jira columns and review columns also offer Hide column, which closes the
menu. Review columns add Rename (an inline field: Enter or leaving it saves, Escape
cancels and keeps the menu open), Show total (numbers only, a pressed toggle for the
footer Σ) and Archive column…, which asks inline first and closes the menu (archiving is refused, and the reason shown under the toolbar, while the column still has unsaved cell drafts).
The menu does not repeat the column name (it opens directly under that heading) or a usage hint;
only review columns carry a small "Shared review column" title, and only a menu with a toggle
row keeps a checkbox gutter, so plain actions start at the left edge.
Drag column handles to place Jira and custom columns in any order after the pinned
Key and Summary columns. Arrow keys on a focused handle move it past the nearest
visible neighbour, stepping over hidden columns; the headers are the only place to
reorder. Hide column in a column's menu and Show hidden in the Add popover control
optional visibility.
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

The Epics/Stories switch is the same DOM node in the Filters row before, during and after sticky mode, and its position does not change when the first scroll activates the sticky stack. With the table header docked, the pinned stack (compact header, Filters, capacity overview and header) is 173.5 px; selection and review drafts are preserved. Without a Filters row to host it (local test harnesses), the controls render above the table instead.

In expanded Table mode, Collapse panel is part of the selection control line, without a separate row above it.

Custom-cell inputs use a compact fixed height and vertical alignment; focus changes their border without adding a glow or changing column/row geometry.

The spreadsheet uses the page’s vertical scroll; its wrapper only scrolls horizontally. While rows are on screen, column headings dock below the measured Filters/capacity stack and totals dock at the viewport bottom until the natural total row becomes visible. Both rows use measured column widths and synchronized horizontal positions, including horizontal scrolling from the bottom total row. Rows above the docked headings are clipped so they cannot peek beside the narrower controls. Frozen identification columns, sorting, reordering, editing and shared review drafts are preserved.
