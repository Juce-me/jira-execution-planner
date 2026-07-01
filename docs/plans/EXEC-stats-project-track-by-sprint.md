# Stats: Project Track by Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL when available: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Goal:** Add a new ENG stats sub-tab, `Project Track`, that shows story points by Project Track. A filter bar sits on top of the whole tab, followed by a mode title (`EPIC MODE` default / `TEAM MODE`). Below that, in order: (1) a horizontal "totals" bar of SP split by track (Flexible / Committed / No track) aggregated over the selected sprint range, with value labels on each segment; (2) a per-sprint vertical stacked-bar chart of SP split by track across the range; (3) a per-assignee (Epic mode) / per-team (Team mode) horizontal stacked-bar breakdown split by track; (4) an Epic-mode-only time-in-phase section showing how long each in-scope epic spent in each Project Track state, from Jira changelog.

**Architecture:** Reuse the existing progressive, per-sprint-cached `/api/stats/excluded-capacity-source` endpoint as the single scoped issue source for the SP sections. Extend its cached epic enrichment to also carry each story's parent-epic `projectTrack` and epic assignee (additive fields only). Project Track is inherited from each epic down to its stories. Bucketing is **by sprint** (the existing sprint identity on each story), not by calendar quarter. The time-in-phase section adds one new read-only endpoint doing a **bounded** per-epic `expand=changelog` fetch over in-scope epic keys, reusing the cohort path's staged fan-out + changelog-parsing helpers. Add pure frontend aggregation modules and SVG chart components, wired into a new `statsView === 'projectTrack'` sub-tab in `dashboard.jsx` modeled on the Excluded Capacity tab.

**Tech Stack:** Python 3.10+ Flask (`jira_server.py`, `backend/routes/stats_routes.py`), existing stats-source path and epic-meta cache, existing changelog helpers (cohort staged fetch + `resolve_terminal_date_from_history`-style parsing), React 19, existing stats helper/chart modules, shared capacity classifier (`frontend/src/capacityClassification.mjs`), Python `unittest`, Node `--test`, Playwright UI tests, esbuild (`npm run build`).

**Feasibility note (verified live):** A Basic-auth probe (`.env.backup_basic`) of epic `TECH-27221` returned `created 2026-03-26`, current track `Flexible`, changelog `total=7` (not truncated), one Project Track transition `2026-06-25 null → Flexible` → 91.1 days in null, 4.8 days in Flexible. Confirms `customfield_35024` transitions carry `fromString`/`toString` + `created`, and that typical epics fit one `expand=changelog` response (truncation still handled defensively).

## Global Constraints

- Plans and implementation live under repo-relative paths; never commit secrets, real Jira keys, personal emails, or local absolute paths. Use synthetic fixtures only (`AGENTS.md` §6).
- Read-oriented stats surface for normal users. No Jira/Home write paths. The one new route is read-only.
- Project Track is an existing Jira custom field. Default id `PROJECT_TRACK_FIELD_DEFAULT = 'customfield_35024'`; always resolve via `get_project_track_field_id()` so a `dashboard-config.json` override wins. `get_project_track_field_config()` already catches `ConfigStorageError` internally and falls back to the default (`jira_server.py:2260-2268`, proven by `tests/test_project_track_field.py`), so call `get_project_track_field_id()` directly — do NOT add a redundant `try/except ConfigStorageError` wrapper around it (dead branch).
- "Sprint" is the bucketing unit. In this codebase the sprint identity already lives on each story (`fields.customfield_10101` normalized sprints) and the Excluded Capacity tab already groups by sprint. Reuse that sprint identity; do NOT introduce a calendar-quarter mapper.
- Reuse the existing stats-source contract: Jira pagination is `nextPageToken`/`isLast`; the endpoint loads one sprint per request and merges progressively. Do not add a second scoped fetch or per-issue enrichment fan-out for the SP sections.
- Reuse the shared capacity classifier `classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet })` for Product/Tech/Ad Hoc; do not re-derive Product/Tech from `task.key.startsWith('TECH-')`.
- Run the FULL Python suite (incl. `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`) and the full Node suite as the baseline and before claiming done; ratchet structure budgets only when these entrypoints legitimately grow.
- Analytics reuse existing `stats_action` / `chart_action` / `filter_changed` contracts with bucketed, typed params only — no raw epic keys, summaries, team/group names, issue keys, assignee names, or durations. Keep the two-trigger GTM dataLayer contract; no new custom dimensions unless explicitly required.

---

## Status

Planned. Not started. All work belongs on branch `feature/stats-project-track-quarters`. Rename to `DONE-*` only after implementation is complete, verified, and accepted/merged, per `docs/plans/AGENTS.md`.

## Pre-Implementation Validation (resolved)

A five-agent review traced every claim against the working tree. Confirmed real: `classifyCapacityIssue` shape, `getProjectTrackRank`, `PROJECT_TRACK_FIELD_DEFAULT`, `get_project_track_field_id` (already catches `ConfigStorageError` internally — `jira_server.py:2260-2268`), `fetch_issues_by_keys` (`jira_server.py:3352`), the single production caller of `fetch_cached_excluded_capacity_epic_summaries` (`jira_server.py:5343`), `current_jira_get` (`jira_server.py:653`), cohort worker-thread auth threading (`ThreadPoolExecutor` + `context=`, `jira_server.py:4923/4927`), the flat all-sprints story array `excludedCapacityIssues` (`dashboard.jsx:~7198`), wiring anchors (`dashboard.jsx:668/727/7050/10238/13050`), `activeGroupTeamLabels` (`dashboard.jsx:4499-4504`), and the modular CSS partial system (`frontend/src/styles/stats/*.css` → `dist/dashboard.css`, NOT inline HTML).

Resolved decisions baked into this plan:
- **Sprint identity is the sprint `id`** (string-normalized), never the name. Stories carry `customfield_10101 = [{id,name,state}]`; the range selectors and every sibling memo key on `id`. We bucket by id, keep an `{id: name}` label map for display, and order columns by the range's id order.
- **The Project Track tab shares the Excluded Capacity tab's sprint-range state** (`excludedCapacityStartSprintId`/`excludedCapacityEndSprintId`). The loaded `excludedCapacityIssues` array therefore always covers exactly the selected range — no second fetch, no load/range mismatch.
- **One shared `inScope(task, opts)` predicate** (exclusions + capacity side + sprint-range membership) drives all sections, including the time-in-phase epic set.
- **New `POST /api/stats/project-track-phase-durations` requires an `EndpointPolicy` entry** in `backend/security/policy.py` (`authenticated_read`) or it 501s in OAuth mode.
- **Design reuse:** extract a shared `StackedBar` primitive for all horizontal bars; add `resolveProjectTrackColor` beside `resolveTeamColor`; reuse `SegmentedControl`, `.stats-control-group`/`.scenario-input`, `.stats-card`/`.stats-view` from the existing stats module.

## Product Decisions

