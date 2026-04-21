import unittest
from unittest.mock import patch

import jira_server


class TestEpmProjectsApi(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        jira_server.EPM_PROJECTS_CACHE.clear()

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_merges_home_and_jep_linkage(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Retail Media Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': ['rnd_project_retail_media'], 'epicKeys': []},
                'matchState': 'home-linked',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'scope': {'cloudId': 'cloud-1', 'subGoalKey': 'CRITE-552'},
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'customName': 'Retail Media Launch',
                    'jiraLabel': 'rnd_project_retail_media',
                    'jiraEpicKey': 'RM-123',
                }
            },
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200)
        mock_fetch_projects.assert_called_once_with({'cloudId': 'cloud-1', 'subGoalKey': 'CRITE-552'})
        payload = response.get_json()
        project = payload['projects'][0]
        self.assertEqual(project['customName'], 'Retail Media Launch')
        self.assertEqual(project['displayName'], 'Retail Media Launch')
        self.assertEqual(project['resolvedLinkage']['labels'], ['rnd_project_retail_media'])
        self.assertEqual(project['resolvedLinkage']['epicKeys'], ['RM-123'])
        self.assertEqual(project['matchState'], 'home-linked')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_find_epm_project_rebuilds_fallback_with_saved_scope(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Retail Media Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'scope': {'cloudId': 'cloud-1', 'subGoalKey': 'CRITE-552'},
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'customName': 'Retail Media Launch',
                    'jiraLabel': 'rnd_project_retail_media',
                    'jiraEpicKey': 'RM-123',
                }
            },
        }

        project = jira_server.find_epm_project_or_404('tsq-1')

        mock_fetch_projects.assert_called_once_with({'cloudId': 'cloud-1', 'subGoalKey': 'CRITE-552'})
        self.assertEqual(project['customName'], 'Retail Media Launch')
        self.assertEqual(project['displayName'], 'Retail Media Launch')
        self.assertEqual(project['resolvedLinkage']['labels'], ['rnd_project_retail_media'])
        self.assertEqual(project['resolvedLinkage']['epicKeys'], ['RM-123'])
        self.assertEqual(project['matchState'], 'jep-fallback')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_falls_back_to_home_name_when_custom_name_blank(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Retail Media Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'scope': {'cloudId': 'cloud-1', 'subGoalKey': 'CRITE-552'},
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'customName': '   ',
                    'jiraLabel': '',
                    'jiraEpicKey': '',
                }
            },
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200)
        project = response.get_json()['projects'][0]
        self.assertEqual(project['customName'], '')
        self.assertEqual(project['displayName'], 'Retail Media Launch')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_falls_back_to_home_name_when_custom_name_missing(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Retail Media Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'scope': {'cloudId': 'cloud-1', 'subGoalKey': 'CRITE-552'},
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'jiraLabel': '',
                    'jiraEpicKey': '',
                }
            },
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200)
        project = response.get_json()['projects'][0]
        self.assertEqual(project['customName'], '')
        self.assertEqual(project['displayName'], 'Retail Media Launch')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_reuses_cache_on_second_request(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Retail Media Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': ['rnd_project_retail_media'], 'epicKeys': []},
                'matchState': 'home-linked',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'jiraLabel': '',
                    'jiraEpicKey': 'RM-123',
                }
            },
        }

        first_response = self.client.get('/api/epm/projects')
        second_response = self.client.get('/api/epm/projects')

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(mock_fetch_projects.call_count, 1)


if __name__ == '__main__':
    unittest.main()
