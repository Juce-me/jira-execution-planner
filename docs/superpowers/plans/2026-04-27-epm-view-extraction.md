# EPM View Extraction (Plan 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the entire current EPM view from `jira_server.py` and `frontend/src/dashboard.jsx` into self-contained modules with **zero behavior change**, so a follow-up plan (Plan 2) can land the multi-Project portfolio rework cleanly.

**Architecture:** Backend EPM-only routes, helpers, and module state move into a new `epm_view.py` Flask Blueprint that `jira_server.py` registers. The per-Project rollup route body becomes a pure builder function (exported) so Plan 2's fan-out fallback can reuse it. Frontend EPM state, fetch, controls, render, and settings panel content lift out of `dashboard.jsx` into a module set under `frontend/src/epm/`. After Plan 1, `dashboard.jsx` is the shell/router only and mounts `<EpmView />` under `selectedView === 'epm'`.

**Tech Stack:** Python 3, Flask + Flask-Cors (Blueprints), React 19, esbuild, `unittest`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-04-27-epm-multi-project-rollup-design.md` — §0 "Preparation before new behavior" and Plan 1 in "Implementation Streams".

**Operating rules** (re-read before each task):

- **No behavior changes.** Every existing test must remain green at every commit. If a test fails after a move, revert that move; do not adjust the test.
- **Surgical diffs.** Each task moves a coherent chunk. Do not rename, reformat, or "improve" code while moving it. The diff for each commit should read as cut + paste + minimal wiring.
- **Existing patterns.** Match the existing 4-space Python indentation and the existing JS/JSX style in `dashboard.jsx`. No new linters/formatters.
- **Test runner.** Backend: `.venv/bin/python -m unittest <target>`. Frontend pure-fn: `node --test <file>`. Bundle build: `npm run build`. Never hand-edit `frontend/dist/`.
- **Branch.** Confirm you are on `feature/epm-project-view-impl` (or a fresh branch off `main`). If on `main`, stop and create a branch first.
- **Commit cadence.** Every task ends with a commit. No `Co-Authored-By` trailer, no Claude attribution.

---

## Pre-flight

- [ ] **Step 0a: Confirm clean working tree on a non-`main` branch**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean (or only untracked, unrelated files); branch is not `main`. If dirty, stash or commit unrelated changes first.

- [ ] **Step 0b: Confirm baseline test suite is green before any moves**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: all green except the pre-existing `test_jira_resilience.test_api_test_endpoint_fast_fails_when_circuit_is_open` failure (documented in earlier review). Record the exact pass/fail counts; you'll compare against this baseline at every later task.

```bash
node --test tests/test_epm_project_utils.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: all green.

---

## Stream A: Backend extraction into `epm_view.py`

The backend extraction can be completed independently of the frontend stream. Tasks 1–11.

### Task 1: Create empty `epm_view.py` Blueprint and register it

**Files:**

- Create: `epm_view.py`
- Modify: `jira_server.py` (top-level imports + Blueprint registration line)

- [ ] **Step 1.1: Create the empty Blueprint module**

Create `epm_view.py` with this exact starter content (no routes yet — moves come in later tasks):

```python
"""
EPM view backend.

Owns every /api/epm/* route handler and EPM-only helper. Extracted from
jira_server.py to keep the EPM portfolio surface self-contained. Plan 2
extends this module with the multi-Project aggregate endpoint.
"""

from flask import Blueprint

epm_view_bp = Blueprint('epm_view', __name__)

# Routes and helpers will be moved here in subsequent tasks.
```

- [ ] **Step 1.2: Register the Blueprint in `jira_server.py`**

In `jira_server.py`, near where other top-level imports live (around line 1–80), add:

```python
from epm_view import epm_view_bp
```

Then immediately after the `app = Flask(__name__)` instantiation (find it; it is near the other `app.config[...]` calls), add:

```python
app.register_blueprint(epm_view_bp)
```

- [ ] **Step 1.3: Run the full backend suite to confirm registration is harmless**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: identical pass/fail counts to the Step 0b baseline. The Blueprint has no routes yet, so nothing has changed behaviorally.

- [ ] **Step 1.4: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): scaffold epm_view Blueprint, register on app"
```

---

### Task 2: Move EPM module-level state into `epm_view.py`

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py:102-106` (and any references)

The constants to move are at `jira_server.py:102-106`:

```python
EPM_ROLLUP_CACHE = {}
# Cached payload key: tuple(project_id, tab_value, sprint_id, base_jql)
EPM_ROLLUP_CACHE_TTL_SECONDS = 300
EPM_ROLLUP_QUERY_MAX_RESULTS = 2000
```

- [ ] **Step 2.1: Cut the constants from `jira_server.py` and paste them into `epm_view.py`**

In `epm_view.py`, immediately after the Blueprint declaration, add the three constants verbatim (including the comment on the cache key shape).

In `jira_server.py`, remove lines 102–106.

- [ ] **Step 2.2: Update every reference in `jira_server.py` to use the moved constants**

Find references with:

```bash
grep -n "EPM_ROLLUP_CACHE\|EPM_ROLLUP_CACHE_TTL_SECONDS\|EPM_ROLLUP_QUERY_MAX_RESULTS" jira_server.py
```

Expected matches at the time of writing: `1380` (`clear_epm_caches`), `1556`, `1558`, `1560` (`fetch_epm_rollup_query`), `6780`, `6781`, `6805`, `6851` (rollup endpoint).

For each, add `from epm_view import EPM_ROLLUP_CACHE, EPM_ROLLUP_CACHE_TTL_SECONDS, EPM_ROLLUP_QUERY_MAX_RESULTS` at the top of `jira_server.py` (or extend the existing `from epm_view import ...` you added in Task 1) and reference the names directly. Do not rename them.

The references are temporary — every one of those call sites is itself slated to move into `epm_view.py` in later tasks. Once a function moves out of `jira_server.py`, it stops needing the import.

