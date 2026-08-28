"""Import and export helpers for user view configuration."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from sqlalchemy import select

from backend.auth.token_crypto import redact_token_material
from backend.config.db_repository import strip_private_team_groups
from backend.config.view_validation import validate_user_view_payload
from backend.config.shared_config import strip_shared_sections_from_private_view
from backend.db import engine as db_engine
from backend.db import models
from backend.services import shared_group_config
from backend.services import user_view_config


@dataclass(frozen=True)
class ConfigImportResult:
    view_config_id: str
    imported: bool
    source_hash: str
    version_number: int


def _load_source(source_path):
    with open(source_path, 'rb') as handle:
        source_bytes = handle.read()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    payload = json.loads(source_bytes.decode('utf-8'))
    if not isinstance(payload, dict):
        raise ValueError('dashboard config must be a JSON object')
    return source_hash, payload


def import_dashboard_config(
    *, database_url=None, context, source_path, actor_user_id=None,
    post_commit=None, _before_commit=None,
):
    del actor_user_id  # Import ownership and version authorship always come from request context.
    source_path = str(source_path)
    source_hash, source_payload = _load_source(source_path)
    team_groups = source_payload.get('teamGroups') if isinstance(source_payload.get('teamGroups'), dict) else None
    source_payload.pop('teamCatalog', None)
    payload = strip_shared_sections_from_private_view(strip_private_team_groups(source_payload))
    validate_user_view_payload(payload)
    result = user_view_config.save_imported_user_view(
        context,
        payload,
        source_path=source_path,
        source_hash=source_hash,
        shared_groups=team_groups,
        validate_groups_config_fn=_validate_groups_config,
        database_url=database_url,
        post_commit=post_commit,
        _before_commit=_before_commit,
    )
    return ConfigImportResult(
        result.view_config_id, result.mutation_applied, source_hash, result.version_number,
    )


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
