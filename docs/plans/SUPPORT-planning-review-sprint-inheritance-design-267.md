# Planning Review Group Columns And Sprint Views Design (#267)

> **Status:** Design revised 2026-10-18 after a five-pass independent validation of the 2026-10-17 rewrite; it supersedes the 2026-10-16 Sprint pin-chain design (both kept in git history). Operator-directed rules are listed under Direction, and the operator's answers of 2026-10-18 are under Resolved Questions. Items marked **Decision (my call)** are the author's recommendation and may be overruled in the `EXEC-*` plan review. All validation findings are applied below. The Story relations section (derived columns) was added after the validation. **This revision has not been re-validated**, and a focused re-check of the write contract, the client state machine, the derived columns and the adoption script is recommended before an `EXEC-*` plan is written. The design is not executable until an `EXEC-*` plan exists. Written from issue #267 and the code on `origin/main` (`cb1b3c4d`). Nothing is implemented. The file name keeps the original issue slug so links stay stable.

## Issue

#267: "inherit planning table view (and epic level custom values) from the current sprint to the future sprint. when during the planning a table was created in the active sprint, inherit it to the following future sprint. when table is modified in the future sprint, keep it as main for the current future sprint."

## Direction (operator, 2026-10-17 and 2026-10-18)

- Custom columns belong to the Department group and are available in every Sprint for that group; they are not Sprint-scoped.
- An Epic is a cross-Sprint entity, so a custom value belongs to the issue and is the same in every Sprint (one value per issue, per group).
- The view (column order and hidden columns) stays per Sprint, is shared across users of the group, and is preserved for earlier Sprints. A Sprint that has not saved a view inherits one; the first change saved in it makes that Sprint's view its own. A user who opens a Sprint sees the view it inherits (the nearest earlier saved view, see View resolution), changes it, saves on top, and everyone sees the result.
- A small dismissible hint shows where an inherited view came from.
- Hide (this Sprint's view, separately for the Epic view and the Story view) and Archive (every Sprint) stay two separate verbs; Archive gets a clear warning.
- Column order is kept, including for columns added later.
- Stories are Sprint entities and Epics are cross-Sprint (2026-10-18). A Story number column that sums is shown on Epic rows as the read-only sum of the Epic's Stories, marked with a superscript "S"; an Epic column is shown on every Story row as the parent Epic's value, read-only, marked with a superscript "E". Never the reverse. Both are automatic, visible by default, and by default the last column of the other view.
- Existing per-Sprint tables should not leave two permanent column sources; every configured Department group gets its own copy of the saved data, rolled out in a quiesced cutover.
- Sprints are ordered by numeric Sprint id, because ids only increase and Sprint names can be anything, not only quarters. Duplicating a group does not copy its review columns. Re-creating a group with a deleted group's id reattaches the old data.

## Current State (verified in code)

- `workspace_sprint_reviews` holds one row per `(workspace_id, sprint_id)` with `columns`, `layouts` and one `schema_revision`; `sprint_review_cells` is keyed `(review_id, issue_id, row_kind, column_id)` (`backend/db/models.py`). Nothing carries a column or a value between Sprints, so a new Sprint starts empty.
- `save_review` calls `_locked_review` unconditionally, which inserts the review row (empty `columns`, default `layouts`) before any validation, so today even an empty or cell-only PATCH creates a row. It then applies `apply_schema` and afterwards `apply_layouts(layouts, columns, changes)`, so a layout is validated against the post-action columns including archived ones. `apply_schema` is strict about column keys (`add` accepts only `id`, `rowKind`, `label`, `type`, `aggregation`, `archived`, `order`) and handles `add`, `rename`, `archive`, `aggregation` and `reorder`; `aggregation` is the per-column "show total". Limits: 30 active columns per row kind, 240 columns in total, 100 changed cells per save, 500 read issues; a cleared cell is a retained row with a `NULL` value (`backend/services/sprint_review.py`).
- Sprint ids are validated as numeric strings of up to 128 digits (`sprint_identity`, `[1-9][0-9]*`) and nothing checks them against the Sprint catalog. The GET route rejects any query string (`if request.args` in `backend/routes/sprint_review_routes.py`) and no route takes a group.
- The Planning hook is mounted with the Sprint but no group, and its `contextKey` has no group (`usePlanningSprintReview` call in `frontend/src/dashboard.jsx`). The header group dropdown calls `setActiveGroupId` directly (`frontend/src/eng/EngControls.jsx`), as do the group-visibility and share-link paths; only Sprint changes go through `planningReviewGuardRef`. `activeGroupId` is seeded from saved preferences before groups load.
- `addColumn` in `PlanningReviewTable.jsx` always emits an `add` action and a `layout` action together, so adding a column also saves the Sprint's layout. `insertColumnId(order, id, afterId)` in `planningReviewTableModel.js` treats `'summary'` as "directly after the pinned columns", `null` or an unknown id as append, and any other id as "after that column"; `buildPlanningReviewColumns` sorts movable columns by their saved `order` index and puts ids missing from it last.
- Department groups live in `workspace_group_configs`, one shared catalog per workspace, read through `current_shared_groups_config` (`backend/services/shared_group_config.py`); group visibility is a private preference in `user_group_preferences`. Group ids are name slugs unique only among current ids (`buildGroupId` in `frontend/src/settings/groupConfigUtils.js`): renaming keeps the id, duplicating gets a new slug, and creating a group with the name of a deleted one reuses its id.
- Private browser preferences are one blob that `saveUiPrefs` overwrites whole from a fixed object built in `dashboard.jsx`, so a key written elsewhere is lost on the next write (`frontend/src/dashboardRuntime.js`). Alert dismissals are in-memory state.
- `frontend/src/dashboard.jsx` is exactly at its extraction-lint line ceiling (7554 of 7554 in `scripts/extraction_lint/owner_budgets.json`).
- The current Sprint catalog admits only quarter names (`_format_quarter_sprint`, `^\d{4}Q[1-4]$`, `backend/services/sprints.py`); the design deliberately does not depend on names.
- Planning is disabled for closed Sprints (`EngModeControl`, `isCompletedSprintSelected`; the share resolver mirrors it), so only active and future Sprints can change a view.
- The dashboard hands the Planning hook the Epic rows and the Story rows together (`planningReviewRows` in `dashboard.jsx`), so values for both kinds are loaded whichever mode is shown. Epic rows already sum their in-scope Stories' points (`buildPlanningReviewRows`, labelled "Sprint SP" in the Epic view), where the Stories are those visible in the current Sprint scope and filters. Story rows carry `epicKey`, and the matching Epic row is in the same set. Custom columns are shown only in their own mode; `apply_layouts` allows only built-in ids plus custom ids of the same row kind; `planningReviewTotals` sums custom number columns over the displayed rows and skips synthetic rows; `save_review` rejects a cell whose column row kind differs from the cell's row kind; and no superscript marker exists anywhere in the frontend.
- The controller applies a save response as `data.columns || state.columns`, flags a stale schema when `schema.schemaRevision !== state.schemaRevision`, holds `saved*` values while dirty and restores from `current*` in `discard`, `reapply` and `loadCurrent`, and its API layer keeps only `schemaConflict` and `cellConflicts` from a 409 body (`usePlanningSprintReview.js`, `frontend/src/api/sprintReviewApi.js`).
- Existing hint and notice text is `.planning-review-guidance`; the Archive confirmation currently reads "It leaves this table for everyone" (`PlanningReviewColumnMenu.jsx`) and the Add popover note reads "Shared with everyone reviewing this Sprint." (`PlanningReviewTable.jsx`).

## Goals

- Columns and values added for a Department group appear in every Sprint for that group, and a value entered in any Sprint is the issue's value everywhere in that group.
- A Sprint with no saved view shows the nearest earlier Sprint's saved view; the first layout saved in it gives it its own view; earlier Sprints' views never change because of a later Sprint.
- A column added anywhere keeps a sensible position in every saved view.
- A Story number column rolls up into the Epic rows and an Epic column is inherited by its Stories, both read-only and without storing anything.
- No extra Jira requests, no catalog read, and a small, stated, bounded database cost.

## Non-Goals

- Copying columns or values between groups; duplicating a group does not copy its columns. Purging a group's review data when the group is deleted.
- Matching renamed, cloned or moved Epics by anything other than the immutable Jira issue id.
- Per-user views or per-user columns; any change to Jira-owned fields.
- Rewriting existing per-Sprint review rows in the application; a reset, choose-source or delete-view action for views.
- Cross-Sprint Epic totals (they would need Stories outside the table's scope); a Story overriding an inherited Epic value; storing any derived value.

## Anti-Goals

- Saving a view in one Sprint must never change another Sprint's saved view or the view an earlier Sprint displays.
- A read must never create or modify rows; a PATCH without changes must not create a row or take a lock.
- Archive must never be reachable without a warning that it affects every Sprint for the group.
- Application code never copies or shares a column between groups; the one-time adoption copies legacy columns into each group as independent data, and a group re-created with a deleted group's id is the same group id.
- A draft built for one group must never be saved under another.

## Design

### What lives where

| Thing | Scope | Shared with | Stored in |
| --- | --- | --- | --- |
| Column definitions (label, type, aggregation, archived, default order, creation anchor) | Workspace + Department group | Every authenticated user | New group schema table |
| Cell values | Workspace + group + issue | Every authenticated user, subject to per-issue Jira authorization | New group cells table |
| Views (column `order`, `hidden`; per row kind) | Workspace + group + Sprint | Every authenticated user | New Sprint view table |
| Totals (`aggregation`) | Column property, so group-wide | Same as columns | Group schema table |
| Derived columns (Story sum on Epic rows, Epic value on Story rows) | Computed in the client from loaded cells | Not stored | Nothing |
| Hint dismissal | One browser | Nobody | Dashboard preference state |

Column ids are the lineage: a column keeps one immutable UUID, and a saved view refers to it by id. The group id is the storage key and is stable on rename.

### Storage

Three new tables, one Alembic revision after `20261001_0018_review_layouts.py` (verified head). Names are provisional until the `EXEC-*` plan; types follow the existing review models.

- **Group schema** (`workspace_group_review_schemas`): `id` Uuid primary key; `workspace_id` FK to `workspaces` with `ON DELETE CASCADE`; `group_id` `String(128)`; `schema_revision` (check `>= 0`); `columns` JSON; unique `(workspace_id, group_id)`.
- **Group cells** (`group_review_cells`): `schema_id` FK to the group schema row with `ON DELETE CASCADE`; `issue_id`, `row_kind` (check `epic` or `story`), `column_id`, `value` (`String(500)`, nullable), `revision` (check `>= 1`); unique `(schema_id, issue_id, row_kind, column_id)`. The same cell shape as today, one value per issue.
- **Sprint view** (`group_sprint_review_views`): `workspace_id` FK with `ON DELETE CASCADE`; `group_id` `String(128)`; `sprint_id` `String(128)`; `sprint_order` `String(128)` (the decimal id left-padded with zeros to 128 characters, so string order equals numeric order with no cast); `layouts` JSON; `view_revision` (check `>= 1`, so 0 always means "no row"); unique `(workspace_id, group_id, sprint_id)` and an index on `(workspace_id, group_id, sprint_order)`.

The existing `workspace_sprint_reviews` and `sprint_review_cells` stay in the database untouched and are no longer read by the application after cutover. Downgrade drops only the three new tables, and with them everything entered since cutover. The parity tests must assert the foreign keys' `ON DELETE`, the checks, nullability and indexes, not only column names and unique constraints.

### View resolution (server only)

For group G and Sprint S:

1. S's own view row, if it exists: use it; `inheritedFrom` is `null`.
2. Otherwise the view row with the greatest `sprint_order` below S's among G's rows, fetched with `ORDER BY sprint_order DESC LIMIT 1`: use it; `inheritedFrom` is `{sprintId, viewRevision}`.
3. Otherwise no view: the response omits `layouts` keys and the table model's default arrangement applies.

Resolution is two one-row indexed reads and never writes. Ties cannot occur: the numeric-id regex forbids leading zeros and `(workspace_id, group_id, sprint_id)` is unique. A saved view is a row with at least one row kind; a row kind absent from `layouts` is absent, never stored as `{order:[],hidden:[]}`, because the table reads `hidden ?? DEFAULT_REVIEW_HIDDEN_COLUMNS` and empty arrays would unhide Component, Project, Capacity and Project Track. Sprint ids are not checked against the catalog, so a group is capped at a fixed number of view rows (the `EXEC-*` plan pins it; recommended 500) and a save beyond it returns `400 review_view_limit`.

**Decision (accepted 2026-10-18, inferred from the operator's answer on numeric ordering; a one-function change if reversed): an unsaved Sprint shows the nearest earlier saved view, not the latest saved view overall.** The latest-saved rule would change an earlier Sprint's displayed view: with Sprint A active and unsaved, a layout saved in Sprint B would make A suddenly show B's view, contradicting "previous views are preserved".

**Decision (confirmed 2026-10-18): order Sprints by numeric Sprint id**, with no catalog read. Ids only increase and Sprint names are not limited to quarters, so the rule needs no naming convention. Known limits recorded here, not fixed: a Sprint created out of chronological order can inherit a later Sprint's view; the catalog's one-entry-per-name winner can change a quarter's id (future to active) and orphan its saved view, as today; there is no reset, choose-source or delete-view, so correcting a wrong inheritance means rearranging and saving, which then freezes that Sprint's view. The hint makes the source visible.

### Column order

- A saved view stores the full order of built-in and custom columns, as today.
- `add` carries an optional `after` inside its `column` object (added to the strict key list): `null` means append, `'summary'` means directly after the pinned columns (what the boundary "+" and `insertColumnId` already use), or an id. A valid id is a same-kind built-in id or a same-kind group column id, archived ones included, including a column added earlier in the same request; anything else is rejected, and the stored string is bounded.
- Placement is computed by the client in `buildPlanningReviewColumns`, not stored: start from the view's saved `order` (empty for the default arrangement) plus any built-ins missing from it in their default sequence; then fold the viewed row kind's own custom columns missing from that base, archived ones included so chains resolve, in creation order (the `order` field; the UI never emits `reorder`), each through `insertColumnId(base, id, after)`. A column whose anchor is absent lands at the end. Hidden is unaffected, and a new column is visible unless the view lists it as hidden.
- Adding a column in the UI also saves a layout in the creating Sprint (existing behavior), so that Sprint gets its own view with the column at the chosen position. This matches the issue: a future Sprint that is edited becomes the main one. Other Sprints' saved views lack the column and place it by the fold. The group's default order among custom columns (`order`, `reorder`) is unchanged.
- Derived columns (see Story relations) do not use the anchor: absent from a view's saved `order`, they go last in creation order and are visible unless that view hides them.
- **Decision (my call, confirm):** this is the author's reading of "keep the order of the columns".

### Story relations (derived columns)

Stories belong to Sprints and Epics span them, so the two kinds are related by two read-only display rules and nothing else. A derived column is computed in the client from cells that are already loaded; it adds no storage, no column kind, no endpoint and no read.

- **Up (Story to Epic).** A Story-kind number column with `aggregation: 'sum'` also appears in the Epic view (number columns default to a sum, so a Story number column rolls up unless its total is switched off). An Epic row shows the sum of that column over the Epic's Stories in the current scope (the Sprint and the current filters, the same Stories that feed "Sprint SP"). Story text columns and Story number columns without a sum do not appear in the Epic view.
- **Down (Epic to Story).** Every Epic-kind column, number or text, also appears in the Story view. A Story row shows the parent Epic's value, found by `epicKey` among the loaded Epic rows. It is repeated per Story and never summed, so the Story view's totals row has no total for it.
- **Never reversed.** Nothing from the Epic is divided among Stories and no Story value is written into an Epic column. A derived cell is never editable and never written; the server already rejects a cell whose column row kind differs from the cell's row kind.
- **Marker.** The header shows a superscript after the column name: "S" on a Story column in the Epic view, "E" on an Epic column in the Story view. The header's accessible name adds "Story property" or "Epic property", and a hover or focus readout, using the existing in-app readout pattern behind `EpicHeaderValueReadout` and never a native `title`, says "Story property, summed from this Epic's Stories in this Sprint" or "Epic property, inherited from the parent Epic". The frontend has no superscript marker today, so this is a new element kind to register in `docs/design-system.md` and the ratchets; it reuses the heading's typography.
- **Placement and visibility.** Derived columns are automatic and visible by default, and by default the last columns of the other view, in creation order; they do not use the `after` anchor. A saved view's `order` can place them anywhere, so `apply_layouts` allows the custom ids of both row kinds in either kind's layout. Hide is stored per row kind in the Sprint's view (`layouts[kind].hidden`), so hiding a derived column in the Epic view leaves the Story view unchanged and vice versa. A derived column's menu offers Hide and the drag grip only; rename, archive and the total belong to the source column in its own view. Archiving the source removes its derived column everywhere, and derived columns do not count toward the 30 active.
- **Totals and sorting.** The Epic view's total for a rolled-up column is the sum of the Epic rows' values, which equals the in-scope Story total because the "No Epic" group row shows the sum of its own Stories (the totals function counts that synthetic row for rolled-up columns only). Sorting uses the derived value, with empties last as for other columns.
- **Edge cases.** A Story with no Epic shows blank for an Epic-derived column; an "awaiting creation" placeholder row shows blank; an Epic with no in-scope Stories shows blank, not 0; a Story with a blank value counts as 0 in a sum; a derived cell shows the source cell's effective value, so an unsaved edit appears in both views. A Story carried over to the next Sprint keeps its value (one value per issue) and counts in each Sprint's Epic sum where it is in scope.
- **Sprint semantics.** An Epic's sum differs between Sprints and with the filters, exactly as Sprint SP does; there is no cross-Sprint Epic total.
- **Code touched.** `buildPlanningReviewColumns` flags derived columns from both kinds' definitions and places them last; `reviewValue`, `sortPlanningReviewRows` and `planningReviewTotals` handle them; `CustomCell` renders a read-only variant; the heading renders the marker; `PlanningReviewColumnMenu` limits a derived column to Hide; `apply_layouts` allows custom ids of both kinds. Both row sets are already loaded and authorized, so statement counts and Jira authorization passes are unchanged.

### Read contract

- `GET /api/eng/sprints/<sprint_id>/review?groupId=<id>` accepts exactly one `groupId` and nothing else (a duplicate, whitespace-padded or extra argument is a 400) and returns `{schemaVersion, sprintId, groupId, schemaRevision, viewRevision, columns, layouts, inheritedFrom, capabilities}`. `schemaRevision` is the group's column revision; `viewRevision` is the Sprint's own view revision (0 when it has none). An unknown group returns the empty schema.
- `POST …/review/values/read` takes `groupId` in the body (a query string is rejected) and returns the cells of the group's columns for the requested issues, whichever Sprint is in the path; `unavailableIssueIds` and the per-issue `authorize_issues` pass are unchanged, so access still comes from the signed-in user's Jira visibility.
- `groupId` is a string of 1 to 128 characters, equal to its stripped form, with no control characters. A group whose configured id is longer cannot use review columns (documented limit).

### Write contract

`PATCH …/review` accepts `groupId` (required), `baseSchemaRevision`, `baseViewRevision` (optional, default 0, checked only with a layout action), `schemaChanges` and `cellChanges`; a query string is rejected.

- Error precedence: request shape (400) first, then group membership (`400 review_group_unknown`, read through `current_shared_groups_config`), then Jira authorization (403/503), then the database transaction. An empty request (no `schemaChanges` and no `cellChanges`) returns the resolved schema, creates no row and takes no lock.
- Every writer, including layout-only saves and the adoption script, takes the group schema row first (insert-do-nothing, then `FOR UPDATE`); only a request with a layout action then takes the Sprint's view row the same way. This avoids an `IntegrityError` from a racing plain insert, which the routes map to 503. The lock now serializes saves for one group across Sprints and users; it is short because Jira authorization runs before the transaction.
- Column actions apply sequentially first and require `baseSchemaRevision` to equal the group's `schema_revision`; one bump per request. Layout actions validate against the post-action columns, archived included, so the normal Add column plus layout save in one request succeeds.
- Layout actions require `baseViewRevision` to equal the Sprint's own view revision (0 when it has none). The server stores exactly the layout actions in the request, merged over the Sprint's own row if one exists, and copies nothing from another Sprint. When the Sprint has no view yet, the client adds a `layout` action for every row kind its displayed view holds, so a first save keeps what the user saw and a concurrent save in another Sprint cannot slip into the untouched row kind.
- Cell-only and column-only requests never create or touch a view row. Cell changes validate against the group's columns (existence, archived, row kind, type) and keep today's per-cell `baseRevision` semantics, touching neither revision. Because values are per issue, two users editing the same Epic's value from different Sprints conflict like two users in one Sprint do today.
- A stale `baseSchemaRevision` returns `409 review_conflict` with `schemaConflict: true`; a stale `baseViewRevision` returns it with `viewConflict: true`; both can be set. The second 409 path (a cell against an archived or missing column) uses the same body. Every 200 and 409 body returns the resolved `columns`, `layouts`, `schemaRevision`, `viewRevision` and `inheritedFrom` (`null` after a layout save), so the controller's layout confirmation passes and a 409 can refresh state. `sprintReviewApi.js` forwards `viewConflict` and the controller treats either flag as "the shared table changed, draft preserved".
- **Decision (my call):** carry the group as a query argument on GET and a body key on POST and PATCH, on the existing routes, so policies, CSRF and `X-Requested-With` guards stay where they are.

### Client

- The hook is active only when a configured group has resolved: `activeGroup?.id` from the loaded groups, not the stored `activeGroupId` alone, and groups are not loading. The Planning scope already requires a resolved group, so no new no-group copy is added. The literal `active:` expression pinned in `tests/test_share_view_source_guards.js` changes with it.
- The controller's scope identity includes the group; `setScope` resets drafts, `loadedIds` and the review state on a group change, and `deferredRead` gains `!groupChanged`. A draft is bound to the group it was loaded under, and `save()` sends that captured group. The header group dropdown goes through `guardScopeChange` like a Sprint change (save, discard or stay), and its dialog copy says "Sprint or group"; forced changes (group deleted, auth resume, onboarding) discard like a context change.
- `viewRevision` and `inheritedFrom` get the same saved/current handling as `layouts`: `saved*` held while dirty, `current*` updated by refresh, restored by `discard`, `reapply` and `loadCurrent`, and a save response sets both from the response (`data.inheritedFrom ?? null`, not the `||state` idiom). The refresh staleness check also compares `viewRevision`, so a view saved by someone else under a dirty draft raises the existing conflict. Drift of the inherited source under a dirty draft is not a conflict, because a first save sends full layouts. A missing `viewRevision` or `inheritedFrom` reads as 0 and `null`. A column edit by anyone in any Sprint changes the group's `schemaRevision`, so dirty column drafts elsewhere in the group conflict.
- **Hint.** When `inheritedFrom` is non-null and no layout draft is displayed, the table shows one line, "Showing the layout last saved in <Sprint name>." (name from the client's Sprint list, falling back to "an earlier Sprint"), with a small dismiss `IconButton` in a wrapper row (a 24px button cannot sit in a `<p>`). The wrapper class and the dismiss control are registered in `docs/design-system.md` (the map has no dismiss kind; precedents are `task-remove alert-remove` and the `secondary compact` Dismiss, and the ratchet forbids new `-button`/`-chip` class names without an allowlist entry). It reuses `.planning-review-guidance` text styling and works by tap. There is no second instructional sentence. This replaces the earlier "no marker" decision at the operator's request.
- **Dismissal** is dashboard state inside the existing preferences object and its dependency list (precedent `teamsEffortExpanded`), passed to the table as props, so `saveUiPrefs` does not erase it. It is a bounded map keyed by group and Sprint and holding the source Sprint id and the source's `viewRevision`, so the hint returns once if the source Sprint is re-saved. Two tabs overwrite each other's preferences, as today. **Decision (my call):** browser state rather than `user_group_preferences`, which would need a migration for a convenience.
- **Archive and Hide.** The Archive confirmation names the group and every Sprint: "Archive "<label>"? It leaves this table in every Sprint for <group name> and cannot be restored here." The group name is passed from the dashboard through the table, its two header renders (real and docked) and the column menu, with a fallback of "this group". Hide stays a view-level action with no added hint text, because the column menu carries no usage text by project rule. **Decision (my call):** the Add popover note becomes "Shared with everyone in this Department group."; tests asserting the old copy change with it.
- A `400 review_group_unknown` shows "This Department group is no longer configured." with the draft kept and no retry loop.
- Automatic refresh of a clean table can change values, columns or the inherited view when someone else saves; that already holds for other users' edits, and the hint makes an inherited view visible. Refresh stays held while dirty, saving, in conflict or pending.
- Shared links (#194): the review stays inactive under `shareViewHold` until the link's group and Sprint are applied, so no codec change is needed; a test asserts the link's `groupId` on the review GET.

### Existing per-Sprint tables

The shipped table stores columns, layouts and values per `(workspace, Sprint)` with no group. Showing them next to group columns would leave two permanent column sources.

**Decision (confirmed 2026-10-18): a one-time adoption script copies the saved data into every configured Department group, run in a quiesced cutover, and the legacy tables are then retired from reading.** The operator's answers are that every configured group gets its own saved data and that the rollout is quiesced.

Script conventions follow `scripts/promote_legacy_shared_admin_config.py`: required `--workspace-id`; dry run by default; `--apply` requires `--expected-sha256` from the dry run, with a digest over the sorted configured group-id set and the legacy data, so a group added after the dry run makes `--apply` refuse and a second `--apply` is a proven no-op that writes zero rows and changes no revision. It reads groups through `current_shared_groups_config`, validates ids with the route's validator (strip and shape), fails loudly on zero groups, reuses `apply_schema`, `apply_layouts` and `MAX_ACTIVE_COLUMNS`, runs a physical-table preflight, and has its own test file. Rules, for each configured group and each legacy Sprint table, processed in ascending numeric Sprint id and then list position:

- **Columns:** a legacy column id already present in the group's schema (any state) is the adopted column and is skipped; otherwise it merges into an active group column with the same `(row kind, label, type)` (label compared after strip and casefold), otherwise it is added with its own id. A merged column keeps the id and label of the earliest column and the `aggregation` of the latest; cells and layouts of the others are remapped to that id. Ids are unique per group schema, so the same id can appear in several groups. Archived legacy columns are not adopted. Beyond 30 active columns per row kind the script keeps the 30 with the highest Sprint id, does not adopt the rest and lists them by column id in the report; it does not abort.
- **Cells:** each legacy cell moves onto its merged column per issue with `revision` 1; the highest Sprint id wins a conflict and a `NULL` clear counts as a value, so a later clear wins. An existing group cell is never overwritten and no cell is written onto an archived group column.
- **Views:** a view row is written only for a legacy layout that holds at least one row kind, with only the kinds present, column ids remapped and unadopted ids dropped, duplicates collapsed, and `view_revision` 1. Legacy rows with empty layouts create no view row, so those Sprints still inherit.
- **Writes:** a read-only precheck of every group, then one transaction per group that takes the same schema-row fence as `save_review` and rechecks the limit under the lock; `schema_revision` bumps only when something changed; inserts are chunked for SQLite and PostgreSQL parameter limits.
- **Hygiene:** the report prints counts and column or Sprint ids only, never labels, values or issue ids; non-numeric legacy Sprint ids are skipped and counted; test fixtures are synthetic; legacy rows are never modified or deleted.

**Cutover runbook** (precedent: migration `20260827_0008`, writers quiesced after a backup): back up the database, stop or scale the old replicas to zero, run `alembic upgrade`, run the script dry run and then `--apply` with its digest, start the new app. The script runs from a checkout or ops job, not the image, because the Dockerfile copies only two scripts. Rollback is an app rollback plus `alembic downgrade`, which drops the new tables and everything entered after cutover; adopted columns are identifiable (their id equals the legacy id), adopted cells are not.

## Performance

No Jira request, no catalog read and no write on read. Statements per call (upper bounds the `EXEC-*` plan must measure and pin with SQLAlchemy's `before_cursor_execute` event):

| Call | Today | New |
| --- | --- | --- |
| GET schema | 1 (the review row) | up to 3 (group schema row, own view row, nearest earlier view row) |
| Values read, per batch | 2 (row lookup, cells) | 2 (schema row, cells) |
| PATCH | row insert and lock, cells, upserts | + group configuration read before Jira authorization, + group schema insert and lock, + view insert and lock only with a layout action, + the view resolution reads for the response |

The schema GET fires when the review activates, before rows load; only values reads wait for rows. A cell-only PATCH reads the whole group configuration payload to validate `groupId`.

## Constraints Inherited From Existing Contracts

- Workspace isolation: every query filters by `context.workspace_id`, and group-scoped queries also by group id; cells are reached only through the group schema row. Review code never reads or writes group-configuration or preference rows beyond the read-only `groupId` validation, and a group hidden by a user's visibility preference stays fully readable and writable.
- DB/OAuth only: `capabilities()` gating is unchanged. `PATCH` and values-read keep `user_write` (token-bound CSRF plus `X-Requested-With`); GET keeps `authenticated_read`.
- Ownership: update `backend/security/CONFIGURATION_OWNERSHIP.md`: the matrix row (it says "Shared per workspace + Sprint … Team/Department are filters, never storage keys"), the ENG Sprint Reviews section (the fence, "GET returns schema only", the bounds, and that `groupId` is a selector validated against the shared catalog, never authority) and the closing layout paragraph. Department group becomes a storage key.
- Bounds: the existing 30 active and 240 total column limits now accumulate across every Sprint for a group; Archive frees active slots, archived definitions still count toward 240, and there is no purge action, so a group at 240 is a permanent dead end that this design accepts and the limit message must say is per group.
- Extraction lint: `dashboard.jsx` is at its ceiling, so its edits are net zero lines or `scripts/extraction_lint/owner_budgets.json` is re-synced (the digest is whole-file); `EngControls.jsx` is also a registered module whose budget the `EXEC-*` plan must check.
- Playwright route stubs use `**/api/eng/sprints/*/review`, which does not match a URL with a query string; they become `**/review*` or regex.
- Shared links (#194): no review identifier is added to the codec.
- Migration: one offline-renderable Alembic revision after `20261001_0018_review_layouts.py`; verify head schema parity per the drift rule in `AGENTS.md`; do not call `inspect` without an `as_sql` guard.

## Plan Requirements

### What changes

Three tables and one migration, group-scoped read and write contract, view resolution, anchor placement, controller plumbing for group, view revision and the group-switch guard, the dismissible hint and Archive copy, an adoption script with a cutover runbook, tests, docs.

### Forbidden regressions

- No Jira write path, no change to `authorize_issues`, no change to column ids, cell identity (`issue_id`, `row_kind`, `column_id`) or per-cell `baseRevision` semantics.
- No write on read; no catalog or Jira read from review code.
- The application never modifies or deletes the legacy review rows.
- A derived cell is never editable, never stored and never sent in a write; existing Sprint SP, Story Points and Accepted behavior is unchanged.
- Planning Table chrome, sticky stack and column menus untouched apart from the hint row, the Archive copy, the Add note and the group guard; any new class is registered in `docs/design-system.md` and the ratchets.

### Files allowed to touch (all verified to exist; `Create` marked)

- `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `backend/db/models.py`
- `backend/db/migrations/versions/<next>_group_review_columns.py` (Create), `scripts/<adopt-legacy-sprint-reviews>.py` (Create), `tests/test_<adopt_legacy_sprint_reviews>.py` (Create)
- `frontend/src/eng/usePlanningSprintReview.js`, `frontend/src/api/sprintReviewApi.js`, `frontend/src/eng/PlanningReviewTable.jsx`, `frontend/src/eng/PlanningReviewColumnMenu.jsx`, `frontend/src/eng/planningReviewTableModel.js`, `frontend/src/eng/EngControls.jsx`, `frontend/src/dashboard.jsx` (net zero lines), `frontend/src/dashboardRuntime.js` (only if the preferences shape lives there), `frontend/src/styles/eng/planning-review-table.css`, `scripts/extraction_lint/owner_budgets.json`
- `tests/test_sprint_review.py`, `tests/test_sprint_review_routes.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_planning_sprint_review.js`, `tests/test_sprint_review_api.js`, `tests/test_planning_review_table_model.js`, `tests/test_share_view_source_guards.js`, `tests/test_share_view_planning_rows_seed.js`, `tests/test_analytics_source_guards.js`, `tests/ui/planning_review_integration.spec.js`, `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/planning_review_table.spec.js`, `tests/ui/shareable_view_links.spec.js`
- `docs/features/planning-sprint-review.md`, `docs/plans/README.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/design-system.md`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `README.md` (the deploy section and the line that still says workspace/Sprint), `AGENTS.md` (the learnings listed below), `frontend/dist/*` via `npm run build` only

Root `AGENTS.md` learnings to update when the plan executes: layout shared per workspace/Sprint/row kind; "no persistent instructional text" (the hint is a recorded exception); the boundary "+" position now persisted as an anchor and the Archive copy; layout draft confirmation now coming from the per-Sprint view; a Department group id keying shared review data with visibility never gating it; the sticky and docked-header offsets re-verified with the hint row present or dismissed.

### Expected behavior (specimen)

For Department group X: in Sprint A (active) a user adds Epic column "Risk" after "Status" (the UI saves the column and A's layout together, so A has its own view), sets Epic E's value, and arranges columns. Sprint B (future) opened for X shows "Risk" with E's value (columns and values are group-wide) in A's arrangement, with the hint "Showing the layout last saved in A". Hiding "Status" in B and saving gives B its own view; A is unchanged. Sprint C then shows B's view. Editing E's value in C changes it in A and B too and creates no view for C, so C still inherits B. A column "Owner" added in C also saves C's layout, and appears in A's and B's saved views after the column that preceded it when it was created, else at the end. If Sprint A had never saved a view, it would still show the default arrangement, not B's. Group Y sees none of it. In Stories mode, E's Stories show "Risk" with the E marker as the last column, read-only, holding E's value; a Story number column "Effort" added in Stories mode appears in Epics mode with the S marker as the last column, showing each Epic's sum over its in-scope Stories; hiding "Risk" in Stories mode leaves the Epics view untouched.

### Acceptance criteria

1. Group isolation: a column added under group X appears for every Sprint of X and never for group Y; with identical column ids in both groups, archive, rename, a value and a revision change in X leave Y unchanged.
2. A value saved from Sprint C is read from Sprint A (one value per issue per group); concurrent edits of one value from two Sprints return a cell conflict by revision.
3. View resolution: own view, else the nearest earlier saved view by numeric id (tested with ids 9 and 10 and a 30-digit id), else none; a later Sprint's view never affects an earlier Sprint; resolution reads at most two view rows with about 1000 views seeded; the per-group cap returns `400 review_view_limit`.
4. A first layout save in an unsaved Sprint stores exactly the request's layout actions (the client adds the other row kind's displayed layout), returns `inheritedFrom: null`, leaves the source view unchanged, and a row kind that was absent stays absent so default hidden columns still apply.
5. Cell-only and column-only saves create no view row, and the Sprint keeps inheriting after them.
6. A stale `baseSchemaRevision` returns `schemaConflict`, a stale `baseViewRevision` returns `viewConflict`, both 409 paths carry the resolved fields, and a cell-only save touches neither revision.
7. A save with an `add` and a layout that references the new column succeeds (layout validated against the post-action columns).
8. Placement tests in the model suite: the fold with `insertColumnId`, `'summary'` first, `null` end, chained and sibling anchors, archived and hidden anchors, an empty order, and `after` validation including a column added in the same request.
9. Archive removes the column in every Sprint of that group while saved views keep its id; the confirmation names the group, with the fallback, and a geometry check covers the longest label plus a long group name.
10. Hint: shown only while `inheritedFrom` is non-null and no layout draft is displayed; one sentence; dismissal persists across Sprint and group switches and reload, returns when the source's `viewRevision` changes, works by tap; Playwright asserts geometry, settled hover, and dock and reading position when it appears or disappears on load, save and refresh; the fixture's `addInitScript` is made conditional so persistence is provable.
11. Group switch: the header dropdown is guarded (save, discard, stay), forced changes discard, a draft is bound to its group and `save()` sends the captured group, and a controller test switches group while dirty.
12. `groupId` contract: required on all routes; GET accepts exactly one; POST and PATCH reject query strings; shape rules; precedence 400 shape, 400 `review_group_unknown`, authorization, transaction; an unknown group reads empty; the client shows the group message with no retry loop; the hook stays inactive until a configured group resolves.
13. Reattach: deleting a group and re-creating one with the same slug reattaches its data (documented behavior, tested); renaming keeps the data; a visibility preference hiding a group does not stop reads or writes.
14. Cross-workspace isolation with identical group ids, Sprint ids, column ids and issue ids in two workspaces.
15. A cell for an issue the user cannot see is absent and listed in `unavailableIssueIds`; no cell query runs when no issue is allowed.
16. No write on read for GET and values read; no Jira call and no catalog read; an empty PATCH creates no row and takes no lock; review code never writes group-configuration or preference rows.
17. Statement counts match the Performance table.
18. PostgreSQL race tests (opt-in file, `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1` with `TEST_DATABASE_URL`, skipped by default): two first creations of the group schema row, two first view saves for one Sprint, a column add against a layout save in both orders, and a layout-only save against the adoption script.
19. Migration: model and database parity including foreign key `ON DELETE`, checks, nullability and indexes; legacy rows unchanged after upgrade and after downgrade then upgrade; downgrade drops only the three new tables.
20. Adoption script tests (new test file, synthetic data): dry run writes nothing; `--apply` refuses without a matching digest, and a changed group set changes the digest; a second `--apply` writes zero rows and changes no revision; merge, id, aggregation and cell-precedence rules; archived columns skipped; views only for layouts with content; the 30-column skip report by id; chunked inserts; counts-and-ids-only output; non-numeric legacy ids skipped and counted; legacy rows never modified.
21. Analytics: a No-Event Allowlist row for the hint dismissal in `docs/README_ANALYTICS.md` with its required fields, pinned by `tests/test_analytics_source_guards.js`; column and view actions reuse the existing review action events.
22. Playwright stubs converted to a query-tolerant pattern in the three specs that stub the review routes, copy assertions updated, and `shareable_view_links.spec.js` asserts the link's `groupId` on the review GET.
23. Structure budgets: `dashboard.jsx` is net zero lines or `owner_budgets.json` is re-synced, and `test_codebase_structure_budgets` passes.
24. Derived rules (model tests, no server): a Story number column with a sum shows on Epic rows as the sum over the in-scope Stories (Sprint and filters); Story text columns and non-sum Story columns do not appear in the Epic view; every Epic column shows on Story rows as the parent Epic's value; nothing flows the other way and no derived cell is writable.
25. Derived totals: a rolled-up column's Epic-view total equals the in-scope Story total including the "No Epic" row; an Epic-derived column has no total in the Story view (an Epic value 5 inherited by four Stories never totals 20).
26. Marker and read-only: "S" and "E" superscripts after the column name, an accessible name that says Story or Epic property, an in-app readout and no native `title`, no input or edit affordance on derived cells; Playwright asserts header geometry with the marker at desktop and narrow widths and settled hover; the marker is registered in `docs/design-system.md` and the ratchets.
27. Placement and hide: derived columns default last in creation order; a saved order can place them; `apply_layouts` accepts custom ids of both kinds; hiding a derived column in the Epic view leaves the Story view unchanged and the reverse; a derived column's menu offers Hide and the grip only.
28. Edge cases: a Story without an Epic, an "awaiting creation" placeholder and an Epic without in-scope Stories show blank; a blank Story value counts as 0; a carried-over Story keeps its value and counts in each Sprint's sum; archiving the source removes its derived column in both views; sorting by a derived column uses the derived value; an unsaved source edit shows in both views.
29. No extra cost: statement counts and the Jira authorization passes are unchanged with derived columns present.
30. Full Python suite, `npm run test:frontend:unit`, `npm run build` with a clean diff, and the full Chromium `tests/ui` run required before push by `AGENTS.md`; headed Firefox/WebKit if the dismiss glyph is an emoji or the hint changes form-control geometry.

## Open Questions

None from the operator's side. Small calls the author made and the operator may overrule: the anchor reading of "keep the order of the columns", the hint and Add-note copy, the group-gone message, the view cap number, the merge rules (casefold label, latest aggregation, later clear wins, keep highest 30 instead of aborting), the 128-character group id bound, and for derived columns: the menu limited to Hide and the grip, the readout copy, blank rather than 0 for an Epic without in-scope Stories, the "No Epic" row summing its own Stories, and blank placeholder rows.

## Resolved Questions

- Operator direction of 2026-10-18 on Stories: the rules are agreed (Story sum up to Epic rows, Epic value down to Story rows, never reversed, automatic and visible); a superscript "S" or "E" marks a derived column; Hide is separate per Epic and Story view; a derived column is read-only and by default the last column of the other view. Interpretations recorded and confirmed by the operator on 2026-10-18: "couldn't intersect" is read as "could"; "Epic and Sprint" is read as the Epic view and the Story view; "a story type property added to the epic table … last column in the Story view with E" is read as an Epic-kind column shown last in the Story view with E, read-only.

- Operator answers of 2026-10-18: every configured Department group gets its own saved data from the existing per-Sprint tables; numeric Sprint id order is acceptable and is kept after the quarter-name alternative was offered (ids only increase; names can be anything); duplicating a group does not copy its review columns; re-creating a group with a deleted group's id reattaches the old data, documented and tested; the adoption rollout is a quiesced cutover.
- Operator direction of 2026-10-17 (see Direction) is the basis of this design: group-wide columns, one value per issue, per-Sprint shared views, a dismissible inheritance hint, an Archive warning, preserved column order.
- Earlier decisions accepted on 2026-10-16 that still hold: a Sprint without its own view follows live until it saves its own, and the first change saved makes it independent.
- Deviations from the issue text, recorded: "keep it as main for the current future Sprint" now holds for views only; columns and values edited in a future Sprint change the active Sprint's table, because they belong to the group; and an Epic's value belongs to the issue per group, so a cross-team Epic can differ between groups.
- Superseded on 2026-10-17: the Sprint pin chain, follower rows, the stale-source token, the passive catalog reader, the lookback bound and the "no inherited marker" decision.

## Superseded Design And Validation Record

The 2026-10-16 pin-chain design was validated by four independent read-only review passes; its findings about follower writes, catalog drift, catalog query cost, the value rule and the stale-source token do not apply here because those mechanisms are gone. The 2026-10-17 rewrite then went through five independent passes (backend concurrency, client and UI, security and contract, legacy adoption, product fit). Defects they found and this revision applies: the unguarded group switch and silent draft loss; Add column also saving a layout; the anchor wire shape and placement rule; view-row creation on every PATCH; empty arrays unhiding default-hidden columns; unbounded view reads and an unspecified numeric compare; layout validation order; a conflated 409 body; the missing saved/current handling for `viewRevision` and `inheritedFrom`; hint dismissal erased by whole-blob preference writes; the false "deleted-group rows are unreachable" claim (now a documented reattach); a self-contradictory adoption re-run contract, no cutover, an abort dead end, and unspecified merge order; understated performance counts; and incomplete file, test, ownership and learning lists. Checked clean: Alembic head `20261001_0018`; workspace-filtered queries; per-issue Jira authorization before the database; lock order and atomic rollback; shared links resolve the group before the review read. **This revision has not been re-validated**; the `EXEC-*` plan must re-verify every cited symbol before relying on it.

## Outcome

Not executed.
