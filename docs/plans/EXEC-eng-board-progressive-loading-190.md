# ENG Board progressive loading — issue #190 implementation plan

> **Current regression follow-up (2026-09-12):** The authenticated review found that cross-sprint choices lacked saved Jira project authority gating and Component observations/report filters were rejected. [The scoped correction plan](EXEC-eng-board-scope-performance-regressions-190.md) is implemented locally with one browser-verification gap and remains unpublished. Earlier synthetic acceptance below does not close authenticated live acceptance. For this follow-up the user explicitly excluded existing gate checks; do not apply the earlier execution's gate-sweep instruction to it.

> **Status: Implemented and synthetically accepted locally.** Investigation and baseline verification completed on 2026-09-12; execution started on `bugfix/board-progressive-loading` at `40bffe730159ebadb1904b0188981c853fdf85ed` the same day. All non-live Tasks 1–7 checks pass their local automated, joined-loopback and visual verification. The current authenticated All work limit, live Component stage timings and production proxy behavior remain unverified, so the plan stays `EXEC-*` pending live acceptance or merge. Those missing observations restrict incident attribution and live acceptance, not the bounded local repair.
>
> **Execution:** Use `superpowers:executing-plans`, or bounded investigation/test subagents with one implementation owner. Follow the task checkboxes. Do not execute this document as authorization to commit, push, publish, change another surface, or raise resource ceilings. The earlier investigation excluded gate checks at the user's request; this execution follows the repository's mandatory startup gate sweep. The 2026-09-12 `GATE-05` date/result refresh is an instruction-required documentation exception, not ENG Board implementation scope.

**Goal:** Make the existing cross-sprint Component and All work Board paths expose usable Epic cards progressively, complete admissible scopes, and preserve explicitly incomplete content when a bounded load cannot finish.

**Architecture:** Retain the request-local, OAuth-backed NDJSON pipeline and the existing top Sprint selector. Separate candidate-parent discovery from admitted Epic membership. Emit bounded cumulative candidates from validated Component pages and eligible Team-parent batches, reserve a valid terminal error within the unchanged byte ceiling, and keep final membership before child hydration. Preserve the existing last-complete-snapshot presentation during compatible refreshes. Preserve protocol v1 and its strict authentication, scope, sequence, and byte checks.

**Stack:** Python/Flask, React 19, esbuild, Node 20, unittest, Node test runner, Playwright. No new dependency, endpoint, database table, or persisted Board state.

## 1. Baseline and evidence limits

The checkout and fetched `origin/bugfix/board-progressive-loading` both resolve to `40bffe730159ebadb1904b0188981c853fdf85ed`. The worktree was clean before investigation. That head includes `0bb5a39` Component batching, Sprint restoration, and the merge of main at `c017002a6fa71f97f68acf908c5c145c70ad502a`. Do not restart from the earlier unbatched implementation.

The supplied report states:

| Surface | Reported result | What this investigation establishes |
| --- | --- | --- |
| Catch Up / Board with an ordinary Sprint | Loads correctly | Existing automated selected-sprint reuse and startup tests pass. No live session checked. |
| Component | About 536 KB, 5.57 seconds | Reported total, not a new measurement. Existing batch-to-batch streaming works; a page inside one batch remains buffered. First visible Epic time is unknown. |
| All work | HTTP 200, about 119 KB, 3.74 seconds, scope-too-large UI | Real stream probes reproduce HTTP-200-style terminal failures and several distinct limits. The current production `phase`, `limit`, `observed`, stage, and cardinalities are unknown. |

No local server responded on port 5050 and no connected Board browser tab was available. An environment/profile clarification was requested. Do not start a different auth profile, replay production captures, or manufacture a Department to substitute for the affected scope. No live before/after performance claim is supported by this investigation.

The repository's upstream instruction-template check later resolved successfully and matched template version 2026-09-08, so root instructions were not changed. The exact project branch was fetched and verified.

### Baseline commands actually run

Node was explicitly selected from the installed Node 20.20.0 runtime, matching `.nvmrc`; the shell default was Node 22. Python was the existing `.venv` runtime, Python 3.14.6 / OpenSSL 3.6.3.

| Command | Actual result at baseline |
| --- | --- |
| `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_eng_board_routes tests.test_eng_board_service tests.test_eng_board_progressive_loading tests.test_eng_board_stream` | 86 tests passed, 1.330 s |
| `npm run test:frontend:unit` under Node 20 | 1,318 tests passed |
| `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js` under Node 20 | 41 passed, 1.1 min; first attempt could not launch Chromium under the macOS sandbox, rerun with process access passed |
| `npm run build` under Node 20 | Passed; generated files remained unchanged |
| `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests` | 1,746 tests run; OK with 9 skipped, 78.589 s |

The full Python run emitted ResourceWarnings about unclosed test file handles. It was not warning-free, and skipped tests are not verified environments. No application startup was performed. The browser fixture serves a synthetic dashboard and is not evidence of live Jira latency.

Baseline screenshots `tmp/eng-group-board-view/progressive-epic-pending.png` and `progressive-epic-timeout.png` were visually inspected: the current tested deadline path shows an Epic before children, provisional child counts, and a retained card plus Retry after failure. They do not exercise a hard scope limit.

### Reproductions actually run

Ignored local scratch evidence is in `tmp/board-190/`; it is not a handoff prerequisite and must not be committed as production data. Permanent tests must use the fixtures specified in Tasks 1–6.

| Synthetic scenario, unchanged production ceilings | Observed baseline | Interpretation |
| --- | --- | --- |
| 81 short Component names, 3 search batches | Request 1 → candidate 1 → request 2 → candidate 2 → request 3 → authoritative 3; successful terminal | The existing between-batch fix works. Do not report it as missing. |
| 41 Components; 1,000 distinct Epics plus overlap in the second batch | Success, 1,000 Epics; 11 Component and 25 empty-child requests | Component union deduplication accepts the exact bound. |
| Same setup, but 1,001 genuinely distinct Epics | Candidate 1,000 → `error:scope_too_large`; internal `phase=index`, `limit=unique_keys`, `observed=1001` | A real safety bound; the repair must retain cards, not certify truncated success. |
| One Component Epic plus 1,000 distinct Team-parent candidates; the synthetic filtered parent lookup would admit only one additional Epic | Candidate 1 → `error:scope_too_large`; `index/unique_keys/1001`; 10 Team pages, zero parent lookups | Confirmed premature candidate cap. A final two-Epic Board is rejected before eligibility is evaluated. Not yet the identified production cause. |
| One Component Epic plus 10,000 Team work rows with no parent | Success, one Epic, no children | Team scan budget and child hydration budget are separate. |
| Same scan with 10,001 rows | `index/unique_keys/10000` after 100 Team pages | `observed` can name an exhausted non-final boundary, not the eventual dataset size. |
| One Epic with 10,000 / 10,001 children | Exact bound succeeds / overflow terminates at `index/unique_keys/10000` after 100 child pages | The generic `phase=index` does not identify the operation that exhausted the limit. |
| One Component Epic and 150 synthetic Team ids, each 57 characters | Candidate 1 → `index/url_bytes/10019`, before a Team Jira request | A later URL failure remains possible despite Component batching. No evidence that this matches the live scope. |
| Valid first Component page, second page fails | `start` then deadline failure; no first-page candidate | Confirmed within-batch progressive-display gap. |
| Candidate frame then `scope_too_large` through the real reducer | `status=error`, zero candidates, no successful snapshot | Confirmed card-loss defect in the frontend retention allowlist. |
| Complete buffered stream with `focusedContentReady()` held | Owner remains loading with no terminal until the paint promise resolves | Confirmed measurement backpressure; no evidence it accounts for 5.57 seconds in the foreground live page. |

