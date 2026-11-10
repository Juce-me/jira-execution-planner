"""Shared plan primitives. The caller owns authorization, schema fences and the transaction.

Call initialize_plan once, then apply_inclusion_changes once for the atomic batch, carrying
its explicit created flag even across flushes. No helper opens a session or commits.
"""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import uuid

from sqlalchemy import and_, delete, func, select

from backend.db import models

MAX_INCLUSION_CHANGES = 500
MAX_PLAN_ENTRIES = 10000
MAX_UNEXPIRED_OPERATIONS = 256
MAX_ACKNOWLEDGEMENT_BYTES = 1024 * 1024


def _error(code='invalid_review_request', status=400, **details):
    # Sprint review is the existing error owner; a local import keeps its v2 integration acyclic.
    from backend.services.sprint_review import ReviewError
    return ReviewError(code, status, **details)


def _numeric(value):
    if not isinstance(value, str) or len(value) > 128 or re.fullmatch(r'[1-9][0-9]*', value) is None:
        raise _error()
    return value


def _revision(value):
    if type(value) is not int or not 0 <= value <= 2147483646:
        raise _error()
    return value


def normalize_inclusion_changes(changes):
    if not isinstance(changes, list) or len(changes) > MAX_INCLUSION_CHANGES:
        raise _error()
    seen, result = set(), []
    for change in changes:
        if not isinstance(change, dict) or set(change) != {'issueId', 'included', 'baseRevision'}:
            raise _error()
        identity = _numeric(change['issueId'])
        if identity in seen or type(change['included']) is not bool:
            raise _error()
        seen.add(identity)
        result.append(dict(issueId=identity, included=change['included'], baseRevision=_revision(change['baseRevision'])))
    return result


def initialize_plan(session, schema_id, sprint_id, initialize):
    """Return (locked plan, newly_initialized); requires the caller's namespace schema fence."""
    _numeric(sprint_id)
    if type(initialize) is not bool:
        raise _error()
    plan = session.scalar(select(models.GroupSprintPlan).where(
        models.GroupSprintPlan.schema_id == schema_id, models.GroupSprintPlan.sprint_id == sprint_id).with_for_update().execution_options(populate_existing=True))
    if plan is not None:
        return plan, False
    if not initialize:
        raise _error('plan_initialization_required')
    plan = models.GroupSprintPlan(id=str(uuid.uuid4()), schema_id=schema_id, sprint_id=sprint_id, revision=1)
    session.add(plan)
    return plan, True


def _entry(entry):
    return {'issueId': entry.issue_id, 'included': entry.included, 'revision': entry.revision}


def apply_inclusion_changes(session, plan, changes, *, newly_initialized=False, locked_entries=None):
    """Apply one validated batch. An initial save stays revision1, including after flush."""
    changes = normalize_inclusion_changes(changes)
    if type(newly_initialized) is not bool:
        raise _error()
    ids = [c['issueId'] for c in changes]
    if locked_entries is not None:
        entries = locked_entries
    else:
        entries = {e.issue_id: e for e in session.scalars(select(models.GroupSprintPlanEntry).where(
            models.GroupSprintPlanEntry.plan_id == plan.id, models.GroupSprintPlanEntry.issue_id.in_(ids))
            .with_for_update().execution_options(populate_existing=True)).all()} if ids else {}
    conflicts, decisions = [], []
    for change in changes:
        entry = entries.get(change['issueId'])
        current, revision = (entry.included, entry.revision) if entry else (False, 0)
        if change['baseRevision'] != revision and change['included'] != current:
            conflicts.append({'issueId': change['issueId'], 'included': current, 'revision': revision})
        decisions.append(change['included'] != current)
    if conflicts:
        raise _error('review_conflict', 409, inclusionConflicts=conflicts)
    additions = sum(changed and c['issueId'] not in entries for c, changed in zip(changes, decisions))
    if additions and session.scalar(select(func.count()).select_from(models.GroupSprintPlanEntry).where(
            models.GroupSprintPlanEntry.plan_id == plan.id)) + additions > MAX_PLAN_ENTRIES:
        raise _error('plan_entry_limit', 413)
    if any(changed and entries.get(c['issueId']) is not None and entries[c['issueId']].revision >= 2147483646
           for c, changed in zip(changes, decisions)):
        raise _error('plan_revision_limit', 413)
    if any(decisions) and not newly_initialized:
        if plan.revision >= 2147483646:
            raise _error('plan_revision_limit', 413)
        plan.revision += 1
    saved = []
    for change, changed in zip(changes, decisions):
        entry = entries.get(change['issueId'])
        if changed:
            if entry is None:
                entry = models.GroupSprintPlanEntry(plan_id=plan.id, issue_id=change['issueId'], included=change['included'], revision=1)
                session.add(entry)
            else:
                entry.included, entry.revision = change['included'], entry.revision + 1
        saved.append(_entry(entry) if entry else {'issueId': change['issueId'], 'included': False, 'revision': 0})
    return saved


