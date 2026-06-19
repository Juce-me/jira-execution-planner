"""Import and export helpers for user view configuration."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from sqlalchemy import func, select

from backend.auth.token_crypto import redact_token_material
from backend.config.db_repository import infer_view_type, strip_private_team_groups
from backend.config.view_validation import validate_user_view_payload
from backend.db import engine as db_engine
from backend.db import models
from backend.services import shared_group_config


@dataclass(frozen=True)
class ConfigImportResult:
    view_config_id: str
    imported: bool
    source_hash: str
    version_number: int


def _source_hash(source_path):
    with open(source_path, 'rb') as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def _load_json(source_path):
    with open(source_path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError('dashboard config must be a JSON object')
    return payload


def _next_version_number(session, view_config_id):
    statement = select(func.max(models.ViewConfigVersion.version_number)).where(
        models.ViewConfigVersion.view_config_id == view_config_id,
    )
    current = session.execute(statement).scalar_one()
    return int(current or 0) + 1


def _default_view(session, context):
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


def import_dashboard_config(*, database_url=None, context, source_path, actor_user_id=None):
    source_path = str(source_path)
    source_hash = _source_hash(source_path)
    source_payload = _load_json(source_path)
    team_groups = source_payload.get('teamGroups') if isinstance(source_payload.get('teamGroups'), dict) else None
    payload = strip_private_team_groups(source_payload)
    validate_user_view_payload(payload)
    actor_user_id = actor_user_id or context.user_id
    with db_engine.session_scope(database_url) as session:
        if team_groups is not None:
            shared_group_config.ensure_workspace_group_config(
                session,
                context,
                team_groups,
                validate_groups_config_fn=_validate_groups_config,
            )
        existing = session.execute(
            select(models.ViewConfig).where(
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.source_path == source_path,
                models.ViewConfig.source_hash == source_hash,
            )
        ).scalars().first()
        if existing is not None:
            version_number = session.execute(
                select(func.max(models.ViewConfigVersion.version_number)).where(
                    models.ViewConfigVersion.view_config_id == existing.id,
                )
            ).scalar_one()
            return ConfigImportResult(existing.id, False, source_hash, int(version_number or 0))

        view = _default_view(session, context)
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
                source_path=source_path,
                source_hash=source_hash,
            )
            session.add(view)
            session.flush()
        else:
            view.view_type = infer_view_type(payload)
            view.payload_version = int(payload.get('version') or view.payload_version or 1)
            view.payload = payload
            view.source_path = source_path
            view.source_hash = source_hash
        version_number = _next_version_number(session, view.id)
        session.add(models.ViewConfigVersion(
            view_config_id=view.id,
            version_number=version_number,
            payload=dict(payload),
            created_by=actor_user_id,
            change_note='legacy json import',
        ))
        session.flush()
        return ConfigImportResult(view.id, True, source_hash, version_number)


def _repo_root():
    return Path(__file__).resolve().parents[2]


def _is_inside(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def export_view_config_json(*, database_url=None, context, view_config_id, output_path, key_provider=None):
    del key_provider
    output_path = Path(output_path).resolve()
    if _is_inside(output_path, _repo_root()):
        raise ValueError('rollback exports must be written outside the repository')
    with db_engine.session_scope(database_url) as session:
        view = session.execute(
            select(models.ViewConfig).where(
                models.ViewConfig.id == view_config_id,
                models.ViewConfig.workspace_id == context.workspace_id,
                models.ViewConfig.owner_user_id == context.user_id,
                models.ViewConfig.archived_at.is_(None),
            )
        ).scalars().first()
        if view is None:
            raise ValueError('view config not found')
        payload = strip_private_team_groups(view.payload)
        shared_groups = shared_group_config.current_shared_groups_config(
            session,
            context,
            validate_groups_config_fn=_validate_groups_config,
        )
        payload['teamGroups'] = {
            'version': shared_groups.get('version') or 1,
            'groups': shared_groups.get('groups') or [],
            'defaultGroupId': shared_groups.get('defaultGroupId') or '',
        }
        payload = redact_token_material(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    return str(output_path)


def _validate_groups_config(payload, allow_empty=False):
    import jira_server

    return jira_server.validate_groups_config(payload, allow_empty=allow_empty)
