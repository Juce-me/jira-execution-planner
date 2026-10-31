"""Quarterly work configurations: one revisioned workspace bundle, two adapters.

The bundle lives under ``workConfigurations`` in the existing workspace
dashboard payload.  Everything here is pure except ``save_work_configurations``
and ``load_editor_envelope``, which use the workspace storage service.  Capture
never reads JSON files, ambient config getters or request caches: it projects a
DB-only snapshot.  Capacity, groups and private payloads are not part of it.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import os
import re
from types import MappingProxyType

WORK_CONFIGURATIONS_KEY = 'workConfigurations'
BUNDLE_VERSION = 1

MODEL_LEGACY = 'legacy'
MODEL_RND_2027 = 'rnd_2027'
LEGACY_ID = 'legacy'
DELIVERY_ID = 'delivery'

# Top-level workspace keys moved into the bundle on promotion.  Capacity,
# statsPriorityWeights, groups and every query setting stay where they are.
MOVED_STRUCTURAL_KEYS = (
    'projects', 'board', 'sprintField', 'storyPointsField', 'parentNameField',
    'teamField', 'projectTrackField', 'deliveryOwnerField', 'issueTypes',
)

HIERARCHY_KEYS = (
    'planningIssueTypeId', 'parentIssueTypeId', 'ancestorIssueTypeId',
    'optionalAncestorIssueTypeId',
)
LEGACY_FIELD_NAMES = ('sprint', 'storyPoints', 'parentName', 'team', 'projectTrack', 'deliveryOwner')
RND_FIELD_NAMES = LEGACY_FIELD_NAMES + ('allocation',)
LEGACY_ONLY_KEYS = ('legacyIssueTypeNames', 'legacyDisplayTypes', 'legacyHierarchyModes')
MODE_SLOTS = {'parent': 'parentIssueTypeId', 'ancestor': 'ancestorIssueTypeId'}

# Effective Legacy defaults, mirroring jira_server's *_FIELD_DEFAULT constants.
# Delivery owner and parent name intentionally have no default.
LEGACY_FIELD_DEFAULTS = {
    'sprint': 'customfield_10101',
    'storyPoints': 'customfield_10004',
    'team': 'customfield_30101',
    'projectTrack': 'customfield_35024',
}
LEGACY_FLAT_KEYS = {
    'sprint': 'sprintField', 'storyPoints': 'storyPointsField', 'parentName': 'parentNameField',
    'team': 'teamField', 'projectTrack': 'projectTrackField', 'deliveryOwner': 'deliveryOwnerField',
}

_ERROR_STATUS = {
    'invalid_work_configurations': 400, 'invalid_quarter': 400, 'invalid_configuration_id': 400,
    'ambiguous_configuration_scope': 400, 'admin_required': 403, 'csrf_required': 403,
    'configuration_incomplete': 409, 'configuration_scope_changed': 409,
    'sprint_catalog_mismatch': 409, 'configuration_bundle_required': 409,
    'configuration_required': 409, 'configuration_feature_disabled': 409,
    'work_configuration_setup_required': 409, 'workspace_config_conflict': 409,
    'config_storage_unavailable': 503, 'catalog_storage_unavailable': 503,
}
_ERROR_MESSAGE = {
    'invalid_work_configurations': 'The work configuration payload is invalid.',
    'invalid_quarter': 'The quarter is not valid.',
    'invalid_configuration_id': 'The configuration id is not valid.',
    'ambiguous_configuration_scope': 'The configuration scope is ambiguous.',
    'admin_required': 'Administrator rights are required.',
    'csrf_required': 'A valid CSRF token is required.',
    'configuration_incomplete': 'The configuration is incomplete.',
    'configuration_scope_changed': 'The configuration changed; reload and retry.',
    'sprint_catalog_mismatch': 'The Sprint does not belong to this configuration.',
    'configuration_bundle_required': 'Structural settings are saved through the work configuration bundle.',
    'configuration_required': 'A viewed quarter or configuration is required.',
    'configuration_feature_disabled': 'Work configurations are not enabled.',
    'work_configuration_setup_required': 'Work configurations require database-backed OAuth.',
    'workspace_config_conflict': 'Shared settings changed while you were editing.',
    'config_storage_unavailable': 'Configuration storage is temporarily unavailable.',
    'catalog_storage_unavailable': 'Catalog storage is temporarily unavailable.',
}


class WorkConfigError(Exception):
    """Safe, code-addressed failure; ``response()`` is the route envelope."""

    def __init__(self, code, message=None, *, paths=None, configuration_id=None, slot=None):
        super().__init__(code)
        self.code = code
        self.message = message or _ERROR_MESSAGE.get(code, 'Work configuration error.')
        self.paths = list(paths or [])
        self.configuration_id = configuration_id
        self.slot = slot

    @property
    def status(self):
        return _ERROR_STATUS.get(self.code, 400)

    def response(self):
        body = {'error': self.code, 'status': 'error', 'message': self.message}
        if self.paths:
            body['missingFields' if self.code == 'configuration_incomplete' else 'paths'] = self.paths
        if self.configuration_id:
            body['configurationId'] = self.configuration_id
        if self.slot:
            body['slot'] = self.slot
        return body, self.status


def _invalid(path, message=None, *, configuration_id=None, slot=None):
    raise WorkConfigError(
        'invalid_work_configurations', message, paths=[path],
        configuration_id=configuration_id, slot=slot,
    )


def error_response(error):
    """Map a work-configuration or storage failure to ``(body, status)`` or None."""
    from backend.services.workspace_dashboard_config import WorkspaceConfigFenceUnavailable
    if isinstance(error, WorkConfigError):
        return error.response()
    if isinstance(error, WorkspaceConfigFenceUnavailable):
        return WorkConfigError('config_storage_unavailable').response()
    return None


# --- flag and durable state -------------------------------------------------

def work_configurations_enabled(environ=None):
    env = os.environ if environ is None else environ
    return str(env.get('WORK_CONFIGURATIONS_ENABLED') or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def is_promoted(payload):
    """Only the fenced first save writes ``promotionRevision``; absent means unpromoted."""
    bundle = payload.get(WORK_CONFIGURATIONS_KEY) if isinstance(payload, dict) else None
    return isinstance(bundle, dict) and _positive_int(bundle.get('promotionRevision'))


@dataclass(frozen=True)
class WorkConfigurationState:
    state: str
    promoted: bool
    flag_enabled: bool
    editor: str                 # flat | virtual | bundle | unavailable
    structural_reads: str       # flat | bundle | blocked
    bundle_writes_allowed: bool
    flat_structural_writes_allowed: bool
    error_code: str | None      # code for blocked structural reads / bundle writes

    def as_dict(self):
        return {
            'state': self.state, 'promoted': self.promoted, 'featureEnabled': self.flag_enabled,
            'editor': self.editor, 'structuralReads': self.structural_reads,
            'bundleWritesAllowed': self.bundle_writes_allowed,
            'flatStructuralWritesAllowed': self.flat_structural_writes_allowed,
            'errorCode': self.error_code,
        }


def work_configuration_state(payload, *, flag_enabled):
    """Durable-state x flag matrix; pure, no writes, safe across restarts."""
    promoted = is_promoted(payload)
    enabled = bool(flag_enabled)
    if not promoted and not enabled:
        return WorkConfigurationState('unpromoted_off', False, False, 'flat', 'flat', False, True,
                                      'configuration_feature_disabled')
    if not promoted:
        return WorkConfigurationState('unpromoted_on', False, True, 'virtual', 'flat', True, True, None)
    if enabled:
        return WorkConfigurationState('promoted_on', True, True, 'bundle', 'bundle', True, False, None)
    return WorkConfigurationState('promoted_off', True, False, 'unavailable', 'blocked', False, False,
                                  'configuration_feature_disabled')


def ensure_flat_structural_write_allowed(payload, section):
    """Guard for old partial structural writers; raises 409 after promotion."""
    if section in MOVED_STRUCTURAL_KEYS and is_promoted(payload):
        raise WorkConfigError('configuration_bundle_required')


# --- quarters ---------------------------------------------------------------

_QUARTER_RE = re.compile(r'[0-9]{4}Q[1-4]')


def parse_quarter(value):
    """Strict ``YYYYQ[1-4]``: uppercase, four ASCII digits, year 0001-9999."""
    if not isinstance(value, str) or _QUARTER_RE.fullmatch(value) is None or value[:4] == '0000':
        raise WorkConfigError('invalid_quarter')
    return int(value[:4]), int(value[5])


def quarter_ordinal(value):
    year, quarter = parse_quarter(value)
    return year * 4 + quarter - 1


def next_quarter(value):
    year, quarter = parse_quarter(value)
    if quarter == 4:
        year, quarter = year + 1, 1
    else:
        quarter += 1
    if year > 9999:
        raise WorkConfigError('invalid_quarter')
    return f'{year:04d}Q{quarter}'


def _bundle_quarter(value, path):
    if value is None:
        return None
    try:
        parse_quarter(value)
    except WorkConfigError:
        _invalid(path, 'Quarter must be YYYYQ1-YYYYQ4.')
    return value


# --- normalization ----------------------------------------------------------

_ID_RE = re.compile(r'[a-z0-9][a-z0-9_-]{0,63}')
_FIELD_ID_RE = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,254}')
_NO_SPACE_RE = re.compile(r'[^\s\x00-\x1f\x7f]{1,255}')
_CONTROL_RE = re.compile(r'[\x00-\x1f\x7f]')


def _dict(value, path, allowed=None, required=None):
    if not isinstance(value, dict):
        _invalid(path, 'Expected an object.')
    unknown = set(value) - set(allowed if allowed is not None else value)
    if unknown:
        _invalid(f'{path}.{sorted(unknown)[0]}', 'Unknown property.')
    for key in required or ():
        if key not in value:
            _invalid(f'{path}.{key}', 'Missing property.')
    return value


def _string(value, path, *, max_length=255, allow_blank=True):
    if value is None:
        value = ''
    if not isinstance(value, str):
        _invalid(path, 'Expected a string.')
    value = value.strip()
    if len(value) > max_length or _CONTROL_RE.search(value) or (not value and not allow_blank):
        _invalid(path, 'Invalid string.')
    return value


def _numeric_id(value, path):
    """Jira numeric ids; blank/None means unset."""
    if value is None or value == '':
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        _invalid(path, 'Expected a numeric id.')
    text = str(value).strip()
    if not re.fullmatch(r'[0-9]{1,32}', text):
        _invalid(path, 'Expected a numeric id.')
    return text


def _board_id(value, path):
    return _numeric_id(value, path) or ''


def _revision(value, path):
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        _invalid(path, 'Revision must be a non-negative integer.')
    return value


def _projects(value, path, model):
    if not isinstance(value, list):
        _invalid(path, 'Expected an array.')
    default_type = 'product' if model == MODEL_LEGACY else 'other'
    result, seen = [], set()
    for index, item in enumerate(value):
        item_path = f'{path}[{index}]'
        if isinstance(item, str):
            item = {'key': item}
        _dict(item, item_path, {'key', 'type'})
        key = _string(item.get('key'), f'{item_path}.key', allow_blank=False)
        if _NO_SPACE_RE.fullmatch(key) is None:
            _invalid(f'{item_path}.key', 'Invalid project key.')
        project_type = _string(item.get('type'), f'{item_path}.type', max_length=64) or default_type
        if key in seen:
            continue
        seen.add(key)
        result.append({'key': key, 'type': project_type})
    if model == MODEL_RND_2027 and len(result) > 1:
        _invalid(path, 'DELIVERY uses one Jira project.')
    return result


def _field_mappings(value, path, names):
    value = _dict(value, path, names, names)
    result = {}
    for name in names:
        entry = value.get(name, {'fieldId': '', 'fieldName': ''})
        entry_path = f'{path}.{name}'
        _dict(entry, entry_path, {'fieldId', 'fieldName'}, {'fieldId', 'fieldName'})
        field_id = _string(entry.get('fieldId'), f'{entry_path}.fieldId')
        if field_id and _FIELD_ID_RE.fullmatch(field_id) is None:
            _invalid(f'{entry_path}.fieldId', 'Invalid field id.')
        result[name] = {
            'fieldId': field_id,
            'fieldName': _string(entry.get('fieldName'), f'{entry_path}.fieldName'),
        }
    return result


def _display_type(value, path):
    if value is None:
        return None
    _dict(value, path, {'id', 'name'}, {'id', 'name'})
    return {'id': _numeric_id(value['id'], f'{path}.id') or '', 'name': _string(value['name'], f'{path}.name')}


def _normalize_entry(entry, index):
    path = f'configurations[{index}]'
    if not isinstance(entry, dict):
        _invalid(path, 'Expected an object.')
    model = entry.get('model')
    if model not in (MODEL_LEGACY, MODEL_RND_2027):
        _invalid(f'{path}.model', 'Unsupported model.')
    legacy = model == MODEL_LEGACY
    allowed = {'id', 'name', 'revision', 'fromQuarter', 'throughQuarter', 'model',
               'scope', 'hierarchy', 'fields'} | (set(LEGACY_ONLY_KEYS) if legacy else set())
    required = {'id', 'name', 'fromQuarter', 'throughQuarter', 'model', 'scope', 'hierarchy', 'fields'}
    required |= set(LEGACY_ONLY_KEYS) if legacy else set()
    _dict(entry, path, allowed, required)
    config_id = entry['id']
    if not isinstance(config_id, str) or _ID_RE.fullmatch(config_id) is None:
        _invalid(f'{path}.id', 'Invalid configuration id.')
    scope = _dict(entry['scope'], f'{path}.scope', {'projects', 'boardId'}, {'projects', 'boardId'})
    hierarchy = _dict(entry['hierarchy'], f'{path}.hierarchy', set(HIERARCHY_KEYS), set(HIERARCHY_KEYS))
    result = {
        'id': config_id,
        'name': _string(entry['name'], f'{path}.name', max_length=120, allow_blank=False),
        'revision': _revision(entry.get('revision'), f'{path}.revision'),
        'fromQuarter': _bundle_quarter(entry['fromQuarter'], f'{path}.fromQuarter'),
        'throughQuarter': _bundle_quarter(entry['throughQuarter'], f'{path}.throughQuarter'),
        'model': model,
        'scope': {
            'projects': _projects(scope['projects'], f'{path}.scope.projects', model),
            'boardId': _board_id(scope['boardId'], f'{path}.scope.boardId'),
        },
    }
    if legacy:
        names = entry['legacyIssueTypeNames']
        if names is not None:
            if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
                _invalid(f'{path}.legacyIssueTypeNames', 'Expected a string array or null.')
            names = [n.strip() for n in names if n.strip()]
        display = _dict(entry['legacyDisplayTypes'], f'{path}.legacyDisplayTypes',
                        {'parent', 'ancestor'}, {'parent', 'ancestor'})
        modes = _dict(entry['legacyHierarchyModes'], f'{path}.legacyHierarchyModes',
                      set(MODE_SLOTS), set(MODE_SLOTS))
        for slot, mode in modes.items():
            if mode not in ('compatibility', 'mapped'):
                _invalid(f'{path}.legacyHierarchyModes.{slot}', 'Mode must be compatibility or mapped.')
        result['legacyIssueTypeNames'] = names
        result['legacyDisplayTypes'] = {
            slot: _display_type(display[slot], f'{path}.legacyDisplayTypes.{slot}') for slot in MODE_SLOTS
        }
        result['legacyHierarchyModes'] = {slot: modes[slot] for slot in MODE_SLOTS}
    result['hierarchy'] = {key: _numeric_id(hierarchy[key], f'{path}.hierarchy.{key}') for key in HIERARCHY_KEYS}
    result['fields'] = _field_mappings(
        entry['fields'], f'{path}.fields', LEGACY_FIELD_NAMES if legacy else RND_FIELD_NAMES,
    )
    if legacy:
        for slot, key in MODE_SLOTS.items():
            if result['legacyHierarchyModes'][slot] == 'compatibility' and result['hierarchy'][key] is not None:
                _invalid(f'{path}.hierarchy.{key}', 'Compatibility slots keep a null id.',
                         configuration_id=config_id, slot=key)
        if result['legacyIssueTypeNames'] is not None and result['hierarchy']['planningIssueTypeId'] is not None:
            _invalid(f'{path}.hierarchy.planningIssueTypeId',
                     'The planning name filter and planning id are mutually exclusive.',
                     configuration_id=config_id, slot='planningIssueTypeId')
    return result


def normalize_work_configurations(bundle):
    """Validate and canonicalize a complete bundle (stored or browser shaped).

    ``promotionRevision`` is read-only metadata: it is validated and echoed
    (null when absent) and never grants anything on its own.
    """
    bundle = _dict(bundle, '<root>', {'version', 'promotionRevision', 'configurations'}, {'version', 'configurations'})
    if bundle['version'] != BUNDLE_VERSION or isinstance(bundle['version'], bool):
        _invalid('version', 'Unsupported bundle version.')
    promotion = bundle.get('promotionRevision')
    if promotion is not None and not _positive_int(promotion):
        _invalid('promotionRevision', 'Invalid promotion revision.')
    entries = bundle['configurations']
    if not isinstance(entries, list) or len(entries) != 2:
        _invalid('configurations', 'Exactly two configurations are required: Legacy then DELIVERY.')
    normalized = [_normalize_entry(entry, index) for index, entry in enumerate(entries)]
    legacy, delivery = normalized
    if legacy['model'] != MODEL_LEGACY or delivery['model'] != MODEL_RND_2027:
        _invalid('configurations', 'Legacy must precede DELIVERY.')
    if legacy['id'] == delivery['id']:
        _invalid('configurations[1].id', 'Duplicate configuration id.')
    if legacy['name'].casefold() == delivery['name'].casefold():
        _invalid('configurations[1].name', 'Duplicate configuration name.')
    if legacy['fromQuarter'] is not None:
        _invalid('configurations[0].fromQuarter', 'Legacy starts open.')
    if delivery['throughQuarter'] is not None:
        _invalid('configurations[1].throughQuarter', 'DELIVERY ends open.')
    if legacy['throughQuarter'] is None or delivery['fromQuarter'] is None:
        _invalid('configurations[0].throughQuarter', 'Both inner bounds are required.')
    if next_quarter(legacy['throughQuarter']) != delivery['fromQuarter']:
        _invalid('configurations[1].fromQuarter', 'Ranges must be contiguous without gaps or overlaps.')
    return {'version': BUNDLE_VERSION, 'promotionRevision': promotion, 'configurations': normalized}


# --- virtual capture --------------------------------------------------------

def _blank_fields(names):
    return {name: {'fieldId': '', 'fieldName': ''} for name in names}


def _blank_delivery(revision=0):
    return {
        'id': DELIVERY_ID, 'name': 'DELIVERY', 'revision': revision,
        'fromQuarter': '2027Q1', 'throughQuarter': None, 'model': MODEL_RND_2027,
        'scope': {'projects': [], 'boardId': ''},
        'hierarchy': {key: None for key in HIERARCHY_KEYS},
        'fields': _blank_fields(RND_FIELD_NAMES),
    }


def capture_legacy_entry(payload, *, env_board_id=''):
    """Project the Legacy entry from one DB-only payload; no I/O, no getters.

    Precedence matches the current getters: a present key wins (even blank),
    an absent key takes the effective default.  Oversized scopes are kept.
    """
    payload = payload if isinstance(payload, dict) else {}
    selected = (payload.get('projects') or {}).get('selected') or []
    projects = []
    for item in selected:
        if isinstance(item, str) and item.strip():
            projects.append({'key': item.strip(), 'type': 'product'})
        elif isinstance(item, dict) and str(item.get('key') or '').strip():
            projects.append({'key': str(item['key']).strip(), 'type': str(item.get('type') or 'product')})
    has_config = bool(payload)
    board = payload.get('board') if has_config and 'board' in payload else None
    board_id = str((board or {}).get('boardId', '') or '').strip() if board is not None else str(env_board_id or '').strip()
    fields = {}
    for name in LEGACY_FIELD_NAMES:
        flat = payload.get(LEGACY_FLAT_KEYS[name]) if has_config and LEGACY_FLAT_KEYS[name] in payload else None
        if isinstance(flat, dict):
            fields[name] = {'fieldId': str(flat.get('fieldId', '') or ''), 'fieldName': str(flat.get('fieldName', '') or '')}
        else:
            fields[name] = {'fieldId': LEGACY_FIELD_DEFAULTS.get(name, ''), 'fieldName': ''}
    issue_types = payload.get('issueTypes')
    names = ['Story'] if issue_types is None else [str(t).strip() for t in issue_types if str(t).strip()]
    return {
        'id': LEGACY_ID, 'name': 'Legacy', 'revision': 0,
        'fromQuarter': None, 'throughQuarter': '2026Q4', 'model': MODEL_LEGACY,
        'scope': {'projects': projects, 'boardId': board_id},
        'legacyIssueTypeNames': names,
        'legacyDisplayTypes': {'parent': None, 'ancestor': None},
        'legacyHierarchyModes': {'parent': 'compatibility', 'ancestor': 'compatibility'},
        'hierarchy': {key: None for key in HIERARCHY_KEYS},
        'fields': fields,
    }


def capture_virtual_bundle(payload, *, env_board_id=''):
    """Virtual Legacy + blank DELIVERY bundle from a DB-only payload (revisions 0)."""
    return normalize_work_configurations({
        'version': BUNDLE_VERSION, 'promotionRevision': None,
        'configurations': [capture_legacy_entry(payload, env_board_id=env_board_id), _blank_delivery()],
    })


def capture_from_snapshot(snapshot, *, env_board_id=''):
    if getattr(snapshot, 'source', None) == 'legacy_json':
        raise ValueError('work configuration capture requires a DB-only snapshot')
    return capture_virtual_bundle(snapshot.payload, env_board_id=env_board_id)


def stored_bundle(payload):
    """Normalized saved bundle when promoted, else None (a seed is ignored)."""
    if not is_promoted(payload):
        return None
    return normalize_work_configurations(payload[WORK_CONFIGURATIONS_KEY])


def editor_bundle(snapshot, *, env_board_id=''):
    """Saved bundle if promoted, otherwise the virtual capture."""
    return stored_bundle(snapshot.payload) or capture_from_snapshot(snapshot, env_board_id=env_board_id)


def build_editor_envelope(snapshot, *, flag_enabled, user_can_edit, env_board_id=''):
    bundle = editor_bundle(snapshot, env_board_id=env_board_id)
    return {
        'workConfigurations': bundle,
        'configRevision': snapshot.config_revision,
        'promoted': is_promoted(snapshot.payload),
        'userCanEditSettings': bool(user_can_edit),
        'featureEnabled': bool(flag_enabled),
    }


def load_editor_envelope(context, *, flag_enabled, user_can_edit, env_board_id='', database_url=None):
    """Virtual/saved GET envelope; DB row only, ``fallback_loader=None``, no write."""
    from backend.services import workspace_dashboard_config as storage
    snapshot = storage.load_workspace_config(context, fallback_loader=None, database_url=database_url)
    return build_editor_envelope(
        snapshot, flag_enabled=flag_enabled, user_can_edit=user_can_edit, env_board_id=env_board_id,
    )


def conflict_envelope(conflict, *, env_board_id=''):
    """``409 workspace_config_conflict`` body from a WorkspaceConfigConflict."""
    snapshot = conflict.current
    return {
        'error': 'workspace_config_conflict',
        'configRevision': snapshot.config_revision,
        'workConfigurations': editor_bundle(snapshot, env_board_id=env_board_id),
    }


# --- resolution and immutable context ---------------------------------------

def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value):
    if isinstance(value, MappingProxyType):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


@dataclass(frozen=True, eq=False)
class WorkConfigurationContext:
    """One request's configuration; carries no Capacity and no Jira I/O."""

    configuration_id: str
    name: str
    revision: int
    model: str
    quarter: str
    digest: str
    scope: object
    hierarchy: object
    fields: object
    legacy: object          # legacy-only compatibility metadata; empty on rnd_2027

    def to_dict(self):
        return {
            'configurationId': self.configuration_id, 'name': self.name, 'revision': self.revision,
            'model': self.model, 'quarter': self.quarter, 'digest': self.digest,
            'scope': _thaw(self.scope), 'hierarchy': _thaw(self.hierarchy),
            'fields': _thaw(self.fields), 'legacy': _thaw(self.legacy),
        }


