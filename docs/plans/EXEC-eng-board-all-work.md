# ENG Board All work implementation plan — issue #137

> **Status:** Execution continued on 2026-09-08 after merging current `origin/main`. The reopened Task 2 strict-core corrections and Task 4 delayed-sprint initialization correction are implemented, independently reviewed, and verified locally. Hard termination still blocks Task 3 and every dependent production integration/activation task. No production readiness is claimed; the supervisor proposal and Task 3B adapter remain unapproved.
> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Follow repository instruction chains and the companion [handoff](SUPPORT-eng-board-all-work-handoff.md).

**Goal:** Deliver Board-owned Component-scoped Epic discovery, optional sprint filtering, and focused-column-first complete direct-child loading without changing sibling ENG modes.

**Recommended architecture:** Reuse the strict diagnostic query/paging core in one Board service. One authenticated streaming request owns issue data, global counters and at most two child searches. A small DB control row carries live focus/cancel signals across workers; it never stores Jira issues. The frontend has one Board-owned generation and explicit provisional versus authoritative state. Validate this transport in Task 1 before production integration; the existing cooperative diagnostic is not deadline evidence.

**Stack:** Existing Flask/Python, PostgreSQL/SQLAlchemy, React 19, esbuild and Node 20. No new package dependency proposed.

## Resume contract — review corrections first

This section and the corrective checkboxes supersede earlier completion claims in the historical execution records. The local corrective implementation is complete; it does not approve a runtime architecture or production integration. Keep work in the existing checkout.

| Next work | Entry condition | Completion evidence |
| --- | --- | --- |
| Task 2 corrective slice | Complete locally | Strict projection/catalog regressions, composed stream/state membership checks and focused suites pass |
| Task 4 initialization correction | Complete locally | Missing sprint → first valid sprint causes exactly one load; explicit All work, initialized sprint and per-Department state are preserved |
| Task 1 runtime decision | Source/design review may proceed; supervisor implementation is not approved | Amend the supervisor proposal with concrete ingress, ownership, resource limits, deployment file map and test harness; obtain architectural approval, then prove the transport/runtime gate |
| Task 3 DB/OAuth integration | Corrected core plus approved and passing Task 1 | Route/security/control/migration and two-worker evidence; no implicit approval from isolated test success |
| Task 3B Basic/JSON compatibility | Contract review may proceed; selected transport requires approval before implementation | Implement and measure strict All work and selected-sprint parity; legacy fallback alone never closes this task |
| Tasks 5–7 | Follow their dependent integration gates | Preserved UI journeys, candidate measurements and full-scope release evidence |

For the next corrective implementation, modify only `backend/services/eng_board.py`, `tests/test_eng_board_service.py`, `frontend/src/eng/useEngBoardData.js`, `tests/test_eng_board_data.js`, these active plan/status documents, and build-generated `frontend/dist/` outputs (never hand-edit them). Extend `tests/test_eng_board_stream.py` or `tests/test_eng_board_stream.js` only where needed to prove the corrected projection crosses the existing wire adapter. Read each target's instruction chain first. Do not add routes, modify auth/config ownership, migrate the application DB, or select a new runtime as part of these corrections.

Required focused commands after adding the regression tests (use the repository Node 20 toolchain):

```bash
.venv/bin/python -m unittest tests.test_eng_board_service tests.test_eng_board_measurement tests.test_eng_board_stream -v
node --test tests/test_eng_board_data.js tests/test_eng_board_stream.js
npm run build
```

Record the new regression tests failing before their corresponding fixes and passing afterward. The delayed-initialization test must exercise the owner API, not just a reducer fixture. The absent-Board test must compose normalization and projection with a real eligible synthetic child, then validate declared-column membership through the stream/state boundary. Build generated frontend output from source. Before publication, run the full repository verification and publication contract; this preparation grants no commit/push/PR authorization. The companion handoff is a local draft until its exact revision is published and verified fetchable.

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

The settled semantics in [support design](SUPPORT-eng-board-optional-sprint-design.md), sections “Settled product decisions” through “Analytics impact”, remain authoritative except its superseded prohibition on plan authorship and its unselected transport alternatives. Its excluded-profile measurement gate applies before production rollout, not before independent development or a gated candidate. Synthetic tests do not replace that evidence. Task 7 explicitly retains the 100ms loading-feedback and 10% first-content regression gates. This plan proposes a concrete transport for validation; it does not silently change those product decisions or authorize a partial release.

- Board-only `uninitialized | all_work | sprint` scope, per Department for the mounted document. Preserve the reviewed first-visit initialization from the mandatory ENG sprint, then maintain independent Board state. The original issue requested an unselected default; the subsequent settled design deliberately chose first-visit inheritance. Changing that choice requires an explicit product amendment. No shared/private-view persistence or auth-resume persistence of Board scope.
- Components are the existing shared `groups[].missingInfoComponents`. Match exact names across all server-selected projects at the Epic boundary. No browser project/JQL/Epic-key authority and no new Component field.
- All work requires Components and a saved valid Board; include zero-child Epics. Selected sprint includes only matching configured eligible direct children and qualifies Epics from those children. With no Components use all saved Department Teams; with neither source fail scoped validation. Absent Board supports selected-sprint `board-unconfigured` only.
- Resolve configured standard issue types using hierarchy level zero/non-subtask; absent config defaults Story, explicit empty selects all eligible types. Preserve Epic-Link precedence over Epic-typed parent. Do not eagerly fetch subtasks.
- Preserve terminal identity, last-column position, `board-unmapped` immediately before terminal, 1–90-day retention (default 28), conservative recent-created terminal fallback and status transition JQL. Never use `updated` for retention. Empty terminal statuses add no retention clause.
- Board Teams controls remain visible, disabled and non-filtering in main and compact headers. Help stays in `EngBoardHelp`; preserve existing cards, focus, filters, drag/drop and field controls.
- Epic-native facets and All work Epic export become authoritative at complete index. Selected-sprint global Epic authority waits for every column to qualify. Child-derived Projects, SP, drag safety and work-item export remain pending until required cohorts are complete. Pending is never numeric zero. Search preserves input/focus and stays neutral until membership authority.

## 3. Immutable scope, strict paging and limits

