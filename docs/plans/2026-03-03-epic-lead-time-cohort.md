# Epic Lead Time Cohort Chart — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full-screen "Lead Times" panel showing epic delivery lead times in a retention-style cohort grid, powered by a dedicated backend endpoint.

**Architecture:** New `POST /api/stats/epic-cohort` backend endpoint fetches epics via JQL (2-phase: base fields + changelog for Done epics missing resolutiondate), returns cohorts grouped by creation period. Frontend adds a top-level toggle, state/fetch effect, and a `frontend/src/cohort/` module with pure grid-building utils and a presentational `CohortGrid` component.

**Tech Stack:** Python/Flask backend, React (via CDN) frontend, esbuild bundler, unittest for backend tests.

**Design doc:** `docs/plans/2026-03-03-epic-lead-time-cohort-design.md`

---

## Task 1: Backend — `quarter_dates_from_label` extension and date helpers

**Files:**
- Modify: `jira_server.py` (add `month_dates_from_label` helper near `quarter_dates_from_label` at line ~432)
- Test: `tests/test_epic_cohort_api.py` (create)

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

    def test_month_dates_from_label(self):
        start, end = jira_server.month_dates_from_label('2025Q1')
        # Returns first month of Q1 → January 2025
        self.assertEqual(start, date(2025, 1, 1))
        self.assertEqual(end, date(2025, 1, 31))

    def test_month_dates_from_iso_month(self):
        start, end = jira_server.month_dates_from_iso('2025-03')
        self.assertEqual(start, date(2025, 3, 1))
        self.assertEqual(end, date(2025, 3, 31))

    def test_generate_period_labels_quarters(self):
        labels = jira_server.generate_period_labels('2025Q1', '2026Q1', 'quarter')
        self.assertEqual(labels, ['2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1'])

    def test_generate_period_labels_months(self):
        labels = jira_server.generate_period_labels('2025Q1', '2025Q2', 'month')
        self.assertEqual(labels[:3], ['2025-01', '2025-02', '2025-03'])

    def test_assign_epic_to_period_quarter(self):
        period = jira_server.assign_to_period(date(2025, 2, 15), 'quarter')
        self.assertEqual(period, '2025Q1')

    def test_assign_epic_to_period_month(self):
        period = jira_server.assign_to_period(date(2025, 2, 15), 'month')
        self.assertEqual(period, '2025-02')
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_epic_cohort_api.py -v`
Expected: FAIL — `month_dates_from_iso`, `generate_period_labels`, `assign_to_period` not defined.

**Step 3: Write minimal implementation**

Add to `jira_server.py` after `quarter_dates_from_label` (line ~432):

```python
def month_dates_from_label(quarter_label):
    """Return first month's start/end from a quarter label like '2025Q1'."""
    start, _ = quarter_dates_from_label(quarter_label)
    if not start:
        return None, None
    import calendar
    _, last_day = calendar.monthrange(start.year, start.month)
    return start, date(start.year, start.month, last_day)


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
    """Generate ordered period labels from start to end (inclusive)."""
    if group_by == 'quarter':
        start, _ = quarter_dates_from_label(start_label)
        end, _ = quarter_dates_from_label(end_label)
        if not start or not end:
            return []
        labels = []
        current = start
        while current <= end:
            q = (current.month - 1) // 3 + 1
            labels.append(f'{current.year}Q{q}')
            month = current.month + 3
            year = current.year
            if month > 12:
                month -= 12
                year += 1
            current = date(year, month, 1)
        return labels
    else:  # month
        start, _ = quarter_dates_from_label(start_label)
        end_q_start, end_q_end = quarter_dates_from_label(end_label)
        if not start or not end_q_end:
            return []
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

## Task 2: Backend — Epic cohort fetch function

