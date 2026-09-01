# Task 1 report: tab-local auth recovery capsule

## Outcome

Implemented the pure schema-specific `sessionStorage` recovery capsule with v1 constants, strict allowlists, principal binding, expiry, UTF-8 size enforcement, list limits, and fail-soft storage operations.

## TDD evidence

- RED: `fnm exec --using 20 -- node --test tests/test_auth_resume_state.js` exited `1`; all 5 tests failed because `frontend/src/api/authResumeState.js` was absent.
- GREEN: `fnm exec --using 20 -- node --test tests/test_auth_resume_state.js` exited `0`; 6/6 tests passed.
- Focused hygiene: `git diff --check` exited `0`.

Coverage includes round-trip normalization, identity mismatch clearing, duplicate-write protection, malformed/unsupported/negative/future/expired/oversized rejection, missing principal, invalid view/mode/settings/selection values, selected-key and team limits, privacy exclusions, and blocked `sessionStorage` getter behavior.

## Self-review

Mutation check confirms a matching existing capsule is preserved (`writeAuthResumeState` returns `false` and retains the original timestamp). The module exports only the requested schema API; no generic serializer or arbitrary object fields are accepted. Serialized output is built solely from the allowlisted fields and the privacy test confirms no token, credential, PII, body, draft, or OAuth/PKCE state strings are persisted.

## Changed files

- `frontend/src/api/authResumeState.js`
- `tests/test_auth_resume_state.js`
- `docs/plans/EXEC-multi-device-browser-sessions-02-tab-resume.md` (Task 1 checkboxes/evidence only)

## Commit

Atomic commit: `Add tab-local auth recovery capsule`.
