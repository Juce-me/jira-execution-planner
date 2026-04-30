from dataclasses import dataclass
from typing import Callable, MutableMapping
import time

from epm_scope import build_rollup_jqls, should_apply_epm_sprint


@dataclass
class EpmRollupDependencies:
    # Temporary migration boundary: keeps jira_server patch targets working
    # while avoiding circular imports. Do not reuse this large dependency
    # object pattern for new feature modules.
    find_epm_project_or_404: Callable
    normalize_epm_text: Callable
    validate_epm_tab_sprint: Callable
    build_empty_epm_rollup_payload: Callable
    build_base_jql: Callable
    add_clause_to_jql: Callable
    build_jira_headers: Callable
    resolve_epic_link_field_id: Callable
    resolve_team_field_id: Callable
    build_epm_rollup_fields_list: Callable
    get_epm_config: Callable
    normalize_epm_issue_type_sets: Callable
    fetch_epm_rollup_query: Callable
    shape_epm_rollup_issue_payload: Callable
    dedupe_issues_by_key: Callable
    build_epm_rollup_hierarchy: Callable
    cache: MutableMapping
    cache_lock: object
    cache_ttl_seconds: int
    now: Callable = time.time


def _issue_type_name(issue, normalize_text):
    return normalize_text((issue or {}).get('issueType')).lower()


def _issue_matches_sprint(issue, sprint):
    sprint_id = str(sprint or '').strip()
    if not sprint_id:
        return True
    for entry in (issue or {}).get('sprint') or []:
        if str((entry or {}).get('id') or '').strip() == sprint_id:
            return True
    return False


def _filter_active_leaf_issues(issues, issue_type_sets, sprint, normalize_text):
    initiative_or_epic_types = issue_type_sets['initiative'] | issue_type_sets['epic']
    filtered = []
    for issue in issues or []:
        issue_type = _issue_type_name(issue, normalize_text)
        if issue_type in initiative_or_epic_types or _issue_matches_sprint(issue, sprint):
            filtered.append(issue)
    return filtered


def _issue_has_empty_sprint(issue):
    return len((issue or {}).get('sprint') or []) == 0


def _is_backlog_excluded_epic(issue, normalize_text):
    status = normalize_text((issue or {}).get('status')).lower()
    return status in {'done', 'in progress', 'killed', 'incomplete'}


def _filter_backlog_rollup_issues(issues, issue_type_sets, normalize_text):
    initiative_types = issue_type_sets['initiative']
    epic_types = issue_type_sets['epic']
    filtered = []
    for issue in issues or []:
        issue_type = _issue_type_name(issue, normalize_text)
        if issue_type in epic_types:
            if not _is_backlog_excluded_epic(issue, normalize_text):
                filtered.append(issue)
            continue
        if issue_type in initiative_types or _issue_has_empty_sprint(issue):
            filtered.append(issue)
    return filtered


def _prune_backlog_hierarchy(hierarchy, normalize_text):
    pruned_initiatives = {}
    for initiative_key, initiative in (hierarchy.get('initiatives') or {}).items():
        pruned_epics = {}
        for epic_key, epic in (initiative.get('epics') or {}).items():
            if _is_backlog_excluded_epic(epic.get('issue'), normalize_text):
                continue
            stories = [story for story in epic.get('stories') or [] if _issue_has_empty_sprint(story)]
            if stories:
                pruned_epics[epic_key] = {**epic, 'stories': stories}
        loose_stories = [story for story in initiative.get('looseStories') or [] if _issue_has_empty_sprint(story)]
        if pruned_epics or loose_stories:
            pruned_initiatives[initiative_key] = {
                **initiative,
                'epics': pruned_epics,
                'looseStories': loose_stories,
            }

    pruned_root_epics = {}
    for epic_key, epic in (hierarchy.get('rootEpics') or {}).items():
        if _is_backlog_excluded_epic(epic.get('issue'), normalize_text):
            continue
        stories = [story for story in epic.get('stories') or [] if _issue_has_empty_sprint(story)]
        if stories:
            pruned_root_epics[epic_key] = {**epic, 'stories': stories}

    return {
        **hierarchy,
        'initiatives': pruned_initiatives,
        'rootEpics': pruned_root_epics,
        'orphanStories': [story for story in hierarchy.get('orphanStories') or [] if _issue_has_empty_sprint(story)],
    }


def _hierarchy_has_issues(hierarchy):
    return bool(
        (hierarchy.get('initiatives') or {})
        or (hierarchy.get('rootEpics') or {})
        or (hierarchy.get('orphanStories') or [])
    )


