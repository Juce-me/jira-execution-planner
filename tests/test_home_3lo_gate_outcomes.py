import inspect
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from backend.auth.project_access import home_3lo_gate_mode
from backend.epm import home as epm_home
import jira_server


class TestHome3loGateOutcomes(unittest.TestCase):
    def test_pass_uses_db_auth_boundary(self):
        mode = home_3lo_gate_mode({'decision': 'pass', 'reason': 'home_graphql_3lo_supported'})

        self.assertEqual(mode, 'db_auth_boundary')

    def test_fail_keeps_routes_service_integration_scoped(self):
        mode = home_3lo_gate_mode({'decision': 'fail', 'reason': 'home_graphql_3lo_unsupported'})

        self.assertEqual(mode, 'service_integration_scoped')

    def test_public_read_pass_does_not_change_the_legacy_gate_disposition(self):
        public_pass = {'decision': 'pass', 'reason': 'home_graphql_public_read_v1_supported'}

        self.assertEqual(home_3lo_gate_mode(public_pass), 'service_integration_scoped')
        self.assertEqual(
            home_3lo_gate_mode({**public_pass, 'profile': 'public-read-v1'}),
            'service_integration_scoped',
        )
        self.assertNotEqual(epm_home.PUBLIC_READ_V1_PASS_REASON, 'home_graphql_3lo_supported')
        self.assertEqual(
            home_3lo_gate_mode({'decision': 'pass', 'reason': 'home_graphql_3lo_supported'}),
            'db_auth_boundary',
        )

    def test_public_read_surface_never_references_the_write_path(self):
        sources = [
            inspect.getsource(epm_home.HomeOAuthGraphQLClient),
            inspect.getsource(epm_home.run_home_graphql_public_read_probe),
            inspect.getsource(epm_home.classify_home_public_read_v1_probe),
            inspect.getsource(epm_home._fetch_goal_project_links_strict),
            inspect.getsource(epm_home._fetch_project_tags_strict),
        ]
        for source in sources:
            for forbidden in ('HOME_PROJECT_UPDATE_MUTATION', 'projects_createUpdate', 'write_as_user',
                              'WRITE_AS_USER', 'mutation'):
                self.assertNotIn(forbidden, source)
        self.assertNotIn('mutation', ' '.join(
            entry['query'] for entry in epm_home.PUBLIC_READ_V1_REGISTRY.values()))

    def test_authorize_url_requests_no_home_write_manage_or_delete_scope(self):
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_ID', 'client-123'), \
             patch.object(jira_server, 'ATLASSIAN_CLIENT_SECRET', 'secret-123'), \
             patch.object(jira_server, 'ATLASSIAN_REDIRECT_URI', 'http://localhost:5050/api/auth/atlassian/callback'), \
             patch.object(jira_server, 'FLASK_SECRET_KEY', 'test-secret'), \
             patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net'), \
             patch.object(jira_server, 'OAUTH_LOCAL_TOKEN_STORE_ALLOWED', True), \
             patch.object(jira_server, 'database_storage_enabled', return_value=False):
            jira_server.app.config['TESTING'] = True
            response = jira_server.app.test_client().get('/api/auth/atlassian/login')

        self.assertEqual(response.status_code, 302)
        scopes = parse_qs(urlparse(response.headers['Location']).query)['scope'][0].split()
        self.assertTrue(scopes)
        home_markers = ('townsquare', 'goal', 'home', 'project-update', 'teamwork')
        for scope in scopes:
            if scope.split(':')[0] in {'write', 'manage', 'delete'}:
                self.assertFalse(any(marker in scope for marker in home_markers), scope)


if __name__ == '__main__':
    unittest.main()
