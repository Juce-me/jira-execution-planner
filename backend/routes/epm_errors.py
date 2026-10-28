"""OAuth error mapping for the EPM routes.

Maps typed Home/Jira/auth failures to responses without leaking provider text. Only a real base auth
loss uses the app's terminal 401 shapes (through the guard's own formatter); missing Home scopes and
Home/Jira resource failures are feature errors that never manufacture a 401.
"""

from __future__ import annotations

import logging

from flask import jsonify

from backend.auth.jira_auth import AuthError
from backend.epm import home as epm_home
from backend.epm import jira_strict
from backend.epm.access import SCOPE_LOGIN_URL
from backend.security.guards import format_auth_error_response

logger = logging.getLogger(__name__)

HOME_RETRY_AFTER_MIN_SECONDS = 1
_MESSAGES = {
    "epm_scope_required": "Atlassian Home read permission is needed for the EPM view.",
    "epm_view_disabled": "Enable the EPM view in your settings to load EPM Home data.",
    "home_access_denied": "Atlassian Home did not grant access to this EPM data.",
    "home_read_failed": "Atlassian Home data could not be read.",
    "home_rate_limited": "Atlassian Home is rate limiting requests. Try again shortly.",
    jira_strict.JIRA_ACCESS_DENIED: "Jira did not grant access to this EPM data.",
    jira_strict.JIRA_READ_FAILED: "Jira data could not be read.",
    jira_strict.JIRA_RATE_LIMITED: "Jira is rate limiting requests. Try again shortly.",
}


def _clamped_retry_after(value):
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        seconds = HOME_RETRY_AFTER_MIN_SECONDS
    return max(HOME_RETRY_AFTER_MIN_SECONDS, min(epm_home.HOME_MAX_RETRY_WAIT_SECONDS, seconds))


def _feature_error(code, status, *, retry_after=None, login_url=False):
    payload = {"error": code, "message": _MESSAGES[code]}
    if login_url:
        payload["loginUrl"] = SCOPE_LOGIN_URL
    response = jsonify(payload if retry_after is None else {**payload, "retryAfterSeconds": retry_after})
    if retry_after is not None:
        response.headers["Retry-After"] = str(retry_after)
    return response, status


def epm_scope_required_response():
    return _feature_error("epm_scope_required", 409, login_url=True)


def epm_view_disabled_response():
    return _feature_error("epm_view_disabled", 409)


def auth_error_to_response(server, error):
    """A real base auth loss keeps the guard's own code/status/URL; Home-scope absence is feature-level."""
    if error.code == "epm_scope_required":
        return epm_scope_required_response()
    if error.code == "epm_view_disabled":
        return epm_view_disabled_response()
    return format_auth_error_response(server, error)


def home_read_error_to_response(server, error, home_auth=None):
    """Map a strict Home failure. A raw provider 401 is revalidated once: only proven loss is a base 401."""
    category = error.category
    if category == "auth_rejected":
        try:
            if home_auth is not None:
                home_auth.recheck_after_rejection()
        except AuthError as auth_error:
            return auth_error_to_response(server, auth_error)
        return _feature_error("home_read_failed", 502)
    if category == "access_denied":
        return _feature_error("home_access_denied", 403)
    if category == "rate_limited":
        return _feature_error("home_rate_limited", 503, retry_after=_clamped_retry_after(error.retry_after))
    logger.warning("EPM Home read failed category=%s", category)
    return _feature_error("home_read_failed", 502)


def jira_read_error_to_response(error):
    if error.category == jira_strict.JIRA_ACCESS_DENIED:
        return _feature_error(jira_strict.JIRA_ACCESS_DENIED, 403)
    if error.category == jira_strict.JIRA_RATE_LIMITED:
        return _feature_error(
            jira_strict.JIRA_RATE_LIMITED, 503, retry_after=jira_strict.clamp_retry_after(error.retry_after),
        )
    logger.warning("EPM Jira read failed status=%s", error.status)
    return _feature_error(jira_strict.JIRA_READ_FAILED, 502)