- [ ] **Step 2.3: Run the full backend suite**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: identical pass/fail counts to baseline.

- [ ] **Step 2.4: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move EPM_ROLLUP_CACHE constants into epm_view"
```

---

### Task 3: Move pure helpers (text, scope, issue-type, config normalization)

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py` (ranges below)

These helpers have no Flask `request` dependency and no other helper dependencies outside this group, so they move first:

- `normalize_epm_text` — `jira_server.py:1663`
- `normalize_epm_upper_text` — `jira_server.py:1667`
- `normalize_epm_scope` — `jira_server.py:1680`
- `normalize_epm_issue_types` — `jira_server.py:1690`
- `normalize_epm_issue_type_sets` — `jira_server.py:1475`
- `is_epm_v2_config` — `jira_server.py:1706`
- `normalize_epm_project_row` — `jira_server.py:1714`
- `normalize_epm_project_output_key` — `jira_server.py:1743`
- `normalize_epm_config` — `jira_server.py:1752`
- `validate_epm_tab_sprint` — `jira_server.py:1466`

- [ ] **Step 3.1: Cut each function from `jira_server.py` and paste into `epm_view.py`**

Move the functions in the order listed (so a function definition always precedes any later function that references it). Keep the function bodies byte-identical. Preserve any module-level imports they need (e.g., `re`, `time`); add them to `epm_view.py` if not already imported.

- [ ] **Step 3.2: Replace usages in `jira_server.py` with imports from `epm_view`**

Extend the `from epm_view import ...` at the top of `jira_server.py` to include each moved name. Do not duplicate definitions.

Find remaining usages:

```bash
grep -n "normalize_epm_text\|normalize_epm_upper_text\|normalize_epm_scope\|normalize_epm_issue_types\|normalize_epm_issue_type_sets\|is_epm_v2_config\|normalize_epm_project_row\|normalize_epm_project_output_key\|normalize_epm_config\|validate_epm_tab_sprint" jira_server.py
```

All remaining occurrences should be call sites, not definitions.

- [ ] **Step 3.3: Run the full backend suite**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: identical pass/fail counts to baseline.

- [ ] **Step 3.4: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move pure normalization helpers into epm_view"
```

---

### Task 4: Move issue-shaping and field helpers

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py` (ranges below)

- `build_epm_fields_list` — `jira_server.py:1392`
- `build_epm_rollup_fields_list` — `jira_server.py:1400`
- `shape_epm_issue_payload` — `jira_server.py:1410`
- `shape_epm_rollup_issue_payload` — `jira_server.py:1436`
- `build_empty_epm_rollup_payload` — `jira_server.py:1486`
- `build_epm_rollup_hierarchy` — `jira_server.py:1499`
- `fetch_epm_rollup_query` — `jira_server.py:1551`

- [ ] **Step 4.1: Cut and paste each helper in dependency order**

`fetch_epm_rollup_query` references `EPM_ROLLUP_QUERY_MAX_RESULTS` — already in `epm_view.py`. It also calls Jira's HTTP search; preserve any `requests` / `make_jira_request` imports needed.

`build_epm_rollup_hierarchy` consumes shaped issues; move after `shape_epm_rollup_issue_payload`.

- [ ] **Step 4.2: Replace usages in `jira_server.py` with imports**

Update the `from epm_view import ...` block. Verify no duplicate definitions remain in `jira_server.py`:

```bash
grep -nE "^def (build_epm_fields_list|build_epm_rollup_fields_list|shape_epm_issue_payload|shape_epm_rollup_issue_payload|build_empty_epm_rollup_payload|build_epm_rollup_hierarchy|fetch_epm_rollup_query)" jira_server.py
```

Expected: no matches.

- [ ] **Step 4.3: Run full backend suite**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: identical pass/fail counts to baseline.

- [ ] **Step 4.4: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move issue shaping and rollup query helpers into epm_view"
```

---

### Task 5: Move project-payload and lookup helpers

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py`

- `build_custom_project_payload` — `jira_server.py:1583`
- `build_epm_project_payload` — `jira_server.py:1564`
- `find_epm_config_row` — `jira_server.py:1604`
- `build_epm_projects_payload` — `jira_server.py:1621`
- `find_epm_project_or_404` — `jira_server.py:1636`
- `clear_epm_caches` — `jira_server.py:1376`
- `get_epm_config` — `jira_server.py:1776`
- `fetch_epm_goal_catalog` — `jira_server.py:1785`
- `fetch_epm_sub_goals` — `jira_server.py:1796`

- [ ] **Step 5.1: Cut and paste in dependency order**

`find_epm_project_or_404` calls Flask's `abort()` — add `from flask import abort` to `epm_view.py` if not already imported. It also depends on `build_epm_project_payload` and `build_custom_project_payload`; move those first.

`get_epm_config` reads from the JSON config file; preserve its file-IO imports.

`clear_epm_caches` references the rollup cache (already moved) plus any other caches it touches; if it references caches that still live in `jira_server.py` (Home cache, etc.), keep imports both ways for now.

- [ ] **Step 5.2: Replace usages in `jira_server.py` with imports**

Verify no duplicate definitions:

```bash
grep -nE "^def (build_custom_project_payload|build_epm_project_payload|find_epm_config_row|build_epm_projects_payload|find_epm_project_or_404|clear_epm_caches|get_epm_config|fetch_epm_goal_catalog|fetch_epm_sub_goals)" jira_server.py
```

Expected: no matches.

- [ ] **Step 5.3: Run full backend suite**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: identical pass/fail counts to baseline.

