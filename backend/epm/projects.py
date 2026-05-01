from dataclasses import dataclass
import json
import time
from typing import Callable, MutableMapping

from backend.epm import home as epm_home


@dataclass
class EpmProjectsDependencies:
    fetch_epm_home_projects: Callable
    merge_epm_linkage: Callable
    normalize_epm_config: Callable
    utc_now_iso: Callable
    cache: MutableMapping
    cache_lock: object
    cache_ttl_seconds: int
    home_project_limit: int
    get_epm_config: Callable | None = None
    abort_not_found: Callable | None = None
    now: Callable = time.time


def normalize_epm_text(value):
    return str(value or '').strip()


def normalize_epm_upper_text(value):
    return normalize_epm_text(value).upper()


def build_epm_home_projects_cache_key(epm_scope):
    scope = epm_scope if isinstance(epm_scope, dict) else {}
    return json.dumps({
        'rootGoalKey': normalize_epm_upper_text(scope.get('rootGoalKey')),
        'subGoalKey': normalize_epm_upper_text(scope.get('subGoalKey')),
    }, sort_keys=True)


def build_epm_home_projects_state(epm_scope, deps, force_refresh=False):
    cache_key = build_epm_home_projects_cache_key(epm_scope)
    if not force_refresh:
        with deps.cache_lock:
            cached = deps.cache.get(cache_key)
            if cached and (deps.now() - cached['timestamp']) < deps.cache_ttl_seconds:
                return {
                    'homeProjects': cached.get('homeProjects', []),
                    'cacheHit': True,
                    'fetchedAt': cached.get('fetchedAt', ''),
                    'homeProjectCount': len(cached.get('homeProjects', [])),
                    'homeProjectLimit': cached.get('homeProjectLimit'),
                    'possiblyTruncated': bool(cached.get('possiblyTruncated')),
                }

    home_projects = deps.fetch_epm_home_projects(epm_scope)
    possibly_truncated = bool(deps.home_project_limit and len(home_projects) >= deps.home_project_limit)
    fetched_at = deps.utc_now_iso(timespec='seconds')
    with deps.cache_lock:
        deps.cache[cache_key] = {
            'timestamp': deps.now(),
            'fetchedAt': fetched_at,
            'homeProjects': home_projects,
            'homeProjectLimit': deps.home_project_limit,
            'possiblyTruncated': possibly_truncated,
        }
    return {
        'homeProjects': home_projects,
        'cacheHit': False,
        'fetchedAt': fetched_at,
        'homeProjectCount': len(home_projects),
        'homeProjectLimit': deps.home_project_limit,
        'possiblyTruncated': possibly_truncated,
    }


def get_cached_epm_home_projects(epm_scope, deps, force_refresh=False):
    return build_epm_home_projects_state(epm_scope, deps, force_refresh=force_refresh)['homeProjects']


def normalize_epm_label_prefix_mask(label_prefix):
    prefix = normalize_epm_text(label_prefix)
    while prefix.endswith('*'):
        prefix = prefix[:-1].strip()
    return prefix


def filter_epm_home_tag_matches(home_project, label_prefix):
    prefix = normalize_epm_label_prefix_mask(label_prefix)
    home_tags = home_project.get('homeTags') if isinstance(home_project, dict) else []
    if not isinstance(home_tags, list):
        home_tags = []
    if not prefix:
        return []
    normalized_prefix = prefix.lower()
    matches = []
    seen = set()
    for tag in home_tags:
        tag_text = normalize_epm_text(tag)
        if not tag_text or not tag_text.lower().startswith(normalized_prefix):
            continue
        dedupe_key = tag_text.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        matches.append(tag_text)
    return matches


