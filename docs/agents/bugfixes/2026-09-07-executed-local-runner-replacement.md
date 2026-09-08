# Local Runner Replacement

Status: executed
Type: bugfix

## Goal

Starting `./runners/local/run.sh` replaces an existing instance of that same runner instead of failing on its fixed lock, while stale locks are recovered and unrelated processes are never signalled.

## Design

The lock directory remains the host-user serialization boundary. It uses `/tmp` when available and falls back to the operating system's per-user temporary directory. Its owner writes its PID to `runner.pid` immediately after `mkdir` succeeds. A contender reads that PID, verifies that the process command line identifies `runners/local/run.sh`, sends `TERM`, and waits for the old runner to finish its existing exact-project Docker cleanup. If the old runner does not exit within the bounded grace period, the contender sends `KILL`. Missing, malformed, dead, or non-runner PID metadata is treated as stale state and the lock directory is reclaimed without signalling the referenced process.

Lock reclamation stays race-safe: removal only targets the fixed lock's PID file and directory, acquisition always uses atomic `mkdir`, and contenders retry rather than assuming ownership after removal. Cleanup removes the PID file before removing the owned directory.

## Files

- Modify `tests/test_local_postgresql_runner.py`: cover active-runner replacement, stale lock recovery, non-runner PID safety, and replacement escalation.
- Modify `runners/local/run.sh`: publish owner PID, validate and stop an existing owner, reclaim stale locks, and acquire through a bounded retry loop.
- Modify `runners/local/README.md`: describe automatic replacement and stale-lock recovery.

## Implementation Plan

### Task 1: Specify replacement behavior

- [x] Replace the existing concurrent-runner rejection test with a process test that starts a sleeping runner, starts a second runner, and proves the first exits through cleanup before the second reaches Flask.
- [x] Add stale-lock tests for empty and malformed PID metadata and prove startup succeeds.
- [x] Add a safety test whose `runner.pid` names a live unrelated process and prove that process remains alive while startup succeeds.
- [x] Run `python3 -m unittest tests.test_local_postgresql_runner` and confirm the new assertions fail because the original runner neither writes PID metadata nor replaces an owner.

### Task 2: Implement bounded ownership replacement

- [x] Add lock-owner helpers to read numeric PID metadata, validate the target command line as this runner, send `TERM`, wait in short bounded intervals, and send `KILL` only after the grace period.
- [x] Change acquisition to retry atomic `mkdir`, reclaim stale metadata without signalling unrelated processes, and write `$$` to `runner.pid` before declaring ownership.
- [x] Publish the active child process-group PID so forced takeover also terminates the old runner's child tree.
- [x] Change cleanup to remove owned PID metadata before `rmdir`.
- [x] Run `python3 -m unittest tests.test_local_postgresql_runner` and confirm all focused process tests pass.

### Task 3: Align documentation and verify

- [x] Update `runners/local/README.md` so restart behavior matches the implementation and manual lock removal is no longer the normal recovery path.
- [x] Run `bash -n runners/local/run.sh` and require exit status 0.
- [x] Run `python3 -m unittest tests.test_local_postgresql_runner tests.test_postgresql_runner_contract` and confirm 46 tests pass.
- [x] Run the full suite with explicit JSON-file/basic test mode and confirm 1,545 tests pass with 9 skipped.
- [x] Run `git diff --check` and inspect the scoped diff for unrelated changes.

### Task 4: Bound unreclaimable stale-lock failure

- [x] Add a process regression proving an unreclaimable stale lock is reported once and exits promptly.
- [x] Stop suppressing stale-lock removal failures; retry only when the observed owner metadata changed concurrently.
- [x] Document the single-report failure behavior and add the durable project rule.

### Task 5: Handle concurrent lock disappearance

- [x] Reproduce the prior runner removing the directory between observation and `rmdir` completion.
- [x] Treat a failed `rmdir` as success when the exact lock directory no longer exists.
- [x] Keep an existing unreclaimable directory on the immediate single-report failure path.

### Task 6: Handle an unavailable `/tmp`

- [x] Reproduce the real failure with `bash -x` and prove `mkdir` failed because `/tmp` was unavailable while the retry loop misclassified the absent path as a stale lock.
- [x] Add a regression proving lock creation failure exits once without entering stale-lock reclamation.
- [x] Fall back to the operating system's per-user temporary directory when `/tmp` is unavailable.
- [x] Start the real runner through migrations, preflight, and Flask; then start a second real runner and prove it terminates and replaces the first.

## Acceptance Criteria

- A second invocation stops a live instance of `runners/local/run.sh`, waits for its cleanup, and then starts normally.
- A stale or corrupt lock no longer blocks startup.
- A PID that belongs to an unrelated live process is never signalled.
- Replacement is bounded and can escalate from `TERM` to `KILL`.
- Existing signal forwarding, exact Docker cleanup, persistent-volume retention, localhost isolation, and exit-status behavior remain covered.
- Analytics impact: no event is added because this is developer tooling with no user-visible application interaction.

## Forbidden Regressions

- Do not match or kill processes by a broad name search.
- Do not signal a PID without validating its command line.
- Do not use broad Docker cleanup or remove the retained volume.
- Do not change application, deployment, or frontend behavior.
- Do not modify the unrelated work already present on this branch.

## Outcome

Implemented with changes. The runner now records both its own PID and its active child process-group PID, replaces a validated live runner with bounded `TERM`/`KILL` handling, and automatically reclaims empty, malformed, dead, or unrelated PID locks. The child PID metadata was added during implementation so forced replacement cannot leave the old Flask process tree behind. An unreclaimable stale lock now produces one report and exits immediately instead of suppressing the removal failure and retrying the same state. If the prior runner concurrently removes the observed directory, reclamation recognizes that postcondition as success and continues startup. A failed lock `mkdir` is no longer treated as stale contention: startup uses the system per-user temp directory when `/tmp` is unavailable and otherwise fails once with a lock-creation error.

## Current Accuracy

Accurate. The implementation, focused process tests, source-contract tests, runner guide, and verification results match this artifact.
