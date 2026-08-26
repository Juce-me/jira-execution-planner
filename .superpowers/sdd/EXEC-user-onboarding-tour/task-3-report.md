# Task 3 report: Reuse the configure-your-own first-run flow

## Status

Complete.

## Delivered behavior

- The mandatory picker now labels its existing action **Configure your own**.
- That action sets the single `firstRunConfigurationActive` context and reuses the existing `openFirstRunAddGroup` path to Settings → Departments → Team groups.
- Team groups displays the required duplicate-first guidance when a group can be duplicated, or the required create-first guidance when none can be duplicated.
- First-run configuration preserves the unified Settings Save, Cancel, discard, and `409` conflict paths. A shared-group save made from this context does not persist a personal favorite, so the mandatory picker returns after Settings closes.
- The context remains active while Settings is open, including validation and conflict states, and clears only after Settings closes.
- No created or duplicated group is automatically starred, and shared `defaultGroupId` behavior is unchanged.
- First-run Settings hides favorite and visibility controls, so it exposes only shared group edits that its unified Save persists.

## RED evidence

After adding the first-run Playwright journeys and rebuilding the frontend, the initial focused run failed because the mandatory picker exposed `Configure` rather than `Configure your own`. The first new journey timed out waiting for the missing accessible button name; the Playwright page snapshot showed the existing `Configure` control.

## GREEN evidence

- `npm run build` completed successfully with the bundled Node runtime.
- Focused first-run journeys: `4 passed`.
- Full related browser spec: `15 passed` in `tests/ui/shared_department_groups.spec.js`.
- Settings source-contract guard: `24 passed` in `tests/test_epm_settings_source_guards.js`.

## Coverage added

- Existing and no-group first-run states, with no editable personal-preference controls.
- A shared-board validation failure created by deleting the only column, with a blocked `Ctrl+S` attempt, correction, and successful save.
- No-groups creation through Add group, refresh/add team, Save, and mandatory-picker return without auto-starring.
- Save without automatic starring, followed by mandatory-picker return.
- Dirty Cancel, Keep editing, Discard, and return behavior.
- `409` recovery that keeps Settings open until the user closes it.

## Scope

Changed only the first-run modal, visibility-preference hook, Team groups Settings wiring, dashboard first-run save gates, generated frontend bundle, and related Playwright coverage. Pre-existing onboarding plan, gate, and index edits were not modified.

## Remaining verification

The full repository Python suite was not run; the requested focused frontend/browser and source-contract checks passed.

## Review round 1 fix evidence

### RED

The new existing-group journey expected no favorite control in first-run Settings and failed with `Expected: 0, Received: 1`. This demonstrated that the favorite control remained editable even though first-run Save deliberately skips preference persistence.

### GREEN

- `npm run build` completed successfully with the bundled Node runtime.
- The two new focused regression journeys passed.
- The round 1 full related browser spec passed: `14 passed`.
- The Settings source-contract guard passed: `24 passed`.

## Review round 2 fix evidence

### RED

Two new first-run journeys expected no validation before a shared edit. Both failed because Settings rendered `Choose one visible group as your favorite.` before the mandatory picker could collect that personal choice.

### GREEN

- The no-groups journey now confirms the impossible personal validation is absent, creates a group, adds a team, saves, and returns to the mandatory picker with no selection.
- The board journey creates a real shared validation error by deleting its only column, proves the Settings modal remains open through a blocked save attempt, restores a valid column and status, saves, and returns to the mandatory picker.
- The focused two-journey run passed.
- The final full related browser spec passed: `15 passed`; the Settings source-contract guard passed: `24 passed`.
