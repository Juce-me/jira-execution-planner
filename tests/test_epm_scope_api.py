import unittest
from unittest.mock import patch

import jira_server


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
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
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


if __name__ == '__main__':
    unittest.main()
