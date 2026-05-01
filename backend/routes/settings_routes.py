"""Settings, config, and catalog route blueprint."""

from flask import Blueprint

from . import bind_server_globals


bp = Blueprint("settings_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.route('/api/boards', methods=['GET'])
def get_boards():
    """Fetch available boards from Jira API"""
    try:
        query = (request.args.get('query') or '').strip()
        limit_raw = request.args.get('limit') or ''
        try:
            limit = int(limit_raw) if limit_raw else 200
        except ValueError:
            limit = 200
        limit = max(1, min(limit, 500))

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        log_info(
            f'Fetching boards mode={"search" if query else "all"} '
            f'limit={limit} queryLen={len(query)}'
        )

        # Get boards from Jira Agile API (paginated)
        boards = []
        seen_board_ids = set()
        start_at = 0
        page_size = 100
        max_pages = 50  # safety cap (up to 5000 boards)
        pages_fetched = 0

        # Fast path: direct board-id lookup for numeric search terms.
        if query and query.isdigit():
            direct_resp = requests.get(
                f'{JIRA_URL}/rest/agile/1.0/board/{query}',
                headers=headers,
                timeout=30
            )
            log_debug(f'Board direct lookup status={direct_resp.status_code} boardId={query}')
            if direct_resp.status_code == 200:
                board = direct_resp.json() or {}
                board_id = board.get('id')
                if board_id is not None and board_id not in seen_board_ids:
                    boards.append(board)
                    seen_board_ids.add(board_id)
            elif direct_resp.status_code not in (400, 401, 403, 404):
                error_text = direct_resp.text
                log_error(f'Board direct lookup failed: status={direct_resp.status_code}')
                return jsonify({
                    'error': f'Jira API error: {direct_resp.status_code}',
                    'details': error_text
                }), direct_resp.status_code

        while pages_fetched < max_pages:
            params = {'maxResults': page_size, 'startAt': start_at}
            if query:
                params['name'] = query
            response = requests.get(
                f'{JIRA_URL}/rest/agile/1.0/board',
                headers=headers,
                params=params,
                timeout=30
            )

            log_debug(f'Boards response status={response.status_code} startAt={start_at}')

            if response.status_code != 200:
                error_text = response.text
                log_error(f'Boards fetch failed: status={response.status_code} startAt={start_at}')
                return jsonify({
                    'error': f'Jira API error: {response.status_code}',
                    'details': error_text
                }), response.status_code

            data = response.json() or {}
            page_boards = data.get('values', []) or []
            for board in page_boards:
                board_id = board.get('id')
                if board_id is None or board_id in seen_board_ids:
                    continue
                boards.append(board)
                seen_board_ids.add(board_id)
            pages_fetched += 1

            if query and len(boards) >= limit:
                break

            is_last = bool(data.get('isLast'))
            if is_last:
                break

            if not page_boards:
                break

            # Jira Agile board API typically returns paging metadata;
            # fall back to page length progression if absent.
            start_at = int(data.get('startAt', start_at)) + len(page_boards)
            total = data.get('total')
            if isinstance(total, int) and start_at >= total:
                break

        # Format boards
        formatted_boards = []
        query_lower = query.lower()
        for board in boards:
            formatted = {
                'id': board.get('id'),
                'name': board.get('name'),
                'type': board.get('type'),
                'location': board.get('location', {})
            }
            if query:
                board_id = str(formatted.get('id') or '')
                board_name = str(formatted.get('name') or '').lower()
                if not (
                    query_lower in board_id.lower()
                    or query_lower in board_name
                ):
                    continue
            formatted_boards.append(formatted)

        if query:
            formatted_boards = formatted_boards[:limit]

        log_info(
            f'Found {len(formatted_boards)} boards pages={pages_fetched} '
            f'mode={"search" if query else "all"}'
        )

        success_response = jsonify({'boards': formatted_boards})
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response

    except Exception as e:
        logger.exception('Boards endpoint error')
        error_response = jsonify({
            'error': 'Failed to fetch boards from Jira',
            'message': str(e)
        })
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


@bp.route('/api/sprints', methods=['GET'])
def get_sprints():
    """Fetch available sprints - uses cache if valid, otherwise fetches from Jira"""
    try:
        force_refresh = request.args.get('refresh', '').lower() == 'true'

        formatted_sprints = []

        # Check if we should use cache
        if not force_refresh and is_cache_valid():
            cache_data = load_sprints_cache()
            if cache_data and 'sprints' in cache_data:
                formatted_sprints = cache_data['sprints']
                log_info(f'Loaded {len(formatted_sprints)} sprints from cache')

        # If no valid cache or force refresh, fetch from Jira
        if not formatted_sprints or force_refresh:
            if force_refresh:
                log_info('Force refresh requested')

            formatted_sprints = fetch_sprints_from_jira()

            # Save to cache
            if formatted_sprints:
                save_sprints_cache(formatted_sprints)

        log_info(f'Total quarterly sprints: {len(formatted_sprints)}')

        success_response = jsonify({'sprints': formatted_sprints})
        success_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        success_response.headers['Pragma'] = 'no-cache'
        success_response.headers['Expires'] = '0'
        return success_response

    except Exception as e:
        logger.exception('Sprints endpoint error')
        error_response = jsonify({
            'error': 'Failed to fetch sprints from Jira',
            'message': str(e)
        })
        error_response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return error_response, 500


@bp.route('/api/config', methods=['GET'])
def get_config():
    """Get public configuration"""
    board_cfg = get_board_config()
    return jsonify({
        'jiraUrl': JIRA_URL,
        'capacityProject': get_effective_capacity_project(),
        'boardId': board_cfg.get('boardId', ''),
        'boardName': board_cfg.get('boardName', ''),
        'boardConfigSource': board_cfg.get('source', 'default'),
        'settingsAdminOnly': bool(SETTINGS_ADMIN_ONLY),
        'userCanEditSettings': True,  # Placeholder until SSO/admin roles are implemented
        'groupsConfigPath': resolve_groups_config_path(),
        'groupQueryTemplateEnabled': bool(JQL_QUERY_TEMPLATE),
        'projectsConfigured': bool(get_selected_projects()),
        'epm': get_epm_config()
    })


@bp.route('/api/version', methods=['GET'])
def get_version():
    """Return local/remote version info for update checks."""
    if not UPDATE_CHECK_ENABLED:
        return jsonify({'enabled': False})

    now = time.time()
    with _cache_lock:
        cached = UPDATE_CHECK_CACHE.get('data')
        cached_ts = UPDATE_CHECK_CACHE.get('ts', 0)
    if cached and (now - cached_ts) < UPDATE_CHECK_TTL_SECONDS:
        return jsonify(cached)

    payload = build_update_check_payload()
    with _cache_lock:
        UPDATE_CHECK_CACHE['data'] = payload
        UPDATE_CHECK_CACHE['ts'] = now
    return jsonify(payload)


@bp.route('/api/groups-config', methods=['GET'])
def get_groups_config():
    """Return the saved team groups configuration."""
    warnings = []
    config_source = 'auto'

    # Try unified dashboard config first
    dashboard_config = load_dashboard_config()
    if dashboard_config and 'teamGroups' in dashboard_config:
        config = dashboard_config['teamGroups']
        config_source = 'file'
    else:
        # Fall back to legacy file / env
        config_path = resolve_groups_config_path()
        config = load_groups_config_file(config_path)
        if config:
            config_source = 'file'
        else:
            config = parse_groups_config_env()
            if config:
                config_source = 'env'

    if not config:
        config, auto_warnings = build_default_groups_config()
        warnings.extend(auto_warnings)
    else:
        normalized, errors, validate_warnings = validate_groups_config(config, allow_empty=True)
        warnings.extend(validate_warnings)
        if errors:
            warnings.append('Invalid groups config; falling back to auto Default group.')
            warnings.extend(errors)
            normalized, auto_warnings = build_default_groups_config()
            warnings.extend(auto_warnings)
        config = normalized

    if warnings:
        config['warnings'] = warnings
    config['source'] = config_source
    return jsonify(config)


@bp.route('/api/groups-config', methods=['POST'])
def save_groups_config():
    """Persist team groups configuration to disk."""
    payload = request.get_json(silent=True) or {}
    normalized, errors, warnings = validate_groups_config(payload, allow_empty=False)
    if errors:
        return jsonify({'errors': errors}), 400

    # Save into unified dashboard config, preserving other sections
    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}}
        dashboard_config['teamGroups'] = normalized
        save_dashboard_config(dashboard_config)
    except Exception as e:
        return jsonify({'error': 'Failed to save groups config', 'message': str(e)}), 500

    if warnings:
        normalized['warnings'] = warnings
    normalized['source'] = 'file'
    return jsonify(normalized)