def build_per_project_rollup(project_id, tab, sprint, deps):
    tab = str(tab or 'active').strip().lower()
    sprint = str(sprint or '').strip()
    validation_error = deps.validate_epm_tab_sprint(tab, sprint)
    if validation_error:
        error_payload, status = validation_error
        return error_payload, status, {}

    project = deps.find_epm_project_or_404(project_id)
    label = deps.normalize_epm_text(project.get('label'))
    rollup_jqls = build_rollup_jqls(label)
    if not rollup_jqls:
        return deps.build_empty_epm_rollup_payload(project, metadata_only=True), 200, {}

    base_jql = deps.build_base_jql()
    cache_key = f"{project_id}::{tab}::{sprint}::{label}::{base_jql}"
    with deps.cache_lock:
        cached = deps.cache.get(cache_key)
    if cached and (deps.now() - cached['timestamp']) < deps.cache_ttl_seconds:
        return cached['data'], 200, {'Server-Timing': 'cache;dur=1'}

    started = time.perf_counter()
    s1_jql, child_predicate = rollup_jqls
    headers = deps.build_jira_headers()
    epic_link_field_id = deps.resolve_epic_link_field_id(headers)
    team_field_id = deps.resolve_team_field_id(headers)
    fields_list = deps.build_epm_rollup_fields_list(epic_link_field_id, team_field_id)
    epm_config = deps.get_epm_config()
    issue_type_sets = deps.normalize_epm_issue_type_sets(epm_config.get('issueTypes') or {})
    truncated_queries = []

    def with_sprint_filter(jql):
        if should_apply_epm_sprint(tab):
            return deps.add_clause_to_jql(jql, f'Sprint = {sprint}')
        return jql

    def filter_leaf_issues_for_tab(issues):
        if should_apply_epm_sprint(tab):
            return _filter_active_leaf_issues(issues, issue_type_sets, sprint, deps.normalize_epm_text)
        if tab == 'backlog':
            return _filter_backlog_rollup_issues(issues, issue_type_sets, deps.normalize_epm_text)
        return issues

    q1_jql = deps.add_clause_to_jql(base_jql, s1_jql)
    q1_raw = deps.fetch_epm_rollup_query(q1_jql, 'q1', headers, fields_list, truncated_queries)
    if not q1_raw:
        payload = deps.build_empty_epm_rollup_payload(project, empty_rollup=True)
        with deps.cache_lock:
            deps.cache[cache_key] = {'timestamp': deps.now(), 'data': payload}
        return payload, 200, {'Server-Timing': f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'}

    q1_issues, _ = deps.shape_epm_rollup_issue_payload(q1_raw, epic_link_field_id=epic_link_field_id, team_field_id=team_field_id)
    q1_issues = filter_leaf_issues_for_tab(q1_issues)
    initiative_or_epic_types = issue_type_sets['initiative'] | issue_type_sets['epic']
    q2_seed_keys = sorted({
        issue.get('key')
        for issue in q1_issues
        if deps.normalize_epm_text(issue.get('issueType')).lower() in initiative_or_epic_types and issue.get('key')
    })

    q2_issues = []
    q2_predicate = child_predicate(q2_seed_keys)
    if q2_predicate:
        q2_has_initiative_seed = any(
            issue.get('key') in q2_seed_keys and _issue_type_name(issue, deps.normalize_epm_text) in issue_type_sets['initiative']
            for issue in q1_issues
        )
        q2_jql = deps.add_clause_to_jql(base_jql, q2_predicate)
        if not q2_has_initiative_seed:
            q2_jql = with_sprint_filter(q2_jql)
        q2_raw = deps.fetch_epm_rollup_query(q2_jql, 'q2', headers, fields_list, truncated_queries)
        q2_issues, _ = deps.shape_epm_rollup_issue_payload(q2_raw, epic_link_field_id=epic_link_field_id, team_field_id=team_field_id)
        q2_issues = filter_leaf_issues_for_tab(q2_issues)

    q3_seed_keys = sorted({
        issue.get('key')
        for issue in q2_issues
        if deps.normalize_epm_text(issue.get('issueType')).lower() in issue_type_sets['epic'] and issue.get('key')
    })

    q3_issues = []
    q3_predicate = child_predicate(q3_seed_keys)
    if q3_predicate:
        q3_jql = with_sprint_filter(deps.add_clause_to_jql(base_jql, q3_predicate))
        q3_raw = deps.fetch_epm_rollup_query(q3_jql, 'q3', headers, fields_list, truncated_queries)
        q3_issues, _ = deps.shape_epm_rollup_issue_payload(q3_raw, epic_link_field_id=epic_link_field_id, team_field_id=team_field_id)
        q3_issues = filter_leaf_issues_for_tab(q3_issues)

    hierarchy = deps.build_epm_rollup_hierarchy(
        deps.dedupe_issues_by_key(q1_issues + q2_issues + q3_issues),
        epm_config.get('issueTypes') or {},
    )
    if tab == 'backlog':
        hierarchy = _prune_backlog_hierarchy(hierarchy, deps.normalize_epm_text)
    if not _hierarchy_has_issues(hierarchy):
        payload = deps.build_empty_epm_rollup_payload(project, empty_rollup=True)
        payload['truncated'] = bool(truncated_queries)
        payload['truncatedQueries'] = truncated_queries
        with deps.cache_lock:
            deps.cache[cache_key] = {'timestamp': deps.now(), 'data': payload}
        return payload, 200, {'Server-Timing': f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'}
    payload = {
        'project': project,
        'metadataOnly': False,
        'emptyRollup': False,
        'truncated': bool(truncated_queries),
        'truncatedQueries': truncated_queries,
        **hierarchy,
    }
    with deps.cache_lock:
        deps.cache[cache_key] = {'timestamp': deps.now(), 'data': payload}
    return payload, 200, {'Server-Timing': f'jira-search;dur={round((time.perf_counter() - started) * 1000, 1)}'}
