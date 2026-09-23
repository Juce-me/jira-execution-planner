# Persistent Sprint And Per-Sprint Team Catalogs Runtime Repair Plan

> **Status:** Planned. This is a repair and verification plan for the implementation on `bugfix/board-progressive-loading`; it does not claim that the feature is working or accepted.

## Outcome required

Make the first authenticated catalog request usable in the production bundle, then prove the cold-load → cached-load → per-Sprint Team refresh flow against the local PostgreSQL/OAuth stack and real read-only Jira data before reporting the implementation as fixed.

The release-blocking symptom is reproducible from the supplied browser evidence:

```text
GET /api/sprints?t=<timestamp> 400
```

The DB route rejects that request before auth, PostgreSQL, or Jira work. [`frontend/src/api/engApi.js`](../frontend/src/api/engApi.js) still adds `t` to `fetchSprints`, while [`backend/routes/settings_routes.py`](../backend/routes/settings_routes.py) allows only `refresh`, `completionAttemptId`, and `catalogIdentity`. The same mismatch exists for Team refresh: [`frontend/src/api/jiraCatalogApi.js`](../frontend/src/api/jiraCatalogApi.js) adds `_t`, while [`backend/routes/eng_routes.py`](../backend/routes/eng_routes.py) rejects it in the DB branch.

Direct route probes on this checkout produced:

```text
GET /api/sprints?t=1790149010531  -> 400 {"error":"unsupported_catalog_parameter"}
GET /api/teams?sprint=42&all=true&_t=1790149010531 -> 400 {"error":"unsupported_catalog_parameter"}
```

The current environment is a separate blocker: no process is listening on ports `5050` or `5432`, and `scripts/check_startup_preflight.py` reports `FAIL migrations: Database is unavailable or migrations are not at head`.

## Scope and forbidden changes

Allowed implementation paths:

- `frontend/src/api/engApi.js`
- `frontend/src/api/jiraCatalogApi.js`
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and any generated CSS changed by the pinned build
- `tests/test_frontend_api_source_guards.js`
- `tests/test_persistent_catalog_routes.py`
- focused browser coverage under `tests/ui/` if the existing fixtures cannot assert the real request query
- this plan and the plan index/evidence only

Do not loosen the DB endpoint contract to accept arbitrary cache-busting parameters. Do not change workspace keys, migration schema, refresh leases, OAuth ownership, catalog publication semantics, or the Team directory POST behavior as part of this repair. `cache: 'no-cache'` and explicit `refresh=true` are the cache controls for these catalog wrappers.

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

Record the exact commands, counts, skips, warnings, request URLs, response status/cache metadata, Jira-call observations, and screenshots in this plan or the existing execution plan. Do not mark the existing `EXEC-persistent-sprint-team-catalogs.md` done based on its prior local test totals; those checks did not exercise the production query shape shown above, and the plan's authenticated Jira/latency gates remain open.

## Residual risks

- The current checkout cannot complete live acceptance until the local PostgreSQL runner is available and migrations are at head.
- A source-only fix is insufficient if the Flask-served generated bundle is not rebuilt or the browser is serving an older asset; production-bundle verification is mandatory.
- The screenshot’s CSP inline-script warning and third-party cookie warning are not the cause of the observed catalog `400`, but they should be recorded separately if they remain after the catalog request is fixed.
