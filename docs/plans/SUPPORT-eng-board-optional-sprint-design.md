# ENG Board Optional Sprint And Component Scope Design

> **Accuracy correction (2026-09-09):** The [All work implementation plan](EXEC-eng-board-all-work.md) is authoritative. Board has no independent sprint state and no local selector, button, or toggle. It reuses the existing top Sprint selector and Catch Up snapshot for an ordinary selected sprint. While Board is active, that selector presents **All work**, **Component**, and ordinary sprints. All work and Component are transient cross-sprint Board modes and invoke the strict Board endpoint without changing the saved sprint. Component contains only exact Component-matched Epics. All work unions those Epics with Team-derived parent Epics; Component matching applies only to the Epic, and the Team-parent source remains additive in All work when Components exist. Any historical text below describing a Board-local scope control, only All work plus sprints, a strict selected-sprint pipeline, Team discovery as a Component-absent fallback, or Catch Up as an incomplete/capped selected-sprint source is superseded and non-executable.


> **Status:** Reviewed support design updated on 2026-09-07. Diagnostic Tasks 0–5 are implemented
> and verified; Task 6 authenticated preflight is blocked by the saved workspace scope. A separate
> Basic-mode existing-endpoint collector run now provides capped contextual aggregates only; no
> schema-v2 campaign sample has run. This is not a production
> implementation plan. Execute
> [`EXEC-eng-board-optional-sprint-measurement-spike.md`](EXEC-eng-board-optional-sprint-measurement-spike.md)
> first for non-authorizing characterization. Its cooperative deadline mode cannot PASS. Close the
> hard-bound and excluded-scope gates before creating the production `EXEC-*` plan that fixes the
> transport, refresh, completion-budget, and safety-ceiling choices.