- [ ] **Step 5.4: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move project-payload and lookup helpers into epm_view"
```

---

### Task 6: Move simple GET endpoints (`/api/epm/config` GET, `/api/epm/scope`, `/api/epm/goals`)

**Files:**

- Modify: `epm_view.py` (add routes on `epm_view_bp`)
- Modify: `jira_server.py:6657-6697`

Routes to move:

- `GET /api/epm/config` → `get_epm_config_endpoint` (line 6657)
- `GET /api/epm/scope` → `get_epm_scope_endpoint` (line 6662)
- `GET /api/epm/goals` → `get_epm_goals_endpoint` (line 6681)

- [ ] **Step 6.1: Cut each route from `jira_server.py` and paste into `epm_view.py`**

Replace the `@app.route(...)` decorator with `@epm_view_bp.route(...)`. The path stays identical. Preserve every line of the function body verbatim, including any `request` parsing and `jsonify` calls.

Add `from flask import request, jsonify` to `epm_view.py` if not already imported.

- [ ] **Step 6.2: Verify the routes are still discovered**

Quick sanity check: start the server briefly and grep for the routes (or run any of the affected tests):

```bash
.venv/bin/python -m unittest tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_scope_resolution
```

Expected: all green.

- [ ] **Step 6.3: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move EPM config/scope/goals GET endpoints into Blueprint"
```

---

### Task 7: Move `/api/epm/projects` and `/api/epm/projects/preview`

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py:6698-6718`

- `GET /api/epm/projects` → `get_epm_projects_endpoint` (line 6698)
- `POST /api/epm/projects/preview` → `preview_epm_projects_endpoint` (line 6713)

- [ ] **Step 7.1: Cut and paste both routes onto the Blueprint**

Replace `@app.route(...)` with `@epm_view_bp.route(...)`. Paths unchanged.

- [ ] **Step 7.2: Run the targeted suites**

```bash
.venv/bin/python -m unittest tests.test_epm_projects_api tests.test_epm_issues_endpoint
```

Expected: green.

- [ ] **Step 7.3: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move EPM projects list/preview endpoints into Blueprint"
```

---

### Task 8: Move `/api/epm/projects/<home_project_id>/issues`

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py:6719-6761`

`GET /api/epm/projects/<home_project_id>/issues` → `get_epm_project_issues_endpoint` (line 6719).

- [ ] **Step 8.1: Cut and paste**

Replace `@app.route(...)` with `@epm_view_bp.route(...)`.

- [ ] **Step 8.2: Run targeted suite**

```bash
.venv/bin/python -m unittest tests.test_epm_issues_endpoint
```

Expected: green.

- [ ] **Step 8.3: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move EPM issues endpoint into Blueprint"
```

---

### Task 9: Add a direct unit test for the per-Project rollup endpoint body

**Files:**

- Create: `tests/test_epm_rollup_builder.py`

Before extracting the rollup endpoint body into a pure builder (Task 10), lock the desired contract with a direct test against the function-to-be. This guarantees the extracted builder behaves identically to the route. Use the existing `tests/test_epm_rollup_api.py` as a reference for fixture shape — copy the smallest happy-path scenario from it.

- [ ] **Step 9.1: Write the failing test**

Create `tests/test_epm_rollup_builder.py`:

```python
"""
Direct unit tests for the per-Project rollup builder.

Until Task 10 extracts the builder, these tests will fail to import
`build_per_project_rollup`. That is intentional — they are the failing
test that drives the extraction.
"""

import unittest
from unittest.mock import patch, MagicMock

# Importing here will fail until Task 10 introduces the symbol.
from epm_view import build_per_project_rollup


class BuildPerProjectRollupTests(unittest.TestCase):
    """Direct tests for the extracted rollup builder."""

    def test_metadata_only_short_circuit(self):
        """Project with no configured label returns metadata-only payload."""
        project = {
            'id': 'proj-a',
            'displayName': 'Project A',
            'matchState': 'metadata-only',
            'label': '',
        }
        with patch('epm_view.find_epm_project_or_404', return_value=project):
            payload = build_per_project_rollup(
                project_id='proj-a',
                tab='active',
                sprint='123',
                request_headers={},
            )
        self.assertTrue(payload['metadataOnly'])
        self.assertFalse(payload.get('emptyRollup', False))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 9.2: Run the new test to verify it fails**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_builder -v
```

Expected: ImportError on `build_per_project_rollup` (or `ModuleNotFoundError` if the symbol does not yet exist in `epm_view`). This confirms the symbol does not yet exist; Task 10 introduces it.

- [ ] **Step 9.3: Commit the failing test**

```bash
git add tests/test_epm_rollup_builder.py
git commit -m "test(epm): add direct unit test for per-Project rollup builder (red)"
```

---

### Task 10: Extract per-Project rollup route into pure builder + move route to Blueprint

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py:6762-6855`
- Modify: `tests/test_epm_rollup_builder.py` (extend with more cases after green)

The current route body at `jira_server.py:6762-6855` does everything inline: parse params, look up Project, validate, build JQL, fetch, shape, cache, jsonify. Extract every step except request parsing and `jsonify` into a pure function `build_per_project_rollup`.

- [ ] **Step 10.1: Define the extracted builder in `epm_view.py`**

Add this function above any references. The body is the existing route logic with `request.args.get(...)` calls replaced by parameters and `jsonify(...)` removed:

```python
def build_per_project_rollup(project_id, tab, sprint, request_headers):
    """
    Build the per-Project rollup payload.

    Pure builder: takes already-parsed inputs, returns the JSON-serializable
    payload that the Flask route would have produced. Caching, JQL execution,
    and response shaping happen here so that Plan 2's aggregate fan-out
    fallback can reuse the same path.

    project_id: string — Project id (custom UUID or Home id).
    tab: string — one of 'active', 'backlog', 'archived'.
    sprint: string or None — sprint id when tab='active'.
    request_headers: dict — passthrough headers for upstream Jira calls.

    Returns: dict — the same shape the route currently returns.
    """
    # --- BODY: copy from jira_server.py:6764-6854 with substitutions ---
    # Replace `request.args.get('tab', '').strip()` -> tab
    # Replace `request.args.get('sprint', '')`      -> sprint
    # Remove the final `return jsonify(payload), 200` and just return `payload`
    # Keep everything else byte-identical (cache key build, project lookup,
    # validate_epm_tab_sprint, fetch loops, shaping, hierarchy, cache write).
    ...
