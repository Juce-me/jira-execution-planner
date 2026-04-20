# EPM Project View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `EPM` dashboard mode that discovers projects from Jira Home, augments Jira linkage in JEP settings, and renders project-scoped Jira work across `Active`, `Backlog`, and `Archived` tabs without changing the current `ENG` flow.

**Architecture:** Keep `ENG` on the existing task/group/team path and introduce dedicated EPM endpoints plus a small Home API helper module. On the frontend, add a persistent `ENG | EPM` header switch, EPM-specific tabs and controls, and an EPM settings section that augments Jira Home projects with optional Jira label / epic linkage.

**Tech Stack:** Python (Flask backend), React (JSX frontend), Node test runner, Python `unittest`

---

## Pre-Execution Notes

These resolve caveats surfaced during plan review. Read before starting Task 1.

### N1. Atlassian Home client is in-repo and first-party

The design spec's "reuse the existing Jira Home project" line is aspirational — this repo currently has no Home integration. Task 1 builds a first-party Atlassian Home GraphQL client inside `epm_home.py`. Key schema facts the implementation must encode:

- GraphQL endpoint: `https://team.atlassian.com/gateway/api/graphql`. Basic auth with `ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN`. Request header `X-ExperimentalApi: Townsquare` is required for the `@optIn(to: "Townsquare")` queries below.
- Container ID for goal searches is `ati:cloud:townsquare::site/<ATLASSIAN_CLOUD_ID>`; `ATLASSIAN_CLOUD_ID` is the `cloudId` URL param in Atlassian Home.
- Project discovery: `goals_search` → match `ROOT_GOAL_KEY` client-side → `goals_byId.subGoals` (sub-goals are the reporting streams) → `goals_byId.projects` → `projects_byId` for full details.
- `TownsquareProject` fields to read: `id`, `key`, `name`, `url`, `state { label value }`, `description { what why }`, `owner { accountId name }`, `updates(...)`. `updates(...)` returns `{ id url creationDate editDate summary updateType }`.
- Status extraction: `state.value` is the enum (`ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `PENDING`, `PAUSED`, `COMPLETED`, `CANCELLED`, `ARCHIVED`). Fall back to `state.label` or `status` if `state.value` is absent.
- `TownsquareProject` has no `label` or `epic` fields today. The spec's "Jira Home label / Jira Home epic key" inputs to linkage (§5 items 1–2) are empty in v1. The JEP-config fallback (§5 items 3–4) is the only working linkage source. Keep the Home-linkage extractor as a pluggable function so it can start returning values when Atlassian adds the fields.
- Paginated connections use `pageInfo { hasNextPage endCursor }` + `edges { node { ... } }`; walk them with a generic helper.
- Rate limits: `429` responses include `Retry-After`. Use exponential backoff, max 3 retries, 30s timeout.
- On any GraphQL / schema error the module must log and return an empty result — it must never call `sys.exit` or raise past the Flask handler.

### N2. Cache isolation (MRT010 compliance)

The EPM config endpoint must **not** touch `TASKS_CACHE`. The ENG task path is a separate cache line and clearing it on an EPM-only POST causes the exact refetch storm MRT010 warns against. Create two new EPM-scoped caches (in Task 2) and clear only those:

```python
EPM_PROJECTS_CACHE = {}
EPM_ISSUES_CACHE = {}
_epm_cache_lock = threading.Lock()
```

### N3. Base JQL inheritance

EPM JQL is built as `build_base_jql() AND <scope_clause>`. `build_base_jql()` currently emits a `project in (...)` clause derived from `dashboard-config.json -> projects.selected`. This means EPM queries stay scoped to ENG-selected Jira projects — **intentional** for v1 (keeps auth and field availability consistent). Document this in `docs/features/epm-view.md` so operators know to add a project to `projects.selected` if an EPM project points at work outside the current set.

### N4. Sprint in `Active` tab

- `Active` tab requires a sprint. If `sprint` query arg is missing or non-numeric, `GET /api/epm/projects/<id>/issues?tab=active` returns `400` with `{"error": "sprint_required"}`. The frontend renders a `Select a sprint to see active work` helper card instead of issuing the fetch.
- `sprint` must be a numeric sprint ID. Reject non-digits to prevent JQL injection.

### N5. Undefined helper inventory

The following symbols were called but undefined in the original plan. They are defined inline in the task that first uses them:

| Symbol | Defined in | Purpose |
|---|---|---|
| `build_jira_headers()` | Task 4, Step 3 | Basic auth + JSON headers from `JIRA_EMAIL`/`JIRA_TOKEN` |
| `build_epm_fields_list()` | Task 4, Step 3 | Field list for EPM issue rendering |
| `shape_epm_issue_payload(issues)` | Task 4, Step 3 | Returns `(slim_issues, epic_details_by_key)` |
| `dedupe_issues_by_key(issues)` | Task 4, Step 3 | Dict-by-key dedup preserving first occurrence |
| `find_epm_project_or_404(id)` | Task 4, Step 3 | Reads from `EPM_PROJECTS_CACHE` or abort 404 |
| `updateEpmProjectDraft(id, field, value)` | Task 6, Step 3 | Merges a draft field change into `epmConfigDraft.projects[id]` |
| `selectedEpmProject` | Task 5b, Step 3 | Derived from `epmProjects.find(p => p.homeProjectId === epmSelectedProjectId)` |

### N6. CSS class hygiene

- `mode-switch` / `mode-switch-button` already exist and are reused verbatim for both the ENG↔EPM header switch and the Active/Backlog/Archived tabs. Do **not** add a `view-switch` modifier class — the switch is styled identically to the existing Planning/Stats/Scenario switch.
- Do **not** add a `mock-input` class. Use a plain `<input>` styled by the existing settings-tab input rules.

### N7. ENG panel coexistence

In EPM view (`selectedView === 'epm'`) the Planning panel, Stats panel, Scenario panel, and Dependencies banner must not render. Gate each of those JSX blocks on `selectedView === 'eng'` in Task 5b. The individual `showPlanning`/`showStats`/`showScenario`/`showDependencies` booleans remain persisted so the ENG view restores correctly when the user switches back.

### N8. Match-state enum

```text
'home-linked'   — resolved linkage came from Jira Home metadata (v1: never happens; reserved for future schema)
'jep-fallback'  — resolved linkage came from JEP settings config
'metadata-only' — no linkage on either side; render the Home metadata card
```

Use exactly these three strings across backend and frontend.

### N9. Auth gap

`POST /api/epm/config` is currently unauthenticated. Leave a `TODO(SETTINGS_ADMIN_ONLY)` comment next to the route so the future flag can gate it alongside the other settings endpoints.

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

- [ ] **Step 3: Implement the Home client, helpers, and env template**

Create `epm_home.py` with the GraphQL client, the queries, the safe fetch wrappers, and the normalization helpers. No `sys.exit` on any error path — log and return an empty result so Flask keeps serving.

```python
"""Atlassian Home (Goals & Projects) client + normalization helpers for the EPM view."""

from __future__ import annotations

import base64
import json as json_module
import logging
import os
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

HOME_GRAPHQL_ENDPOINT = "https://team.atlassian.com/gateway/api/graphql"
HOME_TIMEOUT_SECONDS = 30
HOME_MAX_RETRIES = 3
HOME_PAGE_SIZE = 50

ACTIVE_EPM_STATES = {"ON_TRACK", "AT_RISK", "OFF_TRACK"}
BACKLOG_EPM_STATES = {"PENDING", "PAUSED"}
ARCHIVED_EPM_STATES = {"COMPLETED", "CANCELLED", "ARCHIVED"}

MATCH_STATE_HOME_LINKED = 'home-linked'
MATCH_STATE_JEP_FALLBACK = 'jep-fallback'
MATCH_STATE_METADATA_ONLY = 'metadata-only'


class HomeAuthenticationError(Exception):
    pass


class HomeGraphQLError(Exception):
    pass


class HomeRateLimitError(Exception):
    pass


class HomeGraphQLClient:
    def __init__(self, email: str, api_token: str, endpoint: str = HOME_GRAPHQL_ENDPOINT):
        credentials = base64.b64encode(f"{email}:{api_token}".encode()).decode()
        self.endpoint = endpoint
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {credentials}",
            "X-ExperimentalApi": "Townsquare",
        }

    def execute(self, query: str, variables: dict | None = None) -> dict:
        payload: dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables
        for attempt in range(HOME_MAX_RETRIES + 1):
            resp = requests.post(self.endpoint, headers=self.headers, json=payload, timeout=HOME_TIMEOUT_SECONDS)
            if resp.status_code == 401:
                raise HomeAuthenticationError("Atlassian Home authentication failed; check ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN.")
            if resp.status_code == 429:
                if attempt < HOME_MAX_RETRIES:
                    wait = int(resp.headers.get("Retry-After", 2 ** (attempt + 1)))
                    time.sleep(wait)
                    continue
                raise HomeRateLimitError("Atlassian Home rate-limited after retries.")
            resp.raise_for_status()
            data = resp.json()
            if data.get("errors"):
                messages = "; ".join(e.get("message", str(e)) for e in data["errors"])
                raise HomeGraphQLError(f"GraphQL errors: {messages}")
            return data
        raise HomeRateLimitError("Atlassian Home retries exhausted.")

    def execute_paginated(self, query: str, variables: dict, path_to_connection: str) -> list[dict]:
        all_nodes: list[dict] = []
        variables = dict(variables)
        variables["after"] = None
        while True:
            resp = self.execute(query, variables)
            connection = resp.get("data", {})
            for key in path_to_connection.split("."):
                connection = (connection or {}).get(key, {})
            for edge in (connection or {}).get("edges", []) or []:
                all_nodes.append(edge["node"])
            page_info = (connection or {}).get("pageInfo", {}) or {}
            if page_info.get("hasNextPage"):
                variables["after"] = page_info["endCursor"]
            else:
                return all_nodes


