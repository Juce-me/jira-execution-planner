"""Capacity API route registrations."""

from flask import Blueprint, jsonify, request

from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError
from backend.auth.scope_policy import missing_context_oauth_scopes
from backend.config.repository import ConfigStorageError
from backend.db.engine import DatabaseConfigurationError
from backend.services.capacity import (
    CapacityInputError,
    CapacityServiceError,
    CapacityUpstreamUnauthorized,
    update_capacity_issue,
)

from . import bind_server_globals


bp = Blueprint("capacity_routes", __name__)


_CAPACITY_SERVICE_STATUS = {
    'capacity_forbidden': 403,
    'capacity_issue_not_found': 404,
    'capacity_config_missing': 409,
    'capacity_config_unverified': 409,
    'capacity_config_conflict': 409,
    'capacity_issue_mismatch': 409,
    'capacity_conflict': 409,
    'capacity_field_not_editable': 409,
    'jira_capacity_update_conflict': 502,
    'jira_capacity_update_failed': 502,
}


def _capacity_service_error_response(error):
    code = error.code if error.code in _CAPACITY_SERVICE_STATUS else 'jira_capacity_update_failed'
    payload = {'error': code}
    if code == 'capacity_conflict':
        payload['currentCapacity'] = error.current_capacity
    return jsonify(payload), _CAPACITY_SERVICE_STATUS[code]


@bp.before_request
def _sync_server_globals():
    bind_server_globals(globals())


@bp.route('/api/capacity', methods=['GET'])
def get_capacity():
    sprint_name = request.args.get('sprint', '').strip()
    debug = request.args.get('debug', '').lower() in ('1', 'true', 'yes')
    team_param = request.args.get('teams', '').strip()
    team_names = [s.strip() for s in team_param.split(',') if s.strip()]
    if not sprint_name:
        return jsonify({'error': 'Sprint name is required'}), 400

    try:
        auth_context = current_request_auth_context()
        capacity_config = load_request_capacity_config(auth_context)
        if capacity_config.get('requiresResolution'):
            return jsonify({
                'error': 'capacity_config_conflict',
                'message': 'Capacity configuration requires resolution.',
            }), 409
        if not capacity_config.get('project'):
            return jsonify({
                'enabled': False,
                'capacities': {},
                'entries': [],
                'mutationEnabled': False,
            })
        payload, error_message = fetch_capacity_for_sprint(
            sprint_name,
            None,
            debug=debug,
            team_names=team_names,
            context=auth_context,
            capacity_config=capacity_config,
        )
        if error_message:
            return jsonify({
                'error': 'jira_capacity_fetch_failed',
                'message': 'Capacity could not be loaded from Jira.',
            }), 502
        return jsonify(payload)
    except CapacityUpstreamUnauthorized:
        if auth_context.auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
            auth_payload, status = oauth_auth_required_payload()
            return jsonify(auth_payload), status
        return jsonify({
            'error': 'jira_capacity_fetch_failed',
            'message': 'Capacity could not be loaded from Jira.',
        }), 502
    except AuthError as error:
        return auth_error_response(error, 401)
    except (ConfigStorageError, DatabaseConfigurationError):
        return jsonify({
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }), 503
    except Exception:
        logger.exception('Capacity endpoint error')
        return jsonify({
            'error': 'capacity_fetch_failed',
            'message': 'Capacity could not be loaded from Jira.',
        }), 500


@bp.route('/api/planned-capacity', methods=['GET'])
def get_planned_capacity():
    return get_capacity()


@bp.route('/api/capacity/<issue_key>', methods=['PATCH'])
def patch_capacity(issue_key):
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if set(payload) - {'sprintName', 'teamName', 'expectedCapacity', 'capacity'}:
        return jsonify({'error': 'unsupported_capacity_field'}), 400
    try:
        auth_context = current_request_auth_context()
        if missing_context_oauth_scopes(auth_context, {'write:jira-work'}):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')
        config = load_request_capacity_config(auth_context)
        if config.get('requiresResolution'):
            raise CapacityServiceError('capacity_config_conflict', 409)
        if not config.get('project') or not config.get('fieldId'):
            raise CapacityServiceError('capacity_config_missing', 409)
        if config.get('mutationEnabled') is not True:
            raise CapacityServiceError('capacity_config_unverified', 409)
        result = update_capacity_issue(
            issue_key,
            payload,
            capacity_project=config['project'],
            capacity_field_id=config['fieldId'],
            jira_request=current_jira_request,
            context=auth_context,
        )
    except AuthError as error:
        if error.code == 'auth_required':
            auth_payload, status = oauth_auth_required_payload()
            return jsonify(auth_payload), status
        return auth_error_response(error, 401)
    except CapacityInputError as error:
        return jsonify({'error': error.code}), 400
    except CapacityServiceError as error:
        return _capacity_service_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError):
        return jsonify({
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }), 503
    except Exception as error:
        logger.error('Capacity Jira update failed error_type=%s', type(error).__name__)
        return jsonify({'error': 'jira_capacity_update_failed'}), 502
    return jsonify(result)
