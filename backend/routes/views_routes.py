"""Current-user saved view configuration routes."""

from flask import Blueprint, g, jsonify, request, session
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from backend.auth.csrf import validate_csrf_token
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError
from backend.config.db_repository import DbConfigRepository, ViewConfigNotFound, infer_view_type
from backend.config.shared_config import sanitize_private_view_payload, validate_private_view_ownership
from backend.config.view_validation import ViewPayloadValidationError, validate_user_view_payload
from backend.db import models
from backend.db.engine import DatabaseConfigurationError, session_scope
from backend.services.user_view_config import (
    UserViewConfigConflict,
    UserViewConfigNotFound,
    UserViewConfigStorageError,
    create_user_view,
    mutate_user_view,
)

from . import bind_server_globals


bp = Blueprint("views_routes", __name__)

VALID_VIEW_TYPES = {'eng', 'epm', 'mixed'}
UNSAFE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.before_request
def _require_token_bound_csrf():
    if request.method not in UNSAFE_METHODS:
        return None
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return None
    if getattr(g, 'security_csrf_validated', False):
        return None
    data = oauth_session_data()
    if validate_csrf_token(session, data, request.headers.get('X-CSRF-Token')):
        return None
    return jsonify({
        'error': 'csrf_required',
        'message': 'A valid CSRF token is required for this request.',
    }), 403


@bp.before_request
def _require_authenticated_user():
    try:
        g.auth_context = current_request_auth_context()
    except AuthError as error:
        return auth_error_response(error, 401)
    except DatabaseConfigurationError as error:
        return _storage_error_response(error)
    return None


def _storage_error_response(_error):
    return jsonify({
        'error': 'config_storage_unavailable',
        'message': 'Saved views require database-backed configuration storage.',
    }), 503


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace('+00:00', 'Z')


def _view_response(view, version_number=0):
    return {
        'id': view.id,
        'viewConfigId': view.id,
        'workspaceId': view.workspace_id,
        'name': view.name,
        'viewType': view.view_type,
        'view': sanitize_private_view_payload(view.payload),
        'isDefault': bool(view.is_default),
        'createdAt': _iso(view.created_at),
        'updatedAt': _iso(view.updated_at),
        'archivedAt': _iso(view.archived_at),
        'versionNumber': int(version_number or 0),
    }


def _active_user_view_statement(context):
    return select(models.ViewConfig).where(
        models.ViewConfig.workspace_id == context.workspace_id,
        models.ViewConfig.owner_user_id == context.user_id,
        models.ViewConfig.visibility == 'private',
        models.ViewConfig.archived_at.is_(None),
    )


def _next_version_number(session_obj, view_id):
    statement = select(func.max(models.ViewConfigVersion.version_number)).where(
        models.ViewConfigVersion.view_config_id == view_id,
    )
    return int(session_obj.execute(statement).scalar_one() or 0) + 1


def _extract_view_payload(raw):
    if not isinstance(raw, dict):
        raise ValueError('request body must be a JSON object')
    payload = raw.get('view')
    if payload is None:
        payload = raw.get('payload')
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ViewPayloadValidationError(['<root>'])
    validate_user_view_payload(payload)
    payload = validate_private_view_ownership(payload, validate_sensitive=False)
    view_type = str(raw.get('viewType') or infer_view_type(payload)).strip().lower()
    if view_type not in VALID_VIEW_TYPES:
        raise ValueError('viewType must be eng, epm, or mixed')
    name = str(raw.get('name') or 'Saved view').strip() or 'Saved view'
    return name[:255], view_type, payload


def _normalize_project_keys(values):
    keys = set()
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return keys
    for value in values:
        if isinstance(value, dict):
            value = value.get('key') or value.get('projectKey')
        key = str(value or '').strip().upper()
        if key:
            keys.add(key)
    return keys


def _jira_project_references(payload):
    references = set()
    if not isinstance(payload, dict):
        return references
    filters = payload.get('filters') or {}
    if isinstance(filters, dict):
        references.update(_normalize_project_keys(filters.get('projectKeys')))
    projects = payload.get('projects') or {}
    if isinstance(projects, dict):
        references.update(_normalize_project_keys(projects.get('selected')))
    return references


def _validate_jira_project_references(context, payload):
    referenced = _jira_project_references(payload)
    if not referenced:
        return None
    accessible = {
        str(project.project_key or '').strip().upper()
        for project in context.project_access
        if project.status == 'accessible'
    }
    missing = sorted(referenced - accessible)
    if missing:
        return jsonify({
            'error': 'project_access_denied',
            'message': 'Saved view references Jira projects outside the current user project-access snapshot.',
            'projectKeys': missing,
        }), 403
    return None


def _home_project_references(payload):
    references = set()
    epm = payload.get('epm') if isinstance(payload, dict) else {}
    projects = epm.get('projects') if isinstance(epm, dict) else {}
    if not isinstance(projects, dict):
        return references
    for key, row in projects.items():
        if not isinstance(row, dict):
            continue
        home_project_id = str(row.get('homeProjectId') or '').strip()
        if home_project_id:
            references.add(home_project_id)
    return references


