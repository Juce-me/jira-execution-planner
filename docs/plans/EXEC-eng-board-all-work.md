# ENG Board All work implementation plan — issue #137

> **Status:** Planned, not implemented. Authored from the accepted in-app measurement branch on 2026-09-08. Candidate implementation is gated as specified below; this document does not claim production readiness.
> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Follow repository instruction chains and the companion [handoff](SUPPORT-eng-board-all-work-handoff.md).

**Goal:** Deliver Board-owned Component-scoped Epic discovery, optional sprint filtering, and focused-column-first complete direct-child loading without changing sibling ENG modes.

**Recommended architecture:** Reuse the strict diagnostic query/paging core in one Board service. One authenticated streaming request owns issue data, global counters and at most two child searches. A small DB control row carries live focus/cancel signals across workers; it never stores Jira issues. The frontend has one Board-owned generation and explicit provisional versus authoritative state. Validate this transport in Task 1 before production integration; the existing cooperative diagnostic is not deadline evidence.

**Stack:** Existing Flask/Python, PostgreSQL/SQLAlchemy, React 19, esbuild and Node 20. No new package dependency proposed.

## 1. Evidence and interpretation

Source: read-only local `load_performance` table on 2026-09-08. Three successful observations, one group, sprint and revision, within 27 seconds. No identities or issue content are retained here. All six lanes report **unknown completeness**. This is a contextual sprint baseline, not an All work measurement or a production percentile distribution.

| Observation | Lane cache | Group complete ms | First content ms | Dependencies ms | Product ms | Tech ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | miss / miss | 6,396 | 2,664 | 3,356 | 2,607 | 2,967 |
| B | hit / hit | 143 | 76 | 23 | 82 | 18 |
| C | miss / miss | 2,589 | 2,439 | 11 | 2,378 | 2,534 |

Both miss observations returned Product 83 issues/83 Stories/54 Epics and Tech 101 issues/101 Stories/51 Epics. Epic counts are lane unions, not a deduplicated Board total. Product made five Jira requests/four search pages, Tech six/five, with no retries. Miss payloads were 116,735 and 124,505 decoded UTF-8 bytes. These counts characterize workload, not strict completeness.

| Miss stage | Product range ms | Tech range ms |
| --- | ---: | ---: |
| Jira search | 331.9–452.1 | 678.6–752.6 |
| Epic enrichment | 865.7–919.7 | 843.9–848.9 |
| Build response | 597.2–755.6 | 656.4–684.2 |

Interpretation: the slow observation spends about half its wall time on dependency loading after the lanes. Enrichment and response construction also cost materially more than the Product search. Do not add the parallel lane durations, average cached and uncached observations into an SLO claim, or infer dependency cache state from its duration. Separate Epic discovery, child hydration, and optional dependencies. Do not reuse the capped legacy endpoint as the All work source. A 2s useful-content target and 4s p95 full-load SLO remain distinct; progressive rendering does not waive full completion.

The earlier standalone collector remains historical only. No separate campaign, fabricated fixture result, Basic-profile substitution or arbitrary Team-fallback Department is required to author this plan. Candidate correctness, transport and performance evidence are still required before rollout.

## 2. Product contract retained

The settled semantics in [support design](SUPPORT-eng-board-optional-sprint-design.md), sections “Settled product decisions” through “Analytics impact”, remain authoritative except its superseded prohibition on plan authorship and its unselected transport alternatives. This plan proposes a concrete transport for validation; it does not silently change those product decisions.

