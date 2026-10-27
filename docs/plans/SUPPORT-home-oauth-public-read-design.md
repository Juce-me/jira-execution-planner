# Home OAuth public reads: design and Definition of Done

**Status:** Plan finalized; implementation authorized but not started. This document set is the current delivery. Tasks 0–6 in the [EXEC plan](EXEC-home-oauth-public-reads.md) run in a separate execution session; no application change is authorized by this plan-fix task.

**Source verification:** 2026-10-27 against local `main` at `e99b7e2a`. The plan checkout is at `e58d38f9`, six commits behind; no rebase was performed. The intervening changes include dashboard layout/defaults, structure budgets and root instructions; use main's actual symbols/line references before execution. The older [migration reference](SUPPORT-epm-home-oauth-migration.md) is historical, not executable.

## Outcome and decisions

Preserve the complete **Goals -> selected subgoals/descendant goals -> Home projects -> exact Jira labels -> Initiatives/Epics/Stories** journey. Compare entity membership, hierarchy, ordering, counts, Story Points, dependencies, duplicate memberships, lifecycle and sprint filtering against today's authorized behavior. Home-query success, a visible tab or an empty rollup cannot prove parity. Accepted data differences are unavailable Home owner/author fields, explicitly scoped below; Jira person fields and work remain unchanged.

Decisions resolved with the operator on 2026-10-27:

| Decision | Accepted contract |
| --- | --- |
| DEC-1: enablement and scopes | Each user controls a private **Enable EPM view** checkbox. The operator said: “for now each user for themself. later we will just enable it, when figure out to show epm view per group.” Group-based enablement is deferred. Home scopes are required only for Home reads, never for ENG/Planning/Board/Scenario or ordinary config bootstrap. |
| DEC-2: visibility | The operator said: “if there is no access for the scope, don't show EPM view for goals/projects”. Navigation requires the user's enablement, the four provider-confirmed Home scopes and a successful access signal for the intended Home scope. No-access/empty-scope states keep Goals/Projects EPM hidden; Settings remains available to configure or recover access. |
| DEC-3: rollback | The operator chose “Document rollback; omit switch (recommended)”. No deployment OAuth/API-token selector, feature rollout flag or automatic credential fallback. |

The checkbox replaces the Home API-token prerequisite for EPM reads; it cannot grant Atlassian scopes or resource permissions. Use Settings -> Connections for this private checkbox, separate from the existing optional Home write-token card. Keep that card, token-management routes/data and `WRITE_AS_USER` behavior intact; no Home write action is added. Checkbox state participates in the existing Settings dirty/Save/Discard flow, not an immediate hidden save.

Store a boolean `view.epm.viewEnabled` in the owning user's default private view (workspace + user). Missing means false; the operator explicitly enables it before candidate acceptance. Extend personal-view validation/preservation with this optional boolean, keeping `tab` and `selectedSprint` as strings and the five-key EPM configuration POST unchanged. Do not store it in workspace admin config, group definitions, OAuth scopes/capabilities, another user's row or a browser-only preference. No schema/backfill migration is required; existing private payloads remain valid. Basic/JSON keeps its current availability and token behavior. Non-DB/local-store OAuth Home public reads are unavailable by design.

Existing saved scope, labels, issue types, custom rows and private state survive toggle/save/reload. Default-view replacement, import and promotion preserve the owning user's viewEnabled setting through the same serialized private-view service; switching a saved/default view cannot silently reset or import another view's enablement. The checkbox is a UI preference, not a new data permission: direct custom Jira-label routes retain existing authenticated owner-private/Jira authorization even when Home EPM is disabled or unavailable. Disabling retires Goals/Projects navigation and in-flight generations, not saved configuration or credentials.

## Scope request, readiness and access states

Keep `ATLASSIAN_SCOPES` as the existing globally required Jira/identity scopes plus `offline_access`. Define server-owned `EPM_HOME_READ_SCOPES` separately:

- `read:goal:goals`
- `read:access:goals`
- `read:project:projects`
- `read:access:projects`

