import os
import tempfile
import unittest
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError

from backend.db import engine as db_engine
from backend.db import models


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'


def migration_config(database_url):
    config = Config(str(ALEMBIC_INI))
    config.set_main_option('sqlalchemy.url', database_url)
    config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
    return config


class SharedGroupConfigMigrationTests(unittest.TestCase):
    def test_shared_group_migration_adds_catalog_and_preference_tables(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'shared-groups-migration.db')}"
            config = migration_config(database_url)

            command.upgrade(config, '20260514_0005')
            engine = create_engine(database_url, future=True)
            try:
                tables = set(inspect(engine).get_table_names())
                self.assertNotIn('workspace_group_configs', tables)
                self.assertNotIn('user_group_preferences', tables)
            finally:
                engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                tables = set(inspector.get_table_names())
                self.assertIn('workspace_group_configs', tables)
                self.assertIn('user_group_preferences', tables)

                catalog_columns = {
                    column['name']
                    for column in inspector.get_columns('workspace_group_configs')
                }
                preference_columns = {
                    column['name']
                    for column in inspector.get_columns('user_group_preferences')
                }
                catalog_uniques = {
                    constraint['name']
                    for constraint in inspector.get_unique_constraints('workspace_group_configs')
                }
                preference_uniques = {
                    constraint['name']
                    for constraint in inspector.get_unique_constraints('user_group_preferences')
                }
                preference_indexes = {
                    index['name']
                    for index in inspector.get_indexes('user_group_preferences')
                }

                self.assertTrue({
                    'workspace_id',
                    'payload_version',
                    'payload',
                    'config_revision',
                    'created_by',
                    'updated_by',
                    'created_at',
                    'updated_at',
                }.issubset(catalog_columns))
                self.assertTrue({
                    'workspace_id',
                    'user_id',
                    'payload_version',
                    'visible_group_ids',
                    'active_group_id',
                    'customized',
                    'created_at',
                    'updated_at',
                }.issubset(preference_columns))
                self.assertIn('uq_workspace_group_configs_workspace', catalog_uniques)
                self.assertIn('uq_user_group_preferences_workspace_user', preference_uniques)
                self.assertIn('ix_user_group_preferences_user_workspace', preference_indexes)
            finally:
                engine.dispose()

            command.downgrade(config, '20260514_0005')
            engine = create_engine(database_url, future=True)
            try:
                tables = set(inspect(engine).get_table_names())
                self.assertNotIn('workspace_group_configs', tables)
                self.assertNotIn('user_group_preferences', tables)
                self.assertIn('scenario_draft_locks', tables)
            finally:
                engine.dispose()


class SharedGroupConfigModelTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'shared-groups.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.user_id, self.other_user_id, self.workspace_id = self._seed_users_workspace()

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_users_workspace(self):
        with self.factory() as session:
            user = models.User(
                external_provider='atlassian',
                external_subject='account-1',
                account_type='user',
                status='active',
                created_by='test',
            )
            other_user = models.User(
                external_provider='atlassian',
                external_subject='account-2',
                account_type='user',
                status='active',
                created_by='test',
            )
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            session.add_all([user, other_user, workspace])
            session.commit()
            return user.id, other_user.id, workspace.id

    def test_shared_group_catalog_is_unique_per_workspace(self):
        with self.factory() as session:
            session.add_all([
                models.WorkspaceGroupConfig(
                    workspace_id=self.workspace_id,
                    payload_version=1,
                    payload={'version': 1, 'groups': []},
                    config_revision=1,
                    created_by=self.user_id,
                    updated_by=self.user_id,
                ),
                models.WorkspaceGroupConfig(
                    workspace_id=self.workspace_id,
                    payload_version=1,
                    payload={'version': 1, 'groups': []},
                    config_revision=1,
                    created_by=self.user_id,
                    updated_by=self.user_id,
                ),
            ])
            with self.assertRaises(IntegrityError):
                session.commit()

    def test_user_group_preferences_are_unique_per_workspace_user(self):
        with self.factory() as session:
            session.add_all([
                models.UserGroupPreference(
                    workspace_id=self.workspace_id,
                    user_id=self.user_id,
                    payload_version=1,
                    visible_group_ids=['platform', 'mobile'],
                    active_group_id='platform',
                    customized=True,
                ),
                models.UserGroupPreference(
                    workspace_id=self.workspace_id,
                    user_id=self.user_id,
                    payload_version=1,
                    visible_group_ids=['mobile', 'platform'],
                    active_group_id='mobile',
                    customized=True,
                ),
                models.UserGroupPreference(
                    workspace_id=self.workspace_id,
                    user_id=self.other_user_id,
                    payload_version=1,
                    visible_group_ids=['platform'],
                    active_group_id='platform',
                    customized=True,
                ),
            ])
            with self.assertRaises(IntegrityError):
                session.commit()


if __name__ == '__main__':
    unittest.main()