Read `backend/security/CONFIGURATION_OWNERSHIP.md`. Capture RequestAuthContext, current workspace/site/user/token version, uncached shared Department and dashboard revisions/digests, field IDs, project access and eligible issue-type catalog before worker work. Worker code receives the snapshot and injected authenticated search only. No Flask globals/config getters inside worker threads. Config failure is sanitized 503; no fallback to JSON/service credentials in DB/OAuth.

Before claiming a generation, validate/refresh the current user's Jira token through the existing DB token resolver and let its transaction commit; then resolve a fresh RequestAuthContext rather than reusing a request-cached pre-refresh context. Capture metadata/catalog and revalidate the captured auth/config versions before claim. A catalog-triggered or concurrent rotation during capture returns sanitized 409 `scope_changed` without claiming a generation. After claim, any token-version change ends that generation with `scope_changed`, preserves only compatible stale snapshots and offers explicit Retry; never advance its immutable partition in place or automatically replay a read. Ordinary successful rotation is not `auth_required`; actual revoked/disabled/expired browser authentication retains standard 401/global-lock behavior. Test the real `jira_server.current_jira_get` → `db_oauth_session_data` → `refresh_db_oauth_token` path, whose successful refresh increments `token_version`. Pre-claim refresh, capture and validation remain inside the proposed killable admission boundary and consume the same deadline; this amendment does not approve that runtime boundary.

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

One generation-local frontend writer serializes focus POSTs: allow one outstanding focus request, coalesce later resolved focus changes to the newest column, and dispatch it only after the previous response confirms the committed control revision. Responses may acknowledge delivery but never overwrite current UI focus. On an ambiguous network failure, retire the generation rather than sending another focus request that could race a still-running write. Cancel clears queued focus immediately and may bypass the writer; all server focus updates atomically require `state=active`, and cancellation is terminal regardless of transaction order. Generation retirement prevents every old acknowledgement from scheduling more work. The response revision is an acknowledgement, not an ordering mechanism for concurrent focus commands; no request-schema extension is needed with this serialized contract.

Frame contract (closed discriminated union, protocolVersion=1 on every frame):

```typescript
type Base = { protocolVersion: 1; generationId: string; sequence: number };
type Frame = Base & (
  | { type: 'start'; scope: 'all_work'|'sprint'; scopeVersion: string; scopeCohortDigest: string; columns: Column[] }
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
  jiraRequests: number; jiraPages: number; jiraRetries: number; peakChildSearches: number;
  cacheState: 'hit'|'miss'|'mixed'|'unknown'; completeness: 'complete'|'partial';
};
```

`scopeVersion` is a server-keyed digest of canonical sorted captured scope/config/auth partition data, never raw identities or a browser-supplied signature. Diagnostic counters cover catalog/index/child transport calls; include worker context propagation and physical retry counts. Browser owns decoded payload bytes and render timestamps. Terminal fatal errors may carry optional closed Diagnostics with completeness=partial; auth failures carry no diagnostic payload. Numeric fields are finite nonnegative; counts are integers. Apply Task 1's proven string/array/frame limits to every field. All-work authoritative Epic count remains in canonical index state if some columns fail; a partial-error frame cannot invent global child or selected-sprint Epic totals. `Progress={epicKey:string,loadedChildren:integer,statusCounts:Record<string,integer>}` is provisional display only. Task 1 must fix and test per-frame/per-generation byte limits from serialized candidate payloads before integration; no unbounded NDJSON line buffering. Global failure clears current provisional and child authority, not compatible stale committed snapshots. A column transport failure may preserve other columns; malformed global scope or ceiling failure may not publish completion success. EOF without terminal frame is failure.

`scopeCohortDigest` is a separate 64-character lowercase hexadecimal server-keyed digest for operational comparisons. Canonical inputs include stable workspace/site/user partition, Department identity, captured shared config revisions/content, effective projects/access, fields, eligible types, Components/Teams, Board/retention and selected scope/sprint. Exclude token version, generation ID, focus, timestamps and build revision so ordinary rotation does not split an otherwise comparable cohort. It is never authority for a route, config lookup or cache read. Store it only with internal measurements, never in GA4. `peakChildSearches` is the maximum simultaneous child searches over the generation, an integer 0–2 measured by the shared scheduler, not the configured ceiling. `cacheState` describes measured server source-data reuse; a displayed stale client snapshot is not a server cache hit. With no server payload cache the initial candidate reports miss, or mixed if measured metadata reuse occurs; unknown cache state cannot establish a comparable acceptance cohort.

## 5. Ordered implementation tasks

### Task 0 — baseline and contract preflight

Files: Read existing paths in this plan, `docs/plans/README.md`, support design, MRT004/MRT010/MRT023/MRT026, ownership contract and all GATE docs. Modify this plan's evidence/gate table only; create no standalone collector.

- [x] Fetch the published base; verify every Modify/Test path exists and mark genuinely new files Create. Preserve active checkout and user changes; no worktree unless requested.
- [x] Run full Python baseline with explicit isolated test config, frontend unit suite and build using pinned Node 20. Record failures honestly before changes.
- [x] Query the in-app history read-only, grouped by scope/cache/revision/completeness; record sample count and lane issue counts. Four observations verified in section 6; preserve the three successful observations above as historical comparison and check for newer rows on resume.
- [x] Freeze frame schema and product contract; any proposed change to scope initialization or Basic compatibility is a visible decision, not an inferred override.

### Task 1 — transport, hard-bound and focus feasibility gate

Modify: `backend/services/eng_board_stream.py`, `frontend/src/api/engBoardApi.js`, `tests/test_eng_board_stream.js`, `tests/ui/eng_board_stream.spec.js`, `frontend/src/api/http.js`, `tests/test_eng_board_stream.py`; the later route/control/migration file map belongs to Task 3. Run a synthetic in-app prototype before binding production Board. Extend the Python stream test with an isolated Flask app owning prototype GET/control routes and a disposable PostgreSQL table created from test-only SQLAlchemy metadata. Preserve its existing limitation probe. Use that fixture for two-worker and blocked-I/O checks; it may not register routes on backend/app.py or migrate the local application DB. Task 3 promotes the verified control contract into production schema/routes. The browser test serves the shared stream consumer against this prototype, not mocked buffering.

