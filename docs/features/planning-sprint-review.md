# Planning Sprint review

Planning defaults to Table when no valid layout preference is saved. An explicit
List choice remains remembered. The icon beside Open selected stories in Jira switches
between List and a compact spreadsheet, including when no Stories are selected.
The layout is a private browser presentation preference. The shared header,
Sprint/Teams controls and filters retain their list width. Every Table scope,
including multiple Teams, starts with the sticky Planning overview reduced to
one desktop row of capacity and Product/Tech graph bars. Hide panel returns
expanded details to that same graph row. Show panel restores selection
actions and per-Team capacity details without changing selection or fetching
new datasets. List retains the full Planning overview. On narrow screens, the
graphs stack to keep their values readable. Capacity errors remain visible in
the compact row. Only the spreadsheet region widens; extra columns scroll inside it.
Summary titles use the full cell width and wrap naturally in both read-only and
editable profiles. Clicking an editable title opens a wrapping editor inside its
cell; Enter or leaving the cell saves through Jira, and Escape cancels. Validation
and recovery remain inline, without a Summary popup or large Save/Cancel controls.
Status cells reuse the shared status chips in both read-only and editable profiles.
Column creation aligns its compact input, type selector and actions on one baseline.
Table headings and drag handles have no inherited button margins; custom inputs
use compact 100px columns. Longer headings or values can widen a column rather
than clipping, and Summary retains its wrapping width.
In Table view, Filters precedes the capacity graphs in a shared sticky stack below
the compact header. The first document scroll brings that stack into its sticky
position. The shared `EngFilterControls` module occupies the second dashboard controls row,
before Catch Up alerts and Planning capacity content; List also uses Filters-first
ordering.
Numeric headings, cells, editors and totals align right; text aligns left.
The scrollable spreadsheet keeps column headings and totals visible at its top and bottom.
Stories expose a linked parent Epic column. Assignee and Project Track are visible
columns, without a Fields menu. Component, Project and Capacity are optional and
hidden by default; use Columns to show or hide them. Saved visibility choices
take precedence over defaults, including an explicitly saved all-visible layout. Story Points have a visible
input and Save/Cancel controls after opening the existing signed-in Jira editor;
Epic Sprint SP remains a computed total. Story Capacity and Project Track
reflect the parent Epic; capacity changes use the existing shared Department setting.
Capacity chips retain a pale green Included or light gray Excluded background
on hover and keyboard focus, with a visible focus outline.

Epics show scoped child Story Points and contributing Teams. Story mode includes
orphans and awaiting-creation placeholders, one per uncovered Team. Readiness-only
Epics remain in the Epic table, marked with their uncreated Story count. Each
placeholder shows its Team and links its parent Epic; it has no Jira key or
Story Points and cannot be selected or edited. Table placeholders remain visible
through Story status/priority filters, while Department, Team, project, Project
Track and search scope still apply. List filtering retains its existing behavior. Selection reuses Planning
Story selection and Undo; Epic checkboxes affect visible real child Stories.
Synthetic rows cannot edit Jira or store custom values. Team and Project columns
appear for multiple admitted Teams/projects. List sort/group controls keep their
stored choices and do not change table ordering.

The single-row toolbar contains Epics/Stories, + Column, Columns, Save and an
options button, with matching heights and typography. Use + Column for Number/Text
columns and Columns to manage definitions. Refresh, discard, clear sorting and
short usage help live in the options popup; only an Unsaved indicator appears
beside Save when there are local changes.
Both open anchored popups above the table without shifting the page layout.
Escape or an outside click dismisses them; the popups stay within the viewport.
Drag column handles to place Jira and custom columns in any order after the pinned
Key and Summary columns. Arrow keys on a focused handle and the custom-column
move buttons provide keyboard movement. Columns controls optional visibility.
Order and visibility are shared per workspace + Sprint, separately for Epics and
Stories, and remain drafts until Save review. Reload/Refresh loads the saved view;
concurrent layout saves use the same schema revision conflict protection. Save
accepts layout changes only when its response confirms their exact order and
visibility; missing or mismatched confirmation preserves the draft and requires
explicit refresh/reapply recovery.
Schema and values are shared within workspace + Sprint, independent of Department
and Team filters. Epic and Story cells are separate and use immutable Jira IDs.
Numbers support three decimal places and exact totals across visible rows;
blank values are distinct from zero. Shift-click headings adds up to five ordered
sort criteria. Custom changes remain local until Save review.

Dirty drafts survive filter, Department, mode and layout changes. Sprint changes
require Save, Discard or Stay. Browser exit uses the browser's unsaved-change
prompt. Refresh preserves drafts; conflicts offer deliberate Load current or
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
