"""Current-user connection route blueprint."""

from flask import Blueprint, g, jsonify, request, session

from backend.auth.csrf import validate_csrf_token
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError
from backend.auth.key_provider import KeyProviderConfigurationError, key_provider_from_env
from backend.auth import user_api_tokens
from backend.db.engine import DatabaseConfigurationError, session_scope

from . import bind_server_globals


bp = Blueprint("user_connection_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.before_request
def _require_token_bound_csrf():
    if request.method not in {'POST', 'PUT', 'PATCH', 'DELETE'}:
        return None
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    data = oauth_session_data()
    if validate_csrf_token(session, data, request.headers.get('X-CSRF-Token')):
        return None
    return jsonify({
        'error': 'csrf_required',
        'message': 'A valid CSRF token is required for this request.',
    }), 403


@bp.before_request
def _require_authenticated_user():
    try:
        g.auth_context = current_request_auth_context()
    except AuthError as error:
        return auth_error_response(error, 401)
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)
    return None


def _error_response(error):
    status = {
        'credential_email_required': 400,
        'credential_api_token_required': 400,
        'credential_subject_mismatch': 409,
        'credential_not_authorized': 401,
        'credential_validation_failed': 401,
        'home_credential_not_authorized': 403,
        'jira_site_required': 400,
    }.get(error.code, 400)
    return jsonify({'error': error.code, 'message': error.message}), status


def _storage_error_response(_error):
    return jsonify({
        'error': 'credential_storage_unavailable',
        'message': 'Credential storage is not configured for Home token connections.',
    }), 503


@bp.route('/api/me/connections/home-token', methods=['GET'])
def api_me_home_token_connection():
    context = g.auth_context
    try:
        with session_scope() as db_session:
            connection = user_api_tokens.home_token_connection_for_context(db_session, context)
            return jsonify(user_api_tokens.home_token_summary(connection))
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)


@bp.route('/api/me/connections/home-token', methods=['POST'])
def api_me_connect_home_token():
    context = g.auth_context
    payload = request.get_json(silent=True) or {}
    session_data = oauth_session_data()
    email = str(payload.get('email') or session_data.get('email') or '').strip()
    api_token = payload.get('apiToken') or ''
    try:
        with session_scope() as db_session:
            connection = user_api_tokens.connect_home_user_api_token(
                db_session,
                context=context,
                email=email,
                api_token=api_token,
                key_provider=key_provider_from_env(),
                http_get=HTTP_SESSION.get,
            )
            clear_auth_sensitive_caches('user_api_token_connected')
            return jsonify(user_api_tokens.home_token_summary(connection))
    except user_api_tokens.UserApiTokenError as error:
        return _error_response(error)
    except (DatabaseConfigurationError, KeyProviderConfigurationError) as error:
        return _storage_error_response(error)


@bp.route('/api/me/connections/home-token', methods=['DELETE'])
def api_me_revoke_home_token():
    context = g.auth_context
    try:
        with session_scope() as db_session:
            user_api_tokens.revoke_home_user_api_token(db_session, context=context)
            clear_auth_sensitive_caches('user_api_token_revoked')
        return jsonify({'connected': False})
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)
