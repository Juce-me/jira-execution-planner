# EPM Project View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `EPM` dashboard mode that discovers projects from Jira Home, augments Jira linkage in JEP settings, and renders project-scoped Jira work across `Active`, `Backlog`, and `Archived` tabs without changing the current `ENG` flow.

**Architecture:** Keep `ENG` on the existing task/group/team path and introduce dedicated EPM endpoints plus a small Home API helper module. On the frontend, add a persistent `ENG | EPM` header switch, EPM-specific tabs and controls, and an EPM settings section that augments Jira Home projects with optional Jira label / epic linkage.

**Tech Stack:** Python (Flask backend), React (JSX frontend), Node test runner, Python `unittest`

---

## File Structure

**Create:**

- `epm_home.py` — Atlassian Home GraphQL client, schema validation, project normalization, latest update extraction
- `epm_scope.py` — linkage merging, Jira OR-scope clause building, issue de-duplication helpers
- `tests/test_epm_home_api.py` — Home project normalization tests
- `tests/test_epm_config_api.py` — EPM config persistence endpoint tests
- `tests/test_epm_scope_resolution.py` — scope clause and tab filtering tests
- `tests/test_epm_view_source_guards.js` — header switch and tab source guard tests
- `tests/test_epm_settings_source_guards.js` — settings UI source guard tests
- `frontend/src/epm/epmProjectUtils.mjs` — EPM tab helpers, view helper text, option formatting
- `docs/features/epm-view.md` — user-facing feature guide for the new mode

**Modify:**

- `jira_server.py` — env loading, config helpers, EPM endpoints, caching
- `frontend/src/dashboard.jsx` — view switch, EPM state, data loading, controls, settings UI, board rendering
- `.env.example` — shared Jira Home credentials
- `README.md` — EPM setup / usage summary
- `docs/features/README.md` — add the new feature guide

---

### Task 1: Backend foundation — Jira Home client and project normalization

**Files:**
- Create: `epm_home.py`
- Create: `tests/test_epm_home_api.py`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_epm_home_api.py`:

```python
import unittest

from epm_home import bucket_epm_state, build_home_project_record, extract_latest_update


class TestEpmHomeApi(unittest.TestCase):
    def test_bucket_pending_as_backlog(self):
        self.assertEqual(bucket_epm_state('PENDING'), 'backlog')

    def test_bucket_completed_as_archived(self):
        self.assertEqual(bucket_epm_state('COMPLETED'), 'archived')

    def test_extract_latest_update_prefers_newest_creation_date(self):
        latest = extract_latest_update([
            {'creationDate': '2026-04-01T08:00:00.000Z', 'summary': 'Older update'},
            {'creationDate': '2026-04-09T12:00:00.000Z', 'summary': 'Latest update'}
        ])
        self.assertEqual(latest['date'], '2026-04-09')
        self.assertEqual(latest['snippet'], 'Latest update')

    def test_build_home_project_record_keeps_metadata_without_jira_linkage(self):
        project = build_home_project_record(
            {
                'id': 'tsq-1',
                'name': 'Retail Media Launch',
                'url': 'https://home.atlassian.com/projects/tsq-1',
                'stateValue': 'PAUSED',
                'stateLabel': 'Paused'
            },
            [{'creationDate': '2026-04-12T10:00:00.000Z', 'summary': 'Awaiting budget approval'}],
            {}
        )
        self.assertEqual(project['tabBucket'], 'backlog')
        self.assertEqual(project['matchState'], 'metadata-only')
        self.assertEqual(project['latestUpdateDate'], '2026-04-12')
        self.assertEqual(project['latestUpdateSnippet'], 'Awaiting budget approval')
```

- [ ] **Step 2: Run the tests to confirm the missing module / functions**

Run: `python3 -m unittest tests.test_epm_home_api -v`

Expected: FAIL with import errors for `epm_home` or missing functions.

- [ ] **Step 3: Implement the Home client helpers and env template**

Create `epm_home.py` with the initial helpers and state buckets:

```python
import base64
from datetime import datetime

