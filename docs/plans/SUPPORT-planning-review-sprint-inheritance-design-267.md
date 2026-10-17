# Planning Review Sprint Inheritance Design (#267)

> **Status:** Design revised 2026-10-16 after an independent four-pass validation (see Validation Record). Operator accepted on 2026-10-16: live follow until modified, whole-table detach on the first table change, no inherited-value marker in this slice. **Decision 1 (values always follow; pre-migration rows are roots) and Decision 2 (source Sprint pinned at first write, kept after detach) were confirmed by the operator on 2026-10-16**; the design is still not executable until an `EXEC-*` plan exists. Written 2026-10-16 from issue #267 and the current code on `origin/main` (`cb1b3c4d`). Nothing is implemented. Items marked **Decision (my call)** are the author's recommendation on smaller points; the operator may overrule them in the `EXEC-*` plan review.

## Issue

#267: "inherit planning table view (and epic level custom values) from the current sprint to the future sprint. when during the planning a table was created in the active sprint, inherit it to the following future sprint. when table is modified in the future sprint, keep it as main for the current future sprint."

Two things must carry from an earlier Sprint to a later one:

1. **The table definition**: shared custom columns and the per-row-kind column layout (order and hidden set).
2. **The values**: custom-column cell values, matched by the same Jira issue (an Epic that sits in several Sprints, or a Story carried over).

A later Sprint that changes the table keeps its own version; the earlier Sprint is no longer consulted for the table it changed.

## Current State (verified in code)

- `workspace_sprint_reviews` holds one row per `(workspace_id, sprint_id)` with `columns`, `layouts` and `schema_revision` (`backend/db/models.py`, `WorkspaceSprintReview`).
- `sprint_review_cells` is keyed `(review_id, issue_id, row_kind, column_id)`, so a value belongs to one Sprint's review only (`SprintReviewCell`). A cleared cell is a retained row with a `NULL` value and a bumped revision, never a deleted row.
- Column ids are UUIDs. `apply_schema` only rejects duplicate ids inside one review, so the same id can exist in two Sprints.
- `load_review` returns the Sprint's own row only; `read_values` reads only that review's cells; `save_review` upserts the row in `_locked_review` (insert-do-nothing, then `SELECT … FOR UPDATE`) and uses per-cell `baseRevision` for conflicts (`backend/services/sprint_review.py`).
- `save_review` validates every cell against the row's **own** columns (`apply_schema(row.columns, …)`), and every response, 200 or 409, carries the row's own `columns` and `layouts` (`_schema`). A row with empty columns therefore rejects every cell write with `schemaConflict`.
- The client controller (`frontend/src/eng/usePlanningSprintReview.js`) loads schema then values per Sprint, sends `baseSchemaRevision` and per-cell `baseRevision`, treats a missing cell as revision 0, applies a save response as `data.columns || state.columns` (an empty array is truthy and wins), and flags a stale schema only when `schema.schemaRevision !== state.schemaRevision`.
- Sprint order lives in `WorkspaceSprintCatalog`, one row per `(workspace_id, board_id)`, read through `load_sprint_catalog` (`backend/services/workspace_catalog_cache.py`). That function first runs `assert_catalog_refresh_actor` (user, connection and workspace selects, `FOR SHARE` on PostgreSQL, `AuthError` when no matching `User` row exists). The Sprint selector's own path, `_get_db_sprints` in `backend/routes/settings_routes.py`, can start a Jira refresh and write catalog rows. `backend/services/sprints.py` is the fetcher and name filter, not the store.
- Result today: opening a new Sprint shows an empty review even when the previous Sprint has columns and values. Nothing links Sprints.

## Goals

- A Sprint with no review of its own shows the nearest earlier reviewed Sprint's columns, layout and values.
- Editing a value in the later Sprint stores it for that Sprint only and leaves the earlier Sprint unchanged.
- Changing the table (add, rename, archive, move, hide, show total) in the later Sprint makes that Sprint's table its own from then on; its values keep following per cell.
- Zero extra Jira requests, no new endpoints, and extra database statements within the bounds in Performance.

