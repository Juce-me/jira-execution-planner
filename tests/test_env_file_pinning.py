import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class EnvFilePinningTests(unittest.TestCase):
    def test_server_pins_dotenv_to_script_directory(self):
        source = (ROOT / "jira_server.py").read_text(encoding="utf8")

        self.assertNotIn(
            "load_dotenv()",
            source,
            "Bare load_dotenv() searches parent directories and lets nested "
            "checkouts (git worktrees) inherit another checkout's .env.",
        )
        self.assertIn(
            "load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))",
            source,
        )

    def test_preflight_pins_dotenv_to_repo_root(self):
        source = (ROOT / "scripts" / "check_startup_preflight.py").read_text(encoding="utf8")

        self.assertIn('load_dotenv(REPO_ROOT / ".env")', source)
        self.assertNotIn("load_dotenv()", source)


class EnvFileBootstrapBehaviorTests(unittest.TestCase):
    """Fresh guarded children exercise dotenv before global/app configuration binds."""

    def setUp(self):
        import tempfile
        from tests.run_isolated_runtime_tests import prepare_snapshot, synthetic_environment
        scratch = ROOT / 'tmp'
        scratch.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='dotenv-bootstrap-', dir=scratch)
        self.addCleanup(temporary.cleanup)
        self.case = pathlib.Path(temporary.name)
        # The outer guarded checkout has no Git index. Explicitly include only
        # the reviewed application source trees; never enumerate tmp/config data.
        sources = ['jira_server.py', 'jira-dashboard.html', 'package-lock.json', 'backend/db/alembic.ini',
                   'scripts/check_startup_preflight.py']
        for directory in ('backend', 'planning'):
            sources.extend(str(path.relative_to(ROOT)) for path in (ROOT / directory).rglob('*.py'))
        sources.extend(str(path.relative_to(ROOT)) for path in (ROOT / 'frontend/src').rglob('*') if path.is_file())
        self.snapshot = prepare_snapshot(ROOT, self.case / 'checkout', include_new=sources)

        self.environment = synthetic_environment(self.snapshot)
        # These particular inputs must be supplied by the selected fake dotenv.
        for name in ('JIRA_AUTH_MODE', 'CONFIG_STORAGE_BACKEND', 'JIRA_URL',
                     'FLASK_SECRET_KEY', 'APP_ALLOWED_ORIGINS', 'SESSION_COOKIE_SECURE'):
            self.environment.pop(name, None)
        self.cwd = self.snapshot / 'tmp/different-cwd'
        self.cwd.mkdir()
        self.legacy = self.snapshot / 'tmp/poisoned-legacy-token.json'
        self.legacy.write_bytes(b'{"syntheticPoison":"legacy token file must stay unread"}\n')
        self.config = self.snapshot / 'dashboard-config.json'
        self.config.write_bytes(b'{"synthetic":"unchanged artifact"}\n')
        self.parent_env = self.case / '.env'
        self.parent_env.write_bytes(b'JIRA_AUTH_MODE=basic\nFLASK_SECRET_KEY=synthetic-parent-key\n')
        self.cwd_env = self.cwd / '.env'
        self.cwd_env.write_bytes(b'JIRA_AUTH_MODE=basic\nFLASK_SECRET_KEY=synthetic-cwd-key\n')

    def configure(self, *, ttl='3600', auth=' atlassian_oauth ', storage=' postgresql '):
        values = {
            'JIRA_AUTH_MODE': auth, 'CONFIG_STORAGE_BACKEND': storage,
            'JIRA_URL': 'https://dotenv.example.invalid',
            'FLASK_SECRET_KEY': 'synthetic-file-signing-key',
            'APP_ALLOWED_ORIGINS': 'https://dotenv-ui.example.invalid',
            'SESSION_COOKIE_SECURE': 'true',
            'JIRA_EMAIL': 'inert@example.invalid', 'JIRA_TOKEN': 'synthetic-inert-value',
            'OAUTH_LOCAL_TOKEN_STORE_ALLOWED': 'true',
            'OAUTH_TOKEN_STORE_PATH': str(self.legacy), 'OAUTH_TOKEN_STORE_TTL_SECONDS': ttl,
        }
        (self.snapshot / '.env').write_text(''.join(f'{name}="{value}"\n' for name, value in values.items()))
        self.before = {path: path.read_bytes() for path in (
            self.snapshot / '.env', self.parent_env, self.cwd_env, self.config, self.legacy)}

    def child(self, body, **exports):
        import json
        import subprocess
        import sys
        environment = {**self.environment, **exports}
        bootstrap = self.snapshot / 'tmp/isolated-runtime/bootstrap'
        (bootstrap / 'environment.json').write_text(json.dumps(environment))
        # Independent from the runner's generic I/O boundary: even an owned
        # poisoned token file must never be opened by application startup.
        setup = f'''
import pathlib, sys
snapshot = pathlib.Path({str(self.snapshot)!r})
legacy = pathlib.Path({str(self.legacy)!r})
def forbid_legacy(event, args):
    if event == 'open' and args and isinstance(args[0], (str, bytes)):
        if pathlib.Path(args[0]).resolve() == legacy:
            raise AssertionError('retired token file was accessed')
sys.addaudithook(forbid_legacy)
'''
        result = subprocess.run([sys.executable, '-s', '-c', setup + body],
            cwd=self.cwd, env=environment, text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        for path, before in self.before.items():
            self.assertEqual(path.read_bytes(), before, path.name)
        return result

    def test_checkout_dotenv_binds_signing_cookies_cors_before_serving_and_survives_restart(self):
        self.configure()
        self.child('''
import jira_server as server
from alembic import command
from alembic.config import Config
assert pathlib.Path(server.__file__).resolve() == snapshot / 'jira_server.py'
assert server.JIRA_AUTH_MODE == 'atlassian_oauth'
assert server.JIRA_URL == 'https://dotenv.example.invalid'
assert server.app.secret_key == 'synthetic-file-signing-key'
assert server.app.config['SESSION_COOKIE_SECURE'] is True
client = server.app.test_client()
with client.session_transaction() as cookie:
    cookie['synthetic_cookie_marker'] = 1
assert client.get_cookie('session').secure is True
response = client.get('/login', headers={'Origin': 'https://dotenv-ui.example.invalid'})
assert response.headers.get('Access-Control-Allow-Origin') == 'https://dotenv-ui.example.invalid'
assert response.headers.get('Access-Control-Allow-Credentials') == 'true'
assert client.get('/login', headers={'Origin': 'https://unselected.example.invalid'}).headers.get('Access-Control-Allow-Origin') is None
config = Config(str(snapshot / 'backend/db/alembic.ini'))
config.set_main_option('script_location', str(snapshot / 'backend/db/migrations'))
config.set_main_option('sqlalchemy.url', __import__('os').environ['DATABASE_URL'])
command.upgrade(config, 'head')
assert server.create_serving_app() is server.app
signed = server.app.session_interface.get_signing_serializer(server.app).dumps({'synthetic_restart_marker': 1})
(snapshot / 'tmp/signed-session.fixture').write_text(signed)
''')
        self.child('''
import jira_server as server
assert server.app.secret_key == 'synthetic-file-signing-key'
assert server.app.config['SESSION_COOKIE_SECURE'] is True
signed = (snapshot / 'tmp/signed-session.fixture').read_text()
assert server.app.session_interface.get_signing_serializer(server.app).loads(signed) == {'synthetic_restart_marker': 1}
assert server.create_serving_app() is server.app
''')
        # Preflight executes its own pinned dotenv bootstrap in another process.
        self.child('''
import runpy, sys
sys.argv = ['check_startup_preflight.py']
runpy.run_path(str(snapshot / 'scripts/check_startup_preflight.py'), run_name='__main__')
''')

    def test_exported_inputs_win_over_dotenv_and_invalid_unused_ttl_is_not_parsed(self):
        self.configure(ttl='not-an-integer')
        self.child('''
import jira_server as server
assert server.JIRA_URL == 'https://exported.example.invalid'
assert server.app.secret_key == 'synthetic-exported-signing-key'
assert server.app.config['SESSION_COOKIE_SECURE'] is False
response = server.app.test_client().get('/login', headers={'Origin': 'https://exported-ui.example.invalid'})
assert response.headers.get('Access-Control-Allow-Origin') == 'https://exported-ui.example.invalid'
assert server.app.test_client().get('/login', headers={'Origin': 'https://dotenv-ui.example.invalid'}).headers.get('Access-Control-Allow-Origin') is None
server.require_db_oauth_profile()
server.validate_local_token_store_allowed()
''', JIRA_URL='https://exported.example.invalid', FLASK_SECRET_KEY='synthetic-exported-signing-key',
            SESSION_COOKIE_SECURE='false', APP_ALLOWED_ORIGINS='https://exported-ui.example.invalid')

    def test_rejected_retired_profile_never_changes_fake_configuration_or_token_files(self):
        self.configure(auth='basic', storage='jsonfile')
        self.child('''
import jira_server as server
from backend.auth.jira_auth import AuthError
try:
    server.create_serving_app()
except AuthError as error:
    assert error.code == 'runtime_auth_unsupported'
    assert 'synthetic-inert-value' not in str(error)
else:
    raise AssertionError('retired runtime profile was accepted')
''')