def _entry_digest(entry):
    material = {key: value for key, value in entry.items() if key != 'name'}
    canonical = json.dumps(material, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:32]


def _entry_contains(entry, ordinal):
    low, high = entry['fromQuarter'], entry['throughQuarter']
    return ((low is None or quarter_ordinal(low) <= ordinal)
            and (high is None or ordinal <= quarter_ordinal(high)))


def _context_for(entry, quarter):
    legacy = {key: entry[key] for key in LEGACY_ONLY_KEYS if key in entry}
    return WorkConfigurationContext(
        configuration_id=entry['id'], name=entry['name'], revision=entry['revision'],
        model=entry['model'], quarter=quarter, digest=_entry_digest(entry),
        scope=_freeze(entry['scope']), hierarchy=_freeze(entry['hierarchy']),
        fields=_freeze(entry['fields']), legacy=_freeze(legacy),
    )


def resolve_work_configuration(snapshot, *, quarter, configuration_id=None, flag_enabled=None):
    """Resolve the request's one configuration from the viewed quarter.

    A supplied id must agree with the quarter.  Without a promoted bundle there
    is nothing to resolve (callers consult ``work_configuration_state`` first).
    """
    enabled = work_configurations_enabled() if flag_enabled is None else bool(flag_enabled)
    payload = snapshot.payload
    if not is_promoted(payload):
        raise WorkConfigError('configuration_required')
    if not enabled:
        raise WorkConfigError('configuration_feature_disabled')
    if quarter is None:
        raise WorkConfigError('configuration_required')
    ordinal = quarter_ordinal(quarter)
    entries = stored_bundle(payload)['configurations']
    if configuration_id is not None:
        entry = next((item for item in entries if item['id'] == configuration_id), None)
        if entry is None:
            raise WorkConfigError('invalid_configuration_id')
        if not _entry_contains(entry, ordinal):
            raise WorkConfigError('configuration_scope_changed')
    else:
        entry = next(item for item in entries if _entry_contains(item, ordinal))
    return _context_for(entry, quarter)


