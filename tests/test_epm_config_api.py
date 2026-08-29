import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from flask import has_request_context
from backend.auth.context import RequestAuthContext
from backend.db import engine as db_engine
from backend.db import models
from backend.services.user_view_config import save_user_epm_config
from tests.auth_mode_test_utils import force_basic_auth_mode

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
        force_basic_auth_mode(self, jira_server)
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
                'scope': {'rootGoalKey': '', 'subGoalKeys': []},
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {},
            },
        )

    def test_epm_cache_generation_uses_only_normalized_settings(self):
        first = {
            'version': 2,
            'labelPrefix': ' rnd_project_ ',
            'scope': {'rootGoalKey': ' root-1 ', 'subGoalKeys': [' child-1 ']},
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {},
            'tab': 'active',
            'selectedSprint': 'Sprint 1',
        }
        equivalent = {
            **first,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': ['CHILD-1']},
            'tab': 'backlog',
            'selectedSprint': 'Sprint 2',
        }

        generation = jira_server.build_epm_config_generation(first)

        self.assertRegex(generation, r'^[0-9a-f]{64}$')
        self.assertEqual(generation, jira_server.build_epm_config_generation(equivalent))
        self.assertNotEqual(
            generation,
            jira_server.build_epm_config_generation({**equivalent, 'labelPrefix': 'other_*'}),
        )
        self.assertNotIn('ROOT-1', generation)
        self.assertNotIn('rnd_project_', generation)

    def test_db_epm_resolver_requires_explicit_or_request_context(self):
        with patch.object(jira_server, 'config_storage_db_enabled', return_value=True), \
             patch.object(jira_server, 'has_request_context', return_value=False):
            with self.assertRaises(jira_server.ConfigStorageError):
                jira_server.get_epm_config()

    def test_db_epm_resolver_loads_current_users_private_default(self):
        context = object()
        repository = unittest.mock.Mock()
        repository.load_user_epm_config.return_value = {
            'version': 2,
            'labelPrefix': 'private_*',
            'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': []},
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {},
        }
        with patch.object(jira_server, 'config_storage_db_enabled', return_value=True), \
             patch.object(jira_server, 'build_db_config_repository', return_value=repository):
            payload = jira_server.get_epm_config(context=context)

        self.assertEqual(payload['labelPrefix'], 'private_*')
        repository.load_user_epm_config.assert_called_once_with(context)

    def test_db_epm_resolver_reads_seeded_private_defaults_by_user_and_workspace(self):
        database_url = f"sqlite+pysqlite:///{os.path.join(self._tmpdir, 'private-defaults.db')}"
        engine = db_engine.get_engine(database_url)
        models.Base.metadata.create_all(engine)
        factory = db_engine.session_factory(database_url)
        with factory() as session:
            workspaces = [
                models.Workspace(
                    environment_key=f'private-{index}', name=f'Private {index}',
                    jira_site_url=f'https://private-{index}.example.net', jira_cloud_id=f'cloud-{index}',
                    created_by='test',
                ) for index in range(2)
            ]
            users = [
                models.User(
                    external_provider='atlassian', external_subject=f'private-user-{index}',
                    account_type='user', status='active', created_by='test',
                ) for index in range(2)
            ]
            session.add_all(workspaces + users)
            session.flush()
            workspace_ids = [row.id for row in workspaces]
            user_ids = [row.id for row in users]
            session.commit()

        def context(user_index, workspace_index):
            return RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=user_ids[user_index],
                stable_subject=f'subject-{user_index}', atlassian_account_id=f'account-{user_index}',
                workspace_id=workspace_ids[workspace_index], auth_connection_id=f'connection-{user_index}-{workspace_index}',
                cloud_id=f'cloud-{workspace_index}', site_url=f'https://private-{workspace_index}.example.net',
                token_version='1', account_status='active', is_admin=False,
            )

        contexts = (context(0, 0), context(1, 0), context(0, 1))
        for index, request_context in enumerate(contexts):
            save_user_epm_config(request_context, {
                'version': 2, 'labelPrefix': f'private_{index}_*',
                'scope': {'rootGoalKey': f'ROOT-{index}', 'subGoalKeys': [f'GOAL-{index}']},
                'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {},
            }, database_url=database_url)

        with patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': database_url,
        }, clear=False), patch.object(jira_server, 'config_storage_db_enabled', return_value=True):
            loaded = [jira_server.get_epm_config(context=request_context) for request_context in contexts]
            with self.app.test_request_context('/api/epm/projects/rollup/all'), patch.object(
                jira_server, 'current_request_auth_context', return_value=contexts[0],
            ), patch.object(jira_server, 'fetch_epm_home_projects', return_value=[]):
                projects_dependencies = jira_server.build_epm_projects_dependencies()
                rollup_dependencies = jira_server.build_epm_rollup_dependencies()

            def inspect_captured_worker_dependencies():
                return {
                    'hasRequestContext': has_request_context(),
                    'projectsConfig': projects_dependencies.get_epm_config(),
                    'projectsDigest': projects_dependencies.config_generation,
                    'rollupConfig': rollup_dependencies.get_epm_config(),
                    'rollupDigest': rollup_dependencies.config_generation,
                }

            with ThreadPoolExecutor(max_workers=1) as executor:
                captured = executor.submit(inspect_captured_worker_dependencies).result()
            with patch.object(jira_server, 'has_request_context', return_value=False):
                with self.assertRaises(jira_server.ConfigStorageError):
                    jira_server.get_epm_config()

        self.assertEqual([item['labelPrefix'] for item in loaded], [
            'private_0_*', 'private_1_*', 'private_2_*',
        ])
        self.assertFalse(captured['hasRequestContext'])
        self.assertEqual(captured['projectsConfig']['labelPrefix'], 'private_0_*')
        self.assertEqual(captured['rollupConfig']['labelPrefix'], 'private_0_*')
        expected_digest = jira_server.build_epm_config_generation(loaded[0])
        self.assertEqual(captured['projectsDigest'], expected_digest)
        self.assertEqual(captured['rollupDigest'], expected_digest)
        db_engine.dispose_engines()
        os.unlink(os.path.join(self._tmpdir, 'private-defaults.db'))

    def test_runtime_routes_isolate_real_private_defaults_by_user_and_workspace(self):
        from backend.routes import auth_routes

        database_path = os.path.join(self._tmpdir, 'route-private-defaults.db')
        database_url = f'sqlite+pysqlite:///{database_path}'
        engine = db_engine.get_engine(database_url)
        models.Base.metadata.create_all(engine)
        factory = db_engine.session_factory(database_url)
        with factory() as session:
            workspaces = [
                models.Workspace(
                    environment_key=f'route-private-{index}', name=f'Route Private {index}',
                    jira_site_url=f'https://route-private-{index}.example.net', jira_cloud_id=f'cloud-{index}',
                    created_by='test',
                ) for index in range(2)
            ]
            users = [
                models.User(
                    external_provider='atlassian', external_subject=f'route-private-user-{index}',
                    account_type='user', status='active', created_by='test',
                ) for index in range(2)
            ]
            session.add_all(workspaces + users)
            session.flush()
            workspace_ids = [row.id for row in workspaces]
            user_ids = [row.id for row in users]
            session.commit()

        def context(user_index, workspace_index):
            return RequestAuthContext(
                auth_mode='atlassian_oauth', user_id=user_ids[user_index],
                stable_subject=f'route-subject-{user_index}', atlassian_account_id=f'route-account-{user_index}',
                workspace_id=workspace_ids[workspace_index],
                auth_connection_id=f'route-connection-{user_index}-{workspace_index}',
                cloud_id=f'cloud-{workspace_index}', site_url=f'https://route-private-{workspace_index}.example.net',
                token_version='1', account_status='active', is_admin=False,
            )

        contexts = (context(0, 0), context(1, 0), context(0, 1))
        for index, request_context in enumerate(contexts):
            save_user_epm_config(request_context, {
                'version': 2, 'labelPrefix': f'route_private_{index}_*',
                'scope': {'rootGoalKey': f'ROOT-{index}', 'subGoalKeys': [f'GOAL-{index}']},
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {f'custom-{index}': {
                    'id': f'custom-{index}', 'name': f'Private Project {index}', 'label': f'private_label_{index}',
                }},
            }, database_url=database_url)

        env = {
            'CONFIG_STORAGE_BACKEND': 'db', 'DATABASE_URL': database_url,
            'ALLOW_DEV_DIAGNOSTIC_ENDPOINTS': 'true',
        }
        try:
            with patch.dict(os.environ, env, clear=False), \
                 patch.object(jira_server, 'config_storage_db_enabled', return_value=True), \
                 patch.object(jira_server, 'fetch_epm_home_projects', return_value=[]), \
                 patch.object(jira_server, 'fetch_home_site_cloud_id', return_value='detected-cloud'), \
                 patch.object(jira_server, 'fetch_issues_by_jql', return_value=[]), \
                 patch.object(jira_server, 'fetch_epm_rollup_query', return_value=[]), \
                 patch.object(jira_server, 'resolve_epic_link_field_id', return_value=None), \
                 patch.object(jira_server, 'resolve_team_field_id', return_value=None), \
                 patch.object(jira_server, 'filter_epm_projects_for_tab', side_effect=lambda projects, _tab: projects), \
                 patch('backend.epm.projects.filter_epm_projects_for_tab', side_effect=lambda projects, _tab, **_kwargs: projects):
                for index, request_context in enumerate(contexts):
                    marker = f'Private Project {index}'
                    project_id = f'custom-{index}'
                    jira_server.clear_epm_caches(request_context)
                    with self.subTest(index=index), patch.object(
                        jira_server, 'current_request_auth_context', return_value=request_context,
                    ):
                        scope = self.client.get('/api/epm/scope')
                        projects = self.client.get('/api/epm/projects')
                        issues = self.client.get(f'/api/epm/projects/{project_id}/issues?tab=backlog')
                        rollup = self.client.get(f'/api/epm/projects/{project_id}/rollup?tab=backlog')
                        aggregate = self.client.get('/api/epm/projects/rollup/all?tab=backlog')

                    self.assertEqual(scope.status_code, 200, scope.get_data(as_text=True))
                    self.assertEqual(scope.get_json()['scope']['rootGoalKey'], f'ROOT-{index}')
                    for response in (projects, issues, rollup, aggregate):
                        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                        self.assertIn(marker, response.get_data(as_text=True))

                    with patch.object(jira_server, 'APP_ENVIRONMENT_KEY', 'local'), \
                         patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                         patch.object(jira_server, 'database_storage_enabled', return_value=True), \
                         patch.object(jira_server, 'db_oauth_browser_session_data', return_value={'active': True}), \
                         patch.object(jira_server, 'current_request_auth_context', return_value=request_context), \
                         patch.object(jira_server, 'current_jira_session_data', return_value={
                             'access_token': f'access-{index}', 'cloudid': f'cloud-{index}',
                         }), patch.object(jira_server, 'remember_db_oauth_browser_session'), \
                         patch.object(auth_routes.epm_home, 'run_home_graphql_oauth_probe', return_value={
                             'ok': True,
                         }) as home_probe:
                        probe = self.client.get('/api/auth/dev/home-graphql-oauth-probe')

                    self.assertEqual(probe.status_code, 200, probe.get_data(as_text=True))
                    home_probe.assert_called_once()
                    self.assertEqual(home_probe.call_args.kwargs['root_goal_key'], f'ROOT-{index}')
                    self.assertEqual(home_probe.call_args.kwargs['sub_goal_key'], f'GOAL-{index}')
        finally:
            for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
                cache.clear()
            db_engine.dispose_engines()
            if os.path.exists(database_path):
                os.unlink(database_path)

    def test_runtime_epm_routes_return_fixed_storage_error(self):
        routes = (
            '/api/epm/scope',
            '/api/epm/projects',
            '/api/epm/projects/project-1/issues?tab=backlog',
            '/api/epm/projects/project-1/rollup?tab=backlog',
            '/api/epm/projects/rollup/all?tab=backlog',
        )
        for route in routes:
            with self.subTest(route=route), patch.object(
                jira_server,
                'get_epm_config',
                side_effect=jira_server.ConfigStorageError('sensitive detail'),
            ):
                response = self.client.get(route)
            self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
            self.assertEqual(response.get_json(), {
                'error': 'config_storage_unavailable',
                'message': 'EPM configuration storage is unavailable.',
            })

    def test_json_epm_read_failure_returns_fixed_storage_error(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            handle.write('{ malformed')

        response = self.client.get('/api/epm/config')

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'config_storage_unavailable',
            'message': 'EPM configuration storage is unavailable.',
        })
        self.assertNotIn('malformed', response.get_data(as_text=True))

    def test_json_epm_write_failure_returns_fixed_storage_error(self):
        payload = {
            'version': 2,
            'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': '', 'subGoalKeys': []},
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {},
        }
        with patch.object(jira_server, 'save_dashboard_config', side_effect=OSError('sensitive path')):
            response = self.client.post('/api/epm/config', json=payload)

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'error': 'config_storage_unavailable',
            'message': 'EPM configuration storage is unavailable.',
        })
        self.assertNotIn('sensitive path', response.get_data(as_text=True))

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
                    'subGoalKeys': ['CHILD-200'],
                },
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {},
            },
        )

    def test_main_config_includes_saved_epm_config(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'epm': {
                        'version': 2,
                        'labelPrefix': 'rnd_project_*',
                        'scope': {
                            'rootGoalKey': ' root-100 ',
                            'subGoalKey': ' child-200 ',
                        },
                        'projects': {
                            'home-1': {
                                'id': 'home-1',
                                'homeProjectId': 'home-1',
                                'name': 'Synthetic Launch',
                                'label': 'rnd_project_launch',
                            },
                        },
                    },
                },
                handle,
            )

        response = self.client.get('/api/config')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            response.get_json()['epm'],
            {
                'version': 2,
                'labelPrefix': 'rnd_project_*',
                'scope': {
                    'rootGoalKey': 'ROOT-100',
                    'subGoalKeys': ['CHILD-200'],
                },
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {
                    'home-1': {
                        'id': 'home-1',
                        'homeProjectId': 'home-1',
                        'name': 'Synthetic Launch',
                        'label': 'rnd_project_launch',
                    },
                },
            },
        )

    def test_json_main_config_include_view_config_preserves_saved_epm(self):
        saved_epm = {
            'version': 2,
            'labelPrefix': 'private_json_*',
            'scope': {'rootGoalKey': 'ROOT-JSON', 'subGoalKeys': ['GOAL-JSON']},
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {},
        }
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump({'version': 1, 'epm': saved_epm}, handle)

        response = self.client.get('/api/config?includeViewConfig=true')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['epm'], saved_epm)
        self.assertNotIn('viewConfig', response.get_json())

    def test_strict_epm_posts_reject_wrong_content_type_and_malformed_json(self):
        for path in (
            '/api/epm/config',
            '/api/epm/projects/configuration',
            '/api/epm/projects/preview',
        ):
            with self.subTest(path=path, body='wrong-content-type'):
                response = self.client.post(path, data='{}', content_type='text/plain')
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'invalid_epm_config')
            with self.subTest(path=path, body='malformed-json'):
                response = self.client.post(path, data='{ malformed', content_type='application/json')
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.get_json()['error'], 'invalid_epm_config')

    def test_project_runtime_oserror_is_not_mislabeled_as_config_storage_failure(self):
        original_testing = self.app.testing
        self.app.testing = False
        try:
            with patch.object(jira_server, 'fetch_epm_home_projects', side_effect=OSError('home runtime failed')):
                response = self.client.get('/api/epm/projects')
        finally:
            self.app.testing = original_testing

        self.assertEqual(response.status_code, 500, response.get_data(as_text=True))
        self.assertNotIn('config_storage_unavailable', response.get_data(as_text=True))

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
                    'subGoalKeys': ['CHILD-200'],
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

    def test_normalize_epm_config_reads_legacy_sub_goal_key_as_sub_goal_keys(self):
        payload = jira_server.normalize_epm_config({
            'version': 2,
            'scope': {
                'rootGoalKey': ' root-100 ',
                'subGoalKey': ' child-200 ',
            },
        })

        self.assertEqual(payload['scope'], {
            'rootGoalKey': 'ROOT-100',
            'subGoalKeys': ['CHILD-200'],
        })
        self.assertNotIn('subGoalKey', payload['scope'])

    def test_normalize_epm_config_cleans_multi_sub_goal_keys(self):
        payload = jira_server.normalize_epm_config({
            'version': 2,
            'scope': {
                'rootGoalKey': ' root-100 ',
                'subGoalKeys': [' child-200 ', 'CHILD-201', '', 'child-200'],
            },
        })

        self.assertEqual(payload['scope'], {
            'rootGoalKey': 'ROOT-100',
            'subGoalKeys': ['CHILD-200', 'CHILD-201'],
        })

    def test_normalize_epm_config_round_trips_v2_shape(self):
        config = {
            'version': 2,
            'labelPrefix': 'rnd_project_custom_',
            'scope': {
                'rootGoalKey': 'ROOT-100',
                'subGoalKeys': ['CHILD-200'],
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
                    'subGoalKeys': ['CHILD-200'],
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
                    'epm': {
                        'version': 2,
                        'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKey': 'CHILD-200'},
                        'labelPrefix': 'rnd_project_',
                        'projects': {},
                    },
                },
                handle,
            )

        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', {'dummy': {'value': 1}}), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', {'dummy': {'value': 2}}), \
             patch.object(jira_server, 'TASKS_CACHE', {'dummy': {'value': 3}}):
            response = self.client.post(
                '/api/epm/config',
                json={
                    'version': 2,
                    'labelPrefix': 'rnd_project_',
                    'scope': {
                        'rootGoalKey': ' root-100 ',
                        'subGoalKeys': [' child-200 '],
                    },
                    'issueTypes': self.DEFAULT_ISSUE_TYPES,
                    'projects': {
                        'tsq-1': {
                            'id': 'tsq-1',
                            'homeProjectId': ' tsq-1 ',
                            'name': ' Synthetic Launch ',
                            'label': ' synthetic_label_alpha ',
                        }
                    }
                },
            )
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            payload = response.get_json()
            self.assertEqual(payload['version'], 2)
            self.assertEqual(payload['labelPrefix'], 'rnd_project_')
            self.assertEqual(payload['scope']['rootGoalKey'], 'ROOT-100')
            self.assertEqual(payload['scope']['subGoalKeys'], ['CHILD-200'])
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
        self.assertEqual(saved['epm']['scope']['subGoalKeys'], ['CHILD-200'])
        self.assertNotIn('jiraEpicKey', saved['epm']['projects']['tsq-1'])
        self.assertEqual(saved['epm']['projects']['tsq-1']['id'], 'tsq-1')
        self.assertEqual(saved['epm']['projects']['tsq-1']['label'], 'synthetic_label_alpha')
        self.assertEqual(saved['epm']['projects']['tsq-1']['name'], 'Synthetic Launch')

    def test_post_epm_config_clears_project_cache_when_scope_is_added(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {'version': 1, 'groups': []},
                },
                handle,
            )

        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', {'old-empty-scope': {'value': 1}}), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', {'old-issues': {'value': 2}}), \
             patch.object(jira_server, 'EPM_ROLLUP_CACHE', {'old-rollup': {'value': 3}}):
            response = self.client.post(
                '/api/epm/config',
                json={
                    'version': 2,
                    'scope': {'rootGoalKey': 'ROOT-NEW', 'subGoalKeys': ['CHILD-NEW']},
                    'labelPrefix': 'rnd_project_',
                    'issueTypes': self.DEFAULT_ISSUE_TYPES,
                    'projects': {},
                },
            )

            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.EPM_ROLLUP_CACHE, {})

    def test_post_epm_config_clears_project_cache_when_scope_changes(self):
        with open(self._dashboard_path, 'w', encoding='utf-8') as handle:
            json.dump(
                {
                    'version': 1,
                    'projects': {'selected': []},
                    'teamGroups': {'version': 1, 'groups': []},
                    'epm': {
                        'version': 2,
                        'scope': {'rootGoalKey': 'ROOT-OLD', 'subGoalKey': 'CHILD-OLD'},
                        'labelPrefix': 'rnd_project_',
                        'projects': {},
                    },
                },
                handle,
            )

        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', {'old-scope': {'value': 1}}), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', {'old-issues': {'value': 2}}), \
             patch.object(jira_server, 'EPM_ROLLUP_CACHE', {'old-rollup': {'value': 3}}):
            response = self.client.post(
                '/api/epm/config',
                json={
                    'version': 2,
                    'scope': {'rootGoalKey': 'ROOT-NEW', 'subGoalKeys': ['CHILD-NEW']},
                    'labelPrefix': 'rnd_project_',
                    'issueTypes': self.DEFAULT_ISSUE_TYPES,
                    'projects': {},
                },
            )

            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            self.assertEqual(jira_server.EPM_PROJECTS_CACHE, {})
            self.assertEqual(jira_server.EPM_ISSUES_CACHE, {})
            self.assertEqual(jira_server.EPM_ROLLUP_CACHE, {})

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

    def test_jira_labels_prefix_strips_trailing_star(self):
        labels = [
            'rnd_project_app',
            'rnd_project_web',
            'other_label',
        ]

        with patch.object(jira_server, 'LABELS_CACHE', {'data': labels, 'timestamp': 9999999999}):
            response = self.client.get('/api/jira/labels?prefix=rnd_project_*')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_app', 'rnd_project_web'])


if __name__ == '__main__':
    unittest.main()