**Files:**
- Modify: `jira_server.py` (add `fetch_epic_cohort_data` function)
- Test: `tests/test_epic_cohort_api.py` (add tests)

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


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortFetch(unittest.TestCase):

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'resilient_jira_get')
    def test_fetch_groups_done_epics_into_cohorts(self, mock_get, mock_config, mock_team):
        """Done epics with resolutiondate are grouped by creation quarter."""
        mock_get.return_value = DummyResponse({
            'issues': [
                {
                    'key': 'PROD-10',
                    'fields': {
                        'summary': 'Epic A',
                        'created': '2025-01-15T10:00:00.000+0000',
                        'resolutiondate': '2025-04-20T10:00:00.000+0000',
                        'duedate': None,
                        'status': {'name': 'Done'},
                        'customfield_30101': {'id': 'T1', 'name': 'Team Alpha'}
                    }
                },
                {
                    'key': 'PROD-20',
                    'fields': {
                        'summary': 'Epic B',
                        'created': '2025-02-10T10:00:00.000+0000',
                        'resolutiondate': '2025-02-28T10:00:00.000+0000',
                        'duedate': None,
                        'status': {'name': 'Done'},
                        'customfield_30101': {'id': 'T1', 'name': 'Team Alpha'}
                    }
                }
            ],
            'total': 2,
            'startAt': 0,
            'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1',
            group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            include_postponed=False
        )

        self.assertIsNotNone(result)
        cohorts = result['cohorts']
        self.assertEqual(len(cohorts), 1)
        self.assertEqual(cohorts[0]['label'], '2025Q1')
        self.assertEqual(len(cohorts[0]['epics']), 2)
        # PROD-10: created 2025-01-15, done 2025-04-20 → 95 days
        epic_a = next(e for e in cohorts[0]['epics'] if e['key'] == 'PROD-10')
        self.assertEqual(epic_a['leadTimeDays'], 95)
        self.assertEqual(epic_a['status'], 'Done')
        # PROD-20: created 2025-02-10, done 2025-02-28 → 18 days
        epic_b = next(e for e in cohorts[0]['epics'] if e['key'] == 'PROD-20')
        self.assertEqual(epic_b['leadTimeDays'], 18)

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'resilient_jira_get')
    def test_fetch_excludes_killed_epics(self, mock_get, mock_config, mock_team):
        """Killed epics are excluded from the cohort."""
        mock_get.return_value = DummyResponse({
            'issues': [
                {
                    'key': 'PROD-30',
                    'fields': {
                        'summary': 'Epic Killed',
                        'created': '2025-01-10T10:00:00.000+0000',
                        'resolutiondate': None,
                        'duedate': None,
                        'status': {'name': 'Killed'},
                        'customfield_30101': {'id': 'T1', 'name': 'Team Alpha'}
                    }
                }
            ],
            'total': 1,
            'startAt': 0,
            'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1',
            group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            include_postponed=False
        )

        # Killed epics filtered out by JQL, so no cohorts
        all_epics = [e for c in result['cohorts'] for e in c['epics']]
        killed = [e for e in all_epics if e['status'] == 'Killed']
        self.assertEqual(len(killed), 0)

    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    @patch.object(jira_server, 'load_dashboard_config', return_value={
        'projects': [{'key': 'PROD', 'bucket': 'product'}]
    })
    @patch.object(jira_server, 'resilient_jira_get')
    def test_open_epics_have_null_lead_time(self, mock_get, mock_config, mock_team):
        """Open (non-Done) epics have null doneDate and leadTimeDays."""
        mock_get.return_value = DummyResponse({
            'issues': [
                {
                    'key': 'PROD-40',
                    'fields': {
                        'summary': 'Epic Open',
                        'created': '2025-03-01T10:00:00.000+0000',
                        'resolutiondate': None,
                        'duedate': None,
                        'status': {'name': 'In Progress'},
                        'customfield_30101': {'id': 'T1', 'name': 'Team Alpha'}
                    }
                }
            ],
            'total': 1,
            'startAt': 0,
            'maxResults': 100
        })

        result = jira_server.fetch_epic_cohort_data(
            start_quarter='2025Q1',
            group_by='quarter',
            headers={'Authorization': 'Basic test'},
            team_field_id='customfield_30101',
            team_ids=[],
            include_postponed=False
        )

        epics = result['cohorts'][0]['epics']
        self.assertEqual(len(epics), 1)
        self.assertIsNone(epics[0]['doneDate'])
        self.assertIsNone(epics[0]['leadTimeDays'])
        self.assertEqual(epics[0]['status'], 'open')
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_epic_cohort_api.py::TestEpicCohortFetch -v`
Expected: FAIL — `fetch_epic_cohort_data` not defined.

**Step 3: Write minimal implementation**

Add to `jira_server.py` after the period helper functions:

```python
def fetch_epic_cohort_data(start_quarter, group_by, headers, team_field_id,
                           team_ids=None, include_postponed=False):
    """Fetch epics and group into cohorts by creation period.

    Phase 1: Base fields via JQL (fast).
    Phase 2: Changelog for Done epics missing resolutiondate.
    """
    start_date, _ = quarter_dates_from_label(start_quarter)
    if not start_date:
        return {'cohorts': [], 'periods': [], 'range': {}}

    # Determine current quarter label for range end
    today = date.today()
    current_q = (today.month - 1) // 3 + 1
    end_label = f'{today.year}Q{current_q}'

    # Build project list from config
    config = load_dashboard_config() or {}
    projects = config.get('projects', [])
    project_keys = [p['key'] for p in projects if p.get('key')]
    if not project_keys:
        return {'cohorts': [], 'periods': [], 'range': {}}

    # Phase 1: Fetch base fields
    jql_parts = [
        'issuetype = Epic',
        f'project IN ({",".join(project_keys)})',
        f'created >= "{start_date.isoformat()}"',
        'status != Killed'
    ]
    if not include_postponed:
        jql_parts.append('status != Incomplete')
    if team_ids:
        team_clause = ','.join(f'"{tid}"' for tid in team_ids)
        if team_field_id:
            jql_parts.append(f'"{team_field_id}" IN ({team_clause})')

    jql = ' AND '.join(jql_parts)
    fields = ['summary', 'created', 'duedate', 'status', 'resolutiondate']
    if team_field_id:
        fields.append(team_field_id)

    all_issues = []
    start_at = 0
    max_results = 100
    while True:
        resp = jira_search_request(headers, {
            'jql': jql,
            'fields': fields,
            'maxResults': max_results,
            'startAt': start_at,
            'expand': ''
        })
        if resp.status_code != 200:
            log_warning(f'Epic cohort JQL failed ({resp.status_code}): {resp.text[:200]}')
            break
        data = resp.json()
        issues = data.get('issues', [])
        all_issues.extend(issues)
        total = data.get('total', 0)
        if start_at + len(issues) >= total:
            break
        start_at += len(issues)

    # Phase 2: Changelog for Done epics missing resolutiondate
    needs_changelog = [
        iss for iss in all_issues
        if str((iss.get('fields') or {}).get('status', {}).get('name', '')).strip().lower() == 'done'
        and not (iss.get('fields') or {}).get('resolutiondate')
    ]
    if needs_changelog:
        def fetch_changelog(issue):
            key = issue.get('key')
            try:
                resp = resilient_jira_get(
                    f'{JIRA_URL}/rest/api/3/issue/{key}',
                    params={'fields': 'status', 'expand': 'changelog'},
                    headers=headers,
                    timeout=20,
                    session=HTTP_SESSION,
                    breaker=JIRA_SEARCH_CIRCUIT_BREAKER
                )
                if resp.status_code == 200:
                    changelog = resp.json().get('changelog', {})
                    issue['changelog'] = changelog
            except Exception as e:
                log_warning(f'Failed to fetch changelog for {key}: {e}')

        with ThreadPoolExecutor(max_workers=4) as pool:
            pool.map(fetch_changelog, needs_changelog)

    # Build epic records and group into cohorts
    period_labels = generate_period_labels(start_quarter, end_label, group_by)
    cohort_map = {}

    for iss in all_issues:
        fields_data = iss.get('fields') or {}
        created_dt = parse_jira_datetime(fields_data.get('created'))
        if not created_dt:
            continue
        created_date = created_dt.date() if hasattr(created_dt, 'date') else created_dt

        status_name = str((fields_data.get('status') or {}).get('name', '')).strip()
        is_done = status_name.lower() == 'done'
        is_incomplete = status_name.lower() == 'incomplete'

        # Resolve done date
        done_date = None
        if is_done:
            resolution_raw = fields_data.get('resolutiondate')
            if resolution_raw:
                resolution_dt = parse_jira_datetime(resolution_raw)
                done_date = resolution_dt.date() if resolution_dt else None
            else:
                # Fall back to changelog
                histories = (iss.get('changelog') or {}).get('histories', [])
                for history in sorted(histories, key=lambda h: h.get('created', ''), reverse=True):
                    for item in (history.get('items') or []):
                        if str(item.get('field', '')).strip().lower() == 'status' \
                                and str(item.get('toString', '')).strip().lower() == 'done':
                            evt_dt = parse_jira_datetime(history.get('created'))
                            if evt_dt:
                                done_date = evt_dt.date() if hasattr(evt_dt, 'date') else evt_dt
                                break
                    if done_date:
                        break

        lead_time = (done_date - created_date).days if done_date else None

        # Team
        team_raw = fields_data.get(team_field_id) if team_field_id else None
        team_info = normalize_team_value_for_burnout(team_raw)

        cohort_label = assign_to_period(created_date, group_by)
        epic_record = {
            'key': iss.get('key'),
            'summary': fields_data.get('summary', ''),
            'team': team_info,
            'createdDate': created_date.isoformat(),
            'doneDate': done_date.isoformat() if done_date else None,
            'leadTimeDays': lead_time,
            'status': 'Done' if is_done else ('Incomplete' if is_incomplete else 'open'),
            'isPostponed': is_incomplete
        }

        if cohort_label not in cohort_map:
            cohort_map[cohort_label] = []
        cohort_map[cohort_label].append(epic_record)

    # Build ordered cohorts
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

    # Build elapsed period labels
    if group_by == 'quarter':
        max_elapsed = len(period_labels)
        elapsed = [f'Q+{i}' for i in range(max_elapsed)]
    else:
        max_elapsed = len(period_labels)
        elapsed = [f'M+{i}' for i in range(max_elapsed)]

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

**Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_epic_cohort_api.py -v`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add jira_server.py tests/test_epic_cohort_api.py
git commit -m "feat: add fetch_epic_cohort_data with 2-phase fetch"
```

---

## Task 3: Backend — `/api/stats/epic-cohort` endpoint

**Files:**
- Modify: `jira_server.py` (add route handler, following burnout endpoint pattern at line ~4537)
- Test: `tests/test_epic_cohort_api.py` (add endpoint integration test)

**Step 1: Write the failing test**

Add to `tests/test_epic_cohort_api.py`:

```python
@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicCohortEndpoint(unittest.TestCase):
    def setUp(self):
        app = jira_server.app
        app.testing = True
        self.client = app.test_client()

    @patch.object(jira_server, 'fetch_epic_cohort_data')
    @patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_30101')
    def test_post_returns_cohort_data(self, mock_team, mock_fetch):
        mock_fetch.return_value = {
            'groupBy': 'quarter',
            'cohorts': [{'label': '2025Q1', 'epicCount': 2, 'epics': []}],
            'periods': ['Q+0'],
            'range': {'startDate': '2025-01-01', 'endDate': '2026-03-31'}
        }
        resp = self.client.post('/api/stats/epic-cohort',
            json={'startQuarter': '2025Q1', 'groupBy': 'quarter'},
            content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('data', data)
        self.assertEqual(data['data']['groupBy'], 'quarter')

    def test_post_missing_start_quarter_returns_400(self):
        resp = self.client.post('/api/stats/epic-cohort',
            json={'groupBy': 'quarter'},
            content_type='application/json')
        self.assertEqual(resp.status_code, 400)
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_epic_cohort_api.py::TestEpicCohortEndpoint -v`
Expected: FAIL — 404 (route not registered).

**Step 3: Write minimal implementation**

Add to `jira_server.py` after the burnout endpoint (line ~4537):

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
    include_postponed = bool(payload.get('includePostponed', False))

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
            start_quarter=start_quarter,
            group_by=group_by,
            headers=headers,
            team_field_id=team_field_id,
            team_ids=team_ids,
            include_postponed=include_postponed
        )
    except Exception as e:
        log_warning(f'Epic cohort fetch failed: {e}')
        return jsonify({'error': str(e)}), 500

    return jsonify({
        'generatedAt': datetime.now().isoformat(),
        'data': result
    })
