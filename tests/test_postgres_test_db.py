"""Per-test PostgreSQL databases on the isolated runner's owned cluster."""

import os
import unittest
from unittest.mock import patch

from sqlalchemy import Column, Identity, Integer, MetaData, Table, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from backend.db import engine as db_engine, models
from tests import postgres_test_db as databases
from tests.postgres_test_db import (
    cleanup_model_templates, drop_database, fresh_database_url, fresh_model_database_url,
)


class FreshDatabaseTests(unittest.TestCase):
    def test_each_call_creates_an_empty_isolated_database_and_cleanup_drops_it(self):
        first = fresh_database_url(self.addCleanup)
        second = fresh_database_url()
        self.assertNotEqual(make_url(first).database, make_url(second).database)
        engine = create_engine(first, poolclass=NullPool)
        with engine.begin() as connection:
            self.assertEqual(connection.execute(text(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")).scalar(), 0)
            connection.execute(text('CREATE TABLE only_first (id int)'))
        engine.dispose()
        other = create_engine(second, poolclass=NullPool)
        with other.connect() as connection:
            self.assertIsNone(connection.execute(text("SELECT to_regclass('only_first')")).scalar())
        other.dispose()
        drop_database(second)
        with self.assertRaises(Exception):
            create_engine(second, poolclass=NullPool).connect()

    def test_only_per_test_databases_can_be_dropped(self):
        with self.assertRaises(RuntimeError):
            drop_database('postgresql+psycopg://user:pw@127.0.0.1:1/jep_runtime')

    def test_servers_other_than_the_owned_cluster_or_github_job_are_refused(self):
        for environment in ({'JEP_TEST_OWNED_CLUSTER': ''},
                            {'JEP_TEST_OWNED_CLUSTER': '', 'GITHUB_ACTIONS': 'true'},
                            {'JEP_ISOLATED_RUNTIME': ''}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment), \
                    self.assertRaisesRegex(RuntimeError, 'owned cluster'):
                fresh_database_url()
            with patch.dict(os.environ, environment), self.assertRaisesRegex(RuntimeError, 'owned cluster'):
                fresh_model_database_url()

    def test_sqlite_engines_are_rejected(self):
        for url in ('sqlite://', 'sqlite+pysqlite:///tmp/forbidden.db'):  # sqlite-refusal-check
            with self.subTest(url=url), self.assertRaises(db_engine.DatabaseConfigurationError):
                db_engine.create_database_engine(url)


class ModelDatabaseTests(unittest.TestCase):
    def setUp(self):
        cleanup_model_templates()
        self.addCleanup(cleanup_model_templates)

    def test_schema_built_once_clones_have_isolated_rows_and_template_cannot_be_mutated(self):
        with patch.object(models.Base.metadata, 'create_all', wraps=models.Base.metadata.create_all) as create_all:
            first = fresh_model_database_url(self.addCleanup)
            # Ordinary fixtures patch TEST_DATABASE_URL after creating their DB.
            with patch.dict(os.environ, {'TEST_DATABASE_URL': first}):
                second = fresh_model_database_url(self.addCleanup)
            self.assertEqual(create_all.call_count, 1)
        self.assertNotEqual(make_url(first).database, make_url(second).database)
        with db_engine.session_scope(first) as db:
            db.add(models.Workspace(environment_key='synthetic', name='First clone'))
        with db_engine.session_scope(second) as db:
            self.assertEqual(db.query(models.Workspace).count(), 0)
        template = next(iter(databases._MODEL_TEMPLATES.values()))
        engine = create_engine(template, poolclass=NullPool)
        try:
            with self.assertRaises(Exception):
                engine.connect()
        finally:
            engine.dispose()
        third = fresh_model_database_url(self.addCleanup)
        with db_engine.session_scope(third) as db:
            self.assertEqual(db.query(models.Workspace).count(), 0)

    def test_identity_sequence_starts_fresh_in_every_clone(self):
        metadata = MetaData()
        table = Table('synthetic_identity', metadata, Column('id', Integer, Identity(), primary_key=True))
        with patch.object(models.Base, 'metadata', metadata):
            first = fresh_model_database_url(self.addCleanup)
            second = fresh_model_database_url(self.addCleanup)
        for url in (first, second):
            engine = create_engine(url, poolclass=NullPool)
            try:
                with engine.begin() as connection:
                    self.assertEqual(connection.execute(table.insert().returning(table.c.id)).scalar_one(), 1)
            finally:
                engine.dispose()

    def test_template_cleanup_uses_captured_admin_after_environment_change(self):
        clone = fresh_model_database_url(self.addCleanup)
        template = next(iter(databases._MODEL_TEMPLATES.values()))
        with patch.dict(os.environ, {'TEST_DATABASE_URL': 'invalid database target'}):
            cleanup_model_templates()
        self.assertEqual(databases._MODEL_TEMPLATES, {})
        engine = create_engine(clone, poolclass=NullPool)
        try:
            with engine.connect() as connection:
                self.assertFalse(connection.execute(text(
                    'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = :name)'
                ), {'name': make_url(template).database}).scalar_one())
        finally:
            engine.dispose()


class ModelTemplateLifecycleTests(unittest.TestCase):
    """Failure paths use no database and never inherit a configured target."""

    def setUp(self):
        self.admin = make_url('postgresql+psycopg://synthetic:synthetic@127.0.0.1:1/postgres')
        self.patches = [
            patch.dict(databases.__dict__, {'_MODEL_TEMPLATES': {}}),
            patch.object(databases, '_admin_url', return_value=self.admin),
            patch.object(databases, '_execute_admin'),
            patch.object(databases, 'create_engine'),
            patch.object(models.Base.metadata, 'create_all'),
            patch.object(databases, 'drop_database'),
        ]
        _, _, self.execute_admin, self.create_engine, self.create_all, self.drop_database = (
            patcher.start() for patcher in self.patches
        )
        for patcher in self.patches:
            self.addCleanup(patcher.stop)

    def test_partial_template_failure_disposes_engine_drops_database_and_caches_nothing(self):
        self.create_all.side_effect = RuntimeError('synthetic DDL failure')
        with self.assertRaisesRegex(RuntimeError, 'DDL failure'):
            fresh_model_database_url()
        self.create_engine.return_value.dispose.assert_called_once_with()
        self.drop_database.assert_called_once()
        self.assertEqual(databases._MODEL_TEMPLATES, {})

    def test_partial_clone_failure_drops_generated_database_and_keeps_clean_template(self):
        def fail_clone(statement, admin):
            if ' TEMPLATE ' in statement:
                raise RuntimeError('synthetic clone failure')
        self.execute_admin.side_effect = fail_clone
        with self.assertRaisesRegex(RuntimeError, 'clone failure'):
            fresh_model_database_url()
        self.drop_database.assert_called_once()
        self.assertEqual(len(databases._MODEL_TEMPLATES), 1)
        dropped_url, captured_admin = self.drop_database.call_args.args
        self.assertNotEqual(dropped_url, next(iter(databases._MODEL_TEMPLATES.values())))
        self.assertEqual(captured_admin, self.admin)

    def test_cleanup_failure_propagates_retains_failed_entry_and_can_be_retried(self):
        fresh_model_database_url()
        self.drop_database.side_effect = RuntimeError('synthetic cleanup failure')
        with self.assertRaisesRegex(RuntimeError, 'cleanup failure'):
            cleanup_model_templates()
        self.assertEqual(len(databases._MODEL_TEMPLATES), 1)
        self.drop_database.side_effect = None
        cleanup_model_templates()
        self.assertEqual(databases._MODEL_TEMPLATES, {})

    def test_cleanup_never_drops_a_template_inherited_from_another_process(self):
        foreign = (os.getpid() + 1, self.admin, models.Base.metadata)
        databases._MODEL_TEMPLATES[foreign] = self.admin.set(database='jep_t_' + 'a' * 32).render_as_string(hide_password=False)
        cleanup_model_templates()
        self.drop_database.assert_not_called()
        self.assertIn(foreign, databases._MODEL_TEMPLATES)


if __name__ == '__main__':
    unittest.main()
