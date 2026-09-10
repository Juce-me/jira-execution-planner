# OAuth Inline Issue Editing Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement the checked tasks in order. Do not implement from the supporting design alone.

**Status:** Implemented and verified locally on 2026-09-09. Live tenant capability and operator-approved disposable Jira write evidence remain outstanding, so this plan is not accepted/merged and must not be renamed `DONE-*`.
**Current accuracy:** Updated 2026-09-10. People-field metadata now carries the authenticated display identity in `RequestAuthContext` and runs the fresh issue snapshot, edit metadata, and exact-user eligibility reads concurrently. A legacy context without display identity retains the `/myself` fallback. The mounted frontend controller keeps Me and discovered identities in auth-context/field-scoped memory, marks reused identities unverified, and clears them on auth change; a selected identity still goes through submit-time Jira revalidation. The person search input replaces the value trigger in place while its result menu remains portalled.
**Date:** 2026-09-08
**Local verification:** After merging `origin/main` at `e9a1c48`, 1,733 Python tests passed (9 skipped) with `CONFIG_STORAGE_BACKEND=jsonfile` and 1,305 frontend unit tests passed. The 262-test Playwright campaign produced 260 immediate passes; its two merge-integration failures were corrected and both affected spec files then passed 47/47. After the inline-SP correction, its two focused UI specs passed 24/24 and the final changed-path checks passed 5/5. Production frontend build, structure budgets, and `git diff --check` passed. Settled Board and corrected Catch Up/Planning screenshots were inspected.
**Goal:** Edit Epic/Story Assignee, Epic Delivery Owner, and Story Points through the signed-in user's Jira OAuth context, preserving current dashboard design and recalculating all affected loaded views.
**Architecture:** Extend existing issue-edit services, HTTP/auth helpers, field-popover placement, mutation queue, and normalized ENG state. Add thin people/SP editors and one pure Jira field service; Jira remains authoritative. No new dependency, database table, configuration ownership, or alternate Board data source.
**Tech Stack:** Python/Flask, Jira Cloud REST v3, React 19, existing CSS, Node 20/esbuild, unittest, Node test runner, Playwright.
**Design:** [Inline editing design](SUPPORT-oauth-inline-issue-edit-design.md). This execution contract resolves its API and state details.
**Baseline:** `dac3517` / fetched `origin/main` at design review. Recheck drift before execution, especially the separately planned Board pipeline.

## 1. Authorized scope and non-regressions

| Field | Catch Up | Planning | ENG Board |
| --- | --- | --- | --- |
| Assignee | Epic and Story | Epic and Story | Epic card, Epic detail metadata, Story detail rows |
| Delivery Owner | — | — | Epic card and Epic detail metadata |
| Story Points | Story only | Story only | Reflected after editing elsewhere; no editor |

The user's follow-up authorizes preparing this implementation plan and specifies maximum existing-element reuse. ENG scope and proposed defaults remain the design baseline: five users including Me, no clearing, non-negative SP including zero. The plan does not introduce EPM, Home, subtask, bulk-field, or Scenario write controls. Supported server types are literal case-insensitive `Epic` and `Story`, with `issuetype.subtask != true`; do not reinterpret the flat `get_configured_issue_types()` list as an Epic/Story role mapping. Other types fail closed. A later localized/custom-type expansion requires an explicit design change.

UI must reuse the table in section 2. No new toolbars, permanent search inputs, generic Button/Input components, theme tokens, typography systems, widened cards, or taller summary rows. Preserve existing filters, selection keys, collapse/expansion, sorting, board drag/drop, route permissions, OAuth recovery, and status/priority/track behavior. Never hand-edit dist. Keep dashboard changes wiring-only and within current structure budgets; extract narrowly owned new behavior instead of ratcheting the budget.

All work stays in the current checkout and a permitted typed branch. No commit/push/PR, live Jira mutation, or remote execution handoff is implied by writing this plan. Follow root publication rules when separately authorized.

## 2. Mandatory reuse map

| Need | Existing element to reuse | Permitted extension |
| --- | --- | --- |
| Popover placement/dismissal | `frontend/src/issues/IssueFieldOptionMenu.jsx` | Extract placement and outside-dismiss into `useIssueFieldPopover.js`; old menus consume it with unchanged defaults/preview behavior |
| Panel, option, note/error/result visuals | `frontend/src/styles/eng/status-transitions.css` | Alias new editor selectors into existing declarations, including portalled state; no copied parallel stylesheet |
| Person search input | Native input with `.component-search-input` from `styles/settings/group-editor.css` | Accessible attributes only; no new Input component |
| Person Save/Cancel/Reload/Check Jira | Existing `button.compact`, `button.secondary.compact` from `styles/eng/controls.css` | Reuse markup/classes; no bespoke action styles |
| Story/Epic person value | `.task-assignee`, `.task-assignee-icon`, `.epic-assignee` | Native field button reset preserving current icon/typography |
| Board people | `.eperson`, `.lbl`, `.eperson b` | Preserve casing, sizes, truncation and row height |
| Story Points | `.task-inline-sp` | Replace displayed value in place; render a null Jira value as `0 SP` without changing its stored value |
| Network/auth | `jiraIssueApi.js`, `trackedFetch`, `apiFetch`, CSRF single-flight helper | Field-specific sanitized response decoder; do not replace global auth handling |
| Grant enforcement | `backend/auth/scope_policy.py::missing_context_oauth_scopes` | Call directly; do not copy the older local-store scope helper |
| Jira edits | Dependency-injected `jira_issue_project_track.py` pattern | New strict field service; retain existing services |
| State and calculations | `applyLocalEngIssueField`, `engIssueLocalUpdates.js`, `planningSelectionStats.js` | Extend normalized patches and invalidate derived caches; do not add a second calculator |
| Mutation ordering | `engIssueMutationQueue.js` | Multi-key reservation for existing batch status plus single-key edits, shared across surfaces |