They are documented in Atlassian's [Goals](https://developer.atlassian.com/platform/goals/goals-graphql-api/using-graphql-api/) and [Projects](https://developer.atlassian.com/platform/projects/projects-graphql-api/using-projects-graphql-api/) authorization tables, checked on 2026-10-27. Before enabling requests in a deployment, confirm the app registration includes them and compare names only against the real provider-confirmed connection grant. An explicit Jira scope override does not omit Home requests accidentally: the authorize request helper unions/deduplicates the base set with the Home set for an enabled, authenticated user's EPM consent journey. Ordinary Jira-only login stays base-only. Callback validation requires base scopes, persists the actual provider grant, and reports missing optional Home scopes as EPM unavailability rather than failed Jira sign-in. Never infer grants from requested scopes or `scope_provenance != provider`.

Use the existing same-tab `/login?reason=missing_scope` entry for enabled users needing Home consent, with the existing PKCE/state flow. Resolve the optional Home request from the server-owned preference and authenticated identity, not a browser scope list. An initial login without a resolvable user can finish base consent first; an enabled user can then request Home consent. Re-consent is never forced onto Jira-only users. Do not add a dashboard auth screen or API-token step.

`GET /api/config` stays a cheap bootstrap with no Home network call. Add `epmViewEnabled`, `epmHomeReadAvailable` (verified scopes only), and a sanitized `epmHomeReadLoginUrl` when enabled but scopes are missing. Readiness is not resource authorization. Checkbox/status UI remains reachable when navigation is hidden.

For enabled users with all scopes, one bounded `GET /api/epm/access` resolves Home authorization: use the selected root's `goals_byKey` if configured; otherwise one `goals_search(first:1)` to establish accessible Home data and expose Settings for scope setup. Use the validated context's cloud id, never tenant discovery HTTP. Return `available`, `disabled`, `scope_missing`, `empty`, `denied` or `unavailable`, with sanitized message/login hint. Navigation is exactly Basic compatibility OR (epmViewEnabled===true AND epmHomeReadAvailable===true AND access state available); an unresolved/mistyped field fails closed. No visible Home tab until `available`; no additional probe for disabled/missing-scope users. A later home_access_denied result clears Home access availability; a Jira-only resource denial changes freshness, not the Home-access signal. Reuse this goal result in the subsequent metadata warm step, and cache only the access decision for at most 30 seconds in the current auth/config partition. Explicit refresh or scope/site change rechecks. A confirmed denial/empty configured target hides navigation and retires that Home generation; a transient failed refresh retains already validated content with the existing failure state and does not invent a new denial. Missing config leads to Settings, not implicit import from the Basic fixture.

## Capability record and gate bounds

The operator's verbatim waiver and bounded exception are recorded in EXEC and `docs/plans/AGENTS.md`. Usage/migration staging is waived for this single-user work. Security, permission boundaries, functional parity and live acceptance are not waived. [GATE-05](GATE-05-home-write-capability.md) still blocks Home writes; it is not a dependency of this read contract. No write probe, disposable mutation target, mutation route, write scope or write UI belongs here.

| Record | Current result | Required future evidence |
| --- | --- | --- |
| Legacy eight-operation profile | Historical `FAIL home_graphql_3lo_unsupported`; not changed by this plan | Retain its own result and `home_graphql_3lo_supported` reason; never inherit the new result |
| `public-read-v1` | Runtime/profile checker not implemented; not newly run in this validation round | Exactly seven error-free reads from a real strict DB browser session using shipped runtime projections; checker prints `PASS home_graphql_public_read_v1_supported` |
| Product readiness | Not established by a plan or format checker | Non-empty route/browser parity, intended site/private scope, signed-in operator journey and acceptance |

Use “public-read-v1 ready” only after the new PASS and product acceptance; do not claim the general Home gate passed. `home_3lo_gate_mode` remains keyed to its legacy reason. Test that a new-profile PASS does not change that helper's result. The checker validates format/completeness, not authenticity of JSON supplied to it; no HMAC or attestation system is added. Live acceptance cannot be replaced by fabricated row `ok` values. Sanitized probe rows use `category`, not `code` (the current secret detector treats any `code` key as sensitive).

