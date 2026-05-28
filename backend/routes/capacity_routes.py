"""Capacity API route registrations."""

from flask import Blueprint, jsonify, request

from backend.auth.jira_auth import AuthError

from . import bind_server_globals


bp = Blueprint("capacity_routes", __name__)


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

    if not get_effective_capacity_project():
        return jsonify({
            'enabled': False,
            'capacities': {}
        })

    try:
        payload, error_message = fetch_capacity_for_sprint(sprint_name, None, debug=debug, team_names=team_names)
        if error_message:
            return jsonify({'error': error_message}), 500
        return jsonify(payload)
    except AuthError:
        payload, status = oauth_auth_required_payload()
        return jsonify(payload), status
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/planned-capacity', methods=['GET'])
def get_planned_capacity():
    return get_capacity()