A new person combobox is justified because current `IssueFieldOptionMenu` has `role=menu` and first-option focus. Do not stuff a search input into its `leadingContent`. Story Points remains a direct native input in the existing SP slot; it does not share popover or dialog mechanics.

Board card correction: `.ecard` currently is one draggable button. Keep its geometry/data attributes on a noninteractive draggable wrapper. Put existing `.erow1` and `.erow2` inside native `.ecard-open`; `.erow3` person triggers are siblings. Update `EngBoardView` focus-return selectors to `.ecard-open`. Exclude field triggers/popovers from drag initiation. Summary click/Enter/Space and actual summary drag retain their behavior; no nested buttons/anchors.

Board detail-panel Epic people are new values in existing metadata lanes, not existing fields to replace. Do not add Delivery Owner to Catch Up or Planning. Constrain/ellipsis people text inside Board lanes; do not let additional values increase header/card height. Board detail person-editor portals attach within `panelRef.current` to stay inside its focus trap. Other person editors portal to document.body. Story Points uses the existing inline SP position as a plain input, with Enter to save and Escape or blur to discard; it has no trigger button or popup. Register person-editor closers with `MENU_CLOSERS`; Escape closes an editor first, then Board panel on a subsequent Escape. Existing auth overlay remains above all editors.

## 3. Exact backend and Jira contract

### 3.1 Application routes

Route converter spelling in Flask and policy must match exactly (`<issue_key>`, `match="dynamic"`). All responses, including failures, set `Cache-Control: no-store`. Auth mode/site/user come only from request context. Reject Basic on all three handlers before Jira calls. JSON body must be an object with only the specified keys.

| Route | Policy and headers | Request | 200 response |
| --- | --- | --- | --- |
| `GET /api/issues/<issue_key>/editable-fields` | `authenticated_read`; explicit handler Requested-With check | query `field=assignee|deliveryOwner|storyPoints` only | metadata shape below |
| `POST /api/issues/<issue_key>/user-options` | `user_write`; existing Requested-With + token-bound CSRF guards | `{field,query}`; people fields only, trimmed Unicode length 3–200 | `{issueKey,field,options:[person],limited:true}`; 0–4 non-Me entries |
| `POST /api/issues/<issue_key>/field` | `user_write`; existing Requested-With + token-bound CSRF guards | `{field,value,baseValue,baseUpdated,mappingRevision}` | `{issueKey,field,result:"success"|"unchanged",value,updated}` |

Metadata shape:

```json
{
  "issueKey": "DEMO-1", "field": "assignee", "editable": true,
  "reason": null, "currentValue": {"accountId":"synthetic-user","displayName":"Example Person"},
  "baseUpdated":"2026-09-08T10:00:00.000+0000", "mappingRevision":"digest",
  "me":{"accountId":"synthetic-self","displayName":"Current Person","eligibility":"eligible"}
}
```

`person` has nonempty accountId/displayName and optional Jira-returned emailAddress for search only. Do not persist email in loaded issue models. `currentValue` is normalized person, number, or null. `me=null` for SP; people Me uses eligibility `eligible|ineligible|unverified`. `editable=false` returns a fixed reason code and currentValue whenever the issue itself is readable, so Check Jira still works when editability disappears. Missing required configured mapping returns editable=false, mappingRevision=null, currentValue=null; never guess a write field. Missing issue access remains 404.

Mutation people `value` and `baseValue` contain accountId only (base may be null); labels never choose identity. SP `value` is a JSON number, `baseValue` number or null. Require every mutation key, including null baseline; validate accountId nonempty trimmed string up to 256 characters without control characters. Reject null target/boolean/numeric string/nonfinite/negative/more-than-one-decimal SP. Decimal validation uses `Decimal(str(value))`, finite and `value == value.quantize(Decimal('0.1'))`; protect quantize from oversized exponents and InvalidOperation and return 400. Do not round to accept invalid values. Frontend additionally rejects lexical `1e2`, `.5`, `2.`, comma decimals and blank; API JSON numbers represent values, so equivalent valid JSON numeric notations need not be rejected lexically server-side.

`mappingRevision = sha256(canonical JSON([context.workspace_id, context.cloud_id, logicalField, resolvedFieldId]))`. Recompute current mapping at submit; mismatch →409. It is a stale-mapping check, not permission, signature, or source of the field ID. `baseUpdated` is a timestamp/string from metadata and informational; compare the edited field by accountId/decimal value. An unrelated Jira field update does not cause a false conflict. No atomic compare-and-swap is promised.

For people metadata/search require verified `read:jira-work` + `read:jira-user`; SP metadata requires `read:jira-work`. Mutation additionally requires verified `write:jira-work` (and `read:jira-user` for people). Use `missing_context_oauth_scopes` for both DB and local OAuth contexts. Missing provenance/grants uses the existing AuthError/global recovery path. Requested scopes are not proof of grants. A normal signed-in non-admin with Jira permission succeeds.

### 3.2 Jira requests and validation

Only inject `current_jira_request(...,context=capturedContext)` into the service; no direct requests, Basic credentials, service integrations, Home tokens, local-store resolution, arbitrary URLs, or browser-chosen field IDs. Use direct issue GET for reconciliation, not eventually consistent JQL search.

