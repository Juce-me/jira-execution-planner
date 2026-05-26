"""Diagnostic API route registrations."""

from flask import Blueprint

from . import get_jira_server


bp = Blueprint("diagnostic_routes", __name__)


@bp.route('/api/test', methods=['GET'])
def test_connection():
    return get_jira_server().test_connection()
