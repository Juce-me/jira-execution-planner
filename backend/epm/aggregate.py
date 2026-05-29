"""Aggregate EPM project rollup orchestration."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import logging
import time
from typing import Callable


@dataclass
class EpmAggregateDependencies:
    normalize_epm_text: Callable
    validate_epm_tab_sprint: Callable
    get_epm_config: Callable
    build_epm_projects_payload: Callable
    filter_epm_projects_for_tab: Callable
    build_epm_rollup_dependencies: Callable
    get_epm_project_payload_identity: Callable
    build_empty_epm_rollup_payload: Callable
    build_per_project_rollup: Callable
    logger: logging.Logger
    now: Callable = time.perf_counter


def _collection_values(collection):
    if isinstance(collection, dict):
        return list(collection.values())
    if isinstance(collection, list):
        return collection
    return []


def collect_epm_rollup_issue_keys(rollup, normalize_epm_text):
    keys = []
    seen = set()

    def add_issue(issue):
        issue_key = normalize_epm_text((issue or {}).get('key'))
        if not issue_key or issue_key in seen:
            return
        seen.add(issue_key)
        keys.append(issue_key)

    for initiative in _collection_values((rollup or {}).get('initiatives')):
        add_issue((initiative or {}).get('issue'))
        for epic in _collection_values((initiative or {}).get('epics')):
            add_issue((epic or {}).get('issue'))
            for story in _collection_values((epic or {}).get('stories')):
                add_issue(story)
        for story in _collection_values((initiative or {}).get('looseStories')):
            add_issue(story)
    for epic in _collection_values((rollup or {}).get('rootEpics')):
        add_issue((epic or {}).get('issue'))
        for story in _collection_values((epic or {}).get('stories')):
            add_issue(story)
    for story in _collection_values((rollup or {}).get('orphanStories')):
        add_issue(story)
    return keys


def build_all_epm_projects_rollup(tab, sprint, deps: EpmAggregateDependencies, sub_goal_keys=None):
    started = deps.now()
    tab = deps.normalize_epm_text(tab or 'active').lower()
    sprint = deps.normalize_epm_text(sprint)
    validation_error = deps.validate_epm_tab_sprint(tab, sprint)
    if validation_error:
        error_payload, status = validation_error
        return error_payload, status, {}

    epm_config = deps.get_epm_config()
    projects_started = deps.now()
    projects_payload = deps.build_epm_projects_payload(epm_config, tab=tab, sub_goal_keys=sub_goal_keys)
    projects_ms = round((deps.now() - projects_started) * 1000, 1)
    visible_projects = deps.filter_epm_projects_for_tab(projects_payload.get('projects') or [], tab)
    rollup_dependencies = deps.build_epm_rollup_dependencies(sub_goal_keys=sub_goal_keys)
    entries_by_project_id = {}
    issue_memberships = {}

    def build_entry(project):
        project_id = deps.get_epm_project_payload_identity(project)
        if tab == 'archived' or not deps.normalize_epm_text(project.get('label')):
            return project_id, {
                'project': project,
                'rollup': deps.build_empty_epm_rollup_payload(project, metadata_only=True),
            }
        rollup, status, _headers = deps.build_per_project_rollup(project_id, tab, sprint, rollup_dependencies)
        if status != 200:
            rollup = deps.build_empty_epm_rollup_payload(project, metadata_only=True)
        return project_id, {'project': project, 'rollup': rollup}

    labeled_projects = [] if tab == 'archived' else [
        project for project in visible_projects if deps.normalize_epm_text(project.get('label'))
    ]
    for project in visible_projects:
        if tab == 'archived' or not deps.normalize_epm_text(project.get('label')):
            project_id, entry = build_entry(project)
            entries_by_project_id[project_id] = entry

    rollups_started = deps.now()
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_project = {executor.submit(build_entry, project): project for project in labeled_projects}
        for future in as_completed(future_to_project):
            project_id, entry = future.result()
            entries_by_project_id[project_id] = entry
    rollups_ms = round((deps.now() - rollups_started) * 1000, 1)

    ordered_entries = []
    for project in visible_projects:
        project_id = deps.get_epm_project_payload_identity(project)
        entry = entries_by_project_id.get(project_id)
        if not entry:
            continue
        ordered_entries.append(entry)
        for issue_key in collect_epm_rollup_issue_keys(entry['rollup'], deps.normalize_epm_text):
            issue_memberships.setdefault(issue_key, []).append(project_id)

    duplicates = {
        issue_key: project_ids
        for issue_key, project_ids in issue_memberships.items()
        if len(project_ids) > 1
    }
    payload = {
        'projects': ordered_entries,
        'duplicates': duplicates,
        'truncated': any(bool((entry.get('rollup') or {}).get('truncated')) for entry in ordered_entries),
        'fallback': True,
    }
    total_ms = round((deps.now() - started) * 1000, 1)
    deps.logger.info(
        "EPM all-projects rollup timing tab=%s sprint=%s projects=%d visible=%d labeled=%d home_projects_ms=%s rollups_ms=%s total_ms=%s",
        tab,
        sprint or '',
        len(projects_payload.get('projects') or []),
        len(visible_projects),
        len(labeled_projects),
        projects_ms,
        rollups_ms,
        total_ms,
    )
    return payload, 200, {
        'Server-Timing': f'home-projects;dur={projects_ms}, epm-rollups;dur={rollups_ms}, total;dur={total_ms}'
    }
