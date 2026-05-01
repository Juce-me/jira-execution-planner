"""EPM API route blueprint."""

from flask import Blueprint

from . import bind_server_globals


bp = Blueprint("epm_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.route('/api/epm/config', methods=['GET'])
def get_epm_config_endpoint():
    return jsonify(get_epm_config())


@bp.route('/api/epm/scope', methods=['GET'])
def get_epm_scope_endpoint():
    scope = (get_epm_config().get('scope') or {})
    try:
        cloud_id = fetch_home_site_cloud_id()
        error = ''
    except RuntimeError as exc:
        cloud_id = ''
        error = str(exc)
    return jsonify({
        'cloudId': cloud_id,
        'error': error,
        'scope': {
            'rootGoalKey': normalize_epm_upper_text(scope.get('rootGoalKey')),
            'subGoalKey': normalize_epm_upper_text(scope.get('subGoalKey')),
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
    return jsonify({'goals': goals, 'error': error})


@bp.route('/api/epm/projects', methods=['GET'])
def get_epm_projects_endpoint():
    epm_config = get_epm_config()
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    tab = normalize_epm_text(request.args.get('tab'))
    started = time.perf_counter()
    payload = build_epm_projects_payload(epm_config, force_refresh=force_refresh, tab=tab)
    total_ms = round((time.perf_counter() - started) * 1000, 1)
    response = jsonify(payload)
    response.headers['Server-Timing'] = f'home-projects;dur={total_ms}, total;dur={total_ms}'
    return response


@bp.route('/api/epm/projects/configuration', methods=['POST'])
def configure_epm_projects_endpoint():
    payload = normalize_epm_config(request.get_json(silent=True) or {})
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    started = time.perf_counter()
    projects_payload = build_epm_projects_payload(payload, force_refresh=force_refresh)
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
    payload, status, headers = build_all_epm_projects_rollup(tab, sprint)
    response = jsonify(payload)
    for key, value in headers.items():
        response.headers[key] = value
    return response, status


@bp.route('/api/epm/projects/<home_project_id>/issues', methods=['GET'])
def get_epm_project_issues_endpoint(home_project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    validation_error = validate_epm_tab_sprint(tab, sprint)
    if validation_error:
        error_payload, status = validation_error
        return jsonify(error_payload), status

    project = find_epm_project_or_404(home_project_id)
    linkage = project['resolvedLinkage']
    scope_clause = build_epm_scope_clause(linkage)
    if not scope_clause:
        return jsonify({'project': project, 'issues': [], 'epics': {}, 'metadataOnly': True})

    base_jql = build_base_jql()
    cache_key = f"{home_project_id}::{tab}::{sprint}::{base_jql}::{json.dumps(linkage, sort_keys=True)}"
    with _epm_cache_lock:
        cached = EPM_ISSUES_CACHE.get(cache_key)
    if cached and (time.time() - cached['timestamp']) < EPM_ISSUES_CACHE_TTL_SECONDS:
        response = jsonify(cached['data'])
        response.headers['Server-Timing'] = 'cache;dur=1'
        return response

    started = time.perf_counter()
    jql = add_clause_to_jql(base_jql, scope_clause)
    if should_apply_epm_sprint(tab):
        jql = add_clause_to_jql(jql, f'Sprint = {sprint}')
    issues = fetch_issues_by_jql(jql, build_jira_headers(), build_epm_fields_list())
    slim_issues, epic_details = shape_epm_issue_payload(issues)
    payload = {
        'project': project,
        'issues': dedupe_issues_by_key(slim_issues),
        'epics': epic_details,
        'metadataOnly': False,
    }
    with _epm_cache_lock:
        EPM_ISSUES_CACHE[cache_key] = {'timestamp': time.time(), 'data': payload}
    response = jsonify(payload)
    response.headers['Server-Timing'] = f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'
    return response


@bp.route('/api/epm/projects/<project_id>/rollup', methods=['GET'])
def get_epm_project_rollup_endpoint(project_id):
    tab = str(request.args.get('tab') or 'active').strip().lower()
    sprint = str(request.args.get('sprint') or '').strip()
    payload, status, headers = build_per_project_rollup(
        project_id,
        tab,
        sprint,
        build_epm_rollup_dependencies(),
    )
    response = jsonify(payload)
    for key, value in headers.items():
        response.headers[key] = value
    return response, status


@bp.route('/api/epm/config', methods=['POST'])
# TODO(SETTINGS_ADMIN_ONLY): gate this route when the admin flag ships.
def save_epm_config_endpoint():
    raw_payload = request.get_json(silent=True) or {}
    raw_projects = raw_payload.get('projects') if isinstance(raw_payload, dict) else {}
    if isinstance(raw_projects, dict):
        rewritten_projects = {}
        for _, row in raw_projects.items():
            if not isinstance(row, dict):
                continue
            rewritten_row = dict(row)
            home_project_id = normalize_epm_text(rewritten_row.get('homeProjectId'))
            row_id = normalize_epm_text(rewritten_row.get('id'))
            if home_project_id:
                rewritten_row['id'] = home_project_id
                rewritten_projects[home_project_id] = rewritten_row
                continue
            if not row_id or row_id.startswith('draft-'):
                row_id = uuid.uuid4().hex
            rewritten_row['id'] = row_id
            rewritten_row['homeProjectId'] = None
            rewritten_projects[row_id] = rewritten_row
        raw_payload = dict(raw_payload)
        raw_payload['projects'] = rewritten_projects
    payload = normalize_epm_config(raw_payload)
    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        previous_epm_config = normalize_epm_config(dashboard_config.get('epm') or {})
        previous_scope_key = build_epm_home_projects_cache_key(previous_epm_config.get('scope') or {})
        next_scope_key = build_epm_home_projects_cache_key(payload.get('scope') or {})
        dashboard_config['epm'] = payload
        save_dashboard_config(dashboard_config)
        if previous_scope_key != next_scope_key:
            clear_epm_project_cache()
        clear_epm_rollup_caches()
    except Exception as e:
        return jsonify({'error': 'Failed to save EPM config', 'message': str(e)}), 500
    return jsonify(payload)