```

**Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_epic_cohort_api.py -v`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All existing tests still pass (no regressions).

**Step 6: Commit**

```bash
git add jira_server.py tests/test_epic_cohort_api.py
git commit -m "feat: add /api/stats/epic-cohort endpoint"
```

---

## Task 4: Frontend — `cohortUtils.js` pure functions

**Files:**
- Create: `frontend/src/cohort/cohortUtils.js`

**Step 1: Write the utility module**

Create `frontend/src/cohort/cohortUtils.js`:

```js
/**
 * Pure functions for building the cohort grid model from API data.
 * Zero closure dependencies — all inputs via parameters.
 */

/**
 * Compute elapsed period index for an epic's done date relative to its cohort.
 * @param {string} createdDate - ISO date string (e.g. '2025-01-15')
 * @param {string} doneDate - ISO date string (e.g. '2025-06-20')
 * @param {string} groupBy - 'quarter' or 'month'
 * @returns {number} Elapsed period index (0 = same period as creation)
 */
export function computeElapsedPeriod(createdDate, doneDate, groupBy) {
    const created = new Date(`${createdDate}T00:00:00`);
    const done = new Date(`${doneDate}T00:00:00`);
    if (Number.isNaN(created.getTime()) || Number.isNaN(done.getTime())) return 0;

    if (groupBy === 'quarter') {
        const createdQ = Math.floor(created.getMonth() / 3);
        const doneQ = Math.floor(done.getMonth() / 3);
        return (done.getFullYear() - created.getFullYear()) * 4 + (doneQ - createdQ);
    }
    // month
    return (done.getFullYear() - created.getFullYear()) * 12
        + (done.getMonth() - created.getMonth());
}

/**
 * Build the cohort grid model from API response.
 * @param {Object} apiData - The 'data' field from /api/stats/epic-cohort response
 * @returns {Object} { rows, maxPeriod, heatmap, summary }
 */
export function buildCohortGridModel(apiData) {
    if (!apiData || !apiData.cohorts) {
        return { rows: [], maxPeriod: 0, heatmap: { p25: 0, p75: 0 }, summary: null };
    }

    const { cohorts, groupBy, periods } = apiData;
    const allLeadTimes = [];
    const rows = [];

    cohorts.forEach((cohort) => {
        const cells = {};
        let openCount = 0;
        const doneEpics = [];

        (cohort.epics || []).forEach((epic) => {
            if (epic.status === 'Done' && epic.doneDate && epic.leadTimeDays != null) {
                const elapsed = computeElapsedPeriod(epic.createdDate, epic.doneDate, groupBy);
                if (!cells[elapsed]) {
                    cells[elapsed] = { totalDays: 0, count: 0, epics: [] };
                }
                cells[elapsed].totalDays += epic.leadTimeDays;
                cells[elapsed].count += 1;
                cells[elapsed].epics.push(epic);
                allLeadTimes.push(epic.leadTimeDays);
                doneEpics.push(epic);
            } else {
                openCount += 1;
            }
        });

        // Compute averages per cell
        const cellArray = Object.entries(cells).map(([periodIdx, data]) => ({
            periodIndex: Number(periodIdx),
            avgDays: Math.round(data.totalDays / data.count),
            count: data.count,
            epics: data.epics
        }));

        rows.push({
            label: cohort.label,
            epicCount: cohort.epicCount,
            cells: cellArray,
            openCount
        });
    });

    // Compute heatmap thresholds from all lead times
    const sorted = [...allLeadTimes].sort((a, b) => a - b);
    const p25 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.25)] : 0;
    const p75 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.75)] : 0;

    // Summary
    const totalCompleted = allLeadTimes.length;
    const avgLeadTime = totalCompleted > 0
        ? Math.round(allLeadTimes.reduce((a, b) => a + b, 0) / totalCompleted)
        : 0;
    const medianLeadTime = totalCompleted > 0
        ? sorted[Math.floor(sorted.length / 2)]
        : 0;
    const totalOpen = rows.reduce((sum, r) => sum + r.openCount, 0);

    const maxPeriod = Math.max(0, ...rows.flatMap(r => r.cells.map(c => c.periodIndex)));

    return {
        rows,
        maxPeriod,
        heatmap: { p25, p75 },
        summary: {
            avgLeadTime,
            medianLeadTime,
            totalCompleted,
            totalOpen
        }
    };
}

/**
 * Return CSS class for heatmap coloring.
 * @param {number} avgDays - Average lead time in days
 * @param {Object} heatmap - { p25, p75 } thresholds
 * @returns {string} 'cohort-cell-fast' | 'cohort-cell-mid' | 'cohort-cell-slow'
 */
export function getHeatmapClass(avgDays, heatmap) {
    if (avgDays <= heatmap.p25) return 'cohort-cell-fast';
    if (avgDays >= heatmap.p75) return 'cohort-cell-slow';
    return 'cohort-cell-mid';
}
```

