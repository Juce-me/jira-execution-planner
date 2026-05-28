# Codebase Operability: ENG Planning Capacity Utils

> **Status:** Implemented and verified locally on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move pure ENG Planning capacity status/math helpers out of `frontend/src/dashboard.jsx` without changing Planning panel rendering or state ownership.

## Scope

- Add `frontend/src/eng/planningCapacityUtils.js` for capacity status, team capacity metadata, summary totals, and project capacity split helpers.
- Update `dashboard.jsx` to import and call those helpers.
- Add direct Node tests and source guards.
- Do not move Planning JSX, sticky behavior, selection state, Jira links, or capacity fetch state.

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

`Extract ENG planning capacity helpers`
