"""Quarterly work configuration editor routes and shared selector helpers.

``GET/POST /api/work-structure/config`` own the bundle editor.  The selector
helpers below serve metadata/catalog routes (components, statuses, epics search,
issue types, connection test): they read the *stored* entry directly and never
authorize a quarter-less work query.
"""

import logging
import re

from flask import Blueprint, g, jsonify, request
from sqlalchemy.exc import OperationalError

from backend.auth.db_context import is_db_auth_context
from backend.auth.jira_auth import AuthError
from backend.config.repository import ConfigStorageError, config_storage_db_enabled
from backend.db import engine as db_engine
from backend.db import models
from backend.db.engine import DatabaseConfigurationError
from backend.services import work_structure as work_structure_service
from backend.services import workspace_dashboard_config as workspace_config_storage
from backend.services.workspace_catalog_cache import (
    in_range_sprints,
    load_scoped_sprint_catalog,
    load_sprint_catalog,
)
from backend.services.workspace_dashboard_config import (
    WorkspaceConfigConflict,
    WorkspaceConfigFenceUnavailable,
)
from . import bind_server_globals, get_jira_server

bp = Blueprint('work_structure_routes', __name__)
_wsr_log = logging.getLogger(__name__)

WorkConfigError = work_structure_service.WorkConfigError

_POST_FIELDS = frozenset({
    'baseRevision', 'workConfigurations', 'legacyEdits', 'clearProjectsForConfigurationIds',
})
_ID_PATTERN = re.compile(r'[A-Za-z0-9_-]{1,64}')
_REVISION_PATTERN = re.compile(r'[0-9]{1,9}')
_DISPLAY_TYPE_NAMES = {'parent': 'Epic', 'ancestor': 'Initiative'}
_PREFETCH_TIMEOUT_SECONDS = 10
_SNAPSHOT_CACHE_KEY = '_work_structure_editor_snapshot'


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


# --- shared helpers ----------------------------------------------------------

def work_error_response(error):
    body, status = error.response()
    return jsonify(body), status


def storage_unavailable_response():
    return work_error_response(WorkConfigError('config_storage_unavailable'))


def upstream_error_response(status_code):
    """Sanitized body for a non-200 Jira answer; never carries upstream text."""
    if status_code in (401, 403):
        code, status, message = 'jira_access_denied', 502, 'Jira refused the request.'
    elif status_code == 429:
        code, status, message = 'jira_rate_limited', 429, 'Jira is rate limiting requests.'
    else:
        code, status, message = 'jira_unavailable', 502, 'Jira could not complete the request.'
    return jsonify({'error': code, 'status': 'error', 'message': message}), status


def can_edit_shared_configuration(auth_context):
    server = get_jira_server()
    return (not server.SETTINGS_ADMIN_ONLY) or bool(auth_context.is_admin)


def db_oauth_request(auth_context):
    return bool(config_storage_db_enabled() and is_db_auth_context(auth_context))


def workspace_snapshot(auth_context):
    """DB-only workspace snapshot, cached per request; never a JSON fallback."""
    try:
        cached = getattr(g, _SNAPSHOT_CACHE_KEY, None)
    except RuntimeError:
        cached = None
    if cached is not None:
        return cached
    snapshot = workspace_config_storage.load_workspace_config(auth_context, fallback_loader=None)
    try:
        setattr(g, _SNAPSHOT_CACHE_KEY, snapshot)
    except RuntimeError:
        pass
    return snapshot


project_keys = work_structure_service.project_keys
entry_summary = work_structure_service.entry_summary
entry_missing_fields = work_structure_service.entry_missing_fields


def parent_type_authority(entry):
    """``('id', value)`` / ``('name', 'Epic')`` for the grouping parent, or None if cleared."""
    if entry['model'] == work_structure_service.MODEL_LEGACY \
            and entry['legacyHierarchyModes']['parent'] == 'compatibility':
        return ('name', 'Epic')
    parent_id = entry['hierarchy']['parentIssueTypeId']
    return ('id', parent_id) if parent_id else None


