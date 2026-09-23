"""Resolve the workspace-shared configuration that identifies derived Jira catalogs."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import re

from backend.services.workspace_dashboard_config import load_workspace_config_in_session


@dataclass(frozen=True)
class EffectiveCatalogConfig:
    workspace_id: str
    config_revision: int
    config_source: str
    workspace_payload: dict
    board_id: str
    projects: tuple[str, ...]
    team_field_id: str
    sprint_field_id: str
    base_jql: str
    config_digest: str
    sprint_identity: str | None
    team_scope_error: str | None


def _digest(value):
    canonical = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def build_team_scope_digest(*, board_id, projects, team_field_id, base_jql, payload_version=1):
    return _digest([payload_version, board_id, list(projects), team_field_id, base_jql])


def build_sprint_catalog_identity(workspace_id, board_id):
    if not board_id:
        return None
    return f'sc1:{_digest([1, "sprints", str(workspace_id), str(board_id)])}'


def build_team_catalog_identity(workspace_id, sprint_id, scope_digest):
    return f'tc1:{_digest([1, "teams", str(workspace_id), str(sprint_id), scope_digest])}'


def _balanced(value):
    depth = 0
    quote = None
    escaped = False
    for char in value:
        if escaped:
            escaped = False
            continue
        if char == '\\' and quote:
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == '(':
            depth += 1
            if depth > 32:
                return False
        elif char == ')':
            depth -= 1
            if depth < 0:
                return False
    return quote is None and depth == 0


def _top_level_parts(value, keyword):
    parts, start, depth, quote, escaped = [], 0, 0, None, False
    upper = value.upper()
    index = 0
    while index < len(value):
        char = value[index]
        if escaped:
            escaped = False
        elif char == '\\' and quote:
            escaped = True
        elif quote:
            if char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif depth == 0 and upper.startswith(keyword, index):
            before = value[index - 1] if index else ' '
            after_index = index + len(keyword)
            after = value[after_index] if after_index < len(value) else ' '
            if not (before.isalnum() or before == '_') and not (after.isalnum() or after == '_'):
                parts.append(value[start:index].strip())
                start = after_index
                index = after_index
                continue
        index += 1
    parts.append(value[start:].strip())
    return parts


def _strip_outer(value):
    while value.startswith('(') and value.endswith(')'):
        depth, quote = 0, None
        encloses = True
        for index, char in enumerate(value):
            if quote:
                if char == quote and (index == 0 or value[index - 1] != '\\'):
                    quote = None
            elif char in {'"', "'"}:
                quote = char
            elif char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
                if depth == 0 and index != len(value) - 1:
                    encloses = False
                    break
        if not encloses:
            break
        value = value[1:-1].strip()
    return value


def _mask_jql_literals(value, *, quoted_field_aliases):
    """Hide quoted RHS text while retaining supported quoted field tokens."""
    masked = []
    index = 0
    while index < len(value):
        quote = value[index]
        if quote not in {'"', "'"}:
            masked.append(quote)
            index += 1
            continue
        start = index
        index += 1
        escaped = False
        while index < len(value):
            char = value[index]
            index += 1
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                break
        literal = value[start:index]
        prefix = ''.join(masked)
        is_field_position = re.search(
            r'(?:^|\(|\bAND\b|\bOR\b)\s*(?:NOT\s+)?$', prefix, re.IGNORECASE,
        ) is not None
        if literal.lower() in quoted_field_aliases and is_field_position:
            masked.append(literal)
        else:
            masked.append(' ' * len(literal))
    return ''.join(masked)


def normalize_catalog_base_jql(jql, *, team_field_id, sprint_field_id):
    value = str(jql or '').strip()
    if not value or len(value) > 32768 or not _balanced(value):
        raise ValueError('team_scope_unsupported')
    order_parts = _top_level_parts(value, 'ORDER BY')
    if len(order_parts) > 2:
        raise ValueError('team_scope_unsupported')
    value = _strip_outer(order_parts[0])
    aliases = {'sprint', 'team', '"team[team]"'}
    for field in (team_field_id, sprint_field_id):
        normalized = str(field or '').strip().lower()
        if normalized:
            aliases.add(normalized)
            match = re.fullmatch(r'customfield_(\d+)', normalized)
            if match:
                aliases.add(f'cf[{match.group(1)}]')
    target = '|'.join(re.escape(alias) for alias in sorted(aliases, key=len, reverse=True))
    simple = re.compile(
        rf'^\s*(?:{target})\s*(?:(?:=|!=)(?!=)\s*.+|(?:NOT\s+)?IN\b\s*.+|IS\s+(?:NOT\s+)?EMPTY\s*)$',
        re.IGNORECASE | re.DOTALL,
    )
    target_condition = re.compile(
        rf'(?:^|\(|\bAND\b|\bOR\b)\s*(?:NOT\s+)?(?:{target})(?![\w])\s*'
        rf'(?:[=!<>]|(?:NOT\s+)?IN\b|IS\b)',
        re.IGNORECASE,
    )
    retained = []
    for conjunct in _top_level_parts(value, 'AND'):
        plain = conjunct.strip()
        candidate = _strip_outer(plain)
        contains_nested_logic = (
            len(_top_level_parts(candidate, 'AND')) != 1
            or len(_top_level_parts(candidate, 'OR')) != 1
        )
        if not contains_nested_logic and simple.fullmatch(candidate):
            continue
        searchable = _mask_jql_literals(
            candidate,
            quoted_field_aliases={alias for alias in aliases if alias.startswith('"')},
        )
        if target_condition.search(searchable):
            raise ValueError('team_scope_unsupported')
        retained.append(plain)
    if not retained:
        raise ValueError('team_scope_unsupported')
    return ' AND '.join(f'({item})' for item in retained)


def _project_keys(payload):
    projects = payload.get('projects') if isinstance(payload, dict) else None
    if isinstance(projects, dict):
        projects = (
            projects.get('selected') or projects.get('selectedProjects')
            or projects.get('projects') or []
        )
    result = set()
    for item in projects or []:
        key = item if isinstance(item, str) else item.get('key') if isinstance(item, dict) else ''
        key = str(key or '').strip()
        if key:
            result.add(key)
    return tuple(sorted(result))


def _runtime(runtime_inputs, *names):
    for name in names:
        if name in runtime_inputs:
            return runtime_inputs[name]
    return ''


def _text_value(value):
    return '' if value is None else str(value).strip()


def resolve_effective_catalog_config(
    session, context, *, runtime_inputs, fallback_loader, legacy_site_url,
):
    snapshot = load_workspace_config_in_session(
        session, context, fallback_loader=fallback_loader, legacy_site_url=legacy_site_url,
    )
    payload = deepcopy(snapshot.payload)
    board = payload.get('board')
    raw_board_id = _text_value(
        (board or {}).get('boardId') if isinstance(board, dict)
        else _runtime(runtime_inputs, 'jira_board_id', 'JIRA_BOARD_ID')
    )
    board_id = raw_board_id if re.fullmatch(r'[1-9][0-9]*', raw_board_id) else ''
    projects = _project_keys(payload)
    team_section = payload.get('teamField')
    team_field_id = _text_value(
        (team_section or {}).get('fieldId') if isinstance(team_section, dict)
        else _runtime(runtime_inputs, 'team_field_default', 'TEAM_FIELD_DEFAULT')
    )
    sprint_section = payload.get('sprintField')
    sprint_field_id = _text_value(
        (sprint_section or {}).get('fieldId') if isinstance(sprint_section, dict)
        else _runtime(runtime_inputs, 'sprint_field_default', 'SPRINT_FIELD_DEFAULT')
    )
    raw_jql = str(_runtime(runtime_inputs, 'jql_query', 'JQL_QUERY') or '').strip()
    team_scope_error = None
    if not raw_jql and projects:
        if not all(re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', key) for key in projects):
            team_scope_error = 'team_scope_unsupported'
        else:
            quoted = ', '.join(f'"{key}"' for key in projects)
            raw_jql = f'project in ({quoted}) ORDER BY created DESC'
    base_jql = ''
    if team_scope_error is not None:
        pass
    elif not team_field_id:
        team_scope_error = 'team_field_required'
    elif not raw_jql:
        team_scope_error = 'team_scope_required'
    else:
        try:
            base_jql = normalize_catalog_base_jql(
                raw_jql, team_field_id=team_field_id, sprint_field_id=sprint_field_id,
            )
        except ValueError:
            team_scope_error = 'team_scope_unsupported'
    config_digest = _digest([
        1, board_id, list(projects), team_field_id, base_jql, team_scope_error,
    ])
    return EffectiveCatalogConfig(
        workspace_id=context.workspace_id, config_revision=snapshot.config_revision,
        config_source=snapshot.source, workspace_payload=payload, board_id=board_id,
        projects=projects, team_field_id=team_field_id, sprint_field_id=sprint_field_id,
        base_jql=base_jql, config_digest=config_digest,
        sprint_identity=(
            build_sprint_catalog_identity(context.workspace_id, board_id)
            if board_id else None
        ),
        team_scope_error=team_scope_error,
    )
