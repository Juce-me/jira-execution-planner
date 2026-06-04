"""Database-backed user view configuration repository."""

from __future__ import annotations

from sqlalchemy import func, select

from backend.config.view_validation import validate_user_view_payload
from backend.db import engine as db_engine
from backend.db import models


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

    def _next_version_number(self, session, view_config_id):
        statement = select(func.max(models.ViewConfigVersion.version_number)).where(
            models.ViewConfigVersion.view_config_id == view_config_id,
        )
        current = session.execute(statement).scalar_one()
        return int(current or 0) + 1

    def load_dashboard_config(self, context, *, fallback_loader=None):
        with db_engine.session_scope(self.database_url) as session:
            view = self._default_view(session, context)
            if view is not None:
                return strip_private_team_groups(view.payload)
        if fallback_loader is not None:
            fallback_payload = fallback_loader()
            if fallback_payload is None:
                return None
            return strip_private_team_groups(fallback_payload)
        return None

    def resolve_effective_view_config(self, context, *, view_config_id=None):
        with db_engine.session_scope(self.database_url) as session:
            view = (
                self._selected_view(session, context, view_config_id)
                if view_config_id
                else self._default_view(session, context)
            )
            if view is None:
                raise ViewConfigNotFound('view config not found')
            return {
                'source': 'user_saved_view',
                'workspaceId': view.workspace_id,
                'viewConfigId': view.id,
                'viewType': view.view_type,
                'view': strip_private_team_groups(view.payload),
            }

    def save_dashboard_config(self, context, payload, *, actor_user_id=None, change_note='compatibility save'):
        actor_user_id = actor_user_id or context.user_id
        payload = strip_private_team_groups(payload)
        validate_user_view_payload(payload)
        with db_engine.session_scope(self.database_url) as session:
            view = self._default_view(session, context)
            if view is None:
                view = models.ViewConfig(
                    workspace_id=context.workspace_id,
                    owner_user_id=context.user_id,
                    name='Default view',
                    view_type=infer_view_type(payload),
                    payload_version=int(payload.get('version') or 1),
                    payload=payload,
                    visibility='private',
                    is_default=True,
                )
                session.add(view)
                session.flush()
            else:
                view.view_type = infer_view_type(payload)
                view.payload_version = int(payload.get('version') or view.payload_version or 1)
                view.payload = payload
            session.add(models.ViewConfigVersion(
                view_config_id=view.id,
                version_number=self._next_version_number(session, view.id),
                payload=dict(payload),
                created_by=actor_user_id,
                change_note=change_note,
            ))
            session.flush()
            return view.id
