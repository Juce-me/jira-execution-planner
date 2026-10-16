# Planning Review Sprint Inheritance Design (#267)

> **Status:** Design accepted by the operator on 2026-10-16 (open questions 1 to 3); still not executable until an `EXEC-*` plan exists. Written 2026-10-16 from issue #267 and the current code on `origin/main` (`cb1b3c4d`). Nothing is implemented. Decisions marked **Decision** are the author's recommendation and need operator confirmation before an `EXEC-*` plan is written.

## Issue

#267: "inherit planning table view (and epic level custom values) from the current sprint to the future sprint. when during the planning a table was created in the active sprint, inherit it to the following future sprint. when table is modified in the future sprint, keep it as main for the current future sprint."

Two things must carry from an earlier Sprint to a later one:

1. **The table definition**: shared custom columns and the per-row-kind column layout (order and hidden set).
2. **The values**: custom-column cell values, matched by the same Jira issue (an Epic that sits in several Sprints, or a Story carried over).

A later Sprint that changes the table keeps its own version; the earlier Sprint is no longer consulted for what it changed.

## Current State (verified in code)

- `workspace_sprint_reviews` holds one row per `(workspace_id, sprint_id)` with `columns`, `layouts` and `schema_revision` (`backend/db/models.py`, `WorkspaceSprintReview`).
- `sprint_review_cells` is keyed `(review_id, issue_id, row_kind, column_id)`, so a value belongs to one Sprint's review only (`SprintReviewCell`).
- Column ids are UUIDs. `apply_schema` only rejects duplicate ids inside one review, so the same id can exist in two Sprints.
- `load_review` returns the Sprint's own row only; `read_values` reads only that review's cells; `save_review` upserts the review row inside `_locked_review` and uses per-cell `baseRevision` for conflicts (`backend/services/sprint_review.py`).
- The client controller (`frontend/src/eng/usePlanningSprintReview.js`) loads schema then values per Sprint, sends `baseSchemaRevision` and per-cell `baseRevision`, and treats a missing cell as revision 0.
- Sprint order is available server-side from `WorkspaceSprintCatalog.sprints` (id, state, `startDate`, `endDate`; `backend/services/sprints.py`).
- Result today: opening a new Sprint shows an empty review even when the previous Sprint has columns and values. Nothing links Sprints.

## Goals

- A Sprint with no review of its own shows the nearest earlier Sprint's columns, layout and values.
- Editing a value in the later Sprint stores it for that Sprint only and leaves the earlier Sprint unchanged.
- Changing the table (add, rename, archive, move, hide, show total) in the later Sprint makes that Sprint's table its own from then on.
- Zero extra Jira requests, at most two extra indexed database queries per load, no new endpoints.

## Non-Goals

- Matching renamed, cloned or moved Epics by anything other than the immutable Jira issue id.
- Writing back to an earlier Sprint or merging columns from two Sprints.
- Copying data into the later Sprint ahead of time (no background job, no write on read).
- Per-user inheritance preferences, or any change to Jira-owned fields.
- Backfilling or rewriting reviews that already exist.

## Anti-Goals

- Editing in a later Sprint must never change what the earlier Sprint shows.
- A read must never create or modify rows.
- No Sprint that has been changed may silently flip back to following another Sprint.

## Design

### Inheritance resolution

The **source chain** of Sprint S is the earlier Sprints in the workspace Sprint catalog, nearest first (ordered by quarter name, see Sprint ordering and eligibility), limited to a lookback bound. The chain is derived on the server only; the client never names a source Sprint.

**Decision (confirm): schema follows live until the Sprint saves a table change, then detaches whole; values follow per cell until that cell is written.** This is the literal reading of the issue ("when modified, keep it as main"). A one-time snapshot copy was rejected because values entered in the active Sprint during planning would never reach the future Sprint, and per-column merging was rejected as extra state for no stated need.

| Part | Own data present | Own data absent |
| --- | --- | --- |
| Columns and layouts | The Sprint's own row with `follows_previous_schema = false` | Resolve from the nearest chain Sprint whose row has `follows_previous_schema = false` |
| A cell value | The Sprint's own cell (even if `NULL`, which is an explicit clear) | The nearest chain Sprint's cell with the same `(issue_id, row_kind, column_id)` |

