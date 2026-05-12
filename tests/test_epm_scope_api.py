import unittest
from unittest.mock import patch

import jira_server
from backend.auth.context import RequestAuthContext
from backend.auth.home_credentials import HomeCredential
from backend.auth.jira_auth import AuthError


def _oauth_context():
    return RequestAuthContext(
        auth_mode='atlassian_oauth',
        user_id='user-1',
        stable_subject='account-1',
        atlassian_account_id='account-1',
        workspace_id='workspace-1',
        auth_connection_id='connection-1',
        cloud_id='cloud-1',
        site_url='https://example.atlassian.net',
        token_version='1',
        account_status='active',
        is_admin=False,
    )


def _home_credential():
    return HomeCredential(
        credential_type='service',
        provider='home_townsquare_basic',
        email='service@example.com',
        api_token='service-token',
        workspace_id='workspace-1',
        site_url='https://example.atlassian.net',
        cloud_id='cloud-1',
        cache_key=('workspace-1', 'service-1', 1),
    )


class TestEpmScopeApi(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_home_site_cloud_id')
    def test_scope_endpoint_returns_detected_cloud_id_error_and_saved_scope(self, mock_cloud_id, mock_get_epm_config):
        mock_cloud_id.return_value = 'cloud-123'
        mock_get_epm_config.return_value = {
            'version': 1,
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {},
        }

        response = self.client.get('/api/epm/scope')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'cloudId': 'cloud-123',
                'error': '',
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKeys': ['CHILD-200']},
            },
        )

    @patch('jira_server.fetch_epm_goal_catalog')
    def test_goals_endpoint_returns_root_goal_catalog(self, mock_catalog):
        mock_catalog.return_value = [
            {'id': 'goal-root', 'key': 'ROOT-100', 'name': 'Synthetic Root Goal', 'url': 'https://home/goal/root-100'}
        ]

        response = self.client.get('/api/epm/goals')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'goals': [{'id': 'goal-root', 'key': 'ROOT-100', 'name': 'Synthetic Root Goal', 'url': 'https://home/goal/root-100'}], 'error': ''})

    @patch('jira_server.fetch_epm_sub_goals')
    def test_goals_endpoint_returns_child_goals_for_selected_root(self, mock_sub_goals):
        mock_sub_goals.return_value = [
            {'id': 'goal-child', 'key': 'CHILD-200', 'name': 'Synthetic Child Goal', 'url': 'https://home/goal/child-200'}
        ]

        response = self.client.get('/api/epm/goals?rootGoalKey=ROOT-100')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'goals': [{'id': 'goal-child', 'key': 'CHILD-200', 'name': 'Synthetic Child Goal', 'url': 'https://home/goal/child-200'}],
                'error': '',
            },
        )

    @patch('jira_server.fetch_epm_goal_catalog', side_effect=RuntimeError('Jira tenant_info did not return cloudId'))
    def test_goals_endpoint_returns_settings_safe_response_on_catalog_failure(self, mock_catalog):
        response = self.client.get('/api/epm/goals')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {'goals': [], 'error': 'Jira tenant_info did not return cloudId'},
        )

    @patch('jira_server.fetch_epm_sub_goals', side_effect=jira_server.epm_home.HomeAuthenticationError('Auth failed'))
    def test_goals_endpoint_returns_settings_safe_response_on_child_goal_auth_failure(self, mock_sub_goals):
        response = self.client.get('/api/epm/goals?rootGoalKey=ROOT-100')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {'goals': [], 'error': 'Auth failed'},
        )

    @patch('jira_server.fetch_epm_goal_catalog')
    def test_goals_endpoint_returns_home_token_prerequisite(self, mock_catalog):
        mock_catalog.side_effect = AuthError(
            'home_user_token_required',
            'Connect your Atlassian API token to load EPM Home projects.',
        )

        response = self.client.get('/api/epm/goals')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'goals': [],
                'error': 'Connect your Atlassian API token to load EPM Home projects.',
                'errorCode': 'home_user_token_required',
                'connectUrl': '/settings/connections/home-token',
            },
        )

    @patch('jira_server.fetch_epm_goal_catalog')
    def test_goals_endpoint_returns_oauth_auth_required(self, mock_catalog):
        mock_catalog.side_effect = AuthError(
            'auth_required',
            'Atlassian authentication is required.',
        )

        response = self.client.get('/api/epm/goals')

        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['error'], 'auth_required')
        self.assertEqual(body['loginUrl'], '/login?reason=session_expired')

    def test_goal_catalog_uses_db_home_service_credential_in_request_context(self):
        context = _oauth_context()
        credential = _home_credential()

        with self.app.test_request_context('/api/epm/goals'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server.epm_home, '_read_metadata_credential', return_value=credential) as mock_credential, \
             patch.object(jira_server, 'fetch_home_site_cloud_id', return_value='cloud-1'), \
             patch.object(jira_server.epm_home, 'build_home_graphql_client') as mock_build_client:
            mock_build_client.return_value.execute_paginated.return_value = []
            jira_server.fetch_epm_goal_catalog()

        mock_credential.assert_called_once_with(context)
        mock_build_client.assert_called_once_with(credential)

    def test_child_goal_catalog_uses_db_home_service_credential_in_request_context(self):
        context = _oauth_context()
        credential = _home_credential()

        with self.app.test_request_context('/api/epm/goals?rootGoalKey=ROOT-100'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server.epm_home, '_read_metadata_credential', return_value=credential) as mock_credential, \
             patch.object(jira_server, 'fetch_home_site_cloud_id', return_value='cloud-1'), \
             patch.object(jira_server.epm_home, 'build_home_graphql_client') as mock_build_client, \
             patch.object(jira_server.epm_home, 'fetch_sub_goals_for_root_key', return_value=[]) as mock_fetch_sub_goals:
            jira_server.fetch_epm_sub_goals('ROOT-100')

        mock_credential.assert_called_once_with(context)
        mock_build_client.assert_called_once_with(credential)
        mock_fetch_sub_goals.assert_called_once_with(
            mock_build_client.return_value,
            'ROOT-100',
            jira_server.epm_home._container_id_from_cloud('cloud-1'),
            context=context,
        )


if __name__ == '__main__':
    unittest.main()
