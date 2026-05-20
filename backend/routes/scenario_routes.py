"""Scenario Planner legacy API route registrations."""

from flask import Blueprint

from . import get_jira_server


bp = Blueprint("scenario_routes", __name__)


@bp.route('/api/scenario', methods=['GET', 'POST'])
def scenario_planner():
    return get_jira_server().scenario_planner()


@bp.route('/api/scenario/overrides', methods=['GET'])
def get_scenario_overrides():
    return get_jira_server().get_scenario_overrides()


@bp.route('/api/scenario/overrides', methods=['POST'])
def post_scenario_overrides():
    return get_jira_server().post_scenario_overrides()