1. GET `/rest/api/3/issue/{key}` with fields `issuetype,updated,<resolvedFieldId>`. Validate supported actual issue type and subtask flag. This lookup and every subsequent request stay in the authenticated Jira site.
2. GET `/rest/api/3/issue/{key}/editmeta`. Require `set` in operations and schema: Assignee `type=user,system=assignee`; Delivery Owner `type=user,custom=com.atlassian.jira.plugin.system.customfieldtypes:userpicker`; SP `type=number` at the configured custom field ID. Missing/wrong schema/operation fails closed. Do not request screen/security override flags.
3. Me comes from `context.atlassian_account_id` plus the display identity captured for the same auth context generation; GET `/rest/api/3/myself` only for a legacy context where that identity is unavailable. For people fields, run the fresh issue snapshot, edit metadata, and exact-user lookup concurrently after local validation. Assignee eligibility: GET `/rest/api/3/user/assignable/search` with exact `issueKey,accountId,maxResults=1` and no query. DO exact active identity: GET `/rest/api/3/user/search` with `accountId,maxResults=1`; use explicit editmeta allowedValues when present. No assignability requirement for DO.
4. Suggestions: Assignee `/rest/api/3/user/assignable/search` with `issueKey,query,maxResults=5`; DO `/rest/api/3/user/search` with `query,maxResults=5`. Expect an array; filter malformed/inactive records, apply explicit allowedValues if present, dedupe by accountId and remove Me, return at most four. Never follow autoCompleteUrl or enumerate/fan-out through the directory. Cache at most 25 Me/discovered identities only in the mounted browser controller, scoped by auth context and field; reuse an exact normalized query for the same issue without another Jira search, show cached identities on later issue editors as unverified, cap remembered searches at 50, and clear both caches on auth change. Cached identity is presentation data only and never bypasses step 6.
5. DO without explicit allowedValues returns `eligibility=unverified` for Me and identity-only candidates. This remains selectable when the field itself is editable; Jira PUT is authoritative for restrictions. No promise that search results are pre-authorized. A denied exact lookup cannot establish active identity and disables that candidate. Empty search may mean permissions/privacy, not absence of users; use fixed guidance to try display name or Jira.
6. Revalidate snapshot/mapping/editmeta/selected exact identity at submit, then PUT `/rest/api/3/issue/{key}` with one field only: Assignee `{fields:{assignee:{accountId}}}`, DO `{fields:{[configuredId]:{accountId}}}`, SP `{fields:{[configuredId]:number}}`.
7. A 200/204 PUT triggers invalidation immediately, then one direct issue GET. For any issue snapshot, distinguish explicit field null from absent requested key or malformed fields object; absent/malformed field data is a read failure, never a confirmed empty value. After PUT this becomes unknown outcome. Return canonical value even if automation changed it; mark a differing final value visibly. No-op returns current snapshot without PUT, but still lets the client reconcile to that confirmed value.

Bound logical Jira calls: metadata max 4 (snapshot, editmeta, optional myself, exact Me); search max 3 (snapshot/access, editmeta, one query); people submit max 5 (snapshot, editmeta, exact identity, PUT, read-back); SP max 4. No page walk or per-candidate requests. Each Jira call has an explicit 10-second timeout; no write transport retries. Existing OAuth token-refresh behavior may refresh auth as implemented, but no custom retry wraps PUT. Query search is debounced 300 ms; below threshold never call user-options. Auth-scoped controller memory can reuse Me identity, not cross-issue editability.

### 3.3 Sanitized errors and unknown outcome

| Application status/code | Condition / recovery |
| --- | --- |
| 400 `invalid_json`, `invalid_issue_key`, `invalid_field`, `invalid_query`, `invalid_value`, `unsupported_field` | Invalid local contract; zero Jira calls where validation is local |
| 401 existing auth contract | Terminal global lock; never replay the write |
| 403 `csrf_required` | Actual existing guard code for bad/missing CSRF or Requested-With |
| 403 `jira_oauth_required`, `jira_edit_forbidden` | Wrong mode or known Jira authorization refusal |
| 404 `issue_not_found` | Missing/inaccessible issue; no cross-site detail |
| 409 `field_not_editable`, `issue_type_not_supported`, `field_mapping_changed`, `target_unavailable` | Capability/type/mapping/known target failure; reopen or cancel |
| 409 `stale_issue` | Field changed since base, or Jira PUT 409; show new baseline if readable |
| 409 `jira_field_rejected` | Jira PUT 400; known rejected write, fixed guidance, preserve draft |
| 409 `jira_configuration_invalid` | Jira PUT 422; known rejected write, fixed guidance |
| 429 `jira_rate_limited` | Known rejection; carry sanitized retryAfterSeconds bounded 1–60; no auto-submit |
| 502 `jira_read_failed` | Read fails before dispatch; preserve draft |
| 503 `write_outcome_unknown` | PUT timeout/connection loss/ambiguous upstream 5xx, or accepted write with failed read-back; Check Jira only |

Conflict response: `{error:"stale_issue",issueKey,field,currentValue,baseUpdated,mappingRevision}` when a fresh snapshot is readable. If not, omit currentValue/baseUpdated/mappingRevision and require metadata reload; never substitute null for an unknown value. Unknown response: `{error:"write_outcome_unknown",issueKey,field}`. Metadata GET is the Check Jira endpoint and reports current state, not proof this client caused it. Reconciliation must have the same non-null mappingRevision captured at submission. If it differs or is unavailable, retain the original unknown state and show configuration-changed guidance plus the existing safe Jira browse link; do not treat a different field or missing mapping as reconciliation. Never accept a client-frozen field ID to bypass this check.

