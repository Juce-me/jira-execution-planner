"""Atlassian Home (Goals & Projects) client and normalization helpers."""

from __future__ import annotations

import base64
import concurrent.futures
import json
import logging
import os
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

HOME_GRAPHQL_ENDPOINT = "https://team.atlassian.com/gateway/api/graphql"
HOME_TIMEOUT_SECONDS = 30
HOME_MAX_RETRIES = 3
HOME_PAGE_SIZE = 50
HOME_MAX_PROJECTS_PER_GOAL = 200

_CLOUD_ID_CACHE: dict[str, str] = {}

ACTIVE_EPM_STATES = {"ON_TRACK", "AT_RISK", "OFF_TRACK"}
BACKLOG_EPM_STATES = {"PENDING", "PAUSED"}
ARCHIVED_EPM_STATES = {"COMPLETED", "CANCELLED", "ARCHIVED"}

MATCH_STATE_HOME_LINKED = "home-linked"
MATCH_STATE_JEP_FALLBACK = "jep-fallback"
MATCH_STATE_METADATA_ONLY = "metadata-only"


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
            try:
                request = Request(
                    self.endpoint,
                    data=json.dumps(payload).encode("utf-8"),
                    headers=self.headers,
                    method="POST",
                )
                with urlopen(request, timeout=HOME_TIMEOUT_SECONDS) as response:
                    data = json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                if exc.code == 401:
                    raise HomeAuthenticationError(
                        "Atlassian Home authentication failed; check ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN."
                    ) from exc
                if exc.code == 429 and attempt < HOME_MAX_RETRIES:
                    wait = 2 ** attempt
                    wait_value = exc.headers.get("Retry-After")
                    try:
                        wait = int(wait_value) if wait_value else wait
                    except (TypeError, ValueError):
                        wait = wait
                    time.sleep(wait)
                    continue
                if exc.code == 429:
                    raise HomeRateLimitError("Atlassian Home rate-limited after retries.") from exc
                raise HomeGraphQLError(f"Atlassian Home request failed: {exc}") from exc
            except OSError as exc:
                raise HomeGraphQLError(f"Atlassian Home request failed: {exc}") from exc
            except ValueError as exc:
                raise HomeGraphQLError("Atlassian Home returned invalid JSON.") from exc
            errors = data.get("errors") or []
            if errors:
                messages = "; ".join(str(error.get("message", error)) for error in errors)
                raise HomeGraphQLError(f"GraphQL errors: {messages}")
            return data
        raise HomeRateLimitError("Atlassian Home retries exhausted.")

    def execute_paginated(self, query: str, variables: dict, path_to_connection: str) -> list[dict]:
        all_nodes: list[dict] = []
        page_variables = dict(variables)
        page_variables["after"] = None
        while True:
            response = self.execute(query, page_variables)
            connection: Any = response.get("data", {})
            for key in path_to_connection.split("."):
                if not isinstance(connection, dict):
                    connection = {}
                    break
                connection = connection.get(key, {})
            if not isinstance(connection, dict):
                return all_nodes
            for edge in connection.get("edges", []) or []:
                node = edge.get("node")
                if node is not None:
                    all_nodes.append(node)
            page_info = connection.get("pageInfo", {}) or {}
            if page_info.get("hasNextPage"):
                next_cursor = page_info.get("endCursor")
                if not next_cursor or next_cursor == page_variables.get("after"):
                    logger.warning("Pagination stopped for %s because the cursor did not advance.", path_to_connection)
                    return all_nodes
                page_variables["after"] = next_cursor
                continue
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

QUERY_PROJECT_TAGS = """
query ProjectTags($projectId: String!) {
  projects_byId(projectId: $projectId) {
    tags @optIn(to: "Townsquare") {
      edges { node { id name url } }
    }
  }
}
"""

QUERY_TEAMWORK_GRAPH_PROJECT_TAGS = """
query EpmProjectTags($cypherQuery: String!, $params: CypherRequestParams) {
  cypherQuery(query: $cypherQuery, params: $params) {
    edges {
      node {
        columns {
          value {
            __typename
            ... on CypherQueryResultNode {
              id
              data {
                __typename
                ... on AtlassianHomeTag {
                  id
                  name
                  url
                }
              }
            }
            ... on CypherQueryResultListNode {
              nodes {
                id
                data {
                  __typename
                  ... on AtlassianHomeTag {
                    id
                    name
                    url
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
"""