def _selector_values(args):
    values = {}
    for name, code in (
        ('configurationId', 'invalid_configuration_id'),
        ('configurationRevision', 'invalid_configuration_id'),
        ('quarter', 'invalid_quarter'),
    ):
        found = args.getlist(name)
        if len(found) > 1:
            raise WorkConfigError(code)
        values[name] = found[0] if found else None
    return values


def work_feature_active(auth_context):
    """True for a DB/OAuth request while the flag is on or the workspace is promoted."""
    if not db_oauth_request(auth_context):
        return False
    state = work_structure_service.work_configuration_state(
        workspace_snapshot(auth_context).payload,
        flag_enabled=work_structure_service.work_configurations_enabled(),
    )
    return state.promoted or state.flag_enabled


def resolve_metadata_selection(args, auth_context, *, required, allow_quarter_only=False):
    """Stored-entry lookup for metadata routes.

    Returns None when the legacy (unscoped) path applies, else a dict with the
    entry, its digest and selected project keys.  Raises ``WorkConfigError``.
    """
    service = work_structure_service
    values = _selector_values(args)
    raw_id, raw_revision, raw_quarter = (
        values['configurationId'], values['configurationRevision'], values['quarter'],
    )
    present = any(value is not None for value in values.values())
    if not db_oauth_request(auth_context):
        if present:
            raise WorkConfigError('work_configuration_setup_required')
        return None
    if raw_id is not None and _ID_PATTERN.fullmatch(raw_id) is None:
        raise WorkConfigError('invalid_configuration_id')
    if raw_revision is not None and _REVISION_PATTERN.fullmatch(raw_revision) is None:
        raise WorkConfigError('invalid_configuration_id')
    if raw_quarter is not None:
        service.parse_quarter(raw_quarter)
    flag = service.work_configurations_enabled()
    snapshot = workspace_snapshot(auth_context)
    state = service.work_configuration_state(snapshot.payload, flag_enabled=flag)
    if state.promoted and not flag:
        if required or present:
            raise WorkConfigError('configuration_feature_disabled')
        return None
    if not state.promoted:
        if not present:
            return None
        if not flag:
            raise WorkConfigError('configuration_feature_disabled')
        if raw_id is None:
            return None  # unpromoted: work reads stay Legacy, a bare quarter selects nothing
    if raw_id is None:
        if raw_revision is not None or raw_quarter is None or not allow_quarter_only:
            if present or required:
                raise WorkConfigError('configuration_required')
            return None
        try:
            context = service.resolve_work_configuration(snapshot, quarter=raw_quarter, flag_enabled=flag)
        except StopIteration:
            raise WorkConfigError('configuration_required') from None
        entry, digest = service.get_effective_configuration(snapshot, context.configuration_id)
    else:
        if raw_revision is None:
            raise WorkConfigError('configuration_required')
        entry, digest = service.get_effective_configuration(snapshot, raw_id)
        if int(raw_revision) != entry['revision']:
            raise WorkConfigError('configuration_scope_changed')
        if raw_quarter is not None and not service.entry_contains_quarter(entry, service.quarter_ordinal(raw_quarter)):
            raise WorkConfigError('configuration_scope_changed')
    return {
        'entry': entry, 'id': entry['id'], 'revision': entry['revision'],
        'digest': digest, 'projects': project_keys(entry),
        'promoted': state.promoted,
    }


# --- Sprint catalog selectors (/api/sprints, /api/teams, /api/teams/all) ----------

class SprintCatalogPending(Exception):
    """No candidate source has published a complete catalog yet (existing 503 contract)."""


def catalog_selectors(args):
    """Strict single-valued ``(configurationId, quarter)``; 400 invalid_* on any malformed value."""
    ids, quarters = args.getlist('configurationId'), args.getlist('quarter')
    if len(ids) > 1 or (ids and _ID_PATTERN.fullmatch(ids[0]) is None):
        raise WorkConfigError('invalid_configuration_id')
    if len(quarters) > 1:
        raise WorkConfigError('invalid_quarter')
    if quarters:
        work_structure_service.parse_quarter(quarters[0])
    return (ids[0] if ids else None), (quarters[0] if quarters else None)


