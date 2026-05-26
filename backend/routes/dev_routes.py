"""Local development diagnostic route registrations."""

from flask import Blueprint

from . import get_jira_server


bp = Blueprint("dev_routes", __name__)


@bp.route('/api/debug-fields', methods=['GET'])
def debug_fields():
    return get_jira_server().debug_fields()


@bp.route('/api/tasks-fields', methods=['GET'])
def get_tasks_fields():
    return get_jira_server().get_tasks_fields()