**Step 2: Build to verify no syntax errors**

Run: `npm run build`
Expected: Build succeeds (new file is not imported yet, but syntax is valid).

**Step 3: Commit**

```bash
git add frontend/src/cohort/cohortUtils.js
git commit -m "feat: add cohortUtils.js with grid model builder"
```

---

## Task 5: Frontend — `CohortGrid.jsx` presentational component

**Files:**
- Create: `frontend/src/cohort/CohortGrid.jsx`

**Step 1: Write the component**

Create `frontend/src/cohort/CohortGrid.jsx`:

```jsx
import * as React from 'react';
import { getHeatmapClass } from './cohortUtils.js';

const { useState } = React;

function CohortGrid({ gridModel, groupBy }) {
    const [hoverCell, setHoverCell] = useState(null);

    if (!gridModel || !gridModel.rows.length) {
        return <div className="cohort-empty">No epic data available for the selected range.</div>;
    }

    const { rows, maxPeriod, heatmap, summary } = gridModel;
    const prefix = groupBy === 'quarter' ? 'Q' : 'M';
    const periodHeaders = Array.from({ length: maxPeriod + 1 }, (_, i) => `${prefix}+${i}`);

    return (
        <div className="cohort-grid-container">
            <div className="cohort-grid" style={{
                gridTemplateColumns: `180px repeat(${maxPeriod + 2}, minmax(64px, 1fr))`
            }}>
                {/* Header row */}
                <div className="cohort-header cohort-label-col">Cohort</div>
                {periodHeaders.map((h) => (
                    <div key={h} className="cohort-header">{h}</div>
                ))}
                <div className="cohort-header cohort-open-col">Open</div>

                {/* Data rows */}
                {rows.map((row) => {
                    const cellMap = {};
                    row.cells.forEach((c) => { cellMap[c.periodIndex] = c; });

                    return (
                        <React.Fragment key={row.label}>
                            <div className="cohort-row-label">
                                {row.label}
                                <span className="cohort-row-count">({row.epicCount})</span>
                            </div>
                            {periodHeaders.map((_, idx) => {
                                const cell = cellMap[idx];
                                if (!cell) {
                                    return <div key={idx} className="cohort-cell cohort-cell-empty">--</div>;
                                }
                                const cls = getHeatmapClass(cell.avgDays, heatmap);
                                return (
                                    <div
                                        key={idx}
                                        className={`cohort-cell ${cls}`}
                                        onMouseEnter={() => setHoverCell({ row: row.label, period: idx, cell })}
                                        onMouseLeave={() => setHoverCell(null)}
                                    >
                                        {cell.avgDays}d
                                    </div>
                                );
                            })}
                            <div className="cohort-cell cohort-cell-open">
                                {row.openCount > 0 ? `◊ ${row.openCount}` : ''}
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Hover tooltip */}
            {hoverCell && (
                <div className="cohort-tooltip">
                    <div className="cohort-tooltip-title">
                        {hoverCell.row} → {prefix}+{hoverCell.period}
                    </div>
                    <div className="cohort-tooltip-avg">
                        Avg: {hoverCell.cell.avgDays}d ({hoverCell.cell.count} epics)
                    </div>
                    <div className="cohort-tooltip-list">
                        {hoverCell.cell.epics.slice(0, 10).map((epic) => (
                            <div key={epic.key} className="cohort-tooltip-epic">
                                <span className="cohort-tooltip-key">{epic.key}</span>
                                <span className="cohort-tooltip-days">{epic.leadTimeDays}d</span>
                                <span className="cohort-tooltip-summary">{epic.summary}</span>
                            </div>
                        ))}
                        {hoverCell.cell.epics.length > 10 && (
                            <div className="cohort-tooltip-more">
                                +{hoverCell.cell.epics.length - 10} more
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Summary bar */}
            {summary && (
                <div className="cohort-summary">
                    <span>Avg lead time <strong>{summary.avgLeadTime}d</strong></span>
                    <span>Median <strong>{summary.medianLeadTime}d</strong></span>
                    <span>Completed <strong>{summary.totalCompleted}</strong></span>
                    <span>Open <strong>{summary.totalOpen}</strong></span>
                    <span className="cohort-legend">
                        <i className="cohort-swatch cohort-cell-fast" /> ≤{heatmap.p25}d
                        <i className="cohort-swatch cohort-cell-mid" /> {heatmap.p25}-{heatmap.p75}d
                        <i className="cohort-swatch cohort-cell-slow" /> ≥{heatmap.p75}d
                    </span>
                </div>
            )}
        </div>
    );
}

export default React.memo(CohortGrid);
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/cohort/CohortGrid.jsx
git commit -m "feat: add CohortGrid presentational component"
```

