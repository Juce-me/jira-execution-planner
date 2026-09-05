# EXEC — ENG Board optional-sprint measurement spike

> **Status:** Ready to execute — diagnostic implementation only. Revalidated on 2026-09-05.
> Measurement has not been implemented or run; live characterization remains gated by Tasks 0–5.
> This is a local diagnostic implementation contract, never production authorization. The current
> cooperative deadline mode cannot produce PASS; see §8. No live spike is part of this repair.

| Field | Value |
| --- | --- |
| Revised | 2026-09-05 |
| Issue | [#137](https://github.com/Juce-me/jira-execution-planner/issues/137) |
| Input design | [SUPPORT-eng-board-optional-sprint-design.md](SUPPORT-eng-board-optional-sprint-design.md) |
| Component source | Existing shared `groups[].missingInfoComponents` |
| Configuration source | Existing workspace DB dashboard and shared-group rows only |
| Jira writes / production wiring | Forbidden |
| Runtime | Dedicated single-process local Flask, strict DB browser OAuth; no other app traffic |
| Deadline claim | Cooperative 30-second budget, not a hard bound; non-authorizing evidence |

Use `superpowers:executing-plans` when this document is ready and execution is requested. Read root,
`docs/AGENTS.md`, `docs/plans/AGENTS.md`, the index, ownership contract and relevant postmortems first.
Do not introduce persistent results or planning artifacts beyond the file map.

## 1. Verified review dispositions

Evidence is the current source on `docs/issue-137-board-design`, reviewed on 2026-09-05. Line numbers
below identify existing symbols, not proposed implementations. Previous section citations refer to
this plan at review baseline `b0655ea`. All twenty findings are **Confirmed**;
existing tests establish compatibility seams but do not close the newly required negative cases.
The severity groups preserve the issue comment's order; numbers match the remediation request.

### Blocker

| Finding | Current evidence and failure | Executable closure |
| --- | --- | --- |
| 1 — CSP | `backend/security/headers.py:6::_content_security_policy` allows same-origin scripts but no inline scripts; the previous file map had HTML only. | External local runner JS, exact asset guards and live-header browser CSP test (§2, §3, Task 4). |
| 2 — discovery writes | `backend/routes/settings_routes.py:472::get_groups_config` calls `shared_group_config.load_shared_groups`; `backend/services/shared_group_config.py:172::load_shared_groups` calls `ensure_workspace_group_config` on absence. | New read-only options/helper; missing row remains absent, including missing-dashboard cases (Task 1). |
| 3 — trivial PASS | `frontend/src/eng/engBoardFilters.js:24::mergeBoardEpicGroups` admits zero-child Epics; `tests/test_eng_board_filters.js:163` explicitly tests this valid production shape. The previous timing gate imposed no workload minimum. | Keep empty production Boards valid; stop unrepresentative measurement campaigns using numeric coverage gates (§7–8, Task 3). |
| 4 — false coldness | Previous §6.5 bypassed only candidate entries while retaining metadata. `jira_server.py:688::current_jira_get` also uses existing OAuth/HTTP state. | Separate cache states, per-cold metadata bypass, no first-load claim (§6, Task 3). |
| 5 — deadline | `backend/jira_client.py:106::resilient_jira_get` fixes a timeout tuple before retries and buffers bodies; `backend/auth/jira_auth.py:244::request_oauth_refresh_token` uses 20 seconds; `backend/auth/db_tokens.py:224::_connection_for_update` locks rows; `backend/db/engine.py:183::session_scope` has no per-call budget. Browser abort cannot kill these operations. | Explicit cooperative-only contract, late-publication prevention and mandatory non-PASS gate across every wait (§5, Task 2). |

### P1

| Finding | Current evidence and failure | Executable closure |
| --- | --- | --- |
| 6 — unsupported scope conclusions | `backend/services/group_board.py:99::normalize_group_board` returns only columns at line 228; `frontend/src/eng/engBoardColumns.js:156::buildBoardColumns` supports synthetic Board; `backend/routes/settings_routes.py:1165::get_board_config_statuses` supports saved-board project fallback. | Scope authorization table, raw-row retention check and rejection tests (§4.1, Task 1). |
| 7 — Component ambiguity | `jira_server.py:5311::build_missing_info_scope_clause` accepts names; the shared group field stores strings, not project-qualified ids. | Explicit exact-name broadcast across saved selected projects; cross-project duplicate-name JQL tests and fixed policy enum (§4.1, Task 3). |
| 8 — invisible retries/breaker | `jira_server.py:688::current_jira_get` injects `JIRA_SEARCH_CIRCUIT_BREAKER`; `backend/jira_client.py:106::resilient_jira_get` hides retried attempts from page counters. | Isolated diagnostic transport for candidate AND tagged legacy requests; attempt observer, private breaker, no global breaker calls (§3, §5, Task 2). |
| 9 — empty stops | Previous §5 dropped all context on stop; scope-ceiling and source/drift failures became indistinguishable. | Closed stop context with phase/profile/limit/bucket/counters, exact mapping (§7, Task 4). |
| 10 — key-only drift | Previous §6.5 HMAC covered keys only. `frontend/src/eng/engBoardColumns.js:156::buildBoardColumns`, `frontend/src/eng/engBoardCardModel.js:44::computeEpicStoryProgress`, and `frontend/src/eng/engBoardFilters.js:64::buildEngBoardFacetModel` consume changing status/SP/metadata. | Private digest over canonical production projection and placement; same-key field mutation tests (§6, Task 3). |
| 11 — configuration provenance | `jira_server.py:1728::load_dashboard_config_snapshot` passes a JSON fallback; `backend/services/workspace_dashboard_config.py:69::_fallback_snapshot` returns `legacy_json` or `empty`. | Require `workspace_db` and existing row on options/begin/every sample/finish; no compatibility loaders (Task 1). |
| 12 — session collision/TTL | Previous §6.5 keyed one replaceable container by browser session; `backend/auth/csrf.py:24::_binding` confirms tabs share browser-session identity. | Random per-campaign id, exact step reservation, exclusive campaign lease, sliding TTL, abort/end/expiry (§3.2, Tasks 1/4). |
| 13 — unmatched legacy | `frontend/src/eng/useEngSprintData.js:147` filters issues/epics; `frontend/src/dashboard.jsx:7487::epicsInScope` merges Product then Tech `epicsInScope`; `frontend/src/eng/engBoardFilters.js:24::mergeBoardEpicGroups` adds scope Epics but not arbitrary detail entries. | Exact union and denominator; contextual-only comparison, no equivalence inference (§4.4, Task 4). |
| 14 — checker/memory | Previous §7 sampled before cache publication and lacked cross-field/header invariants; `tracemalloc` is process-global. | Exclusive ownership, peak plus retained memory after publication, exact byte/counter/timing equations (§6–7, Tasks 3/4). |
| 15 — throwaway core | Previous file maps created separate `eng_board_measurement.py` and production `eng_board.py` query services. | Production must move/reuse the validated core and rerun gates; transport alone may wrap it (support handoff, Task 7). |
| 16 — legacy effects | `frontend/src/dashboard.jsx:6826::fetchDependencies`, effect at 11822, and lookup at 11985 lack Board ownership; late dependency response writes state after parsing. | Board-entry cancellation and generation guards for tasks/dependencies/lookup/caches, deterministic late-response tests (support handoff). |
| 17 — mutation/progress race | `frontend/src/dashboard.jsx:12148` wires `useEngStatusTransitions`, `useEngPriorityTransitions`, `useEngProjectTrackTransitions` to sprint stores; previous support requested rejection without a revision algorithm. | Generation restart before optimistic mutation; serialize writes and restart authoritative fetch after result (support handoff). |

### P2

| Finding | Current evidence and failure | Executable closure |
| --- | --- | --- |
| 18 — focus metric | `frontend/src/eng/engBoardColumns.js:210::resolveFocus` chooses preferred, star, first-with-work, then first; `frontend/src/eng/EngBoardView.jsx:94` uses that resolver. Spike used first column without private preference. | Rename metric to `bootstrapColumnReadyMs`; strictly server-internal, never visible-focus evidence (§4–7). |
| 19 — API ownership inventory | `tests/test_frontend_api_source_guards.js:184` and `:196` require endpoint literals in API modules and native fetch only at the HTTP boundary. | Explicit production inventory plus Board API ownership, signal and auth-lock tests (support handoff). |

### Minor

| Finding | Current evidence and failure | Executable closure |
| --- | --- | --- |
| 20 — analytics cardinality | `frontend/src/api/http.js:100::trackedFetch` emits for each transport fetch; `frontend/src/analytics/analytics.js:233::trackApiResult` accepts an API surface. Previous support proposed per-column surfaces. | One terminal `api_result` per logical generation, fixed surface and typed enums; no per-frame/page/batch event (support handoff). |

## 2. Allowed implementation file map

This repair changes only this plan, its support design/index and gate check record. The following
map applies to later diagnostic implementation. **Create** means absent today; every Modify or
verification-only path must exist before its task starts. No production Board implementation is
allowed. No new dependency, schema, persistent diagnostic table, configuration field or analytics.

| File | Action | Owner / task |
| --- | --- | --- |
| `docs/plans/EXEC-eng-board-optional-sprint-measurement-spike.md` | Modify | Sanitized outcome and readiness, Tasks 0/7 |
| `docs/plans/SUPPORT-eng-board-optional-sprint-design.md` | Modify | Evidence and authorization limitations, Task 7 |
| `docs/plans/README.md` | Modify | Align status, Tasks 0/7 |
| `docs/plans/GATE-05-home-write-capability.md` | Modify | Checked on/Last result only; no PASS without probe |
| `backend/services/eng_board_measurement.py` | Create | Pure immutable scope/query/pager/projection/cache core, Task 3 |
| `backend/services/eng_board_measurement_runtime.py` | Create | Process-local campaign lease, transport ContextVar, counters, private breaker, Task 2 |
| `backend/routes/dev_routes.py` | Modify | Exact runner/options/control/sample adapters, Tasks 1/4 |
| `backend/services/shared_group_config.py` | Modify | `require_existing_shared_groups_snapshot`, no fallback writes, Task 1 |
| `backend/security/policy.py` | Modify | Exact `dev_local` asset GETs, `dev_local_oauth_read` options, `dev_local_preview` POSTs, Task 1 |
| `backend/security/guards.py` | Modify | Composed strict DB auth and guarded legacy transport binding/teardown, Tasks 1/2 |
| `jira_server.py` | Modify | Optional diagnostic transport propagation through current-user Jira GET/search and DB materialization; no Board orchestration, Task 2 |
| `backend/jira_client.py` | Modify | Opt-in diagnostic attempt observer, streamed-body budget checks, private breaker; defaults unchanged, Task 2 |
| `backend/auth/jira_auth.py` | Modify | Optional cooperative refresh budget/observer, Task 2 |
| `backend/auth/db_tokens.py` | Modify | Propagate optional cooperative budget through token materialization/refresh, Task 2 |
| `runners/local/eng_board_measurement_runner.html` | Create | Static document with external same-origin script only, Task 4 |
| `runners/local/eng_board_measurement_runner.js` | Create | Fixed campaign, bounded browser requests, transient legacy merge and sanitized download, Task 4 |
| `scripts/check_eng_board_measurement.py` | Create | Closed schema, equations, redaction and non-authorizing verdict, Task 4 |
| `tests/test_eng_board_measurement.py` | Create | Read-only routes, core, sequence, checker, source isolation, Tasks 1–4 |
| `tests/ui/eng_board_measurement_runner.spec.js` | Create | Real CSP, abort/stall/two-tab/security/download tests, Task 4 |
| `tests/test_shared_group_config_db.py` | Modify | Absent/saved-empty existing-row reads and row-count proof, Task 1 |
| `tests/test_endpoint_security_matrix.py` | Modify | Every exact diagnostic method/security class, Task 1 |
| `tests/test_db_oauth_cutover.py` | Modify | Strict current-user session and refresh preservation, Tasks 1/2 |
| `tests/test_jira_resilience.py` | Modify | Body/retry/breaker accounting and unchanged defaults, Task 2 |
| `tests/test_jira_auth.py` | Modify | Refresh wait/timeout/error behavior, Task 2 |
| `tests/test_oauth_jira_client.py` | Modify | Real worker wrapper plus runtime transport propagation, Task 2 |

`tests/test_endpoint_policy_inventory.py`, `tests/endpoint_security_samples.py`,
`tests/test_backend_route_source_guards.py`, `tests/test_jira_search_pagination_source_guard.py`,
`tests/test_oauth_jira_client_source_guard.py`, `tests/test_frontend_api_source_guards.js`,
`tests/test_token_refresh_race.py`, `Dockerfile`, `pyproject.toml` and
`scripts/check_design_assets_sanitized.py` are verification-only. The new paths are static.
Do not edit `backend/routes/eng_routes.py`, frontend source/dist, DB engine or deployment packaging.
The runtime module must import neither the measurement core nor Flask; only the dev adapter imports
the pure core in application code. It is inert unless an explicitly validated local campaign binds
its transport. New runner assets remain outside release packaging; test Docker/build contexts and
exact dev serving rather than adding a generic file-serving route.

## 3. Endpoint and campaign contract

### 3.1 Matrix

All diagnostic paths reject unknown query/body/header control values; `HEAD` and `OPTIONS` cannot
bypass their local guard (the existing generic early return in guards must be preceded by this exact
path check). Return no data body for HEAD; disallowed local access is still 404. Do not change generic
HEAD/OPTIONS behavior. HTML/JS are fixed-path files, never a user-selected path, directory listing,
redirect, or production static mount. `Cache-Control: no-store`, `nosniff`, and the normal CSP apply.

| Intent | Method/path | Auth, workspace, CSRF/requested-with | Request | Success | Tests |
| --- | --- | --- | --- | --- | --- |
| Runner HTML | GET `/api/dev/eng-board-measurement` | `dev_local`: explicit local environment, loopback, diagnostics flag; no session data/work, no CSRF/requested-with | No parameters | `200 text/html`; exact local HTML asset | Task 1 hidden-route/HEAD tests; Task 4 browser CSP |
| Runner JS | GET `/api/dev/eng-board-measurement/runner.js` | Same exact local policy | No parameters | `200 application/javascript`; exact local JS asset | Same; no inline script/event handlers/eval or widened CSP |
| Options/preflight | GET `/api/dev/eng-board-measurement/options` | `dev_local_oauth_read`: local gate then strict DB browser OAuth/workspace; no CSRF or requested-with needed | None | `{schemaVersion:2,configSource:"workspace_db",groups:[{id,label,profileEligibility:[enum]}],sprintInput:"numeric_id"}` | Task 1 absence, source, two-workspace and no-write tests |
| Control | POST `/api/dev/eng-board-measurement/control` | `dev_local_preview`: local gate, strict DB browser OAuth, `X-Requested-With: jira-execution-planner`, fresh token-bound CSRF | Discriminated bodies below | Closed control envelope below | Tasks 1/4 sequence, TTL, multi-tab, guards |
| Candidate | POST `/api/dev/eng-board-measurement/sample` | Same; campaign belongs to current workspace/user/connection/browser session/token version | `{campaignId,step}` only | `{schemaVersion:2,sample:<§7 object>}` plus fixed Server-Timing | Tasks 1–4 all boundaries |
| Legacy Product/Tech | GET `/api/tasks-with-team-name` (existing) | Existing authenticated-read policy PLUS composed local strict DB guard when diagnostic headers present; no token-CSRF for GET; require requested-with for tagged requests | Existing server-derived query plus `X-Measurement-Campaign` and `X-Measurement-Step`; see below | Existing legacy response shape; never download raw body | Task 2 isolate real wrapper; Task 4 pair abort/count/late result |
| CSRF | GET `/api/auth/csrf` (existing) | Existing DB browser session binding | None, fresh for every control/sample POST | Existing `csrfToken`, immediately discarded after use | Existing auth tests plus Task 4 stalled/401/403 paths |

Option `profileEligibility` contains only the three candidate profile enums in §7, in that order
when eligible; id/label are strings, sprintInput is the fixed enum, and no other fields are returned.
Group labels are transient authenticated display data, never logs or results.

Options reads the shared-group helper and `db_repository().load_dashboard_config_snapshot(context,
fallback_loader=None)` afresh. Require source `workspace_db`, positive revision and existing row;
absence is `409 measurement_config_source_required`. The group helper reads exactly one workspace
row without `ensure_workspace_group_config`, `load_shared_groups`, JSON loader, audit or migration
writer. A saved-empty row returns an empty options list; a missing row is
`409 measurement_shared_groups_required`. Normalize in memory but retain raw stored Board retention
for scope rejection. Do not call `/api/groups-config`, `/api/config`, `/api/sprints` or `/api/test`
for runner discovery. Those compatibility paths are not read-only preflight contracts.

The runner shows Department labels transiently and accepts one positive numeric sprint id typed by
the operator; it never submits Components/projects/Teams/statuses/retention/JQL. Begin validates the
sprint through current-user GET `/rest/agile/1.0/sprint/<validated id>` and validates scope separately
for both groups. Existence is not workload coverage: §8 still rejects empty campaigns. Metadata from
this validation is preflight evidence only, not candidate timing. Options and begin never save or
create shared configuration. Ordinary auth-owned refresh rotation/audit/revocation is preserved.
For tagged legacy reads, the guard installs the captured workspace DB snapshot in the existing
request snapshot cache before config-reading helpers run; finish performs an independent fresh read.
Never let a deleted row turn a tagged legacy read into JSON fallback evidence.

Control bodies are exact discriminated unions:

- `begin`: `{action:"begin",componentGroupId,teamGroupId,sprintId}` →
  `{schemaVersion:2,campaignId,nextStep:0,state:"active",ttlSeconds:1800}`.
- `continue/reserve`: `{action:"continue",phase:"reserve",campaignId,step}` →
  `{schemaVersion:2,state:"reserved",step,legacyRequest:null|{groupId,sprintId,teamIds,teamLabels,refresh}}`.
  The legacy descriptor is derived only from the captured Component group and is memory-only.
- `continue/finish`: `{action:"continue",phase:"finish",campaignId,step}` →
  `{schemaVersion:2,state:"active",nextStep,transport:<numeric §7 upstream counters>}`.
- `end`: `{action:"end",campaignId}` after step 39 is finished →
  `{schemaVersion:2,state:"ended"}`. No ids or metadata in the response.
- `abort`: `{action:"abort",campaignId}` → `{schemaVersion:2,state:"aborted"}`; owned missing/expired
  ids return the same idempotent shape. It cannot terminate another owner's campaign.

`campaignId` is 32 random bytes encoded base64url, generated on the server, held only in tab memory
and the private runtime, never a URL/cookie/download/log/analytics field. Validate exact length and
alphabet. Identifiers are allowed only in these transient request/control/options contracts.
The saved result schema forbids ALL campaign ids, option labels and legacy descriptors.

Guard order: exact local checks → DB storage and OAuth mode → strict existing DB browser session
(no pre-DB upgrade/local token-store fallback) → requested-with and one-use token CSRF for POST →
workspace/campaign ownership. Both new OAuth classes stay out of public OAuth-ready route reporting.
Preserve existing sanitized `401 auth_required|account_disabled|auth_connection_revoked|
auth_connection_stale` and `403 csrf_required` responders; the runner stores only the mapped stop code.
Any unlisted downstream AuthError becomes fixed `measurement_jira_failed` (502), never raw text.

Every domain error is `{error:<enum>,message:<fixed copy>,stopContext:<§7 shape>}`. Hidden access is
`404 {error:"not_found"}`; global auth/CSRF payloads retain existing fields only. Messages come from
one constant per enum and contain no submitted value. Exact domain status mapping:

| HTTP | Error enums → stop code |
| --- | --- |
| 400 | `invalid_measurement_scope` → `invalid_campaign`; `measurement_sprint_required` → `invalid_scope` |
| 404 | `measurement_group_not_found` → `invalid_scope`; unknown/foreign campaign → `invalid_campaign` |
| 409 | `db_oauth_required` → `oauth_unavailable`; `measurement_shared_groups_required`, `measurement_config_source_required`, `measurement_board_invalid`, `measurement_project_scope_required`, `measurement_components_required`, `measurement_team_scope_required`, `measurement_field_config_invalid`, `measurement_sprint_invalid` → `invalid_scope` |
| 409 | `measurement_config_changed` → `configuration_drift`; `measurement_data_changed` → `content_drift`; `measurement_cache_miss` → `cache_miss`; `measurement_campaign_busy` → `campaign_busy`; `measurement_campaign_expired` → `campaign_expired` |
| 422 | `measurement_scope_too_large` → `scope_ceiling`; `measurement_unrepresentative_scope` → `unrepresentative_scope`; `measurement_projection_invalid` → `candidate_incomplete` |
| 429 | `measurement_rate_limited` → `rate_limited` |
| 502 | `measurement_jira_failed` → `jira_rejected`; `measurement_breaker_contaminated` → `breaker_contaminated` |
| 503 | `config_storage_unavailable` → `storage_unavailable`; `measurement_memory_unavailable` → `memory_sample_unavailable` |
| 504 | `measurement_deadline_exceeded` → `sample_deadline` |

### 3.2 Exact state machine

The fixed five-round table in §8 expands to steps 0–39: four profiles × miss/hit × five rounds.
Server and runner use the same literal table, independently tested against the expected sequence.
Only one campaign may own the dedicated process at a time; other tabs receive `campaign_busy`, never
reset/end the owner. This explicit collision behavior protects tracemalloc and shared HTTP resources.

| Transition | Enforced behavior |
| --- | --- |
| Begin | After guards, acquire a provisional exclusive lease and private transport BEFORE token materialization or sprint validation. Validate existing config/source, refresh token through auth owner, capture final identity, validate sprint, then mint/publish id. On failure destroy provisional state and release lease after I/O returns. Never replace another campaign. |
| Reserve next step | Exact next integer, no pending step, matching owner/signatures; record profile/cache mode from server table. Request input cannot select them. |
| Candidate sample | Only one POST for the reserved candidate step; two child workers maximum; duplicate/replayed sample fails before Jira. |
| Legacy pair | For reserved legacy step only, accept exactly one Product and one Tech GET, concurrently. Verify entire query against descriptor (timestamp may be a bounded integer; omit sprintName/purpose/epicKeys); no arbitrary scope fields. Install campaign transport before any Jira read, including enrichment workers; every worker explicitly receives transport and captured auth. Unsupported propagation is a stop, never global fallback. |
| Finish | Candidate or both legacy responses must have completed successfully server-side; runner finishes only after full parse. Advance exactly once. Never advance after error, abort, stale auth or malformed data. |
| End | Only after all 40 steps; return acknowledgement, then destroy rows/caches/HMAC/counters/lease. Runner downloads completed result only after acknowledgement. |
| Expiry | Sliding 1,800-second TTL, refreshed only on valid successful control/sample completion; the nominal five-round bound is 40 × 30 seconds plus begin/end (≤60 seconds), below this TTL even without renewal. This excludes unbounded cooperative I/O, which retains a cancelled lease rather than being called completed. Invalid probes do not extend TTL. Sweep every 30 seconds AND at every entry, independent of another user request. |
| Abort/close | Mark cancellation before cleanup; abort queued work and request bodies, disallow publication, destroy private data after in-flight work relinquishes it. Browser best-effort abort POST has its own 5-second budget/fresh CSRF; no unload beacon without CSRF. TTL is fallback. |
| Two-tab collision | Tab B begin returns busy with no A changes. B cannot use A's id unless it possesses it; random ids are capabilities bound to authenticated owner, not tab fingerprints. No cross-tab storage/broadcast. |
| Auth loss | Stop without replay; sanitize to oauth_unavailable, abort remaining browser work, expire private state. Auth responder remains unchanged. |
| Config/source/token drift | Re-read before every reserve/sample and after work/before finish; discard result and stop. Successful initial refresh establishes final token version; later rotation is stale, not a new warm identity. |
| Data drift | Compare private normalized content and membership digests against prior cold sample for that profile; stop content_drift or membership_drift. |
| Warm mismatch | Require exact immediately preceding cold entry; stop cache_miss instead of fetching replacement data. |
| Retry / 429 / breaker | Follow §5; a 429 stops campaign after recording counters. Any shared-breaker touch or unbound worker stops breaker_contaminated. |

Expired/cancelled campaigns with unreturned I/O retain only a cancellation tombstone/lease, never
start another sample over those resources. A new begin remains busy until workers and tracing release.
This is an explicit limitation of cooperative cancellation, not a claim that TTL kills blocked I/O.

## 4. Scope and production projection

### 4.1 Immutable configuration and authorization limits

Capture after auth-owned token materialization: workspace/user/connection/browser session/cloud/token
version/access snapshot; uncached dashboard source/revision/digest; existing group revisions/digests;
selected project mapping; Component strings, all saved Teams, Board/status/retention; field/type
catalog snapshots. Workers receive immutable inputs and captured auth only, no Flask globals or
configuration getters. Revalidate uncached DB source/revisions/content and auth before publication.
Do not call `jira_server.load_dashboard_config_snapshot` for this diagnostic: even its DB mode can
fall back to JSON. A source change is configuration drift even when payload bytes match.

| Production scope | Spike treatment / authorization |
| --- | --- |
| Saved Component Board, selected sprint and All work | Measure both with exact-name broadcast policy and effective retention 28; only this shape can support a later restricted conclusion. |
| Saved no-Component Board, all saved Department Teams, selected sprint | Measure distinct group; private Team selection excluded. |
| `other` classification or mixed mapped/unmapped projects | Reject preflight; zero authorization from this campaign. |
| No saved Board / synthetic All epics | Reject preflight; production remains supported only after a separate amended measurement profile/gate. |
| No selected projects / saved Jira Board project fallback | Reject preflight; production fallback needs its own measured gate. |
| Retention 1–27 or 29–90, empty terminal status set | Reject using RAW stored group JSON before current normalizer strips fields; absent or explicit 28 only, nonempty terminal statuses. Full range and no-status path need later measured gates. |
| Basic auth, multi-worker deployment, process/OAuth/TLS/Jira first load | Outside evidence; no authorization. |

No production plan can treat a successful subset as proof for excluded paths. Before enabling the
full settled support design, extend the campaign and rerun gates for every excluded scope.

Normalize selected project keys uppercase and types to `product|tech|other`; legacy strings/missing
type mean Product. Reject conflicting duplicate mapping, empty selection or `other`. Require both
Product and Tech children in every candidate profile to support a two-lane conclusion.

Component policy is intentionally **exact-name broadcast**: each saved string selects every
same-named Component across ALL server-selected projects; it does not identify a Component in one
project. Do not resolve to the first matching id. Record only
`componentNamePolicy="broadcast_exact_name"` in the campaign. Tests with the same name in two selected
projects admit both, exclude an unselected third, and prove browser-supplied Components/project ids
are rejected. Project-qualified Component configuration remains a separate storage design, never an
inferred browser scope or a conclusion from this spike.

Resolve `/rest/api/3/issuetype` and `/rest/api/3/field` through isolated current-user GETs. Eligible
children have `hierarchyLevel=0` and `subtask=false`. Absent issueTypes means `['Story']`; explicit []
means every eligible type. Nonempty names resolve ALL exact-name eligible ids; missing/ambiguous
hierarchy fails. Sprint/SP/Team/Project Track defaults are `customfield_10101`, `customfield_10004`,
`customfield_30101`, `customfield_35024`; Delivery Owner is optional without a default. Validate
`customfield_<digits>`. Resolve Epic Link by stable schema/id, then a unique eligible name only if
schema unavailable; zero fields selects parent-only JQL; ambiguity fails closed.
Move the column containing exact Done to the end in memory, otherwise preserve final stored column
as terminal. Preserve every unrelated saved field and never persist normalization.

### 4.2 Epic index query

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

### 4.3 Direct-child queries

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

### 4.4 Exact contextual legacy Board union

Run the actual two legacy GETs using the server descriptor, `team=all`, Product/Tech lanes and the
saved Component group's full Team ids/label mapping, selected sprint, default dashboard purpose,
no private Team/filter/search state, and no arbitrary detail-only additions. Fix showTech on and
all display/facet filters neutral for this contextual denominator. Capture both responses, then:

1. Apply `engTaskUtils.filterTasksForTeamSet` to each `issues` list. Stable-deduplicate by normalized
   issue key, Product then Tech; conflicting duplicates stop `candidate_incomplete`.
2. Filter each `epics` dictionary to `fields.epicKey` references from its filtered issues using
   `filterEpicsByTaskEpicKeys`. Merge Product then Tech; conflicting normalized Epic data stops.
3. Filter each `epicsInScope` by `filterEpicsInScopeForTeamSet`: no saved Teams means empty; otherwise
   absent teamId, saved Team membership, or a case-insensitive saved group Epic label admits it.
   Union Product then Tech by key (first wins, as dashboard does).
4. Apply `dashboard.jsx::groupTasksByEpic` and `engBoardFilters.mergeBoardEpicGroups`: child groups
   use `fields.epicKey`, missing is NO_EPIC; attach matching detail; add filtered scope Epics absent
   from groups; prefer existing detail over scope Epic; remove groups with no Epic. A dictionary
   detail alone never creates a visible group. Do not count orphan children hidden by that removal.
5. `epicCount` is distinct visible group keys; `childCount` is distinct children in those groups.
   `legacyDenominator=epicCount+childCount`; duration per 100 is null for denominator zero,
   otherwise `100*wallMs/legacyDenominator`. Test with overlaps, orphans, filtered Teams, scope-only
   Epics and detail-only keys against the production pure helpers using sanitized fixtures.

This fixes the union grammar; it does not prove equality with Component scope. The runner cannot
submit Jira keys to the diagnostic. Set `legacyComparison="context_only"` for every campaign.
No speedup/regression/equivalent-work claim is allowed, even for equal counts. Exact private-set
comparison would need an amended server-owned comparison contract and tests, not an equality-of-counts
shortcut. `legacyCapped=true` if either response has numeric total greater than returned `issues`
or returns at least 250 issues. Capped legacy may remain contextual only. Its cache-hit status is
unverified: cold means requested refresh, warm means no refresh, never proven application cache hit.

## 5. Budget, retries and isolation

### Cooperative deadline: explicit limit on the evidence

Use a monotonic budget object with `expiresAt`, cancellation flag and `remaining()`; negative/zero
remaining raises one internal deadline exception before further work/publication. Start the browser
30-second step budget BEFORE reserve-CSRF, keep it through reserve, candidate-CSRF/candidate or
legacy pair, response-body parse and finish-CSRF/finish. The server reserves its own 30-second budget
when accepting reserve. Browser time includes the earlier guard/CSRF interval; the service cannot
observe that interval. Control/options/begin have separate 30-second browser budgets; abort has 5.
Do not reset a step deadline per subrequest, retry, chunk or sibling. `wallMs` uses this whole browser
step interval; reserve/finish overhead is intentionally included in every profile's thresholds.

**No hard bound is claimed in this revision.** Existing DB connection/pool/query/row-lock waits,
HTTP DNS/TLS/body internals, token cryptography, Flask guards, DB commit/rollback and Python/browser
scheduling cannot all be preempted by this file map. In particular a Requests inactivity timeout is
not a total deadline, and AbortController cannot kill server I/O. Do not add DB engine-wide timeout
changes, detached Future timeouts, killed OAuth refresh processes or an alternative token owner to
make this look bounded. Every completed campaign states `deadlineMode="cooperative"`; §8 forbids PASS
regardless of fast timings. A hard-bound implementation needs a separately reviewed file-map
amendment covering DB acquisition/statement/lock limits, full-body/network cancellation and auth-safe
cleanup, plus real blocked-row/trickle-body tests. A boolean supplied by the runner cannot unlock it.

| Boundary | Required implementation in this spike | Verification / residual bound |
| --- | --- | --- |
| Guards, DB acquisition/query/row lock, token read/refresh/commit | Check budget immediately before/after through `jira_server.db_oauth_session_data_for_auth_context`, `db_tokens.db_oauth_session_data` and `refresh_db_oauth_token`; preserve auth-owned transactions and refresh locking. Never publish after late return. | Latch a fake acquisition/query/row lock then release after expiry: no later Jira/cache/result. `tests/test_token_refresh_race.py::test_concurrent_refresh_serializes_against_postgresql` remains required with an actual test PostgreSQL target (skip is not proof). These waits remain unbounded; always non-PASS. |
| Jira attempt | Optional diagnostic transport recomputes `(min(connect_default,remaining), min(read_default,remaining))` per attempt, not once. Use streamed responses, count chunks and close in finally; check before/after each read and JSON parse. | Trickled local HTTP server with controlled final release demonstrates deadline checks and late-drop; explicitly do not assert a wall bound on a blocked chunk/DNS/TLS read. |
| OAuth refresh | Carry same budget to `request_oauth_refresh_token`, cap connect/read timeout, consume full body under the same checks; check after decrypt, provider response and DB commit. No diagnostic token cache. | Expired-token real-wrapper test plus slow refresh-body fixture; auth errors preserved, defaults unchanged. Refresh must finish its auth-owned transaction; never retry the browser write. |
| Retries/backoff | At most 4 attempts, 10-second retry elapsed allowance further capped by remaining step time; sleep no longer than remaining, cancellation-aware wait. Check immediately after sleep. | Fake clock/sleep, timeout then 503 then success accounting; exhausted/deadline case returns no rows. |
| Rate limit | Count 429 and its consumed bytes; stop without retry, cap/record parsed numeric Retry-After in [0,30] seconds, never save raw header. | 429 on catalog/search/legacy/refresh, malformed header and no automatic next step. |
| Siblings | First fatal failure sets cancellation before join; cancel queued batches and close owned streams; check after in-flight return. Do not finish/counter-publish while siblings run. | Barrier: one fails while another stalls; late sibling cannot publish. Lease stays busy until released. |
| Browser | One AbortController per step inherited by reserve/CSRF/candidate/legacy/finish, timeout through full body reads; pair failure aborts sibling immediately. Avoid `Promise.all` alone without shared cancellation. | Real browser stalled CSRF, candidate body, legacy Product and Tech body, finish; no warm/next step or raw error download. |

### Diagnostic Jira transport ownership

Create `DiagnosticJiraTransport` in the runtime module, including provisional begin validation, with one campaign-private
`JiraCircuitBreaker`, cancellation budget and locked numeric observer. `current_jira_get/search`
accept an optional diagnostic transport and inherit it from the validated ContextVar for tagged
legacy requests; explicit argument wins. The dev route passes it explicitly to every candidate
worker. Bind/unbind with `try/finally` in the guard/teardown hooks. Ordinary calls with no binding
keep their exact existing behavior. Strict OAuth default legacy enrichment is sequential today
(`jira_server.fetch_tasks`); test that every `jira_search_request` in its enrichment reaches the bound
transport. A new worker must capture/pass it; no implicit ContextVar thread inheritance assumption.

The guard accepts diagnostic headers only for the exact reserved legacy route, owner, step and
server descriptor. Wrong route/owner/query/step fails before upstream work. Without diagnostic
headers, ordinary traffic on this dedicated instance is rejected with fixed `measurement_campaign_busy`
while the campaign lease is active, except the control/CSRF/auth recovery/health paths. Serve runner/options/assets only when no step
is reserved; their allocation would contaminate an active sample. Abort/auth recovery invalidates
the current sample before allocating unrelated work.
Do not let a browser spoof diagnostics in hosted or Basic mode. Teardown clears binding even on
401/exception/aborted response; the next ordinary request must use its normal transport.

Begin preflight, candidate and tagged legacy calls must never call `before_request`, `record_success`,
`record_failure`, `force_open`, or `reset` on `JIRA_SEARCH_CIRCUIT_BREAKER`. Tests patch all five to
raise, force its state open, run successful diagnostic requests through real wrappers, and assert
state unchanged. Each campaign starts its private breaker closed; its actual open/fast-fail state
is counted and stops the campaign. Never silently reset a breaker to obtain a warm sample. Any
missing isolation/observer binding is `measurement_breaker_contaminated`.

Observer counters cover EVERY physical attempt (including failure) beneath current-user wrappers,
not merely accepted pages. Count Jira GET and OAuth refresh separately; never count token endpoint
bodies as Jira bytes and never persist refresh bodies. All retry logs in diagnostic mode use only
fixed enums/counts; suppress existing dynamic URL/JQL/sprint messages for tagged legacy calls.
Do not capture the local server console as an artifact. No behavior change to ordinary logging.

## 6. Pagination, cache, stability and memory

Strict search is `nextPageToken`/`isLast`, page size 100. Require object, bounded `issues`, boolean
isLast, new nonempty token on non-final pages, no duplicate normalized issue keys, no contradictory
terminal token, no malformed projection. Empty non-final pages continue. Fail the entire sample on
any page/batch error; forbidden helpers are `jira_client.fetch_issues_by_jql`,
`jira_client.fetch_issues_by_keys`, `jira_server.fetch_epic_details_bulk` for candidate work.
Legacy may use its existing partial helpers only with `legacyComparison=context_only`.

Limits: 1,000 unique candidate Epics before sprint qualification, 10,000 fetched unique children
before discarded/retention filtering, 101 pages per logical search, 2,600 accepted search pages per
sample, 40 Epic keys per batch, two concurrent child searches. Use synchronized counters across
workers. Exactly a count limit is legal only on a final page. Every fully URL-encoded search params
string (JQL, fields, maxResults, token) must be ≤7,000 UTF-8 bytes; split child batches before sending,
fail unsplittable queries. Test exact/one-over all limits, token growth and races. No retry resets
these counters. A logical page is not counted twice when retried. `jiraBatchCount` counts each distinct child Epic-key
batch or fallback Epic-fetch key batch started once, independent of its pages/retries;
`maxBatchesPerColumn` counts child batches for one column, and `maxPagesPerSearch` counts accepted
pages in one logical paginated search. `maxConcurrency` counts simultaneous child searches only.

A pure projection function owns the deterministic Epic shell/child fields in §4.2–4.3 and their
placement. Use compact sorted-key UTF-8 JSON (`ensure_ascii=False`, `allow_nan=False`, separators `,`/`:`)
with finite numbers only, normalized key ordering and
stable array ordering where semantically unordered. Keep semantic order for columns/sprints where
rendering depends on it. Include Epic/child identity, parent/Epic Link precedence, Initiative data,
column/status, classification, SP, priority, assignee, Team, Sprint, Project Track, Delivery Owner,
updated and all displayed fields. No omitted production field may be added later without remeasurement.
`shapedResponseBytes` is this complete projection's serialized length, excluding diagnostic metrics,
cache wrappers and transport framing. Count fetched versus qualified rows separately.

Bootstrap scheduling uses saved star, otherwise first configured column, then every remaining
column in normalized order (Unmapped immediately before terminal). Do not read private restored UI
focus or move bootstrap after qualification. Complete its children before scheduling the rest;
selected-sprint rows fetched during qualification are reused. `bootstrapColumnReadyMs` is explicitly
not the production `resolveFocus` readiness metric. An empty bootstrap column remains measurable but
cannot satisfy the populated-bootstrap coverage requirement.

### Cache states

- Candidate cache key: campaign id plus workspace/user/connection/browser-session/cloud/token version,
  known access snapshot, config source/revisions/digests, group, project mapping, field/type catalogs,
  Component policy/names, Teams, Board/retention, profile and sprint. Maximum 8 entries, 5-minute
  per-entry TTL, 32 MiB total deterministic projection bytes, LRU; single oversize entry stops.
- Metadata cache: separate campaign-private LRU, 4 entries, 5-minute TTL, 2 MiB total canonical catalog
  JSON bytes; same auth/access partition. Fields and issue types are one bundle. Single oversize stops.
- Each candidate cold step bypasses/replaces its exact candidate AND metadata bundle. Report
  `candidateCacheState=miss`, `metadataCacheState=miss`; issue-type and field catalog calls must occur.
  This measures application-owned cache misses in an already running/authenticated process only.
- Immediate candidate warm step must hit BOTH compatible entries, otherwise STOP cache_miss. No Jira
  or OAuth refresh is allowed on a successful warm hit (DB token validation remains measured).
  Report fresh timings/counters, never replay cold durations or Jira counts; reuse only shape/counts.
- Legacy reports `candidateCacheState=not_applicable`, `metadataCacheState=unverified`, and
  `cacheIntent=refresh|reuse`; do not infer hits from timings. Candidate also records cacheIntent.
- Never clear/invalidate TASKS_CACHE or another user/scope to fake coldness. Preflight/OAuth/DB pools,
  TCP/TLS, HTTP sessions and Jira caches are not reset; no process/first-load claim is permitted.
- Atomic cache publication only after config/auth/source/drift/budget checks; failures never return
  stale as fresh. Candidate data and metadata are destroyed on end/abort/expiry. No persisted diagnostic cache.
  The contextual legacy endpoint retains its existing TASKS_CACHE behavior; cleanup never clears
  application caches or treats them as campaign-owned state.

### Stability

Use a fresh random private HMAC key per campaign. For each profile, round 1 cold establishes two
private baselines: normalized key membership and canonical production projection PLUS configured
column membership/classification. Round 2–5 cold compares with previous successful cold for the same
profile. `membershipStable` and `contentStable` expose booleans only; warm copies its paired cold's
booleans and canonical shape/counts. A changed same-key parent, status, SP, summary, classification,
column or serialized byte length stops content_drift. No digest, Jira key or raw value leaves process
memory. Stable samples are bounded observation, not an atomic Jira snapshot or guarantee against an
unobserved edit-and-revert between requests. Selected and All-work projections need not equal.

### Memory ownership

Acquire process-wide sample exclusion before tracing. If tracemalloc is already active, return
memory_sample_unavailable without resetting/stopping the other owner's tracing. Start and own it
before the immutable sample snapshot is allocated, collect `baselineCurrent`, then reset peak.
Measure after shaping AND successful candidate/metadata cache publication, release transient rows,
run one explicit GC (included in timings), then collect `retainedCurrent,peak`. Record
`memoryPeakDeltaBytes=max(0,peak-baselineCurrent)` and
`memoryRetainedDeltaBytes=max(0,retainedCurrent-baselineCurrent)`. Peak must be ≥ retained delta.
Also record absolute `candidateCacheBytes` and `metadataCacheBytes` after publication; retained delta
can be zero when refresh replaced an equal-sized entry. Serialized bytes are not Python heap size.
Finally stop tracing only if this sample started it, including all exception paths; memory is Python
traced allocations only, not process RSS/native HTTP/TLS buffers. Warm baseline includes its cached
objects; do not present warm allocation delta as total resident memory. No other request or sample
may overlap measurement; reject contamination, never turn it into zero memory cost.

## 7. Closed result schema and checker

Version 2 replaces version 1; the checker rejects v1 rather than guessing missing fields. Define
all shapes as exact-key schemas, finite nonnegative numbers (counts/bytes are integers, bool is not
an integer), fixed enums and explicit nulls. No timestamps, free text, environment/tenant labels,
identifiers, hashes, names, JQL, URLs, headers, credentials or raw Jira/refresh data in saved output.

Completed file: `{schemaVersion:2,result:"complete",deadlineMode:"cooperative",
configSource:"workspace_db",componentNamePolicy:"broadcast_exact_name",
authorizedScope:"configured_product_tech_28d",legacyComparison:"context_only",rounds:[...]}`.
`authorizedScope` names the tested subset, not permission to deploy. Round is exactly `{round,samples}`;
five rounds 1–5, eight samples each in §8 order. A sample is exactly:

```text
{profile, cacheIntent, candidateCacheState, metadataCacheState, result:"success",
 metrics:{wallMs,indexReadyMs,bootstrapColumnReadyMs,fullReadyMs,
 stageMs:{config,cache,epicIndex,sprintMembership,bootstrapChildren,remainingChildren,shape,total},
 serverTimingMs:{config,cache,epicIndex,sprintMembership,bootstrapChildren,remainingChildren,shape,total},
 candidateEpicCount,epicCount,fetchedChildCount,childCount,bootstrapChildCount,
 productChildCount,techChildCount,otherChildCount,projectCount,componentCount,teamCount,columnCount,
 terminalEpicCount,unmappedEpicCount,emptyEpicCount,maxPagesPerSearch,maxBatchesPerColumn,
 jiraLogicalRequestCount,jiraCatalogCallCount,jiraSearchCallCount,jiraPageCount,jiraBatchCount,
 jiraAttemptCount,jiraRetryCount,jiraFailureAttemptCount,jiraRateLimitCount,jiraFastFailCount,
 jiraRetrySleepMs,jiraRetryAfterMs,jiraResponseBytes,jiraFailedResponseBytes,oauthRefreshCount,
 oauthAttemptCount,oauthRetryCount,oauthRateLimitCount,
 shapedResponseBytes,candidateCacheBytes,metadataCacheBytes,maxBatchSize,maxConcurrency,
 maxEncodedRequestBytes,memoryPeakDeltaBytes,memoryRetainedDeltaBytes,
 metricAvailability,legacyCapped,legacyDenominator,complete,membershipStable,contentStable,
 ceilingHeadroomLow}}
```

Profiles are `legacy_selected_sprint`, `candidate_selected_sprint`, `candidate_all_work`,
`candidate_team_fallback_selected_sprint`. Candidate response metrics.wallMs and serverTimingMs are
null on wire; runner fills only those fields from monotonic step duration and parsed allowlisted
response header. It never changes other candidate fields. Finish transport counters must agree with
candidate sample counters; candidate/legacy finish includes the numeric upstream-counter subset
from jiraLogicalRequestCount through oauthRateLimitCount (jiraBatchCount is null for legacy).
No control call performs Jira work during a reserved sample except its own auth subsystem.
Count such auth attempts at the campaign-step observer; emit final counters on finish, and require
zero additional refresh since candidate/legacy body response or stop oauth_unavailable. Initial
refresh occurs before begin's immutable identity; a mid-step refresh is stale, never a successful hit.

Legacy fills wallMs, epicCount, childCount, legacyDenominator, legacyCapped, instrumented upstream
counters from finish, `metricAvailability=legacy_partial`; EVERY other metric is null. Candidate
uses `metricAvailability=complete`, legacyCapped=false, legacyDenominator=null, all booleans true
except ceilingHeadroomLow, and all other numeric/object fields populated. Candidate otherChildCount
must be zero. Counts do not reveal raw keys/names. `cacheIntent=refresh|reuse` is table-driven.

Bytes and retry equations:

- A logical request is one catalog operation or one requested search page; catalogCount +
  searchCallCount = logicalRequestCount, and successful candidate pageCount = searchCallCount.
- `jiraAttemptCount = jiraLogicalRequestCount - jiraFastFailCount + jiraRetryCount` when every started
  logical call is finished; in stopped context report raw observed counters without inferring a
  completed equation. A fast-fail is one logical operation with zero physical attempts.
- A retry is a physical attempt after the first in that same logical operation; failureAttemptCount
  counts each timeout/connection/non-2xx/invalid-body physical attempt. Never count scheduled but
  cancelled retries as attempts. 429 count ≤ failureAttemptCount ≤ attemptCount.
- `jiraResponseBytes` sums decoded HTTP entity-body chunk bytes actually consumed over ALL Jira
  attempts, including failed/partial bodies and catalogs, excluding HTTP headers/TLS/compressed-wire
  overhead. `jiraFailedResponseBytes` is the failed-attempt subset. A zero-byte connection failure
  contributes zero. OAuth bodies contribute to neither. Partial consumed bytes still count on stop.
- OAuth counters count physical refresh POST attempts separately; current refresh has no retry,
  so oauthRetryCount=0. Any future retry needs a plan amendment. RateLimitCount ≤ AttemptCount.

Stages are exclusive wall-clock spans: config (fresh DB snapshot/catalog validation), cache lookup,
epic index, sprint qualification, bootstrap children, remaining children, shaping/cache publication/
GC. Overlapping worker durations are not summed; each span measures the enclosing phase. Reused
qualification rows do not also add time to child-fetch spans. `total` runs from service entry through
final validation/publication/memory capture. The sum of non-total stages is ≤ total plus 1 ms rounding;
overhead/lock/auth time is in total. Use 0.1 ms rounding throughout. Header tokens are exactly
`config`, `cache`, `epic-index`, `sprint-membership`, `bootstrap-children`, `remaining-children`,
`shape`, `total`, each once, numeric dur only, no desc. Map these to the eight camelCase fields.
Reject missing/extra/duplicate tokens and any body/header difference >0.1 ms; this tolerance is
serialization rounding, not a percent allowance. Body has serverTimingMs=null until runner parses.

Checker invariants, each with a one-field corruption test:

- All shapes/enums/order/nullable ownership above; no unknowns, NaN, infinity, negative or bool-as-count.
- `0 ≤ indexReadyMs ≤ bootstrapColumnReadyMs ≤ fullReadyMs ≤ stageMs.total ≤ wallMs + 1` for candidate.
  Warm index/bootstrap/full are fresh readiness timestamps, never cold replay.
- `epicCount ≤ candidateEpicCount ≤ 1000`; `bootstrapChildCount ≤ childCount ≤ fetchedChildCount ≤ 10000`;
  `productChildCount+techChildCount+otherChildCount=childCount`; zero other; empty/terminal/unmapped
  Epic counts individually ≤ epicCount; `maxConcurrency≤2`, maxBatchSize≤40, request bytes≤7000,
  maxPagesPerSearch≤101, pageCount≤2600, nonzero batch implies nonzero search calls.
- Cold catalogs=2, maxPagesPerSearch≥1, jiraSearchCallCount≥1, jiraBatchCount≥1; warm logical/catalog/search/page/batch/attempt/retry/failure/429/fast-fail/bytes/sleep/
  refresh counts all zero; both warm caches hit; warm shape, cardinality and byte size equal cold.
  Coverage maxPagesPerSearch/maxBatchesPerColumn on warm are zero because no work ran; maxima used
  for coverage come only from cold, not replayed counters.
- `jiraFailedResponseBytes≤jiraResponseBytes`; retry/attempt equations above;
  peak≥retained; caches ≤32 MiB/2 MiB; positive qualified projection has positive shaped bytes.
- `complete`, membershipStable, contentStable must be true for candidate; headroom equals
  `(candidateEpicCount≥800 or fetchedChildCount≥8000)`, never trusted as an arbitrary boolean.
- No inference that equal legacy/candidate counts prove equivalence; denominator/time normalization
  defined only in §4.4. No legacy metric can fill a candidate coverage/deadline gate.

Stopped file is exactly:

```text
{schemaVersion:2,result:"stopped",stopCode,context:{round,step,profile,phase,limit,observedBucket,
 elapsedMs,jiraAttemptCount,jiraRetryCount,jiraRateLimitCount,jiraRetrySleepMs,
 jiraFailedResponseBytes,jiraFastFailCount,oauthAttemptCount,oauthRateLimitCount},rounds:[]}
```

Never save partial successful samples on stop. `round=0`/`step=-1` and profile=none identify preflight;
otherwise round 1–5, step 0–39 must agree with the order table. `phase` is one of
preflight/auth/config/reserve/cache/catalog/index/qualification/bootstrap/remaining/shape/body/finish/
cleanup. `limit` is none/epics/children/pages/batches/url_bytes/candidate_cache_bytes/
metadata_cache_bytes/deadline/memory. `observedBucket` is unknown/zero/below_80/near_limit/at_limit/
over_limit; server computes it relative to the numeric ceiling (near_limit = ≥80% and below limit).
Unavailable numeric context is null, never invented zero. Field/schema drift with no ceiling has
limit=none and bucket=unknown. Both route-owned errors and runner stops use this exact context.

Stop codes are oauth_unavailable, csrf_unavailable, invalid_scope, invalid_campaign, campaign_busy,
campaign_expired, user_aborted, configuration_drift, membership_drift, content_drift, cache_miss,
rate_limited, breaker_contaminated, scope_ceiling, candidate_incomplete, jira_rejected,
storage_unavailable, memory_sample_unavailable, unrepresentative_scope, sensitive_output,
sample_deadline, deadline_bound_unproven. Do not embed upstream status strings or raw error text.
Client abort uses user_aborted; timeout uses sample_deadline, and maps to FAIL as specified below.

## 8. Campaign coverage and verdict

| Round | Profile order (each refresh immediately followed by reuse) |
| --- | --- |
| 1 | legacy selected sprint → candidate selected sprint → candidate All work → candidate Team fallback |
| 2 | candidate selected sprint → candidate All work → candidate Team fallback → legacy selected sprint |
| 3 | candidate All work → candidate Team fallback → legacy selected sprint → candidate selected sprint |
| 4 | candidate Team fallback → legacy selected sprint → candidate selected sprint → candidate All work |
| 5 | legacy selected sprint → candidate Team fallback → candidate All work → candidate selected sprint |

Paint running state before I/O. Fetch distinct fresh CSRF token for every POST, including controls;
never reuse consumed tokens or auto-replay after 401/403. Require both caches for candidate reuse.
Drop raw response rows after transient aggregation; no console/storage/download/network telemetry
of labels, issue bodies or secrets. Local JS imports no product analytics library.

Coverage is mandatory before timing interpretation, for EVERY cold candidate sample:

- candidateEpicCount≥1, epicCount≥1, childCount≥1 and bootstrapChildCount≥1;
- Product and Tech child counts both ≥1;
- at least one candidate profile in EACH round has maxPagesPerSearch≥2 OR maxBatchesPerColumn≥2;
- at least one cold profile in EACH round actually reaches maxConcurrency=2; otherwise concurrency
  conclusions are forbidden and this campaign is unrepresentative;
- All-work cold profile has terminalEpicCount≥1 and unmappedEpicCount≥1 in EACH round, so history
  retention and Unmapped shaping affect observed work. Zero-child All-work support remains a valid
  production behavior, but needs a synthetic test; it cannot alone satisfy workload volume.

Configuration-valid but zero/trivial/non-exercised workload yields `STOP unrepresentative_scope`.
Do not seed/mutate real Jira or configuration to fabricate coverage. A different existing Department
may be selected by starting a new campaign. Record counts only, never names/keys.

Checker order is deterministic:

1. Malformed/sensitive schema → `STOP invalid_campaign` / `STOP sensitive_output`.
2. Valid stopped envelope → `FAIL sample_deadline` for that code, otherwise `STOP <stopCode>`.
3. Completed but coverage invalid → `STOP unrepresentative_scope`; shape/cache/drift invariant errors
   → `STOP invalid_campaign` before coverage; any actual 429/fast-fail/isolation fault must have
   stopped online and cannot be represented as complete.
4. For representative complete campaigns, apply performance FAIL in order: any cold candidate wall
   >6,000 ms → `FAIL cold_candidate_max`; All-work cold median >3,000 ms →
   `FAIL cold_all_work_median`; any candidate profile warm median >1,000 ms →
   `FAIL warm_candidate_median`.
5. Otherwise **always `STOP deadline_bound_unproven`** for schema v2 cooperative mode. There is NO
   reachable PASS path in this revision. Reject another deadlineMode as malformed, not as permission
   to pass. Fast timings remain characterization only. Hard-bound evidence and expanded scope gates
   require a reviewed schema/plan amendment before any `PASS aggregate_viable` is legal.

Five observations support median/max only, not p95. Low headroom (≥80%) requires user review and a
larger representative scope before production authorization even after a future hard-bound PASS. Internal
index/bootstrap/full timings cannot prove visible first content, 100-ms loading feedback, or the
≤10% selected-sprint UI regression gate. Those remain production tests after transport selection.

## 9. Ordered implementation and verification tasks

### Task 0 — Verify instructions, file map and gate status

- [ ] Read the instruction chain for every Modify/Create parent and verify all map paths marked
  Modify/verification-only exist. Use the existing checkout on the requested feature branch.
- [ ] Sweep every `GATE-*.md`; only run a live probe with its required approved target/inputs. Record
  Checked on/Last result, never invent PASS. Review MRT004, MRT010 and MRT023.
- [ ] Run full Python baseline before implementation; retain failures as evidence, not a plan fix.

### Task 1 — RED/GREEN: security, existing-row preflight and campaign sequencing

Files: shared-group helper, dev routes, policy/guards, new measurement tests, shared-group DB,
endpoint matrix and DB OAuth tests in §2. Add the tests first and observe failure before implementing:

- [ ] `test_options_missing_shared_row_never_creates_it`: insert dashboard only, assert group row
  count=0; GET options, begin and rejected candidate all leave count=0 and call no ensure/load/save/
  audit/migration writer (patch those symbols to raise). Saved-empty row remains unchanged; missing
  dashboard with legacy JSON present still fails source. Two-workspace tests forbid foreign ids.
- [ ] `test_all_diagnostic_methods_require_exact_local_policy`: all four diagnostic paths and methods,
  including HEAD/OPTIONS and runner JS; no flag, remote address, hosted, Basic/pre-DB token store,
  missing/revoked/disabled/stale DB session, requested-with and spent/wrong CSRF cases.
- [ ] `test_config_source_and_raw_retention_revalidated`: same payload with source changed, revision
  changed, deleted/recreated rows, raw retention 1/90 before lossy normalizer, empty terminal statuses,
  synthetic Board, fallback-only/other projects; no Jira/cache writes on rejection.
- [ ] `test_campaign_sequence_and_two_tab_lease`: server table 0–39, duplicate/reserve/finish/replay/
  wrong profile route/foreign id/out-of-order end, A active+B begin, A end cannot be replayed on B.
  Fake monotonic clock proves 1,800-second sliding expiry, invalid requests do not extend, 30-second
  sweeper cleanup without another request, abort/end release and blocked-I/O tombstone stays busy.
  Start the sweeper only with the first provisional begin lease and stop it after cleanup; importing
  the runtime cannot start a thread or add production startup work.
- [ ] Add `require_existing_shared_groups_snapshot(context, *, database_url=None)` using a read-only
  SELECT of `WorkspaceGroupConfig`, raising a fixed missing-row error and returning raw payload,
  revision/source plus in-memory validated groups. No fallback creator. All other shared-group
  callers remain unchanged.
- [ ] Implement exact endpoint adapters/policies and reserve/finish validation. Normalize errors
  through one closed constant map (§3/7). Missing functions are deliberately Create work, never an
  assumption that a helper already exists.

Run `.venv/bin/python -m unittest tests.test_eng_board_measurement tests.test_shared_group_config_db
 tests.test_endpoint_security_matrix tests.test_db_oauth_cutover` (one shell line). Expect all pass
before Task 2. The new tests must fail before their implementation, not merely match source prose.

### Task 2 — RED/GREEN: cooperative runtime, auth and retry observer

Files: new runtime, current-user wrappers in jira_server, Jira client, jira_auth/db_tokens, guards,
resilience/auth/OAuth tests plus measurement tests in §2.

- [ ] `test_trickled_body_cannot_publish_after_budget`: controllable local HTTP server feeds chunks
  below inactivity timeout then releases a blocked read after budget; assert late failure, consumed
  byte accounting, stream closed and no cache. This test does NOT assert unimplemented preemption.
- [ ] `test_late_db_acquisition_query_and_refresh_lock`: independently latch each wait and release
  after budget, prove no next operation/publication; run real existing PostgreSQL refresh-lock
  coverage with an approved disposable test PostgreSQL target separately; a skipped test is not proof. Test successful expired-token refresh before begin capture and revocation
  during sample. Preserve DB refresh reuse audit/revocation behavior.
- [ ] `test_retry_observer_equations_and_429_stop`: timeout→503→200, 429 no retry, broken JSON,
  empty/partial failure body, private fast-fail, bounded sleep, exception teardown and defaults with
  omitted diagnostics. Count physical attempts below resilient adapter; no double-counted pages.
- [ ] `test_real_worker_jira_wrapper_ignores_global_breaker`: patch every global breaker method to
  raise, set its state open, call real wrappers outside request context with captured OAuth and
  explicit transport. Tagged legacy OAuth requests must cover its main, Epic-detail and scope-Epic
  Jira searches through real `jira_search_request`; no ordinary request inherits binding afterward.
- [ ] `test_sibling_failure_cancels_before_join`: deterministic barriers prove pending sibling cannot
  publish into cache/finished step, even when it ignores cancellation until released.
- [ ] Implement optional diagnostic transport/budget/observer propagation exactly in the named seams.
  Never add a default-path budget, auth fallback or DB engine timeout. The runtime and tests must
  explicitly report cooperative mode and preserve its unreachable-PASS contract.

Run `.venv/bin/python -m unittest tests.test_jira_resilience tests.test_jira_auth
 tests.test_oauth_jira_client tests.test_db_oauth_cutover tests.test_eng_board_measurement`.
Expected all pass; absent deadline controls in unchanged paths must retain existing behavior.

### Task 3 — RED/GREEN: pure core, projection and measured workload

Files: new pure core and measurement tests in §2. Inject clock/search/catalog/auth snapshot/cache/
cancellation/memory primitives; no Flask, requests, credential, Home or legacy helper imports.

- [ ] `test_query_projection_contract`: Component broadcast and escaping, all saved Teams fallback,
  project/type/default field resolution, duplicate eligible issue names, Epic Link parent precedence,
  empty/nonempty Sprint filtering, direct-parent-only path, terminal CHANGED/created predicate with
  no updated proxy. Test current terminal re-entry and created-window conservative admission.
- [ ] `test_strict_pager_and_global_limits`: final/nonfinal empty pages, malformed/duplicate/repeated
  tokens, 100/101 pages, 1,000/1,001 candidate Epics, 10,000/10,001 fetched children, 2,600/2,601 pages,
  40-key/7,000-byte exact and one-over, cancellation race and cache size limits. All failures discard
  partial rows; qualification never re-fetches its children.
- [ ] `test_representativeness_requires_exercised_work`: zero, one-child/one-lane, empty bootstrap,
  single-page/single-batch, no observed concurrency, no terminal/Unmapped data all stop; a synthetic
  representative five-round campaign clears coverage but still stops deadline_bound_unproven.
- [ ] `test_cache_miss_hit_and_content_stability`: every cold fetches both catalogs, warm does no
  upstream work; eviction/TTL/mismatched token/source/group/digest stop; same keys with changed
  parent/status/SP/classification/summary/column change contentStable and stop. Different sample
  order does not create cross-profile HMAC comparison. No digests emitted.
- [ ] `test_memory_ownership_and_post_publication_retention`: include snapshot, shaping and published
  cache; positive retained allocation survives response; refresh replacement can yield zero retained
  delta; warm includes cached baseline; pre-existing tracemalloc untouched; cleanup on every failure.
  While candidate tracing is active, reject unrelated diagnostic options/assets/parallel requests
  before sample allocation; abort invalidates sample rather than claiming uncontaminated success.
- [ ] Implement the smallest pure query/pager/projection pipeline and prove fixed bootstrap-first
  scheduling versus no-star first-column-empty case. Every task now uses bootstrap naming only.

Run `.venv/bin/python -m unittest tests.test_eng_board_measurement`. Expected pass.

### Task 4 — RED/GREEN: external runner and closed checker

Files: runner HTML/JS, checker, measurement tests and runner Playwright spec in §2.

- [ ] `runner loads with actual production CSP`: start the real Flask test server (synthetic DB/Jira
  fixtures); serve HTML/JS through real routes/headers, listen for `securitypolicyviolation` and page
  errors before navigation; zero violations, running state and JS loaded. Test denied local access
  including asset HEAD; do not remove CSP or mock the document response.
- [ ] `runner never uses mutating discovery`: network assert no config/groups/sprints/test endpoints;
  options missing row leaves it absent. Numeric sprint validity and both Department selectors.
- [ ] `runner obeys sequence and isolated legacy pair`: all 40 samples, 30 candidate POSTs, ten
  tagged legacy pairs, exact begin/reserve/finish/end, fresh CSRF for each POST, step deadline through
  body/finish, no repeated candidate, end required before completed download.
- [ ] `runner aborts every stalled boundary`: stall reserve CSRF, candidate CSRF/body, each legacy
  sibling, finish and end; release late and assert no next step/downloaded partial data, safe stop
  phase/profile and cleanup. Exercise 401/403/429, manual abort, A/B tabs, drift and warm mismatch.
- [ ] `legacy_union_matches_current_helpers`: sanitized fixtures prove §4.4 parity and denominator,
  not raw sum or orphan count. Legacy stays contextual despite identical candidate counts.
- [ ] `checker_rejects_each_cross_field_corruption`: mutate each invariant in §7, body/header drift,
  fractional/bool/NaN counters, failed bytes > bytes, warm retry/cold timing replay, memory ownership,
  unknown stop context, identifiers and local-value canaries. Valid stops preserve only enums/numbers.
- [ ] `checker_never_passes_cooperative_campaign`: fast representative success prints exactly
  `STOP deadline_bound_unproven`; schema mutation cannot switch to a hidden PASS mode. Above-threshold
  representative campaign prints specified FAIL; empty/trivial prints STOP unrepresentative_scope.
- [ ] Implement runner without inline code/eval/product telemetry; no local/session storage or console
  data. Checker constructs output only from allowlists; refuses --output inside repo, supports
  `--input` with one final verdict line, no copying input into diagnostic errors.

Run `.venv/bin/python -m unittest tests.test_eng_board_measurement` and
`npx playwright test tests/ui/eng_board_measurement_runner.spec.js`. Expected pass with real CSP.

### Task 5 — Required automated verification

```bash
.venv/bin/python -m unittest tests.test_eng_board_measurement tests.test_shared_group_config_db
.venv/bin/python -m unittest tests.test_jira_resilience tests.test_jira_auth tests.test_oauth_jira_client tests.test_token_refresh_race
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_db_oauth_cutover
.venv/bin/python -m unittest tests.test_backend_route_source_guards tests.test_jira_search_pagination_source_guard tests.test_oauth_jira_client_source_guard
node --test tests/test_frontend_api_source_guards.js
npm run test:frontend:unit
npx playwright test tests/ui/eng_board_measurement_runner.spec.js
npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_alert_loading_order.spec.js
.venv/bin/python -m unittest discover -s tests
.venv/bin/python scripts/check_design_assets_sanitized.py
git diff --check
```

Verify source isolation: pure core imported only by dev adapter and tests; optional runtime import
in guards/current-user wrappers allowed but no core import, no ordinary-path activation. No frontend
source/dist change, no production Board route, no new runner asset in release image/build context.
Do not rebuild unchanged frontend output just to generate a diff. If map needs extension, amend and
review before continuing. Full failures must be resolved or explicitly stop execution.

### Task 6 — Startup and non-authorizing live characterization (separate execution only)

Only after Tasks 0–5 pass and this plan is marked ready. This repair does not execute these commands.

```bash
.venv/bin/python scripts/check_startup_preflight.py
APP_ENVIRONMENT_KEY=local ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true .venv/bin/python jira_server.py
```

Warnings before Flask banner fail startup. Dedicated local instance, no other app tabs or background
traffic. The operator signs in normally; the runner options endpoint proves strict DB OAuth/read-only
prerequisites. No borrowed cookies/credentials or Jira mutations. Start checker with
`--base-url http://127.0.0.1:5050`: accept only loopback HTTP hostname and explicit valid port, reject
userinfo/path/query/fragment/redirect; GET `/health`, require 200 object status=OK; print exactly one
runner URL and exit. Never follow auth redirects or call the sample route itself.

Select saved groups and the numeric sprint, run fixed campaign, save the closed download outside
repo, then:

```bash
.venv/bin/python scripts/check_eng_board_measurement.py --input /tmp/eng-board-measurement-five-runs.json --output /tmp/eng-board-measurement-summary.json
```

Expected verdict is STOP or FAIL per §8, never PASS for this revision. A blocked cooperative I/O
operation may require stopping the dedicated server after the browser aborts. Do not start another
campaign over it or forcibly terminate an auth refresh transaction. Dispose the dedicated server and
private caches after work finishes; never commit external result files or server logs.

### Task 7 — Record evidence and production handoff boundary

- [ ] Record only final code, count/byte/headroom buckets, attempts/retries/429/sleep/failure-byte/
  fast-fail totals, source/cache/deadline enums, server-internal bootstrap/full timings, context-only
  legacy denominator/cap, memory ownership and test outcomes. No raw JSON, ids/names/JQL/URLs/secrets.
- [ ] Align this plan/support/index; refresh gate Checked on/Last result; no live Home probe without
  approved target/input. Stop after characterization.
- [ ] Production may reuse or MOVE the validated pure pager/query/projection/classifier into
  `backend/services/eng_board.py` only with the same tests/measurement harness importing that core.
  A separate reimplementation is not validated. Rerun projection/byte/deadline/cache/coverage gates
  on the moved core and chosen transport. Extend the scope profiles for excluded production modes.
- [ ] No transport, first-load, focused-content or production authorization is implied by cooperative
  STOP. Hard-bound policy and excluded-scope evidence remain blockers to production, not waivers.

## 10. Documentation repair outcome

All twenty findings confirmed and repaired in the plan/support handoff. The five original safety
blockers are closed as implementation contracts; the deadline finding is resolved by explicitly
weakening the claim and making PASS unreachable, not by claiming cancellation is implemented.
No application files changed and no live spike or Home mutation probe ran.

Repair verification on 2026-09-05:

- Synced the requested branch with `git fetch origin docs/issue-137-board-design` and
  `git merge --ff-only origin/docs/issue-137-board-design`: already up to date at baseline `b0655ea`.
- `git diff --check`: passed. Inline path/relative-link/line-bound checks verified every planned
  missing file is marked Create, all Modify paths exist, and the 20 dispositions are ordered once.
- `scripts/check_design_assets_sanitized.py`: passed its existing design-asset inventory; an added-line
  local-value/identifier scan covered all four changed artifacts and passed. Existing configuration
  constant names are not local-data additions.
- `node --test tests/test_frontend_api_source_guards.js`: 62 passed.
- `.venv/bin/python -m unittest tests.test_env_config_docs`: 11 passed.
- `.venv/bin/python -m unittest discover -s tests`: 1,538 run, 3 failures, 1 error, 9 skipped. First
  sandboxed run could not access PostgreSQL; approved local-access retry had the same totals because
  PostgreSQL was unavailable. The three excluded-capacity API failures and Basic-mode route-guard
  error share that connection failure. No database setup/application change was made for this repair.
- Reviewed the sole GATE document; 0 of 4 required Home probe inputs and no approved disposable target.
  Updated check metadata and retained Blocked; no new PASS or live probe result is claimed.

Residual execution limits: provision the required local test DB and pass Task 5 before live work;
cooperative characterization cannot authorize production; hard-bound cancellation and excluded-scope
measurement require separate reviewed amendments. The support design remains non-executable.
The diagnostic emits no GA4 event because it is local tooling. The support design specifies the later
bounded product telemetry; `docs/README_ANALYTICS.md` changes belong to that production implementation.
