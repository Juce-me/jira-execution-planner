import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool, QueuePool

from backend.db import engine as db_engine
from backend.db import models


class DbSessionTests(unittest.TestCase):
    def tearDown(self):
        db_engine.dispose_engines()

    def test_db_mode_requires_database_url(self):
        environ = {
            'CONFIG_STORAGE_BACKEND': 'db',
            'TEST_DATABASE_URL': '',
            'DATABASE_URL': '',
        }

        with self.assertRaisesRegex(db_engine.DatabaseConfigurationError, 'DATABASE_URL'):
            db_engine.resolve_database_url(environ=environ)

    def test_session_factories_are_keyed_by_url(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            first_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'first.db')}"
            second_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'second.db')}"

            first_factory = db_engine.session_factory(first_url)
            same_first_factory = db_engine.session_factory(first_url)
            second_factory = db_engine.session_factory(second_url)

            self.assertIs(first_factory, same_first_factory)
            self.assertIsNot(first_factory, second_factory)
            self.assertIsNot(first_factory.kw['bind'], second_factory.kw['bind'])

    def test_workspace_cloud_id_unique_within_environment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'workspaces.db')}"
            engine = db_engine.get_engine(url)
            models.Base.metadata.create_all(engine)
            factory = db_engine.session_factory(url)

            with factory() as session:
                session.add(models.Workspace(
                    environment_key='local',
                    name='Local',
                    jira_site_url='https://example.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                ))
                session.commit()

                session.add(models.Workspace(
                    environment_key='local',
                    name='Duplicate',
                    jira_site_url='https://other.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                ))
                with self.assertRaises(IntegrityError):
                    session.commit()
                session.rollback()

                session.add(models.Workspace(
                    environment_key='dev',
                    name='Different environment',
                    jira_site_url='https://other.atlassian.net',
                    jira_cloud_id='cloud-1',
                    created_by='test',
                ))
                session.commit()

    def test_workspace_site_url_unique_within_environment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'sites.db')}"
            engine = db_engine.get_engine(url)
            models.Base.metadata.create_all(engine)
            factory = db_engine.session_factory(url)

            with factory() as session:
                session.add(models.Workspace(
                    environment_key='local',
                    name='Local',
                    jira_site_url='https://example.atlassian.net',
                    created_by='test',
                ))
                session.commit()

                session.add(models.Workspace(
                    environment_key='local',
                    name='Duplicate',
                    jira_site_url='https://example.atlassian.net',
                    created_by='test',
                ))
                with self.assertRaises(IntegrityError):
                    session.commit()
                session.rollback()

                session.add(models.Workspace(
                    environment_key='dev',
                    name='Different environment',
                    jira_site_url='https://example.atlassian.net',
                    created_by='test',
                ))
                session.commit()

    def test_refresh_race_locking_refuses_sqlite(self):
        with self.assertRaisesRegex(db_engine.DatabaseConfigurationError, 'SQLite cannot prove'):
            db_engine.require_postgresql_refresh_locking('sqlite+pysqlite:///:memory:')

    def test_default_url_mode_preserves_existing_create_engine_path(self):
        env = {"DATABASE_CONNECTION_MODE": "url"}
        with patch("backend.db.engine.create_engine") as create_engine:
            expected = create_engine.return_value
            actual = db_engine.create_database_engine(
                "postgresql+psycopg://jep:password@localhost:5432/jep_local",
                environ=env,
            )

        self.assertIs(actual, expected)
        create_engine.assert_called_once_with(
            "postgresql+psycopg://jep:password@localhost:5432/jep_local",
            future=True,
            pool_pre_ping=True,
        )

    def test_test_database_url_precedence_is_unchanged_in_url_mode(self):
        env = {
            "DATABASE_CONNECTION_MODE": "url",
            "CONFIG_STORAGE_BACKEND": "db",
            "DATABASE_URL": "postgresql+psycopg://jep@db:5432/app",
            "TEST_DATABASE_URL": "sqlite+pysqlite:///:memory:",
        }

        self.assertEqual(
            db_engine.resolve_database_url(environ=env, testing=True),
            "sqlite+pysqlite:///:memory:",
        )

    def test_unknown_connection_mode_fails_closed(self):
        with self.assertRaisesRegex(
            db_engine.DatabaseConfigurationError,
            "DATABASE_CONNECTION_MODE must be url or cloud_sql_iam",
        ):
            db_engine.resolve_database_connection_mode(
                {"DATABASE_CONNECTION_MODE": "automatic"}
            )

    def test_cloud_sql_engine_uses_psycopg_safe_url_and_normal_web_pool(self):
        env = {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"}
        database_url = (
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=require"
        )
        provider = Mock()
        provider.current_token.return_value = "current-token"
        connection = object()
        psycopg_connect = Mock(return_value=connection)

        engine = db_engine.create_database_engine(
            database_url,
            environ=env,
            token_provider_factory=lambda: provider,
            psycopg_connect=psycopg_connect,
        )
        try:
            self.assertEqual(engine.url.drivername, "postgresql+psycopg")
            self.assertIsNone(engine.url.password)
            self.assertIsInstance(engine.pool, QueuePool)
            creator = engine.pool._creator
            self.assertIs(creator(), connection)
            self.assertEqual(psycopg_connect.call_args.kwargs["password"], "current-token")
        finally:
            engine.dispose()

    def test_cloud_sql_engine_and_session_cache_keys_never_contain_token(self):
        env = {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"}
        database_url = (
            "postgresql+psycopg://iam-user@db:5432/planner?sslmode=require"
        )
        token = "sensitive-login-token"
        provider = Mock()
        provider.current_token.return_value = token

        with patch(
            "backend.db.engine.IamLoginTokenProvider.from_adc",
            return_value=provider,
        ):
            first = db_engine.get_engine(database_url, environ=env)
            second = db_engine.get_engine(database_url, environ=env)
            first_factory = db_engine.session_factory(database_url, environ=env)
            second_factory = db_engine.session_factory(database_url, environ=env)

        self.assertIs(first, second)
        self.assertIs(first_factory, second_factory)
        rendered_keys = repr((
            tuple(db_engine._ENGINES),
            tuple(db_engine._SESSION_FACTORIES),
        ))
        self.assertNotIn(token, rendered_keys)
        self.assertNotIn("password", rendered_keys.lower())


if __name__ == '__main__':
    unittest.main()