def load_inclusion_projection(session, schema_id, sprint_id, allowed_ids, expected_revision=None):
    """One SQL snapshot, projecting only caller-authorized identities; never creates rows."""
    _numeric(sprint_id)
    if not isinstance(allowed_ids, list) or len(allowed_ids) > MAX_INCLUSION_CHANGES:
        raise _error()
    for identity in allowed_ids:
        _numeric(identity)
    if len(set(allowed_ids)) != len(allowed_ids):
        raise _error()
    if expected_revision is not None:
        _revision(expected_revision)
    plan, entry = models.GroupSprintPlan, models.GroupSprintPlanEntry
    rows = session.execute(select(plan.id, plan.revision, entry.issue_id, entry.included, entry.revision.label('entry_revision'))
        .outerjoin(entry, and_(entry.plan_id == plan.id, entry.issue_id.in_(allowed_ids)))
        .where(plan.schema_id == schema_id, plan.sprint_id == sprint_id)).all()
    revision = rows[0].revision if rows else 0
    if expected_revision is not None and revision != expected_revision:
        raise _error('plan_projection_changed', 409)
    entries = {r.issue_id: {'issueId': r.issue_id, 'included': r.included, 'revision': r.entry_revision} for r in rows if r.issue_id is not None}
    return {'plan': {'exists': bool(rows), 'revision': revision},
            'planEntries': [entries.get(i, {'issueId': i, 'included': False, 'revision': 0}) for i in allowed_ids]}


@dataclass(frozen=True)
class OperationIdentity:
    operation_id: str
    created_at: datetime
    expires_at: datetime


def _utc(now):
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise _error('invalid_operation_id')
    return now.astimezone(timezone.utc)


def operation_identity(value, now):
    """Parse UUIDv7 and immutable expiry. Expired identities may still identify retained receipts."""
    now = _utc(now)
    try:
        parsed = uuid.UUID(value) if isinstance(value, str) else None
        if parsed is None or str(parsed) != value or parsed.version != 7 or parsed.variant != uuid.RFC_4122:
            raise ValueError()
        created = datetime.fromtimestamp((parsed.int >> 80) / 1000, timezone.utc)
        if created > now + timedelta(minutes=5):
            raise ValueError()
    except (ValueError, TypeError, OverflowError, OSError):
        raise _error('invalid_operation_id') from None
    return OperationIdentity(value, created, created + timedelta(hours=24))


def require_unexpired_operation(identity, now):
    if identity.expires_at <= _utc(now):
        raise _error('operation_expired', 410)


def canonical_request_hash(payload, scope):
    """Stateless canonical identity: server scope plus complete normalized syntactic v2 body.

    Inclusion/cell arrays are sets by identity; schema actions retain their execution order.
    Configuration stamps and scope proof are hashed without consulting mutable admission state.
    """
    allowed = {'version', 'groupId', 'operationId', 'initializePlan', 'basePlanRevision', 'baseScopeProof',
               'inclusionChanges', 'baseSchemaRevision', 'baseViewRevision', 'schemaChanges', 'cellChanges', 'configuration'}
    if (not isinstance(payload, dict) or set(payload) - allowed or type(payload.get('version')) is not int or payload.get('version') != 2
            or not isinstance(scope, dict) or set(scope) != {'workspaceId', 'groupId', 'configurationId', 'sprintId'}
            or payload.get('groupId') != scope['groupId'] or type(payload.get('initializePlan')) is not bool
            or not isinstance(payload.get('baseScopeProof'), str)):
        raise _error()
    _numeric(scope['sprintId'])
    normalized = deepcopy(payload)
    normalized['basePlanRevision'] = _revision(payload.get('basePlanRevision'))
    normalized['baseSchemaRevision'] = _revision(payload.get('baseSchemaRevision'))
    normalized['baseViewRevision'] = _revision(payload.get('baseViewRevision', 0))
    normalized['inclusionChanges'] = sorted(normalize_inclusion_changes(payload.get('inclusionChanges', [])), key=lambda c: c['issueId'])
    for key in ('cellChanges', 'schemaChanges'):
        if not isinstance(payload.get(key, []), list):
            raise _error()
        normalized[key] = deepcopy(payload.get(key, []))
    try:
        normalized['cellChanges'].sort(key=lambda c: (c['issueId'], c['rowKind'], c['columnId']))
        encoded = json.dumps({'scope': scope, 'payload': normalized}, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, KeyError):
        raise _error() from None
    return hashlib.sha256(encoded).hexdigest()


