# Codebase Operability: Planning Project Split Bar Component

> **Status:** In progress on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move the ENG Planning selected-story-points-by-project bar out of `frontend/src/dashboard.jsx` into a small presentational component while preserving the existing target marker, class names, inline styles, tooltips, and empty state.

## Scope

- Add `frontend/src/eng/PlanningProjectSplitBar.jsx`.
- Update `frontend/src/dashboard.jsx` to import and render the component.
- Add source guards and a light Planning smoke assertion.
- Do not change selected project stat derivation, excluded capacity math, team microbars, Planning state, persistence, sticky ownership, CSS, Scenario, settings, or backend APIs.

## Files

- `frontend/src/eng/PlanningProjectSplitBar.jsx`
- `frontend/src/dashboard.jsx`
- `tests/test_planning_action_source_guards.js`
- `tests/ui/codebase_structure_smoke.spec.js`
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

`Extract planning project split bar`
