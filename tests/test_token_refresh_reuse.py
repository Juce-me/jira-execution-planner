import base64
import os
import tempfile
import unittest

from backend.auth.db_tokens import refresh_db_oauth_token, store_oauth_callback_tokens
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthConfig, AuthError
from backend.auth.key_provider import key_provider_from_env
from backend.db import engine as db_engine
from backend.db import models


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class TokenRefreshReuseTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'reuse.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([12]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })
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

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def test_refresh_reuse_revokes_connection_deletes_tokens_and_writes_audit(self):
        config = AuthConfig(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            jira_url='https://example.atlassian.net',
            client_id='client-123',
            client_secret='secret-123',
        )

        with self.factory() as session:
            with self.assertRaises(AuthError) as raised:
                refresh_db_oauth_token(
                    session,
                    connection_id=self.connection_id,
                    config=config,
                    key_provider=self.key_provider,
                    http_post=lambda *args, **kwargs: FakeResponse(400, {'error': 'invalid_grant'}),
                )
            session.commit()

        self.assertEqual(raised.exception.code, 'auth_connection_revoked')
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.connection_id)
            token_count = session.query(models.AuthToken).filter_by(connection_id=self.connection_id).count()
            audit_event = session.query(models.AuditEvent).filter_by(event_type='connection_revoked').one()

        self.assertEqual(connection.status, 'revoked')
        self.assertEqual(token_count, 0)
        self.assertEqual(audit_event.event_metadata['cause'], 'refresh_reuse_detected')
        self.assertNotIn('old-refresh', str(audit_event.event_metadata))


if __name__ == '__main__':
    unittest.main()
