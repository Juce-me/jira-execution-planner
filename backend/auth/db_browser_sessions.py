from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete

from backend.auth.jira_auth import AuthError
from backend.db import models


@dataclass(frozen=True)
class BrowserSessionHandle:
    id: str
    user_id: str
    workspace_id: str
    auth_connection_id: str


def _handle(row: models.BrowserSession) -> BrowserSessionHandle:
    return BrowserSessionHandle(
        id=row.id,
        user_id=row.user_id,
        workspace_id=row.workspace_id,
        auth_connection_id=row.auth_connection_id,
    )


def create_browser_session(
    session,
    *,
    user_id: str,
    workspace_id: str,
    auth_connection_id: str,
) -> BrowserSessionHandle:
    connection = session.get(models.AuthConnection, auth_connection_id)
    if (
        connection is None
        or connection.user_id != user_id
        or connection.workspace_id != workspace_id
    ):
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    row = models.BrowserSession(
        id=str(uuid4()),
        user_id=user_id,
        workspace_id=workspace_id,
        auth_connection_id=auth_connection_id,
    )
    session.add(row)
    session.flush()
    return _handle(row)


def resolve_browser_session(session, browser_session_id: str) -> BrowserSessionHandle | None:
    value = str(browser_session_id or '').strip()
    if not value:
        return None
    row = session.get(models.BrowserSession, value)
    return _handle(row) if row is not None else None


def delete_browser_session(session, browser_session_id: str) -> int:
    value = str(browser_session_id or '').strip()
    if not value:
        return 0
    result = session.execute(delete(models.BrowserSession).where(models.BrowserSession.id == value))
    return int(result.rowcount or 0)


def delete_browser_sessions_for_connection(session, auth_connection_id: str) -> int:
    value = str(auth_connection_id or '').strip()
    if not value:
        return 0
    result = session.execute(
        delete(models.BrowserSession).where(models.BrowserSession.auth_connection_id == value)
    )
    return int(result.rowcount or 0)