Run local evidence with `.venv/bin/python tmp/board-190/synthetic_probes.py` (characterization assertions pass), `.venv/bin/python tmp/board-190/component_first_page_red.py` (one expected RED), the same command with `--parent-retention` (one expected RED), and `node --test tmp/board-190/frontend_red_probes.cjs` under Node 20 (three desired-behavior assertions fail at baseline). One of those three frontend assertions deliberately sends a column before final membership, then adds a new Epic: current reducer incorrectly permits success. The current backend does not send that order. Treat it as a reason to preserve the phase boundary and add a rejection test, not a proven cause of the incident.

### Review evidence and required corrections (2026-09-12)

The review checked the current source with three independent reviewers. Additional focused runs passed 91 Python route/service/progressive/stream/source-guard tests and 65 Node 20 owner/parser/integration/measurement tests. Node emitted existing module-type warnings. These results describe the unchanged implementation, not completion of this revised plan.

| Finding | Verified evidence | Required task |
| --- | --- | --- |
| Cumulative page emission amplifies bytes | The real baseline pager/route completed 1,000 Epics with 4,096-byte summaries over 100 ten-row pages at 10,063,165 bytes. A simulation of the original proposed per-page schedule through the real route/writer failed after 33,487,347 bytes, 40 frames and 390 serialized candidate Epics, with uncaught `EngBoardFrameError('generation_too_large')` and no terminal. | Task 2 must establish bounded emission and terminal safety before either discovery producer changes. |
| Team-parent partial results never reach the client | Applying only the originally proposed cap relocation in memory resolved 1,001 eligible parents over 26 lookup batches for a Team-only Department, then emitted only start/error. | Task 3 adds eligible-parent batch delivery and late-failure retention tests. |
| Compatible refresh prefers a completed snapshot | Applying only the retention allowlist change kept new candidates in working state, but `useEngBoardData` still displayed the old complete snapshot with its authority. | Task 5 explicitly preserves this behavior and tests it separately from cold partial loading. |
| Existing browser fixtures do not join the production server and DOM | The dashboard fixture injects a browser-created stream; the separate HTTP suite uses a prototype producer and parser bundle. Neither alone measures production pager-to-card timing. | Task 6 creates the joined production-stream/real-dashboard fixture. |
| Duplicate suppression contradicts a current assertion | `test_large_component_index_is_batched_before_authoritative_frame` returns the same Epic in every batch but requires more than two indexes. | Task 4 changes this fixture to assert suppression and preserves distinct-membership batch coverage separately. |

The user requested these findings be covered in the plan. This revision includes the bounded emission policy and narrowly scoped writer changes; it does not defer that already-demonstrated failure to an unspecified later design.

During revision, an in-memory simulation of Task 2's count-doubling schedule for the same 1,000-Epic fixture emitted candidate sizes 10, 20, 40, 80, 160, 320 and 640 before final authority. The unchanged real route/writer completed with 5,452,545 candidate bytes and 15,515,717 total bytes, leaving terminal headroom. Only the emission schedule was substituted: this supports the proposed policy for that fixture, not an implemented pager, reserved-terminal recovery or a browser performance claim. Tasks 2 and 4 still require the permanent integration tests.

### Ranked, falsifiable hypotheses after reproduction

1. **Raw parent candidates exhaust the 1,000-Epic allowance before retention/project/type filtering.** Proven possible by the two-Epic oracle fixture. Confirm for the incident only when the affected run fails during Team-parent discovery with matching counts; falsify if the logged operation/limit differs.
2. **The affected scope actually exceeds a retained-Epic, scanned-work, hydrated-child, or page ceiling.** Boundary probes prove these paths. Count those sets independently; do not infer the failing set from `phase=index` or response bytes. A genuinely exceeded bound requires retained partial content, not a larger constant by default.
3. **A later Team query or token-bearing parent/child request exceeds 7,000 bytes.** A long-Team fixture proves one possible path. Record encoded bytes including the token at the failing operation. The previous 11,774-byte Component incident alone neither confirms nor excludes this.
4. **Useful Component data waits behind within-batch pagination or optional paint measurement.** Both seams have reproducible waits. Measure server page completion → emitted index → browser receipt → visible card paint. Dependencies are explicitly absent from the strict Board pipeline; dependency delays in older task-list measurements are not evidence here.
5. **Shared work or stream processing causes the delay/failure.** Capture generation pages, retries, request duration, serialized bytes, and reducer/paint timings. Component and Team discovery share the deadline and generation pages, but not the hydrated-child key allowance. Existing cumulative batch union succeeds; the malformed early-column reducer ordering is conditional, not current server behavior.

## 2. Fixed boundaries and decisions

- Only cross-sprint Component and All work Board loading changes. Ordinary Sprint Board still reuses the loaded Catch Up snapshot with zero additional selected-sprint data request on entry.
- Preserve cache-first saved Sprint id and name, initial cached catalog validation, active-Sprint fallback, and Board-only cross-sprint options. The later authenticated startup correction intentionally supersedes the clickable-loading-dropdown requirement: the selector and all ENG Jira work now wait for a non-empty cached or live catalog.
- No changes to Catch Up, Planning, Scenario, Statistics, EPM, shared Settings ownership, issue mutations, auth policy, analytics transport, or database schema. Tests may exercise those surfaces as regression protection.
- Component matching stays exact and case-preserving at the Epic boundary. All work stays Component union Team-derived parent Epics, using each parent's own status and existing retention. Team-only Departments remain valid. Product/Tech remains Jira-project classification; Project Track remains Epic-owned.
- Keep one request-local load. No control DB, background job, reprioritization endpoint, parallel speculative hydration, dependency fetch, global timeout increase, or new UI scope control.
- Cards, columns, focus/star/fold, search state, detail panels, drag/field controls, and existing loading-bar styling are reused. Pending counts are provisional; terminal failure stops indefinite animation. Completed columns may remain visible while another column fails.
- For the displayed incomplete generation, keep all Board facets and Work items export locked until full authority. Preserve the established compatible-refresh exception: show the last complete snapshot, labelled stale, with filters/export derived only from that snapshot. Do not mix new candidate membership, counts or children into it. Task 5 defines the cold/refresh/retry state matrix.
- First content means the first nonempty validated discovery page/batch that fits the existing wire contract. Emit it before requesting the next page/batch; later cumulative updates may be coalesced by Task 2. Never change focus to manufacture a paint measurement. A page containing only collapsed-column Epics may have no visible card yet.
- **Export clarification requested:** current `Open epics` links can exist while Work items export is unavailable. Preserve that behavior for the independent loading repairs; changing both export actions to wait is a product decision and is not silently included. Record the user's answer here before changing export behavior. No shared `JiraExportButton` behavior change is authorized by this plan.
- Auth-required still terminally locks the application. Scope/revision changes clear incompatible data. Invalid wire frames, malformed required identity/linkage, and security failures remain fail-closed. Do not broaden card retention to every error code.

### Alternatives evaluated

| Approach | Assessment |
| --- | --- |
| Increase global caps/timeouts | Rejected as a default. It hides the premature eligibility check and permits more work without resource/performance evidence. |
| Start child hydration before final membership or run Component/Team scans concurrently | Not selected. It changes scheduling and authority ownership; the reducer probe demonstrates how later membership can incorrectly inherit completed-column authority. |
| Emit every cumulative page | Rejected after the review reproduction: a supported scope exhausts the wire ceiling through repeated shells. |
| Correct final-union accounting, expose validated pages/batches through bounded emission, preserve partial or last-complete content, isolate telemetry | Selected. First content stays immediate, later candidates may coalesce, and authority/terminal safety stays request-local under unchanged limits. |

## 3. Contracts and safety envelope

### Route contract (unchanged)