@bp.route('/api/team-catalog', methods=['GET'])
def get_team_catalog():
    """Return the team name catalog."""
    migrate_team_catalog_from_config()
    data = load_team_catalog()
    return jsonify(data)


@bp.route('/api/team-catalog', methods=['POST'])
def post_team_catalog():
    """Save the team name catalog."""
    payload = request.get_json(silent=True) or {}
    merge = payload.get('merge', False)
    incoming = {
        'catalog': normalize_team_catalog(payload.get('catalog') or {}),
        'meta': normalize_team_catalog_meta(payload.get('meta') or {})
    }
    if merge:
        existing = load_team_catalog()
        merged_catalog = {**existing['catalog'], **incoming['catalog']}
        incoming['catalog'] = merged_catalog
    saved = save_team_catalog_file(incoming)
    return jsonify(saved)


@bp.route('/api/projects', methods=['GET'])
def get_jira_projects():
    """Fetch available Jira projects via project search API with caching."""
    try:
        query = request.args.get('query', '').strip()
        limit_raw = request.args.get('limit', '').strip()
        refresh = request.args.get('refresh', '').strip().lower() in ('1', 'true', 'yes')

        # Return cached data only for full-list requests (no query/limit), unless refresh requested.
        with _cache_lock:
            if (not refresh and not query and not limit_raw and
                    PROJECTS_CACHE['data'] and (time.time() - PROJECTS_CACHE['timestamp']) < PROJECTS_CACHE_TTL):
                return jsonify({'projects': PROJECTS_CACHE['data']})

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        limit = None
        if limit_raw:
            try:
                limit = max(1, min(int(limit_raw), 500))
            except ValueError:
                return jsonify({'error': 'limit must be an integer'}), 400

        all_projects = []
        start_at = 0
        max_results = 200
        while True:
            params = {
                'startAt': start_at,
                'maxResults': max_results,
                'orderBy': 'key'
            }
            if query:
                params['query'] = query

            response = HTTP_SESSION.get(
                f'{JIRA_URL}/rest/api/3/project/search',
                params=params,
                headers=headers,
                timeout=15
            )
            if response.status_code != 200:
                return jsonify({'error': 'Failed to fetch projects', 'details': response.text}), response.status_code
            data = response.json()
            values = data.get('values', [])
            for proj in values:
                all_projects.append({
                    'key': proj.get('key', ''),
                    'name': proj.get('name', ''),
                    'id': proj.get('id', '')
                })
                if limit and len(all_projects) >= limit:
                    break

            if limit and len(all_projects) >= limit:
                all_projects = all_projects[:limit]
                break

            if data.get('isLast', True):
                break

            next_start = None
            next_page = data.get('nextPage')
            if next_page:
                parsed = parse_qs(urlparse(next_page).query)
                start_at_values = parsed.get('startAt') or parsed.get('startat')
                if start_at_values:
                    try:
                        next_start = int(start_at_values[0])
                    except (TypeError, ValueError):
                        next_start = None

            if next_start is None:
                response_page_size = data.get('maxResults')
                try:
                    response_page_size = int(response_page_size)
                except (TypeError, ValueError):
                    response_page_size = 0
                step = response_page_size if response_page_size > 0 else len(values)
                if step <= 0:
                    break
                next_start = start_at + step

            if next_start <= start_at:
                next_start = start_at + max(1, len(values))
            start_at = next_start

        # Cache results (only for unfiltered full list)
        if not query:
            with _cache_lock:
                PROJECTS_CACHE['data'] = all_projects
                PROJECTS_CACHE['timestamp'] = time.time()

        return jsonify({'projects': all_projects})
    except Exception as e:
        return jsonify({'error': 'Failed to fetch projects', 'details': str(e)}), 500


