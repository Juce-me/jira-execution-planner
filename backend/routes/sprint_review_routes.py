"""ENG review APIs; shared authenticated user writes, never administrator config."""
from contextlib import ExitStack
from dataclasses import dataclass
import hashlib
import json
import logging
import time

from flask import Blueprint, Response, g, request
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge
from werkzeug.datastructures import MultiDict

from backend.auth.jira_auth import AuthError
from backend.config.repository import ConfigStorageError
from backend.db import engine as db_engine, models
from backend.db.engine import DatabaseConfigurationError
from backend.routes import get_jira_server
from backend.routes import work_structure_routes as work_routes
from backend.services import assignee_capacity, sprint_review, work_write_scope, planning_work, planning_scope, workspace_dashboard_config, workspace_catalog_cache

bp = Blueprint('sprint_review_routes', __name__)
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PreparedPlanningResponse:
    encoded: bytes


def _prepare_planning_response(payload):
    return PreparedPlanningResponse(sprint_review._encode_acknowledgement(payload))


def _response(payload, status=200, limit=sprint_review.MAX_RESPONSE_BYTES, headers=None):
    encoded = payload.encoded if isinstance(payload, PreparedPlanningResponse) else json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > limit:
        encoded = b'{"error":"review_response_limit","message":"Read fewer issues per batch."}'
        status = 413
    return Response(encoded, status=status, mimetype='application/json', headers={'Cache-Control': 'no-store', **(headers or {})})


def _payload(limit=sprint_review.MAX_REQUEST_BYTES):
    request.max_content_length = limit
    payload = request.get_json()
    if not isinstance(payload, dict):
        raise sprint_review.ReviewError()
    if request.method == 'PATCH':
        g._planning_v2_payload_parsed = payload.get('version') == 2
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
        if getattr(g, '_planning_v2_payload_parsed', False):
            payload.setdefault('noCommit', True)
        if error.status == 409:
            payload['code'] = error.code
        return respond(payload, error.status)
    except work_routes.WorkConfigError as error:
        body, status = error.response()
        if getattr(g, '_planning_v2_payload_parsed', False):
            body = {**body, 'noCommit': True}
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


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['GET'])
def get_review(sprint_id):
    def operation(context):
        namespace = _namespace(context, work_write_scope.stamp_from_args(request.args), sprint_id, digest_required=False)
        result = sprint_review.load_review(
            context, sprint_id, request.args.get('groupId'),
            **{key: namespace[key] for key in ('configuration_id', 'quarter_ordinal') if key in namespace})
        try:
            stamp = work_write_scope.stamp_from_args(request.args)
            admission = _planning_admission(context, sprint_id, {'groupId': request.args.get('groupId'),
                **({'configuration': stamp} if stamp is not None else {})}, digest_required=False)
            result.update(sprint_review.load_planning_metadata(context, sprint_id, request.args.get('groupId'), admission))
        except (sprint_review.ReviewError, work_routes.WorkConfigError, work_routes.SprintCatalogPending, ConfigStorageError, DatabaseConfigurationError, SQLAlchemyError):
            result.update(plan={'exists': False, 'revision': 0}, scopeProof=None,
                          planCapabilities={'canRead': False, 'canSave': False, 'reason': 'planning_admission_unavailable'})
        return result
    return _run(operation, allowed_args=('groupId',) + _STAMP_ARGS)


@bp.route('/api/eng/sprints/<sprint_id>/review/values/read', methods=['POST'])
def read_review_values(sprint_id):
    def operation(context):
        deadline = sprint_review.PlanningDeadline()
        payload = _payload()
        if payload.get('includePlan') is True:
            return sprint_review.read_values(context, sprint_id, payload,
                planning_admission=lambda: _planning_admission(context, sprint_id, payload), deadline=deadline)
        body, stamp = work_write_scope.split_body_stamp(payload)
        namespace = _namespace(context, stamp, sprint_id)
        return sprint_review.read_values(context, sprint_id, body,
            **{key: namespace[key] for key in ('configuration_id', 'type_map') if key in namespace})
    return _run(operation, require_capability=True)