QUERY_GOALS_SEARCH = """
query GoalsSearch($containerId: ID!, $first: Int!, $after: String) {
  goals_search(containerId: $containerId, searchString: "", first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { id key name url } }
  }
}
"""

QUERY_SUB_GOALS = """
query SubGoals($goalId: ID!, $first: Int!, $after: String) {
  goals_byId(goalId: $goalId) {
    subGoals(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id key name url isArchived } }
    }
  }
}
"""

QUERY_GOAL_PROJECTS = """
query GoalProjects($goalId: ID!, $first: Int!, $after: String) {
  goals_byId(goalId: $goalId) {
    projects(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id key name url } }
    }
  }
}
"""

QUERY_PROJECT_DETAILS = """
query ProjectDetails($projectId: String!) {
  projects_byId(projectId: $projectId) {
    id key name url
    state { label value }
  }
}
"""

QUERY_PROJECT_UPDATES = """
query ProjectUpdates($projectId: String!, $first: Int!, $after: String) {
  projects_byId(projectId: $projectId) {
    updates(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id url creationDate editDate summary updateType } }
    }
  }
}
"""


def adf_to_text(value: Any) -> str:
    """Flatten an ADF summary to plain text. Accepts plain strings transparently."""
    if not value:
        return ""
    if not isinstance(value, str):
        return str(value)
    try:
        doc = json_module.loads(value)
    except (json_module.JSONDecodeError, TypeError):
        return value
    if not isinstance(doc, dict) or "content" not in doc:
        return value
    return _extract_text_from_adf_nodes(doc.get("content", []))


