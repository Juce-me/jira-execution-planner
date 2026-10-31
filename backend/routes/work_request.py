"""HTTP adapter that admits one work request for the work-reading routes (plan Task 4A).

Not a blueprint.  ``admit(...)`` returns ``(WorkRequest | None, error_response | None)``:
``None`` request keeps the unpromoted / flag-off Legacy path byte-identical, a Flask
response is the exact selector error (400 ``invalid_quarter`` / ``invalid_configuration_id``;
409 ``configuration_required``, ``sprint_catalog_mismatch``, ``configuration_incomplete``,
``configuration_scope_changed``, ``configuration_feature_disabled``;
503 ``sprint_catalog_pending`` / ``config_storage_unavailable``).
"""

from flask import jsonify
from werkzeug.datastructures import MultiDict
from sqlalchemy.exc import OperationalError

from backend.config.repository import ConfigStorageError
from backend.db.engine import DatabaseConfigurationError, session_scope
from backend.services import planning_work
from backend.services.workspace_dashboard_config import WorkspaceConfigFenceUnavailable
from . import get_jira_server
from . import work_structure_routes as work_routes

WorkConfigError = planning_work.WorkConfigError


def _sprint_admitter(auth_context):
    def admit_sprint(context, sprint_id):
        server = get_jira_server()
        with session_scope() as session:
            sources = server.resolve_request_catalog_sources(session, auth_context)
        if sources is None:
            raise WorkConfigError('sprint_catalog_mismatch')
        _config, row = work_routes.admit_sprint_source(
            auth_context, sources, sprint_id,
            configuration_id=context.configuration_id, quarter=context.quarter)
        return row
    return admit_sprint


def _resolve(args, auth_context, needed, sprint_id):
    return planning_work.resolve_work_request(
        args, auth_context, needed=needed, sprint_id=sprint_id,
        snapshot_loader=lambda: work_routes.workspace_snapshot(auth_context),
        db_oauth=work_routes.db_oauth_request(auth_context),
        sprint_admitter=_sprint_admitter(auth_context))


def admit(args, auth_context, *, sprint_id=None, needed=(), quarter_hint=None):
    """Resolve the viewed quarter for one request; see the module docstring for outcomes.

    ``quarter_hint`` is a quarter-name selector (stats address a period by its quarter name): it
    supplies the quarter only when a promoted workspace would otherwise answer ``configuration_required``.
    """
    try:
        try:
            request = _resolve(args, auth_context, needed, sprint_id)
        except WorkConfigError as error:
            if error.code != 'configuration_required' or not quarter_hint or args.getlist('quarter'):
                raise
            try:
                planning_work.ws.parse_quarter(quarter_hint)
            except WorkConfigError:
                raise error from None
            hinted = args.copy()
            hinted.add('quarter', quarter_hint)
            request = _resolve(hinted, auth_context, needed, sprint_id)
        return request, None
    except WorkConfigError as error:
        return None, work_routes.work_error_response(error)
    except work_routes.SprintCatalogPending:
        return None, (jsonify({'error': 'sprint_catalog_pending'}), 503)
    except (ConfigStorageError, DatabaseConfigurationError, WorkspaceConfigFenceUnavailable, OperationalError):
        return None, work_routes.storage_unavailable_response()



def resolve(args, auth_context, *, sprint_id=None, needed=()):
    """Raising variant of ``admit`` for callers that map selector failures themselves."""
    return _resolve(args, auth_context, needed, sprint_id)


def active_entries(auth_context):
    """Stored configuration entries while a promoted workspace serves work reads; None = Legacy flat path."""
    if not work_routes.db_oauth_request(auth_context):
        return None
    flag = work_routes.work_structure_service.work_configurations_enabled()
    snapshot = work_routes.workspace_snapshot(auth_context)
    state = work_routes.work_structure_service.work_configuration_state(snapshot.payload, flag_enabled=flag)
    if not (state.promoted and flag):
        return None
    return work_routes.work_structure_service.stored_bundle(snapshot.payload)['configurations']


def storage_guard(call):
    """Run ``call()``; map storage failures to ``(None, error_response)``."""
    try:
        return call(), None
    except WorkConfigError as error:
        return None, work_routes.work_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError, WorkspaceConfigFenceUnavailable, OperationalError):
        return None, work_routes.storage_unavailable_response()


def admit_quarter_range(auth_context, start_quarter, end_quarter):
    """Partition ``start_quarter..end_quarter`` at configuration boundaries.

    ``(None, None)`` keeps the Legacy flat path.  Otherwise ``(segments, None)`` with one entry per
    contiguous run of quarters served by the same stored configuration, in time order::

        {'startQuarter', 'endQuarter', 'configurationId', 'request': WorkRequest | None, 'error': code | None}

    A segment whose configuration is incomplete carries ``error`` and no request (an unavailable period,
    never zero work).  A quarter no configuration covers is ``configuration_required`` for the whole range.
    """
    service = work_routes.work_structure_service

    def build():
        entries = active_entries(auth_context)
        if entries is None:
            return None
        low, high = service.quarter_ordinal(start_quarter), service.quarter_ordinal(end_quarter)
        runs = []
        for ordinal in range(low, high + 1):
            entry = next((item for item in entries if service.entry_contains_quarter(item, ordinal)), None)
            if entry is None:
                raise WorkConfigError('configuration_required')
            label = f'{ordinal // 4:04d}Q{ordinal % 4 + 1}'
            if runs and runs[-1]['configurationId'] == entry['id']:
                runs[-1]['endQuarter'] = label
            else:
                runs.append({'startQuarter': label, 'endQuarter': label, 'configurationId': entry['id'],
                             'revision': entry['revision'], 'digest': service.entry_digest(entry)})
        for run in runs:
            selectors = MultiDict([('quarter', run['startQuarter']), ('configurationId', run['configurationId'])])
            try:
                run['request'], run['error'] = _resolve(selectors, auth_context, (), None), None
            except WorkConfigError as error:
                if error.code != 'configuration_incomplete':
                    raise
                run['request'], run['error'] = None, error.code
        return runs

    return storage_guard(build)
