import base64
import os
import tempfile
import unittest

from backend.auth.key_provider import key_provider_from_env
from backend.auth.service_integrations import (
    get_service_integration_summary,
    seed_service_integration,
)
from backend.auth.token_crypto import decrypt_token
from backend.db import engine as db_engine
from backend.db import models


class ServiceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'service-integrations.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([13]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Example',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-123',
                created_by='test',
            )
            admin = models.User(
                external_provider='atlassian',
                external_subject='admin-account',
                email='admin@example.com',
                display_name='Admin User',
                account_type='admin',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, admin])
            session.flush()
            self.workspace_id = workspace.id
            self.admin_id = admin.id
            session.commit()

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def test_seed_writes_service_token_without_user_auth_token_rows(self):
        with self.factory() as session:
            integration = seed_service_integration(
                session,
                workspace_id=self.workspace_id,
                provider='home_townsquare_basic',
                credential_subject='svc-home@example.com',
                api_token='service-token-123',
                actor_user_id=self.admin_id,
                key_provider=self.key_provider,
            )
            session.commit()

        with self.factory() as session:
            token = session.query(models.ServiceIntegrationToken).filter_by(
                service_integration_id=integration.id,
            ).one()
            auth_token_count = session.query(models.AuthToken).count()
            summary = get_service_integration_summary(session, integration.id)

        decrypted = decrypt_token(
            {
                'algorithm': token.algorithm,
                'ciphertext': token.ciphertext,
                'nonce': token.nonce,
                'wrapped_dek': token.wrapped_dek,
                'key_id': token.key_id,
                'aad_hash': token.aad_hash,
            },
            workspace_id=self.workspace_id,
            service_integration_id=integration.id,
            token_kind='api_token',
            key_provider=self.key_provider,
        )
        self.assertEqual(decrypted, 'service-token-123')
        self.assertEqual(auth_token_count, 0)
        self.assertEqual(summary['provider'], 'home_townsquare_basic')
        self.assertEqual(summary['credentialSubject'], 'svc-home@example.com')
        self.assertNotIn('apiToken', summary)
        self.assertNotIn('ciphertext', summary)

    def test_summary_cache_tracks_service_integration_token_version(self):
        with self.factory() as session:
            integration = seed_service_integration(
                session,
                workspace_id=self.workspace_id,
                provider='jira_basic',
                credential_subject='svc-jira@example.com',
                api_token='first-token',
                actor_user_id=self.admin_id,
                key_provider=self.key_provider,
            )
            session.commit()

        with self.factory() as session:
            first = get_service_integration_summary(session, integration.id)
            integration_row = session.get(models.ServiceIntegration, integration.id)
            integration_row.credential_subject = 'svc-jira-rotated@example.com'
            integration_row.token_version += 1
            session.commit()

        with self.factory() as session:
            second = get_service_integration_summary(session, integration.id)

        self.assertEqual(first['tokenVersion'], 1)
        self.assertEqual(first['credentialSubject'], 'svc-jira@example.com')
        self.assertEqual(second['tokenVersion'], 2)
        self.assertEqual(second['credentialSubject'], 'svc-jira-rotated@example.com')


if __name__ == '__main__':
    unittest.main()
