"""Revision 20261028_0021 removes the user-owned Atlassian API token Home connection (operator decision).

All data is synthetic; ciphertext values are placeholders, never real tokens.
"""
import os
from pathlib import Path
import tempfile
import unittest

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.db import models

ROOT = Path(__file__).resolve().parents[1]
PARENT, HEAD = '20261023_0020', '20261028_0021'
TOKEN_PROVIDER = 'atlassian_user_api_token'
TOKEN_INDEX = 'uq_auth_connections_user_api_token_cloud'


def token_row(connection_id, kind='api_token'):
    return models.AuthToken(
        connection_id=connection_id, token_kind=kind, algorithm='AES-256-GCM', ciphertext='placeholder',
        nonce='n', wrapped_dek='w', key_id='k', aad_hash='a',
    )


class RemoveUserApiTokenMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='tests')
        self.url = 'sqlite+pysqlite:///' + str(Path(self.temp.name).resolve() / 'token.db')
        self.config = Config(str(ROOT / 'backend' / 'db' / 'alembic.ini'))
        self.config.set_main_option('sqlalchemy.url', self.url)
        self.config.set_main_option('script_location', str(ROOT / 'backend' / 'db' / 'migrations'))
        self.engine = create_engine(self.url, future=True)

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def seed(self):
        with Session(self.engine) as session:
            workspace = models.Workspace(environment_key='synthetic', name='ws')
            user = models.User(external_provider='atlassian', external_subject='subject-1')
            session.add_all([workspace, user])
            session.flush()
            keep = models.AuthConnection(
                user_id=user.id, workspace_id=workspace.id, provider='atlassian_oauth', cloud_id='cloud-1')
            drop = models.AuthConnection(
                user_id=user.id, workspace_id=workspace.id, provider=TOKEN_PROVIDER, cloud_id='cloud-1',
                credential_subject='user@example.com', capabilities=['home_townsquare_graphql'])
            session.add_all([keep, drop])
            session.flush()
            session.add_all([token_row(keep.id, 'access_token'), token_row(drop.id)])
            session.commit()
            return keep.id, drop.id

    def providers(self):
        with self.engine.connect() as connection:
            return sorted(row[0] for row in connection.execute(text('SELECT provider FROM auth_connections')))

    def token_count(self, connection_id):
        with self.engine.connect() as connection:
            return connection.execute(
                text('SELECT COUNT(*) FROM auth_tokens WHERE connection_id = :id'), {'id': connection_id}).scalar()

    def test_upgrade_deletes_only_token_connections_and_tightens_the_schema(self):
        command.upgrade(self.config, PARENT)
        keep_id, drop_id = self.seed()
        self.assertIn(TOKEN_INDEX, {i['name'] for i in inspect(self.engine).get_indexes('auth_connections')})

        command.upgrade(self.config, 'head')

        self.assertEqual(self.providers(), ['atlassian_oauth'])
        self.assertEqual(self.token_count(drop_id), 0)
        self.assertEqual(self.token_count(keep_id), 1)
        indexes = {i['name'] for i in inspect(self.engine).get_indexes('auth_connections')}
        self.assertNotIn(TOKEN_INDEX, indexes)
        self.assertTrue({'uq_auth_connections_current_cloud', 'uq_auth_connections_current_site'} <= indexes)
        with self.engine.connect() as connection:
            self.assertEqual(connection.execute(text('SELECT version_num FROM alembic_version')).scalar(), HEAD)
            sql = connection.execute(
                text("SELECT sql FROM sqlite_master WHERE name = 'auth_connections'")).scalar()
        self.assertNotIn(TOKEN_PROVIDER, sql)
        self.assertIn('ck_auth_connections_provider', sql)

    def test_provider_check_rejects_the_removed_provider_and_keeps_the_others(self):
        command.upgrade(self.config, 'head')
        with Session(self.engine) as session:
            workspace = models.Workspace(environment_key='synthetic', name='ws')
            user = models.User(external_provider='atlassian', external_subject='subject-1')
            session.add_all([workspace, user])
            session.flush()
            for provider in ('atlassian_oauth', 'jira_basic', 'confluence_oauth'):
                session.add(models.AuthConnection(user_id=user.id, workspace_id=workspace.id, provider=provider))
            session.commit()
            session.add(models.AuthConnection(user_id=user.id, workspace_id=workspace.id, provider=TOKEN_PROVIDER))
            with self.assertRaises(IntegrityError):
                session.commit()
            session.rollback()
            # The other partial unique index survived the table rebuild.
            session.add_all([
                models.AuthConnection(user_id=user.id, workspace_id=workspace.id, provider='atlassian_oauth',
                                      cloud_id='dup'),
                models.AuthConnection(user_id=user.id, workspace_id=workspace.id, provider='atlassian_oauth',
                                      cloud_id='dup'),
            ])
            with self.assertRaises(IntegrityError):
                session.commit()

    def test_head_schema_matches_the_models_for_the_auth_tables(self):
        command.upgrade(self.config, 'head')
        with self.engine.connect() as connection:
            diffs = compare_metadata(MigrationContext.configure(connection), models.Base.metadata)
        auth_diffs = [d for d in diffs if 'auth_connections' in repr(d) or 'auth_tokens' in repr(d)]
        self.assertEqual(auth_diffs, [])

    def test_downgrade_recreates_schema_only_and_never_tokens(self):
        command.upgrade(self.config, PARENT)
        self.seed()
        command.upgrade(self.config, 'head')
        command.downgrade(self.config, PARENT)
        self.assertEqual(self.providers(), ['atlassian_oauth'])
        self.assertIn(TOKEN_INDEX, {i['name'] for i in inspect(self.engine).get_indexes('auth_connections')})
        with self.engine.connect() as connection:
            sql = connection.execute(
                text("SELECT sql FROM sqlite_master WHERE name = 'auth_connections'")).scalar()
        self.assertIn(TOKEN_PROVIDER, sql)
        command.upgrade(self.config, 'head')
        self.assertEqual(self.providers(), ['atlassian_oauth'])

    def test_postgresql_offline_sql_drops_index_and_rewrites_the_check(self):
        import contextlib
        import io
        buffer = io.StringIO()
        self.config.set_main_option('sqlalchemy.url', 'postgresql+psycopg://user@localhost/offline')
        with contextlib.redirect_stdout(buffer):
            command.upgrade(self.config, f'{PARENT}:{HEAD}', sql=True)
        rendered = buffer.getvalue()
        self.assertIn(f'DROP INDEX {TOKEN_INDEX}', rendered)
        self.assertIn('DROP CONSTRAINT ck_auth_connections_provider', rendered)
        self.assertIn('ADD CONSTRAINT ck_auth_connections_provider', rendered)
        self.assertIn('DELETE FROM auth_tokens', rendered)
        self.assertIn('DELETE FROM auth_connections', rendered)


if __name__ == '__main__':
    unittest.main()