@bp.route('/api/eng/sprints/<sprint_id>/review', methods=['PATCH'])
def patch_review(sprint_id):
    deadline = getattr(g, '_planning_request_deadline', None) or sprint_review.PlanningDeadline()
    def operation(context):
        payload = _payload()
        if payload.get('version') == 2:
            return sprint_review.save_review(context, sprint_id, payload,
                planning_admission=lambda: _planning_admission(context, sprint_id, payload, deadline=deadline),
                prepare_response=_prepare_planning_response, deadline=deadline)
        body, stamp = work_write_scope.split_body_stamp(payload)
        return sprint_review.save_review(context, sprint_id, body, **_namespace(context, stamp, sprint_id))
    return _run(operation, require_capability=True)


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


def _capacity_planned_read(context, sprint_id):
    payload = _payload(assignee_capacity.MAX_BATCH_REQUEST_BYTES)
    if set(payload) != {'teamIds'}:
        raise sprint_review.ReviewError()
    assignee_capacity.validate_batch(sprint_id, payload['teamIds'])
    caps = sprint_review.capabilities(context)
    if not caps['canRead']:
        return {'sprintId': sprint_id, 'teams': [], 'capabilities': caps}
    return assignee_capacity.read_planned_numbers(context, sprint_id, payload['teamIds'])


