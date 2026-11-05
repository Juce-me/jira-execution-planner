"""ENG review APIs; shared authenticated user writes, never administrator config."""
import json
import logging
import time

from flask import Blueprint, Response, request
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from backend.auth.jira_auth import AuthError
from backend.config.repository import ConfigStorageError
from backend.db import engine as db_engine
from backend.db.engine import DatabaseConfigurationError
from backend.routes import get_jira_server
from backend.routes import work_structure_routes as work_routes
from backend.services import assignee_capacity, sprint_review, work_write_scope

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


_STAMP_ARGS = work_write_scope.QUERY_STAMP_KEYS


def _namespace(context, raw_stamp, sprint_id, *, digest_required=True):
    """Review namespace kwargs from the re-resolved configuration stamp, before any DB or Jira work.

    ``{}`` for the unscoped path and for the Legacy model (NULL Legacy namespace, byte-identical
    behavior).  New-model requests carry the opaque configuration id, the viewed quarter's ordinal
    and the mapped type authority; the Sprint must be admitted by that configuration's own catalog.
    """
    scope = work_write_scope.resolve_scope(
        raw_stamp, db_request=work_routes.db_oauth_request(context),
        snapshot_loader=lambda: work_routes.workspace_snapshot(context), digest_required=digest_required)
    if scope is None or not scope.mapped:
        return {}
    type_map = scope.review_type_map()
    _admit_sprint(context, scope, sprint_id)
    year, quarter = work_routes.work_structure_service.parse_quarter(scope.quarter)
    return {'configuration_id': scope.configuration_id,
            'quarter_ordinal': sprint_review.quarter_ordinal_for(year, quarter), 'type_map': type_map}


def _admit_sprint(context, scope, sprint_id):
    server = get_jira_server()
    with db_engine.session_scope() as session:
        sources = server.resolve_request_catalog_sources(session, context)
    if sources is None:
        raise work_routes.WorkConfigError('configuration_required')
    work_routes.admit_sprint_source(context, sources, sprint_id,
                                    configuration_id=scope.configuration_id, quarter=scope.quarter)


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
    except work_routes.WorkConfigError as error:
        body, status = error.response()
        return respond({**body, 'code': error.code} if status == 409 else body, status)
    except work_routes.SprintCatalogPending:
        return respond({'error': 'sprint_catalog_pending'}, 503)
    except AuthError as error:
        # The common 401 contract triggers terminal global sign-in recovery.
        server = get_jira_server()
        return server.auth_error_response(error, 401)
    except RequestEntityTooLarge:
        return respond({'error': 'review_request_limit'}, 413)
    except BadRequest:
        return respond({'error': 'invalid_review_request'}, 400)
    except (SQLAlchemyError, DatabaseConfigurationError, ConfigStorageError):
        logger.error('Shared Sprint review storage unavailable')
        return respond({'error': 'review_storage_unavailable'}, 503)
    except Exception:
        logger.error('Shared Sprint review request unavailable')
        return respond({'error': 'review_unavailable'}, 503)


def _body_operation(sprint_id, service_call):
    def operation(context):
        payload = _payload()
        body = dict(payload)
        raw_stamp = body.pop('configuration', None) if 'configuration' in body else None
        if 'configuration' in payload and raw_stamp is None:
            raw_stamp = {}
        return service_call(context, sprint_id, body, _namespace(context, raw_stamp, sprint_id))
    return operation


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['GET'])
def get_review(sprint_id):
    def operation(context):
        namespace = _namespace(context, work_write_scope.stamp_from_args(request.args), sprint_id, digest_required=False)
        return sprint_review.load_review(
            context, sprint_id, request.args.get('groupId'),
            **{key: namespace[key] for key in ('configuration_id', 'quarter_ordinal') if key in namespace})
    return _run(operation, allowed_args=('groupId',) + _STAMP_ARGS)


@bp.route('/api/eng/sprints/<sprint_id>/review/values/read', methods=['POST'])
def read_review_values(sprint_id):
    return _run(_body_operation(sprint_id, lambda context, sprint, body, namespace: sprint_review.read_values(
        context, sprint, body, **{key: namespace[key] for key in ('configuration_id', 'type_map') if key in namespace})),
        require_capability=True)


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['PATCH'])
def patch_review(sprint_id):
    return _run(_body_operation(sprint_id, lambda context, sprint, body, namespace: sprint_review.save_review(
        context, sprint, body, **namespace)), require_capability=True)


CAPACITY_PATH = '/api/eng/sprints/<sprint_id>/assignee-capacity'


def _capacity_get(context, sprint_id):
    team_id = assignee_capacity.team_identity(request.args.get('teamId'))
    sprint_review.sprint_identity(sprint_id)
    caps = sprint_review.capabilities(context)
    if not caps['canRead']:
        return {'teamId': team_id, 'sprintId': sprint_id, 'revision': 0, 'rows': [], 'planned': None, 'inherited': None,
                'capabilities': caps}
    return {**assignee_capacity.get_document(context, sprint_id, team_id), 'capabilities': caps}


def _capacity_patch(context, sprint_id):
    payload = _payload(assignee_capacity.MAX_REQUEST_BYTES)
    if set(payload) - {'teamId', 'changes', 'planned'} or ('planned' in payload and payload['planned'] is None):
        raise sprint_review.ReviewError()
    team_id = assignee_capacity.team_identity(payload.get('teamId'))
    document = assignee_capacity.apply_changes(context, sprint_id, team_id, payload.get('changes'),
                                               planned=payload.get('planned'))
    return {**document, 'capabilities': sprint_review.capabilities(context)}


@bp.route(CAPACITY_PATH, methods=['GET'])
def get_assignee_capacity(sprint_id):
    return _run(lambda context: _capacity_get(context, sprint_id), allowed_args=('teamId',),
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-read')


@bp.route(CAPACITY_PATH, methods=['PATCH'])
def patch_assignee_capacity(sprint_id):
    return _run(lambda context: _capacity_patch(context, sprint_id), require_capability=True,
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-write')
