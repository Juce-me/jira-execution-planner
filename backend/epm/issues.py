"""EPM project issue payload orchestration."""

from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Callable, MutableMapping

from backend.auth.cache_policy import (
    build_jira_home_process_cache_key,
    jira_home_partitioned_process_cache_enabled,
)
from backend.epm.scope import should_apply_epm_sprint


@dataclass
class EpmIssuesDependencies:
    # Inject the legacy cache object so jira_server.EPM_ISSUES_CACHE remains
    # patchable while the endpoint orchestration moves into backend.epm.
    find_epm_project_or_404: Callable
    validate_epm_tab_sprint: Callable
    build_epm_scope_clause: Callable
    build_base_jql: Callable
    add_clause_to_jql: Callable
    fetch_issues_by_jql: Callable
    build_epm_fields_list: Callable
    shape_epm_issue_payload: Callable
    dedupe_issues_by_key: Callable
    cache: MutableMapping
    cache_lock: object
    cache_ttl_seconds: int
    context: object = None
    now: Callable = time.time
    timer: Callable = time.perf_counter


def build_epm_project_issues_payload(home_project_id, tab, sprint, deps: EpmIssuesDependencies):
    tab = str(tab or 'active').strip().lower()
    sprint = str(sprint or '').strip()
    validation_error = deps.validate_epm_tab_sprint(tab, sprint)
    if validation_error:
        error_payload, status = validation_error
        return error_payload, status, {}

    project = deps.find_epm_project_or_404(home_project_id)
    linkage = project['resolvedLinkage']
    scope_clause = deps.build_epm_scope_clause(linkage)
    if not scope_clause:
        return {'project': project, 'issues': [], 'epics': {}, 'metadataOnly': True}, 200, {}

    base_jql = deps.build_base_jql()
    cache_enabled = jira_home_partitioned_process_cache_enabled(deps.context)
    cache_key = build_jira_home_process_cache_key(
        deps.context,
        f"{home_project_id}::{tab}::{sprint}::{base_jql}::{json.dumps(linkage, sort_keys=True)}",
    )
    cached = None
    if cache_enabled:
        with deps.cache_lock:
            cached = deps.cache.get(cache_key)
    if cache_enabled and cached and (deps.now() - cached['timestamp']) < deps.cache_ttl_seconds:
        return cached['data'], 200, {'Server-Timing': 'cache;dur=1'}

    started = deps.timer()
    jql = deps.add_clause_to_jql(base_jql, scope_clause)
    if should_apply_epm_sprint(tab):
        jql = deps.add_clause_to_jql(jql, f'Sprint = {sprint}')
    issues = deps.fetch_issues_by_jql(jql, deps.build_epm_fields_list(), context=deps.context)
    slim_issues, epic_details = deps.shape_epm_issue_payload(issues)
    payload = {
        'project': project,
        'issues': deps.dedupe_issues_by_key(slim_issues),
        'epics': epic_details,
        'metadataOnly': False,
    }
    if cache_enabled:
        with deps.cache_lock:
            deps.cache[cache_key] = {'timestamp': deps.now(), 'data': payload}
    return payload, 200, {'Server-Timing': f'jira-search;dur={round((deps.timer() - started) * 1000, 1)}'}
