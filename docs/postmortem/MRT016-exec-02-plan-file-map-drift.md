# Postmortem MRT016: EXEC-02 Plan File Map Drift

**Date**: 2026-05-11
**Severity**: Medium
**Status**: Resolved
**Author**: Codex

## Summary

EXEC-02 Task 4 blocked during execution because the plan listed frontend files that did not exist in the repository and described one future file as an existing file to modify. The plan also asked Task 4 to wire recovery for a Home write-route error before Task 5 introduced the route that can produce that error.

## Impact

- Users affected: developers executing the DB Home user API-token bridge plan.
- Runtime impact: none; the issue was caught before frontend implementation continued.
- Symptoms: execution stopped at Task 4 after `frontend/src/api/authApi.js` and `tests/ui/home_token_connection_settings.spec.js` could not be found.

## Root Cause

The plan's file map was tightened without re-validating every named path against the current repository. `frontend/src/api/authApi.js` and `tests/ui/home_token_connection_settings.spec.js` were intended as new files, but the task listed `authApi.js` as `Modify` and did not make the Playwright spec creation explicit.

The plan also mixed task boundaries: Task 4 was assigned `home_user_token_required` recovery wiring, but the concrete Home write route that can return `home_user_token_required` is Task 5 scope. That made Task 4 impossible to complete exactly as written without either inventing a placeholder write action or pulling Task 5 work forward.

## Timeline

- 2026-05-08: EXEC-02 was tightened to add preflight gates and a concrete Home project update route.
- 2026-05-11: Tasks 1-3 landed on `cdx/auth-db-context-plan`.
- 2026-05-11: Task 4 pre-edit file checks found missing frontend files.
- 2026-05-11: Git history confirmed the missing files never existed in this branch.
- 2026-05-11: EXEC-02 was patched to distinguish created files from modified files and to move Home write-route recovery wiring into Task 5.

## Resolution

- Updated EXEC-02 File Map to mark `frontend/src/api/authApi.js` and `tests/ui/home_token_connection_settings.spec.js` as files to create.
- Updated Task 2 file ownership to match the committed backend route registration changes.
- Updated Task 4 so it creates the Connections UI and opener but does not wire nonexistent Home write-route recovery.
- Updated Task 5 so the concrete Home update route owns the EPM project board action and missing-token recovery wiring.
- Added the missing Playwright commands to Task 4 and Task 5 verification.

## Verification

- `git log --oneline --all -- frontend/src/api/authApi.js tests/ui/home_token_connection_settings.spec.js` returned no entries.
- `rg --files frontend/src/api frontend/src/settings tests/ui` showed the current frontend API, settings, and UI test layout.
- `rg -n "home-token|UserConnectionsSettings|home_token_connection_settings"` found only the plan and newly committed backend tests/routes, not existing frontend files.

## Lessons Learned

- Every implementation plan file map needs an `rg --files` check immediately before execution, especially after plans are tightened days after drafting.
- `Create` vs `Modify` matters for agentic execution because missing expected files are blockers, not implementation details.
- Task boundaries must match causal order; recovery UI for a backend error belongs after the backend route can actually return that error.

## Action Items

- [x] Re-review EXEC-02 against the current repo layout.
- [x] Correct Task 4 and Task 5 ownership and verification commands.
- [x] Document the mismatch in this postmortem.
- [ ] Resume EXEC-02 Task 4 from the corrected plan.

## Prevention

- Before executing any `EXEC-*` plan task that names frontend files, run `rg --files` for every path in that task's file map.
- Plans must label nonexistent files as `Create` and include the test command that runs any newly created Playwright spec.
- Do not assign frontend recovery behavior to a task that precedes the backend route capable of producing the recovery error.

## Related Issues

- `docs/plans/EXEC-02-db-home-user-api-token-bridge.md`