| Item | Required behavior |
| --- | --- |
| Endpoint | `GET /api/eng/board`; query fields remain `departmentId`, `scope`, optional `sprintId`, `focusedColumnId`, `refresh` as parsed today |
| Authentication/authority | Existing DB-backed signed-in OAuth adapter only; capture current user/workspace/site/token and shared configuration snapshots before work. Keep disabled Basic/JSON strict capability disabled. |
| Data authority | Saved Department, projects, types, fields, and Board configuration supply query authority. No browser-supplied JQL, issue list, team replacement, or Jira mutation. |
| Headers/body | `application/x-ndjson`, `Cache-Control: no-store`, `X-Accel-Buffering: no`; no new request body or unsafe HTTP method, hence no new CSRF path |
| Preheader errors | Preserve existing auth/config/scope/unavailable status codes and sanitized JSON |
| Stream result | HTTP 200 is transport start. Success requires a valid terminal `complete`, `outcome=success`, authoritative complete membership/children and exact counts. Terminal `error` is not success. |
| Public diagnostics | Preserve protocol-v1 exact field schema. Add internal fixed-enum operation diagnostics to logs/test collection, not arbitrary fields to NDJSON. |

### Resource limits (do not increase)

| Limit | Required ownership / verification |
| --- | --- |
| 1,000 Epics | Unique admitted Component + eligible Team-parent union; never include unverified raw parent candidates in this final-membership ceiling |
| 10,000 Team work rows | Existing scan bound; candidate-parent set cannot exceed this bounded scan. This is separate from hydrated children. |
| 10,000 children | Existing unique child budget shared across both column workers |
| 100 rows/page; 101 pages/search; 2,600 pages/generation | Preserve enhanced-search `nextPageToken` / boolean `isLast`, duplicates and repeated-token rejection; no offset issue paging |
| 40 values/key batch; 7,000 encoded query bytes | Preserve exact Component values and 1,024-byte Component token headroom; check actual token-bearing URLs before dispatch |
| Two child searches; two replaceable child progress updates | No additional executor, unbounded queue, or per-Epic request fan-out |
| 30-second cooperative request budget | Capture/catalog/auth, discovery, children and retries use the same transport budget; cancellation remains bounded best-effort |
| 8 MiB/frame; 32 MiB/generation | Unchanged total limits. Task 2 allocates at most 8 MiB of serialized candidate lines inside the generation and reserves 1 KiB for a minimal valid terminal error; neither allocation raises a ceiling. Test large shells, short pages, overlap and final-frame headroom. |

There is no independent `MAX_REQUESTS` constant. Bound logical search calls using page admission plus batched lookup counts and the shared retry/deadline behavior. A maximum 10,000-parent candidate set can require up to 250 40-key lookup batches before field-size subdivision; removing the premature cap can therefore cost more requests. Measure actual calls, bytes, peak memory and elapsed time. Do not present this correctness repair as a speed improvement.

Cumulative candidate frames must never remove an already-admitted Epic during the same generation. Send exactly one final authoritative index for Component/All work, then hydrate its fixed membership. Do not certify a complete column before that index. Do not cache incomplete results or treat a terminal partial result as an authoritative zero. Discovery callbacks may expose every validated page to the route, but public candidate emission follows Task 2; this plan no longer promises a wire frame for every page or batch. A previously successful compatible snapshot may remain cached and displayed on refresh failure; it is not the failed generation.

The 8 MiB candidate allocation is a maximum for optional cumulative index lines, including newlines, shared across Component and Team-parent discovery. Combined data frames still obey the 32 MiB total. First content plus unlimited eventual hydration cannot be guaranteed for every payload that previously consumed nearly the whole wire budget; Task 2 must measure the added bytes, complete the reproduced 10.1 MB baseline fixture, and fail any genuinely oversized generation with a valid named terminal. Suppressed candidates are not truncated membership: final authority and hydration still use the complete admitted union.

## 4. Files in scope and responsibility

All existing paths below were verified during investigation. A future executor must verify them again before editing.

| Files | Allowed changes |
| --- | --- |
| `backend/services/eng_board.py` | Board pager and Team-parent iterator/collecting wrappers, candidate versus admitted union accounting; retain query/normalization contracts |
| `backend/routes/eng_board_routes.py` | Shared bounded candidate emission for both discovery producers, atomic sequence advance, byte-limit terminal recovery and fixed internal operation diagnostics |
| `backend/services/eng_board_stream.py` | Writer-only validation/encoding reuse, atomic state commit and opt-in terminal reserve. No protocol/schema change, new scheduler or transport/retry policy. |
| `frontend/src/eng/useEngBoardData.js` | Retain hard-bound content, reject premature cross-sprint column authority, detach optional measurement work |
| `frontend/src/eng/useStrictEngBoardIntegration.js` | Board-only sanitized partial-result message; no shared header/export redesign |
| `frontend/src/eng/EngBoardView.jsx` | Only if needed to display bounded-partial state through the existing status region; no layout redesign |
| `frontend/src/eng/loadPerformance.js` | Only if necessary to preserve existing Board-measurement ordering after detaching callbacks; leave task-list measurement functions and schema untouched |
| `tests/test_eng_board_service.py`, `tests/test_eng_board_progressive_loading.py`, `tests/test_eng_board_routes.py`, `tests/test_eng_board_stream.py` | Deterministic real-pager/route/writer regressions, emission/terminal byte budgets and request ceilings |
| `tests/test_eng_board_basic_compat.py` | Minimal mocked-snapshot compatibility adjustment required by Task 2's real start-envelope preflight; no Basic/JSON capability or behavior change |
| `tests/test_eng_board_data.js`, `tests/test_eng_board_stream.js`, `tests/test_strict_eng_board_integration.js`, `tests/test_load_performance.js` | Parser/owner/reducer, authority, partial copy and optional-measurement regressions |
| `tests/ui/eng_group_board_view.spec.js` | Actual Board component streaming, cold and compatible-refresh hard-bound state, screenshots and unchanged Sprint path; minimal fixture option/export needed by the joined campaign |
| Create `tests/ui/eng_board_progressive_loading.spec.js` | Test-owned loopback Python server running production `_frame_stream`, synthetic gated Jira pages, real dashboard/browser measurement and teardown; synthetic data only |
| Create `tests/ui/eng_board_dashboard_fixture.js` only if sharing requires extraction | Reuse existing shell/config/Board fixture helpers without importing a spec and registering its tests twice; no new application behavior |
| `frontend/dist/*` | Generated only by `npm run build` if sources change |
| `docs/features/eng-workflows.md`, `docs/postmortem/MRT027-board-catalog-pagination.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md`, this plan and `docs/plans/README.md` | Accurate final behavior, proven measurements, prevention and execution status |

Read-only production contracts include `frontend/src/api/engBoardApi.js`, `frontend/src/eng/engBoardViewModel.js`, `frontend/src/eng/engBoardColumns.js`, `frontend/src/eng/useEngBoardFilters.js`, `frontend/src/dashboard.jsx`, `frontend/src/components/JiraExportButton.jsx` and the auth/security helpers. Editing their public schema, shared behavior or scheduling requires a demonstrated need and explicit scope decision first. The stream/measurement tests explicitly listed above may be extended.

## 5. Executable tasks

Execution followed this order: Task 1's red fixtures, Task 2's bounded emitter/terminal safety, Task 3's Team-parent discovery, Task 4's Component pager, Task 5's partial/refresh presentation, Task 6's measurement and joined campaign, then Task 7's final checks. Parent-limit characterization and frontend red tests ran independently, but neither progressive backend producer was integrated before Task 2 passed. The plan does not authorize publication.

### Task 1 — establish permanent red loops and capture the missing stage

**Files:** the four backend test files above; frontend data/stream/integration tests; new Board-only browser spec. Production code remains unchanged in this task.

- [x] Verify branch/head and clean or understood worktree. Preserve unrelated work. Use the existing checkout; no worktree or publication mutation.
- [x] Add `test_parent_candidates_filtered_before_admitted_epic_limit` to `EngBoardProgressiveLoadingTests`. Use the real `_frame_stream`, `board_snapshot`, `epic`, `child`, and `FakeResponse` helpers. Stub only the Jira response seam and immutable-snapshot check, not `strict_search`, `discover_team_epics`, limits, writer, or reducer.

Use this complete test core with the existing imports (add `re`):

