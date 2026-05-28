import os
import tempfile
import unittest
from pathlib import Path

from alembic import command
from alembic.config import Config

from backend.config.repository import (
    ConfigStorageError,
    selected_config_storage_backend,
    validate_config_storage_startup,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'


def migration_config(database_url):
    config = Config(str(ALEMBIC_INI))
    config.set_main_option('sqlalchemy.url', database_url)
    config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
    return config


class ConfigStorageSelectorTests(unittest.TestCase):
    def test_default_storage_backend_is_jsonfile(self):
        self.assertEqual(selected_config_storage_backend({}), 'jsonfile')

    def test_invalid_storage_backend_is_rejected(self):
        with self.assertRaises(ConfigStorageError):
            selected_config_storage_backend({'CONFIG_STORAGE_BACKEND': 'auto'})

    def test_db_storage_aliases_match_database_engine(self):
        for backend in ('db', 'database', 'postgres', 'postgresql'):
            with self.subTest(backend=backend):
                self.assertEqual(selected_config_storage_backend({'CONFIG_STORAGE_BACKEND': backend}), 'db')

    def test_db_storage_requires_database_url(self):
        with self.assertRaises(ConfigStorageError):
            validate_config_storage_startup({'CONFIG_STORAGE_BACKEND': 'db'})

    def test_db_storage_requires_migrations_at_head(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'config-storage.db')}"
            env = {'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': database_url}
            config = migration_config(database_url)

            command.upgrade(config, '20260511_0002')
            with self.assertRaises(ConfigStorageError):
                validate_config_storage_startup(env)

            command.upgrade(config, 'head')
            validate_config_storage_startup(env)


if __name__ == '__main__':
    unittest.main()