## Non-Goals

- Matching renamed, cloned or moved Epics by anything other than the immutable Jira issue id.
- Writing back to an earlier Sprint or merging columns from two Sprints.
- Copying data into the later Sprint ahead of time (no background job, no write on read).
- Per-user inheritance preferences, or any change to Jira-owned fields.
- Backfilling or rewriting reviews that already exist.
- Any change to catalog storage, catalog refresh, or `/api/sprints`.

## Anti-Goals

- Editing in a later Sprint must never change what the earlier Sprint shows.
- A read must never create or modify rows; a PATCH without changes creates no row.
- No Sprint that has been changed may silently flip back to following another table.
- No write may materialize an empty table because the source could not be loaded.
- A catalog rename, board change or unvalidated catalog must never re-parent or empty a Sprint that already has a review row.

## Design

### Row model

Two additive columns on `workspace_sprint_reviews`:

- `inherits_from_sprint_id` (nullable, same type as `sprint_id`): the **pin**. Set once, when the row is created, to the nearest earlier Sprint that already has a review row (any kind), else `NULL`. Never updated.
- `follows_previous_schema BOOLEAN NOT NULL DEFAULT false`: true while the row has no table of its own.

| Row | `follows_previous_schema` | pin | `schema_revision` | Meaning |
| --- | --- | --- | --- | --- |
| Pre-migration row | false | `NULL` | any | Exactly as today: a root. Follows nothing. |
| Follower | true | set | 0 | Table from the nearest own-schema row on the pin chain; only its own cells are stored. |
| Detached | false | set or `NULL` | 1 or more | Own table. Its values keep following the pin chain. |

An **own-schema row** is `follows_previous_schema = false AND schema_revision > 0`. A row with `schema_revision = 0` and no table is never a schema source.

### Resolution (server only; the client never names a source)

For target Sprint T:

1. Read the lightweight rows of the workspace in one query (`id`, `sprint_id`, pin, `follows_previous_schema`, `schema_revision`; filtered by `workspace_id`).
2. **Start of the chain.** If T has a row, the chain starts at that row. If T has no row, its pin is computed from the catalog: Sprints earlier than T, nearest first by quarter name, and the first one that has a row; the chain starts there.
3. Walk pins from the start, with a visited set, stopping at a `NULL` pin or a missing row.
4. **Table.** T's own row if it is an own-schema row; otherwise the first own-schema row on the chain; none means today's empty table.
5. **Values.** The same chain, own cells first.

| Part | Own data present | Own data absent |
| --- | --- | --- |
| Columns and layouts | T's row is an own-schema row | The nearest own-schema row on the chain |
| A cell value | T's own cell (a `NULL` is an explicit clear) | The nearest chain cell with the same `(issue_id, row_kind, column_id)`; a `NULL` in an intermediate Sprint shadows older values, so a clear in B reads empty in C |

Inherited cells are kept only for column ids that exist in the resolved table with the same row kind, and only when they pass `normalize_value` for that column type. Column ids are the lineage between tables (detach copies them verbatim, archived columns included, so ids survive); the pin links Sprints, not columns.

**Decision 1 (confirmed 2026-10-16): values always follow, per cell, until that cell is written in the later Sprint.** A detached Sprint keeps showing earlier Sprints' values for cells it has not written. If values stopped following at detach, adding one column in B would blank every value inherited from A, which contradicts the issue ("inherit … epic level custom values"). Values follow for every Sprint whose row has a pin; **pre-migration rows have no pin and stay exactly as today**, so existing Sprints do not start showing earlier values (no backfill, per Non-Goals). Rejected alternatives: values follow only while the table follows (blank at detach); backfill pins for existing rows (rewrites existing reviews).