| Field | Value |
| --- | --- |
| Issue | [#137 — make sprint on the Board view optional](https://github.com/Juce-me/jira-execution-planner/issues/137) |
| Surface | ENG → Board; Settings → Departments → Boards |
| Configuration owner | Shared workspace Department group configuration |
| Personal state owner | Existing shared selected sprint; transient Board-only All work or Component presentation mode, not independently persisted |
| Jira writes | No new write capability; existing Board status, priority, and Project Track writes remain |

## Goal

Let ENG Board users keep the selected Catch Up sprint or choose **All work** or **Component** from the
existing top Sprint selector. Component includes exact Component-matched Epics across sprints. All
work unions that set with parent Epics of work assigned to saved Department Teams. Catch Up, Planning,
Scenario, Statistics, and EPM retain their mandatory sprint contract. The Board must never present
partial All work data as complete.

## Non-goals

- Making sprint optional outside ENG Board.
- Adding a Board-specific Component field or picker.
- Adding Subtask expansion to Board. Board keeps its current direct child rows and excludes Jira
  Epic and Subtask issue types from eager child hydration.
- Redesigning Board cards, panels, filters, Story/work-item rows, drag/drop, or field controls.
- Adding automatic Settings navigation, focus, pulse, or highlight behavior.
- Using Home/Townsquare, service credentials, or a new Jira mutation route.
- Replacing configured ENG issue types with a hard-coded `Story` type.
- Accepting a partial result after a Jira page, batch, permission, configuration, or safety failure.
- Choosing a production transport or final safety ceiling before the measurement spike.

## Settled product decisions

1. The existing top Sprint selector is the only Board sprint/scope control. Board normally displays
   the current Catch Up sprint snapshot and starts no strict selected-sprint request.
2. While Board is active, the shared selector prepends **All work** and **Component** ahead of the ordinary sprint list. No Board-local selector, button,
   toggle, per-Department sprint state, or persisted Board scope is introduced.
3. **All work** and **Component** include unsprinted work and work in any sprint. Choosing either does
   not clear or mutate the shared selected sprint; switching between them replaces the strict scope,
   and choosing an ordinary sprint or leaving Board restores the Catch Up snapshot.
4. Board reuses `groups[].missingInfoComponents` as the Department Component source. No parallel
   `board.components` field is added. Settings and ENG documentation must explain that this shared
   field controls Board Epic scope as well as Missing Information and Lead Times.
5. With configured Components, matching any configured Component admits the Epic. Component
   matching occurs only at the Epic boundary. Saved names intentionally broadcast to every exact-name
   Component across all server-selected projects, including same-named Components in two projects.
   Never choose the first Component id or accept browser-supplied project scope. A project-qualified
   Component storage design would require a separate approved change.
6. Selected-sprint qualification remains the existing Catch Up contract. With **All work**, no sprint
   clause is applied to direct children.
7. Included direct children follow configured ENG issue types. Resolve the authenticated Jira
   `/rest/api/3/issuetype` catalog once, retain only entries with `hierarchyLevel=0` and
   `subtask=false`, and build JQL from their ids. A non-empty configured name list selects every
   matching eligible id; an empty list selects every eligible id. Missing/malformed hierarchy data
   or a configured name with no eligible match is a scope error, never a fallback to all types. Epic
   Link takes precedence over the existing Epic-typed direct-parent fallback. Subtasks are neither
   fetched eagerly nor exposed through a new Board control.
8. Component stops at the exact Component-matched Epic set and requires configured Components. All work unions that set with parent Epics of eligible work assigned to all
   Teams saved on the Department, regardless of which team owns the parent. Team-only Departments are
   valid. If the Department has neither Components nor Teams, disable All work with an actionable
   explanation and do not issue an unbounded Jira query.
9. The existing Teams selector remains mounted in the same main and compact header positions in
   Board, but it is disabled and non-filtering. Its value is **Not used on Board** and its accessible
   explanation is: **All work uses Department Components on Epics and also includes parent Epics of
   work assigned to Department Teams.** Entering Board closes any open Team menu. Leaving Board restores
   the untouched private Team selection and normal behavior.
10. The existing on-demand Board information/help panel always includes: **Missing something? Add
    Department’s Component configuration in Settings.** It remains inside `EngBoardHelp`; no
    persistent header/banner, instruction wallpaper, or new action is added.
11. Epic-native Priority, Assignee, Delivery Owner, and Project Track metadata are returned by the
    canonical Epic index. The current Board facet labelled **Delivery track** reads the Epic
    `projectTrack` property and becomes authoritative with the index; child hydration never changes
    its counts.
12. The existing **Projects** facet is different from Project Track: Product/Tech membership is
    derived from the complete in-scope child cohort. A mixed Epic matches both options and a
    zero-child Epic matches neither when the facet is narrowed. Projects remains visibly disabled
    and cannot reconcile or apply a saved selection until its child-derived classification is
    authoritative. Pending facets stay visible with a nonnumeric loading value and an associated
    reason; their options, Select all, Clear, chips, and active-count changes are inert.
13. One configured column is structurally terminal, non-deletable, non-reorderable, and permanently
    rightmost among configured columns. It may be renamed and its color, limits, and statuses remain
    editable. An exact Jira status named `Done` is not required.
14. Unknown or newly introduced Jira statuses are never dropped or silently reassigned. The
    synthetic **Unmapped** column remains available and renders immediately before the configured
    terminal column, keeping the terminal column visually rightmost.
15. Terminal retention applies to every status currently assigned to the structural terminal
    column. It is a whole number from 1 through 90 days and defaults to 28.
16. Returning to any terminal-column status resets the retention clock. Because JQL cannot identify
    the initial status separately, the approved conservative creation fallback admits any
    currently-terminal Epic created within the retention window; such an Epic cannot have been
    terminal longer than its own age. Comments and unrelated field updates never reset retention;
    `updated` is forbidden as a proxy.
17. No result set may be silently capped. The measurement candidates are 1,000 unique Epics,
    10,000 unique included children, Jira child batches of at most 40 Epic keys and a measured URL
    byte limit, and at most two child searches concurrently within one Board generation. These are
    provisional until the spike records cost and useful Board sizes.
18. A Department, sprint, Component, project, issue-type, Board configuration, or auth-token change
    obsoletes queued work. Browser abort stops future client work; server work stops only between
    pages/batches. Any late result is rejected and never cached into a newer generation.
19. Transient child-hydration failures are column-local and preserve Epic shells and other completed
    columns. A ceiling or inability to prove complete global scope is whole-Board fatal and clears
    authoritative child-derived data.
20. The provisional cross-sprint refresh behavior is full-Board reconciliation: retain current compatible data,
    refresh the canonical Epic index, hydrate the focused column first, then the rest. The spike must
    determine whether this remains the production contract.

## Current implementation evidence and required retirements

- `frontend/src/dashboard.jsx::loadSprints` restores or auto-selects the current/last sprint. Board
  reuses this state and adds All work and Component as presentation options without setting `selectedSprint` null.
- The selected-sprint Board must reuse the completed Catch Up Product/Tech snapshot and must not
  launch another selected-sprint request. All work and Component retire that request family in favor
  of the strict Board endpoint.
- `jira_server.py::fetch_tasks` remains the established Catch Up and selected-sprint Board source.
  Its separate sprintless behavior is not an authority source for either cross-sprint Board scope.
- `frontend/src/eng/engBoardFilters.js` currently has both Epic-native facets and child-derived
  Product/Tech classification. The new data module must expose facet readiness instead of letting
  empty shell `tasks` arrays publish zero counts and reconcile selections away.
- `frontend/src/eng/engBoardColumns.js` preserves unmapped statuses in a synthetic column. Production
  work must retain that no-data-loss behavior while inserting the synthetic column before the
  structural terminal column.
- `frontend/src/eng/EngBoardView.jsx` currently treats loading/error as whole-view state and coerces
  absent children to zero. It must consume explicit index and column readiness without displaying
  `0 SP`, `0 of 0`, unresolved-child counts, or safe-to-drag conclusions as authoritative early.
- All work refresh and the existing status/priority/Project Track hooks need one Board-owned mutation
  adapter and strict refresh path; legacy task refreshes must not run behind All work. Selected-sprint
  Board retains the established local Catch Up-backed reconciliation.
- `backend/services/group_board.py` and `frontend/src/settings/groupBoardModel.js` own Board grammar
  and round-tripping. Both currently omit retention, so changing only `group_config.py` or
  `groupConfigUtils.js` would lose the new field.
- Live Boards with no saved `board` continue to render the Catch Up-derived **All epics** presentation
  for the selected sprint. No strict request runs. All work stays unavailable until a valid Board is
  saved. Settings may create an unsaved default draft after the real status catalog loads, but the
  live Board cannot consume it before unified Save succeeds.

## Ownership and immutable request snapshot

Before starting Jira work, the route captures one immutable `RequestAuthContext`, one workspace
dashboard-config snapshot with explicit source, and one shared Department/group snapshot. In request
context it resolves:

- normalized Jira project key-to-Product/Tech mapping, normalized server-owned Product and Tech
  project-name sets, and the one-project saved-board compatibility fallback. Product/Tech belongs to
  the Jira project and every issue inherits it through `fields.project`; issue type never
  participates in this classification;
- the current Jira issue-type catalog, configured direct-child names resolved to eligible standard
  type ids, and all relevant Jira field ids. Preserve existing compatibility exactly: absent
  `issueTypes` means `['Story']`, while explicit `issueTypes: []` means every eligible level-0,
  non-subtask type; absent/blank Sprint, Story Points, Team, and Project Track ids use
  `customfield_10101`, `customfield_10004`, `customfield_30101`, and `customfield_35024`
  respectively; Delivery Owner remains optional with no default. Validate every nonblank custom id
  as `customfield_<digits>` before generating `cf[digits]` JQL;
- `groups[].missingInfoComponents` and all Department Team ids;
- Board columns, status assignments, structural terminal statuses, and retention;
- group/dashboard revisions plus canonical content digests; and
- the current Jira auth/cache partition including token version and any known project-access
  snapshot.

Workers receive only that immutable snapshot, injected Jira search functions, and the captured auth
context. They must not read Flask request/session globals or request-context configuration getters.
DB/config storage failures return sanitized `503 config_storage_unavailable` and never fall back to
service credentials or another configuration owner. In DB mode, require an existing workspace row
and `source=workspace_db`; include source in signatures and revalidate it with fresh uncached reads.
A legacy JSON fallback is not workspace-DB evidence. Any later Basic/JSON compatibility path must be
named, separately measured and partitioned, never silently used to satisfy the DB gate.

### Project scope and Jira authorization

Project scope comes from the captured workspace dashboard configuration's `projects.selected` list,
normalized and deduplicated. If it is empty, the only compatibility fallback is the same saved-board
project-location lookup used by `GET /api/board-config/statuses`. If neither source yields a project,
return `409 board_project_scope_required`; never run a site-wide Component query.

Treat a legacy string project entry and an object with a missing type as Product. Otherwise normalize
each selected project type to `product|tech|other`, deduplicate identical key/type pairs, and reject
conflicting assignments for the same normalized key.
For each returned Epic or child, classification first uses the captured typed project-key mapping.
For the legacy saved-board fallback where no selected mapping exists, the request-context route
captures normalized `STATS_PRODUCT_PROJECTS` and `STATS_TECH_PROJECTS` name sets, and the pure worker
compares each returned `fields.project.key/name` with that immutable input; otherwise it classifies
the issue as `other`. Preserve the current fallback precedence when a normalized name appears in
both sets: Product wins, then Tech, then `other`. Never call `jira_server.classify_project` or another config-reading classifier
from a worker. A fallback issue never acquires Product or Tech from its issue type. `other` work
remains on the Board but matches neither Product nor Tech when the Projects facet is narrowed.

Board builds a new escaped `project in (...)` predicate. It must not rewrite `build_base_jql()` or
`JQL_QUERY`, because those may carry unrelated sprint, Team, status, type, or order clauses.

The frontend replaces the existing Boolean `isTechTask` Board seam with
`classifyBoardProject(task) -> 'product'|'tech'|'other'`. `classifyEpicProjects` unions independent
Product and Tech membership across the complete child cohort; its input is the server-shaped
`projectClassification`, and it never implements Product as `!isTechTask`. Unknown/malformed project
data is `other`, so it matches neither narrowed Projects option. This change is Board-only and does
not alter capacity or Catch Up classification.

In OAuth mode, completeness means every result visible to the signed-in Jira principal within the
configured project predicate. Jira remains the authorization boundary. The current
`RequestAuthContext.project_access` snapshot cannot prove access to every configured project and an
absent snapshot is valid for a new user, so Board does not add per-project access probes or falsely
promise detection of hidden projects. A known snapshot stays in cache compatibility. Jira auth,
permission, parser, and upstream failures fail the relevant Board transaction with sanitized copy;
raw project names, JQL, URLs, and upstream bodies never enter responses or logs.

## Scope queries

### Component-first Epic index

```text
project in (<captured selected projects>)
AND issuetype = Epic
AND component in (<groups[].missingInfoComponents>)
AND (
  status not in (<terminal statuses>)
  OR (
    status in (<terminal statuses>)
    AND (
      one "status CHANGED TO <status> AFTER -<days>d" clause per terminal status
      OR created >= -<days>d
    )
  )
)
```

All values are server-owned, escaped, and quoted. Inside the outer current-terminal predicate, the
`created` branch conservatively admits any currently-terminal Epic created within the retention
window; Jira cannot prove whether its initial status was terminal, so do not attempt a post-filter.
It is not a general activity clock. Non-terminal Epics are always admitted regardless of history. If
the structural terminal column currently has no assigned statuses, omit the entire retention
predicate and admit all Component-scoped Epics; never generate an empty `status in ()` clause.

For **All work**, child queries have no sprint clause. The membership pass and hydration share the
same fetched child rows; do not repeat the Jira child search merely to separate qualification from
rendering. Selected-sprint discovery stays in the existing Catch Up path.

For each bounded Epic-key batch, direct-child JQL uses
`(cf[<Epic Link id>] in (<batch>) OR (cf[<Epic Link id>] IS EMPTY AND parent in (<batch>)))`.
When no Epic Link field is available, use `parent in (<batch>)` alone. This makes Epic Link precedence
part of query membership, so a child whose Epic Link and parent point to different batched Epics is
returned once and assigned only to its Epic Link.

Resolve the Epic Link field from the authenticated `/rest/api/3/field` catalog and address it as an
escaped `cf[<numeric-id>]` JQL field. Do not use the display-name alias `"Epic Link"`; duplicate-named
fields must not select the wrong data. Include field-catalog calls in timing, bytes, errors, and cache
signatures.

### All work Team-parent discovery

1. Resolve every Team saved on the Department from the immutable group snapshot.
2. Discover eligible direct children assigned to those Teams across sprints and collect their parent
   Epic keys using Epic Link precedence over an Epic-typed parent.
3. Union and deduplicate those parents with exact Component-matched Epics. Fetch parent metadata in
   bounded batches, apply the parent's own status and terminal-retention rules, then hydrate eligible
   direct children once for projection.
4. Atomically reconcile into the canonical Epic map. On any failure, discard provisional authority
   and show the error.

If Components and Department Teams are both empty, return a sanitized scoped configuration error for
All work. Component requires at least one configured Component. Both cross-sprint choices remain
present at the top of the shared Sprint menu but are independently disabled with an associated
explanation when their prerequisites are absent. Sprint catalog loading or failure must not hide them.

## Strict Jira paging and batching

Every Board Epic or child search calls
`current_jira_search(payload, context=captured_auth_context)` through an injected boundary. Board
must not use `jira_client.fetch_issues_by_jql`, `jira_client.fetch_issues_by_keys`, or
`jira_server.fetch_epic_details_bulk`; those compatibility helpers intentionally return collected
partial results after some page or batch failures.

The Board-private pager accepts only a Jira `/rest/api/3/search/jql` response where:

- the body is an object;
- `issues` is an array no larger than the requested page size;
- `isLast` is a boolean;
- `isLast=false` has a non-empty, never-before-seen `nextPageToken`; and
- `isLast=true` terminates the sequence.

An empty non-final page is legal and must continue. HTTP/JSON failures, malformed rows, duplicate
normalized keys across pages, missing/repeated tokens, contradictory terminal state, or a defensive
page-bound breach fail the owning transaction. Partial rows are never returned as canonical results
or cached; validated pages may produce only the explicitly provisional display projection below.

Use a provisional page size of 100, at most 101 pages per logical search, at most 2,600 Jira search
pages per Board generation, and at most 7,000 UTF-8 bytes for the fully URL-encoded Jira search query
parameters (`jql`, fields, page size, and token). Apply the byte limit to index and catalog-driven
searches as well as child batches. Exactly the configured unique-key or byte ceiling is valid only
when the current page/request is complete; another required page or byte is over-limit. A column
becomes authoritative only after every batch and page for its current membership completes.

## Canonical Board model and readiness

The Board owns one normalized Epic map. Column arrays contain Epic-key references, never independent
copies. Index reconciliation atomically replaces membership so an Epic cannot remain in a stale
source column while also appearing in its current column.

Each Epic shell includes key, summary, status, priority, assignee, Delivery Owner, Project Track,
updated timestamp, `parent` fields needed to shape Initiative metadata, and the fields required by
search and Epic export.

For **Component**, the complete exact Component Epic index is authoritative membership. For **All
work**, membership and Epic counts become authoritative only after that Component index and additive
Team-parent discovery have both completed and their parents have been deduplicated. Child hydration
follows the authoritative set for the selected cross-sprint scope. Selected-sprint membership does
not use this pipeline; it retains the existing Catch Up snapshot and authority contract.

Each column exposes `shell|hydrating|complete|error`, `authoritative`, child and Epic counts, cache
state, scope version, and freshness. Child responses contain the current complete direct-child shape:
summary, status, priority, actual issue type, assignee, updated, Story points, Team, parent/Epic link,
Jira project, server-derived `projectClassification=product|tech|other`, and sprint. It does not
request or return `subtasks` or `subtaskSummary`. Duplicate child
keys and unknown parents are contract errors, not silently dropped rows.

Maintain a generation-owned provisional display projection separately from canonical child data
and caches. After each validated child page, update visible per-Epic **Loaded so far** Story counts
and status distribution; their denominator is loaded work, never total or complete work. Candidate
Epic cards may show this progress before selected-sprint membership qualifies. Progress does not
authorize filters, search counts, exports, writes, drag safety or cache publication. Discard it on
failure/cancellation/supersession; install canonical children atomically only after their complete
cohort passes validation. This preserves the root progressive-rendering requirement.

The UI readiness contract is:

- For All work, Epic counts/search, Priority, Assignee, Delivery track/Project Track, and Epic Jira
  export become usable after the canonical index. For selected sprint, those become usable only when
  all column membership is authoritative; the Project Track value itself always comes from the Epic.
- Child rows and authoritative Story points/progress remain pending until their cohort completes;
  provisional Story counts/status distribution follow the display contract above. Unresolved-child
  terminal-drag safety, Product/Tech Projects filters and child export stay disabled until all
  required child pages complete.
- The Stories/work-item export remains visibly disabled with a loading reason until the entire Board
  generation is authoritative; it never exports a completed subset of columns. Once authoritative,
  an empty child set displays **No work items** rather than emitting an empty/partial analytics event.
  Epic export follows the index/readiness rules above and also emits no partial keys or event.
- `JiraExportButton` gains optional `epicExportState` and `storyExportState` objects with exact
  `status=pending|ready|empty|error`, `keys` only for `ready`, and `stale=true|false`; callers that
  omit them retain the current key-array behavior through an internal `ready|empty` adapter. While
  either Board kind is pending, the
  menu trigger remains keyboard-focusable and opens an accessible menu, but that kind's action is
  `aria-disabled` and labeled **Loading Board…**. `empty` renders **No epics** or **No work items**;
  `error` renders **Unavailable — retry Board**. Compatible stale authoritative keys remain exportable
  and visibly marked stale after refresh failure; cold error has no export action. Disabled entries
  never emit export analytics, and Retry replaces state only for the current generation.
- Hydrating shells show existing Board geometry with explicit placeholders. Missing child data never
  renders as an authoritative zero.
- Board search stays visible and editable while membership is pending, and preserves its query and
  keyboard focus across hydration, refresh, and retry. The terminal auth lock preserves the mounted
  query/state but makes the application inert and moves focus to its recovery action; search does not
  regain focus before the recovery navigation loads a new document. Until All work Epic membership
  is authoritative, its predicate is neutral: do not hide shells, show a zero/empty result, or emit
  `app_search`. Selected-sprint search retains the existing Catch Up authority contract. When authority arrives,
  apply the latest query once and emit at most one search result event for that authoritative
  generation. Compatible stale membership may continue to apply search while visibly stale; an
  initial cold error preserves the query but keeps admission neutral, and Retry never clears it.
- Every pending facet uses neutral admission. A saved Projects-facet selection remains preserved but
  unapplied while classification is pending;
  it is reconciled exactly once when the complete classification installs.
- Project Track mutations patch the Epic and Delivery-track facet immediately and do not modify
  Product/Tech classification.

Focus remains single-sourced through the current Board focus resolver. `EngBoardView` reports the
computed value through an `onResolvedFocusChange` callback; `dashboard.jsx` passes that value into
the data hook. The hook never calls `resolveFocus` itself and reprioritizes only queued work.
After a refreshed index moves/adds Epics, a column is complete only if compatible child data exists
for every Epic in its new membership.

## Frontend ownership and mutation integration

`frontend/src/eng/useEngBoardData.js` is the proposed deep module. It owns scope initialization,
request generations, canonical maps, readiness, caches, focus-priority queueing, refresh/retry, and
provisional reconciliation. `dashboard.jsx` only supplies captured UI/config inputs and renders its
public result.

The hook also exposes one Board-local issue-field mutation adapter used by existing status,
priority, and Project Track hooks. It must:

- include Board Department/sprint-or-All-work/config scope in the mutation generation key;
- apply optimistic Epic or child updates to the canonical Board store;
- move an Epic when status changes its configured column;
- recompute terminal-retention eligibility after a terminal status result;
- update the Epic-native Delivery-track facet immediately after Project Track changes;
- preserve Product/Tech membership unless child data changes;
- roll back only the current failed mutation;
- reject late index/hydration responses older than a successful mutation; and
- invalidate/reconcile only affected Board caches after success.

Status/priority success in All work must not call legacy Product/Tech task loaders. The existing Jira
write routes, auth, CSRF, analytics, and recovery contracts remain unchanged; this feature adds no
new mutation permission.

### Board entry/exit retirement contract

The production task must modify `dashboard.jsx`, `eng/useEngSprintData.js` and the Board data hook
as one ownership change, with API wrappers remaining under `frontend/src/api/`. On Board entry,
synchronously advance the ENG request generation before effects run, abort Product/Tech task calls,
`fetchDependencies` and `requestIssuesLookup`, clear dependency focus/hover/loading and detach the
legacy dependency cache from Board. For the ENG branch, gate all three effect families on
`selectedView === 'eng' && !showBoard`; keep the separate EPM branches and existing sibling gates.
Checking only task loading is insufficient.

Each async handler captures its owner surface, scope/auth/config signature and generation; check all
three after fetch, after body parsing and immediately before every setter/cache write, including
finally/loading/error paths. Aborted legacy bodies resolving late cannot clear Board loading,
repopulate dependencies or poison cache. Board never reads legacy dependency lookup cache or issues
calls using stale Product/Tech keys. This feature introduces no eager Board dependency request; existing
lazy Epic description/status option controls retain their separately owned API contracts.

Keep compatible legacy task cache for sibling modes, partitioned by its original scope/auth. On Board
mutation success invalidate all legacy task/dependency/lookup entries in the originating auth partition
that may contain the changed issue; when membership is unknown, evict that partition's legacy entries
without refetching. On exit, start one new sibling generation, reuse only still-compatible data and
load its task cohort before dependent requests. Config save/auth change invalidates incompatible
Board and legacy caches together; no stale Board-to-Catch-Up reuse. Merely entering Board does not
clear another user's caches.

### Mutation versus progress: generation restart

Use one monotonically increasing generation integer per mounted Board data hook, paired with the
immutable scope signature. Every index/column/frame/cache publication carries both. Select the
**generation restart** strategy; do not invent per-issue rebasing or run old hydration behind writes.

1. Enable status/priority/Project Track writes only when the current whole Board is authoritative
   and no Board write is pending. Keep existing controls mounted with readiness reasons when disabled.
2. Before the optimistic write, increment generation synchronously, cancel all reads/queued work,
   mark authority stale, retain the last committed snapshot and apply the optimistic patch to a new
   canonical store. Serialize Board writes: no second write until outcome/reconciliation completes.
3. Suspend read scheduling while the write is pending. Any old progress/index/error/finally callback
   fails its generation check, including a callback queued before the increment.
4. On success, apply returned per-issue outcomes only to that mutation generation, invalidate Board
   and affected legacy cache partitions, advance generation again and refetch the authoritative index
   and children. Existing terminal-retention rules decide membership from fresh Jira evidence.
5. On failed write, restore only the captured snapshot if its scope/generation still matches, mark
   it stale and start a new reconciliation generation. A network/partial-write result may have reached
   Jira: do not present rollback as server truth. No write is automatically replayed.
6. If scope/config changes during the write, its result cannot render in the new scope. Invalidate
   the originating cache partition on success/uncertain outcome, but never restore that old snapshot
   or schedule old-scope reads. Authentication failure enters the existing terminal global lock.

Add deterministic reducer/hook tests in **Create** `tests/test_eng_board_data.js`: old index arrives
before/after optimistic patch; old child frame after successful write; successful status moves columns;
Project Track patch changes only Epic facet; failed/partial write rollback; queued second write is
inert; scope switch/config save/auth loss while write pending; stale finally cannot clear new loading.
Playwright `tests/ui/eng_group_board_view.spec.js` must hold and release real mocked response barriers
for Board entry with both task lanes/dependency/lookup pending and for mutation/progress interleavings.
Assert request absence, canonical values, cache invalidation and restored sibling loading, not sleeps.

## Terminal-column configuration and compatibility

The additive shared group shape is:

```json
{
  "board": {
    "columns": [],
    "doneEpicRetentionDays": 28
  }
}
```

`backend/services/group_board.py` owns normalization/default/range validation.
`frontend/src/settings/groupBoardModel.js` owns draft normalization, controls, and exact round-trip.
`group_config.py` and `groupConfigUtils.js` remain delegating/allowlisting layers.

### New or absent Board

After the real Jira status catalog loads, Settings automatically creates an unsaved draft using the
existing `deriveDefaultBoardColumns` partition. The derivation is extended so there is always at
least one structural terminal column, even when Jira has no exact `Done`, `Killed`, or `Incomplete`
status. The preferred order is To Do, In Progress, Done, omitting empty non-terminal phases but never
omitting the terminal column. Retention defaults to 28. Nothing reaches the live Board until unified
Save succeeds; until then the supported live synthetic **All epics** column remains.

### Existing Board

1. Only when raw persisted `doneEpicRetentionDays` is absent, apply legacy compatibility: if one
   column contains exact Jira status `Done`, pure normalization preserves that
   column's id/name/color/limits/status set and moves it right in both the live in-memory model and
   Settings draft without a shared write. The first successful Save materializes the order.
2. For that legacy shape without exact `Done`, preserve the current final stored column as terminal.
   With an explicit valid retention value, always preserve the final stored column as terminal,
   regardless of Done assignments. The retention key marks normalization; no new terminal-id field.
3. Read missing retention as 28 without a shared write; normalized output and every successful Save
   include the explicit value. Backend and frontend inspect raw presence before defaulting, so
   repeated normalization is idempotent and moving/removing Done after Save cannot transfer terminal
   identity or silently change the retention status set. Malformed present retention is invalid.
4. Insert new columns before terminal. Pointer and keyboard reordering clamp before it. Delete is
   disabled for terminal. Status assignments remain editable and do not transfer terminal identity.
   The structural terminal alone may have `statuses: []`; every non-terminal configured column still
   requires at least one. An empty terminal set disables retention JQL until a status is assigned.
5. Render synthetic Unmapped before terminal. Newly observed unmapped Jira statuses remain visible
   and do not mutate the saved draft automatically.
6. Preserve the existing `baseRevision` conflict contract and every unrelated group field. A `409`
   keeps the dirty draft.

This is a shared-JSON compatibility change, not a database schema migration. There is no startup or
background rewrite; the first successful user Save materializes the field.

## Loading, refresh, save, and recovery state machine

| Event/state | Required behavior |
| --- | --- |
| First Board visit | Render the existing selected-sprint Catch Up snapshot immediately. Do not issue a strict Board request or create independent Board sprint state. |
| User selects All work | Select the All work option in the existing top Sprint selector. Keep the concrete selected sprint and private Team state unchanged; start one strict All work request. |
| User selects Component | Select the Component option in the same top Sprint selector. Keep the concrete selected sprint and private Team state unchanged; start one strict Component-only cross-sprint request. |
| Enter Board with Team menu open | Close the menu; render both header Team controls visibly disabled and non-filtering. Keep each toggle keyboard-focusable with `aria-disabled="true"`, the **Not used on Board** value, and the settled `aria-describedby` explanation; click, Enter, and Space are inert and emit no request or analytics. |
| No saved Board configuration | Keep the selected-sprint Catch Up snapshot available. Show All work and Component disabled with an explanation until a valid Board is saved. |
| Compatible cache | Render it, mark refreshing, then reconcile current Jira state. |
| No compatible cache | Render Board chrome and column shell states; never show wrong-scope cards. |
| All-work union succeeds | After Component Epic discovery and additive Team-parent discovery both complete, atomically install deduplicated canonical Epic membership, Epic counts, Epic-native facets, and Epic export. |
| Component index succeeds | Atomically install the complete exact Component-owned Epic membership, Epic counts, Epic-native facets, and Epic export; do not run Team-parent discovery. |
| Focus changes while loading | Reorder only not-yet-started work so the new focus runs next. |
| Column succeeds | Install only for the current scope/index generation; mark its child cohort authoritative. |
| Column fails | Keep shells/other completed columns and show a column Retry. |
| Initial index/config/Jira failure | Keep selector, disabled/readiness filter bar, info/help access, configured column chrome, and a Board Retry; do not replace the Board with global sprint error UI. |
| Refresh index fails with compatible complete data | Keep the last complete Board visibly stale and disable only actions whose current completeness cannot be proven. |
| Global ceiling/completeness failure | Clear child-derived authority for the cross-sprint generation and ask the user to return to the selected sprint or reduce the applicable Department Components/Teams. Keep the copy concise and do not navigate to Settings automatically. |
| Manual or long-absence refresh in Board | For All work or Component, call only the strict Board refresh path with the active scope. For an ordinary sprint, use the established Catch Up refresh path. |
| Browser abort/scope change | Abort browser calls, cancel queued server work where supported, stop between pages/batches, reject and cache-suppress late results. |
| Authentication 401 | Enter the existing terminal same-tab auth lock; preserve mounted state and never replay automatically. |
| Settings draft dirty | Live Board continues using the last saved configuration. |
| Group save succeeds | Install returned group revision/digest, invalidate incompatible Board data, and reconcile the active Board even if another independently saved Settings section later fails. |
| Group validation/no-op fails | Preserve draft and live Board; do not invalidate. |
| Group save conflicts (409) | Preserve dirty draft and expose existing conflict recovery; never merge terminal identity automatically. |
| Settings reload/rollback/newer config | Replace draft as today; if saved group signature changed, obsolete old Board work and reconcile once. |

The active Board refresh tooltip must describe the active source accurately. Sprint catalog
loading/error remains local to the shared selector; a configured cached **All work** or **Component**
Board remains usable even when sprint discovery fails.

## Candidate backend transport and cross-worker gate

The design does not authorize a process-local index-token registry. `scripts/docker-entrypoint.sh`
supports `WEB_CONCURRENCY>1`, so index and column requests may land in different Gunicorn workers.
A module dictionary cannot reliably accept tokens or enforce a whole-Board 10,000-child count and
two-search concurrency bound.

The measurement review must select one production architecture:

1. one aggregate request, optionally streamed, owning index, ordered hydration, global counters, and
   at-most-two internal Jira child searches for its lifetime;
2. a durable shared manifest with atomic expiry/invalidation and an explicit privacy/storage contract
   for temporary issue keys in OAuth and Basic modes; or
3. a stateless signed sequential cursor, accepting sequential rather than two-way concurrent column
   hydration.

Streaming has a concrete prerequisite: `frontend/src/api/http.js::apiFetch` currently awaits
`response.clone().arrayBuffer()` before returning. Production must add an opt-in header-first
stream reader at that shared boundary before selecting streaming, preserving the existing default
behavior and terminal auth lock. The boundary owns reader cancellation, checks shared auth lock
and AbortSignal before each delivery, and sanitizes auth failures; hooks never bypass it with native
fetch. A held-EOF browser test must publish the first column before completion, then prove midstream
abort and a sibling API 401 suppress all later frames. This is conditional production work, not
part of the diagnostic or permission to select streaming without measurement.

The selected production transport must show visible page-progress updates before hydration
completes. Aggregate timing remains useful characterization, but a buffered-only response cannot
satisfy the root progressive-rendering contract; choosing it as the sole production transport
requires an explicitly approved change to that requirement. Prefer a single-request lifetime when
it meets these gates, but do not choose streaming or durable state before the required evidence.
Any multi-request choice must prove cross-worker acceptance, tamper rejection, atomic global counts, expiration, auth/config partitioning, and whole-scope invalidation.

## Candidate endpoint contract matrix

The production contract is one request-local cross-sprint Board stream. No selected-sprint Board endpoint is
called by the frontend.

| Intent | Method/path | Auth/ownership | Client input | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| Cross-sprint Board stream | `GET /api/eng/board` | Explicit `authenticated_read`; current `RequestAuthContext`; server-owned workspace/group/config | `departmentId`, `scope=all_work\|component`, optional validated initial focus, `refresh=0\|1`; no `sprintId` | Monotonic structural, Epic-index, child-column, and terminal frames for one immutable All work or Component generation | Sanitized scope/config/data/paging/ceiling/Jira/auth/storage errors |

Selected-sprint compatibility is not handled by these routes. An absent Department Board continues
to use the established Catch Up-derived **All epics** presentation. A malformed present Board remains
invalid for either cross-sprint choice. The client never sends `scope=all_work` or `scope=component`
when that choice is disabled.

Static GET routes require neither CSRF nor `X-Requested-With`. If a selected transport uses POST for a
body, classify the logical read as `authenticated_preview`, not `authenticated_read`, so both the
repository's unsafe-method `X-Requested-With: jira-execution-planner` and token-bound CSRF contract
apply. Every route must have exactly one policy in `backend/security/policy.py` and concrete inventory
and security-matrix tests.

All success envelopes use exact typed fields in the production plan; no raw JQL, project/Component
names, issue payload fragments outside the response schema, tokens, or upstream error bodies are
returned. Errors use the common sanitized shape:

```json
{
  "error": "board_scope_too_large",
  "message": "Keep this Board manageable: select a sprint or reduce Department Components in Settings.",
  "details": { "limitType": "children", "limit": 10000 }
}
```

That example is the All-work copy. Team-only All work replaces Department Components with
**Department Teams**; Component mode refers only to Department Components. Do not include local
values in any variant.

## Cache and invalidation requirements

The production design must specify TTL plus LRU/entry or byte bounds for scope state and hydrated
columns; no new unbounded module dictionary is allowed. The spike begins with an 8-entry, five-minute,
32 MiB diagnostic LRU for measurement only. Cache identity includes workspace, Jira
connection/user, cloud, token version, known access snapshot, Department, group and dashboard
revision/digests, selected projects, issue types/field ids, Component set, Board/status/retention
signature, Team set, and `all_work|component` scope. Selected-sprint snapshots remain in the existing Catch Up cache.

Never cache partial pages, failed batches, provisional adapters, scope errors, or stale generations.
Register one Board cache invalidator with the existing central auth invalidation path. Successful
group/config saves and existing status/priority/Project Track writes invalidate only compatible
affected entries. Validation errors, conflicts, and no-op saves do not.

## Measurement gate

The next executable artifact is
[`EXEC-eng-board-optional-sprint-measurement-spike.md`](EXEC-eng-board-optional-sprint-measurement-spike.md).
The current endpoint with Sprint omitted is invalid evidence because its 250-item cap can look fast
while incomplete.

The spike must measure strict complete discovery/hydration through production-intended scope,
pagination, shaping, and auth seams for selected sprint, **Component**, and **All work**, with
candidate-data-cache miss/hit pairs and explicitly separate metadata-cache states.
It records aggregate HTTP wall time plus service-internal index-ready, bootstrap-column-ready and
full-ready
timings; request/page/batch counts; bytes; unique counts; maximum concurrency; cache state; and memory
delta. Internal readiness timestamps are characterization only, not user-visible first-content
proof or transport authorization under the cooperative deadline mode. It must not commit raw Jira
data, JQL, identifiers, names, URLs or credentials.

Provisional gates to confirm or replace from evidence:

- aggregate candidate-data-cache-miss All-work response target of 3 seconds and no candidate
  aggregate response beyond 6 seconds;
- compatible cached aggregate response near 1 second; and
- service-internal bootstrap-column-ready and full-ready characterization; it cannot choose the
  production transport until the hard-bound and UI-readiness gates pass.

Loading feedback within 100 ms, user-visible first content, selected-sprint median first-content
regression no greater than 10%, and final focused/full completion budgets remain mandatory production
UI gates after transport is chosen. Do not raise a cap, omit rows, or relabel partial work as
complete to pass the spike.

### Authorization exclusions and core reuse gate

The current spike deliberately measures only existing workspace-DB configurations, saved Product/Tech
Boards with effective 28-day retention/nonempty terminal statuses, Component exact-name broadcast,
and the Team-parent discovery profile. It rejects `other`, synthetic Board,
saved-board-only project fallback, other retention days and empty terminal-status sets. Its cooperative
30-second budget can return STOP or FAIL only. This is not first-load evidence: OAuth, DB pools,
HTTP/TLS/process/Jira caches remain uncontrolled even when both diagnostic caches miss.

Before full production execution, amend and rerun the measurement gate for every excluded path,
including retention 1/28/90 and no-status behavior, `other` children, absent Board, fallback project,
Basic/JSON compatibility and selected multi-worker transport. Require nontrivial workload, exercised
paging/batching/concurrency, projection-content stability, retry/rate-limit evidence and a proven
hard deadline. No empty or fast cooperative campaign authorizes any of them. A partial release that
omits settled product scope needs explicit user approval; this support design grants none.

The pure scope/pager/projection core must be reused or moved into production; harness and tests must
follow it. Measure actual UI focus via `EngBoardView`'s `resolveFocus` result (restored preference,
star, first-with-work, first) after transport selection. `bootstrapColumnReadyMs` cannot substitute
for visible-focused-column readiness or prove streaming's benefit.