- [x] RED: held EOF must deliver a first validated frame; ordinary buffered callers retain behavior. Test split UTF-8/NDJSON chunks, duplicate/nonmonotonic frames, malformed/oversized frames, abort and sibling API 401. The shared HTTP layer must own reader cancellation and terminal auth lock, never hook-level native fetch.
- [x] Implement opt-in header-first streaming at the shared boundary; current `apiFetch` body buffering cannot deliver progress. Check auth lock and AbortSignal before every delivery. Auth-error frame invokes the same global sanitized lock as HTTP 401.
- [ ] Prototype two-worker focus control and bounded queue dispatch. Hold two in-flight searches, change focus through another worker, release one and prove the new focus is next; no duplicate owner, counter reset or third search.
- [ ] Test the serialized focus writer with delayed A acknowledgement and newer B/C intent: only A is sent until acknowledgement, then only C. Hold a server focus transaction across cancel and prove either commit order ends cancelled with no later scheduling. Test lost acknowledgement, old-generation completion and no automatic replay.
- [ ] Prove three independent limits: immediate browser discard, no new scheduling after cancellation/checkpoint, and bounded termination of blocked auth/DB/Jira work. Requests timeouts plus cooperative checks alone do not prove the last. Inject blocked connect/read/refresh/config and worker shutdown. The design's 30s cooperative budget cannot be relabelled a hard deadline. If current runtime cannot meet the required bound, stop production integration and present a supervised killable execution design for review.
- [ ] Record actual frame sizes, select explicit bounded frame/total byte limits and completion deadline from prototype evidence, and add exact-bound/one-byte-over tests. Pass the transport gate before Task 3 wiring; leave the authored later tasks intact if blocked.

### Task 2 — shared strict core and saved Board grammar

Modify: `backend/services/eng_board.py`, `tests/test_eng_board_service.py`, `backend/services/eng_board_measurement.py`, `backend/services/group_board.py`, `backend/services/group_config.py`, `frontend/src/settings/groupBoardModel.js`, `frontend/src/settings/groupConfigUtils.js`. Update existing measurement/group-board model tests discovered by symbol in Task 0.

- [x] Reopened after source review: complete composed table-driven coverage for all production profiles: Components, Team fallback, `other`, same-name Components in multiple projects, saved-board project fallback, absent Board, empty terminal status, retention 1/28/90, zero-child Epic and configured non-Story child types.
- [x] Fix absent-Board projection in `project_board`: `normalize_board(None)` declares only `board-unconfigured`, so every qualifying selected-sprint Epic must reference that column, never `board-unmapped`. Keep All work rejected for absent Board. Test a nonempty eligible child cohort, zero-child sprint exclusion, and a configured Board with an unknown status still using `board-unmapped`. Validate the adapted frames with the existing closed stream schema and assert every Epic/child cohort refers to a declared column; normalizer-only assertions do not close this check.
- [x] Make `resolve_issue_type_ids` reject missing/malformed hierarchy metadata instead of silently omitting uncertain catalog entries. Validate catalog row shape, nonblank identity/name, integer non-boolean `hierarchyLevel`, and boolean `subtask` before eligibility selection. Valid Epic/Subtask entries remain excluded, not errors. Test mixed valid Story plus malformed Bug/Task with explicit empty configured names; missing hierarchy, boolean/string hierarchy and malformed subtask must fail scope before search. Also retain absent-config Story default, explicit-empty all-eligible, multiple eligible IDs per configured name, and unmatched-name errors.
- [x] Move/reuse core functions and extend strict paging with validated page callback and incremental global bounds. The diagnostic imports must test the same implementation.
- [x] Preserve idempotent old Board normalization: infer terminal once as specified in support design, retain column IDs and existing assignments. Round-trip retention in backend/frontend; a dirty draft must not change live Board.
- [x] Test transitions back into terminal, recent-created fallback, unknown status placement and malicious quoted scope values. Patch partial-result helpers to raise if invoked.

```python
# Required semantic assertions in the service tests (synthetic data only).
assert collect_pages(empty_nonfinal_then_last).complete is True
assert all_work_zero_child_epic.membership == 'authoritative'
assert sprint_zero_child_epic.included is False
# malformed paging, duplicate normalized keys and limits must raise, not return rows.
```

The names above describe test fixtures to create, not existing production APIs. Define actual fixtures in `tests/test_eng_board_service.py` before using them.

### Task 3 — generation service, route policies and DB controls

Create: `backend/routes/eng_board_routes.py`, `backend/db/migrations/versions/20260908_0016_board_generation_controls.py`, `tests/test_eng_board_routes.py`. Modify: `backend/services/eng_board.py`, `backend/services/eng_board_stream.py`, `backend/db/models.py`, `backend/app.py`, `backend/security/policy.py`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `tests/test_endpoint_policy_inventory.py`, `tests/test_endpoint_security_matrix.py`. The current branch already contains measurement revision `20260908_0015`; the provisional control revision is `20260908_0016` with `down_revision=20260908_0015`. Re-read all current source revisions immediately before creation and allocate from the actual branch head, including local work, regardless of what main contains. Do not edit or duplicate the existing 0015 migration. Unexpected multiple heads require reconciliation review, not an invented parent.

- [ ] RED route matrix: foreign group/generation, workspace/site/user/token/config mismatch, disabled user, malformed controls, absent CSRF/header, storage failure, duplicate claim, expiry, and current-user OAuth reaching the real search wrapper outside request context.
- [ ] Exercise expired-token preflight refresh with fresh post-commit context and a successful claim. Force rotation during catalog capture, between child pages and alongside a control request; require preheader 409 or terminal `scope_changed`, no stale publication/replay and no global auth lock for successful rotation. Separately prove revoked connection/disabled user still locks auth. Verify focus acknowledgement follows DB commit and terminal state prevents a delayed focus update from reviving cancellation.
- [ ] Implement one immutable snapshot, claim, generator, bounded queue, focus/cancel control and cleanup. Authenticated reads may not select arbitrary projects or cache partitions. Return sanitized preheader errors; use terminal frames after headers.
- [ ] Index first; hydrate resolved focus column first then queued columns. Sprint qualification is one pass through direct children, never a separate key-only prefetch. Complete a column only after all its batches finish.
- [ ] No server payload cache in the initial candidate. Keep compatible complete client snapshots only; measure before introducing server caching. Never use process-local tokens or cache partial results. Check auth/config validity before canonical publication and terminal completion.
- [ ] Test PostgreSQL migration up/down/up and cross-worker controls against disposable DB. Do not migrate production. Verify long-lived streams do not exhaust the selected Gunicorn worker model.

