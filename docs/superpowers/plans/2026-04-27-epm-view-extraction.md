# EPM View Extraction (Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the current EPM rollup code for the multi-Project portfolio work with zero behavior change, without moving Flask routes or EPM settings yet.

**Architecture:** Keep all `/api/epm/*` routes in `jira_server.py` for Plan 1. Extract only the per-Project rollup algorithm into `epm_rollup.py` behind an explicit dependency object, so existing tests that patch `jira_server` continue to affect the route. On the frontend, keep EPM state ownership in `dashboard.jsx` to preserve saved prefs and header controls; move EPM fetch wrappers and reusable EPM rollup tree rendering into `frontend/src/epm/`.

**Tech Stack:** Python 3, Flask, React 19, esbuild, Python `unittest`, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-04-27-epm-multi-project-rollup-design.md` §0 and "Implementation Streams" Stream A/C prep.

---

## Scope

This is a preparation plan only.

In scope:

- Extract the per-Project rollup algorithm from `jira_server.py` into `epm_rollup.py`.
- Preserve the existing `/api/epm/projects/<project_id>/rollup` endpoint and response shape.
- Add direct unit tests for the extracted builder.
- Add frontend EPM fetch wrappers.
- Extract reusable EPM rollup tree rendering into `frontend/src/epm/EpmRollupTree.jsx`.
- Extract the EPM focus-mode rollup panel into `frontend/src/epm/EpmRollupPanel.jsx`.
- Keep `dashboard.jsx` as the state owner and shell/router.
- Add source guards proving EPM aggregate/future work has a module home and ENG paths stay isolated.

Out of scope:

- No Flask Blueprint in Plan 1.
- No moving `/api/epm/*` routes out of `jira_server.py`.
- No moving EPM config/settings modal JSX.
- No moving `epmTab`, `epmSelectedProjectId`, saved prefs, or EPM settings state out of `dashboard.jsx`.
- No aggregate `/api/epm/projects/rollup/all` endpoint.
- No "All projects" picker behavior.
- No frontend all-Projects portfolio UI.

## Operating Rules

- Every commit must be green. Do not commit red tests.
- A newly created Python module must be parsed and imported before its first commit. If no test imports it yet, run `.venv/bin/python -m py_compile <path>` and `.venv/bin/python -c "import <module>"` before committing.
- A newly created frontend module must be imported by the same commit and parsed by `npm run build` before committing. Do not commit standalone JS/JSX files that the bundle does not reach.
- Commit boundaries must keep "create module" and "first parser/import verification" together. If a module is intentionally unreferenced, its task must include an explicit parser/import command before the commit.
- Existing EPM API tests that patch `jira_server` must keep working.
- Keep changes surgical: move logic, add wrappers, and wire them. Do not restyle or rename unrelated code.
- Do not hand-edit `frontend/dist/`; use `npm run build`.
- If on `main`, stop and create a branch before editing.

## File Map

- `epm_rollup.py`: new backend module containing `EpmRollupDependencies`, `build_per_project_rollup`, and any private helpers needed only by that builder.
- `jira_server.py`: keeps Flask routes and existing helper definitions; the rollup route delegates to `build_per_project_rollup`.
- `tests/test_epm_rollup_builder.py`: direct tests for `build_per_project_rollup` using explicit fake dependencies.
- `frontend/src/epm/epmFetch.js`: thin wrappers for current EPM endpoints.
- `frontend/src/epm/EpmRollupTree.jsx`: reusable EPM issue/epic/initiative tree renderer for focus mode and future all-Projects mode.
- `frontend/src/epm/EpmRollupPanel.jsx`: presentational focus-mode rollup renderer extracted from `dashboard.jsx`.
- `frontend/src/dashboard.jsx`: keeps EPM state and settings; imports fetch wrappers and `EpmRollupPanel`.
- `tests/test_epm_view_source_guards.js`, `tests/test_epm_shell_source_guards.js`: update only as needed to point guards at the new module locations.

---

## Pre-Flight

- [ ] **Step 0.1: Confirm branch and working tree**

```bash
git status --short --branch
git rev-parse --abbrev-ref HEAD
```

Expected: branch is not `main`. If there are unrelated dirty files, leave them untouched and do not include them in commits.

- [ ] **Step 0.2: Run current focused baselines**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_epm_projects_api tests.test_epm_issues_endpoint
node --test tests/test_epm_project_utils.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: record current pass/fail counts before editing. Do not proceed if new failures appear outside the known repo baseline.

---

## Task 1: Add `epm_rollup.py` with Dependency Injection

**Files:**

- Create: `epm_rollup.py`
- Test later in Task 2.

- [ ] **Step 1.1: Create the dependency object and builder skeleton**

Create `epm_rollup.py`:

```python
from dataclasses import dataclass
from typing import Callable, MutableMapping
import time

from epm_scope import build_rollup_jqls, should_apply_epm_sprint


@dataclass
class EpmRollupDependencies:
    # Temporary migration boundary: keeps jira_server patch targets working
    # while avoiding circular imports. Do not reuse this large dependency
    # object pattern for new feature modules.
    find_epm_project_or_404: Callable
    normalize_epm_text: Callable
    validate_epm_tab_sprint: Callable
    build_empty_epm_rollup_payload: Callable
    build_base_jql: Callable
    add_clause_to_jql: Callable
    build_jira_headers: Callable
    resolve_epic_link_field_id: Callable
    build_epm_rollup_fields_list: Callable
    get_epm_config: Callable
    normalize_epm_issue_type_sets: Callable
    fetch_epm_rollup_query: Callable
    shape_epm_rollup_issue_payload: Callable
    dedupe_issues_by_key: Callable
    build_epm_rollup_hierarchy: Callable
    cache: MutableMapping
    cache_lock: object
    cache_ttl_seconds: int
    now: Callable = time.time


def build_per_project_rollup(project_id, tab, sprint, deps):
    tab = str(tab or 'active').strip().lower()
    sprint = str(sprint or '').strip()
    validation_error = deps.validate_epm_tab_sprint(tab, sprint)
    if validation_error:
        error_payload, status = validation_error
        return error_payload, status, {}

    project = deps.find_epm_project_or_404(project_id)
    label = deps.normalize_epm_text(project.get('label'))
    rollup_jqls = build_rollup_jqls(label)
    if not rollup_jqls:
        return deps.build_empty_epm_rollup_payload(project, metadata_only=True), 200, {}

    base_jql = deps.build_base_jql()
    cache_key = f"{project_id}::{tab}::{sprint}::{label}::{base_jql}"
    with deps.cache_lock:
        cached = deps.cache.get(cache_key)
    if cached and (deps.now() - cached['timestamp']) < deps.cache_ttl_seconds:
        return cached['data'], 200, {'Server-Timing': 'cache;dur=1'}

    started = time.perf_counter()
    s1_jql, child_predicate = rollup_jqls
    headers = deps.build_jira_headers()
    epic_link_field_id = deps.resolve_epic_link_field_id(headers)
    fields_list = deps.build_epm_rollup_fields_list(epic_link_field_id)
    epm_config = deps.get_epm_config()
    issue_type_sets = deps.normalize_epm_issue_type_sets(epm_config.get('issueTypes') or {})
    truncated_queries = []

    def with_sprint_filter(jql):
        if should_apply_epm_sprint(tab):
            return deps.add_clause_to_jql(jql, f'Sprint = {sprint}')
        return jql

    q1_jql = with_sprint_filter(deps.add_clause_to_jql(base_jql, s1_jql))
    q1_raw = deps.fetch_epm_rollup_query(q1_jql, 'q1', headers, fields_list, truncated_queries)
    if not q1_raw:
        payload = deps.build_empty_epm_rollup_payload(project, empty_rollup=True)
        with deps.cache_lock:
            deps.cache[cache_key] = {'timestamp': deps.now(), 'data': payload}
        return payload, 200, {'Server-Timing': f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'}

    q1_issues, _ = deps.shape_epm_rollup_issue_payload(q1_raw, epic_link_field_id=epic_link_field_id)
    initiative_or_epic_types = issue_type_sets['initiative'] | issue_type_sets['epic']
    q2_seed_keys = sorted({
        issue.get('key')
        for issue in q1_issues
        if deps.normalize_epm_text(issue.get('issueType')).lower() in initiative_or_epic_types and issue.get('key')
    })

    q2_issues = []
    q2_predicate = child_predicate(q2_seed_keys)
    if q2_predicate:
        q2_jql = with_sprint_filter(deps.add_clause_to_jql(base_jql, q2_predicate))
        q2_raw = deps.fetch_epm_rollup_query(q2_jql, 'q2', headers, fields_list, truncated_queries)
        q2_issues, _ = deps.shape_epm_rollup_issue_payload(q2_raw, epic_link_field_id=epic_link_field_id)

    q3_seed_keys = sorted({
        issue.get('key')
        for issue in q2_issues
        if deps.normalize_epm_text(issue.get('issueType')).lower() in issue_type_sets['epic'] and issue.get('key')
    })

    q3_issues = []
    q3_predicate = child_predicate(q3_seed_keys)
    if q3_predicate:
        q3_jql = with_sprint_filter(deps.add_clause_to_jql(base_jql, q3_predicate))
        q3_raw = deps.fetch_epm_rollup_query(q3_jql, 'q3', headers, fields_list, truncated_queries)
        q3_issues, _ = deps.shape_epm_rollup_issue_payload(q3_raw, epic_link_field_id=epic_link_field_id)

    hierarchy = deps.build_epm_rollup_hierarchy(
        deps.dedupe_issues_by_key(q1_issues + q2_issues + q3_issues),
        epm_config.get('issueTypes') or {},
    )
    payload = {
        'project': project,
        'metadataOnly': False,
        'emptyRollup': False,
        'truncated': bool(truncated_queries),
        'truncatedQueries': truncated_queries,
        **hierarchy,
    }
    with deps.cache_lock:
        deps.cache[cache_key] = {'timestamp': deps.now(), 'data': payload}
    return payload, 200, {'Server-Timing': f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'}
```

- [ ] **Step 1.2: Compile/import the new module and run unchanged API tests**

```bash
.venv/bin/python -m py_compile epm_rollup.py
.venv/bin/python -c "import epm_rollup"
.venv/bin/python -m unittest tests.test_epm_rollup_api -v
```

Expected: `epm_rollup.py` parses and imports successfully, and existing rollup API tests still run exactly as before because `jira_server.py` is not wired yet.

- [ ] **Step 1.3: Commit**

```bash
git add epm_rollup.py
git commit -m "refactor(epm): add injectable per-project rollup builder"
```

---

## Task 2: Add Direct Builder Tests

**Files:**

- Create: `tests/test_epm_rollup_builder.py`

- [ ] **Step 2.1: Add builder tests with fake dependencies**

Create `tests/test_epm_rollup_builder.py`:

```python
import threading
import unittest

import jira_server
from epm_rollup import EpmRollupDependencies, build_per_project_rollup


class BuildPerProjectRollupTests(unittest.TestCase):
    def make_deps(self, project, fetch_results):
        cache = {}
        fetch_calls = []

        def fetch_epm_rollup_query(jql, query_name, headers, fields_list, truncated_queries):
            fetch_calls.append((query_name, jql))
            return list(fetch_results.pop(0)) if fetch_results else []

        deps = EpmRollupDependencies(
            find_epm_project_or_404=lambda project_id: project,
            normalize_epm_text=jira_server.normalize_epm_text,
            validate_epm_tab_sprint=jira_server.validate_epm_tab_sprint,
            build_empty_epm_rollup_payload=jira_server.build_empty_epm_rollup_payload,
            build_base_jql=lambda: 'project = SYN ORDER BY created DESC',
            add_clause_to_jql=jira_server.add_clause_to_jql,
            build_jira_headers=lambda: {'Authorization': 'Basic synthetic'},
            resolve_epic_link_field_id=lambda headers: 'customfield_epiclink',
            build_epm_rollup_fields_list=jira_server.build_epm_rollup_fields_list,
            get_epm_config=lambda: {
                'version': 2,
                'labelPrefix': 'synthetic_',
                'scope': {},
                'issueTypes': jira_server.DEFAULT_EPM_ISSUE_TYPES,
                'projects': {},
            },
            normalize_epm_issue_type_sets=jira_server.normalize_epm_issue_type_sets,
            fetch_epm_rollup_query=fetch_epm_rollup_query,
            shape_epm_rollup_issue_payload=jira_server.shape_epm_rollup_issue_payload,
            dedupe_issues_by_key=jira_server.dedupe_issues_by_key,
            build_epm_rollup_hierarchy=jira_server.build_epm_rollup_hierarchy,
            cache=cache,
            cache_lock=threading.Lock(),
            cache_ttl_seconds=300,
        )
        return deps, cache, fetch_calls

    def make_issue(self, key, issue_type='Story', parent_key='', labels=None):
        fields = {
            'summary': key,
            'status': {'name': 'In Progress'},
            'assignee': {'displayName': 'Alex'},
            'issuetype': {'name': issue_type},
            'labels': list(labels or []),
            'customfield_sprint': [],
        }
        if parent_key:
            fields['parent'] = {
                'key': parent_key,
                'fields': {
                    'summary': f'{parent_key} summary',
                    'issuetype': {'name': 'Epic'},
                },
            }
        return {'key': key, 'fields': fields}

    def test_metadata_only_short_circuit(self):
        project = {'id': 'proj-a', 'label': '', 'resolvedLinkage': {'labels': [], 'epicKeys': []}}
        deps, _, fetch_calls = self.make_deps(project, [])

        payload, status, headers = build_per_project_rollup('proj-a', 'backlog', '', deps)

        self.assertEqual(status, 200)
        self.assertEqual(headers, {})
        self.assertTrue(payload['metadataOnly'])
        self.assertFalse(payload['emptyRollup'])
        self.assertEqual(fetch_calls, [])

    def test_empty_rollup_when_no_q1_hits(self):
        project = {'id': 'proj-b', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        deps, cache, fetch_calls = self.make_deps(project, [[]])

        payload, status, headers = build_per_project_rollup('proj-b', 'backlog', '', deps)

        self.assertEqual(status, 200)
        self.assertFalse(payload['metadataOnly'])
        self.assertTrue(payload['emptyRollup'])
        self.assertEqual([name for name, _ in fetch_calls], ['q1'])
        self.assertIn('Server-Timing', headers)
        self.assertEqual(len(cache), 1)

    def test_active_requires_numeric_sprint(self):
        project = {'id': 'proj-c', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        deps, _, fetch_calls = self.make_deps(project, [])

        payload, status, headers = build_per_project_rollup('proj-c', 'active', '', deps)

        self.assertEqual(status, 400)
        self.assertEqual(payload, {'error': 'sprint_required'})
        self.assertEqual(headers, {})
        self.assertEqual(fetch_calls, [])

    def test_builds_initiative_epic_story_hierarchy_and_caches(self):
        project = {'id': 'proj-d', 'label': 'synthetic_label_alpha', 'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []}}
        q1 = [self.make_issue('INIT-1', 'Initiative', labels=['synthetic_label_alpha'])]
        q2 = [self.make_issue('EPIC-1', 'Epic', parent_key='INIT-1')]
        q3 = [self.make_issue('STORY-1', 'Story', parent_key='EPIC-1')]
        deps, cache, fetch_calls = self.make_deps(project, [q1, q2, q3])

        first_payload, first_status, first_headers = build_per_project_rollup('proj-d', 'backlog', '', deps)
        second_payload, second_status, second_headers = build_per_project_rollup('proj-d', 'backlog', '', deps)

        self.assertEqual(first_status, 200)
        self.assertEqual(second_status, 200)
        self.assertIn('Server-Timing', first_headers)
        self.assertEqual(second_headers, {'Server-Timing': 'cache;dur=1'})
        self.assertEqual(first_payload, second_payload)
        self.assertEqual([name for name, _ in fetch_calls], ['q1', 'q2', 'q3'])
        self.assertEqual(len(cache), 1)
        self.assertIn('INIT-1', first_payload['initiatives'])
        self.assertIn('EPIC-1', first_payload['initiatives']['INIT-1']['epics'])
        self.assertEqual(
            first_payload['initiatives']['INIT-1']['epics']['EPIC-1']['stories'][0]['key'],
            'STORY-1',
        )


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2.2: Run builder tests**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_builder -v
```

Expected: 4 tests pass.

- [ ] **Step 2.3: Run existing rollup API tests**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_api -v
```

Expected: existing tests still pass.

- [ ] **Step 2.4: Commit**

```bash
git add tests/test_epm_rollup_builder.py
git commit -m "test(epm): cover injectable per-project rollup builder"
```

---

## Task 3: Wire the Existing Rollup Route to the Builder

**Files:**

- Modify: `jira_server.py`
- Test: `tests/test_epm_rollup_api.py`, `tests/test_epm_rollup_builder.py`

- [ ] **Step 3.1: Import the builder**

In `jira_server.py`, add near the other local imports:

```python
from epm_rollup import EpmRollupDependencies, build_per_project_rollup
```

- [ ] **Step 3.2: Add route dependency factory**

Add this helper near the existing EPM helper functions in `jira_server.py`:

```python
def build_epm_rollup_dependencies():
    return EpmRollupDependencies(
        find_epm_project_or_404=find_epm_project_or_404,
        normalize_epm_text=normalize_epm_text,
        validate_epm_tab_sprint=validate_epm_tab_sprint,
        build_empty_epm_rollup_payload=build_empty_epm_rollup_payload,
        build_base_jql=build_base_jql,
        add_clause_to_jql=add_clause_to_jql,
        build_jira_headers=build_jira_headers,
        resolve_epic_link_field_id=resolve_epic_link_field_id,
        build_epm_rollup_fields_list=build_epm_rollup_fields_list,
        get_epm_config=get_epm_config,
        normalize_epm_issue_type_sets=normalize_epm_issue_type_sets,
        fetch_epm_rollup_query=fetch_epm_rollup_query,
        shape_epm_rollup_issue_payload=shape_epm_rollup_issue_payload,
        dedupe_issues_by_key=dedupe_issues_by_key,
        build_epm_rollup_hierarchy=build_epm_rollup_hierarchy,
        cache=EPM_ROLLUP_CACHE,
        cache_lock=_epm_cache_lock,
        cache_ttl_seconds=EPM_ROLLUP_CACHE_TTL_SECONDS,
    )
```

This factory must stay in `jira_server.py` so existing tests that patch `jira_server.find_epm_project_or_404`, `jira_server.fetch_issues_by_jql`, `jira_server.get_epm_config`, or `jira_server.EPM_ROLLUP_CACHE` still affect route execution.

- [ ] **Step 3.3: Replace the rollup route body**

Replace only `get_epm_project_rollup_endpoint` with:

```python
@app.route('/api/epm/projects/<project_id>/rollup', methods=['GET'])
def get_epm_project_rollup_endpoint(project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    payload, status, headers = build_per_project_rollup(
        project_id,
        tab,
        sprint,
        build_epm_rollup_dependencies(),
    )
    response = jsonify(payload)
    for key, value in headers.items():
        response.headers[key] = value
    return response, status
```

Do not move any other route in this task.

- [ ] **Step 3.4: Run rollup tests**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_epm_rollup_builder -v
```

Expected: all tests pass. Existing `tests/test_epm_rollup_api.py` patches against `jira_server` must still affect the route.

- [ ] **Step 3.5: Run adjacent EPM API tests**

```bash
.venv/bin/python -m unittest tests.test_epm_projects_api tests.test_epm_issues_endpoint -v
```

Expected: all tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add jira_server.py epm_rollup.py tests/test_epm_rollup_builder.py
git commit -m "refactor(epm): route per-project rollup through builder"
```

---

## Task 4: Add and Wire EPM Fetch Wrappers Without Moving State

**Files:**

- Create: `frontend/src/epm/epmFetch.js`
- Modify: `frontend/src/dashboard.jsx`
- Test: frontend build and source guards.

- [ ] **Step 4.1: Add wrappers for current EPM endpoints**

Create `frontend/src/epm/epmFetch.js`:

```javascript
const json = async (response, label) => {
    if (!response.ok) {
        throw new Error(`${label} error ${response.status}`);
    }
    return response.json();
};

export const fetchEpmConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/config`, { cache: 'no-cache' }).then(response => json(response, 'EPM config'));

export const fetchEpmScope = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/scope`, { cache: 'no-cache' }).then(response => json(response, 'EPM scope'));

export const fetchEpmGoals = (backendUrl, rootGoalKey = '') => {
    const key = String(rootGoalKey || '').trim();
    const url = key
        ? `${backendUrl}/api/epm/goals?rootGoalKey=${encodeURIComponent(key)}`
        : `${backendUrl}/api/epm/goals`;
    return fetch(url, { cache: 'no-cache' }).then(response => json(response, 'EPM goals'));
};

export const fetchEpmProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/projects`, { cache: 'no-cache' }).then(response => json(response, 'EPM projects'));

export const previewEpmProjects = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/epm/projects/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(response => json(response, 'EPM preview'));

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint } = {}) => {
    const params = new URLSearchParams({ tab: tab || 'active' });
    if (tab === 'active' && sprint) {
        params.set('sprint', String(sprint));
    }
    return fetch(`${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`, { cache: 'no-cache' })
        .then(response => json(response, 'EPM rollup'));
};
```

Do not commit after this step. `epmFetch.js` is not verified until `dashboard.jsx` imports it and `npm run build` parses it in Step 4.4.

- [ ] **Step 4.2: Import wrappers**

In `frontend/src/dashboard.jsx`, add:

```javascript
import { fetchEpmConfig, fetchEpmScope, fetchEpmGoals, fetchEpmProjects, previewEpmProjects, fetchEpmProjectRollup } from './epm/epmFetch.js';
```

- [ ] **Step 4.3: Replace local fetch bodies**

Replace the existing EPM loader bodies only:

```javascript
const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);
const loadEpmScopeMeta = () => fetchEpmScope(BACKEND_URL);
const loadEpmGoals = (rootGoalKey = '') => fetchEpmGoals(BACKEND_URL, rootGoalKey);
const loadEpmProjects = () => fetchEpmProjects(BACKEND_URL);
const loadEpmProjectPreview = (draftConfig) => previewEpmProjects(BACKEND_URL, normalizeEpmConfigDraft(draftConfig));
```

In `refreshEpmRollup`, replace the direct rollup `fetch(...)` call with:

```javascript
const payload = await fetchEpmProjectRollup(BACKEND_URL, currentProjectId, {
    tab: epmTab,
    sprint: selectedSprint,
});
```

Preserve all request-id checks, state updates, error messages, and existing active-sprint gating.

- [ ] **Step 4.4: Build and run source guards**

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: all pass. `npm run build` must parse `frontend/src/epm/epmFetch.js` through the `dashboard.jsx` import. If source guards assert literal fetch strings in `dashboard.jsx`, update them to require the same endpoint strings in `frontend/src/epm/epmFetch.js`.

- [ ] **Step 4.5: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/epm/epmFetch.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
git commit -m "refactor(epm): route dashboard EPM loads through fetch wrappers"
```

---

## Task 5: Extract Reusable EPM Rollup Tree and Focus Panel

**Files:**

- Create: `frontend/src/epm/EpmRollupTree.jsx`
- Create: `frontend/src/epm/EpmRollupPanel.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Test: frontend build and source guards.

- [ ] **Step 5.1: Create the reusable tree renderer**

Create `frontend/src/epm/EpmRollupTree.jsx`:

```javascript
import React from 'react';
import { getEpmProjectDisplayName } from './epmProjectUtils.mjs';

export function EpmRollupIssue({ issue, jiraUrl, extraClassName = '' }) {
    const issueHref = jiraUrl ? `${jiraUrl}/browse/${issue.key}` : '#';
    return (
        <div
            key={issue.key}
            className={`task-item ${extraClassName}`.trim()}
            data-task-key={issue.key}
            data-task-id={issue.key}
            data-issue-key={issue.key}
        >
            <div className="task-header">
                <div className="task-headline">
                    <h3 className="task-title">
                        <a href={issueHref} target="_blank" rel="noopener noreferrer">
                            {issue.summary || issue.key}
                        </a>
                    </h3>
                    <span className="task-inline-meta">
                        <a className="task-key-link" href={issueHref} target="_blank" rel="noopener noreferrer">
                            {issue.key}
                        </a>
                        {issue.issueType && (
                            <span className="task-inline-sp">{issue.issueType}</span>
                        )}
                    </span>
                </div>
            </div>
            <div className="task-meta">
                <span className={`task-status ${String(issue.status || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>
                    {issue.status || 'Unknown'}
                </span>
                <span className="task-team">{issue.assignee || 'Unassigned'}</span>
            </div>
        </div>
    );
}

export function EpmEpicNode({ epicNode, jiraUrl }) {
    return (
        <div key={epicNode.issue.key} className="epm-rollup-epic">
            <EpmRollupIssue issue={epicNode.issue} jiraUrl={jiraUrl} extraClassName="epm-rollup-epic-issue" />
            {epicNode.stories.length > 0 && (
                <div className="epm-rollup-children">
                    {epicNode.stories.map(story => (
                        <EpmRollupIssue key={story.key} issue={story} jiraUrl={jiraUrl} extraClassName="epm-rollup-story" />
                    ))}
                </div>
            )}
        </div>
    );
}

export function EpmInitiativeNode({ initiativeNode, jiraUrl, InitiativeIcon }) {
    return (
        <div key={initiativeNode.issue.key} className="initiative-group">
            <div className="initiative-header">
                <InitiativeIcon className="initiative-header-icon" />
                <div className="initiative-label">
                    <span className="initiative-label-name">{initiativeNode.issue.summary || initiativeNode.issue.key}</span>
                    <a
                        className="initiative-label-key"
                        href={jiraUrl ? `${jiraUrl}/browse/${initiativeNode.issue.key}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {initiativeNode.issue.key} ↗
                    </a>
                    <span className="initiative-divider" />
                </div>
            </div>
            <div className="initiative-body">
                {initiativeNode.epics.map(epicNode => (
                    <EpmEpicNode key={epicNode.issue.key} epicNode={epicNode} jiraUrl={jiraUrl} />
                ))}
                {initiativeNode.looseStories.map(story => (
                    <EpmRollupIssue key={story.key} issue={story} jiraUrl={jiraUrl} extraClassName="epm-rollup-story" />
                ))}
            </div>
        </div>
    );
}

export function EpmProjectRemainder({ project, tree, jiraUrl }) {
    if (!tree || (tree.rootEpics.length === 0 && tree.orphanStories.length === 0)) return null;
    return (
        <div className="initiative-group initiative-single">
            <div className="initiative-header">
                <div className="initiative-label initiative-label-only">
                    <span className="initiative-label-name">{getEpmProjectDisplayName(project)}</span>
                    <span className="initiative-label-key">Project</span>
                    <span className="initiative-divider" />
                </div>
            </div>
            <div className="initiative-body">
                {tree.rootEpics.map(epicNode => (
                    <EpmEpicNode key={epicNode.issue.key} epicNode={epicNode} jiraUrl={jiraUrl} />
                ))}
                {tree.orphanStories.length > 0 && (
                    <div className="epm-rollup-orphans">
                        <div className="group-field-helper">Project stories</div>
                        {tree.orphanStories.map(story => (
                            <EpmRollupIssue key={story.key} issue={story} jiraUrl={jiraUrl} extraClassName="epm-rollup-story" />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
```

This is EPM-specific reuse. Do not couple it to the ENG task list, planning, alerts, or scenario rendering.

- [ ] **Step 5.2: Create the focus-mode panel**

Create `frontend/src/epm/EpmRollupPanel.jsx`:

```javascript
import React from 'react';
import { getEpmProjectDisplayName } from './epmProjectUtils.mjs';
import { EpmInitiativeNode, EpmProjectRemainder } from './EpmRollupTree.jsx';

export function EpmRollupPanel({
    selectedEpmProject,
    selectedEpmProjectUpdateLine,
    epmTab,
    selectedSprint,
    epmRollupLoading,
    epmRollupTree,
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
    if (!selectedEpmProject) return null;

    if (epmRollupTree?.kind === 'metadataOnly') {
        return (
            <div className="group-config-card epm-home-card">
                <div className="group-pane-title">{getEpmProjectDisplayName(selectedEpmProject)}</div>
                <div className="group-pane-subtitle">
                    {selectedEpmProjectUpdateLine || 'No updates yet'}
                </div>
                <a href={selectedEpmProject.homeUrl} target="_blank" rel="noopener noreferrer">Open in Jira Home</a>
                <div className="group-field-helper">Add a Jira label in Settings {'->'} EPM to pull Jira work into this view.</div>
                <button
                    className="secondary compact"
                    onClick={openEpmSettingsTab}
                    type="button"
                >
                    Open Settings
                </button>
            </div>
        );
    }

    if (epmTab === 'active' && !selectedSprint) {
        return (
            <div className="empty-state">
                <h2>Select a sprint</h2>
                <p>Select a sprint to see active work.</p>
            </div>
        );
    }

    if (epmRollupLoading) {
        return (
            <div className="empty-state">
                <h2>Loading Jira issues</h2>
                <p>Refreshing the selected EPM project board.</p>
            </div>
        );
    }

    if (epmRollupTree?.kind === 'emptyRollup') {
        return (
            <div className="empty-state">
                <h2>No Jira work found</h2>
                <p>No issues match this label in the current scope.</p>
            </div>
        );
    }

    if (epmRollupTree?.kind !== 'tree') return null;

    return (
        <div className="task-list epm-issue-board">
            {epmRollupTree.truncated && (
                <div className="group-field-helper">
                    This rollup is truncated; narrow the label or Jira scope.
                </div>
            )}
            {epmRollupTree.initiatives.map(initiativeNode => (
                <EpmInitiativeNode
                    key={initiativeNode.issue.key}
                    initiativeNode={initiativeNode}
                    jiraUrl={jiraUrl}
                    InitiativeIcon={InitiativeIcon}
                />
            ))}
            <EpmProjectRemainder project={selectedEpmProject} tree={epmRollupTree} jiraUrl={jiraUrl} />
        </div>
    );
}
```

- [ ] **Step 5.3: Import and use the panel in `dashboard.jsx`**

Add:

```javascript
import { EpmRollupPanel } from './epm/EpmRollupPanel.jsx';
```

Replace only the current focus-mode rollup render branches for selected projects with:

```javascript
{selectedEpmProject && (
    <EpmRollupPanel
        selectedEpmProject={selectedEpmProject}
        selectedEpmProjectUpdateLine={selectedEpmProjectUpdateLine}
        epmTab={epmTab}
        selectedSprint={selectedSprint}
        epmRollupLoading={epmRollupLoading}
        epmRollupTree={epmRollupTree}
        openEpmSettingsTab={openEpmSettingsTab}
        jiraUrl={jiraUrl}
        InitiativeIcon={InitiativeIcon}
    />
)}
```

Keep the "Select a project", "Loading EPM projects", and "Project unavailable" states in `dashboard.jsx` for now.

- [ ] **Step 5.4: Remove migrated EPM rollup render helpers from `dashboard.jsx`**

Remove `renderEpmRollupIssue`, `renderEpmEpicNode`, and `renderEpmInitiativeNode` from `dashboard.jsx` after `EpmRollupPanel` is wired. They now live in `frontend/src/epm/EpmRollupTree.jsx`.

- [ ] **Step 5.5: Build and run source guards**

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: all pass. Update source guards to accept `EpmRollupPanel.jsx` as the home for metadata-only, empty-rollup, and truncation render strings, and `EpmRollupTree.jsx` as the home for Initiative/Epic/Story tree rendering.

- [ ] **Step 5.6: Commit**

```bash
git add frontend/src/epm/EpmRollupTree.jsx frontend/src/epm/EpmRollupPanel.jsx frontend/src/dashboard.jsx tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
git commit -m "refactor(epm): extract reusable EPM rollup tree and panel"
```

---

## Task 6: Add Isolation Guards for Future Aggregate Work

**Files:**

- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `tests/test_epm_shell_source_guards.js`

- [ ] **Step 6.1: Add guard for EPM module homes**

Extend source guards so they read `frontend/src/epm/epmFetch.js`, `frontend/src/epm/EpmRollupPanel.jsx`, and `frontend/src/epm/EpmRollupTree.jsx`.

Required assertions:

```javascript
assert.ok(epmFetchSource.includes('/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}') || epmFetchSource.includes('/api/epm/projects/'), 'Expected EPM fetch URLs to live in epmFetch.js');
assert.ok(epmPanelSource.includes('This rollup is truncated; narrow the label or Jira scope.'), 'Expected rollup truncation UI in EpmRollupPanel.jsx');
assert.ok(epmPanelSource.includes('No issues match this label in the current scope.'), 'Expected empty rollup UI in EpmRollupPanel.jsx');
assert.ok(epmTreeSource.includes('EpmInitiativeNode'), 'Expected reusable initiative renderer in EpmRollupTree.jsx');
assert.ok(epmTreeSource.includes('EpmEpicNode'), 'Expected reusable epic renderer in EpmRollupTree.jsx');
assert.ok(epmTreeSource.includes('EpmRollupIssue'), 'Expected reusable issue renderer in EpmRollupTree.jsx');
```

- [ ] **Step 6.2: Add guard for ENG isolation**

Add assertions that `frontend/src/epm/epmFetch.js` and `frontend/src/epm/EpmRollupPanel.jsx` do not reference ENG-only endpoints or planning/scenario strings:

```javascript
for (const source of [epmFetchSource, epmPanelSource, epmTreeSource]) {
    assert.ok(!source.includes('/api/tasks-with-team-name'), 'EPM modules must not fetch ENG tasks');
    assert.ok(!source.includes('/api/backlog-epics'), 'EPM modules must not fetch ENG backlog epics');
    assert.ok(!source.includes('showPlanning'), 'EPM modules must not own planning state');
    assert.ok(!source.includes('showScenario'), 'EPM modules must not own scenario state');
}
```

- [ ] **Step 6.3: Run guards**

```bash
node --test tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: all pass.

- [ ] **Step 6.4: Commit**

```bash
git add tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
git commit -m "test(epm): guard EPM extraction boundaries"
```

---

## Task 7: Final Verification

**Files:**

- No intended source changes.

- [ ] **Step 7.1: Run focused backend tests**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_epm_rollup_builder tests.test_epm_projects_api tests.test_epm_issues_endpoint -v
```

Expected: all pass.

- [ ] **Step 7.2: Run focused frontend tests**

```bash
npm run build
node --test tests/test_epm_project_utils.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: all pass.

- [ ] **Step 7.3: Confirm route ownership intentionally remains in `jira_server.py`**

```bash
grep -nE "^@app.route\\('/api/epm" jira_server.py
```

Expected: existing `/api/epm/*` routes still appear. This is intentional in Plan 1 to avoid circular imports and preserve existing test patch targets.

- [ ] **Step 7.4: Confirm no Blueprint was introduced**

```bash
test ! -f epm_view.py
```

Expected: command exits 0.

- [ ] **Step 7.5: Confirm EPM settings stayed in `dashboard.jsx`**

```bash
grep -n "groupManageTab === 'epm'" frontend/src/dashboard.jsx
```

Expected: matches remain. Settings extraction is deliberately deferred.

- [ ] **Step 7.6: Optional manual check**

Run the app and verify EPM focus mode on Active, Backlog, and Archived. Also switch to ENG Catch Up, Planning, and Scenario to confirm the extraction did not alter those branches.

```bash
npm run build
.venv/bin/python jira_server.py
```

- [ ] **Step 7.7: Commit verification note only if fixes were needed**

If Task 7 required no source fixes, do not create an empty commit. If fixes were needed, commit only those fixes with a descriptive message.

---

## Acceptance Criteria

- `epm_rollup.py` exists and exposes `EpmRollupDependencies` plus `build_per_project_rollup`.
- `jira_server.py` still owns `/api/epm/*` routes and delegates only the per-Project rollup algorithm to `epm_rollup.py`.
- Existing EPM API tests that patch `jira_server` continue to pass.
- `tests/test_epm_rollup_builder.py` exists and passes without committing any red state.
- `frontend/src/epm/epmFetch.js` owns current EPM endpoint URL construction.
- `frontend/src/epm/EpmRollupTree.jsx` owns reusable Initiative/Epic/Story tree rendering for EPM.
- `frontend/src/epm/EpmRollupPanel.jsx` owns the focus-mode EPM rollup panel.
- `dashboard.jsx` still owns EPM state, saved prefs, header controls, and settings modal state.
- EPM settings extraction is explicitly deferred.
- No Blueprint or circular backend import path is introduced.
- Focused backend and frontend verification commands pass.

## Deferred to Later Plans

- Move `/api/epm/*` routes into a Blueprint only after shared Jira/config dependencies are split out of `jira_server.py`.
- Move EPM settings into its own component after the portfolio rollup lands or if settings become a direct blocker.
- Introduce `useEpmRollup` or EPM context only when all-Projects mode needs shared header/body state beyond the current `dashboard.jsx` ownership.
- Add the aggregate endpoint and all-Projects UI in Plan 2.