def resolve_epm_project_label(home_project, config_row, label_prefix):
    row = config_row or {}
    manual_label = normalize_epm_text(row.get('label') if 'label' in row else row.get('jiraLabel'))
    home_tags = home_project.get('homeTags') if isinstance(home_project, dict) else []
    has_home_tags_field = isinstance(home_tags, list)
    home_tags = [normalize_epm_text(tag) for tag in (home_tags if has_home_tags_field else []) if normalize_epm_text(tag)]
    home_tag_matches = filter_epm_home_tag_matches({'homeTags': home_tags}, label_prefix)

    if not has_home_tags_field:
        legacy_labels = list(((home_project or {}).get('resolvedLinkage') or {}).get('labels') or [])
        home_tag_matches = [normalize_epm_text(label) for label in legacy_labels if normalize_epm_text(label)]

    if manual_label:
        if not has_home_tags_field and manual_label in home_tag_matches:
            return {
                'label': manual_label,
                'labelSource': 'home-tag',
                'labelStatus': 'auto',
                'homeTags': home_tags,
                'homeTagMatches': home_tag_matches,
            }
        return {
            'label': manual_label,
            'labelSource': 'manual',
            'labelStatus': 'manual',
            'homeTags': home_tags,
            'homeTagMatches': home_tag_matches,
        }

    if len(home_tag_matches) == 1:
        return {
            'label': home_tag_matches[0],
            'labelSource': 'home-tag',
            'labelStatus': 'auto',
            'homeTags': home_tags,
            'homeTagMatches': home_tag_matches,
        }

    if len(home_tag_matches) > 1:
        return {
            'label': '',
            'labelSource': '',
            'labelStatus': 'ambiguous',
            'homeTags': home_tags,
            'homeTagMatches': home_tag_matches,
        }

    status = 'unavailable' if (home_project or {}).get('homeTagsUnavailable') else 'missing'
    return {
        'label': '',
        'labelSource': '',
        'labelStatus': status,
        'homeTags': home_tags,
        'homeTagMatches': [],
    }


def build_epm_project_payload(home_project, config_row, label_prefix=None, merge_epm_linkage=epm_home.merge_epm_linkage):
    row = config_row or {}
    linkage_row = dict(row)
    if 'jiraLabel' not in linkage_row and 'label' in row:
        linkage_row['jiraLabel'] = row.get('label')
    linkage, match_state = merge_epm_linkage(home_project, linkage_row)
    label_resolution = resolve_epm_project_label(home_project, row, label_prefix)
    resolved_label = label_resolution['label']
    custom_name = normalize_epm_text(row.get('name') if 'name' in row else row.get('customName'))
    resolved_epics = sorted(set(linkage.get('epicKeys') or []))
    resolved_labels = [resolved_label] if resolved_label else []
    if resolved_label:
        match_state = 'home-linked' if label_resolution['labelSource'] == 'home-tag' else 'jep-fallback'
    elif resolved_epics:
        match_state = 'home-linked'
    else:
        match_state = 'metadata-only'
    return {
        **home_project,
        'id': normalize_epm_text(row.get('id')) or home_project.get('homeProjectId', ''),
        'name': custom_name or home_project.get('name', ''),
        'label': resolved_label,
        'customName': custom_name,
        'displayName': custom_name or home_project.get('name', ''),
        'resolvedLinkage': {'labels': resolved_labels, 'epicKeys': resolved_epics},
        'matchState': match_state,
        **label_resolution,
    }


def build_custom_project_payload(row):
    label = normalize_epm_text(row.get('label'))
    name = normalize_epm_text(row.get('name'))
    return {
        'id': normalize_epm_text(row.get('id')),
        'homeProjectId': None,
        'homeUrl': '',
        'stateValue': '',
        'stateLabel': '',
        'tabBucket': 'all',
        'latestUpdateDate': '',
        'latestUpdateSnippet': '',
        'latestUpdateHtml': '',
        'name': name,
        'label': label,
        'customName': name,
        'displayName': name,
        'resolvedLinkage': {'labels': [label] if label else [], 'epicKeys': []},
        'matchState': 'jep-fallback' if label else 'metadata-only',
        'labelSource': 'manual' if label else '',
        'labelStatus': 'manual' if label else 'missing',
        'homeTags': [],
        'homeTagMatches': [],
    }


