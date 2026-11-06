"""Historical Home descriptors remain inert; runtime Home reads require DB OAuth."""
import unittest
from unittest.mock import patch

from flask import session

import jira_server
from backend.auth import home_credentials
from backend.auth.home_credentials import HomeCredential
from backend.auth.jira_auth import AuthError
from backend.epm import home as epm_home
from backend.services.user_view_config import set_user_epm_view_enabled
from tests.oauth_test_helpers import FULL_OAUTH_SCOPE, install_oauth_session, set_up_db_oauth


class HomeCredentialResolverTests(unittest.TestCase):
    def setUp(self):
        self.database_url = set_up_db_oauth(self)
        self.client = jira_server.app.test_client()
        payload = install_oauth_session(self.client,
            scope=FULL_OAUTH_SCOPE + ' ' + ' '.join(epm_home.EPM_HOME_READ_SCOPES))
        with jira_server.app.test_request_context('/'):
            session['db_oauth_session'] = payload
            self.context = jira_server.current_request_auth_context()

    def test_no_token_connection_resolver_remains(self):
        for name in ('resolve_home_credential', '_resolve_user_credential', '_resolve_service_credential',
                     '_user_token_connection', 'WRITE_AS_USER', 'READ_EPM_METADATA'):
            self.assertFalse(hasattr(home_credentials, name), name)
        self.assertFalse(hasattr(epm_home, 'resolve_home_credential'))

    def test_db_mode_legacy_profile_fails_closed_with_a_typed_error_and_no_credential_lookup(self):
        self.assertFalse(hasattr(epm_home, '_read_metadata_credential'))
        with patch.object(epm_home, 'urlopen', side_effect=AssertionError('Home network called')):
            with self.assertRaises(AuthError) as raised:
                jira_server._build_epm_home_graphql_client(context=self.context)
        self.assertEqual(raised.exception.code, 'epm_view_disabled')
        self.assertNotIn('token', str(raised.exception).lower())

    def test_strict_public_read_profile_never_resolves_a_home_credential(self):
        set_user_epm_view_enabled(self.context, True, database_url=self.database_url)
        snapshot = jira_server.resolve_epm_home_read_auth(self.context)
        self.assertFalse(hasattr(epm_home, '_read_metadata_credential'))
        with patch.object(epm_home, 'urlopen', side_effect=AssertionError('unexpected network')):
            client = snapshot.client()
        self.assertTrue(client.strict_public_read)
        self.assertEqual(client.endpoint, epm_home.HOME_OAUTH_GRAPHQL_ENDPOINT)

    def test_db_mode_has_no_basic_or_teamwork_graph_client_factory(self):
        for name in ('HomeGraphQLClient', 'build_home_graphql_client', 'build_teamwork_graph_client'):
            self.assertFalse(hasattr(epm_home, name), name)

    def test_historical_descriptor_is_redacted_and_cannot_select_a_runtime_client(self):
        credential = HomeCredential(credential_type='service', provider='home_townsquare_basic',
            email='service@example.invalid', api_token='synthetic-service-token',
            workspace_id=self.context.workspace_id, site_url=self.context.site_url,
            cloud_id=self.context.cloud_id, cache_key=('historical', 3))
        self.assertNotIn('synthetic-service-token', repr(credential))
        self.assertFalse(hasattr(epm_home, 'build_home_graphql_client'))
        self.assertFalse(hasattr(epm_home, 'build_teamwork_graph_client'))


if __name__ == '__main__':
    unittest.main()
