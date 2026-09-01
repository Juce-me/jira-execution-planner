"""Workspace-owned Capacity Project and numeric Jira field configuration."""

from __future__ import annotations

from copy import deepcopy
import re

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.config.shared_config import normalize_shared_admin_section
from backend.db import engine as db_engine
from backend.db import models


CAPACITY_SOURCE_DB = 'workspace_db'
_FIELD_ID = re.compile(r'^customfield_\d+$')
_REQUEST_FIELDS = {'project', 'fieldId', 'fieldName'}
_IDENTITY_FIELDS = {
    'workspaceId', 'workspace_id', 'userId', 'user_id', 'cloudId', 'cloud_id',
    'siteUrl', 'site_url', 'accountId', 'account_id', 'fieldSchemaType',
    'fieldVerifiedAt', 'status', 'configRevision', 'createdBy', 'updatedBy',
}


class CapacityConfigConflict(Exception):
    def __init__(self, current, requires_resolution=False):
        super().__init__('capacity_config_conflict')
        self.current = current
        self.requires_resolution = bool(requires_resolution)


class InvalidSharedCapacityConfig(ValueError):
    pass


def normalize_site_url(value):
    return str(value or '').strip().rstrip('/').lower()


def _context_identity(context):
    return (
        normalize_site_url(getattr(context, 'site_url', '')),
        str(getattr(context, 'cloud_id', '') or '').strip(),
    )


def _capacity(payload):
    value = (payload or {}).get('capacity') if isinstance(payload, dict) else None
    if not isinstance(value, dict):
        return {'project': '', 'fieldId': '', 'fieldName': ''}
    return {
        'project': str(value.get('project') or '').strip().upper()[:64],
        'fieldId': str(value.get('fieldId') or '').strip(),
        'fieldName': str(value.get('fieldName') or '').strip()[:255],
    }


def _empty_config(*, revision=0, source=CAPACITY_SOURCE_DB, requires_resolution=False):
    return {
        'project': '', 'fieldId': '', 'fieldName': '',
        'configRevision': int(revision or 0), 'source': source,
        'requiresResolution': bool(requires_resolution), 'mutationEnabled': False,
    }


def _row_to_config(row, context):
    value = _capacity(row.payload)
    has_mapping = bool(value['project'] or value['fieldId'])
    site_url, cloud_id = _context_identity(context)
    identity_matches = (
        normalize_site_url(row.capacity_jira_site_url) == site_url
        and str(row.capacity_jira_cloud_id or '') == cloud_id
    )
    if has_mapping and not identity_matches:
        return _empty_config(revision=row.config_revision, requires_resolution=True)
    verified = (
        bool(value['project'] and value['fieldId'])
        and identity_matches
        and row.capacity_field_schema_type == 'number'
        and row.capacity_field_verified_at is not None
    )
    return {
        **value,
        'configRevision': int(row.config_revision or 0),
        'source': CAPACITY_SOURCE_DB,
        'requiresResolution': False,
        'mutationEnabled': bool(verified),
    }


def _fallback_config(fallback_loader):
    payload = fallback_loader() if fallback_loader is not None else None
    value = _capacity(payload)
    return {
        **value,
        'configRevision': 0,
        'source': 'legacy_json' if payload is not None else 'empty',
        'requiresResolution': False,
        'mutationEnabled': False,
    }


