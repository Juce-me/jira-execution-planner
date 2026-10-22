# Planning review automatic adoption on release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Draft for operator decisions D-1 to D-9. Not validated by independent review, not started. Execution is blocked until the operator answers the decisions below.
Type: improvement (one Alembic data revision, a shared pure planner, operator script retargeted onto it, tests, docs)
Branch: `bugfix/299-review-adoption-merge-mode`, pull request #300, by the operator's direction of 2026-10-22 ("use the same branch and add to the same pr, it's unmerged yet"). When implementation lands the pull request grows beyond its current title and "Closes #299" description; both are updated then.
Written: 2026-10-22 against `origin/main` `41c47562` plus the unmerged #299 branch (`--merge` engine in `scripts/adopt_legacy_sprint_reviews.py`), `backend/db/migrations/env.py`, `backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py`, `scripts/docker-entrypoint.sh`, `runners/local/run.sh`, `INSTALL.md`, `docs/postmortem/MRT033-review-columns-hidden-after-migration.md`.

**Goal:** A release that runs `alembic upgrade head` adopts every workspace's legacy per-Sprint review columns, values and Sprint views into its Department groups by itself, once, so saved columns are available in the app as soon as the new version serves, with no operator step and no chart change.

**Architecture:** The planning rules (`_normalize`, `_match_group_columns`, `_resolve_group` and their constants) move unchanged from the script into a pure module, `backend/services/review_adoption.py`. The script keeps its ORM input/output and CLI; a new Alembic revision supplies a second input/output adapter on the migration connection and calls the same planner. A new revision gives run-once semantics, atomic rollback with the schema steps and a retry path for free, and it runs everywhere migrations run: the downstream migrate-only Job, `RUN_DB_MIGRATIONS=true` entrypoints and `runners/local/run.sh`.

**Tech Stack:** Python 3.10-compatible, Alembic, SQLAlchemy Core, SQLite unit tests, the opt-in PostgreSQL tests run by `runners/github/run-postgresql-tests.sh`.

**Spec (source of truth):** [DONE-planning-review-adoption-merge-mode.md](DONE-planning-review-adoption-merge-mode.md) for the merge rules (this plan reuses them and changes none) and [SUPPORT-planning-review-sprint-inheritance-design-267.md](SUPPORT-planning-review-sprint-inheritance-design-267.md), section "Existing per-Sprint tables". This plan reverses decision D-9 of the merge-mode plan ("Automatic adoption in startup, migration or the release chart is out of scope"), at the operator's direction.

## Why

- Migration `20261020_0019` creates empty group tables and does not move data. Every path that migrates without running the adoption script hides every saved column; MRT033 records the incident (a custom Planning column "disappeared" after the Sprint became active, and a production workspace still shows only `no group schema row` for its legacy column).
- `--merge` (#299) makes the restore possible, but it stays a manual, digest-gated operator step. The operator needs the columns back as part of the release itself.

## Direction (operator, 2026-10-22)

"I need hidden columns to be unhidden or available to select in the app after the merge." Then, on being told the approved design keeps adoption manual: "Yes, plan automatic adoption on release as a new plan; I know it reverses D-9." Then: "use the same branch and add to the same pr, it's unmerged yet."

## Facts verified in the source

- `backend/db/migrations/env.py` runs `context.run_migrations()` inside one `context.begin_transaction()` and never sets `transaction_per_migration`, so on PostgreSQL every pending revision of one `upgrade` shares one transaction: a failure rolls back all of them, and a lock the adoption step waits behind or holds extends the earlier DDL locks of the same run.
- Callers of `alembic upgrade head`: `scripts/docker-entrypoint.sh` (only when `RUN_DB_MIGRATIONS=true`, then `scripts/check_startup_preflight.py`), `runners/local/run.sh` (always, then the preflight), and the downstream chart's migrate-only Job (outside this repository; it already runs the image's `alembic upgrade head`).
- Existing data revisions here (`20260827_0008_remove_workspace_epm.py`) import only `alembic`, `json` and `sqlalchemy`, use `op.get_bind()` and `sa.text`, and never import live models, so a later schema change cannot break their replay.
- The merge engine's planner (`_normalize`, `_match_group_columns`, `_resolve_group`) already takes and returns plain dicts and lists; its input functions (`_legacy`, `_read_group_state`) and output functions (`_write_merge`, `_lock_merge`) use ORM models and `sprint_review._locked_schema`.
- `sprint_review._locked_schema` takes the lock every app save takes first: `INSERT ... ON CONFLICT DO NOTHING` on `(workspace_id, group_id)`, then `SELECT ... FOR UPDATE` on that row.
- `_set_timeouts` uses transaction-local `set_config`, which inside the shared Alembic transaction would leak a 5 second lock timeout into later statements unless restored.
- Measured for the script at the 100,000-row ceiling (single group, local PostgreSQL 16): dry run about 2 seconds and 310 MiB, apply about 15 seconds and 360 MiB peak.
- No other open pull request adds a revision; `20261020_0019` is the head on `origin/main`. `tests/test_db_migrations.py` pins only the range `20261001_0018:20261020_0019` (offline SQL), so a new head breaks no test.

