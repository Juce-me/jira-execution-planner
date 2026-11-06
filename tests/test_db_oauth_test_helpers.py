import unittest

from backend.auth.token_crypto import decrypt_token
from backend.auth.db_browser_sessions import resolve_browser_session
from backend.db import engine as db_engine, models
from tests.db_oauth_test_helpers import seed_db_actor
from tests.postgres_test_db import fresh_database_url


class DbOAuthFixtureTests(unittest.TestCase):
    def setUp(self):
        # Empty per-test database; server/browser acceptance uses real Alembic migrations.
        self.engine = db_engine.create_database_engine(fresh_database_url(self.addCleanup))
        models.Base.metadata.create_all(self.engine)
        from sqlalchemy.orm import sessionmaker
        self.factory = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        self.workspace = {'cloud_id': 'fixture-cloud', 'site_url': 'https://example.atlassian.net',
                          'environment_key': 'local'}

    def test_encrypted_tokens_and_real_opaque_session(self):
        with self.factory() as db:
            actor = seed_db_actor(db, workspace=self.workspace, account_identity='fixture-a')
            db.commit()
            handle = resolve_browser_session(db, actor.browser_session_id)
            self.assertEqual(handle.user_id, actor.user_id)
            self.assertEqual(handle.workspace_id, actor.workspace_id)
            self.assertEqual(actor.session_payload, {'db_browser_session_id': handle.id})
            payload = actor.session_payload
            payload.clear()
            self.assertIn('db_browser_session_id', actor.session_payload)
            rows = db.query(models.AuthToken).filter_by(connection_id=actor.connection_id).all()
            self.assertEqual({row.token_kind for row in rows}, {'access_token', 'refresh_token'})
            for row in rows:
                self.assertNotIn('synthetic-access', row.ciphertext)
                plaintext = decrypt_token({name: getattr(row, name) for name in (
                    'algorithm', 'ciphertext', 'nonce', 'wrapped_dek', 'key_id', 'aad_hash',
                )}, key_provider=actor.key_provider,
                    workspace_id=actor.workspace_id, auth_connection_id=actor.connection_id,
                    token_kind=row.token_kind)
                self.assertIn('fixture-a', plaintext)
            self.assertEqual(db.get(models.User, actor.user_id).account_type, 'user')

    def test_existing_workspace_reused_and_roles_explicit(self):
        with self.factory() as db:
            a = seed_db_actor(db, workspace=self.workspace, account_identity='fixture-a')
            workspace = db.get(models.Workspace, a.workspace_id)
            b = seed_db_actor(db, workspace=workspace, account_identity={'account_id': 'fixture-b'}, roles=('admin',))
            self.assertEqual(a.workspace_id, b.workspace_id)
            self.assertNotEqual(a.user_id, b.user_id)
            self.assertNotEqual(a.browser_session_id, b.browser_session_id)
            self.assertEqual(db.get(models.User, b.user_id).account_type, 'admin')
            self.assertEqual(db.query(models.Workspace).count(), 1)

    def test_caller_can_rollback_and_invalid_roles_do_not_write(self):
        with self.factory() as db:
            with self.assertRaisesRegex(ValueError, 'Unknown fixture role'):
                seed_db_actor(db, workspace=self.workspace, account_identity='fixture-a', roles=('tenant-admin',))
            self.assertEqual(db.query(models.User).count(), 0)
            seed_db_actor(db, workspace=self.workspace, account_identity='fixture-a')
            db.rollback()
            self.assertEqual(db.query(models.User).count(), 0)

    def test_explicit_synthetic_token_data_preserves_provider_scope(self):
        with self.factory() as db:
            actor = seed_db_actor(db, workspace=self.workspace, account_identity='fixture-a',
                                  token_data={'access_token': 'synthetic-custom-access',
                                              'scope': 'read:me', 'expires_in': 120})
            connection = db.get(models.AuthConnection, actor.connection_id)
            self.assertEqual(connection.scopes, ['read:me'])
            self.assertEqual(connection.scope_provenance, 'provider')
            self.assertIsNotNone(connection.expires_at)


if __name__ == '__main__':
    unittest.main()
