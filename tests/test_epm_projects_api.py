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
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'jiraLabel': '',
                    'jiraEpicKey': 'RM-123',
                }
            },
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        project = payload['projects'][0]
        self.assertEqual(project['resolvedLinkage']['labels'], ['rnd_project_retail_media'])
        self.assertEqual(project['resolvedLinkage']['epicKeys'], ['RM-123'])
        self.assertEqual(project['matchState'], 'home-linked')

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
