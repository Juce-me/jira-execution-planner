"""Pure task-discovery assembly shared by ENG reads and Planning admission.

Callers capture configuration and resolve work roles before entering this module.
Readiness labels/Components and parent placeholders are not task discovery inputs.
"""
from __future__ import annotations

import hashlib
import json
import re

from backend.services.planning_work import WorkRoles


def normalize_discovery_team_ids(team_ids):
    seen, result = set(), []
    for item in team_ids or []:
        value = str(item or '').strip()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def append_discovery_clause(jql, clause):
    """The task reader's existing literal ORDER BY insertion, preserved exactly."""
    if not clause:
        return jql
    if 'ORDER BY' in jql:
        parts = jql.split('ORDER BY')
        base, order = parts[0].strip(), parts[1].strip()
        return f'{base} AND {clause} ORDER BY {order}' if base else f'{clause} ORDER BY {order}'
    if not jql.strip():
        return clause
    return f'{jql} AND {clause}'


def remove_discovery_team_filter(jql):
    """Keep the captured task reader's Team[Team] replacement semantics."""
    if not jql:
        return jql
    jql = re.sub(r'\s+AND\s+"Team\[Team\]"\s+in\s*\([^)]+\)', '', jql, flags=re.IGNORECASE)
    jql = re.sub(r'"Team\[Team\]"\s+in\s*\([^)]+\)\s+AND\s+', '', jql, flags=re.IGNORECASE)
    jql = re.sub(r'\s+AND\s+"Team\[Team\]"\s*=\s*[^\s]+', '', jql, flags=re.IGNORECASE)
    jql = re.sub(r'"Team\[Team\]"\s*=\s*[^\s]+\s+AND\s+', '', jql, flags=re.IGNORECASE)
    jql = re.sub(r'"Team\[Team\]"\s+in\s*\([^)]+\)\s*(?=ORDER BY|$)', '', jql, flags=re.IGNORECASE)
    jql = re.sub(r'"Team\[Team\]"\s*=\s*[^\s]+\s*(?=ORDER BY|$)', '', jql, flags=re.IGNORECASE)
    return jql.strip()


def build_task_discovery_jql(base_jql, team_ids, sprint, *, roles=None, team_jql_template=''):
    """Base/template -> Department Teams -> Sprint, before display project facets."""
    ids = normalize_discovery_team_ids(team_ids)
    if ids and team_jql_template:
        quoted = ', '.join(f'"{item}"' for item in ids)
        jql = team_jql_template.replace('{TEAM_IDS}', quoted) or base_jql
    elif ids:
        jql = remove_discovery_team_filter(base_jql)
        if roles is not None:
            clause = roles.team_clause(ids)
        elif len(ids) == 1:
            clause = f'"Team[Team]" = "{ids[0]}"'
        else:
            clause = '"Team[Team]" in (' + ', '.join(f'"{item}"' for item in ids) + ')'
        jql = append_discovery_clause(jql, clause)
    else:
        jql = base_jql
    if sprint:
        jql = append_discovery_clause(jql, roles.sprint_clause(sprint) if roles is not None else f'Sprint = {sprint}')
    return jql


def append_task_planning_clause(jql, *, roles=None, issue_types=None):
    """Append the existing planning type rule after any display project facet."""
    if roles is not None:
        return append_discovery_clause(jql, roles.planning_clause())
    names = ['Story'] if issue_types is None else issue_types
    if len(names) == 1:
        return append_discovery_clause(jql, f'type = "{names[0]}"')
    if names:
        return append_discovery_clause(jql, 'type in (' + ', '.join(f'"{name}"' for name in names) + ')')
    return jql


