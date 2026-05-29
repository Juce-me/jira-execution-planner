# Codebase Operability: ENG Planning Selection Stats

> **Status:** Implemented and verified locally on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move pure selected-planning aggregation reducers out of `frontend/src/dashboard.jsx` without changing Planning rendering, selection state, capacity tables, or sticky behavior.

## Scope

- Add `frontend/src/eng/planningSelectionStats.js` for selected task filtering, selected story-point totals, team totals, project totals, team/project totals, and excluded-project totals.
- Update `dashboard.jsx` to import and call those helpers.
- Add direct Node tests and source guards.
- Do not move Planning JSX, action handlers, capacity table totals, Jira links, dependency focus, or selected-entry render derivations.

## Files

- `frontend/src/eng/planningSelectionStats.js`
- `frontend/src/dashboard.jsx`
- `tests/test_planning_selection_stats.js`
- `tests/test_planning_action_source_guards.js`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `node --test tests/test_planning_selection_stats.js tests/test_planning_action_source_guards.js` passed on 2026-05-28.
- `npm run test:frontend:unit` passed on 2026-05-28.
- `npm run build` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.

## Commit

`Extract ENG planning selection stats`
