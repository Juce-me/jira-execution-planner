# Postmortem MRT023: Alert Enrichment Blocked the First Screen

**Date**: 2026-08-08
**Severity**: High
**Status**: Resolved
**Author**: Engineering

## Summary

The ENG dashboard took more than eight seconds to show its first useful screen because the primary task endpoint performed alert-only Epic story count and distribution work before returning visible Board data. Alert sources also started for ENG modes that do not display alerts.

## Impact

- Users opening the ENG dashboard could wait roughly 13 seconds for visible work.
- Board content was delayed by calculations needed only for Catch Up alerts.
- `/api/missing-info`, ready-to-close, and other alert work consumed Jira and server capacity even when the saved initial mode was not Catch Up.

## Root Cause

The frontend reused the same Product and Tech task requests for two responsibilities: visible task/Board data and alert enrichment. The backend therefore ran `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics` on the critical response path for every task-based ENG mode.

The captured request timing isolated the dominant stage:

- Jira search: 788.9 ms
- Epic enrichment: 856.4 ms
- Epic count/distribution: 10,367.0 ms
- Total task response: 13,250.0 ms

`/api/missing-info` was redundant on the initial non-Catch-Up screen, but it was not the direct 11-second blocker: it completed before the main task response. The blocking work was the alert distribution stage inside that main response.

This recurred despite MRT010 because request intent remained implicit. Ready-to-close work had been deferred, but normal visible-data responses still retained alert distribution enrichment, and new ENG modes inherited unconditional alert effects.

## Timeline

- 2026-08-08 10:31:16: sprint discovery completed.
- 2026-08-08 10:31:21: missing-info returned despite the initial screen not needing alerts.
- 2026-08-08 10:31:28: the task response returned after 13.25 seconds; 10.367 seconds were attributed to Epic count/distribution.
- 2026-08-08: root cause traced to the shared task endpoint and unconditional frontend alert effects.

## Resolution

Implementation is tracked in `docs/plans/EXEC-defer-eng-alert-loading.md`:

1. Make the default task response visible-data-only by skipping alert count/distribution.
2. Preserve the full enrichment behind explicit `purpose=alerts` requests.
3. Start all alert sources only after primary Product and Tech data finish and only while Catch Up is active.
4. Do not render the alert panel in Board, Planning, Statistics, or Scenario.

## Verification

- Backend/OAuth tests prove default requests never call the two alert count/distribution helpers and `purpose=alerts` retains the enrichment contract: 112 passed.
- Browser coverage proves visible Product and Tech data completes first, sprint metadata is resolved, all alert sources are Catch Up-only and cancellable, future backlog is deferred, mutations replace the alert cohort, stale cohorts cannot overwrite current state, and Catch Up re-entry starts a replacement cohort: 15 passed.
- Frontend alert source, API, transition, and Board guards: 101 passed.
- Production frontend build: passed.
- Full Python baseline before the final frontend-only race fixes: 1,216 passed, 1 skipped. A fresh sandboxed run executed all 1,216 tests but three database-backed tests failed because access to the local PostgreSQL socket was denied; an approved socket-enabled retry stalled and was interrupted after a bounded wait.
- Full Node suite: 902 passed, 1 unrelated existing EPM `.stat-card` CSS guard failure; no CSS source or EPM guard changed in this fix.

The original live Jira timing cannot be reproduced with synthetic tests, so no unmeasured replacement load-time number is claimed. The critical-path regression is removed structurally: default task timing no longer contains the `epic_counts_distribution` stage.

## Lessons Learned

- A request used to paint the first screen must not perform data enrichment for a secondary panel.
- Deferred work must be gated by the surface that consumes it, not merely started after another promise settles.
- Per-stage server timing is necessary: parallel network requests alone did not explain the wait.
- Adding a new mode requires auditing every sibling effect inherited from the previous default mode.

## Prevention

- Keep explicit request purposes for visible data and alert enrichment.
- Add browser tests that assert both request order and request absence by ENG mode.
- Treat eight seconds to first useful screen as a failed initial-load gate.
- Review MRT010 and this postmortem before changing ENG startup fetch orchestration.

## Action Items

- [x] Remove alert enrichment from default task responses.
- [x] Gate every alert source and the alerts panel to Catch Up.
- [x] Add request-order, mode-negative, race, future-backlog, and re-entry regression tests.
- [x] Record focused and full verification results and mark this postmortem resolved.

## Related Issues

- [MRT004](./MRT004-performance-degradation-page-load.md)
- [MRT010](./MRT010-startup-api-load-fanout-and-overscoped-payloads.md)

## References

- `jira_server.py`
- `frontend/src/dashboard.jsx`
- `frontend/src/eng/useEngSprintData.js`
- `docs/plans/EXEC-defer-eng-alert-loading.md`
