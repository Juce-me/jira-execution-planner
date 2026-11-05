"""Configuration stamp guard for own-key Jira writes, write options and Sprint review calls.

A browser that edits one issue sends the admitted ``configuration`` stamp
``{id, revision, quarter, digest}`` it was rendered under.  After promotion the server
re-resolves the current workspace configuration and rejects a stale or mismatched stamp
before any Jira read or write.  Nothing here performs Jira I/O or writes storage.

Unpromoted workspaces keep their request shapes: a stamp is optional there and ignored
(only a stamp sent while the feature flag is off is refused).  The stamp never names a
model: the server derives the model, the mapped parent/child issue types and the field ids
from the resolved configuration, so a client cannot widen what a write may target.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
import re

from backend.services import work_structure as ws

STAMP_KEYS = frozenset({'id', 'revision', 'quarter', 'digest'})
QUERY_STAMP_KEYS = ('configurationId', 'configurationRevision', 'quarter', 'configurationDigest')
_ID_RE = re.compile(r'[A-Za-z0-9_-]{1,64}')
_DIGEST_RE = re.compile(r'[0-9a-f]{32}')
_REVISION_RE = re.compile(r'[0-9]{1,9}')
_FIELD_NAMES = ('team', 'deliveryOwner', 'storyPoints', 'projectTrack')
# Review/hierarchy levels for the new model: planning type is the child (Epic), parent type the Initiative.
CHILD_LEVEL, PARENT_LEVEL = 1, 2


@dataclass(frozen=True, eq=False)
class WriteScope:
    configuration_id: str
    revision: int
    digest: str
    quarter: str
    model: str
    planning_type_id: str | None
    parent_type_id: str | None
    field_ids: object

    @property
    def mapped(self):
        """True for the new model, where roles come from mapped type ids and never from names."""
        return self.model == ws.MODEL_RND_2027

    @property
    def review_configuration_id(self):
        """Review namespace: NULL Legacy for the Legacy model, the opaque configuration id otherwise."""
        return self.configuration_id if self.mapped else None

    def role(self, type_id, level):
        """``'child'``/``'parent'`` for an exact mapped type id plus its hierarchy level, else None."""
        type_id = str(type_id or '')
        if not type_id or isinstance(level, bool) or not isinstance(level, int):
            return None
        if type_id == self.planning_type_id and level == CHILD_LEVEL:
            return 'child'
        if type_id == self.parent_type_id and level == PARENT_LEVEL:
            return 'parent'
        return None

    def review_type_map(self):
        """``{kind: (mapped type id, expected level)}`` for the review authorizer (new model only)."""
        if not self.mapped:
            return None
        missing = [path for path, value in (('hierarchy.planningIssueTypeId', self.planning_type_id),
                                            ('hierarchy.parentIssueTypeId', self.parent_type_id)) if not value]
        if missing:
            raise ws.WorkConfigError('configuration_incomplete', paths=missing,
                                     configuration_id=self.configuration_id)
        return {'epic': (self.planning_type_id, CHILD_LEVEL), 'initiative': (self.parent_type_id, PARENT_LEVEL)}


def parse_stamp(raw, *, digest_required=True):
    """Strict ``{id,revision,quarter,digest}``; ``WorkConfigError`` (400) on any malformed value."""
    if not isinstance(raw, dict):
        raise ws.WorkConfigError('invalid_configuration_id')
    keys = set(raw)
    required = STAMP_KEYS if digest_required else STAMP_KEYS - {'digest'}
    if not required <= keys or not keys <= STAMP_KEYS:
        raise ws.WorkConfigError('invalid_configuration_id')
    config_id, revision, digest = raw['id'], raw['revision'], raw.get('digest')
    if not isinstance(config_id, str) or _ID_RE.fullmatch(config_id) is None:
        raise ws.WorkConfigError('invalid_configuration_id')
    if isinstance(revision, bool) or not isinstance(revision, int) or not 0 <= revision <= 999999999:
        raise ws.WorkConfigError('invalid_configuration_id')
    if digest is not None and (not isinstance(digest, str) or _DIGEST_RE.fullmatch(digest) is None):
        raise ws.WorkConfigError('invalid_configuration_id')
    ws.parse_quarter(raw['quarter'])
    return {'id': config_id, 'revision': revision, 'quarter': raw['quarter'], 'digest': digest}


def split_body_stamp(payload):
    """``(body_without_stamp, raw_stamp)``; a present-but-null ``configuration`` is malformed, not absent."""
    body = dict(payload)
    if 'configuration' not in body:
        return body, None
    stamp = body.pop('configuration')
    return body, ({} if stamp is None else stamp)


def stamp_from_args(args):
    """Stamp from GET query names; ``None`` when no stamp name is present.  Digest is optional here."""
    if not any(name in args for name in QUERY_STAMP_KEYS):
        return None
    values = {}
    for name in QUERY_STAMP_KEYS:
        found = args.getlist(name)
        if len(found) > 1:
            raise ws.WorkConfigError('invalid_quarter' if name == 'quarter' else 'invalid_configuration_id')
        values[name] = found[0] if found else None
    revision = values['configurationRevision']
    if revision is None or _REVISION_RE.fullmatch(revision) is None:
        raise ws.WorkConfigError('invalid_configuration_id')
    if values['configurationId'] is None or values['quarter'] is None:
        raise ws.WorkConfigError('invalid_configuration_id')
    raw = {'id': values['configurationId'], 'revision': int(revision), 'quarter': values['quarter']}
    if values['configurationDigest'] is not None:
        raw['digest'] = values['configurationDigest']
    return raw


def _scope_for(context):
    hierarchy = context.hierarchy
    fields = {'assignee': 'assignee', 'summary': 'summary'}
    for name in _FIELD_NAMES:
        fields[name] = str((context.fields.get(name) or {}).get('fieldId') or '').strip()
    return WriteScope(
        configuration_id=context.configuration_id, revision=context.revision, digest=context.digest,
        quarter=context.quarter, model=context.model,
        planning_type_id=hierarchy.get('planningIssueTypeId') or None,
        parent_type_id=hierarchy.get('parentIssueTypeId') or None,
        field_ids=MappingProxyType(fields),
    )


def resolve_scope(raw_stamp, *, db_request, snapshot_loader, flag_enabled=None, digest_required=True):
    """The request's ``WriteScope``, or ``None`` when the unscoped (Legacy flat) path applies.

    ``raw_stamp`` is the supplied stamp dict or ``None``.  Order: shape (400), request kind,
    durable state, then re-resolution against the current bundle (409).  Only the final
    comparison can raise ``configuration_scope_changed``; no Jira is touched on any path.
    """
    stamp = None if raw_stamp is None else parse_stamp(raw_stamp, digest_required=digest_required)
    if not db_request:
        if stamp is not None:
            raise ws.WorkConfigError('work_configuration_setup_required')
        return None
    flag = ws.work_configurations_enabled() if flag_enabled is None else bool(flag_enabled)
    snapshot = snapshot_loader()
    state = ws.work_configuration_state(snapshot.payload, flag_enabled=flag)
    if not state.promoted:
        if stamp is not None and not flag:
            raise ws.WorkConfigError('configuration_feature_disabled')
        return None
    if not flag:
        raise ws.WorkConfigError('configuration_feature_disabled')
    if stamp is None:
        raise ws.WorkConfigError('configuration_required')
    context = ws.resolve_work_configuration(
        snapshot, quarter=stamp['quarter'], configuration_id=stamp['id'], flag_enabled=flag)
    if context.revision != stamp['revision'] or (stamp['digest'] is not None and context.digest != stamp['digest']):
        raise ws.WorkConfigError('configuration_scope_changed')
    return _scope_for(context)