@bp.route('/api/components', methods=['GET'])
def get_jira_components():
    """Fetch Jira components across selected projects with caching."""
    try:
        query = request.args.get('query', '').strip().lower()
        limit_raw = request.args.get('limit', '').strip()

        limit = 25
        if limit_raw:
            try:
                limit = max(1, min(int(limit_raw), 200))
            except ValueError:
                return jsonify({'error': 'limit must be an integer'}), 400

        # Return cached data when no query is specified and cache is fresh
        with _cache_lock:
            if (not query and COMPONENTS_CACHE['data'] and
                    (time.time() - COMPONENTS_CACHE['timestamp']) < COMPONENTS_CACHE_TTL):
                return jsonify({'components': COMPONENTS_CACHE['data'][:limit]})

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        projects = get_selected_projects()
        if not projects:
            return jsonify({'components': []})

        seen_names = set()
        all_components = []
        for project_key in projects:
            try:
                resp = HTTP_SESSION.get(
                    f'{JIRA_URL}/rest/api/3/project/{project_key}/components',
                    headers=headers,
                    timeout=10
                )
                if resp.status_code != 200:
                    continue
                for comp in (resp.json() or []):
                    name = (comp.get('name') or '').strip()
                    if not name:
                        continue
                    name_lower = name.lower()
                    if name_lower in seen_names:
                        continue
                    seen_names.add(name_lower)
                    all_components.append({
                        'id': comp.get('id', ''),
                        'name': name,
                        'projectKey': project_key
                    })
            except Exception:
                continue

        all_components.sort(key=lambda c: c['name'].lower())

        # Cache the full unfiltered list
        if not query:
            with _cache_lock:
                COMPONENTS_CACHE['data'] = all_components
                COMPONENTS_CACHE['timestamp'] = time.time()

        # Apply query filter
        if query:
            all_components = [c for c in all_components if query in c['name'].lower()]

        return jsonify({'components': all_components[:limit]})
    except Exception as e:
        return jsonify({'error': 'Failed to fetch components', 'details': str(e)}), 500