- Board-only `uninitialized | all_work | sprint` scope, per Department for the mounted document. Preserve the reviewed first-visit initialization from the mandatory ENG sprint, then maintain independent Board state. The original issue requested an unselected default; the subsequent settled design deliberately chose first-visit inheritance. Changing that choice requires an explicit product amendment. No shared/private-view persistence or auth-resume persistence of Board scope.
- Components are the existing shared `groups[].missingInfoComponents`. Match exact names across all server-selected projects at the Epic boundary. No browser project/JQL/Epic-key authority and no new Component field.
- All work requires Components and a saved valid Board; include zero-child Epics. Selected sprint includes only matching configured eligible direct children and qualifies Epics from those children. With no Components use all saved Department Teams; with neither source fail scoped validation. Absent Board supports selected-sprint `board-unconfigured` only.
- Resolve configured standard issue types using hierarchy level zero/non-subtask; absent config defaults Story, explicit empty selects all eligible types. Preserve Epic-Link precedence over Epic-typed parent. Do not eagerly fetch subtasks.
- Preserve terminal identity, last-column position, `board-unmapped` immediately before terminal, 1–90-day retention (default 28), conservative recent-created terminal fallback and status transition JQL. Never use `updated` for retention. Empty terminal statuses add no retention clause.
- Board Teams controls remain visible, disabled and non-filtering in main and compact headers. Help stays in `EngBoardHelp`; preserve existing cards, focus, filters, drag/drop and field controls.
- Epic-native facets and All work Epic export become authoritative at complete index. Selected-sprint global Epic authority waits for every column to qualify. Child-derived Projects, SP, drag safety and work-item export remain pending until required cohorts are complete. Pending is never numeric zero. Search preserves input/focus and stays neutral until membership authority.

## 3. Immutable scope, strict paging and limits

Read `backend/security/CONFIGURATION_OWNERSHIP.md`. Capture RequestAuthContext, current workspace/site/user/token version, uncached shared Department and dashboard revisions/digests, field IDs, project access and eligible issue-type catalog before worker work. Worker code receives the snapshot and injected authenticated search only. No Flask globals/config getters inside worker threads. Config failure is sanitized 503; no fallback to JSON/service credentials in DB/OAuth.

Promote `build_epic_index_jql`, `build_child_jql`, `resolve_issue_type_ids`, `resolve_epic_link_field`, `split_epic_batches`, `strict_search`, `classify_project` and projection from `backend/services/eng_board_measurement.py` into the shared production core, retaining diagnostic adapters to the same functions. Extend its missing `other`, saved-board project fallback, absent Board, empty-terminal and variable-retention cases. Do not fork a second JQL/pager implementation.

