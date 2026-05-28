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
        local_oauth_store = importlib.import_module('backend.auth.local_oauth_store')
        capacity_service = importlib.import_module('backend.services.capacity')
        sprint_service = importlib.import_module('backend.services.sprints')
        stats_cache_service = importlib.import_module('backend.services.stats_cache')
        update_check_service = importlib.import_module('backend.services.update_check')
        priority_weights_service = importlib.import_module('backend.services.priority_weights')
        team_catalog_service = importlib.import_module('backend.services.team_catalog')
        config_store = importlib.import_module('backend.config_store')
        epm_config = importlib.import_module('backend.epm.config')
        epm_aggregate = importlib.import_module('backend.epm.aggregate')
        epm_issues = importlib.import_module('backend.epm.issues')
        epm_payload = importlib.import_module('backend.epm.payload')

        self.assertTrue(hasattr(jira_client, 'resilient_jira_get'))
        self.assertTrue(hasattr(jira_client, 'jira_search_request'))
        self.assertTrue(hasattr(capacity_service, 'fetch_capacity_for_sprint'))
        self.assertTrue(hasattr(capacity_service, 'fetch_capacity_team_sizes'))
        self.assertTrue(hasattr(sprint_service, 'fetch_sprints_from_jira'))
        self.assertTrue(hasattr(sprint_service, 'deduplicate_sprints_by_name'))
        self.assertTrue(hasattr(stats_cache_service, 'load_stats_cache'))
        self.assertTrue(hasattr(stats_cache_service, 'build_stats_cache_key'))
        self.assertTrue(hasattr(update_check_service, 'build_update_check_payload'))
        self.assertTrue(hasattr(update_check_service, 'run_git_command'))
        self.assertTrue(hasattr(priority_weights_service, 'build_priority_weights_config'))
        self.assertTrue(hasattr(priority_weights_service, 'normalize_priority_weight_rows'))
        self.assertTrue(hasattr(team_catalog_service, 'normalize_team_catalog'))
        self.assertTrue(hasattr(team_catalog_service, 'normalize_group_team_labels'))
        self.assertTrue(hasattr(local_oauth_store, 'LocalOAuthTokenStore'))
        self.assertTrue(hasattr(config_store, 'load_dashboard_config'))
        self.assertTrue(hasattr(config_store, 'save_dashboard_config'))
        self.assertTrue(hasattr(epm_config, 'normalize_epm_config'))
        self.assertTrue(hasattr(epm_aggregate, 'build_all_epm_projects_rollup'))
        self.assertTrue(hasattr(epm_issues, 'build_epm_project_issues_payload'))
        self.assertTrue(hasattr(epm_payload, 'build_epm_rollup_hierarchy'))
        self.assertTrue(hasattr(jira_client, 'fetch_issues_by_jql'))
        self.assertTrue(hasattr(jira_client, 'fetch_issues_by_keys'))

    def test_epm_issues_orchestration_lives_in_epm_package(self):
        epm_issues = importlib.import_module('backend.epm.issues')
        route_module = importlib.import_module('backend.routes.epm_routes')
        with open(route_module.__file__, encoding='utf-8') as handle:
            route_source = handle.read()

        self.assertTrue(hasattr(epm_issues, 'EpmIssuesDependencies'))
        self.assertIn('build_epm_project_issues_response', route_source)
        self.assertNotIn('fetch_issues_by_jql(jql, build_epm_fields_list()', route_source)
        self.assertNotIn('EPM_ISSUES_CACHE.get(cache_key)', route_source)

    def test_local_oauth_store_mechanics_live_in_auth_package(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn('def _read_persistent_oauth_token_store(', server_source)
        self.assertNotIn('def _write_persistent_oauth_token_store(', server_source)
        self.assertNotIn('def _cleanup_expired_oauth_sessions(', server_source)

    def test_epm_payload_helpers_live_in_epm_package_with_compatibility_aliases(self):
        epm_payload = importlib.import_module('backend.epm.payload')
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertIs(jira_server.dedupe_issues_by_key, epm_payload.dedupe_issues_by_key)
        self.assertIs(jira_server.validate_epm_tab_sprint, epm_payload.validate_epm_tab_sprint)
        self.assertIs(jira_server.normalize_epm_issue_type_sets, epm_payload.normalize_epm_issue_type_sets)
        self.assertIs(jira_server.build_empty_epm_rollup_payload, epm_payload.build_empty_epm_rollup_payload)
        self.assertIs(jira_server.build_epm_rollup_hierarchy, epm_payload.build_epm_rollup_hierarchy)
        self.assertNotIn('def normalize_epm_issue_type_sets(', server_source)
        self.assertNotIn('def build_epm_rollup_hierarchy(', server_source)

    def test_epm_config_normalizers_live_in_epm_package_with_compatibility_aliases(self):
        epm_config = importlib.import_module('backend.epm.config')
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertIs(jira_server.normalize_epm_config, epm_config.normalize_epm_config)
        self.assertIs(jira_server.normalize_epm_scope, epm_config.normalize_epm_scope)
        self.assertIs(jira_server.normalize_epm_issue_types, epm_config.normalize_epm_issue_types)
        self.assertNotIn('def normalize_epm_config(', server_source)
        self.assertNotIn('def normalize_epm_scope(', server_source)
        self.assertNotIn('def normalize_epm_issue_types(', server_source)

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

    def test_jira_issue_fetch_pagination_lives_in_backend_jira_client(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn('while len(results) < max_results:', server_source)
        self.assertNotIn('for i in range(0, len(keys), batch_size):', server_source)

    def test_capacity_service_logic_lives_outside_jira_server_and_routes_do_not_delegate(self):
        route_module = importlib.import_module('backend.routes.capacity_routes')
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()
        with open(route_module.__file__, encoding='utf-8') as handle:
            route_source = handle.read()

        self.assertNotIn('def build_capacity_jql(sprint_name, team_names=None):\n    capacity_project = get_effective_capacity_project()', server_source)
        self.assertNotIn('def fetch_capacity_for_sprint(sprint_name, headers, debug=False, team_names=None):\n    if not get_effective_capacity_project():', server_source)
        self.assertNotIn('return get_jira_server().get_capacity()', route_source)
        self.assertNotIn('return get_jira_server().get_planned_capacity()', route_source)

    def test_sprint_service_logic_lives_outside_jira_server(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn("with open(SPRINTS_CACHE_FILE, 'r') as f:", server_source)
        self.assertNotIn("with open(SPRINTS_CACHE_FILE, 'w') as f:", server_source)
        self.assertNotIn("while True:\n            response = current_jira_get(\n                f'/rest/agile/1.0/board/{board_id}/sprint'", server_source)
        self.assertNotIn("def collect_sprints_by_jql(jql_query, sprints_dict):", server_source)
        self.assertNotIn("STATE_PRIORITY = {'active': 0, 'closed': 1, 'future': 2}", server_source)

    def test_stats_cache_service_logic_lives_outside_jira_server(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn("with open(STATS_CACHE_FILE, 'r') as f:", server_source)
        self.assertNotIn("with open(STATS_CACHE_FILE, 'w') as f:", server_source)
        self.assertNotIn('raw = f"{sprint_name}::{base_jql}::', server_source)
        self.assertNotIn("if os.path.exists(STATS_CACHE_FILE):\n            os.remove(STATS_CACHE_FILE)", server_source)

    def test_update_check_service_logic_lives_outside_jira_server(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn('import subprocess', server_source)
        self.assertNotIn('subprocess.run(', server_source)
        self.assertNotIn("local_hash, local_err = run_git_command(['rev-parse', 'HEAD'])", server_source)
        self.assertNotIn("remote_output, remote_err = run_git_command(['ls-remote', UPDATE_CHECK_REMOTE", server_source)

    def test_priority_weight_service_logic_lives_outside_jira_server(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn("for chunk in str(raw).split(','):", server_source)
        self.assertNotIn("raise ValueError(f'duplicate priority: {priority}')", server_source)
        self.assertNotIn("return {'weights': build_priority_weight_defaults(), 'source': 'default'}", server_source)

    def test_team_catalog_service_logic_lives_outside_jira_server(self):
        with open(jira_server.__file__, encoding='utf-8') as handle:
            server_source = handle.read()

        self.assertNotIn("catalog[team_id] = {'id': team_id, 'name': name}", server_source)
        self.assertNotIn("for key in ('updatedAt', 'sprintId', 'sprintName', 'source', 'resolvedAt'):", server_source)
        self.assertNotIn("labels[team_id] = label", server_source)

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
                migrated = jira_server.load_dashboard_config(source='jsonfile')
                self.assertEqual(migrated, {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': legacy_groups
                })
                self.assertEqual(jira_server.load_dashboard_config(source='jsonfile'), migrated)

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
