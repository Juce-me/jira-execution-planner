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
            {'version': 1, 'scope': {'rootGoalKey': '', 'subGoalKey': ''}, 'projects': {}},
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
                'version': 1,
                'scope': {
                    'rootGoalKey': '',
                    'subGoalKey': 'CHILD-200',
                },
                'projects': {},
            },
        )

    def test_get_epm_config_normalizes_existing_saved_config(self):
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
                                'homeProjectId': 'wrong-project-id',
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
                'version': 1,
                'scope': {
                    'rootGoalKey': 'ROOT-100',
                    'subGoalKey': 'CHILD-200',
                },
                'projects': {
                    'tsq-1': {
                        'homeProjectId': 'tsq-1',
                        'customName': 'synthetic launch',
                        'jiraLabel': 'synthetic_label_alpha',
                        'jiraEpicKey': 'SYN-123',
                    }
                },
            },
        )

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
            self.assertEqual(payload['version'], 1)
            self.assertEqual(payload['scope']['rootGoalKey'], 'ROOT-100')
            self.assertEqual(payload['scope']['subGoalKey'], 'CHILD-200')
            self.assertEqual(payload['projects']['tsq-1']['customName'], 'Synthetic Launch')
            self.assertEqual(payload['projects']['tsq-1']['jiraLabel'], 'synthetic_label_alpha')
            self.assertEqual(payload['projects']['tsq-1']['jiraEpicKey'], 'SYN-123')

            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.TASKS_CACHE, {'dummy': {'value': 3}})

        with open(self._dashboard_path, 'r', encoding='utf-8') as handle:
            saved = json.load(handle)

        self.assertIn('teamGroups', saved)
        self.assertEqual(saved['teamGroups']['version'], 1)
        self.assertEqual(saved['epm']['scope']['rootGoalKey'], 'ROOT-100')
        self.assertEqual(saved['epm']['scope']['subGoalKey'], 'CHILD-200')
        self.assertEqual(saved['epm']['projects']['tsq-1']['jiraEpicKey'], 'SYN-123')
        self.assertEqual(saved['epm']['projects']['tsq-1']['jiraLabel'], 'synthetic_label_alpha')
        self.assertEqual(saved['epm']['projects']['tsq-1']['customName'], 'Synthetic Launch')


if __name__ == '__main__':
    unittest.main()
