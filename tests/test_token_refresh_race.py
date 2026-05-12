import base64
import os
import tempfile
import threading
import time
import unittest
import uuid
from urllib.parse import quote

from sqlalchemy import text
from sqlalchemy.engine import make_url

from backend.auth.db_tokens import (
    db_oauth_session_data,
    refresh_db_oauth_token,
    store_oauth_callback_tokens,
)
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthConfig
from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import decrypt_token
from backend.db import engine as db_engine
from backend.db import models


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _key_provider():
    return key_provider_from_env({
        'APP_ENVIRONMENT_KEY': 'local',
        'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([11]) * 32).decode('ascii'),
        'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
    })


def _auth_config():
    return AuthConfig(
        auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
        jira_url='https://example.atlassian.net',
        client_id='client-123',
        client_secret='secret-123',
    )


class TokenRefreshRaceTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'refresh.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = _key_provider()
        with self.factory() as session:
            stored = store_oauth_callback_tokens(
                session,
                token_data={
                    'access_token': 'old-access',
                    'refresh_token': 'old-refresh',
                    'expires_in': 1,
                    'scope': 'read:me offline_access',
                },
                resource={
                    'id': 'cloud-123',
                    'url': 'https://example.atlassian.net',
                    'name': 'Example',
                },
                user_profile={
                    'account_id': 'account-123',
                    'account_status': 'active',
                },
                environment_key='local',
                configured_jira_url='https://example.atlassian.net',
                key_provider=self.key_provider,
            )
            session.commit()
            self.connection_id = stored.connection_id
            self.workspace_id = stored.workspace_id

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def test_refresh_replaces_tokens_and_increments_token_version(self):
        calls = []

        def http_post(url, **kwargs):
            calls.append(kwargs['json']['refresh_token'])
            return FakeResponse(200, {
                'access_token': 'new-access',
                'refresh_token': 'new-refresh',
                'expires_in': 3600,
                'scope': 'read:me offline_access',
            })

        with self.factory() as session:
            refreshed = refresh_db_oauth_token(
                session,
                connection_id=self.connection_id,
                config=_auth_config(),
                key_provider=self.key_provider,
                http_post=http_post,
            )
            session.commit()

        self.assertEqual(calls, ['old-refresh'])
        self.assertEqual(refreshed['access_token'], 'new-access')
        self.assertEqual(refreshed['db_token_version'], '2')

        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            tokens = session.query(models.AuthToken).filter_by(connection_id=self.connection_id).all()
            decrypted = {
                token.token_kind: decrypt_token(
                    {
                        'algorithm': token.algorithm,
                        'ciphertext': token.ciphertext,
                        'nonce': token.nonce,
                        'wrapped_dek': token.wrapped_dek,
                        'key_id': token.key_id,
                        'aad_hash': token.aad_hash,
                    },
                    workspace_id=self.workspace_id,
                    auth_connection_id=self.connection_id,
                    token_kind=token.token_kind,
                    key_provider=self.key_provider,
                )
                for token in tokens
            }

        self.assertEqual(connection.token_version, 2)
        self.assertEqual(decrypted, {'access_token': 'new-access', 'refresh_token': 'new-refresh'})

    def test_db_oauth_session_data_refreshes_from_database_not_local_store(self):
        def http_post(url, **kwargs):
            return FakeResponse(200, {
                'access_token': 'db-access',
                'refresh_token': 'db-refresh',
                'expires_in': 3600,
                'scope': 'read:me offline_access',
            })

        from backend.auth.context import RequestAuthContext
        context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id='user-1',
            stable_subject='account-123',
            atlassian_account_id='account-123',
            workspace_id=self.workspace_id,
            auth_connection_id=self.connection_id,
            cloud_id='cloud-123',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )

        with self.factory() as session:
            data = db_oauth_session_data(
                session,
                context,
                config=_auth_config(),
                key_provider=self.key_provider,
                http_post=http_post,
            )
            session.commit()

        self.assertEqual(data['access_token'], 'db-access')
        self.assertEqual(data['db_token_version'], '2')
        self.assertNotIn('refresh_token', data)

    def test_locked_refresh_rechecks_fresh_token_before_rotating_again(self):
        def http_post(url, **kwargs):
            self.fail('fresh DB token should not be refreshed again')

        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            connection.expires_at = None
            session.commit()

        from backend.auth.context import RequestAuthContext
        context = RequestAuthContext(
            auth_mode='atlassian_oauth',
            user_id='user-1',
            stable_subject='account-123',
            atlassian_account_id='account-123',
            workspace_id=self.workspace_id,
            auth_connection_id=self.connection_id,
            cloud_id='cloud-123',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )

        with self.factory() as session:
            refreshed = refresh_db_oauth_token(
                session,
                connection_id=self.connection_id,
                config=_auth_config(),
                key_provider=self.key_provider,
                http_post=lambda *args, **kwargs: FakeResponse(200, {
                    'access_token': 'new-access',
                    'refresh_token': 'new-refresh',
                    'expires_in': 3600,
                    'scope': 'read:me offline_access',
                }),
            )
            session.commit()

        with self.factory() as session:
            data = db_oauth_session_data(
                session,
                context,
                config=_auth_config(),
                key_provider=self.key_provider,
                http_post=http_post,
            )

        self.assertEqual(refreshed['access_token'], 'new-access')
        self.assertEqual(data['access_token'], 'new-access')
        self.assertEqual(data['db_token_version'], '2')

    def test_sqlite_cannot_prove_refresh_race_locking(self):
        with self.assertRaisesRegex(db_engine.DatabaseConfigurationError, 'SQLite cannot prove'):
            db_engine.require_postgresql_refresh_locking(self.database_url)

    @unittest.skipUnless(
        os.getenv('TEST_DATABASE_URL') and make_url(os.getenv('TEST_DATABASE_URL')).get_backend_name() == 'postgresql',
        'PostgreSQL TEST_DATABASE_URL is required to prove concurrent refresh serialization.',
    )
    def test_concurrent_refresh_serializes_against_postgresql(self):
        base_url = os.getenv('TEST_DATABASE_URL')
        schema = f"jep_refresh_{uuid.uuid4().hex}"
        separator = '&' if '?' in base_url else '?'
        schema_url = f"{base_url}{separator}options={quote(f'-csearch_path={schema}', safe='')}"
        base_engine = db_engine.get_engine(base_url)
        with base_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        try:
            engine = db_engine.get_engine(schema_url)
            models.Base.metadata.create_all(engine)
            factory = db_engine.session_factory(schema_url)
            key_provider = _key_provider()
            with factory() as session:
                stored = store_oauth_callback_tokens(
                    session,
                    token_data={
                        'access_token': 'old-access',
                        'refresh_token': 'old-refresh',
                        'expires_in': 1,
                        'scope': 'read:me offline_access',
                    },
                    resource={
                        'id': 'cloud-123',
                        'url': 'https://example.atlassian.net',
                        'name': 'Example',
                    },
                    user_profile={
                        'account_id': 'account-123',
                        'account_status': 'active',
                    },
                    environment_key='local',
                    configured_jira_url='https://example.atlassian.net',
                    key_provider=key_provider,
                )
                session.commit()

            from backend.auth.context import RequestAuthContext
            context = RequestAuthContext(
                auth_mode='atlassian_oauth',
                user_id='user-1',
                stable_subject='account-123',
                atlassian_account_id='account-123',
                workspace_id=stored.workspace_id,
                auth_connection_id=stored.connection_id,
                cloud_id='cloud-123',
                site_url='https://example.atlassian.net',
                token_version='1',
                account_status='active',
                is_admin=False,
            )
            calls = []
            start_barrier = threading.Barrier(3)
            first_refresh_started = threading.Event()
            release_refresh = threading.Event()

            def http_post(url, **kwargs):
                calls.append(kwargs['json']['refresh_token'])
                first_refresh_started.set()
                release_refresh.wait(timeout=5)
                return FakeResponse(200, {
                    'access_token': 'new-access',
                    'refresh_token': 'new-refresh',
                    'expires_in': 3600,
                    'scope': 'read:me offline_access',
                })

            results = []
            errors = []

            def load_session_data():
                try:
                    start_barrier.wait(timeout=5)
                    with factory() as session:
                        data = db_oauth_session_data(
                            session,
                            context,
                            config=_auth_config(),
                            key_provider=key_provider,
                            http_post=http_post,
                        )
                        session.commit()
                        results.append(data)
                except Exception as exc:
                    errors.append(exc)

            threads = [threading.Thread(target=load_session_data) for _ in range(2)]
            for thread in threads:
                thread.start()
            start_barrier.wait(timeout=5)
            self.assertTrue(first_refresh_started.wait(timeout=5))
            time.sleep(0.2)
            release_refresh.set()
            for thread in threads:
                thread.join(timeout=10)

            self.assertFalse(any(thread.is_alive() for thread in threads))
            if errors:
                raise errors[0]
            self.assertEqual(calls, ['old-refresh'])
            self.assertEqual([result['access_token'] for result in results], ['new-access', 'new-access'])
            self.assertEqual([result['db_token_version'] for result in results], ['2', '2'])
        finally:
            with base_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


if __name__ == '__main__':
    unittest.main()
