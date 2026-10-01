Status: planned
Type: feature

# Per-epic refresh with glare

Date: 2026-09-30. Base: `main` at 3622ba22 (after #211). No code changes yet.
Review: a six-lens adversarial review (backend and Jira, frontend state and races, UI and accessibility, security and policy, domain semantics, delivery) ran on 2026-09-30 and is folded in below. Line numbers are approximate and from the synced tree; prefer the symbol names.

## 1. Goal and decisions

Help users keep track of Jira changes in the ENG Catch Up view without reloading the whole page. A small refresh button on an epic header refreshes that epic's stories and epic info from Jira under the user's own token, patches the view in place, re-checks that epic's alerts (never the whole department), and plays a subtle glare on the cards that changed.

Decided with the requester:
- Manual only. Automatic updates (polling, shared feed, webhooks) are rejected (section 8). The global Refresh button and the browser reload stay as they are.
- Scope: Catch Up and Planning. Planning is the last slice, enabled after its own guards pass (section 5), so Catch Up can ship first.
- Alerts: all alert types for the refreshed epic only, in three slices A, B, C.
- No whole-screen loading state, counter or timer. Progress is a small EPM burst mark (the `LoadingState` mark) replacing the refresh arrows while the request runs.
- No wipes. Changed values are replaced in place. A card that enters fades in (existing `task-appear`) and glints; a card that leaves dissolves (existing `is-removing`, 240 ms) before it is dropped.
- Glare look (specimen variant A): amber edge, 1.8 s, intensity 0.5, ring 1.5 px, beam width 22, sweep down the page on; under reduced motion a static border tint. Numeric reference: `tmp/glare-specimen.html` (gitignored; the values are copied here).
- Accepted limitation: a story moved out of this epic shows up in its new epic only after that epic, or a department-wide Refresh, is refreshed.
- Per-epic refresh does not run the empty-epic scan; `jira_server.py` and its tests are in scope.
- Future-sprint Planning auto-selects newly arrived stories (the existing default-all behavior).
- Inline status and priority edits must not reload the whole department either (requested 2026-09-30): a priority change re-checks no alerts, a status change re-checks only its epic's alerts (section 3.6b, Task 13b). Assignee and Story Points inline edits and the server-side cache wipe are left as they are for now.
- Degraded-state dot, idle cutoff and feed decisions from the automatic-update designs no longer apply.

Open decisions are in section 7.

## 2. Verified facts (checked 2026-09-30)

UI
- One function, `renderEpicBlock` (`frontend/src/dashboard.jsx`), serves the direct, initiative-grouped and flat epic paths and both Catch Up and Planning. It is a plain function, so a hook-using button must be its own component. `.epic-header` is sticky (z-index 50), so it is a positioning context. Header children: `.epic-title-row` (decorative `.epic-icon` 24x24, `aria-hidden`, priority menu, track button, `.epic-link` with name and key, `.epic-stat-toggle`) and `.epic-meta` (status, Story Points, assignee, flush right).
- The `.task-list` click handler clears dependency focus on any click outside `.task-item`; the button must stop propagation.
- `IconButton size="sm"` is 24 px. The shared `LoadingState` always renders a heading and a status wrapper; its marks (`.loading-mark-spinner`, `.loading-mark-signature`, `epm-loading-spin`) have no reduced-motion rule and are covered by `tests/test_epm_view_source_guards.js`.
- `.task-item` uses `::after` (red overlay, `.task-highlight`) and leaves `::before` free; it holds a `task-appear` transform (stacking context) and must not get `overflow:hidden`. `IssueCard.jsx` rebuilds `className` on every render, so a JS-added class is wiped; `REMOVE_FADE_MS` is private to that file. `IssueCard` is also used by EPM.
- `applyLocalEngIssueField` must not be reused: it calls `rearmCatchUpAlerts` and wipes `dependencyData`. `tests/test_dashboard_alert_source_guards.js` pins the exact number of `rearmCatchUpAlerts` call sites.

Data and backend
- `GET /api/tasks-with-team-name` with `epicKeys` returns the normal slim story shape for those epics' stories in the selected sprint and lane (epic clause `("Epic Link" in (...) OR parent in (...))`). The fetch is capped at 250 rows (`ORDER BY created DESC`), with no truncation flag. `refresh=true` skips the cache read but the entry is still written; `TASKS_CACHE` has no eviction.
- With the default purpose, epic details are fetched only for epics present on returned stories, then the wide scan (`fetch_epics_for_empty_alert`) runs and its result is filtered to the requested keys. `fetch_epic_details_bulk` swallows non-200 responses and returns `{}`.
- Client-supplied `epicKeys` is not validated; one path builds unquoted `issueKey in (...)`. `sprint` is used raw. A missing `epicKeys` or `sprint` silently yields a department-wide fetch. `quote_jql_value` and the issue-key regex (`_ISSUE_KEY_RE` in `backend/routes/eng_routes.py`) already exist.
- Alerts: the panel exists only in Catch Up. Client-derived: Missing Info (Story Points, Epic, Team), Blocked, Postponed (story half), story halves of Waiting and Ready to Close. Whole-scope server sources: Empty Epic, Postponed (future-routed), Missing Team, Missing Labels (alerts purpose with the complete epic scan, HTTP 422 when oversized); Backlog (`/api/backlog-epics`); Missing Info server half (`/api/missing-info`, sprint and team only, 5-minute cache, no `refresh`); Stories Required (`/api/eng/story-readiness`, hook has no setter and blanks ghost rows while loading). Ready to Close already accepts `epicKeys`. `POST /api/dependencies` accepts keys, has no `refresh`, and its caches last 5 minutes.
- `fetch_epics_by_keys_for_alert_service` is the wrong predicate for an epic-scoped alert object: it keeps `Sprint = N`, has no sprint-label alternative and no team or alias scope clause, and drops terminal epics.
- Slim story shape: no `labels`, no `issuelinks`; sprint is `customfield_10101`. Epic details (`fetch_epic_details_bulk`): key, summary, status (string), priority, reporter, assignee, `projectTrack`, `updated`, optional `deliveryOwner`, optional `initiative`; no labels or team.

Frontend state
- Story lists: `productTasks`, `techTasks`, `loadedProductTasks`, `loadedTechTasks`, plus story-shaped copies in `readyToClose{Product,Tech}Tasks` and `missingPlanningInfoTasks`, and epic-shaped copies in `*EpicsInScope` (status is `{name}` there and a string in `epicDetails`). `removeTask` edits only `productTasks` and `techTasks`, so "in `loaded*` but not in `productTasks`/`techTasks`" already means user-removed and resets on each wholesale load.
- `fetchTasks` (`frontend/src/eng/useEngSprintData.js`) returns only the task array (or the strings `IGNORED`, auth or `NON_AUTH_FAILURE`), drops epic details through `filterEpicsByTaskEpicKeys`, calls `beginRead` with a module-private read token, and calls `onServerConnectionFailure` on network failure even with `setErrorOnFailure:false`.
- The alert effect runs after the loading flags settle and sets wholesale lists (`setEpicDetails` merge, `*EpicsInScope`, ready-to-close, missing-info, backlog). `catchUpAlertVersionRef` guards only the alert sub-calls. The dependencies effect refetches all keys whenever the key signature of `loaded*` changes. Global Refresh does not abort fetches or bump `groupLoadVersionRef`; `refreshLegacyBoardTasks` is another wholesale load.
- `reconcileIssues` protects only assignee, delivery owner and Story Points. The `groupStateRef` snapshot effect writes the snapshot from state, and a source guard asserts that.
- Planning extras: the capacity scope signature re-fires `/api/capacity` (blanking the capacity cards) when displayed teams change; the selection effect prunes and persists selections.
- A failed lane load sets `NON_AUTH_FAILURE`. Product-only or Tech-only users get a 403 on the other lane by design.

Repo state
- `jira_server.py` is at its 6,463-line structure budget; `dashboard.jsx` is 18,198 of 18,213 (`tests/test_codebase_structure_budgets.py`). Only those two files are budgeted there.
- Baseline is not green on `main`: `tests/ui` has known failures (issue #210: `eng_priority_transitions`, `planning_selection_defaults`, two `load_performance`); the worktree has no `.venv`; the default Node is 26 while the repo needs 20 (`fnm exec --using 20`); run `npm ci` before `npm run build`; run Playwright per spec with `--workers=1`.
- No issue number exists for this feature and the branch is `cld/jira-dashboard-realtime-sync-655c71`; the repo requires `feature/<issue>-<summary>` (MRT022).

## 3. Design

### 3.1 Interaction and accessibility

- Placement (decided 2026-09-30, the requester's approved version): the button is absolutely positioned over the header's upper-right corner (`top:4px; right:6px`) inside the sticky `.epic-header`, so it adds nothing to the flex row. While shown it may cover the end of the right-most header item (assignee field, Story Points or status pill); this is accepted. At 760 px and below the title row gets `padding-right:32px`, scoped with `.epic-header:has(> .epic-refresh-button)` so EPM and settings-preview headers are unaffected, so the Planning stat toggle is never covered. Tests assert that the centre of the assignee, Story Points and status targets stays hit-testable; the recommended alternative (the decorative `.epic-icon` slot at the far left, which covers no data) was declined.
- Reveal: hidden by opacity until hover or focus within the header; always visible under `@media (hover:none)`; forced visible while busy or showing an error. Reuse the `.team-capacity-action-rail` pattern. Opaque background, own opacity-only transition, explicit SVG size, `pointer-events:none` at rest, own `:focus-visible`.
- Button states: busy uses `aria-disabled="true"` plus `aria-busy="true"` (not `disabled`, which drops focus) and ignores clicks; the refresh arrows are replaced by the small EPM burst (new `LoadingMark` component with the same two images and classes, sized 16 px, signature scaled to about 5 px, no drop shadow, rotation stopped under reduced motion; the shared loader is untouched); the burst shows for at least 400 ms.
- Inert while the epic has an active interaction: open status, priority or Project Track menu, or an active inline editor (`epicInteractionActive`, `statusTransitionActiveKey`, `priorityTransitionActiveKey`).
- Announcements: one page-level polite status region (reuse an existing one if present; do not add a second explicit `aria-live="polite"`) with a summary such as "3 stories updated", "Epic is up to date", "2 changes hidden by filters", or the failure. Failure copy is fixed text, never `details`, `jql_used` or `err.message`; the error state persists until the next interaction.
- Click handler stops propagation (dependency-focus clearing). Concurrency: at most 2 epic refreshes in flight across the page; an epic has a cooldown of about 10 s after completion.

### 3.2 Endpoint contract matrix

| Route | Method and auth | Added input | Success body | Errors |
|---|---|---|---|---|
| `/api/tasks-with-team-name` `purpose=epic-refresh` | GET, `authenticated_read`, no CSRF, OAuth per-user token or local Basic | requires `sprint` (digits), `project` (`product` or `tech`), `epicKeys` (exactly 1, format `^[A-Z][A-Z0-9_]+-\d+$`), plus group team scope | normal issue list plus `epics` (details for the requested key), `epicsInScope: []`, `capped`, `epicKeysMissing` | 400 `invalid_epic_refresh`; 403 `missing_project_access` (per lane); 429 `epic_refresh_rate_limited` with `retryAfterSeconds`; 401 lock; 502/503 |
| same, `purpose=epic-alerts` (slice B) | same | same as above | one scope-checked epic alert object (or none) with enrichment counts | same |
| same, `purpose=ready-to-close` (existing) | same | existing; add the same key format check | existing | existing |
| `/api/missing-info` (slice C) | GET, `authenticated_read` | `epicKeys` (1), `refresh` | existing shape, scoped to the epic | 400 `invalid_epic_keys` |
| `/api/backlog-epics` (slice C) | GET, `authenticated_read` | `epicKeys` (1) | existing shape, scoped | 400 |
| `/api/eng/story-readiness` (slice C) | GET, `authenticated_read` | `epicKeys` (1) | existing shape, scoped to the epic | 400 |
| `/api/dependencies` | POST, requires `X-Requested-With` in OAuth mode | add `refresh`; key format check | existing | 400 |

No new route, so no `ENDPOINT_POLICIES` entry is added (the existing entries cover them), but the security matrix tests run. Validation lives in `backend/routes/eng_routes.py`, which is not budgeted.

### 3.3 Backend

`purpose=epic-refresh` in `fetch_tasks`:
- Validate in `eng_routes` first: require `epicKeys` and digit `sprint`; 400 otherwise, so an old or malformed call can never become a department-wide fetch. Format-check `epicKeys` for the legacy purposes too, quote keys with `quote_jql_value`, and quote the `issueKey in (...)` clause in `fetch_epic_details_bulk`.
- Stories: the same JQL as the default purpose (scope, `Sprint = N`, lane, issue types, epic clause), same slim shape.
- Epic details: `fetch_epic_details_bulk` by the requested key (not the keys found on stories), so an epic with no stories in the sprint still refreshes. `epicKeysMissing` lists requested keys with no details (a swallowed failure or a deleted epic). `capped` is true when 250 or more rows came back.
- Skipped: `fetch_epics_for_empty_alert` and every alerts enrichment.
- Cache: neither reads nor writes `TASKS_CACHE`. On success, evict the same scope's `dashboard` and `alerts` entries for the user and lane, so a reload after a refresh does not show the old data.
- Rate limit: per user, purpose, lane and epic minimum interval (the two lanes of one click, and the alert call that follows, must never share a bucket; the limiter is thread-safe); 429 `epic_refresh_rate_limited` (precedent `jira_rate_limited`). Give these Jira calls a small attempt budget that honors `Retry-After` and does not record failures on the global circuit breaker (investigate the smallest mechanism in `jira_client` or the caller; if not cheap, the client cap of 2 in flight plus the server minimum interval stand in for it and the residual risk is documented).
- Run inline in the request thread in both auth modes (not inside the Basic `ThreadPoolExecutor`).
- Budget: the branch adds roughly 12-15 lines to `jira_server.py`: move logic into a service module where possible, and ratchet the budget in `tests/test_codebase_structure_budgets.py` with an itemized comment for the rest.
- Cost: about 2 searches per lane, about 4 per click (2 story and 2 detail; counted from code, verified by a Python test that counts `jira_search_request` calls). The `epic-alerts` purpose (slice B) costs about 5 searches per lane (1 scope, 1 counts, 3 distribution), so a status or membership change adds about 10 per click.

### 3.4 Frontend data flow

The loader lives inside `useEngSprintData.js` (the read token is module-private; follow `loadAlertEpics` and `loadReadyToClose*`), wrapped by a thin hook and an `EpicRefreshButton` component.
1. Guard at click: not `loading`, `productTasksLoading`, `techTasksLoading`, `manualRefreshDisabled`; `tasksFetched` and `lastLoadedSprintRef === selectedSprint`; no alert cohort in flight (a new in-flight ref set by the alert effect); not strict-Board active; this epic not already refreshing; the epoch and cooldown rules from 3.1.
2. Capture at click: `groupLoadVersionRef`, a load epoch (bumped inside `loadMeasuredGroupTasks`, which also covers `refreshLegacyBoardTasks`), and a snapshot of the held items for this epic and the epic's own header entry.
3. Call `fetchTasks` for both lanes in parallel with `purpose: 'epic-refresh'`, `epicKeys: [epic]`, `forceRefresh: true`, `useLoading:false`, `setErrorOnFailure:false`, a registered abort signal, and a new capture option that bypasses `filterEpicsByTaskEpicKeys` and returns the epic details to the loader instead of applying them. The loader finishes the read token on every path, including discard.
4. Apply per lane. A lane that returned an array is applied; a lane that is denied (403) is left untouched without a warning; any other failed lane is left untouched and raises the warning state. Removal is inferred only from a lane that succeeded, was not `capped`, and whose epic details did not come back in `epicKeysMissing`.
5. Re-check at apply: version, epoch, scope; a key is kept as held if its held value differs from the click-time snapshot (catches status, priority or Project Track edits confirmed during the fetch), or it is pending, leaving or user-removed.
6. Apply once, with functional updaters keyed by story key. Patch every story-shaped and epic-shaped copy (see section 2) with the existing list-patch helpers, including the `*EpicsInScope` status shape difference. Do not patch `groupStateRef` by hand. Clear the same cache sources the single-field edit path clears (excluded-capacity, burnout, cohort), without `rearmCatchUpAlerts`.
7. After applying: suppress the dependencies effect's department-wide refetch for this change (a "signature already loaded" ref updated by the merge) and instead POST dependencies for the epic's whole key set (links are invisible to the diff) with `refresh`, replacing only those keys and keeping the old entries if the call fails. Invalidate cached subtask panels for changed stories and reload open ones. Re-sort with the existing priority sort and anchor the clicked header's viewport offset across the commit.
8. Skip every `setState` when the whole diff is empty.

### 3.5 Diff and merge

- Merge by story key across the whole list: the fetched copy wins, so a story moved between epics never appears twice and Planning capacity is not double-counted. Held items with the epic's key that are absent from the result are removed only under the step 4 and 5 rules.
- `DISPLAYED_FIELDS` (verified against `IssueCard` and the header): summary, status name, priority name, assignee account id (fall back to display name), Story Points normalized as `Number(v ?? 0)`, team id, epic key, sprint (`customfield_10101`, compared as an id-sorted list), `subtaskSummary`, `issuetype`. `updated` ("Last Update") is patched silently: a change in `updated` alone updates the value with no glare. `labels` is not included (not in the slim shape).
- Epic header fields: summary, status, priority, `projectTrack`, assignee, initiative; status and priority normalized (string vs `{name}`) so the user's own epic edit does not glint; epic details are replaced as whole objects (`initiative` is omitted when none).
- Changes hidden by active filters (default hides Killed; Product/Tech, Project Track and Planning closed-work filters) cannot glint: compute the visible subset for the glare, announce "N changes hidden by filters", and move focus to the nearest surviving epic header if the epic block unmounts when its last story leaves.

### 3.6 Alerts for the refreshed epic

Rule: re-check only what the change can affect, for this epic only. Never call `rearmCatchUpAlerts`. The panel exists only in Catch Up; Planning shows only the Stories Required ghost rows, and a Planning refresh issues no alert requests.

| Changed in the refresh | Alerts re-checked (this epic only) | How |
|---|---|---|
| Story Points | Missing Info (Story Points) | client; recompute `missingFields` per refreshed story and keep the server entry if still non-empty (do not reuse `patchMissingFields`, it is a no-op for `customfield_10004`) |
| Assignee, summary, priority, `updated` only | none | client |
| Story status | Blocked, Postponed (client); Waiting, Ready to Close; Empty Epic; Stories Required | client plus epic-scoped calls |
| Story added, removed or moved sprint | all epic-level alerts: Empty Epic, Waiting, Ready to Close, Backlog (future sprints), Missing Info server half, Stories Required | epic-scoped calls |
| Story team | Missing Info (Team); Stories Required | client plus readiness call |
| Epic `updated`, status or assignee | Missing Team, Missing Labels, Ready to Close, Backlog | epic-scoped alert object (always called in future sprints) |
| Nothing displayed changed | none | no extra requests |

Epic labels and team are not in the epic details, so "epic labels or team changed" is detected only through epic `updated` (or always, in future sprints).

Slice A (client only): client-derived alerts follow the refreshed stories; per-story `missingFields` recompute using the endpoint's own names (`'Sprint'`, `'Story Points'` when at most 0, `'Team'`; never `'Assignee'`) and dropping entries whose refreshed status is Killed, Done or Postponed; a client rule hides a Stories Required ghost when the refreshed list already holds an actionable story for that team (the `story_readiness.py` rule: not Blocked, Done, Killed or Incomplete); dependencies and subtask invalidation as in 3.4. Dismissals (`dismissedAlertKeys`) are kept.
Slice B: `purpose=epic-alerts` with an optional `epic_keys` parameter added to `fetch_epics_for_empty_alert` that ANDs `issueKey in (...)` after the scope clause, so the sprint-label alternative and team and alias scope clause are kept (one search) fetched with `complete_alert_scope=True` so a Jira failure returns an error instead of "epic out of scope" (the counts and distribution functions get an optional `failures` list for the same reason), plus `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics` for that one key; an epic is removed from `epicsInScope` only when this scoped query returns none; Ready to Close and Waiting via the existing `purpose=ready-to-close&epicKeys=X` for the owning lane only; keyed merges of `*EpicsInScope` and `readyToClose*` with deletion.
Slice C: `epicKeys` on `/api/missing-info` (AND `issueKey in` into the epic query, `refresh`, cache key extended only when present), `/api/backlog-epics`, and `/api/eng/story-readiness` (separate cache and in-flight key, never write the department snapshot cache, validate in the existing `ValueError` block, pass keys to `_story_readiness_compute` separately from the `requested` tuple); a merge function on `useStoryReadiness` (upsert and delete by epic key); keyed merges for missing-info and backlog.
All alert merges check `catchUpAlertVersionRef` captured at click and are discarded if a department reload started; a wholesale reload is authoritative.
Worst case for a status or membership change is roughly 25+N searches (N is the readiness child-batch count) and several seconds; a click with no displayed change, or only assignee, summary, priority, `updated` or Story Points changes, needs no alert calls. Counts come from reading the code, not measuring.

### 3.6b Inline status and priority edits

Verified 2026-09-30: after a successful inline status or priority change (story or epic, single or bulk), `useEngStatusTransitions` and `useEngPriorityTransitions` call `onAlertDataInvalidated`, wired to `rearmCatchUpAlerts` (`dashboard.jsx`). That reloads the alerts for both lanes with the complete epic scan, plus missing-info, ready-to-close and backlog for the whole department, and blanks the Stories Required ghost rows. Assignee and Story Points edits do the same through `invalidateEngIssueFieldSources`. No alert rule depends on priority, so a priority reload is pure waste.

Change (Task 13b): the two hooks pass the succeeded keys; priority triggers no alert request; status re-checks only the edited story's epic (or the epic itself) through the same epic-scoped calls as the refresh, selected by `alertCallsForEdit`, and waits for an in-flight alert cohort to settle so a stale cohort result is corrected, not clobbered. Catch Up only. The source guard's `onAlertDataInvalidated: rearmCatchUpAlerts` count goes from 2 to 0 in that task; `docs/features/alerts.md` line 12 is updated. The ontology section `ENG inline issue edits and alert invalidation` (added 2026-09-30) records the current connection between inline edits, the alert cohort reload and the server cache wipe; Task 13b and Task 14 update it. Not changed: assignee and Story Points edits, Project Track, the global Refresh, and the server-side `clear_jira_issue_status_caches` process-wide wipe after status, priority and Project Track changes (a follow-up candidate: targeted eviction).

### 3.7 Glare

- Trigger: cards (and the epic header) whose displayed fields changed and that are mounted and inside the viewport below the sticky stack (exclude the area under `epicStickyTop` and the Planning panel); at most 8 per refresh. Never for the user's own edits, the global Refresh or the initial load. Cards the user edited in the last 10 s do not glint.
- Mechanism: a `data-glare` attribute set by an imperative helper (React owns `className`), removed on `animationend` filtered by animation name; replay by remove, reflow, add. A `::before` ring on `.task-item` drawn with a mask ring, extended over the 3 px left accent, `border-radius: inherit` (8 px direct, 10 px grouped), `pointer-events:none`; no `overflow:hidden`. The epic header gets a bottom-edge sweep (it has no border or radius). Only the ENG lists set the attribute (EPM also renders `IssueCard`).
- Look: specimen variant A with the numbers in section 1. Validate on the real app with a screenshot, because the specimen card has a one-pixel box shadow and the real card does not.
- Accessibility: contrast of the amber ring on white is low (about 1.45:1), so the glare is not the only change marker: the status announcement carries the summary. Under reduced motion the ring becomes a static tint at a higher opacity and a longer duration (at least 900 ms); on dimmed, killed or incomplete cards (card opacity multiplies the ring down) the tint is stronger or skipped.
- Leaving cards: a new `isLeaving` prop on `IssueCard` produces exactly the existing `is-removing` class, `task-remove-dissolve` and 0.24 s; export `REMOVE_FADE_MS` and drop the key from the lists after it. Entering cards mount normally (`task-appear`), then glint. No height collapse (the list jumps at 240 ms; accepted).

### 3.8 Persistence and ordering

Nothing is persisted: no `localStorage`, no private view, no shared configuration (`backend/security/CONFIGURATION_OWNERSHIP.md`). Epic order follows child priority, status or track, or Initiative grouping, so a refresh can move the block; the clicked header's viewport offset is anchored across the commit (an Initiative change remounts that epic's cards, so DOM survival is asserted only for non-Initiative changes).

### 3.9 Analytics

A user-visible action needs an analytics decision. Proposal, reusing existing params only: `trigger=userevent`, `event_type=event`, `event_name=epic_refresh_action`, `feature_name=epic_refresh`, `workflow_action=refresh_result`, `source_surface=catch_up|planning`, `result=changed|unchanged|failure`, `issue_count_bucket` for changed cards; no `has_*`, no keys; fired once per applied click (not for discarded results). Use a distinct `api_surface` (`epic_refresh`, added to `API_SURFACES`) so the per-click requests do not pollute the `eng_tasks` load latency series. Files: `frontend/src/analytics/events.js`, `analytics.js`, `dashboardAnalytics.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `docs/README_ANALYTICS.md` taxonomy row, `docs/plans/SUPPORT-ga4-user-configuration.md` and `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`. The alternative is an allowlist row with no event, as the manual Refresh button has; that needs an explicit decision (section 7).

## 4. Risks

- The estimate grew because of the review (section 5). Story readiness per epic is the most expensive and fragile piece.
- Jira quota and the shared circuit breaker: mitigated by the client cap, cooldown and server minimum interval; breaker isolation is best effort.
- Search is eventually consistent, so a click right after an edit can show the old value; the click-time snapshot rule protects the user's own confirmed edits, other users' edits may need a second click.
- The 250-row cap: a large epic can surface stories the user never saw (they glint only if `updated` is newer than the lane's load time); removals are never inferred from a capped lane.
- Partial lane failure and denied lanes leave those cards untouched.
- Header geometry and layering have strict existing tests and past regressions; new assertions are listed in section 6.
- A refreshed epic can disappear (its last story left) or move; focus and anchoring rules in 3.5 and 3.8.
- Planning: the selection effect prunes and persists; Planning is enabled last, behind its own tests. The capacity cards do not blank or refetch: the brief's 2-frame hold became a pin of the capacity scope signature that lasts until the user changes the capacity scope (sprint, group, Planning mode, selected teams) or a department load bumps the load epoch. Consequence: after a per-epic refresh in Planning, a team that newly rises above zero Story Points shows no capacity value until the next scope change or department Refresh, a team that drops to zero loses its card with no refetch, and the same applies to a later inline Story Points edit that crosses zero. Alternative considered and not taken: one silent capacity reread after the refresh settles when the displayed team set differs (keeps old cards, no blanking, but breaks the "zero `/api/capacity` requests" acceptance test). Flagged for the requester's decision.
- Hidden Planning capacity changes are silent (no alert panel there).
- Line budgets: `jira_server.py` and `dashboard.jsx` ratchets are certain (itemized comments).
- The baseline suite is not green (issue #210); regressions are judged against a recorded baseline.

## 5. Slices, waves and effort

Execution is by subagents in the current tree (the repo forbids secondary worktrees): one fresh subagent per task with a spec-compliance review and a code-quality review; parallel tasks touch disjoint files and never commit concurrently; one task at a time builds `frontend/dist`; subagents never push or open a PR; commits and PR text carry no agent attribution trailers (user rule); the orchestrator re-runs each task's verification itself.

| Wave | Tasks | Files (new = N, modified = M) | Rough effort |
|---|---|---|---|
| T0 (sequential, inline) | issue number and branch rename, baseline record (`.venv`, `fnm exec --using 20 npm ci`, Python and Node counts, `tests/ui` known failures), commit design and plan, GATE sweep, confirm a clean `npm run build` leaves `git diff --exit-code frontend/dist` | docs only | 1 day |
| 1, parallel | W1a backend core (validation, `epic-refresh`, `capped`, `epicKeysMissing`, cache skip and evict, rate limit, tests, budget); W1b pure logic (diff, merge, normalize, guards) with unit tests; W1c UI atoms (`LoadingMark`, `EpicRefreshButton` presentational, CSS, `IssueCard` `isLeaving` and `data-glare`, `REMOVE_FADE_MS` export, glare CSS); W1d analytics events and docs | `jira_server.py` M, `backend/routes/eng_routes.py` M, `tests/test_epic_refresh_purpose.py` N, `tests/test_codebase_structure_budgets.py` M, `frontend/src/eng/epicRefreshPatch.js` N, `frontend/src/ui/LoadingMark.jsx` N, `frontend/src/ui/EpicRefreshButton.jsx` N, `frontend/src/issues/IssueCard.jsx` M, `frontend/src/styles/eng/{loading,issues,epics}.css` M, analytics files M | 6-9 days |
| 2, sequential | loader in `useEngSprintData.js` (capture option, token finishing, guards, cohort gating); `dashboard.jsx` wiring (button mount, dependencies gate, subtask invalidation, cache-source clear, status region, `removeTask` interplay) with the itemized budget ratchet; Playwright `tests/ui/eng_epic_refresh.spec.js` | `useEngSprintData.js` M, `useStorySubtasks.js` M, `dashboard.jsx` M, `tests/ui/eng_epic_refresh.spec.js` N | 9-13 days |
| 3, parallel | alerts A (frontend); B backend (`epic_keys` on `fetch_epics_for_empty_alert`, `epic-alerts` purpose, tests, second ratchet); C backend (`eng_routes.py`, `story_readiness.py`, tests) | as named | 10-14 days |
| 4, sequential | B frontend then C frontend (`useEngSprintData.js`, `useStoryReadiness.js`, `engApi.js`, `dashboard.jsx`) | as named | 8-11 days |
| 5 | Planning enablement: capacity signature guard, selection-effect tests, Planning header geometry | `dashboard.jsx` M, specs | 3-5 days |
| 5b | Inline status and priority edits re-check only their epic (Task 13b) | `dashboard.jsx` M, the two transition hooks M, alert helpers, guard test, spec | 4-6 days |
| Final | docs (`docs/ontology.md`, `README.md`, `docs/features/eng-workflows.md`, `docs/features/alerts.md`, `docs/README_ANALYTICS.md`), one `frontend/dist` build and commit, whole-branch review, publication transaction | docs, dist | 3-4 days |

Total roughly 44-63 working days (9-12 weeks) for one engineer (estimates re-checked after the plan review). With subagents running disjoint tasks in parallel the calendar time shrinks, but review and Playwright cycles dominate. Each wave is releasable on its own: core refresh (waves 1-2), then A, B, C, then Planning. These are my estimates, not measured.

## 6. Contract

Forbidden regressions:
- No change to the global Refresh button, browser reload, initial-load requests, auth behavior or the 401 terminal lock.
- No whole-screen loading state and no `loading`, `productTasksLoading` or `techTasksLoading` flip from a per-epic refresh.
- No department-wide request after a click: every request after a click carries `epicKeys=<key>` (or is on an explicit allowlist, such as the epic's own dependency keys).
- No `rearmCatchUpAlerts` call from the refresh; the source guard's `rearmCatchUpAlerts();` count stays 3, and its `onAlertDataInvalidated: rearmCatchUpAlerts` count goes from 2 to 0 only in Task 13b.
- No layout change in the epic header on hover, no change to its one-row desktop layout or the shared `.task-status` presentation, no change to sticky layering; the assignee, Story Points, status and Jira-link targets stay clickable.
- No resurrected removed cards; no overwritten pending or just-confirmed edits; no removal inferred from a capped, denied or failed lane.
- No background requests; nothing persisted.
- The shared `LoadingState` and its source guard are untouched; EPM cards never glint.

Files allowed to touch: those in section 5, plus the tests named in this document, `docs/plans/README.md` and the EXEC plan, and `frontend/dist` through `npm run build` (committed once, at the end of a wave).

Acceptance criteria (testable):
- Backend (`tests/test_epic_refresh_purpose.py` and the existing suites): 400 for missing or malformed `epicKeys` or `sprint` and for quote, paren, `ORDER BY` and newline inputs, with no Jira call; scan not called; epic details fetched for the requested key including an epic with no stories; story JQL identical to the default purpose; `capped` and `epicKeysMissing` set correctly; no `TASKS_CACHE` write and the scope's dashboard entries evicted; at most 2 searches per lane (counted through `jira_search_request`); 429 returns fixed copy with no retry loop and unchanged breaker state; OAuth no-request-context path; Jira write methods and Basic credentials patched to fail; per-epic readiness and missing-info calls never write or read the department cache entries (a full load after a per-epic call returns the full payload); `make test-security`; `tests/test_codebase_structure_budgets.py` green with the itemized ratchets.
- Pure logic (node tests): diff cases (comment-only, own echo, status, team, sprint, null and 0 Story Points, display-name-only assignee, `updated`-only, `subtaskSummary`), merge by key (moved story, NO_EPIC story, two epics at once), pending and click-snapshot keeps, capped and denied lanes, epoch discard.
- Source guards: the hook and loader never reference `rearmCatchUpAlerts`, `loadGroupTasks` or `applyLocalEngIssueField`; `/api/` literals stay under `frontend/src/api/`; no glare attribute in EPM; `LoadingState` unchanged.
- Playwright (new `eng_epic_refresh.spec.js`, normal clicks, never `force`):
  - Hidden at rest, visible on hover and focus, visible under `hover:none` (`test.use({ hasTouch: true })`: CDP `Emulation.setEmulatedMedia` does not change `hover` and `page.emulateMedia` cannot set it); header rect identical with the button shown and hidden for direct, initiative-grouped and Planning headers at desktop and 390 px; `elementFromPoint` at the assignee, Story Points and status centres; an open status menu layers above the button; `scrollWidth - clientWidth <= 1`.
  - One request per lane with `epicKeys`; `LoadingState` never renders; a changed card's DOM node survives and scroll is unchanged (non-Initiative change); the clicked header's viewport offset is unchanged; filters stay applied; hidden-changes announcement.
  - Glare on changed in-viewport cards only, cap of 8, screenshot with animations paused through `document.getAnimations()` at about 900 ms (not `animations:'disabled'`, which jumps to the end and hides the glare); reduced-motion tint via `emulateMedia({reducedMotion:'reduce'})`; `page.clock` for the 400 ms minimum.
  - A global Refresh during a per-epic refresh discards the result; an alert cohort in flight disables the button; an edit that confirms during the fetch is kept; a removed card stays removed; a card that leaves dissolves with `is-removing` 0.24 s; a card that enters fades in and glints; two epics at once; a 401 uses the existing lock; a 429 shows the fixed message and no banner; an HTTP 500 shows the error state and no global banner; a per-lane partial failure.
  - Alerts (Catch Up): Story Points from empty to a value removes that story's Missing Info entry with no department-wide request; a status change re-checks Ready to Close and Empty Epic for that epic only; a refresh with no displayed change makes no alert requests; dismissals survive; a department reload that starts mid-refresh discards the per-epic alert result; a Planning refresh issues zero alert requests.
- The full Python suite (CI environment) and the full node suite pass; `npm ci` then `npm run build` leaves no diff after the commit; the full `tests/ui` run shows no new failures compared with the recorded baseline; `.venv/bin/python jira_server.py` starts and `/api/test` answers if startup paths change; the analytics impact review is documented; measured searches and time per click are recorded as evidence.

## 7. Decisions (all resolved 2026-09-30)

1. Button placement: the requester's approved top-right overlay (section 3.1).
2. Issue number: #213 ("Dashboard epics on demand sync feature"); branch `feature/213-per-epic-refresh`.
3. Analytics: the `epic_refresh_action` event with its own `epic_refresh` API surface.
4. The 8-11 week estimate and the wave order, with Planning last, were accepted; the execution plan is `docs/plans/EXEC-per-epic-refresh-213.md` (reviewed by five subagents on 2026-09-30).

Follow-up candidate, not in scope: re-homing stories that moved out of the epic by adding `key in (held keys of this epic)` to the same search; it needs the MRT031 byte budget for large epics.

## 8. Automatic live updates: evaluated and deferred

Evaluated 2026-09-29 and set aside: per-user polling of a change detector, a shared server-side change feed, Jira dynamic webhooks (OAuth 3LO), a Forge app with product events, an admin webhook. Reasons: changes land under people who are planning in busy periods; Atlassian load and the points-based quota; 5-8 weeks of work; gates (public webhook path, OAuth app-owner rule, re-consent for `manage:jira-webhook`, SSE thread capacity with `--threads 8`, single-process in-memory feed). Kept facts: OAuth 3LO apps can register dynamic webhooks via `POST /rest/api/3/webhook` (30-day expiry, 5 per app per user per tenant, JQL filter cannot match sprint or team, delivery needs the app owner to be the registering user for non-public apps, at-least-once and unordered, typically 30 s and up to 15 minutes, public HTTPS receiver); since 2026-03-02 a points-based hourly quota applies to OAuth 3LO, Connect and Forge apps while Basic API-token traffic stays under burst limits only (published pools 65,000 to a 500,000 per-tenant cap); search is eventually consistent and `reconcileIssues` gives read-after-write. The diff, merge and glare pieces here are reusable if automatic updates return.
