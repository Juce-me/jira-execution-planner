"""Owned DB/OAuth browser server. Control uses stdin/stdout IPC, never HTTP.

The outer launcher imports only stdlib and isolation preparation. The fresh
child installs sitecustomize guards before importing any application module.
"""

import argparse
from contextlib import ExitStack, redirect_stdout
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[2]
NEW_SOURCES = (
    'frontend/src/eng/usePlanningAuthResumeRecovery.js',
    'frontend/src/eng/planningInclusionDraft.js',
    'frontend/src/eng/PlanningPopover.jsx',
    'frontend/src/eng/PlanningRowDetails.jsx',
    'frontend/src/eng/planningRowDetailsModel.js',
    'backend/services/planning_scope.py',
    'backend/services/planning_inclusion.py',
    'backend/db/migrations/versions/20261102_0023_shared_sprint_plans.py',
    'backend/db/migrations/versions/20261106_0024_browser_csrf_tokens.py',
    'backend/auth/csrf_store.py',
    'backend/auth/runtime_profile.py', 'tests/db_oauth_test_helpers.py',
    'tests/fixtures/db_oauth_server.py', 'tests/test_db_oauth_test_helpers.py',
    'tests/ui/db_oauth_fixture.js', 'tests/ui/db_oauth_lifecycle.spec.js',
    'tests/fixtures/planning_shared_plan_server.py',
    'tests/ui/planning_shared_plan_fixture.js', 'tests/ui/planning_shared_plan.spec.js',
    'tests/ui/planning_shared_plan_http.spec.js',
)
PHASE = 'launcher'
PHASE_STARTED = time.monotonic()


def phase(name):
    global PHASE, PHASE_STARTED
    now = time.monotonic()
    print(f'Synthetic fixture timing: {PHASE}={round((now - PHASE_STARTED) * 1000)}ms', file=sys.stderr, flush=True)
    PHASE, PHASE_STARTED = name, now
    print('Synthetic fixture phase: ' + name, file=sys.stderr, flush=True)


