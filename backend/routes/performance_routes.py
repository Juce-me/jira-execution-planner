"""Debug observation ingestion and explicitly administrator-only inspection."""

import os
import hashlib
from functools import lru_cache
from pathlib import Path

from flask import Blueprint, jsonify, request
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import RequestEntityTooLarge

from backend.auth.jira_auth import AuthError
from backend.db.engine import DatabaseConfigurationError, session_scope
from backend.routes import get_jira_server
from backend.services.load_performance import collection_enabled, load_report, record_load
from backend.services.update_check import run_git_command


bp = Blueprint('performance_routes', __name__)
FRONTEND_BUNDLE = Path(__file__).resolve().parents[2] / 'frontend/dist/dashboard.js'


def _revision():
    configured = os.getenv('APP_REVISION', '').strip()
    if configured:
        return configured[:128]
    try:
        stat = FRONTEND_BUNDLE.stat()
        signature = (stat.st_mtime_ns, stat.st_size)
    except OSError:
        signature = None
    return _bundle_revision(FRONTEND_BUNDLE, signature)


@lru_cache(maxsize=1)
def _bundle_revision(bundle, signature):
    # Re-hash only a rebuilt served bundle; this runs after the measured load.
    value, _ = run_git_command(['describe', '--always', '--dirty'],
                               repo_dir=str(Path(__file__).resolve().parents[2]))
    fingerprint = 'unavailable'
    if signature is not None and signature[1] <= 32 * 1024 * 1024:
        try:
            fingerprint = hashlib.sha256(bundle.read_bytes()).hexdigest()[:12]
        except OSError:
            pass
    return f'{(value or "unknown")[:100]}-ui-{fingerprint}'


@bp.before_request
def _authenticate():
    server = get_jira_server()
    try:
        context = server.current_request_auth_context()
    except AuthError as error:
        return server.auth_error_response(error, 401)
    if request.path == '/api/admin/performance' and not context.is_admin:
        return jsonify({'error': 'admin_required'}), 403
    return None


@bp.get('/api/performance/context')
def performance_context():
    return jsonify({'enabled': collection_enabled()})


@bp.post('/api/performance/loads')
def performance_loads():
    if not collection_enabled():
        return jsonify({'error': 'performance_disabled'}), 404
    request.max_content_length = 16384
    try:
        request.get_data(cache=True)
    except RequestEntityTooLarge:
        return jsonify({'error': 'measurement_too_large'}), 413
    context = get_jira_server().current_request_auth_context()
    try:
        with session_scope() as db_session:
            created = record_load(db_session, context.workspace_id, request.get_json(silent=True),
                                  environment=os.getenv('APP_ENVIRONMENT_KEY', 'local'), revision=_revision())
        return jsonify({'recorded': created}), 201 if created else 200
    except ValueError:
        return jsonify({'error': 'invalid_measurement'}), 400
    except (SQLAlchemyError, DatabaseConfigurationError):
        return jsonify({'error': 'performance_storage_unavailable'}), 503


@bp.get('/api/admin/performance')
def admin_performance():
    if not os.getenv('DATABASE_URL', '').strip():
        return jsonify({'enabled': False, 'error': 'performance_storage_unavailable'}), 503
    context = get_jira_server().current_request_auth_context()
    try:
        if any(len(request.args.getlist(key)) != 1 for key in request.args):
            raise ValueError('Repeated filter')
        with session_scope() as db_session:
            report = load_report(db_session, context.workspace_id, request.args.to_dict(),
                                 environment=os.getenv('APP_ENVIRONMENT_KEY', 'local'))
        return jsonify({'enabled': collection_enabled(), **report})
    except ValueError:
        return jsonify({'error': 'invalid_performance_filters'}), 400
    except (SQLAlchemyError, DatabaseConfigurationError):
        return jsonify({'error': 'performance_storage_unavailable'}), 503
