import unittest
from unittest.mock import patch
import json
import os
import tempfile
from werkzeug.exceptions import NotFound

import jira_server


class TestEpmProjectsApi(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        jira_server.EPM_PROJECTS_CACHE.clear()

    def _home_projects(self):
        return [
            {
                'homeProjectId': 'home-1',
                'name': 'Home One',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Home one update',
                'resolvedLinkage': {'labels': ['home_label_one'], 'epicKeys': []},
                'matchState': 'home-linked',
            },
            {
                'homeProjectId': 'home-2',
                'name': 'Home Two',
                'homeUrl': 'https://home/project/2',
                'stateValue': 'PAUSED',
                'stateLabel': 'Paused',
                'tabBucket': 'backlog',
                'latestUpdateDate': '2026-04-20',
                'latestUpdateSnippet': 'Home two update',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            },
        ]

    def _mixed_config(self):
        return {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {
                'home-1': {
                    'id': 'home-1',
                    'homeProjectId': 'home-1',
                    'name': '',
                    'label': '',
                },
                'home-2': {
                    'id': 'home-2',
                    'homeProjectId': 'home-2',
                    'name': 'Configured Home Two',
                    'label': 'synthetic_label_home_two',
                },
                'custom-a': {
                    'id': 'custom-a',
                    'name': 'Custom Alpha',
                    'label': 'synthetic_label_alpha',
                },
                'custom-b': {
                    'id': 'custom-b',
                    'name': 'Custom Beta',
                    'label': '',
                },
            },
        }

    def _stale_key_config(self):
        return {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {
                'stale-home-two-key': {
                    'id': 'home-2',
                    'homeProjectId': 'home-2',
                    'name': 'Configured Home Two',
                    'label': 'synthetic_label_home_two',
                },
            },
        }

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_auto_fills_label_from_single_matching_home_tag(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Data Partnerships: CPM data fees',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'homeTags': ['epm', 'Data', 'Rnd_Project_BSW_Enablement'],
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {},
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        project = response.get_json()['projects'][0]
        self.assertEqual(project['displayName'], 'Data Partnerships: CPM data fees')
        self.assertEqual(project['label'], 'Rnd_Project_BSW_Enablement')
        self.assertEqual(project['resolvedLinkage']['labels'], ['Rnd_Project_BSW_Enablement'])
        self.assertEqual(project['matchState'], 'home-linked')
        self.assertEqual(project['labelSource'], 'home-tag')
        self.assertEqual(project['labelStatus'], 'auto')
        self.assertEqual(project['homeTagMatches'], ['Rnd_Project_BSW_Enablement'])

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_manual_label_overrides_home_tag(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'homeTags': ['rnd_project_home'],
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {
                'tsq-1': {
                    'id': 'tsq-1',
                    'homeProjectId': 'tsq-1',
                    'name': '',
                    'label': 'rnd_project_manual',
                }
            },
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        project = response.get_json()['projects'][0]
        self.assertEqual(project['label'], 'rnd_project_manual')
        self.assertEqual(project['resolvedLinkage']['labels'], ['rnd_project_manual'])
        self.assertEqual(project['matchState'], 'jep-fallback')
        self.assertEqual(project['labelSource'], 'manual')
        self.assertEqual(project['labelStatus'], 'manual')
        self.assertEqual(project['homeTagMatches'], ['rnd_project_home'])

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_multiple_matching_home_tags_require_manual_label(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'homeTags': ['rnd_project_alpha', 'rnd_project_beta'],
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {},
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        project = response.get_json()['projects'][0]
        self.assertEqual(project['label'], '')
        self.assertEqual(project['resolvedLinkage']['labels'], [])
        self.assertEqual(project['matchState'], 'metadata-only')
        self.assertEqual(project['labelSource'], '')
        self.assertEqual(project['labelStatus'], 'ambiguous')
        self.assertEqual(project['homeTagMatches'], ['rnd_project_alpha', 'rnd_project_beta'])

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_cache_reuses_home_tags_but_reshapes_label_prefix(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'homeTags': ['rnd_project_alpha', 'alt_project_beta'],
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_get_epm_config.side_effect = [
            {
                'version': 2,
                'labelPrefix': 'rnd_project_',
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                'projects': {},
            },
            {
                'version': 2,
                'labelPrefix': 'alt_project_',
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                'projects': {},
            },
        ]

        first_response = self.client.get('/api/epm/projects')
        second_response = self.client.get('/api/epm/projects')

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(second_response.status_code, 200, second_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 1)
        self.assertEqual(first_response.get_json()['projects'][0]['label'], 'rnd_project_alpha')
        self.assertEqual(second_response.get_json()['projects'][0]['label'], 'alt_project_beta')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_merges_home_and_jep_linkage(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []},
                'matchState': 'home-linked',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'customName': 'Synthetic Launch',
                    'jiraLabel': 'synthetic_label_alpha',
                    'jiraEpicKey': 'SYN-123',
                }
            },
        }

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200)
        mock_fetch_projects.assert_called_once_with({'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'})
        self.assertEqual(mock_fetch_projects.call_args.args[0], mock_get_epm_config.return_value['scope'])
        payload = response.get_json()
        project = payload['projects'][0]
        self.assertEqual(project['customName'], 'Synthetic Launch')
        self.assertEqual(project['displayName'], 'Synthetic Launch')
        self.assertEqual(project['resolvedLinkage']['labels'], ['synthetic_label_alpha'])
        self.assertEqual(project['resolvedLinkage']['epicKeys'], [])
        self.assertEqual(project['matchState'], 'home-linked')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_find_epm_project_rebuilds_fallback_with_saved_scope(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
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
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'customName': 'Synthetic Launch',
                    'jiraLabel': 'synthetic_label_alpha',
                    'jiraEpicKey': 'SYN-123',
                }
            },
        }

        project = jira_server.find_epm_project_or_404('tsq-1')

        mock_fetch_projects.assert_called_once_with({'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'})
        self.assertIs(mock_fetch_projects.call_args.args[0], mock_get_epm_config.return_value['scope'])
        self.assertEqual(project['customName'], 'Synthetic Launch')
        self.assertEqual(project['displayName'], 'Synthetic Launch')
        self.assertEqual(project['resolvedLinkage']['labels'], ['synthetic_label_alpha'])
        self.assertEqual(project['resolvedLinkage']['epicKeys'], ['SYN-123'])
        self.assertEqual(project['matchState'], 'jep-fallback')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_falls_back_to_home_name_when_custom_name_blank(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
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
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
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
        self.assertEqual(project['displayName'], 'Synthetic Launch')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_falls_back_to_home_name_when_custom_name_missing(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
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
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
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
        self.assertEqual(project['displayName'], 'Synthetic Launch')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_reuses_cache_on_second_request(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home/project/1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On Track',
                'tabBucket': 'active',
                'latestUpdateDate': '2026-04-19',
                'latestUpdateSnippet': 'Ready for rollout',
                'resolvedLinkage': {'labels': ['synthetic_label_alpha'], 'epicKeys': []},
                'matchState': 'home-linked',
            }
        ]
        mock_get_epm_config.return_value = {
            'version': 1,
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'jiraLabel': '',
                    'jiraEpicKey': 'SYN-123',
                }
            },
        }

        first_response = self.client.get('/api/epm/projects')
        second_response = self.client.get('/api/epm/projects')

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(mock_fetch_projects.call_count, 1)

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_configuration_endpoint_uses_draft_payload_without_saved_config(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
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
            'scope': {'rootGoalKey': 'ROOT-SAVED', 'subGoalKey': 'CHILD-SAVED'},
            'projects': {},
        }
        jira_server.EPM_PROJECTS_CACHE['saved-config'] = {'timestamp': 1, 'data': {'projects': [{'homeProjectId': 'cached-project'}]}}

        response = self.client.post(
            '/api/epm/projects/configuration',
            json={
                'scope': {'rootGoalKey': ' root-100 ', 'subGoalKey': ' child-200 '},
                'projects': {
                    'tsq-1': {
                        'homeProjectId': 'tsq-1',
                        'customName': 'Preview Launch',
                        'jiraLabel': 'synthetic_label_alpha',
                        'jiraEpicKey': 'syn-123',
                    }
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        mock_get_epm_config.assert_not_called()
        mock_fetch_projects.assert_called_once_with({'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'})
        payload = response.get_json()
        self.assertEqual(payload['projects'][0]['displayName'], 'Preview Launch')
        self.assertEqual(payload['projects'][0]['resolvedLinkage']['labels'], ['synthetic_label_alpha'])
        self.assertEqual(payload['projects'][0]['resolvedLinkage']['epicKeys'], [])
        self.assertGreaterEqual(len(jira_server.EPM_PROJECTS_CACHE), 1)
        self.assertIn('saved-config', jira_server.EPM_PROJECTS_CACHE)

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_cache_reuses_home_records_but_shapes_latest_labels(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'tsq-1',
                'name': 'Synthetic Launch',
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
        mock_get_epm_config.side_effect = [
            {
                'version': 2,
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                'labelPrefix': 'rnd_project_',
                'projects': {
                    'tsq-1': {
                        'id': 'tsq-1',
                        'homeProjectId': 'tsq-1',
                        'name': 'Synthetic Launch',
                        'label': 'first_label',
                    }
                },
            },
            {
                'version': 2,
                'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                'labelPrefix': 'rnd_project_',
                'projects': {
                    'tsq-1': {
                        'id': 'tsq-1',
                        'homeProjectId': 'tsq-1',
                        'name': 'Synthetic Launch',
                        'label': 'second_label',
                    }
                },
            },
        ]

        first_response = self.client.get('/api/epm/projects')
        second_response = self.client.get('/api/epm/projects')

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(second_response.status_code, 200, second_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 1)
        first_project = first_response.get_json()['projects'][0]
        second_project = second_response.get_json()['projects'][0]
        self.assertEqual(first_project['resolvedLinkage']['labels'], ['first_label'])
        self.assertEqual(second_project['resolvedLinkage']['labels'], ['second_label'])

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_refresh_bypasses_cached_home_projects(self, mock_fetch_projects, mock_get_epm_config):
        first_home_projects = [self._home_projects()[0]]
        refreshed_home_projects = [self._home_projects()[1]]
        mock_fetch_projects.side_effect = [first_home_projects, refreshed_home_projects]
        mock_get_epm_config.return_value = {
            'version': 2,
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
            'labelPrefix': 'rnd_project_',
            'projects': {},
        }

        first_response = self.client.get('/api/epm/projects')
        cached_response = self.client.get('/api/epm/projects')
        refreshed_response = self.client.get('/api/epm/projects?refresh=true')

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(cached_response.status_code, 200, cached_response.get_data(as_text=True))
        self.assertEqual(refreshed_response.status_code, 200, refreshed_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 2)
        self.assertEqual(first_response.get_json()['projects'][0]['homeProjectId'], 'home-1')
        self.assertEqual(cached_response.get_json()['projects'][0]['homeProjectId'], 'home-1')
        self.assertEqual(refreshed_response.get_json()['projects'][0]['homeProjectId'], 'home-2')
        self.assertFalse(first_response.get_json()['cacheHit'])
        self.assertTrue(cached_response.get_json()['cacheHit'])
        self.assertFalse(refreshed_response.get_json()['cacheHit'])

    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_configuration_refresh_bypasses_cache_and_preserves_draft_labels(self, mock_fetch_projects):
        first_home_projects = [self._home_projects()[0]]
        refreshed_home_projects = [self._home_projects()[0], self._home_projects()[1]]
        mock_fetch_projects.side_effect = [first_home_projects, refreshed_home_projects]
        draft_config = self._mixed_config()

        first_response = self.client.post('/api/epm/projects/configuration', json=draft_config)
        cached_response = self.client.post('/api/epm/projects/configuration', json=draft_config)
        refreshed_response = self.client.post('/api/epm/projects/configuration?refresh=true', json=draft_config)

        self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
        self.assertEqual(cached_response.status_code, 200, cached_response.get_data(as_text=True))
        self.assertEqual(refreshed_response.status_code, 200, refreshed_response.get_data(as_text=True))
        self.assertEqual(mock_fetch_projects.call_count, 2)
        refreshed_projects = refreshed_response.get_json()['projects']
        self.assertEqual([project['homeProjectId'] for project in refreshed_projects[:2]], ['home-1', 'home-2'])
        home_two = next(project for project in refreshed_projects if project['homeProjectId'] == 'home-2')
        self.assertEqual(home_two['resolvedLinkage']['labels'], ['synthetic_label_home_two'])
        self.assertFalse(first_response.get_json()['cacheHit'])
        self.assertTrue(cached_response.get_json()['cacheHit'])
        self.assertFalse(refreshed_response.get_json()['cacheHit'])

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_returns_home_projects_then_custom_projects(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = self._home_projects()
        mock_get_epm_config.return_value = self._mixed_config()

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        projects = response.get_json()['projects']
        self.assertEqual([project['id'] for project in projects], ['home-1', 'home-2', 'custom-a', 'custom-b'])
        self.assertEqual([project['matchState'] for project in projects], ['home-linked', 'jep-fallback', 'jep-fallback', 'metadata-only'])
        self.assertEqual(projects[0]['displayName'], 'Home One')
        self.assertEqual(projects[1]['displayName'], 'Configured Home Two')
        self.assertEqual(projects[1]['label'], 'synthetic_label_home_two')
        self.assertEqual(projects[2]['homeProjectId'], None)
        self.assertEqual(projects[2]['tabBucket'], 'all')
        self.assertEqual(projects[3]['homeProjectId'], None)
        self.assertEqual(projects[3]['tabBucket'], 'all')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_endpoint_applies_home_override_from_stale_config_key(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = self._home_projects()
        mock_get_epm_config.return_value = self._stale_key_config()

        response = self.client.get('/api/epm/projects')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        projects = response.get_json()['projects']
        home_two = next(project for project in projects if project['homeProjectId'] == 'home-2')
        self.assertEqual(home_two['id'], 'home-2')
        self.assertEqual(home_two['displayName'], 'Configured Home Two')
        self.assertEqual(home_two['label'], 'synthetic_label_home_two')
        self.assertEqual(home_two['resolvedLinkage']['labels'], ['synthetic_label_home_two'])
        self.assertEqual(home_two['matchState'], 'jep-fallback')

    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_projects_preview_endpoint_returns_home_projects_then_custom_projects(self, mock_fetch_projects):
        mock_fetch_projects.return_value = self._home_projects()

        response = self.client.post('/api/epm/projects/preview', json=self._mixed_config())

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        projects = response.get_json()['projects']
        self.assertEqual([project['id'] for project in projects], ['home-1', 'home-2', 'custom-a', 'custom-b'])
        self.assertEqual([project['matchState'] for project in projects], ['home-linked', 'jep-fallback', 'jep-fallback', 'metadata-only'])
        self.assertTrue(all(project['tabBucket'] == 'all' for project in projects[2:]))

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_find_epm_project_resolves_custom_without_home_fetch_and_home_with_metadata(self, mock_fetch_projects, mock_get_epm_config):
        mock_get_epm_config.return_value = self._mixed_config()

        custom = jira_server.find_epm_project_or_404('custom-a')

        mock_fetch_projects.assert_not_called()
        self.assertEqual(custom['id'], 'custom-a')
        self.assertEqual(custom['displayName'], 'Custom Alpha')
        self.assertEqual(custom['matchState'], 'jep-fallback')
        self.assertEqual(custom['tabBucket'], 'all')

        mock_fetch_projects.return_value = self._home_projects()
        home = jira_server.find_epm_project_or_404('home-2')

        mock_fetch_projects.assert_called_once_with({'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'})
        self.assertEqual(home['id'], 'home-2')
        self.assertEqual(home['displayName'], 'Configured Home Two')
        self.assertEqual(home['label'], 'synthetic_label_home_two')
        self.assertEqual(home['stateValue'], 'PAUSED')
        self.assertEqual(home['stateLabel'], 'Paused')
        self.assertEqual(home['tabBucket'], 'backlog')
        self.assertEqual(home['latestUpdateDate'], '2026-04-20')
        self.assertEqual(home['matchState'], 'jep-fallback')

        with self.assertRaises(NotFound):
            jira_server.find_epm_project_or_404('unknown')

    @patch('jira_server.get_epm_config')
    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_find_epm_project_applies_home_override_from_stale_config_key(self, mock_fetch_projects, mock_get_epm_config):
        mock_fetch_projects.return_value = self._home_projects()
        mock_get_epm_config.return_value = self._stale_key_config()

        home = jira_server.find_epm_project_or_404('home-2')

        mock_fetch_projects.assert_called_once_with({'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'})
        self.assertEqual(home['id'], 'home-2')
        self.assertEqual(home['displayName'], 'Configured Home Two')
        self.assertEqual(home['label'], 'synthetic_label_home_two')
        self.assertEqual(home['resolvedLinkage']['labels'], ['synthetic_label_home_two'])
        self.assertEqual(home['stateValue'], 'PAUSED')
        self.assertEqual(home['tabBucket'], 'backlog')
        self.assertEqual(home['matchState'], 'jep-fallback')

    @patch('jira_server.fetch_epm_home_projects', create=True)
    def test_save_epm_config_rekeys_draft_custom_project_to_stable_uuid(self, mock_fetch_projects):
        mock_fetch_projects.return_value = []
        draft_payload = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'projects': {
                'draft-abc': {
                    'id': 'draft-abc',
                    'homeProjectId': None,
                    'name': 'New',
                    'label': '',
                }
            },
        }

        preview = self.client.post('/api/epm/projects/preview', json=draft_payload)

        self.assertEqual(preview.status_code, 200, preview.get_data(as_text=True))
        self.assertEqual(preview.get_json()['projects'][0]['id'], 'draft-abc')

        tmpdir = tempfile.mkdtemp()
        dashboard_path = os.path.join(tmpdir, 'dashboard-config.json')
        try:
            with patch.object(jira_server, 'resolve_dashboard_config_path', return_value=dashboard_path):
                first_response = self.client.post('/api/epm/config', json=draft_payload)
                self.assertEqual(first_response.status_code, 200, first_response.get_data(as_text=True))
                first = first_response.get_json()
                self.assertEqual(len(first['projects']), 1)
                uuid_key = next(iter(first['projects']))
                self.assertRegex(uuid_key, r'^[0-9a-f]{32}$')
                self.assertEqual(first['projects'][uuid_key]['id'], uuid_key)
                self.assertIsNone(first['projects'][uuid_key].get('homeProjectId'))
                self.assertNotIn('draft-abc', first['projects'])
                self.assertNotIn('draft-abc', json.dumps(first['projects']))

                second_response = self.client.post('/api/epm/config', json=first)
                self.assertEqual(second_response.status_code, 200, second_response.get_data(as_text=True))
                second = second_response.get_json()
                self.assertEqual(list(second['projects']), [uuid_key])
                self.assertEqual(second['projects'][uuid_key]['id'], uuid_key)

                renamed = json.loads(json.dumps(second))
                renamed['projects'][uuid_key]['name'] = 'Renamed'
                third_response = self.client.post('/api/epm/config', json=renamed)
                self.assertEqual(third_response.status_code, 200, third_response.get_data(as_text=True))
                third = third_response.get_json()
                self.assertEqual(list(third['projects']), [uuid_key])
                self.assertEqual(third['projects'][uuid_key]['id'], uuid_key)
                self.assertEqual(third['projects'][uuid_key]['name'], 'Renamed')
        finally:
            if os.path.exists(dashboard_path):
                os.unlink(dashboard_path)
            os.rmdir(tmpdir)


if __name__ == '__main__':
    unittest.main()
