import os
import tempfile
import unittest
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


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

    def test_initial_auth_migration_upgrades_downgrades_and_reruns(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'migration.db')}"
            config = self._config(database_url)

            command.upgrade(config, 'head')
            self.assertTrue(self._has_auth_tables(database_url))

            command.upgrade(config, 'head')
            self.assertTrue(self._has_auth_tables(database_url))

            command.downgrade(config, '-1')
            self.assertFalse(self._has_auth_tables(database_url))

            command.upgrade(config, 'head')
            self.assertTrue(self._has_auth_tables(database_url))

            command.downgrade(config, 'base')
            self.assertFalse(self._has_auth_tables(database_url))


if __name__ == '__main__':
    unittest.main()