## Analytics impact

- Changing among All work, Component, and an ordinary sprint through the shared Sprint selector uses existing `filter_changed`
  with `feature_name=eng`, `filter_type=sprint`, `source_surface=board`, and bounded
  `sprint_selection_state=all_work|component|sprint`. Never send sprint/Department/Component/project names or
  ids, issue keys, statuses, JQL, search text, or raw counts. Entering Board on the selected sprint
  and attempted activation of a disabled cross-sprint option emit no event.
- After transport selection, the Board data module emits at most one terminal `api_result` per
  logical Board generation through the shared analytics facade, with fixed `api_surface=eng_board`,
  `feature_name=eng`, existing typed `result=success|failure`, numeric `duration_ms`, and fixed
  `scope_type=all_work|component`. A generation is one cross-sprint load, explicit refresh or user Retry.
  A column error keeps the generation open while other queued columns finish; then emit one failure
  if any column remains failed. User Retry supersedes the old generation and starts a new one,
  reusing compatible successful columns. Superseded unfinished generations emit nothing.
  Use `trigger=userevent`, `event_type=event`, `event_name=api_result`; emit success only on
  whole-generation authority and failure only on terminal failure. Automatic supersession/abort and auth lock emit no Board event; the existing global auth boundary owns recovery.
  Set an emitted flag before dispatch to survive duplicate callbacks; no generation id, column id,
  page/batch number, progress percent or dynamic surface names enter analytics.
