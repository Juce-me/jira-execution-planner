# Codebase Operability: Frontend API Boundary

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Finish the current frontend API boundary slice by moving the remaining raw endpoint construction out of `frontend/src/dashboard.jsx` and into `frontend/src/api/*` modules, without changing user-visible behavior.

## Scope

- Add API modules for Scenario Planner, stats fetches, and issue lookup.
- Add the missing EPM config save wrapper to the existing EPM API module.
- Keep Scenario state orchestration, dirty-edit guards, polling guards, and UI state in `dashboard.jsx`.
- Update source guards so new endpoint literals are blocked from returning to `dashboard.jsx`.

## Files

- `frontend/src/api/epmApi.js`
- `frontend/src/api/scenarioApi.js`
- `frontend/src/api/statsApi.js`
- `frontend/src/api/issuesApi.js`
- `frontend/src/dashboard.jsx`
- `tests/test_frontend_api_source_guards.js`
- `tests/test_scenario_draft_history_source_guards.js`
- `tests/test_stats_module_extraction_source_guards.js`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `node --test tests/test_frontend_api_source_guards.js tests/test_scenario_draft_history_source_guards.js tests/test_stats_module_extraction_source_guards.js`: passed 46 tests.
- `node --test tests/test_epm_settings_source_guards.js tests/test_frontend_api_source_guards.js tests/test_scenario_draft_history_source_guards.js tests/test_stats_module_extraction_source_guards.js`: passed 68 tests after updating the EPM settings source guard.
- `npm run build`: passed and regenerated `frontend/dist/dashboard.js`.
- `npm run test:frontend:unit`: passed 250 tests.
- `make verify-dist-clean`: expected to fail before commit because `frontend/dist/dashboard.js` changed; rerun after committing generated dist.

## Commit

`Move dashboard endpoint construction to API modules`
