# Planning Sprint review

Planning defaults to Table when no valid layout preference is saved. An explicit
List choice remains remembered. The icon beside Open selected stories in Jira switches
between List and a compact spreadsheet, including when no Stories are selected.
The layout is a private browser presentation preference. The shared header,
Sprint/Teams controls and filters retain their list width. Every Table scope,
including multiple Teams, starts with the sticky Planning overview reduced to
one desktop row of capacity and Product/Tech graph bars. Graph labels and the dashed target marker stay visible when any Product, Tech or Ad Hoc segment is hovered. Product/Tech fills use pale tints with dark labels; Ad Hoc retains its striped Product tint. Collapse panel returns
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
Epic Sprint SP remains a computed total. Story Points inputs fit the same compact row height as Epic rows, including while focused; expanding an in-cell Summary editor may still grow its row. Story Capacity and Project Track
reflect the parent Epic; capacity changes use the existing shared Department setting.
Capacity chips keep their pale green Included or light gray Excluded resting
treatment on hover, adding an inset blue ring that remains visible within the cell.
Keyboard focus keeps its existing light fill and visible outline. Disabled chips
retain their resting appearance.

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
Track and search scope still apply. List filtering retains its existing behavior. Selection reuses Planning
Story selection and Undo; Epic checkboxes affect visible real child Stories.
Synthetic rows cannot edit Jira or store custom values. Team and Project columns
appear for multiple admitted Teams/projects. Sort epics and Group by Initiative are not
rendered in Table view (they never changed table ordering); List and Catch Up keep them and
their stored choices.

Priority and status edits made in the Table settle locally (see Planning edits in
[eng-workflows](eng-workflows.md)): a pending edit does not move its row, a confirmed one re-sorts
the rows by the active sort, sliding the edited row and the rows it passes by their cells, and blinks
the edited row. The reveal scrolls the page only when the row would otherwise be off-screen, and a
focused review cell holds its row so neither the slide nor a filter can unmount the input.

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

## Assignee capacity strip (#323)

With exactly one Team selected in the Table layout, Planning shows a collapsible in-flow strip, "Assignee Capacity (Story
Points)", below the controls stack (portaled into `#planning-assignee-capacity-host`, outside the pinned overview). Two Teams,
All Teams and the List layout keep the Selected SP by Team cards unchanged. The expanded state is a private browser preference
(`jira_dashboard_planning_assignee_capacity_v1`). All numbers are Story Points.

**Columns.** Assignee, Planned capacity, Planned effort, Vacations, Notes, with a Totals row summing the three numeric
columns. Planned capacity, Vacations and Notes are typed in (0 to 10,000 with at most two decimals; Notes up to 500
characters, single line); blank means unset. Vacations are informational and never subtracted from Planned capacity. Planned
effort sums the checked Stories of the Team from the same selection the capacity bar uses (its total is the bar's Selected),
so search, Team, Project and Project Track filters narrow it and a muted line says how many selected Stories filters hide.
There is no Total effort column. The over/under cue uses the existing capacity thresholds (over above 120%, under below 90%)
on rows with Planned capacity and on the Totals row, which compares the displayed Planned effort total (including Unassigned)
with the Planned capacity sum. Sums run in integer hundredths. The table fills the strip's width: Assignee takes a quarter,
the numeric columns are compact and right-aligned, Notes takes the rest; long names and notes stay on one line with an
ellipsis and show in full on hover or focus. Below 680px the table scrolls inside the strip, never the page.

**Avatars.** Each person's name follows the issue card's 14px person slot (`PersonAvatar` in `task-assignee-icon`): the
photo of that person from a loaded Story's assignee, keyed by account id, else the person glyph. Nothing is requested or stored
for it. A person added from the search this page session shows the photo the search returned (an allowlisted Atlassian
avatar URL, kept in memory by account id until reload); otherwise a person with no loaded Story shows the glyph. The
Unassigned row has the same slot empty, so its name lines up with the person names.

**Unassigned.** Stories with no assignee account id get their own highlighted row, first, shown only while such non-Killed
Stories of the Team exist; it shows Planned effort only and is neither editable nor removable.

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
Sprint and Team coalesces commits within about 200 ms into one PATCH, keeps one request in flight and reuses the CSRF token.
An unconfirmed write is read back and only the differing fields are resent (last write wins per field, so retries are
idempotent). A failed save shows "Not saved" with Retry and Discard changes, in the table and in the collapsed header; a
change the server refuses waits for Retry or Discard so it cannot fail later batches. Changing Team or Sprint sends the old
scope's commits in the background; a scope left with a failed save keeps its drafts for the page session (the last five
scopes) and shows Not saved with Retry on return. A `401` keeps the drafts behind the global sign-in lock. Without database
storage or save rights the read reports `capabilities` and the strip is read-only (no Remove, Restore or Add assignee) or
hidden.