- API wrappers use the shared HTTP/auth boundary with transport-level tracking suppressed for Board
  progress mechanics. No per-page/column/frame/reconnect/automatic retry event. The production task
  must wire this once after choosing aggregate/stream/cursor transport and add taxonomy/schema tests
  in `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, the new Board data tests,
  and `docs/README_ANALYTICS.md`. Preserve only the `userevent`/`pageview` dataLayer triggers and
  GA4_ENABLED gate; no new custom dimensions or consent UI.
- No Team `filter_changed` event is emitted from the disabled Board control.
- Manual refresh adds no separate product event. Board API-result telemetry covers reliability and a
  refresh event would duplicate the action.
- Retention draft edits remain untracked. Existing successful unified Settings Save remains the
  authoritative Settings event; never send the day value.
- Cross-sprint `app_search` result emission waits until the active All work union or Component index
  is authoritative so one query does not emit changing provisional counts. Selected-sprint search
  retains the existing Catch Up contract.

## Required production implementation surface

The post-measurement production `EXEC-*` plan must retrace symbols and then constrain changes to an
exact subset of this inventory:

- `backend/services/eng_board.py` (**Create by moving/reusing the validated pure core**) — transport
  orchestration around the measured scope/pager/index/batching/projection/classifier. Reuse or move
  `backend/services/eng_board_measurement.py`; update the diagnostic harness/tests to import that
  same implementation. Never maintain a second unvalidated query/shaping service. Any changed field,
  query, scheduler, cache, timeout or transport requires rerunning the same gates and byte tests.
- `backend/services/group_board.py`, `backend/services/group_config.py` — retention grammar and
  delegating group compatibility.
- `backend/routes/eng_routes.py`, `backend/security/policy.py`, `jira_server.py` only for thin route
  binding/invalidation registration; no orchestration in `jira_server.py`.
- `frontend/src/api/http.js` only if streaming is selected, for the opt-in auth-safe streaming
  boundary above; preserve all existing buffered callers and add shared-boundary regression tests.
- `frontend/src/api/engApi.js` or `frontend/src/api/engBoardApi.js` (**Create**) and
  `frontend/src/eng/useEngBoardData.js` (**Create**).
- `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/EngBoardView.jsx`,
  `frontend/src/eng/EngBoardHelp.jsx`, `frontend/src/eng/EngFilterBar.jsx`,
  `frontend/src/eng/engFilterFacets.js`,
  `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`,
  `frontend/src/eng/engBoardColumns.js`, `frontend/src/eng/engBoardCardModel.js`,
  `frontend/src/eng/engBoardFilters.js`,
  `frontend/src/eng/useEngBoardFilters.js`, and `frontend/src/components/JiraExportButton.jsx`.
- `frontend/src/settings/groupBoardModel.js`, `frontend/src/settings/GroupBoardSettings.jsx`,
  `frontend/src/settings/groupConfigUtils.js`, and `frontend/src/settings/TeamGroupsSettings.jsx`.
- `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/eng/useEngPriorityTransitions.js`, and
  `frontend/src/eng/useEngProjectTrackTransitions.js` only for the Board-owned queued mutation
  adapter/generation seam.
- `frontend/src/styles/shared/header.css`, `frontend/src/styles/shared/controls.css`, and existing
  Board styles only for disabled/readiness states; reuse current dropdown and Board grammar.
- `frontend/src/analytics/analytics.js` — allowlist fixed `eng_board` surface and accept bounded
  optional `scopeType` forwarded as `scope_type`; existing callers retain their current schema.
  `frontend/src/analytics/events.js` — reuse existing param/trigger allowlists and validate enums.
- `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`,
  `docs/plans/SUPPORT-ga4-user-configuration.md` only if runbook steps change, and `frontend/dist/`
  generated only by `npm run build`.
- Create `tests/test_eng_board_service.py`, `tests/test_eng_board_source_guards.py` and
  `tests/test_eng_board_data.js`; update the measurement harness/tests after core relocation.
- Update Board/group model tests, `tests/test_oauth_eng_routes.py`,
  `tests/test_jira_search_pagination_source_guard.py`, `tests/test_backend_route_source_guards.py`,
  `tests/test_endpoint_policy_inventory.py`, `tests/test_endpoint_security_matrix.py`,
  `tests/endpoint_security_samples.py` only if paths are dynamic,
  `tests/test_oauth_cache_isolation.py`, `tests/test_cache_partitioning.py`, analytics tests, and the
  existing Board Playwright suites.
- Update `tests/test_frontend_api_source_guards.js` and `tests/test_analytics_source_guards.js` for
  exact API ownership, shared auth boundary, signal propagation and bounded generation telemetry.
- Update `tests/test_eng_board_card_model.js`, `tests/test_eng_board_filters.js`,
  `tests/test_jira_export_source_guards.js`, `tests/test_jira_export_utils.js`, and
  `tests/ui/eng_group_board_filters.spec.js` for the tri-state project and per-kind export contracts.

The production plan must name exact files per task, write RED/GREEN assertions, and update structure
budgets only when a legitimate guarded entrypoint grows.

## Required production verification

- Pure config/model tests: absent retention compatibility, 1–90 validation, default terminal,
  exact-Done and no-Done migration, raw-retention migration discrimination,
  Done reassignment/removal after save/reload, normalization idempotence, fixed final controls,
  Unmapped-before-terminal, unrelated-field preservation, and revision conflicts.
- Backend: strict `nextPageToken`/`isLast`, duplicate/malformed rows, exact/over ceilings, Component
  OR, selected-project and saved-board fallback, configured/empty issue types, direct-parent/Epic
  Link precedence, sprint/All-work/no-Component scope, JQL escaping, currently-terminal
  created-within-window fallback,
  cross-worker behavior for the selected transport, cache partitions, and `Server-Timing`.
- Fallback scope tests prove bounded Epic-first indexing before sprint/all-saved-Team child queries,
  old terminal exclusion before hydration, zero-match removal and no private-Team dependence.
- Saved-board-only worker test with config getters forced to fail after capture: the pure immutable
  project classifier still resolves Product, Tech, and `other` from returned `fields.project`, and
  different issue types in the same Jira project do not change classification; overlapping fallback
  name sets preserve Product-first compatibility.
- Auth/source guards: OAuth and Basic reads, two users/workspaces/token versions, no-request-context
  worker reaching the real Jira auth wrapper, no Flask globals/service credentials/Home clients/Jira
  mutation helpers/legacy partial fetchers, and exact endpoint policies.
- Frontend unit: scope sentinel, per-Department session isolation, disabled Team state in both main
  and compact controls (`aria-disabled`, described-by copy, inert click/Enter/Space, no active-filter
  class, no request/event, and private Team restoration outside Board), canonical
  de-duplication, readiness, Project Track versus Projects distinction, stale rejection, mutation
  rollback, focused queue, refresh/retry, compatible cache, and auth lock.
- Transport/readiness assertions must prove the authoritative All-work union and Component index publish Epic-native Project Track
  but not child-inherited Product/Tech Projects, and that identical issue types in differently mapped
  Jira projects classify differently while different issue types in one project classify identically.
- Hold page two in Playwright: cards appear first, page-one counts/status distribution are visibly
  provisional, filters/export remain disabled; release page two and prove atomic authority. Repeat
  with page-two failure, scope switch and auth lock: no partial cache or stale progress publication.
- Search unit and Playwright coverage must start with a preserved query and type during cold
  hydration; verify neutral admission/no premature empty state/no `app_search`, one application and
  event after authoritative membership, retained focus/query through stale refresh failure and Retry,
  and mounted-state preservation behind auth lock; the auth recovery action owns focus while search
  is inert.
- Export unit and Playwright coverage must prove selected-sprint snapshot reuse, All-work union-ready and Component index-ready
  with Stories still pending, authoritative empty, cold error/Retry, compatible stale refresh, menu
  keyboard focus, accessible reason copy, no partial keys, and no analytics from disabled actions.
- Playwright: first Board visit uses the mandatory sprint without `filter_changed` or a new request;
  authoritative empty snapshots also remain reusable. All work and Component precede ordinary
  sprints in the existing selector, are keyboard selectable, and remain visible during sprint-catalog
  failure. Both are disabled without a Board; Component is disabled without Components, while All
  work remains available with either Components or Teams. Leaving Board and
  changing Department restore the selected sprint; verify normal
  click/focus/layering in both header geometries. Also verify the sibling sprint contract, permanent
  help-panel copy without persistent wallpaper, disabled main/compact Teams control and restored selection outside Board,
  no unrelated task/alert requests, authoritative placeholders, fixed terminal/Unmapped behavior,
  Project Track readiness, Projects readiness, exports, drag gate, errors/retry, normal dropdown
  clicks, desktop/mobile geometry, and settled before/after screenshots.
- Direct reload with no saved Board: selected-sprint Board reuses Catch Up's **All epics**
  presentation and launches no strict request. All work and Component are disabled until the Board
  and each choice's discovery prerequisites are valid.
- Run `node --test tests/test_frontend_api_source_guards.js` explicitly. Extend its endpoint-literal
  and native-fetch ownership tests for the selected Board API module; verify AbortSignal reaches
  every transport read/CSRF request, structured auth errors reach the terminal shared lock, and
  Board data hooks/components contain no endpoint literals or native fetch. Do not exempt Board.
- Run `node --test tests/test_eng_board_data.js tests/test_analytics_events.js tests/test_analytics_source_guards.js`
  with deterministic mutation/progress ordering and 1/100-column workloads proving ≤1 terminal API
  event per generation regardless of pages/retries/frames.
- Focused suites during iteration, then `python3 -m unittest discover -s tests`,
  `npm run test:frontend:unit`, focused and full Playwright as required, `npm run build` followed by a
  clean generated diff check, startup with `.venv/bin/python jira_server.py`, and `/api/test`.

## Measurement-driven open decisions

1. Aggregate, streamed, durable-manifest, or stateless-sequential transport.
2. Full-Board versus true per-column refresh after index reconciliation.
3. Final Epic/child/batch/URL/concurrency safety limits.
4. Candidate/metadata cache miss/hit, actual UI-focused-column and full-Board completion budgets.
5. Hard-bound cancellation/DB/auth contract and measured profiles for every excluded production scope.

The settled product scope remains unchanged; these evidence gates cannot silently narrow the shipped
feature or authorize unmeasured compatibility paths.

## Diagnostic implementation boundary — 2026-09-07

The measurement plan's Tasks 0–5 now provide the guarded diagnostic core/runtime, exact local
endpoints, isolated candidate and tagged-legacy Jira transport, external runner, schema-v2 checker,
and automated verification. The baseline database failures were resolved by supplying a migrated,
disposable loopback PostgreSQL test target; tests and production storage behavior were not weakened.
Task 6 later passed startup and strict DB-OAuth options preflight but stopped before any campaign
sample or Jira campaign query: the saved workspace exposed two Component-profile-eligible
Departments and zero Team-fallback-profile-eligible Departments. Configuration and Jira data were
not changed to manufacture eligibility. No raw or summary result artifact was produced, and no
product Board implementation was started.

The Tasks 0–6 evidence establishes readiness to rerun the separate schema-v2 live characterization
when an eligible saved fallback Department exists. It does not
choose a production transport, prove a hard deadline, cover excluded production scopes, or authorize
deployment. Schema v2 has no PASS path; the validated pure core must be reused or moved with its gates
intact in any later production plan.

## Existing-endpoint contextual evidence — 2026-09-07

An operator-approved Basic-auth/jsonfile loopback exercise selected the one active numeric sprint
from a 14-sprint catalog and wrote only a mode-0600 sanitized summary outside the repository. One
saved Department with eight Teams and two Components was eligible; zero Departments were skipped.
No Jira identifier, name, label, Component value, URL, JQL, cookie, credential or raw response was
retained in this design.

| Scope | Lane | Issues | Epic details | Scope Epics | Elapsed ms | Response bytes | Legacy capped |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Selected sprint | Product | 83 | 43 | 41 | 1,696.0 | 108,559 | No |
| Selected sprint | Tech | 109 | 47 | 32 | 1,598.1 | 122,167 | No |
| All work | Product | 250 | 101 | 63 | 3,237.4 | 271,499 | Yes |
| All work | Tech | 250 | 74 | 45 | 2,598.5 | 247,444 | Yes |

These are legacy response cardinalities, not strict Board membership totals. The two All-work lanes
hit the 250-issue cap. Equal reported and returned counts do not establish completeness, and equal
legacy/candidate counts would not establish equivalence. The selected-sprint calls were uncapped by
the collector heuristic, but that does not make their Epic or child discovery strict.

The observed scope is useful only as contextual evidence for one already-running Basic-mode
Department. It cannot prove the production signed-in-user OAuth path, component-scoped Epic-first
discovery, additive Team-parent union, hard-bound cancellation, excluded scopes,
cross-worker transport, atomic completeness, or visible progressive rendering. Therefore the
strict-completeness, hard-bound deadline, production transport, excluded-scope, and visible-progress
gates all remain unsupported. Do not create a production `EXEC-*` plan or begin implementation until
all five have valid evidence; schema v2 can never PASS.

## Residual risks

- Jira history JQL cost for configurable terminal sets must be measured against the real tenant.
- Live characterization needs an existing saved Department eligible for the Team-fallback profile;
  the authenticated preflight currently exposes none.
- The corrective Python existing-endpoint collector gathered sanitized contextual selected-sprint
  and All-work counts from one saved Department with Teams, but legacy endpoint caps mean that
  evidence cannot close strict-completeness or production-authorization gates.
- Component scopes can cross many projects and workflows and vary sharply by Department.
- The supported deployment can run multiple Gunicorn workers; any cross-request state must be shared
  or eliminated by transport design.
- Catch Up's completed selected-sprint snapshot is the selected-sprint Board source; only strict
  All work and Component transport state uses provisional-versus-authoritative completeness gates.
- Shared Board saves can race an active load; immutable config signatures and generations must prevent
  mixed layouts.

## Related evidence

- [`EXEC-eng-group-board.md`](EXEC-eng-group-board.md) — currently implemented Board behavior and
  historical execution contract.
- [`MRT004-performance-degradation-page-load.md`](../postmortem/MRT004-performance-degradation-page-load.md)
  — guard derived work and stale dependencies.
- [`MRT010-startup-api-load-fanout-and-overscoped-payloads.md`](../postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md)
  — avoid startup fan-out, broad payloads, and uninstrumented endpoints.
- [`MRT023-alert-enrichment-blocked-first-screen.md`](../postmortem/MRT023-alert-enrichment-blocked-first-screen.md)
  — keep secondary enrichment off first content and expose stage timing.
