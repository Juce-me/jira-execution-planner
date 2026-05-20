# Project Grade Security Hardening Implementation Plan

> **Status:** Done. Executed in branch `feature/project-grade-security-hardening` through commit `47b2bce` and merged to `main` in PR #39 (`892339e`). Kept for audit context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the app into a project-grade local/web app whose HTTP surface is default-deny, documented, test-covered, and closed to unauthenticated network users.

**Architecture:** Add a central endpoint policy registry that classifies every Flask route, then enforce that policy through one shared before-request guard instead of route-by-route ad hoc checks. Move remaining root API routes into blueprints as the policy lands, close dev/diagnostic endpoints unless explicitly enabled for local development, and update packaging/CI so startup, migrations, builds, and security route checks are repeatable.

**Tech Stack:** Flask, SQLAlchemy/Alembic, existing Atlassian OAuth and DB auth context, token-bound CSRF, React 19/esbuild, Python `unittest`, Node tests, Playwright, GitHub Actions.

---

## Current Findings

- The live Flask URL map includes public pages, auth callbacks, admin routes, EPM/ENG/settings/scenario-draft blueprints, legacy root routes for scenario, stats, capacity, export, debug, and static files, plus a duplicate root `/` registration that must be removed or explicitly delegated.
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
| `authenticated_read` | Read app data using Basic mode locally or a real authenticated OAuth browser session. | ENG reads, EPM reads, Jira catalogs, stats reads. | Basic mode only on loopback/local profile; OAuth mode requires a real active browser session, not a fallback empty `RequestAuthContext`. |
| `user_write` | Reads or mutates current user's private state. | `/api/me/views`, `/api/me/connections/home-token` | Authenticated user; unsafe methods require token-bound CSRF. |
| `workspace_write` | Mutates collaborative workspace state that is not admin-only. | Scenario draft save, rollback, presence, locks, reload, writeback preview/blocker. | Authenticated user in the resolved workspace; unsafe methods require `X-Requested-With` and token-bound CSRF; object ids must belong to the current workspace. |
| `shared_admin_write` | Mutates shared workspace/app configuration. | `/api/projects/selected`, `/api/board-config`, field mappings, EPM config. | Tool admin plus token-bound CSRF in OAuth/DB mode; Basic mode local-only. |
| `tool_admin` | Operator/admin inspection or user/service credential administration. | `/api/admin/*` | DB auth, active tool admin; unsafe methods require token-bound CSRF. |
| `dev_local` | Diagnostic/probe endpoint that must not be reachable in project-grade/network mode. | `/api/debug-fields`, `/api/tasks-fields`, `/api/auth/dev/home-graphql-oauth-probe` | `APP_ENVIRONMENT_KEY in {local, dev}` plus explicit allow flag plus loopback request. |
| `legacy_basic_local` | Existing compatibility route allowed only for local Basic mode during migration. | `/api/scenario/overrides` POST until DB drafts replace it. | Basic mode, loopback request, no OAuth DB write bypass. |

Default rule: if a route has no policy, return `404 route_not_found` or `501 route_not_oauth_ready` before route code runs. Do not add public API routes by default.

Central request classification must use Flask's resolved `request.url_rule.rule`, `request.method`, and `request.endpoint`. Compatibility helpers that receive concrete paths, such as `is_oauth_ready_api_path("/api/epm/projects/home-1/issues")`, must use a separate concrete-path matcher compiled from the policy registry. Do not reuse Flask rule-string matching against raw request paths.

Expected shared error bodies:

| Case | Status | Body requirements |
| --- | --- | --- |
| Missing OAuth browser session | `401` | `{"error": "auth_required", "loginUrl": "/login?reason=session_expired"}` |
| Missing OAuth scope | `401` | `{"error": "auth_required", "loginUrl": "/login?reason=missing_scope"}` |
| Missing `X-Requested-With` or CSRF | `403` | `{"error": "csrf_required", "message": "...CSRF..."}` |
| Non-admin shared/admin write | `403` | `{"error": "admin_required", "recoveryUrl": "/auth/admin-required"}` |
| Unclassified OAuth API | `501` | `{"error": "route_not_oauth_ready"}` |
| Disabled dev-local endpoint | `404` | `{"error": "not_found"}` |

## Target File Map

- Create `backend/security/__init__.py`: package marker and narrow exports.
- Create `backend/security/policy.py`: endpoint policy dataclasses, matchers, and route classification source of truth.
- Create `backend/security/guards.py`: before-request guard registration and shared responses.
- Create `backend/security/headers.py`: response headers and startup network-bind validation.
- Modify `backend/app.py`: register security guards and headers before blueprints.
- Modify `jira_server.py`: keep compatibility wrappers, remove duplicated route guard lists, default bind host to `127.0.0.1`, and reject network bind unless explicitly allowed.
- Modify `backend/routes/auth_routes.py`: require local/dev allow flag and loopback for `/api/auth/dev/home-graphql-oauth-probe`.
- Modify `backend/routes/settings_routes.py`, `backend/routes/epm_routes.py`, `backend/routes/eng_routes.py`: remove duplicate guard helpers only after shared guard coverage exists.
- Create `backend/routes/scenario_routes.py`, `backend/routes/stats_routes.py`, `backend/routes/capacity_routes.py`, `backend/routes/export_routes.py`, `backend/routes/diagnostic_routes.py`, `backend/routes/dev_routes.py`: move remaining root API routes out of `jira_server.py` without behavior changes.
- Create `tests/test_endpoint_policy_inventory.py`: every Flask route has exactly one policy.
- Create `tests/test_endpoint_security_matrix.py`: sampled unauth/auth/non-admin/admin behavior for each policy class.
- Create `tests/test_network_bind_guards.py`: loopback default and unsafe network bind rejection.
- Create `tests/test_security_headers.py`: response header and CORS safety checks.
- Create `tests/test_project_packaging.py`: package metadata, console entrypoint, and install script consistency.
- Modify `tests/test_oauth_route_guards.py`, `tests/test_backend_route_source_guards.py`, `tests/test_pre_db_admin_gates.py`, `tests/test_oauth_jira_client_source_guard.py`: align existing guard tests with the central policy registry.
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