def entry_digest(entry):
    return _entry_digest(entry)


def entry_contains_quarter(entry, ordinal):
    return _entry_contains(entry, ordinal)


def get_stored_configuration(snapshot, configuration_id):
    """Metadata/editor lookup by id: reads the stored entry, never authorizes work."""
    bundle = editor_bundle(snapshot)
    entry = next((item for item in bundle['configurations'] if item['id'] == configuration_id), None)
    if entry is None:
        raise WorkConfigError('invalid_configuration_id')
    return deepcopy(entry)


def project_keys(entry):
    """Distinct selected project keys of a stored entry, original spelling, in order."""
    seen, keys = set(), []
    for item in entry['scope']['projects']:
        key = str(item.get('key') or '').strip()
        if key and key.upper() not in seen:
            seen.add(key.upper())
            keys.append(key)
    return keys


def entry_summary(entry):
    return {
        'id': entry['id'], 'name': entry['name'], 'revision': entry['revision'],
        'model': entry['model'], 'fromQuarter': entry['fromQuarter'],
        'throughQuarter': entry['throughQuarter'], 'digest': _entry_digest(entry),
    }


def entry_missing_fields(entry):
    """Schema paths still needed before this entry can serve work reads."""
    missing = []
    projects = bool(entry['scope']['projects'])
    sprint = bool(entry['fields']['sprint']['fieldId'])
    if not projects:
        missing.append('scope.projects')
    if not entry['scope']['boardId'] and not (projects and sprint):
        missing.append('scope.boardId')
    for name in ('sprint', 'storyPoints', 'team'):
        if not entry['fields'][name]['fieldId']:
            missing.append(f'fields.{name}.fieldId')
    if entry['model'] == MODEL_RND_2027:
        for key in ('planningIssueTypeId', 'parentIssueTypeId'):
            if not entry['hierarchy'][key]:
                missing.append(f'hierarchy.{key}')
    elif (entry['legacyHierarchyModes']['parent'] == 'mapped'
          and not entry['hierarchy']['parentIssueTypeId']):
        missing.append('hierarchy.parentIssueTypeId')
    return missing