def check_catalog_stamp(args, *, configuration_id, revisions):
    """The viewed configuration's revision stamp on a catalog read.

    The frontend stamps ``configurationRevision`` (and ``configurationDigest``, accepted but not compared: a
    changed entry always bumps the revision) next to ``configurationId``.  A stamp without an id or with a
    malformed revision is 400 ``invalid_configuration_id``; a revision that is no longer the stored one is
    409 ``configuration_scope_changed``, which asks the dashboard to re-read ``/api/config``.
    """
    revision = args.get('configurationRevision')
    if revision is None:
        if 'configurationDigest' in args:
            raise WorkConfigError('invalid_configuration_id')
        return
    if configuration_id is None or _REVISION_PATTERN.fullmatch(revision) is None:
        raise WorkConfigError('invalid_configuration_id')
    if any(item != int(revision) for item in revisions):
        raise WorkConfigError('configuration_scope_changed')


def sprint_source_snapshot(auth_context, config):
    """Read-only snapshot of one usable source (Board row or issue-scan store)."""
    if config.source_mode == work_structure_service.SOURCE_MODE_SCOPED_ISSUES:
        return load_scoped_sprint_catalog(auth_context, config=config)
    return load_sprint_catalog(auth_context, config=config)


def admit_sprint_source(auth_context, sources, sprint_id, *, configuration_id=None, quarter=None):
    """Admit a physical Sprint id through exactly one configuration source.

    A quarter or configuration selector only narrows the candidates; it is never
    replaced by another era.  An id outside every candidate's range/catalog is
    ``sprint_catalog_mismatch``; if no candidate has a complete catalog yet the
    existing pending contract applies.  Returns ``(config, sprint_row)``.
    """
    candidates = list(sources)
    if configuration_id is not None:
        candidates = [item for item in candidates if item.configuration_id == configuration_id]
    if quarter is not None:
        ordinal = work_structure_service.quarter_ordinal(quarter)
        candidates = [
            item for item in candidates
            if work_structure_service.entry_contains_quarter(
                {'fromQuarter': item.from_quarter, 'throughQuarter': item.through_quarter}, ordinal)
        ]
    if not candidates:
        raise WorkConfigError('sprint_catalog_mismatch')
    pending = False
    for config in candidates:
        if not config.sprint_identity:
            continue
        observed = config.observed_source
        if config.board_inherited:
            # An inherited Board's ids are another configuration's: admit through the own scan only.
            if observed is None:
                continue
            scanned = sprint_source_snapshot(auth_context, observed)
            rows = [] if scanned.payload is None else [
                (observed, item) for item in in_range_sprints(observed, scanned.payload)]
            incomplete = scanned.payload is None
            observed = None
        else:
            snapshot = sprint_source_snapshot(auth_context, config)
            rows = [] if snapshot.payload is None else [
                (config, item) for item in in_range_sprints(config, snapshot.payload)]
            incomplete = snapshot.payload is None
        if observed is not None:
            # With its own Board, Board rows win a same-name tie; the issue scan only adds
            # quarters the Board lacks.
            scanned = sprint_source_snapshot(auth_context, observed)
            if scanned.payload is not None:
                names = {item.get('name') for _source, item in rows}
                rows += [(observed, item) for item in in_range_sprints(observed, scanned.payload)
                         if item.get('name') not in names]
                incomplete = snapshot.payload is None and not rows
        for source, item in rows:
            if str(item.get('id')) == str(sprint_id):
                if quarter is not None and item.get('name') != quarter:
                    raise WorkConfigError('sprint_catalog_mismatch')
                return source, item
        pending = pending or incomplete
    if pending:
        raise SprintCatalogPending()
    raise WorkConfigError('sprint_catalog_mismatch')


def require_complete(selection, *needed):
    """Raise configuration_incomplete when any of ``needed`` paths is unmapped."""
    missing = [path for path in entry_missing_fields(selection['entry']) if path in needed]
    if missing:
        raise WorkConfigError('configuration_incomplete', paths=missing, configuration_id=selection['id'])


