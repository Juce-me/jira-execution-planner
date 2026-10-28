"""EPM Home access classification for `GET /api/epm/access`.

One bounded decision per auth/config partition: at most one fixed Home goal read, cached for at most
`ACCESS_DECISION_TTL_SECONDS` and only for the confirmed categories (available/empty/denied). A transient
failure is reported as `unavailable` and never cached or turned into a denial. Disabled and scope-missing
users never reach Home.
"""

from __future__ import annotations

import threading
import time

from backend.auth.cache_policy import build_jira_home_process_cache_key, jira_home_partitioned_process_cache_enabled
from backend.auth.jira_auth import AUTH_MODE_BASIC, AuthError
from backend.epm import home as epm_home

ACCESS_DECISION_TTL_SECONDS = 30
ACCESS_CACHE_MAX_ENTRIES = 256
STATE_AVAILABLE = "available"
STATE_DISABLED = "disabled"
STATE_SCOPE_MISSING = "scope_missing"
STATE_EMPTY = "empty"
STATE_DENIED = "denied"
STATE_UNAVAILABLE = "unavailable"
CACHEABLE_STATES = {STATE_AVAILABLE, STATE_EMPTY, STATE_DENIED}
SCOPE_LOGIN_URL = "/login?reason=missing_scope"
_MESSAGES = {
    STATE_DISABLED: "EPM view is turned off in Settings.",
    STATE_SCOPE_MISSING: "Atlassian Home read permission is needed for the EPM view.",
    STATE_EMPTY: "No accessible Atlassian Home goal was found for the configured EPM scope.",
    STATE_DENIED: "Atlassian Home did not grant access to the configured EPM scope.",
    STATE_UNAVAILABLE: "Atlassian Home could not be checked right now.",
}

_ACCESS_CACHE: dict = {}
_ACCESS_LOCK = threading.Lock()


def clear_access_cache():
    with _ACCESS_LOCK:
        _ACCESS_CACHE.clear()


def _decision(state, *, available, login_url=False):
    body = {"state": state, "epmHomeReadAvailable": bool(available)}
    if login_url:
        body["loginUrl"] = SCOPE_LOGIN_URL
    if state in _MESSAGES:
        body["message"] = _MESSAGES[state]
    return body


def _cache_get(key, now):
    with _ACCESS_LOCK:
        entry = _ACCESS_CACHE.get(key)
        if entry is None:
            return None
        if entry[0] <= now:
            _ACCESS_CACHE.pop(key, None)
            return None
        return dict(entry[1])


def _cache_put(key, body, now):
    with _ACCESS_LOCK:
        for stale in [k for k, entry in _ACCESS_CACHE.items() if entry[0] <= now]:
            del _ACCESS_CACHE[stale]
        while len(_ACCESS_CACHE) >= ACCESS_CACHE_MAX_ENTRIES:
            del _ACCESS_CACHE[next(iter(_ACCESS_CACHE))]
        _ACCESS_CACHE[key] = (now + ACCESS_DECISION_TTL_SECONDS, dict(body))


def _probe_goal(client, container_id, root_goal_key, context):
    """The one fixed Home goal read. Returns STATE_AVAILABLE or STATE_EMPTY."""
    if root_goal_key:
        result = client.execute_operation("goals_byKey", {"containerId": container_id, "goalKey": root_goal_key})
        result.raise_for_errors()
        goal = (result.data or {}).get("goals_byKey")
        if isinstance(goal, dict) and epm_home._normalize_goal_key(goal.get("key")) == root_goal_key:
            epm_home.remember_strict_goal(goal, container_id, root_goal_key, context)  # reused by the metadata warm
            return STATE_AVAILABLE
        return STATE_EMPTY
    result = client.execute_operation("goals_search", {"containerId": container_id, "first": 1})
    result.raise_for_errors()
    connection = (result.data or {}).get("goals_search")
    if not isinstance(connection, dict):
        raise epm_home.HomeReadError("invalid_response", status=result.status)
    has_goal = any(isinstance(edge, dict) and edge.get("node") for edge in connection.get("edges") or [])
    return STATE_AVAILABLE if has_goal else STATE_EMPTY


def resolve_epm_access(context, home_auth, *, root_goal_key, config_generation, refresh=False, now=None):
    """Return the response body for the access endpoint. Raises AuthError only for real base auth loss."""
    if getattr(context, "auth_mode", AUTH_MODE_BASIC) == AUTH_MODE_BASIC:
        # Basic/JSON compatibility: today's EPM availability, no new Home I/O, no readiness claim.
        return _decision(STATE_AVAILABLE, available=False)
    if home_auth.profile == epm_home.HOME_READ_PROFILE_LEGACY:  # flag off, or a non-DB OAuth context
        return _decision(STATE_DISABLED, available=False)
    if home_auth.profile == epm_home.HOME_READ_PROFILE_SCOPE_REQUIRED:
        return _decision(STATE_SCOPE_MISSING, available=False, login_url=True)

    try:
        current = home_auth.revalidate()  # forced direct check before any cache use
    except AuthError as error:
        if error.code == "epm_scope_required":
            return _decision(STATE_SCOPE_MISSING, available=False, login_url=True)
        raise
    cloud_id = str(getattr(current, "cloud_id", "") or "").strip()
    if not cloud_id:
        return _decision(STATE_UNAVAILABLE, available=True)
    root = epm_home._normalize_goal_key(root_goal_key)
    cache_enabled = jira_home_partitioned_process_cache_enabled(current)
    key = build_jira_home_process_cache_key(current, "epm-access", cloud_id, root, config_generation)
    moment = (now or time.time)()
    if cache_enabled and not refresh:
        cached = _cache_get(key, moment)
        if cached is not None:
            return cached

    try:
        state = _probe_goal(home_auth.client(), epm_home._container_id_from_cloud(cloud_id), root, current)
    except AuthError as error:
        if error.code == "epm_scope_required":
            return _decision(STATE_SCOPE_MISSING, available=False, login_url=True)
        raise
    except epm_home.HomeReadError as error:
        if error.category == "access_denied":
            state = STATE_DENIED
        else:
            if error.category == "auth_rejected":
                try:
                    home_auth.recheck_after_rejection()
                except AuthError as auth_error:
                    if auth_error.code == "epm_scope_required":
                        return _decision(STATE_SCOPE_MISSING, available=False, login_url=True)
                    raise
            return _decision(STATE_UNAVAILABLE, available=True)
    body = _decision(state, available=True)
    if cache_enabled and state in CACHEABLE_STATES:
        # Admission keyed by the context proven at admission time (rejects when authority failed).
        admitted = home_auth.revalidate()
        _cache_put(build_jira_home_process_cache_key(admitted, "epm-access", cloud_id, root, config_generation), body, moment)
    return body