@bp.route('/api/epics/search', methods=['GET'])
def search_epics():
    """Search epics by key or summary across selected projects."""
    try:
        query = str(request.args.get('query') or '').strip()
        if not query:
            return jsonify({'epics': []})

        limit_raw = str(request.args.get('limit') or '').strip()
        limit = 15
        if limit_raw:
            try:
                limit = max(1, min(int(limit_raw), 100))
            except ValueError:
                return jsonify({'error': 'limit must be an integer'}), 400

        projects = get_selected_projects()
        if not projects:
            return jsonify({'epics': []})

        normalized_projects = sorted({str(project or '').strip() for project in projects if str(project or '').strip()})
        cache_key = f'{"|".join(normalized_projects)}::{query.lower()}::{limit}'
        now_ts = time.time()
        with _cache_lock:
            cached = EPICS_SEARCH_CACHE.get(cache_key)
            if cached and (now_ts - float(cached.get('timestamp') or 0)) < EPICS_SEARCH_CACHE_TTL:
                return jsonify({'epics': cached.get('data') or []})

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
        escaped_projects = ', '.join(f'"{_escape_jql_literal(project)}"' for project in normalized_projects)
        escaped_query = _escape_jql_literal(query)
        escaped_key = _escape_jql_literal(query.upper())
        key_like = re.match(r'^[A-Za-z][A-Za-z0-9_]+-\d+$', query) is not None

        if key_like:
            query_clause = f'key = "{escaped_key}"'
        else:
            query_clause = f'(summary ~ "\\"{escaped_query}\\"" OR key ~ "{escaped_key}*")'

        jql = (
            f'issuetype = Epic AND project in ({escaped_projects}) '
            f'AND {query_clause} ORDER BY updated DESC'
        )

        response = jira_search_request(headers, {
            'jql': jql,
            'maxResults': limit,
            'fields': ['summary', 'status', 'project', 'issuetype']
        })
        if response.status_code != 200:
            return jsonify({
                'error': f'Jira API error: {response.status_code}',
                'details': response.text
            }), response.status_code

        issues = (response.json() or {}).get('issues') or []
        selected_project_set = set(normalized_projects)
        epics = []
        for issue in issues:
            key = str(issue.get('key') or '').strip().upper()
            fields = issue.get('fields') or {}
            summary = str(fields.get('summary') or '').strip()
            project_key = str((fields.get('project') or {}).get('key') or '').strip()
            issue_type = fields.get('issuetype') or {}
            issue_type_name = str(issue_type.get('name') or '').strip().lower()
            hierarchy_level = issue_type.get('hierarchyLevel')
            is_epic_type = issue_type_name == 'epic' or str(hierarchy_level) == '1'
            if not key:
                continue
            # Defensive filtering: keep only selected projects + actual epic type.
            # Jira search should already enforce this via JQL, but we re-check to
            # avoid leaking stories/tasks if Jira returns mixed issue types.
            if project_key and project_key not in selected_project_set:
                continue
            if not is_epic_type:
                continue
            epics.append({
                'key': key,
                'summary': summary,
                'status': ((fields.get('status') or {}).get('name') or ''),
                'projectKey': project_key
            })

        with _cache_lock:
            EPICS_SEARCH_CACHE[cache_key] = {
                'timestamp': now_ts,
                'data': epics
            }

        return jsonify({'epics': epics})
    except Exception as e:
        return jsonify({'error': 'Failed to search epics', 'details': str(e)}), 500


