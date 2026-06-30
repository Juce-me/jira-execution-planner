# Stats: Project Track by Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL when available: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Goal:** Add a new ENG stats sub-tab, `Project Track`, that shows story points by Project Track. A filter bar sits on top of the whole tab. Below it, in order: (1) a horizontal "totals" bar of SP split by track (Flexible / Committed / No track) for the selected sprint; (2) a per-sprint vertical stacked-bar chart of SP split by track across the selected sprint range; (3) a per-team (Story points mode) / per-assignee (Epics mode) horizontal stacked-bar breakdown split by track; (4) a time-in-phase section showing how long each in-scope epic spent in each Project Track state, from Jira changelog.

**Architecture:** Reuse the existing progressive, per-sprint-cached `/api/stats/excluded-capacity-source` endpoint as the single scoped issue source for the SP sections. Extend its cached epic enrichment to also carry each story's parent-epic `projectTrack` and epic assignee (additive fields only). Project Track is inherited from each epic down to its stories. Bucketing is **by sprint** (the existing sprint identity on each story), not by calendar quarter. The time-in-phase section adds one new read-only endpoint doing a **bounded** per-epic `expand=changelog` fetch over in-scope epic keys, reusing the cohort path's staged fan-out + changelog-parsing helpers. Add pure frontend aggregation modules and SVG chart components, wired into a new `statsView === 'projectTrack'` sub-tab in `dashboard.jsx` modeled on the Excluded Capacity tab.

**Tech Stack:** Python 3.10+ Flask (`jira_server.py`, `backend/routes/stats_routes.py`), existing stats-source path and epic-meta cache, existing changelog helpers (cohort staged fetch + `resolve_terminal_date_from_history`-style parsing), React 19, existing stats helper/chart modules, shared capacity classifier (`frontend/src/capacityClassification.mjs`), Python `unittest`, Node `--test`, Playwright UI tests, esbuild (`npm run build`).

**Feasibility note (verified live):** A Basic-auth probe (`.env.backup_basic`) of epic `TECH-27221` returned `created 2026-03-26`, current track `Flexible`, changelog `total=7` (not truncated), one Project Track transition `2026-06-25 null → Flexible` → 91.1 days in null, 4.8 days in Flexible. Confirms `customfield_35024` transitions carry `fromString`/`toString` + `created`, and that typical epics fit one `expand=changelog` response (truncation still handled defensively).

## Global Constraints

- Plans and implementation live under repo-relative paths; never commit secrets, real Jira keys, personal emails, or local absolute paths. Use synthetic fixtures only (`AGENTS.md` §6).
- Read-oriented stats surface for normal users. No Jira/Home write paths. The one new route is read-only.
- Project Track is an existing Jira custom field. Default id `PROJECT_TRACK_FIELD_DEFAULT = 'customfield_35024'`; always resolve via `get_project_track_field_id()` so a `dashboard-config.json` override wins. Config-reading getters invoked from no-request-context helpers must catch `ConfigStorageError` and fall back to the default id in DB mode (`AGENTS.md` Project Learnings).
- "Sprint" is the bucketing unit. In this codebase the sprint identity already lives on each story (`fields.customfield_10101` normalized sprints) and the Excluded Capacity tab already groups by sprint. Reuse that sprint identity; do NOT introduce a calendar-quarter mapper.
- Reuse the existing stats-source contract: Jira pagination is `nextPageToken`/`isLast`; the endpoint loads one sprint per request and merges progressively. Do not add a second scoped fetch or per-issue enrichment fan-out for the SP sections.
- Reuse the shared capacity classifier `classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet })` for Product/Tech/Ad Hoc; do not re-derive Product/Tech from `task.key.startsWith('TECH-')`.
- Run the FULL Python suite (incl. `tests.test_initiative_extraction`, `tests.test_codebase_structure_budgets`) and the full Node suite as the baseline and before claiming done; ratchet structure budgets only when these entrypoints legitimately grow.
- Analytics reuse existing `stats_action` / `chart_action` / `filter_changed` contracts with bucketed, typed params only — no raw epic keys, summaries, team/group names, issue keys, assignee names, or durations. Keep the two-trigger GTM dataLayer contract; no new custom dimensions unless explicitly required.

---

## Status

Planned. Not started. All work belongs on branch `feature/stats-project-track-quarters`. Rename to `DONE-*` only after implementation is complete, verified, and accepted/merged, per `docs/plans/AGENTS.md`.

## Product Decisions

