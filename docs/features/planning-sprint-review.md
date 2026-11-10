# Planning Sprint review

Planning is the Table only; List stays in Catch Up. Planning List was retired
(#323, operator decision 2026-11-06): a List choice saved earlier or carried by an old
link opens Table, and the link keeps its focus by opening the Epics or Stories rows of
its focus kind. No layout preference is stored. The shared header,
Sprint/Teams controls and filters retain their list width. Every Table scope,
including multiple Teams, starts with the sticky Planning overview compact: one
desktop row with Select All, Clear Selection, Undo, Status ▾ (accessible name "Include
by status"), an icon-only Open in Jira (accessible name "Open planned stories in Jira"),
the short summary in the flexible gap and Details (accessible name "Show capacity
details"; "Hide details" when expanded) right-aligned. The Table summary reads
`209 stories · 220.0 SP · Cap 183.4 SP`, followed by `· N unestimated` and `· N hidden`
(planned stories the filters hide) only when they are above zero, and `Cap unavailable`
when capacity is unavailable; it uses the configured child word. Its values never
ellipsize: the worst case fits whole at 1280x720 and 1440x900, and only the whole line
would ellipsize as a last resort. The compact row stays 46.9px; a capacity error adds
one line under it. At narrow widths the row wraps and the summary may wrap inside its
box. The summary has no hover or focus readout; the breakdown lives in the capacity
details. Open in Jira opens the planned stories matching the
current Team and filters and is disabled when none match. Status ▾ opens the Include by status popover with one line of status
toggles (Accepted + In Progress, To Do / Pending, Postponed, Awaiting validation),
each labelled `<group> · <included>/<total>` over the stories matching the current
Team and filters. A toggle is pressed when every matching story of its group is in
the plan; clicking a pressed toggle removes them all, clicking any other includes the
rest. A group with no matching story is disabled. The popover stays open so several
groups can be toggled, and closes on an outside click or Escape. The popover stays inside the viewport and wraps whole toggles onto further lines; each toggle stays one line tall and never wraps, ellipsizes or clips its label. Hiding capacity
details keeps the controls and counts visible; Details reveals the
existing graphs and Team capacity content without changing inclusion or fetching
another dataset. Capacity errors ("Capacity unavailable — show capacity details to
retry") remain visible while details are hidden. Only the spreadsheet region widens;
extra columns scroll inside it.
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
before Catch Up alerts and Planning capacity content.
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
Epic Sprint SP remains a computed total. Story Points inputs fit the same compact row height as Epic rows, including while focused; expanding an in-cell Summary editor may still grow its row. Story Capacity and Project Track
reflect the parent Epic; capacity changes use the existing shared Department setting.
Capacity chips keep their pale green Included or light gray Excluded resting
treatment on hover, adding an inset blue ring that remains visible within the cell.
Keyboard focus keeps its existing light fill and visible outline. Disabled chips
retain their resting appearance.

Planned SP is a computed number column right after the points column, visible by default
(it is optional, so it can be hidden, moved and restored like the other Jira columns, and its
order and visibility save with the shared layout). A Story row shows its points only while
that Story is ticked; an Epic row (and the No Epic group) shows the sum of its ticked real
child Stories; awaiting-creation placeholders show nothing. The footer total is the sum over
the rows in the current mode, so it reads 0 with nothing ticked. It stands in for the accepted
numbers of the Planned Teams Effort panel inside the table and is never editable.
Changing Story inclusion makes the shared plan dirty; Jira's Accepted status is unchanged.

In Table view the Planned Teams Effort panel is a one-line strip (its title with a caret) until
the user expands it, which keeps the table near the top of the page; its header is the toggle (a
native button, so it works by tap), the grid stays mounted but hidden while collapsed, and
expanding neither refetches nor changes selection. The choice is a private browser preference
(`planningTeamsEffortExpanded` in the saved UI preferences) that survives reloads; collapsed is
the default. The accepted numbers it
shows are also available in the table through the Planned SP column.

The table's surfaces, borders and secondary text use the shared design tokens (`--bg-primary`,
`--bg-secondary`, `--border`, `--text-primary`, `--text-secondary`) rather than slate literals, so it
reads like the rest of ENG. Editable Summary, Team and Assignee triggers rest in neutral ink at
weight 400 and underline on hover; keyboard focus retains amber ink. The red zero-point tint, the green Included chip and
the blue drop and insertion cues keep their own colours.

Planning actions and sortable headings use the shared overlay and blue ring;
selected actions add only the ring. Framed icon actions and capacity controls shade within their existing border; unframed icons use a tinted circle, and menu
options use row tint. Custom editable fields underline their bottom edge without
changing size or fill. The boundary insertion control keeps its transparent hit
region, with the ring around its visible + dot. Hover feedback is enabled only on
hover-capable devices and enabled controls; reveal, touch and drag behavior stay
unchanged. The [design-system map](../design-system.md) records shared ownership
and the separate palette and keyboard follow-ups.

Epics show scoped child Story Points and contributing Teams. Story mode includes
orphans and awaiting-creation placeholders, one per uncovered Team. Readiness-only
Epics remain in the Epic table, marked with a "N Story awaited" chip beside the title
(not a second line), so the row keeps its normal height even for a long, truncated title. Each
placeholder shows its Team and links its parent Epic; it has no Jira key or
Story Points and cannot be selected or edited. Table placeholders remain visible
through Story status/priority filters, while Department, Team, project, Project
Track and search scope still apply.
The shared inclusion document belongs to a Department group, Sprint and review
namespace. Team and ordinary filters project it without replacing other Teams'
inclusion. Select All adds every matching real child Story, including rows below
the viewport; Clear Selection removes matching included Stories only. Epic
checkboxes use the same filtered child set. Undo reverses the last local inclusion
gesture, up to 20 gestures. Legacy browser selections remain untouched and are
not imported. A missing plan and a saved empty plan have distinct messages.
Synthetic rows cannot edit Jira or store custom values. Team and Project columns
appear for multiple admitted Teams/projects. Sort epics and Group by Initiative are not
rendered in Table view (they never changed table ordering); Catch Up keeps them and
their stored choices.

Priority and status edits made in the Table settle locally (see Planning edits in
[eng-workflows](eng-workflows.md)): a pending edit does not move its row, a confirmed one re-sorts
the rows by the active sort, sliding the edited row and the rows it passes by their cells, and blinks
the edited row. The reveal scrolls the page only when the row would otherwise be off-screen, and a
focused review cell holds its row so neither the slide nor a filter can unmount the input.

There is no table toolbar tier. The Epics/Stories switch (the shared SegmentedControl in its
compact form, `eng-mode-control segmented-control-compact`) sits in the Filters row's
view-controls slot, followed at the right end by Discard changes and Save plan, which appear only while
the review has local changes (Discard changes asks for an inline confirmation, using the Filters
button style; Save plan is the row's single filled button); a muted Loading… note shows there
while the review loads. There is
no separate table toolbar: Include by status and Open in Jira stay with the primary inclusion controls.
Save plan commits pending inclusion across Teams together with app-owned review
changes; Jira edits and capacity saves remain independent. Discard changes reads
the latest confirmed document. The app-header Refresh also reloads the shared
review (drafts are preserved; it leaves a review that is already loading or
saving alone), and a third click on a sorted heading clears the sort.
Column work happens in the table header. The corner + in the pinned select header cell
(accessible name + Add column, a disabled control without a saving-capable profile)
opens the 300px Add popover, anchored to the table without shifting the page layout and
inside the viewport. Its subject names the active row mode (Add column · Epics or
Stories); the name field takes focus, with the shared Number | Text segmented control
and Add column beside it (Enter adds, Escape cancels) and the note that the column is
shared with everyone in this Department group. A new column from the corner + lands after the last
native (non-derived) column of the viewed row mode. Below, Show hidden lists the hidden optional Jira columns and hidden
review columns as one-line rows in the Filters popover grammar; a row shows its column
again and the popover stays open. Archived review columns are not listed and cannot be
restored from the UI. Escape or an outside click dismisses either popup.
On pointer devices a boundary + follows the mouse along the header row: within 5px of the
edge after Summary or after any movable column (and until 9px once it is showing) a
16×24px + button on a 2px blue edge line appears, and that cell's chevron steps aside
while it does. Clicking it opens the same Add popover anchored at that boundary; a new
column, or one restored from Show hidden, is placed directly after the left neighbour
(after the pinned columns for the Summary boundary). The position is saved with the column as an
anchor (the nearest preceding native column, or the pinned columns), so every Sprint places it the same way;
a boundary + after a derived column anchors to the native column before it. Edges of columns scrolled under the frozen columns are not offered; the last column's edge is, even at maximum scroll. It works on the docked header. It is
not shown on touch devices (the corner + is the touch path), while a column grip is being
dragged, while a popup is open, after any scroll until the pointer moves again, outside the
header row, or when the review cannot be edited.
The chevron opens a column menu anchored to the header cell (also from the docked
header; an open menu closes when the header docks or undocks). Move left and Move right
step the column past its nearest visible neighbour like dragging does and stay open;
every column except the pinned Summary also offers Hide column, which closes the
menu (Key is pinned first, so its menu holds only Hide column). Review columns add Rename (an inline field: Enter or leaving it saves, Escape
cancels and keeps the menu open), Show total (numbers only, a pressed toggle for the
footer Σ) and Archive column…, which asks inline first ("it leaves this table in every Sprint for <group> and cannot be restored here") and closes the menu (archiving is refused, and the reason shown under the toolbar, while the column still has unsaved cell drafts).
The menu does not repeat the column name (it opens directly under that heading) or a usage hint;
only review columns carry a small "Shared review column" title, and only a menu with a toggle
row keeps a checkbox gutter, so plain actions start at the left edge.
Drag column handles to place Jira and custom columns in any order after the pinned
Key and Summary columns. Summary is the only column that is always visible. While Key is hidden,
each real Epic or Story row carries a Jira icon link (accessible name Open KEY in Jira) before its
Summary, Summary freezes straight after the selection column, and Key is never part of the saved
order (it appears in the saved hidden list only). Hiding a column also drops any sort on it; Show
hidden restores it, Key at its pinned first position.
On wide displays the bordered sheet shrinks to the width of its columns and sits centred in the
region, with no blank frame beside it; a sheet wider than the region fills it and scrolls horizontally.
Status and awaited-Story pills use the Catch Up and filter typography (Plex Mono capitals). While
the signed-in Summary editor loads or saves, a small spinner sits inside the input's right edge;
the row never grows for a status line. Arrow keys on a focused handle move it past the nearest
visible neighbour, stepping over hidden columns; the headers are the only place to
reorder. Hide column in a column's menu and Show hidden in the Add popover control
optional visibility.
Order and visibility are shared per workspace + Department group + Sprint, separately for Epics and
Stories (one saved view per Sprint holding both), and remain drafts until Save review. Reload/Refresh loads the Sprint's
view; concurrent layout saves are protected by the Sprint view's own revision. Save
accepts layout changes only when the response confirms their exact order and
visibility (the Sprint's view response); missing or mismatched confirmation preserves the draft and requires
explicit refresh/reapply recovery. See Group columns and Sprint views below.
Columns and values are shared within workspace + Department group across every Sprint (one value per issue), independent of Team
filters. Epic and Story cells are separate and use immutable Jira IDs.
Numbers allow at most one decimal place (up to 999999999.9) and show without trailing
zeros (12, 12.5); totals stay exact across visible rows, and values stored earlier with
more decimals still read and total exactly;
blank values are distinct from zero. Heading clicks cycle ascending, descending
and off; Shift-click adds up to five ordered sort criteria, and the position number
shows only with two or more criteria. Custom changes remain local until Save review.

Dirty drafts survive filter, mode and layout changes. Sprint and Department group changes
require Save, Discard or Stay (the dialog says "before changing Sprint or group"), including the group
changes made from the header dropdown and the Settings Save; automatic group changes (a hidden active
group, a share-link apply, first run) discard a dirty draft without a notice. Browser exit uses the browser's unsaved-change
prompt. Refresh, including the app-header Refresh, preserves drafts; conflicts offer deliberate Load current or
Reapply. Unconfirmed writes are never automatically replayed.

The #251 automatic-return implementation defers shared review and capacity acquisition while an editor, draft, save, conflict or unconfirmed result is active. Accepted review schema, requested cells and layouts are staged together; automatic capacity reads retain the existing Team scope. Automatic acceptance preserves selections and the shared Epic/Story table reading position, including deliberate movement during a read. This does not authorize saving or replaying mutations. Final suite/publication acceptance and real OS lifecycle/live-cost evidence remain tracked in the [return verification record](eng-workflows.md#return-after-an-absence).

Shared saving requires database-backed OAuth. Other profiles retain the Jira
spreadsheet with capability guidance. Review routes derive identity from the
request context and authorize every real issue through current-user Jira search.
They require the normal requested-with and CSRF protections, including values
reads. All API 401 responses use the terminal global authentication recovery.

API: GET `/api/eng/sprints/<sprint_id>/review?groupId=<id>` returns the group's definitions, the Sprint's resolved
layouts, `viewRevision`, `inheritedFrom` and capabilities. POST `/review/values/read` returns requested authorized cells
for the group's active columns. PATCH `/review` atomically applies schema, layout and per-cell revision changes (`groupId`
and `baseViewRevision` travel in the body). `groupId` is required on all three, 1-128 characters and equal to its
stripped form; PATCH validates it against the shared Department group catalog (`400 review_group_unknown`), and a
view-cap breach is `400 review_view_limit`. Both 409 sites carry `schemaConflict`, `viewConflict`, `cellConflicts`,
`columns` and `schemaRevision`. Limits are 30 active columns per row kind, 240 columns per group (archived included),
500 saved Sprint views per group, 100 changed cells per save, 500 issues per read, 256 KiB requests and 1 MiB
responses. Larger reads show bounded progress.

Summary and Team edits use the existing signed-in Jira OAuth field controller,
with stale-value and mapping-revision checks. Team options require actual Jira
schema/editmeta eligibility. Missing eligible options disables the editor; Team
clearing and subtask Team writes are unsupported. Epic Team editing changes the
Epic's own Team, separately from the read-only Teams in scope.

Migration `20261001_0017` adds the dedicated review tables; `20261001_0018`
adds shared column layouts without changing existing definitions or values; `20261020_0019` adds the group tables
(see below). None is applied to production by this implementation. Authenticated live Team editing and release
acceptance require separate verification with an approved disposable Jira issue.

Story Points edits use only the in-cell input: Enter saves to Jira, Escape cancels, and leaving the input discards the unsaved value. No Save/Cancel buttons are shown.

The Epics/Stories switch is the same DOM node in the Filters row before, during and after sticky mode, and its position does not change when the first scroll activates the sticky stack. With the table header docked, the pinned stack (compact header, Filters, capacity overview and header) is 173.5 px; selection and review drafts are preserved. Without a Filters row to host it (local test harnesses), the controls render above the table instead.

In expanded Table mode, Collapse panel is part of the selection control line, without a separate row above it.

Custom-cell inputs use a compact fixed height and vertical alignment; focus changes their border without adding a glow or changing column/row geometry.

The spreadsheet uses the page’s vertical scroll; its wrapper only scrolls horizontally. While rows are on screen, column headings dock below the measured Filters/capacity stack and totals dock at the viewport bottom until the natural total row becomes visible. Both rows use measured column widths and synchronized horizontal positions, including horizontal scrolling from the bottom total row. Rows above the docked headings are clipped so they cannot peek beside the narrower controls. Frozen identification columns, sorting, reordering, editing and shared review drafts are preserved.

## Group columns and Sprint views (#267)

Review columns and values belong to a Department group, not to a Sprint. In
`workspace_group_review_schemas` one row per workspace and group id holds the column
definitions (label, type, total, archived, default order and creation anchor); `group_review_cells` holds one value per
issue, row kind and column, shared by every Sprint; `group_sprint_review_views` holds one saved
view (column `order` and `hidden`, per row kind) per workspace, group and Sprint. The group id is the storage key and is stable on
rename; a group's visibility preference never gates its review data; a group re-created with a deleted
group's id (including the default "New Group" slot) silently reattaches the old columns, values and views, and archiving the
unwanted columns is the recovery. Editing a value in any Sprint changes it in all of them and creates no view; renaming a
column, changing its total or archiving it never creates a view either.

**View resolution.** The Sprint's own saved view wins; otherwise the nearest earlier saved view by numeric Sprint
id (one `<=` lookup on `sprint_order`, the id left-padded to 128 digits; no catalog or Jira read); otherwise
the default arrangement. Inheritance is whole-row: a view holding only one row kind leaves the other kind at its default. The first layout save in a
Sprint writes its own view and freezes inheritance for both kinds (the client adds the other kind's layout to that save when it
holds one). Adding a column always saves the creating Sprint's layout, so that Sprint gets its own view.

**Hint.** A Sprint that inherits shows one line above the table, "Layout inherited from <Sprint>" (or "an earlier
Sprint" when the source is missing from the loaded Sprint catalog), with a small dismiss button. The dismissal is a private browser
preference (`planningInheritedHintDismissals`, newest 50, keyed by Sprint and group) that holds only for that source Sprint and view
revision; the line is hidden while a capability, error, form or recovery line shows, and while the review has a layout draft. It is a
recorded exception to "no persistent instructional text". There is no reset, choose-source or delete-view action.

**Archive versus Hide.** Hide is per Sprint view and row kind and is reversible from Show hidden. Archive is group-wide, for every Sprint
and every user, cannot be restored from the UI, frees an active slot but still counts toward the 240-column cap, and removes the
column's derived twin everywhere.

**Derived Epic and Story columns.** Computed in the client from loaded cells; nothing is stored, sent or editable. A Story number
column whose total is a sum also appears in the Epic view as a sum over the Epic's in-scope Stories (blank until every
in-scope Story is loaded, while a manual refresh loads, when no Story has a stored value, and for unavailable Stories; turning Show total
off removes the rollup in every Sprint). Every Epic column also appears in the Story view as the parent Epic's value, repeated per
Story and never summed or totalled. Derived columns are visible by default, last in the other view, and keep their position in
a saved layout; their menu offers only Move left, Move right and Hide, and hiding is per row kind. A superscript marker
("S" on a Story column in the Epic view, "E" on an Epic column in the Story view) sits before the name on numeric columns and
after it on text columns, is a native button with a 24px hit area that does not change the 32px header, and opens a readout on mouse
hover, focus or a tap that pins it ("Story property, summed from this Epic's Stories in this Sprint and the current filters" or "Epic
property, inherited from the parent Epic"). Totals and sorting use the derived value; an Epic with no in-scope Stories, a Story with no Epic
and an awaiting-creation placeholder show blank.

**Adoption cutover.** Migration `20261020_0019` creates the group tables empty and leaves the legacy per-Sprint tables untouched
and unread. Revision `20261023_0020` then adopts the legacy data by itself on upgrade, once, into every configured group that
holds no review row (a group that holds rows is left alone and logged; database errors fail the upgrade, planner data errors
skip the workspace; `REVIEW_ADOPTION_ON_UPGRADE=false` turns it off). `scripts/adopt_legacy_sprint_reviews.py` stays the manual
tool (a dry run by default; `--apply` needs the dry run's `--expected-sha256` digest and runs in a quiesced window). It copies each
workspace's legacy columns, values and views into every configured Department group. See the cutover runbook, rollback table and
purge note in [README.md](../../README.md) and [INSTALL.md](../../INSTALL.md). A database that auto-migrates on start now adopts them
during the upgrade. Once any group row exists (any save after the release), `--apply` refuses; `--merge` then
restores the legacy columns, values and views without overwriting anything live (a legacy column claims a group column by id, then by
kind, label and type; live cells and views win; a column the group archived stays archived), can run while the app serves, and a second run is
a no-op. `--list` reports `nothing to adopt`, `pending`, `needs-merge`, `adopted` or `error` per workspace. See the restore steps in
[README.md](../../README.md) and [INSTALL.md](../../INSTALL.md).

**Known limits.**
- Sprint id is the ordering proxy: a Sprint created out of order, or renamed or reused out of order, can inherit a later Sprint's
  view; a quarter whose id changes (future to active) can orphan its saved view; the hint falls back to "an earlier Sprint" when
  the source is gone.
- Any user can fill the 500-view cap (an accepted insider risk; the purge runbook is in INSTALL.md); at the cap a Sprint with no view of its
  own cannot add a column and its cell draft rolls back with it (Discard is the exit). The 240-column ceiling per group is permanent.
- A column action by anyone interrupts dirty column drafts elsewhere in the group, and a layout change interrupts dirty layout drafts of the
  same Sprint; cell-only drafts are not interrupted.
- At cutover adopted columns surface as derived columns in every group's views, "highest Sprint id wins" collapses per-Sprint value
  history (the report counts what is dropped), archive-intent and cap-excluded keys lose their cells, and an adopted single-kind
  view makes later Sprints show the default arrangement for the other kind.
- A layout saved while Show total is off loses that derived column's position; the corner + can land a new column second rather
  than last when a Sprint's view moved a native column to the front.
- `--merge` adds a column again after a label-matched column was renamed in the group (archiving it does not) or a purged Sprint view row (the way to free the view cap), and an inserted legacy view
  changes the layout that later Sprints without their own view inherit (the report names the Sprint-id intervals). It has no automatic
  undo: the pre-run backup is the rollback.

## Quarterly work configuration namespaces

After promotion, review data is isolated per work configuration. Existing rows keep `configuration_id` NULL and form the **Legacy namespace** (Epic parent rows, Story child rows, inheritance by numeric Sprint id), unchanged. A quarter handled by the combined model uses its own namespace keyed by the configuration's opaque id: native `initiative` rows are the parents and `epic` rows are the children, with their own columns, values and layouts (`backend/services/sprint_review.py`: `LEGACY_KINDS`, `CONFIGURATION_KINDS`, `namespace_identity`). Nothing is copied or inherited across namespaces, and a new namespace starts empty. A saved view in a configuration namespace is stamped with a quarter ordinal (`(year-1)*4+(quarter-1)`) and inherits from the nearest earlier ordinal of the same namespace only (`resolve_view`), never by Sprint id; Legacy views get no ordinal. Moving a configuration's range does not relabel stored data. The caps are per group across namespaces (30 active columns per native kind, 240 definitions, 500 views), and every writer takes the NULL-Legacy schema row as the group fence first. Authorization uses the configuration's mapped type id plus the expected hierarchy level (Epic 1, Initiative 2), not issue-type names. The Planning review calls carry the configuration stamp described in the design-system write registry. Migration `20261030_0022_review_namespaces.py` adds the columns and partial unique indexes and its downgrade refuses once any new-namespace, Initiative or ordinal data exists. Tests: `tests/test_work_structure_reviews.py`, `tests/test_sprint_review.py`; PostgreSQL cases in `tests/test_sprint_review_postgresql.py` were compile-checked only. Fresh (non-merge) Legacy adoption refuses once era-specific review rows exist.

## Assignee capacity strip (#323)

With exactly one Team selected in the Table layout, Planning shows a collapsible in-flow strip, "Assignee Capacity (Story
Points)", below the controls stack (portaled into `#planning-assignee-capacity-host`, outside the pinned overview). Two Teams
and All Teams keep the Selected SP by Team cards unchanged. The expanded state is a private browser preference
(`jira_dashboard_planning_assignee_capacity_v1`). All numbers are Story Points. The strip and the table's Epics/Stories
control follow each other: expanding the strip from its header selects Stories, and choosing Epics (a click or a link's rows)
while it is expanded collapses it; the Epics a table mount starts with (reload, Sprint switch) yields to an expanded strip by
selecting Stories. Neither direction emits analytics or adds a request.

**Columns.** Assignee, Planned capacity, Estimated effort, Vacations, Notes, with a Totals row summing the three numeric
columns. Planned capacity, Vacations and Notes are typed in (0 to 10,000 with at most two decimals; Notes up to 500
characters, single line); blank means unset. Vacations are informational and never subtracted from Planned capacity. Planned
effort sums the checked Stories of the Team from the same selection the capacity bar uses (its total is the bar's Selected),
so search, Team, Project and Project Track filters narrow it and a muted line says how many selected Stories filters hide.
There is no Total effort column. The over/under cue uses the existing capacity thresholds (over above 120%, under below 90%)
on rows with Planned capacity and on the Totals row, which compares the displayed Estimated effort total (including Unassigned)
with the Planned capacity sum. The Totals Planned capacity reads "X / Y": the people's Planned capacity sum out of the team
capacity the team card uses, the Jira ticket value or, without one, the stored Team capacity (not in Jira), unscaled by the
Product/Tech share because person capacities are raw; with no team number (no ticket value and no stored number, loading or a
read error) it shows the sum alone. When the sum is above the team number the cell takes the over cue's tone and its text is
a native button with the marks' transient readout (mouse hover, focus-visible or a tap; a mouse click pins nothing), "People's
planned capacity X SP exceeds team capacity Y SP by D SP", also its accessible name; it is display only and gates no edit.
Sums run in integer hundredths. The table fills the strip's width: Assignee takes a quarter,
the numeric columns are compact and right-aligned, Notes takes the rest; long names and notes stay on one line with an
ellipsis and show in full on hover or focus. Below 680px the table scrolls inside the strip, never the page.

**Avatars.** Each person's name follows the issue card's 14px person slot (`PersonAvatar` in `task-assignee-icon`): the
photo of that person from a loaded Story's assignee, keyed by account id, else the person glyph. Nothing is requested or stored
for it. A person added from the search this page session shows the photo the search returned (an allowlisted Atlassian
avatar URL, kept in memory by account id until reload); otherwise a person with no loaded Story shows the glyph. The
Unassigned row has the same slot empty, so its name lines up with the person names.

**Marks.** Before the avatar every row has a fixed 14px mark slot, empty unless the person has a set Planned capacity (above
0) and a Estimated effort that is either on plan or over, compared in integer hundredths with both boundaries inclusive: on
plan when 0.8 x capacity <= effort <= 1.2 x capacity (a rounded green square with a white check, in `--good`; readout "Effort
M SP of capacity N SP: on plan"), over when effort > 1.2 x capacity (two bold rounded exclamation marks in `--warn`, the
same threshold as the over cue; readout "Effort M SP, capacity N SP: X SP over capacity"). Spare capacity (effort below 80%,
effort 0 included), a blank or 0 capacity, the Unassigned row and removed people get no mark. The icons are inline SVG that
only resemble the check-mark and double-exclamation emoji, so no emoji font is involved. A mark is a native button whose
accessible name is its readout sentence; the in-app readout follows a mouse by hover only (a mouse or pen click neither
pins it nor focuses the mark), opens on keyboard focus-visible until blur or Escape, and opens on a touch tap until a second
tap, an outside tap or a scroll. It writes nothing; numbers are trimmed to at most two decimals. The slot keeps names,
avatars and row heights where they were.

**Unassigned.** Stories with no assignee account id get their own highlighted row, first, shown only while such non-Killed
Stories of the Team exist; it shows Estimated effort only and is neither editable nor removable.

**Rows, names and inheritance.** One person is one row, merged from the people with Stories in scope, the Sprint's own
document and an inherited document. A Sprint without its own document reads the nearest earlier document of the same Team
(by Sprint id) as a whole: its people and Capacity show gray, with "Inherited from <Sprint>. Editing any value saves this
Sprint's own copy."; Vacations and Notes are not inherited. The first save in such a Sprint materialises the inherited people
and Capacity into the Sprint's own document in one locked transaction, then applies the edit, so the next Sprint still sees
everyone; a commit equal to what is shown sends nothing. Every row stores a display-name snapshot, refreshed on save from a
Story's current name, so a person with no Stories (including one deactivated in Jira) keeps appearing under the stored name.

**Remove and Restore.** Only a person with no Stories in scope can be removed. Removed people are listed under the table,
"Removed from this Sprint and later ones:", where each underlined name restores the person with one tap; values are kept.

**Saving.** Enter or blur commits, Escape cancels; an invalid draft stays in its cell with its error. One serial queue per
Sprint and Team coalesces commits within about 200 ms into one PATCH, keeps one request in flight and reuses the CSRF token;
across Teams at most 4 assignee-capacity PATCHes run at once.
An unconfirmed write is read back and only the differing fields are resent (last write wins per field, so retries are
idempotent). A failed save shows "Not saved" with Retry and Discard changes, in the table and in the collapsed header; a
change the server refuses waits for Retry or Discard so it cannot fail later batches. Changing Team or Sprint sends the old
scope's commits in the background; a scope left with drafts, a save in flight or a failed save is never evicted and keeps
its drafts for the page session (only clean, idle scopes beyond the last five are dropped, keeping their number), and shows
Not saved with Retry on return. A `401` keeps the drafts behind the global sign-in lock. Without database
storage or save rights the read reports `capabilities` and the strip is read-only (no Remove, Restore or Add assignee) or
hidden.

**Undo.** The last 20 edits of the shown Sprint and Team (Capacity, Vacations, Notes, Remove, Restore, Add assignee and the
stored team number, which shares the queue) can be undone with the Undo button at the right end of the expanded strip header
(beside the save status, a sibling of the header toggle; the collapsed strip shows no Undo), or with Cmd/Ctrl+Z while focus
is in the table and no cell holds an edit of its own (that cell keeps the input's native undo; key auto-repeat is ignored).
Enter leaves focus on the committed cell, so Cmd/Ctrl+Z right after Enter undoes that commit. An
undo re-commits the previous full row through the same queue, so it is an ordinary save; one undone before its edit was sent
sends nothing. Undoing an Add assignee removes the person again: it sends `removed: true`, because there is no delete
route. Undoing the first edit of an inherited Sprint keeps the Sprint's own copy with the inherited values, and the muted
line "Undo kept this Sprint's own copy with the inherited values." says so; a restored inherited stored team number is
saved as this Sprint's own number with `source: 'user'` (inheritance itself is unchanged: the next Sprint inherits that
own copy). Between users the last write wins per field: Undo re-sends the earlier values without checking whether someone
else changed them meanwhile, except that a re-read bringing a different document clears the stack. The stack is cleared on a Team or
Sprint change, on any failed or refused save, Retry or Discard, on a re-read that brings a different document, and on a new
auth session. Read-only strips show no Undo.

**Underbar.** The pinned amber capacity bar carries a thin 5px strip at the bottom of its existing track, adding no height:
one segment per person with Planned capacity or Estimated effort above 0, in table order, plus a trailing Unassigned segment
(one solid `--warn` layer sized by the Selected Stories with no assignee). A person's segment is max(capacity, effort) wide
and always reads left to right as solid effort (the colour at 70% over the surface), then the rest: tinted free
capacity (28%) while effort is below capacity, or diagonal stripes of the two for the effort beyond capacity once it passes
it (equal is fully solid). Both are drawn as a full-width base layer plus a solid layer on top from the left edge, close to
the table row tint (12%). A person
with capacity only is purely tinted, with effort only purely solid, with neither has no segment. The strip's total (the sum
of max(capacity, effort) plus Unassigned) may exceed the Selected fill and run past the Team Cap marker, so the bar's scale
is the largest of capacity, Selected and that total, times 1.15 (the team-card bar uses the same function with 1.3); the
fill, the markers and the strip share it, so nothing clips and the Team Cap marker lines up. The whole track is hoverable
and tappable: the segment under the pointer shows a compact readout (person: swatch and name, "X SP effort · Y SP capacity", then
"X SP capacity left" or, in the warning tone, "X SP over capacity" when capacity is set; "Unassigned (effort)" with its effort
and share of selected), while past the last segment it shows the "Selected N tasks · X SP" header and the team number's
source; and the marker lines
keep their own tooltips. Table rows of people with a segment are tinted with the person colour; others keep the normal row
surface.

**Team capacity (not in Jira).** The document also stores one team number per Sprint and Team. It is editable from the team
card's own pencil only when the Jira capacity read settled for this scope and found no ticket for the Team (not loading,
failed, stale or ambiguous, and only with a Capacity Project configured); a matched ticket with a blank value also shows
the stored number as a fallback while its pencil keeps editing Jira. The stored number enters the same capacity maths as a
Jira value (multiplier and excluded capacity apply), so the amber bar and the underbar appear for a Team without a ticket.
Jira wins on screen whenever it has a value. A Sprint without its own document shows the nearest earlier number gray
(source `inherited`). After a user-initiated capacity read, a Jira value that differs is mirrored silently into an existing
own document (database only; never into a typed number, never while the queue is busy, never creating a document,
failures dropped). A typed number that differs from the ticket marks its card (`data-capacity-attention="mismatch"`); there
is no banner, Use ticket value or Not now. With the capacity mutation right the card's hover rail then reads Jira · → ·
pencil: one click on → writes the stored number to that Team's own matched ticket (`PATCH /api/capacity/<issue_key>` with a
numeric `capacity` and the read `expectedCapacity`; write contract `capacityReconcilePush` in
[design-system.md](../design-system.md)). While it runs the → is unavailable with "Applying…" and that Team's Jira pencil is
disabled; on success the → disappears and the stored number settles to `jira`. A `409 capacity_conflict` shows Jira's
current value on the card and "Capacity changed in Jira to N. Apply M SP again to replace it." (it never claims nothing was
written), and the next click expects that value; other errors keep the editor's copy. The overview's state note adds
"Applying N Teams to Jira…", "N Jira push(es) failed" or "N Jira push(es) need(s) review". Each push has its own abort; a
scope change aborts pushes in flight and never retargets them. Nothing is written to Jira except by an explicit click on a
card's Jira pencil Save or its →; a successful Jira save turns a typed number into the ticket value in any scope.

**Add assignee.** Under the table and in the empty state, a person picker searches the active users assignable in the
workspace's selected Product and Tech Jira projects through `POST /api/eng/assignee-capacity/user-options` (the signed-in
user's Jira context; no email shown; each result may carry an allowlisted avatar URL). Picking a person adds a row with a stored name snapshot and no Capacity; picking a
removed person restores them; picking a listed person focuses their row.

**Freshness.** The document is read whenever one Team is selected in Table, expanded or not, cached per Sprint and Team
for the page session. The Planning automatic follow-up and the header Refresh re-read it, never while it loads or holds
unsaved changes; an unchanged document is not republished, a failure keeps the held document, and an automatic height
change of the strip above the viewport keeps the reading position. A new auth session clears the cache and re-reads.
With several Teams the same refresh re-reads every card's stored number through one batch read (one Team through its full
GET): a clean Team takes the new number, while a Team with a draft, a save in flight or a failed save keeps its own value,
and an open card editor keeps its text and focus. The automatic follow-up waits while a card editor or a push is open; an
unchanged projection keeps its identity (App does not re-render); answers that arrive after a scope change, a new auth
session or a sign-in stop are dropped. A failed batch read keeps the held numbers, disables the stored-number pencils and
shows "Capacity could not be refreshed. Retry before editing."; the next successful read recovers without sending a PATCH.

**Every displayed Team.** The cards are the Teams the Teams selector shows for the current selection (explicitly
selected Teams always; with All Teams, configured Teams with Sprint work or awaited Stories), or the pointed and selected
Teams until the Sprint's work is known. Every card shows its Team's stored number where Jira has none, read once per scope
(one Team from its document, more Teams through one batch read); a zero-effort Team with capacity counts in the totals and
the project split, and the compact "Capacity:" total judges only Teams with effort or a capacity value. A Team whose name
is unresolved (its id) or contains a comma keeps its card but shows no stored number and is not sent to the Jira read, and
a Team never borrows another configured Team's ticket or stored number by name containment. Each card edits its own
Team's stored number with its own pencil, for its own Team and Sprint only; saves of different Teams run independently (at
most 4 at once) and a scope change never retargets one. A failed save shows ↻ Retry and × Discard changes (that Team's
stored-number draft only) in the card's hover rail, its message in the rail's readout and "N Team save(s) failed: hover a card to
retry" (or "Saving N Team(s)…") in the overview's state note. When the workspace holds `MAX_DOCUMENTS_PER_WORKSPACE` (2,000)
documents, a Team's first save is that Team's visible rejection, "Team capacity not saved: the server refused it." (D4).
Between users the last write wins: the stored number carries no revision precondition, so the later save replaces an
earlier one without a conflict, and the other member sees it on the next read.

**Limitations.** Sprint id orders inheritance (as for review views). Account ids and the stored team number's source
are not verified against Jira. Undo covers the strip's Team only (see Undo above); a card edit of another Team has no Undo.
Concurrent edits of one Team's number by two users resolve last-write-wins with no warning. With All Teams, a Team whose
Sprint Stories are all unpointed joins the cards only once the Sprint's work is known, so the Jira capacity read runs
twice on load (the pointed Teams, then every card Team); when every Team is pointed it runs once.
