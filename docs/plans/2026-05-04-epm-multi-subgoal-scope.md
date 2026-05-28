# EPM Multi-Sub-Goal Scope Plan

> **Legacy plan status:** Unclassified historical plan. Do not execute from this file until it is reviewed and renamed or moved according to `docs/plans/AGENTS.md`.

## Summary

Keep a single `EPM` view. Expand EPM scope from one child sub-goal to multiple selected child sub-goals under the configured root goal, while reusing the existing lifecycle tabs, sprint selector, project picker, all-project rollup, focus-mode rollup, and board rendering.

First optimize existing goal resolution: use live-verified `goals_byKey(containerId, goalKey)` and cached goal ids instead of paginating `goals_search` on the normal path. Keep `goals_search` only as fallback.

## Key Changes

- Add canonical `epm.scope.subGoalKeys`. Read legacy `subGoalKey` as a one-item array, but write `subGoalKeys` going forward.
- Resolve root/sub-goals with `goals_byKey`, cache by `containerId + goalKey`, then use `goals_byId(goalId)` once cached.
- Fetch child sub-goals with `subGoals(archived: false)` and `owner { accountId name }`; owner is display context only.
- Replace Settings -> EPM single Sub-goal selection with compact selected chips plus explicit add/remove picker.
- Project discovery uses saved `subGoalKeys` by default. Optional runtime `subGoalKeys` query params only narrow the current view; they do not mutate config.
- Multi-sub-goal project discovery fetches Home projects for selected sub-goals, dedupes by `homeProjectId`, preserves first-seen order, and adds minimal `subGoalKeys` / `subGoals` metadata.
- Custom projects remain supported, but appear only when using the full saved sub-goal scope, not when narrowed to a runtime sub-goal subset.

## API / Behavior Changes

- `GET /api/epm/goals?rootGoalKey=...` returns child goals with owner metadata.
- Existing EPM endpoints accept optional runtime narrowing:
  - `/api/epm/projects?tab=active&subGoalKeys=CRITE-34,CRITE-63`
  - `/api/epm/projects/rollup/all?tab=active&sprint=42&subGoalKeys=...`
- If `subGoalKeys` is omitted, endpoints use saved `epm.scope.subGoalKeys`.
- Focus-mode rollup still uses the selected project's resolved label. `subGoalKeys` only determines whether that project is visible/selectable in the current narrowed scope.

## Test Plan

- Backend:
  - `goals_byKey` resolves and caches root/sub-goal ids.
  - `goals_search` fallback runs only when `goals_byKey` fails.
  - legacy `subGoalKey` normalizes to `subGoalKeys`.
  - multi-sub-goal project discovery dedupes projects and adds membership metadata.
  - runtime `subGoalKeys` narrows projects and all-project rollups without changing saved config.
  - single-sub-goal EPM behavior remains unchanged.

- Frontend:
  - Settings renders selected sub-goal chips and explicit add/remove flow.
  - saved legacy single sub-goal appears as one selected chip.
  - EPM controls remain labeled `EPM`; no EPML mode or switch is added.
  - runtime selected sub-goal keys are passed to project and rollup fetches.
  - Active sprint gating and visible sprint controls remain intact.

- Verification:
  - focused EPM backend tests
  - EPM frontend/source guards
  - `npm run build`
  - full Python suite
  - visual checks for Settings Scope, EPM Active with one sub-goal, EPM Active with multiple sub-goals, narrowed sub-goal view, Backlog, and Archived

## Assumptions

- EPM is the only user-facing mode name.
- Multi-sub-goal selection is configured in Settings, not inferred from current Jira user.
- Owner metadata is informational only.
- Current Home `subGoals` has no `owner` / `ownerAccountId` argument, verified live; Teamwork Graph Cypher remains future optimization because live probes with current credentials did not work.