def _extract_text_from_adf_nodes(nodes: list) -> str:
    parts: list[str] = []
    for node in nodes or []:
        node_type = node.get("type", "")
        if node_type == "text":
            parts.append(node.get("text", ""))
        elif node_type in ("paragraph", "heading"):
            text = _extract_text_from_adf_nodes(node.get("content", []))
            if text:
                parts.append(text)
        elif node_type in ("bulletList", "orderedList"):
            for item in node.get("content", []):
                text = _extract_text_from_adf_nodes(item.get("content", []))
                if text:
                    parts.append(f"- {text}")
        elif "content" in node:
            text = _extract_text_from_adf_nodes(node.get("content", []))
            if text:
                parts.append(text)
    return " ".join(p.strip() for p in parts if p.strip())


def extract_project_status(project_data: dict) -> str:
    state = project_data.get("state") or project_data.get("status")
    if isinstance(state, dict):
        return state.get("value") or state.get("label") or "UNKNOWN"
    if isinstance(state, str):
        return state
    return "UNKNOWN"


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
        'snippet': adf_to_text(latest.get('summary')).strip(),
    }


def build_home_project_record(project, updates, linkage):
    latest = extract_latest_update(updates)
    resolved_labels = sorted(set(linkage.get('labels') or []))
    resolved_epics = sorted(set(linkage.get('epicKeys') or []))
    match_state = MATCH_STATE_HOME_LINKED if (resolved_labels or resolved_epics) else MATCH_STATE_METADATA_ONLY
    state_value = project.get('stateValue') or project.get('status') or ''
    return {
        'homeProjectId': project['id'],
        'name': project.get('name', ''),
        'homeUrl': project.get('url', ''),
        'stateValue': state_value,
        'stateLabel': project.get('stateLabel', ''),
        'tabBucket': bucket_epm_state(state_value),
        'latestUpdateDate': latest['date'],
        'latestUpdateSnippet': latest['snippet'],
        'resolvedLinkage': {'labels': resolved_labels, 'epicKeys': resolved_epics},
        'matchState': match_state,
    }