## Decisions for the operator

Recommendations are marked; reply "take the recommendations" to accept all.

- **D-1 Mechanism.** (a) Alembic data revision (recommended): once-only by construction, runs in every release path, transactional with the schema steps, no chart change. (b) `--auto` CLI mode run from the entrypoint, `run.sh` and a new chart Job: no migration coupling, but the migrate-only chart path does nothing until the downstream repository adds a step, and it needs its own once-marker. (c) Run at web startup: every replica races, a write path in the serving process. (d) Lazy adoption at first group access: covers only groups without rows, turns reads into writes, needs a marker table.
- **D-2 Scope.** Run the merge engine for every workspace that has legacy review data and at least one configured group (recommended: covers both the no-rows case and the rows-exist case, and only adds rows). Alternative: only workspaces with no group rows, leaving the merge case to the script.
- **D-3 Failure policy.** Transient failures (lock timeout `55P03`, statement timeout, connection loss) fail the upgrade, so the revision is not stamped, nothing is written and a retry is clean (recommended; the cost is that a release can fail on a busy moment). Deterministic per-workspace refusals (no group configured, malformed legacy row, plan above the 100,000-row ceiling) skip that workspace, log its id and reason, and let the others and the revision finish; the operator then uses the script. Alternative: never fail the upgrade (a transient failure then stamps the revision with nothing adopted, and nothing retries it).
- **D-4 Matching without review.** Keep id first, then casefolded label, kind and type (recommended; the merge-mode plan's D-3). The digest review that named every label pairing is gone, so a mis-pairing is not seen before it is written, but it only fills missing cells and never overwrites. Alternative: id only, which duplicates a column a user rebuilt by hand.
- **D-5 Where the planner lives.** Extract it to `backend/services/review_adoption.py` (recommended); the script keeps aliases so existing tests pass unmodified. Alternative: have the revision import the script from `scripts/`, which makes `backend/` depend on `scripts/` and breaks if the script is not in the image.
- **D-6 Model coupling.** The revision uses frozen Core table definitions and raw statements for its input and output, like `20260827_0008` (recommended; costs one more adapter, about 150 lines, held equal to the script's by a differential test). Alternative: import live models and rely on a replay test to fail when a later revision changes those tables (smaller, but a stale revision then fails on a customer's database, not in CI).
- **D-7 Kill switch.** `REVIEW_ADOPTION_ON_UPGRADE`, default on; `false` stamps the revision, writes nothing and logs one line (recommended, for an environment that must adopt by hand). With it off the data is never adopted automatically later.
- **D-8 Delivery.** Plan now, implement on this branch after the operator approves this plan, then update the pull request title and body. Risk: a data-writing migration in a bugfix pull request gets one review; the operator may split it later.
- **D-9 Tracking.** No new issue is created without the operator's go-ahead; reuse #299 unless told otherwise.

## Design

### Revision

- File `backend/db/migrations/versions/<date>_0020_adopt_legacy_sprint_reviews.py`, `down_revision = '20261020_0019'`, `<date>` set on the implementation day. Revisions 0019 and earlier are not edited.
- `upgrade()`: in offline mode (`context.is_offline_mode()`) emit a comment and nothing else. Otherwise, with the kill switch on, run `adopt_all(op.get_bind())`.
- `downgrade()`: no-op, documented. Adopted rows are additive and cannot be listed afterwards; the pre-release backup is the rollback. A downgrade below 0019 drops the group tables anyway.

### Engine

- `backend/services/review_adoption.py` holds the pure planner and the canonicalizers split out of `_legacy` and `_read_group_state` (row dicts in, canonical dicts out). No session, no models, no environment.
- The script's input/output (ORM) and the revision's input/output (frozen Core tables) both feed it. A differential test runs both adapters on randomized seeds and requires equal plans, writes and digests.

### Run sequence inside the revision

1. Cheap guard: if `workspace_sprint_reviews` has no row with content, return (a fresh install writes nothing and takes no lock).
2. Save `lock_timeout` and `statement_timeout`, set the script's 5 and 60 seconds locally, and restore them in a `finally`.
3. For each workspace with legacy content, in sorted id order, inside `connection.begin_nested()` (one savepoint per workspace):
   1. Read configured groups; none: skip with reason.
   2. Take `LOCK TABLE ... IN SHARE MODE` on the two legacy tables, then the app's schema-row lock per group in sorted order (same statements as `_locked_schema`).
   3. Read legacy and group state after the locks, plan with the pure planner, apply the 100,000-row ceiling (over: skip with reason), write only the groups with something to insert.
   4. Log one line: workspace id, group count, groups written, columns, cells and views inserted, plan fingerprint. Never labels or values.
4. Per D-3: a transient error escapes (the savepoint and the whole transaction roll back); a deterministic refusal rolls back only that workspace's savepoint and continues.
5. End with one summary line: workspaces adopted, skipped (with ids), nothing to merge.

### Operator tooling after this change

`--list`, the dry run and `--merge --apply` stay the recovery and verification tools (skipped workspaces, kill-switch environments, groups created after the release). They are not removed and their behavior does not change.

## Tasks

### Task 1: failing contract tests

Files: Create `tests/test_review_adoption_migration.py`; Modify `tests/test_sprint_review_postgresql.py`.

- [ ] SQLite: seed 0019 with legacy rows and a configured group, `upgrade head`, assert adopted columns, cells, views and revision; a second `upgrade head` is a no-op; empty legacy tables write nothing.
- [ ] Kill switch: `REVIEW_ADOPTION_ON_UPGRADE=false` stamps the revision and writes nothing.
- [ ] Per-workspace refusal (no group configured; malformed column) skips only that workspace and logs its id.
- [ ] Offline `--sql` output has no data statements; `downgrade` to 0019 is a no-op.
- [ ] PostgreSQL: a held schema-row lock past the timeout fails the upgrade, leaves `alembic_version` at 0019 and writes nothing; a rerun succeeds; a concurrent app save during the step is neither overwritten nor deadlocked; `lock_timeout` and `statement_timeout` equal their prior values after the step.
- [ ] Log lines contain ids and counts only (assert no label or value text).
- [ ] Run: tests fail for the right reason (no revision yet).

### Task 2: extract the planner, no behavior change

Files: Create `backend/services/review_adoption.py`; Modify `scripts/adopt_legacy_sprint_reviews.py`.

- [ ] Move the pure functions and constants; split `_legacy` and `_read_group_state` into row reading and pure canonicalizing; leave aliases in the script.
- [ ] Gate: the existing 72 script tests, the golden-state tests, the randomized differential against the pre-extraction script, and the 17 PostgreSQL review tests pass unmodified; the script's report and digest bytes are identical.

### Task 3: migration adapter and `adopt_all`

Files: Create the revision file; Modify `backend/services/review_adoption.py` only for shared pure helpers.

- [ ] Frozen Core table definitions for the five tables, Core input/output on `op.get_bind()`, the run sequence above, savepoints, timeout restore, kill switch, logging.
- [ ] Differential test: adapter equality with the script's on randomized seeds.

### Task 4: PostgreSQL verification

Files: `tests/test_sprint_review_postgresql.py`.

- [ ] The Task 1 PostgreSQL tests pass; run `runners/github/run-postgresql-tests.sh`.
- [ ] Rehearsal on a throwaway copy of a database at 0019 that holds legacy rows and no group rows: `alembic upgrade head`, then the post-release query (legacy data with no group counterpart) returns zero rows. Scale probe: one workspace at the ceiling inside `alembic upgrade`, record time and peak memory against the downstream Job's limits.

### Task 5: docs

Files: `INSTALL.md`, `README.md`, `docs/features/planning-sprint-review.md`, `docs/ontology.md`, `docs/postmortem/MRT033-review-columns-hidden-after-migration.md`, `docs/plans/DONE-planning-review-adoption-merge-mode.md` (note that D-9 is reversed by this plan), `docs/plans/README.md`.

- [ ] INSTALL: the cutover steps become verification steps (`--list`, the post-release query); document the kill switch, the transient-failure retry, skipped workspaces and the single-transaction lock note; the script stays the recovery tool.
- [ ] MRT033: corrective actions record the automatic adoption; the startup warning stays a separate, optional plan.
- [ ] Analytics impact: no event; the change restores existing data without a new user-visible control. Record the allowlist reason in the plan's execution log.

### Task 6: full verification and delivery

- [ ] Full Python suite and `tests.test_codebase_structure_budgets` (re-sync `scripts/extraction_lint/owner_budgets.json` only if it registers a changed file); the full Chromium `tests/ui` run per section 10 (no frontend change expected).
- [ ] Publication transaction per section 10 for the pushed commits; update the pull request title and body; rename this plan to `DONE-` with the delivery note when accepted.

## Acceptance criteria

1. `alembic upgrade head` from 0019 on a database with legacy rows and a configured group produces the same group columns, cells, views and schema revision as `--merge --apply` on the same seed (differential).
2. A second `upgrade head`, and any later release, adopts nothing; `--list` reports `adopted`.
3. No legacy data: the revision stamps, writes nothing and takes no lock beyond one read.
4. Kill switch off: stamped, nothing written, one log line.
5. Transient failure: upgrade fails, revision unstamped, nothing written, rerun succeeds.
6. Deterministic refusal in one workspace: that workspace is skipped with id and reason in the log, others adopt, the revision stamps.
7. Live data is never overwritten, cleared, renamed or resurrected (the merge-mode guarantees hold through the migration path).
8. After the upgrade the app service returns the adopted columns for the group (the app-compat check).
9. Session timeouts are restored after the step; offline SQL has no data statements; `downgrade` is a no-op.
10. Logs carry workspace ids and counts only.
11. Fresh `upgrade base` to head works on SQLite and PostgreSQL.

## Forbidden regressions

- No change to `--merge`, `--list`, the default dry run or their digests (rule versions `adopt-legacy-sprint-reviews/1` and `/2-merge`).
- No edit to revisions 0019 and earlier.
- No live model imports in the new revision.
- No write to legacy tables; no overwrite of any group data.
- No change to the app's save, load or lock behavior.

## Files allowed to touch

Create: `backend/services/review_adoption.py`, `backend/db/migrations/versions/<date>_0020_adopt_legacy_sprint_reviews.py`, `tests/test_review_adoption_migration.py`. Modify: `scripts/adopt_legacy_sprint_reviews.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_adopt_legacy_sprint_reviews.py` (only if an alias cannot hold), `INSTALL.md`, `README.md`, `docs/features/planning-sprint-review.md`, `docs/ontology.md`, `docs/postmortem/MRT033-review-columns-hidden-after-migration.md`, `docs/plans/DONE-planning-review-adoption-merge-mode.md`, `docs/plans/README.md`, and `scripts/extraction_lint/owner_budgets.json` if the lint requires it.

## Risks and limits

- **Unattended writes.** No human sees the report before the write. Mitigations: additive-only merge rules, per-workspace ceiling, logged fingerprints, the kill switch, a differential test against the reviewed script path, and the pre-release backup as the only rollback (point-in-time restore loses later writes).
- **Release availability.** Under D-3's recommendation a lock timeout fails the release job until it is retried. Whether the downstream Job retries is outside this repository.
- **Lock scope.** The step runs inside the single Alembic transaction; for an upgrade that also creates 0019's tables, the foreign-key locks on `workspaces` last until the whole run commits. Production at 0019 runs only this revision.
- **Resources.** The step runs in the migration process; the script's measured 360 MiB at the ceiling must fit the downstream Job's limits (checked in Task 4, enforced downstream).
- **Once-only.** Groups created after the release, and legacy rows in an environment that used the kill switch, are not adopted automatically; the script is the tool.
- **Planner drift.** The revision calls the shared pure planner, so a later planner change alters what a replayed revision does for a database that has not yet run it. Golden tests pin the planner's output.
- **Pull request size.** The bugfix pull request gains a migration (D-8).

## Execution status (fill during execution)

| Task | Status | Commit | Notes |
| --- | --- | --- | --- |
| 1 to 6 | not started | | Waiting for the operator's answers to D-1 to D-9. |