**Undo.** The last 20 edits of the shown Sprint and Team (Capacity, Vacations, Notes, Remove, Restore, Add assignee and the
stored team number, which shares the queue) can be undone with the Undo button at the right end of the expanded strip header
(beside the save status, a sibling of the header toggle; the collapsed strip shows no Undo), or with Cmd/Ctrl+Z while focus
is in the table and no cell holds an edit of its own (that cell keeps the input's native undo; key auto-repeat is ignored). An
undo re-commits the previous full row through the same queue, so it is an ordinary save; one undone before its edit was sent
sends nothing. Undoing an Add assignee removes the person again (there is no delete). Undoing the first edit of an inherited
Sprint keeps the Sprint's own copy with the inherited values, and a muted line says so. The stack is cleared on a Team or
Sprint change, on any failed or refused save, Retry or Discard, on a re-read that brings a different document, and on a new
auth session. Read-only strips show no Undo.

**Underbar.** The pinned amber capacity bar carries a thin strip at the bottom of its existing track, adding no height: the
Selected split by person, one segment per person with Planned effort above 0 (width by that person's Selected Story Points)
plus a trailing Unassigned segment for the Selected Stories with no assignee. Its total is the bar's Selected, so it lies
exactly under the fill on the bar's own scale (the larger of capacity and Selected, times 1.15; the team-card bar uses the
same function with 1.3) and the Team Cap marker lines up; over capacity the bar's own over-capacity zone shows what lies
beyond Team Cap, and with nothing selected there is no strip. The whole track is hoverable and tappable: the segment under
the pointer shows its readout (name, Selected, then Planned capacity and the person's share of Selected; "Unassigned
(effort)" with Selected and its share for the Unassigned segment) under a "Selected N tasks · X SP" header that replaces the
fill tooltip, and the marker lines keep their own tooltips. Table rows of people with a segment are tinted with the segment
colour; others keep the normal row surface.

**Team capacity (not in Jira).** The document also stores one team number per Sprint and Team. It is editable from the team
card's own pencil only when the Jira capacity read settled for this scope and found no ticket for the Team (not loading,
failed, stale or ambiguous, and only with a Capacity Project configured); a matched ticket with a blank value also shows
the stored number as a fallback while its pencil keeps editing Jira. The stored number enters the same capacity maths as a
Jira value (multiplier and excluded capacity apply), so the amber bar and the underbar appear for a Team without a ticket.
Jira wins on screen whenever it has a value. A Sprint without its own document shows the nearest earlier number gray
(source `inherited`). After a user-initiated capacity read, a Jira value that differs is mirrored silently into an existing
own document (database only; never into a typed number, never while the queue is busy, failures dropped). A typed number
that differs from the ticket shows a banner above the cards with Write to ticket (opens the existing Jira editor prefilled;
the user saves there), Use ticket value and Not now (hidden per Sprint and Team until either number changes). Nothing is
written to Jira except through that editor's Save; a successful Jira save turns a typed number into the ticket value.

**Add assignee.** Under the table and in the empty state, a person picker searches the active users assignable in the
workspace's selected Product and Tech Jira projects through `POST /api/eng/assignee-capacity/user-options` (the signed-in
user's Jira context; no email shown; each result may carry an allowlisted avatar URL). Picking a person adds a row with a stored name snapshot and no Capacity; picking a
removed person restores them; picking a listed person focuses their row.

**Freshness.** The document is read whenever one Team is selected in Table, expanded or not, cached per Sprint and Team
for the page session. The Planning automatic follow-up and the header Refresh re-read it, never while it loads or holds
unsaved changes; an unchanged document is not republished, a failure keeps the held document, and an automatic height
change of the strip above the viewport keeps the reading position. A new auth session clears the cache and re-reads.

**Limitations.** The stored team number is used only in the Table layout with one Team: List layout and several Teams show
Jira values only. A Team with no pointed Stories has no card, so its stored number can be typed only once it has Stories.
Sprint id orders inheritance (as for review views). Account ids and the stored team number's source are not verified
against Jira. Undo is not built yet.
