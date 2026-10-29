"""ENG review APIs; shared authenticated user writes, never administrator config."""
import json
import logging
import time

from flask import Blueprint, Response, request
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from backend.auth.jira_auth import AuthError
from backend.db.engine import DatabaseConfigurationError
from backend.routes import get_jira_server
from backend.services import assignee_capacity, sprint_review

bp = Blueprint('sprint_review_routes', __name__)
logger = logging.getLogger(__name__)


def _response(payload, status=200, limit=sprint_review.MAX_RESPONSE_BYTES, headers=None):
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > limit:
        encoded = b'{"error":"review_response_limit","message":"Read fewer issues per batch."}'
        status = 413
    return Response(encoded, status=status, mimetype='application/json', headers={'Cache-Control': 'no-store', **(headers or {})})


def _payload(limit=sprint_review.MAX_REQUEST_BYTES):
    request.max_content_length = limit
    payload = request.get_json()
    if not isinstance(payload, dict):
        raise sprint_review.ReviewError()
    return payload


def _run(operation, allowed_args=(), require_capability=False, response_limit=sprint_review.MAX_RESPONSE_BYTES, timing=None):
    """Query names are allowed per route; capability is checked before a body is parsed."""
    started = time.perf_counter()

    def respond(payload, status=200):
        headers = {'Server-Timing': f'{timing};dur={round((time.perf_counter() - started) * 1000, 1)}'} if timing else None
        return _response(payload, status, response_limit, headers)

    try:
        if set(request.args) - set(allowed_args) or any(len(request.args.getlist(name)) != 1 for name in request.args):
            raise sprint_review.ReviewError()
        context = get_jira_server().current_request_auth_context()
        if require_capability:
            sprint_review.require_review_context(context)
        return respond(operation(context))
    except sprint_review.ReviewError as error:
        payload = {'error': error.code, **error.details}
        if error.status == 409:
            payload['code'] = error.code
        return respond(payload, error.status)
    except AuthError as error:
        # The common 401 contract triggers terminal global sign-in recovery.
        server = get_jira_server()
        return server.auth_error_response(error, 401)
    except RequestEntityTooLarge:
        return respond({'error': 'review_request_limit'}, 413)
    except BadRequest:
        return respond({'error': 'invalid_review_request'}, 400)
    except (SQLAlchemyError, DatabaseConfigurationError):
        logger.error('Shared Sprint review storage unavailable')
        return respond({'error': 'review_storage_unavailable'}, 503)
    except Exception:
        logger.error('Shared Sprint review request unavailable')
        return respond({'error': 'review_unavailable'}, 503)


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['GET'])
def get_review(sprint_id):
    return _run(lambda context: sprint_review.load_review(context, sprint_id, request.args.get('groupId')),
                allowed_args=('groupId',))


@bp.route('/api/eng/sprints/<sprint_id>/review/values/read', methods=['POST'])
def read_review_values(sprint_id):
    return _run(lambda context: sprint_review.read_values(context, sprint_id, _payload()), require_capability=True)


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['PATCH'])
def patch_review(sprint_id):
    return _run(lambda context: sprint_review.save_review(context, sprint_id, _payload()), require_capability=True)


CAPACITY_PATH = '/api/eng/sprints/<sprint_id>/assignee-capacity'


def _capacity_get(context, sprint_id):
    team_id = assignee_capacity.team_identity(request.args.get('teamId'))
    sprint_review.sprint_identity(sprint_id)
    caps = sprint_review.capabilities(context)
    if not caps['canRead']:
        return {'teamId': team_id, 'sprintId': sprint_id, 'revision': 0, 'rows': [], 'inherited': None, 'capabilities': caps}
    return {**assignee_capacity.get_document(context, sprint_id, team_id), 'capabilities': caps}


def _capacity_patch(context, sprint_id):
    payload = _payload(assignee_capacity.MAX_REQUEST_BYTES)
    if set(payload) - {'teamId', 'changes'}:
        raise sprint_review.ReviewError()
    team_id = assignee_capacity.team_identity(payload.get('teamId'))
    document = assignee_capacity.apply_changes(context, sprint_id, team_id, payload.get('changes'))
    return {**document, 'capabilities': sprint_review.capabilities(context)}


@bp.route(CAPACITY_PATH, methods=['GET'])
def get_assignee_capacity(sprint_id):
    return _run(lambda context: _capacity_get(context, sprint_id), allowed_args=('teamId',),
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-read')


@bp.route(CAPACITY_PATH, methods=['PATCH'])
def patch_assignee_capacity(sprint_id):
    return _run(lambda context: _capacity_patch(context, sprint_id), require_capability=True,
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-write')
