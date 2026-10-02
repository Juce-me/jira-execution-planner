"""ENG review APIs; shared authenticated user writes, never administrator config."""
import json
import logging

from flask import Blueprint, Response, request
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from backend.auth.jira_auth import AuthError
from backend.db.engine import DatabaseConfigurationError
from backend.routes import get_jira_server
from backend.services import sprint_review

bp = Blueprint('sprint_review_routes', __name__)
logger = logging.getLogger(__name__)


def _response(payload, status=200):
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > sprint_review.MAX_RESPONSE_BYTES:
        encoded = b'{"error":"review_response_limit","message":"Read fewer issues per batch."}'
        status = 413
    return Response(encoded, status=status, mimetype='application/json', headers={'Cache-Control': 'no-store'})


def _payload():
    request.max_content_length = sprint_review.MAX_REQUEST_BYTES
    payload = request.get_json()
    if not isinstance(payload, dict):
        raise sprint_review.ReviewError()
    return payload


def _run(operation):
    try:
        if request.args:
            raise sprint_review.ReviewError()
        context = get_jira_server().current_request_auth_context()
        return _response(operation(context))
    except sprint_review.ReviewError as error:
        payload = {'error': error.code, **error.details}
        if error.status == 409:
            payload['code'] = error.code
        return _response(payload, error.status)
    except AuthError as error:
        # The common 401 contract triggers terminal global sign-in recovery.
        server = get_jira_server()
        return server.auth_error_response(error, 401)
    except RequestEntityTooLarge:
        return _response({'error': 'review_request_limit'}, 413)
    except BadRequest:
        return _response({'error': 'invalid_review_request'}, 400)
    except (SQLAlchemyError, DatabaseConfigurationError):
        logger.error('Shared Sprint review storage unavailable')
        return _response({'error': 'review_storage_unavailable'}, 503)
    except Exception:
        logger.error('Shared Sprint review request unavailable')
        return _response({'error': 'review_unavailable'}, 503)


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['GET'])
def get_review(sprint_id):
    return _run(lambda context: sprint_review.load_review(context, sprint_id))


@bp.route('/api/eng/sprints/<sprint_id>/review/values/read', methods=['POST'])
def read_review_values(sprint_id):
    return _run(lambda context: sprint_review.read_values(context, sprint_id, _payload()))


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['PATCH'])
def patch_review(sprint_id):
    return _run(lambda context: sprint_review.save_review(context, sprint_id, _payload()))
