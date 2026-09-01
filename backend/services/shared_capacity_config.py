"""Workspace-owned Capacity Project and numeric Jira field configuration."""

from __future__ import annotations

import re

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

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


def _normalize_project(value):
    return str(value or '').strip().upper()[:64]


def _normalize_field_id(value):
    return str(value or '').strip()


def _normalize_field_name(value):
    return str(value or '').strip()[:255]


def _context_identity(context):
    return normalize_site_url(getattr(context, 'site_url', '')), str(getattr(context, 'cloud_id', '') or '').strip()


def _empty_config(*, revision=1, source=CAPACITY_SOURCE_DB, requires_resolution=False):
    return {
        'project': '', 'fieldId': '', 'fieldName': '',
        'configRevision': int(revision or 1), 'source': source,
        'requiresResolution': bool(requires_resolution), 'mutationEnabled': False,
    }


def _row_matches_context(row, context):
    site_url, cloud_id = _context_identity(context)
    return normalize_site_url(row.jira_site_url) == site_url and str(row.jira_cloud_id or '') == cloud_id


def _row_to_config(row, context):
    if not _row_matches_context(row, context):
        return _empty_config(revision=row.config_revision, requires_resolution=True)
    requires_resolution = row.status == 'requires_resolution'
    verified = (
        not requires_resolution
        and bool(row.project_key and row.field_id)
        and row.field_schema_type == 'number'
        and row.field_verified_at is not None
    )
    if requires_resolution:
        return _empty_config(revision=row.config_revision, requires_resolution=True)
    return {
        'project': row.project_key or '',
        'fieldId': row.field_id or '',
        'fieldName': row.field_name or '',
        'configRevision': int(row.config_revision or 1),
        'source': CAPACITY_SOURCE_DB,
        'requiresResolution': False,
        'mutationEnabled': bool(verified),
    }


def _root_capacity(payload):
    if not isinstance(payload, dict) or 'capacity' not in payload:
        return None
    value = payload.get('capacity')
    if not isinstance(value, dict):
        return ('', '', '')
    return (
        _normalize_project(value.get('project')),
        _normalize_field_id(value.get('fieldId')),
        _normalize_field_name(value.get('fieldName')),
    )


def _legacy_values(session, context):
    values = []
    views = session.execute(
        select(models.ViewConfig).where(models.ViewConfig.workspace_id == context.workspace_id)
    ).scalars().all()
    for view in views:
        value = _root_capacity(view.payload)
        if value is not None:
            values.append(value)
    versions = session.execute(
        select(models.ViewConfigVersion)
        .join(models.ViewConfig, models.ViewConfig.id == models.ViewConfigVersion.view_config_id)
        .where(models.ViewConfig.workspace_id == context.workspace_id)
    ).scalars().all()
    for version in versions:
        value = _root_capacity(version.payload)
        if value is not None:
            values.append(value)
    return set(values), views, versions


def workspace_capacity_has_private_remnant(session, context):
    """Whether reconciliation will promote or resolve a saved-view capacity value."""
    values, _views, _versions = _legacy_values(session, context)
    return bool(values)


def _strip_payload(payload):
    payload = dict(payload or {})
    payload.pop('capacity', None)
    return payload


def _strip_legacy_payloads(views, versions):
    for row in [*views, *versions]:
        if isinstance(row.payload, dict) and 'capacity' in row.payload:
            row.payload = _strip_payload(row.payload)


def _eligible_capacity_from_payload(payload):
    value = _root_capacity(payload)
    return value if value is not None else None