Earlier operator-authorized diagnostics in this conversation found public goal search/lookup, hierarchy, project metadata/updates and direct tags working with a real four-scope DB grant after omitting internal identity fields. Those are historical observations, not a new run against main. The original owner/creator selections required `identity:atlassian-external`; the Teamwork Graph ad-hoc Cypher fallback was restricted. The chosen Basic fixture belonged to a different site from the dashboard. Do not copy its settings or interpret an account-wide token success as cross-site application authority.

## Public query and client contract

| Registry operation | Kept fields | Omitted |
| --- | --- | --- |
| `goals_search` | id/key/name/URL, Relay pages | No current core search field |
| `goals_byKey` | id/key/name/URL | No current core lookup field |
| `subGoals` | id/key/name/URL/archive flag, Relay pages | Goal node `owner` |
| `goalProjects` | project core/state, direct tags, latest update content/date/type/link, project Relay pages | Project `owner`, update `creator` |
| `projectDetails` | id/key/name/URL/state | `owner` |
| `projectUpdates` | id/content/dates/type/link, existing paging projection | `creator` |
| `projectTags` | direct tag id/name/URL | Teamwork Graph/Cypher |

Add `HOME_OAUTH_GRAPHQL_ENDPOINT = "https://api.atlassian.com/graphql"`, shared by runtime and public probe. Atlassian specifies that endpoint for OAuth in its [GraphQL authentication documentation](https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/#authentication). The current Basic constant/probe uses the team gateway; retain Basic's constant and constructor signature `HomeGraphQLClient(email, api_token, endpoint)`. Earlier diagnostic success at the team gateway is not proof it universally rejects Bearer tokens; the new endpoint restriction is explicit audience/credential confinement. The strict client refuses every other URL, including TWG/site/custom constructor targets, before building Bearer headers.

Runtime and probe share one seven-operation registry and exact document/operation-name allowlist. Reject the exact `HOME_PROJECT_UPDATE_MUTATION` text/hash and all unregistered documents; a substring test is insufficient. Keep Basic query/header semantics and write probe unchanged.

Preserve a structured strict-profile result containing GraphQL `data` and `errors` until optional-tag classification completes. Define typed internal failures with `category`, HTTP `status`, validated `paths`, capped `retry_after` and optional safe provider classification. Do not flatten provider messages before classification or expose raw messages/extensions to the browser. Basic `execute` continues returning its existing dict and existing exception behavior. All strict consumers must be enumerated and updated to unwrap the new result, including pagination and probe.

Only non-auth errors confined to `goals_byId.projects.edges[i].node.tags` or `projects_byId.tags` may retain partial data. Require intact project node ids/core state and `projects.pageInfo`; tags/updates sub-connections currently have no pageInfo and must not be required to have one. Mark the affected node (for example `_tagsUnavailable`, internal only) and pass it through `_build_home_project_record_from_goal_row` into `tags_unavailable=True`. Null/bubbled core, unknown paths or required field failures reject the read. Successful empty tags remain available. Error-free enriched rows retain `state`, `tags`, `updates`, hence zero detail/update/tag fan-out. The normal enriched Basic path never uses TWG or produces unavailable tags; strict tag-failure degradation is candidate-only error coverage, not false Basic parity.

Use `HOME_MAX_RETRY_WAIT_SECONDS=30` for strict Home retries and emitted retry hints; clamp negative/invalid/excessive Retry-After, keep current attempt bound and timeout. Basic behavior is separately preserved. Never sleep holding DB resource state. This resource-call rule explicitly exempts the existing locked OAuth refresh transaction.

## Auth snapshot, refresh, caches and Jira workers

One request-owned snapshot is created in the EPM blueprint `before_request` after server globals/security context are available. Reuse/memoize the guard's context on `g`, then call `resolve_epm_home_read_auth` only for routes actually reading Home. Config/preferences and direct custom-id requests need only the base actor. Access-state requests classify missing Home scopes without a terminal error. Generic private-view validation that reads Home must request the same snapshot explicitly. `g` is read only in the request thread; workers receive captured objects and an immutable warmed project index.

The snapshot requires a real nonempty DB `browser_session_id`, matching user/connection/workspace/site/cloud, active user/session/connection and provider-confirmed Home scopes. `revalidate_db_request_auth_context` reads status directly, bypassing `_STATUS_CACHE` (currently 30 seconds); a process-local invalidation cannot prove another process's disable was observed. Empty legacy DB context ids fail closed; non-DB/local-store OAuth is unsupported for these reads. Use context cloud id and reject an empty id; no `/_edge/tenant_info` request or OAuth cloud-id cache is needed.

Resolve expiry before keys are constructed using the existing 60-second expiry buffer, encrypted DB token loader, transaction lock and refresh-reuse revocation. Do not share DB sessions between threads or hold them across Home/Jira resource HTTP. Do not redo full context/project-access resolution per GraphQL page: after forced direct validation before cache use, use a five-second request/worker lease, a lightweight SELECT of current actor/session/connection status, version/scopes/provenance/workspace/cloud, and token reload only near expiry or on version change. Force revalidation after refresh and before final cache admission. Query-count tests must prove cost grows with lease windows/workers, not page count; record actual SQL counts and cold-load timing.

Retain auth/config partitions, token version and project-access keys. A normal mid-load rotation with unchanged authority does not return `401`, bypass warming or disable all admission. Use the context/version last revalidated for cache admission; if authority fails, reject and admit nothing. Capture an immutable request-local metadata/index memo before the aggregate's eight workers; workers resolve Home-linked ids from that memo, never recrawl Home per project due to a version/key change. No mutable cross-worker cache-admission flag or unbounded replay. Preserve captured private config, base JQL and Jira field ids. The public profile version is one key part, not a separate migration/test matrix.

The two old Home lookup dictionaries have no eviction. OAuth cloud lookup is eliminated; bound public goal lookup to 512 entries and a 300-second TTL with partition-preserving eviction. Do not remove identity/token-version partitioning to address memory growth or rewrite Basic caches.

Raised `AuthError` must escape helper/worker catches and never be cached as data. The shared Jira iterator currently breaks on non-200 and returns a partial/empty list; EPM cannot claim complete auth/failure handling by merely catching exceptions. Add an EPM-only strict search adapter around `jira_search_request` passed to `_jira_client.fetch_issues_by_jql`; check every page's status before the shared iterator can break. Use it in rollup q1/q2/q3 and the EPM issues dependencies. Map actual Jira `401` through base auth recovery, resource `403` to denial, `429` to bounded throttling and other failures to typed non-success; discard partial pages and cache nothing. Do not change Scenario's shared iterator behavior or Jira pagination (`nextPageToken`/`isLast`). On first worker failure cancel queued futures and prevent queued resource work; running HTTP can finish under existing timeouts and is not promised hard cancellation.

## Errors and mode-specific compatibility

Promote `backend.security.guards._auth_error_response(server,error)` to public `format_auth_error_response(server,error)` and delegate from the EPM OAuth mapper. Do not call `jira_server.auth_error_response` directly with its default status for arbitrary `AuthError`. Preserve the guard's actual code/status/URL variants.

| Condition | OAuth application response | Basic/JSON disposition |
| --- | --- | --- |
| Missing/expired base session; failed credential refresh/revocation/disabled actor | Existing guard `401`: auth_required + loginUrl, or account_disabled/revoked/stale + their recoveryUrl | Preserve existing local-mode behavior; never invent a sign-in lock |
| Missing globally required Jira scope | Existing guard `401 auth_required`, missing-scope login URL | Existing behavior |
| Enabled EPM but missing only Home scopes | Bootstrap/access state is unavailable with existing same-tab login hint; direct Home route `409 epm_scope_required` + loginUrl; no global terminal lock | Not applicable |
| Provider scope/authorization rejection despite complete confirmed grant | `403 home_access_denied` for identified access denial, otherwise `502 home_read_failed`; hide confirmed no-access view, retain Settings | Existing catches/envelopes unchanged |
| Raw Home provider `401` with a valid complete DB grant | Revalidate credential once; proven revoked/expired-unrefreshable -> base `401`; otherwise `502 home_read_failed`, not a re-login loop | Existing HomeAuthenticationError behavior |
| Required GraphQL/malformed/core failure | `502 home_read_failed` | Existing helper fallback/200+error where currently supported |
| Exhausted Home throttling | `503 home_rate_limited`, Retry-After clamped to 1–30 seconds | Existing behavior |
| Scoped resource id inaccessible/not found | Existing sanitized `404`; no cross-user/config leak | Existing behavior |
| Optional strict tag-path non-auth failure | Keep valid project/update data, mark tags unavailable; no extra request | Existing enriched/legacy behavior |

Enumerate OAuth-strict vs legacy swallowing at: `resolve_goal_by_key` lookup and search fallback, `fetch_sub_goals`, `_fetch_home_project_record`, `fetch_projects_for_goal`, `fetch_latest_project_update`, both `fetch_project_tags` catches, `fetch_epm_home_projects` startup RuntimeError and the scope route. Strict required failures re-raise; permitted tag failures alone degrade. `_project_ari_candidates` is legacy/TWG-only and is not promoted into OAuth. Parametrize failure-at-each-site tests plus Basic regression cases. Goals/scope status changes and the EPM blueprint mapper apply only to OAuth, preserving Basic `200 {error,...}` tests.

One frontend classifier accepts `{status, category/code, retryAfterSeconds}` and is used by automatic and all four explicit/archived refresh paths. Map throttling to `rate_limited`, resource denial to `denied`, other non-auth errors to `failed`; authRequired still comes from `apiFetch` and locks the entire mounted app on any real API `401`. Parse Retry-After into `error.retryAfterSeconds`, but deliberately keep freshness `retryAtMs:null` for this cutover: no controller-scheduled retry is armed. Explicit refresh remains available; no replay or new polling loop. Preserve loaded content/drafts and atomic metadata+rollup commits.

## Endpoint contract matrix

`O` = existing base DB OAuth actor/Jira requirements; `R` = new EPM-only Home scope/resource boundary. It does not exist in current main. `A` = existing base auth `401` variants; `H` = OAuth-only `409 epm_scope_required`, `403 home_access_denied`, `502 home_read_failed`, `503 home_rate_limited` above. Every row below has an explicit failure column. Basic policies/envelopes remain unchanged. No caller-supplied user/workspace/site/token/GraphQL authority is accepted.

| Method/route | Auth and ownership | Input; CSRF / requested-with | Success | Failures / verification |
| --- | --- | --- | --- | --- |
| GET `/login`, `/api/auth/atlassian/login`, callback | Existing auth flow; server-selected scopes/site | Existing PKCE/state, no unsafe CSRF | HTML/redirect; optional Home consent never required for base callback success | Existing denial/state failure; base vs Home-only missing-scope tests |
| GET `/api/auth/status` | Existing base auth status | None; no CSRF/requested-with | Existing status, no token/scopes exposed | Existing unauthenticated status/recovery behavior; no Home global requirement |
| GET `/api/config` | O; owning private view | Existing query; no CSRF/requested-with | Existing bootstrap + epmViewEnabled / epmHomeReadAvailable / optional login hint | A, config_storage_unavailable 503; missing Home scopes still 200 |
| GET `/api/epm/config` | O; own view | None; no CSRF/requested-with | Existing five-key normalized config | A, storage 503; no Home grant needed |
| POST `/api/epm/config` | O; user_write, own view | Existing five-key payload; token-bound CSRF **and** `X-Requested-With: jira-execution-planner` | Existing config + viewConfigId; preserves personal toggle/tab/sprint | A, invalid_epm_config 400, csrf_required 403, storage 503 |
| POST `/api/epm/preferences` (new) | O; user_write, own default view | Exactly `{viewEnabled:boolean}`; CSRF **and** requested-with | `{epmViewEnabled:boolean}` after commit; no token/config mutation | A, invalid_epm_preferences 400, csrf_required 403, storage 503; foreign user/workspace selectors rejected |
| GET `/api/epm/access` (new) | O; R only for enabled/scoped Home read | No caller scope override; no CSRF/requested-with | `{state, epmHomeReadAvailable, loginUrl?, message?}`; bounded access check | A only for base auth loss; disabled/missing/empty/denied/unavailable are categorized 200 states, no login loop |
| GET `/api/epm/scope` | O; current context cloud id/private config | None; no CSRF/requested-with | Existing cloudId/error/scope envelope | A; empty OAuth cloud id -> 502 home_read_failed; Basic detection remains 200+error |
| GET `/api/epm/goals` | O+R; current Home container | Optional rootGoalKey in current site; no CSRF/requested-with | `{goals,error:""}` | A/H; Basic 200+error preserved; Settings displays typed OAuth failures |
| GET `/api/epm/projects` | O+R; private saved scope | Existing tab/subGoalKeys/refresh; no CSRF/requested-with | Existing projects/cache/count/limit/truncation envelope + Server-Timing | A/H; unknown/core failure never empty success |
| POST `/api/epm/projects/configuration`, `/preview` | O+R; private current-site draft | Existing draft/refresh; CSRF **and** requested-with | Same projects envelope; no persistence | A/H, invalid_epm_config 400, csrf_required 403 |
| GET `/api/epm/projects/<id>/issues` | O; R for Home-linked/narrowed Home discovery; O-only custom row without narrowing | Existing tab/sprint/subGoalKeys; no CSRF/requested-with | Existing project/issues/epics/metadataOnly | A/H where Home used; tab/sprint 400, scoped 404, strict Jira page failure; no Home call for direct custom row |
| GET `/api/epm/projects/<id>/rollup` | Same Home/custom distinction | Same query; no CSRF/requested-with | Existing hierarchy/truncation envelope | Same errors; no partial/cache success after a failed Jira page |
| GET `/api/epm/projects/rollup/all` | O+R; warmed private scope captured before workers | Same query; no CSRF/requested-with | Existing projects/duplicates/truncated/fallback + timing | A/H/Jira error; cancel queued workers and admit no failed result |
| GET dev probe `?profile=public-read-v1` | dev_local_oauth_read + local/dev allow flag + strict DB browser session + R | Private scope only; reject overrides/unknown profile; no CSRF/requested-with | Sanitized profile/decision/reason/results with category fields | Disabled/nonlocal/non-DB 404; A/H; insufficient fixture != PASS; local-token fallback forbidden |

The existing probe path is classified `dev_local_oauth_read`, and route-level loopback/environment/allow checks remain. Both explicit profiles on this path require DB browser sessions; `profile=legacy` retains legacy queries/checker semantics, not the old non-DB local-store branch. Reject nonempty root/subgoal/project overrides outside the current private scope (prefer removing them entirely for public-read-v1). No new legacy diagnostic route is added.

A custom row without homeProjectId resolves directly from owner-private config when runtime subgoal narrowing is absent. With narrowing preserve `jira_server.find_epm_project_or_404`'s current narrowed payload behavior; do not require a Home scope or Home request where today's custom lookup needs neither, and do not let missing Home-linked rows bypass discovery. Mixed aggregate Home surfaces still require R. No mutation route rights are widened.

## Functional parity acceptance matrix

Use shared synthetic raw Home/Jira replies, identical private config/base JQL/field ids/authority and isolated caches. Include the goals/scope endpoints. Freeze `jira_server.utc_now_iso`, `backend.epm.projects.datetime` (including aggregate's now=None path), TTL `time.time` and Playwright `page.clock.install`; test age_days 13/14/15. Capture a non-empty baseline before code changes, then compare the candidate through real discovery/labels/Jira builders and rendered rows. Stub external I/O, not shaped project lookup or hierarchy builders.

Project normalization allows exactly ownerAccountId, ownerName, ownerAvatarUrl and latestUpdateAuthor to become empty, plus the goal node `owner` key to be absent. Separately enumerate transport timing/cache and new enablement/readiness fields. Do not normalize keys, labels, memberships/order, statuses, links, update text/date or totals. Candidate-only tag-unavailable/provider-error cases are not alleged parity with Basic's all-errors-raise enriched path.

| Case | Required unchanged result |
| --- | --- |
| Roots/descendants/shared project membership | Goal/project identities, order, subGoalKeys/subGoals, de-duplication and links |
| Exact label/manual/missing/ambiguous tags | Same normalized tags, manual precedence, exact q1/q2/q3 JQL, no wildcard/fallback label |
| Non-empty labeled project | Initiative/Epic/Story tree, root Epics/orphan/loose Stories, dependencies, SP/progress/status/counts and duplicate work |
| Active/Backlog/Archived | Pending Active; paused/todo Backlog; age_days <14 recent completion; aggregate Archived/metadata-only zero Jira calls; direct archived rollup/issues retain their current queries |
| Sprint/subgoal change | Sprint filters leaf Stories only; parent discovery stays sprint-independent; no late/out-of-scope generation |
| Custom and metadata-only projects | Direct private custom row has zero Home calls; metadata-only card/Settings CTA remains; foreign ids inaccessible |
| Enriched metadata and pagination | Zero per-project detail/update/tag calls for complete rows; same Home Relay caps500/100/order/truncation and Jira nextPageToken/isLast |
| UI/refresh | Actual non-empty Jira rows and progress/dependencies; private settings dirty/save/discard; disabled/missing grant/no-access view hidden; existing legitimate-empty states separately covered |

Route the raw Home fixture by the operation name parsed from the document when legacy requests omit operationName; Jira fixture dispatches by asserted JQL predicates. Reuse the SQLite DB/session setup in `tests/test_db_oauth_cutover.py`. Clear EPM_PROJECTS_CACHE, EPM_ISSUES_CACHE, EPM_ROLLUP_CACHE, _CLOUD_ID_CACHE and _GOAL_BY_KEY_CACHE between modes; initialize new bounded lookup/access caches too. Align get_epm_config, build_base_jql and configured field-id sources, not just response fixtures. Meta-tests must make an empty Jira reply and wrong exact label fail the oracle.

## User state, cutover and rollback

| State/action | Required behavior |
| --- | --- |
| Checkbox off/missing | Goals/Projects EPM hidden; no access probe or Home token status startup GET; normal Jira views work |
| Checkbox on, scopes absent or old explicit base-scope override | Hidden EPM; Settings shows normal same-tab scope-update link; base app/config remains functional |
| Checkbox on, scopes complete, Home denies/no accessible configured target | Hidden Goals/Projects view; Settings explains denied/empty; no API 401 or terminal lock |
| Home available, initial/saved view | Settle the access/apply gate, then warm metadata once and load non-empty Jira work; saved scope preserved |
| Token absent/connected/revoked | Same private enablement + access behavior; no startup token GET; existing Connections card can fetch its status only when Settings opens |
| Save/Discard/stale save | Unified footer saves dirty editable sections through their own payloads; failed preference save keeps draft; serialized private patch preserves unrelated fields; existing EPM last-commit-wins semantics unchanged |
| Scope/site/disable/revocation | Retire old generations; recheck access for new scope; global actor loss still terminal-locks any API 401; no in-place unlock/replay |
| Throttled/transient refresh | Retain validated content/drafts, existing freshness category, retryAtMs:null and explicit retry; no fabricated empty success |
| Revert | Revert application code/bundle together in the intended checkout; no token/schema rollback. Retain enabled preference safely in optional payload validation if necessary; old code's validator may reject the new key, so the rollback revision must remove only viewEnabled through an explicit owner-private service patch before older strict validation, preserving all other fields. Old EPM requires a valid per-user Home API token and remains hidden/unavailable for users who never connected one. No promise of automatic fallback or migration-free downgrade acceptance |

The new optional view payload key creates a rollback validator consideration even without a schema migration. Capture a synthetic downgrade preservation test and an operator-run rollback procedure before handoff. Do not erase credentials, stamp/drop databases or infer owners. Split execution into reviewable slices (Tasks0–1; Tasks2–3; Tasks4–5), but never claim product readiness between backend and UI acceptance. No commit/PR/publication is authorized by this planning task.

## Analytics and visual checks

Reuse canonical `settings_action` for the new checkbox Save/Discard result, via existing `trackSettingsAction`: trigger userevent, event_type event, feature_name settings, section epm, workflow_action save_result|cancel, typed result success|failure and existing dirty_state enum. Verify the actual event schema during implementation and reuse its current typed enum values; do not send viewEnabled as a boolean dimension, user/site/goal ids or scopes. Existing EPM page/API events and rate_limited/denied buckets stay unchanged. Add the checkbox interaction to docs/README_ANALYTICS.md and keep the transport/access-probe internals allowlisted with a reason. No new canonical event, custom dimension or GA4 admin/runbook change is planned; existing pageview/userevent routing remains.

Use registered checkbox/control styles, selected state and compact Settings composition. Any EPM Settings control moved by this new checkbox requires settled geometry assertions in Chromium and headed Firefox/WebKit, plus synthetic before/after screenshots. Runtime live data stays transient/read-only and is never saved as screenshots.

## Definition of Done

- [ ] Base Jira scopes and EPM_HOME_READ_SCOPES are separated; private checkbox and access states behave as DEC-1/2; Jira-only login/config never require Home consent. Microsoft Entra/Azure SSO through Atlassian is an acceptance path.
- [ ] Owner-private viewEnabled validation, Save/Discard/reload/failed-save and rollback preservation pass; Basic and other-user/workspace behavior remain intact. No group/admin ownership promotion.
- [ ] Seven fixed public operations and exact OAuth endpoint are shared by runtime/probe; no mutation/identity/Cypher enters strict requests; constructor/Basic/write guards remain unchanged.
- [ ] Strict DB actor/status/session/lease/refresh/cache validation passes cold/warm/no-request-context and cross-process-status tests. Query counts are page-independent within the lease, and rotation reuses warmed metadata without N recrawls or 401.
- [ ] Every matrix route/alias has mode-specific body/error/CSRF/ownership tests, strict Jira page errors and cancellation coverage. Full-grant provider denial cannot cause a sign-in loop.
- [ ] Non-empty composed/backend/browser parity passes every row above; goal-owner omission is explicitly allowed; no empty oracle, broad normalization or wrong-label result can pass.
- [ ] New UI spec owns request counts, metadata-first warming, zero startup Home-token GET, token-state parity, checkbox/missing-scope/no-access visibility, Settings errors, retained-content throttling/denial, global auth lock and synthetic visual/geometry proof.
- [ ] Build, appropriate Python/Node/structure/extraction checks and intended-checkout startup/preflight/API/bundle checks pass. Every UI command explicitly targets localhost on a non-5050 worktree port.
- [ ] Public probe succeeds in a strict DB session from the changed checkout, with categorical four-scope verification and intended site/private scope. A checker file is format evidence only; real non-empty app/SSO acceptance is recorded separately.
- [ ] Current ownership/setup/index/analytics/ontology/instructions are reconciled during execution; GATE-05 changes remain restricted to dated write-gate evidence; no write PASS or general legacy gate PASS is inferred. Tasks run in a separate session and remain EXEC until accepted or merged.

## Review evidence and limitations

This validation round independently read current main source for each attached F-01–F-39 claim; dispositions are in EXEC. Previous 141 Python/190 Node counts are historical author-reported worktree baseline runs, not new main validation. This round makes no runtime/provider-response or release-readiness claim. Current official scope/endpoint documentation was checked; real current grant and provider error shapes must be checked during execution. Group-based enablement, write work, deployment switching and automatic fallback are outside the accepted plan.