```python
def test_parent_candidates_filtered_before_admitted_epic_limit(self):
    calls = []
    parent_count = 1001
    def search(payload, **kwargs):
        jql = payload['jql']
        calls.append(jql)
        if 'component in' in jql:
            return FakeResponse({'issues': [epic('ABC-1', 'To Do')], 'isLast': True})
        if 'issuetype = Epic' in jql:
            # Oracle: only ABC-2 passes the existing parent eligibility query.
            keys = re.findall(r'"(ABC-\d+)"', jql)
            rows = [epic('ABC-2', 'To Do')] if 'ABC-2' in keys else []
            return FakeResponse({'issues': rows, 'isLast': True})
        if 'cf[30101]' in jql:
            offset = int(payload.get('nextPageToken', '0'))
            rows = [child(f'ABC-{10000 + i}', f'ABC-{2 + i}')
                    for i in range(offset, min(offset + 100, parent_count))]
            last = offset + 100 >= parent_count
            return FakeResponse({'issues': rows, 'isLast': last,
                                 **({} if last else {'nextPageToken': str(offset + 100)})})
        return FakeResponse({'issues': [], 'isLast': True})
    with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
        frames = [json.loads(line) for line in eng_board_routes._frame_stream(
            SimpleNamespace(current_jira_search=search),
            board_snapshot(teams=('team-a',)), EngBoardRequestTransport())]
    self.assertEqual('complete', frames[-1]['type'])
    self.assertEqual('success', frames[-1]['outcome'])
    self.assertEqual(2, frames[-1]['epicCount'])
    self.assertEqual(0, frames[-1]['childCount'])
    self.assertEqual(26, sum('issuetype = Epic' in q and 'component in' not in q for q in calls))
```

- [x] Run `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_eng_board_progressive_loading.EngBoardProgressiveLoadingTests.test_parent_candidates_filtered_before_admitted_epic_limit`. Expected baseline RED: terminal type is `error`, not `complete`, with `index/unique_keys/1002` for this revised fixture's one Component plus 1,001 parent candidates. The embedded fixture was executed during plan revision and produced that exact RED. Add its paired true-admitted-overflow test; do not weaken the true hard limit.
- [x] Add `test_cumulative_candidates_fit_generation_budget`: one Component batch, 1,000 synthetic Epics, 4,096-byte summaries, ten rows per page over 100 pages, no children. Preserve real pager, projection, route and writer, patch only synthetic Jira and immutable-snapshot checks. Baseline succeeds; the review's eager-per-page schedule fails. Candidate must complete with exact counts, at most 8 MiB of candidate lines and at most 32 MiB total; record largest frame, all candidate memberships and total bytes. This is a no-regression fixture, not a baseline RED.
- [x] Add `test_byte_limit_emits_parseable_terminal` and its exact-reserve-boundary case. Use the real writer and route, with writer-only small-budget variants to reach each boundary cheaply plus unchanged-limit coverage. Require contiguous sequence, one `scope_too_large` terminal fitting the reserve, no escaped writer exception, and parser → owner/reducer retention. Malformed shape, UTF-8 and identity variants must still fail closed.
- [x] Add Team-only fixtures with no Component matches: 1,001 eligible parents, and separately 80 parents with lookup 2 held then failing by deadline. Require the first eligible batch before the next lookup completes, retained cards on late failure, no authoritative index/children/success, and bounded calls. These are baseline RED; repeat with Component overlap and excluded parents.
- [x] Add a held-page Component test: first page returns one valid Epic and a continuation token; second-page provider sets an Event and waits for release. Consume the stream in one test-owned thread. Before releasing page 2, require the first Epic candidate from the real generator. Always release/close in `finally`, use bounded Event waits, and assert page/token/URL counts. Baseline RED: no candidate before release. Add the deadline variant, which must retain the page-1 Epic before terminal failure.
- [x] Extend `tests/test_eng_board_data.js` with the existing reducer helpers: initialize All work, emit `start`, candidate index containing one Epic, then `error:scope_too_large`; assert candidate retained, status error, children not authoritative, no complete snapshot. Baseline RED: candidate map is empty. Repeat after authoritative index and one completed child column. Separately complete an All work snapshot, refresh the same scope with an additional candidate, fail at the limit, and require the last complete snapshot to remain the visible/filter/export source; working partial state is retained separately. Add the retry-success and incompatible-scope variants from Task 5.
- [x] Add the real `consumeEngBoardResponse` → owner test with all frames already buffered and an unresolved `focusedContentReady` promise. After the event loop advances, require terminal reduction without releasing telemetry. Always release in cleanup. Baseline RED: still loading. Also inject synchronous throw and rejected promises into optional measurement callbacks; they must not become Board data failures or unhandled rejections.
- [x] Add a cross-sprint ordering rejection test: candidate E1 → authoritative child column E1 → authoritative index E1+E2 → success. Require rejection and no cached snapshot. This protects the selected phase boundary; do not use it to justify overlapping discovery and hydration.
- [ ] Capture live diagnostics only when the affected local environment/auth profile is available. Read the current terminal frame and sanitized server warning together. Record operation, code, phase, limit, observed, configured bound, Component/Team/project counts, discovered/admitted counts, request/page/retry counts, and encoded-byte maxima. Do not collect raw JQL, tokens, names or identifiers in committed evidence. The existing `gather_eng_board_endpoint_data.py` collects task endpoints, not this strict NDJSON stream, and cannot substitute for this observation.

If the live `limit` or stage differs from a reproduced repair, retain the known fixes as independent work and stop incident attribution. Build an exact synthetic cardinality/encoded-size equivalent before choosing another solution. A missing live environment is recorded as unverified; it is not a reason to abandon the plan.

### Task 2 — bound candidate emission and guarantee terminal byte safety

**Files:** `backend/routes/eng_board_routes.py`, writer-only changes in `backend/services/eng_board_stream.py`, `tests/test_eng_board_stream.py`, route/progressive and frontend parser/owner tests.

- [x] Introduce `EngBoardStreamWriter.prepare(frame) -> bytes` by factoring its existing shape/order validation and compact UTF-8 encoding. It returns the exact encoded line, including newline, without committing writer state; `write` uses the same method and still enforces all byte limits. The candidate policy may inspect a prepared line's size and skip it, but every transmitted line must pass `write`. Keep existing `write(frame)` callers compatible. Add an opt-in `reserve_bytes=0` keyword to `write`; only this route uses a 1,024-byte reserve for nonterminal writes. Writer sequence, generation identity, total bytes and complete flag change together only after successful validation and admission. Preserve the exact-bound behavior of default writer callers.
- [x] Change the route's `emit` to advance its sequence only after writer success. A rejected write must leave the same next sequence available. Keep a minimal no-diagnostics `error:scope_too_large` frame available. Prove its maximum route-generated identity/sequence representation fits 1,024 bytes. Terminal writes consume the reserve with `reserve_bytes=0`; auth terminal remains sanitized and diagnostics-free.
- [x] Preflight the actual start envelope and terminal reserve before constructing the HTTP response. Share its generated identity with `_frame_stream` through an optional internal argument, preserving existing direct callers. If start itself exceeds the byte bound, return existing sanitized `422 scope_too_large` JSON before headers; malformed start metadata uses the existing configuration/data error response. An error frame cannot be the first frame because protocol v1 requires start at sequence zero. Add preheader and post-start boundary cases separately.
- [x] Replace unconditional candidate output with one route-local emission policy shared across Component and Team-parent discovery. Track only the latest bounded admitted union, last emitted membership/count, which discovery stages have emitted new membership, and aggregate candidate-line bytes. No queue, timer, new worker or persisted state. Use the following decision contract:

```text
On a fully validated page/batch that adds admitted membership:
  if this is the final overall membership: emit authoritative index once
  otherwise offer the latest cumulative union as a candidate when:
    no nonempty candidate has been emitted, OR
    this is the first newly admitted Team-parent batch, OR
    the current discovery phase has finished with new membership, OR
    admitted count is at least twice the last emitted candidate count

Before emitting the candidate:
  validate/project the offered shells and measure exact encoded line bytes
  suppress unchanged membership
  require cumulative candidate lines <= 8 MiB
  require line/frame limits and generation capacity with terminal reserve
  if the optional line cannot fit: retain the latest union in memory and skip it
  if it fits: write atomically, then update the emission bookkeeping

At final membership:
  do not apply candidate suppression or its 8 MiB allocation
  emit the full authoritative index under frame/generation limits and terminal reserve

At a retainable discovery failure:
  offer the latest validated, newly admitted union once under the same candidate cap
  then emit the original sanitized error; never substitute successful completion
```

