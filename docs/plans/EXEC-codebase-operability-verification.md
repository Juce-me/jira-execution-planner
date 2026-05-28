# Codebase Operability Verification Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Add one local verification path for the repo's existing build, Python tests, endpoint-security tests, Node frontend tests, and generated frontend output check.

## Source Plan

This is the first executable slice recommended by `docs/plans/FUTURE-codebase-operability-improvements.md`.

## Gate Sweep

- `docs/plans/GATE-05-home-write-capability.md`: still blocked.
- Result on 2026-05-28: `.venv/bin/python scripts/check_home_write_capability.py` returned `FAIL insufficient_home_write_probe_input`.
- This slice adds no Home/Townsquare write route, mutation UI, auth behavior, DB behavior, Home metadata behavior, or EPM route behavior.

## File Map

- `package.json`: add frontend unit and UI test scripts.
- `Makefile`: add local verification and dist-clean targets.
- `.github/workflows/verify-frontend-build.yml`: use the frontend unit test script in CI.
- `tests/README.md`: document Python, security, frontend unit, frontend UI, and local verify commands.
- `README.md`: add the contributor-facing local verification command.
- `docs/plans/FUTURE-codebase-operability-improvements.md`: mark the recommended first slice as converted.
- `docs/plans/README.md`: add this active execution plan to the plan index.
- `docs/plans/GATE-05-home-write-capability.md`: record the required startup gate sweep.

## Tasks

1. Add `npm run test:frontend:unit` for the existing Node test runner command: `node --test tests/test_*.js`.
2. Add `npm run test:frontend:ui` for the existing Playwright UI specs under `tests/ui`.
3. Add `make verify` that runs:
   - `npm run build`
   - `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`
   - `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation`
   - `npm run test:frontend:unit`
   - a generated `frontend/dist` cleanliness check
4. Document focused commands in `tests/README.md`.

## Verification

- `.venv/bin/python scripts/check_home_write_capability.py`: returned `FAIL insufficient_home_write_probe_input`; gate remains blocked.
- `npm run test:frontend:unit`: passed 245 tests.
- `npm run test:frontend:ui -- --list`: listed 75 Playwright tests in 16 files.
- `make verify`: passed build, 690 Python tests, 43 endpoint-security tests, 245 Node frontend tests, and the scoped `frontend/dist` cleanliness check.
