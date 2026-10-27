"""Atlassian Home (Goals & Projects) client and normalization helpers."""

from __future__ import annotations

import base64
import concurrent.futures
import hashlib
import html as html_module
import json
import logging
import math
import os
import re
import threading
import time
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.auth.cache_policy import (
    build_jira_home_process_cache_key,
    jira_home_partitioned_process_cache_enabled,
)
from backend.auth.home_credentials import HomeCredential, resolve_home_credential
from backend.auth.jira_auth import AuthError, is_oauth_token_expired, oauth_scope_set
from backend.db.engine import database_storage_enabled

logger = logging.getLogger(__name__)

HOME_GRAPHQL_ENDPOINT = "https://team.atlassian.com/gateway/api/graphql"
# Single audience for the bounded public-read-v1 OAuth contract. The strict client and
# the public probe accept exactly this URL; Basic keeps HOME_GRAPHQL_ENDPOINT above.
HOME_OAUTH_GRAPHQL_ENDPOINT = "https://api.atlassian.com/graphql"
HOME_MAX_RETRY_WAIT_SECONDS = 30
PUBLIC_READ_V1_PROFILE = "public-read-v1"
PUBLIC_READ_V1_PROBE_VERSION = 1
PUBLIC_READ_V1_PASS_REASON = "home_graphql_public_read_v1_supported"
HOME_TIMEOUT_SECONDS = 30
HOME_MAX_RETRIES = 3
HOME_PAGE_SIZE = 50
HOME_UPDATE_PAGE_SIZE = 5
HOME_MAX_PROJECTS_PER_GOAL = 500
HOME_MAX_PROJECT_GOALS_PER_SCOPE = 100

_CLOUD_ID_CACHE: dict[str, str] = {}
_GOAL_BY_KEY_CACHE: dict[str, dict] = {}
_STRICT_GOAL_LOOKUP_CACHE: dict[tuple, tuple[float, dict]] = {}
_STRICT_GOAL_LOOKUP_LOCK = threading.Lock()

PENDING_EPM_STATES = {"PENDING"}
ACTIVE_EPM_STATES = PENDING_EPM_STATES | {"ON_TRACK", "AT_RISK", "OFF_TRACK"}
BACKLOG_EPM_STATES = {"PAUSED", "TODO", "TO_DO"}
ARCHIVED_EPM_STATES = {"COMPLETED", "CANCELLED", "ARCHIVED", "DONE", "RELEASE", "RELEASED"}

MATCH_STATE_HOME_LINKED = "home-linked"
MATCH_STATE_JEP_FALLBACK = "jep-fallback"
MATCH_STATE_METADATA_ONLY = "metadata-only"
AUTH_MODE_ATLASSIAN_OAUTH = "atlassian_oauth"


class HomeAuthenticationError(Exception):
    pass


class HomeGraphQLError(Exception):
    pass


class HomeRateLimitError(Exception):
    pass


HOME_READ_ERROR_CATEGORIES = (
    "invalid_target",
    "invalid_credential",
    "unregistered_operation",
    "auth_rejected",
    "access_denied",
    "rate_limited",
    "http_error",
    "network",
    "invalid_response",
    "graphql_error",
)
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_AUTH_CLASSIFICATIONS = {"UNAUTHORIZED", "FORBIDDEN", "UNAUTHENTICATED", "PERMISSION_DENIED"}


class HomeReadError(Exception):
    """Typed strict-profile failure. Never carries provider messages, bodies or credentials.

    Deliberately not a subclass of the Basic-era errors, so the legacy swallow sites
    (`except HomeGraphQLError ...`) cannot absorb a strict required failure.
    """

    def __init__(self, category, *, status=None, paths=(), retry_after=None, provider_classification=""):
        super().__init__(f"Atlassian Home read failed ({category})")
        self.category = category
        self.status = status
        self.paths = tuple(paths)
        self.retry_after = retry_after
        self.provider_classification = provider_classification


@dataclass(frozen=True)
class HomeGraphQLFailure:
    """One GraphQL error reduced to validated, non-textual metadata."""

    path: tuple | None
    classification: str
    auth: bool


@dataclass(frozen=True)
class HomeGraphQLResult:
    """Strict-profile response: GraphQL `data` plus sanitised `errors`, kept until classified."""

    data: dict
    errors: tuple
    status: int = 200

    def fail(self):
        category = "access_denied" if any(error.auth for error in self.errors) else "graphql_error"
        classification = next((error.classification for error in self.errors if error.classification), "")
        raise HomeReadError(
            category,
            status=self.status,
            paths=tuple(error.path for error in self.errors if error.path),
            provider_classification=classification,
        )

    def raise_for_errors(self):
        if self.errors:
            self.fail()


def _validated_error_path(raw) -> tuple | None:
    if not isinstance(raw, list) or not 0 < len(raw) <= 16:
        return None
    path = []
    for segment in raw:
        if isinstance(segment, bool):
            return None
        if isinstance(segment, int) and 0 <= segment < 100000:
            path.append(segment)
        elif isinstance(segment, str) and _SAFE_NAME.match(segment):
            path.append(segment)
        else:
            return None
    return tuple(path)


def _sanitise_graphql_errors(errors) -> tuple:
    sanitised = []
    for error in errors or []:
        if not isinstance(error, dict):
            sanitised.append(HomeGraphQLFailure(None, "", False))
            continue
        extensions = error.get("extensions") if isinstance(error.get("extensions"), dict) else {}
        classification = ""
        for candidate in (extensions.get("classification"), extensions.get("code")):
            if isinstance(candidate, str) and _SAFE_NAME.match(candidate):
                classification = candidate
                break
        message = str(error.get("message") or "").lower()
        auth = classification.upper() in _AUTH_CLASSIFICATIONS or any(
            marker in message for marker in HOME_GRAPHQL_AUTH_ERROR_MARKERS
        )
        sanitised.append(HomeGraphQLFailure(_validated_error_path(error.get("path")), classification, auth))
    return tuple(sanitised)


def _strict_retry_wait(header_value, attempt: int) -> int:
    """Retry wait for strict clients: invalid values fall back to backoff; all clamped to 1..30 s."""
    wait = float(2 ** attempt)
    try:
        parsed = float(header_value) if header_value not in (None, "") else None
    except (TypeError, ValueError):
        parsed = None
    if parsed is not None and math.isfinite(parsed):
        wait = parsed
    return int(max(1, min(HOME_MAX_RETRY_WAIT_SECONDS, math.ceil(wait))))


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


def _bearer_headers(access_token: str) -> dict:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
        "X-ExperimentalApi": "Townsquare",
    }


class HomeOAuthGraphQLClient:
    """Strict public-read-v1 client: one fixed endpoint, registered read documents only."""

    strict_public_read = True

    def __init__(self, access_token: str, endpoint: str = HOME_OAUTH_GRAPHQL_ENDPOINT):
        # Validate the target and credential shape before any Bearer header exists.
        if not isinstance(endpoint, str) or endpoint != HOME_OAUTH_GRAPHQL_ENDPOINT:
            raise HomeReadError("invalid_target")
        if not isinstance(access_token, str) or not access_token or re.search(r"\s", access_token):
            raise HomeReadError("invalid_credential")
        self.endpoint = HOME_OAUTH_GRAPHQL_ENDPOINT
        self._headers = _bearer_headers(access_token)

    def __repr__(self) -> str:
        return f"HomeOAuthGraphQLClient(endpoint={self.endpoint!r})"

    def execute_operation(self, operation: str, variables: dict | None = None) -> HomeGraphQLResult:
        entry = PUBLIC_READ_V1_REGISTRY.get(operation) if isinstance(operation, str) else None
        if entry is None:
            raise HomeReadError("unregistered_operation")
        return self._post(entry["query"], entry["operationName"], variables)

    def execute(self, query: str, variables: dict | None = None) -> HomeGraphQLResult:
        key = _PUBLIC_DOCUMENT_KEYS.get(query) if isinstance(query, str) else None
        if key is None:
            raise HomeReadError("unregistered_operation")
        return self.execute_operation(key, variables)

    def _post(self, query: str, operation_name: str, variables: dict | None) -> HomeGraphQLResult:
        payload: dict[str, Any] = {"query": query, "operationName": operation_name}
        if variables:
            payload["variables"] = variables
        body = json.dumps(payload).encode("utf-8")
        for attempt in range(HOME_MAX_RETRIES + 1):
            request = Request(self.endpoint, data=body, headers=self._headers, method="POST")
            try:
                with urlopen(request, timeout=HOME_TIMEOUT_SECONDS) as response:
                    status = int(getattr(response, "status", None) or response.getcode())
                    document = json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                if exc.code == 429:
                    wait = _strict_retry_wait(exc.headers.get("Retry-After") if exc.headers else None, attempt)
                    if attempt < HOME_MAX_RETRIES:
                        exc.close()
                        time.sleep(wait)
                        continue
                    exc.close()
                    raise HomeReadError("rate_limited", status=429, retry_after=wait) from None
                category = {401: "auth_rejected", 403: "access_denied"}.get(exc.code, "http_error")
                exc.close()
                raise HomeReadError(category, status=int(exc.code)) from None
            except OSError:
                raise HomeReadError("network") from None
            except ValueError:
                raise HomeReadError("invalid_response", status=200) from None
            if not isinstance(document, dict):
                raise HomeReadError("invalid_response", status=status)
            raw_errors = document.get("errors")
            if raw_errors is not None and not isinstance(raw_errors, list):
                raise HomeReadError("invalid_response", status=status)
            data = document.get("data")
            if data is None and not raw_errors:
                raise HomeReadError("invalid_response", status=status)
            if data is not None and not isinstance(data, dict):
                raise HomeReadError("invalid_response", status=status)
            return HomeGraphQLResult(data or {}, _sanitise_graphql_errors(raw_errors), status)
        raise HomeReadError("rate_limited", status=429, retry_after=HOME_MAX_RETRY_WAIT_SECONDS)

    def execute_paginated(self, query: str, variables: dict, path_to_connection: str) -> list[dict]:
        all_nodes: list[dict] = []
        page_variables = dict(variables)
        page_variables["after"] = None
        while True:
            result = self.execute(query, page_variables)
            result.raise_for_errors()
            connection: Any = result.data
            for key in path_to_connection.split("."):
                connection = connection.get(key) if isinstance(connection, dict) else None
            if not isinstance(connection, dict):
                raise HomeReadError("invalid_response", status=result.status)
            for edge in connection.get("edges", []) or []:
                node = edge.get("node") if isinstance(edge, dict) else None
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


