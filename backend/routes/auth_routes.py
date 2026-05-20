"""Authentication route blueprint."""

from flask import Blueprint, jsonify, redirect, request, session

from backend.auth.csrf import bind_csrf_token, issue_csrf_token
from backend.auth.jira_auth import ensure_oauth_token, missing_oauth_scopes
from backend.epm import home as epm_home

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
    if database_storage_enabled() and db_oauth_browser_session_data():
        try:
            context = current_request_auth_context()
        except AuthError as error:
            payload = {
                'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
                'authenticated': False,
                'loginRequired': True,
            }
            recovery_url = auth_recovery_url(error.code)
            if recovery_url:
                payload['recoveryUrl'] = recovery_url
            if error.code == 'auth_required':
                payload['loginUrl'] = '/login?reason=session_expired'
            elif error.code == 'missing_oauth_scope':
                payload['loginUrl'] = '/login?reason=missing_scope'
            return jsonify(payload)
        return jsonify({
            'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
            'authenticated': True,
            'loginRequired': False,
            'siteUrl': context.site_url,
        })
    data = oauth_session_data()
    authenticated = bool(data.get('access_token') and data.get('cloudid'))
    if authenticated and missing_oauth_scopes(data, ATLASSIAN_SCOPES):
        return jsonify({
            'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
            'authenticated': False,
            'loginRequired': True,
            'loginUrl': '/login?reason=missing_scope',
            'siteUrl': data.get('site_url'),
            'siteName': data.get('site_name'),
        })
    return jsonify({
        'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
        'authenticated': authenticated,
        'loginRequired': not authenticated,
        'siteUrl': data.get('site_url'),
        'siteName': data.get('site_name'),
    })