def build_home_graphql_client() -> HomeGraphQLClient:
    email = os.environ.get('ATLASSIAN_EMAIL') or os.environ.get('JIRA_EMAIL') or ''
    token = os.environ.get('ATLASSIAN_API_TOKEN') or os.environ.get('JIRA_TOKEN') or ''
    if not email or not token:
        raise RuntimeError('ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (or JIRA_EMAIL/JIRA_TOKEN) must be set to use the EPM view')
    return HomeGraphQLClient(email, token, HOME_GRAPHQL_ENDPOINT)


def _container_id_from_cloud(cloud_id: str) -> str:
    return f'ati:cloud:townsquare::site/{cloud_id}'


def resolve_root_goal(client: HomeGraphQLClient, root_goal_key: str, container_id: str) -> dict | None:
    try:
        goals = client.execute_paginated(QUERY_GOALS_SEARCH, {"containerId": container_id, "first": HOME_PAGE_SIZE}, "goals_search")
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError) as exc:
        logger.warning('Root goal search failed: %s', exc)
        return None
    for goal in goals:
        if goal.get('key') == root_goal_key:
            return goal
    logger.warning('Root goal %s not found among %d goals', root_goal_key, len(goals))
    return None


def fetch_sub_goals(client: HomeGraphQLClient, root_goal_id: str) -> list[dict]:
    try:
        nodes = client.execute_paginated(QUERY_SUB_GOALS, {"goalId": root_goal_id, "first": HOME_PAGE_SIZE}, "goals_byId.subGoals")
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError) as exc:
        logger.warning('Sub-goal fetch failed: %s', exc)
        return []
    return [g for g in nodes if not g.get('isArchived')]


def fetch_projects_for_goal(client: HomeGraphQLClient, goal_id: str) -> list[dict]:
    try:
        linked = client.execute_paginated(QUERY_GOAL_PROJECTS, {"goalId": goal_id, "first": HOME_PAGE_SIZE}, "goals_byId.projects")
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError) as exc:
        logger.warning('Goal project list fetch failed: %s', exc)
        return []
    projects: list[dict] = []
    for row in linked:
        project_id = row.get('id')
        if not project_id:
            continue
        try:
            detail = client.execute(QUERY_PROJECT_DETAILS, {"projectId": project_id})
            payload = (detail.get('data') or {}).get('projects_byId') or {}
        except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError) as exc:
            logger.warning('Project detail fetch failed for %s: %s', project_id, exc)
            continue
        state = payload.get('state') or {}
        projects.append({
            'id': payload.get('id', project_id),
            'key': payload.get('key', ''),
            'name': payload.get('name', ''),
            'url': payload.get('url', ''),
            'stateValue': extract_project_status(payload),
            'stateLabel': state.get('label', '') if isinstance(state, dict) else '',
        })
    return projects


def fetch_latest_project_update(client: HomeGraphQLClient, project_id: str) -> list[dict]:
    try:
        return client.execute_paginated(QUERY_PROJECT_UPDATES, {"projectId": project_id, "first": 10}, "projects_byId.updates")
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError) as exc:
        logger.warning('Latest update fetch failed for %s: %s', project_id, exc)
        return []


def extract_home_jira_linkage(_raw_project):
    """v1: TownsquareProject has no label/epic fields. Always empty; reserved for future schema."""
    return {'labels': [], 'epicKeys': []}
