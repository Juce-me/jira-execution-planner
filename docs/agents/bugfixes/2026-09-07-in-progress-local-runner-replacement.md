# Local Runner Replacement

Status: in-progress
Type: bugfix

## Goal

Starting `./runners/local/run.sh` replaces an existing instance of that same runner instead of failing on its fixed lock, while stale locks are recovered and unrelated processes are never signalled.

## Design

The fixed lock directory remains the machine-wide serialization boundary. Its owner writes its PID to `runner.pid` immediately after `mkdir` succeeds. A contender reads that PID, verifies that the process command line identifies `runners/local/run.sh`, sends `TERM`, and waits for the old runner to finish its existing exact-project Docker cleanup. If the old runner does not exit within the bounded grace period, the contender sends `KILL`. Missing, malformed, dead, or non-runner PID metadata is treated as stale state and the lock directory is reclaimed without signalling the referenced process.

Lock reclamation stays race-safe: removal only targets the fixed lock's PID file and directory, acquisition always uses atomic `mkdir`, and contenders retry rather than assuming ownership after removal. Cleanup removes the PID file before removing the owned directory.

## Files

- Modify `tests/test_local_postgresql_runner.py`: cover active-runner replacement, stale lock recovery, non-runner PID safety, and replacement escalation.
- Modify `runners/local/run.sh`: publish owner PID, validate and stop an existing owner, reclaim stale locks, and acquire through a bounded retry loop.
- Modify `runners/local/README.md`: describe automatic replacement and stale-lock recovery.

## Implementation Plan

### Task 1: Specify replacement behavior

- [ ] Replace the existing concurrent-runner rejection test with a process test that starts a sleeping runner, starts a second runner, and proves the first exits through cleanup before the second reaches Flask.
- [ ] Add a stale-lock test whose `runner.pid` is malformed and prove startup succeeds.
- [ ] Add a safety test whose `runner.pid` names a live unrelated process and prove that process remains alive while startup succeeds.
- [ ] Run `python3 -m unittest tests.test_local_postgresql_runner` and confirm the new assertions fail because the current runner neither writes PID metadata nor replaces an owner.

### Task 2: Implement bounded ownership replacement

- [ ] Add lock-owner helpers to read numeric PID metadata, validate the target command line as this runner, send `TERM`, wait in short bounded intervals, and send `KILL` only after the grace period.
- [ ] Change acquisition to retry atomic `mkdir`, reclaim stale metadata without signalling unrelated processes, and write `$$` to `runner.pid` before declaring ownership.
- [ ] Change cleanup to remove `runner.pid` before `rmdir`.
- [ ] Run `python3 -m unittest tests.test_local_postgresql_runner` and confirm all focused process tests pass.

### Task 3: Align documentation and verify

- [ ] Update `runners/local/README.md` so restart behavior matches the implementation and manual lock removal is no longer the normal recovery path.
- [ ] Run `bash -n runners/local/run.sh` and require exit status 0.
- [ ] Run `python3 -m unittest tests.test_local_postgresql_runner tests.test_postgresql_runner_contract` and require all tests to pass.
- [ ] Run `python3 -m unittest discover -s tests` and report the exact result.
- [ ] Run `git diff --check` and inspect the scoped diff for unrelated changes.

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

Pending implementation.

## Current Accuracy

Accurate for the approved design; implementation has not yet been completed.