def current_shared_capacity_config(session, context):
    row = session.execute(
        select(models.WorkspaceDashboardConfig).where(
            models.WorkspaceDashboardConfig.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    return _row_to_config(row, context) if row is not None else _empty_config()


def load_shared_capacity_config(context, fallback_loader, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.WorkspaceDashboardConfig).where(
                models.WorkspaceDashboardConfig.workspace_id == context.workspace_id,
            )
        ).scalars().first()
        if row is not None:
            return _row_to_config(row, context)
    return _fallback_config(fallback_loader)


def _validate_payload(payload):
    if not isinstance(payload, dict):
        raise InvalidSharedCapacityConfig('capacity config must be an object')
    if set(payload) & _IDENTITY_FIELDS or set(payload) - _REQUEST_FIELDS:
        raise InvalidSharedCapacityConfig('capacity config contains unsupported fields')
    try:
        return normalize_shared_admin_section('capacity', payload)
    except ValueError as error:
        raise InvalidSharedCapacityConfig(str(error)) from error


def _verified_field(field_id, field_catalog):
    if not _FIELD_ID.fullmatch(field_id or ''):
        return None
    for field in field_catalog or []:
        if not isinstance(field, dict) or str(field.get('id') or '') != field_id:
            continue
        schema = field.get('schema') or {}
        if isinstance(schema, dict) and schema.get('type') == 'number':
            return field
    return None


def _revision(value):
    if isinstance(value, bool):
        raise InvalidSharedCapacityConfig('baseRevision is required')
    try:
        revision = int(value)
    except (TypeError, ValueError) as error:
        raise InvalidSharedCapacityConfig('baseRevision is required') from error
    if revision < 0:
        raise InvalidSharedCapacityConfig('baseRevision is required')
    return revision


def save_shared_capacity_config(context, payload, base_revision, field_catalog, database_url=None):
    revision = _revision(base_revision)
    capacity = _validate_payload(payload)
    project = str(capacity.get('project') or '').strip().upper()[:64]
    field_id = str(capacity.get('fieldId') or '').strip()
    verified_field = None
    if field_id:
        verified_field = _verified_field(field_id, field_catalog)
        if verified_field is None:
            raise InvalidSharedCapacityConfig('capacity_field_not_numeric')
        capacity['fieldName'] = str(verified_field.get('name') or '').strip()[:255]
    elif project:
        raise InvalidSharedCapacityConfig('capacity_field_not_numeric')
    capacity['project'] = project

    site_url, cloud_id = _context_identity(context)
    now = models._utcnow()
    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.WorkspaceDashboardConfig).where(
                models.WorkspaceDashboardConfig.workspace_id == context.workspace_id,
            )
        ).scalars().first()
        if row is None:
            if revision != 0:
                raise CapacityConfigConflict(_empty_config())
            row = models.WorkspaceDashboardConfig(
                workspace_id=context.workspace_id,
                payload={'capacity': capacity},
                config_revision=1,
                capacity_jira_site_url=site_url if verified_field else None,
                capacity_jira_cloud_id=cloud_id if verified_field else None,
                capacity_field_schema_type='number' if verified_field else None,
                capacity_field_verified_at=now if verified_field else None,
                created_by=getattr(context, 'user_id', None),
                updated_by=getattr(context, 'user_id', None),
            )
            session.add(row)
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                current = current_shared_capacity_config(session, context)
                raise CapacityConfigConflict(current, current.get('requiresResolution', False))
            next_revision = 1
        else:
            next_payload = deepcopy(row.payload or {})
            next_payload['capacity'] = capacity
            statement = (
                update(models.WorkspaceDashboardConfig)
                .where(
                    models.WorkspaceDashboardConfig.workspace_id == context.workspace_id,
                    models.WorkspaceDashboardConfig.config_revision == revision,
                )
                .values(
                    payload=next_payload,
                    config_revision=revision + 1,
                    capacity_jira_site_url=site_url if verified_field else None,
                    capacity_jira_cloud_id=cloud_id if verified_field else None,
                    capacity_field_schema_type='number' if verified_field else None,
                    capacity_field_verified_at=now if verified_field else None,
                    updated_by=getattr(context, 'user_id', None),
                    updated_at=now,
                )
            )
            result = session.execute(statement.execution_options(synchronize_session=False))
            if result.rowcount != 1:
                session.expire_all()
                current = current_shared_capacity_config(session, context)
                raise CapacityConfigConflict(current, current.get('requiresResolution', False))
            next_revision = revision + 1
        session.add(models.audit_event(
            workspace_id=context.workspace_id,
            actor_user_id=getattr(context, 'user_id', None),
            event_type='workspace_dashboard_config_updated',
            metadata={'section': 'capacity', 'revision': next_revision},
        ))
        session.flush()
        return {
            **capacity,
            'configRevision': next_revision,
            'source': CAPACITY_SOURCE_DB,
            'requiresResolution': False,
            'mutationEnabled': bool(verified_field and project),
        }