**Decision 2 (confirmed 2026-10-16): the source Sprint is pinned when the row is created and kept after detach.** Deriving the source from the live catalog on every read means a Jira rename (the catalog admits only names matching `YYYYQn`), a board change, or a catalog that is not yet validated silently empties or re-parents a follower, and the next write would detach it with an empty table and orphan its cells. With the pin, a Sprint that has a row never reads the catalog. Consequences the operator accepted: (a) a Sprint's source is fixed at its first write, so if C is first written while B has no row, C pins A and never sees B's later table, whereas a not-yet-written C would have; planning A+1 before A+2 avoids this; (b) one extra nullable column; (c) a pin to a Sprint whose id later flips (see Resolved Questions) keeps resolving, because it points at the row, not the name. Rejected alternative: no pin, re-derive from the catalog on every read (the earlier draft), which needs a per-request catalog read and a 503 policy for every drift case, and still re-parents rows when the catalog changes.

**Decision (my call):** there is no lookback bound. Reach is data-bound (the pin chain), which also removes the earlier window's cliff (a table authored in quarter N would have vanished for N+9 although every Sprint between followed it). Chains pass through followers (S3 → S2 follower → S1).

### Schema storage and migration

- One Alembic revision after `20261001_0018_review_layouts.py` (verified head) adding both columns with plain `add_column`; the boolean uses `server_default=sa.false()` (precedent: `20260829_0009`), the model uses the existing `text('false')` style, and no `inspect` call runs without an `as_sql` guard. Existing rows keep `false` and `NULL`.
- Extend the schema parity test in `tests/test_sprint_review.py` (it compares column names only) to cover nullability and defaults.
- A follower's `columns` and `layouts` stay empty and are never the response source: every response is built from the **resolved** table.
- First schema or layout save on a follower, or first save with schema changes on a row-less Sprint: materialize the resolved table (columns, archived ones included, and the layouts of **both** row kinds) into the row, apply the change through `apply_schema` and `apply_layouts`, set `follows_previous_schema = false`, and bump `schema_revision` (0 to 1). After that the table is independent forever. The pin is unchanged.
- A cell-only first save on a row-less Sprint creates a follower when a source table resolves; it validates against that table before anything is written, so a 409 leaves no row.
- A PATCH with no `schemaChanges` and no `cellChanges` creates no row and returns the resolved schema (today it creates an empty row, which would otherwise look like a source).

### Catalog read (passive)

Order comes from the cached workspace Sprint catalog, which holds only quarter Sprints named `YYYYQn`, restricted to the board's origin, one entry per name. Add a read-only function to `workspace_catalog_cache.py` that:

- resolves `board_id` through `resolve_request_effective_catalog_config` (the admin-configured `board.boardId`), then selects the `WorkspaceSprintCatalog` row for `(workspace_id, board_id)` and returns its payload only when `validated_at` is set;
- does not call `assert_catalog_refresh_actor` (the request already carries a validated `RequestAuthContext`; the assertion takes `FOR SHARE` locks and would raise `AuthError` for the existing review test contexts), never starts a refresh, never calls Jira, and is never the `_get_db_sprints` path;
- is injectable in tests (like the existing `search` parameter) and is called only when the Sprint has no row, before the row lock is taken, never while holding it;
- parses names with `fullmatch` (`$` accepts a trailing newline), orders by `(year, quarter)` not `startDate` (future Sprints can have null dates), and converts catalog ids with `str()` (catalog ids are integers, review `sprint_id` is a string).

It is needed only to pick the pin of a row-less Sprint. A Sprint with a row never reads the catalog.

| Condition | Reads (GET, values) | Writes (PATCH) |
| --- | --- | --- |
| Sprint has a row | pin chain, no catalog read | pin chain, no catalog read |
| Row-less, catalog valid, source found | inherited | creates row with the pin |
| Row-less, catalog valid, no earlier row, or target absent from catalog | today's empty | creates a root row (`NULL` pin) as today |
| Row-less, catalog unavailable (no board, no row, not validated, storage error) | today's empty | 503 `review_source_unavailable`, nothing written |
| Follower whose chain no longer reaches an own-schema row | today's empty | 503 `review_source_unavailable` |
| `AuthError` | propagates as the application's existing 401 | same |

### Read contract (additive)

