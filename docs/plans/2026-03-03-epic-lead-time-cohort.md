# Epic Lead Time Cohort Chart — Implementation Plan (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full-screen "Lead Times" panel showing epic delivery throughput in a retention-style cohort grid with summary cards, status toggles, project/assignee filters, and an in-progress epics bar chart.

**Architecture:** New `POST /api/stats/epic-cohort` backend endpoint fetches ALL epics via JQL (2-phase: base fields + changelog for resolved epics missing resolutiondate), returns cohorts grouped by creation period with full status data. Frontend applies status/project/assignee filters client-side, builds grid model, summary cards, and open-epics bar chart. Module structure: `frontend/src/cohort/` with utils + two presentational components.

**Tech Stack:** Python/Flask backend, React (via CDN) frontend, esbuild bundler, unittest for backend tests.

**Design doc:** `docs/plans/2026-03-03-epic-lead-time-cohort-design.md`

---

## Task 1: Backend — Period helper functions + tests

**Files:**
- Modify: `jira_server.py` (add helpers near `quarter_dates_from_label` at line ~432)
- Create: `tests/test_epic_cohort_api.py`

**Step 1: Write the failing test**

Create `tests/test_epic_cohort_api.py`:

```python
import unittest
from datetime import date

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortHelpers(unittest.TestCase):

    def test_quarter_dates_from_label(self):
        start, end = jira_server.quarter_dates_from_label('2025Q1')
        self.assertEqual(start, date(2025, 1, 1))
        self.assertEqual(end, date(2025, 3, 31))

    def test_month_dates_from_iso(self):
        start, end = jira_server.month_dates_from_iso('2025-03')
        self.assertEqual(start, date(2025, 3, 1))
        self.assertEqual(end, date(2025, 3, 31))

    def test_month_dates_from_iso_february_leap(self):
        start, end = jira_server.month_dates_from_iso('2024-02')
        self.assertEqual(end, date(2024, 2, 29))

    def test_generate_period_labels_quarters(self):
        labels = jira_server.generate_period_labels('2025Q1', '2026Q1', 'quarter')
        self.assertEqual(labels, ['2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1'])

    def test_generate_period_labels_months(self):
        labels = jira_server.generate_period_labels('2025Q1', '2025Q2', 'month')
        self.assertEqual(labels[:3], ['2025-01', '2025-02', '2025-03'])
        self.assertEqual(len(labels), 6)  # Jan through Jun

    def test_assign_to_period_quarter(self):
        period = jira_server.assign_to_period(date(2025, 2, 15), 'quarter')
        self.assertEqual(period, '2025Q1')

    def test_assign_to_period_month(self):
        period = jira_server.assign_to_period(date(2025, 2, 15), 'month')
        self.assertEqual(period, '2025-02')
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_epic_cohort_api.py -v`
Expected: FAIL — `month_dates_from_iso`, `generate_period_labels`, `assign_to_period` not defined.

**Step 3: Write minimal implementation**

Add to `jira_server.py` after `quarter_dates_from_label` (line ~432):

```python
def month_dates_from_iso(iso_month):
    """Return start/end for an ISO month string like '2025-03'."""
    import calendar
    match = re.match(r'^(\d{4})-(\d{2})$', str(iso_month or '').strip())
    if not match:
        return None, None
    year, month = int(match.group(1)), int(match.group(2))
    _, last_day = calendar.monthrange(year, month)
    return date(year, month, 1), date(year, month, last_day)


def generate_period_labels(start_label, end_label, group_by):
    """Generate ordered period labels from start quarter to end quarter (inclusive)."""
    start, _ = quarter_dates_from_label(start_label)
    _, end_q_end = quarter_dates_from_label(end_label)
    if not start or not end_q_end:
        return []
    if group_by == 'quarter':
        labels = []
        current = start
        while current <= end_q_end:
            q = (current.month - 1) // 3 + 1
            labels.append(f'{current.year}Q{q}')
            month = current.month + 3
            year = current.year
            if month > 12:
                month -= 12
                year += 1
            current = date(year, month, 1)
        return labels
    else:
        labels = []
        current = start
        while current <= end_q_end:
            labels.append(f'{current.year}-{current.month:02d}')
            month = current.month + 1
            year = current.year
            if month > 12:
                month = 1
                year += 1
            current = date(year, month, 1)
        return labels


def assign_to_period(d, group_by):
    """Assign a date to its cohort period label."""
    if group_by == 'quarter':
        q = (d.month - 1) // 3 + 1
        return f'{d.year}Q{q}'
    return f'{d.year}-{d.month:02d}'
```

**Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_epic_cohort_api.py -v`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add tests/test_epic_cohort_api.py jira_server.py
git commit -m "feat: add period helper functions for epic cohort"
```

---

## Task 2: Backend — Epic cohort fetch function + tests

**Files:**
- Modify: `jira_server.py` (add `fetch_epic_cohort_data`)
- Modify: `tests/test_epic_cohort_api.py`

**Step 1: Write the failing test**

Add to `tests/test_epic_cohort_api.py`:

```python
class DummyResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


from unittest.mock import patch


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortFetch(unittest.TestCase):

    def _make_epic(self, key, created, status, resolution=None, team_id='T1',
                   team_name='Team Alpha', project='PROD', assignee_id='a1',
                   assignee_name='Alice'):
        return {
            'key': key,
            'fields': {
                'summary': f'Epic {key}',
                'created': f'{created}T10:00:00.000+0000',
                'resolutiondate': f'{resolution}T10:00:00.000+0000' if resolution else None,
                'duedate': None,
                'status': {'name': status},
                'project': {'key': project},
                'assignee': {'accountId': assignee_id, 'displayName': assignee_name},
                'customfield_30101': {'id': team_id, 'name': team_name}
            }
        }

    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'jira_search_request')
    def test_done_epics_grouped_into_cohorts(self, mock_search, mock_config):
        mock_search.return_value = DummyResponse({
            'issues': [
                self._make_epic('PROD-10', '2025-01-15', 'Done', '2025-04-20'),
                self._make_epic('PROD-20', '2025-02-10', 'Done', '2025-02-28'),
            ],
            'total': 2, 'startAt': 0, 'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1', group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101'
        )

        self.assertEqual(len(result['cohorts']), 1)
        self.assertEqual(result['cohorts'][0]['label'], '2025Q1')
        epics = result['cohorts'][0]['epics']
        self.assertEqual(len(epics), 2)
        epic_a = next(e for e in epics if e['key'] == 'PROD-10')
        self.assertEqual(epic_a['leadTimeDays'], 95)
        self.assertEqual(epic_a['status'], 'Done')

    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'jira_search_request')
    def test_open_epics_have_status_open(self, mock_search, mock_config):
        mock_search.return_value = DummyResponse({
            'issues': [
                self._make_epic('PROD-40', '2025-03-01', 'In Progress'),
            ],
            'total': 1, 'startAt': 0, 'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1', group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101'
        )

        epics = result['cohorts'][0]['epics']
        self.assertEqual(epics[0]['status'], 'open')
        self.assertIsNone(epics[0]['resolvedDate'])
        self.assertIsNotNone(epics[0]['leadTimeDays'])  # days open so far

    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'jira_search_request')
    def test_killed_and_incomplete_included_with_status(self, mock_search, mock_config):
        mock_search.return_value = DummyResponse({
            'issues': [
                self._make_epic('PROD-50', '2025-01-05', 'Killed', '2025-03-10'),
                self._make_epic('PROD-60', '2025-01-20', 'Incomplete', '2025-04-15'),
            ],
            'total': 2, 'startAt': 0, 'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1', group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101'
        )

        epics = result['cohorts'][0]['epics']
        statuses = {e['key']: e['status'] for e in epics}
        self.assertEqual(statuses['PROD-50'], 'Killed')
        self.assertEqual(statuses['PROD-60'], 'Incomplete')

    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'jira_search_request')
    def test_response_includes_project_and_assignee(self, mock_search, mock_config):
        mock_search.return_value = DummyResponse({
            'issues': [
                self._make_epic('PROD-70', '2025-02-01', 'Done', '2025-05-01',
                                project='TECH', assignee_id='bob', assignee_name='Bob'),
            ],
            'total': 1, 'startAt': 0, 'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1', group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101'
        )

        epic = result['cohorts'][0]['epics'][0]
        self.assertEqual(epic['project'], 'TECH')
        self.assertEqual(epic['assignee']['name'], 'Bob')
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_epic_cohort_api.py::TestEpicCohortFetch -v`
Expected: FAIL — `fetch_epic_cohort_data` not defined.