Because detach copies column ids verbatim, ids are the lineage; no new lineage key is needed.

### Schema storage

One additive column: `workspace_sprint_reviews.follows_previous_schema BOOLEAN NOT NULL DEFAULT false`.

- Existing rows keep `false`, i.e. they are their own source. Behavior of every already-saved Sprint is unchanged.
- `_locked_review` creates a row for a cell-only save with `follows_previous_schema = true` when the chain has a source, `false` otherwise. A follower's `columns`/`layouts` stay empty and are never read.
- A schema or layout change on a follower (first schema save) materializes the resolved source columns and layouts into the row, applies the change through the existing `apply_schema`/`apply_layouts`, sets `follows_previous_schema = false`, and bumps `schema_revision`. After that the Sprint is independent forever.

### Read contract (additive)

- `GET /api/eng/sprints/<sprint_id>/review`: returns the resolved `columns`, `layouts`, `schemaRevision` (own, 0 for a follower) plus `inheritedFrom: {sprintId, schemaRevision} | null`. A follower with no resolvable source returns today's empty schema.
- `POST /api/eng/sprints/<sprint_id>/review/values/read`: each returned cell gains `inheritedFromSprintId` (`null` for own cells). An inherited cell is returned with `revision: 0`, which is exactly what the controller already uses as `baseRevision` for an unsaved cell, so no client conflict logic changes. `unavailableIssueIds` and the existing `authorize_issues` pass are unchanged: access still comes from the signed-in user's Jira visibility, never from stored values.
- Inherited values are looked up in one query over the chain's review ids with `issue_id IN (authorized ids)`; the nearest chain position wins per `(issue_id, row_kind, column_id)`.

### Write contract (additive)

- `PATCH /api/eng/sprints/<sprint_id>/review` accepts one optional key, `baseInheritedSchemaRevision`, sent by the client when `inheritedFrom` was non-null. If the source schema revision differs at save time and the request contains schema changes, return the existing `409 review_conflict` with `schemaConflict: true`; the existing "shared columns changed, your draft is preserved" path handles it.
- A cell write always stores an own cell with base revision 0 when none exists, regardless of an inherited value. A stale inherited value is intentionally overwritten: the user is choosing the value for this Sprint. Own-cell conflicts are unchanged.
- Cell writes to an issue still require the existing per-issue authorization and row-kind match.

### Sprint ordering and eligibility

- Source chain comes from the workspace's cached Sprint catalog; no Jira call. The catalog (`backend/services/sprints.py`) holds only quarter Sprints named `YYYYQn`, restricted to the effective board's origin, one entry per name. Order the chain by that name (year, then quarter), not by `startDate`: Jira future Sprints can have null dates, and date ordering would disable inheritance exactly in the future-Sprint case this feature targets. If the catalog is unavailable or the target is absent from it, inheritance is skipped and the Sprint behaves as today (fail closed to current behavior).
- No Sprint state gate: eligibility depends only on being later than the source, so a future Sprint that becomes active, then closed, keeps resolving the same way and its history does not change at transitions. **Residual risk:** opening an old closed Sprint that never had a review shows the nearest older review. The lookback bound limits this.
- **Decision (my call):** lookback is 8 quarters (two years) and the chain may pass through followers (S3 → S2 follower → S1).

### Client

- `usePlanningSprintReview.js`: store `inheritedFrom`, send `baseInheritedSchemaRevision` with schema changes, and treat `inheritedFromSprintId` as display metadata only. No new fetches; the controller's existing schema-then-values order and generation guards stay.
- **Decision (my call, confirm):** no new visual treatment of inherited values or columns in this slice. Adding any marker would need a design-system entry; propose one only if operators ask.
- The Add popover note ("shared with everyone reviewing the Sprint") stays; whether to mention detaching is an open question, not a requirement.

## Constraints Inherited From Existing Contracts