- `GET /api/eng/sprints/<sprint_id>/review`: returns the resolved `columns`, `layouts`, `schemaRevision` (the row's own, 0 for a follower or row-less Sprint) and `inheritedFrom: {sprintId, schemaRevision} | null` (the own-schema row the table was resolved from; `null` when T's table is its own).
- `POST /api/eng/sprints/<sprint_id>/review/values/read`: each cell gains `inheritedFromSprintId` (`null` for own cells). An inherited cell is returned with `revision: 0`, which is what the controller already uses as `baseRevision` for an unsaved cell. `unavailableIssueIds` and the existing `authorize_issues` pass are unchanged: access still comes from the signed-in user's Jira visibility, never from stored values, and no inherited query runs when no issue is allowed.
- Inherited cells come from one query over the chain's review ids restricted to authorized issue ids and resolved column ids. They are merged nearest-wins and deduplicated **before** the response cap (`MAX_RESPONSE_BYTES // 100`) is applied, so older Sprints' rows cannot cause a false `review_response_limit`. The cap and 413 behavior are otherwise unchanged.

### Write contract (additive)

- `PATCH /api/eng/sprints/<sprint_id>/review` accepts one new optional key, `baseInherited: {sprintId, schemaRevision} | null`, added to the server key allowlist. The client sends it exactly when `schemaChanges` is non-empty; `null` means the client saw no source. It replaces the earlier draft's bare `baseInheritedSchemaRevision`, which could not detect a change of source Sprint at an equal revision.
- Inside the row lock, for a request with schema changes on a follower or row-less Sprint: resolve the source, and if `baseInherited` differs from `{sprintId, schemaRevision}` of the resolved source (different Sprint, different revision, absent key while a source resolves, or a key while none resolves), return the existing `409 review_conflict` with `schemaConflict: true`. The existing "shared columns changed, your draft is preserved" path handles it. For a row that is already an own-schema row the key is ignored. A source that cannot be loaded returns 503, never an empty materialization.
- All decisions after the lock use the row as locked, not the pre-insert resolution, so two simultaneous first saves cannot disagree about its state. The source row is read in the same transaction (`FOR SHARE` on PostgreSQL), lock order target then source; an own-schema row is only changed by its own saves, so there is no cycle.
- Cell validation (existence, archived, row kind, type) runs against the **resolved** columns. A cell write stores an own cell with base revision 0 when none exists, regardless of an inherited value; own-cell conflicts are unchanged. A stale inherited value is intentionally overwritten: the user is choosing the value for this Sprint. Cell writes still require the existing per-issue authorization and row-kind match.
- Every 200 and 409 body returns the resolved `columns`, `layouts`, `schemaRevision` and `inheritedFrom` (`null` after a detaching save). Own cells in the response carry `inheritedFromSprintId: null`. After a detaching save the returned layouts for both row kinds match what the client sent, so the controller's layout confirmation passes.

### Sprint ordering and eligibility

- Ordering is by catalog quarter name only; if the catalog is unavailable or the target is absent from it, see the table above.
- No Sprint state gate: eligibility depends only on being later than the source, so a Sprint that becomes active, then closed, resolves the same way. Planning is disabled for closed Sprints in the UI (`EngModeControl`, `isCompletedSprintSelected`; the share resolver mirrors it), so a never-reviewed closed Sprint is not reachable through Planning; the API only ever returns workspace-shared data.
- The client has a second ordering for "first future Sprint" (`startDate`, then name, in `dashboard.jsx`); the chain intentionally uses the catalog's name order.

### Client

- `usePlanningSprintReview.js` stores `inheritedFrom` as a **saved/current pair** like `savedColumns`/`currentColumns`, because a follower's own `schemaRevision` is constantly 0 and cannot signal a source change:
  - load and clean refresh set both; a refresh while dirty sets only `current` and raises the existing conflict (`schemaConflict`, draft preserved) when `current` differs from `saved` by `sprintId` or `schemaRevision`, in addition to the existing own-revision test;
  - `reapply` and `loadCurrent` promote `current` to `saved`; `discard` resets to `current`; a save response sets both from the response (so a detaching save sets `null`); a 409 keeps `saved`; `reset()` (Sprint switch) clears both;
  - a missing `inheritedFrom` (older mocks omit it) is `null`.