- [ ] **Step 2: Ensure a usable Python runner exists**

Run:

```bash
if [ -x .venv/bin/python ]; then
  .venv/bin/python --version
else
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
  .venv/bin/python --version
fi
```

Expected: a project-local Python interpreter with repo dependencies is available before route-map or test commands run. Do not install dependencies into the global user site.

- [ ] **Step 3: List and open gated docs**

Run:

```bash
rg --files docs/plans | rg '/GATE-'
sed -n '1,220p' docs/plans/GATE-05-home-write-capability.md
```

Expected: `docs/plans/GATE-05-home-write-capability.md` is the only gate.

- [ ] **Step 4: Check Home write probe inputs without printing values**

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

- [ ] **Step 5: Record the current route map**

Run:

```bash
PYTHON_BIN=.venv/bin/python
if [ ! -x "$PYTHON_BIN" ]; then PYTHON_BIN=python3; fi
"$PYTHON_BIN" -c $'import jira_server\nfor rule in sorted(jira_server.app.url_map.iter_rules(), key=lambda r: r.rule):\n    methods=",".join(sorted(m for m in rule.methods if m not in {"HEAD","OPTIONS"}))\n    print(f"{methods:20} {rule.rule:55} {rule.endpoint}")'
```

Expected: route map output is reviewed before changing policy.

- [ ] **Step 6: Commit preflight gate update if it changed**

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
    def route_methods(self, rule):
        return sorted(method for method in rule.methods if method not in IGNORED_METHODS)

    def test_every_non_static_route_method_has_exactly_one_security_policy(self):
        from backend.security.policy import matching_policies

        ambiguous = []
        missing = []
        for rule in jira_server.app.url_map.iter_rules():
            if rule.endpoint in IGNORED_ENDPOINTS:
                continue
            for method in self.route_methods(rule):
                matches = matching_policies(rule.rule, [method], rule.endpoint)
                if not matches:
                    missing.append({"rule": rule.rule, "method": method, "endpoint": rule.endpoint})
                elif len(matches) > 1:
                    ambiguous.append({
                        "rule": rule.rule,
                        "method": method,
                        "endpoint": rule.endpoint,
                        "policies": [policy.name for policy in matches],
                    })

        self.assertEqual(missing, [])
        self.assertEqual(ambiguous, [])

    def test_no_duplicate_route_method_registrations(self):
        seen = {}
        duplicates = []
        for rule in jira_server.app.url_map.iter_rules():
            if rule.endpoint in IGNORED_ENDPOINTS:
                continue
            for method in self.route_methods(rule):
                key = (rule.rule, method)
                if key in seen:
                    duplicates.append({
                        "rule": rule.rule,
                        "method": method,
                        "firstEndpoint": seen[key],
                        "secondEndpoint": rule.endpoint,
                    })
                else:
                    seen[key] = rule.endpoint

        self.assertEqual(duplicates, [])

    def test_policy_names_are_unique(self):
        from backend.security.policy import ENDPOINT_POLICIES

        names = [policy.name for policy in ENDPOINT_POLICIES]
        self.assertEqual(sorted(names), sorted(set(names)))

    def test_dynamic_routes_have_security_samples(self):
        from backend.security.policy import routes_requiring_samples
        from tests.endpoint_security_samples import ROUTE_SAMPLES

        missing = sorted(route for route in routes_requiring_samples() if route not in ROUTE_SAMPLES)
        self.assertEqual(missing, [])

    def test_dynamic_path_compatibility_samples_are_oauth_ready(self):
        from backend.security.policy import is_oauth_ready_api_path
        from tests.endpoint_security_samples import ROUTE_SAMPLES

        wrong = []
        for rule, sample in sorted(ROUTE_SAMPLES.items()):
            if not sample.startswith("/api/"):
                continue
            if sample.startswith("/api/auth/dev/"):
                continue
            if not is_oauth_ready_api_path(sample):
                wrong.append({"rule": rule, "sample": sample})

        self.assertEqual(wrong, [])

    def test_policy_covers_existing_oauth_ready_routes_before_wrapper_removal(self):
        from backend.security.policy import classify_rule

        missing = []
        for path in sorted(jira_server.OAUTH_READY_API_PATHS):
            rules = [rule for rule in jira_server.app.url_map.iter_rules() if rule.rule == path]
            if not rules:
                missing.append({"path": path, "reason": "no flask rule"})
                continue
            for rule in rules:
                methods = sorted(method for method in rule.methods if method not in IGNORED_METHODS)
                if not classify_rule(rule.rule, methods, rule.endpoint):
                    missing.append({"path": path, "methods": methods, "reason": "no policy"})

        self.assertEqual(missing, [])

    def test_policy_marks_existing_shared_config_writes_admin_only(self):
        from backend.security.policy import classify_rule

        wrong = []
        for path in sorted(jira_server.OAUTH_SHARED_CONFIG_WRITE_PATHS):
            policy = classify_rule(path, ["POST"])
            if not policy or policy.policy_class != "shared_admin_write":
                wrong.append({"path": path, "policy": getattr(policy, "policy_class", None)})

        self.assertEqual(wrong, [])
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
    "/api/scenario/drafts/<draft_id>/events": "/api/scenario/drafts/draft-1/events",
    "/api/scenario/drafts/<draft_id>/events/stream": "/api/scenario/drafts/draft-1/events/stream",
    "/api/scenario/drafts/<draft_id>/locks": "/api/scenario/drafts/draft-1/locks",
    "/api/scenario/drafts/<draft_id>/presence": "/api/scenario/drafts/draft-1/presence",
    "/api/scenario/drafts/<draft_id>/reload-from-jira": "/api/scenario/drafts/draft-1/reload-from-jira",
    "/api/scenario/drafts/<draft_id>/rollback": "/api/scenario/drafts/draft-1/rollback",
    "/api/scenario/drafts/<draft_id>/versions/<int:version_number>": "/api/scenario/drafts/draft-1/versions/1",
    "/api/scenario/drafts/<draft_id>/writeback": "/api/scenario/drafts/draft-1/writeback",
    "/api/scenario/drafts/<draft_id>/writeback/preview": "/api/scenario/drafts/draft-1/writeback/preview",
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
- Modify: `jira_server.py`
- Test: `tests/test_endpoint_policy_inventory.py`

