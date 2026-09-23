# Persistent Sprint And Per-Sprint Team Catalogs Runtime Repair Plan

> **Status:** In progress. The source-contract repair and capped-page regression are locally verified on `bugfix/board-progressive-loading`; authenticated live acceptance remains open.

## Outcome required

Make the first authenticated catalog request usable in the production bundle, then prove the cold-load → cached-load → per-Sprint Team refresh flow against the local PostgreSQL/OAuth stack and real read-only Jira data before reporting the implementation as fixed.

The release-blocking symptom is reproducible from the supplied browser evidence:

```text
GET /api/sprints?t=<timestamp> 400
```

At the baseline, [`frontend/src/api/engApi.js`](../../frontend/src/api/engApi.js) added `t` to `fetchSprints`, while [`backend/routes/settings_routes.py`](../../backend/routes/settings_routes.py) allowed only `refresh`, `completionAttemptId`, and `catalogIdentity`. The same mismatch affected Team refresh: [`frontend/src/api/jiraCatalogApi.js`](../../frontend/src/api/jiraCatalogApi.js) added `_t`, while [`backend/routes/eng_routes.py`](../../backend/routes/eng_routes.py) rejected it in the DB branch. The Sprint route rejects unsupported parameters before auth; the Team DB branch validates them after auth context resolution. Both reject them before catalog or Jira work.

Direct route probes on this checkout produced:

```text
GET /api/sprints?t=1790149010531  -> 400 {"error":"unsupported_catalog_parameter"}
GET /api/teams?sprint=42&all=true&_t=1790149010531 -> 400 {"error":"unsupported_catalog_parameter"}
```

At the baseline investigation, no process was listening on ports `5050` or `5432`, and `scripts/check_startup_preflight.py` reported `FAIL migrations: Database is unavailable or migrations are not at head`. The supported local runner subsequently passed PostgreSQL health, migrations, preflight, and Flask startup, as recorded below.

## Scope and forbidden changes

Allowed implementation paths for the initial cache-buster repair:

- `frontend/src/api/engApi.js`
- `frontend/src/api/jiraCatalogApi.js`
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and any generated CSS changed by the pinned build
- `tests/test_frontend_api_source_guards.js`
- `tests/test_persistent_catalog_routes.py`
- focused browser coverage under `tests/ui/` if the existing fixtures cannot assert the real request query
- this plan and the plan index/evidence only

Do not loosen the DB endpoint contract to accept arbitrary cache-busting parameters. Do not change workspace keys, migration schema, refresh leases, OAuth ownership, catalog publication semantics, or the Team directory POST behavior as part of this repair. `cache: 'no-cache'` and explicit `refresh=true` are the cache controls for these catalog wrappers.

## Follow-up: Jira-capped Board page (2026-09-23)