def ensure_workspace_capacity_reconciled(session, context, eligible_legacy_loader=None):
    """Materialize the single durable row before any private payload is changed."""
    row = session.execute(
        select(models.WorkspaceCapacityConfig).where(
            models.WorkspaceCapacityConfig.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    values, views, versions = _legacy_values(session, context)
    if row is not None:
        _strip_legacy_payloads(views, versions)
        return row

    site_url, cloud_id = _context_identity(context)
    if len(values) == 1:
        project, field_id, field_name = next(iter(values))
        row_kwargs = {'status': 'active', 'project_key': project, 'field_id': field_id, 'field_name': field_name}
    elif len(values) > 1:
        row_kwargs = {'status': 'requires_resolution', 'project_key': '', 'field_id': '', 'field_name': ''}
    else:
        legacy_payload = eligible_legacy_loader() if eligible_legacy_loader is not None else None
        legacy = _eligible_capacity_from_payload(legacy_payload)
        if legacy is None:
            row_kwargs = {'status': 'active', 'project_key': '', 'field_id': '', 'field_name': ''}
        else:
            project, field_id, field_name = legacy
            row_kwargs = {'status': 'active', 'project_key': project, 'field_id': field_id, 'field_name': field_name}
    row = models.WorkspaceCapacityConfig(
        workspace_id=context.workspace_id,
        jira_site_url=site_url,
        jira_cloud_id=cloud_id,
        config_revision=1,
        created_by=getattr(context, 'user_id', None),
        updated_by=getattr(context, 'user_id', None),
        **row_kwargs,
    )
    try:
        with session.begin_nested():
            session.add(row)
            session.flush()
    except IntegrityError:
        row = session.execute(
            select(models.WorkspaceCapacityConfig).where(
                models.WorkspaceCapacityConfig.workspace_id == context.workspace_id,
            )
        ).scalars().one()
    _strip_legacy_payloads(views, versions)
    return row


def current_shared_capacity_config(session, context):
    row = session.execute(
        select(models.WorkspaceCapacityConfig).where(
            models.WorkspaceCapacityConfig.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    return _row_to_config(row, context) if row is not None else _empty_config()


def load_shared_capacity_config(context, fallback_loader, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = ensure_workspace_capacity_reconciled(session, context, fallback_loader)
        return _row_to_config(row, context)


def _validate_payload(payload):
    if not isinstance(payload, dict):
        raise InvalidSharedCapacityConfig('capacity config must be an object')
    forbidden = set(payload) & _IDENTITY_FIELDS
    unknown = set(payload) - _REQUEST_FIELDS
    if forbidden or unknown:
        raise InvalidSharedCapacityConfig('capacity config contains unsupported fields')
    return _normalize_project(payload.get('project')), _normalize_field_id(payload.get('fieldId')), _normalize_field_name(payload.get('fieldName'))


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


def save_shared_capacity_config(context, payload, base_revision, field_catalog, database_url=None):
    try:
        revision = int(base_revision)
    except (TypeError, ValueError) as error:
        raise InvalidSharedCapacityConfig('baseRevision is required') from error
    if revision < 1:
        raise InvalidSharedCapacityConfig('baseRevision is required')
    project, field_id, field_name = _validate_payload(payload)
    verified_field = None
    if field_id:
        verified_field = _verified_field(field_id, field_catalog)
        if verified_field is None:
            raise InvalidSharedCapacityConfig('capacity_field_not_numeric')
        field_name = _normalize_field_name(verified_field.get('name'))
    elif project:
        raise InvalidSharedCapacityConfig('capacity_field_not_numeric')

    with db_engine.session_scope(database_url) as session:
        ensure_workspace_capacity_reconciled(session, context)
        site_url, cloud_id = _context_identity(context)
        statement = (
            update(models.WorkspaceCapacityConfig)
            .where(
                models.WorkspaceCapacityConfig.workspace_id == context.workspace_id,
                models.WorkspaceCapacityConfig.config_revision == revision,
                models.WorkspaceCapacityConfig.jira_site_url == site_url,
                models.WorkspaceCapacityConfig.jira_cloud_id == cloud_id,
            )
            .values(
                jira_site_url=site_url,
                jira_cloud_id=cloud_id,
                status='active',
                project_key=project,
                field_id=field_id,
                field_name=field_name,
                field_schema_type='number' if verified_field else '',
                field_verified_at=models._utcnow() if verified_field else None,
                config_revision=revision + 1,
                updated_by=getattr(context, 'user_id', None),
                updated_at=models._utcnow(),
            )
        )
        result = session.execute(statement)
        if result.rowcount != 1:
            current = current_shared_capacity_config(session, context)
            raise CapacityConfigConflict(current, current.get('requiresResolution', False))
        row = session.execute(
            select(models.WorkspaceCapacityConfig).where(
                models.WorkspaceCapacityConfig.workspace_id == context.workspace_id,
            )
        ).scalars().one()
        return _row_to_config(row, context)