### Task 3B — Basic/JSON strict compatibility (required for full release)

This is the missing implementation obligation for the already retained release scope. It does not authorize a new storage/runtime architecture or changing the user's running auth profile. Task 3 and a gated DB/OAuth candidate may proceed without it; full rollout may not.

Contract work modifies this plan and the companion handoff. Read `backend/security/policy.py`, `backend/security/guards.py`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `jira_server.py`, `scripts/docker-entrypoint.sh` and the Task 3 route/core contracts. After approval, reuse the Task 3 routes/core/stream, existing config capability response and frontend owner; add the approved compatibility adapter and tests to this task's exact Create/Modify map before execution.

- [ ] Specify and review how non-DB deployments own generation identity, cross-worker focus/cancel, atomic global budgets and configuration invalidation. Name the existing Basic auth boundary and its actual deployment isolation; do not invent OAuth users/workspaces, introduce hidden DB requirements, or use a worker-local registry. Recommend reusing the reviewed supervisor as the shared control owner if its prototype supports this safely; compare its lifecycle/IPC costs against the support design's other transport choices before approval.
- [ ] Freeze the Basic/JSON method/auth/header/CSRF, generation ownership, request/success/error and restart contracts in section 4. Preserve existing mode-specific security requirements, server-owned saved scope and current Basic credential resolution only within Basic mode; prove DB/OAuth never falls back to Basic/JSON. Define JSON config snapshot/change detection and controls after owner death. Record numeric resource/deadline limits and a complete deployment/source/test file map before implementation.
- [ ] Implement the approved adapter using the same strict pager, projection, frame schema and frontend state owner. Enable the same server-derived capability only when that deployment's adapter and runtime gates pass. Keep unavailable deployments on legacy selected-sprint Board until then; no duplicate query core or browser-selected auth mode.
- [ ] Verify strict selected-sprint and All work, absent Board, two-worker focus/cancel, reload/config changes, foreign-generation rejection, malformed controls, blocked I/O and shutdown in an isolated deployment. Negative tests must patch the actual forbidden credential/config resolution symbols. Measure the existing Task 7 excluded profiles without modifying the user's shared configuration or auth profile to manufacture evidence.
- [ ] Close full-release compatibility only with strict feature evidence. If the transport cannot be implemented within reviewed constraints, report this task blocked and seek an explicit release-scope amendment; do not relabel legacy regression coverage as parity.

### Task 4 — Board data owner and measurement schema

Modify: `frontend/src/eng/useEngBoardData.js`, `tests/test_eng_board_data.js`, `frontend/src/api/engBoardApi.js`, `frontend/src/eng/loadPerformance.js`, `frontend/src/api/performanceApi.js`, `backend/services/load_performance.py`, `backend/db/models.py`, `backend/routes/performance_routes.py`, `frontend/src/settings/PerformanceSettings.jsx`, `tests/test_load_performance.py`, `tests/test_load_performance.js`. Measurement migration `backend/db/migrations/versions/20260908_0015_board_load_performance.py` already exists; preserve it and old rows/readers. Allocate any newly required additive migration from the actual source head, never recreate the completed migration.

- [x] Reopened after source review: RED state transitions, including delayed first-visit sprint discovery, independent per-group sprint, focus while loading, late old generation, column error, global fatal, refresh with stale compatible snapshot, auth lock, retry, group revision change and unmount.
- [x] Fix `select_group`/`selectGroup` so an existing `uninitialized` scope inherits the first later valid mandatory sprint exactly once and reports a change that starts loading. Missing/failed discovery still issues no query. Exercise `selectGroup(group, null, revision)` → load → `selectGroup(group, validSprint, revision)` → load; assert one stream request and the selected sprint. Repeated catalog updates, revisits, and sibling sprint changes must not overwrite an initialized Board scope. Explicit All work while discovery is pending survives later catalog success. Include independent Departments and retained query state; add the corresponding delayed-catalog browser barrier case in Task 5.
- [x] Implement canonical Epic map plus column key references and separate provisional progress. Keep partial data out of facet/export/write authority. Reconcile membership atomically.
- [x] Keep existing `eng_sprint` metrics unchanged. Add a versioned closed Board observation variant with `surface=eng_board`, `scopeType=all_work|sprint`, bounded `indexMs`, `firstFocusedContentMs`, `focusedCompleteMs`, `durationMs`, `dependencyDurationMs`, `epicCount`, `issueCount`, `payloadBytes`, `jiraRequests/pages/retries`, `completeness`, `outcome`, `cacheState=hit|miss|mixed|unknown`, `peakChildSearches` (integer 0–2 when measured, otherwise null), and `scopeCohortDigest` from start (null if start was never received). Retain the load/group identity envelope; Board All work uses null sprint rather than a fabricated ID. Failed/cancelled streams lacking terminal diagnostics retain null counters and unknown cache state rather than invented values. No forced product/tech lane pair in Board schema; one stream has one global unique count. Optional diagnostics split Product/Tech/other without duplicating total.
- [x] Persist and read back the added fields through ingestion, migration and admin filters. Build `revision` remains the existing application revision, distinct from captured configuration cohort. Older rows retain null/unknown new fields and remain contextual; never backfill them from today's config. Test same group/sprint/build with changed Components/Board settings yields different cohorts, token rotation alone preserves the cohort, unknown fields cannot pass eligibility, and out-of-range concurrency is rejected. Add null-safe mixed legacy/Board report and migration tests.
- [ ] Record at most once after render/terminal outcome, independently of GA4; no per-frame DB writes. Admin filters must separate surface/scope/cache/build revision/configuration cohort and never compare mixed Board/sprint distributions. Candidate eligibility requires success, complete authority and known cohort/cache/concurrency; unknown legacy rows do not count toward candidate samples. Full completion metric must retain requested dependency cost; first-content metric remains separate.

### Task 5 — capability-gated retirement and preserved Board interactions

