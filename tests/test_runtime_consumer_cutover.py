"""DB OAuth consumer contracts; run through run_isolated_runtime_tests.py."""

import ast
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask

from backend.auth import cache_policy, project_access
from backend.auth.jira_auth import AuthError
from backend.config.repository import ConfigStorageError, selected_config_storage_backend
from backend.db import engine
from backend.epm import home
from backend.routes import eng_board_routes


def actor(**changes):
    values = dict(auth_mode='atlassian_oauth', workspace_id='workspace-a', user_id='user-a',
                  auth_connection_id='connection-a', cloud_id='site-a', token_version=1,
                  project_access=())
    values.update(changes)
    return SimpleNamespace(**values)


class RuntimeConsumerCutoverTests(unittest.TestCase):
    def test_unbound_capacity_helpers_require_explicit_artifact_access(self):
        import jira_server
        with patch.object(jira_server, '_load_dashboard_config_json',
                          side_effect=AssertionError('implicit JSON read')) as legacy:
            for call in (
                lambda: jira_server.get_capacity_config(),
                lambda: jira_server._load_capacity_config_for_operation(None, None),
                lambda: jira_server.load_request_capacity_config(actor(auth_mode='basic')),
            ):
                with self.subTest(call=call), self.assertRaises(ConfigStorageError):
                    call()
            legacy.assert_not_called()

    def test_default_and_alias_selectors_agree(self):
        for value in (None, '', '  ', 'db', ' database ', 'postgres', 'POSTGRESQL'):
            with self.subTest(value=value):
                env = {} if value is None else {'CONFIG_STORAGE_BACKEND': value}
                self.assertEqual(selected_config_storage_backend(env), 'db')
                self.assertTrue(engine.database_storage_enabled(env))

    def test_json_runtime_selector_rejects_without_echoing_value(self):
        for value in ('jsonfile', 'untrusted-selector'):
            with self.subTest(value=value), self.assertRaises(ConfigStorageError) as raised:
                selected_config_storage_backend({'CONFIG_STORAGE_BACKEND': value})
            self.assertNotIn(value, str(raised.exception))

    def test_default_db_requires_url(self):
        with self.assertRaises(engine.DatabaseConfigurationError):
            engine.resolve_database_url(environ={})

    def test_db_alias_preserves_selected_url_and_test_override(self):
        env = {'CONFIG_STORAGE_BACKEND': ' postgresql ',
               'DATABASE_URL': 'postgresql+psycopg://fixture@localhost/fixture',
               'TEST_DATABASE_URL': 'postgresql+psycopg://fixture@localhost/fixture_test',
               'JIRA_EMAIL': 'inert', 'JIRA_TOKEN': 'inert'}
        self.assertEqual(engine.resolve_database_url(env), env['DATABASE_URL'])
        self.assertEqual(engine.resolve_database_url(env, testing=True), env['TEST_DATABASE_URL'])

    def test_connection_mode_and_cloud_sql_validation_unchanged(self):
        with self.assertRaises(engine.DatabaseConfigurationError):
            engine.resolve_database_connection_mode({'DATABASE_CONNECTION_MODE': 'unknown'})
        self.assertEqual(engine.validate_startup_database_config({
            'DATABASE_URL': 'postgresql+psycopg://fixture@localhost/fixture',
        }), 'url')
        with self.assertRaises(engine.DatabaseConfigurationError):
            engine.validate_startup_database_config({
                'DATABASE_URL': 'mysql+pymysql://fixture@localhost/fixture', 'DATABASE_CONNECTION_MODE': 'cloud_sql_iam',
            })

    def test_basic_missing_and_local_contexts_never_enable_process_cache(self):
        for context in (None, actor(auth_mode='basic'), actor(auth_connection_id='local-oauth'),
                        actor(auth_connection_id=''), actor(token_version='')):
            with self.subTest(context=context):
                self.assertFalse(cache_policy.jira_home_process_cache_enabled(context))
                self.assertFalse(cache_policy.jira_home_partitioned_process_cache_enabled(context))
                self.assertIsNone(cache_policy.build_jira_home_cache_partition(context))

    def test_db_cache_partitions_identity_token_and_project_authority(self):
        context = actor()
        self.assertTrue(cache_policy.jira_home_partitioned_process_cache_enabled(context))
        key = cache_policy.build_jira_home_process_cache_key(context, 'query')
        self.assertIsInstance(key, tuple)
        self.assertTrue(cache_policy.cache_key_in_jira_home_partition(key, context))
        for change in ({'workspace_id': 'workspace-b'}, {'user_id': 'user-b', 'auth_connection_id': 'connection-b'},
                       {'token_version': 2}, {'project_access': (SimpleNamespace(
                           project_key='DEMO', project_type='product', status='inaccessible'),)}):
            with self.subTest(change=change):
                other = actor(**change)
                self.assertNotEqual(cache_policy.build_jira_home_process_cache_key(other, 'query'), key)
                self.assertFalse(cache_policy.cache_key_in_jira_home_partition(key, other))

    def test_basic_project_access_no_longer_bypasses_snapshot_status(self):
        context = actor(auth_mode='basic')
        self.assertEqual(project_access.project_access_status(context, 'product'), 'unknown')
        with Flask(__name__).app_context():
            response, status = project_access.project_access_denied_response(context, 'product')
            self.assertEqual(status, 403)
            self.assertEqual(response.get_json()['error'], 'missing_project_access')

    def test_oauth_project_probe_remains_available_without_snapshot(self):
        self.assertEqual(project_access.project_access_denied_response(actor(), 'product'), (None, None))
        accessible = SimpleNamespace(project_key='DEMO', project_type='product', status='accessible')
        self.assertEqual(project_access.project_access_status(actor(project_access=(accessible,)), 'product'), 'accessible')

    def test_home_has_no_basic_client_factory_or_environment_credential_loader(self):
        for name in ('HomeGraphQLClient', 'build_home_graphql_client', 'build_teamwork_graph_client',
                     '_home_basic_credentials', '_read_metadata_credential'):
            self.assertFalse(hasattr(home, name), name)

    def test_home_missing_strict_authority_fails_without_network(self):
        with patch.object(home, 'urlopen', side_effect=AssertionError('forbidden network')):
            with self.assertRaises(AuthError):
                home.fetch_home_site_cloud_id(actor())
            with self.assertRaises(AuthError):
                home.fetch_epm_home_projects({'subGoalKey': 'GOAL-1'}, context=actor())
            with self.assertRaises(AuthError):
                home.fetch_project_tags(SimpleNamespace(), {'id': 'project-a'})
            with self.assertRaises(AuthError):
                home.resolve_goal_by_key(SimpleNamespace(), 'GOAL-1', 'site-a')

    def test_strict_home_keeps_fixed_bearer_and_registered_public_operation(self):
        response = io.BytesIO(json.dumps({'data': {'projects_byId': {'tags': []}}}).encode())
        response.status = 200
        response.headers = {}
        with patch.object(home, 'urlopen', return_value=response) as opened:
            client = home.build_home_oauth_graphql_client('fixture-access-token')
            self.assertEqual(home.fetch_project_tags(client, {'id': 'project-a'}), [])
        request = opened.call_args.args[0]
        self.assertEqual(request.full_url, home.HOME_OAUTH_GRAPHQL_ENDPOINT)
        self.assertEqual(request.get_header('Authorization'), 'Bearer fixture-access-token')
        payload = json.loads(request.data)
        self.assertEqual(payload['query'], home.PUBLIC_READ_V1_REGISTRY['projectTags']['query'])
        self.assertNotIn('cypherQuery', payload['query'])

    def test_strict_project_row_keeps_embedded_updates_and_tags_without_fanout(self):
        client = home.build_home_oauth_graphql_client('fixture-access-token')
        row = {'id': 'project-a', 'name': 'Synthetic project', 'state': {'value': 'ON_TRACK'},
               'tags': {'edges': [{'node': {'name': 'fixture_tag'}}]}, 'updates': {'edges': []}}
        with patch.object(home, 'urlopen', side_effect=AssertionError('forbidden fanout')):
            record = home._fetch_or_build_home_project_record(client, row)
        self.assertEqual(record['homeProjectId'], 'project-a')
        self.assertEqual(record['homeTags'], ['fixture_tag'])
        self.assertEqual(record['latestUpdateSnippet'], '')
        with self.assertRaises(home.HomeReadError):
            home._fetch_or_build_home_project_record(client, {'id': 'project-a'})

    def test_strict_home_rejects_unknown_document_before_network(self):
        with patch.object(home, 'urlopen', side_effect=AssertionError('forbidden network')):
            with self.assertRaises(home.HomeReadError) as raised:
                home.build_home_oauth_graphql_client('fixture-access-token').execute('mutation { unsafe }')
        self.assertEqual(raised.exception.category, 'unregistered_operation')

    def test_board_has_no_basic_dispatch_or_import(self):
        source = Path(eng_board_routes.__file__).read_text()
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                self.assertFalse(any('eng_board_basic' in alias.name for alias in node.names))
        for name in ('_capture_basic_snapshot', '_assert_basic_snapshot_current', '_basic_request_checkpoint'):
            self.assertFalse(hasattr(eng_board_routes, name))

    def test_board_basic_profile_cannot_reach_snapshot_or_jira(self):
        app = Flask(__name__)
        app.register_blueprint(eng_board_routes.bp)
        with patch.object(eng_board_routes, 'get_jira_server', return_value=SimpleNamespace(JIRA_AUTH_MODE='basic')):
            with patch.object(eng_board_routes, '_capture_snapshot', side_effect=AssertionError('forbidden capture')):
                response = app.test_client().get('/api/eng/board?departmentId=group-a&scope=all_work')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['error'], 'board_unavailable')

    def test_board_db_search_passes_context_and_401_requires_auth(self):
        context = actor()
        search = unittest.mock.Mock(return_value=SimpleNamespace(status_code=401))
        with self.assertRaises(AuthError):
            eng_board_routes._search_page(SimpleNamespace(current_jira_search=search),
                                         SimpleNamespace(context=context), object(), {'jql': 'synthetic'}, 5)
        self.assertIs(search.call_args.kwargs['context'], context)


if __name__ == '__main__':
    unittest.main()
