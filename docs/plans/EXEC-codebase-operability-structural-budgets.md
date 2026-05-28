# Codebase Operability: Structural Budgets

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Add a small source guard that prevents the two legacy entry points from quietly growing while extraction work continues.

## Scope

- Add line-count budgets for `jira_server.py` and `frontend/src/dashboard.jsx`.
- Set budgets to the current post-extraction sizes and keep them as ceilings.
- Do not move code or change runtime behavior in this slice.

## Files

- `tests/test_codebase_structure_budgets.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: failed first with intentionally low budgets, then passed after setting current ceilings.
- `npm run test:frontend:unit`: passed 250 tests.

## Commit

`Add legacy entrypoint size budgets`