1. **New stats sub-tab.** Add `statsView` value `'projectTrack'`, dropdown label `Project Track`, placed after `Mono vs Cross`. It is a stats-source-only view (`isStatsSourceOnlyStatsView`), so the SP sections reuse the cached progressive fetch and do not load ENG alerts, filters, or the task list.
2. **Filter bar on top.** A single control row sits above all charts and drives every section: **Start sprint**, **End sprint** (reusing the Excluded Capacity tab's sprint selectors), **Capacity side** (`Product` default / `Tech` / `Tech + Product`), **Exclude Ad Hoc** toggle (default off = included), **Exclude excluded-capacity** toggle (default off = included), and **Metric** (`Story points` default / `Epics`). All are visible and selectable; changing any re-derives the charts from the already-loaded source data.
3. **Capacity side is three-way.** `classifyCapacityIssue` gives `projectType` product|tech. `Product` keeps product (incl. Ad Hoc); `Tech` keeps tech; `Tech + Product` keeps both. Default `Product`.
4. **Project Track inherited to stories + null bucket.** Each story inherits its epic's `projectTrack` (enriched `epicProjectTrack`). Stories whose epic has no track (null/blank) bucket into a single `No track` segment. The track set is data-derived, ordered by `getProjectTrackRank` then alphabetically, with `No track` always last. Track colors are shared across all charts in the tab.
5. **Metric drives granularity AND breakdown dimension.** `Story points` (default): aggregate at story granularity; breakdown rows are **teams** (from active department/group config). `Epics`: aggregate at epic granularity — each in-scope epic contributes the sum of its in-scope stories' SP, grouped by the epic's track and attributed to the **epic assignee** (`epicAssignee`); breakdown rows are assignees. For the per-sprint chart in Epics mode, each epic's total SP is placed in its **dominant sprint** (the in-range sprint holding the largest share of that epic's SP; ties → latest sprint in range).
6. **Sprint range + selected sprint.** Start/End sprint bound the range; the per-sprint chart shows one bar per sprint in range. A single **selected sprint** drives the top totals bar; it defaults to the End sprint and updates when the user clicks a bar in the per-sprint chart.
7. **Four sections (top to bottom).** (a) **Totals bar**: one horizontal stacked bar = total SP by track for the **selected sprint**. (b) **Per-sprint chart**: vertical bars per sprint in range, stacked by track. (c) **Breakdown chart**: one horizontal stacked bar per team (SP mode) / assignee (Epics mode), split by track, over the selected range; section label switches "By team" ↔ "By assignee". (d) **Time-in-phase** (Decision 8).
8. **Time-in-phase (changelog) section.** For the in-scope epics (distinct `epicKey`s from loaded stories, after exclusions), fetch each epic's Project Track change history and compute days in each state (`null (no value)`, `Flexible`, `Committed`, plus any other observed value). Render one horizontal stacked bar per epic (segments = state, width = days), ordered by total age, with an aggregate summary (avg days-to-first-track, avg days-to-Committed). Date granularity only.
9. **Bounded fan-out for changelog.** The new endpoint caps epics per request and bounds concurrency, reusing the cohort staged-fetch pattern. It flags truncation (`meta.truncated`) and never silently drops epics. Per-epic single-changelog truncation (`total > len(histories)`) falls back to the paginated changelog endpoint.
10. **Backend change is additive for stories; one new read-only endpoint for phases.** Story enrichment attaches `epicProjectTrack` (string | null) and `epicAssignee` (`{ displayName } | null`) additively. Time-in-phase data comes from a new `POST /api/stats/project-track-phase-durations` route.
11. **Analytics reuse.** Tab open + filter/section toggles reuse `stats_action` / `chart_action` / `filter_changed` with bucketed params (`series_type`, `metric`, `capacity_side` ∈ {product,tech,both}, exclusion booleans, `section`). No raw epic keys, assignee names, or durations. No new GA4 custom dimension unless review finds one strictly required.

## Affected Surfaces

| Surface | Current behavior | Required behavior |
| --- | --- | --- |
| Stats view selector (`frontend/src/dashboard.jsx` ~668, ~13048-13056) | `resolveStatsView` allows `teams/priority/burnout/cohort/excludedCapacity/monoCrossShare`; dropdown lists those. | Add `projectTrack` to `resolveStatsView` and a `{ value: 'projectTrack', label: 'Project Track' }` dropdown option after Mono vs Cross. |
| Stats-source load gate (`dashboard.jsx:727`, ~7050-7054) | `isStatsSourceOnlyStatsView` true for `excludedCapacity`/`monoCrossShare`. | Include `projectTrack` so the cached progressive source fetch runs and ENG alerts/filters/task list stay unloaded. |
| Stats panel render gate (`dashboard.jsx:10238`) | `canRenderStatsPanel` includes stats-source views. | Include `projectTrack`. |
| Stats-source story payload (`jira_server.py:5082-5141`, `5151-5199`, `5343-5348`) | Story carries `epicKey`/`epicSummary` + sprint (`customfield_10101`); epic enrichment fetches only `summary`. | Additionally carry `epicProjectTrack` and `epicAssignee`; epic enrichment fetches `summary` + project-track field + `assignee`. |
| Stats routes (`backend/routes/stats_routes.py`) | Registers `/api/stats/*` POSTs. | Register new read-only `POST /api/stats/project-track-phase-durations`. |
| Excluded Capacity / Mono vs Cross tabs | Unchanged. | Unchanged — no regression. Reused helpers keep current behavior. |

## Endpoint Contract