def launch(database_url=None, *, mode='app', historical=False, force_startup_failure=False):
    sys.path.insert(0, str(ROOT))
    from tests.postgres_cluster import owned_cluster
    from tests.run_isolated_runtime_tests import prepare_snapshot, synthetic_environment
    scratch = ROOT / 'tmp'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='db-oauth-browser-', dir=scratch) as directory, ExitStack() as stack:
        phase('snapshot-prepare')
        snapshot = prepare_snapshot(ROOT, Path(directory) / 'checkout', include_new=NEW_SOURCES)
        phase('postgres-cluster')
        import signal as signals

        def interrupt(_signal, _frame):
            raise KeyboardInterrupt

        # SIGTERM during provisioning still unwinds the stack and stops the cluster.
        stack.callback(signals.signal, signals.SIGTERM, signals.signal(signals.SIGTERM, interrupt))
        # The cluster stops before the snapshot directory is removed (ExitStack exits first).
        cluster = stack.enter_context(owned_cluster(snapshot / 'tmp/isolated-runtime/postgres'))
        phase('synthetic-environment')
        env = synthetic_environment(snapshot, cluster=cluster)
        if mode == 'measurement':
            env['ALLOW_DEV_DIAGNOSTIC_ENDPOINTS'] = 'true'
        if force_startup_failure:
            if mode != 'campaign':
                raise ValueError('Startup failure belongs to the campaign fixture.')
            env['BOARD_FIXTURE_STARTUP_FAILURE'] = '1'
        if historical:
            if mode != 'campaign':
                raise ValueError('Historical source belongs to the campaign fixture.')
            baseline = snapshot / 'tmp/board-190/baseline-source'
            for relative in ('backend/services/eng_board.py', 'backend/services/eng_board_stream.py',
                             'backend/routes/eng_board_routes.py'):
                source = subprocess.run(['git', '-C', str(ROOT), 'show',
                    '40bffe730159ebadb1904b0188981c853fdf85ed:' + relative],
                    env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'},
                    capture_output=True, check=True).stdout
                if relative == 'backend/routes/eng_board_routes.py':
                    # Historical comparison only: the DB adapter never invokes
                    # this now-retired Basic helper. Keep algorithms untouched.
                    old_import = b'from backend.services import eng_board, eng_board_basic, shared_group_config, workspace_dashboard_config'
                    if source.count(old_import) != 1:
                        raise ValueError('Historical route import contract changed.')
                    source = source.replace(old_import,
                        b'from backend.services import eng_board, shared_group_config, workspace_dashboard_config')
                target = baseline / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source)
            env['BOARD_BASELINE_ROOT'] = str(baseline)
        # Never connect to a supplied operator/application DB; only the owned cluster.
        # Task1 can extend the explicit approved disposable-schema interface.
        if database_url and database_url != env['DATABASE_URL']:
            raise ValueError('Browser fixture requires its own disposable database.')
        lifecycle = {'port': 0, 'restart': None}

        def start_child():
            return subprocess.Popen(
                [sys.executable, '-s', 'tests/fixtures/db_oauth_server.py', '--serve',
                 '--port', str(lifecycle['port']), '--mode', mode],
                cwd=snapshot, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                start_new_session=True,
            )

        phase('child-start')
        child = start_child()
        phase('awaiting-ready')
        import signal

        def terminate_launcher(_signal, _frame):
            raise KeyboardInterrupt

        previous = signal.signal(signal.SIGTERM, terminate_launcher)

        def signal_owned_group(value):
            import os
            try:
                os.killpg(child.pid, value)
            except ProcessLookupError:
                pass

        def forward_controls():
            try:
                for line in sys.stdin:
                    message = json.loads(line)
                    if message.get('command') == 'restart':
                        lifecycle['restart'] = message['id']
                        line = json.dumps({'id': '_restart_stop', 'command': 'stop'}) + '\n'
                    child.stdin.write(line.encode())
                    child.stdin.flush()
                    if message.get('command') == 'stop':
                        break
            except (BrokenPipeError, ValueError):
                pass
            finally:
                child.stdin.close()

        threading.Thread(target=forward_controls, daemon=True).start()
        try:
            while True:
                for line in child.stdout:
                    message = json.loads(line)
                    if message.get('ready'):
                        phase('ready-forwarded')
                        from urllib.parse import urlsplit
                        lifecycle['port'] = urlsplit(message['baseUrl']).port
                        if lifecycle['restart'] is not None:
                            message = {'id': lifecycle['restart'], 'ok': True, 'restarted': True}
                            lifecycle['restart'] = None
                    if message.get('id') != '_restart_stop':
                        print(json.dumps(message), flush=True)
                child.wait()
                if lifecycle['restart'] is None or child.returncode:
                    break
                child = start_child()
        finally:
            signal.signal(signal.SIGTERM, previous)
            if child.poll() is None:
                signal_owned_group(signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                signal_owned_group(signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    signal_owned_group(signal.SIGKILL)
                    child.wait()
        return child.returncode


def serve_named_mode(mode):
    """Execute only the two reviewed protocol specimens from their test source.

    These modes remain mocked protocol/campaign checks, separate from the real
    application/cookie acceptance fixture. There is no arbitrary-code interface.
    """
    phase('named-' + mode)
    import os
    if os.environ.get('JEP_ISOLATED_RUNTIME') != '1' or 'sitecustomize' not in sys.modules:
        raise RuntimeError('Named fixture requires pre-import isolation guards.')
    from tests.run_isolated_runtime_tests import register_fixture_endpoint
    if mode == 'campaign':
        from backend.db import engine as db_engine, models
        models.Base.metadata.create_all(db_engine.get_engine())
        source = (ROOT / 'tests/ui/eng_board_progressive_loading.spec.js').read_text()
        program = source.split('const campaignServer = String.raw`', 1)[1].split('`;', 1)[0]
        scope = {'__name__': '__main__', 'register_fixture_endpoint': register_fixture_endpoint,
                 'FIXTURE_ROOT': ROOT}
    else:
        import socket
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        port = listener.getsockname()[1]
        register_fixture_endpoint(ROOT, '127.0.0.1', port)
        register_fixture_endpoint(ROOT, 'localhost', port)
        source = (ROOT / 'tests/ui/eng_board_stream.spec.js').read_text()
        program = source.split('function prototypeSource() { return String.raw`', 1)[1].split('`; }', 1)[0]
        scope = {'__name__': '__main__', 'FIXTURE_LISTENER': listener, 'FIXTURE_PORT': port}
    exec(compile(program, '<owned-' + mode + '-fixture>', 'exec'), scope)


def serve(port=0, *, mode='app'):
    # sitecustomize is mandatory even when somebody invokes --serve directly.
    phase('preimport-guards')
    import os
    if os.environ.get('JEP_ISOLATED_RUNTIME') != '1' or 'sitecustomize' not in sys.modules:
        raise RuntimeError('Browser server requires pre-import isolation guards.')
    from datetime import datetime, timedelta, timezone
    from copy import deepcopy
    from urllib.parse import urlsplit
    from unittest.mock import patch
    from alembic import command
    from alembic.config import Config
    from werkzeug.serving import make_server, WSGIRequestHandler
    from backend.db import engine as db_engine, models
    from tests.db_oauth_test_helpers import DbActor, FULL_OAUTH_SCOPE, seed_db_actor
    from backend.auth.key_provider import key_provider_from_env
    from tests.run_isolated_runtime_tests import register_fixture_endpoint

    # Bind first, register the actual listener, then configure redirect and origins
    # before app import. No port reservation/release race and never port 5050.
    class QuietHandler(WSGIRequestHandler):
        def log(self, *args, **kwargs):
            pass  # OAuth callback query strings must never enter fixture logs.

    phase('owned-loopback-bind')
    if port == 5050:
        raise ValueError('The fixture never binds the live application port.')
    server = make_server('127.0.0.1', port, lambda environ, start_response: [],
                         threaded=True, request_handler=QuietHandler)
    port = server.server_port
    register_fixture_endpoint(ROOT, '127.0.0.1', port)
    register_fixture_endpoint(ROOT, 'localhost', port)
    base_url = f'http://localhost:{port}'
    os.environ['ATLASSIAN_REDIRECT_URI'] = base_url + '/api/auth/atlassian/callback'
    os.environ['APP_ALLOWED_ORIGINS'] = base_url
    phase('owned-db-migrations')
    config = Config(str(ROOT / 'backend/db/alembic.ini'))
    command.upgrade(config, 'head')
    factory = db_engine.session_factory()
    workspace = {'cloud_id': 'synthetic-cloud', 'site_url': 'https://example.atlassian.net',
                 'environment_key': 'local'}
    actors = {}
    phase('synthetic-actors')
    with factory() as db:
        for identity in ('actor-a', 'actor-b'):
            user = db.query(models.User).filter_by(external_subject=identity).one_or_none()
            if user is None:
                actors[identity] = seed_db_actor(db, workspace=workspace, account_identity=identity)
            else:
                connection = db.query(models.AuthConnection).filter_by(user_id=user.id).one()
                browser = db.query(models.BrowserSession).filter_by(user_id=user.id).first()
                actors[identity] = DbActor(user.id, connection.workspace_id, connection.id,
                                          browser.id if browser else '', key_provider_from_env())
        db.commit()

    phase('application-import')
    import jira_server
    state = {'actor': 'actor-a', 'refreshFailure': False, 'refreshCount': 0}
    storage_failure = None
    quarterly_restore = None

    def token_data(*args, **kwargs):
        actor = state['actor']
        return {'access_token': 'synthetic-access-' + actor,
                'refresh_token': 'synthetic-refresh-' + actor,
                'expires_in': 3600, 'scope': FULL_OAUTH_SCOPE}

    def profile(*args, **kwargs):
        return {'account_id': state['actor'], 'account_status': 'active',
                'display_name': 'Synthetic ' + state['actor']}

    class Response:
        def __init__(self, payload, status=200):
            self.status_code = status
            self._payload = payload
            self.headers = {}
            self.text = json.dumps(payload)
            self.content = self.text.encode()
            self.ok = status < 400

        def json(self):
            return self._payload

        def raise_for_status(self):
            if not self.ok:
                import requests
                raise requests.HTTPError('Synthetic provider rejection', response=self)

    planning = None
    if mode == 'planning':
        # Fixed extension loaded only after pre-import guards, migrated owned DB,
        # real encrypted actors and app import. Auth/lifecycle stay in this owner.
        from tests.fixtures.planning_shared_plan_server import PlanningFixture
        planning = PlanningFixture(factory=factory, actors=actors, server=jira_server, response_class=Response)

    def provider_post(url, **kwargs):
        if planning is not None and url != 'https://auth.atlassian.com/oauth/token':
            return planning.provider('POST', url, **kwargs)
        if url != 'https://auth.atlassian.com/oauth/token':
            raise AssertionError('Unregistered external provider POST.')
        state['refreshCount'] += 1
        if state['refreshFailure']:
            return Response({'error': 'invalid_grant'}, 400)
        refresh_token = (kwargs.get('json') or {}).get('refresh_token', '')
        if not refresh_token.startswith('synthetic-refresh-'):
            raise AssertionError('Only synthetic provider refresh tokens are accepted.')
        actor = refresh_token.removeprefix('synthetic-refresh-')
        if actor not in actors:
            raise AssertionError('Unknown synthetic provider actor.')
        return Response({'access_token': 'synthetic-access-' + actor,
                         'refresh_token': 'synthetic-refresh-' + actor,
                         'expires_in': 3600, 'scope': FULL_OAUTH_SCOPE})

    def provider_get(url, **kwargs):
        if planning is not None:
            return planning.provider('GET', url, **kwargs)
        # Only actual external Jira requests are stubbed. Unexpected endpoints
        # fail rather than substituting application HTTP/identity responses.
        path = urlsplit(url).path
        if '/rest/api/' not in path and '/rest/agile/' not in path:
            raise AssertionError('Unregistered external provider GET.')
        if path.endswith('/myself'):
            return Response({'accountId': state['actor'], 'displayName': 'Synthetic user'})
        if path.endswith('/issuetype'):
            return Response([
                {'id': '10000', 'name': 'Epic', 'hierarchyLevel': 1, 'subtask': False},
                {'id': '10001', 'name': 'Initiative', 'hierarchyLevel': 2, 'subtask': False},
                {'id': '10002', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False},
            ])
        if path.endswith('/components') and path.split('/')[-2] in {'SYN', 'NEXT'}:
            project = path.split('/')[-2]
            return Response([{'id': 'component-' + project, 'name': 'Synthetic ' + project}])
        return Response({'values': [], 'issues': [], 'isLast': True, 'total': 0})

    patches = [
        patch.object(jira_server, 'exchange_authorization_code', side_effect=token_data),
        patch.object(jira_server, 'fetch_current_user', side_effect=profile),
        patch.object(jira_server, 'fetch_accessible_resources', return_value=[{
            'id': workspace['cloud_id'], 'url': workspace['site_url'], 'name': 'Synthetic workspace',
        }]),
        patch.object(jira_server.HTTP_SESSION, 'post', side_effect=provider_post),
        patch.object(jira_server.HTTP_SESSION, 'get', side_effect=provider_get),
    ]
    if planning is not None:
        patches.append(patch.object(jira_server.HTTP_SESSION, 'request', side_effect=planning.provider))
        planning.install_save_controls()
    for item in patches:
        item.start()
    phase('serving-validation')
    app = jira_server.create_serving_app()
    server.app = app
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def actor_payload(actor):
        seeded = actors[actor]
        with factory() as db:
            sessions = db.query(models.BrowserSession).filter_by(user_id=seeded.user_id).all()
            connection = db.get(models.AuthConnection, seeded.connection_id)
            return {'userId': seeded.user_id, 'workspaceId': seeded.workspace_id,
                    'sessionIds': [row.id for row in sessions],
                    'tokenVersion': connection.token_version, 'refreshCount': state['refreshCount']}

    def emit(value):
        sys.__stdout__.write(json.dumps(value) + '\n')
        sys.__stdout__.flush()

    def auth_storage(db):
        # Compare exact auth/private rows, including history, only in memory.
        # Deep-copy JSON so later mutation cannot change the saved baseline.
        return tuple(tuple(tuple(deepcopy(getattr(row, column.name)) for column in model.__table__.columns)
                           for row in db.query(model).order_by(model.id).all())
                     for model in (models.AuthToken, models.BrowserSession,
                                   models.ViewConfig, models.ViewConfigVersion))

    phase('serving-ready')
    emit({'ready': True, 'baseUrl': base_url, 'baseURL': base_url})
    try:
        for line in sys.stdin:
            message = json.loads(line)
            operation = message.get('command')
            try:
                quarterly = None
                planning_result = None
                actor = message.get('actor', 'actor-a')
                if actor not in actors:
                    raise ValueError('Unknown synthetic actor.')
                if operation == 'selectActor':
                    state['actor'] = actor
                elif operation == 'expireSession':
                    with factory() as db:
                        row = db.get(models.BrowserSession, message['sessionId'])
                        if row is None or row.user_id != actors[actor].user_id:
                            raise ValueError('Session is not owned by the selected actor.')
                        db.delete(row)
                        db.commit()
                elif operation == 'expireToken':
                    with factory() as db:
                        connection = db.get(models.AuthConnection, actors[actor].connection_id)
                        connection.expires_at = datetime.now(timezone.utc) - timedelta(seconds=60)
                        db.commit()
                elif operation == 'providerRefreshFailure':
                    state['refreshFailure'] = message.get('enabled', True)
                elif operation in {'userStatus', 'connectionStatus'}:
                    allowed = {'active', 'disabled'} if operation == 'userStatus' else {'active', 'revoked'}
                    if message.get('status') not in allowed:
                        raise ValueError('Invalid synthetic status.')
                    with factory() as db:
                        target = (db.get(models.User, actors[actor].user_id) if operation == 'userStatus'
                                  else db.get(models.AuthConnection, actors[actor].connection_id))
                        target.status = message['status']
                        db.commit()
                elif operation == 'storageFailure':
                    if message.get('enabled', True) and storage_failure is None:
                        storage_failure = patch.object(db_engine, 'session_factory', side_effect=
                            db_engine.DatabaseConfigurationError('Synthetic fixture storage unavailable.'))
                        storage_failure.start()
                    elif not message.get('enabled', True) and storage_failure is not None:
                        storage_failure.stop()
                        storage_failure = None
                elif operation == 'dashboardConfig':
                    with factory() as db:
                        row = db.query(models.WorkspaceDashboardConfig).filter_by(
                            workspace_id=actors[actor].workspace_id).one_or_none()
                        if message.get('enabled', True):
                            if row is None:
                                db.add(models.WorkspaceDashboardConfig(workspace_id=actors[actor].workspace_id,
                                    payload={'version': 1, 'projects': {'selected': ['SYN']},
                                             'board': {'boardId': '701', 'boardName': 'Synthetic board'}}))
                        elif row is not None:
                            db.delete(row)
                        db.commit()
                elif operation == 'quarterlyConfiguration':
                    action = message.get('action')
                    with factory() as db:
                        row = db.query(models.WorkspaceDashboardConfig).filter_by(
                            workspace_id=actors['actor-a'].workspace_id).one_or_none()
                        editor = db.get(models.User, actors['actor-a'].user_id)
                        if action == 'begin' and quarterly_restore is None:
                            quarterly_restore = {
                                'payload': deepcopy(row.payload) if row else None,
                                'revision': row.config_revision if row else None,
                                'role': editor.account_type,
                                'flag': os.environ.get('WORK_CONFIGURATIONS_ENABLED'),
                                'auth': auth_storage(db),
                            }
                            payload = {'version': 1, 'projects': {'selected': ['SYN']},
                                       'board': {'boardId': '701', 'boardName': 'Synthetic board'}}
                            if row is None:
                                row = models.WorkspaceDashboardConfig(workspace_id=actors['actor-a'].workspace_id)
                                db.add(row)
                            row.payload, row.config_revision = payload, 0
                            # Actual tool-admin grant for the HTTP promotion; actor-b stays a member.
                            editor.account_type = 'admin'
                            os.environ['WORK_CONFIGURATIONS_ENABLED'] = 'true'
                        elif action in {'enable', 'disable'} and quarterly_restore is not None:
                            os.environ['WORK_CONFIGURATIONS_ENABLED'] = 'true' if action == 'enable' else 'false'
                        elif action == 'restore' and quarterly_restore is not None:
                            quarterly = {'authStorageUnchanged': auth_storage(db) == quarterly_restore['auth']}
                            if quarterly_restore['payload'] is None:
                                if row is not None:
                                    db.delete(row)
                            else:
                                row.payload = quarterly_restore['payload']
                                row.config_revision = quarterly_restore['revision']
                            editor.account_type = quarterly_restore['role']
                            if quarterly_restore['flag'] is None:
                                os.environ.pop('WORK_CONFIGURATIONS_ENABLED', None)
                            else:
                                os.environ['WORK_CONFIGURATIONS_ENABLED'] = quarterly_restore['flag']
                            quarterly_restore = None
                        else:
                            raise ValueError('Invalid quarterly fixture transition.')
                        db.commit()
                elif planning is not None and operation.startswith('planning'):
                    planning_result = planning.control(message)
                elif operation not in {'inspect', 'stop'}:
                    raise ValueError('Unknown fixture command.')
                emit({'id': message.get('id'), 'ok': True, 'actor': actor_payload(actor),
                      'quarterly': quarterly, **({'planning': planning_result} if planning is not None else {})})
                if operation == 'stop':
                    break
            except (ValueError, KeyError):
                emit({'id': message.get('id'), 'ok': False, 'error': 'invalid_fixture_control'})
    finally:
        if planning is not None:
            planning.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        for item in reversed(patches):
            item.stop()
        if storage_failure is not None:
            storage_failure.stop()
        db_engine.dispose_engines()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--database-url')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--mode', choices=('app', 'measurement', 'stream', 'campaign', 'planning'), default='app')
    parser.add_argument('--historical', action='store_true')
    parser.add_argument('--force-startup-failure', action='store_true')
    options = parser.parse_args()
    try:
        if options.serve:
            if options.mode in {'stream', 'campaign'}:
                serve_named_mode(options.mode)
            else:
                # Application startup prints are diagnostics, never IPC frames.
                with redirect_stdout(sys.stderr):
                    serve(options.port, mode=options.mode)
        else:
            raise SystemExit(launch(options.database_url, mode=options.mode,
                historical=options.historical, force_startup_failure=options.force_startup_failure))
    except BaseException as error:
        if isinstance(error, SystemExit) and not error.code:
            raise
        print('Synthetic DB/OAuth fixture failed: ' + PHASE + '/' + type(error).__name__, file=sys.stderr)
        # Stack coordinates are enough to diagnose a synthetic failure without
        # printing exception values, provider replies or callback query strings.
        import traceback
        for frame in traceback.extract_tb(error.__traceback__):
            print(f'Synthetic fixture frame: {Path(frame.filename).name}:{frame.lineno}:{frame.name}', file=sys.stderr)
        raise SystemExit(1) from None