- [x] Validate all newly admitted Epic shells before they become eligible for any candidate, including pages later coalesced. Coalescing must not turn malformed required data into an availability failure or silently drop it. Prepare only emission-eligible cumulative frames; avoid re-serializing a full union on each ten-row page merely to decide whether its count doubled. Charge actual serialized lines, including newlines, and share the candidate allocation across both discovery phases.
- [x] Translate only writer size failures `frame_too_large`/`generation_too_large` from a required data frame into `scope_too_large`. Stop admission/retire child work and emit the minimal valid terminal at the unconsumed sequence. Log fixed internal operation/limit/observed-byte diagnostics. Other `EngBoardFrameError` failures remain fail-closed: after a valid start, emit the existing `board_data_invalid` terminal so the client discards failed-generation content; before start, use the preheader error path. Do not translate malformed frames into safe-retention errors or an EOF the owner could mistake for availability failure. If a diagnostic terminal cannot fit, use the minimal terminal without diagnostics. Never send an oversized frame first.
- [x] Exercise the new emission policy with synthetic validated page updates at its internal seam; at this task only, that producer seam may be injected because Component paging lands in Task 4. Require the reproduced 1,000-Epic/100-page schedule to fit: candidate bytes within 8 MiB, total within 32 MiB, early first candidate and exact final counts. Exercise long multibyte shells, duplicate-heavy pages, both phases sharing the allocation, exhausted optional-candidate allocation, required final/column-frame overflow, and the last possible reserved terminal. Feed real encoded lines through the strict parser. Owner retention assertions become GREEN in Task 5; the unpatched real-pager version must pass in Task 4. Do not count the injected emission schedule as pager-to-browser evidence.
- [x] Keep existing writer exact-byte/sequence tests passing for unreserved callers. Re-run `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_eng_board_stream tests.test_eng_board_routes tests.test_eng_board_progressive_loading` plus the frontend parser/owner tests. The still-unimplemented parent/page/retention red loops must remain explicitly identified; do not claim the entire matrix green yet.

### Task 3 — enforce the Epic bound and publish eligible parent batches

**Files:** `backend/services/eng_board.py`, `backend/routes/eng_board_routes.py`, service/progressive/route tests. Depends on Task 2 before route integration.

- [x] Split `test_team_discovery_rejects_truncation_and_parent_overflow`: preserve scan truncation rejection; replace the raw-parent-overflow assumption with separate filtered-candidate success and admitted-Epic overflow cases.
- [x] Extract `iter_team_epic_batches` with the existing `discover_team_epics` parameters. Preserve the bounded Team scan, known-parent exclusion and parent-key extraction, including Epic Link precedence and null fallback. Remove the `len(epics) + len(parent_keys) > MAX_EPICS` check before parent lookup. Keep `discover_team_epics` as a collecting wrapper for current consumers: consume all iterator updates and return the last sorted union.
- [x] After each existing filtered parent lookup, verify returned keys belong to the requested batch, deduplicate into the admitted union, and enforce the unchanged Epic bound before adding a new Epic. Use the same fixed error identity for the admission check below; the iterator must expose any newly admitted valid prefix before raising this pending error on its next resume:

```python
pending_error = None
prior_keys = set(epics)
for row in rows:
    key = _normalized_key(row.get('key'))
    if key not in batch:
        raise EngBoardError('board_projection_invalid', phase='page')
    observed = len(epics) + int(key not in epics)
    if observed > MAX_EPICS:
        pending_error = EngBoardError('board_scope_too_large', phase='index',
                                      limit='unique_keys', observed=observed)
        break
    epics[key] = row
if set(epics) != prior_keys:
    yield ([epics[key] for key in sorted(epics)], False)
if pending_error is not None:
    raise pending_error
```

- [x] Yield `(sorted_admitted_rows, team_index_complete)` after each validated lookup batch that adds membership; always yield one final completion marker, even if no parent is admitted. If overflow occurs partway through a validated batch, yield its accepted prefix with `team_index_complete=False`, then raise the pending bound error on resume. Invalid required row/key shapes fail closed, not as partial eligibility. Keep raw parent keys out of the wire.
- [x] Consume this iterator in `_frame_stream` through Task 2's candidate policy, including the first Team-only eligible batch before requesting the next. Team additions to an already visible Component generation share the remaining candidate allocation and may coalesce. Offer the latest valid pending union on a retainable discovery failure; respect the same emission budget if it cannot fit. Only the final successful iterator completion permits the single authoritative index; then start existing child hydration. Do not overlap Team scanning, parent lookup or child scheduling.
- [x] Keep candidate-parent storage bounded by the existing 10,000-work scan. Do not fetch each parent separately. Before the Team scan completes or the first eligible lookup returns there may be no Team-derived cards; a failure there cannot retain data not yet validated. Once eligible batches exist, a late failure must preserve the candidates already emitted.
- [x] Run the Task 1 parent test to GREEN with 1,001 raw parents, two final Epics and 26 parent lookup batches. Run Team-only held-second-lookup, late-deadline and 1,001-eligible-overflow cases through the actual route; require visible candidate frames before failure. Verify exact 1,000 admitted succeeds; 1,001 admitted fails incrementally; duplicate parents and Component overlap deduplicate; excluded/old/inaccessible/non-Epic parents do not count; parent-owned status/retention survives; team-only remains valid.
- [x] Check additional lookup calls, actual query lengths with continuation tokens, generation pages, and deadline. Require no over-limit Jira dispatch and no success after truncation. This task does not change parent batching to solve an unobserved URL failure.

### Task 4 — deliver Component pages without another worker

**Files:** `backend/services/eng_board.py`, `backend/routes/eng_board_routes.py`, pager/progressive/route tests. Depends on Task 2’s bounded emission; Task 3 owns Team-parent updates.

- [x] Extract the existing strict page-validation loop into `iter_strict_search_pages(search, jql, fields, *, counters=None, cancel_check=lambda: None, max_unique_keys=None, key_budget=None)`. Yield `(tuple(page_rows), is_last)` only after all existing shape, duplicate, token, cancellation, URL, page and key checks pass. Keep seen-key/token sets scoped exactly as today. This is Board's pager, not Jira's global retry helper.
- [x] Preserve `strict_search` signature and callback behavior as a collecting wrapper so its current consumers remain compatible:

```python
rows = []
for page_rows, _is_last in iter_strict_search_pages(
        search, jql, fields, counters=counters, cancel_check=cancel_check,
        max_unique_keys=max_unique_keys, key_budget=key_budget):
    rows.extend(page_rows)
    if on_page is not None:
        on_page(tuple(_normalized_key(row['key']) for row in page_rows))
    if on_rows is not None:
        on_rows(page_rows)
return rows
```

- [x] Use the iterator inside `iter_component_epic_batches`. Merge each validated page into the existing deduplicated Epic map and union budget. Yield sorted cumulative Epics to the route after each page adding membership, plus the final completion marker. `component_index_complete` is true only for the final page of the final Component batch. Internal iterator delivery is not a promise of one wire frame per page: Task 2 sends the first useful page immediately and coalesces later candidates. Duplicate-only pages do not request redundant candidate frames; the final completion marker is still required.
- [x] Preserve route ordering: `start` → cumulative candidates → one authoritative index → child progress/columns → terminal. Component-only final-page authority can follow immediately; All work remains candidate while Team-parent discovery runs, with eligible parent updates supplied by Task 3. Keep the bounded Team scan and child scheduler ownership unchanged.
- [x] Update `test_large_component_index_is_batched_before_authoritative_frame` deliberately: its duplicate-only fixture must now emit exactly one nonempty candidate and one final authoritative index, retaining the multi-query/encoded-byte/deduplicated-membership assertions. Add a distinct-membership fixture: batch 1 admits one Epic, batch 2 admits a second and batch 3 finishes the union; verify the second candidate is delivered before the next request and final membership is exact. Later batches below Task 2's threshold may coalesce. This changes the assertion that contradicted suppression, not the query-completeness requirement.
- [x] Run held-page and second-page-failure tests to GREEN. Keep the revised between-batch ordering, 150 long Component names, exact case, overlapping union, long token, slow consumer, stale-generation and cancellation tests green.
- [x] Re-run Task 2’s 100-page/large-shell fixture through the now-real page iterator, with no emission-schedule patch. Record candidate bytes/counts and total serialized bytes; require complete success at unchanged limits. Also test a genuinely oversized required final/child frame, requiring a parseable scope-limit terminal and retained candidates. The previously demonstrated amplification is an implementation acceptance test, not deferred design work.