HOME_GRAPHQL_ENDPOINT = "https://team.atlassian.com/gateway/api/graphql"
ACTIVE_EPM_STATES = {"ON_TRACK", "AT_RISK", "OFF_TRACK"}
BACKLOG_EPM_STATES = {"PENDING", "PAUSED"}
ARCHIVED_EPM_STATES = {"COMPLETED", "CANCELLED", "ARCHIVED"}

QUERY_PROJECT_SCHEMA = """
query EpmProjectSchema {
  __type(name: "TownsquareProject") {
    fields { name }
  }
}
"""


def bucket_epm_state(state_value):
    normalized = str(state_value or '').strip().upper()
    if normalized in ACTIVE_EPM_STATES:
        return 'active'
    if normalized in BACKLOG_EPM_STATES:
        return 'backlog'
    if normalized in ARCHIVED_EPM_STATES:
        return 'archived'
    return 'backlog'


def extract_latest_update(updates):
    ordered = sorted(
        [row for row in (updates or []) if row.get('creationDate')],
        key=lambda row: row['creationDate'],
        reverse=True,
    )
    if not ordered:
        return {'date': '', 'snippet': ''}
    latest = ordered[0]
    return {
        'date': latest['creationDate'][:10],
        'snippet': str(latest.get('summary') or '').strip(),
    }


def build_home_project_record(project, updates, linkage):
    latest = extract_latest_update(updates)
    resolved_labels = sorted(set(linkage.get('labels') or []))
    resolved_epics = sorted(set(linkage.get('epicKeys') or []))
    match_state = 'metadata-only'
    if resolved_labels or resolved_epics:
        match_state = 'home-linked'
    return {
        'homeProjectId': project['id'],
        'name': project.get('name', ''),
        'homeUrl': project.get('url', ''),
        'stateValue': project.get('stateValue', ''),
        'stateLabel': project.get('stateLabel', ''),
        'tabBucket': bucket_epm_state(project.get('stateValue')),
        'latestUpdateDate': latest['date'],
        'latestUpdateSnippet': latest['snippet'],
        'resolvedLinkage': {
            'labels': resolved_labels,
            'epicKeys': resolved_epics,
        },
        'matchState': match_state,
    }
```

Add a schema-validation helper in the same module so the implementation can fail soft when Jira linkage fields are absent:

```python
def validate_epm_project_schema(client):
    payload = client.execute(QUERY_PROJECT_SCHEMA)
    field_names = {row['name'] for row in (((payload or {}).get('data') or {}).get('__type') or {}).get('fields', [])}
    return {
        'hasState': 'state' in field_names,
        'hasUrl': 'url' in field_names,
        'hasUpdates': 'updates' in field_names,
        'fieldNames': field_names,
    }
```

Update `.env.example` with the shared Home credentials:

```dotenv
ATLASSIAN_EMAIL=
ATLASSIAN_API_TOKEN=
ATLASSIAN_CLOUD_ID=
ROOT_GOAL_KEY=
```

- [ ] **Step 4: Re-run the backend tests**

Run: `python3 -m unittest tests.test_epm_home_api -v`

Expected: PASS for all four tests.

- [ ] **Step 5: Commit the foundation work**

```bash
git add epm_home.py tests/test_epm_home_api.py .env.example
git commit -m "Add Jira Home project normalization helpers"
```

---

### Task 2: Backend config — persist EPM augmentation in dashboard config

**Files:**
- Modify: `jira_server.py`
- Create: `tests/test_epm_config_api.py`

- [ ] **Step 1: Write the failing config API tests**

Create `tests/test_epm_config_api.py`:

```python
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import jira_server


