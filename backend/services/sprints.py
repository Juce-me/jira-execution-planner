"""Sprint cache and Jira sprint discovery helpers."""

import json
import os
import re
from datetime import datetime, timedelta


def _noop(*_args, **_kwargs):
    return None


def load_sprints_cache(cache_file, log_warning_fn=None):
    """Load sprints from cache file."""
    log_warning_fn = log_warning_fn or _noop
    try:
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as handle:
                return json.load(handle)
        return None
    except Exception as exc:
        log_warning_fn(f'Failed to load cache: {exc}')
        return None


def save_sprints_cache(
    sprints,
    *,
    cache_file,
    board_id,
    now_fn,
    log_info_fn=None,
    log_warning_fn=None,
):
    """Save sprints to cache file."""
    log_info_fn = log_info_fn or _noop
    log_warning_fn = log_warning_fn or _noop
    try:
        cache_data = {
            'timestamp': now_fn().isoformat(),
            'boardId': board_id,
            'sprints': sprints
        }
        with open(cache_file, 'w') as handle:
            json.dump(cache_data, handle, indent=2)
        log_info_fn(f'Cached {len(sprints)} sprints to {cache_file}')
        return True
    except Exception as exc:
        log_warning_fn(f'Failed to save cache: {exc}')
        return False


def is_sprints_cache_valid(
    cache_data,
    *,
    current_board_id,
    cache_expiry_hours,
    now_fn,
    log_info_fn=None,
    log_debug_fn=None,
    log_warning_fn=None,
):
    """Check if cache data is present, current, and not expired."""
    log_info_fn = log_info_fn or _noop
    log_debug_fn = log_debug_fn or _noop
    log_warning_fn = log_warning_fn or _noop
    if not cache_data or 'timestamp' not in cache_data:
        return False

    try:
        cached_board = str(cache_data.get('boardId') or '').strip()
        current_board = str(current_board_id or '').strip()
        if cached_board != current_board:
            log_info_fn(f'Cache invalidated: board changed ({cached_board!r} → {current_board!r})')
            return False

        cache_time = datetime.fromisoformat(cache_data['timestamp'])
        now = now_fn()
        expiry_time = cache_time + timedelta(hours=cache_expiry_hours)
        is_valid = now < expiry_time

        if is_valid:
            hours_old = (now - cache_time).total_seconds() / 3600
            log_debug_fn(f'Cache is valid (age: {hours_old:.1f} hours)')
        else:
            log_info_fn(f'Cache expired (age: {(now - cache_time).total_seconds() / 3600:.1f} hours)')

        return is_valid
    except Exception as exc:
        log_warning_fn(f'Failed to validate cache: {exc}')
        return False


def invalidate_sprints_cache(cache_file, log_warning_fn=None):
    """Remove the sprints cache file if present."""
    log_warning_fn = log_warning_fn or _noop
    try:
        if os.path.exists(cache_file):
            os.remove(cache_file)
        return True
    except Exception as exc:
        log_warning_fn(f'Failed to invalidate sprints cache file: {exc}')
        return False


def fetch_board_sprint_ids(board_id, *, jira_get, auth_error_class, log_warning_fn=None):
    """Fetch sprint IDs that originated on a specific board."""
    log_warning_fn = log_warning_fn or _noop
    sprint_ids = set()
    start_at = 0
    try:
        while True:
            response = jira_get(
                f'/rest/agile/1.0/board/{board_id}/sprint',
                params={'maxResults': 100, 'startAt': start_at, 'state': 'active,future,closed'},
                timeout=30
            )
            if response.status_code != 200:
                break
            data = response.json()
            values = data.get('values', [])
            for sprint in values:
                sid = sprint.get('id')
                origin = sprint.get('originBoardId')
                if sid and (origin is None or str(origin) == str(board_id)):
                    sprint_ids.add(sid)
            if data.get('isLast', False) or not values:
                break
            start_at += len(values)
    except auth_error_class:
        raise
    except Exception as exc:
        log_warning_fn(f'Failed to fetch board sprint IDs for board {board_id}: {exc}')
    return sprint_ids


def deduplicate_sprints_by_name(sprints, board_sprint_ids=None):
    """Keep one sprint per name, preferring board membership then state priority."""
    state_priority = {'active': 0, 'closed': 1, 'future': 2}
    by_name = {}
    for sprint in sprints:
        name = sprint.get('name', '')
        previous = by_name.get(name)
        if previous is None:
            by_name[name] = sprint
            continue
        if board_sprint_ids:
            previous_on_board = previous['id'] in board_sprint_ids
            current_on_board = sprint['id'] in board_sprint_ids
            if current_on_board and not previous_on_board:
                by_name[name] = sprint
                continue
            if previous_on_board and not current_on_board:
                continue
        previous_priority = state_priority.get((previous.get('state') or '').lower(), 9)
        current_priority = state_priority.get((sprint.get('state') or '').lower(), 9)
        if current_priority < previous_priority:
            by_name[name] = sprint
    return list(by_name.values())


def _format_quarter_sprint(sprint):
    name = sprint.get('name', '')
    if not re.match(r'^\d{4}Q[1-4]$', name):
        return None
    return {
        'id': sprint.get('id'),
        'name': name,
        'state': sprint.get('state', ''),
        'startDate': sprint.get('startDate'),
        'endDate': sprint.get('endDate'),
    }