---

## Task 6: Frontend — Dashboard state, fetch effect, panel toggle

**Files:**
- Modify: `frontend/src/dashboard.jsx`

This is the integration step. Add in this order:

**Step 1: Add imports**

At the import section (near existing scenario imports), add:

```js
import { buildCohortGridModel } from './cohort/cohortUtils.js';
import CohortGrid from './cohort/CohortGrid.jsx';
```

**Step 2: Add state variables**

Near the other panel state variables (around line 281, after `showScenario`):

```js
const [showLeadTimes, setShowLeadTimes] = useState(false);
const [cohortData, setCohortData] = useState(null);
const [cohortLoading, setCohortLoading] = useState(false);
const [cohortError, setCohortError] = useState('');
const [cohortGroupBy, setCohortGroupBy] = useState('quarter');
const [cohortStartQuarter, setCohortStartQuarter] = useState('');
const [cohortIncludePostponed, setCohortIncludePostponed] = useState(false);
const cohortCacheRef = useRef({});
```

**Step 3: Add mutual exclusivity effect**

Near the existing mutual exclusivity effects (around line 2864-2876):

```js
useEffect(() => {
    if (showLeadTimes) {
        setShowPlanning(false);
        setShowStats(false);
        setShowScenario(false);
    }
}, [showLeadTimes]);
```

