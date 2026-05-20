"""Export API route registrations."""

from flask import Blueprint

from . import get_jira_server


bp = Blueprint("export_routes", __name__)


@bp.route('/api/export-excel', methods=['POST'])
def export_excel():
    return get_jira_server().export_excel()