1. **New stats sub-tab.** Add `statsView` value `'projectTrack'`, dropdown label `Project Track`, placed after `Mono vs Cross`. It is a stats-source-only view (`isStatsSourceOnlyStatsView`), so the SP sections reuse the cached progressive fetch and do not load ENG alerts, filters, or the task list.
2. **Filter bar on top.** A single control row sits above all charts and drives every section: **Start sprint** + **End sprint** (the SAME `excludedCapacityStartSprintId`/`excludedCapacityEndSprintId` state the Excluded Capacity tab uses — `.stats-control-group` + `.scenario-input` `<select>`s), **Capacity side** (`Product` default / `Tech` / `Tech + Product`, via `SegmentedControl`), **Exclude Ad Hoc** and **Exclude excluded-capacity** (`<input type=checkbox>` inside `.stats-control-group`, default off = included), and **Mode** (`Epic` default / `Team`, via `SegmentedControl`). Because the sprint range is shared state, the already-loaded `excludedCapacityIssues` array always covers exactly the range; changing capacity/exclusions/mode re-derives the charts in-memory with no fetch.
3. **Mode title under the filter bar.** Directly below the filter bar, a prominent heading shows the active mode: **`EPIC MODE`** (default) or **`TEAM MODE`**. The label "Metric/Story points/Epics" is not used anywhere — the only switch is **Mode: Epic | Team**.
4. **Capacity side is three-way.** `classifyCapacityIssue` gives `projectType` product|tech. `Product` keeps product (incl. Ad Hoc); `Tech` keeps tech; `Tech + Product` keeps both. Default `Product`.
5. **Project Track inherited to stories + null bucket.** Each story inherits its epic's `projectTrack` (enriched `epicProjectTrack`). Stories whose epic has no track (null/blank) bucket into a single `No track` segment. The track set is data-derived, ordered by `getProjectTrackRank` then alphabetically, with `No track` always last. Track colors are shared across all charts in the tab.
6. **Mode drives granularity AND breakdown dimension (default Epic).** `Epic` (default): aggregate at epic granularity — each in-scope epic contributes the sum of its in-scope stories' SP, grouped by the epic's track; breakdown rows are **epic assignees** (`epicAssignee`). For the totals/per-sprint charts, each epic's SP is placed in its **dominant sprint** (the in-range sprint holding the largest share of that epic's SP; ties → latest sprint in range). `Team`: aggregate at story granularity; breakdown rows are **teams** (from active department/group config); each story's SP counts in its own sprint.
7. **Totals bar spans the selected range.** Start/End sprint bound the range. The top totals bar aggregates SP by track across the **whole selected range** (start→end), not a single sprint. There is no separate "selected sprint" state and no click-to-select; the per-sprint chart is the per-sprint trend.
8. **Sections (top to bottom).** (a) **Mode title** (`EPIC MODE`/`TEAM MODE`). (b) **Totals bar**: one horizontal stacked bar = total SP by track over the selected range, with a value label (number) on each segment. (c) **Per-sprint chart**: vertical bars per sprint in range, stacked by track; in Epic mode show a caption "each epic's full SP shown in its dominant sprint" (because epic SP is placed in one sprint, Epic-mode per-sprint bars look spikier than Team-mode story-distributed bars — this is expected and the totals bar reconciles since both sum the same per-epic totals). (d) **Breakdown chart**: one horizontal stacked bar per assignee (Epic mode) / team (Team mode), split by track over the range, each segment value-labelled; heading "By assignee" / "By team". (e) **Time-in-phase** — Epic mode only (Decision 9).
9. **Time-in-phase (changelog) section — Epic mode only.** Rendered only when Mode = `Epic` (it is inherently epic-attributed; showing it in Team mode is confusing). The in-scope epic set is the distinct `epicKey`s of stories passing the SAME `inScope(task, opts)` predicate the SP sections use — i.e. it respects exclusions AND the capacity-side filter AND the sprint range (so `Product` mode does not show tech-only epics). For those epics, fetch each epic's Project Track change history and compute days in each state (`null (no value)`, `Flexible`, `Committed`, plus any other observed value). Render one horizontal stacked bar per epic (segments = state, width = days, each value-labelled in days), ordered by total age, with an aggregate summary (avg days-to-first-track, avg days-to-Committed). Date granularity only.
10. **Bounded fan-out for changelog.** The new endpoint caps epics per request and bounds concurrency, reusing the cohort staged-fetch pattern. It flags truncation (`meta.truncated`) and never silently drops epics. Per-epic single-changelog truncation (`total > len(histories)`) falls back to the paginated changelog endpoint.
11. **Backend change is additive for stories; one new read-only endpoint for phases.** Story enrichment attaches `epicProjectTrack` (string | null) and `epicAssignee` (`{ displayName } | null`) additively. Time-in-phase data comes from a new `POST /api/stats/project-track-phase-durations` route.
12. **Analytics reuse.** Tab open + filter/section toggles reuse `stats_action` / `chart_action` / `filter_changed` with bucketed params (`series_type`, `mode` ∈ {epic,team}, `capacity_side` ∈ {product,tech,both}, exclusion booleans, `section`). No raw epic keys, assignee names, or durations. No new GA4 custom dimension unless review finds one strictly required.

## Affected Surfaces

| Surface | Current behavior | Required behavior |
| --- | --- | --- |
| Stats view selector (`frontend/src/dashboard.jsx` ~668, ~13048-13056) | `resolveStatsView` allows `teams/priority/burnout/cohort/excludedCapacity/monoCrossShare`; dropdown lists those. | Add `projectTrack` to `resolveStatsView` and a `{ value: 'projectTrack', label: 'Project Track' }` dropdown option after Mono vs Cross. |
| Stats-source load gate (`dashboard.jsx:727`, ~7050-7054) | `isStatsSourceOnlyStatsView` true for `excludedCapacity`/`monoCrossShare`. | Include `projectTrack` so the cached progressive source fetch runs and ENG alerts/filters/task list stay unloaded. |
| Stats panel render gate (`dashboard.jsx:10238`) | `canRenderStatsPanel` includes stats-source views. | Include `projectTrack`. |
| Delivery-summary guard (`dashboard.jsx:~13060`) | `StatsDeliverySummary` hidden for `cohort`/`excludedCapacity`/`monoCrossShare`. | Add `projectTrack` so the delivery-rate header does not render above the new tab. |
| Stats-source story payload (`jira_server.py:5082-5141`, `5151-5199`, `5343-5348`) | Story carries `epicKey`/`epicSummary` + sprint (`customfield_10101=[{id,name,state}]`); epic enrichment fetches only `summary`. | Additionally carry `epicProjectTrack` and `epicAssignee`; epic enrichment fetches `summary` + project-track field + `assignee`. |
| Stats routes + security policy (`backend/routes/stats_routes.py`, `backend/security/policy.py`) | Registers `/api/stats/*` POSTs, each with an `EndpointPolicy`. | Register new read-only `POST /api/stats/project-track-phase-durations` delegator AND its `EndpointPolicy(authenticated_read)` — both required. |
| Excluded Capacity / Mono vs Cross tabs | Unchanged. | Unchanged — no regression. Reused helpers keep current behavior; `storyPointsFor` gains an `export` (additive). |

## Endpoint Contract