@bp.route('/login', methods=['GET'])
def auth_entry_page():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return redirect('/')
    if database_storage_enabled() and db_oauth_browser_session_data():
        try:
            current_request_auth_context()
            return redirect('/')
        except AuthError:
            pass
    data = oauth_session_data()
    if data.get('access_token') and data.get('cloudid'):
        return redirect('/')
    message = ''
    login_url = '/api/auth/atlassian/login'
    if request.args.get('reason') == 'session_expired':
        message = '<p class="auth-notice" role="status">Your Jira sign-in expired. Sign in again to continue.</p>'
    elif request.args.get('reason') == 'missing_scope':
        message = '<p class="auth-notice" role="status">Your Jira sign-in needs updated permissions. Sign in again to continue.</p>'
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in</title>
    <style>
      :root {{
        color-scheme: light;
      }}

      * {{
        box-sizing: border-box;
      }}

      body {{
        margin: 0;
        min-height: 100vh;
        padding: 32px 18px;
        background: #f4f7fb;
        color: #172033;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }}

      body,
      .auth-entry {{
        display: flex;
        align-items: center;
        justify-content: center;
      }}

      .auth-entry {{
        width: 100%;
      }}

      .auth-card {{
        width: min(100%, 560px);
        padding: 32px;
        background: #ffffff;
        border: 1px solid #d8e0eb;
        border-radius: 8px;
        box-shadow: 0 12px 32px rgba(23, 32, 51, 0.08);
      }}

      h1 {{
        margin: 0;
        color: #172033;
        font-size: 2rem;
        line-height: 1.15;
        font-weight: 700;
        letter-spacing: 0;
      }}

      .auth-copy {{
        margin: 12px 0 0;
        color: #4a5568;
        font-size: 1rem;
      }}

      .auth-notice {{
        margin: 20px 0 0;
        padding: 12px 14px;
        color: #7c2d12;
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 6px;
      }}

      .auth-action {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        margin-top: 24px;
        padding: 0 18px;
        color: #ffffff;
        background: #0c66e4;
        border-radius: 6px;
        font-weight: 700;
        text-decoration: none;
      }}

      .auth-action:hover {{
        background: #0055cc;
      }}

      .auth-action:focus-visible {{
        outline: 3px solid #85b8ff;
        outline-offset: 2px;
      }}

      @media (max-width: 520px) {{
        body {{
          align-items: flex-start;
          padding: 20px 12px;
        }}

        .auth-card {{
          padding: 24px 20px;
        }}

        h1 {{
          font-size: 1.55rem;
        }}

        .auth-action {{
          width: 100%;
        }}
      }}
    </style>
  </head>
  <body>
    <main class="auth-entry">
      <section class="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">Sign in to Jira Execution Planner</h1>
        <p class="auth-copy">Use your Atlassian account to continue.</p>
        {message}
        <a class="auth-action" href="{login_url}">Sign in with Atlassian</a>
      </section>
    </main>
  </body>
</html>
""", 200, {'Content-Type': 'text/html; charset=utf-8'}


def _recovery_page(title, copy, action_label=None, action_href=None):
    action = ''
    if action_label and action_href:
        action = f'<a class="auth-action" href="{action_href}">{action_label}</a>'
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title}</title>
    <style>
      :root {{ color-scheme: light; }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        min-height: 100vh;
        padding: 32px 18px;
        background: #f4f7fb;
        color: #172033;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }}
      body, .auth-entry {{ display: flex; align-items: center; justify-content: center; }}
      .auth-card {{
        width: min(100%, 560px);
        padding: 32px;
        background: #ffffff;
        border: 1px solid #d8e0eb;
        border-radius: 8px;
      }}
      h1 {{ margin: 0; font-size: 2rem; line-height: 1.15; letter-spacing: 0; }}
      p {{ margin: 12px 0 0; color: #4a5568; }}
      .auth-action {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        margin-top: 24px;
        padding: 0 18px;
        color: #ffffff;
        background: #0c66e4;
        border-radius: 6px;
        font-weight: 700;
        text-decoration: none;
      }}
    </style>
  </head>
  <body>
    <main class="auth-entry">
      <section class="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{title}</h1>
        <p>{copy}</p>
        {action}
      </section>
    </main>
  </body>
</html>
""", 200, {'Content-Type': 'text/html; charset=utf-8'}


@bp.route('/auth/account-disabled', methods=['GET'])
def auth_account_disabled_page():
    return _recovery_page(
        'Account disabled',
        'Your Jira Execution Planner account is disabled. Contact a tool admin to restore access.',
    )


@bp.route('/auth/reconnect', methods=['GET'])
def auth_reconnect_page():
    return _recovery_page(
        'Reconnect Jira',
        'Your Jira connection needs to be reconnected before this workspace can load.',
        'Reconnect with Atlassian',
        '/api/auth/atlassian/login',
    )


@bp.route('/auth/missing-project-access', methods=['GET'])
def auth_missing_project_access_page():
    return _recovery_page(
        'Project access required',
        'Your Jira account does not currently have access to the configured project scope.',
    )


@bp.route('/auth/admin-required', methods=['GET'])
def auth_admin_required_page():
    return _recovery_page(
        'Tool admin access required',
        'This area is limited to Jira Execution Planner tool admins.',
    )


@bp.route('/auth/service-credentials', methods=['GET'])
def auth_service_credentials_page():
    return _recovery_page(
        'Service credentials',
        'Tool admins can review workspace service credential status here without exposing token material.',
        'View service integrations',
        '/api/admin/service-integrations',
    )


@bp.route('/api/auth/csrf', methods=['GET'])
def api_auth_csrf():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'csrfToken': issue_csrf_token(session, {})})
    data = oauth_session_data()
    if not data.get('access_token') or not data.get('cloudid'):
        save_oauth_session({})
        return jsonify({
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        }), 401
    try:
        current_request_auth_context()
    except AuthError as error:
        return auth_error_response(error, 401)
    token = issue_csrf_token(session, data)
    if database_storage_enabled() and db_oauth_browser_session_data():
        try:
            bind_csrf_token(session, token, csrf_session_data_for_request())
        except AuthError as error:
            return auth_error_response(error, 401)
        except DatabaseConfigurationError:
            return jsonify({
                'error': 'config_storage_unavailable',
                'message': 'Database-backed authentication is unavailable.',
            }), 503
    return jsonify({'csrfToken': token})


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
    force_consent = str(request.args.get('prompt') or '').strip().lower() == 'consent'
    return redirect(build_authorize_url(config, state, build_pkce_challenge(verifier), force_consent=force_consent))


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
        session_token_data = dict(token_data or {})
        if not session_token_data.get('scope'):
            session_token_data['scope'] = ATLASSIAN_SCOPES
        session_payload = token_session_payload(session_token_data, resource, user_profile)
        session_payload.update(store_db_oauth_callback_session_metadata(session_token_data, resource, user_profile))
        save_oauth_session(session_payload)
    except AuthError as error:
        save_oauth_session({})
        if error.code in {'missing_jira_url', 'missing_oauth_config', 'missing_flask_secret_key', 'invalid_auth_mode', 'local_token_store_not_allowed'}:
            return auth_error_response(error, 400)
        return auth_error_response(error, 401 if error.code != 'jira_site_not_accessible' else 403)
    return redirect('/')


