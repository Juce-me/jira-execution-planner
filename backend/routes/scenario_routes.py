"""Scenario Planner legacy API route registrations."""

from flask import Blueprint, jsonify, request

from backend.auth.jira_auth import AuthError
from backend.db.engine import DatabaseConfigurationError

from . import get_jira_server


bp = Blueprint("scenario_routes", __name__)


@bp.before_request
def _require_scenario_access():
    """Non-admins get 403 ``scenario_locked`` until the workspace unlocks Scenario, before any Jira work."""
    server = get_jira_server()
    try:
        auth_context = server.scenario_draft_request_auth_context()
    except AuthError as auth_error:
        return server.auth_error_response(auth_error, 401)
    except DatabaseConfigurationError:
        return jsonify({'error': 'config_storage_unavailable',
                        'message': 'Configuration storage is temporarily unavailable.'}), 503
    return server.scenario_access_error(auth_context)


@bp.route('/api/scenario', methods=['GET', 'POST'])
def scenario_planner():
    return get_jira_server().scenario_planner()


@bp.route('/api/scenario/overrides', methods=['GET'])
def get_scenario_overrides():
    server = get_jira_server()
    selectors = server.scenario_selectors(request.args)
    if selectors:
        # Only a request naming a quarter/configuration is checked; a plain stored-scope read is unchanged.
        try:
            _work_request, error = server.scenario_work_gate(
                server.scenario_draft_request_auth_context(), selectors=selectors)
        except AuthError as auth_error:
            return server.auth_error_response(auth_error, 401)
        if error is not None:
            return error
    return server.get_scenario_overrides()


@bp.route('/api/scenario/overrides', methods=['POST'])
def post_scenario_overrides():
    return get_jira_server().post_scenario_overrides()