| Route | Auth | CSRF | Request | Success | Errors / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/stats/excluded-capacity-source` | Existing authenticated read (OAuth Jira REST / basic per mode) | Existing `X-Requested-With: jira-execution-planner` | Existing `{ sprintIds, teamIds, refresh? }` (one sprint per request) | Existing `{ cached, generatedAt, data, meta }`; each story now also includes `fields.epicProjectTrack` (string | null) and `fields.epicAssignee` ({ displayName } | null). | No shape removals; existing consumers ignore new fields. `epic-summaries` Server-Timing token still covers the richer epic fetch. Epic enrichment stays a single cached bulk fetch keyed by epic key + auth context. |
| `POST /api/stats/project-track-phase-durations` (new) | Same as sibling `/api/stats/*` reads. **Requires an `EndpointPolicy` in `backend/security/policy.py` (`authenticated_read`)** or returns 501 `route_not_oauth_ready` in OAuth mode (`guards.py:191-195`). | `X-Requested-With: jira-execution-planner` only — `authenticated_read` is NOT in `CSRF_POLICY_CLASSES`, so NO `X-CSRF-Token`. | `{ epicKeys: string[], refresh?: boolean }` (capped server-side; `refresh` is accepted for shape parity with the request builder but the route itself is stateless per request — no server cache) | `{ epics: [{ key, summary, currentValue, durations: { "<state>": days }, created, transitions: [{ date, from, to }] }], meta: { truncated, processedEpicCount, warnings } }` — AS-BUILT: no `cached`/`generatedAt` (the frontend caches per epic-key-set signature instead, see Task 6 Outcome); field names are `epics`/`key`/`currentValue`/`durations` (not `data`/`epicKey`/`currentTrack`/`durationsDays`); `meta` has no `requestedEpicCount`. | Read-only; never mutates Jira. Caps `epicKeys` at `PROJECT_TRACK_PHASE_MAX_EPICS`; bounded `ThreadPoolExecutor`; captured `RequestAuthContext` passed as `context=` into each worker. On per-epic truncation (`changelog.total > len(histories)`), pages `/rest/api/3/issue/{key}/changelog`. `meta.truncated=true` when the cap drops epics (or the timeout budget is exceeded); `meta.warnings` carries per-epic fetch-failure/timeout notes. No server-side cache; no token/PII in logs. |

New story `fields` shape (additive keys shown):

```json
{
  "epicKey": "PROD-12",
  "epicSummary": "Checkout revamp",
  "epicProjectTrack": "Committed",
  "epicAssignee": { "displayName": "Synthetic Owner" },
  "customfield_10004": 5,
  "teamId": "team-a",
  "customfield_10101": [{ "id": 42, "name": "Sprint 42", "state": "active" }]
}
```

## File Map

- Modify: `jira_server.py` — (a) extend `fetch_cached_excluded_capacity_epic_summaries` to fetch + cache `projectTrack` and `assignee`, returning a per-key meta dict; extend `build_excluded_capacity_issue_payload` to attach `epicProjectTrack`/`epicAssignee`; (b) add the phase-durations handler + bounded changelog fetch + transition parser.
- Modify: `backend/routes/stats_routes.py` — register the `POST /api/stats/project-track-phase-durations` delegator.
- Modify: `backend/security/policy.py` — add the `EndpointPolicy` (`authenticated_read`) for the new route (without it → 501 in OAuth mode).
- Modify: `tests/test_excluded_capacity_stats_api.py` — assert enriched story payload (track + assignee, null cases) and that the epic fetch requests the project-track field.
- Create: `tests/test_project_track_phase_api.py` — pure parser math, `fieldId`-vs-name matching, route cap/truncation/pagination, no-request-context, against a synthetic changelog fixture.
- Modify: `tests/test_oauth_stats_routes.py` — assert the new route is reachable in OAuth mode with `X-Requested-With` (not 501).
- Modify: `frontend/src/stats/excludedCapacityStats.js` — `export` the existing `storyPointsFor` (Step 2.0).
- Create: `frontend/src/stats/projectTrackStats.js` — `inScope`, `buildProjectTrackSprintSeries`, `summarizeProjectTrackTotals`, `buildProjectTrackBreakdownRows`, `NO_TRACK_LABEL` (sprint-id-keyed).
- Create: `tests/test_project_track_stats.js` — Node `--test` for capacity-side (incl. `both`), exclusions, null bucket, range filter (id-keyed), epic vs team mode, dominant-sprint placement, range totals, assignee/team breakdown.
- Create: `frontend/src/stats/StackedBar.jsx` — shared horizontal stacked-bar primitive (dynamic segments, value labels, clamped readout) reused by the totals/breakdown/phase charts.
- Modify: `frontend/src/stats/statsUtils.js` — add `resolveProjectTrackColor(track)` beside `resolveTeamColor`.
- Create: `frontend/src/stats/ProjectTrackTotalsBar.jsx` — single `StackedBar` row (range total), segments = track, each value-labelled.
- Create: `frontend/src/stats/ProjectTrackSprintChart.jsx` — vertical stacked bars per sprint (x labels from `sprintLabels`); no bar selection.
- Create: `frontend/src/stats/ProjectTrackBreakdownChart.jsx` — `StackedBar` rows per team/assignee split by track.
- Create: `frontend/src/stats/projectTrackPhaseStats.js` — `summarizeTrackPhaseDurations(rows)` + ordering helper.
- Create: `frontend/src/stats/ProjectTrackPhaseChart.jsx` — `StackedBar` rows per epic (segments = state, width = days).
- Create: `tests/test_project_track_phase_stats.js` — duration summary math.
- Modify: `frontend/src/api/engApi.js` — add `fetchProjectTrackPhaseDurations(backendUrl, { epicKeys, refresh, signal })`.
- Modify: `frontend/src/analytics/events.js` + `tests/test_analytics_events.js` — register `mode` + `capacity_side` params.
- Modify: `frontend/src/styles/stats/project-track.css` (create) + `frontend/src/styles/stats.css` (add `@import`).
- Modify: `frontend/src/dashboard.jsx` — `resolveStatsView`, stats-source gates, `canRenderStatsPanel`, `StatsDeliverySummary` guard, dropdown option; the new `stats-view` block: shared-range filter bar (SegmentedControls + sprint selects + exclusion checkboxes), mode title, totals bar, per-sprint chart, breakdown chart, and the lazily-fetched (Epic-mode-only) time-in-phase section; `saveUiPrefs`/`savedPrefsRef` for the 4 new toggles.
- Create: `frontend/src/styles/stats/project-track.css` (only if existing stats partials do not cover the needed classes) — follow the `frontend/src/styles/stats/` import pattern; reuse Excluded Capacity card/legend classes where possible.
- Modify: `tests/test_codebase_structure_budgets.py` — ratchet only if new files / `dashboard.jsx` growth legitimately exceed limits.
- Modify: `tests/ui/codebase_structure_smoke.spec.js` (or the existing stats UI spec) — open the tab; assert the filter bar, totals bar, per-sprint chart, breakdown chart, and time-in-phase section render; toggle Tech/Tech+Product and SP/Epics; screenshot (animations settled).
- Modify: `docs/README_ANALYTICS.md`, `README.md`, `docs/plans/README.md`.
- Modify: generated `frontend/dist/*` via `npm run build` (do not hand-edit) if `verify-frontend-build.yml` requires a clean post-build diff.

---

## Task 1: Backend epic-track + assignee enrichment

**Files:**
- Modify: `jira_server.py` (`fetch_cached_excluded_capacity_epic_summaries` ~5151-5199; `build_excluded_capacity_issue_payload` ~5082-5141)
- Test: `tests/test_excluded_capacity_stats_api.py`

**Interfaces:**
- Produces: stats-source stories with `fields.epicProjectTrack` (string | null) and `fields.epicAssignee` ({ displayName: string } | null). Epic enrichment helper returns `{ originalKey: { 'summary': str, 'projectTrack': str|None, 'assignee': { 'displayName': str }|None } }`.

- [ ] **Step 1.1: Write failing tests for enriched epic metadata.**

```python
def test_issue_payload_carries_epic_project_track_and_assignee(self):
    issue = {'id': '1', 'key': 'PROD-100', 'fields': {
        'summary': 'Story A',
        'parent': {'key': 'PROD-12', 'fields': {'issuetype': {'name': 'Epic'}, 'summary': 'Epic A'}},
        'customfield_10004': 5}}
    epic_meta = {'PROD-12': {'summary': 'Epic A', 'projectTrack': 'Committed',
                             'assignee': {'displayName': 'Synthetic Owner'}}}
    payload = build_excluded_capacity_issue_payload(
        issue, team_field_id=None, epic_link_field_id=None, sprint_field_id=None,
        epic_summary_by_key=epic_meta)
    self.assertEqual(payload['fields']['epicProjectTrack'], 'Committed')
    self.assertEqual(payload['fields']['epicAssignee'], {'displayName': 'Synthetic Owner'})

def test_issue_payload_handles_missing_track_and_assignee(self):
    issue = {'id': '2', 'key': 'PROD-101', 'fields': {
        'summary': 'Story B', 'parent': {'key': 'PROD-13', 'fields': {'issuetype': {'name': 'Epic'}}}}}
    epic_meta = {'PROD-13': {'summary': '', 'projectTrack': None, 'assignee': None}}
    payload = build_excluded_capacity_issue_payload(
        issue, team_field_id=None, epic_link_field_id=None, sprint_field_id=None,
        epic_summary_by_key=epic_meta)
    self.assertIsNone(payload['fields']['epicProjectTrack'])
    self.assertIsNone(payload['fields']['epicAssignee'])
```

- [ ] **Step 1.2: Run to confirm failure.** `.venv/bin/python -m unittest tests.test_excluded_capacity_stats_api -v` → FAIL (`KeyError: 'epicProjectTrack'`).

- [ ] **Step 1.3: Extend `build_excluded_capacity_issue_payload`.** Accept either a meta-dict or legacy summary-string per key:

```python
    epic_meta = {}
    if epic_summary_by_key and epic_key:
        raw_meta = epic_summary_by_key.get(epic_key)
        if isinstance(raw_meta, dict):
            epic_meta = raw_meta
        elif raw_meta:
            epic_meta = {'summary': raw_meta}
    epic_summary = str(epic_meta.get('summary') or '').strip()
    if not epic_summary and epic_key and parent_field.get('key') == epic_key and parent_summary:
        epic_summary = str(parent_summary or '').strip()
    epic_project_track = epic_meta.get('projectTrack') or None
    epic_assignee_meta = epic_meta.get('assignee') if isinstance(epic_meta.get('assignee'), dict) else None
```

Add to the returned `fields` (after `epicSummary`):

```python
            'epicProjectTrack': epic_project_track,
            'epicAssignee': {'displayName': epic_assignee_meta.get('displayName')} if epic_assignee_meta else None,
```

- [ ] **Step 1.4: Extend `fetch_cached_excluded_capacity_epic_summaries`.** Resolve the field id (already `ConfigStorageError`-safe internally — no wrapper), require new keys on cache read, fetch + cache richer meta:

```python
    project_track_field = get_project_track_field_id()
```

```python
            if entry and now - entry.get('timestamp', 0) < EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE_TTL_SECONDS \
                    and 'projectTrack' in entry:
                summaries_by_normalized[normalized] = {
                    'summary': entry.get('summary', ''), 'projectTrack': entry.get('projectTrack'),
                    'assignee': entry.get('assignee')}
            else:
                missing_keys.append(normalized)
```

```python
        epic_records = fetch_issues_by_keys(batch, ['summary', project_track_field, 'assignee'], context=context)
        for epic in epic_records:
            ef = epic.get('fields') or {}
            key = str(epic.get('key') or '').strip().upper()
            if not key:
                continue
            tv = ef.get(project_track_field)
            track = (tv or {}).get('value') if isinstance(tv, dict) else None
            assignee = ef.get('assignee') or None
            fetched[key] = {'summary': str(ef.get('summary') or '').strip(), 'projectTrack': track,
                            'assignee': {'displayName': assignee.get('displayName')} if assignee else None}
        with _cache_lock:
            for normalized in batch:
                meta = fetched.get(normalized, {'summary': '', 'projectTrack': None, 'assignee': None})
                EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE[excluded_capacity_epic_summary_cache_key(normalized, context=context)] = {**meta, 'timestamp': time.time()}
                summaries_by_normalized[normalized] = meta
```

Final return maps original keys to the meta dict:

```python
    return {original_by_normalized[normalized]: summaries_by_normalized.get(
        normalized, {'summary': '', 'projectTrack': None, 'assignee': None})
        for normalized in normalized_keys}
```

- [ ] **Step 1.5: Run focused test → PASS.** `.venv/bin/python -m unittest tests.test_excluded_capacity_stats_api -v`
- [ ] **Step 1.6: Run full Python suite → PASS** (no regressions in `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`). `.venv/bin/python -m unittest discover -s tests`
- [ ] **Step 1.7: Commit.** `git commit -m "feat(stats): enrich stats-source stories with epic project track and assignee"`

## Task 2: Frontend aggregation module (by sprint)

**Files:**
- Create: `frontend/src/stats/projectTrackStats.js`
- Test: `tests/test_project_track_stats.js`

**Interfaces:**
- Consumes: stats-source stories (`{ fields: { customfield_10004, epicKey, epicProjectTrack, epicAssignee, teamId, teamName, projectKey, customfield_10101 } }`), `classifyCapacityIssue` from `frontend/src/capacityClassification.mjs`, `storyPointsFor` and `getProjectTrackRank` (confirm export location — `getProjectTrackRank` lives in `frontend/src/eng/engTaskUtils.js:202`; re-export if needed to avoid a deep ENG import).
- Produces (all keyed by sprint **id**, with a separate label map):
  - `NO_TRACK_LABEL = 'No track'`
  - `buildProjectTrackSprintSeries(tasks, opts) -> { sprints: string[], sprintLabels: { [id]: name }, tracks: string[], cells: { [sprintId]: { [track]: number } } }` where `opts = { capacitySide: 'product'|'tech'|'both', mode: 'epic'|'team', excludeAdHoc, excludeExcludedCapacity, techProjectKeys, adHocEpicSet, excludedEpicSet, sprintOrder }`. `sprintOrder` is the ordered array of sprint **ids** for the selected range (from `excludedCapacitySprintRange.map(s => String(s.id))`); it both filters (range membership) and orders columns. `mode` defaults to `'epic'`.
  - `summarizeProjectTrackTotals(series) -> { byTrack: { [track]: number }, total: number }` — aggregates the whole range present in `series`.
  - `buildProjectTrackBreakdownRows(tasks, opts, { teamLabels }) -> { rows: [{ id, label, byTrack, total }], tracks: string[] }` — rows are epic-assignees (Epic mode) or teams (Team mode); same `inScope` (incl. capacity side + range) as the series.
  - Shared `inScope(task, opts)` predicate (not exported necessarily, but the single source of in-scope membership reused by the dashboard to derive the time-in-phase epic set).

- [ ] **Step 2.0: Export `storyPointsFor`.** It is currently a module-internal function in `frontend/src/stats/excludedCapacityStats.js:11` (NOT exported). Add `export` to it so `projectTrackStats.js` can reuse it (DRY). If `tests/test_stats_module_extraction_source_guards.js` enumerates the module's exports, update that allow-list. (Alternative if the source guard is strict: copy the 5-line function locally — but prefer the export.)

- [ ] **Step 2.1: Write failing tests.** `tests/test_project_track_stats.js` (Node `--test`, ESM). Fixtures use the REAL sprint shape `customfield_10101 = [{id, name, state}]` with `id !== name`, and `sprintOrder` is the array of sprint **ids**:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals,
  buildProjectTrackBreakdownRows, NO_TRACK_LABEL } from '../frontend/src/stats/projectTrackStats.js';

// id !== name on purpose, to prove the join keys on id, not name.
const story = (key, sp, track, sprintId, opts = {}) => ({ key, fields: {
  customfield_10004: sp, epicKey: opts.epicKey || `${key}-EPIC`, epicProjectTrack: track,
  epicAssignee: opts.assignee ? { displayName: opts.assignee } : null,
  teamId: opts.teamId || 'team-a', teamName: opts.teamName, projectKey: opts.projectKey || 'PROD',
  customfield_10101: [{ id: sprintId, name: `Sprint ${sprintId}`, state: 'active' }] } });

// Team mode = story granularity. sprintOrder is ids; range = ids 10 & 20.
const base = { capacitySide: 'product', mode: 'team', excludeAdHoc: false,
  excludeExcludedCapacity: false, techProjectKeys: new Set(['TECH']),
  adHocEpicSet: new Set(), excludedEpicSet: new Set(), sprintOrder: ['10', '20'] };

test('buckets by sprint id (not name); null track -> No track', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-2', 3, null, 10)], base);
  assert.deepEqual(s.sprints, ['10']);
  assert.equal(s.sprintLabels['10'], 'Sprint 10');
  assert.equal(s.cells['10']['Committed'], 5);
  assert.equal(s.cells['10'][NO_TRACK_LABEL], 3);
});

test('range filter drops sprints outside sprintOrder', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-9', 7, 'Committed', 99)], base);
  assert.deepEqual(s.sprints, ['10']);
  assert.equal(summarizeProjectTrackTotals(s).total, 5);
});

test('capacity side product/tech/both', () => {
  const tasks = [story('PROD-1', 5, 'Committed', 10),
                 story('TECH-1', 8, 'Committed', 10, { projectKey: 'TECH' })];
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, base)).total, 5);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, { ...base, capacitySide: 'tech' })).total, 8);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, { ...base, capacitySide: 'both' })).total, 13);
});

test('exclude toggles drop ad hoc / excluded epics', () => {
  const tasks = [story('PROD-1', 5, 'Committed', 10, { epicKey: 'AD-1' }),
                 story('PROD-2', 4, 'Committed', 10, { epicKey: 'EX-1' })];
  const adHoc = new Set(['AD-1']); const ex = new Set(['EX-1']);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeAdHoc: true })).total, 4);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeExcludedCapacity: true })).total, 5);
});

test('epic mode places whole epic SP in its dominant sprint (tie-break by range order)', () => {
  const tasks = [story('PROD-1', 2, 'Committed', 10, { epicKey: 'E1' }),
                 story('PROD-2', 6, 'Committed', 20, { epicKey: 'E1' })];
  const s = buildProjectTrackSprintSeries(tasks, { ...base, mode: 'epic' });
  assert.equal(s.cells['20']['Committed'], 8);
  assert.equal(s.cells['10'], undefined);
});

test('totals aggregate the whole range', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 10), story('PROD-2', 4, 'Committed', 20)], base);
  assert.equal(summarizeProjectTrackTotals(s).total, 9);
});

test('Team-mode breakdown rows are teams; Epic-mode rows are assignees counted once', () => {
  const teamRows = buildProjectTrackBreakdownRows(
    [story('PROD-1', 5, 'Committed', 10, { teamId: 'team-a' })], base, { teamLabels: { 'team-a': 'Alpha' } });
  assert.equal(teamRows.rows.find(r => r.label === 'Alpha').byTrack['Committed'], 5);
  const epicTasks = [story('S1', 2, 'Committed', 10, { epicKey: 'E1', assignee: 'Dana' }),
                     story('S2', 6, 'Committed', 20, { epicKey: 'E1', assignee: 'Dana' })];
  const epRows = buildProjectTrackBreakdownRows(epicTasks, { ...base, mode: 'epic' }, { teamLabels: {} });
  assert.equal(epRows.rows.find(r => r.label === 'Dana').byTrack['Committed'], 8);
});
```

- [ ] **Step 2.2: Run to confirm failure.** `node --test tests/test_project_track_stats.js`

- [ ] **Step 2.3: Implement `frontend/src/stats/projectTrackStats.js`** (sprint join by **id**, label map, range filter, dominant-sprint tie-break by `sprintOrder` index):

```js
import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { storyPointsFor } from './excludedCapacityStats.js'; // exported in Step 2.0
import { getProjectTrackRank } from '../eng/engTaskUtils.js';

export const NO_TRACK_LABEL = 'No track';

function firstSprint(task) {
  // A story belongs to one sprint; the normalized field is [{id,name,state}]. Take the first; key on id.
  const raw = task?.fields?.customfield_10101;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first == null) return null;
  if (typeof first === 'object') {
    const id = first.id != null ? String(first.id) : '';
    return id ? { id, name: first.name || id } : null;
  }
  const s = String(first); // legacy bare-string sprint
  return s ? { id: s, name: s } : null;
}
function trackOf(task) {
  const raw = task?.fields?.epicProjectTrack;
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v || NO_TRACK_LABEL;
}
export function inScope(task, opts) {
  const sprint = firstSprint(task);
  if (!sprint) return false;
  if (opts.allowedSprintIds && !opts.allowedSprintIds.has(sprint.id)) return false;
  const epicKey = String(task?.fields?.epicKey || '').trim().toUpperCase();
  if (opts.excludeExcludedCapacity && opts.excludedEpicSet?.has(epicKey)) return false;
  const cls = classifyCapacityIssue(task, { techProjectKeys: opts.techProjectKeys, adHocEpicSet: opts.adHocEpicSet });
  if (opts.excludeAdHoc && cls.capacityType === 'ad_hoc') return false;
  if (opts.capacitySide === 'both') return true;
  return opts.capacitySide === 'tech' ? cls.projectType === 'tech' : cls.projectType === 'product';
}
function withAllowed(opts) {
  return { ...opts, allowedSprintIds: Array.isArray(opts.sprintOrder) && opts.sprintOrder.length
    ? new Set(opts.sprintOrder) : null };
}
function orderTracks(set) {
  return Array.from(set).sort((a, b) => {
    if (a === NO_TRACK_LABEL) return 1;
    if (b === NO_TRACK_LABEL) return -1;
    const r = getProjectTrackRank(a) - getProjectTrackRank(b);
    return r !== 0 ? r : a.localeCompare(b);
  });
}

export function buildProjectTrackSprintSeries(tasks, rawOpts) {
  const opts = withAllowed(rawOpts);
  const orderIndex = new Map((opts.sprintOrder || []).map((id, i) => [id, i]));
  const idxOf = (id) => (orderIndex.has(id) ? orderIndex.get(id) : 1e9);
  const cells = {}; const trackSet = new Set(); const sprintLabels = {};
  const add = (id, name, track, pts) => {
    if (!cells[id]) cells[id] = {};
    cells[id][track] = (cells[id][track] || 0) + pts;
    trackSet.add(track); sprintLabels[id] = name;
  };
  const scoped = (tasks || []).filter((t) => inScope(t, opts) && storyPointsFor(t) > 0);
  if ((opts.mode || 'epic') === 'epic') {
    const byEpic = new Map();
    for (const task of scoped) {
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      const sprint = firstSprint(task);
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task), bySprint: new Map(), names: {} });
      const rec = byEpic.get(epicKey);
      rec.bySprint.set(sprint.id, (rec.bySprint.get(sprint.id) || 0) + storyPointsFor(task));
      rec.names[sprint.id] = sprint.name;
    }
    for (const { track, bySprint, names } of byEpic.values()) {
      let domId = null; let best = -1; let bestIdx = -1;
      for (const [id, pts] of bySprint) {
        const idx = idxOf(id);
        if (pts > best || (pts === best && idx > bestIdx)) { best = pts; domId = id; bestIdx = idx; }
      }
      if (domId == null) continue;
      add(domId, names[domId], track, Array.from(bySprint.values()).reduce((a, b) => a + b, 0));
    }
  } else {
    for (const task of scoped) {
      const sprint = firstSprint(task);
      add(sprint.id, sprint.name, trackOf(task), storyPointsFor(task));
    }
  }
  const sprints = Object.keys(cells).sort((a, b) => idxOf(a) - idxOf(b) || a.localeCompare(b));
  return { sprints, sprintLabels, tracks: orderTracks(trackSet), cells };
}

export function summarizeProjectTrackTotals(series) {
  const byTrack = {}; let total = 0;
  for (const s of series.sprints) {
    for (const [track, pts] of Object.entries(series.cells[s] || {})) {
      byTrack[track] = (byTrack[track] || 0) + pts; total += pts;
    }
  }
  return { byTrack, total };
}

export function buildProjectTrackBreakdownRows(tasks, rawOpts, { teamLabels = {} } = {}) {
  const opts = withAllowed(rawOpts);
  const trackSet = new Set(); const rowMap = new Map();
  const ensure = (id, label) => {
    if (!rowMap.has(id)) rowMap.set(id, { id, label, byTrack: {}, total: 0 });
    return rowMap.get(id);
  };
  const addRow = (row, track, pts) => { row.byTrack[track] = (row.byTrack[track] || 0) + pts; row.total += pts; trackSet.add(track); };
  const scoped = (tasks || []).filter((t) => inScope(t, opts) && storyPointsFor(t) > 0);
  if ((opts.mode || 'epic') === 'epic') {
    const byEpic = new Map();
    for (const task of scoped) {
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task),
        assignee: task?.fields?.epicAssignee?.displayName || 'Unassigned', total: 0 });
      byEpic.get(epicKey).total += storyPointsFor(task);
    }
    for (const { track, assignee, total } of byEpic.values()) addRow(ensure(assignee, assignee), track, total);
  } else {
    for (const task of scoped) {
      const teamId = task?.fields?.teamId || task?.fields?.teamName || 'unknown';
      const label = teamLabels[teamId] || task?.fields?.teamName || teamId;
      addRow(ensure(teamId, label), trackOf(task), storyPointsFor(task));
    }
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
  return { rows, tracks: orderTracks(trackSet) };
}
```

- [ ] **Step 2.4: Run tests → PASS.** `node --test tests/test_project_track_stats.js`
- [ ] **Step 2.5: Commit.** `git commit -m "feat(stats): add project-track by-sprint (id-keyed) + team/assignee aggregation helpers"`

## Task 3: Chart components + dashboard tab wiring (filter bar + SP sections)

**Files:**
- Create: `frontend/src/stats/StackedBar.jsx` — shared horizontal stacked-bar primitive (rows × dynamic segments), reusing the label-compaction + `clampReadoutPoint`/`resolveFloatingHoverPosition` logic that `EffortTypeSplitChart.jsx` currently inlines.
- Create: `frontend/src/stats/ProjectTrackTotalsBar.jsx`, `frontend/src/stats/ProjectTrackSprintChart.jsx`, `frontend/src/stats/ProjectTrackBreakdownChart.jsx`
- Modify: `frontend/src/stats/statsUtils.js` — add `resolveProjectTrackColor(track)` beside `resolveTeamColor`.
- Modify: `frontend/src/dashboard.jsx`
- Create: `frontend/src/styles/stats/project-track.css`; Modify: `frontend/src/styles/stats.css` (add `@import "./stats/project-track.css";`).
- Test: `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- Consumes Task 2 helpers; `resolveFloatingHoverPosition` from `frontend/src/ui/hoverBubblePosition.js` (NOT from the chart files); `SegmentedControl` from `frontend/src/ui/SegmentedControl.jsx`.
- Produces:
  - `<StackedBar rows={[{ id, label, segments:[{key,value}], total }]} segmentOrder={[keys]} resolveColor={fn} resolveLabel={fn} ariaLabel={...} />` — generic horizontal stacked bars with per-segment value labels + compact fallback + clamped readout. (Totals bar = a single row; Breakdown = N rows.)
  - `<ProjectTrackSprintChart series={series} resolveColor={fn} />` — vertical per-sprint stacked bars; x-axis labels from `series.sprintLabels[id]`; native-`<button>` legend; hover `{sprintLabel} — {track}: {n} SP`. No bar selection.
  - `resolveProjectTrackColor(track)` — categorical resolver: fixed colors for `Committed`/`Flexible`/`No track` chosen to harmonize with the existing stats palette, hash fallback for any other track value; returned color is what the dashboard passes as `resolveColor` to all four charts (single source of truth so a track is the same color everywhere).

- [ ] **Step 3.1: Extract the shared `StackedBar` primitive.** Pull the per-segment width math, the `FULL_SEGMENT_LABEL_MIN_WIDTH` compact-label rule, and the `clampReadoutPoint`/`resolveFloatingHoverPosition` readout out of `EffortTypeSplitChart.jsx` into `StackedBar.jsx` taking dynamic `segments` + `resolveColor`. Do NOT refactor `EffortTypeSplitChart` to consume it in this slice (avoid regressions to the Excluded Capacity tab) — leave a one-line comment noting the future consolidation. New horizontal bars (`ProjectTrackTotalsBar`, `ProjectTrackBreakdownChart`) render via `StackedBar`. `ProjectTrackTotalsBar` = single row from `summarizeProjectTrackTotals().byTrack` with `rangeLabel` beside it. `ProjectTrackBreakdownChart` = `data.rows` mapped to `StackedBar` rows (row total at the end).
- [ ] **Step 3.2: Implement `ProjectTrackSprintChart` + `resolveProjectTrackColor`.** Vertical chart modeled on `ExcludedCapacityLineChart.jsx` (sizing, Y ticks, native-button legend, `resolveFloatingHoverPosition`). Add `resolveProjectTrackColor(track)` to `statsUtils.js` (known-track map + hash fallback); `NO_TRACK_LABEL` → neutral grey (`#94a3b8`, matching `resolveTeamColor`'s fallback).

- [ ] **Step 3.3: Wire the tab in `dashboard.jsx`.**
  1. Add `'projectTrack'` to `resolveStatsView` (~668), `isStatsSourceOnlyStatsView` (~727), the load-gate early-return (~7050), and `canRenderStatsPanel` (~10238); add `{ value: 'projectTrack', label: 'Project Track' }` to the dropdown options (~13050-13056); **and add `projectTrack` to the `StatsDeliverySummary` render guard at ~13060** (`statsView !== 'cohort' && !== 'excludedCapacity' && !== 'monoCrossShare'`) so the delivery-rate header does not render above the new tab.
  2. Add a `stats-view` block `className={`stats-view ${statsView === 'projectTrack' ? 'open' : ''}`}` immediately after the monoCrossShare block (closes ~13450).
  3. **Filter bar on top** (`.stats-controls` row): the EXISTING Start/End sprint `<select>`s (reuse `excludedCapacityStartSprintId`/`excludedCapacityEndSprintId` state + `excludedCapacitySprintOptions` markup at ~13185-13208 — shared state, no new selectors); a `<SegmentedControl>` for Capacity side (`product`/`tech`/`both`, default `product`); two `<input type=checkbox>` exclusion toggles inside `.stats-control-group`; a `<SegmentedControl>` for Mode (`epic`/`team`, default `epic`) — labelled "Mode", never "Metric".
  4. **Mode title heading** directly under the filter bar: render `EPIC MODE` / `TEAM MODE` (new `.project-track-mode-title` class).
  5. `sprintOrder = excludedCapacitySprintRange.map(s => String(s.id))` (ids, ordered). No selected-sprint state.
  6. New state via the **`savedPrefsRef` + `saveUiPrefs`** mechanism (localStorage; init from `savedPrefsRef.current.projectTrack*` near ~702, add the keys to the central `saveUiPrefs({...})` call ~5290): `projectTrackCapacitySide` ('product'), `projectTrackMode` ('epic'), `projectTrackExcludeAdHoc` (false), `projectTrackExcludeExcludedCapacity` (false).
  7. Memoize from the already-loaded `excludedCapacityIssues` (`dashboard.jsx:~7198`; no new fetch): `series = buildProjectTrackSprintSeries(excludedCapacityIssues, opts)`, `breakdown = buildProjectTrackBreakdownRows(excludedCapacityIssues, opts, { teamLabels: activeGroupTeamLabels })`, `totals = summarizeProjectTrackTotals(series)`, where `opts = { capacitySide, mode, excludeAdHoc, excludeExcludedCapacity, techProjectKeys, adHocEpicSet, excludedEpicSet, sprintOrder }`.
  8. Render in order: mode title; `<ProjectTrackTotalsBar byTrack={totals.byTrack} tracks={series.tracks} resolveColor={resolveProjectTrackColor} rangeLabel={…} />`; `<ProjectTrackSprintChart series={series} resolveColor={resolveProjectTrackColor} />` (with the Epic-mode caption from Decision 8); `<ProjectTrackBreakdownChart data={breakdown} resolveColor={resolveProjectTrackColor} />` under a "By assignee" (Epic) / "By team" (Team) heading. (Time-in-phase — Epic mode only — added in Task 5.)

- [ ] **Step 3.4: CSS.** Create `frontend/src/styles/stats/project-track.css` and register `@import "./stats/project-track.css";` in `frontend/src/styles/stats.css`. Reuse `.stats-controls`, `.stats-control-group`, `.stats-summary`, `.stats-card`, `.stats-view(.open)` (shell.css) and the `--effort-color` segment pattern; add only genuinely-new classes (`.project-track-mode-title`, totals/sprint containers, inline segment-label styles). No inline styles in `jira-dashboard.html`. Do NOT add `position: sticky` (preserve the existing sticky stack); if any control dropdown is used, mirror the existing `--sticky-control-overlay-z` lift per the `.filters-strip` learning.
- [ ] **Step 3.5: Build.** `npm run build` → clean; commit generated `frontend/dist` if `verify-frontend-build.yml` requires it.
- [ ] **Step 3.6: Playwright smoke + screenshot.** Open ENG → Stats → `Project Track`; assert filter bar, mode title (`EPIC MODE` default), totals bar (with segment value labels), per-sprint chart, and breakdown chart render; toggle `Tech` then `Tech + Product`, asserting charts update; switch Mode to `Team`, assert title flips to `TEAM MODE` and heading switches to "By team"; screenshot (animations settled). Assert legend buttons are real `<button>` and any dropdown panel is clickable with a normal (non-forced) click. `npx playwright test tests/ui/codebase_structure_smoke.spec.js`
- [ ] **Step 3.7: Commit.** `git commit -m "feat(stats): add Project Track tab (StackedBar, totals, per-sprint, breakdown)"`

## Task 4: Backend — epic Project Track phase-duration endpoint

**Files:**
- Modify: `backend/routes/stats_routes.py` — register the route delegator.
- Modify: `backend/security/policy.py` — add the `EndpointPolicy` (REQUIRED; without it the route returns 501 `route_not_oauth_ready` in OAuth mode per `backend/security/guards.py:191-195`).
- Modify: `jira_server.py` — handler + NEW transition parser + bounded changelog fetch. Mirror the cohort's `ThreadPoolExecutor(max_workers=...)` + `context=` worker-auth pattern (`fetch_epic_cohort_data`/`_cohort_fetch_terminal_date_from_changelog` ~4805-4927) and add new constants `PROJECT_TRACK_PHASE_MAX_EPICS` / `PROJECT_TRACK_PHASE_WORKERS` / `PROJECT_TRACK_PHASE_TIMEOUT_SECONDS` (align magnitudes with `EPIC_COHORT_ENRICH_MAX_ISSUES`/`_WORKERS`/`_TIMEOUT_SECONDS`).
- Create: `tests/test_project_track_phase_api.py`; Modify: `tests/test_oauth_stats_routes.py`.

**Interfaces:**
- `POST /api/stats/project-track-phase-durations` per the Endpoint Contract; null/blank state label = `null (no value)`.
- Pure `compute_track_phase_durations(created_iso, current_value, transitions, now)` so the math is unit-testable without Jira.
- New `parse_track_transitions(histories, track_field_id)` matching items by `fieldId == track_field_id` OR `field` display-name == 'project track' (the `is_team_history_item` dual-check pattern, `jira_server.py:4446-4453`) — this is NEW code; `resolve_terminal_date_from_history` matches `'status'` and returns a single date, so it is structural inspiration only, not reused.

- [ ] **Step 4.1: Write failing tests** (synthetic data only; use the real datetime parser `parse_jira_datetime`):

```python
from jira_server import compute_track_phase_durations, parse_jira_datetime, parse_track_transitions

def test_durations_initial_null_then_single_transition(self):
    out = compute_track_phase_durations(
        '2026-03-26T13:29:50.324+0000', 'Flexible',
        [{'date': '2026-06-25T00:00:00.000+0000', 'from': None, 'to': 'Flexible'}],
        parse_jira_datetime('2026-06-30T00:00:00.000+0000'))
    self.assertAlmostEqual(out['null (no value)'], 91.0, delta=1.0)
    self.assertAlmostEqual(out['Flexible'], 5.0, delta=1.0)

def test_parser_matches_fieldid_not_status_lookalike(self):
    histories = [
        {'created': '2026-06-25T00:00:00.000+0000', 'items': [
            {'fieldId': 'customfield_35024', 'field': 'Project Track', 'fromString': None, 'toString': 'Flexible'},
            {'fieldId': 'status', 'field': 'status', 'fromString': 'To Do', 'toString': 'Flexible'}]}]
    tx = parse_track_transitions(histories, 'customfield_35024')
    self.assertEqual([(t['from'], t['to']) for t in tx], [(None, 'Flexible')])  # status look-alike ignored
# plus: route caps epicKeys at PROJECT_TRACK_PHASE_MAX_EPICS -> meta.truncated True, processedEpicCount == cap
# plus: a fixture where changelog.total > len(histories) exercises the /changelog pagination branch
```

- [ ] **Step 4.2: Run to confirm failure.** `.venv/bin/python -m unittest tests.test_project_track_phase_api -v`
- [ ] **Step 4.3: Implement `compute_track_phase_durations` + `parse_track_transitions`.** Parser: iterate `histories` (asc by `created`), keep items where `item.get('fieldId') == track_field_id or str(item.get('field','')).strip().lower() == 'project track'`, emit `{date, from: fromString, to: toString}`. Durations: start = `created` with initial value = first transition's `from` (else `current_value`); each transition's `to`; final phase → `now`. Sum days per state label; null/blank → `null (no value)`.
- [ ] **Step 4.4: Implement bounded fetch + route + policy.**
  - Resolve field id via `get_project_track_field_id()` (no wrapper).
  - Cap `epicKeys` at `PROJECT_TRACK_PHASE_MAX_EPICS`; bounded `ThreadPoolExecutor(max_workers=PROJECT_TRACK_PHASE_WORKERS)`; each worker calls `current_jira_get(f'/rest/api/3/issue/{key}', params={'expand': 'changelog', 'fields': f'created,summary,{track_field}'}, timeout=PROJECT_TRACK_PHASE_TIMEOUT_SECONDS, context=context)` — `params=` dict, NOT a query string in the path; capture the `RequestAuthContext` BEFORE submitting and pass it as `context=` into every worker (cohort pattern).
  - If `changelog.total > len(histories)`, page `GET /rest/api/3/issue/{key}/changelog` to collect the rest before parsing.
  - Set `meta.truncated=True` + `processedEpicCount` when the cap drops epics; log the dropped count only (no epic keys / no PII).
  - Register the delegator in `backend/routes/stats_routes.py` and add `EndpointPolicy("stats-project-track-phase", "/api/stats/project-track-phase-durations", frozenset({"POST"}), "authenticated_read")` to `backend/security/policy.py`. `authenticated_read` is NOT in `CSRF_POLICY_CLASSES`, so the route requires the OAuth session + `X-Requested-With` header but NO `X-CSRF-Token`.
- [ ] **Step 4.5: Run focused + full suite → PASS.** `.venv/bin/python -m unittest tests.test_project_track_phase_api tests.test_oauth_stats_routes && .venv/bin/python -m unittest discover -s tests` (the OAuth route test must assert the route is reachable with `X-Requested-With` in OAuth mode — i.e. NOT 501).
- [ ] **Step 4.6: Commit.** `git commit -m "feat(stats): add bounded epic Project Track phase-duration endpoint"`

## Task 5: Frontend — time-in-phase section (Epic mode only)

**Files:**
- Create: `frontend/src/stats/projectTrackPhaseStats.js`, `frontend/src/stats/ProjectTrackPhaseChart.jsx`, `tests/test_project_track_phase_stats.js`
- Modify: `frontend/src/api/engApi.js`, `frontend/src/dashboard.jsx`, `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- `fetchProjectTrackPhaseDurations(backendUrl, { epicKeys, refresh, signal })`; `summarizeTrackPhaseDurations(rows) -> { byState, avgDaysToFirstTrack, avgDaysToCommitted }`; `<ProjectTrackPhaseChart rows={rows} resolveColor={fn} />`.

- [ ] **Step 5.1: Failing test** for `summarizeTrackPhaseDurations` (sum `byState`; `avgDaysToCommitted` ignores epics that never reached Committed). `tests/test_project_track_phase_stats.js`
- [ ] **Step 5.2: Implement `projectTrackPhaseStats.js`; run → PASS.** `node --test tests/test_project_track_phase_stats.js`
- [ ] **Step 5.3: Add API helper** `fetchProjectTrackPhaseDurations` to `frontend/src/api/engApi.js`, mirroring `fetchExcludedCapacityStatsSource` (POST, `X-Requested-With`, abort signal).
- [ ] **Step 5.4: Chart + wire the section (Epic mode only).** `ProjectTrackPhaseChart.jsx`: render via the shared `StackedBar` primitive (Task 3) — one row per epic, segments = state, width = days, **each segment value-labelled in days**, ordered by total age desc, colors via `resolveProjectTrackColor` mapped over states; hover `{epicKey} — {state}: {days}d`. In `dashboard.jsx`: render this section **only when `projectTrackMode === 'epic'`**. Derive the in-scope epic set by reusing the SAME `inScope(task, opts)` predicate from `projectTrackStats.js` over `excludedCapacityIssues` (so it respects exclusions AND capacity side AND sprint range — not just exclusions): `epicKeys = unique(excludedCapacityIssues.filter(t => inScope(t, opts)).map(t => t.fields.epicKey))`. If non-empty, lazily call `fetchProjectTrackPhaseDurations` once per epic-key-set signature (cache by signature; abort in-flight on signature change); render `<ProjectTrackPhaseChart>` plus a small summary (avg days-to-first-track, avg days-to-Committed) and a `meta.truncated` notice when capped. Do not block the SP sections on this fetch; do not fetch phases in Team mode.
- [ ] **Step 5.5: Build, smoke, commit.** `npm run build && npx playwright test tests/ui/codebase_structure_smoke.spec.js`; UI smoke asserts the time-in-phase section renders in Epic mode for a scoped group and is absent in Team mode; screenshot. `git commit -m "feat(stats): add epic time-in-Project-Track-phase section"`

## Task 6: Analytics, docs, structure budgets, full verification

**Files:** `frontend/src/analytics/events.js`, `tests/test_analytics_events.js`, `docs/README_ANALYTICS.md`, `README.md`, `tests/test_codebase_structure_budgets.py`, `docs/plans/README.md`

- [x] **Step 6.1: Register params + wire analytics.** `mode` and `capacity_side` are NOT yet in `EVENT_PARAMS` (`frontend/src/analytics/events.js`) — add both (values `epic`/`team`, `product`/`tech`/`both` all pass `SAFE_STRING`). `section` and `series_type` already exist. Emit tab-open and filter/section toggles via `stats_action` / `chart_action` / `filter_changed` with bucketed params (`capacity_side`, `mode`, exclusion booleans, `section`, track `series_type` tokens). No raw epic keys, summaries, team/group names, issue keys, assignee names, or durations. Update `tests/test_analytics_events.js` for the two new params; document trigger/type/`event_name`/`feature_name`/typed params/privacy reason in `docs/README_ANALYTICS.md`.
- [x] **Step 6.2: User docs.** Add a `README.md` entry: filter bar (start/end sprint, Product/Tech/Tech+Product, exclude ad hoc, exclude excluded-capacity, Mode: Epic/Team), the EPIC/TEAM mode title, range totals bar, per-sprint chart, assignee/team breakdown, and the Epic-mode-only time-in-phase section.
- [x] **Step 6.3: Ratchet structure budgets + run guards.** `tests/test_codebase_structure_budgets.py` `LEGACY_ENTRYPOINT_LINE_BUDGETS` has near-zero headroom (`jira_server.py` budget == current 5969; `frontend/src/dashboard.jsx` 15419 vs ~15409). After implementation, set each budget to the new actual line count (keep `dashboard.jsx` growth minimal — logic lives in the new modules, not the tab block). Run `node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js && .venv/bin/python -m unittest tests.test_codebase_structure_budgets` → PASS; record the new budget numbers in the commit.
- [ ] **Step 6.4: Full pre-push verification.**

```bash
.venv/bin/python -m unittest discover -s tests
node --test tests/test_project_track_stats.js tests/test_project_track_phase_stats.js tests/test_excluded_capacity_stats.js
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js
.venv/bin/python jira_server.py   # then curl http://localhost:5050/api/test, confirm clean startup banner, stop
```

Expected: full Python suite PASS (incl. `tests.test_project_track_phase_api`, `tests.test_excluded_capacity_stats_api`, `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`), Node PASS, clean build, UI smoke PASS, server starts with no pre-banner warnings and `/api/test` OK.

- [ ] **Step 6.5: Update plan index + commit.** Add to `docs/plans/README.md`. `git commit -m "docs(stats): document Project Track by sprint tab and analytics"`

## Acceptance Criteria

- A `Project Track` stats sub-tab appears after `Mono vs Cross`; its SP sections load from the cached progressive stats-source (no ENG alerts/filters/task list) without a second scoped fetch.
- A filter bar on top of the tab exposes Start sprint, End sprint, Capacity side (Product default / Tech / Tech + Product), Exclude Ad Hoc, Exclude excluded-capacity, and **Mode (Epic default / Team)** — never labelled "Metric"/"Story points"/"Epics"; all are visible, selectable, and re-derive every section.
- A mode title (`EPIC MODE` / `TEAM MODE`) renders directly under the filter bar.
- The top totals bar is a single horizontal bar of SP by track (incl. `No track`) aggregated over the **whole selected sprint range**, with a value label (number) on each segment.
- The per-sprint chart shows one vertical stacked bar per sprint in range, split by Project Track.
- Mode switches unit AND breakdown dimension: `Epic` (default) → epic-granularity SP (epic in its dominant sprint), per-**assignee** breakdown; `Team` → story-granularity SP, per-**team** breakdown. Project Track is inherited epic→story throughout.
- The breakdown chart shows one horizontal stacked bar per assignee/team, split by track, over the selected range, each segment value-labelled, with a "By assignee"/"By team" heading.
- The time-in-phase section renders **only in Epic mode**: per in-scope epic, days in each Project Track state (`null (no value)` → `Flexible` → `Committed`) from Jira changelog with per-segment day labels, plus an aggregate summary; the backend fetch is bounded and flags `meta.truncated` without silently dropping epics.
- Backend stats-source stories carry `epicProjectTrack`/`epicAssignee` additively (field id via `get_project_track_field_id()`, internally `ConfigStorageError`-safe); the new `POST /api/stats/project-track-phase-durations` is read-only and registered in `backend/security/policy.py`; Excluded Capacity and Mono vs Cross tabs are unchanged.
- Full Python suite, Node tests, `npm run build`, server `/api/test`, and UI smoke pass; analytics use bucketed params with no raw Jira identifiers or durations; structure budgets pass (ratcheted only if legitimately grown).

## Outcome

Implemented with changes. The implementation is now the source of truth for the items below; this plan's prose describes intent and is otherwise accurate.

Divergences from the original plan text:

- **Sprint identity is id-keyed, not name-keyed**, exactly as the Pre-Implementation Validation section anticipated (no divergence there, but called out again because several plan-adjacent docs still say "sprint name").
- **`POST /api/stats/project-track-phase-durations` response shape differs from the Endpoint Contract table's original text.** As-built: `{ epics: [{ key, summary, currentValue, durations: { "<state>": days }, created, transitions: [{ date, from, to }] }], meta: { truncated, processedEpicCount, warnings } }`. There is **no** `cached`/`generatedAt` — the route is stateless per request; the frontend caches the response per epic-key-set signature (`projectTrackPhaseCacheRef`, keyed by `projectTrackPhaseSignature = epicKeys.sort().join(',')`) instead of relying on a server cache. Field names are `epics` (not `data`), `key` (not `epicKey`), `currentValue` (not `currentTrack`), `durations` (not `durationsDays`); `meta` has no `requestedEpicCount`. The Endpoint Contract table above has been corrected in place to match.
- **The null/no-value Project Track state label is `No track`** (`NO_TRACK_LABEL` in `frontend/src/stats/projectTrackStats.js`), reused by the phase-duration summary — not the plan's placeholder `null (no value)` wording.
- **Per-task structure-budget ratchets**, each with an inline comment in `tests/test_codebase_structure_budgets.py` naming the branch/feature and the lines added: epic-track+assignee enrichment, the phase-duration endpoint, a changelog-pagination-boundary dedup fix, exposing `created`/`transitions` on phase records, the Project Track tab wiring, the time-in-phase section, and this task's analytics wiring (`jira_server.py` stayed at 6188; `frontend/src/dashboard.jsx` ratcheted stepwise to 15729).
- **A post-implementation UI-polish wave** (commit `af0863d` and preceding commits on this branch) refined the shipped tab beyond the original task list: hid the per-sprint chart when the range is a single sprint, gave the `No track` phase segment a fixed color via the shared `resolveProjectTrackColor` resolver (not a hash-assigned color), made phase-chart epic titles clickable Jira links, and resolved real team display names for the Team-mode breakdown instead of raw team ids.
- **MRT020 rebuild of the filter bar's exclusion controls.** The first exclusions implementation reinvented bespoke controls instead of reusing existing `.stats-control-group`/checkbox patterns; see `postmortem/MRT020-project-track-filter-bar-bespoke-controls.md` (commits `526d3e6`, `ea08194`, `93541f4`) for the postmortem and fix. The exclusion checkboxes now reuse the established inline-checkbox pattern.
- **Analytics wiring landed in Task 6, not earlier**, as planned: `mode` and `capacity_side` were added to `EVENT_PARAMS` and wired onto the Capacity side `SegmentedControl` (`chart_action`), Mode `SegmentedControl` (`stats_action`), and the two exclusion checkboxes (`filter_changed`) — mirroring the Excluded Capacity tab's existing `chart_action`/`stats_action` pattern. Tab-open tracking required no new code; the existing stats-view `SegmentedControl` already fires `stats_action` with `workflow_action: 'view_change'` for every `statsView` value, including `projectTrack`. Per the plan's Decision 12, no per-segment/legend/hover chart analytics were added — see `docs/README_ANALYTICS.md`'s No-Event Allowlist for the documented reason.

## Current Accuracy

Accurate as of this task's completion. The Endpoint Contract table, acceptance criteria, and file map match the shipped code. If a future change alters the phase-duration response shape, the sprint-bucketing approach, or the analytics param set, update this section (or mark the plan obsolete) rather than leaving this note stale.
