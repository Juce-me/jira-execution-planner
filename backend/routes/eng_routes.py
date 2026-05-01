"""ENG task, team, and dependency route blueprint."""

from flask import Blueprint

from . import bind_server_globals


bp = Blueprint("eng_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.route('/api/dependencies', methods=['POST'])
def get_dependencies():
    """Fetch dependency links for a set of issues."""
    try:
        payload = request.get_json(silent=True) or {}
        keys = payload.get('keys') or []
        if not keys:
            return jsonify({'dependencies': {}})

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        dependencies = collect_dependencies(keys, headers)
        return jsonify({'dependencies': dependencies})
    except Exception as e:
        logger.exception('Dependencies endpoint error')
        return jsonify({'error': 'Failed to fetch dependencies', 'message': str(e)}), 500


@bp.route('/api/issues/lookup', methods=['GET'])
def lookup_issues():
    """Lookup issues by key/id for dependency popovers."""
    try:
        keys_param = request.args.get('keys', '') or ''
        ids_param = request.args.get('ids', '') or ''
        keys = [k.strip() for k in keys_param.split(',') if k.strip()]
        ids = [i.strip() for i in ids_param.split(',') if i.strip()]
        if not keys and not ids:
            return jsonify({'issues': []})

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        team_field_id = resolve_team_field_id(headers)
        epic_link_field_id = resolve_epic_link_field_id(headers)

        fields_list = [
            'summary',
            'status',
            'issuetype',
            'assignee',
            get_story_points_field_id(),
            'parent'
        ]
        if epic_link_field_id and epic_link_field_id not in fields_list:
            fields_list.append(epic_link_field_id)
        if team_field_id and team_field_id not in fields_list:
            fields_list.append(team_field_id)

        issues = []
        if keys:
            unique_keys = sorted({str(k).strip() for k in keys if str(k).strip()})
            issues.extend(fetch_issues_by_keys(unique_keys, headers, fields_list))

        if ids:
            unique_ids = sorted({str(i).strip() for i in ids if str(i).strip()})
            jql = f'id in ({",".join(unique_ids)})'
            payload = {
                'jql': jql,
                'startAt': 0,
                'maxResults': len(unique_ids),
                'fields': fields_list
            }
            response = jira_search_request(headers, payload)
            if response.status_code == 200:
                data = response.json() or {}
                issues.extend(data.get('issues', []) or [])
            else:
                log_warning(f'Lookup fetch error: status={response.status_code}')

        snapshots = []
        for issue in issues:
            snapshot = build_issue_snapshot(issue, team_field_id, epic_link_field_id)
            snapshot['id'] = issue.get('id')
            snapshots.append(snapshot)

        return jsonify({'issues': snapshots})
    except Exception as e:
        logger.exception('Issue lookup error')
        return jsonify({'error': 'Failed to lookup issues', 'message': str(e)}), 500


@bp.route('/api/missing-info', methods=['GET'])
def get_missing_info():
    """Find stories under epics in a given sprint that are missing key planning fields (sprint/SP/team)."""
    try:
        sprint = request.args.get('sprint', '').strip()
        team_ids_param = request.args.get('teamIds', '').strip()
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])
        components_param = [c.strip() for c in request.args.get('components', '').split(',') if c.strip()]
        if not sprint:
            return jsonify({'error': 'Missing required query param: sprint'}), 400

        # Prepare authorization
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Resolve fields
        team_field_id = resolve_team_field_id(headers)
        epic_link_field_id = resolve_epic_link_field_id(headers)

        effective_components = components_param or ([MISSING_INFO_COMPONENT] if MISSING_INFO_COMPONENT else [])
        scope_clause = build_missing_info_scope_clause(team_ids or MISSING_INFO_TEAM_IDS, effective_components)

        # 1) Fetch epics that are in the sprint (future sprint planning), scoped by component/team.
        epic_jql = f'Sprint = {sprint} AND issuetype = Epic'
        if scope_clause:
            epic_jql = add_clause_to_jql(epic_jql, scope_clause)
        epic_jql = add_clause_to_jql(epic_jql, 'status not in ("Killed","Done","Incomplete")')
        epic_jql = add_clause_to_jql(epic_jql, f'project in ("{JIRA_PRODUCT_PROJECT}","{JIRA_TECH_PROJECT}")')

        epic_fields = ['summary', 'status', 'assignee', 'parent', 'components']
        if team_field_id:
            epic_fields.append(team_field_id)

        epics_resp = jira_search_request(headers, {
            'jql': epic_jql,
            'startAt': 0,
            'maxResults': 250,
            'fields': epic_fields
        })
        if epics_resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch epics for missing-info scan', 'details': epics_resp.text}), 502

        epics_data = epics_resp.json() or {}
        epic_issues = epics_data.get('issues', []) or []
        epic_keys = [e.get('key') for e in epic_issues if e.get('key')]
        if not epic_keys:
            return jsonify({'issues': [], 'epics': [], 'count': 0})

        # Build epics summary for the response
        epics_summary = []
        for epic in epic_issues:
            ef = epic.get('fields', {}) or {}
            epic_status = (ef.get('status') or {}).get('name') or ''
            epic_components = [c.get('name', '') for c in (ef.get('components') or []) if c.get('name')]
            raw_team = None
            if team_field_id and ef.get(team_field_id) is not None:
                raw_team = ef.get(team_field_id)
            epic_team_name = extract_team_name(raw_team) if raw_team else ''
            epic_team_id = None
            if raw_team:
                tv = build_team_value(raw_team)
                epic_team_id = tv.get('id') if isinstance(tv, dict) else None
            epics_summary.append({
                'key': epic.get('key'),
                'summary': ef.get('summary', ''),
                'status': epic_status,
                'components': epic_components,
                'teamName': epic_team_name,
                'teamId': epic_team_id
            })

        # 2) Fetch stories under those epics, regardless of story sprint (to catch missing Sprint field).
        story_fields = [
            'summary',
            'status',
            'priority',
            'issuetype',
            'assignee',
            'updated',
            get_story_points_field_id(),  # Story Points
            get_sprint_field_id(),  # Sprint
            'parent'
        ]
        if epic_link_field_id and epic_link_field_id not in story_fields:
            story_fields.append(epic_link_field_id)
        if team_field_id and team_field_id not in story_fields:
            story_fields.append(team_field_id)

        missing = []
        batch_size = 40
        for start in range(0, len(epic_keys), batch_size):
            batch = epic_keys[start:start + batch_size]

            link_clause = f'"Epic Link" in ({",".join(batch)})'
            parent_clause = f'parent in ({",".join(batch)})'
            # Important: do NOT scope stories by component/team here because the whole point is to
            # find stories missing those fields. We only scope epics, then pull every story under them.
            story_jql = f'({link_clause} OR {parent_clause}) AND issuetype = Story AND status not in (Killed, Done, Postponed)'

            start_at = 0
            while True:
                resp = jira_search_request(headers, {
                    'jql': story_jql,
                    'startAt': start_at,
                    'maxResults': 250,
                    'fields': story_fields
                })
                if resp.status_code != 200:
                    break

                data = resp.json() or {}
                issues = data.get('issues', []) or []
                if not issues:
                    break

                for issue in issues:
                    fields = issue.get('fields', {}) or {}
                    status = (fields.get('status') or {}).get('name') or ''
                    if str(status).strip().lower() == 'postponed':
                        continue

                    # team enrichment
                    raw_team = None
                    if team_field_id and fields.get(team_field_id) is not None:
                        raw_team = fields.get(team_field_id)
                    if raw_team is not None:
                        team_name = extract_team_name(raw_team)
                        fields['team'] = build_team_value(raw_team)
                        fields['teamName'] = team_name
                        fields['teamId'] = fields['team'].get('id') if isinstance(fields['team'], dict) else None

                    # epic link
                    epic_key = None
                    if epic_link_field_id and fields.get(epic_link_field_id):
                        epic_key = fields.get(epic_link_field_id)
                    elif fields.get('parent') and fields['parent'].get('key') and \
                            fields['parent'].get('fields', {}).get('issuetype', {}).get('name', '').lower() == 'epic':
                        epic_key = fields['parent'].get('key')
                    if epic_key:
                        fields['epicKey'] = epic_key

                    sp = fields.get(get_story_points_field_id())
                    try:
                        sp_num = float(sp) if sp not in (None, '', []) else 0.0
                    except Exception:
                        sp_num = 0.0
                    has_sp = sp_num > 0

                    sprint_value = fields.get(get_sprint_field_id())
                    has_sprint = bool(sprint_value)
                    has_team = bool(fields.get('teamName'))

                    missing_fields = []
                    if not has_sprint:
                        missing_fields.append('Sprint')
                    if not has_sp:
                        missing_fields.append('Story Points')
                    if not has_team:
                        missing_fields.append('Team')

                    if not missing_fields:
                        continue

                    assignee = fields.get('assignee') or {}
                    priority = fields.get('priority') or {}
                    issuetype = fields.get('issuetype') or {}
                    missing.append({
                        'id': issue.get('id'),
                        'key': issue.get('key'),
                        'fields': {
                            'summary': fields.get('summary'),
                            'status': {'name': status} if status else None,
                            'priority': {'name': priority.get('name')} if priority else None,
                            'issuetype': {'name': issuetype.get('name')} if issuetype else None,
                            'assignee': {'displayName': assignee.get('displayName')} if assignee else None,
                            'updated': fields.get('updated'),
                            'customfield_10004': fields.get(get_story_points_field_id()),
                            'customfield_10101': fields.get(get_sprint_field_id()),
                            'team': fields.get('team'),
                            'teamName': fields.get('teamName'),
                            'teamId': fields.get('teamId'),
                            'epicKey': fields.get('epicKey'),
                            'missingFields': missing_fields
                        }
                    })

                start_at += len(issues)
                total = data.get('total')
                if total is not None and start_at >= total:
                    break
                if len(issues) < 250:
                    break

        response = jsonify({'issues': missing, 'epics': epics_summary, 'count': len(missing), 'epicCount': len(epic_keys)})
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        logger.exception('Missing-info error')
        return jsonify({'error': 'Failed to compute missing-info', 'message': str(e)}), 500