class LeasedHomeOAuthClient(HomeOAuthGraphQLClient):
    """Strict client whose every page passes the snapshot's lease and picks up a rotated or refreshed token."""

    def __init__(self, auth: "HomeReadAuth"):
        self._auth = auth
        super().__init__(auth.access_token())

    def _post(self, query, operation_name, variables):
        self._headers = _bearer_headers(self._auth.access_token())
        return super()._post(query, operation_name, variables)


def build_home_oauth_graphql_client(
    access_token: str, endpoint: str = HOME_OAUTH_GRAPHQL_ENDPOINT
) -> HomeOAuthGraphQLClient:
    """Seam for Tasks 2-3: construct the strict client from the DB-resolved OAuth access token."""
    return HomeOAuthGraphQLClient(access_token, endpoint)


EPM_HOME_READ_SCOPES = (
    "read:goal:goals",
    "read:access:goals",
    "read:project:projects",
    "read:access:projects",
)
HOME_READ_PROFILE_LEGACY = "legacy"
HOME_READ_PROFILE_PUBLIC_READ_V1 = "public-read-v1"
HOME_READ_PROFILE_SCOPE_REQUIRED = "epm-scope-required"
HOME_AUTH_LEASE_SECONDS = 5
GOAL_LOOKUP_CACHE_MAX_ENTRIES = 512
GOAL_LOOKUP_CACHE_TTL_SECONDS = 300


def select_epm_home_read_profile(context, *, view_enabled) -> str:
    """Home OAuth reads only for a DB OAuth actor who enabled the EPM view AND whose provider-confirmed
    grant has every Home read scope. An enabled actor without the full grant gets the fail-closed
    profile (never the API-token path); a disabled actor, Basic and local-store contexts stay legacy."""
    if not view_enabled or getattr(context, "auth_mode", "") != AUTH_MODE_ATLASSIAN_OAUTH:
        return HOME_READ_PROFILE_LEGACY
    connection_id = str(getattr(context, "auth_connection_id", "") or "")
    if not connection_id or connection_id.startswith("local-"):
        return HOME_READ_PROFILE_LEGACY
    if (
        not getattr(context, "granted_scopes_verified", False)
        or not set(EPM_HOME_READ_SCOPES) <= oauth_scope_set(getattr(context, "granted_scopes", ()))
    ):
        return HOME_READ_PROFILE_SCOPE_REQUIRED
    return HOME_READ_PROFILE_PUBLIC_READ_V1


class HomeReadAuth:
    """One request's Home read authority: the validated context, a bounded lease and a warmed index.

    Built once per request (never holds a DB session). `revalidate()` is a forced direct
    check used before cache use and before cache admission; `lease()` re-checks at most
    once per `lease_seconds` for long reads. `revalidate`/`load_session` are injected
    (DB status check and the existing encrypted token loader with its locked refresh), so
    this module has no Flask or server dependency and workers can share the object.
    """

    def __init__(self, profile, context, *, revalidate=None, load_session=None,
                 monotonic=time.monotonic, lease_seconds=HOME_AUTH_LEASE_SECONDS):
        self.profile = profile
        self._context = context
        self._revalidate = revalidate
        self._load_session = load_session
        self._monotonic = monotonic
        self._lease_seconds = lease_seconds
        self._lock = threading.RLock()
        self._validated_at = None
        self._token = None
        self._token_version = None
        self._token_expires = 0
        self.revalidation_count = 0
        self.token_load_count = 0
        self._index_recording: dict | None = None
        self._index: MappingProxyType | None = None

    def __repr__(self) -> str:
        return f"HomeReadAuth(profile={self.profile!r})"

    @property
    def strict(self) -> bool:
        return self.profile in (HOME_READ_PROFILE_PUBLIC_READ_V1, HOME_READ_PROFILE_SCOPE_REQUIRED)

    @property
    def context(self):
        """Context last proven by a direct check; no I/O."""
        return self._context

    def revalidate(self):
        """Forced direct status/authority check; returns the context to use for keys and admission."""
        if not self.strict:
            return self._context
        if self.profile == HOME_READ_PROFILE_SCOPE_REQUIRED:
            raise AuthError("epm_scope_required", "Home read scopes are required.")
        with self._lock:
            current = self._revalidate(self._context)
            self.revalidation_count += 1
            if not set(EPM_HOME_READ_SCOPES) <= oauth_scope_set(current.granted_scopes):
                raise AuthError("epm_scope_required", "Home read scopes are required.")
            self._context = current
            self._validated_at = self._monotonic()
            return current

    def lease(self):
        """Validated context; re-checks only when the five-second lease has lapsed."""
        if not self.strict:
            return self._context
        if self.profile == HOME_READ_PROFILE_SCOPE_REQUIRED:
            raise AuthError("epm_scope_required", "Home read scopes are required.")
        with self._lock:
            if self._validated_at is None or self._monotonic() - self._validated_at >= self._lease_seconds:
                return self.revalidate()
            return self._context

    def cloud_id(self) -> str:
        cloud_id = str(self.lease().cloud_id or "").strip()
        if not cloud_id:
            raise HomeReadError("invalid_target")
        return cloud_id

    def access_token(self) -> str:
        with self._lock:
            context = self.lease()
            if (
                self._token is None
                or self._token_version != context.token_version
                or is_oauth_token_expired({"expires_at": self._token_expires})
            ):
                self._reload_token(context)
            return self._token

    def _reload_token(self, context):
        data = self._load_session(context) or {}
        self.token_load_count += 1
        if str(data.get("db_token_version") or "") != str(context.token_version):
            context = self.revalidate()  # the loader refreshed or rotated the token
        granted = oauth_scope_set(data.get("scope") or "")
        if data.get("scope_provenance") != "provider" or not set(EPM_HOME_READ_SCOPES) <= granted:
            raise AuthError("epm_scope_required", "Home read scopes are required.")
        token = data.get("access_token")
        if not isinstance(token, str) or not token:
            raise AuthError("auth_required", "Atlassian authentication is required.")
        self._token = token
        self._token_expires = int(data.get("expires_at") or 0)
        self._token_version = str(context.token_version)

    def client(self):
        return LeasedHomeOAuthClient(self)

    # -- immutable warmed index (request thread records, then freezes before any worker starts) --
    def begin_index(self) -> None:
        self._index_recording = {}

    def record_home_state(self, scope_key, state) -> None:
        if self._index_recording is not None:
            self._index_recording[scope_key] = {**state, "homeProjects": tuple(state["homeProjects"])}

    def freeze_index(self) -> None:
        recorded, self._index_recording = self._index_recording or {}, None
        self._index = MappingProxyType(recorded)

    def indexed_home_state(self, scope_key):
        state = self._index.get(scope_key) if self._index is not None else None
        if state is None:
            return None
        return {**state, "homeProjects": list(state["homeProjects"]), "cacheHit": True}


def _is_strict_client(client) -> bool:
    return getattr(client, "strict_public_read", False) is True


def _op_query(client, public_key: str, legacy_query: str) -> str:
    """Strict clients send the registered public document; Basic keeps its legacy constant."""
    return PUBLIC_READ_V1_REGISTRY[public_key]["query"] if _is_strict_client(client) else legacy_query


def _execute_data(client, public_key: str, legacy_query: str, variables: dict) -> dict:
    """Run one operation and return its `data`; strict clients reject any GraphQL error."""
    if _is_strict_client(client):
        result = client.execute_operation(public_key, variables)
        result.raise_for_errors()
        return result.data
    return client.execute(legacy_query, variables).get("data") or {}


def _home_basic_credentials() -> tuple[str, str]:
    home_email = os.environ.get("ATLASSIAN_EMAIL") or ""
    home_token = os.environ.get("ATLASSIAN_API_TOKEN") or ""
    if home_email and home_token:
        return home_email, home_token

    if (os.environ.get("JIRA_AUTH_MODE") or "basic").strip().lower() == AUTH_MODE_ATLASSIAN_OAUTH:
        raise RuntimeError(
            "ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN must be set to use Home/Townsquare in OAuth mode"
        )

    email = home_email or os.environ.get("JIRA_EMAIL") or ""
    token = home_token or os.environ.get("JIRA_TOKEN") or ""
    if not email or not token:
        raise RuntimeError(
            "ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (or JIRA_EMAIL/JIRA_TOKEN in basic auth mode) must be set to use the EPM view"
        )
    return email, token


