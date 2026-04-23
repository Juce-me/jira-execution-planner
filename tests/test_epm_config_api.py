import json
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpmConfigApi(unittest.TestCase):
    DEFAULT_ISSUE_TYPES = {
        'initiative': ['Initiative'],
        'epic': ['Epic'],
        'leaf': ['Story', 'Task', 'Sub-task', 'Subtask', 'Bug'],
    }

    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        self._tmpdir = tempfile.mkdtemp()
        self._dashboard_path = os.path.join(self._tmpdir, 'dashboard-config.json')
        self._dashboard_patcher = patch.object(
            jira_server,
            'resolve_dashboard_config_path',
            return_value=self._dashboard_path,
        )
        self._dashboard_patcher.start()

    def tearDown(self):
        self._dashboard_patcher.stop()
        if os.path.exists(self._dashboard_path):
            os.unlink(self._dashboard_path)
        os.rmdir(self._tmpdir)

    def test_get_epm_config_returns_empty_default(self):
        response = self.client.get('/api/epm/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'version': 2,
                'labelPrefix': 'rnd_project_',
                'scope': {'rootGoalKey': '', 'subGoalKey': ''},
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {},
            },
        )

    def test_get_epm_config_ignores_legacy_cloud_id_scope(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'epm': {
                        'version': 1,
                        'scope': {
                            'cloudId': ' legacy-cloud-123 ',
                            'subGoalKey': ' child-200 ',
                        },
                        'projects': {},
                    },
                },
                handle,
            )

        response = self.client.get('/api/epm/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'version': 2,
                'labelPrefix': 'rnd_project_',
                'scope': {
                    'rootGoalKey': '',
                    'subGoalKey': 'CHILD-200',
                },
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {},
            },
        )

    def test_normalize_epm_config_migrates_v1_project_rows_to_v2(self):
        payload = jira_server.normalize_epm_config({
            'version': 1,
            'scope': {
                'rootGoalKey': ' root-100 ',
                'subGoalKey': ' child-200 ',
            },
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'home-1',
                    'customName': ' Foo ',
                    'jiraLabel': ' synthetic_label_alpha ',
                    'jiraEpicKey': 'syn-123',
                },
            },
        })

        self.assertEqual(
            payload,
            {
                'version': 2,
                'labelPrefix': 'rnd_project_',
                'scope': {
                    'rootGoalKey': 'ROOT-100',
                    'subGoalKey': 'CHILD-200',
                },
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {
                    'home-1': {
                        'id': 'home-1',
                        'homeProjectId': 'home-1',
                        'name': 'Foo',
                        'label': 'synthetic_label_alpha',
                    }
                },
            },
        )

    def test_normalize_epm_config_round_trips_v2_shape(self):
        config = {
            'version': 2,
            'labelPrefix': 'rnd_project_custom_',
            'scope': {
                'rootGoalKey': 'ROOT-100',
                'subGoalKey': 'CHILD-200',
            },
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {
                'home-1': {
                    'id': 'home-1',
                    'homeProjectId': 'home-1',
                    'name': 'Foo',
                    'label': 'synthetic_label_alpha',
                },
                'custom-1': {
                    'id': 'custom-1',
                    'name': 'Custom',
                    'label': 'synthetic_label_beta',
                },
            },
        }

        self.assertEqual(jira_server.normalize_epm_config(config), config)

    def test_normalize_epm_config_v1_row_without_home_id_stays_custom(self):
        payload = jira_server.normalize_epm_config({
            'version': 1,
            'projects': {
                ' draft-row ': {
                    'id': 'draft-123',
                    'name': 'Draft Name',
                    'label': 'synthetic_label_alpha',
                },
            },
        })

        self.assertIn(' draft-row ', payload['projects'])
        self.assertNotIn('draft-row', payload['projects'])
        self.assertEqual(payload['projects'][' draft-row ']['id'], 'draft-123')
        self.assertEqual(payload['projects'][' draft-row ']['name'], 'Draft Name')
        self.assertEqual(payload['projects'][' draft-row ']['label'], 'synthetic_label_alpha')
        self.assertNotIn('homeProjectId', payload['projects'][' draft-row '])

    def test_normalize_epm_config_preserves_custom_project_id_across_name_edits(self):
        original = jira_server.normalize_epm_config({
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'projects': {
                'custom-1': {
                    'id': 'custom-1',
                    'name': 'Old Name',
                    'label': 'synthetic_label_alpha',
                },
            },
        })
        edited = jira_server.normalize_epm_config({
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'projects': {
                'custom-1': {
                    'id': 'custom-1',
                    'name': 'New Name',
                    'label': 'synthetic_label_alpha',
                },
            },
        })

        self.assertEqual(original['projects']['custom-1']['id'], 'custom-1')
        self.assertEqual(edited['projects']['custom-1']['id'], 'custom-1')
        self.assertEqual(edited['projects']['custom-1']['name'], 'New Name')

    def test_normalize_epm_config_preserves_empty_label(self):
        payload = jira_server.normalize_epm_config({
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'projects': {
                'custom-1': {
                    'id': 'custom-1',
                    'name': 'Custom',
                },
            },
        })

        self.assertEqual(payload['projects']['custom-1']['label'], '')

    def test_get_epm_config_returns_v2_shape_for_saved_v1_config(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'epm': {
                        'version': 1,
                        'scope': {
                            'rootGoalKey': ' root-100 ',
                            'subGoalKey': ' child-200 ',
                        },
                        'projects': {
                            'tsq-1': {
                                'homeProjectId': 'home-1',
                                'customName': ' synthetic launch ',
                                'jiraLabel': ' synthetic_label_alpha ',
                                'jiraEpicKey': 'syn-123',
                            },
                            'bad-row': 'skip-me',
                        },
                    },
                },
                handle,
            )

        response = self.client.get('/api/epm/config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json(),
            {
                'version': 2,
                'labelPrefix': 'rnd_project_',
                'scope': {
                    'rootGoalKey': 'ROOT-100',
                    'subGoalKey': 'CHILD-200',
                },
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {
                    'home-1': {
                        'id': 'home-1',
                        'homeProjectId': 'home-1',
                        'name': 'synthetic launch',
                        'label': 'synthetic_label_alpha',
                    }
                },
            },
        )

    def test_normalize_epm_config_migrates_empty_custom_name_to_empty_name(self):
        payload = jira_server.normalize_epm_config({
            'version': 1,
            'projects': {
                'tsq-1': {
                    'homeProjectId': 'tsq-1',
                    'customName': '',
                    'jiraLabel': 'synthetic_label_alpha',
                },
            },
        })

        self.assertEqual(payload['projects']['tsq-1']['name'], '')

    def test_normalize_epm_config_version_one_takes_precedence_over_label_prefix(self):
        payload = jira_server.normalize_epm_config({
            'version': 1,
            'labelPrefix': 'rnd_project_custom_',
            'projects': {
                'home-1': {
                    'homeProjectId': 'home-1',
                    'customName': 'Synthetic Launch',
                    'jiraLabel': 'synthetic_label_alpha',
                },
            },
        })

        self.assertEqual(payload['labelPrefix'], 'rnd_project_custom_')
        self.assertEqual(payload['projects']['home-1']['name'], 'Synthetic Launch')
        self.assertEqual(payload['projects']['home-1']['label'], 'synthetic_label_alpha')

    def test_normalize_epm_config_home_linked_v1_accepts_v2_name_label_fallback(self):
        payload = jira_server.normalize_epm_config({
            'version': 1,
            'projects': {
                'home-1': {
                    'homeProjectId': 'home-1',
                    'name': 'Synthetic Name',
                    'label': 'synthetic_label_alpha',
                },
            },
        })

        self.assertEqual(payload['projects']['home-1']['name'], 'Synthetic Name')
        self.assertEqual(payload['projects']['home-1']['label'], 'synthetic_label_alpha')

    def test_normalize_epm_config_fills_partial_issue_type_defaults(self):
        payload = jira_server.normalize_epm_config({
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'issueTypes': {
                'initiative': ['Theme'],
            },
        })

        self.assertEqual(payload['issueTypes']['initiative'], ['Theme'])
        self.assertEqual(payload['issueTypes']['epic'], ['Epic'])
        self.assertEqual(payload['issueTypes']['leaf'], ['Story', 'Task', 'Sub-task', 'Subtask', 'Bug'])

    def test_normalize_epm_config_restores_empty_issue_type_bucket_default(self):
        payload = jira_server.normalize_epm_config({
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'issueTypes': {
                'initiative': ['Theme'],
                'epic': [],
                'leaf': ['Work'],
            },
        })

        self.assertEqual(payload['issueTypes']['initiative'], ['Theme'])
        self.assertEqual(payload['issueTypes']['epic'], ['Epic'])
        self.assertEqual(payload['issueTypes']['leaf'], ['Work'])

    def test_normalize_epm_config_does_not_churn_ids_or_rekey_project_map(self):
        payload = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'projects': {
                ' draft-row ': {
                    'id': 'draft-123',
                    'name': 'Draft',
                    'label': 'synthetic_label_alpha',
                },
                '': {
                    'id': '',
                    'name': 'Empty Id',
                    'label': 'synthetic_label_beta',
                },
                'bad-row': 'skip-me',
            },
        }

        first = jira_server.normalize_epm_config(payload)
        second = jira_server.normalize_epm_config(payload)

        self.assertIn(' draft-row ', first['projects'])
        self.assertIn(' draft-row ', second['projects'])
        self.assertNotIn('draft-row', first['projects'])
        self.assertNotIn('draft-row', second['projects'])
        self.assertIn('', first['projects'])
        self.assertIn('', second['projects'])
        self.assertNotIn('bad-row', first['projects'])
        self.assertEqual(first['projects'][' draft-row ']['id'], 'draft-123')
        self.assertEqual(second['projects'][' draft-row ']['id'], 'draft-123')
        self.assertEqual(first['projects']['']['id'], '')
        self.assertEqual(second['projects']['']['id'], '')

    def test_post_epm_config_persists_projects_without_overwriting_team_groups(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {'version': 1, 'groups': []},
                },
                handle,
            )

        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', {'dummy': {'value': 1}}), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', {'dummy': {'value': 2}}), \
             patch.object(jira_server, 'TASKS_CACHE', {'dummy': {'value': 3}}):
            response = self.client.post(
                '/api/epm/config',
                json={
                    'scope': {
                        'rootGoalKey': ' root-100 ',
                        'subGoalKey': ' child-200 ',
                    },
                    'projects': {
                        'tsq-1': {
                            'homeProjectId': ' tsq-1 ',
                            'customName': ' Synthetic Launch ',
                            'jiraLabel': ' synthetic_label_alpha ',
                            'jiraEpicKey': 'syn-123',
                        }
                    }
                },
            )
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            payload = response.get_json()
            self.assertEqual(payload['version'], 2)
            self.assertEqual(payload['labelPrefix'], 'rnd_project_')
            self.assertEqual(payload['scope']['rootGoalKey'], 'ROOT-100')
            self.assertEqual(payload['scope']['subGoalKey'], 'CHILD-200')
            self.assertEqual(payload['issueTypes'], self.DEFAULT_ISSUE_TYPES)
            self.assertEqual(payload['projects']['tsq-1']['id'], 'tsq-1')
            self.assertEqual(payload['projects']['tsq-1']['homeProjectId'], 'tsq-1')
            self.assertEqual(payload['projects']['tsq-1']['name'], 'Synthetic Launch')
            self.assertEqual(payload['projects']['tsq-1']['label'], 'synthetic_label_alpha')

            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.TASKS_CACHE, {'dummy': {'value': 3}})

        with open(self._dashboard_path, 'r', encoding='utf-8') as handle:
            saved = json.load(handle)

        self.assertIn('teamGroups', saved)
        self.assertEqual(saved['teamGroups']['version'], 1)
        self.assertEqual(saved['epm']['version'], 2)
        self.assertEqual(saved['epm']['labelPrefix'], 'rnd_project_')
        self.assertEqual(saved['epm']['scope']['rootGoalKey'], 'ROOT-100')
        self.assertEqual(saved['epm']['scope']['subGoalKey'], 'CHILD-200')
        self.assertNotIn('jiraEpicKey', saved['epm']['projects']['tsq-1'])
        self.assertEqual(saved['epm']['projects']['tsq-1']['id'], 'tsq-1')
        self.assertEqual(saved['epm']['projects']['tsq-1']['label'], 'synthetic_label_alpha')
        self.assertEqual(saved['epm']['projects']['tsq-1']['name'], 'Synthetic Launch')

    def test_jira_labels_prefix_filters_case_insensitive_startswith(self):
        labels = [
            'rnd_project_alpha',
            'RND_PROJECT_BETA',
            'team_rnd_project_gamma',
            'rnd_other_delta',
        ]

        with patch.object(jira_server, 'LABELS_CACHE', {'data': labels, 'timestamp': 9999999999}):
            response = self.client.get('/api/jira/labels?prefix=rnd_project_')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_alpha', 'RND_PROJECT_BETA'])

    def test_jira_labels_applies_query_then_prefix_then_limit(self):
        labels = [
            'rnd_project_alpha',
            'team_alpha',
            'rnd_project_beta_alpha',
            'rnd_project_gamma_alpha',
        ]

        with patch.object(jira_server, 'LABELS_CACHE', {'data': labels, 'timestamp': 9999999999}):
            response = self.client.get('/api/jira/labels?query=alpha&prefix=rnd_project_&limit=2')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_alpha', 'rnd_project_beta_alpha'])

    def test_jira_labels_without_prefix_keeps_existing_query_behavior(self):
        labels = [
            'rnd_project_alpha',
            'team_alpha',
            'rnd_project_beta',
        ]

        with patch.object(jira_server, 'LABELS_CACHE', {'data': labels, 'timestamp': 9999999999}):
            response = self.client.get('/api/jira/labels?query=alpha')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_alpha', 'team_alpha'])

    def test_jira_labels_limit_cap_applies_after_prefix_filtering(self):
        labels = [f'rnd_project_{index:03d}' for index in range(250)]

        with patch.object(jira_server, 'LABELS_CACHE', {'data': labels, 'timestamp': 9999999999}):
            response = self.client.get('/api/jira/labels?prefix=rnd_project_&limit=250')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(len(response.get_json()['labels']), 200)
        self.assertEqual(response.get_json()['labels'][0], 'rnd_project_000')
        self.assertEqual(response.get_json()['labels'][-1], 'rnd_project_199')


if __name__ == '__main__':
    unittest.main()