@bp.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API."""
    return fetch_tasks(include_team_name=False)


@bp.route('/api/tasks-with-team-name', methods=['GET'])
def get_tasks_with_team_name():
    """Fetch tasks with team name derived from Jira Team field."""
    return fetch_tasks(include_team_name=True)


@bp.route('/api/teams', methods=['GET'])
def get_teams():
    """Fetch all unique teams from the current sprint."""
    try:
        sprint = request.args.get('sprint', '')
        team_ids_param = request.args.get('teamIds', '').strip()
        fetch_all = request.args.get('all', '').lower() == 'true'
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])
        use_template = bool(team_ids and JQL_QUERY_TEMPLATE) and not fetch_all

        # Prepare authorization
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Build JQL query from env or dashboard config
        if use_template:
            jql = apply_team_ids_to_template(team_ids)
            if not jql:
                jql = build_base_jql()
        else:
            jql = build_base_jql()

        if not jql:
            return jsonify({'error': 'No projects configured', 'teams': []}), 400

        # If fetching all teams, remove team filter but keep sprint scope
        if fetch_all:
            jql = remove_team_filter_from_jql(jql)
            if sprint:
                jql = add_clause_to_jql(jql, f"Sprint = {sprint}")
        elif sprint:
            jql = add_clause_to_jql(jql, f"Sprint = {sprint}")

        team_field_id = resolve_team_field_id(headers)

        # Fetch tasks - paginate through all issues
        fields_list = ['summary', 'status']
        if team_field_id:
            fields_list.append(team_field_id)

        max_results = 100
        max_pages = 30  # Cap at ~3000 issues for team discovery
        page_count = 0
        next_page_token = None
        all_issues = []

        while True:
            payload = {
                'jql': jql,
                'maxResults': max_results,
                'fields': fields_list
            }
            if next_page_token:
                payload['nextPageToken'] = next_page_token

            response = jira_search_request(headers, payload)
            if response.status_code != 200:
                return jsonify({'error': 'Failed to fetch teams', 'details': response.text}), response.status_code

            data = response.json()
            issues = data.get('issues', [])

            if not issues:
                break

            all_issues.extend(issues)
            page_count += 1
            if page_count >= max_pages:
                break

            # Check if we've fetched everything (using new pagination API)
            is_last = data.get('isLast', True)
            if is_last:
                break

            next_page_token = data.get('nextPageToken')
            if not next_page_token:
                break

        names_map = data.get('names', {}) or {}

        if not team_field_id:
            team_field_id = next((k for k, v in names_map.items() if str(v).lower() == 'team[team]'), None)

        # Extract unique teams (no filtering - return all teams)
        teams_map = {}
        for issue in all_issues:
            fields = issue.get('fields', {})
            raw_team = None

            if team_field_id and fields.get(team_field_id) is not None:
                raw_team = fields.get(team_field_id)

            if raw_team is not None:
                team_value = build_team_value(raw_team)
                team_id = team_value.get('id') if isinstance(team_value, dict) else None
                team_name = extract_team_name(raw_team)

                if team_id and team_name:
                    teams_map[team_id] = {
                        'id': team_id,
                        'name': team_name
                    }

        # When fetching all teams, also query Jira Teams API directly
        # to catch teams that have no issues in PRODUCT/TECH projects
        if fetch_all:
            api_teams = fetch_teams_from_jira_api(headers)
            for tid, tval in api_teams.items():
                if tid not in teams_map:
                    teams_map[tid] = tval

        # Sort teams by name
        teams_list = sorted(teams_map.values(), key=lambda t: t['name'].lower())

        return jsonify({'teams': teams_list})

    except Exception as e:
        return jsonify({'error': 'Failed to fetch teams', 'details': str(e)}), 500


@bp.route('/api/teams/resolve', methods=['GET'])
def resolve_team_names():
    """Resolve team names for a list of team IDs."""
    try:
        team_ids_param = request.args.get('teamIds', '').strip()
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])
        if not team_ids:
            return jsonify({'error': 'teamIds is required'}), 400

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        team_field_id = resolve_team_field_id(headers)
        if not team_field_id:
            team_field_id = TEAM_FIELD_DEFAULT

        base_jql = remove_team_filter_from_jql(build_base_jql())
        quoted = ', '.join(f'"{team_id}"' for team_id in team_ids)
        jql = add_clause_to_jql(base_jql, f'"Team[Team]" in ({quoted})')

        fields_list = ['summary']
        if team_field_id and team_field_id not in fields_list:
            fields_list.append(team_field_id)

        max_results = 250
        start_at = 0
        teams_map = {}

        while True:
            payload = {
                'jql': jql,
                'startAt': start_at,
                'maxResults': max_results,
                'fields': fields_list
            }
            response = jira_search_request(headers, payload)
            if response.status_code != 200:
                return jsonify({'error': 'Failed to resolve teams', 'details': response.text}), response.status_code
            data = response.json() or {}
            issues = data.get('issues', []) or []
            if not issues:
                break

            for issue in issues:
                fields = issue.get('fields', {}) or {}
                raw_team = None
                if team_field_id and fields.get(team_field_id) is not None:
                    raw_team = fields.get(team_field_id)
                if raw_team is None:
                    continue
                team_value = build_team_value(raw_team)
                team_id = team_value.get('id') if isinstance(team_value, dict) else None
                team_name = extract_team_name(raw_team)
                if team_id and team_name and team_id in team_ids:
                    teams_map[team_id] = {'id': team_id, 'name': team_name}

            if len(teams_map) >= len(team_ids):
                break

            start_at += len(issues)
            total = data.get('total')
            if total is not None and start_at >= total:
                break
            if len(issues) < max_results:
                break

        missing = [team_id for team_id in team_ids if team_id not in teams_map]
        return jsonify({'teams': list(teams_map.values()), 'missing': missing})

    except Exception as e:
        return jsonify({'error': 'Failed to resolve teams', 'details': str(e)}), 500


@bp.route('/api/teams/all', methods=['GET'])
def get_all_teams_list():
    """Fetch ALL teams from Jira for debugging - no filtering, simple list format."""
    try:
        sprint = request.args.get('sprint', '')

        # Prepare authorization
        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')

        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        # Build JQL query - remove team filter to get ALL teams
        jql = remove_team_filter_from_jql(build_base_jql())
        if sprint:
            jql = add_clause_to_jql(jql, f"Sprint = {sprint}")

        team_field_id = resolve_team_field_id(headers)

        # Fetch tasks
        fields_list = ['summary', 'status']
        if team_field_id:
            fields_list.append(team_field_id)

        # Paginate through ALL issues using new API
        max_results = 100
        next_page_token = None
        all_issues = []

        while True:
            payload = {
                'jql': jql,
                'maxResults': max_results,
                'fields': fields_list
            }
            if next_page_token:
                payload['nextPageToken'] = next_page_token

            response = jira_search_request(headers, payload)
            if response.status_code != 200:
                return jsonify({'error': 'Failed to fetch teams', 'details': response.text}), response.status_code

            data = response.json()
            issues = data.get('issues', [])

            if not issues:
                break

            all_issues.extend(issues)

            # Check if we've fetched everything (using new pagination API)
            is_last = data.get('isLast', True)
            if is_last:
                break

            next_page_token = data.get('nextPageToken')
            if not next_page_token:
                break

        names_map = data.get('names', {}) or {}
        if not team_field_id:
            team_field_id = next((k for k, v in names_map.items() if str(v).lower() == 'team[team]'), None)

        # Extract unique teams - NO FILTERING
        teams_map = {}
        for issue in all_issues:
            fields = issue.get('fields', {})
            raw_team = None

            if team_field_id and fields.get(team_field_id) is not None:
                raw_team = fields.get(team_field_id)

            if raw_team is not None:
                team_value = build_team_value(raw_team)
                team_id = team_value.get('id') if isinstance(team_value, dict) else None
                team_name = extract_team_name(raw_team)

                if team_id and team_name:
                    teams_map[team_id] = {
                        'id': team_id,
                        'name': team_name
                    }

        # Sort teams by name
        teams_list = sorted(teams_map.values(), key=lambda t: t['name'].lower())

        # Return simple format
        return jsonify({
            'total_teams': len(teams_list),
            'issues_fetched': len(all_issues),
            'sprint': sprint,
            'jql': jql,
            'teams': teams_list
        })

    except Exception as e:
        return jsonify({'error': 'Failed to fetch all teams', 'details': str(e)}), 500


@bp.route('/api/backlog-epics', methods=['GET'])
def get_backlog_epics():
    """Fetch backlog epics for future-planning alerts."""
    try:
        project_filter = request.args.get('project', '').strip().lower()
        team_ids_param = request.args.get('teamIds', '').strip()
        team_ids = normalize_team_ids([t.strip() for t in team_ids_param.split(',') if t.strip()])

        auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
        auth_bytes = auth_string.encode('ascii')
        auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
        headers = {
            'Authorization': f'Basic {auth_base64}',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

        if team_ids and JQL_QUERY_TEMPLATE:
            jql = apply_team_ids_to_template(team_ids) or build_base_jql()
        elif team_ids:
            jql = remove_team_filter_from_jql(build_base_jql())
            if len(team_ids) == 1:
                jql = add_clause_to_jql(jql, f'"Team[Team]" = "{team_ids[0]}"')
            else:
                quoted_teams = ', '.join(f'"{tid}"' for tid in team_ids)
                jql = add_clause_to_jql(jql, f'"Team[Team]" in ({quoted_teams})')
        else:
            jql = build_base_jql()

        if project_filter in ('product', 'tech'):
            typed = get_selected_projects_typed()
            if typed:
                matching_keys = [item['key'] for item in typed if item['type'] == project_filter]
                if matching_keys:
                    jql = remove_project_filter_from_jql(jql)
                    if len(matching_keys) == 1:
                        jql = add_clause_to_jql(jql, f'project = "{matching_keys[0]}"')
                    else:
                        quoted = ', '.join(f'"{key}"' for key in matching_keys)
                        jql = add_clause_to_jql(jql, f'project in ({quoted})')

        issue_types = get_configured_issue_types()
        if issue_types:
            if len(issue_types) == 1:
                jql = add_clause_to_jql(jql, f'type = "{issue_types[0]}"')
            else:
                quoted_types = ', '.join(f'"{issue_type}"' for issue_type in issue_types)
                jql = add_clause_to_jql(jql, f'type in ({quoted_types})')

        team_field_id = resolve_team_field_id(headers)
        epic_link_field_id = resolve_epic_link_field_id(headers)
        sprint_field_id = get_sprint_field_id()
        epics = fetch_backlog_epics_for_alert(
            jql,
            headers=headers,
            team_field_id=team_field_id,
            sprint_field_id=sprint_field_id,
            epic_link_field=epic_link_field_id
        )
        return jsonify({'epics': epics})
    except Exception as e:
        return jsonify({'error': 'Failed to fetch backlog epics', 'details': str(e)}), 500
