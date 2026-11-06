import unittest
from unittest.mock import patch

from backend.db import engine as db_engine, models
from tests.auth_mode_test_utils import force_db_oauth_mode

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestPriorityWeightsConfigApi(unittest.TestCase):
    def setUp(self):
        force_db_oauth_mode(self, jira_server)

    def test_env_priority_weights_parsing_and_aliases(self):
        rows = jira_server.parse_stats_priority_weights_env('Highest:0.4,Critical:0.3,Major:0.2,Low:0.1')
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]['priority'], 'Highest')
        self.assertAlmostEqual(rows[0]['weight'], 0.4)

    def revision(self, client):
        response = client.get('/api/stats/priority-weights-config')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()['configRevision']

    def test_get_priority_weights_prefers_workspace_config(self):
        with db_engine.session_scope() as db:
            row = db.query(models.WorkspaceDashboardConfig).one()
            row.payload = {**row.payload, 'statsPriorityWeights': [{'priority': 'Major', 'weight': 0.25}]}
        with patch.object(jira_server, 'STATS_PRIORITY_WEIGHTS', 'Major:0.99'):
            payload = jira_server.get_priority_weights_config()
            self.assertEqual(payload['source'], 'config')
            self.assertEqual(payload['weights'][0]['priority'], 'Major')
            self.assertAlmostEqual(payload['weights'][0]['weight'], 0.25)

    def test_priority_weights_api_save_and_get(self):
        client = jira_server.app.test_client()
        revision = self.revision(client)
        weights = [{'priority': 'Blocker', 'weight': 0.5}, {'priority': 'Critical', 'weight': 0.3}]
        response = client.post('/api/stats/priority-weights-config', json={
            'baseRevision': revision, 'weights': weights,
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload['source'], 'config')
        self.assertEqual(payload['configRevision'], revision + 1)
        self.assertEqual(client.get('/api/stats/priority-weights-config').get_json(), payload)
        with db_engine.session_scope() as db:
            row = db.query(models.WorkspaceDashboardConfig).one()
            self.assertEqual(row.payload['statsPriorityWeights'], weights)
        stale = client.post('/api/stats/priority-weights-config', json={
            'baseRevision': revision, 'weights': [{'priority': 'Low', 'weight': 0.1}],
        })
        self.assertEqual(stale.status_code, 409, stale.get_data(as_text=True))
        self.assertEqual(client.get('/api/stats/priority-weights-config').get_json(), payload)

    def assert_invalid_weights_unchanged(self, weights, expected_error):
        client = jira_server.app.test_client()
        before = client.get('/api/stats/priority-weights-config').get_json()
        response = client.post('/api/stats/priority-weights-config', json={
            'baseRevision': before['configRevision'], 'weights': weights,
        })
        self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
        self.assertIn(expected_error, response.get_json()['error'].lower())
        self.assertEqual(client.get('/api/stats/priority-weights-config').get_json(), before)

    def test_priority_weights_api_rejects_duplicates(self):
        self.assert_invalid_weights_unchanged(
            [{'priority': 'Blocker', 'weight': 0.4}, {'priority': 'Highest', 'weight': 0.5}],
            'duplicate priority')

    def test_priority_weights_api_rejects_unknown_nested_fields(self):
        self.assert_invalid_weights_unchanged(
            [{'priority': 'Blocker', 'weight': 0.5, 'unexpected': 'value'}], 'unsupported')


if __name__ == '__main__':
    unittest.main()
