# ENG Board All Work Transport And Throughput Plan

> **Status:** Proposed. The blocking `scope_too_large` defect is fixed separately on `bugfix/board-progressive-loading`; this plan covers the structural transport, throughput, and caching work that defect exposed.

## Outcome required

`GET /api/eng/board?scope=all_work` must complete for a real department without the encoded-URL ceiling deciding whether it succeeds, and it must finish with enough margin below the 30-second request budget that a slower Jira day does not turn a correct result into `deadline_exceeded`.

## Measured baseline

Read-only replay of the strict index and hydration paths against live Jira, for the reported department (three Jira projects, eight teams, two Board components), taken after the `scope_too_large` fix and before any work in this plan:

| Phase | Jira pages | Rows | Wall time | Worst encoded request |
| --- | --- | --- | --- | --- |
| Component Epic index | 2 | 160 Epics | 0.8 s | 1,178 B |
| Team discovery + parent lookup | 23 | 194 Epics (union) | 7.1 s | 1,428 B |
| Child hydration (concurrency 2) | 20 | 1,821 Stories | ~7 s | 4,133 B |
| Whole stream (`_frame_stream`) | 48 | 194 / 1,821 | **14.4 s** | 4,133 B |

Terminal frame: `outcome=success`, `completeness=complete`, `indexMs=7395.9`, `focusedCompleteMs=13409.8`, `durationMs=14380.6`, `peakChildSearches=2`, `cacheState=miss`.

Three facts constrain every option below.

1. **Jira's `nextPageToken` scales with the JQL.** Measured 1.35x–1.5x of the query length across five query shapes (373→544, 400→596, 1,410→~1,960, 4,290→5,784, 6,116→8,220 characters). A GET-paged search therefore costs roughly twice its first-page encoded size, which is why `MAX_ENCODED_REQUEST_BYTES = 7000` is a much tighter budget than it appears.
2. **Page size is not a lever.** `/rest/api/3/search/jql` returned exactly 100 rows for `maxResults` of 100, 500, 1,000, and 5,000, for both the two-field discovery scan and the full child projection. 100 rows per round trip is a hard ceiling.
3. **There is no server-side Board cache.** `cacheState` is a literal `'miss'` in [`_diagnostics`](../../backend/routes/eng_board_routes.py). Every Board request re-reads the department from Jira.

## Slice 1 — POST search transport

GET forces `MAX_ENCODED_REQUEST_BYTES`, and that single constant is what dictates `MAX_BATCH_SIZE = 40`, the Component batch splitter, the Epic key batch splitter, and the `paged_search_bytes` token estimate. Every one of those is a workaround for a URL length limit that POST does not have.

Verified against the live tenant: a 6,116-character JQL whose continuation token came back at 8,220 characters succeeded over `POST /rest/api/3/search/jql` and is unsendable over GET (8,609 encoded bytes against a 7,000-byte cap).

Work:

- Add a POST path to [`backend/jira_client.py`](../../backend/jira_client.py) alongside `build_jira_search_params`, and route `current_jira_search` through it. Keep the GET path for callers that depend on it until each is migrated.
- Move the strict Board pager (`iter_strict_search_pages`) onto the POST path and drop the per-request `url_bytes` check for those searches.
- Keep `MAX_BATCH_SIZE`, `MAX_EPICS`, `MAX_CHILDREN`, `MAX_PAGES_PER_SEARCH`, and `MAX_PAGES_PER_GENERATION` as explicit fan-out ceilings. Removing the URL limit must not remove the scope ceilings; it must stop them being expressed as a byte count.
- Confirm the Jira performance observer in `backend/jira_client.py` still attributes search timings when the method changes (it currently keys on `'/rest/api/3/search/jql' in url`).

Acceptance: a strict search whose JQL exceeds 7,000 encoded bytes pages to completion through the real pager; the GET-era byte errors (`limit='url_bytes'`) are unreachable for Board searches; existing batch-splitter tests are retargeted at fan-out, not bytes.

## Slice 2 — Shard the discovery scan and widen child concurrency

The team-discovery scan is one sequential cursor: 15 pages at ~300 ms each. It cannot be parallelised as a single cursor, but it shards cleanly by team.

Measured, eight parallel per-team scans over the same department: **19 pages, 1,479 rows, 1.3 s wall**, against 15 pages and 4.6 s sequential — more requests, 3.5x less wall time.

Work:

- Shard `iter_team_epic_batches` discovery by team id and run the shards through the existing bounded worker pool, sharing `PagerCounters`, the deadline, and `cancel_check` exactly as the child scheduler does.
- Keep the union and the `MAX_CHILDREN` scan ceiling global across shards so the scope ceiling is unchanged.
- Revisit `ENG_BOARD_MAX_CHILD_SEARCHES`, currently asserted to be exactly two in [`eng_board_stream.py`](../../backend/services/eng_board_stream.py). Five child batches at concurrency 2 is the second-largest cost in the trace. Any increase must be justified against Jira rate limits and stated as a measured before/after, not assumed.

Acceptance: `indexMs` for the same department drops materially from the 7,395.9 ms baseline with an identical Epic union; `durationMs` and the per-phase numbers are reported before and after from the same replay.

## Slice 3 — Decide the caching contract

`cacheState` is a hardcoded `'miss'`, so the diagnostics field currently describes an intention rather than a behaviour. `all_work` is the one scope that re-reads the whole department, and `refresh=1` on the reported request had nothing to invalidate.

This slice is a decision before it is an implementation. Resolve, with the user:

- Whether a Board result is cached server-side at all, and if so keyed by what — the existing `scopeCohortDigest` is already a closed, credential-free identity for exactly this purpose.
- What invalidates it (TTL, `refresh=1`, scope rotation, config revision bump).
- Whether the index and the children cache independently, since the index is the slower half to rebuild and the more stable half.

Do not implement a cache before that contract is written down here. Until then, make `cacheState` report the truth rather than a constant.

## Scope and forbidden changes

Allowed: `backend/jira_client.py`, `backend/services/eng_board.py`, `backend/services/eng_board_stream.py`, `backend/routes/eng_board_routes.py`, the matching `tests/test_eng_board_*` files, `docs/ontology.md`, and this plan with its index entry.

Do not change the Board scope grammar, the candidate/authoritative membership contract, the frame protocol or its version, auth or workspace ownership, or the Sprint/Component scope semantics. Do not raise `MAX_EPICS` or `MAX_CHILDREN` as part of this work — those are scope ceilings, not performance knobs. No Jira writes.

## Verification

- Red/green unit coverage per slice, as with the `scope_too_large` regression.
- A read-only live replay of `_frame_stream` for the reported department before and after each slice, reporting the full diagnostics block. Local suites alone cannot establish throughput.
- Full Python suite and the frontend unit suite before push, per the root instructions.
- No user-visible interaction or event changes, so no analytics taxonomy change is expected; restate that explicitly if a slice adds a control.

## Risks

- Sharded discovery multiplies concurrent Jira requests per browser request. Rate-limit headroom must be measured, not assumed.
- POST transport changes the request shape every Board read depends on; migrate the strict pager first and leave other callers on GET until each is covered.
- 14.4 s against a 30 s budget leaves under 2x margin today. Any slice that regresses wall time has to be reverted, not tuned.
