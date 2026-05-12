import os
import tempfile
import unittest

from sqlalchemy.exc import IntegrityError

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


if __name__ == '__main__':
    unittest.main()
