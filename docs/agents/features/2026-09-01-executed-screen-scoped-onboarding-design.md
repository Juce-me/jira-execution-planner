Status: executed
Type: feature

# Screen-scoped onboarding

## Outcome

Implemented with changes. The approved screen-scoped model shipped with independent persistence for Catch Up, Configuration, Planning, Board, and Statistics. Implementation review additionally made unsupported surface exits explicit interruptions, gated Configuration requests on desktop before emitting start analytics, protected newer module requests from stale surface cleanup, and verified successful and failed Settings replay through the production Dashboard fixture.

## Goal

Teach users only the screen they are currently using. Catch Up must not require or prompt navigation through Configuration, Planning, Board, or Statistics. Each other screen starts its own tour the first time the user opens it, and completion is remembered across logins.

## User experience

- Catch Up starts automatically after the first eligible login and contains only Catch Up guidance.
- The end of Catch Up points out Settings with concise copy explaining that Departments can be added or managed there.
- Catch Up also points out the `.segmented-control.eng-mode-control` as the control for switching tools.
- These two steps are informational and do not require the user to leave Catch Up.
- Opening Planning, Board, Statistics, or Configuration starts only that screen's unfinished tour.
- Catch Up field previews keep Next enabled: Next or the highlighted field opens the read-only preview, while a preview choice/surface, the same field, or Next advances exactly once without a Jira mutation.
- Escape closes a field preview without advancing, and the final Catch Up informational steps return to the visible header controls without opening another surface.
- Finishing or skipping a tour completes only its current module.
- Returning to a completed screen does not replay its tour.
- Replay onboarding clears all module completions and restarts Catch Up.

The module identifiers are `catch-up`, `configuration`, `planning`, `board`, and `statistics`.

## Architecture and data flow

Add a private `completedOnboardingModules` list to `UserGroupPreference`, stored as a non-null JSON array. The backend owns normalization and accepts only known module identifiers without duplicates.

The group-preference bootstrap returns the canonical completed-module list. `onboardingDone` remains in the response as a derived compatibility value that is true only when all five modules are complete. Existing records with `onboarding_done = true` migrate to all five module identifiers; records with `onboarding_done = false` migrate to an empty list.

The onboarding preference endpoint gains module-scoped completion while retaining the existing boolean reset contract used by Replay onboarding:

- Completing or skipping a module adds that module idempotently and returns the canonical list plus derived `onboardingDone`.
- Resetting onboarding clears the list and returns `onboardingDone: false`.
- Unknown modules, mixed completion/reset payloads, non-DB auth, missing personal preferences, and storage errors fail closed through the existing sanitized error contract.

The frontend controller starts Catch Up automatically only when that module is incomplete. Surface changes request the matching module only when it is incomplete. No tour transition requires a launcher step from another module. The tour state is scoped to the active module, and successful persistence updates the bootstrapped private preference state before closing that module's coachmark.

## Catch Up catalog

Preserve the existing Catch Up-specific dashboard, hierarchy, field-preview, and Jira guidance. Remove the four module-launch steps that currently direct users into Configuration, Planning, Board, and Statistics.

Replace them with two manually advanced informational steps:

1. Settings launcher: explain that the user can add or manage Departments in Settings.
2. ENG mode control: explain that the segmented control switches between tools.

Neither step is a prerequisite for completing Catch Up and neither programmatically opens another surface.

## Contextual modules

Planning, Board, Statistics, and Configuration retain their existing destination-specific coachmarks. They start only after the user opens the corresponding real surface. Closing a surface interrupts its unfinished tour without completing it; reopening the surface starts that module again. Completing or skipping it persists only that module.

## Existing-user compatibility

- Existing completed users must see no new tours after migration.
- Existing unfinished users begin the new module sequence at Catch Up.
- New users begin with an empty completion list after their required Department selection.
- The existing `onboardingDone` field remains derived and supported so unrelated preference consumers do not break during this change.

## Analytics

Keep the current onboarding event names and two-trigger GTM contract. Add a typed `module_id` parameter with the five canonical module values to onboarding start, completion, and skip events. Update the analytics taxonomy and GA4 runbook only where the new parameter changes the documented contract. No new event name is required.

## Error handling

Module completion is optimistic only after the server verifies and returns the canonical module list. If persistence fails, the active tour remains open, the module remains incomplete locally, and the existing safe retry message is shown. Authentication-required failures continue through the global locked recovery screen and must not be rendered as raw onboarding errors.

## Files in scope

- `backend/db/models.py`
- a new Alembic migration under `backend/db/migrations/versions/`
- `backend/services/shared_group_config.py`
- `backend/routes/settings_routes.py`
- `frontend/src/api/configApi.js`
- `frontend/src/dashboard.jsx`
- `frontend/src/eng/EngModeControl.jsx`
- `frontend/src/onboarding/OnboardingTour.jsx`
- `frontend/src/onboarding/onboardingAnalytics.js`
- `frontend/src/onboarding/onboardingModules.js`
- `frontend/src/onboarding/onboardingSteps.js`
- `frontend/src/onboarding/useOnboardingTour.js`
- affected onboarding styles only if a whole-control target requires them
- onboarding backend, unit, source-guard, analytics, and Playwright tests
- `docs/features/onboarding.md`
- affected analytics taxonomy and GA4 runbook documentation
- generated `frontend/dist/` output produced by `npm run build`

No unrelated Settings, Department, dashboard, or authentication behavior is in scope. Existing dirty worktree changes outside these files must be preserved.

## Acceptance criteria

1. A new eligible user sees Catch Up onboarding after completing required Department selection.
2. Catch Up never requires opening Settings or another ENG mode.
3. Catch Up points out Settings and the complete ENG segmented control with concise informational copy.
4. Finishing Catch Up prevents it from replaying across refreshes and logins while leaving other modules pending.
5. First opening Planning, Board, Statistics, or Configuration starts only that screen's tour.
6. Finishing or skipping one screen does not complete any other screen.
7. Completed screen tours do not replay unless onboarding is explicitly reset.
8. Replay onboarding clears all five completions and restarts Catch Up.
9. Existing `onboarding_done = true` users migrate without receiving new tours.
10. A failed completion write leaves the current tour visible and retryable.
11. Onboarding analytics include the canonical `module_id` without changing event names or transport triggers.
12. Focused backend/frontend tests, Playwright onboarding coverage, `npm run build`, preflight, and the full Python suite pass; generated frontend output has no unexplained diff.

## Verification plan

- Write and run failing backend tests for migration normalization, module validation, idempotent completion, isolation, reset, and compatibility responses.
- Write and run failing frontend tests for the Catch Up catalog, active-surface routing, per-module completion, interruption/reopen behavior, and analytics parameters.
- Add Playwright coverage that begins on Catch Up, completes it without leaving the screen, then independently opens and completes Configuration, Planning, Board, and Statistics without forced clicks.
- Verify Settings and segmented-control geometry/layering with normal pointer interaction; never use `force: true`.
- Run `npm run build`, the relevant Node tests, the relevant Python tests, the onboarding Playwright spec, preflight, and the full Python suite.
- Inspect the final diff and compare stable before/after screenshots for Catch Up and at least one contextual module.

## Current accuracy

Accurate for the feature goal, data contract, module catalog, migration, analytics, and acceptance criteria. Production code, tests, and `docs/features/onboarding.md` are the source of truth for the additional interruption, mobile deferral, stale-save, and replay-ordering safeguards discovered during browser verification.