def compile_planning_inclusion_scope(config_snapshot, group_snapshot, admitted_sprint, work_context):
    """Compile authoritative Department/Sprint candidates without I/O or UI filters.

    ``base_jql`` is the already-effective pre-Team query, not a payload fallback.
    ``issue_types`` is the normalized Legacy list (None/missing defaults to Story;
    [] stays unrestricted). A Legacy child kind is a planning-row role, not an
    additional Jira type, hierarchy-level or subtask exclusion.
    """
    sprint = str(admitted_sprint['id'])
    if re.fullmatch(r'[1-9][0-9]*', sprint) is None:
        raise ValueError('Invalid admitted Sprint id')
    # The captured reader inserts Team values as quoted literals. Keep its query
    # bytes for ordinary ids, but never admit stored data that can change syntax.
    for item in group_snapshot.get('teamIds') or []:
        value = str(item or '')
        if any(char in value for char in ('"', "'", '\\')) or any(ord(char) < 32 for char in value):
            raise ValueError('Unsafe Department Team id')
    roles = WorkRoles(work_context) if work_context is not None else None
    jql = build_task_discovery_jql(
        config_snapshot['base_jql'], group_snapshot.get('teamIds') or [], sprint,
        roles=roles, team_jql_template=config_snapshot.get('team_jql_template') or '')
    jql = append_task_planning_clause(jql, roles=roles, issue_types=config_snapshot.get('issue_types'))
    _candidate_predicate(jql)  # Admission must not turn malformed discovery into a broader query.
    kind = 'story' if roles is None or roles.is_legacy else 'epic'
    material = {
        'version': 1, 'candidate_jql': jql, 'child_kind': kind,
        'group_id': group_snapshot.get('id'), 'sprint_id': sprint,
        'sprint_name': admitted_sprint.get('name'),
        'work_digest': work_context.digest if work_context is not None else None,
    }
    canonical = json.dumps(material, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return {'candidate_jql': jql, 'child_kind': kind,
            'scope_digest': hashlib.sha256(canonical.encode('utf-8')).hexdigest()}


def planning_candidate_intersection_jql(issue_ids, candidate_jql):
    """Intersect <=500 immutable ids with candidates, removing top-level ordering.

    Discovery preserves historical query formatting. Authorization groups that
    complete predicate so an OR cannot escape the immutable-id intersection.
    Quoted ORDER BY text and nested expressions are left intact.
    """
    ids = list(dict.fromkeys(str(item) for item in issue_ids))
    if not ids or len(ids) > 500 or any(re.fullmatch(r'[0-9]{1,128}', item) is None for item in ids):
        raise ValueError('Invalid inclusion authorization ids')
    predicate = _candidate_predicate(candidate_jql)
    return 'id in (' + ','.join(ids) + ') AND (' + predicate + ')'


def _candidate_predicate(candidate_jql):
    """Validate grouping and ordering before dropping the non-predicate suffix.

    This is a bounded syntax boundary, not a JQL parser. Ordering accepts Jira
    field references and ASC/DESC only. In particular, historical lowercase
    ordering followed by appended Team/Sprint/type clauses must fail closed.
    """
    quote, escaped, depth, end, order_start = None, False, 0, len(candidate_jql), None
    for index, char in enumerate(candidate_jql):
        if quote:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
        elif char in ('"', "'"):
            quote = char
        elif char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth < 0:
                raise ValueError('Unbalanced inclusion candidate predicate')
        elif depth == 0 and order_start is None and (index == 0 or candidate_jql[index - 1].isspace()):
            marker = re.match(r'ORDER\s+BY\b', candidate_jql[index:], flags=re.IGNORECASE)
            if marker:
                end, order_start = index, index + marker.end()
    if quote is not None or depth != 0:
        raise ValueError('Unbalanced inclusion candidate predicate')
    if order_start is not None:
        field = r'''(?:[A-Za-z0-9_][A-Za-z0-9_.\[\]-]*|"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+')'''
        term = field + r'(?:\s+(?:ASC|DESC))?'
        if re.fullmatch(r'\s*' + term + r'(?:\s*,\s*' + term + r')*\s*',
                        candidate_jql[order_start:], flags=re.IGNORECASE) is None:
            raise ValueError('Invalid inclusion candidate ordering')
    predicate = candidate_jql[:end].strip()
    if not predicate:
        raise ValueError('Missing inclusion candidate predicate')
    return predicate