QUERY_GOALS_SEARCH = """
query GoalsSearch($containerId: ID!, $first: Int!, $after: String) {
  goals_search(containerId: $containerId, searchString: "", first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { id key name url } }
  }
}
"""

QUERY_GOAL_BY_KEY = """
query GoalByKey($containerId: ID!, $goalKey: String!) {
  goals_byKey(containerId: $containerId, goalKey: $goalKey) {
    id key name url
  }
}
"""

QUERY_SUB_GOALS = """
query SubGoals($goalId: ID!, $first: Int!, $after: String) {
  goals_byId(goalId: $goalId) {
    subGoals(first: $first, after: $after, archived: false) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id key name url isArchived owner { id accountId name } } }
    }
  }
}
"""

QUERY_GOAL_PROJECTS = """
query GoalProjects($goalId: ID!, $first: Int!, $after: String) {
  goals_byId(goalId: $goalId) {
    projects(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id key name url
          state { label value }
          owner { id accountId name }
          tags @optIn(to: "Townsquare") {
            edges { node { id name url } }
          }
          updates(first: 5) @optIn(to: "Townsquare") {
            edges { node { id url creationDate editDate summary updateType creator { accountId name } } }
          }
        }
      }
    }
  }
}
"""

QUERY_PROJECT_DETAILS = """
query ProjectDetails($projectId: String!) {
  projects_byId(projectId: $projectId) {
    id key name url
    state { label value }
    owner { id accountId name }
  }
}
"""

