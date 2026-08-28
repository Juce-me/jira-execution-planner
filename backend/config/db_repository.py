"""Database-backed user view configuration repository."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from backend.config.shared_config import sanitize_private_view_payload
from backend.db import engine as db_engine
from backend.db import models
from backend.services import workspace_dashboard_config


class ViewConfigNotFound(LookupError):
    """Raised when a user view cannot be resolved in the request workspace."""


def infer_view_type(payload):
    if not isinstance(payload, dict):
        return 'eng'
    has_eng = bool(payload.get('eng') or payload.get('filters') or payload.get('projects'))
    has_epm = bool(payload.get('epm'))
    if has_eng and has_epm:
        return 'mixed'
    if has_epm:
        return 'epm'
    return 'eng'


def strip_private_team_groups(payload):
    payload = dict(payload or {})
    payload.pop('teamGroups', None)
    return payload


class DbConfigRepository:
    def __init__(self, *, database_url=None):
        self.database_url = database_url

    def _default_view(self, session, context):
        statement = (
            select(models.ViewConfig)
            .where(
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.visibility == 'private',
                models.ViewConfig.is_default.is_(True),
                models.ViewConfig.archived_at.is_(None),
            )
            .order_by(models.ViewConfig.created_at.asc())
        )
        return session.execute(statement).scalars().first()

    def _selected_view(self, session, context, view_config_id):
        statement = (
            select(models.ViewConfig)
            .where(
                models.ViewConfig.id == view_config_id,
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.visibility == 'private',
                models.ViewConfig.archived_at.is_(None),
            )
        )
        return session.execute(statement).scalars().first()

    def load_dashboard_config_snapshot(self, context, *, fallback_loader=None, legacy_site_url=''):
        return workspace_dashboard_config.load_workspace_config(
            context,
            fallback_loader=fallback_loader,
            legacy_site_url=legacy_site_url,
            database_url=self.database_url,
        )

    def load_dashboard_config(self, context, *, fallback_loader=None, legacy_site_url=''):
        return self.load_dashboard_config_snapshot(
            context,
            fallback_loader=fallback_loader,
            legacy_site_url=legacy_site_url,
        ).payload

    def save_dashboard_section(self, context, section, value, base_revision, *, fallback_loader=None, legacy_site_url=''):
        return workspace_dashboard_config.update_workspace_config_section(
            context,
            section,
            value,
            base_revision,
            fallback_loader=fallback_loader,
            legacy_site_url=legacy_site_url,
            database_url=self.database_url,
        )

    def load_team_catalog(self, context):
        return workspace_dashboard_config.load_workspace_team_catalog(context, database_url=self.database_url)

    def save_team_catalog(self, context, payload, *, merge=False):
        return workspace_dashboard_config.save_workspace_team_catalog(
            context, payload, merge=merge, database_url=self.database_url,
        )

    def resolve_effective_view_config(self, context, *, view_config_id=None):
        from backend.services.user_view_config import UserViewConfigStorageError

        try:
            with db_engine.session_scope(self.database_url) as session:
                view = (
                    self._selected_view(session, context, view_config_id)
                    if view_config_id
                    else self._default_view(session, context)
                )
                if view is None:
                    raise ViewConfigNotFound('view config not found')
                version_number = session.execute(
                    select(func.max(models.ViewConfigVersion.version_number)).where(
                        models.ViewConfigVersion.view_config_id == view.id,
                    )
                ).scalar_one()
                return {
                    'source': 'user_saved_view',
                    'workspaceId': view.workspace_id,
                    'viewConfigId': view.id,
                    'viewType': view.view_type,
                    'view': sanitize_private_view_payload(strip_private_team_groups(view.payload)),
                    'versionNumber': int(version_number or 0),
                }
        except SQLAlchemyError as error:
            raise UserViewConfigStorageError('saved view read failed') from error

    def load_user_epm_config(self, context):
        from backend.services.user_view_config import load_user_epm_config

        return load_user_epm_config(context, database_url=self.database_url)

    def save_user_epm_config(self, context, payload, *, post_commit=None):
        from backend.services.user_view_config import save_user_epm_config

        return save_user_epm_config(
            context,
            payload,
            database_url=self.database_url,
            post_commit=post_commit,
        )

    def save_dashboard_config(self, context, payload, **kwargs):
        del context, payload, kwargs
        raise RuntimeError('full workspace dashboard replacement is forbidden in DB mode')
