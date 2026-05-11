"""Database-backed user view configuration repository."""

from __future__ import annotations

from sqlalchemy import func, select

from backend.db import engine as db_engine
from backend.db import models


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
                return dict(view.payload or {})
        if fallback_loader is not None:
            return fallback_loader()
        return None

    def save_dashboard_config(self, context, payload, *, actor_user_id=None, change_note='compatibility save'):
        actor_user_id = actor_user_id or context.user_id
        payload = dict(payload or {})
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