- [ ] **Step 1: Add the security package marker**

Create `backend/security/__init__.py`:

```python
"""Security policy and request guard helpers."""
```

- [ ] **Step 2: Add the endpoint policy registry**

Create `backend/security/policy.py` with the concrete policy entries for current routes. The registry may use exact, prefix, or Flask dynamic-pattern matches, but it must classify every route in the current URL map and no route may match two policies.

Use these policy classes exactly: `public_page`, `auth_flow`, `authenticated_read`, `user_write`, `workspace_write`, `shared_admin_write`, `tool_admin`, `dev_local`, `legacy_basic_local`.

Required initial entries:

```python
import re
from dataclasses import dataclass


UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
PUBLIC_METHODS = frozenset({"GET"})


def _dynamic_rule_regex(rule: str) -> re.Pattern:
    parts = []
    index = 0
    for match in re.finditer(r"<(?:(int|path|string):)?([^>]+)>", rule):
        parts.append(re.escape(rule[index:match.start()]))
        converter = match.group(1) or "string"
        if converter == "int":
            parts.append(r"\d+")
        elif converter == "path":
            parts.append(r".+")
        else:
            parts.append(r"[^/]+")
        index = match.end()
    parts.append(re.escape(rule[index:]))
    return re.compile("^" + "".join(parts) + "$")


@dataclass(frozen=True)
class EndpointPolicy:
    name: str
    path: str
    methods: frozenset[str]
    policy_class: str
    match: str = "exact"
    exclude_paths: tuple[str, ...] = ()

    def matches_rule(self, rule: str, method: str, endpoint: str = "") -> bool:
        if any(rule == excluded or rule.startswith(excluded) for excluded in self.exclude_paths):
            return False
        if self.match == "exact" and rule != self.path:
            return False
        if self.match == "prefix" and not rule.startswith(self.path):
            return False
        if self.match == "dynamic" and rule != self.path:
            return False
        return method in self.methods

    def matches_path(self, path: str, method: str) -> bool:
        if any(path == excluded or path.startswith(excluded) for excluded in self.exclude_paths):
            return False
        if method not in self.methods:
            return False
        if self.match == "exact":
            return path == self.path
        if self.match == "prefix":
            return path.startswith(self.path)
        if self.match == "dynamic":
            return bool(_dynamic_rule_regex(self.path).match(path))
        return False


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
    EndpointPolicy("selected-projects-read", "/api/projects/selected", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("selected-projects-write", "/api/projects/selected", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("board-config-read", "/api/board-config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("board-config-write", "/api/board-config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("capacity-config-read", "/api/capacity/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("capacity-config-write", "/api/capacity/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("sprint-field-config-read", "/api/sprint-field/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("sprint-field-config-write", "/api/sprint-field/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("story-points-config-read", "/api/story-points-field/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("story-points-config-write", "/api/story-points-field/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("parent-name-config-read", "/api/parent-name-field/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("parent-name-config-write", "/api/parent-name-field/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("team-field-config-read", "/api/team-field/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("team-field-config-write", "/api/team-field/config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("priority-weights-read", "/api/stats/priority-weights-config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("priority-weights-write", "/api/stats/priority-weights-config", frozenset({"POST"}), "shared_admin_write"),
    EndpointPolicy("issue-types-config-read", "/api/issue-types/config", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("issue-types-config-write", "/api/issue-types/config", frozenset({"POST"}), "shared_admin_write"),
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
    EndpointPolicy("scenario-drafts-root-read", "/api/scenario/drafts", PUBLIC_METHODS, "authenticated_read"),
    EndpointPolicy("scenario-drafts-root-write", "/api/scenario/drafts", frozenset({"POST"}), "workspace_write"),
    EndpointPolicy("scenario-draft-version", "/api/scenario/drafts/<draft_id>/versions/<int:version_number>", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("scenario-draft-events", "/api/scenario/drafts/<draft_id>/events", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("scenario-draft-events-stream", "/api/scenario/drafts/<draft_id>/events/stream", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("scenario-draft-presence-read", "/api/scenario/drafts/<draft_id>/presence", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("scenario-draft-presence-write", "/api/scenario/drafts/<draft_id>/presence", frozenset({"POST"}), "workspace_write", "dynamic"),
    EndpointPolicy("scenario-draft-locks", "/api/scenario/drafts/<draft_id>/locks", frozenset({"POST"}), "workspace_write", "dynamic"),
    EndpointPolicy("scenario-draft-reload", "/api/scenario/drafts/<draft_id>/reload-from-jira", frozenset({"POST"}), "workspace_write", "dynamic"),
    EndpointPolicy("scenario-draft-rollback", "/api/scenario/drafts/<draft_id>/rollback", frozenset({"POST"}), "workspace_write", "dynamic"),
    EndpointPolicy("scenario-draft-writeback-preview", "/api/scenario/drafts/<draft_id>/writeback/preview", frozenset({"POST"}), "workspace_write", "dynamic"),
    EndpointPolicy("scenario-draft-writeback-blocked", "/api/scenario/drafts/<draft_id>/writeback", frozenset({"POST"}), "workspace_write", "dynamic"),
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
    matches = []
    seen = set()
    for method in methods:
        for policy in ENDPOINT_POLICIES:
            if policy.name in seen:
                continue
            if policy.matches_rule(rule, method, endpoint):
                matches.append(policy)
                seen.add(policy.name)
    return matches


def classify_rule(rule: str, methods: list[str] | tuple[str, ...], endpoint: str = ""):
    policies = matching_policies(rule, methods, endpoint)
    return policies[0] if len(policies) == 1 else None


def matching_path_policies(path: str, method: str):
    return [policy for policy in ENDPOINT_POLICIES if policy.matches_path(path, method)]


def classify_request_rule(rule: str, method: str, endpoint: str = ""):
    policies = matching_policies(rule, [method], endpoint)
    return policies[0] if len(policies) == 1 else None


def routes_requiring_samples():
    return sorted(policy.path for policy in ENDPOINT_POLICIES if "<" in policy.path)


def oauth_ready_api_paths():
    return {
        policy.path
        for policy in ENDPOINT_POLICIES
        if policy.path.startswith("/api/")
        and policy.policy_class not in {"dev_local"}
        and policy.match == "exact"
    }


def shared_config_write_paths():
    return {
        policy.path
        for policy in ENDPOINT_POLICIES
        if policy.policy_class == "shared_admin_write" and "POST" in policy.methods
    }


def is_oauth_ready_api_path(path: str) -> bool:
    if path.startswith("/api/auth/") and not path.startswith("/api/auth/dev/"):
        return True
    if path.startswith("/api/admin/"):
        return True
    for method in ("GET", "POST", "PATCH", "DELETE"):
        if any(
            policy.policy_class not in {"dev_local", "legacy_basic_local"}
            for policy in matching_path_policies(path, method)
        ):
            return True
    return False
```

