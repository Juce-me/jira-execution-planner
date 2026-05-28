"""Pure EPM issue payload helpers."""

from backend.epm.config import DEFAULT_EPM_ISSUE_TYPES
from backend.epm.projects import normalize_epm_text
from backend.epm.scope import should_apply_epm_sprint


def dedupe_issues_by_key(issues):
    seen = set()
    deduped = []
    for issue in issues or []:
        key = issue.get('key')
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(issue)
    return deduped


def validate_epm_tab_sprint(tab, sprint):
    if should_apply_epm_sprint(tab):
        if not sprint:
            return {'error': 'sprint_required'}, 400
        if not sprint.isdigit():
            return {'error': 'sprint_not_numeric'}, 400
    return None


def normalize_epm_issue_type_sets(issue_types):
    issue_types = issue_types if isinstance(issue_types, dict) else {}
    normalized = {}
    for bucket, defaults in DEFAULT_EPM_ISSUE_TYPES.items():
        values = issue_types.get(bucket)
        if not isinstance(values, list):
            values = defaults
        normalized[bucket] = {normalize_epm_text(value).lower() for value in values if normalize_epm_text(value)}
    return normalized


def build_empty_epm_rollup_payload(project, metadata_only=False, empty_rollup=False):
    return {
        'project': project,
        'metadataOnly': metadata_only,
        'emptyRollup': empty_rollup,
        'truncated': False,
        'truncatedQueries': [],
        'initiatives': {},
        'rootEpics': {},
        'orphanStories': [],
    }


def build_epm_rollup_hierarchy(issues, issue_types):
    type_sets = normalize_epm_issue_type_sets(issue_types)
    initiative_types = type_sets['initiative']
    epic_types = type_sets['epic']
    initiatives = {}
    root_epics = {}

    for issue in issues or []:
        issue_key = issue.get('key')
        issue_type = normalize_epm_text(issue.get('issueType')).lower()
        if issue_key and issue_type in initiative_types:
            initiatives[issue_key] = {'issue': issue, 'epics': {}, 'looseStories': []}

    for issue in issues or []:
        issue_key = issue.get('key')
        issue_type = normalize_epm_text(issue.get('issueType')).lower()
        if not issue_key or issue_type not in epic_types:
            continue
        parent_key = issue.get('parentKey') or ''
        if parent_key in initiatives:
            initiatives[parent_key]['epics'][issue_key] = {'issue': issue, 'stories': []}
        else:
            root_epics[issue_key] = {'issue': issue, 'stories': []}

    epic_containers = {}
    for initiative in initiatives.values():
        for epic_key, epic in initiative['epics'].items():
            epic_containers[epic_key] = epic
    for epic_key, epic in root_epics.items():
        epic_containers[epic_key] = epic

    orphan_stories = []
    for issue in issues or []:
        issue_key = issue.get('key')
        issue_type = normalize_epm_text(issue.get('issueType')).lower()
        if not issue_key or issue_type in initiative_types or issue_type in epic_types:
            continue
        parent_key = issue.get('parentKey') or ''
        if parent_key in epic_containers:
            epic_containers[parent_key]['stories'].append(issue)
        elif parent_key in initiatives:
            initiatives[parent_key]['looseStories'].append(issue)
        else:
            orphan_stories.append(issue)

    return {
        'initiatives': initiatives,
        'rootEpics': root_epics,
        'orphanStories': orphan_stories,
    }
