# Planning review automatic adoption on release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Draft, revision R2 (2026-10-23), validated once by three independent read-only reviews whose findings are applied (see Validation record). Not started. Execution is blocked until the operator answers D-1 to D-8.
Type: improvement (one Alembic data revision, a shared planner module, the operator script retargeted onto it, tests, docs)
Branch: `bugfix/299-review-adoption-merge-mode`, pull request #300, by the operator's direction of 2026-10-22 ("use the same branch and add to the same pr, it's unmerged yet"). When implementation lands the pull request grows beyond its current title and "Closes #299" description; both are updated then.
Written: 2026-10-22 and revised 2026-10-23 against `origin/main` `41c47562` plus the unmerged #299 branch (the `--merge` engine in `scripts/adopt_legacy_sprint_reviews.py`), `backend/db/migrations/env.py`, `backend/db/alembic.ini`, `backend/services/sprint_review.py`, the existing revisions, `scripts/docker-entrypoint.sh`, `runners/local/run.sh`, `INSTALL.md`, `docs/postmortem/MRT033-review-columns-hidden-after-migration.md`.

**Goal:** A release that runs `alembic upgrade head` adopts the legacy per-Sprint review columns, values and Sprint views into every Department group that has no review rows yet, once, so saved columns are available in the app as soon as the new version serves, with no operator step and no chart change.

**Architecture:** The planning rules (`_normalize`, `_match_group_columns`, `_resolve_group`) move into a shared module, `backend/services/review_adoption.py`, which takes its validation rules (column and view caps, schema and layout appliers, identity checks) as an injected object instead of importing the app. The script injects the live `sprint_review` module; a new Alembic revision injects a frozen snapshot of those rules and supplies its own input/output on the migration connection with frozen Core tables. A revision gives run-once semantics, rollback with the schema steps and a clean retry, and it runs wherever migrations run: the downstream migrate-only Job, `RUN_DB_MIGRATIONS=true` entrypoints and `runners/local/run.sh`.

**Tech Stack:** Python 3.10-compatible, Alembic, SQLAlchemy Core, SQLite unit tests, the opt-in PostgreSQL tests run by `runners/github/run-postgresql-tests.sh`.

**Spec (source of truth):** [DONE-planning-review-adoption-merge-mode.md](DONE-planning-review-adoption-merge-mode.md) for the merge rules this plan reuses, and [SUPPORT-planning-review-sprint-inheritance-design-267.md](SUPPORT-planning-review-sprint-inheritance-design-267.md), section "Existing per-Sprint tables". This plan reverses decision D-9 of the merge-mode plan ("Automatic adoption in startup, migration or the release chart is out of scope") at the operator's direction, and changes statements in the documents listed under Task 5.

## Why