| Route | Auth | CSRF | Request | Success | Errors / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/stats/excluded-capacity-source` | Existing authenticated read (OAuth Jira REST / basic per mode) | Existing `X-Requested-With: jira-execution-planner` | Existing `{ sprintIds, teamIds, refresh? }` (one sprint per request) | Existing `{ cached, generatedAt, data, meta }`; each story now also includes `fields.epicProjectTrack` (string | null) and `fields.epicAssignee` ({ displayName } | null). | No shape removals; existing consumers ignore new fields. `epic-summaries` Server-Timing token still covers the richer epic fetch. Epic enrichment stays a single cached bulk fetch keyed by epic key + auth context. |
| `POST /api/stats/project-track-phase-durations` (new) | Same as sibling `/api/stats/*` reads | Same `X-Requested-With` requirement | `{ epicKeys: string[], refresh?: boolean }` (capped server-side) | `{ cached, generatedAt, data: [{ epicKey, summary, created, currentTrack, transitions: [{ date, from, to }], durationsDays: { "<state>": number } }], meta: { requestedEpicCount, processedEpicCount, truncated } }` | Read-only; never mutates Jira. Caps `epicKeys` at `PROJECT_TRACK_PHASE_MAX_EPICS` with bounded concurrency (cohort staged-fetch pattern). On per-epic truncation, pages `/rest/api/3/issue/{key}/changelog`. `meta.truncated=true` when the cap drops epics. Cache key = normalized epic-key set + auth context. No token/PII in logs. |

New story `fields` shape (additive keys shown):

```json
{
  "epicKey": "PROD-12",
  "epicSummary": "Checkout revamp",
  "epicProjectTrack": "Committed",
  "epicAssignee": { "displayName": "Synthetic Owner" },
  "customfield_10004": 5,
  "teamId": "team-a",
  "customfield_10101": [{ "name": "Sprint 42" }]
}
```

## File Map

- Modify: `jira_server.py` — (a) extend `fetch_cached_excluded_capacity_epic_summaries` to fetch + cache `projectTrack` and `assignee`, returning a per-key meta dict; extend `build_excluded_capacity_issue_payload` to attach `epicProjectTrack`/`epicAssignee`; (b) add the phase-durations handler + bounded changelog fetch + transition parser.
- Modify: `backend/routes/stats_routes.py` — register `POST /api/stats/project-track-phase-durations`.
- Modify: `tests/test_excluded_capacity_stats_api.py` — assert enriched story payload (track + assignee, null cases) and that the epic fetch requests the project-track field.
- Create: `tests/test_project_track_phase_api.py` — pure parser math + route cap/truncation + no-request-context, against a synthetic changelog fixture.
- Modify: `tests/test_oauth_stats_routes.py` — route auth/CSRF for the new endpoint.
- Create: `frontend/src/stats/projectTrackStats.js` — `buildProjectTrackSprintSeries`, `summarizeProjectTrackTotals`, `buildProjectTrackBreakdownRows`, `NO_TRACK_LABEL`.
- Create: `tests/test_project_track_stats.js` — Node `--test` for capacity-side (incl. `both`), exclusions, null bucket, story vs epic metric, dominant-sprint placement, selected-sprint totals, team/assignee breakdown.
- Create: `frontend/src/stats/ProjectTrackTotalsBar.jsx` — single horizontal stacked bar (selected sprint), segments = track.
- Create: `frontend/src/stats/ProjectTrackSprintChart.jsx` — vertical stacked bars per sprint; bar click selects the sprint.
- Create: `frontend/src/stats/ProjectTrackBreakdownChart.jsx` — horizontal per-row (team/assignee) stacked bars split by track (model on `EffortTypeSplitChart.jsx`).
- Create: `frontend/src/stats/projectTrackPhaseStats.js` — `summarizeTrackPhaseDurations(rows)` + ordering helper.
- Create: `frontend/src/stats/ProjectTrackPhaseChart.jsx` — horizontal per-epic stacked bar (segments = state, width = days).
- Create: `tests/test_project_track_phase_stats.js` — duration summary math.
- Modify: `frontend/src/api/engApi.js` — add `fetchProjectTrackPhaseDurations(backendUrl, { epicKeys, refresh, signal })`.
- Modify: `frontend/src/dashboard.jsx` — `resolveStatsView`, stats-source gates, `canRenderStatsPanel`, dropdown option; the new `stats-view` block: top filter bar, totals bar, per-sprint chart (with selected-sprint state), breakdown chart, and the lazily-fetched time-in-phase section.
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

- [ ] **Step 1.4: Extend `fetch_cached_excluded_capacity_epic_summaries`.** Resolve field id safely, require new keys on cache read, fetch + cache richer meta:

```python
    try:
        project_track_field = get_project_track_field_id()
    except ConfigStorageError:
        project_track_field = PROJECT_TRACK_FIELD_DEFAULT
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
- Produces:
  - `NO_TRACK_LABEL = 'No track'`
  - `buildProjectTrackSprintSeries(tasks, opts) -> { sprints: string[], tracks: string[], cells: { [sprint]: { [track]: number } } }` where `opts = { capacitySide: 'product'|'tech'|'both', metric: 'storyPoints'|'epics', excludeAdHoc, excludeExcludedCapacity, techProjectKeys, adHocEpicSet, excludedEpicSet, sprintOrder? }`. `sprintOrder` (optional ordered range) determines column order; otherwise sprints sort lexicographically.
  - `summarizeProjectTrackTotals(series, { sprint } = {}) -> { byTrack: { [track]: number }, total: number }` — whole range, or just one sprint's cell when `sprint` is given.
  - `buildProjectTrackBreakdownRows(tasks, opts, { teamLabels }) -> { rows: [{ id, label, byTrack, total }], tracks: string[] }` — rows are teams (SP mode) or epic-assignees (Epics mode).

- [ ] **Step 2.1: Write failing tests.** `tests/test_project_track_stats.js` (Node `--test`, ESM):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTrackSprintSeries, summarizeProjectTrackTotals,
  buildProjectTrackBreakdownRows, NO_TRACK_LABEL } from '../frontend/src/stats/projectTrackStats.js';

const story = (key, sp, track, sprint, opts = {}) => ({ key, fields: {
  customfield_10004: sp, epicKey: opts.epicKey || `${key}-EPIC`, epicProjectTrack: track,
  epicAssignee: opts.assignee ? { displayName: opts.assignee } : null,
  teamId: opts.teamId || 'team-a', teamName: opts.teamName, projectKey: opts.projectKey || 'PROD',
  customfield_10101: [{ name: sprint }] } });

const base = { capacitySide: 'product', metric: 'storyPoints', excludeAdHoc: false,
  excludeExcludedCapacity: false, techProjectKeys: new Set(['TECH']),
  adHocEpicSet: new Set(), excludedEpicSet: new Set() };

test('splits SP by track and sprint, null track bucketed as No track', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 'S1'), story('PROD-2', 3, null, 'S1')], base);
  assert.deepEqual(s.sprints, ['S1']);
  assert.equal(s.cells['S1']['Committed'], 5);
  assert.equal(s.cells['S1'][NO_TRACK_LABEL], 3);
});

test('capacity side product/tech/both', () => {
  const tasks = [story('PROD-1', 5, 'Committed', 'S1'),
                 story('TECH-1', 8, 'Committed', 'S1', { projectKey: 'TECH' })];
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, base)).total, 5);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, { ...base, capacitySide: 'tech' })).total, 8);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks, { ...base, capacitySide: 'both' })).total, 13);
});

test('exclude toggles drop ad hoc / excluded epics', () => {
  const tasks = [story('PROD-1', 5, 'Committed', 'S1', { epicKey: 'AD-1' }),
                 story('PROD-2', 4, 'Committed', 'S1', { epicKey: 'EX-1' })];
  const adHoc = new Set(['AD-1']); const ex = new Set(['EX-1']);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeAdHoc: true })).total, 4);
  assert.equal(summarizeProjectTrackTotals(buildProjectTrackSprintSeries(tasks,
    { ...base, adHocEpicSet: adHoc, excludedEpicSet: ex, excludeExcludedCapacity: true })).total, 5);
});

test('epics metric places whole epic SP in its dominant sprint', () => {
  const tasks = [story('PROD-1', 2, 'Committed', 'S1', { epicKey: 'E1' }),
                 story('PROD-2', 6, 'Committed', 'S2', { epicKey: 'E1' })];
  const s = buildProjectTrackSprintSeries(tasks, { ...base, metric: 'epics', sprintOrder: ['S1', 'S2'] });
  assert.equal(s.cells['S2']['Committed'], 8);
  assert.equal(s.cells['S1'], undefined);
});

test('selected-sprint totals isolate one sprint', () => {
  const s = buildProjectTrackSprintSeries(
    [story('PROD-1', 5, 'Committed', 'S1'), story('PROD-2', 4, 'Committed', 'S2')], base);
  assert.equal(summarizeProjectTrackTotals(s, { sprint: 'S2' }).total, 4);
});

test('SP-mode breakdown rows are teams; Epics-mode rows are assignees counted once', () => {
  const spRows = buildProjectTrackBreakdownRows(
    [story('PROD-1', 5, 'Committed', 'S1', { teamId: 'team-a' })], base, { teamLabels: { 'team-a': 'Alpha' } });
  assert.equal(spRows.rows.find(r => r.label === 'Alpha').byTrack['Committed'], 5);
  const epicTasks = [story('S1', 2, 'Committed', 'S1', { epicKey: 'E1', assignee: 'Dana' }),
                     story('S2', 6, 'Committed', 'S2', { epicKey: 'E1', assignee: 'Dana' })];
  const epRows = buildProjectTrackBreakdownRows(epicTasks, { ...base, metric: 'epics' }, { teamLabels: {} });
  assert.equal(epRows.rows.find(r => r.label === 'Dana').byTrack['Committed'], 8);
});
```

- [ ] **Step 2.2: Run to confirm failure.** `node --test tests/test_project_track_stats.js`

- [ ] **Step 2.3: Implement `frontend/src/stats/projectTrackStats.js`.**

```js
import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { storyPointsFor } from './excludedCapacityStats.js';
import { getProjectTrackRank } from '../eng/engTaskUtils.js';

export const NO_TRACK_LABEL = 'No track';

function sprintOf(task) {
  // A story belongs to exactly one sprint; the field is normalized to a list — take the first entry.
  const raw = task?.fields?.customfield_10101;
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first && (first.name || first)) || '';
}
function trackOf(task) {
  const raw = task?.fields?.epicProjectTrack;
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v || NO_TRACK_LABEL;
}
function inScope(task, opts) {
  const epicKey = String(task?.fields?.epicKey || '').trim().toUpperCase();
  if (opts.excludeExcludedCapacity && opts.excludedEpicSet?.has(epicKey)) return false;
  const cls = classifyCapacityIssue(task, { techProjectKeys: opts.techProjectKeys, adHocEpicSet: opts.adHocEpicSet });
  if (opts.excludeAdHoc && cls.capacityType === 'ad_hoc') return false;
  if (opts.capacitySide === 'both') return true;
  return opts.capacitySide === 'tech' ? cls.projectType === 'tech' : cls.projectType === 'product';
}
function orderTracks(set) {
  return Array.from(set).sort((a, b) => {
    if (a === NO_TRACK_LABEL) return 1;
    if (b === NO_TRACK_LABEL) return -1;
    const r = getProjectTrackRank(a) - getProjectTrackRank(b);
    return r !== 0 ? r : a.localeCompare(b);
  });
}
function orderSprints(set, sprintOrder) {
  const list = Array.from(set);
  if (Array.isArray(sprintOrder) && sprintOrder.length) {
    const idx = new Map(sprintOrder.map((s, i) => [s, i]));
    return list.sort((a, b) => (idx.has(a) ? idx.get(a) : 1e9) - (idx.has(b) ? idx.get(b) : 1e9) || a.localeCompare(b));
  }
  return list.sort();
}
function rangeSet(opts) {
  return Array.isArray(opts.sprintOrder) && opts.sprintOrder.length ? new Set(opts.sprintOrder) : null;
}

export function buildProjectTrackSprintSeries(tasks, opts) {
  const cells = {}; const trackSet = new Set(); const sprintSet = new Set();
  const allowed = rangeSet(opts);
  const add = (sprint, track, pts) => {
    if (!cells[sprint]) cells[sprint] = {};
    cells[sprint][track] = (cells[sprint][track] || 0) + pts;
    trackSet.add(track); sprintSet.add(sprint);
  };
  if (opts.metric === 'epics') {
    const byEpic = new Map();
    for (const task of tasks || []) {
      if (!inScope(task, opts)) continue;
      const sp = storyPointsFor(task); if (!sp) continue;
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      const sprint = sprintOf(task);
      if (!sprint || (allowed && !allowed.has(sprint))) continue;
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task), bySprint: new Map() });
      const rec = byEpic.get(epicKey);
      rec.bySprint.set(sprint, (rec.bySprint.get(sprint) || 0) + sp);
    }
    for (const { track, bySprint } of byEpic.values()) {
      let dom = null; let best = -1;
      for (const [sprint, pts] of bySprint) {
        if (pts > best || (pts === best && String(sprint) > String(dom))) { best = pts; dom = sprint; }
      }
      if (dom == null) continue;
      add(dom, track, Array.from(bySprint.values()).reduce((a, b) => a + b, 0));
    }
  } else {
    for (const task of tasks || []) {
      if (!inScope(task, opts)) continue;
      const sp = storyPointsFor(task); if (!sp) continue;
      const sprint = sprintOf(task);
      if (!sprint || (allowed && !allowed.has(sprint))) continue;
      add(sprint, trackOf(task), sp);
    }
  }
  return { sprints: orderSprints(sprintSet, opts.sprintOrder), tracks: orderTracks(trackSet), cells };
}

export function summarizeProjectTrackTotals(series, { sprint } = {}) {
  const byTrack = {}; let total = 0;
  const sprints = sprint ? [sprint] : series.sprints;
  for (const s of sprints) {
    for (const [track, pts] of Object.entries(series.cells[s] || {})) {
      byTrack[track] = (byTrack[track] || 0) + pts; total += pts;
    }
  }
  return { byTrack, total };
}

export function buildProjectTrackBreakdownRows(tasks, opts, { teamLabels = {} } = {}) {
  const trackSet = new Set(); const rowMap = new Map();
  const ensure = (id, label) => {
    if (!rowMap.has(id)) rowMap.set(id, { id, label, byTrack: {}, total: 0 });
    return rowMap.get(id);
  };
  const addRow = (row, track, pts) => { row.byTrack[track] = (row.byTrack[track] || 0) + pts; row.total += pts; trackSet.add(track); };
  if (opts.metric === 'epics') {
    const byEpic = new Map();
    for (const task of tasks || []) {
      if (!inScope(task, opts)) continue;
      const sp = storyPointsFor(task); if (!sp) continue;
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task),
        assignee: task?.fields?.epicAssignee?.displayName || 'Unassigned', total: 0 });
      byEpic.get(epicKey).total += sp;
    }
    for (const { track, assignee, total } of byEpic.values()) addRow(ensure(assignee, assignee), track, total);
  } else {
    for (const task of tasks || []) {
      if (!inScope(task, opts)) continue;
      const sp = storyPointsFor(task); if (!sp) continue;
      const teamId = task?.fields?.teamId || task?.fields?.teamName || 'unknown';
      const label = teamLabels[teamId] || task?.fields?.teamName || teamId;
      addRow(ensure(teamId, label), trackOf(task), sp);
    }
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
  return { rows, tracks: orderTracks(trackSet) };
}
```

- [ ] **Step 2.4: Run tests → PASS.** `node --test tests/test_project_track_stats.js`
- [ ] **Step 2.5: Commit.** `git commit -m "feat(stats): add project-track by-sprint + team/assignee aggregation helpers"`

## Task 3: Chart components + dashboard tab wiring (filter bar + SP sections)

**Files:**
- Create: `frontend/src/stats/ProjectTrackTotalsBar.jsx`, `frontend/src/stats/ProjectTrackSprintChart.jsx`, `frontend/src/stats/ProjectTrackBreakdownChart.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Create (if needed): `frontend/src/styles/stats/project-track.css`
- Test: `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- Consumes Task 2 helpers; shared track color resolver and `resolveFloatingHoverPosition` (from `ExcludedCapacityLineChart`); per-row stacked-bar grammar of `EffortTypeSplitChart.jsx`.
- Produces:
  - `<ProjectTrackTotalsBar byTrack={...} tracks={...} resolveColor={fn} sprintLabel={...} />` — one horizontal stacked bar.
  - `<ProjectTrackSprintChart series={series} resolveColor={fn} selectedSprint={...} onSelectSprint={fn} />` — vertical per-sprint bars, click selects a sprint.
  - `<ProjectTrackBreakdownChart data={breakdown} resolveColor={fn} />` — per-row horizontal stacked bars.

- [ ] **Step 3.1: Implement the three chart components.**
  - `ProjectTrackSprintChart.jsx`: model SVG axis/legend/hover on `ExcludedCapacityLineChart.jsx`; one vertical bar per `series.sprints`, stacked by `series.tracks`, Y scaled to max sprint total with nice ticks; clicking a bar calls `onSelectSprint(sprint)` and the selected sprint is visually highlighted; native-`<button>` legend toggles track visibility; hover shows `{sprint} — {track}: {n} SP`.
  - `ProjectTrackTotalsBar.jsx`: a single full-width horizontal bar; segment widths = `byTrack[track] / sum`, ordered by `tracks`; label shows the selected sprint and per-track values; reuse the clamped readout.
  - `ProjectTrackBreakdownChart.jsx`: model on `EffortTypeSplitChart.jsx`; one horizontal bar per `data.rows` row, segments ordered by `data.tracks`, shared color resolver + legend.
  - All three share one track color resolver passed from the dashboard; `NO_TRACK_LABEL` → neutral grey.

- [ ] **Step 3.2: Wire the tab in `dashboard.jsx`.**
  1. Add `'projectTrack'` to `resolveStatsView` (~668); add it to `isStatsSourceOnlyStatsView` (~727), the load-gate (~7050-7054), and `canRenderStatsPanel` (~10238); add `{ value: 'projectTrack', label: 'Project Track' }` to the dropdown (~13056).
  2. Add a `stats-view` block `className={`stats-view ${statsView === 'projectTrack' ? 'open' : ''}`}` after the Mono vs Cross block.
  3. **Filter bar on top of the block** (above all charts): Start/End sprint selectors (reuse the Excluded Capacity controls), Capacity side selector (`product`/`tech`/`both`, default `product`), Exclude Ad Hoc toggle, Exclude excluded-capacity toggle, Metric selector (`storyPoints`/`epics`). Reuse existing dropdown/toggle classes (e.g. `team-dropdown-*`/`sprint-dropdown-*`); persist via saved prefs if sibling stats toggles are persisted, else local state.
  4. Derive the ordered sprint range (`sprintOrder`) from the Start/End selection the same way the Excluded Capacity tab derives its sprint list.
  5. State `projectTrackSelectedSprint` defaults to the last sprint in `sprintOrder`; reset when the range changes; updated by `onSelectSprint`.
  6. Memoize from the **already-loaded** stats-source task array the Excluded Capacity / Mono vs Cross tabs consume (locate the exact variable; no new fetch): `series = buildProjectTrackSprintSeries(tasks, opts)`, `breakdown = buildProjectTrackBreakdownRows(tasks, opts, { teamLabels: activeGroup?.teamLabels || {} })`, where `opts` carries `capacitySide/metric/excludeAdHoc/excludeExcludedCapacity/techProjectKeys/adHocEpicSet/excludedEpicSet/sprintOrder`.
  7. Render in order: `<ProjectTrackTotalsBar byTrack={summarizeProjectTrackTotals(series, { sprint: projectTrackSelectedSprint }).byTrack} … />`; `<ProjectTrackSprintChart series={series} selectedSprint={projectTrackSelectedSprint} onSelectSprint={setProjectTrackSelectedSprint} />`; `<ProjectTrackBreakdownChart data={breakdown} />` under a "By team"/"By assignee" heading driven by metric. (Time-in-phase section added in Task 5.)

- [ ] **Step 3.3: CSS only if needed.** Reuse Excluded Capacity stats card/legend classes; add a `frontend/src/styles/stats/project-track.css` partial only for genuinely new classes, via the existing `frontend/src/styles/stats/` import pattern. No inline styles in `jira-dashboard.html` for this feature.
- [ ] **Step 3.4: Build.** `npm run build` → clean; commit generated `frontend/dist` if `verify-frontend-build.yml` requires it.
- [ ] **Step 3.5: Playwright smoke + screenshot.** Open ENG → Stats → `Project Track`; assert the filter bar, totals bar, per-sprint chart, and breakdown chart render; toggle `Tech` then `Tech + Product`, and `Epics`, asserting charts update and the breakdown heading switches; click a per-sprint bar and assert the totals bar updates; capture a screenshot (animations settled). Assert legend buttons are real `<button>` and any dropdown panel is clickable with a normal (non-forced) click. `npx playwright test tests/ui/codebase_structure_smoke.spec.js`
- [ ] **Step 3.6: Commit.** `git commit -m "feat(stats): add Project Track tab with filter bar, totals bar, per-sprint and breakdown charts"`

## Task 4: Backend — epic Project Track phase-duration endpoint

**Files:**
- Modify: `backend/routes/stats_routes.py` — register `POST /api/stats/project-track-phase-durations`.
- Modify: `jira_server.py` — handler + bounded changelog fetch + transition parser (reuse cohort staged-fetch near `fetch_epic_cohort_data` / `_cohort_fetch_terminal_date_from_changelog` ~4805 and history parsing of `resolve_terminal_date_from_history` ~1072).
- Create: `tests/test_project_track_phase_api.py`; Modify: `tests/test_oauth_stats_routes.py`.

**Interfaces:**
- `POST /api/stats/project-track-phase-durations` per the Endpoint Contract; null/blank state label = `null (no value)`.
- Pure `compute_track_phase_durations(created_iso, current_value, transitions, now)` so the math is unit-testable without Jira.

- [ ] **Step 4.1: Write failing tests** (synthetic data only):

```python
def test_durations_initial_null_then_single_transition(self):
    out = compute_track_phase_durations(
        '2026-03-26T13:29:50.324+0000', 'Flexible',
        [{'date': '2026-06-25T00:00:00.000+0000', 'from': None, 'to': 'Flexible'}],
        parse('2026-06-30T00:00:00.000+0000'))
    self.assertAlmostEqual(out['null (no value)'], 91.0, delta=1.0)
    self.assertAlmostEqual(out['Flexible'], 5.0, delta=1.0)
# plus: route caps epicKeys at PROJECT_TRACK_PHASE_MAX_EPICS -> meta.truncated True, processedEpicCount == cap
```

- [ ] **Step 4.2: Run to confirm failure.** `.venv/bin/python -m unittest tests.test_project_track_phase_api -v`
- [ ] **Step 4.3: Implement the pure parser.** Boundaries: start = `created` with initial value = first transition's `from` (else `current_value`); each transition's `to`; final phase → `now`. Sum days per state label; null/blank → `null (no value)`.
- [ ] **Step 4.4: Implement bounded fetch + route.** For each requested key (capped at `PROJECT_TRACK_PHASE_MAX_EPICS`, bounded concurrency via cohort staged-fetch): `GET /rest/api/3/issue/{key}?expand=changelog&fields=created,summary,{track_field}` via `current_jira_get`; collect `fieldId == track_field` transitions with `created`; if `changelog.total > len(histories)`, page `/rest/api/3/issue/{key}/changelog`. Field id via `get_project_track_field_id()` + `ConfigStorageError` fallback. Set `meta.truncated` and log dropped count (no epic keys). Register the route mirroring sibling `/api/stats/*` POSTs (auth + `X-Requested-With`).
- [ ] **Step 4.5: Run focused + full suite → PASS.** `.venv/bin/python -m unittest tests.test_project_track_phase_api tests.test_oauth_stats_routes && .venv/bin/python -m unittest discover -s tests`
- [ ] **Step 4.6: Commit.** `git commit -m "feat(stats): add bounded epic Project Track phase-duration endpoint"`

## Task 5: Frontend — time-in-phase section

**Files:**
- Create: `frontend/src/stats/projectTrackPhaseStats.js`, `frontend/src/stats/ProjectTrackPhaseChart.jsx`, `tests/test_project_track_phase_stats.js`
- Modify: `frontend/src/api/engApi.js`, `frontend/src/dashboard.jsx`, `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- `fetchProjectTrackPhaseDurations(backendUrl, { epicKeys, refresh, signal })`; `summarizeTrackPhaseDurations(rows) -> { byState, avgDaysToFirstTrack, avgDaysToCommitted }`; `<ProjectTrackPhaseChart rows={rows} resolveColor={fn} />`.

- [ ] **Step 5.1: Failing test** for `summarizeTrackPhaseDurations` (sum `byState`; `avgDaysToCommitted` ignores epics that never reached Committed). `tests/test_project_track_phase_stats.js`
- [ ] **Step 5.2: Implement `projectTrackPhaseStats.js`; run → PASS.** `node --test tests/test_project_track_phase_stats.js`
- [ ] **Step 5.3: Add API helper** `fetchProjectTrackPhaseDurations` to `frontend/src/api/engApi.js`, mirroring `fetchExcludedCapacityStatsSource` (POST, `X-Requested-With`, abort signal).
- [ ] **Step 5.4: Chart + wire the section.** `ProjectTrackPhaseChart.jsx`: one horizontal stacked bar per epic (segments = state, width = days), ordered by total age desc, shared track-state colors; hover `{epicKey} — {state}: {days}d`. In `dashboard.jsx`: derive the in-scope epic key set from the same loaded stories (after exclusion toggles); when the tab is shown and the set is non-empty, lazily call `fetchProjectTrackPhaseDurations` once per epic-key-set signature (cache by signature; abort on change); render `<ProjectTrackPhaseChart>` plus a small summary (avg days-to-first-track, avg days-to-Committed) and a `meta.truncated` notice when capped. Do not block the SP sections on this fetch.
- [ ] **Step 5.5: Build, smoke, commit.** `npm run build && npx playwright test tests/ui/codebase_structure_smoke.spec.js`; UI smoke asserts the time-in-phase section renders for a scoped group; screenshot. `git commit -m "feat(stats): add epic time-in-Project-Track-phase section"`

## Task 6: Analytics, docs, structure budgets, full verification

**Files:** `docs/README_ANALYTICS.md`, `README.md`, `tests/test_codebase_structure_budgets.py` (only if exceeded), `docs/plans/README.md`

- [ ] **Step 6.1: Wire + document analytics.** Tab-open and filter/section toggles via `stats_action` / `chart_action` / `filter_changed` with bucketed params (`capacity_side ∈ {product,tech,both}`, `metric ∈ {story_points,epics}`, exclusion booleans, `section`, track `series_type` tokens). No raw epic keys, summaries, team/group names, issue keys, assignee names, or durations. Update `frontend/src/analytics/events.js` + `tests/test_analytics_events.js` only if a new registered param value is introduced; document trigger/type/`event_name`/`feature_name`/typed params/privacy reason in `docs/README_ANALYTICS.md`, else document the allowlist reason.
- [ ] **Step 6.2: User docs.** Add a `README.md` entry: filter bar (start/end sprint, Product/Tech/Tech+Product, exclude ad hoc, exclude excluded-capacity, SP/Epics), selected-sprint totals bar, per-sprint chart, team/assignee breakdown, time-in-phase section.
- [ ] **Step 6.3: Focused analytics/structure tests.** `node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js && .venv/bin/python -m unittest tests.test_codebase_structure_budgets` → PASS (ratchet budgets only if legitimately grown; record new numbers).
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
- A filter bar on top of the tab exposes Start sprint, End sprint, Capacity side (Product default / Tech / Tech + Product), Exclude Ad Hoc, Exclude excluded-capacity, and Metric (Story points default / Epics); all are visible, selectable, and re-derive every section.
- The top totals bar is a single horizontal bar of SP by track (incl. `No track`) for the **selected sprint** (default End sprint; updates when a per-sprint bar is clicked).
- The per-sprint chart shows one vertical stacked bar per sprint in range, split by Project Track.
- The metric toggle switches unit AND breakdown dimension: `Story points` → story-granularity SP, per-**team** breakdown; `Epics` → epic-granularity SP (epic in its dominant sprint), per-**assignee** breakdown. Project Track is inherited epic→story throughout.
- The breakdown chart shows one horizontal stacked bar per team/assignee, split by track, over the selected range, with a "By team"/"By assignee" heading.
- The time-in-phase section shows, per in-scope epic, days in each Project Track state (`null (no value)` → `Flexible` → `Committed`) from Jira changelog, plus an aggregate summary; the backend fetch is bounded and flags `meta.truncated` without silently dropping epics.
- Backend stats-source stories carry `epicProjectTrack`/`epicAssignee` additively (field id via `get_project_track_field_id()` + `ConfigStorageError` fallback); the new `POST /api/stats/project-track-phase-durations` is read-only; Excluded Capacity and Mono vs Cross tabs are unchanged.
- Full Python suite, Node tests, `npm run build`, server `/api/test`, and UI smoke pass; analytics use bucketed params with no raw Jira identifiers or durations; structure budgets pass (ratcheted only if legitimately grown).
