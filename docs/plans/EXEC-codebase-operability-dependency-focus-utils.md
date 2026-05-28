# Codebase Operability: Dependency Focus Utilities

> **Status:** Implemented and verified locally on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move pure dependency focus/key helpers out of `frontend/src/dashboard.jsx` and share block-link bucket logic with issue dependency rendering without changing dependency chip UI, lookup fetching, focus state behavior, or Jira export behavior.

## Scope

- Add `frontend/src/issues/dependencyFocusUtils.js` for dependency key signatures, issue maps, block buckets, focus key resolution, and focus payload construction.
- Update `frontend/src/dashboard.jsx` to import and call those helpers from existing memo/callback boundaries.
- Update `frontend/src/issues/IssueDependencies.jsx` to reuse the shared block/dependency helpers.
- Add focused Node tests and source guards.
- Do not touch Scenario, settings, backend files, CSS, sticky UI, endpoint behavior, or dependency lookup request code.

## Files

- `frontend/src/issues/dependencyFocusUtils.js`
- `frontend/src/issues/IssueDependencies.jsx`
- `frontend/src/dashboard.jsx`
- `tests/test_dependency_focus_utils.js`
- `tests/test_planning_action_source_guards.js`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `node --test tests/test_dependency_focus_utils.js tests/test_planning_action_source_guards.js` passed on 2026-05-28.
- `npm run test:frontend:unit` passed on 2026-05-28.
- `npm run build` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.
- `make verify-dist-clean`: run after committing generated dist.

## Commit

`Extract dependency focus utilities`