- [ ] **Step 3: Remove the duplicate root route registration**

Modify `jira_server.py` so only one `@app.route('/', methods=['GET'])` registration remains. Delete the later duplicate `@app.route('/') def index(): ...` wrapper or convert it into an undecorated helper only if a caller still uses it.

- [ ] **Step 4: Run the inventory test**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory
```

Expected: PASS. If it fails because a route is unclassified or matches twice, fix `ENDPOINT_POLICIES` before continuing.

- [ ] **Step 5: Commit the registry**

Run:

```bash
git add backend/security/__init__.py backend/security/policy.py jira_server.py tests/test_endpoint_policy_inventory.py
git commit -m "security: add endpoint policy inventory"
```

## Task 3: Central Request Guards

**Files:**
- Create: `backend/security/guards.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Test: `tests/test_endpoint_security_matrix.py`
- Test: `tests/test_oauth_route_guards.py`
- Modify/Test: `tests/test_pre_db_admin_gates.py`
- Modify/Test: `tests/test_backend_route_source_guards.py`

- [ ] **Step 1: Write matrix tests for unauthenticated and unsafe requests**

Create `tests/test_endpoint_security_matrix.py` with tests that:

- run OAuth mode with no browser session;
- assert `authenticated_read`, `user_write`, `workspace_write`, `shared_admin_write`, and `tool_admin` samples do not return data to an anonymous user;
- assert `/api/config`, `/api/projects/selected`, `/api/board-config`, and `/api/epm/config` return `401 auth_required` with `loginUrl` when OAuth mode has no real browser session;
- assert dynamic concrete paths such as `/api/epm/projects/home-project-1/issues` and `/api/scenario/drafts/draft-1/rollback` are classified correctly;
- assert unsafe requests require `X-Requested-With: jira-execution-planner`, and token-bound `X-CSRF-Token` where the policy class writes user, workspace, shared, or admin state, before route code runs;
- assert exact error bodies for `auth_required`, `csrf_required`, `admin_required`, `route_not_oauth_ready`, and disabled dev-local `not_found`;
- assert `public_page` samples stay readable.

Minimum required sample list:

```python
SECURITY_SAMPLES = {
    "public_page": [("GET", "/health"), ("GET", "/jira-dashboard.html")],
    "authenticated_read": [
        ("GET", "/api/config"),
        ("GET", "/api/projects/selected"),
        ("GET", "/api/tasks"),
        ("GET", "/api/epm/projects"),
        ("GET", "/api/epm/projects/home-project-1/issues"),
        ("GET", "/api/stats"),
        ("GET", "/api/scenario/drafts"),
    ],
    "user_write": [("POST", "/api/me/views"), ("POST", "/api/export-excel")],
    "workspace_write": [
        ("POST", "/api/scenario/drafts"),
        ("POST", "/api/scenario/drafts/draft-1/rollback"),
        ("POST", "/api/scenario/drafts/draft-1/writeback"),
    ],
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

- avoid module-level imports of `jira_server`; use `backend.routes.get_jira_server()` or lazy imports inside functions so app construction cannot circular-import partially initialized globals;
- classify the incoming request using `request.url_rule.rule`, `request.method`, and `request.endpoint` through `backend.security.policy.classify_request_rule`;
- reject unclassified `/api/*` routes before route code;
- reject unclassified non-API routes with `404 route_not_found`, except Flask's built-in static handler when explicitly ignored by tests;
- keep `public_page` readable;
- keep auth-flow routes under existing auth behavior;
- require a real authenticated OAuth browser session for `authenticated_read`, `user_write`, `workspace_write`, `shared_admin_write`, and `tool_admin`; do not accept the fallback empty OAuth `RequestAuthContext` produced when no session exists;
- preserve the existing missing-scope recovery contract: stale OAuth scopes return `401 auth_required` with `loginUrl: /login?reason=missing_scope`;
- reject unsafe OAuth requests missing `X-Requested-With`;
- require token-bound CSRF for unsafe methods on `user_write`, `workspace_write`, `shared_admin_write`, and `tool_admin`;
- require admin for `shared_admin_write` and `tool_admin`;
- reject `dev_local` unless `APP_ENVIRONMENT_KEY` is `local` or `dev`, `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true`, and `request.remote_addr` is loopback;
- reject `legacy_basic_local` in OAuth/DB mode.

Update `tests/test_pre_db_admin_gates.py` in the same task so successful shared-config write tests fetch `/api/auth/csrf` and send both `X-Requested-With` and `X-CSRF-Token`; keep negative cases for missing/invalid CSRF.

- [ ] **Step 4: Register guards before blueprints**

Modify `backend/app.py` so `create_app()` calls:

```python
from backend.security.guards import register_security_guards

register_security_guards(flask_app)
register_blueprints(flask_app)
```

- [ ] **Step 5: Keep compatibility wrappers temporarily**

Before changing `jira_server.py`, run the parity tests from Task 1:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory
```

Expected: PASS, including coverage for every path in the existing `OAUTH_READY_API_PATHS` and every path in `OAUTH_SHARED_CONFIG_WRITE_PATHS`.

Then modify `jira_server.py` so:

- `is_oauth_ready_api_path(path)` delegates to `backend.security.policy.is_oauth_ready_api_path(path)`;
- `OAUTH_READY_API_PATHS` remains exported for existing tests/callers, but is now a computed compatibility value from `oauth_ready_api_paths()`;
- `OAUTH_SHARED_CONFIG_WRITE_PATHS` remains exported for existing tests/callers, but is now a computed compatibility value from `shared_config_write_paths()`;
- no independent handwritten allowlist remains in `jira_server.py`;
- old app-level guards at `require_oauth_unsafe_method_header`, `require_db_admin_csrf_token`, `reject_unmigrated_oauth_routes`, `reject_stale_oauth_scope_api_sessions`, and `require_oauth_shared_config_admin` are removed or reduced to one-line delegates to the central guard.

Extend source-guard tests so they fail if `jira_server.py` still contains independent `@app.before_request` auth/CSRF guard implementations after `backend/security/guards.py` exists.

- [ ] **Step 6: Run focused guard tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_oauth_route_guards tests.test_csrf_token_bound tests.test_pre_db_admin_gates
```

Expected: PASS.

- [ ] **Step 7: Commit guard centralization**

Run:

```bash
git add backend/security/guards.py backend/app.py jira_server.py tests/test_endpoint_security_matrix.py tests/test_oauth_route_guards.py tests/test_pre_db_admin_gates.py tests/test_backend_route_source_guards.py
git commit -m "security: enforce central endpoint guards"
```

## Task 4: Close Dev, Debug, And Network Exposure

**Files:**
- Create: `backend/security/headers.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `.env.example`
- Modify: `INSTALL.md`
- Modify: `README.md`
- Modify only if self-hosting/removing external fonts: `jira-dashboard.html`
- Test: `tests/test_network_bind_guards.py`
- Test: `tests/test_security_headers.py`

- [ ] **Step 1: Add network bind tests**

Create `tests/test_network_bind_guards.py`:

```python
import unittest
from types import SimpleNamespace
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

    def test_oauth_local_token_store_cannot_bind_to_network(self):
        env = {
            "ALLOW_NETWORK_BIND": "true",
            "APP_ENVIRONMENT_KEY": "local",
            "APP_ALLOWED_ORIGINS": "https://planner.example.test",
            "FLASK_SECRET_KEY": "secret",
            "OAUTH_LOCAL_TOKEN_STORE_ALLOWED": "true",
            "SESSION_COOKIE_SECURE": "true",
        }
        with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
             patch.dict("os.environ", env, clear=False):
            with self.assertRaises(jira_server.AuthError) as raised:
                jira_server.validate_network_bind("0.0.0.0")
        self.assertEqual(raised.exception.code, "local_token_store_network_bind_not_allowed")

    def test_main_validates_bind_host_before_app_run(self):
        args = SimpleNamespace(
            jira_url=None,
            jira_email=None,
            jira_token=None,
            jira_query=None,
            server_port=None,
        )
        with patch.object(jira_server, "parse_args", return_value=args), \
             patch.object(jira_server, "validate_startup_auth_config"), \
             patch.object(jira_server, "default_bind_host", return_value="127.0.0.1"), \
             patch.object(jira_server, "validate_network_bind", return_value="127.0.0.1") as validate_bind, \
             patch.object(jira_server.app, "run") as run:
            jira_server.main()

        validate_bind.assert_called_once_with("127.0.0.1")
        run.assert_called_once()
        self.assertEqual(run.call_args.kwargs.get("host"), "127.0.0.1")
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

    def test_credentialed_cors_allows_configured_origin(self):
        response = self.client.get("/api/auth/status", headers={"Origin": "http://localhost:5050"})
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5050")
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_credentialed_cors_rejects_unconfigured_origin(self):
        response = self.client.get("/api/auth/status", headers={"Origin": "https://evil.example.test"})
        self.assertNotEqual(response.headers.get("Access-Control-Allow-Origin"), "https://evil.example.test")
```

- [ ] **Step 3: Run the new tests and verify the red state**

Run:

```bash
.venv/bin/python -m unittest tests.test_network_bind_guards tests.test_security_headers
```

Expected: FAIL before implementation with `AttributeError` for `default_bind_host`/`validate_network_bind` or missing `backend.security.headers`. Do not change the tests to skip the failure.

- [ ] **Step 4: Implement secure defaults**

Add these exact function contracts in `jira_server.py`:

```python
def default_bind_host():
    """Return the default Flask bind host for local execution."""
    return os.getenv("APP_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"


def validate_network_bind(host):
    """Validate and return the requested bind host, or raise AuthError with a stable code."""
```

Required behavior:

- loopback hosts `127.0.0.1`, `localhost`, and `::1` are allowed without extra flags;
- wildcard or non-loopback hosts such as `0.0.0.0`, `::`, or LAN addresses require `ALLOW_NETWORK_BIND=true`;
- `ALLOW_NETWORK_BIND` is the global network-exposure gate;
- in Basic mode, `ALLOW_NETWORK_BIND=true` is still not enough: the bind also requires `ALLOW_BASIC_AUTH_ON_NETWORK=true` and `APP_ENVIRONMENT_KEY=local`, otherwise raise `AuthError("basic_network_bind_not_allowed", ...)`;
- in OAuth mode, network bind requires `SESSION_COOKIE_SECURE=true`, non-empty `APP_ALLOWED_ORIGINS` without `*`, and non-empty `FLASK_SECRET_KEY`, otherwise raise `AuthError("secure_cookie_required", ...)` for the secure-cookie case or a specific `AuthError` code for the missing origin/secret case;
- if `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`, all non-loopback binds are rejected with `AuthError("local_token_store_network_bind_not_allowed", ...)` even when the other OAuth network-bind flags are present;
- missing `ALLOW_NETWORK_BIND=true` raises `AuthError("network_bind_not_allowed", ...)`.

Update `app.run(host=...)` to call `validate_network_bind(default_bind_host())` inside `main()` before `app.run`; tests must patch `app.run` and prove `main()` passes the validated host to Flask.

- [ ] **Step 5: Add response security headers**

Create `backend/security/headers.py` and register after-request headers:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`;
- `X-Frame-Options: SAMEORIGIN`;
- `Content-Security-Policy` allowing self, current inline styles/scripts only as required by the existing single-page app, and either explicitly allowing the current Google Fonts stylesheet/font origins from `jira-dashboard.html` or removing/self-hosting that font dependency in the same task;
- `Cache-Control: no-store` for `/api/*`;
- no HSTS unless `SESSION_COOKIE_SECURE=true`.

Modify `backend/app.py` so `create_app()` imports and calls `register_security_headers(flask_app)` after `register_security_guards(flask_app)` and before `register_blueprints(flask_app)`.

- [ ] **Step 6: Gate dev diagnostics in the files that currently own each route**

- In `backend/routes/auth_routes.py`, extend the existing `/api/auth/dev/home-graphql-oauth-probe` guard. It already checks `APP_ENVIRONMENT_KEY`; do not duplicate the route in `jira_server.py`. Add the explicit `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` and loopback checks there.
- In `jira_server.py`, gate the existing root `/api/debug-fields` and `/api/tasks-fields` routes until Task 5 moves them into `backend/routes/dev_routes.py`.
- All three routes return `404` when disabled, not `403`, so scanners do not learn that a dev probe exists.

- [ ] **Step 7: Document the new bind and diagnostic flags**

Update `.env.example`, `INSTALL.md`, and `README.md` with these exact operator-facing rules:

- default local bind host is `127.0.0.1`;
- set `APP_BIND_HOST=0.0.0.0` only when intentionally exposing the app;
- network bind also requires `ALLOW_NETWORK_BIND=true`;
- Basic auth network bind also requires `ALLOW_BASIC_AUTH_ON_NETWORK=true` and remains local-profile only;
- dev diagnostics require `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` and loopback access.

- [ ] **Step 8: Run focused tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_network_bind_guards tests.test_security_headers tests.test_auth_routes tests.test_oauth_route_guards
```

Expected: PASS.

- [ ] **Step 9: Commit network and header hardening**

Run:

```bash
git add backend/security/headers.py backend/app.py jira_server.py backend/routes/auth_routes.py .env.example INSTALL.md README.md jira-dashboard.html tests/test_network_bind_guards.py tests/test_security_headers.py
git commit -m "security: close network and diagnostic defaults"
```

## Task 5: Blueprint Remaining Root API Routes

**Files:**
- Create: `backend/routes/scenario_routes.py`
- Create: `backend/routes/stats_routes.py`
- Create: `backend/routes/capacity_routes.py`
- Create: `backend/routes/export_routes.py`
- Create: `backend/routes/diagnostic_routes.py`
- Create: `backend/routes/dev_routes.py`
- Modify: `backend/app.py`
- Modify: `jira_server.py`
- Modify: `tests/test_backend_route_source_guards.py`
- Test: `tests/test_route_move_preservation.py`

- [ ] **Step 1: Add source guards for remaining root API routes**

Extend `tests/test_backend_route_source_guards.py` with route groups:

```python
ROOT_ROUTE_GROUPS = {
    "scenario": ("/api/scenario", "/api/scenario/overrides"),
    "stats": ("/api/stats", "/api/stats/burnout", "/api/stats/epic-cohort", "/api/stats/excluded-capacity-source"),
    "capacity": ("/api/capacity", "/api/planned-capacity"),
    "export": ("/api/export-excel",),
    "diagnostic": ("/api/test",),
    "dev": ("/api/debug-fields", "/api/tasks-fields"),
}
```

For each group, fail if `jira_server.py` contains `@app.route('<route>'` after the corresponding `backend/routes/<group>_routes.py` exists.

- [ ] **Step 2: Add route-map preservation tests**

Create `tests/test_route_move_preservation.py`:

```python
import unittest

import jira_server


IGNORED_METHODS = {"HEAD", "OPTIONS"}
EXPECTED_MOVED_ROUTE_METHODS = {
    "/api/scenario": {"GET", "POST"},
    "/api/scenario/overrides": {"GET", "POST"},
    "/api/stats": {"GET"},
    "/api/stats/burnout": {"GET", "POST"},
    "/api/stats/epic-cohort": {"POST"},
    "/api/stats/excluded-capacity-source": {"POST"},
    "/api/capacity": {"GET"},
    "/api/planned-capacity": {"GET"},
    "/api/export-excel": {"POST"},
    "/api/test": {"GET"},
    "/api/debug-fields": {"GET"},
    "/api/tasks-fields": {"GET"},
}


class RouteMovePreservationTests(unittest.TestCase):
    def test_moved_route_urls_and_methods_stay_registered(self):
        actual = {}
        for rule in jira_server.app.url_map.iter_rules():
            methods = {method for method in rule.methods if method not in IGNORED_METHODS}
            actual.setdefault(rule.rule, set()).update(methods)

        missing = {}
        wrong_methods = {}
        for route, expected_methods in EXPECTED_MOVED_ROUTE_METHODS.items():
            if route not in actual:
                missing[route] = sorted(expected_methods)
            elif actual[route] != expected_methods:
                wrong_methods[route] = {"expected": sorted(expected_methods), "actual": sorted(actual[route])}

        self.assertEqual(missing, {})
        self.assertEqual(wrong_methods, {})
```

- [ ] **Step 3: Verify the existing route helper before using it**

Run:

```bash
sed -n '1,120p' backend/routes/__init__.py
.venv/bin/python -m unittest tests.test_backend_route_source_guards
```

Expected: `backend.routes.get_jira_server()` and `bind_server_globals()` already exist. Do not create a second helper. If this check fails in a future checkout, add the helper to `backend/routes/__init__.py` before moving routes.

- [ ] **Step 4: Capture the pre-move behavioral baseline**

Run:

```bash
.venv/bin/python -m unittest tests.test_route_move_preservation tests.test_oauth_stats_routes tests.test_scenario_issue_dates tests.test_scenario_single_team_filter tests.test_burnout_stats_api tests.test_excluded_capacity_stats_api tests.test_epic_cohort_api tests.test_oauth_settings_routes tests.test_oauth_route_guards
```

Expected: PASS before moving any route group. This is the behavior-preservation baseline; do not weaken tests to make the refactor easier.

- [ ] **Step 5: Move one route group at a time**

For each new blueprint module:

1. copy the route functions from `jira_server.py`;
2. keep imports narrow;
3. avoid module-level `jira_server` imports; call shared helpers through the existing `backend.routes.get_jira_server()` or `bind_server_globals()` lazy sync pattern only when a helper still lives in `jira_server.py`;
4. register the blueprint in `backend/app.py`;
5. remove the root `@app.route` decorators for that group from `jira_server.py`;
6. run the focused tests named below before moving the next group;
7. verify `tests.test_route_move_preservation` after every group so URL/method shape does not drift.

Scenario move requirement: preserve `jira_server.scenario_planner` as an undecorated compatibility callable or extract the planner computation into a shared service before removing the root route decorator, because `backend/routes/scenario_draft_routes.py` calls it for reload-from-Jira.

Dev move requirement: remove unused manual Basic `Authorization` header construction from the debug/tasks-fields handlers during the move, and update `tests/test_oauth_jira_client_source_guard.py` so `backend/routes/dev_routes.py` cannot reintroduce service-credential or Basic-auth bypasses.

- [ ] **Step 6: Verify each route group after moving**

Run after Scenario routes:

```bash
.venv/bin/python -m unittest tests.test_route_move_preservation tests.test_oauth_stats_routes tests.test_scenario_issue_dates tests.test_scenario_single_team_filter tests.test_backend_route_source_guards
```

Also run after Scenario routes:

```bash
.venv/bin/python -m unittest tests.test_scenario_draft_routes
```

Run after stats routes:

```bash
.venv/bin/python -m unittest tests.test_route_move_preservation tests.test_oauth_stats_routes tests.test_burnout_stats_api tests.test_excluded_capacity_stats_api tests.test_epic_cohort_api tests.test_backend_route_source_guards
```

Run after capacity/export/dev routes:

```bash
.venv/bin/python -m unittest tests.test_route_move_preservation tests.test_oauth_settings_routes tests.test_oauth_route_guards tests.test_endpoint_security_matrix tests.test_backend_route_source_guards tests.test_oauth_jira_client_source_guard
```

- [ ] **Step 7: Commit each group separately**

Use these commit messages:

```bash
git commit -m "refactor: move scenario API routes into blueprint"
git commit -m "refactor: move stats API routes into blueprint"
git commit -m "refactor: move capacity, export, and diagnostics into blueprints"
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
        self.assertIn('requires-python = ">=3.9"', source)
        self.assertIn('jira-execution-planner = "jira_server:main"', source)

    def test_install_script_uses_requirements_file(self):
        source = (ROOT / "install.sh").read_text(encoding="utf8")
        self.assertIn(".venv/bin/python -m pip install -r requirements.txt", source)
        self.assertIn(".venv/bin/python -m pip install -e .", source)
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
- `requires-python = ">=3.9"` to preserve the existing Python 3.9 runtime guard and LibreSSL/urllib3 pin expectations;
- console script `jira-execution-planner = "jira_server:main"`;
- packages including `backend` and `planning`.

- [ ] **Step 4: Replace stale installer behavior**

Update `install.sh` so it:

- creates `.venv` when missing;
- installs `requirements.txt` through `.venv/bin/python -m pip install -r requirements.txt`;
- installs the project itself through `.venv/bin/python -m pip install -e .` so the `jira-execution-planner` console script exists after `./install.sh`;
- prints the DB/OAuth migration reminder from `INSTALL.md`;
- never hardcodes a partial dependency list.

- [ ] **Step 5: Add repeatable local commands**

Create `Makefile` with:

```makefile
.PHONY: install build test test-security run

install:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.txt
	.venv/bin/python -m pip install -e .
	npm ci

build:
	npm run build

test:
	.venv/bin/python -m unittest discover -s tests

test-security:
	.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation

run:
	.venv/bin/python jira_server.py
```

- [ ] **Step 6: Run packaging tests**

Run:

```bash
.venv/bin/python -m unittest tests.test_project_packaging
```

Expected: PASS.

Also run:

```bash
.venv/bin/jira-execution-planner --help
```

Expected: command exists and prints the CLI help without importing missing runtime dependencies.

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
- Modify if release-facing test instructions change: `README.md`, `INSTALL.md`

- [ ] **Step 1: Extend CI verification**

Update `.github/workflows/verify-frontend-build.yml` so it runs:

```yaml
strategy:
  matrix:
    python-version: ["3.9", "3.11"]
steps:
  - uses: actions/setup-python@v5
    with:
      python-version: ${{ matrix.python-version }}
  - name: Install backend
    run: python -m pip install -r requirements.txt
  - name: Backend tests
    run: python -m unittest discover -s tests
  - name: Endpoint security tests
    run: python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation
  - name: Frontend tests
    run: node --test tests/test_*.js
```

Keep the existing `npm ci`, `npm run build`, and dist diff check.

The workflow may run the frontend build once or per matrix entry, but at least one job must run backend/security tests on Python 3.9 and one on Python 3.11.

- [ ] **Step 2: Harden release packaging**

Update `.github/workflows/release-latest.yml` so the zip includes only:

- runtime Python files under `backend/`, `planning/`, and `jira_server.py`;
- `frontend/dist/`, `jira-dashboard.html`, `favicon.ico`, `epm-burst.svg`;
- `requirements.txt`, `install.sh`, `pyproject.toml`, `.env.example`, `INSTALL.md`, `README.md`, `LICENSE`;
- `backend/db/alembic.ini` and migration files.

Exclude `.git`, `.github`, `node_modules`, tests, docs/plans, postmortems, caches, real secret env files such as `.env` and `.env.local`, token stores, local config JSON, and generated Python caches. Preserve `.env.example` in the release zip.

Before the release zip is created, the release workflow must also install Python dependencies and run:

```bash
python -m unittest discover -s tests
python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_backend_route_source_guards tests.test_route_move_preservation
```

Do not publish `latest` from a job that has only built frontend assets. If the release zip excludes `tests/`, update release-facing sections of `INSTALL.md` and `README.md` so they do not instruct prebuilt-zip users to run omitted test modules.

- [ ] **Step 3: Document endpoint policy**

Create `docs/security/endpoints.md` with:

- the security model classes from this plan;
- a table generated from `ENDPOINT_POLICIES`;
- exact steps for adding a new endpoint: add route, add policy entry, add matrix test, run `make test-security`.

- [ ] **Step 4: Verify the plan index**

Verify `docs/plans/README.md` already has a `Project Grade Security Hardening` section pointing to `DONE-project-grade-security-hardening.md`. If it is missing in the execution checkout, add it. The release zip still excludes `docs/plans/`; this index is for repository operators, not runtime users.

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
git add .github/workflows/verify-frontend-build.yml .github/workflows/release-latest.yml docs/security/endpoints.md docs/plans/README.md README.md INSTALL.md
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

- [ ] **Step 4: Run explicit security acceptance mapping**

Run:

```bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix tests.test_network_bind_guards tests.test_security_headers tests.test_oauth_route_guards tests.test_pre_db_admin_gates tests.test_backend_route_source_guards tests.test_route_move_preservation tests.test_oauth_jira_client_source_guard
```

Expected:

- `tests.test_endpoint_policy_inventory` verifies every Flask route has exactly one policy and new routes fail without one.
- `tests.test_endpoint_security_matrix` verifies anonymous OAuth-mode requests cannot read app data and dev diagnostics stay closed unless explicitly enabled.
- `tests.test_network_bind_guards` verifies loopback defaults and network-bind safety.
- `tests.test_security_headers` verifies the response header baseline.
- `tests.test_oauth_route_guards` and `tests.test_pre_db_admin_gates` verify central OAuth readiness, missing-scope recovery, admin, and CSRF behavior.
- `tests.test_backend_route_source_guards` and `tests.test_route_move_preservation` verify route extraction did not reintroduce root route ownership or URL/method drift.

- [ ] **Step 5: Review git history and status**

Run:

```bash
git log --oneline -5
git status --short --branch
```

Expected: commits are atomic and the tree has no accidental local artifacts staged.

- [ ] **Step 6: Write handoff summary**

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
- No app-data API returns Jira/Home/user/config data to an anonymous OAuth-mode request; fallback empty OAuth `RequestAuthContext` objects do not count as authenticated sessions.
- Unsafe OAuth/DB requests require both `X-Requested-With: jira-execution-planner` and token-bound CSRF when they write user, shared, or admin state.
- Shared configuration writes require tool admin in OAuth/DB mode.
- Existing app-level route guards in `jira_server.py` are removed or thin delegates to the central guard; no second handwritten OAuth allowlist or shared-config write list remains.
- Dynamic routes, including EPM project issue/rollup routes and Scenario Draft collaboration routes, work through both Flask rule classification and concrete-path compatibility checks.
- `/api/debug-fields`, `/api/tasks-fields`, and `/api/auth/dev/home-graphql-oauth-probe` are unreachable unless explicitly enabled for local loopback development.
- Basic mode and local token stores cannot be exposed on `0.0.0.0` by accident.
- Flask defaults to loopback binding.
- Release zip excludes secrets, caches, tests, plans, node modules, and local generated JSON.
- `install.sh`, `pyproject.toml`, `Makefile`, README, and CI agree on install/test/run commands.
- `GATE-05-home-write-capability.md` remains blocked unless the documented probe prints `PASS home_project_update_supported`.
