import importlib
import json
import os
import tempfile
import unittest
from unittest.mock import patch, sentinel

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestBackendServiceExtraction(unittest.TestCase):
    def test_backend_modules_export_extracted_services(self):
        jira_client = importlib.import_module('backend.jira_client')
        config_store = importlib.import_module('backend.config_store')

        self.assertTrue(hasattr(jira_client, 'resilient_jira_get'))
        self.assertTrue(hasattr(jira_client, 'jira_search_request'))
        self.assertTrue(hasattr(config_store, 'load_dashboard_config'))
        self.assertTrue(hasattr(config_store, 'save_dashboard_config'))

    def test_jira_search_wrapper_keeps_patchable_request_and_next_page_token(self):
        with patch.object(jira_server, 'JIRA_URL', 'http://jira.example'), \
             patch.object(jira_server, 'resilient_jira_get', return_value=sentinel.response) as mock_get:
            response = jira_server.jira_search_request({'Authorization': 'Basic test'}, {
                'jql': 'project = TEST',
                'fields': ['summary', 'status'],
                'maxResults': 50,
                'nextPageToken': 'page-2'
            })

        self.assertIs(response, sentinel.response)
        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        self.assertEqual(args[0], 'http://jira.example/rest/api/3/search/jql')
        self.assertEqual(kwargs['params']['nextPageToken'], 'page-2')
        self.assertEqual(kwargs['params']['fields'], 'summary,status')

    def test_jira_client_requires_injected_request_state(self):
        jira_client = importlib.import_module('backend.jira_client')
        with self.assertRaises(ValueError):
            jira_client.resilient_jira_get('http://jira.example/rest/api/3/search/jql')

    def test_config_wrappers_keep_patchable_paths_and_migration_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            dashboard_path = os.path.join(tmp, 'dashboard-config.json')
            groups_path = os.path.join(tmp, 'team-groups.json')
            team_catalog_path = os.path.join(tmp, 'team-catalog.json')
            legacy_groups = {
                'version': 1,
                'groups': [{'id': 'g1', 'name': 'Team A', 'teamIds': ['team-1']}],
                'defaultGroupId': 'g1'
            }
            with open(groups_path, 'w') as handle:
                json.dump(legacy_groups, handle)

            with patch.object(jira_server, 'DASHBOARD_CONFIG_PATH', dashboard_path), \
                 patch.object(jira_server, 'GROUPS_CONFIG_PATH', groups_path), \
                 patch.object(jira_server, 'TEAM_CATALOG_PATH', team_catalog_path):
                migrated = jira_server.load_dashboard_config()
                self.assertEqual(migrated, {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': legacy_groups
                })
                self.assertEqual(jira_server.load_dashboard_config(), migrated)

                saved_catalog = jira_server.save_team_catalog_file({
                    'catalog': {'team-1': {'name': 'Team A'}},
                    'meta': {'source': 'test'}
                })
                self.assertEqual(saved_catalog['catalog']['team-1']['name'], 'Team A')
                self.assertTrue(os.path.exists(team_catalog_path))
                self.assertEqual(jira_server.load_team_catalog(), saved_catalog)


if __name__ == '__main__':
    unittest.main()
