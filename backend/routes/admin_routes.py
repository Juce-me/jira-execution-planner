"""Admin inspection route blueprint."""

from flask import Blueprint, g, jsonify, request

from backend.auth.db_context import invalidate_auth_status_cache
from backend.auth.jira_auth import AuthError
from backend.auth.service_integrations import (
    get_service_integration_summary,
    list_service_integration_summaries,
)
from backend.db import models
from backend.db.engine import session_scope

from . import bind_server_globals


bp = Blueprint("admin_routes", __name__)


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.before_request
def _require_admin():
    try:
        context = current_request_auth_context()
    except AuthError as error:
        return auth_error_response(error, 401)
    if not context.is_admin:
        payload, status = admin_required_payload()
        return jsonify(payload), status
    g.auth_context = context
    return None


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace('+00:00', 'Z')


def _connection_summary(connection):
    return {
        'id': connection.id,
        'provider': connection.provider,
        'siteUrl': connection.site_url,
        'cloudId': connection.cloud_id,
        'status': connection.status,
        'tokenVersion': int(connection.token_version or 0),
        'lastValidatedAt': _iso(connection.last_validated_at),
        'expiresAt': _iso(connection.expires_at),
        'createdAt': _iso(connection.created_at),
        'updatedAt': _iso(connection.updated_at),
    }


def _project_access_summary(access):
    return {
        'projectKey': access.project_key,
        'projectType': access.project_type,
        'status': access.status,
        'errorCode': access.error_code,
        'checkedAt': _iso(access.checked_at),
    }


def _user_summary(session, user, workspace_id):
    connections = session.query(models.AuthConnection).filter_by(
        user_id=user.id,
        workspace_id=workspace_id,
    ).order_by(models.AuthConnection.provider).all()
    project_access = []
    for connection in connections:
        project_access.extend(
            session.query(models.JiraProjectAccess)
            .filter_by(connection_id=connection.id, workspace_id=workspace_id)
            .order_by(models.JiraProjectAccess.project_key)
            .all()
        )
    return {
        'id': user.id,
        'externalProvider': user.external_provider,
        'externalSubject': user.external_subject,
        'email': user.email,
        'displayName': user.display_name,
        'accountType': user.account_type,
        'status': user.status,
        'createdBy': user.created_by,
        'createdAt': _iso(user.created_at),
        'updatedAt': _iso(user.updated_at),
        'lastSeenAt': _iso(user.last_seen_at),
        'authConnections': [_connection_summary(connection) for connection in connections],
        'projectAccess': [_project_access_summary(access) for access in project_access],
    }


def _workspace_users(session, workspace_id):
    rows = session.query(models.User).join(
        models.AuthConnection,
        models.AuthConnection.user_id == models.User.id,
    ).filter(
        models.AuthConnection.workspace_id == workspace_id,
    ).order_by(models.User.email, models.User.id).all()
    users = []
    seen = set()
    for user in rows:
        if user.id in seen:
            continue
        users.append(user)
        seen.add(user.id)
    return users


@bp.route('/api/admin/users', methods=['GET'])
def api_admin_users():
    context = g.auth_context
    with session_scope() as db_session:
        return jsonify({
            'users': [_user_summary(db_session, user, context.workspace_id) for user in _workspace_users(db_session, context.workspace_id)],
        })


@bp.route('/api/admin/users/<user_id>', methods=['GET'])
def api_admin_user(user_id):
    context = g.auth_context
    with session_scope() as db_session:
        user = db_session.get(models.User, user_id)
        if user is None:
            return jsonify({'error': 'user_not_found'}), 404
        if not db_session.query(models.AuthConnection).filter_by(user_id=user.id, workspace_id=context.workspace_id).first():
            return jsonify({'error': 'user_not_found'}), 404
        return jsonify({'user': _user_summary(db_session, user, context.workspace_id)})


@bp.route('/api/admin/audit-events', methods=['GET'])
def api_admin_audit_events():
    context = g.auth_context
    with session_scope() as db_session:
        events = db_session.query(models.AuditEvent).filter_by(
            workspace_id=context.workspace_id,
        ).order_by(models.AuditEvent.created_at.desc()).limit(100).all()
        return jsonify({
            'events': [{
                'id': event.id,
                'eventType': event.event_type,
                'actorUserId': event.actor_user_id,
                'targetUserId': event.target_user_id,
                'authConnectionId': event.auth_connection_id,
                'metadata': event.event_metadata or {},
                'createdAt': _iso(event.created_at),
            } for event in events],
        })


@bp.route('/api/admin/service-integrations', methods=['GET'])
def api_admin_service_integrations():
    context = g.auth_context
    with session_scope() as db_session:
        return jsonify({
            'serviceIntegrations': list_service_integration_summaries(db_session, context.workspace_id),
        })


@bp.route('/api/admin/service-integrations/<service_integration_id>', methods=['GET'])
def api_admin_service_integration(service_integration_id):
    context = g.auth_context
    with session_scope() as db_session:
        integration = db_session.get(models.ServiceIntegration, service_integration_id)
        if integration is None or integration.workspace_id != context.workspace_id:
            return jsonify({'error': 'service_integration_not_found'}), 404
        return jsonify({'serviceIntegration': get_service_integration_summary(db_session, integration.id)})


def _load_workspace_user(session, workspace_id, user_id):
    user = session.get(models.User, user_id)
    if user is None:
        return None
    if not session.query(models.AuthConnection).filter_by(user_id=user.id, workspace_id=workspace_id).first():
        return None
    return user


@bp.route('/api/admin/users/<user_id>/status', methods=['PATCH'])
def api_admin_user_status(user_id):
    context = g.auth_context
    status = str((request.get_json(silent=True) or {}).get('status') or '').strip()
    if status not in {'active', 'disabled'}:
        return jsonify({'error': 'invalid_user_status'}), 400
    with session_scope() as db_session:
        user = _load_workspace_user(db_session, context.workspace_id, user_id)
        if user is None:
            return jsonify({'error': 'user_not_found'}), 404
        user.status = status
        db_session.add(models.audit_event(
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            target_user_id=user.id,
            event_type='user_status_updated',
            metadata={'status': status},
        ))
        db_session.flush()
        invalidate_auth_status_cache(user_id=user.id)
        return jsonify({'user': _user_summary(db_session, user, context.workspace_id)})


@bp.route('/api/admin/users/<user_id>/admin-grant', methods=['POST'])
def api_admin_user_grant(user_id):
    context = g.auth_context
    with session_scope() as db_session:
        user = _load_workspace_user(db_session, context.workspace_id, user_id)
        if user is None:
            return jsonify({'error': 'user_not_found'}), 404
        user.account_type = 'admin'
        db_session.add(models.audit_event(
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            target_user_id=user.id,
            event_type='admin_granted',
            metadata={},
        ))
        db_session.flush()
        invalidate_auth_status_cache(user_id=user.id)
        return jsonify({'user': _user_summary(db_session, user, context.workspace_id)})


@bp.route('/api/admin/users/<user_id>/admin-grant', methods=['DELETE'])
def api_admin_user_revoke(user_id):
    context = g.auth_context
    with session_scope() as db_session:
        user = _load_workspace_user(db_session, context.workspace_id, user_id)
        if user is None:
            return jsonify({'error': 'user_not_found'}), 404
        user.account_type = 'user'
        db_session.add(models.audit_event(
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            target_user_id=user.id,
            event_type='admin_revoked',
            metadata={},
        ))
        db_session.flush()
        invalidate_auth_status_cache(user_id=user.id)
        return jsonify({'user': _user_summary(db_session, user, context.workspace_id)})
