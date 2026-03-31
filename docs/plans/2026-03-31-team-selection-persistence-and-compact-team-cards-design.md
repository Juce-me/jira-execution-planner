# Team Selection Persistence And Compact Team Cards Design

## Summary

This design covers two planning-module refinements:

1. Persist the selected team dropdown choice by `group + sprint`, restoring it on refresh and across sprint changes when the chosen team still exists in the new sprint scope.
2. Keep the `Selected SP by Team` cards vertically compact even for low team counts, and force `6` selected teams onto multiple rows instead of one wide row.

The change is frontend-only and uses browser storage plus existing team-sanitization logic.

## Goals

- Preserve the team dropdown choice per `group + sprint`.
- Fall back to `All Teams` whenever the stored team is not valid in the current scope.
- Keep the team-card block visually compact for `1` and `2` selected teams.
- Treat `6` selected teams as a multi-row layout.

## Non-Goals

- No backend persistence.
- No change to planner story-selection persistence behavior.
- No new width rules for low team-count cards beyond the existing responsive layout.

## Team Selection Persistence

- Keep the current `selectedTeams` React state as the live UI state.
- Add a separate browser cache keyed by `group + sprint`.
- On refresh:
  - derive the current scope key from the active group and selected sprint
  - load the cached team selection for that scope
  - reconcile it against the current team options
  - if valid, apply it
  - otherwise apply `All Teams`
- On sprint change:
  - load the cached team choice for the new `group + sprint`
  - keep it only if the team still exists in the new sprint scope
  - otherwise use `All Teams`
- On dropdown change:
  - update live `selectedTeams`
  - overwrite only the current scope entry

## Compact Team Cards

- Keep one compact vertical style for the `Selected SP by Team` cards regardless of low team count.
- Preserve the existing thin microbar treatment for `1-5` teams instead of letting low counts create tall cards.
- Force `6` selected teams into multiple rows.
- Let `7+` teams continue to wrap naturally.

## Compatibility Rules

- `All Teams` remains the explicit safe fallback value.
- The scoped team-selection cache takes precedence over older global team prefs when valid.
- Invalid cached teams are dropped through the same sanitization path already used elsewhere.

## Verification

- Refresh preserves the selected team for the same `group + sprint`.
- Sprint change preserves the selected team only when it still exists in the new scope.
- Invalid or missing teams resolve to `All Teams`.
- `1` and `2` selected teams render with the same compact-height treatment as the denser layout.
- `6` selected teams render on multiple rows.
