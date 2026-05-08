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
        with patch.object(jira_server, 'current_jira_search', return_value=sentinel.response) as mock_search:
            response = jira_server.jira_search_request({
                'jql': 'project = TEST',
                'fields': ['summary', 'status'],
                'maxResults': 50,
                'nextPageToken': 'page-2'
            })

        self.assertIs(response, sentinel.response)
        mock_search.assert_called_once_with({
            'jql': 'project = TEST',
            'fields': ['summary', 'status'],
            'maxResults': 50,
            'nextPageToken': 'page-2'
        })

    def test_search_params_reject_start_at_for_search_jql(self):
        jira_client = importlib.import_module("backend.jira_client")
        with self.assertRaises(ValueError):
            jira_client.build_jira_search_params({"jql": "project = PROD", "startAt": 50, "maxResults": 100})

    def test_search_params_allow_next_page_token(self):
        jira_client = importlib.import_module("backend.jira_client")
        params = jira_client.build_jira_search_params({
            "jql": "project = PROD",
            "nextPageToken": "page-2",
            "maxResults": 100,
        })

        self.assertEqual(params["nextPageToken"], "page-2")
        self.assertNotIn("startAt", params)

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

    def test_dashboard_config_save_uses_atomic_replace(self):
        config_store = importlib.import_module('backend.config_store')
        with tempfile.TemporaryDirectory() as tmp:
            dashboard_path = os.path.join(tmp, 'dashboard-config.json')
            with patch.object(config_store.os, 'replace', wraps=config_store.os.replace) as mock_replace:
                config_store.save_dashboard_config({'version': 1}, dashboard_path)

            self.assertEqual(mock_replace.call_count, 1)
            self.assertEqual(mock_replace.call_args[0][1], dashboard_path)
            with open(dashboard_path, 'r') as handle:
                self.assertEqual(json.load(handle), {'version': 1})


if __name__ == '__main__':
    unittest.main()