- Send `baseInherited` from the `saved` value, only with schema changes.
- No change to the save-response handling: once the server always returns the resolved table, the `data.columns || state.columns` fallback is only reached for malformed responses. A test must pin that a follower cell-only save keeps its columns.
- **Decision (my call):** an inherited cell (`inheritedFromSprintId != null`) is never equivalent to the same typed value in `setCell`, so typing a value over an inherited one stores an own cell and pins it against later source edits. Without this, `setCell` drops an equal draft and the value cannot be pinned.
- **Accepted:** an automatic refresh on a clean table can change inherited values or columns because someone edited the source Sprint. Refresh is already held while dirty, saving, in conflict or pending, and while a cell is focused, and other users' value edits already behave this way.
- **Decision (accepted 2026-10-16):** no new visual treatment of inherited values or columns in this slice. Adding any marker would need a design-system entry; propose one only if operators ask.
- Existing consumers read own-Sprint data only and key on `schemaRevision` only inside the controller: `PlanningReviewTable.jsx`, `PlanningReviewStateCluster.jsx`, `PlanningReviewColumnMenu.jsx`, `planningReviewTableModel.js`, `dashboard.jsx`, `dashboardFreshnessAdapters.js`. `frontend/src/api/sprintReviewApi.js` forwards the payload as given and its 409 mapper keeps only `schemaConflict` and `cellConflicts`; no change is expected there.

## Performance

