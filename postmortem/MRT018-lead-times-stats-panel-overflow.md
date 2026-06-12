# Postmortem MRT018: Lead Times Stats Panel Overflow

**Date**: 2026-06-12
**Severity**: High
**Status**: Resolved
**Author**: Team

## Summary

Lead Times could render long Open Epics and Completed Epics lists outside the usable stats panel. A previous fix removed the outer `.stats-panel.open` height cap, but missed the inner `.stats-view.open` cap and did not provide a long-list interaction. The result was a panel that still clipped or visually escaped when real Jira data returned hundreds or thousands of cohort epics.

## Impact

- Users could not reliably inspect long Lead Times lists.
- Open and completed epics appeared to extend beyond the highlighted stats panel boundary.
- The first fix looked plausible in a small synthetic screenshot but did not cover real-sized data.

## Root Cause

- `.stats-view.open` still used `max-height: 2400px` and inherited `overflow: hidden` from `.stats-view`, so content could be clipped inside the stats panel even after `.stats-panel.open` was changed.
- `buildCompletedEpicsBars` still capped terminal epics at 30 by default, while `buildOpenEpicsBars` had been changed to return all rows. This created inconsistent "show everything" behavior.
- The first UI regression used long open data only and did not cover long completed data or the inner `.stats-view.open` cap.
- Visual validation captured the rendered page after a synthetic load-more flow but did not inspect the real CSS boundary that the user saw in browser devtools.

## Timeline

- User reported that `Open Epics (All Cohorts)` was limited and unscrollable.
- First fix removed the open data cap and the outer stats panel `max-height`.
- User reported the panel still did not fit its content.
- Follow-up debugging identified the remaining inner `.stats-view.open` cap and missing completed-list coverage.

## Resolution

- Removed the inner `.stats-view.open` height cap and explicitly set `overflow: visible`.
- Kept all loaded open and completed epic data available by default from the cohort utilities.
- Added a display-level cap in `OpenEpicsChart`: show 30 rows first, then expose a small Load more button until all loaded rows are visible.
- Applied the same load-more behavior to Open Epics and Completed Epics.

## Verification

- Unit/source tests now assert:
  - open epic bars include every open epic by default
  - completed epic bars include every terminal epic by default
  - `.stats-panel.open` is not capped
  - `.stats-view.open` is not capped and uses visible overflow
- Playwright now validates:
  - long Lead Times lists render 30 rows initially
  - Load more reveals all open rows
  - Load more reveals all completed rows
  - the last visible row remains inside the stats panel scroll geometry
- Real Jira validation using a local basic-auth backup env profile for start quarter `2025Q2` returned:
  - range `2025-04-01` to `2026-06-30`
  - 3,779 cohort epics
  - 2,353 open epics
  - 1,426 terminal epics with lead time
  - no backend warnings

## Lessons Learned

- Removing an outer container height cap is not enough when nested view containers also use capped heights and hidden overflow.
- Long-list UI validation must include both open and completed sections because they share the same chart component but different data builders.
- Real-data validation should run before calling a stats-panel overflow fix complete.

## Action Items

- [x] Add unit/source guards for stats panel and stats view height caps.
- [x] Add Playwright long-list coverage for Open Epics and Completed Epics.
- [x] Validate Lead Times with a local basic-auth backup env profile for `2025Q2` through `2026Q2`.
- [x] Add project learning requiring long-list stats panel validation.

## Prevention

- For stats panel changes, always test a fixture with more than 30 rows in each repeated chart/list section.
- Inspect the active panel and active inner view containers together when debugging clipping.
- Treat screenshots of only the visible viewport as insufficient proof for scroll and overflow fixes.

## Related Issues

- [MRT009](./MRT009-sticky-layering-regressions.md)
- [MRT017](./MRT017-chart-hover-readout-placement.md)

## References

- `frontend/src/cohort/OpenEpicsChart.jsx`
- `frontend/src/cohort/cohortUtils.js`
- `frontend/src/styles/stats.css`
- `frontend/src/styles/stats-summary.css`
- `tests/test_stats_utils.js`
- `tests/ui/codebase_structure_smoke.spec.js`
