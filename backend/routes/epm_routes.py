"""EPM API route blueprint."""

from flask import Blueprint

from backend.auth.jira_auth import AuthError
from backend.config.repository import ConfigStorageError
from backend.config.view_validation import ViewPayloadValidationError, normalize_epm_settings_payload
from backend.db.engine import DatabaseConfigurationError
from backend.epm import issues as epm_issues
from backend.services.user_view_config import UserViewConfigStorageError

from . import bind_server_globals


bp = Blueprint("epm_routes", __name__)
HOME_USER_TOKEN_CONNECT_URL = '/settings/connections/home-token'


@bp.errorhandler(ConfigStorageError)
@bp.errorhandler(UserViewConfigStorageError)
@bp.errorhandler(DatabaseConfigurationError)
def _epm_storage_error_handler(error):
    logger.error('EPM route storage failed errorClass=%s', type(error).__name__)
    return _epm_storage_unavailable_response()


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


def _is_home_user_token_required(error):
    return isinstance(error, AuthError) and error.code == 'home_user_token_required'


def _home_user_token_message(error):
    return str(error) or 'Connect your Atlassian API token to load EPM Home projects.'


def _home_user_token_required_payload(error):
    return {
        'error': 'home_user_token_required',
        'message': _home_user_token_message(error),
        'connectUrl': HOME_USER_TOKEN_CONNECT_URL,
    }


def _home_user_token_required_response(error):
    return jsonify(_home_user_token_required_payload(error)), 409


def _invalid_epm_config_response():
    return jsonify({
        'error': 'invalid_epm_config',
        'message': 'EPM configuration is invalid.',
    }), 400


def _epm_storage_unavailable_response():
    return jsonify({
        'error': 'config_storage_unavailable',
        'message': 'EPM configuration storage is unavailable.',
    }), 503


def _strict_epm_request_payload(*, rekey_custom_projects=False):
    if not request.is_json:
        raise ViewPayloadValidationError(['epm'])
    raw_payload = request.get_json(silent=True)
    if not isinstance(raw_payload, dict):
        raise ViewPayloadValidationError(['epm'])
    payload = normalize_epm_settings_payload(raw_payload)
    projects = payload.get('projects')
    seen_project_ids = set()
    for row in projects.values():
        row_id = row.get('id')
        if row_id in seen_project_ids:
            raise ViewPayloadValidationError(['epm.projects'])
        seen_project_ids.add(row_id)
    for project_key, row in projects.items():
        if project_key != row.get('id'):
            raise ViewPayloadValidationError([f'epm.projects.{project_key}.id'])
    if rekey_custom_projects:
        rewritten = {}
        for project_key, row in projects.items():
            item = dict(row)
            home_project_id = normalize_epm_text(item.get('homeProjectId'))
            row_id = normalize_epm_text(item.get('id'))
            if home_project_id:
                rewritten[project_key] = item
            else:
                if row_id.startswith('draft-'):
                    row_id = uuid.uuid4().hex
                    item['id'] = row_id
                    rewritten[row_id] = item
                else:
                    rewritten[project_key] = item
        payload = dict(payload)
        payload['projects'] = rewritten
    return payload


def build_epm_project_issues_response(home_project_id, tab, sprint, sub_goal_keys=None):
    auth_context = current_request_auth_context()
    epm_config_snapshot = get_epm_config(context=auth_context)
    deps = epm_issues.EpmIssuesDependencies(
        find_epm_project_or_404=lambda project_id: find_epm_project_or_404(
            project_id,
            sub_goal_keys=sub_goal_keys,
            context=auth_context,
            epm_config_override=epm_config_snapshot,
        ),
        validate_epm_tab_sprint=validate_epm_tab_sprint,
        build_epm_scope_clause=build_epm_scope_clause,
        build_base_jql=build_base_jql,
        add_clause_to_jql=add_clause_to_jql,
        fetch_issues_by_jql=(
            lambda jql, fields_list, context=None:
            fetch_issues_by_jql(jql, fields_list, context=auth_context)
        ),
        build_epm_fields_list=build_epm_fields_list,
        shape_epm_issue_payload=shape_epm_issue_payload,
        dedupe_issues_by_key=dedupe_issues_by_key,
        cache=EPM_ISSUES_CACHE,
        cache_lock=_epm_cache_lock,
        cache_ttl_seconds=EPM_ISSUES_CACHE_TTL_SECONDS,
        context=auth_context,
        config_generation=build_epm_config_generation(epm_config_snapshot),
    )
    return epm_issues.build_epm_project_issues_payload(home_project_id, tab, sprint, deps)


