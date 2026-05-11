import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
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


class ViewConfigMigrationTests(unittest.TestCase):
    def test_user_config_migration_adds_tables_and_default_constraint(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_url = f"sqlite+pysqlite:///{os.path.join(tmpdir, 'view-config-migration.db')}"
            config = migration_config(database_url)

            command.upgrade(config, '20260511_0002')
            engine = create_engine(database_url, future=True)
            try:
                self.assertNotIn('view_configs', inspect(engine).get_table_names())
            finally:
                engine.dispose()

            command.upgrade(config, 'head')
            engine = create_engine(database_url, future=True)
            try:
                inspector = inspect(engine)
                tables = set(inspector.get_table_names())
                self.assertIn('view_configs', tables)
                self.assertIn('view_config_versions', tables)
                view_columns = {column['name'] for column in inspector.get_columns('view_configs')}
                version_columns = {column['name'] for column in inspector.get_columns('view_config_versions')}
                indexes = {index['name']: index for index in inspector.get_indexes('view_configs')}
                self.assertTrue({
                    'workspace_id',
                    'owner_user_id',
                    'view_type',
                    'payload',
                    'is_default',
                    'source_path',
                    'source_hash',
                    'archived_at',
                }.issubset(view_columns))
                self.assertTrue({'view_config_id', 'version_number', 'payload', 'created_by'}.issubset(version_columns))
                self.assertIn('uq_view_configs_active_default', indexes)
                self.assertTrue(indexes['uq_view_configs_active_default']['unique'])

                with engine.begin() as connection:
                    connection.execute(text(
                        "insert into users (id, external_provider, external_subject, account_type, status, created_by, created_at, updated_at) "
                        "values ('user-1', 'atlassian', 'account-1', 'user', 'active', 'test', '2026-05-11', '2026-05-11')"
                    ))
                    connection.execute(text(
                        "insert into workspaces (id, environment_key, name, jira_site_url, jira_cloud_id, created_by, created_at, updated_at) "
                        "values ('workspace-1', 'local', 'Local', 'https://example.atlassian.net', 'cloud-1', 'test', '2026-05-11', '2026-05-11')"
                    ))
                    connection.execute(text(
                        "insert into view_configs (id, workspace_id, owner_user_id, name, view_type, mode_policy, payload_version, payload, visibility, is_default, created_at, updated_at) "
                        "values ('view-1', 'workspace-1', 'user-1', 'Default', 'epm', 'configuration', 1, '{}', 'private', 1, '2026-05-11', '2026-05-11')"
                    ))
                    with self.assertRaises(IntegrityError):
                        connection.execute(text(
                            "insert into view_configs (id, workspace_id, owner_user_id, name, view_type, mode_policy, payload_version, payload, visibility, is_default, created_at, updated_at) "
                            "values ('view-2', 'workspace-1', 'user-1', 'Duplicate', 'eng', 'configuration', 1, '{}', 'private', 1, '2026-05-11', '2026-05-11')"
                        ))
            finally:
                engine.dispose()

            command.downgrade(config, '-1')
            engine = create_engine(database_url, future=True)
            try:
                tables = set(inspect(engine).get_table_names())
                self.assertNotIn('view_configs', tables)
                self.assertNotIn('view_config_versions', tables)
                self.assertIn('auth_connections', tables)
            finally:
                engine.dispose()


class ViewConfigModelTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'view-configs.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_user_workspace(self):
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
            other_workspace = models.Workspace(
                environment_key='local',
                name='Other',
                jira_site_url='https://other.atlassian.net',
                jira_cloud_id='cloud-2',
                created_by='test',
            )
            session.add_all([user, other_user, workspace, other_workspace])
            session.commit()
            return user.id, other_user.id, workspace.id, other_workspace.id

    def test_default_view_constraint_is_scoped_by_owner_and_workspace(self):
        user_id, other_user_id, workspace_id, other_workspace_id = self._seed_user_workspace()
        with self.factory() as session:
            session.add_all([
                models.ViewConfig(
                    workspace_id=workspace_id,
                    owner_user_id=user_id,
                    name='Default',
                    view_type='epm',
                    payload={'epm': {'tab': 'active'}},
                    is_default=True,
                ),
                models.ViewConfig(
                    workspace_id=workspace_id,
                    owner_user_id=other_user_id,
                    name='Other user default',
                    view_type='eng',
                    payload={'eng': {'mode': 'planning'}},
                    is_default=True,
                ),
                models.ViewConfig(
                    workspace_id=other_workspace_id,
                    owner_user_id=user_id,
                    name='Other workspace default',
                    view_type='mixed',
                    payload={'filters': {}},
                    is_default=True,
                ),
            ])
            session.commit()

        with self.factory() as session:
            session.add(models.ViewConfig(
                workspace_id=workspace_id,
                owner_user_id=user_id,
                name='Duplicate default',
                view_type='eng',
                payload={'eng': {}},
                is_default=True,
            ))
            with self.assertRaises(IntegrityError):
                session.commit()

        with self.factory() as session:
            existing = session.query(models.ViewConfig).filter_by(
                workspace_id=workspace_id,
                owner_user_id=user_id,
                is_default=True,
            ).one()
            existing.archived_at = datetime.now(timezone.utc)
            session.add(models.ViewConfig(
                workspace_id=workspace_id,
                owner_user_id=user_id,
                name='Replacement default',
                view_type='eng',
                payload={'eng': {}},
                is_default=True,
            ))
            session.commit()

    def test_view_config_crud_archive_and_version_snapshots(self):
        user_id, _, workspace_id, _ = self._seed_user_workspace()
        first_payload = {'epm': {'tab': 'active', 'selectedSprint': 'Active'}}
        second_payload = {'epm': {'tab': 'backlog', 'selectedSprint': 'Future'}}
        with self.factory() as session:
            view = models.ViewConfig(
                workspace_id=workspace_id,
                owner_user_id=user_id,
                name='EPM view',
                view_type='epm',
                payload_version=1,
                payload=first_payload,
                is_default=True,
                source_path='dashboard-config.json',
                source_hash='abc123',
            )
            session.add(view)
            session.flush()
            session.add(models.ViewConfigVersion(
                view_config_id=view.id,
                version_number=1,
                payload=dict(first_payload),
                created_by=user_id,
                change_note='initial import',
            ))
            session.commit()
            view_id = view.id

        with self.factory() as session:
            view = session.get(models.ViewConfig, view_id)
            view.name = 'Renamed EPM view'
            view.payload = second_payload
            view.archived_at = datetime.now(timezone.utc)
            session.add(models.ViewConfigVersion(
                view_config_id=view.id,
                version_number=2,
                payload=dict(second_payload),
                created_by=user_id,
                change_note='user update',
            ))
            session.commit()

        with self.factory() as session:
            view = session.get(models.ViewConfig, view_id)
            versions = session.query(models.ViewConfigVersion).filter_by(
                view_config_id=view_id,
            ).order_by(models.ViewConfigVersion.version_number).all()

            self.assertEqual(view.name, 'Renamed EPM view')
            self.assertEqual(view.payload, second_payload)
            self.assertIsNotNone(view.archived_at)
            self.assertEqual([version.version_number for version in versions], [1, 2])
            self.assertEqual(versions[0].payload, first_payload)
            self.assertEqual(versions[1].payload, second_payload)


if __name__ == '__main__':
    unittest.main()
