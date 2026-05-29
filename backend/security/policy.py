import re
from dataclasses import dataclass


UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
PUBLIC_METHODS = frozenset({"GET"})


def _dynamic_rule_regex(rule):
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
    methods: frozenset
    policy_class: str
    match: str = "exact"
    exclude_paths: tuple = ()

    def matches_rule(self, rule, method, endpoint=""):
        if any(rule == excluded or rule.startswith(excluded) for excluded in self.exclude_paths):
            return False
        if self.match == "exact" and rule != self.path:
            return False
        if self.match == "prefix" and not rule.startswith(self.path):
            return False
        if self.match == "dynamic" and rule != self.path:
            return False
        return method in self.methods

    def matches_path(self, path, method):
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
    EndpointPolicy("epm-project-issues", "/api/epm/projects/<path:home_project_id>/issues", PUBLIC_METHODS, "authenticated_read", "dynamic"),
    EndpointPolicy("epm-project-rollup", "/api/epm/projects/<path:project_id>/rollup", PUBLIC_METHODS, "authenticated_read", "dynamic"),
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


def matching_policies(rule, methods, endpoint=""):
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


def classify_rule(rule, methods, endpoint=""):
    policies = matching_policies(rule, methods, endpoint)
    return policies[0] if len(policies) == 1 else None


def matching_path_policies(path, method):
    return [policy for policy in ENDPOINT_POLICIES if policy.matches_path(path, method)]


def classify_request_rule(rule, method, endpoint=""):
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


def is_oauth_ready_api_path(path):
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