@bp.route('/api/epm/config', methods=['GET'])
def get_epm_config_endpoint():
    try:
        return jsonify(get_epm_config(context=current_request_auth_context()))
    except (ConfigStorageError, UserViewConfigStorageError, DatabaseConfigurationError) as error:
        logger.error('EPM config read failed errorClass=%s', type(error).__name__)
        return _epm_storage_unavailable_response()


@bp.route('/api/epm/scope', methods=['GET'])
def get_epm_scope_endpoint():
    auth_context = current_request_auth_context()
    scope = (get_epm_config(context=auth_context).get('scope') or {})
    try:
        cloud_id = fetch_home_site_cloud_id(context=auth_context)
        error = ''
    except RuntimeError as exc:
        cloud_id = ''
        error = str(exc)
    return jsonify({
        'cloudId': cloud_id,
        'error': error,
        'scope': {
            'rootGoalKey': normalize_epm_upper_text(scope.get('rootGoalKey')),
            'subGoalKeys': normalize_epm_sub_goal_keys(scope.get('subGoalKeys') or scope.get('subGoalKey')),
        },
    })


@bp.route('/api/epm/goals', methods=['GET'])
def get_epm_goals_endpoint():
    root_goal_key = normalize_epm_upper_text(request.args.get('rootGoalKey'))
    try:
        goals = fetch_epm_sub_goals(root_goal_key) if root_goal_key else fetch_epm_goal_catalog()
        error = ''
    except (
        RuntimeError,
        epm_home.HomeAuthenticationError,
        epm_home.HomeRateLimitError,
        epm_home.HomeGraphQLError,
    ) as exc:
        goals = []
        error = str(exc)
    except AuthError as exc:
        if _is_home_user_token_required(exc):
            return jsonify({
                'goals': [],
                'error': _home_user_token_message(exc),
                'errorCode': exc.code,
                'connectUrl': HOME_USER_TOKEN_CONNECT_URL,
            })
        if exc.code == 'auth_required':
            payload, status = oauth_auth_required_payload()
            return jsonify(payload), status
        raise
    return jsonify({'goals': goals, 'error': error})


@bp.route('/api/epm/projects', methods=['GET'])
def get_epm_projects_endpoint():
    auth_context = current_request_auth_context()
    epm_config = get_epm_config(context=auth_context)
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    tab = normalize_epm_text(request.args.get('tab'))
    sub_goal_keys = parse_epm_sub_goal_keys_param(request.args.get('subGoalKeys'))
    started = time.perf_counter()
    try:
        payload = build_epm_projects_payload(
            epm_config,
            force_refresh=force_refresh,
            tab=tab,
            sub_goal_keys=sub_goal_keys,
            context=auth_context,
        )
    except AuthError as exc:
        if _is_home_user_token_required(exc):
            return _home_user_token_required_response(exc)
        raise
    total_ms = round((time.perf_counter() - started) * 1000, 1)
    response = jsonify(payload)
    response.headers['Server-Timing'] = f'home-projects;dur={total_ms}, total;dur={total_ms}'
    return response