### Task 5 — preserve and label a bounded partial Board

**Files:** `frontend/src/eng/useEngBoardData.js`, `useStrictEngBoardIntegration.js`, optionally the existing Board status region, frontend tests and Board browser test.

- [x] Extend only the existing safe-retention allowlist in `withTerminalError`:

```javascript
const retainContent = ['deadline_exceeded', 'jira_unavailable', 'unexpected_eof', 'scope_too_large'].includes(code)
    && state.working.indexReceived;
```

- [x] Retain validated candidate/final Epics, completed columns and provisional counts in the failed generation's working state while setting children non-authoritative and storing the terminal error. Never place this failed load in `snapshots`. Do not mix working state with any last-complete snapshot or retain incompatible data on auth/scope changes. Invalid frames never make the failed generation usable.
- [x] Preserve `displayData: state.staleSnapshot || state.working` and the existing model's authority rules. Apply this explicit state matrix to both Component and All work:

| State / event | Display and copy | Filter/export authority and retry |
| --- | --- | --- |
| Cold load, no compatible successful snapshot | Current candidates/progress, provisional counts; on a hard limit show `Loaded so far — Board limit reached; this result is incomplete.` Other retainable errors keep their appropriate sanitized copy. | All facets and Work items export remain locked. Retry starts one replacement generation; do not save the failed load as a success. |
| Compatible refresh while loading or after a retainable failure | Keep only the last complete snapshot, its counts and the existing `Showing last complete Board data.` label. For a hard limit append `Refresh reached the Board limit.`; do not call the displayed snapshot a newly incomplete result. | Filters and Work items export may use that snapshot's complete children, exactly as today. Newly streamed candidates/children cannot leak into visible results or exports. One explicit Retry, no automatic replay. |
| Compatible retry succeeds | Atomically replace the stale snapshot with the new complete generation and remove stale/error copy. | Authority derives from the replacement; cache only the successful generation. |
| Retry without a compatible successful snapshot | Start a new provisional generation with existing reset behavior; partial retention applies within each failed attempt. | Keep locks until success; no promise to accumulate candidates across failed generations. |
| Scope version, Department revision or identity becomes incompatible | Drop the stale snapshot and incompatible cache as the existing owner requires; use only compatible new data. | Never reuse old authority for the new scope. Auth-required still locks the entire mounted app. |

This is an explicit exception to incomplete-generation locks, not a new early-unlock policy. Preserve existing invalid-frame/permission handling for a prior valid snapshot; do not broaden which failed-generation errors retain working content.
- [x] For Component/All work, reject `column`, `progress`, or `column_error` before final membership authority; keep legacy strict-Sprint behavior unchanged. Use the existing `hasAuthoritativeIndexScope` helper and `invalidFrame` path. The production producer already satisfies this ordering; add the negative reducer guard rather than change scheduling.
- [x] Map strict Board `scope_too_large` in `strictEngBoardViewProps` using the displayed source: cold/current-partial uses `Board limit reached; this result is incomplete.`, while a compatible stale snapshot uses `Refresh reached the Board limit.` Reuse the respective existing status region and Retry. With zero current Epics and no compatible snapshot, show a scope-limit error, not a successful empty state. Do not expose internal `phase`, raw errors or JQL.
- [x] Extend the existing controlled `ReadableStream` cold-load browser case for hard limit after candidate, after page progress, and after one complete column while another is pending. Require cards and detail access retained, no indefinite loading animation, provisional totals labelled, filters/Work items export locked, one explicit Retry, and no auto-replay. Switch back to the saved Sprint and verify recovery with the unchanged snapshot path.
- [x] Add owner → actual view-model and browser prior-success → same-scope refresh → hard-limit → Retry cases. Give the old snapshot one Epic/child and the refresh an additional Epic/child; assert only the old keys/counts are displayed/exportable after failure, stale-specific copy is visible, and partial working data has not overwritten the saved success. Successful Retry must replace it atomically; a changed `scopeVersion` must discard the old snapshot and follow cold-load locks. Update expectations deliberately, preserving the existing compatible-refresh regression.
- [x] Verify global auth lock, generation/scope changes, late frames, unmount and incompatible-cache cases still invalidate correctly. Preserve ordinary Sprint rendering, Team selector visibility/disabled state, Board focus and shared header behavior.

### Task 6 — make measurement observational and measure actual paint

**Files:** `frontend/src/eng/useEngBoardData.js`; Board-only functions in `loadPerformance.js` only if required; owner/measurement tests; new browser spec, minimal fixture-sharing changes in `tests/ui/eng_group_board_view.spec.js` and optional Create `tests/ui/eng_board_dashboard_fixture.js`; Board route internal logs if current diagnostics cannot identify the stage.

- [x] Detach optional measurement promises from `onFrame` and from data-load completion. Preserve synchronous data validation/reduction and immediate auth callbacks. Invoke optional callbacks with synchronous and asynchronous rejection containment, using a Board-local helper:

```javascript
const observe = callback => {
    try { void Promise.resolve(callback()).catch(() => {}); }
    catch (_) { /* optional measurement must not fail Board data */ }
};
```

Do not remove the parser's ordered `await onFrame`; that sequencing belongs to the data contract. Remove only Board owner's dependence on measurement completion. Capture the relevant measurement instance; retire/cancel it by request/generation, not by a later mutable owner value. Finish once, suppress superseded/auth-locked samples, and prevent a late callback clearing a newer measurement. Preserve the existing performance opt-out.

