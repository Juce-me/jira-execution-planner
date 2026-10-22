# Planning review adoption merge mode Implementation Plan

> **Status:** Done. Executed on `bugfix/299-review-adoption-merge-mode` for issue [#299](https://github.com/Juce-me/jira-execution-planner/issues/299) (commits `87ae9078` to `59c8eb8d`), accepted by the operator on 2026-10-22; no PR yet. Kept for audit context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Approved 2026-10-22 by the operator, with the recommended answer taken for D-1 to D-12 (D-8: postmortem yes; issue [#299](https://github.com/Juce-me/jira-execution-planner/issues/299) created 2026-10-22). Validated once (three independent read-only reviews, findings applied; this revision is not re-validated). Executed 2026-10-22: Tasks 1 to 7 done plus one review-fix commit (`c7de86ff`); verification evidence in Task 7 and the log; local only (not yet pushed); accepted by the operator on 2026-10-22, and renamed from `EXEC-` to `DONE-` on that instruction.
Type: bugfix (operator script, tests, docs; no application code, route, model or migration change)
Branch: `bugfix/299-review-adoption-merge-mode`. At the operator's direction the agent-generated worktree branch was renamed to this `bugfix/` name (instead of the `feature/` name D-8 proposed) and fast-forwarded to `origin/main` `41c47562` on 2026-10-22, zero commits ahead. `origin/main` is nine commits past the base below; none touches the script, `sprint_review.py` or the adoption tests (empty diff checked 2026-10-22), but Task 1 re-verifies every cited symbol.
Written: 2026-10-22 against `origin/main` `919eadac` from the #267 design and plan, `scripts/adopt_legacy_sprint_reviews.py`, `backend/services/sprint_review.py`, `tests/test_adopt_legacy_sprint_reviews.py`, a read-only look at a local database that hit the problem, and the downstream release chart.

**Goal:** `scripts/adopt_legacy_sprint_reviews.py --merge` adopts legacy per-Sprint review data into a workspace that already has group review rows, without overwriting, clearing, renaming or resurrecting anything done after the release, and stays safe to re-run (with the three documented exceptions under Known limits).

**Architecture:** Legacy data is normalized once, then resolved per group against that group's current columns, cells and views. The apply runs in two phases: a read-only planning session, then a write transaction that locks the affected groups through `sprint_review._locked_schema` (the lock every app writer takes first), discards everything read before the locks, re-reads and re-plans, and writes only if the re-plan's digest equals the reviewed one. The default mode (no flag) is unchanged.

**Tech Stack:** Python 3.10-compatible script, SQLAlchemy, SQLite unit tests, the opt-in PostgreSQL race tests already run by the CI PostgreSQL runner.

**Spec (source of truth):** [SUPPORT-planning-review-sprint-inheritance-design-267.md](SUPPORT-planning-review-sprint-inheritance-design-267.md), section "Existing per-Sprint tables" and its rollback table. This plan changes these recorded statements (Task 6 edits each): the quiesced-cutover rule (design line 18), "the adoption script is the one exception" to schema-row locking (141), "the target is always empty" (166), "Refusal, not no-op" and the atomicity and lock-mode text (170-171), and the rollback row "After the new app served and users wrote: forward fix only" (188). The refusal stays the default; `--merge` becomes the forward fix. The operator asked for this on 2026-10-22.

## Why

- A release that auto-migrates (`RUN_DB_MIGRATIONS=true`, the local runner, or the downstream chart's migration Job, an ArgoCD `Sync` hook in wave -1 that runs only `alembic upgrade head`) reaches migration `20261020_0019` with no adoption step. The app then reads only the empty group tables and every saved review column disappears from Planning, whatever the Sprint's state. The old rows are intact. Observed locally on 2026-10-22: columns saved before a restart, group tables empty, `--list` reporting `pending`.
- The fix today is `--apply`, which refuses once any group row exists, and one user adding a column or saving a layout after the release creates one. The README rollback table then says "forward fix only", which has no tool.
- `--list` prints `adopted` whenever any group schema or view row exists (`_list`), even when nothing from the legacy tables was adopted.

## Direction (operator, 2026-10-22)

"Adoption should also work when group rows already exist in a workspace (merge mode). Propose the design and an EXEC plan before building anything."

## Design

### Mode and CLI

| Invocation | Behavior |
| --- | --- |
| `--workspace-id W` | Unchanged: dry run, digest `adopt-legacy-sprint-reviews/1`, `--apply` refuses when any group row exists, table locks in a quiesced window. Only the refusal text gains a pointer to `--merge`. |
| `--workspace-id W --merge [--group G]...` | Dry run of the merge: per-group plan and report, digest `adopt-legacy-sprint-reviews/2-merge`, "dry-run only". `--group` (repeatable, D-10) limits the merge to the named configured groups; unnamed groups are untouched; an unknown id aborts. |
| `--workspace-id W --merge --apply --expected-sha256 sha256:<hex>` | Apply as described under Apply sequence. |
| `--list` | Per workspace, same line format as today. `status`: `nothing to adopt` (no legacy data), `pending` (legacy data, no group rows; not planned, so it stays cheap and keeps working for a workspace with no group catalog), `needs-merge` (group rows exist and the merge plan has an insert), `adopted` (group rows exist and the merge plan has no insert; keys skipped by cap or group archive are listed by the dry run, not here), `error` (planning raised; one sanitized code, the survey continues). |

Exit codes are unchanged: 0 success or nothing to do, 1 refusal or failure with nothing written, 2 lock timeout with nothing written. `--merge` without `--apply` never writes. The module docstring (also the argparse description) documents `--merge`.

### Apply sequence and precedence

1. **Phase A, read-only session:** read the group catalog, legacy data and group state (Core column projections, never ORM entities), plan every selected group, compute the digest.
2. Digest differs from `--expected-sha256`: raise `ValueError` (exit 1). Plan has no insert: print "nothing to merge", exit 0, no write transaction opened (so a second apply with a fresh dry-run digest exits 0, and with a stale digest exits 1).
3. **Phase B, write transaction:** set the 5 s `lock_timeout` and 60 s `statement_timeout`; `LOCK TABLE ... IN SHARE MODE` on the two legacy tables (blocks stray old-image writers; the app never writes them); for each group with a non-empty plan, in sorted id order, `sprint_review._locked_schema` (insert-do-nothing, then `SELECT ... FOR UPDATE`), all inside the same `55P03` to exit-2 mapping the script already uses; then a **full re-read of every input in this new session** (the locked schema rows, cells, views, legacy rows, catalog; nothing from the read-only plan is reused), then re-plan all selected groups (empty-plan groups are read without a lock) and compare digests. Any mismatch raises `ValueError`, which rolls back every lock-created row. Only a matching re-plan writes.
4. No ORM entity read before the locks may be used after them: `_locked_schema` returns the session's identity-mapped instance without refreshing it (reproduced on SQLite: a revision committed between the pre-read and the lock stays invisible, so the run would overwrite the live column and the digest would still match). A test seam `_before_lock` sits between the phases, beside the existing `_before_write`.

### Resolution, per selected group

The legacy side is normalized as today (key `(row kind, casefolded stripped label, type)`; earliest non-archived member's id and label; latest aggregation; highest Sprint id wins a cell conflict, a `NULL` clear counts as a value; archive intent by the latest member; malformed, repeated-id and cross-kind-layout aborts). The group's own columns must be well-formed (id, `rowKind`, label, type, archived); otherwise abort with a sanitized count, never a raw `KeyError`.

1. **Claim pass (a), by id.** For each legacy key, the group columns whose id equals any member id (live or archived). More than one distinct column: abort with a count. The claimed column must have the same `rowKind` and `type`, else abort with a count. A claimed group-archived column means the user archived it: the key is skipped and its cells counted as dropped. This makes a re-run, and a workspace adopted earlier by the fresh path, a no-op even after a rename.
2. **Label pass (b), by label.** For each remaining key in processing order, among group columns that are non-archived, unclaimed by any earlier key, of the same kind and type, with equal `strip().casefold()` label: the lowest `order`, then list position, is the target and becomes claimed. With no such column but an unclaimed group-archived column of that key, the key is skipped (archive wins). A group column is therefore the target of at most one key.
3. **New column (d).** Everything else is a new column, appended through `sprint_review.apply_schema(existing_columns, adds)`.
4. **Caps.** Slots: per kind `max(0, 30 - active group columns of that kind)`, total `max(0, 240 - all group columns)`. New-column candidates are ranked across both kinds by latest member (Sprint id, position) descending and taken while a per-kind slot and a total slot remain; the rest are excluded and listed by member id and Sprint id. `apply_schema` raising is an abort, not an exclusion.
5. **Matched columns keep everything about the group's column** (label, aggregation, `order`, `after`). An archive-intent legacy key that matches an active group column changes nothing; its cells are counted.
6. **Cells.** A legacy cell maps to its target column through the injective mapping. If the group already has a cell for `(issue, kind, target)`, including a retained `NULL`, the live cell wins and is counted; otherwise it is inserted at `revision` 1.
7. **Views** (policy D-11). A legacy layout is remapped through the same mapping (unmapped ids dropped, as today) and inserted at `view_revision` 1 only when the group has no view row for that Sprint id; otherwise the live view wins entirely (a live row holding one kind drops the other kind's legacy layout; counted). Slots: `max(0, 500 - existing views)`, filled by the highest `sprint_order`; slice as `views[max(0, len(views) - slots):]` because `views[-0:]` is the whole list, and read `MAX_GROUP_VIEWS` from `sprint_review` at call time (a test patches it). The report prints, for every inserted view, the Sprint-id interval whose inherited layout changes (from its id up to the next existing view id) and the remaining view slots, because `save_review` rejects first layout saves in new Sprints once a group is at the cap.
8. **Revision state table.**

| Group at start | Plan | Result |
| --- | --- | --- |
| no schema row | any insert | row created by the run, `columns` = adds, `schema_revision` 1, then cells and views |
| no schema row | empty | untouched, no row (the fresh path would write an empty revision-1 row; intentional) |
| row exists | at least one added column | `columns` updated, `schema_revision` +1 |
| row exists | no added column | no revision change (cells revision 1, views revision 1) |

Existing view rows and their revisions are never touched.

Merging into a group with no rows must write exactly what the fresh path writes for every plan with at least one insert; a test pins that, and it is also the regression guard for the planner split.

### Digest

`sha256` over `{rule, workspaceId, selected groups, canonical legacy reviews, and per group: the resolved plan (added columns, id mapping, cells to insert, views to insert, skip counts)}` plus the group's base `schema_revision` for groups whose plan is non-empty. The invariant is "what you reviewed is what gets written". A live edit that does not change the plan (an unrelated cell) leaves it valid; a column change in a group being written, or anything that flips a match, a cap or a conflict decision, invalidates it. The fresh path keeps its input digest.

### Report (counts and ids only)

Per group: columns matched (legacy id to group id), added, skipped for group archive, cap-excluded; cells inserted, skipped (live wins), dropped by archive intent or cap; views inserted (Sprint ids and affected intervals), skipped (live wins), skipped by cap, remaining view slots; revision change; derived rollups added. Never labels, values or issue ids. An operator who needs the label behind a matched id uses a read-only lookup by column id documented in the runbook (no code).

### Open clients and consumers

| State | Result after a merge |
| --- | --- |
| Client holds a column draft with the old `schemaRevision` | `schemaConflict` on save, draft preserved. |
| Client holds a layout draft for a Sprint that gained a view row | `viewConflict` on save (base 0, row now 1), draft preserved. |
| Client holds a cell draft for a cell the merge inserted | `cellConflicts` on save (draft base 0, cell now at revision 1), draft preserved; a draft on a cell the merge did not touch is unaffected. |
| Reads (`load_review`, `read_values`) | Return the merged columns and cells; no code change. |
| Sprints without their own view | May inherit an inserted legacy view instead of what they showed before (nearest-earlier rule); the report lists the intervals. |

### Size, duration and privileges

- Bounds: cells and views are inserted in chunks of 100 as today; a plan that inserts more than `MERGE_MAX_INSERT_ROWS` rows over all groups together (columns, cells and views; 100,000, confirmed by the rehearsal and applied to the whole run after the implementation review, because the run is one transaction holding every written group's lock) aborts before any lock is taken; `--group` merges groups separately. The under-lock work is targeted reads only: app writers have no lock timeout, so they wait for as long as a group lock is held.
- Memory: when exec'd in a web pod the script shares the pod's memory limit with the app (768Mi in the downstream chart); the rehearsal records statement counts (`before_cursor_execute`), duration and peak memory.
- Privileges, merge path: group schema table `SELECT`, `INSERT`, `UPDATE` (`FOR UPDATE` and the columns update need it); group cells and views `SELECT`, `INSERT`; legacy tables `SELECT` plus `UPDATE`, `DELETE` or `TRUNCATE` for the share lock. The fresh path additionally takes `EXCLUSIVE` locks on the group tables, which also need `UPDATE`, `DELETE` or `TRUNCATE` there; the README currently lists only `INSERT`, and Task 6 corrects it. The downstream chart's database login is a `cloudsqlsuperuser` member (its ADR 0010), so privileges are not a blocker there.

## Decisions (resolved 2026-10-22: every recommendation accepted)

Operator answer of 2026-10-22: take the recommended answer for D-1 to D-12. D-8: the postmortem is yes; the issue number was not supplied (the reply carried an unfilled placeholder) and was required before Task 1. Resolved the same day on the operator's instruction: issue #299 was created and the branch is `bugfix/299-review-adoption-merge-mode`. The options and reasoning below are kept as the record.

- **D-1 Opt-in `--merge` (recommended)** vs merging automatically when group rows exist. Opt-in keeps the #267 refusal as the safe default.
- **D-2 Locking.** Per-group schema-row locks that let the merge run while the app serves, vs keeping the quiesced window and table-level `EXCLUSIVE` locks (the already-tested path, a smaller diff). The downstream chart runs a single replica with a `Recreate` strategy and already accepts downtime, which favors quiescing; a multi-replica deployment favors the per-group locks. Recommend per-group locks, because they remove the outage and the same locks are what the app itself uses; quiescing remains valid operationally either way.
- **D-3 Column matching: id first, then casefolded label and type (recommended)** vs never matching by label vs an explicit operator mapping. Label matching reunites a column a user rebuilt after losing it (a likely case, not measured) but can pair two unrelated columns that share a label; the report lists each pair by id and the runbook shows how to read the labels. Never matching creates duplicate columns; an explicit mapping adds a flag and an operator step.
- **D-4 Live data wins every conflict, never overwritten or cleared (recommended).**
- **D-5 A column the group archived stays archived (recommended)** vs resurrecting it. Archive cannot be undone in the UI.
- **D-6 `--list` gets the statuses above (recommended).**
- **D-7 Digest over the resolved plan (recommended)** vs over raw inputs.
- **D-8 Branch and bookkeeping.** An issue number for the branch, and whether to add a postmortem (`docs/postmortem/MRT033-<short-title>.md` plus index row) for the silent-hiding release gap on the same branch. Recommend yes.
- **D-9 Release path.** Adoption stays a digest-gated operator step (the downstream chart's migration Job stays migrate-only; its image already contains the script, but needs a build that includes `--merge`). Alternatives: a non-blocking startup or preflight warning when legacy data exists and a merge would insert something (addresses the silent hiding itself; a separate plan), or an unattended adoption hook (does not fit a digest-gated apply). Recommend accepting the operator step now and considering the warning as its own plan.
- **D-10 `--group` filter (recommended).** Without it a merge months later fills every configured group, including groups created after the release that never had legacy columns (the design says a later group "starts empty"). With it the operator names the groups to restore; without `--group` all configured groups are targeted, as in the fresh path, and the dry run lists each.
- **D-11 View policy.** (i) Insert every legacy view whose Sprint has no live view and report the affected intervals (recommended: restores explicit layouts); (ii) insert only legacy views older than every live view (never changes what a live layout governs); (iii) no views (columns and values only).
- **D-12 Re-run provenance for label matches.** A column matched by label (not by id) carries no marker, so after a rename or archive a second run adds a duplicate. Accept and document (recommended), or record the adopted legacy ids on the matched group column, which changes a live column's JSON and is barred by the Forbidden regressions below.

## Global Constraints

- Script only: no change to `backend/`, routes, models, migrations, the Dockerfile, CI runner lists or any frontend file. `backend/security/CONFIGURATION_OWNERSHIP.md` is read and stays unchanged (no new storage, no ownership change).
- Legacy rows are never modified or deleted; no live group column, cell or view is overwritten, cleared, renamed, reordered, re-aggregated or given a new JSON key; no view row is created where one exists; no write when the plan is empty.
- Output carries counts and column, Sprint and group ids only; an `IntegrityError` is re-raised sanitized; `jira_server` is never imported (the existing fresh-interpreter test stays).
- Workspace isolation: every query filters by the workspace id; groups come from the shared catalog read as today.
- Python 3.10-compatible syntax; `.venv/bin/python`; synthetic fixtures only; no real keys, ids, emails or local paths in committed files.
- Commits: one atomic commit per task, subject under 72 chars, one-shot `-c user.name` and `-c user.email` flags with the configured noreply identity, no attribution trailer of any kind. After each commit read `git show --stat HEAD` and `git status` before the next step.
- Never push, open a PR or publish a handoff; publication follows `AGENTS.md` section 10 only when the operator asks.
- Gate sweep (`docs/plans/AGENTS.md`): `rg --files docs/plans | rg '/GATE-'` lists only `GATE-05` (Home write capability), not touched by this work; no gate command run, none cleared. EXEC-267's own Gate 7 cutover rehearsal is still open and is independent of this plan.
- Analytics: no user-visible UI change; operator script only, so no event and no allowlist row.
- Postmortems reviewed before touching related code: MRT016 (file-map and task-boundary drift).

## Files allowed to touch (all verified to exist unless marked Create)

- `scripts/adopt_legacy_sprint_reviews.py` (no extraction or structure budget registers it or its tests; checked in `owner_budgets.json` and `tests/test_codebase_structure_budgets.py`)
- `tests/test_adopt_legacy_sprint_reviews.py`, `tests/test_sprint_review_postgresql.py` (new test methods in the existing module, which the CI PostgreSQL runner and its contract test already list)
- `README.md` and `INSTALL.md` (the "Review adoption cutover (#267)" paragraphs, privileges, rollback table), `docs/features/planning-sprint-review.md` (the "Adoption cutover" paragraph), `docs/ontology.md` (the "Legacy review adoption" entry), `docs/plans/SUPPORT-planning-review-sprint-inheritance-design-267.md` (the lines listed in Spec), `docs/plans/README.md` (index row, already added)
- `AGENTS.md` section 11, one learning, only if the operator confirms the wording
- D-8 postmortem (approved): `docs/postmortem/MRT033-<short-title>.md` (Create) and `docs/postmortem/README.md`; committed on the task branch, not a separate docs branch
- Downstream handoff (not edited here): the downstream release repository needs an upstream sync and an image build that include `--merge`, and its own README or INSTALL has no adoption step; the operator adds the exec instructions there.

## Forbidden regressions

- Default-mode behavior is unchanged except the refusal text: refusal on existing group rows, table locks, digest, report lines and exit codes. All 23 existing tests pass unmodified; new assertions live in new tests.
- `--merge` onto a group with no rows equals the fresh path's written state for every plan with an insert.
- `--list` for a workspace with no legacy data or no group rows stays as cheap as today and prints the same line format.

## Expected behavior (specimen)

Group G after the release: a live Epic number column "Risk" (id N1, created by a user) with a value on Epic E2, and a view for Sprint 200. Legacy data: Epic number "Risk" (id L1) with values on E1 and E2, Story number "Effort" (L2) with values, a layout for Sprint 100 using both. `--merge` dry run: L1 matches N1 by label and type; "Effort" is added (G's `schema_revision` +1); E1's Risk value is inserted into N1; E2's is skipped (live wins); Effort values are inserted; Sprint 100's layout is inserted with L1 remapped to N1 and the report names the interval it now governs (100 up to 200); Sprint 200's view is untouched. A second `--merge --apply` prints "nothing to merge" and exits 0, and `--list` shows `adopted`. A group Y with no rows receives exactly what the fresh path would write. Had the user renamed N1 before the first run, L1 would be added as a new column instead of matching (label no longer equal).

## Tasks

### Task 1: Branch hygiene, baseline and symbol re-verification

- [x] Branch `bugfix/299-review-adoption-merge-mode` is the renamed worktree branch fast-forwarded to a fresh `origin/main`; zero commits ahead, and only this plan and its index row are uncommitted (verified 2026-10-22).
- [x] Re-verify every symbol this plan cites against the fetched head (`_plan`, `_build`, `_write`, `_lock_tables`, `_list`, `_before_write`, `_locked_schema`, `apply_schema`, `MAX_GROUP_VIEWS`, `MAX_ACTIVE_COLUMNS`, the 23 test names).
- [x] Baseline: `.venv/bin/python -m unittest tests.test_adopt_legacy_sprint_reviews` (23 tests) and `tests.test_postgresql_runner_contract`; run `tests.test_sprint_review_postgresql` against a throwaway PostgreSQL via `TEST_DATABASE_URL` with `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1`. Record counts and skips. Result 2026-10-22 at `41c47562`, Python 3.14.7: adoption tests 23 OK (4.7 s); runner contract 14 OK; `tests.test_sprint_review_postgresql` 12 skipped without a database and 12 OK (11.8 s) on a throwaway PostgreSQL 16 database with `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1` (database dropped afterwards, only the original databases remain). Every cited symbol and design line resolves; the only cited file changed since `919eadac` is `docs/ontology.md`, whose adoption entry is present.

### Task 2a: Golden-state test first (separate commit)

Files: `tests/test_adopt_legacy_sprint_reviews.py`.

- [x] One golden test per workspace (three in all) runs the fresh path on a rich synthetic workspace and compares the full stdout (workspace id masked) plus `group_state()` to a golden value. The fixture covers: an orphan cell and a kind-mismatched cell; same-issue conflicts on cap-excluded, archive-intent and archived keys; an Epic-kind cap and a both-kind cap; layouts with unknown ids, duplicate ids, `key` in `hidden`, and ids of excluded or intent columns; `{}` layouts and a patched `MAX_GROUP_VIEWS`; two groups; an archive-only workspace and a layout-only workspace (the degenerate cases where fresh writes revision-1 rows). Commit this against the unmodified script so it demonstrably passes on the old code.

### Task 2b: Split the planner (no behavior change)

Files: `scripts/adopt_legacy_sprint_reviews.py`.

- [x] Split `_plan` into `_normalize(reviews)` (the malformed-review, malformed-column and repeated-id aborts, key groups, archive intent, archived members, candidates before the cap) and `_resolve_group(normalized)` (cap ranking, `apply_schema`, per-target cell winners with the dropped counters, the layout shape and cross-kind aborts and remap, view cap, report). The layout aborts stay in `_resolve_group` so the order of checks, and with it the error precedence, is unchanged. Cell winners and drop counters stay per target after the remap, exactly as today. The fresh path resolves once and reuses the result for every group. The `state` parameter is added in Task 3 (an unused argument now would be dead code), and the view-slice fix for zero slots also belongs to Task 3 (the fresh path's limit is never 0). The golden tests and all 23 existing tests pass unmodified. Commit.

### Task 3: Group state reader and resolution (pure functions)

Files: `scripts/adopt_legacy_sprint_reviews.py`, `tests/test_adopt_legacy_sprint_reviews.py`.

- [x] `_read_group_state` returns projected tuples (never ORM entities) with group-column shape validation; extend `_resolve_group` with a `state` parameter and the rules above, and fix the view slice for zero slots (`views[-0:]` is the whole list). Tests call `_resolve_group` directly with synthetic state (class `AdoptionMergeResolutionTests`): `test_claim_by_id_survives_rename_and_archive_intent`; `test_claim_by_id_requires_same_kind_and_type_and_aborts_on_ambiguity`; `test_label_match_is_injective_lowest_order_then_position`; `test_renamed_adopted_column_never_double_claimed`; `test_group_archived_column_is_not_resurrected_and_cells_counted`; `test_matched_column_keeps_group_properties`; `test_cap_slots_use_existing_active_and_total_counts_across_kinds`; `test_live_cell_wins_including_retained_null`; `test_live_view_wins_whole_row_and_older_legacy_view_is_inserted_remapped`; `test_view_slots_zero_inserts_nothing`; `test_malformed_group_columns_abort_with_a_count`; `test_report_names_view_intervals_and_remaining_slots`. Commit.

### Task 4: Writer, locks, digest, CLI and `--list`

Files: `scripts/adopt_legacy_sprint_reviews.py`, `tests/test_adopt_legacy_sprint_reviews.py`.

- [x] `--merge` and `--group`; merge rule constant; phase A and phase B as specified, `_before_lock` seam, a full re-read in the new write session after the locks, `_write_merge`, revision state table, `MERGE_MAX_INSERT_ROWS` ceiling, `--list` statuses with per-workspace error containment, module docstring, refusal pointer.
- [x] Tests (class `AdoptionMergeTests`, going through `main`): `test_merge_into_empty_group_equals_fresh_adoption` (every plan with an insert); `test_created_row_ends_at_revision_one_including_views_only`; `test_empty_plan_group_is_neither_locked_nor_written` (a patch recording `_locked_schema` calls also proves sorted order); `test_dry_run_writes_nothing_and_apply_requires_matching_digest`; `test_digest_precedence_stale_digest_exit_1_fresh_digest_nothing_to_merge_exit_0`; `test_digest_ignores_unrelated_live_edits_but_changes_with_a_column_or_a_decision`; `test_live_save_between_phases_aborts_with_zero_writes_and_keeps_the_live_column` (commits `save_review` at `_before_lock`; the Blocker regression); `test_unrelated_cell_edit_between_phases_still_applies`; `test_failure_in_a_later_group_rolls_back_every_group`; `test_every_preexisting_live_row_is_byte_identical_after_apply`; `test_apply_twice_is_a_noop_and_list_says_adopted`; `test_rerun_after_renaming_a_label_matched_column_adds_a_duplicate` (pins the documented limit); `test_group_filter_limits_targets_and_unknown_group_aborts`; `test_list_statuses_and_a_bad_workspace_does_not_abort_the_survey` (existing `--list` line format pinned); `test_ceiling_aborts_before_any_lock`; `test_output_has_counts_and_ids_only_with_secrets_planted_in_group_and_legacy_labels_and_values`; `test_legacy_rows_never_modified`; `test_workspace_isolation_with_the_same_group_id_in_two_workspaces`; `test_default_mode_still_refuses_with_a_merge_pointer`; `test_merge_after_fresh_adoption_and_live_use_restores_only_missing_data` (the incident); the existing fresh-interpreter and exit-code tests extended with `--merge`. Commit.

### Task 5: PostgreSQL concurrency and app-compatibility tests

Files: `tests/test_sprint_review_postgresql.py`, `tests/test_adopt_legacy_sprint_reviews.py`.

- [x] Opt-in PostgreSQL methods beside the existing adoption trio: `test_merge_holds_the_group_schema_lock_and_a_writer_then_sees_the_merged_rows`; `test_writer_holding_the_schema_lock_past_lock_timeout_makes_merge_exit_2_with_zero_writes` (covering the speculative-insert wait inside `_locked_schema`); `test_merge_takes_no_exclusive_lock_on_the_group_tables` (`pg_locks` at the `_before_write` seam); `test_merge_holds_the_first_group_lock_while_waiting_on_a_second_held_by_a_writer`.
- [x] SQLite service tests after a merge (a `search` stub is required, because `authorize_issues` would otherwise import `jira_server`): `load_review` and `read_values` return the merged columns and cells; a stale `baseSchemaRevision` returns `schemaConflict`; a layout save at `baseViewRevision` 0 on a Sprint that gained a view returns `viewConflict`; a cell draft at base 0 on an inserted cell returns `cellConflicts`. Commit.

### Task 6: Documentation and records

Files: the doc list above.

- [x] README.md and INSTALL.md: `--merge` and `--group`; the restore sequence for a serving app (backup, `--list`, `--merge` dry run, `--merge --apply` with the digest, `--list` again); the read-only lookup of a column's label by id; corrected privileges (merge path and the fresh path's lock needs); a new rollback row "After `--merge --apply`" (recovery is the pre-run backup or a point-in-time restore, which loses later writes; or keep the merge, which only adds); the "After the new app served and users wrote" row repointed to `--merge`; the auto-migrate paragraph (run the merge or fresh adoption after the first sync).
- [x] Feature doc, ontology entry (verified date, symbols resolve), the design lines listed in Spec, plan index row, the approved D-8 postmortem. Verify every path and symbol named resolves. Commit.

### Task 7: Rehearsal, full verification and completion record

- [x] Rehearse on a throwaway copy of a database holding legacy and live group data (never the operator's working database): dry run, apply, re-run is a no-op, `--list`. Record statement counts, duration and peak memory, and confirm or change `MERGE_MAX_INSERT_ROWS`. Keep counts only. **Result (2026-10-22):** on a throwaway copy of the local runner's database (dropped afterwards, the original untouched), `--list` showed `pending` and `adopted`; after emulating the incident (one workspace's group rows deleted, one live column saved in one group) it showed `needs-merge`, the fresh `--apply` refused (exit 1), the merge dry run planned 3 added columns and 4 cells per group (the archived legacy column's 2 cells dropped by intent), the apply wrote both groups (exit 0), a second apply printed "nothing to merge", `--list` showed `adopted` and the legacy rows were unchanged. Each CLI run took about 1 s and 107 MiB at its peak (the Python and SQLAlchemy baseline is 106 MiB). Scale probe at the ceiling (one group, 99,600 legacy cells and 6 columns, 99,606 planned rows, local PostgreSQL 16): dry run 2.3 s and 307 MiB, apply 14.7 s and 359 MiB, re-run dry run 3.3 s and 307 MiB with nothing to write, and all 99,600 cells inserted. Statement counts (two groups, small fixture, SQLite): dry run 7 reads; apply 23 (15 reads, 6 inserts, 2 updates); cell inserts scale as one statement per 100 rows. `MERGE_MAX_INSERT_ROWS` stays 100,000.
- [ ] **Open (operator):** if the production-like database is not reachable from a workstation, the operator runs a read-only `--list` and `--merge` dry run in a web pod of the staging environment and records the counts; the apply there is a separate operator decision. No staging access exists from this session, so this was not done.
- [x] At the exact head run: `python -m unittest discover -s tests` (the CI command; `make test` adds the same env vars), `make test-security`, `make verify-dist-clean` (no frontend change expected), and the PostgreSQL runner modules with `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1`. Record commands with actual pass, fail and skip counts; a skipped required check keeps its gate open. **Result at the code head `c7de86ff` (2026-10-22; the later commits change documentation only):** `python -m unittest discover -s tests` with the CI test environment: 2,379 tests OK, 42 skipped (the opt-in PostgreSQL modules among them), 140 s; the `make test-security` modules: 82 OK; the repository's own CI PostgreSQL runner script (exact CI URL, `GITHUB_ACTIONS=true`, a throwaway `jep_ci` database, dropped afterwards): 82 tests OK across its six modules, exit 0, including the 17 review tests; the adoption file alone: 72 OK. `make verify-dist-clean` was not run: nothing under `frontend/`, `package*.json` or the build script changed on this branch (empty diff against `origin/main`), so the compiled output cannot differ from what `origin/main` already carries; the frontend unit and Playwright suites do not apply.
- [x] Update this plan's status, outcome, current-accuracy and execution log and `docs/plans/README.md`; rename to `DONE-*` only after the work is accepted or merged (done on the operator's instruction, 2026-10-22).

## Execution status log

| Task | Status | Commit | Divergences |
| --- | --- | --- | --- |
| 1 | done 2026-10-22 | none (no commit step) | Branch is `bugfix/299-...` by operator direction, not `feature/`. Baseline: adoption 23 OK, runner contract 14 OK, PostgreSQL module 12 OK on a throwaway database. |
| 2a | done 2026-10-22 | `b64da786` | Three golden tests (rich, archive-only, layout-only workspace) instead of one; stdout compared in full including the digest, written rows compared as row counts plus sha256 prefixes. Expected counts derived by hand before capture; five temporary script mutations (cap bound, cell winner, orphan counter, view slice, written revision) each fail the goldens. Adoption file at HEAD: 26 tests OK. |
| 2b | done 2026-10-22 | `b23e5237` | `_plan` removed (its one caller was `_build`); no `state` parameter yet (Task 3). Layout aborts stay in `_resolve_group` to keep the error precedence. Verified: golden tests and all 23 existing tests unmodified (26 OK); PostgreSQL module 12 OK on a throwaway database; randomized differential run of the old `_plan` (from the Task 2a head) against the new pipeline, 4000 cases (1062 successful plans, 2938 error paths), 0 mismatches in results, exception types and messages, and the harness reports 144 mismatches when the cap bound is changed. |
| 3 | done 2026-10-22 | `abb1ca17` | As planned. `_resolve_group` returns extra keys (`added`, `matched`, `revision`, `empty`) for Task 4; the group state reader reads the cell identities of the legacy issues only. 16 new tests (13 pure resolution tests, 3 database tests incl. an empty identity map after the read and empty-state equals fresh). A randomized differential run (4000 cases) matches the original planner for the fresh path (report included) and for an empty-state merge; 8 mutations of the new rules each fail a test. |
| 4 | done 2026-10-22 | `bb2fb414` | Digest simplified: a group with nothing to insert contributes only `{'empty': True}` and `revision` carries the base revision (the plan's separate `base` field was redundant, and including `revision` for empty groups over-invalidated, which a mutation check exposed and a new test now pins). The reader treats a row with revision 0, no columns and no views as absent. `--group` validation message is `--group needs valid group ids`. 25 new tests (the plan's names were adjusted); 12 mutations of the write path and digest each fail a test. |
| 5 | done 2026-10-22 | `fca52323` | 4 PostgreSQL tests (writer waits then sees merged rows; lock timeout exit 2 with zero writes; no table-level lock on the group tables via `pg_locks`; first group's lock held while waiting on a second held by a writer, no deadlock) and 1 SQLite service test (reads return merged data; schema, view and cell conflicts for a stale client). `wait_until_blocked` gained a `count` argument. The lock-timeout behavior of the speculative-insert wait, unverified by the reviewers, is now exercised on PostgreSQL 16. 3 locking mutations each fail a test. |
| 6 | done 2026-10-22 | `5f436403` | README.md and INSTALL.md (restore steps, privileges, label-lookup query, rollback rows), feature doc, ontology (symbols resolve), the design-note lines, MRT033 and its index. The root `AGENTS.md` learning was not added: it needs the operator's wording (see Open items). |
| review | done 2026-10-22 | `c7de86ff` | One independent implementation review (no Blocker or P1); its findings are fixed in this commit and recorded below. The ceiling is now one number for the whole run, group columns need the app's shape, `--list` contains any data-shape failure and rejects `--merge` and `--group`, the report names the archived column that made a key skip, `expire_all` was dropped as redundant, and the docs were corrected. |
| 7 | done 2026-10-22 | the commit titled "Record completion of the merge-mode plan (#299)" | Rehearsal, scale probe and full verification as recorded under Task 7; the staging smoke is an open operator step. |

## Acceptance criteria

1. Default mode is unchanged: the 23 existing tests pass unmodified; the refusal still raises `ValueError`, exits 1 with zero writes, and now points to `--merge`.
2. `--merge` into a group without rows writes exactly the fresh path's state for every plan with an insert (columns JSON, cells, views, revisions); the golden-state test from Task 2a passes before and after the split.
3. Column resolution follows the claim pass, label pass, new-column rule and caps: kind and type checked, ambiguity aborts, at most one key per group column, group-archived columns never resurrected, slots counted across kinds.
4. A live cell (including a retained `NULL`) and a live view always win; no existing column property or live row changes (byte-identical snapshot); nothing is cleared.
5. `schema_revision` follows the state table; an empty-plan group is not locked or written; a lock-created row is never committed unless written.
6. Apply is atomic across groups, requires the digest, and follows the stated precedence (stale digest exit 1; empty plan exit 0 with no transaction); a failure in a later group rolls back every group.
7. A live save committed between phase A and the locks is detected: the run aborts with zero writes and the live column survives.
8. The digest is stable under row reordering and unrelated live edits and changes with a column change in a written group or any flipped decision. A second run is a no-op except the three documented exceptions (Known limits).
9. Locking: group schema rows through `_locked_schema` in sorted order, legacy tables in share mode, no `EXCLUSIVE` group-table lock; a writer holding a lock past 5 s gives exit 2 with zero writes; a writer blocked by the merge then sees the merged rows.
10. `--list` prints the five statuses in today's line format, never aborts on one bad workspace, and writes nothing.
11. Open clients get `schemaConflict`, `viewConflict` or `cellConflicts` and keep their drafts; reads return the merged data.
12. Output has counts and ids only, with secrets planted on both the group and the legacy side; legacy rows are untouched; same group ids in two workspaces stay isolated; `jira_server` is not imported.
13. The size ceiling aborts before any lock; the rehearsal records statement counts, duration and peak memory.
14. Docs, ontology (verified date, resolving symbols), the listed design lines, the rollback row and the plan index match the shipped behavior.
15. Full verification as in Task 7 passes at the exact head and the rehearsal record exists.

## Definition of Done

| Gate | Criteria | Evidence |
| --- | --- | --- |
| 1. Planner and resolution | 1, 2, 3, 4, 5 | Unit test output with counts; golden-state test before and after the split. |
| 2. Write path and CLI | 6, 7, 8, 10, 12, 13 | Unit tests including the phase-gap regression, digest, idempotency, `--list`, hygiene, ceiling. |
| 3. Concurrency and app compatibility | 9, 11 | PostgreSQL race tests run with `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1`; service tests. |
| 4. Records | 14 | Documentation diff; resolving paths and symbols. |
| 5. Suites and rehearsal | 15 | Commands with pass, fail, skip counts; rehearsal and staging-smoke record without values. |

Record the implementation and base revisions, Python version, a result and evidence reference per gate, commands with actual counts, the rehearsal summary and remaining limits. A skipped or environment-blocked required check keeps its gate open.

## Review focus

1. Fresh-versus-merge equivalence after the planner split, especially cap ranking with per-group slots.
2. The identity-map hazard: nothing read before the locks may be used after them.
3. Injective matching and its interaction with caps and archive rules.
4. Digest invariance under unrelated live edits versus sensitivity to every plan-changing edit.
5. The inherited-view side effect of inserting older legacy views (D-11).

## Known limits

- A label-matched column carries no provenance: if it is renamed between two merges, the second adds it again as a new column (D-12, pinned by a test); archiving it does not, because a group-archived column stays archived. A user archiving a column frees an active slot, so a later run can adopt a key that was previously cap-excluded, and a Sprint view row an operator purged (the documented way to free the view cap) is inserted again by the next merge. All three are stated in the runbook; the last two follow from the rules and are not pinned by their own tests.
- Matching by label can pair two unrelated columns; the report is the check.
- Inserting older legacy views changes what later unsaved Sprints inherit (D-11 and the reported intervals). A merge can fill a group's 500-view cap, after which `save_review` rejects first layout saves in new Sprints.
- With active writers the digest can mismatch between the dry run and the apply (a column change in a written group); re-run the dry run.
- Recovery: there is no automatic undo and no complete undo list (cell inserts into matched columns cannot be listed without issue ids). The pre-run backup or a point-in-time restore is the only rollback and loses writes made since; keeping the merge is safe because it only adds.
- A merge cannot repair data lost by a downgrade of `20261020_0019` or by purged legacy rows. Columns beyond the caps are listed, not adopted. Malformed live group columns abort the run.
- Torn reads between the dry run's queries only cause false digest mismatches, never false matches; the apply re-reads after the locks.
- Automatic adoption in startup, migration or the release chart is out of scope (D-9).

## Validation record

Three independent read-only reviews on 2026-10-22 (concurrency and data semantics; script refactor and tests; operations, documentation and conformance). The first two independently found the Blocker below; I reproduced it on SQLite and checked the cited code for the other findings I could verify. Applied in this revision:

- **Blocker:** the under-lock recompute used the session's identity-mapped schema row, so a live column committed between the pre-read and the lock would be overwritten while the digest still matched. Applied as the two-phase apply (a new write session that re-reads every input through Core projections after the locks), the `_before_lock` seam and its regression tests (SQLite and PostgreSQL). The implementation review later showed the extra `expire_all()` to be redundant with the new session, and it was removed.
- **P1:** revision rules contradicted fresh equivalence (state table added, equivalence qualified); lock-created rows could be committed on a non-write exit and the digest versus "nothing to merge" order was unspecified (precedence and rollback specified); matching was not injective (claim pass first, one key per column, kind and type checks); re-run provenance for label matches (documented limit, D-12); planner-based `--list` broke an existing test and one bad workspace aborted the survey (planned only when group rows exist, per-workspace error status); the planner split boundaries and golden fixture were wrong (corrected, test committed first); rollback was overstated (honest section and rollback row); later-created groups would receive legacy data (D-10).
- **P2 and minor:** view slice at zero slots; cap slots across kinds; digest base revision only for written groups; cell-draft row in the open-clients table; test ordering between tasks; vacuous lock-order, leak and isolation tests; hollow label safeguard (runbook lookup); group-column validation; size ceiling and memory; privileges; decisions D-2, D-3, D-9 re-framed with alternatives and downstream facts; the design lines to update; wording ("Sync hook", "bit-identical", "three-step"); execution log; branch; `make test` versus the CI command; staging smoke; downstream handoff; the inherited-view intervals report (D-11).

Not verified by any reviewer: PostgreSQL behavior of `lock_timeout` on the speculative-insert wait inside `_locked_schema`, the `pg_locks` assertion, and the race tests themselves (Task 5 proves them). This revision has not been re-validated.

### Implementation review (2026-10-22)

One independent read-only pass over `origin/main..HEAD` (script, tests, docs) found no Blocker and no P1: its attempts to overwrite, clear, duplicate or resurrect live data, to deadlock with an app writer, or to diverge from the original planner on the fresh path all failed. Findings and dispositions:

- **P2, fixed:** `--list` aborted on a data-shape failure that is not a `ValueError` (a group column without `archived` raised a raw `KeyError`, reproduced) and group columns were not required to have the app's shape (boolean `archived`, integer `order`); `--list` now reports `error` for such a workspace and keeps surveying, and the reader aborts with a count.
- **P2, fixed (docs):** archiving a label-matched column does not duplicate it (only a rename does, reproduced), and purging a Sprint view row makes the next merge insert it again, so the no-op paragraph now lists three exceptions.
- **P2, fixed:** the report named nothing when a group-archived column made a key skip; it now lists `skipped <legacy id> -> <archived group column id>`.
- **P2, fixed:** the ceiling was per group while the run is one transaction holding every written group's lock; it is now one number for the whole run, with `--group` to merge in batches.
- **P2, fixed:** stale status lines, a missing `nothing to adopt` status in the feature doc, privileges without `SELECT` on `workspaces`, `workspace_group_configs` and the legacy tables, and "label and type" without kind.
- **Minor, fixed:** `--merge --list` ran a plain survey ignoring both flags (now rejected); the PostgreSQL requirement for the no-quiesce claim is stated; error paths now have tests (labels never leaked from a malformed group column, a database error during the merge write is sanitized and rolls back); a PostgreSQL test now has a writer commit between the two phases.
- **Minor, decided:** `session.expire_all()` was redundant (the write phase is a new session reading state after every lock) and was removed. A longer lock timeout for the two-group PostgreSQL test was tried and reverted: the writer connection's own 5 s lock timeout (set in the test URL) then expired before the merge released, so the test relies on both waits being seen inside the merge's 5 s; it passed three runs in a row, and a heavily loaded runner remains a residual flakiness risk.

## Open items

- **Operator:** the read-only `--list` and `--merge` dry run in a staging pod (Task 7); no staging access from this session.
- **Operator wording needed:** a root `AGENTS.md` section 11 learning. Candidate: "A migration that moves data must run the move or fail loudly; a merge into live tables takes the app's own row lock first and re-plans from the locked state, never reusing entities read before the lock; probe the database the running process uses, not the one a config file resolves."
- **Downstream:** the release repository must sync this change and add an adoption/restore step to its own runbook (its migration Job stays migrate-only; its image already carries the script).
- **Separate plan (D-9):** a non-blocking startup or preflight warning when legacy data exists and a merge would still insert something.
- **Not run, with the reason:** `make verify-dist-clean` and the frontend suites (no frontend change on this branch).
- **Delivery:** nothing is pushed and no PR exists; publication follows `AGENTS.md` section 10 only when the operator asks.
- **Residual risks:** the two-group PostgreSQL race test's timing under heavy load; label matching can pair two unrelated columns (the report names every pair by id); no automatic undo (the pre-run backup is the rollback).

## Outcome

Implemented with changes, locally on `bugfix/299-review-adoption-merge-mode` (issue #299): all tasks done, one review-fix commit, verified as recorded under Task 7; the changes are the digest simplification, the whole-run ceiling, the dropped `expire_all` and renamed tests, each recorded in the execution log and the implementation review. Not yet pushed; accepted by the operator on 2026-10-22.

## Current Accuracy

Accurate with the divergences recorded in the execution log and the implementation review (digest simplification, whole-run ceiling, `expire_all` dropped, test names). The implementation is the source of truth for details; the Design section still describes it, except where those records say otherwise.
