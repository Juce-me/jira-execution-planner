"""Tool-admin bootstrap helpers for DB-backed auth."""

from __future__ import annotations

import os

from sqlalchemy import func

from backend.auth.db_context import invalidate_auth_status_cache
from backend.db import models


def configured_tool_admin_account_ids(environ=None) -> set[str]:
    env = os.environ if environ is None else environ
    raw = env.get('TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS', '')
    return {account_id.strip() for account_id in raw.split(',') if account_id.strip()}


def workspace_tool_admin_count(session, workspace_id: str) -> int:
    return session.query(func.count(func.distinct(models.User.id))).join(
        models.AuthConnection,
        models.AuthConnection.user_id == models.User.id,
    ).filter(
        models.AuthConnection.workspace_id == workspace_id,
        models.User.account_type == 'admin',
        models.User.status != 'deleted',
    ).scalar() or 0


def bootstrap_first_tool_admin(
    session,
    *,
    workspace_id: str,
    user_id: str,
    atlassian_account_id: str,
    environ=None,
) -> bool:
    account_id = str(atlassian_account_id or '').strip()
    if account_id not in configured_tool_admin_account_ids(environ):
        return False
    if workspace_tool_admin_count(session, workspace_id) > 0:
        return False
    user = session.get(models.User, user_id)
    if user is None or user.external_provider != 'atlassian' or user.external_subject != account_id:
        return False
    user.account_type = 'admin'
    session.add(models.audit_event(
        workspace_id=workspace_id,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type='admin_bootstrap',
        metadata={'source': 'TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS'},
    ))
    session.flush()
    invalidate_auth_status_cache(user_id=user.id)
    return True