After the request-parameter repair, an authenticated `/api/sprints` response still reported `502 sprint_catalog_unavailable` with `failureCode=catalog_incomplete` and no validated payload. The live response does not identify which strict check failed. A local production-route reproduction isolates one definite defect: the new Board fetcher rejected a successful Jira page whose response reported `maxResults: 50` after the client requested 100. [Atlassian's pagination contract](https://developer.atlassian.com/cloud/jira/software/rest/intro/) permits a resource to return fewer results than requested and to change that limit. The former `main` Board reader did not require response `maxResults` to equal the request.

The scoped repair keeps the DB/OAuth Board-only catalog and workspace authority. For this follow-up, allowed paths are `backend/services/sprints.py`, `tests/test_sprint_service.py`, `tests/test_persistent_catalog_routes.py`, this plan and its index, `docs/ontology.md`, `docs/postmortem/`, and the root learning in `AGENTS.md`. No issue/JQL fallback, browser behavior, schema, or refresh ownership changes are included. The existing analytics allowlist remains unchanged because this corrects a server read validator and introduces no new interaction or event.

Acceptance requires a red/green service test with capped `maxResults` across two pages, a red/green authenticated-route fixture that cold-fills a nonempty catalog and reuses it on the next read, and continued rejection of malformed/incomplete pages. Run the focused and full suites, obtain independent review, inspect the scoped diff, and build the committed revision before push. This is local contract evidence, not proof of the original live Jira page shape. Authenticated browser cold/cached/Team acceptance and the parent plan's two-user and latency gates remain open.

## Investigation and repair sequence

### 1. Establish the red feedback loop before changing code

Add or tighten tests so the current branch fails on the exact production request shape:

1. `fetchSprints` normal, forced, and completion calls must produce only the contract parameters. Assert that `t` is absent, `refresh=true` is present only for forced reads, and completion carries both identity fields without `refresh`.
2. `fetchAllTeams` normal, forced, and completion calls must produce only `sprint`, `all=true`, optional `refresh=true`, and the paired completion fields. Assert that `_t` is absent and the supplied `AbortSignal` remains attached.
3. Keep the backend negative contract test: DB `/api/sprints?t=…` and DB `/api/teams?…&_t=…` must remain sanitized `400 unsupported_catalog_parameter`. This proves the server still rejects ownership/cache overrides and catches accidental client/server contract relaxation.
4. Add one production-shaped browser or wrapper assertion that inspects `url.searchParams`, not only `url.pathname`. Existing UI mocks match only the pathname and therefore cannot catch this regression.

Run the new checks before the fix and record the failure. The current source-guard suite is green because it checks required completion fields but never asserts the complete allowed parameter set; the current Team wrapper test explicitly expects `_t`, which is incompatible with the DB endpoint.

### 2. Apply the minimum repair

Remove the legacy `t` construction from `fetchSprints` and `_t` construction from `fetchAllTeams`. Preserve:

- `cache: 'no-cache'`;
- the existing `refresh=true` force-read semantics;
- paired completion validation and the same `AbortSignal`;
- all non-DB compatibility behavior at the response/route level.

Rebuild with `npm run build`; do not hand-edit `frontend/dist`. Confirm the generated bundle no longer contains the catalog cache-buster while unrelated endpoint cache-busters remain unchanged.

### 3. Verify the focused contract and bundle

Run the failing wrapper tests again and require them to pass. Then run:

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_dashboard_runtime.js tests/test_team_catalog_lifecycle_source_guards.js
.venv/bin/python -m unittest tests.test_persistent_catalog_routes tests.test_sprint_service tests.test_sprint_team_service
npm run build
git diff --check
```

The green result is not sufficient until the built bundle is the one served by Flask. Inspect the generated request path or production bundle source map and verify:

- ordinary Sprint request: `/api/sprints`;
- forced Sprint request: `/api/sprints?refresh=true`;
- Sprint completion: only `completionAttemptId` and `catalogIdentity`;
- ordinary/forced Team request: `sprint`, `all=true`, optional `refresh=true`;
- Team completion: the paired completion fields and no force flag;
- no `t` or `_t` on either strict catalog route.

### 4. Restore the supported local runtime

Run the exact supported stack, not a hand-started Flask process with a different configuration:

```bash
./runners/local/run.sh
```

Before opening the browser, require the runner to apply migrations, pass startup preflight, and reach the Flask startup banner without unexpected pre-banner dependency/runtime warnings. If the runner cannot start, stop the acceptance run and report the concrete Docker/PostgreSQL/migration blocker; do not infer catalog behavior from mocked SQLite tests or an unauthenticated request.

After startup, verify the sanitized unauthenticated baseline, then sign in through `/login` and configure a real Board, projects, and Team field in Settings. Keep credentials and real Jira payloads out of committed files and notes.

### 5. Execute the cold/cached/Team-refresh acceptance path

With DevTools Network open, capture the request URL, status, response JSON shape, `Server-Timing`, and Jira request count for each phase:

1. Fresh tab: `/api/sprints` must not contain `t`; no ENG data may load until the server returns a validated Sprint catalog.
2. Select a real active Sprint and verify the catalog-selected ID is the requested ID.
3. Open Settings → Team Groups and run Refresh teams. `/api/teams?sprint=<id>&all=true` must not contain `_t`; DB mode must not issue `POST /api/team-catalog` during this refresh.
4. Reload and confirm the validated Sprint and Team choices persist.
5. Switch to a Sprint with a different Team set, then back; membership must follow the selected Sprint, not a global Team list or stale prior snapshot.
6. Keep the Sprint menu open while a main Jira refresh completes; the open menu must update in place.
7. Confirm UI errors are fixed copy only; no raw Jira, SQL, JQL, token, request URL, or internal exception text is rendered.

For ordinary cached reads, run the supplied console sampler for `/api/sprints` and `/api/teams?sprint=<id>&all=true`. Require ten total `200` responses, each under one second, `refreshStarted === false`, a stable non-empty `cache.identity`, stable non-empty `cache.catalogVersion`, non-empty `cache.validatedAt`, and `Server-Timing` on every response. Assert ordinary hits produce zero Jira calls.

### 6. Prove sharing and isolation before reporting success

Repeat the validated cached read and Team membership read with a second authenticated user in the same Jira workspace. Require the same catalog identity/version without a second initial discovery. Repeat with another configured workspace and require that its rows and identities remain isolated.

The implementation is not ready to report as fixed if any of the following remain true:

- any authenticated ordinary catalog request returns `400`, `401`, `502`, or `503` after prerequisites are satisfied;
- the served bundle still emits `t` or `_t` for the strict catalog routes;
- Team refresh emits a directory POST in DB mode;
- the Sprint selector remains stuck at Loading, uses a different Sprint, or requires closing/reopening to show completion;
- cached reads call Jira, exceed one second, lack `Server-Timing`, or change catalog version unexpectedly;
- the second-user/shared-workspace or cross-workspace checks are unverified;
- preflight, migration, or positive authenticated API evidence is missing.

## Verification record to update

### 2026-09-23 source-contract repair

- Pulled baseline: `7008bbebd70f6883eeb135b1a0b012f34bfedb06` on
  `bugfix/board-progressive-loading`.
- RED: `node --test tests/test_frontend_api_source_guards.js` failed the three
  new exact-query assertions because Sprint reads emitted `t` and Team reads
  emitted `_t`.
- GREEN: the requested focused Node command passed 93 tests under Node 20.20.0;
  the requested focused Python command passed 50 tests. The backend cases retain
  sanitized `400 unsupported_catalog_parameter` responses for manual `t` and
  `_t` queries. The full frontend unit suite passed 1,423 tests under Node
  20.20.0. The full Python suite passed 1,908 tests with 25 skips under a
  non-DB test-process profile. Its first run under local `.env` settings had one connection
  error because the command sandbox could not reach PostgreSQL on port `5432`.
- `npm run build` passed under Node 20.20.0. Inspection of the generated
  dashboard bundle confirmed that ordinary Sprint reads have no query, forced
  Sprint reads add only
  `refresh=true`, and Team reads begin with `sprint` plus `all=true`; unrelated
  endpoints retain their existing cache-busters.
- The supported local runner started PostgreSQL, applied migrations to head,
  passed startup preflight, and reached the Flask startup banner without an
  unexpected pre-banner warning. Positive authenticated HTTP/browser acceptance
  remains open: no authenticated browser was available, and the runner's host
  network was not reachable from the command sandbox used for follow-up curls.
- Two-user same-workspace reuse, cross-workspace isolation, five-sample cached
  latency/metadata checks, zero-Jira-call observation, Sprint switching, Team
  refresh behavior, persistence, and open-menu completion remain unverified.
  Do not mark the parent plan done from this source repair.

Record the exact commands, counts, skips, warnings, request URLs, response status/cache metadata, Jira-call observations, and screenshots in this plan or the existing execution plan. Do not mark the existing `EXEC-persistent-sprint-team-catalogs.md` done based on its prior local test totals; those checks did not exercise the production query shape shown above, and the plan's authenticated Jira/latency gates remain open.

### 2026-09-23 capped-page local verification

- RED: `.venv/bin/python -m unittest tests.test_sprint_service.TestSprintService.test_db_board_accepts_jira_capped_page_size tests.test_persistent_catalog_routes.PersistentCatalogRouteTests.test_capped_board_page_cold_fills_and_caches_sprints -q` produced one `catalog_incomplete` service error and one route `502` instead of `200`.
- GREEN: `.venv/bin/python -m unittest tests.test_sprint_service tests.test_persistent_catalog_routes -q` passed 45 tests. The two-page service fixture confirmed `startAt` advances by received rows while the request still asks for 100; the route fixture cold-filled a nonempty catalog from a response capped at 50, then reused its version with one total Jira call. Invalid zero/negative/boolean limits remain rejected.
- Full backend: `env DATABASE_URL= TEST_DATABASE_URL= CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests -q` passed 1,910 tests with 25 skips. The suite emitted expected mocked error logs and existing resource warnings; there were no test failures.
- Full frontend: `npm run test:frontend:unit` passed 1,423 tests with no skips or failures under the default Node 22 shell; a pinned Node 20.20.0 `node --test tests/test_*.js` rerun also passed 1,423 with no skips or failures. The first run emitted existing typeless-package warnings.
- Independent contract and regression reviewers found no actionable scoped defect. One independently reran both new tests against the pre-fix fetcher in memory and reproduced the service error and route `502`, then confirmed current focused tests pass. Both reviewers kept live attribution and authenticated browser acceptance open.
- No frontend source or generated bundle changed in this follow-up. The server read validator and route fixture are the exercised path. The actual authenticated Jira page, browser cold load, two-user reuse, and latency observations remain unverified here.

## Residual risks

- The supported local PostgreSQL runner reached migrations at head and Flask startup. Authenticated browser access and follow-up HTTP access from this command sandbox remain unavailable, so live acceptance is still open.
- A source-only fix is insufficient if the Flask-served generated bundle is not rebuilt or the browser is serving an older asset; production-bundle verification is mandatory.
- The screenshot’s CSP inline-script warning and third-party cookie warning are not the cause of the observed catalog `400`, but they should be recorded separately if they remain after the catalog request is fixed.
