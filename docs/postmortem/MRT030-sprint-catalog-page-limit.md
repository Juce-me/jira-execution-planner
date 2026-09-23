# MRT030: Sprint catalog rejected a Jira-capped Board page

**Date:** 2026-09-23
**Severity:** High
**Status:** In Progress

## Impact

The reported authenticated dashboard stayed on “Loading sprints.” Its `/api/sprints` request returned `502 sprint_catalog_unavailable` with `failureCode=catalog_incomplete` and no validated catalog payload, so the Sprint selector and dependent ENG data could not load. The duration and number of affected users are unknown. The reported error code does not disclose which validation check rejected the live Jira response.

## Root cause

The persistent DB/OAuth Sprint catalog replaced the tolerant Board reader with `fetch_board_sprints`. That strict reader required the response's `maxResults` to equal the requested 100. Jira Software pagination permits resource-specific caps and fewer returned rows than requested. A successful page reporting `maxResults: 50` was therefore rejected as `catalog_incomplete` before publication. This defect is proven locally; without the authenticated upstream page, attributing the reported live `502` specifically to this check remains an inference.

The existing tests all used response `maxResults: 100`, so they confirmed the implementation's assumption rather than the documented endpoint behavior. The earlier cache-buster fix removed a separate `400` but could not address this server-side rejection.

## Timeline

- The persistent catalog change introduced exact response-limit validation and made a validated catalog the prerequisite for ENG startup.
- The first reported startup failure exposed incompatible client cache-buster parameters, which were removed and tested.
- The next authenticated response was `502 catalog_incomplete`, with no validated catalog.
- A capped, endpoint-shaped response reproduced the same `502` through the authenticated route fixture.

## Resolution

The Board fetcher now accepts a positive integer response `maxResults` and still requires `len(values) <= maxResults`, matching `startAt`, a boolean `isLast`, progress by received rows, and the existing page/row/deadline limits. The Board-only source and workspace publication contract are unchanged; no issue-search fallback was added.

## Verification

New service and authenticated-route tests failed before the change: the service raised `catalog_incomplete`, and the cold route returned `502`. After the change, the focused Sprint service and persistent catalog route files passed 45 tests. The route fixture cold-fills a nonempty catalog from a capped page and then reads that catalog without another Jira call. Malformed, empty nonfinal, overfull, and stalled pages remain covered. The full Python suite passed 1,910 tests with 25 skips, and the frontend unit suite passed 1,423. Independent review evidence belongs in the active [runtime repair plan](../plans/EXEC-persistent-sprint-team-catalogs-runtime-repair.md). Authenticated live Jira/browser verification is still open.

## Lessons learned

Strict completeness validation must check continuity and bounds, not equality between a requested page size and Jira's reported limit. Endpoint-shaped synthetic fixtures need a capped-page case. A local green suite cannot establish that a new catalog authority works against the authenticated tenant.

## Prevention and action items

- [x] Add capped-page service and cold-route regressions with red/green proof.
- [x] Preserve strict incomplete-page rejection while accepting a positive reported page limit.
- [ ] Capture a sanitized authenticated cold and cached Sprint result, plus per-Sprint Team refresh, before marking the catalog migration accepted.
- [ ] Complete the runtime plan's two-user, workspace-isolation, and cached-latency checks.

## References

- `backend/services/sprints.py::fetch_board_sprints`
- `backend/routes/settings_routes.py::get_sprints`
- `tests/test_sprint_service.py`
- `tests/test_persistent_catalog_routes.py`
- [Jira Software REST pagination](https://developer.atlassian.com/cloud/jira/software/rest/intro/)
- [Runtime repair plan](../plans/EXEC-persistent-sprint-team-catalogs-runtime-repair.md)