- Workspace isolation: every query filters by `context.workspace_id`; source Sprints are chosen from that workspace's catalog only.
- DB/OAuth only: `capabilities()` gating is unchanged.
- Initial-load performance: schema load adds one indexed read of the earlier Sprint rows; values read adds one cell query; both bounded by the lookback. Measure query counts in tests.
- Shared-link seeding (#194, `tests/test_share_view_planning_rows_seed.js`): confirm a link opened in a follower Sprint resolves the same resolved schema; do not change the codec unless this fails.
- Migration: one offline-renderable Alembic revision after `20261001_0018_review_layouts.py`; verify head schema parity per the drift rule in `AGENTS.md`.

## Plan Requirements

### What changes

Backend resolution, one migration, additive request/response keys, controller field plumbing, tests, docs.

### Forbidden regressions

- Any existing Sprint review (own row, `follows_previous_schema = false`) renders and saves exactly as before.
- No write on read; no extra Jira request; no change to `authorize_issues` semantics.
- No change to column ids, cell identity, `baseRevision` semantics for own cells, or the `layouts` shape.
- Planning Table chrome, sticky stack and column menus untouched.

### Files allowed to touch (all verified to exist; `Create` marked)

- `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `backend/db/models.py`
- `backend/db/migrations/versions/<next>_review_schema_follow.py` (Create)
- `frontend/src/api/sprintReviewApi.js`, `frontend/src/eng/usePlanningSprintReview.js`
- `tests/test_sprint_review.py`, `tests/test_sprint_review_routes.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_planning_sprint_review.js`, `tests/test_sprint_review_api.js`
- `docs/features/planning-sprint-review.md`, `docs/plans/README.md`, `frontend/dist/*` via `npm run build` only

### Expected behavior (specimen)

Sprint A (active) has Epic column "Risk" with a value on Epic E. Sprint B (future) has no review. Opening B shows "Risk" with E's value. Editing E's value in B stores a B cell; A is unchanged. Adding a column in B and saving makes B independent; a later new column in A does not appear in B. Epic E also in Sprint C (after B): C shows B's value for E, else A's.

Planning is done ahead of time: while A is active, the team plans A+1 (B above), and when planning A+2 (C) the source is B, a future Sprint with its own table, not the active one. The source is therefore the nearest earlier Sprint with its own data, whatever its state. C follows B live while B is edited. When B later becomes active nothing changes for C. If B never saved a table change (it only followed A), C resolves through B to A.

### Acceptance criteria

1. Empty later Sprint resolves nearest earlier columns, layouts and values (own-chain and through-follower cases).
2. A future Sprint can be the source: the Sprint after it inherits from it, not from the active Sprint, and state transitions of the source change nothing.
3. A written cell wins over inherited, including an explicit clear.
4. First schema/layout save detaches; later source changes do not reach it; the source is never modified.
5. Source schema changing between a follower's load and its first schema save yields `schemaConflict`, draft preserved.
6. Existing own-schema Sprints are byte-identical in responses apart from the new null fields.
7. Missing catalog, target absent from the catalog, or no source: today's empty behavior.
8. Cross-workspace isolation test: a second workspace never sees the first's columns or cells.
9. Query-count test proves schema load and values read stay within the stated bounds.
10. Analytics: no new user action or trigger, so no new event; record this allowlist reason in the EXEC plan after checking `docs/README_ANALYTICS.md`.
11. Full Python suite, `npm run test:frontend:unit`, `npm run build` clean diff; headed Playwright is only needed if a visual marker is added.

## Open Questions

- Which `board_id` catalog the chain reads (see the first Resolved item); to be named and verified in the EXEC plan.

## Resolved Questions

- **Catalog deduplication (was question 4), resolved 2026-10-16 from `backend/services/sprints.py`:** the catalog already yields exactly one Sprint per quarter name, so a chain has no same-name duplicates and the cross-board concern does not arise within one catalog. The winner per name is the lowest-ranked by state (active, then closed, then future) and then lowest id. Reviews are keyed by the id the Sprint selector offers, which is this same winner. Pre-existing, unchanged risk: if two Jira Sprints share a quarter name and the winner flips (for example future to active), a review saved under the old id is orphaned; inheritance neither causes nor fixes this. The implementation plan must resolve the chain with the same catalog accessor the Sprint selector uses and must name which `board_id` it reads; this is not yet verified.
- Operator accepted on 2026-10-16: live follow until modified, whole-table detach on the first table change, no inherited-value marker in this slice.

## Outcome

Not executed.