class TestEpmConfigApi(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        self.tmpdir = tempfile.mkdtemp()
        self.dashboard_path = os.path.join(self.tmpdir, 'dashboard-config.json')
        self.dashboard_patcher = patch.object(
            jira_server,
            'resolve_dashboard_config_path',
            return_value=self.dashboard_path,
        )
        self.dashboard_patcher.start()

    def tearDown(self):
        self.dashboard_patcher.stop()
        if os.path.exists(self.dashboard_path):
            os.unlink(self.dashboard_path)
        os.rmdir(self.tmpdir)

    def test_get_epm_config_defaults_to_empty_shape(self):
        response = self.client.get('/api/epm/config')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'version': 1, 'projects': {}})

    def test_post_epm_config_persists_without_overwriting_team_groups(self):
        with open(self.dashboard_path, 'w') as handle:
            json.dump({'version': 1, 'teamGroups': {'groups': [], 'defaultGroupId': ''}}, handle)

        payload = {
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'jiraLabel': 'rnd_project_retail_media',
                    'jiraEpicKey': 'RM-123'
                }
            }
        }
        response = self.client.post('/api/epm/config', json=payload)
        self.assertEqual(response.status_code, 200)

        with open(self.dashboard_path, 'r') as handle:
            saved = json.load(handle)
        self.assertIn('teamGroups', saved)
        self.assertEqual(saved['epm']['projects']['tsq-1']['jiraEpicKey'], 'RM-123')
```

- [ ] **Step 2: Run the tests to verify the endpoint is missing**

Run: `python3 -m unittest tests.test_epm_config_api -v`

Expected: FAIL with `404` for `/api/epm/config`.

- [ ] **Step 3: Implement config normalization and endpoints**

Add config helpers in `jira_server.py` near the other config accessors:

```python
def normalize_epm_config(payload):
    raw_projects = payload.get('projects') if isinstance(payload, dict) else {}
    normalized_projects = {}
    if isinstance(raw_projects, dict):
        for home_project_id, row in raw_projects.items():
            project_id = str(home_project_id or '').strip()
            if not project_id:
                continue
            normalized_projects[project_id] = {
                'homeProjectId': project_id,
                'jiraLabel': str((row or {}).get('jiraLabel') or '').strip(),
                'jiraEpicKey': str((row or {}).get('jiraEpicKey') or '').strip().upper(),
            }
    return {'version': 1, 'projects': normalized_projects}


def get_epm_config():
    config = load_dashboard_config() or {}
    return normalize_epm_config(config.get('epm') or {})
```

Add the API routes in `jira_server.py` near the other config endpoints:

```python
@app.route('/api/epm/config', methods=['GET'])
def get_epm_config_endpoint():
    return jsonify(get_epm_config())


@app.route('/api/epm/config', methods=['POST'])
def save_epm_config_endpoint():
    payload = normalize_epm_config(request.get_json(silent=True) or {})
    dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
    dashboard_config['epm'] = payload
    save_dashboard_config(dashboard_config)
    with _cache_lock:
        TASKS_CACHE.clear()
    return jsonify(payload)
```

- [ ] **Step 4: Re-run the config API tests**

Run: `python3 -m unittest tests.test_epm_config_api -v`

Expected: PASS for both tests.

- [ ] **Step 5: Commit the config API**

```bash
git add jira_server.py tests/test_epm_config_api.py
git commit -m "Add EPM config endpoints"
```

---

### Task 3: Backend catalog — fetch Jira Home projects and merge JEP linkage

**Files:**
- Modify: `epm_home.py`
- Modify: `jira_server.py`
- Create: `tests/test_epm_projects_api.py`

- [ ] **Step 1: Write the failing catalog endpoint tests**

Create `tests/test_epm_projects_api.py`:

```python
import unittest
from unittest.mock import patch

import jira_server


class TestEpmProjectsApi(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects')
    def test_projects_endpoint_merges_home_and_jep_linkage(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [{
            'homeProjectId': 'tsq-1',
            'name': 'Retail Media Launch',
            'homeUrl': 'https://home/project/1',
            'stateValue': 'ON_TRACK',
            'stateLabel': 'On Track',
            'tabBucket': 'active',
            'latestUpdateDate': '2026-04-19',
            'latestUpdateSnippet': 'Ready for rollout',
            'resolvedLinkage': {'labels': ['rnd_project_retail_media'], 'epicKeys': []},
            'matchState': 'home-linked'
        }]
        mock_get_epm_config.return_value = {
            'version': 1,
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'jiraLabel': '',
                    'jiraEpicKey': 'RM-123'
                }
            }
        }

        response = self.client.get('/api/epm/projects')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        project = payload['projects'][0]
        self.assertEqual(project['resolvedLinkage']['labels'], ['rnd_project_retail_media'])
        self.assertEqual(project['resolvedLinkage']['epicKeys'], ['RM-123'])
        self.assertEqual(project['matchState'], 'home-linked')
