# Codebase Operability: Planning Capacity Bar Component

> **Status:** In progress on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move the ENG Planning capacity bar and selected-summary fallback JSX out of `frontend/src/dashboard.jsx` into a small presentational component while preserving the existing marker math, labels, classes, and fallback text.

## Scope

- Add `frontend/src/eng/PlanningCapacityBar.jsx`.
- Update `frontend/src/dashboard.jsx` to import and render the component.
- Add source guards for the extraction boundary.
- Do not change Planning state, capacity calculations, team microbars, project split bars, persistence, sticky ownership, or backend routes.

## Files

- `frontend/src/eng/PlanningCapacityBar.jsx`
- `frontend/src/dashboard.jsx`
- `tests/test_planning_action_source_guards.js`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`

## Verification

- `node --test tests/test_planning_action_source_guards.js`
- `npm run test:frontend:unit`
- `npm run build`
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`
- `npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks"`
- `make verify-dist-clean`

## Commit

`Extract planning capacity bar`