SOURCE_MODE_BOARD = 'board'
SOURCE_MODE_SCOPED_ISSUES = 'scoped_issues'


def source_mode(entry):
    """Sprint source of a stored entry: a nonempty Board, else explicit projects + Sprint field."""
    if entry['scope']['boardId']:
        return SOURCE_MODE_BOARD
    if entry['scope']['projects'] and entry['fields']['sprint']['fieldId']:
        return SOURCE_MODE_SCOPED_ISSUES
    return None


def source_digest(entry):
    """Digest of what a Sprint/Team source depends on: id, range, scope and Sprint/Team mapping.

    Revision and name are excluded, so a rename keeps catalogs; a Board, project,
    range or mapped-field change retires them.
    """
    material = {
        'id': entry['id'], 'model': entry['model'],
        'fromQuarter': entry['fromQuarter'], 'throughQuarter': entry['throughQuarter'],
        'scope': entry['scope'],
        'sprint': entry['fields']['sprint']['fieldId'], 'team': entry['fields']['team']['fieldId'],
    }
    canonical = json.dumps(material, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:32]


def catalog_entries(snapshot, *, flag_enabled=None):
    """Stored entries that serve Sprint catalogs, or None while the workspace is unpromoted.

    Raises ``configuration_feature_disabled`` for a promoted workspace with the flag off.
    """
    if not is_promoted(snapshot.payload):
        return None
    enabled = work_configurations_enabled() if flag_enabled is None else bool(flag_enabled)
    if not enabled:
        raise WorkConfigError('configuration_feature_disabled')
    return stored_bundle(snapshot.payload)['configurations']


