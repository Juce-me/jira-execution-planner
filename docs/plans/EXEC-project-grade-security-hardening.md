# Project Grade Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the app into a project-grade local/web app whose HTTP surface is default-deny, documented, test-covered, and closed to unauthenticated network users.

**Architecture:** Add a central endpoint policy registry that classifies every Flask route, then enforce that policy through one shared before-request guard instead of route-by-route ad hoc checks. Move remaining root API routes into blueprints as the policy lands, close dev/diagnostic endpoints unless explicitly enabled for local development, and update packaging/CI so startup, migrations, builds, and security route checks are repeatable.

**Tech Stack:** Flask, SQLAlchemy/Alembic, existing Atlassian OAuth and DB auth context, token-bound CSRF, React 19/esbuild, Python `unittest`, Node tests, Playwright, GitHub Actions.

---

## Current Findings

- The live Flask URL map has 68 non-static routes, including public pages, auth callbacks, admin routes, EPM/ENG/settings blueprints, and legacy root routes for scenario, stats, capacity, export, debug, and static files.
- `jira_server.py` still owns `OAUTH_READY_API_PATHS`, unsafe OAuth header checks, shared-config admin checks, and several root API routes.
- OAuth mode blocks routes not listed by `is_oauth_ready_api_path()`, but that allowlist is not tied to the real Flask URL map. A new route can be added without a test forcing a security classification.
- The local dev runner calls `app.run(host='0.0.0.0', ...)`, which exposes the app on the network by default even when running in Basic/local mode.
- The project already has useful foundations: DB auth context, token-bound CSRF, admin route tests, route source guards, local-token-store startup guards, CORS allowlist validation, and Home write gate docs.

## Security Model

All routes must fall into exactly one policy class:

| Class | Meaning | Examples | Required guard |
| --- | --- | --- | --- |
| `public_page` | Browser entry or static asset with no app data. | `/`, `/jira-dashboard.html`, `/frontend/dist/*`, `/favicon.ico`, `/epm-burst.svg` | No auth, security headers, no secrets. |
| `auth_flow` | Login, OAuth callback, auth status, CSRF token, logout, reconnect pages. | `/login`, `/api/auth/*`, `/auth/*` | Existing auth-flow rules; unsafe methods require CSRF where applicable. |
| `authenticated_read` | Read app data using Basic mode locally or OAuth DB context. | ENG reads, EPM reads, Jira catalogs, stats reads. | Basic mode only on loopback/local profile; OAuth mode requires current auth context when route touches Jira/Home/user data. |
| `user_write` | Mutates current user's private state. | `/api/me/views`, `/api/me/connections/home-token` | Authenticated user plus token-bound CSRF. |
| `shared_admin_write` | Mutates shared workspace/app configuration. | `/api/projects/selected`, `/api/board-config`, field mappings, EPM config. | Tool admin plus token-bound CSRF in OAuth/DB mode; Basic mode local-only. |
| `tool_admin` | Operator/admin inspection or user/service credential administration. | `/api/admin/*` | DB auth, active tool admin, token-bound CSRF for unsafe methods. |
| `dev_local` | Diagnostic/probe endpoint that must not be reachable in project-grade/network mode. | `/api/debug-fields`, `/api/tasks-fields`, `/api/auth/dev/home-graphql-oauth-probe` | `APP_ENVIRONMENT_KEY in {local, dev}` plus explicit allow flag plus loopback request. |
| `legacy_basic_local` | Existing compatibility route allowed only for local Basic mode during migration. | `/api/scenario/overrides` POST until DB drafts replace it. | Basic mode, loopback request, no OAuth DB write bypass. |

Default rule: if a route has no policy, return `404 route_not_found` or `501 route_not_oauth_ready` before route code runs. Do not add public API routes by default.

## Target File Map