def find_operation(session, workspace_id, actor_id, operation_id, *, scope=None, request_hash=None):
    """Actor-bound retained lookup, with optional immutable persisted scope/hash matching."""
    row = session.execute(select(models.PlanningSaveOperation, models.GroupSprintPlan, models.WorkspaceGroupReviewSchema)
        .join(models.GroupSprintPlan, models.PlanningSaveOperation.plan_id == models.GroupSprintPlan.id)
        .join(models.WorkspaceGroupReviewSchema, models.GroupSprintPlan.schema_id == models.WorkspaceGroupReviewSchema.id)
        .where(models.PlanningSaveOperation.workspace_id == workspace_id,
               models.PlanningSaveOperation.actor_user_id == actor_id,
               models.PlanningSaveOperation.operation_id == operation_id)).first()
    if row is None:
        return None
    receipt, plan, schema = row
    stored_scope = {'workspaceId': schema.workspace_id, 'groupId': schema.group_id,
                    'configurationId': schema.configuration_id, 'sprintId': plan.sprint_id}
    if schema.workspace_id != workspace_id or (scope is not None and scope != stored_scope) or (request_hash is not None and request_hash != receipt.request_hash):
        raise _error('operation_id_reused', 409)
    return receipt


def operation_metadata(receipt):
    """Outcome reads disclose no submitted issue ids or review values."""
    ack = receipt.acknowledgement
    result = {'operationId': receipt.operation_id, 'status': 'committed', 'plan': deepcopy(ack['plan'])}
    for key in ('schemaRevision', 'viewRevision'):
        if key in ack:
            result[key] = ack[key]
    return result


def record_operation(session, plan, workspace_id, actor_id, identity, request_hash, acknowledgement, now):
    """Stage one missing receipt under the common fence, after expiry/cap/size checks.

    The coordinator resolves retained receipts before calling this insert-only helper.
    """
    if identity != operation_identity(identity.operation_id, now):
        raise _error('invalid_operation_id')
    require_unexpired_operation(identity, now)
    if not isinstance(request_hash, str) or re.fullmatch('[0-9a-f]{64}', request_hash) is None:
        raise _error()
    schema_workspace = session.scalar(select(models.WorkspaceGroupReviewSchema.workspace_id).where(models.WorkspaceGroupReviewSchema.id == plan.schema_id))
    if schema_workspace != workspace_id:
        raise _error('operation_id_reused', 409)
    try:
        encoded = json.dumps(acknowledgement, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        if len(encoded.encode('utf-8')) > MAX_ACKNOWLEDGEMENT_BYTES:
            raise _error('review_response_limit', 413)
        if not isinstance(acknowledgement, dict) or set(acknowledgement.get('plan', {})) != {'exists', 'revision'}:
            raise _error()
    except (TypeError, ValueError) as error:
        # ReviewError derives from ValueError; preserve typed bounds/validation failures.
        if hasattr(error, 'code'):
            raise
        raise _error('invalid_review_request') from None
    model = models.PlanningSaveOperation
    scoped = (model.workspace_id == workspace_id, model.actor_user_id == actor_id, model.plan_id == plan.id)
    if session.scalar(select(func.count()).select_from(model).where(*scoped, model.expires_at > _utc(now))) >= MAX_UNEXPIRED_OPERATIONS:
        raise _error('planning_operation_limit', 429)
    session.execute(delete(model).where(*scoped, model.expires_at <= _utc(now)))
    receipt = model(workspace_id=workspace_id, actor_user_id=actor_id, operation_id=identity.operation_id,
                    plan_id=plan.id, request_hash=request_hash, acknowledgement=deepcopy(acknowledgement), expires_at=identity.expires_at)
    session.add(receipt)
    return receipt


def require_operation_capacity(session, plan_id, workspace_id, actor_id, now):
    model = models.PlanningSaveOperation
    if session.scalar(select(func.count()).select_from(model).where(
            model.plan_id == plan_id, model.workspace_id == workspace_id,
            model.actor_user_id == actor_id, model.expires_at > _utc(now))) >= MAX_UNEXPIRED_OPERATIONS:
        raise _error('planning_operation_limit', 429)