def quarter_in_entry_range(entry, quarter_name):
    """True when ``quarter_name`` is a canonical quarter inside the entry's range."""
    try:
        return _entry_contains(entry, quarter_ordinal(quarter_name))
    except WorkConfigError:
        return False


def project_legacy_admin_settings(context):
    """Flat admin-settings projection (old key shapes) for one context."""
    fields = _thaw(context.fields)
    result = {
        'projects': {'selected': [dict(item) for item in _thaw(context.scope)['projects']]},
        'board': {'boardId': _thaw(context.scope)['boardId'], 'boardName': ''},
    }
    for name, flat_key in LEGACY_FLAT_KEYS.items():
        result[flat_key] = dict(fields[name])
    names = _thaw(context.legacy).get('legacyIssueTypeNames')
    if names is not None:
        result['issueTypes'] = list(names)
    return result


# --- save -------------------------------------------------------------------

_EDIT_FIELD_PARTS = {'fieldId', 'fieldName'}
_EDIT_SCALAR_PATHS = {'name', 'fromQuarter', 'throughQuarter', 'scope.projects', 'scope.boardId'}
_EDIT_PATHS = (
    _EDIT_SCALAR_PATHS
    | {f'hierarchy.{key}' for key in HIERARCHY_KEYS}
    | {f'fields.{name}.{part}' for name in LEGACY_FIELD_NAMES for part in _EDIT_FIELD_PARTS}
)