def safe_icon_url(value, site_url):
    """HTTPS icon URL on the authenticated Jira site's host, else ''."""
    from urllib.parse import urlsplit
    if not isinstance(value, str) or not value or len(value) > 2048:
        return ''
    if any(ch.isspace() or ch == '\\' or ord(ch) < 0x20 or ord(ch) == 0x7f for ch in value):
        return ''
    try:
        parts = urlsplit(value)
        site = urlsplit(str(site_url or ''))
        icon_host, site_host = parts.hostname, site.hostname
    except ValueError:
        return ''
    if parts.scheme != 'https' or parts.username or parts.password:
        return ''
    if not icon_host or not site_host or icon_host.lower() != site_host.lower():
        return ''
    return value


# --- editor routes -------------------------------------------------------------

def _env_board_id():
    return str(getattr(get_jira_server(), 'JIRA_BOARD_ID', '') or '')


def _feature_context():
    server = get_jira_server()
    auth_context = server.current_request_auth_context()
    if not db_oauth_request(auth_context):
        return None, work_error_response(WorkConfigError('work_configuration_setup_required'))
    return auth_context, None


def _auth_required_response():
    payload, status = get_jira_server().oauth_auth_required_payload()
    return jsonify(payload), status


@bp.route('/api/work-structure/config', methods=['GET'])
def get_work_structure_config():
    try:
        auth_context, failure = _feature_context()
        if failure is not None:
            return failure
        envelope = work_structure_service.load_editor_envelope(
            auth_context,
            flag_enabled=work_structure_service.work_configurations_enabled(),
            user_can_edit=can_edit_shared_configuration(auth_context),
            env_board_id=_env_board_id(),
        )
        return jsonify(envelope)
    except AuthError:
        return _auth_required_response()
    except WorkConfigError as error:
        return work_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError, OperationalError, WorkspaceConfigFenceUnavailable):
        return storage_unavailable_response()
    except Exception:
        _wsr_log.exception('Work configuration editor read failed')
        return jsonify({
            'error': 'work_configuration_read_failed', 'status': 'error',
            'message': 'The work configuration could not be read.',
        }), 500


_STATE_RANK = {'active': 0, 'closed': 1, 'future': 2}


def _sprint_value_sources(auth_context):
    """Saved sources (or the unpromoted flat Board) for the metadata read; DB row only, no JSON."""
    server = get_jira_server()
    snapshot = workspace_snapshot(auth_context)
    state = work_structure_service.work_configuration_state(
        snapshot.payload, flag_enabled=work_structure_service.work_configurations_enabled(),
    )
    if not state.promoted and not state.flag_enabled:
        raise WorkConfigError('configuration_feature_disabled')
    with db_engine.session_scope() as session:
        sources = server.resolve_request_catalog_sources(session, auth_context)
        if sources is not None:
            return list(sources), True
        flat = server.resolve_effective_catalog_config(
            session, auth_context, runtime_inputs=server.catalog_runtime_inputs(),
            fallback_loader=None, legacy_site_url='',
        )
    return [flat], False


def source_diagnostics(state, code, *snapshots):
    """Numbers-only per-source read diagnostics: state, code and counts; never keys, names, ids or JQL.

    ``snapshots`` are the Board and/or issue-scan snapshots the source answered from; the scan counts come
    from the issue scan only, ``observedSprintCount`` is the distinct Sprint names the stored rows hold
    before any range filter, and a count is ``None`` while nothing is known.
    """
    scan, names, held = {}, set(), False
    for snapshot in snapshots:
        if snapshot is None:
            continue
        scan = getattr(snapshot, 'scan', None) or scan
        if snapshot.payload is not None:
            held = True
            names |= {str(item.get('name') or '') for item in snapshot.payload if isinstance(item, dict)} - {''}
        elif not code and snapshot.failure_code:
            code = snapshot.failure_code
    return {
        'state': state, 'code': code or None,
        'scannedIssueCount': scan.get('scannedIssueCount'),
        'issuesWithSprintValueCount': scan.get('issuesWithSprintValueCount'),
        'observedSprintCount': len(names) if held else None,
    }