@bp.route(CAPACITY_PATH, methods=['GET'])
def get_assignee_capacity(sprint_id):
    return _run(lambda context: _capacity_get(context, sprint_id), allowed_args=('teamId',),
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-read')


@bp.route(CAPACITY_PATH, methods=['PATCH'])
def patch_assignee_capacity(sprint_id):
    return _run(lambda context: _capacity_patch(context, sprint_id), require_capability=True,
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-write')


@bp.route(CAPACITY_PATH + '/planned/read', methods=['POST'])
def read_assignee_capacity_planned(sprint_id):
    return _run(lambda context: _capacity_planned_read(context, sprint_id),
                response_limit=assignee_capacity.MAX_RESPONSE_BYTES, timing='assignee-capacity-planned-read')


def _planning_admission(context, sprint_id, payload, *, digest_required=True, deadline=None):
    """Capture the actual admitted source and current shared Department scope."""
    sprint_review.require_review_context(context)
    sprint_review.sprint_identity(sprint_id)
    group_id = sprint_review.group_identity(payload.get('groupId'))
    server = get_jira_server()
    raw_stamp = payload.get('configuration') if 'configuration' in payload else None
    deadline = deadline or sprint_review.PlanningDeadline()
    with ExitStack() as stack, db_engine.session_scope() as session:
        deadline.bind(session, stack)
        snapshot = workspace_dashboard_config.load_workspace_config_in_session(session, context)
        group_row = session.scalar(select(models.WorkspaceGroupConfig).where(
            models.WorkspaceGroupConfig.workspace_id == context.workspace_id))
        if group_row is None:
            raise sprint_review.ReviewError('review_group_unknown')
        group_payload, group_revision = dict(group_row.payload), group_row.config_revision
        group = next((g for g in group_payload.get('groups', []) if g.get('id') == group_id), None)
        if group is None:
            raise sprint_review.ReviewError('review_group_unknown')
        sources = server.resolve_request_catalog_sources(session, context)
        if sources is None:
            sources = [server.resolve_request_effective_catalog_config(session, context)]
        deadline.remaining()
        scope = work_write_scope.resolve_scope(raw_stamp, db_request=True, snapshot_loader=lambda: snapshot,
                                                digest_required=digest_required)
        selectors = {} if scope is None else {'configurationId': scope.configuration_id,
            'configurationRevision': str(scope.revision), 'quarter': scope.quarter}
        admitted, snapshots, consulted_sources = {}, {}, {}
        def read_snapshot(actor, config):
            consulted_sources[config.sprint_identity] = config
            if config.sprint_identity not in snapshots:
                load = workspace_catalog_cache.load_scoped_sprint_catalog if config.source_mode == work_routes.work_structure_service.SOURCE_MODE_SCOPED_ISSUES else workspace_catalog_cache.load_sprint_catalog
                snapshots[config.sprint_identity] = load(actor, config=config, session=session, budget=deadline)
            return snapshots[config.sprint_identity]
        def admit(work_context, identity):
            source, row = work_routes.admit_sprint_source(context, sources, identity,
                configuration_id=work_context.configuration_id, quarter=work_context.quarter, snapshot_loader=read_snapshot)
            admitted.update(source=source, row=row)
            return row
        work = planning_work.resolve_work_request(MultiDict(selectors), context, sprint_id=sprint_id,
            snapshot_loader=lambda: snapshot, db_oauth=True, sprint_admitter=admit)
        if work is None:
            source, row = work_routes.admit_sprint_source(context, sources, sprint_id, snapshot_loader=read_snapshot)
            admitted.update(source=source, row=row)
        source, sprint = admitted['source'], admitted['row']
        roles = work.roles if work else None
        if source.config_revision != snapshot.config_revision:
            raise sprint_review.ReviewError('configuration_scope_changed', 409, noCommit=True)
        # Existing bound discovery getters consume the same captured authoritative snapshot.
        g._workspace_dashboard_config_snapshot = snapshot
        try:
            compiled = planning_scope.compile_planning_inclusion_scope(
                {'base_jql': roles.base_jql(server.JQL_QUERY) if roles else server.build_base_jql(),
                 'team_jql_template': server.JQL_QUERY_TEMPLATE, 'issue_types': server.get_configured_issue_types()},
                group, {'id': sprint_id, 'name': sprint.get('name')}, work.context if work else None)
        except ValueError:
            raise sprint_review.ReviewError('planning_scope_unavailable', 503, noCommit=True) from None
        deadline.remaining()
        catalog = snapshots[source.sprint_identity]
        deadline.remaining()
        proof = workspace_catalog_cache.SprintSourceProof(source.sprint_identity, source.source_digest,
            catalog.catalog_version, sprint_id, str(sprint.get('name') or '').strip()) if source.source_mode == work_routes.work_structure_service.SOURCE_MODE_SCOPED_ISSUES else None
        if not any(str(item.get('id')) == sprint_id and item.get('name') == sprint.get('name') for item in catalog.payload or []):
            raise sprint_review.ReviewError('configuration_scope_changed', 409)
        if source.source_mode == work_routes.work_structure_service.SOURCE_MODE_SCOPED_ISSUES and (proof is None or proof.sprint_name != sprint.get('name')):
            raise sprint_review.ReviewError('configuration_scope_changed', 409)
        semantic = {'workspace': context.workspace_id, 'group': group_id, 'groupRevision': group_revision,
            'configuration': scope.digest if scope else {key: snapshot.payload.get(key)
                for key in work_routes.work_structure_service.MOVED_STRUCTURAL_KEYS},
            'source': [source.sprint_identity, source.source_mode, source.source_digest,
                       source.from_quarter, source.through_quarter],
            'sprint': [sprint_id, sprint.get('name')], 'compiled': compiled['scope_digest']}
        scope_proof = hashlib.sha256(json.dumps(semantic, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
        def revalidate(session):
            current = workspace_dashboard_config.load_workspace_config_in_session(session, context)
            if current != snapshot:
                raise sprint_review.ReviewError('configuration_scope_changed', 409, noCommit=True)
            # A Board row can shadow an observed Sprint by name. Recheck every Board
            # consulted during admission, including when the selected source is observed.
            for identity, consulted in consulted_sources.items():
                if consulted.source_mode == work_routes.work_structure_service.SOURCE_MODE_SCOPED_ISSUES:
                    continue
                row = session.scalar(select(models.WorkspaceSprintCatalog).where(
                    models.WorkspaceSprintCatalog.workspace_id == context.workspace_id,
                    models.WorkspaceSprintCatalog.board_id == consulted.board_id).execution_options(populate_existing=True))
                current_version = row.catalog_version if row is not None else None
                if str(current_version) != str(snapshots[identity].catalog_version):
                    raise sprint_review.ReviewError('configuration_scope_changed', 409, noCommit=True)
        quarter_ordinal = None
        if scope is not None and scope.mapped:
            year, quarter = work_routes.work_structure_service.parse_quarter(scope.quarter)
            quarter_ordinal = sprint_review.quarter_ordinal_for(year, quarter)
        return sprint_review.PlanningAdmission(scope_proof, compiled['candidate_jql'], compiled['child_kind'],
            scope.review_configuration_id if scope else None, quarter_ordinal,
            scope.review_type_map() if scope and scope.mapped else None, group_revision, group_payload, revalidate, proof, tuple(server.get_configured_issue_types()))


@bp.route('/api/eng/sprints/<sprint_id>/review/operations/<operation_id>', methods=['GET'])
def get_review_operation(sprint_id, operation_id):
    return _run(lambda context: sprint_review.load_save_operation(context, sprint_id,
        request.args.get('groupId'), operation_id, request.args.get('configurationId')),
        allowed_args=('groupId', 'configurationId'), require_capability=True)
