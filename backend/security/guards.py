import os

from flask import g, jsonify, request, session

from backend.auth.csrf import validate_csrf_token
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AUTH_MODE_BASIC, AuthError, missing_oauth_scopes
from backend.db.engine import DatabaseConfigurationError, database_storage_enabled
from backend.routes import get_jira_server
from backend.security.policy import UNSAFE_METHODS, classify_request_rule


PROTECTED_POLICY_CLASSES = {
    "authenticated_read",
    "user_write",
    "workspace_write",
    "shared_admin_write",
    "tool_admin",
}
CSRF_POLICY_CLASSES = {"user_write", "workspace_write", "shared_admin_write", "tool_admin"}
ADMIN_POLICY_CLASSES = {"shared_admin_write", "tool_admin"}
LOOPBACK_ADDRESSES = {"127.0.0.1", "::1", "localhost"}


def _json_response(payload, status):
    return jsonify(payload), status


def _csrf_required(message):
    return _json_response({
        "error": "csrf_required",
        "message": message,
    }, 403)


def _route_not_oauth_ready():
    return _json_response({
        "error": "route_not_oauth_ready",
        "message": "This API route has not been migrated to Atlassian OAuth yet",
    }, 501)


def _not_found():
    return _json_response({"error": "not_found"}, 404)


def _loopback_request():
    return (request.remote_addr or "").strip().lower() in LOOPBACK_ADDRESSES


def _environment_key(server):
    return (os.getenv("APP_ENVIRONMENT_KEY") or getattr(server, "APP_ENVIRONMENT_KEY", "local") or "local").strip().lower()


def _is_oauth_mode(server):
    return getattr(server, "JIRA_AUTH_MODE", AUTH_MODE_BASIC) == AUTH_MODE_ATLASSIAN_OAUTH


def _is_basic_mode(server):
    return getattr(server, "JIRA_AUTH_MODE", AUTH_MODE_BASIC) == AUTH_MODE_BASIC


def _auth_required(server):
    payload, status = server.oauth_auth_required_payload()
    return _json_response(payload, status)


def _missing_scope_required():
    return _json_response({
        "error": "auth_required",
        "loginUrl": "/login?reason=missing_scope",
    }, 401)


def _auth_error_response(server, error):
    if error.code == "missing_oauth_scope":
        return _missing_scope_required()
    status = 401 if error.code in {
        "auth_required",
        "account_disabled",
        "auth_connection_revoked",
        "auth_connection_stale",
        "missing_project_access",
    } else 403
    return server.auth_error_response(error, status)


def _strict_db_browser_session_data(server):
    strict_session = getattr(server, "strict_db_oauth_browser_session_data", None)
    if strict_session is None:
        return {}
    return strict_session()


def _require_real_oauth_session(server, policy_class):
    if database_storage_enabled() and _strict_db_browser_session_data(server):
        try:
            server.current_request_auth_context()
        except AuthError as error:
            return _auth_error_response(server, error)
        except DatabaseConfigurationError as error:
            if policy_class == "user_write":
                return None
            return _json_response({
                "error": "config_storage_unavailable",
                "message": str(error),
            }, 503)
        return None

    if database_storage_enabled() and policy_class == "workspace_write":
        return _auth_required(server)

    data = server.oauth_session_data()
    if not data.get("access_token") or not data.get("cloudid"):
        return _auth_required(server)
    if missing_oauth_scopes(data, server.ATLASSIAN_SCOPES):
        return _missing_scope_required()
    try:
        server.current_request_auth_context()
    except AuthError as error:
        return _auth_error_response(server, error)
    except DatabaseConfigurationError as error:
        if policy_class == "user_write":
            return None
        return _json_response({
            "error": "config_storage_unavailable",
            "message": str(error),
        }, 503)
    return None


def _require_token_bound_csrf(server):
    try:
        if database_storage_enabled() and server.db_oauth_browser_session_data():
            data = server.csrf_session_data_for_request()
        else:
            data = server.oauth_session_data()
    except AuthError as error:
        return _auth_error_response(server, error)
    except DatabaseConfigurationError as error:
        return _json_response({
            "error": "config_storage_unavailable",
            "message": str(error),
        }, 503)
    if validate_csrf_token(session, data, request.headers.get("X-CSRF-Token")):
        g.security_csrf_validated = True
        return None
    return _csrf_required("A valid CSRF token is required for this request.")


def _require_admin(server):
    try:
        context = server.current_request_auth_context()
    except AuthError as error:
        return _auth_error_response(server, error)
    except DatabaseConfigurationError as error:
        return _json_response({
            "error": "config_storage_unavailable",
            "message": str(error),
        }, 503)
    if getattr(context, "is_admin", False):
        return None
    payload, status = server.admin_required_payload()
    return _json_response(payload, status)


def _require_basic_local(server):
    if not _is_basic_mode(server):
        return None
    if _environment_key(server) in {"local", "dev"} and _loopback_request():
        return None
    return _not_found()


def _require_dev_local(server):
    allow = (os.getenv("ALLOW_DEV_DIAGNOSTIC_ENDPOINTS", "").strip().lower() in {"1", "true", "yes"})
    if _environment_key(server) in {"local", "dev"} and allow and _loopback_request():
        return None
    return _not_found()


def register_security_guards(flask_app):
    @flask_app.before_request
    def enforce_endpoint_security_policy():
        if request.method in {"HEAD", "OPTIONS"}:
            return None
        if request.endpoint == "static":
            return None

        server = get_jira_server()
        url_rule = request.url_rule.rule if request.url_rule is not None else ""
        policy = classify_request_rule(url_rule, request.method, request.endpoint or "")
        if policy is None:
            if request.path.startswith("/api/") and _is_oauth_mode(server):
                return _route_not_oauth_ready()
            return _not_found()

        policy_class = policy.policy_class
        if policy_class == "public_page":
            return None
        if policy_class == "auth_flow":
            return None
        if policy_class == "dev_local":
            return _require_dev_local(server)
        if policy_class == "legacy_basic_local":
            if _is_oauth_mode(server):
                return _route_not_oauth_ready()
            return _require_basic_local(server)

        if _is_basic_mode(server):
            return _require_basic_local(server)
        if not _is_oauth_mode(server):
            return None
        if policy_class not in PROTECTED_POLICY_CLASSES:
            return None

        auth_response = _require_real_oauth_session(server, policy_class)
        if auth_response is not None:
            return auth_response

        if request.method in UNSAFE_METHODS:
            if request.headers.get("X-Requested-With") != "jira-execution-planner":
                return _csrf_required("Unsafe OAuth requests require X-Requested-With: jira-execution-planner")
            if policy_class in CSRF_POLICY_CLASSES:
                csrf_response = _require_token_bound_csrf(server)
                if csrf_response is not None:
                    return csrf_response

        if policy_class in ADMIN_POLICY_CLASSES:
            admin_response = _require_admin(server)
            if admin_response is not None:
                return admin_response
        return None

    return flask_app
