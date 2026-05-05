"""Authentication route blueprint."""

from flask import Blueprint, jsonify, redirect, request, session

from . import bind_server_globals


bp = Blueprint("auth_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.route('/api/auth/status', methods=['GET'])
def api_auth_status():
    if JIRA_AUTH_MODE == AUTH_MODE_BASIC:
        return jsonify({
            'authMode': AUTH_MODE_BASIC,
            'authenticated': bool(JIRA_URL and JIRA_EMAIL and JIRA_TOKEN),
            'loginRequired': False,
        })
    data = oauth_session_data()
    authenticated = bool(data.get('access_token') and data.get('cloudid'))
    return jsonify({
        'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
        'authenticated': authenticated,
        'loginRequired': not authenticated,
        'siteUrl': data.get('site_url'),
        'siteName': data.get('site_name'),
    })


@bp.route('/api/auth/atlassian/login', methods=['GET'])
def api_atlassian_login():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return auth_error_response(AuthError('oauth_not_enabled', 'Atlassian OAuth auth mode is not enabled'), 400)
    config = current_auth_config()
    try:
        validate_auth_config(config)
        validate_local_token_store_allowed()
    except AuthError as error:
        return auth_error_response(error, 400)
    state = new_oauth_state()
    verifier = new_pkce_verifier()
    session['oauth_state'] = state
    session['oauth_pkce_verifier'] = verifier
    return redirect(build_authorize_url(config, state, build_pkce_challenge(verifier)))


@bp.route('/api/auth/atlassian/callback', methods=['GET'])
def api_atlassian_callback():
    expected_state = session.pop('oauth_state', None)
    code_verifier = session.pop('oauth_pkce_verifier', None)
    actual_state = request.args.get('state')
    if not expected_state or actual_state != expected_state:
        return jsonify({'error': 'invalid_oauth_state'}), 400
    if request.args.get('error'):
        return jsonify({'error': 'oauth_authorization_failed'}), 400
    code = request.args.get('code')
    if not code:
        return jsonify({'error': 'missing_oauth_code'}), 400
    if not code_verifier:
        return jsonify({'error': 'missing_pkce_verifier'}), 400
    config = current_auth_config()
    try:
        validate_auth_config(config)
        validate_local_token_store_allowed()
        token_data = exchange_authorization_code(config, code, code_verifier)
        user_profile = fetch_current_user(token_data.get('access_token', ''))
        if user_profile.get('account_status') != 'active':
            save_oauth_session({})
            return jsonify({'error': 'user_inactive'}), 403
        resources = fetch_accessible_resources(token_data.get('access_token', ''))
        resource = choose_accessible_resource(resources, config.jira_url)
        save_oauth_session(token_session_payload(token_data, resource, user_profile))
    except AuthError as error:
        save_oauth_session({})
        if error.code in {'missing_jira_url', 'missing_oauth_config', 'missing_flask_secret_key', 'invalid_auth_mode', 'local_token_store_not_allowed'}:
            return auth_error_response(error, 400)
        return auth_error_response(error, 401 if error.code != 'jira_site_not_accessible' else 403)
    return redirect('/')


@bp.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    save_oauth_session({})
    session.pop('oauth_state', None)
    session.pop('oauth_pkce_verifier', None)
    return jsonify({'ok': True})