Jira 401 or AuthError always takes precedence over generic unknown/read-failure translation: accepted PUT then read-back 401 invalidates caches, retains internal unverified state, and propagates the existing sanitized 401/global lock. It must not become 503.

On accepted or ambiguously dispatched PUT, call `clear_jira_issue_status_caches(reason="issue_field_edit")` even if subsequent read fails. On known rejected write, no success/invalidation unless a separate fresh read establishes externally changed state. A browser transport failure after POST dispatch is also unknown, not an ordinary rollback. No automatic retry; after Check Jira succeeds, show observed value, preserve pending desired value separately, and require a new explicit submit if the user still wants it. A read immediately after a timeout is not proof a late write will never occur; retain the documented race limitation and no causal-success claim.

Do not reuse `jsonOrStructuredError` unchanged: it discards conflict snapshots. Follow `capacityApi.js`'s field-specific decoder pattern atop `trackedFetch`, retaining only the typed keys above. Never expose raw error message or arbitrary body data. Every application 401 is already intercepted globally by `apiFetch`.

## 4. State ownership and mutation ordering

Current Board uses `engFilterScopeTasks`, `epicsInScope`, and `epicDetails` via `useEngBoardFilters`; it has no independent fetched issue store at this baseline. Preserve that source. If the separate Board-owned pipeline lands first, adapt its normalized store explicitly before executing this task; never silently fall back to Catch Up as its data source.

Create one small `engIssueEditState.js` module for immutable field patches, mutation generation tracking, and cached snapshot reconciliation. Keep state lifetime tied to the mounted app/auth generation. Use normalized fields: Assignee → `fields.assignee`/Epic `assignee`; DO → Epic `deliveryOwner`; SP → `fields.customfield_10004`, not the tenant write field ID. Never cascade Epic people edits into child Stories. Add accountId to existing shaped people alongside displayName in Jira payload shapers.

Confirmed patches must cover:

- Existing ten arrays in `applyLocalEngIssueField` plus `epicDetails`.
- Every `groupStateRef` snapshot's corresponding arrays/details; preserve group filters, selections, expansion and preferences. Do not clear the map to solve stale data.
- `missingPlanningInfoTasks`/`missingInfoEpics` and derived warnings: recompute local field-presence indicators or mark their source stale and lazily rearm existing alert flow. An edited nonempty assignee/SP cannot leave a stale missing-info warning.
- Dependency data/lookup summaries carrying Story Points: invalidate cached summaries and use existing on-demand dependency reads; no full task refetch.
- Burnout, cohort, excluded-capacity and Project Track source cache refs/data in active state and saved group snapshots: mark affected derived sources stale, invalidate memo/query cache entries, and reload only through their existing visible-view paths. Never eagerly fetch inactive Stats tabs or clear user view state.

Stale-load rule: increment a local mutation generation at dispatch and resolution. At every task/epic/alert load start capture generation; reconcile incoming issue objects using confirmed per-issue/field patches created after that read began, before **any** array/detail/cache commit. Maintain latest accepted observation/version per issue-field, including values accepted from later reads. A stale reader preserves the latest accepted observation, not necessarily the original mutation value: R0 starts, SP=2 is confirmed, R1 starts afterward and confirms SP=3, then R0 resolves; final SP must remain 3. Assign monotonically increasing local read/observation versions; a response predating an accepted observation cannot replace that field. Keep the bounded observation journal until all older tracked readers finish their final downstream commits. Reads begun after confirmation remain authoritative; never keep the original mutation overlay forever. Unknown outcomes increment generation and mark sources stale without publishing the desired value as confirmed. Active/pending request tracking must release in finally on success, abort and error, but only after every downstream array/detail/cache commit has reconciled. Returning from fetchTasks is not the end of the reader if its caller still commits arrays; pass the token/commit adapter through to that final boundary.

Backend cache-fill guard: add a process-local Jira issue cache generation alongside existing server caches. Read it through a server getter (not a scalar copied by bind_server_globals) before Jira I/O. Increment it inside the existing `_cache_lock` in `clear_auth_sensitive_caches` before clearing. Under that same lock, only populate a cache if captured generation still matches. Cover TASKS_CACHE (`jira_server.py`), MISSING_INFO_CACHE/DEPENDENCIES_CACHE/SUBTASKS_CACHE (`eng_routes.py`), EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE, EXCLUDED_CAPACITY_STATS_SOURCE_CACHE, and EPIC_COHORT_CACHE (`jira_server.py`). Preserve existing auth partitioned keys and cache enablement. Test blocked old GET → mutation invalidation → old completion → subsequent read cannot hit stale cache. This is one shared invalidation mechanism, not a new cache or distributed synchronization system.

For aggregate-only stats responses, reject cache/state commits if their captured edit generation differs, and mark the relevant data stale for its existing visible-view retry. Apply this before cache fill, not just setState. `useEngSprintData.js::fetchTasks` and all task/epic commits must consume this shared read token; guard `loadMeasuredGroupTasks` final commit too. Scope/load generations continue to apply in addition to field-edit generations.