```

Update `.env.example`. The existing `JIRA_*` block stays. Add an Atlassian Home block; `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` may be left blank if they match `JIRA_EMAIL` / `JIRA_TOKEN` (the client falls back to the Jira creds):

```dotenv
# Atlassian Home (EPM view)
# ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN may be left blank if they match JIRA_EMAIL / JIRA_TOKEN.
# ATLASSIAN_CLOUD_ID: the cloudId query parameter from Atlassian Home URLs
#   (e.g. https://home.atlassian.com/o/.../projects?cloudId=<THIS-VALUE>).
# ROOT_GOAL_KEY: key of the root goal whose sub-goals are the reporting streams (e.g. CRITE-223).
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

Add config helpers plus the EPM-scoped caches in `jira_server.py` near the other config accessors:

```python
import threading  # reuse the existing import

EPM_PROJECTS_CACHE = {}
EPM_ISSUES_CACHE = {}
_epm_cache_lock = threading.Lock()


def clear_epm_caches():
    with _epm_cache_lock:
        EPM_PROJECTS_CACHE.clear()
        EPM_ISSUES_CACHE.clear()


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

Add the API routes in `jira_server.py` near the other config endpoints. **Do not** touch `TASKS_CACHE` — EPM config changes must not invalidate the ENG task path (MRT010):

```python
@app.route('/api/epm/config', methods=['GET'])
def get_epm_config_endpoint():
    return jsonify(get_epm_config())


# TODO(SETTINGS_ADMIN_ONLY): gate this route when the admin flag ships.
@app.route('/api/epm/config', methods=['POST'])
def save_epm_config_endpoint():
    payload = normalize_epm_config(request.get_json(silent=True) or {})
    dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
    dashboard_config['epm'] = payload
    save_dashboard_config(dashboard_config)
    clear_epm_caches()
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

Build the Home fetch using the first-party helpers from Task 1. No schema introspection call — each `fetch_*` already degrades to `[]` on a GraphQL / schema error, so missing Jira linkage just yields an empty `resolvedLinkage`:

```python
def fetch_epm_home_projects():
    cloud_id = os.environ.get('ATLASSIAN_CLOUD_ID', '').strip()
    root_goal_key = os.environ.get('ROOT_GOAL_KEY', '').strip()
    if not cloud_id or not root_goal_key:
        logger.warning('EPM home fetch skipped: ATLASSIAN_CLOUD_ID and ROOT_GOAL_KEY are required')
        return []

    client = build_home_graphql_client()
    container_id = _container_id_from_cloud(cloud_id)
    root_goal = resolve_root_goal(client, root_goal_key, container_id)
    if not root_goal:
        return []

    seen_project_ids: set[str] = set()
    result: list[dict] = []
    for sub_goal in fetch_sub_goals(client, root_goal['id']):
        for raw_project in fetch_projects_for_goal(client, sub_goal['id']):
            project_id = raw_project.get('id')
            if not project_id or project_id in seen_project_ids:
                continue
            seen_project_ids.add(project_id)
            linkage = extract_home_jira_linkage(raw_project)
            updates = fetch_latest_project_update(client, project_id)
            result.append(build_home_project_record(raw_project, updates, linkage))
    return result
```

In `jira_server.py`, wire the catalog endpoint against `EPM_PROJECTS_CACHE` / `_epm_cache_lock` (both declared in Task 2):

```python
EPM_PROJECTS_CACHE_TTL_SECONDS = 300


@app.route('/api/epm/projects', methods=['GET'])
def get_epm_projects_endpoint():
    epm_config = get_epm_config()
    cache_key = json.dumps(epm_config, sort_keys=True)
    with _epm_cache_lock:
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
    with _epm_cache_lock:
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

In `jira_server.py`, add the missing helpers near the existing Jira fetch utilities. These are defined once and reused by the EPM issues endpoint:

```python
EPM_ISSUES_CACHE_TTL_SECONDS = 300