def _collect_sprints_by_jql(jql_query, sprints_dict, *, jira_search_request, get_sprint_field_id):
    total_issues = 0
    next_page_token = None
    while True:
        sprint_field_id = get_sprint_field_id()
        payload = {
            'jql': jql_query,
            'maxResults': 200,
            'fields': [sprint_field_id]
        }
        if next_page_token:
            payload['nextPageToken'] = next_page_token

        response = jira_search_request(payload)
        if response.status_code != 200:
            break

        data = response.json()
        issues = data.get('issues', [])

        for issue in issues:
            sprint_field = issue.get('fields', {}).get(sprint_field_id, [])
            if sprint_field and isinstance(sprint_field, list):
                for sprint in sprint_field:
                    if not sprint or not isinstance(sprint, dict):
                        continue
                    formatted = _format_quarter_sprint(sprint)
                    if formatted and formatted.get('id'):
                        sprints_dict[formatted['id']] = formatted

        total_issues += len(issues)
        next_page_token = data.get('nextPageToken')
        if data.get('isLast', not next_page_token) or not next_page_token:
            break

    return total_issues


def fetch_sprints_from_jira(
    *,
    board_id,
    stats_jql_base,
    product_project,
    tech_project,
    jira_get,
    jira_search_request,
    get_sprint_field_id,
    strip_sprint_clause,
    add_clause_to_jql,
    auth_error_class,
    fetch_board_sprint_ids_fn=None,
    log_info_fn=None,
    log_warning_fn=None,
):
    """Fetch sprints from Jira without using the local file cache."""
    log_info_fn = log_info_fn or _noop
    log_warning_fn = log_warning_fn or _noop
    formatted_sprints = []
    effective_board_id = str(board_id or '').strip()
    board_sprint_ids = None

    if fetch_board_sprint_ids_fn is None:
        fetch_board_sprint_ids_fn = lambda current_board_id, _headers: fetch_board_sprint_ids(
            current_board_id,
            jira_get=jira_get,
            auth_error_class=auth_error_class,
            log_warning_fn=log_warning_fn,
        )

    if effective_board_id:
        try:
            log_info_fn(f'Fetching sprints from board {effective_board_id}')
            start_at = 0
            response = None
            while True:
                response = jira_get(
                    f'/rest/agile/1.0/board/{effective_board_id}/sprint',
                    params={'maxResults': 100, 'startAt': start_at, 'state': 'active,future,closed'},
                    timeout=30
                )

                if response.status_code != 200:
                    log_warning_fn(f'Board API returned {response.status_code}, trying alternative method')
                    break

                data = response.json()
                board_sprints = data.get('values', [])
                for sprint in board_sprints:
                    origin = sprint.get('originBoardId')
                    if origin is not None and str(origin) != str(effective_board_id):
                        continue
                    formatted = _format_quarter_sprint(sprint)
                    if formatted:
                        formatted_sprints.append(formatted)

                if data.get('isLast', False) or not board_sprints:
                    break

                start_at += len(board_sprints)

            if formatted_sprints:
                board_sprint_ids = {s['id'] for s in formatted_sprints}
                log_info_fn(f'Found {len(formatted_sprints)} sprints from board')
            elif response is not None:
                log_warning_fn(f'Board API returned {response.status_code}, trying alternative method')
        except auth_error_class:
            raise
        except Exception as board_error:
            log_warning_fn(f'Board API failed: {board_error}, trying alternative method')

    if len(formatted_sprints) == 0:
        log_info_fn('Fetching sprints from issues (alternative method)')

        base_jql = stats_jql_base or f'project in ("{product_project}","{tech_project}")'
        base_jql = strip_sprint_clause(base_jql)

        sprints_dict = {}
        issues_count = _collect_sprints_by_jql(
            base_jql,
            sprints_dict,
            jira_search_request=jira_search_request,
            get_sprint_field_id=get_sprint_field_id,
        )
        closed_jql = add_clause_to_jql(base_jql, 'Sprint in closedSprints()')
        issues_count += _collect_sprints_by_jql(
            closed_jql,
            sprints_dict,
            jira_search_request=jira_search_request,
            get_sprint_field_id=get_sprint_field_id,
        )
        future_jql = add_clause_to_jql(base_jql, 'Sprint in futureSprints()')
        issues_count += _collect_sprints_by_jql(
            future_jql,
            sprints_dict,
            jira_search_request=jira_search_request,
            get_sprint_field_id=get_sprint_field_id,
        )
        open_jql = add_clause_to_jql(base_jql, 'Sprint in openSprints()')
        issues_count += _collect_sprints_by_jql(
            open_jql,
            sprints_dict,
            jira_search_request=jira_search_request,
            get_sprint_field_id=get_sprint_field_id,
        )

        formatted_sprints = list(sprints_dict.values())
        log_info_fn(f'Found {len(formatted_sprints)} unique sprints from {issues_count} issues')

        if effective_board_id:
            board_sprint_ids = fetch_board_sprint_ids_fn(effective_board_id, None)
            if board_sprint_ids:
                before_count = len(formatted_sprints)
                formatted_sprints = [s for s in formatted_sprints if s['id'] in board_sprint_ids]
                filtered_count = before_count - len(formatted_sprints)
                if filtered_count:
                    log_info_fn(f'Filtered out {filtered_count} cross-board sprints (board {effective_board_id})')

    if effective_board_id and board_sprint_ids is None:
        board_sprint_ids = fetch_board_sprint_ids_fn(effective_board_id, None)
    before_dedup = len(formatted_sprints)
    formatted_sprints = deduplicate_sprints_by_name(formatted_sprints, board_sprint_ids)
    dedup_removed = before_dedup - len(formatted_sprints)
    if dedup_removed:
        log_info_fn(f'Deduplicated {dedup_removed} sprints with duplicate names')

    formatted_sprints.sort(key=lambda item: item['name'], reverse=True)
    return formatted_sprints
