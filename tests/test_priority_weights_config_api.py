import json
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestPriorityWeightsConfigApi(unittest.TestCase):
    def test_env_priority_weights_parsing_and_aliases(self):
        rows = jira_server.parse_stats_priority_weights_env('Highest:0.4,Critical:0.3,Major:0.2,Low:0.1')
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]['priority'], 'Highest')
        self.assertAlmostEqual(rows[0]['weight'], 0.4)

    def test_get_priority_weights_prefers_dashboard_config(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'dashboard-config.json')
            with open(config_path, 'w', encoding='utf-8') as handle:
                json.dump({
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {},
                    'statsPriorityWeights': [{'priority': 'Major', 'weight': 0.25}]
                }, handle)
            with patch.object(jira_server, 'DASHBOARD_CONFIG_PATH', config_path), \
                 patch.object(jira_server, 'STATS_PRIORITY_WEIGHTS', 'Major:0.99'):
                payload = jira_server.get_priority_weights_config()
                self.assertEqual(payload['source'], 'config')
                self.assertEqual(payload['weights'][0]['priority'], 'Major')
                self.assertAlmostEqual(payload['weights'][0]['weight'], 0.25)

    def test_priority_weights_api_save_and_get(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'dashboard-config.json')
            app = jira_server.app
            app.testing = True
            client = app.test_client()

            with patch.object(jira_server, 'DASHBOARD_CONFIG_PATH', config_path):
                response = client.post('/api/stats/priority-weights-config', json={
                    'weights': [
                        {'priority': 'Blocker', 'weight': 0.5},
                        {'priority': 'Critical', 'weight': 0.3},
                    ]
                })
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                payload = response.get_json()
                self.assertEqual(payload['source'], 'config')

                get_response = client.get('/api/stats/priority-weights-config')
                self.assertEqual(get_response.status_code, 200)
                get_payload = get_response.get_json()
                self.assertEqual(get_payload['source'], 'config')
                self.assertEqual(len(get_payload['weights']), 2)

    def test_priority_weights_api_rejects_duplicates(self):
        app = jira_server.app
        app.testing = True
        client = app.test_client()
        response = client.post('/api/stats/priority-weights-config', json={
            'weights': [
                {'priority': 'Blocker', 'weight': 0.4},
                {'priority': 'Highest', 'weight': 0.5},
            ]
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn('duplicate priority', (response.get_json() or {}).get('error', '').lower())


if __name__ == '__main__':
    unittest.main()