@bp.route('/api/jira/labels', methods=['GET'])
def get_jira_labels():
    """Fetch Jira labels for autocomplete."""
    try:
        query = request.args.get('query', '').strip().lower()
        prefix = request.args.get('prefix', '').strip().lower()
        limit_raw = request.args.get('limit', '').strip()
        refresh = request.args.get('refresh', '').strip().lower() in ('1', 'true', 'yes')

        limit = 50
        if limit_raw.isdigit():
            limit = max(1, min(int(limit_raw), 200))

        with _cache_lock:
            cached_labels = LABELS_CACHE.get('data')
            cached_ts = LABELS_CACHE.get('timestamp', 0)

        if cached_labels and not refresh and (time.time() - cached_ts) < LABELS_CACHE_TTL:
            labels = cached_labels
        else:
            auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
            auth_bytes = auth_string.encode('ascii')
            auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
            headers = {
                'Authorization': f'Basic {auth_base64}',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
            labels = []
            start_at = 0
            max_results = 1000
            while True:
                response = requests.get(
                    f'{JIRA_URL}/rest/api/3/label',
                    headers=headers,
                    params={'maxResults': max_results, 'startAt': start_at},
                    timeout=30
                )
                if response.status_code != 200:
                    return jsonify({'error': 'Failed to fetch labels from Jira'}), response.status_code
                payload = response.json() or {}
                values = [str(label).strip() for label in (payload.get('values') or []) if str(label).strip()]
                labels.extend(values)
                if payload.get('isLast', True) or not values:
                    break
                next_start = payload.get('startAt')
                if isinstance(next_start, int):
                    start_at = next_start + len(values)
                else:
                    start_at += len(values)
            labels = sorted(dict.fromkeys(labels), key=str.lower)
            with _cache_lock:
                LABELS_CACHE['data'] = labels
                LABELS_CACHE['timestamp'] = time.time()

        if query:
            labels = [label for label in labels if query in label.lower()]
        if prefix:
            labels = [label for label in labels if label.lower().startswith(prefix)]

        return jsonify({'labels': labels[:limit]})
    except Exception as e:
        return jsonify({'error': 'Failed to fetch labels', 'details': str(e)}), 500


@bp.route('/api/projects/selected', methods=['GET'])
def get_selected_projects_endpoint():
    """Return the list of selected projects with type from dashboard config."""
    selected = get_selected_projects_typed()
    return jsonify({'selected': selected})


@bp.route('/api/projects/selected', methods=['POST'])
def save_selected_projects():
    """Save selected projects with type to dashboard config."""
    payload = request.get_json(silent=True) or {}
    selected = payload.get('selected', [])
    if not isinstance(selected, list):
        return jsonify({'error': 'selected must be an array'}), 400
    # Sanitize: accept both {key, type} objects and plain strings
    sanitized = []
    for item in selected:
        if isinstance(item, dict) and item.get('key'):
            sanitized.append({'key': str(item['key']).strip(), 'type': item.get('type', 'product')})
        elif isinstance(item, str) and item.strip():
            sanitized.append({'key': item.strip(), 'type': 'product'})

    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        dashboard_config.setdefault('projects', {})['selected'] = sanitized
        save_dashboard_config(dashboard_config)
    except Exception as e:
        return jsonify({'error': 'Failed to save project selection', 'message': str(e)}), 500

    # Invalidate tasks cache since project scope changed
    with _cache_lock:
        TASKS_CACHE.clear()

    return jsonify({'selected': sanitized})


@bp.route('/api/capacity/config', methods=['GET'])
def get_capacity_config_endpoint():
    """Return current capacity configuration."""
    cap = get_capacity_config()
    return jsonify(cap)


@bp.route('/api/board-config', methods=['GET'])
def get_board_config_endpoint():
    """Return current Jira board configuration."""
    board_cfg = get_board_config()
    return jsonify({
        'boardId': board_cfg.get('boardId', ''),
        'boardName': board_cfg.get('boardName', ''),
        'source': board_cfg.get('source', 'default')
    })


@bp.route('/api/board-config', methods=['POST'])
def save_board_config_endpoint():
    """Save Jira board configuration used for sprint loading."""
    payload = request.get_json(silent=True) or {}
    board_id = str(payload.get('boardId', '') or '').strip()
    board_name = str(payload.get('boardName', '') or '').strip()

    if board_id and not re.match(r'^\d+$', board_id):
        return jsonify({'error': 'boardId must be numeric'}), 400

    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        dashboard_config['board'] = {
            'boardId': board_id,
            'boardName': board_name,
        }
        save_dashboard_config(dashboard_config)
        with _cache_lock:
            TASKS_CACHE.clear()
        invalidate_sprints_cache()
    except Exception as e:
        return jsonify({'error': 'Failed to save board config', 'message': str(e)}), 500

    return jsonify({'boardId': board_id, 'boardName': board_name, 'source': 'config'})


@bp.route('/api/capacity/config', methods=['POST'])
def save_capacity_config_endpoint():
    """Save capacity project and field configuration."""
    payload = request.get_json(silent=True) or {}
    project = str(payload.get('project', '')).strip()
    field_id = str(payload.get('fieldId', '')).strip()
    field_name = str(payload.get('fieldName', '')).strip()

    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        dashboard_config['capacity'] = {
            'project': project,
            'fieldId': field_id,
            'fieldName': field_name,
        }
        save_dashboard_config(dashboard_config)
        # Reset the field cache since config changed
        global CAPACITY_FIELD_CACHE
        with _cache_lock:
            _jira_server_module.CAPACITY_FIELD_CACHE = None
            CAPACITY_FIELD_CACHE = None
    except Exception as e:
        return jsonify({'error': 'Failed to save capacity config', 'message': str(e)}), 500

    return jsonify({'project': project, 'fieldId': field_id, 'fieldName': field_name})


@bp.route('/api/sprint-field/config', methods=['GET'])
def get_sprint_field_config_endpoint():
    return jsonify(get_sprint_field_config())


@bp.route('/api/sprint-field/config', methods=['POST'])
def save_sprint_field_config_endpoint():
    return _save_field_config('sprintField')


@bp.route('/api/story-points-field/config', methods=['GET'])
def get_story_points_field_config_endpoint():
    return jsonify(get_story_points_field_config())


@bp.route('/api/story-points-field/config', methods=['POST'])
def save_story_points_field_config_endpoint():
    return _save_field_config('storyPointsField')


@bp.route('/api/parent-name-field/config', methods=['GET'])
def get_parent_name_field_config_endpoint():
    return jsonify(get_parent_name_field_config())


@bp.route('/api/parent-name-field/config', methods=['POST'])
def save_parent_name_field_config_endpoint():
    return _save_field_config('parentNameField', 'PARENT_NAME_FIELD_CACHE')


@bp.route('/api/team-field/config', methods=['GET'])
def get_team_field_config_endpoint():
    return jsonify(get_team_field_config())


@bp.route('/api/team-field/config', methods=['POST'])
def save_team_field_config_endpoint():
    return _save_field_config('teamField', 'TEAM_FIELD_CACHE')


@bp.route('/api/stats/priority-weights-config', methods=['GET'])
def get_stats_priority_weights_config_endpoint():
    payload = get_priority_weights_config()
    return jsonify(payload)


@bp.route('/api/stats/priority-weights-config', methods=['POST'])
def save_stats_priority_weights_config_endpoint():
    payload = request.get_json(silent=True) or {}
    raw_weights = payload.get('weights', [])
    try:
        normalized = normalize_priority_weight_rows(raw_weights)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        dashboard_config['statsPriorityWeights'] = normalized
        save_dashboard_config(dashboard_config)
    except Exception as e:
        return jsonify({'error': 'Failed to save stats priority weights', 'message': str(e)}), 500

    return jsonify({'weights': normalized, 'source': 'config'})


@bp.route('/api/issue-types', methods=['GET'])
def get_jira_issue_types():
    """Fetch available Jira issue types with caching."""
    try:
        with _cache_lock:
            if ISSUE_TYPES_CACHE['data'] and (time.time() - ISSUE_TYPES_CACHE['timestamp']) < ISSUE_TYPES_CACHE_TTL:
                return jsonify({'issueTypes': ISSUE_TYPES_CACHE['data']})

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
        }

        url = f'{JIRA_URL}/rest/api/3/issuetype'
        response = HTTP_SESSION.get(url, headers=headers, timeout=15)
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch issue types', 'details': response.text}), response.status_code
        data = response.json()
        result = []
        seen = set()
        for it in data:
            name = it.get('name', '')
            if name and name not in seen:
                seen.add(name)
                result.append({
                    'name': name,
                    'subtask': it.get('subtask', False),
                    'iconUrl': it.get('iconUrl', ''),
                })
        result.sort(key=lambda x: x['name'])

        with _cache_lock:
            ISSUE_TYPES_CACHE['data'] = result
            ISSUE_TYPES_CACHE['timestamp'] = time.time()

        return jsonify({'issueTypes': result})
    except Exception as e:
        return jsonify({'error': 'Failed to fetch issue types', 'details': str(e)}), 500