```

- [ ] **Step 2: Run the tests to verify the endpoint is not present**

Run: `python3 -m unittest tests.test_epm_projects_api -v`

Expected: FAIL with `404` for `/api/epm/projects`.

- [ ] **Step 3: Implement project fetch, linkage merge, and endpoint cache**

In `epm_home.py`, add a fetch entry point and merge helper:

```python
def merge_epm_linkage(home_project, epm_config_row):
    home_labels = list((home_project.get('resolvedLinkage') or {}).get('labels') or [])
    home_epics = list((home_project.get('resolvedLinkage') or {}).get('epicKeys') or [])
    config_label = str((epm_config_row or {}).get('jiraLabel') or '').strip()
    config_epic = str((epm_config_row or {}).get('jiraEpicKey') or '').strip().upper()
    labels = sorted(set(home_labels + ([config_label] if config_label else [])))
    epic_keys = sorted(set(home_epics + ([config_epic] if config_epic else [])))
    if labels or epic_keys:
        match_state = 'home-linked' if (home_labels or home_epics) else 'jep-fallback'
    else:
        match_state = 'metadata-only'
    return {'labels': labels, 'epicKeys': epic_keys}, match_state
```

Build the Home fetch so it validates schema first and falls back to metadata-only records if Jira linkage fields are not available:

```python
def fetch_epm_home_projects():
    client = build_home_graphql_client()
    schema = validate_epm_project_schema(client)
    raw_projects = fetch_projects_from_home(client)
    result = []
    for raw_project in raw_projects:
        linkage = extract_home_jira_linkage(raw_project, schema['fieldNames']) if schema['hasUpdates'] else {'labels': [], 'epicKeys': []}
        updates = fetch_project_updates(client, raw_project['id']) if schema['hasUpdates'] else []
        result.append(build_home_project_record(raw_project, updates, linkage))
    return result
```

In `jira_server.py`, add a small catalog cache and the endpoint:

```python
EPM_PROJECTS_CACHE = {}
EPM_PROJECTS_CACHE_TTL_SECONDS = 300


@app.route('/api/epm/projects', methods=['GET'])
def get_epm_projects_endpoint():
    epm_config = get_epm_config()
    cache_key = json.dumps(epm_config, sort_keys=True)
    cached = EPM_PROJECTS_CACHE.get(cache_key)
    if cached and (time.time() - cached['timestamp']) < EPM_PROJECTS_CACHE_TTL_SECONDS:
        return jsonify(cached['data'])

    projects = []
    for home_project in fetch_epm_home_projects():
        config_row = epm_config['projects'].get(home_project['homeProjectId'])
        linkage, match_state = merge_epm_linkage(home_project, config_row)
        projects.append({
            **home_project,
            'resolvedLinkage': linkage,
            'matchState': match_state,
        })
    payload = {'projects': projects}
    EPM_PROJECTS_CACHE[cache_key] = {'timestamp': time.time(), 'data': payload}
    return jsonify(payload)
```

- [ ] **Step 4: Re-run the catalog tests**

Run: `python3 -m unittest tests.test_epm_projects_api -v`

Expected: PASS for the merge test.

- [ ] **Step 5: Commit the EPM catalog endpoint**

```bash
git add epm_home.py jira_server.py tests/test_epm_projects_api.py
git commit -m "Add EPM project catalog endpoint"
```

---

### Task 4: Backend issues endpoint — OR-union Jira scope with tab-aware sprint filtering

**Files:**
- Create: `epm_scope.py`
- Modify: `jira_server.py`
- Create: `tests/test_epm_scope_resolution.py`

- [ ] **Step 1: Write the failing scope-resolution tests**

Create `tests/test_epm_scope_resolution.py`:

```python
import unittest

