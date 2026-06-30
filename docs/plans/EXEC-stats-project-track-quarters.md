# Stats: Project Track by Quarter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL when available: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Goal:** Add a new ENG stats sub-tab that shows story points by Project Track. It has three sections: (1) a quarters stacked-bar chart of total SP split by Project Track; (2) a per-team (Story points mode) / per-assignee (Epics mode) stacked-bar breakdown split by Project Track; and (3) a time-in-phase section showing how long each in-scope epic spent in each Project Track state (null → Flexible → Committed), from Jira changelog. A Product/Tech capacity toggle (Product default), Ad Hoc / Excluded-Capacity exclusion toggles, a story-points-vs-epics metric toggle, and the existing Start/End sprint range selectors drive the SP sections.

**Architecture:** Reuse the existing progressive, per-sprint-cached `/api/stats/excluded-capacity-source` endpoint as the single scoped issue source for the SP sections. Extend its cached epic enrichment to also carry each story's parent-epic `projectTrack` and epic assignee (additive fields only). Project Track is inherited from each epic down to its stories. The time-in-phase section adds one new read-only endpoint that does a **bounded** per-epic `expand=changelog` fetch over the in-scope epic keys and reconstructs Project Track state intervals, reusing the cohort path's staged fan-out + changelog-parsing helpers. Add pure frontend aggregation modules and SVG chart components, wired into a new `statsView === 'projectTrack'` sub-tab in `dashboard.jsx` modeled on the Excluded Capacity tab. No per-issue frontend fan-out.

**Tech Stack:** Python 3.10+ Flask (`jira_server.py`, `backend/routes/stats_routes.py`), existing stats-source path and epic-meta cache, existing changelog helpers (`resolve_terminal_date_from_history`-style parsing, cohort staged changelog fetch), React 19, existing stats helper/chart modules, shared capacity classifier (`frontend/src/capacityClassification.mjs`), Python `unittest`, Node `--test`, Playwright UI tests, esbuild (`npm run build`).

**Feasibility note (verified live):** A Basic-auth probe of epic `TECH-27221` returned `created 2026-03-26`, current track `Flexible`, changelog `total=7` (not truncated), with one Project Track transition `2026-06-25 null → Flexible` → 91.1 days in null, 4.8 days in Flexible. Confirms `customfield_35024` transitions carry `fromString`/`toString` + `created`, and that typical epics fit one `expand=changelog` response (truncation still handled defensively).

## Global Constraints

- Plans and implementation live under repo-relative paths; never commit secrets, real Jira keys, personal emails, or local absolute paths. Use synthetic fixtures only (`AGENTS.md` §6, repo-specific constraints).
- This is a read-oriented stats surface for normal users. No mutation routes, no Jira/Home write paths.
- Project Track is an existing Jira custom field. Default field id `PROJECT_TRACK_FIELD_DEFAULT = 'customfield_35024'`; always resolve via `get_project_track_field_id()` so a `dashboard-config.json` override wins. Config-reading getters invoked from no-request-context helpers must catch `ConfigStorageError` and fall back to the default id in DB mode (`AGENTS.md` Project Learnings).
- Reuse the existing stats-source contract: Jira pagination is `nextPageToken`/`isLast`; the endpoint loads one sprint per request and merges progressively. Do not add a second scoped fetch or per-issue enrichment fan-out.
- Reuse the existing shared capacity classifier `classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet })` for Product/Tech/Ad Hoc; do not re-derive Product/Tech from `task.key.startsWith('TECH-')`.
- Reuse `getSprintQuarterLabel(sprint)` (`frontend/src/stats/excludedCapacityStats.js:175`, returns `"YYYY QN"`) for quarter labels; do not invent a second quarter mapper.
- Run the FULL Python suite (incl. `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`) and the full Node suite as the baseline and before claiming done; ratchet structure budgets only when these entrypoints legitimately grow.
- Analytics must reuse existing `stats_action` / `chart_action` / `filter_changed` event contracts with bucketed, typed params only — no raw epic keys, summaries, team/group names, issue keys, or assignee names. App-owned analytics keep the two-trigger GTM dataLayer contract; no new custom dimensions unless explicitly required.

---

## Status

Planned. Not started. All work belongs on branch `feature/stats-project-track-quarters`. Rename to `DONE-*` only after implementation is complete, verified, and accepted/merged, per `docs/plans/AGENTS.md`.

## Product Decisions

1. **New stats sub-tab.** Add `statsView` value `'projectTrack'`, dropdown label `Project Track`, placed after `Mono vs Cross` in the stats-view selector. It is a stats-source-only view (`isStatsSourceOnlyStatsView`), so it reuses the cached progressive fetch and does not load ENG alerts, filters, or the task list.
2. **Capacity-side toggle (Product default).** A two-option toggle, `Product` (default) and `Tech`, filters the scoped stories to one capacity side using `classifyCapacityIssue`. `Product` includes Ad Hoc stories (Ad Hoc is Product capacity); `Tech` is Tech-project stories. The chart then splits the selected side by Project Track.
3. **Project Track split + null.** Bars are split by the parent epic's `projectTrack` string value. Stories whose epic has no track (null/blank) go to a single `No track` segment. Existing track values are not hardcoded; the track set is derived from the data, ordered by `getProjectTrackRank` then alphabetically, with `No track` always last.
4. **Exclusion toggles.** Two independent include/exclude toggles: `Exclude Ad Hoc` and `Exclude excluded-capacity epics`, both default OFF (included). They use the active group's `adHocCapacityEpics` and `excludedCapacityEpics` sets already wired in `dashboard.jsx`. Excluding a set drops those stories from both the chart and the summary panels.
5. **Project Track inherited to stories.** Project Track is an epic-level field; each story inherits its parent epic's `projectTrack` (via the enriched `epicProjectTrack`). All SP grouping by track uses this inherited value.
6. **Metric toggle drives granularity AND breakdown dimension.** `Story points` (default): aggregate at story granularity; the breakdown rows are **teams** (from the active department/group config). Each story contributes its SP to its team and its epic's track, and (for the quarters chart) to its sprint's quarter. `Epics`: aggregate at epic granularity — each in-scope epic contributes the sum of its in-scope stories' SP, grouped by the epic's track and attributed to the **epic assignee** (`epicAssignee`); the breakdown rows are assignees. For the quarters chart in Epics mode, each epic's total SP is placed in its **dominant quarter** (the quarter holding the largest share of that epic's in-scope story SP; ties → latest quarter).
7. **Three sections in the tab.** (a) Quarters chart: x = quarters, vertical bars stacked by Project Track (total SP). (b) Breakdown chart: one horizontal stacked bar per team (SP mode) or per assignee (Epics mode), segments = Project Track, aggregated over the selected range. (c) Time-in-phase section (see Decision 10). The `No track` segment is always present for null/blank tracks and rendered last.
8. **Team is the scope and the SP-mode breakdown dimension.** The selected group's team ids scope which stories are counted (identical to the Excluded Capacity tab). Team names come from `activeGroup.teamLabels` / story `teamName`/`teamId`.
9. **Quarter range via existing selectors.** The selected range uses the same Start/End sprint selectors the Excluded Capacity tab already uses; quarters are derived from the sprints in range. The breakdown and time-in-phase sections aggregate over the whole selected range. No separate quarter dropdown.
10. **Time-in-phase (changelog) section.** For the in-scope epics (distinct `epicKey`s from the loaded stats-source stories, after exclusion toggles), fetch each epic's Project Track change history and compute days spent in each state (`null (no value)`, `Flexible`, `Committed`, plus any other observed value). Render one horizontal stacked bar per epic (segments = state, width = days), ordered by total age, with an aggregate summary (e.g. average days-to-first-track and average days-to-Committed). Date granularity only (no minutes), matching the verified probe.
11. **Bounded fan-out for changelog.** The new changelog endpoint caps the number of epics per request and bounds concurrency, reusing the cohort path's staged-fetch pattern. It logs (via `log`/response meta) when the epic set is truncated; it never silently drops epics. Truncated single-issue changelogs (`total > len(histories)`) fall back to the paginated changelog endpoint for that epic.
12. **Backend change is additive for stories; one new read-only endpoint for phases.** Story enrichment attaches `epicProjectTrack` (string | null) and `epicAssignee` (`{ displayName } | null`) additively. The time-in-phase data comes from a new `POST /api/stats/project-track-phase-durations` read-only route (no Jira writes).
13. **Analytics reuse.** Tab open and control toggles reuse existing `stats_action` / `chart_action` / `filter_changed` events with bucketed params (`series_type`, `metric`, `capacity_side`, exclusion booleans). No raw epic keys, assignee names, or durations in analytics payloads. No new GA4 custom dimension unless review finds one strictly required.