- Create `backend/security/__init__.py`: package marker and narrow exports.
- Create `backend/security/policy.py`: endpoint policy dataclasses, matchers, and route classification source of truth.
- Create `backend/security/guards.py`: before-request guard registration and shared responses.
- Create `backend/security/headers.py`: response headers and startup network-bind validation.
- Modify `backend/app.py`: register security guards and headers before blueprints.
- Modify `jira_server.py`: keep compatibility wrappers, remove duplicated route guard lists, default bind host to `127.0.0.1`, and reject network bind unless explicitly allowed.
- Modify `backend/routes/auth_routes.py`: require local/dev allow flag and loopback for `/api/auth/dev/home-graphql-oauth-probe`.
- Modify `backend/routes/settings_routes.py`, `backend/routes/epm_routes.py`, `backend/routes/eng_routes.py`: remove duplicate guard helpers only after shared guard coverage exists.
- Create `backend/routes/scenario_routes.py`, `backend/routes/stats_routes.py`, `backend/routes/capacity_routes.py`, `backend/routes/export_routes.py`, `backend/routes/dev_routes.py`: move remaining root API routes out of `jira_server.py` without behavior changes.
- Create `tests/test_endpoint_policy_inventory.py`: every Flask route has exactly one policy.
- Create `tests/test_endpoint_security_matrix.py`: sampled unauth/auth/non-admin/admin behavior for each policy class.
- Create `tests/test_network_bind_guards.py`: loopback default and unsafe network bind rejection.
- Create `tests/test_security_headers.py`: response header and CORS safety checks.
- Create `tests/test_project_packaging.py`: package metadata, console entrypoint, and install script consistency.
- Modify `tests/test_oauth_route_guards.py`, `tests/test_backend_route_source_guards.py`, `tests/test_pre_db_admin_gates.py`: align existing guard tests with the central policy registry.
- Modify `.env.example`, `INSTALL.md`, `README.md`, `AGENTS.md`: document security profile, bind host, endpoint policy, and packaging commands.
- Create `docs/security/endpoints.md`: generated or manually maintained endpoint policy table.
- Create `pyproject.toml`: Python project metadata and optional console script.
- Create `Makefile`: repeatable bootstrap, build, test, security-test, and server commands.
- Modify `.github/workflows/verify-frontend-build.yml`: add backend install, unit tests, endpoint security tests, and startup smoke.
- Modify `.github/workflows/release-latest.yml`: package only runtime files and docs needed by users; exclude tests/plans/local artifacts unless explicitly wanted.
- Modify `install.sh`: install from `requirements.txt`, stop using a stale dependency subset, and avoid installing into global user site by default.

## Non-Goals

- No Home/Townsquare write route, Home mutation UI, or Home write probe pass.
- No real Jira write-back or Scenario publish route.
- No broad UI redesign.
- No migration away from Flask, React, esbuild, `unittest`, or current DB models.
- No public anonymous API except static/browser entry/auth-flow routes named in the endpoint policy.

## Task 0: Preflight And Gate Sweep

**Files:**
- Modify: `docs/plans/GATE-05-home-write-capability.md`

- [ ] **Step 1: Confirm branch and clean baseline**

Run:

```bash
git status --short --branch
```

Expected: branch is not `main`; any unrelated local changes are documented before edits.

- [ ] **Step 2: List and open gated docs**

Run:

```bash
rg --files docs/plans | rg '/GATE-'
sed -n '1,220p' docs/plans/GATE-05-home-write-capability.md
```

Expected: `docs/plans/GATE-05-home-write-capability.md` is the only gate.

- [ ] **Step 3: Check Home write probe inputs without printing values**

Run:

```bash
for name in HOME_WRITE_PROBE_EMAIL HOME_WRITE_PROBE_API_TOKEN HOME_WRITE_PROBE_PROJECT_ID HOME_WRITE_PROBE_TEXT; do
  if printenv "$name" >/dev/null; then
    printf '%s=present\n' "$name"
  else
    printf '%s=missing\n' "$name"
  fi
done
```

Expected: if any value is missing, do not run the Home write probe. Update the gate checked date and keep `Last result` as `FAIL insufficient_home_write_probe_input`.

- [ ] **Step 4: Record the current route map**

Run:

```bash
.venv/bin/python -c $'import jira_server\nfor rule in sorted(jira_server.app.url_map.iter_rules(), key=lambda r: r.rule):\n    methods=",".join(sorted(m for m in rule.methods if m not in {"HEAD","OPTIONS"}))\n    print(f"{methods:20} {rule.rule:55} {rule.endpoint}")'
```

Expected: route map output is reviewed before changing policy.

- [ ] **Step 5: Commit preflight gate update if it changed**

Run:

```bash
git add docs/plans/GATE-05-home-write-capability.md
git commit -m "docs: refresh hardening gate sweep"
```

Expected: commit only if the gate doc changed.

## Task 1: Endpoint Policy Inventory Test

**Files:**
- Create: `tests/test_endpoint_policy_inventory.py`
- Create: `tests/endpoint_security_samples.py`
- Test: `tests/test_endpoint_policy_inventory.py`

- [ ] **Step 1: Write the failing inventory test**

Create `tests/test_endpoint_policy_inventory.py`:

```python
import unittest

import jira_server


IGNORED_ENDPOINTS = {"static"}
IGNORED_METHODS = {"HEAD", "OPTIONS"}


class EndpointPolicyInventoryTests(unittest.TestCase):
    def test_every_non_static_route_has_security_policy(self):
        from backend.security.policy import classify_rule

        missing = []
        for rule in jira_server.app.url_map.iter_rules():
            if rule.endpoint in IGNORED_ENDPOINTS:
                continue
            methods = sorted(method for method in rule.methods if method not in IGNORED_METHODS)
            if not classify_rule(rule.rule, methods, rule.endpoint):
                missing.append({"rule": rule.rule, "methods": methods, "endpoint": rule.endpoint})

        self.assertEqual(missing, [])

    def test_policy_names_are_unique(self):
        from backend.security.policy import ENDPOINT_POLICIES

        names = [policy.name for policy in ENDPOINT_POLICIES]
        self.assertEqual(sorted(names), sorted(set(names)))

    def test_dynamic_routes_have_security_samples(self):
        from backend.security.policy import routes_requiring_samples
        from tests.endpoint_security_samples import ROUTE_SAMPLES

        missing = sorted(route for route in routes_requiring_samples() if route not in ROUTE_SAMPLES)
        self.assertEqual(missing, [])
```

Create `tests/endpoint_security_samples.py`:

```python
ROUTE_SAMPLES = {
    "/api/admin/service-integrations/<service_integration_id>": "/api/admin/service-integrations/svc-1",
    "/api/admin/users/<user_id>": "/api/admin/users/user-1",
    "/api/admin/users/<user_id>/admin-grant": "/api/admin/users/user-1/admin-grant",
    "/api/admin/users/<user_id>/status": "/api/admin/users/user-1/status",
    "/api/epm/projects/<home_project_id>/issues": "/api/epm/projects/home-project-1/issues",
    "/api/epm/projects/<project_id>/rollup": "/api/epm/projects/home-project-1/rollup",
    "/api/me/views/<view_id>": "/api/me/views/view-1",
    "/frontend/dist/<path:filename>": "/frontend/dist/dashboard.js",
    "/static/<path:filename>": "/static/missing.txt",
}
```

- [ ] **Step 2: Run the test and verify it fails because the policy module does not exist**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.security'`.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add tests/test_endpoint_policy_inventory.py tests/endpoint_security_samples.py
git commit -m "test: require endpoint security policy inventory"
```

Expected: commit contains tests only.

## Task 2: Endpoint Policy Registry

**Files:**
- Create: `backend/security/__init__.py`
- Create: `backend/security/policy.py`
- Test: `tests/test_endpoint_policy_inventory.py`

- [ ] **Step 1: Add the security package marker**

Create `backend/security/__init__.py`:

```python
"""Security policy and request guard helpers."""
```

- [ ] **Step 2: Add the endpoint policy registry**

Create `backend/security/policy.py` with the concrete policy entries for current routes. The registry may use exact, prefix, or Flask dynamic-pattern matches, but it must classify every route in the current URL map and no route may match two policies.

Use these policy classes exactly: `public_page`, `auth_flow`, `authenticated_read`, `user_write`, `shared_admin_write`, `tool_admin`, `dev_local`, `legacy_basic_local`.

Required initial entries:

```python
from dataclasses import dataclass


UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
PUBLIC_METHODS = frozenset({"GET"})


@dataclass(frozen=True)
class EndpointPolicy:
    name: str
    path: str
    methods: frozenset[str]
    policy_class: str
    match: str = "exact"
    exclude_paths: tuple[str, ...] = ()

    def matches(self, rule: str, methods: list[str] | tuple[str, ...], endpoint: str = "") -> bool:
        if any(rule == excluded or rule.startswith(excluded) for excluded in self.exclude_paths):
            return False
        if self.match == "exact" and rule != self.path:
            return False
        if self.match == "prefix" and not rule.startswith(self.path):
            return False
        if self.match == "dynamic" and rule != self.path:
            return False
        return bool(set(methods).intersection(self.methods))