def _home_project_catalog_ids(projects):
    ids = set()
    for project in projects or []:
        if not isinstance(project, dict):
            continue
        for key in ('homeProjectId', 'id'):
            value = str(project.get(key) or '').strip()
            if value:
                ids.add(value)
    return ids


def _validate_home_project_references(context, payload):
    referenced = _home_project_references(payload)
    if not referenced:
        return None
    epm = payload.get('epm') if isinstance(payload, dict) else {}
    scope = epm.get('scope') if isinstance(epm, dict) else {}
    projects = fetch_epm_home_projects(scope, context=context)
    missing = sorted(referenced - _home_project_catalog_ids(projects))
    if missing:
        return jsonify({
            'error': 'home_project_not_found',
            'message': 'Saved view references Home projects outside the workspace service-backed catalog.',
            'homeProjectIds': missing,
        }), 403
    return None


def _validate_view_references(context, payload):
    return (
        _validate_jira_project_references(context, payload)
        or _validate_home_project_references(context, payload)
    )


def _validation_error_response(error):
    payload = {'error': 'invalid_view_payload', 'message': str(error)}
    forbidden = getattr(error, 'forbidden_paths', None)
    if forbidden:
        payload['forbiddenPaths'] = list(forbidden)
    return jsonify(payload), 400


@bp.route('/api/me/views', methods=['GET'])
def api_me_views():
    context = g.auth_context
    try:
        with session_scope() as db_session:
            statement = _active_user_view_statement(context).order_by(
                models.ViewConfig.updated_at.desc(),
                models.ViewConfig.created_at.desc(),
            )
            views = db_session.execute(statement).scalars().all()
            return jsonify({'views': [
                _view_response(view, _next_version_number(db_session, view.id) - 1)
                for view in views
            ]})
    except (DatabaseConfigurationError, UserViewConfigStorageError, SQLAlchemyError) as error:
        return _storage_error_response(error)


@bp.route('/api/me/views', methods=['POST'])
def api_me_views_create():
    context = g.auth_context
    raw = request.get_json(silent=True) or {}
    try:
        name, view_type, payload = _extract_view_payload(raw)
    except (ValueError, ViewPayloadValidationError) as error:
        return _validation_error_response(error)
    invalid_response = _validate_view_references(context, payload)
    if invalid_response:
        return invalid_response

    try:
        result = create_user_view(
            context,
            name=name,
            view_type=view_type,
            payload=payload,
            is_default=bool(raw.get('isDefault')),
        )
        return jsonify({'view': result.as_view_dict()}), 201
    except (DatabaseConfigurationError, UserViewConfigStorageError) as error:
        return _storage_error_response(error)


@bp.route('/api/me/views/<view_id>', methods=['PATCH'])
def api_me_views_patch(view_id):
    context = g.auth_context
    raw = request.get_json(silent=True) or {}
    if not isinstance(raw, dict):
        return _validation_error_response(ValueError('request body must be a JSON object'))

    try:
        payload_changed = 'view' in raw or 'payload' in raw
        payload = None
        view_type = raw.get('viewType')
        if payload_changed:
            if 'baseVersion' not in raw:
                return _validation_error_response(ValueError('baseVersion is required for payload replacement'))
            try:
                _, view_type, payload = _extract_view_payload({
                    'viewType': view_type,
                    'view': raw.get('view') if 'view' in raw else raw.get('payload'),
                })
            except (ValueError, ViewPayloadValidationError) as error:
                return _validation_error_response(error)
            invalid_response = _validate_view_references(context, payload)
            if invalid_response:
                return invalid_response
        elif view_type is not None:
            view_type = str(view_type or '').strip().lower()
            if view_type not in VALID_VIEW_TYPES:
                return _validation_error_response(ValueError('viewType must be eng, epm, or mixed'))

        kwargs = {}
        if 'name' in raw:
            kwargs['name'] = raw.get('name')
        if view_type is not None:
            kwargs['view_type'] = view_type
        if payload_changed:
            kwargs['payload'] = payload
            kwargs['base_version'] = raw.get('baseVersion')
        if 'isDefault' in raw:
            kwargs['is_default'] = bool(raw.get('isDefault'))
        result = mutate_user_view(
            context,
            view_id,
            archive=raw.get('archive') is True or raw.get('archived') is True,
            **kwargs,
        )
        return jsonify({'view': result.as_view_dict()})
    except UserViewConfigConflict as error:
        return jsonify({
            'error': 'view_config_conflict',
            'message': 'Saved view changed while you were editing. Your changes are still unsaved.',
            'current': error.current.as_view_dict(),
        }), 409
    except UserViewConfigNotFound:
        return jsonify({'error': 'view_not_found'}), 404
    except (ValueError, ViewPayloadValidationError) as error:
        return _validation_error_response(error)
    except (DatabaseConfigurationError, UserViewConfigStorageError) as error:
        return _storage_error_response(error)


@bp.route('/api/me/views/default', methods=['GET'])
def api_me_views_default():
    context = g.auth_context
    try:
        return jsonify(DbConfigRepository().resolve_effective_view_config(context))
    except ViewConfigNotFound:
        return jsonify({'error': 'view_not_found'}), 404
    except (DatabaseConfigurationError, UserViewConfigStorageError, SQLAlchemyError) as error:
        return _storage_error_response(error)