- Migration `20261020_0019` creates empty group tables and does not move data. Every path that migrates without running the adoption script hides every saved column; MRT033 records the incident. The operator reported that a production workspace still shows only a legacy column and no group schema row.
- `--merge` (#299) makes a restore possible, but it stays a manual, digest-gated step. The operator needs the columns back as part of the release itself.

## Direction (operator, 2026-10-22)

"I need hidden columns to be unhidden or available to select in the app after the merge." Then, on being told the approved design keeps adoption manual: "Yes, plan automatic adoption on release as a new plan; I know it reverses D-9." Then: "use the same branch and add to the same pr, it's unmerged yet." Then: "validate the plan with subagents."

## Expected behavior

- A database at `20261020_0019` or earlier upgraded to head gets, for each workspace with legacy review content and at least one configured group, the legacy columns, values and Sprint views in every group that holds no review row at the moment it is locked. Groups that already hold rows are untouched and logged.
- The upgrade fails, rolls back and can be retried when the database misbehaves (lock timeout, deadlock, connection loss, missing tables, permission or integrity errors). A workspace the planner cannot plan (malformed legacy data, no configured group, more legacy cells than the run budget) is skipped with its id and reason in the log and is left for the script.
- Nothing is written to a legacy table, and no group row, cell, view or column that exists is changed.

## Facts verified in the source

Verified by this author unless marked "reviewer-verified" (a reviewer's experiment, re-proven by the named Task 1 or 4 test before it is relied on).

- `backend/db/migrations/env.py` runs `context.run_migrations()` inside one `context.begin_transaction()` and never sets `transaction_per_migration`. On PostgreSQL every pending revision of one `upgrade` shares one transaction (reviewer-verified: a combined run rolls back as one). On SQLite, Alembic's `transactional_ddl` is false, so each revision has its own transaction (reviewer-verified).
- `backend/db/alembic.ini` sets the root, `sqlalchemy.engine` and `alembic` loggers to WARN and `env.py` calls `fileConfig`, so INFO lines never reach the job log (reviewer-verified; the file lines 10-30 were read).
- Callers of `alembic upgrade head`: `scripts/docker-entrypoint.sh` (only when `RUN_DB_MIGRATIONS=true`, then `scripts/check_startup_preflight.py`), `runners/local/run.sh`, `runners/github/run-postgresql-tests.sh`, about 13 test modules (including `tests/test_sprint_review.py` and `tests/test_sprint_review_postgresql.py`) and the downstream chart's migrate-only Job (outside this repository). `tests/test_postgresql_runner_contract.py` pins the runner order. The preflight reports `at head` or fails with "migrations are not at head".
- No revision under `backend/db/migrations/versions/` imports any `backend.*` module. `20260902_0011_screen_scoped_onboarding.py` uses frozen `sa.table(...)` stubs; revisions detect offline mode with `op.get_context().as_sql`.
- `_resolve_group` calls `sprint_review.validate_schema_changes`, `apply_schema`, `apply_layouts` and reads `REVIEW_LAYOUT_BUILTINS` and `MAX_GROUP_VIEWS`; the existing tests patch `review.validate_schema_changes`, `apply_schema`, `apply_layouts` and `MAX_GROUP_VIEWS` (`tests/test_adopt_legacy_sprint_reviews.py` lines 389-391, 407, 421, 548, 665, 741). `sprint_review.py` imports models, auth and flask modules (reviewer-verified: about 140 modules). The rule functions total about 123 lines (`validate_schema_changes` 49, `apply_schema` 46, `apply_layouts` 15, identity helpers 13). `_normalize` and `_match_group_columns` take and return plain data (reviewer-verified).
- `sprint_review._locked_schema` takes the lock every app save takes first: `INSERT ... ON CONFLICT DO NOTHING` on `(workspace_id, group_id)` with revision 0 and empty columns, then `SELECT ... FOR UPDATE`. The script locks only groups whose plan writes (`_merge`) and a locked-but-empty group keeps a revision-0 row, which makes a later fresh `--apply` refuse (reviewer-reproduced).
- A lock taken inside a savepoint survives `RELEASE` until commit; only `ROLLBACK TO` frees it (reviewer-verified in `pg_locks`). App saves have no lock timeout and queue behind an uncommitted adopter insert (reviewer-verified).
- `_set_timeouts` uses transaction-local `set_config`; restoring in a `finally` after an aborted PostgreSQL transaction raises `InFailedSqlTransaction` over the original error (reviewer-verified). The review columns are `json`, so `json <> json` has no operator and content checks belong in Python (reviewer-verified).
- The script sanitizes `DBAPIError` because driver messages echo bound parameters; Alembic would print them in a traceback.
- Measured for the script at the 100,000-row ceiling (single group, local PostgreSQL 16): dry run about 2 seconds and 310 MiB, apply about 15 seconds and 360 MiB peak. These are single-group CLI figures, not migration figures.
- No other open pull request adds a revision; `20261020_0019` is the head on `origin/main`. `tests/test_db_migrations.py` pins the offline range `20261001_0018:20261020_0019`, but other tests upgrade to `head` and will run the new revision.
- `scripts/extraction_lint/owner_budgets.json` registers only `frontend/` paths; no file in this plan is registered.

## Decisions for the operator

Recommendations are marked; reply "take the recommendations" to accept all.

- **D-1 Mechanism.** (a) Alembic data revision (recommended): once-only, runs in every release path, transactional with the schema steps, no chart change. (b) `--auto` CLI run from the entrypoint, `run.sh` and a new chart Job: no migration coupling, but the migrate-only chart path does nothing until the downstream repository adds a step, and it needs its own once-marker. (c) Run at web startup: every replica races, a write path in the serving process. (d) Lazy adoption at first group access: covers only groups without rows, turns reads into writes, needs a marker table.
- **D-2 Scope.** (a) Adopt a group only when it holds no review row (no schema row, so no cells or views) at the moment its schema row is locked (recommended); every other group is untouched and logged, and `--list` then reports its workspace `needs-merge` for the script. This removes the unattended hazards below, and it makes a replay (`downgrade 20261020_0019`, then `upgrade`) a no-op for adopted groups. (b) Every configured group through the full merge semantics: restores a group a user already saved into, but unattended it can pair a legacy label with a live column of the same name without review, insert older legacy views that change what live Sprints inherit (merge-mode D-11 (ii) is the safe variant), re-add a column the group renamed or refill a slot the group freed (the merge-mode plan's three non-idempotence exceptions, which bite on the first automatic run of a hand-adopted database), and fill the 500-view cap. In both options a configured group created after the release that holds no rows receives the legacy columns, the same as the original cutover would have done at run time.
- **D-3 Failure policy.** Classify by origin, not by SQLSTATE (recommended). Every exception raised by a database call escapes and fails the upgrade (re-raised without driver text), so nothing is stamped and a retry is clean; the cost is that a release can fail on a busy moment. Only data errors raised by the pure planning and canonicalizing calls (`ValueError`, `KeyError`, `TypeError`, `AttributeError`), a workspace with no configured group, and a workspace over the run budget skip that workspace. A required-tables check fails the upgrade first. Alternative: never fail the upgrade; a transient failure then stamps the revision with nothing adopted and nothing retries it.
- **D-4 Matching and views (only if D-2 (b)).** Match by id only and insert only legacy views older than every live view (recommended for unattended runs); a rebuilt column is then duplicated and archived with one click. Alternative: the script's id-then-label matching and all legacy views, with the unreviewed pairing risk.
- **D-5 Planner location.** Extract the planner to `backend/services/review_adoption.py` with injected rules (recommended); the script passes the live `sprint_review` module and keeps aliases, so existing tests pass unmodified. Alternative: have the revision import the script from `scripts/`, which makes `backend/` depend on `scripts/`.
- **D-6 Rules inside the revision.** A frozen snapshot of the rules (about 150 lines) with a parity test against the live rules and a tripwire test that fails when the live rules change (recommended): a replayed revision then does what it did when written. Alternative: import live `sprint_review` inside `upgrade()` (smaller, but it is the first revision importing app code, loads about 140 modules, and applies the app's then-current caps to a customer database).
- **D-7 Kill switch.** `REVIEW_ADOPTION_ON_UPGRADE`, read from the process environment only (Alembic does not load `.env` and `run.sh` does not source it; the downstream chart owns the Job environment). Unset or `true` runs; `false` skips; any other value fails the upgrade (recommended, fail closed). With it off the revision logs the count of workspaces that hold legacy data; the data is then never adopted automatically.
- **D-8 Outcome record.** The upgrade log plus `--list` are the record (recommended; Job logs may not persist downstream, `--list` is durable). Alternative: an audit table, which needs its own schema step.

Process notes, not decisions: delivery is this branch and pull request after the operator approves; no new issue is created, #299 is reused unless told otherwise.

## Design

### Revision

- File `backend/db/migrations/versions/20261023_0020_adopt_legacy_sprint_reviews.py`, `down_revision = '20261020_0019'`. Revisions 0019 and earlier are not edited. Repository imports happen inside functions, not at module level (Alembic loads every revision for every command).
- `upgrade()`: offline (`op.get_context().as_sql`): emit a note through the offline output that adoption is not rendered and must be run by the script, and render nothing else (offline output still stamps the version). Otherwise parse the kill switch (D-7) and run `adopt_all(op.get_bind())`.
- `downgrade()`: no-op, documented. Adopted rows are additive and cannot be listed afterwards; the pre-release backup is the rollback. A downgrade below 0019 drops the group tables, and the next upgrade adopts again from the untouched legacy tables.

### Planner and rules

- `backend/services/review_adoption.py` holds the planner and the canonicalizers split out of `_legacy`, `_read_group_state` and `_group_ids` (rows or payload in, canonical data out), with `rules` passed in. It imports nothing from `backend.*`.
- `rules` supplies `validate_schema_changes`, `apply_schema`, `apply_layouts`, `sprint_order`, `sprint_identity`, `group_identity`, `MAX_ACTIVE_COLUMNS`, `MAX_TOTAL_COLUMNS`, `MAX_GROUP_VIEWS` and `REVIEW_LAYOUT_BUILTINS`, resolved at call time. The script passes the `sprint_review` module itself, so a test patch on it still takes effect. The revision passes a frozen snapshot defined in its own file.
- Tests: a parity test runs the frozen rules and the live rules on randomized inputs; a tripwire test compares the snapshot's constants and behaviors with the live module and names the file to update when it fails; an AST guard over the revision's transitive repository imports allows only `backend.services.review_adoption`.

### Run sequence inside the revision

1. Required-tables check (the script's `REQUIRED_TABLES`); a missing table fails the upgrade.
2. Cheap guard: `EXISTS (SELECT 1 FROM workspace_sprint_reviews)`; content (columns, layouts or cells) is judged in Python as `_legacy` does. None: return.
3. Save `lock_timeout` and `statement_timeout`, set 5 and 60 seconds locally. Restore them on the success path only; on failure the transaction rolls back and the local settings vanish.
4. Take `LOCK TABLE ... IN SHARE MODE` on the two legacy tables once, then enumerate workspaces with legacy content in sorted id order (a workspace that gains legacy rows after the enumeration cannot exist: the lock blocks legacy writers).
5. Run budget: 100,000 inserted rows over the whole run, counted as the script counts them (columns, cells and views, per group). A workspace whose legacy cells alone exceed the remaining budget is skipped before it is read; otherwise it is planned and skipped if its plan exceeds the remainder. Skipped workspaces are logged; nothing is partially written for a workspace.
6. Per workspace: read legacy and the configured groups, plan read-only, keep the groups whose state is absent (D-2 (a)), lock only those groups' schema rows with the app's statements in sorted order, re-read their state after the locks, drop any group that now holds a row (logged), re-plan, write, all without savepoints (a refusal is a Python exception raised before any write for that workspace). The `UPDATE` of `columns` carries `AND schema_revision = :base` and a rowcount check.
7. Input/output uses frozen Core tables for the seven tables it touches (`workspaces`, `workspace_group_configs`, the two legacy tables and the three group tables), typed `sa.Uuid(as_uuid=False)` and `sa.JSON` exactly as revisions 0017 to 0019 declare them; a Uuid or JSON typed as a string writes values the app cannot find. The group-catalog payload parsing is a frozen copy (a non-dict payload is a refusal).
8. Errors: a database error is re-raised as a sanitized error carrying only its SQLSTATE (driver text echoes bound values); a planner data error skips the workspace (D-3).
9. Logging at WARNING (the repository's `alembic.ini` drops INFO): one line per workspace with its id, groups adopted, groups skipped and why, the `matched`, `skipped`, cap-excluded and dropped counters the script's report prints (ids and counts only, never labels or values), and a fingerprint of the canonical legacy data (stable, unlike a plan digest, which a later dry run can no longer reproduce); one final summary line. Job logs may be ephemeral; `--list` is the durable record.

### Operator tooling after this change

`--list`, the dry run and `--merge --apply` stay the verification and recovery tools (groups that hold rows, skipped workspaces, kill-switch environments, groups a user saved into). They are not removed and their behavior does not change.

## Tasks

### Task 1: failing contract tests

Files: Create `tests/test_review_adoption_migration.py`; Modify `tests/test_sprint_review_postgresql.py`.

- [ ] SQLite: seed 0019 with well-formed legacy rows and a configured group, `upgrade head`, assert the adopted columns, cells and views through the app's own read path (`load_review`, `read_values`) and the raw stored forms (Uuid hex, JSON text); empty legacy tables write nothing; a group that holds rows is untouched byte for byte; the same group id in two workspaces stays separate; legacy tables are unchanged.
- [ ] Replay: `downgrade` to 0019 then `upgrade head` adopts nothing new (adopted groups hold rows); a downgrade below 0019 then `upgrade head` adopts again.
- [ ] Kill switch (`patch.dict(os.environ)`): `false` stamps and logs the count; `true` or unset runs; a typo fails the upgrade.
- [ ] Skips: no configured group, malformed column and an over-budget workspace skip only that workspace, with id and reason in the log; a non-dict group catalog payload skips.
- [ ] Logging: a subprocess runs `python -m alembic -c backend/db/alembic.ini upgrade head` on SQLite and the test asserts the lines on stderr; a planted label and value never appear in any log line or in a forced database error's output.
- [ ] Offline `--sql`: no data statements, the note present; `downgrade` is a no-op.
- [ ] PostgreSQL only (SQLite runs each revision in its own transaction and does not give the same atomicity, so the nothing-written assertions run on PostgreSQL): a held schema-row lock past the timeout fails the upgrade, leaves `alembic_version` at 0019 and writes nothing; with two or more workspaces the last one fails and the first one's rows are gone; a concurrent app save is neither overwritten nor deadlocked; settings assertions run inside a test transaction through the `adopt_all(connection)` seam with harness timeouts different from the step's own; the adapter's lock statements equal `_locked_schema`'s (`before_cursor_execute`); a group with an empty plan is never locked and leaves no revision-0 row (`rows() == ([], [])`).
- [ ] Add well-formed variants of the existing tests that stay green only because their legacy seed is malformed or has no group config: the downgrade test in `tests/test_sprint_review_postgresql.py` and `tests/test_sprint_review.py` lines 776-860.
- [ ] Run: tests fail for the right reason (no revision yet).

### Task 2: extract the planner with injected rules, no behavior change

Files: Create `backend/services/review_adoption.py`; Modify `scripts/adopt_legacy_sprint_reviews.py`.

- [ ] Move the planner, constants and canonicalizers; the script passes `sprint_review` as `rules` and keeps aliases for every moved name.
- [ ] Gate: the existing 72 script tests, the golden-state tests, the randomized differential against the pre-extraction script, the 17 PostgreSQL review tests pass unmodified; the script's report and digest bytes are identical.

### Task 3: revision, frozen adapter and frozen rules

Files: Create the revision file; Modify `backend/services/review_adoption.py` only for shared pure helpers.

- [ ] The run sequence above, the frozen rules snapshot with the parity and tripwire tests, the AST guard.
- [ ] Differential test: the revision's adapter and the script's adapter on randomized fixed-seed seeds with live group state, caps and group-catalog shape fuzz, comparing ids normalized, parsed JSON and error-class equivalence, on SQLite and PostgreSQL.

### Task 4: PostgreSQL verification and release-path rehearsal

Files: `tests/test_sprint_review_postgresql.py`, `tests/test_postgresql_runner_contract.py` only if an ordering assertion needs it.

- [ ] The Task 1 PostgreSQL tests pass; run `runners/github/run-postgresql-tests.sh`.
- [ ] Rehearsal on a throwaway copy of a database at 0019 that holds legacy rows and no group rows: `alembic upgrade head`, then `scripts/check_startup_preflight.py` (expects `at head`), then `--list`. Repeat for: a database at 0018 (0019 and the revision in one transaction); the incident state (legacy rows plus live group rows: skipped, logged, byte-identical); the `run.sh` sequence; `jira_server.py` on a non-5050 port with `/api/test`.
- [ ] Scale probe on PostgreSQL: several groups and several workspaces up to the run budget, recording elapsed time, peak memory and lock hold against the downstream Job's limits.

### Task 5: docs

Files: `INSTALL.md`, `README.md`, `docs/features/planning-sprint-review.md`, `docs/ontology.md`, `docs/postmortem/MRT033-review-columns-hidden-after-migration.md`, `docs/postmortem/README.md`, `docs/plans/DONE-planning-review-adoption-merge-mode.md` (D-9 reversed), `docs/plans/DONE-planning-review-group-columns-267.md` (current-accuracy note), `docs/plans/SUPPORT-planning-review-sprint-inheritance-design-267.md` (adoption statements and rollback table), `docs/plans/README.md`, `docs/README_ANALYTICS.md`, `.env.example`, `runners/local/README.md`; read `backend/security/CONFIGURATION_OWNERSHIP.md` and state it is unchanged.

- [ ] INSTALL and README cutover sections: adoption is automatic for groups without rows; step 7 and the "clean redo" row change (a downgrade below 0019 then an upgrade re-adopts without the script); add a rollback row for the new revision (the old image's preflight fails against the new head; `downgrade 20261020_0019` is a no-op); the configured-group precondition matters more (a workspace skipped for no group is stamped and not retried); keep the quiesce rule for legacy writers when upgrading from 0018 or earlier (a legacy row written after the stamp is never adopted; check `--list`); adoption time counts against start probes under `RUN_DB_MIGRATIONS=true`; two concurrent migrators can hit the 5 second lock timeout once; open drafts get a `schemaConflict` after an adoption.
- [ ] Document the kill switch and its accepted values, the log level and `--list` as the record, the skipped-workspace log lines and how to restore them with `--merge`.
- [ ] MRT033: Status, Prevention and corrective actions record the automatic adoption; the startup warning stays a separate, optional plan.
- [ ] Analytics impact: the change is user-visible (saved columns reappear) but adds no control; add an allowlist row with that reason per `docs/README_ANALYTICS.md` (the merge-mode plan needed none because it was an operator script).

### Task 6: full verification and delivery

- [ ] Full Python suite, `tests.test_codebase_structure_budgets`, the full Chromium `tests/ui` run per section 10 (no frontend change expected).
- [ ] Publication transaction per section 10: record the expected commit count and changed paths against the plan before pushing; update the pull request title and body; rename this plan to `DONE-` with the delivery note when accepted.

## Acceptance criteria

1. `alembic upgrade head` from 0019 on a database with well-formed legacy rows and a configured group produces, for each group without review rows, the same columns, cells, views and schema revision as the script's merge on the same seed (differential).
2. A group that holds review rows is untouched byte for byte and logged; `--list` reports its workspace `needs-merge` when a merge would still insert.
3. No legacy content: the revision stamps, writes nothing and issues one existence query beyond the table check.
4. Replay (`downgrade 20261020_0019`, `upgrade head`) adopts nothing new; a downgrade below 0019 then an upgrade adopts again from the untouched legacy tables.
5. Kill switch off: stamped, nothing written, the count of workspaces with legacy data logged; an unrecognized value fails the upgrade.
6. A database error fails the upgrade with only a SQLSTATE in the output, leaves the revision unstamped and nothing written (PostgreSQL); a rerun succeeds.
7. A planner data error, a missing group configuration or an over-budget workspace skips only that workspace, with id and reason in the log.
8. The log lines appear on stderr under the repository's `alembic.ini`, carry ids and counts only, and the whole run stays within the 100,000-row budget.
9. After the upgrade the app's own read path returns the adopted columns and values for the group.
10. Session timeouts are restored on the success path; offline SQL has no data statements and carries the note; `downgrade` is a no-op.
11. A fresh `upgrade base` to head works on SQLite and PostgreSQL, and `scripts/check_startup_preflight.py` reports `at head` afterwards.

## Forbidden regressions

- No change to `--merge`, `--list`, the default dry run or their digests (rule versions `adopt-legacy-sprint-reviews/1` and `/2-merge`).
- No edit to revisions 0019 and earlier.
- No import of `backend.db.models`, `backend.services.sprint_review` or any other app module by the revision beyond `backend.services.review_adoption`.
- No write to a legacy table; no change to an existing group row, cell, view or column.
- No change to the app's save, load or lock behavior.
- No agent attribution trailers in commits or the pull request, no local paths, real emails, ids or labels in committed files (root `AGENTS.md` section 0).

## Files allowed to touch

Create: `backend/services/review_adoption.py`, `backend/db/migrations/versions/20261023_0020_adopt_legacy_sprint_reviews.py`, `tests/test_review_adoption_migration.py`. Modify: `scripts/adopt_legacy_sprint_reviews.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_sprint_review.py` (well-formed variants only), `tests/test_adopt_legacy_sprint_reviews.py` (only if an alias cannot hold), `tests/test_postgresql_runner_contract.py` (only if an ordering assertion needs it), and the documents listed under Task 5.

## Gate sweep

No `GATE-*` document gates this work. `GATE-05` is unrelated and is neither read nor modified here.

## Risks and limits

- **Unattended writes.** No human sees the report before the write. Mitigations: D-2 (a) leaves every group that holds rows alone, the planner's own legacy-internal rules are the script's, a whole-run row budget, logged fingerprints and counters, the kill switch, a differential test against the reviewed script path, and the pre-release backup as the only rollback (a point-in-time restore loses later writes).
- **Release availability.** Under D-3 a database error fails the release job until it is retried. Whether the downstream Job retries is outside this repository.
- **Lock scope.** The step runs inside one transaction on PostgreSQL: the legacy-table share lock and every written group's schema-row lock last until commit, and for an upgrade that also creates 0019's tables the foreign-key lock on `workspaces` lasts too. App saves have no lock timeout and wait. The run budget bounds the time; Task 4 measures it. Production at 0019 runs only this revision.
- **Resources.** The step runs in the migration process; the measured 360 MiB is a single-group figure; Task 4 re-measures with several groups and workspaces against the downstream Job's limits.
- **Once-only.** Legacy rows written after the stamp by a pre-#267 pod are never adopted (the overlap window of a rolling deploy from 0018 or earlier); a workspace skipped for a missing group is stamped; an environment that used the kill switch stays unadopted. The script is the tool for all three.
- **View cap.** Inserting legacy views can fill a group's 500-view cap, after which `save_review` rejects first layout saves in new Sprints (the merge-mode plan's known limit); the log reports cap-excluded counts.
- **Planner drift.** The shared planner can change after this revision ships, so a replay on a database that has not run it applies the then-current matching algorithm; the frozen rules and golden tests pin the rules and output, not future algorithm edits.
- **Two concurrent migrators.** The second waits and fails at the stamp; data stays safe.
- **Pull request size.** The bugfix pull request gains a migration; the operator may split it later.

## Definition of Done

| Item | Evidence required |
| --- | --- |
| Contract tests | Task 1 list green, SQLite and PostgreSQL |
| No behavior change in the script | Task 2 gate output |
| Revision isolation | AST guard and parity and tripwire tests green |
| Rehearsal and scale | Task 4 outputs recorded in the plan |
| Docs | Every Task 5 file updated or stated unchanged |
| Publication | Section 10 transaction verified, pull request body updated |

## Validation record

Three independent read-only reviews on 2026-10-23: Alembic and database mechanics (experiments on SQLite and a throwaway PostgreSQL 18), data safety and semantics of an unattended run, release paths and plan contract. The author checked each finding against the source before applying it.

- **Applied (all three lenses):** the planner is not pure and the "no live model imports" and "tests unmodified" claims conflicted (injected rules, frozen snapshot, parity and tripwire tests, AST guard, D-5 and D-6 rewritten); the run budget must cover the whole run and a workspace must be pre-counted before it is read; error classification by origin instead of SQLSTATE with a required-tables check and sanitized driver errors; INFO logging never reaches the job log (WARNING, stderr test, `--list` as the record); locking every group before planning leaves revision-0 rows (plan first, lock only writing groups); savepoints do not protect SQLite and keep locks on PostgreSQL (removed, nothing-written assertions are PostgreSQL only); restore of timeouts on the success path only and a test that observes it inside the transaction; Core stubs typed like the DDL and read back through the app; offline mode and the kill switch parsing; the once-only replay and the second-run test that was vacuous; the docs and tests the draft omitted; plan structure (expected behavior, gate sweep, publication contract, Definition of Done); corrected facts about env.py on SQLite, the callers and the 0008 precedent.
- **Changed recommendation:** D-2 now recommends adopting only groups that hold no review rows (the first draft recommended the full merge for every workspace), because the unattended hazards of merging into live data are not reviewable.
- **Not applied:** `transaction_per_migration` in `env.py` (a global change outside this plan's files); a separate audit table (offered as D-8's alternative).
- **Reviewer claims relied on without re-proof:** the savepoint, lock and aborted-transaction behaviors are reviewer-verified and are re-proven by the Task 1 PostgreSQL tests before implementation depends on them.

## Execution status (fill during execution)

| Task | Status | Commit | Notes |
| --- | --- | --- | --- |
| 1 to 6 | not started | | Waiting for the operator's answers to D-1 to D-8. |
