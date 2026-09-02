import io
import json
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

    def test_workspace_config_migration_is_data_neutral_and_reversible(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'workspace-config.db')}"
            config = self._config(database_url)
            command.upgrade(config, '20260604_0006')
            engine = create_engine(database_url, future=True)
            with engine.begin() as connection:
                connection.exec_driver_sql(
                    "INSERT INTO users (id, external_provider, external_subject, account_type, status, created_by, created_at, updated_at) "
                    "VALUES ('user-1', 'atlassian', 'subject-1', 'admin', 'active', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspaces (id, environment_key, name, created_by, created_at, updated_at) "
                    "VALUES ('workspace-1', 'test', 'Workspace', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO view_configs (id, workspace_id, owner_user_id, name, view_type, mode_policy, payload_version, payload, visibility, is_default, created_at, updated_at) "
                    "VALUES ('view-1', 'workspace-1', 'user-1', 'Default', 'mixed', 'configuration', 1, '{}', 'private', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO view_config_versions (id, view_config_id, version_number, payload, created_by, created_at, change_note) "
                    "VALUES ('version-1', 'view-1', 1, '{}', 'user-1', CURRENT_TIMESTAMP, 'compatibility save')"
                )
            engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            archive_inspector = inspect(engine)
            archive_columns = {
                column['name']: column for column in archive_inspector.get_columns(
                    'workspace_epm_config_migration_archive'
                )
            }
            self.assertEqual(set(archive_columns), {'workspace_id', 'epm_payload', 'original_revision'})
            self.assertFalse(archive_columns['workspace_id']['nullable'])
            self.assertTrue(archive_columns['epm_payload']['nullable'])
            self.assertFalse(archive_columns['original_revision']['nullable'])
            self.assertEqual(
                archive_inspector.get_pk_constraint('workspace_epm_config_migration_archive')['constrained_columns'],
                ['workspace_id'],
            )
            archive_fk = archive_inspector.get_foreign_keys(
                'workspace_epm_config_migration_archive'
            )[0]
            self.assertEqual(archive_fk['referred_table'], 'workspaces')
            self.assertEqual(archive_fk['options'].get('ondelete'), 'CASCADE')
            inspector = inspect(engine)
            self.assertEqual(
                {column['name'] for column in inspector.get_columns('workspace_dashboard_configs')},
                {'id', 'workspace_id', 'payload_version', 'payload', 'config_revision', 'created_by', 'updated_by', 'created_at', 'updated_at'},
            )
            self.assertEqual(
                {column['name'] for column in inspector.get_columns('workspace_team_catalogs')},
                {'id', 'workspace_id', 'payload_version', 'payload', 'config_revision', 'updated_by', 'created_at', 'updated_at'},
            )
            with engine.connect() as connection:
                self.assertEqual(connection.exec_driver_sql('SELECT count(*) FROM workspace_dashboard_configs').scalar_one(), 0)
                self.assertEqual(connection.exec_driver_sql('SELECT count(*) FROM view_config_versions').scalar_one(), 1)
            engine.dispose()

            command.downgrade(config, '20260604_0006')
            engine = create_engine(database_url, future=True)
            self.assertNotIn('workspace_dashboard_configs', inspect(engine).get_table_names())
            self.assertNotIn('workspace_team_catalogs', inspect(engine).get_table_names())
            engine.dispose()
            command.upgrade(config, 'head')

    def test_workspace_epm_migration_round_trips_every_json_value_and_recovers_bad_current_payload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'workspace-epm-values.db')}"
            config = self._config(database_url)
            command.upgrade(config, '20260826_0007')
            values = [None, 'text', True, False, 17, ['one', 2], {}]
            engine = create_engine(database_url, future=True)
            with engine.begin() as connection:
                for index, value in enumerate(values):
                    workspace_id = f'workspace-{index}'
                    connection.exec_driver_sql(
                        "INSERT INTO workspaces (id, environment_key, name, created_by, created_at, updated_at) "
                        "VALUES (?, ?, ?, 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                        (workspace_id, f'value-{index}', f'Value {index}'),
                    )
                    connection.exec_driver_sql(
                        "INSERT INTO workspace_dashboard_configs "
                        "(id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                        "VALUES (?, ?, 1, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                        (f'config-{index}', workspace_id, json.dumps({'board': {'index': index}, 'epm': value})),
                    )
                connection.exec_driver_sql(
                    "INSERT INTO workspaces (id, environment_key, name, created_by, created_at, updated_at) "
                    "VALUES ('workspace-precision', 'precision', 'Precision', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspace_dashboard_configs "
                    "(id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                    "VALUES ('config-precision', 'workspace-precision', 1, "
                    "'{\"board\":{\"kept\":true},\"epm\":1.234567890123456789}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            with engine.begin() as connection:
                archives = connection.exec_driver_sql(
                    'SELECT workspace_id, epm_payload FROM workspace_epm_config_migration_archive ORDER BY workspace_id'
                ).all()
                self.assertEqual([
                    json.loads(row.epm_payload) if isinstance(row.epm_payload, str) else row.epm_payload
                    for row in archives if row.workspace_id != 'workspace-precision'
                ], values)
                precision_archive = next(
                    row.epm_payload for row in archives if row.workspace_id == 'workspace-precision'
                )
                self.assertEqual(precision_archive, '1.234567890123456789')
                connection.exec_driver_sql(
                    "UPDATE workspace_dashboard_configs SET payload='\"current scalar\"' WHERE workspace_id='workspace-0'"
                )
                connection.exec_driver_sql(
                    "UPDATE workspace_dashboard_configs SET payload='{broken' WHERE workspace_id='workspace-1'"
                )
                connection.exec_driver_sql(
                    "UPDATE workspace_dashboard_configs SET payload='{\"epm\":\"newer\",\"board\":{\"kept\":true}}' "
                    "WHERE workspace_id='workspace-2'"
                )
            engine.dispose()

            command.downgrade(config, '20260826_0007')
            engine = create_engine(database_url, future=True)
            with engine.connect() as connection:
                restored = {
                    row.workspace_id: json.loads(row.payload)
                    for row in connection.exec_driver_sql(
                        'SELECT workspace_id, payload FROM workspace_dashboard_configs ORDER BY workspace_id'
                    ).all()
                }
                precision_payload = connection.exec_driver_sql(
                    "SELECT payload FROM workspace_dashboard_configs WHERE workspace_id='workspace-precision'"
                ).scalar_one()
            engine.dispose()
            self.assertEqual(restored['workspace-0'], {'epm': None})
            self.assertEqual(restored['workspace-1'], {'epm': 'text'})
            self.assertEqual(restored['workspace-2'], {'board': {'kept': True}, 'epm': True})
            for index, value in enumerate(values[3:], start=3):
                self.assertEqual(restored[f'workspace-{index}']['epm'], value)
            self.assertIn('"epm":1.234567890123456789', precision_payload)

    def test_workspace_config_migration_renders_offline_sql(self):
        config = self._config('postgresql+psycopg://user@db.example:5432/planner?sslmode=require')
        output = io.StringIO()
        config.output_buffer = output
        with patch.dict(os.environ, {'DATABASE_CONNECTION_MODE': 'url'}, clear=False):
            command.upgrade(config, 'head', sql=True)
        sql = output.getvalue()
        self.assertIn('workspace_dashboard_configs', sql)
        self.assertIn('workspace_team_catalogs', sql)

    def test_workspace_epm_migration_archives_removes_restores_and_reupgrades(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'workspace-epm.db')}"
            config = self._config(database_url)
            command.upgrade(config, '20260826_0007')
            engine = create_engine(database_url, future=True)
            epm = {'version': 2, 'scope': {'rootGoalKey': 'ROOT-1'}, 'projects': {'p': {'label': 'project_p'}}}
            with engine.begin() as connection:
                connection.exec_driver_sql(
                    "INSERT INTO workspaces (id, environment_key, name, created_by, created_at, updated_at) VALUES "
                    "('workspace-epm', 'epm', 'EPM', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                    "('workspace-plain', 'plain', 'Plain', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                    "('workspace-scalar', 'scalar', 'Scalar', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                    "('workspace-malformed', 'malformed', 'Malformed', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspace_dashboard_configs "
                    "(id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                    "VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    [
                        ('config-epm', 'workspace-epm', json.dumps({'board': {'boardId': '7'}, 'epm': epm}), 4),
                        ('config-plain', 'workspace-plain', json.dumps({'board': {'boardId': '8'}}), 5),
                        ('config-scalar', 'workspace-scalar', json.dumps('scalar'), 6),
                        ('config-malformed', 'workspace-malformed', '{broken', 7),
                    ],
                )
            engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            with engine.begin() as connection:
                changed = connection.exec_driver_sql(
                    "SELECT payload, config_revision FROM workspace_dashboard_configs WHERE workspace_id='workspace-epm'"
                ).one()
                self.assertEqual(json.loads(changed.payload), {'board': {'boardId': '7'}})
                self.assertEqual(changed.config_revision, 5)
                archive = connection.exec_driver_sql(
                    'SELECT epm_payload, original_revision FROM workspace_epm_config_migration_archive'
                ).one()
                self.assertEqual(json.loads(archive.epm_payload), epm)
                self.assertEqual(archive.original_revision, 4)
                untouched = connection.exec_driver_sql(
                    "SELECT workspace_id, payload, config_revision FROM workspace_dashboard_configs "
                    "WHERE workspace_id != 'workspace-epm' ORDER BY workspace_id"
                ).all()
                self.assertEqual([(row.workspace_id, row.payload, row.config_revision) for row in untouched], [
                    ('workspace-malformed', '{broken', 7),
                    ('workspace-plain', json.dumps({'board': {'boardId': '8'}}), 5),
                    ('workspace-scalar', json.dumps('scalar'), 6),
                ])
                connection.exec_driver_sql(
                    "UPDATE workspace_dashboard_configs SET payload=?, config_revision=9 WHERE workspace_id='workspace-epm'",
                    (json.dumps({'board': {'boardId': '99'}, 'capacity': {'project': 'NEW'}}),),
                )
            engine.dispose()

            command.downgrade(config, '20260826_0007')
            engine = create_engine(database_url, future=True)
            self.assertNotIn('workspace_epm_config_migration_archive', inspect(engine).get_table_names())
            with engine.connect() as connection:
                restored = connection.exec_driver_sql(
                    "SELECT payload, config_revision FROM workspace_dashboard_configs WHERE workspace_id='workspace-epm'"
                ).one()
                self.assertEqual(json.loads(restored.payload), {
                    'board': {'boardId': '99'}, 'capacity': {'project': 'NEW'}, 'epm': epm,
                })
                self.assertEqual(restored.config_revision, 10)
            engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            with engine.connect() as connection:
                rerun = connection.exec_driver_sql(
                    "SELECT payload, config_revision FROM workspace_dashboard_configs WHERE workspace_id='workspace-epm'"
                ).one()
                self.assertNotIn('epm', json.loads(rerun.payload))
                self.assertEqual(rerun.config_revision, 11)
            engine.dispose()

    def test_workspace_epm_migration_does_not_touch_other_ownership_tables(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'workspace-epm-isolation.db')}"
            config = self._config(database_url)
            command.upgrade(config, '20260826_0007')
            engine = create_engine(database_url, future=True)
            with engine.begin() as connection:
                connection.exec_driver_sql(
                    "INSERT INTO users (id, external_provider, external_subject, account_type, status, created_by, created_at, updated_at) "
                    "VALUES ('user-1', 'atlassian', 'subject-1', 'user', 'active', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspaces (id, environment_key, name, created_by, created_at, updated_at) "
                    "VALUES ('workspace-1', 'test', 'Workspace', 'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspace_dashboard_configs (id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                    "VALUES ('dashboard-1', 'workspace-1', 1, '{\"epm\":{\"version\":2},\"board\":{}}', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO view_configs (id, workspace_id, owner_user_id, name, view_type, mode_policy, payload_version, payload, visibility, is_default, created_at, updated_at) "
                    "VALUES ('view-1', 'workspace-1', 'user-1', 'Default', 'epm', 'configuration', 1, '{\"epm\":{\"version\":2}}', 'private', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO view_config_versions (id, view_config_id, version_number, payload, created_by, created_at) "
                    "VALUES ('version-1', 'view-1', 1, '{\"epm\":{\"version\":2}}', 'user-1', CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspace_group_configs (id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                    "VALUES ('groups-1', 'workspace-1', 1, '{\"groups\":[]}', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO user_group_preferences (id, workspace_id, user_id, payload_version, visible_group_ids, customized, created_at, updated_at) "
                    "VALUES ('prefs-1', 'workspace-1', 'user-1', 1, '[\"group-1\"]', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO workspace_team_catalogs (id, workspace_id, payload_version, payload, config_revision, created_at, updated_at) "
                    "VALUES ('catalog-1', 'workspace-1', 1, '{\"catalog\":{\"team-1\":{}}}', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO auth_connections (id, user_id, workspace_id, provider, status, token_version, capabilities, created_at, updated_at) "
                    "VALUES ('connection-1', 'user-1', 'workspace-1', 'atlassian_oauth', 'active', 1, '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
                connection.exec_driver_sql(
                    "INSERT INTO auth_tokens (id, connection_id, token_kind, algorithm, ciphertext, nonce, wrapped_dek, key_id, aad_hash) "
                    "VALUES ('token-1', 'connection-1', 'access_token', 'test', 'cipher', 'nonce', 'dek', 'key', 'hash')"
                )
                protected = {}
                for table in ('view_configs', 'view_config_versions', 'workspace_group_configs', 'user_group_preferences', 'workspace_team_catalogs', 'auth_connections', 'auth_tokens'):
                    protected[table] = connection.exec_driver_sql(f'SELECT * FROM {table}').mappings().all()
            command.upgrade(config, '20260827_0008')
            with engine.connect() as connection:
                for table, before in protected.items():
                    self.assertEqual(connection.exec_driver_sql(f'SELECT * FROM {table}').mappings().all(), before, table)
            engine.dispose()

    def test_workspace_epm_migration_renders_postgresql_upgrade_and_downgrade_offline(self):
        config = self._config('postgresql+psycopg://user@db.example:5432/planner?sslmode=require')
        upgrade_output = io.StringIO()
        config.output_buffer = upgrade_output
        with patch.dict(os.environ, {'DATABASE_CONNECTION_MODE': 'url'}, clear=False):
            command.upgrade(config, 'head', sql=True)
        upgrade_sql = upgrade_output.getvalue()
        self.assertIn('workspace_epm_config_migration_archive', upgrade_sql)
        self.assertIn("payload::jsonb - 'epm'", upgrade_sql.replace('workspace_config.', ''))
        self.assertIn(
            'config_revision = config_revision + 1',
            upgrade_sql.replace('workspace_config.', ''),
        )

        downgrade_output = io.StringIO()
        config.output_buffer = downgrade_output
        with patch.dict(os.environ, {'DATABASE_CONNECTION_MODE': 'url'}, clear=False):
            command.downgrade(config, '20260827_0008:20260826_0007', sql=True)
        downgrade_sql = downgrade_output.getvalue()
        self.assertIn("jsonb_build_object('epm'", downgrade_sql)
        self.assertIn(
            'config_revision = config_revision + 1',
            downgrade_sql.replace('workspace_config.', ''),
        )
        self.assertIn('DROP TABLE workspace_epm_config_migration_archive', downgrade_sql)
        self.assertNotIn('UPDATE view_configs', upgrade_sql)
        self.assertNotIn('UPDATE view_config_versions', upgrade_sql)
        self.assertNotIn('UPDATE users', upgrade_sql)

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

    def test_screen_scoped_onboarding_migration_backfills_and_downgrades_only_modules(self):
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

            command.upgrade(config, '20260829_0009')
            engine = create_engine(database_url, future=True)
            try:
                with engine.begin() as connection:
                    connection.execute(text("""
                        INSERT INTO user_group_preferences (
                            id, workspace_id, user_id, payload_version, visible_group_ids,
                            active_group_id, customized, onboarding_done, created_at, updated_at
                        ) VALUES (
                            'preference-new', 'workspace-2', 'user-2', 1, '[]',
                            'platform', 1, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                    """))
            finally:
                engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                columns = {
                    column['name']: column
                    for column in inspector.get_columns('user_group_preferences')
                }
                self.assertFalse(columns['onboarding_done']['nullable'])
                self.assertFalse(columns['onboarding_completed_modules']['nullable'])
                with engine.begin() as connection:
                    connection.execute(text("""
                        INSERT INTO user_group_preferences (
                            id, workspace_id, user_id, payload_version, visible_group_ids,
                            active_group_id, customized, created_at, updated_at
                        ) VALUES (
                            'preference-defaults', 'workspace-3', 'user-3', 1, '[]',
                            'platform', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                    """))
                    rows = {
                        row.id: row
                        for row in connection.execute(text("""
                            SELECT id, onboarding_done, onboarding_completed_modules
                            FROM user_group_preferences
                            ORDER BY id
                        """)).mappings()
                    }

                completed_modules = rows['preference-existing']['onboarding_completed_modules']
                incomplete_modules = rows['preference-new']['onboarding_completed_modules']
                default_modules = rows['preference-defaults']['onboarding_completed_modules']
                if isinstance(completed_modules, str):
                    completed_modules = json.loads(completed_modules)
                if isinstance(incomplete_modules, str):
                    incomplete_modules = json.loads(incomplete_modules)
                if isinstance(default_modules, str):
                    default_modules = json.loads(default_modules)
                self.assertTrue(bool(rows['preference-existing']['onboarding_done']))
                self.assertEqual(completed_modules, [
                    'catch-up',
                    'configuration',
                    'planning',
                    'board',
                    'statistics',
                ])
                self.assertFalse(bool(rows['preference-new']['onboarding_done']))
                self.assertEqual(incomplete_modules, [])
                self.assertFalse(bool(rows['preference-defaults']['onboarding_done']))
                self.assertEqual(default_modules, [])
            finally:
                engine.dispose()

            command.downgrade(config, '20260829_0009')
            engine = create_engine(database_url, future=True)
            try:
                preference_columns = {
                    column['name']
                    for column in inspect(engine).get_columns('user_group_preferences')
                }
                self.assertIn('onboarding_done', preference_columns)
                self.assertNotIn('onboarding_completed_modules', preference_columns)
                with engine.connect() as connection:
                    legacy_values = {
                        row.id: bool(row.onboarding_done)
                        for row in connection.execute(text("""
                            SELECT id, onboarding_done
                            FROM user_group_preferences
                            ORDER BY id
                        """)).mappings()
                    }
                self.assertEqual(legacy_values, {
                    'preference-defaults': False,
                    'preference-existing': True,
                    'preference-new': False,
                })
            finally:
                engine.dispose()


if __name__ == '__main__':
    unittest.main()
