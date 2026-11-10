"""Pure runner checks using disposable synthetic source/configuration only."""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("isolated_runner", SOURCE / "run_isolated_runtime_tests.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class IsolatedRuntimeRunnerTests(unittest.TestCase):
    def setUp(self):
        scratch = SOURCE.parent / "tmp"
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="runner-check-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "source"
        self.repo.mkdir()
        self.write("tests/run_isolated_runtime_tests.py", (SOURCE / "run_isolated_runtime_tests.py").read_text())
        self.write("tests/isolated_runtime_sitecustomize.py", (SOURCE / "isolated_runtime_sitecustomize.py").read_text())
        self.write("backend/__init__.py", "")
        self.write("backend/example.py", "VALUE = 'tracked'\n")
        self.write("tests/__init__.py", "")
        self.git("init", "-q")
        self.git("add", "tests", "backend")

    def write(self, relative, contents):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")
        return path

    def git(self, *args):
        result = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True,
                                env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1",
                                     "GIT_CONFIG_GLOBAL": "/dev/null"})
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def snapshot(self, **kwargs):
        path = runner.prepare_snapshot(self.repo, self.root / "snapshot", **kwargs)
        return path, runner.synthetic_environment(path)

    def child(self, snapshot, env, code):
        return subprocess.run([sys.executable, "-s", "-c", code], cwd=snapshot,
                              env=env, text=True, capture_output=True)

    def test_dirty_and_reviewed_new_source_are_copied_without_untracked_configuration(self):
        script = self.write("backend/owned-runner.sh", "#!/bin/sh\nexit 0\n")
        script.chmod(0o755)
        self.git("add", "backend/owned-runner.sh")
        self.write("backend/example.py", "VALUE = 'dirty'\n")
        self.write("backend/new_feature.py", "VALUE = 'new'\n")
        self.write(".env", "UNUSED_SYNTHETIC_VALUE=must-not-copy\n")
        self.write("dashboard-config.json", '{"synthetic": "must-not-copy"}')
        self.write("unexpected.py", "raise AssertionError('must not copy')")
        snapshot, env = self.snapshot(include_new=["backend/new_feature.py"])
        self.assertIn("dirty", (snapshot / "backend/example.py").read_text())
        self.assertEqual((snapshot / "backend/example.py").stat().st_mtime_ns,
                         (self.repo / "backend/example.py").stat().st_mtime_ns)
        self.assertTrue((snapshot / "backend/new_feature.py").exists())
        self.assertFalse((snapshot / "unexpected.py").exists())
        self.assertFalse((snapshot / "dashboard-config.json").exists())
        self.assertNotIn("must-not-copy", (snapshot / ".env").read_text())
        self.assertNotIn("UNUSED_SYNTHETIC_VALUE", env)
        executed = subprocess.run([str(snapshot / "backend/owned-runner.sh")],
                                  cwd=snapshot, env=env)
        self.assertEqual(executed.returncode, 0)

    def test_forbidden_new_paths_are_rejected_before_copy(self):
        for name in (".env", "dashboard-config.json", "../outside.py", "/outside.py", "secrets/key.py"):
            with self.subTest(name=name), self.assertRaises(runner.IsolationError):
                runner.prepare_snapshot(self.repo, self.root / "snapshot", include_new=[name])

    def test_external_tracked_symlink_is_rejected(self):
        target = self.root / "outside.py"
        target.write_text("print('synthetic external source')")
        (self.repo / "backend/alias.py").symlink_to(target)
        self.git("add", "backend/alias.py")
        with self.assertRaises(runner.IsolationError):
            self.snapshot()

    def test_source_parent_symlink_is_rejected(self):
        external = self.root / "external-backend"
        external.mkdir()
        (external / "example.py").write_text("VALUE='external'")
        shutil.rmtree(self.repo / "backend")
        (self.repo / "backend").symlink_to(external, target_is_directory=True)
        with self.assertRaises(runner.IsolationError):
            self.snapshot()

    def test_frontend_build_root_symlink_is_rejected(self):
        external = self.root / "external-build"
        external.mkdir()
        (external / "dashboard.js").write_text("throw new Error('external')")
        (self.repo / "frontend").mkdir()
        (self.repo / "frontend/dist").symlink_to(external, target_is_directory=True)
        with self.assertRaises(runner.IsolationError):
            self.snapshot()

    def test_snapshot_import_wins_even_when_original_is_on_pythonpath(self):
        snapshot, env = self.snapshot()
        env["PYTHONPATH"] += ":" + str(self.repo)
        result = self.child(snapshot, env, "import backend.example; print(backend.example.__file__)")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(str(snapshot / "backend/example.py"), result.stdout)

    def test_live_like_credentials_and_source_are_forbidden(self):
        self.write(".env", "SYNTHETIC_POISON=never-read\n")
        snapshot, env = self.snapshot()
        for target in (self.repo / ".env", self.repo / "backend/example.py"):
            with self.subTest(target=target.name):
                result = self.child(snapshot, env, f"open({str(target)!r}).read()")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("forbidden", result.stderr)
                self.assertNotIn("never-read", result.stdout + result.stderr)

    def test_fresh_child_with_clear_environment_keeps_guards(self):
        self.write(".env", "SYNTHETIC_POISON=never-read\n")
        snapshot, env = self.snapshot()
        nested = f"open({str(self.repo / '.env')!r}).read()"
        code = ("import subprocess,sys; p=subprocess.run([sys.executable,'-c',"
                + repr(nested) + "],env={},capture_output=True,text=True);"
                "print(p.returncode);print(p.stderr)")
        result = self.child(snapshot, env, code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PermissionError", result.stdout)
        self.assertNotIn("never-read", result.stdout + result.stderr)

    def test_known_credential_loaders_are_blocked_and_never_copied(self):
        names = (".netrc", ".pgpass", ".pg_service.conf", "application_default_credentials.json",
                 ".config/gcloud/credentials.db", ".ssh/id_fixture", ".oauth-token-store.json.tmp")
        for name in names:
            self.write(name, "SYNTHETIC_CREDENTIAL_POISON=never-read")
        self.git("add", "-f", *names)
        snapshot, env = self.snapshot()
        for name in names:
            with self.subTest(credential=name):
                self.assertFalse((snapshot / name).exists())
                result = self.child(snapshot, env, f"open({str(self.repo / name)!r}).read()")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Live credential/source access is forbidden", result.stderr)
                self.assertNotIn("never-read", result.stdout + result.stderr)

    def test_fresh_child_cannot_read_absolute_adc_with_clear_environment(self):
        target = self.write(".config/gcloud/application_default_credentials.json", "SYNTHETIC_ADC_POISON=never-read")
        snapshot, env = self.snapshot()
        nested = f"open({str(target)!r}).read()"
        code = ("import subprocess,sys; p=subprocess.run([sys.executable,'-c',"
                + repr(nested) + "],env={},capture_output=True,text=True);"
                "print(p.returncode);print(p.stderr)")
        result = self.child(snapshot, env, code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PermissionError", result.stdout)
        self.assertNotIn("never-read", result.stdout + result.stderr)

    def test_nonfixture_network_is_rejected_before_name_resolution(self):
        snapshot, env = self.snapshot()
        result = self.child(snapshot, env, "import socket; socket.getaddrinfo('example.invalid',443)")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Non-fixture networking is forbidden", result.stderr)

    def test_unregistered_loopback_connection_is_rejected_before_connect(self):
        snapshot, env = self.snapshot()
        result = self.child(snapshot, env, "import socket; socket.create_connection(('127.0.0.1',5432))")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Non-fixture networking is forbidden", result.stderr)
        self.assertNotIn("ConnectionRefusedError", result.stderr)

    def test_registered_fixture_endpoint_passes_the_connect_audit(self):
        snapshot, env = self.snapshot()
        code = (
            "import sys; from tests.run_isolated_runtime_tests import register_fixture_endpoint;"
            "from pathlib import Path;register_fixture_endpoint(Path.cwd(),'127.0.0.1',65431);"
            "sys.audit('socket.connect',None,('127.0.0.1',65431));print('fixture endpoint approved')"
        )
        result = self.child(snapshot, env, code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fixture endpoint approved", result.stdout)

    def test_sqlite_is_refused_in_isolated_children(self):
        snapshot, env = self.snapshot()
        target = self.repo / "live-like.sqlite3"
        for database in (":memory:", "tmp/synthetic.sqlite3", str(target), target.as_uri() + "?mode=rwc"):
            with self.subTest(database=database[:12]):
                result = self.child(snapshot, env, f"import sqlite3; sqlite3.connect({database!r},uri=True)")  # sqlite-refusal-check
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("SQLite is retired", result.stderr)
        self.assertFalse(target.exists())

    def test_environment_without_database_target_names_no_sqlite(self):
        _, env = self.snapshot()
        self.assertEqual((env["DATABASE_URL"], env["TEST_DATABASE_URL"]), ("", ""))

    def owned_cluster_environment(self):
        snapshot, _ = self.snapshot()
        cluster = {"host": "127.0.0.1", "port": 55498, "user": "jep_test", "password": "fake-owned-password",
                   "adminDatabase": "postgres", "runtimeDatabase": "jep_runtime", "binDir": "/nonexistent"}
        return snapshot, runner.synthetic_environment(snapshot, cluster=cluster)

    def test_owned_cluster_environment_uses_postgresql_urls(self):
        _, env = self.owned_cluster_environment()
        self.assertEqual(env["DATABASE_URL"],
                         "postgresql+psycopg://jep_test:fake-owned-password@127.0.0.1:55498/jep_runtime")
        self.assertEqual(env["TEST_DATABASE_URL"],
                         "postgresql+psycopg://jep_test:fake-owned-password@127.0.0.1:55498/postgres")
        self.assertEqual(env["REQUIRE_POSTGRES_REVIEW_CONCURRENCY"], "1")
        with self.assertRaises(runner.IsolationError):
            runner.synthetic_environment(self.root / "snapshot", cluster={"host": "x"}, postgres=({}, None))

    def test_owned_cluster_admits_only_owned_databases_and_schemas(self):
        self.fake_postgres_source()
        snapshot, env = self.owned_cluster_environment()
        base = "host=127.0.0.1 port=55498 user=jep_test password=fake-owned-password"
        for database in ("postgres", "jep_runtime", "jep_t_" + "a" * 32):
            with self.subTest(database=database):
                result = self.child(snapshot, env, f"import psycopg; psycopg.connect({(base + ' dbname=' + database)!r})")
                self.assertIn("native connect boundary reached", result.stderr)
        schema = " dbname=postgres options='-csearch_path=catalog_race_" + "b" * 32 + "'"
        result = self.child(snapshot, env, f"import psycopg; psycopg.connect({(base + schema)!r})")
        self.assertIn("native connect boundary reached", result.stderr)
        for suffix in (" dbname=jep_t_short", " dbname=application", " dbname=postgres password=other",
                       " dbname=postgres port=5432", " dbname=postgres options='-csearch_path=public'"):
            with self.subTest(suffix=suffix):
                result = self.child(snapshot, env, f"import psycopg; psycopg.connect({(base + suffix)!r})")
                self.assertIn("PostgreSQL test connection is not approved", result.stderr)
                self.assertNotIn("native connect boundary reached", result.stderr)

    def fake_postgres_source(self):
        self.write("psycopg/__init__.py", """
import shlex
class adapt:
    class AdaptersMap:
        pass
EXPECTED_CONTEXT = None
class conninfo:
    @staticmethod
    def conninfo_to_dict(value):
        return dict(item.split('=',1) for item in shlex.split(value))
class Connection:
    @classmethod
    def connect(cls, conninfo='', **kwargs):
        if 'context' in kwargs and kwargs['context'] is not EXPECTED_CONTEXT:
            raise AssertionError('adapter context was replaced')
        raise AssertionError('native connect boundary reached')
class AsyncConnection:
    @classmethod
    async def connect(cls, conninfo='', **kwargs):
        raise AssertionError('native async connect boundary reached')
connect=Connection.connect
""")
        self.git("add", "psycopg")

    def test_postgres_sync_and_async_driver_entrypoints_reject_without_approval(self):
        self.fake_postgres_source()
        snapshot, env = self.snapshot()
        for call in ("psycopg.connect", "psycopg.Connection.connect", "psycopg.AsyncConnection.connect"):
            with self.subTest(call=call):
                result = self.child(snapshot, env, f"import psycopg; {call}('host=127.0.0.1 dbname=unapproved')")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("PostgreSQL networking requires an approved", result.stderr)
                self.assertNotIn("native connect boundary reached", result.stderr)
                self.assertNotIn("native async connect boundary reached", result.stderr)

    def test_approved_postgres_rejects_target_file_and_schema_escape_before_driver(self):
        self.fake_postgres_source()
        snapshot, _ = self.snapshot()
        descriptor = self.root / "approved-test.json"
        descriptor.write_text(json.dumps({"approvedDisposable": True, "schemaPrefix": "review_race_",
            "url": "postgresql://fixture:fake-password@127.0.0.1:55499/fixture_db"}))
        env = runner.synthetic_environment(snapshot, postgres=runner.approved_postgres(descriptor))
        base = "host=127.0.0.1 port=55499 dbname=fixture_db user=fixture password=fake-password"
        for suffix in (" host=unapproved.invalid", " service=production", " passfile=/outside",
                       " options='-csearch_path=public'", " options='-csearch_path=review_race_invalid'"):
            with self.subTest(suffix=suffix.split('=')[0]):
                result = self.child(snapshot, env, f"import psycopg; psycopg.connect({(base + suffix)!r})")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("PostgreSQL test connection is not approved", result.stderr)
                self.assertNotIn("native connect boundary reached", result.stderr)
        valid = base + " options='-csearch_path=review_race_" + "a" * 32 + " -cstatement_timeout=10000 -clock_timeout=5000'"
        result = self.child(snapshot, env, f"import psycopg; psycopg.connect({valid!r})")
        self.assertIn("native connect boundary reached", result.stderr)

    def test_typed_psycopg_adapter_context_is_forwarded_without_relaxing_target_checks(self):
        self.fake_postgres_source()
        snapshot, _ = self.snapshot()
        descriptor = self.root / 'approved-adapter-test.json'
        descriptor.write_text(json.dumps({'approvedDisposable': True, 'schemaPrefix': 'review_race_',
            'url': 'postgresql://fixture:fake-password@127.0.0.1:55499/fixture_db'}))
        env = runner.synthetic_environment(snapshot, postgres=runner.approved_postgres(descriptor))
        base = 'host=127.0.0.1 port=55499 dbname=fixture_db user=fixture password=fake-password'
        setup = 'import psycopg; context=psycopg.adapt.AdaptersMap(); psycopg.EXPECTED_CONTEXT=context; '
        result = self.child(snapshot, env, setup + f'psycopg.connect({base!r},context=context)')
        self.assertIn('native connect boundary reached', result.stderr)
        self.assertNotIn('adapter context was replaced', result.stderr)
        for value in ("'arbitrary-string'", 'object()', 'None'):
            with self.subTest(context=value):
                result = self.child(snapshot, env, setup + f'psycopg.connect({base!r},context={value})')
                self.assertIn('PostgreSQL test connection is not approved', result.stderr)
                self.assertNotIn('native connect boundary reached', result.stderr)
        for suffix in (' host=unapproved.invalid', ' port=55498', ' dbname=other',
                       ' user=other', ' password=other', ' passfile=/outside',
                       " options='-csearch_path=public'", " options='-cstatement_timeout=70000'",
                       ' context=not-a-libpq-option'):
            with self.subTest(option=suffix.split('=')[0]):
                result = self.child(snapshot, env, setup + f'psycopg.connect({(base + suffix)!r},context=context)')
                self.assertIn('PostgreSQL test connection is not approved', result.stderr)
                self.assertNotIn('native connect boundary reached', result.stderr)
        result = self.child(snapshot, env, setup + f'psycopg.connect({base!r},context=context,service="outside")')
        self.assertIn('PostgreSQL test connection is not approved', result.stderr)
        self.assertNotIn('native connect boundary reached', result.stderr)

    def test_postgres_requires_separate_explicit_disposable_descriptor(self):
        with self.assertRaises(runner.IsolationError):
            runner.approved_postgres(None)
        descriptor = self.root / "approved-test.json"
        descriptor.write_text(json.dumps({"url": "postgresql://tester:fake-password@127.0.0.1/test_db"}))
        with self.assertRaises(runner.IsolationError):
            runner.approved_postgres(descriptor)
        descriptor.write_text(json.dumps({
            "approvedDisposable": True, "schema": "test_reviews",
            "url": "postgresql://tester:fake-password@127.0.0.1/test_db",
        }))
        target = runner.approved_postgres(descriptor)
        output = runner.safe_output("postgresql://tester:fake-password@127.0.0.1/test_db fake-password", target)
        self.assertNotIn("fake-password", output)
        self.assertNotIn("postgresql://", output)
        diagnostic = "host=127.0.0.1 dbname=test_db user=tester password=fake-password\nRan 2 tests in 0.001s\nFAILED (errors=1)\n"
        output = runner.safe_output(diagnostic, target)
        for private in ("127.0.0.1", "test_db", "tester", "fake-password"):
            self.assertNotIn(private, output)
        self.assertIn("Ran 2 tests", output)

    def test_postgres_descriptor_symlinks_are_rejected_before_read(self):
        poison = self.root / ".env"
        poison.write_text("SYNTHETIC_DESCRIPTOR_POISON=never-read")
        alias = self.root / "approved-test.json"
        alias.symlink_to(poison)
        with mock.patch.object(Path, "read_text", side_effect=AssertionError("descriptor must not be read")):
            with self.assertRaises(runner.IsolationError):
                runner.approved_postgres(alias)
        alias.unlink()
        folder = self.root / "alias-directory"
        folder.symlink_to(self.repo, target_is_directory=True)
        self.write("approved-test.json", "SYNTHETIC_DESCRIPTOR_POISON=never-read")
        with mock.patch.object(Path, "read_text", side_effect=AssertionError("descriptor must not be read")):
            with self.assertRaises(runner.IsolationError):
                runner.approved_postgres(folder / "approved-test.json")

    def test_explicit_node_tool_is_pinned_without_inheriting_environment(self):
        executable = self.root / "node"
        executable.write_text("synthetic executable")
        with mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "v20.20.2\n", "")) as run:
            self.assertEqual(runner.approved_node(executable), executable)
            self.assertEqual(run.call_args.kwargs["env"], {"PATH": str(executable.parent)})
        snapshot, _ = self.snapshot()
        env = runner.synthetic_environment(snapshot, node=executable)
        self.assertTrue(env["PATH"].startswith(str(executable.parent) + ":"))
        with mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "v26.0.0\n", "")):
            with self.assertRaises(runner.IsolationError):
                runner.approved_node(executable)

    def test_postgres_descriptor_invalid_port_is_sanitized(self):
        descriptor = self.root / "approved-test.json"
        descriptor.write_text(json.dumps({"approvedDisposable": True, "schema": "test_reviews",
            "url": "postgresql://fixture:fake-password@127.0.0.1:PRIVATE_PORT_MARKER/fixture_db"}))
        with self.assertRaises(runner.IsolationError) as raised:
            runner.approved_postgres(descriptor)
        self.assertEqual(str(raised.exception), "Invalid PostgreSQL test-target descriptor.")
        self.assertNotIn("PRIVATE_PORT_MARKER", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
