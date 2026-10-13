# Postmortem MRT032: Lazy View Rejection Loop

**Date**: 2026-10-13
**Severity**: Medium
**Status**: Resolved locally; publication pending
**Author**: Team

## Impact

An older open dashboard requested a Statistics chunk that the server returned as HTTP 404. Statistics stayed on its loading message while imports repeated, leaving the user without an obvious recovery action. The same lazy boundary serves Scenario and Settings.

## Root cause

`lazyViewFor` removed a rejected `React.lazy` component from its cache before React committed the error state. Concurrent parent updates could recreate that component and start another promise, suspending again. A mounted browser fixture with a real missing module and 10 ms parent updates reproduced 24 loader calls for one open; its one-call assertion failed.

The existing browser tests covered transient aborts and retry validation without continuous parent updates. The server-render unit test explicitly expected rejection eviction, reinforcing the incorrect lifecycle. Final recovery guidance was text only.

Read-only diagnosis confirmed that the reported chunk URL returned 404, while the current server entry referenced a different Statistics chunk that returned 200. The tab retained an old asset reference; the exact server rebuild history was not established.

## Resolution

- Keep rejected lazy components cached across renders and reopenings. Explicit Retry selects the separate attempt; a successful retry continues to serve subsequent opens.
- Keep the existing validated mounted-build manifest and cache-busted retry contract.
- Add a user-initiated Reload page button after retry failure or a stale manifest, with an unsaved-changes warning.
- Preserve terminal authentication recovery precedence and propagation of errors thrown inside a loaded view.

## Verification

- The red/green mounted browser fixture exercises a real HTTP 404 during continuous parent renders, reopening, and explicit Retry for Statistics, Scenario, and Settings.
- Committed-build browser tests cover successful Retry, a missing chunk plus missing manifest, actual page reload into a working Statistics panel, malformed/mismatched manifests, cached reopen, delayed Burndown, and terminal authentication recovery.
- Synthetic screenshots show the settled recovery button and the restored panel. No live Jira screenshots or data are retained.

## Lessons learned and prevention

Suspense promise rejection is part of a component's stable identity. Evicting it before error handling commits can convert a settled failure into recurring loading work. Tests must include unrelated parent updates while the first lazy mount is suspended.

## Action items

- [x] Retain rejected lazy components until explicit recovery.
- [x] Replace the eviction unit test with a stable-rejection regression.
- [x] Cover each shared lazy-view identity in a mounted concurrent-render test.
- [x] Exercise the Reload page action against the built dashboard.

## References

- [`LazyViewBoundary.jsx`](../../frontend/src/components/LazyViewBoundary.jsx)
- [`lazyViewLoaders.js`](../../frontend/src/components/lazyViewLoaders.js)
- [`test_lazy_view_boundary.js`](../../tests/test_lazy_view_boundary.js)
- [`lazy_view_boundary.spec.js`](../../tests/ui/lazy_view_boundary.spec.js)
- [`codebase_structure_smoke.spec.js`](../../tests/ui/codebase_structure_smoke.spec.js)
- [Statistics recovery contract](../features/statistics.md#implementation-ownership)