def _normalize_edits(edits):
    if edits is None:
        return []
    if not isinstance(edits, list):
        _invalid('legacyEdits', 'Expected an array.')
    result, seen = [], set()
    for index, edit in enumerate(edits):
        path = f'legacyEdits[{index}]'
        _dict(edit, path, {'path', 'value', 'clear'}, {'path'})
        target = edit['path']
        if target not in _EDIT_PATHS:
            _invalid(f'{path}.path', 'Path is not editable on first save.')
        if target in seen:
            _invalid(f'{path}.path', 'Duplicate edit path.')
        seen.add(target)
        clear = edit.get('clear', False)
        if not isinstance(clear, bool):
            _invalid(f'{path}.clear', 'clear must be a boolean.')
        if clear == ('value' in edit):
            _invalid(path, 'Provide exactly one of value or clear:true.')
        value = edit.get('value')
        empty = value is None or value == '' or value == []
        if not clear and empty and not target.endswith('.fieldName'):
            _invalid(f'{path}.value', 'Blank values require an explicit clear.')
        result.append({'path': target, 'clear': clear, 'value': value})
    return result


def _apply_edits(legacy, edits):
    entry = deepcopy(legacy)
    for edit in edits:
        target, clear, value = edit['path'], edit['clear'], edit['value']
        if target == 'name':
            entry['name'] = '' if clear else value
        elif target in ('fromQuarter', 'throughQuarter'):
            entry[target] = None if clear else value
        elif target == 'scope.projects':
            entry['scope']['projects'] = [] if clear else value
        elif target == 'scope.boardId':
            entry['scope']['boardId'] = '' if clear else value
        elif target.startswith('hierarchy.'):
            key = target.split('.', 1)[1]
            entry['hierarchy'][key] = None if clear else value
            if key == 'planningIssueTypeId':
                entry['legacyIssueTypeNames'] = None
            for slot, slot_key in MODE_SLOTS.items():
                if slot_key == key:
                    entry['legacyHierarchyModes'][slot] = 'mapped'
        else:
            _, name, part = target.split('.')
            entry['fields'][name][part] = '' if clear else value
    return entry


