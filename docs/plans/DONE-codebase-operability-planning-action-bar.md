# Codebase Operability: Planning Action Bar

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Move the ENG Planning action button row out of `frontend/src/dashboard.jsx` into an ENG-owned component while leaving Planning state, handlers, capacity math, persistence, and capacity bar rendering in `dashboard.jsx`.

## Scope

- Add `frontend/src/eng/PlanningActionBar.jsx`.
- Replace only the `planning-actions` JSX block in `frontend/src/dashboard.jsx` with the component.
- Update source guards for the extracted component.
- Do not move selection state, bulk action handlers, capacity JSX, sticky UI, Scenario, settings, backend files, or CSS.

## Files

- `frontend/src/eng/PlanningActionBar.jsx`
- `frontend/src/dashboard.jsx`
- `tests/test_planning_action_source_guards.js`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `node --test tests/test_planning_action_source_guards.js` passed on 2026-05-28.
- `npm run test:frontend:unit` passed on 2026-05-28.
- `npm run build` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.
- `make verify-dist-clean`: run after committing generated dist.

## Commit

`Extract planning action bar`
