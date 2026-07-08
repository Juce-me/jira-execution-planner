# Postmortem MRT019: Ready-to-Close Fired on Epics with Open Future-Sprint Work

**Date**: 2026-06-21
**Severity**: Medium
**Status**: Resolved
**Author**: Andrew Feygin

## Summary

The "Epic Ready to Close" alert surfaced an epic (e.g. `TECH-25739`) whose
child story was still open in a future sprint. Closing such an epic would
prematurely end work that is still planned, undermining trust in the alert.

## Impact

- Users affected: anyone reading ENG alerts on a busy board (many in-scope epics).
- Symptom: an epic with all current-sprint children done/killed but an open
  story scheduled in a later sprint was wrongly listed as "ready to close".
- Intermittent and board-size dependent, so it looked like a one-off.

## Root Cause

The rule decided "all children terminal" by enumerating an epic's children into
the client-side `readyToCloseTasks` list and checking `.every(terminal)`
(`frontend/src/dashboard.jsx`). That conclusion is only valid when the
enumeration is complete — and it was not:

- The combined children of **all** in-scope epics were fetched in a single
  search capped at `max_results = 250` (`jira_server.py`) with **no `ORDER BY`**.
  On a full board the combined child count exceeds 250, so an arbitrary subset
  was dropped.
- The fetch uses `/rest/api/3/search/jql` (the `nextPageToken` API), which does
  not return `total`. The truncation was therefore silent — the code could not
  even detect it.
- When an epic's open future-sprint child fell outside the returned 250, it was
  absent from `readyToCloseTasks`, `.every(terminal)` passed *vacuously*, and the
  epic was flagged. The check failed **open**.

This is the same failure class as MRT008 (pagination gaps dropping valid
stories). A prior fix (`af281f6`) had already switched the check to an all-sprint
task list to catch future work, but it still trusted that the list was complete.

## Timeline

- 2026-03-26 `af281f6` made the terminal check use the all-sprint task list to
  account for future-sprint work — correct in intent, but reliant on a complete fetch.
- 2026-06-18 `d97b406` broadened the same fetch to all non-Epic child types,
  increasing child volume and the likelihood of hitting the 250 cap.
- 2026-06-19 User reported `TECH-25739` flagged as ready to close despite an open
  future-sprint child.
- 2026-06-21 Root-caused to silent truncation; fixed with an authoritative count.

## Resolution

Stopped inferring "all terminal" from a truncatable list. The ready-to-close
epic payloads now carry an authoritative `openChildCount`:

- Backend (`jira_server.py`, ready-to-close branch): after building the epic
  payloads, reuse `fetch_story_distribution_for_epics(epic_keys, headers,
  epic_link_field, '')`. With an empty selected sprint, its
  `openStoriesOutsideSelected` bucket counts every non-terminal
  (`status not in ("Done","Killed","Incomplete")`) child across all sprints. That
  helper paginates to completion, so it cannot silently drop children.
- Frontend (`frontend/src/dashboard.jsx`): the `doneStoryEpics` rule now returns
  `epic.openChildCount === 0` instead of `readyToCloseTasks.every(terminal)`.
  The strict comparison fails **closed** — a missing/unloaded count never flags.

The shared `readyToCloseTasks` list and its other consumer
(`analysisWaitingEpics`) were left untouched.

## Verification

- TDD: added `test_ready_to_close_attaches_open_child_count_from_distribution`
  (`tests/test_create_stories_alert.py`). Watched it fail (`openChildCount` was
  `None`), then pass after the backend change. Updated the existing ready-to-close
  test to assert `openChildCount == 0` for the all-terminal case.
- Full backend suite: 904 tests pass (after bumping the `jira_server.py` line
  budget for the added wiring).
- `npm run build` succeeds; `frontend/dist` rebuilt and committed.
- Not verified against live Jira: the local server is in OAuth mode with an
  expired, browser-bound session, so `TECH-25739`'s exact child set could not be
  queried headlessly. The fix is verified at the unit/contract level.

## Lessons Learned

- A "best-effort" enumeration must never back a boolean that defaults to the
  unsafe answer. Absence of a disqualifying row was read as "all clear".
- For "does any X exist?" questions, ask the negative query (count the open
  children) rather than fetching everything and checking each — it is both
  correct under truncation and cheaper.
- Pagination caps without `ORDER BY` on the new Jira search API are silent: no
  `total`, no signal. Treat any capped multi-entity fetch as suspect.

## Action Items

- [x] Attach authoritative `openChildCount` to ready-to-close epics.
- [x] Switch the client rule to a fail-closed `openChildCount === 0` check.
- [x] Add regression test for the open-child count contract.
- [x] Update `docs/features/alerts.md` wording to state the count is complete.
- [ ] Consider applying the same authoritative-count pattern to
  `analysisWaitingEpics`, which still uses the truncatable `.every(terminal)` list.

## Prevention

- Prefer authoritative negative queries over enumerate-then-check for existence
  questions over an unbounded child set.
- When a fetch is capped, fail closed and/or log the truncation; never let a
  capped result imply completeness.

## Related Issues

- [MRT008](./MRT008-scenario-task-set-mismatch.md) — pagination gaps dropped valid stories (same class).

## References

- Fix branch: `bugfix/ready-to-close-future-sprint-children`
- Backend: `jira_server.py` (ready-to-close branch; `fetch_story_distribution_for_epics`)
- Frontend: `frontend/src/dashboard.jsx` (`doneStoryEpics`)
- Tests: `tests/test_create_stories_alert.py`
- Prior fixes: `af281f6`, `d97b406`