- [x] Require held/throwing/rejected measurement tests to become GREEN; terminal data must reduce while observation is unresolved. Exercise callbacks resolving after cancellation and a newer request. Keep existing load-performance tests green and avoid altering task-list measurement helpers or storage schema.
- [x] Build the new `tests/ui/eng_board_progressive_loading.spec.js` as one joined synthetic campaign. Reuse the existing dashboard fixture with a narrow option that leaves only `GET /api/eng/board` unmocked; all bootstrap/config/task/detail responses remain synthetic. Mount the real dashboard bundle and its ordinary strict owner/parser/Board component. Do not replace `window.fetch`, pre-serialize the entire Board response, or manually push candidate frames in this campaign.
- [x] Start a test-owned loopback Python process from the existing `.venv`. Its test-only route returns the production `eng_board_routes._frame_stream` with `board_snapshot`, `FakeResponse` and synthetic Epic/child fixtures; stub only Jira responses and immutable-snapshot/auth checks. Use the real pager, both discovery iterators, projection, writer, budget and child scheduler. Preserve streaming headers and flush yielded lines over real HTTP. This fixture is isolated from the application's runtime environment and live credentials; it does not authorize an alternative live auth profile or a new production endpoint.
- [x] Gate synthetic page/batch/child responses with bounded Events controlled by test-process IPC. Use the test-owned Python server as the dashboard origin, serve or intercept the existing shell/assets there, and pass the origin into the shared fixture rather than changing a live server or process-wide auth profile. Let only the Board request reach its real HTTP route; do not use Playwright `route.fulfill` for that response. Release all gates in `finally`, cancel readers, terminate/join the server, bound startup and teardown, and never leave a child process or listener behind. If fixture functions must be shared, place them in `tests/ui/eng_board_dashboard_fixture.js` (Create, only as needed); do not import a `.spec.js` file and register its tests twice.
- [x] Record monotonic browser timestamps for request start, first `start` frame (the metadata frame; there is no `meta` type), first candidate, first visible Epic paint, authoritative index, first final column and terminal receipt. Record terminal reduction/settled paint separately. Observe parser/frame arrival without bypassing ordered validation or reduction. Label existing browser-injected tests UI-only; the old prototype HTTP suite remains transport regression coverage, not pager-to-card evidence.
- [x] Establish first visible Epic from a generation-specific `.ecard` in the actual focused column, a nonzero in-viewport bounding rectangle, and the following animation frame/paint opportunity. Use a MutationObserver plus animation frames and screenshot/trace validation; a parser callback or hidden card does not count. If the focused column has no Epic, report unavailable until a real visible Epic exists. Do not rename the existing `firstFocusedContentMs`, which currently observes a completed column, to first Epic paint.
- [x] At the server seam record request entry/capture completion when exercised, each Component page and eligible-parent batch result, frame serialization/yield, first authoritative index, first column and terminal. The synthetic fixture injects a snapshot, so report unexercised production capture timing as `null`. Internal stage names are fixed enums: `component_index`, `team_work_discovery`, `team_parent_lookup`, `child_hydration`; record phase/limit/observed separately. Use injected probes or sanitized logger fields, not a protocol-v1 schema extension.
- [x] Correlate observations by a test-only sample id and frame sequence out of band. Python and browser monotonic clocks have different origins: compare stage durations within each clock, and use a test-owned clock-alignment handshake with measured uncertainty before subtracting a server-yield timestamp from browser receipt. Otherwise report cross-clock delay as `null` and prove ordering through held/released gates. Do not compare two unaligned monotonic timestamps as latency.
- [x] Use separate positive fixtures where the first valid page/batch contains an Epic in the existing focused column. Hold Component page 2, a later Component batch, Team-parent lookup 2 and child completion independently; require first card paint before the respective release. For the cold Team-only case, let the bounded Team scan complete first, then hold parent lookup 2. Add a complementary first-page-only-collapsed-column case: retain focus, report first visible Epic as `null`, and observe it only when visible content actually arrives.
- [x] Compare aligned server-yield/browser-receipt observations to detect buffering; compare browser receipt/DOM/paint in the same clock to locate frontend delay. Record coalesced pages separately from emitted frames, and measure total bytes and serialization CPU separately from Jira time. Preserve `X-Accel-Buffering: no` and verify incremental delivery in the joined fixture; production proxy behavior remains a live observation.
- [x] Run the same joined synthetic schedule against baseline `40bffe730159ebadb1904b0188981c853fdf85ed` and candidate sources. Materialize only the needed baseline source files under ignored `tmp/board-190/` using `git show`; select that source root for the test subprocess and bundle. Keep both revision labels in the results and never check out over current work or create a worktree. Run campaigns serially. A baseline that cannot show a card before release records a failed early-paint assertion, then releases its gate on the same bounded schedule so total duration can still be observed.
- [ ] When the affected authenticated environment is available, take at least five comparable local observations per scope/cache category before and after, with the same scope/cardinality and no concurrent campaign. Report every sample and median/range; five observations are not a defensible p95. Compare cold first-content and compatible-refresh settled replacement separately: an already-visible stale card is not new-generation first paint. Keep the reported 5.57-second observation separate from newly measured samples.

Required measurement record:

```text
revision, environment_class, scope_type, cache_category, sample_number,
component_count, team_count, admitted_epic_count, scanned_work_count,
hydrated_child_count, request_start_ms, metadata_ms, first_candidate_ms,
first_visible_epic_ms, authoritative_index_ms, first_column_ms,
terminal_received_ms, terminal_reduced_ms, settled_paint_ms,
server_capture_ms, server_discovery_ms, serialization_ms, clock_alignment_uncertainty_ms,
ndjson_bytes, candidate_bytes, candidate_frames, coalesced_pages, jira_requests, jira_pages, jira_retries, max_query_bytes,
peak_child_workers, peak_progress_queue, peak_memory_bytes,
terminal_outcome, failure_operation, failure_phase, failure_limit, failure_observed
```

Use `null` for unobserved stages, never fabricated zero. No group names/ids, issue keys, account ids, tokens, URLs, JQL or production payloads in committed measurements. A shorter first-paint time is not a faster total load; report both, and keep failed runs out of successful-completion comparisons.

### Task 7 — verification, documentation and acceptance

**Files:** docs listed in Section 4, generated frontend output through the build.

- [x] Run the narrow red loops during each task; then all required commands in Section 1 under Node 20. Additionally run `npx --no-install playwright test tests/ui/eng_board_stream.spec.js tests/ui/eng_board_progressive_loading.spec.js` and `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_eng_board_basic_compat tests.test_eng_board_source_guards tests.test_eng_board_measurement`. All permanent new red loops must now pass. Run the full Python suite once after final code changes; do not infer it from narrow tests.
- [x] Prove Catch Up → ordinary-Sprint Board performs no additional data request. Recheck saved Sprint display before delayed catalog, active fallback without saved selection, disabled selector and ENG content during catalog loading, Board → Planning/Statistics → Board restoration, and unchanged Team scope semantics.
- [x] Capture settled synthetic screenshots for candidate loading bars, progressive counts, complete Board, two-column partial failure, cold hard-bound retention, Team-only partial content and compatible-refresh stale content. Assert real card visibility, no final empty flash, unchanged column/rail/control geometry, no clipped status copy at narrow width, and reduced-motion behavior. Inspect the images; assertion-only visual claims are insufficient.
- [ ] Once the chosen local environment is running, inspect real Component and All work loads and match current error diagnostics to a regression. Required evidence is the strict stream and real card paint, not only Network's HTTP status or total transfer duration. If the live scope exceeds a true bound, show the named incomplete result with preserved cards and document the bound instead of marking full completion.
- [x] Update only the Board section of `docs/features/eng-workflows.md`. Append to MRT027 the proven cause(s), baseline/candidate measurements, hard limits and tests; label the live cause unverified until matched. Tighten the existing loading learning in `AGENTS.md` only if the user's concrete correction warrants a durable change; do not add a duplicate speculative rule.
- [x] In `docs/README_ANALYTICS.md`, document the passive loading/frame/animation no-new-event allowlist. Preserve the existing terminal contract: `trigger=userevent`, `event_type=event`, canonical `event_name=api_result`, `feature_name=eng_board`, `api_surface=eng_board`; existing string enums/buckets for method, status, result, duration and cache, bounded `scope_type`, and one terminal numeric duration. Emit at most once for an accepted current generation, none for superseded/auth-locked loads, and no Jira identifiers. A minimal byte-limit terminal may omit diagnostics: keep unknown counters null and preserve `isAcceptedBoardTerminalSample` rather than fabricating request counts to force an event. Test success, partial/hard limit, minimal terminal and retry. No GA4 taxonomy expansion or runbook change is needed unless the actual emitted contract changes, which requires review.
- [x] Update this plan's execution status, outcome, actual commands/results and remaining live evidence. Update plan index and verified Board ontology links. Keep `EXEC-*` until implementation is complete and accepted; do not mark it DONE from a plausible diff or synthetic-only live claim.
- [x] Review the complete diff against Section 4 and remove unrelated changes. The planning task does not authorize commit/push/PR. If publication is later requested, follow the root publication transaction with exact base/head, complete history/path review, verification, explicit required approval and remote/PR readback; no handoff until its referenced artifacts are published and fetchable.

## 6. Acceptance matrix

