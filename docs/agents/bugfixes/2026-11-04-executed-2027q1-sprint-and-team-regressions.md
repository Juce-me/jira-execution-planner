# Sprint admission and Team ID regression investigation

Status: executed
Type: bugfix

## Outcome

Investigation completed with changes in `46434d77`. The selected-Sprint Team picker marks a configured ID absent from a validated Sprint when a different ID with the same name is present. IDs remain distinct for historical data. A synthetic regression test also verifies that an incomplete paginated Sprint scan retains the previously observed catalog and reports `catalog_incomplete`.

The reported missing-Sprint notice could not be reproduced during investigation. The selected Sprint was present in the live catalog and the operator reported that Refresh worked normally. The cause of the earlier notice remains unknown; no Sprint admission fix is claimed.

A Department may hold old and new IDs for the same named Team. Assigning the same Jira label to both triggers the existing readiness shared-label guard. Explicitly relating Team IDs for readiness remains unresolved; automatically merging IDs by name is not safe. Label autocomplete failures also currently appear as an empty result rather than a readable error; this was recorded without changing the unrelated route or UI.

The separate entity-names plan retains its pending live issue-type check and remains an execution plan until its acceptance criteria are met.

## Verification

- `npm run build`: passed.
- `node --test tests/test_team_availability.js`: 12 passed.
- `.venv/bin/python -m unittest tests.test_work_structure_catalogs tests.test_work_structure_sprint_values tests.test_work_structure_storage`: 91 passed. The added incomplete-refresh case passed separately.
- `npx playwright test tests/ui/work_structure_sprint_admission_refresh.spec.js --browser=chromium --workers=1`: 5 passed; synthetic screenshots were inspected.
- `.venv/bin/python -m unittest discover -s tests`: 3,378 tests, 20 failures, 3 errors, 61 skipped. Failures included the documented local configuration and environment-sensitive cases; the full suite did not pass.
- `.venv/bin/python -m unittest tests.test_quarterly_catchup_routes`: 12 passed, including the shared-label guard.

## Current Accuracy

This is a historical investigation record, not an implementation plan. The Team warning is implemented; the original Sprint notice, shared-label behavior, label-search failure display and live issue-type check remain open as described above.