@bp.route('/api/auth/refresh', methods=['POST'])
def api_auth_refresh():
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'authenticated': True, 'authMode': AUTH_MODE_BASIC})
    if database_storage_enabled() and db_oauth_browser_session_data():
        try:
            context = current_request_auth_context()
            active = current_jira_session_data(context)
            remember_db_oauth_browser_session(active)
        except AuthError as error:
            if error.code == 'auth_required':
                save_oauth_session({})
                return jsonify({
                    'error': 'auth_required',
                    'message': 'Your Jira sign-in expired. Sign in again to continue.',
                    'loginUrl': '/login?reason=session_expired',
                }), 401
            return auth_error_response(error, 401)
        return jsonify({
            'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
            'authenticated': True,
            'loginRequired': False,
            'expiresAt': active.get('expires_at'),
            'siteUrl': active.get('site_url'),
            'siteName': active.get('site_name'),
        })
    data = oauth_session_data()
    if not data.get('access_token') or not data.get('cloudid'):
        save_oauth_session({})
        return jsonify({
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        }), 401
    try:
        active = ensure_oauth_token(
            current_auth_config(),
            data,
            save_oauth_session,
            reload_session=oauth_session_data,
            refresh_lock=oauth_refresh_lock(),
        )
    except AuthError as error:
        if error.code == 'auth_required':
            save_oauth_session({})
            return jsonify({
                'error': 'auth_required',
                'message': 'Your Jira sign-in expired. Sign in again to continue.',
                'loginUrl': '/login?reason=session_expired',
            }), 401
        return auth_error_response(error, 401)
    return jsonify({
        'authMode': AUTH_MODE_ATLASSIAN_OAUTH,
        'authenticated': True,
        'loginRequired': False,
        'expiresAt': active.get('expires_at'),
        'siteUrl': active.get('site_url'),
        'siteName': active.get('site_name'),
    })


@bp.route('/api/auth/dev/home-graphql-oauth-probe', methods=['GET'])
def api_dev_home_graphql_oauth_probe():
    if APP_ENVIRONMENT_KEY.strip().lower() not in {'local', 'dev'}:
        return jsonify({'error': 'not_found'}), 404
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'oauth_required'}), 400
    data = oauth_session_data()
    if not data.get('access_token') or not data.get('cloudid'):
        save_oauth_session({})
        return jsonify({
            'error': 'auth_required',
            'message': 'Your Jira sign-in expired. Sign in again to continue.',
            'loginUrl': '/login?reason=session_expired',
        }), 401
    try:
        active = ensure_oauth_token(
            current_auth_config(),
            data,
            save_oauth_session,
            reload_session=oauth_session_data,
            refresh_lock=oauth_refresh_lock(),
        )
    except AuthError as error:
        if error.code == 'auth_required':
            save_oauth_session({})
            return jsonify({
                'error': 'auth_required',
                'message': 'Your Jira sign-in expired. Sign in again to continue.',
                'loginUrl': '/login?reason=session_expired',
            }), 401
        return auth_error_response(error, 401)

    epm_config = get_epm_config()
    scope = epm_config.get('scope') or {}
    sub_goal_keys = normalize_epm_sub_goal_keys(scope.get('subGoalKeys') or scope.get('subGoalKey'))
    root_goal_key = normalize_epm_upper_text(request.args.get('rootGoalKey') or scope.get('rootGoalKey'))
    sub_goal_key = normalize_epm_upper_text(
        request.args.get('subGoalKey') or (sub_goal_keys[0] if sub_goal_keys else '')
    )
    payload = epm_home.run_home_graphql_oauth_probe(
        active.get('access_token', ''),
        active.get('cloudid', ''),
        epm_scope=scope,
        root_goal_key=root_goal_key,
        sub_goal_key=sub_goal_key,
        home_project_id=str(request.args.get('homeProjectId') or '').strip(),
        jira_url=str(active.get('site_url') or JIRA_URL or '').strip(),
    )
    return jsonify(epm_home.redact_home_oauth_probe_payload(payload))


@bp.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    save_oauth_session({})
    session.pop('oauth_state', None)
    session.pop('oauth_pkce_verifier', None)
    return jsonify({'ok': True})
