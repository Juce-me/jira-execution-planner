"""Resolve the workspace-shared configuration that identifies derived Jira catalogs."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import re

from backend.services import work_structure
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
    missing_admin_settings: tuple[str, ...]
    # Work-configuration sources only; the flat (unpromoted) resolver leaves these at defaults.
    configuration_id: str | None = None
    configuration_revision: int | None = None
    source_mode: str | None = None
    source_digest: str | None = None
    from_quarter: str | None = None
    through_quarter: str | None = None
    scope_error: str | None = None


def _digest(value):
    canonical = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def build_team_scope_digest(
    *, board_id, projects, team_field_id, base_jql, payload_version=1,
    configuration_digest=None, sprint_field_id=None,
):
    material = [payload_version, board_id, list(projects), team_field_id, base_jql]
    if configuration_digest is not None:
        # Configuration sources only: unpromoted digests stay byte-identical.
        material += [configuration_digest, sprint_field_id or '']
    return _digest(material)


def team_scope_digest(config):
    """Team-catalog scope digest of one resolved source (flat or configuration)."""
    return build_team_scope_digest(
        board_id=config.board_id, projects=config.projects,
        team_field_id=config.team_field_id, base_jql=config.base_jql,
        configuration_digest=config.source_digest,
        sprint_field_id=config.sprint_field_id if config.source_digest is not None else None,
    )


def build_sprint_catalog_identity(workspace_id, board_id):
    if not board_id:
        return None
    return f'sc1:{_digest([1, "sprints", str(workspace_id), str(board_id)])}'


def build_scoped_sprint_catalog_identity(
    workspace_id, *, site_partition, effective_scope, sprint_field_id, source_digest,
):
    """Process-local identity of an issue-scanned Sprint catalog (no Board row exists)."""
    return 'si1:' + _digest([
        1, 'scoped-sprints', str(workspace_id), list(site_partition), effective_scope,
        str(sprint_field_id), str(source_digest),
    ])


def build_projection_identity(config):
    """Browser-visible identity of one source projection: row identity + digest + range."""
    if not config.sprint_identity:
        return None
    return 'sp1:' + _digest([
        1, config.sprint_identity, config.source_digest, config.configuration_id,
        config.from_quarter, config.through_quarter,
    ])


def build_merged_catalog_identity(configs):
    """Identity of a merged multi-source Sprint response (order independent)."""
    return 'sm1:' + _digest(sorted(
        [build_projection_identity(config) or f'unusable:{config.configuration_id}:{config.source_digest}'
         for config in configs]
    ))


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
    missing_admin_settings = tuple(
        section for section, present in (('scope', bool(projects or raw_jql)), ('source', bool(board_id)))
        if not present
    )
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
        missing_admin_settings=missing_admin_settings,
    )


def _site_partition(context):
    return (
        str(getattr(context, 'cloud_id', '') or ''),
        str(getattr(context, 'site_url', '') or '').rstrip('/').lower(),
        str(getattr(context, 'auth_connection_id', '') or getattr(context, 'user_id', '') or ''),
    )


def _entry_catalog_config(context, snapshot, entry, runtime_inputs):
    """One saved entry as a catalog source; global query precedence is unchanged.

    ``JQL_QUERY`` overrides the active project chips; Sprint/Team clauses are
    stripped by the shared normalizer.  Nothing here reads JSON or ambient
    Board/field getters: blank mapped ids stay blank.
    """
    projects = tuple(sorted(work_structure.project_keys(entry)))
    board_id = entry['scope']['boardId']
    sprint_field_id = entry['fields']['sprint']['fieldId']
    team_field_id = entry['fields']['team']['fieldId']
    mode = work_structure.source_mode(entry)
    digest = work_structure.source_digest(entry)
    raw_jql = str(_runtime(runtime_inputs, 'jql_query', 'JQL_QUERY') or '').strip()
    scope_error = None
    if not raw_jql and projects:
        if not all(re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', key) for key in projects):
            scope_error = 'team_scope_unsupported'
        else:
            quoted = ', '.join(f'"{key}"' for key in projects)
            raw_jql = f'project in ({quoted}) ORDER BY created DESC'
    base_jql = ''
    if scope_error is None:
        if not raw_jql:
            scope_error = 'team_scope_required'
        else:
            try:
                base_jql = normalize_catalog_base_jql(
                    raw_jql, team_field_id=team_field_id, sprint_field_id=sprint_field_id,
                )
            except ValueError:
                scope_error = 'team_scope_unsupported'
    team_scope_error = scope_error
    if team_scope_error is None and not team_field_id:
        team_scope_error = 'team_field_required'
    config_digest = _digest([
        2, entry['id'], digest, base_jql, scope_error, team_scope_error, mode,
    ])
    if mode == work_structure.SOURCE_MODE_BOARD:
        sprint_identity = build_sprint_catalog_identity(context.workspace_id, board_id)
    elif mode == work_structure.SOURCE_MODE_SCOPED_ISSUES and scope_error is None:
        sprint_identity = build_scoped_sprint_catalog_identity(
            context.workspace_id, site_partition=_site_partition(context),
            effective_scope=base_jql, sprint_field_id=sprint_field_id, source_digest=digest,
        )
    else:
        sprint_identity = None
    primary = EffectiveCatalogConfig(
        workspace_id=context.workspace_id, config_revision=snapshot.config_revision,
        config_source=snapshot.source, workspace_payload=deepcopy(snapshot.payload),
        board_id=board_id, projects=projects, team_field_id=team_field_id,
        sprint_field_id=sprint_field_id, base_jql=base_jql, config_digest=config_digest,
        sprint_identity=sprint_identity, team_scope_error=team_scope_error,
        missing_admin_settings=tuple(work_structure.entry_missing_fields(entry)),
        configuration_id=entry['id'], configuration_revision=entry['revision'],
        source_mode=mode, source_digest=digest, from_quarter=entry['fromQuarter'],
        through_quarter=entry['throughQuarter'], scope_error=scope_error,
    )
    return primary


def resolve_catalog_sources(session, context, *, runtime_inputs, flag_enabled=None):
    """Every saved configuration as a catalog source, or None while unpromoted.

    Reads the DB row only (``fallback_loader=None``); a promoted workspace never
    reaches a JSON loader.  Promoted with the flag off raises
    ``configuration_feature_disabled``.
    """
    snapshot = load_workspace_config_in_session(session, context, fallback_loader=None)
    entries = work_structure.catalog_entries(snapshot, flag_enabled=flag_enabled)
    if entries is None:
        return None
    return tuple(
        _entry_catalog_config(context, snapshot, entry, runtime_inputs) for entry in entries
    )


def resolve_configuration_catalog_config(
    session, context, *, runtime_inputs, configuration_id, flag_enabled=None,
):
    """One saved configuration as a catalog source; ``None`` when unpromoted.

    Unknown id raises ``invalid_configuration_id``.
    """
    sources = resolve_catalog_sources(
        session, context, runtime_inputs=runtime_inputs, flag_enabled=flag_enabled,
    )
    if sources is None:
        return None
    for source in sources:
        if source.configuration_id == configuration_id:
            return source
    raise work_structure.WorkConfigError('invalid_configuration_id')