def adf_to_text(value: Any) -> str:
    """Flatten Atlassian Document Format content to plain text."""
    if not value:
        return ""
    if isinstance(value, dict) and value.get("content"):
        return _extract_text_from_adf_nodes(value.get("content", []))
    if not isinstance(value, str):
        return str(value)
    try:
        document = json.loads(value)
    except (TypeError, ValueError):
        return value
    if isinstance(document, dict) and document.get("content") is not None:
        return _extract_text_from_adf_nodes(document.get("content", []))
    return value


def _extract_text_from_adf_nodes(nodes: list) -> str:
    parts: list[str] = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        node_type = node.get("type", "")
        if node_type == "text":
            parts.append(str(node.get("text", "")))
            continue
        if node_type in {"paragraph", "heading", "bulletList", "orderedList"}:
            content = node.get("content", [])
            text = _extract_text_from_adf_nodes(content)
            if text:
                parts.append(text)
            continue
        if node.get("content"):
            text = _extract_text_from_adf_nodes(node.get("content", []))
            if text:
                parts.append(text)
    return " ".join(part.strip() for part in parts if part and part.strip())


def extract_project_status(project_data: dict) -> str:
    state = project_data.get("state") or project_data.get("status")
    if isinstance(state, dict):
        return state.get("value") or state.get("label") or state.get("status") or "UNKNOWN"
    if isinstance(state, str):
        return state
    return "UNKNOWN"


def bucket_epm_state(state_value):
    normalized = str(state_value or "").strip().upper()
    if normalized in ACTIVE_EPM_STATES:
        return "active"
    if normalized in BACKLOG_EPM_STATES:
        return "backlog"
    if normalized in ARCHIVED_EPM_STATES:
        return "archived"
    return "backlog"


def extract_latest_update(updates):
    ordered = sorted(
        [row for row in (updates or []) if row.get("creationDate")],
        key=lambda row: row["creationDate"],
        reverse=True,
    )
    if not ordered:
        return {"date": "", "snippet": ""}
    latest = ordered[0]
    return {
        "date": str(latest["creationDate"])[:10],
        "snippet": adf_to_text(latest.get("summary")).strip(),
    }


def _extract_tag_name(value: Any) -> str:
    if isinstance(value, str):
        return ""
    if not isinstance(value, dict):
        return ""
    if isinstance(value.get("name"), str):
        return value.get("name", "").strip()
    for key in ("node", "data"):
        nested = value.get(key)
        if isinstance(nested, dict):
            nested_name = _extract_tag_name(nested)
            if nested_name:
                return nested_name
    return ""