Modify: `backend/routes/settings_routes.py`, `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/EngBoardView.jsx`, `frontend/src/eng/EngBoardHelp.jsx`, `frontend/src/eng/EngFilterBar.jsx`, `frontend/src/eng/engFilterFacets.js`, `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `frontend/src/eng/engBoardColumns.js`, `frontend/src/eng/engBoardCardModel.js`, `frontend/src/eng/engBoardFilters.js`, `frontend/src/eng/useEngBoardFilters.js`, `frontend/src/components/JiraExportButton.jsx`, `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/eng/useEngPriorityTransitions.js`, `frontend/src/eng/useEngProjectTrackTransitions.js`. Create: `tests/test_eng_board_source_guards.py`; update existing Board unit/UI/source-guard tests.

- [ ] Add server-derived `boardAllWorkAvailable` capability in the existing config response, true only when the current deployment has an implemented strict adapter and passing transport/runtime gates. Initially only DB/OAuth with the new schema qualifies; Task 3B must extend eligibility to verified Basic/JSON before full release. Frontend defaults false until explicitly true. Strict routes reject unavailable capability with sanitized 409 `board_unavailable`; no browser override. In unavailable deployments preserve the existing selected-sprint Board and legacy calls, with All work unavailable. Test both capability paths; do not silently switch auth/config storage.
- [ ] When strict capability is true, assert zero inherited Product/Tech tasks, alerts, eager dependency and issue-lookup calls on Board entry, focus, refresh, long-absence refresh and mutation success. Cancel inherited in-flight requests and ignore late results. Leaving Board restores mandatory sprint/team behavior and runs exactly the required legacy load.
- [ ] Wire Board-only scope selector; All work remains visible but disabled with concise reason when configuration disallows it. Sprint-catalog error cannot disable a valid All work Board. Leave sibling mode state untouched.
- [ ] Use existing focus resolver via `onResolvedFocusChange`, not a second focus algorithm. Send control updates for queued priority, preserving two running searches.
- [ ] Render provisional Loaded so far counts and pending SP/project/filter/export states with current geometry. Preserve search typing and saved facet choices until authority arrives. Keep compact help and retry messages.
- [ ] Replace strict Board's `collectJiraExportKeysFromTasks(..., 'stories')` caller in `dashboard.jsx` with `normalizeJiraExportKeys` over authoritative, facet/search-filtered canonical children. Read `frontend/src/jiraExportUtils.mjs`; preserve its Story-only collector and all legacy callers. Extend `JiraExportButton` with optional Board work-item keys/label metadata while keeping legacy props/defaults. Strict Board labels say Work items and export every configured eligible type. Update `tests/test_jira_export_source_guards.js`, `tests/test_eng_board_data.js` and `tests/ui/eng_group_board_view.spec.js` with mixed Story/Bug/Task, non-Story-only, filtered, pending and authoritative-empty cases; assert exact exported keys and no pending export action.
- [ ] Existing mutations retain existing authenticated write routes and CSRF. Serialize Board mutation adapter with generation restart, patch canonical Epic, invalidate incompatible data and preserve successful writes across refresh errors. Never refresh sprint-owned stores behind Board. Drag eligibility waits for complete required children.
- [ ] Verify cold load, zero/large columns, errors/retry, scroll/focus, both header layouts, terminal/unmapped position, 401 lock, export authority and Catch Up/Planning/Scenario sticky regressions with normal Playwright clicks and screenshots.

### Task 6 — Settings, analytics and documentation

Modify: `frontend/src/settings/GroupBoardSettings.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, existing Board/shared control styles only where necessary, `frontend/src/analytics/analytics.js`, `frontend/src/analytics/events.js`, `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `tests/test_frontend_api_source_guards.js`. Regenerate `frontend/dist` with build. Update GA4 runbook only if operator steps change.

- [ ] Retention uses existing shared Save/revision/conflict workflow. Settings draft, failed save and conflict preserve live saved scope; successful group save invalidates once even if another section later fails. No automatic overwrite or new config owner.
- [ ] Use existing `filter_changed` for explicit Board sprint changes with bounded `sprint_selection_state`, existing `app_search` only after membership authority, and one terminal `api_result` with `api_surface=eng_board`, `scope_type=all_work|sprint`, numeric duration. Keep `userevent`/`pageview` triggers and GA4_ENABLED transport gate. No IDs/names/JQL, per-frame events, disabled Team events or initialization events. Superseded/auth-locked generations emit no Board result.
- [ ] Strict Board Work items export retains `external_link_opened` with `link_type=jira_issue_list`, bounded count and existing `issue_kind=mixed` for its type-general action; Epic export remains `epic` and legacy Story actions remain `story`. Read `frontend/src/analytics/externalLinks.js` and reuse its existing allowlist. Cover label/event behavior in the export browser test and taxonomy docs; add no new event or high-cardinality dimension.
- [ ] Document Component scope reuse, optional sprint only on Board, strict pending/complete semantics, retention and operational measurements. Internal timing storage remains analytics-allowlisted operational data, not GA4 traffic.

### Task 7 — in-app candidate evidence and release decision

Modify this plan, the companion handoff and accepted measurement record with sanitized outcomes; do not add a standalone benchmark requirement.

- [ ] Use normal local app paths with the user's existing auth. First run selected-sprint candidate versus legacy sprint, then Component All work. Keep group/sprint, saved configuration cohort, cache/dependency/workload states and recorded build revisions comparable; never mix builds within a cohort. Legacy rows lacking a configuration digest require contemporaneous, verified unchanged-scope evidence in the accepted measurement record to support a contextual regression comparison; otherwise collect a comparable baseline through the app. Record unique workload counts, index/first-focused/full timings, requested dependencies, pages/bytes/retries, measured peak child-search concurrency and completeness.
- [ ] Count existing eligible candidate DB rows first and collect only the shortfall toward 20 complete successful observations per compared cohort, with errors/cancels/caps reported separately. This is an acceptance target after the candidate exists. Twenty is a minimum preliminary percentile sample, not statistical confidence. Synthetic tests for unavailable edge profiles permit independent development only. Before production rollout retain measured nontrivial coverage of excluded paths: retention 1/28/90, empty terminal statuses, other children, absent Board, saved-board project fallback, Basic/JSON compatibility and multi-worker transport, including paging/batching/concurrency, projection stability, retries/rate limits and hard deadline. Missing profiles remain an explicit release blocker; do not create shared configuration or change the user's auth profile to manufacture evidence. A release omitting settled scope requires separate explicit approval.
- [ ] Assert loading feedback is visible within 100ms of Board activation/scope change/refresh in `tests/ui/eng_group_board_view.spec.js`, using browser timing plus a painted loading-state assertion. For comparable selected-sprint cohorts record baseline and candidate median user-visible first-content times and require `(candidateMedian / baselineMedian - 1) * 100 <= 10`; a missing/zero baseline is unverified, never a pass. Use the same visible-content milestone and distinguish stale snapshot display from fresh candidate content. Preserve the 2s useful-content target and <=4s full-load p95 SLO. In `tests/test_load_performance.js`, test the acceptance calculation rejects a synthetic 800ms→1500ms regression even though both are below 2s. Any mandatory threshold breach requires stage evidence and a reviewed remedy before rollout; fast first content or cached averages cannot waive full completion.
- [ ] Run full Python suite, frontend units, API/auth/security suites, candidate and existing Board browser tests, build, startup `/api/test` through supported auth, migration checks and diff review. Exercise blocked I/O and cross-worker focus gates against deployment-equivalent server configuration.
- [ ] Independent reviewer verifies contract, credentials, ownership, request retirement, authority and all gate evidence. Commit atomic slices; push only with user authorization. No merge/deploy from this handoff.

## 6. Gate disposition and stop points

### Current DB evidence — checked 2026-09-08

Read-only PostgreSQL queries succeeded after the execution record's earlier aggregation failure. The local DB reports migration version `20260908_0014`, one workspace, one shared group-config row and one shared dashboard-config row. The one saved group has Components, Teams and Board columns. Existing inputs are available; current-user Jira access and candidate scope validation still belong to the signed-in app. No token contents were read.

`load_performance` now contains four observations for one group/sprint and two revisions: the three successful observations in section 1 and a cancelled 5,238ms load on the other revision (first content 2,579ms). All lane completeness values are unknown. Exclude cancellation from success summaries and keep revisions separate. A stored cancellation is not proof that server I/O stopped. The DB baseline-discovery gate is satisfied; candidate completeness, runtime and SLO gates are separate.

On resume, reuse existing rows before collecting more. Query through the configured local DB connection; a sandbox denial requires the normal approval retry, not a missing-data verdict. If aggregation fails, read SQL aggregates directly rather than requiring another campaign. SQL JSON values may already be decoded objects; do not unconditionally call `json.loads` on them. Group internally by workspace/environment/group/sprint/revision/cache/completeness and return only aggregates or session-local aliases, never identities.

Reproducible availability read against the existing local DB:

```sql
BEGIN READ ONLY;
SELECT version_num FROM alembic_version;
SELECT count(*) AS observations,
       count(DISTINCT group_id) AS groups,
       count(DISTINCT sprint_id) AS sprints,
       count(DISTINCT revision) AS revisions