**Step 3: Write implementation**

Add to `jira_server.py` after the period helpers:

```python
def fetch_epic_cohort_data(start_quarter, group_by, headers, team_field_id,
                           team_ids=None, project_keys=None, assignee=None):
    """Fetch epics and group into cohorts by creation period.

    Returns ALL epics (Done, Killed, Incomplete, open) so the frontend
    can toggle status filters client-side without re-fetching.

    Phase 1: Base fields via JQL.
    Phase 2: Changelog for resolved epics missing resolutiondate.
    """
    start_date, _ = quarter_dates_from_label(start_quarter)
    if not start_date:
        return {'cohorts': [], 'periods': [], 'range': {}}

    today = date.today()
    current_q = (today.month - 1) // 3 + 1
    end_label = f'{today.year}Q{current_q}'

    config = load_dashboard_config() or {}
    projects = config.get('projects', [])
    all_project_keys = [p['key'] for p in projects if p.get('key')]
    effective_projects = project_keys if project_keys else all_project_keys
    if not effective_projects:
        return {'cohorts': [], 'periods': [], 'range': {}}

    jql_parts = [
        'issuetype = Epic',
        f'project IN ({",".join(effective_projects)})',
        f'created >= "{start_date.isoformat()}"'
    ]
    if team_ids:
        team_clause = ','.join(f'"{tid}"' for tid in team_ids)
        if team_field_id:
            jql_parts.append(f'"{team_field_id}" IN ({team_clause})')
    if assignee:
        jql_parts.append(f'assignee = "{assignee}"')

    jql = ' AND '.join(jql_parts)
    fields = ['summary', 'created', 'duedate', 'status', 'resolutiondate', 'assignee', 'project']
    if team_field_id:
        fields.append(team_field_id)

    # Phase 1: paginated fetch
    all_issues = []
    start_at = 0
    max_results = 100
    while True:
        resp = jira_search_request(headers, {
            'jql': jql, 'fields': fields,
            'maxResults': max_results, 'startAt': start_at, 'expand': ''
        })
        if resp.status_code != 200:
            log_warning(f'Epic cohort JQL failed ({resp.status_code}): {resp.text[:200]}')
            break
        data = resp.json()
        issues = data.get('issues', [])
        all_issues.extend(issues)
        if start_at + len(issues) >= data.get('total', 0):
            break
        start_at += len(issues)

    # Phase 2: changelog for resolved epics missing resolutiondate
    resolved_statuses = {'done', 'killed', 'incomplete'}
    needs_changelog = [
        iss for iss in all_issues
        if str((iss.get('fields') or {}).get('status', {}).get('name', '')).strip().lower() in resolved_statuses
        and not (iss.get('fields') or {}).get('resolutiondate')
    ]
    if needs_changelog:
        def fetch_changelog(issue):
            key = issue.get('key')
            try:
                resp = resilient_jira_get(
                    f'{JIRA_URL}/rest/api/3/issue/{key}',
                    params={'fields': 'status', 'expand': 'changelog'},
                    headers=headers, timeout=20,
                    session=HTTP_SESSION, breaker=JIRA_SEARCH_CIRCUIT_BREAKER
                )
                if resp.status_code == 200:
                    issue['changelog'] = resp.json().get('changelog', {})
            except Exception as e:
                log_warning(f'Failed to fetch changelog for {key}: {e}')

        with ThreadPoolExecutor(max_workers=4) as pool:
            pool.map(fetch_changelog, needs_changelog)

    # Build epic records
    period_labels = generate_period_labels(start_quarter, end_label, group_by)
    cohort_map = {}

    for iss in all_issues:
        f = iss.get('fields') or {}
        created_dt = parse_jira_datetime(f.get('created'))
        if not created_dt:
            continue
        created_d = created_dt.date() if hasattr(created_dt, 'date') else created_dt

        status_name = str((f.get('status') or {}).get('name', '')).strip()
        status_lower = status_name.lower()
        is_resolved = status_lower in resolved_statuses

        resolved_date = None
        if is_resolved:
            res_raw = f.get('resolutiondate')
            if res_raw:
                res_dt = parse_jira_datetime(res_raw)
                resolved_date = res_dt.date() if res_dt and hasattr(res_dt, 'date') else res_dt
            else:
                target_status = status_lower
                histories = (iss.get('changelog') or {}).get('histories', [])
                for h in sorted(histories, key=lambda x: x.get('created', ''), reverse=True):
                    for item in (h.get('items') or []):
                        if str(item.get('field', '')).strip().lower() == 'status' \
                                and str(item.get('toString', '')).strip().lower() == target_status:
                            evt_dt = parse_jira_datetime(h.get('created'))
                            if evt_dt:
                                resolved_date = evt_dt.date() if hasattr(evt_dt, 'date') else evt_dt
                                break
                    if resolved_date:
                        break

        if is_resolved and resolved_date:
            lead_time = (resolved_date - created_d).days
        elif is_resolved:
            lead_time = None  # resolved but couldn't determine date
        else:
            lead_time = (today - created_d).days  # open: days since creation

        # Normalize status
        if status_lower == 'done':
            status_out = 'Done'
        elif status_lower == 'killed':
            status_out = 'Killed'
        elif status_lower == 'incomplete':
            status_out = 'Incomplete'
        else:
            status_out = 'open'

        team_raw = f.get(team_field_id) if team_field_id else None
        team_info = normalize_team_value_for_burnout(team_raw)
        assignee_info = normalize_assignee_value(f.get('assignee'))
        project_key = (f.get('project') or {}).get('key', '')

        cohort_label = assign_to_period(created_d, group_by)
        epic_record = {
            'key': iss.get('key'),
            'summary': f.get('summary', ''),
            'project': project_key,
            'team': team_info,
            'assignee': assignee_info,
            'createdDate': created_d.isoformat(),
            'resolvedDate': resolved_date.isoformat() if resolved_date else None,
            'leadTimeDays': lead_time,
            'status': status_out
        }

        cohort_map.setdefault(cohort_label, []).append(epic_record)

    # Ordered cohorts
    cohorts = []
    for label in period_labels:
        epics = cohort_map.get(label, [])
        if group_by == 'quarter':
            s, e = quarter_dates_from_label(label)
        else:
            s, e = month_dates_from_iso(label)
        if not s or not e:
            continue
        cohorts.append({
            'label': label,
            'startDate': s.isoformat(),
            'endDate': e.isoformat(),
            'epicCount': len(epics),
            'epics': epics
        })

    prefix = 'Q' if group_by == 'quarter' else 'M'
    elapsed = [f'{prefix}+{i}' for i in range(len(period_labels))]
    _, range_end = quarter_dates_from_label(end_label)

    return {
        'groupBy': group_by,
        'cohorts': cohorts,
        'periods': elapsed,
        'range': {
            'startDate': start_date.isoformat(),
            'endDate': range_end.isoformat() if range_end else today.isoformat()
        }
    }
```