## Affected Surfaces

| Surface | Current behavior | Required behavior |
| --- | --- | --- |
| Stats view selector (`frontend/src/dashboard.jsx` ~668, ~13048-13056) | `resolveStatsView` allows `teams/priority/burnout/cohort/excludedCapacity/monoCrossShare`; dropdown lists those. | Add `projectTrack` to `resolveStatsView` and a `{ value: 'projectTrack', label: 'Project Track' }` dropdown option after Mono vs Cross. |
| Stats-source load gate (`dashboard.jsx:727`, ~7050-7054) | `isStatsSourceOnlyStatsView` true for `excludedCapacity`/`monoCrossShare`; load effect runs for those. | Include `projectTrack` so the cached progressive source fetch runs and ENG alerts/filters/task list stay unloaded. |
| Stats panel render gate (`dashboard.jsx:10238`) | `canRenderStatsPanel` includes the stats-source views. | Include `projectTrack`. |
| Stats-source story payload (`jira_server.py:5082-5141`, `5151-5199`, `5343-5348`) | Story carries `epicKey`/`epicSummary`; epic enrichment fetches only `summary`. | Additionally carry `epicProjectTrack` and `epicAssignee`; epic enrichment fetches `summary` + project-track field + `assignee`. |
| Stats routes (`backend/routes/stats_routes.py`) | Registers `/api/stats/*` POSTs (excluded-capacity-source, epic-cohort, burnout, …). | Register new `POST /api/stats/project-track-phase-durations` delegating to a `jira_server.py` handler, same auth/`X-Requested-With` policy as siblings. |
| Excluded Capacity / Mono vs Cross tabs | Unchanged. | Unchanged — no regression. Reused helpers (`storyPointsFor`, `getSprintQuarterLabel`, classifier) keep current behavior. |

## Endpoint Contract