def extract_tag_names(values: Any) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def visit(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if isinstance(value, dict):
            name = _extract_tag_name(value)
            if name:
                dedupe_key = name.lower()
                if dedupe_key not in seen:
                    seen.add(dedupe_key)
                    names.append(name)
                return
            if "edges" in value:
                visit(value.get("edges"))
                return
            if "node" in value:
                visit(value.get("node"))
                return
            if "nodes" in value:
                visit(value.get("nodes"))
                return
            if "columns" in value:
                visit(value.get("columns"))
                return
            if "value" in value:
                visit(value.get("value"))
                return

    visit(values)
    return names


def build_teamwork_graph_client() -> HomeGraphQLClient:
    email = os.environ.get("ATLASSIAN_EMAIL") or os.environ.get("JIRA_EMAIL") or ""
    token = os.environ.get("ATLASSIAN_API_TOKEN") or os.environ.get("JIRA_TOKEN") or ""
    if not email or not token:
        raise RuntimeError(
            "ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (or JIRA_EMAIL/JIRA_TOKEN) must be set to use the EPM view"
        )
    jira_url = ""
    try:
        import jira_server

        jira_url = str(getattr(jira_server, "JIRA_URL", "") or "").rstrip("/")
    except Exception:
        jira_url = ""
    if not jira_url:
        jira_url = str(os.environ.get("JIRA_URL") or "").rstrip("/")
    if not jira_url:
        raise RuntimeError("JIRA_URL must be set to query Atlassian project tags")
    return HomeGraphQLClient(email, token, f"{jira_url}/gateway/api/graphql/twg")


def _project_tag_cypher(project_ari: str | None = None, project_url: str | None = None) -> tuple[str, dict] | None:
    if project_ari:
        return (
            "MATCH (project:AtlassianProject {ari: $id})-[:atlassian_project_has_atlassian_home_tag]->(tag:AtlassianHomeTag) RETURN tag",
            {"id": project_ari},
        )
    if project_url:
        return (
            "MATCH (project:AtlassianProject {url: $url})-[:atlassian_project_has_atlassian_home_tag]->(tag:AtlassianHomeTag) RETURN tag",
            {"url": project_url},
        )
    return None


def _project_ari_candidates(project: dict) -> list[str]:
    project_id = str((project or {}).get("id") or "").strip()
    if not project_id:
        return []
    if project_id.startswith("ari:"):
        return [project_id]
    candidates: list[str] = []
    try:
        cloud_id = fetch_home_site_cloud_id()
    except RuntimeError:
        cloud_id = ""
    if cloud_id:
        candidates.append(f"ari:cloud:townsquare:{cloud_id}:project/{project_id}")
    candidates.append(f"ari:cloud:townsquare::project/{project_id}")
    return candidates


def _extract_project_tags_from_home_response(response: dict) -> list[str]:
    project = ((response.get("data") or {}).get("projects_byId") or {})
    return extract_tag_names(project.get("tags"))


def _extract_project_tags_from_twg_response(response: dict) -> list[str]:
    connection = ((response.get("data") or {}).get("cypherQuery") or {})
    return extract_tag_names(connection.get("edges"))


def fetch_project_tags(client: HomeGraphQLClient, project: dict) -> list[str] | None:
    project_id = str((project or {}).get("id") or "").strip()
    if not project_id:
        return []
    direct_tags: list[str] | None = None
    try:
        response = client.execute(QUERY_PROJECT_TAGS, {"projectId": project_id})
        direct_tags = _extract_project_tags_from_home_response(response)
        if direct_tags:
            return direct_tags
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Direct Home project tag fetch failed for %s: %s", project_id, exc)

    try:
        teamwork_graph_client = build_teamwork_graph_client()
        for project_ari in _project_ari_candidates(project):
            cypher = _project_tag_cypher(project_ari=project_ari)
            if not cypher:
                continue
            query, params = cypher
            response = teamwork_graph_client.execute(
                QUERY_TEAMWORK_GRAPH_PROJECT_TAGS,
                {"cypherQuery": query, "params": params},
            )
            tags = _extract_project_tags_from_twg_response(response)
            if tags:
                return tags
        project_url = str((project or {}).get("url") or "").strip()
        cypher = _project_tag_cypher(project_url=project_url)
        if cypher:
            query, params = cypher
            response = teamwork_graph_client.execute(
                QUERY_TEAMWORK_GRAPH_PROJECT_TAGS,
                {"cypherQuery": query, "params": params},
            )
            return _extract_project_tags_from_twg_response(response)
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Teamwork Graph project tag fetch failed for %s: %s", project_id, exc)
        return direct_tags if direct_tags is not None else None
    return direct_tags if direct_tags is not None else []


def build_home_project_record(project, updates, linkage, home_tags=None, tags_unavailable=False):
    latest = extract_latest_update(updates)
    resolved_labels = sorted(set((linkage or {}).get("labels") or []))
    resolved_epics = sorted(set((linkage or {}).get("epicKeys") or []))
    match_state = MATCH_STATE_HOME_LINKED if (resolved_labels or resolved_epics) else MATCH_STATE_METADATA_ONLY
    state_value = project.get("stateValue") or project.get("status") or ""
    return {
        "homeProjectId": project["id"],
        "name": project.get("name", ""),
        "homeUrl": project.get("url", ""),
        "stateValue": state_value,
        "stateLabel": project.get("stateLabel", ""),
        "tabBucket": bucket_epm_state(state_value),
        "latestUpdateDate": latest["date"],
        "latestUpdateSnippet": latest["snippet"],
        "homeTags": extract_tag_names(home_tags or []),
        "homeTagsUnavailable": bool(tags_unavailable),
        "resolvedLinkage": {"labels": resolved_labels, "epicKeys": resolved_epics},
        "matchState": match_state,
    }


def build_home_graphql_client() -> HomeGraphQLClient:
    email = os.environ.get("ATLASSIAN_EMAIL") or os.environ.get("JIRA_EMAIL") or ""
    token = os.environ.get("ATLASSIAN_API_TOKEN") or os.environ.get("JIRA_TOKEN") or ""
    if not email or not token:
        raise RuntimeError(
            "ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (or JIRA_EMAIL/JIRA_TOKEN) must be set to use the EPM view"
        )
    return HomeGraphQLClient(email, token, HOME_GRAPHQL_ENDPOINT)


def _container_id_from_cloud(cloud_id: str) -> str:
    return f"ari:cloud:townsquare::site/{cloud_id}"


def fetch_home_site_cloud_id() -> str:
    jira_url = ""
    try:
        import jira_server  # local import avoids circular import at module load time

        jira_url = str(getattr(jira_server, "JIRA_URL", "") or "").rstrip("/")
    except Exception:
        jira_url = ""
    if not jira_url:
        jira_url = str(os.environ.get("JIRA_URL") or "").rstrip("/")
    if not jira_url:
        raise RuntimeError("JIRA_URL must be set to detect the Atlassian site cloud ID")
    if jira_url in _CLOUD_ID_CACHE:
        return _CLOUD_ID_CACHE[jira_url]
    request = Request(f"{jira_url}/_edge/tenant_info", headers={"Accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=HOME_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, ValueError, OSError) as exc:
        raise RuntimeError("Failed to detect Atlassian site cloud ID") from exc
    cloud_id = str(payload.get("cloudId") or "").strip()
    if not cloud_id:
        raise RuntimeError("Jira tenant_info did not return cloudId")
    _CLOUD_ID_CACHE[jira_url] = cloud_id
    return cloud_id


def _normalize_goal_key(goal_key: str) -> str:
    return str(goal_key or "").strip().upper()


def resolve_goal_by_key(client: HomeGraphQLClient, goal_key: str, container_id: str) -> dict | None:
    try:
        goals = client.execute_paginated(
            QUERY_GOALS_SEARCH,
            {"containerId": container_id, "first": HOME_PAGE_SIZE},
            "goals_search",
        )
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Goal search failed: %s", exc)
        return None
    expected_key = _normalize_goal_key(goal_key)
    for goal in goals:
        if _normalize_goal_key(goal.get("key")) == expected_key:
            return goal
    logger.warning("Goal %s not found among %d goals", goal_key, len(goals))
    return None


def fetch_sub_goals(client: HomeGraphQLClient, root_goal_id: str) -> list[dict]:
    try:
        nodes = client.execute_paginated(
            QUERY_SUB_GOALS,
            {"goalId": root_goal_id, "first": HOME_PAGE_SIZE},
            "goals_byId.subGoals",
        )
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Sub-goal fetch failed: %s", exc)
        return []
    return [goal for goal in nodes if not goal.get("isArchived")]


def fetch_sub_goals_for_root_key(client: HomeGraphQLClient, root_goal_key: str, container_id: str) -> list[dict]:
    root_goal = resolve_goal_by_key(client, root_goal_key, container_id)
    if not root_goal:
        return []
    return fetch_sub_goals(client, root_goal["id"])


def resolve_sub_goal_for_scope(client: HomeGraphQLClient, epm_scope: dict, container_id: str) -> dict | None:
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    raw_sub_goal_key = scope.get("subGoalKey")
    sub_goal_key = raw_sub_goal_key.strip().upper() if isinstance(raw_sub_goal_key, str) else ""
    if not sub_goal_key:
        return None
    raw_root_goal_key = scope.get("rootGoalKey")
    root_goal_key = raw_root_goal_key.strip().upper() if isinstance(raw_root_goal_key, str) else ""
    if root_goal_key:
        for goal in fetch_sub_goals_for_root_key(client, root_goal_key, container_id):
            if _normalize_goal_key(goal.get("key")) == sub_goal_key:
                return goal
        logger.warning("Sub-goal %s not found under root %s", sub_goal_key, root_goal_key)
        return None
    return resolve_goal_by_key(client, sub_goal_key, container_id)


def fetch_goal_project_links(client: HomeGraphQLClient, goal_id: str) -> list[dict]:
    projects: list[dict] = []
    after = None
    while len(projects) < HOME_MAX_PROJECTS_PER_GOAL:
        response = client.execute(
            QUERY_GOAL_PROJECTS,
            {"goalId": goal_id, "first": HOME_PAGE_SIZE, "after": after},
        )
        connection = (((response.get("data") or {}).get("goals_byId") or {}).get("projects") or {})
        for edge in connection.get("edges", []) or []:
            node = edge.get("node")
            if node is not None:
                projects.append(node)
                if len(projects) >= HOME_MAX_PROJECTS_PER_GOAL:
                    break
        page_info = connection.get("pageInfo", {}) or {}
        has_next_page = page_info.get("hasNextPage")
        if len(projects) >= HOME_MAX_PROJECTS_PER_GOAL:
            if has_next_page:
                logger.warning(
                    "Home goal %s project list truncated at %d projects.",
                    goal_id,
                    HOME_MAX_PROJECTS_PER_GOAL,
                )
            return projects
        if not has_next_page:
            return projects
        next_cursor = page_info.get("endCursor")
        if not next_cursor or next_cursor == after:
            logger.warning("Pagination stopped for goals_byId.projects because the cursor did not advance.")
            return projects
        after = next_cursor
    return projects


def _fetch_home_project_record(client: HomeGraphQLClient, row: dict) -> dict | None:
    project_id = row.get("id")
    if not project_id:
        return None
    try:
        detail = client.execute(QUERY_PROJECT_DETAILS, {"projectId": project_id})
        payload = (detail.get("data") or {}).get("projects_byId") or {}
        state = payload.get("state") or {}
        project = {
            "id": payload.get("id", project_id),
            "key": payload.get("key", ""),
            "name": payload.get("name", ""),
            "url": payload.get("url", ""),
            "stateValue": extract_project_status(payload),
            "stateLabel": state.get("label", "") if isinstance(state, dict) else "",
        }
        updates = fetch_latest_project_update(client, project_id)
        home_tags = fetch_project_tags(client, project)
        linkage = extract_home_jira_linkage(project)
        return build_home_project_record(project, updates, linkage, home_tags, tags_unavailable=home_tags is None)
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Project detail fetch failed for %s: %s", project_id, exc)
        return None


def fetch_projects_for_goal(client: HomeGraphQLClient, goal_id: str) -> list[dict]:
    try:
        linked_projects = fetch_goal_project_links(client, goal_id)
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Goal project list fetch failed: %s", exc)
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        records = executor.map(lambda row: _fetch_home_project_record(client, row), linked_projects)
    return [record for record in records if record is not None]


def fetch_latest_project_update(client: HomeGraphQLClient, project_id: str) -> list[dict]:
    try:
        response = client.execute(
            QUERY_PROJECT_UPDATES,
            {"projectId": project_id, "first": 1},
        )
        connection = (((response.get("data") or {}).get("projects_byId") or {}).get("updates") or {})
        edge = next(iter(connection.get("edges", []) or []), None)
        node = edge.get("node") if isinstance(edge, dict) else None
        return [node] if node is not None else []
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Latest update fetch failed for %s: %s", project_id, exc)
        return []


def extract_home_jira_linkage(_raw_project):
    """TownsquareProject has no Jira linkage fields in v1."""
    return {"labels": [], "epicKeys": []}


def merge_epm_linkage(home_project, epm_config_row):
    home_linkage = home_project.get("resolvedLinkage") or {}
    home_labels = list(home_linkage.get("labels") or [])
    home_epics = list(home_linkage.get("epicKeys") or [])
    config_label = str((epm_config_row or {}).get("jiraLabel") or "").strip()
    config_epic = str((epm_config_row or {}).get("jiraEpicKey") or "").strip().upper()
    labels = sorted(set(home_labels + ([config_label] if config_label else [])))
    epic_keys = sorted(set(home_epics + ([config_epic] if config_epic else [])))
    if labels or epic_keys:
        match_state = MATCH_STATE_HOME_LINKED if (home_labels or home_epics) else MATCH_STATE_JEP_FALLBACK
    else:
        match_state = MATCH_STATE_METADATA_ONLY
    return {"labels": labels, "epicKeys": epic_keys}, match_state


def fetch_epm_home_projects(epm_scope):
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    raw_sub_goal_key = scope.get("subGoalKey")
    sub_goal_key = raw_sub_goal_key.strip().upper() if isinstance(raw_sub_goal_key, str) else ""
    if not sub_goal_key:
        logger.warning("EPM home fetch skipped: subGoalKey is required")
        return []

    try:
        client = build_home_graphql_client()
        cloud_id = fetch_home_site_cloud_id()
    except RuntimeError as exc:
        logger.warning("EPM home fetch failed: %s", exc)
        return []

    container_id = _container_id_from_cloud(cloud_id)
    sub_goal = resolve_sub_goal_for_scope(client, scope, container_id)
    if not sub_goal:
        return []

    seen_project_ids: set[str] = set()
    result: list[dict] = []
    for home_project in fetch_projects_for_goal(client, sub_goal["id"]):
        project_id = home_project.get("homeProjectId") or home_project.get("id")
        if not project_id or project_id in seen_project_ids:
            continue
        seen_project_ids.add(project_id)
        result.append(home_project)
    return result