Queue correction: existing Planning status and Planning/Board priority/track can bypass the queue. Extend `createIssueMutationQueue` with `enqueueMany(issueKeys, run)` using a sorted unique key set; a job starts only when all its keys are free, reserves them atomically, and releases in finally. Existing enqueue delegates to enqueueMany([key]). Four jobs maximum, no deadlocks from incremental reservation. Use the same queue for status batch, priority, track, and new field mutations in all surfaces. The queue is document-local; auth-required terminally ends writes in this mounted document. Capture backend/site/auth generation before queueing and recheck immediately before dispatch; do not dispatch queued work after auth lock or context change. Never partition by group/sprint/surface, since the same issue can appear in each.

New editor state machine:

```text
closed -> loading -> ready/draft -> queued -> saving -> confirmed -> closed
loading/draft -> cancelled -> closed
saving -> rejected -> draft
saving -> conflict -> draft + Reload required
saving -> unknown -> Check Jira -> observed state + explicit next action
any -> auth-required (terminal mounted-app lock; no replay)
```

A view/group/sprint switch cancels unsent editor work and closes its popover. Already-dispatched writes continue; if the auth/site still matches, patch matching loaded issues/snapshots on confirmation without reopening the editor. A queued job canceled before dispatch must make zero API write calls. Track pending by issue across surfaces even after editor closure. Auth/site changes drop old responses. Use frozen request context, not whichever editor happens to be open when the response arrives.

Planning recalculates from updated task objects through existing `selectedTasksList`, Epic grouping, `sumPlanningStoryPoints`, selected team/project/team-project stats, selected-vs-capacity, missing-SP and allocation inputs. Preserve selected issue keys. Existing overall selected SP and team totals include selected excluded Stories, while Product/Tech allocations use selectedPlanningTasksList with excluded Epics removed. Editing a selected excluded Story changes overall/team totals but leaves allocation unchanged; do not unify these denominators. No direct increment/decrement of display totals, integer parsing, or Jira Epic sum write. Use decimal-tenths summation where needed to prevent visible floating-point residue; round only display boundaries and preserve existing unedited higher-precision Jira values rather than globally rounding historical data.

## 5. Task sequence and file maps

Each task starts by reading its targets/instruction chain, writing the named regression tests, running them red, implementing the described bounded change, then rerunning green. Commands' results below are expected outcomes, not checks already run. Do not execute commits between tasks without publication authorization.

### Task 1 — strict Jira field service and backend routes

Create: `backend/services/jira_issue_field_edits.py`, `tests/test_jira_issue_field_edits.py`, `tests/test_jira_issue_field_routes.py`.
Modify: `backend/routes/eng_routes.py`, `backend/security/policy.py`, `tests/endpoint_security_samples.py`, `tests/test_endpoint_security_matrix.py`.
Read/reuse: `backend/auth/scope_policy.py`, `backend/services/jira_issue_project_track.py`, `backend/routes/capacity_routes.py`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `backend/security/guards.py`.

- [x] Add scripted Jira responses and tests for the section 3 contract. Service public signatures:

```python
load_editable_field(issue_key, field, *, jira_request, context, field_ids)
search_field_users(issue_key, payload, *, jira_request, context, field_ids)
update_issue_field(issue_key, payload, *, jira_request, context, field_ids, invalidate)
```

`field_ids` is a route-created map for the three logical fields using existing getters in the captured request context; reload it at submit request entry. The service cannot accept client field maps. Inject invalidation so accepted PUT and unknown dispatch are tested independently of read-back. Snapshot normalization compares people by accountId and SP by Decimal.

- [x] Implement strict schema/type/value/unknown-key validation, exact Jira reads, one-field PUT, read-back, mapped errors, and bounded calls from section 3. Keep service Flask-free and no forbidden auth imports. Treat `response.json()` failures after accepted PUT as unknown.
- [x] Register routes and dynamic policies, explicit OAuth/context-grant/metadata Requested-With checks, no-store response wrapper, JSON error shaping. Extend endpoint sample paths/payloads so route inventory covers each method.
- [x] Test OAuth regular-user success and Basic denial; missing/provenance-unknown scopes; revoked auth; correct/missing/invalid CSRF and Requested-With; two users and two sites; field absence/schema mismatch/no set; type/subtask mismatch; nondefault field ID; changed mapping; no-op; inactive/unassignable Me; restricted DO and unverified candidates; array shape errors; Jira status mapping; timeout/unknown; exactly one PUT and invalidation after unreadable success; accepted PUT followed by read-back 401 preserves global auth recovery; missing requested field/malformed read-back is unknown rather than null success.

Concrete regression assertions to include in scripted-service tests:

```python
self.assertEqual(put_call['json_body'], {'fields': {'customfield_35024': 1.5}})
self.assertEqual(sum(c['method'] == 'PUT' for c in jira.calls), 1)
self.assertIs(put_call['context'], context)
self.assertEqual(result['value'], 1.5)
# Invalid precision and bool are rejected before Jira:
for bad in (True, -1, 1.25, None, '1.5', float('inf')):
    with self.subTest(value=bad), self.assertRaises(FieldEditInputError):
        validate_story_points(bad)
```

Define `FieldEditInputError`, `FieldEditServiceError` (code/status/sanitized details), and `validate_story_points` in the new service. Base values accept null and existing precision; target validation is separate.

- [x] Exercise real `jira_server.current_jira_request` without Flask request context using captured DB OAuth context and mocked outbound HTTP only. Patch `jira_server.oauth_session_data` and `backend.auth.home_credentials.resolve_home_credential` to raise. Assert wrapper uses OAuth gateway/current user's synthetic Bearer and never Basic/service-token values; source guards reject forbidden service imports. Preserve local OAuth support by a separate actual local-context test, not by calling local helpers from the new service.
- [x] Run `python3 -m unittest tests.test_jira_issue_field_edits tests.test_jira_issue_field_routes tests.test_endpoint_security_matrix`; expected all pass after implementation.

