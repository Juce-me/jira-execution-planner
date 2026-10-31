# Planning Assignee Capacity: Deferred Scope (#323)

> **Status:** Deferred follow-up. Spun out of `DONE-planning-assignee-capacity-table-323.md`. Do not execute without renaming to `EXEC-*` after review.

## One-click push of the stored team number to Jira

Not built: Jira is written only through the existing capacity editor on the user's Save (the reconcile banner's Write to ticket opens that editor prefilled). If a direct push is wanted later: conflicts surface as `capacity_conflict` (409, current value shown), the service is not an atomic compare-and-set so the UI must not promise nothing is written, it is available only where `capacityTargetState === 'matched'` and `capacityMutationEnabled`, and a distinct analytics `workflow_action` is a README and test change.

## Open items from the verification gate

- EPM automatic refresh: in EPM view the ENG task loads are aborted and `useEngSprintData.js` leaves `productTasksLoading` and `techTasksLoading` set (it clears them only when `shouldApplyResult` allows), so the owner-busy check blocks the return refresh on every surface. Remedy: clear the flags when a load is superseded or aborted and no newer load owns them (an ownership token), or stop ENG flags gating the `epm` surface; add a test that opens in EPM, aborts the ENG load and asserts the return read starts. Five tests in `tests/ui/dashboard_data_freshness.spec.js` fail with a different subset each run until then.
- DoD 13: `buildAssigneeRows` re-adds the Total over the team's Stories once per Story toggle (`planningAssigneeCapacityModel.js`, memo deps in `PlanningAssigneeCapacity.jsx`); make the Total independent of the selection.
- Toggle-to-paint p50/p95 at 500, 2,000 and 5,000 Stories against base: no harness exists.
- Manual glyph and hover inspection in headed Firefox and WebKit; a direct measurement that a stored-number change re-renders App.
- Cmd/Ctrl+Z after Enter works only once focus is back in the table (keyboard-only, parked in `docs/TODO.md` Deferred).
- Undo of Add assignee marks the person removed (no delete route); an inherited team number restored by Undo becomes a typed value.