| Route | Auth | CSRF | Request | Success | Errors / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/stats/excluded-capacity-source` | Existing authenticated read (OAuth Jira REST / basic per mode) | Existing `X-Requested-With: jira-execution-planner` behavior | Existing `{ sprintIds, teamIds, refresh? }` (one sprint per request) | Existing `{ cached, generatedAt, data, meta }`; each story in `data` now additionally includes `fields.epicProjectTrack` (string | null) and `fields.epicAssignee` ({ displayName } | null). | No request/response shape removals. Existing consumers ignore the new fields. Server-Timing token `epic-summaries` continues to cover the (now richer) epic fetch. Epic enrichment stays a single cached bulk fetch keyed by epic key + auth context; no per-issue fan-out. |
| `POST /api/stats/project-track-phase-durations` (new) | Same authenticated read as other `/api/stats/*` routes (OAuth Jira REST / basic per mode) | Same `X-Requested-With: jira-execution-planner` requirement as sibling stats POSTs | `{ epicKeys: string[], refresh?: boolean }` — caller passes the in-scope epic keys (capped server-side) | `{ cached, generatedAt, data: [{ epicKey, summary, created, currentTrack, transitions: [{ date, from, to }], durationsDays: { "<state>": number } }], meta: { requestedEpicCount, processedEpicCount, truncated } }` | Read-only; never mutates Jira. Caps `epicKeys` (e.g. ≤ a documented MAX) and bounds changelog concurrency, reusing the cohort staged-fetch pattern. On per-epic single-changelog truncation (`total > len(histories)`), falls back to the paginated changelog endpoint for that epic. `meta.truncated=true` when the cap drops epics. Cache key includes the normalized epic-key set + auth context. No token material, raw assignee, or PII in logs. |

New story `fields` shape (additive keys shown):

```json
{
  "epicKey": "PROD-12",
  "epicSummary": "Checkout revamp",
  "epicProjectTrack": "Committed",
  "epicAssignee": { "displayName": "Synthetic Owner" },
  "customfield_10004": 5,
  "teamId": "team-a",
  "customfield_10101": [{ "name": "2026Q2" }]
}
```

## File Map

- Modify: `jira_server.py` — extend `fetch_cached_excluded_capacity_epic_summaries` to fetch + cache `projectTrack` and `assignee`, return a per-key meta dict; extend `build_excluded_capacity_issue_payload` to attach `epicProjectTrack` and `epicAssignee`. Resolve the field id via `get_project_track_field_id()` wrapped in a `ConfigStorageError` fallback for no-request-context.
- Modify: `tests/test_excluded_capacity_stats_api.py` — assert the enriched story payload includes `epicProjectTrack` and `epicAssignee`, including null-track and missing-assignee cases, and that the epic fetch requests the project-track field.
- Create: `frontend/src/stats/projectTrackStats.js` — pure aggregation: `buildProjectTrackQuarterSeries(...)`, `summarizeProjectTrackTotals(...)`, and `buildProjectTrackBreakdownRows(...)` (per-team in SP mode, per-assignee in Epics mode).
- Create: `tests/test_project_track_stats.js` — Node `--test` coverage for capacity-side filtering, exclusion toggles, null-track bucketing, story vs epic metric, dominant-quarter placement, range totals, and per-team / per-assignee breakdown rows.
- Create: `frontend/src/stats/ProjectTrackQuarterChart.jsx` — SVG vertical stacked-bar chart (quarters × track), reusing shared color resolver, legend button pattern, and `resolveFloatingHoverPosition` hover readout.
- Create: `frontend/src/stats/ProjectTrackBreakdownChart.jsx` — horizontal per-row (team/assignee) stacked-bar chart split by track; model on `EffortTypeSplitChart.jsx` grammar (rows, segments, legend, clamped readout).
- Create: `frontend/src/stats/projectTrackPhaseStats.js` — pure helper `summarizeTrackPhaseDurations(rows)` (totals/averages) and ordering for the time-in-phase bars; keep all changelog fetching server-side.
- Create: `frontend/src/stats/ProjectTrackPhaseChart.jsx` — horizontal per-epic stacked-bar chart (segments = track state, width = days), reusing shared chart helpers.
- Create: `tests/test_project_track_phase_stats.js` — Node `--test` coverage for duration math (initial null phase from `created` to first transition, mid phases, open final phase to now) and aggregate summary, mirroring the verified TECH-27221 shape.
- Modify: `frontend/src/api/engApi.js` (or the stats API module the tab uses) — add `fetchProjectTrackPhaseDurations(backendUrl, { epicKeys, refresh, signal })` POSTing with the `X-Requested-With` header, mirroring `fetchExcludedCapacityStatsSource`.
- Create: `backend/routes/stats_routes.py` route `POST /api/stats/project-track-phase-durations` delegating to a `jira_server.py` handler; add the changelog-parsing + bounded-fetch implementation in `jira_server.py` reusing cohort staged-fetch + history helpers.
- Modify: `tests/test_oauth_stats_routes.py` and a new/existing `tests/test_project_track_phase_api.py` — route auth/CSRF, request/response shape, epic cap + `meta.truncated`, no-request-context path, and changelog transition parsing against a synthetic changelog fixture (no real Jira data).
- Modify: `frontend/src/dashboard.jsx` — add `projectTrack` to `resolveStatsView`, the stats-source gates, `canRenderStatsPanel`, the stats-view dropdown options; add the new `stats-view` block with capacity toggle, metric toggle, exclusion toggles, reused Start/End sprint selectors, the quarters chart, the team/assignee breakdown chart, and the time-in-phase section; memoize SP series/breakdown from the already-loaded stats-source data, and lazily fetch phase durations for the in-scope epic keys when the section is shown.
- Create: `frontend/src/styles/stats/project-track.css` (only if the existing stats CSS partials do not already cover the needed classes) — follow the existing `frontend/src/styles/stats/` import pattern; reuse Excluded Capacity card/legend classes where possible.
- Modify: `tests/test_codebase_structure_budgets.py` — ratchet budgets only if the new files / `dashboard.jsx` growth legitimately exceed current limits.
- Modify: `tests/ui/codebase_structure_smoke.spec.js` (or the existing stats UI spec) — add a Playwright smoke test that opens the Project Track tab, asserts the quarters chart, breakdown chart, and time-in-phase section render, and captures a screenshot (animations settled) for product/tech and SP/epics toggles.
- Modify: `docs/README_ANALYTICS.md` — document the reused events and any new bucketed param values (`metric`, `capacity_side`, `series_type` track tokens).
- Modify: `README.md` — add a one-line mention of the Project Track stats tab under the stats/feature list.
- Modify: `docs/plans/README.md` — add the plan entry; move to `DONE-*` only after acceptance.
- Modify: generated `frontend/dist/*` via `npm run build` (do not hand-edit) if `verify-frontend-build.yml` requires a clean post-build diff.

---

## Task 1: Backend epic-track + assignee enrichment

**Files:**
- Modify: `jira_server.py` (`fetch_cached_excluded_capacity_epic_summaries` ~5151-5199; `build_excluded_capacity_issue_payload` ~5082-5141)
- Test: `tests/test_excluded_capacity_stats_api.py`

**Interfaces:**
- Produces: stats-source stories with `fields.epicProjectTrack` (string | null) and `fields.epicAssignee` ({ displayName: string } | null). Epic enrichment helper returns `{ originalKey: { 'summary': str, 'projectTrack': str|None, 'assignee': { 'displayName': str }|None } }`.

- [ ] **Step 1.1: Write the failing test for enriched epic metadata.**

Add to `tests/test_excluded_capacity_stats_api.py` a test that drives `build_excluded_capacity_issue_payload` (and/or the stats-source path the file already exercises) with a fake epic-meta map and asserts the new fields. Match the existing test style/fixtures in that file.

```python
def test_issue_payload_carries_epic_project_track_and_assignee(self):
    issue = {
        'id': '1', 'key': 'PROD-100',
        'fields': {
            'summary': 'Story A',
            'parent': {'key': 'PROD-12', 'fields': {'issuetype': {'name': 'Epic'}, 'summary': 'Epic A'}},
            'customfield_10004': 5,
        },
    }
    epic_meta = {'PROD-12': {'summary': 'Epic A', 'projectTrack': 'Committed',
                             'assignee': {'displayName': 'Synthetic Owner'}}}
    payload = build_excluded_capacity_issue_payload(
        issue, team_field_id=None, epic_link_field_id=None, sprint_field_id=None,
        epic_summary_by_key=epic_meta)
    self.assertEqual(payload['fields']['epicProjectTrack'], 'Committed')
    self.assertEqual(payload['fields']['epicAssignee'], {'displayName': 'Synthetic Owner'})

def test_issue_payload_handles_missing_track_and_assignee(self):
    issue = {'id': '2', 'key': 'PROD-101',
             'fields': {'summary': 'Story B',
                        'parent': {'key': 'PROD-13', 'fields': {'issuetype': {'name': 'Epic'}}}}}
    epic_meta = {'PROD-13': {'summary': '', 'projectTrack': None, 'assignee': None}}
    payload = build_excluded_capacity_issue_payload(
        issue, team_field_id=None, epic_link_field_id=None, sprint_field_id=None,
        epic_summary_by_key=epic_meta)
    self.assertIsNone(payload['fields']['epicProjectTrack'])
    self.assertIsNone(payload['fields']['epicAssignee'])
```

- [ ] **Step 1.2: Run the test to confirm it fails.**

Run: `.venv/bin/python -m unittest tests.test_excluded_capacity_stats_api -v`
Expected: FAIL — `KeyError: 'epicProjectTrack'` (field not produced yet).

- [ ] **Step 1.3: Extend `build_excluded_capacity_issue_payload` to read epic meta and emit the new fields.**

The param `epic_summary_by_key` now holds per-key meta dicts. Keep backward behavior: if the value is a plain string (legacy callers/tests), treat it as the summary.

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

Then add to the returned `fields` dict (after `epicSummary`):

```python
            'epicProjectTrack': epic_project_track,
            'epicAssignee': {'displayName': epic_assignee_meta.get('displayName')} if epic_assignee_meta else None,
```

- [ ] **Step 1.4: Extend `fetch_cached_excluded_capacity_epic_summaries` to fetch + cache the richer meta.**

Resolve the field id once with a no-request-context-safe fallback:

```python
    try:
        project_track_field = get_project_track_field_id()
    except ConfigStorageError:
        project_track_field = PROJECT_TRACK_FIELD_DEFAULT
```

Change the cache read to require the new keys (otherwise treat as a miss so legacy summary-only cache entries refetch):

```python
            if entry and now - entry.get('timestamp', 0) < EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE_TTL_SECONDS \
                    and 'projectTrack' in entry:
                summaries_by_normalized[normalized] = {
                    'summary': entry.get('summary', ''),
                    'projectTrack': entry.get('projectTrack'),
                    'assignee': entry.get('assignee'),
                }
            else:
                missing_keys.append(normalized)
```

Change the fetch + store to include the new fields:

```python
        epic_records = fetch_issues_by_keys(batch, ['summary', project_track_field, 'assignee'], context=context)
        for epic in epic_records:
            ef = epic.get('fields') or {}
            key = str(epic.get('key') or '').strip().upper()
            if not key:
                continue
            track_value = ef.get(project_track_field)
            track = (track_value or {}).get('value') if isinstance(track_value, dict) else None
            assignee = ef.get('assignee') or None
            fetched[key] = {
                'summary': str(ef.get('summary') or '').strip(),
                'projectTrack': track,
                'assignee': {'displayName': assignee.get('displayName')} if assignee else None,
            }
        with _cache_lock:
            for normalized in batch:
                meta = fetched.get(normalized, {'summary': '', 'projectTrack': None, 'assignee': None})
                EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE[excluded_capacity_epic_summary_cache_key(normalized, context=context)] = {
                    **meta, 'timestamp': time.time(),
                }
                summaries_by_normalized[normalized] = meta
```

And the final return maps original keys to the meta dict:

```python
    return {
        original_by_normalized[normalized]: summaries_by_normalized.get(
            normalized, {'summary': '', 'projectTrack': None, 'assignee': None})
        for normalized in normalized_keys
    }
```

- [ ] **Step 1.5: Run the test to confirm it passes.**

Run: `.venv/bin/python -m unittest tests.test_excluded_capacity_stats_api -v`
Expected: PASS.

- [ ] **Step 1.6: Run the full Python suite as the regression baseline.**

Run: `.venv/bin/python -m unittest discover -s tests`
Expected: PASS (no regressions in `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`, or stats-source tests). Ratchet `test_codebase_structure_budgets.py` only if `jira_server.py` legitimately grew past its budget.

- [ ] **Step 1.7: Commit.**

```bash
git add jira_server.py tests/test_excluded_capacity_stats_api.py
git commit -m "feat(stats): enrich stats-source stories with epic project track and assignee"
```

## Task 2: Frontend aggregation module

**Files:**
- Create: `frontend/src/stats/projectTrackStats.js`
- Test: `tests/test_project_track_stats.js`

**Interfaces:**
- Consumes: stats-source stories (`{ fields: { customfield_10004, epicKey, epicProjectTrack, teamId, projectKey, customfield_10101 } }`), `classifyCapacityIssue` from `frontend/src/capacityClassification.mjs`, `getSprintQuarterLabel`/`storyPointsFor` from `frontend/src/stats/excludedCapacityStats.js`.
- Produces:
  - `buildProjectTrackQuarterSeries(tasks, opts) -> { quarters: string[], tracks: string[], cells: { [quarter]: { [track]: number } } }` where `opts = { capacitySide, metric, excludeAdHoc, excludeExcludedCapacity, techProjectKeys, adHocEpicSet, excludedEpicSet }`
  - `summarizeProjectTrackTotals(series) -> { byTrack: { [track]: number }, total: number }`
  - `buildProjectTrackBreakdownRows(tasks, opts, { teamLabels }) -> { rows: [{ id, label, byTrack: { [track]: number }, total }], tracks: string[] }` — rows are **teams** when `opts.metric === 'storyPoints'` (label from `teamLabels[teamId]`/`teamName`/`teamId`, SP summed at story level) and **assignees** when `opts.metric === 'epics'` (label from `epicAssignee.displayName` or `Unassigned`, each in-scope epic's total SP attributed once to its assignee). Same in-scope filtering as the quarter series; rows sorted by `total` desc, `tracks` ordered as in the quarter series.
  - `NO_TRACK_LABEL = 'No track'`

- [ ] **Step 2.1: Write the failing tests.**

Create `tests/test_project_track_stats.js` (Node `--test`, ESM import like the sibling `tests/test_excluded_capacity_stats.js`).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTrackQuarterSeries, summarizeProjectTrackTotals, NO_TRACK_LABEL }
  from '../frontend/src/stats/projectTrackStats.js';

const story = (key, sp, track, sprint, opts = {}) => ({
  key,
  fields: {
    customfield_10004: sp,
    epicKey: opts.epicKey || `${key}-EPIC`,
    epicProjectTrack: track,
    teamId: opts.teamId || 'team-a',
    projectKey: opts.projectKey || 'PROD',
    customfield_10101: [{ name: sprint }],
  },
});

const base = { capacitySide: 'product', metric: 'storyPoints', excludeAdHoc: false,
  excludeExcludedCapacity: false, techProjectKeys: new Set(['TECH']),
  adHocEpicSet: new Set(), excludedEpicSet: new Set() };

test('splits SP by track and quarter, null track bucketed as No track', () => {
  const tasks = [story('PROD-1', 5, 'Committed', '2026Q1'),
                 story('PROD-2', 3, null, '2026Q1')];
  const series = buildProjectTrackQuarterSeries(tasks, base);
  assert.deepEqual(series.quarters, ['2026 Q1']);
  assert.equal(series.cells['2026 Q1']['Committed'], 5);
  assert.equal(series.cells['2026 Q1'][NO_TRACK_LABEL], 3);
});

test('Product side excludes Tech-project stories; Tech side includes only them', () => {
  const tasks = [story('PROD-1', 5, 'Committed', '2026Q1'),
                 story('TECH-1', 8, 'Committed', '2026Q1', { projectKey: 'TECH' })];
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackQuarterSeries(tasks, base)).total, 5);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackQuarterSeries(tasks,
    { ...base, capacitySide: 'tech' })).total, 8);
});

test('exclude toggles drop ad hoc / excluded-capacity epics', () => {
  const tasks = [story('PROD-1', 5, 'Committed', '2026Q1', { epicKey: 'AD-1' }),
                 story('PROD-2', 4, 'Committed', '2026Q1', { epicKey: 'EX-1' })];
  const adHoc = new Set(['AD-1']);
  const ex = new Set(['EX-1']);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackQuarterSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeAdHoc: true })).total, 4);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackQuarterSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeExcludedCapacity: true })).total, 5);
});

test('epics metric places the whole epic SP in its dominant quarter', () => {
  const tasks = [story('PROD-1', 2, 'Committed', '2026Q1', { epicKey: 'E1' }),
                 story('PROD-2', 6, 'Committed', '2026Q2', { epicKey: 'E1' })];
  const series = buildProjectTrackQuarterSeries(tasks, { ...base, metric: 'epics' });
  assert.equal(series.cells['2026 Q2']['Committed'], 8); // dominant quarter = 2026Q2 (6 > 2)
  assert.equal(series.cells['2026 Q1'], undefined);
});
```

- [ ] **Step 2.2: Run the tests to confirm they fail.**

Run: `node --test tests/test_project_track_stats.js`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 2.3: Implement `frontend/src/stats/projectTrackStats.js`.**

```js
import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { storyPointsFor, getSprintQuarterLabel, getProjectTrackRank }
  from './excludedCapacityStats.js';

export const NO_TRACK_LABEL = 'No track';

function firstSprintName(task) {
  const sprints = task?.fields?.customfield_10101;
  const first = Array.isArray(sprints) ? sprints[0] : sprints;
  return (first && (first.name || first)) || '';
}

function trackOf(task) {
  const raw = task?.fields?.epicProjectTrack;
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || NO_TRACK_LABEL;
}

function inScope(task, opts) {
  const { capacitySide, excludeAdHoc, excludeExcludedCapacity,
          techProjectKeys, adHocEpicSet, excludedEpicSet } = opts;
  const epicKey = String(task?.fields?.epicKey || '').trim().toUpperCase();
  if (excludedEpicSet?.has(epicKey)) {
    if (excludeExcludedCapacity) return false;
  }
  const cls = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
  if (excludeAdHoc && cls.capacityType === 'ad_hoc') return false;
  return capacitySide === 'tech' ? cls.projectType === 'tech' : cls.projectType === 'product';
}

function addCell(cells, quarter, track, points) {
  if (!cells[quarter]) cells[quarter] = {};
  cells[quarter][track] = (cells[quarter][track] || 0) + points;
}

export function buildProjectTrackQuarterSeries(tasks, opts) {
  const cells = {};
  const trackSet = new Set();
  if (opts.metric === 'epics') {
    const byEpic = new Map(); // epicKey -> { track, byQuarter: Map }
    for (const task of tasks || []) {
      if (!inScope(task, opts)) continue;
      const sp = storyPointsFor(task);
      if (!sp) continue;
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      const quarter = getSprintQuarterLabel(firstSprintName(task));
      if (!quarter) continue;
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task), byQuarter: new Map() });
      const rec = byEpic.get(epicKey);
      rec.byQuarter.set(quarter, (rec.byQuarter.get(quarter) || 0) + sp);
    }
    for (const { track, byQuarter } of byEpic.values()) {
      let dominant = null; let best = -1;
      for (const [quarter, points] of byQuarter) {
        if (points > best || (points === best && quarter > dominant)) { best = points; dominant = quarter; }
      }
      const total = Array.from(byQuarter.values()).reduce((a, b) => a + b, 0);
      addCell(cells, dominant, track, total);
      trackSet.add(track);
    }
  } else {
    for (const task of tasks || []) {
      if (!inScope(task, opts)) continue;
      const sp = storyPointsFor(task);
      if (!sp) continue;
      const quarter = getSprintQuarterLabel(firstSprintName(task));
      if (!quarter) continue;
      const track = trackOf(task);
      addCell(cells, quarter, track, sp);
      trackSet.add(track);
    }
  }
  const quarters = Object.keys(cells).sort();
  const tracks = Array.from(trackSet).sort((a, b) => {
    if (a === NO_TRACK_LABEL) return 1;
    if (b === NO_TRACK_LABEL) return -1;
    const rank = getProjectTrackRank(a) - getProjectTrackRank(b);
    return rank !== 0 ? rank : a.localeCompare(b);
  });
  return { quarters, tracks, cells };
}

export function summarizeProjectTrackTotals(series) {
  const byTrack = {};
  let total = 0;
  for (const quarter of series.quarters) {
    for (const [track, points] of Object.entries(series.cells[quarter] || {})) {
      byTrack[track] = (byTrack[track] || 0) + points;
      total += points;
    }
  }
  return { byTrack, total };
}
```

Note: confirm `getProjectTrackRank` is exported from `excludedCapacityStats.js` or `frontend/src/eng/engTaskUtils.js` (it lives in `engTaskUtils.js:202`); import from wherever it is actually exported, and add a named re-export only if needed to avoid a deep ENG import from a stats module.

- [ ] **Step 2.4: Add failing tests for the team/assignee breakdown.**

Append to `tests/test_project_track_stats.js`:

```js
import { buildProjectTrackBreakdownRows } from '../frontend/src/stats/projectTrackStats.js';

test('SP mode breakdown rows are teams split by track', () => {
  const tasks = [story('PROD-1', 5, 'Committed', '2026Q1', { teamId: 'team-a' }),
                 story('PROD-2', 3, 'Flexible', '2026Q1', { teamId: 'team-b' })];
  const out = buildProjectTrackBreakdownRows(tasks, base, { teamLabels: { 'team-a': 'Alpha', 'team-b': 'Bravo' } });
  const alpha = out.rows.find(r => r.label === 'Alpha');
  assert.equal(alpha.byTrack['Committed'], 5);
  assert.equal(alpha.total, 5);
});

test('Epics mode breakdown rows are assignees, epic SP counted once', () => {
  const tasks = [
    { key: 'S1', fields: { customfield_10004: 2, epicKey: 'E1', epicProjectTrack: 'Committed',
      epicAssignee: { displayName: 'Dana' }, teamId: 'team-a', projectKey: 'PROD', customfield_10101: [{ name: '2026Q1' }] } },
    { key: 'S2', fields: { customfield_10004: 6, epicKey: 'E1', epicProjectTrack: 'Committed',
      epicAssignee: { displayName: 'Dana' }, teamId: 'team-b', projectKey: 'PROD', customfield_10101: [{ name: '2026Q2' }] } },
  ];
  const out = buildProjectTrackBreakdownRows(tasks, { ...base, metric: 'epics' }, { teamLabels: {} });
  const dana = out.rows.find(r => r.label === 'Dana');
  assert.equal(dana.byTrack['Committed'], 8); // 2 + 6 once, attributed to epic assignee
});
```

- [ ] **Step 2.5: Implement `buildProjectTrackBreakdownRows` and run the tests.**

Reuse the same `inScope`/`trackOf` helpers. SP mode: group by `teamId`, label via `teamLabels`, sum story SP per track. Epics mode: dedupe stories to epics, attribute each epic's total in-scope SP to `epicAssignee.displayName || 'Unassigned'`, per track. Sort rows by `total` desc; reuse the quarter-series track ordering.

Run: `node --test tests/test_project_track_stats.js`
Expected: PASS (all tests, incl. the two new breakdown tests).

- [ ] **Step 2.6: Commit.**

```bash
git add frontend/src/stats/projectTrackStats.js tests/test_project_track_stats.js
git commit -m "feat(stats): add project-track quarter + team/assignee breakdown helpers"
```

## Task 3: Chart components + dashboard tab wiring (SP sections)

**Files:**
- Create: `frontend/src/stats/ProjectTrackQuarterChart.jsx`
- Create: `frontend/src/stats/ProjectTrackBreakdownChart.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Create (if needed): `frontend/src/styles/stats/project-track.css`
- Test: `tests/ui/codebase_structure_smoke.spec.js` (or the existing stats UI spec)

**Interfaces:**
- Consumes: `buildProjectTrackQuarterSeries`, `summarizeProjectTrackTotals`, `buildProjectTrackBreakdownRows`, `NO_TRACK_LABEL` (Task 2); `resolveTeamColor`-style color resolver and `resolveFloatingHoverPosition` already used by `ExcludedCapacityLineChart`; the per-row stacked-bar grammar of `EffortTypeSplitChart.jsx`.
- Produces:
  - `<ProjectTrackQuarterChart series={series} resolveColor={fn} metric={'storyPoints'|'epics'} />` — vertical stacked bars per quarter, clickable native-`<button>` legend, pointer-positioned hover readout.
  - `<ProjectTrackBreakdownChart data={breakdown} resolveColor={fn} metric={...} />` — one horizontal stacked bar per team/assignee row, segments = track, shared legend + clamped readout.

- [ ] **Step 3.1: Implement the chart components.**

`ProjectTrackQuarterChart.jsx`: model the SVG structure, axis scaling, legend buttons, and hover readout on `frontend/src/stats/ExcludedCapacityLineChart.jsx` (reuse its sizing constants, `resolveFloatingHoverPosition`, and legend pattern). Render one vertical bar per `series.quarters`, each stacked by `series.tracks` (bottom-to-top in `tracks` order), height scaled to the max quarter total with nice Y ticks. Legend toggles a track's visibility. Hover shows `{quarter} — {track}: {value} SP`. Colors come from a track-keyed resolver passed by the dashboard; `NO_TRACK_LABEL` uses a neutral grey. Use native button controls for the legend (no `span role=button`). Keep the readout sized to content with a narrow max width.

`ProjectTrackBreakdownChart.jsx`: model on `EffortTypeSplitChart.jsx` — one horizontal stacked bar per `data.rows` row (team in SP mode, assignee in Epics mode), segment widths = `byTrack[track] / row.total`, segments ordered by `data.tracks`. Share the same track color resolver and legend so colors match the quarters chart. Use the existing clamped readout (`clampReadoutPoint`-style) and compact-label rule.

- [ ] **Step 3.2: Wire the new sub-tab in `dashboard.jsx`.**

1. Add `'projectTrack'` to the allowed list in `resolveStatsView` (~line 668).
2. Add `projectTrack` to `isStatsSourceOnlyStatsView` (~line 727), the load-gate checks (~7050-7054), and `canRenderStatsPanel` (~10238).
3. Add `{ value: 'projectTrack', label: 'Project Track' }` to the stats-view dropdown options (~13056).
4. Add a `stats-view` block `className={`stats-view ${statsView === 'projectTrack' ? 'open' : ''}`}` after the Mono vs Cross block (~13345-13459), reusing the Excluded Capacity tab's Start/End sprint selectors and summary-card layout.
5. Add view-local state: `projectTrackCapacitySide` (default `'product'`), `projectTrackMetric` (default `'storyPoints'`), `projectTrackExcludeAdHoc` (default `false`), `projectTrackExcludeExcludedCapacity` (default `false`). Persist via the existing saved-prefs mechanism if sibling stats toggles are persisted; otherwise keep local.
6. Memoize the series from the same already-loaded stats-source task array the Excluded Capacity / Mono vs Cross tabs consume (locate the exact variable; do not trigger a new fetch): `buildProjectTrackQuarterSeries(tasks, opts)` with `opts = { capacitySide: projectTrackCapacitySide, metric: projectTrackMetric, excludeAdHoc: projectTrackExcludeAdHoc, excludeExcludedCapacity: projectTrackExcludeExcludedCapacity, techProjectKeys, adHocEpicSet, excludedEpicSet }`. Also memoize `buildProjectTrackBreakdownRows(tasks, opts, { teamLabels: activeGroup?.teamLabels || {} })` and `summarizeProjectTrackTotals(series)`.
7. Render, in order: summary cards (Range, total SP, one card per track total via `summarizeProjectTrackTotals().byTrack`); `<ProjectTrackQuarterChart>`; then `<ProjectTrackBreakdownChart>` (label the section "By team" in SP mode, "By assignee" in Epics mode). The time-in-phase section (Task 5) renders below these.

- [ ] **Step 3.3: Add CSS only if needed.**

Reuse existing Excluded Capacity stats card/legend classes. If a new bar-specific class is required, add it to a feature-owned partial `frontend/src/styles/stats/project-track.css` following the existing `frontend/src/styles/stats/` import pattern (see `excluded-capacity.css`); do not add inline styles to `jira-dashboard.html` for this feature.

- [ ] **Step 3.4: Build the frontend.**

Run: `npm run build`
Expected: clean build; `frontend/dist/dashboard.js` regenerated. Commit the generated `frontend/dist` output (do not hand-edit) if `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff.

- [ ] **Step 3.5: Add a Playwright smoke + screenshot.**

Add to the chosen UI spec: open ENG → Stats, select `Project Track`, assert the quarters chart SVG, the breakdown chart, and at least one summary card render, toggle `Tech` and `Epics` and assert both charts update (and the breakdown section label switches "By team" ↔ "By assignee"), and capture a screenshot after disabling/settling animations. Assert legend buttons are real `<button>` elements and that the new dropdown panel (if any) is clickable with a normal (non-forced) click.

Run: `npx playwright test tests/ui/codebase_structure_smoke.spec.js`
Expected: PASS; screenshots saved under the test results path.

- [ ] **Step 3.6: Commit.**

```bash
git add frontend/src/stats/ProjectTrackQuarterChart.jsx frontend/src/stats/ProjectTrackBreakdownChart.jsx \
  frontend/src/dashboard.jsx frontend/src/styles/stats/project-track.css frontend/dist \
  tests/ui/codebase_structure_smoke.spec.js
git commit -m "feat(stats): add Project Track tab with quarter and team/assignee charts"
```

## Task 4: Backend — epic Project Track phase-duration endpoint

**Files:**
- Modify: `backend/routes/stats_routes.py` — register `POST /api/stats/project-track-phase-durations`.
- Modify: `jira_server.py` — add the handler + bounded changelog fetch + transition parsing (reuse cohort staged-fetch helpers near `fetch_epic_cohort_data` / `_cohort_fetch_terminal_date_from_changelog` ~4805 and the history parsing style of `resolve_terminal_date_from_history` ~1072).
- Create: `tests/test_project_track_phase_api.py`
- Modify: `tests/test_oauth_stats_routes.py` — auth/CSRF + no-request-context coverage.

**Interfaces:**
- Produces: `POST /api/stats/project-track-phase-durations` returning `{ cached, generatedAt, data: [{ epicKey, summary, created, currentTrack, transitions: [{ date, from, to }], durationsDays: { "<state>": number } }], meta: { requestedEpicCount, processedEpicCount, truncated } }`. State label for null/blank is `null (no value)`.
- Pure helper `compute_track_phase_durations(created_iso, current_value, transitions, now)` so the math is unit-testable without Jira.

- [ ] **Step 4.1: Write failing tests with a synthetic changelog fixture.**

In `tests/test_project_track_phase_api.py`, unit-test the pure parser against a fixture mirroring the verified `TECH-27221` shape (synthetic keys only — no real Jira data):

```python
def test_durations_initial_null_then_single_transition(self):
    created = '2026-03-26T13:29:50.324+0000'
    transitions = [{'date': '2026-06-25T00:00:00.000+0000', 'from': None, 'to': 'Flexible'}]
    now = parse('2026-06-30T00:00:00.000+0000')
    out = compute_track_phase_durations(created, 'Flexible', transitions, now)
    self.assertAlmostEqual(out['null (no value)'], 91.0, delta=1.0)
    self.assertAlmostEqual(out['Flexible'], 5.0, delta=1.0)

def test_route_caps_epics_and_flags_truncation(self):
    # POST with more than MAX epicKeys -> meta.truncated True, processedEpicCount == cap
    ...
```

- [ ] **Step 4.2: Run to confirm failure.**

Run: `.venv/bin/python -m unittest tests.test_project_track_phase_api -v`
Expected: FAIL (handler/helper undefined).

- [ ] **Step 4.3: Implement the pure parser.**

Build interval boundaries from `created` (initial value = first transition's `from`, else `current_value`), then each transition's `to`; final phase runs to `now`. Sum days per state label; null/blank → `null (no value)`. Date-only granularity (the probe confirmed transitions carry only date precision that matters).

- [ ] **Step 4.4: Implement the bounded fetch + route.**

For each requested epic key (capped at a module constant `PROJECT_TRACK_PHASE_MAX_EPICS`, with bounded concurrency reusing the cohort staged-fetch pattern): `GET /rest/api/3/issue/{key}?expand=changelog&fields=created,summary,{track_field}` via `current_jira_get`; collect `customfield_<track>` transitions (`fieldId` match) with `created` timestamps; if `changelog.total > len(histories)`, page the `/rest/api/3/issue/{key}/changelog` endpoint for the remainder. Resolve the field id via `get_project_track_field_id()` with `ConfigStorageError` fallback. Set `meta.truncated` when the cap drops epics; never silently drop — log the dropped count without epic keys. Register the route in `backend/routes/stats_routes.py` mirroring the other `/api/stats/*` POSTs (auth + `X-Requested-With`).

- [ ] **Step 4.5: Run tests + full Python suite.**

Run: `.venv/bin/python -m unittest tests.test_project_track_phase_api tests.test_oauth_stats_routes && .venv/bin/python -m unittest discover -s tests`
Expected: PASS, no regressions.

- [ ] **Step 4.6: Commit.**

```bash
git add jira_server.py backend/routes/stats_routes.py tests/test_project_track_phase_api.py tests/test_oauth_stats_routes.py
git commit -m "feat(stats): add bounded epic Project Track phase-duration endpoint"
```

## Task 5: Frontend — time-in-phase section in the Project Track tab

**Files:**
- Create: `frontend/src/stats/projectTrackPhaseStats.js`
- Create: `frontend/src/stats/ProjectTrackPhaseChart.jsx`
- Create: `tests/test_project_track_phase_stats.js`
- Modify: `frontend/src/api/engApi.js` (add `fetchProjectTrackPhaseDurations`)
- Modify: `frontend/src/dashboard.jsx` (render + lazy fetch)
- Modify: `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- Consumes: `POST /api/stats/project-track-phase-durations` (Task 4); the in-scope epic keys derived from the loaded stats-source stories after exclusion toggles; the shared track color resolver.
- Produces: `fetchProjectTrackPhaseDurations(backendUrl, { epicKeys, refresh, signal })`; `summarizeTrackPhaseDurations(rows) -> { byState: {..days..}, avgDaysToFirstTrack, avgDaysToCommitted }`; `<ProjectTrackPhaseChart rows={rows} resolveColor={fn} />`.

- [ ] **Step 5.1: Write failing tests for the summary helper.**

`tests/test_project_track_phase_stats.js` — given two epic rows with `durationsDays`, assert `byState` sums and that `avgDaysToCommitted` ignores epics that never reached Committed.

- [ ] **Step 5.2: Implement `projectTrackPhaseStats.js` and run the test.**

Run: `node --test tests/test_project_track_phase_stats.js`
Expected: PASS.

- [ ] **Step 5.3: Add the API helper.**

Add `fetchProjectTrackPhaseDurations` to `frontend/src/api/engApi.js`, mirroring `fetchExcludedCapacityStatsSource` (POST, `X-Requested-With` header, abort signal).

- [ ] **Step 5.4: Implement the chart + wire the section.**

`ProjectTrackPhaseChart.jsx`: one horizontal stacked bar per epic row (segments = state, width = days), ordered by total age desc, sharing the track color resolver; hover shows `{epicKey} — {state}: {days}d`. In `dashboard.jsx`, when the Project Track tab is shown and the in-scope epic key set is non-empty, lazily call `fetchProjectTrackPhaseDurations` once per epic-key-set signature (cache by signature; abort on change), render `<ProjectTrackPhaseChart>` plus a small summary (avg days-to-first-track, avg days-to-Committed) from `summarizeTrackPhaseDurations`. Show a `meta.truncated` notice when the backend capped the epic set. Do not block the SP sections on this fetch.

- [ ] **Step 5.5: Build, smoke, commit.**

Run: `npm run build && npx playwright test tests/ui/codebase_structure_smoke.spec.js`
Expected: clean build; UI smoke asserts the time-in-phase section renders for a scoped group; screenshot captured.

```bash
git add frontend/src/stats/projectTrackPhaseStats.js frontend/src/stats/ProjectTrackPhaseChart.jsx \
  frontend/src/api/engApi.js frontend/src/dashboard.jsx frontend/dist \
  tests/test_project_track_phase_stats.js tests/ui/codebase_structure_smoke.spec.js
git commit -m "feat(stats): add epic time-in-Project-Track-phase section"
```

## Task 6: Analytics, docs, structure budgets, full verification

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Modify: `README.md`
- Modify: `tests/test_codebase_structure_budgets.py` (only if budgets legitimately exceeded)
- Modify: `docs/plans/README.md`

- [ ] **Step 6.1: Wire and document analytics.**

Emit tab-open and toggle events through the existing `stats_action` / `chart_action` / `filter_changed` contracts with bucketed typed params only (`capacity_side: 'product'|'tech'`, `metric: 'story_points'|'epics'`, exclusion toggle booleans as discrete params, track `series_type` tokens, a `section` token for quarters/breakdown/phase). No raw epic keys, summaries, team/group names, issue keys, assignee names, or durations. Update `frontend/src/analytics/events.js` and `tests/test_analytics_events.js` only if a new registered param value is introduced; document trigger, event type, canonical `event_name`, `feature_name`, typed params, and the privacy reason in `docs/README_ANALYTICS.md`. If no new event/param is needed, document the allowlist reason instead.

- [ ] **Step 6.2: Update user-facing docs.**

Add a description of the Project Track stats tab to `README.md` (stats/feature list): the quarters chart, the team/assignee breakdown, the time-in-phase section, the Product-default capacity toggle, exclusion toggles, and SP-vs-epics metric.

- [ ] **Step 6.3: Run focused analytics/structure tests.**

Run: `node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js && .venv/bin/python -m unittest tests.test_codebase_structure_budgets`
Expected: PASS. Ratchet budgets in `tests/test_codebase_structure_budgets.py` only if the new files / `dashboard.jsx` growth legitimately exceed limits; record the new numbers.

- [ ] **Step 6.4: Full pre-push verification.**

Run:
```bash
.venv/bin/python -m unittest discover -s tests
node --test tests/test_project_track_stats.js tests/test_project_track_phase_stats.js tests/test_excluded_capacity_stats.js
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js
.venv/bin/python jira_server.py   # then curl http://localhost:5050/api/test, confirm clean startup banner, stop
```
Expected: full Python suite PASS (incl. `tests.test_project_track_phase_api`, `tests.test_excluded_capacity_stats_api`, `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`), Node tests PASS, clean build, UI smoke PASS, server starts with no pre-banner dependency/runtime warnings and `/api/test` returns OK.

- [ ] **Step 6.5: Update plan index and commit.**

Add the plan to `docs/plans/README.md`. Commit docs/test updates:

```bash
git add docs/README_ANALYTICS.md README.md docs/plans/README.md tests/test_codebase_structure_budgets.py
git commit -m "docs(stats): document Project Track by quarter tab and analytics"
```

## Acceptance Criteria

- A `Project Track` stats sub-tab appears after `Mono vs Cross`, loads its SP sections from the cached progressive stats-source (no ENG alerts/filters/task list), and renders without a second scoped fetch for the SP sections.
- The quarters chart shows vertical stacked bars per quarter, split by Project Track value with a `No track` segment for null/blank, derived from the active sprint range.
- A capacity toggle switches Product (default) vs Tech using `classifyCapacityIssue`; all sections reflect only the selected side.
- `Exclude Ad Hoc` and `Exclude excluded-capacity epics` toggles (default included) drop those epics' stories/epics from every section using the active group's configured sets.
- The metric toggle switches the unit AND the breakdown dimension: `Story points` → story-granularity SP with a per-**team** breakdown; `Epics` → epic-granularity SP (epic placed in its dominant quarter) with a per-**assignee** breakdown. Project Track is inherited from epic to story throughout.
- The breakdown chart shows one horizontal stacked bar per team (SP mode) / assignee (Epics mode), split by Project Track, aggregated over the selected range; the section label switches "By team" ↔ "By assignee".
- The time-in-phase section shows, per in-scope epic, days spent in each Project Track state (`null (no value)` → `Flexible` → `Committed`) reconstructed from Jira changelog, plus an aggregate summary; the backend fetch is bounded (capped epic count, bounded concurrency) and flags `meta.truncated` without silently dropping epics.
- Backend stats-source stories carry `epicProjectTrack` and `epicAssignee` additively (field id via `get_project_track_field_id()` + `ConfigStorageError` fallback); the new `POST /api/stats/project-track-phase-durations` route is read-only and never writes Jira; Excluded Capacity and Mono vs Cross tabs are unchanged.
- Full Python suite (incl. `test_project_track_phase_api`, `test_excluded_capacity_stats_api`), Node tests, `npm run build`, server `/api/test` startup check, and the UI smoke test pass; analytics use bucketed params with no raw Jira identifiers or durations; structure budgets pass (ratcheted only if legitimately grown).