### Task 2 — retain identities and reconcile loaded state

Create: `frontend/src/eng/engIssueEditState.js`, `tests/test_eng_issue_edit_state.js`, `tests/test_issue_edit_cache_generation.py`.
Modify: `jira_server.py`, `backend/routes/eng_routes.py`, `frontend/src/eng/engIssueLocalUpdates.js`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/dashboard.jsx`, `tests/test_eng_issue_local_updates.js`, `tests/test_planning_selection_stats.js`.
Modify only if decimal regression demonstrates need: `frontend/src/eng/planningSelectionStats.js`.

- [x] Test synthetic same-name/different-account people, no cascading Epic owner changes, zero vs null, same issue in multiple group snapshots, task load resolving before/after mutation, stale stats response, R0/write/R1-newer/R0-late ordering, final caller commit after fetch return, unknown write plus mapping change, and scope switch.
- [x] Preserve accountId in `fetch_epic_details_bulk` Assignee/Delivery Owner, task shaping in `jira_server.py`, its backlog Epic fallback shaping, and `eng_routes.py` Story shaping, while retaining displayName. Do not rename current JSON fields or assume all consumers supply accountId before metadata loads.
- [x] Add backend cache generation checks from section 4 at all listed cache writers, using the existing server cache lock and preserving partition keys. Add tests/test_issue_edit_cache_generation.py with blocked pre-write producers and post-write cache lookup assertions.
- [x] Implement the read-token/confirmed-patch lifecycle from section 4. Expose a focused hook/adapter to dashboard wiring with `beginRead`, `finishRead`, `beginMutation`, `confirmMutation`, `markUnknown`, `reconcileIssues`, and `isCurrentAggregateRead`; define each in the new module and unit-test its lifetime. Do not keep response overlays after tracked older readers have drained.
- [x] Patch active arrays and cached snapshots immutably; preserve group selection/filter fields. Add generation checks before `useEngSprintData` epic merge, task arrays, ready-to-close and alert commits; before dashboard final task commits, group restoration and lazy stats cache/state commits. Invalidate dependency summaries and affected lazy derived caches as specified.
- [x] Verify existing grouping/calculator selectors consume replacement objects and all downstream memo dependencies rerun. Add the 1.5+3→2+3=5 fixture for both-selected, only-second-selected (3), excluded Story, zero and null. Assert selected keys unchanged and no Epic Jira write.

```javascript
const updated = applyLocalIssueFieldUpdate(stories, 'DEMO-1', 'customfield_10004', 2);
assert.equal(sumPlanningStoryPoints(updated), 5);
assert.equal(stories[0].fields.customfield_10004, 1.5);
```

- [x] Run `node --test tests/test_eng_issue_edit_state.js tests/test_eng_issue_local_updates.js tests/test_planning_selection_stats.js`; expected pass, plus existing shaping tests identified through callers.

### Task 3 — queue, network adapter and editor controller

Modify: `frontend/src/eng/engIssueMutationQueue.js`, `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/eng/useEngPriorityTransitions.js`, `frontend/src/eng/useEngProjectTrackTransitions.js`, `frontend/src/api/jiraIssueApi.js`, `tests/test_eng_issue_mutation_queue.js`.
Create: `frontend/src/eng/useEngIssueFieldEdits.js`, `frontend/src/eng/engIssueFieldEditUtils.js`, `tests/test_eng_issue_field_edits.js`, `tests/test_jira_issue_field_api.js`.
Read/reuse: `frontend/src/api/capacityApi.js`, `frontend/src/api/http.js`, `frontend/src/api/authRequired.js`.

- [x] Add queue tests: jobs reserving [A,B] and [B,C] never overlap; disjoint jobs can run; rejection releases keys; max four active; canceled queued job never dispatches. Do not change existing status/priority success/rollback presentation or batch payloads while replacing queue bypasses.
- [x] Extend enqueue with multi-key reservations as section 4 specifies. Wire all existing ENG mutation runners into it, preserving current UI behavior. Use pre-dispatch auth/context and cancellation checks.
- [x] Add `fetchEditableIssueField`, `searchIssueFieldUsers`, `updateIssueField` exports to existing API module; search/mutation both acquire existing single-flight CSRF. Retain only validated conflict fields/Retry-After details in a field-specific decoder. Use fixed frontend message map, never raw upstream messages.
- [x] Implement the controller state machine, one active editor, frozen submit context, same-issue pending state, read/search cancellation, dispatch tracking, unknown outcome, Reload/Check Jira, auth lock and propagation callbacks. Do not abort dispatched writes on popover close. A rejected old request must not clear the current editor's pending state.
- [x] Put lexical parsing and suggestion dedupe in `engIssueFieldEditUtils.js` for pure tests. `parseStoryPointsDraft` returns `{valid,value}` and rejects invalid lexemes; normalize/display 2.0 as 2. Below 3 Unicode characters never search; 300ms debounce; stale query responses cannot select; pin Me first even if query doesn't match; max five total.
- [x] Run `node --test tests/test_eng_issue_mutation_queue.js tests/test_eng_issue_field_edits.js tests/test_jira_issue_field_api.js`; expected pass. Re-run existing priority/track/status unit tests for queue changes.

### Task 4 — shared popover mechanics and thin controls

Create: `frontend/src/issues/useIssueFieldPopover.js`, `frontend/src/issues/IssuePersonEditor.jsx`, `frontend/src/issues/StoryPointsEditor.jsx`.
Modify: `frontend/src/issues/IssueFieldOptionMenu.jsx`, `frontend/src/styles/eng/status-transitions.css`.
Create: `tests/ui/eng_issue_field_edits.spec.js` using existing dashboard-shell fixtures.

- [x] Characterize old menu open/focus/Escape/outside/preview behavior before extracting only positioning/dismissal. Keep menu-specific first-option and onboarding behavior in `IssueFieldOptionMenu`. The shared hook owns trigger/panel refs, portal geometry, edge bounds, outside dismissal and cleanup; no field fetching or selection.
- [x] Build person editor native trigger and combobox/listbox: input focus, aria-controls/expanded/activedescendant, arrows skipping disabled rows, Enter select once, Escape dismiss/restore. Me appears while query is below threshold after metadata; disabled/unverified states follow section 3. Reuse styles from section 2.
- [x] Build SP as the existing inline value itself: a native input with inputMode=decimal, no trigger button, dialog, popup, Save, or Cancel controls. Enter saves once; Escape/outside cancels dirty local input; validation sends no request. Pending shows the last confirmed value without moving geometry.
- [x] Preserve the SP slot's inherited typography and use only an inline focus/error indicator plus screen-reader feedback. Only a freshly loaded canonical metadata value equal to target suppresses a network write; stale card display is not a no-op baseline. Server independently rechecks no-op against Jira.
- [x] Run new Playwright editor tests plus `tests/ui/eng_status_transitions.spec.js`, `tests/ui/eng_project_track_transitions.spec.js`, `tests/ui/eng_priority_transitions.spec.js`, and `tests/ui/onboarding_tour.spec.js`; expected existing interactions unchanged. Verify actual unforced clicks, not forced coordinate workarounds.

### Task 5 — Catch Up, Planning and Board wiring

Modify: `frontend/src/issues/IssueCard.jsx`, `frontend/src/dashboard.jsx`, `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `frontend/src/eng/EngBoardView.jsx`, `frontend/src/styles/eng/issues.css`, `frontend/src/styles/eng/epics.css`, `frontend/src/styles/eng/board.css`.
Modify: `tests/ui/eng_issue_field_edits.spec.js`, `tests/ui/eng_group_board_card.spec.js`, `tests/ui/eng_group_board_panel.spec.js`, `tests/ui/eng_group_board_drag.spec.js`.