def find_epm_config_row(projects, project_id):
    normalized_project_id = normalize_epm_text(project_id)
    if not normalized_project_id or not isinstance(projects, dict):
        return None
    for key, row in projects.items():
        if not isinstance(row, dict):
            continue
        candidates = [
            normalize_epm_text(key),
            normalize_epm_text(row.get('id')),
            normalize_epm_text(row.get('homeProjectId')),
        ]
        if normalized_project_id in candidates:
            return row
    return None


def build_epm_projects_payload(epm_config, deps, force_refresh=False, tab=None):
    normalized_config = deps.normalize_epm_config(epm_config or {})
    projects = []
    epm_scope = normalized_config.get('scope') or {}
    home_state = build_epm_home_projects_state(epm_scope, deps, force_refresh=force_refresh)
    returned_home_project_ids = set()
    for home_project in home_state['homeProjects']:
        project_id = home_project.get('homeProjectId')
        if project_id:
            returned_home_project_ids.add(project_id)
        config_row = find_epm_config_row(normalized_config['projects'], project_id)
        projects.append(
            build_epm_project_payload(
                home_project,
                config_row,
                normalized_config.get('labelPrefix'),
                merge_epm_linkage=deps.merge_epm_linkage,
            )
        )
    for row in normalized_config['projects'].values():
        home_project_id = normalize_epm_text(row.get('homeProjectId'))
        if home_project_id and home_project_id in returned_home_project_ids:
            continue
        if home_project_id:
            missing_home_row = build_custom_project_payload(row)
            missing_home_row['homeProjectId'] = home_project_id
            missing_home_row['missingFromHomeFetch'] = True
            missing_home_row['matchState'] = 'missing-home-project'
            projects.append(missing_home_row)
            continue
        projects.append(build_custom_project_payload(row))
    filtered_projects = filter_epm_projects_for_tab(projects, tab) if normalize_epm_text(tab) else projects
    return {
        'projects': filtered_projects,
        'cacheHit': home_state['cacheHit'],
        'fetchedAt': home_state['fetchedAt'],
        'homeProjectCount': home_state['homeProjectCount'],
        'homeProjectLimit': home_state['homeProjectLimit'],
        'possiblyTruncated': home_state['possiblyTruncated'],
    }


def filter_epm_projects_for_tab(projects, tab):
    normalized_tab = normalize_epm_text(tab or 'active').lower()
    visible = []
    for project in projects or []:
        tab_bucket = normalize_epm_text((project or {}).get('tabBucket')).lower()
        if tab_bucket not in {'active', 'backlog', 'archived', 'all'}:
            state_value = normalize_epm_text((project or {}).get('stateValue') or (project or {}).get('stateLabel'))
            tab_bucket = epm_home.bucket_epm_state(state_value) if state_value else ''
        if normalized_tab == 'active':
            matches_tab = tab_bucket == 'active' or tab_bucket == 'all'
        else:
            matches_tab = tab_bucket == normalized_tab
        if matches_tab:
            visible.append(project)
    return visible


def find_epm_project_or_404(project_id, deps):
    epm_config = deps.get_epm_config()
    epm_scope = epm_config.get('scope') or {}
    config_row = find_epm_config_row(epm_config['projects'], project_id)

    if config_row is not None:
        home_project_id = normalize_epm_text(config_row.get('homeProjectId'))
        if not home_project_id:
            return build_custom_project_payload(config_row)
        for home_project in get_cached_epm_home_projects(epm_scope, deps):
            if home_project.get('homeProjectId') == home_project_id:
                return build_epm_project_payload(
                    home_project,
                    config_row,
                    epm_config.get('labelPrefix'),
                    merge_epm_linkage=deps.merge_epm_linkage,
                )

    for home_project in get_cached_epm_home_projects(epm_scope, deps):
        if home_project.get('homeProjectId') == project_id:
            config_row = find_epm_config_row(epm_config['projects'], project_id)
            return build_epm_project_payload(
                home_project,
                config_row,
                epm_config.get('labelPrefix'),
                merge_epm_linkage=deps.merge_epm_linkage,
            )

    deps.abort_not_found(404)


def get_epm_project_payload_identity(project):
    return normalize_epm_text((project or {}).get('id'))