def collect_sprint_values(auth_context, sources):
    """Range-agnostic Sprint values observed by every saved source, one row per name.

    Reads the stored snapshots only (never Jira) and merges Board rows with the issue-scan
    supplement.  Names are the catalogs' quarter-shaped values; ``canonical`` says whether the
    value is a valid range boundary.  Output carries no site, project, board or token data.
    """
    values, summaries = {}, []
    for config in sources:
        configuration_id = config.configuration_id
        summary = {'configurationId': configuration_id, 'sourceMode': config.source_mode or 'board',
                   'state': 'setup_required'}
        snapshots = []
        if config.sprint_identity:
            summary['state'] = 'pending'
            for source in (config, config.observed_source):
                if source is None or not source.sprint_identity:
                    continue
                snapshot = sprint_source_snapshot(auth_context, source)
                snapshots.append(snapshot)
                if snapshot.payload is None:
                    continue
                summary['state'] = 'ready'
                for item in snapshot.payload:
                    name = str(item.get('name') or '') if isinstance(item, dict) else ''
                    sprint_id = item.get('id') if isinstance(item, dict) else None
                    if not name or isinstance(sprint_id, bool) or not isinstance(sprint_id, int):
                        continue
                    row = values.setdefault(name, {'states': set(), 'ids': set(), 'configs': set()})
                    row['states'].add(str(item.get('state') or '').lower())
                    row['ids'].add(sprint_id)
                    row['configs'].add(configuration_id)
        code = None if config.sprint_identity else (config.scope_error or 'configuration_incomplete')
        summary['diagnostics'] = source_diagnostics(summary['state'], code, *snapshots)
        summaries.append(summary)
    rows = []
    for name, row in values.items():
        try:
            work_structure_service.parse_quarter(name)
            canonical = True
        except WorkConfigError:
            canonical = False
        state = min(row['states'], key=lambda value: _STATE_RANK.get(value, 9))
        rows.append({
            'value': name, 'canonical': canonical, 'state': state,
            'sprintIds': sorted(row['ids']),
            'configurationIds': sorted(item for item in row['configs'] if item),
        })
    rows.sort(key=lambda row: row['value'], reverse=True)
    return rows, summaries


@bp.route('/api/work-structure/sprint-values', methods=['GET'])
def get_work_structure_sprint_values():
    """Range-agnostic Sprint values for the Scope boundary pickers (metadata read, no viewed quarter)."""
    try:
        auth_context, failure = _feature_context()
        if failure is not None:
            return failure
        if request.args:
            return jsonify({
                'error': 'unsupported_catalog_parameter', 'status': 'error',
                'message': 'This read takes no parameters.',
            }), 400
        sources, promoted = _sprint_value_sources(auth_context)
        rows, summaries = collect_sprint_values(auth_context, sources)
        response = jsonify({'sprintValues': rows, 'sources': summaries, 'promoted': promoted})
        response.headers['Cache-Control'] = 'no-store'
        return response
    except AuthError:
        return _auth_required_response()
    except WorkConfigError as error:
        return work_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError, OperationalError, WorkspaceConfigFenceUnavailable):
        return storage_unavailable_response()
    except Exception:
        _wsr_log.exception('Sprint value read failed')
        return jsonify({
            'error': 'sprint_values_read_failed', 'status': 'error',
            'message': 'Sprint values could not be read.',
        }), 500


def _invalid_body(path, message):
    return work_error_response(WorkConfigError('invalid_work_configurations', message, paths=[path]))


def _parse_post(payload):
    """Validated ``(base_revision, bundle, legacy_edits, clear_ids)`` or an error response."""
    if not isinstance(payload, dict):
        return None, _invalid_body('body', 'Expected a JSON object.')
    unknown = sorted(str(name)[:64] for name in set(payload) - _POST_FIELDS)
    if unknown:
        return None, _invalid_body(unknown[0], 'Unsupported property.')
    base_revision = payload.get('baseRevision')
    if isinstance(base_revision, bool) or not isinstance(base_revision, int) or base_revision < 0:
        return None, _invalid_body('baseRevision', 'Expected a non-negative integer.')
    if not isinstance(payload.get('workConfigurations'), dict):
        return None, _invalid_body('workConfigurations', 'Expected the bundle object.')
    clear_ids = payload.get('clearProjectsForConfigurationIds')
    if clear_ids is not None and not (
        isinstance(clear_ids, list) and all(isinstance(item, str) for item in clear_ids)
    ):
        return None, _invalid_body('clearProjectsForConfigurationIds', 'Expected configuration id strings.')
    return (base_revision, payload['workConfigurations'], payload.get('legacyEdits'), clear_ids), None


