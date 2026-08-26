import io
import os
import tempfile
import traceback
import unittest
from pathlib import Path
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, pool, text

from backend.db import engine as db_engine


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'


class DbMigrationTests(unittest.TestCase):
    def _config(self, database_url):
        config = Config(str(ALEMBIC_INI))
        config.set_main_option('sqlalchemy.url', database_url)
        config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
        return config

    def _has_auth_tables(self, database_url):
        engine = create_engine(database_url, future=True)
        try:
            tables = set(inspect(engine).get_table_names())
        finally:
            engine.dispose()
        return {
            'users',
            'workspaces',
            'auth_connections',
            'auth_tokens',
            'service_integrations',
            'service_integration_tokens',
            'jira_project_access',
            'audit_events',
        }.issubset(tables)

    def _auth_connection_schema(self, database_url):
        engine = create_engine(database_url, future=True)
        try:
            inspector = inspect(engine)
            columns = {column['name'] for column in inspector.get_columns('auth_connections')}
            indexes = {index['name'] for index in inspector.get_indexes('auth_connections')}
        finally:
            engine.dispose()
        return columns, indexes

    def test_initial_auth_migration_upgrades_downgrades_and_reruns(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'migration.db')}"
            config = self._config(database_url)

            command.upgrade(config, 'head')
            self.assertTrue(self._has_auth_tables(database_url))
            columns, indexes = self._auth_connection_schema(database_url)
            self.assertIn('credential_subject', columns)
            self.assertIn('capabilities', columns)
            self.assertIn('uq_auth_connections_user_api_token_cloud', indexes)

            command.upgrade(config, 'head')
            self.assertTrue(self._has_auth_tables(database_url))

            command.downgrade(config, '20260511_0001')
            self.assertTrue(self._has_auth_tables(database_url))
            columns, indexes = self._auth_connection_schema(database_url)
            self.assertNotIn('credential_subject', columns)
            self.assertNotIn('capabilities', columns)
            self.assertNotIn('uq_auth_connections_user_api_token_cloud', indexes)

            command.upgrade(config, 'head')
            self.assertTrue(self._has_auth_tables(database_url))

            command.downgrade(config, 'base')
            self.assertFalse(self._has_auth_tables(database_url))

    def test_online_migrations_use_shared_engine_factory_with_null_pool(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'shared.db')}"
            config = self._config(database_url)

            with patch.dict(
                os.environ,
                {"DATABASE_CONNECTION_MODE": "url"},
                clear=False,
            ), patch.object(
                db_engine,
                "create_database_engine",
                wraps=db_engine.create_database_engine,
            ) as factory:
                command.upgrade(config, "head")

            factory.assert_called()
            self.assertEqual(factory.call_args.args[0], database_url)
            self.assertIs(factory.call_args.kwargs["poolclass"], pool.NullPool)

    def test_offline_migrations_do_not_discover_or_refresh_adc(self):
        config = self._config(
            "postgresql+psycopg://iam-user@private-db.internal.example:5432/planner"
            "?sslmode=require"
        )
        output = io.StringIO()
        config.output_buffer = output

        with patch.dict(
            os.environ,
            {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"},
            clear=False,
        ), patch(
            "backend.db.cloud_sql.google.auth.default",
            side_effect=AssertionError("offline migrations must not load ADC"),
        ) as adc, patch(
            "backend.db.cloud_sql.IamLoginTokenProvider.from_adc",
            side_effect=AssertionError("offline migrations must not create a provider"),
        ) as provider, patch(
            "backend.db.cloud_sql.psycopg.connect",
            side_effect=AssertionError("offline migrations must not connect"),
        ) as connect:
            command.upgrade(config, "head", sql=True)

        self.assertIn("CREATE TABLE", output.getvalue())
        adc.assert_not_called()
        provider.assert_not_called()
        connect.assert_not_called()

    def test_offline_iam_migrations_reject_password_wrong_driver_and_unsafe_tls(self):
        invalid_urls = (
            "postgresql+psycopg://iam-user:secret@db:5432/planner?sslmode=require",
            "postgresql+pg8000://iam-user@db:5432/planner?sslmode=require",
            "postgresql+psycopg://iam-user@db:5432/planner",
            "postgresql+psycopg://iam-user@db:5432/planner?sslmode=prefer",
        )

        for database_url in invalid_urls:
            with self.subTest(database_url=database_url):
                config = self._config(database_url)
                config.output_buffer = io.StringIO()
                with patch.dict(
                    os.environ,
                    {"DATABASE_CONNECTION_MODE": "cloud_sql_iam"},
                    clear=False,
                ):
                    with self.assertRaises(db_engine.DatabaseConfigurationError) as raised:
                        command.upgrade(config, "head", sql=True)

                rendered = "".join(traceback.format_exception(raised.exception))
                self.assertIsNone(raised.exception.__cause__)
                self.assertIsNone(raised.exception.__context__)
                self.assertNotIn("secret", rendered)

    def test_onboarding_migration_backfills_existing_preferences_and_defaults_new_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'onboarding.db')}"
            config = self._config(database_url)

            command.upgrade(config, '20260604_0006')
            engine = create_engine(database_url, future=True)
            try:
                with engine.begin() as connection:
                    connection.execute(text("""
                        INSERT INTO user_group_preferences (
                            id, workspace_id, user_id, payload_version, visible_group_ids,
                            active_group_id, customized, created_at, updated_at
                        ) VALUES (
                            'preference-existing', 'workspace-1', 'user-1', 1, '[]',
                            'platform', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                    """))
            finally:
                engine.dispose()

            command.upgrade(config, '20260826_0007')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                onboarding_column = next(
                    column for column in inspector.get_columns('user_group_preferences')
                    if column['name'] == 'onboarding_done'
                )
                self.assertFalse(onboarding_column['nullable'])

                with engine.begin() as connection:
                    existing = connection.execute(text("""
                        SELECT onboarding_done
                        FROM user_group_preferences
                        WHERE id = 'preference-existing'
                    """)).scalar_one()
                    connection.execute(text("""
                        INSERT INTO user_group_preferences (
                            id, workspace_id, user_id, payload_version, visible_group_ids,
                            active_group_id, customized, created_at, updated_at
                        ) VALUES (
                            'preference-new', 'workspace-2', 'user-2', 1, '[]',
                            'platform', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                    """))
                    inserted = connection.execute(text("""
                        SELECT onboarding_done
                        FROM user_group_preferences
                        WHERE id = 'preference-new'
                    """)).scalar_one()

                self.assertTrue(bool(existing))
                self.assertFalse(bool(inserted))
            finally:
                engine.dispose()

            command.downgrade(config, '20260604_0006')
            engine = create_engine(database_url, future=True)
            try:
                preference_columns = {
                    column['name']
                    for column in inspect(engine).get_columns('user_group_preferences')
                }
                self.assertNotIn('onboarding_done', preference_columns)
                self.assertTrue({
                    'workspace_id',
                    'user_id',
                    'visible_group_ids',
                    'active_group_id',
                    'customized',
                }.issubset(preference_columns))
            finally:
                engine.dispose()


if __name__ == '__main__':
    unittest.main()