| Requirement | Evidence that must pass |
| --- | --- |
| Admissible All work completes | Unpatched-limit fixture with >1,000 raw parent candidates but ≤1,000 eligible Epics succeeds with exact final counts; affected live cardinality fixture succeeds unless another documented bound is truly exceeded |
| True limits remain safe | Exact-bound/over-bound tests for admitted Epics, Team scan, hydrated children, pages, encoded token URLs, frame/generation bytes, queue/worker caps and deadline; no truncated success |
| Early Component and Team-parent cards | First nonempty valid page/eligible-parent batch → candidate before the next request completes; joined browser fixture shows a real focused-column Epic before release. Later frames obey coalescing. Collapsed-only first pages preserve focus and report paint unavailable. Distinct-batch coverage and explicit duplicate suppression pass. |
| Cold partial content survives | Emitted Component/Team-parent candidates and completed columns survive scope limit, deadline and retryable child error; incomplete label and explicit Retry; no false zero, new successful snapshot, child authority or Work items export. |
| Compatible refresh remains consistent | Previous success → refresh → limit → Retry preserves only the last complete snapshot as displayed/filter/export source, with stale-specific copy; no new-candidate leakage. Retry success replaces atomically; incompatible scope drops it. |
| Candidate bytes and terminal remain bounded | Actual 1,000-Epic/100-page/4,096-byte-summary regression completes, with candidate lines ≤8 MiB and generation ≤32 MiB. Genuine required-frame overflow yields a valid contiguous-sequence terminal within the reserved 1 KiB; writer → parser → reducer tests retain content. |
| NDJSON integrity | Cumulative candidates; one final membership; no early child authority; exact terminal counts; malformed/stale/auth sequences rejected; optional telemetry cannot hold the stream |
| Performance claim is attributable | Production `_frame_stream` over real HTTP → actual dashboard owner/Board DOM, with synthetic Jira gates, both source revisions and out-of-band stage correlation. Before/after first-visible-Epic and total durations, request/byte/resource counts, aligned clocks or null cross-clock latency, known comparable cache/scope; browser-injected fixtures alone do not qualify. |
| Sibling views unchanged | Selected-sprint reuse, cache-first startup and relevant browser restoration tests pass; no source changes to sibling data loaders or shared Sprint/UI contracts |
| Optional work stays optional | No dependencies added to the strict path; existing permission-reduced optional metadata compatibility and retryable child-column retention remain passing; measurement errors do not fail data |

## 7. Remaining uncertainty and stop conditions

- The current live All work diagnostic and production cardinalities are not yet captured. The two-Epic oracle fixture proves a real logic defect, not a matching production incident. If live evidence names another bound, obtain its red reproduction and a scope decision before an additional algorithm change.
- The user was asked which local environment/auth profile to use and whether both export actions should wait. Until answered, no alternative live auth profile or Open epics policy change is included. The compatible-refresh exception in Task 5 preserves established behavior; it is not pending a new export decision. Independent synthetic development remains executable in the stated task order.
- Parent/child token headroom and long Team catalogs remain possible URL paths. A live `url_bytes` result requires its exact encoded-size reproduction. Do not silently add Team splitting, increase URL caps or combine Product/Tech requests as speculative work.
- Separate source/probe findings include malformed optional parent metadata reaching the wire writer and malformed required child parent shapes raising exceptions. They do not explain `scope_too_large`; broad projection/wire-error redesign is not scheduled here. Existing valid optional-field compatibility remains a regression requirement. If the live failure or the scoped tests hit these paths, isolate the exact shape and review a Board-only repair; do not catch all exceptions or certify malformed data.
- Task 2 explicitly authorizes and specifies bounded coalescing and narrow writer/sequence/reserve changes. The reproduced byte-amplification fixture must complete; failing it is not an acceptable partial outcome. Other scopes may still exceed a genuine required-frame/generation bound or exhaust the request budget: retain emitted usable content (or the compatible last-complete snapshot) and record the exact result. Ask before changing the first-content/final-authority boundary, overlapping hydration, revising the protocol or raising ceilings.
- After two failed repair attempts on one issue, stop and present evidence for a decision. Never reinterpret a failing regression as acceptable merely to finish.

## 8. Execution update (2026-09-12)

**Outcome:** Implemented with changes and synthetically accepted locally. The local implementation is now the source of truth for Tasks 1–7. It preserves the plan's protocol-v1 and resource ceilings, adds a minimal Basic-compatibility test adjustment for start-envelope preflight, and extracts a shared dashboard fixture for the joined campaign. No dependency, endpoint, persisted state, commit, push or publication was added.

**Current accuracy:** Accurate for the implemented architecture, bounds, expected behavior and local synthetic verification. Keep this file as `EXEC-*` until the result receives authenticated live acceptance or is merged.

### Actual local evidence recorded so far

- The focused backend Board run covering route, service, progressive-loading, stream, Basic compatibility, source guards and measurement completed 148 tests with `OK`.
- The focused Node 20 Board owner/measurement run completed 114 tests with no failures.
- The real-pager 1,000-Epic/100-page/4,096-byte-summary fixture completed with 5,452,545 candidate bytes, 15,515,720 total serialized bytes and a 4,293,058-byte largest frame. Duplicate-only membership emitted one candidate before final authority.
- After bounded-startup cleanup, exact producer/frame coalescing correlation, full prepare/write serialization accounting, synchronous reducer-completion timing, generation-specific two-frame paint validation, scope-specific request matching and stale-artifact cleanup were added, the joined loopback campaign completed 11/11 cases serially in 13.1 seconds. One routing/owner diagnostic plus five gated scenarios ran against current and baseline `40bffe730159ebadb1904b0188981c853fdf85ed` sources. Current source showed a focused Component card before page two was released; the equivalent held baseline state showed zero Epics. Independent spec and quality re-reviews passed.
- The combined strict-stream plus joined-campaign browser command completed 14/14 tests in 16.4 seconds.
- The final full Python run completed 1,786 tests with `OK` and 9 skipped. The Node 20 frontend unit suite completed 1,368 tests with no failures. After restoring the loading-state Sprint selector contract and covering loading, empty and failed catalog states, the Board UI suite completed 45 tests; Chromium launch failed on the first sandboxed attempt, and the approved outside-sandbox rerun passed. The focused Basic compatibility/source-guard/measurement run completed 22 tests. The Node 20 production build passed.
- The authenticated localhost Catch Up view reproduced the Sprint regression while `/api/sprints` was pending. After the repair and rebuild, the same live control displayed `Loading…`, remained enabled, and opened the dropdown with `Loading sprints...` while the request was still pending.
- The same authenticated environment had no configured Jira Sprint Board, so the fallback was scanning the issue catalog four times. The fallback now performs one paginated `Sprint is not EMPTY` scan. A clean live request enumerated 17 sprints from 49,169 issues, after which the selector opened and accepted the active sprint selection; no workspace-admin configuration was changed.
- Settled synthetic screenshots were visually inspected for current versus baseline held Component delivery, candidate loading/progressive counts, complete Board, Team-only partial content, timeout/two-column partial failure, compatible-refresh stale content, and cold hard-limit retention at desktop and 800px widths. The inspected current held Component image showed the focused card; its baseline counterpart showed loading with zero Epics. The collapsed-first image kept the first candidate inside the collapsed rail and did not count it as visible paint.
- `GATE-05` was rechecked as required on 2026-09-12. None of its four required inputs was present, no approved disposable Home project was supplied, and no mutation probe ran; the gate remains blocked.

### Remaining verification and live evidence

- The authenticated browser check covered the shared Sprint loading control only. The affected Component and All work stream terminal operation/phase/limit/observed values, real scope cardinalities, five comparable before/after samples per scope/cache category and production proxy buffering remain unverified.
- The reported 5.57-second Component observation is not a new measurement and is not evidence of a production speedup. Synthetic first-paint timing and total completion timing remain separate.

**Investigation outcome:** Baseline regression suites passed, while deterministic probes established gaps at the candidate-parent limit, within-batch Component delivery, hard-limit retention and optional measurement. Review then demonstrated byte amplification, unsent Team-parent partial results, compatible-refresh ambiguity and verification conflicts. The locally verified repairs cover those findings while preserving the shared Sprint/Catch Up owner. Authenticated live incident attribution and acceptance remain outstanding; no live speed improvement is claimed.
