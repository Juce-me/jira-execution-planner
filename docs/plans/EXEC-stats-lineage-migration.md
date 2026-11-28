# Statistics lineage across the Legacy → DELIVERY copy Implementation Plan

> **Status:** Draft, not started. Revision 2 (2026-11-28), closing one independent review (5 P1, 9 P2, minors). Written against `feature/legacy-delivery-migration` at `5f5dede0` (base `origin/main` `f85c3ce3`). Before Task 1, satisfy the [preconditions](#preconditions-and-dependencies), fetch again, re-read every cited symbol and record the operator's answers to the [operator decisions](#operator-decisions).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the Legacy → DELIVERY copy, Statistics treats a Legacy item and its DELIVERY copy as one piece of work (a **lineage**): Lead Times measures from when the work really started to when its current copy finished, and no Statistics view counts the pair twice where it would not count a rolled-over Story twice.

**Operator request (2026-11-28):** "for the epics in Delivery or legacy we need now ability to keep an eye on related to similar entities to calculate the lead time correctly".

**Architecture:**

- **Source of lineage: the Relates links already in Jira, read at Statistics time.** The two Statistics reads that list work items (the Lead Times cohort search and the stats-source search behind Excluded Capacity, Mono vs Cross and Project Track) add the standard `issuelinks` field to searches they already make, only when lineage applies to the request. A new pure module, `backend/services/stats_lineage.py`, keeps only Relates links that cross from a configured Legacy project to the DELIVERY project at the expected levels and attaches one compact `lineage` object per member. No table, no marker read, no migration module: the data survives the migration tool's removal (Task R of the migration plan).
- **Lead Times needs the counterpart's dates.** When a linked counterpart is not in the fetched set, the cohort route reads it with bounded `key in (...)` searches through the request's own pager (page budget below), matched back by immutable issue id and normalised by the existing `_normalize_cohort_issues`.
- **One scoped fetch, client-side regrouping.** The server only annotates; it never drops or merges rows. The browser collapses lineages in the derived layers that already own filtering (`frontend/src/stats/useStatsData.js` with `cohortUtils.js`, `excludedCapacityStats.js`, `projectTrackStats.js`) through one helper module, `frontend/src/stats/statsLineage.js`. Changing a filter never refetches.

**Tech Stack:** Flask (`jira_server.py` stats handlers, `backend/services/`, `backend/routes/work_request.py`), React 19 + esbuild, `unittest` through the isolated runner, `node --test`, Playwright Chromium.

## Preconditions and dependencies

- **Branch.** Create the implementation branch from freshly fetched `origin/main` (`git fetch origin && git switch -c feature/stats-lineage origin/main`), then verify `git log --oneline origin/main..HEAD` is empty before the first edit (project learning: never carry another issue's commits). The plan document itself is delivered on its own docs branch cut from `origin/main`.
- **Dependencies on the unmerged migration work.** These sources exist only on `feature/legacy-delivery-migration` at the time of writing:
  - `docs/plans/SUPPORT-legacy-delivery-migration-design.md` (copy rules table, design decisions D2, D14, D17, D19, Residual risks, Sunset and removal);
  - `docs/plans/EXEC-legacy-delivery-migration.md` (Endpoint contract matrix; Task R Step 3, the leftover grep at about line 1022);
  - `backend/services/delivery_migration_*.py` (cited only as things this plan must not import).

  If the migration PR has merged, re-read those sections and confirm the copy rules, D2 and the Task R grep are unchanged. If it has not merged, execution may still proceed: no task imports or reads that code, the copy rules are restated in [Definitions](#definitions), and the Task R pattern is restated in Task 1's guard. If the migration is abandoned (its Status records `Abandoned`), the plan still applies to any Relates links made by hand or by the agent before the tool, but ask the operator whether to proceed before Task 1.
- **Other inputs (on `origin/main`):** [docs/features/statistics.md](../features/statistics.md), [SUPPORT-lead-times-modes-design.md](SUPPORT-lead-times-modes-design.md), [DONE-lead-times-modes.md](DONE-lead-times-modes.md).

## Evidence: how Statistics works today

Verified in this tree on 2026-11-28. Line numbers are anchors at `5f5dede0`; re-read them before editing.

| Area | Where | What it does today | Lineage consequence |
|---|---|---|---|
| Lead Times unit | `fetch_epic_cohort_data`, `fetch_closed_epic_cohort_data` (`jira_server.py` ~5711, ~5831) | Searches the configuration's **parent role** (`roles.parent_clause()`): Legacy Epics, DELIVERY Initiatives. Fields `summary, created, status, resolutiondate, assignee, project` + Team. The Created flat path calls `jira_search_request(payload)` without an explicit context (~5769). | Legacy Epic → DELIVERY Initiative maps one Lead Times unit onto the other. Lineage reads must pass `context=auth_context` explicitly. |
| Lead time | `_normalize_cohort_issues` (~5555) | `leadTimeDays = terminal - created` (terminal = `resolutiondate`, else first terminal status transition from the changelog; at most `EPIC_COHORT_ENRICH_MAX_ISSUES=200` changelog reads per call, ~5573). No pause handling. | A copy's lead time restarts at its creation. |
| Mixed-era ranges | `_cohort_range_fetch` (~6609), `admit_quarter_range` (`backend/routes/work_request.py:103`) | Ranges split at configuration boundaries; each segment searches only its own configuration's projects. | Every tool copy is created before `2027-01-01` (the tool closes then), i.e. in the last Legacy quarter when Legacy `throughQuarter` is 2026Q4, so Created mode never shows those DELIVERY Initiatives today. Lineage reaches them through their Legacy source. |
| Last N | `admit_last_n_request` (`jira_server.py:3366`), `epic_cohort_closed.fetch_closed_epics` | One configuration, newest closed window of 200, ranked by own close day; the client slices N after filters. | A Legacy Epic closed by hand after copying can enter the window although the work continues in DELIVERY. |
| Cohort route timing | `get_epic_cohort_stats` (~6653–6770) | No `Server-Timing` header (only the stats source sets one, ~6446). | Latency is measured by wall clock (Task 5). |
| Cohort cache | `EPIC_COHORT_CACHE` (~230, ~6699) | Gated by `jira_home_process_cache_enabled`, which returns `False` (`backend/auth/cache_policy.py:18`). | Effectively off: nothing to migrate. |
| Stats source | `fetch_excluded_capacity_stats_source` (~6194), `get_excluded_capacity_stats_source` (~6375), `admit_sprint_id_groups` (~6329, reads `active_entries` at ~6341) | Per-Sprint progressive search of **planning leaves** (Legacy Stories, DELIVERY Epics) with `epicKey` = the parent (Legacy Epic, DELIVERY Initiative), `customfield_10101` = normalised Sprints; parent metadata from `fetch_cached_excluded_capacity_epic_summaries` (~6061). | Legacy Story → DELIVERY Epic maps one leaf onto the other; parents map Epic → Initiative. |
| Stats-source cache | `EXCLUDED_CAPACITY_STATS_SOURCE_CACHE`, `_excluded_capacity_stats_source_cache_key` (~6169) | Per user (`build_jira_home_process_cache_key`), 300 s TTL; the key hashes the JQL **and the field list**; `refresh` bypasses it. | Adding `issuelinks` changes the key automatically, only for lineage-enabled requests. |
| Parent summary cache | `EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE`, `excluded_capacity_epic_summary_cache_key` (~6054) | 3,600 s TTL; key = auth partition + parent key + configuration segment; `fetch_cached_excluded_capacity_epic_summaries` takes no `refresh` argument; only `clear_auth_sensitive_caches` (~1953) empties it. | Needs a `refresh` pass-through and a lineage segment carrying both configurations' digests. |
| Excluded Capacity trend, Mono vs Cross, Team Cross Share | `buildExcludedCapacityTimeSeries`, `buildEpicTeamModeBuckets` (bucket key `epicKey::sprint`, ~576), `buildEpicTeamCrossShareLineSeries` (`frontend/src/stats/excludedCapacityStats.js`) | A Story counts in **every** selected Sprint its Sprint field lists (`taskMatchesSprint`); overall Mono vs Cross sums the per-Sprint buckets. | A Legacy Story (Legacy Sprint) and its copy (DELIVERY `fromQuarter` Sprint) sit in different Sprint buckets: counting each there is the rollover convention. |
| Effort Split | `buildEffortTypeSplitRows` (~432) | Each task counts **once** per range if it matches any selected Sprint. | Two keys: double counted over a range covering both quarters. |
| Project Track | `inScope` (~35), `firstSprint`, `buildProjectTrackSprintSeries`, `buildProjectTrackBreakdownRows` (`frontend/src/stats/projectTrackStats.js`) | A Story counts once, in its **first** Sprint; Epic mode groups by `epicKey`, drops parents in `CLOSED_EPIC_STATUSES` (~10); Team mode drops Killed Stories and Stories under Killed parents (~39). | Double count over a range; Epic mode shows two groups; a Legacy item closed after copying would drop live work. |
| Lead Times filters | `filterCohortIssues` (`frontend/src/cohort/cohortUtils.js:202`, exclusion check at ~212), `deriveProjectOptions(cohortIssues)` (`useStatsData.js:499`) | Exclusion by the row's own key; project options from the fetched rows. | A collapsed row keyed by the DELIVERY head would escape a Legacy exclusion and lose Legacy project options. |
| Teams, Priority, Burndown | `fetch_stats_for_sprint`, `fetch_burnout_events_for_sprint`, local Catch Up tasks | One Sprint, one configuration's projects. | See D-L9. |
| Configuration bundle | `normalize_work_configurations` (`backend/services/work_structure.py:455-480`) | Exactly two entries; Legacy `throughQuarter` and DELIVERY `fromQuarter` both required and contiguous; project sets are **not** required to be disjoint. `editor_bundle` (~563) returns a virtual capture when unpromoted. | Lineage roles must come from the stored entries the request admitted with; overlapping projects need a rule (D-L1). |

## Definitions

- **Copy roles** (restating the migration design's Copy rules table for the levels Statistics counts):

  | Statistics unit | Legacy member | DELIVERY member (the copy) |
  |---|---|---|
  | Lead Times row; stats-source parent (`epicKey`) | Epic (Legacy parent role) | Initiative (DELIVERY parent role) |
  | Stats-source leaf | planning Story/Task (Legacy planning role) | Epic (DELIVERY planning role) |

  Legacy sub-tasks → DELIVERY Stories, Initiatives → Objectives and Objectives → Strategies are copies too, but no Statistics view counts those levels.
- **Lineage link:** an issue link whose `type.name` is `Relates` (case-insensitive), read from the `issuelinks` field, between an issue in a Legacy-only project and an issue in a DELIVERY-only project, both at the same row of the table above. A project key present in **both** configurations' scopes is overlapping: any link touching it is skipped and counted in `meta.lineage.overlapSkipped` (D-L1). The project of a linked issue is the prefix of its key (Jira project keys contain no `-`). Direction does not matter. Roles are matched from the configuration only: parent role through `WorkRoles.parent_term()` (`('name','Epic')` in Legacy compatibility mode, else the type id), Legacy planning role through `WorkRoles.planning_type_id()` / `WorkRoles.legacy_planning_names` (captured names; `None` = mapped id; `[]` = unrestricted, which needs the link stub's `issuetype.hierarchyLevel == 0` and `subtask == false`; if Task 0 finds those keys absent, leaf lineage is off for an unrestricted Legacy configuration and `meta.lineage.leafComputed=false`), DELIVERY roles through their mapped type ids.
- **Lineage group:** the connected set formed by lineage links at one level among the issues whose links were read. Its **head** is the DELIVERY member, its **sources** the Legacy members. **One rule for both routes:** a group is **valid** when it has exactly one head; a group in which any read Legacy member links to two or more DELIVERY items at that level is **ambiguous** and nothing in it merges; consolidation (several sources, one head; migration design D17) is valid. A loaded Legacy item always exposes its full head set in its own links, so the stats source detects every ambiguity that could affect a count among loaded items; the cohort route additionally reads unloaded members (two hops) and marks a group **incomplete** when a needed read fails or is capped. Ambiguous and incomplete members stay standalone, exactly as today.
- **Visible lineage:** Jira omits links and issues the requester cannot browse; lineage is computed per requesting user from that user's own OAuth reads.
- **Marker.** The tool's issue property is not read (resolved, see D-L8): migration design D2 defines "In DELIVERY" by one Relates link at the expected level, the marker exists only on tool-made copies (not on hand-made or pre-tool agent copies), and Task R's leftover grep forbids naming it outside `docs/plans/`.

## Decisions

### D-L1 Lineage resolution rules

As in [Definitions](#definitions). Overlapping projects are skipped rather than guessed. Roles are derived from the **same stored entries the request was admitted with** (no second snapshot read; P2-9): each admission helper (`admit_quarter_range`, `admit_sprint_id_groups`, `admit_last_n_request`) exposes the `entries` list it used, and `LineageRoles.from_entries(entries)` builds the matchers. Unpromoted requests (`active_entries` is `None`) get `LineageRoles = None`: no `issuelinks` in the field list, no lineage keys, byte-identical responses and unchanged cache keys.

### D-L2 Lead-time rule for a valid lineage (operator decision Q1)

| Rule | Start | End | Verdict |
|---|---|---|---|
| **R1 (recommended)** | earliest `created` across members | the head's terminal date (refined by D-L3) | Same calendar definition as today, now spanning the copy; no extra changelog reads beyond the existing fallback. |
| R2 | earliest first-In-Progress across members | head terminal | Changes the definition for every Epic and needs full changelogs per member. Reject now. |
| R3 | sum of members' own active intervals | — | Administrative closures make "active" ill-defined. Reject. |
| R4 | keep members separate | — | Leaves the problem. Reject. |

### D-L3 Lineage status and end date (operator decision Q2 for rule 3)

Teams commonly close a migrated Legacy item as Incomplete or Killed, and the tool never edits Legacy, so a Legacy terminal date alone never ends a lineage:

1. Head open → open; `leadTimeDays = today − start`.
2. Head Done → Done; end = the later of the head's terminal date and any Legacy source's Done date.
3. Head Killed, Incomplete or Postponed, and at least one Legacy source Done → Done, end = the latest Legacy Done date.
4. Otherwise → the head's status and terminal date.

Postponed stays terminal in Created mode and excluded from the closed modes. `terminalDateSource` is that of the member supplying the end.

### D-L4 Lead Times placement and filters (operator decisions Q5, Q10; Q4 for exclusion)

- Created mode places a lineage by its **start** (`startQuarter`/`startMonth`, computed server-side with `assign_to_period`); a range holding only the copy's creation drops it (Q5). Closed mode places by end date; Last N ranks by end date after the collapse.
- Row identity: `key`, summary, Team, assignee and `jiraStatus` are the head's; status, dates and lead time are the lineage's.
- **Project filter (Q10):** matches when any member's project matches. **Project options are derived from all members before the collapse** (raw rows plus `lineage.members[].projectKey`), so Legacy projects stay selectable.
- **Exclusion (Q4, P1-5):** Exclude **Excluded Capacity** hides a lineage row when **any** member key is in the Department's `excludedCapacityEpics`; Exclude **Ad Hoc** hides it when any member is tagged `capacityType: 'ad_hoc'`. This keeps today's hidden Legacy work hidden after the collapse. The per-leaf views keep own-key semantics (D-L5).
- The closed-mode Jira link lists head keys only.

### D-L5 Double counting and grouping in the stats-source views (operator decision Q9)

- **Parent grouping (one rule, P2-5):** every view that groups by `epicKey` (Mono vs Cross buckets, Team Cross Share buckets, Project Track Epic mode) groups by `parentGroupKey = fields.epicLineage.headKey` when the parent lineage is valid, else `epicKey`. Excluded/Ad Hoc **membership** stays the leaf's own `epicKey` (configured lists are explicit).
- **U1, per-Sprint views** (Excluded Capacity trend, Mono vs Cross, Team Cross Share): each member counts in its own Sprint bucket, like a rolled-over Story; two members of one valid leaf lineage in the same `parentGroupKey::sprint` bucket count once, as the head when loaded.
- **U2, range-once views** (Effort Split, Project Track both modes): a valid leaf lineage counts once per range. **Placement** (Sprint, Team, Story Points) comes from the earliest in-range member, mirroring Project Track's `firstSprint`. **Status** comes from the lineage head (`fields.lineage.headStatus`, read from the link stub, so it is known even when the head is outside the range), as a rolled-over Story shows its current status; the **closed-parent gate** comes from the parent lineage head (`fields.epicLineage.headStatus`) when the parent lineage is valid. The view filters (Team mode Killed drop, Epic mode closed-parent drop, capacity side, exclusions) run **after** the dedupe, on those lineage values.

| View | Rule | Change |
|---|---|---|
| Lead Times (all modes, Avg/Median, heatmap, lists, Workflow Status card) | D-L2 to D-L4 | Client collapse |
| Excluded Capacity trend | U1 | Same-bucket dedupe |
| Effort Split (rows, totals) | U2 | Dedupe, status from head |
| Mono vs Cross, Team Cross Share | U1 + parent grouping | Regroup, same-bucket dedupe; overall still sums buckets |
| Project Track Team mode (totals, per-Sprint, By team, strips) | U2; the strip uses the head's status | Dedupe, status from head |
| Project Track Epic mode | U2 + parent grouping; track and closed gate from the parent head | Dedupe, regroup |
| Project Track time in phase | unchanged (Q7) | none |
| Teams, Priority, Burndown, Delivery summary | D-L9 | none |

Story Points stay each member's own value; null stays null and displays `0 SP`.

### D-L6 Where lineage is resolved

The server annotates (only it can read links and counterparts under the user's OAuth context); the client collapses (filters and ranges live there). Rejected: a stored lineage table (duplicates Jira, needs sync); the migration claims table (Task R drops it; it misses hand-made links); client Jira reads (forbidden).

### D-L7 UI (described only; operator decision Q3)

No new control in Phase 1.

- **Lead Times rows** (`OpenEpicsChart.jsx`, which renders the Open and Completed lists): the existing `cohort-open-meta` line gains `· from <Legacy key>` or `· from <n> Legacy <parents>`. `OpenEpicsChart` has no entity-name prop today: add a `legacyParentWord` prop (the Legacy parent role's configured name and plural, from the Legacy configuration's entity names, passed down from `LeadTimesEpicCharts.jsx`), because in DELIVERY or mixed scope `statWords` names DELIVERY roles. No hover readout is added.
- **One `stats-note` line** under the scope line, built from `meta.lineage` counts: `<n> <parents> include their earlier Legacy history.`; only when non-zero, `<n> have more than one DELIVERY copy and are shown separately.` and `Couldn't read the Legacy history of <n> <parents>.` Wording goes to the operator gate (Task 7).
- **Effort Split, Mono vs Cross, Project Track:** no visible change beyond corrected numbers.

### D-L8 Sunset interplay and the Task R grep (P1-1)

Lineage code, tests and docs outside `docs/plans/` must not match Task R Step 3's case-insensitive pattern, restated here as its parts: `delivery[_-]?migration`, `DeliveryPointer`, `MigrationDialog`, `MigrationSlot`, `renderMigrationSlot`, `LEGACY_DELIVERY_MIGRATION`, the marker property name. The guard test assembles those tokens by string concatenation so the test file itself does not match, scans the feature's files and the touched `jira_server.py` functions, and checks imports by AST (Task 1). The feature has no end date.

### D-L9 Single-Sprint views (resolved; was an open question)

Teams, Priority and Burndown read one Sprint under one configuration's project scope. A lineage always crosses configurations (D-L1), so its two members can share one of those datasets only if a project is in both scopes. Task 2 Step 0 checks the stored entries: projects disjoint ⇒ no single-Sprint double count is possible, no change; any overlap ⇒ links on it are skipped (D-L1) and the overlap is reported to the operator as a configuration finding. The `scope.boardId` comparison is recorded as context (an inherited Board shares Sprint ids, but each configuration still reads only its own projects).

## Global constraints

- **Read-only, OAuth only.** No Jira write, no new route, no DB table or migration, no persisted setting, no `localStorage` key. Jira reads go through `jira_search_request(..., context=auth_context)` and `current_jira_get(..., context=auth_context)` with an explicit context (so worker threads and no-request-context paths reach the real auth wrapper). Basic/API-token credentials (`build_jira_headers`, `HTTPBasicAuth`), service integrations (`service_integration*`) and local token-store helpers (`oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`) are forbidden.
- **Request contracts unchanged.** Request bodies, the Created byte-identical request and `buildCohortQueryKey` are unchanged. Responses only gain optional fields.
- **Scope.** Lineage inherits the request's workspace (auth context), configuration segments and Department scope. Counterpart reads are by key only, never widen the Team or Component scope, and never add rows.
- **Temporary switch.** `STATS_LINEAGE_LINKS` (env, default `true`) exists only for the Task 5 latency comparison and is removed in Task 5.
- **Postmortems to read before editing:** MRT010, MRT019, MRT031 (size `key in (...)` batches with `paged_search_bytes` via `epic_cohort_closed.key_batches`), MRT020/MRT021, MRT016.
- **Budgets.** Logic lives in `stats_lineage.py`; run `tests.test_codebase_structure_budgets`; re-sync `scripts/extraction_lint/owner_budgets.json` only for registered files that grow (`useStatsData.js`, `StatsPanel.jsx` are registered).
- **Runner commands.** `RUN` = `PATH=/opt/homebrew/opt/node@20/bin:$PATH .venv/bin/python tests/run_isolated_runtime_tests.py --node "$(command -v node)"`; red commands `--include` the new test files, green commands add new sources. Node: `node --test tests/<file>.js` on Node 20. Chromium: `npm run build && npm run test:frontend:ui -- stats_lineage.spec.js`.
- **Fixtures.** Synthetic keys only (`LEG-*`, `DLV-*`), synthetic names and dates.

## Performance and fan-out gates

- **Initial load:** unchanged (Statistics reads are on demand).
- **Links:** zero extra Jira calls; `issuelinks` rides on existing searches and the parent-summary fetch, only when `LineageRoles` is non-None. Raw link arrays are reduced server-side and never returned.
- **Counterpart reads (Lead Times only), derived:** `key_batches` (`epic_cohort_closed.py:141`) delegates to `eng_board.split_epic_batches`, which caps a batch at `MAX_BATCH_SIZE = 40` keys and at `MAX_ENCODED_REQUEST_BYTES = 7000` worst-case encoded bytes, where `paged_search_bytes` budgets the continuation token at 1.5× the JQL length plus 256 bytes (`eng_board.py:28-35`, `:353`). A batch of ≤ 40 keys returns ≤ 40 issues, one page at `maxResults=100`. Caps: `LINEAGE_MAX_COUNTERPARTS = 200` keys per request over at most two hops, and `LINEAGE_MAX_PAGES = 6` pages (5 full batches plus one bisection retry, below), all drawn through the request's own `_make_cohort_pager` and therefore also inside its 80-page `MAX_TOTAL_PAGES`. A batch that would exceed either budget is not sent; its keys make their groups `incomplete`.
- **Failure handling:** `key_batches` raising `EpicCohortScopeError` inside the lineage path is caught (lineage `incomplete`; the route never returns 400 for lineage). A `400` on a counterpart batch (an unreadable or deleted key; behaviour confirmed in Task 0) is retried once as two halves within the page budget; still-failing keys are `incomplete`. Results are matched to links by issue **id**, so a moved issue (new key) still matches; a linked id missing from the results is `incomplete`.
- **Changelog fallback:** counterpart normalisation gets `enrich_limit = max(0, EPIC_COHORT_ENRICH_MAX_ISSUES − changelog reads already made by the request)`; `_normalize_cohort_issues` gains that optional keyword (default unchanged) and reports its read count.
- **Stats source:** zero extra calls; no counterpart reads.
- **Measured gates:** Task 2/4 tests prove call and page counts and that items without lineage are byte-identical; each lineage adds at most 160 bytes. Task 5 (operator, live) compares wall-clock times with the switch on and off.

## Endpoint contract matrix (responses only)

| Route | Method, policy | Request | Added to the 200 response | Errors |
|---|---|---|---|---|
| `/api/stats/epic-cohort` | POST, existing policy | unchanged | per member of a valid group, `lineage` (shape below); `meta.lineage` | unchanged; lineage failures only set `incomplete` |
| `/api/stats/excluded-capacity-source` | POST, existing policy | unchanged | per member, `fields.lineage` (leaf) and `fields.epicLineage` (parent); `meta.lineage` | unchanged |
| `/api/stats`, `/api/stats/burnout`, `/api/stats/project-track-phase-durations` | unchanged | unchanged | none | unchanged |

No policy row changes (`tests/test_endpoint_security_matrix.py` asserts unchanged).

**Shared lineage shape (both routes):** `{id, headKey, headStatus, memberKeys, sourceKeys}`, where `id` is the sorted comma-joined `memberKeys`, `headStatus` the normalised status (`normalize_epic_status`) of the head from its own row or the link stub, `memberKeys` all keys including the head. The cohort route adds `{startDate, startQuarter, startMonth, endDate, status, leadTimeDays, terminalDateSource, members: [{key, projectKey, createdDate, terminalDate, status, capacityType?, inFetchedSet}]}`.

**Absence rules:** `lineage`, `fields.lineage` and `fields.epicLineage` are omitted unless the item is a member of a valid group at that level. Ambiguous, incomplete and overlap-skipped items carry no lineage key; they are counted only in `meta.lineage`.

**`meta.lineage`:** `{computed: bool, leafComputed: bool, valid: int, ambiguous: int, incomplete: int, overlapSkipped: int, counterpartPages: int}` (`leafComputed` and `counterpartPages` only where they apply). No strings are added to `meta.warnings`.

**Collapsed client row (Lead Times):** `{key: headKey, summary, team, assignee, jiraStatus (head), projectKey (head), memberProjectKeys, createdDate: startDate, createdQuarter: startQuarter, createdMonth: startMonth, terminalDate: endDate, status, leadTimeDays, terminalDateSource, capacityType: 'ad_hoc' if any member is tagged, lineage}`. Grid, lists, summary and Last N read only these existing field names.

## State and ownership

- **Ownership:** no stored state; nothing added to `backend/security/CONFIGURATION_OWNERSHIP.md`.
- **Caches:** cohort process cache and `stats_cache.json` are off in DB/OAuth mode; the stats-source key already hashes the field list; the parent-summary fetch gains a `refresh` argument threaded from `fetch_excluded_capacity_stats_source(refresh=...)`, and its cache key gains the segment `lineage:<legacy digest>:<delivery digest>` (from `effective_digest`), so a role edit in either configuration misses the cache. Client caches are per page session.
- **Freshness:** a copy made in Catch Up appears after the stats-source TTL (300 s) for leaves and the parent-summary TTL (3,600 s) for parent grouping, or immediately on the existing forced refresh (`refresh: true`), which now also bypasses the parent-summary cache.
- **Concurrency:** read-only, per user, no shared mutable state.
- **User-visible states:** loading, loaded with lineages, loaded with notes, existing 401 lock, existing scope-switch refetch. No dirty state, save or conflict exists here.

## Analytics impact review

No new `userevent`. One No-Event Allowlist row in `docs/README_ANALYTICS.md`, following the Statistics rows (for example the "Statistics reads held during share-link application" row): "Statistics lineage collapse": trigger none; `event_type=none`; `event_name=none`; `feature_name=stats`; typed params none; no keys, link data or counts are sent; existing `api_result` for `stats_source` is unchanged; no GA4 runbook change. A future toggle (Q3) would need its own `stats_action` contract first.

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `backend/services/stats_lineage.py` | Pure: `LineageRoles.from_entries`, link filtering, grouping, D-L2/D-L3, compact shapes |
| Create | `tests/test_stats_lineage.py` | Units and the source guard |
| Create | `tests/test_stats_lineage_api.py` | Route tests for both stats routes |
| Modify | `backend/routes/work_request.py` (`admit_quarter_range`, and `_resolve`/`admit` only as needed to expose the admitted entries) | Return the admitted `entries` without a second snapshot read |
| Modify | `jira_server.py` (`admit_last_n_request`, `admit_sprint_id_groups`, `fetch_epic_cohort_data`, `fetch_closed_epic_cohort_data`, `_normalize_cohort_issues`, `_cohort_range_fetch`, `get_epic_cohort_stats`, `_build_excluded_capacity_stats_source_fields`, `build_excluded_capacity_issue_payload`, `fetch_cached_excluded_capacity_epic_summaries`, `excluded_capacity_epic_summary_cache_key`, `fetch_excluded_capacity_stats_source`, `get_excluded_capacity_stats_source`) | Conditional `issuelinks`, lineage annotation, counterpart reads, refresh and cache segment, temporary switch |
| Create | `frontend/src/stats/statsLineage.js` | `collapseCohortLineages`, `cohortProjectOptionsWithMembers`, `parentGroupKey`, `dedupeLineagesInBucket`, `rangeOnceLineageItems` |
| Create | `tests/test_stats_lineage.js` | Node tests |
| Modify | `frontend/src/stats/useStatsData.js` | Project options from all members; collapse before `filterCohortIssues` |
| Modify | `frontend/src/cohort/cohortUtils.js` | `filterCohortIssues`: project match on any member, exclusion on any member key |
| Modify | `frontend/src/cohort/OpenEpicsChart.jsx`, `frontend/src/cohort/LeadTimesEpicCharts.jsx` | `legacyParentWord` prop and the `· from …` text |
| Modify | `frontend/src/stats/StatsPanel.jsx` | Note line; pass `legacyParentWord` |
| Modify | `frontend/src/stats/excludedCapacityStats.js` | Parent grouping, U1, U2 for Effort Split |
| Modify | `frontend/src/stats/projectTrackStats.js` | Parent grouping, U2 with head status, filter order |
| Modify | `tests/test_epic_cohort_api.py`, `tests/test_excluded_capacity_stats_api.py`, `tests/test_excluded_capacity_stats.js`, `tests/test_project_track_stats.js`, `tests/test_work_structure_stats.js`, `tests/test_use_stats_data.js`, `tests/test_stats_panel.js` | Regression cases |
| Modify | `tests/test_work_entity_literal_guard.js` | Keep green; add `statsLineage.js` to `FILES` only if it renders words (it must not) |
| Create | `tests/ui/stats_lineage.spec.js` | Chromium |
| Modify | `docs/features/statistics.md`, `docs/ontology.md` (new "Statistics lineage" entry; never line 3), `docs/README_ANALYTICS.md` | Docs and allowlist |
| Modify | `scripts/extraction_lint/owner_budgets.json` | Only if needed |
| Modify | `docs/plans/EXEC-stats-lineage-migration.md`, `docs/plans/README.md` | Status lines; later rename to `DONE-` |

All Modify paths exist at `5f5dede0` and on `origin/main`; the six Create paths do not.

## Tasks

### Task 0: Live shape probe (operator gate, read-only)

The repository cannot prove the link-stub shape. Handling follows the live-data learnings: read-only, transient, numbers and booleans only, nothing saved, no screenshots; the operator signs in and runs it; the chosen Legacy Epic key is typed into a prompt, stays in browser memory, and is never written to a file, log, chat or this plan.

- [ ] **Step 1:** The operator opens a signed-in Jira tab of the workspace's site (their own session; no app credentials, no token handling by the agent), picks a Legacy Epic known to have a DELIVERY copy, and pastes this snippet into that tab's developer console:

  ```js
  (async () => {
    const key = prompt('Legacy Epic key (kept in memory only)');
    const q = async (jql, fields) => {
      const r = await fetch(`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=5`, { headers: { Accept: 'application/json' } });
      return { status: r.status, body: r.status === 200 ? await r.json() : null };
    };
    const a = await q(`key = "${key}"`, 'issuelinks');
    const links = a.body?.issues?.[0]?.fields?.issuelinks || [];
    const ends = links.map((l) => l.inwardIssue || l.outwardIssue).filter(Boolean);
    console.log({
      status: a.status, links: links.length,
      relatesNamed: links.filter((l) => /^relates$/i.test(l.type?.name || '')).length,
      endHasId: ends.every((e) => !!e.id), endHasTypeId: ends.every((e) => !!e.fields?.issuetype?.id),
      endHasHierarchyLevel: ends.every((e) => typeof e.fields?.issuetype?.hierarchyLevel === 'number'),
      endHasSubtaskFlag: ends.every((e) => typeof e.fields?.issuetype?.subtask === 'boolean'),
      endHasStatusCategory: ends.every((e) => !!e.fields?.status?.statusCategory),
    });
    const project = key.split('-')[0];
    const b = await q(`key in ("${key}", "${project}-999999999")`, 'summary');
    console.log({ unreadableKeyStatus: b.status, returned: b.body?.issues?.length ?? 0 });
  })();
  ```

- [ ] **Step 2:** Record only the printed booleans and counts (no key) in this task's status line. If `relatesNamed` is 0, or `endHasId`/`endHasTypeId`/`endHasStatusCategory` is false, stop and revise D-L1 before Task 1. `endHasHierarchyLevel`/`endHasSubtaskFlag` false turns leaf lineage off for an unrestricted Legacy planning configuration (D-L1). `unreadableKeyStatus` decides whether the bisection retry is needed (400) or whether missing keys are simply absent (200).

### Task 1: Pure lineage module and source guard

**Precondition:** branch from freshly fetched `origin/main` and verify zero inherited commits (see [Preconditions](#preconditions-and-dependencies)).

**Files:** Create `backend/services/stats_lineage.py`, `tests/test_stats_lineage.py`.

**Interfaces (Produces):** `LineageRoles.from_entries(entries) -> LineageRoles | None` (Legacy-only and DELIVERY-only project sets, overlap set, role matchers built with `WorkRoles` over `ws.resolve_work_configuration` at the entries' own inner bounds); `lineage_links(issue, *, level, side, roles) -> [LinkEnd(id, key, status)]`; `group_lineages(read_issues, *, level, roles) -> {valid, ambiguous, incomplete, overlap_skipped}`; `lineage_summary(group, rows, *, today)` (D-L2/D-L3, including `startQuarter`/`startMonth` via the existing `assign_to_period`, passed in as a callable); `compact_lineage(group)` (shared shape).

- [ ] **Step 1: Write the failing tests.**
  - Links: `test_relates_cross_configuration_same_level_is_lineage`; `test_other_types_same_project_or_other_level_ignored`; `test_overlapping_project_link_skipped_and_counted`; `test_parent_matched_by_name_in_compatibility_mode_and_by_id_otherwise`; `test_planning_names_mapped_id_and_unrestricted_with_and_without_hierarchy_level`.
  - Groups: `test_consolidation_two_sources_one_head_valid`; `test_source_with_two_heads_ambiguous_unmerged` (also via a hop-2 source); `test_unread_member_incomplete`; `test_stray_relates_at_matching_levels_forms_a_lineage_with_visible_member_keys` (documents R1: a stray link merges, and `sourceKeys` carries the key the UI shows).
  - Lead time: `test_start_is_earliest_created`; `test_open_head_open_from_start`; `test_head_done_end_is_later_of_head_and_legacy_done`; `test_head_killed_legacy_done_is_done_at_legacy_date`; `test_legacy_closed_incomplete_never_ends_lineage`; `test_postponed_head_terminal_for_created_mode`; `test_start_quarter_and_month_from_start_date`.
  - `test_no_entries_returns_none`.
  - Guard: `test_lineage_sources_never_match_task_r_leftover_pattern`: assemble Task R's pattern from parts (for example `'delivery' + '[_-]?' + 'migration'`, `'jep' + 'Delivery' + 'Migration'`, and the other five tokens likewise), compile it case-insensitively and scan `backend/services/stats_lineage.py`, `frontend/src/stats/statsLineage.js`, `tests/test_stats_lineage.py`, `tests/test_stats_lineage_api.py`, `tests/test_stats_lineage.js`, `tests/ui/stats_lineage.spec.js`, `docs/features/statistics.md`, the "Statistics lineage" entry of `docs/ontology.md` (that file's existing Hover-reveal entry is Task R's to reword), and the source segments of the touched `jira_server.py` functions extracted with `ast` (`ast.get_source_segment`); files not yet created are skipped. `test_lineage_code_imports_no_migration_module`: an `ast` walk of `stats_lineage.py` and of each touched `jira_server.py` function finds no import or name containing the assembled `delivery` + `_migration` token; a regex check of `statsLineage.js` finds no import from `deliveryMigration`. `test_lineage_code_uses_no_basic_or_service_credentials`: the same scope contains none of `build_jira_headers`, `HTTPBasicAuth`, `service_integration`, `oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock` (mirroring the forbidden list in `tests/test_delivery_migration_source_guards.py` when that file exists).
- [ ] **Step 2: Run (red)** `RUN --include tests/test_stats_lineage.py tests.test_stats_lineage`. Expect ImportError.
- [ ] **Step 3: Implement** the pure module (no Jira I/O, no Flask).
- [ ] **Step 4: Run (green)** `RUN --include tests/test_stats_lineage.py --include backend/services/stats_lineage.py tests.test_stats_lineage tests.test_codebase_structure_budgets`.
- [ ] **Step 5: Commit** `Add the stats lineage model`.

### Task 2: Lead Times backend annotation and counterpart reads

**Files:** Modify `backend/routes/work_request.py`, `jira_server.py`, `tests/test_epic_cohort_api.py`; Create `tests/test_stats_lineage_api.py`.

- [ ] **Step 0:** Read `_resolve`/`admit` in `backend/routes/work_request.py` and record how each admission helper will expose its `entries`. From the stored entries, record whether the Legacy and DELIVERY project sets are disjoint and whether `scope.boardId` is equal (D-L9); report any overlap to the operator.
- [ ] **Step 1: Write the failing tests** (fake Jira responder; synthetic keys):
  - `test_created_mode_annotates_lineage_and_reads_out_of_range_head` (one counterpart page; `leadTimeDays` = head close − Legacy created; `startQuarter` is the Legacy quarter)
  - `test_closed_mode_reaches_legacy_source_of_delivery_head`; `test_last_n_annotates_without_changing_window_membership`; `test_mixed_era_segments_merged_before_lineage`
  - `test_counterpart_pages_capped_at_six_through_request_pager` (and counted inside the 80-page ceiling); `test_counterpart_scope_error_marks_incomplete_not_400`; `test_counterpart_batch_400_bisected_once_then_incomplete`; `test_linked_id_missing_from_results_incomplete`; `test_moved_counterpart_matched_by_id`; `test_counterpart_changelog_reads_share_remaining_enrich_budget`
  - `test_counterpart_never_admitted_as_row_and_scope_not_widened`
  - `test_unpromoted_no_issuelinks_requested_and_response_byte_identical`; `test_no_link_response_unchanged_except_meta`; `test_request_body_and_created_cache_key_unchanged`; `test_lineage_roles_from_admitted_entries_single_snapshot_read` (patch `work_structure_routes.workspace_snapshot` with a counter)
  - `test_lineage_reads_without_request_context_reach_real_auth_wrapper`: call the annotation entry point outside any Flask request context with an explicit DB/OAuth auth context, patching only the HTTP layer (`jira_server.HTTP_SESSION`), so `current_jira_get` → `jira_get` runs for real (project learning on worker-thread fixes)
  - `test_oauth_context_only`: patch `jira_server.build_jira_headers`, `jira_server.oauth_session_data` and `jira_server.save_oauth_session` to raise `AssertionError`; both cohort modes still answer 200 with lineage
  - `test_switch_off_requests_no_issuelinks` (temporary, removed in Task 5)
- [ ] **Step 2: Run (red)** `RUN --include tests/test_stats_lineage_api.py tests.test_stats_lineage_api tests.test_epic_cohort_api`.
- [ ] **Step 3: Implement.** Expose admitted entries; build `LineageRoles` once; add `issuelinks` only when it is non-None and the switch is on; annotate after `_cohort_range_fetch` merges segments; read counterparts with `key_batches` through the request's pager with `context=auth_context`; strip raw `issuelinks`.
- [ ] **Step 4: Run (green)** `RUN --include tests/test_stats_lineage_api.py --include tests/test_stats_lineage.py --include backend/services/stats_lineage.py tests.test_stats_lineage tests.test_stats_lineage_api tests.test_epic_cohort_api tests.test_epic_cohort_closed tests.test_work_structure_stats tests.test_oauth_stats_routes tests.test_endpoint_security_matrix tests.test_work_structure_consumer_inventory tests.test_codebase_structure_budgets`.
- [ ] **Step 5: Commit** `Annotate Lead Times rows with their Legacy lineage`.

### Task 3: Lead Times client collapse and text

**Files:** Create `frontend/src/stats/statsLineage.js`, `tests/test_stats_lineage.js`; Modify `frontend/src/stats/useStatsData.js`, `frontend/src/cohort/cohortUtils.js`, `frontend/src/cohort/OpenEpicsChart.jsx`, `frontend/src/cohort/LeadTimesEpicCharts.jsx`, `frontend/src/stats/StatsPanel.jsx`, `tests/test_use_stats_data.js`, `tests/test_work_structure_stats.js`, `tests/test_stats_panel.js`.

- [ ] **Step 1: Write the failing Node tests:**
  - `collapse keeps one row per valid lineage with the collapsed-row shape`
  - `created mode places by start; a range holding only the copy drops it`
  - `closed mode and Last N rank by lineage end; a Legacy Epic closed after copying is not closed`
  - `ambiguous and incomplete rows stay standalone (same object identity)`
  - `project options include Legacy member projects; project filter matches any member`
  - `Exclude Excluded Capacity hides a lineage when any member key is listed; Exclude Ad Hoc when any member is ad hoc`
  - `the note counts valid, ambiguous and incomplete from meta.lineage`
  - `the from-text uses the Legacy parent word in DELIVERY scope`
  - `changing a filter after collapse sends no request`
- [ ] **Step 2: Run (red)** `node --test tests/test_stats_lineage.js tests/test_use_stats_data.js tests/test_work_structure_stats.js tests/test_stats_panel.js`.
- [ ] **Step 3: Implement** as in D-L4 and D-L7.
- [ ] **Step 4: Run (green)** the same plus `node --test tests/test_work_entity_literal_guard.js tests/test_analytics_source_guards.js tests/test_stats_module_extraction_source_guards.js tests/test_cohort_grid_source_guards.js`, then `RUN tests.test_codebase_structure_budgets`.
- [ ] **Step 5: Commit** `Show Lead Times per lineage`.

### Task 4: Stats-source backend annotation

**Files:** Modify `jira_server.py`, `tests/test_excluded_capacity_stats_api.py`, `tests/test_stats_lineage_api.py`.

- [ ] **Step 1: Write the failing tests:** `test_stats_source_leaf_lineage_both_sides_with_head_status_from_stub`; `test_parent_lineage_from_summary_fetch`; `test_summary_cache_segment_carries_both_digests_and_refresh_bypasses_it`; `test_stats_source_no_extra_jira_calls`; `test_stats_source_unpromoted_no_issuelinks_byte_identical`; `test_raw_issuelinks_not_returned`; `test_shared_lineage_shape_matches_cohort_shape`.
- [ ] **Step 2: Run (red)** `RUN --include tests/test_stats_lineage_api.py tests.test_stats_lineage_api tests.test_excluded_capacity_stats_api`.
- [ ] **Step 3: Implement:** conditional `issuelinks` in `_build_excluded_capacity_stats_source_fields` and the summary fetch; `refresh` threaded into `fetch_cached_excluded_capacity_epic_summaries`; the digest segment in `excluded_capacity_epic_summary_cache_key`; `fields.lineage`/`fields.epicLineage` from `build_excluded_capacity_issue_payload`.
- [ ] **Step 4: Run (green)** `RUN --include tests/test_stats_lineage_api.py --include tests/test_stats_lineage.py tests.test_stats_lineage_api tests.test_excluded_capacity_stats_api tests.test_group_excluded_capacity_epics_api tests.test_work_structure_stats tests.test_codebase_structure_budgets`.
- [ ] **Step 5: Commit** `Annotate stats-source items with their lineage`.

### Task 5: Live latency gate and switch removal (operator)

- [ ] **Step 1:** On the operator's local instance (signed in by the operator), for one Lead Times range and one Excluded Capacity range, record the wall-clock duration of `/api/stats/epic-cohort` and `/api/stats/excluded-capacity-source` from the browser's network panel with a forced refresh, three runs with `STATS_LINEAGE_LINKS=true` and three with `false` (server restart between). Record durations only; no screenshot, no payload.
- [ ] **Step 2:** If either median grows by more than 15 %, stop and report to the operator.
- [ ] **Step 3:** Otherwise remove `STATS_LINEAGE_LINKS` and its test; run `RUN tests.test_stats_lineage_api tests.test_epic_cohort_api tests.test_excluded_capacity_stats_api`.
- [ ] **Step 4: Commit** `Remove the temporary stats lineage switch`.

### Task 6: Stats-source double counting and grouping

**Files:** Modify `frontend/src/stats/excludedCapacityStats.js`, `frontend/src/stats/projectTrackStats.js`, `frontend/src/stats/statsLineage.js`, `tests/test_excluded_capacity_stats.js`, `tests/test_project_track_stats.js`, `tests/test_stats_lineage.js`.

- [ ] **Step 1: Write the failing tests** (a Legacy Story in the Legacy Sprint and its copy in the DELIVERY `fromQuarter` Sprint, 5 SP each, plus a rolled-over control Story):
  - Effort Split counts the pair once (5 SP, the Legacy member's Team), equal to the control.
  - **Legacy Killed + copy open:** Team mode counts it (placed in the Legacy Sprint, open head status, strip in the head's status column); Epic mode with the Legacy Epic closed Incomplete and its Initiative open counts the group under the Initiative key with the Initiative's track; Effort Split counts it once.
  - **Copy Killed + Legacy open:** Team mode drops it (head status Killed).
  - Excluded Capacity trend and Mono vs Cross count each member in its own Sprint, equal to the control.
  - Same-Sprint case: a pair placed in one Sprint lands in one `parentGroupKey::sprint` bucket (real keys `LEG-1` under `LEG-10`, `DLV-1` under `DLV-10`, with `DLV-10` the copy of `LEG-10`) and counts once.
  - Team Cross Share values unchanged for the pair in different Sprints.
  - Items without lineage: every builder's output is deep-equal to today's.
- [ ] **Step 2: Run (red)** `node --test tests/test_stats_lineage.js tests/test_excluded_capacity_stats.js tests/test_project_track_stats.js`.
- [ ] **Step 3: Implement** D-L5; dedupe first, then the existing filters on lineage values; keep chart shapes and option contracts (Team Cross Share stays a per-Sprint per-Team graph).
- [ ] **Step 4: Run (green)** the same plus `node --test tests/test_stats_utils.js tests/test_stats_no_allocation_views.js tests/test_excluded_capacity_stats_source_guards.js tests/test_eng_project_track.js`.
- [ ] **Step 5: Commit** `Count copied work once in range Statistics`.

### Task 7: Chromium check and operator wording gate

**Files:** Create `tests/ui/stats_lineage.spec.js` (follow the Statistics fixture pattern in `tests/ui/work_structure_stats_epm.spec.js`).

- [ ] **Step 1:** Cases: one Completed row for a pair with `from LEG-…` in the meta line and the lineage lead time; the three note lines (lineages, ambiguous, incomplete) each appear only with a non-zero count, and a stray-link fixture shows its `from <key>` text; Effort Split and Project Track totals equal the single-count value; the Lead Times controls row keeps its row count and height at 1280 px (geometry on text-bearing elements, MRT020); no new control in the filter bar.
- [ ] **Step 2: Run** `npm run build && npm run test:frontend:ui -- stats_lineage.spec.js`.
- [ ] **Step 3:** Before/after Lead Times screenshots from synthetic data (transitions settled); describe the change; operator signs off the note and `from` wording.
- [ ] **Step 4: Commit** `Cover Statistics lineage in Chromium`.

### Task 8: Docs, analytics and final verification

**Files:** Modify `docs/features/statistics.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `scripts/extraction_lint/owner_budgets.json` (if needed), this plan, `docs/plans/README.md`.

- [ ] **Step 1:** Update the Lead Time Definition (D-L2 to D-L4) and add a "Copied work" subsection with D-L5's table; add the ontology entry (date only its `Verified on`); add the analytics row (`feature_name=stats`).
- [ ] **Step 2:** Record the measured gates in this plan.
- [ ] **Step 3:** `RUN tests.test_agents_md_learnings tests.test_codebase_structure_budgets tests.test_stats_lineage`.
- [ ] **Step 4:** `make verify`; record stage verdicts and elapsed time (Scenario-only exclusions recorded with the reason).
- [ ] **Step 5:** Rename to `DONE-stats-lineage-migration.md` in the publishing commit, update the index line and links, then follow the AGENTS.md section 10 publication transaction after operator confirmation.

## Test strategy summary

- **Pure units:** link filtering, overlap skip, grouping, ambiguity, every D-L3 branch, U1/U2 and filter order.
- **Backend routes:** page and call budgets, scope-error and 400 isolation, id matching, byte-identical unpromoted and no-link responses, single snapshot read, no-request-context auth path, OAuth-only negative patches, cache segment and refresh.
- **Client derived layers:** unchanged outputs without lineage; corrected outputs with lineage; no refetch on filter change.
- **Chromium:** visible collapse, all three note lines, totals, unchanged control geometry.
- **Source guards:** Task R pattern (assembled from parts), imports, credentials.

## Review focus

1. Ambiguity never merges (`test_source_with_two_heads_ambiguous_unmerged`).
2. A Legacy closure never ends or hides live work (`test_legacy_closed_incomplete_never_ends_lineage`; Task 6 Legacy-Killed cases).
3. Partial reads never fabricate history and never fail the route (Task 2 failure tests).
4. Exclusions keep hiding what they hid (Task 3 any-member exclusion test).
5. Unchanged behaviour without lineage and for unpromoted workspaces.
6. Survives Task R (assembled-pattern guard).

## Risks

- **R1 Stray Relates links** at matching levels merge unrelated items. Mitigation: cross-configuration, same-level and overlap rules; ambiguity detection; the visible `from <key>` text (tested) lets users fix the link in Jira.
- **R2 Per-user visibility** gives different users different lineages. Accepted; caches are per user.
- **R3 Latency of `issuelinks`** on large ranges. Task 5 gate with a stop condition.
- **R4 Created-mode placement** moves copies to their earliest creation quarter (D-L4); the note line explains it.
- **R5 Calendar lead time** includes any idle gap between Legacy work and the copy (R1). Stated in the docs.
- **R6 Parent grouping staleness** up to the 3,600 s summary TTL without a forced refresh.

## Phases

1. **Phase 1 (smallest valuable slice):** Tasks 0–3 and the Lead Times half of Task 5.
2. **Phase 2:** Tasks 4–6.
3. **Phase 3:** Tasks 7–8. Phase 1 may publish alone if the operator declares the PR partial; its Lead Times doc changes then move into that publication.

## Operator decisions

Each has a recommended default that the plan assumes if unanswered.

| # | Decision | Recommended default |
|---|---|---|
| Q1 | Lead-time rule for a lineage | R1: earliest member `created` → the head's terminal date (D-L3) |
| Q2 | Copy Killed/Incomplete/Postponed but a Legacy source Done | Done, ending at the latest Legacy Done date |
| Q3 | Lead Times toggle to show members separately | No control in Phase 1; the note line explains |
| Q4 | Excluded Capacity / Ad Hoc membership across a lineage | Lead Times rows: excluded when any member is listed (conservative); per-leaf views: the leaf's own parent key |
| Q5 | Created mode places a lineage in its earliest creation quarter | Yes |
| Q7 | Stitch Project Track time-in-phase across the pair | Deferred to a future plan |
| Q9 | Range-once views: which member | Placement (Sprint, Team, SP) from the earliest in-range member; status and closed-parent gate from the lineage head |
| Q10 | Project filter on a lineage | Matches any member's project; options include Legacy member projects; the head's project is displayed |

Resolved without the operator: marker evidence (former Q6, D-L8: links only, per migration design D2) and single-Sprint views (former Q8, D-L9: decided by the stored project-overlap check in Task 2 Step 0).

## Coverage and unknowns

Verified in this tree: the stats handlers and helpers cited above, the cohort normalisation and enrichment cap, mixed-era segmenting, admission helpers and `active_entries`, bundle validation (inner bounds required and contiguous; projects not required disjoint), the cache gating and keys, the batch sizing constants, the client builders' rollover behaviour and filter order, the Lead Times row markup, the absence of an entity-name prop in `OpenEpicsChart`, the configuration role APIs, and that no bulkfetch helper exists outside the migration modules.

Not verified (no live Jira access): the link-stub shape and the Relates type name (Task 0); how enhanced search answers an unreadable key inside `key in (...)` (Task 0); the configured inner bounds (the Created-mode observation assumes 2026Q4/2027Q1); whether teams close migrated Legacy items and how; project overlap and Board inheritance in stored configuration (Task 2 Step 0); latency (Task 5); counterpart changelog shapes (the existing fallback is reused). The migration branch is unmerged; its content is taken from its documents, and no task depends on its code.