def build_jira_headers():
    credentials = base64.b64encode(f"{JIRA_EMAIL}:{JIRA_TOKEN}".encode()).decode()
    return {
        'Authorization': f'Basic {credentials}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }


def build_epm_fields_list():
    # Keep in sync with the ENG task payload so the board renderer can reuse the same fields.
    base_fields = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'parent', 'labels', 'created', 'updated']
    story_points = get_story_points_field_id()  # existing helper in jira_server.py
    if story_points and story_points not in base_fields:
        base_fields.append(story_points)
    return base_fields


def shape_epm_issue_payload(issues):
    slim_issues = []
    epic_details: dict[str, dict] = {}
    for issue in issues or []:
        fields = issue.get('fields') or {}
        parent = fields.get('parent') or {}
        parent_key = parent.get('key') or ''
        if parent_key and parent_key not in epic_details:
            parent_fields = parent.get('fields') or {}
            epic_details[parent_key] = {
                'key': parent_key,
                'summary': parent_fields.get('summary') or '',
                'issueType': (parent_fields.get('issuetype') or {}).get('name') or '',
            }
        slim_issues.append({
            'key': issue.get('key'),
            'summary': fields.get('summary') or '',
            'status': (fields.get('status') or {}).get('name') or '',
            'assignee': (fields.get('assignee') or {}).get('displayName') or '',
            'issueType': (fields.get('issuetype') or {}).get('name') or '',
            'parentKey': parent_key,
            'labels': list(fields.get('labels') or []),
        })
    return slim_issues, epic_details


def dedupe_issues_by_key(issues):
    seen: set[str] = set()
    out = []
    for issue in issues or []:
        key = issue.get('key')
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(issue)
    return out


def find_epm_project_or_404(home_project_id):
    # Look across any cached catalog entry; fall through to a fresh fetch if nothing is cached.
    with _epm_cache_lock:
        for entry in EPM_PROJECTS_CACHE.values():
            for project in (entry.get('data') or {}).get('projects', []):
                if project.get('homeProjectId') == home_project_id:
                    return project
    epm_config = get_epm_config()
    for home_project in fetch_epm_home_projects():
        config_row = epm_config['projects'].get(home_project['homeProjectId'])
        linkage, match_state = merge_epm_linkage(home_project, config_row)
        project = {**home_project, 'resolvedLinkage': linkage, 'matchState': match_state}
        if project['homeProjectId'] == home_project_id:
            return project
    abort(404)
