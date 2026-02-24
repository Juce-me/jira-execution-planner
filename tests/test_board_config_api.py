import json
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover - depends on local test env deps
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestBoardConfigApi(unittest.TestCase):
    def test_get_effective_board_id_prefers_dashboard_config_over_env(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'dashboard-config.json')
            with open(config_path, 'w', encoding='utf-8') as handle:
                json.dump({'version': 1, 'projects': {'selected': []}, 'teamGroups': {}, 'board': {'boardId': '999', 'boardName': 'Ops Board'}}, handle)

            with patch.object(jira_server, 'DASHBOARD_CONFIG_PATH', config_path), \
                 patch.object(jira_server, 'JIRA_BOARD_ID', '5715'):
                self.assertEqual(jira_server.get_effective_board_id(), '999')
                board_cfg = jira_server.get_board_config()
                self.assertEqual(board_cfg['source'], 'config')
                self.assertEqual(board_cfg['boardName'], 'Ops Board')

    def test_board_config_api_saves_and_invalidates_caches(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, 'dashboard-config.json')
            sprints_cache_path = os.path.join(tmpdir, 'sprints_cache.json')
            with open(sprints_cache_path, 'w', encoding='utf-8') as handle:
                handle.write('{"sprints":[]}')

            app = jira_server.app
            app.testing = True
            client = app.test_client()

            with patch.object(jira_server, 'DASHBOARD_CONFIG_PATH', config_path), \
                 patch.object(jira_server, 'SPRINTS_CACHE_FILE', sprints_cache_path), \
                 patch.object(jira_server, 'TASKS_CACHE', {'dummy': {'value': 1}}):
                response = client.post('/api/board-config', json={'boardId': '5715', 'boardName': 'Planning Board'})
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                payload = response.get_json()
                self.assertEqual(payload['boardId'], '5715')
                self.assertEqual(payload['boardName'], 'Planning Board')

                self.assertFalse(os.path.exists(sprints_cache_path), 'sprints cache file should be removed after board save')
                self.assertEqual(jira_server.TASKS_CACHE, {}, 'tasks cache should be cleared after board save')

                get_response = client.get('/api/board-config')
                self.assertEqual(get_response.status_code, 200)
                get_payload = get_response.get_json()
                self.assertEqual(get_payload['boardId'], '5715')
                self.assertEqual(get_payload['source'], 'config')


if __name__ == '__main__':
    unittest.main()
