"""Home credential descriptors after the user-owned API token connection was removed.

DB OAuth mode never resolves a Home credential: strict public-read-v1 uses the user's OAuth grant and the
legacy profile fails closed. The descriptor remains only for the Basic/JSON compatibility clients.
"""
import os
import tempfile
import unittest
from unittest.mock import patch

from backend.auth import home_credentials
from backend.auth.context import RequestAuthContext
from backend.auth.home_credentials import HomeCredential
from backend.auth.jira_auth import AuthError
from backend.epm import home as epm_home


class HomeCredentialResolverTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir.name, 'home-credentials.db')}"
        self.workspace_id = 'workspace-1'

    def _env_patch(self):
        return patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db',
            'DATABASE_URL': self.database_url,
        }, clear=False)

    def _context(self, **overrides):
        values = dict(
            auth_mode='atlassian_oauth', user_id='user-1', stable_subject='s', atlassian_account_id='s',
            workspace_id=self.workspace_id, auth_connection_id='conn-1', cloud_id='cloud-1',
            site_url='https://example.atlassian.net', token_version='1', account_status='active', is_admin=False,
        )
        values.update(overrides)
        return RequestAuthContext(**values)

    def test_no_token_connection_resolver_remains(self):
        for name in ('resolve_home_credential', '_resolve_user_credential', '_resolve_service_credential',
                     '_user_token_connection', 'WRITE_AS_USER', 'READ_EPM_METADATA'):
            self.assertFalse(hasattr(home_credentials, name), name)
        self.assertFalse(hasattr(epm_home, 'resolve_home_credential'))

    def test_db_mode_legacy_profile_fails_closed_with_a_typed_error_and_no_credential_lookup(self):
        with self._env_patch():
            with self.assertRaises(AuthError) as raised:
                epm_home._read_metadata_credential(self._context())
        self.assertEqual(raised.exception.code, 'epm_view_disabled')
        self.assertNotIn('token', str(raised.exception).lower())

    def test_strict_public_read_profile_never_resolves_a_home_credential(self):
        context = self._context(
            granted_scopes=tuple(epm_home.EPM_HOME_READ_SCOPES), granted_scopes_verified=True, browser_session_id='b')
        snapshot = epm_home.HomeReadAuth(
            'public-read-v1', context, revalidate=lambda c: c,
            load_session=lambda c: {'access_token': 'tok', 'expires_at': 4102444800,
                                    'scope': ' '.join(epm_home.EPM_HOME_READ_SCOPES), 'scope_provenance': 'provider',
                                    'db_token_version': '1'})
        with patch.object(epm_home, '_read_metadata_credential', side_effect=AssertionError('credential path')):
            client = snapshot.client()
        self.assertTrue(client.strict_public_read)
        self.assertEqual(client.endpoint, epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT)

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
        self.assertNotIn('service-home-token', repr(credential))


if __name__ == '__main__':
    unittest.main()