```

Add the issues endpoint. `Active` without a numeric sprint returns `400 sprint_required`; EPM JQL is always AND-combined with `build_base_jql()` (ENG project list, see Pre-Execution note N3):

```python
@app.route('/api/epm/projects/<home_project_id>/issues', methods=['GET'])
def get_epm_project_issues_endpoint(home_project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    project = find_epm_project_or_404(home_project_id)
    linkage = project['resolvedLinkage']
    scope_clause = build_epm_scope_clause(linkage)
    if not scope_clause:
        return jsonify({'project': project, 'issues': [], 'epics': {}, 'metadataOnly': True})

    if should_apply_epm_sprint(tab):
        if not sprint:
            return jsonify({'error': 'sprint_required'}), 400
        if not sprint.isdigit():
            return jsonify({'error': 'sprint_not_numeric'}), 400

    cache_key = f"{home_project_id}::{tab}::{sprint}::{json.dumps(linkage, sort_keys=True)}"
    with _epm_cache_lock:
        cached = EPM_ISSUES_CACHE.get(cache_key)
    if cached and (time.time() - cached['timestamp']) < EPM_ISSUES_CACHE_TTL_SECONDS:
        response = jsonify(cached['data'])
        response.headers['Server-Timing'] = 'cache;dur=1'
        return response

    started = time.perf_counter()
    jql = add_clause_to_jql(build_base_jql(), scope_clause)
    if should_apply_epm_sprint(tab):
        jql = add_clause_to_jql(jql, f'Sprint = {sprint}')
    issues = fetch_issues_by_jql(jql, build_jira_headers(), build_epm_fields_list())
    slim_issues, epic_details = shape_epm_issue_payload(issues)
    payload = {
        'project': project,
        'issues': dedupe_issues_by_key(slim_issues),
        'epics': epic_details,
        'metadataOnly': False,
    }
    with _epm_cache_lock:
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

Render the top-right header switch with a shared helper so it can be reused in both the main header and the compact sticky header. Reuse the existing `mode-switch` / `mode-switch-button` classes verbatim — no new modifier class (see Pre-Execution note N6):

```jsx
const renderViewSwitch = () => (
    <div className="mode-switch">
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

### Task 5b: Frontend EPM view shell — project picker, tab-bucket filter, ENG panel gating

**Files:**
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/epm/epmProjectUtils.mjs`
- Create: `tests/test_epm_shell_source_guards.js`

- [ ] **Step 1: Write the failing source-guard test**

Create `tests/test_epm_shell_source_guards.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

test('EPM shell filters the project catalog by tab bucket', () => {
    assert.ok(source.includes("project.tabBucket === epmTab"));
});

test('EPM shell renders a project picker driven by epmSelectedProjectId', () => {
    assert.ok(source.includes('epmSelectedProjectId'));
    assert.ok(source.includes('setEpmSelectedProjectId'));
});

test('ENG-only panels are hidden in EPM view', () => {
    assert.ok(source.includes("selectedView === 'eng' && showPlanning"));
    assert.ok(source.includes("selectedView === 'eng' && showStats"));
    assert.ok(source.includes("selectedView === 'eng' && showScenario"));
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node --test tests/test_epm_shell_source_guards.js`

Expected: FAIL because none of the new strings exist yet.

- [ ] **Step 3: Add a bucket helper and wire the shell**

In `frontend/src/epm/epmProjectUtils.mjs` add:

```javascript
export function filterEpmProjectsForTab(projects, tab) {
    const normalized = String(tab || 'active').toLowerCase();
    return (projects || []).filter((project) => project.tabBucket === normalized);
}
```

In `frontend/src/dashboard.jsx`, render the project picker next to the tab switch (within the EPM branch of the filter strip added in Task 5). The picker is driven by `filterEpmProjectsForTab(epmProjects, epmTab)`:

```jsx
const visibleEpmProjects = filterEpmProjectsForTab(epmProjects, epmTab);
const selectedEpmProject = visibleEpmProjects.find((project) => project.homeProjectId === epmSelectedProjectId) || null;

// ...inside the EPM branch of the filters strip:
<div className="filters-group">
    <div className="filters-label">Project</div>
    <select
        className="filters-select"
        value={epmSelectedProjectId}
        onChange={(event) => setEpmSelectedProjectId(event.target.value)}
    >
        <option value="">Select a project…</option>
        {visibleEpmProjects.map((project) => (
            <option key={project.homeProjectId} value={project.homeProjectId}>
                {project.name}
            </option>
        ))}
    </select>
</div>
```

If the user switches tabs and the current selection is no longer in the filtered list, clear the selection:

```javascript
useEffect(() => {
    if (!epmSelectedProjectId) return;
    const stillVisible = filterEpmProjectsForTab(epmProjects, epmTab)
        .some((project) => project.homeProjectId === epmSelectedProjectId);
    if (!stillVisible) setEpmSelectedProjectId('');
}, [epmProjects, epmTab]);
```

Gate the ENG-only panels on `selectedView === 'eng'`. Locate the current `showPlanning` / `showStats` / `showScenario` / `showDependencies` render blocks and wrap each conditional:

```jsx
{selectedView === 'eng' && showPlanning && <PlanningPanel ... />}
{selectedView === 'eng' && showStats && <StatsPanel ... />}
{selectedView === 'eng' && showScenario && <ScenarioPanel ... />}
{selectedView === 'eng' && showDependencies && <DependenciesBanner ... />}
```

Also gate the existing ENG filters strip so it only renders when `selectedView === 'eng'`, and render the EPM filters strip when `selectedView === 'epm'`. Both share the same outer container so sticky offsets do not change.

Add a sprint-required helper message in `Active` when the user has no sprint selected:

```jsx
{selectedView === 'epm' && epmTab === 'active' && !selectedSprint && epmSelectedProjectId && (
    <div className="group-config-card">
        <div className="group-pane-title">Select a sprint</div>
        <div className="group-pane-subtitle">The Active tab needs a sprint to scope Jira work.</div>
    </div>
)}
```

- [ ] **Step 4: Re-run the source guard**

Run: `node --test tests/test_epm_shell_source_guards.js`

Expected: PASS.

- [ ] **Step 5: Commit the shell work**

```bash
git add frontend/src/dashboard.jsx frontend/src/epm/epmProjectUtils.mjs tests/test_epm_shell_source_guards.js
git commit -m "Add EPM shell with project picker and ENG panel gating"
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

Add the EPM settings state, fetch/save helpers, draft mutator, and a lazy-load effect that fires when the user opens the EPM tab from either the ENG or EPM view:

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

const updateEpmProjectDraft = (homeProjectId, field, value) => {
    setEpmConfigDraft((prev) => {
        const prevProjects = prev.projects || {};
        const prevRow = prevProjects[homeProjectId] || { homeProjectId };
        return {
            ...prev,
            projects: {
                ...prevProjects,
                [homeProjectId]: { ...prevRow, homeProjectId, [field]: value },
            },
        };
    });
};

// Lazy-load the project catalog and draft when the EPM settings tab is opened from any view.
useEffect(() => {
    if (groupManageTab !== 'epm') return;
    loadEpmConfig().then(setEpmConfigDraft).catch(() => {});
    if (!epmProjects.length) {
        fetch(`${BACKEND_URL}/api/epm/projects`, { cache: 'no-cache' })
            .then((response) => response.json())
            .then((payload) => setEpmProjects(payload.projects || []))
            .catch(() => {});
    }
}, [groupManageTab]);
```

Render the EPM settings pane. Drop the non-existent `mock-input` class and use a plain `<input>` — existing settings inputs don't use a dedicated class (see Pre-Execution note N6):

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
                        value={epmConfigDraft.projects?.[project.homeProjectId]?.jiraLabel || ''}
                        onChange={(event) => updateEpmProjectDraft(project.homeProjectId, 'jiraLabel', event.target.value)}
                        placeholder="Jira label"
                    />
                    <input
                        value={epmConfigDraft.projects?.[project.homeProjectId]?.jiraEpicKey || ''}
                        onChange={(event) => updateEpmProjectDraft(project.homeProjectId, 'jiraEpicKey', event.target.value)}
                        placeholder="Jira epic"
                    />
                </div>
            ))}
            <button type="button" onClick={saveEpmConfig}>Save EPM linkage</button>
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
- Modify: `frontend/dist/dashboard.js` (committed build artifact, see MRT007)
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/features/README.md`
- Create: `docs/features/epm-view.md`

- [ ] **Step 1: Wire the EPM data load and render the project-scoped board**

In `frontend/src/dashboard.jsx`, fetch projects when the user enters `EPM`. For the Active tab, skip the issues fetch entirely when no sprint is selected — the helper card from Task 5b renders instead:

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
    if (epmTab === 'active' && !selectedSprint) {
        setEpmIssues([]);
        setEpmIssueEpics({});
        return;
    }
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

Set the Atlassian Home credentials in `.env` (`ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `ATLASSIAN_CLOUD_ID`, `ROOT_GOAL_KEY`). The email/token default to `JIRA_EMAIL` / `JIRA_TOKEN` when left blank. Then use the `ENG | EPM` switch in the dashboard header to browse Atlassian Home projects and their Jira rollup. EPM Jira queries stay scoped to the projects in `dashboard-config.json → projects.selected`.
```

Update `AGENTS.md`: add a one-paragraph "EPM view" entry alongside the existing feature list, and extend the Commands section with `ATLASSIAN_*` env expectations. Keep the scope discipline notes from `CLAUDE.md` / `AGENTS.md` in sync when you touch either.

- [ ] **Step 3: Run the full verification set**

Run:

```bash
python3 -m unittest tests.test_epm_home_api tests.test_epm_config_api tests.test_epm_projects_api tests.test_epm_scope_resolution -v
node --test tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js
npm run build
python3 -m unittest discover -s tests
```

Expected:

- backend targeted tests PASS
- node source guard tests PASS
- frontend build PASS
- full `unittest` suite PASS

- [ ] **Step 4: Commit the EPM UI wiring, build artifact, and docs**

Per MRT007, the committed build artifact under `frontend/dist/` must ship with the same commit as the JSX change:

```bash
git add frontend/src/dashboard.jsx frontend/dist/dashboard.js frontend/dist/dashboard.css README.md AGENTS.md docs/features/README.md docs/features/epm-view.md
git commit -m "Wire EPM view UI and docs"
```