@bp.route('/api/epm/projects/configuration', methods=['POST'])
def configure_epm_projects_endpoint():
    try:
        payload = _strict_epm_request_payload()
    except (ValueError, ViewPayloadValidationError):
        return _invalid_epm_config_response()
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    started = time.perf_counter()
    try:
        projects_payload = build_epm_projects_payload(payload, force_refresh=force_refresh)
    except AuthError as exc:
        if _is_home_user_token_required(exc):
            return _home_user_token_required_response(exc)
        raise
    total_ms = round((time.perf_counter() - started) * 1000, 1)
    response = jsonify(projects_payload)
    response.headers['Server-Timing'] = f'home-projects;dur={total_ms}, total;dur={total_ms}'
    return response


@bp.route('/api/epm/projects/preview', methods=['POST'])
def preview_epm_projects_endpoint():
    return configure_epm_projects_endpoint()


@bp.route('/api/epm/projects/rollup/all', methods=['GET'])
def get_all_epm_projects_rollup_endpoint():
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    sub_goal_keys = parse_epm_sub_goal_keys_param(request.args.get('subGoalKeys'))
    try:
        payload, status, headers = build_all_epm_projects_rollup(tab, sprint, sub_goal_keys=sub_goal_keys)
    except AuthError as exc:
        if _is_home_user_token_required(exc):
            return _home_user_token_required_response(exc)
        raise
    response = jsonify(payload)
    for key, value in headers.items():
        response.headers[key] = value
    return response, status


@bp.route('/api/epm/projects/<path:home_project_id>/issues', methods=['GET'])
def get_epm_project_issues_endpoint(home_project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    sub_goal_keys = parse_epm_sub_goal_keys_param(request.args.get('subGoalKeys'))
    try:
        payload, status, headers = build_epm_project_issues_response(
            home_project_id,
            tab,
            sprint,
            sub_goal_keys=sub_goal_keys,
        )
    except AuthError as exc:
        if _is_home_user_token_required(exc):
            return _home_user_token_required_response(exc)
        raise
    response = jsonify(payload)
    for key, value in headers.items():
        response.headers[key] = value
    return response, status


@bp.route('/api/epm/projects/<path:project_id>/rollup', methods=['GET'])
def get_epm_project_rollup_endpoint(project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    try:
        payload, status, headers = build_per_project_rollup(
            project_id,
            tab,
            sprint,
            build_epm_rollup_dependencies(
                sub_goal_keys=parse_epm_sub_goal_keys_param(request.args.get('subGoalKeys')),
                context=current_request_auth_context(),
            ),
        )
    except AuthError as exc:
        if _is_home_user_token_required(exc):
            return _home_user_token_required_response(exc)
        raise
    response = jsonify(payload)
    for key, value in headers.items():
        response.headers[key] = value
    return response, status


@bp.route('/api/epm/config', methods=['POST'])
def save_epm_config_endpoint():
    try:
        payload = _strict_epm_request_payload(rekey_custom_projects=True)
    except (ValueError, ViewPayloadValidationError):
        return _invalid_epm_config_response()
    try:
        if config_storage_db_enabled():
            context = current_request_auth_context()
            result = build_db_config_repository().save_user_epm_config(
                context,
                payload,
                post_commit=lambda _result: clear_epm_caches(context),
            )
            response_payload = dict(payload)
            response_payload['viewConfigId'] = result.view_config_id
        else:
            try:
                previous = get_epm_config(source='jsonfile')
                dashboard_config = load_dashboard_config(source='jsonfile') or {}
                dashboard_config['epm'] = payload
                save_dashboard_config(dashboard_config, source='jsonfile')
            except OSError as error:
                logger.error('EPM JSON config save failed errorClass=%s', type(error).__name__)
                return _epm_storage_unavailable_response()
            if previous != payload:
                clear_epm_caches()
            response_payload = payload
    except (ConfigStorageError, UserViewConfigStorageError, DatabaseConfigurationError) as error:
        logger.error('EPM config save failed errorClass=%s', type(error).__name__)
        return _epm_storage_unavailable_response()
    return jsonify(response_payload)