```

Replace the `...` placeholder with the actual lifted body. The current route should produce a function that returns the dict that today is passed to `jsonify(...)`.

- [ ] **Step 10.2: Move the Flask route onto the Blueprint, calling the builder**

In `epm_view.py` add:

```python
@epm_view_bp.route('/api/epm/projects/<project_id>/rollup', methods=['GET'])
def get_epm_project_rollup_endpoint(project_id):
    tab = request.args.get('tab', '').strip()
    sprint = request.args.get('sprint', '')
    payload = build_per_project_rollup(
        project_id=project_id,
        tab=tab,
        sprint=sprint,
        request_headers=dict(request.headers),
    )
    return jsonify(payload), 200
```

Remove the original route definition and its inline body from `jira_server.py:6762-6855`.

If `validate_epm_tab_sprint` returns a `(payload, status)` error tuple in the current code (check the existing route body), the builder must return a tuple `(payload_dict, status_code)` and the route must propagate it: `return jsonify(payload), status`. Read the current code at `jira_server.py:6762-6855` carefully and preserve exact response semantics — including 4xx error shapes and HTTP status codes.

- [ ] **Step 10.3: Run the new builder test, expecting it to pass now**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_builder -v
```

Expected: green.

- [ ] **Step 10.4: Run the full rollup suite**

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_epm_rollup_builder
```

Expected: green; same pass count as baseline (the builder test adds one new green case).

- [ ] **Step 10.5: Extend the builder test with one more case (empty-rollup short-circuit)**

Append to `tests/test_epm_rollup_builder.py`:

```python
    def test_empty_rollup_when_no_q1_hits(self):
        """Project with a label but no matching Q1 issues returns emptyRollup."""
        project = {
            'id': 'proj-b',
            'displayName': 'Project B',
            'matchState': 'matched',
            'label': 'rnd_project_demo',
        }
        with patch('epm_view.find_epm_project_or_404', return_value=project), \
             patch('epm_view.fetch_epm_rollup_query', return_value=[]):
            payload = build_per_project_rollup(
                project_id='proj-b',
                tab='backlog',
                sprint=None,
                request_headers={},
            )
        self.assertFalse(payload.get('metadataOnly', False))
        self.assertTrue(payload['emptyRollup'])
