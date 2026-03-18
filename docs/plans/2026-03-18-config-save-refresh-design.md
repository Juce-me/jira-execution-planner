# Config Save Refresh Design

**Problem:** When team-group configuration changes are saved, the dashboard can keep showing stale data for the currently selected sprint. This is most visible when adding teams to the active group: the save succeeds, but the selected sprint view does not refetch immediately.

**Root Cause:** The frontend saves the new group config, then rehydrates active-group state from cached sprint data. Because the cache snapshot is rewritten with the new team signature before the selected-sprint loaders rerun, the normal sprint-loading effect can incorrectly treat the stale snapshot as current and skip a fetch.

## Approved Scope

- Trigger a refresh after every successful configuration save.
- Refresh only the currently selected mode's data for the selected sprint.
- Keep the change localized to the frontend save flow.

## Chosen Approach

Introduce a save-refresh nonce and a targeted invalidation helper in the dashboard state layer.

- After a successful save, invalidate sprint-scoped state for the active group.
- Bump a `configRefreshNonce` so sprint-scoped effects can bypass cached snapshots once.
- For task-based modes (`Catch Up`, `Planning`, `Statistics`), rerun the selected sprint task loaders and missing-info fetch.
- For `Scenario`, rerun the scenario request after the new config is applied.

## Why This Approach

- It fixes the stale-cache short circuit at the source.
- It keeps refresh behavior centralized instead of scattering fetch calls across the save handler.
- It avoids reloading hidden modes, which keeps the refresh aligned with the user's active view.

## Verification

- Add a small testable helper for the active-mode refresh decision.
- Build the frontend bundle.
- Run the Python test suite.