def _prefetch_issue_type_catalog(auth_context):
    """Bounded issue-type catalog ``id -> {name, hierarchyLevel}`` via the user's context, or None.

    Runs outside the DB fence on every Save.  An unavailable or malformed catalog is None;
    only ``AuthError`` (expired sign-in) escapes.
    """
    try:
        response = get_jira_server().current_jira_get(
            '/rest/api/3/issuetype', timeout=_PREFETCH_TIMEOUT_SECONDS, context=auth_context,
        )
        if response.status_code != 200:
            return None
        data = response.json()
    except AuthError:
        raise
    except Exception:
        return None
    if not isinstance(data, list):
        return None
    catalog = {}
    for item in data:
        if isinstance(item, dict):
            catalog.setdefault(str(item.get('id') or ''), {
                'name': item.get('name'), 'hierarchyLevel': item.get('hierarchyLevel'),
            })
    return catalog


def _legacy_display_types(catalog):
    """Exact-name Epic/Initiative display metadata; ambiguous, missing or non-numeric results are None."""
    result = {'parent': None, 'ancestor': None}
    for slot, wanted in _DISPLAY_TYPE_NAMES.items():
        matches = [type_id for type_id, item in (catalog or {}).items() if str(item.get('name') or '') == wanted]
        if len(matches) == 1 and matches[0].isdigit():
            result[slot] = {'id': matches[0], 'name': wanted}
    return result


def _actor_recheck(auth_context):
    """Fence-time recheck: flag still on and the actor is still an eligible editor."""
    server = get_jira_server()

    def recheck(payload, revision):
        if not work_structure_service.work_configurations_enabled():
            raise WorkConfigError('configuration_feature_disabled')
        if not server.SETTINGS_ADMIN_ONLY:
            return
        with db_engine.session_scope() as session:
            user = session.get(models.User, auth_context.user_id)
            if user is None or user.account_type != 'admin' or str(user.status or 'active') != 'active':
                raise WorkConfigError('admin_required')

    return recheck


@bp.route('/api/work-structure/config', methods=['POST'])
def save_work_structure_config():
    try:
        auth_context, failure = _feature_context()
        if failure is not None:
            return failure
        if not work_structure_service.work_configurations_enabled():
            return work_error_response(WorkConfigError('configuration_feature_disabled'))
        parsed, failure = _parse_post(request.get_json(silent=True))
        if failure is not None:
            return failure
        base_revision, bundle, legacy_edits, clear_ids = parsed
        catalog = _prefetch_issue_type_catalog(auth_context)
        display_types = None
        if not work_structure_service.is_promoted(workspace_snapshot(auth_context).payload):
            display_types = _legacy_display_types(catalog)
        server = get_jira_server()
        try:
            result = work_structure_service.save_work_configurations(
                auth_context, bundle, base_revision,
                legacy_edits=legacy_edits, clear_projects_for_configuration_ids=clear_ids,
                flag_enabled=True, env_board_id=_env_board_id(),
                legacy_display_types=display_types, issue_type_catalog=catalog,
                recheck=_actor_recheck(auth_context),
            )
        except WorkspaceConfigConflict as conflict:
            body = work_structure_service.conflict_envelope(conflict, env_board_id=_env_board_id())
            return jsonify(body), 409
        server.retire_work_configuration_caches(
            reason='work_configuration_change', workspace_id=auth_context.workspace_id,
        )
        return jsonify(result)
    except AuthError:
        return _auth_required_response()
    except WorkConfigError as error:
        return work_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError, OperationalError, WorkspaceConfigFenceUnavailable):
        return storage_unavailable_response()
    except Exception:
        _wsr_log.exception('Work configuration save failed')
        return jsonify({
            'error': 'work_configuration_save_failed', 'status': 'error',
            'message': 'The work configuration could not be saved.',
        }), 500


# --- Allocation option values ----------------------------------------------------