**Step 4: Run tests**

Run: `python -m pytest tests/test_epic_cohort_api.py -v`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add jira_server.py tests/test_epic_cohort_api.py
git commit -m "feat: add fetch_epic_cohort_data with 2-phase fetch and all statuses"
```

---

## Task 3: Backend — `/api/stats/epic-cohort` endpoint + tests

**Files:**
- Modify: `jira_server.py` (add route after burnout endpoint ~line 4537)
- Modify: `tests/test_epic_cohort_api.py`

**Step 1: Write the failing test**

```python
@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortEndpoint(unittest.TestCase):
    def setUp(self):
        app = jira_server.app
        app.testing = True
        self.client = app.test_client()

    @patch.object(jira_server, 'fetch_epic_cohort_data')
    @patch.object(jira_server, 'resolve_team_field_id', return_value='cf_team')
    def test_post_returns_data(self, mock_team, mock_fetch):
        mock_fetch.return_value = {
            'groupBy': 'quarter', 'cohorts': [], 'periods': [], 'range': {}
        }
        resp = self.client.post('/api/stats/epic-cohort',
            json={'startQuarter': '2025Q1'}, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('data', resp.get_json())

    def test_missing_start_quarter_returns_400(self):
        resp = self.client.post('/api/stats/epic-cohort',
            json={}, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
```

**Step 2: Run test, verify fail (404)**

**Step 3: Write endpoint**

```python
@app.route('/api/stats/epic-cohort', methods=['POST'])
def get_epic_cohort_stats():
    """Fetch epic delivery lead times grouped into cohorts."""
    payload = request.get_json(silent=True) or {}
    start_quarter = str(payload.get('startQuarter', '')).strip()
    if not start_quarter:
        return jsonify({'error': 'startQuarter is required'}), 400

    group_by = str(payload.get('groupBy', 'quarter')).strip()
    if group_by not in ('quarter', 'month'):
        group_by = 'quarter'

    raw_team_ids = payload.get('teamIds', [])
    team_ids = normalize_team_ids(raw_team_ids) if isinstance(raw_team_ids, list) else []
    raw_project_keys = payload.get('projectKeys', [])
    project_keys = [str(k).strip() for k in raw_project_keys if str(k).strip()] if isinstance(raw_project_keys, list) else []
    assignee_filter = str(payload.get('assignee', '')).strip() or None

    auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
    auth_bytes = auth_string.encode('ascii')
    auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
    headers = {
        'Authorization': f'Basic {auth_base64}',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }

    team_field_id = resolve_team_field_id(headers)

    try:
        result = fetch_epic_cohort_data(
            start_quarter=start_quarter, group_by=group_by,
            headers=headers, team_field_id=team_field_id,
            team_ids=team_ids, project_keys=project_keys,
            assignee=assignee_filter
        )
    except Exception as e:
        log_warning(f'Epic cohort fetch failed: {e}')
        return jsonify({'error': str(e)}), 500

    return jsonify({'generatedAt': datetime.now().isoformat(), 'data': result})
```

**Step 4: Run tests, verify pass. Run full suite: `python -m pytest tests/ -v`**

**Step 5: Commit**

```bash
git add jira_server.py tests/test_epic_cohort_api.py
git commit -m "feat: add /api/stats/epic-cohort endpoint"
```

---

## Task 4: Frontend — `cohortUtils.js` pure functions

**Files:**
- Create: `frontend/src/cohort/cohortUtils.js`

**Key changes from v1:** Grid model builds **epic counts** per cell (not avg days). Separate functions for status filtering, summary computation, and open-epics bar data.

```js
/**
 * Pure functions for the epic lead time cohort panel.
 * Zero closure dependencies.
 */

/**
 * Compute elapsed period index for a date relative to a cohort start.
 */
export function computeElapsedPeriod(createdDate, resolvedDate, groupBy) {
    const created = new Date(`${createdDate}T00:00:00`);
    const resolved = new Date(`${resolvedDate}T00:00:00`);
    if (Number.isNaN(created.getTime()) || Number.isNaN(resolved.getTime())) return 0;
    if (groupBy === 'quarter') {
        const cQ = Math.floor(created.getMonth() / 3);
        const rQ = Math.floor(resolved.getMonth() / 3);
        return (resolved.getFullYear() - created.getFullYear()) * 4 + (rQ - cQ);
    }
    return (resolved.getFullYear() - created.getFullYear()) * 12
        + (resolved.getMonth() - created.getMonth());
}

/**
 * Filter epics by active status toggles.
 * By default only Done + open are shown.
 */
export function filterEpicsByStatus(epics, { includeKilled, includeIncomplete, includePostponed }) {
    return (epics || []).filter(e => {
        if (e.status === 'Done' || e.status === 'open') return true;
        if (e.status === 'Killed') return includeKilled;
        if (e.status === 'Incomplete') return includeIncomplete || includePostponed;
        return false;
    });
}

/**
 * Filter epics by project and assignee.
 */
export function filterEpicsByScope(epics, { project, assignee }) {
    return (epics || []).filter(e => {
        if (project && e.project !== project) return false;
        if (assignee && (e.assignee?.id || e.assignee?.name) !== assignee) return false;
        return true;
    });
}

/**
 * Build the cohort grid model: rows with cells containing epic COUNTS.
 */
export function buildCohortGridModel(cohorts, groupBy, statusFilters, scopeFilters) {
    if (!cohorts || !cohorts.length) {
        return { rows: [], maxPeriod: 0, heatmapMax: 0 };
    }

    const rows = [];
    let heatmapMax = 0;

    cohorts.forEach(cohort => {
        let filtered = filterEpicsByStatus(cohort.epics, statusFilters);
        filtered = filterEpicsByScope(filtered, scopeFilters);

        const cells = {};
        let openCount = 0;

        filtered.forEach(epic => {
            if (epic.status === 'open') {
                openCount += 1;
                return;
            }
            if (!epic.resolvedDate) return;
            const elapsed = computeElapsedPeriod(epic.createdDate, epic.resolvedDate, groupBy);
            if (!cells[elapsed]) cells[elapsed] = { count: 0, epics: [] };
            cells[elapsed].count += 1;
            cells[elapsed].epics.push(epic);
        });

        const cellArray = Object.entries(cells).map(([idx, data]) => ({
            periodIndex: Number(idx),
            count: data.count,
            epics: data.epics
        }));
        cellArray.forEach(c => { if (c.count > heatmapMax) heatmapMax = c.count; });

        rows.push({
            label: cohort.label,
            epicCount: filtered.length,
            cells: cellArray,
            openCount
        });
    });

    const maxPeriod = Math.max(0, ...rows.flatMap(r => r.cells.map(c => c.periodIndex)));

    return { rows, maxPeriod, heatmapMax };
}

/**
 * Compute summary card data from filtered cohorts.
 */
export function computeSummaryCards(cohorts, groupBy, statusFilters, scopeFilters, selectedCohortLabel) {
    let allEpics = [];
    (cohorts || []).forEach(cohort => {
        if (selectedCohortLabel && cohort.label !== selectedCohortLabel) return;
        let filtered = filterEpicsByStatus(cohort.epics, statusFilters);
        filtered = filterEpicsByScope(filtered, scopeFilters);
        allEpics = allEpics.concat(filtered);
    });

    const done = allEpics.filter(e => e.status === 'Done');
    const killed = allEpics.filter(e => e.status === 'Killed');
    const incomplete = allEpics.filter(e => e.status === 'Incomplete');
    const open = allEpics.filter(e => e.status === 'open');

    const avg = (arr) => {
        const valid = arr.filter(e => e.leadTimeDays != null);
        return valid.length ? Math.round(valid.reduce((s, e) => s + e.leadTimeDays, 0) / valid.length) : null;
    };

    return {
        total: allEpics.length,
        done: { count: done.length, avgDays: avg(done) },
        killed: { count: killed.length, avgDays: avg(killed) },
        incomplete: { count: incomplete.length, avgDays: avg(incomplete) },
        open: { count: open.length, avgDays: avg(open) }
    };
}

/**
 * Build data for the open-epics horizontal bar chart.
 * Sorted longest-first.
 */
export function buildOpenEpicsBars(cohorts, statusFilters, scopeFilters, selectedCohortLabel) {
    let openEpics = [];
    (cohorts || []).forEach(cohort => {
        if (selectedCohortLabel && cohort.label !== selectedCohortLabel) return;
        let filtered = filterEpicsByStatus(cohort.epics, statusFilters);
        filtered = filterEpicsByScope(filtered, scopeFilters);
        filtered.forEach(e => {
            if (e.status === 'open' && e.leadTimeDays != null) {
                openEpics.push({ ...e, cohortLabel: cohort.label });
            }
        });
    });
    openEpics.sort((a, b) => b.leadTimeDays - a.leadTimeDays);
    const maxDays = openEpics.length > 0 ? openEpics[0].leadTimeDays : 0;
    return { epics: openEpics, maxDays };
}

/**
 * Return heatmap opacity for a cell count (0.0 to 1.0).
 */
export function heatmapOpacity(count, maxCount) {
    if (maxCount <= 0) return 0.1;
    return 0.15 + 0.85 * (count / maxCount);
}
```

**Build:** `npm run build` → verify success.

**Commit:**
```bash
git add frontend/src/cohort/cohortUtils.js
git commit -m "feat: add cohortUtils.js with grid model, summary, and bar chart builders"
```

---

## Task 5: Frontend — `CohortGrid.jsx` + `OpenEpicsChart.jsx` components

**Files:**
- Create: `frontend/src/cohort/CohortGrid.jsx`
- Create: `frontend/src/cohort/OpenEpicsChart.jsx`

### CohortGrid.jsx

Presentational grid component. Parent passes `gridModel`, `groupBy`, `selectedRow`, `onRowClick`. Internal `hoverCell` state for tooltip.

Key rendering:
- CSS Grid with `gridTemplateColumns: 180px repeat(N+1, minmax(64px, 1fr)) 80px`
- Header row: period labels + "Open" column
- Data rows: cohort label (clickable), cells with count + heatmap opacity, open count
- Hover tooltip: status breakdown + epic list
- Selected row: highlighted border

### OpenEpicsChart.jsx

Horizontal bar chart component. Parent passes `barsData` (from `buildOpenEpicsBars`). Internal hover state.

Key rendering:
- Each bar: `<div>` with width proportional to `leadTimeDays / maxDays`
- Color by project (hash-based from `resolveTeamColor`)
- Labels: epic key, days, assignee name
- Hover: full summary tooltip

**Build:** `npm run build` → verify success.

**Commit:**
```bash
git add frontend/src/cohort/CohortGrid.jsx frontend/src/cohort/OpenEpicsChart.jsx
git commit -m "feat: add CohortGrid and OpenEpicsChart components"
```

---

## Task 6: Frontend — Dashboard integration (state, fetch, panel)

**Files:**
- Modify: `frontend/src/dashboard.jsx`

### State additions (near line 281):
```js
const [showLeadTimes, setShowLeadTimes] = useState(false);
const [cohortData, setCohortData] = useState(null);
const [cohortLoading, setCohortLoading] = useState(false);
const [cohortError, setCohortError] = useState('');
const [cohortGroupBy, setCohortGroupBy] = useState('quarter');
const [cohortStartQuarter, setCohortStartQuarter] = useState('');
const [cohortIncludeKilled, setCohortIncludeKilled] = useState(false);
const [cohortIncludeIncomplete, setCohortIncludeIncomplete] = useState(false);
const [cohortIncludePostponed, setCohortIncludePostponed] = useState(false);
const [cohortProjectFilter, setCohortProjectFilter] = useState('');
const [cohortAssigneeFilter, setCohortAssigneeFilter] = useState('');
const [cohortSelectedRow, setCohortSelectedRow] = useState(null);
const cohortCacheRef = useRef({});
```

### Mutual exclusivity (near line 2864):
- Add `setShowLeadTimes(false)` to showPlanning/showStats/showScenario effects
- Add new effect: `if (showLeadTimes) { setShowPlanning(false); setShowStats(false); setShowScenario(false); }`

### Fetch effect:
- Triggers on: `showLeadTimes`, `cohortStartQuarter`, `selectedTeams`
- Does NOT refetch on status toggle / project / assignee / groupBy changes (client-side filtering)
- Follows burnout fetch pattern: AbortController, 120ms debounce, cache by query key

### Memos:
```js
const cohortStatusFilters = React.useMemo(() => ({
    includeKilled: cohortIncludeKilled,
    includeIncomplete: cohortIncludeIncomplete,
    includePostponed: cohortIncludePostponed
}), [cohortIncludeKilled, cohortIncludeIncomplete, cohortIncludePostponed]);

const cohortScopeFilters = React.useMemo(() => ({
    project: cohortProjectFilter || null,
    assignee: cohortAssigneeFilter || null
}), [cohortProjectFilter, cohortAssigneeFilter]);

const cohortGridModel = React.useMemo(
    () => buildCohortGridModel(cohortData?.cohorts, cohortGroupBy, cohortStatusFilters, cohortScopeFilters),
    [cohortData, cohortGroupBy, cohortStatusFilters, cohortScopeFilters]
);

const cohortSummary = React.useMemo(
    () => computeSummaryCards(cohortData?.cohorts, cohortGroupBy, cohortStatusFilters, cohortScopeFilters, cohortSelectedRow),
    [cohortData, cohortGroupBy, cohortStatusFilters, cohortScopeFilters, cohortSelectedRow]
);

const cohortOpenBars = React.useMemo(
    () => buildOpenEpicsBars(cohortData?.cohorts, cohortStatusFilters, cohortScopeFilters, cohortSelectedRow),
    [cohortData, cohortStatusFilters, cohortScopeFilters, cohortSelectedRow]
);
```

### Header toggle button (after Scenario):
```jsx
<button
    className={`mode-switch-button ${showLeadTimes ? 'active' : ''}`}
    onClick={() => setShowLeadTimes(!showLeadTimes)}
    title="Toggle epic lead times cohort"
>
    Lead Times
</button>
```

### Panel JSX:
Full-bleed panel with: controls bar (groupBy toggle, start selector, project/assignee dropdowns, 3 status toggles), summary cards, CohortGrid, OpenEpicsChart.

### Persist in savedPrefsRef:
Add `showLeadTimes` (forced false on load), `cohortGroupBy`, `cohortStartQuarter`.

**Build:** `npm run build` → verify success.

**Commit:**
```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: integrate Lead Times panel with state, fetch, and rendering"
```

---

## Task 7: CSS — Cohort panel styles

**Files:**
- Modify: `frontend/dist/dashboard.css`

Add styles for:
- `.cohort-fullbleed`, `.cohort-panel`, `.cohort-inner`, `.cohort-panel-header`
- `.cohort-title`, `.cohort-subtitle`, `.cohort-controls`
- `.cohort-grid-container`, `.cohort-grid` (CSS Grid)
- `.cohort-header`, `.cohort-row-label` (clickable, selected state)
- `.cohort-cell` (with heatmap opacity via inline style)
- `.cohort-cell-open` (amber)
- `.cohort-tooltip` (positioned, dark background)
- `.cohort-summary` (flex row of cards)
- `.cohort-summary-card` (with `.active` state for drill-down)
- `.cohort-open-chart` (bar chart container)
- `.cohort-bar` (horizontal bar with project color)
- `.cohort-bar-label` (key + days + assignee)
- Hover highlight styles (row + column crosshair)
- Loading/error/empty states

Follow existing dark theme (`#1e293b`, `#0f172a`, `#e2e8f0`, `#94a3b8` palette).

**Build:** `npm run build` → verify.

**Commit:**
```bash
git add frontend/dist/dashboard.css
git commit -m "feat: add cohort panel CSS styles"
```

---

## Task 8: Build, full test suite, push

**Step 1:** `python -m pytest tests/ -v` → all pass
**Step 2:** `npm run build` → succeeds
**Step 3:** `git push -u origin plan/epic-lead-time-cohort`

---

## Execution Summary

| Task | What | Files | ~Lines |
|------|------|-------|--------|
| 1 | Period helpers + tests | `jira_server.py`, `test_epic_cohort_api.py` | ~80 |
| 2 | Cohort fetch function + tests | `jira_server.py`, `test_epic_cohort_api.py` | ~200 |
| 3 | API endpoint + tests | `jira_server.py`, `test_epic_cohort_api.py` | ~50 |
| 4 | `cohortUtils.js` (6 pure functions) | `frontend/src/cohort/cohortUtils.js` | ~160 |
| 5 | `CohortGrid.jsx` + `OpenEpicsChart.jsx` | `frontend/src/cohort/` | ~200 |
| 6 | Dashboard integration | `frontend/src/dashboard.jsx` | ~180 |
| 7 | CSS styles | `frontend/dist/dashboard.css` | ~100 |
| 8 | Verification | — | — |
| **Total** | | **7 files** | **~970 lines** |

### Key v2 changes from v1:
- Cells show **epic counts** (not avg days)
- **All statuses** fetched; 3 client-side toggles (Killed/Incomplete/Postponed, all OFF by default)
- **Project + Assignee** client-side filters
- **Summary cards** with drill-down on cohort row click
- **Open-epics horizontal bar chart** sorted longest-first
- Backend returns richer data (project, assignee, all statuses)
