# Statistics Consistency Bugfix Implementation Plan

> **Status:** Implemented and verified on branch `bugfix/statistics-consistency-exec`, integrated into parent `bugfix/statistics-colors-capacity-lead-time` via fast-forward (not pushed; no PR to `main` yet). Kept as `EXEC-` pending user review and merge to `main`, per repo convention for implemented-but-unmerged plans. Execution commits: `a42e7ca` (Task 1 shared team colors), `90d3213` (Task 2 Range-card removal + cross-view color proof), `fd4435a` (Task 3 two-quarter backend contract), `d63d8db` (Task 4 End Quarter state/controls/links), `c4fb36c` (Task 5 generated bundle). Per-task reviews all passed (spec ✅ + quality Approved); final whole-branch review clean (0 Critical/Important). Suites: node 515/515, Python 1052/1052 (+1 Postgres skip), Playwright 153/157 (2 intentional skips + 2 pre-existing `eng_alerts_panel_summary` failures unrelated to this work — branch touches no alert code).
>
> **Current accuracy note:** Task 2's "four Excluded Capacity cards" was corrected to FIVE during execution — a pre-existing `Excluded SP` card (present before this branch at base `4b0ce6b`) was omitted from the plan's enumeration. Removing only the redundant `Range` card is correct; the committed test asserts `toHaveCount(5)`. The card-count references below were updated to match reality.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Priority, Burndown, and Mono vs Cross one group-scoped team-color mapping, remove the redundant Excluded Capacity Range card, and add an inclusive End Quarter to Lead Times.

**Architecture:** Keep Statistics color identity in pure helpers under `frontend/src/stats/`, construct one map from the full shared active-group membership, and inject its resolver into each chart. Keep Lead Times as a creation-cohort report: the frontend selects Start Quarter and End Quarter, the backend derives a half-open Jira timestamp interval, and Quarter/Month remains client-side regrouping only.

**Tech Stack:** React 19, JavaScript ES modules, Flask/Python 3.10+, Node `node:test`, Python `unittest`, Playwright, esbuild.

## Global Constraints

- Implement on `bugfix/statistics-colors-capacity-lead-time`; do not use another worktree.
- `RADAR_PALETTE` in `frontend/src/stats/statsConstants.js` remains the only categorical team palette.
- Build colors from the complete shared active group, not selected-sprint tasks, selected-team filters, or chart-specific series.
- Every user of the same group receives the same current mapping. Use a locale-independent, case-insensitive name sort with team ID as the tie-breaker so browser locale cannot change assignments. Adding, deleting, or renaming a group team may reassign later alphabetical colors; persistent assignments across group edits are out of scope.
- Do not add inactive, obsolete, retired, dashed, dotted, or patterned team styling.
- Lead Times filters Epic creation dates. Terminal dates after End Quarter remain valid for lead-time calculations and elapsed columns.
- End Quarter is inclusive in the UI and implemented as `created < dayAfter(effectiveEndDate)` in Jira JQL.
- A historical End Quarter ends on its final calendar day. The current End Quarter ends today. Future End Quarters are invalid.
- The last quarter selector changed wins: moving Start after End moves End to Start; moving End before Start moves Start to End.
- Project, assignee, capacity, excluded-capacity, status, and Quarter/Month grouping remain client-side filters and must not refetch Lead Times.
- Preserve `nextPageToken` / `isLast`, auth context, `X-Requested-With`, workspace scope, and read-only behavior.
- No analytics event is added: End Quarter is corrective parity with the existing uninstrumented Start Quarter. Add the required no-event allowlist row to `docs/README_ANALYTICS.md`; do not change the event taxonomy or GA4 runbooks.
- Do not hand-edit `frontend/dist/`; run `npm run build` and commit generated output.

## File Map

