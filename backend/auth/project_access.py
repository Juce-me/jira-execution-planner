"""Jira project-access gating helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from flask import jsonify

from backend.db import models


PROJECT_VIEW_TYPES = {'product', 'tech'}


def project_access_status(context, project_type: str) -> str:
    project_type = str(project_type or '').strip().lower()
    if project_type not in PROJECT_VIEW_TYPES:
        return 'accessible'
    if getattr(context, 'auth_mode', 'basic') == 'basic':
        return 'accessible'
    snapshots = [
        snapshot for snapshot in (getattr(context, 'project_access', ()) or ())
        if getattr(snapshot, 'project_type', '') == project_type
    ]
    if not snapshots:
        return 'unknown'
    if any(getattr(snapshot, 'status', '') == 'accessible' for snapshot in snapshots):
        return 'accessible'
    if any(getattr(snapshot, 'status', '') == 'unknown' for snapshot in snapshots):
        return 'unknown'
    return 'inaccessible'


def project_access_denied_response(context, project_type: str):
    status = project_access_status(context, project_type)
    if status == 'accessible':
        return None, None
    return jsonify({
        'error': 'missing_project_access',
        'message': 'Your Jira account does not have confirmed access to this project view.',
        'projectType': project_type,
        'projectAccessStatus': status,
        'recoveryUrl': '/auth/missing-project-access',
    }), 403


def upsert_project_access_snapshot(
    session,
    *,
    connection_id: str,
    workspace_id: str,
    project_key: str,
    project_type: str,
    status: str,
    error_code: str | None = None,
    checked_at=None,
):
    row = session.query(models.JiraProjectAccess).filter_by(
        connection_id=connection_id,
        workspace_id=workspace_id,
        project_key=project_key,
        project_type=project_type,
    ).first()
    if row is None:
        row = models.JiraProjectAccess(
            connection_id=connection_id,
            workspace_id=workspace_id,
            project_key=project_key,
            project_type=project_type,
        )
        session.add(row)
    row.status = status
    row.error_code = error_code
    row.checked_at = checked_at or datetime.now(timezone.utc)
    session.flush()
    return row


def home_3lo_gate_mode(probe_decision: dict) -> str:
    if (
        (probe_decision or {}).get('decision') == 'pass'
        and (probe_decision or {}).get('reason') == 'home_graphql_3lo_supported'
    ):
        return 'db_auth_boundary'
    return 'service_integration_scoped'