def _strip_moved(payload):
    return {key: value for key, value in payload.items() if key not in MOVED_STRUCTURAL_KEYS}


def _check_server_owned(incoming_bundle, index, expected_id):
    entry = incoming_bundle['configurations'][index]
    if entry['id'] != expected_id:
        _invalid(f'configurations[{index}].id', 'Configuration ids are server-owned.')
    return entry


def _compare_entry(entry):
    return {key: value for key, value in entry.items() if key != 'revision'}


def _check_transition(stored, incoming):
    """Monotonic authority: retired compatibility cannot come back."""
    cid = stored['id']
    if stored['model'] != incoming['model']:
        _invalid('configurations.model', 'Models are server-owned.', configuration_id=cid)
    if stored['model'] != MODEL_LEGACY:
        return
    if incoming['legacyDisplayTypes'] != stored['legacyDisplayTypes']:
        _invalid('legacyDisplayTypes', 'Display metadata is server-owned.', configuration_id=cid)
    if stored['legacyIssueTypeNames'] is None and incoming['legacyIssueTypeNames'] is not None:
        _invalid(
            'legacyIssueTypeNames',
            'The planning name filter was retired by another editor; choose or clear the Jira type, or reload.',
            configuration_id=cid, slot='planningIssueTypeId',
        )
    if (stored['legacyIssueTypeNames'] is not None and incoming['legacyIssueTypeNames'] is not None
            and incoming['legacyIssueTypeNames'] != stored['legacyIssueTypeNames']):
        _invalid('legacyIssueTypeNames', 'The captured planning filter is server-owned.',
                 configuration_id=cid, slot='planningIssueTypeId')
    for slot, key in MODE_SLOTS.items():
        if stored['legacyHierarchyModes'][slot] == 'mapped' and incoming['legacyHierarchyModes'][slot] != 'mapped':
            _invalid(
                f'legacyHierarchyModes.{slot}',
                'Compatibility was retired by another editor; choose or clear the Jira type, or reload.',
                configuration_id=cid, slot=key,
            )