QUERY_PROJECT_UPDATES = """
query ProjectUpdates($projectId: String!, $first: Int!, $after: String) {
  projects_byId(projectId: $projectId) {
    updates(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id url creationDate editDate summary updateType creator { accountId name } } }
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

# --- public-read-v1: seven read-only documents shared by runtime and probe -------------
# Goal/project `owner` and update `creator` are not selected (they need an identity scope the
# bounded contract does not request); Teamwork Graph/Cypher is not part of the profile.
PUBLIC_QUERY_GOALS_SEARCH = QUERY_GOALS_SEARCH
PUBLIC_QUERY_GOAL_BY_KEY = QUERY_GOAL_BY_KEY
PUBLIC_QUERY_PROJECT_TAGS = QUERY_PROJECT_TAGS

PUBLIC_QUERY_SUB_GOALS = """
query SubGoals($goalId: ID!, $first: Int!, $after: String) {
  goals_byId(goalId: $goalId) {
    subGoals(first: $first, after: $after, archived: false) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id key name url isArchived } }
    }
  }
}
"""

PUBLIC_QUERY_GOAL_PROJECTS = """
query GoalProjects($goalId: ID!, $first: Int!, $after: String) {
  goals_byId(goalId: $goalId) {
    projects(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id key name url
          state { label value }
          tags @optIn(to: "Townsquare") {
            edges { node { id name url } }
          }
          updates(first: 5) @optIn(to: "Townsquare") {
            edges { node { id url creationDate editDate summary updateType } }
          }
        }
      }
    }
  }
}
"""

PUBLIC_QUERY_PROJECT_DETAILS = """
query ProjectDetails($projectId: String!) {
  projects_byId(projectId: $projectId) {
    id key name url
    state { label value }
  }
}
"""

PUBLIC_QUERY_PROJECT_UPDATES = """
query ProjectUpdates($projectId: String!, $first: Int!, $after: String) {
  projects_byId(projectId: $projectId) {
    updates(first: $first, after: $after) @optIn(to: "Townsquare") {
      pageInfo { hasNextPage endCursor }
      edges { node { id url creationDate editDate summary updateType } }
    }
  }
}
"""

PUBLIC_READ_V1_REGISTRY = {
    "goals_search": {"operationName": "GoalsSearch", "query": PUBLIC_QUERY_GOALS_SEARCH},
    "goals_byKey": {"operationName": "GoalByKey", "query": PUBLIC_QUERY_GOAL_BY_KEY},
    "subGoals": {"operationName": "SubGoals", "query": PUBLIC_QUERY_SUB_GOALS},
    "goalProjects": {"operationName": "GoalProjects", "query": PUBLIC_QUERY_GOAL_PROJECTS},
    "projectDetails": {"operationName": "ProjectDetails", "query": PUBLIC_QUERY_PROJECT_DETAILS},
    "projectUpdates": {"operationName": "ProjectUpdates", "query": PUBLIC_QUERY_PROJECT_UPDATES},
    "projectTags": {"operationName": "ProjectTags", "query": PUBLIC_QUERY_PROJECT_TAGS},
}
PUBLIC_READ_V1_OPERATION_KEYS = tuple(PUBLIC_READ_V1_REGISTRY)
# Exact-text allowlist (a dict lookup, not a substring test).
_PUBLIC_DOCUMENT_KEYS = {entry["query"]: key for key, entry in PUBLIC_READ_V1_REGISTRY.items()}

HOME_PROJECT_UPDATE_MUTATION = """
mutation CreateProjectUpdateMutation($projectId: String!, $updateText: String!) {
  projects_createUpdate(
    input: {
      projectId: $projectId
      summary: $updateText
    }
  ) {
    success
    errors {
      message
    }
    update {
      id
      url
      creationDate
      updateType
      summary
    }
  }
}
"""

HOME_PROJECT_UPDATE_ALLOWED_FIELDS = {"updateText", "clientMutationId"}
HOME_WRITE_PROBE_SENSITIVE_KEYS = {
    "email",
    "api_token",
    "apitoken",
    "authorization",
    "access_token",
    "refresh_token",
    "token",
    "headers",
}


HOME_GRAPHQL_FEASIBILITY_OPERATION_NAMES = (
    "goals_search",
    "goal_by_key",
    "sub_goals",
    "goal_projects",
    "project_details",
    "project_updates",
    "project_tags",
    "teamwork_graph_project_tags",
)

HOME_GRAPHQL_AUTH_ERROR_MARKERS = (
    "unauthorized",
    "forbidden",
    "scope does not match",
    "does not contain the right authorisation scopes",
    "does not contain the right authorization scopes",
)

HOME_GRAPHQL_PROBE_SENSITIVE_KEYS = {
    "access_token",
    "refresh_token",
    "authorization",
    "client_secret",
    "code",
    "oauth_code",
    "oauth_pkce_verifier",
    "pkce_verifier",
}


def home_graphql_feasibility_queries() -> dict[str, str]:
    return {
        "goals_search": QUERY_GOALS_SEARCH,
        "goal_by_key": QUERY_GOAL_BY_KEY,
        "sub_goals": QUERY_SUB_GOALS,
        "goal_projects": QUERY_GOAL_PROJECTS,
        "project_details": QUERY_PROJECT_DETAILS,
        "project_updates": QUERY_PROJECT_UPDATES,
        "project_tags": QUERY_PROJECT_TAGS,
        "teamwork_graph_project_tags": QUERY_TEAMWORK_GRAPH_PROJECT_TAGS,
    }


def normalize_home_project_update_payload(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("invalid_home_update_payload")
    unsupported = set(payload) - HOME_PROJECT_UPDATE_ALLOWED_FIELDS
    if unsupported:
        raise ValueError("unsupported_home_update_field")
    update_text = str(payload.get("updateText") or "").strip()
    if not update_text:
        raise ValueError("update_text_required")
    if len(update_text) > 4000:
        raise ValueError("update_text_too_long")
    normalized = {"updateText": update_text}
    client_mutation_id = str(payload.get("clientMutationId") or "").strip()
    if client_mutation_id:
        normalized["clientMutationId"] = client_mutation_id
    return normalized


def _home_update_text_to_adf(update_text: str) -> str:
    return json.dumps(
        {
            "version": 1,
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": update_text}],
                }
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def build_home_project_update_variables(
    project_id: str,
    update_text: str,
    client_mutation_id: str | None = None,
) -> dict:
    normalized = normalize_home_project_update_payload({
        "updateText": update_text,
        "clientMutationId": client_mutation_id or "",
    })
    normalized_project_id = str(project_id or "").strip()
    if not normalized_project_id:
        raise ValueError("project_id_required")
    return {
        "projectId": normalized_project_id,
        "updateText": _home_update_text_to_adf(normalized["updateText"]),
    }


def redact_home_write_probe_payload(payload):
    if isinstance(payload, dict):
        redacted = {}
        for key, value in payload.items():
            if str(key).strip().lower() in HOME_WRITE_PROBE_SENSITIVE_KEYS:
                redacted[key] = "[redacted]"
                continue
            redacted[key] = redact_home_write_probe_payload(value)
        return redacted
    if isinstance(payload, list):
        return [redact_home_write_probe_payload(value) for value in payload]
    if isinstance(payload, str) and (
        "basic " in payload.lower()
        or "bearer " in payload.lower()
    ):
        return "[redacted]"
    return payload


def redact_home_oauth_probe_payload(payload):
    if isinstance(payload, dict):
        redacted = {}
        for key, value in payload.items():
            if str(key).strip().lower() in HOME_GRAPHQL_PROBE_SENSITIVE_KEYS:
                redacted[key] = "[redacted]"
                continue
            redacted[key] = redact_home_oauth_probe_payload(value)
        return redacted
    if isinstance(payload, list):
        return [redact_home_oauth_probe_payload(value) for value in payload]
    if isinstance(payload, str) and "bearer " in payload.lower():
        return "[redacted]"
    return payload


def _home_graphql_probe_error_text(result: dict) -> str:
    try:
        return json.dumps(
            {
                "error": result.get("error"),
                "errors": result.get("errors"),
                "message": result.get("message"),
            },
            default=str,
        ).lower()
    except (TypeError, ValueError):
        return str(result).lower()


def classify_home_graphql_probe_results(results) -> dict:
    rows = [row for row in (results or []) if isinstance(row, dict)]
    for row in rows:
        if row.get("reason") == "insufficient_home_fixture":
            return {"decision": "fail", "reason": "insufficient_home_fixture"}
        try:
            status = int(row.get("status"))
        except (TypeError, ValueError):
            status = 0
        if status in {401, 403}:
            return {"decision": "fail", "reason": "home_graphql_3lo_unsupported"}
        error_text = _home_graphql_probe_error_text(row)
        if any(marker in error_text for marker in HOME_GRAPHQL_AUTH_ERROR_MARKERS):
            return {"decision": "fail", "reason": "home_graphql_3lo_unsupported"}

    required = set(HOME_GRAPHQL_FEASIBILITY_OPERATION_NAMES)
    by_operation = {
        str(row.get("operation")): row
        for row in rows
        if str(row.get("operation")) in required
    }
    if set(by_operation) != required:
        return {"decision": "fail", "reason": "insufficient_home_fixture"}
    for row in by_operation.values():
        if row.get("ok") is not True:
            return {"decision": "fail", "reason": "home_graphql_probe_failed"}
    return {"decision": "pass", "reason": "home_graphql_3lo_supported"}


def _graphql_error_messages(payload: dict) -> list[str]:
    messages: list[str] = []
    errors = payload.get("errors") if isinstance(payload, dict) else []
    for error in errors or []:
        if isinstance(error, dict):
            messages.append(str(error.get("message") or error))
        else:
            messages.append(str(error))
    return messages


def _decode_graphql_probe_body(raw: bytes) -> dict:
    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {"errors": [{"message": "GraphQL probe returned invalid JSON."}]}
    return payload if isinstance(payload, dict) else {"errors": [{"message": "GraphQL probe returned non-object JSON."}]}


def _execute_home_oauth_probe_operation(
    operation: str,
    endpoint: str,
    access_token: str,
    query: str,
    variables: dict,
    endpoint_kind: str,
) -> tuple[dict, dict]:
    payload: dict[str, Any] = {"query": query, "variables": variables or {}}
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
            "X-ExperimentalApi": "Townsquare",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=HOME_TIMEOUT_SECONDS) as response:
            status = int(getattr(response, "status", response.getcode()))
            response_payload = _decode_graphql_probe_body(response.read())
    except HTTPError as exc:
        status = int(exc.code)
        response_payload = _decode_graphql_probe_body(exc.read())
    except OSError as exc:
        return {
            "operation": operation,
            "endpoint": endpoint_kind,
            "status": 0,
            "ok": False,
            "errors": [str(exc)],
        }, {}

    errors = _graphql_error_messages(response_payload)
    result = {
        "operation": operation,
        "endpoint": endpoint_kind,
        "status": status,
        "ok": 200 <= status < 300 and not errors,
    }
    if errors:
        result["errors"] = errors[:3]
    return result, response_payload


def _connection_nodes(connection: dict) -> list[dict]:
    nodes: list[dict] = []
    for edge in (connection or {}).get("edges", []) or []:
        node = edge.get("node") if isinstance(edge, dict) else None
        if isinstance(node, dict):
            nodes.append(node)
    return nodes


def _fixture_probe_result(message: str) -> dict:
    return {
        "operation": "fixture",
        "status": 0,
        "ok": False,
        "reason": "insufficient_home_fixture",
        "message": message,
    }


def _probe_twg_endpoint(jira_url: str) -> str:
    return f"{str(jira_url or '').rstrip('/')}/gateway/api/graphql/twg"


def run_home_graphql_oauth_probe(
    access_token: str,
    cloud_id: str,
    epm_scope: dict | None = None,
    root_goal_key: str = "",
    sub_goal_key: str = "",
    home_project_id: str = "",
    jira_url: str = "",
) -> dict:
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    selected_root_key = _normalize_goal_key(root_goal_key or scope.get("rootGoalKey"))
    selected_sub_goal_key = _normalize_goal_key(sub_goal_key)
    if not selected_sub_goal_key:
        sub_goal_keys = _epm_scope_sub_goal_keys(scope)
        selected_sub_goal_key = sub_goal_keys[0] if sub_goal_keys else ""

    results: list[dict] = []
    if not access_token or not cloud_id:
        results.append(_fixture_probe_result("OAuth access token and cloud ID are required."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}

    container_id = _container_id_from_cloud(cloud_id)
    queries = home_graphql_feasibility_queries()

    result, goals_payload = _execute_home_oauth_probe_operation(
        "goals_search",
        HOME_GRAPHQL_ENDPOINT,
        access_token,
        queries["goals_search"],
        {"containerId": container_id, "first": HOME_PAGE_SIZE, "after": None},
        "home",
    )
    results.append(result)
    if not result.get("ok"):
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    if not selected_root_key:
        results.append(_fixture_probe_result("EPM rootGoalKey is required."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}

    result, root_payload = _execute_home_oauth_probe_operation(
        "goal_by_key",
        HOME_GRAPHQL_ENDPOINT,
        access_token,
        queries["goal_by_key"],
        {"containerId": container_id, "goalKey": selected_root_key},
        "home",
    )
    results.append(result)
    if not result.get("ok"):
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    root_goal = ((root_payload.get("data") or {}).get("goals_byKey") or {})
    root_goal_id = root_goal.get("id")
    if not root_goal_id:
        results.append(_fixture_probe_result("EPM rootGoalKey did not resolve to a Home goal."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}

    result, sub_goals_payload = _execute_home_oauth_probe_operation(
        "sub_goals",
        HOME_GRAPHQL_ENDPOINT,
        access_token,
        queries["sub_goals"],
        {"goalId": root_goal_id, "first": HOME_PAGE_SIZE, "after": None},
        "home",
    )
    results.append(result)
    if not result.get("ok"):
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    if not selected_sub_goal_key:
        results.append(_fixture_probe_result("EPM subGoalKey is required."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    sub_goal_nodes = _connection_nodes((((sub_goals_payload.get("data") or {}).get("goals_byId") or {}).get("subGoals") or {}))
    sub_goal = next((goal for goal in sub_goal_nodes if _normalize_goal_key(goal.get("key")) == selected_sub_goal_key), None)
    if not sub_goal:
        results.append(_fixture_probe_result("EPM subGoalKey did not resolve under the root goal."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}

    result, projects_payload = _execute_home_oauth_probe_operation(
        "goal_projects",
        HOME_GRAPHQL_ENDPOINT,
        access_token,
        queries["goal_projects"],
        {"goalId": sub_goal.get("id"), "first": HOME_PAGE_SIZE, "after": None},
        "home",
    )
    results.append(result)
    if not result.get("ok"):
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    project_nodes = _connection_nodes((((projects_payload.get("data") or {}).get("goals_byId") or {}).get("projects") or {}))
    selected_project_id = str(home_project_id or "").strip()
    project = next((row for row in project_nodes if str(row.get("id") or "").strip() == selected_project_id), None)
    if not project and selected_project_id:
        project = {"id": selected_project_id, "url": ""}
    if not project:
        project = next(iter(project_nodes), None)
    if not project or not project.get("id"):
        results.append(_fixture_probe_result("EPM sub-goal must have at least one Home project."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    selected_project_id = str(project.get("id") or "").strip()

    for operation in ("project_details", "project_updates", "project_tags"):
        variables = {"projectId": selected_project_id}
        if operation == "project_updates":
            variables = {"projectId": selected_project_id, "first": 1, "after": None}
        result, payload = _execute_home_oauth_probe_operation(
            operation,
            HOME_GRAPHQL_ENDPOINT,
            access_token,
            queries[operation],
            variables,
            "home",
        )
        results.append(result)
        if operation == "project_details" and result.get("ok"):
            detailed_project = ((payload.get("data") or {}).get("projects_byId") or {})
            if isinstance(detailed_project, dict):
                project = {**project, **detailed_project}
        if not result.get("ok"):
            decision = classify_home_graphql_probe_results(results)
            return {**decision, "results": redact_home_oauth_probe_payload(results)}

    if not jira_url:
        results.append(_fixture_probe_result("Jira URL is required to build the Teamwork Graph endpoint."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    project_ari = selected_project_id if selected_project_id.startswith("ari:") else f"ari:cloud:townsquare:{cloud_id}:project/{selected_project_id}"
    cypher = _project_tag_cypher(project_ari=project_ari)
    if not cypher:
        results.append(_fixture_probe_result("Home project ID is required for Teamwork Graph tag lookup."))
        decision = classify_home_graphql_probe_results(results)
        return {**decision, "results": redact_home_oauth_probe_payload(results)}
    cypher_query, params = cypher
    result, _ = _execute_home_oauth_probe_operation(
        "teamwork_graph_project_tags",
        _probe_twg_endpoint(jira_url),
        access_token,
        queries["teamwork_graph_project_tags"],
        {"cypherQuery": cypher_query, "params": params},
        "teamwork_graph",
    )
    results.append(result)

    decision = classify_home_graphql_probe_results(results)
    return {**decision, "results": redact_home_oauth_probe_payload(results)}


def contains_probe_secret_material(value) -> bool:
    """True when a probe payload carries credential-shaped keys or Authorization-style values."""
    if isinstance(value, dict):
        return any(
            str(key).strip().lower() in HOME_GRAPHQL_PROBE_SENSITIVE_KEYS or contains_probe_secret_material(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(contains_probe_secret_material(item) for item in value)
    if isinstance(value, str):
        lowered = value.lower()
        return "bearer " in lowered or "basic " in lowered
    return False


_PUBLIC_PROBE_ROW_KEYS = {"operation", "status", "ok", "category"}


def classify_home_public_read_v1_probe(payload) -> dict:
    """Validate a public-read-v1 probe document. A format validator only: never trusts a top-level decision."""

    def fail(reason):
        return {"decision": "fail", "reason": reason}

    if not isinstance(payload, dict) or contains_probe_secret_material(payload):
        return fail("invalid_probe_payload")
    version = payload.get("version")
    if (
        payload.get("profile") != PUBLIC_READ_V1_PROFILE
        or type(version) is not int
        or version != PUBLIC_READ_V1_PROBE_VERSION
    ):
        return fail("invalid_probe_payload")
    rows = payload.get("results")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        return fail("invalid_probe_payload")
    operations = [row.get("operation") for row in rows]
    known = set(PUBLIC_READ_V1_OPERATION_KEYS) | {"fixture"}
    if any(operation not in known for operation in operations) or len(set(operations)) != len(operations):
        return fail("invalid_probe_payload")
    if any(set(row) - _PUBLIC_PROBE_ROW_KEYS for row in rows):
        return fail("invalid_probe_payload")
    if "fixture" in operations:
        return fail("insufficient_home_fixture")
    for row in rows:
        status = row.get("status")
        if type(status) is int and status in {401, 403} or row.get("category") in {"auth_rejected", "access_denied"}:
            return fail("home_graphql_public_read_v1_unsupported")
    for row in rows:
        status = row.get("status")
        if (
            row.get("ok") is not True
            or type(status) is not int
            or not 200 <= status < 300
            or row.get("category") != "ok"
        ):
            return fail("home_graphql_public_read_v1_failed")
    if set(operations) != set(PUBLIC_READ_V1_OPERATION_KEYS):
        return fail("insufficient_home_fixture")
    return {"decision": "pass", "reason": PUBLIC_READ_V1_PASS_REASON}


def _public_probe_fixture_row() -> dict:
    return {"operation": "fixture", "status": 0, "ok": False, "category": "insufficient_home_fixture"}


def _public_probe_operation(client, key: str, variables: dict) -> tuple[dict, HomeGraphQLResult | None]:
    try:
        result = client.execute_operation(key, variables)
    except HomeReadError as exc:
        return {"operation": key, "status": int(exc.status or 0), "ok": False, "category": exc.category}, None
    if result.errors:
        category = "access_denied" if any(error.auth for error in result.errors) else "graphql_error"
        return {"operation": key, "status": result.status, "ok": False, "category": category}, result
    return {"operation": key, "status": result.status, "ok": True, "category": "ok"}, result


def run_home_graphql_public_read_probe(access_token: str, cloud_id: str, epm_scope: dict | None = None) -> dict:
    """Run the seven registered public-read-v1 reads against the fixed OAuth endpoint.

    The private EPM scope (root goal, first selected sub-goal) is the only fixture authority.
    Every row must be error-free: an optional-tag error that runtime tolerates is not a probe PASS.
    """
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    root_key = _normalize_goal_key(scope.get("rootGoalKey"))
    sub_keys = _epm_scope_sub_goal_keys(scope)
    sub_key = sub_keys[0] if sub_keys else ""
    results: list[dict] = []

    def finish() -> dict:
        document = {
            "version": PUBLIC_READ_V1_PROBE_VERSION,
            "profile": PUBLIC_READ_V1_PROFILE,
            "results": results,
        }
        return {**document, **classify_home_public_read_v1_probe(document)}

    def insufficient() -> dict:
        results.append(_public_probe_fixture_row())
        return finish()

    if not cloud_id or not root_key or not sub_key:
        return insufficient()
    try:
        client = build_home_oauth_graphql_client(access_token)
    except HomeReadError:
        return insufficient()

    container_id = _container_id_from_cloud(cloud_id)

    def step(key: str, variables: dict):
        row, result = _public_probe_operation(client, key, variables)
        results.append(row)
        return result if row["ok"] else None

    if step("goals_search", {"containerId": container_id, "first": HOME_PAGE_SIZE, "after": None}) is None:
        return finish()
    found = step("goals_byKey", {"containerId": container_id, "goalKey": root_key})
    if found is None:
        return finish()
    root_goal = found.data.get("goals_byKey") or {}
    if not root_goal.get("id"):
        return insufficient()
    found = step("subGoals", {"goalId": root_goal["id"], "first": HOME_PAGE_SIZE, "after": None})
    if found is None:
        return finish()
    sub_goal = next(
        (
            goal for goal in _connection_nodes(((found.data.get("goals_byId") or {}).get("subGoals") or {}))
            if _normalize_goal_key(goal.get("key")) == sub_key
        ),
        None,
    )
    if not sub_goal or not sub_goal.get("id"):
        return insufficient()
    found = step("goalProjects", {"goalId": sub_goal["id"], "first": HOME_PAGE_SIZE, "after": None})
    if found is None:
        return finish()
    project = next(
        iter(_connection_nodes(((found.data.get("goals_byId") or {}).get("projects") or {}))), None
    )
    project_id = str((project or {}).get("id") or "").strip()
    if not project_id:
        return insufficient()
    for key, variables in (
        ("projectDetails", {"projectId": project_id}),
        ("projectUpdates", {"projectId": project_id, "first": 1, "after": None}),
        ("projectTags", {"projectId": project_id}),
    ):
        if step(key, variables) is None:
            break
    return finish()


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


def adf_to_html(value: Any) -> str:
    """Render Atlassian Document Format content to safe HTML."""
    if not value:
        return ""
    if isinstance(value, dict):
        document = value
    elif isinstance(value, str):
        try:
            document = json.loads(value)
        except (TypeError, ValueError):
            return html_module.escape(value)
    else:
        return html_module.escape(str(value))
    if not isinstance(document, dict) or document.get("content") is None:
        return html_module.escape(value if isinstance(value, str) else str(value))
    return _render_adf_html_nodes(document.get("content", []))


def _safe_adf_href(value: Any) -> str:
    href = str(value or "").strip()
    if re.match(r"^(https?://|mailto:)", href, re.IGNORECASE):
        return href
    return ""


def _adf_node_attrs(node: Any) -> dict:
    if not isinstance(node, dict):
        return {}
    attrs = node.get("attrs")
    return attrs if isinstance(attrs, dict) else {}


def _adf_node_content(node: Any) -> list:
    if not isinstance(node, dict):
        return []
    content = node.get("content")
    return content if isinstance(content, list) else []


def _render_adf_html_nodes(nodes: list) -> str:
    if not isinstance(nodes, list):
        return ""
    parts: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = node.get("type", "")
        content = _adf_node_content(node)
        attrs = _adf_node_attrs(node)
        if node_type == "text":
            text = html_module.escape(str(node.get("text", "")))
            marks = node.get("marks", [])
            if not isinstance(marks, list):
                marks = []
            for mark in marks:
                if not isinstance(mark, dict):
                    continue
                mark_type = mark.get("type", "")
                if mark_type == "strong":
                    text = f"<strong>{text}</strong>"
                elif mark_type == "em":
                    text = f"<em>{text}</em>"
            for mark in marks:
                if not isinstance(mark, dict) or mark.get("type") != "link":
                    continue
                href = _safe_adf_href(_adf_node_attrs(mark).get("href"))
                if href:
                    safe_href = html_module.escape(href, quote=True)
                    text = f'<a href="{safe_href}" target="_blank" rel="noopener noreferrer">{text}</a>'
                break
            parts.append(text)
            continue
        if node_type in {"inlineCard", "blockCard"}:
            href = _safe_adf_href(attrs.get("url"))
            if href:
                safe_href = html_module.escape(href, quote=True)
                safe_label = html_module.escape(href)
                parts.append(
                    f'<a href="{safe_href}" target="_blank" rel="noopener noreferrer">{safe_label}</a>'
                )
            continue
        if node_type == "paragraph":
            inner = _render_adf_html_nodes(content)
            if inner:
                parts.append(f"<p>{inner}</p>")
            continue
        if node_type == "heading":
            inner = _render_adf_html_nodes(content)
            if inner:
                level = attrs.get("level")
                tag = f"h{level}" if type(level) is int and 1 <= level <= 6 else "p"
                parts.append(f"<{tag}>{inner}</{tag}>")
            continue
        if node_type == "table":
            rows = [
                child for child in content
                if isinstance(child, dict) and child.get("type") == "tableRow"
            ]
            inner = _render_adf_html_nodes(rows)
            if inner:
                parts.append(
                    '<div class="adf-table-scroll" role="region" '
                    'aria-label="Description table" tabindex="0">'
                    f"<table><tbody>{inner}</tbody></table></div>"
                )
            continue
        if node_type == "tableRow":
            cells = [
                child for child in content
                if isinstance(child, dict) and child.get("type") in {"tableHeader", "tableCell"}
            ]
            if cells:
                parts.append(f"<tr>{_render_adf_html_nodes(cells)}</tr>")
            continue
        if node_type in {"tableHeader", "tableCell"}:
            tag = "th" if node_type == "tableHeader" else "td"
            scope = ' scope="col"' if tag == "th" else ""
            inner = _render_adf_html_nodes(content)
            parts.append(f"<{tag}{scope}>{inner}</{tag}>")
            continue
        if node_type == "hardBreak":
            parts.append("<br>")
            continue
        if node_type in {"bulletList", "orderedList"}:
            tag = "ul" if node_type == "bulletList" else "ol"
            items = _render_adf_html_nodes(content)
            if items:
                parts.append(f"<{tag}>{items}</{tag}>")
            continue
        if node_type == "listItem":
            inner = _render_adf_html_nodes(content)
            inner = re.sub(r"^<p>(.*)</p>$", r"\1", inner)
            if inner:
                parts.append(f"<li>{inner}</li>")
            continue
        if content:
            parts.append(_render_adf_html_nodes(content))
    return "".join(parts)


def extract_project_status(project_data: dict) -> str:
    state = project_data.get("state") or project_data.get("status")
    if isinstance(state, dict):
        return state.get("value") or state.get("label") or state.get("status") or "UNKNOWN"
    if isinstance(state, str):
        return state
    return "UNKNOWN"


def _normalize_epm_state_value(state_value):
    normalized = re.sub(r"[^A-Z0-9]+", "_", str(state_value or "").strip().upper()).strip("_")
    return normalized


def is_pending_epm_state(state_value):
    return _normalize_epm_state_value(state_value) in PENDING_EPM_STATES


def bucket_epm_state(state_value):
    normalized = _normalize_epm_state_value(state_value)
    if normalized in ACTIVE_EPM_STATES:
        return "active"
    if normalized in BACKLOG_EPM_STATES:
        return "backlog"
    if normalized in ARCHIVED_EPM_STATES:
        return "archived"
    return ""


def extract_latest_update(updates):
    candidates = []
    for row in updates or []:
        if not row.get("creationDate"):
            continue
        snippet = adf_to_text(row.get("summary")).strip()
        html = adf_to_html(row.get("summary")).strip()
        if not snippet and not html:
            continue
        candidates.append((row, snippet, html))
    ordered = sorted(candidates, key=lambda item: item[0]["creationDate"], reverse=True)
    if not ordered:
        return {"date": "", "snippet": "", "author": ""}
    latest, snippet, html = ordered[0]
    creator = latest.get("creator") if isinstance(latest.get("creator"), dict) else {}
    return {
        "date": str(latest["creationDate"])[:10],
        "snippet": snippet,
        "html": html,
        "author": str(creator.get("name") or "").strip(),
        "url": str(latest.get("url") or "").strip(),
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


def normalize_project_tag_names(values: Any) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        normalized = name.strip()
        if not normalized:
            return
        dedupe_key = normalized.lower()
        if dedupe_key in seen:
            return
        seen.add(dedupe_key)
        names.append(normalized)

    if isinstance(values, list):
        for value in values:
            if isinstance(value, str):
                add(value)
            else:
                for name in extract_tag_names(value):
                    add(name)
        return names

    for name in extract_tag_names(values):
        add(name)
    return names


def _require_home_credential_descriptor(credential: HomeCredential | None) -> None:
    if credential is None and database_storage_enabled():
        raise RuntimeError("Home credential descriptor is required in DB mode")


def _read_metadata_credential(context=None) -> HomeCredential | None:
    if context is None or not database_storage_enabled():
        return None
    return resolve_home_credential(context, "read_metadata")


def build_teamwork_graph_client(credential: HomeCredential | None = None) -> HomeGraphQLClient:
    _require_home_credential_descriptor(credential)
    if credential is not None:
        email, token = credential.email, credential.api_token
        jira_url = str(credential.site_url or "").rstrip("/")
    else:
        email, token = _home_basic_credentials()
        jira_url = get_configured_jira_url()
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


def _project_ari_candidates(project: dict, context=None) -> list[str]:
    project_id = str((project or {}).get("id") or "").strip()
    if not project_id:
        return []
    if project_id.startswith("ari:"):
        return [project_id]
    candidates: list[str] = []
    try:
        cloud_id = fetch_home_site_cloud_id(context=context) if context is not None else fetch_home_site_cloud_id()
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


def _fetch_project_tags_strict(client, project_id: str) -> list[str] | None:
    """public-read-v1 tags: direct Home read only. None means optional tags are unavailable."""
    result = client.execute_operation("projectTags", {"projectId": project_id})
    project = result.data.get("projects_byId")
    if result.errors:
        confined = isinstance(project, dict) and all(
            not error.auth and error.path is not None and len(error.path) >= 2
            and error.path[:2] == ("projects_byId", "tags")
            for error in result.errors
        )
        if not confined:
            result.fail()
        return None
    if not isinstance(project, dict):
        raise HomeReadError("invalid_response", status=result.status)
    return extract_tag_names(project.get("tags"))


def fetch_project_tags(client: HomeGraphQLClient, project: dict, context=None) -> list[str] | None:
    project_id = str((project or {}).get("id") or "").strip()
    if not project_id:
        return []
    if _is_strict_client(client):
        return _fetch_project_tags_strict(client, project_id)
    direct_tags: list[str] | None = None
    try:
        response = client.execute(QUERY_PROJECT_TAGS, {"projectId": project_id})
        direct_tags = _extract_project_tags_from_home_response(response)
        if direct_tags:
            return direct_tags
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Direct Home project tag fetch failed for %s: %s", project_id, exc)

    try:
        credential = _read_metadata_credential(context)
        teamwork_graph_client = (
            build_teamwork_graph_client(credential)
            if credential is not None
            else build_teamwork_graph_client()
        )
        for project_ari in _project_ari_candidates(project, context=context):
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
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError, AuthError) as exc:
        logger.warning("Teamwork Graph project tag fetch failed for %s: %s", project_id, exc)
        return direct_tags if direct_tags is not None else None
    return direct_tags if direct_tags is not None else []


def build_home_project_record(project, updates, linkage, home_tags=None, tags_unavailable=False):
    latest = extract_latest_update(updates)
    resolved_labels = sorted(set((linkage or {}).get("labels") or []))
    resolved_epics = sorted(set((linkage or {}).get("epicKeys") or []))
    match_state = MATCH_STATE_HOME_LINKED if (resolved_labels or resolved_epics) else MATCH_STATE_METADATA_ONLY
    state_value = project.get("stateValue") or project.get("status") or ""
    state_label = project.get("stateLabel", "")
    tab_bucket = bucket_epm_state(state_value) or bucket_epm_state(state_label)
    owner = _extract_project_owner(project)
    icon = _extract_project_icon(project)
    target_date = _extract_project_target_date(project)
    return {
        "homeProjectId": project["id"],
        "name": project.get("name", ""),
        "homeUrl": project.get("url", ""),
        "stateValue": state_value,
        "stateLabel": state_label,
        "iconEmoji": icon["emoji"],
        "iconUrl": icon["url"],
        "targetDate": target_date["value"],
        "targetDateLabel": target_date["label"],
        "targetDateStart": target_date["start"],
        "targetDateEnd": target_date["end"],
        "ownerAccountId": owner["accountId"],
        "ownerName": owner["name"],
        "ownerAvatarUrl": owner["avatarUrl"],
        "tabBucket": tab_bucket,
        "latestUpdateDate": latest["date"],
        "latestUpdateSnippet": latest["snippet"],
        "latestUpdateHtml": latest.get("html", ""),
        "latestUpdateAuthor": latest.get("author", ""),
        "latestUpdateUrl": latest.get("url", ""),
        "homeTags": normalize_project_tag_names(home_tags or []),
        "homeTagsUnavailable": bool(tags_unavailable),
        "resolvedLinkage": {"labels": resolved_labels, "epicKeys": resolved_epics},
        "matchState": match_state,
    }


def _shape_project_detail(project_id: str, payload: dict) -> dict:
    state = payload.get("state") or {}
    return {
        "id": payload.get("id", project_id),
        "key": payload.get("key", ""),
        "name": payload.get("name", ""),
        "url": payload.get("url", ""),
        "stateValue": extract_project_status(payload),
        "stateLabel": state.get("label", "") if isinstance(state, dict) else "",
        "icon": payload.get("icon"),
        "iconEmoji": payload.get("iconEmoji") or payload.get("emoji"),
        "iconUrl": payload.get("iconUrl"),
        "targetDate": payload.get("targetDate") or payload.get("dueDate"),
        "targetDateLabel": payload.get("targetDateLabel"),
        "owner": payload.get("owner") or {},
    }


def _first_project_text(*values) -> str:
    for value in values:
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
    return ""


def _extract_project_owner(project: dict) -> dict:
    owner = project.get("owner") if isinstance(project, dict) else {}
    owner = owner if isinstance(owner, dict) else {}
    return {
        "accountId": _first_project_text(owner.get("accountId"), owner.get("id"), project.get("ownerAccountId")),
        "name": _first_project_text(owner.get("name"), owner.get("displayName"), project.get("ownerName")),
        "avatarUrl": _first_project_text(owner.get("avatarUrl"), owner.get("picture"), project.get("ownerAvatarUrl")),
    }


def _extract_project_icon(project: dict) -> dict:
    icon = project.get("icon") if isinstance(project, dict) else {}
    icon = icon if isinstance(icon, dict) else {}
    return {
        "emoji": _first_project_text(project.get("iconEmoji"), project.get("emoji"), icon.get("emoji"), icon.get("text")),
        "url": _first_project_text(project.get("iconUrl"), icon.get("url")),
    }


def _extract_project_target_date(project: dict) -> dict:
    target = project.get("targetDate") if isinstance(project, dict) else None
    if isinstance(target, dict):
        start = _first_project_text(target.get("startDate"), target.get("start"))
        end = _first_project_text(target.get("endDate"), target.get("end"), target.get("date"), target.get("value"))
        label = _first_project_text(
            project.get("targetDateLabel"),
            target.get("label"),
            target.get("text"),
            target.get("display"),
            target.get("displayValue"),
        )
        value = _first_project_text(target.get("value"), target.get("date"), start, end)
        return {"label": label, "value": value, "start": start, "end": end}
    value = _first_project_text(target, project.get("dueDate"))
    label = _first_project_text(project.get("targetDateLabel"), value)
    return {"label": label, "value": value, "start": "", "end": ""}


def build_home_graphql_client(credential: HomeCredential | None = None) -> HomeGraphQLClient:
    _require_home_credential_descriptor(credential)
    if credential is not None:
        email, token = credential.email, credential.api_token
    else:
        email, token = _home_basic_credentials()
    return HomeGraphQLClient(email, token, HOME_GRAPHQL_ENDPOINT)


def _container_id_from_cloud(cloud_id: str) -> str:
    return f"ari:cloud:townsquare::site/{cloud_id}"


def get_configured_jira_url(context=None) -> str:
    if context is not None and getattr(context, "site_url", ""):
        return str(context.site_url).rstrip("/")
    return str(os.environ.get("JIRA_URL") or "").rstrip("/")


def fetch_home_site_cloud_id(context=None, home_auth=None) -> str:
    if home_auth is not None and home_auth.strict:
        return home_auth.cloud_id()  # context cloud id; no tenant_info HTTP, no cache entry
    jira_url = get_configured_jira_url(context)
    if not jira_url:
        raise RuntimeError("JIRA_URL must be set to detect the Atlassian site cloud ID")
    cache_enabled = jira_home_partitioned_process_cache_enabled(context)
    cache_key = build_jira_home_process_cache_key(context, jira_url)
    if cache_enabled and cache_key in _CLOUD_ID_CACHE:
        return _CLOUD_ID_CACHE[cache_key]
    request = Request(f"{jira_url}/_edge/tenant_info", headers={"Accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=HOME_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, ValueError, OSError) as exc:
        raise RuntimeError("Failed to detect Atlassian site cloud ID") from exc
    cloud_id = str(payload.get("cloudId") or "").strip()
    if not cloud_id:
        raise RuntimeError("Jira tenant_info did not return cloudId")
    if cache_enabled:
        _CLOUD_ID_CACHE[cache_key] = cloud_id
    return cloud_id


def _normalize_goal_key(goal_key: str) -> str:
    return str(goal_key or "").strip().upper()


def _goal_cache_key(container_id: str, goal_key: str) -> str:
    return json.dumps({
        "containerId": str(container_id or "").strip(),
        "goalKey": _normalize_goal_key(goal_key),
    }, sort_keys=True)


def _strict_goal_lookup_get(cache_key):
    with _STRICT_GOAL_LOOKUP_LOCK:
        entry = _STRICT_GOAL_LOOKUP_CACHE.get(cache_key)
        if entry is None:
            return None
        if entry[0] <= time.time():
            _STRICT_GOAL_LOOKUP_CACHE.pop(cache_key, None)
            return None
        return dict(entry[1])


def _strict_goal_lookup_put(cache_key, goal):
    """Bounded public-read goal cache: 512 entries, 300 s TTL; the key keeps its identity/version partition.

    When full, expired entries go first, then the oldest entries of the inserting
    partition, and only an empty partition falls back to the globally oldest entry,
    so one user's lookups cannot flush another partition while it has its own to give up.
    """
    now = time.time()
    partition = cache_key[:-1]
    with _STRICT_GOAL_LOOKUP_LOCK:
        _STRICT_GOAL_LOOKUP_CACHE.pop(cache_key, None)
        for key in [key for key, entry in _STRICT_GOAL_LOOKUP_CACHE.items() if entry[0] <= now]:
            del _STRICT_GOAL_LOOKUP_CACHE[key]
        while len(_STRICT_GOAL_LOOKUP_CACHE) >= GOAL_LOOKUP_CACHE_MAX_ENTRIES:
            victim = next(
                (key for key in _STRICT_GOAL_LOOKUP_CACHE if key[:-1] == partition),
                next(iter(_STRICT_GOAL_LOOKUP_CACHE)),
            )
            del _STRICT_GOAL_LOOKUP_CACHE[victim]
        _STRICT_GOAL_LOOKUP_CACHE[cache_key] = (now + GOAL_LOOKUP_CACHE_TTL_SECONDS, dict(goal))


def resolve_goal_by_key(client: HomeGraphQLClient, goal_key: str, container_id: str, context=None) -> dict | None:
    expected_key = _normalize_goal_key(goal_key)
    if not expected_key:
        return None
    cache_key = _goal_cache_key(container_id, expected_key)
    cache_enabled = jira_home_partitioned_process_cache_enabled(context)
    cache_key = build_jira_home_process_cache_key(context, cache_key)
    strict = _is_strict_client(client)
    if strict:
        # Only identity/version-partitioned (tuple) keys are ever cached for the public profile.
        cache_enabled = cache_enabled and isinstance(cache_key, tuple)
        cached = _strict_goal_lookup_get(cache_key) if cache_enabled else None
    else:
        cached = _GOAL_BY_KEY_CACHE.get(cache_key) if cache_enabled else None
    if cache_enabled and cached:
        return dict(cached)

    def remember(goal_value):
        if not cache_enabled:
            return
        if strict:
            _strict_goal_lookup_put(cache_key, goal_value)
        else:
            _GOAL_BY_KEY_CACHE[cache_key] = dict(goal_value)
    try:
        if _is_strict_client(client):
            data = _execute_data(client, "goals_byKey", QUERY_GOAL_BY_KEY, {"containerId": container_id, "goalKey": expected_key})
            goal = data.get("goals_byKey") or {}
        else:
            response = client.execute(
                QUERY_GOAL_BY_KEY,
                {"containerId": container_id, "goalKey": expected_key},
            )
            goal = ((response.get("data") or {}).get("goals_byKey") or {})
        if goal and _normalize_goal_key(goal.get("key")) == expected_key:
            remember(goal)
            return goal
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Goal by key lookup failed for %s: %s", expected_key, exc)

    try:
        goals = client.execute_paginated(
            _op_query(client, "goals_search", QUERY_GOALS_SEARCH),
            {"containerId": container_id, "first": HOME_PAGE_SIZE},
            "goals_search",
        )
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Goal search failed: %s", exc)
        return None
    for goal in goals:
        if _normalize_goal_key(goal.get("key")) == expected_key:
            remember(goal)
            return goal
    logger.warning("Goal %s not found among %d goals", goal_key, len(goals))
    return None


def fetch_sub_goals(client: HomeGraphQLClient, root_goal_id: str) -> list[dict]:
    try:
        nodes = client.execute_paginated(
            _op_query(client, "subGoals", QUERY_SUB_GOALS),
            {"goalId": root_goal_id, "first": HOME_PAGE_SIZE},
            "goals_byId.subGoals",
        )
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Sub-goal fetch failed: %s", exc)
        return []
    return [goal for goal in nodes if not goal.get("isArchived")]


def fetch_sub_goals_for_root_key(client: HomeGraphQLClient, root_goal_key: str, container_id: str, context=None) -> list[dict]:
    root_goal = (
        resolve_goal_by_key(client, root_goal_key, container_id, context=context)
        if context is not None
        else resolve_goal_by_key(client, root_goal_key, container_id)
    )
    if not root_goal:
        return []
    return fetch_sub_goals(client, root_goal["id"])


def _epm_scope_sub_goal_keys(scope: dict) -> list[str]:
    values = scope.get("subGoalKeys") if isinstance(scope, dict) else []
    raw_values = values if isinstance(values, list) else []
    if not raw_values:
        raw_sub_goal_key = scope.get("subGoalKey") if isinstance(scope, dict) else ""
        raw_values = [raw_sub_goal_key] if isinstance(raw_sub_goal_key, str) and raw_sub_goal_key else []
    normalized = []
    seen = set()
    for value in raw_values:
        if not isinstance(value, str):
            continue
        key = _normalize_goal_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def resolve_sub_goals_for_scope(client: HomeGraphQLClient, epm_scope: dict, container_id: str, context=None) -> list[dict]:
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    sub_goal_keys = _epm_scope_sub_goal_keys(scope)
    if not sub_goal_keys:
        return []
    root_goal_key = _normalize_goal_key(scope.get("rootGoalKey"))
    if root_goal_key:
        child_goals = (
            fetch_sub_goals_for_root_key(client, root_goal_key, container_id, context=context)
            if context is not None
            else fetch_sub_goals_for_root_key(client, root_goal_key, container_id)
        )
        goals_by_key = {_normalize_goal_key(goal.get("key")): goal for goal in child_goals}
        resolved = []
        for key in sub_goal_keys:
            goal = goals_by_key.get(key)
            if goal:
                resolved.append(goal)
            else:
                logger.warning("Sub-goal %s not found under root %s", key, root_goal_key)
        return resolved
    resolved = []
    for key in sub_goal_keys:
        goal = (
            resolve_goal_by_key(client, key, container_id, context=context)
            if context is not None
            else resolve_goal_by_key(client, key, container_id)
        )
        if goal:
            resolved.append(goal)
    return resolved


def resolve_sub_goal_for_scope(client: HomeGraphQLClient, epm_scope: dict, container_id: str, context=None) -> dict | None:
    goals = (
        resolve_sub_goals_for_scope(client, epm_scope, container_id, context=context)
        if context is not None
        else resolve_sub_goals_for_scope(client, epm_scope, container_id)
    )
    return goals[0] if goals else None


def _valid_goal_project_core(node) -> bool:
    return (
        isinstance(node, dict)
        and isinstance(node.get("id"), str)
        and bool(node["id"].strip())
        and isinstance(node.get("state"), dict)
    )


def _apply_confined_tag_errors(result: HomeGraphQLResult, edges: list) -> None:
    """Keep partial goalProjects data only for non-auth errors under edges[i].node.tags."""
    for error in result.errors:
        path = error.path
        if (
            error.auth
            or path is None
            or len(path) < 6
            or path[:3] != ("goals_byId", "projects", "edges")
            or type(path[3]) is not int
            or path[4] != "node"
            or path[5] != "tags"
            or path[3] >= len(edges)
            or not isinstance(edges[path[3]], dict)
            or not _valid_goal_project_core(edges[path[3]].get("node"))
        ):
            result.fail()
    for error in result.errors:
        node = edges[error.path[3]]["node"]
        node["tags"] = None
        node["_tagsUnavailable"] = True


def _fetch_goal_project_links_strict(client, goal_id: str) -> list[dict]:
    projects: list[dict] = []
    after = None
    while len(projects) < HOME_MAX_PROJECTS_PER_GOAL:
        result = client.execute_operation(
            "goalProjects", {"goalId": goal_id, "first": HOME_PAGE_SIZE, "after": after}
        )
        goal = result.data.get("goals_byId")
        connection = goal.get("projects") if isinstance(goal, dict) else None
        if not isinstance(connection, dict) or not isinstance(connection.get("pageInfo"), dict):
            if result.errors:
                result.fail()  # a denied or throttled goal reads as null data plus errors: keep the real category
            raise HomeReadError("invalid_response", status=result.status)
        edges = connection.get("edges")
        edges = edges if isinstance(edges, list) else []
        if result.errors:
            _apply_confined_tag_errors(result, edges)
        for edge in edges:
            node = edge.get("node") if isinstance(edge, dict) else None
            if not _valid_goal_project_core(node) or not _has_enriched_goal_project_fields(node):
                raise HomeReadError("invalid_response", status=result.status)
            projects.append(node)
            if len(projects) >= HOME_MAX_PROJECTS_PER_GOAL:
                break
        page_info = connection["pageInfo"]
        has_next_page = page_info.get("hasNextPage")
        if len(projects) >= HOME_MAX_PROJECTS_PER_GOAL:
            if has_next_page:
                logger.warning(
                    "Home goal %s project list truncated at %d projects.", goal_id, HOME_MAX_PROJECTS_PER_GOAL
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


def fetch_goal_project_links(client: HomeGraphQLClient, goal_id: str) -> list[dict]:
    if _is_strict_client(client):
        return _fetch_goal_project_links_strict(client, goal_id)
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


def _fetch_home_project_record(client: HomeGraphQLClient, row: dict, context=None) -> dict | None:
    project_id = row.get("id")
    if not project_id:
        return None
    try:
        detail = _execute_data(client, "projectDetails", QUERY_PROJECT_DETAILS, {"projectId": project_id})
        payload = detail.get("projects_byId") or {}
        project = _shape_project_detail(project_id, payload)
        updates = fetch_latest_project_update(client, project_id)
        home_tags = fetch_project_tags(client, project, context=context)
        linkage = extract_home_jira_linkage(project)
        return build_home_project_record(project, updates, linkage, home_tags, tags_unavailable=home_tags is None)
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Project detail fetch failed for %s: %s", project_id, exc)
        return None


def _extract_project_updates(row: dict) -> list[dict]:
    connection = row.get("updates") or {}
    return _connection_nodes(connection)


def _has_enriched_goal_project_fields(row: dict) -> bool:
    return isinstance(row, dict) and all(key in row for key in ("state", "tags", "updates"))


def _build_home_project_record_from_goal_row(row: dict) -> dict | None:
    project_id = row.get("id")
    if not project_id:
        return None
    project = _shape_project_detail(project_id, row)
    updates = _extract_project_updates(row)
    home_tags = normalize_project_tag_names(row.get("tags"))
    linkage = extract_home_jira_linkage(project)
    return build_home_project_record(
        project, updates, linkage, home_tags, tags_unavailable=bool(row.get("_tagsUnavailable"))
    )


def _fetch_or_build_home_project_record(client: HomeGraphQLClient, row: dict, context=None) -> dict | None:
    if _has_enriched_goal_project_fields(row):
        return _build_home_project_record_from_goal_row(row)
    if _is_strict_client(client):
        # public-read-v1 reads project core/tags/updates in the goalProjects page; no per-project fan-out.
        raise HomeReadError("invalid_response")
    return _fetch_home_project_record(client, row, context=context)


def fetch_projects_for_goal(client: HomeGraphQLClient, goal_id: str, context=None) -> list[dict]:
    try:
        linked_projects = fetch_goal_project_links(client, goal_id)
    except (HomeGraphQLError, HomeRateLimitError, HomeAuthenticationError, KeyError, RuntimeError) as exc:
        logger.warning("Goal project list fetch failed: %s", exc)
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        if context is not None:
            records = executor.map(lambda row: _fetch_or_build_home_project_record(client, row, context=context), linked_projects)
        else:
            records = executor.map(lambda row: _fetch_or_build_home_project_record(client, row), linked_projects)
    return [record for record in records if record is not None]


def fetch_project_goals_for_sub_goal(client: HomeGraphQLClient, sub_goal: dict) -> list[dict]:
    project_goals: list[dict] = []
    queue: list[dict] = [sub_goal]
    seen_goal_ids: set[str] = set()
    while queue and len(project_goals) < HOME_MAX_PROJECT_GOALS_PER_SCOPE:
        goal = queue.pop(0)
        goal_id = str((goal or {}).get("id") or "").strip()
        if not goal_id or goal_id in seen_goal_ids:
            continue
        seen_goal_ids.add(goal_id)
        project_goals.append(goal)
        for child_goal in fetch_sub_goals(client, goal_id):
            child_goal_id = str((child_goal or {}).get("id") or "").strip()
            if child_goal_id and child_goal_id not in seen_goal_ids:
                queue.append(child_goal)
    if queue:
        logger.warning(
            "Home project-goal traversal for %s truncated at %d goals.",
            _normalize_goal_key((sub_goal or {}).get("key")) or str((sub_goal or {}).get("id") or "").strip(),
            HOME_MAX_PROJECT_GOALS_PER_SCOPE,
        )
    return project_goals


def fetch_latest_project_update(client: HomeGraphQLClient, project_id: str) -> list[dict]:
    try:
        data = _execute_data(
            client,
            "projectUpdates",
            QUERY_PROJECT_UPDATES,
            {"projectId": project_id, "first": HOME_UPDATE_PAGE_SIZE},
        )
        connection = ((data.get("projects_byId") or {}).get("updates") or {})
        return _connection_nodes(connection)
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


def fetch_epm_home_projects(epm_scope, context=None, home_auth=None):
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    sub_goal_keys = _epm_scope_sub_goal_keys(scope)
    if not sub_goal_keys:
        logger.warning("EPM home fetch skipped: subGoalKeys is required")
        return []

    if home_auth is not None and home_auth.strict:
        # public-read-v1: typed failures (HomeReadError, AuthError) propagate; never an empty list.
        client = home_auth.client()
        cloud_id = home_auth.cloud_id()
        context = home_auth.context
    else:
        try:
            credential = _read_metadata_credential(context)
            client = build_home_graphql_client(credential) if credential is not None else build_home_graphql_client()
            if credential is not None and credential.cloud_id:
                cloud_id = credential.cloud_id
            elif context is not None:
                cloud_id = fetch_home_site_cloud_id(context=context)
            else:
                cloud_id = fetch_home_site_cloud_id()
        except RuntimeError as exc:
            logger.warning("EPM home fetch failed: %s", exc)
            return []

    container_id = _container_id_from_cloud(cloud_id)
    sub_goals = (
        resolve_sub_goals_for_scope(client, scope, container_id, context=context)
        if context is not None
        else resolve_sub_goals_for_scope(client, scope, container_id)
    )
    if not sub_goals:
        return []

    seen_project_ids: set[str] = set()
    projects_by_id: dict[str, dict] = {}
    result: list[dict] = []
    for sub_goal in sub_goals:
        sub_goal_key = _normalize_goal_key(sub_goal.get("key"))
        sub_goal_record = {
            "key": sub_goal_key,
            "name": str(sub_goal.get("name") or "").strip(),
        }
        for project_goal in fetch_project_goals_for_sub_goal(client, sub_goal):
            projects = (
                fetch_projects_for_goal(client, project_goal["id"], context=context)
                if context is not None
                else fetch_projects_for_goal(client, project_goal["id"])
            )
            for home_project in projects:
                project_id = home_project.get("homeProjectId") or home_project.get("id")
                if not project_id:
                    continue
                if project_id in seen_project_ids:
                    existing = projects_by_id.get(project_id)
                    if existing is not None and sub_goal_key not in existing.get("subGoalKeys", []):
                        existing.setdefault("subGoalKeys", []).append(sub_goal_key)
                        existing.setdefault("subGoals", []).append(sub_goal_record)
                    continue
                seen_project_ids.add(project_id)
                shaped_project = dict(home_project)
                shaped_project["subGoalKeys"] = [sub_goal_key]
                shaped_project["subGoals"] = [sub_goal_record]
                projects_by_id[project_id] = shaped_project
                result.append(shaped_project)
    return result