@bp.route('/api/issue-types/config', methods=['GET'])
def get_issue_types_config_endpoint():
    """Return configured issue types from dashboard config."""
    types = get_configured_issue_types()
    return jsonify({'issueTypes': types})


@bp.route('/api/issue-types/config', methods=['POST'])
def save_issue_types_config_endpoint():
    """Save issue types configuration."""
    payload = request.get_json(silent=True) or {}
    raw = payload.get('issueTypes', [])
    if not isinstance(raw, list):
        return jsonify({'error': 'issueTypes must be an array'}), 400
    sanitized = [str(t).strip() for t in raw if str(t).strip()]

    try:
        dashboard_config = load_dashboard_config() or {'version': 1, 'projects': {'selected': []}, 'teamGroups': {}}
        dashboard_config['issueTypes'] = sanitized
        save_dashboard_config(dashboard_config)
    except Exception as e:
        return jsonify({'error': 'Failed to save issue types config', 'message': str(e)}), 500

    # Invalidate tasks cache since query scope changed
    with _cache_lock:
        TASKS_CACHE.clear()

    return jsonify({'issueTypes': sanitized})


@bp.route('/api/fields', methods=['GET'])
def get_jira_fields():
    """Fetch available Jira fields, optionally scoped to a project."""
    project_key = request.args.get('project', '').strip()
    try:
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
        }

        if project_key:
            # Fetch fields scoped to a specific project via createmeta
            seen = {}
            url = f'{JIRA_URL}/rest/api/3/issue/createmeta/{project_key}/issuetypes'
            resp = HTTP_SESSION.get(url, headers=headers, timeout=15)
            if resp.status_code == 200:
                issue_types = (resp.json() or {}).get('issueTypes', resp.json() if isinstance(resp.json(), list) else [])
                if isinstance(issue_types, list):
                    for it in issue_types[:5]:  # sample a few issue types
                        it_id = it.get('id', '')
                        if not it_id:
                            continue
                        fields_url = f'{JIRA_URL}/rest/api/3/issue/createmeta/{project_key}/issuetypes/{it_id}'
                        fields_resp = HTTP_SESSION.get(fields_url, headers=headers, timeout=15)
                        if fields_resp.status_code == 200:
                            field_values = (fields_resp.json() or {}).get('fields', fields_resp.json() if isinstance(fields_resp.json(), list) else [])
                            if isinstance(field_values, list):
                                for fv in field_values:
                                    fid = fv.get('fieldId', fv.get('key', ''))
                                    fname = fv.get('name', '')
                                    if fid and fid not in seen:
                                        seen[fid] = {'id': fid, 'name': fname, 'custom': fid.startswith('customfield_')}
                            elif isinstance(field_values, dict):
                                for fid, fv in field_values.items():
                                    fname = fv.get('name', '') if isinstance(fv, dict) else ''
                                    if fid and fid not in seen:
                                        seen[fid] = {'id': fid, 'name': fname, 'custom': fid.startswith('customfield_')}
            if seen:
                result = sorted(seen.values(), key=lambda f: f['name'].lower())
                return jsonify({'fields': result, 'scoped': True})
            # Fallback to global fields if createmeta didn't work

        response = HTTP_SESSION.get(f'{JIRA_URL}/rest/api/3/field', headers=headers, timeout=15)
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch fields', 'details': response.text}), response.status_code
        fields = response.json() or []
        result = []
        for field in fields:
            result.append({
                'id': field.get('id', ''),
                'name': field.get('name', ''),
                'custom': field.get('custom', False),
            })
        result.sort(key=lambda f: f['name'].lower())
        return jsonify({'fields': result, 'scoped': False})
    except Exception as e:
        return jsonify({'error': 'Failed to fetch fields', 'details': str(e)}), 500