from epm_scope import build_epm_scope_clause, should_apply_epm_sprint


class TestEpmScopeResolution(unittest.TestCase):
    def test_build_scope_clause_uses_label_and_epic_or_union(self):
        clause = build_epm_scope_clause({
            'labels': ['rnd_project_retail_media'],
            'epicKeys': ['RM-123']
        })
        self.assertIn('labels in ("rnd_project_retail_media")', clause)
        self.assertIn('"Epic Link" in ("RM-123")', clause)
        self.assertIn('parent in ("RM-123")', clause)
        self.assertIn('key in ("RM-123")', clause)
        self.assertIn(' OR ', clause)

    def test_backlog_tab_does_not_apply_sprint(self):
        self.assertFalse(should_apply_epm_sprint('backlog'))

    def test_active_tab_applies_sprint(self):
        self.assertTrue(should_apply_epm_sprint('active'))
```

- [ ] **Step 2: Run the tests to confirm the scope module is missing**

Run: `python3 -m unittest tests.test_epm_scope_resolution -v`

Expected: FAIL with import errors for `epm_scope`.

- [ ] **Step 3: Implement the scope helpers and `/api/epm/projects/<id>/issues`**

Create `epm_scope.py`:

```python
def should_apply_epm_sprint(tab_name):
    return str(tab_name or '').strip().lower() == 'active'


def build_epm_scope_clause(linkage):
    labels = sorted(set(linkage.get('labels') or []))
    epic_keys = sorted(set(linkage.get('epicKeys') or []))
    clauses = []
    if labels:
        quoted_labels = ', '.join(f'"{label}"' for label in labels)
        clauses.append(f'labels in ({quoted_labels})')
    if epic_keys:
        quoted_epics = ', '.join(f'"{key}"' for key in epic_keys)
        clauses.append(f'key in ({quoted_epics})')
        clauses.append(f'"Epic Link" in ({quoted_epics})')
        clauses.append(f'parent in ({quoted_epics})')
    return '(' + ' OR '.join(clauses) + ')' if clauses else ''
```

In `jira_server.py`, add the issues endpoint:

```python
EPM_ISSUES_CACHE = {}
EPM_ISSUES_CACHE_TTL_SECONDS = 300