ENDPOINT_POLICIES = (
    EndpointPolicy("dashboard-root", "/", PUBLIC_METHODS, "public_page"),
    EndpointPolicy("dashboard-html", "/jira-dashboard.html", PUBLIC_METHODS, "public_page"),
    EndpointPolicy("frontend-dist", "/frontend/dist/<path:filename>", PUBLIC_METHODS, "public_page", "dynamic"),
    EndpointPolicy("favicon", "/favicon.ico", PUBLIC_METHODS, "public_page"),
    EndpointPolicy("epm-burst", "/epm-burst.svg", PUBLIC_METHODS, "public_page"),
    EndpointPolicy("health", "/health", PUBLIC_METHODS, "public_page"),
    EndpointPolicy("auth-pages", "/auth/", PUBLIC_METHODS, "auth_flow", "prefix"),
    EndpointPolicy("login", "/login", PUBLIC_METHODS, "auth_flow"),
    EndpointPolicy("auth-dev-home-probe", "/api/auth/dev/home-graphql-oauth-probe", PUBLIC_METHODS, "dev_local"),
    EndpointPolicy("auth-api", "/api/auth/", frozenset({"GET", "POST"}), "auth_flow", "prefix", ("/api/auth/dev/",)),
    EndpointPolicy("admin-api", "/api/admin/", frozenset({"GET", "POST", "PATCH", "DELETE"}), "tool_admin", "prefix"),
    EndpointPolicy("user-views-api", "/api/me/views", frozenset({"GET", "POST", "PATCH"}), "user_write", "prefix"),
    EndpointPolicy("user-connections-api", "/api/me/connections/", frozenset({"GET", "POST", "DELETE"}), "user_write", "prefix"),
    EndpointPolicy("eng-api", "/api/tasks", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("eng-api-team-name", "/api/tasks-with-team-name", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("eng-api-teams", "/api/teams", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("eng-api-teams-prefix", "/api/teams/", PUBLIC_METHODS, "authenticated_read", "prefix"),
    EndpointPolicy("eng-api-backlog", "/api/backlog-epics", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("eng-api-missing-info", "/api/missing-info", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("eng-api-dependencies", "/api/dependencies", frozenset({"POST"}), "authenticated_read"),
    EndpointPolicy("eng-api-issue-lookup", "/api/issues/lookup", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("settings-config-read", "/api/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("settings-shared-config-write", "/api/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("settings-version", "/api/version", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("settings-groups-read", "/api/groups-config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("settings-groups-write", "/api/groups-config", frozenset({"POST"}), "user_write"),
    EndpointPolicy("settings-catalog-read", "/api/team-catalog", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("settings-catalog-write", "/api/team-catalog", frozenset({"POST"}), "user_write"),
    EndpointPolicy("jira-catalogs", "/api/projects", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-components", "/api/components", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-epics-search", "/api/epics/search", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-labels", "/api/jira/labels", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-fields", "/api/fields", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-boards", "/api/boards", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-sprints", "/api/sprints", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("jira-issue-types", "/api/issue-types", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("shared-selected-projects", "/api/projects/selected", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-board-config", "/api/board-config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-capacity-config", "/api/capacity/config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-field-config", "/api/sprint-field/config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-story-points-config", "/api/story-points-field/config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-parent-name-config", "/api/parent-name-field/config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-team-field-config", "/api/team-field/config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-priority-weights", "/api/stats/priority-weights-config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("shared-issue-types-config", "/api/issue-types/config", frozenset({"GET", "POST"}), "shared_admin_write"),
    EndpointPolicy("epm-config-read", "/api/epm/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("epm-config-write", "/api/epm/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("epm-scope", "/api/epm/scope", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("epm-goals", "/api/epm/goals", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("epm-projects", "/api/epm/projects", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("epm-project-issues", "/api/epm/projects/<home_project_id>/issues", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("epm-project-rollup", "/api/epm/projects/<project_id>/rollup", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("epm-projects-configuration", "/api/epm/projects/configuration", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("epm-projects-preview", "/api/epm/projects/preview", frozenset({"POST"}), "authenticated_read"),
    EndpointPolicy("epm-projects-rollup-all", "/api/epm/projects/rollup/all", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("scenario-main", "/api/scenario", frozenset({"GET", "POST"}), "authenticated_read"),
    EndpointPolicy("scenario-overrides-read", "/api/scenario/overrides", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("scenario-overrides-legacy-write", "/api/scenario/overrides", frozenset({"POST"}), "legacy_basic_local"),
    EndpointPolicy("stats-read", "/api/stats", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("stats-burnout", "/api/stats/burnout", frozenset({"GET", "POST"}), "authenticated_read"),
    EndpointPolicy("stats-epic-cohort", "/api/stats/epic-cohort", frozenset({"POST"}), "authenticated_read"),
    EndpointPolicy("stats-excluded-source", "/api/stats/excluded-capacity-source", frozenset({"POST"}), "authenticated_read"),
    EndpointPolicy("capacity-read", "/api/capacity", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("planned-capacity-read", "/api/planned-capacity", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("test-connection", "/api/test", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("export-excel", "/api/export-excel", frozenset({"POST"}), "user_write"),
    EndpointPolicy("debug-fields", "/api/debug-fields", PUBLIC_METHODS, "dev_local"),
    EndpointPolicy("tasks-fields", "/api/tasks-fields", PUBLIC_METHODS, "dev_local"),
)


def matching_policies(rule: str, methods: list[str] | tuple[str, ...], endpoint: str = ""):
    return [policy for policy in ENDPOINT_POLICIES if policy.matches(rule, methods, endpoint)]


def classify_rule(rule: str, methods: list[str] | tuple[str, ...], endpoint: str = ""):
    policies = matching_policies(rule, methods, endpoint)
    return policies[0] if len(policies) == 1 else None


def routes_requiring_samples():
    return sorted(policy.path for policy in ENDPOINT_POLICIES if "<" in policy.path)
```

- [ ] **Step 3: Run the inventory test**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory
```

Expected: PASS. If it fails because a route is unclassified or matches twice, fix `ENDPOINT_POLICIES` before continuing.

- [ ] **Step 4: Commit the registry**

Run:

```bash
git add backend/security/__init__.py backend/security/policy.py tests/test_endpoint_policy_inventory.py tests/endpoint_security_samples.py
git commit -m "security: add endpoint policy inventory"
```

## Task 3: Central Request Guards

**Files:**
- Create: `backend/security/guards.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Test: `tests/test_endpoint_security_matrix.py`
- Test: `tests/test_oauth_route_guards.py`

- [ ] **Step 1: Write matrix tests for unauthenticated and unsafe requests**

Create `tests/test_endpoint_security_matrix.py` with tests that:

- run OAuth mode with no browser session;
- assert `authenticated_read`, `user_write`, `shared_admin_write`, and `tool_admin` samples do not return data to an anonymous user;
- assert unsafe requests require `X-Requested-With: jira-execution-planner` and token-bound `X-CSRF-Token` before route code runs;
- assert `public_page` samples stay readable.

Minimum required sample list:

```python
SECURITY_SAMPLES = {
    "public_page": [("GET", "/health"), ("GET", "/jira-dashboard.html")],
    "authenticated_read": [("GET", "/api/tasks"), ("GET", "/api/epm/projects"), ("GET", "/api/stats")],
    "user_write": [("POST", "/api/me/views"), ("POST", "/api/export-excel")],
    "shared_admin_write": [("POST", "/api/board-config"), ("POST", "/api/epm/config")],
    "tool_admin": [("GET", "/api/admin/users"), ("POST", "/api/admin/users/user-1/status")],
    "dev_local": [("GET", "/api/debug-fields"), ("GET", "/api/tasks-fields")],
}
```

- [ ] **Step 2: Run matrix tests and verify they fail on missing shared guard behavior**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_security_matrix
```

Expected: FAIL until `backend/security/guards.py` is registered.

- [ ] **Step 3: Implement shared guard registration**

Create `backend/security/guards.py` with a `register_security_guards(flask_app)` function. It must:

- classify the incoming request using `backend.security.policy`;
- reject unclassified `/api/*` routes before route code;
- keep `public_page` readable;
- keep auth-flow routes under existing auth behavior;
- require current auth context for OAuth authenticated app data;
- reject unsafe OAuth requests missing `X-Requested-With`;
- require token-bound CSRF for `user_write`, `shared_admin_write`, and `tool_admin`;
- require admin for `shared_admin_write` and `tool_admin`;
- reject `dev_local` unless `APP_ENVIRONMENT_KEY` is `local` or `dev`, `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true`, and `request.remote_addr` is loopback;
- reject `legacy_basic_local` in OAuth/DB mode.

- [ ] **Step 4: Register guards before blueprints**

Modify `backend/app.py` so `create_app()` calls:

```python
from backend.security.guards import register_security_guards
from backend.security.headers import register_security_headers

register_security_guards(flask_app)
register_security_headers(flask_app)
register_blueprints(flask_app)
```

- [ ] **Step 5: Keep compatibility wrappers temporarily**

Modify `jira_server.py` so `is_oauth_ready_api_path()` and `OAUTH_SHARED_CONFIG_WRITE_PATHS` read from the new policy registry until all call sites move. Do not keep two independent allowlists.

- [ ] **Step 6: Run focused guard tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_oauth_route_guards tests.test_csrf_token_bound tests.test_pre_db_admin_gates
```

Expected: PASS.

- [ ] **Step 7: Commit guard centralization**

Run:

```bash
git add backend/security/guards.py backend/app.py jira_server.py tests/test_endpoint_security_matrix.py tests/test_oauth_route_guards.py
git commit -m "security: enforce central endpoint guards"
```

## Task 4: Close Dev, Debug, And Network Exposure

**Files:**
- Create: `backend/security/headers.py`
- Modify: `jira_server.py`
- Modify: `backend/routes/auth_routes.py`
- Test: `tests/test_network_bind_guards.py`
- Test: `tests/test_security_headers.py`

- [ ] **Step 1: Add network bind tests**

Create `tests/test_network_bind_guards.py`:

```python
import unittest
from unittest.mock import patch

import jira_server


class NetworkBindGuardTests(unittest.TestCase):
    def test_default_bind_host_is_loopback(self):
        self.assertEqual(jira_server.default_bind_host(), "127.0.0.1")

    def test_basic_mode_rejects_network_bind_without_explicit_allow(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "basic"), \
             patch.dict("os.environ", {"ALLOW_NETWORK_BIND": ""}, clear=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_network_bind("0.0.0.0")
        self.assertEqual(raised.exception.code, "network_bind_not_allowed")

    def test_oauth_mode_requires_secure_profile_for_network_bind(self):
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", {"ALLOW_NETWORK_BIND": "true", "SESSION_COOKIE_SECURE": ""}, clear=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_network_bind("0.0.0.0")
        self.assertEqual(raised.exception.code, "secure_cookie_required")
```

- [ ] **Step 2: Add response header tests**

Create `tests/test_security_headers.py`:

```python
import unittest

import jira_server


class SecurityHeaderTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config["TESTING"] = True
        self.client = jira_server.app.test_client()

    def test_public_page_has_security_headers(self):
        response = self.client.get("/health")
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.headers.get("Referrer-Policy"), "same-origin")
        self.assertIn("frame-ancestors 'self'", response.headers.get("Content-Security-Policy", ""))

    def test_api_response_has_no_store_cache_header(self):
        response = self.client.get("/api/auth/status")
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
```

- [ ] **Step 3: Implement secure defaults**

Add `default_bind_host()` and `validate_network_bind(host)` in `jira_server.py`:

- default host is `127.0.0.1`;
- `0.0.0.0`, `::`, or non-loopback bind requires `ALLOW_NETWORK_BIND=true`;
- Basic mode cannot bind to network unless `ALLOW_BASIC_AUTH_ON_NETWORK=true` and `APP_ENVIRONMENT_KEY=local`;
- OAuth network bind requires `SESSION_COOKIE_SECURE=true`, non-empty `APP_ALLOWED_ORIGINS` without `*`, and non-empty `FLASK_SECRET_KEY`.

Update `app.run(host=...)` to use `APP_BIND_HOST` or `default_bind_host()`.

- [ ] **Step 4: Add response security headers**

Create `backend/security/headers.py` and register after-request headers:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`;
- `X-Frame-Options: SAMEORIGIN`;
- `Content-Security-Policy` allowing self, current inline styles/scripts only as required by the existing single-page app;
- `Cache-Control: no-store` for `/api/*`;
- no HSTS unless `SESSION_COOKIE_SECURE=true`.

- [ ] **Step 5: Gate dev diagnostics**

Modify `/api/auth/dev/home-graphql-oauth-probe`, `/api/debug-fields`, and `/api/tasks-fields` so they return `404` unless `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` and the request is loopback.

- [ ] **Step 6: Run focused tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_network_bind_guards tests.test_security_headers tests.test_auth_routes tests.test_oauth_route_guards
```

Expected: PASS.

- [ ] **Step 7: Commit network and header hardening**

Run:

```bash
git add backend/security/headers.py jira_server.py backend/routes/auth_routes.py tests/test_network_bind_guards.py tests/test_security_headers.py
git commit -m "security: close network and diagnostic defaults"
```

## Task 5: Blueprint Remaining Root API Routes

**Files:**
- Create: `backend/routes/scenario_routes.py`
- Create: `backend/routes/stats_routes.py`
- Create: `backend/routes/capacity_routes.py`
- Create: `backend/routes/export_routes.py`
- Create: `backend/routes/dev_routes.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Modify: `tests/test_backend_route_source_guards.py`

- [ ] **Step 1: Add source guards for remaining root API routes**

Extend `tests/test_backend_route_source_guards.py` with route groups:

```python
ROOT_ROUTE_GROUPS = {
    "scenario": ("/api/scenario", "/api/scenario/overrides"),
    "stats": ("/api/stats", "/api/stats/burnout", "/api/stats/epic-cohort", "/api/stats/excluded-capacity-source"),
    "capacity": ("/api/capacity", "/api/planned-capacity"),
    "export": ("/api/export-excel",),
    "dev": ("/api/debug-fields", "/api/tasks-fields"),
}
```

For each group, fail if `jira_server.py` contains `@app.route('<route>'` after the corresponding `backend/routes/<group>_routes.py` exists.

- [ ] **Step 2: Move one route group at a time**

For each new blueprint module:

1. copy the route functions from `jira_server.py`;
2. keep imports narrow;
3. call shared helpers through `backend.routes.get_jira_server()` only when a helper still lives in `jira_server.py`;
4. register the blueprint in `backend/app.py`;
5. remove the root `@app.route` decorators for that group from `jira_server.py`;
6. run the focused tests named below before moving the next group.

- [ ] **Step 3: Verify each route group after moving**

Run after Scenario routes:

```bash
.venv/bin/python -m unittest tests.test_oauth_stats_routes tests.test_scenario_issue_dates tests.test_scenario_single_team_filter tests.test_backend_route_source_guards
```

Run after stats routes:

```bash
.venv/bin/python -m unittest tests.test_oauth_stats_routes tests.test_burnout_stats_api tests.test_excluded_capacity_stats_api tests.test_epic_cohort_api tests.test_backend_route_source_guards
```

Run after capacity/export/dev routes:

```bash
.venv/bin/python -m unittest tests.test_oauth_settings_routes tests.test_oauth_route_guards tests.test_endpoint_security_matrix tests.test_backend_route_source_guards
```

- [ ] **Step 4: Commit each group separately**

Use these commit messages:

```bash
git commit -m "refactor: move scenario API routes into blueprint"
git commit -m "refactor: move stats API routes into blueprint"
git commit -m "refactor: move capacity and export routes into blueprints"
git commit -m "refactor: move dev diagnostics into guarded blueprint"
```

## Task 6: Package-Grade Project Shape

**Files:**
- Create: `pyproject.toml`
- Create: `Makefile`
- Modify: `install.sh`
- Modify: `requirements.txt`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Test: `tests/test_project_packaging.py`

- [ ] **Step 1: Add packaging tests**

Create `tests/test_project_packaging.py`:

```python
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ProjectPackagingTests(unittest.TestCase):
    def test_pyproject_declares_runtime_package_and_python_version(self):
        source = (ROOT / "pyproject.toml").read_text(encoding="utf8")
        self.assertIn('name = "jira-execution-planner"', source)
        self.assertIn('requires-python = ">=3.11"', source)
        self.assertIn('jira-execution-planner = "jira_server:main"', source)

    def test_install_script_uses_requirements_file(self):
        source = (ROOT / "install.sh").read_text(encoding="utf8")
        self.assertIn("python -m pip install -r requirements.txt", source)
        self.assertNotIn("pip3 install --user flask flask-cors requests", source)

    def test_makefile_exposes_standard_targets(self):
        source = (ROOT / "Makefile").read_text(encoding="utf8")
        for target in ("install:", "build:", "test:", "test-security:", "run:"):
            self.assertIn(target, source)
```

- [ ] **Step 2: Add `main()` entrypoint**

Refactor the bottom of `jira_server.py` so the current `if __name__ == '__main__':` body moves into `main()`, then call `main()` from the guard. Keep all existing CLI args.

- [ ] **Step 3: Add `pyproject.toml`**

Create a minimal project metadata file with:

- project name `jira-execution-planner`;
- `requires-python = ">=3.11"`;
- console script `jira-execution-planner = "jira_server:main"`;
- packages including `backend` and `planning`.

- [ ] **Step 4: Replace stale installer behavior**

Update `install.sh` so it:

- creates `.venv` when missing;
- installs `requirements.txt` through `.venv/bin/python -m pip install -r requirements.txt`;
- prints the DB/OAuth migration reminder from `INSTALL.md`;
- never hardcodes a partial dependency list.

- [ ] **Step 5: Add repeatable local commands**

Create `Makefile` with:

```makefile
.PHONY: install build test test-security run

install:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	npm ci

build:
	npm run build

test:
	.venv/bin/python -m unittest discover -s tests

test-security:
	.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards

run:
	.venv/bin/python jira_server.py
```

- [ ] **Step 6: Run packaging tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_project_packaging
```

Expected: PASS.

- [ ] **Step 7: Commit project shape changes**

Run:

```bash
git add pyproject.toml Makefile install.sh requirements.txt README.md INSTALL.md jira_server.py tests/test_project_packaging.py
git commit -m "build: add project-grade packaging commands"
```

## Task 7: CI And Release Gates

**Files:**
- Modify: `.github/workflows/verify-frontend-build.yml`
- Modify: `.github/workflows/release-latest.yml`
- Create: `docs/security/endpoints.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Extend CI verification**

Update `.github/workflows/verify-frontend-build.yml` so it runs:

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: "3.11"
- name: Install backend
  run: python -m pip install -r requirements.txt
- name: Backend tests
  run: python -m unittest discover -s tests
- name: Frontend tests
  run: node --test tests/test_*.js
```

Keep the existing `npm ci`, `npm run build`, and dist diff check.

- [ ] **Step 2: Harden release packaging**

Update `.github/workflows/release-latest.yml` so the zip includes only:

- runtime Python files under `backend/`, `planning/`, and `jira_server.py`;
- `frontend/dist/`, `jira-dashboard.html`, `favicon.ico`, `epm-burst.svg`;
- `requirements.txt`, `install.sh`, `pyproject.toml`, `.env.example`, `INSTALL.md`, `README.md`, `LICENSE`;
- `backend/db/alembic.ini` and migration files.

Exclude `.git`, `.github`, `node_modules`, tests, docs/plans, postmortems, caches, `.env*`, token stores, local config JSON, and generated Python caches.

- [ ] **Step 3: Document endpoint policy**

Create `docs/security/endpoints.md` with:

- the security model classes from this plan;
- a table generated from `ENDPOINT_POLICIES`;
- exact steps for adding a new endpoint: add route, add policy entry, add matrix test, run `make test-security`.

- [ ] **Step 4: Update plan index**

Add this plan to `docs/plans/README.md` under a new `Project Grade Security Hardening` section. State that it must run before exposing the app outside loopback or cutting a release intended for other users.

- [ ] **Step 5: Run CI-equivalent checks locally**

Run:

```bash
npm ci
npm run build
.venv/bin/python -m unittest discover -s tests
node --test tests/test_*.js
git diff --exit-code frontend/dist
```

Expected: all commands PASS and `frontend/dist` is unchanged unless frontend source changed and was rebuilt.

- [ ] **Step 6: Commit CI/release hardening**

Run:

```bash
git add .github/workflows/verify-frontend-build.yml .github/workflows/release-latest.yml docs/security/endpoints.md docs/plans/README.md
git commit -m "ci: enforce security and packaging gates"
```

## Task 8: Final Verification And Handoff

**Files:**
- Modify only if verification exposes a real issue from earlier tasks.

- [ ] **Step 1: Run full backend suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: PASS.

- [ ] **Step 2: Run frontend build and Node tests**

Run:

```bash
npm run build
node --test tests/test_*.js
```

Expected: PASS.

- [ ] **Step 3: Launch startup smoke**

Run:

```bash
.venv/bin/python jira_server.py
```

Expected: Flask starts without dependency/runtime warnings before the startup banner. In a second terminal, run:

```bash
curl http://127.0.0.1:5050/api/test
```

Expected: route returns a stable JSON response, not an HTML traceback. Stop the server after verification.

- [ ] **Step 4: Review git history and status**

Run:

```bash
git log --oneline -5
git status --short --branch
```

Expected: commits are atomic and the tree has no accidental local artifacts staged.

- [ ] **Step 5: Write handoff summary**

Include:

- endpoint policy registry path;
- routes intentionally public;
- dev-only routes and required allow flag;
- network bind rules;
- CI commands that passed;
- any endpoints still intentionally legacy/local-only;
- confirmation that Home write gate remains blocked.

## Final Acceptance Criteria

- Every Flask route is covered by exactly one endpoint policy.
- New routes fail tests until they receive an explicit security policy and matrix coverage.
- No app-data API returns Jira/Home/user/config data to an anonymous OAuth-mode request.
- Unsafe OAuth/DB requests require both `X-Requested-With: jira-execution-planner` and token-bound CSRF when they write user, shared, or admin state.
- Shared configuration writes require tool admin in OAuth/DB mode.
- `/api/debug-fields`, `/api/tasks-fields`, and `/api/auth/dev/home-graphql-oauth-probe` are unreachable unless explicitly enabled for local loopback development.
- Basic mode and local token stores cannot be exposed on `0.0.0.0` by accident.
- Flask defaults to loopback binding.
- Release zip excludes secrets, caches, tests, plans, node modules, and local generated JSON.
- `install.sh`, `pyproject.toml`, `Makefile`, README, and CI agree on install/test/run commands.
- `GATE-05-home-write-capability.md` remains blocked unless the documented probe prints `PASS home_project_update_supported`.