```

Run again:

```bash
.venv/bin/python -m unittest tests.test_epm_rollup_builder -v
```

Expected: both tests green.

- [ ] **Step 10.6: Commit**

```bash
git add epm_view.py jira_server.py tests/test_epm_rollup_builder.py
git commit -m "refactor(epm): extract per-Project rollup builder, move route to Blueprint"
```

---

### Task 11: Move `/api/epm/config` POST + verify backend extraction is complete

**Files:**

- Modify: `epm_view.py`
- Modify: `jira_server.py:6857-end-of-handler`

`POST /api/epm/config` → `save_epm_config_endpoint` (line 6857). This is the last EPM-only route still in `jira_server.py`.

- [ ] **Step 11.1: Move the POST handler onto the Blueprint**

Cut and paste exactly as in earlier route moves.

- [ ] **Step 11.2: Verify no EPM routes remain in `jira_server.py`**

```bash
grep -nE "^@app.route\('/api/epm" jira_server.py
```

Expected: no matches.

```bash
grep -nE "^def (get_epm_|preview_epm_|save_epm_)" jira_server.py
```

Expected: no matches (excluding `get_epm_burst_icon` which serves a static asset and is not part of `/api/epm/*`).

- [ ] **Step 11.3: Verify the Blueprint owns every EPM API route**

```bash
grep -nE "@epm_view_bp.route\('/api/epm" epm_view.py
```

Expected: 8 matches — `/api/epm/config` GET + POST, `/api/epm/scope`, `/api/epm/goals`, `/api/epm/projects`, `/api/epm/projects/preview`, `/api/epm/projects/<home_project_id>/issues`, `/api/epm/projects/<project_id>/rollup`.

- [ ] **Step 11.4: Run the full backend suite**

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: identical pass/fail counts to the Step 0b baseline, plus the two new builder tests from Task 10.

- [ ] **Step 11.5: Commit**

```bash
git add epm_view.py jira_server.py
git commit -m "refactor(epm): move EPM config POST to Blueprint; backend extraction complete"
```

---

## Stream C-prep: Frontend extraction into `frontend/src/epm/`

The frontend extraction can be done independently of Stream A. Tasks 12–18.

### Task 12: Create `frontend/src/epm/epmFetch.js`

**Files:**

- Create: `frontend/src/epm/epmFetch.js`

Centralize EPM fetch wrappers so Plan 2's aggregate fetch has an obvious home. Read the existing fetch sites in `dashboard.jsx` to identify every `/api/epm/*` URL, then encode each one as a thin async function.

- [ ] **Step 12.1: Write the module**

```javascript
// frontend/src/epm/epmFetch.js
//
// Thin async wrappers over /api/epm/* endpoints. Centralizing them keeps
// dashboard.jsx free of EPM-specific URL strings and gives Plan 2's
// aggregate endpoint an obvious home.

const json = async (response) => {
    if (!response.ok) {
        throw new Error(`EPM fetch error ${response.status}`);
    }
    return response.json();
};

export const fetchEpmConfig = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/config`, { cache: 'no-cache' }).then(json);

export const saveEpmConfig = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/epm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(json);

export const fetchEpmScope = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/scope`, { cache: 'no-cache' }).then(json);

export const fetchEpmGoals = (backendUrl, params = {}) => {
    const query = new URLSearchParams(params).toString();
    const url = query ? `${backendUrl}/api/epm/goals?${query}` : `${backendUrl}/api/epm/goals`;
    return fetch(url, { cache: 'no-cache' }).then(json);
};

export const fetchEpmProjects = (backendUrl) =>
    fetch(`${backendUrl}/api/epm/projects`, { cache: 'no-cache' }).then(json);

export const previewEpmProjects = (backendUrl, payload) =>
    fetch(`${backendUrl}/api/epm/projects/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(json);

export const fetchEpmProjectIssues = (backendUrl, homeProjectId) =>
    fetch(`${backendUrl}/api/epm/projects/${encodeURIComponent(homeProjectId)}/issues`, { cache: 'no-cache' }).then(json);

export const fetchEpmProjectRollup = (backendUrl, projectId, { tab, sprint } = {}) => {
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    if (sprint != null && sprint !== '') params.set('sprint', String(sprint));
    const url = `${backendUrl}/api/epm/projects/${encodeURIComponent(projectId)}/rollup?${params.toString()}`;
    return fetch(url, { cache: 'no-cache' }).then(json);
};
```

- [ ] **Step 12.2: Confirm the file builds**

```bash
npm run build
```

Expected: green (the file is not yet imported anywhere; esbuild won't include it but should still parse).

- [ ] **Step 12.3: Commit**

```bash
git add frontend/src/epm/epmFetch.js
git commit -m "refactor(epm): add epmFetch.js wrappers (not yet wired)"
```

---

### Task 13: Create `frontend/src/epm/useEpmRollup.js` skeleton

**Files:**

- Create: `frontend/src/epm/useEpmRollup.js`

Skeleton only — full state migration happens in Task 17 when `EpmView` mounts the hook. This task lands the file shape so callers in later tasks can import it.

- [ ] **Step 13.1: Write the skeleton hook**

```javascript
// frontend/src/epm/useEpmRollup.js
//
// Custom hook that owns EPM state, fetch, and effects for the EPM view.
// dashboard.jsx mounts <EpmView /> which calls this hook. After Plan 2,
// this hook also owns aggregate-mode state.

import { useState, useRef } from 'react';
import {
    fetchEpmProjects,
    fetchEpmProjectRollup,
} from './epmFetch.js';
import {
    buildRollupTree,
    filterEpmProjectsForTab,
    getEpmProjectIdentity,
} from './epmProjectUtils.mjs';

export function useEpmRollup({ backendUrl, selectedView, selectedSprint }) {
    const [epmTab, setEpmTab] = useState('active');
    const [epmProjects, setEpmProjects] = useState([]);
    const [epmProjectsLoading, setEpmProjectsLoading] = useState(false);
    const [epmProjectsError, setEpmProjectsError] = useState('');
    const [epmSelectedProjectId, setEpmSelectedProjectId] = useState('');
    const [epmRollupTree, setEpmRollupTree] = useState(null);
    const [epmRollupLoading, setEpmRollupLoading] = useState(false);

    const epmProjectsPendingSelectionRef = useRef(false);
    const epmProjectsRequestIdRef = useRef(0);
    const epmRollupRequestIdRef = useRef(0);

    // Stubs filled in by Task 17.
    const refreshEpmProjects = async () => { /* moved in Task 17 */ };
    const refreshEpmRollup = async () => { /* moved in Task 17 */ };
    const refreshEpmView = async () => { /* moved in Task 17 */ };

    return {
        // state
        epmTab, setEpmTab,
        epmProjects, setEpmProjects,
        epmProjectsLoading, setEpmProjectsLoading,
        epmProjectsError, setEpmProjectsError,
        epmSelectedProjectId, setEpmSelectedProjectId,
        epmRollupTree, setEpmRollupTree,
        epmRollupLoading, setEpmRollupLoading,
        // refs
        epmProjectsPendingSelectionRef,
        epmProjectsRequestIdRef,
        epmRollupRequestIdRef,
        // actions (filled in Task 17)
        refreshEpmProjects,
        refreshEpmRollup,
        refreshEpmView,
    };
}
```

- [ ] **Step 13.2: Build to confirm parse**

```bash
npm run build
```

Expected: green.

- [ ] **Step 13.3: Commit**

```bash
git add frontend/src/epm/useEpmRollup.js
git commit -m "refactor(epm): add useEpmRollup hook skeleton"
```

---

### Task 14: Create `frontend/src/epm/EpmRollupTree.jsx`

**Files:**

- Create: `frontend/src/epm/EpmRollupTree.jsx`
- Reference (do not edit yet): `frontend/src/dashboard.jsx` — find the existing `renderEpmInitiativeNode`, `renderEpmEpicNode`, `renderEpmRollupIssue` definitions.

- [ ] **Step 14.1: Locate the helpers in `dashboard.jsx`**

```bash
grep -n "renderEpmInitiativeNode\|renderEpmEpicNode\|renderEpmRollupIssue" frontend/src/dashboard.jsx
```

Read each helper carefully and identify which dashboard-scoped values they close over (event handlers, hover state, etc.).

- [ ] **Step 14.2: Write `EpmRollupTree.jsx` exporting the helpers as React components or pure render functions**

Convert each `renderEpmXxxNode` to a named export. Any closure-captured value becomes either a prop or a parameter:

```javascript
// frontend/src/epm/EpmRollupTree.jsx
//
// Render helpers for the EPM rollup tree. Lifted out of dashboard.jsx so
// the EPM view is self-contained.

import React from 'react';
import { getEpmProjectDisplayName } from './epmProjectUtils.mjs';

export function renderEpmInitiativeNode(initiativeNode, opts) {
    // Paste the existing body verbatim. Replace any reference to closure
    // values (e.g., onIssueClick, hoveredKey) with `opts.onIssueClick`,
    // `opts.hoveredKey`, etc. Add every captured value to the opts shape.
    // Do not change rendering output.
    ...
}

export function renderEpmEpicNode(epicNode, opts) {
    ...
}

