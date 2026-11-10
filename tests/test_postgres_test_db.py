"""Per-test PostgreSQL databases on the isolated runner's owned cluster."""

import os
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from backend.db import engine as db_engine
from tests.postgres_test_db import drop_database, fresh_database_url


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

    def test_sqlite_engines_are_rejected(self):
        for url in ('sqlite://', 'sqlite+pysqlite:///tmp/forbidden.db'):  # sqlite-refusal-check
            with self.subTest(url=url), self.assertRaises(db_engine.DatabaseConfigurationError):
                db_engine.create_database_engine(url)


if __name__ == '__main__':
    unittest.main()