FROM load_performance;
SELECT outcome, count(*) FROM load_performance GROUP BY outcome;
SELECT count(*) FROM workspace_group_configs;
SELECT count(*) FROM workspace_dashboard_configs;
ROLLBACK;
```

Head stamping and row existence do not prove schema parity or a current browser session. Migration up/down tests remain in a disposable DB; never reset the user's local DB, retrieve tokens, or change its auth profile to satisfy a gate.

| Gate | Current evidence | What it blocks and next action |
| --- | --- | --- |
| DB access and sprint baseline discovery | Satisfied: four observations, three success/one cancelled, two revisions | Does not block development. Reuse existing rows; no collection-from-zero requirement |
| Saved local scope | Available: shared configs and a group with Components, Teams and Board columns | No synthetic Department prerequisite. Validate saved scope and current Jira access through the candidate path |
| Epic-first strict completeness | Task 2 reopened: absent-Board projection and catalog validation fail the contract; no candidate rows | Implement the corrective tests/fixes now, then verify candidate authority through the app |
| First-visit Board initialization | Task 4 reopened: delayed sprint discovery remains uninitialized | Fix and verify owner transitions before Task 5 integration; no runtime or live-data prerequisite |
| Streaming + focus + cross-worker | Unproved by existing rows | Parser/auth/core tests can proceed; prototype and cross-worker checks still precede dependent production binding |
| Hard termination | Existing probe confirms blocked executor survives cancellation | Blocks Task 3 production binding/activation. Continue independent tasks; review runtime remedy separately. DB durations cannot pass this gate |
| Basic/JSON parity | Task 3B design/implementation outstanding; local DB is available | Blocks non-DB strict activation and full rollout. Implement the reviewed compatibility adapter, then measure it; legacy fallback is regression evidence only. Does not block the corrective slices or independent DB/OAuth development |
| Candidate progress and SLO | Candidate not yet built/measured | Acceptance gate after candidate exists. Separate config/cache/build cohorts; verify 100ms feedback, <=10% first-content median regression and <=4s full-load p95, retaining 2s useful-content target |
| Excluded-profile release evidence | No production candidate measurements for excluded profiles | Blocks full production rollout, not independent development. Synthetic coverage cannot close this gate; measured scope coverage or explicitly approved release amendment required |
| Home write gate | Blocked and unrelated | No issue #137 dependency. Preserve its own status; no Board-driven Home mutation probe |

Task 1's executor limitation probe is recorded evidence, not the next task to repeat. Continue Task 2, the shared parser/held-EOF/auth checks and Task 4's isolated state/measurement tests with synthetic frames while the runtime remedy awaits review. Do not bind/activate production routes before their transport/runtime gates pass. Twenty complete samples per candidate cohort is an acceptance target, never a development-start condition; count existing eligible candidate rows first and collect only the shortfall. Legacy unknown-completeness observations cannot satisfy that count.

An unsupported gate blocks its dependent integration/release task, not plan authorship or independent tests. If the recommended transport needs a strategic change, revise and review this contract before implementation; never silently lower completeness, focus, deadline or auth requirements.

## Plan review outcome

Latest review amendment — 2026-09-08: reopened Task 2/4 with explicit regression acceptance for absent-Board column membership, strict catalog metadata and delayed sprint discovery. Added Task 3B so full-release compatibility has a named design, implementation and verification path; DB/OAuth-only capability is an initial stage, not the final release contract. Updated the existing-file map and allocated the proposed control migration after local 0015. These are implementation instructions, not claims that the defects are fixed. The hard-deadline requirement remains inherited and the supervisor remains a pending architectural decision. No product scope, deadline or publication gate is waived.

Preparation validation: `git fetch origin` succeeded and fetched main is already an ancestor of the current branch; no merge or rebase was needed. Relative links in this plan and the handoff resolve, task Modify paths exist, Create paths are absent, and source migration parsing reports the single head `20260908_0015`. `git diff --check` passed. Independent follow-up review confirmed Task 3B/capability/release alignment. This documentation-only preparation did not rerun the application suites, fix source code, migrate a DB or publish an execution prompt.

Independent source review completed on 2026-09-08. Corrected prototype/production task circularity, strict-capability versus legacy compatibility, partial-result count authority, explicit wire diagnostics/types, and per-page cancellation checks. All referenced existing paths were verified; absent paths are marked Create. No production implementation or candidate performance gate is claimed passed.

Follow-up source review used three independent reviewers. The user authorized plan improvements: this revision specifies pre-claim token refresh/fresh context and mid-generation rotation, serialized/coalesced focus controls with terminal cancellation, persisted configuration/cache/concurrency evidence, all-eligible-child export, and explicit inherited UI/excluded-profile release gates. These are documentation amendments, not implemented fixes or approval of the supervisor proposal. The existing resume-preflight record below is preserved. At that earlier review, remote synchronization could not be verified because hostname resolution failed; it made no remote-publication claim.

## Execution record — 2026-09-08

Fetched and verified the approved remote base, then created the requested stacked branch in the
active checkout. Initial worktree was clean. Upstream instruction template remains 2026-08-29.
Existing task file paths were checked: absent paths are Create entries or outputs of earlier tasks.
At this historical checkpoint migration head remained `20260908_0014`; no migration or application route had been added yet.

Task 0 baseline:

- Explicit isolated environment (`JIRA_AUTH_MODE=basic`, `CONFIG_STORAGE_BACKEND=jsonfile`,
  empty database URL overrides), `.venv/bin/python -m unittest discover -s tests`:
  1,576 tests in 78.860s, OK, nine skipped. This test configuration is not an application auth change
  and does not prove disposable PostgreSQL integration.
- Node 20.20.0, `npm run test:frontend:unit`: 1,172 passed, zero skipped or failed.
- Node 20.20.0, `npm run build`: passed; `git diff --exit-code -- frontend/dist` clean.
- At the initial execution attempt, in-app aggregate history was not successfully collected: local DB access was
  restricted; the authorized read-only attempt reached a local aggregation TypeError. No new
  observation or percentile was claimed. Section 6 now supersedes this DB-access blocker with successful read-only evidence; the recorded observations remain contextual.
- Home write gate remains unrelated and blocked: zero of four required inputs and no approved
  disposable target. No Home mutation probe ran.

Task 1 partial feasibility result:

`tests/test_eng_board_stream.py` contains an isolated subprocess limitation probe using the real
`CooperativeBudget` and `ThreadPoolExecutor`. Both wait=True and wait=False executor-shutdown cases
remain alive through a 300ms observation window after cancellation; a running future cannot cancel.
The external test harness kills and reaps its own processes. Focused verification:
`.venv/bin/python -m unittest tests.test_eng_board_stream -v`, one test with two subcases, OK in
1.299s after adding bounded cancellation-marker handshakes ahead of the liveness window. A passing limitation assertion is **not** a passing hard-deadline gate. The window is an
observation interval, not a proposed production deadline. No production implementation was written,
so this probe is not a completed RED/GREEN implementation slice.

Full Python verification after adding the probe used the same isolated command: 1,577 tests in
93.687s, OK, nine skipped; the subsequent test-only handshake adjustment received focused verification.
Independent specification and code-quality review approved the limited
probe scope with no blocker or P1; this review does not approve the proposed runtime architecture.

Source confirms why: `CooperativeBudget.cancel` only sets an Event; the diagnostic child executor
waits for running searches on context exit. Jira reads, token refresh/row locks, and configuration
reads can block between checks. Deployment uses eight Gunicorn threads by default; worker timeout
does not establish a deadline for each request. The existing Scenario fork helper is not a reusable
solution: it wraps only one source loader and has an unbounded final join.

Cross-worker focus, real blocked auth/DB/Jira operations and deployment shutdown remain unproved.
Task 1 is incomplete. The later resume implemented the held-EOF parser/shared-auth slice and the
independent Task 2 and Task 4 slices, recorded below. Production Board activation remains absent.
No candidate measurements, authenticated startup result or release readiness is claimed.

### Resume preflight — 2026-09-08

The existing checkout was clean at `439bb8d`; the measurement commit `fc4d6a4` is
an ancestor. Read-only remote checks found no published
`feature/issue-137-board-all-work` branch. Fetched `origin/main` is `dac3517`
(measurement PR #172); its implementation-plan and handoff blobs differ from the
local revised gate documents. The revised publication prerequisite is therefore
not verified. No delegation, push, history rewrite, or production binding occurred
in this preflight. A decision on publishing the existing revision or allowing local
shared-checkout delegation is pending; this is separate from the runtime gate.

Fresh read-only DB queries confirmed four observations, one group/sprint and two
revisions: three successes and one cancellation, all `eng_sprint`, with unknown
lane completeness. The timings and workload counts match sections 1 and 6; no
candidate rows or additional samples exist. Shared configuration contains one group
with two Components, eight Teams and seven Board columns. DB and source migration
heads both report `20260908_0014`; fetched main has not occupied migration 0015.
SQL JSON values were consumed as decoded objects when applicable. No local DB
migration, configuration change or credential read was performed.

The task file-map check found no unexpected missing Modify paths; missing paths
are Create entries or outputs of earlier tasks. Full existing-symbol tracing and
frame-contract freeze remain unfinished and are not claimed by this check.

Fresh baseline verification:

- `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile DATABASE_URL= TEST_DATABASE_URL= .venv/bin/python -m unittest discover -s tests`:
  1,577 tests in 79.927s, OK, nine skipped. These process-local test overrides do
  not change the app's auth profile or establish PostgreSQL/runtime acceptance.
- Node 20.20.0, `npm run test:frontend:unit`: 1,172 passed, zero failures/skips.
- Node 20.20.0, `npm run build`: passed; `git diff --exit-code -- frontend/dist`
  passed with no generated changes.
- Home write inputs remain zero of four; no approved disposable target or mutation
  probe. The unrelated gate remains blocked.

Both test processes and the build exited. No app runner was started or stopped.
No implementation slice, prototype/browser proof, authenticated startup,
disposable migration cycle, hard-termination proof or candidate SLO is claimed.

### Supervised execution proposal requiring review

This is a proposed architectural amendment, not authorization to implement it:

1. Place a supervisor outside Gunicorn request threads. Spawn execution processes with fresh
   HTTP/DB resources; do not fork a threaded worker or inherit its pools.
2. Put every potentially blocking operation within the killable boundary, including initial
   DB-backed authentication, refresh, configuration capture, control operations and Jira I/O.
   Wrapping only the Board generator leaves pre-route authentication outside the deadline.
3. One admitted generation owns one process, its counters and at most two child-search threads.
   Preserve DB-backed cross-worker focus/cancel controls and bounded nonblocking IPC/backpressure.
   Keep issue payloads and credentials out of control rows, logs and process arguments.
4. Start a monotonic budget at admission. The supervisor independently enforces cancellation and
   expiry with bounded TERM, KILL and reap phases. No unbounded join, DB cleanup or blocking IPC
   may run on its watchdog path. Select numeric deadlines and byte ceilings from prototype evidence.
5. Bound admission, reserve capacity for controls, and handle owner disconnect, worker death,
   supervisor shutdown and stalled readers without orphan execution processes. TTL is cleanup only.
6. Review interrupted OAuth refresh explicitly: provider rotation followed by a killed pre-commit
   transaction can require reconnect. Preserve token/version/locking semantics, fail closed and
   never automatically replay refresh or a failed request.
7. Before integration, prove real blocked connect/read/refresh/config, held PostgreSQL locks,
   stalled IPC, two-worker focus, owner death and shutdown under the deployment-equivalent runtime.
   Use a disposable database and verify zero orphan processes. Keep all existing product,
   authentication, completeness and performance gates intact.

Review this boundary change before continuing dependent integration. The original proposal named
`feature/in-app-load-performance` as its PR base; that is historical, not a current instruction.
Revalidate the intended publication base under the root Git contract before any publication;
this preparation authorizes no retarget, rebase or history rewrite.
No commit, push, PR, merge or deployment was performed in this execution.

### Implementation continuation — 2026-09-08

Current `origin/main` (`dac35171004500bf4b961d46be786c6348bb7b73`) was merged locally into
`feature/issue-137-board-all-work` as `32fd685303a85e6253a40f58e0bb085f35378416`. The five textual
conflicts retained this branch's later reviewed plan/gate amendments. No remote branch was changed.

Independent slices recorded at this checkpoint (Task 2/4 correctness claims are superseded by the resume contract above):

- Added the strict Board service and kept the diagnostic path on the same paging/projection core.
  Paging uses `nextPageToken`/`isLast`, incremental shared unique-key budgets, schema-only Epic Link
  resolution and bounded provisional projections that do not expose raw Jira fields. The saved Board
  grammar covers terminal identity, 1/28/90-day retention, absent Board fallback and all configured
  child issue types. Settings edits preserve explicit saved retention.
- Added protocol-v1 NDJSON encoding/validation and the opt-in shared header-first browser stream.
  Buffered callers retain their existing behavior. Frame delivery checks abort and the global auth
  lock before every line, including multiple frames in one chunk. Reader cancellation, strict control
  acknowledgements, lone-surrogate rejection, exact byte boundaries and held-EOF delivery are tested.
- Added the isolated Board data owner with per-group scope, generation retirement, serialized and
  coalesced focus, terminal cancellation, compatible stale snapshots, and semantic completeness
  checks before authority. This code is intentionally not wired to production routes or dashboard UI.
- Added closed Board performance observations, cohort/cache/build filters and migration
  `20260908_0015`. Seeded tests cover legacy rows and up/down/up compatibility. The local application
  database was not migrated; the new source migration head is `20260908_0015`.

Historical verification before the latest source review (does not cover the newly reproduced defects):

- Isolated full Python suite: 1,612 tests passed in 131.055s; nine skipped.
- Pinned Node 20 frontend unit suite: 1,232 passed; zero failed or skipped.
- Production frontend build passed and regenerated tracked `frontend/dist` output from source.
- Focused Settings Playwright retention round-trip: one passed. Focused strict, stream, state,
  migration and measurement suites also passed; `git diff --check` is clean.

Independent runtime review found Task 3 remains a no-go. The current Gunicorn thread boundary does
not bound pre-route DB authentication, token refresh, configuration reads or blocked Jira I/O, and
the existing fork helper inherits unsafe process resources and has an unbounded final join. A
dedicated PID1-managed supervisor with fresh spawned resources, deferred Board security ingress,
bounded IPC/admission and TERM/KILL/reap proof is a strategic amendment requiring review. Tasks 3,
5, 6 production activation and 7 remain blocked; no production route, capability, dashboard switch,
candidate measurement, push, PR, deployment or local DB migration was performed.

### Corrective continuation — 2026-09-08

Completed the reopened Task 2 and Task 4 corrections with red/green tests. The strict service now
rejects malformed issue-type catalog metadata before selection, maps absent-Board sprint Epics to
the declared `board-unconfigured` column, and declares configured `board-unmapped` immediately before
the terminal column. The Board owner inherits the first later valid sprint exactly once while
preserving explicit All work, an initialized sprint, independent Department state and loaded query
state. Cross-frame state validation now rejects undeclared Epic columns and column-frame membership
mismatches. An independent corrective review found no remaining issues after that follow-up fix.

Verification at this checkpoint:

- Focused Python service/measurement/stream suites: 39 passed.
- Focused Node 20 Board owner/stream suites: 59 passed.
- Isolated full Python suite: 1,621 passed, nine skipped.
- Pinned Node 20 frontend unit suite: 1,239 passed, zero failed or skipped.
- Production frontend build and `git diff --check` passed; generated output remained unchanged.

The runtime architecture review did not approve further production work. It found the proposal still
lacks a consistent Board security ingress, concrete PID1/process topology, bounded authenticated IPC
protocol, numeric resource limits, deployment-equivalent test harness, OAuth refresh interruption
contract, and Basic/JSON identity/config invalidation design. Tasks 1, 3, 3B and dependent Tasks 5–7
remain at their documented stop points pending an amended design and explicit architectural approval.
