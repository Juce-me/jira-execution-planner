# EPM Zero-Manual Portfolio Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EPM infer Project names and Jira labels from Atlassian Home, default to all visible Projects, and expose the Active sprint selector where it scopes EPM rollups.

**Architecture:** Keep Home project discovery in `epm_home.py`, but enrich each Home Project with raw tag names. Shape final label state in `jira_server.py` because `epm.labelPrefix` and manual overrides live in EPM config. Add a server aggregate rollup endpoint that fans out through the existing per-Project rollup builder, then update the current dashboard EPM state/render path to treat empty project selection as all-Projects mode.

**Tech Stack:** Python + Flask + unittest backend; React 19 + esbuild frontend; Node source guards and pure helper tests.

---

### Task 1: Atlassian Home Tag Auto-Fill

**Files:**
- Modify: `epm_home.py`
- Modify: `jira_server.py`
- Test: `tests/test_epm_home_api.py`
- Test: `tests/test_epm_projects_api.py`

- [x] **Step 1: Write failing backend tests**

Add tests proving Home tag extraction normalizes direct and Teamwork Graph tag shapes, Project payloads auto-fill exactly one prefix-matching tag, manual labels override Home tags, multiple matches are ambiguous, and cached Home records are reshaped when `labelPrefix` changes.

- [x] **Step 2: Run focused tests and confirm they fail**

Run: `.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api`

Expected: FAIL because tag extraction and label status fields do not exist yet.

- [x] **Step 3: Implement tag fetch and label resolution**

Add focused helpers in `epm_home.py` for raw tag normalization and best-effort tag fetching. Add focused helpers in `jira_server.py` for resolving `label`, `labelSource`, `homeTags`, `homeTagMatches`, and `labelStatus` from Home tags plus saved config.

- [x] **Step 4: Run focused tests and confirm they pass**

Run: `.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api`

Expected: PASS.

### Task 2: All-Projects Rollup Endpoint

**Files:**
- Modify: `jira_server.py`
- Test: `tests/test_epm_rollup_api.py`

- [x] **Step 1: Write failing aggregate endpoint tests**

Add tests for `GET /api/epm/projects/rollup/all`: Active requires sprint, visible Projects are filtered by tab, metadata-only Projects remain visible, labeled Projects receive rollups, and duplicate issue keys across Projects are reported.

- [x] **Step 2: Run focused tests and confirm they fail**

Run: `.venv/bin/python -m unittest tests.test_epm_rollup_api`

Expected: FAIL because `/api/epm/projects/rollup/all` is not registered.

- [x] **Step 3: Implement aggregate fan-out**

Add a backend helper that reuses `build_epm_projects_payload`, filters Projects by `tabBucket`, calls the existing per-Project rollup builder for labeled Projects, creates metadata-only rollups for unlabeled Projects, and computes duplicate issue memberships by walking each rollup tree.

- [x] **Step 4: Run focused tests and confirm they pass**

Run: `.venv/bin/python -m unittest tests.test_epm_rollup_api`

Expected: PASS.

### Task 3: EPM All-Projects Frontend Default and Sprint Control

**Files:**
- Modify: `frontend/src/epm/epmFetch.js`
- Modify: `frontend/src/epm/epmProjectUtils.mjs`
- Modify: `frontend/src/epm/EpmRollupPanel.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Test: `tests/test_epm_project_utils.js`
- Test: `tests/test_epm_view_source_guards.js`
- Test: `tests/test_epm_settings_source_guards.js`

- [x] **Step 1: Write failing frontend/source tests**

Add guards that require `All projects` as the default picker option, aggregate fetch usage when `epmSelectedProjectId === ''`, sprint controls in EPM Active main and compact headers, and no metadata-only render for labeled Projects.

- [x] **Step 2: Run focused tests and confirm they fail**

Run: `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js`

Expected: FAIL because the aggregate wrapper/state/render path and EPM sprint controls are missing.

- [x] **Step 3: Implement frontend state and render path**

Add `fetchEpmAllProjectsRollup`, normalize aggregate responses into board trees, keep focus mode for specific Project selections, render `All projects` by default, and render `renderSprintControl('main')` / `renderSprintControl('compact')` for EPM Active.

- [x] **Step 4: Run focused tests and confirm they pass**

Run: `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js`

Expected: PASS.

### Task 4: Build and Full Verification

**Files:**
- Modify only files touched by Tasks 1-3 if verification exposes defects.

- [x] **Step 1: Run backend focused suite**

Run: `.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api`

Expected: PASS.

- [x] **Step 2: Run frontend focused suite**

Run: `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_settings_source_guards.js`

Expected: PASS.

- [x] **Step 3: Build frontend**

Run: `npm run build`

Expected: PASS.

- [x] **Step 4: Run full Python suite**

Run: `.venv/bin/python -m unittest discover -s tests`

Expected: PASS.