def _save_first(payload, revision, incoming, edits, display_types, env_board_id):
    legacy_in = _check_server_owned(incoming, 0, LEGACY_ID)
    delivery_in = _check_server_owned(incoming, 1, DELIVERY_ID)
    del legacy_in  # echoed Legacy is never authority; only explicit legacyEdits apply
    legacy = _apply_edits(capture_legacy_entry(payload, env_board_id=env_board_id), edits)
    if display_types:
        legacy['legacyDisplayTypes'] = {
            slot: deepcopy((display_types or {}).get(slot)) for slot in MODE_SLOTS
        }
    new_revision = revision + 1
    delivery = deepcopy(delivery_in)
    legacy['revision'] = delivery['revision'] = 1
    bundle = normalize_work_configurations({
        'version': BUNDLE_VERSION, 'promotionRevision': new_revision,
        'configurations': [legacy, delivery],
    })
    new_payload = _strip_moved(payload)
    new_payload[WORK_CONFIGURATIONS_KEY] = bundle
    return new_payload, bundle, [LEGACY_ID, DELIVERY_ID]


def _save_later(payload, incoming, clear_ids):
    stored = stored_bundle(payload)
    stored_entries, incoming_entries = stored['configurations'], incoming['configurations']
    known = {entry['id'] for entry in stored_entries}
    for cid in clear_ids:
        if cid not in known:
            raise WorkConfigError('invalid_configuration_id')
    if [e['id'] for e in incoming_entries] != [e['id'] for e in stored_entries]:
        _invalid('configurations', 'Configuration ids are server-owned.')
    entries, changed = [], []
    for old, new in zip(stored_entries, incoming_entries):
        _check_transition(old, new)
        if old['scope']['projects'] and not new['scope']['projects'] and old['id'] not in clear_ids:
            _invalid('scope.projects', 'Clearing projects requires an explicit clear.', configuration_id=old['id'])
        if _compare_entry(old) == _compare_entry(new):
            entries.append(old)
        else:
            new = dict(new, revision=old['revision'] + 1)
            entries.append(new)
            changed.append(old['id'])
    if not changed:
        return None, stored, []
    bundle = normalize_work_configurations({
        'version': BUNDLE_VERSION, 'promotionRevision': stored['promotionRevision'],
        'configurations': entries,
    })
    new_payload = dict(payload)
    new_payload[WORK_CONFIGURATIONS_KEY] = bundle
    return new_payload, bundle, changed


def save_work_configurations(
    context, bundle, base_revision, *, legacy_edits=None, clear_projects_for_configuration_ids=None,
    flag_enabled=None, env_board_id='', legacy_display_types=None, recheck=None, database_url=None,
):
    """Atomic bundle save.

    Unpromoted workspace: first save (``legacy_edits`` explicit, server recaptures
    Legacy under the fence, promotes, removes moved flat keys).  Promoted: full
    bundle CAS with ``clear_projects_for_configuration_ids``.  Returns the
    success envelope; raises ``WorkConfigError``, ``WorkspaceConfigConflict`` or
    ``WorkspaceConfigFenceUnavailable``.  ``legacy_display_types`` is bounded
    display metadata the caller prefetched outside the fence; ``recheck`` is
    called inside the fence with ``(payload, revision)`` to re-verify actor.
    """
    from backend.services import workspace_dashboard_config as storage

    if not (work_configurations_enabled() if flag_enabled is None else bool(flag_enabled)):
        raise WorkConfigError('configuration_feature_disabled')
    incoming = normalize_work_configurations(bundle)
    edits = _normalize_edits(legacy_edits)
    clear_ids = list(clear_projects_for_configuration_ids or [])
    if not all(isinstance(cid, str) for cid in clear_ids):
        _invalid('clearProjectsForConfigurationIds', 'Expected configuration id strings.')

    def mutate(payload, revision):
        if recheck is not None:
            recheck(payload, revision)
        promoted = is_promoted(payload)
        saved_marker = (payload.get(WORK_CONFIGURATIONS_KEY) or {}).get('promotionRevision') if promoted else None
        if incoming['promotionRevision'] not in (None, saved_marker):
            _invalid('promotionRevision', 'promotionRevision is server-owned.')
        if promoted:
            if legacy_edits is not None:
                _invalid('legacyEdits', 'legacyEdits apply to the first save only.')
            new_payload, saved, changed = _save_later(payload, incoming, clear_ids)
        else:
            if clear_ids:
                _invalid('clearProjectsForConfigurationIds', 'Not supported on the first save.')
            new_payload, saved, changed = _save_first(
                payload, revision, incoming, edits, legacy_display_types, env_board_id,
            )
        return storage.KeysMutation(new_payload, {'changedConfigurationIds': changed, 'bundle': saved})

    snapshot, result = storage.update_workspace_config_keys(
        context, base_revision, mutate, section=WORK_CONFIGURATIONS_KEY, database_url=database_url,
    )
    return {
        'workConfigurations': result['bundle'],
        'configRevision': snapshot.config_revision,
        'changedConfigurationIds': result['changedConfigurationIds'],
        'promoted': True,
    }