export function renderEpmRollupIssue(issue, className, opts) {
    ...
}
```

Document the `opts` shape at the top of the file in a one-line comment per field.

- [ ] **Step 14.3: Do NOT remove the originals from `dashboard.jsx` yet**

Task 17 swaps `dashboard.jsx` to import from this module and removes the originals. Leaving both in place during Task 14 keeps the build green.

- [ ] **Step 14.4: Build**

```bash
npm run build
```

Expected: green.

- [ ] **Step 14.5: Commit**

```bash
git add frontend/src/epm/EpmRollupTree.jsx
git commit -m "refactor(epm): add EpmRollupTree.jsx render helpers (not yet wired)"
```

---

### Task 15: Create `frontend/src/epm/EpmControls.jsx`

**Files:**

- Create: `frontend/src/epm/EpmControls.jsx`
- Reference: `frontend/src/dashboard.jsx` — `renderEpmTabs` (around line 10662) and `renderEpmProjectPicker` (around line 10685).

- [ ] **Step 15.1: Locate the controls**

```bash
grep -n "renderEpmTabs\|renderEpmProjectPicker" frontend/src/dashboard.jsx
```

- [ ] **Step 15.2: Write the component**

```javascript
// frontend/src/epm/EpmControls.jsx
//
// EPM-only controls extracted from dashboard.jsx: lifecycle tab switch
// + Project picker. Receives state and setters via props.

import React from 'react';
import {
    filterEpmProjectsForTab,
    getEpmProjectDisplayName,
    getEpmProjectIdentity,
    getEpmSprintHelper,
    shouldUseEpmSprint,
} from './epmProjectUtils.mjs';

const EPM_TAB_OPTIONS = [
    { value: 'active', label: 'Active' },
    { value: 'backlog', label: 'Backlog' },
    { value: 'archived', label: 'Archived' },
];

