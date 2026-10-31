# TODO

## Config / Admin Follow-ups
- Access model: config tabs/settings admin-only; group config remains editable for non-admin users

## Multi-user / SSO
- Jira user OAuth (3LO) or explicit admin-service-account fallback policy

## Backlog Candidates

RICE = (Reach x Impact x Confidence) / Effort
- Reach: % of user sessions affected (1-10)
- Impact: 3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal
- Confidence: 100%, 80%, 50%
- Effort: person-weeks

| # | Item | Category | R | I | C | E (wks) | RICE |
|---|---|---|---|---|---|---|---|
| 12 | Centralize auth header construction | Backend | 2 | 0.5 | 100% | 0.25 | **4.0** |
| 14 | API integration tests | Backend | 3 | 2 | 80% | 2 | **2.4** |
| 19 | Accessibility fixes | Frontend | 4 | 1 | 80% | 2 | **1.6** |
| 20 | Extract service layer (backend) | Backend | 3 | 2 | 80% | 3 | **1.6** |
| 22 | JQL builder (replace regex) | Backend | 5 | 1 | 50% | 2 | **1.25** |
| 25 | Frontend tests | Frontend | 3 | 2 | 50% | 3 | **1.0** |

- Compact sticky header at 390px with two or more visible Department groups: the "Find in view" search field covers the "Catch Up" mode radio and blocks its click (found while building the two-group Playwright fixture for #267; the existing 390px sticky-heading test in `tests/ui/planning_review_integration.spec.js` stays on the one-group fixture until fixed). Needs a product fix with geometry checks on every sibling control of that header.

## Deferred
- Assignee capacity Undo (#323): Cmd/Ctrl+Z works after Enter only once focus returns to the table (Tab keeps it there); keyboard-only, parked per the a11y deprioritization.
- Catch Up cold load speed follow-ups (from the 2026-10-25 production HAR; [EXEC plan](plans/EXEC-catch-up-cold-load-speed.md) implemented compression, concurrent dependency and readiness batches, lazy admin settings and the early config prefetch; what it left, "Not done here" first, then what execution found; line numbers verified at `0837dbf5`):
  - The 250-issue lane cap and the fact that the task list can drop issues beyond it: `fetch_tasks` in `jira_server.py` sets `max_results = 250` (`:3382`, loop at `:3396`) and a code comment at `:3515` names "the 250-capped task list"; plan decision 6 left it out of scope. A separate design on the performance-critical initial-load path.
  - Continuation-token handling for the other `fetch_issues_by_keys` callers (`/api/issues/lookup`, epic record fetches); only `/api/dependencies` is strict.
  - Unbounded key count on `/api/dependencies`: the client sends one key per Story of both lanes, so worst-case Jira calls are `ceil(N/100) + ceil(M/100)` plus continuation pages; a hard cap would change the contract.
  - Cache successful key batches individually so a Retry redoes only the missing work.
  - Honor `Retry-After` in the shared retry loop (`backend/jira_client.py`); it affects every caller.
  - Run sprint validation and the `/rest/api/3/field` call concurrently with discovery in `_story_readiness_compute` (`backend/routes/eng_routes.py`).
  - `immutable` or long-cache hashed bundle names: the entry `dashboard.js` is not content-hashed and dist is served `no-cache` (`serve_frontend_dist` in `jira_server.py`); also brotli and preloading the static chunks.
  - A page-start-to-list metric with a `startOffsetMs` (the first-lane clock starts at the data requests, so the weekly charts cannot show the compression or early-prefetch gain).
  - The alerts fetch duplicating the lane payloads.
  - Per-Epic refresh paths merge `/api/dependencies` answers without checking `incomplete`: `refreshEpicDependencies` in `frontend/src/dashboard.jsx` (`:3800`) and `frontend/src/dashboardFreshnessAdapters.js` (`:137-140`).
  - Concurrent batch runs keep paging in-flight batches after a failure, and a readiness 429 never starts the process-wide cooldown: `_story_readiness_search` in `backend/routes/eng_routes.py` passes `cancel_check=transport.budget.check` (the request budget, not the run's stop flag) and a non-200 raises `RuntimeError('jira_unavailable')` with no `rate_limited`, while `_Run._fail` in `backend/services/jira_batches.py` starts the cooldown only on `rate_limited is True`. Fix: a local stop `Event` combined with the budget check in the two read tasks.
  - EPM and ENG share one `dependencyIncomplete` cell (`frontend/src/dashboard.jsx:956`, set in `fetchDependencies` at `:3778-3792`): a stale `true` from an EPM answer can show on a first ENG visit between the first lane arrival and ENG's own dependencies fetch. Fix: reset on view change, outside the byte-pinned dependencies effect.
  - An early-read network error falls back to a normal request without re-checking the pending auth lock, and a fallback 401 is stamped with the early start time: `performApiFetch` in `frontend/src/api/http.js`; the guard line `response = (early ? await early.promise : null) || await fetch(url, options);` is pinned in `tests/test_frontend_api_source_guards.js` (`assertBoundaryFetches`), so the fix edits that pin and rebuilds dist.
  - The native-fetch source guard (`nativeFetchViolations` in `tests/test_frontend_api_source_guards.js`) matches `fetch(` literally, so `fetch (` or `window.fetch (` escapes in any file other than the two owners (pre-existing).
  - The `Vary` merge in `backend/response_compression.py` (`_merge_vary`) appends `Accept-Encoding` to the first `Vary` line only; Flask's session save (`vary.add('Cookie')`) can drop later `Vary` lines when a handler sets its own `Vary` (pre-existing; none do today).
  - The lazy Admin loading and retry notices render flush-left with the shared `.stats-note` look (`adminSettingsLoadingFallback` in `frontend/src/dashboard.jsx:204`); an inset for the Settings, Admin and Retry notices together is the requester's call.
  - Two test hardenings in `tests/ui/codebase_structure_smoke.spec.js`: assert `staticDistClosure('dashboard.js').size` is greater than 1 near the G3c parser (`:6299`), and use `expect.poll` for the request-event race near `:6318`.
  - Commit `14ef0a13` says each reset was mutation-checked, but the `clearEngGroupScopeData` reset has no covering test (it sits on the configuration-refresh path; mutation evidence in the plan's Task 2a-ii divergences). Reword if history is rewritten before push, or add the test.
  - Strict key batches treat any 4xx as `incomplete` (`backend/jira_client.py`, the strict path): verify in a real scope that links an archived or removed issue that `key in (...)` does not answer 400 for a key the caller cannot resolve (a read-only probe on 2026-10-26 with a credential that sees no projects got 200 with no issues for unknown keys and an unknown project key; an unknown issue in a visible project was not tested); if it does, retry the batch without the named keys or treat a round-two 400 as non-fatal.
  - Budget the strict key pages with `eng_board.paged_search_bytes` (MRT031): `KEY_BATCH_SIZE = 100` continuation requests compute to 4.0 to 6.0 KB for keys of up to 10 letters and 6 digits against the 7,000-byte ceiling, so they fit today; give the fake Jira in `tests/test_dependencies_concurrency.py` a realistic 1.5x token.
  - Mount an `HTTPAdapter` sized to the real concurrency (at least about 20 connections per host) on `HTTP_SESSION` in `jira_server.py`, or measure G6 through the real session: urllib3's default of 10 can be exceeded by about 8 request threads, 4 readiness computes and 6 helpers, and the G6 fake Jira bypasses it.
  - Round two of `collect_dependencies` fetches every `issuelinks` entry of every link type ("relates to" and "clones" included), not only block and depend links; limiting it narrows both the cost and the surface of the strict 4xx rule above.
  - A gzip 304 keeps `Accept-Ranges` (`backend/response_compression.py`); harmless, since Werkzeug strips `Content-Length` and `Content-Encoding` from a 304.
- Performance report `trend` and the samples' `recordedAt` still bucket by the database session's date, so they are off by the session offset when it is not UTC; only `_week_start` is normalised.
- Performance Cache filter options come from the `cache_state` column, which is NULL for Catch Up rows, so the filter lists Board values only.
- Extract a shared weekly chart frame from `PerformanceBoardWeeks` and `PerformanceCatchUpWeeks` (they duplicate the axis, legend and readout code on purpose, to leave the Board file and its registered digest alone).
- Design-system Part 2 global hover foundation is implemented locally; acceptance remains open in [EXEC plan](plans/EXEC-design-system-part-2.md). Part 3 surface migration is implemented locally in its [EXEC plan](plans/EXEC-design-system-part-3.md); the original integrated verification passed; current hover-refinement evidence and the resolved WebKit search-clear test race are recorded there. Acceptance remains open. See [design](plans/SUPPORT-design-system-hover-contract-design.md).
- Design-system spec #3: shared Button, font-size/radius/spacing scales and JSX inline-style migration; separate follow-up. Keyboard-only focus behavior, keyframe deduplication and entrance animations remain deferred; touch actions stay required.
- Existing semantic-palette contrast debt: blue status fills, amber metadata, orange Missing pills, gold glyphs, expanded Add status and muted chart details retain recorded palettes. Planning List excluded Epics retain ancestor opacity 0.55 (painted text 2.27231:1, ring 2.06316:1), proven identical to the starting tree. Correct palette/dimming in separate scope; general new ordinary-button text/rings and icon glyphs keep strict measured contrast checks. See [design-system map](design-system.md).
- ENG hidden Initiative-grouping tooltip horizontal overflow — pre-existing on `main` at 755–1023 px (about 26 px); deferred under the user-approved #251 baseline exception on 2026-10-12. Freshness may add zero overflow, and the header regression isolates this tooltip while retaining absolute no-overflow checks elsewhere. Fix tooltip containment separately; preserve its visible hover/focus readout and shared filter controls. See `docs/plans/EXEC-dashboard-data-freshness-251.md`.
- Export improvements (CSV/PDF) — defer until core planning workflows are stable.
- Scenario planner `Publish to Jira` (write start/end dates back to Jira) — parked until draft/history/rollback flow is stable.
- Planning review table keyboard access — won't do for now (user decision 2026-10-02: keyboard users are not a priority; touch is). While the header is docked, the live header is a clone appended to the end of `<body>` and the real header is `aria-hidden`, so sort/move controls come after every row's controls in Tab order and focus can land on an invisible control or drop to `body`; the scroller's `tabIndex=0` makes the page jump on Tab; pinned chrome covers the focused control (no `scroll-padding`); no `aria-sort`; action lists use `role="dialog"` instead of `role="menu"`. Fix sketch: mount the clone just before `.planning-review-scroll`, make the real header `inert` while docked, drop the scroller's `tabIndex`, refocus the same column control after a dock flip, set `scroll-padding` from the dock measurement. Related: item 19 (Accessibility fixes) and `EXEC-planning-review-table-chrome-217.md`.
- Shareable view links v2 candidates (parked from issue #194): a Board Epic panel link (needs a Share action inside the modal panel and a request consumed after the Board columns contain the key), Board facets and Statistics display options in links, stored or short links with revocation and expiry (`docs/plans/FUTURE-db-additional-features.md`).
- Share control and pending-link keyboard polish — won't do for now (keyboard users are not a priority; touch is). The Share notice does not close on Escape, focus does not return to the Share control after Dismiss, and the fallback link field takes focus when it opens. Escape already cancels a pending link (the interaction guard ignores modifier and lock keys). Related: `frontend/src/shareView/ShareViewButton.jsx`, `frontend/src/shareView/interactionGuard.js`, `docs/plans/EXEC-shareable-view-links-194.md`.