Also update the existing effects for showPlanning, showStats, showScenario to close showLeadTimes:

```js
// In the showPlanning effect, add: setShowLeadTimes(false);
// In the showStats effect, add: setShowLeadTimes(false);
// In the showScenario effect, add: setShowLeadTimes(false);
```

**Step 4: Add fetch effect**

After the burnout fetch effect (around line 4249):

```js
useEffect(() => {
    if (!showLeadTimes) return;
    const startQ = cohortStartQuarter || (() => {
        const now = new Date();
        const q = Math.floor(now.getMonth() / 3) + 1;
        const yearOffset = q <= 2 ? -1 : 0;
        return `${now.getFullYear() + yearOffset}Q1`;
    })();

    const cacheKey = `${startQ}::${cohortGroupBy}::${selectedTeams.join(',')}::${cohortIncludePostponed}`;
    const cached = cohortCacheRef.current[cacheKey];
    if (cached) {
        setCohortData(cached);
        setCohortError('');
        setCohortLoading(false);
        return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setCohortLoading(true);
    setCohortError('');

    const doFetch = async () => {
        try {
            const teamIds = isAllTeamsSelected ? [] : Array.from(selectedTeamSet);
            const resp = await fetch(`${BACKEND_URL}/api/stats/epic-cohort`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    startQuarter: startQ,
                    groupBy: cohortGroupBy,
                    teamIds,
                    includePostponed: cohortIncludePostponed
                })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Cohort fetch failed (${resp.status})`);
            }
            const payload = await resp.json();
            if (cancelled) return;
            const data = payload?.data || null;
            cohortCacheRef.current[cacheKey] = data;
            setCohortData(data);
        } catch (err) {
            if (cancelled) return;
            if (err.name === 'AbortError') return;
            setCohortError(String(err.message || err));
            setCohortData(null);
        } finally {
            if (!cancelled) setCohortLoading(false);
        }
    };

    const debounceId = window.setTimeout(doFetch, 120);
    return () => {
        cancelled = true;
        window.clearTimeout(debounceId);
        try { controller.abort(); } catch (_) {}
    };
}, [showLeadTimes, cohortStartQuarter, cohortGroupBy, selectedTeams.join(','), cohortIncludePostponed, isAllTeamsSelected]);
```

**Step 5: Add grid model memo**

After the fetch effect:

```js
const cohortGridModel = React.useMemo(
    () => buildCohortGridModel(cohortData),
    [cohortData]
);
```

**Step 6: Add toggle button to header**

In the header bar (around line 8542, after the Scenario button):

```jsx
<button
    className={`mode-switch-button ${showLeadTimes ? 'active' : ''}`}
    onClick={() => setShowLeadTimes(!showLeadTimes)}
    title="Toggle epic lead times cohort"