- [x] Replace Story Assignee/SP at existing positions. Change truthiness to explicit null/undefined handling; show zero. Keep Epic DO limited to existing Board metadata; do not add it to Catch Up or Planning. Pass one controller object where practical; dashboard holds only wiring and normalized state callbacks.
- [x] Route Missing: Story Points alert title and Fix fields actions to the dashboard Story. Clear active ENG filters when they hide it, retain the existing Story highlight, focus/select the inline SP input, and let its normal on-demand metadata load enter edit mode. Do not open Jira or add another editor surface for this alert.
- [x] Gate on ENG surface + OAuth + correct actual issue type. Initial trigger may load capability on demand; editing is disabled until metadata explicitly says editable. Basic/EPM/Stats/Scenario/subtasks remain inert. Avoid new per-card capabilities on mount.
- [x] Implement Board wrapper/open-button/sibling controls structure from section 2; retain .ecard data hooks and visual geometry. Update all focus-return fallbacks and keyboard handlers; person interaction cannot trigger parent open, drag, or selection. Keep actual summary drag/drop functional.
- [x] Add Epic people to panel .m-controls and Story assignee in existing row cell, portal within panel root, add editor closers. Confirm Escape hierarchy and Tab containment even during metadata loading.
- [x] Verify success updates every surface and inactive group snapshot; SP changes recalculate Planning and Board display after switching. Pending save during scope change never reopens an editor or restores old filters. Add two simultaneous different-issue edits and one same-issue cross-control test.
- [x] Verify fixed/ellipsized long-name slots on desktop/mobile; retain metadata rows and current typography. Capture before/after settled screenshots with animations disabled or settled. Assert actual label bounds and horizontal clipping; inspect images.

### Task 6 — analytics and complete regression/acceptance

