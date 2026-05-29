# Codebase Operability: Structural Budgets

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Add a small source guard that prevents the two legacy entry points from quietly growing while extraction work continues.

## Scope

- Add line-count budgets for `jira_server.py` and `frontend/src/dashboard.jsx`.
- Ratchet budgets after follow-up extraction slices so the legacy entry points cannot silently regain removed code.
- Do not move code or change runtime behavior in this slice.

## Files

- `tests/test_codebase_structure_budgets.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: failed first with intentionally low budgets, then passed after setting current ceilings.
- `npm run test:frontend:unit`: passed 250 tests.
- After follow-up extraction slices, `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed with ratcheted ceilings of 5900 lines for `jira_server.py` and 15050 lines for `frontend/src/dashboard.jsx`.

## Commit

`Add legacy entrypoint size budgets`

`Ratchet legacy entrypoint size budgets`