export function EpmTabs({ epmTab, setEpmTab }) {
    return (
        <>
            <div className="mode-switch">
                {EPM_TAB_OPTIONS.map((tab) => (
                    <button
                        key={tab.value}
                        className={`mode-switch-button ${epmTab === tab.value ? 'active' : ''}`}
                        onClick={() => setEpmTab(tab.value)}
                        type="button"
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            {!shouldUseEpmSprint(epmTab) && (
                <div className="controls-label">{getEpmSprintHelper(epmTab)}</div>
            )}
        </>
    );
}

export function EpmProjectPicker({
    epmProjects,
    epmTab,
    epmSelectedProjectId,
    setEpmSelectedProjectId,
    epmProjectsLoading,
}) {
    const visibleEpmProjects = filterEpmProjectsForTab(epmProjects, epmTab);
    return (
        <div className="control-field" data-label="Project">
            <span className="control-label">Project</span>
            <select
                className="control-select"
                value={epmSelectedProjectId}
                onChange={(event) => setEpmSelectedProjectId(event.target.value)}
                disabled={epmProjectsLoading || visibleEpmProjects.length === 0}
            >
                <option value="">Select project...</option>
                {visibleEpmProjects
                    .filter((project) => getEpmProjectIdentity(project))
                    .map((project) => {
                        const projectId = getEpmProjectIdentity(project);
                        return (
                            <option key={projectId} value={projectId}>
                                {getEpmProjectDisplayName(project)}
                            </option>
                        );
                    })}
            </select>
        </div>
    );
}
```

The wording "Select project..." is preserved verbatim. Plan 2 changes it to "All projects".

- [ ] **Step 15.3: Build**

```bash
npm run build
```

Expected: green.

- [ ] **Step 15.4: Commit**

```bash
git add frontend/src/epm/EpmControls.jsx
git commit -m "refactor(epm): add EpmControls.jsx (not yet wired)"
```

---

### Task 16: Create `frontend/src/epm/EpmSettings.jsx`

**Files:**

- Create: `frontend/src/epm/EpmSettings.jsx`
- Reference: `frontend/src/dashboard.jsx` — the EPM section of the settings modal. Find it with:

```bash
grep -n "epmConfigDraft\|epmSettingsProjects\|epmRootGoals\|epmSubGoals\|epmLabel" frontend/src/dashboard.jsx | head -30
```

- [ ] **Step 16.1: Identify the settings region**

The EPM settings panel content is the JSX block inside the settings modal that renders the EPM section (root goal picker, sub-goal picker, label prefix, project list with linkage editing, preview button, save). Read it carefully and identify every state name, setter, and helper it uses.

- [ ] **Step 16.2: Extract the JSX into a component file**

Create a single export `EpmSettings` that receives every piece of state and setter as props. Do not yet remove the original block from `dashboard.jsx` — Task 17 swaps the call site.

```javascript
// frontend/src/epm/EpmSettings.jsx
//
// EPM settings panel content extracted from dashboard.jsx. The settings
// modal shell stays in dashboard.jsx; it imports this component for the
// EPM tab body.

import React from 'react';

export function EpmSettings(props) {
    // Paste the existing EPM JSX block here, with every reference to
    // state/setter/handler rewritten to read from `props`. Do not change
    // markup, class names, or behavior. Document the props shape in a
    // single docstring above this line.
    return (
        // ... the existing JSX block ...
    );
}
```

Be exhaustive about props — every state value, setter, helper, and computed ref the original block consumes must come through props. The extraction produces byte-equivalent UI.

- [ ] **Step 16.3: Build**

```bash
npm run build
```

Expected: green.

- [ ] **Step 16.4: Commit**

```bash
git add frontend/src/epm/EpmSettings.jsx
git commit -m "refactor(epm): add EpmSettings.jsx (not yet wired)"
```

---

### Task 17: Create `frontend/src/epm/EpmView.jsx` and migrate state, fetch, render

**Files:**

- Create: `frontend/src/epm/EpmView.jsx`
- Modify: `frontend/src/epm/useEpmRollup.js` (fill in `refreshEpmProjects`, `refreshEpmRollup`, `refreshEpmView`)
- Modify: `frontend/src/dashboard.jsx` (remove migrated code in Task 18)

This is the largest task. It wires the previously created skeleton modules together and prepares for the swap in Task 18.

- [ ] **Step 17.1: Move the `refreshEpm*` functions into `useEpmRollup.js`**

Open `frontend/src/dashboard.jsx` and find:

- `refreshEpmProjects` (around line 628)
- `refreshEpmRollup` (around line 981)
- `refreshEpmView` (around line 1029)

Cut their bodies and paste them into the corresponding stubs inside `useEpmRollup.js`. Replace any reference to closure-scoped state/setter with the hook-local equivalents already declared at the top of the hook. Replace any direct `fetch(...)` call with the corresponding `epmFetch.js` wrapper.

The `useEffect` at `frontend/src/dashboard.jsx:8762-8764` (rollup trigger) and the project-load `useEffect` near it move into the hook as well, using the hook's setters and refs. Add `useEffect` to the hook's React import.

- [ ] **Step 17.2: Write `EpmView.jsx` consuming the hook and rendering the EPM branch**

```javascript
// frontend/src/epm/EpmView.jsx
//
// Top-level EPM view. Mounted by dashboard.jsx when selectedView === 'epm'.
// Owns the EPM render branch (controls, project picker, focus-mode tree,
// metadata-only card, empty-rollup card, truncation banner).

import React from 'react';
import { useEpmRollup } from './useEpmRollup.js';
import { EpmTabs, EpmProjectPicker } from './EpmControls.jsx';
import { renderEpmInitiativeNode, renderEpmEpicNode, renderEpmRollupIssue } from './EpmRollupTree.jsx';
import { getEpmProjectDisplayName } from './epmProjectUtils.mjs';

export function EpmView({ backendUrl, selectedSprint, openEpmSettingsTab, treeOpts /* etc */ }) {
    const epm = useEpmRollup({ backendUrl, selectedView: 'epm', selectedSprint });
    // Move the existing EPM render branch from dashboard.jsx (around line
    // 14872) here. Replace every reference to dashboard-scoped EPM state
    // (epmTab, epmProjects, etc.) with `epm.epmTab`, `epm.epmProjects`, etc.
    // Replace `setEpmTab` with `epm.setEpmTab`, and so on.

    return (
        <>
            {/* Existing JSX block from dashboard.jsx:14872-14979 */}
        </>
    );
}
```

The `treeOpts` prop carries any closure-captured values that `renderEpmInitiativeNode` / `renderEpmEpicNode` / `renderEpmRollupIssue` need. Identify them from the originals in `dashboard.jsx` and pass them through.

- [ ] **Step 17.3: Build**

```bash
npm run build
```

Expected: green. The new files compile but nothing has been removed from `dashboard.jsx` yet, so behavior remains unchanged.

- [ ] **Step 17.4: Commit**

```bash
git add frontend/src/epm/EpmView.jsx frontend/src/epm/useEpmRollup.js
git commit -m "refactor(epm): wire EpmView and useEpmRollup; ready for swap"
```

---

### Task 18: Swap `dashboard.jsx` to mount `<EpmView />` and remove migrated code

**Files:**

- Modify: `frontend/src/dashboard.jsx`

This task removes the now-duplicated EPM code from `dashboard.jsx` and replaces it with `<EpmView />` + minimal wiring.

- [ ] **Step 18.1: Mount `<EpmView />` under `selectedView === 'epm'`**

Find the EPM render branch (around line 14872, opens with `{selectedView === 'epm' && (`). Replace its body with:

```javascript
<EpmView
    backendUrl={BACKEND_URL}
    selectedSprint={selectedSprint}
    openEpmSettingsTab={openEpmSettingsTab}
/>
```

`<EpmView />` is responsible for fetching its own EPM data via `useEpmRollup`. The only props it takes from `dashboard.jsx` are values that the dashboard shell already owns: the backend base URL, the current sprint id, and the callback that opens the EPM tab inside the settings modal. If you find yourself wanting to pass more EPM state down as props, stop — that state belongs inside `useEpmRollup`, not in `dashboard.jsx`.

- [ ] **Step 18.2: Remove the migrated EPM state declarations**

Remove the EPM `useState` calls at `dashboard.jsx:200-229` and the EPM `useRef` calls at `dashboard.jsx:554-559`. They now live inside `useEpmRollup`.

Remove `visibleEpmProjects` and `selectedEpmProject` memos at `dashboard.jsx:578-579` — they now live inside `EpmView` / `EpmControls`.

- [ ] **Step 18.3: Remove the migrated `refreshEpm*` functions and their `useEffect` triggers**

Remove `refreshEpmProjects`, `refreshEpmRollup`, `refreshEpmView`, and the EPM-specific `useEffect`s. They now live in `useEpmRollup`.

- [ ] **Step 18.4: Remove the migrated render helpers**

Remove `renderEpmInitiativeNode`, `renderEpmEpicNode`, `renderEpmRollupIssue` from `dashboard.jsx`. They are imported in `EpmView` from `EpmRollupTree.jsx`.

Remove `renderEpmTabs` and `renderEpmProjectPicker` from `dashboard.jsx`. The header still needs the tabs and picker, so import them from `EpmControls.jsx` and render `<EpmTabs ... />` / `<EpmProjectPicker ... />` inline where the old render functions were called. Pass the EPM state through; if the header is outside `<EpmView />`, lift the hook to a parent or expose it via a context — implement the simplest of the two that keeps the header working without re-fetching state.

If lifting the hook into a parent is invasive, an alternative is to keep `useEpmRollup` instantiated once at the dashboard level and pass its return value into both the header (for tabs/picker) and `<EpmView />`. Pick the option with the smaller diff.

- [ ] **Step 18.5: Move the EPM settings panel to import `EpmSettings`**

Find the EPM section inside the settings modal (originally extracted in Task 16). Replace the JSX block with `<EpmSettings ...props />`, passing every state, setter, and helper the original block used.

- [ ] **Step 18.6: Build**

```bash
npm run build
```

Expected: green. If esbuild reports unused imports in `dashboard.jsx`, remove them. If it reports a missing export, you removed something that's still referenced — restore it or migrate the reference too.

- [ ] **Step 18.7: Run pure-fn and source-guard tests**

```bash
node --test tests/test_epm_project_utils.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: green.

If any source guard fails because it grepped `dashboard.jsx` for an EPM-specific string that now lives under `frontend/src/epm/`, update the guard to grep the new file. Do **not** widen the guard's scope — point it at the new location.

- [ ] **Step 18.8: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
git commit -m "refactor(epm): mount <EpmView /> in dashboard; remove migrated EPM code"
```

---

### Task 19: Verify post-extraction quietness in `dashboard.jsx`

This task is a verification gate — no new code, only checks. If a check fails, return to Task 18 to finish removing the leftover.

- [ ] **Step 19.1: Confirm `dashboard.jsx` no longer defines EPM state**

```bash
grep -nE "useState\(.*[Ee]pm|setEpm" frontend/src/dashboard.jsx
```

Expected: no matches except possibly the `selectedView` switch and prop-passing into `<EpmView />`.

- [ ] **Step 19.2: Confirm no EPM render helpers remain in `dashboard.jsx`**

```bash
grep -nE "renderEpmInitiativeNode|renderEpmEpicNode|renderEpmRollupIssue|renderEpmTabs|renderEpmProjectPicker" frontend/src/dashboard.jsx
```

Expected: no matches.

- [ ] **Step 19.3: Confirm no EPM `/api/epm/*` fetches remain in `dashboard.jsx`**

```bash
grep -nE "/api/epm/" frontend/src/dashboard.jsx
```

Expected: no matches.

- [ ] **Step 19.4: Confirm `<EpmView />` is the EPM mount point**

```bash
grep -n "EpmView" frontend/src/dashboard.jsx
```

Expected: one or two matches (one import, one mount). Anything more means you have stray references.

- [ ] **Step 19.5: Run full backend + frontend test suites**

```bash
.venv/bin/python -m unittest discover -s tests
node --test tests/test_epm_project_utils.js tests/test_epm_settings_source_guards.js tests/test_epm_shell_source_guards.js tests/test_epm_view_source_guards.js
```

Expected: identical pass/fail counts to baseline plus the new builder tests from Task 10.

- [ ] **Step 19.6: Commit (allow empty if no fixes needed)**

```bash
git commit --allow-empty -m "chore(epm): verification gate after extraction"
```

---

### Task 20: Manual focus-mode walkthrough + ENG sanity sweep

This task is exclusively manual verification. Behavior must be byte-equivalent to pre-refactor.

- [ ] **Step 20.1: Build and start the server**

```bash
npm run build
.venv/bin/python jira_server.py
```

In a separate terminal, hit the test endpoint to confirm the server is up:

```bash
curl http://localhost:5050/api/test
```

Expected: a 200 response with the expected JSON shape.

- [ ] **Step 20.2: Open the dashboard in a browser**

Open `http://localhost:5050/` (or the URL the server logs).

- [ ] **Step 20.3: Verify ENG view (no EPM extraction should affect ENG)**

Switch to the ENG view. Walk through Catch Up, Planning, and Scenario modes. Confirm:

- All three modes load issues without errors.
- Sticky header behavior (`planning-panel.open` above `.epic-header`) is unchanged. Re-read AGENTS.md "Repo-specific constraints" if you are unsure of the expected behavior.
- No new console warnings or errors.

- [ ] **Step 20.4: Verify EPM focus mode on each tab**

Switch to the EPM view. For each lifecycle tab (Active, Backlog, Archived):

- The tab switch button highlights correctly.
- The Project picker populates with the same Projects as before the refactor.
- Selecting a Project loads its rollup tree.
- The metadata-only card renders for Projects with no configured label, with the "Open Settings" CTA wired.
- The empty-rollup card renders for Projects whose label has no matching issues.
- The truncation banner renders if the response is truncated (skip if not encountered).
- On Active without a sprint selected, the "Select a sprint" empty state renders.

- [ ] **Step 20.5: Verify the EPM settings panel**

Open the settings modal, switch to the EPM tab. Confirm:

- Root-goal and sub-goal pickers behave identically to pre-refactor.
- Label prefix field is still editable.
- The Project list still renders with the saved linkage.
- The Preview button still renders the preview list.
- Save still persists and the panel reflects the saved state.

- [ ] **Step 20.6: Document the walkthrough**

If everything passes, append a one-line note to the commit log:

```bash
git commit --allow-empty -m "verify(epm): manual focus-mode + ENG walkthrough green"
```

If anything fails, do **not** commit. Return to the relevant earlier task (most likely Task 17 or 18) and fix the regression. The Plan 1 acceptance criterion is byte-equivalent UI; a mismatch is a blocker.

---

## Acceptance criteria (Plan 1)

- `epm_view.py` exists and owns every `/api/epm/*` route plus every EPM-only helper and module constant. `jira_server.py` no longer defines them.
- `frontend/src/dashboard.jsx` mounts `<EpmView />` under `selectedView === 'epm'` and contains no EPM state, no EPM fetch URLs, no EPM render helpers.
- `frontend/src/epm/` contains: existing `epmProjectUtils.mjs`, plus new `epmFetch.js`, `useEpmRollup.js`, `EpmControls.jsx`, `EpmRollupTree.jsx`, `EpmSettings.jsx`, `EpmView.jsx`.
- `tests/test_epm_rollup_builder.py` exists with at least two green direct unit tests of `build_per_project_rollup`.
- Every existing test that was green before Plan 1 is green after Plan 1, with no test changes other than source-guard path updates pointed at the new module locations.
- Manual focus-mode walkthrough across Active, Backlog, Archived passes; settings panel passes; ENG view passes.
- The full pre-existing test suite is green except the documented `test_jira_resilience.test_api_test_endpoint_fast_fails_when_circuit_is_open` failure that exists on `main`.

When the acceptance criteria are met, Plan 1 is ready to merge. Plan 2 (the portfolio rework) is drafted from the same spec after Plan 1 ships.
