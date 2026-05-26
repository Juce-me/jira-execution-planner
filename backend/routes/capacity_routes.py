"""Capacity API route registrations."""

from flask import Blueprint

from . import get_jira_server


bp = Blueprint("capacity_routes", __name__)


@bp.route('/api/capacity', methods=['GET'])
def get_capacity():
    return get_jira_server().get_capacity()


@bp.route('/api/planned-capacity', methods=['GET'])
def get_planned_capacity():
    return get_jira_server().get_planned_capacity()