>
    Lead Times
</button>
```

Also update the "Catch Up" button onClick to include `setShowLeadTimes(false)`.

**Step 7: Add panel JSX**

After the scenario panel section (around line 9750+), add:

```jsx
{showLeadTimes && (
    <div className="cohort-fullbleed">
        <div className="cohort-panel open">
            <div className="cohort-inner">
                <div className="cohort-panel-header">
                    <div>
                        <div className="cohort-title">
                            Epic Lead Times
                            <span className="scenario-beta">Beta</span>
                        </div>
                        <div className="cohort-subtitle">
                            Average epic delivery time by creation cohort.
                        </div>
                    </div>
                    <div className="cohort-controls">
                        <div className="scenario-toggle-group">
                            <button
                                className={`scenario-toggle ${cohortGroupBy === 'quarter' ? 'active' : ''}`}
                                onClick={() => setCohortGroupBy('quarter')}
                            >
                                Quarter
                            </button>
                            <button
                                className={`scenario-toggle ${cohortGroupBy === 'month' ? 'active' : ''}`}
                                onClick={() => setCohortGroupBy('month')}
                            >
                                Month
                            </button>
                        </div>
                        <label className="cohort-start-label">
                            Start
                            <select
                                className="cohort-start-select"
                                value={cohortStartQuarter}
                                onChange={(e) => setCohortStartQuarter(e.target.value)}
                            >
                                <option value="">Auto</option>
                                {(availableSprints || [])
                                    .filter(s => /^\d{4}Q[1-4]$/.test(s.name))
                                    .map(s => (
                                        <option key={s.name} value={s.name}>{s.name}</option>
                                    ))
                                }
                            </select>
                        </label>
                        <button
                            className={`scenario-toggle ${cohortIncludePostponed ? 'active' : ''}`}
                            onClick={() => setCohortIncludePostponed(prev => !prev)}
                        >
                            Include Postponed
                        </button>
                    </div>
                </div>

                {cohortLoading && (
                    <div className="cohort-loading">Loading epic data...</div>
                )}
                {cohortError && (
                    <div className="cohort-error">{cohortError}</div>
                )}
                {!cohortLoading && !cohortError && cohortGridModel && (
                    <CohortGrid
                        gridModel={cohortGridModel}
                        groupBy={cohortGroupBy}
                    />
                )}
            </div>
        </div>
    </div>
)}
```

**Step 8: Add `showLeadTimes` to savedPrefsRef persistence**

In the `saveUiPrefs` effect (around line 2999-3054), add `showLeadTimes` to the object and dependency array. In `loadUiPrefs`, force `showLeadTimes: false` on load (same as scenario).

**Step 9: Build and verify**

Run: `npm run build`
Expected: Build succeeds.

**Step 10: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add Lead Times panel toggle, state, fetch, and grid rendering"
```

---

## Task 7: CSS — Cohort grid styles

**Files:**
- Modify: `frontend/dist/dashboard.css`

**Step 1: Add cohort CSS**

Add at the end of `frontend/dist/dashboard.css`:

```css
/* ── Cohort Lead Times Panel ────────────────────────────── */
.cohort-fullbleed { width: 100%; margin: 0 -20px; padding: 0 20px; }
.cohort-panel { background: #1e293b; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.cohort-inner { display: flex; flex-direction: column; gap: 16px; }
.cohort-panel-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
.cohort-title { font-size: 1.1rem; font-weight: 700; color: #e2e8f0; display: flex; align-items: center; gap: 8px; }
.cohort-subtitle { font-size: 0.78rem; color: #94a3b8; margin-top: 2px; }
.cohort-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cohort-start-label { font-size: 0.78rem; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
.cohort-start-select { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 4px; padding: 2px 6px; font-size: 0.78rem; }

/* Grid */
.cohort-grid-container { position: relative; }
.cohort-grid { display: grid; gap: 1px; background: #334155; border-radius: 6px; overflow: hidden; }
.cohort-header { background: #1e293b; color: #94a3b8; font-size: 0.72rem; font-weight: 600; text-align: center; padding: 6px 4px; text-transform: uppercase; }
.cohort-label-col { text-align: left; padding-left: 10px; }
.cohort-open-col { color: #f59e0b; }
.cohort-row-label { background: #1e293b; color: #e2e8f0; font-size: 0.78rem; font-weight: 600; padding: 8px 10px; display: flex; align-items: center; gap: 6px; }
.cohort-row-count { color: #64748b; font-weight: 400; font-size: 0.72rem; }

/* Cells */
.cohort-cell { background: #1e293b; color: #e2e8f0; font-size: 0.78rem; font-weight: 600; text-align: center; padding: 8px 4px; cursor: default; transition: opacity 0.15s; }
.cohort-cell:hover { opacity: 0.85; }
.cohort-cell-empty { color: #475569; font-weight: 400; }
.cohort-cell-fast { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
.cohort-cell-mid { background: rgba(234, 179, 8, 0.2); color: #facc15; }
.cohort-cell-slow { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.cohort-cell-open { background: #1e293b; color: #f59e0b; font-weight: 400; font-size: 0.75rem; }
.cohort-empty { color: #94a3b8; text-align: center; padding: 40px 20px; font-size: 0.85rem; }
.cohort-loading { color: #94a3b8; text-align: center; padding: 40px 20px; }
.cohort-error { color: #f87171; text-align: center; padding: 20px; font-size: 0.85rem; }

/* Tooltip */
.cohort-tooltip { position: absolute; z-index: 100; background: #0f172a; border: 1px solid #475569; border-radius: 6px; padding: 10px 12px; min-width: 220px; max-width: 360px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); pointer-events: none; right: 20px; top: 60px; }
.cohort-tooltip-title { font-size: 0.78rem; font-weight: 700; color: #e2e8f0; margin-bottom: 4px; }
.cohort-tooltip-avg { font-size: 0.75rem; color: #94a3b8; margin-bottom: 6px; }
.cohort-tooltip-list { display: flex; flex-direction: column; gap: 2px; }
.cohort-tooltip-epic { display: flex; gap: 6px; font-size: 0.72rem; color: #cbd5e1; }
.cohort-tooltip-key { font-weight: 600; color: #60a5fa; min-width: 80px; }
.cohort-tooltip-days { color: #94a3b8; min-width: 36px; text-align: right; }
.cohort-tooltip-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cohort-tooltip-more { font-size: 0.7rem; color: #64748b; font-style: italic; }

/* Summary */
.cohort-summary { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 10px 0 0; font-size: 0.78rem; color: #94a3b8; }
.cohort-summary strong { color: #e2e8f0; }
.cohort-legend { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.cohort-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 2px; }
```

**Step 2: Build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/dist/dashboard.css
git commit -m "feat: add cohort grid CSS styles"
```

---

## Task 8: Build, verify, and final commit

**Step 1: Run full backend test suite**

Run: `python -m pytest tests/ -v`
Expected: All tests PASS (including new epic cohort tests).

**Step 2: Build frontend**

Run: `npm run build`
Expected: Build succeeds, no errors.

**Step 3: Verify file structure**

```
frontend/src/cohort/
├── cohortUtils.js
└── CohortGrid.jsx
```

**Step 4: Push branch**

```bash
git push -u origin plan/epic-lead-time-cohort
```

---

## Execution Summary

| Task | What | Files | Est. Lines |
|------|------|-------|-----------|
| 1 | Period helper functions + tests | `jira_server.py`, `tests/test_epic_cohort_api.py` | ~80 |
| 2 | Epic cohort fetch function + tests | `jira_server.py`, `tests/test_epic_cohort_api.py` | ~180 |
| 3 | `/api/stats/epic-cohort` endpoint + tests | `jira_server.py`, `tests/test_epic_cohort_api.py` | ~50 |
| 4 | `cohortUtils.js` pure functions | `frontend/src/cohort/cohortUtils.js` | ~110 |
| 5 | `CohortGrid.jsx` component | `frontend/src/cohort/CohortGrid.jsx` | ~120 |
| 6 | Dashboard integration (state, fetch, panel) | `frontend/src/dashboard.jsx` | ~150 |
| 7 | CSS styles | `frontend/dist/dashboard.css` | ~80 |
| 8 | Final verification | — | — |
| **Total** | | **6 files** | **~770 lines** |