Zero extra Jira requests; no new endpoints; no write on read. Statements added per call (upper bounds the `EXEC-*` plan must measure and pin with SQLAlchemy's `before_cursor_execute` event):

| Call | Pre-migration row (no pin) | Row with a pin | Row-less Sprint |
| --- | --- | --- | --- |
| GET schema | +0 | +0 own table, +2 follower (lightweight rows, source row) | +4 (config, catalog row, lightweight rows, source row) |
| Values read, per batch | +0 | +2 (lightweight rows, inherited cells) | +4 (config, catalog row, lightweight rows, inherited cells) |

Values read repeats per batch of up to 500 issues and row kind; there is no in-process catalog cache in this slice. The review loads after accepted ENG data (an automatic follow-up), not on the critical initial dashboard load, and Sprints reviewed before this ships add nothing.

## Constraints Inherited From Existing Contracts

- Workspace isolation: every query filters by `context.workspace_id`, including the lightweight-rows read; cells are reached only through review ids already filtered by workspace; the catalog row is keyed by workspace.
- DB/OAuth only: `capabilities()` gating is unchanged. The PATCH and values-read routes keep `user_write` (token-bound CSRF plus `X-Requested-With`); GET keeps `authenticated_read`.
- Ownership: update `backend/security/CONFIGURATION_OWNERSHIP.md` (the "Shared per workspace + Sprint" row and the ENG Sprint Reviews section) to say a Sprint's table and values may be inherited from earlier Sprints of the same workspace, still shared and never per user.
- Shared-link seeding (#194): links carry only scope, view and filter keys (`SHARE_VIEW_QUERY_KEYS` in `frontend/src/shareView/codec.js`), no review or schema identifier, and the review read waits for the link to apply, so a link opened in a follower Sprint loads through the normal path. No codec change. `tests/test_share_view_planning_rows_seed.js` stubs `review` and does not prove this; no schema or revision identifier may be added to the codec.
- Migration: one offline-renderable Alembic revision after `20261001_0018_review_layouts.py`; verify head schema parity per the drift rule in `AGENTS.md`.

## Plan Requirements

### What changes

Backend resolution and passive catalog read, one migration with two columns, additive request/response keys, controller state plumbing, tests, docs.

### Forbidden regressions

- Any pre-migration Sprint review renders and saves exactly as before, apart from the new null fields `inheritedFrom` and `inheritedFromSprintId`.
- No write on read; no extra Jira request; no change to `authorize_issues` semantics; no use of `assert_catalog_refresh_actor`, `_get_db_sprints` or any refresh path by review code.
- No change to column ids, cell identity, `baseRevision` semantics for own cells, or the `layouts` shape.
- Planning Table chrome, sticky stack and column menus untouched.

### Files allowed to touch (all verified to exist; `Create` marked)

- `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `backend/db/models.py`, `backend/services/workspace_catalog_cache.py`
- `backend/db/migrations/versions/<next>_review_schema_follow.py` (Create)
- `frontend/src/eng/usePlanningSprintReview.js`
- `tests/test_sprint_review.py`, `tests/test_sprint_review_routes.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_planning_sprint_review.js`, `tests/test_sprint_review_api.js` (one forwarding test for `baseInherited`), `tests/ui/planning_review_integration.spec.js` (only if the new keys require mock updates)
- `docs/features/planning-sprint-review.md`, `docs/plans/README.md`, `docs/ontology.md` (the Planning Sprint review and Shared Sprint review storage entries), `docs/README_ANALYTICS.md` (No-Event Allowlist), `backend/security/CONFIGURATION_OWNERSHIP.md`, `frontend/dist/*` via `npm run build` only

### Expected behavior (specimen)

Sprint A (active) has Epic column "Risk" with a value on Epic E. Sprint B (future) has no row. Opening B shows "Risk" with E's value. Editing E's value in B stores a B cell (a follower row is created with pin A), B keeps showing "Risk", and A is unchanged. Adding a column in B and saving detaches B: it keeps "Risk" and its own new column, E's unwritten values still follow A, and a later new column in A does not appear in B. Epic E also in Sprint C (after B): once C has a row it pins B (B has a row), so C shows B's value for E, else A's.

Planning is done ahead of time: while A is active, the team plans A+1 (B above), then A+2 (C). The source of C is B, a future Sprint with its own row, whatever its state, and C follows B live while B is edited. When B later becomes active nothing changes for C. If B never saved a table change, C resolves through B to A. If C is first written before B has any row, C pins A (Decision 2, consequence a).

### Acceptance criteria

1. A row-less later Sprint resolves the nearest earlier row's columns, layouts and values (direct and through-follower cases).
2. A future Sprint can be the source; Sprint state transitions of the source change nothing; a Sprint pins the nearest earlier row existing at its first write.
3. A cell-only save on a follower succeeds, stores an own cell with base revision 0, and the 200 body returns the resolved columns and layouts with `inheritedFrom` unchanged (the follower's empty stored list never reaches the client). A cell write for a column archived in the source returns 409 `schemaConflict` with the resolved columns.
4. A written cell wins over inherited, including an explicit clear; a `NULL` in an intermediate Sprint shadows older values for later Sprints; typing a value equal to an inherited one stores an own cell.
5. The first schema or layout save detaches: both row kinds' layouts are materialized and echoed so the controller confirms them, `inheritedFrom` is `null`, the source is never modified, later source table changes do not reach the Sprint, and unwritten values keep following.
6. Stale source: `baseInherited` that differs by `sprintId` or `schemaRevision`, absent while a source resolves, or present while none resolves, yields `schemaConflict` with the draft preserved; the key is ignored on an own-schema row; an unloadable source yields 503 and no row, never an empty materialization.
7. Pre-migration Sprints are byte-identical in responses apart from the new null fields and inherit no values.
8. Catalog unavailable (no board, no row, not validated): row-less reads return today's empty table and row-less writes return 503 `review_source_unavailable` with nothing written; target absent from a valid catalog or no earlier row: today's behavior. A Sprint with a row performs no catalog read.
9. Cross-workspace isolation: seed identical Sprint ids, column ids and issue ids in two workspaces; the second never sees the first's columns or cells.
10. An inherited cell for an unauthorized issue is absent and listed in `unavailableIssueIds`; no inherited query runs when no issue is allowed.
11. No write on read for `load_review` and `read_values`, including a row-less target; zero Jira and zero refresh (patch `fetch_board_sprints`, the catalog refresh runtime and `_get_db_sprints` to fail); an empty PATCH creates no row; source row and cells are unchanged after follower writes.
12. Statement counts for each cell of the Performance table are measured and within the stated bounds.
13. Inherited cells are merged nearest-wins and deduplicated before the response cap, filtered to resolved columns and types, and a many-Sprint chain does not raise a false 413.
14. Controller tests for every set and clear site of the `inheritedFrom` pair (load, clean refresh, dirty refresh raising the conflict on source drift, reapply, loadCurrent, discard, save success including detach, 409, Sprint-switch reset), a missing key as `null`, a follower cell-only save keeping its columns, and a first layout save on a follower confirmed with `inheritedFrom: null`.
15. PostgreSQL race tests (opt-in file, `REQUIRE_POSTGRES_REVIEW_CONCURRENCY`): two first saves on one row-less Sprint, a cell save against a first schema save in both orders, and a first schema save against an edit of its source.
16. Analytics: no new user action or trigger, so no new event; record the allowlist reason in `docs/README_ANALYTICS.md` under No-Event Allowlist with the required fields (trigger, event_type, event_name, feature_name or page_name, typed params) or the stated reason.
17. Full Python suite, `npm run test:frontend:unit`, `npm run build` with a clean diff, and the full Chromium `tests/ui` run required before push by `AGENTS.md`; headed Firefox/WebKit only if a visual marker is added.

## Open Questions

1. Whether the Add popover note ("Shared with everyone reviewing this Sprint.") and the archive confirmation ("It leaves this table for everyone and cannot be restored here.") should mention that later Sprints follow the table. Not required by this slice.

## Resolved Questions

- **Catalog deduplication, resolved 2026-10-16 from `backend/services/sprints.py`:** the catalog yields exactly one Sprint per quarter name; the winner per name is the lowest-ranked by state (active, then closed, then future) and then lowest id, and reviews are keyed by the id the Sprint selector offers, which is this same winner. If two Jira Sprints share a quarter name and the winner flips (for example future to active), a review saved under the old id is orphaned. This is pre-existing; inheritance does not cause it, but a flipped row-less quarter would show the previous quarter's table and so mask the loss, while rows already pinned to the old id keep resolving. A null `originBoardId` Sprint is admitted by the catalog filter.
- **Which catalog (was the open `board_id` question), resolved 2026-10-16:** the effective board from `resolve_effective_catalog_config` (admin-configured `board.boardId`, falling back to the runtime board setting), keyed `(workspace_id, board_id)` in `WorkspaceSprintCatalog`. The review path reads it through the passive reader above, not the Sprint selector's `_get_db_sprints` path, which can refresh from Jira. A board change yields different Sprint ids: pinned rows keep resolving through their pins, but row-less Sprints on the new board do not match old rows and do not inherit across the change.
- Operator accepted on 2026-10-16: live follow until modified, whole-table detach on the first table change, no inherited-value marker in this slice.
- Operator confirmed on 2026-10-16, after validation: Decision 1 (values always follow per cell; pre-migration rows have no pin and are roots) and Decision 2 (source Sprint pinned when the row is created and kept after detach, with the first-write consequence that a Sprint first written before its nearer predecessor has a row keeps the earlier pin).

## Validation Record

2026-10-16: four independent read-only review passes (backend data model and concurrency; Sprint catalog and ordering; client state machine and consumers; security, performance and contract) tried to refute the first draft against the code. Confirmed defects, all applied above: follower cell saves would return 409 and a successful save would wipe the client's columns; followers re-derived their source from a drifting catalog; the "two extra queries" claim was wrong (the catalog accessor alone costs several statements and raises `AuthError` for the existing test contexts); the value rule contradicted the "existing Sprints unchanged" guarantee; the stale-source token compared a bare revision; the lookback window was not transitive; inherited rows were capped before deduplication; the files list and acceptance criteria missed named negative tests. Checked clean: `20261001_0018` is the migration head; existing indexes cover the proposed queries; no read path writes today; the analytics no-event claim holds; shared links carry no review identifiers. Reviewer line references were not all re-verified by the author; the `EXEC-*` plan must re-verify every cited symbol before relying on it.

## Outcome

Not executed.
