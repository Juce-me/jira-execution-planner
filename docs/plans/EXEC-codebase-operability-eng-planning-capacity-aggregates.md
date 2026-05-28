# Codebase Operability: ENG Planning Capacity Aggregates

> **Status:** Implemented and verified locally on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move pure Planning capacity aggregation and entry-shaping helpers out of `frontend/src/dashboard.jsx` without changing the Planning panel UI, capacity fetching, sticky behavior, or selection state.

## Scope

- Extend `frontend/src/eng/planningCapacityUtils.js` with capacity table aggregation helpers.
- Update `dashboard.jsx` to import and call those helpers from existing memo boundaries.
- Add direct Node tests and source guards.
- Do not move capacity fetch effects, capacity lookup functions, Planning JSX, action handlers, or dependency focus behavior.

## Files

- `frontend/src/eng/planningCapacityUtils.js`
- `frontend/src/dashboard.jsx`
- `tests/test_planning_capacity_utils.js`
- `tests/test_planning_action_source_guards.js`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `node --test tests/test_planning_capacity_utils.js tests/test_planning_action_source_guards.js` passed on 2026-05-28.
- `npm run test:frontend:unit` passed on 2026-05-28.
- `npm run build` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.

## Commit

`Extract ENG planning capacity aggregates`
