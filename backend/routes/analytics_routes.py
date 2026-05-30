"""Analytics context API route."""

from flask import Blueprint, jsonify

from backend.analytics.config import AnalyticsConfigError, load_analytics_config
from backend.auth.jira_auth import AuthError

from . import get_jira_server


bp = Blueprint("analytics_routes", __name__)


def _auth_context_or_none():
    server = get_jira_server()
    try:
        return server.current_request_auth_context()
    except AuthError:
        return None


@bp.route("/api/analytics/context", methods=["GET"])
def analytics_context():
    try:
        config = load_analytics_config().validate_startup()
    except AnalyticsConfigError as error:
        response = jsonify({
            "error": "analytics_config_invalid",
            "message": str(error),
        })
        response.status_code = 500
        response.headers["Cache-Control"] = "no-store"
        return response

    response = jsonify(config.context_payload(_auth_context_or_none()))
    response.headers["Cache-Control"] = "no-store"
    return response
