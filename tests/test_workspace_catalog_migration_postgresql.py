import os
import unittest
import uuid
from datetime import datetime, timezone

from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, Table, create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALEMBIC_INI = os.path.join(REPO_ROOT, 'backend', 'db', 'alembic.ini')
REVISION = '20260913_0016'
PRIOR_REVISION = '20260908_0015'


@unittest.skipUnless(
    os.environ.get('REQUIRE_POSTGRES_CATALOG_CONCURRENCY') == '1',
    'PostgreSQL catalog migration gate not required',
)
class WorkspaceCatalogMigrationPostgresqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database_url = os.environ.get('TEST_DATABASE_URL', '').strip()
        try:
            parsed_url = make_url(cls.database_url)
        except Exception as error:
            raise AssertionError('TEST_DATABASE_URL must be an explicit PostgreSQL URL') from error
        if parsed_url.get_backend_name() != 'postgresql':
            raise AssertionError('TEST_DATABASE_URL must be an explicit PostgreSQL URL')

        cls.schema = f'workspace_catalog_{uuid.uuid4().hex}'
        existing_options = str(parsed_url.query.get('options') or '').strip()
        bounded_options = ' '.join(filter(None, (
            existing_options,
            '-cstatement_timeout=10000',
            '-clock_timeout=2000',
        )))
        admin_url = parsed_url.update_query_dict({'options': bounded_options})
        cls.admin_engine = create_engine(
            admin_url.render_as_string(hide_password=False), future=True,
        )
        with cls.admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{cls.schema}"'))
        cls.addClassCleanup(cls._drop_schema)
        scoped_url = parsed_url.update_query_dict({
            'options': f'{bounded_options} -csearch_path={cls.schema}',
        })
        cls.scoped_url = scoped_url.render_as_string(hide_password=False)
        cls.engine = create_engine(cls.scoped_url, future=True)

    @classmethod
    def _drop_schema(cls):
        try:
            cls.engine.dispose()
        finally:
            try:
                with cls.admin_engine.begin() as connection:
                    connection.execute(text(f'DROP SCHEMA IF EXISTS "{cls.schema}" CASCADE'))
            finally:
                cls.admin_engine.dispose()

    def _config(self):
        config = Config(ALEMBIC_INI)
        config.set_main_option('sqlalchemy.url', self.scoped_url.replace('%', '%%'))
        config.set_main_option(
            'script_location', os.path.join(REPO_ROOT, 'backend', 'db', 'migrations'),
        )
        return config

    def _reflect(self, table_name):
        return Table(table_name, MetaData(), autoload_with=self.engine)

    def _insert_rejected(self, table, values):
        with self.assertRaises(IntegrityError):
            with self.engine.begin() as connection:
                connection.execute(table.insert(), values)

    def test_real_alembic_catalog_upgrade_downgrade_reupgrade(self):
        config = self._config()
        command.upgrade(config, PRIOR_REVISION)
        workspace_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())
        dashboard_id = str(uuid.uuid4())
        directory_id = str(uuid.uuid4())
        with self.engine.begin() as connection:
            connection.execute(text("""
                INSERT INTO users (
                    id, external_provider, external_subject, account_type, status,
                    created_by, created_at, updated_at
                ) VALUES (
                    :id, 'atlassian', 'synthetic-catalog-user', 'user', 'active',
                    'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """), {'id': user_id})
            connection.execute(text("""
                INSERT INTO workspaces (
                    id, environment_key, name, created_by, created_at, updated_at
                ) VALUES (
                    :id, 'catalog-migration', 'Synthetic catalog workspace',
                    'test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """), {'id': workspace_id})
            connection.execute(text("""
                INSERT INTO workspace_dashboard_configs (
                    id, workspace_id, payload_version, payload, config_revision,
                    updated_by, created_at, updated_at
                ) VALUES (
                    :id, :workspace_id, 1, '{"board":{"boardId":"17"}}', 4,
                    :user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """), {
                'id': dashboard_id, 'workspace_id': workspace_id, 'user_id': user_id,
            })
            connection.execute(text("""
                INSERT INTO workspace_team_catalogs (
                    id, workspace_id, payload_version, payload, config_revision,
                    updated_by, created_at, updated_at
                ) VALUES (
                    :id, :workspace_id, 1,
                    '{"catalog":{"team-synthetic":{"name":"Synthetic"}}}', 2,
                    :user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            """), {
                'id': directory_id, 'workspace_id': workspace_id, 'user_id': user_id,
            })

        command.upgrade(config, REVISION)
        inspector = inspect(self.engine)
        sprint_name = 'workspace_sprint_catalogs'
        team_name = 'workspace_sprint_team_catalogs'
        expected_common = {
            'id', 'workspace_id', 'payload_version', 'updated_by', 'created_at',
            'updated_at', 'validated_at', 'catalog_version', 'refresh_attempt_id',
            'attempt_identity', 'attempt_config_digest', 'attempt_deadline_at',
            'refresh_status', 'failure_code', 'last_failure_at', 'retry_at',
            'refresh_lease_owner', 'refresh_lease_until',
        }
        self.assertEqual(
            {column['name'] for column in inspector.get_columns(sprint_name)},
            expected_common | {'board_id', 'sprints', 'next_refresh_at'},
        )
        self.assertEqual(
            {column['name'] for column in inspector.get_columns(team_name)},
            expected_common | {
                'sprint_id', 'sprint_name', 'scope_digest', 'teams',
                'attempt_scope_digest',
            },
        )

        for table_name, identity_column, payload_column, expected_checks in (
            (sprint_name, 'board_id', 'sprints', {
                'ck_workspace_sprint_catalogs_positive_identity',
                'ck_workspace_sprint_catalogs_refresh_status',
                'ck_workspace_sprint_catalogs_failure_code',
                'ck_workspace_sprint_catalogs_validation_version',
                'ck_workspace_sprint_catalogs_lease_pair',
                'ck_workspace_sprint_catalogs_attempt_group',
                'ck_workspace_sprint_catalogs_state_metadata',
            }),
            (team_name, 'sprint_id', 'teams', {
                'ck_workspace_sprint_team_catalogs_positive_identity',
                'ck_workspace_sprint_team_catalogs_refresh_status',
                'ck_workspace_sprint_team_catalogs_failure_code',
                'ck_workspace_sprint_team_catalogs_validation_version',
                'ck_workspace_sprint_team_catalogs_lease_pair',
                'ck_workspace_sprint_team_catalogs_attempt_group',
                'ck_workspace_sprint_team_catalogs_state_metadata',
                'ck_workspace_sprint_team_catalogs_validated_scope',
            }),
        ):
            columns = {column['name']: column for column in inspector.get_columns(table_name)}
            self.assertEqual(str(columns['id']['type']).upper(), 'UUID')
            self.assertEqual(
                inspector.get_pk_constraint(table_name)['constrained_columns'], ['id'],
            )
            for uuid_column in (
                'catalog_version', 'refresh_attempt_id', 'refresh_lease_owner',
            ):
                self.assertEqual(str(columns[uuid_column]['type']).upper(), 'UUID')
            self.assertEqual(str(columns['payload_version']['default']).strip("'\"").split('::')[0], '1')
            self.assertIn('[]', str(columns[payload_column]['default']))
            self.assertIn('idle', str(columns['refresh_status']['default']))
            self.assertIsNotNone(columns['created_at']['default'])
            self.assertIsNotNone(columns['updated_at']['default'])
            self.assertTrue(columns['created_at']['type'].timezone)
            self.assertTrue(columns['updated_at']['type'].timezone)
            required_columns = {
                'id', 'workspace_id', identity_column, 'payload_version',
                payload_column, 'created_at', 'updated_at', 'refresh_status',
            }
            if table_name == team_name:
                required_columns.add('sprint_name')
            self.assertEqual(
                {name for name, column in columns.items() if not column['nullable']},
                required_columns,
            )
            foreign_keys = {
                tuple(item['constrained_columns']): (
                    item['referred_table'], item['options'].get('ondelete')
                )
                for item in inspector.get_foreign_keys(table_name)
            }
            self.assertEqual(foreign_keys, {
                ('workspace_id',): ('workspaces', 'CASCADE'),
                ('updated_by',): ('users', 'SET NULL'),
            })
            unique_sets = {
                frozenset(item['column_names'])
                for item in inspector.get_unique_constraints(table_name)
            }
            self.assertEqual(unique_sets, {frozenset({'workspace_id', identity_column})})
            self.assertFalse(any('updated_by' in columns for columns in unique_sets))
            indexes = {
                item['name']: tuple(item['column_names'])
                for item in inspector.get_indexes(table_name)
                if not item.get('duplicates_constraint')
            }
            self.assertEqual(indexes, {
                f'ix_{table_name}_attempt_deadline': ('workspace_id', 'attempt_deadline_at'),
                f'ix_{table_name}_lease_until': ('workspace_id', 'refresh_lease_until'),
            })
            checks = inspector.get_check_constraints(table_name)
            self.assertEqual({item['name'] for item in checks}, expected_checks)
            all_check_sql = ' '.join(item['sqltext'] for item in checks)
            for failure_code in (
                'refresh_budget_exhausted', 'catalog_refresh_lock_timeout',
                'oauth_refresh_timeout', 'jira_unavailable', 'catalog_incomplete',
                'catalog_identity_changed', 'auth_required',
                'catalog_runtime_unavailable',
            ):
                self.assertIn(failure_code, all_check_sql)

        with self.engine.connect() as connection:
            migrated_sprint_count = connection.execute(text(
                'SELECT count(*) FROM workspace_sprint_catalogs'
            )).scalar_one()
            migrated_membership_count = connection.execute(text(
                'SELECT count(*) FROM workspace_sprint_team_catalogs'
            )).scalar_one()
        self.assertEqual(migrated_sprint_count, 0)
        self.assertEqual(migrated_membership_count, 0)

        sprint_table = self._reflect(sprint_name)
        team_table = self._reflect(team_name)
        now = datetime.now(timezone.utc)
        identity_number = 100

        def row_for(table, status='idle', *, validated=False):
            nonlocal identity_number
            identity_number += 1
            team = table.name == team_name
            row = {
                'id': uuid.uuid4(),
                'workspace_id': workspace_id,
                'updated_by': user_id,
                'refresh_status': status,
                'sprint_id' if team else 'board_id': str(identity_number),
            }
            if team:
                row['sprint_name'] = f'Sprint {identity_number}'
            if validated:
                row.update(validated_at=now, catalog_version=uuid.uuid4())
                if team:
                    row['scope_digest'] = 'validated-scope'
            if status != 'idle':
                row.update(
                    refresh_attempt_id=uuid.uuid4(),
                    attempt_identity='attempt-identity',
                    attempt_config_digest='attempt-config',
                    attempt_deadline_at=now,
                )
                if team:
                    row['attempt_scope_digest'] = 'attempt-scope'
            if status == 'pending':
                row.update(refresh_lease_owner=uuid.uuid4(), refresh_lease_until=now)
            if status == 'failed':
                row.update(
                    failure_code='jira_unavailable',
                    last_failure_at=now,
                    retry_at=now,
                )
            return row

        for table in (sprint_table, team_table):
            for status in ('idle', 'pending', 'completed', 'failed'):
                with self.engine.begin() as connection:
                    connection.execute(table.insert(), row_for(table, status))
            with self.engine.begin() as connection:
                connection.execute(table.insert(), row_for(table, validated=True))
            with self.engine.connect() as connection:
                default_row = connection.execute(
                    table.select().order_by(table.c.created_at).limit(1)
                ).mappings().one()
            self.assertEqual(default_row['payload_version'], 1)
            self.assertEqual(default_row['teams' if table is team_table else 'sprints'], [])

            identity_key = 'sprint_id' if table is team_table else 'board_id'
            for invalid_identity in ('', '0', '-1', '1.5', 'abc', '01'):
                invalid = row_for(table)
                invalid[identity_key] = invalid_identity
                self._insert_rejected(table, invalid)
            invalid = row_for(table)
            invalid['refresh_status'] = 'unknown'
            self._insert_rejected(table, invalid)
            invalid = row_for(table, 'failed')
            invalid['failure_code'] = 'unknown'
            self._insert_rejected(table, invalid)
            invalid = row_for(table)
            invalid['validated_at'] = now
            self._insert_rejected(table, invalid)
            invalid = row_for(table)
            invalid['catalog_version'] = uuid.uuid4()
            self._insert_rejected(table, invalid)
            if table is team_table:
                invalid = row_for(table, validated=True)
                invalid['scope_digest'] = None
                self._insert_rejected(table, invalid)

            metadata_values = {
                'refresh_attempt_id': uuid.uuid4(),
                'attempt_identity': 'attempt-identity',
                'attempt_config_digest': 'attempt-config',
                'attempt_deadline_at': now,
                'refresh_lease_owner': uuid.uuid4(),
                'refresh_lease_until': now,
                'failure_code': 'jira_unavailable',
                'last_failure_at': now,
                'retry_at': now,
            }
            if table is team_table:
                metadata_values['attempt_scope_digest'] = 'attempt-scope'
            attempt_keys = [
                'refresh_attempt_id', 'attempt_identity', 'attempt_config_digest',
                'attempt_deadline_at',
            ]
            if table is team_table:
                attempt_keys.append('attempt_scope_digest')
            attempt_group = {key: metadata_values[key] for key in attempt_keys}
            lease_group = {
                key: metadata_values[key]
                for key in ('refresh_lease_owner', 'refresh_lease_until')
            }
            failure_group = {
                key: metadata_values[key]
                for key in ('failure_code', 'last_failure_at', 'retry_at')
            }
            status_group_matrix = [
                ('idle_with_full_attempt', 'idle', attempt_group),
                ('idle_with_full_lease', 'idle', lease_group),
                ('pending_without_attempt', 'pending', lease_group),
                ('completed_without_attempt', 'completed', {}),
                ('failed_without_attempt', 'failed', failure_group),
                ('pending_without_lease', 'pending', attempt_group),
                ('completed_with_full_lease', 'completed', {
                    **attempt_group, **lease_group,
                }),
                ('failed_with_full_lease', 'failed', {
                    **attempt_group, **failure_group, **lease_group,
                }),
                ('idle_with_full_failure', 'idle', failure_group),
                ('pending_with_full_failure', 'pending', {
                    **attempt_group, **lease_group, **failure_group,
                }),
                ('completed_with_full_failure', 'completed', {
                    **attempt_group, **failure_group,
                }),
                ('failed_without_failure', 'failed', attempt_group),
            ]
            for case, status, groups in status_group_matrix:
                invalid = row_for(table)
                invalid.update(refresh_status=status, **groups)
                with self.subTest(table=table.name, case=case):
                    self._insert_rejected(table, invalid)

            for key, value in metadata_values.items():
                invalid = row_for(table)
                invalid[key] = value
                self._insert_rejected(table, invalid)

            for status in ('pending', 'completed', 'failed'):
                for key in attempt_keys:
                    invalid = row_for(table, status)
                    invalid[key] = None
                    self._insert_rejected(table, invalid)
            for key in ('refresh_lease_owner', 'refresh_lease_until'):
                invalid = row_for(table, 'pending')
                invalid[key] = None
                self._insert_rejected(table, invalid)
            for key in ('failure_code', 'last_failure_at', 'retry_at'):
                invalid = row_for(table, 'pending')
                invalid[key] = metadata_values[key]
                self._insert_rejected(table, invalid)
                invalid = row_for(table, 'completed')
                invalid[key] = metadata_values[key]
                self._insert_rejected(table, invalid)
                invalid = row_for(table, 'failed')
                invalid[key] = None
                self._insert_rejected(table, invalid)
            for status in ('completed', 'failed'):
                for key in ('refresh_lease_owner', 'refresh_lease_until'):
                    invalid = row_for(table, status)
                    invalid[key] = metadata_values[key]
                    self._insert_rejected(table, invalid)

        command.downgrade(config, PRIOR_REVISION)
        inspector = inspect(self.engine)
        tables = set(inspector.get_table_names())
        self.assertNotIn(sprint_name, tables)
        self.assertNotIn(team_name, tables)
        with self.engine.connect() as connection:
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM workspace_dashboard_configs WHERE id = :id'
            ), {'id': dashboard_id}).scalar_one(), 1)
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM workspace_team_catalogs WHERE id = :id'
            ), {'id': directory_id}).scalar_one(), 1)
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM users WHERE id = :id'
            ), {'id': user_id}).scalar_one(), 1)

        command.upgrade(config, REVISION)
        inspector = inspect(self.engine)
        self.assertIn(sprint_name, inspector.get_table_names())
        self.assertIn(team_name, inspector.get_table_names())
        with self.engine.connect() as connection:
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM workspace_sprint_catalogs'
            )).scalar_one(), 0)
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM workspace_sprint_team_catalogs'
            )).scalar_one(), 0)
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM workspace_dashboard_configs WHERE id = :id'
            ), {'id': dashboard_id}).scalar_one(), 1)
            self.assertEqual(connection.execute(text(
                'SELECT count(*) FROM workspace_team_catalogs WHERE id = :id'
            ), {'id': directory_id}).scalar_one(), 1)


if __name__ == '__main__':
    unittest.main()