Modify: `frontend/src/analytics/dashboardAnalytics.js`, `frontend/src/analytics/events.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, this plan and its design/index.
Rebuild: `frontend/dist/` only through npm build.

- [x] Add canonical `issue_field_edit_action`, trigger `userevent`, event_type `event`, feature_name `eng_issue_field_edits`; params `workflow_action=open|submit|result`, `field_name=assignee|delivery_owner|story_points`, existing `issue_kind=epic|story`, `source_surface=catch_up|planning|board`, result-only `result=success|unchanged|conflict|failure|unknown`. Add `field_name` to the param allowlist and validate enums in the builder. Reuse existing `issue_kind` rather than invent `issue_type`.
- [x] Add API reliability surface `jira_issue_field_edits`. Preserve GA4_ENABLED, two GTM triggers, privacy filtering and <=25 params. Test no query/name/email/accountId/issue key/field ID/raw SP/raw error leakage. No per-keystroke/cancel/recalculation event; document incidental-state allowlist reason. Runbook documents event verification, not bulk dimension registration.
- [x] Run full Python + Node + relevant Playwright suite and build with pinned runtime. Include structure budgets and real-wrapper auth test and tests.test_issue_edit_cache_generation. Do not weaken tests/raise budgets to fit new logic in dashboard.
- [ ] Perform read-only tenant capability campaign and approved disposable Jira writes as section 6 specifies. Record pass/fail accurately without sensitive data. Update docs to actual outcome; do not mark DONE until implementation verified and accepted/merged.

## 6. Concrete verification matrix and gates

Implementation can begin from this plan using synthetic tests. Live tenant capability and write evidence gate final acceptance, not plan authorship or local implementation. No Home-write gate blocks this Jira REST feature.

| Campaign | Required evidence |
| --- | --- |
| API correctness | Exact HTTP paths/params/one-field bodies and schema validation, official docs listed below; array vs object fixtures; no assignability check for DO; no autoCompleteUrl proxy |
| Search | 0/1/2 Unicode characters no query; 3 one debounced query; delete below 3 hides stale results; Me first/deduped; max five; names/email/privacy/permission empty results; inactive/unassignable users |
| Numeric | 0,1.5,2,3,2.0 accepted; blank/null target/bool/negative/NaN/infinity/string API/1.25 invalid; old precision baseline preserved; zero rendered |
| Persistence | Each supported field/issue type updates actual Jira, read-back, current UI, group switch, view switch, reload; Epic sums are derived only |
| Concurrency | Changed same field →409; changed other field not false conflict; mapping switch →409; overlapping status batch/field edit serialized; old task/metadata/search/stats response cannot clobber newer value |
| Recovery | Known 400/409/422 write rejection is not unknown; timeout/accepted-PUT-read-fail/browser transport loss is unknown; no auto-retry; Check Jira read only; user reselects explicitly; 401 global lock suppresses queued POST |
| Security | Non-admin succeeds with Jira rights; Basic/unauthenticated/cross-site/wrong grants/CSRF fail; DB uses no local/Home/service credential; real wrapper works with captured context outside request |
| Layout | Same card/header heights and one-line summaries; label bounds; no nested controls; popup bounds after scroll/resize and mobile visualViewport change, unforced option elementFromPoint hit checks, modal focus containment, open Planning above Epic header and closed Planning Epic-at-top sticky assertions; real drag; normal option clicks; desktop 1440x900 and mobile 390x844 screenshots |
| Calculations | Epic 1.5+3→2+3=5; selected total 5/both or 3/second only; filters/keys/exclusions preserved; team/project/remaining/allocation inputs update; fractional display without artifacts |
| Existing features | Status/priority/track/onboarding and Catch Up/Planning/Board interactions still pass; Scenario remains inert; no initial-load request fan-out |

Commands after implementation:

```bash
python3 -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui/eng_issue_field_edits.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_drag.spec.js tests/ui/onboarding_tour.spec.js
npm run build
git diff --check
```

Use repo pinned Python/OpenSSL and Node20. Fresh checkout requires `npm ci` before build. Existing browser fixtures run against the configured local test server; follow Playwright config, do not point tests at live production. If startup paths change, run the required preflight/server `/api/test` verification. Preserve generated dist according to CI policy when publication is authorized.

Live acceptance: authenticate using the application's supported Atlassian OAuth path, including Microsoft Entra SSO. Verify exact/partial visible email, first/surname, hidden-email limitations, Me eligibility, actual configured numeric/single-user fields. Use an operator-approved disposable Epic and Story for writes, record only sanitized results, and check native Jira values plus dashboard reload. Do not create credentials, new integrations, production tickets, or mutate arbitrary targets to satisfy this gate.

## 7. Review closure and residual limits

Review completed on 2026-09-08 by separate API, UI reuse, and state/calculation subagents plus root integration. All reported findings were incorporated and checked again.

| Review | Final outcome |
| --- | --- |
| API/security | Exact contracts, schema/operations, permissions, rejected/unknown errors, auth precedence and malformed read-back findings closed; no remaining blocker identified |
| UI reuse | Shared CSS/input/button/placement contracts, Board sibling controls, focus and portal containment accepted; missing status regression spec added and verified to exist |
| State/concurrency | Group/cache propagation, queue bypasses, newer-read ordering, downstream token lifetime, mapping-change uncertainty and calculator denominators closed; no remaining blocker identified |
| Root document verification | All 14 Create paths distinguished from existing paths; mapped existing files and named regression specs exist; relative links and index resolve; no TODO/TBD placeholders; git diff --check passes |

These are plan review results, not runtime tests. No application suite, visual campaign, or live Jira persistence test was run for this documentation-only task. Readiness authorizes a clear local implementation path, while section 6 acceptance requirements remain unexecuted.

Corrections incorporated: strict editmeta schemas/set operation; literal supported types; DO identity vs eligibility; Jira 400/409/422 vs unknown classification; context-only grant checks; CSRF actual code; conflict-body preservation; Board nested controls/focus; existing CSS/input/button reuse; normalized identities/SP; group snapshots/dependency/stats invalidation; pre-load generations; cross-surface queue bypasses; actual analytics allowlists.

Residual limits: Jira privacy and user-search permission determine matching; DO field restrictions may be enforced only at PUT; GET/PUT is non-atomic across other Jira clients; timeout reconciliation confirms observed state, not causality; another process can serve old cache until normal expiry/reload because this plan adds no cross-process event system. No claim of live tenant acceptance until the campaign passes.

Sources verified by API review:

- [Jira user search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-user-search/).
- [Official Jira v3 OpenAPI](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json): edit issue, edit metadata, status codes, user query schemas.
- [Jira privacy migration](https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-user-privacy-api-migration-guide/).
