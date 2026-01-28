# Postmortem MRT007: Bundled Frontend Regression

**Date**: 2026-01-28
**Severity**: High
**Status**: In Progress
**Author**: Codex

---

## Summary
A frontend bundling change (removing in-browser Babel and serving a compiled bundle) caused the dashboard to fail to load when served from the Flask backend. Users saw 404s for `frontend/dist/dashboard.js`, server startup errors due to duplicate routes, and runtime JS exceptions in the browser console.

## Impact
- **Users Affected**: Anyone running the dashboard via `python3 jira_server.py`.
- **Symptoms**:
  - `GET /frontend/dist/dashboard.js` returned 404.
  - Flask failed to start with a duplicate route error.
  - Browser console error: `ReferenceError: can't access lexical declaration ... before initialization`.

## Root Cause
1. **Static asset routing was missing**: the server did not serve `frontend/dist` after the move to a bundled JS file.
2. **Route duplication**: a new `/` handler was added without noticing an existing `/` route in the server, causing Flask to abort.
3. **Bundling exposed a TDZ ordering issue**: some `useMemo/useCallback` values were referenced before declaration after bundling/minification, triggering a temporal dead zone error in the browser.
4. **No end‑to‑end smoke check**: changes were verified by unit tests only; there was no browser/server smoke test for asset loading and runtime errors.

## Timeline
- Bundling change merged into the branch.
- First run from Flask returned 404 for `frontend/dist/dashboard.js`.
- Server failed to start due to a duplicate route definition.
- After route fix, runtime JS error appeared in the browser console.

## Resolution
In progress:
- Add explicit static routes for `/frontend/dist/*`.
- Remove duplicate `/` route to allow Flask to boot.
- Reorder or refactor memo/callback declarations to avoid TDZ errors.

## Verification
- Start server and confirm `GET /frontend/dist/dashboard.js` returns 200.
- Load `http://localhost:5050/` and confirm no console errors.
- Run unit tests (`python3 -m unittest discover -s tests`).

## Lessons Learned
- Major build workflow changes require a browser smoke test.
- Static asset serving must be explicitly updated when moving files.
- Bundlers can surface ordering bugs even in previously working code; treat them as correctness issues, not tool noise.

## Action Items
- [ ] Add a smoke test checklist (server start + dashboard load) to README/CI.
- [ ] Refactor the dashboard component to avoid TDZ by reordering memo/callback declarations.
- [ ] Add a lint or build check to flag use-before-declare for `const` in the component.
- [ ] Add a static asset routing test (simple curl) to CI.
