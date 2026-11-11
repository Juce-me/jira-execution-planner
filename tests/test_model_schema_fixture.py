"""Isolation contracts for ordinary model fixtures in an owned worker database.

These fixtures are not database-isolation evidence for migration or race tests.
PostgreSQL advisory locks remain database-scoped even when search_path differs.
"""

import io
import os
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.pool import NullPool

from backend.db import engine as db_engine, models
from tests import postgres_test_db as fixtures
from tests.runtime_test_runner import run_suite


class ModelSchemaFixtureTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(db_engine.dispose_engines)

    def schema_url(self):
        return fixtures.fresh_model_schema_url(self.addCleanup)

    def schema_name(self, url):
        with db_engine.get_engine(url).connect() as connection:
            return connection.execute(text('SELECT current_schema()')).scalar_one()

    def administrative_engine(self, url):
        # Capture the already-approved worker target; remove only its search path.
        engine = create_engine(make_url(url).set(query={}), poolclass=NullPool)
        self.addCleanup(engine.dispose)
        return engine

    def schema_exists(self, administrative_engine, schema):
        with administrative_engine.connect() as connection:
            return connection.execute(text(
                'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :schema)'),
                {'schema': schema}).scalar_one()

    def database_exists(self, administrative_engine, name):
        with administrative_engine.connect() as connection:
            return connection.execute(text(
                'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = :name)'),
                {'name': name}).scalar_one()

    def test_distinct_schema_urls_reuse_worker_database_and_keep_engine_caches_separate(self):
        first, second = self.schema_url(), self.schema_url()
        self.assertEqual(make_url(first).database, make_url(second).database)
        self.assertRegex(make_url(first).database, r'^jep_t_[0-9a-f]{32}$')
        self.assertNotEqual(make_url(first).query, make_url(second).query)
        first_schema, second_schema = self.schema_name(first), self.schema_name(second)
        self.assertRegex(first_schema, r'^model_case_[0-9a-f]{32}$')
        self.assertRegex(second_schema, r'^model_case_[0-9a-f]{32}$')
        self.assertNotEqual(first_schema, second_schema)
        self.assertIsNot(db_engine.get_engine(first), db_engine.get_engine(second))
        self.assertIsNot(db_engine.session_factory(first), db_engine.session_factory(second))
        expected = {table.name for table in models.Base.metadata.tables.values()}
        for url in (first, second):
            self.assertEqual(set(inspect(db_engine.get_engine(url)).get_table_names()), expected)
            self.assertEqual(inspect(db_engine.get_engine(url)).get_table_names(schema='public'), [])

    def test_two_users_and_reused_identity_keys_are_isolated_between_schemas(self):
        first, second = self.schema_url(), self.schema_url()
        with db_engine.session_scope(first) as db:
            db.add_all([
                models.User(id='user-one', external_provider='atlassian', external_subject='synthetic-one'),
                models.User(id='user-two', external_provider='atlassian', external_subject='synthetic-two'),
            ])
        with db_engine.session_scope(second) as db:
            self.assertEqual(db.query(models.User).count(), 0)
            db.add(models.User(id='user-one', external_provider='atlassian', external_subject='synthetic-one'))
        with db_engine.session_scope(first) as db:
            self.assertEqual(db.query(models.User).count(), 2)
        with db_engine.session_scope(second) as db:
            self.assertEqual(db.query(models.User).count(), 1)

    def test_foreign_keys_constraints_and_server_defaults_belong_to_each_schema(self):
        url = self.schema_url()
        schema = self.schema_name(url)
        expected_fks = sum(len(table.foreign_key_constraints) for table in models.Base.metadata.tables.values())
        expected_defaults = sum(column.server_default is not None
                                for table in models.Base.metadata.tables.values() for column in table.columns)
        with db_engine.get_engine(url).connect() as connection:
            references = connection.execute(text('''
                SELECT target_namespace.nspname
                FROM pg_constraint constraint_row
                JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
                JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
                JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
                JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
                WHERE source_namespace.nspname = :schema AND constraint_row.contype = 'f'
            '''), {'schema': schema}).scalars().all()
            self.assertEqual(len(references), expected_fks)
            self.assertTrue(references)
            self.assertEqual(set(references), {schema})
            default_count = connection.execute(text('''
                SELECT count(*) FROM pg_attrdef attribute_default
                JOIN pg_class table_row ON table_row.oid = attribute_default.adrelid
                JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
                WHERE namespace_row.nspname = :schema
            '''), {'schema': schema}).scalar_one()
            self.assertEqual(default_count, expected_defaults)
        with db_engine.session_scope(url) as db:
            db.add(models.Workspace(id='workspace-one', environment_key='synthetic', name='Synthetic workspace'))
            db.add(models.User(id='user-one', external_provider='atlassian', external_subject='synthetic-one'))
        for invalid in (
            models.User(id='duplicate-user', external_provider='atlassian', external_subject='synthetic-one'),
            models.User(external_provider='atlassian', external_subject='invalid-role', account_type='invalid'),
            models.ViewConfig(workspace_id='workspace-one', owner_user_id='missing-user',
                              name='Synthetic view', view_type='eng'),
        ):
            with self.subTest(model=invalid.__class__.__name__), self.assertRaises(IntegrityError):
                with db_engine.session_scope(url) as db:
                    db.add(invalid)

    def test_schema_local_identity_sequences_and_defaults_do_not_advance_siblings(self):
        first, second = self.schema_url(), self.schema_url()
        # Current model IDs are UUIDs. A real identity column independently verifies
        # sequence ownership/search_path instead of pretending UUIDs test sequences.
        for url in (first, second):
            with db_engine.get_engine(url).begin() as connection:
                connection.execute(text('CREATE TABLE fixture_sequence '
                                        '(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, value int DEFAULT 7)'))
                self.assertEqual(tuple(connection.execute(text(
                    'INSERT INTO fixture_sequence DEFAULT VALUES RETURNING id, value')).one()), (1, 7))
                sequence_schema = connection.execute(text('''
                    SELECT namespace_row.nspname FROM pg_class sequence_row
                    JOIN pg_namespace namespace_row ON namespace_row.oid = sequence_row.relnamespace
                    WHERE sequence_row.oid = pg_get_serial_sequence('fixture_sequence', 'id')::regclass
                ''')).scalar_one()
                self.assertEqual(sequence_schema, self.schema_name(url))
        with db_engine.get_engine(first).begin() as connection:
            self.assertEqual(connection.execute(text(
                'INSERT INTO fixture_sequence DEFAULT VALUES RETURNING id')).scalar_one(), 2)
        with db_engine.get_engine(second).connect() as connection:
            self.assertEqual(connection.execute(text('SELECT count(*) FROM fixture_sequence')).scalar_one(), 1)

    def test_nested_configuration_reuses_worker_without_inheriting_previous_search_path(self):
        first = self.schema_url()
        with patch.dict(os.environ, {'TEST_DATABASE_URL': first}):
            second = self.schema_url()
        self.assertEqual(make_url(first).database, make_url(second).database)
        self.assertNotEqual(self.schema_name(first), self.schema_name(second))
        self.assertIn('users', inspect(db_engine.get_engine(second)).get_table_names())

    def test_cleanup_uses_captured_target_after_configuration_changes(self):
        first, second = self.schema_url(), self.schema_url()
        schema = self.schema_name(first)
        administrative = self.administrative_engine(first)
        with patch.dict(os.environ, {'TEST_DATABASE_URL': 'postgresql+psycopg://synthetic:synthetic@127.0.0.1:1/unowned'}):
            fixtures.drop_model_schema(first)
        self.assertFalse(self.schema_exists(administrative, schema))
        self.assertIn('users', inspect(db_engine.get_engine(second)).get_table_names())
        fixtures.drop_model_schema(first)  # Registered cleanup must also remain idempotent.

    def test_foreign_schema_names_and_worker_databases_are_rejected_before_sql(self):
        url = make_url(self.schema_url())
        foreign_urls = [
            url.update_query_dict({'options': '-csearch_path=public'}),
            url.update_query_dict({'options': '-csearch_path=model_case_' + uuid.uuid4().hex}),
            url.set(database='postgres'),
        ]
        with patch.object(fixtures, 'create_engine', side_effect=AssertionError('foreign cleanup attempted a connection')):
            for foreign in foreign_urls:
                with self.subTest(kind=foreign.database), self.assertRaises(RuntimeError):
                    fixtures.drop_model_schema(foreign.render_as_string(hide_password=False))

    def test_foreign_process_cannot_drop_or_finalize_parent_fixtures(self):
        url = self.schema_url()
        schema = self.schema_name(url)
        administrative = self.administrative_engine(url)
        foreign_pid = os.getpid() + 100000
        with patch.object(fixtures.os, 'getpid', return_value=foreign_pid):
            with self.assertRaises(RuntimeError):
                fixtures.drop_model_schema(url)
            fixtures.cleanup_model_fixtures()
        self.assertTrue(self.schema_exists(administrative, schema))

    def test_redirect_and_credential_query_options_are_rejected_before_connection(self):
        admin = fixtures._admin_url()
        for query in (
            {'host': 'unowned.invalid'},
            {'service': 'synthetic-unapproved'},
            {'passfile': '/synthetic/unapproved'},
            {'options': '-csearch_path=public'},
        ):
            foreign = admin.set(query=query).render_as_string(hide_password=False)
            with self.subTest(option=next(iter(query))), \
                    patch.dict(os.environ, {'TEST_DATABASE_URL': foreign}), \
                    patch.object(fixtures, 'create_engine', side_effect=AssertionError('unapproved connection')), \
                    self.assertRaises(RuntimeError):
                fixtures.fresh_model_schema_url()

    def test_github_admits_only_exact_registered_schema_and_captured_ci_target(self):
        pid = os.getpid()
        admin = make_url(fixtures.GITHUB_CI_TARGET).update_query_dict({
            'connect_timeout': '5', 'options': '-clock_timeout=1000 -cstatement_timeout=5000',
        })
        worker = admin.set(database='jep_t_' + 'a' * 32).render_as_string(hide_password=False)
        schema = 'model_case_' + 'b' * 32
        schema_url = make_url(worker).difference_update_query(['connect_timeout']).update_query_dict(
            {'options': '-csearch_path=' + schema}).render_as_string(hide_password=False)
        environment = {'JEP_ISOLATED_RUNTIME': '', 'JEP_TEST_OWNED_CLUSTER': '',
                       'GITHUB_ACTIONS': 'true', 'TEST_DATABASE_URL': schema_url}
        with patch.dict(fixtures._MODEL_SCHEMA_DATABASES, {(pid, admin): worker}, clear=True), \
                patch.dict(fixtures._MODEL_SCHEMAS, {schema_url: (pid, worker, schema)}, clear=True), \
                patch.dict(os.environ, environment), \
                patch.object(fixtures, 'create_engine', side_effect=AssertionError('admission attempted SQL')):
            self.assertEqual(fixtures._admin_url(), make_url(fixtures.GITHUB_CI_TARGET))
            for foreign in (
                make_url(schema_url).update_query_dict({'options': '-csearch_path=model_case_' + 'c' * 32}),
                make_url(schema_url).set(database='jep_t_' + 'd' * 32),
            ):
                with patch.dict(os.environ, {'TEST_DATABASE_URL': foreign.render_as_string(hide_password=False)}), \
                        self.assertRaises(RuntimeError):
                    fixtures._admin_url()
            with patch.dict(os.environ, {'GITHUB_ACTIONS': ''}), self.assertRaises(RuntimeError):
                fixtures._admin_url()
            with patch.dict(fixtures._MODEL_SCHEMA_DATABASES, {}, clear=True), self.assertRaises(RuntimeError):
                fixtures._admin_url()

    def test_active_transaction_cleanup_fails_visibly_then_succeeds_after_release(self):
        url = self.schema_url()
        schema = self.schema_name(url)
        administrative = self.administrative_engine(url)
        engine = create_engine(url, poolclass=NullPool)
        self.addCleanup(engine.dispose)
        connection = engine.connect()
        try:
            transaction = connection.begin()
            connection.execute(text('SELECT count(*) FROM users'))
            with self.assertRaises(DBAPIError) as failure:
                fixtures.drop_model_schema(url)
            self.assertIn(getattr(failure.exception.orig, 'sqlstate', None), {'55P03', '57014'})
            self.assertTrue(self.schema_exists(administrative, schema))
            transaction.rollback()
        finally:
            connection.close()
        fixtures.drop_model_schema(url)
        self.assertFalse(self.schema_exists(administrative, schema))

    def test_schema_setup_failure_removes_partial_ddl_and_keeps_existing_fixture(self):
        existing = self.schema_url()
        administrative = self.administrative_engine(existing)

        def names():
            with administrative.connect() as connection:
                return set(connection.execute(text(
                    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'model_case_%'")).scalars())

        before = names()

        def create_then_fail(bind, **_kwargs):
            if isinstance(bind, Engine):
                with bind.begin() as connection:
                    connection.execute(text('CREATE TABLE partially_created_fixture (id integer)'))
            else:
                bind.execute(text('CREATE TABLE partially_created_fixture (id integer)'))
            raise RuntimeError('synthetic model initialization failure')

        with patch.object(models.Base.metadata, 'create_all', side_effect=create_then_fail), \
                self.assertRaisesRegex(RuntimeError, 'synthetic model initialization failure'):
            fixtures.fresh_model_schema_url()
        self.assertEqual(names(), before)
        self.assertIn('users', inspect(db_engine.get_engine(existing)).get_table_names())

    def test_idle_advisory_lock_connection_cannot_survive_schema_cleanup_silently(self):
        url = self.schema_url()
        engine = create_engine(url, isolation_level='AUTOCOMMIT', poolclass=NullPool)
        self.addCleanup(engine.dispose)
        connection = engine.connect()
        key = uuid.uuid4().int % (2 ** 63)
        try:
            connection.execute(text('SELECT pg_advisory_lock(:key)'), {'key': key})
            with self.assertRaisesRegex(RuntimeError, 'active fixture connections'):
                fixtures.drop_model_schema(url)
            # Per-case cleanup must fail visibly without killing the connection
            # or releasing its database-scoped advisory lock behind the caller.
            self.assertTrue(connection.execute(text('SELECT pg_advisory_unlock(:key)'),
                                               {'key': key}).scalar_one())
        finally:
            connection.close()
        fixtures.drop_model_schema(url)

    def test_empty_and_clone_database_helpers_keep_their_original_contracts(self):
        schema_url = self.schema_url()
        with patch.dict(os.environ, {'TEST_DATABASE_URL': schema_url}):
            empty = fixtures.fresh_database_url(self.addCleanup)
            clone = fixtures.fresh_model_database_url(self.addCleanup)
        self.assertNotEqual(make_url(empty).database, make_url(schema_url).database)
        self.assertNotEqual(make_url(clone).database, make_url(schema_url).database)
        self.assertEqual(inspect(db_engine.get_engine(empty)).get_table_names(), [])
        self.assertEqual(self.schema_name(empty), 'public')
        self.assertEqual(self.schema_name(clone), 'public')
        self.assertIn('users', inspect(db_engine.get_engine(clone)).get_table_names())

    def test_comprehensive_cleanup_forces_owned_worker_drop_but_preserves_failure_verdict(self):
        url = self.schema_url()
        database = make_url(url).database
        admin = self.administrative_engine(fixtures._admin_url().set(database='postgres').render_as_string(hide_password=False))
        engine = create_engine(url, poolclass=NullPool)
        self.addCleanup(engine.dispose)
        connection = engine.connect()
        try:
            connection.execute(text('SELECT count(*) FROM users'))
            with self.assertRaises(DBAPIError):
                fixtures.cleanup_model_fixtures()
            self.assertFalse(self.database_exists(admin, database))
        finally:
            try:
                connection.close()
            except DBAPIError:
                pass  # FORCE database cleanup deliberately terminates this connection.

    def test_final_owned_database_drop_has_a_separate_bounded_checkpoint_budget(self):
        admin = make_url(fixtures.GITHUB_CI_TARGET).update_query_dict({
            'connect_timeout': '5', 'options': fixtures._SCHEMA_ADMIN_OPTIONS,
        })
        worker = admin.set(database='jep_t_' + 'e' * 32).render_as_string(hide_password=False)
        key = (os.getpid(), admin)
        with patch.dict(fixtures._MODEL_SCHEMA_DATABASES, {key: worker}, clear=True), \
                patch.dict(fixtures._MODEL_SCHEMAS, {}, clear=True), \
                patch.object(fixtures, 'cleanup_model_templates'), \
                patch.object(fixtures, 'drop_database') as drop:
            fixtures.cleanup_model_fixtures()
            dropped_worker, drop_admin = drop.call_args.args
            self.assertEqual(dropped_worker, worker)
            self.assertEqual(drop_admin.difference_update_query(['options']),
                             admin.difference_update_query(['options']))
            self.assertEqual(drop_admin.query['options'],
                             '-clock_timeout=1000 -cstatement_timeout=15000')
            self.assertEqual(admin.query['options'],
                             '-clock_timeout=1000 -cstatement_timeout=5000')
            self.assertNotIn(key, fixtures._MODEL_SCHEMA_DATABASES)

    def test_runner_drops_worker_database_before_reporting_success(self):
        url = self.schema_url()
        database = make_url(url).database
        admin = self.administrative_engine(fixtures._admin_url().set(database='postgres').render_as_string(hide_password=False))
        events = []

        class Sample(unittest.TestCase):
            def test_work(self):
                events.append('test')

        def cleanup():
            fixtures.cleanup_model_fixtures()
            events.append('cleanup')

        helper = SimpleNamespace(cleanup_model_fixtures=cleanup)
        status = run_suite(unittest.defaultTestLoader.loadTestsFromTestCase(Sample), stream=io.StringIO(),
                           modules={'tests.postgres_test_db': helper})
        self.assertEqual(status, 0)
        self.assertEqual(events, ['test', 'cleanup'])
        self.assertFalse(self.database_exists(admin, database))


if __name__ == '__main__':
    unittest.main()