- `frontend/src/stats/statsUtils.js` — shared active-group color map.
- `frontend/src/stats/burnoutChartUtils.js` — consume injected colors; remove private assignment.
- `frontend/src/dashboard.jsx` — shared resolver, card removal, End Quarter state/control/request/persistence.
- `frontend/src/cohort/cohortUtils.js` — quarter comparison.
- `frontend/src/cohort/LeadTimesWorkflowStatusCard.jsx` — bounded Jira status link.
- `frontend/src/cohort/LeadTimesEpicCharts.jsx` — bounded open/completed Jira links and copy.
- `frontend/src/jiraExportUtils.mjs` — inclusive End Quarter JQL.
- `jira_server.py` — two-quarter validation, derived dates, cache key, half-open JQL.
- `tests/test_stats_utils.js`, `tests/test_burnout_chart_utils.js` — pure frontend tests.
- `tests/test_stats_module_extraction_source_guards.js`, `tests/test_excluded_capacity_stats_source_guards.js` — ownership and markup guards.
- `tests/test_jira_export_utils.js`, `tests/test_epic_cohort_api.py` — link/API contracts.
- `tests/ui/codebase_structure_smoke.spec.js` — rendered behavior and screenshots.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` — generated output.
- `docs/README_ANALYTICS.md` — required no-event allowlist reason for the corrective UI changes.
- `docs/plans/SUPPORT-statistics-consistency-bugfix-design.md`, `docs/plans/README.md` — design and plan index.

## Endpoint Contract Matrix

| Field | Contract |
| --- | --- |
| Route | `POST /api/stats/epic-cohort` |
| Auth | Existing `authenticated_read` policy. OAuth requires a real signed-in session and uses its current site-scoped `RequestAuthContext`; Basic mode keeps the existing local compatibility guard. |
| Unsafe-method guard | OAuth requires `X-Requested-With: jira-execution-planner`; this read policy does not require token-bound CSRF. Basic mode intentionally accepts the POST without the header. |
| Body | `startQuarter`, `endQuarter`, optional `teamIds`, `components`, `adHocCapacityEpics`, `refresh` |
| Success | `200 {"cached":<bool>,"generatedAt":"<iso>","data":{"range":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"},"issues":[],"meta":{...}}}` |
| Missing | `400 {"error":"startQuarter and endQuarter are required"}` |
| Malformed | `400 {"error":"startQuarter and endQuarter must use YYYYQ[1-4]"}` |
| Inverted | `400 {"error":"startQuarter cannot be after endQuarter"}` |
| Future end | `400 {"error":"endQuarter cannot be after the current quarter"}` |
| Missing OAuth header | `403 {"error":"csrf_required",...}` before route execution |
| Expired OAuth | Existing `401` auth-required envelope with the login recovery URL |
| Jira failure | Propagated Jira status with `{"error":"Failed to fetch epic cohort stats","details":"<upstream text>"}` |
| Pagination | `nextPageToken` / `isLast` only |
| Cache | Existing auth-safe policy; key includes both normalized quarters and existing scope fields |

## State And Ownership Checklist

- Initial/reload: restore both quarters from the existing local UI preferences; default either missing value to the current quarter.
- Group switch: save and restore both quarters in the existing per-group state snapshot; do not write them into shared group configuration.
- Selector change: clear the selected heatmap row, reconcile an inverted range in the same React event, and issue one debounced request containing only the reconciled pair.
- Stale response: preserve the existing effect cleanup, `AbortController`, timeout, and query-key cache behavior; adding End Quarter to the query key prevents an old range from winning.
- Error/retry/auth recovery: preserve the current visible Lead Times error path and shared OAuth recovery behavior; no optimistic state or rollback is involved in this read-only filter.
- Remote/concurrent edits: not applicable because these selectors are per-browser UI preferences, not shared mutable state.
- Team-color ownership: shared group membership supplies the complete ID set; shared Jira/team-catalog names supply deterministic sort labels; no chart, sprint result, local filter, or per-user storage owns color assignments.

## Pre-implementation Visual Baseline

Before the first source edit, add a retained `captureSmokeScreenshot(page, 'statistics-mono-cross')` call after the existing Mono vs Cross visibility assertion, then run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Excluded Capacity summary"
```

Preserve the generated Priority, Burndown, Mono vs Cross, Lead Times, and Excluded Capacity images as uncommitted baseline artifacts. Task 5 captures the same settled states after the fixes and records the visible differences in the PR notes.

---

### Task 1: Extract And Inject The Shared Team-Color Map

**Files:**
- Modify: `frontend/src/stats/statsUtils.js:1-75`
- Modify: `frontend/src/stats/burnoutChartUtils.js:1-215`
- Modify: `frontend/src/dashboard.jsx:70-85, 4522-4575, 10270-10305, 13445-13462, 13690-13705, 13808-13820`
- Test: `tests/test_stats_utils.js:40-70`
- Test: `tests/test_burnout_chart_utils.js:1-110`
- Test: `tests/test_stats_module_extraction_source_guards.js:80-110`

**Interfaces:**
- Produces: `buildTeamColorMap(teams: Array<{id: string, name: string}>): Record<string, string>`.
- Produces: `resolveTeamColor(teamId: string, colorMap?: Record<string, string>): string`.
- Produces in `dashboard.jsx`: `resolveStatsTeamColor(teamId: string): string`.

- [ ] **Step 1: Write the failing shared-map unit test**

Extend the Statistics utility test:

```js
const {
    buildTeamColorMap,
    resolveTeamColor,
} = await import('../frontend/src/stats/statsUtils.js');

const teamColors = buildTeamColorMap([
    { id: 'team-gamma', name: 'Gamma Team' },
    { id: 'team-alpha', name: 'Alpha Team' },
    { id: 'team-beta', name: 'Beta Team' },
    { id: 'team-beta', name: 'Duplicate Beta' },
]);
assert.deepEqual(teamColors, {
    'team-alpha': '#0ea5e9',
    'team-beta': '#eab308',
    'team-gamma': '#84cc16',
});
assert.equal(resolveTeamColor('team-beta', teamColors), '#eab308');
assert.match(resolveTeamColor('team-outside-group', teamColors), /^#[0-9a-f]{6}$/i);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/test_stats_utils.js`

Expected: FAIL because `buildTeamColorMap` is not exported.

- [ ] **Step 3: Implement the pure shared-map helper**

Add beside `resolveTeamColor`:

```js
export function buildTeamColorMap(teams) {
    if (!RADAR_PALETTE.length) return {};
    const byId = new Map();
    (teams || []).forEach((team) => {
        const id = String(team?.id || '').trim();
        if (!id || id === 'all' || byId.has(id)) return;
        const name = String(team?.name || id).trim() || id;
        byId.set(id, { id, name });
    });
    return Object.fromEntries(
        Array.from(byId.values())
            .sort((a, b) => {
                const leftName = a.name.toLowerCase();
                const rightName = b.name.toLowerCase();
                if (leftName < rightName) return -1;
                if (leftName > rightName) return 1;
                if (a.id < b.id) return -1;
                if (a.id > b.id) return 1;
                return 0;
            })
            .map((team, index) => [team.id, RADAR_PALETTE[index % RADAR_PALETTE.length]])
    );
}

export function resolveTeamColor(teamId, colorMap = null) {
    const key = String(teamId || '').trim();
    const mapped = key && colorMap ? colorMap[key] : '';
    if (mapped) return mapped;
    if (!RADAR_PALETTE.length) return '#94a3b8';
    return RADAR_PALETTE[hashTeamId(key) % RADAR_PALETTE.length];
}
```

- [ ] **Step 4: Write the failing Burndown injected-color test and source guard**

```js
test('buildBurnoutChartModel preserves injected shared team colors', async () => {
    const { buildBurnoutChartModel } = await import('../frontend/src/stats/burnoutChartUtils.js');
    const colors = { 'team-alpha': '#111111', 'team-beta': '#eeeeee' };
    const model = buildBurnoutChartModel({
        burnoutData: {
            range: { startDate: '2026-04-01', endDate: '2026-04-03' },
            issuesMeta: [
                { issueKey: 'A-1', createdDate: '2026-03-30', teamAtStart: { id: 'team-alpha', name: 'Alpha Team' }, assignee: {} },
                { issueKey: 'B-1', createdDate: '2026-03-30', teamAtStart: { id: 'team-beta', name: 'Beta Team' }, assignee: {} },
            ],
            events: [],
        },
        assigneeFilter: 'all',
        taskTeamByIssueKey: new Map(),
        taskStatusByIssueKey: new Map([['A-1', 'to do'], ['B-1', 'to do']]),
        issueWeightByKey: new Map([['A-1', 1], ['B-1', 1]]),
        isCompletedSprintSelected: false,
        metric: 'issueCount',
        resolveTeamColor: (teamId) => colors[teamId],
    });
    assert.deepEqual(model.teams.map(({ key, color }) => [key, color]), [
        ['team-alpha', '#111111'],
        ['team-beta', '#eeeeee'],
    ]);
});
```

Read `burnoutChartUtils.js` in the source-guard test and add:

```js
assert.equal(burnoutUtilsSource.includes("import { RADAR_PALETTE }"), false);
assert.equal(burnoutUtilsSource.includes('team.color = RADAR_PALETTE'), false);
assert.ok(dashboardSource.includes('resolveTeamColor: resolveStatsTeamColor'));
assert.ok((dashboardSource.match(/resolveTeamColor=\{resolveStatsTeamColor\}/g) || []).length >= 3);
```

- [ ] **Step 5: Remove Burndown's private assignment**

Delete the `RADAR_PALETTE` import and its post-sort reassignment loop. Keep:

```js
teamByKey.set(key, {
    key,
    id,
    name,
    color: resolveTeamColor(key)
});
```

Keep `orderedTeams` sorting for legend and stack order.

- [ ] **Step 6: Construct and inject one full-group resolver**

Import `buildTeamColorMap`, then add after `activeGroupTeamIds`:

```js
const statsTeamColorMap = React.useMemo(() => buildTeamColorMap(
    activeGroupTeamIds.map((teamId) => ({ id: teamId, name: resolveTeamName(teamId) }))
), [activeGroupTeamIds, teamNameLookup]);
const resolveStatsTeamColor = React.useCallback(
    (teamId) => resolveTeamColor(teamId, statsTeamColorMap),
    [statsTeamColorMap]
);
```

Use `resolveStatsTeamColor` in `buildBurnoutChartModel`, `StatsPriorityView`, and both team-mode `ExcludedCapacityLineChart` instances. Add `resolveStatsTeamColor` to the `burnoutChartModel` memo dependency list so a group/name-map change recomputes its embedded colors. Leave unrelated task microbars unchanged.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/test_stats_utils.js tests/test_burnout_chart_utils.js tests/test_stats_module_extraction_source_guards.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/stats/statsUtils.js frontend/src/stats/burnoutChartUtils.js frontend/src/dashboard.jsx tests/test_stats_utils.js tests/test_burnout_chart_utils.js tests/test_stats_module_extraction_source_guards.js
git commit -m "fix: unify statistics team colors"
```

### Task 2: Remove The Excluded Capacity Range Card And Verify Colors

**Files:**
- Modify: `frontend/src/dashboard.jsx:13605-13645`
- Test: `tests/test_excluded_capacity_stats_source_guards.js:90-120`
- Test: `tests/ui/codebase_structure_smoke.spec.js:1080-1180, 1460-1505`

**Interfaces:**
- Consumes: `resolveStatsTeamColor` from Task 1.
- Produces: five Excluded Capacity cards: Excluded SP, Excluded Share, Ad Hoc Share, Product total, Tech Share (Excluded SP pre-existed this branch; only the redundant Range card is removed).

- [ ] **Step 1: Add the failing source assertion**

```js
assert.ok(
    !excludedSummaryBlock.includes('<h4>Range</h4>'),
    'Excluded Capacity summary should not repeat the selected sprint range as a card'
);
```

- [ ] **Step 2: Run the source guard**

Run: `node --test tests/test_excluded_capacity_stats_source_guards.js`

Expected: FAIL on the new Range assertion.

- [ ] **Step 3: Delete only this card**

```jsx
<div className="stats-card">
    <h4>Range</h4>
    <div className="stat-value">{excludedCapacitySprintRange.length}</div>
    <div className="stats-note">Selected Jira sprints</div>
</div>
```

Do not remove Mono vs Cross or Project Track Range cards.

- [ ] **Step 4: Add rendered card and color assertions**

In the existing summary test:

```js
await expect(summary.locator('.stats-card')).toHaveCount(5);
await expect(summary.locator('.stats-card', { hasText: 'Range' })).toHaveCount(0);
```

In the Statistics subviews test, capture legend colors before switching views:

```js
const legendColors = async (selector) => page.locator(selector).evaluateAll((items) => Object.fromEntries(
    items.map((item) => [item.textContent.trim(), getComputedStyle(item.querySelector('i')).backgroundColor])
));
```

Capture each map while its view is open, using `.stats-view.open .priority-legend > span`, `.stats-view.open .burnout-legend > span`, and `.stats-view.open .excluded-capacity-line-legend-item`. Then assert Alpha Team and Beta Team have equal colors in all three maps. Scoping to `.stats-view.open` prevents hidden Burndown/Project Track legends from contaminating the result.

- [ ] **Step 5: Run focused source/UI tests**

```bash
node --test tests/test_excluded_capacity_stats_source_guards.js
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Excluded Capacity summary"
```

Expected: PASS; settled screenshot shows five compact cards. The build is required because the Statistics subviews smoke test deliberately sets `useCommittedDist: true`; keep the generated dist changes unstaged until Task 5.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_excluded_capacity_stats_source_guards.js tests/ui/codebase_structure_smoke.spec.js
git commit -m "fix: remove excluded capacity range card"
```

### Task 3: Add The Two-Quarter Lead Times Backend Contract

**Files:**
- Modify: `jira_server.py:1166-1185, 4899-5095, 5641-5700`
- Test: `tests/test_epic_cohort_api.py:1-350`
- Test: `tests/test_oauth_stats_routes.py`

**Interfaces:**
- Produces: `resolve_epic_cohort_range(start_quarter: str, end_quarter: str, reference_date: date | None = None) -> tuple[date, date]`.
- Changes: `_build_epic_cohort_cache_key(start_quarter, end_quarter, team_ids, projects, components=None, ad_hoc_epics=None)`.
- Changes: `fetch_epic_cohort_data(start_date: date, end_date: date, headers, team_field_id, ...)`.

- [ ] **Step 1: Write failing range and cache-key tests**

```python
def test_resolve_epic_cohort_range_includes_historical_end_quarter(self):
    start, end = jira_server.resolve_epic_cohort_range(
        '2025Q1', '2025Q2', reference_date=date(2026, 7, 13)
    )
    self.assertEqual(start, date(2025, 1, 1))
    self.assertEqual(end, date(2025, 6, 30))

def test_resolve_epic_cohort_range_caps_current_quarter_at_today(self):
    start, end = jira_server.resolve_epic_cohort_range(
        '2026Q1', '2026Q2', reference_date=date(2026, 5, 14)
    )
    self.assertEqual(start, date(2026, 1, 1))
    self.assertEqual(end, date(2026, 5, 14))

def test_cache_key_distinguishes_end_quarter(self):
    q1 = jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q1', ['T1'], ['PRODUCT'])
    q2 = jira_server._build_epic_cohort_cache_key('2025Q1', '2025Q2', ['T1'], ['PRODUCT'])
    self.assertNotEqual(q1, q2)
```

Update the existing Ad Hoc cache-key test so every compared call passes the same `end_quarter='2025Q2'`.

- [ ] **Step 2: Write failing endpoint validation tests**

```python
@patch.object(jira_server, 'resolve_team_field_id')
def test_invalid_quarter_ranges_fail_before_jira_access(self, mock_team_field):
    cases = [
        ({}, 'startQuarter and endQuarter are required'),
        ({'startQuarter': '2025Q1'}, 'startQuarter and endQuarter are required'),
        ({'startQuarter': 'bad', 'endQuarter': '2025Q2'}, 'startQuarter and endQuarter must use YYYYQ[1-4]'),
        ({'startQuarter': '0000Q1', 'endQuarter': '2025Q2'}, 'startQuarter and endQuarter must use YYYYQ[1-4]'),
        ({'startQuarter': '2025Q3', 'endQuarter': '2025Q2'}, 'startQuarter cannot be after endQuarter'),
        ({'startQuarter': '2025Q1', 'endQuarter': '2999Q1'}, 'endQuarter cannot be after the current quarter'),
    ]
    for body, expected in cases:
        with self.subTest(body=body):
            response = self.client.post('/api/stats/epic-cohort', json=body)
            self.assertEqual(response.status_code, 400)
            self.assertEqual((response.get_json() or {}).get('error'), expected)
    mock_team_field.assert_not_called()
```

In `tests/test_oauth_stats_routes.py`, add the missing route-specific unsafe-header assertion and keep the Basic compatibility assertion:

```python
def test_epic_cohort_post_requires_oauth_requested_with_header(self):
    with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'):
        response = self.client.post('/api/stats/epic-cohort', json={
            'startQuarter': '2026Q1',
            'endQuarter': '2026Q2',
        })
    self.assertEqual(response.status_code, 403)
    self.assertEqual(response.get_json()['error'], 'csrf_required')
```

Update the existing OAuth-ready and Basic-mode requests to include `endQuarter: '2026Q2'`; the OAuth-ready request keeps `X-Requested-With`, while the Basic-mode request intentionally omits it.

- [ ] **Step 3: Write failing JQL and terminal-date tests**

Change direct fetch calls to explicit derived dates:

```python
payload, error = jira_server.fetch_epic_cohort_data(
    start_date=date(2025, 1, 1),
    end_date=date(2025, 6, 30),
    headers={'Authorization': 'Basic test'},
    team_field_id='customfield_30101',
    team_ids=['T1'],
)
```

Assert:

```python
self.assertIn('created >= "2025-01-01"', jql)
self.assertIn('created < "2025-07-01"', jql)
```

Add an Epic resolved after End Quarter and prove the report boundary does not truncate its lead time or extend the cohort range:

```python
self.assertEqual(issue.get('terminalDate'), '2025-08-15')
self.assertEqual(payload.get('range'), {
    'startDate': '2025-01-01',
    'endDate': '2025-06-30',
})
```

- [ ] **Step 4: Run tests and verify failures**

Run: `.venv/bin/python -m unittest tests.test_epic_cohort_api`

Expected: FAIL on the missing helper, old cache signature, endpoint contract, and missing upper bound.

- [ ] **Step 5: Implement quarter validation**

```python
def resolve_epic_cohort_range(start_quarter, end_quarter, reference_date=None):
    try:
        start_date, _ = quarter_dates_from_label(start_quarter)
        _, requested_end = quarter_dates_from_label(end_quarter)
    except (TypeError, ValueError):
        start_date, requested_end = None, None
    if not start_date or not requested_end:
        raise ValueError('startQuarter and endQuarter must use YYYYQ[1-4]')
    if start_date > requested_end:
        raise ValueError('startQuarter cannot be after endQuarter')

    today = reference_date or date.today()
    current_quarter = ((today.month - 1) // 3) + 1
    _, current_quarter_end = quarter_dates_from_label(f'{today.year}Q{current_quarter}')
    if requested_end > current_quarter_end:
        raise ValueError('endQuarter cannot be after the current quarter')
    return start_date, min(requested_end, today)
```

Add normalized End Quarter to the cache key immediately after normalized Start Quarter.

- [ ] **Step 6: Change the fetcher to derived dates and half-open JQL**

```python
def fetch_epic_cohort_data(start_date, end_date, headers, team_field_id, team_ids=None, component_names=None, context=None, ad_hoc_capacity_epics=None):
    end_exclusive = end_date + timedelta(days=1)
    # Preserve existing project/ad-hoc match_clause construction.
    jql = (
        f'issuetype = Epic AND {match_clause} '
        f'AND created >= "{start_date.isoformat()}" '
        f'AND created < "{end_exclusive.isoformat()}"'
    )
```

For no configured projects, return both selected dates. Remove the current-quarter `range_end` derivation and `latest_terminal_date` extension. Keep `today = date.today()` only for open-Epic age. Always return:

```python
'range': {
    'startDate': start_date.isoformat(),
    'endDate': end_date.isoformat()
}
```

- [ ] **Step 7: Validate the route before Jira access**

```python
start_quarter = str(payload.get('startQuarter') or '').strip()
end_quarter = str(payload.get('endQuarter') or '').strip()
if not start_quarter or not end_quarter:
    return jsonify({'error': 'startQuarter and endQuarter are required'}), 400
try:
    start_date, end_date = resolve_epic_cohort_range(start_quarter, end_quarter)
except ValueError as exc:
    return jsonify({'error': str(exc)}), 400
```

Pass both labels to `_build_epic_cohort_cache_key` and both dates to `fetch_epic_cohort_data`. Preserve scope normalization and auth-context arguments.

- [ ] **Step 8: Update every existing backend fixture**

Endpoint requests in `tests/test_epic_cohort_api.py` use `endQuarter: '2025Q2'`; the OAuth route tests use the matching `2026Q2` fixture described above. Direct fetch calls use `end_date=date(2025, 6, 30)`. Change the old exact JQL expectation to:

```python
'issuetype = Epic AND project in ("PRODUCT") AND created >= "2025-01-01" AND created < "2025-07-01"'
```

Do not weaken pagination, Ad Hoc grouping, status, auth, or enrichment assertions.

- [ ] **Step 9: Run backend verification**

```bash
.venv/bin/python -m unittest tests.test_epic_cohort_api tests.test_oauth_stats_routes
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add jira_server.py tests/test_epic_cohort_api.py tests/test_oauth_stats_routes.py
git commit -m "fix: bound lead time cohorts by end quarter"
```

### Task 4: Add End Quarter State, Controls, And Matching Jira Links

**Files:**
- Modify: `frontend/src/cohort/cohortUtils.js:18-45`
- Modify: `frontend/src/dashboard.jsx:40-55, 690-705, 4640-4980, 5320-5410, 6670-6905, 13995-14045, 14105-14190`
- Modify: `frontend/src/cohort/LeadTimesWorkflowStatusCard.jsx:1-25`
- Modify: `frontend/src/cohort/LeadTimesEpicCharts.jsx:1-95`
- Modify: `frontend/src/jiraExportUtils.mjs:115-220`
- Modify: `docs/README_ANALYTICS.md` (`No-Event Allowlist`)
- Test: `tests/test_stats_utils.js`
- Test: `tests/test_jira_export_utils.js:1-75`
- Test: `tests/test_stats_module_extraction_source_guards.js`
- Test: `tests/ui/codebase_structure_smoke.spec.js:1080-1175, 1389-1460`

**Interfaces:**
- Produces: `compareQuarterLabels(left: string, right: string): number | null`.
- Persists: `cohortEndQuarter` beside `cohortStartQuarter`.
- Extends: both Jira cohort URL builders with `endQuarter`.
- Consumes: Task 3 endpoint contract.

- [ ] **Step 1: Write and run the failing comparison test**

```js
const { compareQuarterLabels } = await import('../frontend/src/cohort/cohortUtils.js');
assert.equal(compareQuarterLabels('2026Q1', '2026Q2'), -1);
assert.equal(compareQuarterLabels('2026Q2', '2026Q2'), 0);
assert.equal(compareQuarterLabels('2026Q3', '2026Q2'), 1);
assert.equal(compareQuarterLabels('invalid', '2026Q2'), null);
```

Run: `node --test tests/test_stats_utils.js`

Expected: FAIL because the helper is missing.

- [ ] **Step 2: Implement quarter comparison**

```js
function quarterOrdinal(label) {
    const match = String(label || '').trim().match(/^(\d{4})Q([1-4])$/i);
    if (!match) return null;
    return (Number(match[1]) * 4) + Number(match[2]) - 1;
}

export function compareQuarterLabels(left, right) {
    const leftOrdinal = quarterOrdinal(left);
    const rightOrdinal = quarterOrdinal(right);
    if (leftOrdinal === null || rightOrdinal === null) return null;
    return Math.sign(leftOrdinal - rightOrdinal);
}
```

- [ ] **Step 3: Write failing Jira-link bounds tests**

Pass `endQuarter: '2026Q2'` to both builders and expect:

```text
created >= "2026-04-01" AND created < "2026-07-01"
```

Add a row-selection assertion proving `rowKey` keeps its own month/quarter bounds without an additional overall range clause.

- [ ] **Step 4: Extend Jira export helpers**

```js
function cohortDateClauses({ startQuarter, endQuarter, groupBy, rowKey } = {}) {
    // Keep the existing rowKey month and quarter branches first.
    const startDate = startDateFromQuarterLabel(startQuarter);
    const endDate = nextQuarterStartDate(endQuarter);
    return startDate && endDate
        ? [`created >= "${startDate}"`, `created < "${endDate}"`]
        : [];
}
```

Add `endQuarter` to `buildJiraCohortIssueSearchUrl` and `buildJiraCohortStatusSearchUrl`, and pass it through.

- [ ] **Step 5: Add and persist `cohortEndQuarter`**

```js
const [cohortStartQuarter, setCohortStartQuarter] = useState(savedPrefsRef.current.cohortStartQuarter || getCurrentQuarterLabel());
const [cohortEndQuarter, setCohortEndQuarter] = useState(savedPrefsRef.current.cohortEndQuarter || getCurrentQuarterLabel());
```

Add `cohortEndQuarter` to `buildDefaultGroupState`, `buildGroupStateSnapshot`, its dependency list, `applyGroupState`, the `saveUiPrefs` payload, and its dependency list. Restore with `nextState.cohortEndQuarter || getCurrentQuarterLabel()`.

- [ ] **Step 6: Add last-control-wins selectors**

Import `compareQuarterLabels`. Update Start Quarter:

```jsx
onChange={(event) => {
    const nextStart = event.target.value;
    setCohortStartQuarter(nextStart);
    if (compareQuarterLabels(nextStart, cohortEndQuarter) > 0) setCohortEndQuarter(nextStart);
    setCohortSelectedRow(null);
}}
```

Add immediately after it:

```jsx
<div className="stats-control-group">
    <label>End Quarter</label>
    <select
        className="scenario-input"
        value={cohortEndQuarter}
        onChange={(event) => {
            const nextEnd = event.target.value;
            setCohortEndQuarter(nextEnd);
            if (compareQuarterLabels(cohortStartQuarter, nextEnd) > 0) setCohortStartQuarter(nextEnd);
            setCohortSelectedRow(null);
        }}
    >
        {cohortQuarterOptions.map((quarterLabel) => (
            <option key={quarterLabel} value={quarterLabel}>{quarterLabel}</option>
        ))}
    </select>
</div>
```

Keep `buildQuarterOptions(getCurrentQuarterLabel(), 16)` so future quarters are absent.

- [ ] **Step 7: Update query key, guard, body, and dependencies**

```js
const cohortQueryKey = React.useMemo(() => {
    const startQuarter = String(cohortStartQuarter || '').trim();
    const endQuarter = String(cohortEndQuarter || '').trim();
    if (!startQuarter || !endQuarter) return '';
    return `${startQuarter}::${endQuarter}::${cohortScopedTeamSignature}::${adHocEpicSignature || 'no-adhoc'}`;
}, [cohortStartQuarter, cohortEndQuarter, cohortScopedTeamSignature, adHocEpicSignature]);
```

The request-effect guard becomes `Start and end quarter are required.` The body is:

```js
{
    startQuarter,
    endQuarter,
    teamIds: burnoutScopedTeamIds,
    components: activeGroupMissingComponents,
    adHocCapacityEpics: activeGroupAdHocCapacityEpics,
    refresh: false
}
```

Add `cohortEndQuarter` to effect dependencies. Do not add grouping or client-side filter state to the key.

- [ ] **Step 8: Align cards, charts, links, and copy**

Pass `cohortEndQuarter` into `LeadTimesWorkflowStatusCard` and `LeadTimesEpicCharts`, then `endQuarter` into their URL builders. Replace the two descriptions with:

```text
Created within the selected Lead Times quarter range and still non-terminal today.
Created within the selected Lead Times quarter range and reached a terminal status, with lead time shown.
```

- [ ] **Step 9: Update Playwright contracts**

Seed both values and assert the request:

```js
cohortStartQuarter: '2026Q1',
cohortEndQuarter: '2026Q2',
```

```js
expect(cohortCall.body).toMatchObject({
    startQuarter: '2026Q1',
    endQuarter: '2026Q2',
    teamIds: groupTeamIds,
    components: [],
    refresh: false,
});
```

Assert all unselected-row Jira links contain `created >= "2026-01-01"` and `created < "2026-07-01"`. Exercise reconciliation using the existing control-group markup rather than `getByLabel` (the current labels are not associated with the selects):

```js
const controls = page.locator('.stats-view.open .cohort-controls');
const startQuarter = controls.locator('.stats-control-group', { hasText: 'Start Quarter' }).locator('select');
const endQuarter = controls.locator('.stats-control-group', { hasText: 'End Quarter' }).locator('select');
await startQuarter.selectOption('2026Q3');
await expect(startQuarter).toHaveValue('2026Q3');
await expect(endQuarter).toHaveValue('2026Q3');
await endQuarter.selectOption('2026Q1');
await expect(startQuarter).toHaveValue('2026Q1');
await expect(endQuarter).toHaveValue('2026Q1');
```

After each selector event, wait for exactly one additional debounced cohort request and assert the reconciled bodies are `2026Q3/2026Q3` and `2026Q1/2026Q1`; assert no request ever contains an inverted pair. Finally select End Quarter `2026Q2`, wait for exactly one additional `2026Q1/2026Q2` request, and capture a settled `statistics-lead-times-quarter-range` screenshot.

Poll `jira_dashboard_ui_prefs_v1` until it contains both selected values, reload, and assert the controls and first reloaded cohort request restore the same pair. Change Group By between Quarter and Month and assert the cohort request count does not change. Add source-guard markers for `cohortEndQuarter` in `buildDefaultGroupState`, `buildGroupStateSnapshot`, `applyGroupState`, and the `saveUiPrefs` payload so per-group restoration cannot be omitted silently.

- [ ] **Step 10: Record the analytics no-event decision**

Add one row to `docs/README_ANALYTICS.md` under `### No-Event Allowlist`:

```text
Statistics consistency fixes (shared team colors, Excluded Capacity Range-card removal, Lead Times End Quarter) | affected Statistics source anchors | Corrective rendering/filter parity only; existing Statistics view analytics and Jira external-link analytics cover the workflow, and a new event would duplicate the existing uninstrumented Start Quarter interaction without a new product decision. | 2026-07-13
```

Do not add an event name, parameter, custom dimension, GTM change, or runbook step.

- [ ] **Step 11: Run focused frontend tests**

```bash
node --test tests/test_stats_utils.js tests/test_jira_export_utils.js tests/test_stats_module_extraction_source_guards.js
npm run build
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Lead Times caps"
```

Expected: PASS with no unexpected API calls. Rebuilding is mandatory because both matching smoke tests use committed dist; keep generated output unstaged until Task 5.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/cohort/cohortUtils.js frontend/src/dashboard.jsx frontend/src/cohort/LeadTimesWorkflowStatusCard.jsx frontend/src/cohort/LeadTimesEpicCharts.jsx frontend/src/jiraExportUtils.mjs tests/test_stats_utils.js tests/test_jira_export_utils.js tests/test_stats_module_extraction_source_guards.js tests/ui/codebase_structure_smoke.spec.js docs/README_ANALYTICS.md
git commit -m "fix: add lead time end quarter control"
```

### Task 5: Build, Regress, Visually Verify, And Close The Plan

**Files:**
- Modify generated: `frontend/dist/dashboard.js`
- Modify generated: `frontend/dist/dashboard.js.map`
- Modify after accepted execution: `docs/plans/EXEC-statistics-consistency-bugfix.md`, `docs/plans/README.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: clean generated output and verification evidence.

- [ ] **Step 1: Build frontend output**

Run: `npm run build`

Expected: build succeeds; generated `frontend/dist/` changes are derived from source.

- [ ] **Step 2: Run focused regression suites**

```bash
node --test tests/test_stats_utils.js tests/test_burnout_chart_utils.js tests/test_jira_export_utils.js tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_stats_source_guards.js tests/test_stats_module_extraction_source_guards.js
.venv/bin/python -m unittest tests.test_epic_cohort_api tests.test_oauth_stats_routes
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Statistics subviews|Excluded Capacity summary|Lead Times caps"
```

Expected: all PASS.

- [ ] **Step 3: Run the full suite**

Run:

```bash
npm run test:frontend:unit
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:ui
```

Expected: all frontend unit, backend, and Playwright suites PASS before push.

- [ ] **Step 4: Perform settled visual verification**

Verify:

```text
Priority, Burndown, Mono vs Cross: identical Alpha/Beta colors
Excluded Capacity: five cards and no blank Range slot
Lead Times: both quarter controls; current quarter does not create future empty months
MRT017: chart hover readouts stay within bounds
MRT018: long Lead Times lists retain load-more and panel containment
```

- [ ] **Step 5: Check repository state**

```bash
git diff --check
git status --short
git diff --stat
git log --oneline -5
```

Expected: no whitespace errors or unrelated files.

- [ ] **Step 6: Commit generated output**

```bash
git add frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "build: refresh statistics frontend bundle"
```

- [ ] **Step 7: Mark done only after acceptance or merge**

```bash
git mv docs/plans/EXEC-statistics-consistency-bugfix.md docs/plans/DONE-statistics-consistency-bugfix.md
git add docs/plans/DONE-statistics-consistency-bugfix.md docs/plans/README.md
git commit -m "docs: record statistics bugfix execution"
```

Add the execution commit/PR note and move the README entry from active to done. Do not rename before acceptance or merge.