@app.route('/api/epm/projects/<home_project_id>/issues', methods=['GET'])
def get_epm_project_issues_endpoint(home_project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    project = find_epm_project_or_404(home_project_id)
    linkage = project['resolvedLinkage']
    scope_clause = build_epm_scope_clause(linkage)
    if not scope_clause:
        return jsonify({'project': project, 'issues': [], 'epics': {}, 'metadataOnly': True})

    cache_key = f"{home_project_id}::{tab}::{sprint}::{json.dumps(linkage, sort_keys=True)}"
    cached = EPM_ISSUES_CACHE.get(cache_key)
    if cached and (time.time() - cached['timestamp']) < EPM_ISSUES_CACHE_TTL_SECONDS:
        response = jsonify(cached['data'])
        response.headers['Server-Timing'] = 'cache;dur=1'
        return response

    started = time.perf_counter()
    jql = add_clause_to_jql(build_base_jql(), scope_clause)
    if should_apply_epm_sprint(tab) and sprint:
        jql = add_clause_to_jql(jql, f'Sprint = {sprint}')
    issues = fetch_issues_by_jql(jql, build_jira_headers(), build_epm_fields_list())
    slim_issues, epic_details = shape_epm_issue_payload(issues)
    payload = {
        'project': project,
        'issues': dedupe_issues_by_key(slim_issues),
        'epics': epic_details,
        'metadataOnly': False,
    }
    EPM_ISSUES_CACHE[cache_key] = {'timestamp': time.time(), 'data': payload}
    response = jsonify(payload)
    response.headers['Server-Timing'] = f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'
    return response
```

- [ ] **Step 4: Re-run the scope tests**

Run: `python3 -m unittest tests.test_epm_scope_resolution -v`

Expected: PASS for all three tests.

- [ ] **Step 5: Commit the EPM scope endpoint**

```bash
git add epm_scope.py jira_server.py tests/test_epm_scope_resolution.py
git commit -m "Add EPM Jira scope resolution endpoint"
```

---

### Task 5: Frontend state — add the persistent `ENG | EPM` switch and EPM tabs

**Files:**
- Create: `frontend/src/epm/epmProjectUtils.mjs`
- Modify: `frontend/src/dashboard.jsx`
- Create: `tests/test_epm_view_source_guards.js`

- [ ] **Step 1: Write the failing frontend source guard test**

Create `tests/test_epm_view_source_guards.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

test('dashboard renders ENG and EPM header switch', () => {
    assert.ok(source.includes('ENG'));
    assert.ok(source.includes('EPM'));
    assert.ok(source.includes('selectedView'));
});

test('dashboard renders Active Backlog and Archived EPM tabs', () => {
    assert.ok(source.includes('Active'));
    assert.ok(source.includes('Backlog'));
    assert.ok(source.includes('Archived'));
    assert.ok(source.includes('epmTab'));
});

test('dashboard renders Active only sprint helper', () => {
    assert.ok(source.includes('Active only'));
});
```

- [ ] **Step 2: Run the node test and confirm it fails**

Run: `node --test tests/test_epm_view_source_guards.js`

Expected: FAIL because `selectedView` / `epmTab` / `Active only` are not in `dashboard.jsx`.

- [ ] **Step 3: Implement the new EPM state and header switch**

Create `frontend/src/epm/epmProjectUtils.mjs`:

```javascript
export function shouldUseEpmSprint(tab) {
    return String(tab || '').toLowerCase() === 'active';
}

export function getEpmSprintHelper(tab) {
    return shouldUseEpmSprint(tab) ? '' : 'Active only';
}
```

In `frontend/src/dashboard.jsx`, add the new state near the other top-level preferences:

```javascript
const [selectedView, setSelectedView] = useState(savedPrefsRef.current.selectedView || 'eng');
const [epmTab, setEpmTab] = useState(savedPrefsRef.current.epmTab || 'active');
const [epmProjects, setEpmProjects] = useState([]);
const [epmProjectsLoading, setEpmProjectsLoading] = useState(false);
const [epmSelectedProjectId, setEpmSelectedProjectId] = useState(savedPrefsRef.current.epmSelectedProjectId || '');
const [epmIssues, setEpmIssues] = useState([]);
const [epmIssueEpics, setEpmIssueEpics] = useState({});
```

Persist the new view state in the existing UI prefs `useEffect`:

```javascript
saveUiPrefs({
    selectedView,
    epmTab,
    epmSelectedProjectId,
    selectedSprint,
    selectedTeams,
    activeGroupId,
    showPlanning,
    showStats,
    showScenario,
    showDependencies
});
```

Render the top-right header switch with a shared helper so it can be reused in both the main header and the compact sticky header:

```jsx
const renderViewSwitch = () => (
    <div className="mode-switch view-switch">
        <button
            className={`mode-switch-button ${selectedView === 'eng' ? 'active' : ''}`}
            onClick={() => setSelectedView('eng')}
            type="button"
        >
            ENG
        </button>
        <button
            className={`mode-switch-button ${selectedView === 'epm' ? 'active' : ''}`}
            onClick={() => setSelectedView('epm')}
            type="button"
        >
            EPM
        </button>
    </div>
);
```

Use `renderViewSwitch()` in the existing `header-actions-row` block and in the `compact-sticky-header` markup so the active view remains visible while scrolling.

- [ ] **Step 4: Re-run the node source guard**

Run: `node --test tests/test_epm_view_source_guards.js`

Expected: PASS.

- [ ] **Step 5: Commit the view-switch work**

```bash
git add frontend/src/epm/epmProjectUtils.mjs frontend/src/dashboard.jsx tests/test_epm_view_source_guards.js
git commit -m "Add ENG and EPM dashboard view switch"
```

---

### Task 6: Frontend settings — add EPM project augmentation UI

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Create: `tests/test_epm_settings_source_guards.js`

- [ ] **Step 1: Write the failing settings source guard test**

Create `tests/test_epm_settings_source_guards.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

test('settings modal includes EPM tab and config fetch', () => {
    assert.ok(source.includes("setGroupManageTab('epm')"));
    assert.ok(source.includes('/api/epm/config'));
    assert.ok(source.includes('EPM projects'));
});

test('settings modal includes jira label and jira epic fields', () => {
    assert.ok(source.includes('jiraLabel'));
    assert.ok(source.includes('jiraEpicKey'));
    assert.ok(source.includes('Jira label'));
    assert.ok(source.includes('Jira epic'));
});
```

- [ ] **Step 2: Run the node test and confirm it fails**

Run: `node --test tests/test_epm_settings_source_guards.js`

Expected: FAIL because there is no EPM settings tab yet.

- [ ] **Step 3: Implement the EPM settings tab and save flow**

In `frontend/src/dashboard.jsx`, add the new modal tab button alongside the existing settings tabs:

```jsx
<button
    className={`group-modal-tab ${groupManageTab === 'epm' ? 'active' : ''}`}
    onClick={() => setGroupManageTab('epm')}
    type="button"
>
    EPM
</button>
```

Add the EPM settings fetch/save helpers:

```javascript
const [epmConfigDraft, setEpmConfigDraft] = useState({ version: 1, projects: {} });

const loadEpmConfig = async () => {
    const response = await fetch(`${BACKEND_URL}/api/epm/config`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`EPM config error ${response.status}`);
    return response.json();
};

const saveEpmConfig = async () => {
    const response = await fetch(`${BACKEND_URL}/api/epm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(epmConfigDraft)
    });
    if (!response.ok) throw new Error(`Failed to save EPM config: ${response.status}`);
    setEpmConfigDraft(await response.json());
};
```

Render the EPM settings pane:

```jsx
{groupManageTab === 'epm' && (
    <div className="group-modal-body group-projects-layout">
        <div className="group-pane group-single-pane">
            <div className="group-pane-title">EPM projects</div>
            <div className="group-pane-subtitle">Improve Jira Home linkage with an optional Jira label and Jira epic key.</div>
            {epmProjects.map((project) => (
                <div key={project.homeProjectId} className="group-config-card">
                    <a href={project.homeUrl} target="_blank" rel="noopener noreferrer">{project.name}</a>
                    <div className="group-field-helper">{project.latestUpdateDate} · {project.latestUpdateSnippet || 'No updates yet'}</div>
                    <input
                        className="mock-input"
                        value={epmConfigDraft.projects?.[project.homeProjectId]?.jiraLabel || ''}
                        onChange={(event) => updateEpmProjectDraft(project.homeProjectId, 'jiraLabel', event.target.value)}
                        placeholder="Jira label"
                    />
                    <input
                        className="mock-input"
                        value={epmConfigDraft.projects?.[project.homeProjectId]?.jiraEpicKey || ''}
                        onChange={(event) => updateEpmProjectDraft(project.homeProjectId, 'jiraEpicKey', event.target.value)}
                        placeholder="Jira epic"
                    />
                </div>
            ))}
        </div>
    </div>
)}
```

- [ ] **Step 4: Re-run the settings source guard**

Run: `node --test tests/test_epm_settings_source_guards.js`

Expected: PASS.

- [ ] **Step 5: Commit the settings UI**

```bash
git add frontend/src/dashboard.jsx tests/test_epm_settings_source_guards.js
git commit -m "Add EPM project linkage settings"
```

---

### Task 7: Frontend data flow, board rendering, docs, and verification

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `README.md`
- Modify: `docs/features/README.md`
- Create: `docs/features/epm-view.md`

- [ ] **Step 1: Wire the EPM data load and render the project-scoped board**

In `frontend/src/dashboard.jsx`, fetch projects when the user enters `EPM` and fetch issues when a project is selected:

```javascript
useEffect(() => {
    if (selectedView !== 'epm') return;
    let ignore = false;
    setEpmProjectsLoading(true);
    fetch(`${BACKEND_URL}/api/epm/projects`, { cache: 'no-cache' })
        .then((response) => response.json())
        .then((payload) => {
            if (!ignore) {
                setEpmProjects(payload.projects || []);
            }
        })
        .finally(() => {
            if (!ignore) setEpmProjectsLoading(false);
        });
    return () => {
        ignore = true;
    };
}, [selectedView]);

useEffect(() => {
    if (selectedView !== 'epm' || !epmSelectedProjectId) return;
    const params = new URLSearchParams({ tab: epmTab });
    if (epmTab === 'active' && selectedSprint) {
        params.set('sprint', String(selectedSprint));
    }
    fetch(`${BACKEND_URL}/api/epm/projects/${encodeURIComponent(epmSelectedProjectId)}/issues?${params.toString()}`, { cache: 'no-cache' })
        .then((response) => response.json())
        .then((payload) => {
            setEpmIssues(payload.issues || []);
            setEpmIssueEpics(payload.epics || {});
        });
}, [selectedView, epmSelectedProjectId, epmTab, selectedSprint]);
```

Render the EPM controls and metadata-only empty state:

```jsx
{selectedView === 'epm' ? (
    <div className="filters-strip">
        <div className="filters-group">
            <div className="filters-label">Projects</div>
            <div className="mode-switch">
                <button className={`mode-switch-button ${epmTab === 'active' ? 'active' : ''}`} onClick={() => setEpmTab('active')} type="button">Active</button>
                <button className={`mode-switch-button ${epmTab === 'backlog' ? 'active' : ''}`} onClick={() => setEpmTab('backlog')} type="button">Backlog</button>
                <button className={`mode-switch-button ${epmTab === 'archived' ? 'active' : ''}`} onClick={() => setEpmTab('archived')} type="button">Archived</button>
            </div>
        </div>
    </div>
) : (
    existingControls
)}
```

If the selected EPM project has no resolved Jira linkage:

```jsx
{selectedView === 'epm' && selectedEpmProject?.matchState === 'metadata-only' && (
    <div className="group-config-card">
        <div className="group-pane-title">{selectedEpmProject.name}</div>
        <div className="group-pane-subtitle">{selectedEpmProject.latestUpdateDate} · {selectedEpmProject.latestUpdateSnippet || 'No updates yet'}</div>
        <a href={selectedEpmProject.homeUrl} target="_blank" rel="noopener noreferrer">Open in Jira Home</a>
        <div className="group-field-helper">Add a Jira label or Jira epic in Settings → EPM to pull Jira work into this view.</div>
    </div>
)}
```

- [ ] **Step 2: Update the user-facing docs**

Create `docs/features/epm-view.md`:

```markdown
# EPM View

Use the header `ENG | EPM` switch to move between team delivery and project delivery.

- `Active` uses sprint + project.
- `Backlog` ignores sprint and shows paused / pending work.
- `Archived` ignores sprint and shows completed / cancelled / archived work.

If a project appears without Jira work, open **Settings → EPM** and add a Jira label or Jira epic key.
```

Update `docs/features/README.md`:

```markdown
- [EPM View](./epm-view.md)
```

Add a short README section:

```markdown
## EPM View

Set the shared Atlassian Home credentials in `.env`, then use the `ENG | EPM` switch in the dashboard header to browse Jira Home projects and their Jira rollup.
```

- [ ] **Step 3: Run the full verification set**

Run:

```bash
python3 -m unittest tests.test_epm_home_api tests.test_epm_config_api tests.test_epm_projects_api tests.test_epm_scope_resolution -v
node --test tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js
npm run build
python3 -m unittest discover -s tests
```

Expected:

- backend targeted tests PASS
- node source guard tests PASS
- frontend build PASS
- full `unittest` suite PASS

- [ ] **Step 4: Commit the EPM UI wiring and docs**

```bash
git add frontend/src/dashboard.jsx README.md docs/features/README.md docs/features/epm-view.md
git commit -m "Plan EPM project view integration"
```
