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

## RED evidence

After adding the first-run Playwright journeys and rebuilding the frontend, the initial focused run failed because the mandatory picker exposed `Configure` rather than `Configure your own`. The first new journey timed out waiting for the missing accessible button name; the Playwright page snapshot showed the existing `Configure` control.

## GREEN evidence

- `npm run build` completed successfully with the bundled Node runtime.
- Focused first-run journeys: `4 passed`.
- Full related browser spec: `14 passed` in `tests/ui/shared_department_groups.spec.js`.
- Settings source-contract guard: `24 passed` in `tests/test_epm_settings_source_guards.js`.

## Coverage added

- Existing and no-group first-run states.
- Save without automatic starring, followed by mandatory-picker return.
- Existing validation state.
- Dirty Cancel, Keep editing, Discard, and return behavior.
- `409` recovery that keeps Settings open until the user closes it.

## Scope

Changed only the first-run modal, visibility-preference hook, Team groups Settings wiring, dashboard first-run save gates, generated frontend bundle, and related Playwright coverage. Pre-existing onboarding plan, gate, and index edits were not modified.

## Remaining verification

The full repository Python suite was not run; the requested focused frontend/browser and source-contract checks passed.
