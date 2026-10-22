# Postmortem MRT033: Review Columns Hidden After an Auto-Migrating Release

**Date**: 2026-10-22
**Severity**: High
**Status**: Resolved locally; publication pending
**Author**: Team

## Impact

Planning review columns and values saved before migration `20261020_0019` (#267) disappeared from Planning after the app restarted on the new code, in whatever Sprint the user opened. Nothing was lost: the legacy per-Sprint rows were intact, but the app no longer read them and no tool could bring them back once any user had saved after the release. Reproduced on a local database started by the local runner, which migrates on start. The downstream release path (an ArgoCD `Sync` hook Job that runs only `alembic upgrade head`, in an earlier wave than the web pods) reaches the same state on every sync, so a deployed environment is exposed too; its state was not inspected.

The first reading, that a Sprint changing from future to active had orphaned the data, was wrong for this case: the catalog showed the same Sprint id in both states. That mechanism is real for the legacy per-Sprint storage when two Jira Sprints share a quarter name (the catalog keeps one per name, so its id can change), but it was not what happened here.

## Root cause

- Migration `20261020_0019` created empty group tables and left moving the data to a separate, manual script. Any path that migrates without running it hides every saved column. The release chart, the local runner and `RUN_DB_MIGRATIONS=true` all do exactly that.
- The adoption script refused once any group row existed, and a single column or layout save after the release creates one. The runbook's rollback table said "forward fix only", and no forward-fix tool existed.
- `--list` printed `adopted` whenever any group schema or view row existed, whether or not anything had been adopted, so it could not tell an operator the columns were still missing.

## Investigation misses

- The first probes used the database URL from `.env`, which has no host and reaches a Homebrew PostgreSQL; the running app used the local runner's Docker PostgreSQL on the same port with the same database name. The wrong database (at migration `0018`, no data) produced a confident but wrong picture until the process's real connection string was read.
- Two plausible causes (an unsaved draft, a failing request) and the Sprint-id mechanism were offered before the data was read.

## Timeline

- 2026-10-20: group-wide review columns (#267) merged; adoption left as a manual step.
- 2026-10-22: the local app restarted on the new code and migrated to the new head; saved columns were gone from Planning. The real database was identified, showed the columns intact in the legacy tables and empty group tables, and a dry run plus apply of the existing script restored them for that workspace.
- 2026-10-22: issue #299 opened; the merge-mode plan was written, reviewed by three independent read-only passes (one Blocker found and reproduced), approved, and implemented.

## Resolution

`scripts/adopt_legacy_sprint_reviews.py --merge` adopts legacy columns, values and Sprint views into groups that already hold rows, without overwriting, clearing, renaming or resurrecting anything created after the release (id claim first, then label and type; live cells and views win; a group-archived column stays archived). The apply locks only the groups it writes through the same schema-row lock every app save takes first, re-reads and re-plans under the locks, and writes only if the reviewed digest still matches. `--group` limits the targets, a second run is a no-op, and `--list` now reports `pending`, `needs-merge`, `adopted` or `error`. The runbook, rollback table, privileges and a label-lookup query are in `README.md` and `INSTALL.md`.

## Verification

- Golden-state tests pin the unchanged fresh path; a randomized differential run of the original planner against the split one (4000 cases) and against an empty-state merge shows identical results.
- 68 SQLite tests in `tests/test_adopt_legacy_sprint_reviews.py` and 16 PostgreSQL tests in `tests/test_sprint_review_postgresql.py` (real lock waits, lock timeout exit 2, no table-level lock on the group tables, no deadlock with a concurrent writer).
- Mutation checks: 28 deliberate breakages of the planner, the merge rules, the write path and the locking each fail at least one test; one revealed that the digest over-invalidated on edits in unrelated groups, which was fixed.
- A review Blocker was reproduced before fixing: a row read before the lock in the same session was reused after it, which would have overwritten a concurrent column save while the digest still matched. The apply now plans in a separate read-only session and re-reads from the locked state.

## Lessons learned

- A migration that moves where data lives must move the data in the same step, or the app must say loudly that unmigrated data exists. Hiding it silently looks like data loss.
- A status word must say what it measured. `adopted` meant "some group row exists".
- Probe the database the running process uses, read from the process, not from a config file that another tool may resolve differently.
- After taking a row lock in a session, never reuse entities that session loaded earlier; read the state after the lock.
- Read the data before offering causes.

## Prevention

- `--merge` is the supported restore; the runbook says to run adoption or the merge after the first sync of any environment that migrates automatically.
- A non-blocking startup or preflight warning when legacy data exists and a merge would still insert something is not part of this change (decision D-9 of the plan); it would address the silent hiding itself.

## Action items

- [x] Add `--merge` and `--group` to the adoption script, with `--list` statuses.
- [x] Document the restore, privileges, label lookup and rollback.
- [x] Pin the fresh path with golden-state tests before changing it.
- [ ] Add an adoption/restore step to the downstream release repository's own runbook after it syncs this change.
- [ ] Decide on the startup warning for unadopted legacy data (separate plan).
- [ ] Decide whether a rule belongs in root `AGENTS.md` section 11 (needs the operator's wording).

## Related Issues

- [MRT024](./MRT024-head-stamped-schema-drift.md): another case of a database state that looked current while schema or data was not what the app expected.

## References

- Issue [#299](https://github.com/Juce-me/jira-execution-planner/issues/299)
- [`EXEC-planning-review-adoption-merge-mode.md`](../plans/EXEC-planning-review-adoption-merge-mode.md) and its validation record
- [`SUPPORT-planning-review-sprint-inheritance-design-267.md`](../plans/SUPPORT-planning-review-sprint-inheritance-design-267.md)
- [`adopt_legacy_sprint_reviews.py`](../../scripts/adopt_legacy_sprint_reviews.py)
- [`test_adopt_legacy_sprint_reviews.py`](../../tests/test_adopt_legacy_sprint_reviews.py), [`test_sprint_review_postgresql.py`](../../tests/test_sprint_review_postgresql.py)
- Runbook: [`README.md`](../../README.md), [`INSTALL.md`](../../INSTALL.md)
