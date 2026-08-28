import base64
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.auth.context import RequestAuthContext
from backend.auth.home_credentials import HomeCredential
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError
from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import encrypt_token
from backend.db import engine as db_engine
from backend.db import models
from backend.epm import home as epm_home
import jira_server
from tests.auth_mode_test_utils import force_basic_auth_mode


FULL_SCOPE = (
    'read:me read:jira-work read:jira-user '
    'read:board-scope:jira-software read:sprint:jira-software read:project:jira '
    'offline_access'
)


class HomeCredentialResolverTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'home-credentials.db')}"
        self.engine = db_engine.get_engine(self.database_url)
        models.Base.metadata.create_all(self.engine)
        self.factory = db_engine.session_factory(self.database_url)
        self.key_provider = key_provider_from_env({
            'APP_ENVIRONMENT_KEY': 'local',
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([23]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        })
        self.workspace_id, self.user_id, self.oauth_connection_id = self._seed_oauth_user()
        self.context = RequestAuthContext(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            user_id=self.user_id,
            stable_subject='normal-account',
            atlassian_account_id='normal-account',
            workspace_id=self.workspace_id,
            auth_connection_id=self.oauth_connection_id,
            cloud_id='cloud-1',
            site_url='https://example.atlassian.net',
            token_version='1',
            account_status='active',
            is_admin=False,
        )

    def tearDown(self):
        db_engine.dispose_engines()
        self._tmpdir.cleanup()

    def _seed_oauth_user(self):
        with self.factory() as session:
            workspace = models.Workspace(
                environment_key='local',
                name='Local',
                jira_site_url='https://example.atlassian.net',
                jira_cloud_id='cloud-1',
                created_by='test',
            )
            user = models.User(
                external_provider='atlassian',
                external_subject='normal-account',
                email='normal@example.com',
                account_type='user',
                status='active',
                created_by='test',
            )
            session.add_all([workspace, user])
            session.flush()
            connection = models.AuthConnection(
                user_id=user.id,
                workspace_id=workspace.id,
                provider='atlassian_oauth',
                site_url=workspace.jira_site_url,
                cloud_id=workspace.jira_cloud_id,
                scopes=FULL_SCOPE.split(),
                status='active',
                token_version=1,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(connection)
            session.commit()
            return workspace.id, user.id, connection.id

    def _add_service_integration(self, *, status='active', token='service-home-token', version=3):
        with self.factory() as session:
            integration = models.ServiceIntegration(
                workspace_id=self.workspace_id,
                provider='home_townsquare_basic',
                credential_subject='service@example.com',
                status=status,
                token_version=version,
                created_by=self.user_id,
                updated_by=self.user_id,
            )
            session.add(integration)
            session.flush()
            envelope = encrypt_token(
                token,
                workspace_id=self.workspace_id,
                service_integration_id=integration.id,
                token_kind='api_token',
                key_provider=self.key_provider,
            )
            session.add(models.ServiceIntegrationToken(
                service_integration_id=integration.id,
                token_kind='api_token',
                algorithm=envelope.algorithm,
                ciphertext=envelope.ciphertext,
                nonce=envelope.nonce,
                wrapped_dek=envelope.wrapped_dek,
                key_id=envelope.key_id,
                aad_hash=envelope.aad_hash,
            ))
            session.commit()
            return integration.id

    def _add_user_token_connection(self, *, status='active', token='user-home-token', version=5):
        with self.factory() as session:
            connection = models.AuthConnection(
                user_id=self.user_id,
                workspace_id=self.workspace_id,
                provider='atlassian_user_api_token',
                site_url='https://example.atlassian.net',
                cloud_id='cloud-1',
                credential_subject='normal@example.com',
                capabilities=['home_townsquare_graphql'],
                status=status,
                token_version=version,
            )
            session.add(connection)
            session.flush()
            if status != 'revoked':
                envelope = encrypt_token(
                    token,
                    workspace_id=self.workspace_id,
                    auth_connection_id=connection.id,
                    token_kind='api_token',
                    key_provider=self.key_provider,
                )
                session.add(models.AuthToken(
                    connection_id=connection.id,
                    token_kind='api_token',
                    algorithm=envelope.algorithm,
                    ciphertext=envelope.ciphertext,
                    nonce=envelope.nonce,
                    wrapped_dek=envelope.wrapped_dek,
                    key_id=envelope.key_id,
                    aad_hash=envelope.aad_hash,
                ))
            session.commit()
            return connection.id

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
            'TOKEN_ENCRYPTION_MASTER_KEY_B64': base64.b64encode(bytes([23]) * 32).decode('ascii'),
            'TOKEN_ENCRYPTION_KEY_ID': 'local-key',
        }, clear=False)

    def _assert_auth_error(self, func, code):
        with self.assertRaises(AuthError) as raised:
            func()
        self.assertEqual(raised.exception.code, code)

    def test_read_metadata_requires_active_user_token(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_service_integration()
        with self._env_patch():
            self._assert_auth_error(
                lambda: resolve_home_credential(self.context, 'read_metadata'),
                'home_user_token_required',
            )

    def test_write_as_user_requires_active_user_token(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_service_integration()
        with self._env_patch():
            self._assert_auth_error(
                lambda: resolve_home_credential(self.context, 'write_as_user'),
                'home_user_token_required',
            )

    def test_write_as_user_rejects_revoked_user_token(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_user_token_connection(status='revoked')
        with self._env_patch():
            with self.assertRaises(AuthError) as raised:
                resolve_home_credential(self.context, 'write_as_user')

        self.assertEqual(raised.exception.code, 'home_user_token_required')
        self.assertEqual(
            str(raised.exception),
            'Connect your Atlassian API token to edit Jira Home as yourself.',
        )

    def test_read_metadata_rejects_revoked_user_token_even_with_service_integration(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_service_integration()
        self._add_user_token_connection(status='revoked')
        with self._env_patch():
            with self.assertRaises(AuthError) as raised:
                resolve_home_credential(self.context, 'read_metadata')

        self.assertEqual(raised.exception.code, 'home_user_token_required')
        self.assertEqual(
            str(raised.exception),
            'Connect your Atlassian API token to load EPM Home projects.',
        )

    def test_read_metadata_treats_every_inactive_home_connection_as_missing_prerequisite(self):
        from backend.auth.home_credentials import resolve_home_credential

        connection_id = self._add_user_token_connection(status='expired')
        for status in ('expired', 'error'):
            with self.subTest(status=status):
                with self.factory() as session:
                    connection = session.get(models.AuthConnection, connection_id)
                    connection.status = status
                    session.commit()
                with self._env_patch(), self.assertRaises(AuthError) as raised:
                    resolve_home_credential(self.context, 'read_metadata')

                self.assertEqual(raised.exception.code, 'home_user_token_required')
                self.assertEqual(
                    str(raised.exception),
                    'Connect your Atlassian API token to load EPM Home projects.',
                )

    def test_revoked_home_connection_returns_409_prerequisite_without_session_recovery(self):
        from backend.auth.home_credentials import resolve_home_credential

        force_basic_auth_mode(self, jira_server)
        self._add_user_token_connection(status='revoked')
        epm_config = {
            'version': 2,
            'labelPrefix': 'rnd_project_*',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKeys': ['CHILD-200']},
            'issueTypes': {'initiative': [], 'epic': [], 'leaf': []},
            'projects': {},
        }

        def resolve_revoked_home_token(_scope, context=None):
            return resolve_home_credential(
                context,
                'read_metadata',
                database_url=self.database_url,
                key_provider=self.key_provider,
            )

        with patch.object(jira_server, 'current_request_auth_context', return_value=self.context), \
             patch.object(jira_server, 'get_epm_config', return_value=epm_config), \
             patch.object(jira_server, 'fetch_epm_home_projects', side_effect=resolve_revoked_home_token):
            response = jira_server.app.test_client().get('/api/epm/projects')

        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'error': 'home_user_token_required',
                'message': 'Connect your Atlassian API token to load EPM Home projects.',
                'connectUrl': '/settings/connections/home-token',
            },
        )
        self.assertNotIn('loginUrl', response.get_json())

    def test_resolver_rejects_disabled_user(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_service_integration()
        with self.factory() as session:
            user = session.get(models.User, self.user_id)
            user.status = 'disabled'
            session.commit()

        with self._env_patch():
            self._assert_auth_error(
                lambda: resolve_home_credential(self.context, 'read_metadata'),
                'account_disabled',
            )

    def test_resolver_rejects_revoked_oauth_connection(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_service_integration()
        with self.factory() as session:
            connection = session.get(models.AuthConnection, self.oauth_connection_id)
            connection.status = 'revoked'
            session.commit()

        with self._env_patch():
            self._assert_auth_error(
                lambda: resolve_home_credential(self.context, 'read_metadata'),
                'auth_connection_revoked',
            )

    def test_read_metadata_ignores_service_integration_and_uses_user_token(self):
        from backend.auth.home_credentials import resolve_home_credential

        self._add_service_integration()
        user_connection_id = self._add_user_token_connection()

        with self._env_patch():
            metadata_credential = resolve_home_credential(self.context, 'read_metadata')
            user_credential = resolve_home_credential(self.context, 'write_as_user')

        self.assertEqual(metadata_credential.credential_type, 'user')
        self.assertEqual(metadata_credential.provider, 'atlassian_user_api_token')
        self.assertEqual(metadata_credential.email, 'normal@example.com')
        self.assertEqual(metadata_credential.api_token, 'user-home-token')
        self.assertEqual(metadata_credential.cache_key, (self.workspace_id, self.user_id, user_connection_id, 5))
        self.assertNotIn('user-home-token', repr(metadata_credential))

        self.assertEqual(user_credential.credential_type, 'user')
        self.assertEqual(user_credential.provider, 'atlassian_user_api_token')
        self.assertEqual(user_credential.email, 'normal@example.com')
        self.assertEqual(user_credential.api_token, 'user-home-token')
        self.assertEqual(user_credential.cache_key, (self.workspace_id, self.user_id, user_connection_id, 5))
        self.assertNotIn('user-home-token', repr(user_credential))

    def test_db_mode_home_client_requires_explicit_credential_descriptor(self):
        with self._env_patch():
            with self.assertRaises(RuntimeError):
                epm_home.build_home_graphql_client()

    def test_home_clients_use_explicit_descriptor_in_db_mode(self):
        credential = HomeCredential(
            credential_type='service',
            provider='home_townsquare_basic',
            email='service@example.com',
            api_token='service-home-token',
            workspace_id=self.workspace_id,
            site_url='https://example.atlassian.net',
            cloud_id='cloud-1',
            cache_key=(self.workspace_id, 'service-1', 3),
        )

        with self._env_patch(), patch('backend.epm.home.HomeGraphQLClient') as client_class:
            epm_home.build_home_graphql_client(credential)
            epm_home.build_teamwork_graph_client(credential)

        self.assertEqual(client_class.call_args_list[0].args, (
            'service@example.com',
            'service-home-token',
            epm_home.HOME_GRAPHQL_ENDPOINT,
        ))
        self.assertEqual(client_class.call_args_list[1].args, (
            'service@example.com',
            'service-home-token',
            'https://example.atlassian.net/gateway/api/graphql/twg',
        ))


if __name__ == '__main__':
    unittest.main()