_ALLOCATION_FIELD_PATTERN = re.compile(r'customfield_([0-9]{1,32})')
_ALLOCATION_PROJECT_PATTERN = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,63}')
_ALLOCATION_TYPE_PATTERN = re.compile(r'[0-9]{1,32}')
_ALLOCATION_QUERY_MAX = 255
_ALLOCATION_TIMEOUT_SECONDS = 15


def _allocation_request_error(message):
    return jsonify({'error': 'invalid_allocation_options_request', 'status': 'error', 'message': message}), 400


def _unique_values(values):
    return [{'value': value} for value in dict.fromkeys(value for value in values if value)]


def _createmeta_allocation_values(auth_context, field_id, project_key, issue_type_id):
    """Complete option list from the user's create metadata, or None when unreadable or absent."""
    response = get_jira_server().current_jira_get(
        f'/rest/api/3/issue/createmeta/{project_key}/issuetypes/{issue_type_id}',
        params={'maxResults': 200}, timeout=_ALLOCATION_TIMEOUT_SECONDS, context=auth_context,
    )
    if response.status_code != 200:
        return None
    body = response.json() or {}
    fields = body.get('fields') or body.get('values') or []
    field = next((item for item in fields if isinstance(item, dict) and item.get('fieldId') == field_id), None)
    if field is None:
        return None
    return [str((item or {}).get('value') or '').strip() for item in field.get('allowedValues') or []
            if isinstance(item, dict)]


def _autocomplete_allocation_values(auth_context, field_number, query):
    """Prefix-only, capped JQL suggestions (the labels precedent), or None on a non-200."""
    response = get_jira_server().current_jira_get(
        '/rest/api/3/jql/autocompletedata/suggestions',
        params={'fieldName': f'cf[{field_number}]', 'fieldValue': query},
        timeout=_ALLOCATION_TIMEOUT_SECONDS, context=auth_context,
    )
    if response.status_code != 200:
        return None
    values = []
    for item in (response.json() or {}).get('results') or []:
        value = str((item or {}).get('value') or '').strip()
        if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        values.append(value)
    return values


@bp.route('/api/work-structure/allocation-options', methods=['GET'])
def get_work_structure_allocation_options():
    """Allocation values for the DELIVERY Product/Tech mapping, read with the user's own Jira (no write).

    The parameters come from the editor draft, so an unsaved field choice is listable.  createmeta
    gives the complete list; autocomplete is the fallback; when both fail the editor takes typed values.
    """
    try:
        auth_context, failure = _feature_context()
        if failure is not None:
            return failure
        field_id = request.args.get('fieldId', '').strip()
        project_key = request.args.get('projectKey', '').strip()
        issue_type_id = request.args.get('issueTypeId', '').strip()
        query = request.args.get('query', '').strip()
        field_match = _ALLOCATION_FIELD_PATTERN.fullmatch(field_id)
        if field_match is None:
            return _allocation_request_error('fieldId must be a custom field id.')
        if project_key and _ALLOCATION_PROJECT_PATTERN.fullmatch(project_key) is None:
            return _allocation_request_error('Invalid project key.')
        if issue_type_id and _ALLOCATION_TYPE_PATTERN.fullmatch(issue_type_id) is None:
            return _allocation_request_error('Invalid issue type id.')
        if len(query) > _ALLOCATION_QUERY_MAX:
            return _allocation_request_error('Query is too long.')
        body = {'options': [], 'source': None, 'complete': False}
        values = None
        if project_key and issue_type_id:
            values = _createmeta_allocation_values(auth_context, field_id, project_key, issue_type_id)
        if values is not None:
            needle = query.casefold()
            body = {'options': _unique_values(v for v in values if needle in v.casefold()),
                    'source': 'createmeta', 'complete': True}
        else:
            values = _autocomplete_allocation_values(auth_context, field_match.group(1), query)
            if values is not None:
                body = {'options': _unique_values(values), 'source': 'autocomplete', 'complete': False}
        response = jsonify(body)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except AuthError:
        return _auth_required_response()
    except Exception:
        _wsr_log.exception('Allocation option read failed')
        return jsonify({'options': [], 'source': None, 'complete': False})
