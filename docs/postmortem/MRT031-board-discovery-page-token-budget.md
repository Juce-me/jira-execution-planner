# MRT031: Board discovery exclusion clause outgrew its own page token

**Date:** 2026-09-23
**Severity:** High
**Status:** Resolved

## Impact

The ENG Board `all_work` scope was unusable for the reported department. `GET /api/eng/board?scope=all_work` streamed a `start` frame, two candidate `index` frames totalling 160 Epics, then terminated with `error / scope_too_large`, and the dashboard rendered "Loaded so far — Board limit reached; this result is incomplete." Diagnostics reported `jiraPages: 3`, `peakChildSearches: 0`, `durationMs: 1615.7`, `completeness: partial`. No child data was ever fetched. The scope itself was never near any scope ceiling: the complete index is 194 Epics against a 1,000 limit, and 1,821 Stories against 10,000.

## Root cause

`iter_team_epic_batches` appended an exclusion clause to the team-discovery JQL listing every already-known Component Epic key, once for the Epic-link custom field and once for `parent`. For this department that grew the discovery query from 400 to 4,290 characters.

Jira Cloud's `nextPageToken` scales with the JQL text rather than being a fixed-size envelope. Measured on the live tenant across five query shapes, the token runs 1.35x–1.5x of the query length: 373→544, 400→596, 1,410→~1,960, 4,290→5,784, and 6,116→8,220 characters. The inflated query therefore returned a 5,784-character token, and the page-two GET would have been 11,744 bytes against `MAX_ENCODED_REQUEST_BYTES = 7000`. `iter_strict_search_pages` rejected it with `board_scope_too_large` / `phase=index` / `limit=url_bytes` before claiming the request, which is why the page counter froze at three.

The clause reserved a flat 1,024 bytes for the token, with an inline comment stating it must "never turn this optimization into a new request-size failure for large department indexes." The reserve was roughly six times too small. Two sibling call sites made the same assumption: `split_component_batches` used the same 1,024 constant, and `split_epic_batches` reserved nothing at all.

The optimization was not worth its risk even when it worked. It only fitted 124 of the 160 known keys before hitting its own cap, and it filtered 344 of 1,479 discovery rows — at best three pages of fifteen, about one second.

## Timeline

- `6aaf9dac "Improve progressive ENG Board loading"` added the exclusion clause and its 1,024-byte reserve, and shipped with tests that asserted the reserve rather than the behaviour it was supposed to protect.
- The reported authenticated `all_work` request terminated with `scope_too_large` after 1.6 s and three Jira pages.
- A read-only replay of the strict index against live Jira reproduced the terminal frame exactly, with `observed=11744`.
- Disabling only the exclusion clause let the same replay complete: 194 Epics, 25 pages, 7.9 s, worst request 1,428 bytes.

## Resolution

The exclusion clause is removed. Known Component parents were already dropped from the union in Python immediately after the scan, so the clause only ever saved round trips, and it cost the feature.

`paged_search_bytes(jql, fields)` replaces every flat reserve. It sizes the worst continuation request as the encoded request carrying a token 1.5x the JQL length plus a 256-byte envelope, and both batch splitters now budget against it instead of against their first page. `COMPONENT_PAGE_TOKEN_HEADROOM_BYTES` is gone. The scope ceilings — `MAX_EPICS`, `MAX_CHILDREN`, `MAX_BATCH_SIZE`, the page caps — are unchanged.

## Verification

Three regressions failed before the change. The discovery test drives `discover_team_epics` against a fake Jira that returns a token 1.5x its query length, which is the real failure: it raised `board_scope_too_large` at the same line as production, and now pages to completion. The two sizing tests exercise `paged_search_bytes` and both batch splitters directly.

A read-only replay of the real `_frame_stream` generator against live Jira, for the reported department, now terminates `complete / success` with `epicCount: 194`, `childCount: 1821`, `jiraPages: 48`, `indexMs: 7395.9`, `focusedCompleteMs: 13409.8`, `durationMs: 14380.6`, `peakChildSearches: 2`, `completeness: complete`. The worst encoded request across all 48 pages was 4,133 bytes.

At the rebased head, after `main` merged into this branch, the full Python suite passed 1,929 tests with 25 skips in the CI environment (`JIRA_AUTH_MODE=basic`, `CONFIG_STORAGE_BACKEND=jsonfile`), as did the 81-test endpoint security subset. The frontend unit suite passed 1,445 tests, and `npm run build` left `frontend/dist` unchanged. Under the local DB-mode `.env` the same run reports one unrelated error, because `test_oauth_route_guards` resolves that file's socket-form `DATABASE_URL`; it fails identically on the unmodified baseline. No frontend source changed. The reporting user restarted the local stack through `runners/local/run.sh` and confirmed the dashboard loads. That is a user observation, not an agent-verified capture: the browser extension was not reachable from this session, so no independent authenticated `all_work` trace was taken.

## Lessons learned

A paged Jira GET has to be sized by its continuation request, not its first request, because Jira's own response determines whether page two is sendable. A query optimization that lengthens the query is therefore not free — it spends the same budget twice.

The three tests guarding this code asserted the implementation's chosen constant (`<= MAX_ENCODED_REQUEST_BYTES - 1024`) instead of the endpoint's behaviour. They stayed green through a total feature failure. A fake Jira that never returns a realistic token cannot catch a token-size bug; the model has to reproduce the dependency that actually bites.

`MAX_ENCODED_REQUEST_BYTES` is doing more architectural work than a transport limit should. It dictates `MAX_BATCH_SIZE`, Component batching, Epic key batching, and now a token estimate. Jira accepts these searches over POST with no URL ceiling at all, which is tracked as the first slice of the [transport and throughput plan](../plans/EXEC-board-all-work-throughput.md).

## Prevention and action items

- [x] Remove the exclusion clause and prove the live `all_work` index and hydration complete.
- [x] Budget every paged GET splitter with `paged_search_bytes` rather than a flat reserve.
- [x] Replace the constant-asserting tests with a fake Jira whose token scales with the query.
- [x] User-confirmed working in the authenticated local dashboard after restarting via `runners/local/run.sh`; an independent authenticated capture is still worth taking when the browser extension is available.
- [ ] Execute Slice 1 of the throughput plan so a URL byte count stops deciding whether a correct scope loads.
- [ ] Report a measured before/after for `indexMs` once discovery sharding lands; 14.4 s against a 30 s budget is under 2x margin.

## References

- `backend/services/eng_board.py::paged_search_bytes`
- `backend/services/eng_board.py::iter_team_epic_batches`
- `backend/services/eng_board.py::split_epic_batches`, `::split_component_batches`
- `tests/test_eng_board_progressive_loading.py`
- [MRT027: Board scope interpretation and loading regressions](./MRT027-board-catalog-pagination.md)
- [ENG Board All work transport and throughput plan](../plans/EXEC-board-all-work-throughput.md)
