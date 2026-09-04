# EXEC — ENG Board optional-sprint measurement spike

> **Status:** Ready to execute. This plan produces measurement evidence only. It must not add a
> production Board endpoint, change ENG loading behavior, or wire new frontend product behavior.

| Field | Value |
| --- | --- |
| Date | 2026-09-03 |
| Issue | [#137 — make sprint on the Board view optional](https://github.com/Juce-me/jira-execution-planner/issues/137) |
| Input design | [`SUPPORT-eng-board-optional-sprint-design.md`](SUPPORT-eng-board-optional-sprint-design.md) |
| Component source | Existing shared `groups[].missingInfoComponents` |
| Jira writes | None |
| Production wiring | Forbidden |
| Required live gate | Local OAuth server and a real signed-in user session |

## 1. Outcome and completion boundary

Build a local-only diagnostic harness that measures the strict, complete query shape proposed for
ENG Board against representative Component-backed and Team-fallback Departments plus one selected
sprint. Capture five matched rounds of:

1. current selected-sprint Board source using the real Product and Tech
   `/api/tasks-with-team-name` calls;
2. strict Component-scoped selected-sprint index plus complete direct-child hydration;
3. strict Component-scoped **All work** index plus complete direct-child hydration; and
4. strict no-Component, all-saved-Department-Teams selected-sprint discovery and hydration.

Each profile records a cold request followed immediately by an identical warm-cache request. The
harness returns and saves aggregate metrics only. New diagnostic code must never log or save Jira
issues, keys, summaries, names, Components, projects, Department/group ids, sprint ids/names, status
names, JQL, URLs, credentials, upstream bodies, or raw error text. The real legacy baseline retains
its pre-existing local sprint logging; treat the local server console as sensitive, do not capture or
commit it, and do not expand that logging.

Completion means:

- service, route-security, cache, pagination, redaction, and source-isolation tests pass;
- one valid sanitized campaign file exists outside the repository, with five complete rounds or the
  exact empty stopped envelope; `sample_deadline` classifies that envelope as `FAIL`, while every
  other allowlisted stop code classifies it as `STOP`;
- the checker reports exactly `PASS`, `FAIL`, or `STOP` using the gates below; and
- execution stops for review without starting production Board work.

## 2. Non-goals and forbidden changes

- Do not edit `backend/routes/eng_routes.py`, `frontend/src/`, or `frontend/dist/`.
  `jira_server.py` and the shared Jira/OAuth adapter files may change only for the optional absolute
  deadline plumbing named in §4; calls that omit the new argument must remain behavior-identical.
- Do not add a production Board endpoint, shared/private configuration field, persisted measurement
  cache, committed result file, analytics event, SSE stream, or production transport.
- Do not make Jira mutations or call Home/Townsquare, service credentials, Basic-auth fallbacks, or
  local OAuth token-store helpers. The spike requires a strict DB-backed OAuth browser context.
- Do not claim the product's 100 ms loading-feedback gate is verified; this spike has no product UI.
- Do not use `/api/tasks-with-team-name` without Sprint as candidate evidence. Its cap can make an
  incomplete response appear fast.
- Do not use `jira_client.fetch_issues_by_jql`, `jira_client.fetch_issues_by_keys`,
  `jira_server.fetch_epic_details_bulk`, or another helper that returns collected partial rows after
  a page/batch failure.
- Do not select the production cross-worker transport during implementation. The spike measures one
  service invocation that owns its complete counters and internal concurrency.

## 3. Existing seams to reuse

- `backend/routes/dev_routes.py` — extend the existing local diagnostics blueprint.
- `backend/security/policy.py` and `backend/security/guards.py::_require_dev_local` — use the exact
  local-environment/loopback guard and add a composed `dev_local_preview` unsafe-method class for the
  sample POST.
- `backend/routes/auth_routes.py` Home probe — follow its additional real-OAuth-session and redacted
  diagnostic response pattern without calling Home.
- `backend/auth/context.py::RequestAuthContext`, `jira_server.py::current_jira_get`, and
  `jira_server.py::current_jira_search` — capture context once and pass it explicitly to injected
  catalog/search adapters. Use `backend/jira_client.py::build_jira_search_params` only for
  search-parameter validation/construction.
- `backend/services/capacity.py::_search_capacity_issue_pages` — useful strict-token pattern only;
  do not inherit the caller behavior that continues after a failed chunk.
- `jira_server.py::load_dashboard_config_snapshot` — call it once in request context, then derive
  selected projects, configured issue types, and field ids directly from that captured payload.
  Do not call config-reading field/project getters because they can re-read or hide storage errors.
- `backend/config/repository.py::db_repository` and
  `backend/services/shared_group_config.py::require_existing_shared_groups_snapshot` — use uncached,
  read-only repository reads for the post-work revision/digest check; never invoke a compatibility
  loader that can create configuration rows.
- `scripts/check_home_graphql_oauth.py` and `scripts/check_design_assets_sanitized.py` — follow the
  closed-schema result checker and local-value redaction patterns.
- `tests/test_endpoint_policy_inventory.py` and `tests/test_endpoint_security_matrix.py` — every new
  route must have one exact security policy and sample.

## 4. Exact allowed file map

| File | Action | Purpose |
| --- | --- | --- |
| `docs/plans/EXEC-eng-board-optional-sprint-measurement-spike.md` | Modify only to record sanitized Outcome | This executable contract |
| `docs/plans/README.md` | Modify | Keep status/index aligned |
| `docs/plans/SUPPORT-eng-board-optional-sprint-design.md` | Modify only if measured facts invalidate it | Preserve design alignment |
| `docs/plans/GATE-05-home-write-capability.md` | Modify during execution | Refresh only `Checked on`/`Last result`; retain Blocked absent its documented PASS |
| `backend/services/eng_board_measurement.py` | Create | Pure strict query, pagination, timing, cache, ceiling, and sanitizer engine; no Flask imports |
| `backend/routes/dev_routes.py` | Modify | Add local runner/sample adapter and capture current-user OAuth context |
| `jira_server.py` | Modify | Add optional absolute-deadline passthrough to `current_jira_get`/`current_jira_search`; no default-path behavior change |
| `backend/jira_client.py` | Modify | Recompute absolute-deadline remainder across every Jira retry attempt and sleep |
| `backend/auth/jira_auth.py` | Modify | Bound OAuth token refresh to the same optional absolute deadline |
| `backend/auth/db_tokens.py` | Modify | Propagate the optional deadline through DB token materialization/refresh |
| `backend/security/policy.py` | Modify | Add exact method-specific `dev_local` GET and `dev_local_preview` POST policies |
| `backend/security/guards.py` | Modify | Add composed local + OAuth + requested-with + token-CSRF enforcement for the sample POST |
| `backend/services/shared_group_config.py` | Modify | Add a read-only helper that requires an existing shared-group row without fallback persistence |
| `scripts/eng_board_measurement_runner.html` | Create | Same-origin local five-round runner and sanitized download |
| `scripts/check_eng_board_measurement.py` | Create | Validate, summarize, redact-check, and classify the saved campaign |
| `tests/test_eng_board_measurement.py` | Create | Pure engine, route, cache, pager, sanitizer, runner/checker, and source-isolation coverage |
| `tests/ui/eng_board_measurement_runner.spec.js` | Create | Execute fixed order, cache handling, stop paths, and sanitized download in a browser |
| `tests/test_endpoint_security_matrix.py` | Modify | Add exact GET `dev_local` and POST `dev_local_preview` diagnostic samples |
| `tests/test_db_oauth_cutover.py` | Modify | Prove DB `RequestAuthContext` use and no local token-store fallback |
| `tests/test_shared_group_config_db.py` | Modify | Prove the existing-row helper is read-only and distinguishes missing from saved-empty state |
| `tests/test_jira_resilience.py` | Modify | Prove retries, request timeout tuples, and sleeps cannot cross the absolute deadline |
| `tests/test_jira_auth.py` | Modify | Prove OAuth refresh timeout is capped by the absolute deadline and defaults are unchanged |
| `tests/test_oauth_jira_client.py` | Modify | Prove deadline and downstream `AuthError` propagation through the real current-user wrapper |

`tests/test_endpoint_policy_inventory.py` is verification-only: its generic inventory should pass
without editing it. `tests/endpoint_security_samples.py` remains unchanged because the route path is
static. Any needed file outside this map is a stop condition requiring plan amendment and approval.

## 5. Diagnostic endpoint contract

Add one exact path with separate method policies:

`GET /api/dev/eng-board-measurement`

| Form | Method/policy | Input | Success |
| --- | --- | --- | --- |
| Runner | `GET`, exact `dev_local` | None | Serve only `scripts/eng_board_measurement_runner.html` from its exact repository path; after auth it loads Department and sprint choices through existing same-origin read APIs |
| Candidate sample | `POST`, exact `dev_local_preview` | JSON `{profile, groupId, sprintId?, refresh, campaignAction}`; `profile=candidate_selected_sprint|candidate_all_work|candidate_team_fallback_selected_sprint`; `campaignAction=begin|continue|end` | Closed-schema sanitized aggregate metrics and allowlisted `Server-Timing` |

Security and ownership requirements:

- GET is exact `dev_local`. POST is exact `dev_local_preview`: first require the same local/dev,
  loopback, and `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` gates, then strict DB-backed Atlassian OAuth,
  a real browser session, `X-Requested-With: jira-execution-planner`, and token-bound CSRF.
- In `register_security_guards`, handle `dev_local_preview` immediately after `dev_local` and before
  generic Basic/local handling: call `_require_dev_local`, return fixed `db_oauth_required` unless
  both DB storage and Atlassian OAuth are active, resolve only strict DB browser-session context, then
  enforce requested-with and token-bound CSRF. Add the class to protected/CSRF inventories but exclude
  it from general production `oauth_ready_api_paths()`/`is_oauth_ready_api_path()` reporting.
- The guard-resolved strict DB context is provisional. Within the sample deadline and campaign lock,
  materialize/refresh its DB OAuth token first, then resolve the final `RequestAuthContext` once.
  Build every immutable snapshot, campaign identity, and cache key from that post-refresh context and
  pass it to all Jira adapters; never publish an entry under the provisional token version. Reject
  local/pre-DB OAuth.
- Resolve `groupId` only inside the authenticated workspace's shared group snapshot.
- Use only saved `missingInfoComponents`, Board columns, retention, and revision from that group.
- Resolve project keys, issue types, and field ids from server-owned configuration.
- GET rejects query parameters and POST rejects unknown JSON fields. The browser cannot submit Components, project keys, issue types,
  statuses, retention, Epic keys, raw JQL, user/workspace ids, or credentials.
- `campaignAction=begin` is allowed only on the first candidate cold sample and resets any stale
  service-private digest state for that browser session/config signature. `end` is allowed only on
  the final candidate warm sample and destroys it after producing the response. Every other candidate
  sample uses `continue`; invalid sequencing returns `400 invalid_measurement_scope`.
- Only injected `current_jira_get(..., context=context)` for the issue-type and field catalogs and
  `current_jira_search(..., context=context)` for searches may call Jira.
- Route-owned measurement errors are the closed set `not_found`, `db_oauth_required`,
  `csrf_required`, `invalid_measurement_scope`, `measurement_sprint_required`,
  `measurement_group_not_found`, `measurement_components_required`,
  `measurement_team_scope_required`, `measurement_board_invalid`,
  `measurement_project_scope_required`, `measurement_field_config_invalid`,
  `measurement_config_changed`, `measurement_scope_too_large`,
  `measurement_deadline_exceeded`, `measurement_jira_failed`, and
  `config_storage_unavailable`. Existing strict DB-auth guards or a downstream Jira adapter may
  instead raise/return `auth_required`, `account_disabled`, `auth_connection_revoked`, or
  `auth_connection_stale`; the route uses the existing sanitized auth responder and preserves the
  established status, body, recovery fields, and URLs. A guard failure never invokes service work.
  A service-time auth failure discards accumulated rows and publishes no diagnostic cache or campaign
  state before returning the same sanitized response. Any other downstream `AuthError` becomes fixed
  `measurement_jira_failed`, never raw exception text.
- Never echo raw Jira error text, identifiers, JQL, configuration values, or URLs.

The GET route performs no work and needs neither CSRF nor `X-Requested-With`. POST is a logical read
but an unsafe HTTP method, so the composed guard is mandatory. `refresh=true` only
bypasses/replaces the exact diagnostic cache entry after the replacement succeeds.

| Failure | Status/body |
| --- | --- |
| Dev flag/environment/loopback gate fails | `404 {"error":"not_found"}` |
| Wrong auth mode or local/pre-DB OAuth | `409 {"error":"db_oauth_required","message":"This diagnostic requires the local DB-backed OAuth runtime."}` |
| Missing/expired browser OAuth | Existing sanitized `401 auth_required` recovery payload |
| Disabled account | Existing sanitized `401 account_disabled` recovery payload |
| Revoked Atlassian connection | Existing sanitized `401 auth_connection_revoked` recovery payload |
| Stale Atlassian connection | Existing sanitized `401 auth_connection_stale` recovery payload |
| Missing requested-with or token CSRF | Existing sanitized `403 csrf_required` payload |
| Invalid JSON, unknown key, invalid profile/action/sequence | `400 {"error":"invalid_measurement_scope","message":"The measurement request is invalid."}` |
| Selected-sprint profile lacks a valid numeric sprint id | `400 {"error":"measurement_sprint_required","message":"Choose one sprint for this measurement."}` |
| Group not in current workspace | `404 {"error":"measurement_group_not_found","message":"The selected Department is unavailable."}` |
| Component profile has no configured Components | `409 {"error":"measurement_components_required","message":"Choose a Department with configured Components."}` |
| Team fallback has Components or no saved Teams | `409 {"error":"measurement_team_scope_required","message":"Choose a Department with no Components and at least one saved Team."}` |
| Saved Board is absent or invalid | `409 {"error":"measurement_board_invalid","message":"Save a valid Department Board before measuring it."}` |
| Selected Jira projects are empty or include a non-Product/Tech type | `409 {"error":"measurement_project_scope_required","message":"Use only configured Product or Tech Jira projects for this matched measurement."}` |
| Required field or issue-type metadata missing/ambiguous/malformed | `409 {"error":"measurement_field_config_invalid","message":"The saved Jira field or issue-type configuration cannot support this measurement."}` |
| Captured group/dashboard signature changes before publish | `409 {"error":"measurement_config_changed","message":"Configuration changed during measurement. Start the campaign again."}` |
| Candidate safety ceiling | `422 {"error":"measurement_scope_too_large","message":"The complete measurement scope exceeds a safety limit."}` |
| Candidate exceeds its fixed total deadline | `504 {"error":"measurement_deadline_exceeded","message":"Jira did not complete the measurement within its time limit."}` |
| Jira parser/permission/upstream failure | `502 {"error":"measurement_jira_failed","message":"Jira could not complete the measurement query."}` |
| Configuration storage unavailable | `503 {"error":"config_storage_unavailable","message":"Configuration storage is temporarily unavailable."}` |

Measurement-domain errors contain exactly `error` and `message`; they never include submitted values
or Jira details. The hidden-route `404` and global `401`/`403` shapes retain only their existing
sanitized fields.

### Success schema

The candidate POST response contains exactly the following shape and always returns
`metrics.wallMs=null`, because only the browser can observe completion of the aggregate HTTP body.
After a successful parse, the runner replaces that one field in its in-memory saved sample with the
monotonic duration from immediately before `fetch` until the full body has parsed; it changes no
other candidate field.

```json
{
  "schemaVersion": 1,
  "profile": "candidate_all_work",
  "cacheState": "cold",
  "result": "success",
  "metrics": {
    "wallMs": null,
    "indexReadyMs": 0,
    "focusedReadyMs": 0,
    "fullReadyMs": 0,
    "stageMs": {
      "config": 0,
      "cache": 0,
      "epicIndex": 0,
      "sprintMembership": 0,
      "focusedChildren": 0,
      "remainingChildren": 0,
      "shape": 0,
      "total": 0
    },
    "epicCount": 0,
    "childCount": 0,
    "focusedChildCount": 0,
    "projectCount": 0,
    "componentCount": 0,
    "teamCount": 0,
    "columnCount": 0,
    "jiraCatalogCallCount": 0,
    "jiraLogicalRequestCount": 0,
    "jiraSearchCallCount": 0,
    "jiraPageCount": 0,
    "jiraBatchCount": 0,
    "jiraResponseBytes": 0,
    "shapedResponseBytes": 0,
    "maxBatchSize": 0,
    "maxConcurrency": 0,
    "maxEncodedRequestBytes": 0,
    "memoryPeakDeltaBytes": 0,
    "metricAvailability": "complete",
    "legacyCapped": false,
    "complete": true,
    "membershipStable": true,
    "ceilingHeadroomLow": false
  }
}
```

Candidate profiles are `candidate_selected_sprint`, `candidate_all_work`, and
`candidate_team_fallback_selected_sprint`. The runner normalizes the two real legacy calls into
`legacy_selected_sprint` records using the same saved-sample schema. Legacy records populate only `wallMs`,
the de-duplicated `epicCount` and `childCount`, `metricAvailability=legacy_partial`, and
`legacyCapped`; every other metric is explicit `null`. Set `legacyCapped=true` when either legacy
response reports a numeric `total` greater than its returned issue count or returns 250 issues,
because that boundary cannot prove completion. Saved candidate records contain a numeric runner
`wallMs` and populate the rest of the full schema with
`metricAvailability=complete` and `legacyCapped=false`. `cacheState` is exactly `cold|warm` for every
profile and `result` is exactly `success` in a saved campaign.

The completed download has exactly `schemaVersion`, `result="complete"`, and `rounds`. Each round
object has exactly `round` and `samples`; each sample is the complete closed success object above
without any campaign-specific additions. There are exactly five rounds. Each round has one cold and
one warm sample for each of the four profiles in §8's order, including explicit `null` values for
unavailable legacy metrics.

An early-stop download has exactly
`{"schemaVersion":1,"result":"stopped","stopCode":"<allowlisted>","rounds":[]}`; it never includes
partial samples. Allowed stop codes are `oauth_unavailable`, `invalid_scope`, `jira_rejected`,
`candidate_incomplete`, `membership_drift`, `cache_miss`, `sensitive_output`,
`memory_sample_unavailable`, `invalid_campaign`, `csrf_unavailable`, and `sample_deadline`. The last
code is an empty early-termination envelope but a performance failure: the checker prints
`FAIL sample_deadline`, not `STOP`. No timestamps, environment labels, free-form notes, or
identifiers are allowed in either form.

## 6. Candidate measurement engine

### 6.1 Immutable configuration snapshot

Require one saved Component-backed Department, a distinct saved Department with empty
`missingInfoComponents` and at least one saved Team, valid saved Boards for both, one selected sprint
id valid for both Departments, and at least one configured selected Jira project that resolves to
Product or Tech after compatibility normalization; every selected project in this campaign must
resolve to one of those two types. The runner has separate Department selectors for
the Component and Team-fallback profiles; it never mutates configuration to fabricate either shape.
The production saved-board project fallback remains valid and fully classified in the support
design, but this matched campaign does not use it: current legacy Product/Tech endpoints choose their
project JQL before any issue/project classification and do not take the saved Jira Board project as
input. Classification and fetch scope are separate contracts.

Resolve in request context before any concurrent work:

- normalized uppercase Jira project key-to-Product/Tech mapping from the captured selected
  project records. Product/Tech is inherited from each issue's Jira project key, never from issue
  type. Treat a legacy string entry and an object with a missing type as Product. Otherwise accept
  only exact `product|tech`, normalize other types to `other`, deduplicate identical key/type pairs,
  and reject conflicting duplicate types. Production may retain `other`, but the matched spike
  rejects it because current legacy Product/Tech calls do not fetch that project type;
- the authenticated `/rest/api/3/issuetype` catalog. Require stable ids plus `hierarchyLevel` and
  `subtask`, and resolve configured names to ids as specified below. Preserve compatibility exactly:
  absent `issueTypes` means `['Story']`, while explicit `issueTypes: []` means every eligible
  hierarchy-level-0, non-subtask type;
- Jira Sprint, Story Points, Team, Epic Link, Project Track, and Delivery Owner field ids. Every
  configured custom field must match `customfield_<digits>` before conversion to `cf[digits]`.
  Absent/blank Sprint, Story Points, Team, and Project Track ids use `customfield_10101`,
  `customfield_10004`, `customfield_30101`, and `customfield_35024`; Delivery Owner is optional and
  has no default. Resolve Epic Link by stable field id/schema metadata from the authenticated field
  catalog; only when that metadata is unavailable may exactly one eligible display-name match be
  accepted. Ambiguous or malformed metadata fails with `measurement_field_config_invalid`. Zero
  eligible Epic Link fields is supported and selects parent-only JQL;
- group Components, Board columns, final structural terminal statuses, and retention; and
- auth, workspace, cloud, token-version, config revision, and content signatures.

An exact `Done` status is not required. Apply the support design's compatibility algorithm in memory:
if a column contains exact `Done`, move that preserved column to the end; otherwise the final stored
column is terminal. Missing `doneEpicRetentionDays` reads as 28. A terminal column may have no
statuses, in which case the retention predicate is omitted. No other default is invented.

Use `require_existing_shared_groups_snapshot` for the initial read. It must distinguish a missing DB
row from a saved empty row and must not call a compatibility loader that lazily persists fallback
JSON. Require a pre-existing DB-backed shared group row and prove a measurement request performs no
measurement-owned configuration, audit, or migration write. Normal DB OAuth token rotation—and its
existing security audit/revocation write on refresh reuse—remains owned by the auth subsystem and is
not suppressed or reimplemented by the diagnostic. After service work, use a fresh repository instance to
call the uncached DB dashboard-snapshot loader directly and perform a fresh read-only
`workspace_group_configs` query; do not call the request-cached
`jira_server.load_dashboard_config_snapshot()` again. Compare revisions and canonical digests before
cache publication/response. A mismatch returns `measurement_config_changed` and caches nothing.

### 6.2 Epic index query

Build from escaped server-owned values:

```text
project in (<selected projects>)
AND issuetype = Epic
AND component in (<groups[].missingInfoComponents>)
AND (
  status not in (<final-column statuses>)
  OR (
    status in (<final-column statuses>)
    AND (
      one "status CHANGED TO <status> AFTER -<retention>d" clause per terminal status
      OR created >= -<retention>d
    )
  )
)
```

The `created` branch conservatively admits any currently terminal Epic created within the retention
window; it does not infer when the Epic entered its current status. Never use `updated`. Request only
fields required by the lightweight Epic shell and Epic-native facets: summary, status, priority,
assignee, updated, project, Project Track, Delivery Owner, and `parent` with the key/summary/issue-type
hierarchy needed to shape Initiative metadata. Description and Subtasks remain out. Serialize the
same production-intended Epic shell from the support design for byte and memory measurement.
If the structural terminal column has no assigned statuses, omit the retention predicate entirely;
never emit an empty `status in ()` clause.

### 6.3 Direct-child queries

Build batches of at most 40 Epic keys and within a measured encoded-URL/JQL byte bound:

```text
project in (<selected projects>)
AND issuetype in (<resolved hierarchyLevel=0 issue-type ids>)
AND (
  cf[<resolved Epic Link numeric id>] in (<batch>)
  OR (cf[<resolved Epic Link numeric id>] IS EMPTY AND parent in (<batch>))
)
```

Add `cf[<configured Sprint numeric id>] = <validated numeric sprint id>` only for selected-sprint
profiles. When no eligible Epic Link field exists, replace the final group with
`AND parent in (<batch>)`. When the effective issue-type names are non-empty—including the default
`['Story']` when the key is absent—include every catalog id whose exact name matches and whose
`hierarchyLevel=0` and `subtask=false`; fail if any effective name has no eligible match. Only an
explicit empty list includes every catalog entry with that same standard-level predicate. Build JQL
from ids so duplicate names cannot select an Epic/subtask type. Preserve Epic-Link-first,
Epic-typed-parent fallback when shaping relationships; if both fields are present and conflict, Epic
Link owns the child, so a parent clause may match only when Epic Link is empty.

Selected-sprint measurement removes Epics with zero matching children before declaring membership
complete. Its membership and hydration phases must retain and reuse the same fetched rows; they must
not issue duplicate Jira child searches. All-work adds no sprint clause. The engine computes
Product/Tech Projects membership from the complete child cohort and Project Track from the Epic
field; it records no raw facet values.

Request and production-shape each direct child with summary, status, priority, actual issue type,
assignee, updated, Story Points, Team, parent, resolved Epic Link, project, and Sprint. Do not request
or shape `subtasks`, `subtaskSummary`, or description. Shape the pure classifier's exact
`projectClassification=product|tech|other` alongside the project data so measured bytes match the
production tri-state contract. `shapedResponseBytes` is the deterministic
UTF-8 JSON byte size of the complete internal production-shaped Epic shells plus direct-child rows,
with sorted object keys and compact separators; it excludes the small aggregate HTTP response,
diagnostic cache metadata, and container overhead.

For `candidate_team_fallback_selected_sprint`, query selected-sprint children with the resolved Team
field constrained to every Team id saved on the fallback Department, then derive their Epic keys.
Fetch those Epics in bounded key batches using the same project predicate, `issuetype = Epic`, and
terminal-retention predicate as the Component index, but no Component predicate. Reject missing,
duplicate, or unexpected Epic keys and remove terminal-retention-ineligible Epics before column
membership. Private Team selection is never an input. Apply the same project/type/field,
pagination, completeness, ceiling, and focused-order rules as Component scope.

### 6.4 Strict pagination and completeness

- Start one 30-second absolute monotonic candidate-sample deadline after guards succeed and before
  acquiring the campaign lock or materializing/refreshing the DB OAuth token. Add an optional
  `deadline_monotonic` argument through `current_jira_get/search`, DB token materialization, OAuth
  refresh, and `resilient_jira_get`; omission preserves every existing default. Bound process-lock
  acquisition by the remaining duration. OAuth refresh uses `min(20, remaining)` as its HTTP timeout.
  Before every Jira attempt, recompute the remaining duration and cap both connect and read timeouts
  to it; the retry elapsed allowance and every backoff sleep are also capped to the same remainder.
  Never reuse one per-attempt timeout across retries. Before every catalog call, search page, and
  scheduled batch, and again immediately after every adapter return and before cache/campaign/HTTP
  publication, require positive remaining time. A dedicated internal deadline exception maps only to
  `504 measurement_deadline_exceeded`; stop scheduling, discard all partial rows, and publish no
  cache or campaign membership state. If a Jira or refresh timeout returns after the absolute
  deadline, the deadline outcome wins; before expiry, preserve the ordinary sanitized auth/upstream
  mapping. An outer Future timeout is forbidden because it cannot cancel in-flight Jira or refresh
  I/O.
- After token materialization, recapture the final context/token version before configuration and
  campaign sequencing. Before publication, revalidate that auth connection/token version; a later
  rotation or revocation follows the existing sanitized `auth_connection_stale`/revoked contract and
  suppresses the cache/campaign result. The next warm POST therefore resolves the same post-refresh
  identity as its cold predecessor.
- Use Jira `nextPageToken`/`isLast` only, with page size 100, at most 101 pages per logical search,
  and at most 2,600 Jira search pages per candidate sample.
- Require object body, bounded `issues` array, boolean `isLast`, and a new non-empty token whenever
  `isLast=false`; continue through an empty non-final page.
- Reject HTTP/JSON failure, malformed rows, duplicate normalized issue keys, missing/repeated token,
  contradictory terminal state, or defensive page-bound exhaustion.
- Candidate maximums are 1,000 unique Epics, 10,000 unique children, 40 Epic keys per batch, and two
  concurrent child searches inside the one sample request.
- Before every Jira search, require the UTF-8 byte size of the fully URL-encoded search parameters
  (`jql`, fields, page size, and token) to be at most 7,000. Split child batches further when needed;
  fail before sending when the fixed index or catalog-driven query exceeds the same bound. Record the
  maximum observed encoded size and test exactly 7,000 and 7,001 bytes.
- Exactly a ceiling is valid only when the current page is final. A required next page is over-limit.
- One synchronized counter covers every batch/column. A race cannot let independent workers each
  pass the global child limit.
- Assign each Epic to one configured or synthetic Unmapped membership. Use the exact-`Done`
  compatibility algorithm from §6.1 to resolve the terminal column and place synthetic Unmapped
  immediately before it for ordering metrics.
- Bootstrap focus before hydration from information already available: configured star, otherwise
  first configured column. Do not inspect “column with work” until selected-sprint qualification is
  complete, because that would make focused-first scheduling circular. Finish the bootstrap-focused
  column before scheduling remaining columns; after full authority the normal UI resolver may move
  focus according to its existing rule without changing the recorded focused-ready metric.
- A page/batch/ceiling/config change invalidates the whole sample. Never return or cache partial rows
  as complete.
- `jiraLogicalRequestCount` counts every Jira search, issue-type catalog, and field-catalog HTTP
  operation; `jiraCatalogCallCount` is the catalog subset, `jiraSearchCallCount` is the search
  subset, and `jiraPageCount` counts search pages. `jiraResponseBytes` is the sum of raw response-body
  bytes for all of those Jira operations, including catalog bodies. Retries below the injected Jira
  seam are unavailable and must not be estimated; their elapsed effect remains in `wallMs`.

The engine may retain candidate issues only in its process-local diagnostic cache. It returns only
the aggregate schema above.

### 6.5 Diagnostic cache

Key candidate data by workspace, auth connection/user, browser session, cloud, token version, group
id and revision/digest, selected project key-to-type mapping, known project-access snapshot,
issue types/fields, Components,
Board/status/retention signature, dashboard revision/digest, scope, and sprint id. Bound the cache to
8 entries, five minutes TTL, and 32 MiB total deterministic serialized candidate data. Evict LRU;
if one candidate entry alone exceeds 32 MiB, fail with `measurement_scope_too_large` before publish.

Keep authenticated field and issue-type catalog snapshots in a separate diagnostic-only metadata
LRU bounded to 4 entries, five minutes, and 2 MiB, partitioned by workspace, user/connection, cloud,
token version, and known access snapshot. Catalog misses count as Jira logical/catalog calls and
their body bytes; hits report zero new catalog calls. Catalog lookup time is included in `config`.
The normal OAuth process cache is not measurement evidence and must not hide this work. A single
metadata entry larger than 2 MiB is a fixed `measurement_scope_too_large` failure, not an unbounded
or silently uncached entry.

`refresh=true` bypasses/replaces only that exact key. It must not clear `TASKS_CACHE`, call
`clear_auth_sensitive_caches`, or invalidate another user/scope. A refresh publishes atomically only
after success; failure preserves the older complete entry but returns the current fixed failure and
must not relabel the old entry as current success. Never cache errors, partial rows, or stale
configuration. Warm hits reuse compatible canonical data/counters but measure fresh lookup, shaping,
serialization, and request wall time; they never replay cold timing values. Because the live spike
runs through the single-process Flask development
server, this diagnostic cache is valid only for measurement; it is not evidence for a multi-worker
production cache.

The service keeps one campaign container keyed by auth connection and browser session, with a
per-profile immutable Department/scope signature and HMAC of sorted normalized Epic and child keys.
It uses a fresh random in-memory HMAC key that is never returned or persisted. `begin` replaces the
whole container and `end` destroys the whole container, including the other Department's profile.
Round 1 establishes each candidate
profile's cold baseline and returns `membershipStable=true`. Each refreshed cold round 2–5 compares
with the immediately previous successful cold sample for that same profile and returns only the
boolean. Its following warm hit repeats that cold sample's boolean and does not count as another
comparison. Destroy campaign digests when the campaign ends or TTL expires; never expose a
bare/reversible issue-key hash.

## 7. Timing and redaction contract

Candidate `Server-Timing` names are fixed: `config`, `epic-index`, `sprint-membership`,
`focused-children`, `remaining-children`, `shape`, `total`, and `cache`. Tokens never contain dynamic
scope values. Candidate timing fields mean:

- `indexReadyMs`: service-internal elapsed time until Component Epic shells are available; for the
  Team fallback, until the sprint/Team child cohort has yielded and fetched its Epic shells;
- `focusedReadyMs`: service-internal elapsed time until the resolved focused column is completely
  qualified and shaped;
- `fullReadyMs`: service-internal elapsed time until every column and the complete shaped candidate
  are ready, immediately before aggregate response serialization; and
- `wallMs`: browser-observed elapsed time until the aggregate HTTP response is fully available.

The three `*ReadyMs` values are server-readiness evidence only. The aggregate endpoint exposes no
intermediate payload, so none proves user-visible first content. Legacy records set all three to
`null`; their `wallMs` is the completion of both current Product/Tech calls. A later production plan
must measure UI first paint/content and selected-sprint regression against the selected transport.

Run only one candidate sample at a time under a process-local campaign lock acquired within the same
sample deadline; timeout follows `measurement_deadline_exceeded` and publishes nothing. Immediately
after the immutable config snapshot, start `tracemalloc` if needed, collect a current-memory baseline, reset
its peak, then sample current/peak after candidate shaping and before cache publication. Record
`memoryPeakDeltaBytes=max(0, peak-baselineCurrent)`. Legacy records use `null`. If tracing was already
active for unrelated work, another sample overlaps, or a reading is unavailable, abort the campaign;
the checker returns `STOP memory_sample_unavailable`. Document that tracing overhead is included in
candidate timings.

The same-origin runner may inspect legacy response rows in memory only to count them. Candidate
membership comparison stays entirely inside the service-private HMAC state. The runner must not
render raw Jira data, log it, put it in storage, or include it in a download. It suppresses all
response-body error text. It may transiently render Department and sprint option labels obtained
from existing same-origin APIs, but must never persist, log, or download those labels.

The checker must:

- require exactly five rounds and every cold/warm profile for `result=complete`, or the exact empty
  stopped form;
- accept only the closed response fields and enums above plus round/order metadata;
- reject issue-key, URL, Authorization/Bearer, token, email, JQL-clause, raw status/Component/project/
  group/sprint fields, and distinctive local configuration values;
- construct its summary from numeric/boolean allowlisted metrics rather than copying input;
- refuse an `--output` path inside the repository; and
- in `--input` mode, print exactly one final line: `PASS <code>`, `FAIL <code>`, or `STOP <code>`;
  `--base-url` follows the separate one-URL contract in Task 6.

Classification strings are closed and deterministic. First reject malformed or sensitive output as
`STOP invalid_campaign` or `STOP sensitive_output`. For another valid stopped envelope,
`sample_deadline` prints `FAIL sample_deadline`; every other allowlisted code prints `STOP <code>`.
For a completed campaign, evaluate `FAIL` in this order: `cold_candidate_max`,
`cold_all_work_median`, then `warm_candidate_median`; otherwise print `PASS aggregate_viable`.
Sensitive-value detection writes no summary.

The existing legacy endpoints expose neither strict completeness nor all stage/page counts. Record
unavailable fields as `null` with `metricAvailability=legacy_partial`; never estimate them. If a
legacy call reaches its 250-row cap, set `legacyCapped=true` and use it only as elapsed-time baseline
metadata, never as completeness evidence.

## 8. Fixed five-round method

Use this order to distribute upstream-cache bias:

| Round | Cold profile order |
| --- | --- |
| 1 | legacy selected sprint → candidate selected sprint → candidate All work → candidate Team fallback |
| 2 | candidate selected sprint → candidate All work → candidate Team fallback → legacy selected sprint |
| 3 | candidate All work → candidate Team fallback → legacy selected sprint → candidate selected sprint |
| 4 | candidate Team fallback → legacy selected sprint → candidate selected sprint → candidate All work |
| 5 | legacy selected sprint → candidate Team fallback → candidate All work → candidate selected sprint |

For every profile:

1. Paint the runner's running state before starting network work.
2. Perform the cold call with exact-key `refresh=true` and browser `cache: "no-store"`.
3. Immediately repeat identical inputs without refresh for the warm sample.
4. Parse only allowlisted `Server-Timing` names.
5. Verify the warm candidate reports a compatible cache hit.
6. Discard response bodies after in-memory aggregation.
7. Stop the campaign immediately on auth loss, malformed/incomplete data, ceiling, membership drift,
   redaction failure, or sample deadline.

Immediately before **every** candidate POST, fetch `/api/auth/csrf` with same-origin credentials and
browser `cache: "no-store"`, use that token for that one POST, then discard it. CSRF tokens are
consumed and must never be reused for the warm repeat or a later round. Any guard `401`
(`auth_required`, `account_disabled`, `auth_connection_revoked`, or `auth_connection_stale`) maps to
`STOP oauth_unavailable`; a `403 csrf_required` maps to `STOP csrf_unavailable`. Do not replay the
measurement request automatically, and persist no raw recovery payload or partial samples. A
`504 measurement_deadline_exceeded` maps to the empty `sample_deadline` envelope and
`FAIL sample_deadline`.

The first candidate cold sample in round 1 sends `campaignAction=begin`; its warm repeat and all
intermediate candidate calls send `continue`. The final candidate warm sample in round 5 sends
`campaignAction=end`. Server TTL is the cleanup fallback after an aborted campaign.

The legacy profile calls Product and Tech concurrently with the Component-backed Department, sprint,
and saved Department Team scope the app currently supplies. Its `wallMs` ends when both responses
complete. Do not compare its capped row count as completeness.

Use the median of five for comparisons and the maximum for the six-second guard. Five samples do not
support a p95 claim. If baseline/candidate counts differ, report the difference and duration per 100
returned issues; do not compare raw completion time as equivalent work.

## 9. Classification gates

### `STOP`

Stop without a performance verdict when:

- the real local OAuth session is unavailable;
- group/Component/Board/project/sprint configuration is invalid;
- Jira rejects the terminal-history plus currently-terminal-created-within-window predicate;
- a candidate response is malformed, partial, capped, over a ceiling, or changes membership
  mid-campaign;
- an expected warm candidate is not a compatible cache hit; or
- the output checker finds an unknown/sensitive field; or
- the candidate memory sample is unavailable or contaminated.

This includes every strict DB-auth guard `401` as `STOP oauth_unavailable` and a token-fetch or POST
`csrf_required` failure as `STOP csrf_unavailable`; recovery fields never enter the campaign file.

A legacy 250-row boundary is allowed only as `legacyCapped=true` baseline metadata; it never causes
`STOP` and never supports a completeness comparison.

### `FAIL`

Fail the proposed aggregate seam when:

- a valid stopped envelope has `stopCode=sample_deadline`;
- cold All-work median `wallMs` exceeds 3,000 ms;
- any candidate cold `wallMs` exceeds 6,000 ms; or
- any candidate profile's warm compatible median `wallMs` exceeds 1,000 ms.

Do not weaken a failed threshold, raise a ceiling, omit rows, or call a partial result successful.
Set `ceilingHeadroomLow=true` when Epics or children reach 80% of a candidate ceiling. Even with a
`PASS`, production planning stops until the user reviews that warning.

`indexReadyMs`, `focusedReadyMs`, and normalized time per 100 returned issues are diagnostic only.
The product loading-feedback-within-100-ms requirement, user-visible first-content gate, and
selected-sprint no-more-than-10% regression gate remain future production UI acceptance tests.

## 10. Ordered implementation tasks

### Task 1 — RED: engine and redaction contracts

Create failing tests in `tests/test_eng_board_measurement.py` for:

- exact Component/project/terminal/currently-terminal-created-within-window/sprint JQL semantics and
  escaping;
- selected-project scope, classification inherited from each issue's Jira project, legacy
  string/missing-type Product compatibility, conflicting duplicate rejection, and matched-campaign
  rejection of empty or `other` project scope; issue type changes in one project must never change
  its classification;
- absent versus explicit-empty and configured issue-type catalog resolution, duplicate-name ids,
  missing hierarchy data, exact default field ids, optional Delivery Owner, zero/one/ambiguous
  Epic-Link resolution, malformed custom field ids, and exact conditional `cf[<numeric-id>]` JQL;
- conflicting cross-batch relationship data where Epic Link points to Epic A and parent points to
  Epic B: return the child once under Epic A, never under Epic B;
- Project Track from Epic data versus Product/Tech classification from complete children;
- next-token success and every malformed/repeated/missing-token failure;
- the fixed 30-second total deadline before catalog/page/batch calls, adapter timeouts bounded to the
  remaining budget across real Jira retries, sleeps, and DB OAuth refresh, post-call/pre-publication
  checks, a slow adapter returning `measurement_deadline_exceeded`, unchanged no-deadline behavior,
  and no partial cache or campaign publication on expiry;
- exact and over Epic/child ceilings, 100/101-page bounds, 2,600-page generation bound, shared count
  under concurrency, 40-key batches, exact 7,000/7,001-byte request bounds, and 32 MiB cache eviction;
- Component, selected-sprint, All-work, and all-saved-Team fallback completeness;
- focused-first ordering and Unmapped-before-terminal membership;
- bootstrap focus with no configured star, including a first candidate column that loses every Epic
  after selected-sprint qualification;
- captured context reaching the real Jira wrapper outside Flask request context;
- exact candidate/metadata cache partitions, TTL/LRU/byte eviction including 32 MiB/2 MiB
  single-entry rejection, refresh replacement, uncached
  post-work config re-read rejection, and error non-caching;
- a forced-expired DB access token refreshes within the deadline before final context capture; cold
  and warm use the refreshed token version as one campaign/cache identity, warm is a compatible hit,
  and no entry exists under the pre-refresh version;
- serialized-shape and catalog-inclusive response bytes, call counters, isolated memory sampling, and
  campaign HMAC baseline/drift/reset semantics;
- closed response schema and sensitive/local-value rejection; and
- imports/source references forbidden by §2 and §4.

### Task 2 — GREEN: pure diagnostic engine

Create `backend/services/eng_board_measurement.py` with injected Jira catalog/search adapters, clock,
cache, lock, memory sampler, and immutable request snapshot. Satisfy Task 1 without importing Flask,
requests, credentials, Home, mutation helpers, `jira_server`, or legacy partial-fetch helpers.

### Task 3 — RED/GREEN: local-only route

Add route, policy, security sample, and DB-OAuth tests before implementing the adapter. Prove:

- GET hidden outside explicit local-loopback configuration;
- POST uses exact `dev_local_preview`, rejects missing requested-with/token-CSRF, and rejects Basic,
  local token-store, and pre-DB OAuth before any generic local Basic allowance;
- strict DB-auth guards and Jira adapters preserve sanitized `auth_required`, `account_disabled`,
  `auth_connection_revoked`, and `auth_connection_stale` status/body/recovery contracts. Guard cases
  stop before service work; adapter cases are injected after at least one successful Jira operation
  and still discard partial/cache/campaign state. All map to runner `STOP oauth_unavailable` without
  persisted response data;
- expired-token route coverage proves materialize/refresh precedes immutable snapshot and campaign
  sequencing, while a token rotation after final capture suppresses publication as stale auth;
- policy helpers do not advertise the local diagnostic as a general OAuth-ready product route;
- real current-user DB OAuth required;
- workspace-owned group resolution and unknown-parameter rejection;
- server-owned scope/config fields and fixed errors;
- immutable config/auth capture before service work; and
- no local token-store/service-account fallback.

Then implement the smallest adapter in `backend/routes/dev_routes.py` and
`backend/security/policy.py`.

### Task 4 — RED/GREEN: runner and checker

Test then create `scripts/eng_board_measurement_runner.html` and
`scripts/check_eng_board_measurement.py`, with browser behavior in
`tests/ui/eng_board_measurement_runner.spec.js`. Prove both Department selectors, one sprint valid
for both, all four profiles and eight samples per round in the fixed order, real legacy baseline
calls, exact candidate calls, authenticated `/api/test` precheck after browser sign-in, rendered
running state, one distinct same-origin no-store CSRF fetch/token consumed per candidate POST with no
replay after `401`/`403`, browser/server cache distinction, closed download schema, no raw Jira rendering or
console/storage/download leakage, repo-local output refusal, deterministic medians/gates, and the
single final classification line.

### Task 5 — Automated verification

Run:

```bash
.venv/bin/python -m unittest tests.test_eng_board_measurement
.venv/bin/python -m unittest tests.test_shared_group_config_db
.venv/bin/python -m unittest tests.test_jira_resilience tests.test_jira_auth tests.test_oauth_jira_client
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_db_oauth_cutover
.venv/bin/python -m unittest tests.test_backend_route_source_guards tests.test_jira_search_pagination_source_guard tests.test_oauth_jira_client_source_guard
npm run test:frontend:unit
npx playwright test tests/ui/eng_board_measurement_runner.spec.js
npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_alert_loading_order.spec.js
npm run build
make verify-dist-clean
.venv/bin/python -m unittest discover -s tests
git diff --check
```

The source-isolation assertion must prove the diagnostic engine is referenced only by
`backend/routes/dev_routes.py`, its tests/scripts, and plans—not by `jira_server.py`,
`backend/routes/eng_routes.py`, frontend source, or generated output.

### Task 6 — Startup and live campaign

Before live execution:

```bash
git status --short
git branch --show-current
rg --files docs/plans | rg '/GATE-'
.venv/bin/python scripts/check_startup_preflight.py
```

Review every returned gate per `docs/plans/AGENTS.md`; do not mark one passed without its documented
`PASS` result.

Start the single-process local OAuth server with diagnostics explicitly enabled:

```bash
APP_ENVIRONMENT_KEY=local ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true .venv/bin/python jira_server.py
```

Warnings before the Flask banner fail startup verification. From another terminal:

```bash
curl -fsS http://127.0.0.1:5050/health
.venv/bin/python scripts/check_eng_board_measurement.py --base-url http://127.0.0.1:5050
```

`--base-url` accepts only `http://127.0.0.1:<port>` or `http://localhost:<port>`, performs the public
`/health` readiness check requiring HTTP 200, JSON object, and `status="OK"`; then it prints exactly
one runner URL and exits 0. An invalid/non-loopback URL, failed readiness response, redirect, or unexpected body exits 2 without sending cookies or another
request. It never attempts to borrow a browser session or call the authenticated sample route. Stop
and ask the user to sign in through the normal Atlassian OAuth flow and open the printed local runner
URL. After sign-in, the runner calls authenticated `/api/test` with same-origin credentials before
enabling measurement. The user chooses one Component-backed Department, a separate no-Component
Department with saved Teams, and one sprint valid for both. Save the allowlisted download outside the
repository as `/tmp/eng-board-measurement-five-runs.json`, then run:

```bash
.venv/bin/python scripts/check_eng_board_measurement.py \
  --input /tmp/eng-board-measurement-five-runs.json \
  --output /tmp/eng-board-measurement-summary.json
```

Stop the server afterward. Never copy either `/tmp` file into the repository.

### Task 7 — Record sanitized outcome and stop

Update every `GATE-*.md` document's `Checked on` and `Last result` per `docs/plans/AGENTS.md`; for
`GATE-05-home-write-capability.md`, retain `Blocked` unless its documented real-session probe prints
`PASS`. Then update this plan with only:

- final `PASS`/`FAIL`/`STOP` code;
- when completed, five-run median/max `wallMs` plus internal readiness metrics labelled
  server-internal;
- count/byte/headroom buckets and request/page totals;
- whether legacy was capped;
- retention-JQL parser result; and
- commands run with pass/fail results.

Do not paste raw run JSON or local identifiers. Then stop for the production decisions listed in the
support design: transport, refresh granularity, final safety limits, and completion budgets. Only a
passing measurement plus those decisions authorizes a separate production `EXEC-*` plan.

## 11. Analytics and documentation

The diagnostic runner is local developer tooling, not a product surface. It emits no GA4 event and
does not change `docs/README_ANALYTICS.md`. Operational timing stays in allowlisted `Server-Timing`
and external sanitized files.

Keep the support design non-executable until Task 7 review. If implementation changes a measurement
contract, amend this plan before continuing rather than recording a divergent result as compliant.

## 12. Residual risks

- Jira-side caches cannot be reset; fixed order rotation reduces but does not eliminate variance.
- Five samples support median and maximum comparisons, not p95.
- The legacy selected-sprint source may hit its 250-row cap. It remains a perceived-speed baseline,
  not completeness evidence.
- One Department cannot establish limits for every workspace. Low headroom requires another
  representative scope before production.
- The single-process diagnostic cache and invocation do not validate a multi-worker production
  transport; that is an explicit post-measurement architecture decision.