Use `/rest/api/3/search/jql`, boolean `isLast` and `nextPageToken`; no `startAt`/`total`. Validate every page and normalized key before provisional delivery. Empty nonfinal pages continue; missing/repeated tokens, malformed rows, duplicate keys or unknown parents fail authority. See [Atlassian enhanced search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) and [JQL change predicates](https://support.atlassian.com/jira-software-cloud/docs/jql-operators/), checked 2026-09-08. Runtime response-shape tests are still required.

Initial candidate limits inherited from the design: 1,000 unique Epics, 10,000 included children, 100 rows/page, 40 Epic keys/batch, 7,000 fully encoded query bytes including token, 101 pages/search, 2,600 search pages/generation, two concurrent child searches. Enforce incrementally before allocating/publishing an over-limit page. Include catalog/auth work and retries in diagnostics. These are safety ceilings, not measured suitable Board sizes. Do not raise them to make acceptance pass.

## 4. Proposed endpoint and stream contract

Task 1 validates this DB/OAuth-first transport; Basic/JSON production parity remains a named gate. Never switch an existing deployment to a different authentication profile to satisfy it.

| Method/path | Policy and scope | Request | Success | Failures |
| --- | --- | --- | --- | --- |
| GET `/api/eng/board` | `authenticated_read`; current user/workspace/site, saved group visibility and current Jira authorization; no CSRF/X-Requested-With required | `departmentId`, `scope=all_work|sprint`, positive integer `sprintId` only for sprint, `focusedColumnId` optional server-validated column, `refresh=0|1` | 200 `application/x-ndjson`, `Cache-Control: no-store`; one claimed generation, monotonic frames | Before headers: 400 scope, 403 permission, 404 unknown group, 409 config/scope, 422 ceiling, 503 storage/Jira, standard 401. After headers: typed terminal error frame, never raw upstream text |
| POST `/api/eng/board/control` | `authenticated_preview`; same generation owner and token/config partition; standard token CSRF plus `X-Requested-With: jira-execution-planner` | `{generationId, action:"focus"|"cancel", columnId?}`; column required only for focus; reject extra fields | `{accepted:true, revision:integer}` | 400 malformed, 404 foreign/unknown generation, 409 inactive/config/auth-version stale, 503 storage, standard 401 |

Use one small `board_generation_controls` row: random generation ID, owner partition digest, config digest, allowed column IDs, focused column ID, revision integer, state `active|cancelled|complete|failed`, created/expiry timestamps. No issue keys, payloads, tokens, raw names, JQL or user search. TTL 120 seconds is a cleanup bound, not proof work has stopped. Create/claim atomically once before streaming; duplicate claims are rejected, never resumed or stolen. Terminal controls fail. Batch cleanup expired rows. Existing DB migrations only; no broker, manifest cache or browser-held authoritative token.

The stream alone owns counters and Jira payloads. Before every Jira page, retry and queued batch it reads the latest control row, checks cancellation/config/auth versions and applies focus changes only to pending work. At most two in-flight searches continue; controls cannot spawn parallel owners. Cross-worker control writes must be visible to the stream. DB/control failure terminally fails scheduling. Full refresh and Retry create new generations; there is no automatic reconnect or failed-request replay.

Frame contract (closed discriminated union, protocolVersion=1 on every frame):

```typescript
type Base = { protocolVersion: 1; generationId: string; sequence: number };
type Frame = Base & (
  | { type: 'start'; scope: 'all_work'|'sprint'; scopeVersion: string; columns: Column[] }
  | { type: 'index'; epics: EpicShell[]; membership: 'candidate'|'authoritative' }
  | { type: 'progress'; columnId: string; loadedChildren: number; byEpic: Progress[] }
  | { type: 'column'; columnId: string; epics: EpicShell[]; children: Child[]; authoritative: true }
  | { type: 'column_error'; columnId: string; code: 'jira_unavailable'; retryable: true }
  | { type: 'complete'; outcome: 'success'; authoritative: true; epicCount: number; childCount: number; diagnostics: Diagnostics }
  | { type: 'complete'; outcome: 'partial_error'; authoritative: false; failedColumnIds: string[]; diagnostics: Diagnostics }
  | { type: 'error'; code: 'auth_required' }
  | { type: 'error'; code: 'scope_changed'|'scope_too_large'|'deadline_exceeded'|'invalid_page'|'storage_unavailable'|'jira_unavailable'; diagnostics?: Diagnostics }
);
```

Use these closed wire types; adapters explicitly translate them to existing Board models. Missing optional upstream data is null, never an omitted discriminator. Reject unknown required identity or malformed numeric data. Do not serialize arbitrary Jira fields.

```typescript
type Person = { accountId: string; displayName: string; avatarUrl: string|null };
type Named = { id: string; name: string };
type Column = { id: string; name: string; color: string; statusNames: string[]; terminal: boolean };
type EpicShell = {
  key: string; summary: string; status: Named; priority: Named|null;
  assignee: Person|null; deliveryOwner: Person|null; projectTrack: string|null;
  updated: string|null; parent: { key: string; summary: string; issueType: Named }|null;
  columnId: string;
};
type Child = {
  key: string; epicKey: string; summary: string; status: Named; priority: Named|null;
  issueType: Named; assignee: Person|null; updated: string|null; storyPoints: number|null;
  team: Named|null; project: Named; projectClassification: 'product'|'tech'|'other';
  sprintIds: number[];
};
type Diagnostics = {
  indexMs: number; focusedCompleteMs: number|null; durationMs: number;
  jiraRequests: number; jiraPages: number; jiraRetries: number;
  cacheState: 'hit'|'miss'|'mixed'|'unknown'; completeness: 'complete'|'partial';
};
```

`scopeVersion` is a server-keyed digest of canonical sorted captured scope/config/auth partition data, never raw identities or a browser-supplied signature. Diagnostic counters cover catalog/index/child transport calls; include worker context propagation and physical retry counts. Browser owns decoded payload bytes and render timestamps. Terminal fatal errors may carry optional closed Diagnostics with completeness=partial; auth failures carry no diagnostic payload. Numeric fields are finite nonnegative; counts are integers. Apply Task 1's proven string/array/frame limits to every field. All-work authoritative Epic count remains in canonical index state if some columns fail; a partial-error frame cannot invent global child or selected-sprint Epic totals. `Progress={epicKey:string,loadedChildren:integer,statusCounts:Record<string,integer>}` is provisional display only. Task 1 must fix and test per-frame/per-generation byte limits from serialized candidate payloads before integration; no unbounded NDJSON line buffering. Global failure clears current provisional and child authority, not compatible stale committed snapshots. A column transport failure may preserve other columns; malformed global scope or ceiling failure may not publish completion success. EOF without terminal frame is failure.

## 5. Ordered implementation tasks

### Task 0 — baseline and contract preflight

Files: Read existing paths in this plan, `docs/plans/README.md`, support design, MRT004/MRT010/MRT023/MRT026, ownership contract and all GATE docs. Modify this plan's evidence/gate table only; create no standalone collector.

- [ ] Fetch the published base; verify every Modify/Test path exists and mark genuinely new files Create. Preserve active checkout and user changes; no worktree unless requested.
- [ ] Run full Python baseline with explicit isolated test config, frontend unit suite and build using pinned Node 20. Record failures honestly before changes.
- [ ] Query the in-app history read-only, grouped by scope/cache/revision/completeness; record sample count and lane issue counts. Preserve the three observations above as historical comparison.
- [ ] Freeze frame schema and product contract; any proposed change to scope initialization or Basic compatibility is a visible decision, not an inferred override.

### Task 1 — transport, hard-bound and focus feasibility gate

Create: `backend/services/eng_board_stream.py`, `frontend/src/api/engBoardApi.js`, `tests/test_eng_board_stream.py`, `tests/test_eng_board_stream.js`, `tests/ui/eng_board_stream.spec.js`. Modify: `frontend/src/api/http.js`; the later route/control/migration file map belongs to Task 3. Run a synthetic in-app prototype before binding production Board. The new Python stream test owns an isolated Flask app with prototype GET/control routes and a disposable PostgreSQL table created from test-only SQLAlchemy metadata. Use that fixture for two-worker and blocked-I/O checks; it may not register routes on backend/app.py or migrate the local application DB. Task 3 promotes the verified control contract into production schema/routes. The browser test serves the shared stream consumer against this prototype, not mocked buffering.

- [ ] RED: held EOF must deliver a first validated frame; ordinary buffered callers retain behavior. Test split UTF-8/NDJSON chunks, duplicate/nonmonotonic frames, malformed/oversized frames, abort and sibling API 401. The shared HTTP layer must own reader cancellation and terminal auth lock, never hook-level native fetch.
- [ ] Implement opt-in header-first streaming at the shared boundary; current `apiFetch` body buffering cannot deliver progress. Check auth lock and AbortSignal before every delivery. Auth-error frame invokes the same global sanitized lock as HTTP 401.
- [ ] Prototype two-worker focus control and bounded queue dispatch. Hold two in-flight searches, change focus through another worker, release one and prove the new focus is next; no duplicate owner, counter reset or third search.
- [ ] Prove three independent limits: immediate browser discard, no new scheduling after cancellation/checkpoint, and bounded termination of blocked auth/DB/Jira work. Requests timeouts plus cooperative checks alone do not prove the last. Inject blocked connect/read/refresh/config and worker shutdown. The design's 30s cooperative budget cannot be relabelled a hard deadline. If current runtime cannot meet the required bound, stop production integration and present a supervised killable execution design for review.
- [ ] Record actual frame sizes, select explicit bounded frame/total byte limits and completion deadline from prototype evidence, and add exact-bound/one-byte-over tests. Pass the transport gate before Task 3 wiring; leave the authored later tasks intact if blocked.

### Task 2 — shared strict core and saved Board grammar

Create: `backend/services/eng_board.py`, `tests/test_eng_board_service.py`. Modify: `backend/services/eng_board_measurement.py`, `backend/services/group_board.py`, `backend/services/group_config.py`, `frontend/src/settings/groupBoardModel.js`, `frontend/src/settings/groupConfigUtils.js`. Update existing measurement/group-board model tests discovered by symbol in Task 0.

- [ ] Write table-driven failures for all production profiles: Components, Team fallback, `other`, same-name Components in multiple projects, saved-board project fallback, absent Board, empty terminal status, retention 1/28/90, zero-child Epic and configured non-Story child types.
- [ ] Move/reuse core functions and extend strict paging with validated page callback and incremental global bounds. The diagnostic imports must test the same implementation.
- [ ] Preserve idempotent old Board normalization: infer terminal once as specified in support design, retain column IDs and existing assignments. Round-trip retention in backend/frontend; a dirty draft must not change live Board.
- [ ] Test transitions back into terminal, recent-created fallback, unknown status placement and malicious quoted scope values. Patch partial-result helpers to raise if invoked.

```python
# Required semantic assertions in the service tests (synthetic data only).
assert collect_pages(empty_nonfinal_then_last).complete is True
assert all_work_zero_child_epic.membership == 'authoritative'
assert sprint_zero_child_epic.included is False
# malformed paging, duplicate normalized keys and limits must raise, not return rows.
```

The names above describe test fixtures to create, not existing production APIs. Define actual fixtures in `tests/test_eng_board_service.py` before using them.

### Task 3 — generation service, route policies and DB controls

Create: `backend/routes/eng_board_routes.py`, `backend/db/migrations/versions/20260908_0015_board_generation_controls.py`, `tests/test_eng_board_routes.py`. Modify: `backend/services/eng_board.py`, `backend/services/eng_board_stream.py`, `backend/db/models.py`, `backend/app.py`, `backend/security/policy.py`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `tests/test_endpoint_policy_inventory.py`, `tests/test_endpoint_security_matrix.py`. Renumber the proposed migration if updated main has occupied 0015; down_revision must be actual head.

- [ ] RED route matrix: foreign group/generation, workspace/site/user/token/config mismatch, disabled user, malformed controls, absent CSRF/header, storage failure, duplicate claim, expiry, and current-user OAuth reaching the real search wrapper outside request context.
- [ ] Implement one immutable snapshot, claim, generator, bounded queue, focus/cancel control and cleanup. Authenticated reads may not select arbitrary projects or cache partitions. Return sanitized preheader errors; use terminal frames after headers.
- [ ] Index first; hydrate resolved focus column first then queued columns. Sprint qualification is one pass through direct children, never a separate key-only prefetch. Complete a column only after all its batches finish.
- [ ] No server payload cache in the initial candidate. Keep compatible complete client snapshots only; measure before introducing server caching. Never use process-local tokens or cache partial results. Check auth/config validity before canonical publication and terminal completion.
- [ ] Test PostgreSQL migration up/down/up and cross-worker controls against disposable DB. Do not migrate production. Verify long-lived streams do not exhaust the selected Gunicorn worker model.

### Task 4 — Board data owner and measurement schema

Create: `frontend/src/eng/useEngBoardData.js`, `tests/test_eng_board_data.js`. Modify: `frontend/src/api/engBoardApi.js`, `frontend/src/eng/loadPerformance.js`, `frontend/src/api/performanceApi.js`, `backend/services/load_performance.py`, `backend/db/models.py`, `backend/routes/performance_routes.py`, `frontend/src/settings/PerformanceSettings.jsx`, `tests/test_load_performance.py`, `tests/test_load_performance.js`. Create an additive migration for optional Board measurements only after verifying current head; preserve old rows/readers.

- [ ] RED state transitions: first visit, independent per-group sprint, focus while loading, late old generation, column error, global fatal, refresh with stale compatible snapshot, auth lock, retry, group revision change and unmount.
- [ ] Implement canonical Epic map plus column key references and separate provisional progress. Keep partial data out of facet/export/write authority. Reconcile membership atomically.
- [ ] Keep existing `eng_sprint` metrics unchanged. Add a versioned closed Board observation variant with `surface=eng_board`, `scopeType=all_work|sprint`, bounded `indexMs`, `firstFocusedContentMs`, `focusedCompleteMs`, `durationMs`, `dependencyDurationMs`, `epicCount`, `issueCount`, `payloadBytes`, `jiraRequests/pages/retries`, `completeness`, `outcome`. No forced product/tech lane pair in Board schema; one stream has one global unique count. Optional diagnostics split Product/Tech/other without duplicating total.
- [ ] Record at most once after render/terminal outcome, independently of GA4; no per-frame DB writes. Admin filters must separate surface/scope/cache/revision and never compare mixed Board/sprint distributions. Full completion metric must retain requested dependency cost; first-content metric remains separate.

### Task 5 — capability-gated retirement and preserved Board interactions

Modify: `backend/routes/settings_routes.py`, `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/EngBoardView.jsx`, `frontend/src/eng/EngBoardHelp.jsx`, `frontend/src/eng/EngFilterBar.jsx`, `frontend/src/eng/engFilterFacets.js`, `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `frontend/src/eng/engBoardColumns.js`, `frontend/src/eng/engBoardCardModel.js`, `frontend/src/eng/engBoardFilters.js`, `frontend/src/eng/useEngBoardFilters.js`, `frontend/src/components/JiraExportButton.jsx`, `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/eng/useEngPriorityTransitions.js`, `frontend/src/eng/useEngProjectTrackTransitions.js`. Create: `tests/test_eng_board_source_guards.py`; update existing Board unit/UI/source-guard tests.

- [ ] Add server-derived `boardAllWorkAvailable` capability in the existing config response, true only for DB/OAuth deployments with the new schema and approved transport/runtime gate enabled. Frontend defaults false until explicitly true. Strict routes reject unavailable capability with sanitized 409 `board_unavailable`; no browser override. In unavailable deployments preserve the existing selected-sprint Board and legacy calls, with All work unavailable. Test both capability paths; do not silently switch auth/config storage.
- [ ] When strict capability is true, assert zero inherited Product/Tech tasks, alerts, eager dependency and issue-lookup calls on Board entry, focus, refresh, long-absence refresh and mutation success. Cancel inherited in-flight requests and ignore late results. Leaving Board restores mandatory sprint/team behavior and runs exactly the required legacy load.
- [ ] Wire Board-only scope selector; All work remains visible but disabled with concise reason when configuration disallows it. Sprint-catalog error cannot disable a valid All work Board. Leave sibling mode state untouched.
- [ ] Use existing focus resolver via `onResolvedFocusChange`, not a second focus algorithm. Send control updates for queued priority, preserving two running searches.
- [ ] Render provisional Loaded so far counts and pending SP/project/filter/export states with current geometry. Preserve search typing and saved facet choices until authority arrives. Keep compact help and retry messages.
- [ ] Existing mutations retain existing authenticated write routes and CSRF. Serialize Board mutation adapter with generation restart, patch canonical Epic, invalidate incompatible data and preserve successful writes across refresh errors. Never refresh sprint-owned stores behind Board. Drag eligibility waits for complete required children.
- [ ] Verify cold load, zero/large columns, errors/retry, scroll/focus, both header layouts, terminal/unmapped position, 401 lock, export authority and Catch Up/Planning/Scenario sticky regressions with normal Playwright clicks and screenshots.

### Task 6 — Settings, analytics and documentation

Modify: `frontend/src/settings/GroupBoardSettings.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, existing Board/shared control styles only where necessary, `frontend/src/analytics/analytics.js`, `frontend/src/analytics/events.js`, `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `tests/test_frontend_api_source_guards.js`. Regenerate `frontend/dist` with build. Update GA4 runbook only if operator steps change.

- [ ] Retention uses existing shared Save/revision/conflict workflow. Settings draft, failed save and conflict preserve live saved scope; successful group save invalidates once even if another section later fails. No automatic overwrite or new config owner.
- [ ] Use existing `filter_changed` for explicit Board sprint changes with bounded `sprint_selection_state`, existing `app_search` only after membership authority, and one terminal `api_result` with `api_surface=eng_board`, `scope_type=all_work|sprint`, numeric duration. Keep `userevent`/`pageview` triggers and GA4_ENABLED transport gate. No IDs/names/JQL, per-frame events, disabled Team events or initialization events. Superseded/auth-locked generations emit no Board result.
- [ ] Document Component scope reuse, optional sprint only on Board, strict pending/complete semantics, retention and operational measurements. Internal timing storage remains analytics-allowlisted operational data, not GA4 traffic.

### Task 7 — in-app candidate evidence and release decision

Modify this plan, the companion handoff and accepted measurement record with sanitized outcomes; do not add a standalone benchmark requirement.

- [ ] Use normal local app paths with the user's existing auth. Compare same group/sprint/revision/cache class; first run selected-sprint candidate versus legacy sprint, then Component All work. Record unique workload counts, index/first-focused/full timings, requested dependencies, pages/bytes/retries, peak concurrency and completeness.
- [ ] Gather at least 20 complete successful observations per compared cohort, with errors/cancels/caps reported separately. Twenty is a minimum preliminary percentile sample, not statistical confidence. Include additional existing scopes if available; otherwise explicitly limit generalization and use synthetic tests for unavailable edge profiles.
- [ ] Keep 2s useful-content target and <=4s full-load p95 SLO visible. Any full-load p95 breach requires stage evidence and a reviewed remedy before rollout; do not pass based solely on a fast first column or cached average. Selected-sprint regression comparison must use comparable cache/dependency/workload states.
- [ ] Run full Python suite, frontend units, API/auth/security suites, candidate and existing Board browser tests, build, startup `/api/test` through supported auth, migration checks and diff review. Exercise blocked I/O and cross-worker focus gates against deployment-equivalent server configuration.
- [ ] Independent reviewer verifies contract, credentials, ownership, request retirement, authority and all gate evidence. Commit atomic slices; push only with user authorization. No merge/deploy from this handoff.

## 6. Gate disposition and stop points

| Gate | Current result | Required before production integration/rollout |
| --- | --- | --- |
| Existing in-app sprint baseline | Three contextual loads collected; user confirms instrumentation works | Keep counts and comparable cohort evidence; no invented complete p95 |
| Epic-first strict completeness | Unmeasured | Full token paging and production scope matrix tests plus actual candidate app observations |
| Streaming + live focus + cross-worker | Proposed, not proved | Task 1 held-EOF/auth/byte-bound tests and Task 3 cross-worker control checks |
| Hard termination deadline | Unsupported by cooperative diagnostic | Measured bounded blocked-I/O termination under chosen runtime; no Task 3 production binding if absent |
| Basic/JSON parity | Not solved by DB control rows | Explicitly review compatibility before enabling new Board where DB is unavailable; retain existing behavior there until supported, never fall back to Basic inside OAuth |
| Visible progress and SLO | No candidate data | First focused content before full completion; separate complete-load p95 gate and no hidden spikes |
| Home write gate | Blocked, unrelated | No Home route or write work in this feature |

An unsupported gate blocks its dependent integration/release task, not plan authorship or independent tests. If the recommended transport needs a strategic change, revise and review this contract before implementation; never silently lower completeness, focus, deadline or auth requirements.

## Plan review outcome

Independent source review completed on 2026-09-08. Corrected prototype/production task circularity, strict-capability versus legacy compatibility, partial-result count authority, explicit wire diagnostics/types, and per-page cancellation checks. All referenced existing paths were verified; absent paths are marked Create. No production implementation or candidate performance gate is claimed passed.
